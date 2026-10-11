import { describe, expect, it } from 'vitest';
import {
    READ_MIN_SESSION_MS,
    addReadMinutes,
    countableMinutes,
    createReadTimeState,
    readActiveMs,
    setReadActive,
} from 'pure/readTimer';

describe('#537 阅读时长计时（扣后台 + 最小 1 分钟）', () => {
    it('最小阈值常量就是 1 分钟', () => {
        expect(READ_MIN_SESSION_MS).toBe(60_000);
    });

    it('前台累计：进入 → 离开把这一段并入', () => {
        const s = createReadTimeState();
        expect(readActiveMs(s)).toBe(0);
        setReadActive(s, true, 1_000);
        expect(readActiveMs(s, 31_000)).toBe(30_000); // 未闭合段实时计入
        setReadActive(s, false, 31_000);
        expect(readActiveMs(s)).toBe(30_000);
    });

    it('🔴 扣后台：切走（false）后再切回，只累计两段前台时间', () => {
        const s = createReadTimeState();
        setReadActive(s, true, 0);
        setReadActive(s, false, 10_000); // 第 1 段 10s
        setReadActive(s, true, 100_000); // 后台 90s 不计
        setReadActive(s, false, 130_000); // 第 2 段 30s
        expect(readActiveMs(s)).toBe(40_000);
    });

    it('重复同态幂等（连续两次 true 不重置起点；连续两次 false 不重复累加）', () => {
        const s = createReadTimeState();
        setReadActive(s, true, 0);
        setReadActive(s, true, 5_000); // 忽略
        setReadActive(s, false, 20_000);
        setReadActive(s, false, 99_000); // 忽略
        expect(readActiveMs(s)).toBe(20_000);
    });

    it('时钟回拨（now < 起点）不计负值', () => {
        const s = createReadTimeState();
        setReadActive(s, true, 10_000);
        setReadActive(s, false, 4_000);
        expect(readActiveMs(s)).toBe(0);
    });

    it('countableMinutes：不足 1 分钟 → 0；其余四舍五入', () => {
        expect(countableMinutes(0)).toBe(0);
        expect(countableMinutes(59_999)).toBe(0);
        expect(countableMinutes(60_000)).toBe(1);
        expect(countableMinutes(90_000)).toBe(2); // 1.5 → 2
        expect(countableMinutes(89_000)).toBe(1);
        expect(countableMinutes(3_600_000)).toBe(60);
        expect(countableMinutes(Number.NaN)).toBe(0);
        expect(countableMinutes(-5)).toBe(0);
    });

    it('阈值可注入（测试不必真等 1 分钟）', () => {
        expect(countableMinutes(2_000, 1_000)).toBe(0); // round(0.033) = 0
        expect(countableMinutes(30_000, 1_000)).toBe(1); // round(0.5) = 1
    });

    it('addReadMinutes：叠加到既有总时长，两侧非法按 0', () => {
        expect(addReadMinutes(undefined, 5)).toBe(5);
        expect(addReadMinutes(60, 30)).toBe(90);
        expect(addReadMinutes(60, 0)).toBe(60);
        expect(addReadMinutes(60, -3)).toBe(60);
        expect(addReadMinutes(Number.NaN, 30)).toBe(30);
        expect(addReadMinutes(10.4, 20.6)).toBe(31); // 两侧各自取整：10 + 21
    });
});
