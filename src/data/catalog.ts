// catalog.json 读写（纯逻辑：文件 IO 通过注入的 VaultIO 完成，可单测）
import type { ActivityEvent, Catalog, MediaEntry, PlaySession, WatchLink } from 'data/types';
import { ACTIVITY_LOG_LIMIT, createEntryId, ENTRY_TYPES } from 'data/types';
import { isMediaStatus } from 'pure/status';
import { normalizeRating } from 'pure/rating';

export const CATALOG_VERSION = 1;

export const DEFAULT_CATALOG: Catalog = { version: CATALOG_VERSION, entries: [] };

function cloneDefault(): Catalog {
    return JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as Catalog;
}

export interface VaultIO {
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    /** 删除文件（不存在时静默，不抛错） */
    deleteFile(path: string): Promise<void>;
}

function isString(v: unknown): v is string {
    return typeof v === 'string';
}

function isLinkLike(v: unknown): v is WatchLink {
    return (
        typeof v === 'object' && v !== null &&
        isString((v as Record<string, unknown>).url) &&
        isString((v as Record<string, unknown>).label ?? '')
    );
}

/** 缺字段兜底：保证条目落在 schema 契约内（只增不改 + 容错读取） */
export function normalizeEntry(raw: Partial<MediaEntry>): MediaEntry {
    const now = new Date().toISOString();
    return {
        id: isString(raw.id) && raw.id ? raw.id : createEntryId(),
        type: ENTRY_TYPES.includes(raw.type as MediaEntry['type']) ? (raw.type as MediaEntry['type']) : 'movie',
        title: isString(raw.title) ? raw.title : '',
        originalTitle: isString(raw.originalTitle) ? raw.originalTitle : undefined,
        status: (raw.status as string) === 'dropped' ? 'archived' : isMediaStatus(raw.status) ? raw.status : 'want', // 弃剧已移除：存量 dropped 迁移为存档（归档语义兼容）
        rating: normalizeRating(raw.rating),
        year: typeof raw.year === 'number' ? raw.year : undefined,
        genres: Array.isArray(raw.genres) ? raw.genres.filter(isString) : [],
        director: isString(raw.director) ? raw.director : undefined,
        cast: Array.isArray(raw.cast) ? raw.cast.filter(isString) : [],
        screenwriter: (() => {
            const v = Array.isArray(raw.screenwriter) ? raw.screenwriter.filter(isString) : [];
            return v.length ? v : undefined;
        })(),
        country: isString(raw.country) ? raw.country : undefined,
        language: isString(raw.language) ? raw.language : undefined,
        durationMin: typeof raw.durationMin === 'number' ? raw.durationMin : undefined,
        aliases: (() => {
            const v = Array.isArray(raw.aliases) ? raw.aliases.filter(isString) : [];
            return v.length ? v : undefined;
        })(),
        author: isString(raw.author) ? raw.author : undefined,
        translator: isString(raw.translator) ? raw.translator : undefined,
        publisher: isString(raw.publisher) ? raw.publisher : undefined,
        producer: isString(raw.producer) ? raw.producer : undefined,
        isbn: isString(raw.isbn) ? raw.isbn : undefined,
        binding: isString(raw.binding) ? raw.binding : undefined,
        price: isString(raw.price) ? raw.price : undefined,
        series: isString(raw.series) ? raw.series : undefined,
        platform: isString(raw.platform) ? raw.platform : undefined,
        developer: isString(raw.developer) ? raw.developer : undefined,
        album: isString(raw.album) && raw.album.length > 0 ? raw.album : undefined, // 音乐专辑（豆瓣详情回填，过滤空串）
        audioPath: isString(raw.audioPath) && raw.audioPath.length > 0 ? raw.audioPath : undefined, // 音乐本地音频（过滤空串）
        gameLaunchPath: isString(raw.gameLaunchPath) && raw.gameLaunchPath.length > 0 ? raw.gameLaunchPath : undefined, // 游戏启动快捷方式（过滤空串）
        bookFile: isString(raw.bookFile) && raw.bookFile.length > 0 ? raw.bookFile : undefined, // 书籍文件（阅读器入口，过滤空串）
        airDate: isString(raw.airDate) && /^\d{4}-\d{2}-\d{2}$/.test(raw.airDate) ? raw.airDate : undefined, // 开播日期（Bangumi 放送时间回填，YYYY-MM-DD 校验）
        poster: isString(raw.poster) ? raw.poster : undefined,
        progress: raw.progress && typeof raw.progress === 'object' ? raw.progress : undefined,
        latestKnownEpisode: typeof raw.latestKnownEpisode === 'number' ? raw.latestKnownEpisode : undefined, // 追更已知最新集（A2 落库）
        watchedDate: isString(raw.watchedDate) ? raw.watchedDate : undefined,
        plannedDate: isString(raw.plannedDate) ? raw.plannedDate : undefined,
        readingProgress: raw.readingProgress && typeof raw.readingProgress === 'object'
            ? {
                page: typeof raw.readingProgress.page === 'number' ? raw.readingProgress.page : undefined,
                totalPage: typeof raw.readingProgress.totalPage === 'number' ? raw.readingProgress.totalPage : undefined,
                // 阅读器进度百分比（0-100）：数字且区间内才透传，其余丢弃
                percent: typeof raw.readingProgress.percent === 'number' && raw.readingProgress.percent >= 0 && raw.readingProgress.percent <= 100
                    ? raw.readingProgress.percent
                    : undefined,
            }
            : undefined,
        playtimeMinutes: typeof raw.playtimeMinutes === 'number' ? raw.playtimeMinutes : undefined,
        pageCount: typeof raw.pageCount === 'number' && raw.pageCount > 0 ? raw.pageCount : undefined, // 书籍元数据页数（豆瓣，仅展示/统计）
        playSessions: Array.isArray(raw.playSessions)
            ? raw.playSessions
                  .filter((s): s is PlaySession => typeof s === 'object' && s !== null && typeof (s as PlaySession).date === 'string' && typeof (s as PlaySession).minutes === 'number')
                  .map((s) => ({
                      date: (s as PlaySession).date,
                      minutes: (s as PlaySession).minutes,
                      note: isString((s as PlaySession).note) ? (s as PlaySession).note : undefined,
                  }))
            : undefined,
        source: isString(raw.source) ? raw.source : undefined,
        sourceUrl: isString(raw.sourceUrl) ? raw.sourceUrl : undefined,
        communityScore: typeof raw.communityScore === 'number' ? raw.communityScore : undefined,
        summary: isString(raw.summary) ? raw.summary : undefined, // 简介（曾缺失导致笔记无简介，回归锁定）
        // AI 摘要（一句话总结 / 核心看点）：append-only 可选字段，空串/空数组不落库
        aiSummary: isString(raw.aiSummary) && raw.aiSummary.trim() ? raw.aiSummary : undefined,
        aiHighlights: (() => {
            const v = Array.isArray(raw.aiHighlights) ? raw.aiHighlights.filter(isString).map((s) => s.trim()).filter(Boolean) : [];
            return v.length ? v : undefined;
        })(),
        ratingCount: typeof raw.ratingCount === 'number' ? raw.ratingCount : undefined,
        authorIntro: isString(raw.authorIntro) ? raw.authorIntro : undefined,
        toc: isString(raw.toc) ? raw.toc : undefined,
        links: Array.isArray(raw.links) ? raw.links.filter(isLinkLike) : [],
        episodeFiles: Array.isArray(raw.episodeFiles) ? raw.episodeFiles.filter((p) => isString(p) && p.length > 0) : undefined, // 本地剧集视频路径（表单集按钮关联，过滤空串）
        episodeUrls: Array.isArray(raw.episodeUrls) ? raw.episodeUrls.filter((u) => isString(u) && u.length > 0) : undefined, // 剧集网络地址（每集与 episodeFiles 同下标）
        episodeTitles: Array.isArray(raw.episodeTitles) ? raw.episodeTitles.filter((t) => isString(t) && t.length > 0) : undefined, // 集标题（hover 显示）
        notes: isString(raw.notes) ? raw.notes : '',
        tags: Array.isArray(raw.tags) ? raw.tags.filter(isString) : [],
        notePath: isString(raw.notePath) ? raw.notePath : undefined,
        noteFingerprint: isString(raw.noteFingerprint) ? raw.noteFingerprint : undefined, // 笔记指纹（G 双写冲突）
        excerptCount: typeof raw.excerptCount === 'number' ? raw.excerptCount : undefined, // 摘抄数（P1 性能缓存）
        createdAt: isString(raw.createdAt) ? raw.createdAt : now,
        updatedAt: isString(raw.updatedAt) ? raw.updatedAt : now,
    };
}

function isEntryLike(v: unknown): v is Partial<MediaEntry> {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    return isString(o.id) && isString(o.title);
}

/** 解析 catalog.json 文本：非法输入回退默认空库，无效条目被过滤 */
export function parseCatalog(text: string): Catalog {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return cloneDefault();
    }
    if (typeof raw !== 'object' || raw === null) return cloneDefault();
    const obj = raw as Record<string, unknown>;
    const entries = Array.isArray(obj.entries)
        ? obj.entries.filter(isEntryLike).map((e) => normalizeEntry(e as Partial<MediaEntry>))
        : [];
    const version = typeof obj.version === 'number' ? obj.version : CATALOG_VERSION;
    const out: Catalog = { version, entries };
    // 活动日志（今日记录）：逐条校验，脏数据丢弃；字段缺失保持 undefined（不凭空造空数组）
    if (Array.isArray(obj.activityLog)) out.activityLog = normalizeActivityLog(obj.activityLog);
    return out;
}

/** 活动日志逐条校验：at 可解析 + id 非空 + status 合法；超出上限截断最旧 */
function normalizeActivityLog(raw: unknown[]): ActivityEvent[] {
    const valid = raw.filter((v): v is ActivityEvent => {
        if (typeof v !== 'object' || v === null) return false;
        const o = v as Record<string, unknown>;
        return (
            typeof o.at === 'string' &&
            !Number.isNaN(new Date(o.at).getTime()) &&
            typeof o.id === 'string' &&
            o.id.length > 0 &&
            isMediaStatus(o.status)
        );
    });
    return valid.length > ACTIVITY_LOG_LIMIT ? valid.slice(valid.length - ACTIVITY_LOG_LIMIT) : valid;
}

export function serializeCatalog(c: Catalog): string {
    const clean: Catalog = { version: CATALOG_VERSION, entries: c.entries.map(normalizeEntry) };
    const log = normalizeActivityLog(c.activityLog ?? []);
    if (log.length) clean.activityLog = log;
    return JSON.stringify(clean, null, 2);
}

export class CatalogStore {
    constructor(private io: VaultIO, private path: string = 'ReelLudic/catalog.json') {}

    async load(): Promise<Catalog> {
        let text: string;
        try {
            text = await this.io.readText(this.path);
        } catch {
            return cloneDefault();
        }
        const parsed = parseCatalog(text);
        const out: Catalog = { version: CATALOG_VERSION, entries: parsed.entries.map(normalizeEntry) };
        if (parsed.activityLog) out.activityLog = normalizeActivityLog(parsed.activityLog);
        return out;
    }

    async save(catalog: Catalog): Promise<void> {
        await this.io.writeText(this.path, serializeCatalog(catalog));
    }
}
