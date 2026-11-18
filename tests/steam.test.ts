import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    buildDetailUrl,
    parseSteamResults,
    parseAppDetails,
    parseReviewHistogram,
    toGameResult,
    SteamClient,
    type RawSteamItem,
} from 'services/steam';

// ⚠️ fixture 基于 store.steampowered.com/api/storesearch 真实响应快照校准（2026-09-02 实测：HTTP 200 JSON）
// 首选 suggest 端点实测不可用（返回热门 HTML <ul>，非搜索建议 JSON），故按任务端点校准步骤改用 storesearch 免 Key 端点。
const fullSearchJson = JSON.stringify({
    total: 6,
    items: [
        {
            type: 'app',
            name: 'ELDEN RING',
            id: 1245620,
            price: { currency: 'USD', initial: 5999, final: 5999 },
            tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg?t=1787868578',
            metascore: '94',
            platforms: { windows: true, mac: false, linux: false },
            controller_support: 'full',
        },
        {
            type: 'app',
            name: 'The Witcher 3: Wild Hunt - Complete Edition',
            id: 292030,
            price: { currency: 'USD', initial: 4999, final: 4999 },
            tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/292030/capsule_231x87.jpg?t=1787868578',
            metascore: '93',
        },
    ],
});

/** 异常条目合集：sub 非 app / bundle 非 app / 缺 id / 缺 name → parse 应容错过滤（sourceUrl app/{id} 仅对 app 语义正确） */
const abnormalSearchJson = JSON.stringify({
    total: 4,
    items: [
        { type: 'sub', name: 'ELDEN RING DLC Bundle', id: 3408351 },
        { type: 'bundle', name: 'Complete Bundle', id: 3097911 },
        { type: 'app', name: 'NoIdShouldFilter' }, // 缺 id
        { type: 'app', id: 1245620 }, // 缺 name
    ],
});

const emptySearchJson = JSON.stringify({ total: 0, items: [] });

describe('steam URL 构造', () => {
    it('搜索 URL 含 term 编码 / cc=US / l=english', () => {
        const url = buildSearchUrl('elden ring');
        expect(url).toContain('https://store.steampowered.com/api/storesearch/?term=');
        expect(url).toContain(encodeURIComponent('elden ring'));
        expect(url).toContain('cc=US');
        expect(url).toContain('l=english');
    });

    it('中文/特殊字符查询正确编码（不破坏 JSON 解析）', () => {
        const url = buildSearchUrl('空洞骑士:丝之歌');
        expect(url).toContain(encodeURIComponent('空洞骑士:丝之歌'));
    });
});

describe('parseSteamResults', () => {
    it('items → RawSteamItem（type/name/id 安全读取；metascore 归一为 number）', () => {
        const items = parseSteamResults(fullSearchJson);
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({ type: 'app', name: 'ELDEN RING', id: 1245620, metascore: 94 });
        expect(items[1]).toEqual({ type: 'app', name: 'The Witcher 3: Wild Hunt - Complete Edition', id: 292030, metascore: 93 });
    });

    it('异常条目过滤：sub/bundle 非 app、缺 id、缺 name 均丢弃', () => {
        expect(parseSteamResults(abnormalSearchJson)).toEqual([]);
    });

    it('空结果（total:0 / items 缺失或空）→ 空数组', () => {
        expect(parseSteamResults(emptySearchJson)).toEqual([]);
        expect(parseSteamResults('{}')).toEqual([]);
        expect(parseSteamResults(JSON.stringify({ items: [] }))).toEqual([]);
    });

    it('条目中偶发混入一条合法 app 时仅保留合法项', () => {
        const text = JSON.stringify({
            items: [
                { type: 'sub', name: 'bundle', id: 111 },
                { type: 'app', name: 'Hades II', id: 1145350 },
            ],
        });
        expect(parseSteamResults(text)).toEqual([{ type: 'app', name: 'Hades II', id: 1145350 }]);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔴 2026-11-08 搜索侧评分（用户报障「搜索获取评分不到」的后半）
// 真网实测（appid 570/1245620/1172470/730/2622380）：`metascore` 是**字符串**，
// 且**无收录时是空串 `""` 而不是缺键** —— 判据必须是「转换后 0<n<=100」，⛔ 不能只判 != null。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 2026-11-08 storesearch metascore（搜索侧评分）', () => {
    const one = (extra: Record<string, unknown>) =>
        parseSteamResults(JSON.stringify({ items: [{ type: 'app', name: 'X', id: 1, ...extra }] }));

    it('metascore 字符串 "94" → number 94', () => {
        expect(one({ metascore: '94' })).toEqual([{ type: 'app', name: 'X', id: 1, metascore: 94 }]);
    });

    it('🔴 空串 ""（无收录，CS2 730 的真实形态）⇒ 不给 metascore 键（⛔ 不编 0）', () => {
        const r = one({ metascore: '' })[0];
        expect(r.metascore).toBeUndefined();
        expect('metascore' in r).toBe(false);
    });

    it('空白串 / 缺键 / 非字符串 / 非数字 / 越界 一律 undefined', () => {
        for (const v of ['   ', undefined, 94, 'abc', '0', '101', '-5']) {
            expect(one({ metascore: v })[0].metascore).toBeUndefined();
        }
    });

    it('toGameResult：有 metascore ⇒ rating = metascore/10（10 分制）', () => {
        const r = toGameResult(parseSteamResults(fullSearchJson)[0]);
        expect(r.rating).toBe(9.4); // ELDEN RING metascore "94"
    });

    it('toGameResult：无 metascore ⇒ rating 键**不写**（界面按 rating != null 判空）', () => {
        const r = toGameResult({ type: 'app', name: 'Counter-Strike 2', id: 730 });
        expect(r.rating).toBeUndefined();
        expect('rating' in r).toBe(false);
    });
});

describe('toGameResult 字段映射', () => {
    it('完整条目逐字段映射（id=appid number / title=name / rating=metascore÷10 / cover=library_600x900 / source / sourceUrl）', () => {
        const r = toGameResult(parseSteamResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: 1245620, // appid：number（对齐 GameSearchResult.id）
            title: 'ELDEN RING',
            rating: 9.4, // 🔴 2026-11-08：metascore "94" ÷ 10（此前该字段根本没写，见下方 metascore 那组）
            cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/library_600x900.jpg', // 竖版封面拼图规则
            source: 'steam',
            sourceUrl: 'https://store.steampowered.com/app/1245620',
        });
    });

    it('搜索级不填 summary/developer/year（这三个走 `fetchDetail` 按需补）', () => {
        const r = toGameResult({ type: 'app', name: 'Hades II', id: 1145350 });
        expect(r.summary).toBeUndefined();
        expect(r.developer).toBeUndefined();
        expect(r.year).toBeUndefined();
    });

    it('🔴🔴 #623 `platform` 键**必须存在**（值可以是 undefined）—— 它是表单的类型判别键', () => {
        const r = toGameResult({ type: 'app', name: 'Hades II', id: 1145350 });
        // ⛔ 删掉这个键，就复现用户 2026-10-13 的报障：结果掉进**影视兜底分支** ⇒ 拿 appid 去打 TMDB 详情
        //    （`api.themoviedb.org/3/undefined/{appid}`）⇒ HTTP 404 ⇒ 整个 `pick` 抛错、**条目根本加不进去**。
        // ⚠️ TS 帮不上忙：`platform` 是**可选**属性 ⇒ `'platform' in r` 编译期永远合法、运行时才为 false。
        expect('platform' in r).toBe(true);
        expect(r.platform).toBeUndefined();
        // 对照组：豆瓣与 IGDB 的同类结果都带这个键（本函数曾是唯一漏的）
        expect('platform' in toGameResult({ type: 'app', name: 'x', id: 1 })).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #623 appdetails 详情（选中结果时按需拉取）
// fixture 按 store.steampowered.com/api/appdetails 真实响应结构手写（2026-10-13 实测 HTTP 200）
// ══════════════════════════════════════════════════════════════════════════════
const fullDetailJson = JSON.stringify({
    '570': {
        success: true,
        data: {
            type: 'game',
            name: 'Dota 2',
            developers: ['Valve'],
            publishers: ['Valve'],
            platforms: { windows: true, mac: true, linux: true },
            release_date: { coming_soon: false, date: 'Jul 9, 2013' },
            genres: [
                { id: '1', description: 'Action' },
                { id: '2', description: 'Strategy' },
                { id: '3', description: 'Free to Play' },
                { id: '4', description: 'MOBA' },
            ],
            short_description: 'Every day, millions of players worldwide enter battle as one of over a hundred Dota heroes.',
            detailed_description: '<strong>The most-played game on Steam.</strong><br>Every day, millions…',
            header_image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg',
            // 🔴 2026-10-25 补：评分 / 评价人数的两个来源字段（真实响应里就长这样，Portal 2 实测确认）
            metacritic: { score: 90, url: 'https://www.metacritic.com/game/pc/dota-2' },
            recommendations: { total: 1234567 },
        },
    },
});

describe('🔴 #623 buildDetailUrl', () => {
    it('含 appids + 与搜索**同一组** cc/l 参数（两处口径不同会让详情的年/题材与搜索结果对不上）', () => {
        const url = buildDetailUrl(1245620);
        expect(url).toContain('https://store.steampowered.com/api/appdetails?appids=1245620');
        expect(url).toContain('cc=US');
        expect(url).toContain('l=english');
    });
});

describe('🔴 #623 parseAppDetails', () => {
    it('逐字段映射：platform 拼组 / developer 取首个 / year 从 `Jul 9, 2013` 取 / genres 截 3 / summary 取 short', () => {
        const d = parseAppDetails(fullDetailJson, 570);
        expect(d).not.toBeNull();
        expect(d!.platform).toBe('Windows / macOS / Linux');
        expect(d!.developer).toBe('Valve');
        expect(d!.year).toBe(2013);
        // 🔴 前 3 个（与豆瓣回填同一截断口径）；第 4 个 `MOBA` 丢弃
        expect(d!.genres).toEqual(['Action', 'Strategy', 'Free to Play']);
        // ⚠️ 取 `short_description`（纯文本），⛔ 不是 `detailed_description`（HTML 长文）
        expect(d!.summary?.startsWith('Every day')).toBe(true);
    });

    it('🔴 只取**表单里真有框**的字段：发布商不映射（游戏表单没有「出品方」框 ⇒ 取了就是幽灵字段）', () => {
        const d = parseAppDetails(fullDetailJson, 570) as Record<string, unknown>;
        expect('publisher' in d).toBe(false);
        expect('cover' in d).toBe(false);
    });

    it('🔴 `success !== true` ⇒ null（下架 / 区域不可见 / 非游戏；⛔ 不是空对象 —— 那会让上层以为拉到了详情）', () => {
        const fail = JSON.stringify({ '999999999': { success: false } });
        expect(parseAppDetails(fail, 999999999)).toBeNull();
    });

    it('响应里没有该 appid 的键 ⇒ null（不炸）', () => {
        expect(parseAppDetails(fullDetailJson, 123456)).toBeNull();
    });

    it('平台全 false / 缺 platforms ⇒ platform undefined（⛔ 不返回空串）', () => {
        const none = JSON.stringify({
            '1': { success: true, data: { platforms: { windows: false, mac: false, linux: false } } },
        });
        expect(parseAppDetails(none, 1)?.platform).toBeUndefined();
        const missing = JSON.stringify({ '2': { success: true, data: {} } });
        expect(parseAppDetails(missing, 2)?.platform).toBeUndefined();
    });

    it('发行日期形态很杂：`2024` / `Q1 2025` 取年；`Coming soon` 无年 ⇒ undefined', () => {
        const of = (date: string) =>
            parseAppDetails(JSON.stringify({ '7': { success: true, data: { release_date: { date } } } }), 7)?.year;
        expect(of('2024')).toBe(2024);
        expect(of('Q1 2025')).toBe(2025);
        expect(of('Coming soon')).toBeUndefined();
        expect(of('')).toBeUndefined();
    });

    it('genres 缺失 / 空 ⇒ undefined；全空 data ⇒ 各字段 undefined（⛔ 不炸）', () => {
        const bare = JSON.stringify({ '3': { success: true, data: { genres: [] } } });
        const d = parseAppDetails(bare, 3);
        expect(d?.genres).toBeUndefined();
        expect(d?.developer).toBeUndefined();
        expect(d?.summary).toBeUndefined();
    });

    it('genres 里混入非字符串 description 时过滤（⛔ 不许出现 "undefined" 字面量）', () => {
        const messy = JSON.stringify({
            '4': { success: true, data: { genres: [{ description: 'Action' }, {}, { description: 42 }] } },
        });
        expect(parseAppDetails(messy, 4)?.genres).toEqual(['Action']);
    });
});

// 🔴 2026-10-25 用户报障「拉取到的怎么没有 steam 的评分和评价人数」——这两条的守卫。
//    取法：评分 = metacritic.score ÷10（10 分制）、评价人数 = recommendations.total。
//    ⚠️ 这里锁的是**用户会看见的数字**，不是「解析没抛异常」——避免以后有人把 ÷10 写成 ÷100 还能过。
describe('🔴 2026-10-25 parseAppDetails 评分与评价人数', () => {
    const of = (data: Record<string, unknown>) =>
        parseAppDetails(JSON.stringify({ '9': { success: true, data } }), 9);

    it('metacritic.score 0-100 → 10 分制一位小数；recommendations.total → 评价人数', () => {
        const d = of({ metacritic: { score: 95 }, recommendations: { total: 392382 } });
        expect(d!.rating).toBe(9.5);
        expect(d!.ratingCount).toBe(392382);
    });

    it('metacritic 缺失 / score 为 0 / 越界 ⇒ rating undefined（⛔ 不编 0 分）', () => {
        expect(of({})?.rating).toBeUndefined();
        expect(of({ metacritic: {} })?.rating).toBeUndefined();
        // Steam 用 score:0 表示「没收录」，÷10 会变成刺眼的 0 分
        expect(of({ metacritic: { score: 0 } })?.rating).toBeUndefined();
        expect(of({ metacritic: { score: 101 } })?.rating).toBeUndefined();
        expect(of({ metacritic: { score: -5 } })?.rating).toBeUndefined();
    });

    it('recommendations 缺失 / total 为 0 ⇒ ratingCount undefined', () => {
        expect(of({})?.ratingCount).toBeUndefined();
        expect(of({ recommendations: {} })?.ratingCount).toBeUndefined();
        expect(of({ recommendations: { total: 0 } })?.ratingCount).toBeUndefined();
    });

    it('🔴 评分与评价人数**不同源**：即使只有其中一个，另一个也不许被凑数填上', () => {
        const onlyRating = of({ metacritic: { score: 88 } });
        expect(onlyRating!.rating).toBe(8.8);
        expect(onlyRating!.ratingCount).toBeUndefined(); // ⛔ 不许拿 metacritic 的分去凑评价人数
        const onlyCount = of({ recommendations: { total: 500 } });
        expect(onlyCount!.ratingCount).toBe(500);
        expect(onlyCount!.rating).toBeUndefined(); // ⛔ 不许拿评价数去凑评分
    });
});

describe('🔴 #623 SteamClient.fetchDetail', () => {
    it('用注入的 http 拉详情并按 appid 解析', async () => {
        const calls: string[] = [];
        const client = new SteamClient(async (url) => {
            calls.push(url);
            return fullDetailJson;
        });
        const d = await client.fetchDetail(570);
        expect(d?.developer).toBe('Valve');
        expect(calls[0]).toContain('appids=570');
    });

    it('success=false ⇒ null（调用方静默保留搜索级字段，⛔ 不抛错）', async () => {
        const client = new SteamClient(async () => JSON.stringify({ '570': { success: false } }));
        await expect(client.fetchDetail(570)).resolves.toBeNull();
    });
});

// 🔴 2026-10-25 用户报障「有评价人数没评分」⇒ 评分口径从 Metacritic 换算改为 **Steam 好评率百分比**。
//    这一段锁的是「谁的数说了算」：histogram 的百分比与人数必须**同源**，否则界面上会出现
//    「97% 好评 · 但人数只有 556」这种自相矛盾的组合（两个不同统计口径混搭）。
describe('🔴 2026-10-25 fetchDetail 合并好评率（histogram）', () => {
    /** appdetails 返回体（含 Metacritic 与 recommendations 兜底值） */
    const appdetails = JSON.stringify({
        '570': {
            success: true,
            data: {
                developers: ['Valve'],
                metacritic: { score: 90 },
                recommendations: { total: 556 },
                platforms: { windows: true },
            },
        },
    });
    /** appreviewhistogram 返回体：周汇总，累加 = 好评率与总测评数 */
    const histogram = JSON.stringify({
        success: true,
        results: {
            rollups: [
                { recommendations_up: 900, recommendations_down: 0 },
                { recommendations_up: 100, recommendations_down: 0 },
            ],
        },
    });

    it('histogram 的 percent 与 total 一起覆盖 appdetails 的兜底值（同源）', async () => {
        const client = new SteamClient(async (url) =>
            url.includes('appreviewhistogram') ? histogram : appdetails,
        );
        const d = await client.fetchDetail(570);
        // 1000 条里 1000 条好评 ⇒ 100%；同时 ratingCount 被改成 1000（⛔ 不再是 recommendations 的 556）
        expect(d?.reviewPercent).toBe(100);
        expect(d?.ratingCount).toBe(1000);
        // Metacritic 换算的 10 分制值仍在（`rating` 是个人/媒体分，与好评率不是一回事）
        expect(d?.rating).toBe(9);
    });

    it('🔴 百分比与人数必须同源：不许出现「histogram 的 percent + recommendations 的 total」', async () => {
        const client = new SteamClient(async (url) =>
            url.includes('appreviewhistogram') ? histogram : appdetails,
        );
        const d = await client.fetchDetail(570);
        expect(d?.ratingCount).not.toBe(556);
    });

    it('histogram 挂了 ⇒ 详情照常返回（降级到 appdetails 的兜底值，⛔ 不整条作废）', async () => {
        const client = new SteamClient(async (url) => {
            if (url.includes('appreviewhistogram')) throw new Error('network down');
            return appdetails;
        });
        const d = await client.fetchDetail(570);
        expect(d?.developer).toBe('Valve');
        expect(d?.reviewPercent).toBeUndefined();
        expect(d?.ratingCount).toBe(556); // 退回 recommendations.total
        expect(d?.rating).toBe(9);
    });

    it('histogram 返回 success=false ⇒ 不写 reviewPercent、不写 total', async () => {
        const client = new SteamClient(async (url) =>
            url.includes('appreviewhistogram') ? JSON.stringify({ success: false }) : appdetails,
        );
        const d = await client.fetchDetail(570);
        expect(d?.reviewPercent).toBeUndefined();
        expect(d?.ratingCount).toBe(556); // 兜底值仍在
    });

    it('两类请求各只发一次（⛔ 别为了拿名字或人数重复请求）', async () => {
        const urls: string[] = [];
        const client = new SteamClient(async (url) => {
            urls.push(url);
            return url.includes('appreviewhistogram') ? histogram : appdetails;
        });
        await client.fetchDetail(570);
        expect(urls.filter((u) => u.includes('appdetails'))).toHaveLength(1);
        expect(urls.filter((u) => u.includes('appreviewhistogram'))).toHaveLength(1);
    });
});

describe('🔴 2026-11-08 parseReviewHistogram success 形态（线上真实返回 1，不是 true）', () => {
    // ⚠️ 这一组是「回归锁」：用户 2026-11-08 报障「steam 同步和搜索获取评分不到」的**主因**
    //    就是这里 —— 实测 620 / 292030 / 730 / 570 / 1091500 五个 appid 全部返回
    //    `{"success":1,"results":{...}}`（typeof number），而旧判据 `success !== true` 每次都判假，
    //    整个 histogram 被当失败丢掉 ⇒ reviewPercent 永远 undefined。
    //    ⛔ 上面的老用例用 `success: true` 造 mock，把真实形态整个漏掉了 —— 测试跟着实现一起错。
    const rollups = [{ recommendations_up: 86, recommendations_down: 14 }];

    it('🔴 success 是数字 1 ⇒ 照常解析出 86%（线上就是这一种）', () => {
        const r = parseReviewHistogram(JSON.stringify({ success: 1, results: { rollups } }));
        expect(r.percent).toBe(86);
        expect(r.total).toBe(100);
    });

    it('success 是布尔 true ⇒ 也要能解析（两种形态都得认）', () => {
        const r = parseReviewHistogram(JSON.stringify({ success: true, results: { rollups } }));
        expect(r.percent).toBe(86);
    });

    it('🔴 success 缺失 / 0 / false ⇒ 空对象（失败响应不许当成功）', () => {
        const body = (s: unknown) => JSON.stringify({ success: s, results: { rollups } });
        expect(parseReviewHistogram(body(undefined))).toEqual({});
        expect(parseReviewHistogram(body(0))).toEqual({});
        expect(parseReviewHistogram(body(false))).toEqual({});
    });

    it('🔴 字符串 "0" / "false" 也算失败（⛔ 别退回 `if (!r.success)` 那种真值判断）', () => {
        const body = (s: unknown) => JSON.stringify({ success: s, results: { rollups } });
        expect(parseReviewHistogram(body('0'))).toEqual({});
        expect(parseReviewHistogram(body('false'))).toEqual({});
    });

    it('🔴 端到端：success=1 的响应喂给 fetchDetail ⇒ reviewPercent 与 ratingCount 都落地', async () => {
        const appdetails = JSON.stringify({
            '730': { success: true, data: { developers: ['Valve'], recommendations: { total: 5343170 } } },
        });
        // 730 (CS2) 实测没有 metacritic 字段 —— 正是「有评价人数、没评分」那一类
        const histogram = JSON.stringify({ success: 1, results: { rollups } });
        const client = new SteamClient(async (url) =>
            url.includes('appreviewhistogram') ? histogram : appdetails,
        );
        const d = await client.fetchDetail(730);
        expect(d?.reviewPercent).toBe(86);
        expect(d?.ratingCount).toBe(100); // histogram 的 total 覆盖 recommendations 的 5343170
        expect(d?.rating).toBeUndefined(); // 没有 Metacritic 收录 ⇒ 不编造 0
    });
});

describe('🔴 2026-10-25 parseReviewHistogram 好评率口径', () => {

    const hist = (rollups: unknown[]) => JSON.stringify({ success: true, results: { rollups } });

    it('全部好评 ⇒ 100%（且 total 是真数，不省略）', () => {
        const r = parseReviewHistogram(hist([{ recommendations_up: 10, recommendations_down: 0 }]));
        expect(r.percent).toBe(100);
        expect(r.total).toBe(10);
    });

    it('🔴 全差评 ⇒ percent 必须是 0（真实结论），而不是「没有百分比」', () => {
        // ⚠️ 这条曾是反向口径（宁缺勿假），2026-10-25 改判：0% 是有意义的结论。
        //    同时它承担收敛职责 —— 补详情判据是「有 total 没 percent 就再拉」，
        //    若全差评不给 0，这类游戏会每次开机重拉一遍、永不能收敛。
        const r = parseReviewHistogram(hist([{ recommendations_up: 0, recommendations_down: 7 }]));
        expect(r.percent).toBe(0);
        expect(r.total).toBe(7);
    });

    it('没人评过 ⇒ 空对象（⛔ 不是 0%）', () => {
        expect(parseReviewHistogram(hist([]))).toEqual({});
        expect(parseReviewHistogram(hist([{ recommendations_up: 0, recommendations_down: 0 }]))).toEqual({});
    });

    it('success=false / 坏 JSON ⇒ 空对象，不抛错', () => {
        expect(parseReviewHistogram(JSON.stringify({ success: false }))).toEqual({});
        expect(parseReviewHistogram('not json')).toEqual({});
        expect(parseReviewHistogram('')).toEqual({});
    });

    it('百分比取整（四舍五入），多周汇总累加', () => {
        // 2 好评 1 差评 = 66.67% ⇒ 67%
        expect(parseReviewHistogram(hist([{ recommendations_up: 2, recommendations_down: 1 }])).percent).toBe(67);
        // 两周累加：3 好 0 差 与 0 好 1 差 ⇒ 75%
        const r = parseReviewHistogram(
            hist([
                { recommendations_up: 3, recommendations_down: 0 },
                { recommendations_up: 0, recommendations_down: 1 },
            ]),
        );
        expect(r.percent).toBe(75);
        expect(r.total).toBe(4);
    });

    it('脏 rollups（非数组 / 元素非对象 / 字段非数字）不炸', () => {
        expect(parseReviewHistogram(JSON.stringify({ success: true, results: { rollups: 'x' } }))).toEqual({});
        expect(
            parseReviewHistogram(hist([null, 'x', { recommendations_up: '5', recommendations_down: 2 }])).total,
        ).toBe(2);
    });
});
describe('SteamClient 注入 http', () => {
    it('search 用注入的 http 拉取并返回 toGameResult 结果', async () => {
        const calls: string[] = [];
        const client = new SteamClient(async (url) => {
            calls.push(url);
            return fullSearchJson;
        });
        const results = await client.search('elden ring');
        expect(results).toHaveLength(2);
        expect(results[0].source).toBe('steam');
        expect(results[0].sourceUrl).toBe('https://store.steampowered.com/app/1245620');
        expect(calls[0]).toContain(encodeURIComponent('elden ring'));
    });
});
