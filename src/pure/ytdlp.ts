/**
 * yt-dlp 运行参数的**纯逻辑**（#496，2026-10-03）—— 无 `obsidian` / 无子进程 / 无 fs，可单测。
 *
 * 用法参照 `trikorka/BestDownloader`（MIT）：设置页填 yt-dlp 可执行文件路径，留空则走系统 PATH。
 * 🔴 与它的一处**刻意差异**：**不留 `--print`**。
 *    `--print <TEMPLATE>` 会**隐式打开 `--quiet`**（实测：带上它之后 stdout 只剩一行文件路径，
 *    `[download]  12.1% of …` 那些进度行**全被吞掉**）⇒ 界面上就只剩一个永远不动的不确定态进度条。
 *    本仓改成「下载完**自己扫临时目录**认文件」：临时目录是这次新建的空目录，产物唯一，扫出来即可。
 *
 * 🔴 参数口径（2026-10-03 用真 yt-dlp 跑通并逐条核对过输出）：
 *   `-f bestaudio/best` + `-x --audio-format mp3` ⇒ 先落 `<title>.m4a`、再由 ffmpeg 转出 `<title>.mp3`，
 *   stdout 依次出现 `[download] Destination:` → `[download] xx.x%` → `[ExtractAudio] Destination:`。
 *   ⚠️ 转 mp3 **需要 ffmpeg**（yt-dlp 会自己找：先 PATH、再它自己所在目录）。
 */
import { AUDIO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';
import { downloadExt } from 'pure/downloadPlan';

/** 音源选择：优先纯音频流，没有就退回最佳自适应流 */
export const YTDLP_FORMAT = 'bestaudio/best';
/** 目标格式（用户 2026-10-03 裁定：转 mp3） */
export const YTDLP_AUDIO_FORMAT = 'mp3';
/**
 * 文件名长度上限（不含扩展名）。B 站标题可以非常长（含全角符号与颜文字），
 * 而 Windows 单段上限 255 **字节**（中文 3 字节/字）⇒ 不截断会出现「建文件失败」这种
 * 与网络毫无关系的报错。落进库时另有 `pure/downloadPlan` 净化，这一条只管**临时文件能建出来**。
 */
export const YTDLP_NAME_MAX_CHARS = 100;

/**
 * 系统 PATH 里的可执行名（配置项留空时的候选，按顺序试）
 * ⚠️ Windows 上 **pip 装出来的 yt-dlp 只有 `.cmd` 启动器、没有 `.exe`**（2026-10-03 实测：
 *    `...\Python314\Scripts\yt-dlp.cmd` 内容 = `python.exe -m yt_dlp %*`）⇒ 候选表里必须带上 `.cmd`，
 *    否则「留空 = 走 PATH」对最常见的安装方式**根本不成立**。
 */
export const YTDLP_DEFAULT_EXE = 'yt-dlp';

/** Windows 上需要**经 shell 起**的启动器扩展名（Node 拒绝直接 spawn 这两类，见 `ytDlpNeedsShell`） */
export const YTDLP_WIN_SHELL_EXTS = ['.cmd', '.bat'] as const;

/**
 * 解析配置项里的 yt-dlp 路径：去空白、**剥掉首尾成对的引号**（用户从资源管理器复制路径时
 * 「复制为路径」带引号是常态）⇒ 不剥就是 `spawn('"C:\…\yt-dlp.exe"')`：找不到文件、无任何解释。
 */
export function sanitizeYtDlpExe(raw: string | undefined): string {
    let s = String(raw ?? '').trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

/**
 * 该用哪些可执行名去试（**按顺序**）。
 * 🔴 为什么留多个候选：
 *  ⑴ 配置留空时只写 `yt-dlp` 在 Windows 上**不保证**能被 `spawn` 解析出 `.exe`（Node 不带 shell 时
 *     不做 PATHEXT 补全的那一半情况）；
 *  ⑵ **pip 装的 yt-dlp 在 Windows 上就只有一个 `.cmd`**（实测）⇒ 少了它，「走 PATH」这条路对
 *     相当一部分用户是死的（而他 `where yt-dlp` 明明是通的 —— 那种「明明装了却说没找到」最难排查）。
 *  ⇒ win32 三个都试：`.exe`（最快、不用 shell）→ `.cmd`（pip 形态）→ 裸名（兜底）。
 */
export function ytdlpExeCandidates(raw: string | undefined, platform: string): string[] {
    const custom = sanitizeYtDlpExe(raw);
    if (custom) return [custom];
    return platform === 'win32'
        ? [`${YTDLP_DEFAULT_EXE}.exe`, `${YTDLP_DEFAULT_EXE}.cmd`, YTDLP_DEFAULT_EXE]
        : [YTDLP_DEFAULT_EXE];
}

/**
 * 这个可执行文件是不是**必须经 shell 起**。
 * 🔴 Node 从 18.20.2 / 20.12.2 / 21.7.3 起（CVE-2024-27980 的修法）**拒绝直接 spawn `.cmd` / `.bat`**
 *    —— 不带 `shell: true` 会直接抛 `EINVAL`，而报错信息里一个字都不提「是扩展名的问题」。
 *    ⚠️ 只有 Windows 需要；`.exe` 与裸名一律不走 shell（少一层 cmd 解析更安全、参数不会被二次解释）。
 */
export function ytDlpNeedsShell(exe: string, platform: string): boolean {
    if (platform !== 'win32') return false;
    const lower = String(exe ?? '')
        .trim()
        .toLowerCase();
    return YTDLP_WIN_SHELL_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * 组装 yt-dlp 参数（顺序固定，便于断言与排查；`url` 恒在最后）。
 *
 * 🔴🔴 **刻意不用 `-o`，改成让调用方设 `cwd`**：
 *  ⑴ 输出目录已经由 `cwd` 定死（临时目录），文件名我们**本来就不看** —— 下载完是扫目录认产物，
 *     再拼一遍 `%(title)s.%(ext)s` 纯属多余；
 *  ⑵ 更要紧的是 **`%` 会撞 shell**：pip 形态的 yt-dlp 必须经 `cmd.exe` 起，而 cmd 会把
 *    一对 `%` 之间的内容当变量展开 ⇒ `%(title)s.%(ext)s` 里的 `%(title)s.` 会被吃掉、模板直接废掉。
 *     参数里**一个 `%` 都不留**，这条坑就不存在了。
 *  ⑶ `--trim-filenames` 保留：默认模板同样会把超长标题拼成文件名，Windows 单段 255 **字节**。
 */
export function buildYtDlpArgs(opts: { url: string }): string[] {
    return [
        '--no-warnings',
        '--newline',
        '--no-playlist',
        '--no-part',
        '-f',
        YTDLP_FORMAT,
        '-x',
        '--audio-format',
        YTDLP_AUDIO_FORMAT,
        '--trim-filenames',
        String(YTDLP_NAME_MAX_CHARS),
        String(opts.url ?? '').trim(),
    ];
}

/** 从一行 stdout 里取下载百分比（`[download]  12.1% of …`）；不是进度行 ⇒ `null` */
export function parseYtDlpPercent(line: string): number | null {
    const m = /^\[download\]\s+([\d.]+)%/.exec(String(line ?? '').trim());
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 把一行 stdout 翻成阶段文案（⛔ 不给百分比 —— 那是 `parseYtDlpPercent` 的活）。
 * 认不出来 ⇒ `null`（调用方保持上一句文案，⛔ 别刷成空串）。
 */
export function ytDlpStageLabel(line: string): string | null {
    const s = String(line ?? '').trim();
    if (s.startsWith('[download] Destination:')) return '正在从 B 站下载音频…';
    if (s.startsWith('[ExtractAudio]')) return '正在转为 mp3…';
    if (s.startsWith('[ffmpeg]')) return '正在转为 mp3…';
    if (s.startsWith('[Merger]')) return '正在合并音频流…';
    return null;
}

/**
 * 从临时目录的文件名里挑出产物。
 * 🔴 优先**目标格式**（`.mp3`）；没有就退回任何在白名单里的音频扩展名
 *   （`-x` 失败但原始 `.m4a` 已经下来时，至少能给出「拿到了什么」而不是一句「没产出」）。
 * 🔴 排序后再取第一个 = **结果与 `readdir` 顺序无关**（否则同一份产物在不同机器上可能选中不同文件）。
 */
export function pickYtDlpOutput(
    files: readonly string[],
    targetExt: string = YTDLP_AUDIO_FORMAT,
    allowed: readonly string[] = AUDIO_ASSOCIABLE_EXTENSIONS,
): string | null {
    const hits = files.filter((f) => allowed.includes(downloadExt(f)));
    if (hits.length === 0) return null;
    const preferred = hits.filter((f) => downloadExt(f) === targetExt);
    const pool = preferred.length > 0 ? preferred : hits;
    return [...pool].sort()[0];
}

/** 取 stderr 里最后一行非空内容（面向用户的细节行）；超长截断 */
export function lastYtDlpErrorLine(stderr: string): string {
    const lines = String(stderr ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const last = lines.length > 0 ? lines[lines.length - 1] : '';
    return last.length > 200 ? `${last.slice(0, 200)}…` : last;
}

/**
 * 失败原因 → 面向用户的一句话。
 * 🔴 判据顺序**有讲究**：ffmpeg 与 412 都要**先于**通用分支判 —— 它们各自的文案能让用户直接动手，
 *    而通用分支只能说「下载失败」。
 */
export function ytDlpFailureMessage(failure: { code: number | null; stderr: string }): string {
    const err = String(failure.stderr ?? '');
    const detail = lastYtDlpErrorLine(err);
    if (/ffmpeg/i.test(err)) {
        return 'yt-dlp 已运行，但转 mp3 需要 ffmpeg：请安装 ffmpeg 并加入系统 PATH，或把它放在 yt-dlp 同目录下';
    }
    if (/\b412\b/.test(err)) return 'B 站返回 412（风控）：稍后重试，或检查网络代理';
    if (/Unable to download webpage|HTTP Error|timed out|Temporary failure|getaddrinfo/i.test(err)) {
        return detail ? `下载失败（网络或接口变更）：${detail}` : '下载失败（网络或接口变更）';
    }
    if (detail) return `下载失败：${detail}`;
    return `下载失败（yt-dlp 退出码 ${failure.code ?? '未知'}）`;
}

/** 没找到 yt-dlp 可执行文件时的文案（把「去哪儿配」直接写出来，⛔ 别让用户自己猜） */
export function ytDlpNotFoundMessage(exe: string): string {
    return `未找到 yt-dlp（${exe}）：请在 设置 → 元数据源配置 › 音乐源凭据 里填写 yt-dlp 可执行文件路径，或把它加入系统 PATH`;
}

/** 进程跑完（退出码 0）但临时目录里没有音频文件 */
export function ytDlpNoOutputMessage(): string {
    return 'yt-dlp 跑完了但没产出音频文件（该视频可能没有音频流）';
}
