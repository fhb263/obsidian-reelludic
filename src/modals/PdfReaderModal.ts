// PDF 书籍阅读器面板（宿主由 views/ReaderViews.ts 的 PdfReaderView 提供：工作区新标签页打开）：
// 连续滚动逐页 canvas 渲染（视口虚拟化：IntersectionObserver 只渲染可视 ± 缓冲页，离屏销毁释放内存）
// + textLayer 文本层选中（PDF 摘抄入口未开，沿用旧口径待后续批）+ PDF outline 目录侧栏 + 缩放 ±
// + 进度持久化（ReadingProgress 复用：chapterIndex = 页码索引 0 基，scrollRatio = 页内滚动比例）
// 渲染：pdfjs-dist 自渲染（Obsidian 禁用 Chromium 内置 PDF viewer）；worker 以 Blob 内联随产物打包
import { Notice, Scope, setIcon } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { estimatePdfPercent, normalizePdfOutline, resolveFlushPos, flattenPdfOutline, chooseActivePdfIndex, type PdfOutlineItem, type ReaderPos, type FlatPdfOutlineItem } from 'pure/pdfProgress';
import { READER_THEMES, normalizeReaderTheme, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
// #382：目录栏右缘拖宽（与 TXT/EPUB 同款共用件；#339 只写 CSS 变量 + localStorage 记忆）
import { attachTocResizer } from 'pure/readerToc';
// #382b：书签（PDF **只做书签** —— 高亮/摘抄依赖选区，而 PDF 选中文字没有任何反馈，用户裁定不做）
import { newBookmark, type ReaderBookmark } from 'pure/bookmark';
// #379：PDF 顶栏没有快捷入口（不需要窄屏收纳），只挂「标题对称限宽」这一半
import { attachHeadTitle } from 'pure/readerHead';
import type { ParsedExcerpt } from 'pure/excerpt';
import {
    AUTO_SCROLL_DEFAULT,
    AUTO_SCROLL_MAX,
    AUTO_SCROLL_MIN,
    AUTO_SCROLL_STEP,
    advanceAutoPos,
    autoSpeedLabel,
    clampAutoScrollPx,
    loadAutoScrollPx,
    saveAutoScrollPx,
} from 'pure/readerAuto';

/** worker 只初始化一次（Blob URL 由 esbuild worker 内联 plugin 注入；重复赋值无副作用但保持惰性） */
let workerReady = false;
function ensurePdfWorker(): void {
    if (!workerReady) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        workerReady = true;
    }
}

/** 轻量页数探针：仅解析 PDF 获取 numPages（不渲染，供表单「进度页数」自动关联本地文件用）；
 *  复用本模块 worker 初始化（单产物内 Blob worker 只建一次）；失败返回 undefined（调用方静默/降级） */
export async function probePdfNumPages(data: ArrayBuffer): Promise<number | undefined> {
    try {
        ensurePdfWorker();
        const doc = await pdfjsLib.getDocument({ data }).promise;
        const n = doc.numPages;
        void doc.destroy().catch(() => undefined);
        return n;
    } catch {
        return undefined;
    }
}

export interface PdfReaderOptions {
    /** 书籍标题（弹窗标题） */
    title: string;
    /** PDF 二进制（main.readPdf 产出；getDocument({ data }) 加载，不设 url 避免 file:// 受限） */
    data: ArrayBuffer;
    /** 当前进度（恢复用；chapterIndex = 页码索引 0 基） */
    progress?: { chapterIndex: number; scrollRatio: number };
    /** 保存进度回调（滚动节流调用） */
    onSaveProgress: (p: { chapterIndex: number; scrollRatio: number }) => void;
    /** 进度百分比落库回调（关闭时调用，percent 0-100；低频写 catalog） */
    onProgressPersist?: (percent: number) => void;
    /** 摘抄书签数据源（笔记「## 摘抄」区解析；打开阅读器时读取） */
    excerpts?: ParsedExcerpt[];
    /** #382b 书签数据源（阅读存档 `bookmarks` 段；打开阅读器时读取） */
    bookmarks?: ReaderBookmark[];
    /** #382b 书签变更落库（增 / 删都传全量；main 侧写阅读存档 —— 与另两个阅读器同一通道） */
    onBookmarksChange?: (list: ReaderBookmark[]) => void;
    /** #382b 危险操作二次确认（宿主注入 ConfirmModal；⛔ 不用原生 `confirm` —— 它阻塞主线程、与 Modal 关闭动画竞争） */
    onConfirmClear?: (msg: string) => Promise<boolean>;
    /** 打开条目笔记（顶栏「打开笔记」按钮；宿主注入 → main.openEntryNote；条目无笔记时由宿主提示） */
    onOpenNote?: () => void;
    /** 删除摘抄回调（书签右键 → main 层确认删除；返回是否成功，成功则面板刷新书签列表） */
    onDeleteExcerpt?: (blockId: string) => Promise<boolean>;
    /** PDF 加载完成回调（numPages 已知；main 层做进度基准校正 totalPage=本地页数） */
    onPdfReady?: (numPages: number) => void;
    /** 阅读主题（跟随/经典白/夜间黑/护眼绿/深灰/羊皮纸；缺省 follow = 跟随 Obsidian 主题） */
    theme?: ReaderThemeId;
    /** 阅读主题变更回调（切换后写回设置持久化） */
    onThemeChange?: (t: ReaderThemeId) => void;
}

/** 缩放范围与步进 */
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;
const SCALE_STEP = 0.25;
/** 滚动保存节流（ms，对齐 EPUB 阅读器） */
const SAVE_THROTTLE = 300;
/** 视口虚拟化缓冲（像素，提前渲染/延后销毁） */
const VIRTUAL_MARGIN = 300;
/** 自动滚动速度默认值 / 上下限见 `pure/readerAuto`（用户 2026-09-15 裁定定速 150px/s，与 TXT/EPUB 同口径）；
 *  #341 起可在右键「自动」弹窗里调，面板只持有实例字段 `autoScrollPx`。 */

/** 页面视图状态 */
interface PageView {
    /** 页容器（占位高度 = 渲染后实际页高；离屏销毁后恢复占位防滚动跳动） */
    el: HTMLDivElement;
    /** 渲染后的页高（px；未渲染 = 估算占位） */
    height: number;
    /** 页顶偏移（offsetTop 缓存，滚动计算用；渲染后更新） */
    top: number;
    /** 当前渲染任务（销毁页时 cancel） */
    renderTask: pdfjsLib.RenderTask | null;
}

export class PdfReaderPanel {
    /** pdf.js 文档对象（加载成功后持有） */
    private pdf: pdfjsLib.PDFDocumentProxy | null = null;
    /** 总页数 */
    private numPages = 0;
    /** 当前缩放（1 = 100%） */
    private scale = 1;
    /** 各页视图状态 */
    private pages: PageView[] = [];
    /** 目录条目（规整后；pageIndex 点击时才解析 dest 补写） */
    private tocEntries: PdfOutlineItem[] = [];
    /** 目录扁平条目（DFS 顺序对齐侧栏 DOM 行；当前章高亮计算用，dest 页码异步补全后重建） */
    private tocFlat: FlatPdfOutlineItem[] = [];
    /** 目录行按钮（与 tocFlat 一一对应；当前章 .active 切换用） */
    private tocRowEls: HTMLElement[] = [];
    /** 目录列折叠状态（首次打开即收起，对齐 TXT/EPUB 口径；用户 2026-09-15 移植） */
    private tocCollapsed = true;
    /** 目录折叠按钮（点击 toggleToc 收/展侧栏） */
    private sidebarToggleEl!: HTMLButtonElement;
    /** #379 标题对称限宽的 ResizeObserver 注销器（PDF 无快捷入口 ⇒ 不走 attachHeadDensity） */
    private disposeHeadTitle: (() => void) | null = null;
    /** 底部工具条：左「第 N 页 / 共 M 页」文本（updateProgress 刷新） */
    private footerPageEl!: HTMLSpanElement;
    /** 底部工具条：全书进度条填充（宽度 = 已读百分比，与落库 percent 同口径） */
    private footerFillEl!: HTMLDivElement;
    /** 底部工具条：右「已读 X%」文本 */
    private footerPctEl!: HTMLSpanElement;
    /** 设置下拉（≡）开关按钮 / 菜单根 / 展开态 */
    private settingsBtn!: HTMLButtonElement;
    private menuEl: HTMLElement | null = null;
    private settingsOpen = false;
    /** 菜单「字号」当前缩放值文本（缩放调整后刷新） */
    private menuScaleVal: HTMLSpanElement | null = null;
    /** 菜单缩放松紧滑条（用户 2026-09-16：± 按钮改滑条） */
    private menuScaleSlider: HTMLInputElement | null = null;
    /** 阅读主题（会话档位，启动读设置；容器类换肤，follow 不挂类） */
    private theme: ReaderThemeId = 'follow';
    /** 菜单主题色卡按钮（每档一个，选中态 is-on） */
    private themeSwatches: Partial<Record<ReaderThemeId, HTMLButtonElement>> = {};
    /** 菜单视图三按钮（全屏 / 沉浸 / 自动；点击切换 + is-on 高亮） */
    private fsBtnEl: HTMLButtonElement | null = null;
    private immersiveBtnEl: HTMLButtonElement | null = null;
    private autoBtnEl: HTMLButtonElement | null = null;
    /** 沉浸模式开关（隐藏上下边栏；点击正文空白切换；会话级，不落设置） */
    private immersive = false;
    /** 自动滚动开关（会话级，不落设置） */
    private autoOn = false;
    /** 自动滚动速度（px/s；#341 起可在右键弹窗里调，初值取记忆值 / 缺省定速 150） */
    private autoScrollPx = loadAutoScrollPx() ?? AUTO_SCROLL_DEFAULT;
    /** 自动滚动的**浮点位置**（#342）：实现见 `advanceAutoPos` —— 不能靠读回 `scrollTop` 累加（写入被取整） */
    private autoPos: number | null = null;
    /** 「自动」按钮的右键弹窗（速度滑条；#341 起与 TXT/EPUB 同款浮层） */
    private popEl: HTMLDivElement | null = null;
    /** 顶栏元素（沉浸模式下收起 / 展开目标） */
    private headEl: HTMLElement | null = null;
    /** 底栏元素（沉浸模式下改浮层，rl-foot-show 唤出） */
    private footEl: HTMLElement | null = null;
    /** 自动滚动 rAF / 上一帧时间戳（按时间增量推进，避免高刷屏过快） */
    private autoRaf: number | null = null;
    private autoLastTs = 0;
    /** fullscreenchange 已注册标记（destroy 对称注销） */
    private fsListenerRegistered = false;
    /** 保存节流定时器 */
    private saveTimer: number | null = null;
    /** 滚动 rAF 节流 id */
    private scrollRaf: number | null = null;
    /** 程序化滚动/恢复期间标记（恢复进度/缩放锚定时不保存进度） */
    private restoring = false;
    /** 待恢复的滚动位置（页索引 + 页内比例；加载完成后消费一次） */
    private pendingScroll: { pageIndex: number; ratio: number } | null = null;
    /** 最后已知阅读位置（滚动时维护；关闭落盘 DOM 归零时兜底用，见 pure/pdfProgress resolveFlushPos） */
    private lastPos: ReaderPos = { chapterIndex: 0, scrollRatio: 0 };
    /** 视口虚拟化观察器 */
    private observer: IntersectionObserver | null = null;
    /** 渲染中页的引用计数（清理时避免重复 cancel） */
    private renderingPages = new Set<number>();
    /** 首屏高度估算（未渲染页占位用；第一页渲染后校正） */
    private estHeight = 800;

    private tocEl!: HTMLDivElement;
    private tocListEl!: HTMLDivElement;
    /** #382b 侧栏书签列表容器 + 顶部书签按钮（计数走按钮的 data-tip） */
    private bmListEl: HTMLDivElement | null = null;
    private bmBtnEl: HTMLButtonElement | null = null;
    /** #382b 本会话的书签副本（初值取 options.bookmarks；任何变更都整份交给 onBookmarksChange 落库） */
    private bookmarks: ReaderBookmark[] = [];
    private scrollEl!: HTMLDivElement;
    private pagesEl!: HTMLDivElement;
    private exListEl: HTMLDivElement | null = null;
    /** 摘抄书签跳转待高亮引用（滚动定位后 textLayer 内查找高亮，一次性） */
    private pendingHighlight: string | null = null;
    /** 待高亮引用的目标页索引（textLayer span 异步渲染，页面就绪后重试命中） */
    private pendingHighlightPage: number | null = null;

    constructor(
        private container: HTMLElement,
        private scope: Scope,
        private options: PdfReaderOptions,
        private closeView: () => void,
    ) {
        this.theme = normalizeReaderTheme(options.theme);
    }

    /** 挂载渲染（容器需已铺满视图）：头部 + 目录侧栏 + 滚动容器 → 加载 PDF */
    mount(): void {
        const { container } = this;
        container.empty();
        container.addClass('rl-reader');
        // 阅读主题换肤：容器上挂 rl-rt-* 类覆盖 Obsidian 语义变量（follow 不挂类 = 完整继承主题）
        this.applyTheme();

        this.buildHeader();
        this.buildBody();
        // 底部工具条：页码 + 全书进度条 + 已读百分比（对齐 TXT/EPUB 底栏；body 之后，.rl-reader 纵向排列）
        this.buildFooter();
        void this.load();

        // 面板外 mousedown 收起设置下拉（菜单/按钮自身已 stopPropagation）
        document.addEventListener('mousedown', this.onDocMouseDown);
        // 沉浸模式：点击正文空白收起 / 展开上下边栏；自动滚动期间用户滚轮 / 触摸即停
        this.scrollEl.addEventListener('click', this.onBodyClick);
        this.container.addEventListener('wheel', this.onUserInterrupt, { passive: true });
        this.container.addEventListener('touchstart', this.onUserInterrupt, { passive: true });
        // 全屏态变化同步菜单「全屏显示/退出全屏」文案（桌面 Electron 支持；非桌面跳过）
        if (document.fullscreenEnabled) {
            document.addEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = true;
        }

        // 键盘：PageDown/PageUp 滚动一页高；← 上一页 / → 下一页（scope 由调用方注入）
        this.scope.register([], 'PageDown', () => {
            this.scrollByPage(1);
            return false;
        });
        this.scope.register([], 'PageUp', () => {
            this.scrollByPage(-1);
            return false;
        });
        this.scope.register([], 'ArrowRight', () => {
            this.scrollToPage(this.currentPageIndex() + 1);
            return false;
        });
        this.scope.register([], 'ArrowLeft', () => {
            this.scrollToPage(this.currentPageIndex() - 1);
            return false;
        });
        // 键盘缩放/目录：+/−（或 =/−）调缩放、T 目录开关
        this.scope.register([], '=', () => {
            this.adjustScale(SCALE_STEP);
            return false;
        });
        this.scope.register([], '+', () => {
            this.adjustScale(SCALE_STEP);
            return false;
        });
        this.scope.register([], '-', () => {
            this.adjustScale(-SCALE_STEP);
            return false;
        });
        this.scope.register([], 'T', () => {
            this.toggleToc();
            return false;
        });
    }

    /** 面板外 mousedown：收起设置下拉 + 按钮右键弹窗（≡ mousedown 已 stopPropagation，不会立即收起） */
    private onDocMouseDown = (): void => {
        this.hideSettings();
        this.closePop();
    };

    /** 全屏态变化：同步菜单三按钮高亮（全屏亮 / 灭） */
    private onFsChange = (): void => {
        this.syncViewBtns();
    };

    /** 销毁清理：落盘进度 + 取消渲染任务 + 释放 pdf.js 文档 + 清空容器 */
    destroy(): void {
        this.flushSave();
        this.disposeHeadTitle?.(); // #379 标题限宽的 ResizeObserver 随面板注销
        this.disposeHeadTitle = null;
        document.removeEventListener('mousedown', this.onDocMouseDown);
        if (this.fsListenerRegistered) {
            document.removeEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = false;
        }
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.scrollRaf !== null) {
            window.cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
        // 自动滚动随面板一并停止
        this.stopAuto();
        this.observer?.disconnect();
        this.observer = null;
        for (const pv of this.pages) {
            pv.renderTask?.cancel();
        }
        this.pages = [];
        void this.pdf?.destroy().catch(() => undefined);
        this.pdf = null;
        this.container.empty();
    }

    // ── 构建 ──

    /**
     * 构建底部工具条（用户 2026-09-21 象形稿定案，与 TXT/EPUB 同一套排布）：
     *   `[‹]  第 N 页 / 共 M 页 ━━━ 已读 X%  [›]`
     * PDF **无章节概念** ⇒ 两端各只有一个翻屏钮（TXT/EPUB 那两组各有「页」+「章」两枚），
     * 中段仍是「页码文案 + 全书进度条 + 已读百分比」，读数口径见 pure/readerFooter。
     */
    private buildFooter(): void {
        // 底栏挂到右侧栏（.rl-reader-main）内 —— 目录栏独立成一整列，底栏不再横跨到目录下方
        const mainCol = this.scrollEl?.closest('.rl-reader-main') as HTMLElement | null;
        const footer = (mainCol ?? this.container).createDiv({ cls: 'rl-reader-footer' });
        this.footEl = footer;

        // ① 左端：翻上一屏（PDF 唯一的「上」动作）
        const navL = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-l' });
        const prev = navL.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(prev, 'chevron-left');
        prev.setAttribute('data-tip', '翻上一屏');
        prev.addEventListener('click', () => this.scrollOneScreen(-1));

        // ② 中段：页码文案 → 全书进度条 → 已读 X%
        this.footerPageEl = footer.createSpan({ cls: 'rl-reader-fch' });
        const prog = footer.createDiv({ cls: 'rl-reader-fprog' });
        this.footerFillEl = prog.createDiv({ cls: 'rl-reader-fprog-fill' });
        this.footerPctEl = footer.createSpan({ cls: 'rl-reader-fpct' });

        // ③ 图标组：全屏 / 沉浸 / 自动（2026-09-23 #382 从设置菜单**搬到底栏**，与 TXT/EPUB 同一口径）
        //    用户原话（#351）：「这些高频操作做成图标按钮放到底部控制栏上，不要塞进设置面板里」。
        //    ⚠️ PDF 未接 TTS ⇒ **三枚**图标，不是 TXT/EPUB 的四枚（朗读那一枚等二期）。
        //    ⚠️ 图标名与 TXT/EPUB 逐字一致（maximize / eye / timer）：`setIcon` 遇未知名**静默失败**，
        //       换名必须同步进「图标白名单」断言，⛔ 别随手改。
        const fops = footer.createDiv({ cls: 'rl-reader-fops' });
        const mkFop = (icon: string, tip: string, onClick: () => void): HTMLButtonElement => {
            const b = fops.createEl('button', { cls: 'rl-btn rl-reader-btn' });
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', tip);
            b.addEventListener('click', onClick);
            return b;
        };
        this.fsBtnEl = mkFop('maximize', '全屏显示', () => this.toggleFullscreen());
        // ⚠️ 这一行与 TXT/EPUB **逐字同形、且必须单行** —— 既有断言按 `mkFop("eye"` 这种**连续形态**计数；
        //    写成跨行箭头（`() =>\n  this.setImmersive(…)`）会让 esbuild 把调用拆行 ⇒ 锚点断掉、计数掉到 2（#382 实测）。
        this.immersiveBtnEl = mkFop('eye', '沉浸模式：隐藏上下边栏（点击正文空白可收起 / 展开）', () => this.setImmersive(!this.immersive));
        this.autoBtnEl = mkFop('timer', '自动滚动 / 自动翻屏（再点停止，手动滚动即停；右键调速）', () => this.setAuto(!this.autoOn));
        this.autoBtnEl.addEventListener('contextmenu', (ev) => this.openAutoMenu(ev));
        if (!document.fullscreenEnabled) {
            this.fsBtnEl.disabled = true;
            this.fsBtnEl.setAttribute('data-tip', '当前环境不支持全屏');
        }

        // ④ 右端：翻下一屏
        const navR = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-r' });
        const next = navR.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(next, 'chevron-right');
        next.setAttribute('data-tip', '翻下一屏');
        next.addEventListener('click', () => this.scrollOneScreen(1));
    }

    /** 顶栏（对齐 TXT/EPUB 沉浸观感）：左目录折叠 icon + 标题 + 右 ≡设置菜单。
     *  🔴 无关闭按钮 —— 用户 2026-09-17 裁定：只能通过关闭所在标签页退出，界面不再提供主动关闭入口。
     *  按用户要求功能精简为：目录 + 字号(缩放)设置；批注摘抄入口已移除。 */
    private buildHeader(): void {
        const head = this.container.createDiv({ cls: 'rl-reader-head' });
        this.headEl = head;

        // 目录折叠开关（最左；点击 toggleToc；与 EPUB 侧栏开关一致）
        const sidebarToggle = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-sidebar-toggle', attr: { 'data-tip': '收起目录' } });
        safeSetIcon(sidebarToggle, 'panel-left-close');
        sidebarToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
        sidebarToggle.addEventListener('click', () => this.toggleToc());
        this.sidebarToggleEl = sidebarToggle;

        // 打开条目笔记（用户 2026-09-17 裁定：目录按钮右旁；图标 `notebook-text` 已核实存在于 Obsidian 图标集）
        const noteLinkBtn = head.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-reader-note-link',
            attr: { 'data-tip': `打开笔记：${this.options.title}` },
        });
        safeSetIcon(noteLinkBtn, 'notebook-text');
        noteLinkBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        noteLinkBtn.addEventListener('click', () => this.options.onOpenNote?.());

        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        // #345：标题挂 data-tip 全称 —— 窗口窄时书名会被省略号截断，悬停可看完整标题
        // （PDF 无快捷入口，故不参与「更多」⋮ 收纳；标题本身走流式三段，不会再压住右侧 ≡）
        titleWrap.createSpan({ cls: 'rl-reader-title', text: this.options.title, attr: { 'data-tip': this.options.title } });

        const ops = head.createDiv({ cls: 'rl-reader-ops' });
        // #382b 书签：PDF 只有这一个快捷入口（高亮/摘抄按用户裁定不做）。
        //   交互与另两个**有意不同**：它们进「模式」后单击正文定位；PDF 的位置就是「当前页 + 页内比例」
        //   ⇒ **一键存当前位置**，少一步、也不需要选区。容器沿用 `.rl-reader-quick`（样式同款）。
        //   🔴 放在 `ops` 内、≡ 之前 —— 与 TXT/EPUB 的快捷入口同一位置（#345 起的位置契约）。
        const quick = ops.createDiv({ cls: 'rl-reader-quick' });
        this.bmBtnEl = quick.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': '存书签（当前位置）' } });
        safeSetIcon(this.bmBtnEl, 'bookmark');
        this.bmBtnEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.bmBtnEl.addEventListener('click', () => this.addBookmark());
        // 设置（≡）：字号 = 缩放 −/+、全屏显示（下拉菜单，对齐 EPUB 观感）
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);

        // #379：标题绝对居中，宽度按实测两侧边缘算（PDF 左 2 钮 / 右仅设置 ⇒ 本就接近对称，仍走同一套算式）
        this.disposeHeadTitle = attachHeadTitle({ headEl: head, opsEl: ops, titleEl: titleWrap });
    }

    /** 设置下拉菜单（追加到 ops 下，CSS 绝对定位右对齐）：字号 −/+（映射缩放 ±，显示当前 %）+ 全屏显示。
     *  批注摘抄已按用户要求移除（PDF 无书签/翻译/高亮，故菜单仅这两项）。 */
    private buildSettingsMenu(ops: HTMLElement): void {
        const menu = ops.createDiv({ cls: 'rl-reader-menu hidden' });
        this.menuEl = menu;
        menu.addEventListener('mousedown', (ev) => ev.stopPropagation());

        // 缩放行（PDF **无字号概念** ⇒ 这一行调的是**页面缩放**，标签就叫「缩放」；
        // ⚠️ 旧标签写的是「字号」，与实际行为不符 ⇒ #382 改正，⛔ 别再写回「字号」）：滑条 50%-300% 步进 25% + 当前百分比文本。
        // ⚠️ PDF 缩放会清空并重渲染所有页，拖动过程只更新数值文本，松手（change）才真正应用。
        const fontRow = menu.createDiv({ cls: 'rl-reader-menu-row' });
        fontRow.createSpan({ cls: 'rl-reader-menu-label', text: '缩放' });
        this.menuScaleSlider = this.buildSlider(fontRow, {
            min: SCALE_MIN * 100,
            max: SCALE_MAX * 100,
            step: SCALE_STEP * 100,
            tip: '拖动调整页面缩放（←/→ 微调）',
            onInput: (v) => this.menuScaleVal?.setText(`${Math.round(v)}%`),
            onChange: (v) => this.applyScaleValue(v / 100),
        });
        this.menuScaleVal = fontRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 主题（用户 2026-09-16）：六档色卡并排 —— 跟随主题 / 经典白 / 夜间黑 / 护眼绿 / 深灰 / 羊皮纸；
        // 点击即换肤（容器变量覆盖）+ 写回设置；当前档加强调色外圈环（PDF 页面本体按原样渲染，只换阅读区底色）
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

        // 🔴 全屏 / 沉浸 / 自动 已迁到**底栏图标组**（见 `buildFooter` 的 `.rl-reader-fops`）：
        //    用户口径「这些高频操作做成图标按钮放到底部控制栏上，不要塞进设置面板里」（#351），
        //    PDF 于 2026-09-23 #382 补齐 —— 此前一直塞在菜单里当两字按钮，正是「PDF 看着还是旧 UI」的主因。
        //    ⚠️ PDF 未接 TTS ⇒ 底栏是三枚图标（不是四枚）。
    }

    /** 设置下拉开合切换：加/去 hidden + 按钮 active 态；打开时同步缩放/全屏文案 */
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

    /** 收起设置下拉（外部 mousedown / 滚动收起）；未开则跳过 */
    private hideSettings(): void {
        if (!this.settingsOpen) return;
        this.settingsOpen = false;
        this.menuEl?.addClass('hidden');
        this.settingsBtn?.removeClass('active');
    }

    /** 刷新菜单缩放文案与滑条位置（打开、调整后调用） */
    private syncSettingsLabels(): void {
        const pct = Math.round(this.scale * 100);
        if (this.menuScaleVal) this.menuScaleVal.setText(`${pct}%`);
        if (this.menuScaleSlider) this.menuScaleSlider.value = String(pct);
    }

    /** 同步主题色卡选中态（打开菜单、切换主题后调用） */
    private syncThemeSwatches(): void {
        for (const meta of READER_THEMES) {
            this.themeSwatches[meta.id]?.toggleClass('is-on', meta.id === this.theme);
        }
    }

    /** 应用主题：容器上只保留当前档的 rl-rt-* 类（follow = 无类，完整继承 Obsidian 主题） */
    private applyTheme(): void {
        for (const meta of READER_THEMES) {
            const cls = readerThemeClass(meta.id);
            if (cls) this.container.removeClass(cls);
        }
        const cls = readerThemeClass(this.theme);
        if (cls) this.container.addClass(cls);
    }

    /** 切换阅读主题（菜单色卡）：即时换肤 + 色卡选中态 + 写回设置持久化 */
    private setTheme(t: ReaderThemeId): void {
        this.theme = t;
        this.applyTheme();
        this.syncThemeSwatches();
        this.options.onThemeChange?.(t);
    }

    /** 全屏切换：已全屏 → 退出；否则对最近 .modal 请求全屏；异常/不支持静默 */
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

    /** 同步菜单三按钮高亮与全屏悬停提示（fullscreenchange、下拉打开、状态切换时调用） */
    private syncViewBtns(): void {
        const fs = !!document.fullscreenElement;
        if (this.fsBtnEl) {
            this.fsBtnEl.toggleClass("is-on", fs);
            if (!this.fsBtnEl.disabled) this.fsBtnEl.setAttribute("data-tip", fs ? "退出全屏" : "全屏显示");
        }
        this.immersiveBtnEl?.toggleClass("is-on", this.immersive);
        this.autoBtnEl?.toggleClass("is-on", this.autoOn);
    }

    /** 沉浸模式（移植自 TXT/EPUB，用户 2026-09-15）：隐藏上下边栏；点击正文空白收起/展开；再点按钮退出。
     *  ⚠️ PDF 页卡尺寸由缩放决定、不随视口高变化 → 无需像 TXT/EPUB 那样重排分页，只切边栏显隐即可。 */
    private setImmersive(on: boolean): void {
        if (on === this.immersive) return;
        this.immersive = on;
        this.container.toggleClass("rl-reader-focus", on);
        this.headEl?.toggleClass("hidden", on);
        this.footEl?.removeClass("rl-foot-show");
        // 🔴 #382 修（与 #351b 那处同因）：不再用 `settingsOpen` 门 —— 全屏 / 沉浸 / 自动自 #382 起在**底栏**（常显），
        //    带门就等于「设置菜单没开着时点了不亮」，正是用户 #351b 报过的「点击不保持高亮」的同一个真因。
        this.syncViewBtns();
    }

    /** 沉浸模式：点击正文空白 = 收起 / 展开上下边栏（判态读顶栏 .hidden，非沉浸态跳过） */
    private toggleBars(): void {
        if (!this.immersive || !this.headEl) return;
        if (this.headEl.hasClass("hidden")) {
            this.headEl.removeClass("hidden");
            this.footEl?.addClass("rl-foot-show");
        } else {
            this.headEl.addClass("hidden");
            this.footEl?.removeClass("rl-foot-show");
            this.hideSettings(); // 顶栏收起时一并收起设置下拉，防菜单悬在空中
        }
    }

    /** 正文点击：沉浸模式下切换上下边栏（有文本选中时不动作，交给摘抄 / 复制） */
    private onBodyClick = (): void => {
        if (!this.immersive) return;
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) return;
        this.toggleBars();
    };

    /** 自动滚动期间用户手动滚动/触摸 → 停自动（避免与自动滚动打架） */
    private onUserInterrupt = (): void => {
        if (!this.autoOn) return;
        this.stopAuto();
        this.syncViewBtns();
    };

    /**
     * 右键弹窗：自动滚动**速度**（#341 用户指令；PDF 无翻页模式 ⇒ 只有 px/s 一行）。
     * 滚动速度按帧读取 ⇒ 改完立刻生效，不需要重启 rAF。
     */
    private openAutoMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.autoBtnEl;
        if (!btn) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
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
                'data-tip': '拖动调整自动滚动速度（键盘 ←/→ 微调）',
            },
        });
        const val = line.createSpan({ cls: 'rl-reader-menu-val', text: autoSpeedLabel(this.autoScrollPx) });
        slider.addEventListener('input', () => val.setText(autoSpeedLabel(Number(slider.value))));
        slider.addEventListener('change', () => {
            this.autoScrollPx = clampAutoScrollPx(Number(slider.value));
            saveAutoScrollPx(this.autoScrollPx);
            val.setText(autoSpeedLabel(this.autoScrollPx));
        });
    }

    /** 开一个按钮右键弹窗（挂在按钮所在行下；先收旧的）
     *  🔴 #382 修（用户报障：「PDF阅读器的自动滚动模式右键无法调速」）—— 这是 #382 把「自动」从 **≡ 菜单**搬到
     *  **常显底栏**时**漏掉的两件配套**（与 #351b 同源，本仓第二次踩）。两件缺一都表现为「右键没反应」：
     *    ⑴ **浮层必须自己挡住 `mousedown`** —— 否则 `document` 的 `onDocMouseDown` 会先把浮层 `remove()` 掉，
     *      mousedown 与 mouseup 之间目标被换掉 ⇒ 浏览器把 click 派发到最近公共祖先（= 谁都不是）⇒ 滑条根本拖不动。
     *      ⚠️ 旧版浮层挂在 ≡ 菜单里，是被 `menu` 的 mousedown 挡板**顺带**保护着的；搬到 `.rl-reader-fops` 后就没人挡了。
     *    ⑵ **浮层方向**：底栏是容器的**最后一行**，而 `.rl-reader-pop` 基础规则是向下开（`top: calc(100% + 4px)`，
     *      包含块 = `.rl-reader-footer`）⇒ 开到容器外/视口外 ⇒ 观感就是「右键没反应」。锚点行是 `.rl-reader-fops`
     *      时必须**向上**开（`.rl-reader-pop-up`，配 `.rl-reader-fops { position: relative }` —— 两条 CSS 都是全局规则，已就位）。 */
    private openPop(btn: HTMLButtonElement): HTMLDivElement | null {
        this.closePop();
        const row = btn.parentElement as HTMLElement | null;
        if (!row) return null;
        const wrap = row.createDiv({ cls: 'rl-reader-pop' });
        wrap.addEventListener('mousedown', (ev) => ev.stopPropagation());
        if (row.hasClass('rl-reader-fops')) wrap.addClass('rl-reader-pop-up');
        this.popEl = wrap;
        return wrap;
    }

    /** 收起按钮右键弹窗（外部 mousedown） */
    private closePop(): void {
        this.popEl?.remove();
        this.popEl = null;
    }

    /** 打开/关闭自动滚动（移植自 TXT/EPUB）：连续匀速（速度 #341 起可调）；再点停止 */
    private setAuto(on: boolean): void {
        if (on === this.autoOn) return;
        this.stopAuto();
        if (on) {
            this.autoOn = true;
            this.startAutoScroll();
        }
        // 🔴 #382 修（同上「沉浸」那处）：自动按钮自 #382 起在**底栏**（常显）⇒ 状态同步不得带设置菜单门。
        this.syncViewBtns();
    }

    /** 开始自动滚动（rAF + 时间增量推进；到底由 autoTick 内的结尾判断接管） */
    private startAutoScroll(): void {
        if (this.autoRaf !== null) return;
        this.autoLastTs = 0;
        this.autoPos = null; // 起手先与真实位置对表（见 autoTick）
        this.autoRaf = requestAnimationFrame(this.autoTick);
    }

    /** 自动滚动帧：按时间增量推进（限幅防恢复/缩放锚定瞬间跳变）；到结尾自动停并提示 */
    private autoTick = (ts: number): void => {
        if (!this.autoOn) {
            this.autoRaf = null;
            return;
        }
        const dt = this.autoLastTs > 0 ? Math.min(0.1, (ts - this.autoLastTs) / 1000) : 0;
        this.autoLastTs = ts;
        const el = this.scrollEl;
        if (!this.restoring && dt > 0) {
            const max = el.scrollHeight - el.clientHeight;
            // #342：位置由**自己累积**（`advanceAutoPos`），⛔ 不能读回 `scrollTop` 再相加 ——
            //   `scrollTop` 写入被浏览器取整：120Hz 上 50px/s 每帧 0.417px ⇒ 被吸成 0 ⇒ 完全不动；
            //   60Hz 上 0.83px 又被抬成 1px ⇒ 实际超速 20%。偏差 > 2px 视为「外部挪过位置」→ 重新对表。
            const real = el.scrollTop;
            if (this.autoPos === null || Math.abs(real - this.autoPos) > 2) this.autoPos = real;
            const next = advanceAutoPos(this.autoPos, this.autoScrollPx, dt, max);
            this.autoPos = next;
            if (max > 0 && next < max - 0.5) {
                el.scrollTop = next;
            } else if (max <= 0 || next >= max - 0.5) {
                this.stopAuto();
                this.syncViewBtns();
                new Notice("已读完全书");
                return;
            }
        }
        this.autoRaf = requestAnimationFrame(this.autoTick);
    };

    /** 停止自动滚动（关自动 / 销毁时调用）：清 rAF + 复位开关 */
    private stopAuto(): void {
        this.autoOn = false;
        this.autoPos = null; // #342：下次开自动重新与真实位置对表
        if (this.autoRaf !== null) {
            window.cancelAnimationFrame(this.autoRaf);
            this.autoRaf = null;
        }
    }

    /** 翻一屏（底栏 ‹ 上一页 / 下一页 ›，与 TXT/EPUB 底栏口径统一；到开头/结尾给提示，避免「点了没反应」） */
    private scrollOneScreen(dir: 1 | -1): void {
        const el = this.scrollEl;
        const max = el.scrollHeight - el.clientHeight;
        if (dir < 0 && el.scrollTop <= 0) {
            new Notice("已是开头");
            return;
        }
        if (dir > 0 && el.scrollTop >= max - 1) {
            new Notice("已是结尾");
            return;
        }
        el.scrollTop += dir * Math.max(60, el.clientHeight * 0.9);
    }

    /** 面板尺寸变化（用户拖 Obsidian 侧栏宽度等）：重算页顶位置（页卡尺寸由缩放定，位置须重排） */
    onResize(): void {
        this.refreshPageTops();
    }

    private buildBody(): void {
        const body = this.container.createDiv({ cls: 'rl-reader-body' });

        // 左侧目录列：`目录 | 书签` 两个 tab（#382b 用户裁定：PDF **只做书签**；摘抄 tab 当年按用户要求移除）
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '文档目录' } });
        safeSetIcon(tocTab, 'list-tree');
        const bmTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签' } });
        safeSetIcon(bmTab, 'bookmark');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        // 书签 pane（默认隐藏；切 tab 时与目录 pane 显隐互换 —— 与 TXT/EPUB 的 `rl-reader-toc-pane` 同结构）
        const bmPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane hidden' });
        this.bmListEl = bmPane.createDiv({ cls: 'rl-reader-bm-list' });
        const setTab = (showBookmarks: boolean): void => {
            tocTab.toggleClass('active', !showBookmarks);
            bmTab.toggleClass('active', showBookmarks);
            tocPane.toggleClass('hidden', showBookmarks);
            bmPane.toggleClass('hidden', !showBookmarks);
            if (showBookmarks) this.tocEl.removeClass('collapsed');
        };
        tocTab.addEventListener('click', () => setTab(false));
        bmTab.addEventListener('click', () => setTab(true));
        this.bookmarks = [...(this.options.bookmarks ?? [])];
        this.buildBookmarkToc();
        // 首次打开即收起（对齐 TXT/EPUB；点顶栏图标或按 T 展开）
        if (this.tocCollapsed) this.tocEl.addClass('collapsed');
        // #382：目录栏**右缘可拖宽**（#339 那套：只写 CSS 变量 + localStorage 记忆，无返回值可 dispose）
        // —— 与 TXT/EPUB 同款，此前 PDF 缺这一件，是「看着不像同一套 UI」的另一处。
        attachTocResizer(this.tocEl);

        // 右侧滚动容器（连续滚动；textLayer 选中需要 user-select，防 Obsidian 全局拦截）
        // 右侧栏：正文 + 底栏同处一栏（目录栏因而独立成一整列，用户 2026-09-16）
        const mainCol = body.createDiv({ cls: 'rl-reader-main' });
        const frameWrap = mainCol.createDiv({ cls: 'rl-reader-frame' });
        this.scrollEl = frameWrap.createDiv({ cls: 'rl-pdf-scroll' });
        // 滚动实时刷新底栏进度/页码（此前 onScroll 未绑定，进度只在跨页/恢复等时机更新）
        this.scrollEl.addEventListener('scroll', this.onScroll);
        this.pagesEl = this.scrollEl.createDiv({ cls: 'rl-pdf-pages' });
        // 加载中占位
        const loadingEl = this.pagesEl.createDiv({ cls: 'rl-pdf-loading' });
        loadingEl.createSpan({ cls: 'rl-spinner rl-spinner-lg' }); // 1.0.4：解析期间的内联 spinner
        loadingEl.createSpan({ text: '正在加载 PDF…' });
    }

    // ── 加载与渲染 ──

    private async load(): Promise<void> {
        try {
            ensurePdfWorker();
            const task = pdfjsLib.getDocument({ data: this.options.data });
            this.pdf = await task.promise;
            this.numPages = this.pdf.numPages;
            // 通知外层（main 层据此校正进度基准 totalPage=本地页数；静默，失败不影响阅读）
            this.options.onPdfReady?.(this.numPages);
            this.pagesEl.empty();

            // 先建全部页容器（占位高度），再渲染第一页拿真实页高做基准——顺序不能反：
            // renderPage 依赖 this.pages[i] 已存在，否则第一页渲染被短路、estHeight 恒为初始值
            for (let i = 0; i < this.numPages; i++) {
                const el = this.pagesEl.createDiv({ cls: 'rl-pdf-page' });
                el.style.height = `${this.estHeight}px`;
                this.pages.push({ el, height: this.estHeight, top: 0, renderTask: null });
            }
            this.refreshPageTops();

            // 渲染第一页（同步等待）获取真实页高，统一校正未渲染页占位（非等高页渲染后各自校正）
            const first = await this.renderPage(0, true);
            if (first > 0) {
                this.estHeight = first;
                for (const pv of this.pages) {
                    if (pv.height !== first) {
                        pv.el.style.height = `${first}px`;
                        pv.height = first;
                    }
                }
                this.refreshPageTops();
            }

            // 目录（outline → 规整；pageIndex 点击时解析 dest 延迟补写）
            const outline = await this.pdf.getOutline();
            this.tocEntries = normalizePdfOutline(outline as unknown);
            this.buildToc();
            // 异步预解析 outline dest → 页码（pdf.js 原始条目无 pageIndex；补全后当前章高亮才有匹配）
            void this.resolveTocPageIndexes();

            // 视口虚拟化：只渲染可视 ± 缓冲页，离屏销毁
            this.observer = new IntersectionObserver(
                (entries) => {
                    for (const en of entries) {
                        const idx = this.findPageIndex(en.target as HTMLElement);
                        if (idx < 0) continue;
                        if (en.isIntersecting) void this.ensureRendered(idx);
                        else this.releasePage(idx);
                    }
                },
                { root: this.scrollEl, rootMargin: `${VIRTUAL_MARGIN}px 0px` },
            );
            for (const pv of this.pages) this.observer.observe(pv.el);

            // 恢复进度（页索引 + 页内比例 → 滚动位置）
            const p = this.options.progress;
            if (p && Number.isInteger(p.chapterIndex) && p.chapterIndex >= 0 && p.chapterIndex < this.numPages) {
                this.pendingScroll = { pageIndex: p.chapterIndex, ratio: Math.max(0, Math.min(1, p.scrollRatio || 0)) };
                this.lastPos = { chapterIndex: p.chapterIndex, scrollRatio: Math.max(0, Math.min(1, p.scrollRatio || 0)) };
            } else {
            }
            this.restoreScroll();
            this.updateProgress();
        } catch (err) {
            this.pagesEl.empty();
            this.pagesEl.createDiv({ cls: 'rl-pdf-loading', text: `PDF 加载失败：${err instanceof Error ? err.message : String(err)}` });
            new Notice(`PDF 加载失败：${err instanceof Error ? err.message : String(err)}`, 6000);
        }
    }

    /** 渲染指定页（true=同步等渲染完成；滚动触发时异步）。返回页高 px。 */
    private async renderPage(i: number, wait = false): Promise<number> {
        const pdf = this.pdf;
        const pv = this.pages[i];
        if (!pdf || !pv || pv.renderTask || this.renderingPages.has(i)) return pv?.height ?? 0;
        this.renderingPages.add(i);
        try {
            const page = await pdf.getPage(i + 1);
            const viewport = page.getViewport({ scale: this.scale });
            const dpr = window.devicePixelRatio || 1;
            const outScale = dpr;
            const canvas = pv.el.createEl('canvas', { cls: 'rl-pdf-canvas' });
            canvas.width = Math.max(1, Math.floor(viewport.width * outScale));
            canvas.height = Math.max(1, Math.floor(viewport.height * outScale));
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                this.renderingPages.delete(i);
                return 0;
            }
            ctx.setTransform(outScale, 0, 0, outScale, 0, 0);
            // pdfjs v4 render 参数为 canvasContext（v5 才改为 canvas）；HiDPI 由上方 ctx 预变换承载
            const renderTask = page.render({ canvasContext: ctx, viewport });
            pv.renderTask = renderTask;
            const done = renderTask.promise.then(() => {
                pv.renderTask = null;
                // 文本层（选中摘抄；textLayer div 覆盖 canvas）
                const tl = pv.el.createDiv({ cls: 'textLayer' });
                tl.style.width = `${viewport.width}px`;
                tl.style.height = `${viewport.height}px`;
                try {
                    const textLayer = new pdfjsLib.TextLayer({
                        textContentSource: page.streamTextContent(),
                        container: tl,
                        viewport,
                    });
                    void textLayer.render().then(() => {
                        // textLayer span 异步填充：restoreScroll 时可能未就绪，此处就绪后重试书签高亮
                        if (this.pendingHighlightPage === i) {
                            this.pendingHighlightPage = null;
                            this.highlightPending();
                        }
                    });
                } catch {
                    // 文本层不可用（扫描版/加密）：摘抄静默不可用，阅读不受影响
                }
            });
            if (wait) await done;
            else void done.catch(() => this.releasePage(i));

            // 渲染完成：校正容器高度 + 页顶缓存
            const h = viewport.height;
            pv.el.style.height = `${h}px`;
            pv.height = h;
            this.refreshPageTops();
            return h;
        } finally {
            this.renderingPages.delete(i);
        }
    }

    /** 页容器进入视口 → 确保渲染；已渲染跳过 */
    private async ensureRendered(i: number): Promise<void> {
        const pv = this.pages[i];
        if (!pv || pv.renderTask || this.renderingPages.has(i)) return;
        await this.renderPage(i);
    }

    /** 离屏销毁：取消渲染任务 + 清空容器（恢复占位高度防滚动跳动）；pdf.js page.cleanup 由销毁时隐式释放 */
    private releasePage(i: number): void {
        const pv = this.pages[i];
        if (!pv) return;
        pv.renderTask?.cancel();
        pv.renderTask = null;
        if (pv.el.children.length > 0) {
            pv.el.empty();
            pv.el.style.height = `${pv.height}px`;
        }
    }

    /** 页顶偏移缓存刷新（offsetTop 在高度校正后变化，滚动计算依赖） */
    private refreshPageTops(): void {
        let acc = 0;
        for (const pv of this.pages) {
            pv.top = acc;
            acc += pv.height;
        }
    }

    /** 由 DOM 元素反查页索引 */
    private findPageIndex(el: HTMLElement): number {
        return this.pages.findIndex((pv) => pv.el === el);
    }

    // ── 目录 / 书签 ──

    /** 目录渲染（嵌套展开；pageIndex 点击时才解析 dest 延迟补写，滚动到目标页）。
     *  渲染后收集行按钮（DOM 顺序 = 渲染 DFS 顺序 = flattenPdfOutline(tocEntries)，高亮按扁平索引切换）。 */
    private buildToc(): void {
        const list = this.tocListEl;
        list.empty();
        this.tocFlat = flattenPdfOutline(this.tocEntries);
        this.tocRowEls = [];
        if (this.tocEntries.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '本书没有目录（PDF 无 outline）' });
            return;
        }
        for (const item of this.tocEntries) {
            this.buildTocItem(list, item, 0);
        }
        this.tocRowEls = Array.from(list.querySelectorAll<HTMLElement>('.rl-reader-toc-item'));
        this.syncTocHighlight();
    }

    private buildTocItem(parent: HTMLElement, item: PdfOutlineItem, depth: number): void {
        const row = parent.createDiv({ cls: 'rl-reader-toc-row', attr: { style: `padding-left:${12 + depth * 14}px` } });
        const btn = row.createEl('button', { cls: 'rl-reader-toc-item', attr: { 'data-tip': item.label }, text: item.label });
        btn.addEventListener('click', () => void this.jumpToc(item));
        for (const child of item.children) {
            this.buildTocItem(parent, child, depth + 1);
        }
    }

    /** 目录跳转：outline dest → 页索引 → 滚动（dest 缺失时回退 pageIndex）。
     * 兼容两种 dest 形态：named destination（string → getDestination 解析）与直接引用数组（[ref, ...]）。 */
    private async jumpToc(item: PdfOutlineItem): Promise<void> {
        const pdf = this.pdf;
        if (!pdf) return;
        try {
            let pageIndex = item.pageIndex;
            if (pageIndex < 0 && item.dest !== undefined) {
                pageIndex = await this.resolveDestPage(item.dest);
                // 跳转解析成功即补写缓存（后续当前章高亮可直接用，免重复解析）
                if (pageIndex >= 0) {
                    item.pageIndex = pageIndex;
                    this.tocFlat = flattenPdfOutline(this.tocEntries);
                }
            }
            if (pageIndex >= 0) {
                // 先渲染目标页（虚拟化下可能未渲染）→ 真实高度校正后定位，避免占位高度滚动偏差
                void this.ensureRendered(pageIndex).then(() => {
                    this.scrollToPage(pageIndex);
                    this.syncTocHighlight();
                });
                return;
            }
            new Notice('该目录项无页码信息，无法跳转', 3000);
        } catch (err) {
            new Notice(`目录跳转失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 解析 outline dest → 页索引 0 基（-1 = 不可解析）。兼容 named destination（string）与直接引用数组。 */
    private async resolveDestPage(dest: unknown): Promise<number> {
        const pdf = this.pdf;
        if (!pdf) return -1;
        try {
            // pdf.js 内部 Ref（{num, gen}）未在顶层导出，用结构类型
            if (typeof dest === 'string') {
                const d = await pdf.getDestination(dest);
                if (d && d[0]) return pdf.getPageIndex(d[0] as { num: number; gen: number });
                return -1;
            }
            if (Array.isArray(dest)) {
                const ref = dest[0] as { num: number; gen: number };
                if (ref) return pdf.getPageIndex(ref);
            }
            return -1;
        } catch {
            return -1;
        }
    }

    /** 异步预解析全部目录条目 dest → pageIndex（pdf.js 原始 outline 无页码；后台并行补全后重建扁平列表并刷新高亮）。
     *  单条失败静默保留 -1（仍可展示、点击时按需再解析）；全部完成后追加一次 syncTocHighlight 兜底。 */
    private async resolveTocPageIndexes(): Promise<void> {
        const todo: PdfOutlineItem[] = [];
        const collect = (items: PdfOutlineItem[]): void => {
            for (const it of items) {
                if (it.pageIndex < 0 && it.dest !== undefined) todo.push(it);
                if (it.children.length > 0) collect(it.children);
            }
        };
        collect(this.tocEntries);
        if (todo.length === 0) return;
        await Promise.all(todo.map((it) => this.resolveDestPage(it.dest).then((p) => {
            if (p >= 0) it.pageIndex = p;
        })));
        this.tocFlat = flattenPdfOutline(this.tocEntries);
        this.syncTocHighlight();
    }

    /** 目录当前章高亮：当前页对应条目（chooseActivePdfIndex）加 .active 并滚入可视（对齐 TXT/EPUB 目录联动）；
     *  无匹配（目录前扉页 / 页码未解析）清空全部高亮。 */
    private syncTocHighlight(pageIndex?: number): void {
        if (this.tocRowEls.length === 0) return;
        const idx = chooseActivePdfIndex(this.tocFlat, pageIndex ?? this.currentPageIndex());
        this.tocRowEls.forEach((el, i) => el.toggleClass('active', i === idx));
        if (idx >= 0) this.tocRowEls[idx]?.scrollIntoView({ block: 'nearest' });
    }

    /** 摘抄书签列表（书签 tab 内容）：点击跳原书定位并高亮；无定位提示 */
    // ── #382b 书签（PDF **只做书签**：位置 = 当前页 + 页内比例） ──

    /** 存书签：**一键存当前位置**（不进模式、不需要选区 —— PDF 的位置就是「当前页 + 页内比例」）。
     *  🔴 两处单位/基准必须对齐（都很容易想当然）：
     *     `ReaderBookmark.chapter` 是 **1 基**（TXT/EPUB 存章号，PDF 存**页码** ⇒ `currentPageIndex()` 是 0 基，须 +1）；
     *     `pct` 是 **0-100 整数**（`currentPageRatio()` 返回 **0-1** ⇒ 须 ×100）。 */
    private addBookmark(): void {
        const idx = this.currentPageIndex();
        const pct = Math.round(this.currentPageRatio(idx) * 100);
        this.bookmarks = [...this.bookmarks, newBookmark(idx + 1, pct)];
        this.options.onBookmarksChange?.(this.bookmarks);
        this.buildBookmarkToc();
        new Notice(`已存书签：第 ${idx + 1} 页 · ${pct}%`);
    }

    /** 渲染侧栏书签列表：点击跳回该页（含页内比例）；右键删除（走宿主二次确认）。
     *  ⚠️ 行样式**复用目录行**（`.rl-reader-toc-item` + `.rl-reader-toc-label`）⇒ **零新增 CSS**；
     *     ⛔ 别照 TXT/EPUB 的 `.rl-reader-bm-item` 抄 —— 那套是「引用文本 + 定位行」双栏布局，
     *     而 PDF 书签**没有引用文本**（无选区），抄过来会留一个永远空着的引用块。 */
    private buildBookmarkToc(): void {
        const list = this.bmListEl;
        if (!list) return;
        list.empty();
        const n = this.bookmarks.length;
        this.bmBtnEl?.setAttribute('data-tip', n ? `存书签（当前位置）· 已有 ${n} 个` : '存书签（当前位置）');
        if (n === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无书签（点顶栏书签按钮存当前位置）' });
            return;
        }
        for (const bm of this.bookmarks) {
            const item = list.createEl('button', {
                cls: 'rl-reader-toc-item',
                attr: { 'data-tip': `第 ${bm.chapter} 页 · ${bm.pct}%` },
            });
            item.createSpan({ cls: 'rl-reader-toc-label', text: `第 ${bm.chapter} 页 · ${bm.pct}%` });
            item.addEventListener('click', () => this.jumpToBookmark(bm));
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                void this.deleteBookmark(bm);
            });
        }
    }

    /** 跳到书签：先到页顶，再补页内比例（`scrollToPage` 只滚到页顶）。 */
    private jumpToBookmark(bm: ReaderBookmark): void {
        const pageIndex = bm.chapter - 1;
        if (pageIndex < 0 || pageIndex >= this.numPages) return;
        this.scrollToPage(pageIndex);
        const pv = this.pages[pageIndex];
        if (pv && pv.height > 0) this.scrollEl.scrollTop = pv.top + (bm.pct / 100) * pv.height;
    }

    /** 删除书签（右键）：**必须先二次确认** —— ⛔ 不静默删（用户 2026-09-20 报过「右键直接删掉了」）。
     *  ⚠️ 确认走**宿主注入**的 `onConfirmClear`（宿主握有 App，才能开 ConfirmModal）；宿主没注入时**不删**（安全方向）。
     *     ⛔ 不用原生 `confirm`：阻塞主线程、且会与 Modal 关闭动画竞争（本仓 `ConfirmModal` 正是为此而建）。 */
    private async deleteBookmark(bm: ReaderBookmark): Promise<void> {
        const msg = `删除书签「第 ${bm.chapter} 页 · ${bm.pct}%」？`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : false;
        if (!ok) return;
        this.bookmarks = this.bookmarks.filter((b) => b !== bm);
        this.options.onBookmarksChange?.(this.bookmarks);
        this.buildBookmarkToc();
    }

    private buildExcerptToc(): void {
        const exs = this.options.excerpts ?? [];
        const list = this.exListEl;
        if (!list) return;
        list.empty();
        if (exs.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无摘抄' });
            return;
        }
        exs.forEach((ex) => {
            const item = list.createDiv({ cls: 'rl-reader-ex-item' });
            item.createDiv({ cls: 'rl-reader-ex-quote', text: truncateQuote(ex.quote) });
            item.createDiv({
                cls: 'rl-reader-ex-loc' + (ex.loc ? '' : ' none'),
                text: ex.loc ? `第${ex.loc.chapter}页 · ${ex.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => this.jumpExcerpt(ex));
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                const bid = ex.id;
                if (!bid) return;
                const ok = (await this.options.onDeleteExcerpt?.(bid)) ?? false;
                if (ok) this.removeExcerptItem(bid);
            });
        });
    }

    /** 删除成功后从书签列表移除并重绘 */
    private removeExcerptItem(blockId: string): void {
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => x.id !== blockId);
        this.buildExcerptToc();
    }

    /** 摘抄列表整体刷新（main 层摘抄写入成功后重读笔记注入） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.options.excerpts = excerpts;
        this.buildExcerptToc();
    }

    /** 摘抄书签跳转：loc.chapter = 页码 1 基，pct = 页内比例 → 滚动定位 + 文本高亮 */
    private jumpExcerpt(ex: ParsedExcerpt): void {
        if (!ex.loc) {
            new Notice('该摘抄无定位信息');
            return;
        }
        const pageIndex = ex.loc.chapter - 1;
        if (pageIndex < 0 || pageIndex >= this.numPages) return;
        const ratio = Math.max(0, Math.min(1, ex.loc.pct / 100));
        this.pendingHighlight = ex.quote;
        this.pendingHighlightPage = pageIndex;
        this.pendingScroll = { pageIndex, ratio };
        // 先渲染目标页（虚拟化下可能未渲染）→ 高度校正后恢复滚动 + 文本高亮（textLayer 就绪才能命中 span）
        void this.ensureRendered(pageIndex).then(() => this.restoreScroll());
    }

    // ── 缩放 / 目录折叠 ──

    /** 缩放 ±：重渲染可视页并锚定当前位置（记录当前页 + 页内比例，重渲染后恢复滚动） */
    /** 菜单滑条（range）：拖动实时预览（input 事件按帧合并——字号/行距每次变化都要重排正文，逐事件应用会卡）、
     *  松手落库（change，拖拽过程不写盘）；键盘 ←/→ 由 range 原生支持。 */
    private buildSlider(
        row: HTMLElement,
        opts: { min: number; max: number; step: number; tip: string; onInput: (v: number) => void; onChange: (v: number) => void },
    ): HTMLInputElement {
        const slider = row.createEl('input', {
            cls: 'rl-reader-menu-slider',
            attr: { type: 'range', min: String(opts.min), max: String(opts.max), step: String(opts.step), 'data-tip': opts.tip },
        });
        let pending: number | null = null;
        let raf = 0;
        const flush = (): void => {
            raf = 0;
            if (pending === null) return;
            const v = pending;
            pending = null;
            opts.onInput(v);
        };
        slider.addEventListener('input', () => {
            pending = Number(slider.value);
            if (!raf) raf = requestAnimationFrame(flush);
        });
        slider.addEventListener('change', () => opts.onChange(Number(slider.value)));
        return slider;
    }

    /** 设定缩放（滑条 / 键盘共用）：夹取范围 → 重渲染页面 → 恢复锚点位置 */
    private applyScaleValue(next: number): void {
        const clamped = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)) * 100) / 100;
        if (clamped === this.scale) {
            this.syncSettingsLabels();
            return;
        }
        const oldScale = this.scale;
        const anchor = { pageIndex: this.currentPageIndex(), ratio: this.currentPageRatio(this.currentPageIndex()) };
        this.scale = clamped;
        // 清空全部页容器（重渲染；高度先按旧高度 × 缩放比估算，渲染后校正）
        for (const pv of this.pages) {
            pv.renderTask?.cancel();
            pv.renderTask = null;
            if (pv.el.children.length > 0) pv.el.empty();
            pv.el.style.height = `${Math.max(100, pv.height * (clamped / oldScale))}px`;
        }
        this.refreshPageTops();
        this.pendingScroll = anchor;
        this.restoreScroll();
        // 重渲染可视页
        this.observer?.disconnect();
        for (const pv of this.pages) this.observer?.observe(pv.el);
        const firstVisible = this.currentPageIndex();
        for (let i = Math.max(0, firstVisible - 1); i <= Math.min(this.numPages - 1, firstVisible + 1); i++) {
            void this.ensureRendered(i);
        }
        this.syncSettingsLabels();
    }

    /** 缩放步进（键盘快捷键走此）：等价于 applyScaleValue(当前 + delta) */
    private adjustScale(delta: number): void {
        this.applyScaleValue(this.scale + delta);
    }

    private toggleToc(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.tocEl.toggleClass('collapsed', this.tocCollapsed);
        // 目录折叠后菜单文案不需变；icon 标题随折叠态提示展开/收起
        this.sidebarToggleEl?.setAttribute('data-tip', this.tocCollapsed ? '展开目录' : '收起目录');
    }

    // ── 滚动与进度 ──

    /** 当前视口顶部所在页索引（页顶缓存二分/线性查找） */
    private currentPageIndex(): number {
        const top = this.scrollEl.scrollTop;
        let idx = 0;
        for (let i = 0; i < this.pages.length; i++) {
            if (this.pages[i].top <= top + 1) idx = i;
            else break;
        }
        return idx;
    }

    /** 当前页内滚动比例（页顶 → 页底 0-1；页高不足一屏按顶） */
    private currentPageRatio(pageIndex: number): number {
        const pv = this.pages[pageIndex];
        if (!pv || pv.height <= 0) return 0;
        const rel = this.scrollEl.scrollTop - pv.top;
        return Math.max(0, Math.min(1, rel / pv.height));
    }

    /** 滚动到指定页（页顶；越界忽略） */
    private scrollToPage(pageIndex: number): void {
        if (pageIndex < 0 || pageIndex >= this.numPages) return;
        this.scrollEl.scrollTop = this.pages[pageIndex]?.top ?? 0;
    }

    /** 翻一页高（PageDown/PageUp） */
    private scrollByPage(dir: 1 | -1): void {
        this.scrollEl.scrollTop += dir * (this.scrollEl.clientHeight * 0.9);
    }

    /** 恢复滚动位置（首次加载 / 缩放锚定 / 书签跳转）；不触发进度保存 */
    private restoreScroll(): void {
        const ps = this.pendingScroll;
        if (!ps) return;
        this.pendingScroll = null;
        const pv = this.pages[ps.pageIndex];
        if (!pv) return;
        this.restoring = true;
        requestAnimationFrame(() => {
            this.scrollEl.scrollTop = pv.top + Math.max(0, Math.min(1, ps.ratio)) * pv.height;
            this.restoring = false;
            this.updateProgress();
            this.highlightPending();
        });
    }

    /** 滚动事件：rAF 节流 → 更新头部百分比 + 节流保存进度 */
    private onScroll = (): void => {
        if (this.restoring || this.scrollRaf !== null) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            if (this.restoring) return;
            const idx = this.currentPageIndex();
            const ratio = this.currentPageRatio(idx);
            this.lastPos = { chapterIndex: idx, scrollRatio: ratio };
            this.updateProgress();
            this.scheduleSave(idx, ratio);
        });
    };

    /** 更新底部工具条：左「第 N 页 / 共 M 页」+ 全书进度条填充 + 右「已读 X%」（旧头部文本 T 迁底部，与 TXT/EPUB 对齐）；
     *  顺带联动目录当前章高亮（滚动/恢复/翻页均经此同步） */
    private updateProgress(): void {
        if (this.numPages === 0) return;
        const idx = this.currentPageIndex();
        const pct = estimatePdfPercent(this.numPages, idx, this.currentPageRatio(idx));
        this.footerPageEl?.setText(`第 ${idx + 1} 页 / 共 ${this.numPages} 页`);
        this.footerFillEl?.style.setProperty('width', `${pct}%`);
        this.footerPctEl?.setText(`已读 ${pct}%`);
        this.syncTocHighlight(idx);
    }

    /** 滚动保存节流（300ms trailing） */
    private scheduleSave(pageIndex: number, ratio: number): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.options.onSaveProgress({ chapterIndex: pageIndex, scrollRatio: ratio });
        }, SAVE_THROTTLE);
    }

    /** 立即保存当前进度（关面板前调用，防最后一次滚动丢失）+ 落库整体百分比 */
    flushSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.numPages === 0) return;
        // 视图关闭时内容拆解 scrollTop 归零，实时读得 0/0 —— 会话内有阅读则用最后已知位置兜底（纯函数已单测）
        const live: ReaderPos = { chapterIndex: this.currentPageIndex(), scrollRatio: this.currentPageRatio(this.currentPageIndex()) };
        const pos = resolveFlushPos(live, this.lastPos);
        this.options.onSaveProgress(pos);
        this.options.onProgressPersist?.(estimatePdfPercent(this.numPages, pos.chapterIndex, pos.scrollRatio));
    }

    /** 书签跳转后：textLayer 内查找引用文本前 24 字符所在 span，滚动到该行并高亮 2.5s。
     * 未命中时保留 pendingHighlight（restoreScroll 的 rAF 可能早于 textLayer span 渲染），
     * 由目标页 textLayer render 完成回调（pendingHighlightPage 匹配）再次尝试；命中后清空。 */
    private highlightPending(): void {
        const quote = this.pendingHighlight;
        if (!quote) return;
        const target = quote.replace(/\s+/g, '').slice(0, 24);
        if (!target) {
            this.pendingHighlight = null;
            this.pendingHighlightPage = null;
            return;
        }
        const spans = this.pagesEl.querySelectorAll('.rl-pdf-page .textLayer span');
        for (const sp of Array.from(spans)) {
            const t = (sp.textContent ?? '').replace(/\s+/g, '');
            if (t.includes(target)) {
                this.pendingHighlight = null;
                this.pendingHighlightPage = null;
                (sp as HTMLElement).scrollIntoView({ block: 'center' });
                sp.classList.add('rl-pdf-hl');
                window.setTimeout(() => sp.classList.remove('rl-pdf-hl'), 2500);
                return;
            }
        }
        // 未命中：保留待重试（textLayer 就绪后由 render 回调驱动）
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

/** 摘抄书签引用文本截断（多行压平 + 超长省略号） */
function truncateQuote(s: string, n = 18): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > n ? flat.slice(0, n) + '…' : flat;
}
