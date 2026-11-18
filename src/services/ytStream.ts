/**
 * YouTube 取流服务（桌面端）：调 `yt-dlp` 子进程拿直链，再登记进本地回环代理。
 *
 * 🔴 为什么必须外挂 `yt-dlp` 而不是自己打接口（真机实测，2026-11）：
 *    YouTube 没有可用的公开取流 API。自己解 signature / `n` 参数要跟着 Google
 *    频繁改的播放器逻辑持续维护，那是**一个独立项目的工作量**，不是插件该背的债。
 *    `yt-dlp` 社区已经在这件事上投入了十几年，把它当**外部依赖**是唯一理性的选择。
 *
 * 🔴 为什么还要本地回环代理（`tools/probe-yt-egress.mjs` 实测结论）：
 *    `googlevideo.com` 对 `app://obsidian.md` 这个 origin **不回 CORS 头** ⇒
 *    渲染进程里 `fetch(直链)` 直接 `TypeError: Failed to fetch`。
 *    这与当初 B 站 DASH 栽的是同一个坑，解法也一样：本地补头转发。
 *
 * ⚠️ 三条纪律：
 *  1. 子进程**必须能超时杀掉**：yt-dlp 在某些风控下会挂几十秒不返回，
 *     不设上限会让整个播放器卡在「正在取流」；
 *  2. 代理地址**显式传**给子进程（`--proxy`），⛔ 依赖环境变量继承 ——
 *     打包后的 Obsidian GUI 进程未必有 yt-dlp 命令行里那份环境；
 *  3. 失败一律返回带**可读文案**的 `{ err }`，⛔ 不返回裸 null ——
 *     用户看到「要登录验证」和「插件坏了」时的自救动作完全不同。
 */
import { parseYtSearch, ytContentUnavailable, ytErrorMessage, type YtPick, type YtSearchItem } from 'pure/youtube';

/** 取流结果 */
export interface YtStreamResult {
    /** 视频轨本地地址（`http://127.0.0.1:PORT/yt-v.mp4`） */
    videoUrl: string;
    /** 音频轨本地地址（可能为 `null`：极端情况只有视频） */
    audioUrl: string | null;
    /** 视频 codecs（喂 `MediaSource.isTypeSupported`） */
    videoCodecs: string;
    /** 音频 codecs */
    audioCodecs: string;
    /** 片名 */
    title: string;
    /** 片长（秒） */
    duration: number;
    /** 可选画质高度（降序） */
    heights: number[];
    /** 本次实际给的画质高度 */
    height: number;
    /** 本地代理基址（排障/清理用） */
    base: string;
}

/** 失败结果 */
export interface YtStreamFailure {
    /** 给用户看的一句话（已翻译成中文，⛔ 不是 yt-dlp 原文） */
    err: string;
    /** 原始 stderr（只进控制台，⛔ 不弹给用户） */
    raw: string;
}

/** Node 子进程最小接口（惰性 require：移动端没有 Node） */
interface NodeProcess {
    spawn: (
        cmd: string,
        args: string[],
        opt: Record<string, unknown>,
    ) => {
        stdout: { on: (ev: string, cb: (d: unknown) => void) => void };
        stderr: { on: (ev: string, cb: (d: unknown) => void) => void };
        on: (ev: string, cb: (...a: never[]) => void) => void;
        kill: (sig?: string) => void;
    };
    /** 同步执行（读系统代理用：一次注册表读 < 200ms，比异步回环省事） */
    spawnSync?: (
        cmd: string,
        args: string[],
        opt: Record<string, unknown>,
    ) => { stdout?: unknown; status?: number | null };
}

/** yt-dlp 的默认超时：取 JSON 正常 2~8 秒，60 秒还没回基本就是被风控挂住了 */
const YT_TIMEOUT_MS = 60_000;

/** 一次调用所需的「命令 + 固定前置参数」 */
export interface YtCmd {
    cmd: string;
    pre: string[];
}

/**
 * yt-dlp 的候选启动方式，按优先级排列。
 *
 * 🔴 为什么要一串候选而不是直接 `spawn('yt-dlp')`（真机实测的坑，2026-11）：
 *    Windows 上 `pip install yt-dlp` 只产出 `yt-dlp.cmd`（批处理包装器，不是 exe）。
 *    Node 的 `spawn` **不做 PATHEXT 解析**，也不执行 `.cmd`，于是：
 *      - `spawn('yt-dlp')`      ⇒ `ENOENT`（明明装了却报没装）
 *      - `spawn('yt-dlp.exe')`  ⇒ `ENOENT`
 *    实测唯一稳定的一条是 `python -m yt_dlp`。所以顺序是：
 *      ① `python -m yt_dlp`（pip 装的 Python 包，跨平台一致）
 *      ② `py -m yt_dlp`（Windows Python Launcher）
 *      ③ `yt-dlp`（brew / 独立 exe / Linux 包管理器，在那些环境里这就是对的）
 *      ④ `yt-dlp.exe` / `yt-dlp.cmd`（最后兜底；只要 Node 能命中就用）
 *    ⛔ 别退回单一 `spawn('yt-dlp')` —— 在 Windows 上等于功能永久不可用。
 */
export function ytCommandCandidates(): YtCmd[] {
    return [
        { cmd: 'python', pre: ['-m', 'yt_dlp'] },
        { cmd: 'py', pre: ['-m', 'yt_dlp'] },
        { cmd: 'yt-dlp', pre: [] },
        { cmd: 'yt-dlp.exe', pre: [] },
    ];
}

/**
 * 探测可用的 yt-dlp 启动方式（跑一次 `--version`，第一个成功的留下）。
 *
 * ⚠️ 只探测一次并缓存：每次取流都探测会让起播再慢几百毫秒。
 * ⚠️ 探测失败要**清理缓存**，否则用户装好 yt-dlp 后必须重启 Obsidian。
 */
let cachedYtCmd: YtCmd | null = null;

export function resetYtCommandCache(): void {
    cachedYtCmd = null;
}

/** 探测可用的启动方式；全都不行 ⇒ `null` */
export async function resolveYtCommand(): Promise<YtCmd | null> {
    if (cachedYtCmd) return cachedYtCmd;
    let cp: NodeProcess;
    try {
        cp = require('child_process') as NodeProcess;
    } catch {
        return null;
    }
    for (const c of ytCommandCandidates()) {
        const ok = await new Promise<boolean>((resolve) => {
            let child: ReturnType<NodeProcess['spawn']>;
            try {
                child = cp.spawn(c.cmd, [...c.pre, '--version'], { windowsHide: true });
            } catch {
                resolve(false);
                return;
            }
            let settled = false;
            const finish = (v: boolean): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(v);
            };
            const timer = setTimeout(() => {
                try { child.kill(); } catch { /* 已退 */ }
                finish(false);
            }, 8000);
            child.on('error', () => finish(false));
            child.on('close', (code: number) => finish(code === 0));
        });
        if (ok) {
            cachedYtCmd = c;
            return c;
        }
    }
    return null;
}

/**
 * 找本机的 Node，返回要给 `--js-runtimes` 的值（`node` 或 `node:<绝对路径>`）；找不到 ⇒ `''`。
 *
 * 🔴🔴 为什么必须有这块（2026-10-31 真机事故，用户 log 逐字）：
 *    `[debug] JS runtimes: none`
 *    `[debug] [youtube] [jsc] JS Challenge Providers: bun (unavailable), deno (unavailable), node (unavailable), quickjs (unavailable)`
 *    `WARNING: Only images are available for download.`
 *    ⇒ yt-dlp **默认只启用 deno**（`--help` 原文：「Only "deno" is enabled by default」）。
 *    没有 deno 也不指定运行时，YouTube 的 JS challenge 解不出来，只下发 storyboard（雪碧图），
 *    `formats` 里 real_formats = 0 ⇒ 插件侧表现为「取流成功但没有可用轨道」或
 *    「The page needs to be reloaded」/「Sign in to confirm you're not a bot」。
 *    用户明明填了 Cookie 却一直被提示去填 Cookie —— 就是这条链在误导。
 *
 *    🧪 实测（yt-dlp 2026.08.19 与 2026.10.26 各跑一遍，同一视频同一代理同一份 Cookie）：
 *      - 不加 `--js-runtimes`            ⇒ real_formats = 0（只有 4 条 storyboard）
 *      - 加 `--js-runtimes node`         ⇒ real_formats = 22 / 33，正常出 1080p
 *    ⇒ **不需要用户升级 yt-dlp**，`--js-runtimes` 在 2026.08 就已支持。
 *
 * ⚠️ 为什么要探路径而不是直接写 `node`：打包后的 Obsidian GUI 进程的 PATH 未必等于
 *    用户终端里的 PATH（尤其用 nvm/独立安装包的机器）⇒ 光写 `node` 可能 yt-dlp 找不到。
 *    探到绝对路径就写 `node:<path>`（`--js-runtimes RUNTIME[:PATH]` 支持带路径）。
 * ⚠️ 只探一次并缓存；`resetJsRuntimeCache` 供「用户当场装了 Node」后重试用。
 */
let cachedJsRuntime: string | null | undefined;

/**
 * ⚠️ 与 `cachedJsRuntime` 分开的一个标志：**这个 yt-dlp 版本不认 `--js-runtimes`**。
 *
 * 🔴 为什么不能用 `resetJsRuntimeCache()` 来表达这件事（我第一版就这么写的，会死循环）：
 *    重置缓存后递归重试 → `resolveNodeRuntime()` 又探到 node → 又加上 `--js-runtimes`
 *    → 又报 no such option → 又重试……yt-dlp 版本问题变成了无限循环。
 *    ⇒ 版本不支持是**命令能力**的事实，不是「还没探到」的状态，必须单独记。
 */
let jsRuntimeUnsupported = false;

export function resetJsRuntimeCache(): void {
    cachedJsRuntime = undefined;
    jsRuntimeUnsupported = false;
}

/** 老版本 yt-dlp 不认 `--js-runtimes` 时的 stderr 特征 */
const UNSAFE_JS_RUNTIME_OPT = /no such option|unrecognized arguments|--js-runtimes/i;

/** yt-dlp 的 JS challenge 至少要 Node 18（更低版本跑不了它的 EJS 脚本） */
const NODE_MIN_MAJOR = 18;

/** 跑一次 `<exe> --version`，返回主版本号；起不来/输出不对 ⇒ null */
async function probeNodeMajor(cp: NodeProcess, exe: string): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
        let child: ReturnType<NodeProcess['spawn']>;
        try {
            child = cp.spawn(exe, ['--version'], { windowsHide: true });
        } catch {
            resolve(null);
            return;
        }
        let out = '';
        let settled = false;
        const finish = (v: number | null): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(v);
        };
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* 已退 */ }
            finish(null);
        }, 5000);
        child.stdout.on('data', (d) => { out += String(d); });
        child.stderr.on('data', () => { /* 版本号在 stdout，stderr 忽略 */ });
        child.on('error', () => finish(null));
        child.on('close', () => {
            const m = out.trim().match(/^v?(\d+)\./);
            finish(m ? Number(m[1]) : null);
        });
    });
}

export async function resolveNodeRuntime(): Promise<string> {
    if (jsRuntimeUnsupported) return '';
    if (cachedJsRuntime !== undefined) return cachedJsRuntime ?? '';
    let cp: NodeProcess;
    try {
        cp = require('child_process') as NodeProcess;
    } catch {
        cachedJsRuntime = null;
        return '';
    }

    // ① 先试 PATH 里的 `node`（最省事：找到就不必拼路径，跨平台一致）
    // ② 再试各平台的常见安装位置（GUI 进程 PATH 不全时的兜底）
    const nonWindows = ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node'];
    const candidates: string[] = ['node'];
    if (process.platform === 'win32') {
        const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
        const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
        const local = process.env['LOCALAPPDATA'] ?? '';
        candidates.push(`${pf}\\nodejs\\node.exe`, `${pf86}\\nodejs\\node.exe`);
        if (local) candidates.push(`${local}\\Programs\\nodejs\\node.exe`);
    } else {
        candidates.push(...nonWindows);
    }

    for (const exe of candidates) {
        const major = await probeNodeMajor(cp, exe);
        if (major === null || major < NODE_MIN_MAJOR) continue;
        // PATH 命中的就写裸名（yt-dlp 自己再找一次没问题）；否则写绝对路径
        cachedJsRuntime = exe === 'node' ? 'node' : `node:${exe}`;
        return cachedJsRuntime;
    }
    cachedJsRuntime = null;
    return '';
}

/**
 * 读 Windows「Internet 选项」里配的系统代理（`ProxyEnable` / `ProxyServer`）。
 *
 * 🔴🔴 为什么必须有这块（2026-10-31 真机事故，用户全链路复现）：
 *    yt-dlp 会自己从注册表读系统代理 ⇒ **取流成功**；
 *    但 `ffmpeg`（合流那一步，`src/services/ytMux.ts`）**不读系统代理** ⇒
 *      `[tcp @ ...] Connection to tcp://rr5---sn-....googlevideo.com:443 failed: Error number -138`
 *    ⇒ 用户 `ytProxy` 留空时，表现为「取流拿到了、合流炸了」，
 *      而设置页那句「留空 = 直连」让人以为留空是受支持的正确用法。
 *
 *    ⇒ 留空时**兜底沿用系统代理**，让 yt-dlp 与 ffmpeg 走同一个出口。
 *      ⛔ 不悄悄改写用户设置里的值（`settings.ytProxy` 保持空，用户界面不变）；
 *      ⛔ 用户显式填了代理就以用户的为准，⛔ 不要被系统代理覆盖。
 *
 * ⚠️ 只认 `http=` / `https=` 形态（`socks=` 不支持：ffmpeg 的 `-http_proxy`
 *    只吃 http 代理，写 socks 进去等于没写，还会报一个更难懂的错误）。
 * ⚠️ `ProxyOverride` 里的例外列表**不处理**：我们的目标是单一出口主机，
 *    而 googlevideo / youtube 不可能出现在用户的绕过表里。
 * ⚠️ 非 Windows 一律返回 `''`：macOS / Linux 的系统代理不在这套注册表里，
 *    猜错不如不猜（让用户显式填）。
 */
export function systemProxyUrl(): string {
    if (process.platform !== 'win32') return '';
    let cp: NodeProcess;
    try {
        cp = require('child_process') as NodeProcess;
    } catch {
        return '';
    }
    // 同步读（`-NoProfile` 提速，避免把用户的 profile 脚本跑一遍）
    const script =
        "$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';" +
        "if(!(Test-Path $k)){exit 0};$p=Get-ItemProperty $k;" +
        "if($p.ProxyEnable -ne 1){exit 0};[string]$p.ProxyServer";
    let out = '';
    try {
        const run = cp.spawnSync;
        if (!run) return '';
        const r = run.call(cp, 'powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
            windowsHide: true,
            timeout: 4000,
            encoding: 'utf8',
        });
        out = String(r?.stdout ?? '').trim();
    } catch {
        return '';
    }
    if (!out) return '';

    // `ProxyServer` 有两种形态：
    //   ① 单值        `127.0.0.1:7897`
    //   ② 按协议分列  `http=127.0.0.1:7897;https=127.0.0.1:7897;socks=127.0.0.1:7897`
    let host = '';
    if (out.includes('=')) {
        for (const seg of out.split(';')) {
            const at = seg.indexOf('=');
            if (at <= 0) continue;
            const key = seg.slice(0, at).trim().toLowerCase();
            const val = seg.slice(at + 1).trim();
            if ((key === 'http' || key === 'https') && val) {
                host = val;
                break;
            }
        }
    } else {
        host = out;
    }
    return normalizeProxyUrl(host);
}

/**
 * 把用户填的代理地址规整成 `http://host:port` 形态。
 *
 * ⚠️ 为什么要容错：用户在设置里可能只写 `127.0.0.1:7897`（不带 scheme），
 *    直接丢给 `yt-dlp --proxy` 会被判非法参数而整个取流失败。
 * ⚠️ 空值 / 明显不合法的值 ⇒ 返回 `''`（= 直连），⛔ 不返回半截地址。
 */
export function normalizeProxyUrl(raw: string | undefined | null): string {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    // 没有 scheme（且不是 socks5/socks4）⇒ 补 http://
    const withScheme = /^[a-z0-9+.-]+:\/\//i.test(s) ? s : `http://${s}`;
    try {
        const u = new URL(withScheme);
        if (!u.hostname) return '';
        // 只认 http / https / socks5 —— 别的 yt-dlp 也不支持
        if (!/^(https?|socks5h?|socks4)$/i.test(u.protocol.replace(':', ''))) return '';
        return `${u.protocol}//${u.host}`;
    } catch {
        return '';
    }
}

/** 一条 cookie 的规整形态（Netscape 各列都已就位） */
export interface NetscapeCookie {
    domain: string;
    includeSubdomains: boolean;
    path: string;
    secure: boolean;
    /** unix 秒；`0` = 会话 cookie */
    expiry: number;
    name: string;
    value: string;
}

/**
 * 把用户给的 Cookie 解析成 Netscape 行，**同时接受两种真实形态**。
 *
 * 🔴 为什么必须支持两种（真机教训，2026-11）：
 *    用户从浏览器插件导出的往往是 **JSON 数组**：
 *      `[{"domain":".youtube.com","name":"SID","value":"…","expirationDate":1827460746,…}, …]`
 *    而「从开发者工具复制请求头」得到的是裸头部 `SID=…; HSID=…`。
 *    早期实现只按 `;` 切串 —— JSON 里没有 `=` 也没有 `;`，
 *    结果**每条都被丢弃**，生成一个只有注释头的空 cookies.txt，
 *    于是「填了 Cookie 等于没填」而且没有任何报错。这条路径必须有测试锁死。
 *
 * ⚠️ JSON 分支下**逐个字段取真值**（domain / path / secure / expiry），
 *    不要像旧实现那样把域写死成 `.youtube.com`：导出的 cookie 可能是
 *    `hostOnly: true` 的 `www.youtube.com`，也可能带 `__Secure-` 前缀需要 `secure`。
 */
export function parseCookies(raw: string): NetscapeCookie[] {
    const text = String(raw || '').trim();
    if (!text) return [];

    // ══════════════ 形态一：JSON 数组（浏览器插件导出） ══════════════
    if (text.startsWith('[') || text.startsWith('{')) {
        let arr: unknown;
        try {
            arr = JSON.parse(text);
        } catch {
            return []; // 半截 JSON ⇒ 当没给，⛔ 不猜
        }
        const list = Array.isArray(arr) ? arr : [arr];
        const out: NetscapeCookie[] = [];
        for (const item of list) {
            if (!item || typeof item !== 'object') continue;
            const o = item as Record<string, unknown>;
            const name = typeof o.name === 'string' ? o.name.trim() : '';
            if (!name) continue;
            // ⚠️ value 可能是数字/布尔，统一按字符串取；⛔ 不能因为类型不符就丢
            const value = o.value === undefined || o.value === null ? '' : String(o.value);
            const domain = typeof o.domain === 'string' && o.domain ? o.domain : '.youtube.com';
            const path = typeof o.path === 'string' && o.path ? o.path : '/';
            const hostOnly = o.hostOnly === true;
            // hostOnly 的域在 Netscape 里第 2 列必须 FALSE，否则 `.www.youtube.com` 这种写不出来
            const includeSubdomains = !hostOnly;
            const secure = o.secure === true;
            // ⚠️ expirationDate 是**浮点秒**（`1824910517.679821`），Netscape 只认整数
            const expRaw = Number(o.expirationDate ?? 0);
            const expiry = Number.isFinite(expRaw) && expRaw > 0 ? Math.floor(expRaw) : 0;
            out.push({ domain, includeSubdomains, path, secure, expiry, name, value });
        }
        return out;
    }

    // ══════════════ 形态二：裸请求头 `a=b; c=d` ══════════════
    const out: NetscapeCookie[] = [];
    for (const pair of text.split(';')) {
        const s = pair.trim();
        if (!s) continue;
        const eq = s.indexOf('='); // 只按第一个 = 切（JWT 类值里还有 =）
        if (eq <= 0) continue;
        const name = s.slice(0, eq).trim();
        const value = s.slice(eq + 1).trim();
        if (!name) continue;
        out.push({
            domain: '.youtube.com',
            includeSubdomains: true,
            path: '/',
            secure: true,
            expiry: 0,
            name,
            value,
        });
    }
    return out;
}

/**
 * 把 Cookie（JSON 导出 / 裸头部两种形态）转成 yt-dlp 认的 **Netscape cookies.txt**。
 *
 * 🔴 为什么必须转格式：`--cookies` 只吃 Netscape 行式文本，别的形态会被判坏文件
 *    （yt-dlp 报 `does not look like a Netscape format cookies file`）。
 *
 * Netscape 七列：`域 是否含子域 路径 是否 secure 过期秒 名 值`（TAB 分隔）。
 * ⛔ 别把 HttpOnly / SameSite 塞进第 2 列 —— 那里只有 TRUE/FALSE。
 */
export function cookieToNetscape(raw: string): string {
    const out = [
        '# Netscape HTTP Cookie File',
        '# 本文件由 ReelLudic 生成，仅用于 yt-dlp 取流；每次取流重写，用完即删。',
        '',
    ];
    for (const c of parseCookies(raw)) {
        out.push(
            [
                c.domain,
                c.includeSubdomains ? 'TRUE' : 'FALSE',
                c.path,
                c.secure ? 'TRUE' : 'FALSE',
                String(c.expiry),
                c.name,
                c.value,
            ].join('\t'),
        );
    }
    return out.join('\n') + '\n';
}

/**
 * 落盘成临时 cookie 文件，返回路径；写不了 ⇒ `''`（调用方据此退回匿名模式）。
 *
 * ⚠️ 用 `0o600`：Cookie 是账号凭据，别让同机其他用户读。
 */
function writeCookieFile(raw: string, dir?: string): string {
    if (!dir) return '';
    try {
        const fs = require('fs') as {
            mkdirSync: (p: string, o: { recursive: boolean }) => void;
            writeFileSync: (p: string, d: string, o: { mode?: number; encoding?: string }) => void;
        };
        const path = require('path') as { join: (...a: string[]) => string };
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'yt-cookies.txt');
        fs.writeFileSync(file, cookieToNetscape(raw), { mode: 0o600, encoding: 'utf8' });
        return file;
    } catch {
        return '';
    }
}

/** 用完就删：Cookie 文件不该在磁盘上留着 */
export function removeCookieFile(dir?: string): void {
    if (!dir) return;
    try {
        const fs = require('fs') as { unlinkSync: (p: string) => void };
        const path = require('path') as { join: (...a: string[]) => string };
        fs.unlinkSync(path.join(dir, 'yt-cookies.txt'));
    } catch {
        /* 不存在 / 删不掉都不影响取流 */
    }
}

/**
 * 跑一次 `yt-dlp -J`，拿回解析后的 info。
 *
 * 🔴 `-J` 一次就给**全部**格式 + 字幕表，不用再为「有哪些画质」「有没有字幕」多跑两遍。
 *    代价是 JSON 可能有几 MB（`--no-write-pages` 之类会砍掉注释等冗余，但 formats 必须留）。
 *
 * @param videoUrl 视频页 URL
 * @param proxy 规整后的代理地址（空串 = 直连）
 * @param cookie 浏览器 Cookie 原文（空串 = 不带）
 * @param cookieDir Cookie 临时文件目录（空串 ⇒ 无法使用 Cookie，退回匿名）
 */
export async function fetchYtInfo(
    videoUrl: string,
    proxy: string,
    cookie: string,
    /** Cookie 文件目录（宿主给插件临时目录）。空串 ⇒ 无法用 Cookie，走匿名。 */
    cookieDir?: string,
): Promise<{ info: unknown; raw: string } | YtStreamFailure> {
    let cp: NodeProcess;
    try {
        cp = require('child_process') as NodeProcess;
    } catch {
        return { err: '当前环境没有 Node 子进程能力（移动端不支持 YouTube 取流）', raw: '' };
    }

    // 🔴 先拿到「哪个命令真能跑」——`spawn('yt-dlp')` 在 Windows 上必 ENOENT
    //    （pip 只装出 `yt-dlp.cmd`，Node 不解析 PATHEXT），详见 `ytCommandCandidates`。
    const ycmd = await resolveYtCommand();
    if (!ycmd) {
        return {
            err: '找不到 yt-dlp —— 请先 `pip install -U yt-dlp`（或用 brew / 包管理器安装）',
            raw: '',
        };
    }

    // ══════════════════════════════════════════════════════════════════════
    // 🔴 Cookie 必须落成**文件**走 `--cookies`，⛔ 不能 `--add-header Cookie:`：
    //
    //    读 yt-dlp 源码 `YoutubeDL._load_cookies()` 确认过：`--add-headers Cookie:…`
    //    会走 `autoscope=True` 的**废弃路径**，把 Cookie 收进 `__header_cookies`，
    //    并明确警告「they will be scoped to the domain of the downloaded urls」——
    //    即 Cookie 只按 youtube.com 的域下发，认证链并不可靠。
    //    官方口径就是要 `--cookies <Netscape 文件>`。
    // ══════════════════════════════════════════════════════════════════════
    const args = [
        ...ycmd.pre,
        '-J',
        '--no-warnings',
        '--no-playlist',
        // ⚠️ 带 UA：某些出口 IP 上不带 UA 会被直接判机器人
        '--user-agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(proxy ? ['--proxy', proxy] : []),
    ];
    let cookieFile = '';
    if (cookie) {
        cookieFile = writeCookieFile(cookie, cookieDir);
        if (cookieFile) args.push('--cookies', cookieFile);
    }
    // 🔴 JS 运行时：不指定的话 yt-dlp 只启用 deno（`--help` 原文），本机没有 deno ⇒
    //    `JS runtimes: none` ⇒ YouTube 只下发 storyboard（见 `resolveNodeRuntime` 的事故记录）。
    //    ⚠️ 探不到 Node 时**不传**这个参数（老版本 yt-dlp 不认 `--js-runtimes` 会直接报错，
    //    那样连元数据都拿不到，比慢一点更糟）。
    const jsRuntime = await resolveNodeRuntime();
    if (jsRuntime) args.push('--js-runtimes', jsRuntime);
    args.push(videoUrl);

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const done = (v: { info: unknown; raw: string } | YtStreamFailure): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(v);
        };

        let child: ReturnType<NodeProcess['spawn']>;
        try {
            child = cp.spawn(ycmd.cmd, args, { windowsHide: true });
        } catch {
            // 探测过了还起不来 ⇒ 缓存过期（用户卸了），清掉让下次重新探测
            resetYtCommandCache();
            // ⚠️ Cookie 文件已经落盘了，这条提前返回也必须清掉
            removeCookieFile(cookieDir);
            resolve({ err: 'yt-dlp 启动失败 —— 请确认它还在 PATH 里', raw: '' });
            return;
        }

        // ⚠️ 超时必须真的 kill：yt-dlp 被风控时不会自己退出
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* 已退 */ }
            // 超时路径上 close 未必还会来 ⇒ 这里也要清 Cookie 文件
            removeCookieFile(cookieDir);
            done({ err: 'yt-dlp 超过 60 秒没有返回 —— 检查代理是否可用', raw: stderr });
        }, YT_TIMEOUT_MS);

        child.stdout.on('data', (d) => { stdout += String(d); });
        child.stderr.on('data', (d) => { stderr += String(d); });

        child.on('error', (e: { code?: string; message?: string }) => {
            // ⚠️ 探测阶段能跑、这里却 ENOENT ⇒ 缓存过期（卸了/换了环境），清掉重探
            if (e?.code === 'ENOENT') resetYtCommandCache();
            done({
                err:
                    e?.code === 'ENOENT'
                        ? 'yt-dlp 找不到了 —— 请重新安装（pip install -U yt-dlp）'
                        : `yt-dlp 启动失败：${e?.message ?? ''}`,
                raw: String(e?.message ?? ''),
            });
        });

        child.on('close', (code: number) => {
            // ⚠️ 取流完立刻删 Cookie 文件：留盘上就是一份账号凭据
            removeCookieFile(cookieDir);
            if (code !== 0) {
                // 🔴 老版本 yt-dlp（大约 2023.07 之前）不认识 `--js-runtimes`，会以
                //    「no such option」整体失败 —— 那样连元数据都拿不到，必须退回不带该参数再跑。
                //    ⚠️ 用 `jsRuntimeUnsupported` 记住这件事再重试，**不重置**缓存：
                //    重置会让 `resolveNodeRuntime()` 又探到 node，从而无限套娃（见该标志的注释）。
                if (jsRuntime && !jsRuntimeUnsupported && UNSAFE_JS_RUNTIME_OPT.test(stderr)) {
                    jsRuntimeUnsupported = true;
                    // ⚠️ 必须掐掉本轮的超时定时器：它到点会 `removeCookieFile(cookieDir)`，
                    //    而重试那一轮正要往同一路径写 Cookie 文件 —— 不掐就等于自杀。
                    clearTimeout(timer);
                    void fetchYtInfo(videoUrl, proxy, cookie, cookieDir).then(done);
                    return;
                }
                done({ err: ytErrorMessage(stderr), raw: stderr });
                return;
            }
            let info: unknown;
            try {
                // ⚠️ 剥 BOM：Windows 下若经 PowerShell 中转，输出可能带 BOM
                info = JSON.parse(stdout.replace(/^\uFEFF/, ''));
            } catch {
                done({ err: 'yt-dlp 输出不是合法 JSON（可能被风控返回了 HTML）', raw: stderr || stdout.slice(0, 500) });
                return;
            }
            done({ info, raw: stderr });
        });
    });
}

/**
 * 判定一个结果是不是失败（`err` 在成功结果里不存在）
 */
export function isYtFailure(v: unknown): v is YtStreamFailure {
    return !!v && typeof v === 'object' && typeof (v as { err?: unknown }).err === 'string';
}

/** 搜索一次最多要几条（YouTube 一页大致这个量级；再多用户也不会看完） */
const YT_SEARCH_LIMIT = 15;
/** 搜索超时：比取流短得多 —— flat 模式只读列表页，不用解格式 */
const YT_SEARCH_TIMEOUT_MS = 45_000;

/**
 * 在 YouTube 上搜视频，返回可直接填进「网络地址」的候选。
 *
 * 🔴 为什么走 `ytsearchN:` 而不是自己打 YouTube 搜索页：
 *    与取流同一条纪律 —— 搜索页的 DOM / 内部接口同样在 Google 手里频繁改，
 *    自己解析就是第二个维护负担。`yt-dlp` 的 `ytsearch` 是它官方支持的用法。
 *
 * 🔴 为什么必须 `--flat-playlist`（不能复用 `fetchYtInfo`）：
 *    `-J` 会对**每一条**候选去解 formats / 字幕表，15 条就是 15 次完整 page 请求，
 *    几十秒起步还可能逐个触发风控。flat 模式只读列表，一次请求就回全部 id + 标题。
 *    ⚠️ 这也是 `YtSearchItem` 里**没有** quality / size 的原因（flat 给不了）。
 *
 * ⚠️ Cookie / 代理 / JS 运行时三件事与 `fetchYtInfo` **必须同口径**：
 *    少了 Cookie 会「搜得到、点进去播不了」；少了 `--js-runtimes` 会拿到空列表
 *    （YouTube 把搜索结果也当 JS 挑战保护对象）。所以这里照抄那三段的意图，
 *    ⛔ 不要为了「搜索嘛简单点」把它们省掉。
 *
 * @param keyword 检索词（空串 ⇒ 直接回错误，⛔ 不发请求）
 * @param proxy 规整后的代理地址（空串 = 直连）
 * @param cookie 浏览器 Cookie 原文（空串 = 匿名）
 * @param cookieDir Cookie 临时文件目录
 */
export async function searchYt(
    keyword: string,
    proxy: string,
    cookie: string,
    cookieDir?: string,
): Promise<{ videos: YtSearchItem[]; error?: string }> {
    const kw = String(keyword ?? '').trim();
    if (!kw) return { videos: [], error: '先填检索词' };

    let cp: NodeProcess;
    try {
        cp = require('child_process') as NodeProcess;
    } catch {
        return { videos: [], error: '当前环境没有 Node 子进程能力（移动端不支持 YouTube 搜索）' };
    }

    const ycmd = await resolveYtCommand();
    if (!ycmd) {
        return { videos: [], error: '找不到 yt-dlp —— 请先 `pip install -U yt-dlp`' };
    }

    // ⚠️ `ytsearch15:` 里的 15 是 **yt-dlp 的提取条目数**，不是「返回 15 条」的保证：
    //    频道过滤 / 会员专属 / 地区受限会让实际条数更少。调用方不要假设固定条数。
    const spec = `ytsearch${YT_SEARCH_LIMIT}:${kw}`;
    const args = [
        ...ycmd.pre,
        '-J',
        '--flat-playlist',
        '--no-warnings',
        '--user-agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(proxy ? ['--proxy', proxy] : []),
    ];
    let cookieFile = '';
    if (cookie) {
        cookieFile = writeCookieFile(cookie, cookieDir);
        if (cookieFile) args.push('--cookies', cookieFile);
    }
    const jsRuntime = await resolveNodeRuntime();
    if (jsRuntime) args.push('--js-runtimes', jsRuntime);
    args.push(spec);

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const done = (v: { videos: YtSearchItem[]; error?: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(v);
        };

        let child: ReturnType<NodeProcess['spawn']>;
        try {
            child = cp.spawn(ycmd.cmd, args, { windowsHide: true });
        } catch {
            resetYtCommandCache();
            removeCookieFile(cookieDir);
            resolve({ videos: [], error: 'yt-dlp 启动失败 —— 请确认它还在 PATH 里' });
            return;
        }

        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* 已退 */ }
            removeCookieFile(cookieDir);
            done({ videos: [], error: 'YouTube 搜索超过 45 秒没有返回 —— 检查代理是否可用' });
        }, YT_SEARCH_TIMEOUT_MS);

        child.stdout.on('data', (d) => { stdout += String(d); });
        child.stderr.on('data', (d) => { stderr += String(d); });

        child.on('error', (e: { code?: string; message?: string }) => {
            if (e?.code === 'ENOENT') resetYtCommandCache();
            done({ videos: [], error: `yt-dlp 启动失败：${e?.message ?? ''}` });
        });

        child.on('close', (code: number) => {
            removeCookieFile(cookieDir);
            if (code !== 0) {
                // ⚠️ 与 `fetchYtInfo` 同一处兼容：老版本不认 `--js-runtimes` 会整体失败。
                //    搜索这层就算不重试也不能套娃 —— 直接复用那个一次性标志并回可读原因。
                if (jsRuntime && !jsRuntimeUnsupported && UNSAFE_JS_RUNTIME_OPT.test(stderr)) {
                    jsRuntimeUnsupported = true;
                }
                done({ videos: [], error: ytErrorMessage(stderr) });
                return;
            }
            let json: unknown;
            try {
                json = JSON.parse(stdout.replace(/^\uFEFF/, ''));
            } catch {
                done({ videos: [], error: 'yt-dlp 搜索输出不是合法 JSON（可能被风控返回了 HTML）' });
                return;
            }
            const videos = parseYtSearch(json);
            if (videos.length === 0) {
                // ⚠️ 「搜到 0 条」和「搜索失败」是两件事，文案必须分开 ——
                //    前者让用户换词，后者让用户修配置。⛔ 别都写成「搜索失败」。
                done({ videos: [], error: 'YouTube 没有搜到结果 —— 换个关键词或填英文原名试试' });
                return;
            }
            done({ videos });
        });
    });
}


/**
 * 设置页「测试连接」：验 **yt-dlp 能不能跑 + 代理通不通 + Cookie 有没有被接受**。
 *
 * 🔴 为什么不复用 `fetchYtInfo` 之外另写一套请求：那是**第二条真源**。
 *    打包后 Obsidian 的 PATH / 代理 / Cookie 落盘方式跟命令行完全不同，
 *    测试连接如果走另一条路，就会出现本仓已经栽过的「测试 ✓ 但播放 ✗」（#589 那类误报）。
 *    ⇒ 这里直接跑一次**真的** `fetchYtInfo`，只是喂一条固定的探测视频。
 *
 * 🔴 为什么探测结果要分三类（这是本函数存在的全部理由）：
 *    ⑴ **成功** —— 拿到了 JSON，说明 yt-dlp + 代理 + Cookie 整条链都通；
 *    ⑵ **内容不可用**（视频下架 / 地区受限 / 会员专属）—— 请求**确实到达了 YouTube**
 *       并拿到明确答复 ⇒ 配置是好的，是探测用的那条片子不行。⛔ 判成「配置错误」会让用户
 *       拿着正确的配置反复乱改；
 *    ⑶ 其余（找不到 yt-dlp / 超时 / 要验证机器人 / 拉不到 JSON）—— 真的要去修配置。
 *
 * @param proxy 规整后的代理地址（空串 = 直连）
 * @param cookie 浏览器 Cookie 原文（空串 = 匿名）
 * @param cookieDir Cookie 临时文件目录
 */
export async function ytTestConnection(
    proxy: string,
    cookie: string,
    cookieDir?: string,
): Promise<{ ok: boolean; message: string }> {
    // 🔴 先单独确认 JS 运行时。缺它时 `fetchYtInfo` 的表现是「JSON 拿到了，但只有 storyboard」，
    //    在测试连接这一层会被判成「✓ 连上了」—— 用户于是拿着一条根本播不出来的配置反复重试。
    //    ⇒ 「连得上」和「播得动」是两件事，两个都要在这里回答。
    const js = await resolveNodeRuntime();
    if (!js) {
        return {
            ok: false,
            message: '找不到可用的 Node 18+ —— YouTube 现在必须靠它解 JS 挑战，否则只给故事板图。请先安装 Node（https://nodejs.org），装好后点一次「测试连接」即可重新探测',
        };
    }

    const got = await fetchYtInfo(YT_PROBE_URL, proxy ?? '', cookie ?? '', cookieDir);

    if (!isYtFailure(got)) {
        // 真的拿到 JSON：连 yt-dlp 带代理带 Cookie 整条链都通了
        return { ok: true, message: `连上了（yt-dlp 可用，Node 运行时 ${js} 就绪，能取到视频信息）` };
    }

    if (ytContentUnavailable(got.raw)) {
        // ⚠️ 文案必须说清「是探测片不行」，否则用户会以为自己的配置坏了
        return { ok: true, message: '连上了（yt-dlp 可用；探测用的那条视频不可用，与你的配置无关）' };
    }

    return { ok: false, message: got.err };
}

/** 「测试连接」用的探测视频：必须是**长期公开**的官方片，⛔ 别用随便找的 UP 主视频（会下架）。 */
const YT_PROBE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
