// 词级时间戳（纯逻辑，无 obsidian 依赖，可单测）
//
// 责任：把一条 cue 的文本拆成「词片段 + 起止秒」，让字幕面板能做逐词高亮。
//
// 🔴 三条口径（用户 m01938 提「句级时间戳，词级时间戳」时没细分，这里按可用性分档）：
//   ⑴ **真词级**：字幕源自己带词级信息 —— VTT 行内戳 `<00:00:01.500>`、ASS 卡拉 OK 标签
//      `{\k50}`（50 厘秒）。有就用，⛔ 不拿估算值覆盖真数据。
//   ⑵ **估算词级**：绝大多数 SRT / 普通 VTT 只有整行起止，没有任何词级信息。
//      ⇒ 按「字符权重」把行时长按比例切开（中日韩按字、拉丁按词）。这是主流播放器的做法，
//      ⚠️ 它不是「测量」出来的，别在 UI 上把它说成精确时间戳。
//   ⑶ **不做整屏词级 DOM**：一条 800 行的字幕 × 每行十几个词 = 上万个 span，
//      列表滚动会明显掉帧 ⇒ 词级只给**当前高亮那一行**用（见视图层 `paintCueWords`）。
//
// ⚠️ 与 `pure/subtitleCues` 的分工：那边管「解析成 cue 行」（把行内标签统统剥掉，只要纯文本给列表读）；
//    这边管「从同一份原文里把**被剥掉的那些时间标签**捞出来」。⇒ 两边都从同一段字幕文本出发，
//    ⛔ 视图层不另读一次文件。

/** 一个词片段：文本 + 起止秒（`end` 缺省时由下一个词的 `start` 兜底） */
export interface WordSpan {
    text: string;
    start: number;
    end: number;
}

/**
 * 词的最大片段数上限。
 *
 * 🔴 为什么必须有：某些 ASS 会用 `{\k10}` 把一行切成一个字一个片段，一行能到 200+ 段；
 *    真超长行（整段独白塞进一条 cue）也能有几百个词。
 *    ⇒ 超过就**整行退回不拆**（返回空数组，视图层显示纯文本）——
 *    宁可没有逐词高亮，也不要为一条异常行建几百个 DOM 节点。
 */
export const WORD_SPAN_MAX = 120;

/** 中日韩统一表意文字 + 假名 + 谚文（这些语言不分词、按字计时） */
const CJK_SRC = '\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uAC00-\\uD7AF';
const CJK_RE = new RegExp(`[${CJK_SRC}]`);

/**
 * 标点集（显式列举，⛔ 不用 `\p{P}` Unicode 属性转义）。
 *
 * 🔴 为什么不用 `\p{P}`：`tsconfig` 的 `target` 是 **ES6**，Unicode 属性转义要 ES2018，
 *    tsc 会直接报「Unicode property value expressions are only available when targeting
 *    ES2018 or later」。而且这个集合本来就是给字幕字体挑的常见标点，列出来更可控。
 */
const PUNCT_RE = /[!-/:-@[-`{-~，。、；：？！「」『』（）〔〕【】《》〈〉…—～·・,.;:?!'"()\[\]{}\-]/;

/** 该字符是否「按字计时」的文字（CJK） */
export function isCjkChar(ch: string): boolean {
    return !!ch && CJK_RE.test(ch);
}

/**
 * 把文本切成计时单位：CJK 一个字一个单位，拉丁/数字按空白成词。
 *
 * ⚠️ 标点**跟着前一个单位走**（`「好」` 不该拆成两个计时单位、`word,` 的逗号也不单独占一拍），
 *    否则标点会各自分到一份时长，看起来像「句号亮了两秒」。
 */
export function splitTimingUnits(text: string): string[] {
    const src = String(text ?? '');
    if (!src) return [];
    const out: string[] = [];
    let buf = '';
    const flush = (): void => {
        if (buf) {
            out.push(buf);
            buf = '';
        }
    };
    for (const ch of src) {
        // 换行与空白都不是计时单位，只起到分词作用
        if (/\s/.test(ch)) {
            flush();
            continue;
        }
        if (isCjkChar(ch)) {
            out.push(ch);
            continue;
        }
        if (PUNCT_RE.test(ch)) {
            // 标点并进前一个单位；行首标点（如破折号）自成单位
            if (buf) buf += ch;
            else if (out.length) out[out.length - 1] += ch;
            else buf += ch;
            continue;
        }
        buf += ch;
    }
    flush();
    return out;
}

/**
 * 计时权重：CJK 按字计 1，拉丁/数字按字符计 0.5。
 *
 * 口径来源：一个汉字和一个拉丁字母的发音时长本来就不一样（汉字是整音节、字母是半个音节的量级），
 * 用「字/字符」两套单价把两种文字的权重拉到同一个量纲上，比按「词数」平均分更接近真实语速。
 * ⚠️ 这是**估算**，别当成测量值用（见文件头 ⑵）。
 */
export function timingWeight(unit: string): number {
    const s = String(unit ?? '');
    if (!s) return 0;
    let weight = 0;
    for (const ch of s) weight += isCjkChar(ch) ? 1 : 0.5;
    return weight;
}

/**
 * 估算：把 `[start, end]` 按字符权重切成每个单位一份。
 *
 * @returns 单位数组等长的时间片段；无有效时长 / 单位过多 ⇒ 空数组（视图层退回纯文本）
 */
export function estimateWordSpans(text: string, start: number, end: number): WordSpan[] {
    const units = splitTimingUnits(text);
    if (units.length === 0 || units.length > WORD_SPAN_MAX) return [];
    const s = Number(start);
    const e = Number(end);
    // 时长无效或为零 ⇒ 不拆：所有单位同时点亮没有意义，还会让 end < start 的脏数据算出负数
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return [];
    const weights = units.map(timingWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return [];
    const out: WordSpan[] = [];
    let acc = 0;
    for (let i = 0; i < units.length; i++) {
        const w = weights[i] ?? 0;
        const from = s + ((e - s) * acc) / total;
        acc += w;
        const to = s + ((e - s) * acc) / total;
        out.push({ text: units[i] ?? '', start: from, end: to });
    }
    // 末位对齐到行尾：浮点累加可能差几毫秒，留着会让最后一个词「永远差一点」才点亮
    const last = out[out.length - 1];
    if (last) last.end = e;
    return out;
}

/** 解析一个 VTT/ASS 时间戳形态（`00:00:01.500`）→ 秒；非法 → NaN。与 `subtitleCues` 里的私有同款口径 */
function stampToSeconds(raw: string): number {
    const m = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/.exec(String(raw ?? '').trim());
    if (!m) return NaN;
    const hh = m[1] ? Number(m[1]) : 0;
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
    if (![hh, mm, ss, ms].every((n) => Number.isFinite(n))) return NaN;
    return hh * 3600 + mm * 60 + ss + ms / 1000;
}

/** 去掉 VTT 的非时间类标签（`<i>`、`<c.foo>`）但**保留** `<00:00:01.500>` 时间戳 */
function stripNonTimingTags(text: string): string {
    return String(text ?? '')
        .replace(/<(?!(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?>)[^>]*>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

/**
 * 真词级 #1：VTT 行内时间戳 `<00:00:01.500>`。
 *
 * 语义：每个内联戳标记**它后面那段文字**的起始时刻；最后一段的结束时刻 = 整条 cue 的 `end`。
 * @returns 拿到时间戳且拆得出文本时返回片段数组；否则 `null`（交给估算兜底）。
 */
export function parseVttInlineWords(rawBody: string, cueStart: number, cueEnd: number): WordSpan[] | null {
    const src = String(rawBody ?? '');
    if (src.indexOf('<') < 0) return null;
    const re = /<(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?>/g;
    const marks: { at: number; len: number; time: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const sec = stampToSeconds(m[0].slice(1, -1));
        if (Number.isFinite(sec)) marks.push({ at: m.index, len: m[0].length, time: sec });
    }
    if (marks.length === 0) return null;
    const out: WordSpan[] = [];
    for (let i = 0; i < marks.length; i++) {
        const cur = marks[i];
        const next = marks[i + 1];
        if (!cur) continue;
        const from = cur.at + cur.len;
        const to = next ? next.at : src.length;
        const piece = stripNonTimingTags(src.slice(from, to)).trim();
        if (!piece) continue;
        const end = next ? next.time : Number(cueEnd);
        out.push({ text: piece, start: cur.time, end: Number.isFinite(end) && end > cur.time ? end : cur.time });
    }
    if (out.length === 0 || out.length > WORD_SPAN_MAX) return null;
    return out;
}

/**
 * 真词级 #2：ASS / SSA 卡拉 OK 标签 `{\k50}` / `{\kf}` / `{\ko}` / `{\K}`。
 *
 * 语义：数字是**厘秒**（1/100 秒），从这条 cue 的 `start` 开始**累加**；
 * 一个标签只管它**后面**那段文字，所以「标签 + 文字」成对读完即可。
 * ⚠️ `{\k}` 不带数字 = 0 时长（合法，紧贴的下一段直接接管）；缺标签的文字按估算补。
 */
export function parseAssKaraokeWords(rawText: string, cueStart: number, cueEnd: number): WordSpan[] | null {
    const src = String(rawText ?? '').replace(/\\N/gi, '\n').replace(/\\n/gi, '\n');
    // 只认卡拉 OK 系标签，其余 `{\pos()}` / `{\an8}` / `{\c&H...}` 一律先丢弃
    const kRe = /\{([^{}]*)\}/g;
    const segments: { text: string; cs: number }[] = [];
    let cursor = 0;
    let pendingCs = 0;
    let sawK = false;
    let m: RegExpExecArray | null;
    while ((m = kRe.exec(src)) !== null) {
        const plain = stripNonTimingTags(src.slice(cursor, m.index));
        if (plain.trim()) segments.push({ text: plain, cs: pendingCs });
        pendingCs = 0;
        // `\k` 系列（大小写都收；`\K` 在 Aegisub 里是 `\kf` 的别名）
        const km = /\\[kK](?:f|o)?(\d*)/.exec(m[1] ?? '');
        if (km) {
            sawK = true;
            const n = Number(km[1] || '0');
            pendingCs = Number.isFinite(n) && n > 0 ? n : 0;
        }
        cursor = m.index + m[0].length;
    }
    const tail = stripNonTimingTags(src.slice(cursor));
    if (tail.trim()) segments.push({ text: tail, cs: pendingCs });
    if (!sawK) return null;
    // 把「文本 + 厘秒」展开成逐个计时单位（一段可能含多个字）
    const out: WordSpan[] = [];
    let at = Number.isFinite(cueStart) ? cueStart : 0;
    const limit = Number.isFinite(cueEnd) && cueEnd > at ? cueEnd : at;
    for (const seg of segments) {
        const units = splitTimingUnits(seg.text);
        if (units.length === 0) continue;
        const dur = seg.cs > 0 ? seg.cs / 100 : 0;
        if (dur <= 0) {
            // 没给时长 ⇒ 退化为「按估算铺」，但不能越过 cue 末尾
            const est = estimateWordSpans(units.join(''), at, Math.max(at, limit));
            for (const w of est) out.push(w);
            const tailEnd = est[est.length - 1];
            if (tailEnd) at = tailEnd.end;
            continue;
        }
        const weights = units.map(timingWeight);
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        let acc = 0;
        for (let i = 0; i < units.length; i++) {
            const w = weights[i] ?? 0;
            const from = at + (dur * acc) / total;
            acc += w;
            const to = at + (dur * acc) / total;
            out.push({ text: units[i] ?? '', start: from, end: to });
        }
        at += dur;
    }
    if (out.length === 0 || out.length > WORD_SPAN_MAX) return null;
    return out;
}

/**
 * 取一条 cue 的词片段：先真词级、再估算。
 *
 * @param words 解析期已经拿到的真词级（`Cue.words`），传进来就直接用
 * @returns 恒为数组；无可用拆分时返回空数组（视图层显示纯文本）
 */
export function wordSpansFor(
    text: string,
    start: number,
    end: number,
    words?: readonly WordSpan[] | null,
): WordSpan[] {
    if (words && words.length > 0) return words.slice();
    return estimateWordSpans(text, start, end);
}
