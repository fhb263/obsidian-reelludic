/**
 * 列表分页（1.0.4 批次C ⑥）：把「条目过多」的长列表切成页。
 *
 * 设计要点：
 *  - **纯函数、无副作用**：页码一律 1-based，越界/脏值一律**钳制**而非抛错（视图层可无脑渲染）。
 *  - **空列表也算 1 页**：视图统一渲染「第 1/1 页」，无需到处判空。
 *  - 与阅读器翻页（pure/paged）无关：那是章节/页文本切片，这里是条目分页。
 */

/** 每页条数：海报墙一屏约 4–6 列 × 6–8 行，48 ≈「一屏多一点」（列表视图同值，行更矮、一页更长） */
export const PAGE_SIZE = 48;

export interface PageSlice<T> {
    /** 本页条目 */
    items: T[];
    /** 归一后的页码（1-based，恒在 [1, pageCount]） */
    page: number;
    /** 总页数（空列表也是 1） */
    pageCount: number;
    /** 条目总数 */
    total: number;
    /** 本页首条 / 末条的序号（1-based；空页为 0，便于显示「第 0 条」而不是「第 1 条」的假象） */
    from: number;
    to: number;
}

/** 页大小归一：非有限数 / 小于 1 一律回落 PAGE_SIZE（防除零、防脏配置） */
export function normalizePageSize(pageSize?: number): number {
    return typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : PAGE_SIZE;
}

/** 总页数：空列表按 1 页计 */
export function pageCountOf(total: number, pageSize?: number): number {
    const size = normalizePageSize(pageSize);
    const n = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
    return Math.max(1, Math.ceil(n / size));
}

/** 页码钳制到 [1, pageCount]（页码可能是小数 / 负数 / NaN，或条目被删后原页码已越界） */
export function clampPage(page: number, total: number, pageSize?: number): number {
    const count = pageCountOf(total, pageSize);
    if (!Number.isFinite(page)) return 1;
    return Math.min(count, Math.max(1, Math.floor(page)));
}

/** 切页：本页条目 + 页码元信息 */
export function paginate<T>(items: readonly T[], page: number, pageSize?: number): PageSlice<T> {
    const size = normalizePageSize(pageSize);
    const total = items.length;
    const pageCount = pageCountOf(total, size);
    const cur = clampPage(page, total, size);
    const start = (cur - 1) * size;
    const slice = items.slice(start, start + size) as T[];
    return {
        items: slice,
        page: cur,
        pageCount,
        total,
        from: slice.length ? start + 1 : 0,
        to: slice.length ? start + slice.length : 0,
    };
}

/**
 * 页码窗：`[1, …, 当前页附近连续段, …, 末页]`，两侧超出时才插省略号。
 * `windowSize` = 中间**连续数字段**的最大长度（默认 5）：
 *   · 总页数 ≤ windowSize + 2 时直接全列（避免「只有 6 页却出现省略号」这种反常形态）；
 *   · 段被钳在 `[2, count-1]` 内 → 段贴边时自动内缩（第 1 页得 `1 2 3 4 5 6 … 20`，
 *     末页得 `1 … 15 16 17 18 19 20`），首尾两页恒显示。
 */
export function pageNumbers(page: number, pageCount: number, windowSize = 5): (number | '…')[] {
    // 这里归一的是「总页数」本身（不是条目总数），所以不能用 pageCountOf——那会把页数再除以页大小
    const count = Number.isFinite(pageCount) && pageCount >= 1 ? Math.floor(pageCount) : 1;
    const cur = Math.min(count, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
    const win = Number.isFinite(windowSize) ? Math.max(3, Math.floor(windowSize)) : 5;
    const all = () => Array.from({ length: count }, (_, i) => i + 1);
    if (count <= win + 2) return all();

    // 可放连续段的区间是 [2, count-1]（首尾两个数字恒显示）
    const inner = count - 2;
    const segLen = Math.min(win, inner);
    let start = Math.max(2, cur - Math.floor((segLen - 1) / 2));
    let end = start + segLen - 1;
    if (end > count - 1) {
        end = count - 1;
        start = end - segLen + 1;
    }

    const out: (number | '…')[] = [1];
    if (start > 2) out.push('…');
    for (let i = start; i <= end; i++) out.push(i);
    if (end < count - 1) out.push('…');
    out.push(count);
    return out;
}
