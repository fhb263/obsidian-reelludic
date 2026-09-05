// 阅读器翻页模式纯换算（无 obsidian/无 DOM 依赖，可单测）。
// 核心：连续滚动与翻页视图统一为「章内前进比例 ratio」。

/** 阅读滚动模式：连续 / 翻页 */
export type ScrollMode = 'continuous' | 'paged';

/** 归一化滚动模式（脏数据兜底 → 'continuous'） */
export function normalizeScrollMode(v: unknown): ScrollMode {
    return v === 'paged' ? 'paged' : 'continuous';
}

/** 钳制到 [0,1] */
export function clampRatio(ratio: number): number {
    if (!Number.isFinite(ratio)) return 0;
    return Math.max(0, Math.min(1, ratio));
}

/** 页 index（0 基）钳制到 [0, totalPages−1]；totalPages ≤ 0 视为 0 */
export function clampPage(page: number, totalPages: number): number {
    const t = Math.max(1, Math.floor(totalPages));
    if (!Number.isFinite(page)) return 0;
    return Math.max(0, Math.min(t - 1, Math.floor(page)));
}

/** 页 index → 章内比例：ratio = i/(totalPages−1)；单页 → 0。越界页钳制 */
export function pageToRatio(page: number, totalPages: number): number {
    const t = Math.max(1, Math.floor(totalPages));
    if (t <= 1) return 0;
    const i = clampPage(page, t);
    return clampRatio(i / (t - 1));
}

/** 章内比例 → 页 index（0 基，最近取整）；单页 → 0。比例越界钳制 */
export function ratioToPage(ratio: number, totalPages: number): number {
    const t = Math.max(1, Math.floor(totalPages));
    if (t <= 1) return 0;
    const r = clampRatio(ratio);
    return clampPage(Math.round(r * (t - 1)), t);
}

/** 页 index 前进/后退 n 步后的新页（越界钳到首/末）；总页数校验：单页恒返回 0 */
export function pageStep(page: number, totalPages: number, delta: number): number {
    const t = Math.max(1, Math.floor(totalPages));
    if (t <= 1) return 0;
    return clampPage(clampPage(page, t) + delta, t);
}

/** 是否是末页（供翻页到底触发续章判断） */
export function isLastPage(page: number, totalPages: number): boolean {
    const t = Math.max(1, Math.floor(totalPages));
    if (t <= 1) return true;
    return clampPage(page, t) >= t - 1;
}

/** 是否是首页（供回退到上一章判断） */
export function isFirstPage(page: number): boolean {
    return !Number.isFinite(page) || Math.floor(page) <= 0;
}
