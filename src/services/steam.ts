// Steam 游戏检索（免 Key 公开端点；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://store.steampowered.com/api/storesearch/?term={q}&cc=US&l=english
//   - 端点接入时校准（#165 T6）：首选 search/suggest 实测返回热门 HTML 列表（非检索 JSON），
//     故改用 storesearch 公开免 Key 端点（HTTP 200 JSON { total, items[] }），无需登录/无需 Steam Web API Key
//   - items 仅 type=app（appid）语义正确 → 非 app（sub/bundle）与缺 id/name 的异常条目 parse 时过滤
// 详情：GET https://store.steampowered.com/api/appdetails?appids={appid}&cc=US&l=english
//   - 🔴 #623 接入（原注释写「B3 深度回填另行排期」，用户报障后本批补上）：选中搜索结果时按需拉取，
//     回填**平台 / 开发商 / 发行年 / 题材 / 简介**（表单里真有这几个框；发布商故意不取，见 parseAppDetails）
//   - 🔴 2026-10-25 用户报障「拉取到的怎么没有 steam 的评分和评价人数」：补**评分 / 评价人数**两字段
//     （评分取 Metacritic 媒体分 ÷10 成 10 分制、评价人数取 recommendations.total，取法与残缺说明见 SteamDetail）
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
/**
 * 🔴 2026-10-25 用户裁定「能不能显示为%专属」后接入：Steam 评分改用**好评率百分比**。
 *
 * 数据源 `appreviewhistogram/{appid}`（公开免 key，与商店同域）：返回按周分桶的
 * `results.rollups[]`，每桶有 `recommendations_up` / `recommendations_down`
 * ⇒ 累加即可算「全部语言、历史累计」的好评率与测评总数。
 *
 * ⚠️ 为什么不用 `appreviews`（`/appreviews/{appid}?json=1`）：实测**免 key 返回 HTTP 302 空 body**，
 *    拿不到好评率。而 `appdetails.recommendations.total` 只有**条数**、没有好评数，算不出比率。
 * ⚠️ 为什么 `ratingCount` 也改用它：用户报障的正是「有评价人数没评分」——
 *    两边取自不同接口时必然出现「有 A 没 B」。同一支接口出两个数，才不会互相打架。
 * ⚠️ histogram 的累加总数**系统性高于** `recommendations.total`（实测 19/19 命中、平均高 5~9%，
 *    因为后者是商店页缓存值、口径更窄）⇒ 两者只选一支，⛔ 不混用、也不互相校验。
 */
const HISTOGRAM_ENDPOINT = 'https://store.steampowered.com/appreviewhistogram';

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
    /**
     * 评分（10 分制，与豆瓣/微信读书同制式）——🔴 2026-10-25 用户报障「拉取到的怎么没有 steam 的评分」。
     *
     * ⚠️ Steam 商店**没有**官方「评分」字段，这里取 **Metacritic 媒体均分**（`metacritic.score`，0-100）
     *    换算成 10 分制（÷10，保留一位）。为什么不用好评率：`appreviews` 端点实测 **302 跳转**
     *    （免 key 拿不到），而 `appdetails.recommendations` 只有**总评价数**、没有「好评数」⇒
     *    算不出好评率。⛔ 别拿 `recommendations.total` 当评分（那是数量不是分数）。
     * ⚠️ 很多游戏没有 Metacritic 收录 ⇒ `undefined`，由回填侧判空跳过（⛔ 不编一个 0）。
     */
    rating?: number;
    /**
     * 评价人数 —— 🔴 2026-10-25 起取 **histogram 累加的测评总条数**（与 `reviewPercent` 同源）。
     *
     * ⚠️ 曾经取 `recommendations.total`，与 `rating`（Metacritic 媒体分）**不同源** ——
     *    用户报障「有评价人数没评分」就是这么来的：很多游戏没有 Metacritic 收录，
     *    于是「人数有、评分空」。现在两者出自同一支 histogram 接口，有就一起有。
     * ⚠️ 拿不到（接口失败 / 该游戏零评测）⇒ `undefined`，界面留空（⛔ 不编 0）。
     */
    ratingCount?: number;
    /**
     * 🔴 Steam 好评率百分比（0-100 整数，**专属字段**，目前只有 Steam 会填）。
     *
     * 用户 2026-10-25 裁定：「能不能显示为%专属」⇒ Steam 的「大众评分」按**百分比**呈现，
     * 不再缩成 10 分制（那是豆瓣/微信读书的制式，硬换算会显示成 `★ 9.6` 这种不像 Steam 的数）。
     *
     * ⚠️ **不写进 `communityScore`**：那个字段是全仓共用的 10 分制（校验 `communityScoreIssue`
     *    上限写死 10、排序/系列均分/表格列都按 10 分制假设）。把 97 塞进去会直接校验失败、
     *    并且污染其它来源的展示 ⇒ 宁可多一个字段，也不动语义。
     * ⚠️ 与 `rating`（Metacritic 媒体分）**并存但不互算**：一个有就用，两个都有时界面优先显示百分比。
     */
    reviewPercent?: number;
}

/** 构造详情 URL（appids 就是 appid，与搜索共用同一组 cc/l 参数） */
export function buildDetailUrl(appid: number): string {
    return `${DETAIL_ENDPOINT}?appids=${appid}&cc=US&l=english`;
}

/**
 * 构造好评率直方图 URL。
 * ⚠️ 刻意**不带** `cc` / `l`：这接口返回的是**全语言、全历史**的周汇总，
 *    加语言参数只会让它变成某个语言子集，反而与「Steam 商店页 All Reviews 那个百分比」对不上。
 */
export function buildReviewHistogramUrl(appid: number): string {
    return `${HISTOGRAM_ENDPOINT}/${appid}`;
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
 * Metacritic 媒体均分（0-100）→ 10 分制一位小数。
 * ⚠️ 只在 `0 < score <= 100` 时采信：Steam 偶有 `score: 0` 当「无评分」用，
 *    直接 ÷10 会变成一个刺眼的「0 分」——宁可 undefined 让界面留空（⛔ 不编 0）。
 */
function tenScaleOf(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : Number.NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 100) return undefined;
    return Math.round(n) / 10;
}

/** `recommendations.total` → 评价人数（正整数才算；0 / 缺失一律 undefined） */
function countOf(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : Number.NaN;
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.round(n);
}

/** 好评率直方图的解析结果（`percent` 与 `total` 一定同源，要么都有要么都无） */
export interface SteamReviewStats {
    /** 好评率百分比（0-100 整数） */
    percent?: number;
    /** 测评总条数（各周桶 `up + down` 累加） */
    total?: number;
}

/**
 * 解析 `appreviewhistogram/{appid}` 响应：`{ success: true, results: { rollups: [{ recommendations_up, recommendations_down }] } }`。
 *
 * 🔴 口径：**全语言、全历史**累计好评率 —— 周桶就是把历史按周切段，
 *    累加 `up/(up+down)` 与商店页「All Reviews」那个百分比同义。
 * ⚠️ `rollups` 缺失 / 空数组（该游戏零评测，或接口对某些 appid 只回 `success`）⇒ `{}`，
 *    ⛔ 不返回 `{ percent: 0 }`：那是「零好评」的假结论，与「没人评过」是两回事。
 * ⚠️ 有测评但**全部是差评**（`up === 0`）⇒ `percent: 0` 是**真实结论**（确实 0% 好评），
 *    与「没人评过」（`{}`）必须区分开：前者有意义、后者无意义。
 *    这一区别还承担一个收敛职责 —— 补详情侧的判据是「有 total 但没有 percent 就再拉一次」，
 *    若这里对全差评不给 0，那类游戏会每次开机都重拉一遍（永不能收敛）。
 */
export function parseReviewHistogram(text: string): SteamReviewStats {
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        return {};
    }
    const r = asRecord(root);
    if (r.success !== true) return {};
    const rollups = asRecord(r.results).rollups;
    const list = Array.isArray(rollups) ? rollups : [];
    let up = 0;
    let down = 0;
    for (const item of list) {
        const x = asRecord(item);
        const u = typeof x.recommendations_up === 'number' ? x.recommendations_up : 0;
        const d = typeof x.recommendations_down === 'number' ? x.recommendations_down : 0;
        if (Number.isFinite(u) && u > 0) up += u;
        if (Number.isFinite(d) && d > 0) down += d;
    }
    const total = Math.round(up + down);
    if (!(total > 0)) return {};
    return { percent: Math.round((up * 100) / total), total };
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
        // 评分/评价人数：2026-10-25 用户报障「拉取到的怎么没有 steam 的评分和评价人数」后补上。
        // ⚠️ 这里只是**兜底值**：`rating` 取 Metacritic 媒体分（÷10），`ratingCount` 取 recommendations.total。
        //    真正的主力是 `fetchDetail` 里合并进来的 histogram 好评率 —— 它会**覆盖** `ratingCount`
        //    并补上 `reviewPercent`（两者同源）。这两行留着是为了 histogram 挂掉时仍有东西可显示。
        rating: tenScaleOf(asRecord(d.metacritic).score),
        ratingCount: countOf(asRecord(d.recommendations).total),
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

    /**
     * 详情 → SteamDetail | null（`success=false` / 解析不出 → null，由调用方静默兜底）。
     *
     * 🔴 2026-10-25 起本方法**发两次请求**：`appdetails`（平台/开发商/年份/题材/简介）+ `appreviewhistogram`
     *    （好评率百分比 + 测评总数）。合并点选在这里，是因为它是**所有详情路径的唯一入口**
     *    （搜索选中回填、弹窗勾选导入、静默同步补详情都走它）⇒ 一处补齐，三处都拿到，⛔ 别在调用侧各拉一遍。
     *
     * ⚠️ histogram 失败**绝不连累详情**：它是加分项，`appdetails` 拿到什么就返回什么。
     *    这也是为什么它放在 `try` 里单独兜 —— 少一个百分比，不等于整条详情作废。
     */
    async fetchDetail(appid: number): Promise<SteamDetail | null> {
        const text = await this.http(buildDetailUrl(appid));
        const base = parseAppDetails(text, appid);
        if (!base) return null;
        try {
            const hist = parseReviewHistogram(await this.http(buildReviewHistogramUrl(appid)));
            if (hist.percent != null) base.reviewPercent = hist.percent;
            // ⚠️ 用 histogram 的 total **覆盖** recommendations.total：两者同源才对得上百分比，
            //    混着用就会出现「97% 好评 · 但人数只有 556」这种自相矛盾的展示。
            if (hist.total != null) base.ratingCount = hist.total;
        } catch {
            /* 静默降级：没有好评率也比「只有标题」强（rating/ratingCount 仍是 appdetails 的兜底值） */
        }
        return base;
    }
}
