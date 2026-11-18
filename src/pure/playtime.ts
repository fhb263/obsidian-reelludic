// 游戏游玩时长纯逻辑（无 obsidian 依赖，可单测）
import type { PlaySession } from 'data/types';

/** 时长格式化（统一小时制）：<60m → "0.5h" / "0.8h"；≥60m 整时 → "12h"；非整 → "12.5h"（1 位小数）；空/0 → "" */
export function formatPlaytime(minutes: number | undefined): string {
    if (!minutes || minutes <= 0) return '';
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/**
 * 封面角标专用时长格式（🔴 m04435 ④，用户逐条给了示例）：
 * `59min` → `59min`；`60min` → `1h`；`61min` → `1h1min`；`119min` → `1h59min`；`120min` → `2h`。
 *
 * 三条口径（都是用户原话落的）：
 * ① **先向下取整到分钟** —— ⛔ 不四舍五入：119.7 分钟说「2h」是在替用户多算时间；
 * ② `<60min` 只显示分钟、`>=60min` 显示 `YhZmin`，**`Z=0` 时省略 `min`** ——
 *    所以整点写 `2h` 而不是 `2h0min`（后者读起来像占位符没填完）；
 * ③ 空 / 0 / 负数 / 非有限 ⇒ **空串**（调用方据此不渲染角标、封面不留空槽）。
 *
 * 🔴 为什么**不**直接改 {@link formatPlaytime}：那个函数还有三个消费者 ——
 *    `data/noteGenerator` 的游玩记录行、`pure/activityFeed` 的动态流、`modals/EntryLogModal`
 *    的时长明细。它们要的是「12.5h」这种**可汇总的小数小时**，换成 `12h30min` 会改掉
 *    笔记正文的历史排版。用户说的范围是「封面角标」，所以只在这里新增、⛔ 不动老函数。
 */
export function formatBadgeTime(minutes: number | undefined): string {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '';
    const total = Math.floor(minutes);
    if (total <= 0) return '';
    if (total < 60) return `${total}min`;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h}h` : `${h}h${m}min`;
}

/** 游玩记录明细累计（playtimeMinutes 的派生来源） */
export function playtimeFromSessions(sessions: PlaySession[] | undefined): number {
    return (sessions ?? []).reduce((sum, s) => sum + (s.minutes || 0), 0);
}

/** 小时转分钟（弹窗/表单用小时录入 → 落库分钟；hours=0.5 → 30min） */
export function hoursToMinutes(hours: number): number {
    return Math.round(hours * 60);
}
