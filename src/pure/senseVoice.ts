/**
 * SenseVoice（sherpa-onnx）原生链路的纯逻辑：参数表、输出解析、token→句级字幕聚合、SRT 拼装。
 *
 * 🔴 为什么要有这个模块（2026-11-06 用户 m11073 报障「明明配置了 SenseVoice 模型显示已就绪
 *    却说没找到运行程序」）：原先 SenseVoice 被发配到 Qwen3 的 Python 桥接 `cli_bridge.py`
 *    里执行，于是出现一个死结 —— 设置页在 SenseVoice 模式下**只给三行路径**（sherpa 程序 /
 *    模型 / 词表），根本没有 Python 与桥接脚本的输入框；而转写入口却无条件先要求 Python。
 *    用户按「一键装好」把三件套装齐、状态栏变绿，一按转写却报「找不到 Python 解释器」。
 *
 * 🔴 关键事实（真机复核）：`sherpa-onnx-offline.exe` 是**静态链接的自足二进制**
 *    （2,035,712 字节，拷到只有它自己的空目录、干净 PATH 下仍能直接跑通识别）。
 *    它根本不需要 Python —— 那一层是 Qwen3 的东西，被顺手借用了。
 *    所以正解不是「补一条判据」，而是**把 SenseVoice 改成插件原生链路**：
 *    Node 里自己起 ffmpeg 抽轨 → 自己起 sherpa → 自己把 tokens/timestamps 聚合成 SRT。
 *
 * ⛔ 本模块只做纯计算（不碰 fs / 不碰 child_process / 不碰 obsidian），
 *    这样才能被 jsdom 与纯单测钉住 —— 那些「句号自成一屏」「末尾少一个时间戳」的坑
 *    都是真机上跑出来的，必须有回归网兜着。
 */

/** sherpa 单段音频的期望时长（秒）。 */
export const SV_SEGMENT_SECONDS = 120;

/** 句级聚合的三条断句阈值（与 Python 那版逐字对齐，⛔ 别凭感觉调）。 */
export const SV_MAX_CHARS = 60;
export const SV_GAP_SECONDS = 0.8;

/** 句末标点：命中即断句。 */
const ENDS_SENTENCE = '.!?。！？…；;';

/** 纯标点判定集合（含中英文逗号顿号连接号等）。 */
const PUNCT_ONLY = '.,!?;:。！？，；：…、·-—';

export interface SenseVoiceJson {
    /** 整段纯文本（只用于日志/兜底，聚合走 tokens） */
    text: string;
    tokens: string[];
    /** 逐 token 的起始秒（⛔ 长度可能与 tokens 差 1，见 `tokensToEntries`） */
    timestamps: number[];
}

export interface SenseVoiceEntry {
    text: string;
    start: number;
    end: number;
}

/**
 * sherpa-onnx-offline 的命令行。
 *
 * 🔴 参数形态来自真机实测（这些 `--xxx=` 等号形式不能改成分隔空格，
 *    sherpa 的 CLI 解析只认等号）：`--tokens=` / `--sense-voice-model=`。
 * ⚠️ `--sense-voice-use-itn=1` 让「二零二六年」这类口述数字变成阿拉伯数字，
 *    对字幕可读性影响很大；⛔ 别因为「怕改坏」而关掉它。
 */
export function buildSenseVoiceArgs(opts: {
    model: string;
    tokens: string;
    /** 语言：auto / zh / en / ja / ko / yue（sherpa 收英文短名） */
    lang?: string;
    threads?: number;
    /** 待识别的 wav 文件（可多个，sherpa 会按顺序逐个处理并各输出一行 JSON） */
    wavs: string[];
}): string[] {
    const args: string[] = [
        `--tokens=${String(opts.tokens ?? '').trim()}`,
        `--sense-voice-model=${String(opts.model ?? '').trim()}`,
        `--sense-voice-language=${svLang(opts.lang)}`,
        '--sense-voice-use-itn=1',
    ];
    const threads = Number(opts.threads ?? 0);
    if (Number.isFinite(threads) && threads > 0) {
        args.push(`--num-threads=${Math.trunc(threads)}`);
    }
    for (const w of opts.wavs ?? []) {
        const p = String(w ?? '').trim();
        if (p) args.push(p);
    }
    return args;
}

/**
 * 把插件里的语言代码翻成 sherpa 认的短名。
 * ⚠️ `auto` 是 sherpa 的原生默认值（自动判别），⛔ 别翻成空串 —— 那会让它报参数错误。
 */
export function svLang(raw: string | undefined): string {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v || v === 'auto') return 'auto';
    if (v.startsWith('zh')) return 'zh';
    if (v.startsWith('en')) return 'en';
    if (v.startsWith('ja')) return 'ja';
    if (v.startsWith('ko')) return 'ko';
    if (v.startsWith('yue')) return 'yue';
    // 认不出就交回自动判别，⛔ 不要原样透传（sherpa 遇到未知语言会直接退出）
    return 'auto';
}

/**
 * 从 sherpa 的输出里抠出一行 JSON。
 *
 * 🔴 两个真机坑（Python 那版已踩过，这里必须同样处理）：
 * ① sherpa 会把**整份 OfflineRecognizerConfig**打到 stderr，那里面含大量 `{}`，
 *    所以只能按行找「行首是 `{` 且能 JSON.parse 成功且含 `tokens` 键」的那一行，
 *    ⛔ 绝不能用大括号配对去找。
 * ② 退出码 1 是 sherpa 的常态（它把识别结果也算作「非零」），⛔ 不能拿退出码当失败判据。
 */
export function parseSenseVoiceJson(line: string): SenseVoiceJson | null {
    const s = String(line ?? '').trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;
    let obj: unknown;
    try {
        obj = JSON.parse(s);
    } catch {
        return null;
    }
    if (!obj || typeof obj !== 'object') return null;
    const rec = obj as Record<string, unknown>;
    const rawTokens = rec['tokens'];
    const rawStamps = rec['timestamps'];
    if (!Array.isArray(rawTokens) || !Array.isArray(rawStamps)) return null;
    const tokens = rawTokens.map((t) => String(t ?? ''));
    // 🔴 只收**本来就是数字**的项：`Number(null)` 是 0 且能通过 `Number.isFinite`，
    //    那样一个缺失时间戳会被当成「第 0 秒」，字幕直接错位到段首。
    //    ⛔ 别为了「容错」把 null/'' 转成 0 —— 宁可丢这一项（后面按较短者截断）。
    const timestamps = rawStamps
        .filter((n) => typeof n === 'number' && Number.isFinite(n))
        .map((n) => n as number);
    if (tokens.length === 0) return null;
    return { text: String(rec['text'] ?? ''), tokens, timestamps };
}

/**
 * 逐 token 的「文本 + 起止秒」。
 *
 * 🔴 真机实测：`tokens` 与 `timestamps` **长度可能差 1**（末尾标点常常没有时间戳），
 *    所以按较短者对齐 —— ⛔ 不能用 tokens 的长度去索引 timestamps，那会取到 undefined
 *    再变成 NaN，最后画出一条 `0:12 → NaN` 的字幕。
 * ⚠️ 末词没有「下一个起点」，按字数估一个不短于 0.25s 的时长（一屏字幕不该零宽）。
 */
export function tokenWords(obj: SenseVoiceJson, offset: number, duration: number): { text: string; start: number; end: number }[] {
    const n = Math.min(obj.tokens.length, obj.timestamps.length);
    if (n <= 0) return [];
    /**
     * 🔴 `duration` 是**该段的相对时长**，而 `start` 是加上 `offset` 之后的**绝对秒**，
     *    所以上限必须是 `offset + duration`。
     *    ⛔ 这里曾写成 `limit = duration`，结果第 2 段起 `start=121 > limit=120`
     *    ⇒ 整段 token 全被丢弃，用户看到的是「只有开头一句有字幕，后面一片空白」。
     */
    const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const limit = dur > 0 ? offset + dur : offset + (obj.timestamps[n - 1] ?? 0) + 1;
    const words: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < n; i++) {
        const raw = obj.tokens[i];
        const start = offset + obj.timestamps[i];
        let end: number;
        if (i + 1 < n) {
            end = offset + obj.timestamps[i + 1];
        } else {
            end = start + Math.max(0.25, 0.08 * Math.max(1, raw.trim().length));
        }
        if (end <= start) end = start + 0.25;
        if (limit > 0 && end > limit) end = limit;
        if (end > start) words.push({ text: raw, start, end: start === end ? start + 0.25 : end });
    }
    return words;
}

/** token 是否「整串都是标点」。 */
function isPunctOnly(text: string): boolean {
    const bare = text.trim();
    if (!bare) return false;
    for (const ch of Array.from(bare)) {
        if (!PUNCT_ONLY.includes(ch)) return false;
    }
    return true;
}

/**
 * 逐 token 聚合成句级字幕条目。
 *
 * 断句三条（任一满足）：句末标点收尾 / 停顿超过 `SV_GAP_SECONDS` / 已攒够 `SV_MAX_CHARS` 字。
 *
 * 🔴 **纯标点 token 不能靠「太长」触发断句**。真机实测：`...line up correctly` 攒满 60 字符
 *    先断了，紧跟的 `.` 于是自成一屏一条字幕。所以 `too_long` 必须排除纯标点。
 * 🔴 但光靠循环里那条判据**挡不住全部情况**（断句发生在句号 token 到来之前），
 *    所以循环后还要做一遍「纯标点条目并回上一条」—— ⛔ 两处都要留，删一个就复发。
 */
export function tokensToEntries(
    words: readonly { text: string; start: number; end: number }[],
    limit: number,
): SenseVoiceEntry[] {
    if (words.length === 0) return [];
    const entries: SenseVoiceEntry[] = [];
    let cur: { text: string; start: number; end: number }[] = [];
    const flush = (atEnd: boolean): void => {
        if (cur.length === 0) return;
        const text = cur.map((w) => w.text).join('').trim();
        const start = cur[0].start;
        let end = Math.max(cur[cur.length - 1].end, start + 0.3);
        if (limit > 0 && end > limit) end = limit;
        if (text && end > start) entries.push({ text, start, end });
        cur = [];
        void atEnd;
    };
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        cur.push(w);
        const bare = w.text.trim();
        const punct = isPunctOnly(bare);
        const gaps = i + 1 < words.length ? words[i + 1].start - w.end : 99;
        const chars = cur.reduce((n, x) => n + x.text.trim().length, 0);
        const tooLong = chars >= SV_MAX_CHARS && !punct;
        const endsSentence = bare.length > 0 && ENDS_SENTENCE.includes(bare[bare.length - 1]);
        if (endsSentence || gaps > SV_GAP_SECONDS || tooLong || i + 1 === words.length) {
            flush(i + 1 === words.length);
        }
    }
    flush(true);
    return mergePunctOnly(entries);
}

/**
 * 把「只有标点」的条目并回上一条。
 *
 * 🔴 真机的实际现象：`...line up correctly` 攒满 60 字符先断句，句号于是自成一屏。
 *    这一遍是最后防线，⛔ 别以为循环里判过就够。
 */
export function mergePunctOnly(entries: readonly SenseVoiceEntry[]): SenseVoiceEntry[] {
    const out: SenseVoiceEntry[] = [];
    for (const e of entries) {
        const prev = out.length > 0 ? out[out.length - 1] : null;
        if (prev && isPunctOnly(e.text)) {
            // 并进上一条：文本接上，结束时间取较大者（⛔ 不能取 e.end —— 标点没有时长可言）
            out[out.length - 1] = {
                text: (prev.text + e.text).trim(),
                start: prev.start,
                end: Math.max(prev.end, e.end),
            };
            continue;
        }
        out.push({ ...e });
    }
    const limit = out.length > 0 ? out[out.length - 1].end : 0;
    void limit;
    return out;
}

/**
 * 引擎把时间轴算到片长之外时收敛回来。
 *
 * 🔴 真机踩过：13.82 秒的音频被算到 22.079 秒，末条字幕永远不消失。
 * ⚠️ 起点就超出总长的整条丢弃；终点夹到总长；夹完 `end <= start` 的给 0.3s 兜底。
 */
export function clampEntries(entries: readonly SenseVoiceEntry[], duration: number): SenseVoiceEntry[] {
    if (!(duration > 0)) return entries.map((e) => ({ ...e }));
    const out: SenseVoiceEntry[] = [];
    for (const e of entries) {
        if (e.start >= duration) continue;
        let end = Math.min(e.end, duration);
        if (end <= e.start) end = Math.min(duration, e.start + 0.3);
        if (end <= e.start) continue;
        out.push({ text: e.text, start: e.start, end });
    }
    return out;
}

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm`。 */
export function srtStamp(sec: number): string {
    const total = Number.isFinite(sec) && sec > 0 ? sec : 0;
    const ms = Math.round(total * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const rest = ms % 1000;
    const pad = (n: number, w: number): string => String(n).padStart(w, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(rest, 3)}`;
}

/**
 * 条目 → SRT 正文。
 * ⚠️ 结尾必须留一个换行（不少播放器按空行切块，末尾没有空行会吞掉最后一条）。
 */
export function entriesToSrt(entries: readonly SenseVoiceEntry[]): string {
    const blocks = entries.map(
        (e, i) => `${i + 1}\n${srtStamp(e.start)} --> ${srtStamp(e.end)}\n${e.text.trim()}\n`,
    );
    return blocks.length > 0 ? `${blocks.join('\n')}\n` : '';
}

/**
 * ffmpeg 切段参数（从抽好的 16k 单声道 wav 切成定长片段）。
 *
 * 🔴 为什么用 ffmpeg 分段而不是把整段喂给 sherpa：SenseVoice 是**短语音**模型，
 *    整段一小时音频喂进去不仅慢，识别质量也明显下降。
 * ⚠️ `-c copy` 对 wav 是可行的（PCM 无需重编码），比重新编码快一个数量级；
 *    但**必须**保证输入已经是目标采样率/声道数，否则切出来的段与偏移对不上。
 * ⚠️ `%04d` 是 ffmpeg 的序列占位符，插件靠文件名顺序判断第几段，⛔ 不能省。
 */
export function buildSegmentArgs(inputWav: string, outPattern: string, segmentSec: number): string[] {
    const step = Number.isFinite(segmentSec) && segmentSec > 0 ? Math.trunc(segmentSec) : SV_SEGMENT_SECONDS;
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        String(inputWav ?? '').trim(),
        '-f',
        'segment',
        '-segment_time',
        String(step),
        '-c',
        'copy',
        String(outPattern ?? '').trim(),
    ];
}

/**
 * 从切好的段文件名里认出段序号。
 *
 * 🔴 真机坑：`-f segment` 生成的 `seg_0007.wav` 是**从 0000 开始**的，
 *    段号 × 段长才是该段的起始偏移；⛔ 别用「第几个文件」的循环下标 ——
 *    中间若有一段被 ffmpeg 跳过，下标与偏移就整体错位，字幕全部错时间。
 */
export function segmentIndexOf(fileName: string): number {
    const m = /(\d+)\.wav$/i.exec(String(fileName ?? ''));
    if (!m) return -1;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : -1;
}

/**
 * 按总时长规划要切几段。
 *
 * 🔴 为什么必须切（不是图省事）：SenseVoice 是**短语音**模型，整段一小时音频喂进去
 *    不仅慢，识别质量也明显下降；Python 那版同样定长切段（`_split_audio_ffmpeg`）。
 * ⚠️ 但切段必须**不依赖 ffmpeg 的 segment 输出顺序**来判断偏移 —— 偏移由
 *    `index * SV_SEGMENT_SECONDS` 算，末段再按总长夹住，这样第几段就是第几段。
 */
export function planSegments(totalSec: number, segmentSec = SV_SEGMENT_SECONDS): { start: number; end: number }[] {
    const step = Number.isFinite(segmentSec) && segmentSec > 0 ? segmentSec : SV_SEGMENT_SECONDS;
    const total = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;
    if (total <= 0) return [{ start: 0, end: 0 }];
    const out: { start: number; end: number }[] = [];
    for (let start = 0; start < total; start += step) {
        out.push({ start, end: Math.min(total, start + step) });
    }
    return out;
}
