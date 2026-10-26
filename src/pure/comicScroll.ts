// 漫画阅读器·连续滚动的**纯逻辑**（#669，用户 2026-10-19）—— 零 `obsidian` / 零 DOM / 零网络，可单测。
//
// 由来：用户点名「把右侧缩略图同步滚动和连续滚动效果加回来」。上一版那两件在代码里**是存在的**
//   （#636 ⑤），但实测下来是「在、但用不了」：
//     · 连续滚动下滚轮被 `onWheel` 拦去**翻页**（与「连续滚动」自相矛盾）；
//     · 切模式时 `buildScrollPages()` 被调用两次（第二次 `col.empty()` 把正在插图的那批 DOM 摘掉）；
//     · 页块靠 `min-height: 240px` 占位、图回来后再撑开 ⇒ 边滚边跳、缩略图同步来回抖；
//     · 缩略图栏只在**换页后**才 `scrollIntoView`，正文滚动时它不动（用户读成「没同步」）。
//
// 🔴 本模块只负责「算」：位置、比例、高度、该不该触发。视图层只负责把算出来的数写进 DOM。
//    这些数**算错不报错、只是错位/跳动**，所以必须下沉重放（单测 + 真 Chrome 复现页两路取证）。
//
// 与 `pure/comicViewer` 的分工（⛔ 别混）：
//   · `comicViewer.pageAtScroll(tops, scrollTop)` = **单页制**从滚动位置反推页号（页面顶已经滚过 ⇒ 就是它）；
//   · 本模块的 `pageAtViewport` = **连续滚动**的「哪一页正占着视口中线」（读者眼睛所在的那一页）。

/** 一页的几何（相对滚动容器；单位 px） */
export interface PageRect {
    top: number;
    height: number;
}

export interface ViewportSize {
    scrollTop: number;
    clientHeight: number;
}

/** 缩略图栏的滚动几何（内容高 / 可视高） */
export interface StripGeometry {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

/**
 * 视口里「读者正在看」的那一页 = **覆盖视口中线（v/2）的那一页**。
 *
 * 🔴 为什么是中线而不是「页顶滚过」（`comicViewer.pageAtScroll` 那套）：连续滚动时页与页首尾相接，
 *    「页顶滚过容器顶」意味着**上一页已经整页离屏** —— 用户其实已经在读下一页了，高亮却还停在前一页。
 *    用中线则恒有且仅有一页满足 `top <= y + v/2 < top + h`（页与页不重叠、不留缝），
 *    这正是所有「连续滚动 + 同步导航」产品的口径。
 *
 * ⚠️ 三种退化必须各自有明确答案（都测到了）：
 *   · 空页表 → 0（没有页，别再往下算）；
 *   · 末尾露白（最后一页比视口矮、滚到底时中线落进空白）→ **返回最后一页**，⛔ 不能返回 -1；
 *   · 页高全为 0（还没量出来）→ 按**页序**退化（中线位置在数组里插值），不会全塌到 0。
 */
export function pageAtViewport(rects: readonly PageRect[], scrollTop: number, clientHeight: number): number {
    const n = rects.length;
    if (n === 0) return 0;
    const st = Number.isFinite(scrollTop) ? scrollTop : 0;
    const ch = Number.isFinite(clientHeight) ? Math.max(0, clientHeight) : 0;
    const y = st + ch / 2;
    // 先夹住上界：滚过末尾（露白）时按最后一页算
    if (y <= rects[0].top) return 0;
    let last = 0;
    for (let i = 0; i < n; i++) {
        const r = rects[i];
        if (r.top <= y) last = i;
        else break;
    }
    // 🔴 末尾补偿：最后几页比视口矮时，中线**永远到不了**它们（`maxScroll + v/2 < 末页底`），
    //    于是「滚到底」会停在中线恰好落进的那一页 —— 与读者「我已经看完了」的认知不符。
    //    判据 = 已经贴着底部（`st + v >= 内容总高 - 1`）、且中线**没进最后一页**
    //    （兜住「最后一页其实很高、只是滚动量被夹住」那一类：那时中线本来就在末页，⛔ 别再补偿）。
    //    ⚠️ 只在**贴底**时补偿：滚到中间时中线落谁就是谁，⛔ 别把「最后一页」提前点亮。
    const lastTop = rects[n - 1].top;
    const totalH = lastTop + Math.max(0, rects[n - 1].height);
    const atBottom = st + ch >= totalH - 1;
    if (atBottom && last < n - 1 && y < lastTop) last = n - 1;
    return last;
}

/**
 * 缩略图栏要滚到哪儿，才能让**当前页那一格**落在可视区里。
 *
 * 规则三条（用户体感优先）：
 *   ⑴ 已在可视区内（含 1px 亚像素容差）⇒ **不动**（`return geo.scrollTop`）—— 一格 96px 的栏每次滚都微调
 *      会让整栏抖成一团；这是「同步滚动」看起来最像「卡顿」的成因。
 *   ⑵ 不在可视区 ⇒ 让该格落在**可视区中位**（`block:'center'` 的直觉），上下都留出前后页的预览。
 *   ⑶ 结果钳到 `[0, scrollHeight - clientHeight]`（⛔ 不产出越界值 —— 浏览器会自己夹，但我们要能单测）。
 */
export function thumbScrollTarget(geo: StripGeometry, cell: PageRect, padTop = 0): number {
    const max = Math.max(0, geo.scrollHeight - geo.clientHeight);
    const cur = clamp(geo.scrollTop, 0, max);
    const top = Number.isFinite(cell.top) ? cell.top : 0;
    const h = Number.isFinite(cell.height) ? Math.max(0, cell.height) : 0;
    const view = geo.clientHeight;
    if (view <= 0) return cur;
    const slop = 1;
    if (top >= cur - slop && top + h <= cur + view + slop) return cur;
    const want = top - (view - h) / 2 - padTop;
    if (!Number.isFinite(want)) return cur;
    return clamp(want, 0, max);
}

/**
 * 连续滚动里「内容比例 → 滚动位置」的映射（滚动条/进度滑块拖动的逆运算）。
 *
 * 🔴 为什么不用 `scrollTop / scrollHeight` 直接换：滚动的**可用行程**是
 * `scrollHeight - clientHeight`，拿 `scrollHeight` 当分母会把「滚到底」算成 90% 出头，
 * 滑块永远差一截到不了底（参考实现 `cbz-reader` 里绕了三层才绕对，我们这里一条式子说清）。
 */
export function ratioToScrollTop(ratio: number, scrollHeight: number, clientHeight: number): number {
    const max = Math.max(0, scrollHeight - clientHeight);
    const r = Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0;
    return clamp(r * max, 0, max);
}

/** 逆运算（滚动时算「读到全书哪个比例」，用于滑块位置与 `scrollRatio` 落库） */
export function scrollTopToRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
    const max = Math.max(0, scrollHeight - clientHeight);
    if (max <= 0) return 0;
    const st = Number.isFinite(scrollTop) ? scrollTop : 0;
    return clamp(st / max, 0, 1);
}

/**
 * 每格缩略图的**滚动步长**（栏里一格占多少纵向空间）。
 * 优先量真实格子（`offsetHeight + gap`），量不到（还没挂 / `display:none`）时退回常量 ——
 * ⛔ 别在缺值时返回 0：那会让「第 i 格在第几 px」整列塌成 0。
 */
export function cellStride(cellHeight: number, gap = 6, fallback = 96): number {
    const h = Number.isFinite(cellHeight) && cellHeight > 0 ? cellHeight : 0;
    const step = h > 0 ? h + Math.max(0, gap) : fallback;
    return step > 0 ? step : 1;
}

/** 第 `index` 格在栏内容坐标系里的位置（`top` 起算，`height` = 一格高） */
export function cellRect(index: number, stride: number, cellHeight: number, padTop = 0): PageRect {
    const i = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
    const s = stride > 0 ? stride : 1;
    const h = Number.isFinite(cellHeight) && cellHeight > 0 ? cellHeight : s;
    return { top: padTop + i * s, height: h };
}

/**
 * 正文页在容器里的**占位宽高**（图还没来就先写死它 ⇒ ⛔ 消除「加载完才撑开」的跳动）。
 *
 * 口径与单页制 `ComicReaderModal.fitWidth` 完全一致：**可用宽与可用高的 contain 双约束**
 * × 缩放，高度按真实纵横比。取不到纵横比（还没加载过 / 坏图）⇒ 用 `fallbackRatio`（漫画页常见 1:1.45）。
 * 峰值钳制：图未到时给一个 1×1 的小块也行，但**高度不能是 0**（0 高的块在 IntersectionObserver 里永不命中，
 * 会把自己饿死 —— 这是懒加载最经典的自锁）。
 */
export function pageBox(
    naturalW: number,
    naturalH: number,
    availW: number,
    availH: number,
    zoom: number,
    fallbackRatio = 1.45,
): { width: number; height: number } {
    const aw = Number.isFinite(availW) && availW > 0 ? availW : 0;
    const ah = Number.isFinite(availH) && availH > 0 ? availH : 0;
    const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const nw = Number.isFinite(naturalW) && naturalW > 0 ? naturalW : 0;
    const nh = Number.isFinite(naturalH) && naturalH > 0 ? naturalH : 0;
    const ratio = nw > 0 && nh > 0 ? nh / nw : Math.max(0.2, fallbackRatio);
    // 缩放 = 1 时是 contain；>1 时允许溢出（连续模式里正文变宽 ⇒ 容器横向可滚）
    let w = aw > 0 ? aw : 0;
    if (w > 0 && ah > 0) w = Math.min(w, ah / ratio);
    w = Math.max(1, Math.round(w * z));
    const h = Math.max(1, Math.round(w * ratio));
    return { width: w, height: h };
}

/**
 * 读图的**优先级**：离当前页越近越先取。
 * 🔴 上一版按页序 `for (i = start; i <= end; i++)` 串行取 ⇒ 用户已经滚到第 50 页，
 *    系统还在补第 44、45 页（旧窗口里剩下的），当前页反而最后才到。排序是「反正要跑一遍」的零成本修正。
 */
export function sortByDistance(indices: readonly number[], current: number): number[] {
    const c = Number.isFinite(current) ? current : 0;
    return [...indices].sort((a, b) => {
        const da = Math.abs(a - c);
        const db = Math.abs(b - c);
        if (da !== db) return da - db;
        return a - b; // 距离相同 ⇒ 页序小者先（阅读方向）
    });
}

/**
 * 滚轮事件的**有效位移**。
 *   · 连续模式：滚轮就是**滚动**（用户裁定）；`deltaMode` 为 1（行）/ 2（页）时要换算成 px，
 *     否则 Firefox 一类环境一次只滚 3px，等于没滚。
 *   · `shift + 滚轮` 横向（容器可能横向溢出：缩放 > 1 时正文比容器宽）。
 *
 * ⚠️ `wheelDeltaOf` **不做**「要不要翻页」的判断 —— 那是模式的事，留在视图层（`onWheel` 里一句 `if`）。
 */
export function wheelDeltaOf(ev: { deltaY: number; deltaX?: number; deltaMode?: number; shiftKey?: boolean }, linePx = 36, pagePx = 600): { dx: number; dy: number } {
    const mode = ev.deltaMode === 1 ? linePx : ev.deltaMode === 2 ? pagePx : 1;
    const rawX = Number.isFinite(ev.deltaX ?? 0) ? (ev.deltaX ?? 0) : 0;
    const rawY = Number.isFinite(ev.deltaY) ? ev.deltaY : 0;
    const x = ev.shiftKey ? rawY : rawX;
    const y = ev.shiftKey ? 0 : rawY;
    return { dx: x * mode, dy: y * mode };
}

/** `ctrl/⌘ + 滚轮` 缩放的新档位（用户裁定：连续模式也支持）。`deltaY < 0`（上滚）= 放大。 */
export function zoomAfterWheel(zoom: number, deltaY: number, min: number, max: number, step: number): number {
    const z = Number.isFinite(zoom) ? zoom : 1;
    const dir = deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0;
    const next = z + dir * step;
    const st = step > 0 ? step : 0.25;
    // 与 `applyZoom` 同一套吸附（按档位取整），否则 1.1 / 1.15 这种残值会让滑条对不上
    const snapped = Math.round(next / st) * st;
    const lo = Number.isFinite(min) && min > 0 ? min : 0.5;
    const hi = Number.isFinite(max) && max > lo ? max : 4;
    return Math.max(lo, Math.min(hi, snapped));
}

/**
 * 还原时的滚动位置：`progress.scrollRatio` 是**全书页间进度**（不是一个页内比例）。
 *
 * 🔴 口径（与 PDF 面板一致）：`ratio = 0` ⇒ 停在该页**顶部**；`ratio > 0` ⇒ 停在那页的**中线处**
 *    （用户上次就是看到「这一页的中段」），`ratio = 1` ⇒ 页底部。⛔ 不把 ratio 当 scrollTop 百分比
 *    （那是容器比例，换本书/换窗宽就全错）。
 */
export function restoreScrollTop(pageTop: number, pageHeight: number, viewH: number, ratio: number): number {
    const top = Number.isFinite(pageTop) ? pageTop : 0;
    const h = Number.isFinite(pageHeight) && pageHeight > 0 ? pageHeight : 0;
    const v = Number.isFinite(viewH) && viewH > 0 ? viewH : 0;
    const r = Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0;
    if (r <= 0) return Math.max(0, top);
    const want = top + r * h - v / 2;
    return Math.max(0, Math.round(want));
}

/** 每页占位块的**预估纵横比**缺省值（横版跨页 / 竖版漫画页的常见中位；⛔ 别用 1.0，那会让占位比真实页矮一截） */
export const PAGE_RATIO_FALLBACK = 1.45;

function clamp(v: number, lo: number, hi: number): number {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}
