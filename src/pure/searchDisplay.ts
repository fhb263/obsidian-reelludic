// 搜索结果统一展示模型（纯逻辑，可单测）
// 4 类数据源结果 → 卡片展示字段，保证信息层次：标题 → 原名/创作者 → 年份/附加信息 + 来源徽标/直达
//
// T2（#165）：展示层泛化——徽标/直达 URL 不再按形状写死「豆瓣/TMDB/Bangumi」，
// 改走内部查表 SOURCE_VIEW（label + url(result)）：形状分支仍决定类型上下文与 meta 行拼法，
// 识别出的结果对象给 source 字段后 → 查表输出徽标与直达 URL。
// 旧数据无 source / 未知 source → 兜底现行为（豆瓣文案与 URL；影视/动画无 source 旧数据保持 TMDB/Bangumi）。
import { posterUrl, type TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
import type { BangumiSearchResult } from 'services/bangumi';
import type { ProviderId } from 'pure/sourceRegistry';

export type SearchResult = TmdbSearchResult | OmdbSearchResult | BookSearchResult | GameSearchResult | BangumiSearchResult | MusicSearchResult;

export interface SearchDisplay {
    /** 封面 URL；为空时由调用方渲染占位图 */
    cover?: string;
    /** 中文名/主标题 */
    title: string;
    /** 原名 / 作者 / 开发商 / 制作公司（次要信息行） */
    sub?: string;
    /** 发行年份 */
    year?: number;
    /** 大众评分（数据源原始分制：豆瓣/TMDB/Bangumi 10 分；有值才显示） */
    rating?: number;
    /** 大众评分评价人数（豆瓣结果展示「★ 8.5 · N人评价」） */
    ratingCount?: number;
    /** 出版社 / 平台 / 制作公司 / 导演 等附加信息（第三行，可选） */
    meta?: string;
    /** 数据源徽标文本：豆瓣 / TMDB / Bangumi / IMDb / AniList…（所有结果都有） */
    source?: string;
    /** 数据源官方页直达 URL（点击来源徽标打开新标签） */
    sourceUrl?: string;
}

/** 占位封面色相（0-359）：同一结果稳定同色，不同结果尽量区分 */
export function coverHue(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 360;
}

// ── 查表输入（各源归一结果的宽松视图：新增源字段可能缺失，一律安全读取）──
interface SourceRecord {
    [k: string]: unknown;
    id?: string | number;
    source?: string;
    // 展示层通用字段（形状分支读）
    title?: string;
    artist?: string;
    album?: string;
    author?: string;
    translator?: string;
    publisher?: string;
    producer?: string;
    isbn?: string;
    thumbnail?: string;
    cover?: string;
    developer?: string;
    platform?: string;
    studio?: string;
    originalTitle?: string;
    director?: string;
    country?: string;
    language?: string;
    durationMin?: number;
    posterPath?: string;
    mediaType?: 'movie' | 'tv';
    year?: number;
    rating?: number;
    ratingCount?: number;
    // 新源查表/封面种子字段（对齐 spec S2，缺省不崩）
    key?: string;
    cover_i?: number;
    imdbID?: string;
    collectionViewUrl?: string;
    artworkUrl100?: string;
    /** omdb Poster（搜索级原始值，'N/A' 滤除） */
    poster?: string;
    sourceUrl?: string;
}

type ShapeGroup = 'book' | 'game' | 'music' | 'anime' | 'movieTv';

/** 显式 source → 形状组（douban 跨全部形状不进此表，走 legacy 形状判别） */
const GROUP_OF_SOURCE: Record<string, ShapeGroup> = {
    openLibrary: 'book',
    googleBooks: 'book',
    steam: 'game',
    igdb: 'game',
    musicbrainz: 'music',
    itunes: 'music',
    tmdb: 'movieTv',
    omdb: 'movieTv',
    bangumi: 'anime',
    anilist: 'anime',
};

interface SourceViewEntry {
    /** UI 徽标短文本（豆瓣/TMDB/Bangumi 沿用现文案；新源短英文名，与来源直达站对齐） */
    label: string;
    /** 数据源官方页直达 URL；结果缺关键字段返回 undefined */
    url: (r: SourceRecord) => string | undefined;
}

// ── 兜底形状用的辅助提取（保证缺字段不崩）──
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isStr = (o: SourceRecord, k: string): boolean => k in o;
function idStr(o: SourceRecord): string | undefined {
    const v = o.id;
    if (typeof v === 'number') return String(v);
    return str(v);
}

/** 豆瓣直达按类型子域拼 URL（书/音乐 id 带 douban: 前缀剥离；游戏/影视 id 直用——沿用现逻辑） */
function doubanUrl(o: SourceRecord): string | undefined {
    const id = idStr(o);
    if (!id) return undefined;
    if (isStr(o, 'album')) return `https://music.douban.com/subject/${id.replace(/^douban:/, '')}/`;
    if (isStr(o, 'author')) return `https://book.douban.com/subject/${id.replace(/^douban:/, '')}/`;
    if (isStr(o, 'platform')) return `https://www.douban.com/game/${id}/`;
    return `https://movie.douban.com/subject/${id}/`;
}

function tmdbUrl(o: SourceRecord): string | undefined {
    const id = idStr(o);
    if (!id) return undefined;
    return `https://www.themoviedb.org/${o.mediaType === 'tv' ? 'tv' : 'movie'}/${id}`;
}

/** openLibrary：openlibrary.org + 结果携带的 key 路径 */
function openLibraryUrl(o: SourceRecord): string | undefined {
    const key = str(o.key) ?? idStr(o);
    if (!key) return undefined;
    return `https://openlibrary.org${key.startsWith('/') ? '' : '/'}${key}`;
}

/** iTunes：结果自带 collectionViewUrl（豆瓣式 sourceUrl 兜底）直填 */
function itunesUrl(o: SourceRecord): string | undefined {
    return str(o.collectionViewUrl) ?? str(o.sourceUrl);
}

function imdbUrl(o: SourceRecord): string | undefined {
    const id = str(o.imdbID) ?? idStr(o);
    return id ? `https://www.imdb.com/title/${id}` : undefined;
}

/**
 * source 查表（内部，10 源全覆盖；未知/缺省由 buildSourceUrl 兜底 undefined）。
 * 徽标短文本：豆瓣/TMDB/Bangumi 沿用现 UI 文案；新源用短英文名对齐来源直达站（如 omdb → IMDb）。
 */
export const SOURCE_VIEW: Record<ProviderId, SourceViewEntry> = {
    douban: { label: '豆瓣', url: doubanUrl },
    tmdb: { label: 'TMDB', url: tmdbUrl },
    bangumi: { label: 'Bangumi', url: (o) => (idStr(o) ? `https://bgm.tv/subject/${idStr(o)}` : undefined) },
    openLibrary: { label: 'OpenLibrary', url: openLibraryUrl },
    googleBooks: { label: 'Google Books', url: (o) => (idStr(o) ? `https://books.google.com/books?id=${encodeURIComponent(idStr(o) as string)}` : undefined) },
    steam: { label: 'Steam', url: (o) => (idStr(o) ? `https://store.steampowered.com/app/${idStr(o)}` : undefined) },
    musicbrainz: { label: 'MusicBrainz', url: (o) => (idStr(o) ? `https://musicbrainz.org/release-group/${idStr(o)}` : undefined) },
    itunes: { label: 'iTunes', url: itunesUrl },
    omdb: { label: 'IMDb', url: imdbUrl },
    anilist: { label: 'AniList', url: (o) => (idStr(o) ? `https://anilist.co/anime/${idStr(o)}` : undefined) },
    igdb: { label: 'IGDB', url: (o) => (idStr(o) ? `https://www.igdb.com/games/${idStr(o)}` : undefined) },
};

/** 查表存在性/取值（防原型键污染） */
const ANY_VIEW = SOURCE_VIEW as Record<string, SourceViewEntry | undefined>;
function hasSource(source: string): boolean {
    return Object.prototype.hasOwnProperty.call(SOURCE_VIEW, source);
}

/**
 * 构造来源直达 URL：未知/缺省 source → undefined（供外部复用的纯入口；
 * describeSearchResult 内部经形状分支归一 source 后调用）。
 */
export function buildSourceUrl(source: string | undefined, r: unknown): string | undefined {
    if (!source || !hasSource(source)) return undefined;
    return ANY_VIEW[source]?.url(r as SourceRecord);
}

/**
 * 生效来源：显式 source 在查表内 → 原样；
 * 无 source（旧数据，如影视/动画原生结果从不打标）→ 各形状 legacy 默认；
 * 显式但未知 → 兜底豆瓣。
 */
function resolveSource(raw: string | undefined, noSourceDefault: ProviderId): string {
    if (raw) return hasSource(raw) ? raw : 'douban';
    return noSourceDefault;
}

function labelOf(src: string): string {
    return (ANY_VIEW[src] ?? SOURCE_VIEW.douban).label;
}

/** iTunes artworkUrl100 → 600x600bb（放大规则按 spec S2）；无尺寸后缀无法放大时回 undefined 由 cover 兜底 */
function upscaleArtwork(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const seg = url.match(/\d+x\d+bb/);
    return seg ? url.replace(seg[0], '600x600bb') : undefined;
}

// ── 五个形状分支（决定类型上下文 + meta 行拼法；source/sourceUrl/封面输出走查表）──

function musicView(o: SourceRecord, raw?: string): SearchDisplay {
    const src = resolveSource(raw, 'douban');
    const label = labelOf(src);
    return {
        cover: src === 'itunes' ? (upscaleArtwork(str(o.artworkUrl100)) ?? str(o.cover)) : str(o.cover),
        title: str(o.title) ?? '',
        sub: str(o.artist),
        year: num(o.year),
        rating: num(o.rating),
        ratingCount: num(o.ratingCount),
        meta: str(o.album),
        source: label,
        sourceUrl: buildSourceUrl(src, o),
    };
}

function bookView(o: SourceRecord, raw?: string): SearchDisplay {
    const src = resolveSource(raw, 'douban');
    const label = labelOf(src);
    const translator = str(o.translator);
    const pub = str(o.publisher) ?? (str(o.producer) ? `出品：${str(o.producer)}` : undefined);
    const metaParts = [pub, translator ? `译：${translator}` : undefined, str(o.isbn)].filter((x): x is string => !!x);
    const cover =
        src === 'openLibrary' && typeof o.cover_i === 'number' && Number.isFinite(o.cover_i)
            ? `https://covers.openlibrary.org/b/id/${o.cover_i}-M.jpg`
            : str(o.thumbnail);
    return {
        cover,
        title: str(o.title) ?? '',
        sub: str(o.author) ?? (translator ? `译：${translator}` : undefined),
        year: num(o.year),
        rating: num(o.rating),
        ratingCount: num(o.ratingCount),
        meta: metaParts.join(' · '),
        source: label,
        sourceUrl: buildSourceUrl(src, o),
    };
}

function gameView(o: SourceRecord, raw?: string): SearchDisplay {
    const src = resolveSource(raw, 'douban');
    const label = labelOf(src);
    const appid =
        typeof o.id === 'number' && o.id > 0 ? String(o.id)
            : typeof o.id === 'string' && /^\d+$/.test(o.id) ? o.id : undefined;
    const cover =
        src === 'steam' && appid
            ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`
            : str(o.cover);
    return {
        cover,
        title: str(o.title) ?? '',
        sub: str(o.developer),
        year: num(o.year),
        rating: num(o.rating),
        ratingCount: num(o.ratingCount),
        meta: str(o.platform),
        source: label,
        sourceUrl: buildSourceUrl(src, o),
    };
}

function animeView(o: SourceRecord, raw?: string): SearchDisplay {
    // 无 source 旧数据 = Bangumi 原生（bgm.tv 不设 source）；显式未知兜底豆瓣
    const src = resolveSource(raw, 'bangumi');
    const label = labelOf(src);
    const title = str(o.title) ?? '';
    const originalTitle = str(o.originalTitle);
    const studio = str(o.studio);
    const sub = (originalTitle && originalTitle !== title ? originalTitle : undefined) ?? studio;
    return {
        cover: str(o.cover),
        title,
        sub,
        year: num(o.year),
        rating: num(o.rating),
        ratingCount: num(o.ratingCount),
        meta: studio,
        source: label,
        sourceUrl: buildSourceUrl(src, o),
    };
}

function movieView(o: SourceRecord, raw?: string): SearchDisplay {
    // 无 source 旧数据 = TMDB 原生（tmdb 结果不设 source）；显式未知兜底豆瓣
    const src = resolveSource(raw, 'tmdb');
    const label = labelOf(src);
    const title = str(o.title) ?? '';
    const originalTitle = str(o.originalTitle);
    const director = str(o.director);
    // 原名优先；无原名（搜索级豆瓣/IMDb 结果）时回退导演——保证 row2 作者槽位恒有真实内容
    const sub = (originalTitle && originalTitle !== title ? originalTitle : undefined) ?? director;
    const country = str(o.country);
    const language = str(o.language);
    const metaParts = [
        sub === director ? undefined : director,
        country && language ? `${country} · ${language}` : country ?? language,
        typeof o.durationMin === 'number' ? `${o.durationMin} 分钟` : undefined,
    ].filter((x): x is string => !!x);
    let cover: string | undefined;
    if (src === 'omdb') {
        const poster = str(o.poster) ?? str(o.posterPath);
        // omdb Poster='N/A' 滤除 → 无封面（走占位图）
        cover = poster && poster !== 'N/A' ? poster : undefined;
    } else if (src === 'douban') {
        // 豆瓣结果封面为完整 URL，直接使用
        cover = str(o.posterPath);
    } else {
        cover = posterUrl(str(o.posterPath));
    }
    return {
        cover,
        title,
        sub,
        year: num(o.year),
        rating: num(o.rating),
        ratingCount: num(o.ratingCount),
        meta: metaParts.length ? metaParts.join(' · ') : undefined,
        source: label,
        sourceUrl: buildSourceUrl(src, o),
    };
}

/**
 * 归一化任意数据源搜索结果 → 卡片展示字段（含来源徽标 + 直达 URL）。
 * 形状分支（album/author/platform/studio/影视）仍决定类型上下文与 meta 拼法；
 * 徽标/sourceUrl 一律走 source 查表；无 source 旧数据 / 未知 source 兜底豆瓣（影视/动画缺省保持 TMDB/Bangumi）。
 */
export function describeSearchResult(r: SearchResult): SearchDisplay {
    const o = r as unknown as SourceRecord;
    const raw = str(o.source);
    const routed = raw ? GROUP_OF_SOURCE[raw] : undefined;
    if (routed === 'book') return bookView(o, raw);
    if (routed === 'game') return gameView(o, raw);
    if (routed === 'music') return musicView(o, raw);
    if (routed === 'anime') return animeView(o, raw);
    if (routed === 'movieTv') return movieView(o, raw);
    // douban / 无 source 旧数据 / 未知 source：沿用现形状判别（判类型上下文）
    if ('album' in o) return musicView(o, raw);
    if ('author' in o) return bookView(o, raw);
    if ('platform' in o) return gameView(o, raw);
    if ('studio' in o) return animeView(o, raw);
    return movieView(o, raw);
}

/**
 * 结果 → 来源 id（ProviderId）：UI 按来源分栏的稳定分组键。
 * 语义与 describeSearchResult/resolveSource 完全一致——显式已知 source 原样返回；
 * 显式未知 → douban；无 source 旧数据按形状回退（author/platform/album→douban、
 * studio→bangumi、影视→tmdb）。分组只用它，避免 UI 端再手搓一套形状判别。
 */
export function sourceIdOf(r: SearchResult): ProviderId {
    const o = r as unknown as SourceRecord;
    const raw = str(o.source);
    if (raw) return hasSource(raw) ? (raw as ProviderId) : 'douban';
    // 无 source 旧数据（判定顺序与 describeSearchResult 形状分支一致）
    if ('album' in o) return 'douban';
    if ('author' in o) return 'douban';
    if ('platform' in o) return 'douban';
    if ('studio' in o) return 'bangumi';
    return 'tmdb';
}
