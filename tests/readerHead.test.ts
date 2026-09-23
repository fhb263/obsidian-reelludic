import { describe, it, expect } from 'vitest';
import { HEAD_NARROW_W, HEAD_NARROW_CLASS, shouldCollapseQuick, headTitleSymmetricWidth } from 'pure/readerHead';

/**
 * #345 顶栏窄屏收纳：宽度阈值判定（DOM 搬运部分靠真机验证，见 attachHeadDensity）。
 * ⚠️ #347 把阈值由 900 下调到 720（用户：「顶栏收起菜单变化再窄一点再显示」）—— 下面是**改后的契约**。
 */
describe('shouldCollapseQuick（顶栏窄屏收纳判定）', () => {
    it('低于阈值 → 收纳快捷入口', () => {
        expect(shouldCollapseQuick(320)).toBe(true);
        expect(shouldCollapseQuick(600)).toBe(true);
        expect(shouldCollapseQuick(HEAD_NARROW_W - 1)).toBe(true);
    });

    it('阈值及以上 → 保持展开（720 本身不再收纳 —— #347 之前 900 就收，用户嫌太早）', () => {
        expect(shouldCollapseQuick(HEAD_NARROW_W)).toBe(false);
        expect(shouldCollapseQuick(720)).toBe(false);
        expect(shouldCollapseQuick(900)).toBe(false);
        expect(shouldCollapseQuick(1200)).toBe(false);
        expect(shouldCollapseQuick(2560)).toBe(false);
    });

    it('🔴 宽度 ≤ 0 / 非法值 → 不收纳（视图刚 mount 尚未布局时不能误判为窄屏）', () => {
        expect(shouldCollapseQuick(0)).toBe(false);
        expect(shouldCollapseQuick(-1)).toBe(false);
        expect(shouldCollapseQuick(NaN)).toBe(false);
        expect(shouldCollapseQuick(Infinity)).toBe(false);
    });

    it('阈值常量与类名是本模块的对外契约', () => {
        expect(HEAD_NARROW_W).toBe(720);
        expect(HEAD_NARROW_CLASS).toBe('rl-head-narrow');
    });
});

/**
 * #379 顶栏标题居中：绝对居中 + JS 对称限宽（用户 2026-09-23：「我怎么感觉不是居中显示的？」）。
 *
 * 背景：#345 把标题从「绝对居中」改成「流式三段」（修「长章节名压右组图标」），代价是标题**只在中段里居中** ——
 * 左组只有 2 钮（目录 + 打开笔记 ≈ 86px），右组装着 6 个快捷入口 + 设置（≈ 250px）
 * ⇒ 实测（`_shot/rl379-head.html`，真实 Chromium）**标题恒定偏左 81.8px**。
 * ⇒ 回到绝对居中，宽度由本函数算：取**较近的一侧**做半径、两侧对称 ⇒ 中心恒在面板中心。
 */
describe('headTitleSymmetricWidth（标题对称可用宽）', () => {
    it('取**较近**的一侧做半径：左 438 / 右 274 ⇒ 548 = 2×274（偏窄那一侧才是约束）', () => {
        expect(headTitleSymmetricWidth(438, 274)).toBe(548);
    });

    it('左右互换结果相同 —— 这条就是「居中」的定义（谁窄谁说了算）', () => {
        expect(headTitleSymmetricWidth(274, 438)).toBe(548);
    });

    it('实测场景复算：内容宽 1068 / 左组 86 / 右组 250 / gap 10 ⇒ 到左 442−10=438、到右 834−10−550=274 ⇒ 548', () => {
        const panelCenter = 16 + 1068 / 2; // head 左内边距 16
        const toLeft = panelCenter - (16 + 86 + 10);
        const toRight = 16 + 1068 - 250 - 10 - panelCenter;
        expect(headTitleSymmetricWidth(toLeft, toRight)).toBe(548);
    });

    it('🔴 一侧没有余量 ⇒ 0（宁可标题收成 0 宽，也不许压到按钮上）', () => {
        expect(headTitleSymmetricWidth(0, 100)).toBe(0);
        expect(headTitleSymmetricWidth(100, 0)).toBe(0);
        expect(headTitleSymmetricWidth(-30, 100)).toBe(0);
    });

    it('非法输入按 0（DOM 未布局时读到的 NaN / Infinity 不得产出 `max-width:NaNpx`）', () => {
        expect(headTitleSymmetricWidth(NaN, 200)).toBe(0);
        expect(headTitleSymmetricWidth(200, Infinity)).toBe(0);
        expect(headTitleSymmetricWidth(Infinity, Infinity)).toBe(0);
    });

    it('两侧等距 ⇒ 等于两侧之和（无损失，且仍在面板正中）', () => {
        expect(headTitleSymmetricWidth(300, 300)).toBe(600);
    });
});
