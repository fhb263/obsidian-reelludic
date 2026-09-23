// ReelLudic 插件入口：命令/视图/设置注册 + 服务编排
import { Plugin, WorkspaceLeaf, MarkdownView, requestUrl, TFile, TFolder, normalizePath, parseLinktext, Notice, Platform, moment, type FileSystemAdapter } from 'obsidian';
import { DEFAULT_SETTINGS, ReelLudicSettingTab } from 'Settings';
import type { ReelLudicSettings, SourceTestResult } from 'Settings';
import { measure, withTimeout, TimedError, TIMEOUT_MS, retry } from 'pure/timing';
import { CLOUD_VOICE_DEFAULT, buildSpeechBody, classifySpeechError, speechEndpointUrl } from 'pure/ttsCloud';
import { createSearchCache } from 'pure/searchCache';
import { normalizeUiTheme, THEME_CLASS } from 'pure/themeTokens';
import { checkAnimeUpdate, isBlockedPage, type UpdateCheckResult } from 'pure/updateCheck';
import { EntryService } from 'services/EntryService';
import { AiSummaryService } from 'services/aiSummary';
import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';
import { createVaultIO } from 'services/vaultIO';
import { TmdbClient, type TmdbDetail, type TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
import { BangumiClient, type BangumiSearchResult } from 'services/bangumi';
import { DoubanClient, DoubanCookieError, toTmdbResult, toBookResult, toGameResult, toMusicResult, toBangumiResult, toEntryDetailFields, type DoubanSubject } from 'services/douban';
import { OpenLibraryClient } from 'services/openLibrary';
import { GoogleBooksClient, buildSearchUrl } from 'services/googleBooks';
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
import { HomeView, HOME_VIEW_TYPE } from 'views/HomeView';
import type { HomeTab } from 'views/tab';
import { EntryModal } from 'modals/EntryModal';
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
import { buildTranslateBody, buildTranslatePingBody, parseTranslateResponse, translateChatUrl, normalizeProvider, normalizeAiChoice, AI_PROVIDER_OFF, type AiProviderChoice, type TranslateProvider, type TranslateRequestBody } from 'pure/translate';
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
import { isEmbeddableVideoPath, VIDEO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';
import { dirOfPath, fileNameOfPath, pickSubtitleCandidates, srtToVtt, type SubtitleCandidate } from 'pure/subtitle';
import { scanEpisodeNumbers } from 'pure/episodeScan';
import { initGlobalTooltip } from 'services/globalTooltip';
import { VideoPlayerView, VIDEO_PLAYER_VIEW_TYPE, type EmbedVideoItem, type VideoPlayerOptions } from 'views/VideoPlayerView';
import { mergeBySource, sortByRelevance } from 'pure/searchMerge';
import { PROVIDER_META, resolveSourceChain, sourceGroupForType, sourceEnLabel, deriveGroupSearchError, type AuxState, type SourceGroup, type ProviderId } from 'pure/sourceRegistry';
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

export default class ReelLudicPlugin extends Plugin {
    settings: ReelLudicSettings = DEFAULT_SETTINGS;
    service!: EntryService;
    private tmdb!: TmdbClient;
    private bangumi!: BangumiClient;
    private openLibrary!: OpenLibraryClient;
    private googleBooks!: GoogleBooksClient;
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
    /** 系统文件/目录选择器上次选中目录（会话级记忆）：逐集「浏览…」/批量检索接续上次位置（defaultPath） */
    private lastSystemDir = '';
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

        this.applyUiTheme();

        this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));
        this.registerView(VIDEO_PLAYER_VIEW_TYPE, (leaf) => new VideoPlayerView(leaf));
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
            // bangumi 仅服务 anime 组（1.0.3.1 起书籍类目搜索随漫画子视图下线，无需再按组类型分流）
            bangumi: (query) => this.bangumi.search(query),
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
    sourcesForType(type: EntryType): ProviderId[] {
        const group: SourceGroup = sourceGroupForType(type);
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
        // 1.0.3.1：原 comic 组（Bangumi 主源）随漫画子视图下线（用户 2026-09-13 裁定），书籍类目回归单链
        const group: SourceGroup = 'book';
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

    /** 音乐搜索（Douban 单源；结果缓存 30min） */
    async searchMusic(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`music:${q.toLowerCase()}`, () => this.searchMusicFresh(q, onProgress));
    }

    private async searchMusicFresh(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        // T8：music 默认链 douban→musicbrainz→itunes 三源 runner 全注册；musicbrainz 参与后 iTunes 并行补齐中文曲库
        const run = await this.collectGroupSources<MusicSearchResult>('music', 'music', query, toMusicResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
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
     *  注：不再弹「从库中选择 / 从系统浏览」二选一——点「浏览…」直接唤起系统文件管理器，少一步点击。 */
    private pickSystemFile(exts: string[], name: string, toRel: boolean): Promise<string | undefined> {
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
                            defaultPath: this.lastSystemDir || undefined,
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

    /** 选视频文件夹（「从文件夹检索剧集」目录选择器）：系统 openDirectory；同样接续上次浏览目录 */
    pickVideoDirPath(): Promise<string | undefined> {
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
                        defaultPath: this.lastSystemDir || undefined,
                    })
                    .then((res) => {
                        const d = !res.canceled && res.filePaths[0] ? res.filePaths[0] : undefined;
                        if (d) this.lastSystemDir = d;
                        resolve(d);
                    });
            } catch {
                resolve(undefined);
            }
        });
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

    /** 选本地视频：系统播放器需绝对路径，不转相对（可关联格式统一见 pure/mediaExtensions.VIDEO_ASSOCIABLE_EXTENSIONS） */
    async pickLocalVideoPath(): Promise<string | undefined> {
        return this.pickSystemFile([...VIDEO_ASSOCIABLE_EXTENSIONS], '视频', false);
    }

    /** 选本地音频（音乐条目） */
    async pickLocalAudioPath(): Promise<string | undefined> {
        return this.pickSystemFile(['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac'], '音频', true);
    }

    /** 选书籍文件（TXT/EPUB/PDF） */
    async pickBookFilePath(): Promise<string | undefined> {
        return this.pickSystemFile(['txt', 'epub', 'pdf'], '电子书', true);
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

    /** 播放音乐条目音频（「▶ 播放」）：audioPath vault 相对 → Obsidian 媒体视图（配合 LyricFlux 增强）；库外绝对路径 → 先尝试 Media Extended 播放器，失败回退系统播放器 */
    async playAudioEntry(entry: MediaEntry): Promise<void> {
        if (!entry.audioPath) {
            new Notice('未关联本地音频 — 编辑条目选择文件', 4000);
            return;
        }
        const f = this.app.vault.getAbstractFileByPath(entry.audioPath);
        if (f instanceof TFile) {
            await this.app.workspace.getLeaf('tab').openFile(f);
            return;
        }
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
        new Notice(`${label}已在设置中关闭（设置 → AI集成 · AI服务 可改为服务商重新启用）`, 4000);
        return true;
    }

    private async chatCompletion(input: {
        text: string;
        provider: TranslateProvider;
        prompt?: string;
        /** 用途名，进错误文案（「翻译失败：…」/「搜索失败：…」） */
        label: string;
        build: (text: string, provider: TranslateProvider, prompt?: string) => TranslateRequestBody | null;
    }): Promise<string | null> {
        const { text, provider, prompt, label, build } = input;
        const keyField = provider === 'zhipu' ? 'readerZhipuKey' : 'readerDeepseekKey';
        const key = ((this.settings as unknown as Record<string, unknown>)[keyField] as string | undefined ?? '').trim();
        const url = translateChatUrl(provider);
        if (!key) {
            new Notice(`未配置 ${provider === 'zhipu' ? '智谱' : 'DeepSeek'} API Key，请先到 设置 → AI集成 · API凭据 填写`, 4000);
            return null;
        }
        const body = build(text, provider, prompt); // 提示词可在设置页改；空文本返回 null → 不发请求
        if (!body) return null;
        try {
            // 15s 超时（远程推理需给足时间）
            const res = await withTimeout(
                requestUrl({
                    url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body),
                }),
                15000,
            );
            if (res.status === 401) {
                new Notice(`${label}失败：${provider === 'zhipu' ? '智谱' : 'DeepSeek'} API Key 无效（HTTP 401），请检查设置`, 5000);
                return null;
            }
            if (res.status === 429) {
                new Notice(`${label}失败：请求过于频繁或额度不足（HTTP 429）`, 5000);
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
            const out = parseTranslateResponse(json);
            if (!out) {
                new Notice(`${label}失败（模型未返回内容）`, 4000);
                return null;
            }
            return out;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`${label}失败：${msg || `无法连接 ${provider === 'zhipu' ? '智谱' : 'DeepSeek'}`}\n请检查网络或 API Key（${url}）`, 5000);
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
            label: '提问',
            build: (_t, provider) => buildSearchQuestionBody(text, question, provider),
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
                    const provider = normalizeProvider(this.settings.readerSummaryProvider);
                    const keyField = provider === 'zhipu' ? 'readerZhipuKey' : 'readerDeepseekKey';
                    const key = (((this.settings as unknown as Record<string, unknown>)[keyField] as string | undefined) ?? '').trim();
                    return { provider, key, prompt: this.settings.readerSummaryPrompt };
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

    /** 测试 AI 翻译连接（设置页按钮）：按服务商向端点发最小 ping；401=Key 无效、200=有效、429=限流等细分 */
    async testTranslateConnection(provider: TranslateProvider): Promise<SourceTestResult> {
        const label = provider === 'zhipu' ? '智谱 AI 翻译' : 'DeepSeek AI 翻译';
        const keyField = provider === 'zhipu' ? 'readerZhipuKey' : 'readerDeepseekKey';
        const key = ((this.settings as unknown as Record<string, unknown>)[keyField] as string | undefined ?? '').trim();
        return this.runTest(label, async () => {
            if (!key) return { ok: false, message: '未配置 API Key' };
            const url = translateChatUrl(provider);
            const body = buildTranslatePingBody(provider);
            try {
                const res = await requestUrl({
                    url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body),
                });
                if (res.status === 200) return { ok: true, message: '连接成功：API Key 有效' };
                if (res.status === 401) return { ok: false, message: '连接失败：API Key 无效（HTTP 401）' };
                if (res.status === 429) return { ok: false, message: '连接失败：请求过于频繁或额度不足（HTTP 429）' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }


    /**
     * 测试云合成连接（设置页「AI集成 › API凭据 · 硅基流动 › 测试连接」，#344 方案 C）。
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
    private async fetchImageBuffer(url: string): Promise<ArrayBuffer> {
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
        const res = await requestUrl({ url, method: 'GET', responseType: 'arraybuffer' } as unknown as Parameters<typeof requestUrl>[0]);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        return (res as unknown as { arrayBuffer: ArrayBuffer }).arrayBuffer;
    }

    /** 下载 URL 图片到 封面/ 目录（命名 封面/{标题}.jpg，同标题重名追加 -2/-3 防覆盖），返回相对路径 */
    async downloadPosterToLocal(url: string, title: string): Promise<string> {
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
        const buf = await this.fetchImageBuffer(url);
        await this.app.vault.createBinary(full, buf);
        return target;
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
