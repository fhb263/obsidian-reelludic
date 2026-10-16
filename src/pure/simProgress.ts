// 「添加条目」搜索的**模拟进度条**时间线（纯逻辑，可单测）—— #559，用户 2026-10-08。
//
// 用户给了完整的时间线/数值区间（原话摘要）：
//   🟢 第一段 0–200ms：0% → 10%。「防闪烁」：这 200ms 内**不显示任何加载动画**；
//      若 API 在 200ms 内返回 ⇒ 直接出结果、**不显示进度条**。
//   🟡 第二段 200ms–2s：10% → 70%。指数衰减（ease-out）：前期涨得快、越接近 70% 越慢。
//   🟠 第三段 2s–3s：70% → 80%。增长大幅放缓（进入「试探」状态）。
//   🔴 第四段 3s–5s：80% → 85%。「蠕动模式」：极缓慢地爬（带微小的心跳波动）。
//   🟣 第五段 5s–8s：85% → **90%（封顶）**。旁边追加文案「网络较慢，正在尽力加载…」；
//      超过 8s 显示「中止重试」按钮。⛔ 任何时候都**绝不能自已涨到 100%**。
//   🟢 完成冲刺：API 返回那一刻 → 清定时器 → 100ms 内拉满 100% + 淡出。
//
// 🔴 为什么抽纯模块：时间线是**纯函数 of 已耗时**，可以逐段钉死端点值（0/200/2000/3000/5000/8000）。
//    DOM 侧的定时器（50ms tick）与淡出动画留在组件里当接线。
// ⚠️ 与 `pure/searchProgress` **分工**：那个是**真实步骤**进度（多源搜索的实际回报）；
//    本模块是**在真实进度不可得时**的估计值。两者在组件里按「有真实 total 就用真实值」合并。
// ⚠️ 心跳波动用 `sin` 的**确定性**函数（⛔ 不用随机数）——否则单测没法钉值，
//    而且每次渲染抖动不同会让「蠕动」看起来像故障。

/** 0–200ms 不显示进度条（防闪烁） */
export const SIM_UI_DELAY_MS = 200;
/** 2s 起进入缓慢段；3s 起蠕动；5s 起封顶提示；8s 起给重试按钮 */
export const SIM_FAST_END_MS = 2000;
export const SIM_SLOW_END_MS = 3000;
export const SIM_TAIL_END_MS = 5000;
export const SIM_RETRY_MS = 8000;
/** 模拟进度的**硬封顶**（⛔ 永远不许自己到 100 —— 100 只能由「真返回」给） */
export const SIM_CAP = 90;
/** 超过它就在进度条旁改口提示「网络较慢」（用户第五段） */
export const SIM_SLOW_TEXT = '网络较慢，正在尽力加载…';

/** ease-out（指数衰减的常用近似）：`t=0 → 0`、`t=1 → 1`，前期快、尾部慢 */
function easeOutCubic(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    return 1 - Math.pow(1 - x, 3);
}

/**
 * 心跳波动（±0.6%，只在蠕动段叠加）：确定性 sin（⛔ 不用随机数 —— 随机值没法单测钉端点）。
 * 🔴 必须乘一个**端点归零**的窗（`sin(πt)`，`t` = 该段内的进度）——
 *    否则段边界会因波动偏出端点值（`3000ms` 本该正好是 80%），端点是要被单测钉死的。
 */
function heartbeat(ms: number, t: number): number {
    return Math.sin(ms / 130) * 0.6 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

/**
 * 已耗时 `ms` 对应的模拟百分比。
 * ⚠️ 返回值可能是小数（心跳段）—— 由调用方决定显示时是否取整。
 * 🔴 端点保证：`200 → 10`、`2000 → 70`、`3000 → 80`、`5000 → 85`、`≥8000 → 90`。
 */
export function simPctAt(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    if (ms < SIM_UI_DELAY_MS) return 0;
    if (ms < SIM_FAST_END_MS) return 10 + 60 * easeOutCubic((ms - SIM_UI_DELAY_MS) / (SIM_FAST_END_MS - SIM_UI_DELAY_MS));
    if (ms < SIM_SLOW_END_MS) return 70 + 10 * ((ms - SIM_FAST_END_MS) / (SIM_SLOW_END_MS - SIM_FAST_END_MS));
    if (ms < SIM_TAIL_END_MS) {
        const t = (ms - SIM_SLOW_END_MS) / (SIM_TAIL_END_MS - SIM_SLOW_END_MS);
        return 80 + 5 * t + heartbeat(ms, t);
    }
    if (ms < SIM_RETRY_MS) {
        const t = (ms - SIM_TAIL_END_MS) / (SIM_RETRY_MS - SIM_TAIL_END_MS);
        return 85 + 5 * t + heartbeat(ms, t);
    }
    return SIM_CAP;
}

/** 进度条**该不该出现**：200ms 之前的等待不显示任何加载动画（防闪烁） */
export function simVisibleAt(ms: number): boolean {
    return Number.isFinite(ms) && ms >= SIM_UI_DELAY_MS;
}

/** 5s 之后要把「正在搜索 N 个数据源」换成的那句提示；未到点 ⇒ undefined（保持原文案） */
export function simSlowTextAt(ms: number): string | undefined {
    return Number.isFinite(ms) && ms >= SIM_TAIL_END_MS ? SIM_SLOW_TEXT : undefined;
}

/** 是否该给「中止重试」按钮（8s 起） */
export function simShowRetryAt(ms: number): boolean {
    return Number.isFinite(ms) && ms >= SIM_RETRY_MS;
}
