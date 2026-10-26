// 统计页版式（自由排序 + 左右并排 + 自适应）单测（#657 / #658）
// 契约来源：用户「统计页的所有元素支持自由排序，自适应」+「怎么没设计自由左右布局啊？」
import { describe, expect, it } from 'vitest';
import {
    STATS_BLOCK_DEFAULTS,
    STATS_BLOCK_LABELS,
    STATS_EDGE_BAND,
    STATS_NARROW_MAX,
    dropTargetOf,
    isDefaultStatsOrder,
    moveStatsBlock,
    moveStatsBlockTwoCols,
    normalizeStatsOrder,
    statsBlockCols,
    statsHalfWidth,
    STATS_BLOCK_MIN_HALF,
    STATS_GRID_GAP,
} from 'pure/statsLayout';

describe('statsLayout · 归一', () => {
    it('缺省顺序 = 原三层倒金字塔的视觉顺序，且每块都有展示名', () => {
        expect([...STATS_BLOCK_DEFAULTS]).toEqual(['hero', 'feed', 'trend', 'overview', 'board']);
        for (const k of STATS_BLOCK_DEFAULTS) expect(STATS_BLOCK_LABELS[k]).toBeTruthy();
    });

    it('undefined / 非数组 ⇒ 缺省（老用户零迁移）', () => {
        expect(normalizeStatsOrder(undefined)).toEqual([...STATS_BLOCK_DEFAULTS]);
        expect(normalizeStatsOrder('oops')).toEqual([...STATS_BLOCK_DEFAULTS]);
    });

    it('丢弃未知键与重复项，保留用户顺序；缺失键**追加到末尾**', () => {
        expect(normalizeStatsOrder(['board', '__nope__', 'hero', 'board', 'feed'])).toEqual([
            'board', 'hero', 'feed', 'trend', 'overview',
        ]);
        const out = normalizeStatsOrder(['board']);
        expect(out[0]).toBe('board');
        expect(new Set(out).size).toBe(STATS_BLOCK_DEFAULTS.length);
    });

    it('与缺省逐位一致 ⇒ `isDefaultStatsOrder` 为真（宿主据此删键）', () => {
        expect(isDefaultStatsOrder([...STATS_BLOCK_DEFAULTS])).toBe(true);
        expect(isDefaultStatsOrder(['board', 'hero', 'feed', 'trend', 'overview'])).toBe(false);
    });
});

describe('statsLayout · 单列移动（moveStatsBlock）', () => {
    const order = [...STATS_BLOCK_DEFAULTS];

    it('插到目标前 / 后', () => {
        expect(moveStatsBlock(order, 'board', 'hero', 'before')).toEqual(['board', 'hero', 'feed', 'trend', 'overview']);
        expect(moveStatsBlock(order, 'board', 'hero', 'after')).toEqual(['hero', 'board', 'feed', 'trend', 'overview']);
    });

    it('⛔ 不改入参', () => {
        const copy = [...order];
        moveStatsBlock(order, 'board', 'hero', 'before');
        expect(order).toEqual(copy);
    });

    it('未知键 ⇒ 原样返回（⛔ 不许把脏键插进表里 —— 单测抓到过的真 bug）', () => {
        expect(moveStatsBlock(order, 'nope' as never, 'hero', 'after')).toEqual(order);
        expect(moveStatsBlock(order, 'hero', 'nope' as never, 'after')).toEqual(order);
    });

    it('挪完仍是五个键、不重不漏（不变量）', () => {
        for (const from of STATS_BLOCK_DEFAULTS) {
            for (const to of STATS_BLOCK_DEFAULTS) {
                for (const side of ['before', 'after'] as const) {
                    const out = moveStatsBlock(order, from, to, side);
                    expect(out.length).toBe(order.length);
                    expect(new Set(out).size).toBe(order.length);
                }
            }
        }
    });
});

describe('statsLayout · 两列落点（#658 自由左右布局）', () => {
    // 400×200 的区块：上下各 40px 是"整行插入"边缘带
    const rect = { top: 100, bottom: 300, left: 0, right: 400 };

    it('上缘 / 下缘 ⇒ 整行插入（⛔ 不许被当成并排，否则没法插到两行之间）', () => {
        const top = dropTargetOf(rect, 200, 110);
        expect(top.fullRow).toBe(true);
        expect(top.side).toBe('before');
        const bottom = dropTargetOf(rect, 200, 290);
        expect(bottom.fullRow).toBe(true);
        expect(bottom.side).toBe('after');
        expect(STATS_EDGE_BAND).toBeGreaterThan(0);
    });

    it('中间靠左 ⇒ 并排到左边；靠右 ⇒ 并排到右边', () => {
        const left = dropTargetOf(rect, 40, 200);
        expect(left.fullRow).toBe(false);
        expect(left.col).toBe(0);
        const right = dropTargetOf(rect, 360, 200);
        expect(right.fullRow).toBe(false);
        expect(right.col).toBe(1);
    });

    it('并排到右半 ⇒ 插到目标**之后**（同一行右格）；并排到左半 ⇒ 插到目标**之前**', () => {
        const order = [...STATS_BLOCK_DEFAULTS];
        const toRight = moveStatsBlockTwoCols(order, 'board', { key: 'trend', side: 'after', col: 1, fullRow: false });
        expect(toRight.indexOf('board')).toBe(toRight.indexOf('trend') + 1);
        const toLeft = moveStatsBlockTwoCols(order, 'board', { key: 'trend', side: 'before', col: 0, fullRow: false });
        expect(toLeft.indexOf('board')).toBe(toLeft.indexOf('trend') - 1);
    });

    it('拖到自己身上 / 未知键 ⇒ 原样返回', () => {
        const order = [...STATS_BLOCK_DEFAULTS];
        expect(moveStatsBlockTwoCols(order, 'hero', { key: 'hero', side: 'after', col: 1, fullRow: false })).toEqual(order);
        expect(moveStatsBlockTwoCols(order, 'nope' as never, { key: 'hero', side: 'after', col: 1, fullRow: false })).toEqual(order);
    });
});

describe('statsLayout · 自适应列数（statsBlockCols，内容优先）', () => {
    it('窄屏一律 1 列', () => {
        for (const k of STATS_BLOCK_DEFAULTS) expect(statsBlockCols(k, STATS_NARROW_MAX - 1)).toBe(1);
    });

    it('🔴 #661 宽屏下**每个区块都能半行**（⛔ 不再有"某块天生整行"的名单）', () => {
        // 1400px 时半栏 ≈ 694 ⇒ 五个区块的最小宽度全都放得下
        for (const k of STATS_BLOCK_DEFAULTS) expect(statsBlockCols(k, 1400)).toBe(1);
    });

    it('半栏放不下时才退回整行（各块按自己的 `minHalf`）', () => {
        // 900px：半栏 = 444 ⇒ 趋势(380)/概览(360)/动态(420) 放得下；核心指标(520)/看板(620)放不下
        expect(statsBlockCols('trend', 900)).toBe(1);
        expect(statsBlockCols('overview', 900)).toBe(1);
        expect(statsBlockCols('feed', 900)).toBe(1);
        expect(statsBlockCols('hero', 900)).toBe(2);
        expect(statsBlockCols('board', 900)).toBe(2);
    });

    it('边界严丝合缝：刚好放得下 ⇒ 半行；差 2px ⇒ 整行', () => {
        expect(statsHalfWidth(1000)).toBe((1000 - STATS_GRID_GAP) / 2);
        for (const k of STATS_BLOCK_DEFAULTS) {
            const min = STATS_BLOCK_MIN_HALF[k];
            expect(statsBlockCols(k, min * 2 + STATS_GRID_GAP)).toBe(1);
            expect(statsBlockCols(k, min * 2 + STATS_GRID_GAP - 2)).toBe(2);
        }
    });
});
