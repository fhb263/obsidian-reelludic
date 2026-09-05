import { describe, it, expect } from 'vitest';
import {
    buildSearchBody,
    parseAnilistResults,
    toAnilistResult,
    cleanAnilistDescription,
    AnilistClient,
    type RawAnilistMedia,
} from 'services/anilist';
import type { BangumiSearchResult } from 'services/bangumi';
import { describeSearchResult } from 'pure/searchDisplay';
import { mergeBySource } from 'pure/searchMerge';

// ⚠️ fixture 基于 graphql.anilist.co 公开返回形态校准（#165 T10；沙箱可达已实测 1 次：
//   description(asHtml:false) 仍泄漏 <br>/<b> 标记、studios.nodes 多节点、meanScore 为整数 0-100）
// 完整条目（对照实测 ONE PIECE id=21 的响应形态；genres 5 → 截 3；studios 多节点取首）
const fullSearchJson = JSON.stringify({
    data: {
        Page: {
            pageInfo: { total: 1, perPage: 20, currentPage: 1 },
            media: [
                {
                    id: 21,
                    title: { romaji: 'ONE PIECE', english: 'ONE PIECE', native: 'ONE PIECE' },
                    coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg' },
                    startDate: { year: 1999, month: 10, day: 20 },
                    genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'],
                    meanScore: 87,
                    studios: {
                        nodes: [
                            { name: 'Toei Animation' },
                            { name: 'Funimation' },
                            { name: 'Fuji TV' },
                        ],
                    },
                    description: 'Gold Roger was known as the Pirate King.<br><br>\n<b>Note</b>: special episodes included.',
                },
            ],
        },
    },
});

// title 语言优先级：romaji 缺省 → english 兜底；仅 native → native 兜底；无任何标题/非 number id → 滤除
const languagePriorityJson = JSON.stringify({
    data: {
        Page: {
            media: [
                {
                    id: 105,
                    title: { romaji: null, english: 'Fate/Zero', native: 'フェイト/ゼロ' },
                    startDate: { year: 2011 },
                    genres: ['Action', 'Fantasy'],
                    meanScore: 68,
                    coverImage: { large: 'https://example.com/fz.jpg' },
                },
                {
                    id: 5114,
                    title: { romaji: 'Mob Psycho 100', english: null, native: null },
                    startDate: { year: 2016 },
                    meanScore: 86,
                },
                {
                    id: 30000,
                    title: { romaji: null, english: null, native: 'ネタバレ無し' },
                    startDate: { year: 2020 },
                    meanScore: 55,
                },
                { id: 99999, title: null, meanScore: 60 }, // 无任何标题 → 滤除
                { title: { romaji: 'missing id' }, meanScore: 60 }, // id 非 number → 滤除
            ],
        },
    },
});

// 缺失容错：startDate 缺年 / meanScore 缺失 / studios.nodes 空 / 无 coverImage / description 缺失
const sparseJson = JSON.stringify({
    data: {
        Page: {
            media: [
                {
                    id: 100,
                    title: { romaji: 'Odd Taxi', english: null, native: 'オッドタクシー' },
                    coverImage: { large: null },
                    startDate: { year: null },
                    genres: [],
                    meanScore: null,
                    studios: { nodes: [] },
                    description: null,
                },
                {
                    id: 101,
                    title: { romaji: 'title missing fields' },
                    startDate: { month: 4 },
                    genres: null,
                    studios: null,
                    coverImage: {},
                },
            ],
        },
    },
});

// 空/错误体容错：data.Page.media 缺失 / GraphQL errors 体（无 data）/ 非 JSON
const emptyJson = JSON.stringify({ data: { Page: { media: [] } } });
const errorJson = JSON.stringify({ errors: [{ message: 'boom' }] });
const noDataJson = JSON.stringify({ data: null });

describe('buildSearchBody（GraphQL POST body）', () => {
    it('body 含固定 query（Page.media type:ANIME）+ variables.s 为编码检索词', () => {
        const body = JSON.parse(buildSearchBody('one piece')) as { query: string; variables: { s: string } };
        expect(body.variables.s).toBe('one piece');
        expect(body.query).toContain('Page(');
        expect(body.query).toContain('type:ANIME');
        expect(body.query).toContain('SEARCH_MATCH');
        // 计划 query 字段齐备：三语标题 / coverImage.large / startDate.year / genres / meanScore / studios.nodes / description(asHtml:false)
        for (const frag of ['romaji', 'english', 'native', 'coverImage', 'startDate', 'genres', 'meanScore', 'studios', 'description(asHtml:false)']) {
            expect(body.query).toContain(frag);
        }
    });
});

describe('parseAnilistResults', () => {
    it('完整条目：id/title 三语/cover/year/genres 全量/meanScore/studios 首节点/description 原样（标记清洗在 mapper）', () => {
        const items = parseAnilistResults(fullSearchJson);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            id: 21,
            titleRomaji: 'ONE PIECE',
            titleEnglish: 'ONE PIECE',
            titleNative: 'ONE PIECE',
            year: 1999,
            cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg',
            genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'],
            meanScore: 87,
            studio: 'Toei Animation', // studios.nodes[0]
            description: 'Gold Roger was known as the Pirate King.<br><br>\n<b>Note</b>: special episodes included.',
        });
    });

    it('title 语言优先级：romaji 空 → 保留 english/native 供 mapper 兜底（parse 不做选择）', () => {
        const items = parseAnilistResults(languagePriorityJson);
        // 无标题（id 99999）与非 number id 条目被滤除
        expect(items).toHaveLength(3);
        expect(items[0].titleRomaji).toBeUndefined();
        expect(items[0].titleEnglish).toBe('Fate/Zero');
        expect(items[0].titleNative).toBe('フェイト/ゼロ');
        expect(items[1].titleRomaji).toBe('Mob Psycho 100');
        expect(items[2].titleNative).toBe('ネタバレ無し');
    });

    it('缺字段安全读取：startDate 缺年 → year undefined；coverImage.large 缺失 → cover undefined；studios 空/缺失 → studio undefined；meanScore null → undefined；genres 空数组/缺失 → undefined（parse 不做语义决策，mapper 兜底空数组）', () => {
        const items = parseAnilistResults(sparseJson);
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            id: 100,
            year: undefined,
            cover: undefined,
            meanScore: undefined,
            studio: undefined,
            genres: undefined, // genres:[] 空数组在 parse 归一 undefined
        });
        expect(items[0].description).toBeUndefined();
        expect(items[1].genres).toBeUndefined(); // genres null 原样
    });

    it('空 media / GraphQL errors 体 / data 缺失 / 非 JSON → 空数组（HTTP 200 错误体安全降级）', () => {
        expect(parseAnilistResults(emptyJson)).toEqual([]);
        expect(parseAnilistResults(errorJson)).toEqual([]);
        expect(parseAnilistResults(noDataJson)).toEqual([]);
        expect(parseAnilistResults('not json')).toEqual([]);
        expect(parseAnilistResults('[1,2]')).toEqual([]);
    });
});

describe('cleanAnilistDescription', () => {
    it('asHtml:false 仍泄漏的 <br>/<b> 等标记 → 段落分隔/去除标记（实测响应含 <br><br> 与 <b>）', () => {
        const s = 'First para.<br><br>\n<b>Note</b>: keep text.';
        expect(cleanAnilistDescription(s)).toBe('First para.\n\nNote: keep text.');
    });

    it('空/缺省 → undefined', () => {
        expect(cleanAnilistDescription(undefined)).toBeUndefined();
        expect(cleanAnilistDescription('')).toBeUndefined();
        expect(cleanAnilistDescription('   ')).toBeUndefined();
    });
});

describe('toAnilistResult（映射到 anime 组结果类型 BangumiSearchResult）', () => {
    it('完整条目：id=anilist id(number)、title=romaji、originalTitle=native、rating=meanScore/10（10 分制决策）、genres 截 3、studio=首节点、summary=desc 清洗后、cover、source=anilist；直达 URL 由 source 查表派生（结果对象不带 sourceUrl）', () => {
        const [raw] = parseAnilistResults(fullSearchJson);
        const r = toAnilistResult(raw);
        expect(r.id).toBe(21);
        expect(r.title).toBe('ONE PIECE');
        expect(r.originalTitle).toBe('ONE PIECE'); // native 同值
        expect(r.year).toBe(1999);
        expect(r.cover).toBe('https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg');
        expect(r.genres).toEqual(['Action', 'Adventure', 'Comedy']); // 5 → 截 3
        expect(r.rating).toBe(8.7); // 决策：meanScore 87（0-100）→ 10 分制 8.7（anime 结果类型/表单展示语义与 Bangumi/豆瓣同为 10 分制）
        expect(r.studio).toBe('Toei Animation');
        expect(r.summary).toBe('Gold Roger was known as the Pirate King.\n\nNote: special episodes included.');
        expect(r.source).toBe('anilist');
        // BangumiSearchResult 无 sourceUrl 字段：UI 直达 URL 走 source 查表派生（T2 SOURCE_VIEW.anilist）
        expect(describeSearchResult(r).sourceUrl).toBe('https://anilist.co/anime/21');
        expect(describeSearchResult(r).source).toBe('AniList');
    });

    it('title 语言优先级（mapper 决策）：romaji → english → native', () => {
        const items = parseAnilistResults(languagePriorityJson);
        expect(toAnilistResult(items[0]).title).toBe('Fate/Zero'); // romaji 空 → english
        expect(toAnilistResult(items[1]).title).toBe('Mob Psycho 100'); // romaji 优先
        expect(toAnilistResult(items[2]).title).toBe('ネタバレ無し'); // 仅 native
    });

    it('缺字段容错：无 year/cover/meanScore/studio/genres/description → 对应字段 undefined/[]，不崩', () => {
        const [sparse] = parseAnilistResults(sparseJson);
        const r = toAnilistResult(sparse);
        expect(r.year).toBeUndefined();
        expect(r.cover).toBeUndefined();
        expect(r.rating).toBeUndefined();
        expect(r.studio).toBeUndefined();
        expect(r.genres).toEqual([]); // genres 截 3 兜底空数组（结果类型字段 genres: string[] 必需）
        expect(r.summary).toBeUndefined();
    });

    it('类型决策：anilist 与 omdb 不同——id 同为 number 且字段全映射进 BangumiSearchResult 可选字段袋，无字段冲突 → 复用该类型（source 区分直达语义），编译期断言可赋值；URL 经 describeSearchResult source 查表派生', () => {
        const r = toAnilistResult(parseAnilistResults(fullSearchJson)[0]);
        const asBangumi: BangumiSearchResult = r; // 编译期：可赋值为 anime 组现有结果类型
        expect(asBangumi.id).toBe(21);
        // 运行时决策断言：source 区分语义——id 是 anilist.co/anime/{id} 而非 bgm.tv/subject/{id}
        expect(r.source).toBe('anilist');
        expect(describeSearchResult(r).sourceUrl).toMatch(/^https:\/\/anilist\.co\/anime\/\d+$/);
        expect(describeSearchResult(r).sourceUrl).not.toMatch(/bgm\.tv/);
    });

    it('main 合并兼容：merge 仅依赖 title/source——anilist 与 bangumi 原生（无 source）同名条目跨源并存', () => {
        const raw = parseAnilistResults(fullSearchJson)[0];
        const merged = mergeBySource<{ title: string; source?: string }>(
            [toAnilistResult(raw)],
            [{ title: 'ONE PIECE', source: undefined as string | undefined }],
        );
        expect(merged).toHaveLength(2);
        expect(merged.map((r) => r.source)).toEqual(['anilist', undefined]);
    });
});

describe('AnilistClient 注入 httpPost', () => {
    it('search：POST GraphQL 端点一次，body=JSON{query,variables.s=query}，headers Content-Type json；返回 toAnilistResult 映射', async () => {
        const calls: { url: string; body: string; headers?: Record<string, string> }[] = [];
        const client = new AnilistClient(async (url, body, headers) => {
            calls.push({ url, body, headers });
            return fullSearchJson;
        });
        const results = await client.search('one piece');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://graphql.anilist.co');
        expect(calls[0].headers?.['Content-Type']).toBe('application/json');
        const parsed = JSON.parse(calls[0].body) as { query: string; variables: { s: string } };
        expect(parsed.variables.s).toBe('one piece');
        expect(parsed.query).toContain('media(search:$s, type:ANIME');
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ source: 'anilist', id: 21, rating: 8.7 });
    });

    it('search：空结果/错误体 → 空数组（HTTP 200 的 GraphQL errors 体不抛、不崩）', async () => {
        const client = new AnilistClient(async () => errorJson);
        expect(await client.search('nope')).toEqual([]);
    });
});

// 编译期哨兵：RawAnilistMedia 为扁平原始形态（供 mapper/parse 边界稳定）
void (null as RawAnilistMedia | null);
