// 「回到顶部」按钮的显隐判据（pure/topButton，#570）—— 守两件事：
//   ① 阈值判据（含脏值）；② 「只认本视图的滚动容器」的归属判定
import { describe, expect, it } from 'vitest';
import { TOP_SHOW_THRESHOLD, shouldShowTop, wrapsRoot } from 'pure/topButton';

describe('shouldShowTop（回到顶部的显隐阈值）', () => {
    it('阈值 = 110（页签 + 搜索行 + 筛选行三行总高）', () => {
        expect(TOP_SHOW_THRESHOLD).toBe(110);
    });

    it('🔴 恰好等于阈值不显示、越过才显示', () => {
        expect(shouldShowTop(0)).toBe(false);
        expect(shouldShowTop(109)).toBe(false);
        expect(shouldShowTop(110)).toBe(false);
        expect(shouldShowTop(111)).toBe(true);
    });

    it('🔴 滚到底部（极大的 scrollTop）当然要显示 —— 用户点名的「滑到底部不显示」正是这条被破坏的症状', () => {
        expect(shouldShowTop(99999)).toBe(true);
    });

    it('脏值一律不显示（NaN / Infinity / 负数）', () => {
        expect(shouldShowTop(NaN)).toBe(false);
        expect(shouldShowTop(Infinity)).toBe(false);
        expect(shouldShowTop(-5)).toBe(false);
    });

    it('阈值可覆盖（留给将来调参）', () => {
        expect(shouldShowTop(50, 40)).toBe(true);
        expect(shouldShowTop(50, 80)).toBe(false);
    });
});

describe('wrapsRoot（只认「包着本视图」的滚动容器）', () => {
    const root = { name: 'root' };

    it('容器就是根自己 ⇒ 认', () => {
        expect(wrapsRoot(root, root)).toBe(true);
    });

    it('容器是根的祖先（`contains` 为真）⇒ 认', () => {
        const pane = { contains: (n: unknown) => n === root };
        expect(wrapsRoot(pane, root)).toBe(true);
    });

    it('🔴 与根无关的容器（别的面板 / 侧栏滚了）⇒ 不认（否则按钮会被别处的滚动带得乱闪）', () => {
        const other = { contains: () => false };
        expect(wrapsRoot(other, root)).toBe(false);
    });

    it('认不出的一律 false；缺 target / 缺 root 也是 false（调用方保持上一次认准的容器）', () => {
        expect(wrapsRoot(null, root)).toBe(false);
        expect(wrapsRoot(root, null)).toBe(false);
        expect(wrapsRoot({}, root)).toBe(false);
        expect(wrapsRoot('document', root)).toBe(false);
        expect(wrapsRoot(123, root)).toBe(false);
    });
});
