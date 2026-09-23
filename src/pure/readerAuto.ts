// 阅读器「自动」推进的**速度**参数（#341：右键轻弹窗 + 横向滑条）。
// 纯函数（夹取 / 网格对齐 / 文案 / 记忆）在此单测；rAF 与定时器在三个阅读器 modal 里。
//
// 两条口径：
//   滚动模式 = **px/s** 匀速滑动（用户 2026-09-15 裁定：不要一屏一屏跳）；
//   翻页模式 = **每页停留毫秒**（原 AUTO_TURN_MS 定时器）。
// 两者单位不同 ⇒ 滑条按当前模式二选一取值，弹窗里同步显示带单位的当前值。

/** 滚动速度上下限（px/s）—— 50 慢到能跟上，450 约是原定速的 3 倍 */
export const AUTO_SCROLL_MIN = 50;
export const AUTO_SCROLL_MAX = 450;
/** 网格步长（px/s）：网格**锚定在 MIN**，与 `input[type=range]` 的 `min + k*step` 一致 */
export const AUTO_SCROLL_STEP = 20;
/** 缺省 = 用户 2026-09-15 裁定的定速（150px/s 在网格上：50 + 5×20） */
export const AUTO_SCROLL_DEFAULT = 150;

/** 翻页间隔上下限（ms）：1.5 秒一页已是快速浏览的上限，20 秒一页够慢 */
export const AUTO_TURN_MIN_MS = 1500;
export const AUTO_TURN_MAX_MS = 20000;
export const AUTO_TURN_STEP_MS = 250;
export const AUTO_TURN_DEFAULT_MS = 5000;

/** 记忆滚动速度（localStorage：跨书共享，与 `pure/readerToc` 同一做法，不加设置字段） */
export const AUTO_SCROLL_KEY = 'rl-reader-auto-scroll';

function snap(v: number, min: number, max: number, step: number, fallback: number): number {
    if (!Number.isFinite(v) || v <= 0) return fallback; // 🔴 速度为 0 = 「开了自动却不动」，比不开更困惑
    if (v <= min) return min;
    if (v >= max) return max;
    // 锚定 min 取最近网格（滑条只会吐网格值，键盘/手写值在这里被吸回去）
    return min + Math.round((v - min) / step) * step;
}

/** 夹取 + 网格对齐滚动速度（px/s）；非法 / ≤0 → 缺省 150 */
export function clampAutoScrollPx(v: number): number {
    return snap(v, AUTO_SCROLL_MIN, AUTO_SCROLL_MAX, AUTO_SCROLL_STEP, AUTO_SCROLL_DEFAULT);
}

/** 夹取 + 网格对齐翻页间隔（ms）；非法 / ≤0 → 缺省 5000 */
export function clampAutoTurnMs(v: number): number {
    return snap(v, AUTO_TURN_MIN_MS, AUTO_TURN_MAX_MS, AUTO_TURN_STEP_MS, AUTO_TURN_DEFAULT_MS);
}

/**
 * 🔴 速度**底层真源仍是 px/s**（不改：改了既有记忆值会整体失真，且 PDF 阅读器与它共用）。
 *    #351 起只把**显示**换成「字/分」—— 阅读场景里「每分钟读多少字」才是用户能对照的量。
 *
 * 换算基准字号：CJK 全角字宽 ≈ 1em ⇒ 每字宽 ≈ 字号(px)。
 * ⚠️ 缺省 17 是给 **PDF 阅读器**用的（它没有字号设置，取与正文默认同值）。
 */
export const AUTO_SCROLL_FONT_BASE = 17;

/** 换算成「字/分」（含非法字号兜底与 ≥1 下限；滑块上不出现 0 或 NaN） */
export function autoSpeedChars(px: number, fontPx: number = AUTO_SCROLL_FONT_BASE): number {
    const f = Number.isFinite(fontPx) && fontPx > 0 ? fontPx : AUTO_SCROLL_FONT_BASE;
    const chars = (clampAutoScrollPx(px) * 60) / f;
    return Math.max(1, Math.round(chars));
}

/** 滚动速度文案（带单位）：`529 字/分` */
export function autoSpeedLabel(px: number, fontPx: number = AUTO_SCROLL_FONT_BASE): string {
    return `${autoSpeedChars(px, fontPx)} 字/分`;
}

/** 翻页间隔文案：换算成秒、一位小数、整数秒不带 .0 */
export function autoTurnLabel(ms: number): string {
    const sec = clampAutoTurnMs(ms) / 1000;
    return `${Number.isInteger(sec) ? sec : sec.toFixed(1)} 秒/页`;
}

/**
 * 自动滚动推进一帧（#342）：返回**新的浮点位置**，由调用方自己存着（不要回读 `scrollTop`）。
 *
 * 🔴 为什么必须累积而不是 `el.scrollTop = el.scrollTop + speed*dt`：浏览器的 `scrollTop`
 *   **写入会被取整**（实测：写 0.83 读回 1、写 2.5 读回 3），于是每帧位移 = speed / 刷新率：
 *     · 120Hz 上 50px/s ⇒ 0.417px/帧 ⇒ 取整成 **0** ⇒ **看着完全不动**（用户报的「50px 没反应」）；
 *     · 60Hz 上 50px/s ⇒ 0.83px/帧 ⇒ 被抬成 1px ⇒ 实际 **60px/s（超速 20%）**，150px/s 同理跑到 180。
 *   浮点累加器把「真实位置」与服务侧绑定，外层只把结果写给 `scrollTop` ⇒ 速度准确、低速也真的推进。
 * 速度非正 / 非有限 → 位置不动（不把 NaN 写进滚动位置）；`max <= 0`（不可滚动）→ 不封顶。
 */
export function advanceAutoPos(pos: number, speed: number, dt: number, max: number): number {
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(dt) || dt <= 0) return pos;
    const next = pos + speed * dt;
    return max > 0 ? Math.min(max, next) : next;
}

/** 读取记忆滚动速度（不可用 / 未存 → null，由调用方回退缺省） */
export function loadAutoScrollPx(): number | null {
    try {
        const raw = localStorage.getItem(AUTO_SCROLL_KEY);
        if (raw === null) return null;
        return clampAutoScrollPx(Number(raw));
    } catch {
        return null;
    }
}

/** 记住滚动速度（写不进就下次仍是定速） */
export function saveAutoScrollPx(px: number): void {
    try {
        localStorage.setItem(AUTO_SCROLL_KEY, String(clampAutoScrollPx(px)));
    } catch {
        /* 静默 */
    }
}
