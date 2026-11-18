/**
 * Confucius4-R2T2（llama.cpp / `llama-mtmd-cli`）输出解析与时间轴推算（纯逻辑）。
 *
 * 🔴 为什么这家单独一套解析：
 *    Confucius4 是**多模态大模型**（Qwen3-ASR 底座 + 强化学习后训练），
 *    经 `llama-mtmd-cli --audio` 跑出来的 stdout 是**一行纯文本**，格式固定为：
 *
 *        `language English<asr_text>Good morning. This is a test …`
 *
 *    ⇒ ① 语言写在正文前面（可以直接映射回 zh/en，不用另开参数问）；
 *      ② 正文自带标点与大小写（这点比 Paraformer 好，那家全是小写无标点）；
 *      ③ **完全没有时间戳** —— 这是它和 whisper / sherpa 系最大的差别。
 *
 * 🔴 没有时间戳怎么办：大模型流式的「拒绝文字闪烁」优势在插件里用不上
 *    （我们要的是成品 SRT 文件，不是实时预览），所以只能**按字符数比例反推**。
 *    这是估算，不是强制对齐 —— 若将来需要逐字精确，得换成强制对齐模型
 *    （Qwen3-ASR 那条链路才有 Qwen3-ForcedAligner）。
 *    ⚠️ 对整段视频用「均分」会让中英混排的字幕严重错位（中文一个字符的信息量
 *       约等于英文两三个字符），所以用**加权字符数**而不是原始长度。
 */
import type { VadSegment } from 'pure/sherpaVad';

/**
 * llama-mtmd-cli 的输出前缀。
 *
 * 实测两次独立运行都是 `language <Lang><asr_text><正文>`，中间没有空格。
 * ⚠️ 但大模型输出可能带前导空行 / `llama_` 之类的日志行混进 stdout（版本差异），
 *    所以解析要**容错扫描**全文而不是只看第一行。
 */
const ASR_TEXT_TAG = '<asr_text>';
const LANG_RE = /language\s+([A-Za-z][A-Za-z_-]*)/;

/** 一次识别的结果。 */
export interface LlamaAsrOutput {
    /** 模型自报的语言英文名（`English` / `Chinese` / 空字符串） */
    lang: string;
    /** 正文（已去首尾空白） */
    text: string;
}

/**
 * 解析 llama-mtmd-cli 的 stdout。
 *
 * @returns 没找到 `<asr_text>` 标记就返回 null（调用方据此判定这次没出结果，
 *          ⛔ 别拿退出码当判据：实测该 exe 识别成功也可能返回非 0）。
 */
export function parseLlamaAsrOutput(stdout: string): LlamaAsrOutput | null {
    const raw = String(stdout ?? '');
    if (!raw.trim()) return null;
    const at = raw.indexOf(ASR_TEXT_TAG);
    if (at < 0) return null;
    const head = raw.slice(0, at);
    const text = raw.slice(at + ASR_TEXT_TAG.length).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const langMatch = LANG_RE.exec(head);
    return { lang: langMatch ? String(langMatch[1] ?? '').trim() : '', text };
}

/**
 * 模型自报语言 → 插件语言代码。
 *
 * ⚠️ 认不出回空串（**不要**回 'auto' —— 空串表示「模型没说」，
 *    调用方据此保留用户原本选的语言，而不是覆盖成自动）。
 */
export function llamaLangCode(lang: string): string {
    const v = String(lang ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v.startsWith('chin') || v === 'zh' || v === 'mandarin') return 'zh';
    if (v.startsWith('engl') || v === 'en') return 'en';
    if (v.startsWith('japan') || v === 'ja') return 'ja';
    if (v.startsWith('korean') || v === 'ko') return 'ko';
    if (v.startsWith('canton') || v === 'yue') return 'yue';
    return '';
}

/**
 * llama-mtmd-cli 的命令行。
 *
 * 🔴 这几条都是真机踩出来的，⛔ 别删：
 *    · `-m` 与 `--mmproj` **都必填**（少了任何一个 exe 直接拒绝运行）；
 *    · `--no-mmproj-offload` 必须给 —— CPU 版本没有 GPU 可 offload，不给会走一条
 *      会报错的路径；
 *    · `-n` 必须给足：实测 `-n 32/64` 会把四句话截成一句半，`-n 256` 才够
 *      （按 13.8 秒音频的四句话估的；长视频仍可能不够，所以默认给更大值）；
 *    · `--no-warmup` 省掉一次无用的预热推理（CPU 上要好几秒）。
 * ⚠️ `-t` 只影响 CPU 线程数，给 0 或负数会退化成 llama.cpp 的默认值，
 *    所以只在 > 0 时才拼进去。
 * ⚠️ 单文件 `llama-mtmd-cli.exe` 跑不起来 —— 必须带 8 个 dll（见 `asrBundles.LLAMA_RUNTIME_FILES`）。
 *    实测只拷 exe 会**静默失败**（stdout / stderr 全空），非常难查。
 */
export function buildLlamaArgs(opts: {
    model: string;
    mmproj: string;
    wav: string;
    threads?: number;
    /** 输出 token 上限，默认 512 */
    maxTokens?: number;
    /** 提示词，默认 `Transcribe the audio.` */
    prompt?: string;
}): string[] {
    const args: string[] = [
        '-m',
        String(opts.model ?? '').trim(),
        '--mmproj',
        String(opts.mmproj ?? '').trim(),
        '--audio',
        String(opts.wav ?? '').trim(),
        '-p',
        String(opts.prompt ?? LLAMA_ASR_PROMPT),
        '-n',
        String(Math.max(64, Math.trunc(Number(opts.maxTokens ?? LLAMA_MAX_TOKENS) || 0))),
        '--no-mmproj-offload',
        '--no-warmup',
    ];
    const threads = Number(opts.threads ?? 0);
    if (Number.isFinite(threads) && threads > 0) args.push('-t', String(Math.trunc(threads)));
    return args;
}

/** 默认提示词（官方 README 的用法，⛔ 别改成「请转录」之类的自由文本）。 */
export const LLAMA_ASR_PROMPT = 'Transcribe the audio.';

/** 默认输出 token 上限。 */
export const LLAMA_MAX_TOKENS = 512;

/** 单条字幕的加权字符上限。 */
const SEG_WEIGHT_LIMIT = 56;

/** 单条字幕的最短时长（秒）—— 太短的字幕在播放器里根本来不及读。 */
const MIN_SEG_SECONDS = 0.6;

/**
 * 文本 → 带时间的字幕条目（**按比例反推**，因为没有真时间戳）。
 *
 * @param text 识别出的整段正文
 * @param totalSec 音频总时长（读不到就传 0 / null，此时返回单条 0–0 的条目，
 *                 调用方会发现时间轴无效并给出提示）
 * @param maxChars 单条字幕的加权字符上限
 */
export function textToSegments(text: string, totalSec: number | null, maxChars = SEG_WEIGHT_LIMIT): VadSegment[] {
    const body = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!body) return [];
    const limit = Math.max(12, Math.trunc(maxChars));
    const pieces = groupSentences(body, limit);
    const total = totalSec !== null && Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0;

    const weights = pieces.map((p) => weightedLength(p));
    const sum = weights.reduce((n, w) => n + w, 0) || 1;

    const out: VadSegment[] = [];
    let cursor = 0;
    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        if (total <= 0) {
            // 没有总时长就退化：所有条目时间都挂 0，调用方据此判定「时间轴不可用」
            out.push({ start: 0, end: 0, text: piece });
            continue;
        }
        // 按权重分时间，末条吃掉所有舍入误差（否则最后一条永远差几毫秒）
        const share = i + 1 === pieces.length ? total - cursor : (weights[i] / sum) * total;
        const start = cursor;
        let end = Math.min(total, start + share);
        if (end - start < MIN_SEG_SECONDS) end = Math.min(total, start + MIN_SEG_SECONDS);
        if (end <= start) end = start + MIN_SEG_SECONDS;
        out.push({ start, end, text: piece });
        cursor = end;
    }
    return out;
}

/**
 * 加权长度：CJK 字符按 2 算，其余按 1 算。
 *
 * 理由见文件头 —— 中文一个字的信息量约等于英文两三个字母，
 * 直接比 `.length` 会让中英混排的字幕时间轴错位。
 */
function weightedLength(s: string): number {
    let n = 0;
    for (const ch of s) {
        const code = ch.codePointAt(0) ?? 0;
        n += code >= 0x2e80 && code <= 0x9fff ? 2 : 1;
    }
    return Math.max(1, n);
}

/**
 * 按句末标点聚成不超过 `limit`（加权）的若干块。
 *
 * ⚠️ 单个「句子」本身就超长时**按词硬切**而不是按字符硬切 ——
 *    按字符切会把英文单词拦腰截断（`recogni` / `tion`），看起来像识别错误。
 */
function groupSentences(text: string, limit: number): string[] {
    // 句子边界：中英文句末标点；保留标点在句尾
    const sentences = text.match(/[^.!?。！？；;]+[.!?。！？；;]*/g) ?? [text];
    const pieces: string[] = [];
    let buf = '';
    for (const raw of sentences) {
        const s = raw.trim();
        if (!s) continue;
        if (buf && weightedLength(buf) + weightedLength(s) > limit) {
            pieces.push(buf);
            buf = '';
        }
        if (weightedLength(s) > limit) {
            if (buf) {
                pieces.push(buf);
                buf = '';
            }
            for (const part of splitByWords(s, limit)) pieces.push(part);
            continue;
        }
        buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) pieces.push(buf);
    return pieces.length > 0 ? pieces : [text];
}

/** 按词（空格）累积到接近 `limit` 就切；没有空格（纯中文）时退回按字符切。 */
function splitByWords(s: string, limit: number): string[] {
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
        // 纯中文长句：只能按字符切，但尽量切在标点后
        const out: string[] = [];
        let rest = s;
        while (weightedLength(rest) > limit) {
            let cut = '';
            let w = 0;
            for (const ch of rest) {
                w += weightedLength(ch);
                cut += ch;
                if (w >= limit) break;
            }
            if (!cut) break;
            out.push(cut.trim());
            rest = rest.slice(cut.length).trim();
        }
        if (rest.trim()) out.push(rest.trim());
        return out.length > 0 ? out : [s];
    }
    const out: string[] = [];
    let buf = '';
    for (const word of words) {
        const next = buf ? `${buf} ${word}` : word;
        if (buf && weightedLength(next) > limit) {
            out.push(buf);
            buf = word;
            continue;
        }
        buf = next;
    }
    if (buf) out.push(buf);
    return out;
}
