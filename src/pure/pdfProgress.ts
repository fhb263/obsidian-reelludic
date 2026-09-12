// PDF 阅读进度纯逻辑（可单测）：PDF 页大小均匀，页码 → 整体百分比按页等权估算；
// outline 目录条目防御性规整（pdf.getOutline() 原始结构 → 统一 {label, pageIndex, children}）

/**
 * 整体阅读百分比估算（0-100，四舍五入）：PDF 页等权，(pageIndex + ratio) / numPages。
 * - pageIndex 0 基（与 ReadingProgress.chapterIndex 语义对齐：页码索引即章节索引）
 * - ratio 页内滚动比例 0-1（容器内当前页滚动量 / 可视高度）
 * 边界：numPages 非有限或 <= 0 → 0；pageIndex 非整数/负/越界 → 0；ratio 钳制 0-1；结果钳制 0-100。
 */
export function estimatePdfPercent(numPages: number, pageIndex: number, ratio: number): number {
    if (!Number.isFinite(numPages) || numPages <= 0) return 0;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= numPages) return 0;
    const r = Math.max(0, Math.min(1, ratio));
    return Math.max(0, Math.min(100, Math.round(((pageIndex + r) / numPages) * 100)));
}

/** 目录条目（规整后）：pageIndex 0 基；-1 = 无跳转目标（仅展示，如部分 PDF outline 缺页码）。
 * dest 透传原始 outline 目标（pdf.getDestination 解析用；纯规整不解析，UI 层点击时延迟解析） */
export interface PdfOutlineItem {
    label: string;
    pageIndex: number;
    children: PdfOutlineItem[];
    dest?: unknown;
}

/**
 * PDF outline 防御性规整：pdf.getOutline() 原始条目（{title, dest, items}）→ 统一结构。
 * - 非数组/空 → []
 * - title 去空白为 label；dest 透传保留（点击时延迟解析页码）
 * - items 递归规整为 children；label 为空且无 pageIndex 的非法条目过滤
 */
export function normalizePdfOutline(raw: unknown): PdfOutlineItem[] {
    if (!Array.isArray(raw)) return [];
    const out: PdfOutlineItem[] = [];
    for (const node of raw) {
        const item = normalizeOutlineNode(node);
        if (item.label !== '' || item.pageIndex >= 0) out.push(item);
    }
    return out;
}

function normalizeOutlineNode(raw: unknown): PdfOutlineItem {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const label = typeof o.title === 'string' ? o.title.trim() : '';
    let pageIndex = -1;
    if (typeof o.pageIndex === 'number' && Number.isInteger(o.pageIndex) && o.pageIndex >= 0) {
        pageIndex = o.pageIndex;
    }
    const children = Array.isArray(o.items)
        ? o.items.map((c) => normalizeOutlineNode(c)).filter((c) => c.label !== '' || c.pageIndex >= 0)
        : [];
    const item: PdfOutlineItem = { label, pageIndex, children };
    if (o.dest !== undefined) item.dest = o.dest;
    return item;
}

/** 目录扁平条目：DFS 展开后的行，depth 0 = 顶层（顺序对齐侧栏 DOM 行序） */
export type FlatPdfOutlineItem = PdfOutlineItem & { depth: number };

/**
 * 目录 DFS 扁平化（父在前、子紧随其后），顺序与侧栏 DOM 渲染行一一对应，
 * 便于按扁平索引 toggleClass 高亮。未解析页码（-1）条目照常保留在列中。
 */
export function flattenPdfOutline(items: PdfOutlineItem[]): FlatPdfOutlineItem[] {
    const out: FlatPdfOutlineItem[] = [];
    const walk = (list: PdfOutlineItem[], depth: number) => {
        for (const it of list) {
            out.push({ ...it, depth });
            if (it.children.length > 0) walk(it.children, depth + 1);
        }
    };
    walk(items, 0);
    return out;
}

/**
 * 当前页对应的目录高亮行（扁平索引，无匹配 → -1）：
 * - 仅 pageIndex 已解析（>=0）的条目参与
 * - 取 pageIndex <= 当前页且最接近者（= 页所在区间的最新已到达章节）
 * - 同页并列（如章与子节同页）取 DFS 靠后（更深）的一条
 */
export function chooseActivePdfIndex(flat: FlatPdfOutlineItem[], pageIndex: number): number {
    if (!Number.isInteger(pageIndex)) return -1;
    let best = -1;
    let bestPage = -1;
    for (let i = 0; i < flat.length; i++) {
        const p = flat[i].pageIndex;
        if (!Number.isInteger(p) || p < 0 || p > pageIndex) continue;
        if (p >= bestPage) {
            bestPage = p;
            best = i;
        }
    }
    return best;
}

/** 阅读位置（chapterIndex = 页码索引 0 基 / scrollRatio = 页内滚动比例 0-1） */
export interface ReaderPos {
    chapterIndex: number;
    scrollRatio: number;
}

/**
 * 关闭落盘位置解析：Obsidian Modal 关闭时内容先拆解、scrollTop 归零，此时实时读取
 * （chapterIndex=0 且 ratio≈0）会把「会话内读到深处」的进度覆写成 0 → 重开恒回第 1 页、percent 落 0。
 * 规则：实时值处于起点（0 页顶）且最后已知位置确有过阅读 → 用最后已知位置；否则用实时值。
 */
export function resolveFlushPos(live: ReaderPos, last: ReaderPos): ReaderPos {
    const atOrigin = live.chapterIndex === 0 && live.scrollRatio <= 0;
    const hasProgress = last.chapterIndex > 0 || last.scrollRatio > 0;
    return atOrigin && hasProgress ? { ...last } : { ...live };
}
