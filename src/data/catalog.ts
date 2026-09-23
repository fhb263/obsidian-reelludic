// catalog.json 读写（纯逻辑：文件 IO 通过注入的 VaultIO 完成，可单测）
import type { ActivityEvent, BookKind, Catalog, MediaEntry, MusicKind, PlaySession, WatchLink } from 'data/types';
import { ACTIVITY_LOG_LIMIT, createEntryId, ENTRY_TYPES } from 'data/types';
import { isMediaStatus } from 'pure/status';
import { normalizeRating } from 'pure/rating';
import { BOOK_KINDS } from 'pure/bookKind';
import { MUSIC_KINDS } from 'pure/musicKind';
import {
    BACKUP_FILE,
    BACKUP_KEEP,
    LEGACY_BACKUP_DIR,
    backupStamp,
    countEntries,
    emptyBackupFile,
    legacyBackupStamp,
    legacyStampToAt,
    parseBackupFile,
    pushSnapshot,
    serializeBackupFile,
    sortLegacyBackupNames,
    type BackupFile,
} from 'pure/catalogBackup';

/** 与给定文件同级的路径（用于把「备份文件 / 旧备份目录」放在 catalog.json 旁边） */
function siblingPath(filePath: string, name: string): string {
    const i = filePath.lastIndexOf('/');
    const dir = i >= 0 ? filePath.slice(0, i) : '';
    return dir ? `${dir}/${name}` : name;
}

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
    /**
     * 列出目录下的文件名（不含子目录；目录不存在返回空数组）。
     * **可选**：单文件备份（`catalog-backups.json`）不需要列目录就能轮转，故未实现时备份照常工作；
     * 它只影响「旧 `.backups/` 多文件备份的一次性导入与清理」——缺能力时旧文件原样保留、不做导入。
     */
    listFiles?(folder: string): Promise<string[]>;
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
        bookKind: BOOK_KINDS.includes(raw.bookKind as BookKind) ? raw.bookKind : undefined, // 书籍子分类（合法值透传；非法/缺省/已下线 comic → undefined，读取端 normalizeBookKind 兜底归文学）——回归锁定：白名单曾缺此字段，搜索保存的网文被静默丢分类落错视图
        musicKind: MUSIC_KINDS.includes(raw.musicKind as MusicKind) ? raw.musicKind : undefined, // 音乐子分类（同上，缺省/已下线 other 读取端归 music）
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
        // 本地视频播放位置（键必须是集下标数字串、值必须是正的有限数；空对象不落库）——
        // ⚠️ 新增 schema 字段必须同步本白名单，否则读取端 normalizeEntry 会静默丢弃（历史踩坑）
        videoPositions: (() => {
            const src = raw.videoPositions;
            if (!src || typeof src !== 'object') return undefined;
            const out: Record<string, number> = {};
            for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
                if (!/^\d+$/.test(k)) continue;
                if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
                out[k] = Math.floor(v);
            }
            return Object.keys(out).length ? out : undefined;
        })(),
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

/**
 * 写前自检：序列化文本必须「能回读」，且回读到的条目数与预期一致。
 *
 * 为什么值得单独一关：catalog.json 是全量重写，一次坏写入会把整库覆盖掉；
 * 而 serializeCatalog 的正常路径几乎不可能出问题 —— 这一关防的是「将来有人改坏了序列化 / 归一化」，
 * 让故障停在写盘之前（宁可不写，也不要用坏数据盖掉好数据）。
 */
export function isCatalogTextConsistent(text: string, expectedEntries: number): boolean {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return false;
    }
    if (typeof raw !== 'object' || raw === null) return false;
    const entries = (raw as Record<string, unknown>).entries;
    if (!Array.isArray(entries)) return false;
    return entries.filter(isEntryLike).length === expectedEntries;
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
        const text = serializeCatalog(catalog);
        // ① 写前自检：回读不通就中止（错误上抛给调用方，不静默吞掉）
        if (!isCatalogTextConsistent(text, catalog.entries.length)) {
            throw new Error(`catalog 写前校验失败：序列化结果无法回读 ${catalog.entries.length} 条条目`);
        }
        // ② 覆盖前留一份滚动备份
        await this.backupBeforeWrite(text);
        // ③ 落盘
        await this.io.writeText(this.path, text);
    }

    /**
     * 备份文件：与 catalog.json 同级（`<库目录>/catalog-backups.json`）。
     * 单文件内含最近 BACKUP_KEEP 版快照 —— 2026-09-14 用户裁定：不再一版一个文件
     * （「catalog 就没有单文件的备份方案了吗，太多文件我管理不过来」）。
     */
    private get backupPath(): string {
        return siblingPath(this.path, BACKUP_FILE);
    }

    /** 旧的多文件备份目录（`<库目录>/.backups`）：仅供一次性导入与清理，之后不再写 */
    private get legacyBackupDir(): string {
        return siblingPath(this.path, LEGACY_BACKUP_DIR);
    }

    /**
     * 覆盖前留一版备份（单文件、内部保留最近 BACKUP_KEEP 版）。
     *
     * - 读不到旧文件（首次建库）或旧内容与本次**完全相同**（无实质变化）→ 跳过，
     *   否则光是反复切换状态就会刷出一堆同内容快照。
     * - 备份链的任何失败都**不阻断**本次写入：备份是兜底手段，
     *   不该反过来变成写盘的新故障点（失败静默，宁可少一份备份也不能写不进库）。
     */
    private async backupBeforeWrite(nextText: string): Promise<void> {
        try {
            let prev: string;
            try {
                prev = await this.io.readText(this.path);
            } catch {
                return;
            }
            if (prev === nextText) return;
            await this.importLegacyBackups();
            let bf: BackupFile;
            try {
                bf = parseBackupFile(await this.io.readText(this.backupPath));
            } catch {
                bf = emptyBackupFile();
            }
            const next = pushSnapshot(bf, { at: backupStamp(new Date()), entries: countEntries(prev), text: prev }, BACKUP_KEEP);
            if (next === bf) return; // 同一版已记录过（引用相等）→ 不重写文件
            await this.io.writeText(this.backupPath, serializeBackupFile(next));
        } catch {
            // 备份链失败不改变本次写入的结果
        }
    }

    /** 旧 `.backups/` 一次性导入（导入并**回读校验**通过后才清理旧文件；失败一律保留旧文件） */
    private legacyImported = false;

    private async importLegacyBackups(): Promise<void> {
        if (this.legacyImported || !this.io.listFiles) return;
        // 一次性：无论成败都只尝试一次，避免每次 save 都去扫目录
        this.legacyImported = true;
        try {
            const names = sortLegacyBackupNames(await this.io.listFiles(this.legacyBackupDir)).filter(
                (n) => legacyBackupStamp(n) !== null,
            );
            if (names.length === 0) return;

            let bf: BackupFile;
            try {
                bf = parseBackupFile(await this.io.readText(this.backupPath));
            } catch {
                bf = emptyBackupFile();
            }
            // 旧文件按「旧 → 新」逐个 push（push 是头插）→ 结果仍是新的在前
            for (const name of names) {
                try {
                    const text = await this.io.readText(`${this.legacyBackupDir}/${name}`);
                    bf = pushSnapshot(bf, { at: legacyStampToAt(name), entries: countEntries(text), text }, BACKUP_KEEP);
                } catch {
                    // 单个旧档读失败：跳过它，不影响其余
                }
            }
            await this.io.writeText(this.backupPath, serializeBackupFile(bf));

            // ⚠️ 回读校验：单文件里确实装下了这些版本，才允许删旧文件（宁可多几个文件，也不能丢备份）
            const back = parseBackupFile(await this.io.readText(this.backupPath));
            if (back.snapshots.length < bf.snapshots.length) return;
            for (const name of names) {
                await this.io.deleteFile(`${this.legacyBackupDir}/${name}`);
            }
        } catch {
            // 导入失败：旧文件原样保留，用户仍可按老办法手工还原
        }
    }
}
