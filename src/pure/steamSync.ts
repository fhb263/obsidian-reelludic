// Steam 集成的**纯逻辑**（#639 ⑥，用户 2026-10-15）—— 零 `obsidian` / 零网络 / 零 DOM，可单测。
//
// 用户原话：「参考 https://github.com/CMorooney/obsidian-game-search-plugin 实现游戏类型新增条目的增强，
// 如在设置页-元数据源凭据-新增 steam 凭据入口，包括 **Steam API Key**、SteamID，提示 Steam 个人资料、
// 愿望单必须设置为**公开可见**，否则同步失败，在 steam 凭据下拉处新增同步 steam 的按钮
//（同步 Steam 库与愿望单）并且支持同步游玩时长（插件启动时同步并增量游玩时长）」。
//
// 🔴 **实测先行**（`_probe_639_steam.cjs` / `_probe_639_steam2.cjs`，2026-10-15，本机真实请求）：
//   · `IPlayerService/GetOwnedGames/v1`（库 + 时长）**无 key 直接 401**
//     （响应体逐字："Access is denied… Please verify your `key=` parameter"）
//     ⇒ **库与游玩时长同步离不开 Steam Web API Key**（这一点决定了凭据必须是两个字段）；
//   · `IWishlistService/GetWishlist/v1?steamid=…`（愿望单）**只需 steamid、免 key**，
//     但**资料非公开时返回 `{"response":{}}`（HTTP 仍是 200）**
//     ⇒ 🔴 **「空」与「失败」必须分开说** —— 这条是本模块最重要的判据：
//       把「愿望单没公开」报成「同步成功但 0 条」会让用户永远找不到原因（参考仓 README 专门写了
//       「Ensure your Steam Privacy Settings have your wishlist set to `Public`」）。
//
// 三项追问裁定：⑴ 凭据 = **API Key + SteamID 两个字段**（按用户要求）；
//   ⑵ 同步按钮放在**凭据行的折叠体内**（与微信读书同步按钮同位置、同款样式）；
//   ⑶ 游玩时长 = **直接用 Steam 的总时长覆盖**（`playtime_forever` 本来就是总量，
//      ⛔ 不做「增量累加」—— 那会翻倍：Steam 每轮都给你累计值）。

/** Steam Web API 基址（与现有 `services/steam.ts` 的商店端点区分：这是 **Web API**，不是 storefront API） */
export const STEAM_API_BASE = 'https://api.steampowered.com';

/** 一次同步最多拉多少条（防用户库里几千个游戏把库撑爆；超出时如实报「已截断」） */
export const STEAM_SYNC_LIMIT = 2000;

/**
 * SteamID 归一：接受 **17 位**数字串（`76561198…`）。
 * 🔴 只认 `SteamID64`：另两种形态（`STEAM_0:1:…` / 自定义 vanity 名）都要**先解析**才能用，
 *    而那需要额外的接口调用 —— 本批**不做**，但**必须明确报错**而不是拿它去请求（会静默 0 条）。
 * ⚠️ 别把「SteamID**64**」这个叫法读成「64 位」：它是 64 **bit** 的 ID，十进制写出来就是
 *    **17 位数字**。2026-10-25 用户报障正是这个混淆（「占位符怎么说明是64位，改成17位」）。
 */
export function normalizeSteamId(raw: unknown): string | null {
    const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!/^\d{17}$/.test(s)) return null;
    return s;
}

/** SteamID 输入校验的**一句人话**（`null` = 没问题）。⛔ 不写「格式错误」这种没有下一步的提示 */
export function steamIdIssue(raw: unknown): string | null {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '未填写 SteamID';
    if (/^STEAM_\d+:\d+:\d+$/i.test(s)) {
        return '这里要填 17 位数字的 SteamID（形如 76561198…），不是 STEAM_0:1:… 那种写法';
    }
    if (/^https?:\/\//i.test(s)) return '这里要填 17 位数字的 SteamID，不是个人资料网址';
    if (!/^\d+$/.test(s)) return '这里要填 17 位数字的 SteamID（自定义昵称不行）';
    if (s.length !== 17) return `SteamID 应为 17 位数字，当前 ${s.length} 位`;
    return null;
}

/** Steam Web API Key 的粗校验（32 位十六进制；`null` = 看着没问题） */
export function steamKeyIssue(raw: unknown): string | null {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '未填写 Steam API Key';
    if (!/^[0-9A-Fa-f]{32}$/.test(s)) return 'Steam API Key 是 32 位十六进制字符，请从 steamcommunity.com/dev/apikey 复制';
    return null;
}

/** 自有游戏（库）里的一条 —— 只保留本插件要用的字段 */
export interface SteamOwnedGame {
    appid: number;
    name: string;
    /** 总游玩时长（**分钟**；Steam 原样给的就是分钟） */
    playtimeForever: number;
    /** 最近两周时长（分钟；没有则省略） */
    playtime2Weeks?: number;
    /** 封面（`img_icon_url` 拼出的**小图标**地址；没有则不落键） */
    iconUrl?: string;
}

/** 愿望单里的一条 */
export interface SteamWishlistItem {
    appid: number;
    /** 加愿望单的时间戳（秒；Steam 给 `date_added`，没有则不落键） */
    dateAdded?: number;
    /** 优先级（Steam 的排序权重；没有则不落键） */
    priority?: number;
}

/** 解析结果的三态（🔴 「空」与「失败」必须分开 —— 见文件头 ②） */
export type SteamParse<T> =
    | { kind: 'ok'; items: T[] }
    /** 请求成功但**资料没公开**（Steam 对私有资料返回空 response，HTTP 仍是 200） */
    | { kind: 'private' }
    | { kind: 'error'; message: string };

/** 把 Steam 的分钟数换成小时（保留一位小数；0 分钟 ⇒ 0）。用户裁定：**直接用总时长覆盖** */
export function minutesToHours(min: unknown): number {
    const n = typeof min === 'number' && Number.isFinite(min) ? Math.max(0, min) : 0;
    return Math.round((n / 60) * 10) / 10;
}

/** 小图标 URL（Steam 给的是 hash，要自己拼；空 hash ⇒ 不落键） */
export function steamIconUrl(appid: number, iconHash: unknown): string | undefined {
    const h = typeof iconHash === 'string' ? iconHash.trim() : '';
    if (!h) return undefined;
    return `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${h}.jpg`;
}

/**
 * 解析 `GetOwnedGames` 响应。
 *
 * 🔴 三态判定（顺序不许换）：
 *   ⑴ 结构不对（非对象 / 没有 `response`）⇒ `error`（多半是 key 无效被挡，或接口变更）；
 *   ⑵ `response.games` **不是数组**（缺键 / 空对象）⇒ **`private`** —— Steam 对「资料不公开」
 *      与「这个人真没有游戏」返回的都是 `{"response":{}}`，**两者无法区分** ⇒ 只能如实说
 *      「拉不到，请确认个人资料与游戏详情设为公开」，⛔ 不许说成「你库里没有游戏」（那是撒谎）；
 *   ⑶ `games` 是数组（**哪怕是空数组**）⇒ `ok`（空数组 = 真的空库，那时 `game_count` 会是 0）。
 */
export function parseOwnedGames(raw: unknown): SteamParse<SteamOwnedGame> {
    if (typeof raw !== 'object' || raw === null) return { kind: 'error', message: '响应不是对象' };
    const resp = (raw as Record<string, unknown>).response;
    if (typeof resp !== 'object' || resp === null) return { kind: 'error', message: '响应里没有 response 字段' };
    const games = (resp as Record<string, unknown>).games;
    if (!Array.isArray(games)) return { kind: 'private' };
    const items: SteamOwnedGame[] = [];
    for (const g of games) {
        if (typeof g !== 'object' || g === null) continue;
        const o = g as Record<string, unknown>;
        const appid = typeof o.appid === 'number' ? o.appid : Number(o.appid);
        if (!Number.isFinite(appid) || appid <= 0) continue;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        // ⚠️ 没有名字的条目**跳过**：本插件按标题落条目，无标题无法建（Steam 偶发返回无名条目）
        if (!name) continue;
        const out: SteamOwnedGame = {
            appid,
            name,
            playtimeForever: typeof o.playtime_forever === 'number' && o.playtime_forever > 0 ? o.playtime_forever : 0,
        };
        if (typeof o.playtime_2weeks === 'number' && o.playtime_2weeks > 0) out.playtime2Weeks = o.playtime_2weeks;
        const icon = steamIconUrl(appid, o.img_icon_url);
        if (icon) out.iconUrl = icon;
        items.push(out);
        if (items.length >= STEAM_SYNC_LIMIT) break;
    }
    return { kind: 'ok', items };
}

/**
 * 解析 `GetWishlist` 响应。口径与 `parseOwnedGames` 同款（**空 ⇒ private**，见文件头 ②）。
 * ⚠️ 愿望单条目**没有游戏名**（Steam 只给 appid）⇒ 名字要靠商店 `appdetails` 另拉（那一步在服务层）。
 */
export function parseWishlist(raw: unknown): SteamParse<SteamWishlistItem> {
    if (typeof raw !== 'object' || raw === null) return { kind: 'error', message: '响应不是对象' };
    const resp = (raw as Record<string, unknown>).response;
    if (typeof resp !== 'object' || resp === null) return { kind: 'error', message: '响应里没有 response 字段' };
    const items = (resp as Record<string, unknown>).items;
    if (!Array.isArray(items)) return { kind: 'private' };
    const out: SteamWishlistItem[] = [];
    for (const it of items) {
        if (typeof it !== 'object' || it === null) continue;
        const o = it as Record<string, unknown>;
        const appid = typeof o.appid === 'number' ? o.appid : Number(o.appid);
        if (!Number.isFinite(appid) || appid <= 0) continue;
        const one: SteamWishlistItem = { appid };
        if (typeof o.date_added === 'number' && o.date_added > 0) one.dateAdded = o.date_added;
        if (typeof o.priority === 'number' && o.priority > 0) one.priority = o.priority;
        out.push(one);
        if (out.length >= STEAM_SYNC_LIMIT) break;
    }
    return { kind: 'ok', items: out };
}

/**
 * 🔴 同步结果的**用户可读回执**（「失败说人话」的统一出口）。
 * 用户口径：同步按钮点完必须**看得出发生了什么** —— 至少「库 N 条 / 愿望单 M 条」，
 * 以及**为什么是 0**（没公开 / 没配置 / 真没有）。
 */
export function syncSummary(r: {
    owned?: SteamParse<SteamOwnedGame>;
    wishlist?: SteamParse<SteamWishlistItem>;
    added?: number;
    updated?: number;
}): string {
    const bits: string[] = [];
    const describe = (label: string, p: SteamParse<unknown> | undefined): string | null => {
        if (!p) return null;
        if (p.kind === 'ok') return `${label} ${p.items.length} 条`;
        if (p.kind === 'private') return `${label} 拉不到（资料可能不是公开）`;
        return `${label} 出错：${p.message}`;
    };
    const o = describe('游戏库', r.owned);
    const w = describe('愿望单', r.wishlist);
    if (o) bits.push(o);
    if (w) bits.push(w);
    if (r.added !== undefined || r.updated !== undefined) {
        bits.push(`新增 ${r.added ?? 0} · 更新 ${r.updated ?? 0}`);
    }
    return bits.join('；');
}

/**
 * 同步弹窗的**判重键**：`steam:{appid}`。
 * 🔴 与 TMDB 同款口径（`tmdb:{movie|tv}:{id}`）：**来源 id** 才是判重键，⛔ 不用标题 ——
 *    标题会被用户改（库里「Portal 2」手改成「传送门 2」后，按标题就会重复导入一条）。
 */
export function steamItemKey(appid: number): string {
    return `steam:${appid}`;
}

/** 从条目 `sourceUrl` 反解 appid（`https://store.steampowered.com/app/620`）—— 弹窗判「库里已有」用 */
export function steamAppIdFromUrl(url: unknown): number | null {
    const m = /store\.steampowered\.com\/app\/(\d+)/.exec(typeof url === 'string' ? url : '');
    return m ? Number(m[1]) : null;
}

/** 同步候选条目来自哪份清单 */
export type SteamSyncSource = 'owned' | 'wishlist';

/** 一条待选条目（弹窗列表一行 = 一条） */
export interface SteamSyncCandidate {
    appid: number;
    name: string;
    /** 来自库（`owned`，带时长）还是愿望单（`wishlist`，⛔ 没有时长） */
    source: SteamSyncSource;
    /** 总游玩时长（分钟；愿望单条目恒 0） */
    playtimeForever: number;
    /** 小图标（`img_icon_url` 拼出；愿望单没有） */
    iconUrl?: string;
}

/**
 * 把库与愿望单**并成一张待选表**（appid 去重，库优先）。
 * 🔴 库优先的理由：同一款游戏既在库里又在愿望单时（愿望单没及时清），
 *    「已拥有的那条」带时长、带图标 ⇒ 信息更全，且不该被当成「想要」状态。
 */
export function mergeSyncCandidates(
    owned: readonly SteamOwnedGame[],
    wishlist: readonly SteamWishlistItem[],
    wishlistNames: ReadonlyMap<number, string> = new Map(),
): SteamSyncCandidate[] {
    const out: SteamSyncCandidate[] = [];
    const seen = new Set<number>();
    for (const g of owned) {
        if (seen.has(g.appid)) continue;
        seen.add(g.appid);
        out.push({
            appid: g.appid,
            name: g.name,
            source: 'owned',
            playtimeForever: g.playtimeForever,
            ...(g.iconUrl ? { iconUrl: g.iconUrl } : {}),
        });
    }
    for (const w of wishlist) {
        if (seen.has(w.appid)) continue;
        // 愿望单只有 appid ⇒ 名字靠商店 `appdetails` 另拉；拉不到就留占位名（⛔ 不静默丢这条）
        const name = wishlistNames.get(w.appid) ?? `Steam App ${w.appid}`;
        seen.add(w.appid);
        out.push({ appid: w.appid, name, source: 'wishlist', playtimeForever: 0 });
    }
    return out;
}

/** 候选 → 条目字段（不含详情；详情由宿主按需补） */
export interface SteamEntrySeed {
    type: 'game';
    title: string;
    status: 'want' | 'watching';
    /** 库条目才有：Steam 总时长覆盖（用户裁定「直接用总时长覆盖」） */
    playtimeMinutes?: number;
    /** 竖版封面（商店 `library_600x900.jpg`） */
    poster: string;
    sourceUrl: string;
    source: 'steam';
}

/**
 * 候选 → 落库字段。
 * 🔴 `status` 口径：库里已拥有的 = **看玩中**（`watching`），愿望单 = **想玩**（`want`）——
 *    用户报障「拉到的 steam 游戏只拉了个标题」，其中一条就是**状态也不对**（全塞成想玩）。
 * ⚠️ 封面走**商店竖版**（`library_600x900.jpg`，与搜索结果同一个图床）而不是 `img_icon_url` 那个
 *    32×32 小图标 —— 小图标贴进海报墙会糊成一团（这是用户报的「连封面都没有」的真身）。
 */
export function steamEntrySeed(c: SteamSyncCandidate): SteamEntrySeed {
    const seed: SteamEntrySeed = {
        type: 'game',
        title: c.name,
        status: c.source === 'owned' ? 'watching' : 'want',
        poster: steamCoverUrl(c.appid),
        sourceUrl: `https://store.steampowered.com/app/${c.appid}`,
        source: 'steam',
    };
    if (c.source === 'owned') {
        // 🔴 直接用**原始分钟**落库，⛔ 不要绕 `minutesToHours` 再乘回来：
        //    `minutesToHours` 会四舍五入到 0.1 小时（= 6 分钟的刻度），
        //    125 分钟 → 2.1h → 126 分钟，每轮同步都把用户的时长悄悄改错 1 分钟。
        seed.playtimeMinutes = Math.max(0, Math.round(c.playtimeForever));
    }
    return seed;
}

/** Steam 详情里**能落进条目**的那些字段（与 `services/steam.ts` 的 `SteamDetail` 同形子集） */
export interface SteamDetailFields {
    platform?: string;
    developer?: string;
    year?: number;
    genres?: string[];
    summary?: string;
    rating?: number;
    ratingCount?: number;
    /** 🔴 Steam 好评率百分比（0-100 整数）—— 见下面 `steamDetailFields` 的口径说明 */
    reviewPercent?: number;
}

/**
 * 详情对象 → 条目字段（**唯一映射真源**）。
 *
 * 🔴🔴 为什么要抽成纯函数：2026-10-25 用户报障「为什么有些同步导入的 steam 条目没有大众评分和评价人数」——
 *    根因是**两个落库入口各写了一份映射**：`importSteamRows`（弹窗勾选导入）补了详情，
 *    而 `syncSteamNow`（启动静默同步 / 同步按钮）**一个字段都没拉**，建出来的条目连封面都没有。
 *    ⇒ 同一件事写两遍，必然有一遍先烂掉。现在两条路都调这一个函数。
 *
 * ⚠️ 入参是**不确定形态**（详情经 `Record<string, unknown>` 跨层传递），所以逐字段校验类型：
 *    上游 `parseAppDetails` 已归一过，这里再做一次「非空才算数」是防未来有人从别处喂脏数据。
 * ⛔ `rating` 只采信 `0 < v <= 10`（10 分制）：`0` 是「没有媒体分」而不是「0 分」，
 *    落成 0 会让界面显示「0 分」这种假结论。
 */
export function steamDetailFields(d: unknown): SteamDetailFields {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const r = d as Record<string, unknown>;
    const out: SteamDetailFields = {};
    const asText = (v: unknown): string | undefined => {
        const s = typeof v === 'string' ? v.trim() : '';
        return s || undefined;
    };
    const platform = asText(r.platform);
    if (platform) out.platform = platform;
    const developer = asText(r.developer);
    if (developer) out.developer = developer;
    if (typeof r.year === 'number' && Number.isFinite(r.year) && r.year > 0) out.year = Math.round(r.year);
    if (Array.isArray(r.genres)) {
        // 最多前 3 个（与豆瓣回填同一截断口径，别让题材框被塞成一行流水账）
        const gs = r.genres.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 3);
        if (gs.length) out.genres = gs;
    }
    const summary = asText(r.summary);
    if (summary) out.summary = summary;
    if (typeof r.rating === 'number' && Number.isFinite(r.rating) && r.rating > 0 && r.rating <= 10) {
        out.rating = r.rating;
    }
    if (typeof r.ratingCount === 'number' && Number.isFinite(r.ratingCount) && r.ratingCount > 0) {
        out.ratingCount = Math.round(r.ratingCount);
    }
    // 🔴 2026-10-25 起 Steam 的「大众评分」按好评率百分比显示（用户裁定「能不能显示为%专属」）。
    // ⚠️ 只采信 `0 <= v <= 100`：`0` 是「有人评、但一个好评都没有」的**真实结论**
    //    （上游 `parseReviewHistogram` 对全差评会给 0 —— 那个 0 有意义；而「没人评过」它给 `{}` 即 undefined，
    //    两者在源头就分开了）⇒ 这里放行 0 是对的。
    //    超过 100 说明上游算错了（比率不可能溢出），直接丢弃而不是钳到 100。
    // ⛔ 绝不写进 `communityScore`：那是全仓 10 分制字段（校验上限 10），塞 97 会校验失败。
    if (typeof r.reviewPercent === 'number' && Number.isFinite(r.reviewPercent) && r.reviewPercent >= 0 && r.reviewPercent <= 100) {
        out.reviewPercent = Math.round(r.reviewPercent);
    }
    return out;
}

/**
 * 一次同步里**最多补几条详情**（`appdetails` 是公开免 key 端点，但仍有频率限制）。
 *
 * 🔴 为什么必须设上限：`syncSteamNow` 是**启动时静默跑**的（`autoSyncSteamQuietly`），
 *    一个 2000 款游戏的库如果在开机时逐条拉详情，= 开机卡顿 + 撞限流 + 被 Steam 临时拒绝。
 *    实测用户库里真正「缺详情」的只有早期导入的那批，补齐一轮之后就不再触发了
 *    （`steamEntryNeedsDetail` 会跳过已有字段的条目）⇒ 每轮 40 条足够收敛，且开机无感。
 */
export const STEAM_DETAIL_FILL_LIMIT = 40;

/**
 * 这条已存在的条目**还缺不缺** Steam 详情（缺 = 值得花一次请求去补）。
 *
 * 🔴 判据只看 **`poster` 是否为空**，这是经过推敲的收敛设计：
 *    ① 用户报障的老条目全部来自 `syncSteamNow`，那一版**一个字段都没写**、连 `poster` 都没有
 *       ⇒ 「缺封面」把它们全捞出来，一轮补齐；
 *    ② 补齐时 `poster` 一定被写上（`steamCoverUrl` 是本地拼的、不依赖网络）⇒ **下一轮就不再命中**，
 *       预算不会被长期占用。
 * ⚠️ 刻意**不把「缺评分」当判据**：很多游戏根本没有 Metacritic 收录（`rating` 本来就是 undefined），
 *    按「缺评分」判会让它们**每一轮启动都重拉一次**，白耗配额还永远补不上 —— 那不是收敛，是漏水。
 * ⚠️ 用户自己的 `rating`（个人评分）**不参与判断** —— 那是两回事，永远不从 Steam 覆盖。
 */
export function steamEntryNeedsDetail(cur: { poster?: string }): boolean {
    return !(typeof cur.poster === 'string' && cur.poster.trim());
}

/**
 * 商店**竖版**封面（与 `services/steam.ts` 的 `COVER_IMAGE_BASE` 同一张图床、同一路径规则）。
 * ⚠️ 纯模块里刻意**不 import** 服务层（那层会牵 obsidian）⇒ 常量在这里再写一次，两处必须同值。
 */
export function steamCoverUrl(appid: number): string {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
}

/**
 * 库与愿望单**都拉不到**时的结论（弹窗顶部那句）——三态各自说人话。
 * ⚠️ 只一个不通时**照常列好的那半**（⛔ 别因为愿望单没公开就整轮判失败）。
 */
export function syncFetchHeadline(r: {
    owned: SteamParse<SteamOwnedGame>;
    wishlist: SteamParse<SteamWishlistItem>;
    total: number;
}): string {
    const parts: string[] = [];
    if (r.owned.kind === 'ok') parts.push(`游戏库 ${r.owned.items.length}`);
    else if (r.owned.kind === 'private') parts.push('游戏库拉不到（「个人资料」与「游戏详情」可能不是公开）');
    else parts.push(`游戏库出错：${r.owned.message}`);
    if (r.wishlist.kind === 'ok') parts.push(`愿望单 ${r.wishlist.items.length}`);
    else if (r.wishlist.kind === 'private') parts.push('愿望单拉不到（可能没设为公开）');
    else parts.push(`愿望单出错：${r.wishlist.message}`);
    return `${parts.join(' · ')} ⇒ 待选 ${r.total} 条`;
}

/**
 * 现有条目与 Steam 库的**配对键**：按标题归一比对（Steam 名与本仓标题常有全半角/大小写差异）。
 * 🔴 只做**保守**归一（去空白 + 折叠连续空白 + 小写 + 全角括号转半角）——
 *    ⛔ 不做模糊匹配：把《Portal》配到《Portal 2》上比「没配上」糟得多（会覆盖错条目的时长）。
 */
export function steamTitleKey(title: unknown): string {
    const s = typeof title === 'string' ? title : '';
    return s
        .replace(/[\uFF08]/g, '(')
        .replace(/[\uFF09]/g, ')')
        .replace(/[\uFF1A]/g, ':')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * 把 Steam 库与**已有条目**配对（返回 `appid → entryId`），没配上的留给「新增」。
 * @param owned   Steam 库
 * @param entries 本仓条目（只要 `id` 与 `title`）
 */
export function matchOwnedToEntries(
    owned: readonly SteamOwnedGame[],
    entries: readonly { id: string; title: string }[],
): Map<number, string> {
    const byTitle = new Map<string, string>();
    for (const e of entries) {
        const k = steamTitleKey(e.title);
        // 同名多条 ⇒ **首条说了算**（⛔ 不覆盖：后写会把配对结果随机化）
        if (k && !byTitle.has(k)) byTitle.set(k, e.id);
    }
    const out = new Map<number, string>();
    for (const g of owned) {
        const hit = byTitle.get(steamTitleKey(g.name));
        if (hit) out.set(g.appid, hit);
    }
    return out;
}

/**
 * 启动时**自动增量同步游玩时长**的门槛（用户裁定「插件启动时同步并增量游玩时长」）。
 * `null` = 这次不该自动同步（没配好凭据 / 上次同步太近）。
 *
 * 🔴 为什么不无条件跑：Steam Web API 有**调用频率限制**（实测波动），
 *    每次开库都打一遍会在一天开十几次库的用户那里撞限流，而时长是「天级」变化的数据。
 *    ⇒ 间隔取 **6 小时**：既跟得上当天的游戏，又不至于限流。
 */
export const STEAM_AUTO_SYNC_GAP_MS = 6 * 60 * 60 * 1000;

export function shouldAutoSync(
    opts: { hasKey: boolean; hasId: boolean; lastSyncAt?: unknown; now: number },
): boolean {
    if (!opts.hasKey || !opts.hasId) return false;
    const last = typeof opts.lastSyncAt === 'number' && Number.isFinite(opts.lastSyncAt) ? opts.lastSyncAt : 0;
    if (last <= 0) return true;
    return opts.now - last >= STEAM_AUTO_SYNC_GAP_MS;
}
