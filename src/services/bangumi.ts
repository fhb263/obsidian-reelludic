// Bangumi（bgm.tv）动画元数据抓取（v0 API，Bearer token；纯逻辑：HTTP 注入可 mock）
// 1.0.3.1：书籍类目（type=1，含漫画）搜索随漫画子视图下线删除（用户 2026-09-13 裁定）——本客户端只服务动画。
// 🔴 2026-09-30 用户裁定**加回**书籍类目搜索：漫画源链 = 豆瓣（主）+ **Bangumi** + MangaDex（用户原话
//    「设置里漫画源接豆瓣、Bangumi、MangaDex 三个源」）⇒ 本客户端重新服务**动画 + 漫画**两组，
//    漫画用 `subjectType=1`（书籍类目，Bangumi 的漫画挂在这类下），走 `searchBooks`。
//    ⚠️ 与 1.0.3 那版不同：这次是**参数化**（`buildSearchBody` 的第三参），⛔ 别退回写死 `type: 1` 的独立函数。
import { asRecord, parseYear } from 'pure/record';
import type { BookSearchResult } from 'services/resultTypes';

export interface BangumiSearchResult {
    id: number;
    /** 条目类型（收藏列表解析：2=动画、6=电影；搜索/详情结果不设置，默认动画语义） */
    entryType?: 'anime' | 'movie';
    title: string;
    originalTitle: string;
    year?: number;
    /** 开播日期 YYYY-MM-DD（Bangumi 放送时间；追番表「开播季度」列数据源） */
    airDate?: string;
    genres: string[];
    /** 制作公司（infobox「动画制作」或 persons 公司） */
    studio?: string;
    /** 导演（persons API 补全，职业含「导演」） */
    director?: string;
    /** 主演/声优（persons API 补全，职业含「演员」「声优」等） */
    cast?: string[];
    cover?: string;
    summary?: string;
    /** 大众评分（数据源；Bangumi/豆瓣 10 分制） */
    rating?: number;
    /** 评分人数（subjects API rating.total，搜索结果无 → 详情补全写入） */
    ratingCount?: number;
    /** 来源标识：douban 兜底结果为 'douban'，原生 Bangumi 不设 */
    source?: string;
}

export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>;
export type HttpPost = (url: string, body: string, headers?: Record<string, string>) => Promise<string>;

const API_BASE = 'https://api.bgm.tv';
const SEARCH_URL = `${API_BASE}/v0/search/subjects`;
const ME_URL = `${API_BASE}/v0/me`;
const SUBJECT_URL = (id: number) => `${API_BASE}/v0/subjects/${id}`;
const PERSONS_URL = (id: number) => `${API_BASE}/v0/subjects/${id}/persons`;
const USER_COLLECTIONS_URL = (userId: number | string) => `${API_BASE}/v0/users/${userId}/collections`;

/** 搜索条数：Bangumi v0 API 单次上限 50，取 30 与其他数据源对齐；
 *  接口支持 offset 分页（limit=30&offset=30 拉下一页），如需完整结果集可加分页循环 */
export const BANGUMI_SEARCH_LIMIT = 30;

/** subject.type：**1 = 书籍类目（含漫画）**、2 = 动画、6 = 三次元。
 *  🔴 2026-09-30 用户裁定「漫画源接豆瓣、Bangumi、MangaDex 三个源」⇒ 漫画用 **type=1**（Bangumi 的漫画挂在书籍类目下）。 */
export const BANGUMI_BOOK_SUBJECT_TYPE = 1;

/** subject.type → 条目类型映射：2=动画（含剧场版动画电影）、6=三次元电影；其余（1书籍/3音乐/4游戏）跳过不入库 */
export function bangumiSubjectTypeToEntryType(type: unknown): 'anime' | 'movie' | null {
    if (type === 2 || type === '2') return 'anime';
    if (type === 6 || type === '6') return 'movie';
    return null;
}

/**
 * 构造搜索 POST body：keyword + type + limit（与"至少 30 条"要求一致）。
 * 🔴 2026-09-30：加第三参 `subjectType`（默认 **2 动画**，显式写出 —— 原来这个 2 是硬编码的），
 *    漫画走 `BANGUMI_BOOK_SUBJECT_TYPE`（1）。⚠️ 书籍类目搜索在 1.0.3.1 曾被整块删掉
 *    （随漫画子视图下线，2026-09-13 裁定），本次是**加回** —— 但换成了「按 subjectType 参数化」的形态，
 *    ⛔ 别再退回当年那个写死 `type: 1` 的独立函数。
 */
export function buildSearchBody(keyword: string, limit: number = BANGUMI_SEARCH_LIMIT, subjectType: number = 2): string {
    return JSON.stringify({ keyword, type: subjectType, limit });
}

/** 提取 infobox 中指定 key 的文本值（value 可为字符串或 {v: ...}） */
function infoboxValue(items: unknown, key: string): string | undefined {
    if (!Array.isArray(items)) return undefined;
    for (const it of items) {
        const box = asRecord(it);
        if (box.key === key) {
            const v = box.value;
            if (typeof v === 'string' && v) return v;
            const nested = asRecord(v);
            if (typeof nested.v === 'string' && nested.v) return nested.v;
        }
    }
    return undefined;
}

/**
 * 🔴 #445 总话数：把 infobox 里的「话数」值（字符串，可能是「全 139 话」这种带单位的）解析成非负整数，
 *    否则 `undefined`。⛔ 空串 / 非数字 / 负数 / NaN 一律不给（给 0 会覆盖用户手填值）。
 */
export function parseChapterCount(raw: string | undefined): number | undefined {
    if (!raw) return undefined;
    const m = /(\d+)/.exec(raw);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 解析 /v0/search/subjects 响应：name_cn 优先，回退 name；提取制作公司/年份/封面 */
export function parseBangumiResults(text: string): BangumiSearchResult[] {
    const data = asRecord(JSON.parse(text));
    const list = Array.isArray(data.data) ? data.data : [];
    return list
        .map(asRecord)
        .map((s) => {
            const images = asRecord(s.images);
            const tags = Array.isArray(s.tags) ? s.tags.map(asRecord).filter((t) => typeof t.name === 'string').map((t) => t.name as string) : [];
            return {
                id: typeof s.id === 'number' ? s.id : 0,
                title: (typeof s.name_cn === 'string' && s.name_cn) ? s.name_cn : (typeof s.name === 'string' ? s.name : ''),
                originalTitle: typeof s.name === 'string' ? s.name : '',
                year: parseYear(s.date),
                airDate: typeof s.date === 'string' ? s.date : undefined,
                genres: tags,
                studio: infoboxValue(s.infobox, '动画制作') ?? infoboxValue(s.infobox, '制作'),
                cover: typeof images.large === 'string' ? images.large : (typeof images.common === 'string' ? images.common : undefined),
                summary: typeof s.summary === 'string' ? s.summary : undefined,
                rating: typeof s.score === 'number' ? Number(s.score.toFixed(1)) : undefined,
            };
        })
        .filter((r) => r.title);
}

/**
 * 解析**书籍类目（type=1，含漫画）**搜索结果 → 本仓统一的 `BookSearchResult`。
 * 🔴 2026-09-30 加回（漫画源链第二源；用户裁定接 Bangumi）。
 * ⚠️ Bangumi 的书籍条目**没有**独立作者/出版社字段 —— 它们藏在 `infobox` 里（键名「作者」「出版社」「ISBN」），
 *    所以必须走 `infoboxValue`，别指望顶层字段。
 * ⛔ 别把结果塞进 `BangumiSearchResult`：那是动画/电影的形状（studio/airDate），塞了会丢作者与 ISBN。
 */
export function parseBangumiBookResults(text: string): BookSearchResult[] {
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        return [];
    }
    const list = Array.isArray(asRecord(root).data) ? (asRecord(root).data as unknown[]) : [];
    return list
        .map(asRecord)
        .map((s) => {
            const images = asRecord(s.images);
            const id = typeof s.id === 'number' ? s.id : 0;
            const tags = Array.isArray(s.tags)
                ? s.tags.map(asRecord).filter((t) => typeof t.name === 'string').map((t) => t.name as string)
                : [];
            return {
                id: id ? String(id) : '',
                // 中文名优先（与动画那条同一口径）
                title: (typeof s.name_cn === 'string' && s.name_cn) ? s.name_cn : (typeof s.name === 'string' ? s.name : ''),
                author: infoboxValue(s.infobox, '作者'),
                // 🔴 #444g 画师：Bangumi 书籍条目用 infobox 的「作画」表画师（与「作者」分开的两栏）
                artist: infoboxValue(s.infobox, '作画'),
                // 🔴 #445 总话数：Bangumi 书籍 infobox 的「话数」（漫画专用；缺失/非数一律不给）
                pageCount: parseChapterCount(infoboxValue(s.infobox, '话数')),
                publisher: infoboxValue(s.infobox, '出版社'),
                isbn: infoboxValue(s.infobox, 'ISBN'),
                year: parseYear(s.date),
                thumbnail: typeof images.large === 'string' ? images.large : (typeof images.common === 'string' ? images.common : undefined),
                description: typeof s.summary === 'string' ? s.summary : undefined,
                genres: tags.slice(0, 3),
                rating: typeof s.score === 'number' ? Number(s.score.toFixed(1)) : undefined,
                source: 'bangumi',
                sourceUrl: id ? `https://bgm.tv/subject/${id}` : undefined,
            };
        })
        .filter((r) => !!r.id && !!r.title);
}

/** 解析用户收藏列表响应（/v0/users/{id}/collections）：data[].subject → BangumiSearchResult（type 收藏状态忽略；subject.type 决定条目类型 2动画/6电影，其余跳过） */
export function parseBangumiCollections(text: string): BangumiSearchResult[] {    const data = asRecord(JSON.parse(text));
    const list = Array.isArray(data.data) ? data.data : [];
    return list
        .map(asRecord)
        .map((c): BangumiSearchResult | null => {
            const s = asRecord(c.subject);
            const entryType = bangumiSubjectTypeToEntryType(s.type);
            // 非动画/电影（书籍/音乐/游戏）不入库
            if (!entryType) return null;
            const images = asRecord(s.images);
            const hasName = typeof s.name === 'string' && !!s.name;
            const hasNameCn = typeof s.name_cn === 'string' && !!s.name_cn;
            if (!hasName && !hasNameCn) return null;
            return {
                id: typeof s.id === 'number' ? s.id : 0,
                entryType,
                title: hasNameCn ? (s.name_cn as string) : (s.name as string),
                originalTitle: hasName ? (s.name as string) : '',
                year: parseYear(s.date),
                airDate: typeof s.date === 'string' ? s.date : undefined,
                genres: [] as string[],
                rating: typeof s.score === 'number' ? Number(s.score.toFixed(1)) : undefined,
                cover: typeof images.large === 'string' ? images.large : undefined,
                summary: typeof s.summary === 'string' ? s.summary : undefined,
            };
        })
        .filter((r): r is BangumiSearchResult => r !== null);
}

/** 解析 /v0/subjects/{id} 响应：补全评分+评价人数（搜索结果可能无 score，详情 API 一定有） */
export function parseBangumiSubject(text: string): { rating?: number; ratingCount?: number; studio?: string } {
    const obj = asRecord(JSON.parse(text));
    const rating = asRecord(obj.rating);
    const score = rating.score;
    const total = rating.total;
    const studio = infoboxValue(obj.infobox, '动画制作') ?? infoboxValue(obj.infobox, '制作');
    return {
        rating: typeof score === 'number' ? Number(score.toFixed(1)) : undefined,
        ratingCount: typeof total === 'number' ? total : undefined,
        studio: typeof studio === 'string' ? studio : undefined,
    };
}

/** 解析 /v0/subjects/{id}/persons 响应：导演/主演/制作公司（type=1 个人按职业拆分）。
 *  ⚠️ 真实响应为**裸数组** RelatedPerson[]（官方 OpenAPI 200 schema），历史实现误按
 *  `{"data":[...]}` 包装解析导致恒返回空（导演永远取不到）——现两种形态都兼容。 */
export function parseBangumiPersons(text: string): { director?: string; cast?: string[]; studio?: string } {
    const parsed: unknown = JSON.parse(text);
    const wrap = asRecord(parsed);
    const list: unknown[] = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(wrap.data) ? wrap.data : []);
    if (list.length === 0) return {};
    let director: string | undefined;
    let studio: string | undefined;
    const cast: string[] = [];
    for (const item of list) {
        const p = asRecord(item);
        // type 兼容数字 1 或字符串 '1'（Bangumi API 不同版本可能返回字符串）
        const isPerson = p.type === 1 || p.type === '1';
        if (isPerson) {
            const name = typeof p.name === 'string' ? p.name : undefined;
            if (name) {
                const career = Array.isArray(p.career) ? p.career.map((c) => String(c)) : [];
                // 职业：导演/监督/演出 → director；演员/声优/主役/出演 → cast
                if (career.some((c) => /导演|监督|演出/.test(c))) {
                    director = director ? `${director} / ${name}` : name;
                } else if (career.some((c) => /演员|声优|主役|出演/.test(c))) {
                    if (!cast.includes(name)) cast.push(name);
                }
            }
        } else if (p.type === 2 || p.type === '2') {
            // 公司：制作公司
            const cname = typeof p.name === 'string' ? p.name : undefined;
            if (cname && !studio) studio = cname;
        }
    }
    return { director, cast: cast.length ? cast : undefined, studio };
}

function authHeaders(token: string): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'reelludic/0.0.1',
    };
}

export class BangumiClient {
    readonly name = 'bangumi';

    constructor(
        private token: string,
        private httpGet: HttpGet,
        private httpPost: HttpPost,
    ) {}

    async search(keyword: string): Promise<BangumiSearchResult[]> {
        const text = await this.httpPost(SEARCH_URL, buildSearchBody(keyword), authHeaders(this.token));
        return parseBangumiResults(text);
    }

    /**
     * 🔴 2026-09-30 加回：**书籍类目（type=1，含漫画）**搜索 —— 漫画源链的第二源（用户裁定）。
     * ⚠️ 需要 Access Token（与动画搜索同一枚）；未配置时上层 `providerConfigured('bangumi')` 会判 false，
     *    该源在链里**静默降级**（状态 unconfigured），不会让整组搜索失败。
     */
    async searchBooks(keyword: string): Promise<BookSearchResult[]> {
        const body = buildSearchBody(keyword, BANGUMI_SEARCH_LIMIT, BANGUMI_BOOK_SUBJECT_TYPE);
        const text = await this.httpPost(SEARCH_URL, body, authHeaders(this.token));
        return parseBangumiBookResults(text);
    }

    /** 详情补全：/v0/subjects/{id}（评分+评价人数+制作公司） */
    async fetchSubject(id: number): Promise<{ rating?: number; ratingCount?: number; studio?: string }> {
        const text = await this.httpGet(SUBJECT_URL(id), authHeaders(this.token));
        return parseBangumiSubject(text);
    }

    /** 详情补全：/v0/subjects/{id}/persons（导演+主演+公司） */
    async fetchPersons(id: number): Promise<{ director?: string; cast?: string[]; studio?: string }> {
        const text = await this.httpGet(PERSONS_URL(id), authHeaders(this.token));
        return parseBangumiPersons(text);
    }

    /** 用户收藏列表（追番表「从 Bangumi 导入」）：type 0想看/1看过/2在看/3搁置/4抛弃 */
    async fetchUserCollections(userId: number | string, type: 0 | 1 | 2 | 3 | 4): Promise<BangumiSearchResult[]> {
        const url = `${USER_COLLECTIONS_URL(userId)}?type=${type}&limit=50&offset=0`;
        const text = await this.httpGet(url, authHeaders(this.token));
        return parseBangumiCollections(text);
    }

    /** 当前用户信息（/v0/me）：批量导入时若未填用户 ID 可自动获取 */
    async fetchMe(): Promise<{ id: number; username: string; nickname: string }> {
        const text = await this.httpGet(ME_URL, authHeaders(this.token));
        const o = asRecord(JSON.parse(text));
        return {
            id: typeof o.id === 'number' ? o.id : 0,
            username: typeof o.username === 'string' ? o.username : '',
            nickname: typeof o.nickname === 'string' ? o.nickname : '',
        };
    }

    /** 测试 token 有效性：GET /v0/me 返回当前用户信息 */
    async testConnection(): Promise<void> {
        await this.httpGet(ME_URL, authHeaders(this.token));
    }
}
