import { describe, it, expect } from 'vitest';
import { computeVirtualWindow, VIRTUAL_THRESHOLD, DEFAULT_OVERSCAN_ROWS } from 'pure/virtualWindow';

/** 基准输入：600px 视口 / 200px 行高 / 5 列：一次可见 3 行 */
const base = { scrollTop: 0, viewportHeight: 600, rowHeight: 200, columns: 5 };

describe('pure/virtualWindow 海报墙虚拟滚动窗口', () => {
    it('未超过阈值 → 不启用，要求全量渲染', () => {
        const r = computeVirtualWindow({ ...base, itemCount: VIRTUAL_THRESHOLD, scrollTop: 99999 });
        expect(r.enabled).toBe(false);
        expect(r.startIndex).toBe(0);
        expect(r.endIndex).toBe(VIRTUAL_THRESHOLD);
        expect(r.paddingTop).toBe(0);
        expect(r.paddingBottom).toBe(0);
    });

    it('刚好超过阈值 → 启用', () => {
        const r = computeVirtualWindow({ ...base, itemCount: VIRTUAL_THRESHOLD + 1 });
        expect(r.enabled).toBe(true);
    });

    it('停在顶部：窗口从第 0 行起，overscan 不越上界', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, scrollTop: 0 });
        // 可见 0..2 行，overscan 2 → endRow=4；startRow 钳回 0
        expect(r.startRow).toBe(0);
        expect(r.endRow).toBe(4);
        expect(r.startIndex).toBe(0);
        expect(r.endIndex).toBe(25);
        expect(r.paddingTop).toBe(0);
        expect(r.paddingBottom).toBe(195 * 200);
    });

    it('滚到中部：窗口随 scrollTop 平移', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, scrollTop: 2000 });
        // 首可见行 10，末可见行 12，overscan 2 → 8..14
        expect(r.startRow).toBe(8);
        expect(r.endRow).toBe(14);
        expect(r.startIndex).toBe(40);
        expect(r.endIndex).toBe(75);
        expect(r.paddingTop).toBe(1600);
        expect(r.paddingBottom).toBe(185 * 200);
    });

    it('overscan 可配：0 = 只渲染可见行', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, scrollTop: 2000, overscanRows: 0 });
        expect(r.startRow).toBe(10);
        expect(r.endRow).toBe(12);
        expect(r.startIndex).toBe(50);
        expect(r.endIndex).toBe(65);
    });

    it('滚到底：末行收在最后一行，底部留白为 0，末行不会被列数截断', () => {
        // 1002 条 / 5 列 = 201 行（末行只有 2 个）
        const r = computeVirtualWindow({ ...base, itemCount: 1002, scrollTop: 999999 });
        expect(r.endRow).toBe(200);
        expect(r.endIndex).toBe(1002);
        expect(r.paddingBottom).toBe(0);
    });

    it('高度守恒：上下留白 + 渲染行高 恒等于 总行高', () => {
        for (const scrollTop of [0, 137, 2000, 999999]) {
            for (const itemCount of [501, 1000, 1002, 5000]) {
                const r = computeVirtualWindow({ ...base, itemCount, scrollTop });
                const rows = Math.ceil(itemCount / base.columns);
                const renderRows = r.endRow - r.startRow + 1;
                expect(r.paddingTop + renderRows * base.rowHeight + r.paddingBottom).toBe(rows * base.rowHeight);
            }
        }
    });

    it('条目数为 0：不启用且区间为空，不产生负数留白', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 0 });
        expect(r.enabled).toBe(false);
        expect(r.startRow).toBe(0);
        expect(r.endRow).toBe(-1);
        expect(r.startIndex).toBe(0);
        expect(r.endIndex).toBe(0);
        expect(r.paddingTop).toBe(0);
        expect(r.paddingBottom).toBe(0);
    });

    it('非法列数回退为 1 列（不产生 NaN / Infinity）', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, columns: 0 });
        expect(Number.isFinite(r.endIndex)).toBe(true);
        expect(r.startIndex).toBe(0);
        expect(r.endIndex).toBeGreaterThan(0);
    });

    it('非法行高回退为 1px（不产生 NaN / Infinity）', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, rowHeight: 0, scrollTop: 500 });
        expect(Number.isFinite(r.paddingTop)).toBe(true);
        expect(Number.isFinite(r.paddingBottom)).toBe(true);
        expect(r.startRow).toBeGreaterThanOrEqual(0);
    });

    it('负 scrollTop（弹性滚动）钳到 0', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, scrollTop: -400 });
        expect(r.startRow).toBe(0);
        expect(r.startIndex).toBe(0);
        expect(r.paddingTop).toBe(0);
    });

    it('视口为 0 时至少渲染一行，不出现空窗口', () => {
        const r = computeVirtualWindow({ ...base, itemCount: 1000, viewportHeight: 0 });
        expect(r.endRow).toBeGreaterThanOrEqual(r.startRow);
    });

    it('常量：阈值 500、默认 overscan 2 行', () => {
        expect(VIRTUAL_THRESHOLD).toBe(500);
        expect(DEFAULT_OVERSCAN_ROWS).toBe(2);
    });
});
