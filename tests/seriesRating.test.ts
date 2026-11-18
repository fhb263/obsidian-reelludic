/**
 * `pure/seriesRating` 单测 —— 评分看板的「合集分」（用户 2026-10-27 裁定）。
 *
 * 🔴 这里钉的是**口径**：
 *   · 合集分是**独立字段**，⛔ 不是组内平均（真实数据里组内分歧极大，平均会被未评分稀释）；
 *   · 0 = 未评分 ⇒ **删键**，不留 `": 0"` 垃圾；
 *   · 合集卡在板上**只出一格**，组内成员不再各自出格（这正是「太多了」的解药）；
 *   · 行序/配色复用 `ratingBoard.boardRows()` 单一真源，⛔ 不另起档位表。
 */
import { describe, expect, it } from 'vitest';
import type { MediaEntry } from '../src/data/types';
import {
    buildSeriesBoard,
    normalizeSeriesRatings,
    readSeriesRating,
    seriesBoardItems,
    seriesMeanOf,
    seriesRatedRatio,
    seriesUnratedRatio,
    writeSeriesRating,
} from '../src/pure/seriesRating';
import { seriesKeyOf } from '../src/pure/seriesGroup';

/** 造一条最小可用条目（只填分组/评分相关字段） */
function mk(id: string, series: string | undefined, rating: number, extra: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id,
        type: 'movie',
        title: id,
        status: 'done',
        rating: rating as MediaEntry['rating'],
        genres: [],
        cast: [],
        series,
        ...extra,
    } as MediaEntry;
}

describe('readSeriesRating / writeSeriesRating（读写口径）', () => {
    it('没打过 ⇒ 0（与单条 `rating` 的 0 = 未评分语义一致）', () => {
        expect(readSeriesRating(undefined, 'k')).toBe(0);
        expect(readSeriesRating({}, 'k')).toBe(0);
        expect(readSeriesRating({ other: 4 }, 'k')).toBe(0);
    });

    it('读到的脏值走 `normalizeRating` 归一（⛔ 不是原样透传）', () => {
        expect(readSeriesRating({ k: 99 as unknown as 5 }, 'k')).toBe(5);
        expect(readSeriesRating({ k: 2.3 as unknown as 2.5 }, 'k')).toBe(2.5);
        expect(readSeriesRating({ k: 'x' as unknown as 3 }, 'k')).toBe(0);
    });

    it('写：不改入参（纯函数纪律），返回新表', () => {
        const before = { a: 3 as const };
        const after = writeSeriesRating(before, 'b', 4);
        expect(after).toEqual({ a: 3, b: 4 });
        expect(before).toEqual({ a: 3 });
    });

    it('🔴 写 0 ⇒ **删键**（⛔ 不留 `": 0"` 噪音键）', () => {
        const after = writeSeriesRating({ a: 3, b: 4 }, 'a', 0);
        expect(after).toEqual({ b: 4 });
        expect('a' in after).toBe(false);
    });

    it('写越界值钳到 0~5 且四舍五入到半档', () => {
        expect(writeSeriesRating(undefined, 'k', 9)).toEqual({ k: 5 });
        expect(writeSeriesRating(undefined, 'k', -2)).toEqual({});
        expect(writeSeriesRating(undefined, 'k', 3.24)).toEqual({ k: 3 });
        expect(writeSeriesRating(undefined, 'k', 3.26)).toEqual({ k: 3.5 });
    });
});

describe('normalizeSeriesRatings（脏数据归一，parseCatalog 用）', () => {
    it('非对象 / 数组 / null ⇒ 空表（⛔ 不抛错）', () => {
        expect(normalizeSeriesRatings(undefined)).toEqual({});
        expect(normalizeSeriesRatings(null)).toEqual({});
        expect(normalizeSeriesRatings('x')).toEqual({});
        expect(normalizeSeriesRatings([1, 2])).toEqual({});
    });

    it('🔴 值为 0 / 脏值 / 无法归一的项**整体丢弃**（与写侧「0 不存」同口径）', () => {
        expect(normalizeSeriesRatings({ a: 4, b: 0, c: 'x', d: null, e: 2.5 })).toEqual({ a: 4, e: 2.5 });
    });

    it('空键丢弃', () => {
        expect(normalizeSeriesRatings({ '': 4, a: 3 })).toEqual({ a: 3 });
    });
});

describe('seriesMeanOf（组内已评分条目的平均，展示用）', () => {
    it('🔴 未评分**不参与分母**（否则 9 部 5 分 + 9 部未评分 = 2.5，读起来像「这个系列很烂」）', () => {
        const items = [mk('a', 's', 5), mk('b', 's', 5), mk('c', 's', 0), mk('d', 's', 0)];
        expect(seriesMeanOf(items)).toBe(5);
    });

    it('🔴 全都没打分 ⇒ **null**（⛔ 不是 0 —— 0 会被读成「全打了 0 分」）', () => {
        expect(seriesMeanOf([mk('a', 's', 0), mk('b', 's', 0)])).toBeNull();
        expect(seriesMeanOf([])).toBeNull();
    });

    it('保留一位小数（展示「组内均 4.2」）', () => {
        expect(seriesMeanOf([mk('a', 's', 4), mk('b', 's', 5), mk('c', 's', 3), mk('d', 's', 5), mk('e', 's', 4)])).toBe(4.2);
    });
});

describe('seriesRatedRatio（「3/18 部已评」）', () => {
    it('返回 `[已评分数, 总数]`', () => {
        const items = [mk('a', 's', 5), mk('b', 's', 0), mk('c', 's', 4)];
        expect(seriesRatedRatio(items)).toEqual([2, 3]);
    });

    it('空组 ⇒ `[0, 0]`（视图据此显示「0/0」而不是 NaN）', () => {
        expect(seriesRatedRatio([])).toEqual([0, 0]);
    });
});

describe('seriesBoardItems（折叠：合集只出一格）', () => {
    it('🔴 组内 ≥2 条 ⇒ 只剩一张合集卡，成员各自**不再出格**', () => {
        const entries = [mk('a', '熊出没', 5), mk('b', '熊出没', 4), mk('c', undefined, 3)];
        const items = seriesBoardItems(entries, undefined);
        expect(items).toHaveLength(2);
        expect(items.filter((x) => x.kind === 'series')).toHaveLength(1);
        expect(items.filter((x) => x.kind === 'single')).toHaveLength(1);
    });

    it('🔴 只有 1 条的组**不折**（折起来反而多一次点击，且看不出是系列）', () => {
        const items = seriesBoardItems([mk('a', '独苗', 4)], undefined);
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe('single');
    });

    it('🔴 合集卡的 `rating` 读**独立字段**，⛔ 不是组内平均', () => {
        // 组内平均 = (5+5+0+0)/4 = 2.5（若按「参与分母」算是 5），但合集分是用户自己打的 1
        const entries = [mk('a', '周星驰', 5), mk('b', '周星驰', 5), mk('c', '周星驰', 0), mk('d', '周星驰', 0)];
        const key = seriesKeyOf(entries[0]) as string;
        const items = seriesBoardItems(entries, { [key]: 1 });
        const coll = items.find((x) => x.kind === 'series');
        expect(coll?.rating).toBe(1);
    });

    it('合集没打分 ⇒ 落 0（= 未评分行）', () => {
        const items = seriesBoardItems([mk('a', 'S', 5), mk('b', 'S', 4)], undefined);
        expect(items[0].rating).toBe(0);
    });

    it('同名不同类**不合并**（分组键含 type，用户 2026-09-30 裁定不做跨类型）', () => {
        const movies = [mk('a', '熊出没', 5), mk('b', '熊出没', 4)];
        const anime = [
            mk('c', '熊出没', 3, { type: 'anime' }),
            mk('d', '熊出没', 3, { type: 'anime' }),
        ];
        const items = seriesBoardItems([...movies, ...anime], undefined);
        expect(items.filter((x) => x.kind === 'series')).toHaveLength(2);
    });

    it('key 稳定：散卡 = 条目 id、合集 = 分组键（⛔ 不用「组内首条 id」，删首条分就丢）', () => {
        const entries = [mk('a', 'S', 5), mk('b', 'S', 4)];
        const items = seriesBoardItems(entries, undefined);
        const coll = items.find((x) => x.kind === 'series');
        expect(coll?.key).toBe(seriesKeyOf(entries[0]));
        expect(coll?.key).not.toBe('a');
    });
});

describe('buildSeriesBoard（投影成 11 行）', () => {
    it('🔴 行序复用 `boardRows()` 单一真源：11 行、未评分在最低行', () => {
        const rows = buildSeriesBoard([], undefined);
        expect(rows).toHaveLength(11);
        expect(rows[0].rating).toBe(5);
        expect(rows[rows.length - 1].unrated).toBe(true);
        expect(rows[rows.length - 1].rating).toBe(0);
    });

    it('格子总数守恒：散卡数 + 合集组数 == 落进板里的格子数（⛔ 不许凭空消失）', () => {
        const entries = [
            mk('a', 'S1', 5), mk('b', 'S1', 4),   // 1 组合集
            mk('c', undefined, 3),                 // 1 张散卡
            mk('d', 'S2', 0), mk('e', 'S2', 0),   // 1 组合集（未评分）
        ];
        const rows = buildSeriesBoard(entries, undefined);
        const total = rows.reduce((n, r) => n + r.items.length, 0);
        expect(total).toBe(3);
    });

    it('合集分决定它落哪一行', () => {
        const entries = [mk('a', 'S', 5), mk('b', 'S', 4)];
        const key = seriesKeyOf(entries[0]) as string;
        const rows = buildSeriesBoard(entries, { [key]: 3 });
        const row = rows.find((r) => r.rating === 3);
        expect(row?.items).toHaveLength(1);
        expect(row?.items[0].kind).toBe('series');
    });

    it('同分按标题 `localeCompare zh` 稳定排序', () => {
        const entries = [mk('乙', undefined, 4), mk('甲', undefined, 4)];
        const rows = buildSeriesBoard(entries, undefined);
        const row = rows.find((r) => r.rating === 4);
        expect(row?.items.map((x) => x.title)).toEqual(['甲', '乙']);
    });

    it('页签过滤生效（只留该页签的格子）', () => {
        const entries = [mk('a', 'S', 5), mk('b', 'S', 4), mk('g', undefined, 5, { type: 'game' })];
        expect(seriesBoardItems(entries, undefined, 'movie')).toHaveLength(1);
        expect(seriesBoardItems(entries, undefined, 'game')).toHaveLength(1);
        expect(seriesBoardItems(entries, undefined, 'all')).toHaveLength(2);
    });
});

describe('seriesUnratedRatio（页签计数条）', () => {
    it('按**格子**计数（合集算 1 格，不是算 N 条）', () => {
        const entries = [
            mk('a', 'S1', 5), mk('b', 'S1', 4),  // 合集 1 格，已打合集分 ⇒ 不算未评分
            mk('c', undefined, 0),                // 散卡 1 格，未评分
        ];
        const key = seriesKeyOf(entries[0]) as string;
        expect(seriesUnratedRatio(entries, { [key]: 4 })).toEqual([1, 2]);
    });

    it('空库 ⇒ `[0, 0]`', () => {
        expect(seriesUnratedRatio([], undefined)).toEqual([0, 0]);
    });
});

/**
 * 🔴 2026-11-14（用户 m02498）：「也给评分看板加个系列卡堆叠和单卡平铺的循环切换图标按钮
 * 同首页的按钮放在评分看板导航栏上」。
 *
 * 这里钉的是**平铺态（`unfold === true`）的投影口径**：
 *   · 同系列**不再折成合集卡** —— 每条各出一张 `kind:'single'` 卡；
 *   · 顺序 = 传入流（⛔ 不按标题/序号重排，那会与用户在看板上看到的视图顺序不一致）；
 *   · **合集分表一个字不动** —— 平铺态只是「看不见」，切回堆叠态立刻恢复（清掉就是不可逆丢数据）；
 *   · 「未评分 N / M」的**分母跟着格数走**（这也是 `seriesUnratedRatio` 必须吃同一个布尔的理由）。
 */
describe('seriesBoardItems / buildSeriesBoard 的 unfold（全部单卡平铺）', () => {
    it('🔴 平铺态：同系列不再折成一张合集卡，每条各占一格', () => {
        const entries = [mk('a', 'S1', 5), mk('b', 'S1', 4), mk('c', undefined, 3)];
        // 堆叠态：S1 折成 1 张合集卡 + c 一张散卡 = 2 格
        expect(seriesBoardItems(entries, undefined)).toHaveLength(2);
        // 平铺态：3 条各一格
        const flat = seriesBoardItems(entries, undefined, 'all', true);
        expect(flat).toHaveLength(3);
        expect(flat.every((x) => x.kind === 'single')).toBe(true);
        expect(flat.map((x) => x.key)).toEqual(['a', 'b', 'c']);
    });

    it('🔴 平铺态：顺序沿用传入流，⛔ 不按序号/标题重排组内成员', () => {
        // 传入顺序刻意与系列序号相反
        const entries = [
            mk('second', 'S1', 4, { seriesIndex: 2 }),
            mk('first', 'S1', 5, { seriesIndex: 1 }),
        ];
        const flat = seriesBoardItems(entries, undefined, 'all', true);
        expect(flat.map((x) => x.key)).toEqual(['second', 'first']);
    });

    it('🔴 平铺态：合集分表不被改写（只是看不见，切回来还在）', () => {
        const entries = [mk('a', 'S1', 5), mk('b', 'S1', 4)];
        const key = seriesKeyOf(entries[0]) as string;
        const map = { [key]: 4 };
        const snapshot = JSON.stringify(map);
        seriesBoardItems(entries, map, 'all', true);
        expect(JSON.stringify(map)).toBe(snapshot);
        // 切回堆叠态，合集分原样读得出来
        const stacked = seriesBoardItems(entries, map);
        expect(stacked).toHaveLength(1);
        expect(stacked[0].kind).toBe('series');
        expect(stacked[0].rating).toBe(4);
    });

    it('平铺态：页签过滤照旧生效', () => {
        const entries = [mk('a', 'S1', 5), mk('g', undefined, 4, { type: 'game' })];
        expect(seriesBoardItems(entries, undefined, 'movie', true)).toHaveLength(1);
        expect(seriesBoardItems(entries, undefined, 'game', true)).toHaveLength(1);
        expect(seriesBoardItems(entries, undefined, 'all', true)).toHaveLength(2);
    });

    it('buildSeriesBoard：平铺态把所有条目按各自评分分行（不再有 series 行）', () => {
        const entries = [mk('a', 'S1', 5), mk('b', 'S1', 4), mk('c', undefined, 3)];
        const key = seriesKeyOf(entries[0]) as string;
        const rows = buildSeriesBoard(entries, { [key]: 2 }, 'all', true);
        const total = rows.reduce((n, r) => n + r.items.length, 0);
        expect(total).toBe(3);
        expect(rows.every((r) => r.items.every((x) => x.kind === 'single'))).toBe(true);
        // 合集分 2 在没有合集卡的情况下不该凭空多出格子
        expect(rows.find((r) => r.rating === 2)?.items).toHaveLength(0);
    });

    it('🔴 seriesUnratedRatio：分母跟着 unfold 变（堆叠 2 格 → 平铺 3 格）', () => {
        const entries = [
            mk('a', 'S1', 5), mk('b', 'S1', 4), // 堆叠时合成 1 格且已打合集分 ⇒ 不算未评分
            mk('c', undefined, 0),              // 散卡 1 格，未评分
        ];
        const key = seriesKeyOf(entries[0]) as string;
        expect(seriesUnratedRatio(entries, { [key]: 4 })).toEqual([1, 2]);
        // 平铺：a(5) b(4) c(0) ⇒ 只有 c 未评分，分母 3
        expect(seriesUnratedRatio(entries, { [key]: 4 }, 'all', true)).toEqual([1, 3]);
    });
});
