// 弹窗拖动（用户 m17476：「百度搜索的内弹窗要像微信扫码登录弹出的那个界面一样可拖动」）。
//
// 🔴 参照物是**独立 OS 窗口**，不是 Modal：
//    `QrLoginModal` 的微信读书那一档走 `services/qrLogin.openWereadWindow()`，
//    里面是 `new BW({ width: 460, height: 640, title: '登录微信读书' })` —— 带系统标题栏，
//    **拖动是操作系统白送的**，插件一行拖拽代码都没有。内嵌 Modal 没有标题栏 ⇒ 只能自己实现。
//
// 🔴 为什么用 `transform: translate()` 而不是 `style.left/top`：
//    Obsidian 的 `.modal-container` 是 flex 居中，`.modal` 的 left/top 由布局决定。
//    写死 left/top 会与居中规则互相打架（换窗口尺寸时跳位、`inset` 也被覆盖）。
//    `transform` 是纯附加位移、不参与布局 ⇒ 居中照旧生效，只把整块挪开。
//
// 🔴 为什么必须夹取：独立窗口有系统兜底（拖不出屏幕）。内嵌 Modal 没有 ——
//    不夹取就能把弹窗拖到视口外完全看不见，用户除了重启 Obsidian 没有别的出路。
//    夹取规则见 `dragAxisRange`：能整块放进视口就保证整块可见；放不下则至少留 `DRAG_MARGIN` 露头。
//
// ⚠️ 本模块**不碰 DOM 事件**（`addEventListener` / `setPointerCapture` 在 `modals/BaiduSearchModal`），
//    只做纯算术，便于单测钉住边界 —— 与 `pure/readerToc` 把宽度夹取留给调用方是同一分工。

/** 拖动位移（相对弹窗被布局摆到的原始位置） */
export interface DragOffset {
    x: number;
    y: number;
}

/** 弹窗在视口坐标系里的矩形（`getBoundingClientRect()` 的四个字段） */
export interface DragBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** 视口尺寸（`window.innerWidth` / `innerHeight`） */
export interface ViewportSize {
    width: number;
    height: number;
}

/**
 * 拖到边界时至少留多少像素露在视口里。
 * ⚠️ 太小（比如 2px）会抓不住标题栏，太大（比如 64px）在大弹窗上几乎拖不动。
 */
export const DRAG_MARGIN = 12;

/**
 * 拖动时可作为「空白处」放行拖拽的元素选择器 —— 命中就**不启动拖动**。
 *
 * 🔴 头部同时放着「重新加载 / 在浏览器打开」两颗按钮，若整块都吃 pointerdown，
 *    用户按按钮时会被 `preventDefault()` 吞掉 click（表现 = 按钮点了没反应）。
 *    `contenteditable` 同理：将来若在头部加搜索框，也不该被拖动抢走。
 */
export const DRAG_IGNORE_SELECTOR = 'button, a, input, textarea, select, [contenteditable="true"]';

/**
 * 单轴允许的位移区间（闭区间）。
 *
 * 两档语义：
 *  · 弹窗整块放得进视口 ⇒ 区间 = 「左边缘 ≥ margin」到「右边缘 ≤ 视口 - margin」，即**整块可见**；
 *  · 整块比视口还大（大弹窗 + 小窗）⇒ 整块可见不可能，退化为「至少 `margin` 像素露头」，
 *    ⛔ 别在这种情况下返回空区间把拖动整个禁掉（那会让小窗口下的弹窗完全拖不动）。
 *
 * @param boxStart 未位移时该轴的起点（left / top）
 * @param boxSize 该轴尺寸（width / height）
 * @param viewportSize 视口该轴尺寸（innerWidth / innerHeight）
 */
export function dragAxisRange(
    boxStart: number,
    boxSize: number,
    viewportSize: number,
    margin = DRAG_MARGIN,
): [number, number] {
    const wholeMin = margin - boxStart;
    const wholeMax = viewportSize - margin - (boxStart + boxSize);
    if (wholeMin <= wholeMax) return [wholeMin, wholeMax];
    // 整块放不下：保证「底/右边 ≥ margin」与「顶/左边 ≤ 视口 - margin」
    return [margin - (boxStart + boxSize), viewportSize - margin - boxStart];
}

function clampAxis(value: number, min: number, max: number): number {
    // 脏值（NaN / Infinity）一律归零：拖动中途算出 NaN 会把弹窗挪到 1e38px 之外
    if (!Number.isFinite(value)) return 0;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/** 把任意位移夹进「弹窗仍在视口内（至少露头）」的范围 */
export function clampDragOffset(
    offset: DragOffset,
    box: DragBox,
    viewport: ViewportSize,
    margin = DRAG_MARGIN,
): DragOffset {
    const [minX, maxX] = dragAxisRange(box.left, box.width, viewport.width, margin);
    const [minY, maxY] = dragAxisRange(box.top, box.height, viewport.height, margin);
    return { x: clampAxis(offset.x, minX, maxX), y: clampAxis(offset.y, minY, maxY) };
}

/**
 * 本次移动后的**未夹取**位移 = 起始位移 + 指针位移。
 * ⚠️ 夹取调用方来做（这样一次拖动里只算一次区间）。
 */
export function dragOffsetAfter(start: DragOffset, dx: number, dy: number): DragOffset {
    return {
        x: start.x + (Number.isFinite(dx) ? dx : 0),
        y: start.y + (Number.isFinite(dy) ? dy : 0),
    };
}

/** 指针落点是否落在「不该启动拖动」的元素上（按钮 / 输入框 / 可编辑区） */
export function dragIgnored(target: Element | null | undefined): boolean {
    if (!target) return false;
    if (typeof target.closest !== 'function') return false;
    return target.closest(DRAG_IGNORE_SELECTOR) !== null;
}

/** 位移是否为零（决定要不要写 `transform`：归零时清掉样式，避免留下 `translate(0px, 0px)`） */
export function dragOffsetIsZero(offset: DragOffset): boolean {
    return offset.x === 0 && offset.y === 0;
}

// ── 改宽高（用户 m17616：「现在是全屏搜索窗口，不能拖动改宽度」）────────────────
//
// 🔴 为什么不能只加「拖动右下角」这一条路：
//    用户要的是「和别的窗口并排看」。只有角上能拖的话，往右拉宽就必然同时拉高，
//    并排时更挤。所以三条边都要能拉：右边（只改宽）、下边（只改高）、右下角（两者一起）。
//
// ⚠️ 下限不是「好看」，是「还能用」：百度页在 < 420px 宽时结果列表挤成一列看不清，
//    高度 < 300 时连一行结果都放不下。下限写在这里，UI 层不许各写一份。

/** 弹窗可缩到的最小宽度（再窄百度结果列表就挤成一列看不清） */
export const MODAL_MIN_WIDTH = 420;
/** 弹窗可缩到的最小高度（再矮连一行搜索结果都放不下） */
export const MODAL_MIN_HEIGHT = 300;

/**
 * 单轴改尺寸后的尺寸（夹到 `[min, max]`）。
 *
 * ⚠️ 脏增量的两种语义要分开：
 *   · `NaN`（算不出来）⇒ 按 0 处理，尺寸原地不动；
 *   · `±Infinity`（指针拖到无穷远）⇒ 按**该方向的极值**处理，即顶到上限 / 下限。
 *     ⛔ 别统一按 0 —— 那样「一口气拖到屏幕外」会变成「纹丝不动」，看着像卡死。
 */
export function resizeAxisSize(
    startSize: number,
    delta: number,
    min: number,
    max: number,
): number {
    if (!Number.isFinite(startSize)) return min;
    // `max` 可能小于 `min`（视口比下限还小）⇒ 以 min 为准，否则会写出反向区间
    const hi = Math.max(min, max);
    const raw = startSize + delta;
    if (Number.isNaN(raw)) return startSize;
    if (raw === Number.POSITIVE_INFINITY) return hi;
    if (raw === Number.NEGATIVE_INFINITY) return min;
    const want = raw;
    if (want < min) return min;
    if (want > hi) return hi;
    return want;
}

/**
 * 某条边允许的最大尺寸 = 视口该轴 - 2×`margin`（左右各留一点，别顶到屏幕边）。
 * ⚠️ 与 `min` 取 max：视口比下限还小时宁可溢出，也别缩成不可用。
 * ⚠️ `min` 必须由调用方按轴传（宽传宽的下限、高传高的下限）——
 *    早先这里写死 `MODAL_MIN_WIDTH`，高轴在小视口下会被抬到 420 而不是 300。
 */
export function resizeMaxSize(
    viewportSize: number,
    min: number,
    margin = DRAG_MARGIN,
): number {
    if (!Number.isFinite(viewportSize)) return min;
    return Math.max(min, viewportSize - margin * 2);
}

/** 是否是可改尺寸的边（`e` 右边只改宽 / `s` 下边只改高 / `se` 角上一起改） */
export type ResizeEdge = 'e' | 's' | 'se';
