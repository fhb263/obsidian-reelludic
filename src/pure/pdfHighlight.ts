// PDF 页内高亮几何纯逻辑（无 obsidian / 无 DOM 依赖，可单测）。
//
// 背景（2026-10-23 用户路线 A）：PDF 高亮只存阅读存档 JSON，**不写回 PDF 文件**。
// 因此不像 PDF++ 那样往 PDF 里塞 annot 字典，而是每次渲染时按 `quote` 在 textLayer 的 span 里
// 重新定位（复用 `pure/anchor.locateQuoteSpan`），再取 DOM Range 的 client rect。
//
// 🔴 坐标系（2026-10-23 真机实测，别想当然）：
//   `chars[].r` 是 **PDF 用户空间**（scale=1 与 scale=2 完全同值）—— pdf.js 自己在渲染 span 时
//   把它除以页宽换成百分比（实测 `r[0]=50 / pageW=612 → left:8.17%`）。⇒ 本模块一律输出
//   **归一化 0-1 百分比**，缩放（50%–300%）时**完全不重算**，CSS 百分比自动跟随。
//   y 轴须翻转：`top = (pageH - bottom) / pageH`（PDF 原点在左下，DOM 在左上）。
//
// ⚠️ 纵向也必须是百分比：页高随缩放变，存像素会在缩放后错位。

/** DOMRect / client rect 的形状（只取用得到的四个边，便于单测构造） */
export interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** 归一化矩形（全部 0-1，相对所在页宽/页高；x/y 为左上角） */
export interface PdfRelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** 同一行判定：垂直重叠高度 > 较矮者高度的一半（对齐 PDF++ `areRectanglesMergeableHorizontally`） */
export function sameLine(a: RectLike, b: RectLike): boolean {
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const minH = Math.min(a.bottom - a.top, b.bottom - b.top);
    if (minH <= 0) return false;
    return overlap > minH * 0.5;
}

/** 水平相邻判定：间隙不超过较窄者宽度的 20%（防把「分栏两列」误并成一条长条） */
export function horizontallyAdjacent(a: RectLike, b: RectLike): boolean {
    const gap = Math.max(a.left, b.left) - Math.min(a.right, b.right);
    if (gap > 0) {
        const minW = Math.min(a.right - a.left, b.right - b.left);
        return minW > 0 && gap <= minW * 0.2;
    }
    return true; // 有重叠（同一行重复框）→ 可直接并
}

/**
 * 把同一行的若干矩形并成「每行一条」。
 *
 * `Range.getClientRects()` 在一段连续文字上通常已按行返回，但跨 span / 跨行内样式的选区
 * 会把一行切成多段 ⇒ 页面上出现竖向缝隙。先按 top 排序，再逐行累加合并。
 * 行内不重叠且间隙过大的（分栏/多列表头）保持独立 —— 因此合并前先判 `horizontallyAdjacent`。
 */
export function mergeLineRects(rects: RectLike[]): RectLike[] {
    const list = rects.filter((r) => r.right > r.left && r.bottom > r.top);
    if (list.length <= 1) return list;
    const sorted = [...list].sort((a, b) => a.top - b.top || a.left - b.left);
    const out: RectLike[] = [];
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && sameLine(last, r) && horizontallyAdjacent(last, r)) {
            last.left = Math.min(last.left, r.left);
            last.right = Math.max(last.right, r.right);
            last.top = Math.min(last.top, r.top);
            last.bottom = Math.max(last.bottom, r.bottom);
        } else {
            out.push({ ...r });
        }
    }
    return out;
}

/** 精度：4 位小数足够（0.0001 * 612px ≈ 0.06px），同时让 JSON / 单测比较稳定 */
function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** 低于此归一尺寸视为亚像素噪声（浏览器会给 0.3px 的碎片框） */
const MIN_SIZE = 0.0005;

/**
 * 页内绝对矩形 → 归一化百分比矩形。
 *
 * @param rects  `Range.getClientRects()` 的结果（视口坐标系）
 * @param origin 页容器左上角的视口坐标（`pageEl.getBoundingClientRect()`）
 * @param pageW  页容器当前宽度（px，已含缩放；= viewport.width）
 * @param pageH  页容器当前高度（px，已含缩放；= viewport.height）
 *
 * 先减原点、再除页宽页高 ⇒ 与缩放无关。越界一律夹取（跨页选区/浮点误差）。
 * 纵向翻转在这里做：DOM top 已是从页顶算，无须再翻（翻转只在从 `chars[].r` 换算时才需要，
 * 那条路本模块不用 —— 记在这里防以后有人照 PDF++ 抄反）。
 */
export function normalizeRects(
    rects: RectLike[],
    origin: { left: number; top: number },
    pageW: number,
    pageH: number,
): PdfRelRect[] {
    if (!(pageW > 0) || !(pageH > 0)) return [];
    const out: PdfRelRect[] = [];
    for (const r of mergeLineRects(rects)) {
        const x0 = clamp01((r.left - origin.left) / pageW);
        const x1 = clamp01((r.right - origin.left) / pageW);
        const y0 = clamp01((r.top - origin.top) / pageH);
        const y1 = clamp01((r.bottom - origin.top) / pageH);
        const w = round4(x1 - x0);
        const h = round4(y1 - y0);
        if (w < MIN_SIZE || h < MIN_SIZE) continue;
        out.push({ x: round4(x0), y: round4(y0), w, h });
    }
    // 统一按阅读顺序（先上后左）排序：JSON 里稳定可读，diff 也稳
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
}

/** 归一化矩形 → 内联样式（百分比定位；覆盖层子 div 直接套） */
export function relRectStyle(r: PdfRelRect): { left: string; top: string; width: string; height: string } {
    return {
        left: `${round4(r.x * 100)}%`,
        top: `${round4(r.y * 100)}%`,
        width: `${round4(r.w * 100)}%`,
        height: `${round4(r.h * 100)}%`,
    };
}

/** 两个归一化矩形是否有实质重叠（交集面积 > 较窄者面积的一半）—— 判「选区压在某条高亮上」 */
function overlapsOne(a: PdfRelRect, b: PdfRelRect): boolean {
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix <= 0 || iy <= 0) return false;
    const inter = ix * iy;
    const minArea = Math.min(a.w * a.h, b.w * b.h);
    return minArea > 0 && inter > minArea * 0.5;
}

/**
 * 两组归一化矩形是否「实质重叠」。
 * 用于动作条垃圾桶显隐：选区落在某条已有高亮上才允许删（与 TXT 的 `hlMarkTargetOf` 同语义，
 * 但 PDF 没有 mark 元素可查，只能几何判定）。
 */
export function rectsOverlap(a: PdfRelRect[], b: PdfRelRect[]): boolean {
    for (const x of a) for (const y of b) if (overlapsOne(x, y)) return true;
    return false;
}

/**
 * 把 textLayer 的 span 文本数组拼成 `locateQuoteSpan` 要的 chunks（透传 + 非数组兜底）。
 *
 * ⚠️ 与 TXT/EPUB 的差别：PDF 的 span 是**按行/按词**切的，一个词可能拆在两个 span 里，
 *    也可能一个 span 横跨多行（`\n` 已由 pdf.js 放进 `str`）。`locateQuoteSpan` 会去空白归一，
 *    所以拆词能命中，但**跨行时**要靠 span 顺序拼接 —— 顺序即 DOM 顺序，直接用即可。
 */
export function pageChunks(texts: string[]): string[] {
    return Array.isArray(texts) ? texts : [];
}

/** 高亮在列表里的简短标签（侧栏列表用；过长截断，换行压成空格） */
export function highlightLabel(quote: string, max = 42): string {
    const t = (typeof quote === 'string' ? quote : '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max)}…`;
}

/**
 * 归一化外部读入的矩形数组（存档白名单入口，与 `normalizeHighlights` 同一纪律）：
 * 非数组 → `undefined`（不是 []：`undefined` 代表「这条没有几何数据」，要回退按 quote 重定位）；
 * 逐项要求 x/y/w/h 都是有限数，越界夹取，亚像素噪声丢弃，全丢光 → `undefined`。
 * 🔴 返回 `undefined` 而不是 `[]` 是刻意的：渲染端据此决定「走矩形」还是「走 quote 重定位」。
 */
export function normalizeRelRects(raw: unknown): PdfRelRect[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const out: PdfRelRect[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const o = item as Record<string, unknown>;
        const x = typeof o.x === 'number' && Number.isFinite(o.x) ? clamp01(o.x) : null;
        const y = typeof o.y === 'number' && Number.isFinite(o.y) ? clamp01(o.y) : null;
        const w = typeof o.w === 'number' && Number.isFinite(o.w) ? o.w : null;
        const h = typeof o.h === 'number' && Number.isFinite(o.h) ? o.h : null;
        if (x === null || y === null || w === null || h === null) continue;
        const cw = round4(Math.min(w, 1 - x));
        const ch = round4(Math.min(h, 1 - y));
        if (cw < MIN_SIZE || ch < MIN_SIZE) continue;
        out.push({ x: round4(x), y: round4(y), w: cw, h: ch });
    }
    if (out.length === 0) return undefined;
    out.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
}
