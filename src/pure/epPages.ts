/**
 * 选集弹窗的**分页**（#576）。
 *
 * 🔴 由来：用户「三、选集弹窗重构」——「**分页与展示**：每页展示 N 集（图标形式），
 *    下放显示分页 `1 2 3 ... 8 9 10`，并加入 `<`（上一页）和 `>`（下一页）按钮」。
 *    ⇒ **翻面 #573** 的「区间档签」（`1-50 / 51-52`）—— 档签与页码条是同一件事的两种形态，
 *      留着两套必然分叉（本仓「同一概念只准一份真源」）。
 *
 * 🔴 **页大小 = 100**（#600 用户改口径：「**100 集以上加分页**」）：原先那档（每页五十余集）
 *    在**四列**布局下会把正常长篇切成一堆薄页 ⇒ 改成 100 后，**100 集（含）以内一律一页**，
 *    第 101 集起才出现第二页。页大小是**产品口径**，改它只改这一个常量
 *    （四个函数都把它当默认参数，⛔ 别在调用点各写一份数字）。
 *
 * 🔴 为什么抽纯模块：分页是**算出来的**（总集数 → 页数、集号 → 第几页、页码条该显示哪几个数），
 *    而弹窗是 DOM-API 组件（⛔ 不进单测）；这里出的四个函数就是那条「算」的边界。
 *
 * 纯逻辑无 obsidian / 无 DOM，可单测。
 */

/** 每页几集（用户口径：100） */
export const EP_PAGE_SIZE = 100;

/** 页码条里的一格：页号（**1 基**，给人看的）或省略号 */
export type PageBarItem = number | '…';

/** 总集数 → 页数（至少 1 页；非法 / 0 集 ⇒ 1） */
export function pageCount(total: number, size: number = EP_PAGE_SIZE): number {
    const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const s = Number.isFinite(size) && size >= 1 ? Math.floor(size) : EP_PAGE_SIZE;
    return Math.max(1, Math.ceil(n / s));
}

/**
 * 第 `index`（**0 基**，与 `episodeFiles` 下标同一套）集落在哪一页（0 基页号）。
 * 越界 / 非法 ⇒ `0`（打开弹窗时用它决定默认停在哪一页，⛔ 不许返回 `-1` 那种让调用方再判一次的值）。
 */
export function pageIndexOf(index: number, size: number = EP_PAGE_SIZE): number {
    const s = Number.isFinite(size) && size >= 1 ? Math.floor(size) : EP_PAGE_SIZE;
    const i = Number.isFinite(index) ? Math.floor(index) : 0;
    return i <= 0 ? 0 : Math.floor(i / s);
}

/** 某页覆盖的 **0 基下标区间** `[start, end)`（渲染切片用）；页号越界钳到最后（空集 ⇒ `[0,0]`）。 */
export function pageSlice(page: number, total: number, size: number = EP_PAGE_SIZE): [number, number] {
    const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const s = Number.isFinite(size) && size >= 1 ? Math.floor(size) : EP_PAGE_SIZE;
    const pages = pageCount(n, s);
    const p = Number.isFinite(page) ? Math.min(pages - 1, Math.max(0, Math.floor(page))) : 0;
    const start = p * s;
    return [start, Math.min(n, start + s)];
}

/**
 * 页码条该显示哪几格。
 *
 * 规则（**首段 3 + 当前页窗口 ±1 + 末段 3**，去重排序，中间断开处插 `'…'`）：
 *   · 页数 ≤ 7 ⇒ **全列**（7 格以内没有省略的意义）；
 *   · 否则恒含 `1 2 3` 与 `最后三页`；当前页附近恒含 `c-1 c c+1`。
 *   ⚠️ **当前页永远在列**（这是页码条存在的意义）—— 例：10 页时停在第 1 页 ⇒ `1 2 3 … 8 9 10`
 *      （正是用户给的那串）；停在第 5 页 ⇒ `1 2 3 4 5 6 … 8 9 10`。
 * ⚠️ `current` 是 **0 基**页号（与 `pageIndexOf` 同一套），越界钳制。
 */
export function pageBarItems(totalPages: number, current: number): PageBarItem[] {
    const t = Math.max(1, Math.floor(Number.isFinite(totalPages) ? totalPages : 1));
    const c0 = Number.isFinite(current) ? Math.min(t - 1, Math.max(0, Math.floor(current))) : 0;
    const c = c0 + 1; // 换成 1 基
    if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1);
    const keep = new Set<number>();
    for (const n of [1, 2, 3, c - 1, c, c + 1, t - 2, t - 1, t]) {
        if (n >= 1 && n <= t) keep.add(n);
    }
    const nums = [...keep].sort((a, b) => a - b);
    const out: PageBarItem[] = [];
    let prev = 0;
    for (const n of nums) {
        if (prev && n - prev > 1) out.push('…');
        out.push(n);
        prev = n;
    }
    return out;
}

/** 翻页：目标页号（**0 基**，越界钳到首/末）；`delta` = ±1 */
export function pageStep(page: number, totalPages: number, delta: number): number {
    const t = Math.max(1, Math.floor(Number.isFinite(totalPages) ? totalPages : 1));
    const p = Number.isFinite(page) ? Math.floor(page) : 0;
    const d = Number.isFinite(delta) ? Math.floor(delta) : 0;
    return Math.min(t - 1, Math.max(0, p + d));
}
