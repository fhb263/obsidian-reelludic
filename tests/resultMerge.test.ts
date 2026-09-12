import { describe, it, expect } from 'vitest';
import { mergeTmdbDetail } from '../src/pure/resultMerge';
import type { TmdbSearchResult, TmdbDetail } from '../src/services/tmdb';

const base: TmdbSearchResult = {
    id: 123,
    title: '未来',
    originalTitle: 'Mirai',
    year: 2018,
    mediaType: 'movie',
    posterPath: '/abc.jpg',
    rating: 7.2,
};

const detail: TmdbDetail = {
    title: '未来',
    originalTitle: 'Mirai',
    year: 2018,
    genres: ['动画', '奇幻'],
    director: '细田守',
    cast: ['上白石萌歌', '黑木华'],
    overview: '…',
    rating: 7.2,
    ratingCount: 54321,
};

describe('mergeTmdbDetail 详情预取合并', () => {
    it('缺失字段回填：搜索级无 ratingCount/director/genres → 详情补上', () => {
        const m = mergeTmdbDetail(base, detail);
        expect(m.ratingCount).toBe(54321);
        expect(m.director).toBe('细田守');
        expect(m.genres).toEqual(['动画', '奇幻']);
        expect(m.cast).toEqual(['上白石萌歌', '黑木华']);
        expect(m.year).toBe(2018);
    });

    it('非空优先：搜索级已有 year/rating 时详情同值不覆盖、搜索级 7.2 保留', () => {
        const m = mergeTmdbDetail(base, { ...detail, year: 2018, rating: 7.2 });
        expect(m.year).toBe(2018);
        expect(m.rating).toBe(7.2);
    });

    it('详情缺字段不覆盖已有值：详情 year undefined 保留搜索级 year', () => {
        const m = mergeTmdbDetail(base, { ...detail, year: undefined, rating: undefined });
        expect(m.year).toBe(2018);
        expect(m.rating).toBe(7.2);
    });

    it('纯函数：不修改原对象', () => {
        const copy = { ...base };
        const m = mergeTmdbDetail(base, detail);
        expect(m).not.toBe(base);
        expect(base).toEqual(copy);
        expect(m.id).toBe(123);
        expect(m.title).toBe('未来');
    });
});
