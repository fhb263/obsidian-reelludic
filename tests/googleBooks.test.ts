import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseGoogleBooksResults,
    toBookResult,
    GoogleBooksClient,
    type RawGoogleBooksItem,
} from 'services/googleBooks';

// ⚠️ fixture 基于 googleapis.com/books/v1/volumes 公开字段快照校准（沙箱网络不可达，真实返回待用户手测复校）
const fullSearchJson = JSON.stringify({
    kind: 'books#volumes',
    totalItems: 1,
    items: [
        {
            kind: 'books#volume',
            id: 'ZY3mAAAAQBAJ',
            volumeInfo: {
                title: 'The Little Prince',
                authors: ['Antoine de Saint-Exupéry', 'Richard Howard'],
                publisher: 'Houghton Mifflin Harcourt',
                publishedDate: '2000-05-15',
                description: 'An aviator crashes in the Sahara desert and meets a little prince.',
                pageCount: 96,
                categories: ['Juvenile Fiction', 'Fantasy', 'Friendship', 'Imagination', 'Asteroids'],
                imageLinks: {
                    smallThumbnail: 'http://books.google.com/books/content?id=ZY3mAAAAQBAJ&printsec=frontcover&img=1&zoom=5',
                    // thumbnail 含 &zoom= 参数：googleBooks 封面规则「原样保留」（T2/S2）
                    thumbnail: 'http://books.google.com/books/content?id=ZY3mAAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl',
                },
                industryIdentifiers: [
                    { type: 'ISBN_10', identifier: '0156012197' },
                    { type: 'ISBN_13', identifier: '9780156012195' },
                ],
                infoLink: 'https://books.google.com/books?id=ZY3mAAAAQBAJ&dq=little+prince',
            },
        },
    ],
});

/** 缺字段异常条目合集：无 imageLinks / publishedDate 仅年 / 缺 ISBN_13（仅 ISBN_10 或空）/ categories 空 / title 缺失滤除 */
const sparseSearchJson = JSON.stringify({
    items: [
        // ① 无 imageLinks + publishedDate 仅年 + 无 industryIdentifiers
        { id: 'ED1', volumeInfo: { title: 'OnlyYearBook', publishedDate: '1943' } },
        // ② industryIdentifiers 缺 ISBN_13（有 ISBN_10）+ categories 空数组
        { id: 'ED2', volumeInfo: { title: 'Isbn10AndEmptyCategories', industryIdentifiers: [{ type: 'ISBN_10', identifier: '0156012197' }], categories: [] } },
        // ③ industryIdentifiers 空数组（isbn 应为 undefined）
        { id: 'ED3', volumeInfo: { title: 'EmptyIdentifiers', industryIdentifiers: [] } },
        // ④ 缺 title（volumeInfo 空对象）→ 应被滤除
        { id: 'ED4', volumeInfo: {} },
        // ⑤ 缺 id → 应被滤除（sourceUrl 无法构造，与 openLibrary key 缺省同语义）
        { volumeInfo: { title: 'NoIdShouldFilter' } },
    ],
});

describe('googleBooks URL 构造', () => {
    it('搜索 URL 含 q 编码 / maxResults=20；未配 key 不带 key 参数', () => {
        const url = buildSearchUrl('The Little Prince');
        expect(url).toContain('https://www.googleapis.com/books/v1/volumes?q=');
        expect(url).toContain(encodeURIComponent('The Little Prince'));
        expect(url).toContain('maxResults=20');
        expect(url).not.toContain('&key=');
    });

    it('配 key 时拼 &key=（未配即不带 key 请求）', () => {
        const url = buildSearchUrl('the little prince', 'AIzaFakeKey123');
        expect(url).toContain('maxResults=20&key=AIzaFakeKey123');
        expect(buildSearchUrl('x', '')).not.toContain('&key=');
    });
});

describe('parseGoogleBooksResults', () => {
    it('items → RawGoogleBooksItem（publishedDate 取前 4 位年 / categories 截 3 / 优先 ISBN_13 / thumbnail 原样）', () => {
        const items = parseGoogleBooksResults(fullSearchJson);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            id: 'ZY3mAAAAQBAJ',
            title: 'The Little Prince',
            authors: ['Antoine de Saint-Exupéry', 'Richard Howard'],
            publisher: 'Houghton Mifflin Harcourt',
            year: 2000,
            pageCount: 96,
            categories: ['Juvenile Fiction', 'Fantasy', 'Friendship'], // 截 3
            description: 'An aviator crashes in the Sahara desert and meets a little prince.',
            thumbnail: 'http://books.google.com/books/content?id=ZY3mAAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl', // 原样含 &zoom=
            isbn: '9780156012195', // industryIdentifiers 中 ISBN_13 优先（虽排在 ISBN_10 之后）
            infoLink: 'https://books.google.com/books?id=ZY3mAAAAQBAJ&dq=little+prince',
        });
    });

    it('无 imageLinks → thumbnail undefined；publishedDate 仅年 → year 取整；缺字段安全读取', () => {
        const items = parseGoogleBooksResults(sparseSearchJson);
        expect(items).toHaveLength(3); // ED4（缺 title）/ ED5（缺 id）被滤除
        const [onlyYear, isbn10, emptyIds] = items;
        expect(onlyYear).toEqual({
            id: 'ED1', title: 'OnlyYearBook', year: 1943, // publishedDate '1943' → 4 位年
            authors: undefined, publisher: undefined, pageCount: undefined, categories: undefined,
            description: undefined, thumbnail: undefined, isbn: undefined, infoLink: undefined,
        });
        expect(isbn10.isbn).toBe('0156012197'); // 缺 ISBN_13 → 回退 ISBN_10
        expect(isbn10.categories).toBeUndefined(); // categories 空数组 → undefined
        expect(emptyIds.isbn).toBeUndefined(); // industryIdentifiers 空数组 → undefined
    });

    it('items 缺失 / 空数组 / 无 volumeInfo → 空结果', () => {
        expect(parseGoogleBooksResults('{}')).toEqual([]);
        expect(parseGoogleBooksResults(JSON.stringify({ items: [] }))).toEqual([]);
        expect(parseGoogleBooksResults(JSON.stringify({ items: [{ id: 'X' }] }))).toEqual([]);
    });
});

describe('toBookResult 字段映射', () => {
    it('完整条目逐字段映射（source=googleBooks / sourceUrl=books?id= / thumbnail 原样）', () => {
        const r = toBookResult(parseGoogleBooksResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: 'ZY3mAAAAQBAJ',
            title: 'The Little Prince',
            author: 'Antoine de Saint-Exupéry', // 多作者取首
            publisher: 'Houghton Mifflin Harcourt',
            isbn: '9780156012195',
            year: 2000,
            pageCount: 96,
            description: 'An aviator crashes in the Sahara desert and meets a little prince.',
            thumbnail: 'http://books.google.com/books/content?id=ZY3mAAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl',
            genres: ['Juvenile Fiction', 'Fantasy', 'Friendship'],
            source: 'googleBooks',
            sourceUrl: 'https://books.google.com/books?id=ZY3mAAAAQBAJ',
        });
    });

    it('无 imageLinks → thumbnail undefined；无 genres → undefined；缺字段安全读取（不崩）', () => {
        const r = toBookResult(parseGoogleBooksResults(sparseSearchJson)[0]); // ED1：无封面/无 isbn/无 categories
        expect(r.thumbnail).toBeUndefined();
        expect(r.genres).toBeUndefined();
        expect(r.isbn).toBeUndefined();
        expect(r.author).toBeUndefined();
        expect(r.publisher).toBeUndefined();
        expect(r.year).toBe(1943);
        expect(r.source).toBe('googleBooks');
        expect(r.sourceUrl).toBe('https://books.google.com/books?id=ED1');
    });

    it('sourceUrl 与 id 拼接一致（id 缺失则 undefined）', () => {
        const a: RawGoogleBooksItem = { id: 'abc123', title: 'X' };
        expect(toBookResult(a).sourceUrl).toBe('https://books.google.com/books?id=abc123');
        const b: RawGoogleBooksItem = { title: 'NoId' };
        expect(toBookResult(b).sourceUrl).toBeUndefined();
        expect(toBookResult(b).id).toBe('');
    });
});

describe('GoogleBooksClient 注入 http', () => {
    it('search 用注入 http 拉取（key getter 每次现读）并返回 toBookResult 结果', async () => {
        const calls: string[] = [];
        const client = new GoogleBooksClient(
            async (url) => {
                calls.push(url);
                return fullSearchJson;
            },
            () => 'AIzaKeyAbc',
        );
        const results = await client.search('the little prince');
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('googleBooks');
        expect(results[0].sourceUrl).toBe('https://books.google.com/books?id=ZY3mAAAAQBAJ');
        expect(calls[0]).toContain(encodeURIComponent('the little prince'));
        expect(calls[0]).toContain('&key=AIzaKeyAbc'); // 配 key → 拼 key
    });

    it('key getter 返回空 → 请求不带 key（未配即不带 key 请求）', async () => {
        const calls: string[] = [];
        const client = new GoogleBooksClient(
            async (url) => {
                calls.push(url);
                return JSON.stringify({ items: [{ id: 'K1', volumeInfo: { title: 'Keyless' } }] });
            },
            () => '',
        );
        const results = await client.search('keyless book');
        expect(results).toHaveLength(1);
        expect(calls[0]).not.toContain('&key=');
    });
});
