// Steam **Web API** 服务层（#639 ⑥）—— 库 / 愿望单 / 玩家摘要三件事的「发请求 + 交给纯模块解析」。
//
// 🔴 与 `services/steam.ts`（**storefront API**：`store.steampowered.com/api/…`，免 key 的搜索与详情）
//    **是两个不同的域**，别合并：
//      · storefront（商店）：搜游戏、取详情 —— 免 key，token 无；
//      · Web API（`api.steampowered.com`）：读**用户自己的**库 / 愿望单 / 资料 —— **要 api key**。
//    ⛔ 混在一起会让「没配 key」时连搜索都以为坏了。
//
// 🔴 **实测**（`_probe_639_steam.cjs`，2026-10-15 本机真实请求）：
//   · `IPlayerService/GetOwnedGames/v1` 无 key ⇒ **401**，响应体逐字要求 `key=` 参数
//     ⇒ 库与游玩时长**必须**有 API Key；
//   · `IWishlistService/GetWishlist/v1?steamid=` ⇒ **免 key**，但资料非公开时回 `{"response":{}}`
//     （HTTP 仍 200）⇒ 解析层用 `kind:'private'` 把「空」与「失败」分开（见 `pure/steamSync`）。
//
// ⚠️ HTTP 口**注入**（与 `services/steam.ts` 同款）：纯逻辑可 mock，不依赖 obsidian / 网络。
import {
    STEAM_API_BASE,
    parseOwnedGames,
    parseWishlist,
    type SteamOwnedGame,
    type SteamParse,
    type SteamWishlistItem,
} from 'pure/steamSync';

/** 发起 GET 并返回文本（由宿主注入；失败应抛出，本层折成 `error` 三态） */
export type WebApiGet = (url: string) => Promise<string>;

/** 库 URL（`include_appinfo` 才带名字与图标 —— 不带的话只有 appid，没法落条目） */
export function ownedGamesUrl(key: string, steamId: string): string {
    const p = new URLSearchParams({
        key,
        steamid: steamId,
        include_appinfo: '1',
        // 免费游戏也算「拥有」：本插件统计的是「玩过什么」，Dota 2 那类必须在库里
        include_played_free_games: '1',
        format: 'json',
    });
    return `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?${p.toString()}`;
}

/** 愿望单 URL（**免 key** —— 只带 steamid；这也是为什么它能在没配 key 时单独用） */
export function wishlistUrl(steamId: string): string {
    const p = new URLSearchParams({ steamid: steamId, format: 'json' });
    return `${STEAM_API_BASE}/IWishlistService/GetWishlist/v1/?${p.toString()}`;
}

/** 拉取**自有游戏库**（含总时长）。凭据缺失时由调用方先拦，本层只管请求与解析。 */
export async function fetchOwnedGames(
    get: WebApiGet,
    key: string,
    steamId: string,
): Promise<SteamParse<SteamOwnedGame>> {
    let text: string;
    try {
        text = await get(ownedGamesUrl(key, steamId));
    } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    // 🔴 401 会被 `requestUrl` 折成带状态码的错误文本（宿主那份 HTTP 口负责），
    //    但**注入的 get 也可能直接把响应体递回来** ⇒ 这里也认一次 401 的文案形态，
    //    否则用户拿到的是一整页 HTML（Steam 的 401 是 HTML，不是 JSON）。
    if (/Unauthorized|Access is denied/i.test(text)) {
        return { kind: 'error', message: 'Steam API Key 无效（HTTP 401）' };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { kind: 'error', message: '返回内容不是 JSON（可能被网络中间层拦截）' };
    }
    return parseOwnedGames(raw);
}

/** 拉取**愿望单**（免 key；资料非公开 ⇒ `private`） */
export async function fetchWishlist(
    get: WebApiGet,
    steamId: string,
): Promise<SteamParse<SteamWishlistItem>> {
    let text: string;
    try {
        text = await get(wishlistUrl(steamId));
    } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { kind: 'error', message: '返回内容不是 JSON（可能被网络中间层拦截）' };
    }
    return parseWishlist(raw);
}

/**
 * 「测试连接」：用**库**接口验凭据（它是唯一强制要 key 的，验得过说明 key 有效；
 * 愿望单接口免 key，验不出凭据好坏）。
 * 返回一句面向用户的话（设置页那行小字直接显示）。
 */
export async function testSteamAuth(
    get: WebApiGet,
    key: string,
    steamId: string,
): Promise<{ ok: boolean; message: string }> {
    const r = await fetchOwnedGames(get, key, steamId);
    if (r.kind === 'ok') return { ok: true, message: `连接成功：读到 ${r.items.length} 个游戏` };
    if (r.kind === 'private') {
        // 🔴 实测：key 对、但「游戏详情」设为私密时就是这个形态 ⇒ 如实说，⛔ 别说成「key 无效」
        return { ok: false, message: '读不到游戏库 — 请把 Steam「个人资料」与「游戏详情」设为公开' };
    }
    return { ok: false, message: r.message };
}
