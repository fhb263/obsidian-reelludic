import { describe, expect, it } from 'vitest';
import {
    GROUP_COVER_MAX,
    GROUP_DIM_OPTIONS,
    buildGroupCards,
    decadeBucket,
    entriesInBucket,
    groupCardSub,
    groupDimLabel,
    groupDimOptionsFor,
    groupEntriesBy,
    normalizeGroupDim,
    normalizeGroupDimFor,
} from 'pure/listGrouping';
import type { MediaEntry } from 'data/types';

/** 造一条最小可用的条目（本文件只关心分组维度用到的字段） */
function entry(over: Partial<MediaEntry> & { title: string }): MediaEntry {
    return {
        id: `id-${over.title}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'movie',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        ...over,
    } as MediaEntry;
}

describe('normalizeGroupDim / groupDimLabel', () => {
    it('白名单内原样返回', () => {
        for (const o of GROUP_DIM_OPTIONS) expect(normalizeGroupDim(o.value)).toBe(o.value);
    });
    it('认不出的值一律回不分组（⛔ 不猜）', () => {
        expect(normalizeGroupDim('series')).toBe('none');
        expect(normalizeGroupDim('')).toBe('none');
        expect(normalizeGroupDim(null)).toBe('none');
        expect(normalizeGroupDim(42)).toBe('none');
    });
    it('五个维度都有中文名，且互不相同', () => {
        const labels = GROUP_DIM_OPTIONS.map((o) => groupDimLabel(o.value));
        expect(new Set(labels).size).toBe(labels.length);
    });
});

describe('groupDimOptionsFor / normalizeGroupDimFor — 单类型页签砍掉「按类型」', () => {
    it('没有锁定类型（计划页 / 全部）⇒ 五档全给', () => {
        const vals = groupDimOptionsFor(null).map((o) => o.value);
        expect(vals).toEqual(['none', 'type', 'decade', 'status', 'genre']);
        expect(groupDimOptionsFor(undefined).length).toBe(5);
        expect(groupDimOptionsFor('').length).toBe(5);
    });
    it('锁定类型（电影页签）⇒ 不给「按类型」，其余四档按原顺序保留', () => {
        const vals = groupDimOptionsFor('movie').map((o) => o.value);
        expect(vals).toEqual(['none', 'decade', 'status', 'genre']);
        expect(vals).not.toContain('type');
    });
    it('⛔ 「不分组」永远在（那是「不分」，不是某个维度）', () => {
        for (const lock of [null, 'movie', 'book', 'music']) {
            expect(groupDimOptionsFor(lock).map((o) => o.value)).toContain('none');
        }
    });
    it('normalizeGroupDimFor：锁类型时把「按类型」退回不分组', () => {
        expect(normalizeGroupDimFor('type', 'movie')).toBe('none');
        expect(normalizeGroupDimFor('type', null)).toBe('type');
        expect(normalizeGroupDimFor('decade', 'movie')).toBe('decade');
        expect(normalizeGroupDimFor('genre', 'book')).toBe('genre');
    });
    it('normalizeGroupDimFor：脏值照旧回不分组', () => {
        expect(normalizeGroupDimFor('series', 'movie')).toBe('none');
        expect(normalizeGroupDimFor(null, null)).toBe('none');
        expect(normalizeGroupDimFor(42, 'book')).toBe('none');
    });
    it('⛔ 选项表本身不许被就地改写（必须是纯函数返回新数组）', () => {
        const before = GROUP_DIM_OPTIONS.length;
        groupDimOptionsFor('movie');
        expect(GROUP_DIM_OPTIONS.length).toBe(before);
        expect(GROUP_DIM_OPTIONS.map((o) => o.value)).toContain('type');
    });
});

describe('decadeBucket', () => {
    it('按十年取整，不是「近 N 年」浮动区间', () => {
        expect(decadeBucket(1994)).toEqual({ key: 'decade:1990', label: '1990–1999' });
        expect(decadeBucket(2026)).toEqual({ key: 'decade:2020', label: '2020–2029' });
        expect(decadeBucket(2000)).toEqual({ key: 'decade:2000', label: '2000–2009' });
    });
    it('无年份单独归桶，⛔ 不塞进更早', () => {
        expect(decadeBucket(undefined).key).toBe('decade:none');
        expect(decadeBucket(null).label).toBe('无年份');
        expect(decadeBucket(NaN).key).toBe('decade:none');
        expect(decadeBucket(0).key).toBe('decade:none');
        expect(decadeBucket(-5).key).toBe('decade:none');
    });
});

describe('groupEntriesBy — 各维度分桶', () => {
    it("'none' 不分桶（回空数组，视图据此走平铺）", () => {
        expect(groupEntriesBy([entry({ title: 'A' })], 'none')).toEqual([]);
    });

    it('空输入回空数组', () => {
        expect(groupEntriesBy([], 'type')).toEqual([]);
    });

    it('按类型：标题走 ENTRY_TYPE_LABELS，桶按条目数降序', () => {
        const list = [
            entry({ title: 'A', type: 'movie' }),
            entry({ title: 'B', type: 'movie' }),
            entry({ title: 'C', type: 'book' }),
        ];
        const out = groupEntriesBy(list, 'type');
        expect(out.map((b) => b.label)).toEqual(['电影', '书籍']);
        expect(out[0].items.map((e) => e.title)).toEqual(['A', 'B']);
    });

    it('按年代：时间正序，「无年份」恒在最后', () => {
        const list = [
            entry({ title: 'A', year: 2020 }),
            entry({ title: 'B', year: undefined }),
            entry({ title: 'C', year: 1994 }),
        ];
        const out = groupEntriesBy(list, 'decade');
        expect(out.map((b) => b.label)).toEqual(['1990–1999', '2020–2029', '无年份']);
    });

    it('按状态：固定序（在看 → 想看 → 看过 → 归档），⛔ 不按数量重排', () => {
        const list = [
            entry({ title: 'A', status: 'archived' }),
            entry({ title: 'B', status: 'archived' }),
            entry({ title: 'C', status: 'archived' }),
            entry({ title: 'D', status: 'watching' }),
        ];
        expect(groupEntriesBy(list, 'status').map((b) => b.label)).toEqual(['在看', '归档']);
    });

    it('按题材：一条属多个题材时**会在多个桶里出现**（这是应有语义）', () => {
        const list = [
            entry({ title: 'A', genres: ['喜剧', '剧情'] }),
            entry({ title: 'B', genres: ['喜剧'] }),
        ];
        const out = groupEntriesBy(list, 'genre');
        // 喜剧 2 条成组；剧情 只有 1 条 ⇒ 不成组
        expect(out.map((b) => b.label)).toEqual(['喜剧']);
        expect(out[0].items.map((e) => e.title)).toEqual(['A', 'B']);
    });

    it('按题材：只有 1 条的题材不成组（与系列「≥2 才折」同一心思）', () => {
        const list = [
            entry({ title: 'A', genres: ['独角戏'] }),
            entry({ title: 'B', genres: ['喜剧'] }),
            entry({ title: 'C', genres: ['喜剧'] }),
        ];
        expect(groupEntriesBy(list, 'genre').map((b) => b.label)).toEqual(['喜剧']);
    });

    it('按题材：同一条里重复的题材只算一次', () => {
        const list = [
            entry({ title: 'A', genres: ['喜剧', '喜剧'] }),
            entry({ title: 'B', genres: ['喜剧'] }),
        ];
        const out = groupEntriesBy(list, 'genre');
        expect(out[0].items.map((e) => e.title)).toEqual(['A', 'B']);
    });

    it('桶内保持传入顺序 —— ⛔ 不在分桶里再排一遍（否则把用户的排序顶掉）', () => {
        const list = [
            entry({ title: 'Z', type: 'movie' }),
            entry({ title: 'A', type: 'movie' }),
            entry({ title: 'M', type: 'movie' }),
        ];
        expect(groupEntriesBy(list, 'type')[0].items.map((e) => e.title)).toEqual(['Z', 'A', 'M']);
    });

    it('结果恒定：同数量的桶按名比较，不抖动', () => {
        const list = [
            entry({ title: 'A', genres: ['乙乙'] }),
            entry({ title: 'B', genres: ['甲甲'] }),
        ];
        const a = groupEntriesBy(list, 'genre').map((b) => b.label);
        const b = groupEntriesBy([...list].reverse(), 'genre').map((x) => x.label);
        expect(a).toEqual(b);
    });
});

describe('buildGroupCards — 组卡汇总', () => {
    it('count / yearSpan / covers 取组内前 N 条（⛔ 不按评分挑）', () => {
        const list = [
            entry({ title: 'A', type: 'movie', year: 1994 }),
            entry({ title: 'B', type: 'movie', year: 2026 }),
            entry({ title: 'C', type: 'movie', year: 2001 }),
            entry({ title: 'D', type: 'movie', year: 2010 }),
        ];
        const card = buildGroupCards(groupEntriesBy(list, 'type'))[0];
        expect(card.count).toBe(4);
        expect(card.yearSpan).toBe('1994–2026');
        expect(card.covers.map((e) => e.title)).toEqual(['A', 'B', 'C']);
        expect(card.covers.length).toBe(GROUP_COVER_MAX);
    });

    it('seriesCount 只数「≥2 部的系列」—— 单部系列不算', () => {
        const list = [
            entry({ title: 'A', type: 'movie', series: '熊出没' }),
            entry({ title: 'B', type: 'movie', series: '熊出没' }),
            entry({ title: 'C', type: 'movie', series: '孤儿片' }),
        ];
        const card = buildGroupCards(groupEntriesBy(list, 'type'))[0];
        expect(card.seriesCount).toBe(1);
    });

    it('同名系列跨类型各归各组（与 seriesKeyOf 同口径）', () => {
        const list = [
            entry({ title: 'A1', type: 'movie', series: '熊出没' }),
            entry({ title: 'A2', type: 'movie', series: '熊出没' }),
            entry({ title: 'B1', type: 'anime', series: '熊出没' }),
            entry({ title: 'B2', type: 'anime', series: '熊出没' }),
        ];
        const cards = buildGroupCards(groupEntriesBy(list, 'type'));
        for (const c of cards) expect(c.seriesCount).toBe(1);
        expect(cards.map((c) => c.count)).toEqual([2, 2]);
    });
});

describe('entriesInBucket — 进组后的成员口径', () => {
    it('与 groupEntriesBy 的桶成员逐条一致（组卡写几部，点进去就是几部）', () => {
        const list = [
            entry({ title: 'A', type: 'movie', year: 1994, genres: ['喜剧'] }),
            entry({ title: 'B', type: 'movie', year: 2020, genres: ['喜剧', '剧情'] }),
            entry({ title: 'C', type: 'book', year: undefined, genres: ['剧情'] }),
            entry({ title: 'D', status: 'watched', type: 'movie', year: 1994 }),
        ];
        for (const dim of ['type', 'decade', 'status', 'genre'] as const) {
            for (const b of groupEntriesBy(list, dim)) {
                const again = entriesInBucket(list, dim, b.key);
                expect(again.map((e) => e.title)).toEqual(b.items.map((e) => e.title));
            }
        }
    });

    it("'none' 维度回空数组（不分组的视图别拿它当筛选）", () => {
        expect(entriesInBucket([entry({ title: 'A' })], 'none', 'type:movie')).toEqual([]);
    });

    it('键对不上就是空（⛔ 不回落成「全都要」）', () => {
        const list = [entry({ title: 'A', type: 'movie' })];
        expect(entriesInBucket(list, 'type', 'type:book')).toEqual([]);
        expect(entriesInBucket(list, 'type', '')).toEqual([]);
    });

    it('题材桶：一条属多个题材时，两个桶都能取到它', () => {
        const list = [
            entry({ title: 'A', genres: ['喜剧', '剧情'] }),
            entry({ title: 'B', genres: ['喜剧'] }),
            entry({ title: 'C', genres: ['剧情'] }),
        ];
        expect(entriesInBucket(list, 'genre', 'genre:喜剧').map((e) => e.title)).toEqual(['A', 'B']);
        expect(entriesInBucket(list, 'genre', 'genre:剧情').map((e) => e.title)).toEqual(['A', 'C']);
    });
});

describe('groupCardSub — 组卡第二行小字', () => {
    it('有年份有系列：两段用 · 连接', () => {
        expect(
            groupCardSub({
                key: 'type:movie',
                label: '电影',
                count: 3,
                yearSpan: '1990–2026',
                seriesCount: 2,
                covers: [],
                status: undefined,
                readPercent: undefined,
            }),
        ).toBe('1990–2026 · 2 个系列');
    });

    it('空的部分自动不出现，⛔ 不输出孤零零的分隔符', () => {
        expect(
            groupCardSub({
                key: 'type:movie',
                label: '电影',
                count: 1,
                yearSpan: '',
                seriesCount: 0,
                covers: [],
                status: undefined,
                readPercent: undefined,
            }),
        ).toBe('');
    });
});
