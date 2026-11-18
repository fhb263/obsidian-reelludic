/**
 * B 站风选集页（#691，2026-10-27）—— **独立视图页**，不是「播放器里塞侧边栏」。
 *
 * 🔴 用户原话（2026-10-27）：
 *   「②系列卡播放按钮打开的选集页面改成 B 站风格的选集**新页面**，加个**内置播放器**」，
 *   随后四项裁定：①真同屏 ②每段 50 ③「结束页不留」④B 站评分位在海报墙上同单卡同位。
 *
 * 🔴 为什么是「继承播放器」而不是「自己拼一个 video」：
 *   本仓播放器的上一集/下一集、播放模式、续播位置、字幕挂载、标记、截图、时间戳、后台播放
 *   全在 `VideoPlayerView` 里（2000+ 行）。自己拼一个 `<video>` = 把上面全部重写一遍，
 *   而且两套必然漂（本仓铁律「同一概念只准一份真源」）。
 *   ⇒ 这里**继承**它，只覆写三个骨架钩子：容器换成左栏、右栏自己填、当前集高亮跟随。
 *
 * ⚠️ 基类里那些 `private` 状态（`cur` / `opts` / `subCandidates`…）**一律不碰**，
 *    只经 `protected` 读数（`curIndex()` / `currentEpisodeIndex()` / `subtitleSnapshot()`…）取。
 *    基类为此加了纯增量钩子（见 `VideoPlayerView.ts` 的「子类扩展点」段），既有逻辑一行未动 ——
 *    产物断言把播放器那几处计数逐字钉死了（`opened = false;` / `this.opened = true;` /
 *    `if (this.opened) this.buildUi();` / `.pauseForOtherPlayer(` / `playersToPause(`）。
 *
 * 🔴 类名前缀 = `rl-epp-`（**三个 p**）：`rl-ep-` 已被编辑表单占用、`rl-epg-` 是象形稿、
 *    `rl-eps-*` 是选集弹窗（被断言按处数锚住）—— 各自归属清楚，不互相顶替。
 */
import { Notice, WorkspaceLeaf } from 'obsidian';
import type { EntryLogKind, EntryTextKind, MediaEntry } from 'data/types';
// 🔴 m02759：`ENTRY_TYPE_LABELS`（`data/types.ts`）与 `BOOK_KIND_LABELS` / `normalizeBookKind`
//    （`pure/bookKind`）曾经只服务于简介栏那排「类型 + 题材」胶囊 —— 用户在 2026-11-17 裁定
//    「只留标签那一排，第一排整排去掉（含『类型』胶囊）」⇒ 那排整块删除，这三个符号在本文件
//    已无消费者，import 一并清掉（留着 `noUnusedLocals` 会报）。
//    ⚠️ 它们的**真源地位没变**：`ENTRY_TYPE_LABELS` 仍是全仓类型中文名的唯一来源，
//      别的文件（表单 / 表格 / 卡片）照旧从 `data/types` 取，⛔ 别以为这里删了 import 就是废弃了。
//    ⛔ 视图层不许自己写 map（「anime」写死成「动画」这种自造词必然与设置页/卡片漂开）。
//    ⇒ 本轮按上面这条把三行 import 一起删掉了（原来这里是
//      `import { ENTRY_TYPE_LABELS } from 'data/types';` 与
//      `import { BOOK_KIND_LABELS, normalizeBookKind } from 'pure/bookKind';`）。
import type { LinkStatus } from 'pure/linkStatus';
import type { EmbedCookieResult } from '../services/embedCookie';
import type { SubtitleCandidate } from 'pure/subtitle';
import { subtitleLangLabel } from 'pure/subtitle';
import {
    emptyStageModeFor,
    episodeCellCount,
    episodeCells,
    EPISODE_PAGE_SIZE,
    cueSourceKey,
    nextCellsMode,
    nextCellsOrder,
    orderCells,
    pageRangeLabel,
    pickRecommendations,
    rangeBarVisible,
    relatedSeasons,
    seasonOrdinalLabel,
    type CellsMode,
    type CellsOrder,
    type EpisodeCell,
} from 'pure/episodePage';
import { pageBarItems, pageSlice, pageStep } from 'pure/epPages';
// 时间戳格式化与基类同源（⛔ 不另写一份时钟格式：控制条、微件必须显示同一种写法）
import { formatTime } from 'pure/player';
// 个人评分的星星渲染与其它三处（卡片 / 表格 / 笔记导出）同源，⛔ 别自己拼 ★☆
import { cardCreator, hasCardCreator } from 'pure/cardMeta';
import type { EpCoverPlan } from 'pure/epCover';
import {
    activeCueIndex,
    appendTranscribeLine,
    cueLangOptions,
    CUE_LOADING_HINT,
    formatStamp,
    lockScrollTop,
    LOCK_LINE_INDEX,
    lockLineFor,
    panelStateOf,
    parseSubtitleText,
    transcribeHeadline,
    type Cue,
    type TranscribeLine,
} from 'pure/subtitleCues';
// 🔴 用户 m12123：「还有这个滚动条给我去掉」，并在追问里选定「整条 mini-map 全部去掉」。
//    ⇒ 原先这里 import 的 6 个几何函数（`activeTickIndex`/`buildMapTicks`/`indexToRatio`/
//    `mapIndexAtRatio`/`mapThumbFor`/`shouldShowMap`）与 `pure/cueMinimap` 整个模块一并删除。
//    ⛔ 别再「为了保留导航能力」把它加回来 —— 用户是看着它像一根粗滚动条才要求去掉的。
// 词级 span：只剩「学习模式悬停查词」用（⛔ 别再点亮单个词 —— 中文按字切，一行只亮一个字）
import { wordSpansFor } from 'pure/wordTiming';
// ⚠️ 历史：这里曾 import `pure/typewriter`（typewriterDuration / typewriterSplit / typewriterVisibleCount）
//    与 `pure/cuePacer`（CUE_PACE_FRAME_MS / cuePacePending / cuePaceStep），用于 AI 总结的逐字动画。
//    用户 2026-11-13 明确要求「不要打字机动效，一次输出完毕」⇒ 两条通道与两个模块已删除，⛔ 别再加回来。
// 学习模式（单句循环 / AB 复读 / 影子跟读 / 查词键归一）：纯逻辑，有单测（`tests/learnMode.test.ts`）
import {
    SHADOW_GAP_CHOICES,
    SHADOW_GAP_DEFAULT,
    abFromCues,
    isLookupable,
    lookupKey,
    loopRangeOf,
    loopSeekTarget,
    makeAbPoints,
    normalizeShadowGap,
    shadowCountdownText,
    shadowLeftMs,
    shadowShouldPause,
    type AbPoints,
    type LoopKind,
} from 'pure/learnMode';
import { safeSetIcon } from '../services/safeIcon';
// 图标按钮的提示 + 读屏名统一走组件基座（①-9：⛔ 别再手写 aria-label）
import { srLabel, setTip } from '../ui/components';
// 🔴 大众评分的展示口径**唯一真源**是 `pure/scoreDisplay`（`97%` 百分比优先 / 整数直出 / 非整数一位）。
//    ⛔ 别在这里另写一份 `communityScore ?? reviewPercent` —— 列表角标、表格列、笔记行都走它。
// 🔴 m02759（2026-11-17）：本文件**不再** import `scoreIsPercentOf` / `scoreTextOf` ——
//    它们原先只服务于封面右上角那颗评分角标，用户已裁定「封面上的评分角标去掉」
//    （分数改由 `buildSourceLine` 画在简介栏第一行右侧）⇒ 两个符号在本文件无消费者。
//    ⚠️ 真源没变、别的文件照旧用它（`pure/scoreDisplay` 仍是大众评分展示的唯一出处，
//      卡片网格 / 表格 / 笔记渲染都靠它），⛔ 别以为这里不 import 就是废弃了。
// ③ 单集评价面板（用户 m00002）：状态/标签/心情/短评的**全部判据**都在这个纯模块里，
//    ⛔ 别在视图层另写一份 —— 选集格子的特效类也是它算的（`episodeCellEffect`）。
import {
    EPISODE_TAGS,
    EPISODE_TAG_LABELS,
    EPISODE_WATCH_STATUSES,
    EPISODE_WATCH_LABELS,
    episodeCellEffect,
    isEmptyEpisodeReview,
    reviewAt,
    type EpisodeReview,
    type EpisodeTag,
    type EpisodeWatchStatus,
} from 'pure/episodeReview';
import { MOODS, moodTip, type MoodId } from 'pure/mood';
// 🔴 m02759（2026-11-17）：本文件**不再** import `entrySourceLabel`（`pure/sourceMeta`）——
//    它原先只服务于封面右上角那颗评分角标的 `data-tip`，角标随用户裁定整块删除后没有消费者了。
//    ⚠️ 来源中文名的真源仍是 `pure/sourceMeta`（卡片角标 / 卡片网格 / 笔记都用它），⛔ 别当废弃。
import {
    biliEmbedUrl,
    canEmbedBili,
    EMBED_LOAD_TIMEOUT,
    NET_BAR_EXIT,
    NET_BAR_OPEN,
    NET_BAR_TITLE_FRAME,
    NET_LOAD_FAIL,
} from 'pure/biliEmbed';
import {
    canPlayNetInline,
    netEmbedFailText,
    netEmbedFallbackUrl,
    netOfficialEmbed,
} from 'pure/netInline';
import { netCueEmptyCopy, type NetCueFailReason } from 'pure/netCueCopy';
import type { CueSummaryInput, CueSummaryResult, CueAskTurn } from 'pure/cueSummary';
import { CUE_ASK_HISTORY_TURNS } from 'pure/cueSummary';
import { embedVideoAvailable, readEmbedVideo, seekEmbedVideo } from '../services/embedVideo';
// ⚠️ 只引**类型与工厂**：视图层不认识 `plugin`，转写仍全程由宿主注入（见 `transcribe`）。
import { createAsrCancelToken, type AsrCancelHandle } from '../services/asr';
import { bind as bindComponent } from 'svelte/internal';
import EntryContextMenu from 'views/components/EntryContextMenu.svelte';
// 🔴 用户 2026-11-08：「简介封面右键菜单不要显示观看、删除条目项」⇒ 隐藏口径放在纯模块里
import { EPISODE_COVER_MENU_HIDE } from 'pure/entryMenu';
// 🔴 用户 2026-11-08：「字幕面板的滚动改要有动效而不是瞬间切换」⇒ 平滑滚动 + reduced-motion 降级
import { scrollBehavior } from 'pure/motion';
import { VideoPlayerView, type EmbedVideoItem, type VideoPlayerOptions } from './VideoPlayerView';

/** 视图类型（main 层 `registerView` 与打开入口共用） */
export const EPISODE_PAGE_VIEW_TYPE = 'reelludic-episode-page';

/**
 * 条目右键菜单的**动作集**（宿主注入；与 `EntryContextMenu.svelte` 的 props 一一对应）。
 *
 * 🔴 为什么单独抽这个接口：它是视图层唯一需要「宿主那边的 7 件事」的通道，
 *    写进 `EpisodePageExtras` 会把这 7 条动作混在一堆播放器字段里，看不清边界。
 * ⚠️ 类型从 `data/types` 来（`EntryLogKind` / `EntryTextKind`），⛔ 别在本文件重声明一份
 *    —— 那会和 `EntryContextMenu` 的 props 类型脱钩，改一处漏一处。
 */
export interface EntryMenuActions {
    /** 主操作（观看 / 阅读 / 启动 / 播放） */
    onWatch: (e: MediaEntry) => void;
    /** 关联入口弹窗 */
    onQuickAssociate: (e: MediaEntry) => void;
    /** 编辑属性（打开完整表单） */
    onEditEntry: (id: string) => void;
    /** 添加摘抄（文学 / 网文） */
    onAddExcerpt: (book: MediaEntry) => void;
    /** 记录类弹窗（重温 / 周目 / 时长） */
    onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => void;
    /** 文本类弹窗（短评 / 攻略） */
    onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => void;
    /** 删除条目（确认在宿主里） */
    onDeleteEntry: (id: string) => Promise<void>;
}

/**
 * `EntryContextMenu.svelte` 的命令式句柄（只有视图用得上的那两个方法）。
 *
 * ⚠️ 为什么要自己声明：`.ts` 文件里 `import X from '*.svelte'` 走的是 svelte 自带的
 *    环境声明 —— 那个声明把默认导出窄化成 `SvelteComponent`，**`export function` 一概不认**
 *    （`node_modules/svelte/types/index.d.ts:1803`）。所以 `new EntryContextMenu(...)` 之后
 *    直接 `.openAt(...)` 会报 TS2339。
 * ⛔ 别改成 `as any`：那样把「组件真有这个方法吗」的校验一起丢了，改名后要到运行时才炸。
 * ✅ 这里只声明**视图真正调用的**两个方法 —— 不整份抄组件 API，抄漏了反而查不出拼错。
 */
interface EntryMenuHandle {
    openAt(entry: MediaEntry, ev: MouseEvent): Promise<void>;
    close(): void;
    /** svelte 组件实例都有的销毁方法（svelte 4.2.2：`$destroy()`） */
    $destroy(): void;
}

/**
 * 选集页的额外上下文（播放器选项之外，只有这一页用得上）。
 *
 * 🔴 为什么另开一个接口而不是往 `VideoPlayerOptions` 里塞：
 *    那些字段（剧集数组 / 链接状态 / 其他季）**只有选集页**需要；
 *    塞进 `VideoPlayerOptions` 会让普通播放器多背一堆它永远不用的可选字段（两套口径又开始漂）。
 */
export interface EpisodePageExtras {
    /** 条目快照（标题 / 封面 / 简介 / 类型 / 系列 …） */
    entry: MediaEntry;
    /** 本地剧集（`episodeFiles`，可稀疏 —— 下标即集号） */
    files: readonly (string | undefined)[];
    /** 网络剧集（`episodeUrls`，与 `files` 同下标） */
    urls: readonly (string | undefined)[];
    /** 集标题（`episodeTitles`，与 `files` 同下标） */
    titles: readonly (string | undefined)[];
    /** 网络链接检测结果（与 `files` 同下标；没测过 = undefined，⛔ 不标红） */
    statuses: readonly (LinkStatus | undefined)[];
    /** 声明的总集数（`progress.totalEpisodes`；可能比已关联的更长） */
    total: number;
    /** 当前看到的那一集（0 基，`progress.episode - 1`）；非法 = -1 */
    currentIndex: number;
    /** 全库条目（算「本系列其他季」，⛔ 不是筛过的当前页） */
    allEntries: readonly MediaEntry[];
    /** 封面图 URL（宿主转好；没有 = null） */
    coverUrl: string | null;
    /** 任意一季的封面图 URL（宿主转好；季带逐卡取，⛔ 不能拿当前这部顶替） */
    seasonCover: (entry: MediaEntry) => string | null;
    /**
     * **逐集封面计划**（宿主注入：`main.epCoverFor` —— 本地视频首帧 / B 站缩略图 / 统一占位图）。
     *
     * 🔴 为什么是「计划」而不是「图 URL」：本地集根本没有图，只能靠 `<video preload="metadata">`
     *    让浏览器解首帧；这个判断（能不能定位到文件 / 是不是 B 站）在本仓只有宿主会做。
     *    视图层只按计划渲染 —— 与 `EpisodePickerModal` 完全同一条口径（⛔ 不另造第二套取图逻辑）。
     * ⚠️ **可选**：没注入就只画灰底占位，⛔ 不猜路径、不显示破图。
     * ⚠️ 按需调用（只问屏幕上那几十格），实现方自带 `B站 bvid` 级缓存与串行闸门。
     */
    episodeCover?: (idx: number) => EpCoverPlan | Promise<EpCoverPlan>;
    /** 简介（可空） */
    overview: string;
    /** 点「相关推荐」里的一季 ⇒ 宿主换到那一季 */
    onOpenSeason: (entry: MediaEntry) => void;
    /**
     * **按最新条目重算「本地可播集」列表**（宿主注入，可选）。
     *
     * 🔴 用户 2026-11-16 逐字：「播放器详情页的右键更新了关联入口链接，但视频播放器不刷新」。
     *    根因：`EpisodePageOptions.items` 是打开那一刻由宿主 `buildEmbedItems` 算好的**快照**，
     *    关联入口改完之后没有任何通路能把它换成新的 —— 页面上的选集、上一集/下一集、
     *    甚至正在播的那条 `src` 都还指着旧路径。
     *
     * ⚠️ 为什么是「宿主回调」而不是让视图自己算：能不能内嵌取决于 `isEmbeddableVideoPath` +
     *    `resolveEmbedUrl`（库内 `app://` / 库外 http 的解析规则），那是宿主侧的知识，
     *    视图层拿不到（本仓分层：视图只认 `pure` + 注入的回调，⛔ 别在这里重新实现一遍过滤）。
     * ⚠️ 可选：没注入就不重算（⛔ 不要退回「什么都不做还假装刷新了」——
     *    调用点判空后直接跳过重算那一步，标题块与简介卡照常更新）。
     */
    reloadItems?: (entry: MediaEntry) => readonly EmbedVideoItem[];
    /**
     * 条目右键菜单的**动作集**（宿主注入）：简介里的封面右键弹
     * **与海报墙同一个** `EntryContextMenu`。
     *
     * 🔴 用户 2026-11-08 逐字：「同时简介的封面可右键可弹窗菜单（同海报墙编辑属性逻辑）」，
     *    并在追问里选定「整个海报墙菜单」而不是只留「编辑属性」一项。
     * ⚠️ 为什么是「回调集」而不是让视图自己拼菜单项：那 7 条动作全都要 `plugin`
     *    （`runEntryAction` / `quickAssociateEntry` / `openEditModal` / `openExcerptModal` /
     *    `openEntryLogModal` / `openEntryTextModal` / `deleteEntry`），视图层拿不到 `plugin`
     *    （本仓分层：视图只认 `pure` + 注入的回调）。
     * ⛔ 别在视图里再写一份菜单项 —— 那正是「两份菜单必然漂移」的老病
     *    （`EntryContextMenu.svelte` 文件头第 9-10 行就是为这条被抽出来的）。
     * ⚠️ 可选：没注入时不挂右键（⛔ 不弹一个只有「关闭」的空菜单）。
     */
    entryMenu?: EntryMenuActions;
    /**
     * **左键单击简介封面 ⇒ 打开条目笔记**（宿主注入，可选）。
     *
     * 🔴 用户 2026-11-14：「播放器详情页简介封面加左键单击进笔记」。
     *
     * ⚠️ 为什么是独立回调而不是塞进 `entryMenu`：`entryMenu` 那七条全是**动作类**
     *    （观看 / 编辑 / 删除…），由 `EntryContextMenu` 统一渲染；而「打开笔记」不是一个
     *    菜单项，它直接绑在封面上的一次普通点击 —— 混进去会让右键菜单凭空多一项，
     *    与本页 `EPISODE_COVER_MENU_HIDE` 的既有口径打架。
     * ⚠️ 可选：没注入就**不挂左键**（⛔ 不要挂一个点了没反应的监听，那是假功能）。
     *    ⛔ 也别在视图里自己打开文件 —— 视图层拿不到 `app`，唯一出口是宿主 `openEntryNote`。
     */
    onOpenNote?: (id: string) => void;
    /**
     * 点「全部 N 部」⇒ 宿主打开既有的季列表弹窗（`SeriesPickerModal`）。
     * 🔴 为什么还要留这条：15 部的大系列靠「相关推荐」那一行翻不完，弹窗是**一次看全 + 排序号**
     *    的唯一入口（它还挂着 `SeriesReorderModal`）⇒ 新页只新增直达路，⛔ 不把旧入口拆掉。
     */
    onOpenSeriesList: () => void;
    /**
     * 「把这条链接交给宿主去开」—— 兜底出口，本地集与网络集共用。
     *
     * ⚠️ 2026-10-31 改口径：原来这里写的是「点一集『只有网络地址』的格子 ⇒ 宿主开浏览器」，
     *    现在**不再是主路径**了 —— 网络格先走 `canPlayNetInline` 进内置播放态（B 站 + YouTube），
     *    只有「不可内联」或「YouTube 取流失败」时才落到这里。
     *    ⛔ 别把它当成网络集的正常出口：那正是用户报障「油管链接还是跳转网页」的旧行为。
     */
    onOpenUrl: (url: string) => void;
    /**
     * **打开就落在这一集的 B 站内嵌上**（宿主传；没有 = 不自动内嵌）。
     *
     * 🔴 报障根因（用户 2026-11-02「在其中一季点击播放按钮会直接跳转浏览器播放」修复后的第二层）：
     *    宿主把「季里点的是网络集」分流到选集页之后，页子并不知道用户点的是**哪一集**——
     *    `startIndex` 是 `items`（**本地可内嵌集**）的下标，纯网络集在 `items` 里根本不含，
     *    `findIndex` 得 -1 ⇒ 页子停在第 0 集、本地播放器照常起来，用户看到的是「点了没反应」。
     *    ⇒ 由宿主显式给出「起始是个网络集，集号是 N」，页子打开后自己进内嵌态。
     * ⚠️ 只在**首次**渲染消费一次（见 `pendingNetStart`），⛔ 别常驻：用户后来点回本地集，
     *    这个字段还活着就会把他又弹回内嵌。
     */
    startNet?: number;
    /**
     * 「打开就进内嵌」时该落到第几秒（秒）。
     *
     * 🔴 用户 2026-11-11：「全屏能播，回到详情页一直缓冲中播不了」——
     *    回跳原来只传集号，`mountNetVideo` 的 DASH 分支写死 `resumeAt = 0`
     *    ⇒ 从第 0 片重下整片，用户看到的就是「一直缓冲」。
     * ⚠️ 只跟 `startNet` 一起用（没有起始网络集就没意义）。
     */
    startNetSeek?: number;
    /**
     * 取当前网络集的 B 站字幕（含 AI 字幕），供时间轴面板用（宿主注入，可选）。
     *
     * 🔴 用户 2026-11-09 逐字：「播放网络集的字幕面板能不能显示其b站的AI字幕」
     *
     * ⚠️ 与 `netStream` 分开：取流是起播关键路径，字幕是到了再画即可；
     *    合成一次会让「字幕接口慢」变成「视频起播慢」。
     *
     * 🔴 用户 2026-11-11（m06406 ④）要求字幕面板区分两种失败：
     *    ① 未填 / 失效 Cookie（该去重填）；② Cookie 正常但解析不出轨（重填也没用）。
     *    这两种在界面上长得一样，**用户该做的事却完全相反** ⇒ 宿主必须把原因带出来。
     *    ⚠️ 返回值里的 `reason` 就是那个判据，⛔ 别缩回一个光秃秃的 `null`：
     *       那样视图只能猜，猜错就是把用户往设置页瞎指挥。
     */
    netSubtitle?: (url: string) => Promise<
        | { fileName: string; text: string; isAi: boolean }
        | { fail: NetCueFailReason }
        | null
    >;
    /**
     * AI 总结整条字幕（宿主注入，可选）：面板工具条那颗 ✨ 用它。
     *
     * 🔴 用户 2026-11-11 逐字：「给字幕加个AIAI面板总结按钮小图标放在时间轴定位按钮右旁
     *    点击在字幕面板上浮出AI面板」
     *
     * ⚠️ 与 `netSubtitle` 分开：那条是「取数据」，这条是「拿数据去另一家服务算」，
     *    混成一个回调会让「字幕晚到」和「AI 没配」两种失败分不开。
     * ⚠️ 失败一律返回 `null`（宿主侧已经 Notice 过），面板只需退出加载态。
     */
    cueSummary?: (input: CueSummaryInput) => Promise<CueSummaryResult | null>;
    /**
     * **流式**生成字幕总结（宿主注入，可选）。用户 m09565 ①-8：
     * 「字幕面板-AI总结输出动效改成流式打字机（在接收到流式文本片段时，
     * 以固定节奏逐段追加到 DOM，而不是等全部完成再一次性渲染。）」
     *
     * 🔴 与 `cueSummary` 的关系：**返回值完全同构**（都是 `CueSummaryResult | null`），
     *    差别只在 `onPartial` 会在生成过程中被反复调用、每次传**累积全文**。
     *    ⇒ 视图层拿到结果后走的还是同一条 `showCueAiPanel(got)`，不用两套渲染。
     * ⚠️ 宿主没注入这条（移动端 / 老版本宿主）⇒ 自动退回 `cueSummary`，
     *    此时 `onPartial` 只被调一次。⛔ 别让它成为必需项，否则功能会整体消失。
     */
    cueSummaryStream?: (
        input: CueSummaryInput,
        onPartial: (summary: string, done: boolean) => void,
    ) => Promise<CueSummaryResult | null>;
    /**
     * 就当前这一集的字幕提问（宿主注入，可选）：AI 面板底部的提问框用它。
     *
     * 🔴 用户 2026-11-11（第二轮）逐字：「给字幕面板的AI改现代化点，如透明化去边框，给加个提问框」
     *
     * ⚠️ 与 `cueSummary` 走同一条服务行 / 同一把 Key / 同一个开关（宿主侧就拦在同一个
     *    `readerCueSummaryProvider` 上），视图层只需当它是「另一件可以用同一份配置做的事」。
     * ⚠️ `history` 由视图侧维护并传进来：网络请求是无状态的，模型记不住上一轮，
     *    宿主拿不到「刚才问了什么」，所以历史只能从面板拿。
     */
    cueAsk?: (input: CueSummaryInput, question: string, history: CueAskTurn[]) => Promise<string | null>;
    /**
     * 查一个词的释义（宿主注入，可选）：学习模式悬停气泡用它。
     *
     * 🔴 用户 m01938 §3.1：「Hover 到某个英文单词，向上浮出气泡（显示音标、简短释义 + 🔊 发音）」。
     *
     * ⚠️ **第三期才真正接词典**（ECDICT 约 30MB，绝不能进 `main.js`）：
     *    现在没注入时气泡只显示词形与发音按钮，⛔ 不显示空的「释义：」占位
     *    —— 那看起来像坏了，比没有更糟。
     * ⚠️ 入参已由视图层 `lookupKey()` 归一（小写 + 剥首尾标点），
     *    宿主不必再处理 `Apple,` / `APPLE` 这类变体。
     */
    lookupWord?: (key: string) => Promise<{ def: string; phonetic?: string } | null>;
    /**
     * 「上一次网络取流为什么失败」的**如实原因**（宿主注入；没有就返回 null）。
     *
     * 🔴 为什么需要它（2026-10-31）：网络集现在固定走官方 iframe，拼不出内嵌地址
     *    这时唯一负责任的做法是把原因告诉用户（代理没填 / 被要求验证机器人 / 只有 AV1 轨）。
     *    而这些原因只有宿主侧知道（`main.ts` 的 `lastYtError`），视图层拿不到。
     * ⚠️ 是**函数**不是字符串：`lastYtError` 每次取流都会变，进页面时快照成字符串会显示上一次的旧错误。
     */
    netFailHint?: () => string | null;
    /**
     * 把设置里填的 Cookie 同步进 Electron 的 cookie jar（宿主注入；官方内嵌 iframe 靠它拿登录态）。
     *
     * 🔴 2026-10-31 用户报障：「B站/油管内嵌的怎么还有登录，不上填了 cookie 吗」——
     *    设置页那串 Cookie 只喂插件自己的 API 请求，而官方内嵌 iframe 跑在 Electron
     *    自己的浏览上下文里，读的是 Chromium 的 cookie jar，两边从来没打通
     *    （真机实测：`bilibili.com` / `youtube.com` 在该 jar 里都是 **0 条**）。
     *    ⇒ 挂 iframe 之前先把设置里那串写进去，否则用户填了也永远是未登录。
     *
     * ⚠️ 是**函数**：设置随时可能改，快照会让用户改完还得重开页子。
     * ⚠️ 没注入 = 什么都不做（非 Electron 环境 / 老宿主），⛔ 别当成错误。
     */
    syncEmbedCookies?: () => Promise<EmbedCookieResult>;
    /**
     * 「全屏①」的落点：把**当前这一集**交接给内置播放器标签页（宿主注入）。
     *
     * 🔴 用户 2026-11-06 逐字：「再点全屏进入该原播放器标签页」。
     *    改前这颗按钮只在本页打一个 `data-fs` 样式态（右栏/季带藏起来），用户要的是
     *    **离开选集页、回到那个内置播放器标签页**继续看 —— 两个完全不同的语义。
     *
     * `info` 三件套（缺一件都接不上）：
     * - `index` 当前**真实集下标**（`activeCellIndex()`：网络集态取 `netIndex`，否则取组件库口径）；
     * - `seconds` 本页播到的秒数（本地集/网络流都在自己手里，⛔ 不是 iframe 那种读不到）；
     * - `net` 这一集是不是网络流（决定宿主是「按集号挑 items」还是「先取流再开」）。
     *
     * ⚠️ 没注入 ⇒ 按钮退化成「无操作」而不是报错：宿主没给落点时不假装能交接。
     */
    onOpenPlayerTab?: (info: {
        index: number;
        seconds: number;
        net: boolean;
        /**
         * 本页的画质是否**已经降级**（DASH 管线失败过、现在在播 durl 直连）。
         *
         * 🔴 用户 2026-11-19：「b站的网络集用插件播放器播放又不在一条轨上了，
         *    详情页播放器和全屏播放器不是一个轨的了」——宿主据此让播放器页
         *    **沿用在播的直连**，而不是重新建一条 1080P 分片管线。
         * ⚠️ 只在 `net === true` 时有意义；本地集恒为 `false`。
         */
        degraded?: boolean;
    }) => void;
    /**
     * 手动导入一份字幕喂给**时间轴面板**（用户规格「空状态提供手动导入 .srt / .ass 入口」）。
     *
     * 🔴 只读原文，⛔ 不转 VTT、⛔ 不挂 <track>：
     *    面板要的是「能解析成行的文本」，`.ass` 更是**根本没有** VTT 转换通路（`pure/subtitle.ts` 只认 srt/vtt）。
     *    挂载态仍归基类 <track> 那条唯一通路管 —— 这里返回的文件**不进** `subFile`，
     *    所以面板与画面字幕是两条独立显示，不会互相把对方的状态改掉。
     * 返回 `null` = 用户取消 / 读失败。
     */
    importCue?: () => Promise<{ fileName: string; text: string } | null>;
    /**
     * 播放断点表**只读副本**（`key` = 剧集下标字符串，值 = 秒），供右栏底部「观看进度」微件使用。
     *
     * 🔴 为什么需要它：基类把 `initialPositions` 存成 **private**，子类读不到；
     *    而微件的「继续观看」要的是**历史断点**，不是当前 `<video>.currentTime`
     *    （刚打开页面时 `currentTime` 还是 0，拿它当断点等于「没看过」）。
     * ⛔ 页面侧**只读**：写回仍走 `onSavePosition` 那条唯一通路，别在这里改这个对象。
     */
    positions?: Readonly<Record<string, number>>;
    /**
     * ③ 单集评价（`catalog.episodeReviews` 的**只读副本**；键 = 集下标字符串）。
     *
     * 🔴 用户 m00002：「播放器详情页（有选集时）在字幕面板上方加单集评价面板」——
     *    未看/在看/已看 + 高光/平庸/槽点 + 六档心情 + 一句话短评，**每集一份**。
     *
     * ⚠️ 与 `positions` 同一手法：透一份拷贝、页面侧只读，写回走 `onSaveReview` 那条唯一通路。
     *    ⛔ 别让页面直接改 `entry.episodeReviews`：那是库里的活引用，绕过 `service.update`
     *    就等于绕过脏检查与笔记 yaml 回写（catalog 变了、笔记没变 = 下次打开笔记覆盖回来）。
     * ⚠️ 形状刻意与 `videoPositions` / `subtitlePaths` 同构（`Record<集下标字符串, …>`）：
     *    三个按集字段共用同一套键空间，「换集即换评价」才和「换集即换进度/字幕」一致。
     */
    reviews?: Readonly<Record<string, EpisodeReview>>;
    /**
     * ③ 单集评价写回（宿主落 `catalog.episodeReviews` + 回写整部/单季 md 的 yaml）。
     *
     * ⚠️ 传**归一后为空**的评价 = 清除这一集（`pure/episodeReview.setReviewAt` 会删键，
     *    整表空了连字段一起消失）—— ⛔ 别在宿主侧另写一套「空就保留旧值」，
     *    那会让用户点了「未看」却怎么都清不掉。
     */
    onSaveReview?: (epKey: string, review: EpisodeReview) => void;
    /**
     * 本地语音转文字（宿主注入，可选）：面板工具条那颗 🎙️ 用它。
     *
     * 🔴 用户 m01938：「在原有的 [✨ AI 总结] 按钮左侧，新增两个图标按钮」的第一颗
     *    「[🎙️ 音频转文字]」；转写完成后「自动刷新字幕面板，新字幕立刻生效」。
     *
     * ⚠️ 为什么是「宿主注入」而不是视图层自己 spawn：ffmpeg / whisper 子进程、模型路径、
     *    vault→系统绝对路径的换算**全在宿主侧**（视图层连 `plugin` 都不认识，见基类
     *    `listSubtitles` / `loadSubtitleVtt` 的同一套注入范式）。视图层只负责按钮、进度条、刷新。
     * ⚠️ 没注入（老宿主 / 非桌面）⇒ 按钮不渲染，⛔ 不画一颗点了没反应的按钮。
     */
    transcribe?: (req: {
        /** 当前集的**本地原始路径**（`currentVideoPath()`；库内相对 / 系统绝对都可能有） */
        videoPath: string;
        /**
         * 进度回调：百分比（`null` = 该段进度不可知）+ 一行给人看的阶段文案 + 句级细节。
         *
         * 🔴 用户 m09995：「转录中还是只有个进度条百分比都不知道转录到哪句时间戳了」
         *    ⇒ 第三参带 `0:12 → 0:19 / 3:40` 这种「已经识别到片子哪一段」的细节；
         *    识别还没出第一句时为 `undefined`，⛔ 不编一个假时间。
         *
         * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
         *    ⇒ 第四参 `line` = 引擎刚识别出的**那一句**，视图层追加到实时流。
         *    没有新句子时为空，⛔ 不要拿 `detail` 去凑一句 —— 那是摘要，不是原文。
         */
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void;
        /**
         * 取消令牌（🔴 用户 m06361：「也没有停止转录的交互」）。
         * 视图层点「停止」时调 `cancel()`；宿主侧把它交给执行层去 kill 子进程。
         * ⚠️ 宿主**必须**在取消后尽快 resolve，⛔ 不能一直等子进程的 close。
         */
        cancel: AsrCancelHandle;
    }) => Promise<TranscribeOutcome>;
}

/**
 * 转写结果（宿主 → 视图层）。
 *
 * 🔴 只回「成了 / 为什么没成」，⛔ 不回 SRT 正文：正文可能几十万字符，
 *    面板要的是「文件写好之后重读一次」（`cueSrc = null` 走既有重解析通路），
 *    把正文塞进消息体等于把同一条链走两遍。
 */
export interface TranscribeOutcome {
    ok: boolean;
    /** 给人看的一句话（成功文案 / 失败原因）；⚠️ 宿主侧已保证不含技术黑话堆砌 */
    message: string;
    /**
     * 被用户主动停止（🔴 用户 m06361「停止转录的交互」）。
     * ⚠️ 与失败分开：停止不该弹「转写失败：…」，也不该把半截产物当成果。
     */
    cancelled?: boolean;
    /**
     * 成功时写出的字幕文件路径（库内相对 / 库外绝对都行）。
     *
     * 🔴 用户 m11423：「SenseVoice转录的文件放哪了啥都没关联」。
     *    文件本身已经写到视频同目录了（`asrSrtPathFor` 口径），但视图层拿不到路径，
     *    就没法调 `onSaveSubtitle` 把它写进 `subtitlePaths` ⇒ 文件躺在那儿没人认领，
     *    下次打开这一集关联依旧是空的。⛔ 别指望「面板自己重扫」能替代落库：
     *    重扫只在当前这次会话里生效，重启 Obsidian 就没了。
     */
    srtPath?: string;
}

export interface EpisodePageOptions extends VideoPlayerOptions {
    /** 选集页专属上下文（必填；没有它这页画不出来） */
    page: EpisodePageExtras;
}

/**
 * 选集格画法 / 集序的**常量表**。
 * 🔴 类型与循环/排序函数从 `pure/episodePage.ts` 导入（那边可单测），这里只留「怎么显示」。
 */
/**
 * 🔴🔴 画法语义（用户 2026-10-29 第二次纠正，**以这次为准**）：
 *  - `list` = **列表**：一行一集，「左封面 + 第 N 集 + 下一行小标题」，竖向排；
 *  - `grid` = **按钮**：纯数字按钮 1 / 2 / 3，没有任何封面和标题。
 *  ⛔ 别再把两者反过来：上一版把 `list` 画成数字格、`grid` 画成封面卡，用户当场驳回
 *     （原话：「列表是为左封面+集数+小标题一行行的…按钮是如 1、2、3 的纯按钮」）。
 *  ⚠️ 常量名沿用 `list`/`grid` 只是**历史 token**（`pure/episodePage.ts` 的单测按这两个 key 循环），
 *     不代表 CSS 里的 `display`——`grid` 这一档现在反而是数字按钮。
 */
const MODE_LABEL: Record<CellsMode, string> = { list: '列表', grid: '按钮' };
/** 模式切换的图标（用户 2026-10-27「纯边框按钮太丑」⇒ 文字按钮改图标；文案只留 `data-tip`/`aria-label`） */
const MODE_ICON: Record<CellsMode, string> = { list: 'list', grid: 'layout-grid' };
/**
 * 🔴 单循环按钮显示的是「**点一下会变成什么**」而不是「现在是什么」（用户 2026-10-29 要的是
 *    「单循环切换按钮」：一颗按钮点一下换一档）。若显示当前态，用户点完图标不变会以为没生效。
 */
const MODE_NEXT_LABEL: Record<CellsMode, string> = { list: '切换到按钮', grid: '切换到列表' };
const ORDER_LABEL: Record<CellsOrder, string> = { asc: '正序', desc: '倒序' };
const ORDER_ICON: Record<CellsOrder, string> = { asc: 'arrow-down-narrow-wide', desc: 'arrow-up-wide-narrow' };
const ORDER_NEXT_LABEL: Record<CellsOrder, string> = { asc: '切换到倒序', desc: '切换到正序' };

/**
 * 右栏字幕面板的入口标题。
 * 🔴 用户 2026-10-30：「『字幕/时间轴』下拉项文案改成『字幕』」—— 原稿 `字幕 / 时间轴`
 *    把两件事写进一个标题，用户只要「字幕」这一档。
 */
const CUE_PANEL_TITLE = '字幕';

/**
 * ③ 单集评价面板的入口标题（用户 m00002：「在字幕面板上方加单集评价面板」）。
 * ⚠️ 改文案只需改这里 —— 面板内的按钮/空态文案都从这里派生，⛔ 别再散落到函数里。
 */
const REVIEW_PANEL_TITLE = '单集评价';

/** ③ 面板里「未看」那一档的提示语（与 `EPISODE_WATCH_LABELS` 同源，只补一条说明语义的 tip） */
const REVIEW_STATUS_TIPS: Record<EpisodeWatchStatus, string> = {
    unwatched: '还没看这一集',
    watching: '看了一部分',
    watched: '这一集看完了',
};

/** ③ 标签的悬浮提示（`EPISODE_TAG_LABELS` 只管中文名，tip 要说明它会带来什么视觉） */
const REVIEW_TAG_TIPS: Record<EpisodeTag, string> = {
    highlight: '这一集有高光时刻 · 选集格子会流光',
    plain: '中规中矩的一集（不影响格子外观）',
    flaw: '这一集有槽点 · 选集格子会崩坏',
};

/**
 * 起播预取的**最长等待时间**（毫秒）：等这么久还没预取完，就不再等，直接把直链交给 `<video>`。
 *
 * 🔴 为什么要设上限（2026-11-04 真机实测）：
 *   预取 16MB 有界 Range 在**快网**下 1.792 秒完成、随后 `loadedmetadata` 只要 285ms（比不预取的
 *   11.8 秒强 24 倍）；但同一份代码在**慢网**下实测要 **21.7 秒**才读完 16MB（≈0.77MB/s），
 *   真机上曾出现「点了格子，`<video>.src` 一直为空、14 秒后仍黑屏」的失败态。
 *   旧实现是「预取 Promise 完成 → 才设 `src`」⇒ 慢网用户对着**纯黑屏**等 20 秒以上，
 *   体感比「不预取直接慢加载」还差（后者至少立刻出进度环）。
 *   ⇒ 改成限时预取：最多等这么久，超时就 abort 掉预取、立刻设 `src`。
 * ⚠️ 值不能 ≤ 1.8 秒：快网预取本身要 1.792 秒，闸门比它短就会**在下线前一刻掐断**，
 *   把 285ms 的收益白白退化回 11.8 秒。取 3 秒 = 留 1.2 秒余量。
 * ⚠️ 值也不能太大：慢网 0.77MB/s 下每多等 1 秒都是纯黑屏，且 `<video>` 自己重载只要 ~11.3 秒
 *   （12.47MB moov / 1.1MB/s 限速），等到 3 秒再放弃 ⇒ 总耗时 ~14.3 秒，仍明显优于死等 21.7 秒。
 */
const NET_PREFETCH_GATE_MS = 3000;

/**
 * 播放中卡顿时，多久之后才亮「缓冲中」指示（毫秒）。
 *
 * 🔴 为什么必须有这个延迟（用户 2026-11-10：「给网络集播放器加个播放缓冲时的态」）：
 *    `<video>` 的 `waiting` 在**正常切集 / 正常 seek / 短暂 jitter** 时都会触发，
 *    很多情况几十毫秒就恢复。若一触发就画转圈，用户会看到满屏闪烁的转圈、
 *    比「什么都不显示」更像是坏了。
 *   ⇒ 只在**持续卡住**时才算「在缓冲」，这正是需要告知用户的时刻。
 *
 * ⚠️ 值不能太小（< 300ms 会把正常抖动当故障），也不能太大（> 1.5s 用户已经在问
 *    「是不是卡死了」）。取 700ms：慢于一次正常 seek 建码，快于用户的烦躁阈值。
 */
const NET_BUFFER_HINT_DELAY_MS = 700;

/**
 * 右下「相关推荐」最多显示几部。
 *
 * 沿革：2026-11-10 首版取 6（「上限几部」）；**2026-11-08 用户改为 7**（「相关推荐再加个条目上限为7」）。
 *
 * 🔴 为什么这个数字由布局决定而不是拍脑袋：那一格的高度**跟随左下「简介 + 系列」**
 *    （布局保证，见 `playerHost` 注释），常见高度能放下 6~8 条「横封面（16:9，高约 40px）+ 两行文字」。
 *    取 7 是让它在常见高度下排满且不溢出，同时留一个空档不至于顶着底边。
 * ⚠️ 不是硬上限：内容少就少显示（`pickRecommendations` 池子小就返回全部），
 *    内容多也**不**靠滚动条兜底 —— 给这一格加内部滚动条会与「轻量微件」的定位相悖。
 */
const RECOMMEND_LIMIT = 7;

/**
 * 时间轴跟随模式，**一颗按钮单循环切换**（用户 2026-10-30：「锁定时间轴按钮改成单循环切换
 * 跟随和锁定按钮」）。
 *
 * `follow` = 列表随播放滚动（当前行只需保持在可视区）；
 * `lock`   = 列表随播放滚动 **且** 当前行钉在容器第 `LOCK_LINE_INDEX` 行（提词器）。
 * ⚠️ 「用户手动滚动」不是这个循环里的第三档：那是一个**打断态**（`cueFollow === false`），
 *    由滚动侦测自动进入、点「定位当前行」或本按钮退出 —— ⛔ 别把它做成要用户轮着点的档位。
 */
type CueMode = 'follow' | 'lock';
const CUE_MODE_NEXT: Record<CueMode, CueMode> = { follow: 'lock', lock: 'follow' };
/** 图标沿用原来两颗按钮各自那一个：跟随 = `locate`（原「定位当前行」）、锁定 = `lock` */
const CUE_MODE_ICON: Record<CueMode, string> = { follow: 'locate', lock: 'lock' };
/** 提示语写**下一步动作**（与选集那两颗单循环钮同一口径：若显示当前态，点完图标不变会被当成没生效） */
const CUE_MODE_LABEL: Record<CueMode, string> = { follow: '锁定时间轴（当前跟随）', lock: '恢复跟随（当前锁定）' };

/*
 * 🔴 2026-11-12：原先这里有一份模块私有的 `srLabel`。因为**没导出**，别处想给图标按钮
 *    加读屏名只能手写 `aria-label` —— `progressBall.ts` 与下面的问答导轨就是这么叠出
 *    双层气泡的（用户 m00353 ①-9 报障）。已搬到 `ui/components` 供全仓复用，
 *    ⛔ 别再在本文件里重新定义一份（那样别处又会各写各的）。
 */

export class EpisodePageView extends VideoPlayerView {
    /** 选集页上下文（`openWithPage` 写入；`onOpen` 早于它时为 null） */
    private pageCtx: EpisodePageExtras | null = null;

    /**
     * 页面根（`.rl-epp`，CSS Grid 宿主）。
     * ⚠️ 微件高度**不靠 JS 量**：微件本体 `position:absolute; inset:0` 铺满它的网格格，
     *    行高由 `.rl-epp-low`（简介+系列）决定 ⇒ 严格等高是布局算出来的，⛔ 别加 `--rl-epp-lowh` 那种 JS 写的变量。
     */
    private wrapEl: HTMLElement | null = null;
    /** 右侧栏（`playerHost()` 建好，`buildSide` 只填字幕 + 选集两节） */
    private sideEl: HTMLElement | null = null;
    /** 上排左栏（播放器舞台的父容器） */
    private mainEl: HTMLElement | null = null;
    /** 播放器挂载点（16:9 舞台，`playerHost()` 返回它） */
    private stageEl: HTMLElement | null = null;
    /** 下排左列（简介 + 系列，用户 m00002「彻底移动到视频播放器下方」） */
    private lowEl: HTMLElement | null = null;
    /** 下排右列：轻量微件本体（底部空档，高度严格跟随 `.rl-epp-low`） */
    private widgetEl: HTMLElement | null = null;
    /**
     * 系列列表容器（用户 m00002：移到播放器**下方**，始终横向 + 滚轮左右滑）。
     * ⚠️ 骨架由 `buildLow()` 建（不是 `buildSide`），`buildExtra` 的顺序是
     *    `buildLow` → `buildSeasons` → `buildSide`，节必须先存在，`buildSeasons()` 才有地方填卡片。
     */
    private seasonsEl: HTMLElement | null = null;
    /**
     * 「全部 N 部」那个入口（挂在**系列标题行**右侧，用户 2026-11-08 指定搬家）。
     * ⚠️ 容器在这里建、文案与点击由 `buildSeasons()` 每次重画时填
     *    （只有它知道 `relatedSeasons` 的真实条数，⛔ 别在两处各算一遍）。
     */
    private seasonsMoreEl: HTMLElement | null = null;
    /** 下排「简介」折叠节的内容容器 */
    private infoBoxEl: HTMLElement | null = null;
    /**
     * 收起简介封面的右键菜单（换片 / 关页 / Esc 都要能收）。
     * ⚠️ 组件自己的 `close()` 会解绑 window 监听并清空 `current`，但它**不摘 DOM 壳**
     *    ⇒ 壳由这里删，否则 `body` 末尾每开一次就多一个空 div。
     */
    private destroyEntryMenu(): void {
        this.entryMenu?.$destroy();
        this.entryMenu = null;
        this.entryMenuHost?.remove();
        this.entryMenuHost = null;
        this.entryMenuOpen = false;
    }

    /**
     * 建简介封面右键菜单的组件实例（**与海报墙同一个** `EntryContextMenu`）。
     *
     * 🔴 用户 2026-11-08：「同时简介的封面可右键可弹窗菜单（同海报墙编辑属性逻辑）」
     *    + 追问里选定「整个海报墙菜单」⇒ ⛔ 这里不许自己拼菜单项，只用注入的动作集。
     * 🔴 挂在 `document.body` 而不是 `.rl-epp` 里：`.rl-epp` 是 `overflow-y: auto`
     *    （styles.css:8865），菜单 `position: absolute` 会被它裁在可视区外
     *    —— 靠边缘右键时菜单会被切掉一半，而 `placeMenu` 算的是视口坐标，根本不知道有裁切。
     *    挂 `body` + `.rl-epp-ctxhost { position: fixed; inset: 0; z-index: 51 }`
     *    ⇒ 锚点铺满视口，组件内部那套「视口坐标 − 锚点左上角」换算直接退化成恒等，不用改组件。
     * ⚠️ `z-index: 51`：要盖住播放器整套浮层（`.rl-vp-root` 里最高 45/46），
     *    又不能盖过 Obsidian 自己的弹窗与全屏层（100 / 1000）。⛔ 别抄 `9999`。
     * ⚠️ 没注入 `entryMenu` 就**不建**：右键监听那边也判了同一个条件，
     *    两处判据同源才不会出现「能右键但菜单空」。
     */
    private buildEntryMenu(): void {
        const actions = this.pageCtx?.entryMenu;
        if (!actions) return;
        const host = document.body.createDiv({ cls: 'rl-epp-ctxhost' });
        // 壳本身不接收命中（否则它会盖住整页、所有点击都落到它身上）——
        // 只有里面的 `.rl-ctx` 可交互，这一点由 CSS 的 `pointer-events: none` 保证。
        this.entryMenuHost = host;
        const instance = new EntryContextMenu({
            target: host,
            props: {
                onWatch: actions.onWatch,
                onQuickAssociate: actions.onQuickAssociate,
                onEditEntry: actions.onEditEntry,
                onAddExcerpt: actions.onAddExcerpt,
                onOpenEntryLogModal: actions.onOpenEntryLogModal,
                onOpenEntryTextModal: actions.onOpenEntryTextModal,
                onDeleteEntry: actions.onDeleteEntry,
                // 🔴 用户 2026-11-08：「播放器详情页的简介封面右键菜单不要显示观看、删除条目项」。
                //    只藏这两项，⛔ 其余不动 —— 口径在本条常量里，别在视图里散写字符串。
                hideItems: EPISODE_COVER_MENU_HIDE,
            },
        }) as unknown as EntryMenuHandle;
        this.entryMenu = instance;
        // 🔴 `bind:open` 的等价物：组件内部 `close()`（点空白 / 点菜单项 / 按 Esc）会把
        //    `open` 置 false，视图这边必须跟着变，否则 Esc 分支永远以为菜单还开着、
        //    第一下 Esc 被它吃掉（表现为「按一下没反应，得按两下」）。
        //    ⚠️ 用 `svelte/internal` 的 `bind()`（本仓 #635 起的既有手法，见 `EntryModal.ts:7`），
        //    ⛔ 别自己 `$set` 轮询：那既不同步也不会有回调，只会看起来对。
        bindComponent(instance as unknown as Record<string, unknown>, 'open', (v) => {
            this.entryMenuOpen = v === true;
        });
    }

    /**
     * 打开简介封面的右键菜单（转发给上面那个**唯一真源**组件）。
     *
     * ⚠️ 这里**不再** `preventDefault`：调用点（封面监听的 `contextmenu`）已经先挡过
     *    （组件内部也挡一次，两道是给「别处直接调 openAt」留的保险）。
     */
    private openEntryMenu(entry: MediaEntry, ev: MouseEvent): void {
        const menu = this.entryMenu;
        if (!menu) return;
        this.entryMenuOpen = true;
        void menu.openAt(entry, ev);
    }

    /**
     * Esc 最前一层：简介封面的条目右键菜单开着就只收它。
     * 见基类 `closeExtraOverlay()` 的注释（两套 Esc 同时活着会一次关两层，#444 同款）。
     */
    protected closeExtraOverlay(): boolean {
        if (!this.entryMenuOpen) return false;
        this.entryMenu?.close();
        this.entryMenuOpen = false;
        return true;
    }

    /**
     * 微件的重画钩子（换集 / 进度变化时刷数字，⛔ 不整块重建 —— 重建会丢按钮焦点）。
     * 由 `buildWidget()` 写入；`onCueTick()` 与 `syncCells()` 里按需调。
     */
    private widgetRefs: { render: () => void } | null = null;

    /**
     * 简介封面右键菜单的组件实例（**与海报墙同一个** `EntryContextMenu`）。
     * `null` = 没注入 `entryMenu` 动作集 / 还没建 / 已销毁。
     */
    private entryMenu: EntryMenuHandle | null = null;
    /** 菜单当前是不是开着（`bind:open` 的视图侧副本；Esc 分支要读它） */
    private entryMenuOpen = false;
    /**
     * 菜单的宿主壳（`.rl-epp-ctxhost`，挂在 `document.body` 上）。
     * ⚠️ `$destroy()` 只摘组件自己的 DOM，摘不掉我们建的这层壳 ⇒ 壳也要自己删，
     *    否则每开一次选集页就在 `body` 末尾留一个空 div（`body` 不会随视图回收）。
     */
    private entryMenuHost: HTMLElement | null = null;
    /**
     * 上一次刷微件时的本集进度百分比（0-100，整数）。
     * 用途：`timeupdate` 约 4Hz，进度没跨过整数百分比就跳过重画，省掉无意义的 DOM 写入。
     * ⚠️ 换集/重画时必须重置为 -1（`syncCells()` 里做），否则新集第一次可能被旧值挡掉。
     */
    private widgetPct = -1;

    /** 选集区状态：展示模式 + 集序 + 当前分段页（0 基） */
    private cellsMode: CellsMode = 'list';
    /** 集序（用户 2026-10-29：正序/倒序单循环按钮）；⛔ 只影响显示顺序，不改 `episodeFiles` 的保位口径 */
    private cellsOrder: CellsOrder = 'asc';
    private cellsPage = 0;

    /** 右栏三块的容器（重画时只清它们，不整屏重建 —— 整屏会把播放停掉） */
    private subsBoxEl: HTMLElement | null = null;
    /**
     * 「字幕」那一节的外壳（`.rl-epp-sec`，带 `data-open`）。
     * 🔴 用户 2026-11-08：「没有字幕时字幕面板默认折叠，有字幕就默认展开」
     *    ⇒ 默认开合态由**字幕可用性**决定，而可用性是异步解析出来的
     *      （`autoLoadSubtitle` → `afterSubtitles` → `syncCueSource`），
     *      建节那一刻还不知道答案 ⇒ 必须留引用，等解析完再回填一次。
     */
    private subsSecEl: HTMLElement | null = null;
    /**
     * 上一次**自动**应用过的「有字幕」真值（`null` = 还没应用过）。
     * 🔴 为什么记它、而不是每次渲染都重设 `data-open`：
     *    用户明确说过面板「可手动收起、不跟随用户记忆」。若每帧都按可用性重设，
     *    用户在有字幕时手动收起，下一次 `syncCueSource` 就会把它弹开 —— 违背用户意图。
     *    ⇒ 只有**可用性本身翻转**（无→有 / 有→无）时才自动切，其余时候尊重用户当前状态。
     */
    private subsOpenSynced: boolean | null = null;
    private cellsBodyEl: HTMLElement | null = null;
    private rangesEl: HTMLElement | null = null;
    /** 「列表 / 封面」模式切换条（在选集节 body 顶部，⛔ 不在折叠标题行里） */
    private modesEl: HTMLElement | null = null;
    /** 下方季带的卡片列表容器 */
    private seasonsListEl: HTMLElement | null = null;

    // ── ③ 单集评价面板（用户 m00002）────────────────────────────────────────────
    /**
     * 面板整块容器（重画只清它，⛔ 不整屏重建 —— 整屏会把播放停掉）。
     * ⚠️ 面板跟随「当前集」（`activeCellIndex()`），换集时由 `syncCells()` 顺带刷新；
     *    ⛔ 别在 `openCell` 里单独调一次 —— 内嵌网络集那条路根本不走 `openCell`。
     */
    private reviewBarEl: HTMLElement | null = null;
    private reviewBoxEl: HTMLElement | null = null;
    /**
     * 面板**标题**（「第 N 集 · 已评 3/12」那行）。
     * ⚠️ 与 body 分开留引用：换集只要改这一行文案 + 重画 body，⛔ 不必重建整节（省一次折叠态抖动）。
     */
    private reviewTitleEl: HTMLElement | null = null;
    /**
     * 本页是否已经有**本地可播的选集**（决定评价面板画不画）。
     * 🔴 用户原话：「播放器详情页（**有选集时**）在字幕面板上方加单集评价面板」
     *    ⇒ 电影（单片）与「仅有 1 个文件」的单集页都不该有「单集评价」——
     *    那条目自己就一集，评价它是整部的事，走编辑表单的「个人心情」，不是这里。
     * ⚠️ 判据与选集节同源（`isMovie` / `isSingle()`），⛔ 别自己再数一遍文件。
     */
    private reviewVisible = false;
    /**
     * 本地评价副本（`pageCtx.reviews` 的浅拷贝 + 本次会话里用户改动过的那几集）。
     *
     * ⚠️ 为什么要本地留一份而不是每次都读 `pageCtx.reviews`：宿主透进来的是**打开那一刻**的快照，
     *    用户点完「已看」后若不重建整页，`pageCtx.reviews` 里还是旧值 ⇒ 面板会闪回旧状态。
     *    这一份只活在实例上、⛔ 不回写 catalog（真源永远是 catalog，写回走 `onSaveReview`）。
     */
    private reviewMap: Record<string, EpisodeReview> = {};

    /**
     * 信息栏收起态（用户 2026-10-28：「信息栏可收起来」）。
     * ⚠️ 只活在实例上、**不写进视图 state**：这页每次 openWithPage 都是新上下文，
     *    持久化一个纯视觉偏好会跟「换片重开」的语义打架（也避免往 data.json 加字段）。
     */
    private sideCollapsed = false;
    /** 标题块右侧那枚「收起/展开信息栏」开关（`buildHead` 里建；栏收起后它还得在） */
    private sideToggleEl: HTMLElement | null = null;

    // ── 字幕时间轴面板（用户 m00002 六节规格）──────────────────────────────────
    /** 面板工具条容器（跟随/锁定单循环钮 / 语言 / 导入） */
    private cueToolsEl: HTMLElement | null = null;
    /** 字幕来源标识（AI / B站 / 本地）：与锁定时间轴按钮同一行、靠左 */
    private cueTagEl: HTMLElement | null = null;
    /** 跟随/锁定单循环按钮（`syncCueTools` 回填图标与选中态） */
    private cueModeEl: HTMLElement | null = null;
    /** 面板列表滚动容器（唯一滚动主体，⛔ 不与整页滚动耦合） */
    private cueListEl: HTMLElement | null = null;
    /** 列表行 DOM（与 `cueCues` 同长同序；重画时整体重建） */
    private cueRows: HTMLElement[] = [];
    /**
     * ⛔ 这里曾有四个 mini-map 字段（`cueMapEl` / `cueMapTicksEl` / `cueMapThumbEl` / `cueMapTicks`）。
     *
     * 🔴 用户 m12123：「还有这个滚动条给我去掉」；追问三选一里明确选了
     *    「整条 mini-map 全部去掉」。⇒ 连同 `pure/cueMinimap.ts` 整个模块一起删了。
     * ⛔ 别再补回来：用户是看着那根蓝条像一条粗滚动条才要求删的，
     *    重新加回来等于把同一个观感问题再交一次。
     */
    /** 解析出来的 cue（唯一真源；⛔ 不另存一份给别处用） */
    private cueCues: Cue[] = [];
    /** 正在解析（出加载态） */
    private cueLoading = false;
    /**
     * 时间轴模式（用户 2026-10-30：一颗按钮单循环切换跟随/锁定）。
     * `lock` 时当前行钉在容器第 `LOCK_LINE_INDEX` 行（提词器），见 `CueMode` 注释。
     */
    private cueMode: CueMode = 'follow';
    /** 跟随态（用户手动滚动 ⇒ false；点单循环钮 / 回到跟随 ⇒ true） */
    private cueFollow = true;
    /** 当前高亮行下标（`-1` = 无）；**只在变化时才改 DOM** */
    private cueActiveIdx = -1;
    /**
     * 本次重画是否需要把浮层「滚进视野」（只在新打开时为真）。
     *
     * 🔴 用户 2026-11-13 逐字：「我每次基于字幕问答时位置会返回顶部AI摘要处，修复一下」。
     *    根因 = `buildCueAskBox()` 里那句 `panel.scrollIntoView({ block: 'nearest' })`
     *    **每次重画都跑**（提交提问 / 回答回来 / 重新生成都走重画），而面板比视口高时
     *    `block: 'nearest'` 会把面板**顶边**对齐到视口顶边 ⇒ 页面每次都弹回 AI 摘要开头。
     *    ⇒ 只在「面板从无到有」那一次滚，后续重画一律不动页面位置。
     *    ⚠️ 不改成 `block: 'center'`：那样每次重画都会让右栏跳一下，比不滚更烦。
     */
    private cuePanelReveal = false;
    /** 面板 cue 的来源键（换集 / 换字幕 / 手动导入时变化 ⇒ 触发重解析） */
    private cueSrc: string | null = null;
    /**
     * AI 总结入口按钮（工具条里那颗 ✨，用户 2026-11-11：「小图标放在时间轴定位按钮右旁」）。
     * ⚠️ 留引用是为了：
     *   ① 生成中要挂 `is-on` + 禁用，防连点打出多条并发请求；
     *   ② 换字幕 / 换集后要重置它的忙碌态（旧结果已作废）。
     */
    private cueAiBtnEl: HTMLElement | null = null;
    /** AI 结果浮层（浮在字幕列表上方；`null` = 没建过 / 已销毁） */
    private cueAiPanelEl: HTMLElement | null = null;
    /** 正在生成（防连点 + 驱动按钮的加载态） */
    private cueAiLoading = false;
    /**
     * 上一次生成结果对应的**来源键**（`null` = 没有结果）。
     * 🔴 为什么要记：换集/换字幕必须让旧总结立刻失效——否则面板上会挂着上一集的概括，
     *    用户会当成这一集的内容读（错得比不显示更严重）。
     */
    private cueAiSrc: string | null = null;
    /** 已生成的结果（重画浮层时用，⛔ 不重复请求） */
    private cueAiResult: CueSummaryResult | null = null;
    /**
     * 提问的问答历史（正序；只在**同一来源**内累积）。
     *
     * 🔴 用户 2026-11-11（第二轮）：「给字幕面板的AI加个提问框」
     * 🔴 为什么视图必须自己攒历史：网络请求是无状态的，模型记不住上一轮；
     *    宿主侧只拿得到一个 `question` 字符串，拿不到「前面问过什么」。
     *    ⇒ 历史只能在这里维护，并随每次请求一起传下去（`pageCtx.cueAsk`）。
     * ⚠️ 换集 / 换字幕必须清空（`resetCueAi`）：带着上一集的问答去问这一集，
     *    模型会照着旧答案硬编（比不回答更糟）。条数上限见 `CUE_ASK_HISTORY_TURNS`。
     */
    private cueAskTurns: CueAskTurn[] = [];
    /** 提问进行中（防连点；与 `cueAiLoading` 分开 —— 总结与提问可以互不影响地各忙各的） */
    private cueAskLoading = false;
    /** 提问区的容器（重画时定位用；`null` = 浮层没开） */
    private cueAskBoxEl: HTMLElement | null = null;
    /** 手动导入的字幕（只喂面板，⛔ 不改基类 <track> 挂载态） */
    private cueImported: { fileName: string; text: string } | null = null;
    /**
     * `cueImported` 是否来自**用户手动导入**（而不是网络集自动抓的 B 站字幕）。
     *
     * 🔴 为什么需要这个标记：网络字幕是**并行异步**取的，可能晚于用户的手动导入回来。
     *    没有这个标记，用户挑好的字幕会在几秒后被自动抓取的结果顶掉 —— 用户会认为
     *    「我选的字幕自己变了」。⇒ 手动导入一旦发生，自动抓取必须让路。
     * ⚠️ 换集 / 重进网络集时清零（那是新的一集，上次的手动选择不适用）。
     */
    private cueImportedManual = false;
    /**
     * 当前字幕的来源：`ai` = B 站 AI 字幕，`net` = B 站上传字幕，`local` = 同目录字幕文件，
     * `manual` = 用户手动导入，`null` = 还没有字幕。
     *
     * 🔴 用户 2026-11-09：「字幕面板在锁定时间轴按钮同行左对齐加上标识如：AI或本地」
     *    ⇒ 用户要一眼看出**这条字幕哪来的**（AI 生成的可信度与人工上传的不一样）。
     */
    private cueSourceTag: 'ai' | 'net' | 'local' | 'manual' | null = null;
    /**
     * 上一次网络字幕为什么没拿到（用户 m06406 ④ 的两种空态靠它分岔）。
     *
     * 🔴 为什么必须存下来而不是当场就用：取字幕是**异步**的，失败发生在
     *    `loadNetSubtitle` 的 await 之后；而空态是 `renderCueRows()` 画的，
     *    两者之间可能已经隔了好几次重画（换集、展开面板、切 tab 都会重画）。
     *    不存字段的话，第二次重画就把原因丢了 —— 用户会看到空态文案自己变。
     * ⚠️ 换集 / 手动导入时必须清空，否则上一集的「Cookie 失效」会标到这一集头上。
     */
    private cueNetFail: NetCueFailReason | null = null;
    /** 已挂 `timeupdate` 的 video 元素（换片会换人 ⇒ 只按同一性判断重绑） */
    private cueVideoEl: HTMLVideoElement | null = null;

    // ── 本地语音转文字（用户 m01938：工具条 🎙️「音频转文字」）───────────────
    /**
     * 转写入口按钮（工具条里 ✨ 左边那颗 🎙️）。
     * ⚠️ 留引用是为了转写中挂 `is-busy` + 禁用：本地识别可能跑几分钟，
     *    连点会并发出两个 ffmpeg + 两个 whisper 进程，把 CPU 打满还互相踩输出文件。
     */
    private cueAsrBtnEl: HTMLElement | null = null;
    /** 正在转写（防连点 + 按钮忙碌态 + 切集时用来判定「要不要拦」） */
    private cueAsrLoading = false;
    /**
     * 转写进度条容器（浮在字幕列表上方的细横幅；`null` = 没在转写）。
     * 用户要求：「点击 [开始转写] 后的状态反馈（显示在面板内或底部细横幅）」
     * 且「绝不遮挡视频」⇒ 只占面板内顶部一条，⛔ 不弹全屏遮罩。
     */
    private cueAsrBarEl: HTMLElement | null = null;
    /** 进度条的填充块与文案节点（每帧只改这两个，⛔ 不重建整条横幅） */
    private cueAsrFillEl: HTMLElement | null = null;
    private cueAsrTextEl: HTMLElement | null = null;
    /**
     * 句级细节那一行（`0:12 → 0:19 / 3:40`）。
     *
     * 🔴 用户 m09995：「转录中还是只有个进度条百分比都不知道转录到哪句时间戳了」
     *    ⇒ 单独一行小字，阶段文案下面；没有细节时挂 `is-off` 收起。
     */
    private cueAsrDetailEl: HTMLElement | null = null;
    /**
     * 转写过程中已经识别出来的句子（🔴 用户 m11612「空态要变成转录过程（每一句转写）」）。
     *
     * ⚠️ 与 `cueCues` 分开存：那是**当前生效的字幕文件**解析出来的行，
     *    而这里是引擎边跑边吐的草稿。混在一起，转写完再读一遍 SRT 时会出现
     *    「同一句既有草稿又有正式版」的重复行。
     * 🔴 换了集 / 转写被取消 / 转写结束都要清空，否则下一集会看到上一集的草稿。
     */
    private cueAsrLines: TranscribeLine[] = [];
    /**
     * 转写实时流的两个节点引用（列表容器 / 标题行 / 尾部光标）。
     * ⚠️ 每次 `renderCueRows()` 都会重建，所以它们只在「转写中」这一小段时间内有效；
     *    过期指针留着会让 `appendCueTranscribeRow` 往已摘下来的节点里加行（用户看不到）。
     */
    private cueTrBodyEl: HTMLElement | null = null;
    private cueTrHeadEl: HTMLElement | null = null;
    private cueTrTailEl: HTMLElement | null = null;
    /**
     * 转写所属的**来源键**（`cueKey()` 的快照）。
     *
     * 🔴 用户在转写途中切了集 ⇒ 结果不能落到新的一集上（那会变成「B 集的字幕挂到 C 集」）。
     *    回来时比对这一项，不一致就只提示、不刷新面板。
     */
    private cueAsrSrc: string | null = null;
    /**
     * 当前这次转写的取消令牌（`null` = 没在转写）。
     *
     * 🔴 用户 m06361：「也没有停止转录的交互」。忙碌态的 🎙️ 按钮**不再是禁用态**，
     *    而是变成「停止」—— 再点一下就走 `cancel()`。
     * ⚠️ 不存 Promise、不存子进程：视图层只需要「叫停」，怎么杀进程是宿主的事。
     */
    private cueAsrCancel: AsrCancelHandle | null = null;

    // ── 学习模式（用户 m01938 §3：单句循环 / AB 复读 / 影子跟读 / 悬停查词）────────
    /**
     * 学习模式开关（工具条 📖 那颗）。
     *
     * 🔴 用户文档 §3：「点击字幕面板顶部 [📖 学习模式] 按钮进入。布局改变：播放器区域垂直分为
     *    上下两半。上半屏是视频，下半屏是放大、加宽的字幕阅读区（类似提词器）。」
     *    ⇒ 我们不去改播放器分屏（那是整页布局，动它会牵动左栏/季带/全屏三条链路），
     *      只把**字幕面板**本身放大加宽（`.is-learn` 类驱动）—— 提词器的可读性来自
     *      「字号更大 + 行距更松 + 当前句更醒目」，不是来自「必须切一半屏幕」。
     */
    private cueLearnOn = false;
    /** 学习模式入口按钮（`null` = 还没画 / 已随面板重画失效） */
    private cueLearnBtnEl: HTMLElement | null = null;
    /** 循环档位单循环钮（`syncCueLoopBtn` 回填图标与提示语） */
    private cueLoopBtnEl: HTMLElement | null = null;
    /**
     * 循环档位（工具条那颗 🔁 单循环钮的三档）。
     *
     * ⚠️ 与 `cueMode`（跟随/锁定）**不是一回事**：那个管「列表怎么滚」，这个管「视频怎么跳」。
     *    两件事各自有单循环钮，⛔ 别合并。
     */
    private cueLoop: LoopKind = 'off';
    /** AB 复读的两个端点（秒）；`null` = 没设 */
    private cueAb: AbPoints | null = null;
    /**
     * 等待 B 点的那半截状态：第一次右键记下这句的下标，第二次右键才成区间。
     * `-1` = 没有待配对的 A 点。⚠️ 用下标而不是秒数：用户设完 A 之后
     * 「另一句」指的是**行**，用秒数会出现「B 落在某句中间」的歧义。
     */
    private cueAbDraftA = -1;
    /** 当前是否处于「刚 seek 回区间起点」的保护期（防止 seek 落地前连续回跳） */
    private cueLoopSeeking = false;
    /**
     * 单句循环锁定的**行下标**（双击某行进入）；`-1` = 没锁，跟随当前高亮行。
     *
     * 🔴 为什么要单独存而不是直接用 `cueActiveIdx`：双击锁定的那一句在播放到下一句时
     *    `cueActiveIdx` 会变成 -1（`activeCueIndex` 找不到命中行），
     *    若拿它当区间来源，循环会在句子播完那一刻**失去区间** —— 正是「循环自己停了」。
     */
    private cueLoopIdx = -1;
    /** AB 复读横幅（顶部那条 `A [00:12] ←→ B [00:45] · 🔁 循环中 · [清除]`） */
    private cueAbBarEl: HTMLElement | null = null;
    /** 影子跟读开关 + 倒计时截止时刻（`Date.now() + gap*1000`） */
    private cueShadowOn = false;
    private cueShadowDeadline = 0;
    /** 倒计时正在跑（`null` = 没在等）——用来在 tick 里判断「该恢复了」 */
    private cueShadowTimer: number | null = null;
    /** 跟读状态条（顶部那条 `🎤 跟读模式 · 留白时长 3s · [关闭]`） */
    private cueShadowBarEl: HTMLElement | null = null;
    /** 🎤 跟读开关按钮（只在学习模式下显示） */
    private cueShadowBtnEl: HTMLElement | null = null;
    /** 跟读留白时长（秒，来自设置，档位见 `SHADOW_GAP_CHOICES`） */
    private cueShadowGap = SHADOW_GAP_DEFAULT;
    /** 查词浮层（跟着鼠标走的那个气泡） */
    private cueWordTipEl: HTMLElement | null = null;
    /** 当前浮层挂着的是哪个词（避免同一词重复重建） */
    private cueWordTipKey = '';

    // ── B 站外链内嵌（用户 2026-11-02：「外链网络链接如 b 站内嵌到播放器播放」）──────
    /**
     * 当前正在内嵌的集下标；`null` = 没在内嵌（本地集在播 / 空态）。
     *
     * 🔴 为什么必须另开一条渲染通路：网络集**不在** `opts.items` 里
     *    （`main.ts:buildEmbedItems` 只收 `isEmbeddableVideoPath` 的本地文件），
     *    基类的 `<video>` 那套加载/切集/进度**根本拿不到它们** ⇒ 内嵌层只能自己挂。
     * ⚠️ 内嵌期间基类那条通路要保持「什么都没在播」：进内嵌前先 `pauseVideo()`，
     *    否则底下的本地视频会在 iframe 后面继续出声。
     */
    private netIndex: number | null = null;
    /**
     * 「打开就进内嵌」的待消费集号（来自 `page.startNet`）；消费一次后归 `null`。
     * ⛔ 不能直接拿 `page.startNet` 当判据：`afterRender` 每次切集都会跑，
     *    常驻会让用户点回本地集之后又被弹回内嵌。
     */
    private pendingNetStart: number | null = null;
    /**
     * 「回跳后该落到第几秒」——只消费一次。
     *
     * 🔴 用户 2026-11-11 报：「全屏能播，回到详情页一直缓冲中播不了」。
     *    病根是回跳走 `openEpisodePageFor(netStart)` 冷启动整条链，而
     *    `mountNetVideo` 里 DASH 分支写死 `startDashMse(el, dash, 0, true)` ——
     *    `resumeAt = 0` ⇒ `MseTrackPipeline` 的 `startAt` 也是 0 ⇒ **从第 0 片重新拉**。
     *    用户明明已经看到第 47 秒，回来却要重下一遍整片，表现就是「一直缓冲中」。
     *    ⇒ 回跳时把秒数存这里，DASH 分支用它当 `resumeAt`（管线会按 `seekCursor`
     *      直接跳到那一片，⛔ 不从 0 逐片追）。
     * ⚠️ 与基类 `pendingSeek` 不是一回事：那个在 `netSource`（播放器页）上按秒 seek，
     *    选集页这条链根本没走 `consumePendingTarget`，所以必须自己有这一份。
     * ⛔ 只消费一次：否则换集时会把「上次回跳的秒数」又套到新一集上。
     */
    private pendingNetSeek: number | null = null;
    /** 内嵌层容器（`.rl-epp-net`，铺满舞台；`null` = 还没建过） */
    private netLayerEl: HTMLElement | null = null;
    /** 内嵌 iframe 元素（换集时只改 `src`，不重建节点 —— 重建会闪白） */
    private netFrameEl: HTMLIFrameElement | null = null;
    /**
     * 当前挂进 iframe 的**原始网络地址**（不是拼出来的 embed 地址）。
     *
     * 🔴 2026-11-25 用户逐字「恢复youtube在内嵌iframe的调用」⇒ 内嵌态不再只有 B 站一家，
     *    工具条标题、加载失败文案、备用域名这三处都要按「是 B 站还是 YouTube」分叉。
     *    这三条判据都在 `pure/netInline`（`netEmbedTitleOf` / `netEmbedFailText` /
     *    `netEmbedFallbackUrl`），入参都是**原始站址** ⇒ 必须把它留在这里。
     * ⚠️ 别拿 `netFrameEl.src` 反推：那是拼出来的 embed 地址，B 站那条还要再抠 bvid，
     *    口径绕一圈只会给自己挖坑。换集/退出时与 `netFrameEl` 同生共死。
     */
    private netSrcUrl = '';
    /**
     * 官方内嵌态的播放头（由 `embedTickTimer` 轮询写入）。
     *
     * 🔴 内嵌那颗 `<video>` 在**跨域 iframe** 里，`videoElement().currentTime` 读的是我们自己
     *    那颗空壳（`readyState=0`、恒 0）⇒ 必须走 `services/embedVideo` 进子帧去读真值。
     */
    private embedTime = 0;
    /** 桥是否**真的读到过**播放头。读不到就一个字都不许假装在跟随（宁可静态、宁可说「用不了」）。 */
    private embedTimeOk = false;
    private embedTickTimer: number | null = null;
    // ⛔ 原 `netTitleEl`（内嵌舞台左上角「B 站官方播放器」胶囊的文字节点）已整块删除：
    //    用户 2026-11-08 逐字「播放器上的两个标识(B站官方播放器)给我删除掉」。
    //    别把它加回来 —— 这枚胶囊本来就是给「自取流 / 内嵌」两态区分用的，
    //    自取流在 2026-11-24 整体下架后它只剩一句废话，还挡画面左上角。
    //    播放器顶栏的片名（`VideoPlayerView.titleTextEl`）**不是**它，独立存在。
    /**
     * 「正在载入视频」遮罩节点（网络流预取期/起播期盖在舞台上）。
     *
     * 🔴 用户 2026-11-06 报「点关联网络的第一集还要我再次点击屏幕的播放按钮才能播放」——
     *    真机实测根因不是 `play()` 被拦（探针显示只调一次、`ok:true`），而是
     *    **预取那 3 秒里 `src` 还没设、画面纯黑、没有任何反馈**（采样：0–3s `paused=true/rs=0`，
     *    3.5s 才 `rs=4` 自动播）。用户对着黑屏以为没反应，就再点一下。
     * ⇒ 盖一层「正在载入」+ 转圈，把「在工作」这件事说出来。
     * ⚠️ 与 iframe 的 `.rl-epp-net` 层不同：这层只覆盖主播放器、不拦事件（`pointer-events: none`），
     *    起播就摘掉，⛔ 别让它常驻。
     */
    private netLoadingEl: HTMLElement | null = null;
    /**
     * 起播遮罩里的那行文案（`正在载入视频…` / `正在准备视频 42%`）。
     * ⚠️ 单独留引用：改文案时必须原地 `setText`，⛔ 不能重建遮罩（spinner 会重启动画）。
     */
    private netLoadingTxtEl: HTMLElement | null = null;
    /** 内嵌加载看门狗定时器句柄（`null` = 没在看） */
    private netTimer: number | null = null;
    /**
     * 最近一批程序滚动的目标位（队列）。
     * 🔴 不能用单个值：`scroll` 事件**异步派发**，同一轮里连滚两次（锁定时重定位 + 高亮跟随）会排出两个事件，
     * 第一个带的是**上一处**位置；单值方案里它永远对不上新目标 ⇒ 被误判成用户手动滚 ⇒ 跟随被永久关掉（真机复现：off 从 42 变 215）。
     */
    private cueProgTos: number[] = [];
    /** 用户真实输入（滚轮/拖条/触摸/键盘）的时间戳；**只有它之后**的 scroll 才可能是用户滚的 */
    private cueUserInputAt = 0;

    // ── 逐集封面（懒加载）────────────────────────────────────────────────────
    /**
     * 封面**计划**缓存：集下标 → 计划。
     *
     * 🔴 这里必须是「结果缓存」而不是「已问过」的标记集合 —— 上一版用 `Set<number>` 只记
     *    「问过没有」，一旦宿主解析期间发生过一次 `syncCells()` 重画，旧节点 `isConnected === false`
     *    ⇒ 结果被丢弃，而新节点又因「已问过」被挡在门外，这一集的封面就**永久空白**（用户实测症状：
     *    「选集的关联的本地或网络封面始终没加载出来」）。
     * ⇒ 缓存计划本身：重画时同一集直接按缓存补画，⛔ 不再回头打宿主接口。
     */
    private readonly coverPlans = new Map<number, EpCoverPlan>();
    /** 在途请求：集下标 → 计划 Promise（重画后新节点复用它，⛔ 不重复发请求） */
    private readonly coverInflight = new Map<number, Promise<EpCoverPlan>>();
    /** 可见性观察器 → 待取封面的格子（`syncCells` 重画时整体丢弃） */
    private coverIo: IntersectionObserver | null = null;
    private readonly coverPending = new Map<Element, { cov: HTMLElement; idx: number }>();

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return EPISODE_PAGE_VIEW_TYPE;
    }

    getDisplayText(): string {
        // 标签页标题 = 片名（没有内容时退回页面名，别显示成「播放器」）
        return this.entryTitle() || '选集';
    }

    getIcon(): string {
        // 选集页用「列表 + 播放」的语义图标；与播放器的 'film' 区分开，标签页上一眼能认出这两类页
        return 'list-video';
    }

    /**
     * 载入内容（宿主在 `setViewState` 之后调用）。
     * 🔴 先记 `pageCtx` 再走基类 `openWith` —— 基类会在 `opened` 时立刻 `buildUi()`，
     *    而 `playerHost()` / `buildExtra()` 都要读 `pageCtx`；顺序反了这页就画成空壳。
     */
    openWithPage(opts: EpisodePageOptions): void {
        this.pageCtx = opts.page;
        // 宿主说「用户点的是第 N 集网络集」⇒ 记下待消费，`afterRender` 里第一次跑就进内嵌
        this.pendingNetStart = typeof opts.page.startNet === 'number' ? opts.page.startNet : null;
        // 🔴 用户 2026-11-11：「回到详情页一直缓冲中播不了」⇒ 回跳要接着播，⛔ 不能从第 0 片重拉。
        //    DASH 分支的 `resumeAt` 从这里来（见 `pendingNetSeek` 的注释）。
        this.pendingNetSeek = typeof opts.page.startNetSeek === 'number' && opts.page.startNetSeek > 0
            ? opts.page.startNetSeek
            : null;
        // 当前分段页 = 当前集所在页（打开就落在用户正在看的那一段）
        this.cellsPage = Math.max(0, Math.floor(opts.page.currentIndex / EPISODE_PAGE_SIZE));
        this.cellsMode = 'list';
        // ⚠️ 集序必须跟着一起归位：`cellsPage` 上面按「集号 / 页长」算，那套口径只在正序时成立。
        //    若沿用上次的倒序，打开就落在错页（甚至空白页）。
        this.cellsOrder = 'asc';
        // 🔴 换片必须清封面缓存：`coverPlans` 只按**集号**索引，不含片名。
        //    同一 leaf 从 A 片换到 B 片时，第 0 集仍会命中 A 片留下的计划
        //    （典型：A 片没集数 ⇒ `{kind:'none'}`），于是 B 片的第 0 格永久是灰占位图。
        //    ⛔ 只在**换片**时清；`syncCells` 内部的翻页/切挡**不准**清（那会把已取到的封面全丢）。
        this.coverPlans.clear();
        this.coverInflight.clear();
        // ③ 单集评价：宿主透进来的是打开那一刻的快照 ⇒ 本地先复制一份
        //    （之后用户的改动只改这一份 + 通知宿主，⛔ 不改 `pageCtx.reviews` 那个只读对象）。
        //    ⚠️ 必须**换片时重建**：同一 leaf 从 A 片换到 B 片，沿用旧表就会把 A 片的评价画到 B 片上。
        this.reviewMap = { ...(opts.page.reviews ?? {}) };
        this.openWith(opts);
    }

    // ── 骨架钩子 ────────────────────────────────────────────────────────────────

    /**
     * 本页当前挂的是哪一条条目（宿主「两页互跳」要拿它认页）。
     *
     * 🔴 用户 2026-11-06 裁定两页互跳 ⇒ 从播放器页点全屏要**回到原来那一页**，
     *    而不是再开一个新选集页（那会越点标签越多）。宿主要能按条目 id 认出「这就是那一页」。
     * ⚠️ `pageCtx` 为 null（视图已 `onOpen` 但还没 `openWithPage`）⇒ 返回 null，调用方按「没有」处理。
     */
    currentEntryId(): string | null {
        return this.pageCtx?.entry.id ?? null;
    }

    /**
     * 用**最新**的条目数据刷新本页的标题块与简介卡（不重开页面、不打断播放）。
     *
     * 🔴 为什么需要：`pageCtx.entry` 是 `openEpisodePageFor` 打开那一刻的快照。
     *    2026-11-08 简介封面加了右键菜单 ⇒ 菜单里的「编辑属性」改完保存，
     *    宿主的 `refreshViews()` 只刷海报墙与音频播放器（`main.ts:10197`），
     *    **这页不会更新** ⇒ 用户改完封面/标题，页面还挂着旧值，得关掉重开才看见。
     *    ⛔ 别指望整页 `openEpisodePageFor` 重开：那会重建播放器、打断正在看的片子。
     * ⚠️ 只重画「标题块 + 简介卡」这两块**纯展示**的部分：
     *    选集格子 / 系列带 / 播放进度都由别的通路维护，这里碰它们只会打架。
     * @param coverUrl 宿主算好的封面地址（视图拿不到 `resolvePoster`）。
     */
    refreshEntrySnapshot(entry: MediaEntry, coverUrl: string | null): void {
        const ctx = this.pageCtx;
        if (!ctx || ctx.entry.id !== entry.id) return;
        ctx.entry = entry;
        ctx.coverUrl = coverUrl;
        ctx.overview = entry.summary ?? '';
        // 🔴 2026-11-08（用户 m04478）：片名变了还要通知**基类**。
        //    标题块（下面 buildHead）读的是 `pageCtx.entry.title`，本来就会变；
        //    但顶栏片名与标签页标题读的是基类 `opts.entryTitle`（打开那一刻的快照），
        //    不推给它，同一页上就会出现「上面改了、顶栏还是旧的」。⛔ 别在这里手拼顶栏文案
        //    （「片名 · 第 N 集」的真源是基类 `restoreLocalTitle`，重拼一次必然走味）。
        this.applyEntryTitle(entry.title);
        // 标题块：整块换掉（它还带「信息栏收起」按钮，重建时 `buildHead` 会重新接线）
        this.wrapEl?.querySelector('.rl-epp-head')?.remove();
        this.buildHead();
        // 简介卡：清空后按新数据重画；顺带把「没内容就藏节」那条判据重算一遍
        // （⛔ 别只换图：用户可能把简介清空了，那时这一节该整块消失）
        const box = this.infoBoxEl;
        if (box) {
            box.empty();
            this.buildInfoCard(box);
            const hasInfo =
                !!ctx.overview ||
                !!ctx.coverUrl ||
                (typeof entry.rating === 'number' && entry.rating > 0) ||
                (entry.genres?.length ?? 0) > 0 ||
                [entry.type, entry.year, entry.country, entry.language].some((x) => !!x);
            box.closest('.rl-epp-sec')?.toggleClass('is-empty', !hasInfo);
        }
        // 🔴 用户 2026-11-16 逐字：「播放器详情页的右键更新了关联入口链接，但视频播放器不刷新」。
        //    ⇒ 关联入口改的是 `episodeFiles` / `episodeUrls` / `episodeTitles`，
        //      而这一页的选集格读 `ctx.files/urls/titles`、播放器读 `opts.items`，
        //      两份都是**打开那一刻的快照** ⇒ 只重画标题块+简介卡，视频当然不动。
        //    ⚠️ 顺序固定：先就地换掉 `pageCtx` 里那三份数组（选集格的数据源），
        //      再把重算出的本地可播集推给基类（`replaceItems` 自己决定要不要重挂源），
        //      最后才重画格子 —— 反过来画出来的会是旧数据。
        this.syncEpisodeSources(entry);
    }

    /**
     * 条目关联变化后的**选集区重建**（③ 的落点，见 `refreshEntrySnapshot` 末尾的调用）。
     *
     * 🔴 为什么「就地改数组」而不是换 `pageCtx`：
     *    `pageCtx` 被十几处闭包按引用持有（季卡、微件、右键回调…），换掉它等于换掉半页的真源；
     *    而 `files/urls/titles` 这三份是**只读数组**，就地清空再填回与「新建一份」对调用方等价，
     *    又能保证所有既有引用同步看到新值。⛔ 别写成 `ctx.files = [...all]`：`readonly` 只是类型约束，
     *    运行期虽然能改，但那样 `EpisodePageExtras` 的持有者手里还是旧数组。
     * ⚠️ 不碰 `ctx.total / currentIndex`：总集数是「声明值」（用户手填），
     *    当前集由播放器状态决定，都不是「关联入口」这次改动能改的。
     */
    private syncEpisodeSources(entry: MediaEntry): void {
        const ctx = this.pageCtx;
        if (!ctx) return;
        const all = entry.episodeFiles ?? [];
        const urls = entry.episodeUrls ?? [];
        const titles = entry.episodeTitles ?? [];
        // 就地替换三份数组（`readonly` 视图，但底层还是普通数组）
        (ctx.files as (string | undefined)[]).length = 0;
        for (const p of all) (ctx.files as (string | undefined)[]).push(p);
        (ctx.urls as (string | undefined)[]).length = 0;
        for (const u of urls) (ctx.urls as (string | undefined)[]).push(u);
        (ctx.titles as (string | undefined)[]).length = 0;
        for (const t of titles) (ctx.titles as (string | undefined)[]).push(t);
        // 重算「本地可播集」并就地换给基类（宿主没注入回调 ⇒ 只重画格子，不动播放器）
        const reload = ctx.reloadItems;
        if (reload) this.replaceItems(reload(entry));
        // 选集格：`is-cur` / 集号 / 标题 / 封面计划全是渲染期算出来的 ⇒ 必须重画
        this.syncCells();
        // 🔴 当前集「本地 ↔ 网络」的类型可能刚刚被这次关联改掉（见 `syncNetAfterAssociate`）。
        this.syncNetAfterAssociate();
    }

    /**
     * 关联入口改完源之后，让**当前这一集**的播放形态跟上。
     *
     * 🔴 用户 2026-11-27（m04135）：「播放器详情页的右键关联入口为网络链接，但视频播放器
     *    还是本地播放器不刷新，而不是内嵌网络播放器」。
     *    病根：`syncEpisodeSources` 只换 `ctx.files/urls/titles` + `replaceItems`，
     *    而 `replaceItems` 吃的是 `buildEmbedItems()` —— 它**只收本地文件**（纯网络集压根
     *    不在 `items` 里，见 `main.ts` 里 `buildEmbedItems` 的注释）⇒ 把某一集的本地文件
     *    改成网络链接后，基类走 `found < 0` 分支：`cur = 0` + 重画，**永远进不了网络内嵌态**。
     *    ⇒ 这里补一步「按新数据重判当前集该用哪种播放器」，优先级**与 `openCell()` 逐条一致**：
     *      · 有本地文件（`ctx.files[idx]` 非空）⇒ 就是本地态：还在网络态就 `exitNetEmbed(true)`
     *      · 没有本地文件但有可内嵌网络地址 ⇒ `enterNetEmbed()`
     *      · 两头都没有 ⇒ 还在网络态就退出（`exitNetEmbed(false)` + `rerenderCurrent()` 画空态）
     *    🔴 为什么必须照抄 `openCell()` 的排序：那个方法是用户点格子时走的真源。若这里按
     *      「先看 url」判，一集同时有本地文件和网络链接时，点格子播本地、关联完却切成内嵌 ——
     *      同一格两个入口给出不同结果，比原来的 bug 更难解释。
     *    ⚠️ 只在**形态确实变了**时动手：每集都在内嵌态/本地态之间来回切会打断正在播的视频，
     *      用户只是改了别的集就白抖一下。
     *    ⚠️ 判「当前集」用 `activeCellIndex()`（它已经是全页唯一口径：网络态是 `netIndex`，
     *      本地态是 `currentEpisodeIndex()`）。
     */
    private syncNetAfterAssociate(): void {
        const ctx = this.pageCtx;
        if (!ctx) return;
        const idx = this.activeCellIndex();
        if (!Number.isFinite(idx) || idx < 0) return;
        const url = (ctx.urls[idx] ?? '').trim();
        const localPath = (ctx.files[idx] ?? '').trim();
        const inNet = this.isNetPlayback();
        // ⚠️ 优先级必须与 `openCell()` 一致：**本地文件优先**。
        //    `openCell` 是先 `if (cell.local)` 再轮到网络地址 ⇒ 一集同时有两份源时，
        //    用户点格子看到的是本地视频。这里若只判 `url` 就会把它强行切成内嵌网络播放器，
        //    两个入口对同一格给出不同结果 —— 那是比原 bug 更坏的「自相矛盾」。
        if (localPath) {
            // 现在该播本地：还在网络态就退出来（`restoreLocal=true` 让 `exitNetEmbed`
            // 自己 `rerenderCurrent()` 重挂本地源，不用外面再补一次）
            if (inNet) this.exitNetEmbed(true);
            return;
        }
        const wantNet = !!url && canPlayNetInline(url);
        if (!wantNet) {
            // 两头都没有：还在网络态就退出来（`restoreLocal=false` —— 本地没源可挂，
            // 外面补一次 `rerenderCurrent()` 画空态/占位层，⛔ 别让它留在旧 iframe 上）
            if (inNet) {
                this.exitNetEmbed(false);
                this.rerenderCurrent();
            }
            return;
        }
        // 已在网络态且是同一集、同一个地址 ⇒ 什么都不用做（别把正在播的 iframe 重建）
        if (inNet && this.netIndex === idx && this.netSrcUrl === url) return;
        this.enterNetEmbed(idx, url);
        this.cellsPage = Math.max(0, Math.floor(this.orderedCellPos(idx) / EPISODE_PAGE_SIZE));
        this.syncCells();
    }

    /**
     * 播放器骨架的宿主：建「左栏 + 右栏」两栏，返回左栏里的 16:9 舞台。
     *
     * ⚠️ 基类 `buildUi()` 是「先 `contentEl.empty()` 再调本方法」⇒ 这里可以放心建整棵树；
     *    每次换片重建也走同一条路（旧的右栏随 empty 一起没了，引用在 `buildExtra` 里重接）。
     * ⚠️ 极窄窗口下两栏会挤 —— CSS 里 `@media` 断点改成上下堆叠（见 `styles.css` 的 `.rl-epp` 段），
     *    这里不写任何尺寸判断（布局归 CSS，JS 只搭结构）。
     */
    protected playerHost(): HTMLElement {
        // 🔴 容器查询的锚点：把 `contentEl` 声明成 inline-size 容器，窄屏断点(@container)
        //    才量的是**本视图宽度**而不是窗口宽度 —— Obsidian 里视图会被拖进侧栏/分屏，
        //    窗口 1400px 时侧栏仍只有 300px，用 `@media` 会画出两栏挤成一坨的错版式。
        //    ⛔ 别改用 JS 量 clientWidth 再切 data-tier：这页的断点只有「两栏/一栏」两档，
        //    纯 CSS 能表达就别引第二套档位真源（音频播放器那三档另说）。
        this.contentEl.addClass('rl-epp-host');
        // 🔴🔴 版式重构（用户 m00002 逐字裁定）：
        //    「简介、系列彻底移动到视频播放器下方（严格对齐左侧播放器宽度）」
        //    「字幕、选集面板始终保持排列在右侧栏（右侧栏总高度严格等于播放器高度）」
        //    「右侧栏底部加个轻量微件（高度严格对齐播放器下方简介+系列的高度）」
        //    ⇒ 骨架是**标题整行 + 上下两组各自的两列网格**：
        //      · 标题行（`.rl-epp-head`）横跨整页 —— 只有它在网格外，右栏才可能等于播放器高；
        //      · 上排 `.rl-epp-top`  = [播放器列][右侧栏格]；
        //      · 下排 `.rl-epp-below` = [简介+系列列][微件格]。
        //    🔴 右栏/微件各自装在一层 `position: relative` 的格里、本体 `position:absolute; inset:0`
        //       ⇒ 绝对定位子节点**不参与**网格行高计算，行高只由左列内容决定
        //       ⇒ 「右栏 == 播放器高」「微件 == 左下块高」是**布局算出来的**，不是 JS 量的。
        //       ⛔ 别改成 JS 量高度再写 style：窗口缩放/拖进侧栏/换字体都会漂，且多一份高度真源。
        const wrap = this.contentEl.createDiv({ cls: 'rl-epp' });
        this.wrapEl = wrap;
        // 标题行由 `buildHead()` 建（它要 `insertBefore` 到 top 之前，见那里的注释）
        const top = wrap.createDiv({ cls: 'rl-epp-top' });
        this.mainEl = top.createDiv({ cls: 'rl-epp-main' });
        // 舞台：固定 16:9，播放器 `.rl-vp-root` 在里面铺满（它自己是 height:100% 的 flex 列）
        this.stageEl = this.mainEl.createDiv({ cls: 'rl-epp-stage' });
        // 🔴 用户 m01782：「把『单集评价』做成一个悬浮快捷条，放在播放器正下方」
        //    ⇒ 独立一行，**紧贴舞台下缘**、与播放器同宽（它和舞台同属 `.rl-epp-main` 这一列，
        //      `width:100%` 自然对齐，⛔ 不需要 JS 量宽）。
        //    ⚠️ 为什么不放进 `.rl-epp-side`（原位置）：那栏 `absolute inset:0 + overflow-y:auto`，
        //      塞进去会逼出滚动条，破「总高严格等于播放器高」；
        //    ⚠️ 为什么不 absolute 压进舞台：用户选的是「独立一行」，压进画面会挡内容、全屏也跟着出现。
        //    ⚠️ 它**不参与**右栏等高计算以外的地方：`.rl-epp-main` 是 flex 列，
        //      多这一行只让左列长高，右栏格 `align-self:stretch` 跟着等高（正是既有的等高机制）。
        this.reviewBarEl = this.mainEl.createDiv({ cls: 'rl-epp-rvbar' });
        // 右栏格：**空壳**，真正可滚的 `.rl-epp-side` 绝对铺满它（见上）
        const railCell = top.createDiv({ cls: 'rl-epp-rail' });
        this.sideEl = railCell.createDiv({ cls: 'rl-epp-side' });
        // 下排：左 = 简介 + 系列；右 = 轻量微件（同样绝对铺满）
        const below = wrap.createDiv({ cls: 'rl-epp-below' });
        this.lowEl = below.createDiv({ cls: 'rl-epp-low' });
        const widCell = below.createDiv({ cls: 'rl-epp-widcell' });
        this.widgetEl = widCell.createDiv({ cls: 'rl-epp-widget' });
        return this.stageEl;
    }

    /**
     * 骨架之后补内容：左栏的「标题块（在舞台上方）+ 信息卡（在舞台下方）」和右栏三块。
     *
     * ⚠️ 标题块/信息卡用 `insertBefore` / `appendChild` 挂到 `mainEl` 上，
     *    而播放器骨架（`root`）已经在 `stageEl` 里了 ⇒ 三者是兄弟关系，互不嵌套。
     */
    protected buildExtra(_root: HTMLElement): void {
        const ctx = this.pageCtx;
        if (!ctx || !this.lowEl || !this.sideEl) return;
        // 🔴 先收掉上一轮的菜单实例：`buildUi()` 刚 `contentEl.empty()` 过，
        //    旧组件的 DOM 已经不在树上了，但实例还挂着 `window` 上的 mousedown/keydown 监听
        //    （见 `EntryContextMenu` 的 `unbindWindow`）⇒ 不销毁就是每次换片漏一组监听。
        this.destroyEntryMenu();
        this.buildEntryMenu();
        this.buildHead();
        // 🔴 顺序（用户 m00002 版式）：标题行 → 下排左列（简介 + 系列）→ 右栏（字幕 + 选集）→ 微件
        //    ⚠️ 下排必须**先**建：`buildSeasons()` 要往 `seasonsEl` 里填卡片，
        //       而 `seasonsEl` 在 `buildLow()` 里才创建（旧版是 `buildSide` 顺手建，现在搬家了）。
        this.buildLow();
        // 🔴 必须紧跟 `buildLow()`：`buildLow()` 只建了「系列」节的骨架和 `.rl-epp-seasons` 容器，
        //    卡片是 `buildSeasons()` 往里填的 —— 少这一行，下排的系列带永远是空的（骨架在、内容是空）。
        this.buildSeasons();
        this.buildSide();
        this.buildWidget();
        // 控制条「选集 / 字幕」两枚按钮：本页右栏已常驻这两个入口 ⇒ 非全屏时藏起来（用户规格）
        this.markDupToggles();
        // 面板要跟播放进度联动 ⇒ 挂 `timeupdate`（换片后 video 会换人，`afterRender` 里重绑）
        this.bindCueTicker();
        // 首屏就把「当前集」滚进视野（异步两帧，等布局定下来）
        this.scrollCurIntoView();
    }

    /**
     * 下排左列 = **简介 + 系列**（用户 m00002：「简介、系列彻底移动到视频播放器下方，
     * 简介、系列严格对齐左侧播放器宽度，系列始终横向排列鼠标滚轮左右滑动」）。
     *
     * 🔴 为什么这两块要放同一个容器 `.rl-epp-low`：微件的高度要「严格对齐播放器下方简介+系列的高度」
     *    ⇒ 需要一个**单一盒子**作为基准。分成两个兄弟节点时，右列要么对其中一块、要么自己算总高，
     *    两种都会在折叠/内容变化时漂。
     * ⚠️ 两节**曾经**做成可折叠（与右栏同款 `buildSection`）：简介长文折叠后微件自然变矮，仍是严格相等。
     *    🔴 **2026-11-08 用户裁定「简介、系列不再可收起，默认展开」** ⇒ 两节改成 `collapsible = false`
     *    的常显节（`buildSection` 第 4 参），箭头与点击监听一并撤掉。
     *    ⚠️ 这**不会**破坏「微件与左下严格等高」：等高来自 `.rl-epp-low` 这个单一盒子本身
     *    （右列 `align-self: stretch`），与节能不能折叠无关；折叠只是过去让用户手动调矮的一个入口。
     */
    private buildLow(): void {
        const ctx = this.pageCtx;
        const low = this.lowEl;
        if (!ctx || !low) return;
        low.empty();

        // ① 简介节（常显 —— 用户 2026-11-08：不再可收起）
        const infoSec = this.buildSection(low, '简介', true, false);
        this.infoBoxEl = infoSec.body.createDiv({ cls: 'rl-epp-lowinfo' });
        // ⚠️ 传 `false`：片名已经在上方标题块 `.rl-epp-head` 里了，
        //    下排再画一遍就是同一句话出现两次（版式搬到舞台下方后才会撞，以前在右栏不显眼）。
        this.buildInfoCard(this.infoBoxEl);
        // 没有简介也没有任何元信息时整节藏掉（只留「简介」标题 + 一个空壳是噪音）。
        // 🔴 判据必须查**具体内容**再决定：`buildInfoCard` 无条件建 `.rl-epp-info` 外壳
        //    ⇒ 拿 `.rl-epp-info` 判 `hasInfo` 会恒为 true，这个 `is-empty` 就成了死代码。
        const hasInfo =
            !!ctx.overview ||
            !!ctx.coverUrl ||
            (typeof ctx.entry.rating === 'number' && ctx.entry.rating > 0) ||
            (ctx.entry.genres?.length ?? 0) > 0 ||
            [ctx.entry.type, ctx.entry.year, ctx.entry.country, ctx.entry.language].some((x) => !!x);
        infoSec.sec.toggleClass('is-empty', !hasInfo);

        // ② 系列节（常显 —— 用户 2026-11-08：不再可收起；始终横向 + 滚轮横滑，容器交给 `buildSeasons()` 填）
        const seaSec = this.buildSection(low, '系列', true, false);
        // 🔴 用户 2026-11-08 第二句：「这个系列区块的『全部15部』移动到系列标题旁边」。
        //    ⇒ 从横带**体内**（原 `buildSeasons()` 里那个 `.rl-epp-seasonsmore`）搬到标题行右侧。
        //    为什么搬对了：它是「这个区块的总量 + 展开入口」，属于**节级操作**，
        //      塞在横带里会被横向滚动带走（季数一多就滚出视野，用户得先把带子滑到底才看得见）。
        //    ⚠️ 文案与点击行为仍由 `buildSeasons()` 决定（那里才知道 `relatedSeasons` 的真实条数），
        //       这里只**预留一个空槽**；`buildSeasons()` 每次重画时清空重填。
        //    ⛔ 别在 `buildLow()` 里算条数：`buildLow` 跑在 `buildSeasons` 之前，
        //       那时 `allEntries` 还没进 `relatedSeasons` 的同一套判据，两处口径一定会漂。
        this.seasonsMoreEl = seaSec.head.createDiv({ cls: 'rl-epp-seasonsmore' });
        // ⚠️ 监听**只在这里挂一次**（槽是这一行新建的）：放进 `buildSeasons()` 会随每次重画
        //    再挂一个，点一下打开两遍季列表。文案由 `buildSeasons()` 回填。
        this.seasonsMoreEl.addEventListener('click', (ev) => {
            // 标题行在可折叠节上是开合开关；这一节虽然 `is-static`（不可折），
            // ⛔ 但别把「能不能点」赌在别的类的状态上 —— 显式吃掉冒泡。
            ev.stopPropagation();
            this.pageCtx?.onOpenSeriesList();
        });
        this.seasonsEl = seaSec.body.createDiv({ cls: 'rl-epp-seasons' });
    }

    /**
     * 右栏底部那格「轻量微件」—— **相关推荐**（用户 2026-11-10 改造）。
     *
     * 🔴 用户原话：「观看进度栏彻底改成如相关推荐只随机显示电影或其他动画上限几部，横封面竖排」。
     *    ⇒ 整块从「观看进度（环 + 当前集 + 系列总进度 + 继续观看）」换成了
     *      **随机抽取的电影/动画推荐**，每项是**横封面 + 文字竖排**（封面在左、文字在右，
     *      一条一条竖着往下排 —— 这正是「横封面竖排」的字面意思）。
     *
     * ⚠️ 「彻底改成」= 旧的进度环 / 集数文案 / 继续观看按钮**全部删掉**，⛔ 不留一半。
     *    它原来那套 `widgetRefs.render` 也随之不再需要（没有随播放进度变化的内容了）。
     * 🔴 但 `widgetRefs` 字段**保留**（红线：字段只增不删），只是本方法不再往里写。
     *
     * ⚠️ 随机只在这里算**一次**（`buildWidget` 在建页 / 换片时跑）：
     *    若放进某个每帧都跑的 `render` 里，推荐列表会随着播放不停跳动 —— 那就没法点了。
     * ⚠️ 候选池与洗牌逻辑在 `pure/episodePage.pickRecommendations`（可单测），
     *    ⛔ 别在视图层再写一份 `Math.random` 排序（那个比较器不满足传递性，分布是偏的）。
     */
    private buildWidget(): void {
        const ctx = this.pageCtx;
        const host = this.widgetEl;
        if (!ctx || !host) return;
        host.empty();

        const card = host.createDiv({ cls: 'rl-epp-wcard' });
        const head = card.createDiv({ cls: 'rl-epp-whead' });
        head.createSpan({ cls: 'rl-epp-wname', text: '相关推荐' });

        // 🔴 这里**不传 seed**（真随机）：每次进页面/换片重新抽一批，才有「推荐」的味道。
        //    传 seed 是单测专用能力（见 `pickRecommendations` 的注释）。
        const picks = pickRecommendations(ctx.entry, ctx.allEntries, RECOMMEND_LIMIT);
        if (picks.length === 0) {
            // 库里只有这一部 / 全是 tv、book ⇒ 如实说没有，⛔ 不留一个空壳卡片
            card.createDiv({ cls: 'rl-epp-wempty', text: '暂无可推荐的内容' });
            return;
        }

        const list = card.createDiv({ cls: 'rl-epp-wlist' });
        for (const e of picks) {
            const item = list.createDiv({ cls: 'rl-epp-witem' });
            item.setAttribute('data-tip', e.title);
            // 横封面：**固定 16:9**（横版），⛔ 不用 2:3 竖版 —— 用户明确要「横封面」。
            // 没有图就留灰底占位块，⛔ 不猜路径、不显示破图图标。
            const cov = item.createDiv({ cls: 'rl-epp-wcov' });
            const src = ctx.seasonCover(e);
            if (src) {
                const img = cov.createEl('img', { cls: 'rl-epp-wcovimg' });
                img.src = src;
                img.alt = e.title;
                img.addEventListener('error', () => {
                    img.remove();
                    if (!cov.querySelector('.rl-epp-wcovph')) cov.createDiv({ cls: 'rl-epp-wcovph' });
                });
            } else {
                cov.createDiv({ cls: 'rl-epp-wcovph' });
            }
            // 文字**竖排**：标题在上、副信息在下，整体吃满剩余宽（`min-width:0` 才能 ellipsis）
            const txt = item.createDiv({ cls: 'rl-epp-wtxt' });
            txt.createDiv({ cls: 'rl-epp-wtitle', text: e.title });
            // 副行：年份优先（最能帮用户认片），没有就退回题材首项，再没有就整行不建
            const sub = (typeof e.year === 'number' && e.year > 0
                ? `${e.year}`
                : String(e.genres?.[0] ?? '').trim());
            if (sub) txt.createDiv({ cls: 'rl-epp-wsub', text: sub });
            // 点击 = 换到那一部（复用既有 `onOpenSeason`，⛔ 不新开播放通路）
            item.addEventListener('click', () => ctx.onOpenSeason(e));
        }
    }

    /**
     * 微件里「本集进度」的分子/分母。
     * ⚠️ 分母优先取 `<video>.duration`（真时长）；拿不到就是 0，环画成空环，⛔ 不猜一个假时长。
     */
    private episodeRatio(): number {
        const v = this.videoElement();
        const dur = v && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
        const cur = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
        return dur > 0 ? cur / dur : 0;
    }

    /** 本集总集数（与选集格同源：`episodeCellCount` 口径 ⇒ ⛔ 不另算一套） */
    private episodeTotal(): number {
        const ctx = this.pageCtx;
        if (!ctx) return 0;
        return episodeCellCount({
            files: ctx.files,
            urls: ctx.urls,
            titles: ctx.titles,
            total: ctx.total,
        });
    }

    /**
     * 全系列已看 / 总集数（微件的第二行）。
     *
     * 🔴 口径（⛔ 别自己发明）：**已看集数 = 各季 `progress.episode` 的累加**，
     *    总集数 = 各季 `totalEpisodes`（没有就用该季已关联的集数）。
     *    这正是宿主列表页「追更」用的同一份数据（`entry.progress`），不引第二套统计。
     * ⚠️ 当前季的 `progress.episode` 可能是旧值（用户正在看的这一集还没落库）⇒
     *    取 `max(progress.episode, 当前格 + 1)`，否则微件会显示「已看 3 集」但用户明明在第 10 集。
     */
    private seriesProgress(): { watched: number; total: number } {
        const ctx = this.pageCtx;
        if (!ctx) return { watched: 0, total: 0 };
        const rel = relatedSeasons(ctx.entry, ctx.allEntries);
        let watched = 0;
        let total = 0;
        for (const e of rel) {
            const p = e.progress;
            const seen = Math.max(0, (p?.episode ?? 0) || 0);
            const tot = Math.max(0, (p?.totalEpisodes ?? 0) || 0);
            watched += seen;
            total += tot > 0 ? tot : seen;
        }
        // 当前集还没写进 progress（正在看）⇒ 至少算到这一集
        const cur = this.activeCellIndex();
        if (cur >= 0) watched = Math.max(watched, cur + 1);
        return { watched, total: Math.max(total, watched) };
    }

    /**
     * 「继续观看」的秒数来源。
     *
     * 🔴 优先级（⛔ 别颠倒）：
     *   1. **当前视频已在播/已起播**（`currentTime > 0`）⇒ 用它。这是最准的「我现在看到哪」，
     *      用户拖过进度条后再点续播，必须回到**刚拖到的位置**，而不是库里那条旧断点。
     *   2. 还没起播（`currentTime === 0`）⇒ 查 `pageCtx.positions[当前集下标]` 的历史断点。
     *      这是「关掉页面明天再打开」的场景：库里的秒数才是唯一线索。
     * ⚠️ 两者都没有 ⇒ 0，按钮禁用。语义是「这一集没看过」，⛔ 不假装能续播。
     * ⚠️ 键必须用 `activeCellIndex()`（真实集下标），与 `persistVideoPosition()` 的 `^\d+$` 键同一口径。
     */
    private resumeSeconds(): number {
        const v = this.videoElement();
        const cur = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
        if (cur > 0.5) return cur;
        const idx = this.activeCellIndex();
        if (idx < 0) return 0;
        const saved = this.pageCtx?.positions?.[String(idx)];
        return typeof saved === 'number' && Number.isFinite(saved) && saved > 0.5 ? saved : 0;
    }

    /** 起播（微件「继续观看」用；⛔ 不接管控制条那套播放态，只把暂停的播起来） */
    private async playIfPaused(): Promise<void> {
        const v = this.videoElement();
        if (!v || !v.paused) return;
        try {
            await v.play();
        } catch {
            /* 自动播放被拦（无用户手势/静音策略）—— 静默失败：seek 已经生效，用户按一下即可 */
        }
    }

    /**
     * 给控制条上「与右栏重复」的两枚按钮打标记（显隐**全在 CSS**，JS 不掺和）。
     *
     * 🔴 用户规格：「详情页隐藏『选集』和『字幕』两个按钮，因为右侧栏已常驻展示这两个入口；
     *    全屏时右侧栏消失，底部控制栏正常显示全部控件」。
     *    这两句正好是一对互斥条件 ⇒ 交给一条 CSS 选择器表达（`:fullscreen` 时放行），
     *    ⛔ 不在 JS 里跟全屏状态来回 `toggleClass`：那会多出一份「当前是不是全屏」的真源。
     * ⚠️ 2026-11-07：`.is-fs`（本页占满窗口态）已随「全屏+」按钮一起删除，选择器里只剩 `:fullscreen`
     *    —— 那是浏览器真全屏（用户按 F11 / 系统全屏），与本站按钮无关，判据照样是「右栏在不在」。
     */
    private markDupToggles(): void {
        const t = this.sideBarToggles();
        t.episodes?.addClass('rl-epp-dupbtn');
        t.subtitles?.addClass('rl-epp-dupbtn');
    }

    /** 换片 / 切集重画之后：只同步选集区高亮 + 选集页头部，不整屏重建 */
    protected afterRender(): void {
        // 🔴 换片会重建整棵树（`buildUi` 里 `contentEl.empty()`）⇒ 旧的内嵌层已经随 DOM 没了，
        //    但 `netIndex` 这些字段还活着；不清的话面板会一直以为「现在是网络集」。
        //    ⛔ 这里不能用 `exitNetEmbed()`：那个会去 `stageEl` 上摘 class，而 stageEl 此刻是新的，
        //    摘了也没事但会白跑一遍 syncNetMode；直接归零字段最省事且没有副作用。
        this.clearNetTimer();
        this.netIndex = null;
        // 🔴 `empty()` 只把节点从树上摘下来，**不会**让 `<video>` 停止解码 —— 脱离文档的视频仍会继续出声。
        //    更要命的是：`netVideoEl` 若留着这个孤儿引用，下一次 `mountNetVideo()` 的 `if (!v)` 就是假，
        //    它会「复用」一个不在新层里的播放面 ⇒ 新层只剩工具条 + 黑屏（真机踩过，表现为「点了不播放」）。
        //    所以这里必须连播放面一起作废，⛔ 不能只归零 `netLayerEl` / `netFrameEl`。
        this.detachNetVideo();
        this.netLayerEl = null;
        this.netFrameEl = null;
        /**
         * 🔴 用户 2026-11-10（m03035）：「从播放器详情页相关推荐进入的条目播放详情页由于没有任何
         *    关联播放器屏幕一直在转圈 改成显示未关联空态」。
         *
         *    病根：相关推荐点进来的条目只要本地集与网络集**都是空**，基类 `items` 就是空数组 ⇒
         *    `render()` 走「没有可播项」那条路把占位层点亮，而文案是恒定的「正在加载视频…」+
         *    转圈 —— 那件事永远不会结束（没有任何加载在进行），用户看到的就是「一直转圈」。
         *    ⇒ 这里按真实数据分两种形态：一条 media 都没关联 ⇒ 未关联空态（不转圈）；
         *      有 media 但落不到可播项（编码不支持等）⇒ 保持「正在加载」，由后续流程交代。
         * ⚠️ 判据必须放在 `afterRender`（`render()` 之后必调一次，见基类无本地项那条分支），
         *    ⛔ 不能塞在 `buildUi` 里 —— 那时 `pageCtx` 还没绑定。
         */
        this.setEmptyStageMode(emptyStageModeFor(this.pageCtx?.files.length ?? 0, this.pageCtx?.urls.length ?? 0));
        this.syncCells();
        this.syncHead();
        this.scrollCurIntoView();
        // 换集 ⇒ 字幕换一份 ⇒ 面板必须重解析（来源键里带集下标，这里只需把旧键作废）
        this.cueSrc = null;
        this.cueImported = null;
        // 来源标识跟着集走：不清就会把上一集的「AI」标到这一集没有字幕的头上
        this.cueSourceTag = null;
        // 🔴 失败原因同理：上一集可能是「Cookie 失效」，这一集可能本来就是没字幕轨。
        //    不清就会拿上一集的诊断给这一集定罪（用户 m06406 ④ 的两种空态全靠它）。
        this.cueNetFail = null;
        // 🔴 上一集的手动选择不适用于这一集：不在这里清，往后每一集都会因为
        //    `cueImportedManual === true` 而永久拦掉网络字幕自动抓取。
        this.cueImportedManual = false;
        this.cueVideoEl = null;
        this.bindCueTicker();
        void this.syncCueSource();
        // 🔴 换集瞬间基类的 `subFile` 可能已经是下一集的值（也可能还没定），
        //    这里先按**当下已知**同步一次开合态；候选异步回来后在 `afterSubtitles()` 再同步一次。
        //    ⚠️ 中间这一步不是冗余：切到「本来就没字幕」的集时，异步那次可能因无候选而很快 return，
        //      不在这里先收，面板会一直开着显示上一集的空壳。
        this.syncSubsOpen();
        // 🔴 首次渲染：宿主若标了「打开就内嵌到第 N 集」，这一跳必须补上
        //    （`startIndex` 只覆盖本地可内嵌集，纯网络集在 `items` 里没有位置）。
        const startNet = this.pendingNetStart;
        this.pendingNetStart = null;
        if (startNet !== null) {
            const u = this.pageCtx?.urls[startNet];
            // ⚠️ 判据是 `canPlayNetInline`（B 站 + YouTube），⛔ 不是 `canEmbedBili`：
            //    后者只认「能拼出 B 站 iframe 地址」，拿它当进门闸门会让 YouTube 集
            //    停留在「打开就跳浏览器」——正是用户 2026-10-31 报的那条。
            if (u && canPlayNetInline(u)) {
                this.enterNetEmbed(startNet, u);
                this.cellsPage = Math.max(0, Math.floor(this.orderedCellPos(startNet) / EPISODE_PAGE_SIZE));
                this.syncCells();
            } else if (u) {
                this.pageCtx?.onOpenUrl(u);
            }
        }
    }

    /** 字幕候选变化后：只重画右栏字幕块 */
    protected afterSubtitles(): void {
        // 字幕挂载项变了 ⇒ 面板 cue 来源变（`cueKey()` 已含文件名，这里强制重走一遍解析）
        void this.syncCueSource();
        // 🔴 同一时机也要重算「字幕节默认开合」：候选是异步加载的，
        //    建节那一刻 `subtitleFileName()` 还是 null ⇒ 有字幕的片子会先折起来，
        //    不在这里回填就永远是折的（用户 2026-11-08：「有字幕就默认展开」）。
        this.syncSubsOpen();
    }

    /**
     * 「字幕」节的默认开合态跟着**字幕可用性**走（用户 2026-11-08：
     * 「没有字幕时字幕面板默认折叠起来，有字幕就默认展开」）。
     *
     * 🔴 只在可用性**翻转**时动手（`subsOpenSynced` 记上一次的自动态）：
     *    · 无 → 有：展开（用户刚导入字幕 / 这套片本来就有字幕，理应直接看到时间轴）
     *    · 有 → 无：折叠（切到没字幕的那一集，一个空面板占半屏纯属碍事）
     *    · 没翻转：**什么都不做** —— 用户手动收起过的面板不能被下一次渲染弹开
     *      （`subsSec.head` 的点击里已把 `subsOpenSynced` 同步成当前真值，
     *        所以手动收起来之后，下一次同可用性的 sync 不会判定为「翻转」）。
     *
     * ⚠️ 判据用「有没有一份**具体字幕**」= `cueImported || subtitleFileName()`，⛔ 不用 `cueCues.length`：
     *    后者是**解析结果**，字幕文件损坏时也是 0 行，但那时面板该开着并显示「没解析出内容」的提示。
     * 🔴 必须带上 `cueImported`（用户 2026-11-09「网络集字幕面板显示 B 站 AI 字幕」）：
     *    网络集的 B 站字幕走 `cueImported` 通路，基类 `subFile` 恒为 null ⇒ 只看 `subtitleFileName()`
     *    会让网络集的字幕面板**永远保持折叠**，用户根本看不到抓回来的时间轴（真机实测：
     *    `cueRows=2084` 但 `listScrollH=0`，即面板是收起的）。
     */
    private syncSubsOpen(): void {
        const sec = this.subsSecEl;
        if (!sec) return;
        const has = !!(this.cueImported || this.subtitleFileName());
        if (this.subsOpenSynced === has) return; // 没翻转 ⇒ 尊重用户当前状态
        this.subsOpenSynced = has;
        sec.setAttribute('data-open', has ? '1' : '0');
        // 从折叠变展开：刚有布局，把当前行滚进提词器位置（折叠时量不到高度，滚出来是错的）
        if (has) this.locateCue();
    }

    // ── 左栏：标题块 + 信息卡 ────────────────────────────────────────────────────

    /** 标题块（舞台上方的「片名 · 第 N 集」+ 系列副标题）
     *  ⚠️ 两级全屏按钮**不在这里** —— 用户 2026-10-27 第三次裁定「全部内置在播放器底部控制条上」，
     *     见 `buildFsButtonsSel()`（走的还是控制条右组的 `fsSlot()` 插槽）。 */
    private buildHead(): void {
        const ctx = this.pageCtx;
        if (!ctx || !this.wrapEl || !this.mainEl) return;
        const top = this.mainEl.parentElement;
        const head = this.wrapEl.createDiv({ cls: 'rl-epp-head' });
        // 插到上排之前（createDiv 是追加到末尾的，这里要显式挪）——
        // 🔴 标题块是**整页第一行**（横跨网格两列），⛔ 不能塞进 `.rl-epp-main`：
        //    塞进去它就成了上排左列的一部分，右栏"等于播放器高"会被标题高度污染。
        if (top) this.wrapEl.insertBefore(head, top);
        const text = head.createDiv({ cls: 'rl-epp-headtxt' });
        text.createDiv({ cls: 'rl-epp-title', text: ctx.entry.title });
        const sub = text.createDiv({ cls: 'rl-epp-sub' });
        // 副标题：系列名 + 第几部（有哪个写哪个，⛔ 不留空占位）
        //
        // 🔴 用户 2026-11-01 逐字：「详情页顶部系列显示年份和简介显示年份冲突了」。
        //    改前这里也 push 了 `entry.year` ⇒ 页面上出现**两个年份**：顶部副标题一个
        //    （`系列 · 第N部 · 2019`），简介元信息里又一个（`2019 · 作者`）。
        //    同一条 entry 的同一个字段画两遍，读起来就是「两个年份在打架」。
        // ⇒ 年份只在**简介卡**里出现一次（用户已定顺序：标题 / 年份-作者 / 题材 / 简介，
        //    见 `buildInfoCard` 的注释），顶部副标题只留「系列 · 第几部」这类**定位信息**。
        // ⚠️ 副标题后面还会被 `syncHead()` 追加「第 N 集」（走 `data-base`），
        //    所以这里拼出来的 `bits` 就是 `data-base` 的初值 —— 别把年份加回去。
        // ⛔ 别反过来删简介卡的年份：那行是用户明确点名要的顺序，年份是它的第一项。
        const bits: string[] = [];
        if (ctx.entry.series) bits.push(ctx.entry.series);
        const ord = seasonOrdinalLabel(ctx.entry);
        if (ord) bits.push(ord);
        if (bits.length > 0) sub.setText(bits.join(' · '));
        else sub.remove();

        // 🔴 用户 2026-10-28：「信息栏可收起来，按钮放在标题上」
        //    ⇒ 开关画在**标题块右侧**（不是信息栏自己头上）：栏收起时信息栏整块消失，
        //      按钮若长在栏里会跟着没了，用户就再也打不开（自锁死）。
        //    `.rl-epp-headacts` / `.rl-epp-sidebtn` 是既有 CSS（一直没接线的死规则），这里复用。
        const acts = head.createDiv({ cls: 'rl-epp-headacts' });
        const sideBtn = acts.createEl('button', { cls: 'rl-epp-sidebtn' });
        sideBtn.addEventListener('click', () => this.toggleSide());
        this.sideToggleEl = sideBtn;
        // 首屏按字段回填（`buildExtra` 可能因换片重跑，收起态不该被悄悄重置成展开）
        this.syncSideBtn();
        this.syncSideCollapsed();
    }

    /** 收起 / 展开信息栏（用户 2026-10-28：「信息栏可收起来」） */
    private toggleSide(): void {
        this.sideCollapsed = !this.sideCollapsed;
        this.syncSideCollapsed();
        this.syncSideBtn();
    }

    /**
     * 把收起态落到 DOM：宿主类 + 网格列。
     *
     * 🔴 收起 = **两件事**，缺一件就是假的：
     *    ① `.rl-epp-side` 消失；② `.rl-epp-top` 的右列轨道也归零 ——
     *    只藏栏不改轨道，播放器左边会留一条 340px 的空槽（探针实测过）。
     * ⚠️ 收起后「选集 / 字幕」在页面上**再无别的入口**（那两枚控制条按钮平时被
     *    `.rl-epp-dupbtn` 藏起来了）⇒ CSS 里把它们在 `is-side-hidden` 时放回来，
     *    否则用户一收栏就再也选不了集（这是功能闸，不是样式偏好）。
     */
    private syncSideCollapsed(): void {
        this.contentEl.toggleClass('is-side-hidden', this.sideCollapsed);
    }

    /** 开关按钮的图标 / 提示语跟着收起态走（同一个按钮两种语义，不给它建副本） */
    private syncSideBtn(): void {
        const btn = this.sideToggleEl;
        if (!btn) return;
        btn.empty();
        safeSetIcon(btn, this.sideCollapsed ? 'panel-right-open' : 'panel-right-close');
        const tip = this.sideCollapsed ? '展开信息栏' : '收起信息栏';
        setTip(btn, tip);
        srLabel(btn, tip);
    }

    // ── 控制条：全屏按钮（内置在播放器底部）──────────────────────────────────────

    /**
     * 覆写基类的「全屏区」：画**一枚**按钮 = 换页到内置播放器标签页（用户 2026-11-06 裁定）。
     *
     * 🔴 用户 m05462 逐字：「删除掉全屏+播放按钮和其页面样式」⇒ 旧的两颗按钮
     *    （① 全屏 = 交接、② 全屏+ = 浏览器真全屏）收成一颗，`.is-fs` 那套「本页占满窗口」
     *    的样式态一并删除（它只服务于被删掉的 ②）。
     * 🔴 同一轮裁定：「新播放器页面点击全屏按钮时进入到原来的播放器页面，再点全屏按钮
     *    返回到新播放器页面」⇒ 两页互跳：本页这颗去播放器页，播放器页那颗回本页
     *    （回跳由宿主注入的 `onBackToEpisodePage` 驱动，见 `VideoPlayerView.buildFsButtons`）。
     * ⚠️ 不再把按钮交回 `this.fsBtn`：本页不再有「浏览器真全屏」态，`onFsChange` 没东西可切。
     */
    protected buildFsButtons(right: HTMLElement): void {
        const b = right.createEl('button', {
            cls: 'rl-btn rl-vp-btn rl-vp-iconbtn',
            attr: { 'data-tip': '全屏（在播放器中播放）' },
        });
        safeSetIcon(b, 'maximize');
        b.addEventListener('click', () => this.handOffToPlayerTab());
    }

    /**
     * 全屏①：把当前这一集**交接给内置播放器标签页**（用户 2026-11-06 裁定）。
     *
     * 🔴 改前的语义是「本页打 `data-fs`、把右栏和季带藏起来」（窗内样式态）。用户逐字说的是
     *    「再点全屏进入该原播放器标签页」⇒ 要的是**换页**，不是把本页放大。两者冲突，
     *    以用户最新口径为准：① 交接并全屏，② 仍是浏览器真全屏（那个才是「占满屏幕」）。
     *
     * ⚠️ 网络集交接不进来：内置播放器已不播网络流（2026-11-24 用户裁定），
     *    网络集只在选集页用官方 iframe 播 ⇒ 本视图只报「哪一集、第几秒、是不是网络集」。
     * ⚠️ 秒数取 `videoElement().currentTime`（本地集在这颗元素上）；iframe 态下它是不动的 0，
     *    那种情况本来也交接不了 —— 见下面的 `net` 判据。
     */
    private handOffToPlayerTab(): void {
        const fn = this.pageCtx?.onOpenPlayerTab;
        if (!fn) return;
        const idx = this.activeCellIndex();
        const v = this.videoElement();
        const seconds = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
        // `net` 的口径 = 「这一格是不是网络来源」（判 `netIndex`，⛔ 不是判有没有本地流）。
        const net = this.netIndex !== null;
        // 🔴 2026-11-10 用户报障：「同时存在多个音轨播放」「全屏后和原详情页播放时的进度不同步」。
        //    真机实测根因：交接**不关也不停**本页，于是 `reelludic-video-player` 与
        //    `reelludic-episode-page` 两个标签页并存、两颗 <video> 各播各的 ⇒ 两路音、两个进度。
        //    ⇒ 交接前先把本页这一路停掉（秒数已取到 `seconds`，不受影响）。
        // ⛔ 别改成 `this.close()` / `leaf.detach()`：选集页是用户要看的页，交接只是换播放面。
        //
        // 🔴 2026-11-24：`degraded` 随「网络集不再自取流」一起删除 —— 没有 DASH 管线就没有
        //    「本页降级过」这件事，网络集交接进播放器页的语义也只剩「这一格是网络来源」。
        this.pauseVideo();
        fn({ index: idx, seconds, net });
    }

    /** 头部里的「当前集」文案（换集时同步） */
    private syncHead(): void {
        const ctx = this.pageCtx;
        // 🔴 版式重构后标题块**搬出了** `.rl-epp-main`（现在是整页第一行 `.rl-epp-head`）
        //    ⇒ 不能再从 `mainEl` 里找 `.rl-epp-sub`：那里永远找不到，副标题会一直停在初始文案。
        //    从 `wrapEl`（页面根）找，同时兼容 `mainEl` 为空的早期状态。
        const root = this.wrapEl ?? this.mainEl;
        if (!ctx || !root) return;
        const sub = root.querySelector<HTMLElement>('.rl-epp-sub');
        if (!sub) return;
        const ep = this.activeCellIndex();
        if (ep >= 0) {
            const label = this.isSingle() ? `文件 ${ep + 1}` : `第 ${ep + 1} 集`;
            const base = sub.getAttribute('data-base') ?? sub.getText();
            if (!sub.getAttribute('data-base')) sub.setAttribute('data-base', base);
            sub.setText(base ? `${base} · ${label}` : label);
        }
    }

    /**
     * 信息块（现在挂在**下排左列**的「简介」节里）。
     *
     * 🔴 m02759（2026-11-17 用户逐字）：「还有这封面上的评分角标去掉，把来源评分放到简介栏
     *    右上角横排，题材和标签两种只留标签，还有加个大标题在简介栏」
     *    ⇒ 四处改动：⑴ 封面右上角那颗 `.rl-epp-cov-score` **整块删除**；
     *      ⑵ 来源评分挪到简介栏**第一行右侧横排**（`.rl-epp-info-top`，`margin-left: auto`）；
     *      ⑶ 「类型 + 题材」那排胶囊整排删除（用户裁定「只留标签」，⛔ 连类型胶囊也不要）；
     *      ⑷ 简介栏加**大标题**。
     *
     * 🔴 大标题的重复问题（用户当场裁定）：「简介栏加，页头那个也保留」。
     *    ⇒ 本方法**无条件**画标题行，⛔ 别再传 `showName=false` 把标题关掉；
     *      页头的 `.rl-epp-title` 照旧 —— 滚到下排时仍能一眼看出这是哪部作品。
     *      改前是 `showName = false`（两处调用点都传 false），理由是「片名已在页头」，
     *      那条理由被本轮用户原话直接推翻。
     */
    private buildInfoCard(parent: HTMLElement): void {
        const ctx = this.pageCtx;
        if (!ctx) return;
        const card = parent.createDiv({ cls: 'rl-epp-info' });
        // 封面（没有就整块不画图片位，⛔ 不留灰框）
        if (ctx.coverUrl) {
            const cov = card.createDiv({ cls: 'rl-epp-info-cov' });
            const img = cov.createEl('img');
            img.src = ctx.coverUrl;
            img.alt = ctx.entry.title;
            // 🔴 m02759（2026-11-17 用户逐字）：「还有这封面上的评分角标去掉，把来源评分放到简介栏
            //    右上角横排」
            //    ⇒ 这里原本有一颗 `.rl-epp-cov-score` 胶囊角标（2026-11-16 加的「评分放封面右上角
            //      （像卡片网格视图那样）」），**本轮整块删除**：分数挪到简介栏第一行右侧横排
            //      （见下面 `buildSourceLine` 的新形态）。⛔ 别因为嫌「简介栏没分数」又把它搬回封面 ——
            //      用户已明确否掉封面角标这个位置，两处同源文案也是他自己点名要去掉的重复。
            // ⚠️ 变量也随之删干净（`scoreTextOf` / `scoreIsPercentOf` / `entrySourceLabel` 在本文件
            //    仍有别处使用，⛔ 别连 import 一起删）。
            // 🔴 用户 2026-11-08：「同时简介的封面可右键可弹窗菜单（同海报墙编辑属性逻辑）」
            //    ⇒ 右键转发给宿主，由它弹**同一个** `EntryContextMenu`（菜单项一次都不在这里写）。
            // ⚠️ 挂在 `.rl-epp-info-cov` 而不是 `<img>`：图有 `object-fit: cover`，
            //    图片被裁时 `<img>` 自身的盒子仍等于封面格，但把监听放在外层格子上
            //    才能连「上下留白的裁切区」一起响应 —— 用户右键点在封面格任何位置都该出菜单。
            // ⚠️ `preventDefault` 必须在这里先做一次：组件里的 `openAt` 也要挡，
            //    但宿主回调是 async 的（要 `await tick()` 才量得到尺寸），
            //    等它回来再挡，浏览器原生菜单已经弹出来了。
            if (ctx.entryMenu) {
                cov.addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.openEntryMenu(ctx.entry, ev);
                });
                // 悬停提示：不写的话用户不知道这里能右键（海报墙卡片有同款暗示）
                // 🔴 2026-11-12（①-9）：改走 `setTip`（只留 data-tip）+ `.rl-sr` 读屏名，
                //    不再单独挂 `aria-label` —— 两者并存会叠出两层气泡。
                setTip(cov, '右键：条目菜单');
                srLabel(cov, '右键：条目菜单');
            }
            // 🔴 用户 2026-11-14：「播放器详情页简介封面加左键单击进笔记」
            //    ⇒ 封面可点 = 打开这条条目的笔记（宿主的 `openEntryNote`，无笔记会自动生成）。
            //    ⚠️ 只挂 `click`，**不**改 `contextmenu`（两者共存：左键进笔记、右键出菜单）。
            //    ⚠️ 挂 `cov` 而不是 `<img>`：与右键同一条理由 —— 图有 `object-fit: cover`，
            //       裁切留白区也该响应点击。
            //    ⚠️ 不判 `btn === 0`：`click` 本身只在主键（含键盘 Enter 触发的合成点击）触发，
            //       中键在这里走的是 `auxclick`，不会误触。
            if (ctx.onOpenNote) {
                cov.addClass('is-clickable');
                cov.setAttribute('role', 'link');
                cov.tabIndex = 0;
                cov.addEventListener('click', () => ctx.onOpenNote?.(ctx.entry.id));
                // 键盘可达：与标题行同一条口径（div 当链接用就必须自己接 Enter）
                cov.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    ctx.onOpenNote?.(ctx.entry.id);
                });
                // 提示语按「有没有右键菜单」二选一，⛔ 别同时写两条（会叠气泡，见上面那条注释）
                const tip = ctx.entryMenu ? '左键：打开笔记 ｜ 右键：条目菜单' : '左键：打开笔记';
                setTip(cov, tip);
                srLabel(cov, tip);
            }
        }
        const txt = card.createDiv({ cls: 'rl-epp-info-txt' });
        // 🔴 用户 2026-11-10 逐字：「把个人评分和大众评分不要显示了，顺序为标题、年份-作者、题材、简介」。
        //    ⇒ 简介里原有的两处评分**整块删除**：`rl-epp-info-score`（`rating` 的裸数字，
        //      没标签，读起来像大众评分）和 `rl-epp-info-rating`（带「个人评分」标签的星星行）。
        //    ⚠️ `rating` 就是个人评分（半星制 0~5），大众评分是 `communityScore`，两个字段别混。
        //    ⛔ 别再往简介里塞评分行：评分在卡片 / 表格 / 笔记导出三处都有，这一栏是简介。
        //
        // 🔴 m02759（2026-11-17）= 本方法当前的最终形态，推翻上面那段的**顺序**部分：
        //    第一行 = 「大标题 + 右侧横排来源评分」，第二行 = 「年份-作者」，
        //    第三行 = 标签胶囊，最后是简介正文。
        //    ⇒ 旧顺序里的「题材」（`genres` 胶囊）在 ⑶ 被整排删除（用户裁定「只留标签」）；
        //      「大标题」在 ⑷ 被显式要求加回来（原来 `showName` 默认被两处调用点传 false 关掉）。
        const topRow = txt.createDiv({ cls: 'rl-epp-info-top' });
        topRow.createSpan({ cls: 'rl-epp-info-name', text: ctx.entry.title });
        // 元信息行 = 「年份-作者」（用户定的顺序：标题 / 年份-作者 / 标签 / 简介）。
        //    ⚠️ 作者走 `pure/cardMeta.cardCreator` 的**既有槽位**：导演 → 作者 → 开发商，
        //      与卡片 / 海报墙同口径，⛔ 别在这里自己拼一串 `?? ??`（六类类型会跟别处漂）。
        //    ⚠️ 缺哪项跳过哪项；两项都缺就整行不画（空容器带 margin 会留一条看不见的缝）。
        const metas: string[] = [];
        if (typeof ctx.entry.year === 'number' && ctx.entry.year > 0) metas.push(`${ctx.entry.year}`);
        if (hasCardCreator(ctx.entry)) metas.push(cardCreator(ctx.entry));
        if (metas.length > 0) txt.createDiv({ cls: 'rl-epp-info-meta', text: metas.join(' · ') });
        // ── 🔴 m07813③（2026-11-15 用户逐字：「给播放器详情页的简介栏优化一下如加评分来源、标签、简介可通过省略号展开完整」）
        //    ⇒ 简介卡新增三样：① 来源 + 大众评分 + 评价人数（可点开原页面）
        //      ② 标签胶囊（用户裁定「只展示，不可点」）③ 简介超过 4 行时给「展开全文 / 收起」。
        //
        // 🔴🔴 本节**推翻**了 2026-11-10 的一条老口径（原注释在下面 `showName` 那段里：
        //    「⛔ 别再往简介里塞评分行：评分在卡片 / 表格 / 笔记导出三处都有，这一栏是简介」）。
        //    ⚠️ 两者并不矛盾：那条禁的是**个人评分**（`rating`，半星制、无标签，读起来像大众评分）
        //    和**裸大众分**（`rl-epp-info-score` 只有数字没出处）；本轮加的是
        //    **带出处的来源行**（来源名 + 分 + 人数 + ↗），信息量完全不同。
        //    ⛔ 别因为这段又把 `rl-epp-info-score` / `rl-epp-info-rating` 那两块加回来。
        //
        // 🔴 m02759 ⑵（用户逐字「把来源评分放到简介栏右上角横排」）：
        //    ⇒ 来源行从「正文里独占一行」改成**塞进第一行右侧**（`.rl-epp-info-top` 里，
        //      CSS 用 `margin-left: auto` 顶到最右）。⛔ 别再用 `txt.appendChild(srcline)` 另起一行 ——
        //      那样右上角就是空的，用户要的横排语义也没了。
        //    ⚠️ `buildSourceLine` 仍返回 `HTMLElement | null`：没有来源名时整行不画（⛔ 不留空盒子，
        //      否则 `margin-left:auto` 的空元素会把标题挤到左边）。
        const srcline = this.buildSourceLine(ctx);
        if (srcline) topRow.appendChild(srcline);
        // 标签胶囊：接在「年份-作者」之后（同一行放不下自然折行），
        //   加 `.is-tag` 区分底色 —— 标签是用户自己的分类法。
        //
        // 🔴 m02759 ⑶（用户裁定「只留标签那一排，第一排整排去掉（含「类型」胶囊）」）：
        //    ⇒ 原先「类型 + 题材」那一排（`ENTRY_TYPE_LABELS` / `BOOK_KIND_LABELS` 拼出来的
        //      `rl-epp-info-chips`）**整块删除**。⛔ 别因为「看不出这是什么类型」又加回来 ——
        //      类型已经在页头副标题与标签里能读出来，用户点名这是重复信息。
        //    ⚠️ 连带清掉 `ENTRY_TYPE_LABELS` / `BOOK_KIND_LABELS` / `normalizeBookKind` 三个 import
        //      （删完就没人用了，`noUnusedLocals` 会报）。
        this.appendTagChips(txt, ctx.entry);
        if (ctx.overview) this.buildDesc(txt, ctx.overview);
    }

    /**
     * 来源 + 大众评分 + 评价人数 + 「↗」外链（m07813③）。
     *
     * 🔴 口径（用户 2026-11-15 裁定「豆瓣 8.3 · 232425 人评价 ↗」）：
     *    - **有来源名才画这一行**：没有 `sourceName` 时连分数都不显示 —— 一个没有出处的
     *      「8.3」正是老注释里骂的那种「读起来像大众评分」的孤儿数字。
     *    - 三件都是**可选**：只填了来源名就只显示来源名；只填了分（不可能，编辑窗里分数依赖来源）同理。
     *    - ⚠️ 字段口径与卡片完全一致：`sourceName` / `communityScore` / `ratingCount` / `sourceUrl`
     *      （⛔ 别用 `rating` —— 那是个人评分，半星制 0~5）。
     *
     * @returns 没有来源名时返回 `null`（调用方据此整行不画，⛔ 不留空盒子）。
     */
    private buildSourceLine(ctx: EpisodePageExtras): HTMLElement | null {
        const name = (ctx.entry.sourceName ?? '').trim();
        if (!name) return null;
        const row = createDiv({ cls: 'rl-epp-info-src' });
        const label = createSpan({ cls: 'rl-epp-info-src-name', text: name });
        row.appendChild(label);
        const score = ctx.entry.communityScore;
        if (typeof score === 'number' && Number.isFinite(score) && score > 0) {
            // 分制：豆瓣 0~10、Steam 是好评率百分比。统一按「原样数字」显示（⛔ 不在这里换算成五星，
            //   换算会让「8.3 / 10」和「★ 4.2」混在一屏，用户对不上卡片里的数）。
            const num = Number.isInteger(score) ? String(score) : score.toFixed(1);
            row.appendChild(createSpan({ cls: 'rl-epp-info-src-score', text: num }));
            const cnt = ctx.entry.ratingCount;
            if (typeof cnt === 'number' && Number.isFinite(cnt) && cnt > 0) {
                row.appendChild(
                    createSpan({
                        cls: 'rl-epp-info-src-count',
                        text: `${cnt} 人评价`,
                    }),
                );
            }
        }
        // 有原页面才出箭头：没有 `sourceUrl` 时画一个点了没反应的 ↗ = 假功能
        const url = (ctx.entry.sourceUrl ?? '').trim();
        if (/^https?:\/\//i.test(url)) {
            row.addClass('is-link');
            row.setAttribute('role', 'link');
            row.tabIndex = 0;
            // 🔴 读屏名走 `srLabel`（插 `.rl-sr` 隐藏文本），⛔ **不是** `setAttribute('aria-label')`：
            //    `setTip` 会主动抹掉 `aria-label`（见 `src/ui/components.ts` 的 setTip 注释），
            //    两者同时挂就是「同一元素双份提示」—— `tests/tooltipSingleSource.test.ts` 会当场抓。
            //    同一元素上的 `setAttribute` 双挂是本仓明令禁止的（那是气泡叠两层的根源）。
            srLabel(row, `${name} 原页面（新窗口打开）`);
            const open = (): void => void window.open(url, '_blank');
            row.addEventListener('click', open);
            row.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                open();
            });
            setTip(row, '打开原页面');
            row.appendChild(createSpan({ cls: 'rl-epp-info-src-go', text: '↗' }));
        }
        return row;
    }

    /**
     * 标签胶囊（m07813③，用户裁定「只展示，不可点」）。
     *
     * ⚠️ 与题材那组分开画：题材走 `rl-epp-info-chip`（首枚是类型、高亮），
     *   标签走 `rl-epp-info-chip.is-tag`（弱一档，因为标签是用户自建分类，不该压过题材）。
     * ⛔ 别把标签合进 `chips` 数组：那会破坏「第一个 chip 恒为类型」的既有高亮规则
     *   （`styles.css` 的 `.rl-epp-info-chip:first-child`）。
     */
    private appendTagChips(txt: HTMLElement, entry: MediaEntry): void {
        const tags = (entry.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
        if (tags.length === 0) return;
        // 去重（同一标签重复出现会让胶囊行变长且看起来像 bug），保持录入顺序
        const seen = new Set<string>();
        const uniq = tags.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
        const box = txt.createDiv({ cls: 'rl-epp-info-tags' });
        for (const t of uniq) box.createSpan({ cls: 'rl-epp-info-chip is-tag', text: t });
    }

    /**
     * 简介正文 + 「展开全文 / 收起」（m07813③）。
     *
     * 🔴 为什么需要 JS 管展开态：`-webkit-line-clamp` 是**纯视觉**裁切，
     *   给 `-webkit-line-clamp: unset` 就能展开，但**是否该出现「展开」按钮**只有量过才知道
     *   —— 3 行的简介不该挂一颗点了没变化的按钮（那是假功能，与本仓一贯口径冲突）。
     *   ⇒ 建好后量一次 `scrollHeight > clientHeight`，超出才补按钮。
     * ⚠️ 量之前元素必须在文档里：`buildInfoCard` 是往**已挂载**的 `parent` 里建，
     *   到这里 `txt` 已经在树上，所以同步量是准的（真机实测过）。
     * ⚠️ 重画（`refreshFromEntry`）会重建整块，展开态**不保留** —— 用户改完属性回来看到的是
     *   收起态，这是有意为之：新内容可能完全不同，沿用旧的展开状态反而莫名其妙。
     */
    private buildDesc(txt: HTMLElement, overview: string): void {
        const desc = txt.createDiv({ cls: 'rl-epp-info-desc', text: overview });
        // 下一帧再量：字体/换行要等样式算完（`clientHeight` 在刚建时可能还是 0）
        const raf =
            typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : (fn: () => void) => setTimeout(fn, 0);
        raf(() => {
            if (!desc.isConnected) return;
            // 2px 容差：亚像素行高会算出 1px 级差值，硬比会误判「可展开」
            if (desc.scrollHeight <= desc.clientHeight + 2) return;
            desc.addClass('is-clamped');
            const btn = createEl('button', { cls: 'rl-epp-info-desc-toggle', text: '展开全文' });
            btn.setAttribute('aria-expanded', 'false');
            const toggle = (): void => {
                const open = !desc.hasClass('is-open');
                desc.toggleClass('is-open', open);
                btn.setText(open ? '收起' : '展开全文');
                btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            };
            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                toggle();
            });
            // 紧随其后插入（`insertAdjacentElement` 而不是 `appendChild`：
            //   简介后面还可能接别的东西，按钮必须贴着简介本身）
            desc.insertAdjacentElement('afterend', btn);
        });
    }

    // ── 下排：各季横带（滚轮横滑） ────────────────────────────────────────────────

    /**
     * 系列列表：本系列其他季的卡片条（现在挂在信息栏的「系列」折叠节里）。
     *
     * 🔴 用户 2026-10-28 裁定：「系列并入信息栏，作为信息栏里的一个折叠节（和字幕/选集同级）」。
     *    ⛔ 页尾不再有横带 —— 窄屏时那条横带会吊在整页最底部，跟播放器抢第一视觉。
     * ⚠️ 只有 1 季时整节藏掉（`is-empty`）：一个只含当前季的列表纯属噪音。
     * ⚠️ 滚轮事件要 `preventDefault` 才能横滚，否则页面会跟着上下滚（见 `onWheel`）。
     */
    private buildSeasons(): void {
        const box = this.seasonsEl;
        const ctx = this.pageCtx;
        if (!box || !ctx) return;
        box.empty();

        const rel = relatedSeasons(ctx.entry, ctx.allEntries);
        const others = rel.filter((e) => e.id !== ctx.entry.id);
        // 一句都没有就整节藏掉（`hidden` 而不是不建 —— 换季重画时容器还在，省得重建骨架）
        box.toggleClass('is-empty', others.length === 0);
        // 🔴 用户 2026-11-08：「『全部15部』移动到系列标题旁边」。
        //    ⇒ 文案/点击挂到**标题行**那个槽上（`seasonsMoreEl`，由 `buildLow()` 预留），
        //      ⛔ 不再往横带体内建 div —— 那样它会被横向滚动带走。
        //    ⚠️ 每次重画都先 `empty()` 再写：换片后系列条数会变（3 部 → 15 部），
        //      不清空就是「全部 15 部」叠在「全部 3 部」上。
        const more = this.seasonsMoreEl;
        if (more) {
            more.empty();
            // 全节要藏时连标题行的入口一起藏（否则标题行没了、右边还漂着一个「全部 1 部」）
            more.toggleClass('is-empty', others.length === 0);
        }
        if (others.length === 0) {
            // 节壳自己也得藏：body 空了但标题行还在，会留一个点开没内容的空壳
            box.closest('.rl-epp-sec')?.addClass('is-empty');
            return;
        }
        box.closest('.rl-epp-sec')?.removeClass('is-empty');

        // 「全部 N 部」：大系列横带翻不完，这里是唯一能看到全部 + 排序号的入口。
        // ⚠️ 挂在标题行（节级操作）而不是横带里：横带一滚它就滚出视野了。
        if (more) {
            more.setText(`全部 ${others.length + 1} 部`);
        }

        this.seasonsListEl = box.createDiv({ cls: 'rl-epp-seasonslist' });
        for (const e of others) {
            const card = this.seasonsListEl.createDiv({ cls: 'rl-epp-season' });
            const cov = card.createDiv({ cls: 'rl-epp-seasoncov' });
            // 逐季封面：取**这一季自己的**图；没有图才画占位块（⛔ 不猜路径、不拿当前季顶替）
            const src = ctx.seasonCover(e);
            if (src) {
                const img = cov.createEl('img', { cls: 'rl-epp-seasonimg' });
                img.src = src;
                img.alt = e.title;
                // 加载失败就退回占位块（图挂了不该留一个破图图标）
                img.addEventListener('error', () => {
                    img.remove();
                    if (!cov.querySelector('.rl-epp-seasoncovph')) cov.createDiv({ cls: 'rl-epp-seasoncovph' });
                });
            } else {
                cov.createDiv({ cls: 'rl-epp-seasoncovph' });
            }
            const txt = card.createDiv({ cls: 'rl-epp-seasontxt' });
            txt.createDiv({ cls: 'rl-epp-seasonname', text: e.title });
            const ord = seasonOrdinalLabel(e);
            if (ord) txt.createDiv({ cls: 'rl-epp-seasonord', text: ord });
            // 当前季高亮（用户一眼能看出「我在第几部」）
            if (e.id === ctx.entry.id) card.addClass('is-cur');
            card.addEventListener('click', () => ctx.onOpenSeason(e));
        }

        // 🔴 用户 m00002（版式重构）：「系列**始终**横向排列，鼠标滚轮左右滑动」
        //    ⇒ 横排从「窄屏专属」升级为**任何宽度都是横排**（CSS 基础规则里 `flex-direction:row`，
        //      窄屏块里那套重复的横排声明已删，只剩一处真源）。
        //    这里把**纵向滚轮**翻译成横向平移 —— 鼠标只有竖直滚轮，不接管用户就会滚掉整个页面。
        //    🔴 与分段条 `bindRangesWheel()` **同一套口径**（别在这里另发明一套）：
        //      · 装得下（`scrollWidth <= clientWidth`）⇒ 完全不接管，把滚轮还给整页；
        //      · 到边界还往回滚 ⇒ 不 `preventDefault`，让事件冒泡给外层；
        //      · `deltaMode` 三档都要认，否则行模式下滚一格只挪 3px = 「滑不动」。
        //    ⚠️ 「可滑快点」= 增益 2.2 倍（分段条是 1.0）：
        //       系列卡横向一屏能放好几张，用户明确说要快，2.2 倍一格约摸两张卡。
        this.seasonsListEl.addEventListener(
            'wheel',
            (ev: WheelEvent) => {
                const el = ev.currentTarget as HTMLElement;
                const max = el.scrollWidth - el.clientWidth;
                if (max <= 1) return; // 装得下 ⇒ 不接管
                const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? el.clientWidth : 1;
                const raw = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
                if (!raw) return;
                // 最小步长：高精度触控板给 1~2px 的 delta，乘系数后还是挪不动 ⇒ 给个 40px 下限
                const dx = Math.sign(raw) * Math.max(40, Math.abs(raw) * 2.2);
                const atStart = el.scrollLeft <= 0;
                const atEnd = el.scrollLeft >= max - 1;
                // 到边还往回滚 ⇒ 放行给外层页面（同 `bindRangesWheel`）
                if ((dx < 0 && atStart) || (dx > 0 && atEnd)) return;
                ev.preventDefault();
                el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + dx));
            },
            { passive: false },
        );
    }

    // ── 右栏：信息 + 字幕节 + 选集节 + 系列节 ────────────────────────────────────

    /**
     * 信息栏（上排右侧）：片名 / 评分 / 元信息 / 简介 + 字幕节 + 选集节 + 系列节。
     *
     * 🔴 用户 2026-10-27 三框裁定：原先「信息卡在播放器下方、选集在右栏」全部收进这一栏，
     *    字幕与选集各做成**可折叠小节**（默认展开选集、收起字幕 —— 第一次进来最想看的是集子）。
     * 🔴 用户 2026-10-28 追加：「还要窄屏底部的系列悬空怎么办，播放器要第一视觉传达」
     *    ⇒ 系列从页尾横带收进本栏，做第三个折叠节（默认折叠）。
     * ⚠️ 折叠态记在 `data-open`，不写进 class：CSS 只认属性，重画时不必重算类名组合。
     */
    private buildSide(): void {
        const side = this.sideEl;
        if (!side) return;
        side.empty();

        // 🔴🔴 版式（用户 m00002）：「字幕、选集面板**始终保持**排列在右侧栏（总高度严格等于播放器高度）」
        //    ⇒ 右栏**只**装这两节：简介已搬到下排左列（`buildLow`），系列也搬过去了。
        //    ⛔ 别再把信息卡/系列塞回来：塞一节，右栏内容高就会撑过播放器高，
        //       「总高严格等于播放器高」立刻破功（.rl-epp-side 是 absolute inset:0 + overflow-y:auto，
        //       多塞内容不改变外框高度，但会逼出滚动条 —— 用户要的是「刚好装下、不滚」）。
        // 🔴 两面板**都默认展开**（用户原话「两个面板都默认展开但可手动收起」）——
        //    且**不记忆**：不读写任何 storedState，每次进页面都是展开态。
        //    ⛔ 别加「上次收起了这节，这次也收起」的持久化：用户明确说「不跟随用户记忆」。
        // 🔴 用户 2026-10-29：「窄屏下字幕和选集左右各占一半」。
        //    ⇒ 两节外面套一个 `.rl-epp-pair`：宽屏时它是 `display: contents`（不产生盒子），
        //    窄屏（`@container ≤960px`）时变成两列 `grid` ⇒ 字幕左、选集右，各一半。
        const pair = side.createDiv({ cls: 'rl-epp-pair' });

        // 🔴 2026-11-06 用户裁定：「单个电影类型播放器隐藏选集、系列下拉，多个电影系列保留系列下拉隐藏选集」。
        //    ⇒ 电影（`entry.type === 'movie'`）一页只有那一个片子，选集节里就 1 个格子，纯属噪音。
        //    ⚠️ 判据用 `entry.type` 而不是 `isSingle()`：`isSingle()` 是「单文件播放器态」的陈旧语义
        //       （本地单文件播放也会置 true），拿它当「是不是电影」会误伤剧集。
        //    ⚠️ 不建节 ≠ 不建容器：`modesEl` / `rangesEl` / `cellsBodyEl` 全部保持 `null`，
        //       下游 `syncModes()` / `syncCells()` 都先判空再动，删节不会空指针（已核）。
        //    系列节能显示与否仍由 `buildSeasons()` 的 `is-empty` 决定：
        //       无同系列作品 ⇒ 自动藏；多部电影成系列 ⇒ 正常显示（用户要的正是这一条）。
        const isMovie = this.pageCtx?.entry.type === 'movie';

        // 🔴 用户 m01782：单集评价**已搬出右栏**，改成播放器下方的悬浮快捷条
        //    （容器在 `playerHost()` 里建：`.rl-epp-rvbar`，紧跟舞台）。
        //    这里只负责决定「这一页要不要有它」——判据与选集节同源（电影没有单集可评）。
        this.mountReviewBar(isMovie);

        // 🔴 默认开合态：先按「此刻已知有没有字幕」给个初值，避免闪一下再收。
        //    真正的答案要等异步解析（`autoLoadSubtitle` → `afterSubtitles`）回来才准，
        //    那时由 `syncSubsOpen()` 回填。判据与 `syncSubsOpen()` **同源**，
        //    ⛔ 别在这里另写一套判断（两处口径不一就会出现「有词却折叠」）。
        //    ⚠️ 造节这一刻网络字幕还没抓回来（并行请求），所以这里必然是折叠；
        //       抓回来后会走 `loadNetSubtitle()` → `syncCueSource()` → `syncSubsOpen()` 展开。
        const subsHasNow = !!(this.cueImported || this.subtitleFileName());
        const subsSec = this.buildSection(pair, CUE_PANEL_TITLE, subsHasNow);
        this.subsSecEl = subsSec.sec;
        this.subsOpenSynced = subsHasNow;
        this.subsBoxEl = subsSec.body;
        this.buildCuePanel(subsSec.body);
        // 折叠标题行兼作「入口」：展开时把当前行滚到提词器位置（折叠时量不到高度，滚出来是错的）
        subsSec.head.addEventListener('click', () => {
            // 用户手动开合 ⇒ 本次自动态已被用户接管，⛔ 别在下一次 sync 时又按可用性抢回来
            this.subsOpenSynced = !!(this.cueImported || this.subtitleFileName());
            if (subsSec.head.parentElement?.getAttribute('data-open') === '1') this.locateCue();
        });

        // ③ 选集节（可折叠）
        const epsSec = isMovie ? null : this.buildSection(pair, this.isSingle() ? '文件' : '选集', true);
        if (epsSec) {
        // 🔴 用户 2026-10-29：「选集面板两个按钮改成列表/网格单循环切换按钮、然后再加个
        //    正序/倒序单循环切换按钮，这两个按钮都和如 1-50 51-100 101-10 并列」。
        //
        // ⇒ 旧结构是「模式按钮一行（`.rl-epp-modes`）+ 分段条另起一行（`.rl-epp-ranges`）」，
        //    在 340px 的右栏里白吃一整行高度，而且两个并排按钮各自带 `is-on` 选中态，
        //    语义是「选一个」而不是用户要的「点一下换一档」。
        // ⇒ 现在：**一条 `.rl-epp-eptools` 横排**装 [模式循环钮][集序循环钮][分段条]，
        //    分段条 `flex:1` 吃掉剩余宽度、必要时自己换行（页数多时不会把按钮挤出去）。
        const bar = epsSec.body.createDiv({ cls: 'rl-epp-eptools' });
        this.modesEl = bar;

        const modeBtn = bar.createEl('button', { cls: 'rl-epp-mode', attr: { 'data-mode': 'cycle' } });
        modeBtn.addEventListener('click', (ev) => {
            // 即便已不在标题行里，仍要 stopPropagation：`body` 冒泡上去会撞到 `head` 的折叠
            ev.stopPropagation();
            this.cellsMode = nextCellsMode(this.cellsMode);
            // 换画法后当页可能不再合法（封面格更宽、能装的集数一样，但保守起见钳一下）
            this.syncModes();
            this.syncCells();
        });

        const orderBtn = bar.createEl('button', { cls: 'rl-epp-mode', attr: { 'data-order': 'cycle' } });
        orderBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.cellsOrder = nextCellsOrder(this.cellsOrder);
            this.syncModes();
            this.syncCells();
        });

        // 分段条与两个按钮**同一行并列**（用户原话「这两个按钮都和如 1-50 … 并列」）
        this.rangesEl = bar.createDiv({ cls: 'rl-epp-ranges' });
        // 🔴 用户 2026-10-29：分段条是**单行横滚**（CSS `flex-wrap: nowrap` + `overflow-x: auto`），
        //    但鼠标只有竖直滚轮 ⇒ 不接管的话用户在档签上滚轮，滚的是外层页面，档签一动不动。
        //    监听器**只绑一次**（`rangesEl` 元素本身常驻，`syncCells` 只 `empty()` 子节点，不换这个 div）。
        this.bindRangesWheel(this.rangesEl);
        this.cellsBodyEl = epsSec.body.createDiv({ cls: 'rl-epp-cells' });
        this.syncModes();
        this.syncCells();
        }

        // ④ 系列节 —— 已搬到下排左列（见 `buildLow` 的 ② 与 `buildSeasons()`）。
        //    ⛔ 这里别再建第二个 `.rl-epp-seasons` 容器：`this.seasonsEl` 会被后建的覆盖，
        //       `buildSeasons()` 填的是「最后一次赋值的那个」，右栏里那个就永远空着（曾经的坑）。
    }

    /**
     * 分段条的「竖直滚轮 → 横向平移」。
     *
     * 🔴 用户 2026-10-29 的诉求是**单行横滚**，可鼠标滚轮天生是竖直的：不做这层映射，
     *    用户把指针悬在档签上滚，滚走的是外层 `.rl-epp` 页面，而档签停在原地不动 —— 观感就是「坏了」。
     * 🔴 只在**确实装不下**时才接管（`scrollWidth > clientWidth`）：装得下还吃掉滚轮事件，
     *    等于把「页面向下滚」这个更常用的体验抢走，用户会以为鼠标坏了。
     * ⚠️ `deltaMode` 三档都要认：Chromium 鼠标滚轮通常是 `0`（像素），个别设备/触控板给 `1`（行）或 `2`（页）；
     *    只按像素算的话，行模式下一次滚轮只挪 3px，等于没动。
     * ⚠️ 到边（左端向左滚 / 右端向右滚）**不 `preventDefault`** ⇒ 事件继续冒泡，页面照常滚。
     *    这是「局部吃滚轮」的通行做法：吃到边界就把控制权还给外层。
     */
    private bindRangesWheel(el: HTMLElement): void {
        el.addEventListener(
            'wheel',
            (ev: WheelEvent) => {
                const max = el.scrollWidth - el.clientWidth;
                if (max <= 1) return; // 装得下 ⇒ 不接管
                const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? el.clientWidth : 1;
                const dx = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) * unit;
                if (!dx) return;
                const atStart = el.scrollLeft <= 0;
                const atEnd = el.scrollLeft >= max - 1;
                // 到边还往回滚 ⇒ 放行给外层页面
                if ((dx < 0 && atStart) || (dx > 0 && atEnd)) return;
                ev.preventDefault();
                el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + dx));
            },
            { passive: false },
        );
    }

    /**
     * 两个单循环按钮的显示态（`cellsMode` / `cellsOrder` 是单一真源；重画列表时不必重建按钮）。
     *
     * 🔴 图标与 `data-tip` 显示的是「**下一档是什么**」：单循环按钮点完必须让用户看见变化，
     *    若显示当前态，图标在点击前后一模一样，会被当成「点了没反应」。
     */
    private syncModes(): void {
        const bar = this.modesEl;
        if (!bar) return;
        const modeBtn = bar.querySelector<HTMLElement>('[data-mode="cycle"]');
        if (modeBtn) {
            const next = nextCellsMode(this.cellsMode);
            modeBtn.empty();
            safeSetIcon(modeBtn, MODE_ICON[this.cellsMode]);
            // data-tip 写成「列表 → 封面」：既说清现在是什么，也说清点下去会变成什么
            modeBtn.setAttribute('data-tip', `${MODE_LABEL[this.cellsMode]} → ${MODE_LABEL[next]}`);
            srLabel(modeBtn, MODE_NEXT_LABEL[this.cellsMode]);
            modeBtn.setAttribute('data-state', this.cellsMode);
        }
        const ordBtn = bar.querySelector<HTMLElement>('[data-order="cycle"]');
        if (ordBtn) {
            const next = nextCellsOrder(this.cellsOrder);
            ordBtn.empty();
            safeSetIcon(ordBtn, ORDER_ICON[this.cellsOrder]);
            ordBtn.setAttribute('data-tip', `${ORDER_LABEL[this.cellsOrder]} → ${ORDER_LABEL[next]}`);
            srLabel(ordBtn, ORDER_NEXT_LABEL[this.cellsOrder]);
            ordBtn.setAttribute('data-state', this.cellsOrder);
        }
    }

    /**
     * 建一个可折叠小节，返回 `{head, body}`：`head` 里已经有标题和折叠箭头，调用方往 `head` 追加按钮、
     * 往 `body` 填内容。点击 `head` 切换 `data-open`（⛔ 不做高度动画，折叠瞬间要能看到内容）。
     *
     * @param collapsible 传 `false` ⇒ **不可折叠的常显节**（用户 2026-11-08：「简介、系列不再可收起
     *   默认展开」）。此时：
     *   · `data-open` 恒为 `'1'`，**不挂点击监听**（挂了就是一个点下去没反应的假按钮）；
     *   · 不建折叠箭头 `.rl-epp-secarrow`（箭头是「可以折叠」的唯一视觉承诺，留着一个转不动的箭头
     *     比没有箭头更糟）；
     *   · 外层多挂 `is-static`，CSS 据此去掉标题行的 `cursor: pointer` 与 hover 底色
     *     （见 `styles.css` 的 `.rl-epp-sec.is-static`）。
     *
     * ⚠️ 默认 `true`：右栏「字幕 / 选集」两节**仍然要可折叠**（用户没动它们），
     *    ⛔ 别把默认值改成 `false` —— 那会把右栏也一起锁死。
     */
    private buildSection(
        parent: HTMLElement,
        title: string,
        open: boolean,
        collapsible = true,
    ): { sec: HTMLElement; head: HTMLElement; body: HTMLElement } {
        const sec = parent.createDiv({ cls: 'rl-epp-sec' });
        // 不可折叠的节恒为展开：`data-open='0'` 会让 CSS 把 body 整块 display:none，
        // 而它又没有任何办法再被打开 ⇒ 那等于内容永久消失。
        const isOpen = collapsible ? open : true;
        sec.setAttribute('data-open', isOpen ? '1' : '0');
        if (!collapsible) sec.addClass('is-static');
        const head = sec.createDiv({ cls: 'rl-epp-sechead' });
        head.createSpan({ cls: 'rl-epp-sectitle', text: title });
        const body = sec.createDiv({ cls: 'rl-epp-secbody' });
        // 🔴 不可折叠 ⇒ 连箭头都不建、监听也不挂。⛔ 别「挂着但 no-op」：
        //    那会让点标题行仍然有 hover 反馈，用户会一直点它。
        if (collapsible) {
            const arrow = head.createSpan({ cls: 'rl-epp-secarrow' });
            safeSetIcon(arrow, 'chevron-down');
            head.addEventListener('click', () => {
                const next = sec.getAttribute('data-open') === '1' ? '0' : '1';
                sec.setAttribute('data-open', next);
                // 展开选集节后把当前集重新滚进视野（折叠时量不到高度，滚出来是错的）
                if (next === '1' && body === this.cellsBodyEl?.parentElement) this.scrollCurIntoView();
            });
        }
        return { sec, head, body };
    }

    // ── ③ 单集评价面板（用户 m00002）────────────────────────────────────────────

    /**
     * 画/重画单集评价面板：**当前那一集**的状态、标签、心情、一句话短评。
     *
     * 🔴 用户原话：「在字幕面板上方加单集评价面板：未看/在看/已看（默认未看）+
     *    『高光/平庸/槽点』标签（有高光/槽点标签的选集在选集网格上用流光/崩坏特效区分）+
     *    六档可选心情 + 一句话短评」。
     *
     * 🔴 为什么盯着「当前集」而不是给每集开一张表：面板高度只有右栏那么点，一页 50 集全铺开
     *    会把字幕面板挤没（右栏是 absolute inset:0 + 两节严格等高）。「一集一评」天然对应
     *    「正在看这一集」，换集时随 `syncCells()` 一起刷新。
     *
     * ⚠️ 心情只在「已看」时露出来 —— 与编辑表单那条守卫（`EntryForm.svelte` 的
     *    `{#if status === 'watched'}`）**同一口径**：心情是看完之后的感受，
     *    没看/看一半就让用户选「震撼」只是在逼他瞎填。⛔ 但**不清已存的心情**：
     *    状态从「已看」改回「在看」时，用户再改回「已看」得能看见原来选的那一档。
     *
     * ⚠️ 写回走 `pageCtx.onSaveReview`（宿主落 catalog + 回写整部 md 的 yaml），
     *    本地 `reviewMap` 同步更新一次是为了**立刻**看到效果，⛔ 不把它当第二份真源：
     *    下次 `buildSide()` 仍以 `pageCtx.reviews` 覆盖回来。
     */
    /**
     * 评价面板该写哪一集的键（③ 的定位真源）。
     *
     * 🔴 用户 m01474 报障的根因就在这：`activeCellIndex()` 是
     *    `netIndex ?? currentEpisodeIndex()`，而**纯网络条目**（一条 `episodeFiles` 都没有）
     *    的 `items` 是空的 ⇒ `items[cur]?.index ?? -1` 恒为 -1；
     *    退出内嵌后 `netIndex` 又被清成 null（`exitNetEmbed` / `afterRender`）
     *    ⇒ 面板拿到 -1，标题拼成「第 0 集」，`commitReview` 一句 `idx < 0` 静默 return
     *    ⇒ 整块面板「看得见、点不动」。用户原话：「啥也不能点击修改了」。
     *
     * ⇒ 这里给两级回退，⛔ 不改 `activeCellIndex()` 本身：
     *    ⑴ 它仍是换集/翻页/高亮的唯一口径（选集格、时间戳标记都吃它，动它会连带改坏）；
     *    ⑵ 只在**评价**这条支路上退到 `pageCtx.currentIndex` —— 那是宿主按
     *       `progress.episode - 1` 算好的「用户看到第几集」，纯网络条目照样有值。
     *
     * ⚠️ 两级都拿不到（条目一集都没有）才返回 -1，此时面板画成禁用态 + 说明，
     *    ⛔ 不许再走「画出来但点击静默失效」那条老路。
     */
    private reviewIndex(): number {
        const active = this.activeCellIndex();
        if (Number.isFinite(active) && active >= 0) return Math.floor(active);
        const snap = this.pageCtx?.currentIndex;
        if (typeof snap === 'number' && Number.isFinite(snap) && snap >= 0) return Math.floor(snap);
        return -1;
    }

    /**
     * 把「单集评价」挂成播放器正下方的快捷条（用户 m01782）。
     *
     * 🔴 为什么不再用 `buildSection()` 那套折叠节：
     *    用户要的是「悬浮快捷条」—— 一进来就能看见、点得到，不是要先展开的收纳盒。
     *    所以这里自建标题 + 内容两块，**不加折叠监听**。
     *
     * ⚠️ 电影（`isMovie`）直接整条隐藏：单片没有「单集」可评，
     *    它整部的心情走编辑表单那条既有通道（`{#if status === 'watched'}` 守卫）。
     *    ⛔ 别为了「看起来一致」给电影画一条禁用条 —— 那是纯噪音。
     *
     * ⚠️ `reviewTitleEl` 指向自建的 `.rl-epp-rvbar-title`，不再是
     *    `.rl-epp-sectitle`（那条选择器属于右栏折叠节，已不适用）。
     */
    private mountReviewBar(isMovie: boolean): void {
        const bar = this.reviewBarEl;
        if (!bar) return;
        bar.empty();
        this.reviewBoxEl = null;
        this.reviewTitleEl = null;

        if (isMovie) {
            this.reviewVisible = false;
            bar.toggleClass('is-empty', true);
            return;
        }

        this.reviewVisible = true;
        bar.toggleClass('is-empty', false);
        const head = bar.createDiv({ cls: 'rl-epp-rvbar-head' });
        this.reviewTitleEl = head.createEl('div', {
            cls: 'rl-epp-rvbar-title',
            text: REVIEW_PANEL_TITLE,
        });
        this.reviewBoxEl = bar.createDiv({ cls: 'rl-epp-rvbar-body' });
        // 建完立刻画一次：条默认可见，空着会让用户以为没生效
        this.syncReviewPanel();
    }

    private syncReviewPanel(): void {
        const box = this.reviewBoxEl;
        const ctx = this.pageCtx;
        if (!box || !ctx || !this.reviewVisible) return;
        box.empty();

        const idx = this.reviewIndex();
        // 真定位不到当前集（极少数：条目一条集都没有）⇒ 面板画成**禁用态 + 说明**，
        // ⛔ 不允许「画得出来但点了没反应」—— 用户 m01474 报的正是那种哑巴失活。
        const locked = idx < 0;
        const cur: EpisodeReview = reviewAt(this.reviewMap, idx) ?? { status: 'unwatched' };
        const status: EpisodeWatchStatus = cur.status;

        // 🔴 用户 m01474 逐字：「单集面板不要出现什么第0集等已评数，只在整季表单才显示总评价数」
        //    ⇒ 标题**只留面板名**，不带集号、不带已评数（已评数迁到编辑表单那条 `个人评语` 上方）。
        if (this.reviewTitleEl) this.reviewTitleEl.setText(REVIEW_PANEL_TITLE);
        if (locked) {
            box.createDiv({
                cls: 'rl-epp-rv-warn',
                text: '还没定位到当前集 —— 先在下面的选集里点一集，再回来评价',
            });
        }

        // 🔴 用户 m01782：「标签状态选择胶囊 UI 重做」
        //    ⇒ 四组压进**一行**（`.rl-epp-rvbar-inner`，窄屏自动换行），
        //      每组 = 极短标签 + 胶囊群。⛔ 不再一组占一整行 —— 那是面板时代的版式，
        //      放到播放器正下方会把整个舞台挤矮。
        const line = box.createDiv({ cls: 'rl-epp-rvbar-inner' });

        // ① 观看状态：三档单选（点已选那档 = 不动，状态必须有一个值）
        const stGrp = line.createDiv({ cls: 'rl-epp-rv-group' });
        stGrp.createDiv({ cls: 'rl-epp-rv-lbl', text: '状态' });
        const stGroup = stGrp.createDiv({ cls: 'rl-epp-rv-chips' });
        stGroup.setAttribute('role', 'group');
        stGroup.setAttribute('aria-label', '这一集的观看状态');
        for (const s of EPISODE_WATCH_STATUSES) {
            const b = stGroup.createEl('button', {
                cls: s === status ? 'rl-epp-rv-chip is-on' : 'rl-epp-rv-chip',
                attr: {
                    type: 'button',
                    'aria-pressed': s === status ? 'true' : 'false',
                    'data-tip': locked ? '还没定位到当前集' : REVIEW_STATUS_TIPS[s],
                },
                text: EPISODE_WATCH_LABELS[s],
            });
            // 🔴 定位失败必须**真禁用**：灰下去 + `disabled`，⛔ 不许保留可点外观再静默吞点击
            if (locked) b.disabled = true;
            b.addEventListener('click', () => {
                if (s === status) return;
                this.commitReview(idx, { ...cur, status: s });
            });
        }

        // ② 标签：高光 / 平庸 / 槽点 —— 🔴 用户 m01782 逐字「标签不能三个都选中」
        //    ⇒ **互斥单选**：选中一个就把别的顶掉，再点同一个 = 取消（标签可以没有）。
        //    ⚠️ 旧版是多选（`next = on ? tags.filter(...) : [...tags, t]`），
        //      用户明确否掉了它。选集格特效仍按 `episodeCellEffect()` 取（`plain` 不带特效）。
        const tagGrp = line.createDiv({ cls: 'rl-epp-rv-group' });
        tagGrp.createDiv({ cls: 'rl-epp-rv-lbl', text: '标签' });
        const tagGroup = tagGrp.createDiv({ cls: 'rl-epp-rv-chips' });
        tagGroup.setAttribute('role', 'group');
        tagGroup.setAttribute('aria-label', '这一集的标签');
        const tags = cur.tags ?? [];
        for (const t of EPISODE_TAGS) {
            const on = tags.includes(t);
            const b = tagGroup.createEl('button', {
                cls: on ? `rl-epp-rv-chip is-on is-${t}` : `rl-epp-rv-chip is-${t}`,
                attr: {
                    type: 'button',
                    'aria-pressed': on ? 'true' : 'false',
                    'data-tip': locked ? '还没定位到当前集' : REVIEW_TAG_TIPS[t],
                },
                text: EPISODE_TAG_LABELS[t],
            });
            if (locked) b.disabled = true;
            b.addEventListener('click', () => {
                const draft: EpisodeReview = { ...cur };
                if (on) delete draft.tags;
                else draft.tags = [t];
                this.commitReview(idx, draft);
            });
        }

        // ③ 心情：仅「已看」时可选（与编辑表单同一口径，理由见方法注释）
        if (status === 'watched') {
            const moodGrp = line.createDiv({ cls: 'rl-epp-rv-group' });
            moodGrp.createDiv({ cls: 'rl-epp-rv-lbl', text: '心情' });
            const moodGroup = moodGrp.createDiv({ cls: 'rl-epp-rv-chips' });
            moodGroup.setAttribute('role', 'group');
            moodGroup.setAttribute('aria-label', '这一集的心情');
            for (const m of MOODS) {
                const on = cur.mood === m.id;
                const b = moodGroup.createEl('button', {
                    cls: on ? 'rl-epp-rv-chip is-on' : 'rl-epp-rv-chip',
                    attr: {
                        type: 'button',
                        'aria-pressed': on ? 'true' : 'false',
                        'data-tip': locked ? '还没定位到当前集' : moodTip(m.id),
                    },
                });
                b.createSpan({ cls: 'rl-epp-rv-emoji', text: m.emoji });
                b.createSpan({ cls: 'rl-epp-rv-txt', text: m.label });
                if (locked) b.disabled = true;
                b.addEventListener('click', () => {
                    // 点已选那档 = 取消（与表单 `toggleMood` 同款：心情可空，⛔ 不是必填）
                    const next: MoodId | undefined = on ? undefined : m.id;
                    const draft: EpisodeReview = { ...cur, mood: next };
                    if (!next) delete draft.mood;
                    this.commitReview(idx, draft);
                });
            }
        }

        // ④ 一句话短评：失焦（change）才写盘 —— `input` 逐字写会把 catalog 打成筛子
        //    快捷条里它是**同行的最后一格**（`flex:1 1 12em`），⛔ 不再单独占一行。
        const noteGrp = line.createDiv({ cls: 'rl-epp-rv-group is-note' });
        noteGrp.createDiv({ cls: 'rl-epp-rv-lbl', text: '短评' });
        const ta = noteGrp.createEl('textarea', { cls: 'rl-epp-rv-note' });
        ta.rows = 1;
        ta.value = cur.note ?? '';
        ta.placeholder = locked ? '还没定位到当前集' : '一句话记下这一集（可留空）';
        ta.setAttribute('aria-label', '这一集的一句话短评');
        if (locked) ta.disabled = true;
        ta.addEventListener('change', () => {
            const text = ta.value.trim();
            const draft: EpisodeReview = { ...cur };
            if (text) draft.note = text;
            else delete draft.note;
            this.commitReview(idx, draft);
        });
    }

    /**
     * 提交一集评价：本地先更新（立刻看到效果），再交给宿主落库。
     *
     * ⚠️ 归一收口在 `pure/episodeReview`：空评价（未看 + 无标签 + 无心情 + 无短评）
     *    由 `setReviewAt` 整条删掉 —— ⛔ 别在这里判「空了就别写」，
     *    否则用户把状态改回「未看」时那一集永远清不干净。
     */
    private commitReview(idx: number, next: EpisodeReview): void {
        if (!Number.isFinite(idx) || idx < 0) return;
        const key = String(Math.floor(idx));
        const merged: Record<string, EpisodeReview> = { ...this.reviewMap };
        if (isEmptyEpisodeReview(next)) delete merged[key];
        else merged[key] = next;
        this.reviewMap = merged;
        this.pageCtx?.onSaveReview?.(key, next);
        // 标签变了 ⇒ 选集格子的流光/崩坏要跟着变；状态变了 ⇒ 面板自己也要重画
        this.syncReviewPanel();
        this.syncCells();
    }

    // ── 字幕时间轴面板（用户 m00002 六节规格）──────────────────────────────────

    /**
     * 面板骨架：顶部工具条 + 可独立滚动的 cue 列表。
     *
     * 🔴 与基类 `#606 字幕面板`（控制条上浮那个）的分工：
     *    那边管「挂哪一条字幕 / 显示开关」，这边管「这条字幕的每一行」；
     *    两边**都从 `subtitleFileName()` + `subtitleRawText()` 取同一份文本** ⇒ ⛔ 不另读文件、不另存挂载态。
     * 🔴 重画粒度：只清 `subsBoxEl`（右栏这一节），⛔ 不整屏重建 —— 整屏会把播放停掉。
     */
    private buildCuePanel(host: HTMLElement): void {
        host.empty();
        this.cueToolsEl = null;
        this.cueTagEl = null;
        this.cueModeEl = null;
        this.cueListEl = null;
        this.cueRows = [];
        // 🔴 `host.empty()` 把 AI 浮层也一起清了 ⇒ 指针必须跟着失效，否则
        //    `toggleCueAiPanel()` 会以为面板还开着、点了直接「收起」一个不存在的节点（点了没反应）。
        //    ⚠️ 只清指针，**不清 `cueAiResult`**：同一集重画工具条不该把已生成的总结作废。
        this.cueAiPanelEl = null;
        this.cueAiBtnEl = null;
        // `host.empty()` 把转写横幅也清了 ⇒ 三个指针一起失效。
        // ⚠️ 只清指针，**不清 `cueAsrLoading`**：正在跑的子进程还在跑，
        //    重画工具条不该把它的「忙碌」判断作废（那会让用户以为能再点一次）。
        this.cueAsrBarEl = null;
        this.cueAsrFillEl = null;
        this.cueAsrTextEl = null;
        this.cueAsrDetailEl = null;
        this.cueAsrBtnEl = null;
        // 转写实时流的三个指针同理失效（⛔ 不清 `cueAsrLines`：
        // 用户切去别的设置再回来，已经识别出的句子不该凭空消失）。
        this.cueTrBodyEl = null;
        this.cueTrHeadEl = null;
        this.cueTrTailEl = null;
        // `host.empty()` 把学习模式的横幅/气泡也清了 ⇒ 指针一起失效（⛔ 不清状态：
        // 用户开着单句循环时重画面板，档位不该被悄悄关掉）。
        this.cueLearnBtnEl = null;
        this.cueLoopBtnEl = null;
        this.cueShadowBtnEl = null;
        this.cueAbBarEl = null;
        this.cueShadowBarEl = null;
        this.cueWordTipEl = null;
        this.cueWordTipKey = '';
        // ⚠️ 跟读倒计时必须真停：它的 tick 会去动已被 `host.empty()` 摘掉的节点，
        //    而且到点还会 `play()` —— 那是「用户没在跟读却突然自己播起来」。
        this.stopCueShadowTimer();

        const snap = this.subtitleSnapshot();

        // 🔴 AI 浮层的定位宿主：`showCueAiPanel()` 要 `position:absolute; inset:0` 盖住
        //    「工具条 + 列表」这一整块（用户原话「在字幕面板上浮出AI面板」）。
        //    ⚠️ 只给**这一个实例**加类，⛔ 不去改 `.rl-epp-secbody` 全局 —— 下排
        //       「简介 / 系列」两节用的是同一个类，全局 relative 会连带影响它们的定位上下文。
        host.addClass('rl-epp-cuesbox');

        // ① 顶部局部工具条（紧凑，只放字幕列表特有的控制）
        // 🔴 用户 2026-10-30「下拉面板的三个按钮右对齐」⇒ 工具条最前面放一个 `flex:1` 的
        //    撑杆把按钮组顶到右边（⛔ 不用 `margin-left:auto`：语言下拉是可变宽 `select`，
        //    自动外边距会落在它身上，按钮就从下拉右边缘开始排而不是贴工具条右边）。
        const tools = host.createDiv({ cls: 'rl-epp-cuetools' });
        this.cueToolsEl = tools;
        tools.createDiv({ cls: 'rl-epp-cuespacer' });
        // 🔴 用户 2026-10-30：「锁定时间轴按钮改成单循环切换跟随和锁定按钮」——
        //    原来「锁定」「定位」是两颗按钮，现在收敛成**一颗**单循环钮（跟随 ⇄ 锁定）。
        //    ⚠️ 「手动滚动打断」不是第三档，见 `CueMode` 注释：点这颗钮在任何非跟随态都先回「跟随」。
        // 用户 2026-10-27「纯边框按钮太丑」⇒ 按钮统一图标，文案退到 `data-tip` + `aria-label`。
        const modeBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'mode' } });
        this.cueModeEl = modeBtn;
        modeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (!this.cueFollow) {
                // 被手动滚动打断 ⇒ 这一下先回「跟随」（等价于原「定位当前行」的恢复语义）
                this.cueFollow = true;
            } else {
                this.cueMode = CUE_MODE_NEXT[this.cueMode];
            }
            this.syncCueTools();
            this.locateCue();
        });

        // 🔴 用户 m01938 给的顺序：`[🎙️ 音频转文字] | [📖 学习模式] | [✨ AI 总结] | [⚙️ 更多]`
        //    ⇒ 学习模式 + 循环钮插在 ASR 与 ✨ 之间；四颗共用 `.rl-epp-cuetool` 一套尺寸
        //      （24×22 / 14px 图标），⛔ 不另造按钮形态 —— 否则同一排会出现两种大小。

        // ②-0a 学习模式（🔴 用户 §3：「点击字幕面板顶部 [📖 学习模式] 按钮进入」）
        const learnBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'learn' } });
        this.cueLearnBtnEl = learnBtn;
        // ⚠️ 重画面板后按钮是新的，状态必须立刻回填 —— 否则「明明开着学习模式，图标还是关的」。
        this.syncCueLearnBtn();
        learnBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.toggleCueLearn();
        });

        // ②-0b 循环档位单循环钮（关 → 单句 → AB → 关）
        //    ⚠️ 与 `modeBtn`（跟随/锁定）同一套「显示下一步」口径，但语义完全不同：
        //      这颗管**视频回跳**，那颗管**列表滚动**。⛔ 别把两件不同的事并成一颗钮。
        const loopBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'loop' } });
        this.cueLoopBtnEl = loopBtn;
        loopBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.cycleCueLoop();
        });
        this.syncCueLoopBtn();

        // ②-0b2 影子跟读开关（🔴 用户 §3.4：「学习模式顶部工具栏有一个 🎤 跟读 开关」）
        //    ⚠️ 只画在**学习模式**里（用户原话就是「学习模式顶部」）：普通模式下没有提词器，
        //      暂停-倒计时-续播这套在这时候没有意义，画出来是个只会让人困惑的按钮。
        //    ⚠️ 但它**不依赖** `cueLearnOn` 运行（`applyCueShadow` 只看 `cueShadowOn`），
        //      用户退出学习模式时跟读会一起关掉（见 `toggleCueLearn`），避免「看不见的自动播放」。
        const shadowBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'shadow' } });
        this.cueShadowBtnEl = shadowBtn;
        this.syncCueShadowBtn();
        shadowBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.toggleCueShadow();
        });

        // ②-0c 本地语音转文字（🔴 用户 m01938：「在原有的 [✨ AI 总结] 按钮左侧，新增
        //      两个图标按钮」⇒ 位置在 `aiBtn` **之前**）。
        //    ⚠️ 只有宿主注入了 `pageCtx.transcribe` 才画：没注入 = 这台上跑不了，
        //      ⛔ 不画一颗点了没反应的按钮（用户避坑指南：「绝不能阻断用户看视频」）。
        //    ⚠️ 与 ✨ 用同一套 `.rl-epp-cuetool` 尺寸，图标 `mic`（本仓录音/转写语义）。
        //    ⚠️ `mic` 在 asar 里的形态是**裸标识符** `,mic:[[6,"M12 19v3"]…`（不带引号），
        //      用 `"mic":\[\[` 去探会假阴性（本轮踩过）—— 探测必须同时认带引号与不带引号两种。
        if (this.pageCtx?.transcribe) {
            const asrBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'asr' } });
            this.cueAsrBtnEl = asrBtn;
            safeSetIcon(asrBtn, 'mic');
            asrBtn.setAttribute('data-tip', '把这一集的声音转成字幕');
            srLabel(asrBtn, '把这一集的声音转成字幕');
            asrBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                // 🔴 用户 m06361：「也没有停止转录的交互」⇒ 忙碌态这颗按钮变成「停止」。
                //    ⚠️ 先判 `cueAsrLoading`：转写中再点必须是**叫停**，⛔ 不是再起一次。
                if (this.cueAsrLoading) {
                    this.stopCueTranscribe();
                    return;
                }
                void this.startCueTranscribe();
            });
            this.syncCueAsrBtn();
        }

        // ② AI 总结（🔴 用户 2026-11-11 逐字：「给字幕加个AIAI面板总结按钮小图标放在时间轴
        //    定位按钮右旁点击在字幕面板上浮出AI面板」）——
        //    ⇒ 位置紧跟上面那三颗之后、语言下拉之前。
        //    ⚠️ 图标用 `sparkles`（本仓 AI 入口统一图标，见 EntryForm 的「AI 摘要 ✨」）。
        const aiBtn = tools.createEl('button', { cls: 'rl-epp-cuetool', attr: { 'data-cue': 'ai' } });
        this.cueAiBtnEl = aiBtn;
        safeSetIcon(aiBtn, 'sparkles');
        aiBtn.setAttribute('data-tip', 'AI 总结这一集字幕');
        srLabel(aiBtn, 'AI 总结这一集字幕');
        aiBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.toggleCueAiPanel();
        });
        // ⚠️ 重画时若正好在生成中，新按钮必须立刻接上忙碌态——否则它会显示成可点，
        //    用户点了会被 `cueAiLoading` 静默吞掉（最典型的「点了没反应」观感）。
        this.syncCueAiBtn();

        // ③ 多语言：候选 ≥ 2 条才出下拉（只有一条时摆个永远不动的下拉是噪音）
        const langs = cueLangOptions(
            snap.candidates.map((c) => ({ fileName: c.fileName, label: subtitleLangLabel(c.lang) || c.fileName })),
            snap.file,
        );
        if (langs.length > 1) {
            const sel = tools.createEl('select', { cls: 'rl-epp-cuelang' });
            sel.setAttribute('aria-label', '字幕语言');
            for (const l of langs) {
                const opt = sel.createEl('option', { text: l.label, attr: { value: l.fileName } });
                if (l.active) opt.setAttribute('selected', 'selected');
            }
            sel.addEventListener('click', (ev) => ev.stopPropagation());
            sel.addEventListener('change', () => {
                // 走基类既有挂载通路（提示 / `subFile` 写回 / 轨道点亮全在那边）
                this.cueImported = null;
                // 🔴 用户在下拉里主动选了同目录字幕 ⇒ 同样是「手动选择」，
                //    网络字幕晚到时不该把它顶掉（与 `importCueFile` 同一口径）。
                this.cueImportedManual = true;
                this.chooseSubtitle(sel.value);
            });
        }

        // ③ 手动导入 —— 🔴 用户 2026-10-29：「字幕面板移除右上角独立上传小图标，只保留
        //    Empty State 的『导入字幕』主按钮」。
        //    ⇒ 工具条这颗**不再渲染**。空态里那颗主按钮（`renderCueRows` 的 `data-cue="import-empty"`）
        //    是唯一入口，两者本来就共用 `importCueFile()`，删掉这颗不丢任何能力。
        //    ⚠️ 已挂字幕时不显示导入入口是**用户裁定**：换字幕走语言下拉，
        //    ⛔ 别在这里补一颗「换字幕」按钮把需求又改回去。

        // ④ 列表本体（独立滚动容器）
        // 🔴 用户 m12123：「还有这个滚动条给我去掉」+ 追问选定「整条 mini-map 全部去掉」
        //    ⇒ 原来这里挂着一条右侧 mini-map（绝对定位，随内容不滚），它的一根半透明强调色
        //    指示条在句子少时几乎占满全高，观感就是「一条粗蓝色滚动条」。
        //    ⛔ 别再往 `.rl-epp-cuebody` 里塞任何绝对定位的滚动指示控件。
        // ⚠️ `.rl-epp-cuebody` 这一层**仍然要留**：它负责把高度确定地传给列表
        //    （`.rl-epp-cuelist` 的 `flex: 1 1 0` 只有在 flex 纵容器里才拿得到高度，
        //    否则 `height:auto` + `container-type: size` 会直接落到 0px —— 2026-12-10 那个
        //    「字幕面板看不见」的坑就出在这一环）。
        const body = host.createDiv({ cls: 'rl-epp-cuebody' });
        // ⚠️ 转写横幅挂在列表**容器外**（host 直下、body 之前）：它不该跟着列表滚走。
        //    内部顺序无关紧要，靠 CSS `order`/DOM 前后决定 —— 这里选「工具条 → 横幅 → 列表」。
        this.buildCueAsrBar(host);
        this.cueListEl = body.createDiv({ cls: 'rl-epp-cuelist' });
        this.cueListEl.addEventListener('scroll', () => this.onCueScroll());
        // 真实用户输入打点：只有这些事件之后的 scroll 才可能是用户在滚（见 `onCueScroll` 双判据）
        const markUser = () => { this.cueUserInputAt = Date.now(); };
        for (const ev of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
            this.cueListEl.addEventListener(ev, markUser, { passive: true });
        }

        this.syncCueTools();
        this.renderCueRows();
        // 🔴 横幅必须在列表建好之后**再画一次**：`host.empty()` 把上一次的 AB/跟读条
        //    连同节点一起清掉了，而档位状态（`cueAb` / `cueShadowOn`）是保留的。
        //    不补这一笔，表现就是「设好 AB 区间后切一次字幕，横幅消失但循环还在跑」。
        this.renderCueAbBar();
        this.renderCueShadowBar();
        void this.syncCueSource();
    }

    /**
     * 工具条状态回填：单循环钮的图标 / 提示语 / 选中态，以及「跟随被打断」的提示态。
     *
     * 🔴 图标与提示语都写**下一步动作**（`CUE_MODE_LABEL`）：单循环钮只显示当前态的话，
     *    用户点完发现图标没变成「锁定」会以为没生效（与选集那两颗单循环钮同一口径）。
     * 🔴 `aria-pressed` 跟着「是否锁定」走，不跟「是否跟随」：锁定才是这个按钮的开关语义。
     */
    private syncCueTools(): void {
        const btn = this.cueModeEl;
        if (!btn) return;
        this.syncCueSourceTag();
        btn.empty();
        safeSetIcon(btn, CUE_MODE_ICON[this.cueMode]);
        const tip = CUE_MODE_LABEL[this.cueMode];
        setTip(btn, tip);
        srLabel(btn, tip);
        // 🔴 用户 2026-10-29：「跟随/锁定两态图标样式要一致（同高亮或同常规态）」。
        //    旧版给锁定态挂 `is-on`（强调色实底 + 白图标）、跟随态是灰色幽灵钮 ⇒
        //    同一颗按钮在两种状态下一亮一暗，看着像两颗不同按钮、且暗的那个像被禁用。
        //    ⇒ 统一走**常规态**：两态都只靠图标形状（`locate` / `lock`）与提示语区分。
        //    ⚠️ 这也与选集那两颗单循环钮同一口径（它们明确写过「不给 `is-on`」：
        //    单循环钮的语义是「点一下换一档」，常亮一颗会让用户以为只能在两档里挑一种）。
        btn.removeClass('is-on');
        // ⚠️ `aria-pressed` 保留：它是**无障碍语义**，不是视觉态 —— 读屏用户仍需知道当前是否锁定。
        btn.setAttribute('aria-pressed', this.cueMode === 'lock' ? 'true' : 'false');
        // 跟随被手动滚动打断 ⇒ 给个提示态：否则用户看不出「为什么列表不动了」
        btn.toggleClass('is-hint', !this.cueFollow);
    }

    /**
     * 渲染字幕来源标识（AI / B站 / 本地），单行左对齐在锁定时间轴按钮同一排。
     *
     * 🔴 用户 2026-11-09 逐字：「字幕面板在锁定时间轴按钮同行左对齐加上标识如：AI或本地」
     *
     * ⚠️ 为什么放工具条最左边（`rl-epp-cuespacer` 之前）：那颗撑杆把右侧按钮组顶到
     *    最右，左边是空的 —— 标识放这里正好「同行左对齐」，不会挤动右侧按钮组。
     * ⛔ 没有字幕时整个节点不建（空态里已经写明「没有字幕」，再挂个空标是噪音）。
     */
    private syncCueSourceTag(): void {
        const tools = this.cueToolsEl;
        if (!tools) return;
        const tag = this.cueSourceTagOf();
        let el = this.cueTagEl;
        if (!tag) {
            // 没字幕 ⇒ 拆掉标识（换集 / 退网络态都会走到这里）
            el?.remove();
            this.cueTagEl = null;
            return;
        }
        if (!el) {
            el = document.createElement('span');
            el.className = 'rl-epp-cuetag';
            // 插到撑杆**之前** ⇒ 落在工具条最左
            tools.insertBefore(el, tools.firstChild);
            this.cueTagEl = el;
        }
        el.setText(tag.text);
        el.setAttribute('data-src', tag.kind);
        // 🔴 2026-11-12（①-9）：原来 `title` + `aria-label` 两个都挂 ⇒ hover 出「原生黄条 + 宿主气泡」
        //    两层。统一走 `setTip`（只留 data-tip），读屏名走 `.rl-sr`。
        setTip(el, tag.title);
        srLabel(el, tag.title);
    }

    /**
     * 当前字幕来源（派生，不另存状态）。
     *
     * 判据顺序即优先级：手动导入 > 网络抓取（`cueSourceTag`）> 同目录文件。
     * ⚠️ `cueImportedManual` 与 `cueSourceTag` 必须一起看：手动导入同时写两者，
     *    只看 `cueSourceTag` 分不出「用户自己导的」和「B 站上传的」。
     */
    private cueSourceTagOf(): { text: string; kind: string; title: string } | null {
        if (this.cueImported) {
            if (this.cueImportedManual) return { text: '本地', kind: 'manual', title: '用户手动导入的字幕文件' };
            // 🔴 2026-11-08（用户 m04478「字幕面板来源标识怎么多出了个『AI』不是 B 站来源吗」）：
            //    标识只回答「这条字幕**从哪来**」，AI 与否是「怎么生成的」，两者不是一维。
            //    把 AI 提到版面上会让同一个来源显示成两种标识，用户读成「多了个不属于这里的标签」。
            //    ⇒ 版面一律「B站」，生成方式收进悬停提示（`data-tip` 与读屏名都还拿得到）。
            //    ⚠️ `kind` 仍留 `'ai'`：它是这份数据**唯一**的 AI/人工判别位，CSS 与后续统计都按它分色。
            if (this.cueSourceTag === 'ai') return { text: 'B站', kind: 'ai', title: 'B 站 AI 生成字幕' };
            return { text: 'B站', kind: 'net', title: 'B 站上传的字幕' };
        }
        if (this.subtitleFileName()) return { text: '本地', kind: 'local', title: '视频同目录的字幕文件' };
        return null;
    }

    /**
     * 面板显示态（空 / 解析中 / 就绪）；`panelStateOf` 是纯函数，⛔ 不在视图里散写三元。
     *
     * 🔴 用户 2026-10-28：「字幕面板参考主流的样式空状态加上」。
     *    旧空态只有一行灰字（`CUE_EMPTY_HINT`），用户看到「没有字幕」之后**无路可走** ——
     *    唯一入口是工具条上那个 24px 的小图标。
     *    ⇒ 按主流播放器（B 站 / YouTube）的空态做法补齐：图标 + 标题 + 说明 + **主按钮** + 兜底提示。
     *    ⚠️ 主按钮与工具条那颗**共用同一个处理函数**（`importCueFile`），⛔ 不复制粘贴一份逻辑。
     */
    private renderCueRows(): void {
        const list = this.cueListEl;
        if (!list) return;
        list.empty();
        this.cueRows = [];
        // 重画后下标必然与旧 DOM 不再对应 ⇒ 作废高亮下标，让下面的 `onCueTick` 重新点亮
        this.cueActiveIdx = -1;

        // 🔴 官方内嵌（回退成 iframe）的时间轴**过去被判定为「用不了」**：那时写的是
        //    「跨域 iframe 读不到 `currentTime`」（真机 `docAccessible:false`）。
        //    ⛔ 那是**猜的**，2026-11-10 真机证伪：`services/embedVideo` 进子帧读写 `currentTime` 都通。
        // ⚠️ 网络流进主播放器时（`netStreamOn`）**不能拦**：那时 `currentTime` 就在自己手里，
        //    时间轴/跳转/锁定全都能用 —— 拦了等于把刚做好的功能又藏起来。
        //
        // 🔴 2026-11-10 更正：这里原本**无条件**画 `buildCueNetUnavailable` 就 return，
        //    连已经取回来的字幕都不渲染 —— 用户看到的是「字幕面板拿不到字幕」。
        //    ⇒ 改成：**没有字幕**才画那个空态；**有字幕**就画成能点亮/跟随/跳转的列表。
        //    两条不许合并：空态说的是「这一集没有/拿不到字幕」，另一种是「有，但跟不上」。
        // 2026-11-24 网络集只剩官方 iframe ⇒ 「是不是网络集」就等于「是不是 iframe 态」。
        const cueStatic = this.isNetMode();
        // 🔴 `frozen` = 连桥都进不去的宿主（非桌面端 / `@electron/remote` 不可用 / 找不到子帧）。
        //    只有这种情况才退回「静态列表 + 说清楚为什么」；能进子帧就当正常时间轴用。
        const frozen = cueStatic && !embedVideoAvailable();

        // 🔴 用户 m11612「转录过程中字幕面板的空态要变成转录过程（每一句转写）」。
        //    这个态必须排在**所有别的态之前**：转写期间面板原来显示的是
        //    「还没有字幕 / 导入一份 .srt」—— 那是在说谎（字幕正在被写出来）。
        //    ⚠️ 也要排在 `cueStatic` 的网络空态之前：转写只对本地文件发起，
        //      真跑起来时它就是这一集当前最该看的信息。
        const state = panelStateOf(this.cueLoading, this.cueCues.length, this.cueAsrLoading);
        if (state === 'transcribing') {
            this.buildCueTranscribing(list);
            return;
        }
        if (cueStatic && !this.cueCues.length) {
            this.buildCueNetUnavailable(list);
            return;
        }

        if (state === 'loading') {
            this.buildCueSkeleton(list);
            return;
        }
        if (state === 'empty') {
            // 有字幕文件但解析不出行 ≠ 没有字幕文件：两种空态给的话术必须不同，
            // 否则「文件在那儿、只是格式不认」会被误报成「你还没放字幕」。
            const hasFile = !!(this.cueImported || this.subtitleFileName());
            this.buildCueEmpty(list, hasFile);
            return;
        }

        // 连子帧都进不去的宿主：先如实标一句，别让用户以为面板坏了
        if (frozen) {
            const note = list.createDiv({ cls: 'rl-epp-cuestatic' });
            const ico = note.createSpan({ cls: 'rl-epp-cuestatic-ico' });
            safeSetIcon(ico, 'captions');
            note.createSpan({
                cls: 'rl-epp-cuestatic-txt',
                // 🔴 用户 2026-11-10 问「不启用（插件播放器）就不能共用字幕吗，都是链接时间戳」——
                //    问得对：字幕本身（链接 + 时间戳）一直都在，缺的只是「现在播到第几秒」。
                //    那个数现在**拿得到**（`services/embedVideo` 进子帧读 `currentTime`）。
                //    这行话术只在**真的进不去**时才出现，所以必须给出口，别让能用的人被它吓退。
                // 🔴 2026-11-07 改：出口原来写「实验性功能 › 启用内置视频播放器 › 打开『网络集用插件播放器』」
                //    —— 那个开关已按用户裁定**整体删除**（见 `services/embedVideo.ts` 抬头、`pure/netInline.ts`），
                //    照做的用户只会扑空。`frozen` 的真实成因是**这台宿主进不去跨域子帧**
                //    （`embedVideoAvailable()`：非桌面端 / `@electron/remote` 不可用），
                //    唯一出路是换桌面版 Obsidian ⇒ 文案就照这个事实写，⛔ 别再指回任何插件开关。
                text: '这台宿主读不到官方播放器的播放进度（要桌面版 Obsidian 才读得到），字幕只能看、不能跟随/跳转。用桌面版打开这一集就能跟随、点时间戳跳转。',
            });
        }

        for (let i = 0; i < this.cueCues.length; i++) {
            const cue = this.cueCues[i];
            const row = list.createDiv({ cls: 'rl-epp-cuerow', attr: { 'data-cue': 'row' } });
            row.createSpan({ cls: 'rl-epp-cuetime', text: formatStamp(cue.start) });
            const textEl = row.createSpan({ cls: 'rl-epp-cuetext', text: cue.text });
            // 🔴 整行可点（用户规格：「不要只让时间戳可点」）
            // ⚠️ 内嵌态的跳转**不是**写不进 iframe（2026-11-10 实测写得进，见 `seekTo`）。
            //    只有 `frozen`（真进不去子帧）才不挂点击 —— 挂了就是一个「点了没反应」的死按钮，
            //    假功能比没有功能更糟。
            if (!frozen) {
                row.addEventListener('click', () => this.seekTo(cue.start));
                // 双击整行 ⇒ 单句循环开关（用户 §3.3「双击任意字幕行，该句左侧出现 🔁 图标」）
                row.addEventListener('dblclick', (ev) => {
                    ev.preventDefault();
                    this.toggleCueLoopAt(i);
                });
                // 右键整行 ⇒ 设 A / B 点（用户 §3.3「右键点击某句选择 [设为 A 点]」）
                row.addEventListener('contextmenu', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (this.cueAbDraftA >= 0) this.commitCueAbPoint(i);
                    else this.cueRightClickRow(i);
                });
                // 悬停查词（用户 §3.1「鼠标 Hover 到某个英文单词…浮出气泡」）
                // ⚠️ 挂在 `textEl` 而不是 `row`：只有正文里的词才是可查对象，
                //    时间戳那一格（`00:12`）不该被当成单词。
                textEl.addEventListener('mouseover', (ev) => {
                    if (!this.cueLearnOn) return;
                    const t = ev.target as HTMLElement | null;
                    if (!t || !t.classList.contains('rl-epp-cueword')) return;
                    this.showWordTip(t, t.textContent ?? '');
                });
                textEl.addEventListener('mouseout', (ev) => {
                    const t = ev.target as HTMLElement | null;
                    if (!t || !t.classList.contains('rl-epp-cueword')) return;
                    // 🔴 气泡挂在 `document.body` 上（见 `showWordTip` 的理由），鼠标移向发声按钮
                    //    也会先触发这一下 `mouseout`。若直接收，那个 🔊 永远点不到 —— 这是个
                    //    「看起来有按钮、实际按不下去」的假功能。判 `relatedTarget` 是否落在气泡里。
                    const to = ev.relatedTarget as Node | null;
                    if (to && this.cueWordTipEl && this.cueWordTipEl.contains(to)) return;
                    this.hideWordTip();
                });
            } else {
                row.addClass('is-static');
            }
            this.cueRows.push(row);
        }
        // 重画后立刻按当前进度点亮（暂停态下也得有一行是高亮的）
        // ⚠️ 桥没读到真播放头时 `onCueTick` 自己一行都不会点亮（`cueTimeNow()` 返回 null），
        //    ⛔ 别在这里再按「内嵌态」一刀切跳过 —— 那正是上一版把功能藏起来的地方。
        if (cueStatic && !frozen) this.startEmbedTicker();
        else this.stopEmbedTicker();
        if (!frozen) this.onCueTick();
        // ⛔ 原来这里还有一行 `this.buildCueMapTicks();`（mini-map 刻度）。
        //    用户 m12123 要求整条 mini-map 去掉后，刻度容器都不存在了 ⇒ 一并删除。
    }

    /**
     * 官方内嵌态的时间轴轮询。
     *
     * 🔴 `timeupdate` 只在**自己那颗** `<video>` 上冒泡，跨域 iframe 里那颗的事件拿不到 ⇒
     *    只能定时进子帧读一次播放头（`services/embedVideo`）。
     * ⚠️ 频率取 250ms：够跟上 `timeupdate` 的约 4Hz，又不至于把 IPC 打满。
     * ⛔ 只在「内嵌 + 有字幕 + 桥可用」时开；子帧没了自己就停，⛔ 别让它空转。
     */
    private startEmbedTicker(): void {
        if (this.embedTickTimer !== null) return;
        this.embedTickTimer = window.setInterval(() => {
            const src = this.netFrameEl?.getAttribute('src') ?? '';
            if (!src) {
                this.stopEmbedTicker();
                return;
            }
            void readEmbedVideo(src).then((st) => {
                if (!st) {
                    this.embedTimeOk = false;
                    return;
                }
                this.embedTime = st.time;
                this.embedTimeOk = true;
                this.onCueTick();
            });
        }, 250);
    }

    private stopEmbedTicker(): void {
        if (this.embedTickTimer !== null) {
            window.clearInterval(this.embedTickTimer);
            this.embedTickTimer = null;
        }
        this.embedTimeOk = false;
        this.embedTime = 0;
    }

    /**
     * 内嵌态的专属空态：这一集**没拿到字幕**，说清楚为什么。
     *
     * 🔴 2026-11-10 重写文案（用户「播放youtube网络集时字幕空状态怎么是这个样的」）：
     *    改前这里写死「B 站」+「跨域读不到播放进度，字幕时间轴用不了」+ 按钮「去 B 站看这一集」，
     *    在 YouTube 集上整段都是错的。而且「读不到播放进度」这句**是猜的、已被真机证伪** ——
     *    `services/embedVideo` 走 framesInSubtree + executeJavaScript 读写 `currentTime` 两边都通。
     *    ⇒ 现在的空态只有一个含义：**没拿到字幕**（时间轴是好使的），文案按平台分开写。
     *
     * 🔴 2026-11-11 再改（用户 m06406 ④）：分成**两种状态**（Cookie 没填/失效 vs 解析失败），
     *    并删掉「去 B站/Youtube 看这集」那个出口按钮。两种状态的判据来自宿主回的 `fail`，
     *    不是这里猜的 —— 见 `pure/netCueCopy` 的 `NetCueFailReason`。
     */
    private buildCueNetUnavailable(list: HTMLElement): void {
        const u = this.pageCtx?.urls[this.netIndex ?? -1] ?? '';
        // ⛔ 文案不许再在这里写死/写三元：那是「YouTube 集显示 B 站话」的老病根，
        //    且视图里的三元没法单测 ⇒ 统一走 `pure/netCueCopy`，两平台各说各的话（有断言守着）。
        // 🔴 用户 m06406 ④：传 `cueNetFail` 让它分两种状态（该改 Cookie / 改也没用）。
        const copy = netCueEmptyCopy(u, this.cueNetFail);
        const box = list.createDiv({ cls: 'rl-epp-cueempty is-net' });
        const ico = box.createDiv({ cls: 'rl-epp-cueempty-ico' });
        safeSetIcon(ico, copy.state === 'auth' ? 'key-round' : 'captions-off');
        box.createDiv({ cls: 'rl-epp-cueempty-title', text: copy.title });
        box.createDiv({ cls: 'rl-epp-cueempty-desc', text: copy.desc });
        // 🔴 用户 m06406 ④ 明确要求：**删掉**「去 B站/Youtube 看这集」出口按钮。
        //    理由：换到浏览器看并不能解决字幕问题，只是把用户从播放器赶走；
        //    而真正的出路（重填 Cookie）已经逐字写在 desc 里了。
        //    ⛔ 别再补回来 —— 任何「跳出去看」的按钮都算回归。
    }

    /**
     * 空态面板（主流播放器口径）：图标 + 标题 + 说明 + 主按钮 + 兜底提示。
     * `hasFile` = 已经指定了字幕文件、但一行都解析不出来（话术要说「没解出内容」而不是「没放字幕」）。
     */
    private buildCueEmpty(list: HTMLElement, hasFile: boolean): void {
        const box = list.createDiv({ cls: 'rl-epp-cueempty' });
        const ico = box.createDiv({ cls: 'rl-epp-cueempty-ico' });
        safeSetIcon(ico, hasFile ? 'file-warning' : 'captions');

        box.createDiv({
            cls: 'rl-epp-cueempty-title',
            text: hasFile ? '这份字幕里没有可解析的行' : '还没有字幕',
        });
        box.createDiv({
            cls: 'rl-epp-cueempty-desc',
            text: hasFile
                ? '文件已加载，但没解析出时间轴行 —— 可能是空文件、编码异常，或格式未识别。换一份试试。'
                : '字幕会在播放时逐行高亮并自动跟随。导入一份 .srt / .vtt / .ass 就能看到时间轴。',
        });

        // 主按钮：空态的**唯一**导入入口（用户 2026-10-29：工具条那颗已移除，见 `buildCuePanel`）
        const btn = box.createEl('button', {
            cls: 'rl-epp-cueempty-btn',
            attr: { 'data-cue': 'import-empty' },
        });
        const btnIco = btn.createSpan({ cls: 'rl-epp-cueempty-btico' });
        safeSetIcon(btnIco, 'upload');
        btn.createSpan({ text: '导入字幕' });
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.importCueFile();
        });

        // 兜底提示：告诉用户「不用点按钮也有办法」—— 与空态主按钮形成 主/次 两条路
        box.createDiv({
            cls: 'rl-epp-cueempty-hint',
            text: '也可以把字幕文件放到视频同目录（同名 .srt），回到本页会自动识别',
        });
    }

    /**
     * 转写中的实时流（🔴 用户 m11612「空态要变成转录过程（每一句转写）」）。
     *
     * 两块内容：
     *  · 顶部一行标题（`transcribeHeadline`）：说明正在转写、已识别几句 —— 数字在变就是「它在动」的证据；
     *  · 下面逐句列表：每识别出一句就往末尾追加一行（时间戳 + 正文），末尾挂一个闪烁光标表示还在写。
     *
     * ⚠️ 只建**当前已有**的句子；后续句子由 `appendCueTranscribeLine` 增量追加，
     *    ⛔ 不在每次进度回调里 `rerenderCueRows()` —— 上千句时整列表重画会闪、也越来越慢。
     */
    private buildCueTranscribing(list: HTMLElement): void {
        const box = list.createDiv({ cls: 'rl-epp-cuetr' });
        this.cueTrHeadEl = box.createDiv({
            cls: 'rl-epp-cuetr-head',
            text: transcribeHeadline(this.cueAsrLines.length),
        });
        // 转写语是 aria-live 的：句子在不断追加，读屏用户也该知道有内容进来
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        const body = box.createDiv({ cls: 'rl-epp-cuetr-body' });
        this.cueTrBodyEl = body;
        for (const line of this.cueAsrLines) this.appendCueTranscribeRow(body, line);
        this.syncCueTranscribeTail(body);
    }

    /** 追加一行转写草稿（⛔ 不判重、不排序 —— 那些规则全在 `appendTranscribeLine` 里） */
    private appendCueTranscribeRow(body: HTMLElement, line: TranscribeLine): void {
        // 末尾的光标先摘掉，追加完再挂回去，保证它永远在最后一行
        this.cueTrTailEl?.remove();
        this.cueTrTailEl = null;
        const row = body.createDiv({ cls: 'rl-epp-cuetr-row' });
        row.createSpan({ cls: 'rl-epp-cuetr-time', text: formatStamp(line.start) });
        row.createSpan({ cls: 'rl-epp-cuetr-text', text: line.text });
    }

    /** 在列表末尾挂一个闪烁光标（「还在写」的视觉信号） */
    private syncCueTranscribeTail(body: HTMLElement): void {
        this.cueTrTailEl?.remove();
        const tail = body.createDiv({ cls: 'rl-epp-cuetr-tail' });
        tail.setAttribute('aria-hidden', 'true');
        this.cueTrTailEl = tail;
        // 跟到最新一句：用户关心的是「现在写到哪了」。
        // ⚠️ 滚的是**列表本体**（`cueListEl` 是唯一的滚动容器），⛔ 不是 `body`——
        //    给 body 再挂一层滚动就会变成双滚动条。
        const list = this.cueListEl;
        if (list) list.scrollTop = list.scrollHeight;
    }

    /** 解析中的骨架屏：给几行灰条，比一行「正在生成」的字样更能说明「马上就来」 */
    private buildCueSkeleton(list: HTMLElement): void {
        const box = list.createDiv({ cls: 'rl-epp-cueskel' });
        box.createDiv({ cls: 'rl-epp-cueskel-msg', text: CUE_LOADING_HINT });
        // 三行占位条：宽度递减，视觉上像「内容正在长出来」
        // 🔴 百分比必须写在**轨道**（`track`）里的条上，而 `track` 自己承接 flex 伸缩：
        //    若把 `width: 92%` 直接给被 flex 收缩的那一项，三个条会被拉成等宽（实测踩过）。
        for (const w of ['92%', '78%', '64%']) {
            const row = box.createDiv({ cls: 'rl-epp-cueskel-row' });
            row.createSpan({ cls: 'rl-epp-cueskel-time' });
            const track = row.createDiv({ cls: 'rl-epp-cueskel-track' });
            const bar = track.createSpan({ cls: 'rl-epp-cueskel-bar' });
            bar.style.width = w;
        }
    }

    /**
     * ✨ 按钮的点击入口：有结果就收起、没结果就现生成。
     *
     * 🔴 用户 2026-11-11 逐字：「点击在字幕面板上浮出AI面板」
     *    ⇒ 它是**浮层**，不是新的一节：浮在字幕列表上方（`position:absolute`），
     *       ⛔ 不插进 `.rl-epp-cuelist`（插进去会把列表行顶走，时间轴定位会错位）。
     * ⚠️ 同一来源已有结果时再点 = 收起（省 key、也符合「浮层可开关」的直觉）；
     *    想重新生成 = 先在面板里点「重新生成」。
     */
    private async toggleCueAiPanel(): Promise<void> {
        if (this.cueAiLoading) return; // 生成中不响应（按钮也已置 disabled）
        if (this.cueAiPanelEl) {
            this.destroyCueAiPanel();
            return;
        }
        // 从无到有 ⇒ 这一次允许把浮层滚进视野（后续重画不再动页面，见 `cuePanelReveal` 注释）
        this.cuePanelReveal = true;
        // 有当前来源的旧结果 ⇒ 直接展开，不重新请求（同一个来源不必算两遍）
        if (this.cueAiResult && this.cueAiSrc === this.cueSrc) {
            this.showCueAiPanel(this.cueAiResult);
            return;
        }
        await this.generateCueAi(false);
    }

    /**
     * 生成（或重新生成）字幕总结，并把结果浮到面板上。
     * @param force 重新生成：忽略既有结果（面板里那颗「重新生成」用）
     */
    private async generateCueAi(force: boolean): Promise<void> {
        if (this.cueAiLoading) return;
        const fn = this.pageCtx?.cueSummary;
        const fnStream = this.pageCtx?.cueSummaryStream;
        if (!fn && !fnStream) {
            this.showToast('字幕总结没有接入 AI 服务');
            return;
        }
        if (this.cueCues.length === 0) {
            this.showToast('这一集还没有可总结的字幕');
            return;
        }
        if (force) {
            this.cueAiResult = null;
            this.cueAiSrc = null;
        }

        const key = this.cueSrc;
        this.cueAiLoading = true;
        this.syncCueAiBtn();
        // 立刻先把浮层立起来（加载态）——否则大模型要等十几秒，用户会以为按钮没反应
        this.showCueAiPanel(null);

        const input: CueSummaryInput = {
            title: this.netTitleText() || this.entryTitle() || '未命名',
            episode: this.currentEpisodeLabel(),
            lang: subtitleLangLabel(this.currentSubtitleLang()) || undefined,
            cues: this.cueCues,
        };

        /**
         * 🔴 流式的落点（m09565 ①-8）：**就地改已挂好的节点**，⛔ 不每次重建面板。
         *    同一轮请求里 `onPartial` 会被调几十次（模型一块一块吐），
         *    每次 `showCueAiPanel()` 会重建整个浮层 ⇒ 提问框闪烁、输入焦点被夺走、
         *    还会把用户正在打的问题清空（本仓在别处踩过同款"重建丢焦点"）。
         *    ⇒ 生成期间只在**加载态那个容器**里更新一行文本，收尾时再整块重画。
         *
         * 🔴 用户 2026-11-13 逐字：「AI总结输出动效不要打字机动效了一次输出完毕就行」
         *    ⇒ **取消一切逐字动画**，收到片段就把当前全文一次性写进节点。
         *    历史（⛔ 别回头）：早先这里挂过 rAF 节奏器（`cuePaceStep` 匀速推进 shown），
         *    收尾还有 `buildCueTypewriter` 再「逐字吐一遍」；用户明确否掉 ⇒ 两条通道都已删除。
         *    ⚠️ 仍然**不重建面板**（那会丢焦点、清空正在打的字），只改这一行的文本。
         */
        const liveBox = this.cueAiPanelEl?.querySelector<HTMLElement>('.rl-epp-cueai-loading') ?? null;
        let liveTarget = ''; // 模型已到达的全文
        let liveShown: HTMLElement | null = null;
        if (liveBox) {
            liveBox.empty();
            liveBox.addClass('is-streaming');
            const sp = liveBox.createSpan({ cls: 'rl-spinner' });
            sp.setAttribute('data-stream-spin', '1');
            liveShown = liveBox.createSpan({ cls: 'rl-epp-cueai-live' });
        }
        const onPartial = (summary: string): void => {
            // 异步期间换集 / 换字幕 ⇒ 这份结果已作废（与同步结果同一纪律）
            if (this.cueSrc !== key) return;
            if (!liveShown || !summary || summary === liveTarget) return;
            liveTarget = summary;
            // 一次性输出：收到多少就写多少，⛔ 不做逐字/分段动画
            liveShown.textContent = liveTarget;
        };

        let got: CueSummaryResult | null = null;
        try {
            // 优先走流式；宿主没注入 ⇒ 退回一次性（`onPartial` 仍会被调一次）
            got = fnStream ? await fnStream(input, onPartial) : await fn!(input);
        } catch {
            got = null; // 宿主已 Notice；浮层退回重试态，⛔ 不把异常抛进界面
        }
        // 异步期间换集 / 换字幕 ⇒ 这份结果已作废（与 `syncCueSource` 同一纪律）
        if (this.cueSrc !== key) return;

        this.cueAiLoading = false;
        this.syncCueAiBtn();
        if (!got) {
            // 失败：浮层留在「没生成出来 + 重试」这一态，让用户能就地重来
            this.showCueAiPanel(null);
            return;
        }
        this.cueAiResult = got;
        this.cueAiSrc = key;
        this.showCueAiPanel(got);
    }

    /** 把 AI 结果浮层立到字幕面板上（`result === null` ⇒ 加载态 / 失败态） */
    private showCueAiPanel(result: CueSummaryResult | null): void {
        const host = this.subsBoxEl;
        if (!host) return;
        // 已有浮层先清内容（复用外壳，⛔ 不重复插一个）
        this.destroyCueAiPanel();
        const panel = host.createDiv({ cls: 'rl-epp-cueai' });
        this.cueAiPanelEl = panel;
        // 🔴 浮层顶边必须落在**工具条下方**，⛔ 不能 `inset: 0` 盖住工具条。
        //    真机实测（tools/probe-cue-ai.cjs，WIDE 1400）：`inset:0` 时浮层 rect 顶边比
        //    工具条底边还高 28px ⇒ ✨ 按钮被自己弹出的面板压住，只剩面板内的关闭键能退出，
        //    用户会以为「再点一次 ✨ 收起」失效了。
        //    ⚠️ 高度取运行时实测值而不是写死 px：工具条会随语言下拉/按钮增减换行（`flex-wrap`）。
        const toolsH = this.cueToolsEl?.offsetHeight ?? 0;
        if (toolsH > 0) panel.style.top = `${toolsH}px`;
        // 建完立刻同步按钮态（`destroyCueAiPanel()` 刚把 is-on 灭了，新浮层已立起来 ⇒ 要再点亮）
        this.syncCueAiBtn();
        panel.addEventListener('click', (ev) => ev.stopPropagation());

        const head = panel.createDiv({ cls: 'rl-epp-cueai-head' });
        const title = head.createSpan({ cls: 'rl-epp-cueai-title' });
        safeSetIcon(title, 'sparkles');
        title.createSpan({ text: 'AI 总结' });

        // 🔴 用户 2026-11-17 逐字：「重新生成按钮透明化并缩小一点并放在 AI 总结的旁边，
        //    把收起总结图标按钮去掉」
        //    ⇒ ① 「重新生成」不再是靠右的独立动作钮，改成**紧贴标题后**的一枚更小的幽灵钮
        //        （`.rl-epp-cueai-mini`，16px 图标、无底色、无描边）；
        //      ② 「收起总结」（`data-cue=ai-close`）**整颗删掉** —— 收起改由工具条上那颗 ✨ 承担
        //        （`toggleCueAiPanel()` 本来就是这个语义：开着就收），⛔ 别再加回来。
        //    ⚠️ 失败态下主按钮已经是「重试」，这里就不再放「重新生成」，避免两颗同意义的钮。
        if (!this.cueAiLoading && result) {
            const again = head.createEl('button', { cls: 'rl-epp-cueai-mini', attr: { 'data-cue': 'ai-again' } });
            safeSetIcon(again, 'refresh-cw');
            again.setAttribute('data-tip', '重新生成');
            srLabel(again, '重新生成');
            again.addEventListener('click', (ev) => {
                ev.stopPropagation();
                void this.generateCueAi(true);
            });
        }

        const body = panel.createDiv({ cls: 'rl-epp-cueai-body' });
        // 🔴 用户 2026-11-17：「加个 Context Card（上下文气泡卡片）」
        // 🔴 用户 2026-11-19：「以侧边浮现起来的…浮在面板右侧，盖住面板内容，是AI总结的那个面板」
        //    ⇒ 建在 **panel** 上（不是 body）：它是浮在总结文字上的侧边气泡，
        //      进 body 就变成「占一行的卡片」，还会把同一轮问答在上下两处各画一遍。
        //    ⚠️ 必须在 `buildCueAskBox()` 之前建：那个方法负责画历史与输入框，
        //      顺序反了气泡会被历史挤到最底下（真机踩过 `ctxBeforeSum: false`）。
        //    ⚠️ 加载态 / 失败态也要有：那时候用户更需要知道「到底读到字幕了吗」。
        this.buildCueContextCard(panel);
        if (this.cueAiLoading) {
            /**
             * 🔴 类名必须用自有命名空间 `is-cueai-wait`，⛔ **不能叫 `is-loading`**。
             *    Obsidian 核心 CSS（app.css:4282-4291）给 `.is-loading` 挂了通用进度条：
             *    `.is-loading::before { height: 3px; background: var(--interactive-accent); animation: progress-bar }`
             *    ⇒ 真机截图（`_shot/rd/cue-stream.png`，2026-11-12）里流式文字上方那条**横向蓝线**就是它。
             *    本插件 styles.css 里没有任何 `.rl-epp-cueai-body.is-loading` 规则，这个类名纯属白捡核心样式。
             *    加载感由下面那一行的 `.rl-spinner` + 文案负责，不需要再来一条进度条。
             */
            body.addClass('is-cueai-wait');
            const line = body.createDiv({ cls: 'rl-epp-cueai-loading' });
            line.createSpan({ cls: 'rl-spinner' });
            line.createSpan({ text: '正在总结这一集的字幕…' });
            // ⚠️ 加载态**不 return**：提问框必须一直在（用户可能不想等总结，只想直接问一句）
            this.buildCueAskBox(panel, body);
            return;
        }
        if (!result) {
            body.addClass('is-fail');
            body.createDiv({ cls: 'rl-epp-cueai-empty', text: '没生成出来。可重试，或先确认 设置 → AI集成 · 用途 里的「字幕总结服务」已启用。' });
            const retry = body.createEl('button', { cls: 'rl-epp-cueai-retry', text: '重试' });
            retry.addEventListener('click', (ev) => {
                ev.stopPropagation();
                void this.generateCueAi(true);
            });
            this.buildCueAskBox(panel, body);
            return;
        }
        if (result.summary) {
            body.createDiv({ cls: 'rl-epp-cueai-sum', text: result.summary });
        }
        if (result.points.length > 0) {
            const ul = body.createEl('ul', { cls: 'rl-epp-cueai-points' });
            for (const p of result.points) ul.createEl('li', { text: p });
        }
        this.buildCueAskBox(panel, body);
    }

    /**
     * 在浮层里立「提问区」（历史问答 + 输入框）。
     *
     * 🔴 用户 2026-11-11（第二轮）：「给字幕面板的AI改现代化点，如透明化去边框，给加个提问框」
     *
     * 🔴 布局为什么这么分（真机踩过）：
     *    第一版把输入框用 `margin-top: auto` 压到浮层底部、浮层整体滚动 ——
     *    真机实测（`tools/probe-cue-ai2.cjs`，1400 宽 / 窄屏两列）浮层高 510px、视口只有 1000px，
     *    **输入框落到 y=1027 直接出屏**，用户根本看不见自己在哪打字；同时内容短时中间空出一大块。
     *    ⇒ 改成聊天框的标准结构：结果与历史都进可滚动的 `.rl-epp-cueai-body`，
     *      **输入框单独留在 `.rl-epp-cueai-foot`（不滚动、永远可见）**。
     *    ⚠️ 历史问答必须跟着 body 滚、而不是跟输入框一起钉底：
     *      问得多了会把输入框顶走，那正是第一版的翻版。
     */
    private buildCueAskBox(panel: HTMLElement, body: HTMLElement): void {
        // ⚠️ Context Card **不在这里**建：本方法在总结/要点之后才被调用，
        //    卡片必须排在它们前面（见 `showCueAiPanel` 里的注释）。

        // 历史问答：进 body（跟结果一起滚）
        if (this.cueAskTurns.length > 0) {
            const list = body.createDiv({ cls: 'rl-epp-cueai-asks' });
            for (let i = 0; i < this.cueAskTurns.length; i++) {
                const turn = this.cueAskTurns[i];
                const row = list.createDiv({ cls: 'rl-epp-cueai-ask' });
                // 🔴 `data-idx` 是「细条导轨点击定位」的锚点（用户 2026-11-21）：
                //    导轨和这里都按 `cueAskTurns` 同一份数组、同一个下标遍历 ⇒ 序号天然对齐。
                //    ⚠️ 不写 `data-turn`（那是导轨上 `i+1` 的显示序号）：两处混用会在
                //    「历史被裁到 `CUE_ASK_HISTORY_TURNS` 之后」错位一格，找错人。
                row.setAttribute('data-idx', String(i));
                row.createDiv({ cls: 'rl-epp-cueai-q', text: turn.q });
                row.createDiv({ cls: 'rl-epp-cueai-a', text: turn.a });
            }
        }

        const foot = panel.createDiv({ cls: 'rl-epp-cueai-foot' });
        this.cueAskBoxEl = foot;
        if (this.cueAskLoading) {
            const line = foot.createDiv({ cls: 'rl-epp-cueai-loading' });
            line.createSpan({ cls: 'rl-spinner' });
            line.createSpan({ text: '正在读字幕…' });
            return;
        }

        const form = foot.createDiv({ cls: 'rl-epp-cueai-form' });
        // ⚠️ 用 textarea 不用 input：问题常常带两句前提（「开头那个电话是谁打的，为什么后来没再提」），
        //    input 单行会把后半句藏起来，用户看不见自己问了什么。
        const box = form.createEl('textarea', { cls: 'rl-epp-cueai-input' });
        box.rows = 1;
        box.placeholder = '就这一集的字幕提问…';
        box.setAttribute('data-cue', 'ai-input');
        box.addEventListener('click', (ev) => ev.stopPropagation());
        // 自动长高：随内容换行（上限在 CSS 里用 max-height 卡住，别在这里算像素）
        const fit = (): void => {
            box.style.height = 'auto';
            box.style.height = `${Math.min(box.scrollHeight, 96)}px`;
        };
        box.addEventListener('input', fit);
        box.addEventListener('keydown', (ev) => {
            // Enter 发送、Shift+Enter 换行（聊天框的既有直觉；⛔ 反过来会让人误发）
            if (ev.key !== 'Enter' || ev.shiftKey) return;
            ev.preventDefault();
            ev.stopPropagation();
            void this.submitCueAsk(box.value);
        });

        const send = form.createEl('button', { cls: 'rl-epp-cueai-send', attr: { 'data-cue': 'ai-send' } });
        safeSetIcon(send, 'send');
        send.setAttribute('data-tip', '发送（Enter）');
        srLabel(send, '发送提问');
        send.addEventListener('click', (ev) => {
            ev.stopPropagation();
            void this.submitCueAsk(box.value);
        });

        // 🔴 用户 2026-11-17：「提问后答案应该总是滚动到最下面」
        //    ⇒ 每次重画浮层（提交 / 回答回来 / 重新生成）都把 body 滚到末尾。
        //    ⚠️ 滚的是 `body` 不是 `panel`：panel 是 `overflow: hidden`，滚它没用。
        //    ⚠️ 必须等一帧：刚 `createDiv` 出来的节点 `scrollHeight` 还是 0，
        //      同步读会算出「已经在底部」而什么都不做（真机踩过这种假成功）。
        window.requestAnimationFrame(() => {
            if (!body.isConnected) return;
            body.scrollTop = body.scrollHeight;
        });

        // 🔴 面板立起来后**只在首次打开时**把自己滚进视野（真机踩到两次）：
        //    窄屏两列布局下字幕节是 `height: var(--rl-epp-listh, 50vh)` = 500px，
        //    节顶边在 y=558 ⇒ 底边 1068，而视口只有 1000 ⇒ **输入框落在屏幕外**，
        //    用户点开 AI 面板只看到半截总结，找不到打字的地方。
        //    ⚠️ 必须只滚这一次：本方法在**每次重画**时都会被调用（提交提问 / 回答回来 /
        //       重新生成），而面板比视口高时 `block: 'nearest'` 会把面板**顶边**对齐视口顶边
        //       ⇒ 用户报的「每次问答位置都弹回顶部 AI 摘要处」就是这个（m15513）。
        //    `block: 'nearest'` 仍是刻意的：面板已经完整可见时它什么都不做（⛔ 别用 'center'，
        //    那会在每次重新生成时把右栏跳一下，比不滚更烦）。
        if (this.cuePanelReveal) {
            this.cuePanelReveal = false;
            window.requestAnimationFrame(() => {
                if (!panel.isConnected) return; // 建完立刻被收起 ⇒ 不滚
                panel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            });
        }
    }

    /**
     * 右侧「会话细条」导轨：一轮会话一条细条，hover 浮出**那条的用户问题**。
     *
     * 🔴 用户 2026-11-19 逐字（第三版被否，这是最终口径）：
     *    「上下文气泡是定位的细条显示啊，鼠标hover对应的细条就显示每个会话用户问题不显示AI回答」
     *
     * ⚠️ 前三版全部作废，⛔ 别回头：
     *    ① 信息标签墙（「上下文」+ 三枚 pill：哪一集 / 什么语言 / 多少行字幕）；
     *    ② 单张靠右浮层卡（还是一张「卡」）；
     *    ③ 首行问题 + 次行 AI 答案预览 —— **答案不该出现在这里**，
     *       用户明确只要「问过什么」，答案在下面的问答历史里本来就有。
     *
     * 形态：`.rl-epp-cueai-rail` 是一条绝对定位的窄列，贴在**整个 AI 总结面板**右缘，
     *       里面每条 `.rl-epp-cueai-tick` 是一小段**横条**；hover / 键盘聚焦时
     *       它自己的 `.rl-epp-cueai-tip` 才浮出（问题文本）。
     *
     * 🔴 用户 2026-11-21 逐字（两件事）：
     *    ① 「还有这个细条导轨改成这个样横条」—— 形态由竖条改横条，右端对齐成一列；
     *    ② 「用细条导轨点击即跳转定位到用户的问题处」—— 横条从「只看」变成**可点**的锚点。
     *    ⇒ 点击 = 把 `.rl-epp-cueai-body` 滚到对应那一轮问答的顶端（见下 `scrollToAsk`）。
     *    ⚠️ 只滚 body，⛔ 不用 `scrollIntoView()`：那个会把**外层页面**一起滚，
     *       详情页整块被顶走（用户本来只想在浮层里跳一下，不是想换页面位置）。
     *
     * ⚠️ 挂在 `panel` 而不是 `body`：panel 自己 `position:absolute`，天然是包含块；
     *    导轨要贴着面板右缘走，⛔ 不能跟着 body 滚动，也别进 body（会占一行、把内容推下去）。
     * ⚠️ 顺序与历史一致：最新一轮在最后（视觉上最下面），跟聊天记录方向一致。
     */
    private buildCueContextCard(panel: HTMLElement): void {
        if (this.cueAskTurns.length === 0) return;
        const rail = panel.createDiv({ cls: 'rl-epp-cueai-rail' });
        for (let i = 0; i < this.cueAskTurns.length; i++) {
            const turn = this.cueAskTurns[i];
            // ⚠️ 用 `<button>` 而不是 `<div>`：本轮它变成了**可点控件**（跳转定位），
            //    用 div 得自己补 role/tabIndex/Enter/Space 键盘语义，还拿不到宿主的 focus 样式。
            const tick = rail.createEl('button', { cls: 'rl-epp-cueai-tick' });
            // 序号写进 data 属性而不是可见文本：横条必须细，文字靠 hover 浮出
            tick.setAttribute('data-turn', String(i + 1));
            // 🔴 点击定位的锚点：与 `.rl-epp-cueai-ask[data-idx]` 同一个下标体系
            tick.setAttribute('data-idx', String(i));
            // 🔴 2026-11-12（用户 m00353 ①-9「部分按钮 hover 双提示重叠覆盖」）：
            //    这里原来同时挂 `aria-label` + `data-tip`，而 tick 里**还有**一个 CSS 子气泡
            //    `.rl-epp-cueai-tip`（`styles.css` 的 `.rl-epp-cueai-tick:hover .rl-epp-cueai-tip`）
            //    ⇒ 鼠标停在这根细横条上会叠出**三层**：宿主的 aria 气泡 + 插件 data-tip 气泡 + CSS 子气泡。
            //    现在的口径：
            //      · 视觉提示**只留 CSS 子气泡** —— 它贴面板右缘向左长开，比全局 data-tip 的「正下方」
            //        更适合一根贴着面板边缘的 2px 横条（全局气泡在右缘会被视口钳制到左边、压住正文）；
            //      · 读屏名走 `srLabel` 隐藏文本，⛔ 不用 `aria-label`；
            //      · ⛔ 不挂 `data-tip`：CSS 子气泡已经显示问题全文，再来一个只是重复。
            srLabel(tick, turn.q);
            // ⚠️ `tip` 建在 tick 内部 ⇒ 自动是它的相对定位子节点，
            //    面板销毁时随 rail 一起走，不用手动回收（挂 body 就得自己清，漏一次永远留着）
            tick.createDiv({ cls: 'rl-epp-cueai-tip', text: turn.q });
            tick.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.scrollToAsk(panel, i);
            });
        }
    }

    /**
     * 把 AI 总结浮层滚到第 `idx` 轮问答（导轨横条点击时调用）。
     *
     * ⚠️ 为什么在点击时才查 DOM、而不是建横条时就把引用存下来：
     *    `buildCueContextCard()` 在 `buildCueAskBox()` **之前**执行（顺序见 `showCueAiPanel`
     *    里那段 `ctxBeforeSum` 注释），那时候问答行还不存在 —— 建时就 `querySelector` 只会拿到 null，
     *    横条全部变成点了没反应的死件。
     * ⚠️ 滚动量手算（`row.offsetTop` 减容器自身偏移），⛔ 不用 `scrollIntoView()`：
     *    后者会连带外层滚动容器一起滚，把整个详情页顶走。
     */
    private scrollToAsk(panel: HTMLElement, idx: number): void {
        const body = panel.querySelector<HTMLElement>('.rl-epp-cueai-body');
        if (!body) return;
        const row = body.querySelector<HTMLElement>(`.rl-epp-cueai-ask[data-idx="${idx}"]`);
        if (!row) return;
        // `offsetTop` 是相对**最近定位祖先**的，body 不是定位元素 ⇒ 两者同为偏移父级，
        // 相减就是行在 body 内容坐标里的位置（实测 body 的 offsetParent 是 `.rl-epp-cuesbox`，
        // row 的也是同一个，所以相减成立；任一为 null 时退回直接用 offsetTop）。
        const rowTop = row.offsetTop;
        const bodyTop = body.offsetTop;
        const target = rowTop >= bodyTop ? rowTop - bodyTop : rowTop;
        body.scrollTo({ top: Math.max(0, target - 2), behavior: 'smooth' });
    }

    /**
     * 发一次提问。
     *
     * ⚠️ 失败不写进 `cueAskTurns`（历史只留真实成功的问答，⛔ 不把「失败了」当成一轮）；
     *    但**失败也不清空输入框**，用户改两个字就能重发 —— 清掉等于让他重打。
     */
    private async submitCueAsk(raw: string): Promise<void> {
        if (this.cueAskLoading) return;
        const q = raw.replace(/\s+/g, ' ').trim();
        if (!q) return;
        const fn = this.pageCtx?.cueAsk;
        if (!fn) {
            this.showToast('字幕提问没有接入 AI 服务');
            return;
        }
        if (this.cueCues.length === 0) {
            this.showToast('这一集还没有可提问的字幕');
            return;
        }

        const key = this.cueSrc;
        this.cueAskLoading = true;
        // 立刻重画：输入框换成「正在读字幕…」，用户能得到「我这一下确实点到了」的反馈
        this.showCueAiPanel(this.cueAiResult);

        const input: CueSummaryInput = {
            title: this.netTitleText() || this.entryTitle() || '未命名',
            episode: this.currentEpisodeLabel(),
            lang: subtitleLangLabel(this.currentSubtitleLang()) || undefined,
            cues: this.cueCues,
        };

        let answer: string | null = null;
        try {
            answer = await fn(input, q, this.cueAskTurns);
        } catch {
            answer = null; // 宿主已 Notice
        }
        // 异步期间换集 / 换字幕 ⇒ 这份回答已作废（与 `generateCueAi` 同一纪律）
        if (this.cueSrc !== key) return;

        this.cueAskLoading = false;
        if (answer) {
            this.cueAskTurns.push({ q, a: answer });
            // 只留最近几条（`buildCueAskBody` 侧还有一道同样的截断，两处都留是有意的：
            // 这里防内存无限长，那边防 prompt 无限长）
            if (this.cueAskTurns.length > CUE_ASK_HISTORY_TURNS) {
                this.cueAskTurns = this.cueAskTurns.slice(-CUE_ASK_HISTORY_TURNS);
            }
        }
        this.showCueAiPanel(this.cueAiResult);
    }

    /** 拆掉浮层（⛔ 不清 `cueAiResult` / `cueAskTurns`：收起后再点要能秒开、历史不丢） */
    private destroyCueAiPanel(): void {
        this.cueAiPanelEl?.remove();
        this.cueAiPanelEl = null;
        this.cueAskBoxEl = null;
        // 按钮的 `is-on` 是「浮层开着」的指示 ⇒ 浮层一拆就要跟着灭，
        // ⚠️ 漏这一步会让 ✨ 一直亮着，用户以为面板还在（真机最容易漏的收尾）
        this.syncCueAiBtn();
    }

    /** 作废 AI 状态（换集 / 换字幕 / 关面板时调） */
    private resetCueAi(): void {
        this.cueAiResult = null;
        this.cueAiSrc = null;
        this.cueAiLoading = false;
        // 问答历史也必须清：带着上一集的问答去问这一集，模型会照旧答案硬编
        this.cueAskTurns = [];
        this.cueAskLoading = false;
        this.destroyCueAiPanel();
        this.syncCueAiBtn();
    }

    /**
     * ✨ 按钮的忙碌态。
     * ⚠️ 生成中 `disabled` 必须真加：连点会打出多条并发请求，既烧 key 又让结果互相覆盖。
     */
    private syncCueAiBtn(): void {
        const btn = this.cueAiBtnEl;
        if (!btn) return;
        btn.toggleClass('is-on', this.cueAiLoading || this.cueAiPanelEl !== null);
        btn.toggleClass('is-busy', this.cueAiLoading);
        if (this.cueAiLoading) btn.setAttribute('disabled', 'disabled');
        else btn.removeAttribute('disabled');
    }

    // ── 本地语音转文字（用户 m01938）─────────────────────────────────────────

    /**
     * 建转写进度横幅（常驻节点、默认 `is-off` 隐藏）。
     *
     * 🔴 用户避坑指南：「绝不遮挡视频：下载进度、转写进度必须做成轻量级的浮层或面板内元素」
     *    ⇒ 只在字幕面板内占一条 22px 高的细横幅，⛔ 不弹全屏、⛔ 不盖 `video`。
     * ⚠️ 为什么常驻而不是用时再建：`startCueTranscribe()` 会在 `await` 里等几分钟，
     *    中途任何一次 `renderCueRows()` 重画都可能把临时节点擦掉 ⇒ 建一次、之后只改文本与宽度。
     */
    private buildCueAsrBar(host: HTMLElement): void {
        const bar = host.createDiv({ cls: 'rl-epp-asrbar is-off' });
        this.cueAsrBarEl = bar;
        const track = bar.createDiv({ cls: 'rl-epp-asrbar-track' });
        this.cueAsrFillEl = track.createDiv({ cls: 'rl-epp-asrbar-fill' });
        this.cueAsrTextEl = bar.createDiv({ cls: 'rl-epp-asrbar-text' });
        // 🔴 句级细节单独一行（用户 m09995）：默认收起，有「到哪句」时才展开
        this.cueAsrDetailEl = bar.createDiv({ cls: 'rl-epp-asrbar-detail is-off' });
        // ⚠️ 进度条对读屏没意义（百分比要靠文本念），给它 `aria-hidden` 免得念出一个空元素
        track.setAttribute('aria-hidden', 'true');
        // 🔴 文案节点是**这条横幅的 live region**：识别可能跑几分钟，中途文案会变好几次
        //    （提取音频 → 本地识别 → 对齐时间戳），用户这时候可能已经切走了。
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        // ⚠️ ⛔ 不给它 `aria-label`：本仓 `data-tip` 会另起一层气泡，两者并存会叠双层
        //    （AGENTS.md 明令禁；这条横幅不需要悬停提示，信息已经在正文里）。
        // 进度未知时（`percent === null`）用不定态条纹（`.is-indet`），⛔ 不画一个假 0% 的条。
    }

    /**
     * 推进度横幅：`percent === null` ⇒ 不定态；`is-off` 收起来。
     *
     * 🔴 用户 m09995：「转录中还是只有个进度条百分比都不知道转录到哪句时间戳了」
     *    ⇒ `detail`（如 `0:12 → 0:19 / 3:40`）单独成一行小字放在阶段文案**下面**，
     *    ⛔ 不挤在同一行：窄面板下两段中文会各自折成两行，读起来像乱码。
     *    没有 detail 时那一行直接收起（`is-off`），不留空行撑高横幅。
     */
    private paintCueAsr(percent: number | null, label: string, detail?: string): void {
        const bar = this.cueAsrBarEl;
        const fill = this.cueAsrFillEl;
        const text = this.cueAsrTextEl;
        if (!bar || !fill || !text) return;
        bar.removeClass('is-off');
        const indet = percent === null;
        bar.toggleClass('is-indet', indet);
        // ⚠️ 不定态时宽度交给 CSS（条纹整条扫），⛔ 别写 `width: 0%` —— 那看起来像「卡住了」
        fill.style.width = indet ? '' : `${Math.max(0, Math.min(100, percent))}%`;
        text.setText(label);
        const d = String(detail ?? '').trim();
        const sub = this.cueAsrDetailEl;
        if (sub) {
            sub.setText(d);
            sub.toggleClass('is-off', !d);
        }
    }

    /**
     * 追加一句转写草稿并就地更新（🔴 用户 m11612「每一句转写」）。
     *
     * 🔴 两条路径，⛔ 不要一律重画：
     *  · 面板**已经**处在转写态（`cueTrBodyEl` 还在，说明列表容器没被 `renderCueRows` 重建过）
     *    ⇒ 只往末尾追加一行 + 更新标题数字，DOM 变动最小、几千句也不卡；
     *  · 还没进转写态 / 刚被重画过 ⇒ 走一次整列表重画把它切进转写态。
     *
     * ⚠️ 判据必须是「节点还挂在文档里」而不只是「指针非空」：
     *    `renderCueRows()` 会 `list.empty()` 把节点摘掉，但指针要到 `buildCuePanel` 清理段才置空，
     *    中间这段窗口里往旧节点追加 = 用户看不见任何东西（最典型的「点了没反应」）。
     */
    private appendCueTranscribeLine(line: { start: number; end: number; text: string }): void {
        const next = appendTranscribeLine(this.cueAsrLines, line);
        // 同一句重复上报：什么都不用做（`appendTranscribeLine` 已判重）
        if (next.length === this.cueAsrLines.length && next.length > 0) {
            const same = next.every((l, i) => l === this.cueAsrLines[i]);
            if (same) return;
        }
        this.cueAsrLines = next;
        const body = this.cueTrBodyEl;
        if (!body || !body.isConnected) {
            this.renderCueRows();
            return;
        }
        this.appendCueTranscribeRow(body, line);
        this.syncCueTranscribeTail(body);
        this.cueTrHeadEl?.setText(transcribeHeadline(this.cueAsrLines.length));
    }

    /** 收起并复位进度横幅（转写结束 / 失败 / 换集时调） */
    private destroyCueAsrBar(): void {
        const bar = this.cueAsrBarEl;
        if (!bar) return;
        bar.addClass('is-off');
        bar.removeClass('is-indet');
        this.cueAsrFillEl?.style.setProperty('width', '0%');
        this.cueAsrTextEl?.setText('');
        this.cueAsrDetailEl?.setText('');
        this.cueAsrDetailEl?.addClass('is-off');
    }

    /**
     * 🎙️ 按钮的忙碌态（与 `syncCueAiBtn` 同款，但**不与 ✨ 互斥**：
     * 转写在本地跑、AI 总结在云端跑，两件事可以同时进行）。
     *
     * 🔴 用户 m06361 之后改口径：忙碌时**不再 `disabled`**，而是换成「停止」语义 ——
     *    一颗转写要跑几分钟的按钮如果被禁用，用户就只能等或者重启 Obsidian。
     *    ⇒ `is-busy` 只负责配色/动画，`aria-label` 与 `data-tip` 跟着语义换。
     */
    private syncCueAsrBtn(): void {
        const btn = this.cueAsrBtnEl;
        if (!btn) return;
        btn.toggleClass('is-busy', this.cueAsrLoading);
        // ⚠️ 图标保持 `mic` 不换：换成方块/叉会让「刚才那颗按钮去哪了」产生歧义；
        //    语义靠文案与 `is-busy` 的视觉变化表达。
        const label = this.cueAsrLoading ? '停止转写' : '把这一集的声音转成字幕';
        setTip(btn, label);
        // 🔴 ⛔ 不写 `aria-label`：本仓 `data-tip` 与 `aria-label` 只能存在一个，
        //    两者并存会叠出双层悬停气泡（见 `srLabel` 上方的规矩）。读屏名走 `srLabel`。
        srLabel(btn, label);
        // ⚠️ 忙碌时**不置 disabled**：那颗按钮此刻是「停止」，禁用就等于取消不了。
    }

    /** 点忙碌态的 🎙️：叫停在跑的子进程（用户 m06361「停止转录的交互」） */
    private stopCueTranscribe(): void {
        this.cueAsrCancel?.cancel();
        // ⚠️ 文案立刻改：kill 到子进程 close 之间可能有几十毫秒到几百毫秒，
        //    期间没有任何反馈的话，用户会以为那颗按钮失效了。
        this.paintCueAsr(null, '正在停止…');
    }

    /**
     * 点 🎙️：把当前这一集的声音转成字幕。
     *
     * 🔴 用户 m01938 的原流程：「点击 [开始转写] 后的状态反馈（显示在面板内或底部细横幅）：
     *    正在提取音频... → 正在本地识别... → 正在生成时间戳对齐... → ✅ 转写完成！
     *    字幕已保存至视频同目录。结果：转写完成后，自动刷新字幕面板，新字幕立刻生效。」
     *
     * ⚠️ 三个必须守住的边界：
     *  ① **网络集没有本地文件** ⇒ 直接给出人话提示，⛔ 不要拿 `item.url`（那是 `app://`/`http`
     *     资源地址）去喂 ffmpeg —— 那会得到一个「文件不存在」的天书错误；
     *  ② **转写途中切集** ⇒ 结果落到别的集上；回来时用 `cueAsrSrc` 比对，不一致只提示不刷新；
     *  ③ 全程 `await` 不动播放：子进程在宿主侧跑，`<video>` 照播（用户明确要求「全程视频播放不中断」）。
     */
    private async startCueTranscribe(): Promise<void> {
        const run = this.pageCtx?.transcribe;
        if (!run) {
            this.showToast('这一台还没有接入本地转写');
            return;
        }
        if (this.cueAsrLoading) return;
        const videoPath = this.currentVideoPath();
        if (!videoPath) {
            // ⚠️ 人话，不出现 ffmpeg / whisper / 流 之类的技术词（用户避坑指南第四条）
            this.showToast('这一集是网络播放，没有本地文件可以转写');
            return;
        }

        const srcKey = this.cueKey();
        this.cueAsrSrc = srcKey;
        this.cueAsrLoading = true;
        // 🔴 开跑先清空上一轮的草稿：面板马上要切进「转写中」态，
        //    留着旧句子会让用户以为这次的句子是上次的。
        this.cueAsrLines = [];
        // 🔴 每次开跑都换一枚新令牌：上一次取消过的令牌是**永久** cancelled 的，
        //    复用会让第二次转写在第一步就被判成「已取消」。
        this.cueAsrCancel = createAsrCancelToken();
        this.syncCueAsrBtn();
        this.paintCueAsr(null, '正在准备…');
        // 🔴 立刻重画一次：否则面板要等到第一句识别出来才切态，
        //    那几十秒里用户看到的仍是「还没有字幕」——正是 m11612 要修的那个观感。
        this.renderCueRows();

        let outcome: TranscribeOutcome;
        try {
            outcome = await run({
                videoPath,
                cancel: this.cueAsrCancel,
                onProgress: (percent, label, detail, line) => {
                    // ⚠️ 切走了就不再画进度：横幅属于「当前这一集的面板」，
                    //    拿别的集的进度去刷它，用户会以为是当前这集在转。
                    if (this.cueAsrSrc !== this.cueKey()) return;
                    this.paintCueAsr(percent, label, detail);
                    // 🔴 逐句实时流（用户 m11612）：追加这一句并增量更新面板。
                    if (line) this.appendCueTranscribeLine(line);
                },
            });
        } catch (err) {
            outcome = { ok: false, message: err instanceof Error ? err.message : String(err) };
        }
        this.cueAsrLoading = false;
        this.cueAsrCancel = null;
        this.syncCueAsrBtn();

        // 🔴 转写期间换过集 / 换过字幕 ⇒ 这份结果是给上一集的，不能拿来刷当前面板
        if (this.cueAsrSrc !== this.cueKey()) {
            this.cueAsrSrc = null;
            this.destroyCueAsrBar();
            this.showToast(outcome.ok ? '转写完成（属于之前那一集）' : `转写失败：${outcome.message}`);
            return;
        }
        this.cueAsrSrc = null;

        // 🔴 用户点了「停止」⇒ ⛔ 不弹「转写失败」（那是它自己按的，不是出错），
        //    横幅也直接收起，不留在那里让人以为还在跑。
        if (outcome.cancelled) {
            this.destroyCueAsrBar();
            this.showToast('已停止转写');
            return;
        }

        if (!outcome.ok) {
            this.destroyCueAsrBar();
            this.showToast(`转写失败：${outcome.message}`);
            return;
        }
        // ✅ 成功：横幅先停在满格，再淡出（直接消失会让人怀疑「到底做完没有」）
        this.paintCueAsr(100, outcome.message);
        // 🔴 用户 m11423「SenseVoice转录的文件放哪了啥都没关联」：
        //    转写产物是**这一集的**字幕，必须像用户手动选字幕那样写进 `subtitlePaths`。
        //    ⛔ 只靠下面那句「重扫候选」是不够的 —— 那只在当前会话里有面板内容，
        //    重启 Obsidian / 换一集再回来，关联就没了，用户看到的是「文件在但谁也认不得」。
        // ⚠️ 走 `onSaveSubtitle`（宿主已挂到 `persistSubtitlePath`），⛔ 别在视图层直接改库。
        if (outcome.srtPath) {
            this.saveSubtitleFor(outcome.srtPath);
        }
        // 🔴 「自动刷新字幕面板，新字幕立刻生效」：`cueSrc = null` 强制 `syncCueSource` 重走
        //    来源判定 —— 新 SRT 与视频同目录，基类 `autoLoadSubtitle` 会把它扫进候选。
        //    ⚠️ 先重扫候选（基类私有），再让面板重解析：顺序反了会读到一个还不存在的候选。
        this.rerenderCurrent();
        this.cueSrc = null;
        void this.syncCueSource();
        window.setTimeout(() => this.destroyCueAsrBar(), 2600);
    }

    // ── 学习模式（用户 m01938 §3）────────────────────────────────────────────

    /**
     * 📖 开关学习模式。
     *
     * 🔴 用户文档 §3：「点击 [📖 学习模式] 按钮进入。布局改变：播放器区域垂直分为上下两半，
     *    下半屏是放大、加宽的字幕阅读区（类似提词器）。」
     *
     * ⚠️ **没有**去切播放器分屏：那要动左栏/季带/全屏三条布局链路，牵一发动全身。
     *    真正让提词器「好读」的是字号、行距、当前句的醒目度 —— 这些全靠 `.is-learn` 一个类驱动，
     *    加宽由面板自己 `flex` 拿得多一点完成。⛔ 别为了「照文档」去重构整页布局。
     */
    private toggleCueLearn(): void {
        this.cueLearnOn = !this.cueLearnOn;
        const box = this.cueToolsEl?.parentElement ?? null;
        box?.toggleClass('is-learn', this.cueLearnOn);
        this.syncCueLearnBtn();
        // 字号一变，行高就变 ⇒ 锁定态的对位必须重算（否则当前行会偏出去半行）
        if (this.cueActiveIdx >= 0) this.scrollCueTo(this.cueActiveIdx);
        // 退出学习模式时把查词浮层收掉（否则它会挂在已经变小了的字上面）
        if (!this.cueLearnOn) this.hideWordTip();
        // 🔴 退出学习模式必须一并关掉跟读：按钮会隐藏（`is-hidden`），
        //    若跟读继续跑，行为就是「用户看不见任何开关，视频却自己暂停又自己播」。
        //    ⛔ 别指望用户去别处关 —— 那是个找不到的开关。
        if (!this.cueLearnOn && this.cueShadowOn) {
            this.cueShadowOn = false;
            this.stopCueShadowTimer();
            this.renderCueShadowBar();
        }
        // 🎤 按钮的显隐/状态跟着学习模式走（它只在学习模式里出现）
        this.syncCueShadowBtn();
    }

    /** 📖 按钮的状态回填（图标 + 提示语；`is-on` 表示当前开着） */
    private syncCueLearnBtn(): void {
        const btn = this.cueLearnBtnEl;
        if (!btn) return;
        btn.toggleClass('is-on', this.cueLearnOn);
        safeSetIcon(btn, this.cueLearnOn ? 'book-open-check' : 'book-open');
        // 🔴 用户 m03071 选定「不加前缀，只保留描述」：原来是「学习模式：放大字幕、悬停查词、循环跟读」，
        //    前缀与按钮自身名字重复，读起来像「学习模式」被念了两遍 ⇒ 只留描述。
        const tip = this.cueLearnOn ? '退出学习模式' : '放大字幕、悬停查词、循环跟读';
        setTip(btn, tip);
        srLabel(btn, tip);
    }

    /**
     * 🔁 单循环切换循环档位：关 → 单句 → AB → 关。
     *
     * ⚠️ 与 `modeBtn`（跟随/锁定）同一套「显示下一步动作」的口径：单循环钮只显示当前态的话，
     *    用户点完发现图标没变会以为没生效（本仓已经为这个观感改过两次）。
     * ⚠️ 进「单句」档时若当前没有高亮行，回落到 `cueActiveIdx`；都没有就把档位停在「关」并提示
     *    —— ⛔ 不要进一个「有档位但没区间」的状态，那会让用户以为循环坏了。
     */
    private cycleCueLoop(): void {
        if (this.cueLoop === 'off') {
            const idx = this.cueLoopIdx >= 0 ? this.cueLoopIdx : this.cueActiveIdx;
            if (idx < 0) {
                this.showToast('先让某一句亮起来（点一下字幕行）再开单句循环');
                return;
            }
            this.cueLoopIdx = idx;
            this.cueLoop = 'cue';
        } else if (this.cueLoop === 'cue') {
            // 进 AB 档：把「当前锁定句」当 A 点，提示用户右键另一句设 B
            this.cueAb = null;
            this.cueAbBarEl = null;
            this.cueLoop = 'ab';
            this.renderCueAbBar();
            this.showToast('已进入 AB 复读：右键一句设 A 点，再右键另一句设 B 点');
        } else {
            this.cueLoop = 'off';
            this.cueLoopIdx = -1;
            this.cueAb = null;
            this.renderCueAbBar();
        }
        this.syncCueLoopBtn();
    }

    /** 🔁 按钮状态回填（**显示下一步动作**，见 `cycleCueLoop` 注释） */
    private syncCueLoopBtn(): void {
        const btn = this.cueLoopBtnEl;
        if (!btn) return;
        const next: LoopKind = this.cueLoop === 'off' ? 'cue' : this.cueLoop === 'cue' ? 'ab' : 'off';
        const icon = next === 'cue' ? 'repeat-1' : next === 'ab' ? 'repeat' : 'repeat-off';
        safeSetIcon(btn, icon);
        const label =
            next === 'cue' ? '单句循环' : next === 'ab' ? 'AB 复读' : '关闭循环';
        setTip(btn, label);
        srLabel(btn, label);
        btn.toggleClass('is-on', this.cueLoop !== 'off');
    }

    /**
     * 🎤 按钮状态回填 + 学习模式下的显隐。
     *
     * 🔴 两颗状态要分开：`is-on` 表示跟读开着（会真的暂停/自动播），
     *    `is-hidden` 表示不在学习模式（按钮该消失）。⛔ 别用一个 class 兼表两件事
     *    —— 退出学习模式时若一并把 `is-on` 清掉，用户再进来会发现「跟读自己关了」。
     */
    private syncCueShadowBtn(): void {
        const btn = this.cueShadowBtnEl;
        if (!btn) return;
        btn.toggleClass('is-on', this.cueShadowOn);
        btn.toggleClass('is-hidden', !this.cueLearnOn);
        /**
         * 🔴 用户 m03071：「字幕面板切换学习模式时这个跟读模式图标显示空白」。
         *    根因就是这里**从来没挂过图标** —— 下面只写了 `data-tip` / `srLabel`，
         *    按钮里一个 `<svg>` 都没有，所以学习模式一开、按钮显形，就是一块空白的 24×22。
         *
         * ⛔ 别再漏这一步：本仓做过 `safeSetIcon` 收口就是因为「同款函数被 9 个文件各抄一份」，
         *    漏一处不会被类型系统抓到（`setIcon` 对未知图标是静默 no-op，见 services/safeIcon.ts）。
         *
         * 图标选 `mic-vocal`（实测存在于 Obsidian 的图标表，见本轮探针）：
         *  · 不能用 `mic` —— 那颗已经是「音频转文字」（ASR）的图标，同排两颗同形会分不清；
         *  · 不能用 `repeat-1` / `repeat` —— 那是右边「单句循环 / AB 复读」的档位图标；
         *  · `mic-vocal` = 带声波的麦克风，语义正好是「跟着念」，与跟读同义。
         */
        safeSetIcon(btn, 'mic-vocal');
        // 🔴 用户 m03071 选定「不加前缀，只保留描述」⇒ 提示语不再写「跟读模式：」这种分组前缀，
        //    直接说清这一下会发生什么（开启态写下一个动作，与 `syncCueLoopBtn` 同口径）。
        const tip = this.cueShadowOn
            ? '关闭跟读：恢复连续播放'
            : `跟读：每句留白 ${this.cueShadowGap}s 后自动续播`;
        setTip(btn, tip);
        srLabel(btn, tip);
    }

    /**
     * 右键某行 ⇒ 设 A / B 点（用户 §3.3「右键点击某句选择 [设为 A 点」，
     * 在另一句选 [设为 B 点]」）。
     *
     * ⚠️ 一次右键设一个点，两个点齐了才成区间：第一次设 A，第二次设 B，第三次重新从 A 开始
     *    —— 这样「换一段」不需要额外的「清除」动作（用户文档里的清除按钮在横幅上）。
     */
    private cueRightClickRow(idx: number): void {
        const cue = this.cueCues[idx];
        if (!cue) return;
        if (!this.cueAb) {
            // A 点：先只记下这一句的下标，等 B 点来了再算区间
            this.cueAbDraftA = idx;
            this.showToast(`A 点已设为 ${formatStamp(cue.start)}，再右键另一句设 B 点`);
            return;
        }
        // 已有完整区间 ⇒ 重新开始（第三次右键 = 重设 A）
        this.cueAb = null;
        this.cueAbDraftA = idx;
        this.renderCueAbBar();
        this.showToast(`A 点已设为 ${formatStamp(cue.start)}，再右键另一句设 B 点`);
    }

    /**
     * 第二次右键落地：用 `abFromCues` 把两句算成区间。
     * ⚠️ 必须走纯函数而不是在这里手写 `min/max`：同句设 A/B、坏时长、越界这些都得收口。
     */
    private commitCueAbPoint(idx: number): void {
        const a = this.cueAbDraftA;
        if (a < 0) {
            this.cueRightClickRow(idx);
            return;
        }
        const ab = abFromCues(this.cueCues, a, idx);
        if (!ab) {
            this.showToast('这两句挨得太近（或时间戳异常），换一句再来');
            this.cueAbDraftA = idx;
            return;
        }
        this.cueAb = ab;
        this.cueAbDraftA = -1;
        this.cueLoop = 'ab';
        this.syncCueLoopBtn();
        this.renderCueAbBar();
        this.showToast(`AB 区间已设：${formatStamp(ab.a)} ←→ ${formatStamp(ab.b)}`);
    }

    /**
     * 画/擦顶部 AB 横幅（`A [00:12] ←→ B [00:45] · 🔁 循环中 · [清除]`）。
     *
     * ⚠️ 挂在 `cueToolsEl` 的父容器里、列表之外 —— 塞进列表会跟着滚走。
     * ⚠️ 每次重建整条（不是每帧）：它只在设点/清除时变，重建开销可以忽略。
     */
    private renderCueAbBar(): void {
        this.cueAbBarEl?.remove();
        this.cueAbBarEl = null;
        const host = this.cueToolsEl?.parentElement;
        if (!host || !this.cueAb) return;
        const bar = host.createDiv({ cls: 'rl-epp-cueab' });
        this.cueAbBarEl = bar;
        // 🔴 横幅文本里的 ✓ 与 ↺ 只用文本节点，⛔ 不塞 `data-tip`：
        //    这条横幅已经很长，再挂气泡会盖住字幕。
        bar.createSpan({ cls: 'rl-epp-cueab-a', text: `A ${formatStamp(this.cueAb.a)}` });
        bar.createSpan({ cls: 'rl-epp-cueab-arrow', text: '←→' });
        bar.createSpan({ cls: 'rl-epp-cueab-b', text: `B ${formatStamp(this.cueAb.b)}` });
        bar.createSpan({ cls: 'rl-epp-cueab-dot', text: '·' });
        bar.createSpan({ cls: 'rl-epp-cueab-state', text: '🔁 循环中' });
        const clear = bar.createEl('button', { cls: 'rl-epp-cueab-clear', text: '清除' });
        clear.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.cueAb = null;
            this.cueAbDraftA = -1;
            if (this.cueLoop === 'ab') this.cueLoop = 'off';
            this.syncCueLoopBtn();
            this.renderCueAbBar();
        });
    }

    /**
     * 🎤 开关影子跟读（用户 §3.4：「学习模式顶部工具栏有一个 🎤 跟读 开关」）。
     *
     * ⚠️ 挂在学习模式里才有意义，但**不强制**：用户可能在普通模式下只想单句跟读。
     *    横幅自己会说明当前留白时长，不存在「开了不知道」。
     */
    private toggleCueShadow(): void {
        this.cueShadowOn = !this.cueShadowOn;
        this.stopCueShadowTimer();
        this.renderCueShadowBar();
        this.showToast(this.cueShadowOn ? `🎤 跟读模式已开启（留白 ${this.cueShadowGap}s）` : '跟读模式已关闭');
    }

    /** 画/擦跟读状态条（`🎤 跟读模式 · 留白时长 3s · [关闭]`） */
    private renderCueShadowBar(): void {
        this.cueShadowBarEl?.remove();
        this.cueShadowBarEl = null;
        const host = this.cueToolsEl?.parentElement;
        if (!host || !this.cueShadowOn) return;
        const bar = host.createDiv({ cls: 'rl-epp-cueshadow' });
        this.cueShadowBarEl = bar;
        bar.createSpan({ cls: 'rl-epp-cueshadow-ico', text: '🎤' });
        bar.createSpan({ cls: 'rl-epp-cueshadow-txt', text: `跟读模式 · 留白时长 ${this.cueShadowGap}s` });
        // 倒计时读数节点先建出来，跑起来只改文本（⛔ 不每帧重建）
        const count = bar.createSpan({ cls: 'rl-epp-cueshadow-count' });
        count.setText('');
        const off = bar.createEl('button', { cls: 'rl-epp-cueshadow-off', text: '关闭' });
        off.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.cueShadowOn = false;
            this.stopCueShadowTimer();
            this.renderCueShadowBar();
        });
    }

    /** 停掉跟读倒计时（幂等；在关闭跟读 / 重画面板 / 切集 / 关闭视图时都要调） */
    private stopCueShadowTimer(): void {
        if (this.cueShadowTimer !== null) {
            window.clearInterval(this.cueShadowTimer);
            this.cueShadowTimer = null;
        }
        this.cueShadowDeadline = 0;
        this.cueShadowBarEl?.querySelector('.rl-epp-cueshadow-count')?.setText?.('');
    }

    /**
     * 跟读倒计时跑起来：到点自动 `play()` 播下一句。
     *
     * 🔴 为什么用 `setInterval` 而不是 `timeupdate`：**暂停期间 `timeupdate` 完全不触发**
     *    （这是规范行为），靠它等倒计时会永远等不到 ⇒ 视频再也不自动恢复。
     * ⚠️ 为什么不用单个 `setTimeout`：读数要每秒刷新给用户看（3→2→1），
     *    单 `setTimeout` 只能「到点开播」不能「显示倒计时」。
     * ⚠️ 用 **deadline 绝对时刻** 而不是递减计数：标签页被切走后 interval 会被节流，
     *    递减计数会少跳几秒；用 `Date.now()` 差值回到前台一次就对了。
     */
    private startCueShadowCountdown(): void {
        this.stopCueShadowTimer();
        this.cueShadowDeadline = Date.now() + this.cueShadowGap * 1000;
        const totalMs = this.cueShadowGap * 1000;
        const tick = (): void => {
            const left = shadowLeftMs(this.cueShadowDeadline, Date.now());
            const countEl = this.cueShadowBarEl?.querySelector('.rl-epp-cueshadow-count');
            countEl?.setText?.(shadowCountdownText(left));
            if (left <= 0) {
                this.stopCueShadowTimer();
                // 播下一句：先把播放头挪到下一句开头（当前句结尾 = 下一句开头附近）
                const next = this.cueActiveIdx >= 0 ? this.cueActiveIdx + 1 : -1;
                const nextCue = next >= 0 && next < this.cueCues.length ? this.cueCues[next] : null;
                if (nextCue) this.seekTo(nextCue.start);
                const v = this.videoElement();
                if (v) void v.play().catch(() => undefined);
            }
        };
        tick();
        this.cueShadowTimer = window.setInterval(tick, 200);
    }

    /**
     * 循环回跳（单句 / AB）。返回 `true` = 这一帧已经做了跳转，调用方应立即结束本次 tick。
     *
     * 🔴 区间来源有两条，⛔ 别混：
     *    · `cue` 档取**锁定的那一句**（`cueLoopIdx`），不是 `cueActiveIdx` —— 播放到句尾时
     *      `activeCueIndex` 已经找不到命中行返回 -1，拿它当区间会在句子播完那刻失去区间，
     *      表现就是「循环自己停了」（这是本功能最容易踩的坑）。
     *    · `ab` 档取 `cueAb`。
     *
     * ⚠️ `cueLoopSeeking` 是必需的：seek 落地前的下一次 tick 仍会读到越过终点的旧时间，
     *    不设标志就会连续 seek 好几帧（真机上表现为进度条抽搐）。
     */
    private applyCueLoop(at: number): boolean {
        if (this.cueLoopSeeking) return false;
        const locked = this.cueLoopIdx >= 0 && this.cueLoopIdx < this.cueCues.length ? this.cueCues[this.cueLoopIdx] : null;
        const range = loopRangeOf(this.cueLoop, locked, this.cueAb);
        if (!range) return false;
        const target = loopSeekTarget(this.cueLoop, at, locked, this.cueAb);
        if (target === null) return false;
        this.cueLoopSeeking = true;
        this.seekTo(target);
        // seek 落地后放开（150ms 足够本地 <video>；内嵌态由 `seekEmbedVideo` 自己保证时序）
        window.setTimeout(() => {
            this.cueLoopSeeking = false;
        }, 150);
        return true;
    }

    /**
     * 影子跟读：到句尾就暂停并起倒计时。返回 `true` = 这一帧已经暂停，调用方结束 tick。
     *
     * ⚠️ 已经在等倒计时（`cueShadowTimer !== null`）就直接 return true，⛔ 不要重复暂停
     *    —— 暂停期间 `timeupdate` 不再触发，但内嵌态的轮询 ticker 还在跑，会反复进来。
     */
    private applyCueShadow(at: number): boolean {
        if (!this.cueShadowOn) return false;
        if (this.cueShadowTimer !== null) return true;
        const idx = this.cueActiveIdx;
        const cue = idx >= 0 && idx < this.cueCues.length ? this.cueCues[idx] : null;
        if (!shadowShouldPause(true, at, cue)) return false;
        this.pauseVideo();
        this.startCueShadowCountdown();
        return true;
    }

    /**
     * 双击某行 ⇒ 把单句循环锁到这一行（再双击同一行 ⇒ 取消）。
     *
     * 🔴 用户 §3.3：「双击任意字幕行，该句左侧出现一个 🔁 图标，视频在句子首尾之间反复播放。
     *    再次双击取消。」⇒ 两个要点：
     *    ① 双击是**幂等开关**，不是「每次都设一句」；
     *    ② 锁定后马上 seek 到句首并开播 —— 用户双击的意图是「我要反复听这一句」，
     *       若只设区间不跳，他要等视频播到那句才生效，看起来就是「双击没反应」。
     */
    private toggleCueLoopAt(idx: number): void {
        const cue = this.cueCues[idx];
        if (!cue) return;
        if (this.cueLoop === 'cue' && this.cueLoopIdx === idx) {
            this.cueLoop = 'off';
            this.cueLoopIdx = -1;
            this.syncCueLoopBtn();
            this.markCueLoopRow();
            this.showToast('已取消单句循环');
            return;
        }
        this.cueLoop = 'cue';
        this.cueLoopIdx = idx;
        this.syncCueLoopBtn();
        this.markCueLoopRow();
        this.seekTo(cue.start);
        const v = this.videoElement();
        if (v) void v.play().catch(() => undefined);
        this.showToast(`🔁 单句循环：${formatStamp(cue.start)} ←→ ${formatStamp(cue.end)}`);
    }

    /**
     * 给锁定的那一行挂 🔁 标记（用户明确要求「该句左侧出现一个 🔁 图标」）。
     *
     * ⚠️ 用 class + CSS `::before` 而不是插节点：行会被重画/排序，插进去的节点要跟着搬，
     *    而 class 天然跟着行走。⛔ 别在 `renderCueRows` 里额外 push 一个子节点。
     */
    private markCueLoopRow(): void {
        for (let i = 0; i < this.cueRows.length; i++) {
            this.cueRows[i].toggleClass('is-loop', this.cueLoop === 'cue' && i === this.cueLoopIdx);
        }
    }

    /**
     * 悬停查词：给鼠标当前压着的那个词画气泡（用户 §3.1）。
     *
     * ⚠️ 本仓**没有**内置词典（ECDICT 是第三期的事）⇒ 这里只负责「认词 + 画气泡骨架 +
     *    发出查词请求」。宿主注入了 `pageCtx.lookupWord` 才显示释义；没注入时气泡只显示词形
     *    与发音按钮 —— ⛔ 绝不显示一个空的「释义：」占位（那看起来像坏了）。
     */
    private showWordTip(wordEl: HTMLElement, raw: string): void {
        if (!this.cueLearnOn) return;
        const key = lookupKey(raw);
        if (!isLookupable(key)) return;
        if (this.cueWordTipKey === key && this.cueWordTipEl) {
            this.positionWordTip(this.cueWordTipEl, wordEl);
            return;
        }
        this.hideWordTip();
        wordEl.addClass('is-hover');
        // 🔴 气泡挂 `document.body`，⛔ 不挂字幕面板：`position: fixed` 只对**视口**定位，
        //    但祖先链上任何 `transform` / `filter` / `will-change` 都会把它变成「相对那个祖先」，
        //    本仓的播放器容器有过这类变换（全屏、内嵌缩放）。挂 body 是唯一稳的位置。
        //    代价是它不随视图 DOM 回收 ⇒ `hideWordTip()` 与 `onClose()` 必须显式摘（已接）。
        const tip = document.body.createDiv({ cls: 'rl-epp-wordtip' });
        this.cueWordTipEl = tip;
        this.cueWordTipKey = key;
        tip.createDiv({ cls: 'rl-epp-wordtip-word', text: key });
        const lookup = this.pageCtx?.lookupWord;
        if (lookup) {
            const body = tip.createDiv({ cls: 'rl-epp-wordtip-def', text: '查询中…' });
            void lookup(key).then((r) => {
                if (this.cueWordTipEl !== tip) return; // 用户已经移开了
                body.setText(r?.def || '这个词暂时查不到释义');
                if (r?.phonetic) {
                    const ph = tip.createDiv({ cls: 'rl-epp-wordtip-ph', text: `/${r.phonetic}/` });
                    tip.insertBefore(ph, body);
                }
            });
        }
        // 🔊 发音：走系统 TTS（与基类朗读同一条通路，⛔ 不另起一套语音合成）
        const say = tip.createEl('button', { cls: 'rl-epp-wordtip-say', text: '🔊' });
        say.setAttribute('aria-label', `朗读 ${key}`);
        say.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try {
                const u = new SpeechSynthesisUtterance(key);
                window.speechSynthesis.speak(u);
            } catch {
                /* 无 TTS 的环境静默失败，⛔ 不打断学习 */
            }
        });
        // 🔴 气泡自身也要能留住鼠标：挂在 body 上 + `mouseout` 判 `relatedTarget` 之后，
        //    从词移到气泡里不会被立刻收掉（见 `renderCueRows` 里 mouseout 的注释）；
        //    这里再补「移出气泡 ⇒ 收」的出口，否则气泡会一直挂在屏幕上挡字幕。
        tip.addEventListener('mouseleave', () => this.hideWordTip());
        this.positionWordTip(tip, wordEl);
    }

    /**
     * 把气泡放到词的正上方（越界就往回收，⛔ 不让它跑出视口）。
     *
     * 🔴 坐标必须是**视口坐标**，不是宿主相对坐标：气泡的 CSS 是 `position: fixed`
     *    （理由见 `styles.css` 那段注释 —— 字幕列表是独立滚动容器，absolute 会被 `overflow` 裁掉）。
     *    `getBoundingClientRect()` 返回的本来就已是视口坐标，所以直接用 `wb.left/wb.top`，
     *    再用 `window.innerWidth/innerHeight` 收边。
     * ⚠️ 用 `tip.offsetWidth/offsetHeight` 而不是 `getBoundingClientRect()` 量自己：
     *    气泡刚建出来还没定位，`rect` 会带上此刻的 (0,0) 位置信息，虽然宽高是对的，
     *    但 `offset*` 语义更单纯，也避免了在测量里引入「自己相对自己」的读数。
     */
    private positionWordTip(tip: HTMLElement, wordEl: HTMLElement): void {
        const wb = wordEl.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 默认放词的正上方；上方空间不够就翻到下方
        let top = wb.top - th - 6;
        if (top < 6) top = wb.bottom + 6;
        if (top + th > vh - 6) top = Math.max(6, vh - th - 6);
        // 左对齐到词的左边，再收进视口
        let left = wb.left;
        if (left + tw > vw - 6) left = Math.max(6, vw - tw - 6);
        if (left < 6) left = 6;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    /** 收起查词气泡（幂等） */
    private hideWordTip(): void {
        this.cueWordTipEl?.remove();
        this.cueWordTipEl = null;
        this.cueWordTipKey = '';
        this.cueToolsEl?.parentElement
            ?.querySelectorAll('.rl-epp-cueword.is-hover')
            .forEach((el) => (el as HTMLElement).removeClass('is-hover'));
    }

    /**
     * 当前这一集的标题（喂给 AI 做上下文定位；拿不到 ⇒ 空串）。
     * ⚠️ 网络集走 `pageCtx.titles`，本地集走基类 `epLabel`；两条都不是「集号」而是**集名**——
     *    AI 需要的是「这一集是什么」而不是「第几集」，所以这里返回标题文本。
     */
    private currentEpisodeLabel(): string {
        const idx = this.netIndex !== null ? this.netIndex : this.currentEpisodeIndex();
        const t = String(this.pageCtx?.titles?.[idx] ?? '').trim();
        if (t) return t;
        // ⚠️ `currentEpisodeIndex()` 在一集都没有/还在解析时会回 `-1`，
        //    直接 `+1` 会得到字符串 "0" —— 那是个不存在的集号，会当成 chip 显示出去。
        //    真机踩过（`tools/probe-cue-ai3.cjs` 的 chipTexts 里冒出 "0"）⇒ 宁可返回空串。
        return idx >= 0 ? String(idx + 1) : '';
    }

    /** 当前挂载字幕的语言标签（喂给 AI 说明原文语种；没有 ⇒ 空串） */
    private currentSubtitleLang(): string {
        const snap = this.subtitleSnapshot();
        const hit = snap.candidates.find((c) => c.fileName === snap.file);
        return hit?.lang ?? '';
    }

    /**
     * 当前片名（连同网络集的集名一起拼）。
     * 🔴 为什么不用 `entryTitle()` 一个：网络集的 AI 需要知道「这是哪一集」，
     *    而 `entryTitle()` 只是条目名（所有集都一样）⇒ 会退化成「同一部片名总结 N 遍」。
     * ⚠️ 集名优先级：`pageCtx.titles`（库里登记的集名）> 播放器标题元素 > 条目名。
     */
    private netTitleText(): string {
        const idx = this.netIndex !== null ? this.netIndex : this.currentEpisodeIndex();
        const part = String(this.pageCtx?.titles?.[idx] ?? '').trim();
        const base = this.entryTitle().trim();
        return part && part !== base ? `${base} ${part}`.trim() : base;
    }

    /**
     * 面板 cue 的来源键：换集 / 换字幕 / 手动导入任一变化都要重解析。
     *
     * 🔴 2026-11-06 用户报障「怎么每集共用一个集的字幕文件啊」（网络集也指向同一份）。
     *    根因就在这里：键里用的是 `currentEpisodeIndex()` —— 那是**组件库 items 里的真实集**，
     *    而 B 站内嵌态根本不移动 `cur`（网络集没有本地文件、进不了 items）。
     *    ⇒ 所有网络集算出来的键完全相同（`imp::<同一个下标>::<同名文件>`），
     *      `syncCueSource()` 开头 `key === this.cueSrc` 直接早退，
     *      面板就**一直停在第 1 个网络集的字幕上**。
     *    ⛔ 不能改回 `currentEpisodeIndex()`：同文件里 `currentEpisodeLabel()` / `netTitleText()` /
     *      `activeCellIndex()` 三处早就踩过同一个坑并改成了 `netIndex ?? …`，这里是第四个。
     */
    private cueKey(): string {
        return cueSourceKey({
            episodeIndex: this.activeCellIndex(),
            importedFileName: this.cueImported?.fileName ?? null,
            subtitleFileName: this.subtitleFileName() ?? null,
        });
    }

    /**
     * 把面板的 cue 同步到「当前集 + 当前字幕」。
     * 🔴 文本走基类 `subtitleRawText()`（它与 `applySubtitle` 同一份定位口径，且自带缓存）——
     *    在 `timeupdate` 那种频率上重读文件会把磁盘打成筛子，所以这里**只在来源键变化时**读一次。
     */
    private async syncCueSource(): Promise<void> {
        const key = this.cueKey();
        if (key === this.cueSrc) {
            this.renderCueRows();
            return;
        }
        this.cueSrc = key;
        this.cueCues = [];
        this.cueActiveIdx = -1;
        this.cueLoading = false;
        // 🔴 换集 / 换字幕 ⇒ 上一份 AI 总结立刻作废（见 `cueAiSrc` 注释：挂着别的集的总结
        //    比不显示更糟）。⛔ 不在这里重新请求——用户没点就不该烧 key。
        this.resetCueAi();

        const imported = this.cueImported;
        const baseFile = this.subtitleFileName();
        if (!imported && !baseFile) {
            this.renderCueRows();
            return;
        }

        this.cueLoading = true;
        this.renderCueRows();
        let text: string | null = imported ? imported.text : await this.subtitleRawText();
        // 异步读文件期间可能已换集 / 换字幕 ⇒ 结果作废
        if (this.cueSrc !== key) return;
        // `.ass/.ssa` 走 `parseAssCues`（按扩展名选解析器），其余按 VTT/SRT 解析
        this.cueCues = text ? parseSubtitleText(text, imported ? imported.fileName : baseFile ?? '') : [];
        this.cueLoading = false;
        this.renderCueRows();
        this.locateCue();
    }

    /** 手动导入字幕（`.srt / .vtt / .ass / .ssa`）：只喂面板，⛔ 不改基类的 <track> 挂载态 */
    private async importCueFile(): Promise<void> {
        const got = await this.importCueSubtitle();
        if (!got) return;
        this.cueImported = got;
        this.cueImportedManual = true; // 用户手动选的：之后自动抓的一律让路
        this.cueSourceTag = 'manual';
        this.cueSrc = null; // 强制重解析
        void this.syncCueSource();
        this.syncCueTools(); // 来源标识要跟着换（手动导入 ⇒ 显示「本地」）
    }

    /** 取一份手动导入的字幕原文（宿主回调优先；没有就退回基类的系统选择器） */
    private async importCueSubtitle(): Promise<{ fileName: string; text: string } | null> {
        const fn = this.pageCtx?.importCue;
        if (fn) {
            try {
                return await fn();
            } catch {
                return null; // 宿主读文件炸了 ⇒ 当作取消（⛔ 不把异常弹到面板里）
            }
        }
        // 兜底：宿主没注入时走基类既有的「选择字幕文件」（.srt/.vtt），⛔ 不另写一套选择器
        this.browseSubtitle();
        return null;
    }

    /**
     * 当前播放位置。
     *
     * 🔴 2026-11-10 更正：官方内嵌态过去被**整个跳过**，理由写的是「跨域 iframe 读不到
     *    `currentTime`」—— 那是**猜的**，真机已证伪（`services/embedVideo`：`framesInSubtree`
     *    进子帧 `executeJavaScript`，读写 `currentTime` 都通）。现在内嵌态走 `embedTime`。
     * ⚠️ 但桥没读到值时必须返回 `null`（调用方一行都不点亮）—— 假时间轴比没有时间轴更糟。
     */
    private cueTimeNow(): number | null {
        // 2026-11-24：网络集只剩官方 iframe ⇒ 网络态恒为「进子帧读播放头」这一条路
        if (this.isNetMode()) {
            return this.embedTimeOk ? this.embedTime : null;
        }
        const v = this.cueVideo();
        return v && Number.isFinite(v.currentTime) ? v.currentTime : null;
    }

    /**
     * 播放联动：当前行高亮 + 跟随滚动。
     * 🔴 下标没变就一个 DOM 都不碰（`timeupdate` 每秒约 4 次，白刷会让列表反复重排）。
     */
    private onCueTick(): void {
        const v = this.cueVideo();
        // 🔴 微件刷新要放在**字幕早退之前**：没有字幕的片子 `cueRows` 是空的，
        //    早退后微件的进度环就再也不动了（曾经踩过的坑）。
        //    ⚠️ 只在「进度环百分比真的变了」时才重画 —— `timeupdate` 约 4Hz，
        //      每秒重画 4 次 DOM 文本没必要，百分比按整数比较就够（100 档）。
        if (v) {
            const pct = Math.round(this.episodeRatio() * 100);
            if (pct !== this.widgetPct) {
                this.widgetPct = pct;
                this.widgetRefs?.render();
            }
        }
        // 🔴 拿不到播放头就**一行都不点亮**：点亮一行 = 声称「播到这里了」。
        //    内嵌态若桥还没读到值（`embedTimeOk` 为假）必须停在这里，否则会把第一行永远点亮。
        const at = this.cueTimeNow();
        if (at === null || this.cueRows.length === 0) return;

        // 🔴 循环与服务必须排在**高亮之前**：它们要拿「当前这一刻」判断该不该回跳/暂停，
        //    若先算完高亮再跳，这一帧会先点亮下一句再跳回上一句 —— 用户看到的是「每轮闪一下下一句」。
        if (this.applyCueLoop(at)) return;
        if (this.applyCueShadow(at)) return;

        const idx = activeCueIndex(this.cueCues, at);
        if (idx === this.cueActiveIdx) {
            // 🔴 用户 m12123：「怎么有单个字高亮的去掉仅高亮当前句」
            //    ⇒ 行没变时**什么都不做**。原来这里会调 `syncCueWord(at)` 在行内推进词级高亮，
            //    而中文会被 `splitTimingUnits` 切成单字 ⇒ 一行里永远只亮一个字，
            //    看起来像「第一个字被单独染色」。现在整行 `is-on` 是唯一的高亮表达。
            return;
        }
        this.cueActiveIdx = idx;
        for (let i = 0; i < this.cueRows.length; i++) {
            this.cueRows[i].toggleClass('is-on', i === idx);
        }
        if (idx >= 0) this.scrollCueTo(idx);
        this.rebuildCueWords();
    }

    /**
     * 把当前高亮行拆成一串词 span。
     *
     * 🔴 用户 m12123：「怎么有单个字高亮的去掉仅高亮当前句」
     *    ⇒ 这个函数**不再负责点亮任何词**，只负责一件事：给学习模式的悬停查词提供可命中的词节点
     *    （`showWordTip` / `hideWordTip` 靠 `closest('.rl-epp-cueword')` 找词）。
     *    ⛔ 别把「点亮当前词」加回来 —— 中文被切成单字后，一行只亮一个字，观感就是「单字高亮」。
     *    ⚠️ 也正因为只在学习模式拆：拆开会让文字重新折行、行高变化，非学习模式没必要付这个代价。
     */
    private rebuildCueWords(): void {
        const row = this.cueActiveIdx >= 0 ? this.cueRows[this.cueActiveIdx] : null;
        const cue = this.cueActiveIdx >= 0 ? this.cueCues[this.cueActiveIdx] : null;
        const textEl = row?.querySelector<HTMLElement>('.rl-epp-cuetext');
        if (!row || !cue || !textEl) {
            return;
        }
        // 非学习模式：保持整行纯文本（🔴 这是 m12123 之后的默认路径）
        if (!this.cueLearnOn) {
            // 从学习模式退出来时，行里可能还留着上次拆出的词 span ⇒ 换回纯文本
            // （有 `is-hover` 之类残留也不该留在非学习模式里）
            if (textEl.querySelector('.rl-epp-cueword')) {
                textEl.textContent = cue.text;
                this.scrollCueTo(this.cueActiveIdx);
            }
            return;
        }
        const words = wordSpansFor(cue.text, cue.start, cue.end, cue.words);
        if (!words.length) {
            // 没有词级信息（超长行 / 时长异常）⇒ 保持整行文本，⛔ 不硬拆成一个个 span
            return;
        }
        const frag = document.createDocumentFragment();
        for (const w of words) {
            const span = document.createElement('span');
            span.className = 'rl-epp-cueword';
            // ⚠️ 原文里的空格要留住：`splitTimingUnits` 已把空格并进单位，
            //    这里再 trim 会把 "hello world" 粘成 "helloworld"。
            span.textContent = w.text;
            frag.appendChild(span);
        }
        textEl.empty();
        textEl.appendChild(frag);
        // 拆完文字可能重新折行 ⇒ 高亮行的高度变了，锁定态要重新对位
        this.scrollCueTo(this.cueActiveIdx);
    }

    /** 把第 idx 行送到它该在的位置：锁定态 = 钉在容器第 N 行；非锁定 = 只需保持在可视区 */
    private scrollCueTo(idx: number): void {
        const list = this.cueListEl;
        const row = this.cueRows[idx];
        if (!list || !row) return;
        // 用户手动滚动过 ⇒ 一律不自动滚（⛔ 和用户操作打架）
        if (!this.cueFollow) return;
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        if (this.cueMode === 'lock') {
            const rowH = this.cueRows[0]?.offsetHeight ?? 0;
            // ⛔ 锁定态也别用 `offsetTop`（`list` 是 static，它相对最近定位祖先，差出 250px 级）
            const base = list.getBoundingClientRect().top - list.scrollTop;
            const tops = this.cueRows.map((r) => r.getBoundingClientRect().top - base);
            // 🔴 用户 2026-11-09：「锁定时间轴应该在一屏显示中位固定，而不是在第二行」
            //    ⇒ 钉在第几行由**容器可视高 / 行高**算出来，⛔ 不再写死 `LOCK_LINE_INDEX`。
            const lockLine = lockLineFor(list.clientHeight, rowH);
            this.setCueScroll(lockScrollTop(tops, rowH, idx, lockLine, max));
            return;
        }
        // 非锁定态：用 rect 差值算容器内偏移（⛔ 不拿 `offsetTop` 猜 —— 它是相对最近**定位**祖先的）
        const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
        const bottom = top + row.offsetHeight;
        const view = list.clientHeight;
        // 🔴 用户 2026-11-09 逐字：「跟随模式每翻一页应该从第一行开始滚动到最后一行」
        //    ⇒ 语义是**翻页**，不是「贴边跟随」：
        //      ① 高亮行从可视区**第一行**起步，之后每换一行就往下走一格（画面不动）；
        //      ② 走到**最后一行**再往下 ⇒ 翻页 —— 把该行送到第一行，重新开始下行。
        //    ⛔ 两种错法都试过并各自被实测否掉（`tools/_diag-follow.mjs` 取证）：
        //      · 一出界就居中 —— 高亮行钉死在中间，看不出下行的节奏；
        //      · 出界就贴住底边（停在最后一行）—— `rowTopInView` 恒为 162 = viewH-rowH，
        //        只有第一页在动，之后画面再也不翻，等于「滚动停住」。
        //    只有「越界 ⇒ 回第一行」才同时满足「逐行下行」和「到页底才翻」。
        if (bottom > list.scrollTop + view || top < list.scrollTop) {
            this.setCueScroll(Math.min(max, Math.max(0, top)));
        }
    }

    /**
     * 程序化滚动。⛔ 不能「打标记 → rAF 清标记」：`scroll` 事件是异步派发的，可能排在 rAF 之后，
     * 标记先撤、事件后到 ⇒ 自己的滚动被当成用户手动滚，跟随被永久关掉（真机复现过）。
     * ⇒ 记**目标队列**，由随后的 `scroll` 事件逐个消费。
     *
     * 🔴 用户 2026-11-08：「音乐播放器和字幕面板的滚动改要有动效而不是瞬间切换」
     *    ⇒ 从「直接赋值 `scrollTop`」改成 `scrollTo({ behavior: 'smooth' })`。
     *    ⚠️ 平滑滚动会派发**一串**中间帧 scroll 事件，位置逐个逼近目标、**不会**精确等于目标。
     *    这些中间帧为什么不会误关跟随：`onCueScroll` 的第一道判据（±2 命中队列）确实判不中，
     *    但它第二道判据 `Date.now() - cueUserInputAt > 350` 会直接 return ——
     *    程序滚动的中间帧旁边没有任何真实输入（滚轮/拖动都不碰），所以安全。
     *    ⛔ 别为了「让中间帧判中」去放宽 ±2：那样真实用户滚到目标附近也会被判成程序滚动，
     *    「手动滚动打断跟随」就失灵了。
     */
    private setCueScroll(top: number): void {
        const list = this.cueListEl;
        if (!list) return;
        const before = list.scrollTop;
        // 队列只保留最近几次（连滚两次最多两个在途事件，多留几个防抖动）
        this.cueProgTos.push(top);
        if (this.cueProgTos.length > 6) this.cueProgTos.splice(0, this.cueProgTos.length - 6);
        // prefers-reduced-motion ⇒ 退回瞬时跳转，别跟用户的系统设置较劲
        const behavior: ScrollBehavior = scrollBehavior();
        list.scrollTo({ top, behavior });
        // 位置没变 ⇒ 浏览器不会派发 scroll，这条目标自己作废。
        // 🔴 比的是**赋值前后**，不是「赋值后是否等于目标」——后者在滚动成功时也为真，会把标记立刻清掉。
        // ⚠️ 只在 `auto` 分支判：平滑滚动的 `scrollTop` 在 `scrollTo` 之后**不会同步变化**
        //    （它按帧推进），拿 `before` 比必然相等 ⇒ 会把刚压进去的目标立刻摘掉，队列白记。
        if (behavior === 'auto' && list.scrollTop === before) {
            const i = this.cueProgTos.lastIndexOf(top);
            if (i >= 0) this.cueProgTos.splice(i, 1);
        }
    }

    /**
     * 用户手动滚动 ⇒ 暂停自动跟随（恢复只走「定位当前行」）。
     * 🔴 归属判定走**双判据**，缺一不可：
     *  ① 位置命中在途目标队列 ⇒ 是我自己的滚动，直接放行；
     *  ② 否则必须**紧跟在真实输入事件之后**（滚轮/拖条/触摸/键盘）才算用户滚的。
     *  否则一切来路不明的 scroll（容器尺寸变化、字体回流、夹取回调）都不许打断跟随。
     */
    private onCueScroll(): void {
        // ⛔ 这里原来第一行是 `this.syncCueMapThumb();`（mini-map 指示条跟随滚动）。
        //    用户 m12123 要求整条 mini-map 去掉后，那根条不存在了 ⇒ 该调用一并删除。
        //    ⚠️ 下面两条 early-return 的语义**没变**，别因为删了这行就顺手改动它们。
        const list = this.cueListEl;
        if (list && this.cueProgTos.length > 0) {
            const pos = list.scrollTop;
            const hitAt = this.cueProgTos.findIndex((t) => Math.abs(pos - t) <= 2);
            if (hitAt >= 0) {
                // ⛔ 不能整队清空：同一轮可能还有另一个在途事件要认领
                this.cueProgTos.splice(hitAt, 1);
                return;
            }
        }
        if (!this.cueFollow) return;
        // 没有真实输入在先 ⇒ 不是我发的，也**不判**成用户滚（宁可不动，也不误杀手动跟随）
        if (Date.now() - this.cueUserInputAt > 350) return;
        this.cueFollow = false;
        this.syncCueTools();
    }

    /**
     * 跳转：本地/网络流走基类既有链路；**官方内嵌走 `services/embedVideo` 往子帧写 `currentTime`**。
     *
     * 🔴 2026-11-05 改：网络流现在就跑在基类 `videoEl` 上（`playNetStream()`），
     *    `super.seekTo` → `applySeek` 的夹取（`clampSeek` 对 `Infinity` 时长返回原值）、
     *    自动播放、「已跳到 mm:ss」toast 全都直接适用。
     * 🔴 2026-11-10 加内嵌分支：这里原本写「`seekTo` 要往 iframe 里写 currentTime，跨域根本
     *    写不进去」—— 那是**猜的**，真机已证伪（写 `v.currentTime = 12` 真的生效）。
     *    ⚠️ 但 `super.seekTo` 在内嵌态只会去动那颗空壳 `<video>`，⛔ 不能两头都写。
     */
    protected seekTo(seconds: number): void {
        // 2026-11-24：网络集只剩官方 iframe ⇒ 网络态只能往子帧里写 currentTime
        if (this.isNetMode()) {
            const src = this.netFrameEl?.getAttribute('src') ?? '';
            if (src) {
                void seekEmbedVideo(src, seconds).then((ok) => {
                    if (!ok) return;
                    this.embedTime = seconds;
                    this.embedTimeOk = true;
                    this.onCueTick();
                });
                return;
            }
        }
        super.seekTo(seconds);
        this.onCueTick();
    }

    /** 「定位当前行」/ 锁定切换后：按当前播放位置重新点亮并滚到正确位置 */
    private locateCue(): void {
        const at = this.cueTimeNow();
        if (at === null) return;
        const idx = activeCueIndex(this.cueCues, at);
        this.cueActiveIdx = idx;
        for (let i = 0; i < this.cueRows.length; i++) {
            this.cueRows[i].toggleClass('is-on', i === idx);
        }
        if (idx >= 0) this.scrollCueTo(idx);
        this.rebuildCueWords();
    }

    /** 给视频挂 `timeupdate`：换片重建后 video 元素会换人 ⇒ 只按「元素是否是同一个」判断重绑 */
    private bindCueTicker(): void {
        const v = this.cueVideo();
        if (!v || v === this.cueVideoEl) return;
        this.cueVideoEl = v;
        v.addEventListener('timeupdate', () => this.onCueTick());
    }

    /**
     * 当前**真正在播**的那颗 `<video>`。
     *
     * 🔴 2026-11-05 起网络流也跑在基类 `videoEl` 上 ⇒ 这里只剩一个来源，不再有「内嵌态认另一颗」的分支。
     *    历史教训保留：别改成「两个都监听」—— 两颗 video 同时 `timeupdate` 会互相抢高亮。
     */
    private cueVideo(): HTMLVideoElement | null {
        return this.videoElement();
    }

    /** 选集区：分段条 + 集格（列表 / 封面两种画法，同一份数据） */
    private syncCells(): void {
        const body = this.cellsBodyEl;
        const ctx = this.pageCtx;
        if (!body || !ctx) return;
        body.empty();
        if (this.rangesEl) this.rangesEl.empty();
        // 🔴 重画前先断开封面观察器：旧格子马上就会随 `empty()` 消失，
        //    不断开的话它们仍挂在观察队列里继续排队发请求（52 集翻几页就把接口打成筛子）。
        //    观察器本身**保留**（`coverIo` 只建一次，重建要重新分配 IO 资源）。
        this.coverPending.clear();
        this.coverIo?.disconnect();

        // 🔴 换集/翻页/换序都会走到这里 ⇒ 微件要跟着重画（当前集号、系列进度）。
        //    ⚠️ 先把百分比缓存清成 -1：否则新集第一次 `timeupdate` 的百分比若与上一集末尾相同，
        //      会被 `onCueTick` 的「未变化就跳过」挡掉，进度环停在上一个数字上。
        this.widgetPct = -1;
        this.widgetRefs?.render();

        // 🔴 用户 2026-10-29 加了「正序/倒序」开关：**先整份排序再分页**。
        //    只反转当页的话，第 0 页是 52→3、第 1 页又跳回 2→1 的大数，读起来像乱序。
        const cells = orderCells(
            episodeCells({
                files: ctx.files,
                urls: ctx.urls,
                titles: ctx.titles,
                statuses: ctx.statuses,
                // 当前集 = 真实集下标（`items[].index`），不是 `items` 数组位
                // ⚠️ 内嵌态必须认 `netIndex`，否则高亮停在上一集（见 `activeCellIndex`）
                currentIndex: this.activeCellIndex(),
                total: ctx.total,
                single: this.isSingle(),
            }),
            this.cellsOrder,
        );
        const size = EPISODE_PAGE_SIZE;
        const pages = Math.max(1, Math.ceil(cells.length / size));
        const page = Math.min(pages - 1, Math.max(0, this.cellsPage));
        const [start, end] = pageSlice(page, cells.length, size);

        // 分段条：画当前这一段（以及其它段）
        // 🔴 用户 2026-10-27：「1-50 这分区仅显示文字」⇒ 渲染成纯文本，⛔ 不是按钮（不再有按钮底/边框）
        // 🔴 用户 2026-10-29：文案改由 `pageRangeLabel()` 从**这一页首尾格的真实集号**算 ——
        //    倒序时按数组位算会写成「1-50」却显示着 52→3 的格子（明着骗人）。
        // 🔴 用户 m02255（2026-11-10）：「不足 50 集也显示 1-20」⇒ 取消原来的 `pages > 1` 门槛。
        //    段长仍是 `EPISODE_PAGE_SIZE`（50），只有 1 页时 `pageBarItems(1, 0)` 返回 `[1]`，
        //    这一格就是「1-N」（N = 总集数），用户能一眼看到本节覆盖的集号区间。
        //    ⚠️ ⛔ 别再退回「只有多段才画」：那样 12 集的剧集整条分段标是空的，看着像功能没了。
        //    🔴 判据已收口到 `pure/episodePage.rangeBarVisible()` —— 视图这层不再内联写条件，
        //       否则「改回 pages > 1」单测摸不到（视图层不进 vitest）。
        if (this.rangesEl && rangeBarVisible(cells.length)) {
            for (const item of pageBarItems(pages, page)) {
                if (item === '…') {
                    this.rangesEl.createSpan({ cls: 'rl-epp-range is-gap', text: '…' });
                    continue;
                }
                const p = item - 1;
                const on = p === page;
                const [ps, pe] = pageSlice(p, cells.length, size);
                const span = this.rangesEl.createSpan({
                    cls: on ? 'rl-epp-range is-on' : 'rl-epp-range',
                    text: pageRangeLabel(cells, ps, pe),
                });
                // 当前段不可点（已经在这一段，点了也是重画一遍）
                if (on) continue;
                span.addEventListener('click', () => {
                    this.cellsPage = pageStep(page, pages, p - page);
                    this.syncCells();
                    // 🔴 用户 2026-10-29：「点击区间 → smooth 居中」。
                    //    ⚠️ 必须在 `syncCells()` **之后**再找一次元素：那次调用会把整条分段条
                    //    `empty()` 重建，闭包里捕获的 `span` 此刻已脱离文档，`scrollIntoView` 无效。
                    //    ⚠️ `block: 'nearest'`：只做横向居中，⛔ 不让档签把外层页面纵向滚一下
                    //    （默认 `block: 'start'` 会把选集区顶到视口顶，用户眼前内容整体跳一下）。
                    const fresh = this.rangesEl?.querySelector<HTMLElement>('.rl-epp-range.is-on');
                    fresh?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                });
            }
        }

        body.toggleClass('is-grid', this.cellsMode === 'grid');
        for (const cell of cells.slice(start, end)) this.buildCell(body, cell);

        // ③ 单集评价面板跟着「当前集」走。
        //    🔴 放在这里而不是 `openCell()`：网络集内嵌那条路**根本不走 `openCell`**
        //    （见 `activeCellIndex()` 的注释），挂在 `openCell` 上就会出现「换到第 4 集，
        //    评价面板还写着第 1 集」。`syncCells` 是换集/翻页/换序的唯一收口，挂这儿才不漏。
        this.syncReviewPanel();
    }

    /**
     * 单格，两态共用同一份 `EpisodeCell`，⛔ 不各算一遍：
     *  - `list` 态 = **一行一集的横向行**：左封面缩略图 + 「第 N 集」 + 下一行小标题；
     *  - `grid` 态 = **纯数字按钮**：只有一个集数（标题进 `data-tip` 悬浮提示）。
     *
     * 🔴 用户 2026-10-29 裁定（第二次，以这次为准）：
     *    「列表是为左封面+集数(第1集)+小标题一行行的…按钮是如 1、2、3 的纯按钮」。
     *    ⛔ 上一版把 `list` 画成数字格、`grid` 画成封面卡，正好反了，被当场驳回。
     *    两个字段都留着（`rl-epp-cellcov` / `rl-epp-cellno` / `rl-epp-cellttl`），
     *    靠 CSS 的 `.is-grid` 去决定「横排还是列排、有没有封面槽」，JS 只管内容齐全。
     */
    private buildCell(body: HTMLElement, cell: EpisodeCell): void {
        const cls = ['rl-epp-cell'];
        if (cell.cur) cls.push('is-cur');
        if (!cell.linked) cls.push('is-dead');
        else if (cell.dead) cls.push('is-dead');
        else if (!cell.local) cls.push('is-net');
        // ③ 单集评价的视觉区分（用户 m00002：「有高光/槽点标签的选集在选集网格上用流光/崩坏特效」）
        //    ⚠️ 判据**只**认 `pure/episodeReview.episodeCellEffect`（高光优先、`plain` 与无标签不出特效），
        //        ⛔ 别在这里自己读 `tags.includes(...)` —— 两套判据必然漂移
        //        （而且「高光和槽点同时打」这种边界只能有一处说得清）。
        //    ⚠️ 特效类与 `is-net`/`is-dead` **可以共存**：网络集看完了照样该闪，
        //        色相由 CSS 层各自承担（`.is-dead` 压灰度、特效层叠在最上面）。
        const fx = episodeCellEffect(reviewAt(this.reviewMap, cell.index));
        if (fx) cls.push(fx === 'highlight' ? 'is-fx-highlight' : 'is-fx-flaw');
        const el = body.createDiv({ cls: cls.join(' ') });
        el.setAttribute('data-index', String(cell.index));

        if (this.cellsMode === 'list') {
            // 列表态：左封面 + 右侧两行文字（集数在上、小标题在下）
            // 封面位：有图用图（宿主没给逐集封面 ⇒ 只画占位块，⛔ 别去猜路径）
            this.watchCover(el, el.createDiv({ cls: 'rl-epp-cellcov' }), cell.index);
            const meta = el.createDiv({ cls: 'rl-epp-cellmeta' });
            meta.createDiv({ cls: 'rl-epp-cellno', text: cell.label });
            if (cell.title) {
                // 标题缺省时不画空行（否则每行底下多一道 14px 的空白，白占高度）
                meta.createDiv({ cls: 'rl-epp-cellttl', text: cell.title });
                // 长标题省略号之外，再给一条悬浮提示兜底全文
                el.setAttribute('data-tip', cell.title);
            }
            el.addEventListener('click', () => this.openCell(cell));
            return;
        }
        // 按钮态：⛔ 不画封面槽（取不到图时是一格白块）、⛔ 不画标题行（会把 34px 的格子顶开）
        el.createDiv({ cls: 'rl-epp-cellno', text: String(cell.index + 1) });
        if (cell.title) el.setAttribute('data-tip', cell.title);
        el.addEventListener('click', () => this.openCell(cell));
    }

    /**
     * 逐集封面：一格一观察，**滚进视野才问宿主**（52 集里屏幕只看得到十几格）。
     *
     * 🔴 与 `EpisodePickerModal.watchCover` 同一条路（直接复用 `main.epCoverFor`）：
     *    宿主没注入 / 环境没有 `IntersectionObserver` ⇒ 就地占位，⛔ 不显示破图。
     * ⚠️ 计划到手时这一格可能已被重画（翻页 / 切模式）⇒ `isConnected` 兜底，⛔ 别往空气里画。
     */
    private watchCover(row: HTMLElement, cov: HTMLElement, idx: number): void {
        const ask = this.pageCtx?.episodeCover;
        if (!ask) {
            this.paintCoverPlaceholder(cov);
            return;
        }
        const io = this.ensureCoverIo();
        if (!io) {
            this.slotCover(cov, idx);
            return;
        }
        this.coverPending.set(row, { cov, idx });
        io.observe(row);
    }

    /** 观察器（惰性建一次）；`syncCells` 重画前会断开并清空（见 `syncCells` 开头） */
    private ensureCoverIo(): IntersectionObserver | null {
        if (this.coverIo) return this.coverIo;
        if (typeof IntersectionObserver !== 'function') return null;
        this.coverIo = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    const hit = this.coverPending.get(e.target);
                    this.coverIo?.unobserve(e.target);
                    this.coverPending.delete(e.target);
                    // 只认还在文档里的格子（重画过的旧节点已经 `isConnected === false`）
                    if (hit && hit.cov.isConnected) this.slotCover(hit.cov, hit.idx);
                }
            },
            // 预取余量：快滚到时先把请求发出去（是「可视区域的余量」，⛔ 不是全量预取）
            { root: null, rootMargin: '160px 0px' },
        );
        return this.coverIo;
    }

    /**
     * 向宿主要这一集的封面计划：先骨架屏，计划到手再画。
     *
     * 🔴 三条纪律（上一版的空白格就是这三条都没做到）：
     *   ⑴ **命中缓存立即画** —— 翻页/切模式回来的格子不该再等一次异步；
     *   ⑵ **在途请求复用** —— 同一下标正在路上时，新节点挂到同一条 Promise 上，⛔ 不重复打接口；
     *   ⑶ **脱稿不丢结果** —— 结果先落 `coverPlans` 缓存，节点已脱离文档只是「这次不画」，
     *      下次重画按 ⑴ 立刻补上，⛔ 不会永久空白。
     */
    private slotCover(cov: HTMLElement, idx: number): void {
        const ask = this.pageCtx?.episodeCover;
        if (!ask) {
            this.paintCoverPlaceholder(cov);
            return;
        }
        const cached = this.coverPlans.get(idx);
        if (cached) {
            this.drawCover(cov, cached);
            return;
        }
        // 在途的复用，否则发一条新的（⛔ 用 `cancel` 之外的任何标记都可能让两条并发打同一集）
        let task = this.coverInflight.get(idx);
        if (!task) {
            let plan: EpCoverPlan | Promise<EpCoverPlan>;
            try {
                plan = ask(idx);
            } catch {
                plan = { kind: 'none' }; // 宿主解析炸了 ⇒ 占位图（⛔ 不让封面把整页搞崩）
            }
            task = Promise.resolve(plan).catch((): EpCoverPlan => ({ kind: 'none' }));
            this.coverInflight.set(idx, task);
            // 计划落地就进缓存并摘掉在途标记（⛔ 失败也缓存：取不到就是取不到，别每次重画都重打）
            void task.then((p) => {
                this.coverPlans.set(idx, p);
                this.coverInflight.delete(idx);
            });
        }
        cov.addClass('is-load'); // 骨架屏
        void task.then((p) => {
            // 节点可能已被重画（翻页/切模式）⇒ 这一次不画，但计划已在缓存里，重画时会立即补上
            if (cov.isConnected) this.drawCover(cov, p);
        });
    }

    /**
     * 画封面：`img` / `video`（本地首帧）/ 统一占位图。
     * ⚠️ `video` 的 `preload="metadata"` 是**必须**的：只读元数据让浏览器解出首帧当封面；
     *    ⛔ 不自动播放、不带控件 —— 这一格只是封面，点它仍然是「切到这一集」。
     */
    private drawCover(cov: HTMLElement, plan: EpCoverPlan): void {
        cov.removeClass('is-load');
        cov.removeClass('is-ph');
        // 重画/补画时先清空：同一格可能已经有骨架屏残留的子节点
        cov.empty();
        if (plan.kind === 'img') {
            const img = cov.createEl('img', { cls: 'rl-epp-cellimg' });
            img.src = plan.src;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            // 🔴 破图必须回落占位图：本地文件被移走 / 网络缩略图 404 时，浏览器只会留一个
            //    破图标（用户看到的就是「封面没加载出来」），⛔ 不能指望计划侧一定给得对。
            img.addEventListener('error', () => {
                if (cov.isConnected) this.paintCoverPlaceholder(cov);
            });
            return;
        }
        if (plan.kind === 'video') {
            const v = cov.createEl('video', { cls: 'rl-epp-cellvid' });
            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;
            v.src = plan.src;
            // 解不出来（编码不支持 / 文件被移走）⇒ 就地回落占位图
            v.addEventListener('error', () => {
                if (cov.isConnected) this.paintCoverPlaceholder(cov);
            });
            return;
        }
        this.paintCoverPlaceholder(cov);
    }

    /** 统一占位图：灰底 + 图标（拿不到封面就是它，⛔ 不显示破图、不编假地址） */
    private paintCoverPlaceholder(cov: HTMLElement): void {
        cov.empty();
        cov.removeClass('is-load');
        cov.addClass('is-ph');
        safeSetIcon(cov, this.isSingle() ? 'file-video' : 'video');
    }

    /**
     * 点一格：本地集 → 内部切集；B 站外链 → 就地内嵌；其余网络地址 → 开浏览器；
     * 都没有 → 什么都不做（别假装点得动）。
     */
    private openCell(cell: EpisodeCell): void {
        const ctx = this.pageCtx;
        if (!ctx) return;
        if (cell.local) {
            // 从网络播放态点回本地集 ⇒ 先拆掉网络流 / iframe 层，否则 iframe 会盖在新的本地视频上面；
            // 且紧接着的 `switchToItem()` 会自己重挂源，故 `restoreLocal=false`（别白挂一遍又抢播）。
            this.exitNetEmbed(false);
            const pos = this.itemPosOf(cell.index);
            if (pos >= 0) {
                this.switchToItem(pos);
                // 切集后分段页跟到那一集（跨段点击时右侧列表要跟着翻）
                // 🔴 必须按**排序后数组里的位置**算页号，⛔ 不能用 `cell.index / SIZE`：
                //    倒序时数组位与集号反向，用集号算会把页翻到完全不相干的一段（点了 52 却翻到末段）。
                this.cellsPage = Math.max(0, Math.floor(this.orderedCellPos(cell.index) / EPISODE_PAGE_SIZE));
                this.syncCells();
                return;
            }
            // 有本地路径却不在可内嵌列表里（编码不支持 / 解析失败）⇒ 交给宿主走系统播放器
            ctx.onOpenUrl(ctx.files[cell.index] ?? '');
            return;
        }
        const url = ctx.urls[cell.index];
        if (!url) return;
        // 🔴 用户裁定：B 站链接**就地内嵌，失败自动降级开浏览器**；其余站点仍直接开浏览器。
        //    ⛔ 对不可内嵌的站点也硬塞 iframe：多数站点会用 X-Frame-Options / CSP 拒绝，
        //       表现是白屏 —— 用户会当成插件坏了，比直接开浏览器差得多。
        // 🔴 2026-10-31 用户报障：「关联入口填了油管的链接还是跳转网页」——
        //    病根就是这里只认 `canEmbedBili`（B 站专用）⇒ YouTube 集永远走不到内置播放器。
        //    ⇒ 闸门换成 `canPlayNetInline`（B 站 + YouTube）。真正的「能不能播」仍由
        //      `loadNetMedia` 取流后决定：YouTube 取不到流时**如实报原因**，⛔ 不跳浏览器。
        if (canPlayNetInline(url)) {
            this.enterNetEmbed(cell.index, url);
            // 分段页同样要跟到这一格（不然翻了几段再点回上文的集，边界段落会错位）
            this.cellsPage = Math.max(0, Math.floor(this.orderedCellPos(cell.index) / EPISODE_PAGE_SIZE));
            this.syncCells();
            return;
        }
        ctx.onOpenUrl(url);
    }

    // ── B 站外链内嵌 ────────────────────────────────────────────────────────────

    /**
     * 进入网络集播放态。
     *
     * 🔴 2026-11-24 用户裁定（逐字）：「将网络集用插件播放器播放的全部功能和样式全部从插件移除，
     *    但有官方 iframe 内嵌播放的不要移除」⇒ 网络集**只剩 iframe 一条路**：
     *    - 恒建 `.rl-epp-net` 层并加 `is-net`（主播放器的自绘控件对 iframe 一个都无效，
     *      留着就是骗人 —— 隐藏它是唯一诚实的做法）。
     * ⚠️ 历史（2026-11-05 那版）：曾经是「能取到流就走主播放器、拿不到才退 iframe」两段式，
     *    那套自取流（DASH+MSE / yt-dlp 合流 / 本地回环代理）已整体删除，⛔ 别再恢复。
     * ⛔ 也别把 `is-net` 挪到「进门就打」之外的地方乱加：它同时控制字幕面板的静态判据。
     */
    private enterNetEmbed(index: number, url: string): void {
        const stage = this.stageEl;
        if (!stage) {
            this.pageCtx?.onOpenUrl(url);
            return;
        }
        // 进网络集前先停本地视频：否则本地视频会在后面继续出声/继续计时
        this.pauseVideo();
        this.netIndex = index;
        // 面板标题 / 高亮要立刻切到「网络集」口径（挂 iframe 是异步的，UI 不能等）
        this.syncNetMode();
        // 遮罩先亮起：iframe 的 `src` 设下去到真出画面之间是纯白/纯黑，没有反馈用户会以为卡死。
        // 真正的关闭点在 `mountNetFrame`（iframe load 或看门狗超时）。
        this.showNetLoading(true);
        void this.loadNetMedia(index, url);
        // 🔴 同时去取 B 站字幕（含 AI 字幕）：与挂 iframe **并行**，谁先回来谁先画。
        //    ⛔ 不串行等字幕 —— 字幕慢不该拖住起播。
        void this.loadNetSubtitle(index, url);
    }

    /**
     * 取当前网络集的 B 站字幕并交给时间轴面板。
     *
     * 🔴 用户 2026-11-09 逐字：「播放网络集的字幕面板能不能显示其b站的AI字幕」
     *
     * 走 `cueImported` 这条**既有**通路（手动导入字幕也用它）：
     * 面板的 `cueKey()` 会因此变成 `imp::<集>::<文件名>`，换集自然失效，
     * ⛔ 不需要为网络字幕另立一套状态机。
     *
     * ⚠️ 两个时序陷阱（都会让「字幕显示了别的集」）：
     *  ⑴ 异步返回时用户可能已换集 / 退出网络态 ⇒ 必须比对 `netIndex`；
     *  ⑵ `render()`/换集会清空 `cueImported`，但取字幕是**并行**的 ⇒ 回来时必须
     *     再确认一次「当前还是这一集」，否则会把旧集字幕盖到新集上。
     */
    private async loadNetSubtitle(index: number, url: string): Promise<void> {
        const fn = this.pageCtx?.netSubtitle;
        if (!fn) return;
        // 🔴 2026-11-10 更正：这里原本对「官方内嵌」直接 return 不取字幕，理由记的是
        //    「iframe 跨域读不到 currentTime，时间轴没法联动，抓一份只会显示一个永远不走的字幕列表」。
        //    ⇒ 判断本身对，**结论错**：用户要的是「拿得到字幕」，不是「拿得到会跟着走的字幕」。
        //    实测（`tools/probe-diag-nosub.mjs`）：接口已经把 79390 字节取回来了，却被这一行丢掉，
        //    用户看到的是「拿不到字幕」。原话：「还是两个内嵌都拿不到字幕」。
        //    ⇒ 改成照样取，**正常点亮/跟随/跳转** —— 时间轴由 `services/embedVideo` 进子帧读
        //       （2026-11-10 实测：跨域 iframe 的 `currentTime` 读得到也写得进）。
        // ⚠️ 这与 2026-10-31「不启用则用官方内嵌 iframe 播放 ⇒ 取流函数一次都不调」不冲突：
        //    那条裁定管的是**媒体流**（`netStream`，要 ffmpeg 合流 + 本地代理），到现在仍然一次不调；
        //    字幕只是几条 HTTP 请求，代价完全不同。
        let got:
            | { fileName: string; text: string; isAi: boolean }
            | { fail: NetCueFailReason }
            | null = null;
        try {
            got = await fn(url);
        } catch {
            got = null; // 宿主炸了 ⇒ 当作没字幕，⛔ 不把异常抛进面板
        }
        // 异步期间已经换集 / 退出网络播放 ⇒ 这份结果作废
        if (this.netIndex !== index) return;
        // 🔴 用户在等待期间手动导入过字幕 ⇒ 自动抓的必须让路（否则用户的选择会被悄悄顶掉）
        if (this.cueImportedManual) return;
        // 🔴 用户 m06406 ④：没拿到时要分两种说 —— 该改 Cookie / 改 Cookie 也没用。
        //    宿主给的是 `{ fail }` 就照它的原因画；宿主什么都没给（老宿主 / 抛异常）⇒ `other`。
        //    ⛔ 别在这里补「猜」的逻辑：判据只有宿主侧的 `login_mid` 那一处拿得到。
        if (!got || 'fail' in got) {
            this.cueNetFail = got && 'fail' in got ? got.fail : 'other';
            // 上一集的字幕来源标识必须清掉：这一集没拿到字幕，挂着「AI」标是撒谎
            this.cueSourceTag = null;
            this.cueImported = null;
            // 没拿到：面板按「这一集没有字幕」画（`hasFile=false` 那条空态），
            // ⚠️ 不清 `cueImportedManual` —— 用户手动导入的字幕优先级更高，不该被自动抓取清掉。
            this.cueSrc = null;
            this.syncCueTools();
            void this.syncCueSource();
            return;
        }
        this.cueNetFail = null;
        this.cueImported = { fileName: got.fileName, text: got.text };
        // 🔴 用户 2026-11-09：「字幕面板在锁定时间轴按钮同行左对齐加上标识如：AI或本地」
        //    ⇒ 来源必须落到面板上，别只存不显示。三个来源互斥：
        //    ① `net` = B 站抓来的（再分 AI / 普通）；② `local` = 同目录 .srt；
        //    ③ `manual` = 用户手动导入的文件。
        this.cueSourceTag = got.isAi ? 'ai' : 'net';
        this.cueSrc = null; // 强制重解析
        void this.syncCueSource();
        // 🔴 必须补这一次开合同步：`syncSubsOpen()` 的判据包含 `cueImported`，
        //    但**没有任何地方会在 B 站字幕到达时自动调它** —— 只在换集 / `afterSubtitles` 里调。
        //    漏了这一行的真机症状：`cueRows=2084` 全部解析好了，字幕节却停在 `data-open=0`
        //    折叠态，用户面前是一条空标题栏（本次实测抓到）。
        this.syncSubsOpen();
        // 🔴 来源标识的渲染入口在 `syncCueTools()` 里 ⇒ 这里必须补这一脚。
        //    漏了的真机症状（本次实测抓到）：`cueRows=279` 字幕全解析好了、
        //    面板也展开了，但工具条最左**没有 `.rl-epp-cuetag`** ——
        //    因为建面板那一刻还没有字幕，标识节点根本没被创建，之后再没人来建。
        this.syncCueTools();
    }

    /**
     * 把网络集挂成**官方 iframe 内嵌**（唯一路径）。
     *
     * 🔴 2026-11-24 用户裁定（逐字）：「将网络集用插件播放器播放的全部功能和样式全部从插件移除，
     *    但有官方iframe内嵌播放的不要移除」⇒ 本方法从此**只做一件事**：拼官方内嵌地址、挂 iframe。
     * ⛔ 别再引入「先试取流、失败再退 iframe」的两段式：自取流（DASH+MSE / yt-dlp 合流 / 本地回环代理）
     *    整套已随 `services/biliMse.ts` / `services/biliStream.ts` / `services/ytMux.ts` / `services/ytdlp.ts`
     *    一起删除，这里连调用点都不存在了。
     * ⚠️ 字幕**不受影响**：`loadNetSubtitle()` 在 `enterNetEmbed` 里并行跑，iframe 路径下照样抓
     *    B 站字幕，时间轴由 `services/embedVideo` 进子帧读写 `currentTime`（2026-11-10 实测可行）。
     */
    private async loadNetMedia(index: number, url: string): Promise<void> {
        // 异步期间用户可能已经换集 / 退出网络播放 ⇒ 这份结果作废
        if (this.netIndex !== index) return;
        const official = netOfficialEmbed(url);
        if (official) {
            this.showNetLoading(false);
            // ⚠️ 这里原来还有一句「标题交给 `mountNetFrame` 按来源算（`netEmbedTitleOf`）」——
            //    那枚标题胶囊已被用户 2026-11-08 整体删除（见 `buildNetLayer` 的注释），
            //    现在舞台上没有文字标识，只剩 iframe 自己的 `title` 属性（无障碍用）。
            this.mountNetFrame(official.embedUrl, url);
            return;
        }
        // 拼不出官方内嵌地址（短链 / 脏数据 / 取不到片号）：把原因说出来，再交回宿主
        // ⛔ 别静默留一个白框 —— 用户只会判定插件坏了
        const why = this.pageCtx?.netFailHint?.();
        this.showNetLoading(false);
        if (why) this.showToast(`这一集在插件里播不了：${why}`);
        this.exitNetEmbed();
        this.pageCtx?.onOpenUrl(url);
    }

    /**
     * 建内嵌 iframe 层骨架（工具条 + 失败提示）。**网络集的唯一播放面**。
     *
     * 🔴 2026-11-24：以前这层只在「取流失败回退」时建，现在内置播放器整体下架 ⇒ 恒走它。
     * ⛔ 不在这里建播放面 —— 播放面就是 iframe 本身（`mountNetFrame` 建）。
     */
    private buildNetLayer(): void {
        // 🔴 先判「旧层还算不算数」——这里曾是最阴的一个 bug（真机复现：点了格子黑屏、
        //    `<video>` 有 src 却没进文档）。视图重建（`contentEl.empty()` + 重搭 stage）之后
        //    `netLayerEl` 还指着**已脱离文档的旧层**，而下面的 `if (this.netLayerEl) return;`
        //    会因此提前返回 ⇒ 新 stage 上永远建不出层。
        //    ⇒ 只有「在文档里且父节点就是当前 stage」的层才可复用，其余一律作废重建。
        const stale = this.netLayerEl;
        if (stale && (!stale.isConnected || stale.parentElement !== this.stageEl)) {
            this.netLayerEl = null;
            this.netFrameEl = null;
        }
        if (this.netLayerEl) return;
        const stage = this.stageEl;
        if (!stage) return;
        const layer = stage.createDiv({ cls: 'rl-epp-net' });
        this.netLayerEl = layer;
        // 失败提示层（超时才显形；平时 `display:none`）
        layer.createDiv({ cls: 'rl-epp-netfail', text: NET_LOAD_FAIL });
        /**
         * 🔴 用户 2026-11-08 逐字：「播放器上的两个标识(B站官方播放器)给我删除掉」
         *    ⇒ 追问确认后裁定：**只删左上角这枚胶囊**，`iframe` 的 `title` 属性保留
         *      （那是无障碍标签，不是视觉标识）。
         * 原状：`layer.createDiv({ cls: 'rl-epp-netbar' })` + 里面一颗
         *    `.rl-epp-nettitle`，由 `setNetTitle()` 把文字设成
         *    「B 站官方播放器 / YouTube 官方播放器 / 官方播放器」，配
         *    `rl-epp-netbar-autohide` 3.25s 自动淡出 + `is-peek` 鼠标回来再亮。
         * 全删：节点、`netTitleEl` 字段、`setNetTitle()`、peek/unpeek 监听、对应 CSS。
         *
         * ⚠️ 这里原有注释写「⛔ 别把标题一起删：`netTitleEl` 被 `restoreLocalTitle()`
         *    用来还原本地片名」——**那条注释是错的**，已随本次删除一并纠正：
         *    `restoreLocalTitle()` 在 `VideoPlayerView`，写的是 `titleTextEl`
         *    （播放器顶栏片名），与这枚胶囊毫无关系。所以删胶囊**不影响**换集后
         *    片名还原，删之前的顾虑不成立。
         */
    }


    /**
     * 「正在载入视频」遮罩。
     *
     * 🔴 用户 2026-11-16 报障：「youtube网络集在插件播放器一直在显示加载转圈提示」
     *    ⇒ 光挂转圈等于什么都不说。这里加一条**真实进度**文案：
     *      · 未知阶段 → `正在载入视频…`（与原来一致）
     *      · 取信息   → `正在读取视频信息…`
     *      · 合流中   → `正在准备视频 42%`（有总时长）/ `正在准备视频 3:20`（没有总时长）
     *    ⚠️ 进度文案走 `netLoadingTxtEl` 单独节点，⛔ 不要整块重建遮罩 —— 重建会让
     *       spinner 动画从头开始，看起来像「卡了一下又重启」。
     */
    private showNetLoading(on: boolean): void {
        if (on) {
            if (!this.netLoadingEl) {
                const stage = this.stageEl;
                if (!stage) return;
                const el = stage.createDiv({ cls: 'rl-epp-netloading' });
                el.createDiv({ cls: 'rl-spinner rl-spinner-lg' });
                this.netLoadingTxtEl = el.createSpan({ cls: 'rl-epp-netloading-txt', text: '正在载入视频…' });
                this.netLoadingEl = el;
            }
            this.netLoadingEl.addClass('is-on');
            return;
        }
        this.netLoadingEl?.removeClass('is-on');
        // ⚠️ 关掉时把文案复位：下一次可能是 B 站（没有进度），留着上次的 `42%` 会骗人
        this.netLoadingTxtEl?.setText('正在载入视频…');
    }

    /**
     * 把主播放器上的网络残留摘干净（退出网络播放 / 换本地集前都走这里）。
     *
     * 🔴 2026-11-24 用户裁定网络集只留官方 iframe 内嵌 ⇒ 原来自取流那套（DASH 管线、
     *    error 回退监听、播放中缓冲指示、预取）全部删除。现在这里只剩「别让上一集的
     *    东西继续影响下一集」这几件事：
     *    ① 停内嵌时间轴轮询（250ms 定时器，不停会在换集后继续往已拆的子帧发 IPC）；
     *    ② 撤掉起播遮罩（中途换集时它还在「正在载入」，会永久盖住下一集画面）；
     *    ③ 把顶栏片名从「B站官方播放器」还回本地片名。
     * ⚠️ 网络态只剩 iframe ⇒ **没有**「主播放器里正跑着网络流」这种中间态，因此不再需要
     *    `netStreamOn` 这个标记，也⛔ 不要再写 `videoEl.src = ''`：那颗节点是本地集的播放面。
     */
    private detachNetVideo(): void {
        this.stopEmbedTicker();
        this.showNetLoading(false);
        // 顶栏片名还回本地口径（否则停在「B站官方播放器」上，跟实际在播的东西对不上）
        this.restoreLocalTitle();
        // 🔴 退出网络集后主播放器里没有画面：纯网络条目（`items` 为空）必须把占位层还回来，
        //    否则用户面对的是一块无声黑屏，连「为什么没画面」都看不到。
        this.syncEmptyStage(this.itemCount() === 0);
    }

    /**
     * 把地址灌进 iframe 并起看门狗。
     *
     * ⚠️ 说清局限：`X-Frame-Options` 拒绝被嵌时 **Chrome 仍会触发 `load`**（加载的是错误页），
     *    所以看门狗只能抓「网络完全不通」，抓不到「拒绝被嵌」。因此工具条上那颗
     *    「在浏览器打开」是**常驻**的 —— 那是唯一 100% 可靠的兜底，⛔ 不靠超时假装全覆盖。
     *
     * @param embedUrl 灌进 `src` 的官方播放器地址
     * @param srcUrl   **这条网络集的原始地址**。只用来算「挂的是谁家的播放器」和失败文案
     *                 （`netEmbedTitleOf` / `netEmbedFailText` / `netEmbedFallbackUrl` 都要它）。
     *                 ⚠️ 别拿 `embedUrl` 反推 —— `netEmbedSourceOf` 认的是原始站址，
     *                 对 `youtube.com/embed/…` 这种内嵌地址它给的是 'youtube' 没错，
     *                 但 B 站的 `player.bilibili.com/player.html?bvid=` 需要走 bvid 提取，
     *                 口径和原始站址不一致，绕这一圈纯属给自己挖坑。
     */
    private mountNetFrame(embedUrl: string, srcUrl = ''): void {
        // 🔴 挂 iframe ⇒ 先摘掉主播放器上的网络残留，再加 `is-net` 把主播放器整套藏掉：
        //    自绘控件对跨域 iframe 一个都无效，露着就是骗人。
        this.detachNetVideo();
        this.stageEl?.addClass('is-net');
        this.buildNetLayer();
        const layer = this.netLayerEl;
        if (!layer) return;
        // 🔴 记住原始地址：标题、失败文案、备用域名三条都要按「是 B 站还是 YouTube」分叉。
        this.netSrcUrl = srcUrl;
        let frame = this.netFrameEl;
        if (!frame) {
            frame = layer.createEl('iframe', {
                cls: 'rl-epp-netframe',
                attr: {
                    // B 站内嵌播放器只需要这两项；⛔ 不开 `allow-same-origin`（跨域同源会给它摸宿主的能力）
                    allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
                    frameborder: '0',
                    scrolling: 'no',
                    title: NET_BAR_TITLE_FRAME,
                },
            });
            this.netFrameEl = frame;
        }
        // ⚠️ 收成 `const`：`frame` 是 `let`，类型收窄在下面 `load` 闭包里会失效
        //    （TS18047: 'frame' is possibly 'null'）—— 闭包内必须用这个已收窄的常量。
        const frameEl = frame;
        this.clearNetTimer();
        layer.removeClass('is-fail');
        // 失败提示文案也按来源换（`buildNetLayer` 里建的是 B 站口吻的 `NET_LOAD_FAIL`）
        const failEl = layer.querySelector('.rl-epp-netfail');
        if (failEl instanceof HTMLElement) failEl.setText(netEmbedFailText(srcUrl));
        // 🔴 先把设置里填的 Cookie 写进 Electron cookie jar，**再**设 `src`。
        //    iframe 一旦开始加载就已经发完首包，之后再写 cookie 对这次请求无效 ⇒
        //    必须「先登录、后加载」这个顺序（用户 2026-10-31 报障：内嵌里永远要登录）。
        //    ⚠️ `syncEmbedCookies` 可能抛（非 Electron / 权限不足）⇒ 失败也照常加载，
        //       只是仍显示未登录，⛔ 别把它变成「内嵌打不开」。
        //    🔴 2026-11-24 用户 m05414：「youtube内嵌播放器填了cookie还是无法播放」。
        //       原来这里是 `void sync().catch(() => undefined).then(load)` —— 异常被吞、
        //       返回值（`{available, bili, yt, issue}`）被完整丢弃 ⇒ 写没写进去界面上毫无痕迹。
        //       现在必须把 `issue` 捅到界面上：不要「失败但静默」，也不要「失败就拦住加载」。
        const sync = this.pageCtx?.syncEmbedCookies;
        // 🔴 2026-11-25：YouTube 主域被墙时，同 id 换 `youtube-nocookie.com` 有时仍在白名单里
        //    ⇒ 超时/失败后**自动重试一次**备用域名。⛔ 只给 YouTube（`netEmbedFallbackUrl` 里定死），
        //    而且**只重试一次**：换完还不行就把失败提示亮出来，⛔ 别陷入「白屏 ↔ 白屏」的循环。
        const retryUrl = netEmbedFallbackUrl(srcUrl);
        let triedFallback = false;
        const load = (): void => {
            // 期间用户可能已经换集/退出 ⇒ 旧 frame 不再挂 src（否则会偷偷续播旧视频）
            if (this.netFrameEl !== frameEl) return;
            frameEl.addEventListener(
                'load',
                () => {
                    // 换集时旧 iframe 的 load 也可能后到 ⇒ 只认「这次确实加载成功」的那一下
                    this.clearNetTimer();
                },
                { once: true },
            );
            frameEl.setAttr('src', embedUrl);
            this.netTimer = window.setTimeout(() => {
                this.netTimer = null;
                // 第一次超时且来源有备用域名 ⇒ 静默换域名再来一次，失败提示先不亮
                // （这次重试对用户是透明的：画面本来就还没出来，多说一句只是噪音）
                if (retryUrl && !triedFallback && this.netFrameEl === frameEl) {
                    triedFallback = true;
                    layer.removeClass('is-fail');
                    frameEl.setAttr('src', retryUrl);
                    this.netTimer = window.setTimeout(() => {
                        this.netTimer = null;
                        this.netLayerEl?.addClass('is-fail');
                    }, EMBED_LOAD_TIMEOUT);
                    return;
                }
                this.netLayerEl?.addClass('is-fail');
            }, EMBED_LOAD_TIMEOUT);
        };
        if (!sync) {
            load();
            return;
        }
        void sync()
            .catch((e: unknown) => {
                // 真抛了也要让人看见——静默失败是这次报障「查不出原因」的根子。
                const msg = e instanceof Error ? e.message : String(e);
                return { available: false, bili: 0, yt: 0, issue: `Cookie 同步异常：${msg}` };
            })
            .then((res) => {
                // `issue` 非空 = 该写却一条都没写进去（拿不到 session / jar 拒收）。
                // 只**提示**，⛔ 不拦加载：Cookie 出问题不该让内嵌整个打不开。
                if (res.issue) new Notice(`内嵌登录态未能写入：${res.issue}`, 8000);
                load();
            });
    }

    /**
     * 退出网络播放：拆层、还原本地播放器显示、清网络下标。
     *
     * 🔴 退出必须**彻底**：只清 `netIndex` 会留下 iframe 层和「B站官方播放器」的顶栏片名。
     *    两条路都要走到：`detachNetVideo()`（停轮询 + 清按钮 + 遮罩 + 还原片名）
     *    + `render()`（按当前集重挂本地源）。
     * ⚠️ `restoreLocal=false` 的唯一调用点是「从网络集点回**本地集**」：那边紧接着就
     *    `switchToItem()` 重渲染了，这里再补一次等于让当前集白挂一遍源（会闪一下并抢播）。
     */
    private exitNetEmbed(restoreLocal = true): void {
        this.clearNetTimer();
        this.netIndex = null;
        this.stageEl?.removeClass('is-net');
        this.detachNetVideo();
        this.cueVideoEl = null;
        // 内嵌层整块挪掉（留着 iframe 节点没意义：下次进来地址就变了，留着只会偷偷续播旧视频）
        const layer = this.netLayerEl;
        layer?.removeClass('is-fail');
        layer?.detach();
        this.netLayerEl = null;
        this.netFrameEl = null;
        // 原始站址与 iframe 同生共死：留着会让下一集算标题/失败文案时读到上一集的来源
        this.netSrcUrl = '';
        // 🔴 网络集离场后主播放器是空的（`readyState=0`、无 src）⇒ 必须重挂本地源，
        //    否则用户点它播不了（这就是那条被反复报的「退出后播放不了」）。
        //    `render()` 是本地集的唯一入口（重设 src / 标题 / 占位层），不要另写一套。
        if (restoreLocal) this.rerenderCurrent();
        this.syncNetMode();
    }

    /** 清看门狗（切集 / 退出 / 重进都要清，否则旧定时器会把新一次加载误判成超时） */
    private clearNetTimer(): void {
        if (this.netTimer !== null) {
            window.clearTimeout(this.netTimer);
            this.netTimer = null;
        }
    }

    /** 现在是不是内嵌态（字幕面板等地方据此换口径） */
    private isNetMode(): boolean {
        return this.netIndex !== null;
    }

    /**
     * 切换「网络集播放面」之后重算字幕来源/头部。
     *
     * 🔴 历史坑（2026-11-10 更正）：这里曾断言「跨域 iframe 读不到 `contentDocument`、
     *    拿不到 `currentTime`」，于是内嵌态一律显示「网络集用不了时间轴」。**那是猜的**：
     *    真机实测 `contentDocument` 确实读不到（`docAccessible:false`），但**不需要它** ——
     *    `services/embedVideo` 走 `framesInSubtree` + `executeJavaScript` 直接进子帧读写
     *    `video.currentTime`，读写都通。⛔ 别再拿 `contentDocument` 当「做不到」的证据。
     */
    private syncNetMode(): void {
        this.cueSrc = null; // 强制重走一遍来源判定
        void this.syncCueSource();
        // 头部「第 N 集」跟着内嵌切（`activeCellIndex()` 已认 netIndex）
        this.syncHead();
        // 🔴 退出内嵌后本地播放器必须**显式**同步一次空态：这条路径不经过基类 `render()`
        //    （`render()` 只在换片时跑），纯网络条目的 `items` 为空 ⇒ 若不同步，
        //    退出内嵌后就是一个 `readyState=0` 的黑壳，用户点它播不了（真机实测的缺陷）。
        //    判据只认「本地项有没有」（`items` 来自 `episodeFiles`）：有本地集就交给播放器正常显示，
        //    没有（纯网络条目）才亮占位 —— 与基类 `render()` 里同一个 `!item` 口径。
        // ⚠️ 2026-11-24 起网络集只剩官方 iframe（不占主播放器）⇒ 原先的 `!this.netStreamOn`
        //    让路条件已无意义：只要 `items` 为空就该亮占位。
        this.syncEmptyStage(this.itemCount() === 0);
        // 🔴 选集格也必须重画：`is-cur` 是渲染期算出来的，不重画就定格在上一帧。
        //    真机实测的缺陷：退出内嵌后播放器已回第 1 集，高亮还赖在第 4 集上。
        this.syncCells();
    }

    /**
     * 「选集区当前该高亮哪一格」的真实集下标。
     *
     * 🔴 不能用 `currentEpisodeIndex()` 直读：那是**组件库里的真实集**（`items[cur].index`），
     *    而 B 站内嵌态根本不移动 `cur`（网络集没有本地文件、进不了 items）。
     *    真机实测症状：点开第 4 集内嵌播放，右侧高亮还停在第 1 集 —— 明着指错地方。
     * ⇒ 内嵌态以 `netIndex` 为准，其余情况仍回落到组件库口径。
     */
    private activeCellIndex(): number {
        return this.netIndex ?? this.currentEpisodeIndex();
    }

    /**
     * 本页当前这一路是不是网络流。
     *
     * 🔴 2026-11-10 用户报障：「退出全屏时返回到详情页后进度就重回 0 了」。
     *    回跳走 `backToEpisodePage` → `openEpisodePageFor(entry, index, seconds, …)`，
     *    秒数落进基类的 `pendingSeek`；可基类 `consumePendingTarget` 是按
     *    `items[].index` 找目标集的 —— **网络集没有本地文件、根本不在 `items` 里**
     *    ⇒ `findIndex` 必然 -1 ⇒ 目标秒被当成「已被移除的集」丢掉，退回续播 = 0。
     *    ⇒ 覆写这个钩子，让基类知道「集找不到但秒数照样有效」。
     * ⛔ 别改成「回跳时不传 seconds」——那才是把进度丢掉。
     */
    protected isNetPlayback(): boolean {
        // 2026-11-24 网络集只走官方 iframe（不再占主播放器）⇒ 判据只剩「当前格是不是网络集」
        return this.netIndex !== null;
    }

    /**
     * 本页网络集的**真实集号**（标记归属用）。
     *
     * 🔴 用户 2026-11-14：「网络集的时间戳怎么不能跳转，还有在时间戳列表不能显示」。
     *    基类按 `items[cur].index` 过滤标记，可 B 站内嵌态**根本不移动 `cur`**
     *    （网络集没有本地文件、进不了 items，见 `activeCellIndex()` 的同款理由）
     *    ⇒ 直读会拿到「上一次本地集」的号，标记全画错位置。
     * ⇒ 覆写成以 `netIndex` 为准（那是本页唯一真实的网络集号）。
     */
    protected netMarkEpisode(): number | null {
        return this.netIndex;
    }

    /**
     * 本页的网络集换集：**就地换源**，⛔ 不开新标签页。
     *
     * 🔴 用户 2026-11-14 同上：点时间戳跳到第 N 集时，若那一集不是当前这集，
     *    基类只能回调宿主（它没有取流能力）；本页自己就有 `enterNetEmbed()`，
     *    原地换源比让宿主重开一页快得多，也不会多出标签页。
     * ⚠️ 目标集没有网络地址 ⇒ 如实提示，别静默什么都不做。
     */
    protected retargetNetEpisode(index: number, seconds: number): void {
        const url = this.pageCtx?.urls[index];
        if (!url) {
            this.showToast('这一集没有网络地址');
            return;
        }
        this.pendingNetSeek = seconds > 0 ? seconds : null;
        this.enterNetEmbed(index, url);
    }

    /** 宿主入口（深链时间戳）：在**本页原地**切到某网络集并定位到某秒。
     *
     * 🔴 用户 2026-11-14：点笔记里的时间戳跳网络集时，宿主原来走
     *    `openEpisodePageFor()` —— 它只在「当前激活叶子恰好是选集页」时复用，
     *    否则 `getLeaf('tab')` **新开一页**（真机实测 `epPagesBefore 1 → after 2`）。
     *    同一部剧已经开着却越点标签越多，与 2026-11-09「别新开标签页」的裁定冲突
     *    ⇒ 宿主先按条目 id 找本页，找到就调这个方法原地换源。
     */
    jumpToNetEpisode(index: number, seconds: number): void {
        this.retargetNetEpisode(index, seconds);
    }

    /** 某一真实集号在**当前集序下**的数组位置（找不到返回 0，等价于「翻到第一段」）。
     * 两处口径必须一致：`syncCells()` 先 `orderCells()` 再 `pageSlice()`，这里也必须先排序再找位。
     */
    private orderedCellPos(index: number): number {
        const ctx = this.pageCtx;
        if (!ctx) return 0;
        const cells = orderCells(
            episodeCells({
                files: ctx.files,
                urls: ctx.urls,
                titles: ctx.titles,
                statuses: ctx.statuses,
                currentIndex: this.activeCellIndex(),
                total: ctx.total,
                single: this.isSingle(),
            }),
            this.cellsOrder,
        );
        const at = cells.findIndex((c) => c.index === index);
        return at < 0 ? 0 : at;
    }

    /** 视图关闭：摘掉封面观察器（否则已滚过去的格子在关页后还会排队发请求）、停掉网络层，再交给基类收尾 */
    async onClose(): Promise<void> {
        this.coverIo?.disconnect();
        this.coverIo = null;
        this.coverPending.clear();
        // 🔴 用户 2026-11-10 裁定「关闭标签页即彻底暂停」：先把网络层停干净
        //    （250ms 的 embedVideo 轮询定时器、DASH MSE、官方内嵌 iframe 层），
        //    否则关页后那个定时器还会往已拆的子帧继续发 IPC。
        this.detachNetVideo();
        // 🔴 跟读倒计时与查词气泡也必须停：前者的 tick 到点会调 `play()`，
        //    关页后仍可能把视频重新播起来；后者是挂在 `document.body` 上的自由浮层，
        //    不摘就会一直留在界面上（它不随视图 DOM 被回收）。
        this.stopCueShadowTimer();
        this.hideWordTip();
        // 右键菜单的组件实例 + 它的 body 壳:前者解绑 window 监听，后者不进视图 DOM ⇒ 都得自己收。
        this.destroyEntryMenu();
        await super.onClose();
    }

    /** 把「当前集」滚进视野（双 rAF：等本轮布局落定再滚，否则量到的是旧位置） */
    private scrollCurIntoView(): void {
        const body = this.cellsBodyEl;
        if (!body) return;
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                const cur = body.querySelector<HTMLElement>('.rl-epp-cell.is-cur');
                if (!cur) return;
                // 只在滚动容器内滚（`scrollIntoView` 的 `block:'nearest'` 会把整页也带偏）
                // 🔴 必须用 rect 差值算容器内偏移，**不能**用 `cur.offsetTop`：
                //    `.rl-epp-cells` 是 `position:static`，`offsetTop` 量到的是最近**定位**祖先
                //    （那是整页层级）⇒ 得到的值远大于容器可滚高度，`scrollTop` 被钳到末尾，
                //    表现为「一进来就滚到最后一屏、当前集反而看不见」。仿真页探针实测抓到过。
                const top = cur.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
                const h = cur.offsetHeight;
                if (top < body.scrollTop || top + h > body.scrollTop + body.clientHeight) {
                    body.scrollTop = Math.max(0, top - body.clientHeight / 2 + h / 2);
                }
            });
        });
    }
}
