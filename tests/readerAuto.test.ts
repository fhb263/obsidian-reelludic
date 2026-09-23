import { describe, it, expect } from 'vitest';
import {
    AUTO_SCROLL_DEFAULT,
    AUTO_SCROLL_FONT_BASE,
    AUTO_SCROLL_MAX,
    AUTO_SCROLL_MIN,
    AUTO_SCROLL_STEP,
    AUTO_TURN_DEFAULT_MS,
    AUTO_TURN_MAX_MS,
    AUTO_TURN_MIN_MS,
    advanceAutoPos,
    autoSpeedLabel,
    autoTurnLabel,
    clampAutoScrollPx,
    clampAutoTurnMs,
} from 'pure/readerAuto';

describe('clampAutoScrollPx（自动滚动速度，px/s）', () => {
    it('夹在上下限之间并对齐步长', () => {
        expect(clampAutoScrollPx(AUTO_SCROLL_DEFAULT)).toBe(150);
        expect(clampAutoScrollPx(10)).toBe(AUTO_SCROLL_MIN);
        expect(clampAutoScrollPx(9999)).toBe(AUTO_SCROLL_MAX);
        // 🔴 网格锚定在 `AUTO_SCROLL_MIN`（= `input[type=range]` 的真实语义）：150 在网格上（50+5×20）⇒ 151 吸回 150；
        //   跨过半格才进上一档。⚠️ 首版红测写的是 `151 → 160`（照「锚定 0 的 20 网格」想的），与同一 describe 里
        //   「缺省 150 是固定点」互相矛盾 —— 150/20 = 7.5，锚定 0 的网格上根本没有 150，而缺省必须保持用户
        //   2026-09-15 裁定的定速 150px/s（不能为了迁就网格改掉它）。
        expect(clampAutoScrollPx(151)).toBe(150);
        expect(clampAutoScrollPx(162)).toBe(170);
    });

    it('🔴 非法 / 0 → 回退默认 150（速度为 0 等于「开了自动却不动」，比不开更困惑）', () => {
        expect(clampAutoScrollPx(NaN)).toBe(AUTO_SCROLL_DEFAULT);
        expect(clampAutoScrollPx(0)).toBe(AUTO_SCROLL_DEFAULT);
        expect(clampAutoScrollPx(-80)).toBe(AUTO_SCROLL_DEFAULT);
    });
});

describe('clampAutoTurnMs（自动翻页间隔，ms）', () => {
    it('夹在上下限之间并对齐步长', () => {
        expect(clampAutoTurnMs(AUTO_TURN_DEFAULT_MS)).toBe(5000);
        expect(clampAutoTurnMs(200)).toBe(AUTO_TURN_MIN_MS);
        expect(clampAutoTurnMs(60000)).toBe(AUTO_TURN_MAX_MS);
    });

    it('非法 / 0 → 回退默认 5000', () => {
        expect(clampAutoTurnMs(NaN)).toBe(AUTO_TURN_DEFAULT_MS);
        expect(clampAutoTurnMs(0)).toBe(AUTO_TURN_DEFAULT_MS);
    });
});

describe('显示文案', () => {
    it('翻页间隔换算成秒（一位小数，整数秒不带 .0）', () => {
        expect(autoTurnLabel(5000)).toBe('5 秒/页');
        expect(autoTurnLabel(2500)).toBe('2.5 秒/页');
    });

    it('#351 滚动速度改口径「字/分」：按**当前字号**换算（CJK 全角字宽 ≈ 1em）', () => {
        expect(autoSpeedLabel(150, 15)).toBe('600 字/分'); // 150px/s ÷ 15px/字 × 60
        // ⚠️ 换算前**先过网格夹取**：85 不是网格值（网格 50 + k×20），会被吸成 90
        expect(autoSpeedLabel(85, 17)).toBe(autoSpeedLabel(90, 17));
        expect(autoSpeedLabel(90, 17)).toBe('318 字/分'); // 90 ÷ 17 × 60 = 317.6 → 318
    });

    it('🔴 缺省字号基准 = 17px（PDF 阅读器无字号设置 ⇒ 取与正文默认同值，两处显示不打架）', () => {
        expect(autoSpeedLabel(150)).toBe(autoSpeedLabel(150, AUTO_SCROLL_FONT_BASE));
        expect(AUTO_SCROLL_FONT_BASE).toBe(17);
    });

    it('🔴 非法 / 非正字号不能吐 NaN 或 Infinity（换算基准坏掉就回落缺省，文字要能上屏）', () => {
        expect(autoSpeedLabel(150, 0)).toBe('529 字/分'); // 150 ÷ 17 × 60 = 529.4 → 529
        expect(autoSpeedLabel(150, NaN)).toBe('529 字/分');
        expect(autoSpeedLabel(150, -8)).toBe('529 字/分');
    });

    it('🔴 极慢速度也要显示成 ≥1 字/分，且不出现小数（滑条上不会看到「0 字/分」这种看起来像没速度的值）', () => {
        // 50px/s（下限）÷ 100000px/字 × 60 = 0.03 ⇒ 取整会变 0，必须被下限抬回 1
        expect(autoSpeedLabel(50, 100000)).toBe('1 字/分');
        expect(autoSpeedLabel(AUTO_SCROLL_MIN, AUTO_SCROLL_FONT_BASE)).toMatch(/^\d+ 字\/分$/);
    });
});

describe('滑条范围自洽（供 UI 直接取用）', () => {
    it('下限 < 上限，且默认值落在区间内、步长能整除', () => {
        expect(AUTO_SCROLL_MIN).toBeLessThan(AUTO_SCROLL_MAX);
        expect(AUTO_SCROLL_DEFAULT).toBeGreaterThanOrEqual(AUTO_SCROLL_MIN);
        expect(AUTO_SCROLL_DEFAULT).toBeLessThanOrEqual(AUTO_SCROLL_MAX);
        expect((AUTO_SCROLL_DEFAULT - AUTO_SCROLL_MIN) % AUTO_SCROLL_STEP).toBe(0);
        expect(AUTO_TURN_MIN_MS).toBeLessThan(AUTO_TURN_MAX_MS);
        expect(AUTO_TURN_DEFAULT_MS).toBeGreaterThanOrEqual(AUTO_TURN_MIN_MS);
        expect(AUTO_TURN_DEFAULT_MS).toBeLessThanOrEqual(AUTO_TURN_MAX_MS);
    });
});

describe('advanceAutoPos（#342 自动滚动推进一帧：必须用**浮点累加器**，不能读回 scrollTop 再相加）', () => {
    it('🔴 低速也必须真的推进 —— 120Hz 下 50px/s 每帧仅 0.417px，被浏览器取整会变 0（用户报「50px 没反应」）', () => {
        const one = advanceAutoPos(0, 50, 1 / 120, 10000);
        expect(one).toBeGreaterThan(0);
        expect(one).toBeCloseTo(50 / 120, 6);
    });

    it('🔴 速度必须准确：50px/s 走 1 秒 = 50px（读回 scrollTop 再相加会在 60Hz 下被抬成 60）', () => {
        let pos = 0;
        for (let i = 0; i < 60; i++) pos = advanceAutoPos(pos, 50, 1 / 60, 100000);
        expect(pos).toBeCloseTo(50, 6);
        let p2 = 0;
        for (let i = 0; i < 60; i++) p2 = advanceAutoPos(p2, 150, 1 / 60, 100000);
        expect(p2).toBeCloseTo(150, 6);
    });

    it('封顶在可滚动高度（到底即停在 max）', () => {
        expect(advanceAutoPos(999, 150, 1, 1000)).toBe(1000);
        expect(advanceAutoPos(0, 150, 1, 0)).toBe(150); // max<=0（不可滚动）→ 不封顶
    });

    it('非法 / 非正速度 → 位置不动（不把 NaN 写进滚动位置）', () => {
        expect(advanceAutoPos(10, NaN, 0.016, 100)).toBe(10);
        expect(advanceAutoPos(10, 0, 0.016, 100)).toBe(10);
        expect(advanceAutoPos(10, -50, 0.016, 100)).toBe(10);
        expect(advanceAutoPos(10, 50, 0, 100)).toBe(10);
    });
});
