// 音乐收听时长自动累计的判据（m02288）。
//
// 🔴 用户原话：「用音乐播放器播放每首音乐要统计总时长列在卡片网格封面左上角上统一，
//    而不是让用户手动记录」。
//
// 本文件锁三件事（对应 `src/pure/listenTime.ts` 文件头三条硬口径）：
//  ⑴ 只认「真实播放过的毫秒」，⛔ 不是 `currentTime` 差值；
//  ⑵ 分钟整数向下取整，零头跨段保留（⛔ 清零会吞掉零头，⛔ 四舍五入会凭空多算）；
//  ⑶ 不足 1 分钟不落库。
import { describe, expect, it } from 'vitest';
import {
    LISTEN_MIN_SEGMENT_MS,
    LISTEN_MS_PER_SECOND,
    LISTEN_SECONDS_PER_MINUTE,
    ListenAccumulator,
    isCountableSegment,
    msToWholeMinutes,
} from '../src/pure/listenTime';

const MINUTE_MS = LISTEN_MS_PER_SECOND * LISTEN_SECONDS_PER_MINUTE;

describe('listenTime · 段判据', () => {
    it('§ 常量口径：1 分钟 = 60000ms、最小段 = 1000ms', () => {
        expect(MINUTE_MS).toBe(60_000);
        expect(LISTEN_MIN_SEGMENT_MS).toBe(1000);
    });

    it('🔴 低于 1 秒的碎片不计（手滑起播立刻暂停）', () => {
        expect(isCountableSegment(999)).toBe(false);
        expect(isCountableSegment(0)).toBe(false);
        expect(isCountableSegment(-500)).toBe(false);
    });

    it('🔴 恰好 1 秒算一段（边界含等号）', () => {
        expect(isCountableSegment(1000)).toBe(true);
    });

    it('⛔ 非有限数一律不计（NaN / Infinity 会让累计器算出 NaN 分钟）', () => {
        expect(isCountableSegment(Number.NaN)).toBe(false);
        expect(isCountableSegment(Number.POSITIVE_INFINITY)).toBe(false);
        expect(isCountableSegment(Number.NEGATIVE_INFINITY)).toBe(false);
    });
});

describe('listenTime · 毫秒换算整分钟', () => {
    it('🔴 向下取整：59999ms 是 0 分钟，60000ms 才是 1 分钟', () => {
        expect(msToWholeMinutes(59_999)).toBe(0);
        expect(msToWholeMinutes(60_000)).toBe(1);
    });

    it('🔴 ⛔ 不四舍五入：1 分 59 秒仍是 1 分钟（四舍五入会变成 2）', () => {
        expect(msToWholeMinutes(119_000)).toBe(1);
    });

    it('负数 / 0 / 非有限数都给 0 分钟', () => {
        expect(msToWholeMinutes(0)).toBe(0);
        expect(msToWholeMinutes(-1)).toBe(0);
        expect(msToWholeMinutes(Number.NaN)).toBe(0);
    });

    it('多分钟直接整除（3 分 20 秒 → 3）', () => {
        expect(msToWholeMinutes(200_000)).toBe(3);
    });
});

describe('listenTime · ListenAccumulator 攒零头', () => {
    it('🔴 零头跨段保留：两段 40 秒 → 第一段 0、第二段 1，剩余 20 秒', () => {
        const acc = new ListenAccumulator();
        expect(acc.addSegment(40_000)).toBe(0);
        expect(acc.addSegment(40_000)).toBe(1);
        expect(acc.pending()).toBe(20_000);
    });

    it('🔴 攒够后只扣掉换成分的部分（⛔ 别整段清零）', () => {
        const acc = new ListenAccumulator();
        // 1 分 30 秒：取出 1 分钟，剩 30 秒
        expect(acc.addSegment(90_000)).toBe(1);
        expect(acc.pending()).toBe(30_000);
    });

    it('🔴 一次喂很长也能一次吐出多分钟（5 分整 → 5，剩 0）', () => {
        const acc = new ListenAccumulator();
        expect(acc.addSegment(5 * MINUTE_MS)).toBe(5);
        expect(acc.pending()).toBe(0);
    });

    it('🔴 碎片段（<1 秒）被丢掉，不污染零头', () => {
        const acc = new ListenAccumulator();
        expect(acc.addSegment(400)).toBe(0);
        expect(acc.addSegment(400)).toBe(0);
        expect(acc.pending()).toBe(0);
    });

    it('🔴 碎段之间夹真播放：只有真播放进账（碎片不能靠「攒多次」凑够 1 秒）', () => {
        const acc = new ListenAccumulator();
        for (let i = 0; i < 10; i++) acc.addSegment(500);
        expect(acc.pending()).toBe(0);
        expect(acc.addSegment(30_000)).toBe(0);
        expect(acc.pending()).toBe(30_000);
    });

    it('reset() 清空零头（换条目 / 销毁时用）', () => {
        const acc = new ListenAccumulator();
        acc.addSegment(45_000);
        acc.reset();
        expect(acc.pending()).toBe(0);
        expect(acc.addSegment(45_000)).toBe(0);
    });

    it('🔴 反复累加到跨过整分钟：60 段 1 秒 → 第 60 段才吐 1 分钟', () => {
        const acc = new ListenAccumulator();
        let total = 0;
        for (let i = 0; i < 60; i++) total += acc.addSegment(1000);
        expect(total).toBe(1);
        expect(acc.pending()).toBe(0);
    });

    it('实例之间互不干扰（每次都从 0 起）', () => {
        const a = new ListenAccumulator();
        const b = new ListenAccumulator();
        a.addSegment(90_000);
        expect(a.addSegment(0)).toBe(0);
        expect(b.addSegment(90_000)).toBe(1);
    });
});
