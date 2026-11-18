/**
 * sherpa-onnx 的**VAD 分段**输出解析（纯逻辑，不碰 fs）。
 *
 * 🔴 为什么需要这一层（真机实测得出的硬结论）：
 *    `sherpa-onnx-offline.exe` 一次只吃**一整段**音频，输出一行 JSON；
 *    喂 Paraformer 时那个 JSON 的 `timestamps` 是**空数组** —— 只有一整段文字，
 *    没有任何时间信息，切不出字幕条。SenseVoice 那边 timestamps 是有值的，
 *    所以它还能走 `pure/senseVoice` 的 token 聚合；Paraformer 和 X-ASR 都不行。
 *
 *    `sherpa-onnx-vad-with-{offline,online}-asr.exe` 的做法不同：先用 silero-vad
 *    把音频切成语音段，再逐段识别 —— 输出天然带每段的起止时间。这才是能直接写 SRT 的形态。
 *
 * 🔴 两个 exe 的输出格式**不一样**，必须分开解析：
 *    · offline 版：`0.134 -- 0.940:  good morning`（一行一段，冒号后是全文）
 *    · online 版：`vad segment(1:0.134-0.940) results:  Good morning .`
 *                  （段头 + 结果；识别结果可能跨多行，需要在遇到下一个段头时才收口）
 *
 * ⚠️ 两个 exe 都把结果打到 **stderr**，不是 stdout（实测 stdout 全空）。
 *    调用方必须两流都喂。
 * ⚠️ 退出码不可信：offline 版识别成功也返回 **1**（实测）；online 版返回 0。
 *    判据只能是「解析到了多少段」。
 */

/** 一段带时间的识别结果 */
export interface VadSegment {
    start: number;
    end: number;
    text: string;
}

/**
 * offline 版的一行：`0.134 -- 0.940:  good morning`
 *
 * ⚠️ 冒号后面可能有多个空格（实测两个），`\s*` 收掉。
 * ⚠️ 时间可以是 `0.134`（秒，带小数），实测没有超过 3600 的形式出现在这种行里；
 *    但为稳妥起见允许整数部分任意位数。
 */
const OFFLINE_SEG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*--\s*(-?\d+(?:\.\d+)?)\s*:\s*(.*)$/;

/**
 * online 版的段头：`vad segment(1:0.134-0.940) results:  Good morning`
 *
 * 注意分隔符是**连字符**（不是 offline 版的 `--`），且带一个 `序号:` 前缀。
 * `results:` 后面的内容可能是空的（短段），真正的文字在后续行里。
 */
const ONLINE_HEAD_RE = /^\s*vad segment\(\d+\s*:\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\)\s*results\s*:\s*(.*)$/;

/**
 * 解析 offline 版的一行输出。
 *
 * @returns 命中返回一段；不命中返回 `null`（调用方必须忽略 —— 这个 exe 还会打
 *          `Elapsed seconds` / `Real time factor` 之类的收尾日志）。
 */
export function parseVadOfflineLine(line: string): VadSegment | null {
    const m = OFFLINE_SEG_RE.exec(String(line ?? '').replace(/\r/g, ''));
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    // 防御：实测出现过 `0.134 -- 0.940:` 后面为空的段（纯噪声触发），丢掉
    const text = String(m[3] ?? '').trim();
    if (!text) return null;
    if (end <= start) return null;
    return { start, end, text };
}

/**
 * 只解析 online 版的**段头**，不碰正文。
 *
 * 用途：执行层要靠「段尾时间 / 总时长」算进度，而 `VadOnlineCollector` 只在
 * 下一段开始时才收口上一段 —— 拿不到实时段尾。单独露一个轻量函数比让
 * 收集器回调更简单，也不会把进度逻辑塞进纯解析层。
 */
export function parseVadOnlineHead(line: string): { start: number; end: number } | null {
    const m = ONLINE_HEAD_RE.exec(String(line ?? '').replace(/\r/g, ''));
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start, end };
}

/**
 * online 版的**累积收集器**。
 *
 * 🔴 必须有状态：online 版把一段的识别结果拆在段头之后的若干行里
 *    （流式解码会逐块吐字），只有在遇到下一个段头时才知道上一段结束了。
 *    逐行无状态解析会丢掉每一段的正文 —— 那是这个格式最容易踩的坑。
 *
 * 用法：每读到一行就 `push(line)`，行尾 `flush()` 收掉最后一段。
 */
export class VadOnlineCollector {
    private cur: { start: number; end: number; lines: string[] } | null = null;
    private readonly out: VadSegment[] = [];

    /**
     * 喂一行。
     *
     * @returns 如果这一行是**新段头**，返回刚刚收口的那一段（可能是 null ——
     *          上一段的正文是空的）；否则返回 null。执行层拿它做实时进度与逐句送出，
     *          ⛔ 不要改成回调，纯函数更好测。
     */
    push(rawLine: string): VadSegment | null {
        const line = String(rawLine ?? '').replace(/\r/g, '');
        const head = ONLINE_HEAD_RE.exec(line);
        if (head) {
            const closed = this.closeCurrent();
            const start = Number(head[1]);
            const end = Number(head[2]);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                // 头解析失败就别开新段，但也不能把后续文字塞进上一段
                this.cur = null;
                return closed;
            }
            const inline = String(head[3] ?? '').trim();
            this.cur = { start, end, lines: inline ? [inline] : [] };
            return closed;
        }
        if (!this.cur) return null;
        const t = line.trim();
        if (!t) return null;
        // ⚠️ 收尾日志不能当正文：实测末尾会打 `Elapsed seconds: …` 与
        //    `Real time factor (RTF): …`，混进字幕就是脏数据。
        if (/^(Elapsed seconds|Real time factor)\b/i.test(t)) return null;
        this.cur.lines.push(t);
        return null;
    }

    /**
     * 收掉当前段（幂等：重复调用不会重复产出）。
     *
     * @returns 收口出来的那一段；没有可收的内容返回 null。
     */
    private closeCurrent(): VadSegment | null {
        if (!this.cur) return null;
        const text = this.cur.lines.join(' ').replace(/\s+/g, ' ').trim();
        const { start, end } = this.cur;
        this.cur = null;
        if (!text) return null;
        const seg = { start, end, text };
        this.out.push(seg);
        return seg;
    }

    /** 结束收集，返回全部段（按出现顺序） */
    finish(): VadSegment[] {
        this.closeCurrent();
        return this.out.slice();
    }
}

/**
 * 段文案清理：合并多余空白、去首尾。
 *
 * ⚠️ X-ASR 的输出会在标点前留空格（实测 ` Good morning .`）——
 *    英文里这是错的写法，中文字幕里更是难看。这里统一把
 *    「空格 + 半角标点」压掉，但⛔ 不动中文标点（中文标点本来就不该带前导空格，
 *    而中文正文里的空格是有意义的，不能一概抹掉）。
 */
export function tidySegmentText(raw: string): string {
    const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
    return t.replace(/\s+([.,!?;:])/g, '$1');
}

/**
 * 把 VAD 段整理成可写 SRT 的条目。
 *
 * 做三件事：
 *  ① 文案清理（见 `tidySegmentText`）；
 *  ② 丢掉空段与时间倒挂段（防御：VAD 偶尔给出 `end <= start` 的极短段）；
 *  ③ 按 `start` 稳定排序 —— VAD 是流式的，实测输出顺序与时间顺序一致，
 *     但排序成本极低，能免疫上游将来改成并行解码。
 */
export function vadSegmentsToEntries(segments: readonly VadSegment[]): VadSegment[] {
    const out: VadSegment[] = [];
    for (const s of segments) {
        const text = tidySegmentText(s.text);
        if (!text) continue;
        if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
        if (s.end <= s.start) continue;
        out.push({ start: s.start, end: s.end, text });
    }
    out.sort((a, b) => a.start - b.start);
    return out;
}

/**
 * 追加长段切分：VAD 给出的段可能很长（实测 1920ms 档在 13.8s 音频上给出 5s 的段），
 * 一条字幕挂 5 秒、塞 20 个词，读起来很难受。
 *
 * 🔴 切法：按**词数**比例分配时间，而不是均分 —— 均分会让长词和短词拿到同样的时长。
 *    ⚠️ 这是估算，不是强制对齐。想精确到词就得上强制对齐模型（Qwen3 那条链路才有）。
 *
 * @param maxChars 单条字幕的字数上限（中英文混排时按字符数近似）
 */
export function splitLongSegments(segments: readonly VadSegment[], maxChars: number): VadSegment[] {
    const limit = Math.max(8, Math.trunc(maxChars));
    const out: VadSegment[] = [];
    for (const s of segments) {
        const text = s.text.trim();
        if (text.length <= limit) {
            out.push({ ...s, text });
            continue;
        }
        // 先按句末标点尝试切；切不动再按字符硬切
        const pieces = splitBySentence(text, limit);
        const totalChars = pieces.reduce((n, p) => n + p.length, 0) || 1;
        let cursor = s.start;
        const span = s.end - s.start;
        for (const p of pieces) {
            const share = (p.length / totalChars) * span;
            const end = Math.min(s.end, cursor + share);
            out.push({ start: cursor, end: Math.max(cursor + 0.2, end), text: p });
            cursor = end;
        }
    }
    return out;
}

/**
 * 按句末标点把长文本切成若干块，每块尽量不超过 `limit`。
 * ⚠️ 单个「句子」本身就超长时退回硬切 —— 否则会产出一条永远超长的字幕。
 */
function splitBySentence(text: string, limit: number): string[] {
    const pieces: string[] = [];
    const sentences = text.match(/[^.!?。！？；;]+[.!?。！？；;]*/g) ?? [text];
    let buf = '';
    for (const raw of sentences) {
        const s = raw.trim();
        if (!s) continue;
        if (buf && buf.length + s.length > limit) {
            pieces.push(buf);
            buf = '';
        }
        if (s.length > limit) {
            if (buf) {
                pieces.push(buf);
                buf = '';
            }
            for (let i = 0; i < s.length; i += limit) pieces.push(s.slice(i, i + limit));
            continue;
        }
        buf = buf ? `${buf} ${s}` : s;
    }
    if (buf) pieces.push(buf);
    return pieces.length > 0 ? pieces : [text];
}

/**
 * 命令行参数（offline 版，Paraformer 用）。
 *
 * 🔴 `--paraformer=` 必须是**等号形式**：sherpa 的 CLI 解析只认等号（同 `pure/senseVoice`）。
 * ⚠️ 必须带 `--silero-vad-model=`：没有 VAD 就退化成整段识别，拿不到分段。
 */
export function buildVadOfflineArgs(opts: {
    tokens: string;
    paraformer: string;
    vadModel: string;
    threads?: number;
    /** 语言：Paraformer 目前只支持中文，留参数是为了将来 */
    lang?: string;
    wav: string;
}): string[] {
    const args: string[] = [
        `--tokens=${String(opts.tokens ?? '').trim()}`,
        `--paraformer=${String(opts.paraformer ?? '').trim()}`,
        `--silero-vad-model=${String(opts.vadModel ?? '').trim()}`,
    ];
    const threads = Number(opts.threads ?? 0);
    if (Number.isFinite(threads) && threads > 0) args.push(`--num-threads=${Math.trunc(threads)}`);
    const wav = String(opts.wav ?? '').trim();
    if (wav) args.push(wav);
    return args;
}

/**
 * 命令行参数（online 版，X-ASR 用）。
 *
 * 🔴 X-ASR 是**流式 transducer**，三个 ONNX 缺一不可（encoder / decoder / joiner）。
 *    ⛔ 它**不接受** `--paraformer=`（实测报 `Invalid option`），两个 exe 不能互换。
 */
export function buildVadOnlineArgs(opts: {
    tokens: string;
    encoder: string;
    decoder: string;
    joiner: string;
    vadModel: string;
    threads?: number;
    wav: string;
}): string[] {
    const args: string[] = [
        `--tokens=${String(opts.tokens ?? '').trim()}`,
        `--encoder=${String(opts.encoder ?? '').trim()}`,
        `--decoder=${String(opts.decoder ?? '').trim()}`,
        `--joiner=${String(opts.joiner ?? '').trim()}`,
        `--silero-vad-model=${String(opts.vadModel ?? '').trim()}`,
    ];
    const threads = Number(opts.threads ?? 0);
    if (Number.isFinite(threads) && threads > 0) args.push(`--num-threads=${Math.trunc(threads)}`);
    const wav = String(opts.wav ?? '').trim();
    if (wav) args.push(wav);
    return args;
}
