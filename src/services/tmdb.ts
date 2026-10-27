// TMDB 元数据抓取（纯逻辑：HTTP 注入，可 mock 单测）
import { asRecord, parseYear } from 'pure/record';
import { tmdbAuthHeaders, tmdbApiKeyQuery, tmdbSessionNeedsConvert, parseTmdbConvertedSessionId } from 'pure/tmdbAuth';

export interface TmdbSearchResult {
    id: number;
    title: string;
    originalTitle: string;
    year?: number;
    mediaType: 'movie' | 'tv';
    posterPath?: string;
    overview?: string;
    /** 导演（仅豆瓣兜底详情回填时有值；TMDB 需另拉详情） */
    director?: string;
    /** 编剧（豆瓣兜底） */
    screenwriter?: string[];
    /** 主演（豆瓣兜底） */
    cast?: string[];
    /** 类型（豆瓣兜底） */
    genres?: string[];
    /** 制片国家/地区（豆瓣兜底） */
    country?: string;
    /** 语言（豆瓣兜底） */
    language?: string;
    /** 片长分钟（豆瓣兜底） */
    durationMin?: number;
    /** 又名（豆瓣兜底） */
    aliases?: string[];
    /** 集数（豆瓣兜底，电视剧） */
    episodeCount?: number;
    /** 大众评分（数据源；TMDB/豆瓣 10 分制） */
    rating?: number;
    /** 豆瓣评价人数（仅豆瓣兜底结果有值，「评分（N人评价）」展示） */
    ratingCount?: number;
    /** 来源标记：douban 兜底结果（posterPath 为完整 URL，不经 TMDB 图片拼接） */
    source?: 'tmdb' | 'douban';
}

export interface TmdbDetail {
    title: string;
    originalTitle: string;
    year: number;
    genres: string[];
    director?: string;
    cast: string[];
    overview?: string;
    /** 大众评分（详情 vote_average，10 分制） */
    rating?: number;
    /** 评价人数（详情 vote_count） */
    ratingCount?: number;
}

/**
 * 注入的 HTTP GET。第二参是**可选**请求头（v4 Read Access Token 走 `Authorization: Bearer` 才需要）。
 * ⛔ 保持可选，才不会打断既有 4 处单测的 `async (url) => ...` 写法。
 */
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>;

/**
 * 注入的 HTTP POST（JSON body）。**可选** —— 只有「v4 access_token → v3 session_id」的转换要用它；
 * ⛔ 保持可选，才不会打断既有全部 `new TmdbClient(key, get)` 的写法与单测。
 */
export type HttpPost = (url: string, body: string, headers?: Record<string, string>) => Promise<string>;

// 🔴 #665：账号同步的 URL 构造 / 解析 / 判重键（纯模块，⛔ 别在这里另写一份）
import {
    tmdbAccountSelfUrl,
    tmdbAccountUrl,
    parseTmdbAccountId,
    parseTmdbAccountPage,
    type TmdbAccountItem,
    type TmdbAccountPage,
    type TmdbSyncList,
} from 'pure/tmdbSync';

/** 可插拔元数据源（豆瓣兜底实现此接口，默认关闭） */
export interface MetadataSource {
    readonly name: string;
    search(query: string, mediaType: 'movie' | 'tv'): Promise<TmdbSearchResult[]>;
}

const API_BASE = 'https://api.themoviedb.org/3';

export function buildSearchUrl(apiKey: string, query: string, mediaType: 'movie' | 'tv', lang: string, page: number = 1): string {
    const endpoint = mediaType === 'movie' ? 'search/movie' : 'search/tv';
    // 凭据分流：v3 key ⇒ `&api_key=`；v4 JWT ⇒ 空串（认证在 header）
    return `${API_BASE}/${endpoint}?query=${encodeURIComponent(query)}&language=${lang}&page=${page}${tmdbApiKeyQuery(apiKey)}`;
}

/** 解析搜索结果 JSON（movie 用 title，tv 用 name；无标题的结果过滤；不截断，由调用方按需 cap） */
export function parseSearchResults(text: string, mediaType: 'movie' | 'tv'): TmdbSearchResult[] {
    const data = asRecord(JSON.parse(text));
    const results = Array.isArray(data.results) ? data.results : [];
    return results
        .map(asRecord)
        .filter((r) => typeof (mediaType === 'movie' ? r.title : r.name) === 'string')
        .map((r) => ({
            id: typeof r.id === 'number' ? r.id : 0,
            title: ((mediaType === 'movie' ? r.title : r.name) as string) ?? '',
            originalTitle: ((mediaType === 'movie' ? r.original_title : r.original_name) as string) ?? '',
            year: parseYear(mediaType === 'movie' ? r.release_date : r.first_air_date),
            mediaType,
            posterPath: typeof r.poster_path === 'string' ? r.poster_path : undefined,
            overview: typeof r.overview === 'string' ? r.overview : undefined,
            rating: typeof r.vote_average === 'number' ? Number(r.vote_average.toFixed(1)) : undefined,
            ratingCount: typeof r.vote_count === 'number' ? r.vote_count : undefined,
        }))
        .filter((r) => r.id > 0);
}

// 实现在 pure/tmdbImage（P1-8：让 pure 层能取到它，不必反向值导入 services）。
// 这里保留同名 export ⇒ `main.ts:30` 与 `tests/tmdb.test.ts:6` 的既有 import 路径不变。
export { posterUrl } from 'pure/tmdbImage';

/** 解析详情 + 演职员 JSON */
export function parseDetail(detailText: string, creditsText: string, mediaType: 'movie' | 'tv'): TmdbDetail {
    const d = asRecord(JSON.parse(detailText));
    const c = asRecord(JSON.parse(creditsText));
    const genres = Array.isArray(d.genres) ? d.genres.map((g) => (asRecord(g).name as string) ?? '').filter(Boolean) : [];
    const crew = Array.isArray(c.crew) ? c.crew.map(asRecord) : [];
    const director = crew.find((m) => m.job === 'Director' && typeof m.name === 'string')?.name as string | undefined;
    const cast = Array.isArray(c.cast)
        ? c.cast.map(asRecord).filter((m) => typeof m.name === 'string').slice(0, 10).map((m) => m.name as string)
        : [];
    return {
        title: ((mediaType === 'movie' ? d.title : d.name) as string) ?? '',
        originalTitle: ((mediaType === 'movie' ? d.original_title : d.original_name) as string) ?? '',
        year: parseYear(mediaType === 'movie' ? d.release_date : d.first_air_date) ?? 0,
        genres,
        director,
        cast,
        overview: typeof d.overview === 'string' ? d.overview : undefined,
        rating: typeof d.vote_average === 'number' ? Number(d.vote_average.toFixed(1)) : undefined,
        ratingCount: typeof d.vote_count === 'number' ? d.vote_count : undefined,
    };
}

export class TmdbClient implements MetadataSource {
    readonly name = 'tmdb';

    constructor(
        private apiKey: string,
        private http: HttpGet,
        private lang: string = 'zh-CN',
        /** 可选：只有「v4 access_token → v3 session_id」的转换要用；未注入时转换路径给出明确报错 */
        private httpPost?: HttpPost,
    ) {}

    /**
     * 本客户端该带的请求头：v4 token ⇒ `{ Authorization: Bearer ... }`；v3 key ⇒ **`undefined`**。
     * 🔴 v3 必须给 `undefined` 而不是 `{}`：宿主 `main.ts` 用 `headers ? {url,headers} : {url}` 分流，
     *   传 `{}` 会让 v3 路径也走带 headers 的分支 —— 虽然无害，但「v3 行为与旧版完全一致」这条就说不清了。
     */
    private authHeaders(): Record<string, string> | undefined {
        const h = tmdbAuthHeaders(this.apiKey);
        return Object.keys(h).length > 0 ? h : undefined;
    }

    /**
     * 搜索：并发拉取 page 1 + page 2（TMDB 单页最多 20 条），按 id 去重合并后截断到 30，
     * 保证「至少 30 条」结果。无结果或失败时返回空数组。
     */
    async search(query: string, mediaType: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
        const cap = 30;
        // v4 token 必须带 Authorization 头；v3 key 时是空对象
        const headers = this.authHeaders();
        const [t1, t2] = await Promise.all([
            this.http(buildSearchUrl(this.apiKey, query, mediaType, this.lang, 1), headers),
            this.http(buildSearchUrl(this.apiKey, query, mediaType, this.lang, 2), headers),
        ]);
        const r1 = parseSearchResults(t1, mediaType);
        const r2 = parseSearchResults(t2, mediaType);
        const seen = new Set<number>();
        const merged: TmdbSearchResult[] = [];
        for (const r of [...r1, ...r2]) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            merged.push(r);
            if (merged.length >= cap) break;
        }
        return merged;
    }

    async detail(id: number, mediaType: 'movie' | 'tv'): Promise<TmdbDetail> {
        const base = `${API_BASE}/${mediaType}/${id}`;
        const headers = this.authHeaders();
        const detailUrl = `${base}?language=${this.lang}${tmdbApiKeyQuery(this.apiKey)}`;
        const creditsUrl = `${base}/credits?language=${this.lang}${tmdbApiKeyQuery(this.apiKey)}`;
        const [detailText, creditsText] = await Promise.all([this.http(detailUrl, headers), this.http(creditsUrl, headers)]);
        return parseDetail(detailText, creditsText, mediaType);
    }

    // ── 🔴 #665 / 2026-10-25 账号同步（watchlist / favorite；需要 session_id）──────────

    /**
     * 把用户填进「Session ID」那一格的值，统一换成**真 · v3 session_id**。
     *
     * 🔴🔴 2026-10-25 用户报障：「我是用 TMDB v4 用户认证操作流程…⑤在设置页该元数据源凭据行下填写 Session ID
     *   …获取的但依然同步不了」。
     *   v4 用户认证（`/4/auth/request_token` → 浏览器批准 → `/4/auth/access_token`）拿到的是 `access_token`，
     *   **不是** v3 session_id；用户按官方流程走完，最后一步自然会把 access_token 填进 Session ID 栏。
     *   ⇒ 这里调官方 `POST /3/authentication/session/convert/4` 现场换。
     *
     * 性能：每轮同步会调用两三次（accountId + 若干 accountPage 复用同一个 sid），
     *   所以**缓存**在客户端实例上；凭据变更时 `main.ts` 会 `rebuildClients()` 重建实例，缓存自动失效。
     */
    private sessionIdCache = new Map<string, string>();

    private async resolveSessionId(raw: string): Promise<string> {
        const sid = raw.trim();
        if (!sid) throw new Error('未配置 TMDB access_token —— 见设置页提示填入（v4 用户认证拿到的 eyJ 长串）');
        if (!tmdbSessionNeedsConvert(sid)) return sid;
        const cached = this.sessionIdCache.get(sid);
        if (cached) return cached;
        if (!this.httpPost) {
            // 单测/无 POST 通道的环境：说清楚是缺通道，⛔ 别让它退化成难懂的 401
            throw new Error('TMDB 会话转换不可用 —— 当前环境没有注入 POST 通道（插件正常运行时不会出现）');
        }
        const body = JSON.stringify({ access_token: sid });
        // 🔴 2026-10-25 用户裁定（原文：「按官方改：用 32 位 Key 做 api_key 鉴权（用 v3 读数据、用 v4 管账户）」）：
        //   `/3/authentication/session/convert/4` 是**v3 认证接口**，鉴权走 `?api_key=`，
        //   body 里的 `access_token` 只是「要换掉的那张票」，⛔ 不是本请求的凭据。
        //   旧版把 access_token 自己当 `Authorization: Bearer` 用 —— 官方 OpenAPI 与 golang-tmdb /
        //   tmdb_api 两个实现都只给 `?api_key=`，那样写随时可能在官方收紧鉴权时整条断掉。
        //   ⚠️ 兼容：若第一格历史上存的是 v4 Read Access Token（老配置），退回 Bearer 那套，
        //     否则 `tmdbApiKeyQuery` 返回空串会把鉴权整个丢掉。
        const keyQuery = tmdbApiKeyQuery(this.apiKey);
        const convertUrl = keyQuery
            ? `${API_BASE}/authentication/session/convert/4?${keyQuery.slice(1)}`
            : `${API_BASE}/authentication/session/convert/4`;
        const text = await this.httpPost(convertUrl, body, keyQuery ? undefined : tmdbAuthHeaders(this.apiKey));
        const v3 = parseTmdbConvertedSessionId(text);
        this.sessionIdCache.set(sid, v3);
        return v3;
    }

    /** 当前账号（拿 account_id；同步入口用，用户 ⛔ 不用单独填 account id） */
    async accountId(sessionId: string): Promise<string> {
        const sid = await this.resolveSessionId(sessionId);
        const text = await this.http(tmdbAccountSelfUrl(sid, this.apiKey), this.authHeaders());
        return parseTmdbAccountId(text);
    }

    /** 拉账号清单的一页（watchlist / favorite × movie / tv） */
    async accountPage(sessionId: string, accountId: string, list: TmdbSyncList, mediaType: 'movie' | 'tv', page: number): Promise<TmdbAccountPage> {
        const sid = await this.resolveSessionId(sessionId);
        const text = await this.http(
            tmdbAccountUrl(accountId, list, mediaType, sid, this.apiKey, page, this.lang),
            this.authHeaders(),
        );
        return parseTmdbAccountPage(text, mediaType);
    }

    /** 拉某一份清单的**全部**条目（翻页直到够 total；TMDB 每页 20 条） */
    async accountItems(sessionId: string, list: TmdbSyncList, mediaType: 'movie' | 'tv'): Promise<TmdbAccountItem[]> {
        // ⚠️ 这里传的应当是 v4 access_token（`eyJ...`）—— 由 `resolveSessionId` 换成 v3 session_id；
        //    老配置里的 32 位 v3 session_id 仍原样放行（兼容，不是承诺）
        const sid = sessionId.trim();
        if (!sid) {
            throw new Error('未配置 TMDB access_token —— 见设置页提示填入 v4 用户认证拿到的 eyJ 长串，账号同步需要它');
        }
        const accountId = await this.accountId(sid);
        const all: TmdbAccountItem[] = [];
        const seen = new Set<number>();
        for (let page = 1; page <= 500; page++) {
            const p = await this.accountPage(sid, accountId, list, mediaType, page);
            for (const it of p.items) {
                if (seen.has(it.id)) continue;
                seen.add(it.id);
                all.push(it);
            }
            // 翻页判定用 total_results（⛔ 不靠"这页不满 20"猜——同 #662 豆瓣那条教训）
            if (p.items.length === 0 || all.length >= p.totalResults) break;
        }
        return all;
    }
}
