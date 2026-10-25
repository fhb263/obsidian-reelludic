import { describe, it, expect } from 'vitest';
import { buildSearchUrl, buildDetailUrl, parseOmdbResults, parseOmdbDetail, OmdbClient } from 'services/omdb';
import type { TmdbSearchResult } from 'services/tmdb';
import { mergeBySource } from 'pure/searchMerge';

// ⚠️ fixture 基于 omdbapi.com 公开返回形态校准（#165 T9；沙箱网络不可达，真实返回待用户手测复校）
// 电影搜索：2 movie（含 Year 范围形态 / Poster N/A）+ 1 series（非目标 type，应被 movie 过滤滤除）
const movieSearchJson = JSON.stringify({
    Search: [
        {
            Title: 'The Shawshank Redemption',
            Year: '1994',
            imdbID: 'tt0111161',
            Type: 'movie',
            Poster: 'https://m.media-amazon.com/images/M/x_V1_SX300.jpg',
        },
        {
            Title: 'The Godfather',
            Year: '1972–1990', // 续作连载范围年份 → 取首 4 位 1972
            imdbID: 'tt0068646',
            Type: 'movie',
            Poster: 'N/A', // 无海报标记 → undefined
        },
        {
            Title: 'Breaking Bad',
            Year: '2008–',
            imdbID: 'tt0903747',
            Type: 'series', // 非目标 type（movie 搜索）→ 滤除
            Poster: 'https://m.media-amazon.com/images/M/bb.jpg',
        },
    ],
    Response: 'True',
});

// 剧集搜索：series + movie 混排 → mediaType='tv' 只保留 Type=series
const seriesSearchJson = JSON.stringify({
    Search: [
        {
            Title: 'Breaking Bad',
            Year: '2008–',
            imdbID: 'tt0903747',
            Type: 'series',
            Poster: 'https://m.media-amazon.com/images/M/bb.jpg',
        },
        {
            Title: 'Breaking Bad (2026 reboot)',
            Year: '2026',
            imdbID: 'tt7777777',
            Type: 'movie', // 非目标 type（tv 搜索）→ 滤除
            Poster: 'N/A',
        },
    ],
    Response: 'True',
});

// 缺失核心字段（imdbID/Title）的异常条目 → 应过滤；Search 缺失 / 空 → 空结果
const malformedSearchJson = JSON.stringify({
    Search: [
        { Title: '缺 imdbID 应被过滤', Year: '1994', Type: 'movie', Poster: 'N/A' },
        { imdbID: 'tt555', Year: '1994', Type: 'movie', Poster: 'N/A' }, // 缺 Title 应被过滤
        { Title: 'Ok', imdbID: 'tt444', Year: 'N/A', Type: 'movie' }, // Poster 缺失安全读取
    ],
    Response: 'True',
});

// 完整详情（plot=full 返回形态；>5 演员 >3 类型 截断 + imdbVotes 千分位）
const detailJson = JSON.stringify({
    Title: 'The Shawshank Redemption',
    Year: '1994',
    Rated: 'R',
    Released: '14 Oct 1994',
    Runtime: '142 min',
    Genre: 'Drama, Crime, Thriller, Mystery, Western, Film-Noir', // >3 → 截 3
    Director: 'Frank Darabont',
    Actors: 'Tim Robbins, Morgan Freeman, Bob Gunton, William Sadler, Clancy Brown, Gil Bellows, Mark Rolston, James Whitmore', // >5 → 截 5
    Plot: 'Two imprisoned men bond over a number of years.',
    Poster: 'https://m.media-amazon.com/images/M/x_V1_SX300.jpg',
    imdbRating: '9.3',
    imdbVotes: '2,396,672',
    Response: 'True',
});

// 缺失/占位详情：关键可回填字段全部 N/A → 投影字段 undefined（表单补全安全）
const sparseDetailJson = JSON.stringify({
    Title: 'Untitled Project',
    Year: 'N/A',
    Director: 'N/A',
    Actors: 'N/A',
    Genre: 'N/A',
    Plot: 'N/A',
    Poster: 'N/A',
    imdbRating: 'N/A',
    imdbVotes: 'N/A',
    Response: 'True',
});

describe('omdb URL 构造', () => {
    it('movie 搜索 URL：apikey + s 编码 + type=movie + page=1', () => {
        const url = buildSearchUrl('myKey123', 'the shark', 'movie');
        expect(url).toBe(
            'https://www.omdbapi.com/?apikey=myKey123&s=' + encodeURIComponent('the shark') + '&type=movie&page=1',
        );
    });

    it('tv 搜索 URL：mediaType=tv 归一为 type=series', () => {
        const url = buildSearchUrl('myKey123', 'Breaking Bad', 'tv');
        expect(url).toBe(
            'https://www.omdbapi.com/?apikey=myKey123&s=' + encodeURIComponent('Breaking Bad') + '&type=series&page=1',
        );
    });

    it('详情 URL：默认 plot=full；可显式传 plot=short（测试连接 ping 用）', () => {
        expect(buildDetailUrl('myKey123', 'tt3896198')).toBe(
            'https://www.omdbapi.com/?apikey=myKey123&i=tt3896198&plot=full',
        );
        expect(buildDetailUrl('myKey123', 'tt3896198', 'short')).toBe(
            'https://www.omdbapi.com/?apikey=myKey123&i=tt3896198&plot=short',
        );
    });
});

describe('parseOmdbResults', () => {
    it('movie 搜索多结果：id=imdbID、title=Title、source=omdb；Year 范围形态（1972–1990）取首 4 位；Poster=N/A → undefined', () => {
        const items = parseOmdbResults(movieSearchJson, 'movie');
        expect(items).toHaveLength(2); // series 条被过滤
        expect(items[0]).toEqual({
            id: 'tt0111161',
            imdbID: 'tt0111161',
            title: 'The Shawshank Redemption',
            year: 1994,
            poster: 'https://m.media-amazon.com/images/M/x_V1_SX300.jpg',
            source: 'omdb',
            sourceUrl: 'https://www.imdb.com/title/tt0111161',
        });
        expect(items[1].year).toBe(1972); // '1972–1990' → 1972
        expect(items[1].poster).toBeUndefined(); // 'N/A' → undefined
        // 不出现非目标 type（series）
        expect(items.map((r) => r.imdbID)).not.toContain('tt0903747');
    });

    it('tv 搜索（mediaType=tv → type=series）：只保留 Type=series，movie 条过滤；Year `2008–` 取 2008', () => {
        const items = parseOmdbResults(seriesSearchJson, 'tv');
        expect(items).toHaveLength(1);
        expect(items[0].imdbID).toBe('tt0903747');
        expect(items[0].year).toBe(2008);
    });

    it('异常条目容错：缺 imdbID / 缺 Title 滤除；Poster 缺失安全读取（undefined）', () => {
        const items = parseOmdbResults(malformedSearchJson, 'movie');
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            id: 'tt444',
            imdbID: 'tt444',
            title: 'Ok',
            year: undefined, // Year 'N/A' 无 4 位年份
            poster: undefined,
            source: 'omdb',
            sourceUrl: 'https://www.imdb.com/title/tt444',
        });
    });

    it('Search 缺失 / 空 / 非对象 → 空结果（HTTP 200 的 Response=False 错误体同样安全返回空）', () => {
        expect(parseOmdbResults('{}', 'movie')).toEqual([]);
        expect(parseOmdbResults(JSON.stringify({ Search: [] }), 'movie')).toEqual([]);
        expect(parseOmdbResults(JSON.stringify({ Response: 'False', Error: 'Incorrect IMDb ID.' }), 'movie')).toEqual([]);
        expect(parseOmdbResults('[1,2]', 'movie')).toEqual([]);
    });

    it('结果类型决策：omdb id/imdbID 为字符串、source=omdb；不得强塞 TmdbSearchResult(id:number)——编译期断言', () => {
        const r = parseOmdbResults(movieSearchJson, 'movie')[0];
        expect(typeof r.id).toBe('string');
        expect(r.id).toBe(r.imdbID);
        expect(r.id).toMatch(/^tt/);
        expect(r.source).toBe('omdb');
        // @ts-expect-error 类型决策：OmdbSearchResult（id:string）与 TmdbSearchResult（id:number）不可互赋，
        // 禁止把 omdb 结果强塞 TmdbSearchResult（tsc --noEmit 校验该断言）
        const bad: TmdbSearchResult = r;
        void bad;
    });

    it('main 合并兼容：merge/sort 仅依赖 title/source——tmdb 与 omdb 同名条目跨源并存（mergeBySource 不去重）', () => {
        const om = parseOmdbResults(movieSearchJson, 'movie')[0];
        const merged = mergeBySource<{ title: string; source?: string }>(
            [om],
            [{ title: om.title, source: 'tmdb' as const }],
        );
        expect(merged).toHaveLength(2); // 同标题不同 source 都保留
        expect(merged.map((r) => r.source)).toEqual(['omdb', 'tmdb']);
    });
});

describe('parseOmdbDetail（点选补全投影）', () => {
    it('完整详情：Title/Year/Director/Actors(截5)/Genre(截3)/Plot/Poster/imdbRating/imdbVotes(去逗号) 投影', () => {
        const d = parseOmdbDetail(detailJson);
        expect(d).not.toBeNull();
        expect(d?.title).toBe('The Shawshank Redemption');
        expect(d?.year).toBe(1994);
        expect(d?.director).toBe('Frank Darabont');
        expect(d?.cast).toEqual(['Tim Robbins', 'Morgan Freeman', 'Bob Gunton', 'William Sadler', 'Clancy Brown']); // 截 5
        expect(d?.genres).toEqual(['Drama', 'Crime', 'Thriller']); // 截 3
        expect(d?.summary).toBe('Two imprisoned men bond over a number of years.');
        expect(d?.cover).toBe('https://m.media-amazon.com/images/M/x_V1_SX300.jpg');
        expect(d?.rating).toBe(9.3); // imdbRating '9.3' → number
        expect(d?.ratingCount).toBe(2396672); // imdbVotes '2,396,672' 去逗号
    });

    it('缺字段/N/A 占位安全读取：Director/Actors/Genre/Plot/Poster/imdbRating/imdbVotes 全 N/A → 对应字段 undefined', () => {
        const d = parseOmdbDetail(sparseDetailJson);
        expect(d).not.toBeNull();
        expect(d?.title).toBe('Untitled Project');
        expect(d?.director).toBeUndefined();
        expect(d?.cast).toBeUndefined();
        expect(d?.genres).toBeUndefined();
        expect(d?.summary).toBeUndefined();
        expect(d?.cover).toBeUndefined(); // Poster N/A
        expect(d?.rating).toBeUndefined();
        expect(d?.ratingCount).toBeUndefined();
    });

    it('Response=False（错误体）/ 非 JSON / 非对象 → null', () => {
        expect(parseOmdbDetail(JSON.stringify({ Response: 'False', Error: 'Incorrect IMDb ID.' }))).toBeNull();
        expect(parseOmdbDetail('not json')).toBeNull();
        expect(parseOmdbDetail('[1,2]')).toBeNull();
    });
});

describe('OmdbClient 注入 http', () => {
    it('search：movie 搜索用注入的 http 拉取并返回 parse 结果（URL 含 apikey + type=movie + page=1）', async () => {
        const calls: string[] = [];
        const client = new OmdbClient('myKey123', async (url) => {
            calls.push(url);
            return movieSearchJson;
        });
        const results = await client.search('shawshank', 'movie');
        expect(results).toHaveLength(2);
        expect(results[0].source).toBe('omdb');
        expect(results[0].id).toBe('tt0111161');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toBe(
            'https://www.omdbapi.com/?apikey=myKey123&s=' + encodeURIComponent('shawshank') + '&type=movie&page=1',
        );
    });

    it('detail：i={imdbID}&plot=full 拉详情并返回 parse 投影（失败/错误体 → null 静默）', async () => {
        const calls: string[] = [];
        const client = new OmdbClient('myKey123', async (url) => {
            calls.push(url);
            return detailJson;
        });
        const d = await client.detail('tt0111161');
        expect(calls[0]).toBe('https://www.omdbapi.com/?apikey=myKey123&i=tt0111161&plot=full');
        expect(d?.rating).toBe(9.3);
        expect(d?.ratingCount).toBe(2396672);
    });
});
