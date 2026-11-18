// 排序选项表（pure/sortOptions）—— 守「表只有一份」与「系列序号两档只属于单系列视图」。
import { describe, expect, it } from 'vitest';
import { SORT_OPTIONS, SORT_OPTIONS_BASE, normalizeSortBy, sortOptionsFor } from 'pure/sortOptions';

describe('sortOptions · 排序选项表（#547 从 MediaList 外移）', () => {
    it('12 向齐全（标题/年份/状态两套评分 × 正反 + 系列序号两档）', () => {
        expect(SORT_OPTIONS).toHaveLength(12);
        expect(SORT_OPTIONS[0]).toEqual({ value: 'recent', label: '最近更新 ↓' });
        expect(SORT_OPTIONS.map((o) => o.value)).toContain('series-asc');
    });

    it('🔴 BASE 版**恰好**去掉「系列序号」那两档 —— 单系列视图才该看到它们', () => {
        expect(SORT_OPTIONS_BASE).toHaveLength(10);
        expect(SORT_OPTIONS_BASE.some((o) => o.value.startsWith('series-'))).toBe(false);
        // ⚠️ 顺序必须与全表一致（子集不是另排一遍）：合并视图的顶端筛选栏直接拿它渲染
        expect(SORT_OPTIONS_BASE.map((o) => o.value)).toEqual(
            SORT_OPTIONS.filter((o) => !o.value.startsWith('series-')).map((o) => o.value),
        );
    });

    it('归一：认表里的值（含只在全表里的 series-*，需显式给池），其余回 recent', () => {
        expect(normalizeSortBy('title-asc')).toBe('title-asc');
        expect(normalizeSortBy('recent')).toBe('recent');
        expect(normalizeSortBy(undefined)).toBe('recent');
        expect(normalizeSortBy('nope')).toBe('recent');
        // ⚠️ `series-asc` **不在** BASE 里 ⇒ 默认池认不出它（系列视图那边显式传 SORT_OPTIONS）
        expect(normalizeSortBy('series-asc')).toBe('recent');
        expect(normalizeSortBy('series-asc', SORT_OPTIONS)).toBe('series-asc');
    });

    /**
     * 🔴 m08754 ②：用户逐字「在页签为文学/网文/音乐/游戏的排序中加两个按『统计时长』上下的项」。
     * 这四个页签的共同点：条目上有可累加的时长字段（`readMinutes` / `listenMinutes` / `playtimeMinutes`）。
     * 影视三类没有时长字段 ⇒ ⛔ 不给它们这一档（选了也只会全 0 排序，等于假功能）。
     */
    it('m08754 ② 时长两档：只给带时长字段的页签（文学/网文/音乐/游戏）', () => {
        for (const t of ['book', 'music', 'game']) {
            const pool = sortOptionsFor(t, false);
            expect(pool.map((o) => o.value)).toContain('duration-desc');
            expect(pool.map((o) => o.value)).toContain('duration-asc');
            // 文案就是用户说的「统计时长」，上下用箭头区分（与其它档同款风格）
            expect(pool.find((o) => o.value === 'duration-desc')?.label).toBe('统计时长 ↓');
            expect(pool.find((o) => o.value === 'duration-asc')?.label).toBe('统计时长 ↑');
            // ⛔ 单系列视图之外不许看见「系列序号」两档
            expect(pool.some((o) => o.value.startsWith('series-'))).toBe(false);
        }
        // 影视 / 未知类型：不出现时长档
        for (const t of ['movie', 'tv', 'anime', 'comic', null, undefined]) {
            expect(sortOptionsFor(t, false).some((o) => o.value.startsWith('duration-'))).toBe(false);
        }
    });

    it('m08754 ② 时长档插在「系列序号」之前，且原有档位一个不少', () => {
        const base = sortOptionsFor('music', false);
        expect(base).toHaveLength(SORT_OPTIONS_BASE.length + 2);
        // 原有 10 档原序保留（插档不许打乱顺序）
        expect(base.filter((o) => !o.value.startsWith('duration-')).map((o) => o.value)).toEqual(
            SORT_OPTIONS_BASE.map((o) => o.value),
        );
        // 系列视图：全表 12 档 + 时长 2 档 = 14，且时长必须排在 series-* 之前
        const all = sortOptionsFor('music', true);
        expect(all).toHaveLength(SORT_OPTIONS.length + 2);
        const iDur = all.findIndex((o) => o.value === 'duration-desc');
        const iSeries = all.findIndex((o) => o.value.startsWith('series-'));
        expect(iSeries).toBeGreaterThan(-1);
        expect(iDur).toBeLessThan(iSeries);
    });
});
