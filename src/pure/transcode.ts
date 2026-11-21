/**
 * 把「Chromium 解不了的视频」转成「能塞进 `<video>` 的 mp4」——**纯逻辑层**。
 *
 * 🔴 由来（用户 2026-11 拍板「播放侧：让 mkv/HEVC 等也能在插件内播」）：
 *    先前 mkv/avi/ts/wmv 一律被 `isEmbeddableVideoPath` 挡在门外、直接丢给系统播放器，
 *    用户视角是「点了播放，然后 PotPlayer 弹出来了，插件里什么都没有」。
 *    这一层负责算出「这个文件该怎么转」——只产出**参数**，不碰子进程（那在 `services/transcode`）。
 *
 * 🔴 与 2026-11-24 裁定的关系（⛔ 别误读成「又把自取流加回来了」）：
 *    那条裁定删的是 **DASH/MSE/yt-dlp 取流合流**（把 B 站/YouTube 的流拆开再自己拼）。
 *    这里既没有取流、也没有 MSE：源是用户自己网盘/硬盘上的**一整个文件**，
 *    产物是**一整个 mp4 文件**，最后仍然是 `video.src = app://...mp4` 这条最朴素的挂源方式。
 *    ⛔ 不要在实现里引入 MSE / SourceBuffer / 分片下载 —— 那才是被裁掉的东西。
 *
 * 两个阶段（能流复制就绝不重编码 —— 重编码要多花几分钟且掉画质）：
 *   ① **remux**：视频是 h264 ⇒ `-c copy` 换个容器就行（mkv→mp4 约几秒）；
 *   ② **transcode**：视频是 HEVC/AV1/mpeg2 等 ⇒ 必须重编成 h264。
 *      编码器优先试硬件（nvenc/qsv/amf/mf），全失败退 `libx264`。
 *
 * ⚠️ 子进程相关一律在 `services/transcode`，本模块**不碰 fs / child_process**（同 `pure/senseVoice` 的纪律）。
 */

import { parseFfmpegDuration, parseFfmpegOutTime } from 'pure/asrEngine';
import { videoExt } from 'pure/mediaExtensions';

/** Chromium 在 mp4 容器里**真的能解**的视频编码（白名单，⛔ 别用黑名单：新编码只会越来越多）。 */
export const PLAYABLE_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1'] as const;

/** Chromium 在 mp4/mov 容器里能解的音频编码。 */
export const PLAYABLE_AUDIO_CODECS_MP4 = ['aac', 'mp3', 'opus'] as const;

/**
 * Chromium 在 webm/ogv 容器里能解的音频编码。
 *
 * 🔴 音频白名单**必须按容器分**，不能用一份：
 *    `opus` 在 webm 里是原生支持（就是为它设计的），在旧 mp4 里却不行；
 *    `vorbis` 同理只在 webm/ogv 里能用。
 *    只用一份名单的话，「webm + vp9 + opus」这种**本来就能播**的文件会被判成要 remux ——
 *    用户点了播放却先转几十秒，而其实一个字节都不用动。
 */
export const PLAYABLE_AUDIO_CODECS_WEBM = ['opus', 'vorbis'] as const;

/** 重编码时按顺序试的硬件 h264 编码器（NVIDIA / Intel / AMD / Windows 自带）。 */
export const H264_HW_ENCODERS = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf'] as const;

/** 硬件编码器全不可用时的软件兜底（本机 ffmpeg 实测 `--enable-libx264`）。 */
export const H264_ENCODER_FALLBACK = 'libx264';

/** 转码结果放哪儿：系统临时目录下的固定子目录（由 `services/transcode` 保证存在）。 */
export const TRANSCODE_DIR_NAME = 'reelludic-transcode';

/**
 * ffmpeg 探测出来的视频流信息。
 *
 * ⚠️ 字段全部可能为空/0：ffmpeg 只对**它认得的**容器吐这些，认不出就什么都没有。
 *    所以每个消费点都得能容忍「啥也没探到」（那时按「需要转码」处理才安全）。
 */
export interface VideoProbe {
    /** 视频编码（`h264` / `hevc` / `mpeg2video` …，小写；探不到 ⇒ 空串） */
    videoCodec: string;
    /** 音频编码（`aac` / `ac3` / `opus` …，小写；无音轨或探不到 ⇒ 空串） */
    audioCodec: string;
    /** 总时长（秒）；探不到 ⇒ 0 */
    duration: number;
    /** 像素宽高；探不到 ⇒ 0 */
    width: number;
    height: number;
}

/** 这次要做什么：`none` = 原样能播，不碰文件。 */
export type TranscodeMode = 'none' | 'remux' | 'transcode';

/**
 * 从 `ffmpeg -i <file>` 的 stderr 里抠出流信息。
 *
 * 🔴 为什么靠 stderr 而不是 ffprobe：ffprobe **不一定**存在 —— 用户装的是 `ffmpeg.exe` 单文件，
 *    gyan.dev 的 essentials 包才带 ffprobe，很多人拷的只有一个 exe。
 *    而 `ffmpeg -i` 无论有没有输出文件都会先打一遍流信息，正好白拿。
 *
 * ⚠️ 输出长这样（注意流编号与编码名之间的括号/空格都可能是变体）：
 *      `  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], ...`
 *      `  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s`
 *    ⛔ 别用 `#0:0` 定位视频流 —— 有些文件的视频不在第 0 条（多音轨 mkv 常见）。
 *    只按「`Video:` / `Audio:` 出现顺序」取第一条，与 `-map 0:v:0` 同口径。
 */
export function parseFfmpegProbe(stderr: string): VideoProbe {
    const text = String(stderr ?? '');
    const video = /Stream\s+#\S+?:\s*Video:\s*([A-Za-z0-9_]+)/i.exec(text);
    const audio = /Stream\s+#\S+?:\s*Audio:\s*([A-Za-z0-9_]+)/i.exec(text);
    const dim = /,\s*(\d{2,5})x(\d{2,5})[\s,\[]/.exec(text);
    // 时长用既有解析器（`Duration: 00:01:23.45`），⛔ 别在这里再写一份正则
    let duration = 0;
    for (const line of text.split(/\r?\n/)) {
        const d = parseFfmpegDuration(line);
        if (d) {
            duration = d;
            break;
        }
    }
    return {
        videoCodec: video ? video[1].toLowerCase() : '',
        audioCodec: audio ? audio[1].toLowerCase() : '',
        duration,
        width: dim ? parseInt(dim[1], 10) || 0 : 0,
        height: dim ? parseInt(dim[2], 10) || 0 : 0,
    };
}

/** 这个扩展名本来就能直接塞 `<video>` 吗（与 `isEmbeddableVideoPath` 同源，这里只是按扩展名字符串判） */
export function containerIsPlayable(ext: string): boolean {
    return ['mp4', 'webm', 'mov', 'ogv'].includes(String(ext ?? '').toLowerCase());
}

/**
 * 这个音频编码在该容器里能播吗（空编码 = 无音轨 = 天然「能播」）。
 *
 * 🔴 按容器分名单，理由见 `PLAYABLE_AUDIO_CODECS_WEBM` 的注释。
 */
export function audioCodecPlayableIn(ext: string, codec: string): boolean {
    const a = String(codec ?? '').toLowerCase();
    if (!a) return true;
    const e = String(ext ?? '').toLowerCase();
    const list = e === 'webm' || e === 'ogv' ? PLAYABLE_AUDIO_CODECS_WEBM : PLAYABLE_AUDIO_CODECS_MP4;
    return list.includes(a as never);
}

/**
 * 定方案：能原样播就不动，能流复制就流复制，否则重编码。
 *
 * 🔴 判据的关键一条：**容器能播 ≠ 编码能播**。`movie.mp4` 里装着 HEVC 时
 *    Chromium 照样黑屏（有声音、画面全黑），所以探到非白名单编码必须转码，
 *    ⛔ 不能因为扩展名是 `.mp4` 就放行。
 *
 * ⚠️ 探不到编码（`videoCodec === ''`）时按 **transcode** 处理而不是 remux：
 *    流复制一个「不知道为什么播不了」的文件，产出来照样播不了，白等几十秒。
 *    重编码虽然慢，但它是唯一保证能播的选项。
 */
export function planTranscode(probe: VideoProbe, sourceExt: string, opts: { forceTranscode?: boolean } = {}): TranscodeMode {
    const v = String(probe?.videoCodec ?? '').toLowerCase();
    const a = String(probe?.audioCodec ?? '').toLowerCase();
    const vOk = PLAYABLE_VIDEO_CODECS.includes(v as (typeof PLAYABLE_VIDEO_CODECS)[number]);
    const aOk = audioCodecPlayableIn(sourceExt, a);
    if (opts.forceTranscode) return 'transcode';
    // 容器与编码都过关 ⇒ 原样播，一个字节都不动
    if (containerIsPlayable(sourceExt) && vOk && aOk) return 'none';
    // 视频能复制（h264/vp9…）⇒ 换壳即可；音频不认时只重编音频（`buildRemuxArgs` 负责分流）。
    // 🔴 千万别因为「音频是 ac3」就整条重编码视频 —— 那是几十分钟 vs 几秒的差别。
    if (vOk) return 'remux';
    return 'transcode';
}

/** 探测参数：`-i` 完就 `-f null -`，不产出文件、只让它把流信息打出来 */
export function buildProbeArgs(input: string): string[] {
    return [
        '-hide_banner',
        // 🔴 必须 `info`：`error` 级别连 `Stream #0:0: Video:` 都不打，探出来全是空
        '-loglevel',
        'info',
        '-i',
        String(input ?? '').trim(),
        // 不给输出就没有转码动作，ffmpeg 打完流信息后以「输出文件未指定」退出 —— 这是**预期**的
        '-f',
        'null',
        '-',
    ];
}

/**
 * 流复制（mkv→mp4）。约几秒，画质无损。
 *
 * 🔴 `-map 0:v:0 -map 0:a:0?` 这两条是**必须**的，否则 mkv 里那几条字幕/附件轨
 *    会一起被塞进 mp4 —— mp4 不支持 PGS/ASS 字幕，muxer 直接报
 *    「Subtitle codec 94213 is not supported」把整次转换搞砸。
 *    问号（`0:a:0?`）= 「没有音轨也别失败」（默片/纯音乐视频走这条路）。
 * 🔴 `-sn -dn` 双保险：显式丢掉字幕与数据轨。
 * 🔴 `-movflags +faststart`：把 moov 挪到文件头，否则边下边播要等整文件读完才能起播。
 */
export function buildRemuxArgs(input: string, output: string, probe?: VideoProbe): string[] {
    const a = String(probe?.audioCodec ?? '').toLowerCase();
    // 🔴 音频不认（ac3/dts/flac）时**只重编音频**、视频照样 `copy`：
    //    mp4 里 ac3 是能装的，但 Chromium 解不了 ⇒ 有画面没声音，用户以为文件坏了。
    //    这一档比整条重编码快两个数量级，所以绝不因为音频就升级成 transcode。
    // 🔴 判据必须按**输出容器**（恒为 mp4）算，⛔ 不能按源容器 —— 源是 mkv/webm 时
    //    拿 webm 的音频白名单去判会得出「opus 能直接复制进 mp4」的错觉。
    const audioOk = audioCodecPlayableIn('mp4', a);
    const audioArgs = audioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
    return [
        '-hide_banner',
        '-loglevel',
        'info',
        '-y',
        '-progress',
        'pipe:2',
        '-nostats',
        '-i',
        String(input ?? '').trim(),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-sn',
        '-dn',
        '-c:v',
        'copy',
        ...audioArgs,
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        String(output ?? '').trim(),
    ];
}

/** 某个硬件编码器对应的画质参数（各家选项名完全不同，⛔ 别共用一套）。 */
export function encoderQualityArgs(encoder: string): string[] {
    switch (String(encoder ?? '')) {
        case 'h264_nvenc':
            // p4 ≈ 中等档；cq 是「恒定质量」，比固定码率更适合本地归档
            return ['-preset', 'p4', '-rc', 'vbr', '-cq', '21'];
        case 'h264_qsv':
            return ['-global_quality', '22'];
        case 'h264_amf':
            return ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22'];
        case 'h264_mf':
            return ['-rate_control', 'quality'];
        case H264_ENCODER_FALLBACK:
        default:
            // veryfast：本地播放够看，且比 medium 快一倍以上
            return ['-preset', 'veryfast', '-crf', '20'];
    }
}

/**
 * 重编码成 h264 + aac 的 mp4。
 *
 * ⚠️ `-pix_fmt yuv420p` 不是可选项：10bit（`yuv420p10le`）或 4:4:4 的源转出来
 *    Chromium 依然播不了，而 ffmpeg 会**默默**沿用源的像素格式 ⇒ 必须显式压平。
 * ⚠️ `-vf scale=...` 只在超大分辨率时加（见 `downscaleFilter`），否则保持原尺寸。
 */
export function buildTranscodeArgs(input: string, output: string, encoder: string, probe: VideoProbe): string[] {
    const args = [
        '-hide_banner',
        '-loglevel',
        'info',
        '-y',
        '-progress',
        'pipe:2',
        '-nostats',
        '-i',
        String(input ?? '').trim(),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-sn',
        '-dn',
        '-c:v',
        String(encoder || H264_ENCODER_FALLBACK),
        ...encoderQualityArgs(encoder),
        '-pix_fmt',
        'yuv420p',
    ];
    // 8K 以上的源重编码会久到离谱，而且本地播放根本看不出差别 ⇒ 缩到 4K 以内
    const scale = downscaleFilter(probe);
    if (scale) args.push('-vf', scale);
    args.push(
        // 音频统一 aac：ac3/dts/flac 在 mp4 里 Chromium 多半解不了（有画面没声音）
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        String(output ?? '').trim(),
    );
    return args;
}

/** 需要缩到 4K 以内就返回 `scale` 表达式，否则空串 */
export function downscaleFilter(probe: VideoProbe): string {
    const w = Number(probe?.width) || 0;
    const h = Number(probe?.height) || 0;
    if (!w || !h) return '';
    const MAX_W = 3840;
    const MAX_H = 2160;
    if (w <= MAX_W && h <= MAX_H) return '';
    // `-2` 保证宽高都能被 2 整除（h264 要求偶数），同时保持比例
    return w >= h ? `scale=${MAX_W}:-2` : `scale=-2:${MAX_H}`;
}

/**
 * 转码产物的稳定文件名。
 *
 * 🔴 为什么要 hash：同一个网盘文件可能被反复点开，光靠源文件名会撞车
 *    （不同目录都有 `01.mkv`）；而带上完整路径又会超长 / 带非法字符。
 *    FNV-1a 32 位 + 扩展名足够，碰撞概率在这里可忽略。
 * ⚠️ 结果**不含目录**，调用方自己去拼 `TRANSCODE_DIR_NAME`。
 */
export function transcodeFileName(sourceKey: string): string {
    const s = String(sourceKey ?? '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        // FNV 素数的 32 位乘法（用移位加避免 BigInt）
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return `tc-${h.toString(16).padStart(8, '0')}.mp4`;
}

/**
 * 这个源需要走转码这条路吗（给 UI/快门用的一眼判据）。
 *
 * 与 `isEmbeddableVideoPath` 的区别：那个只认「本来就能播」的四种扩展名，
 * 这个认「**本来播不了、但转一下就能播**」的其余视频扩展名。
 */
export function isTranscodableSource(path: string): boolean {
    const ext = videoExt(path);
    if (!ext) return false;
    if (containerIsPlayable(ext)) return false;
    // 与 `VIDEO_ASSOCIABLE_EXTENSIONS` 同口径（mkv/avi/flv/wmv/m4v/ts 都在里面）
    return ['mkv', 'avi', 'flv', 'wmv', 'm4v', 'ts', 'mpg', 'mpeg', 'mov', 'rmvb', '3gp'].includes(ext);
}

/** 从 ffmpeg 的 `-progress` 块取已处理秒数（复用 asrEngine 的解析，⛔ 别写第二份） */
export function parseTranscodeOutTime(line: string): number | null {
    return parseFfmpegOutTime(line);
}

/** 百分比（0~100）；分母未知时返回 `null`（调用方继续画跑马灯，⛔ 别拿 0 当分母） */
export function transcodePercent(seconds: number, total: number): number | null {
    if (!Number.isFinite(total) || total <= 0) return null;
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.max(0, Math.min(100, (seconds / total) * 100));
}
