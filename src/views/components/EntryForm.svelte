<script lang="ts">
    import { lrcTranslatableCount } from 'pure/lrcBilingual';
    import { buildPlatformCoverQuery, posterSourcesFor, type PosterSource } from 'pure/posterSources';
    import { onMount, tick } from 'svelte';
    import { ENTRY_TYPE_LABELS, type EntryType } from 'data/types';
    import { statusLabel, statusVerb } from 'pure/labels';
    import { reconcileBookProgress, pageFromPercent, type BookProbeResult, type BookProgressFields } from 'pure/bookProgress';
    import { parseSeriesIndexInput } from 'pure/seriesGroup';
    import { episodeHintLabel, storeEpisodeList } from 'pure/episodeAssoc';
    import { episodeTitleFromName } from 'pure/episodeScan';
    import { cleanPastedText, readClipboardText } from 'services/clipboard';
    import { normalizeBookKind, BOOK_KIND_LABELS } from 'pure/bookKind';
    import type { SourceKind } from 'pure/sourceRule';
import { toSearchTypeSel, applySearchTypeSel, type SearchTypeSel } from 'pure/searchTypeSel';
    import { normalizeMusicKind } from 'pure/musicKind';
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
    // #500③ 集编辑浮层的「B站」按钮复用**音乐下载那条 B 站搜索链**（同一个 `pure` 解析 + 同一个服务）
    import {
        biliCheckedRows,
        biliSelectableRows,
        buildBiliFillRows,
        buildBiliPartUrl,
        formatBiliPlay,
        type BiliFillRow,
        type BiliPart,
        type BiliVideo,
    } from 'pure/dl/bilibili';
    import { formatDuration } from 'pure/dl/utils';
    import { pickLibraryAudio, type LibraryAudioFile } from 'pure/libraryAudio';
    import { audioExtOf, audioStemOf } from 'pure/renameAudio';
    import { buildPosterQuery } from 'pure/posterSearch';
    import { mediaInfoLine, type MediaInfo } from 'pure/mediaInfo';
    import { pickLibraryBook, type LibraryBookFile } from 'pure/libraryBooks';
    /** #464 在线曲库：音乐态结果区的那一栏（id 从纯模块取，⛔ 别写字面量） */
    import { SONG_LIB_ID } from 'pure/songLibrary';
    import type { LyricFetchOutcome, LyricSearchOutcome } from 'services/lyricSearch';
    import { communityScoreIssue, entrySourceLabel, parseCommunityScore, parseRatingCount, parseSourceName, ratingCountIssue, sourceNameIssue, sourceUrlIssue, splitScoreCount } from 'pure/sourceMeta';
    import type { SearchProgressCb, SearchProgress } from 'pure/searchProgress';
    import type { MediaStatus } from 'pure/status';
    import Icon from './Icon.svelte';
    import type { MediaEntry, BookKind, MusicKind } from 'data/types';

    type SearchResult = TmdbSearchResult | OmdbSearchResult | BookSearchResult | GameSearchResult | BangumiSearchResult | MusicSearchResult;

    /** 状态选项（想看/在看/已看/存档；存档选中时右侧不显示日期输入框；弃剧已移除，旧数据 dropped 编辑保存时迁移为存档） */
const STATUS_OPTIONS: MediaStatus[] = ['want', 'watching', 'watched', 'archived'];

/** 类型下拉选项（显式顺序，2026-09-12 用户指定）：文学 → 网文 → 漫画 → 动画 → 电视剧 → 电影 → 游戏 → 音乐
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
    export let canSearch: boolean = false;
    export let canSearchBook: boolean = true;
    export let canSearchGame: boolean = false;
    export let onSearch: (q: string, t: 'movie' | 'tv', onProgress?: SearchProgressCb) => Promise<TmdbSearchResult[]> = async () => [];
    export let onSearchBook: (q: string, kind?: BookKind, onProgress?: SearchProgressCb) => Promise<BookSearchResult[]> = async () => [];
    export let onSearchGame: (q: string, onProgress?: SearchProgressCb) => Promise<GameSearchResult[]> = async () => [];
    export let onSearchAnime: (q: string, onProgress?: SearchProgressCb) => Promise<BangumiSearchResult[]> = async () => [];
    export let onSearchMusic: (q: string, onProgress?: SearchProgressCb) => Promise<MusicSearchResult[]> = async () => [];
    export let onFetchDetail: (r: TmdbSearchResult) => Promise<Partial<TmdbDetail> & { posterPath?: string }> = async () => ({});
    /** 豆瓣兜底详情按需补全：选中搜索结果时动态拉取 JSON-LD + #info（仅前 3 条搜索时预补全） */
    export let onFetchDoubanDetail: (id: string, type: EntryType) => Promise<Record<string, unknown> | null> = async () => null;
    /** Bangumi 详情按需补全（选中搜索结果时调用：persons+subjects API → 导演/评分/主演） */
    export let onFetchBangumiDetail: (id: number) => Promise<{ rating?: number; ratingCount?: number; director?: string; cast?: string[] }> = async () => ({});
    /** Open Library 书籍详情按需补全（选中搜索书籍时调用：works.json → 简介/页数/出版社；失败返回 null 静默） */
    export let onFetchOpenLibraryDetail: (key: string) => Promise<Record<string, unknown> | null> = async () => null;
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
    /** 书籍「进度页数」自动关联：探针本地书籍文件基准（PDF → numPages；TXT → 按章节解析 totalChapters；EPUB/失败 → undefined） */
    export let onProbeBookPages: (path: string) => Promise<BookProbeResult | undefined> = async () => undefined;
    /** 选视频文件夹（动画/电视剧「从文件夹检索剧集」目录选择器；非桌面/取消 → undefined） */
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
     * ⑤-c：是否显示「下载」按钮（真源 = 设置里的「启用内置音乐播放器」开 + 桌面端）。
     * ⚠️ 由 `EntryModal` 按当前设置传入 —— ⛔ 别在组件里读 settings（组件不认识 plugin）。
     */
    export let canDownload = false;
    /**
     * 🔴 #414：是否显示书籍表单里的「下载」小按钮（真源 = **桌面端**；书籍下载走 Node http，
     *    移动端放进来必然一次失败 ⇒ 由宿主按 `Platform.isDesktopApp` 传入，⛔ 组件不认识 plugin）。
     *    ⚠️ 与音乐那枚（`canDownload` = 桌面端 + 「启用内置音乐播放器」）**不是同一个门控** ——
     *    书籍下载没有对应的功能开关，只受平台限制。
     */
    export let canDownloadBook = false;
    /**
     * #414：打开「下载书籍」弹窗（书名 / 作者只用来**预填落盘文件名**）。
     * `onPicked(relPath, tocText)` = 下载成功后的库内相对路径 + **章节名清单**（P1-C）；
     * 表单据此填「书籍文件」/「目录」并提示保存。
     */
    export let onOpenBookDownloader: (
        onPicked: (relPath: string, tocText?: string) => void,
        /** #422：条目分类（文学 / 网文）—— 决定弹窗优先用哪一类书源 */
        kind: SourceKind,
    ) => void = () => {};
    /**
     * #414：下载成功后**直接写回条目**（编辑态写 catalog；新增态由宿主静默返回）。
     * P1-C：第二参 = 章节名清单（**仅文学**传得到，网文为 `undefined`）。
     */
    export let onApplyBook: (relPath: string, tocText?: string) => Promise<void> | void = () => {};
    /**
     * 书籍编辑表单「下载」（#414；#419 加书源检索；**#422 续四 删掉直链**）：打开弹窗，
     * 下载成功后：**编辑态直接写回条目**（与音乐面「下载成功 = 自动关联」同一口径）+ 同步表单框。
     * 🔴 #422：连**分类**一起传 —— 弹窗据此优先用同类书源（本类为空会回退，见弹窗的 `shown`）。
     * ⛔ 书名 / 作者不再传：那是直链时代用来预填文件名的（书源路的文件名取自书源返回的书名）。
     */
    function openBookDownloader(): void {
        onOpenBookDownloader((relPath, tocText) => {
            bookFileVal = relPath;
            /**
             * 🔴 P1-C 建立 → **#431 翻面**：章节名写回「目录」**不再按分类拦**。
             *    2026-09-13 那条「网文不带出版目录」要防的是**一整份 2000+ 章的出版目录**；
             *    用户 2026-09-29 裁定「文学类和网文的 toc 目录回填**只显示前 10 章加个 `....`**」之后，
             *    写回来的是 10 行预览 ⇒ 网文也能有。⚠️ 裁断在**宿主**（`novelTocPreview`），
             *    这里只负责把它交给「目录」框 + 写回条目，⛔ 别在这里再截一次。
             */
            const tocForEntry = tocText;
            if (tocForEntry) toc = tocForEntry;
            void onApplyBook(relPath, tocForEntry);
        }, bookKind === 'novel' ? 'novel' : 'book');
    }
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
     * #417：**库内书籍文件**清单（「书籍文件」浮层里那枚「检索同名书籍」小按钮用）。
     * 宿主注入（`main.listLibraryBookFiles`：扫**全库**、按书籍扩展名白名单筛）——
     * ⛔ 组件不碰 vault；匹配与排序在纯模块 `pure/libraryBooks`。
     */
    export let onListLibraryBooks: () => LibraryBookFile[] = () => [];
    /** 游戏编辑表单「记录游玩」：弹窗侧打开游玩记录弹窗（固定挂载当前游戏） */
    export let onRecordPlaySession: () => void = () => {};
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
    let query = '';
    let searching = false;
    let searchError = '';
    let results: SearchResult[] = [];
    /** 搜索进度（确定性进度条 + 预计耗时）：done/total/label/etaSec */
    let progDone = 0;
    let progTotal = 0;
    let progLabel = '';
    /** 模拟进度（单步搜索 total 未知时显示爬升百分比，避免「看不到进度」；有真实步骤时用真实值） */
    let progSim = 0;
    let progSimTimer: ReturnType<typeof setInterval> | undefined;
    /** 进度百分比：total 已知用真实值；未知用模拟爬升（封顶 88%，完成时跳 100） */
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
        progSim = 4;
        clearInterval(progSimTimer);
        progSimTimer = setInterval(() => {
            progSim = Math.min(88, progSim + Math.round(4 + Math.random() * 6));
        }, 420);
    }
    function stopSimProgress() {
        clearInterval(progSimTimer);
        progSimTimer = undefined;
        progSim = 100;
    }
    /** 编辑模式默认已"选/填"（picked=true 直接渲染字段区）；新增需搜索点结果才置 true */
    let picked: boolean = entry !== null;
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
    }
    /** 音乐分类（1.0.3.1 起不再分：用户 2026-09-13 裁定删除「其他」，表单选择行已下线）；字段保留恒归一为 music（pure/musicKind） */
    let musicKind: MusicKind = normalizeMusicKind(entry?.musicKind);
    let author = entry?.author ?? '';
    /** 🔴 #444g 画师（漫画的作画）：与「作者」（漫画里 = 原作 / 编剧）分开的两栏；
     *  只有**漫画态**在表单里渲染该框，其余 bookKind 保存时显式清空（见 submit）。 */
    let artist = entry?.artist ?? '';
    let album = entry?.album ?? '';
    let audioPath = entry?.audioPath ?? '';
    /** 游戏启动快捷方式（.lnk）路径（表单「启动快捷方式」行） */
    let gameLaunchPath = entry?.gameLaunchPath ?? '';
    /** 书籍文件路径（阅读器打开入口）：右键编辑浮层浏览/手动输入，存 bookFile */
    let bookFileVal = entry?.bookFile ?? '';
    /** 书籍文件右键编辑浮层开关 */
    let bookEditOpen = false;
    /** 游戏启动快捷方式右键编辑浮层开关 + 编辑缓冲值（保存才写回 gameLaunchPath） */
    let gameEditOpen = false;
    let gameLaunchVal = '';
    /** 本地音频右键编辑浮层开关 + 编辑缓冲值（保存才写回 audioPath） */
    let audioEditOpen = false;
    let audioPathVal = '';
    /** 「本地音频」浮层里那次「检索库内同名音频」的结果提示（#404；空 = 没提示） */
    let audioFindHint = '';
    /**
     * #497 改名：输入框里的**新主名** + 失败原因提示 + 进行中标记。
     * 🔴 输入框只放主名，扩展名以静态后缀渲染（`audioExtOf`）—— 扩展名一改，这个文件就不再是音频了，
     *    而它是**用户的文件**，改坏了找不回来。⚠️ 用户粘完整文件名时的兜底在纯模块（同名扩展自动剥）。
     */
    let audioNameVal = '';
    let audioRenameHint = '';
    let audioRenaming = false;
    /** 「书籍文件」浮层里那次「检索库内同名书籍」的结果提示（#417；空 = 没提示） */
    let bookFindHint = '';
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
    let series = entry?.series ?? '';
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
    let seriesIndexVal = entry?.seriesIndex !== undefined ? String(entry.seriesIndex) : '';
    let platform = entry?.platform ?? '';
    let developer = entry?.developer ?? '';
    let poster = entry?.poster ?? '';
    /** 表单 UI 模式：douban（豆瓣版，全类型）/ tmdb（电影/电视剧）/ bangumi（动画）；命中搜索结果或编辑已有条目时按 source 确定 */
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
    /** 进度单位：关联 TXT/EPUB 按章节解析 → 章；否则（PDF/手填）→ 页（EPUB 无固定页码，spine 章节数为基准） */
    $: bookUnit = ['.txt', '.epub'].some((ext) => bookFileVal.trim().toLowerCase().endsWith(ext)) ? '章' : '页';
    $: bookUnitLabel = bookUnit === '章' ? '进度章节' : '进度页数';
    /** 游戏游玩时长（小时录入，落库转分钟；有游玩记录明细时以明细累计为准） */
    let playtimeHours = entry?.playtimeMinutes ? String(Math.round(entry.playtimeMinutes / 60)) : '';
    let notes = entry?.notes ?? '';
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
        ? 'TMDB API Key 未配置 — 电影/剧集仅显示 Douban 结果（可在 设置 → 元数据源配置 › 元数据源凭据 · TMDB 配置后叠加）'
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
     * 📌 #464 在线曲库栏的**开关（两个消费点共用这一份口径）**：音乐类型 + 可下载。
     *
     * 🔴 为什么要它：豆瓣音乐搜索**只按专辑名匹配**（搜歌手名搜不到他的歌），
     *   而「按歌手找他的流行曲」只有四平台曲库能干 —— 那正是「下载歌曲」窗口那条链。
     *   ⇒ 音乐态的结果区固定多一栏「在线曲库」（宿主 `searchMusic` 已把结果并进来，见 `songLibrarySearch`）。
     *
     * 🔴 门控为什么是 `canDownload`（= 桌面端 + 「启用内置音乐播放器」）：曲库检索要发网络请求（Node http），
     *   移动端必然失败；且它与「下载歌曲」按钮**本来就是同一个门控**（宿主同一枚 `canUseAudioDownload()`）。
     *   ⚠️ 栏位必须在**发起搜索前**就定好（与其它源同一口径：栏数不随本次成败增减），
     *     缺结果时该栏显示「无匹配」占位，而不是整栏消失/位置漂移。
     */
    $: songLibOn = type === 'music' && canDownload;

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
        return ('id' in r ? String(r.id) : r.title) + '|' + r.title;
    }

    /** 分栏展示用的单栏（id+列头文本+该来源结果；items 空时渲染占位文案而非整栏消失） */
    interface ResultColumn {
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
        searching = true;
        searchError = '';
        results = [];
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
            if (type === 'book') {
                // 传当前子分类：文学/网文均走 book 链（豆瓣主源 + Open Library），仅落库 bookKind 不同
                results = await onSearchBook(q, bookKind, onSearchProgress);
            } else if (type === 'game') {
                results = await onSearchGame(q, onSearchProgress);
            } else if (type === 'anime') {
                // 动画走 Bangumi（bgm.tv，中文标题权威，需 Access Token）+ Douban 并行
                results = await onSearchAnime(q, onSearchProgress);
            } else if (type === 'music') {
                results = await onSearchMusic(q, onSearchProgress);
            } else {
                results = await onSearch(q, type, onSearchProgress);
            }
            if (results.length === 0) {
                searchError = '未找到相关结果，可换个关键词或直接手动填写';
            }
        } catch (e) {
            searchError = e instanceof Error ? e.message : String(e);
            new Notice(searchError, 8000);
        } finally {
            stopSimProgress();
            searching = false;
            void prefetchTmdbDetails(); // 后台预取 TMDB 详情，不阻塞结果展示
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
                if (shouldAdoptCover(poster, r.thumbnail)) poster = r.thumbnail;
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
                } else {
                    const d = await onFetchDetail(r);
                    if (shouldAdoptCover(poster, posterUrl(d.posterPath))) poster = posterUrl(d.posterPath) ?? '';
                    if (d.genres?.length) genres = d.genres.join(' / ');
                    if (d.director) director = d.director;
                    if (d.cast?.length) cast = d.cast.join(' / ');
                    if (d.overview) summary = d.overview;
                    // 详情补全评价人数/评分（搜索级缺失时兜底）
                    if (d.ratingCount != null && !ratingCount) ratingCount = String(d.ratingCount);
                    if (d.rating != null && !communityScore) communityScore = String(d.rating);
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
    /** 编辑弹窗保存：写回数组（空串 → undefined），重新赋值触发响应式 */
    function saveEpEditor() {
        if (editEp === null) return;
        const i = editEp;
        episodeFiles = episodeFiles.map((v, idx) => (idx === i ? editLocal.trim() || undefined : v));
        episodeUrls = episodeUrls.map((v, idx) => (idx === i ? editUrl.trim() || undefined : v));
        episodeTitles = episodeTitles.map((v, idx) => (idx === i ? editTitle.trim() || undefined : v));
        closeEpEditor();
        new Notice(type === 'movie' ? '关联已保存' : `第 ${i + 1} 集关联已保存`);
    }
    /** 编辑弹窗清除该集全部关联 */
    function clearEpEditor() {
        if (editEp === null) return;
        const i = editEp;
        episodeFiles = episodeFiles.map((v, idx) => (idx === i ? undefined : v));
        episodeUrls = episodeUrls.map((v, idx) => (idx === i ? undefined : v));
        episodeTitles = episodeTitles.map((v, idx) => (idx === i ? undefined : v));
        closeEpEditor();
        new Notice(type === 'movie' ? '关联已清除' : `第 ${i + 1} 集关联已清除`);
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
    /** 编辑浮层「粘贴」：读剪贴板 → 清洗 → 填入网络地址（仍要点「保存」才写回条目） */
    async function pasteEpUrl() {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        editUrl = v;
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
    /** 浮层当前视图：`search` = 候选列表；`parts` = 选中那条的分P 勾选表 */
    let epBiliView: 'search' | 'parts' = 'search';
    /** 勾选表的行（真源 = `buildBiliFillRows`，组件只负责改 `checked`） */
    let epBiliRows: BiliFillRow[] = [];
    /** 勾选表表头那句上下文（选中那条视频的标题 + bvid） */
    let epBiliPickTitle = '';
    let epBiliPickBvid = '';
    /** 正在读分P（点候选后的一次往返；防连点） */
    let epBiliPartsBusy = false;

    /** 检索词的初值：作品标题 + 集标题（两者都为空 ⇒ 空串，宿主那侧会给「需要关键词」的提示） */
    function epBiliDefaultQuery(): string {
        const parts = [title.trim(), editTitle.trim()].filter((s) => !!s);
        return parts.join(' ');
    }
    /** 打开候选浮层并立即搜一次（沿用音乐下载那条链的交互：点开就有结果，不必先点「搜索」） */
    async function openEpBiliPicker() {
        epBiliOpen = true;
        epBiliView = 'search';
        if (!epBiliQuery.trim()) epBiliQuery = epBiliDefaultQuery();
        await runEpBiliSearch();
    }
    /** 搜一次（浮层里那颗「搜索」按钮；也供打开时自动跑） */
    async function runEpBiliSearch() {
        if (epBiliBusy) return;
        const kw = epBiliQuery.trim();
        epBiliVideos = [];
        epBiliErr = '';
        if (!kw) {
            epBiliErr = '先填检索词（默认取作品标题 + 集标题）';
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
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（请求失败 / `parts` 为空）⇒
     *    直接按老行为填**这一条**的链接并关浮层，同时说明原因 —— 用户至少能拿到一条链接，
     *    而不是卡在一个空表前面（本仓 #499D 那条纪律：工具失败不抛、能力回落）。
     */
    async function pickEpBiliUrl(v: BiliVideo) {
        if (epBiliPartsBusy) return;
        epBiliPartsBusy = true;
        epBiliErr = '';
        try {
            const out = await onBiliParts(v.bvid);
            const parts: BiliPart[] = out.parts ?? [];
            if (out.error || parts.length === 0) {
                editUrl = v.webUrl;
                epBiliOpen = false;
                backToEpBiliSearch();
                new Notice(
                    out.error
                        ? `读取分P失败（${out.error}），已直接填入这条链接`
                        : '这条没有分P，已直接填入这条链接',
                );
                return;
            }
            epBiliPickTitle = out.title || v.title;
            epBiliPickBvid = v.bvid;
            epBiliRows = buildBiliFillRows(parts, episodeUrls);
            epBiliView = 'parts';
        } catch (e) {
            epBiliErr = `读取分P出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            epBiliPartsBusy = false;
        }
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
        epBiliOpen = false;
        backToEpBiliSearch();
        closeEpEditor();
        new Notice(`已把 ${byIndex.size} 条链接填进对应集（点「保存」生效）`);
    }
    /** 集编辑浮层收尾（三处出口：保存 / 清除 / 取消 / 点遮罩）时把候选浮层一起收起 —— 否则会留一层孤儿 */
    function closeEpEditor() {
        editEp = null;
        epBiliOpen = false;
        epBiliView = 'search';
        epBiliRows = [];
    }
    /** 编辑弹窗「浏览」：系统文件选择器（Electron remote.dialog 绝对路径），填入编辑框，保存时写回 */
    async function browseLocalVideo(ev?: MouseEvent) {
        const p = await onPickLocalVideo(ev);
        if (p) {
            editLocal = p;
            new Notice('已选择本地视频，点「保存」生效');
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
    /** 书籍「▶ 观看」左键：有关联文件 → 打开阅读器，关闭后自动同步阅读器最新进度（percent 真源派生当前页/章）；无 → 提示右键编辑 */
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
        } else {
            new Notice('未关联书籍文件 — 右键「观看」选择 TXT/EPUB/PDF', 5000);
        }
    }
    /** 书籍「▶ 观看」右键：弹编辑浮层（浏览/手动输入路径） */
    function openBookEditor() {
        bookFindHint = '';
        bookEditOpen = true;
    }
    /** 书籍编辑浮层保存：路径写回 bookFileVal（保存条目时入库） */
    function saveBookEditor() {
        bookEditOpen = false;
        bookFindHint = '';
        new Notice('书籍文件已更新，点「保存」生效');
        void autoLinkBookProgress(bookFileVal.trim());
    }
    /** 书籍编辑浮层清除：清空关联 */
    function clearBookEditor() {
        bookFileVal = '';
        bookEditOpen = false;
        bookFindHint = '';
        new Notice('书籍文件关联已清除');
    }
    /**
     * #417「检索库内同名书籍文件」（浮层标题旁那枚 🔍）。
     * 🔴 只把路径**填进输入框**（与「浏览」同款），仍要点「保存」才生效 —— 检索结果不该直接落库。
     * 🔴 匹配逻辑在纯模块 `pure/libraryBooks`（与下载排序共用同一把相似度尺），组件只负责取数与提示。
     */
    function findLibraryBook(): void {
        const t = title.trim();
        if (!t) {
            bookFindHint = '标题为空，先填标题再检索';
            return;
        }
        const files = onListLibraryBooks();
        const { best, ranked } = pickLibraryBook(files, t, author.trim());
        if (!best) {
            bookFindHint = files.length === 0
                ? '书籍文件目录里还没有可关联的文件（epub / pdf / txt…）'
                : `书籍文件目录里没找到与「${t}」同名的书籍文件`;
            return;
        }
        bookFileVal = best.path;
        bookFindHint = ranked.length > 1 ? `命中 ${ranked.length} 个，已填入「${best.name}」` : `已填入「${best.name}」`;
    }
    /** 书籍编辑浮层「浏览」：系统文件选择器选 TXT/EPUB/PDF，回填 bookFileVal */
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
        // 进度基准单位：PDF=页；TXT/EPUB=章（章节制，EPUB 无固定页码）
        const total = info.format === 'pdf' ? info.numPages : info.totalChapters;
        const unit = info.format === 'pdf' ? '页' : '章';
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
        gameEditOpen = true;
    }
    /** 游戏编辑浮层保存：路径写回 gameLaunchPath（保存条目时入库） */
    function saveGameEditor() {
        gameLaunchPath = gameLaunchVal.trim();
        gameEditOpen = false;
        new Notice('启动快捷方式已更新，点「保存」生效');
    }
    /** 游戏编辑浮层清除：清空关联 */
    function clearGameEditor() {
        gameLaunchPath = '';
        gameEditOpen = false;
        new Notice('启动快捷方式关联已清除');
    }
    /** 音乐「▶ 播放」左键：有关联 → 播放音频；无 → 提示右键编辑 */
    function playMusicFromForm() {
        if (audioPath.trim()) {
            onPlayMusic();
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
        audioFindHint = '';
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
     * 🔴 只把路径**填进输入框**（与「浏览」同款），仍要点「保存」才生效 —— 检索结果不该直接落库。
     * 🔴 匹配逻辑在纯模块 `pure/libraryAudio`（与下载排序共用同一把相似度尺），组件只负责取数与提示。
     */
    function findLibraryAudio(): void {
        const t = title.trim();
        if (!t) {
            audioFindHint = '标题为空，先填标题再检索';
            return;
        }
        const files = onListLibraryAudio();
        const { best, ranked } = pickLibraryAudio(files, t, author.trim());
        if (!best) {
            audioFindHint = files.length === 0
                ? '音频文件目录里还没有音频文件'
                : `音频文件目录里没找到与「${t}」同名的音频`;
            return;
        }
        audioPathVal = best.path;
        syncAudioName();
        audioFindHint = ranked.length > 1 ? `命中 ${ranked.length} 个，已填入「${best.name}」` : `已填入「${best.name}」`;
    }
    /** 音乐编辑浮层保存：路径写回 audioPath（保存条目时入库） */
    function saveAudioEditor() {
        audioPath = audioPathVal.trim();
        audioFindHint = '';
        audioEditOpen = false;
        new Notice('本地音频已更新，点「保存」生效');
    }
    /** 音乐编辑浮层清除：清空关联 */
    function clearAudioEditor() {
        audioPath = '';
        audioFindHint = '';
        audioEditOpen = false;
        new Notice('本地音频关联已清除');
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
        // 影视类型（电影/电视剧/动画）：观看链接双路径——旧「资源链接」(links) 已迁移到 episodeUrls，此处清空（url 不丢）
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
        }
        if (type === 'game') {
            input.platform = platform.trim() || undefined;
            input.developer = developer.trim() || undefined;
            // 发行商/别名：对游戏条目废弃（豆瓣游戏页无此数据），不再读写
            input.gameLaunchPath = gameLaunchPath.trim() || undefined; // 启动快捷方式（.lnk）
        }
        if (type === 'music') {
            input.musicKind = musicKind; // 恒写（normalize 后恒为 'music'；1.0.3.1 起无子分类，写入即把存量 other 归一）
            input.author = author.trim() || undefined;
            input.album = album.trim() || undefined;
            input.audioPath = audioPath.trim() || undefined;
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
        }
        if (type === 'game') {
            // 游玩时长：小时录入 → 落库分钟（游玩记录明细由弹窗即时落盘，submit 不再重复提交）
            input.playtimeMinutes = playtimeHours ? Math.round(Number(playtimeHours) * 60) || undefined : undefined;
        }
        await onSubmit(input);
    }

    function setStar(n: number) {
        rating = rating === n ? 0 : n;
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
        {entry ? `编辑条目：${entry.title}` : pickedTitle ? `添加条目：${pickedTitle}` : '添加条目'}
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

    {#if searching}
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
        <div class="rl-progress" aria-hidden="true">
            <div class="rl-progress-fill" style={`width:${progPct}%`}></div>
        </div>
        <div class="rl-progress-meta">
            <span class="rl-progress-label"><span class="rl-spinner"></span> {sourcePlan.length > 0 ? `正在搜索 ${sourcePlan.length} 个数据源` : (progLabel || '正在搜索…')}</span>
            <span class="rl-progress-eta">{progPct}%</span>
        </div>
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
            <span class="rl-res-head-hint">点击卡片回填 · 点击空白取消 · 徽标直达来源</span>
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
                        <button class="rl-res-item" on:click|stopPropagation={() => pick(r)} data-tip="点击回填该条目">
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
                <!-- 总集数 + 当前进度并排（动画/电视剧；电影无总集数概念，观看链接区渲染单集播放钮）：
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
                    <label class="rl-lbl">启动快捷方式</label>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!gameLaunchPath.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={launchGameFromForm}
                                on:contextmenu={(ev) => { ev.preventDefault(); openGameEditor(); }}
                                data-tip={gameLaunchPath.trim() ? `启动：${gameLaunchPath}\n右键编辑/浏览更换` : '未关联 — 右键选 .lnk'}>
                                <Icon icon="play" size={11} /> 启动
                            </button>
                        </span>
                        {#if gameEditOpen}
                            <!-- 启动快捷方式编辑浮层（参照书籍文件浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={() => (gameEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-game">
                                <div class="rl-ep-edit-title" id="rl-ep-title-game">启动快捷方式（.lnk）</div>
                                <label class="rl-lbl-inline">文件路径</label>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={gameLaunchVal} on:input={(ev) => (gameLaunchVal = inputVal(ev))} placeholder="库内路径，或系统绝对路径（.lnk）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseGameLaunch(ev)} data-tip="选择 .lnk 快捷方式">浏览</button>
                                </div>
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveGameEditor} data-tip="保存">保存</button>
                                    <button class="rl-btn" disabled={!gameLaunchPath} on:click={clearGameEditor} data-tip="清除">清除</button>
                                    <button class="rl-btn" on:click={() => (gameEditOpen = false)}>取消</button>
                                </div>
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
                    <!-- #399-C 用户口径（附截图）：「本地音频」的下载小按钮要放在**标题旁边** ——
                         与「LRC歌词」「总结摘要」两行完全同款同位置（`.rl-lbl-row` + `.rl-ai-btn`）。
                         ⛔ 别再把它塞进下面「▶ 播放」那一排（那个容器类名见下一条 div，本注释不写它的全名，
                            否则「按钮前 800 字符内不得出现它」的反向守卫会被自己的注释撞红）。 -->
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">本地音频</label>
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
                            <div class="rl-ep-edit-mask" on:click={() => (audioEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-audio">
                                <!-- 🔴 #404：标题旁那枚小按钮 = **与「总结摘要 / 获取歌词 / 下载歌曲」同款**的
                                     `.rl-ai-btn`（用户：「在音乐类型条目编辑条目下的播放按钮右键时在其弹窗本地音频旁
                                     加个总结摘要同款小按钮」）；作用 = 在**库内音乐目录**里找同名音频并填入。
                                     ⛔ 别把它做成 `浏览` 那种带文字按钮（同款小图标按钮才有统一手感）。 -->
                                <div class="rl-ep-edit-head">
                                    <span class="rl-ep-edit-title" id="rl-ep-title-audio">本地音频</span>
                                    <button
                                        class="rl-ai-btn"
                                        on:click={findLibraryAudio}
                                        data-tip="在音频文件目录里检索同名音频">
                                        <span class="rl-sr">检索库内同名音频</span>
                                        <Icon icon="search" size={13} />
                                    </button>
                                </div>
                                <label class="rl-lbl-inline">文件路径</label>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={audioPathVal} on:input={(ev) => { audioPathVal = inputVal(ev); syncAudioName(); }} placeholder="库内路径，或系统绝对路径（mp3/flac/m4a…）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseAudio(ev)} data-tip="选择音频文件">浏览</button>
                                </div>
                                {#if audioFindHint}<div class="rl-hint">{audioFindHint}</div>{/if}
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
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveAudioEditor} data-tip="保存">保存</button>
                                    <button class="rl-btn" disabled={!audioPath} on:click={clearAudioEditor} data-tip="清除">清除</button>
                                    <button class="rl-btn" on:click={() => (audioEditOpen = false)}>取消</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            {#if type === 'book'}
                <div>
                    <!-- 🔴 #414：书籍「下载」小按钮与音乐那枚**同款同位**（`.rl-lbl-row` + `.rl-ai-btn`，
                         见 #404/#409 的小按钮摆放口径）—— 图标沿用已核实存在的 `download`，
                         ⛔ 别改用没核实过的图标名（`setIcon` 遇未知名静默失败 = 空白按钮）。 -->
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">书籍文件</label>
                        {#if canDownloadBook}
                            <button
                                class="rl-ai-btn"
                                on:click={openBookDownloader}
                                data-tip={bookKind === 'novel' ? '按网文书源搜书并下载并填入' : '按文学书源搜书并下载（书源由你自备），完成后自动填入这里'}>
                                <span class="rl-sr">{bookKind === 'novel' ? '下载网文' : '下载文学'}</span>
                                <Icon icon="download" size={13} />
                            </button>
                        {/if}
                    </div>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!bookFileVal.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={watchBook}
                                on:contextmenu={(ev) => { ev.preventDefault(); openBookEditor(); }}
                                data-tip={bookFileVal.trim() ? `打开阅读器：${bookFileVal}\n右键编辑/浏览更换` : '未关联书籍文件 — 右键编辑选择 TXT/EPUB/PDF'}>
                                <Icon icon="book-open" size={11} /> 阅读
                            </button>
                        </span>
                        {#if bookEditOpen}
                            <!-- 书籍文件编辑浮层（参照集按钮浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={() => (bookEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-labelledby="rl-ep-title-book">
                                <div class="rl-ep-edit-head">
                                    <span class="rl-ep-edit-title" id="rl-ep-title-book">书籍文件（TXT/EPUB/PDF）</span>
                                </div>
                                <!-- 🔴 #500⑥：那枚「检索库内同名书籍」小按钮从**标题行**挪到「文件路径」标签**旁边**
                                     （用户：「将『检索书籍』按钮移动到文件路径标题旁边」）——
                                     它作用的对象就是下面那个路径框，贴着标签比挂在标题行更好找。 -->
                                <div class="rl-edit-lblrow">
                                    <label class="rl-lbl-inline">文件路径</label>
                                    <button
                                        class="rl-ai-btn"
                                        on:click={findLibraryBook}
                                        data-tip="检索同名书籍文件">
                                        <span class="rl-sr">检索库内同名书籍</span>
                                        <Icon icon="search" size={13} />
                                    </button>
                                </div>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={bookFileVal} on:input={(ev) => (bookFileVal = inputVal(ev))} placeholder="库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseBookFile(ev)} data-tip="选择书籍文件">浏览</button>
                                </div>
                                {#if bookFindHint}<div class="rl-hint">{bookFindHint}</div>{/if}
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveBookEditor} data-tip="保存">保存</button>
                                    <button class="rl-btn" on:click={clearBookEditor} data-tip="清除">清除</button>
                                    <button class="rl-btn" on:click={() => (bookEditOpen = false)}>取消</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- 观看链接（网络 + 本地合一）：电影 = 单集 ▶ 观看按钮（左键播放/打开第 1 集，右键编辑关联）；
                 剧集/动画 = 1..N 集小按钮（左键播放/打开、右键编辑本地或网络），支持「从文件夹检索剧集…」批量按文件名集号填入 -->
            {#if type === 'movie' || type === 'tv' || type === 'anime'}
                <div>
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">观看链接</label>
                        {#if type !== 'movie'}
                            <!-- 批量检索（动画/电视剧）图标：选文件夹 → 识别文件名集号自动填入未关联集本地路径（已填跳过） -->
                            <button
                                class="rl-ai-btn"
                                data-tip={'选文件夹批量填集（按文件名认集号补标题）\n已填的不覆盖'}
                                on:click={() => void batchScanLocalEps()}><Icon icon="folder-search" size={13} /><span class="rl-sr">从文件夹检索剧集</span></button>
                        {/if}
                    </div>
                    {#if type === 'movie' || Number(totalEpisodes) > 0}
                        <div class="rl-ep-grid">
                            {#if type === 'movie'}
                                <span class="rl-ep-wrap" class:linked={!!episodeFiles[0] || !!episodeUrls[0]}>
                                    <button
                                        class="rl-ep-btn rl-ep-btn-book"
                                        on:click={() => playOrOpenEpisode(0)}
                                        on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(0); }}
                                        data-tip={epLinkHint(type, 0, episodeTitles[0], !!episodeFiles[0] || !!episodeUrls[0])}><Icon icon="play" size={12} /> 观看</button>
                                </span>
                            {:else}
                                {#each Array.from({ length: Number(totalEpisodes) }, (_, i) => i) as i}
                                    <span class="rl-ep-wrap" class:linked={!!episodeFiles[i] || !!episodeUrls[i]} class:cur-ep={episode >= 1 && i + 1 === episode}>
                                        <button
                                            class="rl-ep-btn"
                                            on:click={() => playOrOpenEpisode(i)}
                                            on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(i); }}
                                            data-tip={epLinkHint(type, i, episodeTitles[i], !!episodeFiles[i] || !!episodeUrls[i])}>{i + 1}</button>
                                    </span>
                                {/each}
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
                        <label class="rl-lbl-inline">{type === 'movie' ? '标题' : '集标题'}</label>
                        <input class="rl-input rl-ep-edit-input" value={editTitle} on:input={(ev) => (editTitle = inputVal(ev))} placeholder="如：开始" />
                        <label class="rl-lbl-inline">本地路径</label>
                        <div class="rl-ep-edit-row">
                            <input class="rl-input rl-ep-edit-input" value={editLocal} on:input={(ev) => (editLocal = inputVal(ev))} placeholder="库内路径，或系统绝对路径" />
                            <button class="rl-btn rl-link-act" on:click={(ev) => browseLocalVideo(ev)} data-tip="选择本地视频">浏览</button>
                        </div>
                        <!-- 🔴 #501②（用户：「『网络地址』旁那枚 B站 改成小图标搜索、放在网络地址**标题**旁边平行
                             （像文件夹检索剧集按钮那样）」）：从**输入框行**里挪出来、贴到**标签行**，且收成
                             **纯图标** —— `.rl-edit-lblrow` + `.rl-ai-btn`，与「检索库内同名书籍」（⑥）、
                             「从文件夹检索剧集」**同款同位同手感**。
                             ⛔ 别在下面那行再留一枚（同款入口两处 = 用户会以为两个功能）；
                             ⛔ 也别写成带文字按钮（本仓小图标统一的形态就是这个）。
                             · 检索词初值 = 作品标题 + 集标题（可改）；
                             · **点一条把链接填进下面那个框**（与「粘贴」同一条纪律：仍要点「保存」才写回条目）；
                             · ⛔ 浮层内**一条滚动条**：本体沿用 `.rl-ep-edit`（fixed 居中卡片，自身不带滚动），
                               只有列表那块内部滚动。 -->
                        <div class="rl-edit-lblrow">
                            <label class="rl-lbl-inline">网络地址</label>
                            <button
                                class="rl-ai-btn"
                                data-tip="在 B 站搜这一集，点候选把链接填进来"
                                on:click={() => void openEpBiliPicker()}>
                                <span class="rl-sr">在 B 站搜索这一集</span>
                                <Icon icon="search" size={13} />
                            </button>
                        </div>
                        <div class="rl-ep-edit-row">
                            <input class="rl-input rl-ep-edit-input" value={editUrl} on:input={(ev) => (editUrl = inputVal(ev))} placeholder="https://…" />
                            <button class="rl-btn rl-link-act" on:click={() => void pasteEpUrl()} data-tip="粘贴链接">粘贴</button>
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
                                            placeholder="检索词（默认 作品标题 + 集标题）" />
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
                        <div class="rl-ep-edit-ops">
                            <button class="rl-btn" on:click={saveEpEditor} data-tip={'保存'}>保存</button>
                            <button class="rl-btn" on:click={clearEpEditor} data-tip={'清除'}>清除</button>
                            <button class="rl-btn" on:click={closeEpEditor}>取消</button>
                        </div>
                    </div>
                {/if}
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
            <div class="rl-stars-input">
                {#each [1, 2, 3, 4, 5] as n}
                    <span class:on={n <= rating} on:click={() => setStar(n)}>★</span>
                {/each}
                <span class="rl-stars-val">{rating ? `${rating}/5` : '未评分'}</span>
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
                {#if entry.type === 'book'}
                    <button class="rl-btn rl-btn-accent" on:click={onAddExcerpt} data-tip="粘贴文本生成摘抄">添加摘抄</button>
                {:else if entry.type === 'game'}
                    <button class="rl-btn rl-btn-accent" on:click={onRecordPlaySession} data-tip="记一次游玩（日期 + 时长 + 心得）">记录游玩</button>
                {/if}
            {/if}
        </div>
        <div class="rl-fft-right">
            {#if picked}
                <button class="rl-btn rl-btn-primary" disabled={!title.trim()} on:click={submitSafe}>{entry ? '更新笔记' : '保存并生成笔记'}</button>
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
    /* 填充：纯色 + 平滑宽度过渡 */
    .rl-progress-fill {
        height: 100%; border-radius: 4px;
        background: var(--interactive-accent);
        transition: width .3s ease;
    }
    .rl-progress-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5px; font-size: 11px; color: var(--text-faint); }
    .rl-progress-label { color: var(--text-muted); }
    .rl-progress-eta { color: var(--text-faint); }
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
    .rl-stars-input { font-size: 20px; color: var(--rl-score-input); cursor: pointer; letter-spacing: 2px; }
    .rl-stars-input span.on { color: var(--rl-score); }
    .rl-stars-val { font-size: 11px; color: var(--text-muted); margin-left: 8px; }
    .rl-link-row { display: flex; gap: 6px; margin-top: 5px; }
    .rl-link-label { width: 110px; flex: none; }
    /* 观看链接行操作按钮（浏览/播放/打开/复制/清除）：小图标紧凑样式，hover 高亮 */
    .rl-link-act { padding: 2px 8px; flex: none; font-size: 12px; line-height: 1.4; }
    .rl-link-act:hover:not(:disabled) { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-link-act:disabled { opacity: .4; cursor: not-allowed; }
    /* 观看链接区块：1..N 集按钮网格，左键播放/打开、右键编辑；本地绿点 / 网络蓝点双角标 */
    .rl-ep-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    /* 「观看链接」标题行：label + 批量检索小图标（动画/电视剧）并排；行内覆盖 label 底边距防图标下沉。
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
    /* 🔴 #447 当前进度所在的那一集（用户：「如在影视类型条目里的当前进度集标记为5，那么在观看按钮第 5 集按钮标记为黄」）：
       **黄环**标记（1px 黄边 + 2px 黄外环），画在按钮**外沿** —— 与「已关联」的 accent 实底叠加时照样看得见。
       ⛔ 不改底色 / 不改文字色：底色已被「已关联」占用（一个按钮的底色只表达一件事），而黄字在白底只有 2.4:1（§2.1 明令）。
       ⚠️ 集按钮间距 6px ≥ 外环 2px，相邻环不会互压。判据 = 当前进度（`episode`，1 基；0 = 还没开始看 ⇒ 不标）。 */
    .rl-ep-wrap.cur-ep .rl-ep-btn { border-color: var(--rl-progress-now); box-shadow: 0 0 0 2px var(--rl-progress-now); }
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
    .rl-ep-edit-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .rl-ep-edit-head .rl-ep-edit-title { margin-bottom: 0; }
    .rl-ep-edit-row { display: flex; gap: 6px; margin-bottom: 6px; }
    /* 🔴 #500⑥「标签 + 贴着它的小按钮」一行：某些浮层里那枚按钮作用的对象就是下面那个框
       （书籍「文件路径」旁的「检索同名书籍」），挂在标签旁比挂在标题行更好找。
       ⚠️ `.rl-lbl-inline` 平时是块级独占一行（下面直接跟一个框），进到这一行里必须收成 inline。 */
    .rl-edit-lblrow { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
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
</style>
