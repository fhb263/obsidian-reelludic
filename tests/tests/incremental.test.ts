// 长列表「滚动加载」纯逻辑单测（#556）
// 口径：滚动 → 接近底部时追加一批；**节流 200ms**（滚动会连发事件，防抖在这里是错的工具）。
import { describe, it, expect } from 'vitest';
import { LIST_BATCH, nextShown, shouldGrow, canGrow } from 'pure/incremental';

describe('nextShown 追加一批（封顶总量）', () => {
    it('常规追加', () => {
        expect(nextShown(40, 200)).toBe(80);
        expect(nextShown(0, 200, 10)).toBe(10);
    });
    it('封顶在 total（⛔ 不会超出）', () => {
        expect(nextShown(180, 200)).toBe(200);
        expect(nextShown(200, 200)).toBe(200);
        expect(nextShown(0, 5, 40)).toBe(5);
    });
    it('总数为 0 / 负数入参一律回 0（脏输入不放大）', () => {
        expect(nextShown(0, 0)).toBe(0);
        expect(nextShown(-5, 100, 10)).toBe(10);
    });
    it('缺省批大小 = LIST_BATCH', () => {
        expect(nextShown(0, 1000)).toBe(LIST_BATCH);
    });
});

describe('shouldGrow 接近底部判定', () => {
    it('滚动到底部 / 进入余量区 ⇒ 追加', () => {
        expect(shouldGrow(900, 300, 1200)).toBe(true);   // 刚好到底
        expect(shouldGrow(880, 300, 1200)).toBe(true);   // 距底 20px，落在 80 余量内
    });
    it('还差得远 ⇒ 不追加', () => {
        expect(shouldGrow(100, 300, 1200)).toBe(false);
        expect(shouldGrow(700, 300, 1200)).toBe(false);  // 距底 200px > 80
    });
    it('内容没满一屏 ⇒ 不追加（⛔ 别开屏就把整列灌进去）', () => {
        expect(shouldGrow(0, 400, 300)).toBe(false);
        expect(shouldGrow(0, 400, 400)).toBe(false);
    });
});

describe('canGrow 节流闸门（200ms）', () => {
    it('首次（lastAt 为 0）必须放行 —— 否则开机后要等 200ms 才第一次加载', () => {
        expect(canGrow(0, 1234567)).toBe(true);
    });
    it('间隔不足 200ms ⇒ 拦下', () => {
        expect(canGrow(1000, 1100)).toBe(false);
        expect(canGrow(1000, 1199)).toBe(false);
    });
    it('满 200ms ⇒ 放行', () => {
        expect(canGrow(1000, 1200)).toBe(true);
        expect(canGrow(1000, 1500)).toBe(true);
    });
    it('gap 可覆盖', () => {
        expect(canGrow(1000, 1050, 50)).toBe(true);
    });
});
