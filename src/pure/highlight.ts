// 阅读器高亮纯模型（纯逻辑，无 obsidian 依赖，可单测）。
// 高亮 = 页内持久黄标的选中文本，存进书目笔记独立「## 高亮」区（与「## 摘抄」区并列），
// blockquote + ^hl… 块格式与摘抄一致 → 解析/追加/删除全部复用 pure/excerpt.ts（section='高亮'）。
// 本模块只做类型化薄封装 + 章节过滤，避免重复实现 excerpt 的 markdown 逻辑。

import {
    parseExcerptBlocks,
    renderExcerptBlock,
    generateBlockId,
    type ParsedExcerpt,
} from 'pure/excerpt';

/** 笔记「## 高亮」区标题（与「## 摘抄」并列） */
export const HIGHLIGHT_SECTION = '高亮';

/** 阅读器高亮条目（语义：页内持久黄标的选段；形状与 ParsedExcerpt 一致，chapter/pct 为定位） */
export interface ReaderHighlight {
    /** 选中文本（blockquote 内容，多行合并为 \n） */
    quote: string;
    /** 块 id（^hl…，不含 ^） */
    id?: string;
    /** 原书定位：chapter 1 基 + pct 0-100（用于按章渲染黄标 + 跳转） */
    loc?: { chapter: number; pct: number };
}

/** 从 ParsedExcerpt 收窄为高亮条目（只取 quote/id/loc；页码/心得高亮不用但保留引用字段以兼容删除定位） */
function toHighlight(ex: ParsedExcerpt): ReaderHighlight {
    return { quote: ex.quote, id: ex.id, loc: ex.loc };
}

/**
 * 从书目笔记 markdown 提取全部高亮块（「## 高亮」区逐块解析；无区/无块 → []）。
 * 解析复用 parseExcerptBlocks（块格式与摘抄一致，按 ^hl id 锚点切块）。
 */
export function parseHighlightBlocks(noteMd: string): ReaderHighlight[] {
    return parseExcerptBlocks(noteMd, HIGHLIGHT_SECTION).map(toHighlight);
}

/** 取某章的高亮（渲染黄标用）：loc.chapter === chapter；无 loc 的高亮不归入任何章（渲染时跳过） */
export function chapterHighlights(list: ReaderHighlight[], chapter: number): ReaderHighlight[] {
    return list.filter((h) => h.loc?.chapter === chapter);
}

/**
 * 在正文段落文本里定位高亮 quote 的命中片段（忽略空白差异，取首个命中）。
 * 返回命中片段覆盖的原文 [start,end) 字符偏移；无命中 → null。
 * 用于页内持久黄标：按偏移把命中片段包 <mark>（TXT 段落流与 EPUB iframe 共用）。
 */
export function findQuoteSegment(text: string, quote: string): { start: number; end: number } | null {
    if (!text || !quote) return null;
    // 去空白（含全角空格）建立原文偏移映射
    let compact = '';
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) {
            compact += text[i];
            map.push(i);
        }
    }
    let q = '';
    for (const ch of quote) {
        if (!/\s/.test(ch)) q += ch;
    }
    if (!q) return null;
    const hit = compact.indexOf(q);
    if (hit === -1) return null;
    const start = map[hit];
    const end = map[hit + q.length - 1] + 1;
    return { start, end };
}

/** 渲染一条高亮块 markdown：blockquote 引用 + 定位 meta + ^hl… 块 id。
 * 复用 renderExcerptBlock（loc 在 meta 行 → 「· 定位：N:N」），id 前缀用 hl 以与摘抄 bk 区分。
 */
export function renderHighlightBlock(quote: string, loc: { chapter: number; pct: number }): string {
    const q = quote?.trim();
    if (!q) return '';
    return renderExcerptBlock({ quote: q, loc, id: generateBlockId('hl') });
}

/** 归一文本（去全部空白），用于高亮 quote 是否同一段的比对（忽略换行/空格差异） */
export function normText(s: string): string {
    let out = '';
    for (const ch of s ?? '') {
        if (!/\s/.test(ch)) out += ch;
    }
    return out;
}

/**
 * 在给定章的高亮列表里查是否已存在"同一段文本"的高亮（去空白归一比对）。
 * 用于标注模式的 toggle：命中 → 取消该条；未命中 → 新增。返回命中的高亮条目（含 id）或 null。
 */
export function findSameHighlight(list: ReaderHighlight[], quote: string, chapter: number): ReaderHighlight | null {
    const q = normText(quote);
    if (!q) return null;
    for (const h of list) {
        if (h.loc?.chapter === chapter && normText(h.quote) === q) return h;
    }
    return null;
}

/**
 * 高亮 toggle 决策：返回 [{action:'add', add} | {action:'remove', id}]，供面板执行。
 * 选中文字在"当前章已有高亮"→ remove；否则 add。封装使纯逻辑可测、面板只消费结果。
 */
export function decideHighlightToggle(
    list: ReaderHighlight[],
    quote: string,
    loc: { chapter: number; pct: number },
): { action: 'add'; add: ReaderHighlight } | { action: 'remove'; id: string } {
    const same = findSameHighlight(list, quote, loc.chapter);
    if (same && same.id) return { action: 'remove', id: same.id };
    // 未命中 → 新增（id 由宿主 onHighlight 生成后回填；此处给占位空串由调用方决定）
    return { action: 'add', add: { quote: quote.trim(), loc } };
}
