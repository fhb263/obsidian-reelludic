/**
 * TMDB 账号同步（#665）：想看清单（watchlist）+ 收藏（favorite）的拉取与解析。
 *
 * ## 用户口径
 * 「做 TMDB 的同步接入（同先参考金标准）」。
 *
 * ## 数据来源（TMDB v3 官方接口，见 developer.themoviedb.org ACCOUNT 组）
 *   · `GET /account/{account_id}/watchlist/movies` 与 `.../watchlist/tv`
 *   · `GET /account/{account_id}/favorite/movies` 与 `.../favorite/tv`
 *   · `GET /account`（拿 account_id；`session_id` 用 **query** 传，⛔ 不放 header）
 *
 * ## 🔴 鉴权现实（与搜索那套不同！）
 * 搜索/详情只要 **API Key**（v3 key，放 query）。而账号接口必须再有一个 **session_id**
 * （登录 TMDB → 设置 → API → 生成；或走 request-token 流程换）⇒ 同步 = **两份凭据**：
 *   · `tmdbApiKey`（已有）
 *   · `tmdbSessionId`（新增；与 Steam 的"Key + SteamID"双字段**同构**）
 * account_id 可以用 session_id 换回来（`GET /account?session_id=`）⇒ 用户**不用填**（少一个必填项）。
 *
 * ## 落点
 * 本模块**只做纯解析与 URL 构造**：JSON → 行对象。请求在 `services/tmdb.ts`（TmdbClient），
 * 落库在 `main`，弹窗复用豆瓣那套骨架。无 obsidian 依赖 ⇒ 可单测。
 */

/** 一条 watchlist / favorite 行（两个接口返回的 item 字段同构） */
export interface TmdbAccountItem {
    /** TMDB 条目 id（判重键） */
    id: number;
    /** 条目类型：movie / tv */
    mediaType: 'movie' | 'tv';
    /** 标题（movie=title，tv=name） */
    title: string;
    /** 原始标题（原始语言） */
    originalTitle: string;
    /** 上映/首播日期（YYYY-MM-DD 或 YYYY-MM） */
    releaseDate: string | null;
    /** 用户加进清单的日期（UNIX 秒；两个接口都有 `added_at`） */
    addedAt: number | null;
    /** 海报路径（`/xxx.jpg`；拼 base 才是完整 URL） */
    posterPath: string | null;
    /** 简介片段 */
    overview: string;
    /** TMDB 的 10 分制均分（社区分，不是用户分） */
    voteAverage: number;
}

/** 一页结果 */
export interface TmdbAccountPage {
    items: TmdbAccountItem[];
    page: number;
    /** 总条数（翻页判定用） */
    totalResults: number;
}

/** 同步范围：想看 / 收藏（各分 movie 与 tv） */
export type TmdbSyncList = 'watchlist' | 'favorite';

/** 账号同步的四个组合（一键全量 = 依次拉四份） */
export const TMDB_SYNC_COMBOS: ReadonlyArray<{ list: TmdbSyncList; mediaType: 'movie' | 'tv' }> = [
    { list: 'watchlist', mediaType: 'movie' },
    { list: 'watchlist', mediaType: 'tv' },
    { list: 'favorite', mediaType: 'movie' },
    { list: 'favorite', mediaType: 'tv' },
];

/** 展示名 */
export function tmdbComboLabel(list: TmdbSyncList, mediaType: 'movie' | 'tv'): string {
    const l = list === 'watchlist' ? '想看' : '收藏';
    const m = mediaType === 'movie' ? '电影' : '剧集';
    return `${m} · ${l}`;
}

/**
 * 账号接口地址（带 `session_id` 与 `language`）。
 * 🔴 `session_id` 是 **query 参数**不是 header（TMDB v3 的账号接口就这么定；header 里塞会 401）。
 */
export function tmdbAccountUrl(
    accountId: string | number,
    list: TmdbSyncList,
    mediaType: 'movie' | 'tv',
    sessionId: string,
    apiKey: string,
    page: number,
    lang: string = 'zh-CN',
): string {
    return `${API_BASE}/account/${encodeURIComponent(String(accountId))}/${list}/${mediaType}`
        + `?api_key=${encodeURIComponent(apiKey)}&session_id=${encodeURIComponent(sessionId)}`
        + `&language=${encodeURIComponent(lang)}&page=${page}&sort_by=created_at.desc`;
}

/** 当前账号（拿 account_id；同样要 session_id） */
export function tmdbAccountSelfUrl(sessionId: string, apiKey: string): string {
    return `${API_BASE}/account?api_key=${encodeURIComponent(apiKey)}&session_id=${encodeURIComponent(sessionId)}`;
}

const API_BASE = 'https://api.themoviedb.org/3';

/**
 * 解析账号接口返回（两个接口的 item 形态一致）。
 * 🔴 容错：条目缺 `id` / 标题 ⇒ **跳过不抛**（TMDB 加字段不致崩）；但整体 JSON 解析失败会抛（调用方提示）。
 */
export function parseTmdbAccountPage(text: string, mediaType: 'movie' | 'tv'): TmdbAccountPage {
    const o = JSON.parse(text) as Record<string, unknown>;
    const results = Array.isArray(o.results) ? (o.results as unknown[]) : [];
    const items: TmdbAccountItem[] = [];
    for (const raw of results) {
        const r = raw as Record<string, unknown>;
        const id = typeof r.id === 'number' ? r.id : 0;
        const title = typeof r.title === 'string' && r.title ? r.title : typeof r.name === 'string' ? r.name : '';
        if (!id || !title) continue;
        items.push({
            id,
            mediaType,
            title,
            originalTitle: typeof r.original_title === 'string' && r.original_title
                ? r.original_title
                : typeof r.original_name === 'string' ? r.original_name : title,
            releaseDate: typeof r.release_date === 'string' && r.release_date
                ? r.release_date
                : typeof r.first_air_date === 'string' ? r.first_air_date : null,
            addedAt: typeof r.added_at === 'number' ? r.added_at : null,
            posterPath: typeof r.poster_path === 'string' ? r.poster_path : null,
            overview: typeof r.overview === 'string' ? r.overview : '',
            voteAverage: typeof r.vote_average === 'number' ? r.vote_average : 0,
        });
    }
    return {
        items,
        page: typeof o.page === 'number' ? o.page : 1,
        totalResults: typeof o.total_results === 'number' ? o.total_results : items.length,
    };
}

/** 从 `GET /account` 的响应里拿 account_id（TMDB v3 的 id 字段就是账号 id） */
export function parseTmdbAccountId(text: string): string {
    const o = JSON.parse(text) as Record<string, unknown>;
    const id = typeof o.id === 'number' ? o.id : 0;
    if (!id) throw new Error('TMDB 账号响应里没有 account id —— 请确认 session_id 是否有效');
    return String(id);
}

/** TMDB 10 分制 → 本插件 1~5 星（`/2` 四舍五入；0 = 未评分） */
export function tmdbVoteToRating(vote: number): number {
    if (!Number.isFinite(vote) || vote <= 0) return 0;
    return Math.max(0, Math.min(5, Math.round(vote / 2)));
}

/** UNIX 秒 → `YYYY-MM-DD`（标记时间；解析不出 = null） */
export function tmdbAddedAtToISO(sec: number | null): string | null {
    if (sec === null || !Number.isFinite(sec) || sec <= 0) return null;
    const d = new Date(sec * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

/** 详情页网址（也作判重键的一部分：`/movie/<id>` / `/tv/<id>`） */
export function tmdbSubjectUrl(mediaType: 'movie' | 'tv', id: number): string {
    return `https://www.themoviedb.org/${mediaType}/${id}`;
}

/** 判重键（带类型前缀 —— movie 与 tv 的 id 空间独立，同号不合并） */
export function tmdbItemKey(mediaType: 'movie' | 'tv', id: number): string {
    return `tmdb:${mediaType}:${id}`;
}

/** 判重状态映射：想看 → want；收藏 → watched（收藏本身没有"在看"语义，⛔ 不硬造） */
export function tmdbListToStatus(list: TmdbSyncList): 'want' | 'watched' {
    return list === 'watchlist' ? 'want' : 'watched';
}
