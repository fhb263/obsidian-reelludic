// ReelLudic 插件入口：命令/视图/设置注册 + 服务编排
import { Plugin, WorkspaceLeaf, MarkdownView, MarkdownRenderChild, requestUrl, TFile, TFolder, normalizePath, parseLinktext, Notice, Platform, moment, type FileSystemAdapter, type MarkdownPostProcessorContext } from 'obsidian';
import { DEFAULT_SETTINGS, ReelLudicSettingTab } from 'Settings';
import type { ReelLudicSettings, SourceTestResult } from 'Settings';
import { BOOK_DOWNLOAD_ENABLED } from 'pure/featureGate';
import { measure, withTimeout, TimedError, TIMEOUT_MS, retry } from 'pure/timing';
import { CLOUD_VOICE_DEFAULT, buildSpeechBody, classifySpeechError, speechEndpointUrl } from 'pure/ttsCloud';
import { createSearchCache } from 'pure/searchCache';
import { normalizeUiTheme, THEME_CLASS } from 'pure/themeTokens';
import { checkAnimeUpdate, isBlockedPage, type UpdateCheckResult } from 'pure/updateCheck';
import { EntryService } from 'services/EntryService';
import { AiSummaryService } from 'services/aiSummary';
import { LrcBilingualService } from 'services/lrcBilingual';
import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';
import type { LrcBilingualMerge } from 'pure/lrcBilingual';
// #499 AI 条目预填（新增条目「手动填写」界面标题行 ✨）
import { AiPrefillService } from 'services/aiPrefill';
import type { AiPrefillOutcome } from 'services/aiPrefill';
import type { AiPrefillInput } from 'pure/aiPrefill';
import { PREFILL_SYNOPSIS_PREFIX, PREFILL_TOOL_METADATA, PREFILL_TOOL_WEB_SEARCH } from 'pure/aiPrefill';
import { BING_SEARCH_UA, bingResultsToText, buildBingRssUrl, parseBingRss } from 'pure/bingSearch';
import { describeSearchResult, synopsisOf } from 'pure/searchDisplay';
import { createVaultIO } from 'services/vaultIO';
import { TmdbClient, type TmdbDetail, type TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
import { BangumiClient, type BangumiSearchResult } from 'services/bangumi';
import { DoubanClient, DoubanCookieError, toTmdbResult, toBookResult, toGameResult, toMusicResult, toBangumiResult, toEntryDetailFields, type DoubanSubject } from 'services/douban';
import { OpenLibraryClient } from 'services/openLibrary';
import { GoogleBooksClient, buildSearchUrl } from 'services/googleBooks';
import { MangaDexClient } from 'services/mangadex';
import { SteamClient } from 'services/steam';
import { MusicBrainzClient } from 'services/musicbrainz';
import { ItunesClient } from 'services/itunes';
import { OmdbClient, buildDetailUrl, type OmdbDetailFields } from 'services/omdb';
import { AnilistClient } from 'services/anilist';
import { IgdbClient } from 'services/igdb';
import { createSearchProgress, type SearchProgressCb, type SearchProgressReporter } from 'pure/searchProgress';
import { collectDayActivity, renderJournalBlock, todayLocal, upsertJournalSection } from 'pure/dailyLog';
import {
    FEED_RANGE_WORDS, collectFeed, feedSectionLabel, feedSpan, groupFeed, renderPeriodBlock, type FeedRange,
} from 'pure/activityFeed';
import type { ActivityEvent } from 'data/types';
import { nodeHttpGet, nodeHttpPost, nodeHttpGetBuffer } from 'services/nodeHttp';
import { fetchLyric, searchLyrics, type LyricFetchOutcome, type LyricSearchOutcome } from 'services/lyricSearch';
// 四平台下载面（#399-D 移植批）：搜索 / 歌单 / 下载 / 连通性测试全在 `services/dl`
import {
    DL_SEARCH_ORDER,
    dlDownloadSong,
    dlPlaylistSongs,
    dlPreviewAudio,
    dlRecommendedPlaylists,
    dlSearch,
    neteaseCoversByIds,
    dlTestConnection,
    type DlPreviewResult,
    type DlTransport,
    type DownloadProgressCallback,
    type DownloadSong,
    type PlaylistSource,
    type RecommendedPlaylist,
} from 'services/dl';
import { MusicDownloadModal } from 'modals/MusicDownloadModal';
// #496 B 站：搜索两步请求在 `services/dl/bilibili`，起 yt-dlp 进程在 `services/ytdlp`
// 🔴 两者都不在 `services/dl` 里 —— 那边是**四平台音乐**（直连音频流），这边是**视频站 + 外部进程**，
//    混进去会让「四平台」这条链路的职责说不清。
import { dlBiliSearch, dlBiliView } from 'services/dl/bilibili';
import { defaultYtDlpDeps, fetchBiliAudioWithYtDlp } from 'services/ytdlp';
import type { BiliPart, BiliVideo } from 'pure/dl/bilibili';
import { buildSongFilename } from 'pure/dl/utils';
// #414 书籍下载（**#417 起 = 用户自备来源**；**#422 续四 起只剩「书源」一条通道** —— 「粘贴直链」已撤）
// 🔴 #433：文学 / 网文**各一个窗口**（薄壳共用一个基类）
import { BookDownloadModal, LiteratureDownloadModal, NovelDownloadModal } from 'modals/BookDownloadModal';
// #419 网文书源（**SoNovel 格式，书源由用户自备** —— 用户 2026-09-28 裁定「按参考软件做」）
import { groupSourcesByKind, mergeSources, moveAllSourcesToKind, parseSourceJson, sourceKey, sourceKindOf, sourceSummary, type NovelSource, novelFailText, type SourceKind } from 'pure/sourceRule';
// #432 甲：源生命周期（订阅 / 粘贴 / 体检）—— 清单解析、拉取、体检汇总三处真源
import { parseSourcePack, type SourcePackSkipped } from 'pure/sourcePack';
import { fetchSourceText, fetchSourceTexts } from 'services/sourceFetch';
import { SOURCE_HEALTH_KEYWORD, sourceCheckWorkers, type SourceCheckResult } from 'pure/sourceCheck';
// 🔴 #431：`novelTocPreview` = 章节名写回「目录」时的**裁断唯一出口**（前 10 章 + `....`）
import { buildNovelTxt, failedChaptersText, novelBookFilename, novelTocPreview } from 'pure/novelPack';
// 🔴 #428 取消令牌：抓章那一路的可中断等待（真源 `pure/cancel`）—— 「点了取消没反应」的解法
import { CancelledError, createCancelToken, raceCancel, type CancelToken } from 'pure/cancel';
// 🔴 P1-C 断点续传：存档的 schema / 容错解析 / 命名与路径全在 `pure/chapterPlan`（宿主只管读写 + append 一行一章）
import {
    chaptersFingerprint,
    parseResume,
    resumeChapterLine,
    resumeDir,
    resumeFileName,
    resumeMatches,
    resumeMetaLine,
    resumePath,
    type ResumeChapter,
    type ResumeMeta,
} from 'pure/chapterPlan';
// #420 P1-B：EPUB 合成（纯逻辑出文件清单 + 服务层打 zip，mimetype 首条且 STORED 有字节级自检）
import { epubFileList, isoUtc } from 'pure/epubPack';
import { zipEpub } from 'services/epubWriter';
// #421 书源导入的**唯一**文件选择实现（设置页与下载弹窗共用）
// #425：文件选择搬去了调用方（设置页 `services/filePick` / 弹窗 Svelte 模板）——
// 宿主那条「自己弹文件框」的方法随之退场（文件框必须挂调用方自己的 DOM），import 也一并去掉。
// ⚠️ 说明里**不写那个方法的名字**：产物不剥注释，而反向守卫正拿它核「有没有长回来」（本仓老坑）。
import {
    NOVEL_SOURCE_HEADERS,
    fetchNovelChapters,
    fetchNovelTocOrWhole,
    searchNovelSource,
    searchNovelSources,
    type NovelFetch,
    type NovelSearchHit,
    type NovelSourceSearchResult,
    type NovelTocItem,
} from 'services/novelSource';
import type { LyricSourceId } from 'pure/lyricOnline';
import { HomeView, HOME_VIEW_TYPE } from 'views/HomeView';
import type { HomeTab } from 'views/tab';
import { EntryModal } from 'modals/EntryModal';
import { SeriesPickerModal } from 'modals/SeriesPickerModal';
import type { SeriesGroup } from 'pure/seriesGroup';
import { ConfirmModal } from 'modals/ConfirmModal';
import { LinkPickerModal } from 'modals/LinkPickerModal';
import { EpisodePickerModal } from 'modals/EpisodePickerModal';
import { QuickAssociateModal, type QuickAssociateResult, type QuickAssocPickKind } from 'modals/QuickAssociateModal';
import { ExcerptModal } from 'modals/ExcerptModal';
import { AssetCleanupModal } from 'modals/AssetCleanupModal';
import { DeleteEntryModal } from 'modals/DeleteEntryModal';
import { GameSessionModal } from 'modals/GameSessionModal';
import { VaultFileSuggest } from 'modals/VaultFileSuggest';
import { EpubReaderView, PdfReaderView, TxtReaderView, EPUB_READER_VIEW_TYPE, PDF_READER_VIEW_TYPE, TXT_READER_VIEW_TYPE } from 'views/ReaderViews';
import { probePdfNumPages } from 'modals/PdfReaderModal';
// #351 阅读排版载荷（两个阅读器与宿主共用一份形状；字体/字重/字距的归一化也从这里取）
import { normalizeFontFamily, normalizeFontWeight, normalizeLetterSpacing, type ReaderTypoPayload } from 'pure/readerTypography';
import { countExcerpts, generateBlockId, parseExcerptBlocks, type ParsedExcerpt } from 'pure/excerpt';
import {
    parseHighlightBlocks,
    normalizeHlStyle,
    normalizeHlColor,
    findSameExcerpt,
    type HlStyle,
    type HlColor,
    type ReaderHighlight,
} from 'pure/highlight';
import { normalizeProgress, readingProgressFilePath, matchLegacyProgressFile, progressFileName, bookmarksFileName } from 'pure/readingProgress';
import { pageFromPercent, reconcileBookProgress, type BookFileInfo, type BookProbeResult, type BookProgressFields } from 'pure/bookProgress';
import { bookmarksFilePath, parseBookmarks, type ReaderBookmark } from 'pure/bookmark';
import {
    mergeLegacyStore,
    normalizeStore,
    readerStoreDir,
    readerStoreFilePath,
    serializeStore,
    withBookmarks,
    withHighlights,
    withProgress,
    type ReaderStore,
} from 'pure/readerStore';
import { buildTranslateBody, buildTranslatePingBody, pickPingModel, parseAiReply, aiHttpIssue, providerLabel, resolveModel, translateChatUrl, modelsUrl, parseModelList, normalizeProvider, normalizeAiChoice, aiKeyField, AI_PROVIDER_OFF, type AiProviderChoice, type TranslateProvider, type TranslateRequestBody, type ModelFetched } from 'pure/translate';
import { buildSearchBody, buildSearchQuestionBody } from 'pure/readerSearch';
import { parseTxtBook } from 'pure/txtParse';
import { decodeTxtBytes } from 'pure/txtEncoding';
import { containerRootfile, parseOpf, parseTocNav, extractChapterLabel, isTocAmbiguous, rebuildTocFromSpine } from 'pure/epubParse';
import { parseReaderDeepLink, readerDeepLinkFromParams } from 'pure/readerLink';
import {
    buildShotBlock,
    buildTimeLink,
    matchLineLink,
    parseTimeLink,
    shotFileName,
    videoDeepLinkFromParams,
    type VideoTimeTarget,
} from 'pure/videoLink';
import { type VideoMark } from 'pure/videoMarks';
import { sanitizePosterTitle } from 'pure/posterFile';
// #349 附件清理：孤儿资产判定（封面 + 阅读存档）收敛在纯模块里；#350 起同一模块还产「删除条目的资产计划」
import { buildOrphanAssets, entryAssetPlan, type OrphanAsset } from 'pure/orphanAssets';
import { imageSizeFromBytes } from 'pure/imageSize';
import { toFileUrl } from 'pure/mediaFileUrl';
import { isEmbeddableVideoPath, isAssociableAudioPath, VIDEO_ASSOCIABLE_EXTENSIONS, AUDIO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';
import type { MediaInfo } from 'pure/mediaInfo';
// #404「库内音乐目录里找回同名音频」：目录真源 `downloadDir` + 匹配纯模块
import { downloadDir, downloadDirAbsPath, downloadRelPath, downloadSizeIssue, migrateLegacyDownloadDir, type DownloadKind } from 'pure/downloadPlan';
import type { LibraryAudioFile } from 'pure/libraryAudio';
// #497「改名关联的音频文件」：路径拆分 / 校验 / 目标 .lrc 路径的唯一真源
import { planAudioRename } from 'pure/renameAudio';
// #498「从网络搜索封面」：请求地址 / 解析 / 缩略图回退链 / 下载 Referer 的唯一真源
import { posterReferer, type PosterCandidate } from 'pure/posterSearch';
import { searchPosterImages, POSTER_UA } from 'services/posterSearch';
// #509：封面来源（网络搜索 + 四大音乐平台）与「平台封面→大图」的实测规则
import { platformCandidates, type PosterSource } from 'pure/posterSources';
// #417「库内找回同名书籍文件」：白名单真源走 `downloadPlan`，匹配纯模块是 `libraryBooks`
import { isAssociableBookPath, type LibraryBookFile } from 'pure/libraryBooks';
// #464 在线曲库：四平台搜歌结果 → 音乐结果卡片（纯映射；请求复用 `dlSearchSongs`）
import { songLibraryResults, SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
import { dirOfPath, fileNameOfPath, pickSubtitleCandidates, srtToVtt, type SubtitleCandidate } from 'pure/subtitle';
import { scanEpisodeNumbers } from 'pure/episodeScan';
import { initGlobalTooltip } from 'services/globalTooltip';
import { VideoPlayerView, VIDEO_PLAYER_VIEW_TYPE, type EmbedVideoItem, type VideoPlayerOptions } from 'views/VideoPlayerView';
// ④-4 内置音频播放器：视图 + 可复用装配层（笔记内 ` ```lrc ` 块共用同一套 DOM）
import { AudioPlayerView, AUDIO_PLAYER_VIEW_TYPE, type AudioPlayerOptions } from 'views/AudioPlayerView';
import { AudioInlineBlock, type AudioPlayerTrack } from 'views/audioPlayerMount';
// ④ 歌词：四路来源优先级与 ` ```lrc ` 块围栏口径的唯一真源（生成侧 noteGenerator 与消费侧播放器共用）
import { extractLrcBlock, parseLrcBlock, parseLrcRef, pickLyrics, siblingLrcPath, type LrcBlock, type LrcLyricsOrigin } from 'pure/lrcSource';
import { readEmbeddedLyrics } from 'pure/embeddedLyrics';
import { normalizeAudioPlayMode, playersToPause, type PlayerKind } from 'pure/audioQueue';
import { clampAudioVolume } from 'pure/audioVolume';
import { fileDisplayName } from 'pure/libraryDir';
import { mergeBySource, sortByRelevance } from 'pure/searchMerge';
import { PROVIDER_META, resolveSourceChain, sourceGroupForBookKind, sourceGroupForType, sourceEnLabel, deriveGroupSearchError, type AuxState, type SourceGroup, type ProviderId } from 'pure/sourceRegistry';
import { audioSubtitle } from 'pure/cardMeta';
import type { BookKind } from 'data/types';
import { DIR_NOTES, DIR_COVERS, DIR_BACKUPS, DIR_REPORTS, typeDir, LEGACY_TYPE_DIR_ZH, relocateLegacyNotePath } from 'pure/dirs';
import { migrateNovelNotes } from 'services/novelMigration';
import { generateYearReport, yearReportPath } from 'pure/report';
import { listReportYears } from 'pure/reportIndex';
import { ENTRY_TYPES, type MediaEntry, type EntryType } from 'data/types';
import type { Rating } from 'pure/rating';

/** 辅助数据源（TMDB/Bangumi）搜索超时（ms）：无代理/慢网络时宁可放弃也不拖慢豆瓣主链路 */
const AUX_SEARCH_TIMEOUT = 5000;

/** 链内非 douban 源 id（douban 主源走既有 doubanFallback，不进 aux 超时包装） */
type AuxProviderId = Exclude<ProviderId, 'douban'>;

/** 可选 Key 辅助源（key 仅提升配额/免限流，未配仍照常运行、不带 key 请求）：T5 现状仅 googleBooks */
const OPTIONAL_KEY_AUX: ReadonlySet<AuxProviderId> = new Set(['googleBooks']);

/** 影视/剧集组搜索合并结果的类型（#165 T9）：omdb imdbID 为字符串，与 tmdb id:number 不可强塞——
 *  以联合并排（TmdbSearchResult | OmdbSearchResult），OmdbSearchResult 独立类型决策见 tests/omdb.test.ts；
 *  merge/sort 仅依赖 title/source，联合成员均可兼容 */
type MovieTvSearchResult = TmdbSearchResult | OmdbSearchResult;

/**
 * 辅助源搜索 runner：检索词 + 条目类型上下文（影视组源收到 'movie'|'tv'，其余组源为组对应类型）+ 进度器。
 * runner 只负责发起该源搜索并返回结果；超时包装 / 失败置 failed / 进度步 / 状态归集统一由 runAuxSource 层负责——
 * runner 内不弹 Notice、不做 withTimeout（T3 对齐 spec S3「失败源静默降级」，收敛 B1 的 tmdb/bangumi 单源失败 Notice）。
 */
type AuxSearchRunner = (query: string, type: EntryType, prog?: SearchProgressReporter) => Promise<unknown[]>;

/** 豆瓣主源一次运行结果（主源不限时 + reachable/cookieInvalid 归集） */
interface DoubanRun<T> {
    kind: 'douban';
    items: T[];
    reachable: boolean;
    cookieInvalid: boolean;
}

/** 单个辅助源一次运行结果（含归集状态，供 derive） */
interface AuxRun<T> {
    kind: 'aux';
    id: AuxProviderId;
    items: T[];
    state: AuxState;
}

/** 一次组内搜索的源运行归集（供五个 searchXFresh 合并 + derive 用） */
interface GroupSearchRun<T> {
    chain: ProviderId[];
    /** 各 aux 源状态（仅链内已参与判定的 aux 源；未注册 runner 源标 absent） */
    aux: Partial<Record<AuxProviderId, AuxState>>;
    /** 各 aux 源原始结果（链序） */
    auxItems: Partial<Record<AuxProviderId, T[]>>;
    /** douban 主源运行结果（链含 douban 时返回；否则 undefined） */
    douban: DoubanRun<T> | undefined;
}

/** 阅读数据存档的内存态（进度 + 书签 + 高亮三合一；落盘由 flush 合并，见 readerStores 注释） */
interface ReaderStoreMem {
    store: ReaderStore;
    /** 条目标题（文件名基准；条目改名后按新名落盘，旧文件成孤儿） */
    title: string;
    /** 合并窗口定时器（非 null = 已有待写，滚动期间不重复起表） */
    timer: number | null;
}

/** 进度落盘的合并窗口（ms）：滚动期间最多 1 写/秒（KOReader 式内存态 + 合并落盘，压住写放大） */
const READER_STORE_FLUSH_MS = 1000;

/**
 * LyricFlux 的插件 ID（④-4「笔记内 lrc 块」让位判定用）。
 * 它也注册同名 `lrc` 代码块处理器（`LyricsMarkdownRender`）⇒ 两边同时接管会画出两个播放器。
 * 取自其 `manifest.json` 的 `id`（⛔ 不是显示名「LyricFlux」）。
 */
const LYRICFLUX_PLUGIN_ID = 'obsidian-lyricflux';

export default class ReelLudicPlugin extends Plugin {
    settings: ReelLudicSettings = DEFAULT_SETTINGS;
    service!: EntryService;
    private tmdb!: TmdbClient;
    private bangumi!: BangumiClient;
    private openLibrary!: OpenLibraryClient;
    private googleBooks!: GoogleBooksClient;
    /** 漫画源（2026-09-30 接入，用户裁定）：MangaDex 免 Key，走 comic 组的第三源 */
    private mangadex!: MangaDexClient;
    private steam!: SteamClient;
    private musicbrainz!: MusicBrainzClient;
    private itunes!: ItunesClient;
    private omdb!: OmdbClient;
    private anilist!: AnilistClient;
    private igdb!: IgdbClient;
    private douban!: DoubanClient;
    /** 搜索结果内存缓存（30min TTL，防重复搜索：429 限流/豆瓣反爬友好） */
    private readonly searchCache = createSearchCache<unknown>({ ttlMs: 30 * 60 * 1000, maxSize: 200 });
    /** sourceChains 上次持久化基线（JSON 串）：链配置变更时清搜索/更新检测缓存（见 saveSettings）。onload 时以磁盘加载值初始化 */
    private sourceChainBaselineJson = '';
    /** 系统文件/目录选择器上次选中目录（会话级记忆）：逐集「浏览」/批量检索接续上次位置（defaultPath） */
    private lastSystemDir = '';
    /** #462 本地音频「体积 + 时长」探测缓存（按路径）：hover 是高频动作，同一文件只探一次
     *  （⚠️ 会话内不失效 —— 文件被替换后数字会旧；探一次的成本远低于每次重探，且旧数字不影响使用） */
    private readonly audioInfoCache = new Map<string, MediaInfo>();
    /** ④-4 音频播放器：上一次播放的条目（命令面板「在标签页/侧边栏打开」用它重建队列） */
    private lastAudioEntry: MediaEntry | null = null;
    /** 笔记内块锚点链接 → 该书阅读器 leaf（M1 双向溯源：同一本书不重复开标签，D-4）；用前按 getLeavesOfType 校验存活 */
    private readonly readerLeaves = new Map<string, WorkspaceLeaf>();
    /**
     * 辅助源 runner 注册表（T3）：新源接入 = 在 rebuildClients 里注册一行 runner，不再改搜索函数。
     * 链中含但未注册 runner 的源在搜索时静默跳过（aux=absent），保证「注册表/默认链先行、客户端分批落地」的中间态不回归。
     * douban 主源不走本表（走既有 doubanFallback：主源不限时 + reachable/cookieInvalid 归集）。
     */
    private auxRunners: Partial<Record<AuxProviderId, AuxSearchRunner>> = {};
    /** 数据目录归一化（空值回退 ReelLudic、去尾部斜杠；多处共用） */
    private get libDir(): string {
        return normalizePath(this.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
    }
    /** Buffer → ArrayBuffer（去池偏移；pdfjs/JSZip/封面下载需要精确数据边界） */
    private toArrayBuffer(b: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): ArrayBuffer {
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    }
    /** 统一视图当前页签（追番表/书籍/影视/游戏/统计） */
    homeTab: HomeTab = 'media';
    /** 数据文件变更刷新防抖定时器（vault 监听兜底） */
    private refreshTimer: number | null = null;

    /** 搜索入口缓存包装：命中直接返回；未命中执行后缓存（按 type+query 维度） */
    private cachedSearch<T>(key: string, fn: () => Promise<T[]>): Promise<T[]> {
        const hit = this.searchCache.get(key);
        if (hit) return Promise.resolve(hit as T[]);
        return fn().then((items) => {
            this.searchCache.set(key, items);
            return items;
        });
    }

    async onload(): Promise<void> {
        // 构建标识（#334）：每次加载打一行 —— 用来判断「磁盘上这份构建到底有没有被 Obsidian 读进去」。
        // 值 = 打包时刻（esbuild `define` 注入），与 `main.js` 的修改时间对齐；**不参与任何逻辑**。
        console.log(`[ReelLudic] build ${__REEL_BUILD__}`);
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // 界面主题全面 modern（1.0.3）：设置页已删除切换入口，磁盘残留 native 的老用户在此强制迁移
        // （与下方 colorTheme='mono' 同构的「下线项兜底」，saveSettings 会把 'modern' 写回磁盘自愈）。
        // normalizeUiTheme 保留在 applyUiTheme 内做防御性归一，此处不再需要。
        this.settings.uiTheme = 'modern';
        // colorTheme 迁移（**不是死代码，别删**）：v0.0.1 曾提供「色彩主题：彩色/单色」设置项，
        // v0.4 起设置页移除该入口、外观固定单色。但设置项下线 ≠ 磁盘值消失 —— v0.0.1~v0.3.x 期间
        // 选过「彩色」的用户，data.json 里会永久残留 colorTheme:"colorful"。此处必须强制定为 'mono'：
        // 它曾是全仓**唯一**的纠正点，一旦删掉，MediaList.svelte 的 `{#if colorTheme === 'colorful'}`
        // 分支就会对这批老用户复活（他们的 Svelte prop 默认值也是 'colorful'），
        // 表现为升级后突然冒出类型色条 —— 而设置页已无入口、saveSettings 也不覆写，用户无法自救。
        this.settings.colorTheme = 'mono';
        // sourceChains 基线以磁盘加载值初始化：此后 saveSettings 只要链配置与上次持久化基线不同即清缓存
        this.sourceChainBaselineJson = JSON.stringify(this.settings.sourceChains ?? {});
        // 目录命名演进迁移（顶层中文化 + 类型子目录英文化，幂等）：须在 rebuildService 之前执行，service 用新路径构造
        await this.migrateDirectories();
        this.rebuildService();
        // 阅读进度/书签文件名可读化迁移（旧 e_xxx 名 → {书名}-阅读进度|书签-{id}，幂等；须在 service 就绪后）
        await this.migrateProgressFileNames();
        this.rebuildClients();

        // 🔴 #459 下载目录**一次性**迁移（与「填了『下载/音乐』却多出『下载/音乐/音乐』」同一批）。
        //   本批起「音频文件目录 / 书籍文件目录」的值 = **目录本身**（`downloadDir` 不再拼子目录），
        //   而存量值里有一批是**旧缺省 `下载`**（那时它是「下载根」，实际落盘 = `下载/音乐`）
        //   ⇒ 不迁就会把新文件落到 `下载/`，与已下好的 `下载/音乐/**` 分家、且「检索同名音频」扫的是
        //     同一份目录（`listLibraryAudioFiles`）⇒ 用户看到「以前下的歌全搜不到了」。
        //   ⚠️ **只跑一次**（标记位）：用户完全可能**故意**填 `下载`（就想都放一处），
        //      每次载入都改 = 用户改不回去。
        if (!this.settings.downloadDirMigrated) {
            this.settings.musicDownloadDir = migrateLegacyDownloadDir(this.settings.musicDownloadDir, 'music');
            this.settings.bookDownloadDir = migrateLegacyDownloadDir(this.settings.bookDownloadDir, 'book');
            this.settings.downloadDirMigrated = true;
            await this.saveSettings();
        }

        this.applyUiTheme();

        this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));
        this.registerView(VIDEO_PLAYER_VIEW_TYPE, (leaf) => new VideoPlayerView(leaf));
        this.registerView(AUDIO_PLAYER_VIEW_TYPE, (leaf) => new AudioPlayerView(leaf));
        // 阅读器三件（TXT / EPUB / PDF）：工作区新标签页打开（Modal 宿主于本批整体撤除）
        this.registerView(TXT_READER_VIEW_TYPE, (leaf) => new TxtReaderView(leaf));
        this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => new EpubReaderView(leaf));
        this.registerView(PDF_READER_VIEW_TYPE, (leaf) => new PdfReaderView(leaf));
        // 笔记内摘录/高亮块头行链接 → 打开阅读器并定位（M1 双向溯源）。
        // 捕获阶段挂 document：既抢在 Obsidian「打开源文件」之前，也能 stopPropagation 彻底拦下那次导航。
        this.registerDomEvent(document, 'click', this.onWorkspaceAnchorClick, true);
        // 「回到原文」深链（`[↩](obsidian://reelludic?…)`）的**兜底通道**：笔记内点击由上面的捕获阶段拦截处理，
        // 万一被别的插件抢先 / 或从浏览器等外部唤起，Obsidian 会把 `obsidian://reelludic?…` 路由到这里。
        // 🔴 插件**无法**注册 OS 级自定义协议（`app.setAsDefaultProtocolClient` 是 Electron 主进程能力，
        //    插件只跑在渲染进程）—— `obsidian://` 就是官方给的等效机制（生态里 Bible Tools / Slurp 同款）。
        // 🔴 2026-09-19 用户第三次报障的**真根因就在这里**：本处理器原先「把 params 拼回 URL 再交给
        //    `parseReaderDeepLink` / `parseTimeLink`」，而 Obsidian 的 URI 语义是 `obsidian://<action>?<params>`
        //    —— **host 就是 action**，查询里写的 `action=video` 会被 host 名覆盖掉。用户日志实证：
        //    `Received URL action {action: 'reelludic', entry: 'e_…', ep: '0', t: '430'}`
        //    → 拼回的 URL action 已不是 `video`（也不是 `jump`）→ **两个解析器都 null → 静默什么都不做**。
        //    （日志里能看到 URL 被收到、界面上却毫无反应，正是这个形态。）
        //    ⇒ 现在**按参数形状分派**：`book`+`block` = 阅读器跳转；`entry` = 视频时间戳。**完全不看 action**。
        //    顺带修好了用户笔记里已经写好的旧链接（它们的 `action=jump` / `action=video` 同样是死的）。
        this.registerObsidianProtocolHandler('reelludic', (params) => {
            const p = (params ?? {}) as Record<string, unknown>;
            const reader = readerDeepLinkFromParams(p);
            if (reader) {
                void this.openDeepLinkTarget(reader);
                return;
            }
            const video = videoDeepLinkFromParams(p);
            if (video) void this.openVideoAt(video);
        });
        // 全局统一 hover 提示（data-tip 自绘气泡，UI-GUIDE 规范；卸载自动清理）
        this.register(initGlobalTooltip().destroy);
        // 书籍阅读器视图（新 Tab 打开，可拖出独立窗口）

        // 数据文件变更自动刷新（防抖兜底）：catalog.json / 条目笔记的创建、修改、删除
        // 覆盖外部修改、手动删文件等非插件路径，保证界面始终反映最新数据状态
        const onDataChange = (file: { path: string }): void => this.onVaultDataChange(file.path);
        this.registerEvent(this.app.vault.on('create', onDataChange));
        this.registerEvent(this.app.vault.on('modify', onDataChange));
        this.registerEvent(this.app.vault.on('delete', onDataChange));

        this.addRibbonIcon('library', 'ReelLudic', () => void this.activateHome('media'));
        this.addRibbonIcon('plus', 'ReelLudic 添加条目', () => this.openAddModal());

        this.addCommand({
            id: 'open-media-library',
            name: '打开媒体库',
            callback: () => void this.activateHome('media'),
        });
        // #326：时间戳 / 截图也挂命令面板（用户裁定 D-6：按钮 + 快捷键 + 命令三入口）。
        // 只在活动页是播放器时可用（checkCallback）—— 没有播放器就没有「当前帧」可言。
        this.addCommand({
            id: 'player-insert-timestamp',
            name: '播放器：插入当前时间戳',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(VideoPlayerView);
                if (!view) return false;
                if (!checking) void view.insertStamp();
                return true;
            },
        });
        this.addCommand({
            id: 'player-capture-frame',
            name: '播放器：截取当前帧并写入笔记',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(VideoPlayerView);
                if (!view) return false;
                if (!checking) void view.takeShot();
                return true;
            },
        });        this.addCommand({
            id: 'open-tracking-board',
            name: '打开计划表',
            callback: () => void this.activateHome('tracking'),
        });
        this.addCommand({
            id: 'add-media-entry',
            name: '添加条目',
            callback: () => this.openAddModal(),
        });
        this.addCommand({
            id: 'add-excerpt',
            name: '添加摘抄（书籍）',
            callback: () => this.openExcerptModal(),
        });
        // #349 附件清理：条目删除后遗留的封面 / 阅读存档此前只能去设置页找，补一个命令面板入口
        this.addCommand({
            id: 'cleanup-orphan-assets',
            name: '附件清理：清理未引用的封面 / 阅读存档',
            callback: () => void this.openAssetCleanup(),
        });
        // ④-4 音频播放器两条命令入口（D-9(a)）。都作用于「上一次播放的音乐条目」：
        // 命令面板没有「当前条目」这个概念，而队列来源是库内音乐条目（设计文档 §5.5 待裁定 A 方案）。
        this.addCommand({
            id: 'audio-player-open-tab',
            name: '音频播放器：在标签页打开',
            callback: () => void this.openAudioPlayer('tab'),
        });
        this.addCommand({
            id: 'audio-player-open-sidebar',
            name: '音频播放器：在右侧边栏打开',
            callback: () => void this.openAudioPlayer('sidebar'),
        });
        /**
         * #414 书籍下载（#422 续四 起**只有书源一条通道**：用户裁定删掉「粘贴直链」）。
         * 命令面板里**没有「当前条目」** ⇒ 分类只能由命令名给（这条是「文学」）；下载成功后只落盘到
         * 「下载/书籍」（没有条目可关联 ⇒ 提示里给出路径，不假装关联成功）。
         *
         * 🔴 #468 封禁（用户 2026-10-01：「把下载网文和文学类的入口都封禁掉…这类搞不定规划到未来再解禁」）：
         *    这两条命令**整块不再注册** ⇒ 命令面板里搜「下载书籍」一条都搜不到。
         *    ⛔ 别在这里改条件：解禁 = 翻 `pure/featureGate.BOOK_DOWNLOAD_ENABLED` 那一个布尔值。
         *    ⚠️ 实现（`openBookDownloader` / `BookDownload.svelte` / 书源服务）**原样保留**，封的只是入口。
         */
        if (BOOK_DOWNLOAD_ENABLED) {
            this.addCommand({
                id: 'book-download-open',
                name: '下载书籍：按书源搜索文学并入库',
                callback: () =>
                    this.openBookDownloader((relPath) => {
                        new Notice(`已下载到「${relPath}」`, 4000);
                    }, 'book'),
            });
            /**
             * #419 网文下载（**书源由用户自备**）：与上面那条走**同一个弹窗**，只是分类给「网文」
             *   ⇒ 优先用「网络文学源」那一批（本类为空时会回退到全部，见 `BookDownload.svelte` 的 `shown`）。
             * ⚠️ 没导入任何书源时会由弹窗自己提示「先去设置里导入」。
             */
            this.addCommand({
                id: 'novel-download-open',
                name: '下载书籍：按书源搜索网文并入库',
                callback: () =>
                    this.openBookDownloader((relPath) => {
                        new Notice(`已下载到「${relPath}」`, 4000);
                    }, 'novel'),
            });
        }

        this.registerLrcBlockProcessor();
        this.addSettingTab(new ReelLudicSettingTab(this.app, this));
    }

    async onunload(): Promise<void> {
        // 卸载时清理主题类，避免插件禁用后 body 上残留孤儿类。
        // 从 THEME_CLASS 取值而非硬编码类名：将来增删主题时不漏改清理点（native 的 '' 跳过）。
        for (const cls of Object.values(THEME_CLASS)) {
            if (cls !== '') document.body.removeClass(cls);
        }
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        // 阅读数据存档：把合并窗口里还没落盘的进度写掉 —— 否则禁用插件/关应用会丢掉最后一次滚动
        const pending = [...this.readerStores.keys()];
        for (const mem of this.readerStores.values()) {
            if (mem.timer !== null) {
                window.clearTimeout(mem.timer);
                mem.timer = null;
            }
        }
        await Promise.all(pending.map((id) => this.flushReaderStore(id)));
    }

    /**
     * 应用界面主题：在 document.body 挂/去 `rl-theme-modern`。
     * 单点挂载即可覆盖主界面与**全部弹窗**——Obsidian 的所有 Modal 都挂在 body 下，
     * 故 `.rl-theme-modern` 作为后代选择器前缀天然命中它们，无需逐个 Modal 改继承链。
     * 1.0.3 起全面 modern：设置页已无切换入口，settings.uiTheme 恒为 'modern'（onload 强制覆写），
     * 主题类始终挂上；本方法保留通用挂载逻辑（防御性 normalize），供将来恢复切换时复用。
     */
    applyUiTheme(): void {
        const theme = normalizeUiTheme(this.settings.uiTheme);
        const cls = THEME_CLASS[theme];
        document.body.toggleClass('rl-theme-modern', cls !== '');
        // 结构型主题差异（如页签的分段控件/指示器）无法只靠 CSS 变量表达，需把主题传给视图组件。
        // 不复用 refreshViews()：那个方法会连带重新 list() 全部条目与摘抄计数（磁盘 IO），
        // 而此处只需重推主题 prop。组件 $set 仅传 uiTheme，其余 props 保持不动。
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            (leaf.view as HomeView).setUiTheme(theme);
        }
    }

    /** 目录命名演进迁移（幂等，旧版任意起点一步到位；须在 rebuildService 之前执行，service 用新路径构造）：
     *  v0.4：顶层通俗化 entries/covers/backups/reports → 笔记/封面/备份/报告，类型子目录用中文标签；
     *  本版：类型子目录中文标签 → 英文（笔记/电影 → 笔记/movie、电视剧 → teleplay、动画 → animation、书籍 → book、游戏 → game、音乐 → music）；
     *  1.0.3.1：书籍再按子分类分目录（笔记/book/ 文学、笔记/novel/ 网文）。 */
    private async migrateDirectories(): Promise<void> {
        const dir = this.libDir;
        const vault = this.app.vault;
        // 1) v0.4 前旧库（entries/{类型键} 平铺）：先搬类型子目录再搬顶层，避免嵌套 rename 冲突；
        //    typeDir() 现返回英文目录名 → 一步落到 笔记/{英文}
        const oldNotes = vault.getAbstractFileByPath(`${dir}/entries`);
        if (oldNotes instanceof TFolder && !(vault.getAbstractFileByPath(`${dir}/${DIR_NOTES}`) instanceof TFolder)) {
            for (const t of ENTRY_TYPES) {
                const oldSub = vault.getAbstractFileByPath(`${dir}/entries/${t}`);
                if (oldSub instanceof TFolder) {
                    await vault.rename(oldSub, `${dir}/entries/${typeDir(t)}`);
                }
            }
            await vault.rename(oldNotes, `${dir}/${DIR_NOTES}`);
        }
        // 1b) 类型子目录英文化（v0.4–v1.0.1 中文标签库：笔记/电影 → 笔记/movie，幂等：目标已存在则跳过）
        for (const t of ENTRY_TYPES) {
            const oldSub = vault.getAbstractFileByPath(`${dir}/${DIR_NOTES}/${LEGACY_TYPE_DIR_ZH[t]}`);
            const target = `${dir}/${DIR_NOTES}/${typeDir(t)}`;
            if (oldSub instanceof TFolder && !(vault.getAbstractFileByPath(target) instanceof TFolder)) {
                await vault.rename(oldSub, target);
            }
        }
        // 2) 封面/备份/报告目录（v0.4，幂等）
        const simple: [string, string][] = [
            ['covers', DIR_COVERS],
            ['backups', DIR_BACKUPS],
            ['reports', DIR_REPORTS],
        ];
        for (const [old, neu] of simple) {
            const f = vault.getAbstractFileByPath(`${dir}/${old}`);
            if (f instanceof TFolder && !(vault.getAbstractFileByPath(`${dir}/${neu}`) instanceof TFolder)) {
                await vault.rename(f, `${dir}/${neu}`);
            }
        }
        // 3) catalog.json 引用更新：notePath 类型段 → 英文目录名，poster 前缀 covers/ → 封面/
        const catFile = vault.getAbstractFileByPath(`${dir}/catalog.json`);
        if (catFile instanceof TFile) {
            const text = await vault.read(catFile);
            try {
                const raw = JSON.parse(text) as { entries?: { notePath?: string; poster?: string }[] };
                let changed = false;
                for (const e of raw.entries ?? []) {
                    // v0.4 前旧引用：entries/{类型键}/ → 笔记/{英文}（一步到位）；本版 relocate 对已是 笔记/{中文} 的接力转英文
                    if (e.notePath?.startsWith(`${dir}/entries/`)) {
                        for (const t of ENTRY_TYPES) {
                            const oldP = `${dir}/entries/${t}/`;
                            if (e.notePath.startsWith(oldP)) {
                                e.notePath = `${dir}/${DIR_NOTES}/${typeDir(t)}/${e.notePath.slice(oldP.length)}`;
                                changed = true;
                                break;
                            }
                        }
                    }
                    if (e.notePath) {
                        const relocated = relocateLegacyNotePath(e.notePath);
                        if (relocated !== e.notePath) {
                            e.notePath = relocated;
                            changed = true;
                        }
                    }
                    if (e.poster?.startsWith('covers/')) {
                        e.poster = `${DIR_COVERS}/${e.poster.slice('covers/'.length)}`;
                        changed = true;
                    }
                }
                if (changed) await vault.modify(catFile, JSON.stringify(raw, null, 2));
            } catch {
                // catalog 解析失败：跳过引用更新（目录已搬，新条目用新路径）
            }
        }
        // 4) 网文笔记并入 笔记/novel/（1.0.3.1：书籍按子分类分目录，用户 2026-09-13 指定）
        await this.migrateNovelNotes();
    }

    /** 网文（bookKind=novel）笔记迁入 笔记/novel/（1.0.3.1，幂等）：
     *  迁移算法下沉 services/novelMigration（结构性 vault 接口 + 内存假 vault 单测 10 例：幂等 / 冲突不覆盖 /
     *  源缺只补引用 / 非网文不动 / 解析失败静默），此处只做 Obsidian Vault API 薄适配。 */
    private async migrateNovelNotes(): Promise<void> {
        const vault = this.app.vault;
        const libDir = this.libDir;
        await migrateNovelNotes({
            exists: (p) => vault.getAbstractFileByPath(p) != null,
            isFile: (p) => vault.getAbstractFileByPath(p) instanceof TFile,
            read: async (p) => {
                const f = vault.getAbstractFileByPath(p);
                if (!(f instanceof TFile)) throw new Error('ENOENT: ' + p);
                return vault.read(f);
            },
            write: async (p, content) => {
                const f = vault.getAbstractFileByPath(p);
                if (f instanceof TFile) await vault.modify(f, content);
            },
            createFolder: async (p) => {
                await vault.createFolder(p);
            },
            move: async (from, to) => {
                const f = vault.getAbstractFileByPath(from);
                if (f instanceof TFile) await vault.rename(f, to);
            },
        }, { notesDir: `${libDir}/${DIR_NOTES}`, catalogPath: `${libDir}/catalog.json` });
    }

    /** 数据文件变更（防抖 500ms）：仅响应本库 catalog.json 与 笔记/ 目录，其余文件不触发 */
    private onVaultDataChange(path: string): void {
        const dir = this.libDir;
        const p = normalizePath(path);
        const catalogPath = `${dir}/catalog.json`;
        const entriesDir = `${dir}/${DIR_NOTES}`;
        if (p !== catalogPath && !p.startsWith(entriesDir + '/')) return;
        if (this.refreshTimer !== null) return; // 已有待执行刷新，合并触发
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            void this.refreshViews();
        }, 500);
    }

    async saveSettings(): Promise<void> {
        const old = { ...this.settings };
        await this.saveData(this.settings);
        this.rebuildClients();
        this.rebuildService();
        // E 缓存失效：凭据变更（豆瓣 Cookie / TMDB Key / Bangumi Token / OMDB Key / IGDB 双凭据）或源链配置变更 → 清空搜索与更新检测缓存，
        // 防止旧凭据/旧链结果继续命中（searchCache 30min TTL / updateCheckCache 10min TTL）
        const chainChanged = this.sourceChainBaselineJson !== JSON.stringify(this.settings.sourceChains ?? {});
        if (
            old.doubanCookie !== this.settings.doubanCookie ||
            old.tmdbApiKey !== this.settings.tmdbApiKey ||
            old.bangumiToken !== this.settings.bangumiToken ||
            old.omdbApiKey !== this.settings.omdbApiKey ||
            old.igdbClientId !== this.settings.igdbClientId ||
            old.igdbClientSecret !== this.settings.igdbClientSecret ||
            chainChanged
        ) {
            this.searchCache.clear();
            this.updateCheckCache.clear();
        }
        this.sourceChainBaselineJson = JSON.stringify(this.settings.sourceChains ?? {});
        await this.refreshViews();
    }

    /** 按设置的数据目录重建服务（libraryDir 变更立即生效；空值回退 ReelLudic） */
    rebuildService(): void {
        const dir = this.libDir;
        // 笔记表格开关随服务重建一并注入（saveSettings 会调本方法 → 改开关即时生效）
        this.service = new EntryService(
            createVaultIO(this.app),
            `${dir}/catalog.json`,
            `${dir}/${DIR_NOTES}`,
            this.settings.noteTable !== false,
        );
    }

    /** 重建元数据客户端（TMDB / Bangumi / Douban，凭据变更立即生效） */
    rebuildClients(): void {
        // GET 类请求网络层重试 1 次（幂等；参考 obsidian-douban：GET 重试、POST 不重试）
        this.tmdb = new TmdbClient(
            this.settings.tmdbApiKey,
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('TMDB API Key 无效（HTTP 401）');
                if (res.status === 429) throw new Error('TMDB 请求过于频繁（HTTP 429）');
                throw new Error(`TMDB 请求失败（HTTP ${res.status}）`);
            },
        );
        this.bangumi = new BangumiClient(
            this.settings.bangumiToken,
            async (url, headers) => {
                const res = await requestUrl({ url, headers });
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('Bangumi Access Token 无效（HTTP 401）');
                throw new Error(`Bangumi 请求失败（HTTP ${res.status}）`);
            },
            async (url, body, headers) => {
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/json' });
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('Bangumi Access Token 无效（HTTP 401）');
                if (res.status === 429) throw new Error('Bangumi 请求过于频繁（HTTP 429），请稍后重试');
                throw new Error(`Bangumi 请求失败（HTTP ${res.status}）`);
            },
        );
        this.douban = new DoubanClient(
            async (url, headers) => {
                // 桌面端走 Node 原生 https（网络栈指纹更不易被豆瓣识别为爬虫，参考 obsidian-douban），
                // nodeHttpGet 内置 GET 重试 2 次；移动端回退 requestUrl
                if (Platform.isDesktopApp) {
                    const res = await nodeHttpGet(url, headers);
                    if (res.status === 200) return res.text;
                    throw new Error(`Douban 请求失败（HTTP ${res.status}）`);
                }
                const res = await retry(() => requestUrl({ url, headers }));
                if (res.status === 200) return res.text;
                throw new Error(`Douban 请求失败（HTTP ${res.status}）`);
            },
            async (url, body, headers) => {
                if (Platform.isDesktopApp) {
                    const res = await nodeHttpPost(url, body, headers);
                    if (res.status === 200) return res.text;
                    throw new Error(`Douban 安全验证请求失败（HTTP ${res.status}）`);
                }
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/x-www-form-urlencoded' });
                if (res.status === 200) return res.text;
                throw new Error(`Douban 安全验证请求失败（HTTP ${res.status}）`);
            },
            this.settings.doubanCookie,
        );
        // Open Library（免 Key 公开 API）：书籍第二源，搜索/点选补全共用注入 requestUrl（GET 幂等重试 1 次）
        this.openLibrary = new OpenLibraryClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`Open Library 请求失败（HTTP ${res.status}）`);
            },
        );
        // Google Books（Key 可选）：书籍补充源，搜索级即含简介/页数/分类/ISBN/封面；点选直接回填无需详情接口
        // key 每次请求经 getter 现读 settings.googleBooksApiKey（T5 动态 key）：未配即不带 key 请求（免费额度，429 由 runAuxSource 静默降级）
        this.googleBooks = new GoogleBooksClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                // 429（免费额度限流/未配 key）与其它失败同路：runAuxSource catch → failed 状态，不弹 Notice
                throw new Error(`Google Books 请求失败（HTTP ${res.status}）`);
            },
            () => this.settings.googleBooksApiKey || undefined,
        );
        // MangaDex（免 Key 公开端点，2026-09-30 接入）：漫画源链第三源。
        // 🔴 必须带可标识 User-Agent（`MANGADEX_UA`，官方 Acceptable Usage Policy）⇒ 这里把 headers 透传给 requestUrl。
        // ⚠️ 429 = 触发全局限流（约 5 req/s）→ 与其它 aux 同路：runAuxSource catch → failed，不弹 Notice、不阻断整组。
        this.mangadex = new MangaDexClient(
            async (url, headers) => {
                const res = await retry(() => requestUrl({ url, headers }));
                if (res.status === 200) return res.text;
                throw new Error(`MangaDex 请求失败（HTTP ${res.status}）`);
            },
        );
        // Steam（免 Key 公开端点）：storesearch 免 Key 检索（#165 T6 校准：suggest 端点实测返回热门 HTML 非检索 JSON，
        // 故用 https://store.steampowered.com/api/storesearch/?term=&cc=US&l=english）；游戏第二源，搜索级字段直接可回填
        this.steam = new SteamClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`Steam 请求失败（HTTP ${res.status}）`);
            },
        );
        // MusicBrainz（免 Key 公开 API）：release-group 检索（#165 T7 校准：直接 query 形态实测 200；限流 ~1rps 且
        // 政策要求请求标识 User-Agent，故注入 http 带 UA header）；音乐第二源，搜索级字段直接可回填，
        // 封面 = coverartarchive 纯 URL 拼接（404 由 UI 占位，不在搜索时请求探测）
        this.musicbrainz = new MusicBrainzClient(
            async (url, headers) => {
                const res = await requestUrl({ url, headers });
                if (res.status === 200) return res.text;
                throw new Error(`MusicBrainz 请求失败（HTTP ${res.status}）`);
            },
        );
        // iTunes（免 Key 公开 API）：search 端点 entity=album 专辑检索（#165 T8 校准：免 UA/免 Key，
        // 结果自带 artworkUrl100 尺寸后缀放大 600x600bb + collectionViewUrl 官方页链接）；音乐第三源，
        // 搜索级字段直接可回填，与 musicbrainz 同名专辑跨源并存（mergeBySource 按 source 保留）
        this.itunes = new ItunesClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`iTunes 请求失败（HTTP ${res.status}）`);
            },
        );
        // OMDb（需 Key，1000 次/日）：IMDb 数据，英文为主；默认链不含（movieTv=douban→tmdb），用户自选加入。
        // key 为空时 client 不发起（search/detail 首行守卫）；runner 侧 providerConfigured 未配即 unconfigured 不启动
        this.omdb = new OmdbClient(
            this.settings.omdbApiKey ?? '',
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('OMDb API Key 无效（HTTP 401）');
                if (res.status === 429) throw new Error('OMDb 请求次数已达上限（HTTP 429）');
                throw new Error(`OMDb 请求失败（HTTP ${res.status}）`);
            },
        );
        // AniList（免 Key GraphQL）：anime 第三源；默认链不含（anime=douban→bangumi）→ 仅用户自选加入后参与。
        // 搜索级 GraphQL 已含 genres/studio/desc/rating + title/year/cover → 点选直接回填、无 detail 往返
        //（决策见 tests/anilist.test.ts）；请求走 requestUrl POST（GraphQL JSON）
        this.anilist = new AnilistClient(async (url, body, headers) => {
            const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/json' });
            if (res.status === 200) return res.text;
            if (res.status === 429) throw new Error('AniList 请求过于频繁（HTTP 429）');
            throw new Error(`AniList 请求失败（HTTP ${res.status}）`);
        });
        // IGDB（需 Twitch 双凭据 Client ID+Secret，OAuth app token）：game 补充源；默认链不含（game=douban→steam），
        // 仅用户自选加入且双凭据配置后参与（重新接入：历史 IGDB→RAWG→删除，现按用户要求回归并复用遗留字段）
        this.igdb = new IgdbClient(
            this.settings.igdbClientId ?? '',
            this.settings.igdbClientSecret ?? '',
            // token 换取（GET，带重试；网络失败由 runAuxSource catch → failed 静默）
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                if (res.status === 400) throw new Error('IGDB 鉴权参数无效（HTTP 400，请检查 Client ID/Secret）');
                throw new Error(`IGDB 鉴权请求失败（HTTP ${res.status}）`);
            },
            // games 查询（POST，contentType 默认 text/plain 符合 Apicalypse；IGDB 对错 token 回 401/403）
            async (url, body, headers) => {
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'text/plain' });
                if (res.status === 200) return res.text;
                if (res.status === 401 || res.status === 403) throw new Error('IGDB 访问被拒（HTTP 401/403，请检查凭据与 Client-ID 头）');
                throw new Error(`IGDB 请求失败（HTTP ${res.status}）`);
            },
        );

        // T3：辅助源 runner 注册（新源接入在此追加一行；未注册的链内源由 runAuxSource 静默跳过）
        this.auxRunners = {
            tmdb: (query, type) => this.tmdb.search(query, type as 'movie' | 'tv'),
            // bangumi 服务 **动画 + 漫画** 两组（2026-09-30 漫画加回）：按调用方给的 type 分流 ——
            // 'book'（漫画走 searchBookFresh，传的恒是 'book'）→ 书籍类目 type=1；其余（anime 组）→ 动画搜索。
            // ⚠️ 这与 1.0.3.1 删掉的那条分流**不同形**（旧的写法是「冒号紧接 bangumi 的 searchBooks 调用」），
            //    ⛔ 本条注释里**不许**照抄那个形态 —— 注释会进产物，抄了就会撞上断言里那条反向守卫（本轮真踩过）。
            bangumi: (query, type) => (type === 'book' ? this.bangumi.searchBooks(query) : this.bangumi.search(query)),
            // mangadex 只服务 comic 组（免 Key；带上官方要求的 User-Agent 由客户端负责）
            mangadex: (query) => this.mangadex.search(query),
            openLibrary: (query) => this.openLibrary.search(query),
            // googleBooks 默认链不含 → 仅用户自选后参与（book 组）；key 未配时 providerConfigured 对可选 Key 源放行
            googleBooks: (query) => this.googleBooks.search(query),
            // steam 默认链含（game=douban→steam）→ 免 Key 恒参与（T6 接入；runner 注册后 searchGameFresh 不再静默跳过）
            steam: (query) => this.steam.search(query),
            // musicbrainz 默认链含（music=douban→musicbrainz→itunes）→ 免 Key 恒参与（T7 接入）；
            // itunes 默认链含 → 免 Key 恒参与（T8 接入）→ 至此 music 组默认链 3 源 runner 全注册
            musicbrainz: (query) => this.musicbrainz.search(query),
            itunes: (query) => this.itunes.search(query),
            // omdb 默认链不含（movieTv=douban→tmdb）→ 仅用户自选加入且配置 key 后参与；
            // mediaType movie/tv → type=movie/series（runner 收到 EntryType 'movie'|'tv'）
            omdb: (query, type) => this.omdb.search(query, type as 'movie' | 'tv'),
            // anilist 默认链不含（anime=douban→bangumi）→ 仅用户自选加入后参与（anime 组第三源；免 Key）
            anilist: (query) => this.anilist.search(query),
            // igdb 默认链不含（game=douban→steam）→ 仅用户自选加入且双凭据配置后参与（game 组第三源）
            igdb: (query) => this.igdb.search(query),
        };
    }

    async searchTmdb(query: string, mediaType: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
        if (!this.settings.tmdbApiKey) {
            throw new Error('未配置 TMDB API Key，请先在 设置 → ReelLudic 中填写');
        }
        return this.tmdb.search(query, mediaType);
    }

    /**
     * 豆瓣兜底（全类型通用，始终启用）：搜索 + 前 3 条自动补详情（JSON-LD），
     * 再经 mapper 转成与主数据源一致的结果类型。
     * 返回 { items, reachable, cookieInvalid }：reachable=false 表示 Douban 接口被反爬拦截/不可用（区别于"无结果"）；
     * cookieInvalid=true 表示 Cookie 失效/风控（登录跳转/禁止访问/验证失败/接口异常），供上层明确提醒。
     * prog：进度上报（豆瓣搜索 1 步 + 详情 N 步，详情步数搜索后 addRemaining 动态补齐）。
     */
    private async doubanFallback<T>(
        query: string,
        type: EntryType,
        mapper: (s: DoubanSubject) => T,
        prog?: SearchProgressReporter,
    ): Promise<DoubanRun<T>> {
        try {
            prog?.next(`${sourceEnLabel('douban')} 搜索`); // 「Douban 搜索」——主源阶段标签取源英文名
            const results = await this.douban.search(query, type);
            if (results.length === 0) {
                prog?.source({ id: 'douban', state: 'empty', count: 0 });
                return { kind: 'douban', items: [], reachable: true, cookieInvalid: false };
            }
            // 搜索阶段不再强制预补详情（每次搜索都打 3 个详情页过反爬，等待长）——
            // 列表秒出，用户点选某条时由 fetchDoubanDetailForEntry 按需补全详情字段
            prog?.source({ id: 'douban', state: 'ok', count: results.length });
            return { kind: 'douban', items: results.map(mapper), reachable: true, cookieInvalid: false };
        } catch (e) {
            // 保留 Cookie 失效标记（登录跳转/禁止访问/验证失败/接口异常）——供上层明确提醒「Cookie 已失效」
            prog?.source({ id: 'douban', state: 'blocked' });
            return { kind: 'douban', items: [], reachable: false, cookieInvalid: e instanceof DoubanCookieError };
        }
    }

    /** 解析某组当前生效源链（settings.sourceChains → 归一 → 缺省默认链） */
    private sourceChain(group: SourceGroup): ProviderId[] {
        return resolveSourceChain(this.settings.sourceChains, group);
    }

    /** 凭据已配置判定（T3 动态 key，删 main 内写死的 tmdbApiKey/bangumiToken 布尔判断）：
     *  PROVIDER_META[id].keyField ? !!settings[keyField] : true（免 Key 源恒 true）；
     *  双凭据源（keyField2 非空，如 igdb Client ID+Secret）→ 两字段同时有值才算已配置；
     *  可选 Key 源（googleBooks，OPTIONAL_KEY_AUX）未配 key 仍视为已配置 → 不带 key 照常运行（T5，429 静默降级）。 */
    private providerConfigured(id: ProviderId): boolean {
        const meta = PROVIDER_META[id];
        const kf = meta.keyField;
        if (!kf) return true; // 免 Key 源恒 true
        // 可选 Key 源（仅 aux 会走到此判定；googleBooks key 只用于提配额）
        if (OPTIONAL_KEY_AUX.has(id as AuxProviderId)) return true;
        const s = this.settings as unknown as Record<string, unknown>;
        const hasFirst = !!s[kf];
        if (!meta.keyField2) return hasFirst;
        return hasFirst && !!s[meta.keyField2];
    }

    /** 公开版凭据判定（EntryModal 构造搜索源计划用）：同 providerConfigured 语义 */
    sourceConfigured(id: ProviderId): boolean {
        return this.providerConfigured(id);
    }

    /** 某条目类型本次搜索「实际会发起」的源集合（链序）：链内 aux 需已配置（免 Key 源恒 true），douban 恒参与。
     *  供搜索结果区固定占栏——栏数与源成败无关，只取决于源链配置。
     *  1.0.3.1：漫画源组已下线（用户 2026-09-13 裁定），书籍类目回归单链，故不再需要按子分类分流。 */
    /** 某类型本次**实际会发起的源**（表单头部「数据源」文案 + 搜索结果固定栏位）。
     *  🔴 2026-09-30：加可选 `kind` —— 漫画独立成组后**必须**按子分类问组，
     *     否则漫画态会告诉用户「数据源：Douban / Open Library」（2 栏），而实际只搜豆瓣（1 源）⇒ 栏位数也跟着错。
     *  ⚠️ 非书籍类型忽略 kind（只有 book 有子分类）。 */
    sourcesForType(type: EntryType, kind?: BookKind): ProviderId[] {
        const group: SourceGroup = type === 'book' ? sourceGroupForBookKind(kind) : sourceGroupForType(type);
        const chain = resolveSourceChain(this.settings.sourceChains, group);
        return chain.filter((id) => id === 'douban' || this.providerConfigured(id));
    }

    /**
     * 辅助源统一执行（T3）：runner 未注册 → 静默跳过（absent，中间态不回归）；
     * 需凭据源未配置 → 不启动（unconfigured）；否则 withTimeout(AUX_SEARCH_TIMEOUT) 运行，
     * 成功/失败各推进一步进度 + 上报 source 事件（UI 逐源真实进度：快源先亮、未完成源「搜索中…」），
     * 失败仅置 failed 状态，不弹 Notice（sanction：#165 T3 对齐 spec S3「失败源静默降级」）。
     */
    private async runAuxSource<T>(id: AuxProviderId, query: string, type: EntryType, prog: SearchProgressReporter): Promise<AuxRun<T>> {
        const runner = this.auxRunners[id];
        // 链含但 runner 未注册（T4-T10 分批接入中）：等同链外源跳过，不判定凭据/不请求
        if (!runner) return { kind: 'aux', id, items: [], state: 'absent' };
        const stage = `${sourceEnLabel(id)} 搜索`; // 进度/超时标签取源英文名（与头部「数据源：」文案一致）
        // 凭据判定统一走 keyField 动态读（runAuxSource 内不再出现写死的 settings.tmdbApiKey/bangumiToken）
        if (!this.providerConfigured(id)) return { kind: 'aux', id, items: [], state: 'unconfigured' };
        try {
            // 辅助源超时压缩：无代理/慢网络时 5s 内没返回就放弃（豆瓣源先返回即整体完成），不拖慢主链路
            const items = (await withTimeout(runner(query, type, prog), AUX_SEARCH_TIMEOUT, stage)) as T[];
            prog.next(stage);
            prog.source({ id, state: items.length > 0 ? 'ok' : 'empty', count: items.length });
            return { kind: 'aux', id, items, state: 'empty' };
        } catch (e) {
            // 失败静默降级：只推进该阶段进度步 + 置 failed（全链无果时 deriveGroupSearchError 统一文案），不弹 Notice
            const timeout = e instanceof Error && /超时/.test(e.message);
            prog.next(stage);
            prog.source({ id, state: timeout ? 'timeout' : 'failed' });
            return { kind: 'aux', id, items: [], state: 'failed' };
        }
    }

    /**
     * 组内源 runner 集合执行（五个 searchXFresh 收敛后的公共编排核心）：
     * 豆瓣主源（既有 doubanFallback，不限时 + reachable/cookieInvalid 归集）与链内各辅助源并行。
     * aux 三态按 T3 表达式归集：链外/未注册 → absent；缺凭据 → unconfigured；运行失败 → failed；成功（含无匹配）→ empty。
     */
    private async collectGroupSources<T>(
        group: SourceGroup,
        type: EntryType,
        query: string,
        mapper: (s: DoubanSubject) => T,
        prog: SearchProgressReporter,
    ): Promise<GroupSearchRun<T>> {
        const chain = this.sourceChain(group);
        const hasDouban = chain.includes('douban');
        const auxIds = chain.filter((id): id is AuxProviderId => id !== 'douban');
        const [doubanRun, ...auxRuns] = await Promise.all<DoubanRun<T> | AuxRun<T>>([
            hasDouban
                ? this.doubanFallback(query, type, mapper, prog)
                : Promise.resolve({ kind: 'douban', items: [] as T[], reachable: true, cookieInvalid: false }),
            ...auxIds.map((id) => this.runAuxSource<T>(id, query, type, prog)),
        ]);
        const aux: Partial<Record<AuxProviderId, AuxState>> = {};
        const auxItems: Partial<Record<AuxProviderId, T[]>> = {};
        for (const r of auxRuns) {
            if (r.kind !== 'aux') continue; // TS 收窄用（Promise.all 异质数组）
            aux[r.id] = r.state;
            auxItems[r.id] = r.items;
        }
        return { chain, aux, auxItems, douban: hasDouban ? doubanRun as DoubanRun<T> : undefined };
    }

    /** 组内结果合并（保持既有语义不变）：aux 源结果按链序在前，douban 结果在后，去重后再按相似度排序 */
    private mergeGroupResults<T extends { title: string; source?: string }>(run: GroupSearchRun<T>, query: string): T[] {
        const auxFirst: T[] = [];
        for (const id of run.chain) {
            if (id === 'douban') continue;
            const items = run.auxItems[id as AuxProviderId];
            if (items) auxFirst.push(...items);
        }
        const db = run.douban ?? { items: [] as T[] };
        return sortByRelevance(mergeBySource(auxFirst, db.items), query);
    }

    /** 豆瓣详情按需补全（表单选中搜索结果时调用）：搜索级结果缺详情字段（仅前 3 条搜索时已补），
     *  点击任意条后动态拉取 JSON-LD + #info，返回表单可直接使用的字段对象；失败返回 null 静默。 */
    async fetchDoubanDetailForEntry(id: string, type: EntryType): Promise<Record<string, unknown> | null> {
        try {
            const subject = await this.douban.fetchDetail({ id, title: '', cast: [], genres: [] }, type);
            return toEntryDetailFields(subject);
        } catch {
            return null;
        }
    }

    /** Bangumi 详情补全统一实现（subjects+persons API 并行）：评分/评价人数/制作公司/导演/主演；失败返回空对象（调用方决定兜底），进度标签（若有）成功失败都推进 */
    private async fetchBangumiDetail(
        id: number,
        prog?: SearchProgressReporter,
        label?: string,
    ): Promise<{ rating?: number; ratingCount?: number; studio?: string; director?: string; cast?: string[] }> {
        try {
            const [sub, persons] = await Promise.all([
                this.bangumi.fetchSubject(id),
                this.bangumi.fetchPersons(id),
            ]);
            return {
                rating: sub.rating,
                ratingCount: sub.ratingCount,
                studio: sub.studio,
                director: persons.director,
                cast: persons.cast,
            };
        } catch {
            return {};
        } finally {
            if (prog && label) prog.next(label);
        }
    }

    /** Bangumi 详情按需补全（选中搜索结果时调用）：合并 subjects+persons API 字段（评分/评价人数/导演/主演） */
    async fetchBangumiDetailForEntry(id: number): Promise<{ rating?: number; ratingCount?: number; director?: string; cast?: string[] }> {
        if (!this.settings.bangumiToken) return {};
        return this.fetchBangumiDetail(id);
    }

    /** Open Library 详情按需补全（选中搜索书籍时调用）：works.json 补简介/页数/出版社（搜索级 fields 不含）；
     *  字段投影为表单可填键（summary/pageCount/publisher，对齐 applyDoubanDetail 读取）；失败返回 null 静默。 */
    async fetchOpenLibraryDetailForEntry(key: string): Promise<Record<string, unknown> | null> {
        try {
            const d = await this.openLibrary.fetchWorkDetail(key);
            const out: Record<string, unknown> = {};
            if (d.description) out.summary = d.description;
            if (d.numberOfPages != null) out.pageCount = d.numberOfPages;
            if (d.publishers?.length) out.publisher = d.publishers[0];
            return Object.keys(out).length > 0 ? out : null;
        } catch {
            return null;
        }
    }

    /** OMDb 详情按需补全（选中 IMDb 搜索结果时调用）：?i={imdbID}&plot=full 补 Plot/导演/演员/类型/评分；
     *  投影键名对齐 EntryForm.applyDoubanDetail（director/cast/genres/summary/cover/ratingCount + rating 供评分回填）；
     *  失败（未配 key / 网络 / 错误体）返回 null 静默，不阻塞保存。 */
    async fetchOmdbDetailForEntry(imdbID: string): Promise<OmdbDetailFields | null> {
        if (!this.settings.omdbApiKey || !imdbID) return null;
        try {
            return await this.omdb.detail(imdbID);
        } catch {
            return null;
        }
    }

    /** 影视搜索（TMDB/OMDb + 豆瓣并行，组内链源可自选）：按相似度排序合并（结果缓存 30min）。
     *  返回影视结果联合（TmdbSearchResult | OmdbSearchResult）：omdb id 为字符串，与 tmdb number 不可强塞（决策见 tests/omdb.test.ts） */
    async searchWithFallback(query: string, mediaType: 'movie' | 'tv', onProgress?: SearchProgressCb): Promise<MovieTvSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`${mediaType}:${q.toLowerCase()}`, () => this.searchMovieTvFresh(q, mediaType, onProgress));
    }

    private async searchMovieTvFresh(query: string, mediaType: 'movie' | 'tv', onProgress?: SearchProgressCb): Promise<MovieTvSearchResult[]> {
        // T3：组内 runner 集合执行——douban 主源（不限时）与组内 aux（tmdb，5s 超时）并行；链含未注册/无 runner 源静默跳过
        const run = await this.collectGroupSources<MovieTvSearchResult>('movieTv', mediaType, query, toTmdbResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        // 全链无结果且 douban 参与不可达（Cookie 失效/反爬）：明确提示；辅助源失败已静默（不打扰）
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'movieTv',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 书籍搜索（结果缓存 30min）：统一走 book 组（豆瓣主源 + Open Library / Google Books）；缓存 key 按子分类隔离防串（文学/网文命中同一源链，仅结果缓存分桶） */
    async searchBook(query: string, kind?: BookKind, onProgress?: SearchProgressCb): Promise<BookSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`book:${kind ?? ''}:${q.toLowerCase()}`, () => this.searchBookFresh(q, kind, onProgress));
    }

    private async searchBookFresh(query: string, kind?: BookKind, onProgress?: SearchProgressCb): Promise<BookSearchResult[]> {
        // T3/T4：组内 runner 集合执行——book 组：douban 主源（不限时）+ aux openLibrary（5s 超时）。
        // 🔴 2026-09-30 用户裁定：漫画**独立成组** ⇒ 组按子分类选 —— comic → comic 组（默认链 = 豆瓣单源），
        //    文学 / 网文 / 未指定 → book 组。判组走纯函数 `sourceGroupForBookKind`（可单测），
        //    ⛔ 别在这里内联 `kind === 'comic' ? 'comic' : 'book'` —— 那条三元是 1.0.3.1 删漫画时的历史形态，
        //      断言里按「已删」锚着；加回改用纯函数后断言也换成了锚 if 形态。
        // ⚠️ 两个组给豆瓣 runner 的 type 都是 `'book'`：豆瓣没有「漫画」这个 cat，漫画走图书检索（cat=1001）。
        const group = sourceGroupForBookKind(kind);
        const run = await this.collectGroupSources<BookSearchResult>(group, 'book', query, toBookResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group,
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 游戏搜索（Douban 单源；Douban 不可用时给出准确提示，结果缓存 30min） */
    async searchGame(query: string, onProgress?: SearchProgressCb): Promise<GameSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`game:${q.toLowerCase()}`, () => this.searchGameFresh(q, onProgress));
    }

    private async searchGameFresh(query: string, onProgress?: SearchProgressCb): Promise<GameSearchResult[]> {
        // T3/T6：game 组 runner 集合执行——douban 主源（不限时）与 aux steam（5s 超时）并行
        const run = await this.collectGroupSources<GameSearchResult>('game', 'game', query, toGameResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'game',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /**
     * 音乐搜索（Douban 单源 + **在线曲库**；结果缓存 30min）。
     *
     * 🔴 #464：音乐这一路要多带一份**在线曲库**结果（`SONG_LIB_ID` 那一栏）—— 起因是用户
     *    「豆瓣源搜作者，为什么不出现对应的音乐」：豆瓣音乐搜索**只按专辑名匹配**，搜歌手名基本搜不到
     *    他的歌；而「下载歌曲」窗口那条四平台链搜的就是「歌名 + 歌手」，搜 `BEYOND` 直接出
     *    《海阔天空》《光辉岁月》…。曲库**不是数据源**（不进注册表/不进源链），由表单按「音乐态 + 可下载」
     *    挂栏，这里只负责把结果并进来（栏位口径见 `EntryForm` 的 `songLibOn`）。
     */
    async searchMusic(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`music:${q.toLowerCase()}`, () => this.searchMusicFresh(q, onProgress));
    }

    private async searchMusicFresh(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        // T8：music 默认链 douban→musicbrainz→itunes 三源 runner 全注册；musicbrainz 参与后 iTunes 并行补齐中文曲库
        const prog = createSearchProgress(onProgress);
        // 曲库检索与元数据搜索**并行**（曲库不阻塞豆瓣；它自己也受 5s 上限，慢也不拖住整体）
        const [run, lib] = await Promise.all([
            this.collectGroupSources<MusicSearchResult>('music', 'music', query, toMusicResult, prog),
            this.songLibrarySearch(query, prog),
        ]);
        const merged = this.mergeGroupResults(run, query).concat(lib);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'music',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /**
     * 在线曲库检索（#464）：与「下载歌曲」窗口**同一个函数**（`dlSearchSongs` ⇒ 同一平台顺序、同一份结果），
     * ⛔ 别在这里另拼一份四平台请求。
     *
     * 门控与表单那枚「下载歌曲」按钮同源（`canUseAudioDownload`）—— 移动端没有 Node http，放进来必然失败。
     * 失败/超时静默降级（只上报该栏状态，不打扰）：曲库拿不到不该让整次音乐搜索报错，
     * 豆瓣那栏该出的照出（与 aux 源同口径）。
     */
    private async songLibrarySearch(query: string, prog: SearchProgressReporter): Promise<MusicSearchResult[]> {
        if (!this.canUseAudioDownload()) return [];
        try {
            const { songs } = await withTimeout(this.dlSearchSongs(query), AUX_SEARCH_TIMEOUT, `${SONG_LIB_LABEL} 搜索`);
            const items = songLibraryResults(songs);
            prog.source({ id: SONG_LIB_ID, state: items.length > 0 ? 'ok' : 'empty', count: items.length });
            return items;
        } catch {
            prog.source({ id: SONG_LIB_ID, state: 'failed' });
            return [];
        }
    }

    /**
     * 音乐「下载 / 曲库检索」门控：**桌面端 + 「启用内置音乐播放器」开启**。
     * 🔴 单一真源 —— 表单的 `canDownload`（下载按钮 + 在线曲库栏）与宿主侧的曲库检索都从这里取，
     *    ⛔ 别在两处各写一遍 `Platform.isDesktopApp && settings.audioInlinePlayer`（那正是「按钮亮着但搜不到」
     *    这类不一致的来源）。
     */
    canUseAudioDownload(): boolean {
        return Platform.isDesktopApp && this.settings.audioInlinePlayer === true;
    }

    /** 动画搜索（Bangumi + 豆瓣并行）：按相似度排序合并；无 Token 且 Douban 不可用时给出准确提示（结果缓存 30min） */
    async searchAnime(query: string, onProgress?: SearchProgressCb): Promise<BangumiSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`anime:${q.toLowerCase()}`, () => this.searchAnimeFresh(q, onProgress));
    }

    private async searchAnimeFresh(query: string, onProgress?: SearchProgressCb): Promise<BangumiSearchResult[]> {
        // T3：组内 runner 集合执行——douban 主源（不限时）与组内 aux（bangumi，5s 超时）并行；anime 组补全逻辑随链源接入保留
        const prog = createSearchProgress(onProgress);
        const run = await this.collectGroupSources<BangumiSearchResult>('anime', 'anime', query, toBangumiResult, prog);
        // Bangumi 搜索结果缺评分/导演/主演（搜索 API 不含）→ 前 3 条并行调详情补全（链含 bangumi、已配 Token 且搜索有结果时）
        const primary = run.auxItems.bangumi ?? [];
        const head = primary.slice(0, 3);
        const tail = primary.slice(3);
        let enriched = primary;
        if (head.length > 0) {
            const n = head.length;
            prog.addRemaining(n);
            const filled = await Promise.all(
                head.map(async (r, i) => {
                    const d = await this.fetchBangumiDetail(r.id, prog, `Bangumi 详情补全 ${i + 1}/${n}`);
                    return {
                        ...r,
                        ...(d.rating != null ? { rating: d.rating } : {}),
                        ...(d.ratingCount != null ? { ratingCount: d.ratingCount } : {}),
                        ...(d.studio ? { studio: d.studio } : {}),
                        ...(d.director ? { director: d.director } : {}),
                        ...(d.cast?.length ? { cast: d.cast } : {}),
                    };
                }),
            );
            enriched = [...filled, ...tail];
        }
        run.auxItems.bangumi = enriched;
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'anime',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 追番表「从 Bangumi 导入」：拉取用户收藏列表 → 建条目（title+type 去重跳过已存在；源=Bangumi 便于后续搜索回填） */
    async importBangumiCollections(
        userId: number | string | undefined,
        types: { want: boolean; watching: boolean; watched: boolean },
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number }> {
        const need = [types.want && 0, types.watching && 2, types.watched && 1].filter((v): v is 0 | 1 | 2 => typeof v === 'number');
        if (need.length === 0) return { added: 0, skipped: 0 };
        // 未填用户 ID：尝试从 Token 自动获取（/v0/me）
        let uid: number | string | undefined = userId;
        if (uid === undefined || uid === '') {
            try {
                const me = await this.bangumi.fetchMe();
                if (me.id) uid = me.id;
            } catch { /* 静默 */ }
        }
        if (!uid) throw new Error('未提供 Bangumi 用户 ID（自动获取失败）——可在追番表导入弹窗填写，或确认已配置 Bangumi Token');
        const existing = await this.service.list();
        const exists = (t: string, type: string) => existing.some((x) => x.title === t && x.type === type);
        let added = 0;
        let skipped = 0;
        for (const t of need) {
            let items: Awaited<ReturnType<BangumiClient['fetchUserCollections']>>;
            try {
                items = await this.bangumi.fetchUserCollections(uid, t);
            } catch {
                throw new Error('拉取 Bangumi 收藏失败——请确认 Token 有效且网络可用（需代理访问 bgm.tv）');
            }
            onProgress?.(0, items.length, `拉取收藏列表（${t === 0 ? '想看' : t === 2 ? '在看' : '已看'}）`);
            let done = 0;
            for (const r of items) {
                done++;
                onProgress?.(done, items.length, `导入 ${r.title}`);
                // subject.type 决定条目类型：2=动画（含剧场版动画电影）、6=电影；其余类型已在解析时跳过
                const entryType: 'anime' | 'movie' = r.entryType ?? 'anime';
                if (exists(r.title, entryType)) {
                    skipped++;
                    continue;
                }
                // 直接拉取详情入库：评分/评价人数/制作公司（subject API）+ 导演/主演（persons API）
                // 失败静默（保留收藏级字段），不阻塞导入流程
                let detail: { rating?: number; ratingCount?: number; studio?: string } = {};
                let persons: { director?: string; cast?: string[]; studio?: string } = {};
                try {
                    detail = await this.bangumi.fetchSubject(r.id);
                } catch { /* 静默 */ }
                try {
                    persons = await this.bangumi.fetchPersons(r.id);
                } catch { /* 静默 */ }
                await this.service.create({
                    type: entryType,
                    title: r.title,
                    originalTitle: r.originalTitle || undefined,
                    year: r.year,
                    airDate: r.airDate,
                    status: t === 0 ? 'want' : t === 2 ? 'watching' : 'watched',
                    rating: 0,
                    genres: [],
                    cast: persons.cast ?? [],
                    director: persons.director,
                    developer: persons.studio ?? detail.studio, // 制作公司（动画复用 developer 字段，与 Bangumi 源搜索回填一致）
                    summary: r.summary,
                    communityScore: detail.rating ?? r.rating,
                    ratingCount: detail.ratingCount ?? r.ratingCount,
                    poster: r.cover,
                    source: 'bangumi',
                    sourceUrl: `https://bgm.tv/subject/${r.id}`,
                    links: [],
                    notes: '',
                    tags: [],
                });
                added++;
            }
        }
        await this.refreshViews();
        return { added, skipped };
    }

    /** 网站更新检测缓存（10min TTL：追更表每次打开都检测会频繁抓站，命中直接复用） */
    private readonly updateCheckCache = createSearchCache<unknown>({ ttlMs: 10 * 60 * 1000, maxSize: 100 });

    /** 剧集/动画更新检测（参考 Bangumi-Bridge 追番脚本）：抓观看网址 HTML → 提最大集数 → 对比已看集数
     *  返回 null 表示无观看网址；失败/无集数信息/站点拦截返回带 error/status 的结果；结果按 url 缓存 10min
     *  force=true 跳过缓存（「重新检测」按钮用）；超时保护：requestUrl 无公开超时参数，用 withTimeout 兜底防挂起 */
    async checkUpdateFor(url: string, watchedEpisodes: number, force: boolean = false): Promise<UpdateCheckResult | null> {
        const u = url.trim();
        if (!u) return null;
        const key = `check:${u}:${watchedEpisodes}`;
        if (!force) {
            const hit = this.updateCheckCache.get(key);
            if (hit) return hit[0] as UpdateCheckResult;
        }
        const result = await checkAnimeUpdate(
            async (target) => {
                const res = await withTimeout(
                    requestUrl({ url: target, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }),
                    10000,
                    '更新检测请求',
                );
                if (res.status === 200) return res.text;
                // 非 200：若 body 是人机验证/反爬拦截页（cdndefend 常返回 403 + 挑战页特征），
                // 返回文本让 checkAnimeUpdate 判为 blocked（而不是笼统 failed），用户才能看到「🔒 站点拦截」
                if (isBlockedPage(res.text)) return res.text;
                throw new Error(`HTTP ${res.status}`);
            },
            u,
            watchedEpisodes,
        );
        this.updateCheckCache.set(key, [result]);
        return result;
    }

    async fetchTmdbDetail(r: TmdbSearchResult): Promise<Partial<TmdbDetail> & { posterPath?: string }> {
        const d = await this.tmdb.detail(r.id, r.mediaType);
        return { ...d, posterPath: r.posterPath };
    }

    /**
     * 测试连接统一包装：measure 全程耗时 + withTimeout 超时（10s），
     * 无论成功/失败/超时都返回 elapsedMs，供设置页「✓ 连接成功 · 423ms」展示。
     */
    private async runTest(label: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<SourceTestResult> {
        return measure(() => withTimeout(fn(), TIMEOUT_MS, label)).then(
            ({ elapsedMs, result }) => ({ ...result, elapsedMs }),
            (e) => ({
                ok: false,
                message: e instanceof Error ? e.message : String(e),
                elapsedMs: e instanceof TimedError ? e.elapsedMs : TIMEOUT_MS,
            }),
        );
    }

    /** 测试 TMDB 连接（设置页按钮）：请求 configuration 接口，按状态码反馈 */
    async testTmdbConnection(): Promise<SourceTestResult> {
        return this.runTest('TMDB 连接', async () => {
            const key = this.settings.tmdbApiKey;
            if (!key) return { ok: false, message: '未配置 TMDB API Key' };
            try {
                const res = await requestUrl({
                    url: `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`,
                });
                if (res.status === 200) return { ok: true, message: '连接成功：TMDB API Key 有效' };
                if (res.status === 401) return { ok: false, message: '连接失败：API Key 无效（HTTP 401）' };
                if (res.status === 429) return { ok: false, message: '连接失败：请求过于频繁（HTTP 429）' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 Bangumi 连接（设置页按钮）：GET /v0/me 验证 Access Token */
    async testBangumiConnection(): Promise<SourceTestResult> {
        return this.runTest('Bangumi 连接', async () => {
            if (!this.settings.bangumiToken) {
                return { ok: false, message: '未配置 Bangumi Access Token' };
            }
            try {
                await this.bangumi.testConnection();
                return { ok: true, message: '连接成功：Bangumi Access Token 有效' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试豆瓣可用性（设置页按钮）：探测 j/search 是否可访问且返回正常 JSON */
    async testDoubanConnection(): Promise<SourceTestResult> {
        return this.runTest('Douban 连接', async () => {
            try {
                await this.douban.testConnection();
                return { ok: true, message: 'Douban 搜索接口可访问' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 OMDb 连接（设置页按钮，T11 调用）：?apikey={key}&i=tt3896198&plot=short 轻量 ping；
     *  未配 key / 网络失败给出明确文案（未配置/连接失败区分） */
    async testOmdbConnection(): Promise<SourceTestResult> {
        return this.runTest('OMDb 连接', async () => {
            const key = this.settings.omdbApiKey;
            if (!key) return { ok: false, message: '未配置 OMDb API Key' };
            try {
                const res = await retry(() =>
                    requestUrl({ url: buildDetailUrl(key, 'tt3896198', 'short') }),
                );
                // 200 = ping 成功（无效 key OMDb 回 HTTP 401，超额回 429）
                if (res.status === 200) return { ok: true, message: '连接成功：OMDb API Key 有效' };
                if (res.status === 401) return { ok: false, message: '连接失败：API Key 无效（HTTP 401）' };
                if (res.status === 429) return { ok: false, message: '连接失败：请求次数已达上限（HTTP 429）' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 Google Books 连接（设置页按钮，#165 T11 调用）：volumes?q=test&maxResults=1 轻量 ping；
     *  Key 可选——未配 key 仍可用（公开免费额度）故成功时注明；无效 key / 429 限流给明确文案 */
    async testGoogleBooksConnection(): Promise<SourceTestResult> {
        return this.runTest('Google Books 连接', async () => {
            try {
                const url = buildSearchUrl('test', this.settings.googleBooksApiKey || undefined, 1);
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) {
                    return this.settings.googleBooksApiKey
                        ? { ok: true, message: '连接成功：Google Books API Key 有效' }
                        : { ok: true, message: '连接成功：Google Books API 可访问（未配 Key，公开免费额度）' };
                }
                if (res.status === 429) return { ok: false, message: '连接失败：请求过于频繁（HTTP 429），建议配置 API Key' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 IGDB 连接（设置页按钮）：双凭据齐备 → igdb.testConnection（换新 token + limit 1 查询）。
     *  与其它源 runTest 计时/文案口径一致；缺任一凭据给明确提示 */
    async testIgdbConnection(): Promise<SourceTestResult> {
        return this.runTest('IGDB 连接', async () => {
            if (!this.settings.igdbClientId || !this.settings.igdbClientSecret) {
                return { ok: false, message: '未配置 IGDB 双凭据（需 Client ID 与 Client Secret）' };
            }
            try {
                await this.igdb.testConnection();
                return { ok: true, message: '连接成功：IGDB 凭据有效，可访问 v4/games' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    async activateView(type: string): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        for (const l of workspace.getLeavesOfType(type)) {
            leaf = l;
            break;
        }
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    /** 打开统一视图并切到指定页签（shelf / tracking） */
    async activateHome(tab: HomeTab): Promise<void> {
        this.homeTab = tab;
        await this.activateView(HOME_VIEW_TYPE);
    }

    /**
     * 类型化主操作（阅读 / 观看 / 启动 / 播放）—— **四类统一入口**。
     *
     * 🔴 #444c：这段分流原来写在 `HomeView.ts` 的 `onWatch` 箭头函数里；系列选择弹窗改成
     *    应用级 `Modal` 之后，弹窗**不再长在插件视图里**（拿不到那个 prop），而它同样要执行「点某一部就播」。
     *    ⇒ 下沉到这个单一入口，`HomeView` 与 `SeriesPickerModal` 都调它，⛔ 别两处各写一套分流
     *    （两套必然漂移：从墙上点 vs 从弹窗点，行为不一样）。
     */
    runEntryAction(e: MediaEntry): void {
        if (e.type === 'book') void this.openBookReader(e);
        else if (e.type === 'game') void this.launchGame(e);
        else if (e.type === 'music') void this.playAudioEntry(e);
        else void this.openWatchLinkPicker(e);
    }

    /**
     * 打开系列「季列表」弹窗（#444c）。
     * 🔴 应用级 `Modal`（挂 `document.body`）—— ⛔ 不再由视图自己造遮罩 + 绝对定位居中：
     *    那条路不管怎么调都受插件**正文区**宽度限制（用户窗口下最多 4 列），
     *    而 Modal 的宽度按整个窗口算（同一窗口能给到 6 列）。
     */
    openSeriesPicker(group: SeriesGroup): void {
        new SeriesPickerModal(this.app, this, group).open();
    }

    /** 当前打开的添加/编辑弹窗（防重复打开叠加：新开前先关闭旧的，避免遮罩堆叠导致新弹窗无法交互/无法输入搜索） */
    entryModal: EntryModal | null = null;

    openAddModal(initialType?: EntryType, initialBookKind?: BookKind): void {
        this.entryModal?.close();
        this.entryModal = new EntryModal(this.app, this, undefined, initialType, initialBookKind);
        this.entryModal.open();
    }

    /** 打开摘抄录入弹窗（命令入口无书需选书；书籍表单/右键菜单传入 book 固定挂载） */
    openExcerptModal(book?: MediaEntry): void {
        new ExcerptModal(this.app, this, book).open();
    }

    /** 添加摘抄：写入书目笔记摘抄区，随后立即刷新视图（摘抄数徽标即时更新） */
    async addExcerpt(bookId: string, excerpt: ParsedExcerpt): Promise<{ count: number }> {
        const e = await this.service.get(bookId);
        const r = await this.service.addExcerpt(bookId, excerpt, { refLink: this.excerptRefLink(e) });
        await this.refreshViews();
        return r;
    }

    /** 摘抄头行的源文件 wikilink 目标：库内文件取最短链接文本（metadataCache）；库外/无文件 → undefined（头行只写标签、块尾补 ^id） */
    excerptRefLink(e: MediaEntry | undefined): string | undefined {
        const rel = e?.bookFile;
        if (!rel) return undefined;
        try {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(rel));
            if (f instanceof TFile) return this.app.metadataCache.fileToLinktext(f, e?.notePath ?? '');
        } catch { /* 链接文本解析失败不阻断写入 */ }
        return undefined;
    }

    /** 摘抄计数（P1 性能缓存）：优先读 catalog.excerptCount（addExcerpt 时维护，零文件读）；
     *  老数据无值 → 惰性解析笔记一次并写回缓存（之后走缓存不再读笔记）。 */
    async excerptCounts(): Promise<Record<string, number>> {
        const out: Record<string, number> = {};
        const entries = await this.service.list();
        for (const e of entries) {
            if (e.type !== 'book' || !e.notePath) continue;
            if (typeof e.excerptCount === 'number') {
                out[e.id] = e.excerptCount;
                continue;
            }
            // 老数据兜底：解析一次并写回（失败记 0 不写回，下次重试）
            try {
                const f = this.app.vault.getAbstractFileByPath(e.notePath);
                if (f instanceof TFile) {
                    const n = countExcerpts(await this.app.vault.cachedRead(f));
                    out[e.id] = n;
                    void this.service.update(e.id, { excerptCount: n }).catch(() => undefined);
                } else {
                    out[e.id] = 0;
                }
            } catch {
                out[e.id] = 0;
            }
        }
        return out;
    }

    /** 生成年度总结：当年数据 → Markdown → 落盘 {libraryDir}/报告/YYYY-年度总结.md → 自动打开（仅统计页按钮入口） */
    async generateReport(): Promise<void> {
        const year = new Date().getFullYear();
        try {
            const [entries, excerptCounts] = await Promise.all([this.service.list(), this.excerptCounts()]);
            const md = generateYearReport({ year, entries, excerptCounts });
            const dir = this.libDir;
            const path = yearReportPath(year, `${dir}/${DIR_REPORTS}`);
            await createVaultIO(this.app).writeText(path, md);
            const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
            if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
            await this.refreshViews();
            new Notice(`已生成 ${year} 年度总结`);
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 罗列已生成的年度报告（{libraryDir}/报告/YYYY-年度总结.md），年份降序（统计页「往年报告」下拉） */
    async listYearReports(): Promise<{ year: number; path: string }[]> {
        try {
            const dir = normalizePath(`${this.libDir}/${DIR_REPORTS}`);
            return listReportYears(
                this.app.vault
                    .getFiles()
                    .map((f) => f.path)
                    .filter((p) => p.startsWith(dir + '/')),
            );
        } catch {
            return [];
        }
    }

    /** 打开某份年度报告笔记（统计页「往年报告」入口；报告在库内直接 openFile） */
    async openReport(path: string): Promise<void> {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
    }

    /** 打开游玩记录弹窗（书籍表单/游戏卡片右键入口；固定挂载当前游戏） */
    openGameSessionModal(game: MediaEntry): void {
        new GameSessionModal(this.app, this, game).open();
    }

    /** 弹窗提交入口：hours → minutes 转换 → addPlaySession + 刷新 */
    async recordPlaySession(gameId: string, data: { date: string; hours: number; note?: string }): Promise<void> {
        const minutes = Math.round(data.hours * 60);
        if (minutes <= 0) throw new Error('游玩时长必须大于 0 小时');
        await this.service.addPlaySession(gameId, { date: data.date, minutes, note: data.note });
        await this.refreshViews();
    }

    /** 打开编辑弹窗（书架/计划表卡片编辑图标） */
    async openEditModal(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (e) {
            this.entryModal?.close();
            this.entryModal = new EntryModal(this.app, this, e);
            this.entryModal.open();
        }
    }

    /**
     * 删除条目（#350 · 方案文档 M4）：**清单式确认 → 逐项清理 → 删条目记录 → 刷新视图**。
     * 原实现是「一句轻量警告 + 删条目 + 连带删笔记」，封面 / 阅读存档会被遗弃（用户报障的盲区）。
     *
     * 🔴 三条硬口径：
     *  ⑴ **确认职责在本插件**：`fileManager.promptForDeletion` 在用户关掉 Obsidian「删除前确认」时
     *     **不弹窗、直接删**（asar 反查实证，见方案 D-9）—— 所以绝不依赖它来确认。
     *  ⑵ **笔记交给 Obsidian 原生弹窗删**：1.12 起它自带「一并删除附件」，能顺带处理**笔记里链接过的**文件
     *     （封面与播放器截图都嵌在笔记里）；用户在官方弹窗上取消 → **整体中止**（⛔ 不留半个删除）。
     *  ⑶ 其余勾选项（封面 / 阅读存档 / 书签文件 / 库内媒体）逐个走 **`trashFile`**（进回收站，可还原）。
     */
    async deleteEntry(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (!e) return;
        const assets = entryAssetPlan({
            entry: e,
            libraryDir: this.settings.libraryDir || 'ReelLudic',
            exists: (p) => this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile,
        });
        const picked = await new DeleteEntryModal(this.app, `删除条目「${e.title}」`, assets).open();
        if (!picked) return; // 取消 / 直接关闭 → 什么都不做
        // ① 笔记：先交官方弹窗（唯一能顺带处理「笔记里链接过的附件」的通道）
        const note = picked.find((a) => a.kind === 'note');
        if (note) {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(note.path));
            if (f instanceof TFile && (await this.app.fileManager.promptForDeletion(f)) === false) return;
        }
        // ② 其余勾选项：逐个进回收站（单条失败不阻断其余）
        for (const a of picked) {
            if (a.kind === 'note' || !a.deletable) continue;
            const f = this.app.vault.getAbstractFileByPath(normalizePath(a.path));
            if (!(f instanceof TFile)) continue;
            try {
                await this.app.fileManager.trashFile(f);
            } catch {
                // 文件可能已被外部移除：不阻断
            }
        }
        // ③ 条目记录（⛔ 不用 removeWithNote —— 笔记已在上面处理过，避免重复删同一个文件）
        await this.service.remove(id);
        await this.refreshViews();
    }

    /**
     * 批量删除（列表多选，）：一次确认后逐条删除，失败单条跳过不阻断。
     * ⚠️ 批量**不做逐项清单**（方案文档 D-3：会弹出 N 次）⇒ 直接清掉**安全项**（笔记 / 封面 / 阅读存档 / 书签文件），
     *    ⛔ 媒体文件永不默认删（那是用户自己的资产）。删除同样进回收站。
     */
    async deleteEntries(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const ok = await new ConfirmModal(
            this.app,
            `确定删除选中的 ${ids.length} 个条目？笔记、封面与阅读存档将一并清理（进回收站）；媒体文件不会被动。`,
        ).open();
        if (!ok) return;
        const lib = this.settings.libraryDir || 'ReelLudic';
        for (const id of ids) {
            try {
                const e = await this.service.get(id);
                if (!e) {
                    await this.service.remove(id);
                    continue;
                }
                // 先算计划（笔记还在时能查到），再删——否则计划里的路径已经不存在
                const plan = entryAssetPlan({
                    entry: e,
                    libraryDir: lib,
                    exists: (p) => this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile,
                }).filter((a) => a.risk === 'safe');
                await this.service.removeWithNote(id);
                for (const a of plan) {
                    if (a.kind === 'note' || !a.deletable) continue; // 笔记已由 removeWithNote 处理
                    const f = this.app.vault.getAbstractFileByPath(normalizePath(a.path));
                    if (f instanceof TFile) await this.app.fileManager.trashFile(f);
                }
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /** 月历拖拽排期：设置条目的计划观看日期（dateStr 传空清除），随后刷新视图 */
    async planEntry(id: string, dateStr: string): Promise<void> {
        await this.service.update(id, { plannedDate: dateStr || undefined });
        await this.refreshViews();
    }

    /** 打开外部来源链接（计划表「直达」按钮；仅允许 http/https） */
    openExternalUrl(url: string): void {
        if (!/^https?:\/\//.test(url)) {
            new Notice('仅支持 http/https 链接');
            return;
        }
        window.open(url, '_blank');
    }

    /** 海报墙/列表「观看」按钮：影视条目有本地剧集或网络地址 → 弹集数选择（本地优先内嵌播放，否则打开网络）；否则单链接直接打开 / 多链接弹窗选择 */
    async openWatchLinkPicker(entry: MediaEntry): Promise<void> {
        const eps = entry.episodeFiles ?? [];
        const urls = entry.episodeUrls ?? [];
        const total = entry.progress?.totalEpisodes ?? 0;
        // 电影直达：真正单集（总集数未设或 ≤1，且资源不超过 1 个）不弹集数选择——直接播放第 1 集本地视频（无本地则打开网络地址）；
        // 多集（总集数 >1 或资源多于 1 个，如动画电影系列/上下集）→ 落入下方集数选择弹窗
        if (entry.type === 'movie' && total <= 1 && eps.length <= 1 && urls.length <= 1) {
            const p = eps[0];
            const u = urls[0];
            if (p) {
                void this.openEpisodeLocal(entry, 0);
                return;
            }
            if (u) {
                this.openExternalUrl(u);
                return;
            }
        }
        if (eps.length > 0 || urls.length > 0 || total > 1) {
            // 弹窗按总集数展开（未填资源的集置灰，可在编辑表单补录），不设总集数时按实际资源数
            const n = Math.max(total, eps.length, urls.length);
            const files: (string | undefined)[] = Array.from({ length: n }, (_, i) => eps[i]);
            const net: (string | undefined)[] = Array.from({ length: n }, (_, i) => urls[i]);
            const titles: (string | undefined)[] = Array.from({ length: n }, (_, i) => entry.episodeTitles?.[i]);
            const idx = await new EpisodePickerModal(this.app, entry.title, files, net, titles, entry.type === 'movie').open();
            if (idx !== null) {
                const p = entry.episodeFiles?.[idx];
                const u = entry.episodeUrls?.[idx];
                if (p) void this.openEpisodeLocal(entry, idx);
                else if (u) this.openExternalUrl(u);
            }
            return;
        }
        const links = entry.links ?? [];
        if (links.length === 0) return;
        if (links.length === 1) {
            this.openExternalUrl(links[0].url);
            return;
        }
        const url = await new LinkPickerModal(this.app, entry.title, links).open();
        if (url) this.openExternalUrl(url);
    }

    /** 海报墙/列表右键「动词 · 去关联」：无关联入口 → 打开快捷关联弹窗（书/游戏/音乐=本地路径；
     *  影视=选集网络/本地源），保存由 saveQuickAssociate 落库 + 同步笔记 + 刷新视图 */
    quickAssociateEntry(entry: MediaEntry): void {
        new QuickAssociateModal(this.app, entry, {
            pickFile: (kind) => this.pickForAssociate(kind),
            probeBook: (path) => this.probeBookPages(path),
            pickVideoDir: () => this.pickVideoDirPath(),
            scanEpisodeDir: (dir) => this.scanEpisodeDir(dir),
            // 🔴 #521 撤除：本弹窗**不再挂**「下载 / 检索」小图标（#406 / #454 那两套回调随之删除）——
            //    用户：「右键观看按钮浮窗网络链接按钮删除掉，干脆统一一下，书籍类游戏音乐也一样」。
            //    这两件事在**编辑表单的标签行**上都有（同一份实现）⇒ ⛔ 不在两处重复提供。
            //    ⚠️ 主程序那三个方法（`openMusicDownloader` / `listLibraryAudioFiles` / `openBookDownloader`）
            //    **原样保留** —— `EntryModal`（完整编辑表单）那侧还在用，⛔ 别顺手删。
            // 🔴 #506：影视条目「网络地址」标签旁的 **B站 搜索小按钮**（用户报障：这个入口原先没有它）。
            //    复用**同一条链**：`main.dlBiliSearch` / `main.dlBiliView`（两步请求 + `buvid3` 缓存 +
            //    `Platform.isDesktopApp` 门控都在它们里面，⛔ 这里不再判平台、也 ⛔ 别另写一份请求）。
            //    `biliParts` 缺了就会回落成「只填当前这一集」；两个都缺 ⇒ 弹窗里不画那枚按钮。
            biliSearch: (kw: string) => this.dlBiliSearch(kw),
            biliParts: (bvid: string) => this.dlBiliView(bvid),
            save: (r) => this.saveQuickAssociate(entry, r),
        }).open();
    }

    // ──────────── 今日记录 / 日记打卡 ────────────
    /** 活动日志（状态翻转）：统计页「今日」与日记打卡共用的数据源 */
    async listActivity(): Promise<ActivityEvent[]> {
        try {
            return await this.service.activityLog();
        } catch {
            return [];
        }
    }

    /** 核心「日记」插件的目录/格式配置（未启用或内部接口变化 → null，不抛错） */
    private dailyNotesOptions(): { folder?: string; format?: string } | null {
        try {
            const ip = (this.app as unknown as {
                internalPlugins?: {
                    getPluginById?(id: string): {
                        enabled?: boolean;
                        instance?: { options?: { folder?: string; format?: string } };
                    } | null;
                };
            }).internalPlugins;
            const p = ip?.getPluginById?.('daily-notes');
            if (!p || p.enabled === false) return null;
            return p.instance?.options ?? null;
        } catch {
            return null;
        }
    }

    /** 打卡日记落点：设置页手填优先 → 核心「日记」插件 → 回退「日记 / YYYY-MM-DD」 */
    private journalTarget(): { dir: string; format: string } {
        const core = this.dailyNotesOptions();
        const dir = (this.settings.journalDir?.trim() || core?.folder?.trim() || '日记').replace(/^\/+|\/+$/g, '');
        const format = this.settings.journalFormat?.trim() || core?.format?.trim() || 'YYYY-MM-DD';
        return { dir, format };
    }

    /** 目录不存在则逐级创建（vault.createFolder 只建一级） */
    private async ensureFolder(dir: string): Promise<void> {
        if (!dir) return;
        let cur = '';
        for (const seg of dir.split('/').filter(Boolean)) {
            cur = cur ? `${cur}/${seg}` : seg;
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try {
                    await this.app.vault.createFolder(cur);
                } catch { /* 已存在/并发：忽略 */ }
            }
        }
    }

    /**
     * 一键把观影/阅读动态写成打卡区块，追加进**当天日记**（幂等：已有同范围区块则整体更新，不重复追加）。
     * 范围跟随统计页「动态」面板的 日/周/月/年 切换：日 = 逐条（HH:mm），周/月/年 = 该周期的分块汇总。
     * 区块标题按范围区分（`2026-09-10` / `第 37 周（…）` / `2026-09` / `2026`），因此不同范围的区块互不覆盖。
     * 唯一入口 = 统计页「动态」面板的按钮（09-10 起不再挂设置页行与命令面板）。
     */
    async recordTodayJournal(range: FeedRange = 'day'): Promise<void> {
        const span = feedSpan(range);
        const [entries, log] = await Promise.all([this.service.list(), this.listActivity()]);
        const block = range === 'day'
            ? renderJournalBlock(span.start, collectDayActivity(entries, log, span.start))
            : renderPeriodBlock(range, span, groupFeed(collectFeed(entries, log, span), range));
        if (!block) {
            new Notice(`${FEED_RANGE_WORDS[range]}还没有观影/阅读动态 — 标记「在看/已看」或添加条目后再记录`, 4000);
            return;
        }
        const dateStr = span.start; // 日记文件名仍按「今天」（写入当天日记）
        const sectionLabel = range === 'day' ? span.start : feedSectionLabel(range, span);
        const { dir, format } = this.journalTarget();
        let name: string;
        try {
            name = moment(new Date()).format(format);
        } catch {
            name = dateStr;
        }
        const path = normalizePath(`${dir ? `${dir}/` : ''}${name}.md`);
        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                const cur = await this.app.vault.read(existing);
                const next = upsertJournalSection(cur, sectionLabel, block);
                if (next !== cur) await this.app.vault.modify(existing, next);
            } else {
                await this.ensureFolder(dir);
                await this.app.vault.create(path, upsertJournalSection('', sectionLabel, block));
            }
            new Notice(`已记录${FEED_RANGE_WORDS[range]}动态 → ${path}`, 4000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`写入打卡日记失败：${msg}`, 5000);
        }
    }

    /** 系统文件选择器按类别分发（书=电子书 / 游戏=.lnk / 音乐=音频 / 影视=可关联视频容器） */
    private pickForAssociate(kind: QuickAssocPickKind): Promise<string | undefined> {
        switch (kind) {
            case 'book': return this.pickBookFilePath();
            case 'game': return this.pickGameLaunchPath();
            case 'music': return this.pickLocalAudioPath();
            case 'video': return this.pickLocalVideoPath();
        }
    }

    /** 快捷关联保存：组装 patch →（书籍探本地基准 reconcile 进度）→ service.update → 同步笔记 → 刷新。
     *  笔记外部修改冲突不弹确认（快捷关联改动面小；writeNote 内置摘抄区合并防覆写） */
    private async saveQuickAssociate(entry: MediaEntry, r: QuickAssociateResult): Promise<void> {
        const patch: Partial<MediaEntry> = {};
        if (entry.type === 'book') {
            patch.bookFile = r.bookFile?.trim() || undefined;
            if (r.bookFile) {
                const probe = await this.probeBookPages(r.bookFile);
                if (probe) {
                    const rec = reconcileBookProgress(entry.readingProgress ?? {}, probe as BookFileInfo);
                    if (rec.readingProgress) patch.readingProgress = rec.readingProgress;
                    if (rec.pageCount !== undefined) patch.pageCount = rec.pageCount;
                }
            }
        } else if (entry.type === 'game') {
            patch.gameLaunchPath = r.gameLaunchPath?.trim() || undefined;
        } else if (entry.type === 'music') {
            patch.audioPath = r.audioPath?.trim() || undefined;
        } else {
            patch.episodeFiles = r.episodeFiles;
            patch.episodeUrls = r.episodeUrls;
            patch.episodeTitles = r.episodeTitles;
            if (entry.type !== 'movie' && r.totalEpisodes !== undefined) {
                // 仅调整 totalEpisodes，保留既有剧集进度（season/episode/日期/历史）
                const p = entry.progress;
                patch.progress = {
                    season: p?.season ?? 1,
                    episode: p?.episode ?? 0,
                    history: p?.history ?? [],
                    ...(p?.lastWatchedDate !== undefined ? { lastWatchedDate: p.lastWatchedDate } : {}),
                    totalEpisodes: r.totalEpisodes,
                };
            }
        }
        const merged = await this.service.update(entry.id, patch);
        try {
            await this.service.writeNote(merged.id);
        } catch (e) {
            new Notice('笔记同步失败：' + (e instanceof Error ? e.message : String(e)), 5000);
        }
        await this.refreshViews();
    }

    /** 打开某剧集本地视频（海报墙/列表「观看」选集后）：受设置「内置播放器打开视频文件」控制——
     *  关闭（默认）→ 系统播放器打开文件；开启时按整剧 episodeFiles 收集可内嵌集建播放列表打开内置播放器
     *  （支持上一集/下一集）；所选集为 Chromium 不可内嵌格式（mkv/h265 等）→ 自动转系统播放器 */
    private async openEpisodeLocal(entry: MediaEntry, startIdx: number, seekSec?: number, forceInternal = false): Promise<void> {
        const all = entry.episodeFiles ?? [];
        const startPath = all[startIdx];
        if (!startPath) return;
        // 设置「内置播放器打开视频文件」关闭（默认）→ 一律系统播放器打开文件（镜像 internalBookReader 语义）
        // 🔴 `forceInternal`（时间戳深链专用）：**必须走内置播放器** —— 只有它能定位到某秒；
        //    走系统播放器会从头播 = 「点了等于没跳」（2026-09-19 用户实测报障）。
        if (!forceInternal && !this.settings.internalMediaPlayback) {
            void this.openWithSystemPlayer(startPath);
            return;
        }
        // 所选集不可内嵌 → 该集直接系统播放器（不建弹窗，符合「不支持的自动转系统」）
        if (!isEmbeddableVideoPath(startPath)) {
            void this.openWithSystemPlayer(startPath);
            return;
        }
        // 建整剧「可内嵌」播放列表（跳过不可内嵌/解析失败的集；按剧集顺序保留真实集下标）
        const items: EmbedVideoItem[] = [];
        for (let i = 0; i < all.length; i++) {
            const path = all[i];
            if (!path || !isEmbeddableVideoPath(path)) continue;
            const url = this.resolveEmbedUrl(path);
            if (!url) continue;
            items.push({
                index: i,
                title: entry.episodeTitles?.[i],
                url,
                path,
                isFirst: false,
                isLast: false,
            });
        }
        if (items.length === 0) {
            // 防御：所选集可内嵌却因解析失败无 URL → 回退系统播放器
            void this.openWithSystemPlayer(startPath);
            return;
        }
        // 标注边界 + 定位起始项
        items.forEach((it, k) => {
            it.isFirst = k === 0;
            it.isLast = k === items.length - 1;
        });
        const pos = items.findIndex((it) => it.index === startIdx);
        // 进度条标记（#333）：从**条目笔记**解析（真源仍是笔记；视图按当前集过滤）。
        const marks = await this.service.readNoteMarks(entry.id);
        const opts = {
            marks,
            // 卡片里的截图缩略图：库内资源 → `app://` URL（视图不碰 vault）
            markImageUrl: (image: string) => this.resolveNoteImageUrl(image, entry),
            // 「在笔记中打开」（#333 D-3）：明确是用户点按钮 ⇒ 聚焦笔记 + 滚到标记那一行
            onOpenMarkNote: (mark: VideoMark) => this.openNoteAtMark(entry, mark),
        };
        void this.openVideoPlayer({
            entryTitle: entry.title,
            items,
            startIndex: pos >= 0 ? pos : 0,
            single: entry.type === 'movie',
            // 时间戳链接定位（#326）：等 loadedmetadata 后跳转并播放（与续播位置互斥，见视图内 consumePendingSeek）
            pendingSeek: seekSec !== undefined && seekSec > 0 ? { index: startIdx, seconds: seekSec } : undefined,
            onExternalFallback: (path) => void this.openWithSystemPlayer(path),
            // 记忆播放位置（落 catalog.videoPositions）+ 字幕（同目录自动 + 手动选）
            entryId: entry.id,
            initialPositions: entry.videoPositions,
            onSavePosition: (key, seconds) => void this.persistVideoPosition(entry.id, key, seconds),
            listSubtitles: (videoPath) => this.listSubtitleCandidates(videoPath),
            loadSubtitleVtt: (subPath) => this.readSubtitleAsVtt(subPath),
            pickSubtitleFile: () => this.pickSubtitleFromSystem(),
            ...opts,
            // 时间戳插入 + 一键截图（#326）：宿主负责「构造链接 / 落盘 / 写笔记 / 提示」
            onInsertStamp: (info) => this.insertVideoStamp(entry, info),
            onCaptureShot: (info) => this.saveVideoShot(entry, info),
            onOpenNote: async () => { await this.openVideoNote(entry); },
            // 三个播放器开关（齿轮内可改，改完落 settings）
            ...this.playerSwitchOptions(),
        });
    }

    /** 在内嵌播放器视图（工作区新标签页，Media Extended 式）里打开视频：
     *  当前活动页已是播放器 → 直接换片复用；否则开新标签页。
     *  关闭语义 = 关标签页：点视频区黑边 / 「外部打开」/ 解码失败兜底都走视图内部。 */
    private async openVideoPlayer(opts: VideoPlayerOptions): Promise<void> {
        const workspace = this.app.workspace;
        const active = workspace.activeLeaf;
        let leaf = active && active.view instanceof VideoPlayerView ? active : null;
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIDEO_PLAYER_VIEW_TYPE, active: true });
        }
        const view = leaf.view;
        if (view instanceof VideoPlayerView) {
            view.openWith(opts);
        }
        // 播放器互斥（④-4）：视频起播 ⇒ 让内置音频播放器停声（真源 pure/audioQueue.playersToPause）
        this.pauseOtherPlayers('video');
    }

    /** 播放器三个开关 → 视图选项（两处 openVideoPlayer 共用一份，免得缺省口径各写一遍漂掉）。
     *  缺省：后台播放关 / 自动切集开（= 历史行为）/ 单集循环关。 */
    private playerSwitchOptions(): Pick<
        VideoPlayerOptions,
        'backgroundPlay' | 'autoNextEpisode' | 'loopSingleEpisode' | 'onToggleSetting'
    > {
        return {
            backgroundPlay: this.settings.playerBgPlay === true,
            autoNextEpisode: this.settings.playerAutoNext !== false,
            loopSingleEpisode: this.settings.playerLoopOne === true,
            onToggleSetting: (key, value) => void this.persistPlayerSetting(key, value),
        };
    }

    /** 播放器开关写回 settings（append-only 可选字段；落盘失败静默 —— 本次会话已经生效） */
    private async persistPlayerSetting(key: 'bgPlay' | 'autoNext' | 'loopOne', value: boolean): Promise<void> {
        if (key === 'bgPlay') this.settings.playerBgPlay = value;
        else if (key === 'autoNext') this.settings.playerAutoNext = value;
        else this.settings.playerLoopOne = value;
        try {
            await this.saveSettings();
        } catch {
            // 落盘失败不影响本次会话已生效的开关
        }
    }

    /** 打开单个本地视频（编辑表单「集按钮」）：受设置「内置播放器打开视频文件」控制——
     *  关闭（默认）→ 系统播放器打开文件；开启且 Chromium 可内嵌 → 单集内置弹窗；不可内嵌/解析失败 → 系统播放器 */
    async playLocalEpisode(path: string): Promise<void> {
        if (!path) return;
        // 设置关闭（默认）→ 系统播放器打开文件
        if (!this.settings.internalMediaPlayback) {
            await this.openWithSystemPlayer(path);
            return;
        }
        if (!isEmbeddableVideoPath(path)) {
            await this.openWithSystemPlayer(path);
            return;
        }
        const url = this.resolveEmbedUrl(path);
        if (!url) {
            await this.openWithSystemPlayer(path);
            return;
        }
        const item: EmbedVideoItem = { index: 0, url, path, isFirst: true, isLast: true };
        void this.openVideoPlayer({
            entryTitle: path.split(/[\\/]/).pop() ?? path,
            items: [item],
            startIndex: 0,
            single: true,
            onExternalFallback: (p) => void this.openWithSystemPlayer(p),
            ...this.playerSwitchOptions(),
        });
    }

    /** 外部系统播放器打开本地文件（桌面 Electron shell.openPath；不可内嵌格式/解码失败兜底共用） */
    private async openWithSystemPlayer(path: string): Promise<void> {
        if (!Platform.isDesktopApp) {
            new Notice('本地视频播放仅桌面端可用');
            return;
        }
        try {
            // 惰性 require（AGENTS 红线：桌面专用模块不在顶层 import，防移动端崩溃）
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell!.openPath(path);
            if (err) new Notice(`无法打开视频：${err}`);
        } catch {
            new Notice('无法打开本地播放器');
        }
    }

    /**
     * #462：探「本地音频」的**体积 + 时长**（音乐条目编辑表单那颗「播放」按钮的悬停提示用）。
     *
     * 用户原话：「给音乐类型关联到的音频文件鼠标hover提示音频文件时长：如04:25,和体积大小3MB」。
     *
     * 🔴 两条实现口径：
     *  ⑴ **时长靠 Chromium 解码探**（`<audio>` 的 `loadedmetadata` → `duration`），**不自己写容器解析**
     *     —— 与内置播放器走的是**同一条解码路径**（免白名单里的 mp3/flac/m4a/ogg/wav/aac 都能认），
     *     且 URL 复用 `resolveEmbedUrl`（库内 `getResourcePath` / 库外 `app://`），⛔ 别另拼一份。
     *  ⑵ **体积靠 `fs.statSync`**（桌面端；与「库内/库外」无关，走 `absoluteMediaPath` 取系统绝对路径）。
     *
     * ⚠️ 任一失败 ⇒ 该项 `undefined`（**拿不到就不显示那一段**，⛔ 不编造、不写「未知」）；
     *    结果按**路径**缓存（同一文件只探一次；hover 是高频动作，绝不每次重探）。
     */
    async probeAudioInfo(path: string): Promise<MediaInfo> {
        const p = String(path ?? '').trim();
        if (!p) return {};
        const hit = this.audioInfoCache.get(p);
        if (hit) return hit;
        let size: number | undefined;
        try {
            if (Platform.isDesktopApp) {
                const abs = this.absoluteMediaPath(p);
                if (abs) {
                    const fsMod = require('fs') as { statSync(q: string): { size: number } };
                    size = fsMod.statSync(abs).size;
                }
            }
        } catch {
            size = undefined; // 文件不在 / 无权限 ⇒ 只显示时长那一半
        }
        const duration = await this.probeAudioDuration(p);
        const info: MediaInfo = { size, duration };
        this.audioInfoCache.set(p, info);
        return info;
    }

    /** 本地路径 → **系统绝对路径**（vault 内走 `adapter.getFullPath`；库外原样返回）。取不到 ⇒ undefined */
    private absoluteMediaPath(path: string): string | undefined {
        const p = String(path ?? '').trim();
        if (!p) return undefined;
        try {
            const rel = this.toVaultRelPath(p);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) return (this.app.vault.adapter as FileSystemAdapter).getFullPath(f.path);
        } catch { /* 库外 / 取不到 ⇒ 当绝对路径用 */ }
        return p;
    }

    /** 探音频时长（秒）：Chromium `<audio>` 解码一次，拿不到（不可解码 / 超时 4s / 非渲染进程）⇒ undefined */
    private probeAudioDuration(path: string): Promise<number | undefined> {
        const url = this.resolveEmbedUrl(path);
        if (!url || typeof document === 'undefined') return Promise.resolve(undefined);
        return new Promise((resolve) => {
            let settled = false;
            const el = document.createElement('audio');
            const finish = (v?: number): void => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                try { el.removeAttribute('src'); el.load(); } catch { /* 忽略 */ }
                resolve(v);
            };
            const timer = window.setTimeout(() => finish(undefined), 4000);
            el.addEventListener('loadedmetadata', () => {
                const d = el.duration;
                finish(Number.isFinite(d) && d > 0 ? d : undefined);
            });
            el.addEventListener('error', () => finish(undefined));
            el.preload = 'metadata';
            el.src = url;
        });
    }

    /** 解析某本地路径为 <video> 可播 URL：
     *  vault 内 → app.vault.getResourcePath(TFile)；vault 外绝对路径 → app://<appId>/<encodeURIComponent 全路径>。
     *  返回 null = 文件无法定位（vault 外盘符/被移除等），调用方回退系统播放器 */
    private resolveEmbedUrl(path: string): string | null {
        try {
            const rel = this.toVaultRelPath(path);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) return this.app.vault.getResourcePath(f);
            // vault 外绝对路径：经 Obsidian app:// 自定义协议流式读取（同 LocalMediaEmbedder 外部文件方案，
            // 无需 http server / 整文件读内存；CSP 已放行 app: scheme）
            const appId = this.appSchemeId();
            if (!appId) return null;
            const norm = path.replace(/\\/g, '/');
            const encoded = norm
                .split('/')
                .map((seg) => encodeURIComponent(seg))
                .join('/');
            return `app://${appId}/${encoded}`;
        } catch {
            return null;
        }
    }

    /** 播放位置写回（节流由播放器负责）：并入 catalog.videoPositions；0 秒/无变化不写；失败静默 */
    private async persistVideoPosition(entryId: string, epKey: string, seconds: number): Promise<void> {
        try {
            if (!/^\d+$/.test(epKey)) return;
            const s = Math.max(0, Math.floor(seconds));
            if (s <= 0) return;
            const e = await this.service.get(entryId);
            if (!e) return;
            const map = { ...(e.videoPositions ?? {}) };
            if (map[epKey] === s) return;
            map[epKey] = s;
            await this.service.update(entryId, { videoPositions: map });
        } catch {
            /* 落库失败静默（不影响观看） */
        }
    }

    /** 视频所在目录的绝对路径（库内 = vault 根 + 相对路径；库外 = 自身目录）；解析失败返回空串 */
    private videoAbsDir(videoPath: string): string {
        try {
            const rel = this.toVaultRelPath(videoPath);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) {
                const adapter = this.app.vault.adapter as FileSystemAdapter;
                const base = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
                return base ? dirOfPath(`${base}/${rel}`) : '';
            }
            return dirOfPath(videoPath);
        } catch {
            return '';
        }
    }

    /** 同目录字幕候选（fs 扫描 + pure/subtitle 匹配排序）；非桌面端/失败 → 空数组 */
    private async listSubtitleCandidates(videoPath: string): Promise<SubtitleCandidate[]> {
        if (!Platform.isDesktopApp) return [];
        const dir = this.videoAbsDir(videoPath);
        if (!dir) return [];
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            const names = await fs.readdir(dir);
            return pickSubtitleCandidates(fileNameOfPath(videoPath), names);
        } catch {
            return [];
        }
    }

    /** 读取字幕文件并转成 WebVTT（库内走 adapter、库外走 fs）；失败返回 null */
    private async readSubtitleAsVtt(subtitlePath: string): Promise<string | null> {
        try {
            const rel = this.toVaultRelPath(subtitlePath);
            const f = this.app.vault.getAbstractFileByPath(rel);
            let text: string | null = null;
            if (f instanceof TFile) {
                text = await this.app.vault.adapter.read(rel);
            } else if (Platform.isDesktopApp) {
                const fs = require('fs/promises') as typeof import('fs/promises');
                text = await fs.readFile(subtitlePath, 'utf8');
            }
            if (text === null) return null;
            return srtToVtt(text);
        } catch {
            return null;
        }
    }

    /** 系统选择器挑字幕（.srt/.vtt）；取消/不可用返回 null */
    private async pickSubtitleFromSystem(): Promise<string | null> {
        const picked = await this.pickSystemFile(['srt', 'vtt'], '字幕文件', false);
        return picked ?? null;
    }
    /** Obsidian app:// 自定义协议 ID（用 adapter.getResourcePath 推导，会话内缓存一次）。
     *  vault 内资源文件经此协议加载；协议处理器可读库外绝对路径（Chromium 自定义 scheme，流式） */
    private appSchemeId(): string {
        const cached = (this as unknown as { _rlAppId?: string })._rlAppId;
        if (cached) return cached;
        let id = '';
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            if (typeof adapter.getResourcePath === 'function') {
                const rp = adapter.getResourcePath('__dummy__');
                const m = /app:\/\/([^/]+)\//.exec(rp);
                if (m) id = m[1];
            }
        } catch {
            id = '';
        }
        (this as unknown as { _rlAppId?: string })._rlAppId = id;
        return id;
    }

    /** 尝试用 Media Extended 播放器打开 vault 外本地文件（file:// URL）：
     *  v3+ 暴露 api.openUrl() 编程入口；v4 若未暴露公开 api 则回退 mx-open URI 协议（ME 注册的 obsidian:// handler）。
     *  返回 false = ME 未启用 / 调用失败，由调用方回退系统播放器 */
    private async playWithMediaExtended(path: string): Promise<boolean> {
        // App.plugins 未在 obsidian 类型定义中公开 → 运行时断言访问（Obsidian 1.x 实际存在）
        const appWithPlugins = this.app as unknown as {
            plugins: {
                plugins: Record<string, { api?: { openUrl?: (url: string, newLeaf?: string) => Promise<void> } } | undefined>;
            };
        };
        const mx = appWithPlugins.plugins?.plugins?.['media-extended'];
        if (!mx) return false;
        const fileUrl = toFileUrl(path);
        try {
            if (typeof mx.api?.openUrl === 'function') {
                await mx.api.openUrl(fileUrl, 'tab');
                return true;
            }
        } catch { /* 无公开 api：继续尝试 URI 协议 */ }
        try {
            // 模拟点击 obsidian://mx-open 链接（Obsidian 主进程分发到 ME 的 URI handler）
            const a = document.createElement('a');
            a.href = `obsidian://mx-open?url=${encodeURIComponent(fileUrl)}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            return true;
        } catch { /* 回退系统播放器 */ }
        return false;
    }

    /** 系统文件选择器统一实现（Electron remote.dialog 返回绝对路径；toRel=true 转 vault 相对路径，库外保留绝对路径；input file 的 File.path 在 Obsidian 环境不可用）。
     *  会话内记忆上次选中目录（defaultPath 续接：第 1 集选了文件夹，第 2 集浏览仍从该目录弹起）。
     *  注：不再弹「从库中选择 / 从系统浏览」二选一——点「浏览」直接唤起系统文件管理器，少一步点击。
     *
     *  🔴 #460：新增 `fallbackDir` —— 「音频 / 书籍」这两类**目标目录固定**的字段（就是插件自己下载的去处），
     *     冷启动（首次打开 / 插件重载后 `lastSystemDir` 为空）此前一律落**系统默认**（Windows = 「下载」），
     *     用户看到的是「浏览本地音频怎么每次都在系统下载」。现在冷启动落到**设置里填的那个目录**；
     *     ⚠️ 一旦用户本次会话选过文件，仍**续接上次位置**（既有口径，逐集浏览那种场景要用）。 */
    private pickSystemFile(exts: string[], name: string, toRel: boolean, fallbackDir?: string): Promise<string | undefined> {
        if (!Platform.isDesktopApp) return Promise.resolve(undefined);
        return new Promise((resolve) => {
            try {
                const electron = require('electron') as {
                    remote?: { dialog?: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
                };
                const dialog = electron.remote?.dialog;
                if (dialog) {
                    void dialog
                        .showOpenDialog({
                            filters: [{ name, extensions: exts }],
                            properties: ['openFile'],
                            defaultPath: this.lastSystemDir || fallbackDir || undefined,
                        })
                        .then((res) => {
                            const p = !res.canceled && res.filePaths[0] ? res.filePaths[0] : undefined;
                            if (p) this.lastSystemDir = dirnameOf(p);
                            resolve(p ? (toRel ? this.toVaultRelPath(p) : p) : undefined);
                        });
                } else resolve(undefined);
            } catch {
                resolve(undefined);
            }
        });
    }

    /**
     * 选**目录**（系统 `openDirectory`）—— 两个调用方共用这一份：
     *   · 「从文件夹检索剧集」（视频批量填集）；
     *   · 🔴 #524「检索本地书籍」（用户：「书籍检索文件目录给我**先弹出系统文件选择器让我选择目录**」）。
     * 🔴 三态返回值（调用方要据此分流，⛔ 别拿 `!dir` 一把抓）：
     *   `string` = 选中；`null` = **用户取消**；`undefined` = **本环境没有系统对话框**（非桌面端）——
     *   后者要「能力回落」到别的检索范围，取消则应当**什么都不做**。
     * ⚠️ 冷启动落点 = 上次浏览过的目录，其次 `fallbackDir`（调用方给该类的下载目录），最后系统默认。
     */
    pickDirPath(fallbackDir?: string): Promise<string | null | undefined> {
        if (!Platform.isDesktopApp) return Promise.resolve(undefined);
        return new Promise((resolve) => {
            try {
                const electron = require('electron') as {
                    remote?: { dialog?: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
                };
                const dialog = electron.remote?.dialog;
                if (!dialog) {
                    resolve(undefined);
                    return;
                }
                void dialog
                    .showOpenDialog({
                        properties: ['openDirectory'],
                        defaultPath: this.lastSystemDir || fallbackDir || undefined,
                    })
                    .then((res) => {
                        const d = !res.canceled && res.filePaths[0] ? res.filePaths[0] : null;
                        if (d) this.lastSystemDir = d;
                        resolve(d);
                    });
            } catch {
                resolve(undefined);
            }
        });
    }

    /** 选视频文件夹（「从文件夹检索剧集」）：⚠️ 只认「选中」与「没选」两态（取消 / 无对话框都当没选） */
    async pickVideoDirPath(): Promise<string | undefined> {
        const d = await this.pickDirPath();
        return d || undefined;
    }

    /** 🔴 #524：选书籍目录（编辑表单「检索本地书籍」）—— 冷启动锚点 = 设置里的「书籍文件目录」 */
    pickBookDirPath(): Promise<string | null | undefined> {
        return this.pickDirPath(this.downloadDirSystemPath(this.settings.bookDownloadDir, 'book'));
    }

    /**
     * 🔴 #524：列出**用户刚挑的那个目录**里的可关联书籍文件（支持子目录，深度 ≤ 4；忽略隐藏目录）。
     *
     * 用户：「书籍检索文件目录给我先弹出系统文件选择器让我选择目录」——原来只扫设置里那个
     *   「书籍文件目录」（`listLibraryBookFiles`），书放在别处就找不到。
     * ⚠️ 与 `listLibraryBookFiles()` 的分工：那条**读设置**（配置目录；也是非桌面端的回落路径）；
     *   这条**只认传进来的目录**（库内、库外都行）。
     * 返回的 `path` 与「浏览」同口径：库内 → 库内相对路径；库外 → 系统绝对路径（`toVaultRelPath` 认得出才转）。
     * 目录不存在 / 不可读 / 非桌面 ⇒ `[]`（调用方提示，⛔ 不抛）。
     */
    async listBookFilesInDir(dir: string): Promise<LibraryBookFile[]> {
        const d = String(dir ?? '').trim();
        if (!d || !Platform.isDesktopApp) return [];
        const out: LibraryBookFile[] = [];
        try {
            const fsMod = require('fs') as { readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
            const sep = d.includes('/') ? '/' : '\\';
            const walk = (abs: string, depth: number): void => {
                if (depth > 4) return;
                for (const ent of fsMod.readdirSync(abs, { withFileTypes: true })) {
                    if (ent.name.startsWith('.')) continue;
                    const child = `${abs.replace(/[\\/]+$/, '')}${sep}${ent.name}`;
                    if (ent.isDirectory()) walk(child, depth + 1);
                    else if (isAssociableBookPath(ent.name)) out.push({ path: this.toVaultRelPath(child), name: ent.name });
                }
            };
            walk(d, 0);
            out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        } catch {
            return [];
        }
        return out;
    }

    /** 读视频文件夹内可识别集号的视频文件（快捷关联弹窗/编辑表单批量检索用）：过滤可关联容器扩展名 →
     *  pure 集号解析 → 按集号升序返回 {ep, path, name}（path 与所在目录同分隔风格，供 episodeFiles 保位填充）。
     *  目录不可读/非桌面 → []（调用方提示）。 */
    async scanEpisodeDir(dir: string): Promise<{ ep: number; path: string; name: string }[]> {
        if (!dir || !Platform.isDesktopApp) return [];
        try {
            const fsMod = require('fs') as { readdirSync(p: string): string[] };
            const names = fsMod.readdirSync(dir);
            const extOk = (n: string): string | undefined => {
                const dot = n.lastIndexOf('.');
                return dot > 0 ? n.slice(dot + 1).toLowerCase() : undefined;
            };
            const vids = names.filter((n) => {
                const ext = extOk(n);
                return !!ext && (VIDEO_ASSOCIABLE_EXTENSIONS as readonly string[]).includes(ext);
            });
            const hits = scanEpisodeNumbers(vids).sort((a, b) => a.ep - b.ep);
            const sep = dir.includes('/') ? '/' : '\\';
            const base = dir.replace(/[\\/]+$/, '');
            return hits.map((h) => ({ ep: h.ep, name: h.name, path: `${base}${sep}${h.name}` }));
        } catch {
            return [];
        }
    }

    /**
     * #460：某类下载目录在**系统里的绝对路径**（系统选择器 `defaultPath` 锚点）。拿不到 / 目录还不存在 ⇒ undefined
     * （退回系统默认，⛔ 别硬编路径）。
     * ⚠️ 路径拼接走纯函数 `pure/downloadPlan.downloadDirAbsPath`（与落盘 / 检索同一个 `downloadDir`）——
     *    ⛔ 别在这里另拼一份，否则设置页改完目录这里会指到旧地方。
     */
    private downloadDirSystemPath(root: string | undefined, kind: DownloadKind): string | undefined {
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const base = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
            const abs = downloadDirAbsPath(base, root, kind);
            if (!abs) return undefined;
            const fsMod = require('fs') as { existsSync(p: string): boolean };
            return fsMod.existsSync(abs) ? abs : undefined;
        } catch {
            return undefined;
        }
    }

    /** 选本地视频：系统播放器需绝对路径，不转相对（可关联格式统一见 pure/mediaExtensions.VIDEO_ASSOCIABLE_EXTENSIONS） */
    async pickLocalVideoPath(): Promise<string | undefined> {
        return this.pickSystemFile([...VIDEO_ASSOCIABLE_EXTENSIONS], '视频', false);
    }

    /** 选本地音频（音乐条目）：可关联格式统一见 `pure/mediaExtensions.AUDIO_ASSOCIABLE_EXTENSIONS`（④ 收进真源，原先在此硬编码）。
     *  🔴 #460：冷启动锚点 = 设置页「音频文件目录」的绝对路径（⛔ 别让它再落系统「下载」）。 */
    async pickLocalAudioPath(): Promise<string | undefined> {
        return this.pickSystemFile(
            [...AUDIO_ASSOCIABLE_EXTENSIONS],
            '音频',
            true,
            this.downloadDirSystemPath(this.settings.musicDownloadDir, 'music'),
        );
    }

    /** 选书籍文件（TXT/EPUB/PDF）｜🔴 #460：冷启动锚点 = 「书籍文件目录」的绝对路径（同音频那枚） */
    async pickBookFilePath(): Promise<string | undefined> {
        return this.pickSystemFile(
            ['txt', 'epub', 'pdf'],
            '电子书',
            true,
            this.downloadDirSystemPath(this.settings.bookDownloadDir, 'book'),
        );
    }

    /** 选游戏启动快捷方式（.lnk） */
    async pickGameLaunchPath(): Promise<string | undefined> {
        return this.pickSystemFile(['lnk'], '游戏快捷方式', true);
    }

    /** 启动游戏（条目「▶ 启动」）：桌面端 shell.openPath 打开 .lnk 快捷方式（系统按快捷方式目标启动游戏） */
    async launchGame(entry: MediaEntry): Promise<void> {
        if (!entry.gameLaunchPath) {
            new Notice('未关联启动快捷方式 — 编辑条目选择 .lnk 文件', 4000);
            return;
        }
        if (!Platform.isDesktopApp) {
            new Notice('游戏启动仅桌面端可用');
            return;
        }
        try {
            // 库内相对路径转系统绝对路径；库外绝对路径直接用
            const file = this.app.vault.getAbstractFileByPath(entry.gameLaunchPath);
            const fullPath = file instanceof TFile ? (this.app.vault.adapter as FileSystemAdapter).getFullPath(file.path) : entry.gameLaunchPath;
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell?.openPath(fullPath);
            if (err) new Notice(`启动失败：${err}`, 4000);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 播放音乐条目音频（卡片「▶ 播放」）—— ④-4 起改为打开**内置音频播放器**（标签页）：
     * 歌词（笔记 lrc 块 / 同名 .lrc / 内嵌）与音频统一呈现，这是用户「统一 LRC 笔记和音频文件共存」的落点。
     * 解析不出可播 URL 时按老链路兜底（库内 → Obsidian 原生音频视图；库外 → Media Extended → 系统播放器），
     * ⛔ 不要因为新面而让原来能播的文件反而播不了。
     */
    async playAudioEntry(entry: MediaEntry): Promise<void> {
        if (!entry.audioPath) {
            new Notice('未关联本地音频 — 编辑条目选择文件', 4000);
            return;
        }
        const opts = await this.buildAudioPlayerOptions(entry);
        if (opts) {
            this.lastAudioEntry = entry;
            // 🔴 #474（用户 2026-10-01）：「侧边栏有歌曲正播放时，点海报墙的播放按钮」= **就地切歌**，
            //    复用侧边栏里那个播放器实例，⛔ 不再另开一个标签页（否则同一首歌会在两处各起一个）。
            const side = this.findSidebarAudioPlayer();
            if (side) {
                this.pauseOtherAudioInstances(side.leaf);   // 其它音频实例让出声道（防两路同响）
                // 侧边栏被折叠时展开（否则用户只听见声音、找不到播放器）；
                // ⚠️ **已经展开就⛔ 别 reveal** —— reveal 会激活那个 leaf，把焦点从用户手上的笔记抢走。
                const rightSplit = this.app.workspace.rightSplit as unknown as { collapsed?: boolean } | null;
                if (rightSplit?.collapsed) this.app.workspace.revealLeaf(side.leaf);
                side.view.openWith(opts);
                return;
            }
            await this.openAudioPlayer('tab', opts);
            return;
        }
        // 兜底 1：库内音频至少还能用 Obsidian 原生音频视图播
        const f = this.app.vault.getAbstractFileByPath(entry.audioPath);
        if (f instanceof TFile) {
            await this.app.workspace.getLeaf('tab').openFile(f);
            return;
        }
        // 兜底 2：库外绝对路径 → Media Extended → 系统播放器
        if (!Platform.isDesktopApp) {
            new Notice('库外音频播放仅桌面端可用');
            return;
        }
        if (await this.playWithMediaExtended(entry.audioPath)) return;
        try {
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell?.openPath(entry.audioPath);
            if (err) new Notice(`无法播放音频：${err}`, 4000);
        } catch {
            new Notice('无法打开播放器');
        }
    }

    /**
     * 🔴 #474（用户 2026-10-01）：找出**侧边栏里已经存在**的内置音频播放器实例（没有则 null）。
     *
     * 判据走 `AudioPlayerView.isInSidebar()`（= #410「打开笔记按钮只在标签页显示」的**同一份**口径），
     * ⛔ 别在宿主侧另写一份「是不是侧边栏」—— 两处必然漂。
     *
     * ⚠️ 也别图省事用 `getRightLeaf(false)`「顺手拿一个」：它返回的是侧边栏里**第一个** leaf，
     *    很可能挂着别的视图，随后的 `setViewState` 会把它顶掉（用户的侧边栏布局被静默改掉）。
     */
    private findSidebarAudioPlayer(): { leaf: WorkspaceLeaf; view: AudioPlayerView } | null {
        for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof AudioPlayerView && view.isInSidebar()) return { leaf, view };
        }
        return null;
    }

    /**
     * 🔴 #474：除 `keep` 之外的**音频播放器实例**一律让出声道。
     *
     * 为什么需要单独一个：真源 `pure/audioQueue.playersToPause` 是按**通路**分的（音频 ↔ 视频），
     * 它管不到「同一条通路上开了两个实例」（标签页一个 + 侧边栏一个）——
     * 而本批的场景（侧边栏在放 A、点卡片要放 B）恰好会同时存在两个实例 ⇒ 不处理就是**两路同时响**。
     * ⚠️ 这里**只排除 `keep`**（既不越权暂停用户自己点起来的那个实例，也不动别的通路 —— 那是 `pauseOtherPlayers` 的事）。
     */
    private pauseOtherAudioInstances(keep: WorkspaceLeaf | null): void {
        for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
            if (leaf === keep) continue;
            const view = leaf.view;
            if (view instanceof AudioPlayerView) view.pausePlayback();
        }
    }

    /**
     * 打开内置音频播放器。`where` 决定落在哪：标签页 / 右侧边栏
     * —— **同一个视图类型**，差别只是可用宽度（三档自适应由 `pure/audioLayout` 判定），
     * 所以「在侧边栏」不需要另一套 UI。
     * `opts` 缺省（命令面板入口）时用「上一次播放的音乐条目」重建队列。
     */
    private async openAudioPlayer(where: 'tab' | 'sidebar', opts?: AudioPlayerOptions): Promise<void> {
        const options = opts ?? (await this.buildAudioPlayerOptions(this.lastAudioEntry));
        if (!options) {
            new Notice('还没有可播放的音乐 — 先在音乐条目上点「播放」', 4000);
            return;
        }
        const workspace = this.app.workspace;
        let leaf: WorkspaceLeaf | null;
        if (where === 'sidebar') {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) {
                new Notice('右侧边栏不可用', 3000);
                return;
            }
        } else {
            // 当前活动页已是播放器 → 直接换条目复用（与 openVideoPlayer 同口径）
            const active = workspace.activeLeaf;
            leaf = active && active.view instanceof AudioPlayerView ? active : workspace.getLeaf('tab');
        }
        if (!(leaf.view instanceof AudioPlayerView)) {
            await leaf.setViewState({ type: AUDIO_PLAYER_VIEW_TYPE, active: where === 'tab' });
        }
        const view = leaf.view;
        if (view instanceof AudioPlayerView) {
            this.pauseOtherAudioInstances(leaf);   // 🔴 #474：起播前让**其它音频实例**让出声道（见 helper 注释）
            view.openWith(options);
        }
    }

    /**
     * 组装一次播放请求：队列 + 歌词读取 + 音量/模式设置。
     *
     * **队列来源（④-4 取设计文档 §5.5 的 A 方案）**：库内**全部带 `audioPath` 的音乐条目**，
     * 按库内顺序；起始曲 = 传入条目，不在队列里则从 0 开始。
     * 🔴 这里**不按扩展名再筛一遍**（`pure/audioQueue.normalizeAudioQueue` 的口径：会静默丢 `.opus`/`.ape`）；
     *    扩展名白名单只用于系统文件选择器。
     * ⚠️ 解析不出可播 URL 的曲目**不进队列** —— 否则用户切到它时只有一片安静、还以为播放器坏了。
     */
    private async buildAudioPlayerOptions(entry: MediaEntry | null): Promise<AudioPlayerOptions | null> {
        const all = await this.service.list();
        const tracks: AudioPlayerTrack[] = [];
        for (const e of all) {
            if (e.type !== 'music' || !e.audioPath) continue;
            const url = this.resolveEmbedUrl(e.audioPath);
            if (!url) continue;
            tracks.push({
                entryId: e.id,
                title: e.title,
                // 标签页标题要显示**笔记名**（用户 2026-09-27）：真源 `pure/libraryDir.fileDisplayName`
                // （叶子段去扩展名；⛔ 别在这里 `split('/')` —— 分隔符 / 扩展名大小写 / 带点目录名都是坑）
                noteName: fileDisplayName(e.notePath ?? ''),
                subtitle: audioSubtitle(e),
                path: e.audioPath,
                // 🔴 #408：笔记路径（「打开笔记」按钮）与左栏两块信息的展示文本
                notePath: e.notePath,
                url,
                coverUrl: this.resolvePoster(e) ?? null,
            });
        }
        if (!tracks.length) return null;
        const idx = entry ? tracks.findIndex((t) => t.entryId === entry.id) : 0;
        return {
            items: tracks,
            startIndex: idx >= 0 ? idx : 0,
            // 🔴 #406：**打开即自动播放**（用户：「海报墙点击播放按钮后…改为点击即自动播放」）。
            //    这里是标签页 / 侧边栏 / 命令面板三条入口共用的选项构造 —— 三处都是「用户主动点开」
            //    ⇒ 一律自动起播；⚠️ 笔记内联块走另一条构造（`audioOptionsForNote`），那里**不传**。
            autoplay: true,
            wordHighlight: this.settings.lyricsWordHighlight !== false,
            loadLyrics: (t) => this.loadEntryLyrics(t),
            initialMode: normalizeAudioPlayMode(this.settings.audioPlayMode),
            initialVolume: clampAudioVolume(this.settings.audioVolume ?? 1),
            onSaveMode: (mode) => void this.persistAudioSetting('mode', mode),
            onSaveVolume: (volume) => void this.persistAudioSetting('volume', volume),
            onPlayStart: (kind) => this.pauseOtherPlayers(kind),
            /** 🔴 #408：右上角「打开笔记」按钮 ⇒ 复用既有单点实现（无笔记时它自己会提示）。
             *  ⚠️ 只有**标签页 / 侧边栏**这条构造传它；内联块（笔记里的小卡片）**不传** ——
             *  那段笔记就在眼前，没必要再放一个「打开笔记」按钮（不传 ⇒ 按钮自动禁用）。 */
            onOpenNote: (track) => void this.openEntryNote(track.entryId),
        };
    }

    /**
     * 取某条目音频的歌词 —— 四路优先级真源 = `pure/lrcSource.pickLyrics`：
     * `lyrics 指令 > 块内正文 > 同名 .lrc > 音频内嵌标签`。
     * ⚠️ 第 4 路（ID3 / FLAC / M4A 内嵌标签）本轮**未实现** ⇒ 不传，`pickLyrics` 自然跳过；
     *    将来补一个读取器塞进 `pickLyricsFor` 即可，判定顺序不用动。
     */
    private async loadEntryLyrics(track: AudioPlayerTrack): Promise<{ text: string; origin: LrcLyricsOrigin } | null> {
        const note = await this.service.readNoteText(track.entryId);
        const block = parseLrcBlock(extractLrcBlock(note ?? '') ?? '');
        return this.pickLyricsFor(block, track.path);
    }

    /**
     * 四路歌词源的**读取侧**（笔记内 ` ```lrc ` 块与播放器视图共用，⛔ 别各写一份优先级）。
     *
     * 🔴 **第 4 路（音频内嵌）单独一轮、且放在最后**：#391 起才接上（此前只留了槽位），
     *    而它要**整块读音频字节**（动辄 8–12MB）⇒ 若和前三路一起算，用户库里有 `.lrc` 时也白读一遍；
     *    切歌一次读一次，代价会累积。所以先只看「文本三路」，命中就直接返回。
     * ⚠️ 两轮都仍走 `pickLyrics`（真源）——它自己判「空白不算有」，⛔ 别在这里另抄一遍空值判定。
     */
    private async pickLyricsFor(
        block: LrcBlock,
        audioPath: string,
    ): Promise<{ text: string; origin: LrcLyricsOrigin } | null> {
        const directiveFile = await this.readLyricsRef(block.lyrics);
        const sibling = await this.readLyricsRef(siblingLrcPath(audioPath) ?? undefined);
        const fromText = pickLyrics({
            directiveFile: directiveFile ?? undefined,
            inline: block.inline,
            sibling: sibling ?? undefined,
        });
        if (fromText) return fromText;
        const bytes = await this.readBookBytes(audioPath);
        return pickLyrics({ embedded: readEmbeddedLyrics(bytes) ?? undefined });
    }

    /**
     * 读一路歌词文件。参数形态（wiki 链接 / 库内相对 / 库外绝对）统一走 `pure/lrcSource.parseLrcRef` 判定，
     * 于是生成侧（`noteGenerator` 写 `source` 行）与这里用的是**同一套分类** —— 分叉的后果是
     * 「笔记写着 A、播放器去读 B」，且两边都不报错。
     * 🔴 读文件走 `readBookText`（内部先读二进制再嗅探编码，红线 11）—— 歌词文件同样常见 GBK。
     * 读不到 ⇒ `null`，让 `pickLyrics` 落到下一档。
     */
    private async readLyricsRef(raw: string | undefined): Promise<string | null> {
        const ref = parseLrcRef(raw ?? '');
        if (!ref) return null;
        return this.readBookText(ref.value);
    }

    /**
     * 在线歌词检索（#396，条目表单「获取歌词」）—— 四源并行搜索（#400 起含酷狗）。
     * 纯逻辑在 `pure/lyricOnline`、请求与降级在 `services/lyricSearch`，本方法只做**平台门控 + 接线真源**。
     * 🔴 **仅桌面端**：`nodeHttp` 依赖 Node 内置 `https`，移动端没有 ⇒ 直接返回空档（表单侧按钮也不出现，
     *    这里是第二道闸 —— 门控只写一边的话，将来别处调用会静默走 `requestUrl` 拿不到同款反爬头）。
     */
    async searchOnlineLyrics(title: string, author: string): Promise<LyricSearchOutcome> {
        if (!Platform.isDesktopApp) return { query: null, results: [] };
        return searchLyrics((url, headers) => nodeHttpGet(url, headers), title, author);
    }

    /** 取某源某条候选的歌词正文（#396；桌面端门控同上）。失败 ⇒ 由服务层收成 `error`，⛔ 不抛到这里 */
    async fetchOnlineLyric(source: LyricSourceId, id: string): Promise<LyricFetchOutcome> {
        if (!Platform.isDesktopApp) return { text: null, error: '仅桌面端支持' };
        return fetchLyric((url, headers) => nodeHttpGet(url, headers), source, id);
    }

    // ────────────────────────── ⑤-c 音乐下载（网易云免费通道）──────────────────────────

    /**
     * 打开「下载歌曲」弹窗。
     * 🔴 按钮的显隐由 `EntryForm` 按设置决定（`canDownload` = 桌面端 + 「启用内置音乐播放器」开，
     *    见 `modals/EntryModal`）；这里**再挡一次** —— 移动端没有 Node http，真放进来必然是一次失败。
     */
    openMusicDownloader(title: string, author: string, onPicked: (relPath: string) => void): void {
        if (!Platform.isDesktopApp) {
            new Notice('下载功能仅支持桌面端', 3000);
            return;
        }
        new MusicDownloadModal(
            this.app,
            {
                search: (keyword, onPartial, onEmpty) => this.dlSearchSongs(keyword, onPartial, onEmpty),
                loadPlaylists: (source, limit) => this.dlRecommendedPlaylists(source, limit),
                loadPlaylist: (source, id) => this.dlPlaylistSongs(source, id),
                download: (song, onProgress) => this.dlDownloadSong(song, onProgress),
                preview: (song, onProgress) => this.dlPreviewAudio(song, onProgress),
                biliSearch: (keyword) => this.dlBiliSearch(keyword),
                biliDownload: (video, onProgress) => this.dlBiliDownload(video, onProgress),
            },
            { title, author, onPicked },
        ).open();
    }

    /**
     * #419 建立 / **#428 换成 `CancelToken`**：当前网文下载的取消令牌。
     * 🔴 旧形态是 `{ stop: boolean }`、只被「下一章开头」读一次 ⇒ 用户在飞的请求上点取消
     *    **几十秒毫无反应**（实测「取消按钮点击无反应」）。令牌多了 `wait()`，在飞的等待由
     *    `raceCancel` 立刻唤醒（`pure/cancel` 文件头有完整起因）。
     */
    private novelCancel: CancelToken | null = null;

    /**
     * 打开「下载书籍」弹窗（#414 建立；#417 加「粘贴直链」；#419 加「书源检索」；
     * **#422 续四 删掉「粘贴直链」** —— 只剩书源这一条通道）。
     *
     * 🔴 网络与落盘全部收在这一处（弹窗与组件都是纯壳，便于替换 / 单测）：
     *  · 书源 → `searchNovelSources` / `fetchNovelToc` / `fetchNovelChapters`（**并发池 50**，#428 起；旧口径「串行 + 间隔」已推翻）+ TXT/EPUB 落盘。
     * 🔴 **红线 D-24(a)**：本插件**不内置任何书源**，只吃用户自己导入的 `.json`；
     *    `@js:` 脚本一律不执行；⛔ 别在这里接任何站点接口 —— 撤掉的东西有反向守卫钉着。
     * ⚠️ 移动端没有 Node http ⇒ 提前挡掉（与音乐下载同一口径）。
     * 🔴 #422：`kind` = **当前条目的书源分类**（网文 / 经典文学），决定这个弹窗**看得到哪些书源**、
     *    搜的时候用哪些源、以及就地导入导进哪一类 —— 它跟着入口走（表单按 `entry.bookKind`，
     *    命令面板按那条命令的名字），⛔ 不让用户在弹窗里再选一次（选完还要重搜，纯负担）。
     *    ⚠️ 刻意**不给默认值**：漏传 ⇒ 编译期就红，免得某个入口静默落到「网文」那一类。
     * 🔴 P1-C：`onPicked` 第二参 = 抓到的**章节名清单**（一行一章），消费端只对**文学**条目写回 `toc`
     *    （网文按用户 2026-09-13 裁定不带出版目录 ⇒ 判定放在表单侧，宿主不猜分类）。
     */
    /**
     * 🔴 #433：按类开**各自的窗口**（`NovelDownloadModal` / `LiteratureDownloadModal`）——
     *    用户：「和网文源窗口独立开，做独立文学类下载按钮和窗口」。
     *    ⛔ 别退回「一个窗口按 kind 变脸」：两个窗口同时开着时标题一样，用户分不清。
     */
    openBookDownloader(onPicked: (relPath: string, tocText?: string) => void, kind: SourceKind): void {
        if (!Platform.isDesktopApp) {
            new Notice('书籍下载仅支持桌面端', 3000);
            return;
        }
        // 🔴 #433：按类选**各自的**窗口壳 —— 标题与空态各说各的类，⛔ 不再一个窗口按 kind 变脸
        const DownloadModal = kind === 'novel' ? NovelDownloadModal : LiteratureDownloadModal;
        new DownloadModal(
            this.app,
            {
                // ⛔ #422 续四：原来这里还有一条 `download:`（把用户粘的直链交给服务层下载）——
                //    **整条直链通道已随用户裁定删除**（「粘贴直链功能删除掉」），⛔ 别只把它注释掉：
                //    通道、服务层、纯逻辑里的直链函数与它的断言都一起退了场（见断言脚本 `Y 反向守卫`）。
                // 🔴 红线 D-24(a) 不变：插件不内置任何内容源、不绕登录与付费 —— 现在只剩「书源」这一条
                //    **用户自备来源**的通道。
                // ── #419 网文面（全部经注入；组件不碰网络、不读 settings）──
                // 🔴 #422 续二 改口：`novelSources` **给全量**（每条带 `kind`），由组件自己按 `kind` 算本类。
                // 🔴 #439：组件侧口径跟着搜索侧一起**翻面** —— 不再是「本类为空 ⇒ 回退全部」，
                //    而是「本类为空 ⇒ 空态 + 一键把另一类搬过来」（见 `BookDownload.svelte` 的 `shown`）。
                //    ⛔ 别只改一侧：两处口径不一致就会出现「看得见搜不到」或反之。
                novelSources: () => (this.settings.novelSources ?? []).map(sourceSummary),
                novelSearch: (keyword, k, onPartial) => this.searchNovel(keyword, k, onPartial),
                novelToc: (hit) => this.loadNovelToc(hit),
                novelDownload: (req) => this.downloadNovelBook(req),
                // 🔴 #428：置位后**当帧**生效（在飞的请求由 `raceCancel` 立刻放行）——
                //    ⛔ 别改回「只改一个布尔、等下一章开头才发现」。
                novelCancel: () => this.novelCancel?.stop(),
                // #421：就地导入书源（与设置页共用同一实现；结果由面板显示，故 `notice: false`）
                // #425：组件自己读文件（`<label>`+`<input>` 必须挂调用方 DOM），宿主只负责解析合并
                novelImport: (text, k) => this.importNovelSources(text, k),
                // 🔴 #455：`novelMoveAll` 的注入**已撤** —— 弹窗只谈本类源（两类互不相通）。
                //    搬分类的能力留在设置页（`moveAllNovelSources` 仍被 `Settings.ts` 调用）。
            },
            { onPicked, kind },
        ).open();
    }

    /** 某一分类下的书源（⛔ 别到处直读 `settings.novelSources` 再自己判 —— 缺省口径在 `sourceKindOf` 里） */
    novelSourcesOf(kind: SourceKind): NovelSource[] {
        return (this.settings.novelSources ?? []).filter((s) => sourceKindOf(s) === kind);
    }

    /** 两个分类各有多少条（设置页小节徽标用；一次遍历出两数，⛔ 别分成两次 filter） */
    novelSourceCounts(): Record<SourceKind, number> {
        const g = groupSourcesByKind(this.settings.novelSources ?? []);
        return { novel: g.novel.length, book: g.book.length };
    }

    // ─────────────────────── #419 网文书源（书源由用户自备） ───────────────────────

    /**
     * 源站传输层（与其它下载面同一形状）。
     * ⚠️ 基础头（浏览器 UA）在这里叠；书源自己声明的 Cookie 由服务层叠（见 `withSourceHeaders`）。
     */
    private novelFetch(): NovelFetch {
        return async (req) => {
            const headers = { ...NOVEL_SOURCE_HEADERS, ...(req.headers ?? {}) };
            return req.method === 'POST'
                ? nodeHttpPost(req.url, req.body ?? '', headers)
                : nodeHttpGet(req.url, headers);
        };
    }

    /**
     * 导入用户自备的书源 `.json`（设置页调用）。
     * 🔴 同站点算**更新**（反复导入不会堆出一串同名源），且**保留用户自己的启用/停用选择**。
     * ⚠️ 被跳过的条目**逐条说原因**（⛔ 不静默丢 —— 否则用户会以为「我导了 11 条怎么只有 8 条」）。
     */
    /**
     * 书源导入的**落点**（#421 建立；**#425 起只收文本**）：解析 SoNovel 规则 → 合并 → 存设置 → 回报。
     *
     * 🔴 三个入口共用它：设置页「书籍源凭据」组里的**两个小节**（网络文学源 / 经典文学源）
     *    与**下载弹窗**书源面板里的导入按钮。
     * 🔴 #425 **挑文件那一步搬去了调用方**（设置页用 `services/filePick.mountFilePickLabel`，
     *    弹窗在 Svelte 模板里写 `<label>` + `<input type="file">`）——
     *    文件框必须挂在**调用方自己的 DOM 上**，宿主拿不到那个 DOM。
     *    在此之前是宿主自己弹框（JS 建 input → 挂进文档 → 用代码触发），而那条路在真实 Electron 里
     *    **点了没反应**（两轮都没根治）⇒ 整个方法随之退场。⛔ 说明里不写它俩的名字（注释会进产物）。
     * 🔴 #422：`kind` = 这批源归哪一类（按钮 / 弹窗当前分类给），一路传到 `mergeSources`。
     */
    importNovelSources(text: string, kind?: SourceKind): { ok: boolean; message: string } {
        try {
            const parsed = parseSourceJson(text);
            if (!parsed.sources.length && !parsed.rejected.length) return { ok: false, message: '这个文件里没有书源（要 SoNovel 格式的 .json）' };
            return this.mergeNovelSources(parsed.sources, kind, parsed.rejected.map((r) => `${r.name || `第 ${r.index} 条`}：${r.reason}`));
        } catch (e) {
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
    }

    /**
     * 把一批**已校验通过**的源并进设置（#432 甲：导入 / 订阅 / 粘贴三条路**共用这一处落库**）。
     *
     * 🔴 抽出来的理由：三条路的「怎么把源弄到手」各不相同，但「并进去」的语义必须**只有一个** ——
     *    各写一遍必然漂移（本仓「多个入口各写一套」栽过多次）。⛔ 别在调用方直接改 `settings.novelSources`。
     */
    mergeNovelSources(sources: readonly NovelSource[], kind?: SourceKind, skipReasons: readonly string[] = []): { ok: boolean; message: string } {
        if (!sources.length && !skipReasons.length) return { ok: false, message: '里面没有可用的书源' };
        const merged = mergeSources(this.settings.novelSources ?? [], sources, kind);
        this.settings.novelSources = merged.sources;
        void this.saveSettings();
        const bits = [`新增 ${merged.added} 条`, `更新 ${merged.updated} 条`];
        if (skipReasons.length) bits.push(`跳过 ${skipReasons.length} 条（${skipReasons[0]}）`);
        return { ok: true, message: `已导入：${bits.join('，')}` };
    }

    /**
     * #432 甲：把「**一段文本** 或 **一个地址**」变成「一批可用的源 + 跳过清单」。
     *
     * 两条入口共用（弹窗里粘什么都走这里）：
     *   · 看起来是 `http(s)://…` ⇒ 先**拉回来**再解析（订阅）；
     *   · 否则当**粘贴的 JSON 文本**（很多人是从网页上整段拷下来的）。
     *
     * 🔴 仓库清单（`form === 'manifest'`）要**第二步**：逐个拉清单里的源文件再解析 ——
     *    故这里可能出现两轮网络。⚠️ 全程可取消（`cancel` 一路传下去，取消**不算失败**，原样抛哨兵）。
     * ⚠️ 返回的 `skipped` 是**给人看的原因**（含 `.js` 踩红线、JSON 坏了、源体检不过），
     *    ⛔ 绝不静默丢 —— 用户必须知道「为什么订了 30 条却只进来 3 条」。
     */
    async resolveSourceInput(
        input: string,
        opts: { cancel?: CancelToken; onProgress?: (label: string) => void } = {},
    ): Promise<{ sources: NovelSource[]; skipped: SourcePackSkipped[]; packName: string }> {
        const raw = String(input ?? '').trim();
        if (!raw) return { sources: [], skipped: [], packName: '' };
        let text = raw;
        if (/^https?:\/\//i.test(raw)) {
            opts.onProgress?.('正在拉取清单…');
            const got = await fetchSourceText(raw, { cancel: opts.cancel });
            if (!got.ok) return { sources: [], skipped: [{ name: raw, reason: got.error ?? '拉取失败' }], packName: '' };
            text = got.text;
        }
        const pack = parseSourcePack(text);
        const sources: NovelSource[] = [...pack.sources];
        const skipped: SourcePackSkipped[] = [...pack.skipped];
        if (pack.form === 'manifest' && pack.entries.length) {
            opts.onProgress?.(`正在拉取 ${pack.entries.length} 个源文件…`);
            const texts = await fetchSourceTexts(
                pack.entries.map((e) => e.downloadUrl),
                { cancel: opts.cancel },
            );
            texts.forEach((r, i) => {
                const entry = pack.entries[i];
                if (!r.ok) {
                    skipped.push({ name: entry.name || entry.downloadUrl, reason: r.error ?? '拉取失败' });
                    return;
                }
                try {
                    const one = parseSourceJson(r.text);
                    if (!one.sources.length) {
                        skipped.push({ name: entry.name || entry.downloadUrl, reason: one.rejected[0]?.reason ?? '文件里没有可用的书源' });
                        return;
                    }
                    sources.push(...one.sources);
                } catch (e) {
                    skipped.push({ name: entry.name || entry.downloadUrl, reason: e instanceof Error ? e.message : String(e) });
                }
            });
        }
        return { sources, skipped, packName: pack.packName };
    }

    /**
     * #432 甲 · **一键体检**（决策 D-35(b)：每源**真搜一次**探针词）。
     *
     * 🔴 两条口径（都在 `pure/sourceCheck` 里钉着，此处只做接线）：
     *   · **「搜到 0 条」不算失败**（探针词不一定命中该书库）⇒ 请求成功即判可用；
     *   · 失败原因**先折人话**（`novelFailText`），原文留给 tooltip。
     * ⚠️ 只体检**本类**里**启用中**的源（按钮长在哪个小节就体检哪一类）—— ⛔ 别「顺手把另一类也体检了」。
     * ⚠️ 可取消：`raceCancel` 包住单源检索（掐不断 socket，但不再等它 —— 本仓 #428 口径）。
     */
    async checkNovelSources(
        kind: SourceKind,
        onOne?: (r: SourceCheckResult) => void,
        cancel?: CancelToken,
    ): Promise<SourceCheckResult[]> {
        if (!Platform.isDesktopApp) return [];
        const list = this.novelSourcesOf(kind).filter((s) => s.disabled !== true);
        if (!list.length) return [];
        const fetch = this.novelFetch();
        const out: SourceCheckResult[] = new Array(list.length);
        let cursor = 0;
        const worker = async (): Promise<void> => {
            for (;;) {
                if (cancel?.stopped) return;
                const i = cursor < list.length ? cursor++ : -1;
                if (i < 0) return;
                const src = list[i];
                const t0 = Date.now();
                let r: SourceCheckResult;
                try {
                    const res = await raceCancel(searchNovelSource(fetch, src, SOURCE_HEALTH_KEYWORD), cancel);
                    const err = 'error' in res ? res.error : undefined;
                    r = {
                        key: sourceKey(src),
                        name: String(src.name ?? '').trim() || '未命名书源',
                        kind,
                        ok: !err,
                        ms: Date.now() - t0,
                        count: res.hits?.length ?? 0,
                        ...(err ? { error: novelFailText(err), raw: err } : {}),
                    };
                } catch (e) {
                    if (e instanceof CancelledError) throw e;
                    const rawErr = e instanceof Error ? e.message : String(e);
                    r = { key: sourceKey(src), name: String(src.name ?? '').trim() || '未命名书源', kind, ok: false, ms: Date.now() - t0, count: 0, error: novelFailText(rawErr), raw: rawErr };
                }
                out[i] = r;
                onOne?.(r);
            }
        };
        await Promise.all(Array.from({ length: sourceCheckWorkers(list.length) }, () => worker()));
        return out;
    }

    /** 启用 / 停用一条书源（按站点键定位 —— 与导入合并用同一把钥匙） */
    setNovelSourceEnabled(key: string, enabled: boolean): void {
        const hit = (this.settings.novelSources ?? []).find((s) => sourceKey(s) === key);
        if (!hit) return;
        hit.disabled = !enabled;
        void this.saveSettings();
    }

    /**
     * 改一条书源的分类（#422：源行里那个「移到另一组」按钮）。
     * ⚠️ 按 `sourceKey` 定位（同名源时按名字会改错条）。
     */
    setNovelSourceKind(key: string, kind: SourceKind): void {
        const hit = (this.settings.novelSources ?? []).find((s) => sourceKey(s) === key);
        if (!hit || sourceKindOf(hit) === kind) return;
        hit.kind = kind;
        void this.saveSettings();
    }

    /**
     * 把某一类的书源**整批**改归另一类（#439）—— 源行那枚是单条，这条是整组。
     *
     * 缘起：`kind` 是**本地状态**、无法从内容反推，而一次误点的整批改分类写进 `data.json` 后
     * 只能逐条点回来（11 条 = 11 次）；更糟的是「本类为空」时那一组里**根本没有源行可点**
     * （用户当时看到的就是「换到网文条目里一条书源都看不见」）。
     *
     * ⚠️ 口径与 `setNovelSourceKind` 严格一致：**只动 `kind`**，`disabled` 等本地状态原样保留。
     * @returns 实际移动的条数；`0` = 那一类本来是空的（⛔ 调用方别报「已移动 0 条」这种假回执）
     */
    moveAllNovelSources(from: SourceKind, to: SourceKind): number {
        const moved = this.novelSourcesOf(from).length;
        if (moved === 0 || from === to) return 0;
        this.settings.novelSources = moveAllSourcesToKind(this.settings.novelSources ?? [], from, to);
        void this.saveSettings();
        return moved;
    }

    /** 删除一条书源 */
    removeNovelSource(key: string): void {
        const list = this.settings.novelSources ?? [];
        this.settings.novelSources = list.filter((s) => sourceKey(s) !== key);
        void this.saveSettings();
    }

    /**
     * 🔴 #457 C′：**就地改一条书源的 Cookie**（设置页源行下面那一行输入框）。
     *
     * ⚠️ 这是**用户自己填的凭据**（他自己登录之后复制来的），插件**不做登录流程、不存密码、
     *   不碰任何站点** —— 与导入书源时文件里自带的 `search.cookies` 是**同一个字段**
     *   （`services/novelSource.withSourceHeaders` 只是「按书源带上」）。
     * ⚠️ 清空 ⇒ 把字段**删掉**（而不是留空串），与「没填」严格等价。
     */
    setNovelSourceCookie(key: string, cookies: string): void {
        const hit = (this.settings.novelSources ?? []).find((s) => sourceKey(s) === key);
        if (!hit?.search) return; // 没写搜索段 ⇒ 无从挂 Cookie
        const v = cookies.trim();
        if (v) hit.search.cookies = v;
        else delete hit.search.cookies;
        void this.saveSettings();
    }

    // ⛔ 2026-09-29：「清空全部书源」的宿主方法 `clearNovelSources()` **已随设置页那个按钮一起删除**
    //    （用户：「太丑了，把清空全部按钮删除掉」）。⛔ 别只把它加回来当工具方法 —— 没有 UI 入口的写操作
    //    就是一条能被未来某个地方误调的空转通路；要恢复请连同设置页入口一起恢复。
    //    清空能力仍在：源行各自带删除（`removeNovelSource`，带二次确认）。

    /**
     * 多源搜索（渐进上报；只搜索用中的源）。
     * 🔴 #422：`kind` 决定**只**用哪一类的源。
     * 🔴🔴 #439 **翻面**：原来这里是「本类为空 ⇒ 回退到全部」（#422 续二的兜底），**已撤销**。
     *    那个兜底把「分类标错了」从**看不见**升级成**错着用** —— 用户实测：下文学时冒出 11 条网文源，
     *    而搜索结果是**不带任何提示**的（面板那行小字只在静态列表上有）⇒ 看起来就是「文学窗口在用网文源」。
     *    ✅ 现在本类为空就**返回空**，面板走**空态**（说清本类 0 条 / 你有 N 条在另一类 + 一键搬过来）。
     *    ⚠️ 兜底当年的初衷（「别让面板看着像书源全丢了」）由空态那段文字接手，⛔ 不是删掉了事。
     *    ⚠️ 组件侧 `BookDownload.svelte` 的 `shown` **同口径**（两处缺一即「看得见搜不到」或反之）。
     */
    async searchNovel(
        keyword: string,
        kind: SourceKind,
        onPartial?: (results: NovelSourceSearchResult[]) => void,
    ): Promise<NovelSourceSearchResult[]> {
        if (!Platform.isDesktopApp) return [];
        const sources = this.novelSourcesOf(kind);
        if (!sources.length) return [];
        return searchNovelSources(this.novelFetch(), sources, keyword, { onPartial });
    }

    /**
     * 取一本书的目录（弹窗选完结果后调）。
     * 🔴 #457 **文学源适配**：目录解析不出来时回退成「**整页一章**」（`fetchNovelTocOrWhole`），
     *    并把原失败原因放在 `note` ⇒ 弹窗要说清「没解析出目录、按整页下」，⛔ 不静默。
     */
    async loadNovelToc(hit: NovelSearchHit): Promise<{ items: NovelTocItem[]; error?: string; wholePage?: boolean; note?: string }> {
        const src = this.novelSourceByKey(hit.sourceUrl);
        if (!src) return { items: [], error: '这条书源已被删除或停用，请重新搜索' };
        return fetchNovelTocOrWhole(this.novelFetch(), src, hit);
    }

    /**
     * 按站点键定位书源。
     * 🔴 必须按 **`sourceKey`（站点地址）** 找，⛔ 别按名称 —— 两个源同名时就会下到另一个源的书。
     */
    private novelSourceByKey(key: string) {
        return (this.settings.novelSources ?? []).find((s) => sourceKey(s) === key);
    }

    /**
     * EPUB 的 identifier 用真 uuid（有就取，没有就给空串让 `pure/epubPack` 走「书名+作者」派生）。
     * ⚠️ 只在能拿到时用真值：派生那个**不保证全局唯一**，但同一本书稳定 ⇒ 重复下载不会产出
     *    「同一本书两个 identifier」的怪情况。
     */
    private novelUuid(): string {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
        return c && typeof c.randomUUID === 'function' ? c.randomUUID() : '';
    }

    /**
     * 按书源抓完整本并落成 **TXT**（P1-A 只做 TXT，EPUB 排在 P1-B）。
     *
     * 🔴 三条：
     *  ⑴ 目录 → 截取用户选的章节区间 → **并发池**抓章（`NOVEL_CHAPTER_CONCURRENCY`，⚠️ #428 推翻了旧的「串行 + 间隔」）；
     *  ② 单章失败**不中断**：成品里跳过那一章，并在回执里点名（⛔ 不假装成功）；
     *  ③ 落盘经 `downloadRelPath`（**重名去重**，与其它下载面同一份口径）+ `writeBinaryFile`。
     * 🔴 **P1-C 断点续传（自动，无新 UI）**：同一本书 / 同一格式 / **同一份目录**再次下载时，
     *    上次抓到的章直接从存档复用（`{libraryDir}/下载续传/*.ndjson`），只补没抓到的；
     *    全部抓完即删档。目录变了（书源改版）⇒ 存档作废、从头下，并在回执里**明说**。
     * 🔴🔴 **#428 取消 = 不落盘**（用户实测：「取消点不动、我点了叉才退出但能保存」）：
     *    取消 ⇒ 抓章层抛 `CancelledError` ⇒ 这里**直接返回、⛔ 不合成也不写文件**；
     *    ⚠️ 但**续传档一律留着**（已抓到的章是用户的心血，下次自动接着下 —— 取消不是「白抓」）。
     */
    async downloadNovelBook(req: {
        hit: NovelSearchHit;
        /** 1 起的章节序号（含） */
        from: number;
        /** 1 起的章节序号（含） */
        to: number;
        /** 成品格式（#420 P1-B 起支持 EPUB） */
        format: 'txt' | 'epub';
        onProgress: (done: number, total: number, failed: number) => void;
    }): Promise<{ ok: boolean; message: string; relPath?: string; tocText?: string; cancelled?: boolean }> {
        const src = this.novelSourceByKey(req.hit.sourceUrl);
        if (!src) return { ok: false, message: '这条书源已被删除或停用，请重新搜索' };
        const token = createCancelToken();
        this.novelCancel = token;
        // 取消收尾要用到的两件（都在 try 里赋值 ⇒ 必须先声明在 try 外）：
        //  · `appendChain`：**必须 await 完**再返回，否则最后几章还在往存档写的路上就被丢下了；
        //  · `keptChapters`：回执里告诉用户「留住了几章」，⛔ 别只说一句「已取消」让他以为白抓。
        let appendChain: Promise<void> = Promise.resolve();
        let keptChapters = 0;
        try {
            // 🔴 #457：与「取目录」**同一个回退**（整页一章）—— 否则会出现「目录面板看得见、下载却报错」
            const toc = await fetchNovelTocOrWhole(this.novelFetch(), src, req.hit);
            if (toc.error) return { ok: false, message: toc.error };
            const from = Math.max(1, Math.min(Math.floor(req.from) || 1, toc.items.length));
            const to = Math.max(from, Math.min(Math.floor(req.to) || toc.items.length, toc.items.length));
            const slice = toc.items.slice(from - 1, to);

            // ── 续传存档：先看上次下到哪（⛔ 目录对不上就不认，见 pure/chapterPlan 文件头）──
            const plan = { sourceKey: sourceKey(src), bookUrl: req.hit.bookUrl, format: req.format, tocKey: chaptersFingerprint(toc.items) };
            const planPath = resumePath(this.settings.libraryDir, resumeFileName({
                title: req.hit.title,
                sourceKey: plan.sourceKey,
                bookUrl: plan.bookUrl,
                format: plan.format,
            }));
            const prev = await this.readResumePlan(planPath);
            let resumeFrom: ResumeChapter[] = [];
            let staleNote = '';
            if (prev.meta && resumeMatches(prev.meta, plan)) {
                resumeFrom = prev.chapters;
            } else if (prev.meta || prev.chapters.length) {
                // 目录变了 / 站点或书名对不上 / 只有章没有元信息（坏档）⇒ 一律丢弃，⛔ 绝不混拼
                if (prev.chapters.length) staleNote = `上次的续传存档与这次的目录对不上（${prev.chapters.length} 章），已丢弃并从头下载。`;
                await this.dropResumePlan(planPath);
            }
            await this.startResumePlan(planPath, { ...plan, title: req.hit.title, author: req.hit.author, updatedAt: new Date().toISOString() });
            // 已落档的章号：续传复用过来的先记上，避免 onCheckpoint 把它们再 append 一遍
            const appended = new Set<number>(resumeFrom.map((c) => c.no));
            keptChapters = appended.size;

            let reused = 0;
            const tasks = await fetchNovelChapters(this.novelFetch(), src, slice, {
                onProgress: req.onProgress,
                // 🔴 #428：令牌取代了旧的 `shouldStop`（旧形态只能「下一章开头问一句」⇒ 点了没反应）
                cancel: token,
                resume: resumeFrom,
                onResume: (n) => (reused = n),
                // 抓完一章 append 一行；**串起来写**（并发 append 会让行序错乱，续传时章序就乱了）
                onCheckpoint: (all) => {
                    const fresh = all.filter((t) => t.state === 'done' && String(t.text ?? '').trim() && !appended.has(t.no));
                    if (!fresh.length) return;
                    for (const t of fresh) appended.add(t.no);
                    keptChapters = appended.size;
                    appendChain = appendChain
                        .then(async () => {
                            for (const t of fresh) await this.appendResumeChapter(planPath, { no: t.no, title: t.title, text: t.text ?? '' });
                        })
                        .catch(() => { /* 落档失败不阻断下载：那一章下次重抓，不是丢数据 */ });
                },
            });
            await appendChain;

            const doneCount = tasks.filter((t) => t.state === 'done').length;
            // 全抓完 ⇒ 存档使命完成（留着只会占地方）；一章都没抓到 ⇒ 也别留个空档
            if (doneCount === tasks.length || doneCount === 0) await this.dropResumePlan(planPath);

            const meta = { title: req.hit.title, author: req.hit.author, sourceName: src.name };
            const chapters = tasks.map((t) => ({ no: t.no, title: t.title, text: t.text ?? '' }));
            // EPUB 走 jszip（`mimetype` 首条且 STORED 由 `epubFileList` 定序、`zipEpub` 打完自检）；TXT 直接编码
            const bytes =
                req.format === 'epub'
                    ? await zipEpub(epubFileList(meta, chapters, { modified: isoUtc(new Date()), uuid: this.novelUuid() }))
                    : new TextEncoder().encode(buildNovelTxt(meta, chapters));
            const sizeIssue = downloadSizeIssue(bytes.byteLength);
            if (sizeIssue) return { ok: false, message: staleNote + sizeIssue };
            const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
            const relPath = downloadRelPath({
                kind: 'book',
                filename: novelBookFilename(meta, req.format),
                // 🔴 #425：书籍走**自己的**目录（在此之前是复用 `musicDownloadDir` —— 两类文件挤一个根下）
                root: this.settings.bookDownloadDir,
                taken,
            });
            await this.writeBinaryFile(relPath, bytes);
            const failedText = failedChaptersText(tasks);
            const resumeText = reused > 0 ? `，其中 ${reused} 章是上次续传复用` : '';
            const head = `已下载到「${relPath}」（${doneCount} / ${slice.length} 章，${req.format.toUpperCase()}${resumeText}）`;
            // 🔴 章节名回传（`tocText`）：宿主**不判分类**（写不写回由表单侧决定 —— 它才知道 `bookKind`）。
            // 🔴 #431：**只回传前 10 章 + `....`**（用户：「只显示前 10 章加个 `....` 来显示」）——
            //    长篇 2000+ 章全塞进条目用户不会看，还会被原样渲染进笔记的 `## 目录` 小节。
            //    裁断的真源在 `pure/novelPack.novelTocPreview`，⛔ 别在这里内联 slice。
            const tocText = novelTocPreview(tasks.filter((t) => t.state === 'done').map((t) => t.title));
            return {
                ok: true,
                message: `${staleNote}${failedText ? `${head}。${failedText}` : head}`,
                relPath,
                tocText: tocText || undefined,
            };
        } catch (e) {
            // 🔴 #428 取消：**什么都不落盘**（这是「取消」的全部意义）—— 但续传档留着，
            //    已抓到的章下次自动复用 ⇒ 取消不等于白抓。
            if (e instanceof CancelledError) {
                await appendChain; // 等最后几章写完再回话，⛔ 别让它们落在用户看不到的身后
                return {
                    ok: false,
                    cancelled: true,
                    message: keptChapters > 0
                        ? `已取消（未保存文件）。已抓到的 ${keptChapters} 章留在续传存档里 —— 再次下载同一本书会接着下。`
                        : '已取消（未保存文件）。这次没抓到任何一章。',
                };
            }
            // ⚠️ 这里**故意不删续传档**：抛错也可能发生在「章都抓完了、合成或自检才失败」之后
            //    （EPUB 字节自检不达标就是一条）—— 那批章是用户几十分钟的成果，删了就得整本重下。
            //    真下完 / 一章都没抓到这两种收场由上面那处显式删档负责。
            return { ok: false, message: e instanceof Error ? e.message : String(e) };
        } finally {
            this.novelCancel = null;
        }
    }

    // ── 续传存档的读写（IO 薄层；schema / 容错全在 `pure/chapterPlan`）──────────────────────────
    // 🔴 **一条铁律：续传档只许「首行元信息 + 逐章 append」，⛔ 不许整档重写** ——
    //    重写要先把十几 MB 的正文全序列化一遍（长书下每秒一次卡顿），而且崩在写一半就整档废了。

    /** 读续传档（文件不存在 / 读不出来 ⇒ 当没有；⛔ 不抛） */
    private async readResumePlan(path: string): Promise<{ meta: ResumeMeta | null; chapters: ResumeChapter[] }> {
        try {
            return parseResume(await this.app.vault.adapter.read(normalizePath(path)));
        } catch {
            return { meta: null, chapters: [] };
        }
    }

    /**
     * 建续传档（**已经有了就一个字节都不动** —— 覆盖 = 把用户上次抓的章全抹掉）。
     * ⚠️ 落档失败**不阻断下载**：续传是「锦上添花」，不能因为它挂了就下不了书。
     */
    private async startResumePlan(path: string, meta: Omit<ResumeMeta, 'v' | 'kind'>): Promise<void> {
        const p = normalizePath(path);
        try {
            // 🔴 判据用 **adapter.exists 而不是 vault 索引** —— 索引没跟上（刚建 / 外部同步进来）时
            //    `getAbstractFileByPath` 会回 null，那时写下去就是把用户上次抓的章**整档抹掉**。
            if (await this.app.vault.adapter.exists(p)) return;
            await this.ensureFolder(resumeDir(this.settings.libraryDir));
            await this.app.vault.adapter.write(p, resumeMetaLine(meta));
        } catch { /* 见上：不阻断下载 */ }
    }

    /** 追加一章（调用方已保证「先建档」且**串行**调用） */
    private async appendResumeChapter(path: string, ch: ResumeChapter): Promise<void> {
        try {
            await this.app.vault.adapter.append(normalizePath(path), resumeChapterLine(ch));
        } catch { /* 见上：不阻断下载 */ }
    }

    /** 删续传档（下完 / 全废 / 目录变了；不存在也算成功） */
    private async dropResumePlan(path: string): Promise<void> {
        try {
            const p = normalizePath(path);
            const f = this.app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) await this.app.vault.delete(f);
        } catch { /* 删不掉就留着，下次仍会被目录指纹拦下 */ }
    }

    /**
     * 下载面传输层（#399-D）：四平台全部经 `services/nodeHttp`（Node 原生 https，能过平台反爬）。
     * 🔴 只在桌面端可用；移动端由各门面提前返回（见下面的 `Platform.isDesktopApp` 守卫）。
     */
    private dlTransport(): DlTransport {
        return {
            get: (url, headers) => nodeHttpGet(url, headers),
            post: (url, body, headers) => nodeHttpPost(url, body, headers),
            getBuffer: (url, headers) => nodeHttpGetBuffer(url, headers),
        };
    }

    /**
     * 四平台搜索（#399-D）：任一平台先回来就先回调（渐进渲染），全部失败时 `onEmpty(true)`。
     * ⛔ 只桌面端 —— 移动端没有 Node http，真放进来必然是一次失败。
     */
    async dlSearchSongs(
        keyword: string,
        onPartial?: (songs: DownloadSong[]) => void,
        onEmpty?: (networkError: boolean) => void,
    ): Promise<{ songs: DownloadSong[]; failedSources: PlaylistSource[] }> {
        if (!Platform.isDesktopApp) return { songs: [], failedSources: [] };
        // 🔴 #405：搜索结果的平台顺序用 **`DL_SEARCH_ORDER`（酷我优先）**，⛔ 不是 `DL_PLATFORMS`
        //    （后者是胶囊 / 设置页的平台清单顺序，用户没要求改那个）。
        return dlSearch(this.dlTransport(), keyword, { onPartial, onEmpty, order: [...DL_SEARCH_ORDER] });
    }

    /** 四平台推荐歌单（网易云复用本仓既有免密端点；QQ/酷狗/酷我走各自公开接口） */
    async dlRecommendedPlaylists(
        source: PlaylistSource,
        limit?: number,
    ): Promise<{ playlists: RecommendedPlaylist[]; error?: string }> {
        if (!Platform.isDesktopApp) return { playlists: [], error: '仅桌面端支持' };
        return dlRecommendedPlaylists(this.dlTransport(), source, limit);
    }

    /** 四平台歌单曲目 */
    async dlPlaylistSongs(
        source: PlaylistSource,
        id: string,
    ): Promise<{ songs: DownloadSong[]; error?: string }> {
        if (!Platform.isDesktopApp) return { songs: [], error: '仅桌面端支持' };
        return dlPlaylistSongs(this.dlTransport(), source, id);
    }

    /**
     * 四平台下载一首歌到库内（含网易云 VIP / QQ Cookie 链路）。
     * 🔴 `taken` = **当前库内全部相对路径**（`pure/downloadPlan` 的重名去重依据）—— 下载是低频操作，现取即可。
     * ⛔ **不内嵌任何音频标签**（用户 2026-09-28 明确不做那套）。
     */
    async dlDownloadSong(
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ): Promise<{ ok: boolean; message: string; relPath?: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '下载功能仅支持桌面端' };
        const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
        return dlDownloadSong(
            this.dlTransport(),
            song,
            {
                cookies: this.settings.musicDlCookies ?? {},
                target: {
                    root: this.settings.musicDownloadDir,
                    taken,
                    write: (relPath, data) => this.writeBinaryFile(relPath, data),
                },
            },
            onProgress,
        );
    }

    /**
     * 试听某首曲目（2026-09-28 #400）：取**标准档**音频字节（不写盘），由弹窗转 Blob 播放。
     * 链路顺序与下载完全一致（同一处 `resolveAudio`）⇒ 「能下不能听」不会出现。
     * 🔴 缓存**仅本会话有效**（服务层模块内 Map，重启即清）：用户明确「不做设置页试听缓存删除」
     *    ⇒ ⛔ 别为它加设置项 / 清缓存按钮 / 磁盘缓存。
     */
    async dlPreviewAudio(
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ): Promise<DlPreviewResult> {
        if (!Platform.isDesktopApp) return { ok: false, message: '试听功能仅支持桌面端' };
        return dlPreviewAudio(this.dlTransport(), song, { cookies: this.settings.musicDlCookies ?? {} }, onProgress);
    }

    /** 平台连通性测试（设置页「测试连接」四态文案；`source` 传平台 id 字符串） */
    async dlTestConnection(source: string, cookie: string): Promise<{ ok: boolean; message: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '仅桌面端支持' };
        return dlTestConnection(this.dlTransport(), source, cookie);
    }

    /**
     * B 站视频搜索（#496）：两步请求（先取 `buvid3` 再搜），形态与失败文案全在
     * `services/dl/bilibili` + `pure/dl/bilibili`。⛔ 只桌面端（移动端没有 Node http）。
     */
    async dlBiliSearch(keyword: string): Promise<{ videos: BiliVideo[]; error?: string }> {
        if (!Platform.isDesktopApp) return { videos: [], error: '仅桌面端支持' };
        return dlBiliSearch(this.dlTransport(), keyword);
    }

    /**
     * B 站取**分P 列表**（#505：把「一个 52 集的长篇」一次填完的前提）。
     * 🔴 与 `dlBiliSearch` 同一条纪律：只桌面端、共用 `buvid3` 缓存、失败重取一次再报原因；
     *    ⛔ 只**取列表**，不下载（下载是音乐下载弹窗那条路的职责）。
     */
    async dlBiliView(bvid: string): Promise<{ title: string; parts: BiliPart[]; error?: string }> {
        if (!Platform.isDesktopApp) return { title: '', parts: [], error: '仅桌面端支持' };
        return dlBiliView(this.dlTransport(), bvid);
    }

    /**
     * B站视频 → 音频（mp3）下载并落库（#496）。
     * 🔴 落盘口径与四平台**完全一致**：`downloadRelPath`（命名 / 净化 / 重名 `(2)(3)`）+ `writeBinaryFile`。
     *    区别只在「字节从哪来」—— 这里是 yt-dlp 抓到 `os.tmpdir()` 的临时目录里再读回来
     *    （临时目录由 `services/ytdlp` 自己清理，⛔ 不会在库里留半截文件）。
     * ⚠️ `ytdlpPath` **留空是合法值**（= 走系统 PATH），⛔ 别在这里兜底成 `'yt-dlp'`
     *    —— 候选名按平台生成，见 `pure/ytdlp.ytdlpExeCandidates`。
     */
    async dlBiliDownload(
        video: BiliVideo,
        onProgress?: DownloadProgressCallback,
    ): Promise<{ ok: boolean; message: string; relPath?: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '下载功能仅支持桌面端' };
        const r = await fetchBiliAudioWithYtDlp(defaultYtDlpDeps(), {
            exe: this.settings.ytdlpPath ?? '',
            url: video?.webUrl ?? '',
            onProgress,
        });
        if (!r.ok || !r.data) return { ok: false, message: r.message };
        const sizeIssue = downloadSizeIssue(r.data.byteLength);
        if (sizeIssue) return { ok: false, message: sizeIssue };
        try {
            const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
            const ext = r.ext || 'mp3';
            const relPath = downloadRelPath({
                kind: 'music',
                filename: buildSongFilename(video.author, video.title, ext),
                root: this.settings.musicDownloadDir,
                taken,
            });
            await this.writeBinaryFile(relPath, r.data);
            const mb = (r.data.byteLength / 1024 / 1024).toFixed(2);
            return { ok: true, message: `已下载 ${mb}MB：${relPath}（B站 · ${ext}）`, relPath };
        } catch (e) {
            return { ok: false, message: `写入失败：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    /**
     * 列出**库内可关联的书籍文件**（#417：书籍「书籍文件」浮层那枚 🔍 的数据源）。
     *
     * 🔴 扩展名白名单真源 = `pure/downloadPlan.DOWNLOAD_EXT_WHITELIST.book`（经 `isAssociableBookPath`）
     *    —— 与「书籍文件」字段能接受的文件同源，⛔ 不另列一份名单。
     * 🔴 **#426 起只扫「书籍文件目录」**（用户原话：「检索限定到新目录」）—— 与音频那侧同款：
     *    目录真源 = `downloadDir(settings.bookDownloadDir, 'book')`，与**落盘用的是同一个函数**
     *    ⇒ ⛔ 别在这里另拼一份路径（否则用户改完「书籍文件目录」，这里立刻找不到东西）。
     * ⚠️ 此前是**全库扫**（旧口径「用户可能把书放自己建的文件夹里」）—— 已被用户推翻，⛔ 别改回去。
     */
    listLibraryBookFiles(): LibraryBookFile[] {
        const prefix = `${downloadDir(this.settings.bookDownloadDir, 'book')}/`;
        return this.app.vault
            .getFiles()
            .filter((f) => f.path.startsWith(prefix) && isAssociableBookPath(f.path))
            .map((f) => ({ path: f.path, name: f.name }));
    }

    /**
     * 列出**库内音乐目录**下的音频文件（#404：本地音频浮层那枚「检索同名音频」小按钮的数据源）。
     *
     * 🔴 目录真源 = `pure/downloadPlan.downloadDir(settings.musicDownloadDir, 'music')`
     *    （默认 `下载/音乐`；与下载落盘用的是**同一个函数** ⇒ ⛔ 别在这里另拼一份路径，
     *    否则用户改了「音乐下载路径目录」后这里就找不到东西了）。
     * 🔴 扩展名按 `isAssociableAudioPath`（= `AUDIO_ASSOCIABLE_EXTENSIONS`）过滤 ——
     *    与「本地音频」字段能接受的文件同源，⛔ 不另列一份白名单。
     * ⚠️ 只扫**该目录下**（含子目录）：库内别处的音频不算「音乐目录里的」。
     */
    listLibraryAudioFiles(): LibraryAudioFile[] {
        const prefix = `${downloadDir(this.settings.musicDownloadDir, 'music')}/`;
        return this.app.vault
            .getFiles()
            .filter((f) => f.path.startsWith(prefix) && isAssociableAudioPath(f.path))
            .map((f) => ({ path: f.path, name: f.name }));
    }

    /**
     * #497 音乐条目「改关联的音频文件的名字」（用户：「再添加在音乐条目上修改关联的音频文件名称的功能」）。
     *
     * 纯逻辑（拆分 / 校验 / 目标 `.lrc` 路径）全在 `pure/renameAudio.planAudioRename`，本方法只做**它碰不到的事**：
     *  ⑴ **库内 / 库外分流**（判定与 `resolveEmbedUrl` / `absoluteMediaPath` 同源：先按库内相对试，不成当绝对）
     *  ⑵ 物理改名 —— 库内 `vault.rename`（顺带把**全库指向它的 wikilink 一起更新**，这是白捡的：
     *     笔记 ` ```lrc ` 块的 `source [[…]]` 正好是 wikilink）；库外 `fs.rename`（**桌面端门控**）
     *  ⑶ **同名 `.lrc` 一起改** —— 「同名 .lrc」是四路歌词来源之一，音频改名而歌词不改 ⇒ 歌词**静默失效**
     *  ⑷ 回写 catalog 的 `audioPath`（含**其它共用同一文件的条目**）+ 未被外部改过时重生成笔记
     *
     * 🔴 **重名即拒**（不覆盖、不自动加 `(2)`）：改名是用户主动指定名字，静默改写成别的名字比失败更糟；
     *    而覆盖已存在文件 = **直接毁掉用户另一个文件**。
     * 🔴 **物理改名在前、写库在后**：反过来的话，写库成功而改名失败会留下一个指向不存在文件的条目
     *    （播放按钮点了没反应，是最难查的那种）；现在最坏只是「文件改了名、条目还指旧路径」，
     *    用户重选一次即可，文件本身没丢。
     *
     * @param entryId 编辑态条目 id（新增态传 `null` —— 那时还没有条目可写，只改文件与表单）
     * @param currentPath 表单「文件路径」里的当前值（可能尚未保存，所以**不能**拿 catalog 的值代替）
     * @param newStem 新主名（扩展名由纯模块锁死，⛔ 不接受整名）
     */
    async renameEntryAudio(
        entryId: string | null,
        currentPath: string,
        newStem: string,
    ): Promise<{ ok: boolean; message: string; path?: string }> {
        const planned = planAudioRename(currentPath, newStem);
        if ('issue' in planned) return { ok: false, message: planned.issue };
        const plan = planned.plan;

        const fromFile = this.vaultFileOf(plan.from);
        let lrcNote = '';
        if (fromFile) {
            const target = normalizePath(plan.to);
            if (this.app.vault.getAbstractFileByPath(target)) {
                return { ok: false, message: `「${plan.toName}」已经存在，换个名字` };
            }
            await this.app.vault.rename(fromFile, target);
            lrcNote = await this.renameSiblingLrc(plan.lrcFrom, plan.lrcTo);
        } else {
            if (!Platform.isDesktopApp) return { ok: false, message: '库外文件改名仅桌面端支持' };
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                if (!(await this.pathExists(plan.from))) {
                    return { ok: false, message: `找不到这个文件：${plan.from}（路径可能已变，或它不在本机）` };
                }
                if (await this.pathExists(plan.to)) {
                    return { ok: false, message: `「${plan.toName}」已经存在，换个名字` };
                }
                await fs.rename(plan.from, plan.to);
            } catch (e) {
                return { ok: false, message: `改名失败：${e instanceof Error ? e.message : String(e)}` };
            }
            lrcNote = await this.renameSiblingLrc(plan.lrcFrom, plan.lrcTo);
        }

        // ④ 回写条目（含**共用同一文件的其它条目** —— 漏掉它们 = 那条的播放按钮静默失效）
        //    ⚠️ 新增态（`entryId` 为 null）同样要跑这一段：表单上的路径可能正是**别的条目**在用的文件。
        let touched = 0;
        try {
            const all = await this.service.list();
            const ids = all.filter((e) => e.audioPath === plan.from).map((e) => e.id);
            if (entryId && !ids.includes(entryId)) ids.push(entryId);
            for (const id of ids) {
                await this.service.update(id, { audioPath: plan.to });
                // 笔记里 `source` 行是按 audioPath 生成的 ⇒ 未被外部改过时重生成
                //（库内那支的 wikilink 已被 `vault.rename` 顺手更新，这里既是兜底、也是库外路径的唯一出路）
                if (!(await this.service.noteWasExternallyModified(id))) await this.service.writeNote(id);
                touched++;
            }
        } catch (e) {
            new Notice(`文件已改名为「${plan.toName}」，但写回条目失败：${e instanceof Error ? e.message : String(e)}`, 6000);
            await this.refreshViews();
            return { ok: true, message: `已改名为「${plan.toName}」`, path: plan.to };
        }
        await this.refreshViews();
        const extra = touched > 1 ? `（同时更新了 ${touched} 个条目）` : '';
        return { ok: true, message: `已改名为「${plan.toName}」${extra}${lrcNote}`, path: plan.to };
    }

    /** 该路径对应的**库内**文件（不是库内文件 ⇒ `null`）。判定与 `resolveEmbedUrl` 同源，⛔ 别用盘符前缀猜 */
    private vaultFileOf(path: string): TFile | null {
        try {
            const f = this.app.vault.getAbstractFileByPath(this.toVaultRelPath(String(path ?? '').trim()));
            return f instanceof TFile ? f : null;
        } catch {
            return null;
        }
    }

    /** 库外绝对路径是否存在（桌面端；模块加载失败 / 无权限 ⇒ `false`） */
    private async pathExists(p: string): Promise<boolean> {
        if (!Platform.isDesktopApp) return false;
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            await fs.stat(p);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 把与音频同名的 `.lrc` 一起改名（#497）。返回**追加到回执后面的一句话**（无歌词文件 ⇒ 空串）。
     * 🔴 目标已存在 ⇒ **只跳过 lrc、不改音频的结论** —— 覆盖会把用户另一个歌词文件毁掉。
     * ⚠️ 路径真源是 `pure/lrcSource.siblingLrcPath`（由纯模块算好传进来），⛔ 不在这里手拼 `.lrc`。
     */
    private async renameSiblingLrc(from: string | null, to: string | null): Promise<string> {
        if (!from || !to || from === to) return '';
        const f = this.vaultFileOf(from);
        if (f) {
            const target = normalizePath(to);
            if (this.app.vault.getAbstractFileByPath(target)) return '；同名歌词文件已存在，未改动';
            try {
                await this.app.vault.rename(f, target);
                return '；同名歌词文件已一起改名';
            } catch {
                return '；同名歌词文件未能改名';
            }
        }
        if (!(await this.pathExists(from))) return ''; // 没有同名歌词文件：什么都不说
        if (await this.pathExists(to)) return '；同名歌词文件已存在，未改动';
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            await fs.rename(from, to);
            return '；同名歌词文件已一起改名';
        } catch {
            return '；同名歌词文件未能改名';
        }
    }

    /**
     * 写库内二进制文件（⑤-c）。🔴 两个坑：
     *  ⑴ Obsidian 的 `vault.create*` **都不自动建父目录** ⇒ 逐层补
     *     （`services/vaultIO` 里那段同名逻辑只服务**文本**写，⛔ 别指望它）；
     *  ⑵ `Uint8Array.buffer` 可能只是底层 `ArrayBuffer` 的一个**视图**（`byteOffset ≠ 0`）——
     *     直接用 `.buffer` 会把**整个底层缓冲**写进去（文件莫名变大、尾部混进别的数据）
     *     ⇒ 必须按 `byteOffset / byteLength` 切出真正属于这段数据的区间。
     */
    private async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
        const p = normalizePath(relPath);
        const segments = p.split('/');
        let cur = '';
        for (const seg of segments.slice(0, -1)) {
            cur = cur ? `${cur}/${seg}` : seg;
            if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
        }
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const existing = this.app.vault.getAbstractFileByPath(p);
        if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buf);
        else await this.app.vault.createBinary(p, buf);
    }

    /** 音频播放器的模式 / 音量写回设置（append-only 字段；落盘失败静默 —— 本次会话已生效） */
    private async persistAudioSetting(key: 'mode' | 'volume', value: number | string): Promise<void> {
        if (key === 'mode') this.settings.audioPlayMode = normalizeAudioPlayMode(value);
        // 🔴 音量标度是 0–2（200%，>1 走增益）：⛔ 别用 `clampVolume`（0..1）—— 那会把 150% 静默压回 100%
        else this.settings.audioVolume = clampAudioVolume(value);
        try {
            await this.saveSettings();
        } catch {
            /* 落盘失败不影响本次会话已生效的值 */
        }
    }

    /**
     * 播放器互斥：某一路起播 ⇒ 暂停**其余**路（真源 `pure/audioQueue.playersToPause`）。
     * 🔴两路都要在这里处理（音频 ↔ 视频是**双向**的）：只写一侧的后果，是另一侧起播时
     * 这一路**继续响** —— 而 UI-GUIDE **§15.5 F** 的口径是「同一时刻只允许一路在响」。
     * 新增第三路时**只改这一处**，⛔ 别在音频与视频两侧各写一遍「另一个是谁」——那样两边会漂。
     */
    private pauseOtherPlayers(starting: PlayerKind): void {
        const others = playersToPause(starting);
        if (others.includes('video')) {
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView) view.pauseForOtherPlayer();
            }
        }
        if (others.includes('audio')) {
            for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof AudioPlayerView) view.pausePlayback();
            }
        }
    }

    /**
     * 笔记内 ` ```lrc ` 块 → 内联播放器（④-4 / D-8(c)：**接管但默认关**）。
     * 开关 = 「启用内置音乐播放器」（`settings.audioInlinePlayer`，基本设置 · 实验性功能）。
     * 🔴 2026-09-27 #399：它同时是**歌曲下载按钮**的门控（用户：「开启后始终有 LRC 显示播放器、
     *    下载歌曲功能，关闭后不显示下载按钮」）⇒ ⛔ 别再拆出第二个开关。
     * 两层让位：⑴ 设置关（缺省）⇒ 不接管，笔记外观与升级前完全一致；
     *          ⑵ 检测到 LyricFlux 启用 ⇒ 仍不接管（它也注册同名块处理器，两边都画就是两个播放器叠在一起）。
     *
     * 🔴 **第 ⑵ 层让位必须判在 `registerMarkdownCodeBlockProcessor(...)` **之前**，
     *  ⛔ 不能只写在回调里** —— Obsidian 的语言表是 **全局静态** 的（`AW.codeBlockPostProcessors`，
     *  见 `registerCodeBlockPostProcessor`：`if (n.hasOwnProperty(e)) throw new Error(...)`），
     *  同一语言 **重复注册直接抛错**，而调用点就在 `onload` ⇒ **整个插件加载失败**（#390 实测：
     *  `Error: Code block postprocessor for language lrc is already registered`）。
     *  ⚠️ 回调里那层只能防「两个播放器叠着画」，**防不住「插件起不来」**；两处都要有，但顺序不能反。
     */
    private registerLrcBlockProcessor(): void {
        if (this.isLyricFluxEnabled()) return;
        try {
            this.registerMarkdownCodeBlockProcessor('lrc', (source, el, ctx) => {
                if (this.settings.audioInlinePlayer !== true) return;
                ctx.addChild(
                    new AudioInlineBlock(el, () => this.audioOptionsForNote(ctx.sourcePath, source)),
                );
            });
        } catch (e) {
            // 兜底：占住 `lrc` 的**不止 LyricFlux**（`lyricflow` / `lyricflux` 等同族插件都可能）
            // ⇒ 让位，⛔ 绝不把 `onload` 带崩（那等于整个插件不可用）。
            console.warn('[ReelLudic] lrc 代码块已被其它插件接管，内置内联播放器让位：', e);
        }
    }

    /**
     * 笔记内 lrc 块的播放选项：队列**只有这一首**（笔记里的块指向一个音频）。
     * 音频解析不出来时不抛错，而是回一个空队列 —— 装配层会用空态说明原因（⛔ 不静默吞掉整块）。
     */
    private async audioOptionsForNote(notePath: string, source: string): Promise<AudioPlayerOptions> {
        const block = parseLrcBlock(source);
        const ref = parseLrcRef(block.audio ?? '');
        const path = ref?.value ?? '';
        const url = path ? this.resolveEmbedUrl(path) : null;
        const entry = (await this.service.list()).find((e) => e.notePath === notePath) ?? null;
        if (!path || !url) {
            return { items: [], startIndex: 0, inline: true, loadLyrics: async () => null };
        }
        const track: AudioPlayerTrack = {
            entryId: entry?.id ?? '',
            title: entry?.title ?? (fileNameOfPath(path) || '音频'),
            subtitle: entry ? audioSubtitle(entry) : '',
            path,
            url,
            coverUrl: entry ? this.resolvePoster(entry) ?? null : null,
        };
        return {
            items: [track],
            startIndex: 0,
            inline: true,
            // ⚠️ 内联块**不传那个「打开即播」的开关**（打开笔记就出声很吵，那次也没人点播放键）；
            //    逐字高亮与标签页共用同一个开关（同一个播放器、同一个设置）。
            wordHighlight: this.settings.lyricsWordHighlight !== false,
            loadLyrics: () => this.pickLyricsFor(block, path),
            initialMode: normalizeAudioPlayMode(this.settings.audioPlayMode),
            initialVolume: clampAudioVolume(this.settings.audioVolume ?? 1),
            onSaveMode: (mode) => void this.persistAudioSetting('mode', mode),
            onSaveVolume: (volume) => void this.persistAudioSetting('volume', volume),
            onPlayStart: (kind) => this.pauseOtherPlayers(kind),
        };
    }

    /**
     * LyricFlux 是否已启用（④-4 块处理器让位判定）。
     * ⚠️ `app.plugins` **不在** `obsidian.d.ts` 的公开类型里 ⇒ 经 `unknown` 收窄 + try/catch；
     *    探测失败按「未启用」处理（宁可自己画，也别因为探测不到就整块不渲染）。
     */
    private isLyricFluxEnabled(): boolean {
        try {
            const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
            return !!plugins?.enabledPlugins?.has(LYRICFLUX_PLUGIN_ID);
        } catch {
            return false;
        }
    }

    /** 绝对路径 → vault 相对路径（在 vault 内则去前缀；库外保留原样——LyricFlux 两种都支持） */
    private toVaultRelPath(abs: string): string {
        try {
            const base = (this.app.vault.adapter as FileSystemAdapter).getFullPath('');
            const norm = abs.replace(/\\/g, '/').replace(/\/+$/, '');
            const b = base.replace(/\\/g, '/').replace(/\/+$/, '');
            if (norm.toLowerCase().startsWith(b.toLowerCase())) {
                return normalizePath(norm.slice(b.length).replace(/^\/+/, ''));
            }
        } catch { /* 忽略 */ }
        return abs;
    }

    /** 删除摘抄（阅读器书签右键）：ConfirmModal 确认 → 从笔记摘抄区移除块；返回是否删除成功（供面板刷新书签列表） */
    async deleteBookExcerpt(entryId: string, blockId: string): Promise<boolean> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return false;
            const ok = await new ConfirmModal(
                this.app,
                `将从《${e.title}》笔记摘抄区移除该摘抄（删除笔记中的摘抄标记后不可恢复）。`,
                '删除',
            ).open();
            if (!ok) return false;
            const r = await this.service.deleteExcerpt(entryId, blockId);
            new Notice(`已删除摘抄 · 《${e.title}》现有 ${r.count} 条`);
            return true;
        } catch (err) {
            new Notice(`删除摘抄失败：${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    /** 一键即黄即记：写入**阅读数据存档**（高亮真源）并返回新块 id 供阅读器即时 mark；失败 null（不抛，已 Notice 原因）。
     *  ⚠️ 2026-09-18 前这里写的是笔记「## 高亮」区（连笔记都要顺手造一本）；现在笔记那份只是 JSON 生成的镜像。 */
    private async addBookHighlight(
        entryId: string,
        title: string,
        quote: string,
        loc: { chapter: number; pct: number },
        style?: HlStyle,
        color?: HlColor,
    ): Promise<string | null> {
        try {
            const mem = await this.ensureReaderStore(entryId, title);
            const id = generateBlockId('hl');
            const hl: ReaderHighlight = {
                quote: quote.trim(),
                id,
                loc,
                style: normalizeHlStyle(style),
                color: normalizeHlColor(color),
            };
            mem.store = withHighlights(mem.store, [...mem.store.highlights, hl]);
            await this.flushReaderStore(entryId);
            await this.syncHighlightMirror(entryId);
            return id;
        } catch (err) {
            new Notice(`高亮失败：${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }

    /** 删除高亮（阅读器标注右键）：ConfirmModal 确认 → 从存档移除 + 同步笔记镜像；返回是否成功 */
    async deleteBookHighlight(entryId: string, blockId: string): Promise<boolean> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return false;
            const ok = await new ConfirmModal(this.app, `将从《${e.title}》的高亮中移除该条（删除后不可恢复）。`, '删除').open();
            if (!ok) return false;
            const n = await this.removeReaderHighlights(entryId, e.title, [blockId], []);
            if (!n) {
                new Notice('该高亮不存在或已删除');
                return false;
            }
            new Notice(`已删除高亮 · 《${e.title}》`);
            return true;
        } catch (err) {
            new Notice(`删除高亮失败：${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    /** 读取书籍文件文本（TXT）：vault 相对 → vault.read；库外绝对路径（toVaultRelPath 未转换）→ fs 读取；失败返回 null */
    /** 读取书籍文本（TXT）：vault 相对或库外绝对双路径；供 ReaderView 视图内读取（对齐 weave-reader 视图自行加载） */
    async readBookText(path: string): Promise<string | null> {
        // 🔴 必须读二进制再嗅探编码：中文网络小说 TXT 多为 GBK/GB18030 且无 BOM，
        // 直接按 utf8 解会全篇 U+FFFD（乱码）→ 章节正则匹配不到 → 整书退化成单章 → 一次渲染数百万字 DOM 卡死。
        // 零新依赖：Chromium/Node 的 TextDecoder 原生支持 gb18030。
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const buf = await this.app.vault.readBinary(file);
            return decodeTxtBytes(new Uint8Array(buf));
        }
        if (Platform.isDesktopApp) {
            try {
                // 注意：Obsidian 渲染进程原生 import() 不可靠，用 require
                const fs = require('fs/promises') as typeof import('fs/promises');
                const buf = await fs.readFile(path);
                return decodeTxtBytes(new Uint8Array(buf));
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 读取**原始字节**（音频内嵌歌词解析用）。
     * 🔴 与 `readBookText` 的区别：那个是「先读字节、嗅探编码、再整体解码」——适合纯文本；
     *    **音频绝不能被整体解码**（编码信息在帧内部，ID3 每帧自己带编码字节）⇒ 只能原样取字节，
     *    由 `pure/embeddedLyrics` 在帧内按自己的编码字节解。
     * 路径形态与 `readBookText` 一致：vault 相对 → `vault.readBinary`；库外绝对 → `fs`。失败回 `null`。
     */
    async readBookBytes(path: string): Promise<Uint8Array | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            try {
                return new Uint8Array(await this.app.vault.readBinary(file));
            } catch {
                return null;
            }
        }
        if (Platform.isDesktopApp) {
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                return new Uint8Array(await fs.readFile(path));
            } catch {
                return null;
            }
        }
        return null;
    }

    /** 探针本地书籍文件进度基准（表单「进度页数」自动关联用）：PDF 返回 numPages（页基准）；TXT 按章节解析返回 totalChapters；
     *   EPUB 解包取 spine 章节数做基准（章节制，与 TXT 同构）；失败返回 undefined。PDF 复用 pdfjs 单例 worker（Blob 内联），只解析不渲染，轻量 */
    async probeBookPages(path: string): Promise<BookProbeResult | undefined> {
        const lower = path.toLowerCase();
        if (lower.endsWith('.pdf')) {
            const data = await this.readPdf(path);
            if (data === null) return undefined;
            const numPages = await probePdfNumPages(data);
            return numPages !== undefined ? { format: 'pdf', numPages } : undefined;
        }
        if (lower.endsWith('.txt')) {
            const text = await this.readBookText(path);
            if (text === null) return undefined;
            return { format: 'txt', totalChapters: parseTxtBook(text).chapters.length };
        }
        if (lower.endsWith('.epub')) {
            // EPUB 无固定页码（流式重排），spine 章节数 = 进度基准（阅读器 chapterIndex 制同口径）
            try {
                const epub = await this.unpackEpub(path);
                if (!epub) return undefined;
                return { format: 'epub', totalChapters: epub.book.chapters.length };
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    /** 读 PDF 二进制（内置 PDF 阅读器用）：vault 内 adapter.readBinary（ArrayBuffer）；库外 fs.readFile → ArrayBuffer */
    async readPdf(path: string): Promise<ArrayBuffer | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            try {
                return await this.app.vault.adapter.readBinary(file.path);
            } catch {
                return null;
            }
        }
        if (Platform.isDesktopApp) {
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                const buf = await fs.readFile(path);
                // Buffer 底层 ArrayBuffer 可能带池偏移，slice 出独立视图（pdfjs 需要精确的 data 边界）
                return this.toArrayBuffer(buf);
            } catch {
                return null;
            }
        }
        return null;
    }

    // ── 阅读数据存档（进度 + 书签 + 高亮，一本一个 JSON 文件）────────────────────────────────
    // 位置 `{libraryDir}/阅读进度/{书名}-阅读-{id}.json`；schema / 容错 / 路径全在 `pure/readerStore`。
    // 落盘策略（KOReader 式）：**内存态即真源**，滚动的进度按 1000ms 合并窗口落盘（最多 1 写/秒），
    // 标注/书签增删、翻章、关闭阅读器、插件卸载一律**立即落盘**（都是明确动作，不能等）。
    // 旧三源（进度文件 / 书签文件 / 笔记「## 高亮」区）在首次打开该书时**懒迁移**进来；旧文件按 D-5 保留一个版本。

    /** 内存态（按条目 id 缓存，打开阅读器时载入） */
    private readerStores = new Map<string, ReaderStoreMem>();
    /** 载入去重（同一本书被并发打开时只读一遍、只迁移一遍） */
    private readerStoreLoads = new Map<string, Promise<ReaderStoreMem>>();

    /** 取内存态（无则载入 + 懒迁移）；title 每次都刷新（条目可能改过名，文件名基准要跟着走） */
    private async ensureReaderStore(entryId: string, title: string): Promise<ReaderStoreMem> {
        const hit = this.readerStores.get(entryId);
        if (hit) {
            hit.title = title;
            return hit;
        }
        const inflight = this.readerStoreLoads.get(entryId);
        if (inflight) return inflight;
        const p = (async (): Promise<ReaderStoreMem> => {
            const mem: ReaderStoreMem = { store: await this.loadOrMigrateReaderStore(entryId, title), title, timer: null };
            this.readerStores.set(entryId, mem);
            return mem;
        })();
        this.readerStoreLoads.set(entryId, p);
        try {
            return await p;
        } finally {
            this.readerStoreLoads.delete(entryId);
        }
    }

    /** 读存档：文件存在且能解析出 version → 归一后返回；否则走懒迁移（升级首开 / 坏档同路：按空档重建）。 */
    private async loadOrMigrateReaderStore(entryId: string, title: string): Promise<ReaderStore> {
        const path = normalizePath(readerStoreFilePath(entryId, title, this.settings.libraryDir));
        let raw: unknown;
        try {
            raw = JSON.parse(await this.app.vault.adapter.read(path));
        } catch {
            raw = undefined;
        }
        if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).version === 'number') {
            return normalizeStore(raw);
        }
        // 懒迁移（一次性、幂等、非破坏）：合成新档 → 先写盘，旧文件与笔记原区**一律不删**
        const store = mergeLegacyStore(await this.readLegacyReaderData(entryId, title));
        await this.writeReaderStoreFile(entryId, title, store);
        return store;
    }

    /** 旧三源读取（**只给懒迁移用**，迁移后不再增量写）：旧进度文件 + 旧书签文件 + 笔记「## 高亮」区。各源失败互不牵连。 */
    private async readLegacyReaderData(
        entryId: string,
        title: string,
    ): Promise<{ progress?: unknown; bookmarks?: unknown; highlights?: unknown }> {
        const progDir = normalizePath(readerStoreDir(this.settings.libraryDir));
        const out: { progress?: unknown; bookmarks?: unknown; highlights?: unknown } = {};
        // 旧进度（含更早的 e_xxx.json 名兜底）
        try {
            let text: string | null = null;
            try {
                text = await this.app.vault.adapter.read(normalizePath(readingProgressFilePath(entryId, title, this.settings.libraryDir)));
            } catch {
                try {
                    text = await this.app.vault.adapter.read(normalizePath(`${progDir}/${entryId}.json`));
                } catch {
                    text = null;
                }
            }
            if (text !== null) out.progress = JSON.parse(text);
        } catch { /* 无进度 / 坏 JSON */ }
        // 旧书签（含更早的 e_xxx.bookmarks.json 名兜底）
        try {
            let text: string | null = null;
            try {
                text = await this.app.vault.adapter.read(normalizePath(bookmarksFilePath(entryId, title, this.settings.libraryDir)));
            } catch {
                try {
                    text = await this.app.vault.adapter.read(normalizePath(`${progDir}/${entryId}.bookmarks.json`));
                } catch {
                    text = null;
                }
            }
            if (text !== null) out.bookmarks = parseBookmarks(text);
        } catch { /* 无书签 */ }
        // 旧高亮：笔记「## 高亮」区（解析出来即搬进 JSON；笔记区之后由镜像接管）
        try {
            const e = await this.service.get(entryId);
            if (e?.notePath) {
                const f = this.app.vault.getAbstractFileByPath(e.notePath);
                const md = f instanceof TFile ? await this.app.vault.read(f) : await this.app.vault.adapter.read(e.notePath);
                // 历史块可能没有 `^hl…` 锚点（老数据/手改）→ 补一个：存档里 id 是删除与镜像锚点的唯一钥匙，
                // 缺了它这条高亮在阅读器里既取消不掉也清不掉（旧实现只能提示「去笔记里手动删」）。
                out.highlights = parseHighlightBlocks(md).map((h) => (h.id ? h : { ...h, id: generateBlockId('hl') }));
            }
        } catch { /* 无笔记 */ }
        return out;
    }

    /** 写存档（覆盖写）：目录缺失先建；失败静默（不打断阅读，下次 flush 重试） */
    private async writeReaderStoreFile(entryId: string, title: string, store: ReaderStore): Promise<void> {
        try {
            const dir = normalizePath(readerStoreDir(this.settings.libraryDir));
            if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
                try {
                    await this.app.vault.createFolder(dir);
                } catch { /* 已存在/创建失败：写入时再兜底 */ }
            }
            const path = normalizePath(readerStoreFilePath(entryId, title, this.settings.libraryDir));
            const text = serializeStore(store);
            const f = this.app.vault.getAbstractFileByPath(path);
            if (f instanceof TFile) await this.app.vault.modify(f, text);
            else await this.app.vault.create(path, text);
        } catch { /* 落盘失败静默（不影响阅读） */ }
    }

    /** 立即落盘：清掉合并窗口，把当前内存态写掉（标注增删 / 翻章 / 关闭阅读器 / 插件卸载） */
    async flushReaderStore(entryId: string): Promise<void> {
        const mem = this.readerStores.get(entryId);
        if (!mem) return;
        if (mem.timer !== null) {
            window.clearTimeout(mem.timer);
            mem.timer = null;
        }
        await this.writeReaderStoreFile(entryId, mem.title, mem.store);
    }

    /** 进度写入（滚动期间高频）：只更内存态 + 起合并窗口。
     *  ⚠️ 已载入时**同步**改内存（不走 await）—— 关闭阅读器时 `flushSave → onSaveProgress → 紧接着 flushReaderStore`，
     *  若这里还要 await，flush 可能先跑完把旧进度写下去（最后一次滚动丢失）。 */
    async saveReaderProgress(entryId: string, title: string, p: { chapterIndex: number; scrollRatio: number }): Promise<void> {
        const hit = this.readerStores.get(entryId);
        if (hit) {
            hit.title = title;
            this.applyReaderProgress(hit, entryId, p);
            return;
        }
        this.applyReaderProgress(await this.ensureReaderStore(entryId, title), entryId, p);
    }

    /** 进度段合并 + 起窗（内存态已是真源，窗口只决定"什么时候落盘"） */
    private applyReaderProgress(mem: ReaderStoreMem, entryId: string, p: unknown): void {
        mem.store = withProgress(mem.store, p);
        if (mem.timer !== null) return; // 窗口内已有待写：不必重新起表
        mem.timer = window.setTimeout(() => {
            mem.timer = null;
            void this.flushReaderStore(entryId);
        }, READER_STORE_FLUSH_MS);
    }

    /** 书签写入（增删/清空是用户明确动作）：立即落盘 */
    async saveReaderBookmarks(entryId: string, title: string, list: ReaderBookmark[]): Promise<void> {
        const mem = await this.ensureReaderStore(entryId, title);
        mem.store = withBookmarks(mem.store, list);
        await this.flushReaderStore(entryId);
    }

    /** 同步笔记「## 高亮」只读镜像（D-3②）。失败静默：真源在 JSON，镜像只是给人看/给 Obsidian 搜索用的。
     *  🔴 必须经 EntryService（笔记与 noteFingerprint 的唯一拥有者）—— 自己直接写笔记会让指纹过期，
     *  下次编辑该条目被误判「笔记被外部修改」。 */
    private async syncHighlightMirror(entryId: string): Promise<void> {
        const mem = this.readerStores.get(entryId);
        if (!mem) return;
        try {
            const e = await this.service.get(entryId);
            await this.service.syncHighlightMirror(entryId, mem.store.highlights, { refLink: this.excerptRefLink(e) });
        } catch { /* 镜像失败不影响真源 */ }
    }

    /**
     * 批量移除高亮（阅读器垃圾桶 / 侧栏「清除全部」共用）：先按块 id，再按**引用文本**兜底
     * （去空白归一；老数据/手改的条目可能没有 id）—— 只按 id 删会「提示删了却还在」。
     * 一次 flush + 一次镜像；返回实际移除条数（调用方据此提示）。
     */
    private async removeReaderHighlights(entryId: string, title: string, ids: string[], quotes: string[]): Promise<number> {
        const mem = await this.ensureReaderStore(entryId, title);
        let list = mem.store.highlights;
        let n = 0;
        for (const id of ids) {
            if (!id) continue;
            const before = list.length;
            list = list.filter((x) => x.id !== id);
            if (list.length < before) n++;
        }
        for (const q of quotes) {
            const hit = findSameExcerpt(list, q);
            if (!hit) continue;
            list = list.filter((x) => x !== hit);
            n++;
        }
        if (n) {
            mem.store = withHighlights(mem.store, list);
            await this.flushReaderStore(entryId);
            await this.syncHighlightMirror(entryId);
        }
        return n;
    }

    /** 阅读进度/书签文件名可读化迁移（幂等，启动时执行）：旧 e_xxx.json / e_xxx.bookmarks.json
     *  → {书名}-阅读进度|书签-{id}.json；孤儿文件（对应条目已删）保留原名；失败静默（下次启动重试）。
     *  （2026-09-18 起进度/书签已并入存档 JSON：本步只为把**待迁移**的旧文件改成可读名，便于人工识别） */
    private async migrateProgressFileNames(): Promise<void> {
        try {
            const dir = (this.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
            const progDirObj = this.app.vault.getAbstractFileByPath(normalizePath(`${dir}/阅读进度`));
            if (!(progDirObj instanceof TFolder)) return;
            const entries = await this.service.list();
            const byId = new Map(entries.map((e) => [e.id, e]));
            for (const f of progDirObj.children) {
                if (!(f instanceof TFile)) continue;
                const m = matchLegacyProgressFile(f.name);
                if (!m) continue; // 已是新可读名或无关文件
                const entry = byId.get(m.entryId);
                if (!entry) continue; // 孤儿：条目已删，保留原名
                const newName = m.kind === 'bookmarks'
                    ? bookmarksFileName(m.entryId, entry.title)
                    : progressFileName(m.entryId, entry.title);
                const target = normalizePath(`${dir}/阅读进度/${newName}`);
                if (newName === f.name || this.app.vault.getAbstractFileByPath(target) instanceof TFile) continue;
                await this.app.vault.rename(f, target);
            }
        } catch { /* 迁移失败静默（新写入走新名，下次启动重试） */ }
    }

    /**
     * AI 对话补全（阅读器**划词翻译**与**划词搜索**共用一条通道，避免两套凭据/两套错误处理漂移）：
     * POST 当前服务商 chat/completions，Bearer Key + messages body；模型固定 GLM-4-Flash / deepseek-v4-flash。
     * 未配对应 Key → Notice 引导；失败/超时 → 细分 Notice 并返回 null（不抛）。`label` 只用于错误文案（翻译 / 搜索）。
     */
    /**
     * 「不启用」守卫（用户 2026-09-18）：该 AI 功能在设置页被选成「不启用」→ 提示并返回 true，
     * 调用方直接 return null（**不发网络请求**）。三处服务下拉各自独立，互不影响。
     */
    private aiOffBlocked(choice: AiProviderChoice, label: string): boolean {
        if (choice !== AI_PROVIDER_OFF) return false;
        new Notice(`${label}已在设置中关闭（设置 → AI集成 · 用途 可改为服务商重新启用）`, 4000);
        return true;
    }

    /**
     * 🔴 #478：解析「某处服务这次该用哪个端点 / Key / 模型」—— **唯一入口**。
     *
     * 为什么要抽出来：加了第三家（`'custom'` 自定义端点）之后，原来散在各处的
     * 「按内置两家二分挑 Key 字段」与「按内置两家二分挑显示名」的写法会**把自定义端点错当成 DeepSeek**
     * （改一处漏一处）。现在这两件事各自只有一个出口：`resolveAiAccess` 与 `pure/translate.providerLabel`。
     *
     * 三处服务（翻译 / 总结 / 搜索）各自把**自己的模型字段**传进来（`pickedModel`）；凭据与端点共用。
     * `issue` 非空 ⇒ **不要发请求**（缺 Key / 缺端点地址 / 缺模型名）。
     */
    private resolveAiAccess(
        provider: TranslateProvider,
        pickedModel?: string,
    ): { url: string; key: string; model: string; label: string; issue?: string } {
        const label = providerLabel(provider);
        const model = resolveModel(provider, pickedModel);
        if (provider === 'custom') {
            const url = translateChatUrl('custom', this.settings.readerCustomBaseUrl);
            const key = this.aiKeyText('custom');
            const where = '设置 → AI集成 › 模型服务 · 自定义端点';
            if (!url) return { url, key, model, label, issue: `未配置自定义端点地址，请先到 ${where} 填写` };
            if (!key) return { url, key, model, label, issue: `未配置自定义端点的 API Key，请先到 ${where} 填写` };
            if (!model) {
                return { url, key, model, label, issue: '自定义端点需要填模型名（设置 → AI集成 · 用途 的「模型」栏）' };
            }
            return { url, key, model, label };
        }
        const key = this.aiKeyText(provider);
        const url = translateChatUrl(provider);
        if (!key) {
            return { url, key, model, label, issue: `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写` };
        }
        return { url, key, model, label };
    }

    /**
     * 🔴 #479：服务商 → **凭据字段名**（唯一真源）。`resolveAiAccess` 与「获取模型」共用它 ——
     * ⛔ 别在第二处再写一遍 `provider === 'zhipu' ? … : …`（加第四家必漏一处，本仓栽过）。
     * 🔴 #480：`siliconflow` 与「朗读云合成」**共用同一把 Key**（同一账号）⇒ 复用 `readerSiliconflowKey`，
     *    不新开字段（否则用户要在同一页填两遍同一个 Key）。
     */
    /** 按 `pure/translate.aiKeyField` 取该服务商的 Key（trim；非字符串 → 空串） */
    private aiKeyText(provider: TranslateProvider): string {
        const v = (this.settings as unknown as Record<string, unknown>)[aiKeyField(provider)];
        return typeof v === 'string' ? v.trim() : '';
    }

    /**
     * 拉取服务商的**模型列表**（设置页「AI服务 › 模型 · 获取模型」，#479）。
     * 🔴 端点由 `pure/translate.modelsUrl` 从 chat 端点**派生**，解析走 `parseModelList` ——
     *    ⛔ 别在这里另写一份字面量 / 另写一套解析。
     * 🔴 凭据与 chat **同一份**（`aiKeyField`）—— 不新开凭据通道，也不要求先选好模型。
     * ⚠️ 失败时 `message` 面向用户直接可用（含 `aiHttpIssue` 的 401/402/403/404/429 可读文案）。
     */
    async listAiModels(provider: TranslateProvider): Promise<{ ok: boolean; models: ModelFetched[]; message?: string }> {
        const label = providerLabel(provider);
        const url = modelsUrl(provider, this.settings.readerCustomBaseUrl);
        const key = this.aiKeyText(provider);
        if (!url) return { ok: false, models: [], message: `未配置自定义端点地址，请先到 设置 → AI集成 › 模型服务 · 自定义端点 填写` };
        if (!key) return { ok: false, models: [], message: `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写` };
        try {
            const res = await withTimeout(
                requestUrl({ url, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
                15000,
            );
            if (res.status !== 200) {
                return { ok: false, models: [], message: aiHttpIssue(res.status, label) ?? `${label} 返回 HTTP ${res.status}` };
            }
            const models = parseModelList(res.json);
            if (!models.length) return { ok: false, models: [], message: `${label} 没有返回可用模型` };
            return { ok: true, models };
        } catch (e) {
            return { ok: false, models: [], message: '获取模型失败：' + (e instanceof Error ? e.message : String(e)) };
        }
    }

    private async chatCompletion(input: {
        text: string;
        provider: TranslateProvider;
        prompt?: string;
        /** 该服务在设置页选的模型（#478；空/缺省 ⇒ 该家默认模型） */
        model?: string;
        /** 用途名，进错误文案（「翻译失败：…」/「搜索失败：…」） */
        label: string;
        build: (text: string, provider: TranslateProvider, prompt?: string, model?: string) => TranslateRequestBody | null;
    }): Promise<string | null> {
        const { text, provider, prompt, model, label, build } = input;
        const access = this.resolveAiAccess(provider, model);
        if (access.issue) {
            new Notice(access.issue, 5000);
            return null;
        }
        const body = build(text, provider, prompt, access.model); // 提示词可在设置页改；空文本返回 null → 不发请求
        if (!body) return null;
        try {
            // 15s 超时（远程推理需给足时间）
            const res = await withTimeout(
                requestUrl({
                    url: access.url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${access.key}` },
                    body: JSON.stringify(body),
                }),
                15000,
            );
            // #478：401/402/403/404/429 一律给出**可读原因**（原来只特判 401/429 ⇒ 402 余额不足
            //   会被笼统报成「失败（HTTP 402）」，用户看不出是账户没钱）
            const httpIssue = aiHttpIssue(res.status, access.label);
            if (httpIssue) {
                new Notice(`${label}失败：${httpIssue}`, 5000);
                return null;
            }
            if (res.status !== 200) {
                new Notice(`${label}失败（HTTP ${res.status}）`, 4000);
                return null;
            }
            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                new Notice(`${label}失败（响应非 JSON）`, 4000);
                return null;
            }
            const reply = parseAiReply(json);
            if (!reply.ok) {
                // 🔴 推理模型只吐了思维链（`reasoning_content`）没给答案 ⇒ 明说，⛔ 别把思维链当结果
                new Notice(
                    reply.reason === 'reasoning-only'
                        ? `${label}失败：该模型只返回了思考过程、没给答案\n请在 设置 → AI集成 · 用途 换一个非推理模型`
                        : `${label}失败（模型未返回内容）`,
                    reply.reason === 'reasoning-only' ? 6000 : 4000,
                );
                return null;
            }
            return reply.text;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`${label}失败：${msg || `无法连接 ${access.label}`}\n请检查网络或 API Key（${access.url}）`, 5000);
            return null;
        }
    }

    /**
     * 划词翻译（AI 大模型，OpenAI 兼容，自动中英互译）：服务商由 settings.readerTranslateProvider 选。
     */
    async translateText(text: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerTranslateProvider);
        if (this.aiOffBlocked(choice, '翻译')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: this.settings.readerTranslatePrompt, // 提示词可在设置页改
            model: this.settings.readerTranslateModel, // #478：设置页选的模型（空 ⇒ 该家默认）
            label: '翻译',
            build: buildTranslateBody,
        });
    }

    /**
     * 划词 AI 搜索（阅读器搜索卡内自动发起）：与翻译同一通道，服务商由 settings.readerSearchProvider 选、
     * 提示词由 settings.readerSearchPrompt 覆盖（缺省用 DEFAULT_SEARCH_PROMPT）。
     */
    async aiSearchText(text: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerSearchProvider);
        if (this.aiOffBlocked(choice, 'AI 搜索')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: this.settings.readerSearchPrompt,
            model: this.settings.readerSearchModel, // #478
            label: '搜索',
            build: buildSearchBody,
        });
    }

    /**
     * 划词 AI 搜索「自定义提问」（用户 2026-09-18）：选段 + 问题一起发，**不读设置页提示词**
     * （那条提示词只服务「解读选段」态）。同一条 chatCompletion 通道 → 凭据与错误处理不漂移。
     */
    async aiAskText(text: string, question: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerSearchProvider);
        if (this.aiOffBlocked(choice, 'AI 搜索')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: undefined, // 显式不传：build 走内置提问提示词
            model: this.settings.readerSearchModel, // #478：与「解读选段」共用搜索服务那一栏的模型
            label: '提问',
            build: (_t, provider, _p, model) => buildSearchQuestionBody(text, question, provider, model),
        });
    }

    // ──────────── AI 摘要（编辑表单「总结摘要」小标题右侧小图标）────────────
    private aiSummaryService: AiSummaryService | null = null;

    /** AI 摘要服务（惰性构造）：复用阅读器翻译的服务商与 Key，不为摘要单开一套凭据 */
    private getAiSummaryService(): AiSummaryService {
        if (!this.aiSummaryService) {
            this.aiSummaryService = new AiSummaryService({
                getConfig: () => {
                    // 总结服务商独立于翻译服务商（设置页「AI 翻译 / 总结 / 搜索」内两项各自可调），但共用同一组 Key
                    // #478：模型 / 端点解析**与 chatCompletion 走同一个入口**（resolveAiAccess）——
                    //   否则「换到自定义端点」时总结这一路会偷偷还在用内置端点（两处真源必漂）。
                    const provider = normalizeProvider(this.settings.readerSummaryProvider);
                    const access = this.resolveAiAccess(provider, this.settings.readerSummaryModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue, prompt: this.settings.readerSummaryPrompt };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
            });
        }
        return this.aiSummaryService;
    }

    /** AI 生成条目摘要（一句话总结 + 核心看点）：失败返回 null（服务内部已 Notice） */
    aiSummarizeEntry(input: AiSummaryInput): Promise<AiSummaryResult | null> {
        const choice = normalizeAiChoice(this.settings.readerSummaryProvider);
        if (this.aiOffBlocked(choice, '总结')) return Promise.resolve(null);
        return this.getAiSummaryService().generate(input);
    }

    // ──────────── #507 LRC 双语歌词（音乐编辑条目「获取歌词」旁那枚小按钮）────────────
    private lrcBilingualService: LrcBilingualService | null = null;

    /**
     * 双语歌词服务（惰性构造）。
     * 🔴 **复用「阅读翻译」的服务商与 Key**（`readerTranslateProvider` / `readerTranslateModel`）——
     *    ⛔ 不为它单开一套凭据（本仓既有纪律：同一件事的 Key 只配一处，与摘要/预填同款）。
     * ⚠️ 提示词走纯模块里那份**内置**的（逐行对齐是格式契约），⛔ 不接设置页可改的「服务提示词」。
     */
    private getLrcBilingualService(): LrcBilingualService {
        if (!this.lrcBilingualService) {
            this.lrcBilingualService = new LrcBilingualService({
                getConfig: () => {
                    const provider = normalizeProvider(this.settings.readerTranslateProvider);
                    const access = this.resolveAiAccess(provider, this.settings.readerTranslateModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
            });
        }
        return this.lrcBilingualService;
    }

    /**
     * AI 生成**双语歌词**（`[00:15.16]hello | 你好`）：失败返回 null（服务内部已 Notice）。
     * ⚠️ 返回的是**合并后的整份 LRC**（时间标签原样保留）+ `applied / missing` 计数；
     *    写回表单/落库由组件那侧负责（与「获取歌词」同一条纪律：只填框，仍要点保存）。
     */
    aiBilingualLyrics(lrc: string, meta?: { title?: string; artist?: string }): Promise<LrcBilingualMerge | null> {
        const choice = normalizeAiChoice(this.settings.readerTranslateProvider);
        if (this.aiOffBlocked(choice, '翻译')) return Promise.resolve(null);
        return this.getLrcBilingualService().generate(lrc, meta);
    }

    // ──────────── AI 预填（新增条目「手动填写」界面标题行 ✨）────────────
    private aiPrefillService: AiPrefillService | null = null;

    /** AI 预填服务（惰性构造）：复用「AI集成」的服务商与 Key，只为预填单开一个提示词（#499） */
    private getAiPrefillService(): AiPrefillService {
        if (!this.aiPrefillService) {
            this.aiPrefillService = new AiPrefillService({
                getConfig: () => {
                    const provider = normalizeProvider(this.settings.readerPrefillProvider);
                    // 模型 / 端点解析与 chatCompletion 走同一个入口（resolveAiAccess）——
                    // 否则「换到自定义端点」时预填这一路会偷偷还在用内置端点（两处真源必漂）
                    const access = this.resolveAiAccess(provider, this.settings.readerPrefillModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue, prompt: this.settings.readerPrefillPrompt };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
                // 🔴 #499D agent 工具回路（宿主注入 ⇒ 不接线 / 移动端时整条回路自动关闭）
                runTool: (name, args) => this.runPrefillTool(name, args),
                onStep: (label) => this.prefillStepCb?.(label),
            });
        }
        return this.aiPrefillService;
    }

    /** #499D：本次预填的「工具进度」回调（服务是单例 ⇒ 每次调用前挂上、结束即清；按钮忙时不会再发第二次） */
    private prefillStepCb: ((label: string) => void) | null = null;

    /**
     * AI 预填条目字段（新增条目 · 手动填写界面的 ✨）：失败返回 null（服务内部已 Notice）。
     * ⚠️ 与 `aiSummarizeEntry` 是**两条独立的服务行**（各自的 provider / model / prompt），
     *    只共用凭据（`resolveAiAccess` 的 Key 与端点）。
     * 🔴 #499D：带 `onStep` ⇒ 工具回路里每次调用都给界面回一行进度（如「搜索网络：…」）。
     */
    aiPrefillEntry(input: AiPrefillInput, onStep?: (label: string) => void): Promise<AiPrefillOutcome | null> {
        const choice = normalizeAiChoice(this.settings.readerPrefillProvider);
        if (this.aiOffBlocked(choice, '预填')) return Promise.resolve(null);
        this.prefillStepCb = onStep ?? null;
        return this.getAiPrefillService()
            .generate(input)
            .finally(() => {
                this.prefillStepCb = null;
            });
    }

    /**
     * 🔴 #499D：AI 预填的**工具执行器**（agent 回路的「本地那一半」）。
     *
     * · `lookup_metadata` ⇒ 复用**插件自己的**类型搜索链（各源客户端早就在跑，⛔ 不另写一份 HTTP）
     * · `web_search` ⇒ **必应 RSS**（`pure/bingSearch`；实测 200 + 10 条结构化结果、免费无需 Key）
     *
     * ⚠️ 返回的是**给模型看的短文本**（不是给界面用的对象）：工具输出越短越准，
     *    这里每条只留「标题 / 年份 / 来源 / 评分 / 类型」这一档信息。
     * ⚠️ 工具**失败不抛** —— 交回一句人话让模型自己决定「换个词再搜」还是「凭记忆答」
     *    （抛出去会把整条回路打断，用户拿到的是「失败」而不是「一个差一点的答案」）。
     */
    private async runPrefillTool(name: string, args: Record<string, unknown>): Promise<string> {
        const str = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string).trim() : '');

        if (name === PREFILL_TOOL_WEB_SEARCH) {
            const query = str('query');
            const url = buildBingRssUrl(query);
            if (!url) return '（没给搜索词）';
            const res = await requestUrl({
                url,
                headers: { 'User-Agent': BING_SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
            });
            if (res.status !== 200) return `（搜索失败：HTTP ${res.status}）`;
            const items = parseBingRss(res.text);
            if (!items.length) return '（没有搜到结果，换个关键词再试）';
            return `搜索「${query}」的前 ${items.length} 条结果：\n${bingResultsToText(items)}`;
        }

        if (name === PREFILL_TOOL_METADATA) {
            const title = str('title');
            if (!title) return '（没给标题）';
            const kind = this.normalizePrefillKind(str('type'));
            const hits = await this.searchForPrefill(title, kind);
            if (!hits.length) return `（本地元数据源没有查到「${title}」）`;
            const lines = hits.slice(0, 3).map((r, i) => {
                const d = describeSearchResult(r as never);
                const bits = [d.year, d.source, d.rating != null ? `★${d.rating}` : '', d.sub].filter(Boolean);
                return `${i + 1}. ${d.title}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
            });
            const head = `命中 ${hits.length} 条：\n${lines.join('\n')}`;
            // 🔴 #499E：把**最佳命中的简介原文**一并交出去（用户 2026-10-03：「简介要搜索照搬真正作品的简介」）。
            //    服务层会照搬它去覆盖模型自己写的那一版 ⇒ 这段**必须带标记、且放在文本末尾**
            //    （标记与提取器是 `pure/aiPrefill` 的同一对常量，⛔ 别在这儿手写一遍字符串）。
            // ⚠️ 取 `hits[0]`（各源的排序已是相关性序）；查不到原文就**不加这一行**，让模型凭记忆兜底。
            const synopsis = synopsisOf(hits[0]);
            return synopsis ? `${head}\n\n${PREFILL_SYNOPSIS_PREFIX}${synopsis}` : head;
        }

        return `（未知工具：${name}）`;
    }

    /**
     * 工具参数里的类型归一：模型**可能给中文**（实测 DeepSeek 传过 `"type":"电影"`）⇒ 认几个常见写法，
     * 认不出的一律按电影走（宁可搜错一类，也别把整次工具调用判死）。
     */
    private normalizePrefillKind(raw: string): 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music' {
        const s = raw.toLowerCase();
        if (/^(tv|series|剧|电视剧|连续剧)/.test(s)) return 'tv';
        if (/^(anime|番|动画)/.test(s)) return 'anime';
        if (/^(book|novel|comic|书|文学|网文|漫画)/.test(s)) return 'book';
        if (/^(game|游|游戏)/.test(s)) return 'game';
        if (/^(music|音|音乐|歌)/.test(s)) return 'music';
        return 'movie';
    }

    /** 按类型挑**已有的**那条搜索链（⛔ 不新开 HTTP 通道，全走现成门面） */
    private async searchForPrefill(
        title: string,
        kind: 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music',
    ): Promise<unknown[]> {
        try {
            if (kind === 'movie' || kind === 'tv') return await this.searchWithFallback(title, kind);
            if (kind === 'anime') return await this.searchAnime(title);
            if (kind === 'book') return await this.searchBook(title);
            if (kind === 'game') return await this.searchGame(title);
            return await this.searchMusic(title);
        } catch {
            return []; // 工具层失败 ⇒ 空结果（上面会把它写成一句「没查到」，模型自己决定下一步）
        }
    }

    /** 测试 AI 翻译连接（设置页按钮）：按服务商向端点发最小 ping；401=Key 无效、200=有效、429=限流等细分 */
    async testTranslateConnection(provider: TranslateProvider, pickedModel?: string): Promise<SourceTestResult> {
        const label = providerLabel(provider);
        return this.runTest(`${label} AI`, async () => {
            // 🔴🔴 #486：**测哪家就用哪家的模型**。
            //    原实现里自定义端点传的是「翻译服务」的模型（实测：翻译服务选了 `GLM-4-Flash`，
            //    拿它去打 91hub ⇒ 503 `No available channel for model GLM-4-Flash`）
            //    —— 而那条端点 `/models` 能返回 361 个，用户自然困惑「能列模型却测不过」。
            //    ⇒ 自定义端点没有「默认模型」（`DEFAULT_MODELS.custom` 是空串），
            //      所以这里**先问这条端点自己有什么**，再用 `pickPingModel` 挑一个像文本对话的。
            // ⚠️ 内置三家**不改**：实测智谱列表里的 `glm-4.5` / `glm-5` 是 429（余额不足），
            //    反而是默认那档 `GLM-4-Flash` 能用 ⇒ 用真实列表第一个会让「本来能过」的测试变红。
            let model = pickedModel;
            if (provider === 'custom' && !model?.trim()) {
                const list = await this.listAiModels('custom');
                if (!list.ok) return { ok: false, message: `连接失败：${list.message ?? '拿不到模型列表'}` };
                model = pickPingModel(list.models.map((m) => m.value));
                if (!model) return { ok: false, message: '连接失败：这条端点没有返回任何模型' };
            }
            // #478：三态统一走 resolveAiAccess（含 `'custom'` 自定义端点）；错误文案走 aiHttpIssue
            //   ⇒ 402 会明说「账户余额不足」而不是笼统的「HTTP 402」
            const access = this.resolveAiAccess(provider, model);
            if (access.issue) return { ok: false, message: access.issue };
            const body = buildTranslatePingBody(provider, access.model);
            try {
                const res = await requestUrl({
                    url: access.url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${access.key}` },
                    body: JSON.stringify(body),
                });
                if (res.status === 200) {
                    return { ok: true, message: `连接成功：${access.label} 可用（模型 ${access.model}）` };
                }
                // ⚠️ 失败也要带上模型名 —— 否则用户不知道「测的到底是谁」（#486 那次困惑的一半就来自这个）
                return {
                    ok: false,
                    message: `连接失败：${aiHttpIssue(res.status, access.label) ?? `HTTP ${res.status}`}（模型 ${access.model}）`,
                };
            } catch (e) {
                return {
                    ok: false,
                    message:
                        '连接失败：' +
                        (e instanceof Error ? e.message : String(e)) +
                        `（模型 ${access.model}）`,
                };
            }
        });
    }


    /**
     * 测试云合成连接（设置页「AI集成 › 模型服务 · 硅基流动 › 测试连接」，#344 方案 C）。
     * 🔴 真打一次 `/audio/speech`（最短文本）而**不是**只查 Key ——
     *    「Key 有效」不等于「能出声」，只有拿到**音频二进制**才算通。代价 = 一句两个字的合成额度。
     * ⚠️ 返回体是二进制 ⇒ 必须 `responseType: 'arraybuffer'`（同磁盘图床下载那条先例），
     *    不能走 chat 那套 JSON 解析。
     */
    async testSpeechConnection(): Promise<SourceTestResult> {
        const key = (this.settings.readerSiliconflowKey ?? '').trim();
        return this.runTest('云端语音合成', async () => {
            if (!key) return { ok: false, message: '未配置 API Key' };
            const body = buildSpeechBody({ text: '测试', voice: CLOUD_VOICE_DEFAULT, rate: 1 });
            if (!body) return { ok: false, message: '请求体构造失败' };
            try {
                const res = await requestUrl({
                    url: speechEndpointUrl(),
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body),
                    responseType: 'arraybuffer',
                } as unknown as Parameters<typeof requestUrl>[0]);
                const verdict = classifySpeechError(res.status, res.text);
                if (verdict.kind !== 'ok') return { ok: false, message: `合成失败：${verdict.message}` };
                const bytes = res.arrayBuffer?.byteLength ?? 0;
                if (!bytes) return { ok: false, message: '合成失败：返回了空音频' };
                return { ok: true, message: `合成成功：已取到 ${bytes} 字节音频` };
            } catch (e) {
                return { ok: false, message: '合成失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 阅读整体百分比写回 catalog（书架进度条数据源）：保留手填 page/totalPage，仅更新 percent；失败静默 */
    private async persistReadingPercent(entryId: string, percent: number): Promise<void> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return;
            const rp = e.readingProgress ?? {};
            const pct = Math.max(0, Math.min(100, Math.round(percent)));
            // percent 唯一真源：有 totalPage 基准 → pageFromPercent 派生当前页/章一起落库（page 缺失时补全，表单/海报墙直接可用）
            const page = rp.totalPage ? pageFromPercent(pct, rp.totalPage) : rp.page;
            await this.service.update(entryId, {
                readingProgress: { page, totalPage: rp.totalPage, percent: pct },
            });
        } catch { /* 落库失败静默（不影响阅读） */ }
    }

    /** EPUB 解包解析：jszip 解包（懒加载）→ 纯逻辑解析结构（container/opf/spine/toc）；文件缺失返回 null，解析失败抛错 */
    /** 解包 EPUB（jszip 懒加载 → 文本 fileMap + 结构解析）；供 ReaderView 视图内调用 */
    async unpackEpub(path: string): Promise<{ fileMap: Record<string, string>; book: { title: string; chapters: string[]; toc: { label: string; href: string }[]; manifest: Record<string, string> } } | null> {
        // jszip 动态 import（esbuild 打包进 main.js，避免启动期加载；CJS 互操作取 .default）
        const JSZip = (await import('jszip')).default;
        // 双路径读取二进制：vault 相对 → adapter.readBinary；库外绝对路径 → fs.readFile
        let buf: ArrayBuffer;
        const vf = this.app.vault.getAbstractFileByPath(path);
        if (vf instanceof TFile) {
            buf = await this.app.vault.adapter.readBinary(path);
        } else if (Platform.isDesktopApp) {
            const fs = require('fs/promises') as typeof import('fs/promises');
            const b = await fs.readFile(path);
            buf = this.toArrayBuffer(b);
        } else {
            return null;
        }
        const zip = await JSZip.loadAsync(buf);
        const fileMap: Record<string, string> = {};
        // zip.filter 回调第一参为 relativePath（字符串）；目录以结尾 '/' 判定；仅文本类文件入 fileMap（二进制资源如图片不在本期渲染范围）
        for (const f of zip.filter((p: string) => !p.endsWith('/') && /\.(xhtml?|html|htm|ncx|opf|xml|css)$/i.test(p))) {
            fileMap[f.name] = await f.async('string');
        }
        // container.xml → rootfile → content.opf
        const container = fileMap['META-INF/container.xml'];
        if (!container) throw new Error('EPUB 缺少 META-INF/container.xml');
        const opfPath = containerRootfile(container);
        if (!opfPath) throw new Error('EPUB container.xml 缺少 rootfile');
        const opfXml = fileMap[opfPath];
        if (opfXml === undefined) throw new Error(`EPUB 缺少 content.opf：${opfPath}`);
        const opfDir = opfPath.split('/').slice(0, -1).join('/');
        const parsed = parseOpf(opfXml, opfDir, fileMap);
        if (parsed.chapters.length === 0) throw new Error('EPUB 没有可渲染的章节（spine 为空或全部缺失）');
        // 目录：优先 nav.xhtml（EPUB3）→ toc.ncx（EPUB2）→ 扫 manifest 的 NCX 类型条目（应对变名如 fb.ncx）；
        // 都没有 → 从各章节 XHTML 抽 <h1>/<title> 命名（排除等于书名的 title 防扉页污染目录），抽不出仍回退文件名
        let toc: { label: string; href: string }[] | null = null;
        for (const name of ['nav.xhtml', 'toc.ncx']) {
            const key = Object.keys(fileMap).find((p) => p.toLowerCase().endsWith('/' + name)) ?? name;
            const navXml = fileMap[key];
            if (navXml === undefined) continue;
            const navToc = parseTocNav(navXml, key.split('/').slice(0, -1).join('/'), fileMap);
            if (navToc.length > 0) { toc = navToc; break; }
        }
        if (toc === null) {
            // 兜底扫 manifest 里任何 NCX 类型条目
            for (const [abs, media] of Object.entries(parsed.manifest)) {
                if (!/x-dtbncx/i.test(media)) continue;
                const navXml = fileMap[abs];
                if (!navXml) continue;
                const navToc = parseTocNav(navXml, abs.split('/').slice(0, -1).join('/'), fileMap);
                if (navToc.length > 0) { toc = navToc; break; }
            }
        }
        // 目录**错位**（Calibre「先写 NCX、后重切文件」的遗留：多个条目指向完全相同的位置）→
        // 该目录在数据上区分不开这些章，会同时点亮多章（用户 2026-09-19 报「目录连章」），
        // 且顶栏章名与正文对不上 → 改按 spine **内容文件** 1:1 重建目录。
        // 判据只认「重复目标」，一个文件含多章但锚点唯一（合法结构）不受影响，见 pure/epubParse 注释。
        if (toc !== null && isTocAmbiguous(toc)) {
            const rebuilt = rebuildTocFromSpine(parsed.chapters, fileMap, toc);
            if (rebuilt.length > 0) toc = rebuilt;
        }
        if (toc === null) {
            // 最终兜底：抽章节 XHTML 的 <h1>/<title>
            toc = parsed.chapters.map((href) => {
                const html = fileMap[href] ?? '';
                const label = extractChapterLabel(html, parsed.title) ?? href.split('/').pop() ?? href;
                return { label, href };
            });
        }
        return { fileMap, book: { ...parsed, toc } };
    }

    /** 读取条目笔记「## 摘抄」区 → 逐块解析（供阅读器摘抄书签目录；失败/无笔记返回空数组） */
    private async loadEntryExcerpts(entryId: string): Promise<ParsedExcerpt[]> {
        try {
            const e = await this.service.get(entryId);
            if (!e?.notePath) return [];
            const f = this.app.vault.getAbstractFileByPath(e.notePath);
            const md = f instanceof TFile ? await this.app.vault.read(f) : await this.app.vault.adapter.read(e.notePath);
            // 统一用 pure 的 ^id 锚点切块（区标题缺省「摘抄」）
            return parseExcerptBlocks(md);
        } catch {
            return [];
        }
    }

    /** 打开书籍：实验性开关分流（默认外部系统程序打开；开启/非桌面端走内置阅读器） */
    /** 打开书籍阅读器：外部打开（系统默认程序）立即返回 undefined；内置阅读器关闭后返回最新阅读进度（percent 真源，供表单自动同步） */
    async openBookReader(entry: MediaEntry): Promise<BookProgressFields | undefined> {
        if (!entry.bookFile) {
            new Notice('未关联书籍文件 — 编辑条目选择 TXT/EPUB/PDF', 5000);
            return undefined;
        }
        const path = normalizePath(entry.bookFile);
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext !== 'txt' && ext !== 'epub' && ext !== 'pdf') {
            new Notice('暂不支持该格式（支持 TXT/EPUB/PDF）', 3000);
            return undefined;
        }
        // 实验性功能「内置阅读器打开书籍文件」：默认 false = 外部打开（系统默认程序）；开启或非桌面端（无法外部）才走内置
        if (!this.settings.internalBookReader && Platform.isDesktopApp) {
            await this.openBookExternally(path);
            return undefined;
        }
        return await this.openBookInternal(entry, path);
    }

    /**
     * 笔记内链接点击拦截（M1 双向溯源 + 「回到原文」深链，document 捕获阶段）。三种形态：
     *  ① **`[↩](obsidian://reelludic?…)` 深链**（用户 2026-09-19）：markdown 外部链接形态、没有 `data-href`。
     *     与书在库内还是库外**无关**（参数是 entryId）→ 治「库外书头行写不出 wikilink、点不回去」的断点。
     *  ② **`[[源文件#^bk…|标签]]` 块锚点**：Obsidian 拿到只会去打开源文件本身（txt 当纯文本铺开、epub 无从渲染）、
     *     **无法定位** → 解析块 id 反查条目，开（或复用）阅读器并注入 pendingTargetId。
     *  ③ **视频时间戳链接**（`[7:10](…)`，库内 `影片.mp4#t=430` / 库外条目深链）。
     * 🔴 形态 ①③ 在**编辑视图里不是 `<a>`**（是 CM6 span，见 ③ 处注释）→ 目标得回所在行的 markdown 源码里取。
     * 三种之外的链接**一律不拦**（交回 Obsidian 默认行为，绝不吞掉用户正常的链接点击）。
     */
    private onWorkspaceAnchorClick = (ev: MouseEvent): void => {
        const target = ev.target as HTMLElement | null;
        const a = target?.closest?.('a') as HTMLAnchorElement | null;
        // ① 阅读器深链（它同时带 href 与 data-href 的场合也不会有歧义）
        const href = a?.getAttribute('href') ?? '';
        const dataHref = a?.getAttribute('data-href') ?? '';
        const deep = parseReaderDeepLink(href) ?? parseReaderDeepLink(dataHref);
        // ② 视频**时间戳链接**（#326）—— 两种形态都认：
        //    · 库外/兜底：`obsidian://reelludic?action=video&…`（在 href 上）
        //    · 库内：`影片.mp4#t=3`（Obsidian 把库内链接目标放在 **data-href**，href 可能是 app:// 形态 → 先看 data-href）
        let vTime = deep ? null : (parseTimeLink(dataHref) ?? parseTimeLink(href));
        // ③ 🔴 编辑视图（Live Preview / 源码模式）里的链接**不是 `<a>`**（2026-09-19 用户第三次报障的根因之二）：
        //    读 Obsidian 核心 `onEditorClick`（app.js @2548591）得到判据 —— 它认可点 token 只认
        //    `.external-link` / `.cm-url` / `.cm-link` / `.cm-underline` 这些 **CM6 span**。所以
        //    `closest('a')` 在编辑视图里**恒为 null**，而旧实现第一行是 `if (!a) return` ⇒
        //    **编辑视图永远拦不到**（阅读视图是 `<a>` → 只有那里能跳 = 用户报的「只能阅读视图跳」）。
        //    CM6 的链接目标**不在 DOM 属性上**（渲染出来的只有显示文字）→ 回「点击处所在行」的 markdown 源码，
        //    按「点击处文字 === 链接文字 / 链接目标」把目标取回来（`matchLineLink`；行内别的字、整行都不命中，
        //    所以**不会误吞普通点击**）。⛔ 别把这条判据换成「行里有链接就拦」——那样用户连点这行放光标都会被抢。
        if (!deep && !vTime && !a && target?.closest?.('.cm-editor')) {
            const dest = matchLineLink(target.closest('.cm-line')?.textContent ?? '', target.textContent ?? '');
            if (dest) vTime = parseTimeLink(dest);
        }
        // 🔴 **归属判断必须排在 `defaultPrevented` 之前**（2026-09-19 用户实测报障）：
        //    Live Preview 里 CodeMirror / Obsidian 会在**更早的阶段**处理 `mousedown` 并 `preventDefault()`
        //    （为接管光标定位与链接闪现），于是随后的 `click` 带着 `defaultPrevented=true` 进来 ——
        //    旧实现第一行就 `if (ev.defaultPrevented) return` 直接放行 → **编辑视图里本插件深链永远跳不了**，
        //    而阅读视图没人 preventDefault 所以正常 —— 症状正是「只能阅读视图跳」。
        //    判据：**是本插件要抢的链接就无条件拦下**；只有「不是我们的」才去尊重别人的 preventDefault。
        if (deep || vTime) {
            ev.preventDefault();
            ev.stopPropagation();
            if (deep) void this.openDeepLinkTarget(deep);
            else if (vTime) void this.openVideoAt(vTime);
            return;
        }
        // 不是本插件的链接 → 绝不吞掉用户的普通点击
        if (ev.defaultPrevented) return;
        // ③ 块锚点 wikilink
        const parsed = parseLinktext(dataHref);
        const subpath = parsed.subpath ?? '';
        const id = subpath.startsWith('#^') ? subpath.slice(2) : '';
        if (!parsed.path || !/^[\w-]+$/.test(id)) return;
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        // 链接缓存优先；未索引到（罕见）再按 vault 路径兜一次
        const file =
            this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath) ??
            this.app.vault.getAbstractFileByPath(normalizePath(parsed.path));
        if (!(file instanceof TFile)) return;
        const ext = file.path.split('.').pop()?.toLowerCase();
        if (ext !== 'txt' && ext !== 'epub' && ext !== 'pdf') return;
        // 认定由本插件接管 → 必须同步拦下：否则 Obsidian 会把源文件同时铺到另一个标签页
        ev.preventDefault();
        ev.stopPropagation();
        void this.openBookAtAnchor(file, id, dataHref, sourcePath);
    };

    /** 「回到原文」深链落地：按 entryId 反查条目 → 开（或复用）阅读器并注入 pendingTargetId。
     *  未命中条目（已删）→ 明确提示，**不**去猜文件路径（深链刻意不带路径）。 */
    private async openDeepLinkTarget(target: { book: string; block: string }): Promise<void> {
        try {
            const entry = await this.service.get(target.book);
            if (!entry?.bookFile) {
                new Notice('找不到这本书的条目（可能已删除）', 4000);
                return;
            }
            // 深链只在内置阅读器里才有意义（外部程序无法定位块锚点）→ 不看 internalBookReader 开关
            await this.openBookInternal(entry, normalizePath(entry.bookFile), target.block);
        } catch (err) {
            new Notice(`打开定位失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 时间戳链接里的库内文件路径 → 「条目 + 集下标」（库内链接只有路径，没有条目 id） */
    private async videoPathTarget(filePath: string): Promise<{ entry: MediaEntry; index: number } | null> {
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        const file =
            this.app.metadataCache.getFirstLinkpathDest(filePath, sourcePath) ??
            this.app.vault.getAbstractFileByPath(normalizePath(filePath));
        if (!(file instanceof TFile)) return null;
        for (const entry of await this.service.list()) {
            const idx = (entry.episodeFiles ?? []).indexOf(file.path);
            if (idx >= 0) return { entry, index: idx };
        }
        return null;
    }

    /**
     * 视频**时间戳链接**落地（#326）：定位到「条目 + 集」→ 已开着同条目的播放器就**直接跳转播放**，
     * 否则开/复用播放器并注入 pendingSeek（与阅读器的 `pendingTargetId` 同款手法）。
     * ⚠️ 不看 `internalMediaPlayback` 开关：深链只在内置播放器里才有意义（外部程序定位不到某秒）。
     */
    /** 时间戳链接（#326 双轨）：库内优先用文件链接文本（生态标准 `影片.mp4#t=3`，别的工具也认），
     *  库外 / 取不到文件时用条目深链。两种都取不到 → null（不产出不可用链接）。 */
    private videoTimeLink(entry: MediaEntry, ep: number, seconds: number): string | null {
        const raw = entry.episodeFiles?.[ep];
        let filePath: string | undefined;
        if (raw) {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(raw));
            if (f instanceof TFile) filePath = this.app.metadataCache.fileToLinktext(f, entry.notePath ?? '');
        }
        return buildTimeLink({ seconds, filePath, entryId: entry.id, ep });
    }

    /**
     * #326 插入时间戳。用户 2026-09-19 定稿口径：**写进条目笔记**，并在插入前把该笔记**开在分屏**上
     * （不抢焦点 → 播放器留在左侧继续播）→ 结果立刻看得见、点一下就能跳回去。
     * 🔴 该口径**取代**首版的「优先最近 Markdown 编辑器光标处」（D-2 Ⓒ）：那条路有个隐性坑 ——
     * Live Preview 会把**光标所在行**渲染成源码，刚插完链接就在光标旁 → 看着是链接却**点不动**（用户实测报障）。
     */
    async insertVideoStamp(entry: MediaEntry, info: { seconds: number; ep: number }): Promise<void> {
        try {
            const link = this.videoTimeLink(entry, info.ep, info.seconds);
            if (!link) {
                new Notice('取不到这个视频的位置信息，没法生成时间戳', 4000);
                return;
            }
            const notePath = await this.openVideoNote(entry, false);
            const { line } = await this.service.appendNoteSection(entry.id, link, '时间戳');
            if (notePath) this.scrollNoteToLine(notePath, line);
            await this.refreshPlayerMarks(entry.id);
            new Notice(`已插入时间戳 · 《${entry.title}》笔记`, 3000);
        } catch (err) {
            new Notice(`插入时间戳失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * #326 一键截图（用户裁定 D-3 Ⓑ 极简两行 + D-4 Ⓐ 跟随附件设置）：
     * 抓到的帧 → `getAvailablePathForAttachment` 落盘（重名自动加序号）→ 写进**条目笔记「## 截图」**区
     * （`![[图]]` + `[00:03](链接)`）。
     * ⚠️ 库外媒体也是存**库内**：Obsidian 只管理库内文件。
     */
    async saveVideoShot(entry: MediaEntry, info: { png: ArrayBuffer; seconds: number; ep: number }): Promise<void> {
        try {
            const link = this.videoTimeLink(entry, info.ep, info.seconds);
            if (!link) {
                new Notice('取不到这个视频的位置信息，没法生成回跳链接', 4000);
                return;
            }
            const path = await this.app.fileManager.getAvailablePathForAttachment(shotFileName(entry.title, info.seconds), entry.notePath ?? '');
            await this.app.vault.createBinary(path, info.png);
            // 🔴 入参是 `buildTimeLink` 的**完整 markdown 链接**（`timeLink`）—— 别把裸目标塞进去：
            //    旧签名收裸目标而这里传的是完整链接 → 产出**嵌套链接**、点了完全不跳（2026-09-19 用户报障）。
            const block = buildShotBlock({ fileName: path, timeLink: link });
            if (!block) {
                // 形态守卫（`buildShotBlock` 是 fail-closed）：走到这里说明链接形态不对，
                // 明确报出来比「静默什么都不写、却提示已截取」诚实。
                new Notice('回跳链接形态不对，这一帧没写进笔记', 4000);
                return;
            }
            const notePath = await this.openVideoNote(entry, false);
            const { line } = await this.service.appendNoteSection(entry.id, block, '截图');
            if (notePath) this.scrollNoteToLine(notePath, line);
            await this.refreshPlayerMarks(entry.id);
            new Notice(`已截取当前帧 · 《${entry.title}》笔记`, 3000);
        } catch (err) {
            new Notice(`截图失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 打开（或聚焦）这条视频的**笔记**；缺笔记先生成（走 `writeNote`，与摘抄同款）。
     * `focus=true`（顶栏「打开笔记」按钮）→ 打开并聚焦；`focus=false`（插入时间戳/截图时自动打开）→
     * **竖向分屏打开且不抢焦点** —— 播放器留在左侧继续播（用户 2026-09-19：「要打开当前视频笔记并分屏显示」）。
     * 已经在某个标签页里开着 → 只按 `focus` 决定是否切过去，**不重复开**。
     * **返回笔记路径**（调用方接着用它把视图滚到插入处）；取不到笔记 → null。
     */
    private async openVideoNote(entry: MediaEntry, focus = true): Promise<string | null> {
        let notePath = (await this.service.get(entry.id))?.notePath;
        if (!notePath) {
            await this.service.writeNote(entry.id);
            notePath = (await this.service.get(entry.id))?.notePath;
        }
        const file = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
        if (!(file instanceof TFile)) {
            new Notice('这条视频还没有笔记', 4000);
            return null;
        }
        // 已开着（任意标签页）→ 不重复开；按 focus 决定要不要切过去
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) {
                if (focus) this.app.workspace.setActiveLeaf(leaf, { focus: true });
                return file.path;
            }
        }
        // 竖向分屏 = 左右并排（播放器在左、笔记在右）；`active: focus` → 自动打开时不抢焦点
        const leaf = this.app.workspace.getLeaf('split', 'vertical');
        await leaf.openFile(file, { active: focus });
        return file.path;
    }

    /** 笔记里 `![[图]]` 的文件名 → 资源 URL（#333 卡片缩略图）；解析不到 → null（卡片只显示文字） */
    private resolveNoteImageUrl(image: string, entry: MediaEntry): string | null {
        try {
            const file =
                this.app.metadataCache.getFirstLinkpathDest(image, entry.notePath ?? '') ??
                this.app.vault.getAbstractFileByPath(normalizePath(image));
            return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
        } catch {
            return null;
        }
    }

    /** 「在笔记中打开」（#333 D-3）：开/复用条目笔记（**聚焦** —— 是用户主动点的按钮）→ 滚到标记那一行 */
    private async openNoteAtMark(entry: MediaEntry, mark: VideoMark): Promise<void> {
        const notePath = await this.openVideoNote(entry, true);
        if (notePath) this.scrollNoteToLine(notePath, mark.line);
    }

    /** 插入时间戳 / 截图后：把重算好的标记推给**同一条目**正开着的播放器（#333：不重开也能看到新点） */
    private async refreshPlayerMarks(entryId: string): Promise<void> {
        try {
            const marks = await this.service.readNoteMarks(entryId);
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView && view.playingEntryId === entryId) view.setMarks(marks);
            }
        } catch {
            /* 标记刷新失败不该影响插入本身 */
        }
    }

    /** 把某条笔记的编辑器**滚到指定行**（用户 2026-09-19：「插入后应定位到时间戳的位置显示，
     * 而不是又从笔记开头显示」）。**只滚视图、不动光标、不抢焦点** —— 插入是顺手动作，不该打断用户。
     */
    private scrollNoteToLine(notePath: string, line: number): void {
        if (!this.scrollToLineNow(notePath, line)) return;
        // 🔴 **下一帧再补一次**：分屏是**刚挂上 DOM** 的，布局还没跑完时 `clientHeight` 为 0，
        //    `scrollIntoView` 会算歪甚至不动（用户报「插入后没定位到插入处」的可能来源之一）。
        //    同一目标重复滚动无副作用 —— 滚动比"没滚"安全。
        window.setTimeout(() => this.scrollToLineNow(notePath, line), 90);
    }

    /** 真正滚一次：找那条笔记所在的 Markdown 叶子 → `scrollIntoView`（只滚视图、不动光标）。命中返回 true */
    private scrollToLineNow(notePath: string, line: number): boolean {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || view.file?.path !== notePath) continue;
            const target = Math.max(0, Math.min(line, view.editor.lastLine()));
            const pos = { line: target, ch: 0 };
            view.editor.scrollIntoView({ from: pos, to: pos }, true);
            return true;
        }
        return false;
    }

    private async openVideoAt(target: VideoTimeTarget): Promise<void> {
        try {
            let entry: MediaEntry | undefined;
            let index = 0;
            if (target.kind === 'entry') {
                entry = await this.service.get(target.entryId);
                index = target.ep;
            } else {
                const hit = await this.videoPathTarget(target.filePath);
                if (hit) {
                    entry = hit.entry;
                    index = hit.index;
                }
            }
            if (!entry) {
                new Notice('找不到这条视频（条目可能已删除）', 4000);
                return;
            }
            // 已开着**同一条目**的播放器 → 切集 + 跳转播放（不重开标签页）
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView && view.playingEntryId === entry.id) {
                    this.app.workspace.setActiveLeaf(leaf, { focus: true });
                    view.seekToEpisode(index, target.seconds);
                    return;
                }
            }
            void this.openEpisodeLocal(entry, index, target.seconds, true);
        } catch (err) {
            new Notice(`跳到时间戳失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 打开笔记里的块锚点：命中条目 → 内置阅读器定位；未命中（非插件管理的书 / 条目已删）→ 还原 Obsidian 默认打开 */
    private async openBookAtAnchor(file: TFile, blockId: string, href: string, sourcePath: string): Promise<void> {
        try {
            const entries = await this.service.list();
            const entry = entries.find((e) => e.bookFile && normalizePath(e.bookFile) === file.path);
            if (!entry?.bookFile) {
                await this.app.workspace.openLinkText(href, sourcePath);
                return;
            }
            // 锚点链接只能靠内置阅读器定位（外部程序无法定位到块锚点），故此处不看 internalBookReader 开关
            void this.openBookInternal(entry, normalizePath(entry.bookFile), blockId).catch((err) => {
                new Notice(`打开定位失败：${err instanceof Error ? err.message : String(err)}`, 4000);
            });
        } catch (err) {
            new Notice(`打开定位失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 外部打开：系统默认程序（桌面端 shell.openPath；vault 相对路径转真实路径，库外绝对路径直接用） */
    private async openBookExternally(path: string): Promise<void> {
        try {
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const fullPath = this.resolveSystemPath(path);
            const err = await electron.shell?.openPath(fullPath);
            if (err) new Notice(`外部打开失败：${err}`, 4000);
        } catch (err) {
            new Notice(`外部打开失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** vault 相对/库外绝对路径 → 系统真实路径（外部打开用） */
    private resolveSystemPath(path: string): string {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            return adapter.getFullPath(file.path);
        }
        return path;
    }

    /** 内置阅读器：读文件（TXT 文本 / EPUB 解包解析）→ **阅读数据存档载入**（进度/书签/高亮三合一）→ Modal 渲染；
     *  关闭后 resolve 最新落库阅读进度
     *  pendingTargetId：笔记内链接进场带上的目标块 id（`^bk…`/`^hl…` 去 `^`），阅读器渲染完成后自行消费定位 */
    private async openBookInternal(entry: MediaEntry, path: string, pendingTargetId?: string): Promise<BookProgressFields | undefined> {
        const ext = path.split('.').pop()?.toLowerCase();
        // 回归弹窗（视图/新 Tab 方式在部分 Obsidian 版本渲染不可靠）：读文件 → Modal 渲染
        // 阅读数据存档载入（打开时一次）：存档不存在（升级首开）→ 顺带把旧三源懒迁移进来；
        // 载入后内存态常驻，滚动/标注的写入都先落内存再合并落盘（见 readerStores 注释）
        const mem = await this.ensureReaderStore(entry.id, entry.title);
        const progress = mem.store.progress;
        const bookmarks = mem.store.bookmarks;
        const settings = {
            fontSize: this.settings.readerFontSize,
            lineHeight: this.settings.readerLineHeight,
            indent: this.settings.readerIndent !== false,
            hlStyle: normalizeHlStyle(this.settings.readerHlStyle),
            hlColor: normalizeHlColor(this.settings.readerHlColor),
            // #351 字体 / 字重 / 字距（缺省 = 跟随主题 / 常规 / 不写字距）
            fontFamily: normalizeFontFamily(this.settings.readerFontFamily),
            fontWeight: normalizeFontWeight(this.settings.readerFontWeight),
            letterSpacing: normalizeLetterSpacing(this.settings.readerLetterSpacing),
        };
        const onSaveProgress = (p: { chapterIndex: number; scrollRatio: number }) => {
            void this.saveReaderProgress(entry.id, entry.title, p);
        };
        // 进度百分比低频写回 catalog（翻章/关闭时；保留手填 page/totalPage，不覆盖）
        // lastPersist 跟踪最近一次落库 Promise：关闭回读前先等落库完成，避免竞态读到旧 readingProgress
        let lastPersist: Promise<void> = Promise.resolve();
        const onProgressPersist = (percent: number) => {
            lastPersist = this.persistReadingPercent(entry.id, percent);
        };
        // 已打开的阅读器视图引用（摘抄保存成功后刷新书签列表；onExcerptSave 闭包捕获，先声明后赋值）
        let view: TxtReaderView | EpubReaderView | PdfReaderView | null = null;
        // 打开阅读器并等待关闭：包装视图 onClose（先执行清理/落库——panel.destroy → flushSave），
        // 待最近一次 percent 落库完成后再读取最新 readingProgress（percent 真源）返回，供表单「当前进度页」自动同步。
        // 不能覆盖 onClose 而不调原实现：三个阅读器的 flushSave（关闭时进度/percent 落库）都挂在 onClose → destroy 链上，覆盖会导致进度丢失。
        const waitReaderClosed = (v: TxtReaderView | EpubReaderView | PdfReaderView): Promise<BookProgressFields | undefined> => {
            return new Promise((resolve) => {
                const origOnClose = v.onClose.bind(v);
                v.onClose = async () => {
                    try {
                        await origOnClose();
                    } catch { /* 清理失败不影响返回 */ }
                    // 关闭时立刻落盘最后一次进度（原实现是 flushSave 里直接写文件；现在内存态 + 合并窗口，
                    // 不等窗口到点，否则「滚到底 → 直接关标签页」会丢掉最后一次滚动）
                    await this.flushReaderStore(entry.id);
                    void lastPersist
                        .then(() => this.service.get(entry.id))
                        .then((e) => resolve(e?.readingProgress))
                        .catch(() => resolve(undefined));
                };
            });
        };
        /** 在新标签页打开阅读器视图：options 直接交给视图实例（不经 setViewState 的 state —— 避免大对象序列化）；返回视图或 null */
        const openReaderTab = async (type: string): Promise<TxtReaderView | EpubReaderView | PdfReaderView | null> => {
            // 同一本书已在本类型标签里打开 → 复用（D-4：对齐 PDF++ 实测经验，避免同一文件堆标签）。
            // 复用前用 getLeavesOfType 校验 leaf 仍存活 —— 读者可能早已关掉它，那时走下面的新开分支。
            const prev = this.readerLeaves.get(entry.id);
            if (prev && this.app.workspace.getLeavesOfType(type).includes(prev)) {
                this.app.workspace.setActiveLeaf(prev, { focus: true });
                return prev.view as TxtReaderView | EpubReaderView | PdfReaderView;
            }
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type, active: true });
            const v = leaf.view;
            const isReader = v instanceof TxtReaderView || v instanceof EpubReaderView || v instanceof PdfReaderView;
            if (isReader) this.readerLeaves.set(entry.id, leaf);
            return isReader ? (v as TxtReaderView | EpubReaderView | PdfReaderView) : null;
        };
        /** 摘抄就地卡片保存（阅读器内划词 → 卡里写想法 → Enter/保存）：写回笔记「## 摘抄」区 + 刷新阅读器摘抄列表；
         *  返回是否成功 —— false 时阅读器保留卡片与输入便于重试（用户 2026-09-17 裁定 C 方案，替换原弹窗） */
        const onExcerptSave = async (quote: string, note: string | undefined, loc: { chapter: number; pct: number }): Promise<boolean> => {
            try {
                const r = await this.addExcerpt(entry.id, { quote, note, loc });
                // 成功提示（用户 2026-09-19 报「保存摘抄没弹出轻提示」—— 此前只有失败路径有 Notice，
                // 就地卡片保存完什么反馈都没有；文案与摘抄弹窗（ExcerptModal）保持同一句式）
                new Notice(`已添加摘抄 · 《${entry.title}》现有 ${r.count} 条`);
                view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
                return true;
            } catch (err) {
                new Notice(`写入摘抄失败：${err instanceof Error ? err.message : String(err)}`);
                return false;
            }
        };
        // 摘抄书签数据源（读笔记摘抄区；打开时读一次）
        const excerpts = await this.loadEntryExcerpts(entry.id);
        // 高亮数据源（阅读数据存档里的高亮段；打开时读一次，用于页内黄标渲染）
        const highlights = mem.store.highlights;
        // 排版调整写回设置（阅读器内 A±/行距± → settings 全局记住；saveData 轻量落盘，不重建客户端）
        const onDeleteExcerpt = (blockId: string) => this.deleteBookExcerpt(entry.id, blockId);
        // 一键即黄即记：写入阅读数据存档（真源）→ 同步笔记镜像 → 返回新块 id（null=失败，阅读器本地据此即时 mark）
        const onHighlight = (quote: string, loc: { chapter: number; pct: number }, style?: HlStyle, color?: HlColor) =>
            this.addBookHighlight(entry.id, entry.title, quote, loc, style, color);
        const onDeleteHighlight = (blockId: string) => this.deleteBookHighlight(entry.id, blockId);
        /** 动作条垃圾桶：直删（不弹确认，用户 2026-09-16 选定）—— 高亮出存档、摘抄出笔记摘抄区。
         *  `opts.quiet` ＝ 静默（改样式路径「先删旧再写新」的中间步骤用：改样式是一次用户动作，
         *  只该报一条提示 —— 旧实现这条删 + 阅读器的「已高亮」+「已更新高亮样式」共弹三条，用户 2026-09-18 报障）。 */
        const onTrashSelection = async (
            t: { highlightIds: string[]; excerptIds: string[]; highlightQuotes?: string[] },
            opts?: { quiet?: boolean },
        ): Promise<number> => {
            // 高亮：一次批量删（内部按 id + 引用文本兜底，只 flush 一次、镜像重写一次）
            let hlN = 0;
            try {
                hlN = await this.removeReaderHighlights(entry.id, entry.title, t.highlightIds, t.highlightQuotes ?? []);
            } catch { /* 单条失败不中断 */ }
            let exN = 0;
            for (const eid of t.excerptIds) {
                try { await this.service.deleteExcerpt(entry.id, eid); exN++; } catch { /* 同上 */ }
            }
            const n = hlN + exN;
            if (n) {
                // 提示写清**删的是哪一类**（用户 2026-09-18 报障时的困惑源头：只写「已删除 1 条」，
                // 而同一选段若同时存在摘抄与高亮，删掉摘抄后高亮仍在 → 看上去「删了却没删」）。
                // 静默模式下不报（调用方会把这一步并进它自己那一条提示里）。
                if (!opts?.quiet) {
                    const parts = [hlN ? `${hlN} 条高亮` : '', exN ? `${exN} 条摘抄` : ''].filter(Boolean);
                    new Notice(`已删除 ${parts.join('、')}`);
                }
                view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
            }
            return n;
        };
        /** 清除全部标注（侧栏「清除全部」按钮，已一次性确认）：按 kind 逐条删，**不再逐条弹确认**；
         *  删完刷新阅读器列表（高亮由阅读器本地清、摘抄/书签列表一并重读） */
        const onPurgeAnnotations = async (kind: 'highlight' | 'excerpt', blockIds: string[]): Promise<number> => {
            if (kind === 'highlight') {
                // 高亮走存档（一次批量删 + 一次镜像重写）
                return await this.removeReaderHighlights(entry.id, entry.title, blockIds, []).catch(() => 0);
            }
            let n = 0;
            for (const bid of blockIds) {
                if (!bid) continue;
                try {
                    await this.service.deleteExcerpt(entry.id, bid);
                    n++;
                } catch { /* 单条失败不中断（对齐垃圾桶容错） */ }
            }
            if (n) view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
            return n;
        };
        /** 打开条目笔记（阅读器顶栏「打开笔记」按钮；无笔记时 openEntryNote 内部提示） */
        const onOpenNote = (): void => void this.openEntryNote(entry.id);
        const onBookmarksChange = (list: ReaderBookmark[]) => {
            void this.saveReaderBookmarks(entry.id, entry.title, list);
        };
        const onSettingsChange = (s: ReaderTypoPayload) => {
            this.settings.readerFontSize = s.fontSize;
            this.settings.readerLineHeight = s.lineHeight;
            if (s.indent !== undefined) this.settings.readerIndent = s.indent;
            if (s.hlStyle !== undefined) this.settings.readerHlStyle = s.hlStyle;
            if (s.hlColor !== undefined) this.settings.readerHlColor = s.hlColor;
            // #351 字体 / 字重 / 字距（缺省 = 本次不动这一项，见 ReaderTypoPayload 注释）
            if (s.fontFamily !== undefined) this.settings.readerFontFamily = s.fontFamily;
            if (s.fontWeight !== undefined) this.settings.readerFontWeight = s.fontWeight;
            if (s.letterSpacing !== undefined) this.settings.readerLetterSpacing = s.letterSpacing;
            void this.saveData(this.settings);
        };
        // 滚动模式（连续/翻页）：初始读持久字段（缺省 continuous），切换写回设置（append-only，跨面板/重开记住）
        const scrollMode = this.settings.readerScrollMode ?? 'continuous';
        const onScrollModeChange = (m: 'continuous' | 'paged') => {
            if (this.settings.readerScrollMode === m) return;
            this.settings.readerScrollMode = m;
            void this.saveData(this.settings);
        };
        // 行宽（严格/全宽）：初始读持久字段（缺省 strict），切换写回设置（append-only，跨面板/重开记住）
        const lineWidth = this.settings.readerLineWidth ?? 'strict';
        const onLineWidthChange = (w: 'strict' | 'full') => {
            if (this.settings.readerLineWidth === w) return;
            this.settings.readerLineWidth = w;
            void this.saveData(this.settings);
        };
        // 阅读主题（1.0.5）：初始读持久字段（缺省 follow = 跟随 Obsidian 主题），切换写回设置（append-only，三件阅读器共用）
        const theme = this.settings.readerTheme ?? 'follow';
        const onThemeChange = (t: 'follow' | 'light' | 'dark' | 'green' | 'gray' | 'sepia') => {
            if (this.settings.readerTheme === t) return;
            this.settings.readerTheme = t;
            void this.saveData(this.settings);
        };
        /** 云合成 Key 读取（#344 方案 C）：交给阅读器面板**每次现取** ⇒ 设置页刚填完就能用，不必重开阅读器 */
        const getCloudKey = (): string => (this.settings.readerSiliconflowKey ?? '').trim();
        if (ext === 'txt') {
            const text = await this.readBookText(path);
            if (text === null) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            // TXT 打开时同样校正进度基准（按章节解析：totalPage=章节数，percent 恒定重算当前章；与 PDF 双通道对称）
            void this.reconcileBookProgressOnOpen(entry.id, { format: 'txt', totalChapters: parseTxtBook(text).chapters.length });
            const reader = await openReaderTab(TXT_READER_VIEW_TYPE) as TxtReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                text,
                pendingTargetId,
                onOpenNote,
                progress,
                settings,
                scrollMode,
                onScrollModeChange,
                lineWidth,
                onLineWidthChange,
                theme,
                onThemeChange,
                getCloudKey,
                excerpts,
                bookmarks,
                highlights,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onExcerptSave,
                onPurgeAnnotations,
                onSettingsChange,
                onDeleteExcerpt,
                onTrashSelection,
                onHighlight,
                onDeleteHighlight,
                onTranslate: (text) => this.translateText(text),
                onAiSearch: (text) => this.aiSearchText(text),
                // AI 卡「自定义提问」：走同一条 AI 通道但不读设置页提示词（用户 2026-09-18）
                onAiAsk: (text, question) => this.aiAskText(text, question),
                // 网络搜索浮层引擎 chip → 系统浏览器（openExternalUrl 已限 http/https）
                onOpenExternal: (url) => this.openExternalUrl(url),
            });
            return waitReaderClosed(reader);
        } else if (ext === 'epub') {
            let epub: { fileMap: Record<string, string>; book: { title: string; chapters: string[]; toc: { label: string; href: string }[]; manifest: Record<string, string> } } | null = null;
            try {
                epub = await this.unpackEpub(path);
            } catch (err) {
                new Notice(`EPUB 解析失败：${err instanceof Error ? err.message : String(err)}`, 6000);
                return undefined;
            }
            if (!epub) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            // EPUB 打开时同样校正进度基准（spine 章节数：totalPage=章节数，percent 恒定重算当前章；与 TXT/PDF 对称）
            void this.reconcileBookProgressOnOpen(entry.id, { format: 'epub', totalChapters: epub.book.chapters.length });
            const reader = await openReaderTab(EPUB_READER_VIEW_TYPE) as EpubReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                fileMap: epub.fileMap,
                pendingTargetId,
                onOpenNote,
                book: epub.book,
                progress,
                settings,
                scrollMode,
                onScrollModeChange,
                lineWidth,
                onLineWidthChange,
                theme,
                onThemeChange,
                getCloudKey,
                excerpts,
                bookmarks,
                highlights,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onExcerptSave,
                onPurgeAnnotations,
                onSettingsChange,
                onDeleteExcerpt,
                onTrashSelection,
                onHighlight,
                onDeleteHighlight,
                onTranslate: (text) => this.translateText(text),
                onAiSearch: (text) => this.aiSearchText(text),
                // AI 卡「自定义提问」：走同一条 AI 通道但不读设置页提示词（用户 2026-09-18）
                onAiAsk: (text, question) => this.aiAskText(text, question),
                // 网络搜索浮层引擎 chip → 系统浏览器（openExternalUrl 已限 http/https）
                onOpenExternal: (url) => this.openExternalUrl(url),
            });
            return waitReaderClosed(reader);
        } else {
            // PDF：读二进制 → PdfReaderModal（无字号/行距设置，其余管道复用）
            const data = await this.readPdf(path);
            if (data === null) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            const reader = await openReaderTab(PDF_READER_VIEW_TYPE) as PdfReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                data,
                progress,
                onOpenNote,
                theme,
                onThemeChange,
                excerpts,
                // #382b：PDF 也接书签（同一条落库通道 `saveReaderBookmarks`）—— 位置存「页码（1 基）+ 页内 %」
                // ⚠️ `onConfirmClear` 不在这里传：它由 `PdfReaderView.prepare()` 统一注入（面板无 app，与 TXT/EPUB 同口）
                bookmarks,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onDeleteExcerpt,
                // PDF 加载完成后校正进度基准（totalPage=本地页数；percent 恒定重算 page；旧 totalPage 惰性迁移为元数据）
                onPdfReady: (numPages) => {
                    void this.reconcileBookProgressOnOpen(entry.id, { format: 'pdf', numPages });
                },
            });
            return waitReaderClosed(reader);
        }
    }

    /** 打开书籍阅读器时校正阅读进度基准（本地文件优先）：PDF 按页、TXT 按章节，percent 恒定，page/totalPage 重算；
     *  PDF 旧 totalPage 与本地不一致且 pageCount 为空 → 惰性迁移为元数据页数（保统计口径）。失败静默不影响阅读 */
    private async reconcileBookProgressOnOpen(entryId: string, file: BookFileInfo): Promise<void> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return;
            const r = reconcileBookProgress(e.readingProgress ?? {}, file);
            if (!r.readingProgress) return;
            await this.service.update(entryId, {
                readingProgress: r.readingProgress,
                ...(r.pageCount !== undefined ? { pageCount: r.pageCount } : {}),
            });
        } catch { /* 校正失败静默（不影响阅读） */ }
    }

    async openEntryNote(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (!e) return;
        if (e.notePath) {
            const f = this.app.vault.getAbstractFileByPath(e.notePath);
            if (f instanceof TFile) {
                await this.app.workspace.getLeaf('tab').openFile(f);
                return;
            }
        }
        new Notice('该条目还没有笔记');
    }

    async refreshViews(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            await (leaf.view as HomeView).refresh();
        }
        // 🔴 #408：条目数据变了 ⇒ 顺带把**打开的播放器**叫醒（新队列 / 新歌词）。
        //    用户报的 bug 正是「播放中识别不到新条目与更新后的歌词」—— 挂在 `refreshViews` 上
        //    就与「保存 / 删除 / 关联」这些入口天然同步，⛔ 不必每个调用点各写一遍（会漏）。
        await this.refreshAudioPlayers();
    }

    /**
     * 🔴 #408：把**最新的曲目队列**推给所有打开的音频播放器（标签页 / 侧边栏）。
     * 语义（认人 / 不打断播放）全在装配层的 `updateQueue` 里，本方法只负责「谁在场 + 给什么数据」。
     * ⚠️ 没人开着播放器时**立刻返回**（不读 catalog、零开销）—— 所以挂在 `refreshViews` 上是安全的。
     */
    async refreshAudioPlayers(): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE);
        if (!leaves.length) return;
        const opts = await this.buildAudioPlayerOptions(null);
        if (!opts) return;
        for (const leaf of leaves) {
            (leaf.view as AudioPlayerView).refreshTracks(opts.items);
        }
    }

    /**
     * 海报密度即时生效（设置页「外观与体验 › 海报密度」改动后调用，用户 2026-09-22）。
     * 与 setUiTheme 同思路：只重推两个 prop（不重读条目、不落盘）——密度是纯展示参数，
     * 走 refreshViews() 会白跑一遍 catalog 磁盘 IO。
     */
    syncPosterGrid(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            (leaf.view as HomeView).setPosterGrid(this.settings.posterDensity, this.settings.posterColumns);
        }
    }

    /** 媒体库目录变更后刷新视图标签标题（setViewState 触发 Obsidian 重算 getDisplayText；homeTab 保持） */
    async refreshHomeTabTitles(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            const state = leaf.getViewState();
            await leaf.setViewState({ ...state }, { history: false });
        }
    }

    /** 解析封面地址：http URL 直用，本地路径映射到 vault 资源 */
    resolvePoster(e: MediaEntry): string | undefined {
        return this.resolvePosterUrl(e.poster);
    }

    /** 解析封面字符串（http URL 直用；本地相对路径拼 libraryDir 映射 vault 资源） */
    resolvePosterUrl(p: string | undefined): string | undefined {
        if (!p) return undefined;
        if (/^https?:\/\//.test(p)) return p;
        const full = normalizePath(`${this.settings.libraryDir}/${p}`);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) return this.app.vault.getResourcePath(f);
        return undefined;
    }

    /** 上传本地图片作封面：复制到 {libraryDir}/封面/，返回相对路径（如 封面/e_123.jpg）
     *  供表单拖入更换封面使用；图片类型校验失败抛错 */
    async uploadPoster(file: File): Promise<string> {
        if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件（拖入的必须是图片）');
        const extM = /\.(png|jpe?g|webp|gif|avif)$/i.exec(file.name);
        const ext = extM ? extM[1].toLowerCase() : file.type === 'image/png' ? 'png' : 'jpg';
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        const name = `e_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        const target = normalizePath(`${dir}/${name}`);
        const buf = await file.arrayBuffer();
        await this.app.vault.createBinary(target, buf);
        return `${DIR_COVERS}/${name}`;
    }

    /**
     * 附件清理（#349）：扫描**未被引用的附件** —— 封面目录 + 阅读进度目录，供清理弹窗逐项列出。
     * 判定全在纯模块 `pure/orphanAssets`（可单测）。本方法由原来的「只扫封面」扩为两类资产。
     * 🔴 目录内路径一律转**库内相对**（只去库目录前缀、保留 `封面/` `阅读进度/`），与 poster / 存档存储格式一致，
     *    否则清单里的路径拼不回 vault 全路径。（存档侧另按**文件名解析出的条目 id** 判孤儿。）
     */
    async listOrphanAssets(): Promise<OrphanAsset[]> {
        const entries = await this.service.list();
        const referencedPosters = entries.map((e) => e.poster).filter((p): p is string => !!p);
        const lib = normalizePath(this.settings.libraryDir || 'ReelLudic');
        const rel = (dir: string) =>
            this.app.vault
                .getFiles()
                .filter((f) => f.path.startsWith(dir + '/'))
                .map((f) => f.path.slice(lib.length + 1));
        return buildOrphanAssets({
            coverFiles: rel(normalizePath(`${lib}/${DIR_COVERS}`)),
            referencedPosters,
            storeFiles: rel(normalizePath(readerStoreDir(this.settings.libraryDir || 'ReelLudic'))),
            liveIds: entries.map((e) => e.id),
        });
    }

    /** 附件清理入口（#349）：扫描 → 弹窗逐项勾选清理。设置页与命令面板共用这一条路径。 */
    async openAssetCleanup(): Promise<void> {
        const assets = await this.listOrphanAssets();
        new AssetCleanupModal(this.app, assets, this.settings.libraryDir || 'ReelLudic').open();
    }

    /** 下载 URL 图片为 ArrayBuffer：豆瓣图床（doubanio.com）防盗链要求 Referer 为 douban.com，
     *  桌面端用 Node 传输层 + 显式 Referer 下载；其余图床无严格防盗链，沿用 requestUrl。 */
    private async fetchImageBuffer(url: string, referer?: string): Promise<ArrayBuffer> {
        if (/doubanio\.com/.test(url) && Platform.isDesktopApp) {
            const res = await nodeHttpGetBuffer(url, {
                Referer: 'https://www.douban.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            });
            if (res.status !== 200) throw new Error(`豆瓣封面下载失败（HTTP ${res.status}）`);
            const b = res.buffer;
            return this.toArrayBuffer(b);
        }
        /**
         * #498：**搜索结果里的图**（来自各家图站）改用 Node 通道 + **来源站自己的 `Referer`**。
         * 🔴 为什么不能只靠下面那条 `requestUrl`：这类站多数按 Referer 防盗链，
         *    而 `requestUrl` 送不出「看起来像从那个站点的网页上点的」请求 ⇒ 常见 403。
         * ⚠️ 只带**来源站自己**的 Referer（`posterReferer` 从来源页取 origin），⛔ 别带 bing 的（对方认得出来）。
         * ⚠️ 失败**回落到 `requestUrl`**（与既有本地化同一条路）：两条都试才不至于「换个源就下不动」。
         */
        let firstErr = '';
        if (referer && Platform.isDesktopApp) {
            try {
                const res = await nodeHttpGetBuffer(url, {
                    Referer: referer,
                    'User-Agent': POSTER_UA,
                    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                });
                if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
                return this.toArrayBuffer(res.buffer);
            } catch (e) {
                firstErr = e instanceof Error ? e.message : String(e);
            }
        }
        const res = await requestUrl({ url, method: 'GET', responseType: 'arraybuffer' } as unknown as Parameters<typeof requestUrl>[0]);
        if (res.status !== 200) {
            throw new Error(firstErr ? `${firstErr}；备用通道也失败：HTTP ${res.status}` : `HTTP ${res.status}`);
        }
        return (res as unknown as { arrayBuffer: ArrayBuffer }).arrayBuffer;
    }

    /**
     * 下载 URL 图片到 封面/ 目录（命名 封面/{标题}.jpg，同标题重名追加 -2/-3 防覆盖），返回相对路径。
     * `referer`（#498，append-only 可选参）= 下载源站图片时带的来源页 —— 见 `fetchImageBuffer` 的说明。
     */
    async downloadPosterToLocal(url: string, title: string, referer?: string): Promise<string> {
        const base = sanitizePosterTitle(title) || 'poster';
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        let target = `${DIR_COVERS}/${base}.jpg`;
        let full = normalizePath(`${this.settings.libraryDir}/${target}`);
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(full) instanceof TFile) {
            target = `${DIR_COVERS}/${base}-${n}.jpg`;
            full = normalizePath(`${this.settings.libraryDir}/${target}`);
            n++;
        }
        const buf = await this.fetchImageBuffer(url, referer);
        await this.app.vault.createBinary(full, buf);
        return target;
    }

    /**
     * #498 封面图片搜索（仅桌面端：走 `nodeHttpGet`，与其它反爬链路同一个网络栈）。
     * 用户原话：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」。
     * 🔴 平台门控在**这一层**（`searchPosterImages` 本身不判平台）—— 与 `searchOnlineLyrics` 同口径。
     */
    async searchPosterCandidates(
        query: string,
        page: number,
    ): Promise<{ candidates: PosterCandidate[]; error?: string }> {
        if (!Platform.isDesktopApp) return { candidates: [], error: '仅桌面端支持' };
        return searchPosterImages(
            { get: (url: string, headers?: Record<string, string>) => nodeHttpGet(url, headers) },
            query,
            page,        );
    }

    /**
     * #509 **按来源搜封面**（用户：「继续增强获取音乐类型条目封面的能力，网络搜索 / 四大音乐平台搜索封面」）。
     *
     * · `bing`（默认）= 既有的图片搜索（#498，全类型可用）；
     * · 四个音乐平台 = 走**既有的四平台搜索链**（`dlSearchSongs`，与「下载歌曲」窗口同一个函数，
     *   ⛔ 不另写请求），把结果里的封面按 `pure/posterSources` 的**实测规则**换成大图。
     *   - 网易云：搜索响应**不带封面** ⇒ 补一次 `song/detail`（`neteaseCoversByIds`，免 Cookie 实测可用）；
     *   - 酷我：用**专辑图**字段（`coverUrl` 那张是 MV 横图，用了会得到一张压扁的横图）。
     * 🔴 平台门控与必应那条**同口径**（仅桌面端）。
     * 🔴 **空结果不算失败**：平台搜到 0 条 ⇒ `{ candidates: [] }` 不带 `error`（由界面说「没搜到」）。
     */
    async searchPosterCandidatesBySource(
        source: PosterSource,
        query: string,
        page: number,
    ): Promise<{ candidates: PosterCandidate[]; error?: string }> {
        if (!Platform.isDesktopApp) return { candidates: [], error: '仅桌面端支持' };
        if (source === 'bing') return this.searchPosterCandidates(query, page);
        const q = String(query ?? '').trim();
        if (!q) return { candidates: [], error: '先填搜索词（默认用条目标题 + 作者，可以改）' };
        try {
            // 与「下载歌曲」窗口**同一个搜索函数**（平台顺序、去重、VIP 标注口径都一致）
            const { songs } = await this.dlSearchSongs(q);
            const mine = songs.filter((s) => s.source === source);
            if (!mine.length) return { candidates: [] };
            if (source === 'netease') {
                // 🔴 网易云搜索不给封面 ⇒ 补一跳详情（失败只让这条路为空，⛔ 不报错）
                const covers = await neteaseCoversByIds(this.dlTransport(), mine.map((s) => s.neteaseId));
                return {
                    candidates: platformCandidates(
                        'netease',
                        mine.map((s) => ({
                            name: s.name,
                            artist: s.artist,
                            album: s.album,
                            coverUrl: covers.get(Number(s.neteaseId)) ?? '',
                            pageUrl: s.webUrl,
                        })),
                    ),
                };
            }
            return { candidates: platformCandidates(source, mine) };
        } catch (e) {
            return { candidates: [], error: `平台搜索失败：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    /**
     * #498 把搜到的封面下载并本地化到 `封面/`（与既有封面本地化**同一条**命名 / 重名去重口径）。
     * 🔴 带**来源站自己**的 `Referer`（`pure/posterSearch.posterReferer` 从来源页取 origin）——
     *    这类图站多数按 Referer 防盗链，不带就常见 403（`fetchImageBuffer` 里有回落说明）。
     * ⚠️ 失败只回 `{ok:false, message}`：**由候选弹窗就地显示**，⛔ 不在这里弹 Notice
     *    （用户正在挑图，弹窗被打断反而更烦；而且这条链路失败是常态：图挂了 / 站挂了）。
     */
    async downloadSearchedPoster(
        candidate: PosterCandidate,
        title: string,
    ): Promise<{ ok: boolean; message: string; path?: string }> {
        const url = String(candidate?.murl ?? '').trim();
        if (!url) return { ok: false, message: '这张没有原图地址，换一张试试' };
        try {
            const path = await this.downloadPosterToLocal(url, title, posterReferer(candidate.page));
            return { ok: true, message: '封面已下载并设为封面', path };
        } catch (e) {
            return { ok: false, message: `这张下载失败：${e instanceof Error ? e.message : String(e)}（换一张试试）` };
        }
    }

    /** 单条目封面本地化：URL 封面下载到 封面/{标题}.jpg → poster 改相对路径；成功返回 {entry}，失败返回 {error}（原因供结果弹窗展示） */
    async localizeEntryPoster(id: string): Promise<{ entry?: MediaEntry; error?: string }> {
        const e = await this.service.get(id);
        if (!e || !e.poster || !/^https?:\/\//.test(e.poster)) return { entry: e };
        try {
            const target = await this.downloadPosterToLocal(e.poster, e.title);
            return { entry: await this.service.update(id, { poster: target }) };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }; // 下载失败：原因供结果弹窗排查
        }
    }

    /** 存量封面全量迁移进行中标志（防重复点击并发迁移；按钮保持可点击，重复点击给提示） */
    isMigratingPosters = false;

    /** 存量封面全量迁移：遍历 URL 封面逐个下载（限速 300ms/张、失败跳过），onProgress 实时回调进度，结束返回结果摘要（含失败原因与总数） */
    async localizeAllPosters(onProgress?: (done: number, total: number) => void): Promise<{ success: number; fail: number; failures: { title: string; reason: string }[]; skipped: boolean; total: number }> {
        if (this.isMigratingPosters) return { success: 0, fail: 0, failures: [], skipped: true, total: 0 };
        this.isMigratingPosters = true;
        try {
            const entries = await this.service.list();
            const urls = entries.filter((e) => e.poster && /^https?:\/\//.test(e.poster));
            const total = urls.length;
            let done = 0;
            let ok = 0;
            const failures: { title: string; reason: string }[] = [];
            for (const e of urls) {
                const r = await this.localizeEntryPoster(e.id);
                if (r.entry && !/^https?:\/\//.test(r.entry.poster ?? '')) ok++;
                else failures.push({ title: e.title, reason: r.error ?? '未知错误' });
                done++;
                onProgress?.(done, total);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            await this.refreshViews();
            return { success: ok, fail: failures.length, failures, skipped: false, total };
        } finally {
            this.isMigratingPosters = false;
        }
    }

    /** 存量封面高清化进行中标志（防重复点击并发迁移；与 isMigratingPosters 独立） */
    isUpgradingPosters = false;

    /** 存量豆瓣本地封面高清化（2026-09-09 用户反馈：游戏封面糊——搜索级 spic/s_ratio_poster 缩略档落库 70~100px）：
     *  遍历豆瓣源且 poster 已本地化的条目，读本地文件测宽 < 200px 判为模糊 → 回源豆瓣详情（fetchDetail，
     *  详情封面 URL 经 upscaleDoubanCover 高清化 + og:image 兜底）取高清封面 → 下载覆盖同名文件。
     *  失败（反爬/详情无封面/条目源 URL 缺失）跳过并记录原因；限速 300ms/张；onProgress 实时回调。
     *  返回 { scanned, upgraded, fail, failures }（skipped=true 表示已有迁移在跑）。 */
    async upgradeBlurredPosters(onProgress?: (done: number, total: number) => void): Promise<{ scanned: number; upgraded: number; fail: number; failures: { title: string; reason: string }[]; skipped: boolean }> {
        if (this.isUpgradingPosters) return { scanned: 0, upgraded: 0, fail: 0, failures: [], skipped: true };
        this.isUpgradingPosters = true;
        try {
            const entries = await this.service.list();
            const coverDir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
            // 扫描阶段收敛窄化：仅保留「豆瓣源 + poster 本地化 + 文件实测宽 <200px + 详情页链接」的候选，
            // 携带回源所需的全部字段，避免第二轮循环丢失 poster/sourceUrl 的窄化信息
            const candidates: { id: string; title: string; type: EntryType; sourceUrl: string; full: string }[] = [];
            for (const e of entries) {
                // 仅豆瓣源 + poster 本地化（封面/x.jpg）+ 有豆瓣详情页链接（回源依据）
                if (e.source !== 'douban' || !e.poster || /^https?:/.test(e.poster) || !e.sourceUrl) continue;
                const posterFile = e.poster.split('/').pop();
                if (!posterFile) continue;
                const full = normalizePath(`${coverDir}/${posterFile}`);
                const f = this.app.vault.getAbstractFileByPath(full);
                if (!(f instanceof TFile)) continue;
                try {
                    const bytes = await this.app.vault.readBinary(f);
                    const size = imageSizeFromBytes(bytes);
                    if (!size || size.width >= 200) continue; // 已高清/非图片跳过
                } catch { continue; }
                candidates.push({ id: e.id, title: e.title, type: e.type, sourceUrl: e.sourceUrl, full });
            }
            const total = candidates.length;
            let done = 0;
            let ok = 0;
            const failures: { title: string; reason: string }[] = [];
            for (const c of candidates) {
                const { title, type, sourceUrl, full } = c;
                try {
                    // sourceUrl 例：https://www.douban.com/game/26840375/、https://movie.douban.com/subject/1292052/
                    const idM = /(?:subject|game)\/(\d+)\/?$/.exec(sourceUrl);
                    if (!idM) throw new Error('详情页链接缺条目 ID');
                    const fields = await this.fetchDoubanDetailForEntry(idM[1], type);
                    const hd = fields?.cover as string | undefined;
                    if (!hd || !/^https?:\/\//.test(hd)) throw new Error('详情无网络封面（可能被反爬）');
                    const buf = await this.fetchImageBuffer(hd);
                    const f = this.app.vault.getAbstractFileByPath(full);
                    if (!(f instanceof TFile)) throw new Error('本地封面文件不存在');
                    await this.app.vault.modifyBinary(f, buf); // 覆盖写同名文件（poster 字段不变）
                    ok++;
                } catch (err) {
                    failures.push({ title, reason: err instanceof Error ? err.message : String(err) });
                }
                done++;
                onProgress?.(done, total);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            await this.refreshViews();
            return { scanned: total, upgraded: ok, fail: failures.length, failures, skipped: false };
        } finally {
            this.isUpgradingPosters = false;
        }
    }

    // ── v0.3 M4 数据管理：导出/恢复/CSV 导入 + 批量评分/标签 ──

    /** 导出 catalog JSON 快照到 {libraryDir}/备份/catalog-时间戳.json */
    async exportCatalogBackup(): Promise<void> {
        const entries = await this.service.list();
        const snapshot = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_BACKUPS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const path = normalizePath(`${dir}/catalog-${ts}.json`);
        await createVaultIO(this.app).writeText(path, snapshot);
        new Notice(`已导出备份：catalog-${ts}.json（${entries.length} 条）`);
    }

    /** 从备份 JSON 恢复（vault 内文件版）：读文本 → 走共用解析核心 */
    async restoreFromBackup(path: string): Promise<void> {
        try {
            const text = await createVaultIO(this.app).readText(path);
            await this.restoreFromBackupText(text);
        } catch (err) {
            new Notice(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 备份文本解析导入（vault 与系统文件共用核心）：合并去重（按 title+type，不覆盖已有条目） */
    async restoreFromBackupText(text: string): Promise<void> {
        try {
            const raw = JSON.parse(text) as unknown;
            const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { entries?: unknown[] }).entries) ? (raw as { entries: unknown[] }).entries : [];
            let added = 0;
            let skipped = 0;
            const existing = await this.service.list();
            for (const item of arr) {
                if (typeof item !== 'object' || item === null) {
                    skipped++;
                    continue;
                }
                const it = item as Record<string, unknown>;
                const title = typeof it.title === 'string' ? it.title : '';
                const type = ENTRY_TYPES.includes(it.type as EntryType) ? (it.type as EntryType) : null;
                if (!title || !type) {
                    skipped++;
                    continue;
                }
                if (existing.some((x) => x.title === title && x.type === type)) {
                    skipped++;
                    continue;
                }
                await this.service.create(it as Partial<MediaEntry>);
                added++;
            }
            new Notice(`备份恢复完成：新增 ${added}，跳过 ${skipped}（重复/无效）`);
            await this.refreshViews();
        } catch (err) {
            new Notice(`恢复失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 设置页按钮：弹出 vault 内 .json 文件选择 → 恢复 */
    openBackupPicker(): void {
        const files = this.app.vault.getFiles().filter((f) => f.extension === 'json');
        new VaultFileSuggest(this.app, files, (f) => void this.restoreFromBackup(f.path), '选择备份 JSON 文件…').open();
    }

    // ── v0.4 持续优化：系统文件对话框（Electron remote dialog + fs，Obsidian 社区成熟方案）──

    /** 探测系统文件对话框是否可用（Obsidian 渲染进程 require('electron').remote.dialog；旧版 File System Access API 在部分环境不可用会静默失败） */
    private hasSystemDialog(): boolean {
        try {
            const g = globalThis as unknown as { require?: (id: string) => unknown };
            const electron = g.require?.('electron') as { remote?: { dialog?: unknown } } | undefined;
            return !!electron?.remote?.dialog;
        } catch {
            return false;
        }
    }

    /** 系统「另存为」对话框：选择任意系统路径并写入文本；取消/失败返回 undefined（失败时 Notice 提示，不静默） */
    private async saveTextToSystem(defaultName: string, content: string): Promise<string | undefined> {
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showSaveDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePath?: string }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showSaveDialog) return undefined;
        try {
            const res = await dialog.showSaveDialog({
                title: '导出备份 JSON',
                defaultPath: defaultName,
                filters: [{ name: 'JSON 文件', extensions: ['json'] }],
            });
            if (res.canceled || !res.filePath) return undefined;
            const fs = g.require?.('fs') as { writeFileSync: (p: string, d: string, enc?: string) => void };
            fs.writeFileSync(res.filePath, content, 'utf8');
            return res.filePath.split(/[\\/]/).pop() ?? res.filePath;
        } catch (err) {
            new Notice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /** 系统「打开」对话框：选择任意系统路径文件并读取文本；取消/失败返回 undefined（失败时 Notice 提示） */
    private async openTextFromSystem(): Promise<{ name: string; text: string } | undefined> {
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showOpenDialog) return undefined;
        try {
            const res = await dialog.showOpenDialog({
                title: '选择备份 JSON 文件',
                filters: [{ name: 'JSON 文件', extensions: ['json'] }],
                properties: ['openFile'],
            });
            if (res.canceled || res.filePaths.length === 0) return undefined;
            const fs = g.require?.('fs') as { readFileSync: (p: string, enc?: string) => string };
            const text = fs.readFileSync(res.filePaths[0], 'utf8');
            return { name: res.filePaths[0].split(/[\\/]/).pop() ?? res.filePaths[0], text };
        } catch (err) {
            new Notice(`读取失败：${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /** 系统对话框导出备份：另存为 JSON → 系统路径（桌面端；非桌面/不可用走 vault 版） */
    async exportCatalogBackupToSystem(): Promise<void> {
        if (!this.hasSystemDialog()) {
            new Notice('当前环境不支持系统文件对话框，已改用 vault 内导出');
            await this.exportCatalogBackup();
            return;
        }
        const entries = await this.service.list();
        const snapshot = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name = await this.saveTextToSystem(`catalog-${ts}.json`, snapshot);
        if (name) new Notice(`已导出备份：${name}（${entries.length} 条）`);
    }

    /** 系统对话框恢复备份：打开任意位置 .json → 合并去重导入（桌面端；不可用回退 vault 选择器） */
    async restoreFromSystemFile(): Promise<void> {
        if (!this.hasSystemDialog()) {
            new Notice('当前环境不支持系统文件对话框，已改用 vault 内选择');
            this.openBackupPicker();
            return;
        }
        const f = await this.openTextFromSystem();
        if (!f) return;
        await this.restoreFromBackupText(f.text);
    }

    /** 批量设置个人评分（rating 0 = 清除） */
    async bulkSetRating(ids: string[], rating: number): Promise<void> {
        const r = Math.max(0, Math.min(5, Math.round(rating))) as Rating;
        for (const id of ids) {
            try {
                await this.service.update(id, { rating: r });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /** 批量追加标签（与已有 tags 合并去重，不覆盖） */
    async bulkAddTags(ids: string[], tags: string[]): Promise<void> {
        for (const id of ids) {
            try {
                const e = await this.service.get(id);
                if (!e) continue;
                const merged = Array.from(new Set([...(e.tags ?? []), ...tags]));
                await this.service.update(id, { tags: merged });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }
}

/** 取路径所在目录（分隔符不限 / \；无目录部分 → 原样返回）。系统文件对话框记忆目录用 */
function dirnameOf(p: string): string {
    const m = /^(.*)[\\/][^\\/]+$/.exec(p);
    return m ? m[1] : p;
}
