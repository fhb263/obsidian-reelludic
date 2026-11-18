// Bangumi 详情 → 条目字段的**唯一映射真源**。
//
// 🔴🔴 为什么要抽成纯函数（2026-11-08）：Bangumi 的「详情补全」在 `main.ts` 里被**手写了三遍**——
//    ① `searchAnimeFresh`（搜索结果前 3 条补评分/制作公司/导演/主演）
//    ② `importBangumiCollections`（追番表「从 Bangumi 导入」）
//    ③ `importBangumiRows`（同步弹窗勾选导入）
//    三处各自 `detail.rating ?? r.rating` / `persons.studio ?? detail.studio` / `persons.cast ?? []`，
//    连兜底链的先后顺序都靠人肉对齐 ⇒ 改一处必忘两处（Steam 那次「同步缺评分」就是这个病：
//    同一个映射两个入口各写一份，其中一个先烂掉）。现在三处都调这里。
//
// ⚠️ 本模块只做「归一 + 投影」，**不发请求、不碰 obsidian**（纯模块纪律，与 `pure/steamSync` 同款）。
// ⛔ 不要在这里读 settings / 拼 URL —— 那是服务层的事，调用方把已拿到的两个 payload 传进来即可。
import type { BangumiSearchResult } from 'services/bangumi';

/**
 * Bangumi 详情归一结果（subjects + persons 两个 API 的**合并后**形态）。
 *
 * ⚠️ 所有字段都是「有就是有，没有就 undefined」——⛔ 不编默认值（`0` 分 / `''` 导演都会污染展示）。
 */
export interface BangumiDetailData {
    /** 大众评分（10 分制） */
    rating?: number;
    /** 评分人数 */
    ratingCount?: number;
    /** 制作公司（infobox「动画制作」优先，persons 公司兜底） */
    studio?: string;
    /** 导演（persons 职业含「导演/监督/演出」） */
    director?: string;
    /** 主演 / 声优 */
    cast?: string[];
}

/** 条目侧要写的字段（键名与 `MediaEntry` 对齐，`rating` 在这里叫 `communityScore`） */
export interface BangumiEntryFields {
    communityScore?: number;
    ratingCount?: number;
    developer?: string;
    director?: string;
    cast?: string[];
}

function asText(v: unknown): string | undefined {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || undefined;
}

/**
 * 两个 API 的 payload → 归一数据。
 *
 * ⚠️ 入参是**不确定形态**（跨层传递时上游可能给了 `{}`、`null`），所以逐字段校验类型，
 *    与 `pure/steamSync.steamDetailFields` 同一套纪律：脏数据当成「没有」，⛔ 不抛。
 * ⛔ `rating` 只采信 `0 < v <= 10`：`0` = 没人评过，落成 0 会让界面显示「0 分」这种假结论。
 */
export function bangumiDetailData(detail: unknown, persons: unknown): BangumiDetailData {
    const out: BangumiDetailData = {};
    const d = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
    const p = persons && typeof persons === 'object' && !Array.isArray(persons) ? (persons as Record<string, unknown>) : {};

    if (typeof d.rating === 'number' && Number.isFinite(d.rating) && d.rating > 0 && d.rating <= 10) {
        out.rating = d.rating;
    }
    if (typeof d.ratingCount === 'number' && Number.isFinite(d.ratingCount) && d.ratingCount > 0) {
        out.ratingCount = Math.round(d.ratingCount);
    }
    // 制作公司：subjects infobox 的「动画制作」通常更准，persons 的公司只是兜底
    const studio = asText(d.studio) ?? asText(p.studio);
    if (studio) out.studio = studio;
    const director = asText(p.director);
    if (director) out.director = director;
    if (Array.isArray(p.cast)) {
        const cast = p.cast.filter((x): x is string => typeof x === 'string' && !!x.trim());
        if (cast.length) out.cast = cast;
    }
    return out;
}

/**
 * 投影只需要读这几个字段 —— 故意用**结构子集**而不是 `BangumiSearchResult`，
 * 因为三条调用路径手上的行类型各不相同（同步弹窗的行是 `BangumiSearchResult & { state }`，
 * 而导入路径的行没有 `genres`）⇒ 要整型就会逼调用方去补假字段。
 */
export type BangumiRowLike = Pick<
    BangumiSearchResult,
    'rating' | 'ratingCount' | 'studio' | 'director' | 'cast'
> & Partial<Pick<BangumiSearchResult, 'id' | 'title' | 'originalTitle' | 'year' | 'airDate' | 'genres' | 'cover' | 'summary' | 'entryType' | 'source'>>;

/**
 * 归一数据 → 落库字段（导入路径用）。
 *
 * 🔴 兜底链：**详情优先、列表值兜底**（`data.rating ?? r.rating`）——
 *    详情接口偶尔超时/限流（调用方 catch 后传空 data），这时至少保住收藏列表里自带的评分。
 * ⚠️ `developer` 恒为 `persons.studio ?? detail.studio`：旧代码 `importBangumiRows` 里那句
 *    `if (!input.genres?.length && detail.studio)` 的前置条件**永远成立**（该处 `genres` 建出来就是 `[]`），
 *    所以这里直接合并，不再传一个恒真的开关（传了只会让人以为它有用）。
 */
export function bangumiEntryFields(r: BangumiRowLike, data: BangumiDetailData): BangumiEntryFields {
    const out: BangumiEntryFields = {};
    const score = data.rating ?? r.rating;
    if (score != null) out.communityScore = score;
    const count = data.ratingCount ?? r.ratingCount;
    if (count != null) out.ratingCount = count;
    const developer = data.studio ?? r.studio;
    if (developer) out.developer = developer;
    const director = data.director ?? r.director;
    if (director) out.director = director;
    const cast = data.cast ?? r.cast;
    if (cast?.length) out.cast = cast;
    return out;
}

/**
 * 归一数据 → 搜索结果补全（`searchAnimeFresh` 用）。
 *
 * ⚠️ 与 `bangumiEntryFields` 的差异是**键名与语义**，不是抄两遍：
 *    搜索结果这里要的是 `BangumiSearchResult` 自己的 `rating` / `studio`，
 *    而且**只覆盖非空**（⛔ 不用 `??` 把列表已有的值清回 undefined）。
 */
export function bangumiSearchEnrich(r: BangumiSearchResult, data: BangumiDetailData): BangumiSearchResult {
    return {
        ...r,
        ...(data.rating != null ? { rating: data.rating } : {}),
        ...(data.ratingCount != null ? { ratingCount: data.ratingCount } : {}),
        ...(data.studio ? { studio: data.studio } : {}),
        ...(data.director ? { director: data.director } : {}),
        ...(data.cast?.length ? { cast: data.cast } : {}),
    };
}
