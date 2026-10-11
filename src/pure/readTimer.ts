/**
 * 阅读时长计时（纯逻辑：无 obsidian / 无 DOM，可单测）。
 *
 * 1.2.1 #537：书籍类条目（文学/网文/漫画）新增「阅读时长」，在内置阅读器里读可自动累计。
 * 用户 2026-10-05 点定的计时口径：**扣后台 + 最小 1 分钟**——
 *   · 只累计「阅读器处于**前台且是活动页**」的时长（切到别的标签页 / 切出应用 → 暂停）；
 *   · 单次会话不足 1 分钟**不计入**（防误触开合刷时长、防挂机虚增）。
 *
 * 🔴 本模块只做**算术与状态机**，不碰 DOM / 时间源：宿主喂「前台态」与 `now`（可注假时钟），
 *    这样「切后台再切回」的累计能被单测钉死。阈值 `minMs` 可注入 ⇒ 测试不必真等 1 分钟。
 */

/** 单次会话的**最小计入阈值**（1 分钟）：低于它整段丢弃 */
export const READ_MIN_SESSION_MS = 60_000;

/** 计时状态（宿主持有；`activeSince === null` = 当前不在前台） */
export interface ReadTimeState {
    /** 本次前台段的起点时间戳（ms）；null = 当前非前台 */
    activeSince: number | null;
    /** 已闭合的后台前时长累计（ms） */
    accumulatedMs: number;
}

export function createReadTimeState(): ReadTimeState {
    return { activeSince: null, accumulatedMs: 0 };
}

/**
 * 切换**前台态**（重复同态幂等）：进入前台记起点，离开前台把这一段并入累计。
 * ⚠️ `now` 早于起点（时钟回拨 / 乱序事件）时**不计负值**（钳 0），⛔ 别让一次异常事件把总时长打负。
 */
export function setReadActive(s: ReadTimeState, active: boolean, now: number): void {
    const t = Number.isFinite(now) ? now : Date.now();
    if (active) {
        if (s.activeSince === null) s.activeSince = t;
        return;
    }
    if (s.activeSince === null) return;
    const delta = t - s.activeSince;
    if (delta > 0) s.accumulatedMs += delta;
    s.activeSince = null;
}

/** 当前累计毫秒（含**尚未闭合**的当前前台段；`now` 给定时计算到此刻） */
export function readActiveMs(s: ReadTimeState, now?: number): number {
    if (s.activeSince === null) return s.accumulatedMs;
    const t = Number.isFinite(now as number) ? (now as number) : Date.now();
    return s.accumulatedMs + Math.max(0, t - s.activeSince);
}

/**
 * 可计入的**分钟数**：不足阈值 → 0；否则四舍五入到分钟。
 * 非法 / 负值 → 0（⛔ 不出 NaN）。
 */
export function countableMinutes(ms: number, minMs: number = READ_MIN_SESSION_MS): number {
    if (!Number.isFinite(ms) || ms < minMs) return 0;
    return Math.round(ms / 60_000);
}

/** 把本次会话的分钟数**叠加**到既有总时长（分钟）；两侧非法 / 负值按 0，结果恒为非负整数 */
export function addReadMinutes(prev: number | undefined, add: number): number {
    const base = typeof prev === 'number' && Number.isFinite(prev) && prev > 0 ? Math.round(prev) : 0;
    const inc = Number.isFinite(add) && add > 0 ? Math.round(add) : 0;
    return base + inc;
}
