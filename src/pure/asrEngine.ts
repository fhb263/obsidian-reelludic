/**
 * 本地音频转文字（ASR）的**纯逻辑层**：可执行名候选、命令行参数、进度解析、产物路径。
 *
 * 🔴 为什么单独一个模块（而不是全塞进 `services/`）：
 *    `main.js` 已用掉 **95.7%**（距用户定的 5MB 上限只剩 214KB），所以这一期刻意**不引入任何
 *    推理运行时**（onnxruntime / transformers.js 随便一个都几十 MB）。路线是「**用户自装**
 *    whisper.cpp + ffmpeg，插件只负责起子进程、递参数、读进度、收产物」——
 *    与仓里既有的 yt-dlp 同一条路（`pure/ytdlp` + `services/ytdlp`），
 *    ⛔ 不要在插件里下载或嵌入二进制。
 *
 * ⚠️ 与 `pure/ytdlp` 的分工：那边管「取流/下载音频」，这边只管「把音频转成字幕」。
 *    两者都靠外部可执行文件，但候选名、参数、进度格式**完全不同**，⛔ 别试图合并成一个通用跑器：
 *    yt-dlp 的进度是 `[download] 12.1%`，whisper.cpp 的是 `progress = 12%`，
 *    合并后每一个分支都要判「现在是哪个程序在说话」，反而更长。
 */

/** 用户自装的 whisper.cpp 可执行文件在 PATH 里的候选名（按顺序试）。 */
export const ASR_EXE_CANDIDATES_WIN = ['whisper-cli.exe', 'main.exe', 'whisper.exe', 'whisper-cpp.exe'] as const;
export const ASR_EXE_CANDIDATES_POSIX = ['whisper-cli', 'main', 'whisper', 'whisper-cpp'] as const;

/** ffmpeg 可执行名候选（whisper.cpp 只吃 16kHz 单声道 wav，必须抽轨）。 */
export const FFMPEG_EXE_CANDIDATES_WIN = ['ffmpeg.exe', 'ffmpeg'] as const;
export const FFMPEG_EXE_CANDIDATES_POSIX = ['ffmpeg'] as const;

/** whisper.cpp 要求输入是 16kHz 单声道 PCM wav —— 这三个参数一个都不能少。 */
export const ASR_SAMPLE_RATE = 16000;
export const ASR_CHANNELS = 1;

/**
 * 去空白 + **剥掉首尾成对引号**。
 * 🔴 用户从资源管理器「复制为路径」带引号是常态（`"C:\…\whisper-cli.exe"`），
 *    不剥就是 `spawn('"C:\…"')`：找不到文件、且报错一个字都不提是引号的问题。
 * ⚠️ 与 `pure/ytdlp.sanitizeYtDlpExe` 是同一套规则，但**不互相 import**：
 *    那两个模块服务于两条互不相干的链路，谁都不该因为对方改名而动弹。
 */
export function sanitizeExePath(raw: string | undefined): string {
    let s = String(raw ?? '').trim();
    if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

/**
 * 该拿哪些可执行名去试（按顺序）。
 * 🔴 为什么不是一个名字：whisper.cpp **改过二进制名** —— 老版本编译出来是 `main`，
 *    新版本是 `whisper-cli`；Windows 上还有第三方预编译包叫 `whisper.exe`。
 *    只认一个名字会让相当一部分用户「明明装了却说没找到」（最难排查的一类问题）。
 * ⚠️ 用户填了路径就**只试那一个**：此时他明确指定了文件，再退回候选名等于绕过他的配置。
 */
export function asrExeCandidates(raw: string | undefined, platform: string): string[] {
    const custom = sanitizeExePath(raw);
    if (custom) return [custom];
    return platform === 'win32' ? [...ASR_EXE_CANDIDATES_WIN] : [...ASR_EXE_CANDIDATES_POSIX];
}

/** ffmpeg 候选（同理，用户填了就用他填的）。 */
export function ffmpegExeCandidates(raw: string | undefined, platform: string): string[] {
    const custom = sanitizeExePath(raw);
    if (custom) return [custom];
    return platform === 'win32' ? [...FFMPEG_EXE_CANDIDATES_WIN] : [...FFMPEG_EXE_CANDIDATES_POSIX];
}

/**
 * ffmpeg 抽音轨的参数。
 *
 * 🔴 `-vn`（丢掉视频流）、`-ar 16000`、`-ac 1`、`-c:a pcm_s16le` 是 whisper.cpp 的**硬要求**：
 *    采样率不是 16k 它会在读 wav 头时直接失败，且错误信息只说「failed to read audio」，
 *    完全不提采样率 ⇒ 少了 `-ar` 的用户会以为插件坏了。
 * ⚠️ `-y` 必须有：同名 wav 已存在（上一次转写残留）时不加 `-y` 会卡在交互式覆盖询问上，
 *    子进程永远不退出、进度条永远停在 0。
 * ⚠️ 输入放最后（与 yt-dlp 参数表同款习惯）：便于断言，也免得有人把路径当选项解析。
 */
export function buildExtractArgs(input: string, outputWav: string): string[] {
    return [
        '-hide_banner',
        // 🔴 用户 m06361：「怎么没有百分比进度条提示啊」。原先这里是 `-loglevel error`，
        //    它连 `Duration:` 都吞掉 ⇒ 拿不到总时长就算不出百分比，抽轨那几十秒只能画跑马灯。
        //    改 `info` 才能同时拿到总时长（`  Duration: 00:00:13.82`）与 `-progress` 的
        //    `out_time_us`；⚠️ 不改回 `error`，否则进度立刻退回「永远转圈」。
        '-loglevel',
        'info',
        '-y',
        // 🔴 让 ffmpeg 把机器可读的进度按块打到 stderr：本机实测每块含
        //    `out_time_us=13815563` / `progress=end`。`-nostats` 关掉那行人类可读的
        //    `size= 432KiB time=...`（它只在结束时打一次，对进度没有用）。
        '-progress',
        'pipe:2',
        '-nostats',
        '-i',
        String(input ?? '').trim(),
        '-vn',
        '-ar',
        String(ASR_SAMPLE_RATE),
        '-ac',
        String(ASR_CHANNELS),
        '-c:a',
        'pcm_s16le',
        String(outputWav ?? '').trim(),
    ];
}

/**
 * 从 ffmpeg 的 `Duration:` 行取总时长（秒）；不是那一行 ⇒ `null`。
 *
 * 🔴 百分比的分母只能从这儿来：`-progress` 只给「已经处理到第几秒」，不给总长。
 * ⚠️ 认 `Duration: 00:00:13.82` / `Duration: 01:23:45.67` 两种宽度；`N/A` 之类返回 `null`
 *    （流式输入没有时长，那时就该继续画跑马灯，⛔ 别拿 0 当分母）。
 */
export function parseFfmpegDuration(line: string): number | null {
    const s = String(line ?? '');
    const m = /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(s);
    if (!m) return null;
    const total = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (!Number.isFinite(total) || total <= 0) return null;
    return total;
}

/**
 * 从 `-progress` 的 `out_time_us=<微秒>` 行取已处理秒数；不是那一行 ⇒ `null`。
 *
 * ⚠️ ffmpeg 的 `out_time_ms` **实际也是微秒**（历史命名错误，官方至今没改），
 *    所以两个键都按 1e6 换算；⛔ 别对 `out_time_ms` 除以 1000。
 * ⚠️ `out_time_us=N/A` 时返回 `null`（刚开跑那一块常见），调用方保持不定态。
 */
export function parseFfmpegOutTime(line: string): number | null {
    const s = String(line ?? '');
    const m = /^\s*out_time_(?:us|ms)=(\d+)\s*$/.exec(s);
    if (!m) return null;
    const us = Number(m[1]);
    if (!Number.isFinite(us) || us < 0) return null;
    return us / 1e6;
}

/**
 * whisper 每识别出一句就打一行字幕：`[00:00:00.000 --> 00:00:07.920]   文本`。
 *
 * 🔴 用户 m09995：「转录中还是只有个进度条百分比都不知道转录到哪句时间戳了」
 *    ⇒ 这一行里**三个字段全有用**：起止时间是「到哪句」、文本是「在识别什么」。
 *    此前的 `parseAsrSegmentEnd` 只抠出结束秒数算百分比，把另外两样直接丢了。
 */
export interface AsrSegment {
    /** 起始秒 */
    start: number;
    /** 结束秒 */
    end: number;
    /** 该句正文（已去首尾空白，可能为空串） */
    text: string;
}

/**
 * 解析一行 whisper 字幕输出；不是字幕行 ⇒ `null`。
 *
 * ⚠️ 逗号小数（`00:00:07,920`）也算：不同版本/不同 `-osrt` 分支见过两种写法。
 * ⚠️ 正文可能为空（纯标点行、或版本差异导致只打时间轴），此时 `text === ''` —— 调用方
 *    要能接受「有时间没文本」，⛔ 不能因此判定整行无效（那样进度会卡住不动）。
 */
export function parseAsrSegment(line: string): AsrSegment | null {
    const s = String(line ?? '');
    const m = /\[\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*\](.*)$/.exec(s);
    if (!m) return null;
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= 0) return null;
    return { start, end, text: String(m[9] ?? '').trim() };
}

/**
 * 从 whisper 打印的字幕行取**结束**秒数（进度用）。
 *
 * 🔴 这是本仓唯一能拿到**平滑进度**的来源：本机实测 `-pp` 的
 *    `whisper_print_progress_callback: progress = 100%` 全程只在最后打一次
 *    （13.8s 音频 16.5s 跑完，中间一次都没有），而字幕行是**每识别出一句就打一行**。
 *    所以百分比 = 最后一句的结束时间 ÷ 音频总长。
 */
export function parseAsrSegmentEnd(line: string): number | null {
    return parseAsrSegment(line)?.end ?? null;
}

/**
 * 秒 → `m:ss` / `h:mm:ss`（给人看的时钟串）。
 *
 * ⚠️ 不做「四舍五入到整秒」之外的花样：转写进度显示到秒就够，多给一位小数反而在
 *    跳动的数字里糊成一团。负数与 NaN 一律收敛成 `0:00`，⛔ 不抛错。
 */
export function formatClock(sec: number): string {
    const raw = Number(sec);
    const total = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
}

/**
 * 「刚识别完哪一句」的一句话说明（进度细节，⛔ 不是百分比文案）。
 *
 * 🔴 用户 m09995 要的就是这个：看得出**转录到哪句时间戳**。
 * 输出形如 `0:12 → 0:19`；给了总长时补成 `0:12 → 0:19 / 3:40`，
 * 让用户一眼知道「进度条走到 45% 时对应的是片子的哪一段」。
 *
 * ⚠️ 句末正文不往这里塞：字幕正文可能很长（含中英文混排），塞进 `data-tip` 会把提示
 *    撑成一大段；正文只在需要的地方（如实况横幅）单独取用。
 */
export function segmentDetail(seg: AsrSegment, totalSec?: number | null): string {
    const head = `${formatClock(seg.start)} → ${formatClock(seg.end)}`;
    const total = Number(totalSec);
    if (!Number.isFinite(total) || total <= 0) return head;
    return `${head} / ${formatClock(total)}`;
}

/**
 * 把百分比拼进给人看的文案。
 *
 * 🔴 用户 m06361 的原话是「没有百分比进度条**提示**」—— 原先条宽会动，但文案恒为
 *    「正在本地识别…」，用户拿不到任何数字，等于「看不见进度」。这里统一成
 *    `正在本地识别 45%`（⛔ 不要 `45%…`，数字后面接省略号读起来像「还没算好」）。
 * ⚠️ `percent === null` ⇒ 原样返回（不定态就该只显示阶段文案）。
 */
export function withPercentLabel(label: string, percent: number | null): string {
    const base = String(label ?? '').replace(/[…\.]{1,3}$/, '').trim();
    if (percent === null || !Number.isFinite(percent)) return base;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    return `${base} ${pct}%`;
}

/** 用户点了「停止转写」时的统一结果文案。 */
export const ASR_CANCELLED_MESSAGE = '已停止转写';

/** 转写语言的允许值（whisper.cpp 的 `-l`）；非法值一律回落 `auto`。 */
export function normalizeAsrLang(raw: string | undefined): string {
    const s = String(raw ?? '').trim().toLowerCase();
    // `auto` 之外只放行 2..3 位字母的语言码（en / zh / ja / yue…）
    if (s === 'auto') return 'auto';
    if (/^[a-z]{2,3}$/.test(s)) return s;
    return 'auto';
}

/**
 * whisper.cpp 转写的参数。
 *
 * 🔴 `-osrt` 让**它自己写 SRT**，我们不拼字幕文本 —— 这一步省掉的正是最容易出错的一段
 *    （时间轴格式、序号、换行），而它的输出已经被 `pure/subtitleCues.parseSubtitleText` 认。
 * ⚠️ `-of` 给的是**不带扩展名的基名**，whisper.cpp 会自己加 `.srt`。
 * ⚠️ `-pp` 打开进度输出 —— 没有它 stderr 全程安静，悬浮进度球就永远停在「0%」，
 *    用户会以为卡死（这正是需求里「转写需要几分钟」那个场景）。
 */
export function buildAsrArgs(opts: {
    model: string;
    wav: string;
    outBase: string;
    lang?: string;
    threads?: number;
}): string[] {
    const args = ['-m', String(opts.model ?? '').trim(), '-f', String(opts.wav ?? '').trim(), '-osrt', '-of', String(opts.outBase ?? '').trim(), '-pp'];
    const lang = normalizeAsrLang(opts.lang);
    // `auto` 交给它自己判（显式写 `-l auto` 比省略更清楚，且新版对省略的处理不一致）
    args.push('-l', lang);
    const t = Math.floor(Number(opts.threads));
    if (Number.isFinite(t) && t > 0) args.push('-t', String(Math.min(64, t)));
    return args;
}

/**
 * 从一行输出里取进度百分比；不是进度行 ⇒ `null`。
 *
 * 🔴 认三种真实出现过的形态（whisper.cpp 各版本输出不一致，只认一种就会「进度条不动」）：
 *    · `whisper_print_progress_callback: progress = 12%`
 *    · `progress =  12%`（多余空格）
 *    · `[00:00:01.000 --> 00:00:03.000]` —— ⛔ 这不是进度，必须**不**被误认（见下面测试）
 * ⚠️ 只认带 `progress` 字样的行：单纯抓 `\d+%` 会把模型路径、片段文本里的百分比一起抓进来。
 */
export function parseAsrPercent(line: string): number | null {
    const s = String(line ?? '');
    if (!/progress/i.test(s)) return null;
    const m = /progress\s*=\s*(\d{1,3})\s*%/i.exec(s);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 把一行输出翻成阶段文案（⛔ 不给百分比 —— 那是 `parseAsrPercent` 的活）。
 * 认不出来 ⇒ `null`（调用方保持上一句文案，⛔ 别刷成空串）。
 */
export function asrStageLabel(line: string): string | null {
    const s = String(line ?? '').trim();
    if (!s) return null;
    if (parseAsrPercent(s) !== null) return null;
    // 🔴 错误判断必须**排在最开头**：`error: failed to load model` 里含有 "load model"，
    //    排在下面那条规则之后就会被误判成「正在加载识别模型…」—— 用户看到的是
    //    进度条欢快地转、然后任务失败，最难排查的一类（单测实测抓到过）。
    if (/error|failed/i.test(s)) return null;
    if (/load(ed)?\s+model|whisper_init|loading model/i.test(s)) return '正在加载识别模型…';
    if (/system_info|n_threads|compute buffer/i.test(s)) return '正在准备识别环境…';
    if (/^\s*\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(s)) return '正在逐句识别…';
    return null;
}

/**
 * 中间产物 wav 的路径：与视频同目录、同名、`.asr.wav` 后缀。
 * 🔴 为什么带 `.asr`：同目录下用户自己的 `视频名.wav` 可能就存在（音轨原文件），
 *    直接用同名 `.wav` 会**覆盖用户的文件**。加一段固定标记，冲突面就没了。
 */
export function asrWavPathFor(videoPath: string): string {
    const p = String(videoPath ?? '').trim();
    if (!p) return '';
    const dot = p.lastIndexOf('.');
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const base = dot > slash ? p.slice(0, dot) : p;
    return `${base}.asr.wav`;
}

/**
 * 最终字幕路径：与视频同目录、同名、`.srt`。
 * 🔴 用户需求原话：「转写完的 .srt 字幕文件，用户不需要选『存在哪』，直接自动存在视频同一个
 *    文件夹里」⇒ 这里**只算路径、不问用户**。
 * ⚠️ 视频自身就是 `.srt` 以外的任何扩展名都适用；没有扩展名时直接拼 `.srt`。
 */
export function asrSrtPathFor(videoPath: string): string {
    const p = String(videoPath ?? '').trim();
    if (!p) return '';
    const dot = p.lastIndexOf('.');
    const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const base = dot > slash ? p.slice(0, dot) : p;
    return `${base}.srt`;
}

/**
 * 从 stderr 里挑一句「能给人看」的错误。
 *
 * 🔴 子进程失败时 stderr 可能有几十行（模型加载日志、警告、最后才是真错），
 *    整段抛给用户等于没说。取**最后一行非空**：whisper.cpp / ffmpeg 都把真错放最后。
 * ⚠️ 上限 300 字符：更长的多半是刷屏日志，塞进 `Notice` 会糊满屏。
 */
export function lastErrorLine(stderr: string, fallback: string): string {
    const lines = String(stderr ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    if (lines.length === 0) return fallback;
    const last = lines[lines.length - 1];
    return last.length > 300 ? `${last.slice(0, 300)}…` : last;
}

/**
 * 找不到可执行文件时给用户的话。
 * 🔴 必须**同时说清三件事**：缺的是什么、去哪儿装、装完要不要重启 ——
 *    只说「未找到 whisper」的用户会卡在这里（本仓 yt-dlp 那条文案是同一套口径）。
 */
export function asrNotFoundMessage(exeName: string): string {
    return `没找到 ${exeName}。请先安装 whisper.cpp（或在其 Release 页下载预编译包），然后在设置里填写可执行文件的完整路径；如果已经装了但还是这个提示，检查路径里的引号是否已去掉。`;
}

/** 找不到 ffmpeg 时的话（抽音轨是转写的前置，缺了必须明说）。 */
export function ffmpegNotFoundMessage(): string {
    return '没找到 ffmpeg。转写需要先把音轨抽成 16kHz 单声道音频，请安装 ffmpeg 并加入系统 PATH，或在设置里填写它的完整路径。';
}

/** 模型文件缺失时的话。 */
export function asrModelMissingMessage(): string {
    return '还没设置识别模型文件（.bin）。whisper.cpp 需要一个 ggml 模型才能转写，请在设置里填写模型文件的完整路径。';
}
