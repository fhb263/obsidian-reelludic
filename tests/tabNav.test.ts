import { describe, it, expect } from 'vitest';
import { resolveTabKey } from 'pure/tabNav';

const H = { orientation: 'horizontal' as const };

describe('resolveTabKey · 水平方向键', () => {
    it('→ 移动到后一项，← 移动到前一项', () => {
        expect(resolveTabKey('ArrowRight', 0, 6, H)).toEqual({ index: 1, handled: true });
        expect(resolveTabKey('ArrowLeft', 3, 6, H)).toEqual({ index: 2, handled: true });
    });

    it('首尾回绕（默认）：首项 ← 到末项、末项 → 到首项', () => {
        expect(resolveTabKey('ArrowLeft', 0, 6, H)).toEqual({ index: 5, handled: true });
        expect(resolveTabKey('ArrowRight', 5, 6, H)).toEqual({ index: 0, handled: true });
    });

    it('wrap:false 时边界停住（但仍算已处理，避免调用方放行导致页面滚动）', () => {
        expect(resolveTabKey('ArrowLeft', 0, 6, { ...H, wrap: false })).toEqual({ index: 0, handled: true });
        expect(resolveTabKey('ArrowRight', 5, 6, { ...H, wrap: false })).toEqual({ index: 5, handled: true });
    });

    it('Home / End 跳首尾', () => {
        expect(resolveTabKey('Home', 4, 6, H)).toEqual({ index: 0, handled: true });
        expect(resolveTabKey('End', 1, 6, H)).toEqual({ index: 5, handled: true });
    });
});

describe('resolveTabKey · 竖向与无关按键', () => {
    it('竖向用 ↑↓；水平的那对方向键不放行（留给页面滚动）', () => {
        const V = { orientation: 'vertical' as const };
        expect(resolveTabKey('ArrowDown', 1, 4, V)).toEqual({ index: 2, handled: true });
        expect(resolveTabKey('ArrowUp', 1, 4, V)).toEqual({ index: 0, handled: true });
        expect(resolveTabKey('ArrowLeft', 1, 4, V)).toEqual({ index: 1, handled: false });
        expect(resolveTabKey('ArrowRight', 1, 4, V)).toEqual({ index: 1, handled: false });
    });

    it('其它按键一律放行（Tab / Enter / 字符键不得被吃掉）', () => {
        for (const k of ['Tab', 'Enter', ' ', 'a', 'Escape', 'PageDown']) {
            expect(resolveTabKey(k, 2, 6, H)).toEqual({ index: 2, handled: false });
        }
    });
});

describe('resolveTabKey · 边界与脏输入', () => {
    it('空组不制造越界下标', () => {
        expect(resolveTabKey('ArrowRight', 0, 0, H)).toEqual({ index: 0, handled: false });
        expect(resolveTabKey('ArrowRight', 3, -2, H)).toEqual({ index: 0, handled: false });
        expect(resolveTabKey('Home', 0, NaN, H)).toEqual({ index: 0, handled: false });
    });

    it('单页签：导航键已处理但下标恒为 0', () => {
        expect(resolveTabKey('ArrowRight', 0, 1, H)).toEqual({ index: 0, handled: true });
        expect(resolveTabKey('ArrowLeft', 0, 1, H)).toEqual({ index: 0, handled: true });
    });

    it('当前下标越界 → 先钳制再计算（不产出负数 / 超界）', () => {
        expect(resolveTabKey('ArrowRight', 99, 6, H)).toEqual({ index: 0, handled: true }); // 钳到末项 5 再回绕
        expect(resolveTabKey('ArrowLeft', -5, 6, H)).toEqual({ index: 5, handled: true }); // 钳到首项 0 再回绕
        expect(resolveTabKey('Home', 99, 6, H)).toEqual({ index: 0, handled: true });
    });
});
