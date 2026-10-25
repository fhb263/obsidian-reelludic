import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseSearchResults,
    parseDetail,
    posterUrl,
    TmdbClient,
} from 'services/tmdb';

const movieSearchJson = JSON.stringify({
    results: [
        { id: 1, title: '沙丘', original_title: 'Dune', release_date: '2021-09-03', poster_path: '/x.jpg', overview: 'desc' },
        { id: 2, title: '沙丘2', original_title: 'Dune: Part Two', release_date: '2024-02-28', poster_path: null },
        { id: 3, name: '剧集不该进来', original_name: 'TV', first_air_date: '2023-01-01' },
    ],
});

const tvSearchJson = JSON.stringify({
    results: [
        { id: 10, name: '葬送的芙莉莲', original_name: 'Frieren', first_air_date: '2023-09-29', poster_path: '/y.jpg' },
    ],
});

const detailMovieJson = JSON.stringify({
    id: 1,
    title: '沙丘',
    original_title: 'Dune',
    release_date: '2021-09-03',
    genres: [{ name: '科幻' }, { name: '冒险' }],
    overview: '厄拉科斯。',
});

const creditsMovieJson = JSON.stringify({
    crew: [{ name: '丹尼斯·维伦纽瓦', job: 'Director' }, { name: '某剪辑', job: 'Editor' }],
    cast: [{ name: '提莫西·查拉梅' }, { name: '赞达亚' }, { name: '斯特兰' }],
});

describe('tmdb URL 构造', () => {
    it('搜索 URL 含 api_key/query/language，query 编码', () => {
        const url = buildSearchUrl('KEY', '沙 丘', 'movie', 'zh-CN');
        expect(url).toContain('api_key=KEY');
        expect(url).toContain('language=zh-CN');
        expect(url).toContain(encodeURIComponent('沙 丘'));
        expect(url).toContain('/search/movie');
    });

    it('剧集搜索走 /search/tv', () => {
        expect(buildSearchUrl('K', 'x', 'tv', 'zh-CN')).toContain('/search/tv');
    });
});

describe('tmdb 响应解析', () => {
    it('电影结果映射：title/year/poster 字段', () => {
        const results = parseSearchResults(movieSearchJson, 'movie');
        expect(results).toHaveLength(2); // 第 3 条 name 字段被过滤
        expect(results[0].title).toBe('沙丘');
        expect(results[0].year).toBe(2021);
        expect(results[0].posterPath).toBe('/x.jpg');
        expect(results[1].posterPath).toBeUndefined();
    });

    it('剧集结果用 name 字段', () => {
        const results = parseSearchResults(tvSearchJson, 'tv');
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('葬送的芙莉莲');
        expect(results[0].year).toBe(2023);
        expect(results[0].mediaType).toBe('tv');
    });

    it('详情解析提取导演/主演/类型', () => {
        const d = parseDetail(detailMovieJson, creditsMovieJson, 'movie');
        expect(d.title).toBe('沙丘');
        expect(d.year).toBe(2021);
        expect(d.genres).toEqual(['科幻', '冒险']);
        expect(d.director).toBe('丹尼斯·维伦纽瓦');
        expect(d.cast).toEqual(['提莫西·查拉梅', '赞达亚', '斯特兰']);
    });

    it('posterUrl 拼接图片 CDN', () => {
        expect(posterUrl('/x.jpg')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
        expect(posterUrl(undefined)).toBeUndefined();
    });
});

describe('TmdbClient 注入 http', () => {
    it('search 调用注入的 http 并返回解析结果', async () => {
        const calls: string[] = [];
        const client = new TmdbClient('KEY', async (url) => {
            calls.push(url);
            return movieSearchJson;
        });
        const results = await client.search('沙丘', 'movie');
        expect(results).toHaveLength(2);
        expect(calls[0]).toContain('api_key=KEY');
    });

    it('search 并发拉取 page=1+2、按 id 去重、截断到 30（保证 30+）', async () => {
        const calls: string[] = [];
        const client = new TmdbClient('KEY', async (url) => {
            calls.push(url);
            return movieSearchJson; // 2 条：id 1, 2（page1 和 page2 返回相同内容用于验证去重）
        });
        const results = await client.search('沙丘', 'movie');
        expect(results).toHaveLength(2); // 去重后
        const pages = calls.map((u) => /page=(\d+)/.exec(u)?.[1]);
        expect(pages).toEqual(['1', '2']);
    });

    it('search 跨页合并后截断到 30 条（mock 多结果，TMDB id 从 1 开始）', async () => {
        const mk = (n: number, offset: number) =>
            JSON.stringify({
                results: Array.from({ length: n }, (_, i) => ({
                    id: offset + i,
                    title: `t${offset + i}`,
                    original_title: `o${offset + i}`,
                    release_date: '2024-01-01',
                })),
            });
        const client = new TmdbClient('KEY', async (url) => (/page=2/.test(url) ? mk(20, 21) : mk(20, 1)));
        const results = await client.search('q', 'movie');
        expect(results).toHaveLength(30);
        expect(results[0].id).toBe(1);
        expect(results[29].id).toBe(30);
    });

    it('detail 并发拉取详情+演职员', async () => {
        const client = new TmdbClient('KEY', async (url) => (url.includes('/credits') ? creditsMovieJson : detailMovieJson));
        const d = await client.detail(1, 'movie');
        expect(d.director).toBe('丹尼斯·维伦纽瓦');
        expect(d.cast).toHaveLength(3);
    });
});
