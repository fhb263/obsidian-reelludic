<script lang="ts">
    import { lrcTranslatableCount } from 'pure/lrcBilingual';
    import { buildPlatformCoverQuery, posterSourcesFor, type PosterSource } from 'pure/posterSources';
    import { onMount, onDestroy, tick } from 'svelte';
    import { ENTRY_TYPE_LABELS, type EntryType } from 'data/types';
    import { statusLabel, statusVerb } from 'pure/labels';
    import { reconcileBookProgress, pageFromPercent, type BookProbeResult, type BookProgressFields } from 'pure/bookProgress';
    import { parseSeriesIndexInput } from 'pure/seriesGroup';
    // 🔴 #632 连续添加（新建条目保存后**回候选列表**继续挑）：候选键 / 序号 +1 / 两处文案的唯一真源
    import { repeatHint, resultKeyOf, submitLabel, type RepeatAddState } from 'pure/repeatAdd';
    import { episodeHintLabel, storeEpisodeList, episodeSectionSize, episodeSections, clampTabIndex, tabIndexOfEpisode } from 'pure/episodeAssoc';
    import { episodeTitleFromName } from 'pure/episodeScan';
    import { cleanPastedText, readClipboardText } from 'services/clipboard';
    import { normalizeBookKind, BOOK_KIND_LABELS } from 'pure/bookKind';
import { toSearchTypeSel, applySearchTypeSel, type SearchTypeSel } from 'pure/searchTypeSel';
    import { normalizeMusicKind } from 'pure/musicKind';
    // #563 自动保存轻提示的文案与时长真源（⛔ 别在模板里手写「设置已保存」）
    import { TOAST_SAVED, TOAST_FAILED, TOAST_MS, shouldFlashSaved } from 'pure/toast';
    // #568/#569/#583 浮层自动保存的**触发判据**与**就地提示键空间**真源
    // （纯模块 + 单测；⛔ 别在组件里再写一遍条件、也别手写裸键名 —— 拼错是静默的）
    import { AUTOSAVE_KEYS, shouldAutoSave, type AutoSaveKey } from 'pure/popoverAutoSave';
    // #563 未配置分类目录时的警告原文（唯一一份，与宿主 `searchLocalEpisode` 的 'nodir' 语义配对）
    import { LOCAL_DIR_MISSING_WARN, type LocalEpisodeOutcome, type LocalEpisodeQuery } from 'pure/localEpisode';
    // 🔴 #602：书籍本地检索的查询 / 结果形状（与关联弹窗**同一份** —— 收在纯模块，⛔ 别在组件侧另立一个）
    import type { LocalBookSearchQuery, LocalFileSearchOutcome } from 'pure/localDirs';
    import { placeMenu } from 'pure/menuPlacement';
    import { AI_HIGHLIGHT_SUGGEST, aiFieldsToText, textToAiFields } from 'pure/aiSummary';
    import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';
    // #499 AI 预填（新增条目的标题行 ✨）：字段目录 / 预览行合成都在纯模块里
    import { prefillFieldsFor, buildPrefillRows } from 'pure/aiPrefill';
    import type { AiPrefillInput, AiPrefillOutcome, PrefillFieldKey, PrefillRow } from 'pure/aiPrefill';
    import { Notice } from 'obsidian';
    import { posterUrl } from 'services/tmdb';
import { shouldAdoptCover } from 'pure/posterPolicy';
    import type { TmdbDetail, TmdbSearchResult } from 'services/tmdb';
    import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
    import type { BangumiSearchResult } from 'services/bangumi';
    import { describeSearchResult, sourceIdOf, SOURCE_VIEW } from 'pure/searchDisplay';
    import { sourceEnList, sourceEnLabel, sourceLabel, platformLabelFromUrl, providerFromUrl } from 'pure/sourceRegistry';
    import { mergeTmdbDetail } from 'pure/resultMerge';
    import type { LyricCandidate, LyricSourceId } from 'pure/lyricOnline';
    import { formatCandidateLabel } from 'pure/lyricOnline';
    // #529 书籍「检索在线书籍阅读」：检索词与候选形状都来自 `pure/weread`（组件不碰网络，只画列表）
    import { buildWereadQuery, type WereadCandidate, type WereadBookInfo } from 'pure/weread';
    // #527 剧集链接失效：状态类型与判据在 `pure/linkStatus`（探测在宿主 `services/linkCheck`）
    import type { LinkStatus } from 'pure/linkStatus';
    // #500③ 集编辑浮层的「B站」按钮复用**音乐下载那条 B 站搜索链**（同一个 `pure` 解析 + 同一个服务）
    import {
        biliCheckedRows,
        biliEpisodeQuery,
        biliPartTitles,
        biliSelectableRows,
        buildBiliFillRows,
        buildBiliPartUrl,
        formatBiliPlay,
        urlUsedByOtherEp,
        type BiliFillRow,
        type BiliPart,
        type BiliVideo,
    } from 'pure/dl/bilibili';
    // 🔴 #519：批量搜索未填集（确认表）—— 循环/限速/遇错即停/行模型全在纯模块，
    //    ⛔ 组件里只留「画」与状态，别自己维护游标与进度（与快捷关联弹窗**同一份**）。
    import {
        BATCH_PARTS_ANCHOR,
        batchCheckedRows,
        batchFillTitles,
        batchProgressText,
        batchSleep,
        batchStopText,
        buildBatchTargets,
        bvidFromPaste,
        canExpandParts,
        canFillBatch,
        candidatesToMark,
        epRangeOf,
        filterTargetsByRange,
        makeBatchRows,
        normalizeEpRange,
        partCountLabel,
        pickedCandidate,
        pickedUrl,
        runBatchSearch,
        titleMatchesWork,
        withChecked,
        withPartCount,
        withPicked,
        type BatchRow,
        type BatchTarget,
    } from 'pure/biliBatch';
    import { formatDuration } from 'pure/dl/utils';
    import { pickLibraryAudio, type LibraryAudioFile } from 'pure/libraryAudio';
    import { audioExtOf, audioStemOf } from 'pure/renameAudio';
    import { buildPosterQuery } from 'pure/posterSearch';
    import { mediaInfoLine, type MediaInfo } from 'pure/mediaInfo';
    import { pickLibraryBook, type LibraryBookFile } from 'pure/libraryBooks';
    /** #464 在线曲库：音乐态结果区的那一栏（id 从纯模块取，⛔ 别写字面量） */
    import { SONG_LIB_ID } from 'pure/songLibrary';
    // 🔴 #685 音乐「网络地址」在线检索：候选形状与**快捷关联弹窗同一份**（⛔ 别在组件里另写一个形状）
    import type { PlayableCand, PlayableCandOutcome } from 'modals/QuickAssociateModal';
    import type { LyricFetchOutcome, LyricSearchOutcome } from 'services/lyricSearch';
    import { communityScoreIssue, entrySourceLabel, parseCommunityScore, parseRatingCount, parseSourceName, ratingCountIssue, sourceNameIssue, sourceUrlIssue, splitScoreCount } from 'pure/sourceMeta';
    // #619 半星：存储恒为 0~5 步长 0.5；界面按 10 分制显示与输入（`ratingToTenths` / `tenthsToRating`）
    import { isHalfStarClick, ratingToTenths, stepRating, tenthsToRating } from 'pure/rating';
    import type { SearchProgressCb, SearchProgress } from 'pure/searchProgress';
    // 🔴 #559：模拟进度条的**时间线**（五段曲线 + 慢网络提示 + 重试阈值）全在 `pure/simProgress`
    // ⛔ 别在本组件里再写一套「每 N ms 随机加几」——那正是本批要换掉的旧形态。
    import { simPctAt, simVisibleAt, simSlowTextAt, simShowRetryAt } from 'pure/simProgress';
    import type { MediaStatus } from 'pure/status';
    import Icon from './Icon.svelte';
    // 🔴 #668 关联功能区（关联图谱 / 关联条目）**已按用户裁定整体下线归档**：
    //    「编辑条目的关联功能区全部给我移除掉吧归档下未来实现」。
    //    ⚠️ 只是**没有入口**，数据层（`MediaEntry.related` / `normalizeEntry` 白名单 / 笔记 `## 关联` 章节）
    //       与 `pure/relatedGraph.ts` + 它那套单测**全部原样保留** —— 重新上线时把入口接回来即可。
    import type { RelatedLink } from 'data/types';
    import type { MediaEntry, BookKind, MusicKind, EntryLogKind } from 'data/types';

    type SearchResult = TmdbSearchResult | OmdbSearchResult | BookSearchResult | GameSearchResult | BangumiSearchResult | MusicSearchResult;

    /** 状态选项（想看/在看/已看/存档；存档选中时右侧不显示日期输入框；弃剧已移除，旧数据 dropped 编辑保存时迁移为存档） */
const STATUS_OPTIONS: MediaStatus[] = ['want', 'watching', 'watched', 'archived'];

/** 类型下拉选项（显式顺序，2026-09-12 用户指定）：文学 → 网文 → 漫画 → 动画 → 剧集 → 电影 → 游戏 → 音乐
 *  （网文 / 漫画 = 书籍类目子类的搜索快捷态，非独立 EntryType）。
 *  🔴 2026-09-30 用户裁定**加回「漫画」**（1.0.3.1 曾删，2026-09-13 裁定）：紧跟网文 ⇒ 书籍三个子类连排。 */
const TYPE_OPTIONS: ReadonlyArray<{ value: SearchTypeSel; label: string }> = [
    { value: 'book', label: '文学' },
    { value: 'novel', label: '网文' },
    { value: 'comic', label: '漫画' },
    { value: 'anime', label: ENTRY_TYPE_LABELS.anime },
    { value: 'tv', label: ENTRY_TYPE_LABELS.tv },
    { value: 'movie', label: ENTRY_TYPE_LABELS.movie },
    { value: 'game', label: ENTRY_TYPE_LABELS.game },
    { value: 'music', label: ENTRY_TYPE_LABELS.music },
];

    export let initialType: EntryType = 'movie';
/** 新增模式初始书籍分类：书籍页签聚焦子分类（漫画/网文）点「＋ 添加」传入（漫画态下拉选中「漫画」） */
export let initialBookKind: BookKind | undefined = undefined;
    export let entry: MediaEntry | null = null;
    /**
     * 🔴 #632 连续添加：本窗是**新建**态、且上一次刚保存过 ⇒ 宿主把会话状态注回来，于是
     * 「保存后窗口不消失」的落点是**回到候选列表**（而不是停在一张空表单上）。
     * ⚠️ 这几个 prop **只在组件重建时**由宿主注入（见 `EntryModal.mountForm`）——
     *    ⛔ 别指望它们随 `$set` 变化实时生效（初值语义）。
     */
    /** 上一次的候选列表（原样带回；空数组 = 首次打开） */
    export let presetResults: SearchResult[] = [];
    /** 搜索框里保留的关键词（接着挑下一条通常还要用它） */
    export let presetQuery = '';
    /** 已经建成条目的候选键集（`resultKeyOf`）—— 命中的卡片压暗 + 标「已添加」 */
    export let addedHits: Set<string> = new Set();
    /** 新建态的「系列名称 / 系列序号」初值（序号已由宿主 +1；见 `pure/repeatAdd.nextSeriesIndexLabel`） */
    export let initialSeries = '';
    export let initialSeriesIndex = '';
    export let canSearch: boolean = false;
    export let canSearchBook: boolean = true;
    export let canSearchGame: boolean = false;
    export let onSearch: (q: string, t: 'movie' | 'tv', onProgress?: SearchProgressCb) => Promise<TmdbSearchResult[]> = async () => [];
    export let onSearchBook: (q: string, kind?: BookKind, onProgress?: SearchProgressCb) => Promise<BookSearchResult[]> = async () => [];
    export let onSearchGame: (q: string, onProgress?: SearchProgressCb) => Promise<GameSearchResult[]> = async () => [];
    export let onSearchAnime: (q: string, onProgress?: SearchProgressCb) => Promise<BangumiSearchResult[]> = async () => [];
    export let onSearchMusic: (q: string, onProgress?: SearchProgressCb) => Promise<MusicSearchResult[]> = async () => [];
    /**
     * 🔴 ⑬ 搜索累积（用户 2026-10-22：「给搜索添加条目返回的如上限20条可再搜索突破，可存储持久化上次搜索已有的」）。
     *
     * 各源自己的截断（豆瓣 30 / TMDB 30 / Bangumi 30 / IGDB 30 / MangaDex 20 / AniList 20）是**单次请求**
     * 的天花板，改不动接口；能突破的是**跨多次搜索的累积** —— 换个关键词再搜，新结果去重后并进旧池。
     *
     * 宿主侧实现 = `main.mergeSearchPool`（合并 + 落盘 `{lib}/search-pool.json`，口径在 `pure/searchAccum`）。
     * ⛔ 组件不碰 vault、不碰磁盘：这里只是个回调，拿合并后的完整列表回去渲染。
     * ⚠️ 缺省实现 = **不累积**（直接返回本次结果），保证单测里裸挂组件时行为与旧版逐字一致。
     */
    export let onMergeSearchPool: (type: EntryType, bookKind: BookKind | undefined, fresh: SearchResult[]) => Promise<SearchResult[]> = async (_t, _k, fresh) => fresh;
    export let onFetchDetail: (r: TmdbSearchResult) => Promise<Partial<TmdbDetail> & { posterPath?: string }> = async () => ({});
    /** 豆瓣兜底详情按需补全：选中搜索结果时动态拉取 JSON-LD + #info（仅前 3 条搜索时预补全） */
    export let onFetchDoubanDetail: (id: string, type: EntryType) => Promise<Record<string, unknown> | null> = async () => null;
    /**
     * 🔴 #623 Steam 游戏详情按需补全（选中 Steam 结果时调用：appdetails → 平台 / 开发商 / 发行年 / 题材 / 简介）。
     * ⚠️ 与 `onFetchDetail`（只通 TMDB）**是两条独立回调**，⛔ 别合并：把 Steam 的 appid 交给 TMDB 客户端
     *    会拼出 `.../undefined/{appid}` 打 404（本批修的就是这个）。
     * 返回的键名与豆瓣详情同形 ⇒ 回填复用同一支 `applyDoubanDetail`；失败 `null` 静默。
     */
    export let onFetchSteamDetail: (appid: number) => Promise<Record<string, unknown> | null> = async () => null;
    /** Bangumi 详情按需补全（选中搜索结果时调用：persons+subjects API → 导演/评分/主演） */
    export let onFetchBangumiDetail: (id: number) => Promise<{ rating?: number; ratingCount?: number; director?: string; cast?: string[] }> = async () => ({});
    /** Open Library 书籍详情按需补全（选中搜索书籍时调用：works.json → 简介/页数/出版社；失败返回 null 静默） */
    export let onFetchOpenLibraryDetail: (key: string) => Promise<Record<string, unknown> | null> = async () => null;
    /**
     * 🔴 #609 拉**一本微信读书书的详情**（`/web/book/info?bookId=`）—— 与「从微信读书同步书架」逐本补详情
     * **同一个端点、同一份解析**（宿主 `main.fetchWereadBookInfo`）。
     * ⚠️ 需要已填 Cookie；没填 / 失败 ⇒ 返回 `null`，本组件**静默保留搜索级字段**（与豆瓣详情同款降级）。
     */
    export let onFetchWereadDetail: (bookId: string) => Promise<WereadBookInfo | null> = async () => null;
    /** OMDb（IMDb）影视详情按需补全（选中结果时调用：i= 详情 → Plot/导演/演员/评分；失败返回 null 静默） */
    export let onFetchOmdbDetail: (imdbID: string) => Promise<Record<string, unknown> | null> = async () => null;
    export let onSubmit: (input: Record<string, unknown>) => Promise<void> = async () => {};
    export let onCancel: () => void = () => {};
    /** 点击来源徽标直达数据源官方页（弹窗侧校验 http/https） */
    export let onOpenSource: (url: string) => void = () => {};
    /** 「集按钮」打开本地剧集视频（弹窗侧 Electron 系统播放器） */
    export let onPlayEpisode: (path: string) => void = () => {};
    /** 「浏览」系统文件选择器选本地视频（Electron remote.dialog 返回绝对路径；input file 的 File.path 在 Obsidian 不可用） */
    export let onPickLocalVideo: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 「总结摘要」小标题右侧 ✨：AI 生成一句话总结 + 核心看点（复用阅读器翻译的服务商与 Key；失败返回 null） */
    export let onAiSummarize: (input: AiSummaryInput) => Promise<AiSummaryResult | null> = async () => null;
    /**
     * #499 新增条目标题行 ✨：AI 按「类型 + 标题」预填**客观字段**（返回字段表 + **工具来源**；失败/未配置返回 null 且宿主已提示）。
     * 🔴 只回字段、不落库：本组件先把「旧值 / 新值」列成预览，**二次确认后**才写回表单。
     * 🔴 #499D：第二参 `onStep` = agent 回路里每次调工具的进度回执（如「搜索网络：…」）——
     *    宿主执行工具、组件只负责显示（⛔ 组件不碰网络，也⛔ 不认识服务层类型）。
     */
    export let onAiPrefill: (
        input: AiPrefillInput,
        onStep?: (label: string) => void,
    ) => Promise<AiPrefillOutcome | null> = async () => null;
    /** 「本地音频」系统文件选择器选音乐文件（返回 vault 相对路径，库外绝对路径） */
    export let onPickLocalAudio: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** #462 「播放」按钮悬停提示：探关联音频的体积 + 时长（宿主实现；两项都可缺 —— 拿不到就不显示那一段） */
    export let onProbeAudioInfo: (path: string) => Promise<MediaInfo> = async () => ({});
    /** 「启动快捷方式」系统文件选择器选游戏 .lnk（返回 vault 相对路径，库外绝对路径） */
    export let onPickGameLaunch: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 编辑模式删除条目（弹窗侧提供确认与刷新） */
    export let onDelete: () => Promise<void> = async () => {};
    /** 结果栏数上报（宿主据此动态调弹窗宽度：三栏并排需加宽，一/两栏与编辑态用常规宽度）；
     *  0 = 未展示结果（搜索输入中/已选结果进编辑/手动填写） */
    export let onResultCols: (cols: number) => void = () => {};
    /** 某类型本次搜索实际会发起的源集合（固定占栏依据：栏位只随源链/凭据配置变化，不随源成败增减）。
     *  🔴 2026-09-30 起带 `kind`：漫画独立成组后，书籍态要按子分类问（漫画 = 豆瓣单源、文学/网文 = 书籍链）。 */
    export let onSourcesForType: (type: EntryType, kind?: BookKind) => string[] = () => [];
    /** 书籍编辑表单「添加摘抄」：弹窗侧打开摘抄录入（固定挂载当前条目） */
    export let onAddExcerpt: () => void = () => {};
    /** 书籍编辑表单「阅读」：打开书籍阅读器，关闭后返回最新阅读进度（percent 真源 → 表单自动同步当前页/章） */
    export let onOpenReader: () => Promise<BookProgressFields | undefined> = async () => undefined;
    /** 书籍编辑浮层「浏览」：系统文件选择器选 TXT/EPUB/PDF，返回 vault 相对路径 */
    export let onPickBookFile: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /**
     * 🔴 #539 书籍「选文件夹」：漫画「散装文件夹型」把**文件夹本身**关联成书。
     * ⚠️ 与 `onPickBookFile` 分开两枚回调 —— Electron 在 Windows/Linux 上不能同时选文件与目录。
     */
    export let onPickBookFolder: () => Promise<string | null | undefined> = async () => undefined;
    /** 书籍「进度页数」自动关联：探针本地书籍文件基准（PDF → numPages；TXT → 按章节解析 totalChapters；EPUB/失败 → undefined） */
    export let onProbeBookPages: (path: string) => Promise<BookProbeResult | undefined> = async () => undefined;
    /** 选视频文件夹（动画/剧集「从文件夹检索剧集」目录选择器；非桌面/取消 → undefined） */
    export let onPickVideoDir: () => Promise<string | undefined> = async () => undefined;
    /** 读文件夹内视频并识别集号（按集号升序 {ep,path,name}；不可读/无命中 → []） */
    export let onScanEpisodeDir: (dir: string) => Promise<{ ep: number; path: string; name: string }[]> = async () => [];
    /** 游戏编辑表单「▶ 启动」：弹窗侧启动游戏（编辑模式挂载当前条目；表单新选未保存时以已存条目为准） */
    export let onLaunchGame: () => void = () => {};
    /** 音乐编辑表单「▶ 播放」：弹窗侧播放音频（同上） */
    export let onPlayMusic: () => void = () => {};
    /** 音乐编辑表单「获取歌词」（#396）：四源并行搜索在线歌词，返回**已排序截断**的每源候选。
     *  仅桌面端可用（宿主按 `Platform.isDesktopApp` 门控）⇒ 移动端按钮不出现。 */
    export let onSearchLyrics: (title: string, author: string) => Promise<LyricSearchOutcome> = async () => ({ query: null, results: [] });
    /** 音乐编辑表单「填入」某条候选（#396）：取该源该条的歌词正文（`text: null` 且无 `error` = 该源确实没歌词） */
    export let onLoadLyric: (source: LyricSourceId, id: string) => Promise<LyricFetchOutcome> = async () => ({ text: null });
    /** 打开音乐条目时从笔记 ` ```lrc ` 块读回的歌词正文（#396；无笔记/无歌词 ⇒ `''`） */
    export let initialLrc = '';

    /**
     * 🔴 #507 **AI 双语歌词**（用户：「为当前 LRC 歌词 AI 搜索并生成双语歌词
     * `[00:15.16]hello | 你好` 格式，入口（小图标按钮）排在**搜歌词图标按钮旁边**」）。
     * · 宿主那侧复用「AI集成 › 翻译服务」的服务商与 Key（与摘要/预填同款；门控与提示都在那里）；
     * · 返回**合并后的整份 LRC**（时间标签一个字不动）+ `applied / missing`（没拿到译文的行数，原样保留）；
     * · 失败 / 未配置 ⇒ `null`（宿主已 Notice），组件保持原样。
     * ⚠️ 写回的是 `lrc` 这个**表单字段**（与「获取歌词」同一条纪律：只填框，仍要点「保存」才落库）。
     */
    export let onAiBilingualLrc: (
        lrc: string,
        meta?: { title?: string; artist?: string },
    ) => Promise<{ text: string; applied: number; missing: number } | null> = async () => null;

    /**
     * 🔴 #500③（用户：「在全类型编辑条目的编辑观看链接的右键窗口中，为网络地址增加搜索 B 站并返回链接的功能」）：
     * 集编辑浮层「网络地址」行里那枚「B站」按钮的搜索通道（宿主 `main.dlBiliSearch` → `services/dl/bilibili`）。
     * · 只**返回候选**，⛔ 不下载（下载是音乐下载弹窗那条路的职责，别把两件事混起来）；
     * · 宿主那侧按 `Platform.isDesktopApp` 门控并给出「仅桌面端支持」的文案 ⇒ 组件不重复判断。
     */
    export let onBiliSearch: (keyword: string) => Promise<{ videos: BiliVideo[]; error?: string }> = async () => ({
        videos: [],
        error: 'B 站搜索不可用',
    });

    /**
     * 🔴 #505（用户：「如何应对多剧集如熊出没 52 集如何搜索 b 站视频返回链接」＋后续裁定
     * 「**入口 C**，已填过链接的集**弹勾选让我选**」）：取一条视频的**分P 列表**。
     * · 为什么必须先取它：搜索接口**不返回分P 数**（实测），所以「这一条是单P 还是 52P」
     *   只能点开才知道 —— 这正是「入口 C = 展开分P 勾选」的物理前提；
     * · ⚠️ 宿主那侧按 `Platform.isDesktopApp` 门控（与搜索同口径）；
     * · ⚠️ 失败 / 单P ⇒ 组件**回落到「直接填这一条」**（⛔ 别让多出来的这一步把老路堵死）。
     */
    export let onBiliParts: (
        bvid: string,
    ) => Promise<{ title: string; parts: BiliPart[]; error?: string }> = async () => ({
        title: '',
        parts: [],
        error: 'B 站分P 不可用',
    });

    /**
     * 🔴 #529（用户：「在书籍条目加检索在线书籍阅读小图标按钮（网络链接回填）」）：
     * 书籍「网络地址」行里那枚小图标按钮的检索通道（宿主 `main.searchWeread` → `services/weread`）。
     * · 检索源 = **微信读书**网页版（免登录搜索；回填的是 `web/reader/<hash>` 在线阅读链接）；
     * · 只**返回候选**，⛔ 不下载、不解析正文（回填到表单 `readUrl`，仍要点「保存」才落库）；
     * · 宿主那侧按 `Platform.isDesktopApp` 门控并给出文案 ⇒ 组件不重复判断。
     */
    export let onSearchWeread: (keyword: string) => Promise<{ books: WereadCandidate[]; error?: string }> = async () => ({
        books: [],
        error: '微信读书检索不可用',
    });

    /**
     * 🔴 #685（用户：「音乐也要加网络检索小图标按钮，参考弹出搜索b站视频链接回填就行了」）：
     * 音乐「网络地址」标签行那枚 globe 的检索通道（宿主 `main.searchSongLibraryForAssociate` → **在线曲库**）。
     * · 检索源 = 在线曲库（与「快捷关联」弹窗里那枚同一条链：dlSearchSongs → songLibraryResults）；
     * · 只**返回候选**（歌名 / 歌手·专辑 / 平台试听页链接），⛔ 不下载、不解析正文；
     * · 回填目标 = 音乐「网络地址」输入框（程序填入 ⇒ 与「粘贴」同口径当场落库）；
     * · 宿主那侧按 `canUseSongLibrary()` 门控并给文案 ⇒ 组件不重复判断。
     */
    export let onSearchSongLibrary: (keyword: string) => Promise<PlayableCandOutcome> = async () => ({
        cands: [],
        error: '在线曲库检索不可用',
    });

    /**
     * 🔴 #527 / #531：本条目各集的**链接失效状态**（与 `episodeUrls` 下标对齐；`'ok' | 'dead' | 'unknown'`）。
     * · 由 `EntryModal` 从宿主**内存缓存**读一次注入（缓存由设置页那枚「失效链接检测」扫全库时写入）；
     * · 本组件只**显示**：失效集按钮标红 + 悬停提示加一句「⚠ 链接可能已失效」。
     * · ⛔ 本组件**不再**发起检测（入口已按用户指令挪到设置页）；缺席 ⇒ `[]` ⇒ 不标红。
     */
    export let linkStatuses: (LinkStatus | undefined)[] = [];

    /**
     * ⑤-c：是否显示「下载」按钮（真源 = 设置里的「启用内置音乐播放器」开 + 桌面端）。
     * ⚠️ 由 `EntryModal` 按当前设置传入 —— ⛔ 别在组件里读 settings（组件不认识 plugin）。
     */
    export let canDownload = false;
    /**
     * #538：是否显示结果区那栏「在线曲库」（真源 = 宿主 `canUseSongLibrary()` = 能力 ∧ 用户开关，默认关）。
     * ⚠️ 只喂给 `songLibOn` 一个消费点；⛔ 别拿它去门控「下载歌曲」按钮（那是 `canDownload` 的事）。
     */
    export let songLibraryEnabled = false;
    /* 🔴 #523：书籍那枚「下载」小按钮**整对撤除**（连它要的两个 prop 一起删）—— 用户 2026-10-04 裁定
       「下载只保留音乐」⇒ 书籍「路径」旁只留「检索本地书籍」那一枚。
       ⚠️ 下载**实现本体**（`BookDownload.svelte` / 宿主那支 open…Downloader 方法 / 书源服务）与两条
       命令面板入口原样保留，`pure/featureGate` 的门控清单已同步改写。
       ⚠️ 这里**刻意不写**被删那两个 prop 的全名：本仓注释会进产物，抄了就会撞红自己的反向守卫（老坑）。 */
    /**
     * ⑤-c：打开「下载歌曲」弹窗。`onPicked` 回传下载好的**库内相对路径**，
     * 组件据此把「本地音频」指过去（仍走正常的保存流程落库，⛔ 不在这里直接写 catalog）。
     */
    export let onOpenDownloader: (
        title: string,
        author: string,
        onPicked: (relPath: string) => void,
    ) => void = () => {};
    /**
     * ⑤-c / #402：下载成功后把「本地音频」**直接写回条目**的出口（编辑态生效，新增态宿主 no-op）。
     * 组件只管调；落库与提示都在宿主（`EntryModal`）—— ⛔ 组件不碰 catalog。
     */
    export let onApplyAudio: (relPath: string) => Promise<void> | void = () => {};
    /**
     * #404：**库内音乐目录**下的音频清单（「本地音频」浮层里那枚「检索同名音频」小按钮用）。
     * 宿主注入（`main.listLibraryAudioFiles`：目录真源 = `downloadDir(root,'music')`）——
     * ⛔ 组件不碰 vault；匹配与排序在纯模块 `pure/libraryAudio`。
     */
    export let onListLibraryAudio: () => LibraryAudioFile[] = () => [];
    /**
     * #497：**改关联音频文件的名字**（用户：「再添加在音乐条目上修改关联的音频文件名称的功能」）。
     * 纯逻辑在 `pure/renameAudio`、动磁盘与写库在宿主（`main.renameEntryAudio`）——
     * ⚠️ 组件**只传当前路径 + 新主名**，扩展名由纯模块锁死（⛔ 别把整名传下去，那等于允许改扩展名）。
     * 返回的 `path` = 改名后的新路径（成功时组件要用它同时刷新「文件路径」与表单 `audioPath`）。
     */
    export let onRenameAudio: (
        currentPath: string,
        newStem: string,
    ) => Promise<{ ok: boolean; message: string; path?: string }> = async () => ({ ok: false, message: '' });
    /**
     * 🔴 #602：书籍「检索本地」—— 与影视单集本地检索（`onSearchLocalEpisode`）**同一条链**。
     *
     * 由来：用户报障「书籍关联入口这个小图标按钮怎么是选文件夹关联的，统一成检索关联」（问答裁定
     * 「两处一起改」）⇒ #524 那套「先弹系统目录选择器 → 列该目录 → 匹配」**对书籍作废**，
     * 改成**不问用户**：宿主按子分类取设置里的「文学 / 网文 / 漫画目录」（`pure/localDirs`），
     * 递归扫 + 按标题匹配（`pure/libraryBooks.pickLibraryBook`）。
     * ⚠️ 与影视那条不同的是**返回值形状**：影视是「三态码」（`ok` / `'nodir'` / `'notfound'`），
     *    这条直接回一句**给用户看的文案**（`notice`）—— 本组件把它原样弹出去，⛔ 不再自己编措辞。
     * ⚠️ 三个一并退场的 prop（`onPickBookDir` / `onListBookFilesInDir` / `onListLibraryBooks`）与
     *    对应的宿主方法都已删 —— ⛔ 别「留着备用」，那正是本仓明令禁止的死代码。
     */
    export let onSearchLocalBook: (q: LocalBookSearchQuery) => Promise<LocalFileSearchOutcome> =
        async () => ({ notice: '当前环境不支持本地检索' });
    /**
     * 🔴 #534：游戏「检索本地」—— 🔴 #602 起它是**全仓唯一**还「先挑目录」的本地检索
     * （书籍改走分类目录、音乐走音频目录，都不问用户）。
     * 用户（2026-10-05）：「希望全类型条目启动路径旁都添加统一本地路径和网络路径检索小图标按钮」。
     * ⚠️ 游戏**不接在线检索源**（用户裁定：「不接，仅在右键弹窗加网络路径框（加粘贴文字按钮）」）——
     *    所以游戏行内只有这**一枚**本地检索；网络路径靠浮层手填/粘贴。
     * 三态口径与 `onPickVideoDir` **完全一致**（`string` 选中 / `null` 用户取消 / `undefined` 本环境无对话框）。
     */
    export let onPickGameDir: () => Promise<string | null | undefined> = async () => undefined;
    /** 🔴 #534：列出刚挑的那个目录里的**可启动文件**（宿主走 `pure/gameLaunch.isGameLaunchPath`；库内转相对、库外保留绝对） */
    export let onListGameLaunchFilesInDir: (dir: string) => Promise<LibraryBookFile[]> = async () => [];
    /**
     * 🔴 #563 编辑浮层「本地路径」标签旁那枚**单集本地检索**（用户：「点一下要自动去设置页前置填写的
     *    媒体库目录路径里（含多层嵌套）递归搜索当前集的视频文件，并直接自动填入绝对路径」）。
     * 🔴 与上面几条「先弹目录选择器再找」**不是同一件事**：它**不问用户** —— 根目录来自设置页的分类目录
     *    （`pure/localDirs`），按条目类型分流（剧集/动画/电影 各自的目录）。
     * 三态返回：`ok` 填入 / `'nodir'` 该分类没配目录（弹「去设置页配置」的警告）/ `'notfound'` 没找到这一集。
     */
    export let onSearchLocalEpisode: (opts: LocalEpisodeQuery) => Promise<LocalEpisodeOutcome> =
        async () => ({ ok: false, reason: 'nodir' });
    /** #685 编辑表单「记录时长 / 记录周目」：弹窗侧打开记录弹窗（固定挂载当前条目） */
    export let onOpenEntryLogModal: (kind: EntryLogKind) => void = () => {};
    /** 拖入本地图片上传为封面：返回相对路径（covers/xxx） */
    export let onUploadPoster: (file: File) => Promise<string> = async () => '';
    /** 解析封面字符串为可显示地址（http 直用 / 本地路径映射 vault 资源） */
    export let onResolvePoster: (p: string) => string | undefined = (p) => p;
    /**
     * #498「从网络搜索封面」（用户：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」）。
     * 组件只负责：**把默认搜索词拼好**（`pure/posterSearch.buildPosterQuery`）+ 摊开候选弹窗（宿主开）；
     * 选好后宿主回调 `apply(库内相对路径)` ⇒ 组件把它写进 `poster`（与「更换本地图片」落的是同一个字段）。
     * 🔴 `title` 一并传下去：下载时的**封面文件命名**要用它（`封面/{标题}.jpg`，与既有本地化同口径）——
     *    而表单里的标题可能刚被用户改过、还没保存，⛔ 宿主拿 `entry.title` 会命名成旧的。
     * ⚠️ 搜索与下载都在宿主 —— ⛔ 组件不碰网络、不碰 vault。
     */
    export let onOpenPosterSearch: (
        query: string,
        title: string,
        apply: (relPath: string) => void,
        /** 🔴 #509：平台那四条来源的默认搜索词（「标题 + 作者」）—— ⛔ 与必应那条不是一回事 */
        platformQuery?: string,
        /** 🔴 #509：可用来源（**在这里定**：音乐给五个、其它类型只有网络搜索） */
        sources?: PosterSource[],
    ) => void = () => {};
    /** 豆瓣封面防盗链：下载远程豆瓣图片到本地封面目录（按标题命名），返回相对路径 */
    export let onDownloadPoster: (url: string, title: string) => Promise<string> = async (url) => url;

    // ── 编辑模式：用既有条目初始化字段 ──
    let type: EntryType = entry?.type ?? initialType;
    let query = presetQuery;
    let searching = false;
    let searchError = '';
    let results: SearchResult[] = presetResults;
    /** 搜索进度（确定性进度条 + 预计耗时）：done/total/label/etaSec */
    let progDone = 0;
    let progTotal = 0;
    let progLabel = '';
    /**
     * 模拟进度（单步搜索 total 未知时显示爬升百分比，避免「看不到进度」；有真实步骤时用真实值）。
     * 🔴 #559（用户 2026-10-08）：爬升曲线**不再是**「每 420ms 随机加 4~10」，改成
     *    `pure/simProgress` 的五段时间线（0–200ms 防闪烁 / 200ms–2s ease-out 冲到 70 /
     *    2–3s 到 80 / 3–5s 蠕动到 85 / 5–8s 到 **90 封顶**，⛔ 永不自己到 100）。
     *    `simMs` = 本次搜索已耗时（50ms tick 重算），端点值由单测钉死。
     */
    let progSim = 0;
    let progSimTimer: ReturnType<typeof setInterval> | undefined;
    /** 已耗时（ms）；驱动曲线、慢网络提示与重试按钮三条判据 */
    let simMs = 0;
    let simStart = 0;
    /** 200ms 之后才让进度条上屏（防闪烁）；完成后还要留一帧给「拉满 + 淡出」 */
    let progVisible = false;
    /** 完成冲刺：100% + 淡出（用户「100ms 内瞬间拉满 + 淡出」） */
    let progFade = false;
    /** 搜索序号：点「中止重试」后 +1 ⇒ 在飞的旧请求回来时被丢弃（不再覆盖新一轮的结果） */
    let searchSeq = 0;
    /** 进度百分比：total 已知用真实值；未知用模拟爬升（封顶 90，完成时跳 100） */
    $: progPct = progTotal > 0
        ? Math.min(100, Math.round((progDone / progTotal) * 100))
        : progSim;
    /** 逐源真实进度：各参与源完成状态（sourceDone[id] = 已返回结果数；失败/超时等由 doneState 表达） */
    interface SrcLive {
        /** undefined = 等待中/尚未回报；'ok'|'empty'|'failed'|'timeout'|'blocked' 见 SourceDoneState */
        state?: 'ok' | 'empty' | 'failed' | 'timeout' | 'blocked';
        count?: number;
    }
    let srcLive: Record<string, SrcLive> = {};
    const srcStateText = (s: SrcLive | undefined, en: string): string => {
        if (!s || !s.state) return `${en} 搜索中…`;
        switch (s.state) {
            case 'ok': return `${en} 已返回 ${s.count ?? 0} 条`;
            case 'empty': return `${en} 无匹配`;
            case 'failed': return `${en} 请求失败`;
            case 'timeout': return `${en} 超时`;
            case 'blocked': return `${en} 不可用`;
        }
    };
    const onSearchProgress: SearchProgressCb = (p: SearchProgress) => {
        progDone = p.done;
        progTotal = p.total;
        progLabel = p.label;
        // 逐源事件：收到即更新该源实时状态（先返回先亮，其余保持「搜索中…」）
        if (p.source) {
            srcLive = { ...srcLive, [p.source.id]: { state: p.source.state, count: p.source.count } };
        }
    };
    function startSimProgress() {
        simStart = Date.now();
        simMs = 0;
        progSim = 0;
        progFade = false;
        progVisible = false; // 🔴 0–200ms 不显示任何加载动画（防闪烁）
        clearInterval(progSimTimer);
        progSimTimer = setInterval(() => {
            simMs = Date.now() - simStart;
            progSim = simPctAt(simMs);
            if (!progVisible && simVisibleAt(simMs)) progVisible = true;
        }, 50);
    }
    function stopSimProgress() {
        clearInterval(progSimTimer);
        progSimTimer = undefined;
        progSim = 100; // 🟢 完成冲刺：API 返回那一刻拉满
        progFade = true;
        // 若这一轮压根没到 200ms（搜索极快）⇒ 全程不显示进度条，直接出结果（用户第一段的口径）
        if (!progVisible) return;
        // 留 160ms 给「拉满 + 淡出」动画，然后卸载（`{#if searching || progVisible}`）
        setTimeout(() => { progVisible = false; progFade = false; }, 160);
    }
    /** 5s 之后把「正在搜索 N 个数据源」换成慢网络提示（未到点 ⇒ undefined，保持原文案） */
    $: simSlowText = searching ? simSlowTextAt(simMs) : undefined;
    /** 8s 之后给「中止重试」按钮 */
    $: simRetry = searching && simShowRetryAt(simMs);
    /**
     * 「中止重试」：把在飞的这一轮**作废**（`searchSeq` +1 ⇒ 回来后丢弃结果），然后立刻重搜。
     * ⚠️ 底层请求**掐不断**（与 #428 的取消哨兵同一条现实），能做的只是「不再等它」。
     */
    function retrySearch(): void {
        searchSeq++;
        stopSimProgress();
        searching = false;
        void doSearch();
    }
    /** 编辑模式默认已"选/填"（picked=true 直接渲染字段区）；新增需搜索点结果才置 true */
    let picked: boolean = entry !== null;
    /** 🔴 #632 连续添加：本次点选的那条候选（保存成功后宿主拿 `resultKeyOf(它)` 标「已添加」） */
    let lastPicked: SearchResult | null = null;
    /** 编辑模式「重新拉取」展开态：true 时显示搜索区（预填当前标题），选结果回填客观字段 */
    let refetchOpen = false;

    let title = entry?.title ?? '';
    /** 添加模式点选结果后回显的标题（fhd 头部「添加条目：xx」用；手动填写时保持默认文案） */
    let pickedTitle = '';
    /**
     * 🔴 #499B：本次字段区是**从「手动填写」进来的**吗（用户：「预填功能只在手动填写界面出现」）。
     * 新增态有两条路进字段区：① 点「手动填写」（`manualFill = true`）② 点搜索结果 `pick()`
     *    （`manualFill = false`）。**只有 ① 才摆 AI 预填 ✨** —— ② 那一路客观字段已由真实数据源填好，
     *    再让模型凭记忆猜一遍既多余、又会把数据源给的值覆盖掉。
     * ⚠️ 别用 `pickedTitle` 兼职当这个判据：那个只记「点过结果」，⛔ 语义不同（且点选后再点「手动填写」
     *    它也不会复位 ⇒ 会把这个按钮永久藏起来）。编辑态恒 false（无意义 —— 那条路上字段大多已有值）。
     */
    let manualFill = false;
    /** 标题输入框引用：点选结果后自动聚焦（tick 等待字段区渲染） */
    let titleInput: HTMLInputElement | null = null;
    let originalTitle = entry?.originalTitle ?? '';
    let year = entry?.year ? String(entry.year) : '';
    let director = entry?.director ?? '';
    /** 导演/编剧合并输入（显示与编辑用单框；提交时第一个 / 前为导演、其余为编剧） */
    let directorWriters = '';
    $: directorWriters = [director, screenwriter].filter(Boolean).join(' / ');
    let screenwriter = (entry?.screenwriter ?? []).join(' / ');
    let cast = (entry?.cast ?? []).join(' / ');
    let genres = (entry?.genres ?? []).join(' / ');
    /** 题材：普通 input（/ 分隔文本，非标签）——提交时拆分存 genres 数组 */
    let country = entry?.country ?? '';
    let language = entry?.language ?? '';
    let durationMin = entry?.durationMin ? String(entry.durationMin) : '';
    let aliases = (entry?.aliases ?? []).join(' / ');
    /** 简介/剧情简介（搜索回填自动记录；落库 summary 字段，笔记「## 简介」章节） */
    let summary = entry?.summary ?? '';
    /** AI 摘要（单框合并：第 1 行 = 一句话总结，其余每行 = 一条看点；可手填 / 可点「总结摘要」右侧 ✨ 生成）
     *  落库仍拆两个字段 aiSummary / aiHighlights，互转见 pure/aiSummary.aiFieldsToText / textToAiFields */
    let aiText = aiFieldsToText(entry?.aiSummary, entry?.aiHighlights);
    let aiBusy = false;
    /** 生成 AI 摘要：元数据（类型/标题/年份/题材/主创/主演/简介/目录）喂给模型，结果回填可继续手改 */
    async function generateAiSummary() {
        if (aiBusy) return;
        if (!title.trim()) {
            new Notice('先填写标题，再生成 AI 摘要', 3000);
            return;
        }
        aiBusy = true;
        try {
            const creator = type === 'book' ? author : type === 'game' ? developer : type === 'music' ? author : directorWriters;
            const r = await onAiSummarize({
                type,
                title: title.trim(),
                year: year ? Number(year) || undefined : undefined,
                genres: genres.split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean),
                creator: creator.trim() || undefined,
                cast: cast.split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean),
                summary: summary.trim() || undefined,
                toc: type === 'book' ? toc.trim() || undefined : undefined,
            });
            if (!r) return; // 失败：服务层已 Notice
            aiText = aiFieldsToText(r.summary, r.highlights);
            new Notice('已生成 AI 摘要 — 可直接修改后再保存', 3000);
        } finally {
            aiBusy = false;
        }
    }

    // ──────────── #499 AI 预填（新增条目 · 标题行 ✨）────────────
    /** 生成中标记（按钮转圈 / 防重复点） */
    let prefillBusy = false;
    /**
     * 预览行（非空 = 面板展开）。🔴 这是「先看再落」的落点 —— 用户 2026-10-03 裁定：
     * 预览逐行给「旧值（删除线）→ AI 值（灰字）」，「回填」才写进表单。
     */
    let prefillRows: PrefillRow[] = [];
    /** #499D 生成中那一行进度（工具回路里宿主回传，如「搜索网络：周处除三害 导演」；空 ⇒ 不显示） */
    let prefillStep = '';
    /**
     * #499D 本次真正用到的**工具来源**（`['元数据源','网络搜索']`；空数组 = 纯凭记忆）。
     * 🔴 这是「知识截止」这件事对用户**唯一可见的交代**：看到「依据：网络搜索」= 查过；
     *    看到「凭模型记忆」= 没查、新作品可能空着。
     */
    let prefillSources: string[] = [];

    /**
     * 表单**当前值**快照（按字段键收一份）—— 供预览行做「旧值」对照。
     * ⚠️ 键必须是 `PrefillFieldKey`；漏掉的键在预览里只会显示「（空）」，不会报错 ⇒ 加字段时**别忘这里**。
     */
    function currentPrefillValues(): Partial<Record<PrefillFieldKey, string>> {
        return {
            year,
            genres,
            author,
            artist,
            publisher,
            pageCount: pageCountVal,
            isbn,
            authorIntro,
            toc,
            summary,
            directorWriters,
            cast,
            totalEpisodes,
            platform,
            developer,
            album,
        };
    }

    /** 点 ✨：向宿主要字段表 → 合成预览行（**不发第二次请求、更不落库**） */
    async function runAiPrefill(): Promise<void> {
        if (prefillBusy) return;
        if (!title.trim()) {
            new Notice('先填写标题，再让 AI 预填', 3000);
            return;
        }
        prefillBusy = true;
        clearPrefill();
        try {
            const r = await onAiPrefill(
                {
                    type,
                    bookKind: type === 'book' ? bookKind : undefined,
                    title: title.trim(),
                    year: year ? Number(year) || undefined : undefined,
                    genres: genres.split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean),
                    // 🔴 #508：把表单里已填的「作者 / 歌手」当**线索**发过去（用户：「除了搜标题还要能
                    //    一同并搜填在作者框的名称」）—— 挨着年份 / 题材线索摆，作用也一样：区分同名作品。
                    //    ⚠️ 它是**线索、不是答案**：宿主那侧仍会让 AI 去搜、并把结果填回来（见 `prefillMessages`）。
                    author: author.trim() || undefined,
                },
                // #499D：工具回路里的每一步都回执给这一行（用户能看见「它去搜了」）
                (label) => {
                    prefillStep = label;
                },
            );
            if (!r) return; // 失败：服务层已 Notice
            const rows = buildPrefillRows(r.fields, currentPrefillValues(), prefillFieldsFor(type, bookKind));
            if (!rows.length) {
                new Notice('AI 没有给出可用字段', 4000);
                return;
            }
            prefillSources = r.sources ?? [];
            prefillRows = rows;
        } finally {
            prefillBusy = false;
            prefillStep = '';
        }
    }

    /** 收起预览（回填 / 取消 / 重新生成 都走它 —— ⛔ 别只清 `prefillRows` 忘了来源，那会让下一轮的「依据」串味） */
    function clearPrefill(): void {
        prefillRows = [];
        prefillSources = [];
    }

    /**
     * 确认回填 —— **用 AI 值覆盖**它给出了值的字段（用户 2026-10-03 裁定；旧值在预览里已用删除线标明）。
     * ⚠️ 「导演 / 编剧」合并框：写的是它的两个**来源变量**（`director` + `screenwriter`），
     *    不是那个 `$:` 派生出来的字符串 —— 直接赋给派生值会在下一次重算时被冲掉。
     */
    function applyPrefill(): void {
        const n = prefillRows.length;
        for (const row of prefillRows) {
            switch (row.key) {
                case 'year': year = row.next; break;
                case 'genres': genres = row.next; break;
                case 'author': author = row.next; break;
                case 'artist': artist = row.next; break;
                case 'publisher': publisher = row.next; break;
                case 'pageCount': pageCountVal = row.next; break;
                case 'isbn': isbn = row.next; break;
                case 'authorIntro': authorIntro = row.next; break;
                case 'toc': toc = row.next; break;
                case 'summary': summary = row.next; break;
                case 'directorWriters': director = row.next; screenwriter = ''; break;
                case 'cast': cast = row.next; break;
                case 'totalEpisodes': totalEpisodes = row.next; resizeEpisodeFiles(); break;
                case 'platform': platform = row.next; break;
                case 'developer': developer = row.next; break;
                case 'album': album = row.next; break;
            }
        }
        clearPrefill();
        new Notice(`已回填 ${n} 个字段 — 可直接修改后再保存`, 3000);
    }

    /** 简介类 textarea 引用（auto-grow：高度随文字多少自动伸缩） */
    let summaryEl: HTMLTextAreaElement | null = null;
    let authorIntroEl: HTMLTextAreaElement | null = null;
    let tocEl: HTMLTextAreaElement | null = null;
    /** auto-grow 核心：先归零再取 scrollHeight（textarea 的 scrollHeight 不会小于当前渲染高度，复位 auto 仍停在 rows 基线高度导致文字少时缩不回去） */
    function autosizeTextarea(el: HTMLTextAreaElement | null) {
        if (!el) return;
        el.style.height = '0px';
        el.style.height = el.scrollHeight + 'px';
    }
    // 用户输入（bind:value 更新）与搜索程序化回填都会触发重算；el 挂载时跑一次定初始高度
    $: { if (summaryEl) autosizeTextarea(summaryEl); void summary; }
    $: { if (authorIntroEl) autosizeTextarea(authorIntroEl); void authorIntro; }
    $: { if (tocEl) autosizeTextarea(tocEl); void toc; }
    /** 书籍分类（1.0.3）：book 文学 / novel 网文 / comic 漫画；缺省归文学（pure/bookKind，原「出版」）；分类唯一入口 = 搜索框下拉（表单 chips 已移除，2026-09-12 用户裁定）。
     *  🔴 comic 于 2026-09-30 加回（1.0.3.1 曾下线）；三个子类在表单里**同构** ——
     *     漫画走「出版侧字段」那一支（出版社/ISBN/目录，同文学），⛔ 别把它并进网文那一支。 */
    let bookKind: BookKind = normalizeBookKind(entry?.bookKind ?? initialBookKind);
    /** 搜索框类型下拉展示值（书籍态显示子类本名：文学/网文）：纯派生自 type+bookKind，编辑初始化全自动回显，规则见 pure/searchTypeSel */
    let typeSel: SearchTypeSel;
    $: typeSel = toSearchTypeSel(type, bookKind);
    /** select 受控 change：把下拉选择落成真实 type+bookKind（下拉是书籍分类唯一入口：选「书籍」无条件复位文学，bind+on:change 同元素有编译警告，改显式 value+handler） */
    function onTypeSelEl(ev: Event): void {
        const next = applySearchTypeSel((ev.currentTarget as HTMLSelectElement).value as SearchTypeSel, bookKind);
        type = next.type;
        bookKind = next.bookKind;
        // 🔴 #535：切到网文 / 漫画后那枚在线检索按钮就没了 ⇒ 开着的候选浮层必须一并收起
        //    （⛔ 留着它会显示一个「当前分类根本不接」的检索结果，自相矛盾）。
        if (next.bookKind !== 'book') readUrlOpen = false;
    }
    /** 音乐分类（1.0.3.1 起不再分：用户 2026-09-13 裁定删除「其他」，表单选择行已下线）；字段保留恒归一为 music（pure/musicKind） */
    let musicKind: MusicKind = normalizeMusicKind(entry?.musicKind);
    let author = entry?.author ?? '';
    /** 🔴 #444g 画师（漫画的作画）：与「作者」（漫画里 = 原作 / 编剧）分开的两栏；
     *  只有**漫画态**在表单里渲染该框，其余 bookKind 保存时显式清空（见 submit）。 */
    let artist = entry?.artist ?? '';
    let album = entry?.album ?? '';
    let audioPath = entry?.audioPath ?? '';
    /**
     * 🔴 #601 音乐**网络地址**（存 `audioUrl`，append-only 新字段）。
     * 与 `gameUrl` 同一条口径：音乐侧没有可用的在线检索源（四平台都要鉴权 / 签名）
     * ⇒ 只在浮层里手填 / 粘贴，**没有检索按钮**。
     */
    let audioUrl = entry?.audioUrl ?? '';
    /** 游戏启动快捷方式（.lnk）路径（表单「启动快捷方式」行） */
    let gameLaunchPath = entry?.gameLaunchPath ?? '';
    /**
     * 🔴 #534 游戏**网络路径**（存 `gameUrl`，append-only 新字段）。
     * 用户裁定：游戏**不接在线检索源** —— 「仅在右键弹窗加网络路径框（加粘贴文字按钮）」，
     * 所以它没有检索按钮，只在「启动路径」浮层里手填 / 粘贴（与影视集编辑浮层那套「粘贴」同款）。
     */
    let gameUrl = entry?.gameUrl ?? '';
    /** 书籍文件路径（阅读器打开入口）：右键编辑浮层浏览/手动输入，存 bookFile */
    let bookFileVal = entry?.bookFile ?? '';
    /** 书籍文件右键编辑浮层开关 */
    let bookEditOpen = false;
    /**
     * #529 书籍**网络地址**（在线阅读链接，存 `readUrl`）+ 「检索在线书籍阅读」候选浮层状态。
     * 🔴 检索源 = 微信读书（宿主 `main.searchWeread` → `services/weread`）；只**回填链接**，
     *    ⛔ 不下载、不解析正文。写入的只是**表单状态**，仍要点表单「保存」才落库。
     */
    let readUrl = entry?.readUrl ?? '';
    let readUrlOpen = false;
    let readUrlQuery = '';
    let readUrlBusy = false;
    let readUrlBooks: WereadCandidate[] = [];
    let readUrlErr = '';
    // 🔴 #685 音乐「网络地址」在线检索（在线曲库候选卡）的状态
    let songUrlOpen = false;
    let songUrlQuery = '';
    let songUrlBusy = false;
    let songUrlCands: PlayableCand[] = [];
    let songUrlErr = '';
    /** 游戏启动快捷方式右键编辑浮层开关 + 编辑缓冲值（保存才写回 gameLaunchPath） */
    let gameEditOpen = false;
    let gameLaunchVal = '';
    /** #534 游戏网络路径的编辑缓冲值（与 `gameUrl` 分开：保存才写回 —— 同 gameLaunchVal 的模式） */
    let gameUrlVal = '';
    /** 本地音频右键编辑浮层开关 + 编辑缓冲值（保存才写回 audioPath） */
    let audioEditOpen = false;
    let audioPathVal = '';
    /** 🔴 #601 音乐网络地址的编辑缓冲值（与 `audioUrl` 分开：失焦才写回 —— 同 `audioPathVal` 的模式） */
    let audioUrlVal = '';
    /**
     * #497 改名：输入框里的**新主名** + 失败原因提示 + 进行中标记。
     * 🔴 输入框只放主名，扩展名以静态后缀渲染（`audioExtOf`）—— 扩展名一改，这个文件就不再是音频了，
     *    而它是**用户的文件**，改坏了找不回来。⚠️ 用户粘完整文件名时的兜底在纯模块（同名扩展自动剥）。
     */
    let audioNameVal = '';
    let audioRenameHint = '';
    let audioRenaming = false;
    /**
     * 块内 LRC 歌词正文（#396）：**住在笔记的 ` ```lrc ` 块里，不落 catalog**。
     * 初始值由弹窗侧从笔记读回（`initialLrc`）；保存时随 `input.lrc` 交给弹窗写回笔记。
     */
    let lrc = initialLrc;
    /** 在线歌词：搜索中 / 候选浮层开关 / 按源分组的候选 / 正在取的那条 / 取歌词的失败文案 */
    let lrcBusy = false;
    let lrcOpen = false;
    let lrcQuery = '';
    let lrcResults: LyricSearchOutcome['results'] = [];
    let lrcLoadingKey = '';
    let lrcFillError = '';
    /** #507：AI 双语歌词进行中（与 `lrcBusy` 分开 —— 两件事可以各忙各的，但都各自防连点） */
    let lrcAiBusy = false;
    /** 当前 LRC 里**还需要翻译**的行数（0 ⇒ 已全双语 / 无可译行 ⇒ 按钮置灰并说明原因） */
    $: lrcTodo = lrcTranslatableCount(lrc);

    /**
     * #507 「AI 双语歌词」：把当前 LRC 交给 AI**逐行**译成中文，按 ` | ` 接到每行原文后面。
     * 🔴 时间标签一个字不动（拼接在**纯函数** `mergeBilingualLrc` 里做，⛔ 不让模型重写整份 LRC）；
     * 🔴 写回的是**歌词框**（与「获取歌词」同一条纪律）⇒ 仍要点表单的「保存」才落库；
     * ⚠️ 已经有 ` | ` 的行不动（幂等），⛔ 连点两次不会变成 `a | b | c`。
     */
    async function generateBilingualLrc(): Promise<void> {
        if (lrcAiBusy) return;
        const src = lrc.trim();
        if (!src) {
            new Notice('先获取或粘贴 LRC 歌词，再生成双语');
            return;
        }
        if (lrcTodo === 0) {
            new Notice('这份歌词里没有需要翻译的行（可能已经是双语了）');
            return;
        }
        lrcAiBusy = true;
        try {
            const out = await onAiBilingualLrc(src, { title: title.trim(), artist: author.trim() });
            if (!out) return; // 宿主已给具体原因（未配置 Key / 模型没回内容 / 行对不上…）
            lrc = out.text;
            // 🔴 部分成功要**如实说**（`missing` 行原样保留，⛔ 别谎报「全部完成」）
            new Notice(
                out.missing > 0
                    ? `已生成双语歌词：${out.applied} 行（${out.missing} 行没拿到译文，已按原样保留）`
                    : `已生成双语歌词：${out.applied} 行（点「保存」写入）`,
                out.missing > 0 ? 6000 : 4000,
            );
        } finally {
            lrcAiBusy = false;
        }
    }
    /** 在线歌词的候选键（源 + 候选 id）—— 用于「哪一行正在获取中」与去重渲染 */
    function lrcKey(source: LyricSourceId, c: LyricCandidate): string {
        return `${source}:${c.id}`;
    }
    /** 「获取歌词」：四源并行搜索 → 打开候选浮层（搜索失败也开，浮层里给出原因） */
    async function fetchOnlineLyrics(): Promise<void> {
        if (lrcBusy) return;
        lrcBusy = true;
        lrcFillError = '';
        try {
            const out = await onSearchLyrics(title.trim(), author.trim());
            lrcQuery = out.query ?? '';
            lrcResults = out.results;
            lrcOpen = true;
            // 🔴 只在**四源全部失败**时才当成一次失败提示（单源失败在浮层里逐源显示，⛔ 别在这里吞掉其余源）
            if (lrcResults.length && lrcResults.every((r) => r.error)) {
                lrcFillError = `四个源都没能连上（${lrcResults[0].error}）`;
            }
        } catch (e) {
            lrcQuery = title.trim();
            lrcResults = [];
            lrcFillError = `获取失败：${e instanceof Error ? e.message : String(e)}`;
            lrcOpen = true;
        } finally {
            lrcBusy = false;
        }
    }
    /**
     * 候选**摊平**成一行一条（2026-09-28 #401 照 `obsidian-lyricflux/TagEditorModal` 搬）：
     * 正本不做「按源分组 + 每组一个小标题」，而是**每行左侧挂一枚来源胶囊**、整体一个滚动框。
     * ⇒ 同一首歌在四个源都有时，用户看到的是**四条并排的候选**（按匹配度），而不是四个各带标题的段落。
     */
    function lrcFlatList(): Array<{ source: LyricSourceId; label: string; c: LyricCandidate }> {
        return lrcResults.flatMap((r) => r.candidates.map((c) => ({ source: r.source, label: r.label, c })));
    }
    /** 没出候选 / 请求失败的源，收成一行小字（⛔ 不删：不分清「没这首歌」与「接口挂了」用户会误判源坏了） */
    function lrcMissSummary(): string {
        return lrcResults
            .filter((r) => r.candidates.length === 0)
            .map((r) => `${r.label}${r.error ? ' 请求失败' : ' 未找到'}`)
            .join(' · ');
    }

    /** 「填入」某条候选：取歌词正文 → 覆盖歌词框并关浮层（取不到时留在浮层里说明原因） */
    async function applyLyrics(source: LyricSourceId, c: LyricCandidate): Promise<void> {
        if (lrcLoadingKey) return;
        lrcLoadingKey = lrcKey(source, c);
        lrcFillError = '';
        try {
            const r = await onLoadLyric(source, c.id);
            if (r.text) {
                lrc = r.text;
                lrcOpen = false;
            } else {
                lrcFillError = r.error ? `该源获取失败（${r.error}）` : '该源没有这首歌的歌词';
            }
        } catch (e) {
            lrcFillError = `获取失败：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            lrcLoadingKey = '';
        }
    }
    let translator = entry?.translator ?? '';
    let publisher = entry?.publisher ?? '';
    let producer = entry?.producer ?? '';
    let isbn = entry?.isbn ?? '';
    let binding = entry?.binding ?? '';
    let price = entry?.price ?? '';
    /** #632：新建态若刚从「保存并继续」回来，系列名沿用上一次（跨次继承 = 一次填好连着建一部系列） */
    let series = entry?.series ?? initialSeries;
    /**
     * 系列序号（#434）。🔴🔴 **这个变量的运行时类型会变**：`<input type="number" bind:value>` 走 Svelte 的
     * `to_number` —— 用户一敲键盘，它就从 `string` 变成 `number`（清空 ⇒ `null`），
     * 而**初值**是字符串 ⇒ TS 把整条推断成 `string`（**tsc 完全查不出**）。
     * ⇒ ⛔ **绝不要对它直接 `.trim()` / 当字符串用**：`#434` 就是在 submit 里写了 `.trim()`，
     *    崩在 `on:click` 里 = **静默死按钮**（无提示、不关窗），用户报的
     *    「填写了系列名称和系列序号……怎么点都没反应，也没提示」就是这个。
     * ⇒ 一律经 `pure/seriesGroup.parseSeriesIndexInput(seriesIndexVal)` 收口。
     * 🔴 #443（2026-09-30）：**锁定整数**（用户裁定「只能填整数不能填小数」）—— 真库里出现过 3.5 / 8.5，
     *    结果第七季 8.5 排在第八季 8 后面。语义由用户定（阅读序 / 上映序 / 季序都行），本插件不解释含义。
     */
    let seriesIndexVal = entry?.seriesIndex !== undefined ? String(entry.seriesIndex) : initialSeriesIndex;
    let platform = entry?.platform ?? '';
    let developer = entry?.developer ?? '';
    let poster = entry?.poster ?? '';
    /** 表单 UI 模式：douban（豆瓣版，全类型）/ tmdb（电影/剧集）/ bangumi（动画）；命中搜索结果或编辑已有条目时按 source 确定 */
    let formMode: 'douban' | 'tmdb' | 'bangumi' = entry
        ? (entry.source === 'tmdb' ? 'tmdb' : entry.source === 'bangumi' ? 'bangumi' : 'douban')
        : 'douban';
    /** 数据源自动记录（笔记「来源」行跟随数据源官方链接）：新增模式可**手填**，编辑模式只读展示 */
    let sourceFrom = entry?.source ?? '';
    let sourceUrl = entry?.sourceUrl ?? '';
    /**
     * #430：**手填的来源名**（新增模式可填，编辑模式只读展示）。
     * 🔴 用途 = 手工新建的条目没有数据源（`sourceFrom` 空）⇒ 封面角标只有「8.4★」、标题栏链接只有「来源」；
     *    填了它就能显示「番茄8.4★」。
     * ⚠️ 与 `sourceFrom` **不是一回事**：`sourceFrom` 是**数据源键**（决定走哪条搜索链、决定表单模式），
     *    ⛔ 别拿它当这个框的真源（自建站 / 出版社根本不在那 11 个键里）。
     */
    let sourceName = entry?.sourceName ?? '';
    /** 大众评分（数据源评分）：新增模式可**手填**（10 分制，校验见 pure/sourceMeta），编辑模式只读展示 */
    let communityScore = entry?.communityScore ? String(entry.communityScore) : '';
    /** 豆瓣评价人数（搜索/详情回填，展示「★ 8.5 · N人评价」；只读） */
    let ratingCount = entry?.ratingCount ? String(entry.ratingCount) : '';
    /** #386：这两个手填框是否被**用户亲手改过**。
     *  用户 2026-09-27 口径：「**仅新增条目时手动填写第一次显示这个样式，其余第二次修改和自动获取填写保持原样**」
     *  ⇒ 预览徽标只在「手填过」出现；**程序化回填不算手填**（搜索结果/详情补全写入前由 `pick()` 复位）。
     *  ⛔ 别用「值非空」代替本标记 —— 自动回填的条目也有值，那样又会把徽标冒出来。
     *  🔴 #499E：它还兼任**编辑态是否走「校验 + 归一」**的判据（见 `submit()` 里的 `viaInputs`）。 */
    let metaTouched = false;
    /**
     * 🔴 #499E 编辑态「这四个字段再次手动编辑」的开关（用户 2026-10-03：「『来源、大众评分、评价人数、
     * 平台链接』改成可再次手动编辑」—— 推翻 2026-09-27 的「仅第一次填写有效，后续不可修改」）。
     *
     * 形态：编辑态**默认只读**（展示在**标题行内**那一簇 `.rl-ro-meta`，观感 = 原来那两枚徽标），
     * **右键那一簇**才在下面展开四个输入框（用户裁定的交互）。
     * ⚠️ #499E **二轮修正**：只读展示曾短暂做成「另起一行、四个『标签 + 值』」，用户上手后要求
     *    「渲染回原来的样式，**在标题框旁而不是另起一行**」⇒ 那一版已撤（⛔ 别做回来）。
     * ⛔ 别把四个框直接常显在编辑态 —— 只读与输入是**互斥的两态**，同时出现就是同一信息两份。
     */
    let metaEditing = false;
    /** 这四个字段当前**可编辑**吗：新增态恒可编辑；编辑态右键后才可编辑（两处渲染共用这一个判据） */
    $: metaEditable = !entry || metaEditing;
    /**
     * 标题行那一簇只读展示里的「来源名 ↗」按钮文案（空串 = 不渲染该按钮）—— 与 #450 的口径同源：
     * 守卫落在**表达式**里、模板只认 `{#if srcBadgeLabel}` 这一个出口；⛔ 别手抄映射表。
     * 🔴 #499E 加 `!metaEditing`：解锁后这一簇整个让位给下面的四个输入框（两态互斥）。
     */
    $: srcBadgeLabel = entry && !metaEditing && sourceUrl
        ? entrySourceLabel({ source: sourceFrom, sourceName }) || '来源'
        : '';
    /**
     * 🔴 #500① 标题行那一簇的**唯一**提示（用户：「评分与来源信息在鼠标 hover 时多条提示相互覆盖、观感差」）。
     * 口径：整簇只挂**一条** `data-tip`，内层那枚「来源名 ↗」按钮⛔ 不再挂自己的 —— 两处各一条时，
     * 鼠标在两者之间移动会来回换提示（观感就是「相互覆盖」）。
     * ⚠️ 只说**动作**，⛔ 不重复界面上已经写着的值（来源名 / 分数 / 人数都在那一行里，说了是废话）。
     */
    $: roMetaTip = [srcBadgeLabel ? '点击来源名打开数据源页' : '', '右键可手动编辑'].filter(Boolean).join('\n');
    // 2026-09-27 #385：手填平台链接 → 预览「平台名 评分★」（对齐海报墙封面角标的口径与顺序：
    //   来源名在前、数值 + 后缀星在后）。**手填后**才显示。
    //   ⛔ 认不出平台时不显示空占位（退化为纯数值★）；⛔ 评分未成形（如刚敲了「8.」）时不预览，免得闪出「8.★」。
    // #430：**手填来源名优先** —— 链接认不出平台时（自建站 / 出版社）也能显示「番茄 8.4★」；
    //   只有没手填时才回落到「从链接猜出来的平台名」。
    // ⚠️ #499E 起**两个模式都预览**（编辑态右键解锁后同样要看得到改的效果）——
    //    原先那句 `entry ||` 守卫是「编辑态没有输入框」时代的产物，判据交给 `metaTouched` 一个就够。
    $: manualPlatform = !metaTouched ? '' : sourceName.trim() || platformLabelFromUrl(sourceUrl);
    $: manualScore = !metaTouched || communityScoreIssue(communityScore) !== null ? '' : communityScore.trim();
    /** 作者简介（图书，豆瓣详情回填；表单可改，落库 authorIntro） */
    let authorIntro = entry?.authorIntro ?? '';
    /** 目录（图书，豆瓣详情回填；表单可改，落库 toc） */
    let toc = entry?.toc ?? '';
    let status: MediaStatus = entry?.status ?? 'want';
    let rating = entry?.rating ?? 0;
    /** #619：评分数值当前是不是「输入框」形态（点数值那一下切过去，失焦/回车切回来） */
    let ratingEditing = false;
    /** 切到输入框后要聚焦选中它（`{#if}` 新挂的节点得等一拍） */
    let ratingInputEl: HTMLInputElement | null = null;
    /**
     * 季号（#440 起**不再手填**）：表单里已经没有 S 输入框，这个值只做**原样透传** ——
     * 提交时照旧写回 `progress.season`，⛔ 别顺手删掉（删了等于把老数据里的季号**静默抹成默认值**）。
     * ⚠️ 季号在 #434 的系列口径里由「系列序号」表达（本仓**一季一条条目**），所以表单不再问它。
     */
    let season = entry?.progress?.season ?? 1;
    let episode = entry?.progress?.episode ?? 1;
    /** 「已看到」手填钳制：季 ≥ 1、集 ≥ 0；非法/空输入回退初始值（保持 progress 恒为有效整数，防 NaN 落库） */
    function clampWatch(n: number, min: number, dft: number): number {
        return Number.isFinite(n) && n >= min ? Math.round(n) : dft;
    }
    // 影视条目默认总集数：电影固定语义为单集（默认 1，编辑表单不显示总集数框；观看链接渲染单集 ▶ 播放钮，关联第 1 集）；剧集/动画由输入框决定
    let totalEpisodes = entry?.progress?.totalEpisodes ? String(entry.progress.totalEpisodes) : type === 'movie' ? '1' : '';
    /* 🔴 2026-10-23 用户：「填 1000 集会一次性铺开 1000 行，滚动困难」⇒ 集号网格**按每 10 行分区**、
       分区标题吸顶。真实分区大小要看**容器宽度**（一行能放几个 36px 按钮），量不到就回落 13 列
       ⇒ 纯算法在 `pure/episodeAssoc.ts`（含单测），这里只负责把宽度喂进去并渲染。
       ⛔ 别写死 130：换了栏宽（窄侧栏 / 双栏 / 手机）分区就该跟着变。 */
    let epGridW = 0; // `.rl-ep-grid` 的内容宽度（px）；0 = 还没量到
    let epGridEl: HTMLDivElement | null = null;
    let epGridRO: ResizeObserver | null = null;
    /** 每区集数：列数 × 10 行，按实测宽度算 */
    $: epPerSection = episodeSectionSize(epGridW);
    /** 分区列表（1 基闭区间 + 上屏标题）；电影态不走分区 */
    $: epSecs = episodeSections(Number(totalEpisodes) || 0, epPerSection);
    /* 🔴 2026-10-25 用户：「编辑属性窗口的总选集如 1000 集，分区应该按选项卡切换而不是平铺」
       ⇒ 分区**一屏只显示一个**，用顶部选项卡条切换；⛔ 别再 `{#each epSecs}` 平铺全部区块。
       · `epTab` 是**分区下标**（不是集号）；`epSecs` 会随栏宽重算变长变短 ⇒ 每次都要钳制，
         否则拖窄侧栏后下标越界会渲染出一片空白。
       · 默认落在**「已看到」那一集所在的分区**（改第 500 集的人不该被丢回第 1 集），
         量不到 / 无进度就落第 0 区。 */
    let epTab = 0;
    /** 把 `epTab` 钳到合法区间（0 基）—— 纯逻辑在 `pure/episodeAssoc`（有单测），⛔ 别在这里重写 */
    const clampEpTab = clampTabIndex;
    /** 「已看到」那一集落在第几个分区（1 基集号 → 0 基下标）；无进度/非法 → 0 */
    const epTabOfEpisode = tabIndexOfEpisode;
    // 首次进表单 / 总集数变化 ⇒ 跳到「已看到」那一区（`epSecs` 首帧还没算出来时不做）
    let epTabInited = false;
    $: if (!epTabInited && epSecs.length > 0) {
        epTabInited = true;
        epTab = epTabOfEpisode(Number(episode) || 1, epSecs);
    }
    // 分区数变化（拖宽窄栏 / 改总集数）⇒ 钳制，别让下标越界
    $: if (epTab > epSecs.length - 1) epTab = clampEpTab(epTab, epSecs.length);
    /** 当前显示的分区（可能为 undefined：总集数 0 / 电影态） */
    $: epCurSec = epSecs.length > 0 ? epSecs[clampEpTab(epTab, epSecs.length)] : undefined;
    /** 挂 ResizeObserver：拖侧栏 / 切窗 / 弹窗缩放都要重算列数（只挂一次，元素换了就重挂） */
    function watchEpGrid(el: HTMLDivElement) {
        epGridEl = el;
        epGridRO?.disconnect();
        epGridRO = null;
        if (typeof ResizeObserver === 'function') {
            epGridRO = new ResizeObserver(() => {
                const w = epGridEl?.clientWidth ?? 0;
                if (w > 0 && w !== epGridW) epGridW = w;
            });
            epGridRO.observe(el);
        }
        const w = el.clientWidth;
        if (w > 0) epGridW = w;
        return {
            destroy() {
                epGridRO?.disconnect();
                epGridRO = null;
                epGridEl = null;
            },
        };
    }
    /** 观看链接双路径（index 0 = 第 1 集）：本地路径 episodeFiles + 网络地址 episodeUrls + 集标题 episodeTitles，随条目保存 */
    let episodeFiles: (string | undefined)[] = [];
    let episodeUrls: (string | undefined)[] = [];
    let episodeTitles: (string | undefined)[] = [];
    {
        const n = totalEpisodes ? Number(totalEpisodes) : 0;
        const srcF = entry?.episodeFiles ?? [];
        // 旧「资源链接」(links) 自动迁移为网络地址：episodeUrls 为空时取 links 的 url（label 忽略、url 不丢），保存后 links 清空
        const srcU = entry?.episodeUrls && entry.episodeUrls.length > 0
            ? entry.episodeUrls
            : (entry?.links ?? []).map((l) => l.url).filter(Boolean);
        const srcT = entry?.episodeTitles ?? [];
        episodeFiles = Array.from({ length: n }, (_, i) => (i < srcF.length ? srcF[i] : undefined));
        episodeUrls = Array.from({ length: n }, (_, i) => (i < srcU.length ? srcU[i] : undefined));
        episodeTitles = Array.from({ length: n }, (_, i) => (i < srcT.length ? srcT[i] : undefined));
    }
    /** 集编辑弹窗状态：正在编辑的集下标（null=关闭）+ 表单值 */
    let editEp: number | null = null;
    let editLocal = '';
    let editUrl = '';
    let editTitle = '';
    /** 最近观看日期（在看状态可设置，写入 progress.lastWatchedDate 供追更表活跃度计算） */
    let lastWatchedDate = entry?.progress?.lastWatchedDate ?? '';
    let watchedDate = entry?.watchedDate ?? '';
    let plannedDate = entry?.plannedDate ?? '';
    let readingPage = entry?.readingProgress?.page ? String(entry.readingProgress.page) : '';
    let readingTotalPage = entry?.readingProgress?.totalPage ? String(entry.readingProgress.totalPage) : '';
    /**
     * #426：用户手点「重新解析本地文件进度」把进度**清空归零**过 ⇒ 本次保存**丢弃旧 `percent`**。
     * 🔴 为什么非要这个标志：`percent` 是阅读器进度的**唯一真源**，保存时默认原样写回
     *    （见 `submit` 里 `const percent = entry?.readingProgress?.percent`）—— 只清两个输入框的话，
     *    下次打开表单 / 打开阅读器又会按旧 percent 跳回去，用户看到的就是「清不掉」。
     */
    let progressReset = false;
    /** 元数据页数（豆瓣实体书；仅展示/统计，不参与进度换算——进度基准以本地文件为准） */
    let pageCountVal = entry?.pageCount ? String(entry.pageCount) : '';
    /** 阅读百分比：由 page/totalPage 自动派生（只读展示，进度条与提示文字用，不落库） */
    $: readPct =
        readingPage && readingTotalPage
            ? Math.min(100, Math.round((Number(readingPage) / Number(readingTotalPage)) * 100))
            : 0;
    /** 进度条色阶：起步<30% / 进行中<70% / 接近完成<100% / 读完=深绿 */
    $: readbarClass =
        !readingPage || !readingTotalPage
            ? ''
            : readPct < 30
              ? 'rl-readbar-low'
              : readPct < 70
                ? 'rl-readbar-mid'
                : readPct < 100
                  ? 'rl-readbar-high'
                  : 'rl-readbar-done';
    /**
     * 进度单位：关联 TXT/EPUB 按章节解析 → 章；否则（PDF/手填）→ 页（EPUB 无固定页码，spine 章节数为基准）。
     * 🔴 #549：**漫画恒「页」** —— 漫画无论挂的是图片文件夹 / CBZ / ZIP 还是 EPUB，
     *    进度基准都是**图片页**（`probeBookPages` 对漫画一律返回 `{ format: 'comic', numPages }`，
     *    漫画阅读器也是一页一页翻的）⇒ 不能跟着 `.epub` 扩展名退回「章」（那样 EPUB 漫画会显示「总章节」）。
     */
    $: bookUnit =
        type === 'book' && bookKind === 'comic'
            ? '页'
            : ['.txt', '.epub'].some((ext) => bookFileVal.trim().toLowerCase().endsWith(ext))
              ? '章'
              : '页';
    $: bookUnitLabel = bookUnit === '章' ? '进度章节' : '进度页数';
    /**
     * 🔴 #539 书籍「启动路径」的**格式说明按子分类分叉**（用户报障：「漫画怎么是启动路径（TXT/EPUB/PDF)」）。
     *   漫画吃 **图片文件夹 / 压缩包**（CBZ·ZIP·CBT·TAR）与 **文档型** PDF·EPUB；
     *   文学 / 网文仍吃 TXT/EPUB/PDF。
     * ⚠️ 浮层标题 / 输入框占位 / 「浏览」提示 / 「检索本地」提示**四处共用这一份** —— ⛔ 别各写一遍（必然漂）。
     */
    $: bookFmtTitle = bookKind === 'comic' ? '图片文件夹 / 压缩包' : 'TXT/EPUB/PDF';
    $: bookFmtExts = bookKind === 'comic' ? 'cbz / cbt / zip / tar / pdf / epub' : 'txt / epub / pdf';
    $: bookFmtName = bookKind === 'comic' ? '漫画' : '书籍';
    /** 游戏游玩时长（小时录入，落库转分钟；有游玩记录明细时以明细累计为准） */
    let playtimeHours = entry?.playtimeMinutes ? String(Math.round(entry.playtimeMinutes / 60)) : '';
    /** #537 书籍阅读时长（小时录入，落库转分钟）：内置阅读器读该条目时会自动累计（见 main.withReadTime），
     *  这里手填 = **覆盖**总数。保留 1 位小数（90 分钟 → 「1.5」），与海报墙「已读 1.5h」同一口径。 */
    let readHours = entry?.readMinutes ? String(Math.round((entry.readMinutes / 60) * 10) / 10) : '';
    let notes = entry?.notes ?? '';
    // 🔴 #668 关联功能已下线归档（见文件头 import 处的说明）：表单不再持有 `related` state。
    //    ⚠️ 提交时**不再带** `input.related` ⇒ `EntryService.update` 的浅合并会**保留 catalog 里原有的值**
    //    （既有数据不会因为这条入口没了而被清空 —— 删字段才是红线 2 禁止的事）。
    /** 搜索框引用（添加模式自动聚焦） */
    let queryInput: HTMLInputElement | null = null;
    /** 封面：网络图片 URL 输入；previewUrl 供预览区显示（poster 变化自动刷新） */
    let posterUrlInput = '';
    $: previewUrl = poster ? (onResolvePoster(poster) ?? poster) : '';
    /** poster 为 http URL 时同步到输入框（编辑已有条目 / 搜索回填后自动填入，可直接查看或修改） */
    function syncPosterUrlInput() {
        posterUrlInput = /^https?:\/\//.test(poster) ? poster : '';
    }
    /** 封面右键菜单状态 */
    let ctxOpen = false;
    let ctxX = 0;
    let ctxY = 0;
    /** 菜单超出视口可用区域时的封顶尺寸（视口过矮/过窄 → 菜单内部滚动） */
    let ctxMaxH: number | undefined = undefined;
    let ctxMaxW: number | undefined = undefined;
    /** 触发菜单的鼠标视口坐标（菜单内容切换后重新定位要用同一锚点，不能丢） */
    let ctxMouseX = 0;
    let ctxMouseY = 0;
    let ctxMenuEl: HTMLDivElement | null = null;
    let ctxUrlMode = false;
    /**
     * 菜单当前属于谁 —— 一块 `.rl-ctx` 服务两处右键（`poster` 封面 / `meta` 来源·评分概要行）：
     * 菜单是 `position:fixed` + 视口坐标，位置与内容都不依赖触发它的那个元素，故**共用一个节点**即可。
     * ⛔ 别为第二处再克隆一份菜单（两份 markup 必然漂；本仓「同一概念两处写法」栽过多次）。
     */
    let ctxKind: 'poster' | 'meta' = 'poster';
    let fileInput: HTMLInputElement | null = null;

    function openPosterCtx(ev: MouseEvent) {
        ev.preventDefault();
        ctxMouseX = ev.clientX;
        ctxMouseY = ev.clientY;
        ctxUrlMode = false;
        ctxKind = 'poster';
        ctxOpen = true;
        void placePosterCtx();
    }
    /**
     * 🔴 #499E 编辑态「来源 / 大众评分 / 评价人数 / 平台链接」只读概要行的右键：
     * 就地切成四个输入框（用户裁定「可再次手动编辑」的入口就是这个）。
     */
    function openMetaCtx(ev: MouseEvent) {
        ev.preventDefault();
        ctxMouseX = ev.clientX;
        ctxMouseY = ev.clientY;
        ctxUrlMode = false;
        ctxKind = 'meta';
        ctxOpen = true;
        void placePosterCtx();
    }
    /** 概要行 → 输入框（`metaTouched` **不置位**：只是把框亮出来，用户真改了才走校验 + 归一） */
    function startMetaEdit() {
        metaEditing = true;
        closeCtx();
    }
    /** 视口系定位（菜单 position:fixed）：贴鼠标 → 越界翻转 → 仍越界钳制 → 超高/超宽封顶。
     *  切换「更换网络图片」会改变菜单高度，切换后同样走这里重算，避免半截探出屏幕。 */
    async function placePosterCtx() {
        ctxMaxH = undefined;
        ctxMaxW = undefined;
        await tick();
        const menu = ctxMenuEl;
        if (!menu) return;
        const m = menu.getBoundingClientRect();
        const p = placeMenu({
            x: ctxMouseX,
            y: ctxMouseY,
            menuW: m.width,
            menuH: m.height,
            vw: window.innerWidth,
            vh: window.innerHeight,
        });
        ctxX = p.left;
        ctxY = p.top;
        ctxMaxH = p.maxHeight;
        ctxMaxW = p.maxWidth;
    }
    function closeCtx() {
        ctxOpen = false;
        ctxUrlMode = false;
        ctxKind = 'poster'; // 复位：下一处右键（封面 / 概要行）自己会设
        ctxMaxH = undefined;
        ctxMaxW = undefined;
    }
    function pickFile() {
        closeCtx();
        fileInput?.click();
    }
    async function onFileSelected(ev: Event) {
        const input = ev.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            new Notice('仅支持图片文件');
            input.value = '';
            return;
        }
        try {
            const p = await onUploadPoster(file);
            if (p) {
                poster = p;
                syncPosterUrlInput();
            }
        } catch (e) {
            new Notice('封面上传失败：' + (e instanceof Error ? e.message : String(e)));
        }
        input.value = ''; // 允许再次选同一文件
    }

    // 添加模式：弹窗打开后自动聚焦搜索框（所有类型通用；编辑模式无搜索框跳过）
    onMount(() => {
        syncPosterUrlInput(); // 编辑已有条目：http 封面 URL 自动填入输入框
        // 存量数据补全：旧版本 percent 落库但未派生 page（阅读器只产 percent）→ 打开表单即按 percent 真源派生当前页/章
        const rp = entry?.readingProgress;
        if (entry && rp && typeof rp.percent === 'number' && !rp.page && rp.totalPage) {
            readingPage = String(pageFromPercent(rp.percent, rp.totalPage));
            if (!readingTotalPage) readingTotalPage = String(rp.totalPage);
        }
        // 点击外部关闭右键菜单
        const onWinClick = (ev: MouseEvent) => {
            if (ctxOpen && !(ev.target as HTMLElement).closest('.rl-ctx')) closeCtx();
        };
        window.addEventListener('click', onWinClick);
        if (!entry && queryInput) {
            // 防 Obsidian 弹窗焦点还原（上一弹窗关闭动画后延迟执行）抢走搜索框焦点：
            // 多轮重试直到输入框真正获得焦点（最多 ~640ms），解决「新增条目后偶发无法输入搜索」
            let tries = 0;
            queryInput.focus();
            const timer = window.setInterval(() => {
                if (!queryInput) {
                    clearInterval(timer);
                    return;
                }
                if (document.activeElement === queryInput || tries >= 8) {
                    clearInterval(timer);
                    return;
                }
                tries++;
                queryInput.focus();
            }, 80);
        }
        // Bangumi 源条目：详情（评分/导演）由搜索前 3 条补全时写入；编辑打开不自动拉取
        return () => window.removeEventListener('click', onWinClick);
    });

    $: sourceReady = true; // 全部类型均可搜（Douban 单源/并存；影视/动画未配 Key 时仅 Douban 结果）
    $: sourceHint = (type === 'movie' || type === 'tv') && !canSearch
        ? 'TMDB API Key 未配置 — 电影/剧集仅显示 Douban 结果（可在 设置 → 元数据源配置 › 元数据搜索源凭据 · TMDB 配置后叠加）'
        : '';

    /**
     * 📌 当前态要交给源解析的**书籍子分类**（非书籍类型恒 undefined）—— 参与源的唯一取法里的那个参数。
     * 🔴 为什么不写成一个 `function currentSources()` 让两处共用：**Svelte 4 的依赖分析不穿透函数体**
     *   ⇒ 把 `type` / `bookKind` 的读取藏在函数里，编译产物**不会**在切换类型时重算头部文案
     *   （2026-08-27 排序 chip、2026-10-01 集标题悬停两次都栽在这条上）。
     *   ⇒ 读取留在**反应式声明本体**里，两个消费点（头部文案 / 固定占栏）取同一个变量，仍然只有一份口径。
     */
    $: sourcesKind = type === 'book' ? bookKind : undefined;

    /**
     * 📌 #464 在线曲库栏的**开关（两个消费点共用这一份口径）**：音乐类型 + **曲库开关开启**。
     *
     * 🔴 为什么要它：豆瓣音乐搜索**只按专辑名匹配**（搜歌手名搜不到他的歌），
     *   而「按歌手找他的流行曲」只有四平台曲库能干 —— 那正是「下载歌曲」窗口那条链。
     *   ⇒ 音乐态的结果区固定多一栏「在线曲库」（宿主 `searchMusic` 已把结果并进来，见 `songLibrarySearch`）。
     *
     * 🔴 门控为什么是 `songLibraryEnabled`（宿主 `canUseSongLibrary()`）：它**已经包含**了能力判定
     *   （桌面端 + 「启用内置音乐播放器」，曲库检索要发网络请求、移动端必然失败），再 ∧ 用户那枚
     *   「启用在线曲库检索」开关（#538，默认关）。⇒ 组合只有宿主那一处，⛔ 本组件别再 ∧ 一遍 `canDownload`
     *   （那会让两处口径分叉：按钮亮着、曲库栏却永远空 —— #464 的老毛病）。
     *   ⚠️ 栏位必须在**发起搜索前**就定好（与其它源同一口径：栏数不随本次成败增减），
     *     缺结果时该栏显示「无匹配」占位，而不是整栏消失/位置漂移。
     */
    $: songLibOn = type === 'music' && songLibraryEnabled;

    /** 头部「数据源」栏文案（onSourcesForType 实时解析，含已配置/免 Key 判断）：
     *  如 movieTv 勾选 Douban+TMDB+OMDb → 「数据源：Douban / TMDB / OMDb」。
     *  ⚠️ `sourcesKind` 必传：书籍态漏了它就会取到**文学链**（漫画自成一组，见 #444e）。
     *  ⚠️ #464：曲库栏也要列进来 —— 头部写的源与结果区实际建的栏**必须是同一份**
     *    （这正是 #458 栽的那条：头部写着 A、结果区按 B 建栏 ⇒ B 的结果无栏可归被整批丢掉）。 */
    $: activeSourcesForType = onSourcesForType(type, sourcesKind);
    $: sourceListText = (() => {
        const names = songLibOn ? [...activeSourcesForType, SONG_LIB_ID] : activeSourcesForType;
        return `数据源：${names.length > 0 ? sourceEnList(names) : sourceEnLabel('douban')}`;
    })();

    function resultKey(r: SearchResult): string {
        // 🔴 #632：实现已搬到 `pure/repeatAdd.resultKeyOf`（宿主也要拿它做「已添加」标记键）——
        //    ⛔ 别在这里再写一份：两处一旦漂移，「已添加」会标错行或整片标不上。
        return resultKeyOf(r);
    }

    /**
     * 🔴 #632 连续添加：把「下一次还要用到的会话状态」交回宿主
     * （宿主重建本组件时，用 `presetResults` / `addedHits` / `initialSeries*` 再注回来）。
     *
     * ⚠️ 只交**会话状态**（候选 / 关键词 / 刚挑的那条 / 系列那两栏），表单字段一概不带 ——
     *    「保存后回到候选列表」本来就是要一张干净的表单。
     * ⚠️ `seriesIndexVal` 的运行时类型会变（`<input type="number">` 的 `to_number` 把用户一敲就变成
     *    `number`，清空变 `null`；TS 仍以为它是 `string`）⇒ 这里必须**显式判空**，
     *    ⛔ 别直接 `String(seriesIndexVal)`（会得到字面量 `"null"` 这种脏值）。
     */
    export function repeatAddState(): RepeatAddState {
        const raw = seriesIndexVal as unknown as string | number | null | undefined;
        return {
            results,
            query,
            addedKey: lastPicked ? resultKeyOf(lastPicked) : null,
            series,
            seriesIndex: raw === null || raw === undefined ? '' : String(raw),
        };
    }

    /**
     * 🔴 #635 切条目之前判「表单脏不脏」要看的字段（**唯一真源** = `DIRTY_KEYS`）。
     * ⚠️ 与 `dirtyNow()` 必须同步改：新增字段别忘了往这两个地方各加一行
     *   （断言按「两处键集合一致」钉住，漏一处即红）。
     */
    const DIRTY_KEYS = [
        'title', 'type', 'bookKind', 'status', 'rating', 'notes', 'genres',
        'year', 'aliases', 'director', 'cast', 'screenwriter', 'country', 'language', 'durationMin',
        'author', 'artist', 'translator', 'publisher', 'producer', 'isbn', 'binding', 'price',
        'series', 'seriesIndexVal', 'platform', 'developer', 'album',
        'audioPath', 'audioUrl', 'gameLaunchPath', 'gameUrl', 'bookFileVal', 'readUrl',
        'summary', 'authorIntro', 'toc', 'aiText', 'communityScore', 'sourceName', 'sourceUrl',
        'watchedDate', 'plannedDate', 'lastWatchedDate', 'season', 'episode', 'totalEpisodes',
        'readingPage', 'readingTotalPage', 'pageCountVal', 'readHours', 'playtimeHours',
        'episodeFiles', 'episodeUrls', 'episodeTitles', 'poster',
    ] as const;
    /** 打开表单那一刻的基线快照（`onMount` 取一次；切条目会重建组件 ⇒ 基线自动跟着换） */
    let dirtySnapshot: Record<string, unknown> = {};
    onMount(() => {
        dirtySnapshot = dirtyNow();
    });

    export function isDirty(): boolean {
        return DIRTY_KEYS.some((k) => {
            const a = (dirtySnapshot as Record<string, unknown>)[k];
            const b = (dirtyNow() as Record<string, unknown>)[k];
            return !sameValue(a, b);
        });
    }

    /**
     * 当前值的快照（**只收表单自己管的东西**）。
     * ⚠️ 刻意不收的几类：搜索结果 / 浮层开关 / 忙碌态 / `preset*` —— 它们不是「改动」，
     *    收进来会让「点开一次搜索没选」也算脏，确认框就会在不该问的时候问。
     */
    function dirtyNow(): Record<string, unknown> {
        return {
            title, type, bookKind, status, rating, notes, genres,
            year, aliases, director, cast, screenwriter, country, language, durationMin,
            author, artist, translator, publisher, producer, isbn, binding, price,
            series, seriesIndexVal, platform, developer, album,
            audioPath, audioUrl, gameLaunchPath, gameUrl, bookFileVal, readUrl,
            summary, authorIntro, toc, aiText, communityScore, sourceName, sourceUrl,
            watchedDate, plannedDate, lastWatchedDate, season, episode, totalEpisodes,
            readingPage, readingTotalPage, pageCountVal, readHours, playtimeHours,
            episodeFiles, episodeUrls, episodeTitles, poster,
        };
    }

    /** 值比较：数组按键值与长度**深比**（关联 / 集数组都是对象数组，浅比恒不相等） */
    function sameValue(a: unknown, b: unknown): boolean {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
            return true;
        }
        return deepEqual(a, b);
    }
    function deepEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
        const ka = Object.keys(a as Record<string, unknown>);
        const kb = Object.keys(b as Record<string, unknown>);
        if (ka.length !== kb.length) return false;
        return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }

    /** 分栏展示用的单栏（id+列头文本+该来源结果；items 空时渲染占位文案而非整栏消失） */    interface ResultColumn {
        id: string;
        label: string;
        items: SearchResult[];
        /** 该栏所代表的源是否在本次搜索中返回过结果（false → 显示「无匹配」占位） */
        empty: boolean;
    }

    /**
     * 按来源把合并结果重分栏（子任务2 + 固定占栏修正）：每栏固定单一数据源，不再跨源交叉/全局相似度重排。
     * 栏位 = 上次搜索「实际会发起」的源集合（onSourcesForType 在搜索时取快照）——栏数与各源本次成败无关，
     * 避免「某源失败/无结果 → 整栏消失 → 看着像少一栏/布局塌缩」。
     * 仅保留有结果的源混排的旧逻辑不再用于结果区（仍作兜底：onSourcesForType 为空时按结果反推）。
     */
    let sourcePlan: string[] = []; // 最近一次搜索时的参与源快照（切到编辑/手动时保持，避免栏位跳动）
    $: resultColumns = (() => {
        // 兜底：宿主未提供参与源 → 退回「按结果里实际出现的源反推」（旧行为，单源/直连等场景安全）
        if (sourcePlan.length === 0) {
            const map = new Map<string, ResultColumn>();
            for (const r of results) {
                const id = sourceIdOf(r);
                const col = map.get(id);
                if (col) col.items.push(r);
                else map.set(id, { id, label: SOURCE_VIEW[id]?.label ?? id, items: [r], empty: false });
            }
            return Array.from(map.values());
        }
        // 固定占栏：按参与源建栏，结果按 sourceIdOf 归入对应栏；无该源结果 → empty 占位
        return sourcePlan.map((id) => {
            const items = results.filter((r) => sourceIdOf(r) === id);
            return { id, label: SOURCE_VIEW[id]?.label ?? id, items, empty: items.length === 0 };
        });
    })();

    /** 结果栏数上报：未展示结果（搜索输入中/已选/手动）→ 0，否则按固定参与源栏数（含空栏）。
     *  宿主仅在栏数 ≥3（三源并排）时加宽弹窗，1~2 栏与编辑态保持常规宽度 */
    let lastCols = 0;
    $: shownCols = !picked && results.length > 0 ? resultColumns.length : 0;
    $: {
        if (shownCols !== lastCols) {
            lastCols = shownCols;
            onResultCols(shownCols);
        }
    }

    /** 豆瓣图床（img*.doubanio.com）防盗链：无 Referer/空 Referer 返回 HTTP 418。
     *  必须用 <img referrerpolicy="unsafe-url"> 强制携带完整 Referer 才能加载封面 */
    function isDoubanImage(u: string): boolean {
        return /doubanio\.com/.test(u);
    }

    /** 类型 → 占位图标（搜索结果无封面 / 豆瓣防盗链封面时显示） */
    function typeIcon(t: EntryType): string {
        return ({ movie: '🎬', tv: '📺', anime: '🌸', book: '📖', game: '🎮', music: '🎵' } as Record<EntryType, string>)[t];
    }

    /** 推断数据源标识：显式 source（douban/tmdb/bangumi）优先，未标记的按结果类型回退（书籍/游戏仅 Douban） */
    function inferSource(r: SearchResult): string {
        if (r.source) return r.source;
        if ('author' in r) return 'douban';
        if ('platform' in r) return 'douban';
        if ('studio' in r) return 'bangumi';
        return 'tmdb';
    }

    async function doSearch() {
        // 空输入提示态（2026-09-12 用户需求）：原静默 return 用户无感知，就地给行内红字
        if (!query.trim()) { searchError = '请输入标题'; return; }
        // 🔴 #559：「中止重试」靠它作废在飞的旧一轮（旧请求回来后 `mySeq !== searchSeq` ⇒ 直接丢弃）
        const mySeq = ++searchSeq;
        searching = true;
        searchError = '';
        // 🔴 ⑬：**不再** `results = []`。旧行为一进场就清空，上次的结果直接蒸发，
        //    用户只能在一个 20 条的池子里打转（他要的是「可再搜索突破」）。
        //    现在旧结果留在屏上，等新结果回来按 `resultKeyOf` 去重后**并进**同一份列表。
        // ⚠️ 但仍要让结果区从「已选中」回到列表态 —— 那由 `picked = false` 负责。
        picked = false;
        // 固定占栏：在发起搜索前按当前态快照参与源（栏位自此恒定，不随本次各源成败增减）。
        // ⚠️ `sourcesKind` 与头部文案同取一份（#458：这里曾漏传子分类，
        //    漫画态按**文学链**建栏 ⇒ Bangumi / MangaDex 的结果无栏可归、整批不显示）。
        // ⚠️ `songLibOn` 同理（#464）：头部文案与这里**必须同一个开关**，否则音乐态又会出现
        //    「头部写着在线曲库、结果区却没这栏」⇒ 那批曲库结果被整批丢掉（与 #458 同一形态）。
        const plan = onSourcesForType(type, sourcesKind);
        sourcePlan = songLibOn ? [...plan, SONG_LIB_ID] : plan;
        srcLive = {}; // 逐源进度清零（本次重新搜索）
        progDone = 0;
        progTotal = 0;
        progLabel = '';
        startSimProgress();
        try {
            const q = query.trim();
            // 🔴 ⑬：先拿本次的**新鲜结果**，再交给宿主合并进累积池（宿主那侧去重 + 落盘）。
            //    ⚠️ 这里**不能在 await 之前把 results 清空**：合并要拿旧列表当底，
            //    而合并算法（新的在前、按 resultKeyOf 去重、截断上限）在 `pure/searchAccum` 里——组件不做业务判断。
            let fresh: SearchResult[];
            if (type === 'book') {
                // 传当前子分类：文学/网文均走 book 链（豆瓣主源 + Open Library），仅落库 bookKind 不同
                fresh = await onSearchBook(q, bookKind, onSearchProgress);
            } else if (type === 'game') {
                fresh = await onSearchGame(q, onSearchProgress);
            } else if (type === 'anime') {
                // 动画走 Bangumi（bgm.tv，中文标题权威，需 Access Token）+ Douban 并行
                fresh = await onSearchAnime(q, onSearchProgress);
            } else if (type === 'music') {
                fresh = await onSearchMusic(q, onSearchProgress);
            } else {
                fresh = await onSearch(q, type, onSearchProgress);
            }
            // 在飞的那一轮被「中止重试」作废了 ⇒ 连合并都别做（否则旧请求会把作废的结果写进池子）
            if (mySeq === searchSeq) {
                results = await onMergeSearchPool(type, type === 'book' ? bookKind : undefined, fresh);
                if (results.length === 0) {
                    searchError = '未找到相关结果，可换个关键词或直接手动填写';
                } else if (fresh.length === 0) {
                    // 本次没搜到、但池子里还有上次的 ⇒ 别报「未找到」误导用户（列表还在屏上）
                    searchError = '';
                }
            } else {
                return;
            }
        } catch (e) {
            searchError = e instanceof Error ? e.message : String(e);
            new Notice(searchError, 8000);
        } finally {
            // 🔴 #559：只有在飞的那一轮「还是当前这一轮」时才收尾 —— 点过「中止重试」之后
            //    旧请求回来不许覆盖新一轮的进度条与结果。
            if (mySeq === searchSeq) {
                stopSimProgress();
                searching = false;
                void prefetchTmdbDetails(); // 后台预取 TMDB 详情，不阻塞结果展示
            }
        }
    }

    /**
     * 搜索完成后异步并发预取 TMDB 详情：只对 source==='tmdb' 的影视结果拉详情，
     * 回填 year/rating/director/cast/genres 到 row2「一览即见」。
     * 分批并发（5 个/批）避免 30 个请求同时打 TMDB 触发限流；失败静默。
     */
    async function prefetchTmdbDetails() {
        const tmdbResults = results.filter(
            (x): x is TmdbSearchResult => 'mediaType' in x && (x as TmdbSearchResult).source === 'tmdb',
        );
        if (tmdbResults.length === 0) return;
        const BATCH = 5;
        for (let i = 0; i < tmdbResults.length; i += BATCH) {
            await Promise.all(
                tmdbResults.slice(i, i + BATCH).map(async (r) => {
                    try {
                        const d = await onFetchDetail(r);
                        if (!d || typeof d !== 'object') return;
                        const idx = results.findIndex((x) => x === r);
                        if (idx < 0) return; // 期间已换搜索，丢弃
                        results[idx] = mergeTmdbDetail(r, d);
                    } catch {
                        /* 预取失败静默：不影响结果展示 */
                    }
                }),
            );
        }
        results = [...results]; // 触发 Svelte 响应式更新 row2
    }

    /** 编辑模式「重新拉取」：展开搜索区（预填当前标题）并立即用该标题触发一次搜索，直接展示结果（复用 doSearch 的状态重置与搜索流程），选结果回填客观字段 */
    function startRefetch() {
        if (!entry) return;
        refetchOpen = true;
        query = entry.title;
        void doSearch(); // 点击即搜，无需再手动点「搜索」按钮
    }

    /** 搜索结果区点击空白处（非条目）→ 取消并关闭弹窗（替代原底部「取消」按钮） */
    function onResClick(ev: MouseEvent) {
        if ((ev.target as HTMLElement).closest('.rl-res-item')) return;
        onCancel();
    }

    async function pick(r: SearchResult) {
        searchError = '';
        // 🔴 #632：记住这次挑的是哪条（保存后宿主据此把这张卡片标成「已添加」）
        lastPicked = r;
        try {
            picked = true;
            manualFill = false; // #499B：点选结果这条路**不摆** AI 预填（客观字段已由数据源填好）
            refetchOpen = false; // 重新拉取选中结果后收起搜索区
            // 数据源决定表单 UI 模式：douban → 豆瓣版（全类型）；tmdb/bangumi → 对应版
            formMode = r.source === 'douban' ? 'douban' : 'studio' in r ? 'bangumi' : 'tmdb';
            title = r.title;
            // 数据源自动记录：笔记「来源」行跟随数据源官方链接（Douban/TMDB/Bangumi）
            // #386：本次这几笔写入**全部来自数据源** ⇒ 手填标记复位（预览徽标随之隐身，「自动获取填写保持原样」）。
            //  ⛔ 必须放在本函数所有 sourceUrl/communityScore 赋值**之前**（762/798/828 三处亦在本函数内）。
            metaTouched = false;
            sourceFrom = inferSource(r);
            // #451：来源名**自动回填成数据源名**（用户：「这个来源框还是没自动回填上啊，必须填，
            //   用什么源拉取就填什么，才能清晰」）。值取注册表真源 `sourceLabel(sourceFrom)`（douban →「豆瓣」、
            //   mangadex →「MangaDex」），与角标 / 笔记「来源」行的回落**同一个名字**。
            // ⚠️ 这是**程序化回填**（不是手填）⇒ `metaTouched` 保持 false，#386 的预览徽标仍只对手填出现。
            // ⛔ 别退回 `sourceName = ''`（那是 #430 的旧口径）：数据源明明记下了，框里却只有一个占位符 ——
            //   用户看到的就是「没拉取到来源」。
            sourceName = sourceLabel(sourceFrom);
            sourceUrl = describeSearchResult(r).sourceUrl ?? '';
            communityScore = r.rating != null ? String(r.rating) : '';
            ratingCount = r.ratingCount ? String(r.ratingCount) : '';
            if ('author' in r) {
                // 书籍：Douban 一次返回全部信息（含豆瓣详情字段；Open Library 搜索级字段见下 works.json 补全）
                originalTitle = '';
                if (r.year) year = String(r.year);
                author = r.author ?? '';
                // 🔴 #444g 画师：只有漫画的结果会带（MangaDex 的 `artist` 关系 / Bangumi 书籍 infobox「作画」）
                artist = r.artist ?? '';
                publisher = r.publisher ?? '';
                producer = r.producer ?? '';
                // 🔴 #444g 漫画**不拉** ISBN / 作者简介（用户原话：「把 ISBN、元数据页数、作者简介框删除掉」）——
                //    ⛔ 表单那边是靠条件不渲染排掉的，这里必须**同时**不填：否则重新拉取会把值塞进不可见的 state，
                //      保存时又落库 ⇒ 出现「界面上看不到、笔记里却有」的幽灵字段。
                //    ⚠️ ISBN / 作者简介**一直都不补给漫画**；而 `pageCount` 在 #445 加了「总话数」框之后
                //      是**要补**的（那些源把它叫「话数」，填的就是那个框）。
                if (bookKind !== 'comic') {
                    isbn = r.isbn ?? '';
                    authorIntro = r.authorIntro ?? '';
                }
                if (r.pageCount) pageCountVal = String(r.pageCount);
                binding = r.binding ?? '';
                price = r.price ?? '';
                series = r.series ?? '';
                genres = r.genres?.length ? r.genres.join(' / ') : '';
                summary = r.description ?? '';
                toc = r.toc ?? '';
                // 重新拉取封面策略：本地封面（封面/xxx.jpg）不被远程结果覆盖——豆瓣封面基本不变，
                // 每次重新拉取都覆盖会再次触发下载，封面/{标题}-2/-3.jpg 重复文件堆积；换封面走 URL 输入/拖图
                // 🔴 #589 翻面 #582：大图升级已上移到**结果投影层**（`pure/weread.toWereadBookResult`）
                //    —— 走到这里的微信读书结果**已经是大图**，这一层不再判来源、也不升级第二遍
                //    （升级函数是幂等的，但「同一件事两处做」正是本仓反复踩的那类分叉源）。
                if (shouldAdoptCover(poster, r.thumbnail)) poster = r.thumbnail;
                // 🔴 #582：微信读书的结果**自带在线阅读链接**（`sourceUrl` = `web/reader/<hash>`，见 #580），
                //    但表单的「网络地址」是**另一个字段**（`readUrl`，书籍专用）⇒ 通用回填**不会**碰它，
                //    于是从搜索源选完一本书后「阅读」按钮打开的是空白（用户 2026-10-09 报障）。
                //    ⛔ 只对微信读书补：别的源的 `sourceUrl` 是官网页面，塞进「网络地址」就是一条错链接。
                if (r.source === 'weread' && sourceUrl) readUrl = sourceUrl;
                // 豆瓣书籍兜底：搜索级缺 ISBN/装帧/定价 等，点击时按需拉详情补全
                if (r.source === 'douban' && !r.publisher) {
                    try {
                        const d = await onFetchDoubanDetail(r.id.replace('douban:', ''), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.publisher || d.isbn) new Notice('已自动补全豆瓣书籍详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
                // Open Library 书籍：search.json 不含简介/页数 → 点选时走 works.json 轻量补全（失败静默）
                if (r.source === 'openLibrary') {
                    try {
                        const d = await onFetchOpenLibraryDetail(r.id);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.summary || d.pageCount) new Notice('已自动补全 Open Library 书籍详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留搜索级字段
                    }
                }
                // 🔴 #609 微信读书：搜索结果**天生没有出版年**（接口不返回 `publishTime`）、简介也非全文
                //    ⇒ 选中时按需拉一次详情补齐，口径与「从微信读书同步书架」逐本补详情**完全一致**
                //    （同一端点 / 同一解析 / 同一字段映射）。⚠️ 需已填 Cookie；没填或失败 ⇒ 静默保留搜索级字段。
                if (r.source === 'weread' && r.bookId) {
                    try {
                        const d = await onFetchWereadDetail(r.bookId);
                        if (d) {
                            applyWereadDetail(d);
                            new Notice('已自动补全微信读书书籍详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留搜索级字段
                    }
                }
            } else if ('platform' in r) {
                // 游戏：Douban 搜索级字段（平台/开发商缺失）→ 选中时按需拉详情补全
                originalTitle = '';
                if (r.year) year = String(r.year);
                platform = r.platform ?? '';
                developer = r.developer ?? '';
                genres = r.genres?.length ? r.genres.join(' / ') : '';
                summary = r.summary ?? '';
                if (shouldAdoptCover(poster, r.cover)) poster = r.cover;
                // 豆瓣游戏兜底：搜索级缺平台/开发商时，点击时按需拉详情补全
                // ⚠️ 游戏 id 是 number（toGameResult id: Number(s.id)），不能用 replace 剥 douban: 前缀（书/音乐才是字符串 id）——String() 通用安全
                if (r.source === 'douban' && !r.platform && !r.developer) {
                    try {
                        const d = await onFetchDoubanDetail(String(r.id), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.platform || d.developer) new Notice('已自动补全豆瓣游戏详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
                // 🔴 #623 Steam 详情兜底：Steam 的搜索级结果只有标题 / 封面 / 来源链接
                //    （storesearch 不返回平台、开发商、简介）⇒ 选中时按需拉 appdetails 补上。
                //    ⚠️ 判据是**来源名**（不是「有 platform 键就是豆瓣」）—— 两种源的详情端点毫无关系。
                //    失败静默：保留搜索级字段，用户手填即可。
                if (r.source === 'steam') {
                    try {
                        const d = await onFetchSteamDetail(r.id);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.platform || d.developer) new Notice('已自动补全 Steam 详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留搜索级字段
                    }
                }
            } else if ('album' in r) {
                // 音乐：Douban 一次返回全部信息（歌手/专辑/年份/封面/简介/评分）
                originalTitle = '';
                if (r.year) year = String(r.year);
                author = r.artist ?? '';
                album = r.album ?? '';
                summary = r.summary ?? '';
                if (shouldAdoptCover(poster, r.cover)) poster = r.cover;
                // 豆瓣音乐兜底：搜索级缺歌手/专辑/年份时，点击时按需拉详情补全（#info 发行时间 → 发行年）
                if (r.source === 'douban' && (!r.artist || !r.album || !r.year)) {
                    try {
                        const d = await onFetchDoubanDetail(r.id.replace('douban:', ''), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.author || d.album) new Notice('已自动补全豆瓣音乐详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
            } else if ('studio' in r) {
                // 动画：Bangumi/AniList 搜索级字段直接回填（评分/制作公司/简介等已带）；Bangumi 另补详情
                originalTitle = r.originalTitle;
                if (r.year) year = String(r.year);
                genres = (r.genres ?? []).join(' / ');
                summary = r.summary ?? '';
                if (shouldAdoptCover(poster, r.cover)) poster = r.cover;
                // 详情补全后字段回填（搜索级无，persons/subject 详情 API 写入；主演字段仅 douban/tmdb 源显示，bangumi 隐藏但数据保留）
                if (r.director) directorWriters = r.director;
                if (r.cast?.length) cast = r.cast.join(' / ');
                // #165 T10 决策：只有 bgm.tv subject 语义的结果（bangumi 原生不设 source / 显式 'bangumi'）缺导演时才拉
                // Bangumi 详情；anilist 结果是 anilist.co/anime/{id}（source='anilist'，id 数值区间与 bgm 重叠），
                // 豆瓣兜底结果是 douban 站 id —— 两者发往 bgm API 会回填毫不相关条目的导演/评分，一律不发。
                // anilist 搜索级已含 genres/studio/desc/rating → 无需额外 detail GraphQL 往返（点选补全决策）。
                if ((!r.source || r.source === 'bangumi') && !r.director) {
                    try {
                        const d = await onFetchBangumiDetail(r.id);
                        if (d?.director) {
                            directorWriters = d.director;
                            if (d.rating != null) communityScore = String(d.rating);
                            if (d.ratingCount != null) ratingCount = String(d.ratingCount);
                            if (d.cast?.length) cast = d.cast.join(' / ');
                            new Notice('已自动补全 Bangumi 详情（导演/评分）', 2000);
                        }
                    } catch {
                        // 补全失败静默，保留搜索级字段
                    }
                }
                // 豆瓣动画兜底：豆瓣搜索级不含题材/导演/主演（parseDoubanItem 只出标题/年份/封面/简介），
                // 点选豆瓣动画结果时按需拉详情回填（JSON-LD + #info 有 导演/编剧/主演/类型/国家/集数 等）。
                // ⚠️ 此前动画分支没有此段，豆瓣结果只停留在搜索级 → 题材/导演/主演恒空（电影/剧集分支一直有）。
                if (r.source === 'douban' && !r.director && !r.cast?.length && !r.author && !r.developer) {
                    try {
                        const d = await onFetchDoubanDetail(String(r.id), type);
                        if (d) {
                            applyDoubanDetail(d);
                            new Notice('已自动补全豆瓣详情字段', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留已有搜索级字段（可手动填写，不阻塞保存）
                    }
                }
            } else {
                // 影视/剧集：TMDB/OMDb（IMDb）搜索后按源拉详情回填；豆瓣兜底结果直接可用（封面为完整 URL）
                originalTitle = r.originalTitle;
                if (r.year) year = String(r.year);
                if (r.source === 'omdb') {
                    const om = r as OmdbSearchResult;
                    // IMDb 海报搜索级直填（服务端 Poster=N/A 已滤除 → 无封面走占位图）
                    if (shouldAdoptCover(poster, om.poster)) poster = om.poster;
                    // i= 详情补 Plot/导演/演员(截5)/类型(截3)/imdbRating/imdbVotes(去逗号)；失败 null 静默
                    try {
                        const d = await onFetchOmdbDetail(om.imdbID);
                        if (d) {
                            applyDoubanDetail(d); // director/cast/genres/summary/cover/ratingCount/year 幂等回填
                            if (d.rating != null && !communityScore) communityScore = String(d.rating); // applyDoubanDetail 不读 rating → 评分单独回填
                        }
                    } catch {
                        // 详情补全失败静默：保留搜索级字段，不阻塞保存
                    }
                } else if (r.source === 'douban') {
                    if (shouldAdoptCover(poster, r.posterPath)) poster = r.posterPath;
                    if (r.overview) summary = r.overview;
                    // 详情字段：优先用 r 自带（仅前 3 条搜索时已补）；其余点击时按需拉详情补全
                    applyDoubanDetail(r as unknown as Record<string, unknown>);
                    if (!r.director && !r.cast?.length && !r.author && !r.developer) {
                        try {
                            const d = await onFetchDoubanDetail(String(r.id), type);
                            if (d) {
                                applyDoubanDetail(d);
                                new Notice('已自动补全豆瓣详情字段', 2000);
                            }
                        } catch {
                            // 详情拉取失败静默，保留已有搜索级字段
                        }
                    }
                } else if (r.source === 'tmdb') {
                    // 🔴🔴 #623 两道闸，缺一不可：
                    //  ⑴ 判据必须是**来源名**（`r.source === 'tmdb'`），⛔ 不是「不是 omdb / douban 就按 tmdb 处理」：
                    //     `onFetchDetail` 这条回调只通了 `fetchTmdbDetail`，拿别的来源的 id 去打 TMDB 必然 404。
                    //     本次报障就是这么来的 —— Steam 结果因缺判别键掉进本支，被当成影视结果发往
                    //     `api.themoviedb.org/3/undefined/{appid}`（见 `services/steam.ts` 的 `toGameResult`）。
                    //  ⑵ 详情补全**失败不许阻塞条目添加** —— 与豆瓣 / Bangumi / OpenLibrary / 微信读书那几支
                    //     同一口径（静默保留搜索级字段，用户可手填）。原来这里既没有 try/catch、也不判来源 ⇒
                    //     任何一次详情失败都会让整个 `pick` 抛错（外层 catch 把 `picked` 复位、**条目加不进去**），
                    //     用户看到的就是那句「回填详情失败」——明明搜索级数据已经够用了。
                    try {
                        const d = await onFetchDetail(r);
                        if (shouldAdoptCover(poster, posterUrl(d.posterPath))) poster = posterUrl(d.posterPath) ?? '';
                        if (d.genres?.length) genres = d.genres.join(' / ');
                        if (d.director) director = d.director;
                        if (d.cast?.length) cast = d.cast.join(' / ');
                        if (d.overview) summary = d.overview;
                        // 详情补全评价人数/评分（搜索级缺失时兜底）
                        if (d.ratingCount != null && !ratingCount) ratingCount = String(d.ratingCount);
                        if (d.rating != null && !communityScore) communityScore = String(d.rating);
                    } catch {
                        // 详情拉取失败静默：保留搜索级字段，不阻塞保存
                    }
                }
            }
            status = 'want';
            // 豆瓣封面防盗链（doubanio.com 需 Referer，Obsidian 直连 403）：下载到本地，失败保留远程 URL
            if (poster && isDoubanImage(poster)) {
                try {
                    poster = await onDownloadPoster(poster, title);
                } catch {
                    // 下载失败：保留远程 URL（预览可能空白，但不丢数据）。
                    // 批B：失败不再静默——明确告知用户，并指出「手动补封面」的既有入口
                    // （封面区拖入图片 / 右键「更换本地图片」），不新增任何常驻 UI
                    new Notice('封面下载失败，已保留网络地址（预览可能空白）。可将本地图片拖入封面区，或右键封面选「更换本地图片」手动设置', 8000);
                }
            }
            syncPosterUrlInput(); // 回填后 http 封面 URL 同步到输入框
            pickedTitle = r.title; // fhd 头部回显「添加条目：xx」
            await tick(); // 字段区刚渲染，等 DOM 挂载后聚焦标题输入框
            titleInput?.focus();
        } catch (e) {
            picked = false;
            searchError = '回填详情失败：' + (e instanceof Error ? e.message : String(e));
            new Notice(searchError, 8000);
        }
    }

    /** 复制链接到剪贴板（桌面 Obsidian 支持 navigator.clipboard） */
    async function copyLink(url: string | undefined) {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            new Notice('已复制链接');
        } catch {
            new Notice('复制失败，请手动复制');
        }
    }

    // ── 观看链接双路径：总集数变化时对齐 episodeFiles/episodeUrls 长度 ──
    // 只扩不缩：总集数变小时保留数据（渲染按当前总集数截取、提交时截断写入），
    // 避免 on:input 逐键重填（如 52→"5"→"52"）中间值把数组截断导致数据永久丢失
    function resizeEpisodeFiles() {
        const n = totalEpisodes ? Number(totalEpisodes) : 0;
        if (n > episodeFiles.length) {
            episodeFiles = Array.from({ length: n }, (_, i) => (i < episodeFiles.length ? episodeFiles[i] : undefined));
            episodeUrls = Array.from({ length: n }, (_, i) => (i < episodeUrls.length ? episodeUrls[i] : undefined));
            episodeTitles = Array.from({ length: n }, (_, i) => (i < episodeTitles.length ? episodeTitles[i] : undefined));
        }
    }
    /** 左键点击集按钮：本地优先播放，否则打开网络，都无提示右键编辑 */
    function playOrOpenEpisode(i: number) {
        resizeEpisodeFiles();
        const p = episodeFiles[i];
        const u = episodeUrls[i];
        if (p) {
            onPlayEpisode(p);
            return;
        }
        if (u) {
            openSource(u);
            return;
        }
        new Notice(type === 'movie' ? '未关联 — 右键该按钮编辑本地/网络链接' : `第 ${i + 1} 集未关联 — 右键该按钮编辑本地/网络链接`);
    }
    /** 批量检索本地剧集文件：选文件夹 → main 读目录识别文件名集号 → 未关联集保位填入本地路径，
     *  并**从文件名派生集标题**只填空位（#446 用户点名）；总集数不足时自动扩到最大命中集号；
     *  已填本地路径的集跳过（不覆盖），集标题照补。 */
    async function batchScanLocalEps() {
        const dir = await onPickVideoDir();
        if (!dir) {
            new Notice('未选择文件夹或系统对话框不可用');
            return;
        }
        const hits = await onScanEpisodeDir(dir);
        if (hits.length === 0) {
            new Notice('该文件夹没有可识别集号的视频文件', 5000);
            return;
        }
        const maxEp = hits[hits.length - 1].ep;
        // 只扩不缩：总集数取当前值与最大命中集号的大者，随后按新总集数扩展数组（保位）
        const curTotal = totalEpisodes ? Number(totalEpisodes) : 0;
        if (maxEp > curTotal) {
            totalEpisodes = String(maxEp);
        }
        resizeEpisodeFiles();
        let filled = 0;
        let skipped = 0;
        let titled = 0;
        for (const h of hits) {
            const i = h.ep - 1;
            // #446 集标题：从**文件名**派生预填（`1.新邻居.mp4` → 「新邻居」）。
            // 只填空位（⛔ 不覆盖手填），且**不受「本地路径是否已关联」影响** ——
            // 集标题与「这一集有没有路径」是两件事：已关联过路径的集照样该拿到标题（否则重扫一次等于没扫）。
            if (!episodeTitles[i]) {
                const t = episodeTitleFromName(h.name);
                if (t) {
                    episodeTitles[i] = t;
                    titled++;
                }
            }
            if (episodeFiles[i]) {
                skipped++;
                continue;
            }
            episodeFiles[i] = h.path;
            filled++;
        }
        // 数组元素写入后重设引用触发响应式（集按钮 linked 角标/悬停提示即时更新）
        episodeFiles = [...episodeFiles];
        episodeTitles = [...episodeTitles];
        new Notice(
            `已填入 ${filled} 集本地路径${titled ? `、${titled} 个集标题` : ''}${skipped ? `，跳过已关联 ${skipped} 集` : ''}`,
            4000,
        );
    }
    /** 右键编辑：打开第 N 集编辑弹窗（填集标题 / 本地路径 / 网络地址） */
    function openEpEditor(i: number) {
        resizeEpisodeFiles();
        editEp = i;
        editTitle = episodeTitles[i] ?? '';
        editLocal = episodeFiles[i] ?? '';
        editUrl = episodeUrls[i] ?? '';
    }
    // ─── 🔴 #563 / #568 / #583 自动保存「就地轻提示」────────────────────────────────
    //  历史：① #563 建了这条提示，但它挂在**窗口底部**（固定定位居中悬浮）；
    //        ② #568 用户点名「显示在浮层弹窗内本地路径或网络路径标题旁，**而不是窗口外**」
    //           ⇒ 集浮层改成**就地**（字段标签旁），另三个浮层当时**没动**（用户只点了集浮层）；
    //        ③ #583 用户：「书籍…的自动保存**逻辑与显示**与影视类型不一致，请说明并统一」
    //           ＋「其他类型也一并统一起该自动保存逻辑和显示」
    //           ⇒ 四类浮层（集 / 游戏 / 音乐 / 书籍）**共用同一个状态机**，提示一律**就地**；
    //             🔴 只服务旧路径的那条底部提示与其三件套（文案态 / 弹它 / 包它的那个出口）
    //             **整体退场**（死码不留）—— 同一条提示两次真源必然分叉。
    //             ⚠️ 本条注释**刻意不写那三个被删标识符的名字**：反向守卫就是按名字 grep 的，
    //                写了会自撞（本仓老坑）。
    //
    //  🔴 同一个状态机 + 键空间（`AUTOSAVE_KEYS`，真源在 `pure/popoverAutoSave`）：
    //     `savedKey` 记住「刚刚保存的是哪一行」，模板按它决定谁出提示（判据形态见模板里的 `{#if}`）。
    //     ⛔ 别给每类浮层各留一份 `xxxSaved` —— 那正是本批要收掉的分叉。
    /** 刚刚自动保存的那一行（`''` = 不显示）；取值域 = `AUTOSAVE_KEYS` */
    let savedKey: AutoSaveKey | '' = '';
    /** 失败态（红字）；文案真源 `pure/toast.TOAST_FAILED` */
    let savedBad = false;
    /**
     * 递增序号 —— 只为给 `{#key}` 换实例。
     * 🔴 为什么需要它：用户「如果用户在 3 秒内又进行了修改，原有的提示应该立即消失，
     *    重置 3 秒倒计时**并重新显示提示**」⇒ 同一句「设置已保存」必须**重播一次淡入**；
     *    只改文案变量的话 Svelte 会复用同一个 DOM 节点 ⇒ 动画不重播，看着像「第二次没提示」。
     */
    let savedSeq = 0;
    let savedTimer: ReturnType<typeof setTimeout> | undefined;
    /** 就地闪一条「设置已保存」（`TOAST_MS` 后自己消失） */
    function flashSaved(key: AutoSaveKey, bad = false): void {
        // 🔴 #593：提示**显示期间**的后续保存**不重弹、也不重置倒计时**——判据本体在
        //    `pure/toast.shouldFlashSaved`（与快捷关联弹窗共用一处；⚠️ 失败态例外，见那里的注释）。
        //    这条**翻面**了 #563/#568 的旧口径（旧：立即消失 + 重置倒计时 + 重播淡入）——
        //    用户 2026-10-10 明确改口，⛔ 别把旧口径写回来。
        if (!shouldFlashSaved(savedKey !== '', bad)) return;
        clearTimeout(savedTimer);
        savedKey = key;
        savedBad = bad;
        savedSeq += 1;
        savedTimer = setTimeout(() => { savedKey = ''; }, TOAST_MS);
    }
    /**
     * 四类浮层失焦自动保存的**唯一出口**（#583 统一）：判据 → 提交 → 就地闪提示。
     *
     * 🔴 判据本体在**纯模块** `pure/popoverAutoSave.shouldAutoSave`（配 `tests/popoverAutoSave.test.ts`），
     *    这里⛔ 一个字都不重复（trim / 比对 / force 三条口径只此一处）。
     * ⚠️ 面板里改的都是**表单态**（纯本地写入），正常不会抛；`catch` 求的是「真有异常时别静默吞掉」——
     *    用户点名失败要变红，那就得有一条**真能走到**的失败路径，⛔ 不是摆一块永远不亮的红牌。
     */
    function autoSaveField(key: AutoSaveKey, next: string, committed: string, commit: () => void, force = false): void {
        if (!shouldAutoSave(next, committed, force)) return;
        try {
            commit();
            flashSaved(key, false);
        } catch {
            flashSaved(key, true);
        }
    }
    onDestroy(() => clearTimeout(savedTimer));


    // ─── 🔴 #568 集浮层：自动保存**就地轻提示** ＋ 触发条件收窄（用户 2026-10-08 两条）──────────
    //  ① 「触发条件仅为填写了正确（非空）路径，为空时不触发自动保存」⇒ 三个输入框的失焦自动保存
    //     **只在该框去空白后有值时才跑**；为空一律早退 —— 既不写回、也不出提示。
    //     ⚠️ **不会丢数据**：把已填的路径清空后，`closeEpEditor()`（关闭时先提交）照旧会把空值写回表单态。
    //  ② 提示**就地**落在那一行的标签旁（#568 用户原话：「显示在浮层弹窗内本地路径或网络路径标题旁，
    //     而不是窗口外」）⇒ 键空间 `ep:title` / `ep:url` / `ep:local` 三枚，模板三处各挂一枚。
    //     🔴 #583：这条口径**已推广到全部四类浮层**（状态机与 `flashSaved` 见上方）。
    /** 集浮层的三个字段 → 就地提示键（⛔ 别在模板里手写裸字符串） */
    const EP_SAVE_KEYS: Record<'title' | 'url' | 'local', AutoSaveKey> = {
        title: AUTOSAVE_KEYS.epTitle,
        url: AUTOSAVE_KEYS.epUrl,
        local: AUTOSAVE_KEYS.epLocal,
    };

    /**
     * 🔴 #563 集编辑浮层「自动保存」：把缓冲写回**表单态**数组（空串 → undefined，重新赋值触发响应式）。
     * ⛔ **不关浮层** —— 关浮层另有出口（遮罩 / 各面板自己的关闭路径）。
     * 🔴 写回的是**表单值**，不是 catalog：最终落库仍是表单底部那枚「保存并生成笔记」
     *    （用户口径：「添加条目：保存并生成笔记，这个按钮才是最终保存态」）⇒ 所以文案说「已保存」而不是「已更新」。
     */
    function commitEpEditor(): void {
        if (editEp === null) return;
        const i = editEp;
        episodeFiles = episodeFiles.map((v, idx) => (idx === i ? editLocal.trim() || undefined : v));
        episodeUrls = episodeUrls.map((v, idx) => (idx === i ? editUrl.trim() || undefined : v));
        episodeTitles = episodeTitles.map((v, idx) => (idx === i ? editTitle.trim() || undefined : v));
    }

    /**
     * 某个字段在**表单态里的已存值**（去空白）—— 供「没改就不保存」那条守卫比对。
     * ⚠️ 只读**当前这一集**（`editEp`）的那一格；表里存的是 `string | undefined`（提交时空串会落成 `undefined`）。
     */
    function committedEpValue(field: 'title' | 'url' | 'local'): string {
        if (editEp === null) return '';
        const i = editEp;
        const v = field === 'title' ? episodeTitles[i] : field === 'url' ? episodeUrls[i] : episodeFiles[i];
        return (v ?? '').trim();
    }

    /**
     * 集浮层三处自动保存的**唯一入口**（失焦 / 粘贴 / 检索回填 都走它）。
     *
     * 🔴 三条触发口径（#568 ＋ #569，用户 2026-10-08 两次点名）—— 判据本体在**纯模块**
     *    `pure/popoverAutoSave.shouldAutoSave`（配 `tests/popoverAutoSave.test.ts`，⛔ 别在这里再写一遍条件）：
     *    ⑴ **空值不保存**：「为空时不触发自动保存」；
     *    ⑵ **没改不保存**（#569）：与**表单态里已存的那份值**一致就 return
     *       （⚠️ 比对必须拿表单态那份（`committedEpValue`），⛔ 别自己另存一份「上次的值」——
     *        打开/关闭浮层、批量填入都会改表单态，两份状态必然漂移）；
     *    ⑶ **填入即保存**（#569）：「**拉取网络路径填入后**自动保存，而不是需要我手动切换其他框才保存」
     *       —— 粘贴 / B站 候选回填 / 单集本地检索回填 / 浏览选文件 这四条**程序动作**都带 `force`。
     *    ⛔ 别把这些守卫挪进 `commitEpEditor`：那里的语义是「提交当前缓冲」（关闭出口要它能提交空值）。
     * 🔴 #583：出口统一到 `autoSaveField`（四类浮层同一条）—— 本函数只做「取缓冲 + 挑键」。
     */
    function autoSaveEp(field: 'title' | 'url' | 'local', force = false): void {
        if (editEp === null) return;
        const raw = field === 'title' ? editTitle : field === 'url' ? editUrl : editLocal;
        autoSaveField(EP_SAVE_KEYS[field], raw, committedEpValue(field), commitEpEditor, force);
    }

    /**
     * 🔴 #563 单集本地检索（用户：「本地路径旁边的小图标按钮，点一下要自动去设置页前置填写的媒体库目录
     *    路径里递归搜索当前集的视频文件，并直接自动填入绝对路径」）。
     *
     * 🔴 `epLocalBusy` 是**必须**的：底层是 fs 递归扫盘（可能几百毫秒到数秒）⇒
     *    ⑴ 按钮旁出转圈指示器（用户点名）；⑵ 期间的重复点击直接忽略（⛔ 别排队跑两遍）。
     * 🔴 三态提示**分开**（与宿主 `searchLocalEpisode` 的返回一一对应）：
     *    · `'nodir'` → 弹 `LOCAL_DIR_MISSING_WARN`（「请先前往设置页配置媒体文件根目录」）；
     *    · `'notfound'` → 只说**没找到这一集**（⛔ 别混进上面那条，那会把人支使去改一个本来就对的设置）。
     * ⚠️ 回填后**立刻**走一次自动保存（用户：「填入成功后，直接触发自动保存小灰色文字轻提示3秒后消失」）——
     *    走的是**同一个** `autoSaveEp('local')`（回填值必然非空 ⇒ 过得了 #568 那条空值守卫）；
     *    提示形态见 #568：**就地**显示在「本地路径」标签旁（⛔ 不再是窗口底部那条浮层提示）。
     */
    let epLocalBusy = false;
    async function searchLocalEpisodeNow(): Promise<void> {
        if (editEp === null || epLocalBusy) return;
        const i = editEp;
        const isMovie = type === 'movie';
        epLocalBusy = true;
        try {
            const res = await onSearchLocalEpisode({
                type,
                bookKind: bookKind || undefined,
                epIndex: i,
                epTitle: editTitle,
                title,
                isMovie,
            });
            if (!res.ok) {
                if (res.reason === 'nodir') new Notice(LOCAL_DIR_MISSING_WARN, 6000);
                else new Notice(isMovie ? '目录里没找到这个视频文件' : `目录里没找到第 ${i + 1} 集`, 5000);
                return;
            }
            editLocal = res.path;
            autoSaveEp('local', true);
        } finally {
            epLocalBusy = false;
        }
    }
    /** 集按钮 hover 提示：第 N 集 + 填写的集标题（如「第 1 集 开始」；未填标题只显示「第 N 集」）；
     *  电影无集概念（单集）：只显示标题，未填则提示右键编辑关联。
     *  🔴 #446：**集标题 / 本地 / 网络一律从参数收进来**（模板里直接读 `episodeTitles[i]` 等），
     *     文案本体走 `pure/episodeAssoc.episodeHintLabel`。原因是 Svelte 4 的依赖分析**不穿透函数体**：
     *     以前在函数体里读 `episodeTitles`，编译器压根不知道这个 each block 依赖它 ⇒ 保存集标题后
     *     `data-tip` 永不重算（用户报障「填了标题，悬停还是『第 2 集』」）。⛔ 别把读取挪回函数里。 */
    function epLinkHint(t: EntryType, i: number, title: string | undefined, hasSource: boolean): string {
        if (t === 'movie') {
            if (title?.trim()) return episodeHintLabel(i, title, true);
            return hasSource ? '右键编辑本地/网络链接' : '未关联 — 右键编辑本地/网络链接';
        }
        return episodeHintLabel(i, title, false);
    }
    /**
     * 编辑浮层「粘贴」：读剪贴板 → 清洗 → 填入网络地址。
     * 🔴 #569（用户：「**拉取网络路径填入后自动保存**，而不是需要我手动切换其他框才保存」）：
     *    粘贴**也算「程序填入」** ⇒ 填完立刻 `autoSaveEp('url', true)`（不等失焦、当场提交并在标签旁出提示）。
     */
    async function pasteEpUrl() {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        editUrl = v;
        autoSaveEp('url', true);
    }

    // ─── #500③ 集编辑浮层「网络地址」旁的「B站」：搜候选 → 点一条把链接填进编辑框 ───
    // 🔴 只**回填链接**，⛔ 不下载、不改集标题、不碰别的字段（用户 2026-10-03 选的是「候选列表，点一条填入」）。
    /** 候选浮层是否打开（关掉集编辑浮层时一并收起） */
    let epBiliOpen = false;
    /** 候选浮层里的检索词（初值 = 作品标题 + 集标题，用户可改） */
    let epBiliQuery = '';
    let epBiliVideos: BiliVideo[] = [];
    let epBiliBusy = false;
    let epBiliErr = '';
    // ── #505 分P 勾选表（入口 C）──
    /** 浮层当前视图：`search` = 候选列表；`parts` = 选中那条的分P 勾选表
     *  （⚠️ #520 起**没有 `batch`** —— 批量确认表已独立成卡，见 `batchOpen`） */
    let epBiliView: 'search' | 'parts' = 'search';
    /** 勾选表的行（真源 = `buildBiliFillRows`，组件只负责改 `checked`） */
    let epBiliRows: BiliFillRow[] = [];
    /** 勾选表表头那句上下文（选中那条视频的标题 + bvid） */
    let epBiliPickTitle = '';
    let epBiliPickBvid = '';
    /** 正在读分P（点候选后的一次往返；防连点） */
    let epBiliPartsBusy = false;
    // ── #519 批量搜索未填集（确认表）／#520 改成独立卡片 + 集数区间 ──
    /** 确认表是否开着（🔴 #520：**独立一张卡**，不再寄生在集编辑浮层里） */
    let batchOpen = false;
    /** 用户填的集数区间两端（1 起；默认 = 未填集的第一个 ~ 最后一个） */
    let batchFrom = 0;
    let batchTo = 0;
    /** 全部未填集的目标（区间只筛它，⛔ 不重新算一遍） */
    let batchAllTargets: BatchTarget[] = [];
    /** 每行 = 一个**未填**的集（已填的集根本不进表 ⇒ 不会跨集覆盖） */
    let batchRows: BatchRow[] = [];
    let batchRunning = false;
    /** 「继续」从哪个下标接着跑（= 纯模块返回的 `nextIndex`） */
    let batchCursor = 0;
    let batchDone = 0;
    let batchTotal = 0;
    /** 正在搜的那一集的集号（0 = 没在搜） */
    let batchEpNo = 0;
    let batchLastEpNo = 0;
    let batchReason = '';
    /** 是否**正常跑完**（false = 遇错停 / 用户停 ⇒ 显示「继续」） */
    let batchFinished = false;
    /** 用户点「停止」/ 浮层被关 ⇒ 让 `shouldContinue()` 返回 false */
    let batchCancel = false;
    /** 展开了候选列表的行下标（-1 = 都没展开） */
    let batchOpenRow = -1;
    /** 「填入」按钮的文案与禁用态（真源 = 纯函数） */
    $: batchPickedCount = batchCheckedRows(batchRows).length;
    $: batchCanFill = canFillBatch(batchRows);

    /**
     * 检索词的初值：作品标题 + 集标题；**集标题为空时用「第N集」补位**（#517 用户裁定）。
     * 🔴 口径本体在 `pure/dl/bilibili.biliEpisodeQuery`（快捷关联弹窗用的是**同一份**，⛔ 别各写一套）。
     *    电影态传 0 ⇒ 不做集号补位（电影没有「第几集」这回事）；两者都为空 ⇒ 空串，
     *    宿主那侧照样会给「需要关键词」的提示。
     */
    function epBiliDefaultQuery(): string {
        const epNo = type === 'movie' || editEp === null ? 0 : editEp + 1;
        return biliEpisodeQuery(title, epNo, editTitle);
    }
    /**
     * #517：**单P 直填**前的一句重复提示后缀 —— 这条链接若已被别的集占用，回「（注意：这条链接第 N 集已在用）」。
     * 🔴 2026-10-04 用户裁定：**只提示、不拦截**（与快捷关联弹窗同一个口径，⛔ 别只改一处）。
     */
    function epBiliDupNote(url: string): string {
        const dup = editEp === null ? 0 : urlUsedByOtherEp(episodeUrls, url, editEp);
        return dup ? `（注意：这条链接第 ${dup} 集已在用）` : '';
    }
    /**
     * 打开候选浮层并立即搜一次（沿用音乐下载那条链的交互：点开就有结果，不必先点「搜索」）。
     * 🔴 #517：检索词**每次打开都按当前集重算**（⛔ 别退回 `if (!epBiliQuery.trim())` 那种「空才算」——
     *    它会让「编辑第 2 集」沿用「编辑第 1 集」时那份检索词；用户报障原话：
     *    「点第2集搜索不映射为第2集，还是这个：熊出没」）。
     */
    async function openEpBiliPicker() {
        epBiliOpen = true;
        epBiliView = 'search';
        epBiliQuery = epBiliDefaultQuery();
        await runEpBiliSearch();
    }
    /** 搜一次（浮层里那颗「搜索」按钮；也供打开时自动跑） */
    async function runEpBiliSearch() {
        if (epBiliBusy) return;
        const kw = epBiliQuery.trim();
        epBiliVideos = [];
        epBiliErr = '';
        if (!kw) {
            epBiliErr = '先填检索词（默认取作品标题 + 集标题，缺则补第N集）';
            return;
        }
        epBiliBusy = true;
        try {
            const out = await onBiliSearch(kw);
            epBiliVideos = out.videos;
            epBiliErr = out.error ?? '';
        } catch (e) {
            epBiliErr = `B 站搜索出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            epBiliBusy = false;
        }
    }
    /** 勾选表 → 回到候选列表（也用于「换一条候选」） */
    function backToEpBiliSearch() {
        epBiliView = 'search';
        epBiliRows = [];
        epBiliPickTitle = '';
        epBiliPickBvid = '';
    }
    /**
     * 点一条候选（🔴 **#505 入口 C**：不再直接填入，而是先**展开它的分P 让用户勾**）。
     *
     * 🔴 为什么每条都要多一次往返：搜索接口**不返回分P 数**（实测），「单P / 52P」点开才知道。
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（请求失败 / `parts` 为空）**或只有 1 个分P**
     *    （= 单集投稿，B 站 `view` 也会给一条 `pages`）⇒ 直接按老行为填**这一条**的链接并关浮层，
     *    同时说明原因 —— 用户至少能拿到一条链接，而不是卡在一张只有「第 1 集」一行的表前面
     *    （本仓 #499D 那条纪律：工具失败不抛、能力回落；🔴 #518 才把判据从 `=== 0` 修成 `<= 1`）。
     */
    /**
     * 取这一条候选的分P 并**打开分P 勾选表** —— 🔴 两个入口**共用的唯一实现**：
     *   ① 单集检索点候选（`anchor` = **当前编辑的那一集**，#518 用户裁定「一律锚当前集」）；
     *   ② 批量卡那枚「展开分P」（`anchor` = `BATCH_PARTS_ANCHOR` = **0**，整季合集口径，见 #526）。
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（请求失败 / `parts` 为空）**或只有 1 个分P**
     *    （= 单集投稿，B 站 `view` 也会给一条 `pages`）⇒ 按 `fallbackEp` 分流：
     *    · 数字 ⇒ 直接填**那一集**并关浮层（老行为，用户至少拿到一条链接）；
     *    · `null` ⇒ **只提示不填** —— 批量那枚「展开分P」的对象是「整季」，填哪一集都不对
     *      （那种情况用户回去直接勾上那一行即可）。
     *    （本仓 #499D 那条纪律：工具失败不抛、能力回落；🔴 #518 才把判据从 `=== 0` 修成 `<= 1`。）
     */
    async function openEpBiliParts(v: BiliVideo, anchor: number, fallbackEp: number | null) {
        if (epBiliPartsBusy) return;
        epBiliPartsBusy = true;
        epBiliErr = '';
        try {
            const out = await onBiliParts(v.bvid);
            const parts: BiliPart[] = out.parts ?? [];
            if (out.error || parts.length <= 1) {
                if (fallbackEp === null) {
                    new Notice(out.error
                        ? `读取分P失败（${out.error}），这条没法展开 —— 单集投稿直接勾上那一行即可`
                        : '这条没有可勾的分P（单集投稿），直接勾上那一行即可');
                    return;
                }
                const dup = epBiliDupNote(v.webUrl);
                editUrl = v.webUrl;
                // 🔴 #569：候选回填也是「程序填入」⇒ 立刻保存（⛔ 别等用户失焦 —— 用户原话：
                //    「拉取网络路径填入后自动保存，而不是需要我手动切换其他框才保存」）。
                //    ⚠️ 放在**关浮层之前**：`autoSaveEp` 读的是 `editEp` / `editUrl`，关浮层会清掉它们。
                autoSaveEp('url', true);
                epBiliOpen = false;
                backToEpBiliSearch();
                new Notice(
                    (out.error
                        ? `读取分P失败（${out.error}），已直接填入这条链接`
                        : '这条没有可勾的分P，已直接填入本集') + dup,
                );
                return;
            }
            epBiliPickTitle = out.title || v.title;
            epBiliPickBvid = v.bvid;
            // 集数**按本条目总集数**传（⛔ 别用数组长度 —— #518 的教训）。
            epBiliRows = buildBiliFillRows(parts, episodeUrls, anchor, Number(totalEpisodes) || undefined);
            epBiliView = 'parts';
        } catch (e) {
            epBiliErr = `读取分P出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            epBiliPartsBusy = false;
        }
    }

    /** 单集检索：点一条候选（锚当前集；能力回落 = 直接填本集） */
    async function pickEpBiliUrl(v: BiliVideo) {
        await openEpBiliParts(v, editEp ?? 0, editEp ?? 0);
    }
    /** 勾 / 取消勾一行（⚠️ Svelte 4 不能对数组下标 `bind:` ⇒ 只能整数组换新，见本仓既有纪律） */
    function toggleEpBiliRow(epIndex: number, checked: boolean) {
        epBiliRows = epBiliRows.map((r) => (r.epIndex === epIndex ? { ...r, checked } : r));
    }
    /** 「全选」这一列的当前态（`true` = 可勾的行**全都**勾上了；`outOfRange` 的行不参与） */
    $: epBiliAllChecked = (() => {
        const can = biliSelectableRows(epBiliRows);
        return can.length > 0 && can.every((r) => r.checked);
    })();
    /** 当前勾中的行（给计数与「填入」按钮用） */
    $: epBiliPicked = biliCheckedRows(epBiliRows);
    /** 一次勾上 / 取消勾上**全部可勾的行**（52 行挨个点太累；「已填过的」也因此能被一键覆盖） */
    function toggleEpBiliAll(checked: boolean) {
        epBiliRows = epBiliRows.map((r) => (r.outOfRange ? r : { ...r, checked }));
    }
    /**
     * 把勾中的分P **批量写进本表单的集链接数组**。
     * 🔴 写入的只是**表单状态**（`episodeUrls`），**仍要点表单的「保存」才落库** ——
     *    与「粘贴 / 点一条候选填入」完全同一条纪律，⛔ 这里不直接改条目。
     * 🔴 填完**连同集编辑浮层一起收起**：批量填的对象已经不是「当前这一集」了，
     *    留着那个浮层只会让它的「网络地址」框显示一个可能刚被覆盖的旧值（自相矛盾）。
     */
    function applyEpBiliParts() {
        const picked = biliCheckedRows(epBiliRows);
        if (picked.length === 0) return;
        const byIndex = new Map<number, string>();
        for (const r of picked) {
            const url = buildBiliPartUrl(epBiliPickBvid, r.page);
            if (url) byIndex.set(r.epIndex, url);
        }
        if (byIndex.size === 0) return;
        episodeUrls = episodeUrls.map((v, idx) => (byIndex.has(idx) ? byIndex.get(idx) : v));
        // 🔴 #601：**分P 标题一起写进集标题**（用户报障「选集窗口拉取的网络 p1-52 都没有集标题显示」）——
        //    口径唯一真源 `biliPartTitles`（**只填空位**，与快捷关联弹窗同一次调用形态）。
        // 🔴 #607：`samePartUrl` 让**早先关联过、当时还没写标题**的集也能补上
        //     （那些集因为已有链接而默认不勾 ⇒ 不加这一层就永远补不上，用户二次报障即此）。
        const titleFills = biliPartTitles(epBiliRows, episodeTitles, (r) => {
            const cur = String(episodeUrls[r.epIndex] ?? '').trim();
            return !!cur && cur === buildBiliPartUrl(epBiliPickBvid, r.page);
        });
        if (titleFills.length) {
            const byTitle = new Map(titleFills);
            episodeTitles = episodeTitles.map((v, idx) => (byTitle.has(idx) ? byTitle.get(idx) : v));
        }
        epBiliOpen = false;
        backToEpBiliSearch();
        closeEpEditor();
        new Notice(`已把 ${byIndex.size} 条链接填进对应集${titleFills.length ? `、${titleFills.length} 个集标题` : ''}（点「保存」生效）`);
    }
    // ────────────────────── #519 批量搜索未填集（确认表）──────────────────────
    //
    //  🔴 与「在 B 站搜索这一集」那枚的分工：那枚 = **单集、交互式**（点候选 → 分P 勾选表）；
    //     本视图 = **批量、表格式**（把未填集全搜一遍 → 逐行确认 → 一次填入）。
    //  🔴 循环 / 限速 / 遇错即停 / 行模型**全在 `pure/biliBatch`**（与快捷关联弹窗共用同一份）。

    /**
     * 打开批量确认表（🔴 #520：**只开卡、不自动跑** —— 用户裁定「选了才跑」）。
     * 先算「全部未填集」并把区间默认成它的第一个 ~ 最后一个；一个未填集都没有就直接提示。
     */
    function openBiliBatch() {
        resizeEpisodeFiles();
        const all = buildBatchTargets(title, episodeUrls, Number(totalEpisodes) || 0, episodeTitles, type === 'movie');
        if (all.length === 0) {
            new Notice('本条目没有未填的集');
            return;
        }
        batchAllTargets = all;
        const d = epRangeOf(all);
        batchFrom = d.from;
        batchTo = d.to;
        batchRows = [];
        batchRunning = false;
        batchCancel = false;
        batchOpenRow = -1;
        batchDone = 0;
        batchTotal = 0;
        batchEpNo = 0;
        batchLastEpNo = 0;
        batchReason = '';
        batchFinished = false;
        batchOpen = true;
    }

    /** 收起批量确认表 —— 🔴 一并把正在跑的那轮停掉（⛔ 别在后台接着打请求） */
    function closeBiliBatch() {
        batchCancel = true;
        batchOpen = false;
        batchRows = [];
        batchOpenRow = -1;
    }

    /**
     * 🔴 #523：**单集检索**的入口 —— 批量卡某一行的「单集」按钮 ⇒ 关卡片 + 打开这一集的编辑浮层 + 直接开搜。
     * 用户原话：「[集编辑浮层里那枚 B站 图标] 撤掉，把功能合并到编辑表单路径旁小图标按钮功能里」
     *   ⇒ 浮层自己不再挂图标（「这些关联浮窗内小图标按钮都不再显示」），入口挂到
     *     「路径 → 检索网络（批量卡）→ 单集」这条链上；搜索本体（`epBili*` + 分P 勾选表）一字未动。
     * ⚠️ 顺序不能反：**先关卡片再开浮层** —— 两张卡的 z 层级相同、批量卡在 DOM 里更靠后，
     *    叠着开会被批量卡盖住；顺带 `closeBiliBatch()` 也会把还在跑的批停下。
     */
    async function openEpBiliFromBatch(idx: number): Promise<void> {
        const r = batchRows[idx];
        if (!r) return;
        closeBiliBatch();
        openEpEditor(r.epIndex);
        await openEpBiliPicker();
    }

    /**
     * 🔴🔴 #526：批量卡某一行那枚**「展开分P」** —— 这一行选中的是**整季合集**（多P），
     *   直接把它的分P 勾选表开出来，一次把整季填完。
     *
     * 由来（用户 2026-10-04，附确认表截图）：「批量网络检索只能适合单集的，有很多分52p的怎么办」——
     * 批量「填入」写的是 `pickedUrl(row)` = 候选的 `webUrl`，而那个链接**恒定 P1**（不带 `?p=`）
     * ⇒ 选中 52P 合集的行（截图里的第 2 / 第 4 集）会被写进**同一条 P1 链接** = **第 1 集的内容**，
     * 而用户看不出来。⇒ 多P 候选**默认不自动勾**（`withPartCount` 落地）+ 这里给一枚显式入口。
     *
     * 🔴 **锚 = `BATCH_PARTS_ANCHOR`（0）**，与单集检索那条「锚当前集」**有意不同**：
     *    能被展开的是整季合集，它的 P1 就是第 1 集；锚在批量行那一集（比如第 50 集）
     *    会把 P1 填到第 50 集、整季全部错位。
     * ⚠️ 顺序不能反：**先关批量卡、再开浮层 + 勾选表**（两张卡同 z 层级、批量卡在 DOM 里更靠后）。
     */
    async function expandBatchCandParts(idx: number): Promise<void> {
        const r = batchRows[idx];
        const v = r ? pickedCandidate(r) : undefined;
        if (!r || !v) return;
        closeBiliBatch();
        openEpEditor(r.epIndex);
        // ⚠️ 分P 勾选表住在 `{#if epBiliOpen}` 里 ⇒ 得先把那个浮层打开
        epBiliOpen = true;
        epBiliView = 'search';
        // `fallbackEp = null`：单集投稿不该从这枚入口填（那条路是「直接勾上这一行」）
        await openEpBiliParts(v, BATCH_PARTS_ANCHOR, null);
    }

    /**
     * 🔴 #542 批量卡「粘贴链接」：把**手里已有的 B站 合集链接**直接变成分P 勾选表。
     *
     * 与「搜索」的分工：搜索 = 「我不知道是哪一条」；粘贴 = 「我已经有那条链接了，别再替我搜一轮」。
     *
     * 🔴 **走现成的那条链**（⛔ 不另写一套）：`bvidFromPaste`（从剪贴板文本认号）
     *    → `openEpBiliParts(v, BATCH_PARTS_ANCHOR, null)` —— 与批量卡某行的「展开分P」
     *    **同一个实现、同一个锚**（用户 2026-10-07 裁定：带 `?p=` 也**忽略 p**，一律当整季合集）。
     * 🔴 顺序：**先关批量卡、再开集编辑浮层 + 勾选表**（同 #526 的理由：两张卡同 z 层级、
     *    批量卡在 DOM 里更靠后，叠着开会被盖住）。
     * ⚠️ 宿主浮层开在**第一个未填集**上（不是第 1 集）：第 1 集可能本来就已填好，
     *    而那个浮层只是勾选表的容器（填完 `applyEpBiliParts` 会把它一起收起）。
     */
    async function pasteBiliBatchLink(): Promise<void> {
        if (batchRunning) return;
        const raw = await readClipboardText();
        const text = raw ? cleanPastedText(raw) : '';
        if (!text) {
            new Notice('读不到剪贴板内容（请手动复制后重试）');
            return;
        }
        const bvid = bvidFromPaste(text);
        if (!bvid) {
            new Notice(/b23\.tv/i.test(text)
                ? '这是 b23.tv 短链 —— 请在浏览器里打开后复制完整链接（带 BV 号）'
                : '剪贴板里没找到 B 站视频号（需含 BV 号）');
            return;
        }
        const webUrl = buildBiliPartUrl(bvid, 1);
        if (!webUrl) {
            new Notice('这个 BV 号看起来不合法');
            return;
        }
        const hostEp = batchAllTargets[0]?.epIndex ?? 0;
        closeBiliBatch();
        openEpEditor(hostEp);
        // ⚠️ 分P 勾选表住在 `{#if epBiliOpen}` 里 ⇒ 得先把那个浮层打开（同 `expandBatchCandParts`）
        epBiliOpen = true;
        epBiliView = 'search';
        await openEpBiliParts({ bvid, title: '', author: '', durationSec: 0, play: 0, webUrl }, BATCH_PARTS_ANCHOR, null);
    }

    /** 按当前区间**重开一轮**（用户点了「搜索」）：整表重来，游标归零 */
    async function startBiliBatch() {
        const range = normalizeEpRange(batchFrom, batchTo, batchAllTargets[0]?.epNo ?? 0, batchAllTargets[batchAllTargets.length - 1]?.epNo ?? 0);
        batchFrom = range.from;
        batchTo = range.to;
        const picked = filterTargetsByRange(batchAllTargets, range);
        if (picked.length === 0) {
            new Notice('这个区间里没有未填的集');
            return;
        }
        batchRows = makeBatchRows(picked, title);
        batchCursor = 0;
        batchDone = 0;
        batchTotal = picked.length;
        batchEpNo = 0;
        batchLastEpNo = 0;
        batchReason = '';
        batchFinished = false;
        batchCancel = false;
        batchOpenRow = -1;
        await runEpBiliBatch();
    }

    /** 「继续」：从上次停下的那一集接着跑（⛔ 不重建表，已搜到的保留） */
    async function continueBiliBatch() {
        if (batchRows.length === 0) return startBiliBatch();
        await runEpBiliBatch();
    }

    /** 跑（或「继续」跑）：全部逻辑在 `runBatchSearch`，这里只注入回调 */
    async function runEpBiliBatch() {
        if (batchRunning) return;
        batchRunning = true;
        batchCancel = false;
        batchReason = '';
        try {
            const out = await runBatchSearch(
                batchRows,
                {
                    search: (kw) => onBiliSearch(kw),
                    parts: (bvid) => onBiliParts(bvid),
                    // ⚠️ 必须 `.slice()` 换**新数组引用**：纯模块是就地改同一个数组，
                    //    直接赋同一个引用 Svelte 认不出变化（⚠️ Svelte 4 的响应式按引用比）。
                    onUpdate: (rows, done, total, epNo) => {
                        batchRows = rows.slice();
                        batchDone = done;
                        batchTotal = total;
                        batchEpNo = epNo;
                    },
                    // 用户点「停止」/ 卡被关 ⇒ 立刻收手（⛔ 别在后台接着打请求）
                    shouldContinue: () => !batchCancel && batchOpen,
                },
                batchCursor,
            );
            batchRows = out.rows;
            batchCursor = out.nextIndex;
            batchLastEpNo = out.lastEpNo;
            batchReason = out.reason;
            batchFinished = out.done;
        } finally {
            batchRunning = false;
            batchEpNo = 0;
        }
    }

    /** 展开某一行的候选列表（收起再点 = 只收起，不重复打请求） */
    async function toggleEpBiliBatchCands(idx: number) {
        if (batchOpenRow === idx) {
            batchOpenRow = -1;
            return;
        }
        batchOpenRow = idx;
        await markEpBiliBatchCands(idx);
    }

    /** 展开时给**前几条**候选补标分P 数（串行 + 限速；⛔ 用户收起/关浮层就立刻收手） */
    async function markEpBiliBatchCands(idx: number) {
        for (const v of candidatesToMark(batchRows[idx])) {
            await markEpBiliCandPart(idx, v.bvid);
            if (batchOpenRow !== idx || !epBiliOpen) return;
            await batchSleep();
        }
    }

    /**
     * 取一条候选的分P 数并记进行里。
     * 🔴 取不到（失败 / 没有 `pages`）⇒ **什么都不写**（胶囊留空）—— 链接照常可用，
     *    ⛔ 别把「标不出分P」当成失败（与 `runBatchSearch` 同一条纪律）。
     */
    async function markEpBiliCandPart(idx: number, bvid: string) {
        const out = await onBiliParts(bvid);
        const n = Array.isArray(out?.parts) ? out.parts.length : 0;
        if (n > 0) batchRows = batchRows.map((r, i) => (i === idx ? withPartCount(r, bvid, n) : r));
    }

    /** 换成第 `ci` 条候选（顺手把它没标过的分P 数补上） */
    async function pickEpBiliBatchCand(idx: number, ci: number) {
        batchRows = batchRows.map((r, i) => (i === idx ? withPicked(r, ci) : r));
        batchOpenRow = -1;
        const v = pickedCandidate(batchRows[idx]);
        if (v && !batchRows[idx].partCounts[v.bvid]) await markEpBiliCandPart(idx, v.bvid);
    }

    /** 勾 / 取消勾一行 */
    function toggleEpBiliBatchRow(idx: number, checked: boolean) {
        batchRows = batchRows.map((r, i) => (i === idx ? withChecked(r, checked) : r));
    }

    /**
     * 把勾中的行写进**本表单的集链接数组**（`episodeUrls`）。
     * 🔴 只写表单状态，**仍要点表单的「保存」才落库** —— 与「粘贴」/ 分P 勾选表同一条纪律。
     * 🔴 写入按 `r.epIndex`（未填集的真实下标），**已填的集根本不在表里** ⇒ 不会跨集覆盖。
     */
    function applyEpBiliBatchFill() {
        const picked = batchCheckedRows(batchRows);
        if (picked.length === 0) return;
        const byIndex = new Map<number, string>();
        for (const r of picked) {
            const url = pickedUrl(r);
            if (url) byIndex.set(r.epIndex, url);
        }
        if (byIndex.size === 0) return;
        episodeUrls = episodeUrls.map((v, idx) => (byIndex.has(idx) ? byIndex.get(idx) : v));
        // 🔴 #607：**这批也把标题一起写进去**（用户报障「关联网络的 52 集一集标题都没显示」——
        //     批量这条链原先只写链接、从不写标题；口径真源 `batchFillTitles`，与分P 那条同一套纪律）。
        const titleFills = batchFillTitles(batchRows, episodeTitles);
        if (titleFills.length) {
            const byTitle = new Map(titleFills);
            episodeTitles = episodeTitles.map((v, idx) => (byTitle.has(idx) ? byTitle.get(idx) : v));
        }
        const n = byIndex.size;
        closeBiliBatch();
        new Notice(`已把 ${n} 集的链接填进对应集${titleFills.length ? `、${titleFills.length} 个集标题` : ''}（点「保存」生效）`);
    }

    /** 集编辑浮层收尾（点遮罩 / Esc）时把候选浮层一起收起 —— 否则会留一层孤儿。
     *  🔴 #563：收尾**先自动保存**再关 —— 底部三枚按钮（保存/清除/取消）已按用户要求整体移除，
     *     遮罩就是本浮层**唯一的关闭出口**，不在这里提交的话「改完直接点外面」会把改动丢掉。 */
    function closeEpEditor() {
        commitEpEditor();
        editEp = null;
        epBiliOpen = false;
        epBiliView = 'search';
        epBiliRows = [];
        // #517：检索词一并清掉 ⇒ 下次无论编辑哪一集都必然按那一集重算（⛔ 别留着上一集的词）
        epBiliQuery = '';
        // ⚠️ #520：批量确认表已**独立成卡**（不再寄生在本浮层里）⇒ 这里不再动它的状态，
        //    它的停批归 `closeBiliBatch()`。
    }
    /**
     * 编辑弹窗「浏览」：系统文件选择器（Electron remote.dialog 绝对路径），填入编辑框。
     * 🔴 #569：选完文件**也是「程序填入」** ⇒ 立刻 `autoSaveEp('local', true)`（与「检索本地 / 粘贴」同一口径：
     *    填完当场保存 + 标签旁出提示）。⚠️ 因此**撤掉了原来那句让用户手动保存的 Notice** ——
     *    它和「填入即保存」自相矛盾（用户已裁定填完就走）；真正落库仍是表单底部那枚主按钮。
     * ⚠️ 注释里**不写那句 Notice 的原文**：本块的反向守卫锚的就是它（注释进源码，写了会自撞红 —— 本仓老坑）。
     */
    async function browseLocalVideo(ev?: MouseEvent) {
        const p = await onPickLocalVideo(ev);
        if (p) {
            editLocal = p;
            autoSaveEp('local', true);
        } else {
            new Notice('无法打开文件选择器，请手动输入路径');
        }
    }
    /** 音乐编辑浮层「浏览」：系统文件选择器选本地音频，回填 audioPathVal（保存才写回 audioPath） */
    async function browseAudio(ev?: MouseEvent) {
        const p = await onPickLocalAudio(ev);
        if (p) {
            audioPathVal = p;
            syncAudioName();
            new Notice('已选择本地音频，点「保存」生效');
        } else {
            new Notice('未选择文件或系统对话框不可用，请重试');
        }
    }
    /** 游戏编辑浮层「浏览」：系统文件选择器选启动快捷方式（.lnk），回填 gameLaunchVal（保存才写回 gameLaunchPath） */
    async function browseGameLaunch(ev?: MouseEvent) {
        const p = await onPickGameLaunch(ev);
        if (p) {
            gameLaunchVal = p;
            new Notice('已选择启动快捷方式，点「保存」生效');
        } else {
            new Notice('未选择文件或系统对话框不可用，可手动输入路径');
        }
    }
    /** 书籍「▶ 阅读」左键：有关联文件 → 打开阅读器（关闭后同步进度）；无本地但**有网络地址** → 打开在线阅读页
     *  （#529「本地优先、无本地才走网络」，与影视「观看」同语义）；两者都没有 → 提示右键编辑 / 点检索。 */
    async function watchBook() {
        if (bookFileVal.trim()) {
            const rp = await onOpenReader();
            // 阅读器关闭后自动解析当前进度：percent 唯一真源 → 派生当前页/章；totalPage 同步本地基准（PDF 页/TXT 章）
            if (rp) {
                if (rp.totalPage !== undefined) readingTotalPage = String(rp.totalPage);
                if (typeof rp.percent === 'number' && rp.totalPage) {
                    readingPage = String(pageFromPercent(rp.percent, rp.totalPage));
                } else if (rp.page !== undefined) {
                    readingPage = String(rp.page);
                }
            }
        } else if (readUrl.trim()) {
            onOpenSource(readUrl.trim());
        } else {
            // 🔴 #535：网文 / 漫画**没有**那枚在线检索按钮（用户裁定「暂不做在线检索」）
            //    ⇒ 提示里⛔ 不许再指向一个不存在的按钮，改指「右键浮层里粘贴」。
            new Notice(
                bookKind === 'book'
                    ? '未关联本地文件 / 网络地址 — 右键「阅读」选本地文件，或点「检索在线书籍阅读」'
                    : '未关联本地文件 / 网络地址 — 右键「阅读」选本地文件，或在「网络地址」里粘贴在线阅读链接',
                5000,
            );
        }
    }
    /**
     * 书籍「▶ 阅读」右键：弹编辑浮层（浏览/手动输入路径）。
     * 🔴 #583：这个浮层是四类里**唯一没有独立缓冲**的 —— 两个输入框直连表单态
     *    （`bookFileVal` = 表单的 `bookFile`；`readUrl` = 表单的 `readUrl`）
     *    ⇒ 「没改不保存」那条判据**只能对着「打开浮层那一刻的快照」比**（这就是快照的由来）。
     *    ⚠️ 别的浮层不要照抄这个快照：它们的 `committed` 是**表单态里那份独立的值**（缓冲制），
     *       两份状态并存时再存快照 = 第三份状态（#569 明令禁止）。
     */
    function openBookEditor() {
        bookOpenPath = bookFileVal;
        bookOpenUrl = readUrl;
        bookEditOpen = true;
    }
    /** 打开书籍浮层那一刻的两个值（仅供「没改不保存」比对；⛔ 别拿它当提交目标） */
    let bookOpenPath = '';
    let bookOpenUrl = '';
    /** 书籍浮层两个字段 → 就地提示键 */
    const BOOK_SAVE_KEYS: Record<'path' | 'url', AutoSaveKey> = {
        path: AUTOSAVE_KEYS.bookPath,
        url: AUTOSAVE_KEYS.bookUrl,
    };
    /**
     * 🔴 #583 书籍浮层自动保存（与集浮层**同一判据 + 同一出口**）。
     * 🔴 「提交」在这里是**空操作**：输入框绑定的就是表单态本身 ⇒ 值早在表单里了。
     *    但**判据与就地提示照跑** —— 用户点名要的就是「显示也统一」，而不是「什么都不显示」。
     */
    function autoSaveBook(field: 'path' | 'url', force = false): void {
        const raw = field === 'path' ? bookFileVal : readUrl;
        const committed = field === 'path' ? bookOpenPath : bookOpenUrl;
        autoSaveField(BOOK_SAVE_KEYS[field], raw, committed, () => undefined, force);
    }
    /**
     * 🔴 #535（用户报障：「书籍类编辑弹窗网络路径框没有粘贴文字按钮」）：
     * 书籍「网络地址」那行原先只有一枚裸输入框（游戏那行有「粘贴」、影视集编辑浮层也有）
     * ⇒ 与同类输入框**不同款**。补一枚，走与 `pasteEpUrl` / `pasteGameUrl` **同一条**读剪贴板纪律。
     */
    async function pasteReadUrl(): Promise<void> {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        readUrl = v;
        // 🔴 #583：粘贴 = 「程序填入」⇒ 当场保存（见 `pasteGameUrl` 那条注释的同一口径）
        autoSaveBook('url', true);
    }
    /**
     * 书籍浮层关闭（点遮罩）。
     * 🔴 #583：这里**没有「先提交再关」这一步** —— 两个输入框直连表单态（见 `openBookEditor`），
     *    关浮层时值早在表单里了，不存在「改完点外面会丢」的情形（另三个浮层有缓冲，所以要提交）。
     * 🔴 解析页数（`autoLinkBookProgress`，实打实读一次本地文件）**只在关浮层时**跑，⛔ 别挂到 blur 上 ——
     *    点一次「浏览」也会失焦，那样每选一次文件就要多解析一轮。
     */
    function closeBookEditor(): void {
        bookEditOpen = false;
        void autoLinkBookProgress(bookFileVal.trim());
    }
    /**
     * 书籍「检索本地」—— 🔴 #602 起 = 与影视单集本地检索**同一条链**（宿主 `main.searchLocalBookFile`：
     * 按子分类取设置里的「文学 / 网文 / 漫画目录」→ 递归扫 → 标题匹配）。
     *
     * 用户两次改口，都在这里留痕（⛔ 别再往回改）：
     *   · #417「检索库内同名书籍文件」（扫「书籍文件目录」）；
     *   · #524「书籍检索文件目录给我先弹出系统文件选择器让我选择目录」⇒ 改成**先挑目录**；
     *   · 🔴 #602「书籍关联入口这个小图标按钮怎么是**选文件夹**关联的，**统一成检索关联**」
     *     ⇒ 两段式作废，回到「不问用户、直接搜配置目录」——与音乐那枚（音频目录）、影视那枚（分类目录）
     *     彻底同款；行为差异只剩「搜哪个目录」，而那由 `pure/localDirs.localDirKeyFor` 一处决定。
     *
     * 🔴 匹配逻辑在纯模块 `pure/libraryBooks`（与下载排序共用同一把相似度尺），组件只负责**取数与提示**。
     * ⚠️ 回填进框里仍要**点「保存」才落库** —— 文案必须说清（与「浏览」那条同款）。
     * ⚠️ 失败/没配目录一律走 `out.notice`（宿主给的文案），⛔ 组件不再自己编一套。
     */
    async function findLibraryBook(): Promise<void> {
        const t = title.trim();
        if (!t) {
            new Notice('标题为空，先填标题再检索');
            return;
        }
        const out = await onSearchLocalBook({ bookKind, title: t, author: author.trim() });
        if (out.path) {
            bookFileVal = out.path;
            new Notice(`${(out.count ?? 0) > 1 ? `命中 ${out.count} 个，已` : '已'}填入「${out.name ?? out.path}」，点「保存」生效`);
            return;
        }
        if (out.notice) new Notice(out.notice, 5000);
    }

    /**
     * 🔴 #534 游戏「检索本地」—— 与书籍那条**同款两段式**（用户裁定「按现有做法：先弹目录选择器，再按标题找同名」）：
     *   ① `onPickGameDir()` 三态（选中 / 取消 / 本环境无对话框）；
     *   ② 列出该目录里的**可启动文件**（`.lnk/.exe/.bat/.cmd/.app/.sh`，判据在 `pure/gameLaunch`）；
     *   ③ 复用 `pickLibraryBook` 的**同一把尺**做标题匹配（⛔ 别在这里另写相似度），命中即回填 `gameLaunchVal`。
     * ⚠️ 游戏**没有**「配置目录」可回落（不像书籍有「书籍文件目录」）⇒ 非桌面端 / 没有对话框时**只能提示**，⛔ 别硬编一个目录。
     */
    async function findLibraryGame(): Promise<void> {
        const t = title.trim();
        if (!t) {
            new Notice('标题为空，先填标题再检索');
            return;
        }
        const dir = await onPickGameDir();
        if (dir === null) {
            new Notice('未选择目录，已取消检索');
            return;
        }
        if (dir === undefined) {
            // 与书籍那条不同：游戏没有配置目录可回落（⛔ 别拿库目录顶上 —— 结果会让人意外）
            new Notice('当前环境没有系统目录选择器，无法检索本地游戏文件', 5000);
            return;
        }
        const files = await onListGameLaunchFilesInDir(dir);
        if (files.length === 0) {
            new Notice(`${dir} 里没有可启动的游戏文件（.lnk / .exe / .bat…）`, 5000);
            return;
        }
        const { best, ranked } = pickLibraryBook(files, t, '');
        if (!best) {
            new Notice(`${dir} 里没找到与「${t}」同名的游戏文件`, 5000);
            return;
        }
        gameLaunchVal = best.path;
        new Notice(`${ranked.length > 1 ? `命中 ${ranked.length} 个，已` : '已'}填入「${best.name}」，点「保存」生效`);
    }

    /**
     * 🔴 #534 电影行内那枚「网络检索」（用户：「电影两枚（本地和网络）」）。
     * 电影只有一个链接位（第 0 集）⇒ 直接复用**集内那套**：开第 0 集编辑浮层 + B 站候选弹窗
     * （⛔ 不新写检索逻辑、⛔ 不复制一份候选卡），选完在浮层里点「保存」。
     */
    async function searchMovieOnline(): Promise<void> {
        openEpEditor(0);
        await openEpBiliPicker();
    }
    /**
     * #529 书籍「检索在线书籍阅读」：打开候选浮层，按标题（+ 作者）预填检索词并立刻搜一次。
     * 🔴 检索源 = 微信读书（宿主 `main.searchWeread`）；只回填链接到表单 `readUrl`
     *    （仍要点表单「保存」才落库）—— ⛔ 组件不下载、不解析正文。
     * 🔴 #535：检索源**按书籍子分类分流**（用户裁定）—— 目前**只有文学（含缺省）接微信读书**；
     *    网文 / 漫画**不接在线源**（实测起点 / 番茄 / 腾讯动漫 / B站漫画等一律反爬或需签名，
     *    拿到的是 JS 空壳；拷贝漫画 / 动漫之家域名不可达）⇒ 那类条目走右键「网络地址」手填或粘贴。
     *    ⚠️ 这条守卫与模板里 `{#if bookKind === 'book'}` 那层**必须同时存在**：模板挡住入口，
     *    这里挡住「切换子分类时浮层还开着」的漏网（⛔ 别只留一边）。
     */
    async function openReadUrlPicker() {
        if (bookKind !== 'book') {
            new Notice('网文 / 漫画暂不提供在线检索 — 可在右键「启动路径」里手填或粘贴网络地址', 5000);
            return;
        }
        readUrlOpen = true;
        readUrlQuery = buildWereadQuery(title, author);
        readUrlBooks = [];
        readUrlErr = '';
        if (!readUrlQuery.trim()) {
            readUrlErr = '先填写标题（或作者）再检索';
            return;
        }
        await runReadUrlSearch();
    }
    async function runReadUrlSearch() {
        const q = readUrlQuery.trim();
        if (!q || readUrlBusy) return;
        readUrlBusy = true;
        readUrlErr = '';
        try {
            const out = await onSearchWeread(q);
            readUrlBooks = out.books ?? [];
            readUrlErr = out.error ?? '';
        } catch (err) {
            readUrlBooks = [];
            readUrlErr = err instanceof Error ? err.message : String(err);
        } finally {
            readUrlBusy = false;
        }
    }
    /** 选中一条候选 → 写入表单 `readUrl`（仍要点「保存」落库），关浮层并提示 */
    function pickReadUrl(c: WereadCandidate) {
        readUrl = c.readUrl;
        readUrlOpen = false;
        new Notice('已填入网络地址，点「保存」生效');
    }
    /**
     * 🔴 #685：音乐「网络地址」在线检索 —— 打开**在线曲库候选卡**，检索词按「歌名 + 歌手」预填。
     * ⚠️ 音乐侧主表单**没有**网络地址输入框（链接只存在于关联浮层里）⇒ 这枚 globe 必须挨着
     *    浮层里那个「网络地址」标题，⛔ 别挂到主表单「启动路径」行去（那行是本地检索 + 下载）。
     */
    async function openSongUrlPicker(): Promise<void> {
        songUrlOpen = true;
        songUrlQuery = [title.trim(), artist.trim()].filter(Boolean).join(' ');
        songUrlCands = [];
        songUrlErr = '';
        if (!songUrlQuery.trim()) {
            songUrlErr = '先填写歌名（或歌手）再检索';
            return;
        }
        await runSongUrlSearch();
    }
    /** 跑一次在线曲库检索（宿主那侧按能力门控并给文案） */
    async function runSongUrlSearch(): Promise<void> {
        const q = songUrlQuery.trim();
        if (!q || songUrlBusy) return;
        songUrlBusy = true;
        songUrlErr = '';
        try {
            const out = await onSearchSongLibrary(q);
            songUrlCands = out.cands ?? [];
            songUrlErr = out.error ?? '';
        } catch (err) {
            songUrlCands = [];
            songUrlErr = err instanceof Error ? err.message : String(err);
        } finally {
            songUrlBusy = false;
        }
    }
    /**
     * 选中一条候选 → 回填音乐「网络地址」。
     * 🔴 程序填入 ⇒ 与「粘贴」同口径**当场落库**（`force`），⛔ 别让它只停在浮层缓冲里等失焦。
     */
    function pickSongUrl(c: PlayableCand): void {
        const u = (c.url ?? '').trim();
        if (!u) {
            new Notice('这一条没有可回填的链接，换一条试试');
            return;
        }
        audioUrlVal = u;
        autoSaveAudioUrl(true);
        songUrlOpen = false;
        new Notice('已填入网络地址');
    }
    /**
     * 失效集的悬停提示后缀（未检测 / 非 `dead` → 空串）。
     * 🔴 `dead` 才提示：`unknown`（403 / 超时）**不提示**，与不标红同口径（别把「测不动」说成「已失效」）。
     */
    function deadHint(i: number): string {
        return linkStatuses[i] === 'dead' ? '\n⚠ 链接可能已失效' : '';
    }
    /** 书籍编辑浮层「浏览」：系统文件选择器选 TXT/EPUB/PDF（书籍）或 CBZ/CBT/…（漫画），回填 bookFileVal */
    async function browseBookFile(ev?: MouseEvent) {
        const p = await onPickBookFile(ev);
        if (p) {
            bookFileVal = p;
            new Notice('已选择书籍文件，点「保存」生效');
            await autoLinkBookProgress(p);
        } else {
            new Notice('无法打开文件选择器，请手动输入路径');
        }
    }
    /**
     * 🔴 #539 漫画「选文件夹」：把**这个文件夹本身**关联成书（「散装文件夹型」= 一个装满图片的文件夹）。
     *
     * 🔴 为什么必须单独一枚按钮：Electron 的 `showOpenDialog` 在 **Windows / Linux 上不能同时**选文件与目录
     *    （组合形态会退化成只能选文件）⇒ 用户实测报障「漫画关联不了图片文件夹、只能单文件格式」正是这个平台差异。
     *    ⇒ **明确分流**：文件走「浏览」（`openFile`）、目录走这一枚（`openDirectory`）。
     * ⚠️ 三态与「检索本地书籍」同一口径（`string` 选中 / `null` 用户取消 / `undefined` 本环境没有系统对话框）：
     *   取消 ⇒ 什么都不做（⛔ 别静默拿别的路径顶上）；无对话框（非桌面端）⇒ 说清这台机器没有文件夹选择器。
     * 🔴 只回填表单值，仍要点「保存」才落库（与「浏览」同款，文案必须说清）。
     */
    async function browseBookFolder(): Promise<void> {
        const dir = await onPickBookFolder();
        if (dir === undefined) {
            new Notice('当前环境没有系统文件夹选择器（仅桌面端支持）', 4000);
            return;
        }
        if (dir === null) {
            new Notice('未选择文件夹，已取消');
            return;
        }
        bookFileVal = dir;
        new Notice(`已关联文件夹「${dir}」，点「保存」生效`);
    }
    /** 进度页数自动关联本地文件：PDF 解析本地页数、TXT/EPUB 按章节解析 → totalPage 收紧本地基准、当前进度按既有 percent 重算/钳制
     *  （复用 reconcileBookProgress）；无变化/失败静默（保持手填） */
    /**
     * 进度页数自动关联解析。notify=true 时（刷新按钮测试获取）无变化/失败也明确反馈；浏览/保存场景保持静默不打扰
     *
     * 🔴 #426 **文件没了 ⇒ 手动点按钮时把进度清空归零**（用户：「删除了关联的书籍文件后点击进度页数按钮
     *    无法重置归零」）。两条不通的路（未关联 / 文件不存在或解析不出）都要归零，且**只在 `notify`
     *    （用户手点那颗 ⟳）时做** —— 静默场景（浮层保存路径、浏览选文件）自动归零会平白清掉用户手填的进度。
     */
    async function autoLinkBookProgress(path: string, notify = false) {
        if (!path) {
            if (notify) {
                resetBookProgress();
                new Notice('未关联书籍文件 —— 阅读进度已清空', 4000);
            }
            return;
        }
        const info = await onProbeBookPages(path);
        if (!info) {
            if (notify) {
                resetBookProgress();
                new Notice('本地文件不存在或解析不出 —— 阅读进度已清空', 4000);
            }
            return;
        }
        // 进度基准单位：PDF=页；TXT/EPUB=章（章节制，EPUB 无固定页码）；
        // 🔴 #549 **漫画=页**（图片文件夹 / CBZ·ZIP / EPUB 漫画一律按图片页计，见 `bookUnit` 那条口径）——
        //    漏掉这一档时 `info.numPages` 取不到（`total` 变 undefined、`unit` 误写成「章」），
        //    而这颗 ⟳ 又恰好走在 #426 那条「解析不出就清空」的路上 ⇒ 漫画的手填进度会被平白抹掉。
        const isPageUnit = info.format === 'pdf' || info.format === 'comic';
        const total = isPageUnit ? info.numPages : info.totalChapters;
        const unit = isPageUnit ? '页' : '章';
        const r = reconcileBookProgress(
            {
                page: readingPage ? Number(readingPage) || undefined : undefined,
                totalPage: readingTotalPage ? Number(readingTotalPage) || undefined : undefined,
                percent: entry?.readingProgress?.percent,
            },
            info
        );
        if (!r.readingProgress) {
            // 无变化（已解析过）：浏览/保存静默，刷新测试场景明确反馈「已是最新」
            if (notify) new Notice(`解析成功：本地 ${total} ${unit}（已是最新）`, 4000);
            return;
        }
        if (r.readingProgress.totalPage !== undefined) readingTotalPage = String(r.readingProgress.totalPage);
        if (r.readingProgress.page !== undefined) readingPage = String(r.readingProgress.page);
        const hint = r.readingProgress.page !== undefined ? `，当前${unit}同步为 ${r.readingProgress.page}` : '';
        new Notice(`已从本地文件解析：共 ${total} ${unit}${hint}`);
    }
    /**
     * 阅读进度**清空归零**（#426）。清两个输入框 + 置 `progressReset`（让本次保存不写回旧 `percent`）。
     * ⚠️ `progressReset` 只在该标志为真**且两个框都空**时才丢弃 percent（见 `submit`）——
     *    这样用户归零后又手填了数字，不会顺手把 percent 一起丢掉。
     */
    function resetBookProgress(): void {
        readingPage = '';
        readingTotalPage = '';
        progressReset = true;
    }
    /** 游戏「▶ 启动」左键：有关联 → 启动游戏；无 → 提示右键编辑 */
    function launchGameFromForm() {
        if (gameLaunchPath.trim()) {
            onLaunchGame();
        } else {
            new Notice('未关联启动快捷方式 — 右键「启动」选择 .lnk 文件', 5000);
        }
    }
    /** 游戏「▶ 启动」右键：弹编辑浮层（浏览/手动输入路径） */
    function openGameEditor() {
        gameLaunchVal = gameLaunchPath;
        gameUrlVal = gameUrl; // #534 网络路径与启动路径同一浮层（两条各自缓冲，保存一起写回）
        gameEditOpen = true;
    }
    /** 🔴 #563 游戏浮层提交：两条缓冲各自写回（`gameLaunchPath` 启动路径 / `gameUrl` 网络路径） */
    function commitGameEditor(): void {
        gameLaunchPath = gameLaunchVal.trim();
        gameUrl = gameUrlVal.trim(); // #534：网络路径与启动路径同属「关联」，一起写回（⛔ 别只写一条）
    }
    /** 游戏浮层两个字段 → 就地提示键 */
    const GAME_SAVE_KEYS: Record<'launch' | 'url', AutoSaveKey> = {
        launch: AUTOSAVE_KEYS.gameLaunch,
        url: AUTOSAVE_KEYS.gameUrl,
    };
    /**
     * 🔴 #583 游戏浮层自动保存（与集浮层**同一判据 + 同一出口**）。
     * `committed` = 表单态里的 `gameLaunchPath` / `gameUrl` —— 浮层期间**不会被改**
     * （用户改的是两条缓冲），所以直接拿它比对即可，⛔ 不需要另存快照。
     */
    function autoSaveGame(field: 'launch' | 'url', force = false): void {
        const raw = field === 'launch' ? gameLaunchVal : gameUrlVal;
        const committed = field === 'launch' ? gameLaunchPath : gameUrl;
        autoSaveField(GAME_SAVE_KEYS[field], raw, committed, commitGameEditor, force);
    }
    /** 游戏浮层关闭（点遮罩）—— 同集浮层：**先无条件提交缓冲再关**，否则「改完点外面」会丢改动。
     *  ⚠️ 这里**不跑判据**（与 `closeEpEditor` 同口径）：关闭出口要能把空值也提交下去（那是「清除」的唯一路）。 */
    function closeGameEditor(): void {
        commitGameEditor();
        gameEditOpen = false;
    }
    /**
     * #534 游戏浮层「网络路径」旁的**粘贴**：读剪贴板 → 清洗 → 填进缓冲值 → **立即保存**。
     * 🔴 复用影视集编辑浮层那套（`readClipboardText` + `cleanPastedText`），⛔ 别另写一份剪贴板读取。
     * 🔴 #583：粘贴属于 #569 说的「**程序填入**」⇒ 带 `force` **当场保存**（⛔ 别留成「要点别的框才生效」——
     *    集浮层那四条程序填入路径已是这个口径，本批把游戏/音乐/书籍三条一并对齐）。
     */
    async function pasteGameUrl(): Promise<void> {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        gameUrlVal = v;
        autoSaveGame('url', true);
    }
    // 🔴 #563：「游戏浮层清除」那枚按钮已随底部三枚按钮一并退场（用户：「移除底部的保存、清除、取消三个按钮」）
    //    ⇒ 那条只剩「一键清空」用途的路径**整体删除**（死码不留）。要清关联就把两个输入框清空、失焦即自动保存。
    /** 音乐「▶ 播放」左键：有关联 → 播放音频；无 → 提示右键编辑 */
    function playMusicFromForm() {
        if (audioPath.trim()) {
            onPlayMusic();
        } else if (audioUrl.trim()) {
            // 🔴 #601：没有本地音频但填了「网络地址」⇒ 浏览器打开（与宿主 `playAudioEntry` 同口径）
            window.open(audioUrl.trim(), '_blank');
        } else {
            new Notice('未关联本地音频 — 右键「播放」选择音频文件', 5000);
        }
    }
    /** 音乐「▶ 播放」右键：弹编辑浮层（浏览/手动输入路径） */
    /**
     * ⑤-c 下载完成回调：把库内相对路径写进「本地音频」。
     * ⚠️ **只改表单状态** —— 落库仍由「保存」统一提交（⛔ 别在这里顺手写 catalog，
     *    否则用户点了「取消」也会留下一条自己没确认过的关联）。
     */
    function applyDownloaded(relPath: string): void {
        audioPath = relPath;
        audioPathVal = relPath;
        /**
         * 🔴 #402「下载后的音频需能自动关联到对应的音乐类型条目」：
         * 编辑态（条目已存在）由宿主**直接写回**，不必再点一次「更新笔记」；
         * 新增态还没有条目可写 ⇒ 只落在表单里等保存（这条分流在宿主，组件不碰 catalog）。
         */
        void onApplyAudio(relPath);
    }

    /**
     * 打开「下载歌曲」弹窗（⑤-c；仅音乐类型，且「启用内置音乐播放器」开启时按钮才可见）。
     * 下载完由 `applyDownloaded` 把库内相对路径写进「本地音频」= 自动关联。
     */
    function openDownloader(): void {
        onOpenDownloader(title.trim(), author.trim(), applyDownloaded);
    }

    function openAudioEditor() {
        audioPathVal = audioPath;
        audioUrlVal = audioUrl; // 🔴 #601：网络地址与文件路径同一浮层（两条各自缓冲，失焦各存各的）
        syncAudioName();
        audioEditOpen = true;
    }
    /**
     * #497：「文件名」框跟随「文件路径」框 —— 换文件（浏览 / 库内检索 / 手输）后必须重算。
     * 🔴 **刻意写成显式调用，而不是 `$: if (audioPathVal !== src) {...}` 反应式块**：
     *    那样「读又写同一个变量」，Svelte 会判成循环依赖；而且用户在文件名框里打字时
     *    也可能被路径侧的重算冲掉。⛔ 别改成反应式。
     */
    function syncAudioName(): void {
        audioNameVal = audioStemOf(audioPathVal);
        audioRenameHint = '';
    }
    /**
     * #497 执行改名。🔴 **立即动磁盘**（不是表单缓冲）—— 所以成功后必须**同时**把新路径写进
     * `audioPathVal`（路径框）与 `audioPath`（表单字段）：
     * 漏了后者的话，用户接着点条目「保存」会把**旧路径**重新写回 catalog，等于这次改名白做
     * （文件改了名、条目还指旧路径；而界面此刻显示的是新名 —— 最难查的一种）。
     * ⚠️ 提示分工：**失败**贴在输入框下面（`audioRenameHint`，原因文案长、贴着字段才看得懂）；
     *    **成功**走 `Notice`（与同浮层的「保存 / 清除」同款，⛔ 别在这里另立一套反馈）。
     */
    async function renameAudioNow(): Promise<void> {
        if (audioRenaming) return;
        audioRenaming = true;
        audioRenameHint = '';
        try {
            const r = await onRenameAudio(audioPathVal.trim(), audioNameVal);
            if (!r.ok) {
                audioRenameHint = r.message;
                return;
            }
            const to = r.path ?? audioPathVal;
            audioPathVal = to;
            audioPath = to;
            audioNameVal = audioStemOf(to);
            new Notice(r.message, 5000);
        } finally {
            audioRenaming = false;
        }
    }
    /**
     * #404：在**库内音乐目录**里找回同名音频（用户：「优先检索库内音乐目录下同名音频文件进行关联」）。
     * 🔴 只把路径**填进框里**（与「浏览」同款），仍要点「保存」才生效 —— 检索结果不该直接落库。
     * 🔴 匹配逻辑在纯模块 `pure/libraryAudio`（与下载排序共用同一把相似度尺），组件只负责取数与提示。
     * 🔴 #523：入口从音频浮层标题旁搬到**表单「路径」标签旁** ⇒ 反馈改走 `Notice`，且必须**同时**写
     *    `audioPath`（表单值）与 `audioPathVal`（浮层缓冲）—— 只写后者时，用户在浮层关闭状态下点它
     *    会「看着填了、保存却没带上」。
     */
    function findLibraryAudio(): void {
        const t = title.trim();
        if (!t) {
            new Notice('标题为空，先填标题再检索');
            return;
        }
        const files = onListLibraryAudio();
        const { best, ranked } = pickLibraryAudio(files, t, author.trim());
        if (!best) {
            new Notice(
                files.length === 0
                    ? '音频文件目录里还没有音频文件'
                    : `音频文件目录里没找到与「${t}」同名的音频`,
                5000,
            );
            return;
        }
        audioPath = best.path;
        audioPathVal = best.path;
        syncAudioName();
        new Notice(`${ranked.length > 1 ? `命中 ${ranked.length} 个，已` : '已'}填入「${best.name}」，点「保存」生效`);
    }
    /** 🔴 #563 音频浮层自动保存（缓冲 `audioPathVal` → 表单 `audioPath`） */
    function commitAudioEditor(): void {
        audioPath = audioPathVal.trim();
        audioUrl = audioUrlVal.trim(); // 🔴 #601：网络地址与文件路径同属「关联」，一起写回（⛔ 别只写一条）
    }
    /** 音乐浮层两个字段 → 就地提示键（🔴 #601 起是两条） */
    const AUDIO_SAVE_KEYS: Record<'path' | 'url', AutoSaveKey> = {
        path: AUTOSAVE_KEYS.audioPath,
        url: AUTOSAVE_KEYS.audioUrl,
    };
    /** 🔴 #583 音乐浮层自动保存（与集浮层**同一判据 + 同一出口**）；
     *  `committed` = 表单态里那一项（浮层期间不会被改 ⇒ 直接比对，无需快照）。 */
    function autoSaveAudio(force = false): void {
        autoSaveField(AUDIO_SAVE_KEYS.path, audioPathVal, audioPath, commitAudioEditor, force);
    }
    /** 🔴 #601：音乐浮层「网络地址」的失焦自动保存（与 `autoSaveAudio` 同一出口，只是换了键与缓冲） */
    function autoSaveAudioUrl(force = false): void {
        autoSaveField(AUDIO_SAVE_KEYS.url, audioUrlVal, audioUrl, commitAudioEditor, force);
    }
    /** 🔴 #601 音乐浮层「网络地址」旁的**粘贴**：读剪贴板 → 清洗 → 填进缓冲 → **立即保存**
     *  （与 `pasteGameUrl` 同款：粘贴属于「程序填入」⇒ 带 `force` 当场落库）。 */
    async function pasteAudioUrl(): Promise<void> {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        audioUrlVal = v;
        autoSaveAudioUrl(true);
    }
    /** 音频浮层关闭（点遮罩）—— 同集浮层：**先无条件提交缓冲再关**（⛔ 不跑判据，见 `closeGameEditor`） */
    function closeAudioEditor(): void {
        commitAudioEditor();
        audioEditOpen = false;
    }

    /**
     * #462：「播放」按钮悬停提示里的「时长 · 体积」（用户：「给音乐类型关联到的音频文件鼠标hover提示
     * 音频文件时长：如04:25,和体积大小3MB」）。
     * 🔴 探测是**异步**的（时长要 Chromium 解码）⇒ 先渲染提示、探到了再补那一行；**拿不到就整行不加**
     *   （⛔ 不写「未知」）。⚠️ 换文件期间回来的结果一律丢弃（比对当前 `audioPath`）。
     * ⚠️ 依赖写在**反应式声明本体**里（`audioMetaSrc`），⛔ 别把读取藏进函数体 —— Svelte 4 不穿透。
     */
    let audioMetaLine = '';
    $: audioMetaSrc = audioPath.trim();
    $: if (audioMetaSrc) void loadAudioMeta(audioMetaSrc);
    else audioMetaLine = '';
    async function loadAudioMeta(p: string): Promise<void> {
        const info = await onProbeAudioInfo(p);
        if (audioPath.trim() !== p) return; // 期间换过文件 ⇒ 丢弃这次结果
        audioMetaLine = mediaInfoLine(info.size, info.duration);
    }
    /** Svelte 4 模板不支持 as 断言：统一取值 helper */
    function inputVal(ev: Event): string {
        return (ev.target as HTMLInputElement).value;
    }

    /** 拖入本地图片 → 上传为封面并更新预览 */
    async function onDropPoster(ev: DragEvent) {
        ev.preventDefault();
        const file = ev.dataTransfer?.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            new Notice('仅支持图片文件');
            return;
        }
        try {
            const p = await onUploadPoster(file);
            if (p) {
                poster = p;
                posterUrlInput = '';
            }
        } catch (e) {
            new Notice('封面上传失败：' + (e instanceof Error ? e.message : String(e)));
        }
    }

    /** 网络图片 URL 应用到封面（校验 http/https） */
    function applyPosterUrl() {
        const u = posterUrlInput.trim();
        if (!u) return;
        if (!/^https?:\/\//.test(u)) {
            new Notice('仅支持 http/https 图片链接');
            return;
        }
        poster = u;
        posterUrlInput = '';
    }

    /** 移除封面（手动清空自动回填的封面） */
    function removePoster() {
        poster = '';
        posterUrlInput = '';
    }

    /**
     * #498 从网络搜索封面：菜单项 → 交给宿主开候选弹窗。
     * 🔴 搜索词初值 = `buildPosterQuery`（**标题 + 类型词**，用户裁定）；标题为空 ⇒ 空串，
     *    弹窗里会提示「先填搜索词」，⛔ 这里别自己编一个（比如拿类型词单独搜）。
     * 🔴 选中后落的是**库内相对路径**（弹窗侧已下载并本地化）⇒ 与「更换本地图片」同一个字段、同一条口径；
     *    ⛔ 不直接把远程 URL 塞进 poster（那张图随时会挂，用户会以为封面丢了）。
     */
    function openPosterSearch() {
        closeCtx();
        onOpenPosterSearch(
            buildPosterQuery(title, type, bookKind),
            title,
            (relPath) => {
                poster = relPath;
                syncPosterUrlInput();
                new Notice('封面已更新，点「保存」生效');
            },
            // 🔴 #509：平台那四条用「标题 + 作者」（音乐平台的搜索框不认「专辑封面」那种词）
            buildPlatformCoverQuery(title, author),
            posterSourcesFor(type),
        );
    }

    /** 把豆瓣详情字段对象应用到表单变量（幂等：已有值不覆盖） */
    function applyDoubanDetail(d: Record<string, unknown>) {
        if (d.director && !director) director = String(d.director);
        if (Array.isArray(d.screenwriter) && d.screenwriter.length && !screenwriter) screenwriter = d.screenwriter.join(' / ');
        if (Array.isArray(d.cast) && d.cast.length && !cast) cast = d.cast.join(' / ');
        if (Array.isArray(d.genres) && d.genres.length && !genres) genres = d.genres.join(' / ');
        if (d.country && !country) country = String(d.country);
        if (d.language && !language) language = String(d.language);
        if (d.durationMin && !durationMin) durationMin = String(d.durationMin);
        if (type !== 'game' && Array.isArray(d.aliases) && d.aliases.length && !aliases) aliases = d.aliases.join(' / ');
        if (d.episodeCount && (type === 'tv' || type === 'anime') && !totalEpisodes) totalEpisodes = String(d.episodeCount);
        if (d.author && !author) author = String(d.author);
        if (d.album && !album) album = String(d.album);
        if (d.platform && !platform) platform = String(d.platform);
        if (d.developer && !developer) developer = String(d.developer);
        // 译者：书籍条目已删除译者框（用户指示），不再回填；字段按 schema 红线保留
        if (type !== 'book' && d.translator && !translator) translator = String(d.translator);
        if (type !== 'game' && d.publisher && !publisher) publisher = String(d.publisher);
        if (d.producer && !producer) producer = String(d.producer);
        if (d.binding && !binding) binding = String(d.binding);
        if (d.price && !price) price = String(d.price);
        if (d.series && !series) series = String(d.series);
        if (d.year && !year) year = String(d.year);
        if (d.summary && !summary) summary = String(d.summary);
        if (d.ratingCount && !ratingCount) ratingCount = String(d.ratingCount);
        if (d.toc && !toc) toc = String(d.toc);
        if (d.cover && !poster) poster = String(d.cover);
        // 🔴 #444g 漫画：详情补全也**不补** ISBN / 作者简介（表单里没有这两个框 ——
        //    补了就是「看不见却落库」的幽灵字段；与上面搜索回填处同一条口径）。
        //    ⚠️ `pageCount` 不在这条排除里 —— #445 漫画有了「总话数」框，详情里的话数就该补进去。
        if (bookKind !== 'comic') {
            if (d.isbn && !isbn) isbn = String(d.isbn);
            if (d.authorIntro && !authorIntro) authorIntro = String(d.authorIntro);
        }
        if (d.pageCount && !pageCountVal) pageCountVal = String(d.pageCount);
    }

    /**
     * 🔴 #609 把「微信读书详情」应用到表单 —— 口径**镜像**「从微信读书同步书架」的映射
     * （`pure/wereadShelf.shelfBookEntryFields`），⛔ 别在两边各写一份字段对照。
     *
     * 为什么必须有这一步：搜索接口（`/web/search/global`）**没有 `publishTime`**（2026-10-11 实测，
     * `囚徒健身` 那条 bookInfo 的字段表里根本没有「出版年」）⇒ 光靠搜索结果，「出版年」永远填不上；
     * 简介也只有在详情接口里才是**全文**。于是「用微信读书源搜索添加」比「书架同步导入」缺斤少两 —— 用户报障的原样。
     * ⚠️ 幂等：已有值不覆盖（与 `applyDoubanDetail` 同一口径）；封面按 `shouldAdoptCover` 走（详情封面优先，本地封面保留）。
     */
    function applyWereadDetail(d: WereadBookInfo) {
        if (d.rating != null && !communityScore) communityScore = String(d.rating);
        if (d.ratingCount != null && !ratingCount) ratingCount = String(d.ratingCount);
        if (d.intro && !summary) summary = d.intro;
        if (d.publisher && !publisher) publisher = d.publisher;
        if (d.year !== undefined && !year) year = String(d.year);
        if (d.category && !genres) genres = d.category;
        // 🔴 #444g：漫画**不补** ISBN（表单里没这个框 ⇒ 补了就是「看不见却落库」的幽灵字段）
        if (bookKind !== 'comic' && d.isbn && !isbn) isbn = d.isbn;
        if (d.coverUrl && shouldAdoptCover(poster, d.coverUrl)) poster = d.coverUrl;
    }

    /** 题材：普通 input（/ 分隔文本，非标签）——提交时拆分存 genres 数组 */

    /** 主演/声优：普通 input（/ 分隔文本，非标签）——提交时拆分存 cast 数组 */

    /**
     * 🔴🔴 **提交必须经过这一层**（`on:click` ⛔ 别直接指到 `submit`）。
     *
     * 起因（#436 实测，用户报「怎么点都没反应，也没提示」）：`submit()` 里任何**同步抛错**
     * （最典型的就是把 number 绑定值当字符串用 ⇒ `TypeError: x.trim is not a function`）
     * 都会让 `on:click` 的 promise 直接 reject —— **按钮既不提示也不关窗，只有控制台里有错**，
     * 用户看到的就是「点了没反应」。`EntryModal.onSubmit` 自带 try/catch，但**表单侧的解析/校验没有**。
     * ⇒ 这里兜底成一句看得见的 Notice：⛔ 别把 try/catch 删了，也⛔ 别把按钮指回 `submit`。
     */
    async function submitSafe(): Promise<void> {
        try {
            await submit();
        } catch (e) {
            new Notice('保存失败：' + (e instanceof Error ? e.message : String(e)));
        }
    }

    async function submit() {
        if (!title.trim()) return;
        // 导演/编剧合并框 → 拆分：第一个 / 前为导演，其余为编剧
        const writers = directorWriters.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean);
        const input: Record<string, unknown> = {
            type,
            title: title.trim(),
            originalTitle: originalTitle.trim() || undefined,
            status,
            rating,
            year: year ? Number(year) || undefined : undefined,
            director: writers[0] ?? undefined,
            screenwriter: writers.slice(1),
            cast: cast.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            genres: genres.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            country: country.trim() || undefined,
            language: language.trim() || undefined,
            durationMin: durationMin ? Number(durationMin) || undefined : undefined,
            aliases: type === 'game' ? undefined : aliases.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            notes: notes.trim(),
        };
        // 影视类型（电影/剧集/动画）：观看链接双路径——旧「资源链接」(links) 已迁移到 episodeUrls，此处清空（url 不丢）
        if (type === 'movie' || type === 'tv' || type === 'anime') {
            input.links = [];
            // 按当前总集数截取写入（resize 只扩不缩，超出部分不入库）
            // 🔴 #446：规整走 `storeEpisodeList`（**保位**：index i 恒 = 第 i+1 集）——
            //    以前这里是 `.filter(...)` 压缩空位，与选集弹窗 / 集按钮的按下标读法矛盾，
            //    用户看到的就是「第 2 集填的标题跑到第 1 集」（保存不生效）。
            const n = totalEpisodes ? Number(totalEpisodes) : 0;
            input.episodeFiles = storeEpisodeList(episodeFiles, n);
            input.episodeUrls = storeEpisodeList(episodeUrls, n);
            input.episodeTitles = storeEpisodeList(episodeTitles, n);
        } else {
            input.links = entry?.links ?? [];
        }
        if (type === 'book') {
            input.bookKind = bookKind; // 恒写（normalize 后必有值；'book' 显式落盘语义等价缺省）
            input.author = author.trim() || undefined;
            if (bookKind === 'novel') {
                // 网文：**出版侧**字段对网文不适用（出版社 / ISBN）—— 显式写 undefined 即清空存量
                // （update 走 normalizeEntry({...prev, ...patch})，显式 undefined 会覆盖旧值并在归一后被丢弃）
                // 🔴 #431 **翻面**：「目录」从这一支里**移出去**了 —— 用户 2026-09-29「文学类和网文的 toc
                //    目录回填只显示前 10 章加个 `....`」⇒ 网文也带目录（裁到 10 章之后它就不再是一份
                //    「出版目录」了，正是当年那条裁定要防的东西）。⚠️ **只放开 `toc` 这一项**，
                //    出版社 / ISBN 仍按 2026-09-13 裁定对网文清空。
                input.publisher = undefined;
                input.isbn = undefined;
            } else if (bookKind === 'comic') {
                // 🔴 #444g 漫画：出版侧**只留出版社**。ISBN 显式清空（表单已不渲染该框）；
                //    ⚠️ `pageCount` 在下方「阅读进度」块里按 bookKind 排掉、`authorIntro` 在下面统一排掉
                //    —— ⛔ 别再在两处各判一次（同一件事两份判断必然漂移）。
                input.publisher = publisher.trim() || undefined;
                input.isbn = undefined;
            } else {
                input.publisher = publisher.trim() || undefined;
                input.isbn = isbn.trim() || undefined;
            }
            // 🔴 #431 目录：文学与网文**都**落库（以前只写在 else 那一支里）
            input.toc = toc.trim() || undefined;
            input.producer = producer.trim() || undefined;
            input.binding = binding.trim() || undefined;
            input.price = price.trim() || undefined;
            // 🔴 #444g：漫画不落作者简介（表单已不渲染该框；显式不写 ⇒ 存量值被 normalize 丢弃）
            if (bookKind !== 'comic') input.authorIntro = authorIntro.trim() || undefined;
            // 🔴 #444g 画师：**只有漫画**落库；其余 bookKind 显式写 undefined —— 防止「先建了漫画、又改成文学」
            //    时把上一条的画师留在库里（与网文清出版社/ISBN 同一条「换分类即清不对口字段」的口径）。
            input.artist = bookKind === 'comic' ? (artist.trim() || undefined) : undefined;
            input.bookFile = bookFileVal.trim() || undefined;
            // #529 书籍在线阅读链接：恒写（清空则落 undefined ⇒ 真正清掉旧值）
            input.readUrl = readUrl.trim() || undefined;
        }
        if (type === 'game') {
            input.platform = platform.trim() || undefined;
            input.developer = developer.trim() || undefined;
            // 发行商/别名：对游戏条目废弃（豆瓣游戏页无此数据），不再读写
            input.gameLaunchPath = gameLaunchPath.trim() || undefined; // 启动快捷方式（.lnk）
            input.gameUrl = gameUrl.trim() || undefined; // #534 网络路径（浮层手填/粘贴；append-only 字段）
        }
        if (type === 'music') {
            input.musicKind = musicKind; // 恒写（normalize 后恒为 'music'；1.0.3.1 起无子分类，写入即把存量 other 归一）
            input.author = author.trim() || undefined;
            input.album = album.trim() || undefined;
            input.audioPath = audioPath.trim() || undefined;
            // 🔴 #601：音乐网络地址（append-only 新字段）—— 恒写（清空则落 undefined ⇒ 真正清掉旧值）
            input.audioUrl = audioUrl.trim() || undefined;
            // 🔴 LRC 歌词**不是 catalog 字段**：它住在笔记的 ` ```lrc ` 块里，由弹窗侧
            //    （`EntryModal.onSubmit`）取出后经 `service.setNoteLrc` 写回笔记，⛔ 不要落库。
            input.lrc = lrc;
        }
        if (poster) input.poster = poster;
        // 系列 / 系列序号（#434）：**全类型**写（原来这一行只在 book 分支里，其余类型填了也没处存）。
        // 🔴 海报墙的「系列折叠卡」就靠这两项成组 ⇒ 漏写 = 用户填了但墙上不折（本仓「字段没进白名单/没进提交对象」栽过多次）。
        // ⚠️ 序号：空串 ⇒ 显式 `undefined`（**清得掉**旧值）；非有限数（用户敲了 `2.5.5` 之类）⇒ 也落 `undefined`，
        //    ⛔ 不拦保存（那会把「改个标题」变成一场必填校验），但也⛔ 绝不把 `NaN` 写进 catalog。
        input.series = series.trim() || undefined;
        // 🔴 序号一律走纯函数收口（那个框的运行时类型是 number|null|string 三态，见变量声明处的说明）——
        //    ⛔ 别在这里裸写 `.trim()`：那正是 #434 的静默死按钮
        input.seriesIndex = parseSeriesIndexInput(seriesIndexVal);
        input.source = sourceFrom.trim() || undefined;
        // ② 来源 / 大众评分 / 评价人数 / 平台链接：**这一行真的被用户改过**才走「校验 + 归一」，否则原样落盘。
        // 🔴 #499E 改判据（用户：「改成可再次手动编辑」）：原来是 `!entry`（编辑态根本没有框），
        //    现在是 **`!entry || metaTouched`** —— 编辑态右键解锁后**真改了**（`on:input` 置位）才归一。
        //    ⚠️ 为什么不按 `metaEditable`（解锁了就算）？那会把「右键看一眼又直接保存」也拖进归一 ——
        //    回填来的 `8.45` 会被悄悄写成 `8.5`（= 改用户的库数据，正是 v109 那条注释防的事）。
        //    只有「亲手改过」才有理由按我们的口径重新解释这串输入。
        // 🔴 #431：`7 | 500` 这种**一气呵成的写法**在**提交这一刻**拆开（⛔ 不在 `on:input` 里拆 ——
        //    那样用户刚敲下 `7|` 就会被吃掉、后续按键落错框）。切分真源 = `pure/sourceMeta.splitScoreCount`。
        const split = splitScoreCount(communityScore);
        const csRaw = split ? split.score : communityScore;
        const rcRaw = split ? split.count : ratingCount;
        const viaInputs = !entry || metaTouched;
        if (viaInputs) {
            const csIssue = communityScoreIssue(csRaw);
            if (csIssue) {
                new Notice(csIssue);
                return;
            }
            // #431 评价人数：与另几个手填框同一条纪律 —— ⛔ 非法直接拦保存
            const rcIssue = ratingCountIssue(rcRaw);
            if (rcIssue) {
                new Notice(rcIssue);
                return;
            }
            const suIssue = sourceUrlIssue(sourceUrl);
            if (suIssue) {
                new Notice(suIssue);
                return;
            }
            // #430 来源名：与另两个手填框同一条纪律 —— ⛔ 非法直接拦保存，别静默存一个半截值
            const snIssue = sourceNameIssue(sourceName);
            if (snIssue) {
                new Notice(snIssue);
                return;
            }
            // #385：手填平台链接 → 认出数据源就落 `source`，让海报墙封面角标对手填条目也显示平台名
            //   （用户 2026-09-27 裁定：认出来就落库）。⛔ 只在原本没有来源时补 —— 别覆盖搜索回填值；
            //   认不出则保持 undefined（角标自然退化为纯数值★，⛔ 不写一个猜的 id）。
            if (!input.source) {
                const pid = providerFromUrl(sourceUrl);
                if (pid) input.source = pid;
            }
        }
        input.sourceUrl = sourceUrl.trim() || undefined;
        // #430 手填来源名。⚠️ 「没改过」那一支**原样落盘**（写回的就是原值）——
        //    与下面两个数值同一条「不亲手改就不二次归一」的纪律（#499E 起判据 = `viaInputs`）。
        input.sourceName = viaInputs ? parseSourceName(sourceName) : sourceName.trim() || undefined;
        input.communityScore = viaInputs
            ? parseCommunityScore(csRaw)
            : communityScore
              ? Number(communityScore) || undefined
              : undefined;
        // #431 评价人数：改过才走纯函数（容千分位逗号）；没改过**原样落盘**
        input.ratingCount = viaInputs
            ? parseRatingCount(rcRaw)
            : ratingCount
              ? Number(ratingCount.replace(/,/g, '')) || undefined
              : undefined;
        input.summary = summary.trim() || undefined;
        // AI 摘要（单框拆回两字段）：空值 → undefined（清空即移除对应章节）
        const ai = textToAiFields(aiText);
        input.aiSummary = ai.aiSummary;
        input.aiHighlights = ai.aiHighlights;
        // 计划观看日期：仅想看状态携带；其他状态显式清空，避免旧排期残留
        // 过去日期校验：计划观看应面向未来，弹提示并阻止保存
        if (status === 'want' && plannedDate) {
            const t = new Date();
            const tStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            if (plannedDate < tStr) {
                new Notice('计划观看日期不能是过去的日期 — 请选择今天或之后的日期');
                return;
            }
            input.plannedDate = plannedDate;
        } else {
            input.plannedDate = undefined;
        }
        // 最近观看日期：在看状态携带（所有类型写入 progress.lastWatchedDate，供追更表活跃度计算）；
        // 非在看的剧集/动画显式清空，避免旧日期残留
        if (status === 'watching') {
            input.progress = {
                season: type === 'tv' || type === 'anime' ? season : (entry?.progress?.season ?? 1),
                episode: type === 'tv' || type === 'anime' ? episode : (entry?.progress?.episode ?? 0),
                totalEpisodes: type === 'movie' || type === 'tv' || type === 'anime'
                    ? (totalEpisodes ? Number(totalEpisodes) || undefined : undefined)
                    : entry?.progress?.totalEpisodes,
                lastWatchedDate: lastWatchedDate || undefined,
                history: entry?.progress?.history ?? [],
            };
        } else if (type === 'movie' || type === 'tv' || type === 'anime') {
            // 编辑时保留既有追更历史，但非在看状态清空最近观看日期；电影无季/集进度，保留原值仅写总集数
            input.progress = {
                season: type === 'movie' ? (entry?.progress?.season ?? 1) : season,
                episode: type === 'movie' ? (entry?.progress?.episode ?? 0) : episode,
                totalEpisodes: totalEpisodes ? Number(totalEpisodes) || undefined : undefined,
                lastWatchedDate: undefined,
                history: entry?.progress?.history ?? [],
            };
        }
        // 观看日期：已看状态携带（所有类型；含剧集/动画）
        if (status === 'watched' && watchedDate) input.watchedDate = watchedDate;
        // 书籍阅读进度 / 游戏游玩时长（有值才携带）
        if (type === 'book') {
            const page = readingPage ? Number(readingPage) || undefined : undefined;
            const totalPage = readingTotalPage ? Number(readingTotalPage) || undefined : undefined;
            // percent 唯一真源：表单无 percent 输入项，保存保留既有值（阅读器自动落库进度不被覆盖；无则缺省）
            // 🔴 #426 例外：用户点过「重新解析」把进度**清空归零**、且两个框仍空 ⇒ 本次**不带 percent**，
            //    于是下面 `rp` 三项全空 ⇒ `readingProgress` 落成 undefined（`update` 浅合并覆盖 + `normalizeEntry` 丢弃）
            //    ⇒ 字段真正消失，⛔ 不是留个 `page:0` 那种半吊子。
            const percent = progressReset && !page && !totalPage ? undefined : entry?.readingProgress?.percent;
            const rp: { page?: number; totalPage?: number; percent?: number } = { page, totalPage };
            if (percent !== undefined) rp.percent = percent;
            input.readingProgress = rp.page || rp.totalPage || rp.percent !== undefined ? rp : undefined;
            // 元数据页数 / 章数 / 话数：**同一个字段**（`pageCount`）按书籍子分类换名 ——
            //   文学 = 页数（豆瓣实体书，与进度基准分离，仅展示/统计）
            //   网文 = 章数（1.0.3 起的约定，键名不变）
            //   漫画 = 话数（🔴 #445 用户加回来的「总话数」框）
            // ⛔ 本行是 pageCount 落库的**唯一判据点**；🔴 #444g 那条「漫画不落」已随 #445 翻面
            //    （当时排除是因为漫画没有这个框；现在有了 ⇒ 必须落，否则填了不存）。
            input.pageCount = pageCountVal ? Number(pageCountVal) || undefined : undefined;
            // 🔴 #537 阅读时长（小时录入 → 落库分钟）：表单手填 = **覆盖**总数。
            //    自动累计只在「内置阅读器关闭」那一刻由宿主叠加（main.withReadTime），两者不会同时写同一笔。
            input.readMinutes = readHours ? Math.round(Number(readHours) * 60) || undefined : undefined;
        }
        if (type === 'game') {
            // 游玩时长：小时录入 → 落库分钟（游玩记录明细由弹窗即时落盘，submit 不再重复提交）
            input.playtimeMinutes = playtimeHours ? Math.round(Number(playtimeHours) * 60) || undefined : undefined;
        }
        // 🔴 #668 关联功能已下线归档：**刻意不带** `input.related`。
        //    `EntryService.update` 是浅合并 ⇒ 不带这个键 = 保留 catalog 里原有的关联数据，
        //    ⛔ 别为了「顺手清空」在这里写 `related: undefined`（那会把用户已有的关联静默删光）。
        await onSubmit(input);
    }

    /**
     * 星点击（#619 半星）：`n` = 第几颗星（1~5），`half` = 是否落在**左半边**。
     * · 左半边 ⇒ `n - 0.5`（半星）；右半边 ⇒ `n`（整星）
     * · 点**同一个当前值** ⇒ 清回 0（保留原先「再点一下取消」的手感）
     */
    function setStar(n: number, half: boolean) {
        const next = half ? n - 0.5 : n;
        rating = rating === next ? 0 : next;
    }

    /** 由点击位置的**水平比例**判定半星 / 整星（判定本身在 `pure/rating.isHalfStarClick`，可单测） */
    function onStarClick(ev: MouseEvent, n: number): void {
        const el = ev.currentTarget as HTMLElement;
        setStar(n, isHalfStarClick(ev.offsetX, el.offsetWidth));
    }

    /**
     * 星控件上的滚轮增减。
     * 🔴 必须 `preventDefault` —— 否则页面跟着滚（用户口径「阻止页面滚动」）；
     *    与 `pure/numberWheel` 是同一条纪律，只是这里的值在 Svelte 状态里、不在 `input.value` 上
     *    （所以不复用那套「读 `el.value` 写回再派发事件」的机制，档位直接走 `RATING_STEPS`）。
     */
    function onStarWheel(ev: WheelEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        rating = stepRating(rating, ev.deltaY < 0 ? 1 : -1);
    }

    /** 点数值 ⇒ 换成 10 分制输入框（`9/10` ⟷ `4.5` 星） */
    function startRatingEdit(): void {
        ratingEditing = true;
        void tick().then(() => {
            if (ratingInputEl) {
                ratingInputEl.focus();
                ratingInputEl.select();
            }
        });
    }

    /** 输入框落回存储（**÷2**：10 分制 → 半星）；清空 ⇒ 归 0 */
    function commitRatingEdit(v: string): void {
        ratingEditing = false;
        rating = v.trim() === '' ? 0 : tenthsToRating(Number(v));
    }

    /** 来源徽标直达：模板属性按 JS 解析不能用 TS `!`，故在 script 端守卫 undefined */
    function openSource(url: string | undefined): void {
        if (url) onOpenSource(url);
    }
    function openSourceOnEnter(ev: KeyboardEvent, url: string | undefined): void {
        if (ev.key === 'Enter' && url) onOpenSource(url);
    }

    /**
     * 🔴 #499E 起标题旁那颗「来源名 ↗」按钮**已撤除**（连同「★ 8.4 · 500人评价」只读徽标一起）——
     * 用户裁定：这四个值一律归「来源 / 大众评分 / 评价人数 / 平台链接」那一行（新增态输入框、编辑态只读概要行）。
     * ⚠️ 但 #449 立的**真源收敛继续有效**：概要行里的来源名仍走 `pure/sourceMeta.entrySourceLabel`
     *    （手填名优先 → 数据源注册表名）。⛔ 别在这里手抄映射表（老键 `google`/`openlibrary`、`omdb` 标签写错、
     *    且漏了 `mangadex` —— 那几类会原样吐出小写键）。
     */
</script>

<div
    class="rl-form"
    on:keydown={(ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            submit();
        }
    }}
>
    <div class="rl-fhd">
        {entry ? `编辑属性：${entry.title}` : pickedTitle ? `添加条目：${pickedTitle}` : '添加条目'}
        <span class="rl-fsrc">类型：{type === 'book' ? BOOK_KIND_LABELS[bookKind] : ENTRY_TYPE_LABELS[type]} · {sourceListText}</span>
    </div>

    {#if !entry || refetchOpen}
        <div class="rl-frow">
            <div class="rl-searchbox">
                <select class="rl-search-type" value={typeSel} on:change={onTypeSelEl} aria-label="条目类型">
                    {#each TYPE_OPTIONS as o}
                        <option value={o.value}>{o.label}</option>
                    {/each}
                </select>
                <input class="rl-search-input" placeholder="输入标题…" bind:value={query} bind:this={queryInput}
                    on:keydown={(ev) => { if (ev.key === 'Enter') doSearch(); else if (ev.key === 'Escape') query = ''; }} />
            </div>
            <button class="rl-btn rl-btn-primary" disabled={searching} on:click={doSearch}>
                {searching ? '搜索中…' : '搜索'}
            </button>
            <!-- 手动填写：跳过搜索直接进入字段区手填；编辑模式「重新拉取」时点此收起搜索区保留现状 -->
            <button class="rl-btn" on:click={() => { results = []; searchError = ''; picked = true; refetchOpen = false; manualFill = true; }}>手动填写</button>
        </div>
    {/if}

    {#if searching || progVisible}
        <!-- 逐源真实进度：每个参与源一行实时状态（先返回先亮「已返回 N 条」，未完成「搜索中…」，超时/失败给文案） -->
        <div class="rl-prog-srcs" aria-hidden="true">
            {#each sourcePlan as sid}
                {@const sl = srcLive[sid]}
                <span
                    class="rl-prog-src"
                    class:rl-prog-src-ok={sl?.state === 'ok' || sl?.state === 'empty'}
                    class:rl-prog-src-bad={sl?.state === 'failed' || sl?.state === 'timeout' || sl?.state === 'blocked'}>
                    {srcStateText(sl, sourceEnLabel(sid))}
                </span>
            {/each}
        </div>
        <!-- 🔴 #559（用户 2026-10-08）「模拟进度条」时间线：
             · **200ms 之前整块不上屏**（`progVisible`）—— 这 200ms 内不显示任何加载动画（防闪烁），
               API 若在 200ms 内返回就**全程没有进度条**、直接出结果；
             · 5s 起把「正在搜索 N 个数据源」换成「网络较慢，正在尽力加载…」（`simSlowText`）；
             · 8s 起追加「中止重试」（`simRetry`）；
             · 完成那一刻 `.is-done` 负责「拉满 + 淡出」（160ms 后整块卸载）。 -->
        {#if progVisible}
            <div class="rl-progress" class:is-done={progFade} aria-hidden="true">
                <div class="rl-progress-fill" style={`width:${progPct}%`}></div>
            </div>
            <div class="rl-progress-meta">
                <span class="rl-progress-label"><span class="rl-spinner"></span> {simSlowText ?? (sourcePlan.length > 0 ? `正在搜索 ${sourcePlan.length} 个数据源` : (progLabel || '正在搜索…'))}</span>
                <!-- 🔴 #571（用户 2026-10-08 截图：「中止重试按钮把百分比 90% **隔到中间**去了」）：
                     真因 = 这一行是 `justify-content: space-between` 且有**三个**孩子 ——
                     8s 后按钮一上屏，中间那个孩子（百分比）就被顶到**正中间**。
                     ⇒ 把「按钮 + 百分比」收进**同一个右端组**（`.rl-progress-tail`）：
                       本行只剩「左标签 / 右端组」两个孩子，**百分比恒贴右缘**（有没有按钮都一样），
                       按钮出现在它**左边**（不再抢走右端）。
                     下划线命名口径：百分比位置由「右端组」承担，⛔ 别再靠 DOM 顺序 + `space-between` 碰运气。 -->
                <span class="rl-progress-tail">
                    {#if simRetry}
                        <button class="rl-btn rl-prog-retry" on:click={retrySearch}>中止重试</button>
                    {/if}
                    <span class="rl-progress-eta">{Math.round(progPct)}%</span>
                </span>
            </div>
        {/if}
    {/if}

    {#if !sourceReady}
        <div class="rl-hint">{sourceHint}</div>
    {/if}
    {#if searchError}
        <div class="rl-err">{searchError}</div>
    {/if}

    {#if results.length > 0 && !picked}
        <div class="rl-res-head">
            <span class="rl-res-head-cnt">共 {results.length} 条结果</span>
            <span class="rl-res-head-hint">{repeatHint(entry === null)}</span>
        </div>
        <div class="rl-res" style={`--rl-cols:${Math.max(1, resultColumns.length)}`} on:click={onResClick}>
            {#each resultColumns as col}
                <div class="rl-res-col">
                    <div class="rl-res-col-head">
                        <span class="rl-res-col-name">{col.label}</span>
                        <span class="rl-res-col-cnt">{col.items.length}</span>
                    </div>
                    {#each col.items as r (resultKey(r))}
                        {@const d = describeSearchResult(r)}
                        {@const added = addedHits.has(resultKey(r))}
                        <button class="rl-res-item" class:is-added={added} on:click|stopPropagation={() => pick(r)} data-tip={added ? '已添加过 · 再点会再建一条' : '点击回填该条目'}>
                            {#if d.cover}
                                <img class="rl-res-cv" src={d.cover} alt="" loading="lazy" referrerpolicy={isDoubanImage(d.cover) ? 'unsafe-url' : undefined} />
                            {:else}
                                <span class="rl-res-cv rl-res-ph"><span class="rl-res-ico">{typeIcon(type)}</span></span>
                            {/if}
                            <span class="rl-res-inf">
                                <span class="rl-res-rows">
                                    <span class="rl-res-row1">
                                        <span class="rl-res-t">{d.title}</span>
                                    </span>
                                    <span class="rl-res-row2">
                                        {#if d.year}<span class="rl-res-yr">{d.year}</span>{/if}{#if d.year && d.rating != null}<span class="rl-res-dot">·</span>{/if}
                                        {#if d.rating != null}<span class="rl-res-score">★ {d.rating}</span>{/if}
                                        {#if d.sub}{#if d.year || d.rating != null}<span class="rl-res-dot">·</span>{/if}<span class="rl-res-o">{d.sub}</span>{/if}
                                    </span>
                                </span>
                                <!-- 🔴 #633：角标**不再挂在标题行里**（那样它跟着标题那一行走、落在条目上部），
                                     改成与 `.rl-res-source` **平级** —— 靠 `.rl-res-inf` 的 `align-items: center`
                                     垂直居中于整条，且水平位置固定成一列（用户：「已添加怎么不居中对齐条目的」）。 -->
                                {#if added}<span class="rl-res-added">已添加</span>{/if}
                                {#if d.sourceUrl}
                                    <span
                                        class="rl-res-source"
                                        role="link"
                                        tabindex="0"
                                        data-tip="打开 {d.source} 页面"
                                        on:click|stopPropagation={() => openSource(d.sourceUrl)}
                                        on:keydown={(ev) => openSourceOnEnter(ev, d.sourceUrl)}>
                                        {d.source} ↗
                                    </span>
                                {/if}
                            </span>
                        </button>
                    {/each}
                    {#if col.empty}
                        <div class="rl-res-col-empty" on:click|stopPropagation data-tip="本源无结果">
                            该源暂无匹配结果
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    {#if picked}
        <div class="rl-fields">
            <!-- 1. 作品基础信息（左封面边栏 + 右字段区，两列布局） -->
            <div class="rl-section">作品基础信息</div>
            <div class="rl-basic-grid">
                <!-- 左：封面边栏（右键弹菜单更换 / 拖入本地图片） -->
                <div class="rl-poster-col">
                    <div
                        class="rl-poster-zone"
                        class:on={!!previewUrl}
                        on:contextmenu|preventDefault={openPosterCtx}
                        on:dragover|preventDefault
                        on:drop={onDropPoster}
                        data-tip="右键换封面 / 拖图">
                        {#if previewUrl}
                            <img class="rl-poster-preview" src={previewUrl} alt="封面" referrerpolicy={isDoubanImage(previewUrl) ? 'unsafe-url' : undefined} />
                        {:else}
                            <div class="rl-poster-ph">拖入图片<br/>右键更换</div>
                        {/if}
                    </div>
                    <!-- 隐藏的文件选择器（右键菜单「更换本地图片」触发） -->
                    <input type="file" accept="image/*" class="rl-hidden" bind:this={fileInput} on:change={onFileSelected} />
                    <div class="rl-poster-hint">右键更换封面</div>
                    <!-- 右键菜单：本地 / 网络 / 移除 -->
                    {#if ctxOpen}
                        <div class="rl-ctx" bind:this={ctxMenuEl} style={`left:${ctxX}px;top:${ctxY}px${ctxMaxH !== undefined ? `;max-height:${ctxMaxH}px` : ''}${ctxMaxW !== undefined ? `;max-width:${ctxMaxW}px` : ''}`} role="menu" on:click|stopPropagation>
                            {#if ctxKind === 'meta'}
                                <!-- 🔴 #499E 来源 / 大众评分 / 评价人数 / 平台链接 的只读概要行右键 ——
                                     用户裁定「第一次打开只读展示，可右键再次手动编辑」。
                                     ⚠️ 只有这一项：右键是「解锁编辑」的动作，不是又一套功能菜单
                                     （只读行上的平台链接本身可点，无需在这里再放一条「打开链接」）。 -->
                                <button on:click={startMetaEdit} data-tip="把这四个值换成输入框，改完保存">手动编辑来源与评分…</button>
                            {:else if !ctxUrlMode}
                                <!-- #498：置顶（用户点名要的能力；「更换封面」菜单里最常要的就是「搜一张」） -->
                                <button on:click={openPosterSearch} data-tip="按条目标题去必应图片搜，选一张设为封面">从网络搜索封面…</button>
                                <button on:click={pickFile}>更换本地图片…</button>
                                <button on:click={() => { ctxUrlMode = true; void placePosterCtx(); }}>更换网络图片…</button>
                                {#if previewUrl}
                                    <button class="rl-ctx-danger" on:click={removePoster}>移除封面</button>
                                {/if}
                            {:else}
                                <div class="rl-ctx-url">
                                    <input class="rl-input" placeholder="https://…" bind:value={posterUrlInput}
                                        on:keydown={(ev) => { if (ev.key === 'Enter') applyPosterUrl(); else if (ev.key === 'Escape') closeCtx(); }} />
                                    <button class="rl-btn rl-btn-primary" on:click={applyPosterUrl}>使用</button>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
                <!-- 右：字段区 -->
                <div class="rl-fields-col">
                    {#if type === 'book'}
                        <label class="rl-lbl">书名</label>
                    {:else}
                        <label class="rl-lbl">标题</label>
                    {/if}
                    <div class="rl-title-row">
                        <input class="rl-input" bind:value={title} bind:this={titleInput} placeholder="作品名称" />
                        <!-- 🔴 #499E：标题旁那两处只读展示（「★ 8.4 · 500人评价」徽标 与 「来源名 ↗」按钮）**整块撤除** ——
                             用户裁定：这四个值一律归「来源 / 大众评分 / 评价人数 / 平台链接」那一行（新增态是输入框、
                             编辑态是只读概要行 + 右键可编辑），标题旁再来一份就是同一信息两处出现。
                             ⚠️ 连带的「来源名三处同源」口径随之收敛为**两处**（封面角标 / 笔记「来源」行）——
                             表单这一处改由概要行/输入行承担，仍走 `entrySourceLabel` 同一个真源。 -->
                        {#if entry && !metaEditing}
                        <span
                            class="rl-ro-meta"
                            role="group"
                            data-tip={roMetaTip}
                            on:contextmenu|preventDefault={openMetaCtx}>
                            <!-- 🔴 #501①：⛔ 这里**不许**再挂 `aria-label` —— Obsidian 会对「带 `aria-label` 的悬停目标
                                 （含祖先就近匹配）」**自绘官方气泡**，与 `data-tip` 那条叠成**两层**。
                                 #500① 只删了内层 `.rl-btn-src` 的 `data-tip`、漏了这一层 ⇒ 用户上手仍报
                                 「来源和评分处还是有两处提示重叠」。
                                 读屏名改走簇内 `.rl-sr` 隐藏文本（同族口径：`styles.css` 的 `.rl-sr` 注释 /
                                 `pure/searchIcons.ts`）。 -->
                            <span class="rl-sr">来源与评分（右键可手动编辑）</span>
                            {#if communityScore || ratingCount}
                                <span class="rl-title-score">★ {communityScore || '—'}{ratingCount ? ` · ${ratingCount}人评价` : ''}</span>
                            {/if}
                            {#if srcBadgeLabel}
                                <!-- ⛔ 这枚按钮**不挂 `data-tip`**（#500①）：整簇已经有唯一一条提示，两处各一条 ⇒
                                     鼠标在两者之间移动时提示来回换（用户报「多条提示相互覆盖、观感差」）。 -->
                                <button class="rl-btn rl-btn-src" on:click={() => openSource(sourceUrl)}>{srcBadgeLabel} ↗</button>
                            {:else if sourceName}
                                <!-- 只有来源名、没有可打开的链接 ⇒ **纯文本**（⛔ 不当按钮：点了没地方去 = 死按钮） -->
                                <span class="rl-title-score">{sourceName}</span>
                            {/if}
                            {#if !communityScore && !ratingCount && !srcBadgeLabel && !sourceName}
                                <!-- 四个值一个都没有时：这一簇是**唯一**的右键入口 ⇒ 给一颗弱化提示，
                                     ⛔ 别让它渲染成 0 宽（那样等于没有入口，用户就补不上评分/来源了）。 -->
                                <span class="rl-title-score rl-ro-empty">来源 / 评分未填</span>
                            {/if}
                        </span>
                        {/if}
                        {#if manualFill}
                        <!-- #499 AI 预填（用户 2026-10-03：「手动填写界面加个 AI 预填功能」）——
                             与「总结摘要」「重新解析」同款同位的小图标按钮。🔴 点它**只列预览、不落库**，
                             确认后才写回（口径见 `applyPrefill`）。
                             🔴 #499B 收窄（用户：「预填功能只在手动填写界面出现」）：判据是 `manualFill`，
                             ⛔ 不是 `!entry` —— 新增条目**点选搜索结果**那条路上客观字段已由数据源填好，
                             这里再摆一枚「让 AI 猜」既不必要、又可能把刚拉到的好数据覆盖掉。 -->
                        <button
                            class="rl-ai-btn"
                            disabled={prefillBusy}
                            on:click={() => void runAiPrefill()}
                            data-tip={'AI 按标题填写下方字段\n需要时会先查数据源 / 联网搜索，再把结果列出来\n确认后才写入'}>
                            <span class="rl-sr">AI 预填字段</span>
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                                <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
                            </svg>
                        </button>
                        {/if}
                    </div>
                    {#if prefillBusy && prefillStep}
                    <!-- #499D：工具回路里的**每一站**都露出来（「它真的去搜了」这件事必须看得见，
                         ⛔ 别做成一个转圈转到底 —— 用户没法判断是在搜还是卡住了） -->
                    <div class="rl-prefill rl-prefill-wait" aria-live="polite">
                        <span class="rl-spinner" aria-hidden="true"></span>
                        <span class="rl-prefill-step">{prefillStep}…</span>
                    </div>
                    {/if}
                    {#if prefillRows.length > 0}
                    <!-- #499 预填预览：逐行「字段 · 旧值（删除线）· AI 值（灰字）」——
                         用户裁定「先用删除线划掉已填字段，然后用灰色字显示…（二次确认以回填）」。
                         ⚠️ 只列**模型给出了值**的字段（没给的字段不占位）。
                         #499D：头部补**依据**一行 —— 这是「知识截止」对用户唯一可见的交代。 -->
                    <div class="rl-prefill" role="group" aria-label="AI 预填预览">
                        <div class="rl-prefill-head">
                            AI 建议填写下列字段（灰色为将写入的值）
                            <span class="rl-prefill-src">{prefillSources.length ? `依据：${prefillSources.join(' · ')}` : '凭模型记忆，新作品可能查不到'}</span>
                        </div>
                        <ul class="rl-prefill-list">
                            {#each prefillRows as row (row.key)}
                                <li class="rl-prefill-row">
                                    <span class="rl-prefill-lbl">{row.label}</span>
                                    <span class="rl-prefill-vals">
                                        {#if row.old}<span class="rl-prefill-old">{row.old}</span>{:else}<span class="rl-prefill-none">（空）</span>{/if}
                                        <span class="rl-prefill-arrow" aria-hidden="true">→</span>
                                        <span class="rl-prefill-new">{row.next}</span>
                                    </span>
                                </li>
                            {/each}
                        </ul>
                        <div class="rl-prefill-ops">
                            <button class="rl-btn rl-btn-primary" on:click={applyPrefill}>回填这些字段</button>
                            <button class="rl-btn" on:click={clearPrefill}>取消</button>
                        </div>
                    </div>
                    {/if}
                    <!-- ② 来源 / 大众评分 / 评价人数 / 平台链接 —— 四个值共用这一行，**两态互斥**：
                           · 新增态（`metaEditable` 恒真）：四个输入框（2026-09-27 起就在这儿）；
                           · 编辑态：只读展示回到**标题行内**（`.rl-ro-meta` 那一簇，观感 = 原来那两枚徽标），
                             **右键那一簇** → 「手动编辑来源与评分…」→ 这里就地变成四个输入框。
                         🔴 #499E 改口径（用户 2026-10-03：「『来源、大众评分、评价人数、平台链接』改成
                            可再次手动编辑」）—— 推翻 2026-09-27 的「仅第一次填写有效，后续不可修改」。
                            ⚠️ 当时那条口径靠 `{#if !entry}` 表达，现在判据换成 `metaEditable`（见 script 里的注释）。
                         ⚠️ #499E **二轮修正**：只读展示曾短暂做成「另起一行、一行四个『标签 + 值』」，
                            用户上手后要求「渲染回原来的样式，**在标题框旁而不是另起一行**」⇒ 那一版已撤，
                            ⛔ 别再按那个形态做回来（标题行内那一簇才是现行形态）。
                         ⛔ 别把只读簇与输入行**同时**渲染（同一信息两处出现）；⛔ 也别改成 `disabled` 输入框
                            （灰框让人以为是「临时不可用」，而这两态的语义是「先看清楚、要改就解锁」）。 -->
                    {#if metaEditable}
                        <div class="rl-meta-row">
                            <!-- #430：**来源**框在最前（用户：「在大众评分前面并排个来源框」）。
                                 用途：手工新建的条目没有数据源 ⇒ 封面角标只有「8.4★」；
                                 填了它就能显示「番茄8.4★」。⛔ 它**不是**数据源键（那个由搜索回填决定走哪条链）。 -->
                            <span class="rl-meta-lbl">来源</span>
                            <input class="rl-input rl-meta-sn" bind:value={sourceName} on:input={() => (metaTouched = true)} placeholder="来源名" />
                            <span class="rl-meta-lbl">大众评分</span>
                            <input class="rl-input rl-meta-cs" bind:value={communityScore} on:input={() => (metaTouched = true)} placeholder="如 7" />
                            <!-- #431：评价人数（用户：「手动填写的大众评分再加个评价人数，用例如：7 | 500 来表示
                                 7 星 500 人评价」）。两种填法都通：
                                   · 在这个框里写 `7 | 500`（提交那一刻自动拆开，见 `submit()` 里的 `splitScoreCount`）；
                                   · 或者两个框各填各的（这个框就是给这条路用的）。
                                 ⛔ 不在 `on:input` 里拆 —— 用户刚敲下 `7|` 就会被吃掉，后续按键会落错框。
                                 🔴 #445：占位只写「如 7」（用户诉求）—— `7 | 500` 那一路**照旧支持**，
                                    只是不再占着占位符宣传它（占了反而让人以为必须写成这个格式）。 -->
                            <span class="rl-meta-lbl">评价人数</span>
                            <input class="rl-input rl-meta-rc" bind:value={ratingCount} on:input={() => (metaTouched = true)} placeholder="如 500" />
                            <span class="rl-meta-lbl">平台链接</span>
                            <input class="rl-input" bind:value={sourceUrl} on:input={() => (metaTouched = true)} placeholder="https://…" />
                            <!-- #385：平台名（可点开链接）+ 评分★ 的预览，顺序与配色照海报墙封面角标
                                 （来源名在前、数值暖黄 + 后缀星在后）。⛔ 认不出平台时不出空占位。
                                 #386：仅**手填过**才预览（自动获取填写保持原样 ⇒ 徽标隐身）。 -->
                            {#if manualPlatform || manualScore}
                                <span class="rl-meta-badge">
                                    {#if manualPlatform}
                                        <button class="rl-meta-src" data-tip="打开平台页面" on:click={() => openSource(sourceUrl)}>{manualPlatform}</button>
                                    {/if}
                                    {#if manualScore}<span class="rl-meta-num">{manualScore}★</span>{/if}
                                </span>
                            {/if}
                        </div>
                    {/if}
                    {#if type !== 'book' && type !== 'music'}
                    <div class="rl-2col">
                        <div>
                            <label class="rl-lbl">题材</label>
                            <input class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" />
                        </div>
                        <div>
                            <label class="rl-lbl">{type === 'movie' ? '上映年' : type === 'game' || type === 'music' ? '发行年' : '首播年'}</label>
                            <input class="rl-input" bind:value={year} placeholder="如 2024" />
                        </div>
                    </div>
                    {/if}
            {#if type === 'book'}
                {#if bookKind === 'novel'}
                <!-- 网文（1.0.3，用户 2026-09-13 裁定）：上架年 / 作者 / 题材 / 元数据章数。
                     出版侧字段（出版社 / ISBN / 目录）对网文不适用，表单不展示；保存时清空存量（见 submit） -->
                <div class="rl-2col">
                    <div><label class="rl-lbl">上架年</label><input class="rl-input" bind:value={year} placeholder="如 2024" /></div>
                    <div><label class="rl-lbl">作者</label><input class="rl-input" bind:value={author} placeholder="作者名，多个用 / 分隔" /></div>
                </div>
                <div class="rl-2col">
                    <div><label class="rl-lbl">题材</label><input class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" /></div>
                    <div>
                        <label class="rl-lbl">元数据章数</label>
                        <input class="rl-input" type="number" min="0" bind:value={pageCountVal} placeholder="如 1200 章" />
                    </div>
                </div>
                {:else if bookKind === 'comic'}
                <!-- 漫画（🔴 #444g，用户 2026-09-30：「漫画的自动拉取和手动填写表单界面把 ISBN、元数据页数、
                     作者简介框删除掉，加个画师框」）：出版年 / 出版社 / 作者（原作） / **画师** / 题材。
                     ⚠️ 与文学分支的差别只有「画师」多一格 —— 下面 ISBN / 元数据页数 / 作者简介三处的
                        `{#if}` 已按 `bookKind` 把漫画排掉（⛔ 别用 `!== 'novel'` 那种粗条件，那会把漫画一起放进来）。 -->
                <div class="rl-2col">
                    <div><label class="rl-lbl" for="rl-f-comic-year">出版年</label><input id="rl-f-comic-year" class="rl-input" bind:value={year} placeholder="如 2024" /></div>
                    <div><label class="rl-lbl" for="rl-f-comic-pub">出版社</label><input id="rl-f-comic-pub" class="rl-input" bind:value={publisher} placeholder="出版社名" /></div>
                </div>
                <div class="rl-2col">
                    <div><label class="rl-lbl" for="rl-f-comic-author">作者</label><input id="rl-f-comic-author" class="rl-input" bind:value={author} placeholder="原作 / 编剧，多个用 / 分隔" /></div>
                    <div><label class="rl-lbl" for="rl-f-comic-artist">画师</label><input id="rl-f-comic-artist" class="rl-input" bind:value={artist} placeholder="作画，多个用 / 分隔" /></div>
                </div>
                <div class="rl-2col">
                    <div><label class="rl-lbl" for="rl-f-comic-genres">题材</label><input id="rl-f-comic-genres" class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" /></div>
                    <!-- 🔴 #445 总话数（用户：「漫画源界面加一个总话数框，与题材框并排在右」）：
                         漫画的「页数」没有意义，**总话数**才是它的等价值 ⇒ 与网文的「元数据章数」同样落
                         `pageCount` 这一个字段（键名不变，见 data/noteGenerator 的口径注释）。
                         ⚠️ 它**不在**下面的 `bookKind !== 'comic'` 排除之列 —— 那个排除只管 ISBN / 作者简介。 -->
                    <div><label class="rl-lbl" for="rl-f-comic-chapters">总话数</label><input id="rl-f-comic-chapters" class="rl-input" type="number" min="0" bind:value={pageCountVal} placeholder="如 139" /></div>
                </div>
                <!-- ⚠️ 上面 6 个 label **必须写 `for`/`id`**：本表单其余 label 都是历史裸写法（那批告警已计入 89 基线），
                     而门禁是「构建告警**不高于**基线」⇒ 新加的裸 label 会一条 +1 当场破线（本轮实测 89 → 94）。
                     ⛔ 别把 `for`/`id` 删掉，也别让 6 个 id 重名。 -->
                {:else}
                <!-- 文学：出版年 / 出版社 / 作者 / 题材（文学口径不变） -->
                <div class="rl-2col">
                    <div><label class="rl-lbl">出版年</label><input class="rl-input" bind:value={year} placeholder="如 2024" /></div>
                    <div><label class="rl-lbl">出版社</label><input class="rl-input" bind:value={publisher} placeholder="出版社名" /></div>
                </div>
                <div class="rl-2col">
                    <div><label class="rl-lbl">作者</label><input class="rl-input" bind:value={author} placeholder="作者名，多个用 / 分隔" /></div>
                    <div><label class="rl-lbl">题材</label><input class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" /></div>
                </div>
                {/if}
            {/if}
            {#if type === 'music'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">作者</label><input class="rl-input" bind:value={author} placeholder="歌手 / 艺术家" /></div>
                    <div><label class="rl-lbl">专辑</label><input class="rl-input" bind:value={album} placeholder="专辑名" /></div>
                </div>
                <div class="rl-2col">
                    <div><label class="rl-lbl">题材</label><input class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" /></div>
                    <div><label class="rl-lbl">发行年</label><input class="rl-input" bind:value={year} placeholder="如 2024" /></div>
                </div>
            {/if}
            {#if type === 'movie' || type === 'tv' || type === 'anime'}
                <div class="rl-2col">
                    <div>
                        <label class="rl-lbl">导演</label>
                        <!-- 🔴 #502②（用户：「导演框也改成多行框」）：与 #500② 的「主演」**同款同口径** ——
                             一行 input 改 textarea + `.rl-multi`（`resize: vertical`，只能拖高、拖不宽）。
                             ⛔ 不钉 `height` / `min-height`（钉了会把 28px 顶成 30px ⇒ 同列字段的行位错开 2px）；
                             ⛔ 不接 autosize（自动增高与「手动拖拽调高」打架，拖到多高、一输入就被改回去）。
                             ⚠️ 它 `bind:value` 的是**派生变量** `directorWriters`（= `director` + `screenwriter` 的拼串）——
                             换成 textarea **不改这条数据流**（原来那个 input 就是这么绑的），提交侧照旧拆。 -->
                        <textarea
                            class="rl-input rl-multi"
                            rows="1"
                            bind:value={directorWriters}
                            placeholder="导演 / 编剧 用 / 分隔"></textarea>
                    </div>
                    {#if formMode !== 'bangumi'}
                        <div>
                            <label class="rl-lbl">{type === 'anime' ? '主演（声优）' : '主演'}</label>
                            <!-- 🔴 #500②（用户：「将海报墙中的主演框改为多行输入框，默认高度与长度保持现状，
                                 同时支持手动拖拽调整高度」）：一行 input 改 textarea。
                                 · 默认高 / 宽 = 原来那个 input 的高度（`--input-height` 那档 30px）与整行宽度；
                                 · `resize: vertical` —— 只能拖高、拖不宽（宽度是布局给的，拖宽会破同列对齐）；
                                 · ⛔ **不接 autosize 自动增高**：自动增高与「手动拖拽调高」会打架
                                 （拖到多高，一输入就被改回去，用户调的高度留不住）。 -->
                            <textarea
                                class="rl-input rl-multi"
                                rows="1"
                                bind:value={cast}
                                placeholder="多个主演用 / 分隔"></textarea>
                        </div>
                    {:else if type === 'tv' || type === 'anime'}
                        <div>
                            <label class="rl-lbl">总集数</label>
                            <input class="rl-input" type="number" min="0" bind:value={totalEpisodes} on:input={resizeEpisodeFiles} placeholder="如 12" />
                        </div>
                    {/if}
                </div>
            {/if}
            {#if type === 'game'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">平台</label><input class="rl-input" bind:value={platform} placeholder="PC / Switch / PS5" /></div>
                    <div><label class="rl-lbl">开发商</label><input class="rl-input" bind:value={developer} placeholder="开发商名" /></div>
                </div>
            {/if}

            {#if (type === 'tv' || type === 'anime') && formMode !== 'bangumi'}
                <!-- 总集数 + 当前进度并排（动画/剧集；电影无总集数概念，观看链接区渲染单集播放钮）：
                     两字段同一行两列，行高与同列条目一致、信息密度更高。
                     🔴 #440：**「当前进度」收成一个数字框**（用户 2026-09-30：「把 S1E1 那个位置做成当前进度，
                        如填写 5 就代表当前进度为第 5 集，不做右键可标记动作了」）—— 原来是 `S[1] E[3]`
                        两个框 + 前缀：季号既没人维护（本仓**一季一条条目** ⇒ 季号由「系列序号」表达，见 #434），
                        又让「只想改集数」变成两处输入。
                     ⚠️ **季号不再手填，但仍随条目提交**（`season` 变量原样保留 `entry.progress.season`）——
                        ⛔ 别顺手把它从下面的提交对象里删掉：那会把老数据里的季号**静默抹成默认值**。
                     ⚠️ 集数是 **1 基**（`progress.episode` = 已看到第几集，与「百分比 = episode / totalEpisodes」
                        同一口径），⛔ 别改成 0 基、也别把 `clampWatch` 的 `min` 调成 1（0 = 还没开始看）。 -->
                <div class="rl-2col">
                    <div>
                        <label class="rl-lbl">总集数</label>
                        <input class="rl-input" type="number" min="0" bind:value={totalEpisodes} on:input={resizeEpisodeFiles} placeholder="如 12" />
                    </div>
                    <div>
                        <label class="rl-lbl" data-tip="填第几集（决定进度显示）">当前进度</label>
                        <input class="rl-input" type="number" min="0" value={episode} on:input={(ev) => (episode = clampWatch(Number(ev.currentTarget.value), 0, entry?.progress?.episode ?? 1))} placeholder="如 5" />
                    </div>
                </div>
            {/if}
            {#if type === 'book' && bookKind === 'book'}
                <!-- ISBN + 元数据页数：**仅文学**（网文是「元数据章数」、已在书籍区首两行；
                     🔴 #444g 漫画明确不要这两项 —— 原来条件写的是 `!== 'novel'`，把漫画一起放进来了） -->
                <div class="rl-2col">
                    <div><label class="rl-lbl">ISBN</label><input class="rl-input" bind:value={isbn} placeholder="如 9787536692930" /></div>
                    <div>
                        <label class="rl-lbl">元数据页数</label>
                        <input class="rl-input" type="number" min="0" bind:value={pageCountVal} placeholder="如 320" />
                    </div>
                </div>
            {/if}

            <!-- 系列 / 系列序号（#434）：**全类型**可用 —— 海报墙的「系列折叠卡」靠这两项成组。
                 ⚠️ 在此之前 `series` **只有书籍侧由豆瓣「丛书」回填、表单里根本没有输入口**（只能看、不能填）；
                    本批首次给出输入口，并把用途从「丛书」扩到通用的「同一 IP 下多部作品」。
                 ⚠️ 🔴 #443：序号**锁定整数**（第几部 / 第几季；用户裁定「只能填整数不能填小数」）；
                    ⛔ 占位文案不写具体作品名（文案规范）。
                 🔴 **两个框都是纯手填**（用户 2026-09-30 上手当天推翻了 `#435` 的「复用已有系列名做输入建议」：
                    「这个系列怎么是下拉项……下拉选择毛用没有改成手动填写」）——
                    建议清单必然跨类型（动画表单里冒出书籍的系列名 = 「不对应类型」的观感来源），
                    ⇒ ⛔ 别再挂 `list=` / `<datalist>`；形态就与「来源 / 大众评分 / 平台链接」那几个手填框一致。 -->
            <div class="rl-2col">
                <div>
                    <!-- ⚠️ 本表单其余 label 都没写 `for`（历史写法，Svelte 会为此报「label 未关联控件」的 A11y 告警）。
                         这两个框**故意补上** `for`/`id`：本批的门禁要求「构建告警数不高于基线 89」，
                         新加两个裸 label 会各带一条告警 ⇒ 顺手写成规范形态，⛔ 别把 `for`/`id` 删掉。 -->
                    <label class="rl-lbl" for="rl-f-series">系列</label>
                    <input id="rl-f-series" class="rl-input" bind:value={series} placeholder="同一系列的名称（留空不成组）" />
                </div>
                <div>
                    <label class="rl-lbl" for="rl-f-series-index">系列序号</label>
                    <input id="rl-f-series-index" class="rl-input" type="number" step="1" min="1" bind:value={seriesIndexVal} placeholder="可留空，填整数（第几部/季）" />
                </div>
            </div>
            <!-- 🔴 #668 关联功能区已按用户裁定**整体下线归档**（「全部给我移除掉吧归档下未来实现」）。
                 数据层与笔记侧**未删除**：`MediaEntry.related` / `normalizeEntry` 白名单 / 笔记 `## 关联` 章节
                 与 `pure/relatedGraph.ts` 及单测都还在，既有数据原样保留。重新上线 = 把组件挂回这里。 -->

            <!-- 🔴 #537 阅读时长（文学 / 网文 / 漫画三子类共用 —— 都是 `type === 'book'`）：位置在「内容简介」**上方**。
                 数据两来源：① 内置阅读器阅读该条目时**自动累计**（宿主 main.withReadTime，扣后台 + 单次≥1 分钟）；
                 ② 本框手填 = **覆盖**总数。海报墙封面左下角显示「已读 2h」（复用游戏 `.rl-cov-playtime` 那枚角标）。
                 ⚠️ label 带 `for`/`id` —— 裸 label 会多报一条 A11y 告警、破 89 基线（同系列两框那条口径）。 -->
            {#if type === 'book'}
                <div>
                    <label class="rl-lbl" for="rl-f-readhours">阅读时长（小时）</label>
                    <input id="rl-f-readhours" class="rl-input" type="number" min="0" step="0.1" bind:value={readHours} placeholder="如 2.5" />
                </div>
            {/if}
            <label class="rl-lbl">{type === 'book' ? '内容简介' : '简介'}</label>
            <textarea class="rl-input rl-summary" rows="6" bind:this={summaryEl} placeholder={type === 'book' ? '填写图书内容简介…' : '填写作品剧情简介…'} bind:value={summary}></textarea>

            {#if type === 'music'}
                <!-- LRC 歌词（#396）：正文住在笔记的 ` ```lrc ` 块里（⛔ 不落 catalog），保存时写回笔记；
                     播放器读的就是这一段（四路歌词源的第 2 档「块内正文」），所以两边天然联动。
                     🔴 位置（2026-09-27 用户指示）：**在「总结摘要」之上** —— 歌词是音乐条目的核心内容之一，
                     原先落在表单最底部（本地音频之后），要看它得滚过整张表单。 -->
                <div>
                    <div class="rl-lbl-row">
                        <label class="rl-lbl" for="rl-lrc">LRC歌词</label>
                        <button
                            class="rl-ai-btn"
                            disabled={lrcBusy || !title.trim()}
                            on:click={() => void fetchOnlineLyrics()}
                            data-tip={title.trim() ? `按「标题 作者」搜歌词（四源）\n选中即填入` : '先填写标题再获取歌词'}>
                            <span class="rl-sr">获取歌词</span>
                            <Icon icon="scroll-text" size={13} />
                        </button>
                        <!-- 🔴 #507：AI 双语歌词 —— **排在「获取歌词」那枚的右边**（用户指定位置），
                             与它同款 `.rl-ai-btn` 小图标按钮（20×18 / hover 变 accent / 读屏名走 `.rl-sr`）。
                             图标 `languages` 已用 `_probe_lucide.cjs` 在 Obsidian app.js 图标表核实存在
                             （⛔ 别改成没核实过的名字：`setIcon` 遇未知名**静默失败** = 空白按钮）。 -->
                        <button
                            class="rl-ai-btn"
                            disabled={lrcAiBusy || lrcTodo === 0}
                            on:click={() => void generateBilingualLrc()}
                            data-tip={lrcTodo === 0
                                ? '当前歌词没有需要翻译的行（已是双语，或还没有歌词）'
                                : `让 AI 逐行译成中文，按「原文 | 译文」接在每行后面\n时间标签不动，已有译文的行会跳过`}>
                            <span class="rl-sr">生成双语歌词</span>
                            <Icon icon="languages" size={13} />
                        </button>
                        <!-- #466：检索期间在按钮**右边同一行**给一个转圈指示器（用户：「给 LRC 歌词获取按钮和
                             总结摘要按钮平行线旁加个转圈指示器」）。⛔ 别改用按钮内置加载态（`.rl-btn-loading` 会把
                             图标整颗盖掉 —— 这两枚是 20×18 的纯图标小按钮，盖掉后认不出是哪个按钮在忙）。
                             全局 `.rl-spinner`（styles.css）已有「小尺寸 + 跟随主题 + 尊重减少动效」三件事，⛔ 别另写一份。 -->
                        {#if lrcBusy || lrcAiBusy}<span class="rl-spinner" aria-hidden="true"></span>{/if}
                    </div>
                    <textarea id="rl-lrc" class="rl-input rl-lrc" rows="6" bind:value={lrc}
                        placeholder={'逐行粘贴 LRC 歌词，或点右上角按钮在线获取\n[00:01.00]第一句歌词'}></textarea>
                    {#if lrcOpen}
                        <!-- 候选浮层（#401 照 `obsidian-lyricflux/TagEditorModal` 的候选框搬）：
                             标题行（左标题 + 右 ✕）→ 一个带边框的滚动框，**每行一枚来源胶囊 + 一行候选**。
                             ⛔ 别再退回「按源分组 + 每组小标题」的段落式列表（正本不是那样，也更占高度）。 -->
                        <div class="rl-ep-edit-mask" on:click={() => (lrcOpen = false)}></div>
                        <div class="rl-ep-edit rl-lrc-pop" role="dialog" aria-labelledby="rl-lrc-pop-title">
                            <div class="rl-lrc-pop-head">
                                <span class="rl-ep-edit-title" id="rl-lrc-pop-title">选择歌词来源</span>
                                <button class="rl-lrc-pop-close" on:click={() => (lrcOpen = false)} data-tip="关闭">✕</button>
                            </div>
                            {#if lrcQuery}<div class="rl-hint">检索词：{lrcQuery}</div>{/if}
                            {#if lrcFlatList().length}
                                <div class="rl-lrc-list">
                                    {#each lrcFlatList() as row (lrcKey(row.source, row.c))}
                                        <button
                                            class="rl-lrc-item"
                                            disabled={!!lrcLoadingKey}
                                            on:click={() => void applyLyrics(row.source, row.c)}
                                            data-tip={`用 ${row.label} 这份填入`}>
                                            <span class="rl-lrc-src">{row.label}</span>
                                            <span class="rl-lrc-item-t">{formatCandidateLabel(row.c)}</span>
                                            <span class="rl-lrc-item-a">{lrcLoadingKey === lrcKey(row.source, row.c) ? '获取中…' : '填入'}</span>
                                        </button>
                                    {/each}
                                </div>
                            {:else}
                                <div class="rl-hint">四个源都没有找到这首歌的歌词</div>
                            {/if}
                            {#if lrcMissSummary()}<div class="rl-hint">{lrcMissSummary()}</div>{/if}
                            {#if lrcFillError}<div class="rl-hint rl-hint-warn">{lrcFillError}</div>{/if}
                            {#if lrc.trim()}<div class="rl-hint">填入会覆盖当前歌词框内容</div>{/if}
                        </div>
                    {/if}
                </div>
            {/if}

            {#if type !== 'book'}
            <!-- AI 摘要（单框合并：第 1 行一句话总结，其余每行一条看点）：可手填 / 可点「总结摘要」右侧 ✨ 生成 -->
            <div class="rl-lbl-row">
                <label class="rl-lbl">总结摘要</label>
                <button
                    class="rl-ai-btn"
                    disabled={aiBusy}
                    on:click={() => void generateAiSummary()}
                    data-tip={`AI 生成总结 + ${AI_HIGHLIGHT_SUGGEST} 条看点\n生成后可手改`}>
                    <span class="rl-sr">AI 生成摘要</span>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                        <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
                    </svg>
                </button>
                <!-- #466：生成期间在按钮右边同一行给转圈指示器（与「获取歌词」同一口径；⛔ 别用按钮内置加载态） -->
                {#if aiBusy}<span class="rl-spinner" aria-hidden="true"></span>{/if}
            </div>
            <textarea class="rl-input rl-ai-hl" rows="4" bind:value={aiText}
                placeholder={'一句话总结：\n1. 要点1\n2. 要点2\n3. 要点3'}></textarea>
            {/if}
            {#if type === 'game'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">游玩时长（小时）</label><input class="rl-input" type="number" min="0" step="0.1" bind:value={playtimeHours} placeholder="如 12" /></div>
                </div>
                <div>
                    <!-- 🔴 #523：标签统一「路径」（原「启动快捷方式」）；当时裁定「游戏类**不配**小图标按钮」。
                         🔴🔴 #534 **翻面**（用户 2026-10-05：「希望全类型条目启动路径旁都添加统一本地路径和
                         网络路径检索小图标按钮」＋追问后点定「只放本地一枚（推荐）」）：
                         游戏行**配一枚「本地检索」**（`folder-search`，先弹目录选择器再按标题找同名可启动文件）；
                         ⛔ 网络那枚**不配**（用户裁定「不接，仅在右键弹窗加网络路径框（加粘贴文字按钮）」）
                         —— 游戏的网络路径靠下面浮层里的输入框手填/粘贴（没有可检索的源，硬放一枚按钮是空转）。 -->
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">启动路径</label>
                        <!-- 本地检索：选文件夹 → 按标题在目录里找同名**可启动文件**（.lnk/.exe/.bat…）→ 回填启动路径 -->
                        <button
                            class="rl-ai-btn"
                            on:click={() => void findLibraryGame()}
                            data-tip="检索本地：先选一个文件夹，再按标题在里面找同名游戏文件（.lnk / .exe / .bat…）">
                            <span class="rl-sr">检索本地游戏</span>
                            <Icon icon="folder-search" size={13} />
                        </button>
                    </div>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!gameLaunchPath.trim() || !!gameUrl.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={launchGameFromForm}
                                on:contextmenu={(ev) => { ev.preventDefault(); openGameEditor(); }}
                                data-tip={gameLaunchPath.trim() ? `启动：${gameLaunchPath}\n右键编辑/浏览更换` : (gameUrl.trim() ? `网络路径：${gameUrl}\n右键编辑/粘贴更换` : '未关联 — 右键选 .lnk')}>
                                <Icon icon="play" size={11} /> 启动
                            </button>
                        </span>
                        {#if gameEditOpen}
                            <!-- 启动快捷方式编辑浮层（参照书籍文件浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={closeGameEditor}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-game">
                                <div class="rl-ep-edit-title" id="rl-ep-title-game">启动路径（.lnk）</div>
                                <!-- 🔴 #583：这两行的「标签 → 控件」间距与就地提示**与集浮层同款**
                                     （`.rl-edit-lblrow` + `.rl-saved-hint`）—— 用户点名「显示也统一」。
                                     ⛔ 别只加提示不包行：裸 `<label>` 直跟输入框时提示会掉到行外成新的一行。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline">文件路径</label>
                                    {#if savedKey === AUTOSAVE_KEYS.gameLaunch}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={gameLaunchVal} on:input={(ev) => (gameLaunchVal = inputVal(ev))} on:blur={() => autoSaveGame('launch')} placeholder="库内路径，或系统绝对路径（.lnk）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseGameLaunch(ev)} data-tip="选择 .lnk 快捷方式">浏览</button>
                                </div>
                                <!-- 🔴 #534 游戏**网络路径**（用户：「不接，仅在右键弹窗加网络路径框（加粘贴文字按钮）」）：
                                     与影视集编辑浮层那行同款（label + 输入框 + 粘贴）；⚠️ label 必须带 `for`/`id`
                                     —— 本仓新 label 裸写会多报一条 A11y 告警破 89 基线。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline" for="rl-f-gameurl">网络路径</label>
                                    {#if savedKey === AUTOSAVE_KEYS.gameUrl}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input id="rl-f-gameurl" class="rl-input rl-ep-edit-input" value={gameUrlVal} on:input={(ev) => (gameUrlVal = inputVal(ev))} on:blur={() => autoSaveGame('url')} placeholder="https://…（商店页 / 官网 / 攻略）" />
                                    <button class="rl-btn rl-link-act" on:click={() => void pasteGameUrl()} data-tip="粘贴网络路径">粘贴</button>
                                </div>
                                <!-- 🔴 #563：底部三枚按钮退场（同集浮层），改失焦自动保存 + 点遮罩关闭 -->
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
            {#if type === 'book' && bookKind !== 'comic'}
                <!-- 🔴 #444g：漫画**不展示**作者简介（用户：「把 ISBN、元数据页数、作者简介框删除掉」）——
                     漫画的作者与画师是两个人，一个「作者简介」框语义不清；简介仍走上面的「简介」区块。 -->
                <label class="rl-lbl">作者简介</label>
                <textarea class="rl-input rl-summary" rows="3" bind:this={authorIntroEl} placeholder="填写作者介绍…" bind:value={authorIntro}></textarea>
                <!-- 目录：**文学与网文都渲染**（🔴 #431 翻面 —— 2026-09-13 曾按「网文无出版目录」撤掉该框；
                     用户 2026-09-29「文学类和网文的 toc 目录回填只显示前 10 章加个 `....`」之后，
                     写回来的是 10 行预览，不再是那份吓人的 2000 章出版目录）。 -->
                <label class="rl-lbl">目录</label>
                <textarea class="rl-input rl-summary" rows="4" bind:this={tocEl} placeholder="填写目录，每行一项…" bind:value={toc}></textarea>
                {#if type === 'book'}
            <!-- AI 摘要（单框合并：第 1 行一句话总结，其余每行一条看点）：可手填 / 可点「总结摘要」右侧 ✨ 生成 -->
            <div class="rl-lbl-row">
                <label class="rl-lbl">总结摘要</label>
                <button
                    class="rl-ai-btn"
                    disabled={aiBusy}
                    on:click={() => void generateAiSummary()}
                    data-tip={`AI 生成总结 + ${AI_HIGHLIGHT_SUGGEST} 条看点\n生成后可手改`}>
                    <span class="rl-sr">AI 生成摘要</span>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                        <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
                    </svg>
                </button>
                <!-- #466：书籍态这份是**同一个「总结摘要」行的另一处分支**（书与非书各一份 markup）——
                     转圈指示器两处都必须有，⛔ 别只改一处（那是本仓「同一概念两处写法必然漂」的老毛病） -->
                {#if aiBusy}<span class="rl-spinner" aria-hidden="true"></span>{/if}
            </div>
            <textarea class="rl-input rl-ai-hl" rows="4" bind:value={aiText}
                placeholder={'一句话总结：\n1. 要点1\n2. 要点2\n3. 要点3'}></textarea>
                {/if}
            {/if}
            <!-- 🔴 #549（用户 2026-10-07：「网文/漫画也加上阅读进度框」）：**三个书籍子类都要有**这一组
                 （当前页 / 总页 + 进度条 + 百分比）—— 它原先跟着「作者简介 / 目录」一起被关在
                 `bookKind !== 'comic'` 那层里，漫画因此整组拿不到，而漫画**同样有阅读进度**
                 （图片文件夹 / CBZ 走漫画阅读器逐页读，`readingProgress.percent` 自动落库）。
                 ⚠️ 拆出来的只有**这一组**：作者简介 / 目录 / 总结摘要的取舍**一字不动**
                   （#444g 用户点名：漫画不要 ISBN / 元数据页数 / 作者简介）。
                 ⚠️ 位置刻意留在原处（紧接上面那一组之后）⇒ 文学 / 网文的字段顺序**零变化**。 -->
            {#if type === 'book'}
                <!-- 🔴 #409：这颗「重新解析」小按钮从**输入行末尾**挪到**标签行**，与「总结摘要」「本地音频」
                     那几枚**同款同位**（`.rl-lbl-row` + `.rl-ai-btn`）—— 用户：「把阅读器进度页数同款的小按钮
                     也移到旁边，统一摆放以便查看」＋「修正这些小按钮颜色不一致的问题」。
                     ⛔ 别再用 `.rl-prog-refresh` 那套（带描边 / 22×22 / hover 灰字 —— 与旁边几枚两套配色）。 -->
                <div class="rl-lbl-row">
                    <label class="rl-lbl">{bookUnitLabel}</label>
                    <button
                        class="rl-ai-btn"
                        data-tip="按文件重算进度"
                        on:click={() => void autoLinkBookProgress(bookFileVal.trim(), true)}>
                        <span class="rl-sr">重新解析本地文件进度</span>
                        <Icon icon="refresh-cw" size={13} />
                    </button>
                </div>
                <div class="rl-prog-range">
                    <input class="rl-input rl-prog-input" type="number" min="0" bind:value={readingPage} placeholder="当前" />
                    <span class="rl-prog-dash">-</span>
                    <input class="rl-input rl-prog-input" type="number" min="0" bind:value={readingTotalPage} placeholder={bookUnit === '章' ? '总章节' : '总页数'} />
                </div>
                {#if readingPage && readingTotalPage}
                    <div class="rl-readbar {readbarClass}"><div class="rl-readbar-fill" style={`width:${readPct}%`}></div></div>
                    <div class="rl-hint">已读 {readingPage} / {readingTotalPage} {bookUnit} · 进度 {readPct}%{#if readPct >= 100} · 已读完，可标记「已读」{/if}</div>
                    {#if status === 'want' && Number(readingPage) > 0}
                        <div class="rl-hint rl-hint-warn">⚠ 已有阅读进度 {readPct}%，建议切到「在读」</div>
                    {/if}
                {/if}
            {/if}
            {#if type === 'music'}
                <div>
                    <!-- 🔴 #523：标签统一叫「路径」（用户：「所有类型条目下的右键编辑条目的播放标题统一改成
                         『路径』标题」）。旁边按类型挂小图标按钮 —— 音乐 = 「检索本地」+「下载」；
                      🔴 那个「本地音频」浮层**标题旁**的 🔍 已撤（用户：「这些关联浮窗内小图标按钮都不再显示」）
                         ⇒ 检索移到这里（`findLibraryAudio` 改为直接回填表单值 + Notice 反馈）。 -->
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">启动路径</label>
                        <button
                            class="rl-ai-btn"
                            on:click={findLibraryAudio}
                            data-tip="检索本地：按标题在音频文件目录里找同名音频">
                            <span class="rl-sr">检索本地音频</span>
                            <Icon icon="folder-search" size={13} />
                        </button>
                        {#if canDownload}
                            <button
                                class="rl-ai-btn"
                                on:click={openDownloader}
                                data-tip="按歌名 / 歌手搜歌下载">
                                <span class="rl-sr">下载歌曲</span>
                                <Icon icon="download" size={13} />
                            </button>
                        {/if}
                    </div>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!audioPath.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={playMusicFromForm}
                                on:contextmenu={(ev) => { ev.preventDefault(); openAudioEditor(); }}
                                data-tip={audioPath.trim() ? `播放：${audioPath}${audioMetaLine ? `\n${audioMetaLine}` : ''}\n右键编辑/浏览更换` : '未关联本地音频 — 右键编辑选择音频文件'}>
                                <Icon icon="play" size={11} /> 播放
                            </button>
                        </span>
                        {#if audioEditOpen}
                            <!-- 本地音频编辑浮层（参照书籍文件浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={closeAudioEditor}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-audio">
                                <!-- 🔴 #523：这枚 🔍（#404 加的「检索库内同名音频」）已按用户裁定
                                     「这些关联浮窗内小图标按钮都不再显示」**撤除**，功能搬到表单「路径」标签旁
                                     （`findLibraryAudio`，见那边注释）。标题也统一成「路径」。 -->
                                <div class="rl-ep-edit-title" id="rl-ep-title-audio">启动路径</div>
                                <!-- 🔴 #583：就地提示与集/游戏浮层同款（`.rl-edit-lblrow` + `.rl-saved-hint`）。
                                     ⚠️ 失焦那处**必须**是箭头函数包一层：直接把函数名交给 `on:blur` 时，
                                     Svelte 会把**事件对象**当第一个实参传进去 ⇒ `force` 变成真值（处处强制保存）。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline">文件路径</label>
                                    {#if savedKey === AUTOSAVE_KEYS.audioPath}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={audioPathVal} on:input={(ev) => { audioPathVal = inputVal(ev); syncAudioName(); }} on:blur={() => autoSaveAudio()} placeholder="库内路径，或系统绝对路径（mp3/flac/m4a…）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseAudio(ev)} data-tip="选择音频文件">浏览</button>
                                </div>
                                <!-- 🔴 #601 音乐**网络地址**（append-only 新字段 `audioUrl`）：与游戏浮层那条同款
                                     （label + 输入框 + 粘贴）。⚠️ label 带 `for`/`id`（裸写会多报一条
                                     A11y 告警破 89 基线）。
                                     🔴 #685（用户：「音乐也要加网络检索小图标按钮，参考弹出搜索b站视频链接回填就行了」）：
                                     旧口径「音乐侧没有可用的在线检索源 ⇒ 只有手填 / 粘贴」**已作废** —— 现在有：
                                     **在线曲库**（与快捷关联弹窗那枚同一条链）。图标挂在**这个标签旁**
                                     （⚠️ 音乐侧主表单没有网络地址输入框 ⇒ 只能挂这里，⛔ 别搬到「启动路径」行）。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline" for="rl-f-audiourl">网络地址</label>
                                    {#if songLibOn}
                                        <button
                                            class="rl-ai-btn"
                                            data-tip="在线曲库检索：找一首能直接试听的平台页，点一条就填进网络地址"
                                            on:click={() => void openSongUrlPicker()}>
                                            <span class="rl-sr">在线曲库检索</span>
                                            <Icon icon="globe" size={13} />
                                        </button>
                                    {/if}
                                    {#if savedKey === AUTOSAVE_KEYS.audioUrl}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input id="rl-f-audiourl" class="rl-input rl-ep-edit-input" value={audioUrlVal} on:input={(ev) => (audioUrlVal = inputVal(ev))} on:blur={() => autoSaveAudioUrl()} placeholder="https://…（在线页 / 试听链接）" />
                                    <button class="rl-btn rl-link-act" on:click={() => void pasteAudioUrl()} data-tip="粘贴网络地址">粘贴</button>
                                </div>
                                <!-- 🔴 #497 改名（用户：「再添加在音乐条目上修改关联的音频文件名称的功能」）：
                                     只改**主名**，扩展名以静态后缀显示 —— 扩展名一改这文件就不是音频了，
                                     而它是用户的文件，改坏了找不回来。真动磁盘的逻辑在宿主（库内 `vault.rename`
                                     / 库外 `fs.rename`，同名 `.lrc` 一起改）。 -->
                                <label class="rl-lbl-inline" for="rl-ep-audio-name">文件名</label>
                                <div class="rl-ep-edit-row">
                                    <input id="rl-ep-audio-name" class="rl-input rl-ep-edit-input" value={audioNameVal} disabled={!audioPathVal.trim()} on:input={(ev) => (audioNameVal = inputVal(ev))} placeholder="不含扩展名" />
                                    {#if audioExtOf(audioPathVal)}<span class="rl-ep-ext">{audioExtOf(audioPathVal)}</span>{/if}
                                    <button class="rl-btn rl-link-act" disabled={!audioPathVal.trim() || audioRenaming} on:click={() => void renameAudioNow()} data-tip="改磁盘上的文件名（同名歌词文件一起改），并更新关联与笔记">重命名</button>
                                </div>
                                {#if audioRenameHint}<div class="rl-hint rl-hint-warn">{audioRenameHint}</div>{/if}
                                <!-- 🔴 #563：底部三枚按钮退场（同集浮层），改失焦自动保存 + 点遮罩关闭。
                                     ⚠️ 「重命名」那枚**留着** —— 它是一次**动磁盘**的显式动作，不是「保存」。 -->
                            </div>
                        {/if}
                    </div>
                    <!-- 🔴 #685 在线曲库候选卡（壳与列表**复用 B站 那套**：`.rl-ep-edit.rl-bili-pop` +
                         `.rl-bili-list/-row/-cover/-main/-name/-artist/-pill`）—— ⛔ 不另写第二套候选列表样式。
                         ⚠️ 它是**独立浮层**（与音频编辑浮层平级、DOM 更靠后 ⇒ 盖在上层）：音乐侧主表单
                         没有网络地址输入框，只有这里能回填。 -->
                    {#if songUrlOpen}
                        <div class="rl-ep-edit rl-bili-pop" role="dialog" aria-labelledby="rl-song-pop-title">
                            <div class="rl-lrc-pop-head">
                                <span class="rl-ep-edit-title" id="rl-song-pop-title">在线曲库检索</span>
                                <button class="rl-lrc-pop-close" on:click={() => (songUrlOpen = false)} data-tip="关闭">✕</button>
                            </div>
                            <div class="rl-ep-edit-row">
                                <input
                                    class="rl-input rl-ep-edit-input"
                                    value={songUrlQuery}
                                    on:input={(ev) => (songUrlQuery = inputVal(ev))}
                                    on:keydown={(ev) => { if (ev.key === 'Enter') void runSongUrlSearch(); }}
                                    placeholder="歌名（可补歌手，如 孤勇者 陈奕迅）" />
                                <button class="rl-btn rl-link-act" disabled={songUrlBusy} on:click={() => void runSongUrlSearch()}>
                                    {songUrlBusy ? '搜索中…' : '搜索'}
                                </button>
                            </div>
                            {#if songUrlErr}<div class="rl-hint rl-hint-warn">{songUrlErr}</div>{/if}
                            <div class="rl-bili-list">
                                {#each songUrlCands as c (c.url)}
                                    <button
                                        class="rl-bili-row"
                                        disabled={songUrlBusy}
                                        on:click={() => pickSongUrl(c)}
                                        data-tip={`填入网络地址：${c.title}`}>
                                        {#if c.coverUrl}
                                            <img class="rl-bili-cover" src={c.coverUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
                                        {:else}
                                            <span class="rl-bili-cover rl-bili-cover-ph"><Icon icon="music" size={14} /></span>
                                        {/if}
                                        <span class="rl-bili-main">
                                            <span class="rl-bili-name">{c.title}</span>
                                            <span class="rl-bili-artist">{c.sub || '未知歌手'}</span>
                                        </span>
                                        <span class="rl-bili-pill">♪</span>
                                    </button>
                                {/each}
                            </div>
                            {#if !songUrlBusy && !songUrlErr && songUrlCands.length === 0 && songUrlQuery.trim()}
                                <div class="rl-hint">没搜到，换个歌名试试</div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/if}

            {#if type === 'book'}
                <div>
                    <!-- 🔴 #523：标签统一「路径」。旁边按用户裁定**只挂「检索本地」那一枚**
                         （「下载只保留音乐」⇒ 书籍那枚 `download` 与它要的两个 prop 一并撤除；⚠️ 下载实现本体
                         与两条命令面板入口保留 —— 门控真源 `pure/featureGate` 里那条清单已同步改写）。
                         ⚠️ 被删那两个 prop 的全名**刻意不写**：注释会进产物，抄了会撞红反向守卫（老坑）。
                     原「检索库内同名书籍」🔍 住在书籍文件浮层标题行，已按「关联浮窗内小图标按钮都不再显示」
                         搬到这里。
                         🔴 #602（用户：「书籍关联入口这个小图标按钮怎么是**选文件夹**关联的，统一成检索关联」）：
                         这枚的**行为**换了 —— 由「先弹系统目录选择器」改成**直接检索**设置里的分类目录
                         （与影视那枚单集本地检索同一条链），⛔ 提示语里再也别提「先选一个文件夹」。 -->
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">启动路径</label>
                        <!-- 🔴 #531（用户：「检索在线书籍阅读小图标按钮放在**启动路径标题旁边**，不再另增框」）：
                             从原来单独那行「网络地址」搬来，与「检索本地书籍」并排；⛔ 主表单不再另开输入框
                             （链接改为在右键「启动路径」浮层里查看/编辑）。
                             🔴 #532（用户：「书籍检索本地和网络的小图标按钮怎么一样啊」）：两枚**必须不同图标**。
                             🔴 #533（用户：「全类型条目内的『启动路径』下面的小图标按钮按照语义统一」）—— 全仓口径：
                             **本地检索 = `folder-search`**（音乐「检索本地音频」/ 书籍「检索本地书籍」/ 影视「从文件夹检索剧集」三处一致）、
                             **网络检索 = `globe`**（书籍「检索在线书籍阅读」/ 影视浮层「在 B 站搜索这一集」）、
                             **批量网络检索（B站 视频）= `list-video`**（影视「批量搜索未填集」）、**下载 = `download`**（音乐，非检索语义）。
                             ⛔ 别再给同语义的按钮挂不同图标（`search` / `book-search` 那两款已全部退场）。
                             🔴 #534（用户：「全类型…统一…」＋追问后裁定「统一为『本地在前』」）：**顺序固定为「本地检索 → 网络检索」**
                             —— 本行原先是在线在前，本批按裁定调换（各类型两枚的先后一律本地在前）。 -->
                        <button
                            class="rl-ai-btn"
                            on:click={findLibraryBook}
                            data-tip={`检索本地：在设置里对应的分类目录（文学 / 网文 / 漫画）里按标题递归找同名${bookFmtName}（${bookFmtExts}）`}>
                            <span class="rl-sr">检索本地书籍</span>
                            <Icon icon="folder-search" size={13} />
                        </button>
                        <!-- 🔴 #535（用户：「除文学搜的是微信读书，其他网文搜的改成主流小说平台…漫画搜的是漫画在线阅读平台」
                             → 追问后用户点定「网文 / 漫画**暂不做在线检索**」）：
                             那枚在线检索只在**文学（含缺省）**态出现；网文 / 漫画靠右键「网络地址」手填或粘贴。
                             ⚠️ 源与子分类的绑定关系见 `openReadUrlPicker` 那条守卫（两处口径必须一致）。 -->
                        {#if bookKind === 'book'}
                            <button
                                class="rl-ai-btn"
                                on:click={() => void openReadUrlPicker()}
                                data-tip="检索在线书籍阅读（微信读书）\n按书名搜到在线阅读页，选一条填入（在右键「启动路径」里可改）">
                                <span class="rl-sr">检索在线书籍阅读</span>
                                <Icon icon="globe" size={13} />
                            </button>
                        {/if}
                    </div>
                    <div class="rl-ep-row">
                        <!-- 🔴 #532（用户：「填写了网络链接这个阅读按钮不高亮」）：高亮门控原先只看 `bookFileVal`
                             ⇒ **只填了在线阅读链接**时按钮仍呈灰态，看着像「没关联」。现改成「本地**或**网络」任一有值即高亮
                             （与左键行为同口径 —— 无本地就开网络地址）。 -->
                        <span class="rl-ep-wrap" class:linked={!!bookFileVal.trim() || !!readUrl.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={watchBook}
                                on:contextmenu={(ev) => { ev.preventDefault(); openBookEditor(); }}
                                data-tip={bookFileVal.trim()
                                    ? `打开阅读器：${bookFileVal}\n右键编辑/浏览更换`
                                    : readUrl.trim()
                                      ? `打开在线阅读：${readUrl}\n右键编辑/更换链接`
                                      : '未关联本地文件 / 网络地址 — 右键「阅读」选本地文件，或点「检索在线书籍阅读」'}>
                                <Icon icon="book-open" size={11} /> 阅读
                            </button>
                        </span>
                        {#if bookEditOpen}
                            <!-- 书籍文件编辑浮层（参照集按钮浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={closeBookEditor}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-book">
                                <!-- 🔴 #523：标题统一「路径（…）」（括号里的格式说明保留）。
                                     那枚「检索库内同名书籍」🔍（#500⑥ 挪到「文件路径」标签旁的）已按用户裁定
                                     「关联浮窗内小图标按钮都不再显示」**撤除**，功能搬到表单「路径」标签旁
                                     （`findLibraryBook`）。 -->
                                <!-- 🔴 #539：标题的格式说明**按子分类分叉**（用户报障：「漫画怎么是启动路径（TXT/EPUB/PDF)」）
                                     —— 漫画 = 图片文件夹 / 压缩包，文学·网文 = TXT/EPUB/PDF；文案真源 = 上面那三个 `bookFmt*`。 -->
                                <div class="rl-ep-edit-title" id="rl-ep-title-book">启动路径（{bookFmtTitle}）</div>
                                <!-- 🔴 #583：就地提示与集/游戏/音乐浮层同款（`.rl-edit-lblrow` + `.rl-saved-hint`）。
                                     ⚠️ 失焦处必须是箭头函数：把函数名直接交给 `on:blur` 会把事件对象当 `force` 传下去。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline">文件路径</label>
                                    {#if savedKey === AUTOSAVE_KEYS.bookPath}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input
                                        class="rl-input rl-ep-edit-input"
                                        value={bookFileVal}
                                        on:input={(ev) => (bookFileVal = inputVal(ev))}
                                        on:blur={() => autoSaveBook('path')}
                                        placeholder={bookKind === 'comic'
                                            ? '文件夹路径（图片序列），或 .cbz / .cbt / .zip / .tar / .pdf / .epub 文件'
                                            : '库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）'} />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseBookFile(ev)} data-tip={`选择${bookFmtName}文件（${bookFmtExts}）`}>浏览</button>
                                    <!-- 🔴 #539：**漫画专属**的「选文件夹」—— 「散装文件夹型」要把**文件夹本身**关联成书。
                                         ⛔ 不能靠「浏览」那枚同时选目录：Electron 在 Windows/Linux 上只能二选一
                                         （实测会退化成只能选文件 ⇒ 用户报障「漫画关联不了图片文件夹」）。 -->
                                    {#if bookKind === 'comic'}
                                        <button class="rl-btn rl-link-act" on:click={() => void browseBookFolder()} data-tip="选择图片文件夹（散装图片序列型漫画）">选文件夹</button>
                                    {/if}
                                </div>
                                <!-- 🔴 #531：**在线阅读链接**收进本浮层（用户：「不再另增框」）—— 主表单只留标签行那枚检索图标。
                                     ⚠️ label 带 `for`/`id`：本仓新 label ⛔ 不许裸写（会多报一条 A11y 告警破 89 基线）。 -->
                                <!-- 🔴 #535（用户报障：「没有粘贴文字按钮」＋「占位提示客观点」）：
                                     ⑴ 补一枚「粘贴」（与游戏「网络路径」/ 影视集「网络地址」**同款同位**）；
                                     ⑵ 占位提示改**中性** —— 原先写「如微信读书网页版」，而检索源按子分类分流后
                                        （文学走微信读书、网文/漫画暂不接在线源，靠手填）那句既不准确也不客观。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline" for="rl-f-readurl">网络地址</label>
                                    <!-- 🔴 2026-10-21 二轮（用户：「条目…网络地址**标题旁没有**『在线网络搜索
                                         回填链接』的小图标按钮啊」）——「网络地址」这一行也挂一枚在线检索。
                                         图标与语义沿用 #533 全仓口径：**网络检索 = `globe`**（⛔ 别用 `search` / `book-search`，
                                         那两款已退场）；行为与表单「启动路径」那枚**同一条链**（`openReadUrlPicker`），
                                         ⛔ 不另写一套候选浮层。
                                         ⚠️ 门控 `bookKind === 'book'` 的原因见 #535：在线源只有微信读书且只对文学开
                                            （网文 / 漫画用户裁定「暂不做在线检索」，靠手填 / 粘贴），
                                            而 `openReadUrlPicker` 里那两条守卫必须与这里同口径。
                                         ⚠️ 已知与 #531 有重叠：那轮把同一枚按钮搬到了表单「启动路径」标签行。
                                            本轮用户要求「网络地址标题旁」也要有 ⇒ 两处并存。
                                            ⛔ 若要收敛成一处，删**这一处**会把用户刚提的诉求删掉；删「启动路径」
                                               那一处又违背 #531 —— 需用户裁定，别自行挑一个删。 -->
                                    {#if bookKind === 'book'}
                                        <button
                                            class="rl-ai-btn"
                                            on:click={() => void openReadUrlPicker()}
                                            data-tip="检索在线书籍阅读（微信读书）\n按书名搜到在线阅读页，选一条填入下面这栏">
                                            <span class="rl-sr">检索在线书籍阅读</span>
                                            <Icon icon="globe" size={13} />
                                        </button>
                                    {/if}
                                    {#if savedKey === AUTOSAVE_KEYS.bookUrl}
                                        {#key savedSeq}
                                            <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                        {/key}
                                    {/if}
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input
                                        id="rl-f-readurl"
                                        class="rl-input rl-ep-edit-input"
                                        bind:value={readUrl}
                                        on:blur={() => autoSaveBook('url')}
                                        placeholder="在线阅读链接（http/https）" />
                                    <button class="rl-btn rl-link-act" on:click={() => void pasteReadUrl()} data-tip="粘贴在线阅读链接">粘贴</button>
                                </div>
                                <!-- 🔴 #563：底部三枚按钮退场（同集浮层），改失焦自动保存 + 点遮罩关闭 -->
                            </div>
                        {/if}
                    </div>
                </div>
                <!-- #529 / #531 候选浮层：触发按钮已按用户指令搬到上面「启动路径」标签行，
                     这里只留浮层本体（⛔ 主表单不再另开「网络地址」输入框 —— 链接在右键浮层里改）。
                     ⛔ 只回填链接，不下载、不解析正文。 -->
                {#if readUrlOpen}
                        <!-- 候选浮层：壳与列表**复用 B站 那套**（`.rl-ep-edit.rl-bili-pop` + `.rl-bili-list/-row`）
                             —— 同为「封面 + 名称 + 副标题 + 右侧胶囊」的候选列表，⛔ 不另写第二套。
                             ⚠️ 封面是**竖版**（书），靠样式表里那条 `.rl-wr-pop` 前缀规则覆写尺寸。 -->
                        <div class="rl-ep-edit rl-bili-pop rl-wr-pop" role="dialog" aria-labelledby="rl-wr-pop-title">
                            <div class="rl-lrc-pop-head">
                                <span class="rl-ep-edit-title" id="rl-wr-pop-title">检索在线书籍阅读</span>
                                <button class="rl-lrc-pop-close" on:click={() => (readUrlOpen = false)} data-tip="关闭">✕</button>
                            </div>
                            <div class="rl-ep-edit-row">
                                <input
                                    class="rl-input rl-ep-edit-input"
                                    value={readUrlQuery}
                                    on:input={(ev) => (readUrlQuery = inputVal(ev))}
                                    on:keydown={(ev) => { if (ev.key === 'Enter') void runReadUrlSearch(); }}
                                    placeholder="书名（可补作者，如 三体 刘慈欣）" />
                                <button class="rl-btn rl-link-act" disabled={readUrlBusy} on:click={() => void runReadUrlSearch()}>
                                    {readUrlBusy ? '搜索中…' : '搜索'}
                                </button>
                            </div>
                            {#if readUrlErr}<div class="rl-hint rl-hint-warn">{readUrlErr}</div>{/if}
                            <div class="rl-bili-list">
                                {#each readUrlBooks as bk (bk.readUrl)}
                                    <button
                                        class="rl-bili-row"
                                        disabled={readUrlBusy}
                                        on:click={() => pickReadUrl(bk)}
                                        data-tip={`填入阅读链接：${bk.title}`}>
                                        <!-- `referrerpolicy="no-referrer"`：图床常按 Referer 防盗链（Obsidian 内 Referer 恒为 app://） -->
                                        {#if bk.coverUrl}
                                            <img class="rl-bili-cover" src={bk.coverUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
                                        {:else}
                                            <span class="rl-bili-cover rl-bili-cover-ph"><Icon icon="book-open" size={14} /></span>
                                        {/if}
                                        <span class="rl-bili-main">
                                            <span class="rl-bili-name">{bk.title}</span>
                                            <span class="rl-bili-artist">{bk.author || bk.publisher || '未知作者'}</span>
                                        </span>
                                        <span class="rl-bili-pill">{bk.rating !== undefined ? `${bk.rating}★` : '—'}</span>
                                    </button>
                                {/each}
                            </div>
                            {#if !readUrlBusy && !readUrlErr && readUrlBooks.length === 0 && readUrlQuery.trim()}
                                <div class="rl-hint">没搜到，换个书名试试</div>
                            {/if}
                        </div>
                    {/if}
            {/if}

            <!-- 观看链接（网络 + 本地合一）：电影 = 单集 ▶ 观看按钮（左键播放/打开第 1 集，右键编辑关联）；
                 剧集/动画 = 1..N 集小按钮（左键播放/打开、右键编辑本地或网络），支持「从文件夹检索剧集…」批量按文件名集号填入 -->
            {#if type === 'movie' || type === 'tv' || type === 'anime'}
                <div>
                    <div class="rl-lbl-row">
                        <!-- 🔴 #523：标签统一「路径」（原「观看链接」）；小图标 = 检索本地（+ 该类型自己的第二枚）。 -->
                        <label class="rl-lbl">启动路径</label>
                        <!-- 🔴 #521：**电影也挂这两枚**（用户：「电影条目观看链接也把这两个按钮移上来」
                             ——⛔ 原来这两枚被 `type !== 'movie'` 挡掉了）。
                             🔴 #534（用户：「电影两枚（本地和网络），剧集/动画两枚（本地和批量网络）还有右键单集网络检索」）：
                             ⇒ 第二枚**按类型分叉** —— 电影 = `globe`（网络检索，整片只有一个链接位，点开除第 0 集浮层+候选）；
                                剧集/动画 = `list-video`（批量搜未填集；单集检索仍在集编辑浮层里，别搬走）。
                             ⛔ 顺序固定「本地在前」（与书籍/音乐一致）。 -->
                        <!-- 本地检索：选文件夹 → 识别文件名集号自动填入未关联集本地路径（已填跳过） -->
                        <button
                            class="rl-ai-btn"
                            data-tip={'选文件夹批量填集（按文件名认集号补标题）\n已填的不覆盖'}
                            on:click={() => void batchScanLocalEps()}><Icon icon="folder-search" size={13} /><span class="rl-sr">从文件夹检索剧集</span></button>
                        {#if type === 'movie'}
                            <!-- 🔴 #534 电影的网络检索：复用**集内那套**（开第 0 集浮层 + B 站候选），⛔ 不另写检索逻辑 -->
                            <button
                                class="rl-ai-btn"
                                data-tip={'检索网络：在 B 站搜这部片，选一条把链接填进来'}
                                on:click={() => void searchMovieOnline()}><Icon icon="globe" size={13} /><span class="rl-sr">检索网络</span></button>
                        {:else}
                            <!-- 🔴 #520：批量搜 B站 **紧挨着「从文件夹检索剧集」**（用户：「小图标按钮是放在观看
                                 链接的检索本地剧集图标按钮的旁边」）。 -->
                            <button
                                class="rl-ai-btn"
                                data-tip="批量搜索未填的集（可选集数区间，搜完给一张确认表）"
                                on:click={openBiliBatch}><Icon icon="list-video" size={13} /><span class="rl-sr">批量搜索未填集</span></button>
                        {/if}
                        <!-- 🔴 #531：原在**本行**的「检测失效链接」按钮已按用户指令**撤除**，改成
                             「设置 › 基本设置 › 封面与清理 › 失效链接检测」一键扫**全库**；
                             本表单只负责**显示**结果（`linkStatuses` 由 EntryModal 从宿主内存缓存注入）⇒
                             ⛔ 这里别再挂检测入口（同款功能两处 = 用户会以为两个功能）。 -->
                    </div>
                    {#if type === 'movie' || Number(totalEpisodes) > 0}
                        <!-- 🔴 2026-10-23 用户：「填 1000 集会一次性铺开 1000 行，滚动困难」⇒ 按**每 10 行**分区、
                             分区标题**吸顶**（随滚动始终可见）。
                             · 每区集数 = 实测列数 × 10（140 行处见 `epPerSection`），⛔ 不写死 130；
                             · 标题用 `position: sticky; top` —— 吸的是**表单滚动容器**（`.rl-fields`），
                               不是窗口 ⇒ 分区滚到头上时标题自动贴住容器顶边；
                             · 电影态只有一个按钮，⛔ 不套分区（套了会出现一条「第 1 集」标题，纯噪音）。 -->
                        <div class="rl-ep-grid" use:watchEpGrid>
                            {#if type === 'movie'}
                                <span class="rl-ep-wrap" class:linked={!!episodeFiles[0] || !!episodeUrls[0]}>
                                    <button
                                        class="rl-ep-btn rl-ep-btn-book"
                                        class:rl-ep-dead={linkStatuses[0] === 'dead'}
                                        on:click={() => playOrOpenEpisode(0)}
                                        on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(0); }}
                                        data-tip={epLinkHint(type, 0, episodeTitles[0], !!episodeFiles[0] || !!episodeUrls[0]) + deadHint(0)}><Icon icon="play" size={12} /> 观看</button>
                                </span>
                            {:else}
                                <!-- 🔴 2026-10-25 用户：「分区应该按选项卡切换而不是平铺」⇒ 顶部选项卡 + 单选一区。
                                     · 选项卡文案直接用 `sec.label`（「第 1-130 集」），点哪块显示哪块；
                                     · 只渲染 `epCurSec` 一区 —— 1000 集时 DOM 从 8 块降到 1 块，
                                       切换是纯 class 切换，⛔ 不要再退回「全铺 + 横向滚动」那套。 -->
                                {#if epSecs.length > 1}
                                    <div class="rl-ep-tabs" role="tablist" aria-label="集号分区">
                                        {#each epSecs as sec, si (sec.start)}
                                            <button
                                                type="button"
                                                role="tab"
                                                aria-selected={si === epTab}
                                                class="rl-chip rl-ep-tab"
                                                class:on={si === epTab}
                                                data-tip={`显示 ${sec.label}（点「上一区/下一区」或直接点这排切区）`}
                                                on:click={() => (epTab = si)}>{sec.label}</button>
                                        {/each}
                                    </div>
                                {/if}
                                {#if epCurSec}
                                    {@const sec = epCurSec}
                                    <div class="rl-ep-sec">
                                        <div class="rl-ep-sec-grid">
                                            {#each Array.from({ length: sec.end - sec.start + 1 }, (_, k) => sec.start - 1 + k) as i (i)}
                                                <span class="rl-ep-wrap" class:linked={!!episodeFiles[i] || !!episodeUrls[i]} class:cur-ep={episode >= 1 && i + 1 === episode}>
                                                    <button
                                                        class="rl-ep-btn"
                                                        class:rl-ep-dead={linkStatuses[i] === 'dead'}
                                                        on:click={() => playOrOpenEpisode(i)}
                                                        on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(i); }}
                                                        data-tip={epLinkHint(type, i, episodeTitles[i], !!episodeFiles[i] || !!episodeUrls[i]) + deadHint(i)}><span class="rl-ep-num">{i + 1}<span class="rl-ep-dot"></span></span></button>
                                                </span>
                                            {/each}
                                        </div>
                                    </div>
                                    <!-- 翻区：长列表用鼠标滚轮翻区会被表单滚动抢走，给两枚显式按钮（首/尾区自动 disabled） -->
                                    {#if epSecs.length > 1}
                                        <div class="rl-ep-tab-nav">
                                            <button
                                                type="button"
                                                class="rl-chip"
                                                disabled={epTab <= 0}
                                                data-tip="上一区"
                                                on:click={() => (epTab = clampEpTab(epTab - 1, epSecs.length))}>‹ 上一区</button>
                                            <span class="rl-ep-tab-count">{epTab + 1} / {epSecs.length}</span>
                                            <button
                                                type="button"
                                                class="rl-chip"
                                                disabled={epTab >= epSecs.length - 1}
                                                data-tip="下一区"
                                                on:click={() => (epTab = clampEpTab(epTab + 1, epSecs.length))}>下一区 ›</button>
                                        </div>
                                    {/if}
                                {/if}
                            {/if}
                        </div>
                    {:else}
                        <div class="rl-hint">填总集数后可逐集关联；或点标题旁「检索文件夹」图标按文件名集号自动填入</div>
                    {/if}
                </div>
                {#if editEp !== null}
                    <!-- 集编辑浮层（EntryForm 内自绘，不需 Obsidian App）：填写标题 / 本地路径 / 网络地址；电影态标题为「编辑观看链接」、文案无集数 -->
                    <div class="rl-ep-edit-mask" on:click={closeEpEditor}></div>
                    <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-ep">
                        <div class="rl-ep-edit-title" id="rl-ep-title-ep">{type === 'movie' ? '编辑观看链接' : '编辑第 ' + (editEp + 1) + ' 集'}</div>
                        <!-- 🔴 #568：标题行也包进 `.rl-edit-lblrow`（与下面两行同款「标签 → 控件」间距），
                             并在标签旁挂这枚**就地**轻提示（用户：「显示在浮层弹窗内…标题旁，而不是窗口外」）。 -->
                        <div class="rl-edit-lblrow">
                            <label class="rl-lbl-inline">{type === 'movie' ? '标题' : '集标题'}</label>
                            {#if savedKey === AUTOSAVE_KEYS.epTitle}
                                {#key savedSeq}
                                    <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                {/key}
                            {/if}
                        </div>
                        <input
                            class="rl-input rl-ep-edit-input"
                            value={editTitle}
                            on:input={(ev) => (editTitle = inputVal(ev))}
                            on:blur={() => autoSaveEp('title')}
                            placeholder="如：开始" />
                        <!-- 🔴 #501②（用户：「『网络地址』旁那枚 B站 改成小图标搜索、放在网络地址**标题**旁边平行
                             （像文件夹检索剧集按钮那样）」）：从**输入框行**里挪出来、贴到**标签行**，且收成
                             **纯图标** —— `.rl-edit-lblrow` + `.rl-ai-btn`，与「检索库内同名书籍」（⑥）、
                             「从文件夹检索剧集」**同款同位同手感**。
                             ⛔ 别在下面那行再留一枚（同款入口两处 = 用户会以为两个功能）；
                             ⛔ 也别写成带文字按钮（本仓小图标统一的形态就是这个）。
                             · 检索词初值 = 作品标题 + 集标题；**集标题为空时补「第N集」**（#517；每次打开都按
                               当前集重算，⛔ 别缓存成「空才算」）；
                             · **点一条把链接填进下面那个框**（与「粘贴」同一条纪律：仍要点「保存」才写回条目）；
                             · ⛔ 浮层内**一条滚动条**：本体沿用 `.rl-ep-edit`（fixed 居中卡片，自身不带滚动），
                               只有列表那块内部滚动。 -->
                        <!-- 🔴 #525（用户 2026-10-04 二轮裁定）：这枚「在 B 站搜这一集」小图标**恢复**。
                             #523 曾按「关联浮窗内小图标按钮都不再显示」把它撤掉、把单集检索合并到
                             批量卡行内那枚「单集」；但批量卡的待搜目标只认**未填集**
                             （`buildBatchTargets` → `unfilledEpIndexes`）⇒ **已填链接的集压根搜不了** ——
                             用户原话：「这个按钮只能批量不能单集当前集检索怎么办」。
                             ⇒ 恢复成**编辑这一集时的直接入口**，调用的就是批量卡那枚用的**同一个**
                               `openEpBiliPicker`（⛔ 搜索本体一份，别在这里另写检索逻辑）。
                             形态沿用 #501②：`.rl-edit-lblrow` + `.rl-ai-btn` + `.rl-sr`，与
                             「从文件夹检索剧集」「批量搜索未填集」同款同位同手感。
                             ⛔ 别在下面输入框行再留一枚（同款入口两处 = 用户会以为两个功能）。 -->
                        <!-- 🔴 #536（用户：「电影类型条目右键浮层把网络检索小图标按钮去掉，仅保留编辑条目启动路径旁的两枚按钮，
                             但剧集/动画类型条目右键浮层单集网络小图标按钮不去掉」）：
                             电影**只有一个链接位**、且行内已有「检索网络」（#534 那枚，锚第 0 集）⇒ 浮层里这枚是重复入口。
                             ⚠️ 只包**按钮**，`网络地址` 的 label + 下面那行「粘贴」照旧（电影仍要能手填 / 粘贴）。
                             🔴 判别力在 `type !== 'movie'`（⛔ 别写成 `=== 'tv' || === 'anime'`：
                             将来若新增别的剧集类型，这里会漏掉那一种）。
                             ⚠️ 这段说明**必须留在容器外**：写进 `.rl-edit-lblrow` 里会把「label → 按钮」之间的
                             判据窗口撑到几百字符（#536 首版就这么假红了一次）。 -->
                        <div class="rl-edit-lblrow">
                            <label class="rl-lbl-inline">网络地址</label>
                            {#if type !== 'movie'}
                                <button
                                    class="rl-ai-btn"
                                    data-tip="在 B 站搜这一集，点候选把链接填进来"
                                    on:click={() => void openEpBiliPicker()}>
                                    <span class="rl-sr">在 B 站搜索这一集</span>
                                    <Icon icon="globe" size={13} />
                                </button>
                            {/if}
                            <!-- 🔴 #568：就地轻提示挂**本行标签旁**（⚠️ 必须在按钮**之后** —— 那个「label 紧邻按钮」
                                 的既有判据窗口只有 260 字符，塞在中间会把它顶出去）。 -->
                            {#if savedKey === AUTOSAVE_KEYS.epUrl}
                                {#key savedSeq}
                                    <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                {/key}
                            {/if}
                        </div>
                        <div class="rl-ep-edit-row">
                            <input class="rl-input rl-ep-edit-input" value={editUrl} on:input={(ev) => (editUrl = inputVal(ev))} on:blur={() => autoSaveEp('url')} placeholder="https://…" />
                            <button class="rl-btn rl-link-act" on:click={() => void pasteEpUrl()} data-tip="粘贴链接">粘贴</button>
                        </div>
                        <!-- 🔴 #563 字段顺序按用户给定排定：**集标题 → 网络地址 → 本地路径**（本地路径殿后）＋
                             「本地路径」标签**右侧**加一枚与「网络地址」同款同尺寸的小图标（单集本地检索）。
                             ⚠️ 这段说明**留在容器外**（同 #536）：写进 `.rl-edit-lblrow` 里会把
                                「label → 按钮」之间的判据窗口撑到几百字符。
                             🔴 检索根目录来自**设置页的分类目录**（`pure/localDirs`：剧集/动画/电影各一份），
                                ⛔ 不是让用户每次现挑 —— 那是上面「从文件夹检索剧集」那条批量入口的语义。 -->
                        <div class="rl-edit-lblrow">
                            <label class="rl-lbl-inline">本地路径</label>
                            <button
                                class="rl-ai-btn"
                                disabled={epLocalBusy}
                                data-tip="检索本地：按设置页的分类目录递归找当前集"
                                on:click={() => void searchLocalEpisodeNow()}>
                                <span class="rl-sr">单集本地检索</span>
                                {#if epLocalBusy}
                                    <span class="rl-spinner"></span>
                                {:else}
                                    <Icon icon="folder-search" size={13} />
                                {/if}
                            </button>
                            <!-- 🔴 #568：就地轻提示挂**本行标签旁**（⚠️ 同样必须在按钮之后 —— 见上面网络地址那行的说明）。 -->
                            {#if savedKey === AUTOSAVE_KEYS.epLocal}
                                {#key savedSeq}
                                    <span class="rl-saved-hint" class:rl-saved-hint-bad={savedBad} role="status" aria-live="polite">{savedBad ? TOAST_FAILED : TOAST_SAVED}</span>
                                {/key}
                            {/if}
                        </div>
                        <div class="rl-ep-edit-row">
                            <input class="rl-input rl-ep-edit-input" value={editLocal} on:input={(ev) => (editLocal = inputVal(ev))} on:blur={() => autoSaveEp('local')} placeholder="库内路径，或系统绝对路径" />
                            <button class="rl-btn rl-link-act" on:click={(ev) => browseLocalVideo(ev)} data-tip="选择本地视频">浏览</button>
                        </div>
                        {#if epBiliOpen}
                            <div class="rl-ep-edit rl-bili-pop" role="dialog" aria-labelledby="rl-bili-pop-title">
                                <div class="rl-lrc-pop-head">
                                    <span class="rl-ep-edit-title" id="rl-bili-pop-title">
                                        {epBiliView === 'parts' ? '选择分P' : '搜索 B 站'}
                                    </span>
                                    <button class="rl-lrc-pop-close" on:click={() => (epBiliOpen = false)} data-tip="关闭">✕</button>
                                </div>
                                {#if epBiliView === 'search'}
                                    <div class="rl-ep-edit-row">
                                        <input
                                            class="rl-input rl-ep-edit-input"
                                            value={epBiliQuery}
                                            on:input={(ev) => (epBiliQuery = inputVal(ev))}
                                            on:keydown={(ev) => { if (ev.key === 'Enter') void runEpBiliSearch(); }}
                                            placeholder="检索词（作品标题 + 集标题，缺则补第N集）" />
                                        <button class="rl-btn rl-link-act" disabled={epBiliBusy || epBiliPartsBusy} on:click={() => void runEpBiliSearch()}>
                                            {epBiliBusy ? '搜索中…' : '搜索'}
                                        </button>
                                    </div>
                                    {#if epBiliErr}<div class="rl-hint rl-hint-warn">{epBiliErr}</div>{/if}
                                    {#if epBiliPartsBusy}<div class="rl-hint">正在读取分P…</div>{/if}
                                    <div class="rl-bili-list">
                                        {#each epBiliVideos as v (v.bvid)}
                                            <!-- 🔴 #505 入口 C：点候选**不再直接填入**，而是展开它的分P 让用户勾
                                                 （搜索接口不给分P 数 ⇒ 单P / 52P 只能点开才知道；
                                                  读不到分P 时组件内部回落到「直接填这一条」，见 `pickEpBiliUrl`）。 -->
                                            <button
                                                class="rl-bili-row"
                                                disabled={epBiliPartsBusy}
                                                on:click={() => void pickEpBiliUrl(v)}
                                                data-tip={`展开分P：${v.title}`}>
                                                <!-- ⚠️ `referrerpolicy="no-referrer"` 是必需的：B站图床按 Referer 防盗链
                                                     （Obsidian 内 `<img>` 的 Referer 恒是它 ⇒ 不加就是一片灰底占位）。 -->
                                                {#if v.coverUrl}
                                                    <img class="rl-bili-cover" src={v.coverUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
                                                {:else}
                                                    <span class="rl-bili-cover rl-bili-cover-ph"><Icon icon="video" size={14} /></span>
                                                {/if}
                                                <span class="rl-bili-main">
                                                    <span class="rl-bili-name">{v.title}</span>
                                                    <span class="rl-bili-artist">{v.author || '未知 UP 主'}</span>
                                                </span>
                                                <span class="rl-bili-pill">{formatDuration(v.durationSec) || '—'}</span>
                                            </button>
                                        {/each}
                                    </div>
                                    {#if !epBiliBusy && !epBiliPartsBusy && !epBiliErr && epBiliVideos.length === 0 && epBiliQuery.trim()}
                                        <div class="rl-hint">没搜到，换个检索词试试</div>
                                    {/if}
                                {:else}
                                    <!-- ── 分P 勾选表（入口 C 的正题）──────────────────────────
                                         🔴 对齐口径 = **按位置**（第 i 个分P ↔ 第 i 集），每行都写出目标集号 ⇒
                                            错位一眼可见；⛔ 不从分P 标题里抠集号（各家格式不同，抠错会静默填错集）。
                                         🔴 **已填过链接的集默认不勾**（用户裁定「弹勾选让我选」）——
                                            既不静默跳过、也不静默覆盖；勾上 = 覆盖（行尾有「已有链接」标注）。 -->
                                    <div class="rl-ep-edit-row rl-bili-parts-bar">
                                        <button class="rl-btn rl-link-act" on:click={backToEpBiliSearch} data-tip="回到候选列表，换一条视频">‹ 候选</button>
                                        <span class="rl-bili-parts-src" data-tip={epBiliPickTitle || undefined}>{epBiliPickTitle || epBiliPickBvid}</span>
                                    </div>
                                    <div class="rl-ep-edit-row rl-bili-parts-bar">
                                        <label class="rl-bili-all">
                                            <input
                                                type="checkbox"
                                                checked={epBiliAllChecked}
                                                on:change={(ev) => toggleEpBiliAll(ev.currentTarget.checked)} />
                                            全选
                                        </label>
                                        <span class="rl-bili-parts-sum">
                                            共 {epBiliRows.length} 个分P · 已勾 <b>{epBiliPicked.length}</b> 集
                                            {#if epBiliRows.some((r) => r.hasUrl)}· 其中 {epBiliRows.filter((r) => r.hasUrl).length} 集已有链接{/if}
                                            {#if epBiliRows.some((r) => r.outOfRange)}· {epBiliRows.filter((r) => r.outOfRange).length} 个超出本条目集数{/if}
                                        </span>
                                    </div>
                                    <div class="rl-bili-parts-list">
                                        {#each epBiliRows as r (r.epIndex)}
                                            <label class="rl-bili-part-row" class:rl-bili-part-off={r.outOfRange}>
                                                <input
                                                    type="checkbox"
                                                    checked={r.checked}
                                                    disabled={r.outOfRange}
                                                    on:change={(ev) => toggleEpBiliRow(r.epIndex, ev.currentTarget.checked)} />
                                                <span class="rl-bili-part-ep">第 {r.epNo} 集</span>
                                                <span class="rl-bili-part-name" data-tip={r.part || undefined}>
                                                    <span class="rl-bili-part-no">P{r.page}</span>{r.part || '（未命名）'}
                                                </span>
                                                {#if r.hasUrl}<span class="rl-bili-pill rl-bili-pill-warn">已有链接</span>{/if}
                                                {#if r.outOfRange}<span class="rl-bili-pill">超出集数</span>{/if}
                                            </label>
                                        {/each}
                                    </div>
                                    <div class="rl-ep-edit-ops rl-bili-parts-ops">
                                        <button
                                            class="rl-btn"
                                            disabled={epBiliPicked.length === 0}
                                            on:click={applyEpBiliParts}
                                            data-tip="填进本表单的集链接（仍要点表单的「保存」才落库）">
                                            填入选中的 {epBiliPicked.length} 集
                                        </button>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                        <!-- 🔴 #563：底部「保存 / 清除 / 取消」三枚按钮**整体退场**（用户：「移除底部的保存、
                             清除、取消三个按钮…底部区域留空或适当缩减弹窗高度」）⇒ 改为**失焦自动保存** +
                             轻提示；关闭出口 = 点遮罩（`closeEpEditor` 会先提交再关，⛔ 别让它变成「改了直接丢」）。 -->
                    </div>
                {/if}
            {/if}
            {#if batchOpen}
                <!-- 🔴 #520：批量确认表 = **独立一张卡**（不再寄生在集编辑浮层里）。
                     🔴 入口挪到「观看链接」标签行那枚图标上（与「从文件夹检索剧集」并排）——
                        用户：「小图标按钮是放在观看链接的检索本地剧集图标按钮的旁边」。
                     🔴 进卡**不自动跑**：先选集数区间（用户裁定「选了才跑」），点了「搜索」才开始。
                     ⚠️ 关卡片 ⇒ 立刻停批（见 `closeBiliBatch`，⛔ 别让它在后台接着打几十个请求）。 -->
                <!-- ⚠️ 遮罩是**装饰性**的「点外面关闭」，不是可交互控件（与集编辑浮层那层同款）。
                     这里必须就地 `svelte-ignore`：多一层同样的遮罩会**多两条 a11y 警告**，
                     而那会打破「构建 89 warnings = 基线」这条门禁（⛔ 不是省事，是守住基线）。 -->
                <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                <div class="rl-ep-edit-mask" on:click={closeBiliBatch}></div>
                <div class="rl-ep-edit rl-bili-pop" role="dialog" aria-labelledby="rl-bili-batch-title">
                    <div class="rl-lrc-pop-head">
                        <span class="rl-ep-edit-title" id="rl-bili-batch-title">批量搜索未填集</span>
                        <button class="rl-lrc-pop-close" on:click={closeBiliBatch} data-tip="关闭">✕</button>
                    </div>
                    <!-- 集数区间：默认 = 未填集的第一个 ~ 最后一个；⛔ 不自动开跑。
                         🔴 #522：两个框挂 `rl-bili-batch-num`（那颗类名是宽度裁判的必需件 ——
                         光靠 `input.rl-input`(0,2,1) 压不住 scoped 的双 hash (0,3,0)，详见 styles.css）。 -->
                    <div class="rl-bili-batch-range">
                        <span class="rl-bili-batch-range-hint">集数区间</span>
                        <input class="rl-input rl-bili-batch-num" type="number" min="1" bind:value={batchFrom} />
                        <span class="rl-bili-batch-range-sep">–</span>
                        <input class="rl-input rl-bili-batch-num" type="number" min="1" bind:value={batchTo} />
                        <button
                            class="rl-bili-batch-btn is-primary"
                            disabled={batchRunning}
                            on:click={() => void startBiliBatch()}
                            data-tip="按这个区间搜**未填**的集（整表重来）">搜索</button>
                    </div>
                    <div class="rl-bili-batch-bar">
                        {#if batchRunning}
                            <div class="rl-bili-batch-note">{batchProgressText(batchDone, batchTotal, batchEpNo)}</div>
                            <button
                                class="rl-bili-batch-btn is-ghost"
                                data-tip="停下（已搜到的保留，可再点「继续」）"
                                on:click={() => (batchCancel = true)}>停止</button>
                        {:else if batchFinished}
                            <div class="rl-bili-batch-note">已搜完 {batchTotal} 集 · 勾选 {batchPickedCount} 集</div>
                        {:else if batchRows.length > 0}
                            <div class="rl-bili-batch-note" class:is-error={!!batchReason}>
                                {batchStopText(batchLastEpNo, batchReason)}
                            </div>
                            <button
                                class="rl-bili-batch-btn is-ghost"
                                data-tip={`从第 ${batchLastEpNo + 1} 集接着搜`}
                                on:click={() => void continueBiliBatch()}>继续</button>
                        {:else}
                            <div class="rl-bili-batch-note">
                                选好区间后点「搜索」——只会搜**还没关联**的集（共 {batchAllTargets.length} 个）
                            </div>
                        {/if}
                        <!-- 🔴 #542 与「搜索」互补的一枚：手里已经有合集链接时不必再替我搜一轮。
                             ⚠️ 它**常驻**（不随上面三态切换）—— 「我已经知道是哪一条」这件事与搜到哪一步无关。 -->
                        <button
                            class="rl-bili-batch-btn is-ghost"
                            disabled={batchRunning}
                            on:click={() => void pasteBiliBatchLink()}
                            data-tip="粘贴一条 B 站链接，按它的分P 顺序填未填的集">粘贴链接</button>
                    </div>
                    <div class="rl-bili-batch-list">
                        {#each batchRows as r, idx (r.epIndex)}
                            {@const v = pickedCandidate(r)}
                            {@const url = pickedUrl(r)}
                            <div class="rl-bili-batch-item">
                                <div class="rl-bili-batch-row" class:rl-bili-batch-off={!v}>
                                    <input
                                        type="checkbox"
                                        checked={r.checked}
                                        disabled={!url}
                                        data-tip={url
                                            ? (canExpandParts(r)
                                                ? '整季合集：直接勾上只会填第 1 集 —— 建议用「展开分P」'
                                                : '参与「填入」')
                                            : '这一集没有可填的链接'}
                                        on:change={(ev) => toggleEpBiliBatchRow(idx, ev.currentTarget.checked)} />
                                    <span class="rl-bili-batch-ep">第 {r.epNo} 集</span>
                                    <div class="rl-bili-batch-hit">
                                        {#if v}
                                            {#if v.coverUrl}
                                                <img
                                                    class="rl-bili-cover"
                                                    src={v.coverUrl}
                                                    alt=""
                                                    loading="lazy"
                                                    referrerpolicy="no-referrer" />
                                            {:else}
                                                <span class="rl-bili-cover rl-bili-cover-ph">
                                                    <Icon icon="video" size={14} />
                                                </span>
                                            {/if}
                                            <span class="rl-bili-main">
                                                <span class="rl-bili-batch-name">{v.title}</span>
                                                <span class="rl-bili-artist">{v.author || '未知 UP 主'}</span>
                                            </span>
                                            {#if partCountLabel(r.partCounts[v.bvid] ?? 0)}
                                                <span
                                                    class="rl-bili-batch-parts"
                                                    data-tip={(r.partCounts[v.bvid] ?? 0) === 1
                                                        ? '单集投稿（只有 1 个分P）'
                                                        : `整季合集（${r.partCounts[v.bvid]} 个分P）`}>
                                                    {partCountLabel(r.partCounts[v.bvid] ?? 0)}
                                                </span>
                                            {/if}
                                            <!-- 🔴 #520：标题不含作品名 ⇒ 不自动勾，并明说为什么 -->
                                            {#if !r.matched}
                                                <span class="rl-bili-batch-warn" data-tip="标题里没有本条目作品名，所以没替你勾上">
                                                    标题不含作品名
                                                </span>
                                            {/if}
                                        {:else}
                                            <div class="rl-bili-batch-note">
                                                {r.error || (batchRunning ? '…' : '未搜到')}
                                            </div>
                                        {/if}
                                    </div>
                                    {#if v}
                                        <!-- 🔴 #523：**单集检索**入口 —— 原「集编辑浮层 · 网络地址旁」那枚
                                             B站 图标按用户裁定撤除后，功能合并到这里（打开这一集的编辑浮层并直接开搜，
                                             在那里还能展开分P 勾选表一次填多集）。 -->
                                        <button
                                            class="rl-bili-batch-toggle"
                                            data-tip="打开这一集的编辑浮层并搜 B站（可选分P 一次填多集）"
                                            on:click={() => void openEpBiliFromBatch(idx)}>单集</button>
                                    {/if}
                                    {#if canExpandParts(r)}
                                        <!-- 🔴 #526：**整季合集专用** —— 直接把这条候选的分P 勾选表开出来
                                             （锚 = 第 1 集）。批量「填入」对多P 候选只会写 P1（= 第 1 集），
                                             所以多P 行**默认不勾**，要走这枚入口一次填整季。 -->
                                        <button
                                            class="rl-bili-batch-toggle is-parts"
                                            data-tip="这条是整季合集：展开分P 勾选表，一次填多集（分P i ↔ 第 i 集）"
                                            on:click={() => void expandBatchCandParts(idx)}>展开分P</button>
                                    {/if}
                                    {#if r.videos.length > 1}
                                        <button
                                            class="rl-bili-batch-toggle"
                                            data-tip={`这一集搜到 ${r.videos.length} 条候选`}
                                            on:click={() => void toggleEpBiliBatchCands(idx)}>
                                            {batchOpenRow === idx ? '收起' : '换一条'}
                                        </button>
                                    {/if}
                                </div>
                                {#if batchOpenRow === idx}
                                    <div class="rl-bili-batch-cands">
                                        {#each r.videos as cv, ci (cv.bvid)}
                                            <button
                                                class="rl-bili-batch-cand"
                                                class:is-cur={ci === r.picked}
                                                data-tip={ci === r.picked ? '当前选中' : '换成这一条'}
                                                on:click={() => void pickEpBiliBatchCand(idx, ci)}>
                                                {#if cv.coverUrl}
                                                    <img
                                                        class="rl-bili-cover"
                                                        src={cv.coverUrl}
                                                        alt=""
                                                        loading="lazy"
                                                        referrerpolicy="no-referrer" />
                                                {:else}
                                                    <span class="rl-bili-cover rl-bili-cover-ph">
                                                        <Icon icon="video" size={14} />
                                                    </span>
                                                {/if}
                                                <span class="rl-bili-main">
                                                    <span class="rl-bili-batch-name">{cv.title}</span>
                                                    <span class="rl-bili-artist">{cv.author || '未知 UP 主'}</span>
                                                </span>
                                                {#if partCountLabel(r.partCounts[cv.bvid] ?? 0)}
                                                    <span class="rl-bili-batch-parts">
                                                        {partCountLabel(r.partCounts[cv.bvid] ?? 0)}
                                                    </span>
                                                {/if}
                                                <!-- 🔴 #589：「换一条」列表里**每一条**都标出「标题是否含作品名」——
                                                     原来只有「当前选中」那条标（`.rl-bili-batch-warn`），
                                                     用户在候选里挑的时候看不见别的条到底匹不匹配。 -->
                                                {#if !titleMatchesWork(cv.title, r.workTitle)}
                                                    <span
                                                        class="rl-bili-batch-warn"
                                                        data-tip="标题里没有本条目作品名，勾上它多半不是这一集">
                                                        不含作品名
                                                    </span>
                                                {/if}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                    <div class="rl-ep-edit-ops rl-bili-batch-ops">
                        <button
                            class="rl-bili-batch-btn is-primary"
                            disabled={!batchCanFill}
                            on:click={applyEpBiliBatchFill}
                            data-tip="只填进本表单的集链接（仍要点表单的「保存」才落库）">
                            填入勾中的 {batchPickedCount} 集
                        </button>
                    </div>
                </div>
            {/if}
            <!-- 个人状态与评价——标题左移对齐"作品基础信息"首字（弹窗最左）；内容仍与"简介"label 同列 -->
            <div class="rl-section rl-section-left">个人状态与评价</div>
            <div class="rl-status-row rl-status-lg">
                <span class="rl-status-chips">
                    <span class="rl-lbl-inline">{statusVerb(type)}状态</span>
                    {#each STATUS_OPTIONS as s}
                        <button class:on={status === s} class="rl-chip" on:click={() => (status = s)}>
                            {statusLabel(type, s)}
                        </button>
                    {/each}
                </span>
                {#if status === 'want'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">计划{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={plannedDate} />
                    </span>
                {:else if status === 'watching'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">最近{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={lastWatchedDate} data-tip="追番活跃度基准：≤3 天活跃、≤7 天待看" />
                    </span>
                {:else if status === 'watched'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={watchedDate} />
                    </span>
                {/if}
            </div>
            <label class="rl-lbl">个人评分</label>
            <!-- #619 半星（用户 2026-10-13）：每颗星分**左右两半** —— 左 = 半星、右 = 整星；
                 数值按 **10 分制**显示（`9/10` ⟷ `4.5 星`），点它切成输入框；
                 滚轮在星上增减并阻止页面滚动。半星用**伪元素裁切左半**渲染（⛔ 不用 U+2BE8 字符：字体覆盖不稳）。 -->
            <div class="rl-stars-input" on:wheel={onStarWheel}>
                {#each [1, 2, 3, 4, 5] as n}
                    <span
                        class="rl-star"
                        class:on={n <= rating}
                        class:half={n - 0.5 === rating}
                        role="button"
                        tabindex="0"
                        aria-label={`${n - 0.5} 星`}
                        on:click={(ev) => onStarClick(ev, n)}
                        on:keydown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setStar(n, false); }
                        }}>★</span>
                {/each}
                {#if ratingEditing}
                    <input
                        class="rl-stars-num"
                        type="number"
                        step="1"
                        min="0"
                        max="10"
                        bind:this={ratingInputEl}
                        value={ratingToTenths(rating)}
                        on:input={(ev) => { rating = tenthsToRating(Number(ev.currentTarget.value)); }}
                        on:blur={(ev) => commitRatingEdit(ev.currentTarget.value)}
                        on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitRatingEdit(ev.currentTarget.value); } }}
                        aria-label="个人评分（10 分制）" />
                    <span class="rl-stars-suffix">/10</span>
                {:else}
                    <button class="rl-stars-val" on:click={startRatingEdit}>{rating ? `${ratingToTenths(rating)}/10` : '未评分'}</button>
                {/if}
            </div>
            <label class="rl-lbl">个人评语</label>
            <!-- #452：占位符改成一句**全类型统一**的引导语（用户给的字面形态，三个半角点，⛔ 别改成 `…`）——
                 旧口径是按类型拼「写下你的观后感/读后感/游玩体验/收听感受…」（`reviewLabel`），已随之退场。 -->
            <textarea class="rl-input rl-notes" rows="3" placeholder="在这里用一句话概括你的核心感受或者情绪记录..." bind:value={notes}></textarea>

    
                </div><!-- /rl-fields-col -->
            </div><!-- /rl-basic-grid -->
        </div><!-- /rl-fields -->
    {/if}

    <div class="rl-fft">
        <div class="rl-fft-left">
            {#if entry}
                <button class="rl-btn rl-btn-danger" on:click={onDelete}>删除条目</button>
                <button class="rl-btn rl-btn-accent" on:click={startRefetch} data-tip="按标题重搜，回填客观字段">重新拉取</button>
                <!-- 🔴 #685：表单底栏与右键菜单**同一套动作口径**（⛔ 别再留「记录游玩」这个游戏专属词）。
                     摘抄 = 文学 / 网文（⛔ 漫画走「添加短评」）；时长 = 文学 / 网文 / 漫画 / 音乐 / 游戏；周目 = 游戏。 -->
                {#if entry.type === 'book' && bookKind !== 'comic'}
                    <button class="rl-btn rl-btn-accent" on:click={onAddExcerpt} data-tip="粘贴文本生成摘抄">添加摘抄</button>
                {/if}
                {#if entry.type === 'book' || entry.type === 'music' || entry.type === 'game'}
                    <button class="rl-btn rl-btn-accent" on:click={() => onOpenEntryLogModal('time')} data-tip="记一次时长（日期 + 时长 + 心得）">记录时长</button>
                {/if}
                {#if entry.type === 'game'}
                    <button class="rl-btn rl-btn-accent" on:click={() => onOpenEntryLogModal('playthrough')} data-tip="记一次周目（第几周目 + 感想）">记录周目</button>
                {/if}
            {/if}
        </div>
        <div class="rl-fft-right">
            {#if picked}
                <button class="rl-btn rl-btn-primary" disabled={!title.trim()} on:click={submitSafe}>{submitLabel(entry === null)}</button>
            {/if}
        </div>
    </div>
</div>

<style>
    .rl-form {
        font-size: 13px;
        height: 100%; display: flex; flex-direction: column;
        min-height: 0;
    }
    /* 头部与滚动内容区（flex 布局让底部操作栏固定在弹窗底部，内容滚动时完全遮住背后信息） */
    .rl-fhd { flex: none; }
    .rl-frow { flex: none; }
    .rl-fhd { font-weight: 600; font-size: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: baseline; }
    .rl-fsrc { font-size: 11px; color: var(--text-faint); font-weight: 400; }
    .rl-frow { display: flex; gap: 8px; align-items: center; }
    /* 组合输入框：类型下拉（左 Label）+ 输入框（右），共享边框与圆角 */
    .rl-searchbox { display: flex; align-items: stretch; flex: 1; min-width: 0; border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px); background: var(--background-primary); overflow: hidden; }
    .rl-searchbox:focus-within { border-color: var(--interactive-accent); }
    .rl-search-type { border: none; background: transparent; color: var(--text-muted); font-size: 12px; padding: 5px 8px; cursor: pointer; flex: none; border-right: 1px solid var(--background-modifier-border); }
    /* 类型下拉展开的选项列表：原生 option 不继承主题变量，暗黑模式下默认白底蓝字——显式设主题色（亮/暗自适应） */
    .rl-search-type option { background: var(--background-secondary); color: var(--text-normal); }
    .rl-search-input { border: none; background: transparent; color: var(--text-normal); font-size: 12px; padding: 5px 9px; flex: 1; min-width: 0; }
    .rl-search-input:focus { outline: none; }
    .rl-input { font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px); padding: 5px 9px; width: 100%; }
    /* 🔴 #500② 可拖高加的多行框（当前只有「主演 / 主演（声优）」一处在用）。
       · 默认高度 = 与 `.rl-input`（input）**同高**：两者都**不钉高度**，让高度由同一套行高 + 内距 +
         边框算出来（实测都是 **28px**）。⚠️ 本条曾栽过一次：先写了 `height: var(--input-height, 30px)`
         + `line-height: 18px` ⇒ textarea 量到 30px、input 28px ⇒ **同列字段行位错开 2px**。
         `rows="1"` 在两处都能当兜底（真不一致时也不至于塌成一行半）。
       · ⛔ **不钉 `min-height`**：钉了就会像上面那样强行把高度顶开（`--input-height` 是 30 而实际是 28）。
       · `resize: vertical`：**只能拖高**（拖宽会破同列对齐）；滚动条交给浏览器默认样式。 */
    .rl-multi { display: block; resize: vertical; }
    .rl-input:focus { outline: none; border-color: var(--interactive-accent); }
    .rl-btn-danger { color: var(--rl-danger, var(--text-error)); border-color: var(--rl-danger, var(--text-error)); background: var(--background-primary); font-weight: 600; }
    .rl-btn-danger:hover { background: var(--rl-danger-strong, var(--text-error)); border-color: var(--rl-danger-strong, var(--text-error)); color: #fff; }
    /* 次级强调按钮（重新拉取 / 添加摘抄 / 记录游玩）：与「删除条目」同款描边语义，颜色走主题色 ——
       中性不透明底 + accent 字 + accent 描边；hover 反色（accent 底 + on-accent 字，与危险按钮「红底白字」同构）。
       2026-09-12 的「恒实底 accent」裁定 → 09-15 先降为中性 → 同日再定为「accent 描边」；三处按钮统一用 .rl-btn-accent。 */
    .rl-btn-accent { background: var(--background-primary); border-color: var(--interactive-accent); color: var(--interactive-accent); font-weight: 600; }
    .rl-hint { font-size: 11px; color: var(--text-faint); margin-top: 6px; }
    .rl-err { font-size: 11px; color: var(--text-error); margin-top: 6px; }
    /* ── 搜索进度条（朴素版：无流光/脉冲/淡出等网页式动效，符合 Obsidian 插件观感） ── */
    .rl-progress { position: relative; height: 6px; background: var(--background-modifier-border); border-radius: 4px; overflow: hidden; margin-top: 10px; }
    /* 填充：纯色 + 平滑宽度过渡
       🔴 #559：过渡从 .3s 收到 **.12s** —— 用户口径是「API 返回那一刻**100ms 内**瞬间拉满 100%」。
       ⚠️ 平时爬升靠 50ms tick 逐帧改 width，短过渡才不会把「蠕动」的节奏拖平。 */
    .rl-progress-fill {
        height: 100%; border-radius: 4px;
        background: var(--interactive-accent);
        transition: width .12s ease;
    }
    /* 🔴 #559 完成冲刺：整条**淡出**（160ms 后由组件卸载）。只加 `opacity` 一条过渡。 */
    .rl-progress.is-done { opacity: 0; transition: opacity .16s ease; }
    .rl-progress-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5px; font-size: 11px; color: var(--text-faint); }
    .rl-progress-label { color: var(--text-muted); min-width: 0; }
    .rl-progress-eta { color: var(--text-faint); }
    /* 🔴 #571 右端组：**按钮在百分比左边**、两者一起贴右缘 ——
       有了它，本行永远只有「左标签 / 右端组」两个孩子，`space-between` 再没有中间孩子可顶，
       ⇒ 8s 后按钮上屏时百分比**不会**被隔到正中间（用户截图里的那个症状）。 */
    .rl-progress-tail { display: inline-flex; align-items: baseline; gap: 8px; flex: none; }
    /* 🔴 #559「中止重试」（8s 未返回才出现）：小号幽灵按钮，跟在百分比左侧（右端组内）。
       ⚠️ 两级选择器 + 显式 `height: auto`：核心给所有 `button` 按死 `var(--input-height)`。
       ⚠️ 间距交给 `.rl-progress-tail` 的 `gap`（⛔ 别在这里再写 `margin-left`，会双份）。 */
    .rl-progress-meta .rl-prog-retry {
        font-family: inherit; font-size: 11px; height: auto; line-height: 1.2;
        padding: 2px 8px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: transparent; box-shadow: none; color: var(--text-muted); cursor: pointer;
        transition: color .15s ease, border-color .15s ease;
    }
    .rl-progress-meta .rl-prog-retry:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    /* 逐源进度行：每源一个小标签，先返回的标记为已完成（主题色），未完成灰态 */
    .rl-prog-srcs { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 2px 0 6px; }
    .rl-prog-src { font-size: 11px; color: var(--text-faint); border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-pill, 999px); padding: 1px 9px; line-height: 18px; white-space: nowrap; user-select: none; }
    .rl-prog-src-ok { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-prog-src-bad { color: var(--text-error); border-color: var(--text-error); }
    .rl-res-head { display: flex; align-items: baseline; gap: 10px; margin: 8px 0 10px; }
    .rl-res-head-cnt { font-size: 12px; font-weight: 700; color: var(--text-normal); }
    .rl-res-head-cnt::before { content: ''; display: inline-block; width: 3px; height: 12px; border-radius: 2px; background: var(--interactive-accent); margin-right: 7px; vertical-align: -2px; }
    .rl-res-head-hint { font-size: 10px; color: var(--text-faint); }
    /* 单列横排卡片：左侧小封面 + 右侧信息列（标题 + 年份/评分/原名紧凑排布 + 来源徽标右上角） */
    /* 结果多栏 grid：列数 = 当前栏数（固定占栏），1~3 栏显式排布不再 auto-fit 猜——避免窄窗下栏位换行堆叠 */
    .rl-res { margin-top: 4px; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 4px 4px 0; max-height: 52vh; display: grid; grid-template-columns: repeat(var(--rl-cols, 1), minmax(0, 1fr)); gap: 10px 12px; align-items: start; }
    .rl-res-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px); padding: 4px 6px 6px; background: var(--background-secondary); }
    .rl-res-col-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border); user-select: none; }
    .rl-res-col-name { font-size: 12px; font-weight: 600; color: var(--text-normal); flex: none; display: inline-flex; align-items: center; gap: 6px; }
    .rl-res-col-name::before { content: ''; display: inline-block; width: 3px; height: 12px; border-radius: 2px; background: var(--interactive-accent); flex: none; }
    .rl-res-col-cnt { font-size: 10px; color: var(--text-muted); background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px); padding: 0 6px; line-height: 16px; flex: none; margin-left: auto; }
    .rl-res-col-empty { font-size: 11px; color: var(--text-faint); border: 1px dashed var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px); padding: 12px 8px; text-align: center; line-height: 1.5; user-select: none; }
    .rl-res-item { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; font-family: inherit; font-size: 12px; border: 1px solid transparent; background: var(--background-primary); border-radius: var(--rl-t-radius-lg, 8px); padding: 6px 10px; cursor: pointer; color: var(--text-normal); line-height: 1.4; transition: background-color .12s, border-color .12s; }
    .rl-res-item:hover { background: var(--background-modifier-hover); border-color: var(--background-modifier-border-hover, var(--background-modifier-border)); }
    .rl-res-item:focus-visible { outline: none; border-color: var(--interactive-accent); }
    /* 封面：48×72 px 缩略图（2:3 海报比例，object-fit: contain 完整显示不裁切；横图/方图上下留背景色） */
    .rl-res-cv { width: 48px; height: 72px; border-radius: 4px; flex: none; display: block; object-fit: contain; background-color: var(--background-secondary); overflow: hidden; }
    .rl-res-ph { display: flex; align-items: center; justify-content: center; background: var(--background-secondary); }
    .rl-res-ico { font-size: 16px; opacity: .7; }
    .rl-res-inf { flex: 1; min-width: 0; display: flex; gap: 10px; align-items: center; padding-right: 4px; }
    .rl-res-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
    .rl-res-row1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
    /* 🔴 #632 连续添加：已经建成条目的候选**压暗 + 标「已添加」**——
       点它仍可再建一条（同名不同版本是合法需求，⛔ 这里只做提示不做拦截）。 */
    .rl-res-item.is-added { opacity: .55; }
    .rl-res-added { flex: none; font-size: 10px; line-height: 15px; padding: 0 5px; color: var(--interactive-accent); border: 1px solid currentColor; border-radius: var(--rl-t-radius-sm, 4px); }
    .rl-res-t { font-weight: 600; font-size: 14px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .rl-res-row2 { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--text-normal); min-width: 0; }
    .rl-res-yr { color: var(--text-muted); flex: none; }
    .rl-res-score { color: var(--rl-score); font-weight: 700; flex: none; }
    .rl-res-o { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
    .rl-res-dot { color: var(--text-faint); flex: none; }
    .rl-res-source { font-size: 10px; color: var(--text-faint); flex: none; cursor: pointer; white-space: nowrap; font-weight: 500; user-select: none; padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; line-height: 1.5; }
    .rl-res-source:hover, .rl-res-source:focus-visible { color: var(--interactive-accent); outline: none; }
    .rl-fields { margin-top: 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    .rl-lbl { display: block; font-size: 11px; color: var(--text-muted); margin: 9px 0 4px; font-weight: 600; }
    /* 豆瓣评分评价人数小字（「8.5 分 · 123456人评价」） */
    .rl-rate-cnt { font-size: 11px; color: var(--text-faint); margin-top: 4px; }
    /* 补充信息区（默认展开）：顶部小标题分隔，字段 2 列紧凑排版，无折叠/无虚线边框 */
    .rl-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
    /* 当前进度（#440）：**一个数字框**（与「总集数」同宽同款）。原来的「S / E 前缀 + 两个 64px 窄框」
       + 一条从没被用上的小字提示规则已整体退场（配反向守卫）。
       🔴 ⛔ 本注释**故意不写那四个已退场的类名** —— 产物不剥注释，写了就是**自撞反向守卫**
          （本仓为此栽过四次）。要说明「退场了什么」，只描述形态与用途。 */
    .rl-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 10px; }
    .rl-readbar { height: 5px; background: var(--background-modifier-border); border-radius: var(--rl-t-radius-sm, 3px); overflow: hidden; margin-top: 6px; }
    .rl-readbar-fill { height: 100%; background: var(--rl-good-bar); border-radius: var(--rl-t-radius-sm, 3px); transition: background-color .2s; }
    /* 进度条分阶段色阶：起步 / 进行中 / 接近完成 / 读完（四档均走主题变量） */
    .rl-readbar-low .rl-readbar-fill { background: var(--rl-danger-soft); }      /* <30% 警告红 */
    .rl-readbar-mid .rl-readbar-fill { background: var(--rl-score); }      /* 30-69% 进行中 琥珀 */
    .rl-readbar-high .rl-readbar-fill { background: var(--rl-good-soft); } /* 70-99% 接近完成 绿 */
    .rl-readbar-done .rl-readbar-fill { background: var(--rl-good-bar); }      /* 100% 读完 深绿 */
    .rl-hint-warn { color: var(--rl-danger); font-weight: 600; }
    /* 分区标题 */
    .rl-section {
        font-size: 12px; font-weight: 700; color: var(--text-normal);
        margin: 16px 0 10px; padding: 4px 0 5px;
        border-bottom: 1px solid var(--background-modifier-border); /* 仅一条线（章节标题下方），与上方"作品基础信息"下线对齐 */
    }
    .rl-section:first-child { margin-top: 4px; }
    /* 章节标题左移对齐"作品基础信息"首字（弹窗最左）：负 margin 抵消 cover 列宽(100px)+gap(12px) */
    .rl-section-left { margin-left: -112px; }
    /* 基础信息两列布局：左封面边栏 + 右字段区 */
    .rl-basic-grid { display: grid; grid-template-columns: 100px 1fr; gap: 12px; align-items: stretch; margin-bottom: 4px; }
    .rl-fields-col { min-width: 0; }
    /* 封面区：拖放上传 / 右键菜单更换（默认小尺寸，紧凑不占头部；虚线边框 = 拖拽视觉引导） */
    .rl-poster-col { position: relative; display: flex; flex-direction: column; }
    /* 章节标题绝对定位在 cover 列底部（不依赖 grid stretch/flex auto）——与"作品基础信息"同列对齐 cover 列最左 */
    .rl-section-cover-bottom { position: absolute; bottom: 0; left: 0; right: 0; margin-top: 0 !important; }
    .rl-poster-zone {
        width: 100px; height: 140px; border: 1.5px dashed var(--background-modifier-border-hover);
        border-radius: var(--rl-t-radius-md, 6px); display: flex; align-items: center; justify-content: center;
        cursor: pointer; overflow: hidden; background: var(--background-secondary);
        transition: border-color .15s, background-color .15s;
    }
    .rl-poster-zone:hover { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .rl-poster-zone.on { border-style: solid; }
    .rl-poster-ph { font-size: 10.5px; color: var(--text-faint); text-align: center; padding: 8px; line-height: 1.5; }
    .rl-poster-preview { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rl-poster-hint { font-size: 10px; color: var(--text-faint); text-align: center; margin-top: 6px; line-height: 1.5; }
    /* 日期输入框：日历图标固定右侧作为点击触发器（WebKit indicator 默认位置受主题影响） */
    input[type="date"] { position: relative; padding-right: 26px; }
    input[type="date"]::-webkit-calendar-picker-indicator {
        position: absolute; right: 6px; left: auto; margin: 0; cursor: pointer; opacity: .65;
    }
    input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 1; }
    /* 右键菜单（与 MediaList 卡片右键风格一致）；视口过矮/过窄时内联 max-height/max-width 生效 → 内部滚动 */
    .rl-ctx {
        position: fixed; z-index: 1000; min-width: 140px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: 0 4px 14px rgba(0, 0, 0, .18); padding: 4px;
        display: flex; flex-direction: column;
        overflow: auto; overscroll-behavior: contain;
    }
    .rl-ctx button {
        font-family: inherit; font-size: 12px; text-align: left;
        background: transparent; border: none; color: var(--text-normal);
        padding: 5px 10px; border-radius: 5px; cursor: pointer;
    }
    .rl-ctx button:hover { background: var(--background-modifier-hover); }
    .rl-ctx-danger { color: var(--rl-danger-strong); }
    .rl-ctx-danger:hover { background: rgba(192, 73, 63, .14); }
    .rl-ctx-url { display: flex; flex-direction: column; gap: 4px; padding: 4px; }
    .rl-ctx-url .rl-input { font-size: 11px; padding: 3px 6px; }
    .rl-ctx-url .rl-btn { font-size: 11px; padding: 3px 8px; }
    .rl-hidden { display: none; }
    /* 大尺寸状态胶囊 */
    .rl-status-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    /* 状态按钮组（左）+ 日期（右，并排） */
    .rl-status-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .rl-status-date { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .rl-status-date input[type="date"] { width: auto; min-width: 150px; }
    .rl-lbl-inline { font-size: 11px; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
    /* 标题行 + 来源徽标（书名/标题右侧并排，点击跳数据源页） */
    .rl-title-row { display: flex; gap: 6px; align-items: center; }
    .rl-title-row .rl-input { flex: 1; min-width: 0; }
    /* ────── #499 AI 预填预览（标题行 ✨ 点开后展开的轻卡）──────
       🔴 它是**行内卡片**、不是弹窗：颜色全走主题变量；⛔ 不用阴影 / 渐变（仓库 UI 铁律）。
       ⚠️ `.rl-prefill-old` 的删除线只标「将被替换的原值」（语义在组件注释里写死，⛔ 别改成「不采用」）。 */
    .rl-prefill {
        margin-top: 6px; padding: 8px 10px; flex: none;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-secondary);
    }
    .rl-prefill-head { font-size: 11px; color: var(--text-faint); margin-bottom: 6px; }
    /* #499D 依据：与头部同一行的**右端**（用户扫一眼就知道这次是查过还是凭记忆） */
    .rl-prefill-src { margin-left: 6px; color: var(--text-muted); }
    /* #499D 工具进度行（「搜索网络：…」）：转圈 + 一句话，与预览卡同一层外观、但更矮 */
    .rl-prefill-wait { display: flex; align-items: center; gap: 6px; }
    .rl-prefill-step { font-size: 11px; color: var(--text-muted); word-break: break-all; }
    .rl-prefill-list { margin: 0 0 8px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .rl-prefill-row { display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 1.5; }
    /* 字段名列定宽：多行值（简介 / 目录）折行时仍与首行文字对齐 */
    .rl-prefill-lbl { flex: none; width: 76px; color: var(--text-muted); }
    .rl-prefill-vals { flex: 1; min-width: 0; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    /* 旧值：删除线 + 弱化色 —— 「这一栏原来有值，将被替换」 */
    .rl-prefill-old { color: var(--text-faint); text-decoration: line-through; word-break: break-word; }
    /* 原本就是空的：占位文案（⛔ 不加删除线 —— 它不是「将被替换」而是「白捡一个值」） */
    .rl-prefill-none { color: var(--text-faint); }
    .rl-prefill-arrow { flex: none; color: var(--text-faint); }
    /* AI 给的值：灰色（用户裁定的观感），多行值原样换行显示 */
    .rl-prefill-new { color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
    .rl-prefill-ops { display: flex; gap: 6px; align-items: center; }

    /* 总结摘要：小标题右侧 ✨ 小图标（尺寸对齐「从文件夹检索剧集」：20×18 命中区 / 13px 图标）
       🔴 #406：这组规则**已上移成全局**（`styles.css` 的 `.rl-ai-btn`）——
       快捷关联弹窗（`QuickAssociateModal`，非 Svelte 组件）也要用**同款**按钮，而 Svelte 的
       scoped 样式带哈希类名 ⇒ 那边拿不到样式（按钮会变成没样式的裸元素）。
       ⛔ 别在这里再写一份：两份必然漂（一处改了另一处没改 = 两种「同款」按钮）。 */
    /* 纯图标按钮的读屏名（隐藏文本，避免 aria-label 与 data-tip 双气泡） */
    .rl-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    /* AI 摘要（单框合并：第 1 行总结 + 其余行看点） */
    .rl-ai-hl { resize: vertical; min-height: 4.6em; line-height: 1.5; }
    /* 进度页数：两个 input 中间 - 分隔（紧凑）。
       🔴 #409：「重新解析」小按钮已挪到上面的标签行、并改用共用的 `.rl-ai-btn`
       （原来是这里的 `.rl-prog-refresh`：22×22 + 描边 + hover 灰字）。⛔ 别再加回来。 */
    .rl-prog-range { display: flex; align-items: center; gap: 6px; }
    .rl-prog-input { flex: 1; min-width: 0; text-align: center; }
    .rl-prog-dash { font-size: 14px; color: var(--text-faint); font-weight: 600; flex: none; }
    /* ② 来源 / 大众评分 / 评价人数 / 平台链接 那一行（标题行下方）—— 两态共用同一个壳：
       新增态是输入框、编辑态（右键解锁后）也是输入框；**编辑态未解锁时**只读展示在标题行内
       （`.rl-ro-meta` 那一簇，见上面）。标签用弱化小字，
       评分盒定宽（4 字符足够）、链接盒吃掉剩余宽度（变窄时优先挤它，不挤评分）
       ⚠️ `.rl-title-score`（标题旁那颗「★ 8.3 · 28598人评价」）**在** —— 它是 #499E 二轮修正
          回到标题行内的那一簇的一部分（⛔ 别再撤一次：用户上手后明确要求「渲染回原来的样式」）。 */
    /* #430 这一行从「两个框」变成「三个框 + 预览徽标」⇒ 允许**换行**：
       宁可预览徽标掉到第二行，也⛔ 别把三个输入框挤成三条缝（窄面板下必然发生）。 */
    .rl-meta-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
    .rl-meta-lbl { flex: none; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    /* 来源（#430）：定宽，⛔ 别吃 flex（会把平台链接挤瘦） */
    .rl-meta-sn { flex: none; width: 84px; }
    /* 大众评分：放得下 `7 | 500` 这种一气呵成的写法（#431 的占位）⇒ 由 88 → 96px；
       一个分数本身最多 4 个字符（`10.0`），多出来的宽度是给「评分 | 人数」那个形态的 */
    .rl-meta-cs { flex: none; width: 96px; }
    /* 评价人数（#431）：定宽，放得下「如 500」与千分位（`12,345`） */
    .rl-meta-rc { flex: none; width: 84px; }
    .rl-meta-row .rl-input:not(.rl-meta-cs):not(.rl-meta-sn):not(.rl-meta-rc) { flex: 1; min-width: 96px; }
    /* #385 平台名 + 评分★ 预览：顺序与海报墙封面角标一致（来源名在前、数值暖黄 700 + 后缀星在后）。
       ⛔ 不铺底色（2026-09-14 口径：并排的切换 / 链接类悬停只让文字变色）；⛔ 不搬角标那层深色胶囊
       —— 表单是浅底，深色胶囊在这里会很沉；对齐的是「顺序 + 两段配色 + 后缀星」这层口径。
       间距走 `margin-right: 4px`（与角标同款），⛔ 不在模板里写空格文本节点。 */
    .rl-meta-badge { flex: none; display: inline-flex; align-items: center; font-size: 12px; white-space: nowrap; }
    .rl-meta-row .rl-meta-src {
        flex: none; margin-right: 4px; padding: 0; border: none; box-shadow: none;
        background: transparent; height: auto; line-height: normal;
        font-size: 12px; font-weight: 600; color: var(--link-color); cursor: pointer;
    }
    .rl-meta-row .rl-meta-src:hover { text-decoration: underline; }
    .rl-meta-num { color: var(--rl-score); font-weight: 700; }
    /* 🔴 #499E（二轮修正）编辑态的**只读簇**——回到**标题行内**（用户：「在标题框旁而不是另起一行」）。
       它是标题行里的一个 flex 项（`flex: none`），里面是原来那两枚（★ 评分·人数 / 来源名 ↗）。
       ① 整簇 `cursor: context-menu`：右键是解锁编辑的入口，光标形态要把它说出来；
       ② `white-space: nowrap` 交给里面的 `.rl-title-score`（⛔ 别让「★ 8.3 · 28598人评价」折成两行）。 */
    .rl-ro-meta { flex: none; display: inline-flex; align-items: center; gap: 6px; cursor: context-menu; }
    /* 大众评分 / 人数（只读，搜索 / 详情回填后显示） */
    .rl-title-score { font-size: 12px; font-weight: 600; color: var(--rl-score); white-space: nowrap; flex: none; }
    /* 「来源 / 评分未填」那颗是**提示**不是数值 —— 别用评分那种暖黄（那会读成「已经有分了」） */
    .rl-ro-meta .rl-ro-empty { color: var(--text-muted); font-weight: 400; }
    .rl-src-link {
        flex: none; font-size: 11px; color: var(--text-faint); background: transparent;
        border: 1px solid var(--background-modifier-border); border-radius: 5px;
        padding: 3px 8px; cursor: pointer; white-space: nowrap; font-family: inherit;
    }
    .rl-src-link:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-status-lg .rl-chip { font-size: 13px; padding: 7px 18px; }
    .rl-chip { font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-pill, 999px); padding: 3px 12px; cursor: pointer; }
    .rl-chip.on { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    /* 类型/题材标签 chips（原格式：灰底胶囊，无 # 前缀） */
    .rl-tagbox { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px); padding: 5px 7px; background: var(--background-primary); }
    .rl-tagbox:focus-within { border-color: var(--interactive-accent); }
    .rl-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; background: var(--background-modifier-hover); border-radius: var(--rl-t-radius-pill, 999px); padding: 2px 8px; color: var(--text-normal); }
    .rl-tag-x { border: none; background: transparent; color: var(--text-faint); cursor: pointer; font-size: 10px; padding: 0 2px; line-height: 1; }
    .rl-tag-x:hover { color: var(--rl-danger); }
    .rl-tag-input { flex: 1; min-width: 90px; border: none; background: transparent; color: var(--text-normal); font-size: 12px; font-family: inherit; padding: 2px 4px; }
    .rl-tag-input:focus { outline: none; }
    .rl-tag-input::placeholder { color: var(--text-faint); }
    /* #619 半星：容器用 flex + gap（⛔ 不用 letter-spacing —— 星宽必须精确，
       否则 `::before` 的 50% 裁切会有偏差）。 */
    .rl-stars-input { display: flex; align-items: center; gap: 2px; font-size: 20px; color: var(--rl-score-input); }
    /* 每颗星：默认淡色（未选）；`.on` 满星；`.half` 用伪元素裁切**左半边**画半星 */
    .rl-star { position: relative; display: inline-block; cursor: pointer; }
    .rl-star.on { color: var(--rl-score); }
    .rl-star.half { color: var(--rl-score-input); }
    .rl-star.half::before {
        content: '★'; position: absolute; left: 0; top: 0;
        width: 50%; overflow: hidden; color: var(--rl-score);
    }
    .rl-star:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; border-radius: 3px; }
    /* 数值：点它切输入框（10 分制）。
       🔴 它是 `<button>` ⇒ 必须压掉核心那条 `button:not(.clickable-icon)` 的灰底：
          scoped 类 + 元素选择器 (0,2,1) 够用，但**框四件**（background/border/box-shadow/color）要齐。 */
    .rl-stars-val {
        margin-left: 8px; padding: 0 4px; font-size: 11px; font-family: inherit;
        background: transparent; border: none; box-shadow: none; color: var(--text-muted);
        cursor: pointer;
    }
    .rl-stars-val:hover { color: var(--text-normal); }
    .rl-stars-num { margin-left: 8px; width: 52px; font-size: 12px; }
    .rl-stars-suffix { margin-left: 2px; font-size: 11px; color: var(--text-muted); }
    .rl-link-row { display: flex; gap: 6px; margin-top: 5px; }
    .rl-link-label { width: 110px; flex: none; }
    /* 观看链接行操作按钮（浏览/播放/打开/复制/清除）：小图标紧凑样式，hover 高亮 */
    .rl-link-act { padding: 2px 8px; flex: none; font-size: 12px; line-height: 1.4; }
    .rl-link-act:hover:not(:disabled) { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-link-act:disabled { opacity: .4; cursor: not-allowed; }
    /* 观看链接区块：1..N 集按钮网格，左键播放/打开、右键编辑；本地绿点 / 网络蓝点双角标 */
    .rl-ep-grid { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    /* 🔴 2026-10-23：**每 10 行一个分区**（用户填 1000 集时不再一口气铺 1000 行）。
       · 分区标题 `sticky`：吸的是**表单滚动容器** `.rl-fields`（`overflow-y: auto`）的顶边
         —— 分区滚过容器顶时标题自动停住，直到本区滚完被下一区顶走（"吸顶或随滚动可见"两种读法都覆盖）。
       · 标题必须**不透明**：底色取自表单底（`--background-primary`），否则吸顶时下面的集按钮会透出来。
       · padding 上下各 4px = 标题与按钮之间的呼吸位；⛔ 改 `top` 时要与 `.rl-fields` 的 padding 对齐
         （容器顶就是 `top: 0`，无需偏移）。 */
    .rl-ep-sec { display: flex; flex-direction: column; gap: 6px; }
    /* 🔴 2026-10-25：分区改**选项卡切换**（用户：「分区应该按选项卡切换而不是平铺」）。
       · `.rl-ep-tabs` = 一排可横滚的胶囊（沿用全局 `.rl-chip` / `.rl-chip.on` 配色，⛔ 别另起一套皮肤）；
       · 集数多时选项卡本身会超宽 ⇒ 横向滚动，不换行（换行会把表单顶下去两行）；
       · 原 `.rl-ep-sec-hd`（吸顶标题）随平铺一起退场 —— 现在一次只显示一区，没有"滚过去了要贴住"的场景。 */
    .rl-ep-tabs {
        display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
        padding-bottom: 2px; margin-top: 2px;
        scrollbar-width: thin;
    }
    .rl-ep-tabs::-webkit-scrollbar { height: 4px; }
    .rl-ep-tabs::-webkit-scrollbar-thumb { background: var(--background-modifier-border); border-radius: 2px; }
    .rl-ep-tab { flex: none; white-space: nowrap; }
    /* 翻区行：上一区 / 计数 / 下一区 居中；禁用态压暗（⛔ 不用 display:none —— 会跳位） */
    .rl-ep-tab-nav { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 2px; }
    .rl-ep-tab-nav .rl-chip:disabled { opacity: .45; cursor: default; }
    .rl-ep-tab-count { font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
    .rl-ep-sec-grid { display: flex; flex-wrap: wrap; gap: 6px; }
    /* 「观看链接」标题行：label + 批量检索小图标（动画/剧集）并排；行内覆盖 label 底边距防图标下沉。
       🔴 #410：「从文件夹检索剧集」那枚图标按钮已并入**共用的** `.rl-ai-btn`（用户：「观看链接旁边的按钮
       也给我统一配色」）—— 原来这里另有一份（20×18 / 透明 / muted→accent），与 `.rl-ai-btn` **同形**，
       两套必然漂 ⇒ 删掉。⛔ 别再复制一份出来。 */
    .rl-lbl-row { display: flex; align-items: center; gap: 4px; }
    .rl-lbl-row .rl-lbl { margin-bottom: 0; }
    /* 关联按钮单行（书籍文件/游戏启动/本地音频）：小按钮 + 右键编辑浮层 */
    .rl-ep-row { display: flex; gap: 6px; align-items: center; }
    .rl-ep-wrap { position: relative; }
    .rl-ep-btn {
        position: relative; width: 36px; height: 30px; font-family: inherit; font-size: 12px;
        border: 1px solid var(--background-modifier-border); background: var(--background-primary);
        color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer;
        transition: background .12s ease, color .12s ease;
    }
    /* 图标+文字 auto 宽小按钮：书籍「▶ 阅读」/ 电影「▶ 观看」同款 */
    .rl-ep-btn-book {
        width: auto; min-width: 56px; padding: 0 12px;
        display: inline-flex; align-items: center; gap: 4px;
        justify-content: center;
    }
    .rl-ep-wrap.linked .rl-ep-btn { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    /* 🔴 #586 当前进度所在的那一集 —— **集号右下角的橙色小圆点**。
       判据 = 当前进度（`episode`，1 基；0 = 还没开始看 ⇒ 不标）。
       🔴 本批**翻面 #447**：原先画的是「1px 黄边 + 2px 黄外环」（旧令牌值 `#b8860b`）。用户
          2026-10-09：「修复当前编辑条目进度的显示问题，**正确以橙色小圆点显示在数字右下角**」
          —— 与 #576 选集弹窗里那粒 `.rl-eps-dot` 是**同一件事的两种画法**，留着两套必然分叉。
       🔴 显隐**只由 `.cur-ep` 这一个类驱动**（那一行按钮上方已挂好 `class:cur-ep`）：圆点每一格都渲染、
          默认 `display: none` —— ⛔ 别退回「模板里再写一遍 `episode >= 1 && i + 1 === episode`」，
          同一个判据两处 = 迟早漂（填了进度却只有一处重画）。
       ⚠️ 圆点挂在 `.rl-ep-num`（贴着数字本身的盒子，宽度随文字）⇒ 落在**数字**右下角而不是按钮角落；
          `bottom/right` 取负值 ⇒ 不撑开按钮、不挤动数字。
       ⛔ 仍**不改按钮底色 / 文字色**：底色已被「已关联」占用（一个按钮的底色只表达一件事）。
       ⚠️ 色值取令牌 `--rl-progress-now`（= Obsidian `--color-orange`，真源在 `styles.css` 文件头）。 */
    .rl-ep-num { position: relative; }
    .rl-ep-dot {
        display: none; position: absolute; right: -6px; bottom: 0;
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--rl-progress-now, #e8890c); pointer-events: none;
    }
    .rl-ep-wrap.cur-ep .rl-ep-dot { display: block; }
    /* 🔴 #527 失效网络链接标红（用户：「检测剧集网络链接失效的项，呈现为红色」）：
       红描边 + 红字 + 回到 primary 底（「已关联」的 accent 底会吃掉红字对比度）。
       ⚠️ 特异性 (0,5,0) 与 `.rl-ep-wrap.linked .rl-ep-btn` **相同** ⇒ 靠**写在它后面**取胜，
          ⛔ 别把本条上移到那条规则之前（会静默失效）。 */
    .rl-ep-wrap .rl-ep-btn.rl-ep-dead {
        border-color: var(--text-error);
        color: var(--text-error);
        background: var(--background-primary);
    }
    /* 第 N 集编辑弹窗（EntryForm 自绘浮层，fixed 遮罩 + 居中卡片） */
    .rl-ep-edit-mask { position: fixed; inset: 0; z-index: 999; background: rgba(0, 0, 0, .35); }
    .rl-ep-edit {
        position: fixed; z-index: 1000; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: min(420px, 90vw); background: var(--background-primary);
        border: 1px solid var(--background-modifier-border); border-radius: 10px;
        padding: 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, .22);
    }
    .rl-ep-edit-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
    /* #404：浮层标题行 = 标题 + 同款小按钮（`.rl-ai-btn`）；标题自带的 10px 下边距收进这一行 */
    .rl-ep-edit-row { display: flex; gap: 6px; margin-bottom: 6px; }
    /* 🔴 #500⑥「标签 + 贴着它的小按钮」一行：那枚按钮作用的对象就是下面那个框
       （#525 起用于集编辑浮层「网络地址」旁的「在 B 站搜索这一集」），挂在标签旁比挂在标题行更好找。
       ⚠️ `.rl-lbl-inline` 平时是块级独占一行（下面直接跟一个框），进到这一行里必须收成 inline。
       ⚠️ #523 撤掉的两个壳样式中，本次只恢复了**这一个**（标题行那个仍未回归）。 */
    .rl-edit-lblrow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    /* ⚠️ 就地轻提示（`.rl-saved-hint`）的样式统一写在 `<style>` 末尾那条注释块里（#583 合并四类浮层），
       ⛔ 别在这里再写一份 —— 同一条提示两套几何必然分叉。 */
    .rl-edit-lblrow .rl-lbl-inline { margin-bottom: 0; }
    .rl-ep-edit-input { flex: 1; min-width: 0; }
    /* #497 改名的**静态扩展名后缀**：扩展名锁死不可编辑 ⇒ 用 muted 色 + 等宽字体，
       与左边那个可编辑输入框在观感上分开（⛔ 别做成 input 的 suffix 伪元素 —— 那看起来像能改）。 */
    .rl-ep-ext { flex: none; align-self: center; font-size: 12px; font-family: var(--font-monospace); color: var(--text-muted); }
    .rl-ep-edit-input + .rl-ep-edit-input { margin-top: 6px; }
    .rl-ep-edit-ops { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    /* LRC 歌词（#396）：正文住在笔记的 ` ```lrc ` 块里，这里是它在表单里的编辑面。
       等宽字体让 `[mm:ss.xx]` 时间戳左对齐成一条线（用户要逐行核对时间轴时很实在）。 */
    .rl-lrc { resize: vertical; min-height: 6.5em; line-height: 1.5; font-family: var(--font-monospace); font-size: 12px; }
    /* 候选浮层：沿用「第 N 集编辑弹窗」的遮罩 + 居中卡片形态（表单内浮层唯一既有范式，⛔ 不自造锚定式浮层） */
    .rl-lrc-pop { width: min(520px, 92vw); }
    /* 🔴 #500③ B 站候选浮层：复用同一张卡片（`.rl-ep-edit`），只加两样 —— 比集编辑卡宽一点（要放缩略图）、
       以及**列表内部滚动**（⛔ 卡片本体不带滚动，否则整张卡连着遮罩一起长，滚到哪都是它）。
       ⚠️ 它与集编辑浮层是**同一个 z 层**（都是 fixed 居中卡片）⇒ 开它时先关掉父浮层？—— 不必：
       宿主里它是**卡片里的一层**（`{#if epBiliOpen}` 在集编辑卡内部），DOM 靠后 ⇒ 盖在上层，位置重叠但可读。 */
    /* 外壳宽度：`.rl-bili-pop` 挂在 `.rl-ep-edit` 上、要**压过它的 `min(420px, 90vw)`**
       ⇒ 这条**必须留在这里**（scoped，(0,3,0)；搬到全局会掉成 (0,1,0)、被 `.rl-ep-edit` 反超）。
       🔴 #506：**内部件**（候选列表 / 行 / 胶囊 / 分P 勾选表）已**上移 `styles.css` 全局** ——
          理由见那边 #506 那段（快捷关联弹窗是 DOM-API 组件、拿不到哈希类名，那个入口长不出按钮）。
       ⛔ 别把内部件在这里再复制一份（两份必然漂）。 */
    .rl-bili-pop { width: min(520px, 92vw); }
    /* #529：书籍候选卡复用 B站 那套（`.rl-bili-list/-row/-cover`），**内部件规则一律留在 `styles.css` 全局**
       （#506 纪律：DOM-API 组件拿不到 scoped 哈希，组件里留一份 = 两份必然漂）。
       竖版封面尺寸的那条覆写（`.rl-wr-pop` 前缀 + B站 封面类）也因此在全局，⛔ 别搬回这里
       —— 连注释里都别写出那条选择器全名（注释会进产物，撞红本块的反向守卫）。 */
    /* 标题行 = 左标题 + 右 ✕（2026-09-28 #401 照 `obsidian-lyricflux` 的候选框头搬）：
       ⛔ 不再用「底部一个取消按钮」那套 —— 正本只有右上角 ✕（外加点击遮罩关闭）。 */
    .rl-lrc-pop-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; padding-bottom: 6px; margin-bottom: 8px;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    /* `.rl-ep-edit-title` 自带上边距 10px（给别的浮层用）⇒ 在标题行里必须收掉 */
    .rl-lrc-pop-head .rl-ep-edit-title { margin-bottom: 0; }
    .rl-lrc-pop-close {
        flex: none; padding: 0 4px; border: none; background: transparent; box-shadow: none;
        color: var(--text-muted); font-size: 12px; cursor: pointer;
    }
    .rl-lrc-pop-close:hover { color: var(--text-normal); background: transparent; }
    /* 候选框 = **带边框的滚动区**（正本 `.lyrics-tag-lyric-candidates` 口径）。
       ⚠️ 高度沿用本仓的 320px（正本是 220px）：四源**平铺**（`lrcFlatList`）⇒ #475 放宽候选数后最多 80 行，
          220px 只能看到五行、滚动条几乎一直贴着 —— 320px 才够用。
          ⛔ 不必因为候选数再放宽就跟着加高：这是**滚动区**，用户的动作是「滚到自己要的那一版」，不是「一眼看完」。 */
    .rl-lrc-list {
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        max-height: 320px;
        overflow-y: auto;
    }
    /* 每行左侧一枚**来源胶囊**（正本 `.lyrics-tag-lyric-source` 口径）：
       摊平列表后，来源靠它认，⛔ 不再靠「分组小标题」。 */
    .rl-lrc-src {
        flex: none; padding: 1px 6px; border-radius: 4px;
        background: var(--background-modifier-border); color: var(--text-muted);
        font-size: 11px; font-weight: 400; margin: 0;
    }
    .rl-lrc-item {
        display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px;
        border: none; background: transparent; border-radius: 0; cursor: pointer;
        color: var(--text-normal); font-size: 13px; text-align: left;
    }
    .rl-lrc-item:hover { background: var(--background-modifier-hover); color: var(--interactive-accent); }
    .rl-lrc-item:disabled { opacity: .45; cursor: not-allowed; }
    .rl-lrc-item-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-lrc-item-a { flex: none; font-size: 11px; color: var(--text-faint); }
    .rl-lrc-item:hover .rl-lrc-item-a { color: var(--interactive-accent); }
    .rl-notes { resize: vertical; }
    /* 简介类 textarea auto-grow：高度由内容驱动（scrollHeight 计算），隐藏滚动条防高度抖动；min-height 为空/少文字基线（约 2 行） */
    .rl-summary { overflow: hidden; min-height: 2.4em; resize: vertical; }
    .rl-fft {
        display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; align-items: center;
        flex: none; /* sticky 悬浮钉底；2026-09-12 用户裁定：不铺整行背景条遮挡内容——只按钮本身悬浮，滚动内容从按钮间穿过 */
        position: sticky; bottom: 0; z-index: 10;
        padding: 8px 0;
    }
    .rl-fft-right { display: flex; gap: 8px; align-items: center; }
    .rl-fft-left { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    /* 底部按钮统一体系（2026-09-15）：**背景必须不透明** + 同高 / 同圆角 / 同内边距 + hover·按下·禁用齐全 + 间距一律 8px。
       不透明是硬要求：本栏 sticky 钉底，且按 2026-09-12 用户裁定**不铺整行背景条**（滚动内容会从按钮缝隙穿过），
       所以按钮自身一旦透明（原 .rl-btn-danger 的 background: transparent）就会直接透出下层滚动内容，
       深色模式下文字与边界尤其看不清。间距统一来源 = 两个组的 gap: 8px，按钮自身不再带 margin。 */
    .rl-fft :global(button.rl-btn) {
        font-family: inherit; font-size: var(--font-ui-small); font-weight: 500;
        line-height: 20px; min-height: 30px; padding: 4px 12px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); color: var(--text-normal);
        cursor: pointer;
        transition: background .12s ease, color .12s ease, border-color .12s ease, transform .1s ease;
    }
    .rl-fft :global(button.rl-btn:hover:not(:disabled)) {
        background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent);
    }
    .rl-fft :global(button.rl-btn:active:not(:disabled)) { transform: scale(.97); }
    .rl-fft :global(button.rl-btn:disabled) { opacity: .5; cursor: not-allowed; }
    /* 危险（删除条目）：不透明底 + 语义红字红边（--rl-danger 两主题各达标），hover 转实心红 + 白字 */
    .rl-fft :global(button.rl-btn-danger) {
        color: var(--rl-danger, var(--text-error));
        border-color: var(--rl-danger, var(--text-error));
        background: var(--background-primary);
        font-weight: 600;
    }
    /* 次级强调（重新拉取 / 添加摘抄 / 记录游玩）：删除条目同款的描边，主题色版本 */
    .rl-fft :global(button.rl-btn-accent) {
        color: var(--interactive-accent);
        border-color: var(--interactive-accent);
        background: var(--background-primary);
        font-weight: 600;
    }
    .rl-fft :global(button.rl-btn-accent:hover:not(:disabled)) {
        background: var(--interactive-accent); border-color: var(--interactive-accent);
        color: var(--text-on-accent);
    }
    .rl-fft :global(button.rl-btn-danger:hover:not(:disabled)) {
        background: var(--rl-danger-strong, var(--text-error));
        border-color: var(--rl-danger-strong, var(--text-error));
        color: #fff;
    }
    /* 实底主按钮（更新笔记 / 保存并生成笔记）：不参与 hover 反色（UI-GUIDE §3），改用极轻亮度变化给出反馈。
       ⚠️ 2026-09-12 曾裁定「添加摘抄 / 记录游玩」同样恒实底；2026-09-15 用户改裁为**次级中性按钮**
       （与主按钮同色会分不清主次），故这两个类不再在此列，回落到上方 button.rl-btn 的次级中性基准。 */
    .rl-fft :global(button.rl-btn-primary) {
        background: var(--interactive-accent); border-color: var(--interactive-accent);
        color: var(--text-on-accent); font-weight: 600;
    }
    .rl-fft :global(button.rl-btn-primary:hover:not(:disabled)) {
        background: var(--interactive-accent); border-color: var(--interactive-accent);
        color: var(--text-on-accent); filter: brightness(1.07);
    }

    /* ── 🔴 #563 / #568 / #583 自动保存「就地轻提示」────────────────────────────────
       位置 = **它自己那一行的标签旁**（`#568` 用户点名：「显示在浮层弹窗内本地路径或网络路径标题旁，
       而不是窗口外」；`#583` 推广到全部四类浮层）。
       🔴 它**不是浮层、不占新的一行**（`inline` + 与标签同处 `.rl-edit-lblrow`）——
          四类浮层共用这一个类，⛔ 别给某一类再另起一个类名（那会分叉出第二套几何）。
       ⚠️ 颜色只走主题变量（灰字靠 `--text-faint`），⛔ 不给它底色 / 阴影（仓库 UI 铁律）；
          失败态复用 `--rl-danger-strong`（与 `pure/toast.TOAST_FAILED` 的语义配对）。
       ⚠️ 旧的那条**窗口底部固定定位提示**（类名见 #563 的批注 / 历史 CHANGELOG）已随 #583 **整体退场**——
          本条注释**刻意不写它的类名**：反向守卫就是按类名 grep 的，写了会自撞（本仓老坑）。 */
    .rl-saved-hint {
        font-size: 11px; font-weight: 400; color: var(--text-faint);
        white-space: nowrap; animation: rl-saved-hint-in .18s ease-out;
    }
    .rl-saved-hint-bad { color: var(--rl-danger-strong, #c0493f); }
    @keyframes rl-saved-hint-in { from { opacity: 0; } to { opacity: 1; } }
</style>
