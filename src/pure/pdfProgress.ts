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
