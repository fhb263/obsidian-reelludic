/**
 * yt-dlp 运行器（#496，2026-10-03）—— 起子进程抓 B 站音频，回传**字节**（⛔ 不碰库）。
 *
 * 🔴 分层与四平台一致：本文件只做「起进程 / 收输出 / 读文件」，落盘仍由 `main.writeBinaryFile`
 *    （`downloadRelPath` 负责命名、净化、重名 `(2)(3)`）⇒ B 站下载与四平台下载**共享同一条落盘口径**。
 *
 * 🔴 **临时目录**：yt-dlp 的产物先落到 `os.tmpdir()` 下新建的一次性目录，读完字节即整目录删除。
 *    ⛔ 别让它直接往库里写 —— yt-dlp 自己的命名（`%(title)s`）不过 `pure/downloadPlan` 那套净化，
 *    而且中途失败会在用户的下载目录里留下半截文件；临时目录方案两个问题一起消掉。
 *    🔴 这个目录是用 **`cwd`** 告诉 yt-dlp 的（⛔ 不是 `-o`）：`-o` 模板里那个 `%` 会被
 *    pip 形态所需的 `cmd.exe` 当变量吃掉（见 `pure/ytdlp.buildYtDlpArgs`）。
 *
 * 🔴 **依赖全注入**（`YtDlpDeps`）：子进程、文件系统都是假实现可替换的 ⇒ 「ENOENT 时换下一个候选名」
 *    「转码失败时读不到 mp3」这些分支能在单测里真跑一遍。
 *    ⚠️ 本机（2026-10-03）**Node 起子进程被环境拦掉**（`spawnSync` 一律 `EBUSY`）⇒ 「真跑一次」
 *    只能在 `bash` 里手工对着 yt-dlp CLI 做（已做：参数与 stdout 形态就是这么来的）。
 */
import { downloadExt } from 'pure/downloadPlan';
import {
    buildYtDlpArgs,
    parseYtDlpPercent,
    pickYtDlpOutput,
    ytDlpFailureMessage,
    ytDlpNeedsShell,
    ytDlpNoOutputMessage,
    ytDlpNotFoundMessage,
    ytDlpStageLabel,
    ytdlpExeCandidates,
} from 'pure/ytdlp';
import type { DownloadProgressCallback } from 'services/dl';

/** 子进程的**最小**表面（Node `ChildProcess` 结构上满足它，见 `defaultYtDlpDeps` 的转换注释） */
export interface YtDlpStream {
    on(event: 'data', cb: (chunk: unknown) => void): void;
}
export interface YtDlpChild {
    stdout?: YtDlpStream | null;
    stderr?: YtDlpStream | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
}

/** 运行器依赖（真源 = `defaultYtDlpDeps`；单测注入假实现） */
export interface YtDlpDeps {
    /** `cwd` = 产物落点（临时目录）—— ⛔ 不再往参数里塞 `-o`，见 `pure/ytdlp.buildYtDlpArgs` 的注释 */
    spawn: (exe: string, args: string[], cwd: string) => YtDlpChild;
    /** 在系统临时目录下新建一个空目录，返回其绝对路径 */
    mkdtemp: (prefix: string) => string;
    readdir: (dir: string) => string[];
    readFile: (file: string) => Uint8Array;
    /** 递归删除目录（失败不抛：临时目录清不掉不该让整次下载报错） */
    rmrf: (dir: string) => void;
    join: (...parts: string[]) => string;
    platform: string;
}

/** 起一次进程的原始结果 */
interface SpawnOutcome {
    code: number | null;
    stdout: string;
    stderr: string;
    /** 起进程本身失败时带出（`ENOENT` = 找不到可执行文件） */
    spawnError?: string;
}

export interface YtDlpAudioResult {
    ok: boolean;
    /** 失败原因；成功时为空串（成功文案由调用方拼路径） */
    message: string;
    data?: Uint8Array;
    /** 产物扩展名（小写无点） */
    ext?: string;
    /** 产物文件名（诊断用） */
    filename?: string;
}

const START_LABEL = '正在准备下载…';

/** 起一次进程并把 stdout 逐行喂给进度回调（⛔ 不在这里判断成败） */
function spawnOnce(
    deps: YtDlpDeps,
    exe: string,
    args: string[],
    cwd: string,
    onProgress?: DownloadProgressCallback,
): Promise<SpawnOutcome> {
    return new Promise((resolve) => {
        let child: YtDlpChild;
        try {
            child = deps.spawn(exe, args, cwd);
        } catch (e) {
            resolve({ code: null, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
            return;
        }
        let out = '';
        let err = '';
        let label = START_LABEL;
        let settled = false;
        const finish = (o: SpawnOutcome): void => {
            if (settled) return;
            settled = true;
            resolve(o);
        };
        child.stdout?.on('data', (chunk) => {
            const text = String(chunk ?? '');
            out += text;
            for (const line of text.split(/\r?\n/)) {
                const pct = parseYtDlpPercent(line);
                if (pct !== null) {
                    onProgress?.(pct, label);
                    continue;
                }
                const next = ytDlpStageLabel(line);
                if (next) {
                    label = next;
                    onProgress?.(null, next);
                }
            }
        });
        child.stderr?.on('data', (chunk) => {
            err += String(chunk ?? '');
        });
        child.on('error', (e) => {
            finish({
                code: null,
                stdout: out,
                stderr: err,
                spawnError: String(e?.code ?? e?.message ?? 'spawn error'),
            });
        });
        child.on('close', (code) => finish({ code, stdout: out, stderr: err }));
    });
}

/**
 * 抓一条 B 站视频的音频（转 mp3），返回字节。
 *
 * 🔴 可执行名**按候选顺序试**（配置留空时是 `yt-dlp.exe` → `yt-dlp`）：只有 `ENOENT` 才换下一个，
 *    别的 spawn 错误（权限 / EBUSY…）直接报出来 —— 那类问题换名字也解决不了。
 */
export async function fetchBiliAudioWithYtDlp(
    deps: YtDlpDeps,
    opts: { exe: string; url: string; onProgress?: DownloadProgressCallback },
): Promise<YtDlpAudioResult> {
    const url = String(opts.url ?? '').trim();
    if (!url) return { ok: false, message: '缺少视频地址' };
    const candidates = ytdlpExeCandidates(opts.exe, deps.platform);
    let dir = '';
    try {
        dir = deps.mkdtemp('reelludic-bili-');
        const args = buildYtDlpArgs({ url });
        for (let i = 0; i < candidates.length; i++) {
            const exe = candidates[i];
            const r = await spawnOnce(deps, exe, args, dir, opts.onProgress);
            if (r.spawnError) {
                if (r.spawnError === 'ENOENT') {
                    if (i < candidates.length - 1) continue;
                    return { ok: false, message: ytDlpNotFoundMessage(exe) };
                }
                return { ok: false, message: `无法启动 yt-dlp（${exe}）：${r.spawnError}` };
            }
            if (r.code !== 0) {
                return { ok: false, message: ytDlpFailureMessage({ code: r.code, stderr: r.stderr || r.stdout }) };
            }
            const name = pickYtDlpOutput(deps.readdir(dir));
            if (!name) return { ok: false, message: ytDlpNoOutputMessage() };
            const data = deps.readFile(deps.join(dir, name));
            if (!data || data.byteLength === 0) return { ok: false, message: ytDlpNoOutputMessage() };
            return { ok: true, message: '', data, ext: downloadExt(name), filename: name };
        }
        return { ok: false, message: ytDlpNotFoundMessage(candidates[0]) };
    } catch (e) {
        return { ok: false, message: `B 站下载出错：${e instanceof Error ? e.message : String(e)}` };
    } finally {
        if (dir) deps.rmrf(dir);
    }
}

/**
 * 真依赖（桌面端专用）。
 * 🔴 惰性 `require`（与 `services/nodeHttp` 同款）：移动端没有 Node 模块，顶层 `import` 会让整包崩。
 */
export function defaultYtDlpDeps(): YtDlpDeps {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    return {
        // ⚠️ `ChildProcess` 的 `on` 是重载签名（`close` 的回调多一个 `signal` 参数），与上面那份
        //    最小表面**结构上兼容但 TS 不认** ⇒ 这里显式转一次（唯一一处，且只在这个工厂里）。
        spawn: (exe: string, args: string[], cwd: string) => {
            const useShell = ytDlpNeedsShell(exe, process.platform);
            /**
             * 🔴🔴 **Windows 的 `.cmd` / `.bat` 必须经 shell 起**（Node 从 18.20.2 起直接拒绝、
             *    抛的是 `EINVAL`，报错里不提扩展名）—— pip 装的 yt-dlp 正是 `.cmd`。
             *
             * ⚠️ shell 模式下 Node 把 `文件 + 参数` 拼成**一条**命令行交给 `cmd.exe /d /s /c "…"`，
             *    而且**不给文件/参数加引号** ⇒ 文件路径里只要有空格就会被从空格处切断。
             *    这里自己给**可执行文件**补一对引号：`cmd /s` 会剥掉最外层那对，剩下的刚好是
             *    `"C:\有 空格\x.cmd" 参数…` ⇒ 正确解析。
             * ⚠️ 参数侧不补引号 —— 本仓的参数里**没有空格**（输出目录走 `cwd`，
             *    且 `pure/ytdlp.buildYtDlpArgs` 刻意不含 `%`：cmd 会把一对 `%` 之间的内容当变量吃掉）。
             */
            const file = useShell ? `"${exe}"` : exe;
            return cp.spawn(file, args, {
                windowsHide: true,
                cwd,
                ...(useShell ? { shell: true } : {}),
            }) as unknown as YtDlpChild;
        },
        mkdtemp: (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
        readdir: (dir: string) => fs.readdirSync(dir),
        readFile: (file: string) => new Uint8Array(fs.readFileSync(file)),
        rmrf: (dir: string) => {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                /* 临时目录清不掉就算了：系统重启会清，⛔ 不该因此让下载报失败 */
            }
        },
        join: (...parts: string[]) => path.join(...parts),
        platform: process.platform,
    };
}
