// 「回到顶部」按钮的显隐判据（pure/topButton，#570）—— 守两件事：
//   ① 阈值判据（含脏值）；② 「只认本视图的滚动容器」的归属判定
import { describe, expect, it } from 'vitest';
import { TOP_IDLE_MS, TOP_SHOW_THRESHOLD, shouldShowTop, topVisible, wrapsRoot } from 'pure/topButton';

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

// ══════════════════════════════════════════════════════════════════════════════
// #624 自动隐藏（用户 2026-10-13：「『回到顶部』按钮应该添加鼠标无上下滑动动作则自动隐藏的机制」）
// 口径：停滚 3 秒后隐藏，但**鼠标停在按钮上时不隐藏**（否则想点的那一刻它刚好淡出）。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #624 topVisible（位置 ∧ 静止 ∧ 悬停）', () => {
    const at = (scrollTop: number, hovering = false, idle = false) => topVisible(scrollTop, { hovering, idle });

    it('位置不够 ⇒ 恒不显示（与静止 / 悬停两个状态无关）', () => {
        expect(at(0)).toBe(false);
        expect(at(50, true, true)).toBe(false);
        expect(at(TOP_SHOW_THRESHOLD)).toBe(false); // 恰好等于阈值 ⇒ 不显示（与 shouldShowTop 同口径）
    });

    it('位置够 + 还在滚（idle=false）⇒ 显示', () => {
        expect(at(TOP_SHOW_THRESHOLD + 1)).toBe(true);
        expect(at(5000)).toBe(true);
    });

    it('🔴 位置够 + 已静止 ⇒ **隐藏**（「无上下滑动动作则自动隐藏」就是这条）', () => {
        expect(at(500, false, true)).toBe(false);
    });

    it('🔴🔴 位置够 + 已静止 + **鼠标停在按钮上** ⇒ 仍显示（⛔ 别把这条判据删掉：删了就等于「要点的瞬间它消失」）', () => {
        expect(at(500, true, true)).toBe(true);
    });

    it('阈值可覆盖（留给将来调参）', () => {
        expect(topVisible(90, { hovering: false, idle: false }, 100)).toBe(false);
        expect(topVisible(110, { hovering: false, idle: false }, 100)).toBe(true);
        expect(topVisible(110, { hovering: false, idle: true }, 100)).toBe(false);
    });

    it('静止时长常量 = 3000ms（用户在「1.5 秒 / 3 秒」两档里点的 3 秒）', () => {
        expect(TOP_IDLE_MS).toBe(3000);
    });
});
