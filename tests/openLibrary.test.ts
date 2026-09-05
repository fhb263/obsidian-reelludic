import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseOpenLibraryResults,
    toBookResult,
    parseOpenLibraryWorks,
    OpenLibraryClient,
    type RawOpenLibraryItem,
} from 'services/openLibrary';

// ⚠️ fixture 基于 openlibrary.org search.json 公开字段快照校准（沙箱网络不可达，真实返回待用户手测复校）
const fullSearchJson = JSON.stringify({
    start: 0,
    numFound: 400,
    docs: [
        {
            key: '/works/OL45883W',
            title: 'The Little Prince',
            author_name: ['Antoine de Saint-Exupéry', 'Richard Howard'],
            first_publish_year: 1943,
            publisher: ['Reynal & Hitchcock', 'Harcourt, Brace & World'],
            isbn: ['0156012197', '0156013983'],
            cover_i: 7440132,
            subject: ['Fairy tales', 'Princes', 'Asteroids', 'Friendship', 'Fantasy', 'Imagination'],
        },
    ],
});

/** 无作者/无封面/无题材/无出版社的裸条目（legacy 缺字段安全读取） */
const sparseSearchJson = JSON.stringify({
    docs: [
        {
            key: '/works/OL123W',
            title: 'Anonymous Tract',
            first_publish_year: 1901,
        },
        { title: '缺少 key 应被过滤' },
        { key: '/works/OL999W' }, // 缺少 title 应被过滤
    ],
});

/** 多 author 只取首 + subject 截断 3 的极端条目（独立 doc，避免与 full 纠缠） */
const multiAuthorJson = JSON.stringify({
    docs: [
        {
            key: '/works/OL777W',
            title: 'Collaboration',
            author_name: ['A. First', 'B. Second', 'C. Third'],
            first_publish_year: 2000,
            publisher: ['Pub X'],
            isbn: ['111'],
            cover_i: 1,
            subject: ['s1', 's2', 's3', 's4', 's5'],
        },
    ],
});

const worksJson = JSON.stringify({
    key: '/works/OL45883W',
    title: 'The Little Prince',
    description: { type: '/type/text', value: 'An aviator meets a little prince in the Sahara desert.' },
    number_of_pages: 96,
    publishers: ['Reynal & Hitchcock'],
});

describe('openLibrary URL 构造', () => {
    it('搜索 URL 含 q 编码 / limit=20 / fields 白名单', () => {
        const url = buildSearchUrl('The Little Prince');
        expect(url).toContain('https://openlibrary.org/search.json?q=');
        expect(url).toContain(encodeURIComponent('The Little Prince'));
        expect(url).toContain('limit=20');
        expect(url).toContain('fields=key,title,author_name,first_publish_year,publisher,isbn,cover_i,subject');
    });
});

describe('parseOpenLibraryResults', () => {
    it('解析 docs 数组为 RawOpenLibraryItem（保留原始数组字段）', () => {
        const items = parseOpenLibraryResults(fullSearchJson);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            key: '/works/OL45883W',
            title: 'The Little Prince',
            author_name: ['Antoine de Saint-Exupéry', 'Richard Howard'],
            first_publish_year: 1943,
            publisher: ['Reynal & Hitchcock', 'Harcourt, Brace & World'],
            isbn: ['0156012197', '0156013983'],
            cover_i: 7440132,
            subject: ['Fairy tales', 'Princes', 'Asteroids', 'Friendship', 'Fantasy', 'Imagination'],
        });
    });

    it('缺字段条目安全读取为 undefined（不因缺 author/cover/subject 崩）', () => {
        const items = parseOpenLibraryResults(sparseSearchJson);
        expect(items).toHaveLength(1); // 缺 key/title 的两条被过滤
        expect(items[0]).toEqual({
            key: '/works/OL123W',
            title: 'Anonymous Tract',
            first_publish_year: 1901,
            author_name: undefined,
            publisher: undefined,
            isbn: undefined,
            cover_i: undefined,
            subject: undefined,
        });
    });

    it('docs 缺失 / 空数组 → 空结果', () => {
        expect(parseOpenLibraryResults('{}')).toEqual([]);
        expect(parseOpenLibraryResults(JSON.stringify({ docs: [] }))).toEqual([]);
    });
});

describe('toBookResult 字段映射', () => {
    it('完整条目逐字段映射（id 存完整 key / author|publisher|isbn 取首 / subject 截 3 / thumbnail 拼图）', () => {
        const r = toBookResult(parseOpenLibraryResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: '/works/OL45883W',
            title: 'The Little Prince',
            author: 'Antoine de Saint-Exupéry', // 多作者取首
            publisher: 'Reynal & Hitchcock', // 取首
            isbn: '0156012197', // 取首
            year: 1943,
            thumbnail: 'https://covers.openlibrary.org/b/id/7440132-M.jpg',
            genres: ['Fairy tales', 'Princes', 'Asteroids'], // subject 截 3
            source: 'openLibrary',
            sourceUrl: 'https://openlibrary.org/works/OL45883W', // 与 id 同源拼接
        });
    });

    it('sourceUrl 与 id 的 key 路径一致（存完整 key → 直接拼 openlibrary.org）', () => {
        const item: RawOpenLibraryItem = { key: '/works/OL123W', title: 'X' };
        const r = toBookResult(item);
        expect(r.id).toBe('/works/OL123W');
        expect(r.sourceUrl).toBe('https://openlibrary.org/works/OL123W');
    });

    it('无 cover_i → thumbnail undefined；无 author/publisher/isbn → 对应字段 undefined', () => {
        const r = toBookResult(parseOpenLibraryResults(sparseSearchJson)[0]);
        expect(r.thumbnail).toBeUndefined();
        expect(r.author).toBeUndefined();
        expect(r.publisher).toBeUndefined();
        expect(r.isbn).toBeUndefined();
        expect(r.year).toBe(1901);
        expect(r.genres).toBeUndefined();
    });

    it('多作者取首、subject 截 3（独立用例）', () => {
        const r = toBookResult(parseOpenLibraryResults(multiAuthorJson)[0]);
        expect(r.author).toBe('A. First');
        expect(r.genres).toEqual(['s1', 's2', 's3']);
    });
});

describe('parseOpenLibraryWorks（点选补全 detail）', () => {
    it('works.json：description（/type/text 对象）/ number_of_pages / publishers 安全提取', () => {
        const d = parseOpenLibraryWorks(worksJson);
        expect(d).not.toBeNull();
        expect(d?.description).toBe('An aviator meets a little prince in the Sahara desert.');
        expect(d?.numberOfPages).toBe(96);
        expect(d?.publishers).toEqual(['Reynal & Hitchcock']);
    });

    it('description 为纯字符串也兼容', () => {
        const d = parseOpenLibraryWorks(JSON.stringify({ title: 'X', description: 'plain text' }));
        expect(d?.description).toBe('plain text');
    });

    it('字段缺失安全读取（works 级常无 number_of_pages/publishers）', () => {
        const d = parseOpenLibraryWorks(JSON.stringify({ key: '/works/OL1W', title: 'Y' }));
        expect(d).not.toBeNull();
        expect(d?.description).toBeUndefined();
        expect(d?.numberOfPages).toBeUndefined();
        expect(d?.publishers).toBeUndefined();
    });

    it('非 JSON / 非对象 → null', () => {
        expect(parseOpenLibraryWorks('not json')).toBeNull();
        expect(parseOpenLibraryWorks('[1,2]')).toBeNull();
    });
});

describe('OpenLibraryClient 注入 http', () => {
    it('search 用注入的 http 拉取并返回 toBookResult 结果', async () => {
        const calls: string[] = [];
        const client = new OpenLibraryClient(async (url) => {
            calls.push(url);
            return fullSearchJson;
        });
        const results = await client.search('the little prince');
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('openLibrary');
        expect(results[0].sourceUrl).toBe('https://openlibrary.org/works/OL45883W');
        expect(calls[0]).toContain(encodeURIComponent('the little prince'));
    });

    it('fetchWorkDetail 拉取 works.json（key 直接拼 .json），解析结果返回', async () => {
        const calls: string[] = [];
        const client = new OpenLibraryClient(async (url) => {
            calls.push(url);
            return worksJson;
        });
        const d = await client.fetchWorkDetail('/works/OL45883W');
        expect(calls[0]).toBe('https://openlibrary.org/works/OL45883W.json');
        expect(d.numberOfPages).toBe(96);
    });
});
