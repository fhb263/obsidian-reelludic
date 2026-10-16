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
// 进度：`chapterIndex` = 页码索引（0 基）、`scrollRatio` 恒 0（单页制没有「页内比例」）；
//   `percent` 走 `pure/readingProgress.estimatePercent`（每页权重 1 ⇒ (页序+1)/总页数），
//   与 PDF/EPUB 落库同一口径（`readingProgress.percent` 是唯一进度真源）。
//   ⚠️ 图片**没有**摘抄/高亮/书签（选中无反馈、也没有「块」概念）⇒ 本批不做书签（登记为后续可选）。
import { Scope, setIcon } from 'obsidian';
import { READER_THEMES, normalizeReaderTheme, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
// 🔴 #603：底栏图标组里「描述行为」的悬停轻提示真源（与另外三件共用）
import { READER_FOPS } from 'pure/readerFops';
import { attachHeadTitle } from 'pure/readerHead';
import { estimatePercent } from 'pure/readingProgress';
import { comicPageText } from 'pure/comicFiles';
// 🔴 #636 ⑤：本批新增三件的**判据真源**（缩略图惰性窗口 / 连续滚动的当前页 / 卸载 / 原文件名 / 模式归一）
import {
    normalizeComicViewMode,
    thumbWindow,
    pruneThumbs,
    pageAtScroll,
    pagesToUnload,
    baseNameOf,
    thumbsVisible,
    comicViewModeOptions,
    COMIC_VIEW_MODE_LABELS,
    type ComicViewMode,
} from 'pure/comicViewer';
import type { ParsedExcerpt } from 'pure/excerpt';

/** 缩放范围与步进（与 PDF 面板同值，用户切阅读器时手感一致） */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
/** 进度保存节流（ms） */
const SAVE_THROTTLE = 300;
/** 滚轮翻页冷却（ms）——触控板一次滑动会连发几十个 wheel，不加冷却会一次翻十几页 */
const WHEEL_COOLDOWN = 220;
/** 滚轮累计阈值（px）——低于它视为惯性抖动，不翻页 */
const WHEEL_THRESHOLD = 40;
/** 🔴 #636 缩略图**生成**窗口半径（当前页前后各几页做小图）——两者都是「惰性」的核心 */
const THUMB_RADIUS = 6;
/** 🔴 #636 连续模式里「视野附近保留几页的图」（超出即卸载，防大漫画吃光内存） */
const SCROLL_KEEP = 3;
/**
 * 🔴 #642：滚动停多久才算「停下来了」（ms）—— 补缩略图等重活等过这段时间再做。
 * 依据：滚动防抖是 90ms，再加一点余量 ⇒ 连续滚动（每 ~16~50ms 一次事件）期间**永远不触发**，
 * 手一停约 220ms 后补齐。正文插图**不受此限**（用户正看的就是它）。
 */
const SCROLL_IDLE_MS = 220;

/**
 * 🔴 #642：让出**一帧**再做下一步（补缩略图/插图时用）。
 *
 * 为什么必须让帧：这些循环每步都在做「zip 解压 + 造 Blob + 图片解码」，全部在**主线程**。
 * 连着跑十几步 = 连续十几帧都没有机会渲染 ⇒ 界面**完全不动**（用户报障原文「卡住了完全动不了」）。
 * ⚠️ 用 `requestAnimationFrame` 而不是 `setTimeout(0)`：前者与**渲染帧对齐**
 *   （浏览器保证这一帧画完才回调），后者只是让出任务队列、仍可能积压在同一帧里。
 * ⚠️ 面板后台化（标签页不可见）时 rAF **不触发** ⇒ 加超时兜底，⛔ 不能把补图永久挂起。
 */
function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (): void => {
            if (done) return;
            done = true;
            resolve();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
        // 后台标签页 rAF 暂停 ⇒ 兜底（16ms 后无论有没有帧都继续，避免卡住不补）
        window.setTimeout(finish, 16);
    });
}

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
    private fsBtnEl: HTMLButtonElement | null = null;
    private immersiveBtnEl: HTMLButtonElement | null = null;
    private immersive = false;
    private disposeHeadTitle: (() => void) | null = null;
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
    /** 连续模式里各页的顶部偏移（量出来缓存；页图加载完成后会变 ⇒ 需重算） */
    private pageTops: number[] = [];
    /** 连续模式里已挂载的页（下标 → 是否已插入过图片） */
    private scrollMounted = new Set<number>();
    /** 右键菜单元素 */
    private ctxEl: HTMLElement | null = null;
    /** 连续模式的滚动防抖（滚动事件很密，别每次重排缩略图） */
    private scrollSyncTimer: number | null = null;
    /** #540 下一页预取（单槽）：压缩包逐页解压有延迟，预取后翻页**零等待**（⛔ 只留一页，别攒缓存） */
    private nextBlob: { index: number; blob: Blob } | null = null;
    /**
     * 🔴🔴 #642：缩略图补图的**重入守卫**。
     *
     * 由来（用户报障「阅读 eupb 漫画时卡住了完全动不了」，且**缩略图栏是开着的**）：
     *   `fillThumbs()` 由**每次滚动落定**（`onScrollView` 的防抖回调）与**每次挂载/改模式**调用，
     *   而它内部是 `for (…) await loadPage(i)` —— **没有重入守卫** ⇒ 连续滚动会**叠起多条**并发补图，
     *   每条各自对窗口内最多 13 页发起解压（`loadBinary` = zip 解压，实测单张 8ms、13 张 >100ms）。
     *   多条叠起来就把主线程彻底占满 ⇒ 界面**完全不动**。
     * ⇒ 同一时刻**只允许一条**补图在跑；跑完若期间又有人叫过（`thumbsDirty`），**再补一轮**。
     *   ⚠️ 用「置脏 + 收尾复查」而不是「直接 return 丢弃」：否则滚动停下后最后一批缩略图会**永远不补**。
     */
    private thumbsBusy = false;
    /** 有人在补图期间又叫过 `fillThumbs`（收尾时要再补一轮） */
    private thumbsDirty = false;
    /** 🔴 #642：连续模式插图的**重入守卫**（与缩略图各一枚，见 `mountScrollImages`） */
    private scrollBusy = false;
    /** 🔴 #642：插图期间又叫过 `mountScrollImages` ⇒ 收尾再插一轮 */
    private scrollDirty = false;
    /** 🔴 #642：最近一次滚动事件时刻（判「用户是否还在滚」，见 `scheduleThumbsFill`） */
    private scrollActiveAt = 0;
    /** 🔴 #642：延迟补缩略图的单一定时器（连续滚动时不断顺延，⛔ 不攒多条） */
    private thumbsIdleTimer: number | null = null;
    /** 加载序号：翻页快于取图时，旧结果作废（防「乱序回填」把新页盖回旧页） */
    private loadSeq = 0;
    private destroyed = false;
    /** 滚轮累计 / 上次翻页时刻 */
    private wheelAcc = 0;
    private wheelAt = 0;

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
        // 🔴 #636：连续模式的滚动同步（单页制不需要 —— 那个容器不滚）
        if (this.viewMode === 'scroll') {
            this.scrollEl?.addEventListener('scroll', this.onScrollView, { passive: true });
            void this.mountScrollImages();
        }
        if (document.fullscreenEnabled) {
            document.addEventListener('fullscreenchange', this.onFsChange);
        }
        this.registerKeys();

        if (this.viewMode === 'single') void this.renderPage();
    }

    destroy(): void {
        this.destroyed = true;
        this.flushSave();
        this.disposeHeadTitle?.();
        this.disposeHeadTitle = null;
        document.removeEventListener('mousedown', this.onDocMouseDown);
        document.removeEventListener('fullscreenchange', this.onFsChange);
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        // 🔴 #636：连续模式的滚动防抖与右键菜单也要清（⛔ 别留悬着的定时器 / 孤儿菜单）
        if (this.scrollSyncTimer !== null) window.clearTimeout(this.scrollSyncTimer);
        this.scrollSyncTimer = null;
        // 🔴 #642：两枚重入守卫的「置脏」标记一并复位（面板销毁后不该再有任何一轮补图/插图）
        this.thumbsDirty = false;
        this.scrollDirty = false;
        // 🔴 #642：延迟补缩略图的定时器一并清（⛔ 别让已关掉的面板再补图）
        if (this.thumbsIdleTimer !== null) window.clearTimeout(this.thumbsIdleTimer);
        this.thumbsIdleTimer = null;
        this.hideCtx();
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
        this.thumbCells.clear();
        this.thumbDone.clear();
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
     *  重算前后**保住滚动位置**：拖分隔条会连发几十次 resize，每次都弹回左上角很烦。 */
    onResize(): void {
        if (this.destroyed || !this.imgEl) return;
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
        // 🔴 #636：缩略图栏开关（用户裁定「顶栏一枚开关」）—— 放在设置钮**左边**（它是内容导航，不是设置）
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

        // 缩放行（漫画无字号概念 ⇒ 调「页面缩放」，标签就叫「缩放」，与 PDF 一致）
        const zoomRow = menu.createDiv({ cls: 'rl-reader-menu-row' });
        zoomRow.createSpan({ cls: 'rl-reader-menu-label', text: '缩放' });
        const slider = zoomRow.createEl('input', {
            cls: 'rl-reader-menu-slider',
            attr: { type: 'range', min: String(ZOOM_MIN * 100), max: String(ZOOM_MAX * 100), step: String(ZOOM_STEP * 100), 'data-tip': '拖动调整页面缩放（←/→ 翻页，= / - 缩放）' },
        });
        this.menuZoomSlider = slider;
        slider.addEventListener('input', () => this.menuZoomVal?.setText(`${Math.round(Number(slider.value))}%`));
        slider.addEventListener('change', () => this.applyZoom(Number(slider.value) / 100));
        this.menuZoomVal = zoomRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 主题六档色卡（与另三个阅读器同一份色板）
        const themeRow = menu.createDiv({ cls: 'rl-reader-menu-row rl-reader-theme-row' });
        themeRow.createSpan({ cls: 'rl-reader-menu-label', text: '主题' });
        for (const meta of READER_THEMES) {
            const sw = themeRow.createEl('button', {
                cls: 'rl-btn rl-reader-theme-swatch',
                attr: { type: 'button', 'data-theme': meta.id, 'data-tip': meta.label },
            });
            sw.addEventListener('click', () => this.setTheme(meta.id));
            this.themeSwatches[meta.id] = sw;
        }

        // 🔴 #636：阅读模式一档（单页 / 连续滚动）—— 与「缩放 / 主题」同一处（用户裁定）
        const modeRow = menu.createDiv({ cls: 'rl-reader-menu-row rl-comic-mode-row' });
        modeRow.createSpan({ cls: 'rl-reader-menu-label', text: '翻页' });
        for (const opt of comicViewModeOptions()) {
            const b = modeRow.createEl('button', {
                cls: 'rl-btn rl-comic-mode-seg',
                attr: { type: 'button', 'data-mode': opt.value, 'data-tip': `阅读方式：${opt.label}` },
                text: opt.label,
            });
            b.addEventListener('click', () => this.setViewMode(opt.value));
            this.modeSegs.set(opt.value, b);
        }
        this.syncModeSegs();
    }

    /** 阅读模式分段的选中态（与主题色卡同款：`.is-on` 高亮） */
    private syncModeSegs(): void {
        for (const [m, el] of this.modeSegs) el.toggleClass('is-on', m === this.viewMode);
    }

    private buildBody(): void {
        const main = this.container.createDiv({ cls: 'rl-reader-main' });
        const body = main.createDiv({ cls: 'rl-reader-body' });
        // 🔴 #636：中间那块**按模式二选一**（两模式共用底栏与进度落库，只换这一个容器）
        //    · 单页制（#537 现状）：`.rl-comic-stage` —— 整页 contain + 溢出滚动（放大后平移靠它）；
        //    · 连续滚动（本批）：`.rl-comic-scroll` —— 页依次竖排、容器自己滚。
        if (this.viewMode === 'scroll') {
            this.scrollEl = body.createDiv({ cls: 'rl-comic-scroll' });
            this.stageEl = this.scrollEl;
            this.buildScrollPages();
        } else {
            this.stageEl = body.createDiv({ cls: 'rl-comic-stage' });
        }
        // 右侧缩略图导航栏（默认隐藏 ⇒ 这里**不建 DOM**；开启时在 `mountThumbs` 里补建）
        if (this.thumbsOn) this.mountThumbs(main);
    }

    // ── 🔴 #636 ⑤ 新增：缩略图导航栏 / 连续滚动 / 右键菜单 ──────────────────────────

    /**
     * 右侧**垂直缩略图导航栏**（用户规格：「右侧浅灰的垂直缩略图导航栏，卡片式缩略图，
     * 选中缩略图带加粗黑色边框」）。
     *
     * 🔴 **惰性生成**是这里唯一的技术要点：只给「当前页前后 `THUMB_RADIUS` 页」解图做小图，
     *    其余格子只是占位（`.rl-comic-thumb` 本身就在那，点它照样能跳页）。
     *    200 页的 CBZ 一次性全做 = 同时持有 200 个 Blob ⇒ 卡死或 OOM。
     */
    private mountThumbs(main: HTMLElement): void {
        if (this.thumbsEl) return;
        const col = main.createDiv({ cls: 'rl-comic-thumbs', attr: { 'aria-label': '页面缩略图' } });
        this.thumbsEl = col;
        this.thumbDone.clear();
        this.thumbCells.clear();
        for (let i = 0; i < this.total; i++) {
            const cell = col.createEl('button', {
                cls: 'rl-comic-thumb',
                attr: { type: 'button', 'data-tip': `第 ${i + 1} 页`, 'data-index': String(i) },
            });
            cell.createSpan({ cls: 'rl-comic-thumb-no', text: String(i + 1) });
            cell.addEventListener('click', () => this.goto(i));
            this.thumbCells.set(i, cell);
        }
        this.syncThumbsActive();
        void this.fillThumbs();
    }

    /** 拆掉缩略图栏（关闭时**连 DOM 一起**去掉 —— 留着空容器会占宽度） */
    private unmountThumbs(): void {
        this.thumbsEl?.remove();
        this.thumbsEl = null;
        this.thumbDone.clear();
        this.thumbCells.clear();
    }

    /**
     * 给**窗口内**还没做过的页补缩略图；滚远了的丢缓存（`pruneThumbs` 的保留窗口更宽，防抖动）。
     *
     * 🔴 #642 三条一起修（原注释写着「串行 + 每张做完让出一帧」，但**代码里根本没有让帧**）：
     *   ⑴ **重入守卫**（`thumbsBusy`）—— 见字段注释：连续滚动会把补图叠成多条并发，把主线程占满；
     *   ⑵ **真正让帧**：每张缩略图做完 `await` 一次 rAF ⇒ 解压/解码不会连着堵住同一帧；
     *   ⑶ **收尾复查**（`thumbsDirty`）—— 补图期间被叫过就再补一轮，否则最后一批永远不补。
     * ⚠️ 阈值不动：仍是 `thumbWindow(current, total, THUMB_RADIUS)`（用户已验收的窗口语义）。
     */
    private async fillThumbs(): Promise<void> {
        const col = this.thumbsEl;
        if (!col) return;
        // ⑴ 重入守卫：已在补图 ⇒ 只置脏，等它收尾时再补（⛔ 别并发再开一条）
        if (this.thumbsBusy) {
            this.thumbsDirty = true;
            return;
        }
        this.thumbsBusy = true;
        try {
            do {
                this.thumbsDirty = false;
                if (!(await this.fillThumbsOnce())) return; // 中途被关掉 / 收起
            } while (this.thumbsDirty && !this.destroyed);
        } finally {
            this.thumbsBusy = false;
        }
    }

    /** 补图**一轮**；返回 false = 面板已销毁（调用方据此收手） */
    private async fillThumbsOnce(): Promise<boolean> {
        const col = this.thumbsEl;
        if (!col) return false;
        // 丢远的（只丢**缓存标记**，格子还在 —— 再滚回来重新生成）
        const keep = new Set(pruneThumbs([...this.thumbDone], this.pageIndex, this.total));
        for (const i of [...this.thumbDone]) if (!keep.has(i)) this.thumbDone.delete(i);
        const w = thumbWindow(this.pageIndex, this.total, THUMB_RADIUS);
        for (let i = w.start; i <= w.end; i++) {
            if (this.thumbDone.has(i)) continue;
            this.thumbDone.add(i);
            const cell = this.thumbCells.get(i);
            if (!cell) continue;
            const blob = await this.options.loadPage(i);
            if (this.destroyed || !this.thumbsEl) return false; // 中途被关掉 / 收起
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            const img = cell.createEl('img', { cls: 'rl-comic-thumb-img', attr: { alt: '' } });
            img.src = url;
            img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
            img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
            // ⑵ 真正让出一帧（解压/解码不连着堵同一帧 —— 这是原注释承诺、实现却漏掉的那一步）
            await nextFrame();
            if (this.destroyed) return false;
        }
        this.syncThumbsActive();
        return true;
    }

    /** 当前页那格高亮（加粗黑边 + 滚进视野）。⚠️ 用 `block:'nearest'`：本来在视野里就不动 */
    private syncThumbsActive(): void {
        if (!this.thumbsEl) return;
        for (const [i, cell] of this.thumbCells) cell.toggleClass('is-on', i === this.pageIndex);
        this.thumbCells.get(this.pageIndex)?.scrollIntoView({ block: 'nearest' });
    }

    /** 顶栏那枚「缩略图栏」开关（用户裁定：顶栏一枚开关，状态记住） */
    private toggleThumbs(): void {
        this.thumbsOn = !this.thumbsOn;
        const main = this.container.querySelector('.rl-reader-main') as HTMLElement | null;
        if (this.thumbsOn && main) this.mountThumbs(main);
        else this.unmountThumbs();
        this.thumbsBtn?.toggleClass('active', this.thumbsOn);
        this.options.onThumbsChange?.(this.thumbsOn);
    }

    /**
     * 连续滚动模式：把**全部**页的占位块先排好（每块一个固定最小高，避免整页跳动），
     * 图片按需插入（视野附近才插 —— 这是「大漫画不炸内存」的关键）。
     */
    private buildScrollPages(): void {
        const col = this.scrollEl;
        if (!col) return;
        col.empty();
        this.scrollMounted.clear();
        this.pageTops = [];
        for (let i = 0; i < this.total; i++) {
            const box = col.createDiv({ cls: 'rl-comic-spage', attr: { 'data-index': String(i) } });
            // 页码角标（页面本身是图，用户需要一个「我在第几页」的锚点）
            box.createSpan({ cls: 'rl-comic-spage-no', text: String(i + 1) });
            this.scrollMounted.add(i);
        }
    }

    /** 连续模式：按滚动位置刷新「当前页」+ 惰性插图 / 卸载视野外的图 */
    private onScrollView = (): void => {
        if (this.viewMode !== 'scroll' || !this.scrollEl) return;
        // 🔴 #642：记下「用户正在滚」——重活（补缩略图）推迟到滚动停下来再做，
        //   否则每滚一格就解 13 张图，滚轮/触控板连续滚动时永远抢不到主线程（用户报「完全动不了」）。
        this.scrollActiveAt = Date.now();
        if (this.scrollSyncTimer !== null) window.clearTimeout(this.scrollSyncTimer);
        this.scrollSyncTimer = window.setTimeout(() => {
            this.scrollSyncTimer = null;
            if (this.destroyed || !this.scrollEl) return;
            this.measureScrollTops();
            const idx = pageAtScroll(this.pageTops, this.scrollEl.scrollTop);
            if (idx !== this.pageIndex) {
                this.pageIndex = idx;
                this.scheduleSave();
                this.updateFooter();
                this.syncThumbsActive();
                // 缩略图是**装饰性**的 ⇒ 滚动刚停的 220ms 内先不做（正文插图优先，见下）
                this.scheduleThumbsFill();
            }
            // 正文插图**立即做**（用户正在看的就是它，不能等）
            void this.mountScrollImages();
        }, 90);
    };

    /**
     * 🔴 #642：把补缩略图**推迟到滚动真正停下来**之后。
     * 判据 = `scrollActiveAt` 距现在超过 `SCROLL_IDLE_MS`；期间反复滚动只会**不断顺延**（不累积多条）。
     * ⚠️ 用「重排单一定时器」而不是多条 setTimeout：连续滚动不会攒出一串补图任务。
     */
    private scheduleThumbsFill(): void {
        if (this.thumbsIdleTimer !== null) window.clearTimeout(this.thumbsIdleTimer);
        const wait = Math.max(0, SCROLL_IDLE_MS - (Date.now() - this.scrollActiveAt));
        this.thumbsIdleTimer = window.setTimeout(() => {
            this.thumbsIdleTimer = null;
            if (this.destroyed) return;
            void this.fillThumbs();
        }, wait);
    }

    /** 量各页顶部偏移（页图加载完成会改变高度 ⇒ 每次滚动重算一遍，成本可忽略） */
    private measureScrollTops(): void {
        const col = this.scrollEl;
        if (!col) return;
        const kids = Array.from(col.children) as HTMLElement[];
        this.pageTops = kids.map((el) => el.offsetTop);
    }

    /**
     * 连续模式按需插图：只给「当前页前后各 `SCROLL_KEEP` 页」取图，
     * 视野外的**卸载图片**（把 `src` 清掉并撤掉 objectURL），但**保留容器高度**（防滚动位置跳）。
     *
     * 🔴 #642：同样加了**重入守卫 + 让帧**（与 `fillThumbs` 同族问题）——
     *   本方法由 `mount`、`onScrollView`（每次滚动落定）、`setViewMode` 三处调用，
     *   而体内是 `await loadPage(i)` 串行取图（最多 7 页 × zip 解压）⇒ 连续滚动会叠成多条并发。
     *   ⚠️ 与缩略图各用一枚守卫：两条链的窗口不同，互相阻塞会让正文出图变慢。
     */
    private async mountScrollImages(): Promise<void> {
        if (this.scrollBusy) {
            this.scrollDirty = true;
            return;
        }
        this.scrollBusy = true;
        try {
            do {
                this.scrollDirty = false;
                if (!(await this.mountScrollImagesOnce())) return;
            } while (this.scrollDirty && !this.destroyed);
        } finally {
            this.scrollBusy = false;
        }
    }

    /** 插图**一轮**；返回 false = 面板已销毁 / 已离开连续模式（调用方据此收手） */
    private async mountScrollImagesOnce(): Promise<boolean> {
        const col = this.scrollEl;
        if (!col) return false;
        const shouldUnload = pagesToUnload(this.pageIndex, this.total, SCROLL_KEEP);
        const kids = Array.from(col.children) as HTMLElement[];
        for (let i = 0; i < kids.length; i++) {
            const box = kids[i];
            if (shouldUnload(i)) {
                // 卸载：撤图但**留高度**（`min-height` 由 CSS 给），⛔ 别把容器也删了（那会跳滚动位置）
                const img = box.querySelector('img');
                if (img) {
                    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
                    img.remove();
                }
                continue;
            }
            if (box.querySelector('img') || box.dataset.loading === '1') continue;
            box.dataset.loading = '1';
            const blob = await this.options.loadPage(i);
            if (this.destroyed || this.viewMode !== 'scroll') return false;
            box.dataset.loading = '';
            if (!blob) continue;
            const url = URL.createObjectURL(blob);
            const img = box.createEl('img', { cls: 'rl-comic-spage-img', attr: { alt: '' } });
            img.dataset.url = url;
            img.src = url;
            // 图片撑开高度后要重算偏移（否则页码会算偏）
            img.addEventListener('load', () => {
                this.measureScrollTops();
            }, { once: true });
            // 让出一帧：解压 + 解码不连着堵同一帧（#642）
            await nextFrame();
            if (this.destroyed) return false;
        }
        return true;
    }

    /**
     * 切换阅读模式（设置菜单里一档）。
     * 🔴 两个容器**都重建**（不是切换 `display`）：连续模式的页块与单页制的 stage 结构本就不同，
     *    藏起来那份会一直挂在 DOM 里（200 个占位块白占内存）。
     */
    private setViewMode(m: ComicViewMode): void {
        const next = normalizeComicViewMode(m);
        if (next === this.viewMode) return;
        this.viewMode = next;
        this.revokeUrl();
        this.nextBlob = null;
        // 拆掉旧容器（连同缩略图栏 —— 它在 main 下，重建 body 后要重新挂）
        const main = this.container.querySelector('.rl-reader-main') as HTMLElement | null;
        if (main) {
            const oldBody = main.querySelector('.rl-reader-body');
            oldBody?.remove();
            this.thumbsEl?.remove();
            this.thumbsEl = null;
            this.thumbCells.clear();
            this.thumbDone.clear();
            const body = main.createDiv({ cls: 'rl-reader-body' });
            if (this.viewMode === 'scroll') {
                this.scrollEl = body.createDiv({ cls: 'rl-comic-scroll' });
                this.stageEl = this.scrollEl;
                this.buildScrollPages();
                this.scrollEl.addEventListener('scroll', this.onScrollView, { passive: true });
            } else {
                this.scrollEl = null;
                this.stageEl = body.createDiv({ cls: 'rl-comic-stage' });
            }
        }
        // 新容器要挂回旧的监听（stage 是新建的 ⇒ 上一份监听随旧节点一起没了）
        this.stageEl.addEventListener('click', this.onBodyClick);
        this.stageEl.addEventListener('wheel', this.onWheel, { passive: false });
        this.stageEl.addEventListener('contextmenu', this.onStageContextMenu);
        if (this.thumbsOn && main) this.mountThumbs(main);
        this.options.onViewModeChange?.(this.viewMode);
        this.syncSettingsLabels();
        if (this.viewMode === 'scroll') {
            this.buildScrollPages();
            void this.mountScrollImages();
        } else {
            void this.renderPage();
        }
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
        const mainCol = this.container.querySelector('.rl-reader-main') as HTMLElement | null;
        const footer = (mainCol ?? this.container).createDiv({ cls: 'rl-reader-footer' });
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

        // 图标组：全屏 / 沉浸（漫画未接自动滚动/TTS ⇒ 两枚）
        const fops = footer.createDiv({ cls: 'rl-reader-fops' });
        const mkFop = (icon: string, tip: string, onClick: () => void): HTMLButtonElement => {
            const b = fops.createEl('button', { cls: 'rl-btn rl-reader-btn' });
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', tip);
            b.addEventListener('click', onClick);
            return b;
        };
        this.fsBtnEl = mkFop('maximize', '全屏显示', () => this.toggleFullscreen());
        // 🔴 #603：沉浸提示走**四件共用**的真源 `pure/readerFops`（漫画没有自动推进 ⇒ 只取这一条）
        this.immersiveBtnEl = mkFop('eye', READER_FOPS.immersive, () => this.setImmersive(!this.immersive));
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
    };

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

    /** 滚轮翻页（带累计阈值 + 冷却；`preventDefault` 阻止 Obsidian 把滚动传给外层） */
    private onWheel = (ev: WheelEvent): void => {
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

    /** 相对翻页（越界钳制；到达边界不保存——位置没变） */
    private go(delta: number): void {
        this.goto(this.pageIndex + delta);
    }

    private goto(index: number): void {
        const next = clampInt(index, 0, Math.max(0, this.total - 1));
        if (next === this.pageIndex && this.imgEl) return;
        this.pageIndex = next;
        // 🔴 #540：⛔ 不在这里清滚动 —— 此刻画面上还是**上一页**，清了就是一次可见的跳动。
        //    新页就位后由 `applyZoom` 归零（换位与归零同帧，用户看不到中间的旧页）。
        void this.renderPage();
        this.scheduleSave();
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

    /** 应用缩放（钳制 0.5~4；1× = 整页适屏 contain，>1× 溢出舞台 → 用舞台滚动平移）；缺参 = 按当前档重算 */
    private applyZoom(z: number = this.zoom): void {
        this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z / ZOOM_STEP) * ZOOM_STEP));
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
        this.syncSettingsLabels();
    }

    private syncSettingsLabels(): void {
        const pct = Math.round(this.zoom * 100);
        if (this.menuZoomVal) this.menuZoomVal.setText(`${pct}%`);
        if (this.menuZoomSlider) this.menuZoomSlider.value = String(pct);
    }

    private syncThemeSwatches(): void {
        for (const meta of READER_THEMES) this.themeSwatches[meta.id]?.toggleClass('is-on', meta.id === this.theme);
    }

    private syncViewBtns(): void {
        this.fsBtnEl?.toggleClass('rl-quick-active', !!document.fullscreenElement);
        if (this.fsBtnEl) this.fsBtnEl.setAttribute('data-tip', document.fullscreenElement ? '退出全屏' : '全屏显示');
        this.immersiveBtnEl?.toggleClass('rl-quick-active', this.immersive);
    }

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
    private async loadBlob(i: number): Promise<Blob | null> {
        if (this.nextBlob && this.nextBlob.index === i) {
            const b = this.nextBlob.blob;
            this.nextBlob = null;
            return b;
        }
        try {
            return await this.options.loadPage(i);
        } catch {
            return null;
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
        // 首屏（还没有任何页图）给一句占位，避免长时间空白；换页时旧页仍在，不给占位
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

    /** 全书百分比（每页权重 1；恒按当前页算，落库真源 = readingProgress.percent） */
    private percent(): number {
        return estimatePercent(this.sizes, this.pageIndex, 1);
    }

    private updateFooter(): void {
        if (this.footerPageEl) this.footerPageEl.setText(comicPageText(this.pageIndex, this.total));
        const pct = this.percent();
        if (this.footerFillEl) this.footerFillEl.style.width = `${pct}%`;
        if (this.footerPctEl) this.footerPctEl.setText(`已读 ${pct}%`);
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.options.onSaveProgress({ chapterIndex: this.pageIndex, scrollRatio: 0 });
        }, SAVE_THROTTLE);
    }

    /** 关闭落盘：立即保存进度 + 落一次 percent（低频写 catalog） */
    private flushSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.options.onSaveProgress({ chapterIndex: this.pageIndex, scrollRatio: 0 });
        this.options.onProgressPersist?.(this.percent());
    }
}
