// 阅读器定位锚纯逻辑（纯逻辑，无 obsidian 依赖，可单测）。
//
// 背景（2026-09-18 双向溯源）：全项目的锚点只有「章/页序号 + 章内百分比 + quote 文本」，
// 其中 pct 由滚动比例算出 —— 换字号、换窗宽、换设备都会漂 → 回跳只能落到附近。
// 本模块用 **quote 文本锚**做真定位：去空白归一后精确匹配，命中位置与排版无关；
// pct 降级为「粗提示」，仅在 quote 在正文里出现多次时用来消歧（不再决定落点）。
//
// 与 pure/highlight.findQuoteSegment 的关系：后者是「单块（段落）」特例，已改为委托本模块，
// 避免同一套「去空白 + 偏移映射」逻辑两处实现。

/** 去空白归一的文本 + 每个保留字符在原文中的下标（用于把命中位置映射回原文坐标系） */
export interface CompactText {
    text: string;
    map: number[];
}

/** 命中覆盖的某一块区间：块序号 + 块内 [start, end) 原文偏移（end 独占） */
export interface AnchorRange {
    index: number;
    start: number;
    end: number;
}

/** 一次 quote 命中的完整区间集合（跨块时每块一项，按块序） */
export interface QuoteSpan {
    ranges: AnchorRange[];
}

/** 空白判定（`\s` 覆盖半角空格 / 制表 / 换行 / 全角空格 U+3000 / 不换行空格 U+00A0 / BOM） */
function isSpace(ch: string): boolean {
    return /\s/.test(ch);
}

/**
 * 去空白并保留偏移映射：`map[i]` = 归一文本第 i 个字符在原文中的下标。
 * 非字符串（脏数据）容错为空；全空白 → `{ text: '', map: [] }`。
 */
export function compactText(s: string): CompactText {
    const src = typeof s === 'string' ? s : '';
    let text = '';
    const map: number[] = [];
    for (let i = 0; i < src.length; i++) {
        if (!isSpace(src[i])) {
            text += src[i];
            map.push(i);
        }
    }
    return { text, map };
}

/** 在全部命中位置里挑一个：给了提示比例就取最接近估算位置的那处（同文本多处出现时消歧），否则取首个 */
function pickHit(hits: number[], total: number, hintRatio?: number): number {
    if (hits.length === 1) return hits[0];
    if (typeof hintRatio !== 'number' || !Number.isFinite(hintRatio)) return hits[0];
    const est = Math.round(Math.min(1, Math.max(0, hintRatio)) * total);
    let best = hits[0];
    let bestDist = Math.abs(hits[0] - est);
    for (const h of hits) {
        const d = Math.abs(h - est);
        if (d < bestDist) {
            best = h;
            bestDist = d;
        }
    }
    return best;
}

/** 把 compact 串上的 [start, start+len) 区间按来源块拆成 per-块区间（同块内连续下标合并为一项） */
function buildRanges(
    where: { index: number; offset: number }[],
    start: number,
    len: number,
): AnchorRange[] {
    const out: AnchorRange[] = [];
    for (let i = start; i < start + len; i++) {
        const pos = where[i];
        if (!pos) continue;
        const last = out[out.length - 1];
        if (last && last.index === pos.index) {
            last.end = Math.max(last.end, pos.offset + 1);
        } else {
            out.push({ index: pos.index, start: pos.offset, end: pos.offset + 1 });
        }
    }
    return out;
}

/**
 * 在多个文本块（TXT 段落 / EPUB 段落）里定位 quote，返回每块内的精确区间。
 * - 空白差异被忽略；**允许跨块命中**（选区跨段落时也能定位，旧实现做不到）
 * - `hintRatio`（0-1，通常传 `loc.pct / 100`）只用于同一 quote 多处命中时挑最接近的一处；
 *   越界 / 非有限数 → 退化为取首个；未给 → 取首个
 * - 命中不到 / quote 为空 / 正文为空 → null
 */
export function locateQuoteSpan(chunks: string[], quote: string, hintRatio?: number): QuoteSpan | null {
    const list = Array.isArray(chunks) ? chunks : [];
    const q = compactText(quote).text;
    if (!q) return null;
    // 逐块去空白后拼成一条 compact 串，同时记录每个字符的来源（块序号 + 块内原文下标）
    let compact = '';
    const where: { index: number; offset: number }[] = [];
    for (let ci = 0; ci < list.length; ci++) {
        const c = compactText(list[ci]);
        for (let k = 0; k < c.text.length; k++) {
            where.push({ index: ci, offset: c.map[k] });
        }
        compact += c.text;
    }
    if (compact.length < q.length) return null;
    // 收集全部命中起点（起点可重叠）
    const hits: number[] = [];
    for (let at = compact.indexOf(q); at !== -1; at = compact.indexOf(q, at + 1)) hits.push(at);
    if (hits.length === 0) return null;
    const start = pickHit(hits, compact.length, hintRatio);
    const ranges = buildRanges(where, start, q.length);
    return ranges.length ? { ranges } : null;
}
