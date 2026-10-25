// TMDB 元数据抓取（纯逻辑：HTTP 注入，可 mock 单测）
import { asRecord, parseYear } from 'pure/record';

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

export type HttpGet = (url: string) => Promise<string>;

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
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function buildSearchUrl(apiKey: string, query: string, mediaType: 'movie' | 'tv', lang: string, page: number = 1): string {
    const endpoint = mediaType === 'movie' ? 'search/movie' : 'search/tv';
    return `${API_BASE}/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=${lang}&page=${page}`;
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

export function posterUrl(path: string | undefined, size: string = 'w500'): string | undefined {
    if (!path) return undefined;
    return `${IMAGE_BASE}/${size}${path}`;
}

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
    ) {}

    /**
     * 搜索：并发拉取 page 1 + page 2（TMDB 单页最多 20 条），按 id 去重合并后截断到 30，
     * 保证「至少 30 条」结果。无结果或失败时返回空数组。
     */
    async search(query: string, mediaType: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
        const cap = 30;
        const [t1, t2] = await Promise.all([
            this.http(buildSearchUrl(this.apiKey, query, mediaType, this.lang, 1)),
            this.http(buildSearchUrl(this.apiKey, query, mediaType, this.lang, 2)),
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
        const detailUrl = `${base}?api_key=${this.apiKey}&language=${this.lang}`;
        const creditsUrl = `${base}/credits?api_key=${this.apiKey}&language=${this.lang}`;
        const [detailText, creditsText] = await Promise.all([this.http(detailUrl), this.http(creditsUrl)]);
        return parseDetail(detailText, creditsText, mediaType);
    }

    // ── 🔴 #665 账号同步（watchlist / favorite；需要 session_id）──────────────────

    /** 当前账号（拿 account_id；同步入口用，用户 ⛔ 不用单独填 account id） */
    async accountId(sessionId: string): Promise<string> {
        const text = await this.http(tmdbAccountSelfUrl(sessionId, this.apiKey));
        return parseTmdbAccountId(text);
    }

    /** 拉账号清单的一页（watchlist / favorite × movie / tv） */
    async accountPage(sessionId: string, accountId: string, list: TmdbSyncList, mediaType: 'movie' | 'tv', page: number): Promise<TmdbAccountPage> {
        const text = await this.http(tmdbAccountUrl(accountId, list, mediaType, sessionId, this.apiKey, page, this.lang));
        return parseTmdbAccountPage(text, mediaType);
    }

    /** 拉某一份清单的**全部**条目（翻页直到够 total；TMDB 每页 20 条） */
    async accountItems(sessionId: string, list: TmdbSyncList, mediaType: 'movie' | 'tv'): Promise<TmdbAccountItem[]> {
        const sid = sessionId.trim();
        if (!sid) throw new Error('未配置 TMDB Session ID —— 到 themoviedb.org「设置 → API」生成后填入，账号同步需要它');
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
