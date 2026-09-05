import { describe, it, expect } from 'vitest';
import { formatPlaytime, playtimeFromSessions, hoursToMinutes } from 'pure/playtime';

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
