// 数据层类型定义（schema 契约：只增不改）
import type { MediaStatus } from 'pure/status';
import type { Rating } from 'pure/rating';

// 六库扩展点：movie/tv/anime 影视动画，book/game 预留，music 已落地（平铺单选，schema 只增不改）
export type EntryType = 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music';

export const ENTRY_TYPES: readonly EntryType[] = ['movie', 'tv', 'anime', 'book', 'game', 'music'];

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
    movie: '电影',
    tv: '电视剧',
    anime: '动画',
    book: '书籍',
    game: '游戏',
    music: '音乐',
};

/** 类型 → 笔记子目录英文目录名（目录结构用：movie/teleplay/animation/book/game/music）。
 *  与 UI 中文标签 ENTRY_TYPE_LABELS 解耦（界面展示仍走中文，勿混用）。 */
export const ENTRY_TYPE_DIRS: Record<EntryType, string> = {
    movie: 'movie',
    tv: 'teleplay',
    anime: 'animation',
    book: 'book',
    game: 'game',
    music: 'music',
};

/** 类型识别色（卡片色条/占位图主色）：电影蓝 / 剧集紫 / 动画粉 / 书籍绿 / 游戏橙 / 音乐青 */
export const TYPE_COLORS: Record<EntryType, string> = {
    movie: '#378ADD',
    tv: '#7F77DD',
    anime: '#D4537E',
    book: '#639922',
    game: '#EF9F27',
    music: '#2AA89B',
};

/** 色彩主题：彩色（类型色条 + 状态五色）/ 单色（关闭类型色条，仅状态色） */
export type ColorTheme = 'colorful' | 'mono';

export interface ProgressPoint {
    season: number;
    episode: number;
    date: string;
}

export interface Progress {
    season: number;
    episode: number;
    /** 总集数（可选，多季汇总展示 S2 E12/24 用） */
    totalEpisodes?: number;
    lastWatchedDate?: string;
    history: ProgressPoint[];
}

export interface WatchLink {
    label: string;
    url: string;
}

/** 单次游玩记录（游戏；编辑表单记录 → 映射笔记「游玩记录」章节，playtimeMinutes 由明细累计） */
export interface PlaySession {
    /** 游玩日期 YYYY-MM-DD */
    date: string;
    /** 本次游玩时长（分钟） */
    minutes: number;
    /** 心得/备注（可选） */
    note?: string;
}

export interface MediaEntry {
    id: string;
    type: EntryType;
    title: string;
    originalTitle?: string;
    status: MediaStatus;
    rating: Rating;
    year?: number;
    genres: string[];
    director?: string;
    cast: string[];
    /** 编剧（电影/电视剧，豆瓣详情回填） */
    screenwriter?: string[];
    /** 制片国家/地区（豆瓣详情回填） */
    country?: string;
    /** 语言（豆瓣详情回填） */
    language?: string;
    /** 片长（分钟，豆瓣详情回填） */
    durationMin?: number;
    /** 又名/别名（豆瓣详情回填） */
    aliases?: string[];
    /** 书籍作者 */
    author?: string;
    /** 书籍译者（豆瓣详情回填） */
    translator?: string;
    /** 书籍出版社 */
    publisher?: string;
    /** 书籍出品方（豆瓣详情回填） */
    producer?: string;
    /** 书籍 ISBN（豆瓣详情回填） */
    isbn?: string;
    /** 书籍装帧（豆瓣详情回填） */
    binding?: string;
    /** 书籍定价（豆瓣详情回填） */
    price?: string;
    /** 书籍丛书（豆瓣详情回填） */
    series?: string;
    /** 游戏平台（如 PC / Switch） */
    platform?: string;
    /** 游戏开发商 */
    developer?: string;
    /** 音乐所属专辑（music 类型，豆瓣详情回填；表单可改，笔记 callout 表格展示） */
    album?: string;
    /** 音乐本地音频路径（music 类型；vault 相对路径优先，库外绝对路径兼容；lrc source 行来源） */
    audioPath?: string;
    /** 游戏启动快捷方式（.lnk）路径（game 类型；vault 相对优先，库外绝对兼容；「▶ 启动」打开） */
    gameLaunchPath?: string;
    /** 书籍文件路径（TXT/EPUB，阅读器打开入口；vault 相对路径，复用 audioPath 模式） */
    bookFile?: string;
    /** 已弃用（#159 删除追番表本地文件夹监控）：字段保留兼容旧数据，不再读写 */
    localWatchDir?: string;
    /** 开播日期 YYYY-MM-DD（动画：Bangumi 放送时间回填；追番表「开播季度」列数据源） */
    airDate?: string;
    /** 本地相对路径（封面/xx.jpg，v0.4 起中文化）或 https URL */
    poster?: string;
    /** 剧集进度 */
    progress?: Progress;
    /** 本地剧集视频路径（动画/电视剧，index 0 = 第 1 集；存绝对路径，编辑表单「集按钮」关联，点击打开本地播放器播放） */
    episodeFiles?: string[];
    /** 剧集网络地址（index 0 = 第 1 集；与 episodeFiles 同下标，每集可同时关联本地路径 + 网络地址，点击打开浏览器） */
    episodeUrls?: string[];
    /** 集标题（index 0 = 第 1 集；右键编辑集按钮填写，hover 显示如「【第1集标题】」） */
    episodeTitles?: string[];
    /** 追更检测已知最新集（v0.5 A2 落库）：最近一次网站更新检测到的最大集数，进追更表秒显 + 更新提示去重基线 */
    latestKnownEpisode?: number;
    /** 电影观看日期 */
    watchedDate?: string;
    /** 计划观看日期（想看队列排期，YYYY-MM-DD；非想看状态编辑时会被清空） */
    plannedDate?: string;
    /** 书籍阅读进度（页码/总页，可选；percent = 阅读器进度百分比估算 0-100，书架进度条优先读） */
    readingProgress?: { page?: number; totalPage?: number; percent?: number };
    /** 书籍元数据页数（豆瓣实体书；仅展示与统计，不参与进度换算——进度基准 totalPage 以本地文件为准） */
    pageCount?: number;
    /** 游戏游玩时长（分钟，可选；playSessions 的快捷累计，两者保持同步） */
    playtimeMinutes?: number;
    /** 游戏游玩记录（明细，日期倒序展示；可选） */
    playSessions?: PlaySession[];
    /** 数据源标识（douban/tmdb/bangumi/openlibrary/google/steam/musicbrainz/itunes/omdb/anilist/igdb；搜索回填自动记录） */
    source?: string;
    /** 数据源官方页链接（搜索回填自动记录，笔记「来源」行用） */
    sourceUrl?: string;
    /** 大众评分（数据源评分，搜索回填自动记录；分制随数据源：豆瓣/TMDB/Bangumi 10 分制、Google Books 5 分制） */
    communityScore?: number;
    /** 大众评分评价人数（豆瓣「评分（N人评价）」展示；搜索/详情回填） */
    ratingCount?: number;
    /** 作者简介（书籍，豆瓣详情页回填；表单可改，笔记展示用） */
    authorIntro?: string;
    /** 目录（书籍，豆瓣详情页回填；表单可改，笔记展示用） */
    toc?: string;
    /** 简介/剧情简介（搜索回填自动记录，编辑表单可改；笔记「## 简介」章节） */
    summary?: string;
    /** AI 一句话总结（编辑表单可手填/可 AI 生成；笔记「## 一句话总结」章节） */
    aiSummary?: string;
    /** AI 核心看点（每条一句，建议 3 条；笔记「## 核心看点」列表） */
    aiHighlights?: string[];
    links: WatchLink[];
    notes: string;
    tags: string[];
    notePath?: string;
    /** 笔记内容指纹（G 双写冲突）：writeNote 落盘后记录，检测外部手动修改用 */
    noteFingerprint?: string;
    /** 摘抄数（P1 性能缓存）：addExcerpt 时更新，书架徽标/年度总结读 catalog 不读笔记（老数据惰性迁移一次） */
    excerptCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface Catalog {
    version: number;
    entries: MediaEntry[];
    /** 活动日志（append-only，新→旧不敏感、按时间升序）：状态翻转记录，「今日记录」/日记打卡的数据源。
     *  仅记状态变更——「新增条目」以 MediaEntry.createdAt 为准（存量数据同样可回溯），避免双份真相。
     *  超上限由写入侧截断最旧（见 ACTIVITY_LOG_LIMIT）。 */
    activityLog?: ActivityEvent[];
}

/** 一条状态翻转记录（谁、何时、变成什么状态；标题展示时按 id 现查，条目删除后该条不再展示） */
export interface ActivityEvent {
    /** ISO 时间戳 */
    at: string;
    /** 条目 id（MediaEntry.id） */
    id: string;
    /** 变更后的状态 */
    status: MediaStatus;
}

/** 活动日志保留条数上限（写入侧截断最旧，防 catalog 无限膨胀） */
export const ACTIVITY_LOG_LIMIT = 500;

export function createEntryId(now: number = Date.now()): string {
    return 'e_' + now + '_' + Math.random().toString(36).slice(2, 6);
}

export function createEmptyEntry(partial: Partial<MediaEntry> = {}): MediaEntry {
    const now = new Date().toISOString();
    return {
        id: createEntryId(),
        type: 'movie',
        title: '',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: now,
        updatedAt: now,
        ...partial,
    };
}
