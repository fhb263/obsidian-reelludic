// #639 ⑥ Steam Web API 服务层测试（HTTP 口注入，不发真请求）。
import { describe, it, expect } from 'vitest';
import { ownedGamesUrl, wishlistUrl, fetchOwnedGames, fetchWishlist, testSteamAuth } from 'services/steamWebApi';

const KEY = 'A'.repeat(32);
const ID = '76561197960287930';

describe('#639 URL 构造', () => {
    it('库 URL：带 key/steamid，且**必须** include_appinfo（不带就只有 appid，落不了条目）', () => {
        const u = ownedGamesUrl(KEY, ID);
        expect(u).toContain('IPlayerService/GetOwnedGames');
        expect(u).toContain(`key=${KEY}`);
        expect(u).toContain(`steamid=${ID}`);
        expect(u).toContain('include_appinfo=1');
        // 免费游戏也算拥有（Dota 2 那类必须在库里）
        expect(u).toContain('include_played_free_games=1');
    });

    it('🔴 愿望单 URL **不带 key**（实测该端点免 key；带上也不会错，但会让「没配 key」时误以为不可用）', () => {
        const u = wishlistUrl(ID);
        expect(u).toContain('IWishlistService/GetWishlist');
        expect(u).toContain(`steamid=${ID}`);
        expect(u).not.toContain('key=');
    });

    it('两者都在 **api.steampowered.com**（⛔ 不是 store.steampowered.com —— 那是商店那套）', () => {
        expect(ownedGamesUrl(KEY, ID)).toContain('https://api.steampowered.com/');
        expect(wishlistUrl(ID)).toContain('https://api.steampowered.com/');
    });
});

describe('#639 fetchOwnedGames：三态', () => {
    it('正常 JSON ⇒ ok', async () => {
        const get = async () => JSON.stringify({ response: { games: [{ appid: 570, name: 'Dota 2', playtime_forever: 60 }] } });
        const r = await fetchOwnedGames(get, KEY, ID);
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') expect(r.items[0].name).toBe('Dota 2');
    });

    it('🔴 **401 的 HTML 响应**折成一句人话（Steam 的 401 是 HTML ⇒ 直接 JSON.parse 会得到「不是 JSON」的误导文案）', async () => {
        const get = async () =>
            '<html><head><title>Unauthorized</title></head><body><h1>Unauthorized</h1>Access is denied. Retrying will not help. Please verify your <pre>key=</pre> parameter.</body></html>';
        const r = await fetchOwnedGames(get, KEY, ID);
        expect(r.kind).toBe('error');
        if (r.kind === 'error') {
            expect(r.message).toContain('API Key 无效');
            expect(r.message).not.toContain('不是 JSON'); // ⛔ 别把 401 说成「解析失败」
        }
    });

    it('`{"response":{}}` ⇒ private（资料没公开）', async () => {
        const r = await fetchOwnedGames(async () => '{"response":{}}', KEY, ID);
        expect(r.kind).toBe('private');
    });

    it('网络抛错 / 非 JSON ⇒ error（带原因）', async () => {
        const r1 = await fetchOwnedGames(async () => { throw new Error('连不上'); }, KEY, ID);
        expect(r1.kind).toBe('error');
        if (r1.kind === 'error') expect(r1.message).toContain('连不上');

        const r2 = await fetchOwnedGames(async () => 'not json', KEY, ID);
        expect(r2.kind).toBe('error');
        if (r2.kind === 'error') expect(r2.message).toContain('不是 JSON');
    });
});

describe('#639 fetchWishlist：免 key 也能跑', () => {
    it('正常 ⇒ ok；空 response ⇒ private', async () => {
        const ok = await fetchWishlist(async () => '{"response":{"items":[{"appid":1}]}}', ID);
        expect(ok.kind).toBe('ok');

        const priv = await fetchWishlist(async () => '{"response":{}}', ID);
        expect(priv.kind).toBe('private');
    });
});

describe('#639 testSteamAuth：凭据体检', () => {
    it('读得到库 ⇒ ok + 条数', async () => {
        const r = await testSteamAuth(async () => JSON.stringify({ response: { games: [{ appid: 1, name: 'A' }, { appid: 2, name: 'B' }] } }), KEY, ID);
        expect(r.ok).toBe(true);
        expect(r.message).toContain('2 个游戏');
    });

    it('🔴 资料私密 ⇒ 明说「设为公开」，⛔ **不说** key 无效（key 其实是对的）', async () => {
        const r = await testSteamAuth(async () => '{"response":{}}', KEY, ID);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('公开');
        expect(r.message).not.toContain('API Key 无效');
    });

    it('key 无效 ⇒ 报 key', async () => {
        const r = await testSteamAuth(async () => '<html>Access is denied</html>', KEY, ID);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('API Key 无效');
    });
});
