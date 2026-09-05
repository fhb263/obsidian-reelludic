// OMDb（IMDb 数据）影视元数据（需 Key 1000 次/日；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://www.omdbapi.com/?apikey={key}&s={q}&type=movie|series&page=1（URL 编码）
//   - type 参数由调用方 mediaType 决定：'movie'→movie、'tv'→series；parse 侧再按 Type 过滤
//     （双保险：type= 之外的异常条目/服务端放宽不混入，决策见 tests/omdb.test.ts）
//   - 未配 key → runner 不启动（main providerConfigured → unconfigured，不请求）
// 结果类型决策（#165 T9）：omdb imdbID 为字符串，禁止强塞 TmdbSearchResult(id:number)。
//   OmdbSearchResult 定义于 resultTypes.ts（独立类型，可选子集 + id/imdbID 双字符串），
//   影视 shape 分支经未知读安全兼容（缺字段不崩）；merge/sort 仅依赖 title/source。
// 点选补全：?apikey={key}&i={imdbID}&plot=full → Title/Year/Director/Actors(截5)/Genre(截3)/
//   Plot/Poster/imdbRating/imdbVotes(去逗号) → 表单可填投影 Record（applyDoubanDetail 键名对齐）。
import { asRecord, parseYear } from 'pure/record';
import type { OmdbSearchResult } from 'services/resultTypes';

/** 注入 HTTP GET（URL 参数化；测试 mock 断言 URL 形态） */
export type HttpGet = (url: string) => Promise<string>;

const API_BASE = 'https://www.omdbapi.com';

/** mediaType（影视条目类型 movie/tv）→ OMDb type 参数（tv 归一到 series） */
export function omdbTypeOf(mediaType: 'movie' | 'tv'): 'movie' | 'series' {
    return mediaType === 'tv' ? 'series' : 'movie';
}

/** 构造搜索 URL（type=movie|series + page=1；测试用 fixture 快照固定） */
export function buildSearchUrl(apiKey: string, query: string, mediaType: 'movie' | 'tv'): string {
    return `${API_BASE}/?apikey=${apiKey}&s=${encodeURIComponent(query)}&type=${omdbTypeOf(mediaType)}&page=1`;
}

/** 构造详情 URL（i={imdbID}；plot 默认 full，测试连接 ping 用 short） */
export function buildDetailUrl(apiKey: string, imdbID: string, plot: 'short' | 'full' = 'full'): string {
    return `${API_BASE}/?apikey=${apiKey}&i=${imdbID}&plot=${plot}`;
}

/** 安全解析 JSON：非 JSON / 顶层非对象 → {}（服务端错误体 / 网关页不崩） */
function safeJsonObject(text: string): Record<string, unknown> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return {};
    }
    return asRecord(data);
}

/** OMDb 无值占位 'N/A'（也兼容 'n/a'）→ undefined；空串/非字符串 → undefined */
function naOrString(v: unknown): string | undefined {
    if (typeof v !== 'string' || !v) return undefined;
    return v.trim().toUpperCase() === 'N/A' ? undefined : v.trim();
}

/** 海报：'N/A' 滤除 → undefined（UI 占位图兜底） */
function posterOrUndefined(v: unknown): string | undefined {
    return naOrString(v);
}

/** 逗号分隔串 → 截前 n 项的干净数组（'A, B, C' → ['A','B','C']；缺省/占位 → undefined） */
function splitN(v: unknown, n: number): string[] | undefined {
    const s = naOrString(v);
    if (!s) return undefined;
    const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
    return parts.length > 0 ? parts.slice(0, n) : undefined;
}

/** 数字串解析：千分位去逗号（'2,396,672' → 2396672）；'9.3' → 9.3；N/A/NaN → undefined */
function numOrUndefined(v: unknown): number | undefined {
    const s = naOrString(v);
    if (!s) return undefined;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
}

/**
 * 解析搜索响应 Search[] → OmdbSearchResult[]（#165 T9）。
 * - id=imdbID（字符串，见结果类型决策）；title=Title；year=Year 前 4 位（`1994`/`1994–`/`1994-2000` 容错）；
 *   poster：'N/A'→undefined；source='omdb'；sourceUrl=imdb.com/title/{imdbID} 同源拼接。
 * - 过滤：缺 imdbID/Title 的异常条目滤除；按 mediaType 过滤 Type（movie 收 movie / tv 收 series）。
 * - Search 缺失 / Response=False 错误体 / 非 JSON → 空数组（HTTP 200 的错误体安全降级为空结果）。
 */
export function parseOmdbResults(text: string, mediaType: 'movie' | 'tv'): OmdbSearchResult[] {
    const data = safeJsonObject(text);
    const search = Array.isArray(data.Search) ? data.Search : [];
    const keepType = omdbTypeOf(mediaType);
    return search
        .map(asRecord)
        .filter((r) => r.Type === keepType) // type= 参数之外的过滤：不混入非目标 type 条目
        .filter((r) => typeof r.imdbID === 'string' && r.imdbID !== '' && typeof r.Title === 'string' && r.Title !== '')
        .map((r) => {
            const imdbID = r.imdbID as string;
            return {
                id: imdbID,
                imdbID,
                title: r.Title as string,
                year: parseYear(naOrString(r.Year)),
                poster: posterOrUndefined(r.Poster),
                source: 'omdb' as const,
                sourceUrl: `https://www.imdb.com/title/${imdbID}`,
            };
        });
}

/** 详情解析后的表单可填投影（字段键名对齐 EntryForm.applyDoubanDetail 读取 + rating 供评分回填） */
export interface OmdbDetailFields {
    title?: string;
    year?: number;
    director?: string;
    cast?: string[];
    genres?: string[];
    summary?: string;
    cover?: string;
    rating?: number;
    ratingCount?: number;
}

/**
 * 解析详情响应（?i={imdbID}&plot=full）→ OmdbDetailFields 投影。
 * - Title/Year/Director/Plot/Poster 直读；Actors 截 5 / Genre 截 3（逗号分隔）；
 *   imdbVotes 去逗号 → ratingCount；imdbRating → rating（IMDb 10 分制）。
 * - 'N/A' 占位与缺字段一律安全读取（→ undefined），不因缺字段崩。
 * - Response=False（错误体）/ 非 JSON / 非对象 → null（调用方失败静默）。
 */
export function parseOmdbDetail(text: string): OmdbDetailFields | null {
    const d = safeJsonObject(text);
    if (d.Response === 'False') return null;
    const title = naOrString(d.Title);
    // 无任何可回填内容（连 Title 都没有的无效体）→ null
    if (!title && !d.Plot && !d.imdbRating) return null;
    return {
        title,
        year: parseYear(naOrString(d.Year)),
        director: naOrString(d.Director),
        cast: splitN(d.Actors, 5),
        genres: splitN(d.Genre, 3),
        summary: naOrString(d.Plot),
        cover: posterOrUndefined(d.Poster),
        rating: numOrUndefined(d.imdbRating),
        ratingCount: numOrUndefined(d.imdbVotes),
    };
}

export class OmdbClient {
    readonly name = 'omdb';

    constructor(
        private apiKey: string,
        private http: HttpGet,
    ) {}

    /** 搜索 → OmdbSearchResult[]（mediaType movie/tv 归一 OMDb type movie/series；未配 key 不发起） */
    async search(query: string, mediaType: 'movie' | 'tv'): Promise<OmdbSearchResult[]> {
        if (!this.apiKey) return [];
        const text = await this.http(buildSearchUrl(this.apiKey, query, mediaType));
        return parseOmdbResults(text, mediaType);
    }

    /** 点选补全：i={imdbID}&plot=full → 表单可填投影；错误体/失败由调用方 catch → null 静默 */
    async detail(imdbID: string): Promise<OmdbDetailFields | null> {
        if (!this.apiKey || !imdbID) return null;
        const text = await this.http(buildDetailUrl(this.apiKey, imdbID, 'full'));
        return parseOmdbDetail(text);
    }
}
