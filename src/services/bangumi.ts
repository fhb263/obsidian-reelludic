// Bangumi（bgm.tv）动画元数据抓取（v0 API，Bearer token；纯逻辑：HTTP 注入可 mock）
import { asRecord, parseYear } from 'pure/record';

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

/** subject.type → 条目类型映射：2=动画（含剧场版动画电影）、6=三次元电影；其余（1书籍/3音乐/4游戏）跳过不入库 */
export function bangumiSubjectTypeToEntryType(type: unknown): 'anime' | 'movie' | null {
    if (type === 2 || type === '2') return 'anime';
    if (type === 6 || type === '6') return 'movie';
    return null;
}

/** 构造搜索 POST body：keyword + type(2=动画) + limit（与"至少 30 条"要求一致） */
export function buildSearchBody(keyword: string, limit: number = BANGUMI_SEARCH_LIMIT): string {
    return JSON.stringify({ keyword, type: 2, limit });
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

/** 解析用户收藏列表响应（/v0/users/{id}/collections）：data[].subject → BangumiSearchResult（type 收藏状态忽略；subject.type 决定条目类型 2动画/6电影，其余跳过） */
export function parseBangumiCollections(text: string): BangumiSearchResult[] {
    const data = asRecord(JSON.parse(text));
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
