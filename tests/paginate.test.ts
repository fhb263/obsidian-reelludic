import { describe, it, expect } from 'vitest';
import { PAGE_SIZE, normalizePageSize, pageCountOf, clampPage, paginate, pageNumbers } from 'pure/paginate';

describe('paginate · 页大小归一', () => {
    it('缺省 / 0 / 负数 / NaN / Infinity 一律回落 PAGE_SIZE', () => {
        expect(normalizePageSize()).toBe(PAGE_SIZE);
        expect(normalizePageSize(0)).toBe(PAGE_SIZE);
        expect(normalizePageSize(-5)).toBe(PAGE_SIZE);
        expect(normalizePageSize(Number.NaN)).toBe(PAGE_SIZE);
        expect(normalizePageSize(Number.POSITIVE_INFINITY)).toBe(PAGE_SIZE);
    });
    it('小数向下取整、>=1 保留', () => {
        expect(normalizePageSize(10.9)).toBe(10);
        expect(normalizePageSize(1)).toBe(1);
    });
});

describe('paginate · 总页数', () => {
    it('空列表 = 1 页（视图统一渲染「第 1/1 页」）', () => {
        expect(pageCountOf(0)).toBe(1);
        expect(pageCountOf(-3)).toBe(1);
        expect(pageCountOf(Number.NaN)).toBe(1);
    });
    it('整除与不整除', () => {
        expect(pageCountOf(96, 48)).toBe(2);
        expect(pageCountOf(97, 48)).toBe(3);
        expect(pageCountOf(48, 48)).toBe(1);
    });
});

describe('paginate · 页码钳制', () => {
    it('越界页码钳到边界，脏值回落第 1 页', () => {
        expect(clampPage(0, 100, 48)).toBe(1);
        expect(clampPage(9, 100, 48)).toBe(3);
        expect(clampPage(Number.NaN, 100, 48)).toBe(1);
        expect(clampPage(2.7, 100, 48)).toBe(2);
        expect(clampPage(3, 0, 48)).toBe(1); // 空列表只有 1 页
    });
});

describe('paginate · 切页', () => {
    const items = Array.from({ length: 100 }, (_, i) => i + 1);
    it('首页：from/to 与条目正确', () => {
        const r = paginate(items, 1, 48);
        expect(r.items[0]).toBe(1);
        expect(r.items).toHaveLength(48);
        expect(r.from).toBe(1);
        expect(r.to).toBe(48);
        expect(r.pageCount).toBe(3);
        expect(r.total).toBe(100);
    });
    it('末页：条目数不足一整页，to 取实际末条', () => {
        const r = paginate(items, 3, 48);
        expect(r.items).toHaveLength(4);
        expect(r.items[0]).toBe(97);
        expect(r.from).toBe(97);
        expect(r.to).toBe(100);
    });
    it('越界页码自动钳制（条目被删后原页码失效的场景）', () => {
        const r = paginate(items.slice(0, 10), 5, 48);
        expect(r.page).toBe(1);
        expect(r.items).toHaveLength(10);
    });
    it('空列表：items 空、from/to 为 0（不假装有第 1 条）', () => {
        const r = paginate([], 1, 48);
        expect(r.items).toEqual([]);
        expect(r.pageCount).toBe(1);
        expect(r.from).toBe(0);
        expect(r.to).toBe(0);
    });
    it('不修改入参（纯函数）', () => {
        const src = [1, 2, 3];
        paginate(src, 1, 2);
        expect(src).toEqual([1, 2, 3]);
    });
});

describe('paginate · 页码窗', () => {
    it('页数不多时全部列数字，不出现省略号', () => {
        expect(pageNumbers(1, 1)).toEqual([1]);
        expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
        expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
    it('中段：当前页左右展开，两端省略', () => {
        expect(pageNumbers(10, 20)).toEqual([1, '…', 8, 9, 10, 11, 12, '…', 20]);
    });
    it('靠前：省略号只出现在右侧，连续段锚在 [2..]（首尾两页恒显示）', () => {
        expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, 5, 6, '…', 20]);
        expect(pageNumbers(2, 20)).toEqual([1, 2, 3, 4, 5, 6, '…', 20]);
    });
    it('靠后：省略号只出现在左侧，连续段贴到末页前一位', () => {
        expect(pageNumbers(20, 20)).toEqual([1, '…', 15, 16, 17, 18, 19, 20]);
        expect(pageNumbers(19, 20)).toEqual([1, '…', 15, 16, 17, 18, 19, 20]);
    });
    it('不变量：恒含 1、末页与当前页；数字严格递增；省略号只夹在数字之间', () => {
        for (const count of [1, 2, 6, 8, 20, 137]) {
            for (let cur = 1; cur <= count; cur++) {
                const win = pageNumbers(cur, count);
                const nums = win.filter((x): x is number => typeof x === 'number');
                expect(nums[0]).toBe(1);
                expect(nums[nums.length - 1]).toBe(count);
                expect(nums).toContain(cur);
                expect([...nums].sort((a, b) => a - b)).toEqual(nums);
                expect(new Set(nums).size).toBe(nums.length);
                if (win[0] === '…' || win[win.length - 1] === '…') throw new Error('省略号不得出现在首尾');
            }
        }
    });
    it('脏入参（NaN / 超窗页码）不越界', () => {
        expect(pageNumbers(Number.NaN, 20)).toContain(1);
        expect(pageNumbers(99, 3)).toEqual([1, 2, 3]);
    });
});
