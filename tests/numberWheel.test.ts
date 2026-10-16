// 数字输入框「滚轮增减」纯逻辑单测（#556）
// 用户口径：滚轮只在**聚焦**时才生效 + 接管时**阻止冒泡**（不让页面跟着滚）。
// 本文件只测「算值 / 判目标」两件纯逻辑；DOM 接线（activeElement 判定、preventDefault）在 main.ts。
import { describe, it, expect } from 'vitest';
import { wheelStepValue, parseNumberBounds, isNumberInputTarget } from 'pure/numberWheel';

describe('wheelStepValue 滚轮步进', () => {
    it('无界 + 整数步长：±1', () => {
        expect(wheelStepValue('5', 1, 1, NaN, NaN)).toBe(6);
        expect(wheelStepValue('5', -1, 1, NaN, NaN)).toBe(4);
    });

    it('空值：从 0 起算（有 min 则从 min 起）', () => {
        expect(wheelStepValue('', 1, 1, NaN, NaN)).toBe(1);
        expect(wheelStepValue('', 1, 1, 3, NaN)).toBe(4);
    });

    it('min / max 边界钳制（越界回落到边界）', () => {
        expect(wheelStepValue('2', -1, 5, 1, NaN)).toBe(1);      // 2-5=-3 → 钳到 min=1
        expect(wheelStepValue('10', 1, 5, NaN, 12)).toBe(12);    // 10+5=15 → 钳到 max=12
        expect(wheelStepValue('11', 1, 1, 1, 12)).toBe(12);
        expect(wheelStepValue('2', -1, 1, 1, 12)).toBe(1);
    });

    it('小数步长不攒浮点尾巴（step=0.1）', () => {
        expect(wheelStepValue('0.2', 1, 0.1, NaN, NaN)).toBe(0.3);
        expect(wheelStepValue('0.3', -1, 0.1, NaN, NaN)).toBe(0.2);
        expect(String(wheelStepValue('12.3', 1, 0.1, NaN, NaN))).toBe('12.4');
    });

    it('step 非法（0 / NaN / 负）回落到 1', () => {
        expect(wheelStepValue('5', 1, 0, NaN, NaN)).toBe(6);
        expect(wheelStepValue('5', 1, NaN, NaN, NaN)).toBe(6);
        expect(wheelStepValue('5', 1, -2, NaN, NaN)).toBe(6);
    });

    it('值算出来和原来一样（已在边界）⇒ undefined（调用方据此不写回）', () => {
        expect(wheelStepValue('1', -1, 1, 1, NaN)).toBeUndefined();
        expect(wheelStepValue('12', 1, 1, NaN, 12)).toBeUndefined();
    });

    it('当前值不是数字 ⇒ undefined（⛔ 别把乱输入悄悄改成 0/1）', () => {
        expect(wheelStepValue('abc', 1, 1, NaN, NaN)).toBeUndefined();
        expect(wheelStepValue('1e', 1, 1, NaN, NaN)).toBeUndefined();
    });

    it('带空白的目标值按数值处理', () => {
        expect(wheelStepValue('  7  ', 1, 1, NaN, NaN)).toBe(8);
    });
});

describe('parseNumberBounds 属性解析', () => {
    it('空串 = 无界（NaN 交由 wheelStepValue 当 ±Infinity 处理）', () => {
        expect(parseNumberBounds({ min: '', max: '', step: '' })).toEqual({ min: NaN, max: NaN, step: NaN });
    });
    it('正常解析（step 可小数）', () => {
        expect(parseNumberBounds({ min: '1', max: '12', step: '0.1' })).toEqual({ min: 1, max: 12, step: 0.1 });
    });
});

describe('isNumberInputTarget 目标判定', () => {
    it('只认 input[type=number]', () => {
        expect(isNumberInputTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    });
    it('文本 / 其它标签 / 空值一律不认（⛔ 别让滚轮改到非数字框）', () => {
        expect(isNumberInputTarget({ tagName: 'INPUT', type: 'text' })).toBe(false);
        expect(isNumberInputTarget({ tagName: 'DIV', type: 'number' })).toBe(false);
        expect(isNumberInputTarget(null)).toBe(false);
        expect(isNumberInputTarget(undefined)).toBe(false);
        expect(isNumberInputTarget('input')).toBe(false);
    });
});
