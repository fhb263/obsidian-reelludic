// 搜索累积池（⑬）纯逻辑单测。
//
// 用户原话（m00002）：「给搜索添加条目返回的如上限20条可再搜索突破，可存储持久化上次搜索已有的」。
//
// 这批判据的要害：
//   ① **合并顺序**：新的在前 —— 用户刚搜的那批必须排在最上面，否则「突破了 20 条」这件事看不见；
//   ② **去重保留新的**：重搜同一个词时源可能补了评分/封面，留旧的等于把新数据丢掉；
//   ③ **桶键隔离**：文学/网文/漫画 是三条不同的链，串了就是「漫画态翻出文学结果」的数据污染；
//   ④ **读盘自愈**：盘上那份被手改/被旧版本写坏，不能让「添加条目」打不开。
import { describe, it, expect } from 'vitest';
import {
    SEARCH_POOL_FILE_NAME,
    SEARCH_POOL_KEEP,
    SEARCH_POOL_VERSION,
    bucketOf,
    mergeSearchResults,
    normalizeBucket,
    normalizePool,
    parseSearchPool,
    searchBucketKey,
    serializeSearchPool,
    withBucket,
} from 'pure/searchAccum';
import type { SearchPool } from 'pure/searchAccum';
import type { SearchResult } from 'pure/searchDisplay';

/** 最小候选：只关心 `id` / `title`（`resultKeyOf` 就靠这两个） */
const cand = (id: number | string, title: string, extra: Record<string, unknown> = {}) =>
    ({ id, title, ...extra }) as unknown as SearchResult;

const titles = (list: SearchResult[]) => list.map((r) => r.title);

describe('searchBucketKey —— 分桶口径', () => {
    it('书籍带子分类（三条链不能串）', () => {
        expect(searchBucketKey('book', 'literature')).toBe('book:literature');
        expect(searchBucketKey('book', 'web')).toBe('book:web');
        expect(searchBucketKey('book', 'comic')).toBe('book:comic');
        expect(searchBucketKey('book', 'literature')).not.toBe(searchBucketKey('book', 'comic'));
    });

    it('书籍没给子分类 ⇒ 空段（不炸，也不与具体子分类混桶）', () => {
        expect(searchBucketKey('book')).toBe('book:');
        expect(searchBucketKey('book', undefined)).toBe('book:');
    });

    it('非书籍类型忽略 bookKind（那个字段只在书籍态有意义）', () => {
        expect(searchBucketKey('movie', 'comic')).toBe('movie');
        expect(searchBucketKey('game', 'literature')).toBe('game');
    });
});

describe('mergeSearchResults —— 累积 + 去重（⑬ 的核心）', () => {
    it('新的在前：刚搜的排最上面', () => {
        const prev = [cand(1, '旧一'), cand(2, '旧二')];
        const fresh = [cand(3, '新一')];
        expect(titles(mergeSearchResults(prev, fresh))).toEqual(['新一', '旧一', '旧二']);
    });

    it('跨多次搜索累积 —— 这正是「突破 20 条上限」的落点', () => {
        let pool: SearchResult[] = [];
        for (let i = 1; i <= 25; i++) {
            pool = mergeSearchResults(pool, [cand(i, `第${i}条`)]);
        }
        expect(pool).toHaveLength(25);
        expect(pool[0].title).toBe('第25条');
        expect(pool[24].title).toBe('第1条');
    });

    it('同一条（同 id 同 title）去重，且保留**新**的那份', () => {
        const prev = [cand(7, '同名', { rating: 6 })];
        const fresh = [cand(7, '同名', { rating: 9 })];
        const out = mergeSearchResults(prev, fresh);
        expect(out).toHaveLength(1);
        expect((out[0] as unknown as { rating: number }).rating).toBe(9);
    });

    it('同 id 不同 title 视为不同条目（番剧改名 / 同名不同剧不会互相吃掉）', () => {
        const out = mergeSearchResults([cand(1, '甲')], [cand(1, '乙')]);
        expect(out).toHaveLength(2);
    });

    it('超出 keep ⇒ 截断**最旧**的尾部（上限是硬约束，防落盘文件无限长）', () => {
        const prev = [cand(1, 'A'), cand(2, 'B'), cand(3, 'C')];
        const fresh = [cand(4, 'D')];
        expect(titles(mergeSearchResults(prev, fresh, 2))).toEqual(['D', 'A']);
    });

    it('keep = 0 ⇒ 空（边界不炸）', () => {
        expect(mergeSearchResults([cand(1, 'A')], [cand(2, 'B')], 0)).toEqual([]);
    });

    it('空入参三种组合都不炸', () => {
        expect(mergeSearchResults([], [])).toEqual([]);
        expect(titles(mergeSearchResults([], [cand(1, 'A')]))).toEqual(['A']);
        expect(titles(mergeSearchResults([cand(1, 'A')], []))).toEqual(['A']);
    });

    it('不修改入参（纯函数）', () => {
        const prev = [cand(1, 'A')];
        const fresh = [cand(2, 'B')];
        mergeSearchResults(prev, fresh);
        expect(prev).toHaveLength(1);
        expect(fresh).toHaveLength(1);
    });

    it('脏项（null / 非对象）直接跳过，不占位置', () => {
        const dirty = [null, undefined, 42, cand(1, 'A')] as unknown as SearchResult[];
        expect(titles(mergeSearchResults([], dirty))).toEqual(['A']);
    });
});

describe('withBucket / bucketOf —— 桶的读写', () => {
    it('空列表 ⇒ 该桶删除（不留空壳占文件体积）', () => {
        const pool = withBucket({ movie: [cand(1, 'A')] }, 'movie', []);
        expect('movie' in pool).toBe(false);
    });

    it('写入不动其它桶（纯函数，返回新对象）', () => {
        const pool: SearchPool = { movie: [cand(1, 'A')] };
        const next = withBucket(pool, 'game', [cand(2, 'B')]);
        expect(Object.keys(next).sort()).toEqual(['game', 'movie']);
        expect(pool.game).toBeUndefined();
    });

    it('bucketOf 未知桶 ⇒ 空数组（调用方不必判空）', () => {
        expect(bucketOf({}, 'movie')).toEqual([]);
        expect(bucketOf({ movie: 'no' as unknown as SearchResult[] }, 'movie')).toEqual([]);
    });
});

describe('normalizeBucket / normalizePool —— 读盘自愈', () => {
    it('丢掉没有 title 的脏项（否则渲染成空卡片）', () => {
        const raw = [{ title: '好的' }, {}, { title: '' }, { id: 1 }, null, 'x'];
        expect(titles(normalizeBucket(raw))).toEqual(['好的']);
    });

    it('保序去重、截断到 keep', () => {
        const raw = [cand(1, 'A'), cand(1, 'A'), cand(2, 'B'), cand(3, 'C')];
        expect(titles(normalizeBucket(raw, 2))).toEqual(['A', 'B']);
    });

    it('非数组 ⇒ 空（user 手改成字符串也不炸）', () => {
        expect(normalizeBucket('nope')).toEqual([]);
        expect(normalizeBucket({})).toEqual([]);
    });

    it('normalizePool 丢掉空桶、非对象输入 ⇒ 空池', () => {
        expect(normalizePool({ movie: [cand(1, 'A')], game: [] })).toEqual({ movie: [cand(1, 'A')] });
        expect(normalizePool(null)).toEqual({});
        expect(normalizePool([])).toEqual({});
        expect(normalizePool('x')).toEqual({});
    });
});

describe('parseSearchPool / serializeSearchPool —— 落盘格式', () => {
    it('坏 JSON ⇒ 空池（不抛：一份缓存坏了不该让「添加条目」打不开）', () => {
        expect(parseSearchPool('{ 这不是 json')).toEqual({});
        expect(parseSearchPool('')).toEqual({});
        expect(parseSearchPool('null')).toEqual({});
    });

    it('兼容裸桶对象（手写文件时容易不带 version 包裹）', () => {
        const raw = JSON.stringify({ movie: [cand(1, 'A')] });
        expect(titles(parseSearchPool(raw).movie)).toEqual(['A']);
    });

    it('标准包裹形态能读回', () => {
        const raw = JSON.stringify({ version: 1, buckets: { movie: [cand(1, 'A')] } });
        expect(titles(parseSearchPool(raw).movie)).toEqual(['A']);
    });

    it('序列化往返一致，且带 version', () => {
        const pool = { movie: [cand(1, 'A'), cand(2, 'B')], 'book:web': [cand(3, 'C')] };
        const text = serializeSearchPool(pool);
        const parsed = JSON.parse(text) as { version: number; buckets: Record<string, SearchResult[]> };
        expect(parsed.version).toBe(SEARCH_POOL_VERSION);
        expect(titles(parsed.buckets.movie)).toEqual(['A', 'B']);
        expect(titles(parseSearchPool(text)['book:web'])).toEqual(['C']);
    });

    it('序列化前顺手归一：脏项不会落盘、空桶不落盘', () => {
        const text = serializeSearchPool({
            movie: [cand(1, 'A'), { title: '' } as unknown as SearchResult],
            game: [],
        });
        const parsed = JSON.parse(text) as { buckets: Record<string, SearchResult[]> };
        expect(Object.keys(parsed.buckets)).toEqual(['movie']);
        expect(parsed.buckets.movie).toHaveLength(1);
    });

    it('落盘上限就是 SEARCH_POOL_KEEP（序列化即截断）', () => {
        const many = Array.from({ length: SEARCH_POOL_KEEP + 30 }, (_, i) => cand(i, `第${i}条`));
        const parsed = JSON.parse(serializeSearchPool({ movie: many })) as { buckets: Record<string, SearchResult[]> };
        expect(parsed.buckets.movie).toHaveLength(SEARCH_POOL_KEEP);
    });
});

describe('常量口径', () => {
    it('文件名是英文小写单词（与 catalog.json / trash.json 同口径）', () => {
        expect(SEARCH_POOL_FILE_NAME).toBe('search-pool.json');
    });

    it('上限是正数且不夸张（落盘数据，文件大小可控）', () => {
        expect(SEARCH_POOL_KEEP).toBeGreaterThan(0);
        expect(SEARCH_POOL_KEEP).toBeLessThanOrEqual(500);
    });
});
