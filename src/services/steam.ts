// Steam 游戏检索（免 Key 公开端点；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://store.steampowered.com/api/storesearch/?term={q}&cc=US&l=english
//   - 端点接入时校准（#165 T6）：首选 search/suggest 实测返回热门 HTML 列表（非检索 JSON），
//     故改用 storesearch 公开免 Key 端点（HTTP 200 JSON { total, items[] }），无需登录/无需 Steam Web API Key
//   - items 仅 type=app（appid）语义正确 → 非 app（sub/bundle）与缺 id/name 的异常条目 parse 时过滤
// 结果映射为 GameSearchResult（与豆瓣游戏同型，字段对齐 resultTypes.GameSearchResult；
// summary/developer 为 B3 深度回填范围，搜索级不填）
import { asRecord } from 'pure/record';
import type { GameSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string) => Promise<string>;

const SEARCH_ENDPOINT = 'https://store.steampowered.com/api/storesearch/';
/** 竖版封面图床（library_600x900：Steam 商店页横版 + 搜索列表竖版封面；以 appid 拼 URL，不随响应字段变化） */
export const COVER_IMAGE_BASE = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

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

/** 搜索级条目 → GameSearchResult（cover 竖版拼图规则；summary/developer 搜索级不填） */
export function toGameResult(item: RawSteamItem): GameSearchResult {
    const id = item.id;
    return {
        id,
        title: item.name,
        cover: `${COVER_IMAGE_BASE}/${id}/library_600x900.jpg`,
        source: 'steam',
        sourceUrl: `https://store.steampowered.com/app/${id}`,
    };
}

export class SteamClient {
    readonly name = 'steam';

    constructor(private http: HttpGet) {}

    /** 搜索 → GameSearchResult[]（搜索级字段；无简介/开发商——B3 appdetails 深度回填另行排期） */
    async search(query: string): Promise<GameSearchResult[]> {
        const text = await this.http(buildSearchUrl(query));
        return parseSteamResults(text).map(toGameResult);
    }
}
