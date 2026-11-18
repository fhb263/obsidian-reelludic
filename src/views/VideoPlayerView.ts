import { ItemView, Notice, Scope, WorkspaceLeaf } from 'obsidian';
import {
    clampSeek,
    clampVolume,
    episodeLabel,
    formatSpeed,
    formatTime,
    hoverTipText,
    nextEpisodeText,
    ratioToSeconds,
    resolveKeyAction,
    secondsToRatio,
    shouldResume,
    SEEK_STEP,
    SEEK_STEP_LARGE,
    type PlayerKeyAction,
} from 'pure/player';
import {
    activeMarkIndex,
    MARK_TABS,
    MARK_TAB_LABELS,
    markEmptyHint,
    markTabCounts,
    markTabOf,
    marksOfTab,
    sortMarksByTime,
    type MarkTab,
} from 'pure/videoDrawer';
import {
    buildEpisodeOptions,
    buildSettingOptions,
    buildSpeedOptions,
    buildSubtitleMenu,
    menuAnchor,
    nextEpisodeIndex,
    nextMenuState,
    nextPlayMode,
    normalizePlayMode,
    SETTING_HEAD,
    SUBTITLE_SWITCH_LABEL,
    type PlayMode,
    type PlayerMenuKind,
    type SettingGroup,
    type SettingRow,
} from 'pure/playerMenu';
// 进度条打点/标记（#333）：标记的**解析与过滤全在纯模块**里，视图只负责画 + 命中判定 + 分发。
import { markCaption, markPct, marksForEpisode, type VideoMark } from 'pure/videoMarks';
import { dirOfPath, fileNameOfPath, subtitleLangLabel, subtitleLangTag, type SubtitleCandidate } from 'pure/subtitle';
import { safeSetIcon } from '../services/safeIcon';
// 🔴 m07854 ⑰：右键截图 = 即时批注（弹窗，⛔ 不画在播放器上 —— `fixed` 会被 transform 祖先偏移）
import { ShotAnnotateModal } from 'modals/ShotAnnotateModal';
import { StampNotePopover, type StampNoteResult } from './StampNotePopover';
import { stampNoteCaption } from 'pure/stampNote';

/** 视图类型（main 层 registerView 与打开入口共用） */
export const VIDEO_PLAYER_VIEW_TYPE = 'reelludic-video-player';

/** 可内嵌播放的剧集条目（main 层按 episodeFiles 过滤「仅可内嵌」项后构造） */
export interface EmbedVideoItem {
    /** 剧集下标（0 基，对应 episodeFiles 数组位；用于展示「第 N 集」、位置记忆键与回调） */
    index: number;
    /** 集标题（可空；有则标题栏显示） */
    title?: string;
    /** 播放源 URL（已由 main 解析：库内 http/app、库外 app://） */
    url: string;
    /** 本地原始路径（供「外部打开」转系统播放器 / 字幕同目录扫描 / error 兜底回调） */
    path: string;
    /** 是否为首集/末集（main 计算边界，按钮置灰用） */
    isFirst: boolean;
    isLast: boolean;
}

export interface VideoPlayerOptions {
    /** 片名（标题栏 + 标签页标题） */
    entryTitle: string;
    /** 可内嵌播放列表（已按剧集顺序） */
    items: EmbedVideoItem[];
    /** 起始播放项下标（items 内，0 基） */
    startIndex: number;
    /** 电影 / 单文件播放（无「集」概念）：标题不带集数，且不显示上一集 / 下一集、不连播 */
    single?: boolean;
    /** 「外部打开」/解码失败兜底：转系统播放器打开指定路径（main 层 shell.openPath） */
    onExternalFallback: (path: string) => void;
    /** 条目 id（有则记忆播放位置；单文件预览不传） */
    entryId?: string;
    /** 上次播放位置（key = 集下标字符串，value = 秒；来自 catalog.videoPositions） */
    initialPositions?: Record<string, number>;
    /** 播放位置写回（节流 + 暂停/切集/关闭时立即调用；main 层落 catalog） */
    onSavePosition?: (epKey: string, seconds: number) => void;
    /** 同目录字幕候选（main 层 fs 扫描 + pure/subtitle 匹配；缺省则不做字幕自动挂载） */
    listSubtitles?: (videoPath: string) => Promise<SubtitleCandidate[]>;
    /** 读取字幕文件并转成 WebVTT 文本（库内相对/库外绝对路径均可；失败返回 null） */
    loadSubtitleVtt?: (subtitlePath: string) => Promise<string | null>;
    /** 系统选择器挑一个字幕文件（返回路径；取消返回 null） */
    pickSubtitleFile?: () => Promise<string | null>;
    /**
     * 每集已持久化的字幕路径（key = 集下标字符串，value = 字幕路径；来自 catalog.subtitlePaths）。
     *
     * 🔴 用户 2026-10-29「字幕要双向持久化」的**回写方向**：换集时先看这一集有没有存过字幕，
     *    有就直接挂它（⛔ 不再让「同目录第一条」抢走用户上次的选择）。
     * ⚠️ 与 `initialPositions` 同一形状（下标字符串键），便于按集绑定。
     */
    initialSubtitles?: Record<string, string>;
    /** 字幕路径写回（选中/导入后立即调用；main 层落 catalog.subtitlePaths）。
     *  传空串表示「清除这一集的字幕记忆」。 */
    onSaveSubtitle?: (epKey: string, subtitlePath: string) => void;
    /**
     * 「回到选集页」（用户 2026-11-06 裁定，两页互跳的另一半）。
     *
     * 🔴 用户逐字：「新播放器页面点击全屏按钮时进入到原来的播放器页面，再点全屏按钮返回到新播放器页面」
     *    ⇒ 播放器页那颗全屏按钮**不再是浏览器真全屏**，而是换回选集页（由宿主注入本回调）。
     * ⚠️ 只有「从选集页交接进来」的实例才该有它：直接开播放器（如点本地文件）没有「选集页」可回，
     *    那时全屏按钮保持原语义（`toggleFullscreen`）。判据是**回调在不在**，⛔ 不看 `netSource`
     *    —— 本地集交接进来同样要能跳回去。
     */
    onBackToEpisodePage?: (seconds: number) => void;
    /**
     * 时间戳链接定位（#326）：等 `loadedmetadata` 后跳到该集该秒并播放。
     * `index` = **真实集下标**（`episodeFiles` 位；视图内按 `items[].index` 匹配）。
     * 与续播位置**互斥**：带 pendingSeek 时不走续播（目标位置优先，免得先跳续播处再跳走）。
     */
    pendingSeek?: { index: number; seconds: number };
    /**
     * 插入时间戳（#326）：宿主负责构造链接 + 决定落到哪个笔记（视图只报「当前时刻 + 当前集」）。
     * 🔴 m04435 ①：`caption` 是**右键浮层**给的补充文字（`🤩 震撼 备注`）；左键单击**不传**它
     *   ⇒ 宿主按「纯链接」落盘，与 #587 的旧口径一字不差（⛔ 别把左键也改成传空串，那会让
     *   「有没有心情」在宿主侧分不清）。
     */
    onInsertStamp?: (info: { seconds: number; ep: number; caption?: string }) => Promise<void>;
    /**
     * 🔴 m04435 ① 右键浮层的**预览时间文字**（`0:20` / 多集时 `第3集·0:20`）。
     * 为什么由宿主给：链接文字里带不带集号取决于「条目实际有多少集」，那个口径在宿主侧
     * （`main.ts` 的 `videoTimeLink` 用文件/网络集/声明总集数三者取 max）。视图自己算只会算
     * 本地项 ⇒ 纯网络条目预览不带集号、写进笔记却带，**预览对不上落盘**。
     */
    stampPreviewText?: (info: { seconds: number; ep: number }) => string;
    /** 截取当前帧（#326）：宿主负责落盘 + 写进条目笔记 + 提示（视图不碰 vault） */
    onCaptureShot?: (info: { png: ArrayBuffer; seconds: number; ep: number }) => Promise<void>;
    /** 打开当前视频的笔记（#326 用户 2026-09-19：顶栏最右那个按钮）—— 宿主负责分屏打开/聚焦 */
    onOpenNote?: () => Promise<void>;
    /**
     * 进度条标记（#333）：**整条目**的标记（含各集），由宿主从条目笔记解析后传入。
     * 视图按**当前集**过滤（`marksForEpisode`）—— 多集时间轴不同，混着画就是画错位置。
     */
    marks?: VideoMark[];
    /**
     * 标记卡片里的「在笔记中打开」（#333 D-3）：宿主负责开/复用条目笔记并**滚到该标记那一行**。
     */
    onOpenMarkNote?: (mark: VideoMark) => Promise<void>;
    /** 截图的资源 URL（#333：卡片里显示缩略图用）—— 视图不碰 vault，由宿主解析；取不到返回 null */
    markImageUrl?: (image: string) => string | null;
    /**
     * 后台播放（缺省 false）：不可见时继续播放，不暂停也不释放解码。
     * 🔴 #605 起它是**只读快照** —— 开关本体已搬到 设置页 › 内置视频播放器 折叠分组（全局设置），
     *    播放器内不再改它；本视图只在打开时读一次，用于可见性/省电判定。
     */
    backgroundPlay?: boolean;
    /**
     * 🔴 #604 播放模式（四档，见 `pure/playerMenu.PlayMode`；缺省 = 列表循环）。
     * ⛔ 旧的「自动切集 / 单集循环」两个布尔选项**已撤** —— 迁移在 main 层做一次
     * （`playModeFromLegacy`），视图只认 `PlayMode` 这一种形态。
     */
    playMode?: PlayMode;
    /** 🔴 #604 播放模式写回（main 落 settings；缺省则只在本视图会话内生效）。
     *  #605 起弹窗里改模式 = 整行点击循环，每次切换回传一次。 */
    onSetPlayMode?: (mode: PlayMode) => void;
}

/** 顶部操作文案（纯展示）：剧集 = 「第 N 集 · 集标题」；电影 / 单文件 = 集标题本身（无集数）。
 *  2026-09-18 下沉到 `pure/player.episodeLabel` —— 「选集」浮层要用同一份文案，两处各写一遍必然漂。 */

/** 会话级偏好（同一会话内跨视频保持，与阅读器字号同款做法；不落设置） */
let vpVolume: number | null = null;
let vpMuted = false;
let vpSpeed = 1;

/** 连播倒计时秒数 */
const NEXT_EP_SECONDS = 5;
/** 倍速入口文案（用户 2026-09-18 第二次指示：原来显示当前档位「1×」，改为固定「倍速」，档位看面板） */
const SPEED_BTN_LABEL = '倍速';
/** 播放位置写回节流（ms）：catalog 每次写入都会轮转备份，频率不宜高 */
const POS_SAVE_THROTTLE = 15000;
/** 控制条闲置自动隐藏延时（ms；用户 2026-09-18 第三次指示：3000 → **1000**，鼠标移出即重新起计时） */
const IDLE_HIDE_MS = 1000;
/** 不可见多久后连解码缓冲一起放掉（用户 2026-09-18 选定；回来按落盘位置重建） */
const HIDDEN_RELEASE_MS = 5 * 60 * 1000;
/** 单击 / 双击判定窗口（ms）：窗口内二次点击算双击（全屏），不触发播放暂停 */
const DBLCLICK_MS = 220;

export class VideoPlayerView extends ItemView {
    private opts: VideoPlayerOptions | null = null;
    /** 悬停时命中的标记（null = 没悬在标记上）—— 🔴 #634 起标记卡片已撤，
     *  这个字段现在**没有读取方**，保留仅仅是为了 `refreshMarks` 里那次 `= null` 复位不在类型上留坑。
     *  ⚠️ 下次清理时它应当与 `markPcts` 一起评估：抽屉的高亮用的是下标（`activeMarkIndex`），不是它。 */
    private hoverMark: VideoMark | null = null;
    /** 当前集过滤后的标记 + 其百分比（**抽屉**的跳转下标与高亮共用同一份，免得两处各算一遍漂掉） */
    private markList: VideoMark[] = [];
    private markPcts: number[] = [];
    // ── #579 时间戳侧边栏（抽屉）──────────────────────────────────────────────
    /** 抽屉容器（挂 root，**绝对定位**；收起 = `hidden` ⇒ `display:none`，零占用、零溢出） */
    private drawerEl: HTMLElement | null = null;
    /** 抽屉是否展开（默认收起 —— 用户口径「侧边栏默认收起」） */
    private drawerOpen = false;
    /** 当前 Tab（默认第一个 = 截图笔记） */
    private drawerTab: MarkTab = MARK_TABS[0];
    /** Tab 按钮（重建时要换 `is-on` / 数字，存一份免得每次 querySelector） */
    private drawerTabEls = new Map<MarkTab, HTMLButtonElement>();
    private drawerListEl: HTMLElement | null = null;
    /** 列表行（与 `drawerRows` 一一对应；点跳转与高亮都按同一份下标走） */
    private drawerRowEls: HTMLElement[] = [];
    private drawerRows: VideoMark[] = [];
    /** 当前高亮的行下标（`-1` = 无）；**只在变化时才改 DOM**（`timeupdate` 每秒 4 次，别白刷） */
    private drawerActive = -1;
    /** 抽屉开关（顶栏那枚）：开合时换图标 `panel-right-open` / `panel-right-close` */
    private drawerBtn: HTMLButtonElement | null = null;
    /** 大图预览（截图笔记专用）：整块遮罩 + 居中大图 */
    private lightboxEl: HTMLElement | null = null;
    private lightboxImgEl: HTMLImageElement | null = null;
    /** 视图是否已完成 onOpen（未完成时 openWith 只记 opts，由 onOpen 负责建 UI）
     *  ⚠️ 不能用 rootEl 判「是否已挂载」：占位态也算已挂载但当时 rootEl 为空 →
     *  曾因此让 `if (this.rootEl) buildUi()` 恒假，点「观看」只挂 opts 不建界面（2026-09-15 用户报「根本播放不了」）。*/
    private opened = false;
    private cur = 0;
    /** 时间戳链接定位目标（#326）：进场时待消费；消费后置 null */
    private pendingSeek: { index: number; seconds: number } | null = null;
    private videoEl!: HTMLVideoElement;
    private titleTextEl!: HTMLElement;
    private prevBtn: HTMLButtonElement | null = null;
    private nextBtn: HTMLButtonElement | null = null;
    private rootEl: HTMLElement | null = null;
    /** 顶栏右组容器（网络流模式往里挂「在浏览器打开 / 退出播放」两枚出口；`null` = 还没建） */
    private barToolsEl: HTMLElement | null = null;
    private progressEl: HTMLElement | null = null;
    private playedEl: HTMLElement | null = null;
    private bufferedEl: HTMLElement | null = null;
    private tipEl: HTMLElement | null = null;
    private timeEl: HTMLElement | null = null;
    private playBtn: HTMLButtonElement | null = null;
    private volumeBtn: HTMLButtonElement | null = null;
    private speedBtn: HTMLButtonElement | null = null;
    private subBtn: HTMLButtonElement | null = null;
    /** 「选集」入口（单文件 / 电影不建） */
    private epBtn: HTMLButtonElement | null = null;
    /** 设置齿轮：**低频项都收在这**（画中画 / 用系统播放器打开） */
    private gearBtn: HTMLButtonElement | null = null;
    // 🔴 2026-11-07 用户逐字：「播放器画中画按钮收到在设置里」⇒ 这里曾有 `private pipBtn`
    //    与配套的 `syncPipBtn()`，**一并删除**（死码不留）。画中画的入口现在就一处：
    //    齿轮弹窗里的「画中画 ›」动作行（`onSettingNav('pip')`）。
    //    ⛔ 别在控制条上加回第二颗 —— 同一功能两个入口，用户会以为其中一个是坏的。
    /** 「全屏」按钮（= 标签页全屏）：`protected` ⇒ 覆写 `buildFsButtons()` 的子类要把「那颗」交回来 */
    protected fsBtn: HTMLButtonElement | null = null;
    /** 「全屏+」按钮（= 浏览器真全屏）：`onFsChange` 靠它切 `maximize-2` / `minimize-2` 与高亮态。
     *  ⚠️ 只有**播放器页**建这颗（基类 `buildFsPlusButton()`）；选集页覆写过 `buildFsButtons()`
     *     且不调它 ⇒ 详情页永远没有这颗，符合用户「只在全屏页加」的原话。 */
    private fsPlusBtn: HTMLButtonElement | null = null;
    /** 底部控制条容器：既是单行布局的父级，也是浮层定位的包含块（浮层是它的绝对定位子元素） */
    private controlsEl: HTMLElement | null = null;
    /** 浮层容器（选集 / 倍速 / 设置共用同一个，内容按 kind 重建） */
    private menuEl: HTMLElement | null = null;
    /** 当前打开的浮层种类（null = 全关） */
    private menuKind: PlayerMenuKind | null = null;
    /** 当前浮层的触发按钮：外点判定必须放行它，否则「再点一次入口按钮关浮层」会被外点逻辑抢先关掉、开关错乱 */
    private menuTriggerBtn: HTMLElement | null = null;
    /** 浮层外点关闭监听已挂（onClose 对称移除） */
    private menuOutsideBound = false;
    /** 🔴 m04435 ① 右键「时间戳笔记」浮层的挂载点（绝对定位在 `.rl-vp-root` 内，收起时必须置 null） */
    private stampNoteEl: HTMLElement | null = null;
    /** 🔴 m04435 ① 浮层实例（同一时刻最多一个；再点右键先销毁旧的） */
    private stampNotePopover: StampNotePopover | null = null;
    /** 播放器开关的**可变副本**：用户当场切换必须立即生效，不能回读 opts 快照（那是打开时的值）。
     *  初值在 openWith 里从 opts 取；缺省与「设置字段缺省」保持一致。 */
    private bgPlay = false;
    /** 🔴 #604 播放模式（取代旧的 `autoNext` / `loopOne` 两个布尔） */
    private playMode: PlayMode = 'listLoop';
    /** 🔴 #604 连播面板当前倒计时的**目标集下标**（列表循环会绕回第一集，⛔ 不能再假设是 `cur+1`） */
    private nextTarget: number | null = null;
    /** 画面中央的极简播放按钮（用户 2026-09-18 替换旧的 64px 深色圆钮；显隐由 CSS 表达，这里只管图标） */
    private centerPlayEl: HTMLElement | null = null;
    private toastEl: HTMLElement | null = null;
    /** 舞台里的「没有可播放的本地视频」提示层（`render()` 按有无本地项显隐）。
     *  🔴 为什么必须有它：纯网络条目（`episodeFiles` 为空、只有 `episodeUrls`）的 `items` 是空数组，
     *     `render()` 会从 `if (!opts || !item) return;` 提前返回 ⇒ 既不设 `src` 也不给任何提示，
     *     用户看到的就是一个 `readyState=0` 的黑壳，点它当然播不了（真机实测：退出内嵌播放器后
     *     `videoEl.src` 为空串、`readyState=0`，`emptyBox:false` 即连占位都没有）。 */
    private emptyStageEl: HTMLElement | null = null;
    /** 占位层的转圈与文案（`setEmptyStageMode()` 要按「加载中 / 未关联」两种形态切换） */
    private emptyStageSpinEl: HTMLElement | null = null;
    private emptyStageTitleEl: HTMLElement | null = null;
    private nextPanelEl: HTMLElement | null = null;
    private nextPanelTextEl: HTMLElement | null = null;
    /** error 已触发标志：防止 error 期间再次切源/兜底重复调用 */
    private failed = false;
    /** 进度条拖动中（拖动期间不自动隐藏控制条、不响应 timeupdate 覆盖） */
    private dragging = false;
    /** 控制条闲置隐藏定时器 */
    private idleTimer: number | null = null;
    /** 单击判定定时器（与双击全屏区分） */
    private clickTimer: number | null = null;
    /** 位置写回节流定时器 + 上次已写秒数（避免重复写） */
    private posTimer: number | null = null;
    private lastSavedSeconds = -1;
    /** 打开/切集后待恢复的位置（秒；metadata 就绪时消费一次） */
    private pendingResume = 0;
    /** 字幕：同目录候选 + 当前挂载的 Blob URL */
    private subCandidates: SubtitleCandidate[] = [];
    private subUrl: string | null = null;
    /** 当前挂载的字幕标识（候选文件名 / 外部文件名；用于弹窗高亮） */
    private subFile: string | null = null;
    /**
     * 当前挂载字幕的**完整路径**（持久化用）。
     * 🔴 与 `subFile` 分开存：`subFile` 只是文件名（弹窗高亮 / 高亮比对），
     *    而写回 catalog 必须写**能重新打开它的路径**（库外字幕要是绝对路径，光存文件名下次就找不到）。
     */
    private subPath: string | null = null;
    /** #605「显示字幕」开关态（false = 隐藏但**保留**已挂载轨道，再打开即原样点亮） */
    private subVisible = true;
    /** 字幕原文缓存（`subtitleRawText()` 用）：键 = 解析后的完整路径。
     *  🔴 `timeupdate` 每秒约 4 次，⛔ 别在每条 tick 上重读文件。 */
    private subTextCache: { key: string; text: string } | null = null;
    /** 连播：倒计时定时器 + 截止时间戳 */
    private nextTimer: number | null = null;
    private nextDeadline = 0;
    /** toast 定时器 */
    private toastTimer: number | null = null;
    /** 全屏态监听（onClose 对称移除） */
    private fsListenerBound = false;
    /**
     * 可见性 / 省电（用户 2026-09-18：「后台或不可见时自动停止渲染，释放 GPU 和内存」）。
     * 三路信号**任一为否**即视为不可见 —— 单一信号都有盲区：`document.hidden` 看不到页签切换、
     * `.isShown()` 看不到窗口最小化、IO 看不到真·后台窗口，合判才不漏。
     */
    private vis = {
        /** document.visibilityState === 'visible'（窗口最小化 / 切到别的应用） */
        doc: true,
        /** 容器 `.isShown()`（页签被切走 / 面板收起；Obsidian 自带 API） */
        leaf: true,
        /** 舞台落在视口内（IntersectionObserver；兜住布局裁切等意外情形） */
        viewport: true,
        /** 上一次判定结果：只在**边沿**动作，事件密集时不空转 */
        visible: true,
        /** 首次判定不入账：视图刚挂载时元素可能还没测量出尺寸，误判会把刚要播的视频暂停 */
        primed: false,
        /** 因不可见而暂停 → 恢复可见时自动续播（用户选定口径） */
        resume: false,
        /** 不可见超时后「彻底释放」的现场（null = 未释放）；回来据此重建并跳回原位 */
        deep: null as { pos: number; playing: boolean } | null,
        /** 不可见计时（到点走 deepRelease） */
        timer: null as number | null,
        /** 容器可见性观察器（onClose 断开） */
        observer: null as IntersectionObserver | null,
        /** document 可见性监听已挂（onClose 对称移除） */
        bound: false,
    };

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        // 纯播放视图：不参与「导航/文件」语义（不显示文件面包屑、不记历史）
        this.navigation = false;
    }

    getViewType(): string {
        return VIDEO_PLAYER_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.opts?.entryTitle ?? '播放器';
    }

    getIcon(): string {
        return 'film';
    }

    async onOpen(): Promise<void> {
        // View.scope 默认 null（见 obsidian.d.ts）→ 自建子 scope，播放器为活动页时接管快捷键
        const scope = new Scope(this.app.scope);
        this.scope = scope;
        this.bindKeys(scope);
        // 容器打点：CSS 据此去 .view-content 默认内距/滚动、并隐藏该视图页头
        this.containerEl.addClass('rl-vp-view');
        this.contentEl.addClass('rl-vp');
        document.addEventListener('fullscreenchange', this.onFsChange);
        this.fsListenerBound = true;
        // 省电：不可见即停渲染（窗口可见性 + 容器显示状态 + 舞台是否在视口）
        this.bindVisibility();
        if (this.opts) this.buildUi();
        else this.renderEmpty();
        this.opened = true;
    }

    /** 窗口 / 面板尺寸变化：抽屉的上下边距是**量出来的**（顶栏与控制条高度随字号、全屏、分屏而变）
     *  ⇒ 这里跟着重算一次；同时把「当前那条」重新滚进视野（列表高度变了）。收起时什么都不做。 */
    onResize(): void {
        if (!this.drawerOpen) return;
        this.syncDrawerInset();
        this.syncDrawerActive(true);
    }

    async onClose(): Promise<void> {
        // 位置落盘（关闭立即写，防最后一次进度丢失）
        this.savePosition(true);
        // 🔴 m04435 ①：关播放器时摘掉右键浮层（它挂在 root 里，root 会被重建 ⇒ 留着就是孤儿 DOM）
        this.closeStampNotePopover();
        // 「全屏+」还开着就把标签页关了 ⇒ 主动退出浏览器全屏，别把整块屏幕留给一个已销毁的视图。
        // （浏览器通常也会因为全屏元素被移除而自动退出，但不该指望它，尤其切标签页时不一定会派发。）
        try {
            if (document.fullscreenElement && document.fullscreenElement === this.playerHost()) {
                void document.exitFullscreen?.().catch(() => {});
            }
        } catch { /* 环境不支持就忽略，关闭流程不能被它打断 */ }
        if (this.fsListenerBound) {
            document.removeEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerBound = false;
        }
        if (this.menuOutsideBound) {
            document.removeEventListener('pointerdown', this.onDocPointerDown, true);
            this.menuOutsideBound = false;
        }
        this.unbindVisibility();
        this.cancelDeepRelease();
        this.clearTimers();
        // `landSeek` 的 250ms 重试定时器不在 `clearTimers()` 里（换集时要让它继续追落位），
        // 但关页必须拆：否则关了标签页还在往已拆的 <video> 上写 currentTime。
        if (this.seekLandTimer !== null) {
            window.clearTimeout(this.seekLandTimer);
            this.seekLandTimer = null;
        }
        this.seekLandTarget = null;
        this.clearSubtitle();
        // 停播释放：清除 src 释放文件句柄/解码资源
        this.releaseMedia();
        // 🔴 用户 2026-11-10 裁定：「多音源但关闭标签页即彻底暂停」—— 关掉这个标签页，
        //    它里面**所有**媒体都必须停，不能只停 `this.videoEl` 那一颗。
        //    真机踩到的漏网之鱼是官方内嵌 iframe：`contentEl.empty()` 把 <iframe> 从 DOM 摘掉后，
        //    Electron 的 OOPIF 子进程仍可能继续送音频（用户报「关了标签页声音都还在」）。
        //    所以先把每颗 <video>/<audio> 停掉并清源，再把每个 <iframe> 打回 about:blank 后摘除。
        this.silenceAllMedia(this.contentEl);
        this.contentEl.empty();
    }

    /** 关标签页的兜底静音：把 root 下所有媒体停掉、所有 iframe 打回空白。
     *  ⛔ 别删：这是「关闭标签页即彻底暂停」的最后一道闸 —— `releaseMedia()` 只管 `this.videoEl` 一颗，
     *  网络集的官方内嵌 iframe、EPUB 阅读器的 iframe 都不在它管辖内。 */
    protected silenceAllMedia(root: HTMLElement): void {
        root.querySelectorAll('video, audio').forEach((m) => {
            try {
                const el = m as HTMLMediaElement;
                el.pause();
                el.removeAttribute('src');
                el.load();
            } catch {
                /* 尽力而为：个别元素已销毁时不阻断关闭 */
            }
        });
        root.querySelectorAll('iframe').forEach((f) => {
            try {
                // 先打回空白（立刻掐断子帧的解码与音频），再从 DOM 摘掉
                f.setAttribute('src', 'about:blank');
            } catch {
                /* 尽力而为 */
            }
            f.remove();
        });
    }

    /** 载入播放内容（main 层在 setViewState 后调用；同一标签页可反复换片，不必新开）
     *  注：方法名不能叫 load —— ItemView 基类已占用 load()（视图生命周期），签名不同会编译失败 */
    openWith(opts: VideoPlayerOptions): void {
        this.opts = opts;
        // 打开那一刻的快照：后台播放（#605 起只读，开关在设置页）/ 播放模式（单值，旧的两个布尔已在 main 层迁移掉）。
        // 🔴 播放模式取一份可变副本（用户当场点「播放模式」循环切换要立即生效）。
        this.bgPlay = !!opts.backgroundPlay;
        this.playMode = opts.playMode ? normalizePlayMode(opts.playMode) : 'listLoop';
        this.nextTarget = null;
        const n = opts.items.length;
        this.cur = Math.max(0, Math.min(opts.startIndex, n - 1));
        // 时间戳链接定位（#326）：opts 只是「打开那一刻」的快照，故取一份可变副本，消费后置 null
        this.pendingSeek = opts.pendingSeek ? { ...opts.pendingSeek } : null;
        // 已挂载就整屏重建；未挂载（Obsidian 延迟渲染）则只记 opts，交给 onOpen
        if (this.opened) this.buildUi();
        // 标签页标题跟随片名：Obsidian 只在特定时机刷新 tab header，复用同一标签页换片时得手动刷一次，
        // 否则标题会停在上一部片名。整段收进 `refreshLeafHeader()` 一处，
        // 让「换片」与「条目改名」两条路共用同一份实现（⛔ 别再在这儿展开第二份）。
        this.refreshLeafHeader();
    }

    // ── 子类扩展点（#691 B 站风选集页 `EpisodePageView`，2026-10-27）───────────────
    //  🔴 这里**只加钩子**，上面任何一条既有逻辑都不动：产物断言把处数逐字钉死了
    //    （生命周期标志的置位、rootEl 的两处赋值、`if (this.opened) …buildUi` 那行、
    //      互斥函数里的暂停调用 —— 全部按「恰好几处」计数，多一个字面就红）。
    //  ⚠️ 所以子类**不能**自己再写一遍这些行，只能靠下面的受保护读数 + 覆写钩子。
    //  ⚠️ 本文档注释里也**不许**写出那些被计数的字面语句（本批首跑就这么自己撞红过）。

    /** 播放器骨架挂在哪个容器下（默认 `contentEl`；选集页覆盖它，返回「两栏」里的左栏） */
    protected playerHost(): HTMLElement {
        return this.contentEl;
    }

    /** 控制条右组的**全屏区**：基类默认画一个全屏按钮；子类覆写它就能塞两个（全屏 / 全屏+）。
     *  🔴 覆写者必须自己把「真全屏那个按钮」赋给 `this.fsBtn` —— `onFsChange` 靠它切 `minimize` / `maximize`。
     *  ⚠️ 为什么不传插槽出来、让子类先建好再回填：那要求「建槽」与「填槽」跨两个时机，
     *     子类字段还没初始化就会先被问一次（时序炸）。一个钩子把「建 + 填 + 回交 fsBtn」一次做完，没有缝隙。
     *
     * 🔴 用户 2026-11-06「两页互跳」：带了 `onBackToEpisodePage`（从选集页交接进来）时，这颗按钮
     *    改义为「返回选集页」，图标用 `minimize`（语义是「退出放大态」而不是「进入全屏」）。
     *    ⚠️ 此时**不回交 `fsBtn`**：本实例没有「浏览器真全屏」这条通路了，`onFsChange` 没东西可切。 */
    /**
     * 控制条右组**全屏区**。基类规则（用户 2026-11-09 裁定 + 2026-11-23 追加）：
     *  - 有 `onBackToEpisodePage`（从选集页交接进来）⇒「返回选集页」（图标 `minimize`）+「全屏+」。
     *  - 否则 ⇒「全屏」（走 `toggleFullscreen()` = 标签页全屏）+「全屏+」。
     *
     * 🔴 用户 2026-11-09 裁定（逐字）：「这个播放器的全屏按钮怎么有两种全屏状态啊，
     *    给我改成纯以前的标签页全屏，而不是整个电脑屏幕全屏」
     *    ⇒ 「全屏」这颗**不是**浏览器全屏，也**只有一种状态**。
     *
     * 🔴 用户 2026-11-23 追加（②）：**播放器页**要有一颗「全屏+」——即浏览器真全屏（`requestFullscreen`），
     *    与「全屏」（标签页全屏）并存、语义互不覆盖；用户原话「只在全屏页加，不要加到详情页」。
     *    ⚠️ 两条边界，改这里前先读：
     *      · 详情页（`EpisodePageView`）**覆写**了本方法且不调 `buildFsPlusButton()` ⇒ 它永远没有这颗。
     *        ⛔ 别在 `EpisodePageView.buildFsButtons()` 里补 —— 那就是把按钮加回详情页。
     *      · 「全屏+」不复用 `this.fsBtn`：两颗按钮两种态，混用会让图标跟着浏览器全屏乱跳
     *        （正是 2026-11-09 那次「两种全屏状态」困惑的成因）。它有自己的 `fsPlusBtn`。
     *
     * ⚠️ 为什么不传插槽出来、让子类先建好再回填：那要求「建槽」与「填槽」跨两个时机，
     *     子类字段还没初始化就会先被问一次（时序炸）。一个钩子把「建 + 填 + 回交 fsBtn」一次做完，没有缝隙。
     */
    protected buildFsButtons(_right: HTMLElement): void {
        const back = this.opts?.onBackToEpisodePage;
        if (back) {
            const btn = _right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '返回选集页' } });
            safeSetIcon(btn, 'minimize');
            btn.addEventListener('click', () => back(this.videoEl?.currentTime ?? 0));
            this.buildFsPlusButton(_right);
            return;
        }
        const fsBtn = _right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '全屏（F）' } });
        safeSetIcon(fsBtn, 'maximize');
        fsBtn.addEventListener('click', () => this.toggleFullscreen());
        this.fsBtn = fsBtn;
        this.buildFsPlusButton(_right);
    }

    /** 建「全屏+」按钮（= **浏览器真全屏**，把整块屏幕交给播放器）。
     *
     *  🔴 用户 2026-11-23（②）：「播放器全屏页加一个全屏+按钮，只在全屏页，不要加到详情页」。
     *     与「全屏」（`toggleFullscreen()` = 纯 CSS 标签页全屏，只铺满 Obsidian 窗口）是**两件事**：
     *       · 全屏   ⇒ 影响 Obsidian 窗口内的观感，不动显示器；
     *       · 全屏+  ⇒ 走浏览器 Fullscreen API，接管整块显示器（Electron 层全屏）。
     *     两颗并存正是用户这次要的：小屏看片用前者，投影/大屏用后者。
     *
     *  ⚠️ 目标元素用 `playerHost()` 而**不是** `this.containerEl`：
     *     `containerEl` 是 `.workspace-leaf`，Obsidian 布局代码会往它身上写内联尺寸，
     *     全屏后退出时容易残留错位；`playerHost()` 是视图自己的 `contentEl`（选集页覆写成左栏），
     *     层级干净、退出即恢复。
     *  ⚠️ 必须**在点击的调用栈里**调 `requestFullscreen()`：浏览器要求用户手势，
     *     异步等待之后再调会被拒（`NotAllowedError`）。这里没有 await，直接在 click 回调里发。
     *  ⚠️ 失败要静默吞掉并给提示：Obsidian 桌面端对 `requestFullscreen` 的支持随版本变化，
     *     抛错不该连累控制条（同仓 `PdfReaderModal.toggleFullscreen` 的既有口径）。
     *  ⚠️ 状态同步只认 `fullscreenchange`：用户可能按 Esc 或 F11 退出全屏，
     *     那不是走这颗按钮，必须靠事件回读 `document.fullscreenElement`（见 `onFsChange`）。 */
    private buildFsPlusButton(right: HTMLElement): void {
        const btn = right.createEl('button', {
            cls: 'rl-btn rl-vp-btn rl-vp-iconbtn',
            attr: { 'data-tip': '全屏+（占满整块屏幕）', 'data-fsplus': '1' },
        });
        safeSetIcon(btn, 'maximize-2');
        btn.addEventListener('click', () => void this.toggleBrowserFullscreen());
        this.fsPlusBtn = btn;
        this.syncFsPlusBtn();
    }

    /** 「全屏+」的真身：进出**浏览器真全屏**（整块显示器），⛔ 不是标签页全屏。 */
    private async toggleBrowserFullscreen(): Promise<void> {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen?.();
                return;
            }
            const target = this.playerHost();
            await target.requestFullscreen?.();
        } catch {
            // 不支持 / 被策略拒绝 / 不是用户手势：静默，控制条照常可用
            new Notice('当前环境不支持全屏+');
        }
    }

    /** 按 `document.fullscreenElement` 回读真全屏态，同步「全屏+」的图标与高亮。
     *  ⚠️ 只在**本视图自己**处于真全屏时才点亮：别的插件/别的视图推进全屏时，
     *     这颗按钮并不代表那个状态，点亮就是假信号。 */
    private syncFsPlusBtn(): void {
        const el = this.fsPlusBtn;
        if (!el) return;
        const host = this.playerHost();
        const on = !!document.fullscreenElement && document.fullscreenElement === host;
        const icon = on ? 'minimize-2' : 'maximize-2';
        // 图标重画前先清空：`setIcon()` 是「插入」，不清会叠出两层 svg（本仓踩过）
        if (el.querySelector('svg')?.getAttribute('data-icon') !== icon) {
            el.empty();
            safeSetIcon(el, icon);
        }
        el.toggleClass('is-on', on);
        el.setAttribute('data-tip', on ? '退出全屏+（回到窗口内）' : '全屏+（占满整块屏幕）');
    }

    /**
     * Esc 优先级链的**最前面一层**：子类有自己的浮层（选集页的条目右键菜单）时，
     * 在这里收掉并返回 `true`，基类就不再往下走。
     *
     * 🔴 用户 2026-11-08 选集页加了简介封面右键菜单，而那个组件（`EntryContextMenu`）
     *    **自己也监听 window keydown 的 Esc**。两套 Esc 同时活着时，一次按键会关掉两层
     *    （菜单没了、抽屉也关了）—— 本仓 #444 就是这类事故（"关掉菜单顺手把系列视图也退了"）。
     *    ⇒ 统一到这一条链上：子类先收，收掉了就 `return true` 短路。
     * ⚠️ 组件自带的 window 监听**不用拆**：它和这里是同一时刻消费同一个事件，
     *    都只是把菜单关掉（幂等）。真出问题的是「关菜单」连带「关别的东西」，这里挡住的就是它。
     */
    protected closeExtraOverlay(): boolean {
        return false;
    }

    /** 骨架搭好之后的追加钩子（选集页用它填右侧栏；默认什么都不做） */
    protected buildExtra(_root: HTMLElement): void {
        // 默认无追加内容
    }

    /** 每次换片 / 切集重画之后的追加钩子（选集页用它同步「当前集」高亮；默认什么都不做） */
    protected afterRender(): void {
        // 默认无追加动作
    }

    /** 字幕候选 / 当前挂载项变化后的追加钩子（选集页用它重画字幕列表；默认什么都不做） */
    protected afterSubtitles(): void {
        // 默认无追加动作
    }

    /** 当前播放项在 `items` 里的下标（0 基） */
    protected curIndex(): number {
        return this.cur;
    }

    /** `items` 长度 */
    protected itemCount(): number {
        return this.opts?.items.length ?? 0;
    }

    /** 真实集下标（`items[].index`，= `episodeFiles` 数组位）→ `items` 下标；找不到返回 -1 */
    protected itemPosOf(epIndex: number): number {
        const items = this.opts?.items ?? [];
        return items.findIndex((it) => it.index === epIndex);
    }

    /** 切到 `items` 里的第 i 项（选集格点击用；越界 / 同一集由 `goto` 静默忽略） */
    protected switchToItem(i: number): void {
        this.goto(i);
    }

    /**
     * **就地换掉播放列表**（宿主在「条目关联被人改过」时推一份新的进来）。
     *
     * 🔴 用户 2026-11-16 逐字：「播放器详情页的右键更新了关联入口链接，但视频播放器不刷新」
     *    —— 根因是结构性的：`items` 是 `openEpisodePageFor` 打开那一刻算好的快照，
     *    之后**没有任何通路**能让它变成新的（`refreshEntrySnapshot` 只重画标题块与简介卡）。
     *    ⛔ 别改成「重新 `openWith` 一次」：那会把播放位置、当前集、字幕绑定全丢，
     *    用户要的是「改了关联，页面自己跟上」，不是「页面被打断重开」。
     *    ⛔ 也别试图重建整个 `opts` 对象 —— 见 `openWith` 的注释，活状态都挂在它上面。
     *
     * ⚠️ 当前集按 **`items[].index`（真实集下标 = `episodeFiles` 数组位）** 重新定位，
     *    ⛔ 不能按数组位对齐：删掉中间一集就会「看着第 5 集、其实在播第 4 集」。
     * ⚠️ 当前集的 `url` / `path` / `title` 变了 ⇒ 必须重挂源（不重挂就会一直播旧链接，
     *    正是用户报的那个症状）；没变则一个字节都不动，播放不中断。
     */
    protected replaceItems(next: readonly EmbedVideoItem[]): void {
        const opts = this.opts;
        if (!opts) return;
        const prevItem = opts.items[this.cur];
        // 就地改内容而不是换数组：`opts` 是活引用，`fillMenu` / `goto` / `itemPosOf`
        // 全都按 `opts.items` 取值，换数组就会出现「一半新一半旧」的两份真源。
        opts.items.length = 0;
        for (const it of next) opts.items.push({ ...it });
        const keep = prevItem ? prevItem.index : -1;
        const found = keep >= 0 ? opts.items.findIndex((it) => it.index === keep) : -1;
        if (found < 0) {
            // 当前集已被解除关联（或原本就没有本地可播集）⇒ 从头开始。
            // 这里必须走 `render()`：它是**唯一**会重设 `src` / 空态 / 上下一集置灰的出口，
            // 少了它画面会停在一条已经不存在的路径上（黑壳 + 点不动）。
            this.cur = 0;
            this.closeMenu();
            this.render();
            return;
        }
        const after = opts.items[found];
        const changed = !prevItem
            || after.url !== prevItem.url
            || after.path !== prevItem.path
            || after.title !== prevItem.title;
        this.cur = found;
        if (changed) {
            this.closeMenu();
            this.render();
            return;
        }
        // 同一集、同一源 ⇒ 只同步「边界按钮」这一处派生状态（⛔ 别调 render：它会 pause + 重设 src）
        if (this.prevBtn) this.prevBtn.disabled = after.isFirst;
        if (this.nextBtn) this.nextBtn.disabled = after.isLast;
        this.syncEmptyStage(false);
        // 选集浮层若开着，它的条目还是上一份列表画的 ⇒ 收掉（⛔ 别留一份过期菜单）
        if (this.menuKind === 'episodes') this.closeMenu();
    }

    /** 片名（选集页标题用） */
    protected entryTitle(): string {
        return this.opts?.entryTitle ?? '';
    }

    /**
     * 让标签页标题跟上片名（Obsidian 不在 `setText` 时自动重画 tab header）。
     *
     * 🔴 为什么收成方法（2026-11-08，用户 m04478「从播放器详情页简介封面右键菜单修改了
     *    但当前播放页没有实时生效」）：原本这段只写在 `openWith()` 里 —— 那是「换片」这条路。
     *    「条目改名」走的是另一条路（宿主把最新条目推给已打开的页），它拿不到这段代码，
     *    于是标签页标题永远停在打开那一刻的片名上。
     *    ⇒ 两条路共用本方法，⛔ 别再在任何一个调用点展开第二份（产物里这个词被按次数钉死）。
     */
    private refreshLeafHeader(): void {
        // 未进公开 d.ts ⇒ 窄化断言后可选调用
        const leaf = this.leaf as unknown as { updateHeader?: () => void };
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
    }

    /**
     * 「这一条的片名变了」—— 宿主在条目被编辑保存后调用，重画本视图里所有跟着片名走的地方。
     *
     * 🔴 片名在本视图里有**三个落点**，改一处漏一处就是用户看到的「没实时生效」：
     *    ⑴ 顶栏片名（`restoreLocalTitle` 用 `opts.entryTitle` 拼「片名 · 第 N 集」）；
     *    ⑵ 标签页标题（`getDisplayText()` 读 `entryTitle()`）；
     *    ⑶ 播放器菜单/抽屉里由子类画的副本（子类覆写本方法的扩展点见 `onEntryTitleChanged`）。
     * ⚠️ `opts` 是**打开那一刻的快照**（本仓既定口径，改标题只许走这里更新那一字段，
     *    ⛔ 别试图把整个 opts 重建成新对象：`items` / 播放位置 / 字幕绑定都挂在上面）。
     * @param title 新片名；空串按「没有片名」处理（子类会退化成「选集」这类兜底文案）
     */
    applyEntryTitle(title: string): void {
        if (!this.opts) return;
        if (this.opts.entryTitle === title) return;
        this.opts.entryTitle = title;
        this.restoreLocalTitle();
        this.refreshLeafHeader();
        this.onEntryTitleChanged(title);
    }

    /** 片名变化后的子类扩展点（默认空实现；选集页据此重画标题块）。 */
    protected onEntryTitleChanged(_title: string): void {
        // 默认什么都不做 —— 纯播放器页只有顶栏与标签页两处，已由 applyEntryTitle 处理完
    }

    /** 单文件 / 电影态 */
    protected isSingle(): boolean {
        return this.opts?.single === true;
    }

    /** 字幕现场快照（候选 + 当前挂载 + 是否显示）——
     *  选集页右侧栏只读它，⛔ 不另存一份（两套真源必然漂）。 */
    protected subtitleSnapshot(): { candidates: SubtitleCandidate[]; file: string | null; visible: boolean } {
        return {
            candidates: this.subCandidates.slice(),
            file: this.subFile,
            visible: this.subVisible && !!this.subFile,
        };
    }

    /** 点一条字幕（选集页右侧栏用；内部走既有 `applySubtitle`，⛔ 不另写一套挂载） */
    protected chooseSubtitle(fileName: string): void {
        void this.applySubtitle(fileName);
    }

    /** 开关字幕显示（选集页右侧栏用） */
    protected setSubtitleShown(on: boolean): void {
        void this.setSubtitleVisible(on);
    }

    /** 让本视图的 video 停声（选集页参与播放互斥用）。
     *  ⚠️ 刻意**不**复用 `pauseForOtherPlayer` —— 那个方法名带前导点只许 1 处调用点，是另一条计数断言。 */
    protected pauseVideo(): void {
        this.videoEl?.pause();
    }

    /** 当前**真实集下标**（`items[].index`，= `episodeFiles` 数组位）；没有内容 ⇒ -1。
     *  ⚠️ 与 `curIndex()` 不是一回事：`curIndex()` 是 `items` 数组位（跳过了不可内嵌的集），
     *     选集页画「第 N 集」必须用这个真实下标。 */
    protected currentEpisodeIndex(): number {
        return this.opts?.items[this.cur]?.index ?? -1;
    }

    /** 打开系统文件选择器挑一个字幕并挂载（选集页右栏的「从文件选择」用）。
     *  ⚠️ 内部走既有 `browseSubtitleFile` —— 挂载 / 失败提示 / `subFile` 写回全在基类，
     *     选集页只负责触发，⛔ 别另写一套。 */
    protected browseSubtitle(): void {
        void this.browseSubtitleFile();
    }

    /** 还原本地源需要的那点状态（`crossOrigin` 是抓帧免污染的关键，见 `#326`）。
     *  ⚠️ 2026-11-24：原来这里还要复位 `netPlayback` 标记（网络流占着主 `<video>` 时置位），
     *     网络源整条链路删掉后（用户 m01744）只剩「装回 crossOrigin」这一件事。 */
    protected restoreLocalSourceHints(): void {
        if (this.videoEl && !this.videoEl.crossOrigin) this.videoEl.crossOrigin = 'anonymous';
    }

    /**
     * 重新按当前集挂载本地源。
     *
     * 🔴 为什么不能借 `switchToItem(curIndex())`：`goto()` 在 `idx === cur` 时**直接 return**
     *    （那是防「点当前集」的空跳），这里恰恰是「集没变、但主播放器被网络流占过」的场景。
     * ⇒ 直接走 `render()`，它是本地源的唯一入口（重设 src / 标题 / 占位层）。
     */
    protected rerenderCurrent(): void {
        this.render();
    }

    /**
     * 把顶栏片名还原成「按当前播放项算出来的」那个口径。
     *
     * 🔴 为什么不在这里重算一遍拼接：`render()` 里那份 `episodeLabel(item, single)` 是唯一真源
     *    （单文件态写「文件 N」、多集写「第 N 集」，还带 entryTitle 拼接）。这里再拼一次必然走味。
     * ⇒ 抽成这个方法给 `render()` 与「退出网络播放」两处共用。
     */
    protected restoreLocalTitle(): void {
        const opts = this.opts;
        if (!opts) return;
        // 2026-11-24：网络源整条链路已删（用户 m01744）⇒ 标题只有「本地集」这一种口径，
        // 原 `opts.netSource` 分支（走 `opts.netTitle`）随功能一起移除，⛔ 别再补回来。
        const item = opts.items[this.cur];
        const label = item ? episodeLabel(item, !!opts.single) : '';
        this.titleTextEl?.setText(label ? `${opts.entryTitle} · ${label}` : opts.entryTitle);
    }

    /** 视频元素读数（选集页要挂自己的 `timeupdate` 监听、读当前秒）。
     *  🔴 只交出元素本身，⛔ 不搬基类任何播放逻辑过来 —— 播放/暂停/跳转仍走基类那条唯一通路。 */
    protected videoElement(): HTMLVideoElement | null {
        return this.videoEl ?? null;
    }

    /**
     * 当前播放项的**本地原始路径**（`items[cur].path`：库内相对 / 系统绝对都可能有）；没有 ⇒ `null`。
     *
     * 🔴 为什么必须由基类给（2026-12 加 ASR 时踩到的墙）：`opts` 是 **private**，子类拿不到
     *    `items[].path`；而 `.src` 那条 `app://` / `http` 资源 URL 是宿主转过的，
     *    ⛔ 反过来当文件路径喂给外部程序（ffmpeg / whisper）必然找不到文件。
     *    字幕那条链（`subtitleRawText` / `autoLoadSubtitle`）一直用的就是这一个字段，
     *    这里只是把同一份口径**读出去**，⛔ 不另算一条路径。
     * ⚠️ 网络集态下 `items` 可能为空 / 不含当前网络集 ⇒ 返回 `null`（调用方按「没有本地文件」处理）。
     */
    protected currentVideoPath(): string | null {
        const p = this.opts?.items[this.cur]?.path;
        return p && p.trim() ? p : null;
    }

    /**
     * 当前挂载字幕的**原文**（VTT / SRT / ASS 都可能，调用方按扩展名选解析器）。
     *
     * 🔴 只读一次就缓存：选集页面板的每次联动都发生在 `timeupdate`（每秒约 4 次）上，
     *    在那种频率上重读文件 = 把磁盘打成筛子。
     * ⚠️ 与 `applySubtitle` 用的是**同一份定位口径**（`subFile` + 当前集目录 + `loadSubtitleVtt`），
     *    ⛔ 不另立第二套「字幕在哪儿」的算法。
     */
    protected async subtitleRawText(): Promise<string | null> {
        const item = this.opts?.items[this.cur];
        if (!item || !this.subFile) return null;
        // 🔴 优先用 `subPath`（可能来自持久化记录 = 库外绝对路径，拼不上视频目录）；
        //    没有才退回「当前集目录 + 文件名」的老口径（同目录自动挂载那条路）。
        const dir = dirOfPath(item.path);
        const full = this.subPath ?? (dir ? `${dir}/${this.subFile}` : this.subFile);
        const cached = this.subTextCache;
        if (cached && cached.key === full) return cached.text;
        const text = await this.loadVtt(full);
        this.subTextCache = text === null ? null : { key: full, text };
        return text;
    }

    /** 跳到指定秒（选集页字幕行点击用）。
     *  ⚠️ 内部走既有 `applySeek` —— 夹取 / 自动播放 / 「已跳到 …」提示一字不另写。 */
    protected seekTo(seconds: number): void {
        this.applySeek(seconds);
    }

    /** 当前挂载的字幕文件名（`null` = 没挂；选集页面板据此决定画不画列表） */
    protected subtitleFileName(): string | null {
        return this.subFile;
    }

    /**
     * 控制条右组里「选集」「字幕」两枚按钮的就地引用（选集页按模式显隐用）。
     *
     * 🔴 只交出引用，⛔ 不在这里写任何显隐判断：哪一页该藏哪枚按钮是**页面口径**，
     *    播放器（单文件/普通页）永远两枚都该有。子类拿引用后自己 `toggleClass`。
     * ⚠️ 为什么不给「隐藏方法」：这两枚按钮的创建语句被产物断言逐字锚死（`rl-vp-textbtn` /
     *    `safeSetIcon(subBtn, "captions")` 前后的字节），加条件下创建会直接撞红 —— 只能事后加类。
     * 返回 `null` = 该按钮在当前上下文里根本没建（`single` 时不建选集按钮 / 没注入 `listSubtitles` 时不建字幕按钮）。
     */
    protected sideBarToggles(): { episodes: HTMLButtonElement | null; subtitles: HTMLButtonElement | null } {
        return { episodes: this.epBtn, subtitles: this.subBtn };
    }

    // ── 构建 ──

    /** 整屏重建（换片/切页签后复用同一视图） */
    private buildUi(): void {
        this.releaseMedia();
        this.clearTimers();
        // 换片 / 复用标签页时整屏重建：旧浮层随 contentEl.empty() 一起消失，状态必须同步作废，
        // 否则 syncMenuButtons 会去操作已脱离 DOM 的旧按钮、menuKind 也会指向一个不存在的浮层。
        this.menuKind = null;
        this.menuTriggerBtn = null;
        this.contentEl.empty();
        // ⚠️ 容器由 `playerHost()` 给（默认 contentEl）—— 选集页把它换成「两栏」里的左栏，
        //    这样播放器全套骨架 ＋ 右侧栏是**并列兄弟**，不用把播放器 DOM 搬来搬去（搬必丢播放状态）。
        const root = this.playerHost().createDiv({ cls: 'rl-vp-root' });
        this.rootEl = root;
        this.buildBar(root);
        this.buildStage(root);
        this.buildControls(root);
        this.buildToast(root);
        this.buildNextPanel(root);
        // #579 时间戳侧边栏（抽屉）：挂在 root 上、**绝对定位**，收起时 `display:none`。
        // 收起态**不参与布局也不溢出**（⛔ 不用 `transform: translateX(100%)` 那种「推出去」写法 ——
        // 它会撑出横向滚动；#553 那条「transform 建层叠上下文」的账也就跟着来了）。
        this.buildDrawer(root);
        // 闲置自动隐藏：鼠标在播放器内活动即浮出控制条
        root.addEventListener('mousemove', () => this.pokeIdle());
        root.addEventListener('mousedown', () => this.pokeIdle());
        // 鼠标移出即从这一刻重新计时（用户 2026-09-18：「移出 3 秒后自动隐藏」）——
        // 旧实现只在移动时重置，移出后剩的是「最后一次移动」起的残余计时，观感上「有时很快就不见了」。
        root.addEventListener('mouseleave', () => this.pokeIdle());
        // 🔴 #634：**进度条右键「在笔记中打开」整体撤除**（用户裁定见 `renderProgress` 那段注释）：
        //    那条通路连着「悬停出标记卡片」，而卡片的信息（种类 + 时间 + 说明 + 截图）现在由**抽屉**承载。
        //    ⇒ 这里连 `contextmenu` 监听一起撤（⛔ 别只删处理器 —— 留一个空监听等于留一个说不清的坑）；
        //      `.rl-vp-tip-mark` 卡片形态、`markAtPointer` / `hitMark` / `inBarBand` 三个命中判据
        //      与 `overCard` 一并作废（它们的唯一用途就是那条通路）。
        // 浮层外点关闭（捕获阶段，见 onDocPointerDown）：document 级监听挂一次即可，
        // 换片重建 root 时不重复挂 —— 故用 menuOutsideBound 守卫而不是无条件 addEventListener。
        if (!this.menuOutsideBound) {
            document.addEventListener('pointerdown', this.onDocPointerDown, true);
            this.menuOutsideBound = true;
        }
        this.render();
        this.buildExtra(root);
        this.pokeIdle();
    }

    /** 无播放内容（Obsidian 恢复上次布局时）：占位提示，避免一片黑 */
    private renderEmpty(): void {
        const root = this.contentEl.createDiv({ cls: 'rl-vp-root' });
        this.rootEl = root;
        const box = root.createDiv({ cls: 'rl-vp-empty' });
        box.createDiv({ cls: 'rl-vp-empty-title', text: '播放器' });
        box.createDiv({
            cls: 'rl-vp-empty-hint',
            text: '在条目里点「观看」按钮，视频会在这个标签页里播放',
        });
    }

    /** 顶栏：**只剩片名（含集号）**。
     *  2026-09-18 按 B 站控制条口径瘦身 —— 上一集 / 下一集 / 字幕 / ↗ 外部打开全部下移到控制条与设置齿轮，
     *  顶栏不再承载任何操作入口（「无自绘 ✕、关闭只经关闭标签页」的口径不变）。 */
    private buildBar(root: HTMLElement): void {
        const opts = this.opts;
        if (!opts) return;
        const bar = root.createDiv({ cls: 'rl-vp-bar' });
        const titleWrap = bar.createDiv({ cls: 'rl-vp-title-wrap' });
        this.titleTextEl = titleWrap.createDiv({ cls: 'rl-vp-title' });
        // 🔴 顶栏右组**无条件建**：选集页的网络流模式要把「在浏览器打开 / 退出播放」挂进来
        //    （用户 2026-11-05：网络集必须用插件自己的播放器，那两颗出口就没有别处可放了）。
        //    ⛔ 别改成「有 entryId 才建」：单文件预览 / 无笔记条目也要能退出网络播放。
        const tools = bar.createDiv({ cls: 'rl-vp-tools' });
        this.barToolsEl = tools;
        // #326「插入时间戳 / 截取当前帧」入口 —— 用户 2026-09-19 指定放**顶栏右上角**：
        // 控制条右侧功能组已有 6 项（选集/倍速/字幕/音量/齿轮/全屏），再塞两个会挤窄中段进度条；
        // 顶栏原本只有片名、留白充足。仅在有条目上下文（entryId）时才建 —— 单文件预览没有笔记可写。
        // 图标名 `clock` / `camera` 已对着 obsidian-1.13.7.asar 核实（`_probe_lucide.cjs`）。
        if (this.opts?.entryId) {
            const stampBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '插入时间戳（T）· 右键写时间戳笔记' } });
            safeSetIcon(stampBtn, 'clock');
            stampBtn.addEventListener('click', () => void this.insertStamp());
            // 🔴 m04435 ①：**右键 = 弹「时间戳笔记」浮层**（左键仍是原来的一键插入，行为一字未改）。
            //    与相邻 `shotBtn` 的右键批注同款纪律：必须 `preventDefault()` 挡掉原生右键菜单；
            //    ⛔ 只挂 `contextmenu` 不挂 `mousedown` 判 button（mousedown 里 preventDefault 会吞掉左键 click 派发链）。
            stampBtn.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.openStampNotePopover(stampBtn);
            });
            const shotBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '截取当前帧（S）· 右键批注' } });
            safeSetIcon(shotBtn, 'camera');
            shotBtn.addEventListener('click', () => void this.takeShot());
            // 🔴 m07854 ⑰：**右键 = 即时批注**（左键仍是原来的一键截图，行为一字未改）。
            //    ⚠️ 必须 `preventDefault()`：否则会先弹浏览器/宿主的原生右键菜单，批注窗口被压在下面。
            //    ⚠️ 只挂 `contextmenu` 不挂 `mousedown` 判 button：mousedown 里若 `preventDefault()`
            //       会连带吞掉左键的 click 派发链（实测会让左键截图偶发失效）。
            shotBtn.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                void this.annotateShot();
            });
            // 🔴 #579 时间戳侧边栏入口：放在**两枚标记按钮之后、打开笔记之前** ——
            //    ⑴ 与「时间戳 / 截图」同属标记那条线（就近读得懂）；
            //    ⑵ 既有判据钉着「打开笔记」必须**最右**（`截取当前帧` 的 index < `打开视频笔记` 的 index），
            //       插在这里那条判据照样成立，⛔ 别插到它后面去。
            //    图标 `panel-right-open` / `panel-right-close` 已核实（与阅读器的 `panel-left-*` 同族，
            //    一眼看得出是「侧栏」而不是「书签」）。
            const drawerBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '时间戳 / 截图列表' } });
            safeSetIcon(drawerBtn, 'panel-right-open');
            drawerBtn.addEventListener('click', () => this.toggleDrawer());
            this.drawerBtn = drawerBtn;
            // 顶栏**最右**（用户 2026-09-19 指定）：打开这条视频的笔记（缺笔记自动生成，分屏打开并聚焦）
            const noteBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '打开视频笔记' } });
            safeSetIcon(noteBtn, 'notebook-text');
            noteBtn.addEventListener('click', () => void this.opts?.onOpenNote?.());
        }
    }

    /** 视频区：白底舞台 + 主视频 + 暂停时的中央按钮；点画面播放/暂停、双击全屏。
     *  🔴 点击黑边（留白）**不再关闭**播放器 —— 用户 2026-09-17 裁定：只能通过关闭所在标签页退出，
     *  避免误触留白导致播放中断（旧实现：`stage` 自身 click → closePlayer）。
     *  🔴 留白 = `.rl-vp-stage` 的**白底**（用户 2026-09-18 二次裁定：不要高斯模糊、不要镜像 video）——
     *  主 video 保持 `object-fit: contain` + `background: transparent`，没被画面盖住的部分自然露白底。 */
    private buildStage(root: HTMLElement): void {
        const stage = root.createDiv({ cls: 'rl-vp-stage' });

        this.videoEl = document.createElement('video');
        // 自绘控件：关掉原生 controls（用户 2026-09-15 裁定）
        this.videoEl.controls = false;
        this.videoEl.playsInline = true;
        this.videoEl.preload = 'metadata';
        // 🔴 #326：抓帧必须**无 canvas 污染** —— 本地源是 `app://`（相对应用页 `app://obsidian.md` 属跨源），
        //    而 Obsidian 的资源协议响应带 `Access-Control-Allow-Origin: *`（1.13.7 实测）→
        //    只要**在设 src 之前**声明 `crossOrigin='anonymous'`，drawImage/toBlob 就不会被判污染（否则截图抛 SecurityError）。
        //    ⚠️ 该属性在**没有 CORS 头的远程 http 源**上会让加载直接失败 —— 本期源全为本地 app://，
        //    将来若支持远程视频必须**按源类型分支**设置。
        this.videoEl.crossOrigin = 'anonymous';
        this.videoEl.addEventListener('error', () => {
            const item = this.opts?.items[this.cur];
            if (!item || this.failed) return;
            this.failed = true;
            this.opts?.onExternalFallback(item.path);
            this.closePlayer();
        });
        this.videoEl.addEventListener('click', () => this.onStageClick());
        this.videoEl.addEventListener('dblclick', () => {
            if (this.clickTimer !== null) {
                window.clearTimeout(this.clickTimer);
                this.clickTimer = null;
            }
            this.toggleFullscreen();
        });
        this.videoEl.addEventListener('timeupdate', () => {
            if (!this.dragging) this.updateProgressUi();
            // #579 双向联动：当前所处的那一条自动高亮（未展开时直接返回，零开销）
            this.syncDrawerActive();
            this.savePosition();
        });
        this.videoEl.addEventListener('progress', () => this.updateProgressUi());
        this.videoEl.addEventListener('play', () => this.syncPlayState());
        this.videoEl.addEventListener('pause', () => {
            this.syncPlayState();
            this.rootEl?.removeClass('rl-vp-idle');
            this.savePosition(true);
        });
        this.videoEl.addEventListener('volumechange', () => this.syncVolumeUi());
        this.videoEl.addEventListener('loadedmetadata', () => {
            this.consumePendingTarget();
            // 时长要等元数据才有 → 标记百分比（抽屉跳转 / 高亮用）也在这里才算得准（#333；#634 起只剩抽屉）
            this.refreshMarks();
        });
        this.videoEl.addEventListener('ended', () => this.onEnded());
        stage.appendChild(this.videoEl);

        // 中央播放按钮（用户 2026-09-18 二次裁定：只在暂停时显示、满不透明、无悬停行为、无微动效）。
        // `pointer-events: none` → 点击一律落到主 video，与「点画面任意位置切播放/暂停」共用同一条通道，
        // 也避免「按钮 click + 冒泡到 video」两下互相抵消。显隐交给 CSS（`.rl-vp-paused`）。
        const ctr = stage.createDiv({ cls: 'rl-vp-centerplay', attr: { 'aria-hidden': 'true' } });
        safeSetIcon(ctr, 'play');
        this.centerPlayEl = ctr;

        // 🔴 用户 2026-11-15：「两个播放器空状态改成正在加载视频，不要显示这没有本地集的提示了」。
        //    改前这里写死「这一集没有本地视频 / 它是网络集，点上方集号就用插件播放器直接播；
        //    或在条目里补一个本地视频文件」—— 两份文案都在**把内部数据模型甩给用户**：
        //    用户不知道什么叫「本地视频」「条目里补一个」，他只知道「点开是黑的，还骂我」。
        //    更糟的是这层在黑壳上**先于**网络流挂载点亮（纯网络条目 `items` 为空 ⇒ 走的就是这条路），
        //    真机截图实测它压在正在播的画面正中间（同一时刻 `readyState=4` 在播）。
        //    ⇒ 现在这一层只说一句中性的「正在加载视频…」：无论在等本地文件解析、等取流、
        //      还是等 MSE 首片，用户看到的都是同一句「还没好，稍等」，而不是被指责配置缺失。
        //    ⚠️ 真的播不了时**不靠这一层交代**：那条路由 `Notice` 说清原因
        //      （见宿主 `handOffEpisodeToPlayer` 的取流失败分支），⛔ 别再往这里塞诊断文案。
        const empty = stage.createDiv({ cls: 'rl-vp-emptystage' });
        const emptySpin = empty.createDiv({ cls: 'rl-vp-emptystage-spin' });
        emptySpin.createSpan({ cls: 'rl-spinner rl-spinner-lg' });
        const emptyTitle = empty.createDiv({ cls: 'rl-vp-emptystage-title', text: '正在加载视频…' });
        this.emptyStageEl = empty;
        this.emptyStageSpinEl = emptySpin;
        this.emptyStageTitleEl = emptyTitle;

        // 🔴 旧实现在这里监听 stage 自身 click → closePlayer（点黑边退出），用户 2026-09-17 要求移除：
        // 点击留白不产生任何关闭响应，退出只经由关闭标签页。
    }

    /** 底部控制条（2026-09-18 按 B 站口径改**单行**）：
     *  左组（上一集 / 播放暂停 / 下一集）｜中段（进度条 + 时间）｜右组（选集 / 倍速 / 字幕 / 音量 / 齿轮 / 全屏）。
     *  🔴 进度条不再独占一整行，而是靠中段 `flex: 1` 吃掉「扣除左右组后的剩余宽度」——
     *  窄窗口下进度条会变短，这是单行化的必然代价（用户 2026-09-18 选定的方案 B）。
     *  🔴 画中画与「用系统播放器打开」下沉进设置齿轮（低频项不占控制条宽度）。 */
    private buildControls(root: HTMLElement): void {
        const opts = this.opts;
        const bar = root.createDiv({ cls: 'rl-vp-controls' });
        this.controlsEl = bar;
        const row = bar.createDiv({ cls: 'rl-vp-row' });

        // ── 左组 ──
        const left = row.createDiv({ cls: 'rl-vp-left' });
        if (opts && !opts.single) {
            const prev = left.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '上一集' } });
            safeSetIcon(prev, 'skip-back');
            prev.addEventListener('click', () => this.goto(this.cur - 1));
            this.prevBtn = prev;
        }
        this.playBtn = left.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '播放 / 暂停（空格）' } });
        safeSetIcon(this.playBtn, 'play');
        this.playBtn.addEventListener('click', () => this.togglePlay());
        if (opts && !opts.single) {
            const next = left.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '下一集' } });
            safeSetIcon(next, 'skip-forward');
            next.addEventListener('click', () => this.goto(this.cur + 1));
            this.nextBtn = next;
        }

        // ── 中段：进度条 + 时间（时间紧贴进度条右侧，B 站口径）──
        const mid = row.createDiv({ cls: 'rl-vp-mid' });
        const progress = mid.createDiv({ cls: 'rl-vp-progress' });
        this.progressEl = progress;
        this.bufferedEl = progress.createDiv({ cls: 'rl-vp-progress-buffered' });
        const played = progress.createDiv({ cls: 'rl-vp-progress-played' });
        this.playedEl = played;
        played.createDiv({ cls: 'rl-vp-progress-thumb' });
        // 🔴 #634：**进度条上不再画标记圆点**（用户裁定：「播放器上的进度条不再显示标记，并取消该跳转笔记功能，
        //    仅在抽屉侧边栏可点击跳转对应视频进度和关联时间戳笔记」）。
        //    ⇒ 承载圆点的 `.rl-vp-marks` 层整体退场（连 CSS 一起）；命中判定（`markHitAt`）与
        //      「点中圆点吸附」也随之作废 —— 没有圆点可看，却还偷偷吸附，是比不画更糟的行为。
        const tip = progress.createDiv({ cls: 'rl-vp-tip hidden' });
        this.tipEl = tip;

        progress.addEventListener('pointerdown', (ev) => this.onProgressDown(ev));
        progress.addEventListener('pointermove', (ev) => this.onProgressMove(ev));
        progress.addEventListener('pointerup', () => this.onProgressUp());
        progress.addEventListener('pointercancel', () => this.onProgressUp());
        progress.addEventListener('pointerleave', () => {
            // 🔴 #634：原先这里有一条「指针去够卡片里的按钮时别收气泡」的例外（`overCard`）——
            //    卡片已撤，气泡又是 `pointer-events: none` 的纯读数 ⇒ 离开进度条就该收起，规则回到最简。
            if (this.dragging) return;
            this.tipEl?.addClass('hidden');
        });
        this.timeEl = mid.createSpan({ cls: 'rl-vp-time' });

        // ── 右组 ──
        const right = row.createDiv({ cls: 'rl-vp-right' });
        if (opts && !opts.single) {
            const epBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-textbtn', attr: { 'data-tip': '选集' }, text: '选集' });
            epBtn.addEventListener('click', () => this.toggleMenu('episodes', epBtn));
            this.epBtn = epBtn;
        }
        // 🔴 用户 2026-11-08：「算了去掉清晰度选择默认最高画质播放」
        //    ⇒ 控制栏不再有清晰度按钮，档位由宿主固定冲最高（`biliStreamFor` 不传 qn ⇒
        //    `BILI_DASH_TOP_QN`）。⛔ 别再挂一枚「只能看不能切」的标签按钮 —— 那是假控件。

        const speedBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-speed', attr: { 'data-tip': '播放速度' }, text: SPEED_BTN_LABEL });
        this.speedBtn = speedBtn;
        // 倍速：点开面板选档（用户 2026-09-18 选定；旧的「点击循环 + Shift 反向」已撤）
        speedBtn.addEventListener('click', () => this.toggleMenu('speed', speedBtn));

        // 字幕（入口仍在控制条：它带「已挂载」亮起态，收进齿轮就看不见状态了）
        if (opts?.listSubtitles) {
            const subBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '字幕' } });
            safeSetIcon(subBtn, 'captions');
            // #606：字幕面板 = 与设置面板同款的**上浮浮层**（同一个容器、同一套开合与外点关闭规则）
            subBtn.addEventListener('click', () => this.toggleMenu('subtitle', subBtn));
            this.subBtn = subBtn;
        }

        // 音量（用户 2026-09-18 第二次指示）：**常驻滑条撤掉 → 点击图标才浮出竖向滑条**
        // （滑条复用浮层容器，于是开合 / 定位 / 外点 / Esc / 闲置隐藏全部走同一套规则）。
        // 静音改由「拖到 0」或 M 键触发 —— 点击图标本身是开合滑条。
        const volBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '音量（M 键静音）' } });
        safeSetIcon(volBtn, 'volume-2');
        volBtn.addEventListener('click', () => this.toggleMenu('volume', volBtn));
        this.volumeBtn = volBtn;

        // 🔴 2026-11-07 用户逐字：「播放器画中画按钮收到在设置里」⇒ 控制条上那颗**撤掉**。
        //    入口回到齿轮弹窗的「画中画 ›」动作行（`onSettingNav('pip')` 一直在，没动过）。
        //    ⛔ 别再加回控制条：用户明确要它待在设置里，控制条留给高频操作（播放/选集/字幕/音量/全屏）。
        //    ⚠️ 连带 `pipBtn` 字段与 `syncPipBtn()` 一起退场（死码不留）——
        //      画中画状态现在由弹窗里的那一行「画中画 / 退出画中画」承担（见 `settingGroups()`）。

        const gearBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '更多设置' } });
        safeSetIcon(gearBtn, 'settings');
        gearBtn.addEventListener('click', () => this.toggleMenu('settings', gearBtn));
        this.gearBtn = gearBtn;

        // 全屏按钮：基类画一个；选集页覆写 `buildFsButtons()` 塞「全屏 / 全屏+」两个
        this.buildFsButtons(right);

        this.buildMenu(bar);
        this.syncPlayState();
        this.syncVolumeUi();
    }

    private buildToast(root: HTMLElement): void {
        this.toastEl = root.createDiv({ cls: 'rl-vp-toast hidden' });
    }

    /** 连播面板：本集播完浮出「下一集 · 第 N 集」+ 倒计时 + 立即播放 / 取消 */
    private buildNextPanel(root: HTMLElement): void {
        const panel = root.createDiv({ cls: 'rl-vp-next hidden' });
        this.nextPanelEl = panel;
        panel.createDiv({ cls: 'rl-vp-next-label', text: '即将播放下一集' });
        this.nextPanelTextEl = panel.createDiv({ cls: 'rl-vp-next-title' });
        const ops = panel.createDiv({ cls: 'rl-vp-next-ops' });
        const go = ops.createEl('button', { cls: 'rl-btn rl-vp-btn', text: '立即播放' });
        go.addEventListener('click', () => {
            // 🔴 #604：目标集由 `nextTarget` 给（列表循环会绕回第一集 —— ⛔ 不能再写 `cur + 1`）
            const target = this.nextTarget;
            this.hideNextPanel();
            if (target !== null) this.goto(target);
        });
        const cancel = ops.createEl('button', { cls: 'rl-btn rl-vp-btn', text: '取消' });
        cancel.addEventListener('click', () => this.hideNextPanel());
    }

    // ── #579 时间戳侧边栏（抽屉：截图笔记 / 时间戳笔记 两栏）──────────────────────────

    /**
     * 抽屉骨架。**默认收起**（用户口径「侧边栏默认收起」），展开后**不挤压主视频区域** ——
     * 它是绝对定位的浮层，盖在画面右侧，视频的尺寸与位置一个字不动。
     *
     * ⚠️ 上 / 下边距在**每次展开时按顶栏与控制条的真实高度算**（`syncDrawerInset`）：
     * 顶栏与底栏都是 `position: absolute` 的渐变浮条；抽屉若从 0 铺到 100% 就会**盖住顶栏那几枚按钮**
     * （含它自己的开关）⇒ 展开后没法关，是个死局。硬编码高度在全屏 / 换字号时会错位，所以量。
     */
    private buildDrawer(root: HTMLElement): void {
        const drawer = root.createDiv({ cls: 'rl-vp-drawer hidden' });
        this.drawerEl = drawer;
        const tabs = drawer.createDiv({ cls: 'rl-vp-dtabs' });
        for (const tab of MARK_TABS) {
            const b = tabs.createEl('button', { cls: 'rl-vp-dtab', text: MARK_TAB_LABELS[tab] });
            b.addEventListener('click', () => {
                if (this.drawerTab === tab) return;
                this.drawerTab = tab;
                this.renderDrawer();
                this.syncDrawerActive(true);
            });
            this.drawerTabEls.set(tab, b);
        }
        this.drawerListEl = drawer.createDiv({ cls: 'rl-vp-dlist' });
        // 大图预览（截图笔记专用）：整块遮罩 + 居中大图。在播放器内，⛔ 不是新窗口 / 不是系统查看器。
        const lb = root.createDiv({ cls: 'rl-vp-lightbox hidden' });
        this.lightboxEl = lb;
        lb.addEventListener('click', () => this.closeLightbox());
        const img = lb.createEl('img', { cls: 'rl-vp-lightbox-img', attr: { alt: '' } });
        this.lightboxImgEl = img;
        // 点图片本身不关（「想放大看细节」时点到图上不该把预览关掉）
        img.addEventListener('click', (ev) => ev.stopPropagation());
    }

    /** 抽屉上下边距 = 顶栏 / 控制条的**真实高度**（为什么必须量见 `buildDrawer` 的注释） */
    private syncDrawerInset(): void {
        const d = this.drawerEl;
        if (!d) return;
        const bar = this.rootEl?.querySelector<HTMLElement>('.rl-vp-bar');
        d.style.top = `${bar?.offsetHeight ?? 0}px`;
        d.style.bottom = `${this.controlsEl?.offsetHeight ?? 0}px`;
    }

    private toggleDrawer(): void {
        if (this.drawerOpen) this.closeDrawer();
        else this.openDrawer();
    }

    private openDrawer(): void {
        const d = this.drawerEl;
        if (!d) return;
        this.drawerOpen = true;
        this.syncDrawerInset();
        d.removeClass('hidden');
        if (this.drawerBtn) safeSetIcon(this.drawerBtn, 'panel-right-close');
        this.renderDrawer(true);
        this.syncDrawerActive(true);
    }

    private closeDrawer(): void {
        const d = this.drawerEl;
        if (!d) return;
        this.drawerOpen = false;
        this.closeLightbox(); // 大图预览属于抽屉那条线：抽屉收起时一并收掉，不留一层悬浮的遮罩
        d.addClass('hidden');
        if (this.drawerBtn) safeSetIcon(this.drawerBtn, 'panel-right-open');
    }

    /**
     * 「当前这一路是网络集」时的**真实集号**；不是网络集返回 `null`。
     *
     * 🔴 2026-11-24：网络集已不走内置播放器（用户 m01744）⇒ 播放器页永远是本地集，
     *    基类固定返回 `null`。选集页仍覆写它（认自己的 `netIndex`，官方 iframe 也按集号归属标记）。
     */
    protected netMarkEpisode(): number | null {
        return null;
    }

    /**
     * 标记归属用的**真实集下标**。
     * ⇒ 网络源优先用 `netMarkEpisode()`；本地集仍是 `items[cur].index`。
     * ⛔ 别在这里回落到 0 —— 0 是「第一集」，会把第 3 集的标记画到第 1 集上。
     */
    private markEpisodeIndex(): number {
        const net = this.netMarkEpisode();
        if (net !== null) return net;
        return this.opts?.items[this.cur]?.index ?? 0;
    }

    /** 当前集该看的标记（进度条圆点与抽屉**同一份口径**：多集时间轴不同，混着画就是画错位置） */
    private episodeMarks(): VideoMark[] {
        return marksForEpisode(this.opts?.marks ?? [], {
            ep: this.markEpisodeIndex(),
            fileName: this.opts?.items[this.cur]?.path,
        });
    }

    /**
     * 重画抽屉（Tab 数字 + **当前 Tab** 的行）。
     *
     * 🔴 **懒加载 = 不展开就不建任何行**（用户「列表项做懒加载」）：抽屉收起时这里一共 0 行 DOM，
     *    展开时也只建有内容的**当前 Tab**（另一栏的行根本不建）—— 这正是「避免列表过长」的一半。
     *    缩略图另有 `loading="lazy"` + `decoding="async"`（按需取图交给浏览器）。
     *    ⚠️ 单集标记数是**几十**的量级（不是几百条），⛔ 不做虚拟列表 —— 那是过度设计。
     *
     * @param reset 展开时的那次重画：当前栏为空而另一栏有内容 ⇒ **自动落到有内容的那栏**
     *              （否则点开抽屉看到「空」，用户会以为整条视频没有标记）。
     */
    private renderDrawer(reset = false): void {
        const list = this.drawerListEl;
        if (!list) return;
        const marks = this.episodeMarks();
        const counts = markTabCounts(marks);
        if (reset && counts[this.drawerTab] === 0) {
            const other = MARK_TABS.find((t) => t !== this.drawerTab);
            if (other && counts[other] > 0) this.drawerTab = other;
        }
        for (const [tab, el] of this.drawerTabEls) {
            el.setText(`${MARK_TAB_LABELS[tab]} ${counts[tab]}`);
            el.toggleClass('is-on', tab === this.drawerTab);
        }
        list.empty();
        this.drawerRows = sortMarksByTime(marksOfTab(marks, this.drawerTab));
        this.drawerRowEls = [];
        this.drawerActive = -1;
        if (this.drawerRows.length === 0) {
            list.createDiv({ cls: 'rl-vp-dempty', text: markEmptyHint(this.drawerTab) });
            return;
        }
        for (let i = 0; i < this.drawerRows.length; i++) this.renderDrawerRow(list, i);
    }

    /**
     * 一行 = 「缩略图（只有截图那栏有）」+「时间 + 说明」。
     *
     * 🔴 **缩略图必须是行的兄弟节点**，⛔ 不能塞进行里 —— 行本身是 `<button>`，
     *    button 里嵌 button 是**非法内容模型**（与 #564 / #576「去关联」那条同源）。
     *    于是这一行有两个真按钮、各管一件事：**点行 = 跳到那一秒；点缩略图 = 看大图**。
     */
    private renderDrawerRow(list: HTMLElement, i: number): void {
        const mark = this.drawerRows[i];
        const row = list.createDiv({ cls: 'rl-vp-ditem' });
        const src = mark.image ? (this.opts?.markImageUrl?.(mark.image) ?? null) : null;
        if (src) {
            const thumb = row.createEl('button', {
                cls: 'rl-vp-dthumb',
                attr: { 'data-tip': `查看大图 · ${formatTime(mark.seconds)}` },
            });
            const img = thumb.createEl('img', { attr: { alt: '' } });
            img.src = src;
            img.loading = 'lazy';
            img.decoding = 'async';
            thumb.addEventListener('click', () => this.openLightbox(src));
        }
        const go = row.createEl('button', { cls: 'rl-vp-dgo', attr: { 'data-tip': `跳到 ${formatTime(mark.seconds)}` } });
        go.createSpan({ cls: 'rl-vp-dtime', text: formatTime(mark.seconds) });
        // 兜底文字 = 该标记所属那一栏的显示名（真源 `MARK_TAB_LABELS`，⛔ 视图里不另写一份中文）
        go.createSpan({ cls: 'rl-vp-dtext', text: markCaption(mark.text) || MARK_TAB_LABELS[markTabOf(mark)] });
        go.addEventListener('click', () => this.jumpToMark(i));
        // 🔴 #634：**「在笔记中打开」搬到抽屉这一行**（用户裁定）——
        //    进度条上那条右键通路已整体撤除（「仅在抽屉侧边栏可点击跳转对应视频进度和关联时间戳笔记」）⇒
        //    如果这里不补，`onOpenMarkNote` 就**一个入口都不剩**（能力静默消失，而不是被挪走）。
        //    ⚠️ 与「点行 = 跳视频」**分成两个按钮**：只跳时间却被迫开一个窗口会很烦，反之亦然。
        //    ⚠️ 图标按钮（无可见文字）⇒ 读屏名走 `.rl-sr` 隐藏文本，悬停提示走 `data-tip`。
        //    🔴 **⛔ 不写 `aria-label`**：Obsidian 会给带它的元素**自绘官方气泡**，与插件自己的
        //       `data-tip` 气泡叠成两层 —— 上一版两个都挂上了（注释写着「不带 data-tip」，
        //       代码却把两个都写了），这就是用户 2026-10-30 说的「提示怎么有两种」。
        //    ⚠️ 图标与顶栏那枚「打开视频笔记」**同款**（`notebook-text`）：同一种动作两处两个图标会读成两件事。
        const open = row.createEl('button', {
            cls: 'rl-vp-dnote',
            attr: { 'data-tip': '在笔记中打开' },
        });
        open.createSpan({ cls: 'rl-sr', text: '在笔记中打开' });
        safeSetIcon(open, 'notebook-text');
        open.addEventListener('click', () => void this.opts?.onOpenMarkNote?.(mark));
        this.drawerRowEls[i] = row;
    }

    /** 点列表项 = **精准跳转对应时间戳**（复用 `applySeek`：夹取 + 播放 + 「已跳到 …」提示，一字不另写） */
    private jumpToMark(i: number): void {
        const mark = this.drawerRows[i];
        if (!mark) return;
        this.applySeek(mark.seconds);
    }

    /**
     * 🔴 #579 **双向联动**：播放时把「当前所处的那一条」自动高亮，并滚到可视区。
     *  - 只在**抽屉展开**时做（收起时零开销）；
     *  - **下标没变就一个 DOM 都不碰**（`timeupdate` 每秒约 4 次，白刷会让列表反复重排）；
     *  - 滚动用 `block: 'nearest'`：条目**本来就在视野内就完全不动** —— 这样才不会和用户的手动滚动打架。
     */
    private syncDrawerActive(force = false): void {
        if (!this.drawerOpen || this.drawerRowEls.length === 0) return;
        const idx = activeMarkIndex(this.drawerRows, this.videoEl?.currentTime ?? 0);
        if (!force && idx === this.drawerActive) return;
        this.drawerRowEls[this.drawerActive]?.removeClass('is-active');
        this.drawerActive = idx;
        const next = this.drawerRowEls[idx];
        if (!next) return;
        next.addClass('is-active');
        next.scrollIntoView({ block: 'nearest' });
    }

    /** 大图预览：整块遮罩 + 居中大图（Esc / 点遮罩关；点图本身不关） */
    private openLightbox(src: string): void {
        if (!this.lightboxEl || !this.lightboxImgEl) return;
        this.lightboxImgEl.src = src;
        this.lightboxEl.removeClass('hidden');
    }

    private closeLightbox(): void {
        const lb = this.lightboxEl;
        if (!lb || lb.hasClass('hidden')) return;
        lb.addClass('hidden');
        this.lightboxImgEl?.removeAttribute('src');
    }

    /** 大图预览是否开着（Esc 的优先顺序要看它） */
    private lightboxOpen(): boolean {
        return !!this.lightboxEl && !this.lightboxEl.hasClass('hidden');
    }

    // ── 浮层（选集 / 倍速 / 设置，2026-09-18 按 B 站口径新增）──

    /** 浮层容器：控制条的绝对定位子元素（向上浮出）。位置每次打开时算，内容按 kind 重建。 */
    private buildMenu(bar: HTMLElement): void {
        this.menuEl = bar.createDiv({ cls: 'rl-vp-menu hidden' });
    }

    /** 触发按钮点击：开 / 关 / 切换（开合规则全在纯函数 nextMenuState，UI 层不做第二处判断） */
    private toggleMenu(kind: PlayerMenuKind, btn: HTMLElement): void {
        const next = nextMenuState(this.menuKind, kind);
        if (next === null) {
            this.closeMenu();
            return;
        }
        this.openMenu(next, btn);
    }

    private openMenu(kind: PlayerMenuKind, btn: HTMLElement): void {
        const menu = this.menuEl;
        if (!menu) return;
        this.menuKind = kind;
        this.menuTriggerBtn = btn;
        // 连播面板与浮层占同一片区域（控制条上方右侧）→ 开浮层先收掉它，免得两层叠着
        this.hideNextPanel();
        menu.empty();
        this.fillMenu(kind, menu);
        // 音量滑条是唯一的窄浮层：去掉列表菜单的最小宽度，免得竖条两侧空出一大片。
        // #604 设置弹窗是**宽行**（左标签 / 右值 / 右箭头）⇒ 另加一个类撑宽并加分割线。
        menu.toggleClass('rl-vp-menu-volume', kind === 'volume');
        menu.toggleClass('rl-vp-menu-set', kind === 'settings');
        // #606 字幕面板与设置面板同构（宽行 + 组分割线），只是内容不同
        menu.toggleClass('rl-vp-menu-sub', kind === 'subtitle');
        // #607 倍速面板：条目是「1× / 1.25×」这类短词，左对齐在一列里歪得明显 ⇒ 整列居中
        menu.toggleClass('rl-vp-menu-speed', kind === 'speed');
        // 🔴 先撤 hidden 再量宽：display:none 的元素 getBoundingClientRect 恒为 0
        menu.removeClass('hidden');
        this.placeMenu(btn, kind === 'volume' ? 'center' : 'right');
        this.syncMenuButtons();
        this.pokeIdle();
    }

    private closeMenu(): void {
        this.menuKind = null;
        this.menuTriggerBtn = null;
        this.menuEl?.addClass('hidden');
        this.syncMenuButtons();
    }

    /** 浮层内容：三类共用容器，数据全部来自 pure/playerMenu（UI 层只负责渲染与回传） */
    private fillMenu(kind: PlayerMenuKind, menu: HTMLElement): void {
        const opts = this.opts;
        if (!opts) return;
        if (kind === 'episodes') {
            for (const item of buildEpisodeOptions(opts.items, this.cur, !!opts.single)) {
                this.menuItem(menu, item.label, item.active, () => this.goto(item.index));
            }
            return;
        }
        if (kind === 'speed') {
            for (const item of buildSpeedOptions(vpSpeed)) {
                this.menuItem(menu, item.label, item.active, () => this.setSpeed(item.value));
            }
            return;
        }
        if (kind === 'subtitle') {
            // #606 字幕面板（结构与文案全来自 `pure/playerMenu.buildSubtitleMenu`）
            this.renderSubtitleMenu(menu);
            return;
        }
        if (kind === 'volume') {
            // 音量浮层（用户 2026-09-18 第三次指示：照参考图自绘）—— **顶部数值 + 竖向细轨 + 大圆滑块**。
            // 拖动仍走原生 range（键盘可达、拖动逻辑免费），只把外观整体盖掉；
            // Chromium 的 range 没有「已填充」伪元素（那是 Firefox 的 ::-moz-range-progress），
            // 故已填充段靠轨道伪元素的 linear-gradient + 元素上的 `--rl-vol-p` 表达。
            const pop = menu.createDiv({ cls: 'rl-vp-volpop' });
            pop.createDiv({ cls: 'rl-vp-vol-val' });
            const wrap = pop.createDiv({ cls: 'rl-vp-vol-wrap' });
            const slider = wrap.createEl('input', {
                cls: 'rl-vp-vol-range',
                attr: { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': '音量' },
            }) as HTMLInputElement;
            slider.addEventListener('input', () => this.setVolume(clampVolume(Number(slider.value))));
            // 初值 / 数值 / 已填充比例统一由 syncVolumePop 写（与键盘调音量同一条路径，不写第二处真源）
            this.syncVolumePop();
            return;
        }
        // 设置（#604 三组结构）：结构与文案全来自 `pure/playerMenu.buildSettingOptions`，
        // 这里只做 DOM + 回传。⛔ 别在视图里再拼一份「三组」—— 那正是「两处必然漂」的老路。
        this.renderSettingMenu(menu);
    }

    /** 单条浮层项：点完一律收浮层（切集 / 改倍速 / 跳系统播放器都是「选完就走」） */
    private menuItem(menu: HTMLElement, label: string, active: boolean, onPick: () => void): void {
        const btn = menu.createEl('button', { cls: 'rl-vp-menu-item', text: label });
        if (active) btn.addClass('is-on');
        btn.addEventListener('click', () => {
            this.closeMenu();
            onPick();
        });
    }

    // ── #604 设置弹窗（三组；#605 精简为 循环值行 / 动作行 两种）────────────────────

    /** 设置弹窗内容：标题（小号灰字）+ 三组；组间由 CSS 画 1px 分割线（见 `.rl-vp-set-group`）。 */
    private renderSettingMenu(menu: HTMLElement): void {
        menu.createDiv({ cls: 'rl-vp-set-head', text: SETTING_HEAD });
        for (const group of this.settingGroups()) {
            const box = menu.createDiv({ cls: 'rl-vp-set-group' });
            for (const row of group.rows) this.renderSettingRow(box, row);
        }
    }

    /**
     * 三组结构（拉起纯函数）。🔴 画中画能力在这里**当场取**（`document.pictureInPictureEnabled`）——
     * 它是「与创建控件时无关」的实时量，⛔ 别缓存进字段（缓存了置灰判定就会与真实能力脱节）。
     */
    private settingGroups(): SettingGroup[] {
        const pipOk = typeof document.pictureInPictureEnabled === 'boolean' && document.pictureInPictureEnabled;
        // ⚠️ `pipActive` 也是**当场取**：用户可能从系统窗口把那扇画中画窗关掉，缓存会立刻失真。
        const pipActive = !!document.pictureInPictureElement;
        return buildSettingOptions({ pip: pipOk, pipActive, playMode: this.playMode });
    }

    /** 画一行的两种形态（置灰 / 循环值行 / 动作行） */
    private renderSettingRow(box: HTMLElement, row: SettingRow): void {
        // 置灰：**看得见但点不动**（用户口径「不可用项置灰，例如系统不支持画中画时显示 当前设备不支持」）。
        // ⛔ 不用 `<button disabled>` —— 禁用按钮仍会收 mouseover，本仓既有规矩是「禁用态提示走 data-tip」，
        //    而这一行的说明直接写出来，比气泡更直白。做成 div ⇒ 天然不可聚焦、不可点。
        if (row.disabled) {
            const dead = box.createDiv({ cls: 'rl-vp-set-row is-disabled' });
            dead.createDiv({ cls: 'rl-vp-set-lbl', text: row.label });
            if (row.note) dead.createDiv({ cls: 'rl-vp-set-note', text: row.note });
            return;
        }
        if (row.kind === 'cycle') {
            // #605 循环值行：右侧只有**当前值文字**（⛔ 无箭头），点击整行切到下一档、弹窗不关。
            const btn = box.createEl('button', {
                cls: 'rl-vp-set-row rl-vp-set-cycle',
                attr: { 'data-row': row.id },
            });
            btn.createDiv({ cls: 'rl-vp-set-lbl', text: row.label });
            btn.createDiv({ cls: 'rl-vp-set-val', text: row.value ?? '' });
            btn.addEventListener('click', () => this.cyclePlayMode());
            return;
        }
        // 动作行：右侧只有 ›，点击**立即执行并关窗**（画中画 / 系统播放器各自自己收尾）
        const nav = box.createEl('button', {
            cls: 'rl-vp-set-row rl-vp-set-nav',
            attr: { 'data-row': row.id },
        });
        nav.createDiv({ cls: 'rl-vp-set-lbl', text: row.label });
        const chev = nav.createSpan({ cls: 'rl-vp-set-chev' });
        safeSetIcon(chev, 'chevron-right');
        nav.addEventListener('click', () => void this.onSettingNav(row.id as 'pip' | 'external'));
    }

    /**
     * #605 动作行点击：**执行一次后关窗**。
     * 🔴 两条动作的收尾方式不同，别合并：`external` 由 `openExternal` 自己收掉**整个播放器标签页**；
     *    `pip` 只关**弹窗**（播放器还在，画中画窗接管画面）。
     * 🔴 画中画是**异步且可能失败**（`requestPictureInPicture` 会 reject）⇒ 先 `await`，成不成都要关弹窗
     *    —— 失败时 `togglePip` 自己弹 Notice，弹窗留着反而像「点了没反应」。
     */
    private async onSettingNav(id: 'pip' | 'external'): Promise<void> {
        if (id === 'pip') {
            this.closeMenu();
            await this.togglePip();
            return;
        }
        this.openExternal();
    }

    /** #605 播放模式：**整行点击循环**（按 `PLAY_MODES` 顺序取下一档）+ 就地重画（弹窗不关）+ 写回设置 */
    private cyclePlayMode(): void {
        this.playMode = nextPlayMode(this.playMode);
        this.opts?.onSetPlayMode?.(this.playMode);
        this.refreshSettingMenu();
    }

    /** 就地在**不关窗**的前提下重画设置弹窗（#605 只剩「播放模式循环切换」一处会走它），并重新贴一次锚点 */
    private refreshSettingMenu(): void {
        const menu = this.menuEl;
        if (!menu || this.menuKind !== 'settings') return;
        menu.empty();
        this.renderSettingMenu(menu);
        if (this.menuTriggerBtn) this.placeMenu(this.menuTriggerBtn, 'right');
        this.syncMenuButtons();
        this.pokeIdle();
    }

    /** 定位：右对齐到触发按钮右缘（音量滑条改居中）、浮在控制条上方；越界夹取在纯函数 menuAnchor 里 */
    private placeMenu(btn: HTMLElement, align: 'right' | 'center' = 'right'): void {
        const menu = this.menuEl;
        const bar = this.controlsEl;
        if (!menu || !bar) return;
        const barRect = bar.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const pos = menuAnchor({
            btnLeft: btnRect.left - barRect.left,
            btnRight: btnRect.right - barRect.left,
            menuW: menuRect.width,
            containerW: barRect.width,
            containerH: barRect.height,
            align,
        });
        menu.style.left = `${pos.left}px`;
        menu.style.bottom = `${pos.bottom}px`;
    }

    /** 触发按钮的「已打开」亮起态（复用 is-on：与控制条上「字幕已挂载」同款，一眼看出浮层由哪个入口开出） */
    private syncMenuButtons(): void {
        this.epBtn?.toggleClass('is-on', this.menuKind === 'episodes');
        this.speedBtn?.toggleClass('is-on', this.menuKind === 'speed');
        this.gearBtn?.toggleClass('is-on', this.menuKind === 'settings');
        // 字幕那枚还兼「已挂载」态 ⇒ 走它自己那条合成判据（见 syncSubBtn）
        this.syncSubBtn();
    }

    /**
     * 浮层外点关闭。挂在 document **捕获阶段**（比触发按钮自己的 click 早），
     * 因此必须显式放行「浮层内」与「触发按钮」两处 —— 否则「再点一次入口按钮关浮层」
     * 会先被这里关掉、随后按钮 click 又把它打开，表现为「点了没反应」。
     */
    private onDocPointerDown = (ev: PointerEvent): void => {
        const target = ev.target as Node | null;
        // 🔴 m04435 ①：右键「时间戳笔记」浮层也走同一个「点外面就关」的口径。
        //    放行「浮层内」—— 里面点心情/输入框/按钮都不该被这里关掉。
        if (this.stampNotePopover && this.stampNoteEl) {
            if (!target || !this.stampNoteEl.contains(target)) this.closeStampNotePopover();
        }
        if (!this.menuKind) return;
        if (target && (this.menuEl?.contains(target) || this.menuTriggerBtn?.contains(target))) return;
        this.closeMenu();
    };

    /**
     * 🔴 #634：**进度条右键「在笔记中打开」已整体撤除**（用户裁定：「播放器上的进度条不再显示标记，
     * 并取消该跳转笔记功能，仅在抽屉侧边栏可点击跳转对应视频进度和关联时间戳笔记」）。
     *
     * 撤掉的是一条**整链**，⛔ 不是只关掉一个监听：
     *   ① `root` 上的 `contextmenu` 监听（原本靠它覆盖「右键圆点 / 右键卡片 / 右键卡片里的缩略图」三处）；
     *   ② `onPlayerContextMenu` / `markAtPointer` 两个处理器；
     *   ③ `overCard` / `cardOpen` / `renderMarkCard`（标记卡片形态 `.rl-vp-tip-mark` 的唯一产者）；
     *   ④ `markHitAt` + `onProgressDown` 里那段「点中圆点吸附到那一刻」——**没有圆点可看却偷偷吸附**
     *      比不画更糟（用户按指针位置 seek，落点却跳了几秒，且屏幕上没有任何东西解释这件事）。
     *
     * 唯一活下来的出口 = 抽屉行右侧那枚「在笔记中打开」（`renderDrawerRow`），
     * 以及「点行 = 跳到那一秒」（`jumpToMark`）—— 正是用户要的「仅在抽屉侧边栏可点击跳转」。
     */

    /** 键盘：只绑 pure/player 映射表里有的键（映射与实现对得上，改一处不会漂） */
    private bindKeys(scope: Scope): void {
        const combos: [string, boolean][] = [
            [' ', false],
            ['ArrowLeft', false],
            ['ArrowRight', false],
            ['ArrowLeft', true],
            ['ArrowRight', true],
            ['ArrowUp', false],
            ['ArrowDown', false],
            ['m', false],
            ['M', false],
            ['f', false],
            ['F', false],
            ['t', false],
            ['T', false],
            ['s', false],
            ['S', false],
        ];
        for (const [key, shift] of combos) {
            const action = resolveKeyAction(key, shift);
            if (!action) continue;
            scope.register(shift ? ['Shift'] : [], key, () => {
                this.runAction(action);
                return false;
            });
        }
        // Esc：**不再关闭播放器**（用户 2026-09-17 裁定：退出只经由关闭标签页，Esc 一并收敛）。
        // 2026-09-18 补一级优先：浮层开着时 Esc 先收浮层（否则「想关浮层却把全屏退了」）；
        // 全屏中返回 true = 交回浏览器退全屏（否则「想退全屏却把播放器关了」）；其余返回 false 阻止传播。
        scope.register([], 'Escape', () => {
            // 🔴 子类浮层排在最前：选集页的条目右键菜单盖在整页之上，
            //    它开着时 Esc 只该收它（⛔ 不是顺手把大图预览 / 抽屉也收了）。
            if (this.closeExtraOverlay()) return false;
            // #579：大图预览是**最外面那一层**（它盖着抽屉与画面）⇒ 优先关它
            if (this.lightboxOpen()) {
                this.closeLightbox();
                return false;
            }
            if (this.menuKind) {
                this.closeMenu();
                return false;
            }
            // 抽屉比浮层「轻」：先关浮层再关抽屉（浮层是临时挑选项，抽屉是常驻视图）
            if (this.drawerOpen) {
                this.closeDrawer();
                return false;
            }
            if (document.fullscreenElement) return true;
            return false;
        });
    }

    // ── 渲染与播放 ──

    /** 渲染当前项：标题 + video src + 边界按钮置灰 + 恢复位置 + 自动挂字幕 */
    private render(): void {
        const opts = this.opts;
        const item = opts?.items[this.cur];
        // 🔴 先决定「有没有本地视频」再决定要不要继续：纯网络条目会在下一行提前返回，
        //    若把显隐写在那之后，占位层永远不会出现，用户面对的仍是一片黑（真机实测的缺陷）。
        this.syncEmptyStage(!item);
        if (!opts) return;
        if (!item) {
            // 🔴 纯网络条目（`items` 为空，如单集电影只有一条 B 站链接）会走到这里：
            //    没有本地视频可切 ⇒ 拿不到 `src`，但**「渲染完成」这件事仍然发生了**。
            //    ⛔ 直接 `return` 会让子类的 `afterRender()` 永不执行，宿主传来的
            //    `page.startNet`（打开就播第 N 集网络流）就此烂在 `pendingNetStart` 里，
            //    页面停在空播放器上等用户自己点 —— 真机实测 A6 失败就是这个。
            //    ⇒ 本地无片也必须通知一次，让子类自己决定要不要进网络流。
            this.afterRender();
            return;
        }
        this.failed = false;
        this.hideNextPanel();
        // 换集一律收掉浮层：连播自动切集时浮层还开着的话，选集列表的「当前集」会停在旧的一集上
        this.closeMenu();
        // #579：换集 ⇒ 大图预览必须收（那张图属于上一集）+ 抽屉按**新集**重画（时间轴不同，混着列就是错位）
        this.closeLightbox();
        if (this.drawerOpen) this.renderDrawer(true);
        this.clearSubtitle();
        this.restoreLocalTitle();
        if (this.prevBtn) this.prevBtn.disabled = item.isFirst;
        if (this.nextBtn) this.nextBtn.disabled = item.isLast;
        // 切源：清旧 src 再设新（同一 video 复用，避免重建元素丢失播放器状态）
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
        // 🔴 抓帧免污染（`#326`）依赖 `crossOrigin`：换集时一律装回去（`releaseMedia`/
        //    关页等路径会把它摘掉），⛔ 别指望上一集留下的状态。
        this.restoreLocalSourceHints();
        // 换片即作废「彻底释放」现场（否则回来会拿着旧位置去重建新片）
        this.cancelDeepRelease();
        // 2026-11-24：网络源整条链路已删（用户 m01744）⇒ 这里只剩「本地文件直连」一种挂法，
        // 原来 `opts.netDash` 走 MSE 管线、`opts.netSource` 摘 crossOrigin 的分支都没了。
        this.videoEl.src = item.url;
        this.videoEl.playbackRate = vpSpeed;
        this.videoEl.volume = clampVolume(vpVolume ?? 1);
        this.videoEl.muted = vpMuted;
        this.lastSavedSeconds = -1;
        this.pendingResume = opts.initialPositions?.[this.epKey()] ?? 0;
        this.updateProgressUi();
        // 原来这里要分「DASH 交给 startNetDash 起播 / 本地直接 play」两路，DASH 那条已删 ⇒ 无条件 play。
        void this.videoEl.play().catch(() => {
            // 自动播放被拦（部分环境）：留在暂停态让用户点播放即可，不视为失败
        });
        void this.autoLoadSubtitle();
        // 换集后通知子类（选集页右侧栏的「当前集」高亮靠它；默认空实现）
        this.afterRender();
    }

    /** 舞台占位层的唯一显隐口子（`on` = 没有本地可播视频）。
     *  🔴 只认 `is-on` 一个类、只在 `render()` 里调：⛔ 不要在别处再 toggleClass，
     *     否则「当前到底有没有可播内容」会多出第二份真源，迟早和 `items` 对不上。 */
    protected syncEmptyStage(on: boolean): void {        if (!this.emptyStageEl) return;
        this.emptyStageEl.toggleClass('is-on', on);
        // 没有可播内容时把旧源也卸掉：留着上一集的 src，黑壳底下会继续挂着上一集的解码器，
        // 看上去像「卡在上一集的最后一帧」，而且声音可能还在。
        if (on && this.videoEl) {
            this.videoEl.pause();
            this.videoEl.removeAttribute('src');
            this.videoEl.load();
        }
    }

    /**
     * 把占位层切成「未关联」形态：**停掉转圈**，只说「还没有关联视频」。
     *
     * 🔴 用户 2026-11-10（m03035）：「从播放器详情页相关推荐进入的条目播放详情页由于没有任何
     *    关联播放器屏幕一直在转圈 改成显示未关联空态」。
     *    病根：相关推荐点进来的条目只要 `episodeFiles` / `episodeUrls` 都是空，`items` 就是空数组，
     *    基类 `render()` 走「没有本地项」那条路 ⇒ 占位层一直显示「正在加载视频…」+ 转圈，
     *    而那件事**永远不会结束**（没有任何加载在进行）。用户看到的是「一直在转圈」。
     * ⚠️ 与 `syncEmptyStage(true)` 的分工：那个只说「现在没可播的」，这个说「压根没关联过」。
     *    ⛔ 别把「正在加载」的文案直接改掉 —— 真的在等取流时那句话是对的。
     */
    protected setEmptyStageMode(mode: 'loading' | 'unlinked'): void {
        if (!this.emptyStageEl) return;
        const unlinked = mode === 'unlinked';
        this.emptyStageEl.toggleClass('is-unlinked', unlinked);
        if (this.emptyStageSpinEl) this.emptyStageSpinEl.hidden = unlinked;
        if (this.emptyStageTitleEl) {
            this.emptyStageTitleEl.setText(unlinked ? '还没有关联视频' : '正在加载视频…');
        }
    }

    /** 播放位置记忆键：集下标（与 episodeFiles 一一对应；单文件播放恒为 '0'） */
    private epKey(): string {
        return String(this.opts?.items[this.cur]?.index ?? 0);
    }

    /**
     * 把「当前这一集的字幕路径」写回库（受保护入口，供子类在同一次操作里落库）。
     *
     * 🔴 为什么必须开这个口子（用户 m11423「SenseVoice转录的文件放哪了啥都没关联」）：
     *    转写完成后字幕已经写在视频同目录了，但子类拿不到 `epKey()`（私有）与 `opts`（私有），
     *    于是只能「重扫候选」——那只在当前会话有内容，重启就没了，用户看到文件躺在那儿没人认领。
     * ⚠️ ⛔ 不要在子类里另存一份 `subtitlePaths`：落库口径只许有这一条（`persistSubtitlePath`）。
     */
    protected saveSubtitleFor(subPath: string): void {
        const p = String(subPath ?? '').trim();
        if (!p) return;
        this.opts?.onSaveSubtitle?.(this.epKey(), p);
    }

    /** metadata 就绪后按记忆位置续播（太靠前/太靠后不续，见 pure/player.shouldResume） */
    private consumePendingResume(): void {
        const pos = this.pendingResume;
        this.pendingResume = 0;
        const dur = this.videoEl.duration;
        if (shouldResume(pos, dur)) {
            this.videoEl.currentTime = clampSeek(pos, dur);
            this.showToast(`已从 ${formatTime(pos)} 继续播放`);
        }
        this.updateProgressUi();
    }

    /** 写回播放位置：默认节流；immediate=true 立即写（暂停 / 切集 / 关闭时用） */
    private savePosition(immediate = false): void {
        const save = this.opts?.onSavePosition;
        if (!save) return;
        const seconds = Math.floor(this.videoEl?.currentTime ?? 0);
        if (immediate) {
            if (this.posTimer !== null) {
                window.clearTimeout(this.posTimer);
                this.posTimer = null;
            }
            if (seconds !== this.lastSavedSeconds) {
                this.lastSavedSeconds = seconds;
                save(this.epKey(), seconds);
            }
            return;
        }
        if (this.posTimer !== null) return;
        this.posTimer = window.setTimeout(() => {
            this.posTimer = null;
            const s = Math.floor(this.videoEl?.currentTime ?? 0);
            if (s !== this.lastSavedSeconds) {
                this.lastSavedSeconds = s;
                save(this.epKey(), s);
            }
        }, POS_SAVE_THROTTLE);
    }

    /** 切到相邻集（首集再上/末集再下已置灰，正常不可达；防御性 return） */
    private goto(idx: number): void {
        const items = this.opts?.items ?? [];
        if (idx < 0 || idx >= items.length || idx === this.cur) return;
        this.savePosition(true);
        this.cur = idx;
        this.render();
    }

    private togglePlay(): void {
        this.pokeIdle();
        if (this.videoEl.paused) void this.videoEl.play().catch(() => undefined);
        else this.videoEl.pause();
    }

    /** 单击画面：播放 / 暂停（双击窗口内则不动作，交给 dblclick 全屏） */
    private onStageClick(): void {
        if (this.clickTimer !== null) {
            window.clearTimeout(this.clickTimer);
            this.clickTimer = null;
            return;
        }
        this.clickTimer = window.setTimeout(() => {
            this.clickTimer = null;
            this.togglePlay();
        }, DBLCLICK_MS);
    }

    private onEnded(): void {
        this.savePosition(true);
        this.rootEl?.removeClass('rl-vp-idle');
        // 单文件（电影）：一集没有「下一集」可言 ⇒ 播完就停住，⛔ 不参与播放模式
        if (this.opts?.single) {
            this.syncPlayState();
            return;
        }
        const items = this.opts?.items ?? [];
        // 🔴 #604：集末推进交给纯函数（四档模式全在 `pure/playerMenu.nextEpisodeIndex` 里钉着）。
        //    null = 停住（顺序播放的最后一集）；=== cur = 重播本集（单集循环，与旧 `loopOne` 同形态）。
        const next = nextEpisodeIndex(this.playMode, this.cur, items.length);
        if (next === null) {
            this.syncPlayState();
            return;
        }
        if (next === this.cur) {
            this.videoEl.currentTime = 0;
            void this.videoEl.play().catch(() => undefined);
            return;
        }
        this.showNextPanel(next);
    }

    // ── 控制条 ──

    private updateProgressUi(): void {
        const dur = this.videoEl?.duration ?? 0;
        const cur = this.videoEl?.currentTime ?? 0;
        if (this.playedEl) this.playedEl.style.width = `${secondsToRatio(cur, dur) * 100}%`;
        if (this.timeEl) this.timeEl.setText(`${formatTime(cur)} / ${formatTime(dur)}`);
        if (this.bufferedEl) {
            const b = this.videoEl?.buffered;
            const end = b && b.length > 0 ? b.end(b.length - 1) : 0;
            this.bufferedEl.style.width = `${secondsToRatio(end, dur) * 100}%`;
        }
    }

    /** 进度条按下：接管指针（拖动过程中实时 seek） */
    private onProgressDown(ev: PointerEvent): void {
        this.dragging = true;
        this.pokeIdle();
        try {
            this.progressEl?.setPointerCapture(ev.pointerId);
        } catch {
            /* 捕获失败不影响拖动（pointermove 仍会在元素上触发） */
        }
        // 🔴 #634：**「点中圆点 → 吸附到那一刻」已撤**（圆点本身不再画，见 `renderProgress` 那段注释）。
        //    留着它就会变成「按哪儿都跳几秒，而屏幕上没有任何东西解释为什么」—— 没有圆点可看时，
        //    唯一的正确落点判据就是**指针位置**（`seekToEvent`）。跳时间戳走抽屉那行（`jumpToMark`）。
        this.seekToEvent(ev);
    }

    private onProgressMove(ev: PointerEvent): void {
        this.updateTip(ev);
        if (this.dragging) this.seekToEvent(ev);
    }

    private onProgressUp(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.savePosition(true);
        this.pokeIdle();
    }

    /** 按指针位置 seek，并即时刷新进度视觉 */
    private seekToEvent(ev: PointerEvent | MouseEvent): void {
        const rect = this.progressEl?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const ratio = (ev.clientX - rect.left) / rect.width;
        const dur = this.videoEl.duration;
        this.videoEl.currentTime = clampSeek(ratioToSeconds(ratio, dur), dur);
        this.updateProgressUi();
    }

    /**
     * 悬停：显示「落点 / 总长」气泡。
     *
     * 🔴 #634：**「悬在标记上换成标记卡片」已撤**（用户裁定：进度条不再显示标记、取消该跳转笔记功能）。
     *    那条分支连着 `.rl-vp-tip-mark` 卡片形态、`overCard` 的「指针停在卡片上就别重算」守卫、
     *    以及卡片里那句「右键 → 在笔记中打开」—— 四处一起退场，因为卡片就是为那条通路存在的。
     *    标记的信息（种类 / 时间 / 说明 / 截图缩略图）现在全在**抽屉**里，且**没有信息丢失**。
     */
    private updateTip(ev: PointerEvent | MouseEvent): void {
        const rect = this.progressEl?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || !this.tipEl) return;
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const dur = this.videoEl?.duration ?? 0;
        this.tipEl.setText(hoverTipText(ratioToSeconds(ratio, dur), dur));
        this.tipEl.style.left = `${ratio * 100}%`;
        this.tipEl.removeClass('hidden');
    }

    /** 宿主在插入时间戳 / 截图后把新标记推进来（#333：不必重开播放器就能看到新点） */
    setMarks(marks: VideoMark[]): void {
        if (this.opts) this.opts.marks = marks;
        this.refreshMarks();
    }

    /**
     * 🔴 #634：标记变化后**只刷新抽屉**。
     *
     * 原本这个位置是 `renderMarks()` —— 它重建进度条上那层圆点（`.rl-vp-marks`）**顺带**同步抽屉。
     * 圆点已按用户裁定撤除 ⇒ 这里只剩「抽屉要不要重建」这一件事，所以改了名：
     * ⛔ 名字别再叫 `renderMarks`（那个名字现在会误导人去找一个不存在的渲染层）。
     *
     * ⚠️ 两条保留原样：
     *   ① `markList` / `markPcts` 仍要刷（抽屉高亮与「跳到那一秒」都靠 `markList` 的下标对齐）；
     *   ② 抽屉**只在展开时重建** —— 收起时连一行 DOM 都不该存在（#579 的「懒加载」口径）。
     */
    private refreshMarks(): void {
        const dur = this.videoEl?.duration ?? 0;
        // ⚠️ 集号必须走 `markEpisodeIndex()`：网络集的占位 item 是 -1，直读会把这一集的标记全滤掉。
        // ⛔ 也别再拿 `items[this.cur]` 当守卫：**纯网络集的 `items` 是空数组**
        //   （没有本地文件就没有 items，连占位 item 都没有），
        //   那样 `opts.marks` 里明明有数据也会被整批丢光 —— 用户 2026-11-01 报的
        //   「时间戳列表没有标记」就是这个守卫干掉的。集号归集号、文件名归文件名，
        //   缺文件名只是少一条匹配路径（`marksForEpisode` 里 `ep` 优先命中），不该连累整批。
        const mine = marksForEpisode(this.opts?.marks ?? [], {
            ep: this.markEpisodeIndex(),
            fileName: this.opts?.items[this.cur]?.path,
        });
        this.markList = mine;
        this.markPcts = mine.map((m) => markPct(m.seconds, dur));
        this.hoverMark = null;
        if (this.drawerOpen) {
            this.renderDrawer();
            this.syncDrawerActive(true);
        }
    }

    /**
     * 让出声道（④-4 播放器互斥）：内置音频播放器起播时由宿主调用。
     * 🔴 只做「暂停」不做别的（不落盘位置、不关标签页）—— 用户切回来看时应当还停在原处。
     * 互斥方向由 `pure/audioQueue.playersToPause` 决定，⛔ 这里别硬编码「音频播放器」是谁。
     */
    pauseForOtherPlayer(): void {
        if (!this.videoEl.paused) this.videoEl.pause();
    }

    /** 播放/暂停按钮与中央按钮同步；`rl-vp-paused` 落给 CSS（中央按钮只在暂停时显示） */
    private syncPlayState(): void {
        const paused = this.videoEl?.paused ?? true;
        if (this.playBtn) safeSetIcon(this.playBtn, paused ? 'play' : 'pause');
        // 中央按钮（用户 2026-09-18 二次裁定：暂停才显示、满不透明、无悬停行为、无微动效）：
        // 显隐全在 CSS，这里只落状态类 + 切图标 —— 免得「显隐」又多出第二处真源。
        this.rootEl?.toggleClass('rl-vp-paused', paused);
        if (this.centerPlayEl) safeSetIcon(this.centerPlayEl, paused ? 'play' : 'pause');
    }

    private syncVolumeUi(): void {
        const v = clampVolume(this.videoEl?.volume ?? 1);
        const muted = this.videoEl?.muted ?? false;
        this.syncVolumePop();
        if (this.volumeBtn) {
            safeSetIcon(this.volumeBtn, muted || v === 0 ? 'volume-x' : v < 0.5 ? 'volume-1' : 'volume-2');
            this.volumeBtn.toggleClass('is-on', muted);
        }
    }

    /** 同步音量浮层里的三条信息（数值 / 滑条位置 / 已填充比例）—— 浮层没开时直接返回。
     *  滑条只存在于浮层里（点击才建）→ 一律用查询而非常驻引用（否则会写到已脱离 DOM 的旧元素上）；
     *  键盘 ↑/↓ 调音量、拖到 0 触发静音时，只要浮层开着就能跟上。 */
    private syncVolumePop(): void {
        const pop = this.menuEl?.querySelector('.rl-vp-volpop');
        if (!(pop instanceof HTMLElement)) return;
        const v = clampVolume(this.videoEl?.volume ?? 1);
        const val = pop.querySelector('.rl-vp-vol-val');
        if (val instanceof HTMLElement) val.setText(String(Math.round(v * 100)));
        const slider = pop.querySelector('input.rl-vp-vol-range');
        if (slider instanceof HTMLInputElement) {
            slider.value = String(v);
            slider.style.setProperty('--rl-vol-p', `${v * 100}%`);
        }
    }

    private setVolume(v: number): void {
        const vol = clampVolume(v);
        this.videoEl.volume = vol;
        this.videoEl.muted = vol === 0;
        vpVolume = vol;
        vpMuted = this.videoEl.muted;
        this.syncVolumeUi();
        this.pokeIdle();
    }

    private toggleMute(): void {
        const next = !(this.videoEl.muted || this.videoEl.volume === 0);
        this.videoEl.muted = next;
        vpMuted = next;
        // 取消静音时若音量为 0，补一个可听音量，避免「解除静音还是没声」
        if (!next && this.videoEl.volume === 0) this.setVolume(0.6);
        this.syncVolumeUi();
        this.showToast(next ? '已静音' : '已取消静音');
        this.pokeIdle();
    }

    /** 设定倍速（由浮层面板选档回传；按钮文案固定「倍速」，不再跟着档位变 —— 用户 2026-09-18 第二次指示） */
    private setSpeed(v: number): void {
        vpSpeed = v;
        if (this.videoEl) this.videoEl.playbackRate = vpSpeed;
        this.showToast(`播放速度 ${formatSpeed(vpSpeed)}`);
        this.pokeIdle();
    }

    /**
     * 「全屏」= **标签页全屏**（本视图铺满 Obsidian 窗口），⛔ 不是整块电脑屏幕的浏览器全屏。
     *
     * 🔴 用户 2026-11-09 逐字：「这个播放器的全屏按钮怎么有两种全屏状态啊，
     *    给我改成纯以前的标签页全屏，而不是整个电脑屏幕全屏」
     *    ⇒ 这里**不再调 `requestFullscreen`**。原来那条路会把整块显示器都接管掉（Electron 层全屏），
     *      与「在 Obsidian 窗口内放大这个标签页」是两种完全不同的视觉态，用户只承认后者。
     *
     * 实现：给自己的 `contentEl` 打一个类，CSS 让它 `position:fixed; inset:0` 盖住**应用窗口**
     * （`inset` 相对的是 Obsidian 的渲染视口，不是显示器）⇒ 视觉上就是「这个标签页铺满了整个
     * Obsidian」，⛔ 不会影响任务栏/其它应用，也⛔ 不需要浏览器权限。
     * ⚠️ 类名挂在 `contentEl` 而不是 `containerEl`：`containerEl` 是 `.workspace-leaf`，
     *    Obsidian 自己的布局代码会往它身上写内联样式，打架风险高（拖分栏时会被清掉）。
     * ⚠️ 退出走同一个入口（再点一次 / 再双击 / 按 F），⛔ 不依赖 `fullscreenchange` ——
     *    标签页全屏是纯 CSS，浏览器根本不会派发那条事件。
     *    （2026-11-23 补：`fullscreenchange` 现在**会**因为「全屏+」而触发，
     *     但那与本方法无关，⛔ 不要把两者接起来 —— 见 `onFsChange` 里的说明。）
     */
    private toggleFullscreen(): void {
        // ⚠️ Obsidian 的 `toggleClass` 必须给第二个参数（☠️ 少传一个直接 tsc 报 TS2554），
        //    故自己读当前态取反 —— 语义就是「切一下」。
        const on = !this.contentEl.hasClass('rl-vp-tabfs');
        this.contentEl.toggleClass('rl-vp-tabfs', on);
        this.closeMenu();
    }

    /**
     * 浏览器级 `fullscreenchange` 的用途，两件事，别再加第三件：
     *
     * 1️⃣ **把可能残留的浮层收干净。** 全屏进出时控制条尺寸会变，浮层是控制条的绝对定位子元素，
     *    不收就会错位到屏幕外。
     * 2️⃣ **回读「全屏+」的真实状态。** 用户可能按 Esc / F11 退出，
     *    那条路不过这颗按钮 ⇒ 不靠事件回读 `document.fullscreenElement`，图标就会一直停在退出态。
     *
     * 🔴 2026-11-23 修订（②）：这里从「唯一残留用途」变成「同步全屏+」。
     *    2026-11-09 那版说「本视图没有进入浏览器全屏的通路」——**现在有了**（「全屏+」），
     *    但当时那条结论的另一半仍然成立、不要推翻：
     * ⛔ 仍然不要用这个事件去切 `fsBtn`（「全屏」= 标签页全屏）的图标。
     *    那颗按钮和浏览器全屏无关，跟着变就是「一颗按钮两种状态」——正是 2026-11-09 要消灭的困惑。
     *    两种全屏各管各的按钮：`fsBtn` ⇄ `rl-vp-tabfs`（纯 CSS），`fsPlusBtn` ⇄ `fullscreenElement`（浏览器）。
     */
    private onFsChange = (): void => {
        this.closeMenu();
        this.syncFsPlusBtn();
    };

    private async togglePip(): Promise<void> {
        const v = this.videoEl as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture?.();
            else await v.requestPictureInPicture?.();
        } catch {
            new Notice('当前环境不支持画中画');
        }
        // 事件正常会自己刷，但某些实现（如被别处退出）不回调 ⇒ 这里补一次，保证设置弹窗里那一行文案不错位
        this.refreshSettingMenu();
    }

    /** 快捷键分派（映射表见 pure/player.resolveKeyAction） */
    /** 当前播放的条目 id（宿主深链定位用：同条目 → 直接切集跳转，不重开标签页） */
    get playingEntryId(): string | undefined {
        return this.opts?.entryId;
    }

    /**
     * 深链定位（宿主调用，见 `main.openVideoAt`）：切到该集并跳到该秒播放。
     * 切集要重设 src → 把目标暂存进 `pendingSeek`，由下一次 `loadedmetadata` 消费。
     */
    seekToEpisode(index: number, seconds: number): void {
        if (!this.opts || !this.videoEl) return;
        // 🔴 用户 2026-11-14「网络集的时间戳…不能跳转」：网络集根本不在 `items` 里
        //    ⇒ `findIndex` 必然 -1 ⇒ 直接 return = 点了没反应。
        //    ⚠️ 判据走 `isNetPlayback()` 而不是 `opts.netSource`：选集页的网络态由它自己覆写
        //    （那里没有 `netSource` 这个字段），只判 `netSource` 会把选集页漏掉。
        if (this.isNetPlayback()) {
            if (this.netMarkEpisode() === index) {
                this.applySeek(seconds);
                return;
            }
            this.retargetNetEpisode(index, seconds);
            return;
        }
        const pos = this.opts.items.findIndex((it) => it.index === index);
        if (pos < 0) {
            // 目标集不在 `items` 里（网络集 / 已被移除）⇒ 交给换集钩子，
            // ⛔ 别静默 return：用户点了没反应就是这个观感的来源。
            this.retargetNetEpisode(index, seconds);
            return;
        }
        if (pos !== this.cur) {
            this.pendingSeek = { index, seconds };
            this.cur = pos;
            this.render();
            return;
        }
        this.applySeek(seconds);
    }

    /**
     * 当前这一路是不是「网络流」——网络集没有本地文件、**进不了 `items`**，
     * 所以 `consumePendingTarget` 里按 `items[].index` 找目标集必然 -1。
     * ⚠️ 2026-11-24：播放器页已不可能播网络集（用户 m01744）⇒ 基类固定返回 `false`。
     *    选集页覆写成认 `netIndex`（官方 iframe 态仍要按秒定位）。
     */
    protected isNetPlayback(): boolean {
        return false;
    }

    /**
     * 跳到**另一集网络流**（异集深链时间戳）。
     *
     * ⚠️ 2026-11-24：播放器页已不播网络集（用户 m01744）⇒ 基类这条默认路径只剩一句提示。
     *    选集页覆写它直接换官方 iframe，⛔ 不要重开标签页（那会越点标签越多）。
     */
    protected retargetNetEpisode(_index: number, _seconds: number): void {
        this.showToast('这一集还没有加载，先点开这一集再跳');
    }

    /**
     * 进场定位（#326）：带 `pendingSeek`（时间戳链接进来）→ 定位到该秒并播放；否则走续播。
     * 🔴 两者**互斥**（目标位置优先）：先跳续播处再跳目标会看到明显闪动。
     * 目标集不在可内嵌列表里（不可解码 / 已移除）→ 清掉目标退回续播。
     */
    private consumePendingTarget(): void {
        const seek = this.pendingSeek;
        if (!seek) {
            this.consumePendingResume();
            return;
        }
        // 🔴 2026-11-24：网络源（`netSource`）已删（用户 m01744）⇒ 播放器页只播本地集，
        //    集号恒为占位 -1 这种情况不复存在，直接按集号找目标集。
        const pos = this.opts?.items.findIndex((it) => it.index === seek.index) ?? -1;
        if (pos < 0) {
            this.pendingSeek = null;
            // 🔴 2026-11-10 用户报障：「退出全屏时返回到详情页后进度就重回 0 了」。
            //    网络集**不在 `items` 里**（没有本地文件），`findIndex` 必然 -1 ⇒ 老写法在这里
            //    把目标秒直接丢掉、退回续播 ⇒ 从 0 重播。⇒ 集找不到但当前是网络流时，
            //    秒数照样有效，就地按秒定位（`isNetPlayback` 由子类判）。
            if (this.isNetPlayback()) {
                this.applySeek(seek.seconds);
                return;
            }
            this.consumePendingResume();
            return;
        }
        if (pos !== this.cur) {
            this.cur = pos;
            this.render(); // 换集重设 src → 下一次 loadedmetadata 再进这里（pendingSeek 保留）
            return;
        }
        this.pendingSeek = null;
        this.applySeek(seek.seconds);
    }

    /** 进场 seek 待落位的目标秒（见 `landSeek`：媒体没 seekable 前写 currentTime 会被丢弃） */
    private seekLandTarget: number | null = null;
    private seekLandTimer: number | null = null;
    private seekLandTries = 0;

    /** 跳到指定秒并播放（时间戳链接的目标位置；越界由 clampSeek 夹住） */
    private applySeek(seconds: number): void {
        this.seekLandTarget = seconds;
        this.seekLandTries = 0;
        this.landSeek();
    }

    /**
     * 进场 seek 的「落位」重试。
     *
     * 🔴 2026-11-10 用户报障：「网络集用插件播放器播放全屏……怎么还是要刷新重置进度了」。
     *    根因：`consumePendingTarget` 挂在 `loadedmetadata` 上，可那一刻媒体多半**还没 seekable**
     *    （网络流/分片流尤其如此）⇒ 直接写 `currentTime` 被浏览器**静默丢弃**，于是从 0 开始播，
     *    表现为「交接过来进度被重置」。
     *    ⇒ 把目标秒记住，每 250ms 重试，直到 `currentTime` 真落到目标（±1.5s）或超时。
     *    ⛔ 别改成「只在 `loadedmetadata` 里写一次 `currentTime`」——那就是本次病根。
     *    ⛔ 落位成功才算完：`showToast('已跳到 …')` 必须等真跳到了再弹，否则是空头承诺。
     */
    private landSeek(): void {
        const target = this.seekLandTarget;
        if (target === null) return;
        const el = this.videoEl;
        if (!el) {
            this.seekLandTarget = null;
            return;
        }
        const want = clampSeek(target, el.duration);
        if (el.seekable.length > 0) {
            try {
                el.currentTime = want;
            } catch {
                /* 媒体异常：等下一轮或超时，⛔ 不吞掉目标秒 */
            }
            if (Math.abs(el.currentTime - want) <= 1.5) {
                this.seekLandTarget = null;
                if (this.seekLandTimer !== null) {
                    window.clearTimeout(this.seekLandTimer);
                    this.seekLandTimer = null;
                }
                this.updateProgressUi();
                void el.play().catch(() => undefined);
                this.showToast(`已跳到 ${formatTime(target)}`);
                return;
            }
        }
        this.seekLandTries += 1;
        if (this.seekLandTries > 60) {
            // 15 秒还没落位：超时收手，但**不弹「已跳到」**（没做到就不承诺）
            this.seekLandTarget = null;
            return;
        }
        if (this.seekLandTimer !== null) return;
        this.seekLandTimer = window.setTimeout(() => {
            this.seekLandTimer = null;
            this.landSeek();
        }, 250);
    }

    /** 插入时间戳（#326）：把「当前时刻 + 当前集」交给宿主（宿主构造链接 + 决定落到哪个笔记）。
     *  公开：顶栏按钮、快捷键、命令面板三条入口共用（#326 用户要求「一键」）。
     *  🔴 m04435 ①：`caption` 只有右键浮层会传（`🤩 震撼 备注`）；左键/快捷键/命令面板都不传
     *     ⇒ 落盘形态与 #587 定稿**一字不差**（纯链接）。 */
    async insertStamp(caption?: string): Promise<void> {
        const cb = this.opts?.onInsertStamp;
        if (!cb) return;
        // ⚠️ 网络集用宿主给的真实集号（占位 item 的 index 是 -1，写进笔记就是一条永远对不上的标记）
        const base = { seconds: this.videoEl?.currentTime ?? 0, ep: this.markEpisodeIndex() };
        const c = typeof caption === 'string' ? caption.trim() : '';
        await cb(c ? { ...base, caption: c } : base);
    }

    /**
     * 🔴 m04435 ①：右键时间戳按钮 ⇒ 弹「时间戳笔记」浮层。
     *
     * 浮层挂在 `.rl-vp-root` 内、**绝对定位到触发按钮下方 8px**（本仓 `position: fixed` 会被视图的
     * transform 祖先整体偏移 —— 见 `src/views/components/MediaList.svelte:2228` 等三处注释，来自 #610）。
     * 右对齐按钮、并夹在 root 宽度内（按钮在最右侧，不夹会溢出到屏幕外）。
     *
     * ⚠️ 同一时刻只留一个浮层：再点右键先销毁旧的（⛔ 别叠两层，那会让 Esc 只关掉上面那个）。
     */
    private openStampNotePopover(anchor: HTMLElement): void {
        const cb = this.opts?.onInsertStamp;
        const root = this.rootEl;
        if (!cb || !root) return;
        this.closeStampNotePopover();
        const host = root.createDiv({ cls: 'rl-vp-stampnote hidden' });
        this.stampNoteEl = host;
        const seconds = this.videoEl?.currentTime ?? 0;
        const ep = this.markEpisodeIndex();
        const timeText = stampTimeText(this.opts, seconds, ep);
        this.stampNotePopover = new StampNotePopover({
            timeText,
            onCommit: async (result: StampNoteResult) => {
                const caption = stampNoteCaption(result.mood, result.note);
                await this.insertStamp(caption);
            },
            onClose: () => this.closeStampNotePopover(),
        });
        this.stampNotePopover.mount(host);

        // 定位：先挂上去量尺寸，再算坐标（display:none 时量不到，故先去掉 hidden 但保持不可见）
        host.removeClass('hidden');
        host.addClass('is-measuring');
        const rr = root.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        const width = host.offsetWidth;
        const left = Math.max(8, Math.min(ar.left - rr.left + ar.width - width, rr.width - width - 8));
        const top = Math.max(8, ar.bottom - rr.top + 8);
        host.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
        host.removeClass('is-measuring');
        // 浮层打开期间控制条不许闲置淡出（否则浮层会跟着一起消失）
        this.pokeIdle();
    }

    /** 关掉右键「时间戳笔记」浮层（幂等；`onClose` 也会回到这里 ⇒ 必须可重入） */
    private closeStampNotePopover(): void {
        const pop = this.stampNotePopover;
        this.stampNotePopover = null;
        pop?.destroy();
        this.stampNoteEl?.remove();
        this.stampNoteEl = null;
    }

    /**
     * 🔴 m07854 ⑰：**右键截图按钮 = 先批注再落盘**（左键 `takeShot()` 一字未改）。
     *
     * 复用同一个 `onCaptureShot` 出口：批注弹窗把「批注后的 PNG」交回来，宿主那边
     * 仍然走原来的「落盘 + 写笔记」链路 ⇒ ⛔ 别在宿主里开第二条写笔记的路。
     * 无 `onCaptureShot`（单文件预览 / 没有条目上下文）时直接返回，与 `takeShot` 同口径。
     */
    async annotateShot(): Promise<void> {
        const cb = this.opts?.onCaptureShot;
        if (!cb) return;
        const buf = await this.captureFrame();
        if (!buf) return;
        const seconds = this.videoEl?.currentTime ?? 0;
        const ep = this.markEpisodeIndex();
        new ShotAnnotateModal(this.app, {
            png: buf,
            onSave: (annotated) => cb({ png: annotated, seconds, ep }),
        }).open();
    }

    /** 截取当前帧（#326）：抓帧 → 交宿主落盘 + 写笔记（视图不碰 vault）。公开：三条入口共用 */
    async takeShot(): Promise<void> {
        const cb = this.opts?.onCaptureShot;
        if (!cb) return;
        const buf = await this.captureFrame();
        if (!buf) return;
        await cb({ png: buf, seconds: this.videoEl.currentTime, ep: this.markEpisodeIndex() });
    }

    /**
     * 抓当前帧 → PNG ArrayBuffer；**抓不到时返回 null 并提示**（绝不产出黑图）。
     * 🔴 无污染的前提是 `video.crossOrigin='anonymous'`（见 `buildStage`）—— 本地 `app://` 源否则会污染 canvas。
     */
    private async captureFrame(): Promise<ArrayBuffer | null> {
        const v = this.videoEl;
        // readyState < 2 = 还没有当前帧（未起播 / 元数据不完整）→ 抓出来是黑图
        if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) {
            this.showToast('请先播放一下，再截取当前帧');
            return null;
        }
        try {
            const canvas = document.createElement('canvas');
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
            return blob ? await blob.arrayBuffer() : null;
        } catch (err) {
            // 已知唯一成因：canvas 被判定污染（跨源且缺 CORS）→ 明确提示，别静默失败
            new Notice(`截取失败：${err instanceof Error ? err.message : String(err)}`, 4000);
            return null;
        }
    }

    private runAction(action: PlayerKeyAction): void {
        // 占位态（Obsidian 恢复布局、尚无播放内容）下按到快捷键：直接忽略，
        // 否则 this.videoEl 还没建出来，togglePlay() 之类会当场抛错
        if (!this.opts || !this.videoEl) return;
        switch (action) {
            case 'toggle':
                this.togglePlay();
                return;
            case 'seek:-5':
                this.nudge(-SEEK_STEP);
                return;
            case 'seek:5':
                this.nudge(SEEK_STEP);
                return;
            case 'seek:-30':
                this.nudge(-SEEK_STEP_LARGE);
                return;
            case 'seek:30':
                this.nudge(SEEK_STEP_LARGE);
                return;
            case 'volume:up':
                this.setVolume((this.videoEl.volume ?? 0) + 0.05);
                this.showToast(`音量 ${Math.round(this.videoEl.volume * 100)}%`);
                return;
            case 'volume:down':
                this.setVolume((this.videoEl.volume ?? 0) - 0.05);
                this.showToast(`音量 ${Math.round(this.videoEl.volume * 100)}%`);
                return;
            case 'mute':
                this.toggleMute();
                return;
            case 'stamp':
                void this.insertStamp();
                return;
            case 'shot':
                void this.takeShot();
                return;
            case 'fullscreen':
                this.toggleFullscreen();
                return;
        }
    }

    private nudge(delta: number): void {
        const dur = this.videoEl?.duration ?? 0;
        this.videoEl.currentTime = clampSeek(this.videoEl.currentTime + delta, dur);
        this.updateProgressUi();
        this.showToast(delta > 0 ? `快进 ${delta} 秒` : `后退 ${Math.abs(delta)} 秒`);
        this.savePosition(true);
    }

    // ── 连播 ──

    private showNextPanel(target: number): void {
        const next = this.opts?.items[target];
        if (!next || !this.nextPanelEl) return;
        // 🔴 #604：目标集记下来 —— 「立即播放」与倒计时到点都读它（列表循环绕回第一集时 cur+1 是错的）
        this.nextTarget = target;
        const label = episodeLabel(next, false) || '下一集';
        this.nextPanelTextEl?.setText(label);
        this.nextDeadline = Date.now() + NEXT_EP_SECONDS * 1000;
        this.nextPanelEl.removeClass('hidden');
        this.syncNextCountdown();
        if (this.nextTimer === null) this.nextTimer = window.setInterval(() => this.syncNextCountdown(), 500);
    }

    private syncNextCountdown(): void {
        const left = Math.max(0, Math.ceil((this.nextDeadline - Date.now()) / 1000));
        this.nextPanelTextEl?.setAttribute('data-count', String(left));
        const labelEl = this.nextPanelEl?.querySelector('.rl-vp-next-label');
        if (labelEl instanceof HTMLElement) labelEl.setText(nextEpisodeText(left));
        if (left <= 0) {
            const target = this.nextTarget;
            this.hideNextPanel();
            if (target !== null) this.goto(target);
        }
    }

    private hideNextPanel(): void {
        if (this.nextTimer !== null) {
            window.clearInterval(this.nextTimer);
            this.nextTimer = null;
        }
        this.nextTarget = null;
        this.nextPanelEl?.addClass('hidden');
    }

    // ── 字幕 ──

    /** 打开/切集时自动挂载同目录字幕（候选按「完全同名 → 中文 → 其它」排序，取第一条） */
    private async autoLoadSubtitle(): Promise<void> {
        const item = this.opts?.items[this.cur];
        const list = this.opts?.listSubtitles;
        if (!item || !list) {
            this.subCandidates = [];
            return;
        }
        const videoPath = item.path;
        try {
            this.subCandidates = await list(videoPath);
        } catch {
            this.subCandidates = [];
        }
        // 异步返回时可能已切集：路径变了就丢弃
        if (this.opts?.items[this.cur]?.path !== videoPath) return;

        // 🔴 用户 2026-10-29「字幕要双向持久化」的**恢复方向**：
        //    这一集存过字幕 ⇒ 直接挂存过的那条（用户上次的选择优先于「同目录第一条」）。
        const saved = this.opts?.initialSubtitles?.[this.epKey()];
        if (saved) {
            const vtt = await this.loadVtt(saved);
            if (vtt) {
                const savedName = fileNameOfPath(saved);
                this.mountTrack(vtt, subtitleLangLabel(subtitleLangTag(savedName)) || savedName);
                this.subFile = savedName;
                this.subPath = saved;
                this.afterSubtitles();
                return;
            }
            // 🔴 文件丢失：存过的字幕路径现在读不到了（用户挪走了 / 删掉了）。
            //    ⛔ 不能静默退回候选装作没事 —— 用户会以为「我设过的字幕怎么没了」。
            //    明确告知 + 退回同目录候选兜底，并把这条失效记录清掉（否则每次打开都白读一次盘）。
            this.showToast('已保存的字幕文件已丢失，已回退同目录字幕');
            this.opts?.onSaveSubtitle?.(this.epKey(), '');
        }

        if (this.subCandidates.length > 0) await this.applySubtitle(this.subCandidates[0].fileName, true);
        this.afterSubtitles();
    }

    /**
     * #606 字幕面板内容（🔴 与设置面板**同一个浮层容器**，因此自动继承「上浮 / 贴按钮右缘 / 外点关闭 /
     * Esc 关 / 闲置淡出」全套规则 —— 这正是用户说的「同设置面板一样上浮出来，不是弹窗」）。
     *
     * 结构：标题 → 「显示字幕」开关 + 提示 → 同目录候选 → 分割线 → 「从文件选择字幕 ›」。
     * 结构与文案全来自 `pure/playerMenu.buildSubtitleMenu`，这里只做 DOM + 回传。
     */
    private renderSubtitleMenu(menu: HTMLElement): void {
        const model = buildSubtitleMenu({
            title: this.opts?.entryTitle ?? '',
            // ⚠️ 语言标签在**这里**本地化（`playerMenu` 不依赖 `pure/subtitle`）
            candidates: this.subCandidates.map((c) => ({ fileName: c.fileName, lang: subtitleLangLabel(c.lang) })),
            current: this.subFile,
            visible: this.subVisible && !!this.subFile,
        });
        menu.createDiv({ cls: 'rl-vp-set-head', text: model.title });
        // 组容器：让「候选区 → 动作行」之间由 `.rl-vp-set-group + .rl-vp-set-group` 画出那条分割线
        const body = menu.createDiv({ cls: 'rl-vp-set-group' });

        // ① 显示字幕开关（就地生效、面板不关）
        const swRow = body.createEl('button', {
            cls: `rl-vp-set-row rl-vp-switch-row${model.visible ? ' is-on' : ''}`,
            attr: { role: 'switch', 'aria-checked': model.visible ? 'true' : 'false', 'data-row': 'subtitle' },
        });
        swRow.createDiv({ cls: 'rl-vp-set-lbl', text: SUBTITLE_SWITCH_LABEL });
        const sw = swRow.createSpan({ cls: 'rl-vp-switch' });
        sw.createSpan({ cls: 'rl-vp-switch-knob' });
        swRow.addEventListener('click', () => {
            const on = !this.subVisible;
            swRow.toggleClass('is-on', on);
            swRow.setAttribute('aria-checked', on ? 'true' : 'false');
            void this.setSubtitleVisible(on);
        });
        body.createDiv({ cls: 'rl-vp-sub-hint', text: model.hint });

        // ② 同目录候选（点一条即挂载 + 收面板）
        if (model.candidates.length === 0) {
            body.createDiv({ cls: 'rl-vp-sub-empty', text: model.emptyText });
        } else {
            const list = body.createDiv({ cls: 'rl-vp-sub-list' });
            for (const c of model.candidates) {
                const row = list.createEl('button', {
                    cls: c.active ? 'rl-vp-sub-row is-on' : 'rl-vp-sub-row',
                    attr: { 'data-tip': c.lang ? `${c.lang} · ${c.fileName}` : c.fileName },
                });
                row.createSpan({ cls: 'rl-vp-sub-lang', text: c.lang || '字幕' });
                row.createSpan({ cls: 'rl-vp-sub-file', text: c.fileName });
                row.addEventListener('click', () => {
                    this.closeMenu();
                    void this.applySubtitle(c.fileName);
                });
            }
        }

        // ③ 底部动作行：从文件选择字幕（右侧 ›，与设置面板的动作行同款）
        const group = menu.createDiv({ cls: 'rl-vp-set-group' });
        const nav = group.createEl('button', { cls: 'rl-vp-set-row rl-vp-set-nav' });
        nav.createDiv({ cls: 'rl-vp-set-lbl', text: model.browseLabel });
        const chev = nav.createSpan({ cls: 'rl-vp-set-chev' });
        safeSetIcon(chev, 'chevron-right');
        nav.addEventListener('click', () => {
            this.closeMenu();
            void this.browseSubtitleFile();
        });
    }

    /** 「从文件选择字幕」：系统选择器挑一个 → 读入转 VTT → 挂载（失败 / 取消都不动现状） */
    private async browseSubtitleFile(): Promise<void> {
        const picked = await this.opts?.pickSubtitleFile?.();
        if (!picked) return;
        const vtt = await this.loadVtt(picked);
        if (!vtt) {
            this.showToast('字幕读取失败');
            return;
        }
        const name = fileNameOfPath(picked);
        this.mountTrack(vtt, subtitleLangLabel(subtitleLangTag(name)) || name);
        this.subFile = name;
        this.subPath = picked;
        // 🔴 手动从文件选择 = 用户明确指定 ⇒ 落库到这一集（双向持久化的「播放器 ⇒ 数据库」方向）
        this.opts?.onSaveSubtitle?.(this.epKey(), picked);
    }

    /**
     * #605「显示字幕」开关（用户裁定：**仅隐藏、保留已挂载字幕，打开即恢复**）。
     * 🔴 隐藏 = 把轨道 mode 打回 `disabled`（⛔ **不撤轨道、不 revoke Blob URL**）—— 打开时原样点亮即可，
     *    不必重读文件、也不会丢「当前挂的是哪一条」。
     * 🔴 打开时若手上**没有**任何轨道（= 从没挂过 / 之前失败），退回「自动挂同目录第一条」；
     *    连候选都没有就如实提示（⛔ 别让开关看着像点了没反应）。
     */
    private async setSubtitleVisible(on: boolean): Promise<void> {
        this.subVisible = on;
        this.syncTrackModes();
        if (on && !this.subFile) {
            if (this.subCandidates.length > 0) await this.applySubtitle(this.subCandidates[0].fileName, true);
            else {
                this.showToast('同目录没有字幕文件，可从文件选择');
                this.syncSubBtn();
                return;
            }
        }
        this.syncSubBtn();
        this.afterSubtitles();
    }

    /**
     * 控制条「字幕」按钮的亮起态 = **正在显示字幕** 或 **字幕面板开着**。
     * 🔴 #606：面板改挂这个按钮后，「打开态」与「已挂载态」落在同一枚按钮上 ⇒ 两个条件合成一条
     *    （⛔ 别写成两处 toggleClass 互相覆盖 —— 关面板那一下会把「已挂载」的亮起一起抹掉）。
     */
    private syncSubBtn(): void {
        this.subBtn?.toggleClass('is-on', this.menuKind === 'subtitle' || (this.subVisible && !!this.subFile));
    }

    /** 按候选文件名加载（同目录） */
    private async applySubtitle(fileName: string, silent = false): Promise<void> {
        const item = this.opts?.items[this.cur];
        if (!item) return;
        const dir = dirOfPath(item.path);
        const full = dir ? `${dir}/${fileName}` : fileName;
        const vtt = await this.loadVtt(full);
        if (!vtt) {
            if (!silent) this.showToast('字幕读取失败');
            return;
        }
        this.mountTrack(vtt, subtitleLangLabel(subtitleLangTag(fileName)) || fileName);
        this.subFile = fileName;
        this.subPath = full;
        if (!silent) this.showToast(`已挂载字幕：${fileName}`);
        // 🔴 用户 2026-10-29「字幕要双向持久化」：用户**主动**选的这条要落库到这一集。
        //    silent=true（自动挂载）不写 —— 那是程序挑的兜底，不该盖掉用户上次的选择。
        if (!silent) this.opts?.onSaveSubtitle?.(this.epKey(), full);
        this.afterSubtitles();
    }

    private async loadVtt(path: string): Promise<string | null> {
        try {
            return (await this.opts?.loadSubtitleVtt?.(path)) ?? null;
        } catch {
            return null;
        }
    }

    /** 挂载字幕轨道（Blob URL + 显式 showing，避免部分环境 default 不生效）。
     *  🔴 挂载即「显示」（`subVisible = true`）—— 用户选了一条字幕就是要看它。 */
    private mountTrack(vtt: string, label: string): void {
        this.clearSubtitle();
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = label || '字幕';
        track.srclang = 'zh';
        track.default = true;
        track.src = url;
        this.videoEl.appendChild(track);
        this.subUrl = url;
        this.subVisible = true;
        this.syncTrackModes();
        this.syncSubBtn();
    }

    /** 按 `subVisible` 点亮 / 熄灭所有字幕轨道（切源重生 / 开关切换共用一份判定）。 */
    private syncTrackModes(): void {
        const tracks = this.videoEl?.textTracks;
        if (!tracks) return;
        for (let i = 0; i < tracks.length; i++) {
            // 只认最后挂上来的那一条为字幕源；其余历史轨道一律 disabled
            tracks[i].mode = i === tracks.length - 1 && this.subVisible ? 'showing' : 'disabled';
        }
    }

    private clearSubtitle(): void {
        if (!this.videoEl) return;
        Array.from(this.videoEl.querySelectorAll('track')).forEach((t) => t.remove());
        if (this.subUrl) {
            URL.revokeObjectURL(this.subUrl);
            this.subUrl = null;
        }
        this.subFile = null;
        this.subPath = null;
        this.syncSubBtn();
    }

    // ── 可见性 / 省电（用户 2026-09-18：后台或不可见时自动停止渲染，释放 GPU 与内存）──

    /** 挂三路可见性信号（onClose 由 unbindVisibility 对称摘掉） */
    private bindVisibility(): void {
        document.addEventListener('visibilitychange', this.onDocVisibilityChange);
        this.vis.bound = true;
        // 页签切换 / 布局变化：Obsidian 侧唯一可靠的时机（容器显示状态此刻才会变）
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncVisibility()));
        this.registerEvent(this.app.workspace.on('layout-change', () => this.syncVisibility()));
        // 视口交集：兜住布局裁切 / 零尺寸等意外情形（PDF 阅读器已有同款手法）
        if (typeof IntersectionObserver === 'function') {
            this.vis.observer = new IntersectionObserver((entries) => {
                const entry = entries[entries.length - 1];
                if (!entry) return;
                this.vis.viewport = entry.isIntersecting;
                this.syncVisibility();
            });
            this.vis.observer.observe(this.contentEl);
        }
        this.syncVisibility();
    }

    private unbindVisibility(): void {
        if (this.vis.bound) {
            document.removeEventListener('visibilitychange', this.onDocVisibilityChange);
            this.vis.bound = false;
        }
        this.vis.observer?.disconnect();
        this.vis.observer = null;
    }

    private onDocVisibilityChange = (): void => {
        this.vis.doc = document.visibilityState !== 'hidden';
        this.syncVisibility();
    };

    /** 三路信号合判：任一为否即视为不可见 */
    private isVisibleNow(): boolean {
        return this.vis.doc && this.vis.leaf && this.vis.viewport;
    }

    /**
     * 可见性边沿处理：不可见 → 记现场并暂停（解码器随之停下，释放 GPU）+ 起「彻底释放」计时；
     * 可见 → 续播或从彻底释放态重建。`layout-change` 等事件可能很密集，故只在**边沿**动作。
     */
    private syncVisibility(): void {
        // 没内容 / 还没挂源 → 无从「停渲染」（也要和快捷键那处占位态守卫区分开，别让产物断言数不清）
        if (!this.opts || !this.videoEl || !this.videoEl.src) return;
        // 容器显示状态：`.isShown()` 是 Obsidian 自带 API（覆盖「切走页签 / 面板收起」）；
        // 旧版本没有该方法时按「显示着」处理，避免误暂停。
        this.vis.leaf = this.containerEl.isShown?.() ?? true;
        const now = this.isVisibleNow();
        if (!this.vis.primed) {
            // 首次判定只记账：视图刚挂载时元素可能还没测量出尺寸，据此暂停会把刚要播的视频掐掉
            this.vis.primed = true;
            this.vis.visible = now;
            return;
        }
        if (now === this.vis.visible) return;
        this.vis.visible = now;
        if (now) this.onBecameVisible();
        else this.onBecameHidden();
    }

    /** 转为不可见：停渲染 + 停连播倒计时 + 起彻底释放计时（**后台播放开着时整段跳过**） */
    private onBecameHidden(): void {
        // 后台播放（用户 2026-09-18 第四次指示）：什么都不做 —— 不暂停、也不起「彻底释放」计时，
        // 切走 / 最小化后声音继续。此时把 resume 置否，免得回来时又重复 play 一次。
        if (this.bgPlay) {
            this.vis.resume = false;
            return;
        }
        this.vis.resume = !this.videoEl.paused;
        if (this.vis.resume) this.videoEl.pause();
        // 看不见的时候就别偷偷切下一集了（否则回来发现已经在播别的）
        this.hideNextPanel();
        this.stopDeepTimer();
        this.vis.timer = window.setTimeout(() => this.deepRelease(), HIDDEN_RELEASE_MS);
    }

    /** 恢复可见：续播，或从彻底释放态重建 */
    private onBecameVisible(): void {
        this.stopDeepTimer();
        if (this.vis.deep) {
            this.deepRestore();
            return;
        }
        // 自动续播可能被浏览器自动播放策略拦（提示用户点一下画面即可）
        if (this.vis.resume) void this.videoEl.play().catch(() => this.showToast('已恢复到前台，点画面继续播放'));
        this.vis.resume = false;
        this.pokeIdle();
    }

    /**
     * 不可见超时 → 把解码缓冲与内存一起放掉（只留位置）。
     * 与 `releaseMedia()` 的区别：这是「临时清源、待会原地重建」——位置先落盘，字幕轨道与 Blob URL 都保留。
     */
    private deepRelease(): void {
        const v = this.videoEl;
        const item = this.opts?.items[this.cur];
        if (!v || !item || this.vis.deep || !v.src) return;
        this.vis.timer = null;
        this.vis.deep = { pos: v.currentTime, playing: this.vis.resume };
        this.savePosition(true);
        v.pause();
        v.removeAttribute('src');
        v.load();
    }

    /** 从彻底释放态重建：重挂源 → metadata 就绪后由 consumePendingResume 跳回原位（按需续播） */
    private deepRestore(): void {
        const v = this.videoEl;
        const item = this.opts?.items[this.cur];
        const st = this.vis.deep;
        if (!v || !item || !st) return;
        this.vis.deep = null;
        this.pendingResume = Math.floor(st.pos);
        v.src = item.url;
        v.playbackRate = vpSpeed;
        // 清源重生会把字幕轨道打回 disabled → 按当前「显示字幕」态重新点亮（轨道与 Blob URL 都还在，不必重扫目录）
        this.syncTrackModes();
        if (st.playing) void v.play().catch(() => this.showToast('已恢复到前台，点画面继续播放'));
        this.pokeIdle();
    }

    /** 作废「彻底释放」现场（换片/关闭时用：位置已无意义，别拿旧位置去跳新片） */
    private cancelDeepRelease(): void {
        this.stopDeepTimer();
        this.vis.deep = null;
        this.vis.resume = false;
    }

    private stopDeepTimer(): void {
        if (this.vis.timer !== null) {
            window.clearTimeout(this.vis.timer);
            this.vis.timer = null;
        }
    }

    // ── 杂项 ──

    /** 控制条浮出并重置闲置计时（播放中 IDLE_HIDE_MS 无操作自动淡出）
     *  🔴 浮层开着时一律不隐藏（`!this.menuKind`）—— 否则选集列到第 3 秒就被连浮层一起淡掉。
     *  🔴 #634：原先还有一条「标记卡片开着时也不隐藏」（`!this.cardOpen()`）—— 卡片已撤
     *     （进度条不再显示标记），而它当初要护的那枚按钮现在住**抽屉**里，抽屉不随控制条淡出 ⇒ 该例外作废。 */
    private pokeIdle(): void {
        this.rootEl?.removeClass('rl-vp-idle');
        if (this.idleTimer !== null) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idleTimer = window.setTimeout(() => {
            this.idleTimer = null;
            if (!this.videoEl?.paused && !this.dragging && !this.menuKind) {
                this.rootEl?.addClass('rl-vp-idle');
            }
        }, IDLE_HIDE_MS);
    }

    protected showToast(text: string): void {
        if (!this.toastEl) return;
        this.toastEl.setText(text);
        this.toastEl.removeClass('hidden');
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => {
            this.toastTimer = null;
            this.toastEl?.addClass('hidden');
        }, 1600);
    }

    private clearTimers(): void {
        if (this.idleTimer !== null) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        if (this.clickTimer !== null) {
            window.clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }
        if (this.posTimer !== null) {
            window.clearTimeout(this.posTimer);
            this.posTimer = null;
        }
        if (this.toastTimer !== null) {
            window.clearTimeout(this.toastTimer);
            this.toastTimer = null;
        }
        this.stopDeepTimer();
        this.hideNextPanel();
    }

    /** 停播并释放解码资源（换片/关闭时用；保留 video 元素本身） */
    private releaseMedia(): void {
        if (!this.videoEl) return;
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
    }

    /** 关闭播放器 = 关掉本标签页（沿用「无自绘 ✕」口径：点黑边 / 外部打开 / 解码失败兜底都走这里） */
    private closePlayer(): void {
        void this.leaf.detach();
    }

    /** 当前集「外部打开」：直接转系统播放器并关闭标签页 */
    private openExternal(): void {
        const item = this.opts?.items[this.cur];
        if (!item) return;
        this.opts?.onExternalFallback(item.path);
        this.closePlayer();
    }
}

/**
 * 🔴 m04435 ①：右键浮层预览里的时间文字。
 *
 * 优先用宿主给的 `stampPreviewText`（与写进笔记的链接文字**同源** —— 多集条目带 `第3集·`，
 * 纯网络条目也算得出集数）；宿主没接这个钩子时退回本地分钟秒格式 `3:20`。
 *
 * ⚠️ 退路**故意不带集号**：视图只知道 `items`（纯网络条目为空），自己判多集会把「第 3 集」
 * 显示成「第 1 集」—— 宁可少显示，也别显示错的集号（与 `marksForEpisode` 同一条纪律：
 * 反查不到就不画）。所以真正要准，宿主必须接 `stampPreviewText`。
 */
function stampTimeText(
    opts: { stampPreviewText?: (info: { seconds: number; ep: number }) => string } | null | undefined,
    seconds: number,
    ep: number,
): string {
    const cb = opts?.stampPreviewText;
    if (cb) {
        try {
            const t = String(cb({ seconds, ep }) ?? '').trim();
            if (t) return t;
        } catch {
            // 宿主给不出就别让浮层开不出来 —— 落回本地格式
        }
    }
    const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}
