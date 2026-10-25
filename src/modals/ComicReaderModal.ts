// 漫画阅读器面板（宿主由 views/ReaderViews.ts 的 ComicReaderView 提供：工作区新标签页打开）。
//
// 1.2.1 #537：内置阅读器新增漫画阅读支持。用户 2026-10-05 点定**零依赖档**（A1）：
//   图片文件夹 / CBZ · ZIP / CBT · TAR（rar · 7z · Kindle 本批不做）。三类来源在宿主侧统一折成
//   「总页数 + 按需取第 i 页」两个面（`ComicReaderOptions.pageCount` / `loadPage`），面板**不关心**
//   来源是文件夹还是压缩包 —— 解包与读盘都在宿主，面板只管画。
//
// 交互（对齐 manga 阅读器惯例，**单页制**）：
//   · 一次只渲染一页：整页 contain 居中；`←/→`（或 `↑/↓`、`PgUp/PgDn`）翻页；滚轮也翻页（带冷却，防触控板连翻）；
//   · 缩放：`= / + / -` 或设置菜单滑条（0.5×~4×；>1× 时图片溢出舞台，用舞台滚动平移）；
//   · 底栏沿用 TXT/EPUB/PDF 同一套：`[‹] 第 N / M 页 ━━━ 已读 X%  [全屏][沉浸] [›]`；
//   · 顶栏：标题 + 打开笔记（⛔ 无关闭按钮 —— 阅读器只经关闭标签页退出，全仓一条口径）。
//
// 🔴 #540（用户 2026-10-05 报障两连）：
//   ⑴「默认是拉伸的」—— 旧写法 `width:100%` + `max-height:100%`，浏览器只压高度、宽仍是 100% ⇒ 竖版页横向拉伸。
//      现在整页尺寸走 `fitWidth()`（可用宽/高双约束的 contain 基准）**× 缩放 = 显式像素宽 + height:auto**，
//      纵横比恒定；`onResize` 也据此重算（拖侧栏后不再失真）。
//   ⑵「翻页会闪屏」—— 旧写法先把新 `<img>` 塞进 DOM、再等 `load` ⇒ 未解码时是 0×0、舞台只剩背景色 = 白闪。
//      现在**先 `decode()` 再换位**，旧页在换位前一直可见；并预取下一页（单槽）让翻页零等待。
//
// 进度：`chapterIndex` = 页码索引（0 基）；`scrollRatio` **单页制恒 0**，连续滚动下是
//   「读到全书哪个比例」（= `scrollTop / (scrollHeight - clientHeight)`，与滑块位置同一口径，见 #669）；
//   `percent` 走 `pure/readingProgress.estimatePercent`（每页权重 1 ⇒ (页序+1)/总页数），
//   与 PDF/EPUB 落库同一口径（`readingProgress.percent` 是唯一进度真源）。
//   ⚠️ 图片**没有**摘抄/高亮/书签（选中无反馈、也没有「块」概念）⇒ 本批不做书签（登记为后续可选）。
//
// ══ 🔴 #669（用户 2026-10-19）：「把右侧缩略图同步滚动和连续滚动效果加回来」 ══════════════════════
// 上一批（#636 ⑤）那两件**在代码里是有的，但用不了**。逐条真因与修法（每条都有复现/实测量过）：
//   ⑴ 连续滚动下滚轮被 `onWheel` 拦去**翻页**（与「连续滚动」自相矛盾）⇒ 按模式分流：
//      连续滚动里滚轮就是滚动（`wheelDeltaOf` 换算行/页制），`Ctrl/⌘ + 滚轮` = 缩放；单页制维持翻页。
//   ⑵ 切模式时 `buildScrollPages()` 被调用**两次**，第二次 `col.empty()` 把第一批正在插图的 DOM 摘掉
//      ⇒ 图回来了却挂到已摘掉的节点上 = **整屏空白**。现在按模式各建一次。
//   ⑶ 页块靠 `min-height:240px` 占位、图回来后再撑开 ⇒ 边看边跳。现在用已知纵横比**先写死宽高**
//      （`pageBox`），图片到位后尺寸几乎不变；每页占位块常驻，卸载只撤 `<img>`（`data-h` 撑高）。
//   ⑷ 缩略图栏只在**换页后** `scrollIntoView({block:'nearest'})` ⇒ 正文滚动时它不动。现在滚动同步进
//      **rAF**（一帧一次），同时做三件事：高亮当前格 / 让当前格落到栏中位（`thumbScrollTarget`）/
//      进度滑块跟随；90ms 防抖只留给**补图**（别把解压塞进每一帧）。
//   ⑸ 缩略图栏没有「读到全书哪儿」的指示 ⇒ 加一条**进度滑块**（仿参考仓 `cbz-reader` 的 minimap thumb）：
//      可拖动、可点轨道跳页、可在栏上滚轮驱动正文（×4），拖动期间不走自动跟随（⛔ 免得打架）。
//   ⑹ 连续滚动位置**从不回写** `scrollRatio` ⇒ 关了再开回到页顶。现在 rAF 里顺带记下比例并落库。
import { Notice, Scope, setIcon } from 'obsidian';
import { READER_THEMES, normalizeReaderTheme, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
// 🔴 #603：底栏图标组里「描述行为」的悬停轻提示真源（与另外三件共用）
import { READER_FOPS } from 'pure/readerFops';
import { attachHeadTitle } from 'pure/readerHead';
import { estimatePercent } from 'pure/readingProgress';
import { comicPageText } from 'pure/comicFiles';
// 🔴 #636 ⑤：缩略图惰性窗口 / 卸载窗口 / 原文件名 / 模式归一
import {
    normalizeComicViewMode,
    thumbWindow,
    pruneThumbs,
    baseNameOf,
    thumbsVisible,
    comicViewModeOptions,
    type ComicViewMode,
} from 'pure/comicViewer';
// 🔴 #669：连续滚动与缩略图同步的**判据真源**（纯函数，`tests/comicScroll.test.ts` 41 例锁着）
import {
    pageAtViewport,
    thumbScrollTarget,
    ratioToScrollTop,
    scrollTopToRatio,
    cellStride,
    cellRect,
    pageBox,
    sortByDistance,
    wheelDeltaOf,
    zoomAfterWheel,
    restoreScrollTop,
    PAGE_RATIO_FALLBACK,
    type PageRect,
} from 'pure/comicScroll';
import type { ParsedExcerpt } from 'pure/excerpt';
import { newBookmark, type ReaderBookmark } from 'pure/bookmark';
import type { ShotLoc, ShotRect } from 'pure/readerShot';
import { ShotOverlay } from 'modals/ShotOverlay';
// 2026-10-23 用户指令「漫画加侧边栏【目录、书签】」：书签区复用三个文本阅读器同一套
// 「计数 + 选择模式 + 批量删除」头（⛔ 别再手写一遍，那是第四份真源）。
import { annoCountText, buildAnnoHead, type AnnoHeadHandles } from 'pure/annoSelection';
import { attachScrollFades, resyncScrollFade, attachTocResizer } from 'pure/readerToc';
// 2026-10-23 用户指令「底栏自动滚动功能统一」：漫画补自动推进，直接复用另三件的速度参数与推进算法
// （⛔ 别在漫画里另写一套 px/s 推进逻辑 —— `advanceAutoPos` 解决的是「scrollTop 写入被取整」那个老坑）。
import {
    AUTO_SCROLL_DEFAULT,
    AUTO_SCROLL_MAX,
    AUTO_SCROLL_MIN,
    AUTO_SCROLL_STEP,
    AUTO_TURN_DEFAULT_MS,
    AUTO_TURN_MAX_MS,
    AUTO_TURN_MIN_MS,
    AUTO_TURN_STEP_MS,
    advanceAutoPos,
    autoSpeedLabel,
    autoTurnLabel,
    clampAutoScrollPx,
    clampAutoTurnMs,
    loadAutoScrollPx,
    saveAutoScrollPx,
} from 'pure/readerAuto';

/** 缩放范围与步进（与 PDF 面板同值，用户切阅读器时手感一致） */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
/** 进度保存节流（ms） */
const SAVE_THROTTLE = 300;
/** 滚轮翻页冷却（ms）——触控板一次滑动会连发几十个 wheel，不加冷却会一次翻十几页（**仅单页制**） */
const WHEEL_COOLDOWN = 220;
/** 滚轮累计阈值（px）——低于它视为惯性抖动，不翻页（**仅单页制**） */
const WHEEL_THRESHOLD = 40;
/** 🔴 #636 缩略图**生成**窗口半径（当前页前后各几页做小图）——两者都是「惰性」的核心 */
const THUMB_RADIUS = 6;
/**
 * 🔴 #683：面板级**按页 Blob 缓存**的条数上限（正文与缩略图共用同一份）。
 * 200 页 × 数 MB 全留会吃光内存 ⇒ 只留最近用的 `PAGE_CACHE_MAX` 页；
 * 宿主侧另有 64MB 字节级 LRU 兜底（`main.openComicArchive` / `unpackEpub.loadBinary`）。
 */
const PAGE_CACHE_MAX = 60;
/** 🔴 #636 连续模式里「视野附近保留几页的图」（超出即卸载，防大漫画吃光内存） */
const SCROLL_KEEP = 3;
/** 🔴 #680：栏上滚轮的倍数常量已**退役** —— 现在栏上滚轮只滚栏自己（1:1），
 *  不再「×4 驱动正文」（那正是两模式手感分裂的来源，见 `bindThumbSlider` 的注释）。
 *  ⛔ 别再把它加回来：常驻一个没有使用者的常量 = 死的配置面。 */
/** 🔴 #669 连续模式补图的防抖（ms）——⛔ 别放进 rAF：解压是重活，每帧都触发会原地卡死（#642 的老坑） */
const FILL_DEBOUNCE = 60;
/** 🔴 #669 IO 预取余量（按**视口高**的倍数）：上下各留 1.5 屏，滚动时图基本已在位 */
const IO_MARGIN_RATIO = 1.5;

export interface ComicReaderOptions {
    /** 书籍标题（标签页标题） */
    title: string;
    /** 总页数（>0；宿主已按自然序排好） */
    pageCount: number;
    /** 按需取第 `index` 页（0 基）图片；越界 / 读失败 → `null`（面板显示占位，不抛） */
    loadPage: (index: number) => Promise<Blob | null>;
    /** 当前进度（恢复用；chapterIndex = 页码索引 0 基） */
    progress?: { chapterIndex: number; scrollRatio: number };
    /** 保存进度回调（翻页节流调用） */
    onSaveProgress: (p: { chapterIndex: number; scrollRatio: number }) => void;
    /** 进度百分比落库回调（关闭时调用，percent 0-100） */
    onProgressPersist?: (percent: number) => void;
    /** 打开条目笔记（顶栏按钮；宿主注入 → main.openEntryNote） */
    onOpenNote?: () => void;
    /** 阅读主题 */
    theme?: ReaderThemeId;
    /** 阅读主题变更回调（写回设置持久化） */
    onThemeChange?: (t: ReaderThemeId) => void;
    // ── 🔴 #636 ⑤ 本批新增（参考 `usero2/obsidian-plugins-cbz-reader`）──────────────────
    /** 阅读模式（单页制 / 连续滚动）；缺省 = 单页（#537 起的既有行为，⛔ 别默认连续） */
    viewMode?: ComicViewMode;
    /** 阅读模式变更回调（写回设置持久化） */
    onViewModeChange?: (m: ComicViewMode) => void;
    /** 右侧缩略图导航栏是否显示（缺省隐藏 —— 用户裁定「默认关，顶栏一枚开关」） */
    thumbsOn?: boolean;
    /** 缩略图栏显隐变更回调（写回设置持久化） */
    onThumbsChange?: (on: boolean) => void;
    /**
     * 🔴 取第 `index` 页的**原文件名**（压缩包内的路径；右键菜单显示用）。
     * 缺省不给 ⇒ 菜单不显示那一行（⛔ 别拿「第 N 页」顶上 —— 那是另一回事）。
     */
    pageName?: (index: number) => string;
    // ── 2026-10-23 用户指令：漫画阅读器补「书签 / 区域截图 / 顶部快捷按钮」─────────────
    /** 书签列表（页码 1 基 + 页内比例；与 PDF 同一份 `ReaderBookmark` schema） */
    bookmarks?: ReaderBookmark[];
    /** 书签变更回调（宿主落库到阅读存档 JSON） */
    onBookmarksChange?: (list: ReaderBookmark[]) => void;
    /** 二次确认（删除书签 / 批量删除用）—— 由 `ReaderViewBase.prepare()` 统一注入 */
    onConfirmClear?: (msg: string) => Promise<boolean>;
    /** 区域截图（拖框 → 宿主 capturePage 取像素 → 写笔记「## 阅读截图」）。
     *  面板只交矩形 + 定位，⛔ 不碰 vault / electron。 */
    onShotSave?: (rect: ShotRect, loc?: ShotLoc) => void;
}

/** `setIcon` 遇未知名**静默失败**（空白按钮）⇒ 统一走这层，异常只吞不炸 */
function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 图标不可用：忽略
    }
}

function clampInt(v: number, min: number, max: number): number {
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, Math.round(v)));
}

/** 浮点钳制（缩略图滑块的比例换算用；脏值按 `lo` 处理） */
function clamp(v: number, lo: number, hi: number): number {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}

export class ComicReaderPanel {
    /** 当前页索引（0 基） */
    private pageIndex = 0;
    /** 缩放（1 = 适宽/适高 contain） */
    private zoom = 1;
    /** 阅读主题（会话档位；容器类换肤，follow 不挂类） */
    private theme: ReaderThemeId = 'follow';
    /** 每页权重（全 1）——`estimatePercent` 的入参，构造时建一次 */
    private readonly sizes: number[];

    private stageEl!: HTMLElement;
    private imgEl: HTMLImageElement | null = null;
    private placeholderEl: HTMLElement | null = null;
    private headEl!: HTMLDivElement;
    private footEl!: HTMLDivElement;
    private footerPageEl!: HTMLSpanElement;
    private footerFillEl!: HTMLDivElement;
    private footerPctEl!: HTMLSpanElement;
    private settingsBtn!: HTMLButtonElement;
    /** 🔴 #636 顶栏那枚缩略图栏开关 */
    private thumbsBtn: HTMLButtonElement | null = null;
    private menuEl: HTMLElement | null = null;
    private settingsOpen = false;
    private menuZoomVal: HTMLSpanElement | null = null;
    private menuZoomSlider: HTMLInputElement | null = null;
    private themeSwatches: Partial<Record<ReaderThemeId, HTMLButtonElement>> = {};
    /** 🔴 #636 阅读模式分段（单页 / 连续滚动）的按钮 */
    private modeSegs = new Map<ComicViewMode, HTMLButtonElement>();
    // ── 2026-10-23 用户指令：漫画补侧栏【目录、书签】──────────────────────────────
    /** 左侧栏容器（复用 `.rl-reader-toc` 整套样式；折叠靠 `.collapsed` 类） */
    private tocEl: HTMLDivElement | null = null;
    /** 目录列表容器（每页一行） */
    private tocListEl: HTMLDivElement | null = null;
    /** 目录行元素（下标 = 页码 0 基；用于高亮当前页） */
    private tocRowEls: HTMLElement[] = [];
    /** 目录是否已懒建过（漫画 200+ 页，首次进目录页签才建 DOM） */
    private tocBuilt = false;
    /**
     * 侧栏折叠态 —— 缺省**收起**。
     *
     * 🔴 2026-10-25 用户：「每次新打开所有类型阅读器的侧边栏都要默认收起来」。
     *    漫画原来是 `false`（唯一默认展开的），另三个（EPUB `:281` / TXT `:259` / PDF `:268`）
     *    都是 `true` ⇒ 这里对齐成 `true`，四个阅读器新开都收起。
     * ⚠️ 只影响**新打开**的默认态：用户手动展开不会被记住（四个阅读器一致，都没有持久化侧栏态）。
     */
    private tocCollapsed = true;
    /** 顶栏侧栏开关按钮 */
    private sidebarBtnEl: HTMLButtonElement | null = null;
    /** 书签区的「计数 + 选择模式」句柄（`buildAnnoHead` 产出） */
    private bmHeadRef: AnnoHeadHandles | null = null;
    /** 书签列表容器（= `bmHeadRef.listEl`，单独存一份便于重绘） */
    private bmListEl: HTMLDivElement | null = null;
    private fsBtnEl: HTMLButtonElement | null = null;
    private immersiveBtnEl: HTMLButtonElement | null = null;
    // ── 2026-10-23 用户指令：底栏「自动滚动功能」四件统一 ─────────────────────────
    /** 自动推进开关（会话级，不落设置 —— 与另三个阅读器一致） */
    private autoOn = false;
    /** 自动推进按钮（底栏图标组里那枚 ⏱） */
    private autoBtnEl: HTMLButtonElement | null = null;
    /** 连续模式的自动滚动速度（px/s；记忆值 / 缺省 150，与 TXT/EPUB/PDF 共用同一份记忆键） */
    private autoScrollPx = loadAutoScrollPx() ?? AUTO_SCROLL_DEFAULT;
    /** 自动滚动的浮点位置（#342：⛔ 不能读回 `scrollTop` 累加，写入被浏览器取整） */
    private autoPos: number | null = null;
    /** 自动滚动 rAF / 上一帧时间戳 */
    private autoRaf: number | null = null;
    private autoLastTs = 0;
    /** 单页模式的自动翻页间隔（ms）与定时器（单页制没有滚动，只能定时翻页） */
    private autoTurnMs = AUTO_TURN_DEFAULT_MS;
    private autoTimer: number | null = null;
    private immersive = false;
    private disposeHeadTitle: (() => void) | null = null;
    /** 侧栏溢出渐隐的解绑器（见 `pure/readerToc.attachScrollFades`） */
    private disposeFade: (() => void) | null = null;
    /** 保存节流定时器 */
    private saveTimer: number | null = null;
    /** 当前页的 blob URL（换页 / 销毁时 revoke，防内存泄漏） */
    private currentUrl: string | null = null;

    // ── 🔴 #636 ⑤ 本批新增状态 ──────────────────────────────────────────────────
    /** 阅读模式（单页 / 连续滚动） */
    private viewMode: ComicViewMode = 'single';
    /** 右侧缩略图栏容器（关闭时**不建 DOM** —— 窄窗下它不该占位） */
    private thumbsEl: HTMLElement | null = null;
    /** 缩略图栏是否显示 */
    private thumbsOn = false;
    /** 连续模式的滚动容器（与 `stageEl` 二者只用一个） */
    private scrollEl: HTMLElement | null = null;
    /** 已生成缩略图的页下标集合（惰性：只在窗口内生成，滚远了由 `pruneThumbs` 丢） */
    private thumbDone = new Set<number>();
    /** 缩略图格子（下标 → 元素；用于高亮当前页与滚动定位） */
    private thumbCells = new Map<number, HTMLElement>();
    /** 🔴 #669 缩略图栏里**可滚动**的那条轨道（滑块 `top` 以它为原点） */
    private trackEl: HTMLElement | null = null;
    /** 🔴 #669 缩略图栏的进度滑块（滑块本身是拖动句柄，也画「读到全书哪儿」） */
    private thumbSliderEl: HTMLElement | null = null;
    /** 右键菜单元素 */
    private ctxEl: HTMLElement | null = null;
    /** 自动推进的调速浮层（右键底栏 ⏱ 弹出；2026-10-23 四件统一） */
    private popEl: HTMLElement | null = null;
    /** #540 下一页预取（单槽）：压缩包逐页解压有延迟，预取后翻页**零等待**（⛔ 只留一页，别攒缓存） */
    private nextBlob: { index: number; blob: Blob } | null = null;
    /**
     * 🔴🔴 #683：**按页的 Blob 缓存**（正文与缩略图共用）。
     * 用户：「缩略图和正文要全部加载缓存下来再阅读啊」—— 原来每处各调一次 `loadPage`，
     * 同一页在「正文」「缩略图」「预取」三条路上各取一次（宿主的解压缓存只能省掉重复解压，
     * 省不掉重复读盘/建 Blob）。这里做**面板级**去重 + 有界缓存。
     * ⚠️ LRU 上限按**条数**：宿主侧已有 64MB 字节级上限兜底（`main.openComicArchive` / `unpackEpub`）。
     */
    private readonly pageBlobs = new Map<number, Blob>();
    /** 在途取图（同一页并发只发一次） */
    private readonly pageBlobLoading = new Map<number, Promise<Blob | null>>();
    /**
     * ⛔ #642 复盘（已整体回退，这里曾有两枚重入守卫 `thumbsBusy`/`scrollBusy` + 让帧 + 滚动期延迟补图）：
     *   那套改动**把阅读器改坏了**（用户报「完全改的看不了」）—— 守卫让滚动中发起的补图/插图
     *   全部只置脏就返回，而唯一在跑的那轮复查时 `pageIndex` 已变、窗口已换
     *   ⇒ **正文图与缩略图都大面积为空**。
     *   🔴 卡顿的真凶是**重复解压**（同一页被反复 zip 解压，实测单张 8ms、串行 20 张 310ms），
     *      已在 `main.unpackEpub` 的 `loadBinary` 里用「缓存 + 并发去重 + 64MB LRU」根治；
     *      🟠 #669 把这套也补到了 **CBZ/ZIP 解包**（`main.openComicArchive` 的 `reader`）。
     *   ⛔ 别再往 `fillThumbs` 里加守卫或让帧：它的「每次滚动重跑」本身就是正确语义
     *      （靠 `thumbDone` 去重），加闸门反而饿死它。
     */
    /** 加载序号：翻页快于取图时，旧结果作废（防「乱序回填」把新页盖回旧页） */
    private loadSeq = 0;
    private destroyed = false;
    /** 滚轮累计 / 上次翻页时刻（**仅单页制**用） */
    private wheelAcc = 0;
    private wheelAt = 0;

    // ── 🔴 #669 连续滚动 / 缩略图同步 的状态 ────────────────────────────────────
    /** 每页占位块（下标 → 元素）。**常驻**：卸载只撤 `<img>`，块本身留着撑高度 */
    private pageBoxes: HTMLElement[] = [];
    /** 已知纵横比（下标 → h/w）。取到图后记下 ⇒ 下次进入连续模式时**直接按真实高度占位**（零跳动） */
    private readonly pageRatios = new Map<number, number>();
    /** 续模式里各页顶部偏移缓存（`pageBoxes` 的 offsetTop；尺寸变化时作废重算） */
    private pageRects: PageRect[] = [];
    private pageRectsDirty = true;
    /** 正文页的 IntersectionObserver（进入视野才解压；离开就撤图） */
    private pageIO: IntersectionObserver | null = null;
    /** 缩略图格子的 IntersectionObserver（栏滚到哪就补到哪 —— 比「当前页 ±6」更贴参考仓的懒加载） */
    private thumbIO: IntersectionObserver | null = null;
    /** 🔴 #669 滚动同步的 rAF 句柄（一帧只跑一次：高亮 + 栏跟随 + 滑块 + 记比例） */
    private syncRaf: number | null = null;
    /** 🔴 #669 补图防抖（⛔ 与同步分开：解压是重活，塞进每帧 = #642 的死法） */
    private fillTimer: number | null = null;
    /** 🔴 #669 缩略图滑块拖动状态（拖动期间不自动跟随，⛔ 免得两边互相拽） */
    private dragging = false;
    /** 🔴 #669 进入连续模式后**一次**还原滚动位置（之后不再自动跳，免得把用户拽走） */
    private scrollRestored = false;
    /** 🔴 #669 最近一次记录的全书比例（`scrollRatio` 落库用） */
    private scrollRatio = 0;
    /** 🔴 #669 视口高度缓存（IO 余量与 `pageAtViewport` 都要用；resize 时刷新） */
    private viewH = 0;

    // ── 2026-10-23 用户指令：漫画补「书签 / 区域截图」 ─────────────────────────────
    /** 书签列表（页码 1 基 + 页内比例；与 PDF 共用 `ReaderBookmark` schema） */
    private bookmarks: ReaderBookmark[] = [];
    /** 顶栏书签快速按钮 */
    private bmBtnEl: HTMLButtonElement | null = null;
    /** 区域截图遮罩（一次一个；Esc / 框选完成即自毁） */
    private shotOverlay: ShotOverlay | null = null;

    constructor(
        private container: HTMLElement,
        private scope: Scope,
        private options: ComicReaderOptions,
        _closeView: () => void,
    ) {
        this.theme = normalizeReaderTheme(options.theme);
        // 🔴 #636：两档新偏好各自归一（缺省 = 单页 + 隐藏缩略图栏 ⇒ **与 #537 行为逐字一致**）
        this.viewMode = normalizeComicViewMode(options.viewMode);
        this.thumbsOn = thumbsVisible(options.thumbsOn);
        const total = Math.max(1, Math.floor(options.pageCount) || 1);
        this.sizes = new Array(total).fill(1);
        this.pageIndex = clampInt(options.progress?.chapterIndex ?? 0, 0, total - 1);
        this.bookmarks = [...(options.bookmarks ?? [])];
    }

    private get total(): number {
        return this.options.pageCount;
    }

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    mount(): void {
        const { container } = this;
        container.empty();
        container.addClass('rl-reader');
        container.addClass('rl-comic');
        this.applyTheme();

        this.buildHeader();
        this.buildBody();
        this.buildFooter();

        document.addEventListener('mousedown', this.onDocMouseDown);
        this.stageEl.addEventListener('click', this.onBodyClick);
        this.stageEl.addEventListener('wheel', this.onWheel, { passive: false });
        // 🔴 #636：右键菜单（看原文件名 / 复制图像）
        this.stageEl.addEventListener('contextmenu', this.onStageContextMenu);
        // 🔴 #636 / #669：连续模式的滚动同步（单页制不需要 —— 那个容器不滚）
        if (this.viewMode === 'scroll') {
            this.scrollEl?.addEventListener('scroll', this.onScrollView, { passive: true });
            void this.enterScrollMode();
        }
        if (document.fullscreenEnabled) {
            document.addEventListener('fullscreenchange', this.onFsChange);
        }
        this.registerKeys();

        if (this.viewMode === 'single') void this.renderPage();
        // 🔴 #683：缩略图栏**关着**时，`mountThumbs` 不会跑 ⇒ 预热要在这里补一次
        //    （否则「关掉缩略图栏」的用户永远吃不到全书缓存）。
        if (!this.thumbsOn) void this.warmAllPages();
    }

    destroy(): void {
        this.destroyed = true;
        this.flushSave();
        this.disposeFade?.();
        this.disposeFade = null;
        this.disposeHeadTitle?.();
        this.disposeHeadTitle = null;
        document.removeEventListener('mousedown', this.onDocMouseDown);
        document.removeEventListener('fullscreenchange', this.onFsChange);
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        // 🔴 #636 / #669：连续模式的定时器、rAF、观察者与右键菜单都要清（⛔ 别留悬着的定时器 / 孤儿菜单）
        if (this.fillTimer !== null) window.clearTimeout(this.fillTimer);
        this.fillTimer = null;
        if (this.syncRaf !== null) window.cancelAnimationFrame(this.syncRaf);
        this.syncRaf = null;
        this.pageIO?.disconnect();
        this.pageIO = null;
        this.thumbIO?.disconnect();
        this.thumbIO = null;
        this.hideCtx();
        // 2026-10-23：区域截图遮罩挂 document.body（fixed），面板销毁时必须一起收
        this.shotOverlay?.destroy();
        this.shotOverlay = null;
        // 2026-10-23：自动推进的 rAF / 定时器 / 调速浮层同样要收（否则关掉标签页还在滚）
        this.stopAuto();
        this.hideAutoPop();
        // 连续模式里所有已挂的 objectURL 逐个撤（只靠 `revokeUrl` 只管单页制那一张）
        if (this.scrollEl) {
            for (const img of Array.from(this.scrollEl.querySelectorAll('img'))) {
                if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
            }
        }
        for (const cell of this.thumbCells.values()) {
            const img = cell.querySelector('img');
            if (img?.dataset?.url) URL.revokeObjectURL(img.dataset.url);
        }
        this.thumbsEl = null;
        this.trackEl = null;
        this.thumbSliderEl = null;
        this.thumbCells.clear();
        this.thumbDone.clear();
        this.pageBoxes = [];
        this.pageRects = [];
        this.scrollEl = null;
        this.revokeUrl();
        this.nextBlob = null;
        this.imgEl = null;
        this.placeholderEl = null;
        this.container.empty();
    }

    /** 摘抄列表刷新：漫画没有摘抄入口 ⇒ 空实现（宿主仍会调用，接口保持一致） */
    refreshExcerpts(_excerpts: ParsedExcerpt[]): void {
        /* 漫画无摘抄/书签，无需刷新 */
    }

    /** 容器尺寸变化：页图是**显式像素宽**（适屏基准 × 缩放）⇒ 必须重算，
     *  否则拖侧栏 / 切分屏后不再贴合（#540；⛔ 现在的 contain 不再由 CSS 负责）。
     *  🔴 #677：连续滚动那一支**必须先算**，⛔ 别挂在 `if (!this.imgEl) return` 后面 ——
     *    连续滚动没有 `imgEl`（它逐页插图），旧写法让连续滚动的 resize 全被丢掉（拖侧栏后页宽不跟、
     *    再顺带把坏掉的几何写进 `pageRects`，页码/高亮就偏了）。
     *  重算前后**保住滚动位置**：拖分隔条会连发几十次 resize，每次都弹回左上角很烦。 */
    onResize(): void {
        if (this.destroyed) return;
        if (this.viewMode === 'scroll') {
            if (!this.scrollEl) return;
            const idx = this.pageIndex;
            this.viewH = this.scrollEl.clientHeight;
            for (let i = 0; i < this.pageBoxes.length; i++) this.applyPageBox(i);
            this.pageRectsDirty = true;
            this.armPageObserve();
            // resize 后把当前页重新摆回视线里（量出来的高度会变 ⇒ 不重定位就会「读着读着跳走」）
            this.scrollPageIntoView(idx, false);
            this.syncNow();
            return;
        }
        if (!this.imgEl) return;
        const top = this.stageEl.scrollTop;
        const left = this.stageEl.scrollLeft;
        this.applyZoom();
        this.stageEl.scrollTop = top;
        this.stageEl.scrollLeft = left;
    }

    // ── 构建 ──────────────────────────────────────────────────────────────────

    private buildHeader(): void {
        const head = this.container.createDiv({ cls: 'rl-reader-head' });
        this.headEl = head;

        // 2026-10-23 用户指令「漫画加侧边栏」⇒ 顶栏给一枚折叠开关（与 TXT/EPUB/PDF 同款同图标同 tip 语义）
        // 🔴 2026-10-25 统一：tip 改「收起目录」（原「收起侧栏」），与另三件逐字一致。
        this.sidebarBtnEl = head.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-reader-sidebar-toggle',
            attr: { 'data-tip': '收起目录' },
        });
        safeSetIcon(this.sidebarBtnEl, 'panel-left-close');
        this.sidebarBtnEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.sidebarBtnEl.addEventListener('click', () => this.toggleSidebar());

        // 打开条目笔记（与另三个阅读器同款同图标；⛔ 无关闭按钮 —— 退出只经关闭标签页）
        const noteBtn = head.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-reader-note-link',
            attr: { 'data-tip': `打开笔记：${this.options.title}` },
        });
        safeSetIcon(noteBtn, 'notebook-text');
        noteBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        noteBtn.addEventListener('click', () => this.options.onOpenNote?.());

        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        titleWrap.createSpan({ cls: 'rl-reader-title', text: this.options.title, attr: { 'data-tip': this.options.title } });

        const ops = head.createDiv({ cls: 'rl-reader-ops' });
        // 快捷入口（2026-10-23 用户指令「漫画阅读器需提供书签、区域截图功能和顶部快捷按钮」）：
        //   顺序与另三个阅读器同一套口径 —— **书签 · 区域截图 · 缩略图 · 设置**。
        //   🔴 漫画没有文本选区 ⇒ 不做「高亮/摘抄/翻译/网络搜索」四模式（那是文本类阅读器才有的）。
        const quick = ops.createDiv({ cls: 'rl-reader-quick' });

        // ① 快捷书签：位置 = 「当前页（1 基）+ 页内比例」，一键存，不需要选区
        this.bmBtnEl = quick.createEl('button', {
            cls: 'rl-btn rl-reader-btn',
            attr: { 'data-tip': '存书签：一键记下当前页' },
        });
        safeSetIcon(this.bmBtnEl, 'bookmark');
        this.bmBtnEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.bmBtnEl.addEventListener('click', () => this.addBookmark());

        // ② 区域截图（2026-10-23）：拖框 → 宿主 capturePage 取像素 → 写笔记「## 阅读截图」。
        // 🔴 面板只交矩形 + 定位，⛔ 不碰 vault / electron（见 `options.onShotSave` 注释）。
        if (this.options.onShotSave) {
            const shotBtn = quick.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': '区域截图：框选区域截图回填笔记内' } });
            safeSetIcon(shotBtn, 'image');
            shotBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
            shotBtn.addEventListener('click', () => this.startShot());
        }

        // 🔴 #636：缩略图栏开关（用户裁定「顶栏一枚开关」）—— 它是**内容导航**，不是快捷模式
        //   ⇒ 仍挂 `ops` 上、紧贴 ≡ 左侧（与 #636 落位一致，⛔ 别挪进 `.rl-reader-quick`）。
        const thumbsBtn = ops.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-comic-thumbs-btn',
            attr: { 'data-tip': '页面缩略图' },
        });
        safeSetIcon(thumbsBtn, 'layout-grid');
        thumbsBtn.toggleClass('active', this.thumbsOn);
        thumbsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        thumbsBtn.addEventListener('click', () => this.toggleThumbs());
        this.thumbsBtn = thumbsBtn;
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);

        this.disposeHeadTitle = attachHeadTitle({ headEl: head, opsEl: ops, titleEl: titleWrap });
    }

    private buildSettingsMenu(ops: HTMLElement): void {
        const menu = ops.createDiv({ cls: 'rl-reader-menu hidden' });
        this.menuEl = menu;
        menu.addEventListener('mousedown', (ev) => ev.stopPropagation());

        // 🔴 2026-10-24 统一：分组标题「显示」+ 组容器，与 TXT / EPUB / PDF 完全同构
        //   （旧版漫画没有分组标题，菜单顶边直接贴着「缩放」行；行也直接挂菜单，
        //    而 TXT/EPUB 的行在 `.rl-reader-menu-group` 里 —— 两套 DOM 结构 ⇒ 行疏密不同）。
        menu.createDiv({ cls: 'rl-reader-menu-sec', text: '显示' });
        const group = menu.createDiv({ cls: 'rl-reader-menu-group' });

        // 缩放行（漫画无字号概念 ⇒ 调「页面缩放」，标签就叫「缩放」，与 PDF 一致）
        const zoomRow = group.createDiv({ cls: 'rl-reader-menu-row' });
        zoomRow.createSpan({ cls: 'rl-reader-menu-label', text: '缩放' });
        const slider = zoomRow.createEl('input', {
            cls: 'rl-reader-menu-slider',
            attr: { type: 'range', min: String(ZOOM_MIN * 100), max: String(ZOOM_MAX * 100), step: String(ZOOM_STEP * 100), 'data-tip': '拖动调整页面缩放（Ctrl+滚轮也能缩放；←/→ 翻页，= / - 缩放）' },
        });
        this.menuZoomSlider = slider;
        slider.addEventListener('input', () => this.menuZoomVal?.setText(`${Math.round(Number(slider.value))}%`));
        slider.addEventListener('change', () => this.applyZoom(Number(slider.value) / 100));
        this.menuZoomVal = zoomRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 阅读模式行（🔴 2026-10-24 统一：与 TXT / EPUB / PDF 完全同构 ——
        //   ① 标签「阅读」而不是「翻页」（旧标签与选项名撞车，读成「翻页：翻页 滚动」）；
        //   ② 选项顺序走 `COMIC_VIEW_MODES` = 滚动 → 翻页，与 `SCROLL_OPTIONS` 一致；
        //   ③ 控件用 `.rl-seg rl-seg-text` **纯字变色**，⛔ 不用胶囊 —— UI-GUIDE §7.10
        //      「二选一互斥项一律纯字变色，不铺底不描边」是用户 2026-09-20 亲自定的口径。）
        const modeRow = group.createDiv({ cls: 'rl-reader-menu-row' });
        modeRow.createSpan({ cls: 'rl-reader-menu-label', text: '阅读' });
        const modeSeg = modeRow.createDiv({ cls: 'rl-seg rl-seg-text' });
        for (const opt of comicViewModeOptions()) {
            const b = modeSeg.createEl('button', {
                cls: 'rl-seg-item',
                attr: { type: 'button', 'data-val': opt.value, 'data-tip': `阅读方式：${opt.label}` },
                text: opt.label,
            });
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => this.setViewMode(opt.value));
            this.modeSegs.set(opt.value, b);
        }
        this.syncModeSegs();

        // 主题六档色卡（与另三个阅读器同一份色板）—— 🔴 2026-10-24：移到**最后一行**收尾，
        //   与 TXT / EPUB / PDF 的「主题压轴」一致（旧版把它夹在缩放与翻页之间）。
        const themeRow = group.createDiv({ cls: 'rl-reader-menu-row rl-reader-theme-row' });
        themeRow.createSpan({ cls: 'rl-reader-menu-label', text: '主题' });
        for (const meta of READER_THEMES) {
            const sw = themeRow.createEl('button', {
                cls: 'rl-btn rl-reader-theme-swatch',
                attr: { type: 'button', 'data-theme': meta.id, 'data-tip': meta.label },
            });
            sw.addEventListener('click', () => this.setTheme(meta.id));
            this.themeSwatches[meta.id] = sw;
        }

        // 2026-10-23：设置菜单里的「书签」行已**撤掉** —— 侧栏有独立「书签」页签（用户指令），
        //   同一份数据两处渲染 = 两份真源，改一处忘另一处就出现「菜单里有、侧栏没有」。
        //   ⛔ 别为了「兼容旧路径」把它加回来。
    }

    /** 重绘侧栏书签列表：点击跳页、右键删除（走宿主二次确认）。 */
    private buildComicBookmarks(): void {
        const list = this.bmListEl;
        const head = this.bmHeadRef;
        const n = this.bookmarks.length;
        if (head) head.countEl.setText(annoCountText('书签', n, head.sel));
        this.syncComicAnnoBtns(head, n);
        if (!list) return;
        list.empty();
        if (n === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无书签' });
            return;
        }
        for (const bm of [...this.bookmarks].sort((a, b) => a.chapter - b.chapter || a.pct - b.pct)) {
            const item = list.createEl('button', {
                cls: 'rl-reader-toc-item',
                attr: { type: 'button', 'data-tip': `第 ${bm.chapter} 页 · ${bm.pct}%` },
            });
            item.createSpan({ cls: 'rl-reader-toc-label', text: `第 ${bm.chapter} 页 · ${bm.pct}%` });
            item.addEventListener('click', () => this.jumpToComicBookmark(bm));
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                void this.deleteComicBookmark(bm);
            });
        }
    }

    /** 选择模式的按钮显隐/禁用（与 TXT/PDF 的同名私有方法逐条对齐 —— `annoSelection` 不导出它） */
    private syncComicAnnoBtns(h: AnnoHeadHandles | null, total: number): void {
        if (!h) return;
        h.selectBtn.toggleClass('hidden', total === 0 && !h.sel.on);
        h.delBtn.disabled = h.sel.ids.length === 0;
    }

    /** 批量删书签（侧栏「选择 → 全选 → 删除所选」）—— 必须二次确认，⛔ 不静默删 */
    private async deleteSelectedComicBookmarks(ids: string[]): Promise<boolean> {
        const sel = new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0));
        if (sel.size === 0) return false;
        const ok = this.options.onConfirmClear
            ? await this.options.onConfirmClear(`删除选中的 ${sel.size} 个书签？`)
            : false;
        if (!ok) return false;
        this.bookmarks = this.bookmarks.filter((b) => !b.id || !sel.has(b.id));
        this.options.onBookmarksChange?.(this.bookmarks);
        this.bmBtnEl?.setAttribute(
            'data-tip',
            this.bookmarks.length ? `存书签· 已有 ${this.bookmarks.length} 个` : '存书签：一键记下当前页',
        );
        this.buildComicBookmarks();
        new Notice(`已删除 ${sel.size} 个书签`);
        return true;
    }

    /** 跳书签：先到该页，连续模式下再按页内比例细调 */
    private jumpToComicBookmark(bm: ReaderBookmark): void {
        const idx = clampInt(bm.chapter - 1, 0, this.total - 1);
        if (this.viewMode === 'scroll') {
            this.pageIndex = idx;
            this.updateFooter();
            this.scheduleSave();
            this.scrollPageIntoView(idx, true, Math.max(0, Math.min(1, bm.pct / 100)));
            this.syncNow();
            return;
        }
        this.goto(idx);
    }

    /** 删书签：**必须二次确认**（与 PDF/TXT 同口径，⛔ 不静默删） */
    private async deleteComicBookmark(bm: ReaderBookmark): Promise<void> {
        const msg = `删除书签「第 ${bm.chapter} 页 · ${bm.pct}%」？`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : false;
        if (!ok) return;
        this.bookmarks = this.bookmarks.filter((b) => b !== bm);
        this.options.onBookmarksChange?.(this.bookmarks);
        this.bmBtnEl?.setAttribute(
            'data-tip',
            this.bookmarks.length ? `存书签· 已有 ${this.bookmarks.length} 个` : '存书签：一键记下当前页',
        );
        this.buildComicBookmarks();
    }

    /** 阅读模式分段的选中态（与主题色卡同款：`.is-on` 高亮） */
    private syncModeSegs(): void {
        for (const [m, el] of this.modeSegs) el.toggleClass('is-on', m === this.viewMode);
    }

    private buildBody(): void {
        // 🔴🔴 2026-10-25 用户：「漫画阅读器的侧边栏不是独立显示隔开底部栏」「给我统一其他阅读器的
        //   侧边栏布局，用「推挤式（Push）」布局。侧边栏不要悬浮遮挡底部栏，而是把底部栏（及主内容区）
        //   整体往右推挤，底部栏的宽度自适应缩减」。
        //   真因：TXT/EPUB/PDF 的结构是
        //     `.rl-reader`(column) > `.rl-reader-body`(row) > [ `.rl-reader-toc`(左列), `.rl-reader-main`(column) ]
        //     底栏挂在 `.rl-reader-main` **里面** ⇒ 目录一整列独立，底栏被推到其右侧、宽度随 main 缩短。
        //   而漫画原来是 `.rl-reader-main`(row) > [toc, body, thumbs]，底栏挂在 `.rl-reader` 上、width:100%
        //     ⇒ 底栏从目录下方横跨全宽，看起来就是「侧边栏没把底部栏隔开」。
        //   ⇒ 现在**完全改成与另三个同构**：外层 `.rl-reader-body`(row) 装 [目录, main]，main 恢复 column，
        //     里面再放一个 row 的 `.rl-comic-main-row` 装 [正文, 缩略图栏]，底栏挂在 main 末尾。
        const body = this.container.createDiv({ cls: 'rl-reader-body' });
        // 侧栏放在 `.rl-reader-body` 的**第一个子项**（body 是 row ⇒ 侧栏在左、main 在右，与另三个完全同构）。
        // 复用 `.rl-reader-toc` 整套样式与 `attachTocResizer` 拖宽，⛔ 别为漫画另写一套侧栏 CSS。
        this.buildSidebar(body);
        const main = body.createDiv({ cls: 'rl-reader-main' });
        // 🔴 #636：中间那块**按模式二选一**（两模式共用底栏与进度落库，只换这一个容器）
        //    · 单页制（#537 现状）：`.rl-comic-stage` —— 整页 contain + 溢出滚动（放大后平移靠它）；
        //    · 连续滚动（本批）：`.rl-comic-scroll` —— 页依次竖排、容器自己滚。
        // 这一层是 row：正文在左、缩略图栏在右（#671 的「正文 + 栏横排」语义收进这里，main 本身恢复 column）。
        const row = main.createDiv({ cls: 'rl-comic-main-row' });
        if (this.viewMode === 'scroll') {
            this.scrollEl = row.createDiv({ cls: 'rl-comic-scroll' });
            this.stageEl = this.scrollEl;
            this.buildScrollPages();
        } else {
            this.stageEl = row.createDiv({ cls: 'rl-comic-stage' });
        }
        // 右侧缩略图导航栏（默认隐藏 ⇒ 这里**不建 DOM**；开启时在 `mountThumbs` 里补建）
        if (this.thumbsOn) this.mountThumbs(row);
        this.applySidebarCollapsed();
    }

    /**
     * 漫画侧栏：「目录 | 书签」两页签（用户 2026-10-23 指令）。
     *
     * 与 TXT/EPUB/PDF 同一套结构与类名：
     *   `.rl-reader-toc` > `.rl-reader-toc-tabs`（两个 `button.rl-reader-toc-tab`）
     *                  > `.rl-reader-toc-pane`（目录：每页一行）、`.rl-reader-toc-pane.rl-reader-ex-pane.hidden`（书签）
     *
     * 🔴 漫画的「目录」= **每页一行**（`第 N 页`），因为漫画没有章节概念。
     *    200+ 页一次性建 DOM 会卡（真机 CBZ 实测 3022 页那种规模），所以这里**按需懒建**：
     *    先建空 pane，首次切到目录页签时才填（`ensureComicToc()`）。
     */
    private buildSidebar(parent: HTMLElement): void {
        this.tocEl = parent.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '页面目录' } });
        safeSetIcon(tocTab, 'list-tree');
        // 🔴 2026-10-25 用户：「漫画阅读器的侧边栏图标给我保持其他阅读器图标统一」。
        //    EPUB/TXT/PDF 的第二页签一律是 `quote`（EPUB :2144 / TXT :1871 / PDF :1132），
        //    漫画原先单独用了 `bookmark` ⇒ 四个阅读器的侧栏页签图标不一致。这里对齐成 `quote`。
        //    ⚠️ tip 仍写「书签」不跟另三个的「书签 · 高亮 · 摘抄」：漫画确实只有书签，
        //       把做不了的高亮/摘抄写进提示就是骗用户（提示要如实反映可用功能）。
        const bmTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签' } });
        safeSetIcon(bmTab, 'quote');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        // 书签 pane：复用 buildAnnoHead（计数 + 选择模式 + 批量删除），与另三个阅读器同一套交互
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        this.bmHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-bm-list',
            text: '书签（0）',
            onDelete: (ids) => this.deleteSelectedComicBookmarks(ids),
            allIds: () => this.bookmarks.map((b) => b.id),
            refresh: () => this.buildComicBookmarks(),
        });
        this.bmListEl = this.bmHeadRef.listEl;
        this.buildComicBookmarks();
        tocTab.addEventListener('click', () => this.activateSidebarPane('toc'));
        bmTab.addEventListener('click', () => this.activateSidebarPane('bm'));
        attachTocResizer(this.tocEl, 'comic');
        // 侧栏滚动条是刻意隐藏的 ⇒ 溢出时没有线索，末行被裁一半，读作「书签显示不全」。
        // 🔴 挂的必须是**真正会滚的那个容器**，按页签分别判断（真机量过，别凭结构猜）：
        //    目录页 → `.rl-reader-toc-list`（clientH 700 / scrollH 1993，pane 本身 scrollH==clientH 不滚）；
        //    书签页 → exPane 本身（`.rl-reader-bm-list` 没有自己的滚动框，是父 pane 在滚）。
        //    ⚠️ 曾把目录页也挂在 tocPane 上——类挂上去了却永远不触发，渐隐静默失效。
        this.disposeFade = attachScrollFades([this.tocListEl, exPane]);
    }

    /** 侧栏页签切换（与 `TxtReaderModal.activatePane` 同一口径：按 pane 顺序下标对应） */
    private activateSidebarPane(pane: 'toc' | 'bm', expand = true): void {
        const toc = this.tocEl;
        if (!toc) return;
        if (expand) {
            toc.toggleClass('collapsed', false);
            this.tocCollapsed = false;
        }
        const order: ReadonlyArray<'toc' | 'bm'> = ['toc', 'bm'];
        const idx = order.indexOf(pane);
        if (idx < 0) return;
        if (pane === 'toc') this.ensureComicToc();
        toc.querySelectorAll('.rl-reader-toc-tab').forEach((el, i) => el.toggleClass('active', i === idx));
        toc.querySelectorAll('.rl-reader-toc-pane').forEach((el, i) => el.toggleClass('hidden', i !== idx));
        // 懒建目录 + 从 hidden 恢复显示，都不会触发 ResizeObserver 的尺寸变化（display:none 的元素
        // 尺寸一直是 0，恢复后 RO 有时不回调）⇒ 这里补一枪，否则第一次切到目录页没有渐隐提示。
        // 🔴 补的也必须是挂过渐隐的那个容器（目录页是 list，书签页是 pane），传 pane 会落空。
        resyncScrollFade(pane === 'toc' ? this.tocListEl : toc.querySelectorAll<HTMLElement>('.rl-reader-toc-pane')[idx]);
    }

    /** 目录 pane 懒填充（每页一行）；只在第一次进入时建 DOM */
    private ensureComicToc(): void {
        const list = this.tocListEl;
        if (!list || this.tocBuilt) return;
        this.tocBuilt = true;
        for (let i = 0; i < this.total; i++) {
            const item = list.createEl('button', {
                cls: 'rl-reader-toc-item',
                attr: { type: 'button', 'data-tip': `第 ${i + 1} 页` },
            });
            item.createSpan({ cls: 'rl-reader-toc-label', text: `第 ${i + 1} 页` });
            item.addEventListener('click', () => this.gotoPage(i));
            this.tocRowEls.push(item);
        }
        this.syncComicTocActive();
    }

    /** 目录里高亮当前页（滚动/翻页都调；只在目录已建时生效） */
    private syncComicTocActive(): void {
        if (!this.tocBuilt) return;
        for (let i = 0; i < this.tocRowEls.length; i++) {
            this.tocRowEls[i].toggleClass('is-on', i === this.pageIndex);
        }
    }

    /** 顶栏侧栏开关（与另三个阅读器同款：折叠 ⇄ 展开 + 图标提示同步） */
    private toggleSidebar(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.applySidebarCollapsed();
    }

    /**
     * 同步侧栏折叠开关图标与标题（随 tocCollapsed：展开→panel-left-close/收起目录；折叠→panel-left-open/展开目录）。
     * 🔴 2026-10-25 四阅读器统一：漫画原先把按钮标成 `active` 且**不换图标**、tip 写「侧栏」——
     *    三处都与 TXT/EPUB/PDF 不同。现改为与另三件**逐字同构**：
     *    ⑴ 折叠态由**图标方向**表达，⛔ 不再叠 `active` 高亮（否则「收起」时反而高亮，语义反了）；
     *    ⑵ tip 统一「收起目录 / 展开目录」（不再说「侧栏」）。
     */
    private applySidebarCollapsed(): void {
        this.tocEl?.toggleClass('collapsed', this.tocCollapsed);
        if (!this.sidebarBtnEl) return;
        this.sidebarBtnEl.removeClass('active');
        if (this.tocCollapsed) {
            safeSetIcon(this.sidebarBtnEl, 'panel-left-open');
            this.sidebarBtnEl.setAttribute('data-tip', '展开目录');
        } else {
            safeSetIcon(this.sidebarBtnEl, 'panel-left-close');
            this.sidebarBtnEl.setAttribute('data-tip', '收起目录');
        }
    }

    // ── 🔴 #636 ⑤ 新增：缩略图导航栏 / 连续滚动 / 右键菜单 ──────────────────────────

    /**
     * 右侧**垂直缩略图导航栏**（用户规格：「右侧浅灰的垂直缩略图导航栏，卡片式缩略图，
     * 选中缩略图带加粗黑色边框」）。
     *
     * 🔴 **惰性生成**是这里唯一的技术要点：只给「当前页前后 `THUMB_RADIUS` 页」解图做小图，
     *    其余格子只是占位（`.rl-comic-thumb` 本身就在那，点它照样能跳页）。
     *    200 页的 CBZ 一次性全做 = 同时持有 200 个 Blob ⇒ 卡死或 OOM。
     *
     * 🔴 #669 新增：
     *   · 栏内分两层 —— `.rl-comic-thumbs`（滚动视口，UI 常驻）里套 `.rl-comic-thumbs-track`
     *     （卡片轨道，和已有的格子同宽）+ **进度滑块** `-thumb`（绝对定位在**滚动视口**上，
     *     所以拖动时滑块跟着鼠标走，而不是跟着内容滚）。滑块绘制参考仓 `cbz-reader` 的 minimap thumb。
     *   · 格子另接一枚 IntersectionObserver（`thumbIO`）：**栏滚到哪就补哪**，比「当前页 ±6」更省
     *     —— 用户把栏拽到第 80 页时那里也有图，而不是一片空卡片。
     */
    private mountThumbs(main: HTMLElement): void {
        if (this.thumbsEl) return;
        const col = main.createDiv({ cls: 'rl-comic-thumbs', attr: { 'aria-label': '页面缩略图' } });
        this.thumbsEl = col;
        this.thumbDone.clear();
        this.thumbCells.clear();
        // 🔴 滑块先建：它是**滚动视口**的绝对定位子元素，必须挂在 `col` 上（⛔ 不能放进 track —— 那样它会跟着内容滚走）
        const slider = col.createDiv({ cls: 'rl-comic-thumbs-thumb', attr: { 'aria-hidden': 'true' } });
        this.thumbSliderEl = slider;
        const track = col.createDiv({ cls: 'rl-comic-thumbs-track' });
        this.trackEl = track;
        for (let i = 0; i < this.total; i++) {
            const cell = track.createEl('button', {
                cls: 'rl-comic-thumb',
                attr: { type: 'button', 'data-tip': `第 ${i + 1} 页`, 'data-index': String(i) },
            });
            cell.createSpan({ cls: 'rl-comic-thumb-no', text: String(i + 1) });
            cell.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.gotoPage(i);
            });
            this.thumbCells.set(i, cell);
        }
        this.bindThumbSlider();
        this.thumbIO?.disconnect();
        this.thumbIO = null;
        this.armThumbObserve();
        this.syncNow();
        void this.fillThumbs();
        // 🔴 #683：栏一建好就开始**后台预热全书**（用户：「缩略图和正文要全部加载缓存下来再阅读」）
        void this.warmAllPages();
    }

    /** 拆掉缩略图栏（关闭时**连 DOM 一起**去掉 —— 留着空容器会占宽度） */
    private unmountThumbs(): void {
        this.thumbIO?.disconnect();
        this.thumbIO = null;
        this.thumbsEl?.remove();
        this.thumbsEl = null;
        this.trackEl = null;
        this.thumbSliderEl = null;
        this.thumbDone.clear();
        this.thumbCells.clear();
    }

    /**
     * 给格子接上**懒加载观察器**（栏滚到哪就补哪）。
     *
     * 🔴🔴 #682 用户报障：「两个模式下缩略图都没加载出来显示空白」。
     *    真因：`mountThumbs` 里先 `thumbIO = null` 再调本方法，而本方法第一行就是
     *    `if (!this.thumbIO) return;` ⇒ **观察器从来没被 new 出来**（不报错、静默失效），
     *    于是除了 `fillThumbs()` 那一轮「当前页 ±6」之外，**一张图都不会再补**。
     *    ⇒ 现在由本方法**负责创建**（拿不到 IntersectionObserver 的旧环境就退化成「直接按窗口补」），
     *      调用点只负责在重建栏之前 `disconnect` 掉旧的。
     * ⚠️ 重复 observe 同一元素无副作用 ⇒ 可以反复调（栏重建 / 切模式 / resize 都会调）。
     */
    private armThumbObserve(): void {
        const col = this.thumbsEl;
        if (!col) return;
        if (typeof IntersectionObserver !== 'function') {
            // 老环境兜底：没有观察器就直接按「当前页 ±THUMB_RADIUS」补满
            void this.fillThumbs();
            return;
        }
        if (!this.thumbIO) {
            this.thumbIO = new IntersectionObserver(
                (entries) => {
                    // 进入视野的格子 ⇒ 立刻补图（格子自己知道自己是第几页）
                    for (const en of entries) {
                        if (!en.isIntersecting) continue;
                        const cell = en.target as HTMLElement;
                        const idx = Number(cell.dataset.index);
                        if (!Number.isFinite(idx)) continue;
                        this.thumbDone.delete(idx); // 允许补（fillThumbs 内部会再判一次「做过没有」）
                        void this.fillThumbs(true);
                    }
                },
                { root: col, rootMargin: '300px 0px', threshold: 0 },
            );
        }
        for (const cell of this.thumbCells.values()) this.thumbIO.observe(cell);
    }

    /**
     * 给**窗口内**还没做过的页补缩略图；滚远了的丢缓存（`pruneThumbs` 的保留窗口更宽，防抖动）。
     *
     * ⚠️ #642 复盘：这里曾加过「重入守卫 + 每张 await 一帧」，**把缩略图栏改坏了** ——
     *   守卫让「滚动中发起的补图」全部变成只置脏就返回，而唯一那轮跑完后复查 dirty 时
     *   `pageIndex` 已变、窗口已换，缩略图**大面积为空**。已整体回退到本形态。
     *   🔴 卡顿的真凶是**重复解压**，已在 `main.unpackEpub` 的 `loadBinary` 里根治
     *      （缓存 + 并发去重），#669 又把这套补到了 CBZ —— ⛔ 别再往本方法里加守卫/让帧。
     * ⚠️ 阈值不动：仍是 `thumbWindow(current, total, THUMB_RADIUS)`（用户已验收的窗口语义）。
     */
    private async fillThumbs(force = false): Promise<void> {
        const col = this.thumbsEl;
        if (!col) return;
        // 丢远的（只丢**缓存标记**，格子还在 —— 再滚回来重新生成）
        const keep = new Set(pruneThumbs([...this.thumbDone], this.pageIndex, this.total));
        for (const i of [...this.thumbDone]) if (!keep.has(i)) this.thumbDone.delete(i);

        // 🔴🔴 #684（用户：「怎么只有我点击缩略图空白页才加载，应该鼠标滑动下去就加载显示」）：
        //    补图范围从「当前页 ±6」改成**当前页窗口 ∪ 栏视野内格子**。
        //    原来只补「当前页 ±THUMB_RADIUS」那一窗 —— 用户把栏往下滚，**视野里的格子根本不在窗口内**
        //    ⇒ 一片空白，只有点它（= 换成那一页）才会补。这就是「点一下才加载」的真因。
        //    ⚠️ 只取**视野矩形内**的格子（不做整栏全量），避免 200 页时一次补太多。
        const targets = new Set<number>();
        const w = thumbWindow(this.pageIndex, this.total, THUMB_RADIUS);
        for (let i = w.start; i <= w.end; i++) targets.add(i);
        for (const i of this.visibleThumbIndexes()) targets.add(i);

        // 按「离当前页近」排序：用户已经滚到第 50 页时，别先去补上一窗口剩的第 44 页
        const todo = sortByDistance([...targets].filter((i) => !this.thumbDone.has(i)), this.pageIndex);
        for (const i of todo) {
            if (this.thumbDone.has(i)) continue;
            this.thumbDone.add(i);
            const cell = this.thumbCells.get(i);
            if (!cell) continue;
            // 🔴 #683：走**面板级缓存**（与正文共用），⛔ 别直接 `options.loadPage`
            //    —— 否则同一页在「正文 / 缩略图 / 预热」三条路上各取一次（去重形同虚设）。
            const blob = await this.loadBlob(i);
            if (this.destroyed || !this.thumbsEl) return; // 中途被关掉 / 收起
            if (!blob) continue;
            // ⚠️ 可能已被别处补过（预热 / 另一次 fillThumbs）⇒ 已存在 img 就不再插第二张
            if (cell.querySelector('.rl-comic-thumb-img')) continue;
            const url = URL.createObjectURL(blob);
            const img = cell.createEl('img', { cls: 'rl-comic-thumb-img', attr: { alt: '' } });
            img.src = url;
            img.addEventListener('load', () => {
                // 记下纵横比：正文连续模式里那页就能**先按真实高**占位（#669 ⑶ 的源头）
                if (img.naturalWidth > 0) this.pageRatios.set(i, img.naturalHeight / img.naturalWidth);
                URL.revokeObjectURL(url);
            }, { once: true });
            img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
        }
    }

    /**
     * 🔴 #684：**缩略图栏视野内**的格子序号。
     *
     * ⚠️ 为什么不用 `getBoundingClientRect` 互相比：如果栏的**高度没被约束住**（高度跟内容走），
     *    栏的矩形本身就等于整条内容，于是「所有格子都在视野内」—— 判据静默失效（我第一版探针就这么假绿过）。
     * ⇒ 改用**滚动几何**，它只依赖 `scrollTop / clientHeight`，与栏是否被撑开无关：
     *    格子的 `offsetTop` 是相对**轨道**的（轨道是栏的唯一子元素，第二个孩子），
     *    加上轨道的 `offsetTop` 得到「相对栏内容」的位置，再与 `[scrollTop − pad, scrollTop + clientHeight + pad]` 比。
     * 上下各留一格余量：滑动时不会看到「刚露出来还是白的」。
     */
    private visibleThumbIndexes(): number[] {
        const col = this.thumbsEl;
        const track = this.trackEl;
        if (!col || !track) return [];
        const viewH = col.clientHeight;
        if (viewH <= 0) return []; // 栏没显示 ⇒ 没有「视野」可言
        const top = col.scrollTop;
        const bottom = top + viewH;
        const trackTop = track.offsetTop;
        const out: number[] = [];
        for (const [i, cell] of this.thumbCells) {
            const cellTop = trackTop + cell.offsetTop;
            const cellH = cell.offsetHeight || 92;
            const pad = cellH;
            if (cellTop + cellH >= top - pad && cellTop <= bottom + pad) out.push(i);
        }
        return out;
    }

    /**
     * 当前页那格高亮 + 让它落进栏的可视区。
     *
     * 🔴 #669 三条口径：
     *   ⑴ 高亮**永远**要更新（哪怕栏没动）；
     *   ⑵ 位置用 `thumbScrollTarget` 算（在视野里就不动、不在才居中）—— 比 `scrollIntoView`
     *      好两点：不会把栏外的祖先（视图容器）一起拽动；在视野里时零位移 ⇒ 整栏不抖；
     *   ⑶ 只在**模式允许自动跟随**时移动栏（拖滑块期间不跟随，否则两边互相拽）。
     */
    private syncThumbsActive(): void {
        if (!this.thumbsEl) return;
        for (const [i, cell] of this.thumbCells) cell.toggleClass('is-on', i === this.pageIndex);
        if (this.dragging) return;
        this.followThumbs();
        // 🔴🔴 #680：**两种模式的栏必须长得一样**——高亮会滚进视野，滑块也得跟着挪。
        //    原来只有连续滚动的 rAF 会 `paintThumbSlider()`，翻页模式只刷高亮 ⇒ 滑块停在原处不动
        //    （用户看到的「两者交互不一致」）。这里统一成「高亮 + 跟随 + 滑块」三件套。
        this.paintThumbSlider();
    }

    /** 让当前格落进栏的可视区（纯函数算目标位置；量不到尺寸就什么都不做） */
    private followThumbs(): void {
        const col = this.thumbsEl;
        const track = this.trackEl;
        const cell = this.thumbCells.get(this.pageIndex);
        if (!col || !track || !cell) return;
        const viewH = col.clientHeight;
        if (viewH <= 0) return;
        const cellH = cell.offsetHeight;
        const stride = cellStride(cellH, 6);
        // 🔴 #680：位置一律取**子元素的 offsetTop** —— 轨道的 `offsetTop` 在「栏是定位上下文」时
        //    是 0，`track.offsetTop - col.offsetTop` 会算出 0（≠ 真实内距）⇒ 栏跟随差半格。
        //    这不是理论问题：`_probe_680` 用 40 页量过，差 8px 会让「当前格」在边界处提前/推迟一格。
        const padTop = track.offsetTop;
        const rect = cellRect(this.pageIndex, stride, cellH, padTop);
        const target = thumbScrollTarget(
            { scrollTop: col.scrollTop, scrollHeight: col.scrollHeight, clientHeight: viewH },
            rect,
            cellH * 0.5, // 再往上留半格：让「当前页 + 下一页开头」都在视野里
        );
        if (Math.abs(target - col.scrollTop) >= 1) col.scrollTop = target;
    }

    /**
     * 缩略图栏上的**进度滑块**：绘制（高度按可视比例、位置按全书比例）+ 拖动/点轨道跳页 +
     * 栏上滚轮驱动正文（×4，参考仓同款「快速滚动区」）。
     */
    private bindThumbSlider(): void {
        const col = this.thumbsEl;
        const slider = this.thumbSliderEl;
        if (!col || !slider) return;

        // 轨道点击 / 拖动起点：直接按比例定位正文（点哪去哪）
        const jumpToEventY = (clientY: number): void => {
            const rect = col.getBoundingClientRect();
            const h = slider.offsetHeight || 20;
            const p = clamp((clientY - rect.top - h / 2) / Math.max(1, rect.height - h), 0, 1);
            this.scrollToRatio(p, true);
        };
        const onMove = (ev: MouseEvent): void => {
            if (!this.dragging) return;
            ev.preventDefault();
            jumpToEventY(ev.clientY);
        };
        const onUp = (): void => {
            this.dragging = false;
            slider.removeClass('is-dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        slider.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            this.dragging = true;
            slider.addClass('is-dragging');
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        col.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0 || ev.target === slider) return;
            // 点卡片 = 卡片自己的 click（跳页）；点空白 = 按位置跳
            if ((ev.target as HTMLElement).closest('.rl-comic-thumb')) return;
            ev.preventDefault();
            this.dragging = true;
            slider.addClass('is-dragging');
            jumpToEventY(ev.clientY);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // 🔴🔴 #680（用户：「统一翻页模式和滚动模式的缩略图栏逻辑，目前两者交互不一致，滚动不顺利」）：
        //    **两种模式的栏，滚轮语义统一成「栏自己滚」**。
        //    上一版（#679）在连续滚动里让滚轮**驱动正文**，实测手感分裂：
        //      · 正文跟着跳（×4 倍速 = 一滚就是几屏），而**栏几乎不动**（栏只在页码变了才跟随）；
        //      · 用户想「慢慢浏览缩略图找某一页」时，滚的是正文而不是栏，找不到目标。
        //    ⇒ 现在两侧一致：**栏上滚轮 = 滚栏**（滚到哪看到哪，栏自己会把当前格保持高亮），
        //      跳页仍然靠「点卡片 / 点滑块 / 拖动滑块」—— 三条路两模式都有。
        //    ⛔ 拦住不穿透：否则滚栏会连带翻页（单页制）或连带滚正文（连续模式）。
        //    `Ctrl/⌘ + 滚轮`：两种模式都是缩放。
        col.addEventListener('wheel', (ev) => {
            const d = wheelDeltaOf(ev as unknown as { deltaY: number; deltaX?: number; deltaMode?: number; shiftKey?: boolean });
            if (ev.ctrlKey || ev.metaKey) {
                ev.preventDefault();
                ev.stopPropagation();
                this.zoomByWheel(ev.deltaY);
                return;
            }
            if (!d.dy && !d.dx) return;
            ev.preventDefault();
            ev.stopPropagation();
            const before = col.scrollTop;
            col.scrollTop = before + d.dy;
            if (d.dx) col.scrollLeft += d.dx;
            // 滚完补一次：滑块位置 + 视野内的缩略图（IO 会补图，这里只保证滑块跟手）
            if (col.scrollTop !== before) this.paintThumbSlider();
        }, { passive: false });
    }

    /** 画进度滑块（内容比视口矮 ⇒ 隐藏；⛔ 别画一个占满全高的条，看着像卡住） */
    private paintThumbSlider(): void {
        const col = this.thumbsEl;
        const slider = this.thumbSliderEl;
        if (!col || !slider) return;
        const viewH = col.clientHeight;
        const contentH = col.scrollHeight;
        if (viewH <= 0 || contentH <= viewH + 1) {
            slider.addClass('is-off');
            return;
        }
        slider.removeClass('is-off');
        const h = Math.max(24, Math.round((viewH / contentH) * viewH));
        const maxTop = Math.max(0, viewH - h);
        const p = scrollTopToRatio(col.scrollTop, contentH, viewH);
        slider.style.height = `${h}px`;
        slider.style.top = `${Math.round(p * maxTop)}px`;
    }

    /** 顶栏那枚「缩略图栏」开关（用户裁定：顶栏一枚开关，状态记住） */
    private toggleThumbs(): void {
        this.thumbsOn = !this.thumbsOn;
        // 🔴 2026-10-25：缩略图栏挂在 `main > .rl-comic-main-row`（正文的兄弟，横排靠右）。
        //    ⛔ 别挂 `main` 本身 —— main 现在是 column（放 row + 底栏），挂进去会变成上下堆叠。
        const row = this.container.querySelector('.rl-comic-main-row') as HTMLElement | null;
        if (this.thumbsOn && row) this.mountThumbs(row);
        else this.unmountThumbs();
        this.thumbsBtn?.toggleClass('active', this.thumbsOn);
        this.thumbsBtn?.setAttribute('data-tip', this.thumbsOn ? '隐藏页面缩略图' : '显示页面缩略图');
        this.options.onThumbsChange?.(this.thumbsOn);
        // 栏显隐会改正文可用宽 ⇒ 连续模式要重算页块（否则页宽不跟窗口）
        if (this.viewMode === 'scroll') {
            for (let i = 0; i < this.pageBoxes.length; i++) this.applyPageBox(i);
            this.pageRectsDirty = true;
            this.armPageObserve();
            this.syncNow();
        } else {
            this.applyZoom();
        }
    }

    // ── 🔴 #669 连续滚动：占位 → 观察 → 插图 → 同步 ─────────────────────────────

    /** 连续模式的滚动容器（⛔ 单页制的 `stageEl` 是舞台，不滚） */
    private scrollTargetOf(): HTMLElement | null {
        return this.viewMode === 'scroll' ? this.scrollEl : this.stageEl;
    }

    /**
     * 连续滚动模式：把**全部**页的占位块先排好，并**立刻写入宽高**（`applyPageBox`）。
     *
     * 🔴 #669 与旧写法的三处本质差别：
     *   ⑴ 先建**全部**块再统一量一次尺寸（旧写法建完就插图，边插边改高度 ⇒ 位置一直漂）；
     *   ⑵ 宽高按**已知纵横比**算（`pageRatios` 里有的用真实的，没有的用 `PAGE_RATIO_FALLBACK`），
     *      于是「图还没来」和「图来了」的高度几乎一样 ⇒ 滚动位置不跳（旧写法是 `min-height:240px`）；
     *   ⑶ 页块**常驻不删**，卸载只撤 `<img>` 并把块高钉成 `data-h` ⇒ 内存与位置两不误。
     */
    private buildScrollPages(): void {
        const col = this.scrollEl;
        if (!col) return;
        col.empty();
        this.pageBoxes = [];
        this.pageRects = [];
        this.pageRectsDirty = true;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < this.total; i++) {
            const box = document.createElement('div');
            box.className = 'rl-comic-spage';
            box.setAttribute('data-index', String(i));
            // 页码角标（页面本身是图，用户需要一个「我在第几页」的锚点）
            const no = document.createElement('span');
            no.className = 'rl-comic-spage-no';
            no.textContent = String(i + 1);
            box.appendChild(no);
            frag.appendChild(box);
            this.pageBoxes.push(box);
        }
        col.appendChild(frag);
        this.viewH = col.clientHeight;
        for (let i = 0; i < this.pageBoxes.length; i++) this.applyPageBox(i);
    }

    /** 第 `i` 页占位块的**可用宽高**（容器内距与间距之外的空间；量不到就返回 0） */
    private scrollAvail(): { w: number; h: number } {
        const col = this.scrollEl;
        if (!col) return { w: 0, h: 0 };
        const cs = getComputedStyle(col);
        const num = (v: string): number => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
        };
        const w = col.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight);
        const h = col.clientHeight - num(cs.paddingTop) - num(cs.paddingBottom);
        return { w: Math.max(0, w), h: Math.max(0, h) };
    }

    /** 给第 `i` 页写占位宽高（`pageBox` 的薄封装；⛔ 这里不判「要不要 reload」） */
    private applyPageBox(i: number, ratio?: number): void {
        const box = this.pageBoxes[i];
        if (!box) return;
        const { w, h } = this.scrollAvail();
        const r = ratio ?? this.pageRatios.get(i) ?? PAGE_RATIO_FALLBACK;
        const size = pageBox(w, w * r, w, h, this.zoom, PAGE_RATIO_FALLBACK);
        box.style.width = `${size.width}px`;
        box.style.height = `${size.height}px`;
        box.setAttribute('data-h', String(size.height));
    }

    /** 全部页块按当前缩放/宽度重算（缩放、栏显隐、resize 时调用） */
    private reflowScrollPages(): void {
        for (let i = 0; i < this.pageBoxes.length; i++) this.applyPageBox(i);
        this.pageRectsDirty = true;
        this.armPageObserve();
    }

    /** 量各页顶部偏移（页块尺寸稳定 ⇒ 只在尺寸变化或插图后作废重算，⛔ 不每帧量） */
    private measurePageRects(): void {
        if (!this.pageRectsDirty && this.pageRects.length === this.pageBoxes.length) return;
        this.pageRects = this.pageBoxes.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
        this.pageRectsDirty = false;
    }

    /** 正文页的 IntersectionObserver：进入「视口 ± 1.5 屏」才解压，离开就撤图 */
    private armPageObserve(): void {
        const col = this.scrollEl;
        if (!col) return;
        this.viewH = col.clientHeight || this.viewH;
        const margin = Math.round(Math.max(200, this.viewH) * IO_MARGIN_RATIO);
        this.pageIO?.disconnect();
        this.pageIO = null;
        if (typeof IntersectionObserver !== 'function') {
            // 老环境兜底：直接按窗口补（宁多解几张，也别让正文空着）
            void this.loadScrollWindow();
            return;
        }
        this.pageIO = new IntersectionObserver(
            (entries) => {
                for (const en of entries) {
                    const idx = Number((en.target as HTMLElement).dataset.index);
                    if (!Number.isFinite(idx)) continue;
                    if (en.isIntersecting) void this.ensurePageImage(idx);
                    else this.unloadPageImage(idx);
                }
            },
            { root: col, rootMargin: `${margin}px 0px ${margin}px 0px`, threshold: 0 },
        );
        for (const box of this.pageBoxes) this.pageIO.observe(box);
    }

    /** 撤掉某页的 `<img>`（保留块高 ⇒ ⛔ 滚动位置不跳） */
    private unloadPageImage(i: number): void {
        const box = this.pageBoxes[i];
        if (!box) return;
        const img = box.querySelector('img');
        if (img) {
            if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
            img.remove();
        }
    }

    /** 按窗口兜底补图（无 IO 的环境）：当前页 ± `SCROLL_KEEP` */
    private async loadScrollWindow(): Promise<void> {
        for (const i of sortByDistance(this.pageBoxes.map((_, k) => k), this.pageIndex)) {
            if (Math.abs(i - this.pageIndex) > SCROLL_KEEP) continue;
            await this.ensurePageImage(i);
        }
    }

    /**
     * 解一页的图并插进占位块。
     *
     * 🔴 三条硬约束（都是踩过的坑）：
     *   ⑴ `decode()` 之后再插：`load` 触发时位图可能还没解码完 ⇒ 插进去先白一下（#540 同款）；
     *   ⑵ 插入**不改变块高**（`data-h` 撑住）：否则边滚边跳，缩略图同步也跟着抖；
     *   ⑶ 拿到真实纵横比后**只在那页还没显示时**校正一次块高（此时它在视野外，用户看不见抖动）。
     */
    private async ensurePageImage(i: number): Promise<void> {
        const box = this.pageBoxes[i];
        if (!box || box.dataset.loading === '1' || box.querySelector('img')) return;
        box.dataset.loading = '1';
        let blob: Blob | null = null;
        try {
            blob = await this.options.loadPage(i);
        } catch {
            blob = null;
        }
        box.dataset.loading = '';
        if (this.destroyed || this.viewMode !== 'scroll' || !this.scrollEl) return;
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.className = 'rl-comic-spage-img';
        img.alt = '';
        img.draggable = false;
        img.src = url;
        let ok = true;
        try {
            await img.decode();
        } catch {
            ok = img.naturalWidth > 0;
        }
        if (this.destroyed || this.viewMode !== 'scroll' || !this.scrollEl) {
            URL.revokeObjectURL(url);
            return;
        }
        if (!ok) {
            URL.revokeObjectURL(url);
            return;
        }
        // 记下真实纵横比：下次进连续模式 / resize 时占位就能一步到位
        if (img.naturalWidth > 0) {
            const r = img.naturalHeight / img.naturalWidth;
            this.pageRatios.set(i, r);
            const boxH = Number(box.getAttribute('data-h') || 0);
            const width = box.offsetWidth;
            if (width > 0 && Math.abs(Math.round(width * r) - boxH) > 2) {
                const size = pageBox(width, width * r, width, width * r, 1, PAGE_RATIO_FALLBACK);
                box.style.height = `${size.height}px`;
                box.setAttribute('data-h', String(size.height));
                this.pageRectsDirty = true;
            }
        }
        img.dataset.url = url;
        box.appendChild(img);
    }

    /**
     * 连续模式：滚动时**每帧**把「当前页」算出来（`pageAtViewport` 判据 = 覆盖视口中线的那页），
     * 同步底栏 / 缩略图高亮 / 缩略图栏位置 / 进度滑块 / `scrollRatio`；**补图另走防抖**。
     *
     * 🔴 为什么拆成两个节奏：同步是纯几何（每帧跑，用户要的是「跟手」）；
     *    补图要解压（重活），塞进每帧 = #642 那种「完全动不了」。防抖 60ms 后一次性补。
     */
    private onScrollView = (): void => {
        if (this.viewMode !== 'scroll' || !this.scrollEl) return;
        if (this.syncRaf === null) this.syncRaf = window.requestAnimationFrame(this.flushScrollSync);
        if (this.fillTimer !== null) window.clearTimeout(this.fillTimer);
        this.fillTimer = window.setTimeout(() => {
            this.fillTimer = null;
            if (this.destroyed || this.viewMode !== 'scroll') return;
            this.measurePageRects();
            if (typeof IntersectionObserver !== 'function') void this.loadScrollWindow();
            void this.fillThumbs();
        }, FILL_DEBOUNCE);
    };

    /** rAF 里的那一帧：几何同步（⛔ 这里不许有任何 await / 解压） */
    private flushScrollSync = (): void => {
        this.syncRaf = null;
        if (this.destroyed || this.viewMode !== 'scroll' || !this.scrollEl) return;
        const col = this.scrollEl;
        this.measurePageRects();
        const vh = col.clientHeight;
        if (vh > 0) this.viewH = vh;
        const idx = pageAtViewport(this.pageRects, col.scrollTop, vh);
        this.scrollRatio = scrollTopToRatio(col.scrollTop, col.scrollHeight, vh);
        if (idx !== this.pageIndex) {
            this.pageIndex = idx;
            this.scheduleSave();
            this.updateFooter();
            void this.fillThumbs();
        }
        this.syncThumbsActive();
        this.paintThumbSlider();
    };

    /** 立即同步一次（挂载 / 切换 / resize 用；不必等滚动事件） */
    private syncNow(): void {
        if (this.syncRaf !== null) {
            window.cancelAnimationFrame(this.syncRaf);
            this.syncRaf = null;
        }
        if (this.viewMode === 'scroll' && this.scrollEl) this.flushScrollSync();
        else {
            this.syncThumbsActive();
            this.paintThumbSlider();
        }
    }

    /**
     * 进入连续模式要做的事（挂载 / 切模式共用**一份**口径）。
     * 🔴 #669 修的就是这里：旧写法在 `setViewMode` 里 `buildScrollPages()` 调了**两次**，
     *    第二次 `col.empty()` 把第一批正在插图的 DOM 摘掉 ⇒ 图挂到孤儿节点上 = 整屏空白。
     */
    private async enterScrollMode(): Promise<void> {
        if (!this.scrollEl) return;
        this.scrollRestored = false;
        this.pageRectsDirty = true;
        this.armPageObserve();
        // 先等一帧让容器量到尺寸（挂载时 `.rl-reader-body` 可能还没排版完）
        await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        if (this.destroyed || this.viewMode !== 'scroll' || !this.scrollEl) return;
        this.viewH = this.scrollEl.clientHeight;
        this.reflowScrollPages();
        // 🔴 还原上次读到哪儿：先滚到「该页顶部」（占位块已按纵横比撑好 ⇒ 未加载也能滚到位），
        //    再按 `scrollRatio` 细调到页内比例。只做**一次**，之后不再自动把用户拽走。
        if (!this.scrollRestored) {
            this.scrollRestored = true;
            this.scrollPageIntoView(this.pageIndex, false, this.options.progress?.scrollRatio ?? 0);
        }
        this.syncNow();
        if (typeof IntersectionObserver !== 'function') await this.loadScrollWindow();
    }

    /** 把第 `i` 页滚进视线（`ratio` = 页内比例：0 顶部 / 0.5 中线） */
    private scrollPageIntoView(i: number, smooth = false, ratio = 0): void {
        const col = this.scrollEl;
        const box = this.pageBoxes[clampInt(i, 0, this.total - 1)];
        if (!col || !box) return;
        const top = restoreScrollTop(box.offsetTop, box.offsetHeight, col.clientHeight, ratio);
        if (smooth && typeof col.scrollTo === 'function') col.scrollTo({ top, behavior: 'smooth' });
        else col.scrollTop = top;
    }

    /** 按全书比例滚（进度滑块 / 轨道点击）：拖的是**正文**，不是栏 */
    private scrollToRatio(ratio: number, smooth = false): void {
        const col = this.scrollEl;
        if (!col) return;
        const top = ratioToScrollTop(ratio, col.scrollHeight, col.clientHeight);
        if (smooth && typeof col.scrollTo === 'function') col.scrollTo({ top, behavior: 'smooth' });
        else col.scrollTop = top;
        this.syncNow();
    }

    // ── 2026-10-23 用户指令：漫画书签 / 区域截图 ───────────────────────────────────

    /** 存书签：位置 = 「当前页（1 基）+ 页内比例」。
     *  🔴 漫画没有文本选区 ⇒ 书签只存位置（与 PDF 同口，`newBookmark` 的第 3 参 quote 不传）。 */
    private addBookmark(): void {
        const idx = this.pageIndex;
        const ratio = this.viewMode === 'scroll' ? this.scrollRatio : 0;
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        this.bookmarks = [...this.bookmarks, newBookmark(idx + 1, pct)];
        this.options.onBookmarksChange?.(this.bookmarks);
        this.bmBtnEl?.setAttribute('data-tip', `存书签· 已有 ${this.bookmarks.length} 个`);
        new Notice(`已存书签：第 ${idx + 1} 页 · ${pct}%`);
        this.buildComicBookmarks();
    }

    /** 区域截图：拖框 → 交矩形 + 定位给宿主（取像素 / 落盘 / 写笔记全在 `main.saveReaderShot`）。 */
    private startShot(): void {
        if (!this.options.onShotSave || this.shotOverlay) return;
        this.hideCtx();
        const host = this.viewMode === 'scroll' ? (this.scrollEl ?? this.stageEl) : this.stageEl;
        const idx = this.pageIndex;
        const ratio = this.viewMode === 'scroll' ? this.scrollRatio : 0;
        const overlay = new ShotOverlay(host, (rect) => {
            this.shotOverlay = null;
            this.options.onShotSave?.(rect, { page: idx + 1, pct: Math.round(Math.max(0, Math.min(1, ratio)) * 100) });
        }, () => {
            this.shotOverlay = null;
        });
        this.shotOverlay = overlay;
        overlay.start('拖拽框选要截图的区域 · Esc 取消');
    }

    /** 点到某页（缩略图格子 / 底栏翻页共用）：单页制换页，连续滚动滚到那一页 */
    private gotoPage(i: number): void {
        const next = clampInt(i, 0, this.total - 1);
        if (this.viewMode === 'scroll') {
            if (next === this.pageIndex) {
                this.scrollPageIntoView(next, true);
                return;
            }
            this.pageIndex = next;
            this.updateFooter();
            this.scheduleSave();
            this.scrollPageIntoView(next, true);
            this.syncNow();
            return;
        }
        this.goto(next);
    }

    /**
     * 切换阅读模式（设置菜单里一档）。
     * 🔴 两个容器**都重建**（不是切换 `display`）：连续模式的页块与单页制的 stage 结构本就不同，
     *    藏起来那份会一直挂在 DOM 里（200 个占位块白占内存）。
     */
    private setViewMode(m: ComicViewMode): void {
        const next = normalizeComicViewMode(m);
        if (next === this.viewMode) return;
        // 🔴 #676：切模式会**丢掉当前容器里的滚动位置**（旧 body 整个删掉重建）⇒ 先把进度存一次，
        //    否则用户在连续滚动里读到一半切到单页，再关标签页，落库的还是切模式**之前**那一次。
        this.options.onSaveProgress({ chapterIndex: this.pageIndex, scrollRatio: this.saveRatio() });
        this.viewMode = next;
        this.revokeUrl();
        this.nextBlob = null;
        this.pageIO?.disconnect();
        this.pageIO = null;
        this.thumbIO?.disconnect();
        this.thumbIO = null;
        // 拆掉旧容器（连同缩略图栏 —— 它在 `.rl-comic-main-row` 下，重建后要重新挂）
        // 🔴 2026-10-25：结构同构化后，正文与缩略图栏都在 `main > .rl-comic-main-row` 里；
        //    这里整行重建（而不是只删 body），避免旧 row 残留。
        const main = this.container.querySelector('.rl-reader-main') as HTMLElement | null;
        if (main) {
            const oldBody = main.querySelector('.rl-comic-main-row');
            oldBody?.remove();
            this.thumbsEl?.remove();
            this.thumbsEl = null;
            this.trackEl = null;
            this.thumbSliderEl = null;
            this.thumbCells.clear();
            this.thumbDone.clear();
            this.pageBoxes = [];
            this.pageRects = [];
            this.pageRectsDirty = true;
            // 🔴 #676：单页舞台的页图是**显式像素宽**（`fitWidth` 读舞台尺寸）；从连续滚动切过来时
            //    `imgEl` 可能是连续模式留下的旧引用、`placeholderEl` 也可能还挂着 ⇒ 一并清掉，
            //    否则 `renderPage` 认为「已经有一张图/一句占位」而跳过换位，看起来就是「点了没反应」。
            this.imgEl = null;
            this.placeholderEl = null;
            this.currentUrl = null;
            // 🔴 新 row 必须插在**底栏之前**（底栏现在是 `main` 的最后一个子项，`appendChild` 会把
            //    正文排到底栏下面 ⇒ 底栏跑到屏幕中间）。
            const row = main.createDiv({ cls: 'rl-comic-main-row' });
            const foot = main.querySelector(':scope > .rl-reader-footer');
            if (foot) main.insertBefore(row, foot);
            if (this.viewMode === 'scroll') {
                this.scrollEl = row.createDiv({ cls: 'rl-comic-scroll' });
                this.stageEl = this.scrollEl;
            } else {
                this.scrollEl = null;
                this.stageEl = row.createDiv({ cls: 'rl-comic-stage' });
            }
            // 新 row 建好后再挂缩略图栏（它必须排在正文之后）
            if (this.thumbsOn) this.mountThumbs(row);
        }
        // 新容器要挂回旧的监听（stage 是新建的 ⇒ 上一份监听随旧节点一起没了）
        this.stageEl.addEventListener('click', this.onBodyClick);
        this.stageEl.addEventListener('wheel', this.onWheel, { passive: false });
        this.stageEl.addEventListener('contextmenu', this.onStageContextMenu);
        // 缩略图栏已在上面 `main > .rl-comic-main-row` 内挂好（⛔ 别在这里再挂一次到 main：
        //  main 现在是 column，挂进去会变成「正文 / 栏 / 底栏」上下堆叠 —— 正是 #671 的形态）。
        this.options.onViewModeChange?.(this.viewMode);
        this.syncSettingsLabels();
        // 🔴🔴 #676：分段高亮已在 `syncSettingsLabels()` 里统一刷新（它由上面一行调用），
        //    这里⛔ 不再重复 —— 同一件事两个刷点就是「一处改了另一处忘」的老坑。
        // 🔴 #669：`buildScrollPages` 只在**这里**建一次（旧写法还多调了一次，第二次 `empty()` 会把
        //    正在插图的块全摘掉 ⇒ 图挂到孤儿节点 = 整屏空白）。建完后统一走 `enterScrollMode`。
        if (this.viewMode === 'scroll') {
            this.scrollEl?.addEventListener('scroll', this.onScrollView, { passive: true });
            this.buildScrollPages();
            void this.enterScrollMode();
        } else {
            void this.renderPage();
        }
        // 2026-10-23：自动推进的两条实现（连续 rAF / 单页定时器）不通用 ⇒ 切模式后重挂
        this.restartAutoIfOn();
    }

    /** 右键菜单：看原文件名（参考仓 v1.0.4）。菜单挂在容器里，点空白 / Esc 收起。 */
    private onStageContextMenu = (ev: MouseEvent): void => {
        const name = this.options.pageName?.(this.pageIndex);
        if (!name) return; // 宿主没给取名能力 ⇒ 放行系统菜单（⛔ 别弹一个空白菜单）
        ev.preventDefault();
        this.hideCtx();
        const menu = this.container.createDiv({ cls: 'rl-comic-ctx' });
        this.ctxEl = menu;
        menu.createDiv({ cls: 'rl-comic-ctx-fn', text: baseNameOf(name) });
        const copy = menu.createEl('button', { cls: 'rl-comic-ctx-it', attr: { type: 'button' }, text: '复制图像' });
        copy.addEventListener('click', () => void this.copyCurrentImage());
        // 定位：跟着鼠标，但**夹在容器内**（否则右/下边缘会溢出）
        const rect = this.container.getBoundingClientRect();
        const w = menu.offsetWidth || 200;
        const h = menu.offsetHeight || 60;
        menu.style.left = `${Math.max(4, Math.min(ev.clientX - rect.left, rect.width - w - 4))}px`;
        menu.style.top = `${Math.max(4, Math.min(ev.clientY - rect.top, rect.height - h - 4))}px`;
    };

    private hideCtx(): void {
        this.ctxEl?.remove();
        this.ctxEl = null;
    }

    /** 复制当前页图像到剪贴板（参考仓 v1.0.4）。失败给一句提示，⛔ 不静默 */
    private async copyCurrentImage(): Promise<void> {
        this.hideCtx();
        try {
            const blob = await this.options.loadPage(this.pageIndex);
            if (!blob) return;
            // ⚠️ 剪贴板只认 PNG（`ClipboardItem` 对 image/jpeg 支持不一致，实测 Chrome 系列最稳的是 png）
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            const png: Blob | null = await new Promise((r) => canvas.toBlob((b) => r(b), 'image/png'));
            if (!png) return;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        } catch {
            // 剪贴板 API 在部分环境被禁（无权限 / 非安全上下文）⇒ 静默失败会让用户以为按钮坏了，
            // 但这里没有 Notice 通道（面板不持 app）⇒ 用面板内的一句轻提示
            this.toast('复制失败（剪贴板不可用）');
        }
    }

    /** 面板内轻提示（2 秒后自散；漫画面板原本没有 Notice 通道） */
    private toast(text: string): void {
        const el = this.container.createDiv({ cls: 'rl-comic-toast', text });
        window.setTimeout(() => el.remove(), 2000);
    }

    private buildFooter(): void {
        // 🔴🔴 2026-10-25 用户：「侧边栏不要悬浮遮挡底部栏，而是把底部栏（及主内容区）整体往右推挤，
        //    底部栏的宽度自适应缩减」。
        //    ⇒ 底栏挂到 `.rl-reader-main`（column）**内部**——与 TXT/EPUB/PDF 完全同构：
        //      `.rl-reader-body`(row) > [ `.rl-reader-toc`(左列), `.rl-reader-main`(column) > [正文, 底栏] ]
        //      目录因此是独立一整列，底栏被推到它右侧、宽度随 main 缩短。
        //    ⛔ 不许再挂回 `this.container`（= `.rl-reader`）：那样底栏 width:100% 会从目录下方
        //      横跨全宽 —— 正是用户这次报障的「侧边栏没把底部栏隔开」。
        //    ⚠️ 历史 #675 记载的「底栏挂 `.rl-reader`」是旧结构（main 曾是 row）下的权宜之计，
        //      当时挂进 main 会变成横排第三列；现在 main 恢复 column，那条约束自然失效。
        const main = this.container.querySelector('.rl-reader-main') as HTMLElement | null;
        const footer = (main ?? this.container).createDiv({ cls: 'rl-reader-footer' });
        this.footEl = footer;

        const navL = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-l' });
        const prev = navL.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(prev, 'chevron-left');
        prev.setAttribute('data-tip', '上一页');
        prev.addEventListener('click', () => this.go(-1));

        this.footerPageEl = footer.createSpan({ cls: 'rl-reader-fch' });
        const prog = footer.createDiv({ cls: 'rl-reader-fprog' });
        this.footerFillEl = prog.createDiv({ cls: 'rl-reader-fprog-fill' });
        this.footerPctEl = footer.createSpan({ cls: 'rl-reader-fpct' });

        // 图标组：全屏 / 沉浸 / 自动（2026-10-23 补上自动推进 ⇒ 四件底栏至此完全对齐）
        const fops = footer.createDiv({ cls: 'rl-reader-fops' });
        const mkFop = (icon: string, tip: string, onClick: () => void): HTMLButtonElement => {
            const b = fops.createEl('button', { cls: 'rl-btn rl-reader-btn' });
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', tip);
            b.addEventListener('click', onClick);
            return b;
        };
        this.fsBtnEl = mkFop('maximize', '全屏显示', () => this.toggleFullscreen());
        // 🔴 #603：沉浸 / 自动两条提示都走**四件共用**的真源 `pure/readerFops`
        this.immersiveBtnEl = mkFop('eye', READER_FOPS.immersive, () => this.setImmersive(!this.immersive));
        // 单击 = 开/关；右键 = 调速度（连续模式 px/s、单页模式翻页间隔 ms）
        this.autoBtnEl = mkFop('timer', READER_FOPS.autoScrollPaged, () => this.setAuto(!this.autoOn));
        this.autoBtnEl.addEventListener('contextmenu', (ev) => this.openAutoMenu(ev));
        if (!document.fullscreenEnabled) {
            this.fsBtnEl.disabled = true;
            this.fsBtnEl.setAttribute('data-tip', '当前环境不支持全屏');
        }

        const navR = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-r' });
        const next = navR.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(next, 'chevron-right');
        next.setAttribute('data-tip', '下一页');
        next.addEventListener('click', () => this.go(1));
    }

    private registerKeys(): void {
        const onNext = (): boolean => {
            this.go(1);
            return false;
        };
        const onPrev = (): boolean => {
            this.go(-1);
            return false;
        };
        this.scope.register([], 'ArrowRight', onNext);
        this.scope.register([], 'ArrowDown', onNext);
        this.scope.register([], 'PageDown', onNext);
        this.scope.register([], 'ArrowLeft', onPrev);
        this.scope.register([], 'ArrowUp', onPrev);
        this.scope.register([], 'PageUp', onPrev);
        this.scope.register([], 'Home', () => {
            this.goto(0);
            return false;
        });
        this.scope.register([], 'End', () => {
            this.goto(this.total - 1);
            return false;
        });
        this.scope.register([], '=', () => {
            this.applyZoom(this.zoom + ZOOM_STEP);
            return false;
        });
        this.scope.register([], '+', () => {
            this.applyZoom(this.zoom + ZOOM_STEP);
            return false;
        });
        this.scope.register([], '-', () => {
            this.applyZoom(this.zoom - ZOOM_STEP);
            return false;
        });
    }

    // ── 交互事件 ──────────────────────────────────────────────────────────────

    private onDocMouseDown = (): void => {
        this.hideSettings();
        // 🔴 #636：右键菜单同样「点空白收起」（与设置菜单同一条口径）
        this.hideCtx();
        // 2026-10-23：自动推进的调速浮层同样点空白收起
        this.hideAutoPop();
    };

    private hideAutoPop(): void {
        this.popEl?.remove();
        this.popEl = null;
    }

    private onFsChange = (): void => {
        this.syncViewBtns();
    };

    /** 舞台点击：沉浸模式下收起 / 展开上下边栏 */
    private onBodyClick = (): void => {
        if (!this.immersive) return;
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) return;
        this.toggleBars();
    };

    /**
     * 滚轮按模式分流（🔴 #669，用户 2026-10-19 裁定「滚轮自由滚」）：
     *   · **连续滚动**：滚轮 = 滚动（⛔ 不 `preventDefault`、⛔ 不翻页 —— 旧写法把它拦去翻页，
     *     与「连续滚动」自相矛盾，是用户说「连续滚动效果没加回来」的直接原因之一）；
     *     `Ctrl/⌘ + 滚轮` = 缩放（拦下来，别让宿主去缩整个工作区）；
     *     容器滚到头时**放行**给外层，免得在卷首/卷尾「滚不动」像卡死。
     *   · **单页制**：保持 #537 的行为 —— 滚轮翻页（累计阈值 + 冷却，防触控板连翻）；
     *     `Ctrl/⌘ + 滚轮` 同样是缩放（拦下来）。
     */
    private onWheel = (ev: WheelEvent): void => {
        // ① 缩放档：两种模式都拦（缩放要吃掉这次滚轮，⛔ 否则同时翻页/滚动）
        if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            this.zoomByWheel(ev.deltaY);
            return;
        }
        // ② 连续滚动：交给容器自己滚
        if (this.viewMode === 'scroll') {
            const col = this.scrollEl;
            if (!col) return;
            const d = wheelDeltaOf(ev as unknown as { deltaY: number; deltaX?: number; deltaMode?: number; shiftKey?: boolean });
            const nextTop = col.scrollTop + d.dy;
            const nextLeft = col.scrollLeft + d.dx;
            const maxTop = col.scrollHeight - col.clientHeight;
            const maxLeft = col.scrollWidth - col.clientWidth;
            const clampedTop = Math.max(0, Math.min(maxTop, nextTop));
            const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
            // 还能滚就自己滚（并拦下，别让宿主的滚轮处理器再来一次）
            if (Math.abs(clampedTop - nextTop) < 0.5 || Math.abs(clampedLeft - nextLeft) < 0.5) {
                ev.preventDefault();
                col.scrollTop = clampedTop;
                col.scrollLeft = clampedLeft;
            }
            // 滚到头 ⇒ 不拦，交回外层（放行是「滚不动」与「卡死」的分界）
            return;
        }
        // ③ 单页制：滚轮翻页
        ev.preventDefault();
        const now = Date.now();
        if (now - this.wheelAt < WHEEL_COOLDOWN) return;
        this.wheelAcc += ev.deltaY;
        if (Math.abs(this.wheelAcc) < WHEEL_THRESHOLD) return;
        const dir = this.wheelAcc > 0 ? 1 : -1;
        this.wheelAcc = 0;
        this.wheelAt = now;
        this.go(dir);
    };

    private toggleSettings(): void {
        if (!this.menuEl) return;
        this.settingsOpen = !this.settingsOpen;
        this.menuEl.toggleClass('hidden', !this.settingsOpen);
        this.settingsBtn?.toggleClass('active', this.settingsOpen);
        if (this.settingsOpen) {
            this.syncSettingsLabels();
            this.syncThemeSwatches();
            this.syncViewBtns();
        }
    }

    private hideSettings(): void {
        if (!this.settingsOpen) return;
        this.settingsOpen = false;
        this.menuEl?.addClass('hidden');
        this.settingsBtn?.removeClass('active');
    }

    // ── 翻页 / 缩放 / 渲染 ────────────────────────────────────────────────────

    /**
     * 相对翻页（越界钳制；到达边界不保存——位置没变）。
     * 🔴 #669：连续滚动下底栏 / 方向键的「上/下一页」改成**滚到那一页**（`gotoPage`），
     *    ⛔ 不能再走单页制的 `renderPage`（那会在滚动容器里换掉一张图，连续模式里没有这张图）。
     */
    private go(delta: number): void {
        if (this.viewMode === 'scroll') {
            this.gotoPage(this.pageIndex + delta);
            return;
        }
        this.goto(this.pageIndex + delta);
    }

    private goto(index: number): void {
        const next = clampInt(index, 0, Math.max(0, this.total - 1));
        if (next === this.pageIndex && this.imgEl) return;
        this.pageIndex = next;        // 🔴 #540：⛔ 不在这里清滚动 —— 此刻画面上还是**上一页**，清了就是一次可见的跳动。
        //    新页就位后由 `applyZoom` 归零（换位与归零同帧，用户看不到中间的旧页）。
        void this.renderPage();
        this.scheduleSave();
        // 🔴🔴 #683（用户 2026-10-19：「翻页模式下点击缩略图无高亮边框」）：
        //    **换页后必须刷新缩略图栏**（高亮 + 跟随 + 滑块）。
        //    原来这条路只调 `renderPage()` —— 而 `syncThumbsActive()` 只有点击 handler 之外的
        //    少数几个地方会走到，于是「点着翻页」时高亮框一格都不动（连续模式因为每帧 rAF 会刷，才正常，
        //    这就是「同一套逻辑两种表现」的原因）。
        //    ⇒ 统一在**换页的唯一出口**这里刷一次，两种模式都不会漏。
        this.syncNow();
        void this.fillThumbs();
    }

    /**
     * 适屏基准宽（contain）：同时受舞台**可用宽**与**可用高**约束，按原始纵横比取小者。
     * 🔴 为什么必须有这一步：原本只写 `width:100%` + `max-height:100%`，浏览器压的是**高度**、
     *    宽度仍钉在 100% ⇒ 竖版漫画页被横向**拉伸**（用户 2026-10-05 报障「默认是拉伸的」）。
     *    改成「算好基准宽 × 缩放 = 显式像素宽 + `height:auto`」后纵横比恒定不变。
     * ⚠️ 舞台未测量到尺寸（display:none / 未排版）时回落图片自然宽 —— 至少不拉伸。
     */
    private fitWidth(img: HTMLImageElement): number {
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        if (!nw || !nh) return 0;
        const cs = getComputedStyle(this.stageEl);
        const num = (v: string): number => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
        };
        const availW = Math.max(0, this.stageEl.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight));
        const availH = Math.max(0, this.stageEl.clientHeight - num(cs.paddingTop) - num(cs.paddingBottom));
        if (availW <= 0 || availH <= 0) return nw;
        return nw * Math.min(availW / nw, availH / nh);
    }

    /**
     * 应用缩放（钳制 0.5~4；1× = **整页适屏 contain**，>1× 溢出舞台 → 用容器滚动平移）；缺参 = 按当前档重算。
     *
     * 🔴 #669：连续滚动也走这里（页块宽高按 `pageBox` 重算）。两种模式都**保住当前页**：
     *    缩放后把当前页重新摆回视野 —— 否则放大一下就被甩到别的页去了。
     */
    private applyZoom(z: number = this.zoom): void {
        this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z / ZOOM_STEP) * ZOOM_STEP));
        this.syncSettingsLabels();
        if (this.viewMode === 'scroll') {
            if (!this.scrollEl) return;
            const keep = this.pageIndex;
            this.reflowScrollPages();
            this.scrollPageIntoView(keep, false, this.scrollRatio);
            this.syncNow();
            return;
        }
        const img = this.imgEl;
        if (img) {
            const base = this.fitWidth(img) || img.naturalWidth || 0;
            if (base > 0) {
                // 显式像素宽 + `height:auto` ⇒ 纵横比恒定；⛔ 不设 max-width/max-height（那正是拉伸的成因）
                img.style.width = `${Math.max(1, Math.round(base * this.zoom))}px`;
                img.style.height = 'auto';
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
            }
        }
        this.stageEl.scrollTop = 0;
        this.stageEl.scrollLeft = 0;
    }

    /**
     * `Ctrl/⌘ + 滚轮` 缩放（用户 2026-10-19 裁定：「支持 ctrl+鼠标缩放」）—— 两种模式都支持。
     * 档位吸附与 `applyZoom` 同源（`zoomAfterWheel` 是纯函数，单测锁着）。
     */
    private zoomByWheel(deltaY: number): void {
        const next = zoomAfterWheel(this.zoom, deltaY, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP);
        if (next === this.zoom) return;
        this.applyZoom(next);
    }

    private syncSettingsLabels(): void {
        const pct = Math.round(this.zoom * 100);
        if (this.menuZoomVal) this.menuZoomVal.setText(`${pct}%`);
        if (this.menuZoomSlider) this.menuZoomSlider.value = String(pct);
        // 🔴 #676：模式分段的选中态也在这里统一刷（它与缩放/主题同属「设置菜单里的当前值」）。
        //    ⛔ 别只在点击处理里刷 —— 设置页下拉 / 载入时的初始值就没机会刷新了。
        this.syncModeSegs();
    }

    private syncThemeSwatches(): void {
        for (const meta of READER_THEMES) this.themeSwatches[meta.id]?.toggleClass('is-on', meta.id === this.theme);
    }

    private syncViewBtns(): void {
        this.fsBtnEl?.toggleClass('rl-quick-active', !!document.fullscreenElement);
        if (this.fsBtnEl) this.fsBtnEl.setAttribute('data-tip', document.fullscreenElement ? '退出全屏' : '全屏显示');
        this.immersiveBtnEl?.toggleClass('rl-quick-active', this.immersive);
        // 2026-10-23：自动推进按钮常显在底栏 ⇒ 状态同步不带设置菜单门（同 PDF #382 那处）
        this.autoBtnEl?.toggleClass('rl-quick-active', this.autoOn);
    }

    // ── 2026-10-23 用户指令：底栏「自动滚动功能」四件统一 ──────────────────────
    //   · 连续模式（scroll）⇒ rAF 匀速滚动，速度 px/s，右键弹窗调速
    //   · 单页模式（single）⇒ 无滚动可言，只能定时翻页，间隔 ms，右键弹窗调间隔
    //   ⛔ 两条实现都直接复用 `pure/readerAuto`，别在漫画里另写一套。

    /** 开关自动推进（再点停）；两条实现按当前视图模式二选一 */
    private setAuto(on: boolean): void {
        if (on === this.autoOn) return;
        this.stopAuto();
        if (on) {
            this.autoOn = true;
            if (this.viewMode === 'scroll') this.startAutoScroll();
            else this.startAutoTimer();
        }
        this.syncViewBtns();
    }

    /** 视图模式切换后重挂（rAF 与定时器不通用） */
    private restartAutoIfOn(): void {
        if (!this.autoOn) return;
        this.stopAuto();
        this.autoOn = true;
        if (this.viewMode === 'scroll') this.startAutoScroll();
        else this.startAutoTimer();
    }

    /** 连续模式的自动滚动：按时间增量推进浮点位置（`advanceAutoPos`），再写回 scrollTop */
    private startAutoScroll(): void {
        if (this.autoRaf !== null) return;
        this.autoLastTs = 0;
        const tick = (ts: number): void => {
            this.autoRaf = null;
            if (!this.autoOn || this.destroyed) return;
            const el = this.scrollEl;
            if (!el) return;
            // 🔴 dt 的单位必须是**秒**：`advanceAutoPos(pos, speed, dt, max)` 算的是 `speed * dt`，
            //   而 `autoScrollPx` 是 **px/秒** ⇒ 传毫秒会把速度放大 1000 倍（实测：一帧直接冲到
            //   底部 8462px，随即触发「已读完全书」自动停机，看起来像「按钮点了没反应」）。
            //   夹 0.1 秒：切标签页回来 `ts` 差会很大，不夹会瞬移一大截。
            const dt = this.autoLastTs > 0 ? Math.min(0.1, (ts - this.autoLastTs) / 1000) : 0;
            this.autoLastTs = ts;
            if (this.autoPos === null) this.autoPos = el.scrollTop;
            const max = Math.max(0, el.scrollHeight - el.clientHeight);
            const next = advanceAutoPos(this.autoPos, this.autoScrollPx, dt, max);
            this.autoPos = next;
            el.scrollTop = next;
            // 滚到底 ⇒ 自动停（与 TXT 连续模式同一口径：到底就停，不循环）
            if (max > 0 && next >= max - 0.5) {
                this.stopAuto();
                this.syncViewBtns();
                new Notice('已读完全书');
                return;
            }
            this.autoRaf = window.requestAnimationFrame(tick);
        };
        this.autoRaf = window.requestAnimationFrame(tick);
    }

    /** 单页模式的自动翻页：定时 `go(1)`，到末页自动停 */
    private startAutoTimer(): void {
        if (this.autoTimer !== null) return;
        this.autoTimer = window.setInterval(() => {
            if (!this.autoOn || this.destroyed) return;
            if (this.pageIndex >= this.total - 1) {
                this.stopAuto();
                this.syncViewBtns();
                new Notice('已读完全书');
                return;
            }
            this.goto(this.pageIndex + 1);
        }, this.autoTurnMs);
    }

    /** 停止自动推进（清 rAF 与定时器 + 复位开关） */
    private stopAuto(): void {
        this.autoOn = false;
        this.autoPos = null; // 下次开自动重新与真实位置对表
        if (this.autoRaf !== null) {
            window.cancelAnimationFrame(this.autoRaf);
            this.autoRaf = null;
        }
        if (this.autoTimer !== null) {
            window.clearInterval(this.autoTimer);
            this.autoTimer = null;
        }
    }

    /**
     * 右键弹窗：按当前模式给「速度（px/s）」或「翻页间隔（ms）」。
     * ⛔ 连续模式别给 ms、单页模式别给 px/s —— 对另一种实现毫无意义。
     */
    private openAutoMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.autoBtnEl;
        if (!btn) return;
        this.hideSettings();
        this.hideAutoPop();
        const wrap = this.container.createDiv({ cls: 'rl-reader-pop rl-reader-pop-up' });
        this.popEl = wrap;
        wrap.addEventListener('mousedown', (e) => e.stopPropagation());
        const rect = btn.getBoundingClientRect();
        const base = this.container.getBoundingClientRect();
        wrap.style.left = `${Math.max(4, rect.left - base.left)}px`;
        wrap.style.bottom = `${Math.max(4, base.bottom - rect.top + 6)}px`;
        if (this.viewMode === 'scroll') {
            wrap.createDiv({ cls: 'rl-reader-pop-title', text: '滚动速度' });
            const line = wrap.createDiv({ cls: 'rl-reader-menu-row' });
            const slider = line.createEl('input', {
                cls: 'rl-reader-menu-slider',
                attr: {
                    type: 'range',
                    min: String(AUTO_SCROLL_MIN),
                    max: String(AUTO_SCROLL_MAX),
                    step: String(AUTO_SCROLL_STEP),
                    value: String(this.autoScrollPx),
                    'data-tip': '拖动调整滚动速度',
                },
            });
            const val = line.createSpan({ cls: 'rl-reader-menu-val', text: autoSpeedLabel(this.autoScrollPx) });
            slider.addEventListener('input', () => val.setText(autoSpeedLabel(Number(slider.value))));
            slider.addEventListener('change', () => {
                this.autoScrollPx = clampAutoScrollPx(Number(slider.value));
                saveAutoScrollPx(this.autoScrollPx);
                val.setText(autoSpeedLabel(this.autoScrollPx));
            });
            return;
        }
        wrap.createDiv({ cls: 'rl-reader-pop-title', text: '翻页间隔' });
        const line = wrap.createDiv({ cls: 'rl-reader-menu-row' });
        const slider = line.createEl('input', {
            cls: 'rl-reader-menu-slider',
            attr: {
                type: 'range',
                min: String(AUTO_TURN_MIN_MS),
                max: String(AUTO_TURN_MAX_MS),
                step: String(AUTO_TURN_STEP_MS),
                value: String(this.autoTurnMs),
                'data-tip': '拖动调整翻页间隔',
            },
        });
        const val = line.createSpan({ cls: 'rl-reader-menu-val', text: autoTurnLabel(this.autoTurnMs) });
        slider.addEventListener('input', () => val.setText(autoTurnLabel(Number(slider.value))));
        slider.addEventListener('change', () => {
            this.autoTurnMs = clampAutoTurnMs(Number(slider.value));
            val.setText(autoTurnLabel(this.autoTurnMs));
            // 已在自动翻页中 ⇒ 立刻按新间隔重排
            if (this.autoOn && this.autoTimer !== null) {
                window.clearInterval(this.autoTimer);
                this.autoTimer = null;
                this.startAutoTimer();
            }
        });
    };

    private setTheme(t: ReaderThemeId): void {
        this.theme = normalizeReaderTheme(t);
        this.applyTheme();
        this.syncThemeSwatches();
        this.options.onThemeChange?.(this.theme);
    }

    private applyTheme(): void {
        for (const meta of READER_THEMES) {
            const cls = readerThemeClass(meta.id);
            if (cls) this.container.removeClass(cls);
        }
        const cls = readerThemeClass(this.theme);
        if (cls) this.container.addClass(cls);
    }

    private setImmersive(on: boolean): void {
        if (on === this.immersive) return;
        this.immersive = on;
        this.container.toggleClass('rl-reader-focus', on);
        this.headEl?.toggleClass('hidden', on);
        this.footEl?.removeClass('rl-foot-show');
        this.syncViewBtns();
    }

    private toggleBars(): void {
        if (!this.immersive || !this.headEl) return;
        if (this.headEl.hasClass('hidden')) {
            this.headEl.removeClass('hidden');
            this.footEl?.addClass('rl-foot-show');
        } else {
            this.headEl.addClass('hidden');
            this.footEl?.removeClass('rl-foot-show');
            this.hideSettings();
        }
    }

    private toggleFullscreen(): void {
        try {
            if (document.fullscreenElement) {
                void document.exitFullscreen?.().catch(() => {});
            } else {
                const target = (this.container.closest('.modal') ?? this.container) as HTMLElement | null;
                void target?.requestFullscreen?.().catch(() => {});
            }
        } catch {
            // 全屏不可用：静默
        }
    }

    private revokeUrl(): void {
        if (this.currentUrl) {
            URL.revokeObjectURL(this.currentUrl);
            this.currentUrl = null;
        }
    }

    /** 取第 `i` 页图（命中预取槽就不必再解压；读失败 → `null`，不抛） */
    /**
     * 取一页的 Blob。
     *
     * 🔴🔴 #683（用户 2026-10-19：「缩略图和正文要**全部加载缓存下来再阅读**啊」）：
     *   面板层加一张**按页的 Blob 缓存**（有上限），正文与缩略图**共用**它 ⇒ 同一页只取一次。
     *   · 打开后后台**顺序预热**（见 `warmAllPages`），用户翻到哪页基本都已就绪；
     *   · 上限按**条数**（`PAGE_CACHE_MAX`）：一页几百万字节，条数比字节好算，且宿主侧
     *     （`main.openComicArchive` / `unpackEpub.loadBinary`）本来就有 64MB 的字节级 LRU 兜底。
     *   ⛔ 不在面板里整包预解压 —— 那会把 200 页 × 数 MB 全压进内存（#642 的老坑）。
     */
    private async loadBlob(i: number): Promise<Blob | null> {
        const hit = this.pageBlobs.get(i);
        if (hit) {
            this.touchPageBlob(i, hit);
            return hit;
        }
        const inflight = this.pageBlobLoading.get(i);
        if (inflight) return inflight;
        const task = (async (): Promise<Blob | null> => {
            try {
                // 下一页预取（单槽）优先消费，省一次取图
                if (this.nextBlob && this.nextBlob.index === i) {
                    const b = this.nextBlob.blob;
                    this.nextBlob = null;
                    this.putPageBlob(i, b);
                    return b;
                }
                const b = await this.options.loadPage(i);
                if (b) this.putPageBlob(i, b);
                return b;
            } catch {
                return null;
            } finally {
                this.pageBlobLoading.delete(i);
            }
        })();
        this.pageBlobLoading.set(i, task);
        return task;
    }

    /** 写缓存 + 按 LRU 上限淘汰（Map 的插入序即 LRU 序） */
    private putPageBlob(i: number, blob: Blob): void {
        if (this.destroyed) return;
        if (this.pageBlobs.has(i)) this.pageBlobs.delete(i);
        this.pageBlobs.set(i, blob);
        while (this.pageBlobs.size > PAGE_CACHE_MAX) {
            const oldest = this.pageBlobs.keys().next().value as number | undefined;
            if (oldest === undefined) break;
            this.pageBlobs.delete(oldest);
        }
    }

    /** 命中即刷新 LRU 位置（不重新插入值，只调顺序） */
    private touchPageBlob(i: number, blob: Blob): void {
        this.pageBlobs.delete(i);
        this.pageBlobs.set(i, blob);
    }

    /**
     * 后台**顺序预热**全书的图（用户要求「全部加载缓存下来再阅读」）。
     * · 一页一页来（`await`），每页之后让出一帧 —— ⛔ 不能并发轰炸：宿主那边每次取图都要解压；
     * · 用户滚走 / 关掉立即停（`destroyed` 检查 + 每轮重取当前页，优先补视野附近）；
     * · **不抢当前页**：先等 `pageIndex` 那一页有图，再按「离当前页距离」由近到远铺开。
     * ⚠️ 这条链只写 `pageBlobs`，不碰 DOM ⇒ 不会引起重排 / 闪烁。
     */
    private async warmAllPages(): Promise<void> {
        if (this.destroyed) return;
        const order = sortByDistance(
            Array.from({ length: this.total }, (_, i) => i),
            this.pageIndex,
        );
        for (const i of order) {
            if (this.destroyed) return;
            if (this.pageBlobs.has(i)) continue;
            await this.loadBlob(i);
            // 每页让出一帧：让滚动 / 输入事件先跑（否则预热会把人卡住）
            await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
        }
    }

    /** 静默预取下一页（不阻塞当前页渲染；结果过期/已翻过就丢弃） */
    private async prefetchNext(): Promise<void> {
        const i = this.pageIndex + 1;
        if (this.destroyed || i >= this.total || this.nextBlob?.index === i) return;
        const blob = await this.loadBlob(i);
        // 期间用户可能已翻走 / 关掉面板 ⇒ 这份预取作废（⛔ 别把旧页塞进槽里害下次翻页串页）
        if (this.destroyed || this.pageIndex >= i) return;
        this.nextBlob = blob ? { index: i, blob } : null;
    }

    /**
     * 渲染当前页：取图 → blob URL → **等解码完成再换位**。
     * 🔴 #540「翻页闪屏」的成因：旧实现先 `replaceWith`、再等 `load` —— 新 `<img>` 尚未解码时是 0×0，
     *    旧页又已从 DOM 摘掉 ⇒ 舞台上只剩背景色，肉眼就是一次**白闪**。现在旧页在换位前**一直可见**。
     */
    private async renderPage(): Promise<void> {
        const seq = ++this.loadSeq;
        // 🔴🔴 #676：切模式后这里**一次都不执行**的话，单页舞台就是空的（用户看到的「点了没反应」）。
        //    两道保险：⑴ 这里先画占位（异步取图前舞台至少有个字）；
        //    ⑵ 取图回来后再补一次 —— 切模式那一刻舞台可能还没排版（`clientWidth === 0`），
        //        `mountWhenMeasurable` 只保证 `mount()` 的时机，切模式是**运行中**发生的。
        if (!this.imgEl && !this.placeholderEl) this.showPlaceholder('正在加载…');
        const blob = await this.loadBlob(this.pageIndex);
        if (this.destroyed || seq !== this.loadSeq) return;
        if (!blob) {
            this.showPlaceholder('这一页加载失败');
            return;
        }
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.className = 'rl-comic-img';
        img.alt = '';
        img.draggable = false;
        img.src = url;
        // `decode()` 比 `load` 更贴近「可上屏」：load 触发时位图可能还没解码完，换位仍会闪一下
        let ok = true;
        try {
            await img.decode();
        } catch {
            ok = img.naturalWidth > 0;
        }
        if (this.destroyed || seq !== this.loadSeq) {
            URL.revokeObjectURL(url);
            return;
        }
        if (!ok) {
            URL.revokeObjectURL(url);
            this.showPlaceholder('这一页加载失败');
            return;
        }
        const oldImg = this.imgEl;
        const oldUrl = this.currentUrl;
        this.clearPlaceholder();
        if (oldImg) oldImg.replaceWith(img);
        else this.stageEl.appendChild(img);
        this.imgEl = img;
        this.currentUrl = url;
        // 旧页 URL 在**换位之后**才回收（换位前 revoke 会把正在显示的图打成空白）
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.applyZoom();
        this.updateFooter();
        void this.prefetchNext();
    }

    private showPlaceholder(text = '正在加载…'): void {
        if (this.imgEl) {
            this.imgEl.remove();
            this.imgEl = null;
        }
        this.revokeUrl();
        if (!this.placeholderEl) {
            this.placeholderEl = this.stageEl.createDiv({ cls: 'rl-comic-ph' });
        }
        this.placeholderEl.setText(text);
        this.updateFooter();
    }

    private clearPlaceholder(): void {
        this.placeholderEl?.remove();
        this.placeholderEl = null;
    }

    // ── 进度 ──────────────────────────────────────────────────────────────────

    /**
     * 全书百分比（落库真源 = `readingProgress.percent`）。
     *
     * 🔴🔴 #677：口径 = **「读到第 N 页 = 读完了前 N 页」** ⇒ (pageIndex + 1) / total。
     *    ⛔ 原来是 `estimatePercent(sizes, pageIndex, 1)` —— 每页权重 1、且 scrollRatio 传 1，
     *    按它自己的公式是「前 N 页之和 + 当前页 × 1」，**当前页算一页完整**，数字上是对的；
     *    但用户 2026-10-19 报「漫画阅读没阅读进度，退出后直接回到第一页」时，第一条现象正是
     *    「读到第 58 页、角标还写着 0%/1%」。逐一排查后确认：**存档写入链路**才是真因（见 `scheduleSave`），
     *    百分比这处只是「越算越显得像没进度」的放大器 ⇒ 这里显式写成一条式子，⛔ 不再绕 `estimatePercent`
     *    （它服务 TXT/EPUB 的章加权，漫画按页等权重，绕过去只会让后来的人读不懂）。
     */
    private percent(): number {
        const total = Math.max(1, this.total);
        return Math.max(0, Math.min(100, Math.round(((this.pageIndex + 1) / total) * 100)));
    }

    private updateFooter(): void {
        if (this.footerPageEl) this.footerPageEl.setText(comicPageText(this.pageIndex, this.total));
        const pct = this.percent();
        if (this.footerFillEl) this.footerFillEl.style.width = `${pct}%`;
        if (this.footerPctEl) this.footerPctEl.setText(`已读 ${pct}%`);
    }

    /**
     * 保存用的「页内比例」。
     * 🔴 #669：单页制恒 0（没有页内位置的概念，与 #537 逐字一致）；
     *    连续滚动下 = 全书滚动比例（`scrollRatio`，由 rAF 每帧算），**关了再开就能回到原处**。
     */
    private saveRatio(): number {
        return this.viewMode === 'scroll' ? this.scrollRatio : 0;
    }

    /** 进度写入（**所有翻转进度的入口都走它**：翻页 / 点缩略图 / 连续滚动 / 窗口隐藏 / 关标签 / 切模式） */
    private scheduleSave(): void {
        if (this.destroyed) return;
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        const snapshot = { chapterIndex: this.pageIndex, scrollRatio: this.saveRatio() };
        // 🔴🔴 #677：**立即写一次**，节流只用来合并后续重复写。
        //    真因（用户 2026-10-19：「漫画阅读没阅读进度，退出后直接回到第一页」）：
        //    原来只有 300ms 定时器里的那一次写 —— 而 `destroy()` 里 `this.destroyed = true` 排在最前，
        //    `flushSave()` 紧随其后调用 `onSaveProgress`，main 侧的 `saveReaderProgress` 是 `void` 异步；
        //    只要关标签页/重载发生在定时器到点**之前**、或 close 的 flush 与 destroy 抢跑，
        //    翻页那次写入就**从没发生** ⇒ 存档里 chapterIndex 一直是旧值（往往是 0 / 从未写过）。
        //    ⇒ 现在每次换页都同步落内存，节流窗口只负责合并，丢掉也不影响最终结果。
        this.options.onSaveProgress(snapshot);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            if (this.destroyed) return;
            this.options.onSaveProgress({ chapterIndex: this.pageIndex, scrollRatio: this.saveRatio() });
        }, SAVE_THROTTLE);
    }

    /** 关闭落盘：立即保存进度 + 落一次 percent（低频写 catalog） */
    private flushSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.options.onSaveProgress({ chapterIndex: this.pageIndex, scrollRatio: this.saveRatio() });
        this.options.onProgressPersist?.(this.percent());
    }
}
