import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseSearchResults,
    parseDetail,
    posterUrl,
    TmdbClient,
} from 'services/tmdb';
import {
    isTmdbV4Token,
    tmdbApiKeyQuery,
    tmdbAuthHeaders,
    tmdbSessionNeedsConvert,
    parseTmdbConvertedSessionId,
    isTmdbV3ApiKey,
    isTmdbV4AccessToken,
    tmdbApiKeyFieldIssue,
    tmdbSessionFieldIssue,
} from 'pure/tmdbAuth';
import { tmdbAccountSelfUrl, tmdbAccountUrl } from 'pure/tmdbSync';

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

// 🔴 2026-10-25 用户报障追加：「是v4的令牌认证的」⇒ v4 Read Access Token 必须走 Authorization: Bearer，
//   ⛔ 绝不能塞进 ?api_key=（塞了 TMDB 优先报 "Invalid API key"，用户被引向反复重填）。
describe('TMDB v4 Read Access Token 与 v3 API Key 分流', () => {
    /** 一个形态合法的 v4 JWT（内容无所谓，只验分流；⛔ 不是真 token） */
    const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature_part';

    it('isTmdbV4Token 认 JWT、否 v3 key & 空串', () => {
        expect(isTmdbV4Token(V4)).toBe(true);
        expect(isTmdbV4Token('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe(false);
        expect(isTmdbV4Token('')).toBe(false);
        expect(isTmdbV4Token('   ')).toBe(false);
        // 前缀像 JWT 但没有两个点 ⇒ 不是
        expect(isTmdbV4Token('eyJhbGciOiJIUzI1NiJ9')).toBe(false);
    });

    it('tmdbApiKeyQuery：v3 拼 api_key，v4 返回空串', () => {
        expect(tmdbApiKeyQuery('KEY123')).toBe('&api_key=KEY123');
        expect(tmdbApiKeyQuery(V4)).toBe('');
    });

    it('tmdbAuthHeaders：v4 带 Bearer，v3 返回空对象', () => {
        expect(tmdbAuthHeaders(V4)).toEqual({ Authorization: `Bearer ${V4}` });
        expect(tmdbAuthHeaders('KEY123')).toEqual({});
    });

    it('buildSearchUrl：v4 不含 api_key，v3 含', () => {
        expect(buildSearchUrl(V4, '沙丘', 'movie', 'zh-CN')).not.toContain('api_key');
        expect(buildSearchUrl('KEY123', '沙丘', 'movie', 'zh-CN')).toContain('api_key=KEY123');
    });

    it('TmdbClient.search 把 Bearer 头透传给注入的 http（v4）', async () => {
        const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
        const client = new TmdbClient(V4, async (url, headers) => {
            seen.push({ url, headers });
            return movieSearchJson;
        });
        await client.search('沙丘', 'movie');
        expect(seen).toHaveLength(2);
        for (const c of seen) {
            expect(c.headers).toEqual({ Authorization: `Bearer ${V4}` });
            expect(c.url).not.toContain('api_key');
        }
    });

    it('TmdbClient.search 对 v3 key 不传 headers', async () => {
        const seen: Array<Record<string, string> | undefined> = [];
        const client = new TmdbClient('KEY123', async (_url, headers) => {
            seen.push(headers);
            return movieSearchJson;
        });
        await client.search('沙丘', 'movie');
        expect(seen.every((h) => h === undefined)).toBe(true);
    });

    it('tmdbAccountSelfUrl / tmdbAccountUrl：v4 不拼 api_key、v3 拼', () => {
        expect(tmdbAccountSelfUrl('SID', V4)).not.toContain('api_key');
        expect(tmdbAccountSelfUrl('SID', 'KEY123')).toContain('api_key=KEY123');
        const v4List = tmdbAccountUrl(1, 'watchlist', 'movie', 'SID', V4, 1);
        expect(v4List).not.toContain('api_key');
        expect(v4List).toContain('/watchlist/movies'); // 单复数那条不回归
        expect(tmdbAccountUrl(1, 'watchlist', 'movie', 'SID', 'KEY123', 1)).toContain('api_key=KEY123');
    });

    // ── 2026-10-25 第二轮：v4 用户认证拿到的是 access_token，不是 v3 session_id ──────────

    it('tmdbSessionNeedsConvert：JWT 要转换，v3 session_id 不转换', () => {
        expect(tmdbSessionNeedsConvert(V4)).toBe(true);
        expect(tmdbSessionNeedsConvert('0000000000000000000000000000000000000000')).toBe(false); // 40 位 hex = v3 session_id 形态，此处为虚构占位值
        expect(tmdbSessionNeedsConvert('')).toBe(false);
    });

    it('isTmdbV3ApiKey / isTmdbV4AccessToken：两条互斥边界', () => {
        const KEY = '0123456789abcdef0123456789abcdef';
        expect(isTmdbV3ApiKey(KEY)).toBe(true);
        expect(isTmdbV4AccessToken(V4)).toBe(true);
        // ⛔ 别让一格的值骗过另一格的判据
        expect(isTmdbV3ApiKey(V4)).toBe(false);
        expect(isTmdbV4AccessToken(KEY)).toBe(false);
        // 空串两边都不算合法（空值的展示交给「未配置」徽标，不归这两个函数管）
        expect(isTmdbV3ApiKey('')).toBe(false);
        expect(isTmdbV4AccessToken('')).toBe(false);
    });

    it('parseTmdbConvertedSessionId：取 session_id；失败抛可读错误', () => {
        expect(parseTmdbConvertedSessionId(JSON.stringify({ success: true, session_id: 'ABC123' }))).toBe('ABC123');
        expect(() => parseTmdbConvertedSessionId(JSON.stringify({ success: false, status_message: 'Not approved.' }))).toThrow(
            /未被批准或已过期.*Not approved/,
        );
        expect(() => parseTmdbConvertedSessionId('<html>proxy error</html>')).toThrow(/不是合法 JSON/);
    });

    it('accountItems：填 v4 access_token 时先换 session_id，且只换一次（缓存）', async () => {
        const posts: Array<{ url: string; body: string; headers?: Record<string, string> }> = [];
        const gets: string[] = [];
        const client = new TmdbClient(
            V4,
            async (url) => {
                gets.push(url);
                // 第一次是 /account（拿 account_id），之后是清单页
                if (url.includes('/account?') || url.includes('/account?')) return JSON.stringify({ id: 42 });
                return JSON.stringify({ page: 1, total_pages: 1, total_results: 0, results: [] });
            },
            'zh-CN',
            async (url, body, headers) => {
                posts.push({ url, body, headers });
                return JSON.stringify({ success: true, session_id: 'REAL_SID' });
            },
        );
        await client.accountItems(V4, 'watchlist', 'movie');
        // 只转换一次
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toContain('/authentication/session/convert/4');
        expect(JSON.parse(posts[0].body)).toEqual({ access_token: V4 });
        // ⚠️ 本条构造的是**老配置兼容**路径：第一格历史上存的是 v4 Read Access Token（而不是 32 位 Key），
        //   `tmdbApiKeyQuery` 返回空串 ⇒ 转换请求只能退回 Bearer，否则鉴权整个丢掉。
        //   正常配置（32 位 Key + access_token）走 `?api_key=`，见下一条用例。
        expect(posts[0].headers).toEqual({ Authorization: `Bearer ${V4}` });
        expect(posts[0].url).not.toContain('api_key=');
        // 后续真实请求用的是换来的 v3 session_id，⛔ 不是 JWT
        expect(gets.some((u) => u.includes('session_id=REAL_SID'))).toBe(true);
        expect(gets.every((u) => !u.includes(`session_id=${V4}`))).toBe(true);
    });

    // 🔴 2026-10-25 用户裁定（原文「按官方改：用 32 位 Key 做 api_key 鉴权（用 v3 读数据、用 v4 管账户）」）：
    //   `/3/authentication/session/convert/4` 属 **v3 认证接口**，鉴权走 `?api_key=`；
    //   body 里的 access_token 只是「要被换掉的那张票」，⛔ 不是本请求的凭据。
    //   官方 OpenAPI 与 golang-tmdb / tmdb_api 两个实现都只给 `?api_key=`，旧版（Bearer 自己）随时会在官方收紧时断掉。
    it('accountItems：标准配置（32 位 Key + access_token）时，转换请求用 api_key 鉴权', async () => {
        const V3KEY = '0123456789abcdef0123456789abcdef';
        const posts: Array<{ url: string; body: string; headers?: Record<string, string> }> = [];
        const client = new TmdbClient(
            V3KEY,
            async (url) => {
                if (url.includes('/account?')) return JSON.stringify({ id: 42 });
                return JSON.stringify({ page: 1, total_pages: 1, total_results: 0, results: [] });
            },
            'zh-CN',
            async (url, body, headers) => {
                posts.push({ url, body, headers });
                return JSON.stringify({ success: true, session_id: 'REAL_SID' });
            },
        );
        await client.accountItems(V4, 'watchlist', 'movie');
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toContain('/authentication/session/convert/4');
        expect(posts[0].url).toContain(`api_key=${V3KEY}`);
        expect(JSON.parse(posts[0].body)).toEqual({ access_token: V4 });
        // 有 api_key 就⛔ 不再叠 Bearer（两条鉴权同时出现时，官方报错会互相掩盖）
        expect(posts[0].headers).toBeUndefined();
    });

    it('accountItems：填 v3 session_id 时不发转换请求', async () => {
        const posts: string[] = [];
        const gets: string[] = [];
        const client = new TmdbClient(
            'KEY123',
            async (url) => {
                gets.push(url);
                if (url.includes('/account?')) return JSON.stringify({ id: 42 });
                return JSON.stringify({ page: 1, total_pages: 1, total_results: 0, results: [] });
            },
            'zh-CN',
            async (url) => {
                posts.push(url);
                return '{}';
            },
        );
        await client.accountItems('V3SESSIONID', 'watchlist', 'movie');
        expect(posts).toHaveLength(0);
        expect(gets.some((u) => u.includes('session_id=V3SESSIONID'))).toBe(true);
    });
});

// 🔴 2026-10-25 用户裁定（第四版）：两格**各只收一种**
//   「Session ID 那一格填的只能是 access_token 近 300 位字符串，第二格填的只能是从 themoviedb.org 的
//    「设置 → API」获取的 32 位字符串，占位说明也是」
//   ⇒ 这里守的是「填错格时能立刻得到一句人话」，⛔ 不是守某句文案的措辞（涉及关键词即可）。
describe('tmdb 两格凭据的就地校验', () => {
    const V3KEY = '0123456789abcdef0123456789abcdef';
    // ⚠️ 上一段 describe 里的 V4 是块级常量，作用域到不了这里 ⇒ 本块自带一份同形态的值
    const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature_part';

    it('tmdbApiKeyFieldIssue：空值不管、32 位 hex 通过', () => {
        expect(tmdbApiKeyFieldIssue('')).toBeNull();
        expect(tmdbApiKeyFieldIssue('   ')).toBeNull();
        expect(tmdbApiKeyFieldIssue(V3KEY)).toBeNull();
        // 大写也认（用户从网页复制的大小写不定）
        expect(tmdbApiKeyFieldIssue(V3KEY.toUpperCase())).toBeNull();
    });

    it('tmdbApiKeyFieldIssue：填了 v4 令牌要说清「改填到下面那格」', () => {
        const msg = tmdbApiKeyFieldIssue(V4);
        expect(msg).toContain('32 位');
        expect(msg).toContain('access_token'); // 指路：这一格错了，该去下一格
    });

    it('tmdbApiKeyFieldIssue：位数不对 / 非 hex 一律拦下', () => {
        expect(tmdbApiKeyFieldIssue('abc')).toContain('32 位');
        expect(tmdbApiKeyFieldIssue('0123456789abcdef0123456789abcde')).toContain('32 位'); // 31 位
        expect(tmdbApiKeyFieldIssue('0123456789abcdef0123456789abcdef0')).toContain('32 位'); // 33 位
        expect(tmdbApiKeyFieldIssue('zzzz456789abcdef0123456789abcdef')).toContain('32 位'); // 非 hex
    });

    it('tmdbSessionFieldIssue：空值不管、v4 access_token 通过', () => {
        expect(tmdbSessionFieldIssue('')).toBeNull();
        expect(tmdbSessionFieldIssue(V4)).toBeNull();
    });

    it('tmdbSessionFieldIssue：填了 32 位 v3 session_id 要明确拒绝并指路', () => {
        const msg = tmdbSessionFieldIssue(V3KEY);
        expect(msg).toContain('access_token');
        expect(msg).toContain('v3'); // 说清「你填的是 v3 那套，本插件不再用它同步」
    });

    it('tmdbSessionFieldIssue：既不是 JWT 也不是 32 位 hex 时给出获取路径', () => {
        const msg = tmdbSessionFieldIssue('随便一串');
        expect(msg).toContain('access_token');
        expect(msg).toContain('v4 用户认证');
    });

    it('两格判据互斥：同一份合法值不会两边同时通过', () => {
        // 32 位 Key 只能过第一格、v4 令牌只能过第二格 —— 这是「统一」的实质，不是文案功夫
        expect(tmdbApiKeyFieldIssue(V3KEY)).toBeNull();
        expect(tmdbSessionFieldIssue(V3KEY)).not.toBeNull();
        expect(tmdbApiKeyFieldIssue(V4)).not.toBeNull();
        expect(tmdbSessionFieldIssue(V4)).toBeNull();
    });
});
