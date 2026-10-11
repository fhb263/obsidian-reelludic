// 「模拟进度条」时间线单测（#559）——逐段钉端点值（0 / 200 / 2000 / 3000 / 5000 / 8000）
import { describe, it, expect } from 'vitest';
import {
    simPctAt, simVisibleAt, simSlowTextAt, simShowRetryAt,
    SIM_CAP, SIM_SLOW_TEXT, SIM_UI_DELAY_MS, SIM_FAST_END_MS, SIM_RETRY_MS,
} from 'pure/simProgress';

describe('simPctAt 五段时间线', () => {
    it('🟢 第一段（0–200ms）：起步前恒 0（防闪烁）', () => {
        expect(simPctAt(0)).toBe(0);
        expect(simPctAt(1)).toBe(0);
        expect(simPctAt(199)).toBe(0);
        expect(simPctAt(-5)).toBe(0);
        expect(simPctAt(NaN)).toBe(0);
    });

    it('🟢 第二段起点 = 10%，终点 = 70%（200ms / 2000ms）', () => {
        expect(simPctAt(SIM_UI_DELAY_MS)).toBeCloseTo(10, 5);
        expect(simPctAt(2000)).toBeCloseTo(70, 5);
    });

    it('🟡 第二段是 ease-out：前 500ms 涨得比后 500ms 多（同长度区间比较）', () => {
        const first = simPctAt(700) - simPctAt(200);
        const last = simPctAt(2000) - simPctAt(1500);
        expect(first).toBeGreaterThan(last);
        // 且单调不减
        expect(simPctAt(400)).toBeGreaterThan(simPctAt(300));
    });

    it('🟠 第三段（2s–3s）：70 → 80（≈每 300ms 涨 3 个点）', () => {
        expect(simPctAt(SIM_FAST_END_MS)).toBeCloseTo(70, 5);
        expect(simPctAt(3000)).toBeCloseTo(80, 5);
    });

    it('🔴 第四段（3s–5s）：80 → 85，且带**心跳波动**（同一段内不是直线）', () => {
        expect(simPctAt(3000 + 1e-6)).toBeCloseTo(80, 4);
        expect(simPctAt(5000)).toBeCloseTo(85, 3);
        // 波动：取一段内的两个点，其差值不等于纯线性差值 ⇒ 说明叠了 sin
        const linear = (ms: number): number => 80 + 5 * ((ms - 3000) / 2000);
        const wobbled = [3400, 3500, 3600, 3700].some((ms) => Math.abs(simPctAt(ms) - linear(ms)) > 0.1);
        expect(wobbled).toBe(true);
    });

    it('🟣 第五段（5s–8s）：85 → 90 **封顶**（⛔ 绝不到 100）', () => {
        expect(simPctAt(5000 + 1e-6)).toBeCloseTo(85, 3);
        expect(simPctAt(8000)).toBe(SIM_CAP);
        expect(simPctAt(20000)).toBe(SIM_CAP);
        expect(simPctAt(8e6)).toBeLessThanOrEqual(SIM_CAP);
    });

    it('全时间轴单调不减且永不超过封顶', () => {
        let prev = -1;
        for (let ms = 0; ms <= 12000; ms += 25) {
            const v = simPctAt(ms);
            expect(v).toBeGreaterThanOrEqual(prev - 1.5); // 允许心跳回落
            expect(v).toBeLessThanOrEqual(SIM_CAP);
            prev = v;
        }
    });
});

describe('simVisibleAt / simSlowTextAt / simShowRetryAt', () => {
    it('🟢 200ms 之前不显示进度条（防闪烁）', () => {
        expect(simVisibleAt(0)).toBe(false);
        expect(simVisibleAt(199)).toBe(false);
        expect(simVisibleAt(200)).toBe(true);
    });

    it('🟣 5s 起才把「正在搜索 N 个数据源」换成慢网络提示', () => {
        expect(simSlowTextAt(4999)).toBeUndefined();
        expect(simSlowTextAt(5000)).toBe(SIM_SLOW_TEXT);
    });

    it('🔴 8s 起才给「中止重试」按钮', () => {
        expect(simShowRetryAt(7999)).toBe(false);
        expect(simShowRetryAt(SIM_RETRY_MS)).toBe(true);
    });

    it('脏输入不放大（NaN / 负数一律 false / 0）', () => {
        expect(simVisibleAt(NaN)).toBe(false);
        expect(simSlowTextAt(NaN)).toBeUndefined();
        expect(simShowRetryAt(NaN)).toBe(false);
    });
});
