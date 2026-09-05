// 关键词 + 类型 + 状态过滤 + 排序 纯逻辑单测
import { describe, it, expect } from 'vitest';
import { matchesSearch, matchesType, matchesStatus, filterAndSort } from 'pure/search';
import type { MediaEntry } from 'data/types';

function e(partial: Partial<MediaEntry>): MediaEntry {
    return {
        id: partial.id ?? 'x',
        type: partial.type ?? 'movie',
        title: partial.title ?? '',
        originalTitle: partial.originalTitle,
        status: partial.status ?? 'want',
        rating: partial.rating ?? 0,
        year: partial.year,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        progress: undefined,
        createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
        updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
        ...partial,
    } as MediaEntry;
}

describe('matchesSearch 关键词命中', () => {
    it('空搜索词全部命中', () => {
        expect(matchesSearch(e({ title: '沙丘' }), '')).toBe(true);
        expect(matchesSearch(e({ title: '沙丘' }), '   ')).toBe(true);
    });

    it('标题小写包含匹配', () => {
        expect(matchesSearch(e({ title: '沙丘：第二部' }), '沙丘')).toBe(true);
        expect(matchesSearch(e({ title: 'Dune' }), 'dune')).toBe(true);
        expect(matchesSearch(e({ title: '沙丘' }), 'dune')).toBe(false);
    });

    it('原名兜底匹配', () => {
        expect(matchesSearch(e({ title: '千与千寻', originalTitle: 'Spirited Away' }), 'spirited')).toBe(true);
    });

    it('原名为空字符串不报错', () => {
        expect(matchesSearch(e({ title: '海王' }), '海')).toBe(true);
    });
});

describe('matchesSearch 按类型扩展字段（作者/开发商）', () => {
    it('书籍按作者命中', () => {
        expect(matchesSearch(e({ type: 'book', title: '置身事内', author: '兰小欢' }), '兰小欢')).toBe(true);
        expect(matchesSearch(e({ type: 'book', title: '置身事内', author: '兰小欢' }), '置身')).toBe(true);
    });

    it('游戏按开发商命中', () => {
        expect(matchesSearch(e({ type: 'game', title: '部落冲突', developer: 'Supercell' }), 'supercell')).toBe(true);
        expect(matchesSearch(e({ type: 'game', title: '部落冲突', developer: 'Supercell' }), 'super')).toBe(true);
    });

    it('作者/开发商搜索大小写不敏感', () => {
        expect(matchesSearch(e({ type: 'book', title: '1984', author: 'George Orwell' }), 'george')).toBe(true);
        expect(matchesSearch(e({ type: 'game', title: '半条命', developer: 'Valve' }), 'VALVE')).toBe(true);
        expect(matchesSearch(e({ type: 'music', title: 'Stairway to Heaven', author: 'Led Zeppelin' }), 'zeppelin')).toBe(true);
    });

    it('author/developer 为空不报错且不命中', () => {
        expect(matchesSearch(e({ type: 'book', title: '三体' }), '刘慈欣')).toBe(false);
        expect(matchesSearch(e({ type: 'game', title: '塞尔达' }), '任天堂')).toBe(false);
        expect(matchesSearch(e({ type: 'music', title: '夜曲' }), '周杰伦')).toBe(false);
    });

    it('音乐按作者（歌手）命中', () => {
        expect(matchesSearch(e({ type: 'music', title: '七里香', author: '周杰伦' }), '周杰伦')).toBe(true);
        expect(matchesSearch(e({ type: 'music', title: '七里香', author: '周杰伦' }), '七里')).toBe(true);
    });

    it('影视不按作者/开发商匹配，音乐不按开发商匹配', () => {
        expect(matchesSearch(e({ type: 'movie', title: '沙丘', author: 'Frank Herbert' }), 'frank')).toBe(false);
        expect(matchesSearch(e({ type: 'movie', title: '沙丘', developer: 'Legendary' }), 'legendary')).toBe(false);
        expect(matchesSearch(e({ type: 'music', title: '七里香', developer: '杰威尔' }), '杰威尔')).toBe(false);
    });
});

describe('matchesType / matchesStatus', () => {
    it('type all 通配', () => {
        expect(matchesType(e({ type: 'movie' }), 'all')).toBe(true);
    });
    it('type 精确匹配', () => {
        expect(matchesType(e({ type: 'book' }), 'book')).toBe(true);
        expect(matchesType(e({ type: 'book' }), 'game')).toBe(false);
    });
    it('status all 通配', () => {
        expect(matchesStatus(e({ status: 'watching' }), 'all')).toBe(true);
    });
    it('status 精确匹配', () => {
        expect(matchesStatus(e({ status: 'want' }), 'want')).toBe(true);
        expect(matchesStatus(e({ status: 'want' }), 'watching')).toBe(false);
    });
});

describe('filterAndSort 综合筛选 + 排序', () => {
    const data: MediaEntry[] = [
        e({ id: 'a', title: 'Dune',        originalTitle: 'Dune',          type: 'movie', status: 'watched', rating: 4, year: 2021, updatedAt: '2026-08-25T00:00:00.000Z' }),
        e({ id: 'b', title: '沙丘：第二部', originalTitle: 'Dune: Part Two', type: 'movie', status: 'want',    rating: 0, year: 2024, updatedAt: '2026-08-20T00:00:00.000Z' }),
        e({ id: 'c', title: '葬送的芙莉莲', type: 'anime', status: 'watching', rating: 5, year: 2023, updatedAt: '2026-08-26T00:00:00.000Z' }),
        e({ id: 'd', title: '三体',          type: 'book',   status: 'want',     rating: 4, year: 2008, updatedAt: '2026-08-15T00:00:00.000Z' }),
        e({ id: 'e', title: '流浪地球',      type: 'movie',  status: 'watched',  rating: 3, year: 2019, updatedAt: '2026-08-10T00:00:00.000Z' }),
    ];

    it('空搜索 + 全状态 + 全类型 → recent 排序', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'recent' });
        expect(out.map((x) => x.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
    });

    it('recent-asc 排序（最久未更新在前，与 recent 反向）', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'recent-asc' });
        expect(out.map((x) => x.id)).toEqual(['e', 'd', 'b', 'a', 'c']);
    });

    it('搜索 Dune 命中标题+原名', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: 'dune', sortBy: 'recent' });
        expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
    });

    it('搜索 沙丘 命中中文标题', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: '沙丘', sortBy: 'recent' });
        expect(out.map((x) => x.id)).toEqual(['b']);
    });

    it('搜索 + 类型联合筛', () => {
        const out = filterAndSort(data, { status: 'all', type: 'book', query: '三', sortBy: 'recent' });
        expect(out.map((x) => x.id)).toEqual(['d']);
    });

    it('title-asc 排序（A-Z，zh locale）', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'title-asc' });
        const titles = out.map((x) => x.title);
        expect(titles).toHaveLength(5);
        // 同一比较器对全部条目返回确定性顺序：复制再排，结果应完全一致
        const copy = [...data].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
        expect(titles).toEqual(copy.map((x) => x.title));
    });

    it('title-desc 排序（Z-A，与 A-Z 完全反序）', () => {
        const asc = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'title-asc' }).map((x) => x.id);
        const desc = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'title-desc' }).map((x) => x.id);
        expect(desc).toEqual([...asc].reverse());
    });

    it('myrating-asc 排序（个人评分 1★→5★，未评 0 排最前）', () => {
        const out = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'myrating-asc' });
        expect(out[0].id).toBe('b'); // 0
        expect(out[out.length - 1].id).toBe('c'); // 5
    });

    it('release-desc / release-asc 排序（发布日期 新→旧 / 旧→新）', () => {
        const desc = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'release-desc' });
        expect(desc[0].id).toBe('b'); // 2024
        expect(desc[desc.length - 1].id).toBe('d'); // 2008
        const asc = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'release-asc' });
        expect(asc[0].id).toBe('d'); // 2008
        expect(asc[asc.length - 1].id).toBe('b'); // 2024
    });

    it('score-desc / score-asc 排序（大众评分 高→低 / 低→高，无评分视作 0）', () => {
        const scored = data.map((d, i) => ({ ...d, communityScore: (i % 3) + 1 }));
        const desc = filterAndSort(scored, { status: 'all', type: 'all', query: '', sortBy: 'score-desc' });
        for (let i = 1; i < desc.length; i++) {
            expect((desc[i - 1].communityScore ?? 0)).toBeGreaterThanOrEqual(desc[i].communityScore ?? 0);
        }
        const asc = filterAndSort(scored, { status: 'all', type: 'all', query: '', sortBy: 'score-asc' });
        for (let i = 1; i < asc.length; i++) {
            expect((asc[i - 1].communityScore ?? 0)).toBeLessThanOrEqual(asc[i].communityScore ?? 0);
        }
        // 无大众评分的排最前（asc）/最末（desc）
        const noScore = filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'score-asc' });
        expect(noScore[0].communityScore ?? 0).toBe(0);
    });

    it('status-asc / status-desc 排序（想看→在看→已看→存档；倒序反之）', () => {
        const statusData: MediaEntry[] = [
            e({ id: 'a', title: 'A', status: 'watched' }),
            e({ id: 'b', title: 'B', status: 'want' }),
            e({ id: 'c', title: 'C', status: 'archived' }),
            e({ id: 'd', title: 'D', status: 'watching' }),
        ];
        const asc = filterAndSort(statusData, { status: 'all', type: 'all', query: '', sortBy: 'status-asc' });
        expect(asc.map((x) => x.id)).toEqual(['b', 'd', 'a', 'c']); // want→watching→watched→archived
        const desc = filterAndSort(statusData, { status: 'all', type: 'all', query: '', sortBy: 'status-desc' });
        expect(desc.map((x) => x.id)).toEqual(['c', 'a', 'd', 'b']);
    });

    it('原数组不被改动（slice 副本）', () => {
        const before = data.map((d) => d.id);
        filterAndSort(data, { status: 'all', type: 'all', query: '', sortBy: 'title-asc' });
        expect(data.map((d) => d.id)).toEqual(before);
    });
});
