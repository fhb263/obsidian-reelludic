import { describe, it, expect } from 'vitest';
import { formatPlaytime, formatBadgeTime, playtimeFromSessions, hoursToMinutes } from 'pure/playtime';

describe('pure/playtime formatPlaytime 时长格式化（统一小时制）', () => {
    it('空/零返回空字符串', () => {
        expect(formatPlaytime(undefined)).toBe('');
        expect(formatPlaytime(0)).toBe('');
    });

    it('不足 1 小时显示 X.Xh（带 1 位小数）', () => {
        expect(formatPlaytime(30)).toBe('0.5h');
        expect(formatPlaytime(45)).toBe('0.8h');
        expect(formatPlaytime(15)).toBe('0.3h');
    });

    it('整小时显示 Xh', () => {
        expect(formatPlaytime(60)).toBe('1h');
        expect(formatPlaytime(120)).toBe('2h');
        expect(formatPlaytime(720)).toBe('12h');
    });

    it('非整小时显示 X.Xh', () => {
        expect(formatPlaytime(90)).toBe('1.5h');
        expect(formatPlaytime(745)).toBe('12.4h');
    });
});

describe('pure/playtime formatBadgeTime 封面角标时长（🔴 m04435 ④）', () => {
    // 用户逐条给的示例，一条不改地钉住 —— 这是本轮验收的唯一口径
    it('🔴 用户示例逐条对齐：59min / 1h / 1h1min / 1h59min / 2h', () => {
        expect(formatBadgeTime(59)).toBe('59min');
        expect(formatBadgeTime(60)).toBe('1h');
        expect(formatBadgeTime(61)).toBe('1h1min');
        expect(formatBadgeTime(119)).toBe('1h59min');
        expect(formatBadgeTime(120)).toBe('2h');
    });

    it('🔴 先向下取整到分钟（⛔ 不四舍五入 —— 119.7 分钟不能说成 2h）', () => {
        expect(formatBadgeTime(119.7)).toBe('1h59min');
        expect(formatBadgeTime(0.9)).toBe('');   // 不足 1 分钟 ⇒ 空串（取整后是 0）
        expect(formatBadgeTime(1.9)).toBe('1min');
        expect(formatBadgeTime(59.9)).toBe('59min');
        expect(formatBadgeTime(60.9)).toBe('1h');  // 60.9 → 60 → 「1h」，不是 1h0min
    });

    it('🔴 Z=0 时省略 min（整点只写 Nh，⛔ 不写 Nh0min）', () => {
        expect(formatBadgeTime(180)).toBe('3h');
        expect(formatBadgeTime(600)).toBe('10h');
    });

    it('跨小时进位正确：min 永不超过 59', () => {
        expect(formatBadgeTime(1439)).toBe('23h59min');
        expect(formatBadgeTime(1440)).toBe('24h');
    });

    it('空 / 0 / 负数 / 非有限 ⇒ 空串（角标不渲染，封面不留空槽）', () => {
        expect(formatBadgeTime(undefined)).toBe('');
        expect(formatBadgeTime(0)).toBe('');
        expect(formatBadgeTime(-5)).toBe('');
        expect(formatBadgeTime(NaN)).toBe('');
        expect(formatBadgeTime(Infinity)).toBe('');
    });

    it('⛔ 老函数 formatPlaytime 一字未动（记录明细/动态流/笔记正文还在用它）', () => {
        expect(formatPlaytime(30)).toBe('0.5h');
        expect(formatPlaytime(745)).toBe('12.4h');
        // 同一份分钟数，两个函数给出不同形态 —— 这正是「角标专用」的意义
        expect(formatBadgeTime(745)).toBe('12h25min');
    });
});

describe('pure/playtime hoursToMinutes 小时转分钟', () => {
    it('整数小时', () => {
        expect(hoursToMinutes(1)).toBe(60);
        expect(hoursToMinutes(2.5)).toBe(150);
    });

    it('半时', () => {
        expect(hoursToMinutes(0.5)).toBe(30);
    });
});

describe('pure/playtime playtimeFromSessions 明细累计', () => {
    it('空数组返回 0', () => {
        expect(playtimeFromSessions([])).toBe(0);
        expect(playtimeFromSessions(undefined)).toBe(0);
    });

    it('累加各次游玩时长', () => {
        expect(playtimeFromSessions([{ date: '2026-08-01', minutes: 30 }, { date: '2026-08-02', minutes: 45 }, { date: '2026-08-03', minutes: 120 }])).toBe(195);
    });
});
