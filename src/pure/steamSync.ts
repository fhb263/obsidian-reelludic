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
 * SteamID 归一：接受 64 位数字串（`76561198…`）。
 * 🔴 只认 `SteamID64`：另两种形态（`STEAM_0:1:…` / 自定义 vanity 名）都要**先解析**才能用，
 *    而那需要额外的接口调用 —— 本批**不做**，但**必须明确报错**而不是拿它去请求（会静默 0 条）。
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
        return '这里要填 64 位数字的 SteamID（形如 76561198…），不是 STEAM_0:1:… 那种写法';
    }
    if (/^https?:\/\//i.test(s)) return '这里要填 64 位数字的 SteamID，不是个人资料网址';
    if (!/^\d+$/.test(s)) return '这里要填 64 位数字的 SteamID（自定义昵称不行）';
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
