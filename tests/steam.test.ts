import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseSteamResults,
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

    it('搜索级不填 summary/developer（深度字段 B3 回填范围外，undefined 不出现）', () => {
        const r = toGameResult({ type: 'app', name: 'Hades II', id: 1145350 });
        expect(r.summary).toBeUndefined();
        expect(r.developer).toBeUndefined();
        expect(r.platform).toBeUndefined();
        expect(r.year).toBeUndefined();
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
