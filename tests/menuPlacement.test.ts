// 右键菜单边界自适应纯换算测试：贴鼠标展开 → 越界翻转 → 双向钳制 → 超高/超宽封顶。
// 坐标全部为视口系（left/top 直接给 position:fixed 用；锚点系调用方再做一次减法换算）。
import { describe, it, expect } from 'vitest';
import { placeMenu } from 'pure/menuPlacement';

/** 视口 1000×800、菜单 140×150 的常用基准 */
const base = { vw: 1000, vh: 800, menuW: 140, menuH: 150 } as const;

describe('pure/menuPlacement 空间充足', () => {
    it('右下都有空间 → 贴鼠标，不翻转不钳制、无封顶', () => {
        const p = placeMenu({ ...base, x: 100, y: 100 });
        expect(p).toEqual({ left: 100, top: 100, maxHeight: undefined, maxWidth: undefined });
    });
});

describe('pure/menuPlacement 边缘翻转', () => {
    it('右边缘 → 翻到鼠标左侧（留 flipGap 8）', () => {
        const p = placeMenu({ ...base, x: 960, y: 100 });
        expect(p.left).toBe(960 - 140 - 8);
        expect(p.top).toBe(100);
    });
    it('下边缘 → 翻到鼠标上方（留 flipGap 8）', () => {
        const p = placeMenu({ ...base, x: 100, y: 780 });
        expect(p.top).toBe(780 - 150 - 8);
        expect(p.left).toBe(100);
    });
    it('右下角 → 双向翻转', () => {
        const p = placeMenu({ ...base, x: 960, y: 780 });
        expect(p.left).toBe(812);
        expect(p.top).toBe(622);
    });
    it('翻转侧同样越界 → 钳制到 margin（不自造负坐标）', () => {
        // 菜单比视口宽：右翻左都放不下 → 只能钳到 margin
        const p = placeMenu({ ...base, menuW: 1200, menuH: 150, x: 500, y: 100 });
        expect(p.left).toBe(6);
        expect(p.maxWidth).toBe(1000 - 12);
    });
});

describe('pure/menuPlacement 超高/超宽封顶', () => {
    it('菜单高于可用高度 → maxHeight = vh − 2×margin，且 top 钳到 margin', () => {
        const p = placeMenu({ ...base, menuH: 1000, x: 400, y: 400 });
        expect(p.maxHeight).toBe(800 - 12);
        expect(p.top).toBe(6);
    });
    it('菜单宽于可用宽度 → maxWidth = vw − 2×margin，且 left 钳到 margin', () => {
        const p = placeMenu({ ...base, menuW: 1400, x: 400, y: 400 });
        expect(p.maxWidth).toBe(1000 - 12);
        expect(p.left).toBe(6);
    });
    it('未超限时不返回 maxHeight / maxWidth（CSS 不吃多余内联值）', () => {
        const p = placeMenu({ ...base, x: 10, y: 10 });
        expect(p.maxHeight).toBeUndefined();
        expect(p.maxWidth).toBeUndefined();
    });
});

describe('pure/menuPlacement 参数与退化输入', () => {
    it('flipGap 覆写：翻转落点按自定义间隙计算', () => {
        const p = placeMenu({ ...base, x: 999, y: 640, margin: 20, flipGap: 20 });
        expect(p.left).toBe(999 - 140 - 20); // 839，未越 1000−140−20=840
        expect(p.top).toBe(640 - 150 - 20); // 470，未触发钳制
    });
    it('margin 覆写：翻转后越界按自定义留白钳制', () => {
        const p = placeMenu({ ...base, x: 999, y: 799, margin: 20, flipGap: 0 });
        expect(p.left).toBe(1000 - 140 - 20); // 859 → 钳到 840
        expect(p.top).toBe(800 - 150 - 20); // 649 → 钳到 630
    });
    it('视口极小 → 全部落在 margin 内，不出负数', () => {
        const p = placeMenu({ vw: 20, vh: 20, menuW: 140, menuH: 150, x: 10, y: 10 });
        expect(p.left).toBe(6);
        expect(p.top).toBe(6);
        expect(p.maxHeight).toBe(8);
        expect(p.maxWidth).toBe(8);
    });
    it('视口为 0 → 不产生 NaN / 负值', () => {
        const p = placeMenu({ vw: 0, vh: 0, menuW: 140, menuH: 150, x: 0, y: 0 });
        expect(Number.isFinite(p.left)).toBe(true);
        expect(Number.isFinite(p.top)).toBe(true);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeGreaterThanOrEqual(0);
    });
});
