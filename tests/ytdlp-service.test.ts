/**
 * `services/ytdlp` 单测（#496）—— 起进程、逐行喂进度、候选名重试、终态判定、临时目录清理。
 * 子进程与文件系统全注入假实现（本机 Node 起子进程被环境拦掉，见源文件头注释）。
 */
import { describe, expect, it } from 'vitest';
import { fetchBiliAudioWithYtDlp, type YtDlpChild, type YtDlpDeps } from 'services/ytdlp';

interface FakeScript {
    /** 逐行喂到 stdout（每行补 `\n`） */
    stdoutLines?: string[];
    stderrText?: string;
    exitCode?: number | null;
    /** 起进程失败（`ENOENT` 等） */
    spawnError?: { code?: string; message?: string };
}

/** 造一个「起得来但要在稍后吐输出」的假子进程 */
function makeFakeChild(script: FakeScript): { child: YtDlpChild; play: () => void } {
    let dataCb: ((chunk: unknown) => void) | null = null;
    let errCb: ((chunk: unknown) => void) | null = null;
    let errorCb: ((e: { code?: string; message?: string }) => void) | null = null;
    let closeCb: ((code: number | null) => void) | null = null;
    const child: YtDlpChild = {
        stdout: { on: (_ev, cb) => { dataCb = cb; } },
        stderr: { on: (_ev, cb) => { errCb = cb; } },
        on: (ev: string, cb: never) => {
            if (ev === 'error') errorCb = cb as unknown as typeof errorCb;
            else closeCb = cb as unknown as typeof closeCb;
        },
    } as YtDlpChild;
    const play = (): void => {
        if (script.spawnError) {
            errorCb?.(script.spawnError);
            return;
        }
        for (const line of script.stdoutLines ?? []) dataCb?.(`${line}\n`);
        if (script.stderrText) errCb?.(script.stderrText);
        closeCb?.(script.exitCode === undefined ? 0 : script.exitCode);
    };
    return { child, play };
}

interface Harness {
    deps: YtDlpDeps;
    spawnCalls: string[];
    spawnCwds: string[];
    rmrfCalls: string[];
    readFilePaths: string[];
}

function makeHarness(script: (exe: string, nth: number) => FakeScript, dirFiles: string[], opts: {
    platform?: string;
    fileBytes?: Uint8Array;
    readFileThrows?: boolean;
    mkdtempThrows?: boolean;
} = {}): Harness {
    const spawnCalls: string[] = [];
    const spawnCwds: string[] = [];
    const rmrfCalls: string[] = [];
    const readFilePaths: string[] = [];
    const deps: YtDlpDeps = {
        spawn: (exe, _args, cwd) => {
            const nth = spawnCalls.length + 1;
            spawnCalls.push(exe);
            spawnCwds.push(cwd);
            const fake = makeFakeChild(script(exe, nth));
            // 真 spawn 的回调是异步来的 ⇒ 这里也推到微任务之后，避免「先吐完再注册」的假象
            setTimeout(fake.play, 0);
            return fake.child;
        },
        mkdtemp: (prefix) => {
            if (opts.mkdtempThrows) throw new Error('no tmp');
            return `C:/tmp/${prefix}dir`;
        },
        readdir: () => dirFiles,
        readFile: (file) => {
            readFilePaths.push(file);
            if (opts.readFileThrows) throw new Error('read boom');
            return opts.fileBytes ?? new Uint8Array([1, 2, 3]);
        },
        rmrf: (dir) => rmrfCalls.push(dir),
        join: (...parts) => parts.join('/'),
        platform: opts.platform ?? 'win32',
    };
    return { deps, spawnCalls, spawnCwds, rmrfCalls, readFilePaths };
}

const AUDIO_OK = ['周杰伦-晴天.mp3'];

describe('fetchBiliAudioWithYtDlp', () => {
    it('空地址 ⇒ 直接拒绝，不起进程', async () => {
        const h = makeHarness(() => ({}), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: '  ' });
        expect(out.ok).toBe(false);
        expect(out.message).toBe('缺少视频地址');
        expect(h.spawnCalls).toHaveLength(0);
    });

    it('成功：读出 mp3 字节、ext=mp3，并**删掉临时目录**', async () => {
        const h = makeHarness(() => ({ stdoutLines: ['[download] Destination: x.m4a', '[ExtractAudio] Destination: x.mp3'] }), AUDIO_OK);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: 'C:/t/yt-dlp.exe', url: 'https://b/BV1' });
        expect(out.ok).toBe(true);
        expect(out.ext).toBe('mp3');
        expect(out.data?.byteLength).toBe(3);
        expect(h.readFilePaths).toEqual(['C:/tmp/reelludic-bili-dir/周杰伦-晴天.mp3']);
        expect(h.rmrfCalls).toEqual(['C:/tmp/reelludic-bili-dir']);
    });

    it('填了绝对路径 ⇒ 只用它一个候选（⛔ 不再去猜 PATH）', async () => {
        const h = makeHarness(() => ({ stdoutLines: [] }), AUDIO_OK);
        await fetchBiliAudioWithYtDlp(h.deps, { exe: 'C:/tools/yt-dlp.exe', url: 'u' });
        expect(h.spawnCalls).toEqual(['C:/tools/yt-dlp.exe']);
    });

    it('留空 + win32：第一个候选 ENOENT ⇒ **换下一个**（`yt-dlp.exe` → `yt-dlp.cmd`，pip 装出来的正是后者）', async () => {
        const h = makeHarness((exe, nth) => (nth === 1 ? { spawnError: { code: 'ENOENT' } } : { stdoutLines: [] }), AUDIO_OK);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(true);
        expect(h.spawnCalls).toEqual(['yt-dlp.exe', 'yt-dlp.cmd']);
    });

    it('全部候选都 ENOENT ⇒ 未找到文案（含「去哪儿配」）', async () => {
        const h = makeHarness(() => ({ spawnError: { code: 'ENOENT' } }), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('未找到 yt-dlp');
        expect(out.message).toContain('音乐源凭据');
        expect(h.rmrfCalls).toHaveLength(1);
    });

    it('填了路径但 ENOENT ⇒ 当场报未找到（**不**退回 PATH 里猜）', async () => {
        const h = makeHarness(() => ({ spawnError: { code: 'ENOENT' } }), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: 'C:/bad/yt-dlp.exe', url: 'u' });
        expect(out.message).toContain('未找到 yt-dlp（C:/bad/yt-dlp.exe）');
        expect(h.spawnCalls).toEqual(['C:/bad/yt-dlp.exe']);
    });

    it('非 ENOENT 的 spawn 错误 ⇒ 直接报出来（换名字也解决不了）', async () => {
        const h = makeHarness(() => ({ spawnError: { code: 'EBUSY' } }), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.message).toContain('无法启动 yt-dlp');
        expect(out.message).toContain('EBUSY');
        expect(h.spawnCalls).toEqual(['yt-dlp.exe']);
    });

    it('退出码非 0 ⇒ 按 stderr 给具体原因（ffmpeg 缺失）', async () => {
        const h = makeHarness(() => ({ exitCode: 1, stderrText: 'ERROR: Postprocessing: ffmpeg not found\n' }), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('ffmpeg');
    });

    it('退出码非 0 且 stderr 为空 ⇒ 用 stdout 兜底（⛔ 不留「下载失败」四个字）', async () => {
        const h = makeHarness(() => ({ exitCode: 3, stdoutLines: ['ERROR: Video unavailable'] }), []);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.message).toBe('下载失败：ERROR: Video unavailable');
    });

    it('退出码 0 但目录里没有音频 ⇒ 「没产出」文案（该视频可能没有音频流）', async () => {
        const h = makeHarness(() => ({ exitCode: 0 }), ['cover.webp', 'x.info.json']);
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('没有音频流');
    });

    it('退出码 0 但读到的文件是空的 ⇒ 同样判「没产出」', async () => {
        const h = makeHarness(() => ({ exitCode: 0 }), AUDIO_OK, { fileBytes: new Uint8Array() });
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('没有音频流');
    });

    it('读文件抛错 ⇒ 包成可读文案（临时目录照样清）', async () => {
        const h = makeHarness(() => ({ exitCode: 0 }), AUDIO_OK, { readFileThrows: true });
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('B 站下载出错');
        expect(h.rmrfCalls).toHaveLength(1);
    });

    it('临时目录建不出来 ⇒ 直接报错，不进入循环', async () => {
        const h = makeHarness(() => ({ stdoutLines: [] }), AUDIO_OK, { mkdtempThrows: true });
        const out = await fetchBiliAudioWithYtDlp(h.deps, { exe: '', url: 'u' });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('no tmp');
        expect(h.spawnCalls).toHaveLength(0);
    });

    it('进度：真输出逐行翻成「百分比 + 阶段」（百分比跟着当前阶段文案）', async () => {
        const seen: Array<[number | null, string]> = [];
        const h = makeHarness(
            () => ({
                stdoutLines: [
                    '[download] Destination: x.m4a',
                    '[download]   0.0% of  5.91MiB at  542KiB/s ETA 00:11',
                    '[download]  33.8% of  5.91MiB at  3.02MiB/s ETA 00:01',
                    '[download] 100% of  5.91MiB in 00:00:02',
                    '[ExtractAudio] Destination: x.mp3',
                ],
            }),
            AUDIO_OK,
        );
        await fetchBiliAudioWithYtDlp(h.deps, {
            exe: '',
            url: 'u',
            onProgress: (pct, label) => seen.push([pct, label]),
        });
        expect(seen).toEqual([
            [null, '正在从 B 站下载音频…'],
            [0, '正在从 B 站下载音频…'],
            [34, '正在从 B 站下载音频…'],
            [100, '正在从 B 站下载音频…'],
            [null, '正在转为 mp3…'],
        ]);
    });

    it('输出目录是用 **cwd** 给的（⛔ 参数里没有 `-o`，避免 `%` 撞 cmd 的变量展开）', async () => {
        let captured: string[] = [];
        const h = makeHarness(() => ({ stdoutLines: [] }), AUDIO_OK);
        const orig = h.deps.spawn;
        const deps: YtDlpDeps = { ...h.deps, spawn: (exe, args, cwd) => { captured = args; return orig(exe, args, cwd); } };
        await fetchBiliAudioWithYtDlp(deps, { exe: '', url: 'https://b/BV9' });
        expect(captured).not.toContain('-o');
        expect(captured.every((a) => !a.includes('%'))).toBe(true);
        expect(captured[captured.length - 1]).toBe('https://b/BV9');
        expect(h.spawnCwds).toEqual(['C:/tmp/reelludic-bili-dir']);
    });
});
