// Steam 游戏检索（免 Key 公开端点；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://store.steampowered.com/api/storesearch/?term={q}&cc=US&l=english
//   - 端点接入时校准（#165 T6）：首选 search/suggest 实测返回热门 HTML 列表（非检索 JSON），
//     故改用 storesearch 公开免 Key 端点（HTTP 200 JSON { total, items[] }），无需登录/无需 Steam Web API Key
//   - items 仅 type=app（appid）语义正确 → 非 app（sub/bundle）与缺 id/name 的异常条目 parse 时过滤
// 详情：GET https://store.steampowered.com/api/appdetails?appids={appid}&cc=US&l=english
//   - 🔴 #623 接入（原注释写「B3 深度回填另行排期」，用户报障后本批补上）：选中搜索结果时按需拉取，
//     回填**平台 / 开发商 / 发行年 / 题材 / 简介**（表单里真有这几个框；发布商故意不取，见 parseAppDetails）
// 结果映射为 GameSearchResult（与豆瓣游戏同型，字段对齐 resultTypes.GameSearchResult）
import { asRecord } from 'pure/record';
import type { GameSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string) => Promise<string>;

const SEARCH_ENDPOINT = 'https://store.steampowered.com/api/storesearch/';
/** 竖版封面图床（library_600x900：Steam 商店页横版 + 搜索列表竖版封面；以 appid 拼 URL，不随响应字段变化） */
export const COVER_IMAGE_BASE = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
/**
 * 详情端点（公开免 Key，与 storesearch 同域）。
 * ⚠️ `cc` / `l` 必须与搜索**保持同一组值**：两处口径不同时，详情里的发行年 / 题材会与搜索结果对不上
 *    （同一款游戏在 US 区与别的区可能连发售状态都不同）。
 */
const DETAIL_ENDPOINT = 'https://store.steampowered.com/api/appdetails';

/** storesearch 单条 item 解析后的扁平原始形态（安全读取；type=app 过滤后均为应用） */
export interface RawSteamItem {
    /** store 条目类型（'app' = 应用/游戏；sub/bundle 在 parse 已过滤） */
    type: string;
    /** appid（number，对齐 GameSearchResult.id） */
    id: number;
    /** 名称 */
    name: string;
}

/** 构造搜索 URL（cc=US&l=english 固定——storesearch 检索为商店英文索引） */
export function buildSearchUrl(query: string): string {
    return `${SEARCH_ENDPOINT}?term=${encodeURIComponent(query)}&cc=US&l=english`;
}

/**
 * 解析 storesearch 响应：items[] → RawSteamItem[]。
 * 异常条目容错：仅保留 type=app（appid 语义，sub/bundle 的 sourceUrl app/{id} 不正确）；
 * 缺 id（非 number）或缺 name 的条目一并过滤；items 缺失/空 → 空数组。
 */
export function parseSteamResults(text: string): RawSteamItem[] {
    const data = asRecord(JSON.parse(text));
    const items = Array.isArray(data.items) ? data.items : [];
    return items
        .map(asRecord)
        .filter((it) => it.type === 'app' && typeof it.id === 'number' && typeof it.name === 'string')
        .map((it) => ({
            type: it.type as string,
            id: it.id as number,
            name: it.name as string,
        }));
}

/**
 * 搜索级条目 → GameSearchResult（cover 竖版拼图规则；summary/developer 搜索级不填）。
 *
 * 🔴🔴 `platform` 是**判别键**，⛔ 一个都不许省（哪怕搜索级拿不到值）：
 *    表单点选结果时按「结果里有没有某个键」来判类型（`'platform' in r` → 游戏、`'author' in r` → 书籍、
 *    `'album' in r` → 音乐、`'studio' in r` → 动画，见 `EntryForm.pick`）。缺失时它会**掉进影视兜底分支**，
 *    拿自己的 id 去打 TMDB 详情（`/undefined/{id}`）⇒ **HTTP 404 ⇒ 整个 pick 抛错、条目加不进去**
 *    （用户 2026-10-13 报障：「搜索列表正常，一点击就提示回填详情失败：Request failed, status 404」）。
 *    ⚠️ TS 看不出这个问题：`GameSearchResult.platform` 是**可选**属性 ⇒ `'platform' in r` 编译期永远合法，
 *    运行时却为 false。豆瓣（`platform: s.platform`）与 IGDB（`platform: firstPlatformName(...)`）都带这个键，
 *    本函数是**唯一漏的**。⛔ 别因为「值为空」就把它删掉 —— 值空是正常状态，键缺失是逻辑错误。
 */
export function toGameResult(item: RawSteamItem): GameSearchResult {
    const id = item.id;
    return {
        id,
        title: item.name,
        // ⚠️ 搜索级确实拿不到平台（storesearch 不返回；要它得走 appdetails，另行排期）——
        //    但键**必须存在**，见上方说明。
        platform: undefined,
        cover: `${COVER_IMAGE_BASE}/${id}/library_600x900.jpg`,
        source: 'steam',
        sourceUrl: `https://store.steampowered.com/app/${id}`,
    };
}

/**
 * appdetails 解析结果（**键名刻意与豆瓣详情同形** ⇒ `EntryForm` 直接喂同一支 `applyDoubanDetail`，
 * ⛔ 不新增第二套字段回填逻辑 —— 同一件事两处做是本仓反复踩的分叉源）。
 * ⚠️ 只收**游戏表单里真有框**的字段；缺失一律 `undefined`（由回填侧判空跳过）。
 */
export interface SteamDetail {
    /** 平台：由 `platforms{windows,mac,linux}` 布尔拼「Windows / macOS / Linux」 */
    platform?: string;
    /** 开发商（`developers[0]`；Steam 是数组，只取首个 —— 与表单的单值框对齐） */
    developer?: string;
    /** 发行年（从 `release_date.date` 里取 4 位年；形态很杂，见 `yearOf`） */
    year?: number;
    /** 题材（`genres[].description`，最多前 3 个 —— 与豆瓣回填同一截断口径） */
    genres?: string[];
    /** 简介用 `short_description`（纯文本）；⛔ 不用 `detailed_description`（那是 HTML 长文） */
    summary?: string;
}

/** 构造详情 URL（appids 就是 appid，与搜索共用同一组 cc/l 参数） */
export function buildDetailUrl(appid: number): string {
    return `${DETAIL_ENDPOINT}?appids=${appid}&cc=US&l=english`;
}

/** `platforms` 布尔组 → 「Windows / macOS / Linux」（都不支持 ⇒ undefined，⛔ 不返回空串） */
function platformsOf(v: unknown): string | undefined {
    const p = asRecord(v);
    const names: string[] = [];
    if (p.windows === true) names.push('Windows');
    if (p.mac === true) names.push('macOS');
    if (p.linux === true) names.push('Linux');
    return names.length ? names.join(' / ') : undefined;
}

/**
 * 从 `release_date.date` 取 4 位年。
 * 🔴 刻意**不复用** `pure/record.parseYear`：那个是 `^(\d{4})` 的**前缀**匹配（给 `2024-01-01` 这类 ISO 串用的），
 *    而 Steam 的形态是 `Jul 9, 2013`（年在末尾）、`2024`、`Q1 2025`、`Coming soon`（无年）⇒ 必须全串找 4 位数字。
 * ⚠️ 写成 `(19|20)\d{2}` 而不是裸 `\d{4}`：`Q1 2025` 之类的串里先出现的 4 位数字才是年，
 *    而裸 `\d{4}` 在 `Coming soon 2024-01-01` 形态下也能过，两种写法在真实数据上等价 —— 但限定世纪前缀
 *    能挡住「版本号 / 季号」这类误取（例如某天 Steam 在日期串里塞进别的 4 位数）。
 */
function yearOf(v: unknown): number | undefined {
    const m = /(19|20)\d{2}/.exec(typeof v === 'string' ? v : '');
    return m ? Number(m[0]) : undefined;
}

/** 取字符串数组的首个非空项（Steam 的 developers / publishers 都是数组） */
function firstString(v: unknown): string | undefined {
    if (!Array.isArray(v)) return undefined;
    for (const it of v) {
        if (typeof it === 'string' && it) return it;
    }
    return undefined;
}

/**
 * 解析 appdetails 响应：`{ "<appid>": { success: boolean, data: {...} } }`。
 *
 * 🔴 `success !== true` ⇒ **null**（应用不存在 / 已下架 / 区域不可见 / 非游戏）—— 这是「没有详情」，
 *    不是「解析出错」，调用侧一律按 null 静默保留搜索级字段。⛔ 别返回空对象：那会让上层以为拉到了详情却全空。
 * ⚠️ **发布商（publishers）故意不取**：游戏表单没有「出品方」框 ⇒ 取了就是「界面上看不见、笔记里却有」的
 *    幽灵字段（本仓口径，与漫画不补 ISBN / 作者简介同一件事）。哪天游戏表单加了那个框，这里再补映射。
 */
export function parseAppDetails(text: string, appid: number): SteamDetail | null {
    const root = asRecord(JSON.parse(text));
    const node = asRecord(root[String(appid)]);
    if (node.success !== true) return null;
    const d = asRecord(node.data);
    const genres = (Array.isArray(d.genres) ? d.genres : [])
        .map((g) => asRecord(g).description)
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
        .slice(0, 3);
    const summary = d.short_description;
    return {
        platform: platformsOf(d.platforms),
        developer: firstString(d.developers),
        year: yearOf(asRecord(d.release_date).date),
        genres: genres.length ? genres : undefined,
        summary: typeof summary === 'string' && summary ? summary : undefined,
    };
}

export class SteamClient {
    readonly name = 'steam';

    constructor(private http: HttpGet) {}

    /** 搜索 → GameSearchResult[]（搜索级字段；平台 / 开发商 / 简介走 `fetchDetail` 按需补） */
    async search(query: string): Promise<GameSearchResult[]> {
        const text = await this.http(buildSearchUrl(query));
        return parseSteamResults(text).map(toGameResult);
    }

    /** 详情 → SteamDetail | null（`success=false` / 解析不出 → null，由调用方静默兜底） */
    async fetchDetail(appid: number): Promise<SteamDetail | null> {
        const text = await this.http(buildDetailUrl(appid));
        return parseAppDetails(text, appid);
    }
}
