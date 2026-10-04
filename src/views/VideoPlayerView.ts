// 内置视频播放器（工作区标签页视图，Media Extended 式；用户 2026-09-15 裁定「从新标签页打开而不是弹窗」）
// 结构（2026-09-18 按 B 站控制条口径重排）：
//   顶栏 = **只剩片名 · 集号**（不再承载任何入口，见下）；
//   视频区 = 白底舞台 + 点画面播放/暂停、双击全屏、暂停时中央播放按钮；点黑边**不关闭**（2026-09-17 裁定）；
//   底部控制条 = **单行三段式**（左组：上一集 / 播放暂停 / 下一集 ｜ 中段：进度条 + 时间 ｜
//        右组：选集 / 倍速 / 字幕 / 音量 / 设置齿轮 / 全屏）；进度条含缓冲段、已播段、悬停「落点 / 总长」预览与拖动；
//   浮层 = 选集 / 倍速 / 设置**共用同一容器**，贴触发按钮右缘向上浮出（内容与定位全在 pure/playerMenu）；
//   低频项（画中画、用系统播放器打开）收进设置齿轮。Esc 一级优先关浮层，但仍**不退出播放器**。
// 增强：字幕（同目录自动挂载 + 手动选，见 SubtitlePickerModal）、连播（播完倒计时切下一集）、记忆播放位置
// 沉浸：鼠标移入浮出、移出/静止 3s 淡出（暂停时不隐藏，见 pokeIdle）
// 省电（用户 2026-09-18）：不可见（切走页签 / 窗口最小化 / 元素不在视口）→ 停渲染释放 GPU；
//       不可见超 5 分钟 → 连解码缓冲一起放掉（clearSource），回来按落盘位置重建
// 纯逻辑（时间/进度/倍速/快捷键/续播判定、SRT→VTT、字幕候选匹配）在 pure/player.ts 与 pure/subtitle.ts，均有单测
// 播放源 URL 由 main 层算好传入（库内 getResourcePath / 库外 app://），本视图只负责渲染与交互
// Chromium 解码不了的格式（mkv/h265 等）由 main 层 isEmbeddableVideoPath 预判直接转系统播放器；<video> error 时也自动兜底
//
// 🔴 控件样式特异性（2026-09-15 实测踩坑，勿回退）：播放器控件样式**一律以 .rl-vp-root 打头**（0,2,0）。
//    旧写法是单类 .rl-vp-btn（0,1,0），会被两条更重的规则压过：
//      ① Obsidian 核心 button:not(.clickable-icon)（0,1,1）→ 背景变成主题 --interactive-normal（浅灰）、字色变 --text-normal；
//      ② 插件自己的 .modal-content button.rl-btn（0,2,1）→ padding: 4px 14px。
//    两者叠加后：30px 宽的图标按钮左右各吃 14px 内距 → 内容盒宽度 0px → <svg> 作为可收缩的 flex 子项被压成宽度 0
//    → 图标整片消失（用户看到的就是「按钮显示空白」）。无头复现页实测：svg 的 rect = 0 × 15。
import { ItemView, Notice, Scope, WorkspaceLeaf, setIcon } from 'obsidian';
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
    applyEpisodeEndChoice,
    buildEpisodeOptions,
    buildSettingOptions,
    buildSpeedOptions,
    episodeEndChoice,
    menuAnchor,
    nextMenuState,
    type EpisodeEndChoice,
    type PlayerMenuKind,
    type PlayerSwitchId,
} from 'pure/playerMenu';
// 进度条打点/标记（#333）：标记的**解析与过滤全在纯模块**里，视图只负责画 + 命中判定 + 分发。
import { hitMark, inBarBand, markCaption, markPct, marksForEpisode, pointerOnCard, MARK_DENSE_THRESHOLD, type VideoMark } from 'pure/videoMarks';
import { dirOfPath, fileNameOfPath, subtitleLangLabel, subtitleLangTag, type SubtitleCandidate } from 'pure/subtitle';
import { SubtitlePickerModal } from 'modals/SubtitlePickerModal';

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
     * 时间戳链接定位（#326）：等 `loadedmetadata` 后跳到该集该秒并播放。
     * `index` = **真实集下标**（`episodeFiles` 位；视图内按 `items[].index` 匹配）。
     * 与续播位置**互斥**：带 pendingSeek 时不走续播（目标位置优先，免得先跳续播处再跳走）。
     */
    pendingSeek?: { index: number; seconds: number };
    /** 插入时间戳（#326）：宿主负责构造链接 + 决定落到哪个笔记（视图只报「当前时刻 + 当前集」） */
    onInsertStamp?: (info: { seconds: number; ep: number }) => Promise<void>;
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
    /** 播放器开关 · 后台播放（缺省 false）：不可见时继续播放，不暂停也不释放解码 */
    backgroundPlay?: boolean;
    /** 播放器开关 · 自动切集（缺省 true = 历史行为）：关掉则播完停在结尾 */
    autoNextEpisode?: boolean;
    /** 播放器开关 · 单集循环（缺省 false）：播完重播当前集，优先级高于自动切集 */
    loopSingleEpisode?: boolean;
    /** 播放器开关写回（main 落 settings；缺省则只在本视图会话内生效） */
    onToggleSetting?: (key: 'bgPlay' | 'autoNext' | 'loopOne', value: boolean) => void;
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
    /** 进度条标记层（#333）：一条 `.rl-vp-marks` 里若干 `.rl-vp-mark` 圆点 */
    private marksLayerEl: HTMLElement | null = null;
    /** 悬停时命中的标记（null = 没悬在标记上）—— 卡片内容与「在笔记中打开」都看它 */
    private hoverMark: VideoMark | null = null;
    /** 当前集过滤后的标记 + 其百分比（命中判定与画点共用同一份，免得两处各算一遍漂掉） */
    private markList: VideoMark[] = [];
    private markPcts: number[] = [];
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
    /** 设置齿轮：原画中画按钮的位置改收「低频项」（画中画 / 用系统播放器打开） */
    private gearBtn: HTMLButtonElement | null = null;
    private fsBtn: HTMLButtonElement | null = null;
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
    /** 播放器开关的**可变副本**：用户当场切换必须立即生效，不能回读 opts 快照（那是打开时的值）。
     *  初值在 openWith 里从 opts 取；缺省与「设置字段缺省」保持一致。 */
    private bgPlay = false;
    private autoNext = true;
    private loopOne = false;
    /** 画面中央的极简播放按钮（用户 2026-09-18 替换旧的 64px 深色圆钮；显隐由 CSS 表达，这里只管图标） */
    private centerPlayEl: HTMLElement | null = null;
    private toastEl: HTMLElement | null = null;
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

    async onClose(): Promise<void> {
        // 位置落盘（关闭立即写，防最后一次进度丢失）
        this.savePosition(true);
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
        this.clearSubtitle();
        // 停播释放：清除 src 释放文件句柄/解码资源
        this.releaseMedia();
        this.contentEl.empty();
    }

    /** 载入播放内容（main 层在 setViewState 后调用；同一标签页可反复换片，不必新开）
     *  注：方法名不能叫 load —— ItemView 基类已占用 load()（视图生命周期），签名不同会编译失败 */
    openWith(opts: VideoPlayerOptions): void {
        this.opts = opts;
        // 三个播放器开关：取一份可变副本（用户当场切换要立即生效；opts 只是「打开那一刻」的快照）
        this.bgPlay = !!opts.backgroundPlay;
        this.autoNext = opts.autoNextEpisode !== false;
        this.loopOne = !!opts.loopSingleEpisode;
        const n = opts.items.length;
        this.cur = Math.max(0, Math.min(opts.startIndex, n - 1));
        // 时间戳链接定位（#326）：opts 只是「打开那一刻」的快照，故取一份可变副本，消费后置 null
        this.pendingSeek = opts.pendingSeek ? { ...opts.pendingSeek } : null;
        // 已挂载就整屏重建；未挂载（Obsidian 延迟渲染）则只记 opts，交给 onOpen
        if (this.opened) this.buildUi();
        // 标签页标题跟随片名：Obsidian 只在特定时机刷新 tab header，复用同一标签页换片时得手动刷一次，
        // 否则标题会停在上一部片名（updateHeader 未进公开 d.ts，故窄化断言后可选调用）
        const leaf = this.leaf as unknown as { updateHeader?: () => void };
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
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
        const root = this.contentEl.createDiv({ cls: 'rl-vp-root' });
        this.rootEl = root;
        this.buildBar(root);
        this.buildStage(root);
        this.buildControls(root);
        this.buildToast(root);
        this.buildNextPanel(root);
        // 闲置自动隐藏：鼠标在播放器内活动即浮出控制条
        root.addEventListener('mousemove', () => this.pokeIdle());
        root.addEventListener('mousedown', () => this.pokeIdle());
        // 鼠标移出即从这一刻重新计时（用户 2026-09-18：「移出 3 秒后自动隐藏」）——
        // 旧实现只在移动时重置，移出后剩的是「最后一次移动」起的残余计时，观感上「有时很快就不见了」。
        root.addEventListener('mouseleave', () => this.pokeIdle());
        // 右键打开标记（用户 2026-09-19 改判：悬停出卡片 → **右键**在笔记中打开）。
        // 🔴 必须挂在 **root** 上：卡片是 `pointer-events: none`，**卡片空白处的命中目标是底层 video**
        //    （无头 Chrome 实测 `elementFromPoint`），事件不经过进度条 ⇒ 挂进度条收不到「右键卡片」。
        root.addEventListener('contextmenu', this.onPlayerContextMenu);
        // 浮层外点关闭（捕获阶段，见 onDocPointerDown）：document 级监听挂一次即可，
        // 换片重建 root 时不重复挂 —— 故用 menuOutsideBound 守卫而不是无条件 addEventListener。
        if (!this.menuOutsideBound) {
            document.addEventListener('pointerdown', this.onDocPointerDown, true);
            this.menuOutsideBound = true;
        }
        this.render();
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
        // #326「插入时间戳 / 截取当前帧」入口 —— 用户 2026-09-19 指定放**顶栏右上角**：
        // 控制条右侧功能组已有 6 项（选集/倍速/字幕/音量/齿轮/全屏），再塞两个会挤窄中段进度条；
        // 顶栏原本只有片名、留白充足。仅在有条目上下文（entryId）时才建 —— 单文件预览没有笔记可写。
        // 图标名 `clock` / `camera` 已对着 obsidian-1.13.7.asar 核实（`_probe_lucide.cjs`）。
        if (this.opts?.entryId) {
            const tools = bar.createDiv({ cls: 'rl-vp-tools' });
            const stampBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '插入时间戳（T）' } });
            safeSetIcon(stampBtn, 'clock');
            stampBtn.addEventListener('click', () => void this.insertStamp());
            const shotBtn = tools.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '截取当前帧（S）' } });
            safeSetIcon(shotBtn, 'camera');
            shotBtn.addEventListener('click', () => void this.takeShot());
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
            // 时长要等元数据才有 → 标记圆点的位置也在这里才画得准（#333）
            this.renderMarks();
        });
        this.videoEl.addEventListener('ended', () => this.onEnded());
        stage.appendChild(this.videoEl);

        // 中央播放按钮（用户 2026-09-18 二次裁定：只在暂停时显示、满不透明、无悬停行为、无微动效）。
        // `pointer-events: none` → 点击一律落到主 video，与「点画面任意位置切播放/暂停」共用同一条通道，
        // 也避免「按钮 click + 冒泡到 video」两下互相抵消。显隐交给 CSS（`.rl-vp-paused`）。
        const ctr = stage.createDiv({ cls: 'rl-vp-centerplay', attr: { 'aria-hidden': 'true' } });
        safeSetIcon(ctr, 'play');
        this.centerPlayEl = ctr;

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
        // 标记层（#333）：**画在 played/thumb 之后**（否则已播区间是实心强调色底，圆点会被吞掉）；
        // `pointer-events: none` → 命中判定走进度条自己的 pointermove/down（不做逐点监听）。
        this.marksLayerEl = progress.createDiv({ cls: 'rl-vp-marks' });
        const tip = progress.createDiv({ cls: 'rl-vp-tip hidden' });
        this.tipEl = tip;

        progress.addEventListener('pointerdown', (ev) => this.onProgressDown(ev));
        progress.addEventListener('pointermove', (ev) => this.onProgressMove(ev));
        progress.addEventListener('pointerup', () => this.onProgressUp());
        progress.addEventListener('pointercancel', () => this.onProgressUp());
        progress.addEventListener('pointerleave', (ev) => {
            // 🔴 卡片是**向上**展开的（`.rl-vp-tip { bottom: 22px }`）⇒ 指针「离开进度条」多半是去点卡片里的
            //    「在笔记中打开」—— 这时**不能收卡片**，否则按钮还没够到就消失了（2026-09-19 用户实测报障）。
            if (this.dragging || this.overCard(ev)) return;
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
        const speedBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-speed', attr: { 'data-tip': '播放速度' }, text: SPEED_BTN_LABEL });
        this.speedBtn = speedBtn;
        // 倍速：点开面板选档（用户 2026-09-18 选定；旧的「点击循环 + Shift 反向」已撤）
        speedBtn.addEventListener('click', () => this.toggleMenu('speed', speedBtn));

        // 字幕（入口仍在控制条：它带「已挂载」亮起态，收进齿轮就看不见状态了）
        if (opts?.listSubtitles) {
            const subBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '字幕' } });
            safeSetIcon(subBtn, 'captions');
            subBtn.addEventListener('click', () => void this.openSubtitlePicker());
            this.subBtn = subBtn;
        }

        // 音量（用户 2026-09-18 第二次指示）：**常驻滑条撤掉 → 点击图标才浮出竖向滑条**
        // （滑条复用浮层容器，于是开合 / 定位 / 外点 / Esc / 闲置隐藏全部走同一套规则）。
        // 静音改由「拖到 0」或 M 键触发 —— 点击图标本身是开合滑条。
        const volBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '音量（M 键静音）' } });
        safeSetIcon(volBtn, 'volume-2');
        volBtn.addEventListener('click', () => this.toggleMenu('volume', volBtn));
        this.volumeBtn = volBtn;

        const gearBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '更多设置' } });
        safeSetIcon(gearBtn, 'settings');
        gearBtn.addEventListener('click', () => this.toggleMenu('settings', gearBtn));
        this.gearBtn = gearBtn;

        const fsBtn = right.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-iconbtn', attr: { 'data-tip': '全屏（F）' } });
        safeSetIcon(fsBtn, 'maximize');
        fsBtn.addEventListener('click', () => this.toggleFullscreen());
        this.fsBtn = fsBtn;

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
            this.hideNextPanel();
            this.goto(this.cur + 1);
        });
        const cancel = ops.createEl('button', { cls: 'rl-btn rl-vp-btn', text: '取消' });
        cancel.addEventListener('click', () => this.hideNextPanel());
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
        // 音量滑条是唯一的窄浮层：去掉列表菜单的最小宽度，免得竖条两侧空出一大片
        menu.toggleClass('rl-vp-menu-volume', kind === 'volume');
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
        // 设置：是否支持画中画要**这一刻**才知道（与创建控件时无关），故在这里判定后交给纯函数筛项；
        // 三个开关的当前状态也从视图内的**可变副本**取（用户刚切过就要反映出来，不回读 opts 快照）。
        const pipOk = typeof document.pictureInPictureEnabled === 'boolean' && document.pictureInPictureEnabled;
        for (const item of buildSettingOptions({
            pip: pipOk,
            bgPlay: this.bgPlay,
            episodeEnd: episodeEndChoice(this.autoNext, this.loopOne),
            single: this.opts?.single === true,
        })) {
            if (item.toggle) {
                this.menuBoxToggleItem(menu, item.label, !!item.on, () => this.toggleSetting(item.id as PlayerSwitchId));
                continue;
            }
            if (item.choices) {
                this.menuChoiceGroup(menu, item.label, item.choices, item.picked ?? 'stop', (c) => this.setEpisodeEnd(c));
                continue;
            }
            this.menuItem(menu, item.label, false, () => {
                if (item.id === 'pip') void this.togglePip();
                else this.openExternal();
            });
        }
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

    /** 开关框（#337：「点高亮、关则不亮」；点击**不收起浮层**，就地点亮/熄灭） */
    private menuBoxToggleItem(menu: HTMLElement, label: string, on: boolean, onPick: () => boolean): void {
        const btn = menu.createEl('button', { cls: 'rl-vp-menu-box', text: label });
        btn.toggleClass('is-on', on);
        btn.addEventListener('click', () => btn.toggleClass('is-on', onPick()));
    }

    /** 三选一框组（#337）：组名一行（不可点）+ 一行三个互斥框 —— 选中的亮，其余不亮 */
    private menuChoiceGroup(
        menu: HTMLElement,
        label: string,
        choices: { id: EpisodeEndChoice; label: string }[],
        picked: EpisodeEndChoice,
        onPick: (c: EpisodeEndChoice) => void,
    ): void {
        menu.createDiv({ cls: 'rl-vp-menu-group-label', text: label });
        const row = menu.createDiv({ cls: 'rl-vp-menu-box-row' });
        const boxes = choices.map((c) => {
            const b = row.createEl('button', { cls: 'rl-vp-menu-box', text: c.label });
            b.toggleClass('is-on', c.id === picked);
            b.addEventListener('click', () => {
                onPick(c.id);
                for (const x of boxes) x.removeClass('is-on');
                b.addClass('is-on');
            });
            return b;
        });
    }

    /** 「播完这一集」三选一：把选择写回原有两个字段（append-only 设置不变；点选不收浮层） */
    private setEpisodeEnd(choice: EpisodeEndChoice): void {
        const { autoNext, loopOne } = applyEpisodeEndChoice(choice);
        this.autoNext = autoNext;
        this.loopOne = loopOne;
        this.opts?.onToggleSetting?.('autoNext', autoNext);
        this.opts?.onToggleSetting?.('loopOne', loopOne);
    }

    /** 切换播放器开关：**就地生效** + 回调写回 settings（写回失败也无妨，本次会话已经生效）。返回新状态供 UI 刷新 */
    private toggleSetting(id: PlayerSwitchId): boolean {
        if (id === 'bgplay') {
            this.bgPlay = !this.bgPlay;
            // 打开时作废可能正在跑的「彻底释放」计时 —— 否则它到点会把源清掉，后台就断了
            if (this.bgPlay) this.cancelDeepRelease();
            this.opts?.onToggleSetting?.('bgPlay', this.bgPlay);
            return this.bgPlay;
        }
        // #337 起「自动切集 / 单集循环」不再走开关：由 `setEpisodeEnd`（三选一框）统一写回这两个字段。
        return this.bgPlay;
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
    }

    /**
     * 浮层外点关闭。挂在 document **捕获阶段**（比触发按钮自己的 click 早），
     * 因此必须显式放行「浮层内」与「触发按钮」两处 —— 否则「再点一次入口按钮关浮层」
     * 会先被这里关掉、随后按钮 click 又把它打开，表现为「点了没反应」。
     */
    private onDocPointerDown = (ev: PointerEvent): void => {
        if (!this.menuKind) return;
        const target = ev.target as Node | null;
        if (target && (this.menuEl?.contains(target) || this.menuTriggerBtn?.contains(target))) return;
        this.closeMenu();
    };

    /**
     * 右键打开标记（用户 2026-09-19 改判：「悬停后鼠标右键打开」）。
     * 🔴 挂在 **root** 上（不是进度条）—— 卡片是 `pointer-events: none`，**卡片空白处的命中目标是底层 video**
     *    （无头 Chrome 实测 `elementFromPoint` 返回 `VIDEO`），事件根本不经过进度条；只有挂 root 才能把
     *    「右键圆点 / 右键卡片 / 右键卡片里那张缩略图」收进同一条路。
     * ⛔ **命中不了标记一律放行**（连 `preventDefault` 都不做）—— 绝不吞掉用户在画面别处的正常右键菜单；
     *    横向靠 `hitMark` 的 8px 容差、纵向靠 `inBarBand` 把范围夹回进度条附近。
     */
    private onPlayerContextMenu = (ev: MouseEvent): void => {
        const mark = this.markAtPointer(ev);
        if (!mark) return;
        ev.preventDefault();
        ev.stopPropagation();
        // 打开后把卡片收掉：视野已经交给笔记，卡片留着还会让控制条一直不自动隐藏（见 `pokeIdle`）
        this.tipEl?.addClass('hidden');
        this.hoverMark = null;
        void this.opts?.onOpenMarkNote?.(mark);
    };

    /** 指针此刻指着哪条标记：先看「是否在卡片范围内」（卡片可能被夹到一边，x 未必落在圆点容差内） */
    private markAtPointer(ev: MouseEvent): VideoMark | null {
        const tip = this.tipEl;
        if (this.cardOpen() && tip && pointerOnCard(tip.getBoundingClientRect(), ev.clientX, ev.clientY)) {
            return this.hoverMark;
        }
        const rect = this.progressEl?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return null;
        if (!inBarBand(ev.clientY, rect.top, rect.bottom)) return null;
        return this.markHitAt((ev.clientX - rect.left) / rect.width, rect.width);
    }

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
            if (this.menuKind) {
                this.closeMenu();
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
        if (!opts || !item) return;
        this.failed = false;
        this.hideNextPanel();
        // 换集一律收掉浮层：连播自动切集时浮层还开着的话，选集列表的「当前集」会停在旧的一集上
        this.closeMenu();
        this.clearSubtitle();
        const label = episodeLabel(item, !!opts.single);
        this.titleTextEl.setText(label ? `${opts.entryTitle} · ${label}` : opts.entryTitle);
        if (this.prevBtn) this.prevBtn.disabled = item.isFirst;
        if (this.nextBtn) this.nextBtn.disabled = item.isLast;
        // 切源：清旧 src 再设新（同一 video 复用，避免重建元素丢失播放器状态）
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
        // 换片即作废「彻底释放」现场（否则回来会拿着旧位置去重建新片）
        this.cancelDeepRelease();
        this.videoEl.src = item.url;
        this.videoEl.playbackRate = vpSpeed;
        this.videoEl.volume = clampVolume(vpVolume ?? 1);
        this.videoEl.muted = vpMuted;
        this.lastSavedSeconds = -1;
        this.pendingResume = opts.initialPositions?.[this.epKey()] ?? 0;
        this.updateProgressUi();
        void this.videoEl.play().catch(() => {
            // 自动播放被拦（部分环境）：留在暂停态让用户点播放即可，不视为失败
        });
        void this.autoLoadSubtitle();
    }

    /** 播放位置记忆键：集下标（与 episodeFiles 一一对应；单文件播放恒为 '0'） */
    private epKey(): string {
        return String(this.opts?.items[this.cur]?.index ?? 0);
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
        // 单集循环**优先**（用户 2026-09-18 第四次指示：齿轮里可开）
        if (this.loopOne) {
            this.videoEl.currentTime = 0;
            void this.videoEl.play().catch(() => undefined);
            return;
        }
        const items = this.opts?.items ?? [];
        // 最后一集 / 单文件 / 「自动切集」被关掉 → 停住并显式收尾（不弹连播）
        if (this.opts?.single || this.cur >= items.length - 1 || !this.autoNext) {
            this.syncPlayState();
            return;
        }
        this.showNextPanel();
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
        // #333 D-3：**点中标记 → 吸附到那一刻**（否则按指针位置 seek，可能差几秒）
        const rect = this.progressEl?.getBoundingClientRect();
        const hit = rect && rect.width > 0 ? this.markHitAt((ev.clientX - rect.left) / rect.width, rect.width) : null;
        if (hit) {
            const dur = this.videoEl.duration;
            this.videoEl.currentTime = clampSeek(hit.seconds, dur);
            this.updateProgressUi();
            return;
        }
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
     * 悬停：普通位置显示「落点 / 总长」气泡；**悬在标记上则换成标记卡片**（#333 D-3）——
     * 卡片里有：种类 + 时间、用户手写的补充说明（`markCaption`）、截图缩略图、「在笔记中打开」。
     * ⚠️ 拖动过程中**不显示卡片**（只在 pointerdown 吸附一次）：卡片比时间气泡宽，拖拽时跳动很吵。
     */
    private updateTip(ev: PointerEvent | MouseEvent): void {
        const rect = this.progressEl?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || !this.tipEl) return;
        // 🔴 **指针停在卡片上时什么都不做**（2026-09-19 用户实测：「小圆点悬浮后点『在笔记中打开』点不动」）。
        //    卡片画在进度条**上方**，指针要从条上向上移进卡片才按得到按钮，而这段位移照样给进度条发
        //    `pointermove` → 若照常重算就会 `tip.empty()` **重建卡片**，按钮在 mousedown 与 mouseup 之间
        //    被换成新节点 ⇒ 浏览器**不合成 `click`**（判据见 `pure/videoMarks.pointerOnCard`）。
        if (this.overCard(ev)) return;
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const dur = this.videoEl?.duration ?? 0;
        const hit = this.dragging ? null : this.markHitAt(ratio, rect.width);
        this.hoverMark = hit;
        if (hit) {
            this.renderMarkCard(hit, ratio, rect.width);
        } else {
            this.tipEl.removeClass('rl-vp-tip-mark');
            this.tipEl.setText(hoverTipText(ratioToSeconds(ratio, dur), dur));
            this.tipEl.style.left = `${ratio * 100}%`;
        }
        this.tipEl.removeClass('hidden');
    }

    /** 指针是否停在**已展开的标记卡片**上（含 4px 容差）—— 是则「既不重算、也不收起」 */
    private overCard(ev: PointerEvent | MouseEvent): boolean {
        const tip = this.tipEl;
        if (!tip || !this.cardOpen()) return false;
        return pointerOnCard(tip.getBoundingClientRect(), ev.clientX, ev.clientY);
    }

    /** 标记卡片是否**正开着**（`.rl-vp-tip` 可见且已切成卡片形态）—— 空闲自动隐藏要看它 */
    private cardOpen(): boolean {
        const tip = this.tipEl;
        return !!tip && !tip.hasClass('hidden') && tip.hasClass('rl-vp-tip-mark');
    }

    /** 命中判定：容差按 **8px 换算成比例**（别用固定比例 —— 窗口越窄越容易把「想拖进度」吸到点上） */
    private markHitAt(ratio: number, width: number): VideoMark | null {
        const i = hitMark(this.markPcts, ratio, width > 0 ? 8 / width : 0);
        return i >= 0 ? this.markList[i] ?? null : null;
    }

    /** 画标记卡片（内容是**替换** tip 的子节点，不复用时间气泡那套 `setText`） */
    private renderMarkCard(mark: VideoMark, ratio: number, width: number): void {
        const tip = this.tipEl;
        if (!tip) return;
        tip.empty();
        tip.addClass('rl-vp-tip-mark');
        tip.createDiv({
            cls: 'rl-vp-mark-head',
            text: `${mark.kind === 'shot' ? '截图' : '时间戳'} · ${formatTime(mark.seconds)}`,
        });
        const caption = markCaption(mark.text);
        if (caption) tip.createDiv({ cls: 'rl-vp-mark-text', text: caption });
        const src = mark.image ? this.opts?.markImageUrl?.(mark.image) ?? null : null;
        if (src) tip.createEl('img', { cls: 'rl-vp-mark-img', attr: { src, alt: '' } });
        // 打开方式 = **右键**（用户 2026-09-19 改判「悬停后鼠标右键打开」）。
        // 🔴 卡片里**不再放按钮**：卡片本体是 `pointer-events: none`（时间气泡要跟着鼠标走、不能吃指针），
        //    要在里面放可点元素就得再补一条 `pointer-events: auto` —— 那条路连着踩了三轮「点不动」。
        //    右键走 root 上的 `contextmenu`（见 `onPlayerContextMenu`），链路短、不依赖卡片内命中层。
        tip.createDiv({ cls: 'rl-vp-mark-hint', text: '右键 → 在笔记中打开' });
        tip.removeClass('hidden');
        // 先撤 hidden 再量宽（`display:none` 时 offsetWidth 恒 0），再把卡片夹在进度条内
        const half = (tip.offsetWidth || 0) / 2;
        const left = Math.max(half + 4, Math.min(Math.max(width - half - 4, half + 4), ratio * width));
        tip.style.left = `${left}px`;
    }

    /** 重画标记圆点：按**当前集**过滤（多集时间轴不同，混画就是画错位置）+ 总时长换算百分比 */
    private renderMarks(): void {
        const layer = this.marksLayerEl;
        if (!layer) return;
        layer.empty();
        const item = this.opts?.items[this.cur];
        const dur = this.videoEl?.duration ?? 0;
        const mine = item ? marksForEpisode(this.opts?.marks ?? [], { ep: item.index, fileName: item.path }) : [];
        layer.toggleClass('rl-vp-marks-dense', mine.length > MARK_DENSE_THRESHOLD);
        for (const m of mine) {
            layer.createDiv({ cls: 'rl-vp-mark' }).style.left = `${markPct(m.seconds, dur) * 100}%`;
        }
        this.markList = mine;
        this.markPcts = mine.map((m) => markPct(m.seconds, dur));
        this.hoverMark = null;
    }

    /** 宿主在插入时间戳 / 截图后把新标记推进来（#333：不必重开播放器就能看到新点） */
    setMarks(marks: VideoMark[]): void {
        if (this.opts) this.opts.marks = marks;
        this.renderMarks();
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

    private toggleFullscreen(): void {
        try {
            if (document.fullscreenElement) {
                void document.exitFullscreen?.().catch(() => undefined);
            } else {
                void this.containerEl.requestFullscreen?.().catch(() => undefined);
            }
        } catch {
            // 全屏不可用：静默
        }
    }

    private onFsChange = (): void => {
        if (this.fsBtn) safeSetIcon(this.fsBtn, document.fullscreenElement ? 'minimize' : 'maximize');
        // 全屏切换会改变控制条尺寸 → 浮层的绝对定位（left / bottom）当场失效，直接收掉重开
        this.closeMenu();
    };

    private async togglePip(): Promise<void> {
        const v = this.videoEl as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> };
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture?.();
            else await v.requestPictureInPicture?.();
        } catch {
            new Notice('当前环境不支持画中画');
        }
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
        const pos = this.opts.items.findIndex((it) => it.index === index);
        if (pos < 0) return;
        if (pos !== this.cur) {
            this.pendingSeek = { index, seconds };
            this.cur = pos;
            this.render();
            return;
        }
        this.applySeek(seconds);
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
        const pos = this.opts?.items.findIndex((it) => it.index === seek.index) ?? -1;
        if (pos < 0) {
            this.pendingSeek = null;
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

    /** 跳到指定秒并播放（时间戳链接的目标位置；越界由 clampSeek 夹住） */
    private applySeek(seconds: number): void {
        const dur = this.videoEl.duration;
        this.videoEl.currentTime = clampSeek(seconds, dur);
        this.updateProgressUi();
        // 自动播放可能被浏览器拦截（无用户手势）→ 吞掉异常：位置已就位，用户按播放即可
        void this.videoEl.play().catch(() => undefined);
        this.showToast(`已跳到 ${formatTime(seconds)}`);
    }

    /** 插入时间戳（#326）：把「当前时刻 + 当前集」交给宿主（宿主构造链接 + 决定落到哪个笔记）。
     *  公开：顶栏按钮、快捷键、命令面板三条入口共用（#326 用户要求「一键」）。 */
    async insertStamp(): Promise<void> {
        const cb = this.opts?.onInsertStamp;
        if (!cb) return;
        const item = this.opts?.items[this.cur];
        await cb({ seconds: this.videoEl?.currentTime ?? 0, ep: item?.index ?? 0 });
    }

    /** 截取当前帧（#326）：抓帧 → 交宿主落盘 + 写笔记（视图不碰 vault）。公开：三条入口共用 */
    async takeShot(): Promise<void> {
        const cb = this.opts?.onCaptureShot;
        if (!cb) return;
        const item = this.opts?.items[this.cur];
        const buf = await this.captureFrame();
        if (!buf) return;
        await cb({ png: buf, seconds: this.videoEl.currentTime, ep: item?.index ?? 0 });
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

    private showNextPanel(): void {
        const next = this.opts?.items[this.cur + 1];
        if (!next || !this.nextPanelEl) return;
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
            this.hideNextPanel();
            this.goto(this.cur + 1);
        }
    }

    private hideNextPanel(): void {
        if (this.nextTimer !== null) {
            window.clearInterval(this.nextTimer);
            this.nextTimer = null;
        }
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
        if (this.subCandidates.length > 0) await this.applySubtitle(this.subCandidates[0].fileName, true);
    }

    /** 字幕入口：弹窗列候选（像选剧集）→ 选候选 / 从文件选择 / 关闭字幕 */
    private async openSubtitlePicker(): Promise<void> {
        const opts = this.opts;
        if (!opts?.listSubtitles) return;
        const res = await new SubtitlePickerModal(this.app, opts.entryTitle, this.subCandidates, this.subFile).open();
        if (!res) return;
        if (res.kind === 'off') {
            this.clearSubtitle();
            this.showToast('已关闭字幕');
            return;
        }
        if (res.kind === 'pick') {
            await this.applySubtitle(res.fileName);
            return;
        }
        const picked = await opts.pickSubtitleFile?.();
        if (!picked) return;
        const vtt = await this.loadVtt(picked);
        if (!vtt) {
            this.showToast('字幕读取失败');
            return;
        }
        const name = fileNameOfPath(picked);
        this.mountTrack(vtt, subtitleLangLabel(subtitleLangTag(name)) || name);
        this.subFile = name;
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
        if (!silent) this.showToast(`已挂载字幕：${fileName}`);
    }

    private async loadVtt(path: string): Promise<string | null> {
        try {
            return (await this.opts?.loadSubtitleVtt?.(path)) ?? null;
        } catch {
            return null;
        }
    }

    /** 挂载字幕轨道（Blob URL + 显式 showing，避免部分环境 default 不生效） */
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
        const tracks = this.videoEl.textTracks;
        for (let i = 0; i < tracks.length; i++) tracks[i].mode = i === tracks.length - 1 ? 'showing' : 'disabled';
        this.subBtn?.addClass('is-on');
    }

    private clearSubtitle(): void {
        if (!this.videoEl) return;
        Array.from(this.videoEl.querySelectorAll('track')).forEach((t) => t.remove());
        if (this.subUrl) {
            URL.revokeObjectURL(this.subUrl);
            this.subUrl = null;
        }
        this.subFile = null;
        this.subBtn?.removeClass('is-on');
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
        // 清源重生会把字幕轨道打回 disabled → 重新点亮（轨道元素与 Blob URL 都还在，不必重扫目录）
        const tracks = v.textTracks;
        for (let i = 0; i < tracks.length; i++) tracks[i].mode = i === tracks.length - 1 ? 'showing' : 'disabled';
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
     *  🔴 **标记卡片开着时同样不隐藏**（`!this.cardOpen()`，2026-09-19 用户实测「悬浮后点不了
     *     『在笔记中打开』」）—— 卡片是控制条的**子元素**，`IDLE_HIDE_MS` 只有 1000ms ⇒ 指针停在
     *     圆点上读卡片、还没移到按钮就整条淡掉了（`.rl-vp-idle .rl-vp-controls { opacity: 0 }`）。 */
    private pokeIdle(): void {
        this.rootEl?.removeClass('rl-vp-idle');
        if (this.idleTimer !== null) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idleTimer = window.setTimeout(() => {
            this.idleTimer = null;
            if (!this.videoEl?.paused && !this.dragging && !this.menuKind && !this.cardOpen()) {
                this.rootEl?.addClass('rl-vp-idle');
            }
        }, IDLE_HIDE_MS);
    }

    private showToast(text: string): void {
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

/** setIcon 安全包装：图标名不存在时抛错静默（不影响面板其余功能） */
function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 图标不可用：忽略
    }
}
