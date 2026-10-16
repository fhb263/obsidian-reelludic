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

// ── #610：可用区 = 视口 ∩「内容区」──────────────────────────────────────────
// 用户报障：「系列合集卡右键出现的菜单…还是在侧边栏的下面」。
// 真根因：菜单是 `absolute` 挂在**内容锚点**里，而 `placeMenu` 原先**只按视口钳制** ⇒
//   翻转后仍越界时被压到视口 margin（6）⇒ 换算成锚点相对坐标是**负值** ⇒ 整块跑到内容区左侧、
//   落进 Obsidian 左侧栏底下被盖住。窗口越窄越容易撞（内容区比菜单宽不了多少时必撞）。
// ⇒ 修法：钳制发生在「可用区」（视口 ∩ 内容区）内，调用方把内容区左右界传进来。
describe('placeMenu.minX / maxX（#610 可用区钳制 · 不钻到侧栏底下）', () => {
    // 视口 1000 宽、左侧栏占 0..300 ⇒ 内容区 300..1000
    const band = { ...base, minX: 300, maxX: 1000 };

    it('🔴 鼠标落在内容区里且与右界有富余 ⇒ 与不传时完全一致（可用区只在越界时起作用）', () => {
        expect(placeMenu({ ...band, x: 500, y: 100 }).left).toBe(500);
        expect(placeMenu({ ...base, x: 500, y: 100 }).left).toBe(500);
    });

    it('🔴🔴 **窄窗口**是出事的那档：菜单无处可放时，落点必须是**内容区左界**（300）'
        + '⛔ 不是视口 margin（6）—— 6−300 = −294 的负偏移正是「跑到侧栏底下」', () => {
        // 视口 500、内容区 300..500、菜单 140：翻到左侧后 252 < 300 ⇒ 必须钳回 300
        const narrow = { vw: 500, vh: 800, menuW: 140, menuH: 150 };
        const fixed = placeMenu({ ...narrow, minX: 300, maxX: 500, x: 400, y: 100 });
        const old = placeMenu({ ...narrow, x: 400, y: 100 });
        expect(fixed.left).toBe(300); // 贴内容区左界 ⇒ 换算成锚点相对坐标 = 0
        expect(old.left).toBe(252); // 旧行为：252 < 300 ⇒ 负偏移 −48 ⇒ 左半截钻到侧栏底下
        expect(old.left).toBeLessThan(300);
    });

    it('🔴 右界同样收口：`maxX` 之外不算可用区（内容区右侧被别的面板占了时同理）', () => {
        const p = placeMenu({ ...band, maxX: 700, x: 690, y: 100 });
        expect(p.left).toBe(542); // 690+140=830 > 694 ⇒ 翻到 542；整块 542..682 不出 700
        expect(p.left + 140).toBeLessThanOrEqual(700);
    });

    it('🔴 可用区比菜单还窄 ⇒ 封顶 `maxWidth`，且左界**仍是内容区左界**（不钻到侧栏下）', () => {
        const p = placeMenu({ ...band, minX: 300, maxX: 360, x: 330, y: 100 });
        expect(p.left).toBe(300);
        expect(p.maxWidth).toBe(54); // 354 − 300
    });

    it('🔴 只传 minX（不给 maxX）⇒ 右界仍按视口（缺省值不得改变既有行为）', () => {
        const p = placeMenu({ ...base, minX: 300, x: 990, y: 100 });
        expect(p.left).toBe(842); // 翻到 842；842+140=982 ≤ 994
        expect(placeMenu({ ...base, x: 990, y: 100 }).left).toBe(842); // 与不传同值
    });

    it('🔴 入参脏（minX > maxX / 越出视口）⇒ 不出负、不 NaN（⛔ 别让钳制自己造出「钻到侧栏下」）', () => {
        const a = placeMenu({ ...base, minX: 800, maxX: 400, x: 500, y: 100 });
        expect(Number.isFinite(a.left)).toBe(true);
        expect(a.left).toBeGreaterThanOrEqual(0);
        const b = placeMenu({ ...base, minX: -50, maxX: 5000, x: 500, y: 100 });
        expect(b.left).toBe(500);
    });
});
