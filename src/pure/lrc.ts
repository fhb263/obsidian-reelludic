/**
 * LRC 歌词解析与时间轴（2026-09-27 ④-1）—— **纯逻辑，无 `obsidian` 依赖**，可单测。
 *
 * ④「并入 LyricFlux 音频播放器」的歌词来自三个源（笔记 ` ```lrc ` 块 / 同名 `.lrc` 文件 / 音频内嵌标签），
 * 野外格式极不统一；解析错的观感是「整段错位 / 少几句」，肉眼很难判断是解析问题还是歌词本身就少。
 * ⇒ 口径全部钉在纯函数上，视图层只负责画。
 *
 * ## 相对 LyricFlux 原实现（`obsidian-lyricflux/src/renderers/lrc.ts`）的**两处修正**
 *
 * ① 🔴 **多时间标签同一句**（`[00:10.00][00:50.00]副歌`，副歌复用的常见写法）原实现会**丢掉第二段**：
 *    它用 `split(正则)` + `chunk(parts, 7)` 配对，末块不足 7 个元素时 `parts[6]` 为 `undefined`，
 *    `parts[6].trim()` 抛错被 `catch` 吞掉 ⇒ 整行按默认空行返回 ⇒ **歌词凭空少一句**。
 *    本实现改为**逐行扫描前导标签**，一行有几个时间标签就产出几行。
 * ② 🔴 **输出按时间戳升序**（原实现按文件顺序 append）—— `lrcIndexAt` 的二分定位要求有序；
 *    文件里乱序（手改、拼接）时若不排序，当前行高亮会整段错位。
 *
 * 另外补了原实现缺的 `[offset:±ms]`（纠正整体偏移，很多 LRC 都带这一行）。
 */

/** 逐字 / 高亮用的词元 */
export interface LrcWord {
    /** 词元文本（拼接全部词元必须能**完整重建**显示文本，含空白与标点） */
    text: string;
    /** 绝对时间（毫秒） */
    timestamp: number;
}

/** 解析后的一行歌词 */
export interface LrcLine {
    /** 绝对时间（毫秒，**已叠加 `[offset:]` 修正**：`+` 提前 / `-` 延后） */
    timestamp: number;
    /** 归一化显示时间（`mm:ss` 或 `hh:mm:ss`） */
    timestr: string;
    /** 显示文本（已剥离逐字标记与译文） */
    text: string;
    /** 双语译文（行内 `原文 | 译文` 的右半；⛔ 无双语时不存在） */
    annotation?: string;
    /** 逐字时间（`<mm:ss.xx>` 精确值，或按「到下一行」均分；无文本的行不产出） */
    words?: LrcWord[];
}

/** 文件头部元信息标签 */
export interface LrcMeta {
    ti?: string;
    ar?: string;
    al?: string;
    by?: string;
    /** `[offset:±ms]` 的有效值（越界 / 非数字时**不设**该字段） */
    offset?: number;
}

/** `[offset:]` 的绝对值上限（毫秒）—— 超过这个量级的「偏移」只会是脏数据，套上去等于把整首歌推飞 */
export const LRC_OFFSET_LIMIT = 60_000;

/** 最后一行没有「下一句」参照时，逐字均分用的兜底跨度（毫秒） */
const LRC_TAIL_SPAN = 3000;

/** 行首标签（`[` 到 `]`，不含 `]`） */
const LRC_TAG = /^\s*\[([^\]]+)\]/;

/** 时间标签的**内容**形态：`mm:ss` / `mm:ss.xx` / `hh:mm:ss` / `hh:mm:ss.xx` */
const LRC_TIME_TAG = /^(?:(\d{1,2}):)?\d{1,2}:\d{1,2}(?:\.\d+)?$/;

/** `key: value` 形态的元信息标签 */
const LRC_KV_TAG = /^([A-Za-z]+)\s*:\s*(.*)$/;

/**
 * 逐字拆词正则（卡拉 OK / 按字高亮用）—— 本模块唯一一份。
 * 规则：CJK / 假名 / 韩文**单字**拆分；拉丁、西里尔等**整词**；空白与其余标点各自成 token。
 * 🔴 不能丢弃空白（拼接要能重建原文，`white-space: pre` 负责不被折叠）。
 */
export const LRC_WORD_SPLIT_RE =
    /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]|[A-Za-z0-9\u00c0-\u024f\u0400-\u04ff]+|\s+|[^\s]/gu;

/** `mm:ss.xx`（或 `hh:mm:ss.xx`）→ 秒；⚠️ **非法返回 `NaN`**（⛔ 不返回 0 —— 0 会被当成「第 0 秒」，把整句顶到开头） */
export function parseClock(t: string): number {
    const parts = String(t ?? '').trim().split(':');
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
    if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
    return NaN;
}

/** 秒 → `mm:ss`（超过一小时进位 `hh:mm:ss`）；**向下取整**、非法值回落 `00:00` */
export function formatClock(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 这串文本是不是 LRC（至少有一个行首时间标签）—— 同名 `.lrc` 也可能是空文件或误存的一整篇 TXT */
export function isLrcContent(content: string): boolean {
    const src = String(content ?? '');
    if (!src) return false;
    for (const line of src.split('\n')) {
        const m = line.match(LRC_TAG);
        if (m && LRC_TIME_TAG.test(m[1].trim())) return true;
    }
    return false;
}

/** 行内双语拆分：竖线取**最后一个**、且两侧都要非空（避免误判歌词里孤立的 `|`） */
function splitAnnotation(text: string): { text: string; annotation?: string } {
    const pipe = text.lastIndexOf('|');
    if (pipe < 0) return { text };
    const before = text.slice(0, pipe).trim();
    const after = text.slice(pipe + 1).trim();
    return before && after ? { text: before, annotation: after } : { text };
}

/** 提取 `<mm:ss.xx>` 绝对逐字时间；无标记返回 `null`（交给均分兜底） */
function extractPreciseWords(text: string): { text: string; words: LrcWord[] } | null {
    const re = /<(\d{1,2}:\d{2}(?:\.\d+)?)>([^<]*)/g;
    const words: LrcWord[] = [];
    let display = '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const sec = parseClock(m[1]);
        if (!Number.isFinite(sec)) continue;
        display += m[2];
        words.push({ text: m[2], timestamp: Math.round(sec * 1000) });
    }
    return words.length ? { text: display, words } : null;
}

/**
 * 解析 LRC 文本。
 * @returns `lines`（按时间戳升序；空文本行已丢弃）与 `meta`（头部 `ti/ar/al/by/offset`）
 */
export function parseLrcDocument(content: string): { lines: LrcLine[]; meta: LrcMeta } {
    const meta: LrcMeta = {};
    const src = String(content ?? '').replace(/\r\n?/g, '\n');
    /** 原始记录（时间**秒** + 文本），offset 在最后统一叠加 */
    const raw: { sec: number; text: string }[] = [];

    for (const line of src.split('\n')) {
        let rest = line;
        const times: number[] = [];
        for (;;) {
            const m = rest.match(LRC_TAG);
            if (!m) break;
            const tag = m[1].trim();
            if (LRC_TIME_TAG.test(tag)) {
                const sec = parseClock(tag);
                if (Number.isFinite(sec)) times.push(sec);
                rest = rest.slice(m[0].length);
                continue;
            }
            const kv = tag.match(LRC_KV_TAG);
            if (kv) {
                const k = kv[1].toLowerCase();
                const v = kv[2].trim();
                if (k === 'offset') {
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && Math.abs(n) <= LRC_OFFSET_LIMIT) meta.offset = n;
                } else if (k === 'ti' || k === 'ar' || k === 'al' || k === 'by') {
                    if (v && meta[k] === undefined) meta[k] = v;
                }
                rest = rest.slice(m[0].length);
                continue;
            }
            // 行首非时间、非 `key:value` 的方括号（如 `[Chorus]`）⇒ 属于歌词文本，就此停手
            break;
        }
        const text = rest.trim();
        if (!times.length || !text) continue;
        for (const sec of times) raw.push({ sec, text });
    }

    const off = meta.offset ?? 0;
    raw.sort((a, b) => a.sec - b.sec);

    const lines: LrcLine[] = [];
    for (const r of raw) {
        // 🔴 offset 方向：LRC 规范（Wikipedia `LRC (file format)` / 百度百科同口径）——
        //   `+` 表示**整体提前**、`-` 表示整体延后 ⇒ 有效时间 = 标签时间 **减** offset。
        const timestamp = Math.round(r.sec * 1000) - off;
        const line: LrcLine = { timestamp, timestr: formatClock(timestamp / 1000), text: r.text };
        const ann = splitAnnotation(r.text);
        line.text = ann.text;
        if (ann.annotation) line.annotation = ann.annotation;
        const precise = extractPreciseWords(line.text);
        if (precise) {
            line.text = precise.text;
            line.words = precise.words;
        }
        lines.push(line);
    }

    // 无逐字标记的行：按「本行 → 下一行」的跨度均分（末行用兜底跨度）
    for (let i = 0; i < lines.length; i++) {
        const cur = lines[i];
        if (cur.words) continue;
        const tokens = cur.text.match(LRC_WORD_SPLIT_RE);
        if (!tokens || !tokens.length) continue;
        const next = i + 1 < lines.length ? lines[i + 1].timestamp : cur.timestamp + LRC_TAIL_SPAN;
        const span = next > cur.timestamp ? next - cur.timestamp : LRC_TAIL_SPAN;
        const per = span / tokens.length;
        cur.words = tokens.map((text, j) => ({ text, timestamp: Math.round(cur.timestamp + j * per) }));
    }

    return { lines, meta };
}

/** 便捷别名：只要歌词行 */
export function parseLrc(content: string): LrcLine[] {
    return parseLrcDocument(content).lines;
}

/**
 * 二分定位「时间 `ms` 落在哪一行」。
 * - 第一句之前 ⇒ `-1`（还没唱到任何一句）
 * - 超过最后一句 ⇒ **停在最后一句**（⛔ 不返回 -1，否则播放到尾部会「一句都不高亮」）
 * - 时间戳重复（副歌复用同刻）⇒ 取**最后**一个，高亮不会来回跳
 */
export function lrcIndexAt(lines: readonly LrcLine[], ms: number): number {
    if (!lines.length || !Number.isFinite(ms)) return -1;
    if (ms < lines[0].timestamp) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lines[mid].timestamp <= ms) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

/**
 * 二分定位「时间 `ms` 唱到第几个词元」——**逐字高亮**用（#406）。
 *
 * 语义与 `lrcIndexAt` **刻意不同**（别合并成同一个函数）：
 *  - 第一个词元之前 ⇒ `-1`（该行已高亮但一个字都还没点亮）；
 *  - 超过最后一个词元 ⇒ **停在最后一个**（该行唱完 ⇒ 整句点亮）；
 *  - 无词元（纯文本行）/ 非有限时间 ⇒ `-1`（调用方据此不画逐字效果）。
 *
 * 🔴 词元数组可能与 `text` 不等长（`<mm:ss.xx>` 标记只覆盖部分文本）—— 本函数只认下标，
 *    渲染侧按「下标 ≤ 当前词元 ⇒ 点亮」逐个 toggle，⛔ 不去改文本内容。
 */
export function wordIndexAt(words: readonly LrcWord[] | undefined, ms: number): number {
    if (!words?.length || !Number.isFinite(ms)) return -1;
    if (ms < words[0].timestamp) return -1;
    let lo = 0;
    let hi = words.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (words[mid].timestamp <= ms) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}
