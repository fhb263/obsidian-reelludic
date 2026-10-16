// 页签键盘导航（纯逻辑：方向键 → 目标下标；无 obsidian、无 DOM）
//
// 背景：一级页签已有 role="tablist"/role="tab"/aria-selected，但**没有** roving tabindex ——
// 6 个页签都在 Tab 序列里，键盘要按 6 次才能越过整组；且组内不能用方向键移动。
// ARIA APG 的 Tabs 模式要求：整组只占一个 Tab 停留点（仅当前页签 tabindex=0，其余 -1），
// 进入后用 ←/→ 在页签间移动（自动激活），Home/End 跳首尾。
//
// 本模块只回答「按了这个键该去哪一页」，DOM 焦点与 aria 属性由视图层落地。

/** 页签排列方向（当前只有水平一种；竖向预留） */
export type TabOrientation = 'horizontal' | 'vertical';

export interface TabKeyResult {
    /** 目标页签下标（已钳制在 [0, count-1]） */
    index: number;
    /** 是否由本按键触发导航（false = 该按键与此组件无关，视图层应放行） */
    handled: boolean;
}

/**
 * 方向键 / Home / End → 目标页签下标。
 *
 * - 水平：← → 移动；竖向：↑ ↓ 移动（另一对方向键不放行，留给页面滚动）
 * - **回绕**：首项按 ← 到末项、末项按 → 到首项（APG 推荐；`wrap: false` 时在边界停住）
 * - Home / End：跳到首 / 末项
 * - 其它按键：`handled: false`，调用方不要 preventDefault（否则会吃掉 Tab、输入法等默认行为）
 * - 空组（count ≤ 0）或非法下标：返回 handled: false，不制造越界下标
 */
export function resolveTabKey(
    key: string,
    currentIndex: number,
    count: number,
    opts: { orientation?: TabOrientation; wrap?: boolean } = {},
): TabKeyResult {
    const orientation = opts.orientation ?? 'horizontal';
    const wrap = opts.wrap ?? true;
    const n = Math.floor(count);
    if (!Number.isFinite(n) || n <= 0) return { index: 0, handled: false };

    const cur = Math.min(Math.max(0, Math.floor(currentIndex) || 0), n - 1);
    const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';

    if (key === 'Home') return { index: 0, handled: true };
    if (key === 'End') return { index: n - 1, handled: true };
    if (key !== prevKey && key !== nextKey) return { index: cur, handled: false };

    const step = key === nextKey ? 1 : -1;
    const raw = cur + step;
    if (raw < 0 || raw >= n) {
        // 边界：回绕到另一端，或原地不动（wrap=false 时仍返回 handled:true —— 按键确实是导航意图，只是无处可去）
        return { index: wrap ? (raw < 0 ? n - 1 : 0) : cur, handled: true };
    }
    return { index: raw, handled: true };
}
