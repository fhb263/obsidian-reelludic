// 数字输入框的「滚轮增减」纯逻辑（#556，用户 2026-10-08）。
//
// 用户原话：「滚轮数值选择器（鼠标悬停在数字输入框上，滚动滚轮即可增减数值），**明确规定只有输入框
//   处于聚焦（Focus）状态时**，滚轮才生效。并且滚轮事件必须**阻止冒泡，不让页面跟着滚**。」
//
// 🔴 为什么抽纯模块：本仓所有「算一个值」的逻辑都要能单测。DOM 侧（挂 `wheel`、读 `activeElement`、
//    写回 `.value` 并派发 `input`/`change`）只做接线，判定全在这里。
// ⚠️ **门控是硬规矩**：未聚焦时必须**原样放行**（不 `preventDefault`、不 `stopPropagation`）——
//    否则页面/弹窗在指针滑过输入框时就滚不动了（用户点名要防的正是这个）。
// ⚠️ 浮点步长（如 `step="0.1"`）会攒出 `0.30000000000000004` 这类值 ⇒ 结果按**步长的小数位**回正。

/** 浮点回正：按步长的小数位四舍五入（`step=0.1` ⇒ 1 位；`step=1` ⇒ 0 位） */
function roundToStep(x: number, step: number): number {
    const s = String(step);
    const dot = s.indexOf('.');
    const digits = dot >= 0 ? Math.min(10, s.length - dot - 1) : 0;
    const f = Math.pow(10, digits);
    return Math.round(x * f) / f;
}

/**
 * 滚轮后的新值（保持 `null` 语义：输入框为空且没有 `min` ⇒ 从 0 起算）。
 *
 * @param raw   当前 `el.value`（空串 = 未填）
 * @param dir   `1` = 增（滚轮向上 / `deltaY < 0`），`-1` = 减
 * @param step  `el.step` 解析值（非正数 ⇒ 回落到 1）
 * @param min   `el.min` 解析值（无 ⇒ -Infinity）
 * @param max   `el.max` 解析值（无 ⇒ Infinity）
 * @returns 新值；**undefined** = 这次滚轮不动（无变化 / 当前值不是数），调用方据此决定是否写回
 */
export function wheelStepValue(
    raw: string,
    dir: 1 | -1,
    step: number,
    min: number,
    max: number,
): number | undefined {
    const st = Number.isFinite(step) && step > 0 ? step : 1;
    const lo = Number.isFinite(min) ? min : -Infinity;
    const hi = Number.isFinite(max) ? max : Infinity;
    const cur = raw.trim() === ''
        ? (Number.isFinite(lo) ? lo : 0)
        : Number(raw);
    if (!Number.isFinite(cur)) return undefined;
    let next = cur + dir * st;
    if (next < lo) next = lo;
    if (next > hi) next = hi;
    next = roundToStep(next, st);
    if (String(next) === raw) return undefined;
    return next;
}

/** 把 `el.min` / `el.max` / `el.step` 这三个字符串解析成 `wheelStepValue` 要的形状（空串 = 无界） */
export function parseNumberBounds(el: {
    min: string; max: string; step: string;
}): { min: number; max: number; step: number } {
    const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
    return { min: num(el.min), max: num(el.max), step: num(el.step) };
}

/**
 * 该事件目标是不是「该被本机制接管」的数字输入框。
 * 🔴 只有 `type="number"` 才算 —— 文本型日期/章节框里滚轮改值会变成「手滑改数据」的暗雷。
 * ⚠️ 这个判据与「是否聚焦」分开：调用方必须**先**判它、**再**判聚焦，两步都要过才接管。
 */
export function isNumberInputTarget(t: unknown): t is HTMLInputElement {
    return !!t
        && typeof t === 'object'
        && (t as { tagName?: string }).tagName === 'INPUT'
        && (t as HTMLInputElement).type === 'number';
}
