/**
 * `pure/epPages` 单测（#576）—— 选集弹窗**分页**的全部纯逻辑。
 * 🔴 这里钉的是**口径**，不是实现细节：页大小 100（#600 用户口径「100 集以上加分页」）、越界一律钳（⛔ 不返回 -1）、
 *    页码条**当前页恒在列**（那正是页码条存在的意义）、10 页停在第 1 页时正好是用户给的那串。
 */
import { describe, expect, it } from 'vitest';
import { EP_PAGE_SIZE, pageBarItems, pageCount, pageIndexOf, pageSlice, pageStep } from '../src/pure/epPages';

describe('pageCount（总集数 → 页数）', () => {
    it('🔴 页大小 = 100（#600 用户口径「100 集以上加分页」⇒ 100 集落在一页，第 101 集起才分到第二页）', () => {
        expect(EP_PAGE_SIZE).toBe(100);
        expect(pageCount(100)).toBe(1);
        expect(pageCount(101)).toBe(2);
        expect(pageCount(200)).toBe(2);
        expect(pageCount(201)).toBe(3);
    });

    it('0 集 / 非法 ⇒ **至少 1 页**（弹窗总得画点什么，⛔ 不许是 0）', () => {
        expect(pageCount(0)).toBe(1);
        expect(pageCount(-3)).toBe(1);
        expect(pageCount(Number.NaN)).toBe(1);
        expect(pageCount(undefined as unknown as number)).toBe(1);
    });

    it('自定义页大小仍生效（改口径只改常量，但函数得认参数）', () => {
        expect(pageCount(10, 4)).toBe(3);
        expect(pageCount(8, 0)).toBe(1); // 非法 size ⇒ 回退默认 100 ⇒ 8 集 = 1 页
    });
});

describe('pageIndexOf（第 i 集落在哪一页，0 基）', () => {
    it('边界：第 1 集 ⇒ 0；第 100 集 ⇒ 0；第 101 集 ⇒ 1', () => {
        expect(pageIndexOf(0)).toBe(0);
        expect(pageIndexOf(99)).toBe(0);
        expect(pageIndexOf(100)).toBe(1);
    });

    it('🔴 越界 / 负数 / 非法一律归 **0**（⛔ 不返回 -1 那种让调用方再判一次的值）', () => {
        expect(pageIndexOf(-1)).toBe(0);
        expect(pageIndexOf(-999)).toBe(0);
        expect(pageIndexOf(Number.NaN)).toBe(0);
        expect(pageIndexOf(Number.POSITIVE_INFINITY)).toBe(0);
    });
});

describe('pageSlice（一页覆盖的 0 基下标区间 [start, end)）', () => {
    it('100 集 1 页 ⇒ [0,100]（末页右端是**总集数**，不是 start+size）', () => {
        expect(pageSlice(0, 100)).toEqual([0, 100]);
    });

    it('201 集：三页 = [0,100] [100,200] [200,201]（末页只到 201，⛔ 不越界）', () => {
        expect(pageSlice(0, 201)).toEqual([0, 100]);
        expect(pageSlice(1, 201)).toEqual([100, 200]);
        expect(pageSlice(2, 201)).toEqual([200, 201]);
    });

    it('🔴 页号越界**钳到最后一页**（⛔ 不许返回空区间 —— 那会让界面一片空白）', () => {
        expect(pageSlice(9, 201)).toEqual([200, 201]);
        expect(pageSlice(-4, 201)).toEqual([0, 100]);
    });

    it('0 集 ⇒ [0,0]（空列表，不抛错）', () => {
        expect(pageSlice(0, 0)).toEqual([0, 0]);
        expect(pageSlice(3, 0)).toEqual([0, 0]);
    });
});

describe('pageBarItems（页码条该显示哪几格）', () => {
    it('页数 ≤ 7 ⇒ **全列**（7 格以内没有省略的意义）', () => {
        expect(pageBarItems(1, 0)).toEqual([1]);
        expect(pageBarItems(7, 3)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('🔴 用户给的那一串：**10 页停在第 1 页 ⇒ `1 2 3 … 8 9 10`**', () => {
        expect(pageBarItems(10, 0)).toEqual([1, 2, 3, '…', 8, 9, 10]);
    });

    it('🔴 **当前页恒在列**（这是页码条存在的意义）：停在第 5 页 ⇒ 中间那段必须含 5', () => {
        const bar = pageBarItems(10, 4);
        expect(bar).toContain(5);
        expect(bar).toEqual([1, 2, 3, 4, 5, 6, '…', 8, 9, 10]);
    });

    it('停在第 9 页 ⇒ 末段与窗口相接，不出现多余的省略号', () => {
        expect(pageBarItems(10, 8)).toEqual([1, 2, 3, '…', 8, 9, 10]);
    });

    it('省略号只在**真的断开**处出现（相邻差 1 不插）', () => {
        const bar = pageBarItems(20, 9);
        expect(bar).toEqual([1, 2, 3, '…', 9, 10, 11, '…', 18, 19, 20]);
        // 首段与窗口之间确实断开 ⇒ 恰两枚省略号
        expect(bar.filter((x) => x === '…')).toHaveLength(2);
    });

    it('🔴 越界 current 钳制；总页数非法 ⇒ 至少 1 页（`[1]`）', () => {
        expect(pageBarItems(10, 99)).toEqual([1, 2, 3, '…', 8, 9, 10]);
        expect(pageBarItems(10, -5)).toEqual([1, 2, 3, '…', 8, 9, 10]);
        expect(pageBarItems(0, 3)).toEqual([1]);
    });
});

describe('pageStep（上一页 / 下一页）', () => {
    it('正常 ±1', () => {
        expect(pageStep(2, 10, 1)).toBe(3);
        expect(pageStep(2, 10, -1)).toBe(1);
    });

    it('🔴 两端钳住（⛔ 不绕回、不越界）', () => {
        expect(pageStep(0, 10, -1)).toBe(0);
        expect(pageStep(9, 10, 1)).toBe(9);
    });

    it('非法 delta / 非法页号都退回 0 页', () => {
        expect(pageStep(0, 10, Number.NaN)).toBe(0);
        expect(pageStep(Number.NaN, 10, 1)).toBe(1);
    });
});
