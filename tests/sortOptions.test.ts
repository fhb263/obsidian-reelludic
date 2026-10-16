// 排序选项表（pure/sortOptions）—— 守「表只有一份」与「系列序号两档只属于单系列视图」。
import { describe, expect, it } from 'vitest';
import { SORT_OPTIONS, SORT_OPTIONS_BASE, normalizeSortBy } from 'pure/sortOptions';

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
});
