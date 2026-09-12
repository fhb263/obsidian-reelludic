// 游戏游玩时长纯逻辑（无 obsidian 依赖，可单测）
import type { PlaySession } from 'data/types';

/** 时长格式化（统一小时制）：<60m → "0.5h" / "0.8h"；≥60m 整时 → "12h"；非整 → "12.5h"（1 位小数）；空/0 → "" */
export function formatPlaytime(minutes: number | undefined): string {
    if (!minutes || minutes <= 0) return '';
    const hours = minutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** 游玩记录明细累计（playtimeMinutes 的派生来源） */
export function playtimeFromSessions(sessions: PlaySession[] | undefined): number {
    return (sessions ?? []).reduce((sum, s) => sum + (s.minutes || 0), 0);
}

/** 小时转分钟（弹窗/表单用小时录入 → 落库分钟；hours=0.5 → 30min） */
export function hoursToMinutes(hours: number): number {
    return Math.round(hours * 60);
}
