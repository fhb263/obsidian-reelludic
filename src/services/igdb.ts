// IGDB 游戏检索（Twitch 开发者凭据；纯逻辑：HTTP 注入可 mock）
// 鉴权：POST id.twitch.tv/oauth2/token（client_credentials）取 app access_token（缓存至过期前 60s）
// 搜索：POST api.igdb.com/v4/games，Apicalypse body：search "q"; fields ...; limit 30;
//   响应 JSON 数组 → GameSearchResult（对齐 resultTypes.GameSearchResult；publisher 由豆瓣兜底详情填，此处不产）
// 历史：v0.3 曾接入 IGDB → 因需 Twitch OAuth/审核门槛高被 RAWG 替代 → RAWG 删除 → 现按用户要求重新接入
//   （复用设置遗留字段 igdbClientId/igdbClientSecret；双凭据源首例，ProviderMeta.keyField2 见 sourceRegistry）
import { asRecord } from 'pure/record';
import type { GameSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string) => Promise<string>;
export type HttpPost = (url: string, body: string, headers?: Record<string, string>) => Promise<string>;

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GAMES_URL = 'https://api.igdb.com/v4/games';
const COVER_BASE = 'https://images.igdb.com/igdb/image/upload';
/** IGDB 封面尺寸后缀（t_cover_big ≈ 264x352 竖版；对齐旧接入校准值） */
const COVER_SIZE = 't_cover_big';
/** 单次搜索返回上限（与 #165「搜索结果 30+」对齐） */
const SEARCH_LIMIT = 30;

export interface IgdbToken {
    access_token: string;
    expires_in: number;
}

/** 解析 token 响应（access_token + 有效期秒数；异常/空 → 空串 + 0） */
export function parseToken(text: string): IgdbToken {
    const d = asRecord(JSON.parse(text));
    return {
        access_token: typeof d.access_token === 'string' ? d.access_token : '',
        expires_in: typeof d.expires_in === 'number' ? d.expires_in : 0,
    };
}

/** 构造 OAuth token URL（client_credentials 换 app token） */
export function buildTokenUrl(clientId: string, clientSecret: string): string {
    return `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`;
}

/** 构造 Apicalypse 查询体：search + 关键字段 + limit（默认 30） */
export function buildGamesBody(query: string, limit: number = SEARCH_LIMIT): string {
    return [
        `search "${query.replace(/"/g, '\\"')}";`,
        'fields name, first_release_date, cover.image_id, platforms.name, involved_companies.company.name, summary, aggregated_rating, rating, genres.name;',
        `limit ${limit};`,
    ].join(' ');
}

/** 平台名数组首项 → 主平台（空/异常 → undefined） */
function firstPlatformName(v: unknown): string | undefined {
    if (!Array.isArray(v)) return undefined;
    const p = v.map(asRecord).find((x) => typeof x.name === 'string' && x.name);
    return typeof p?.name === 'string' ? (p.name as string) : undefined;
}

/** involved_companies 首个有名字的公司 → 开发商（IGDB 无明确 developer 字段，惯例取首公司） */
function firstCompanyName(v: unknown): string | undefined {
    if (!Array.isArray(v)) return undefined;
    for (const c of v) {
        const rec = asRecord(asRecord(c).company);
        if (typeof rec.name === 'string' && rec.name) return rec.name as string;
    }
    return undefined;
}

/** genres[].name 收集（表单「题材」回填；空/异常 → undefined） */
function genresOf(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const names = v
        .map(asRecord)
        .map((g) => (typeof g.name === 'string' && g.name ? (g.name as string) : undefined))
        .filter((x): x is string => !!x);
    return names.length > 0 ? names.slice(0, 5) : undefined;
}

/** aggregated_rating（媒体评分）/rating（社区评分）100 分制 → 10 分制展示（保留 1 位小数） */
function toTenScale(raw: unknown): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Number((raw / 10).toFixed(1));
}

/**
 * 解析 /v4/games 响应：JSON 数组 → GameSearchResult[]。
 * 容错：非数组/条目缺 name 或 id → 过滤；平台/公司/封面/摘要/评分缺失 → 对应字段 undefined。
 */
export function parseGames(text: string): GameSearchResult[] {
    const arr = Array.isArray(JSON.parse(text)) ? (JSON.parse(text) as unknown[]) : [];
    return arr
        .map(asRecord)
        .filter((g) => typeof g.id === 'number' && typeof g.name === 'string' && g.name)
        .map((g): GameSearchResult => {
            const id = g.id as number;
            const cover = asRecord(g.cover);
            const year =
                typeof g.first_release_date === 'number'
                    ? new Date((g.first_release_date as number) * 1000).getUTCFullYear()
                    : undefined;
            return {
                id,
                title: g.name as string,
                platform: firstPlatformName(g.platforms),
                developer: firstCompanyName(g.involved_companies),
                genres: genresOf(g.genres),
                year,
                cover: typeof cover.image_id === 'string' ? `${COVER_BASE}/${COVER_SIZE}/${cover.image_id as string}.jpg` : undefined,
                summary: typeof g.summary === 'string' && g.summary ? (g.summary as string) : undefined,
                rating: toTenScale(g.aggregated_rating) ?? toTenScale(g.rating),
                source: 'igdb',
                sourceUrl: `https://www.igdb.com/games/${id}`,
            };
        });
}

export class IgdbClient {
    readonly name = 'igdb';
    private token?: { value: string; expiresAt: number };

    constructor(
        private clientId: string,
        private clientSecret: string,
        private httpGet: HttpGet,
        private httpPost: HttpPost,
    ) {}

    /** 获取（并缓存）OAuth app token；有效期提前 60s 视为过期 */
    private async ensureToken(): Promise<string> {
        if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
        const t = parseToken(await this.httpGet(buildTokenUrl(this.clientId, this.clientSecret)));
        if (!t.access_token) throw new Error('IGDB 鉴权失败：未获取到 access_token');
        this.token = { value: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
        return this.token.value;
    }

    /** 搜索 → GameSearchResult[] */
    async search(query: string): Promise<GameSearchResult[]> {
        const token = await this.ensureToken();
        const text = await this.httpPost(GAMES_URL, buildGamesBody(query), {
            'Client-ID': this.clientId,
            Authorization: `Bearer ${token}`,
        });
        return parseGames(text);
    }

    /** 测试凭据连通性：清缓存强制换新 token + 发一个 limit 1 查询（设置页「测试连接」按钮） */
    async testConnection(): Promise<void> {
        this.token = undefined; // 清缓存强制重取，避免沿用旧凭据换出的 token
        const token = await this.ensureToken();
        await this.httpPost(GAMES_URL, 'fields name; limit 1;', {
            'Client-ID': this.clientId,
            Authorization: `Bearer ${token}`,
        });
    }
}
