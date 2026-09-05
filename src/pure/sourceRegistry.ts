// 数据源注册表与源链解析（纯数据 + 纯函数，无 obsidian 依赖，可单测）
// T1（#165）：全 10 源 implemented=true；IGDB 回归后全 11 源——douban/tmdb/bangumi 之外，
// openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist/igdb 八条注册位源全部接入，自动进入设置 UI 候选与 normalize 链。
// implemented 布尔与 normalize 过滤保留：未来新增注册位源仍自动隐藏，置 true 即接入。
// 凭据全局唯一共享：keyField/keyField2 为 ReelLudicSettings 字段名（type-only，不 import Settings 避免依赖链；
// keyField2 供双凭据源使用，如 igdb 的 Client Secret——见下方 meta，已配置判定需两字段同有值）。
import type { EntryType } from 'data/types';

/** 数据源 id（全量注册位） */
export type ProviderId =
    | 'douban' | 'tmdb' | 'bangumi'
    | 'openLibrary' | 'googleBooks' | 'steam' | 'musicbrainz' | 'itunes' | 'omdb' | 'anilist' | 'igdb';

/** 源链配置组：五组（movie/tv 共用 movieTv，见 sourceGroupForType） */
export type SourceGroup = 'book' | 'game' | 'music' | 'movieTv' | 'anime';

export const SOURCE_GROUPS: readonly SourceGroup[] = ['book', 'game', 'music', 'movieTv', 'anime'];

/** 组标签（设置页折叠行头、摘要文案） */
export const GROUP_LABELS: Record<SourceGroup, string> = {
    book: '书籍',
    game: '游戏',
    music: '音乐',
    movieTv: '影视',
    anime: '动画',
};

/** 条目类型 → 源链组（movie/tv 共用 movieTv；其余类型即组） */
export function sourceGroupForType(t: EntryType): SourceGroup {
    return t === 'movie' || t === 'tv' ? 'movieTv' : t;
}

export interface ProviderMeta {
    id: ProviderId;
    /** UI 徽标/摘要名 */
    label: string;
    /** 适用组 */
    groups: readonly SourceGroup[];
    /** 凭据字段名（ReelLudicSettings 键；null = 免 Key）——全局唯一共享 */
    keyField: string | null;
    /** 第二凭据字段名（双凭据源专用，如 IGDB Client Secret；单凭据源省略/undefined）。非 null 时「已配置」判定需两字段同时有值 */
    keyField2?: string | null;
    /** 已实现（可被搜索/进设置候选）；false = 注册位 */
    implemented: boolean;
    /** 设置页说明文案（凭据行 hint 用） */
    hint: string;
}

export const PROVIDERS: readonly ProviderMeta[] = [
    {
        id: 'douban', label: '豆瓣', groups: ['book', 'game', 'music', 'movieTv', 'anime'],
        keyField: 'doubanCookie', implemented: true,
        hint: '主力源（默认每类链首）。需登录态 Cookie（含 dbcl2）否则 403：登录 douban.com → F12 复制任意请求的 Cookie 粘贴即可。',
    },
    {
        id: 'tmdb', label: 'TMDB', groups: ['movieTv'],
        keyField: 'tmdbApiKey', implemented: true,
        hint: '影视并排源。themoviedb.org 注册后获取 API Key；配置后与 Douban 并排，未配置仅用 Douban。',
    },
    {
        id: 'bangumi', label: 'Bangumi', groups: ['anime'],
        keyField: 'bangumiToken', implemented: true,
        hint: '动画并排源。bgm.tv → 设置 → 开发 → 创建 Access Token；配置后与 Douban 并排，未配置仅用 Douban。',
    },
    {
        id: 'openLibrary', label: 'Open Library', groups: ['book'],
        keyField: null, implemented: true,
        hint: '书籍第二源（免 Key）：openlibrary.org 开放检索，书名/作者/出版社/年份/ISBN/封面。',
    },
    {
        id: 'googleBooks', label: 'Google Books', groups: ['book'],
        keyField: 'googleBooksApiKey', implemented: true,
        hint: '书籍补充源：ISBN/页数/分类较全；免费额度限流，API Key 可选提升配额。',
    },
    {
        id: 'steam', label: 'Steam', groups: ['game'],
        keyField: null, implemented: true,
        hint: '游戏第二源（免 Key）：Steam 商店公开检索，开发商/发行商/发售日/封面。',
    },
    {
        id: 'musicbrainz', label: 'MusicBrainz', groups: ['music'],
        keyField: null, implemented: true,
        hint: '音乐数据源（免 Key）：厂牌/年份/专辑-曲目关系规范；中文曲库一般。',
    },
    {
        id: 'itunes', label: 'iTunes', groups: ['music'],
        keyField: null, implemented: true,
        hint: '音乐数据源（免 Key）：中文曲库 + 高清封面，与 MusicBrainz 互补。',
    },
    {
        id: 'omdb', label: 'OMDb', groups: ['movieTv'],
        keyField: 'omdbApiKey', implemented: true,
        hint: '影视第三源（需 Key，1000 次/日）：IMDb 数据，英文为主。',
    },
    {
        id: 'anilist', label: 'AniList', groups: ['anime'],
        keyField: null, implemented: true,
        hint: '动画第三源（免 Key，GraphQL）：默认关，中文弱。',
    },
    {
        id: 'igdb', label: 'IGDB', groups: ['game'],
        keyField: 'igdbClientId', keyField2: 'igdbClientSecret', implemented: true,
        hint: '游戏补充源（需 Twitch 开发者凭据）：dev.twitch.tv/console/apps 注册应用获取 Client ID 与 Client Secret，IGDB 游戏库覆盖广。默认关，勾选后参与游戏搜索。',
    },
];

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, ProviderMeta>;

/** 数据源英文展示名（头部「数据源：」列表与搜索进度汇总用；与中文/徽标文案区分） */
const SOURCE_EN: Record<ProviderId, string> = {
    douban: 'Douban', tmdb: 'TMDB', bangumi: 'Bangumi',
    openLibrary: 'Open Library', googleBooks: 'Google Books', steam: 'Steam',
    musicbrainz: 'MusicBrainz', itunes: 'iTunes', omdb: 'OMDb', anilist: 'AniList', igdb: 'IGDB',
};

/** 源英文名（未知 id 原样返回，不崩） */
export function sourceEnLabel(id: ProviderId | string): string {
    return SOURCE_EN[id as ProviderId] ?? id;
}

/** 源英文名列表 join（头部/进度汇总用；空 → ''） */
export function sourceEnList(ids: readonly (ProviderId | string)[]): string {
    return ids.map(sourceEnLabel).join(' / ');
}

/** 各组默认链（T1 落上游 D2 表：book=douban+openLibrary；game=douban+steam；music=douban+musicbrainz+itunes 3 源满链；movieTv/anime 沿用 douban+tmdb/bangumi 不变；googleBooks/omdb/anilist 默认关、用户自选加入；链首 douban 为主力源不限时） */
export const DEFAULT_CHAINS: Record<SourceGroup, readonly ProviderId[]> = {
    book: ['douban', 'openLibrary'],
    game: ['douban', 'steam'],
    music: ['douban', 'musicbrainz', 'itunes'],
    movieTv: ['douban', 'tmdb'],
    anime: ['douban', 'bangumi'],
};

/**
 * 归一源链：剔除非法 id / 不适用本组 / 未实现源 / 重复项，保序。
 * 返回空数组表示整链无效（调用方回退默认链）。
 */
export function normalizeSourceChain(group: SourceGroup, chain: ProviderId[]): ProviderId[] {
    const seen = new Set<ProviderId>();
    const out: ProviderId[] = [];
    for (const id of chain) {
        const meta = PROVIDER_META[id];
        if (!meta) continue;
        if (!meta.groups.includes(group)) continue;
        if (!meta.implemented) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * 解析某组当前生效源链：settings.sourceChains 缺省 / 空 / 整链被滤空 → 默认链。
 * 用户配置只要留有一个合法源即尊重其顺序（可把 douban 挪位/移出）。
 */
export function resolveSourceChain(
    cfg: Partial<Record<SourceGroup, ProviderId[]>> | undefined,
    group: SourceGroup,
): ProviderId[] {
    const saved = cfg?.[group];
    if (!saved || saved.length === 0) return [...DEFAULT_CHAINS[group]];
    const norm = normalizeSourceChain(group, saved);
    return norm.length > 0 ? norm : [...DEFAULT_CHAINS[group]];
}

// ── 全链失败错误文案（与现状逐字对齐；设置区仍叫「服务集成」故文案不变）──
const ERR_COOKIE_INVALID = '豆瓣 Cookie 已失效或过期 — 请到 设置 → 服务集成 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试';
const ERR_DOUBAN_UNREACHABLE = 'Douban 兜底不可用（请在 设置 → 服务集成 · Douban 配置 Cookie 过反爬）';
const ERR_ANIME_NO_TOKEN = '未配置 Bangumi Access Token，且 Douban 也未找到匹配结果';
const ERR_ANIME_COOKIE = ERR_COOKIE_INVALID + '，或填写 Bangumi Token';
const ERR_ANIME_UNREACHABLE = '未配置 Bangumi Access Token，且 Douban 兜底不可用（请在 设置 → 服务集成 · Douban 配置 Cookie 过反爬，或填写 Bangumi Token）';

/** 链内非 douban 源在本次搜索中的结果状态（调用方只在「整体无结果」时调用 derive，故无需 'ok'） */
export type AuxState = 'absent' | 'unconfigured' | 'failed' | 'empty';

export interface GroupErrorState {
    group: SourceGroup;
    /** 解析后的生效链（决定 douban 是否参与） */
    chain: ProviderId[];
    /** douban 参与时的状态（douban 在链时调用方必须提供本字段；不在链则缺省）；reachable=false 表示反爬/不可用（区别于无匹配） */
    douban?: { reachable: boolean; cookieInvalid: boolean };
    /** 链内非 douban 源状态：absent=链外；unconfigured=未配凭据；failed=已配但请求失败；empty=成功无匹配。缺省/未提供 = 该源不参与或无需提示（函数只读链内成员的 aux 状态，链外源由 chain 过滤，缺失键当「无失败」静默处理） */
    aux: Partial<Record<Exclude<ProviderId, 'douban'>, AuxState>>;
}

/**
 * 全链无结果时的错误文案推导（有结果时调用方不应调用——返回 null 不打扰）。
 * 优先级：douban 参与且不可达 → 豆瓣文案（anime 无 Token 时追加填 Token 尾巴）；
 * douban 正常无匹配 → 仅 anime 缺 Token 给提示，其余静默空结果；
 * douban 不在链 → 按各源 unconfigured/failed 汇总通用文案；全 empty → null。
 */
export function deriveGroupSearchError(s: GroupErrorState): string | null {
    const hasDouban = s.chain.includes('douban');
    if (hasDouban && s.douban) {
        const animeNoToken = s.group === 'anime' && s.aux.bangumi === 'unconfigured';
        if (!s.douban.reachable) {
            return s.douban.cookieInvalid
                ? animeNoToken ? ERR_ANIME_COOKIE : ERR_COOKIE_INVALID
                : animeNoToken ? ERR_ANIME_UNREACHABLE : ERR_DOUBAN_UNREACHABLE;
        }
        // douban 正常但无匹配
        if (animeNoToken) return ERR_ANIME_NO_TOKEN;
        return null;
    }
    // douban 不在链：仅当存在未配置/失败源才提示（全 empty = 正常空结果）
    const listed = s.chain.filter((id): id is Exclude<ProviderId, 'douban'> => id !== 'douban');
    const bits: string[] = [];
    for (const id of listed) {
        const st = s.aux[id];
        if (st === 'unconfigured') bits.push(`${PROVIDER_META[id].label} 未配置凭据`);
        else if (st === 'failed') bits.push(`${PROVIDER_META[id].label} 请求失败`);
    }
    if (bits.length === 0) return null;
    return `所选数据源不可用（${bits.join('；')}），请到 设置 → 服务集成 检查后重试`;
}
