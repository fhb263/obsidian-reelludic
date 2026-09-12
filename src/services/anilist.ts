// AniList（anilist.co）动画元数据（免 Key GraphQL；纯逻辑：HTTP 注入可 mock）
// 搜索：POST https://graphql.anilist.co  Page.media(search:$s, type:ANIME, sort:SEARCH_MATCH)
//   - 端点接入时已校准（#165 T10 沙箱实测 1 次）：返回 data.Page.media[]；
//     description(asHtml:false) 实测仍泄漏 <br>/<b> 标记 → 映射时清洗；
//     studios.nodes 为多节点 → 取首节点；meanScore 为整数 0-100。
//   - 免 Key、默认链不含（anime=douban→bangumi）→ 仅用户自选加入后参与。
// 结果类型决策（#165 T10）：与 omdb 不同（imdbID 字符串 vs tmdb id:number 强冲突必须独立类型），
//   anilist id 同为 number 且字段全部可映射进 BangumiSearchResult 可选字段袋（该类型本就不带
//   sourceUrl——anime 直达 URL 一贯由 source 查表派生，searchDisplay SOURCE_VIEW.anilist 已覆盖）
//   → 无字段冲突，故【复用 BangumiSearchResult】+ source='anilist' 区分语义
//   （id 指向 anilist.co/anime/{id}，与 bgm.tv/subject/{id} 同名但不同站；误发 bgm API 由
//   EntryForm 按 source 守护）。决策断言见 tests/anilist.test.ts。
// rating 决策：anime 组结果类型/UI 展示语义为 10 分制（Bangumi/豆瓣 同型），meanScore 为 0-100 →
//   ÷10 保留 1 位（87 → 8.7）。
// 点选补全决策：搜索级已含 genres/studio/desc/rating + title/year/cover（对齐动画表单可填字段），
//   不做额外 detail GraphQL 往返；anilist id 绝不发往 bgm API（EntryForm 按 source 守护）。
import { asRecord } from 'pure/record';
import type { BangumiSearchResult } from 'services/bangumi';

/** 注入 HTTP POST（GraphQL body JSON；测试 mock 断言 URL/body/headers 形态） */
export type HttpPost = (url: string, body: string, headers?: Record<string, string>) => Promise<string>;

const GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';
/** 检索单页 20 条（对齐其他源搜索条数）；title 三语、coverImage.large、startDate.year、genres、meanScore、studios 首节点、description */
const SEARCH_QUERY = `query ($s: String) { Page(page:1, perPage:20) { media(search:$s, type:ANIME, sort:SEARCH_MATCH) { id title { romaji english native } coverImage { large } startDate { year } genres meanScore studios { nodes { name } } description(asHtml:false) } } }`;

/** 搜索 POST body：固定 query + variables.s=检索词（GraphQL POST JSON） */
export function buildSearchBody(query: string): string {
    return JSON.stringify({ query: SEARCH_QUERY, variables: { s: query } });
}

/** 安全读字符串（null/非字符串 → undefined） */
function str(v: unknown): string | undefined {
    return typeof v === 'string' && v ? v : undefined;
}

/** 字符串数组（非数组 → undefined；元素仅收 string） */
function strArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string' && !!x);
    return out.length > 0 ? out : undefined;
}

/**
 * 解析单条 media 后的扁平原始形态（parse 只做安全导航，不做语义决策）：
 * 标题三语各自保留（语言优先级是 mapper 决策）；description 保留原始泄漏标记（清洗在 mapper）；
 * genres 保留全量（截 3 在 mapper）；studios 已取首节点名（原始扁平化）。
 */
export interface RawAnilistMedia {
    id: number;
    titleRomaji?: string;
    titleEnglish?: string;
    titleNative?: string;
    year?: number;
    cover?: string;
    genres?: string[];
    meanScore?: number;
    studio?: string;
    description?: string;
}

/** 解析 search 响应 data.Page.media[] → RawAnilistMedia[]；异常条目（id 非 number/无任何标题）滤除；缺失/错误体 → 空数组 */
export function parseAnilistResults(text: string): RawAnilistMedia[] {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    const page = asRecord(asRecord(data).data).Page;
    const media = asRecord(page).media;
    if (!Array.isArray(media)) return [];
    return media
        .map(asRecord)
        .filter((m) => typeof m.id === 'number' && Number.isFinite(m.id) && m.id > 0)
        .map((m): RawAnilistMedia | null => {
            const t = asRecord(m.title);
            const romaji = str(t.romaji);
            const english = str(t.english);
            const native = str(t.native);
            // 无任何可用标题的条目滤除（标题是搜索行/表单回填锚点）
            if (!romaji && !english && !native) return null;
            const startDate = asRecord(m.startDate);
            const coverImage = asRecord(m.coverImage);
            const studios = asRecord(m.studios);
            const nodes = Array.isArray(studios.nodes) ? studios.nodes.map(asRecord) : [];
            const studio = nodes.map((n) => str(n.name)).find((n): n is string => !!n);
            return {
                id: m.id as number,
                titleRomaji: romaji,
                titleEnglish: english,
                titleNative: native,
                year: typeof startDate.year === 'number' && Number.isFinite(startDate.year) ? (startDate.year as number) : undefined,
                cover: str(coverImage.large),
                genres: strArray(m.genres),
                meanScore: typeof m.meanScore === 'number' && Number.isFinite(m.meanScore) ? (m.meanScore as number) : undefined,
                studio,
                description: str(m.description),
            };
        })
        .filter((r): r is RawAnilistMedia => r !== null);
}

/**
 * 清洗 description 泄漏的 HTML 标记（asHtml:false 实测仍含 <br>/<b> 等）：
 * <br> → 换行、其余 <…> 去除、连续空行压缩、去首尾空白；空/缺省 → undefined。
 */
export function cleanAnilistDescription(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const cleaned = raw
        .replace(/<br\s*\/?>/gi, '\n') // 行断标记 → 换行（真实换行保留）
        .replace(/<[^>]*>/g, '') // 其余标签剥除（<b>/<i>/<a> 等）
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n') // 压缩 3+ 连续换行 → 段落间距
        .trim();
    return cleaned || undefined;
}

/**
 * anime 组条目 → BangumiSearchResult（结果类型决策：复用现有类型，source='anilist' 区分语义）。
 * - title：romaji → english → native（AniList 无中文标题，三语用 romaji 优先即可）；
 *   originalTitle=native（与 title 相同/缺省时不设，供展示层 sub 行）；
 * - year=startDate.year（缺失 undefined）；cover=coverImage.large；genres 截 3（结果类型字段必需 string[]）；
 * - rating=meanScore ÷10 保留 1 位（10 分制决策，见 tests/anilist.test.ts）；studio=studios.nodes[0]；
 * - summary=description 清洗后（截断策略以结果类型字段要求为准：与 Bangumi 同型，全量存储）；
 * - source='anilist'（直达 URL 不进结果对象：BangumiSearchResult 无 sourceUrl 字段，UI 由 source
 *   查表派生 https://anilist.co/anime/{id}）。
 */
export function toAnilistResult(item: RawAnilistMedia): BangumiSearchResult {
    const title = item.titleRomaji ?? item.titleEnglish ?? item.titleNative ?? '';
    // 原名脚本：native 优先（AniList native 为原语言标题），缺省回退 english；
    // 均缺省 → ''（BangumiSearchResult.originalTitle 必填；空串由表单/存储层当无原名处理）
    const originalTitle = item.titleNative ?? item.titleEnglish ?? '';
    const meanScore = item.meanScore;
    return {
        id: item.id,
        title,
        originalTitle,
        year: item.year,
        genres: item.genres ? item.genres.slice(0, 3) : [],
        cover: item.cover,
        studio: item.studio,
        summary: cleanAnilistDescription(item.description),
        rating: typeof meanScore === 'number' ? Number((meanScore / 10).toFixed(1)) : undefined,
        source: 'anilist',
    };
}

export class AnilistClient {
    readonly name = 'anilist';

    constructor(private httpPost: HttpPost) {}

    /** 搜索 → BangumiSearchResult[]（GraphQL POST；搜索级已含 genres/studio/desc/rating，点选直接回填） */
    async search(query: string): Promise<BangumiSearchResult[]> {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'reelludic/0.0.1',
        };
        const text = await this.httpPost(GRAPHQL_ENDPOINT, buildSearchBody(query), headers);
        return parseAnilistResults(text).map(toAnilistResult);
    }
}
