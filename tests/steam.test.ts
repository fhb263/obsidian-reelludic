import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    buildDetailUrl,
    parseSteamResults,
    parseAppDetails,
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
    it('items → RawSteamItem（type/name/id 安全读取；多余字段忽略不依赖）', () => {
        const items = parseSteamResults(fullSearchJson);
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({ type: 'app', name: 'ELDEN RING', id: 1245620 });
        expect(items[1]).toEqual({ type: 'app', name: 'The Witcher 3: Wild Hunt - Complete Edition', id: 292030 });
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

describe('toGameResult 字段映射', () => {
    it('完整条目逐字段映射（id=appid number / title=name / cover=library_600x900 / source=steam / sourceUrl=app/{id}）', () => {
        const r = toGameResult(parseSteamResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: 1245620, // appid：number（对齐 GameSearchResult.id）
            title: 'ELDEN RING',
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
