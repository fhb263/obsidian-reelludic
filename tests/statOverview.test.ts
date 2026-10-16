import { describe, it, expect } from 'vitest';
import {
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    CATEGORY_KEYS,
    categoryOf,
    categoryOverview,
    monthOverMonth,
    trendMaxOf,
    trendSeriesOf,
    visibleTrendSeries,
    yearOverYear,
    type OverviewCategory,
} from 'pure/statOverview';
import { TYPE_COLORS, type MediaEntry } from 'data/types';

function e(partial: Partial<MediaEntry> & Pick<MediaEntry, 'id' | 'type' | 'title'>): MediaEntry {
    return {
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    };
}

const Y = 2026;

describe('pure/statOverview 分类归属（书 / 影 / 游 / 音）', () => {
    it('影视三类合一，其余一对一', () => {
        expect(categoryOf(e({ id: 'a', type: 'book', title: 'x' }))).toBe('book');
        expect(categoryOf(e({ id: 'b', type: 'movie', title: 'x' }))).toBe('media');
        expect(categoryOf(e({ id: 'c', type: 'tv', title: 'x' }))).toBe('media');
        expect(categoryOf(e({ id: 'd', type: 'anime', title: 'x' }))).toBe('media');
        expect(categoryOf(e({ id: 'f', type: 'game', title: 'x' }))).toBe('game');
        expect(categoryOf(e({ id: 'g', type: 'music', title: 'x' }))).toBe('music');
    });

    it('未知类型返回 null（不猜、不落到某一类）', () => {
        expect(categoryOf(e({ id: 'h', type: 'nope' as never, title: 'x' }))).toBeNull();
    });

    it('分类色取**类型色真源**，⛔ 不新造色（影视 = movie 蓝）', () => {
        expect(CATEGORY_COLORS.book).toBe(TYPE_COLORS.book);
        expect(CATEGORY_COLORS.media).toBe(TYPE_COLORS.movie);
        expect(CATEGORY_COLORS.game).toBe(TYPE_COLORS.game);
        expect(CATEGORY_COLORS.music).toBe(TYPE_COLORS.music);
    });

    it('分类键顺序固定 = 书影游音，标签齐备', () => {
        expect(CATEGORY_KEYS).toEqual(['book', 'media', 'game', 'music']);
        for (const k of CATEGORY_KEYS) expect(CATEGORY_LABELS[k].length).toBeGreaterThan(0);
    });
});

describe('pure/statOverview 同比 / 环比', () => {
    it('年度同比：今年 4 / 去年 2 → +2 且可显示基线', () => {
        const data = [
            e({ id: 'a', type: 'book', title: 'x', watchedDate: '2026-01-05' }),
            e({ id: 'b', type: 'book', title: 'x', watchedDate: '2026-02-05' }),
            e({ id: 'c', type: 'movie', title: 'x', watchedDate: '2026-03-05' }),
            e({ id: 'd', type: 'game', title: 'x', watchedDate: '2026-04-05' }),
            e({ id: 'e', type: 'book', title: 'x', watchedDate: '2025-06-05' }),
            e({ id: 'f', type: 'music', title: 'x', watchedDate: '2025-07-05' }),
        ];
        const r = yearOverYear(data, Y);
        expect(r).toEqual({ current: 4, previous: 2, delta: 2, hasBaseline: true });
    });

    it('年度同比：去年 0 → 不画箭头（hasBaseline=false，避免 +N 误导）', () => {
        const r = yearOverYear([e({ id: 'a', type: 'book', title: 'x', watchedDate: '2026-01-05' })], Y);
        expect(r).toEqual({ current: 1, previous: 0, delta: 1, hasBaseline: false });
    });

    it('年度同比：今年 0 / 去年 3 → -3 且基线为真（负增长要说出来）', () => {
        const data = [
            e({ id: 'a', type: 'book', title: 'x', watchedDate: '2025-01-05' }),
            e({ id: 'b', type: 'book', title: 'x', watchedDate: '2025-02-05' }),
            e({ id: 'c', type: 'book', title: 'x', watchedDate: '2025-03-05' }),
        ];
        expect(yearOverYear(data, Y)).toEqual({ current: 0, previous: 3, delta: -3, hasBaseline: true });
    });

    it('月度环比：本月 3 / 上月 2 → +1', () => {
        const data = [
            e({ id: 'a', type: 'book', title: 'x', watchedDate: '2026-09-01' }),
            e({ id: 'b', type: 'book', title: 'x', watchedDate: '2026-09-02' }),
            e({ id: 'c', type: 'movie', title: 'x', watchedDate: '2026-09-03' }),
            e({ id: 'd', type: 'book', title: 'x', watchedDate: '2026-08-01' }),
            e({ id: 'e', type: 'book', title: 'x', watchedDate: '2026-08-02' }),
        ];
        expect(monthOverMonth(data, Y, 9)).toEqual({ current: 3, previous: 2, delta: 1, hasBaseline: true });
    });

    it('月度环比：1 月的上月 = 去年 12 月（跨年不断档）', () => {
        const data = [
            e({ id: 'a', type: 'book', title: 'x', watchedDate: '2026-01-01' }),
            e({ id: 'b', type: 'book', title: 'x', watchedDate: '2025-12-01' }),
            e({ id: 'c', type: 'book', title: 'x', watchedDate: '2025-12-02' }),
        ];
        expect(monthOverMonth(data, Y, 1)).toEqual({ current: 1, previous: 2, delta: -1, hasBaseline: true });
    });

    it('空库：同比/环比都返回 0 且不抛（新用户首屏）', () => {
        expect(yearOverYear([], Y)).toEqual({ current: 0, previous: 0, delta: 0, hasBaseline: false });
        expect(monthOverMonth([], Y, 3)).toEqual({ current: 0, previous: 0, delta: 0, hasBaseline: false });
    });
});

describe('pure/statOverview 趋势序列', () => {
    const data = [
        e({ id: 'a', type: 'book', title: 'x', watchedDate: '2026-01-05' }),
        e({ id: 'b', type: 'book', title: 'x', watchedDate: '2026-01-06' }),
        e({ id: 'c', type: 'movie', title: 'x', watchedDate: '2026-02-05' }),
        e({ id: 'd', type: 'tv', title: 'x', watchedDate: '2026-02-06' }),
    ];

    it('四条序列（书/影/游/音），影视 = movie+tv+anime 合并', () => {
        const s = trendSeriesOf(data, Y);
        expect(s.map((x) => x.key)).toEqual(['book', 'media', 'game', 'music']);
        expect(s[0].arr[0]).toBe(2); // 书籍 1 月 2 本
        expect(s[1].arr[1]).toBe(2); // 影视 2 月 2 部（movie + tv）
    });

    it('`on` = 该序列本年是否有数据（0 值序列不进图例）', () => {
        const s = trendSeriesOf(data, Y);
        expect(s.map((x) => x.on)).toEqual([true, true, false, false]);
    });

    it('极值只按**可见**序列算（多选筛选后 Y 轴跟着变）', () => {
        const s = trendSeriesOf(data, Y);
        expect(trendMaxOf(s, [])).toBe(2); // 空选 = 全部
        expect(trendMaxOf(s, ['media'])).toBe(2);
        expect(trendMaxOf(s, ['music'])).toBe(1); // 无可见数据 → 兜底 1，不除零
    });

    it('空选 = 这一维不存在（全部显示）；未选中的不出现', () => {
        const s = trendSeriesOf(data, Y);
        expect(visibleTrendSeries(s, []).map((x) => x.key)).toEqual(['book', 'media']);
        expect(visibleTrendSeries(s, ['book']).map((x) => x.key)).toEqual(['book']);
        expect(visibleTrendSeries(s, ['book', 'media']).map((x) => x.key)).toEqual(['book', 'media']);
    });
});

describe('pure/statOverview 分类概览（Tab 内容）', () => {
    const data = [
        e({ id: 'b1', type: 'book', title: '甲', status: 'watched', rating: 5, watchedDate: '2026-01-05', pageCount: 300 }),
        e({ id: 'b2', type: 'book', title: '乙', status: 'watching', rating: 4, pageCount: 120 }),
        e({ id: 'm1', type: 'movie', title: '丙', status: 'watched', rating: 4, watchedDate: '2026-02-05', durationMin: 120 }),
        e({ id: 'm2', type: 'tv', title: '丁', status: 'watching' }),
        e({ id: 'm3', type: 'anime', title: '戊', status: 'want' }),
        e({ id: 'g1', type: 'game', title: '己', status: 'watched', rating: 3, watchedDate: '2026-03-05', playtimeMinutes: 600, playSessions: [{ date: '2026-03-01', minutes: 600 }] }),
        e({ id: 's1', type: 'music', title: '庚', status: 'watched', rating: 5, watchedDate: '2026-04-05', durationMin: 4 }),
    ];
    const counts = { b1: 3 };

    it('书籍：读完 / 在读 / 已读页 / 摘抄', () => {
        const o = categoryOverview(data, Y, counts, 'book');
        expect(o.label).toBe('书籍');
        expect(o.metrics.map((m) => m.label)).toEqual(['读完', '在读', '已读页', '摘抄']);
        expect(o.metrics.map((m) => m.value)).toEqual([1, 1, 420, 3]);
    });

    it('影视：子类型计数行（电影 / 剧集 / 动画）', () => {
        const o = categoryOverview(data, Y, counts, 'media');
        expect(o.subText).toBe('电影 1 · 剧集 1 · 动画 1');
        expect(o.metrics.map((m) => m.label)).toEqual(['看完', '在追', '观影', '追剧集']);
    });

    it('游戏 / 音乐的指标口径（时长类带 kind=hours 交给视图格式化）', () => {
        const g = categoryOverview(data, Y, counts, 'game');
        expect(g.metrics.map((m) => m.label)).toEqual(['通关', '玩过', '游玩', '记录']);
        expect(g.metrics.find((m) => m.label === '游玩')).toMatchObject({ value: 600, kind: 'hours' });
        const s = categoryOverview(data, Y, counts, 'music');
        expect(s.metrics.map((m) => m.label)).toEqual(['已听', '在听', '曲目', '时长']);
    });

    it('Top3 = 本年看完且已评分，按分降序', () => {
        const o = categoryOverview(data, Y, counts, 'book');
        expect(o.top.map((x) => x.id)).toEqual(['b1']);
        const s = categoryOverview(data, Y, counts, 'music');
        expect(s.top.map((x) => x.id)).toEqual(['s1']);
    });

    it('空态标记：hasAny（该分类有条目）/ hasFinished（本年有完成）', () => {
        expect(categoryOverview(data, Y, counts, 'book')).toMatchObject({ hasAny: true, hasFinished: true });
        const empty = categoryOverview([], Y, {}, 'game');
        expect(empty).toMatchObject({ hasAny: false, hasFinished: false });
        expect(empty.metrics.every((m) => m.value === 0)).toBe(true);
    });

    it('脏输入容错：excerptCounts 缺失 / 未知分类键不抛', () => {
        expect(() => categoryOverview(data, Y, undefined as never, 'book')).not.toThrow();
        expect(() => categoryOverview(data, Y, counts, 'nope' as OverviewCategory)).not.toThrow();
    });
});
