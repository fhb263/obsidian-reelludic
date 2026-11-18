// TMDB 账号同步（#665）—— 纯解析 / URL / 判重键 / 映射
// 契约来源：用户「做 TMDB 的同步接入（同先参考金标准）」；数据形态 = TMDB v3 账号接口官方文档
import { describe, expect, it } from 'vitest';
import {
    TMDB_SYNC_COMBOS,
    parseTmdbAccountId,
    parseTmdbAccountPage,
    tmdbAccountSegment,
    tmdbAccountSelfUrl,
    tmdbAccountUrl,
    tmdbAddedAtToISO,
    tmdbComboLabel,
    tmdbItemKey,
    tmdbListToStatus,
    tmdbSubjectUrl,
    tmdbVoteToCommunityScore,
} from 'pure/tmdbSync';

const sampleItem = {
    id: 27205,
    title: '盗梦空间',
    original_title: 'Inception',
    release_date: '2010-07-16',
    added_at: 1700000000,
    poster_path: '/abc.jpg',
    overview: '简介',
    vote_average: 8.4,
};

describe('tmdbSync · 账号页解析', () => {
    it('movie 条目：title / release_date；tv 条目：name / first_air_date', () => {
        const p = parseTmdbAccountPage(
            JSON.stringify({ page: 1, total_results: 2, results: [sampleItem, { ...sampleItem, id: 94605, name: 'Arcane', original_name: 'Arcane', first_air_date: '2021-11-06', title: undefined, original_title: undefined, release_date: undefined }] }),
            'movie',
        );
        expect(p.totalResults).toBe(2);
        expect(p.items[0]).toMatchObject({ id: 27205, title: '盗梦空间', originalTitle: 'Inception', releaseDate: '2010-07-16' });
        // tv 形态的键名兼容（name / original_name / first_air_date）
        expect(p.items[1]).toMatchObject({ id: 94605, title: 'Arcane', releaseDate: '2021-11-06' });
    });

    it('🔴 缺 id / 标题的条目**跳过不抛**（TMDB 加字段不致崩）', () => {
        const p = parseTmdbAccountPage(JSON.stringify({ results: [{ id: 1 }, { title: 'x' }, sampleItem] }), 'movie');
        expect(p.items).toHaveLength(1);
    });

    it('🔴 vote_count → voteCount（评分人数兜底）；0 / 缺失 ⇒ 不写键', () => {
        // 2026-11-08：以前根本不解析 vote_count ⇒ 账号同步建出来的条目永远没有评价人数
        // （评分数只在详情接口里，详情超时就彻底丢了；清单接口本来就带这个字段）
        const p = parseTmdbAccountPage(
            JSON.stringify({
                results: [
                    { ...sampleItem, id: 1, vote_count: 32123 },
                    { ...sampleItem, id: 2, vote_count: 0 },
                    { ...sampleItem, id: 3 },
                ],
            }),
            'movie',
        );
        expect(p.items[0].voteCount).toBe(32123);
        expect('voteCount' in p.items[1]).toBe(false);
        expect('voteCount' in p.items[2]).toBe(false);
    });

    it('results 非数组 / 整体坏 JSON：前者空页，后者抛（调用方提示）', () => {
        expect(parseTmdbAccountPage(JSON.stringify({ status_code: 34 }), 'movie').items).toHaveLength(0);
        expect(() => parseTmdbAccountPage('<html>401</html>', 'movie')).toThrow();
    });
});

describe('tmdbSync · URL（session_id 是 query 参数，⛔ 不是 header）', () => {
    it('清单地址：/account/{id}/{list}/{movies|tv}，带 api_key + session_id + 分页', () => {
        // 🔴 2026-10-25：电影段是复数 `movies`（旧断言写成 `movie` ⇒ 把 404 缺陷锁成了"正确"）
        // 🔴 2026-10-25 二次：凭据改走 `tmdbApiKeyQuery` ⇒ `session_id` 在前、`api_key` 在后
        //    （query 参数顺序对服务端无语义影响；此断言只锁"两个都在且路径对"）
        expect(tmdbAccountUrl(12345, 'watchlist', 'movie', 'sess', 'KEY', 2)).toBe(
            'https://api.themoviedb.org/3/account/12345/watchlist/movies?session_id=sess&api_key=KEY&language=zh-CN&page=2&sort_by=created_at.desc',
        );
        expect(tmdbAccountUrl(12345, 'favorite', 'movie', 'sess', 'KEY', 1)).toContain('/favorite/movies?');
    });

    it('🔴 v4 Read Access Token 走 header ⇒ 清单地址里 ⛔ 不能出现 api_key', () => {
        // 形态合法的假 JWT（内容无所谓，只验分流）
        const v4 = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig';
        const url = tmdbAccountUrl(12345, 'watchlist', 'movie', 'sess', v4, 1);
        expect(url).not.toContain('api_key');
        expect(url).toContain('session_id=sess');
        expect(url).toContain('/watchlist/movies?');
        expect(tmdbAccountSelfUrl('sess', v4)).not.toContain('api_key');
    });

    it('🔴 剧集段是 `tv` 不是 `tvs`（⛔ 别"统一加 s"）', () => {
        expect(tmdbAccountUrl(12345, 'watchlist', 'tv', 'sess', 'KEY', 1)).toContain('/watchlist/tv?');
        expect(tmdbAccountUrl(12345, 'favorite', 'tv', 'sess', 'KEY', 1)).toContain('/favorite/tv?');
        expect(tmdbAccountSegment('movie')).toBe('movies');
        expect(tmdbAccountSegment('tv')).toBe('tv');
    });

    it('账号自省地址：/account（拿 account_id）', () => {
        // session_id 在前（同清单地址，见上）
        expect(tmdbAccountSelfUrl('sess', 'KEY')).toBe('https://api.themoviedb.org/3/account?session_id=sess&api_key=KEY');
    });

    it('account id 从 /account 响应解析；没有 id ⇒ 抛（提示 session 无效）', () => {
        expect(parseTmdbAccountId(JSON.stringify({ id: 987654 }))).toBe('987654');
        expect(() => parseTmdbAccountId(JSON.stringify({ status_code: 7 }))).toThrow(/session/);
    });
});

describe('tmdbSync · 映射与判重键', () => {
    it('🔴 10 分制 → communityScore 同刻度直传（⛔ 不 /2 换算成 5 星）；0 / NaN / >10 ⇒ undefined（未评）', () => {
        // 这条曾经锁的是「/2 四舍五入 → 1~5 星」，与注释「10 分制社区分」自相矛盾：
        // communityScore 是全仓 10 分制字段，8.4 存成 4 等于被低估一半（用户报障「TMDB 评分不对」）。
        expect(tmdbVoteToCommunityScore(8.4)).toBe(8.4);
        expect(tmdbVoteToCommunityScore(10)).toBe(10);
        expect(tmdbVoteToCommunityScore(9.999)).toBe(10);
        expect(tmdbVoteToCommunityScore(0)).toBeUndefined();
        expect(tmdbVoteToCommunityScore(Number.NaN)).toBeUndefined();
        expect(tmdbVoteToCommunityScore(11)).toBeUndefined();
        expect(tmdbVoteToCommunityScore(-1)).toBeUndefined();
    });

    it('🔴 判重键带类型前缀（movie 与 tv 的 id 空间独立，同号不合并）', () => {
        expect(tmdbItemKey('movie', 27205)).toBe('tmdb:movie:27205');
        expect(tmdbItemKey('movie', 1)).not.toBe(tmdbItemKey('tv', 1));
    });

    it('状态映射：watchlist → want；favorite → watched（收藏没有"在看"语义）', () => {
        expect(tmdbListToStatus('watchlist')).toBe('want');
        expect(tmdbListToStatus('favorite')).toBe('watched');
    });

    it('added_at（UNIX 秒）→ YYYY-MM-DD；非法 ⇒ null', () => {
        expect(tmdbAddedAtToISO(1700000000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(tmdbAddedAtToISO(null)).toBeNull();
        expect(tmdbAddedAtToISO(-5)).toBeNull();
    });

    it('详情页网址 + 四个组合齐全（watchlist/favorite × movie/tv）', () => {
        expect(tmdbSubjectUrl('movie', 27205)).toBe('https://www.themoviedb.org/movie/27205');
        expect(TMDB_SYNC_COMBOS).toHaveLength(4);
        expect(tmdbComboLabel('watchlist', 'tv')).toBe('剧集 · 想看');
        expect(tmdbComboLabel('favorite', 'movie')).toBe('电影 · 收藏');
    });
});
