// IGDB 数据源纯逻辑测试（TDD：接入 IGDB 游戏源）
// 端点为 Twitch OAuth token + api.igdb.com/v4/games（Apicalypse body），HTTP 注入可 mock。
// fixture 参照删除前 igdb.ts 真实响应结构（git ada6572~1 找回校准），字段对齐当前 resultTypes.GameSearchResult。
import { describe, it, expect } from 'vitest';
import {
    buildTokenUrl,
    buildGamesBody,
    parseToken,
    parseGames,
    IgdbClient,
} from 'services/igdb';

describe('IGDB URL / body 构造', () => {
    it('parseToken 提取 token 与有效期', () => {
        const t = parseToken('{"access_token":"tok123","expires_in":5162378,"token_type":"bearer"}');
        expect(t.access_token).toBe('tok123');
        expect(t.expires_in).toBeGreaterThan(0);
    });

    it('buildTokenUrl 携带 client_id/secret/grant_type（encodeURIComponent 转义）', () => {
        const url = buildTokenUrl('cid a&b', 'csec');
        expect(url).toContain(`client_id=${encodeURIComponent('cid a&b')}`);
        expect(url).toContain('client_secret=csec');
        expect(url).toContain('grant_type=client_credentials');
    });

    it('buildGamesBody 转义引号并包含字段与 limit', () => {
        const body = buildGamesBody('Witcher "3"', 5);
        expect(body).toContain('search "Witcher \\"3\\"";');
        expect(body).toContain('fields name, first_release_date');
        expect(body).toContain('limit 5;');
    });
});

describe('parseGames 解析', () => {
    it('解析 games 数组：平台/开发商/年份/封面/评分 10 分制/类型/来源直达', () => {
        const text = JSON.stringify([
            {
                id: 1942,
                name: 'The Witcher 3',
                first_release_date: 1443484800,
                cover: { image_id: 'cov123' },
                platforms: [{ name: 'PC' }, { name: 'PlayStation 4' }],
                involved_companies: [{ company: { name: 'CD Projekt Red' } }],
                summary: 'Open world RPG',
                aggregated_rating: 95,
                genres: [{ name: 'RPG' }, { name: 'Action' }],
            },
        ]);
        const r = parseGames(text);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            id: 1942,
            title: 'The Witcher 3',
            platform: 'PC',
            developer: 'CD Projekt Red',
            genres: ['RPG', 'Action'],
            year: 2015,
            cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cov123.jpg',
            summary: 'Open world RPG',
            rating: 9.5, // aggregated_rating 100 分制 → 10 分制
            source: 'igdb',
        });
        expect(r[0].sourceUrl).toBe('https://www.igdb.com/games/1942');
    });

    it('缺 aggregated_rating 时回退 rating（仍 10 分制）', () => {
        const r = parseGames('[{"id":1,"name":"X","rating":80}]');
        expect(r[0].rating).toBe(8);
    });

    it('无评分字段 → rating undefined；无 id/无标题过滤', () => {
        expect(parseGames('[{"id":1,"name":"NoScore"}]')[0].rating).toBeUndefined();
        expect(parseGames('[{"id":1}]')).toEqual([]);
        expect(parseGames('[]')).toEqual([]);
        expect(parseGames('[{"name":"NoId"}]')).toEqual([]);
    });

    it('无 platforms/companies/cover/summary 时对应字段 undefined（缺字段安全）', () => {
        const r = parseGames('[{"id":5,"name":"Minimal"}]');
        expect(r[0].platform).toBeUndefined();
        expect(r[0].developer).toBeUndefined();
        expect(r[0].cover).toBeUndefined();
        expect(r[0].year).toBeUndefined();
        expect(r[0].summary).toBeUndefined();
        expect(r[0]).toHaveLength !== undefined;
        expect(r).toHaveLength(1);
    });
});

describe('IgdbClient 注入 http', () => {
    const tokenText = '{"access_token":"tok123","expires_in":5000,"token_type":"bearer"}';

    it('search：先取 token 再 POST games，返回解析结果', async () => {
        const posts: { body: string; headers?: Record<string, string> }[] = [];
        const client = new IgdbClient(
            'cid',
            'csec',
            async () => tokenText,
            async (_url, body, headers) => {
                posts.push({ body, headers });
                return '[{"id":1942,"name":"The Witcher 3","cover":{"image_id":"c1"}}]';
            },
        );
        const results = await client.search('witcher');
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('igdb');
        expect(posts).toHaveLength(1);
        expect(posts[0].headers).toMatchObject({ 'Client-ID': 'cid', Authorization: 'Bearer tok123' });
    });

    it('token 缓存：同 client 第二次 search 不重复取 token', async () => {
        let tokenCalls = 0;
        const client = new IgdbClient(
            'cid',
            'csec',
            async () => {
                tokenCalls++;
                return tokenText;
            },
            async () => '[]',
        );
        await client.search('a');
        await client.search('b');
        expect(tokenCalls).toBe(1); // 缓存命中，未二次换 token
    });

    it('token 为空时明确报错', async () => {
        const client = new IgdbClient('cid', 'csec', async () => '{"access_token":"","expires_in":0}', async () => '[]');
        await expect(client.search('x')).rejects.toThrow('未获取到 access_token');
    });

    it('HTTP 失败（token 获取抛错）时向上抛', async () => {
        const client = new IgdbClient(
            'bad',
            'bad',
            async () => {
                throw new Error('HTTP 400');
            },
            async () => {
                throw new Error('should not be called');
            },
        );
        await expect(client.search('x')).rejects.toThrow('HTTP 400');
    });
});
