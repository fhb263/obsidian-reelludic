// PDF 书籍阅读器面板 + 弹窗（Modal 包装，对齐 TxtReaderPanel / EpubReaderPanel 接口模式）：
// 连续滚动逐页 canvas 渲染（视口虚拟化：IntersectionObserver 只渲染可视 ± 缓冲页，离屏销毁释放内存）
// + textLayer 文本层选中摘抄（复用 ReaderExcerptModal 管道）+ PDF outline 目录侧栏 + 缩放 ±
// + 进度持久化（ReadingProgress 复用：chapterIndex = 页码索引 0 基，scrollRatio = 页内滚动比例）
// 渲染：pdfjs-dist 自渲染（Obsidian 禁用 Chromium 内置 PDF viewer）；worker 以 Blob 内联随产物打包
import { Modal, Notice, Scope, setIcon, type App } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { estimatePdfPercent, normalizePdfOutline, type PdfOutlineItem } from 'pure/pdfProgress';
import type { ParsedExcerpt } from 'pure/excerpt';

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
    /** 摘录选中回写：textLayer 选中文本 → 回调（page = 页码 1 基；loc = 页序 + 页内比例定位） */
    onExcerpt?: (quote: string, page: number | undefined, loc?: { chapter: number; pct: number }) => void;
    /** 摘抄书签数据源（笔记「## 摘抄」区解析；打开阅读器时读取） */
    excerpts?: ParsedExcerpt[];
    /** 删除摘抄回调（书签右键 → main 层确认删除；返回是否成功，成功则面板刷新书签列表） */
    onDeleteExcerpt?: (blockId: string) => Promise<boolean>;
    /** PDF 加载完成回调（numPages 已知；main 层做进度基准校正 totalPage=本地页数） */
    onPdfReady?: (numPages: number) => void;
}

/** 缩放范围与步进 */
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;
const SCALE_STEP = 0.25;
/** 滚动保存节流（ms，对齐 EPUB 阅读器） */
const SAVE_THROTTLE = 300;
/** 视口虚拟化缓冲（像素，提前渲染/延后销毁） */
const VIRTUAL_MARGIN = 300;

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
    /** 目录列折叠状态 */
    private tocCollapsed = false;
    /** 批注开关：开才捕获选中文本回写摘抄（默认关，防误触，对齐 EPUB） */
    private annotateOn = false;
    /** 批注开关按钮 */
    private annotateBtn: HTMLButtonElement | null = null;
    /** 进度百分比文本（头部「已读 X% · 剩余 Y%」） */
    private progressEl: HTMLSpanElement | null = null;
    /** 保存节流定时器 */
    private saveTimer: number | null = null;
    /** 滚动 rAF 节流 id */
    private scrollRaf: number | null = null;
    /** 程序化滚动/恢复期间标记（恢复进度/缩放锚定时不保存进度） */
    private restoring = false;
    /** 待恢复的滚动位置（页索引 + 页内比例；加载完成后消费一次） */
    private pendingScroll: { pageIndex: number; ratio: number } | null = null;
    /** 视口虚拟化观察器 */
    private observer: IntersectionObserver | null = null;
    /** 渲染中页的引用计数（清理时避免重复 cancel） */
    private renderingPages = new Set<number>();
    /** 首屏高度估算（未渲染页占位用；第一页渲染后校正） */
    private estHeight = 800;

    private tocEl!: HTMLDivElement;
    private tocListEl!: HTMLDivElement;
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
    ) {}

    /** 挂载渲染（容器需已铺满视图）：头部 + 目录侧栏 + 滚动容器 → 加载 PDF */
    mount(): void {
        const { container } = this;
        container.empty();
        container.addClass('rl-reader');

        this.buildHeader();
        this.buildBody();
        void this.load();

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

    /** 销毁清理：落盘进度 + 取消渲染任务 + 释放 pdf.js 文档 + 清空容器 */
    destroy(): void {
        this.flushSave();
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.scrollRaf !== null) {
            window.cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
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

    private buildHeader(): void {
        const head = this.container.createDiv({ cls: 'rl-reader-head' });
        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        const icon = titleWrap.createSpan({ cls: 'rl-reader-title-icon' });
        safeSetIcon(icon, 'file-text');
        titleWrap.createSpan({ cls: 'rl-reader-title', text: `${this.options.title} · PDF` });

        this.progressEl = head.createSpan({ cls: 'rl-reader-prog' });

        const ops = head.createDiv({ cls: 'rl-reader-ops' });
        // 缩放 − / +（0.25 步进，0.5-3.0；重渲染可视页并锚定当前位置）
        const zoomOut = ops.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { title: '缩小' }, text: '−' });
        zoomOut.addEventListener('click', () => this.adjustScale(-SCALE_STEP));
        const zoomIn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { title: '放大' }, text: '+' });
        zoomIn.addEventListener('click', () => this.adjustScale(SCALE_STEP));
        // 目录折叠
        const tocBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { title: '显示/隐藏目录' }, text: '目录' });
        tocBtn.addEventListener('click', () => this.toggleToc());
        // 批注开关（开启后 textLayer 选中文本 → 弹摘录确认 → 回写笔记「## 摘抄」区）
        this.annotateBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-annotate', attr: { title: '开启后选中文本可添加摘抄' } });
        this.annotateBtn.createSpan({ text: '批注' });
        this.annotateBtn.addEventListener('click', () => {
            this.annotateOn = !this.annotateOn;
            this.annotateBtn?.toggleClass('on', this.annotateOn);
        });
        // 关闭
        const closeBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-close', attr: { title: '关闭' } });
        safeSetIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.closeView());
    }

    private buildBody(): void {
        const body = this.container.createDiv({ cls: 'rl-reader-body' });

        // 左侧目录列（复用 rl-reader-toc 样式）：「目录 | 书签」双 tab
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { title: '章节目录' }, text: '目录' });
        const exTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { title: '摘抄书签' }, text: '书签' });
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        this.exListEl = exPane.createDiv({ cls: 'rl-reader-ex-list' });
        this.buildExcerptToc();
        tocTab.addEventListener('click', () => this.switchTocPane('toc', tocTab, exTab, tocPane, exPane));
        exTab.addEventListener('click', () => this.switchTocPane('ex', tocTab, exTab, tocPane, exPane));

        // 右侧滚动容器（连续滚动；textLayer 选中需要 user-select，防 Obsidian 全局拦截）
        const frameWrap = body.createDiv({ cls: 'rl-reader-frame' });
        this.scrollEl = frameWrap.createDiv({ cls: 'rl-pdf-scroll' });
        this.pagesEl = this.scrollEl.createDiv({ cls: 'rl-pdf-pages' });
        // 加载中占位
        this.pagesEl.createDiv({ cls: 'rl-pdf-loading', text: '正在加载 PDF…' });
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
                        this.bindTextSelection(i, tl);
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

    /** 目录渲染（嵌套展开；pageIndex 点击时才解析 dest 延迟补写，滚动到目标页） */
    private buildToc(): void {
        const list = this.tocListEl;
        list.empty();
        if (this.tocEntries.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '本书没有目录（PDF 无 outline）' });
            return;
        }
        for (const item of this.tocEntries) {
            this.buildTocItem(list, item, 0);
        }
    }

    private buildTocItem(parent: HTMLElement, item: PdfOutlineItem, depth: number): void {
        const row = parent.createDiv({ cls: 'rl-reader-toc-row', attr: { style: `padding-left:${12 + depth * 14}px` } });
        const btn = row.createEl('button', { cls: 'rl-reader-toc-item', attr: { title: item.label }, text: item.label });
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
            let pageIndex = -1;
            const dest = item.dest;
            // pdf.js 内部 Ref（{num, gen}）未在顶层导出，用结构类型
            if (typeof dest === 'string') {
                const d = await pdf.getDestination(dest);
                if (d && d[0]) pageIndex = await pdf.getPageIndex(d[0] as { num: number; gen: number });
            } else if (Array.isArray(dest)) {
                const ref = dest[0] as { num: number; gen: number };
                if (ref) pageIndex = await pdf.getPageIndex(ref);
            }
            if (pageIndex >= 0) {
                // 先渲染目标页（虚拟化下可能未渲染）→ 真实高度校正后定位，避免占位高度滚动偏差
                void this.ensureRendered(pageIndex).then(() => this.scrollToPage(pageIndex));
                return;
            }
            if (item.pageIndex >= 0) {
                void this.ensureRendered(item.pageIndex).then(() => this.scrollToPage(item.pageIndex));
                return;
            }
            new Notice('该目录项无页码信息，无法跳转', 3000);
        } catch (err) {
            new Notice(`目录跳转失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 摘抄书签列表（书签 tab 内容）：点击跳原书定位并高亮；无定位提示 */
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

    // ── 文本层摘抄 ──

    /** 页文本层绑定 mouseup 选中捕获（批注开关开启且选中非空才回调） */
    private bindTextSelection(i: number, tl: HTMLElement): void {
        tl.addEventListener('mouseup', () => {
            if (!this.annotateOn) return;
            const sel = window.getSelection();
            const text = sel?.toString().trim();
            if (text && this.options.onExcerpt) {
                const ratio = this.currentPageRatio(i);
                this.options.onExcerpt(text, i + 1, { chapter: i + 1, pct: Math.round(ratio * 100) });
                sel?.removeAllRanges();
            }
        });
    }

    // ── 缩放 / 目录折叠 ──

    /** 缩放 ±：重渲染可视页并锚定当前位置（记录当前页 + 页内比例，重渲染后恢复滚动） */
    private adjustScale(delta: number): void {
        const next = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, this.scale + delta)) * 100) / 100;
        if (next === this.scale) return;
        const oldScale = this.scale;
        const anchor = { pageIndex: this.currentPageIndex(), ratio: this.currentPageRatio(this.currentPageIndex()) };
        this.scale = next;
        // 清空全部页容器（重渲染；高度先按旧高度 × 缩放比估算，渲染后校正）
        for (const pv of this.pages) {
            pv.renderTask?.cancel();
            pv.renderTask = null;
            if (pv.el.children.length > 0) pv.el.empty();
            pv.el.style.height = `${Math.max(100, pv.height * (next / oldScale))}px`;
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
    }

    private toggleToc(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.tocEl.toggleClass('collapsed', this.tocCollapsed);
    }

    private switchTocPane(pane: 'toc' | 'ex', tocTab: HTMLButtonElement, exTab: HTMLButtonElement, tocPane: HTMLDivElement, exPane: HTMLDivElement): void {
        tocTab.toggleClass('active', pane === 'toc');
        exTab.toggleClass('active', pane === 'ex');
        tocPane.toggleClass('hidden', pane !== 'toc');
        exPane.toggleClass('hidden', pane !== 'ex');
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
            this.updateProgress();
            this.scheduleSave(idx, ratio);
        });
    };

    /** 更新头部「已读 X% · 剩余 Y%」 */
    private updateProgress(): void {
        if (!this.progressEl || this.numPages === 0) return;
        const idx = this.currentPageIndex();
        const pct = estimatePdfPercent(this.numPages, idx, this.currentPageRatio(idx));
        this.progressEl.setText(`已读 ${pct}% · 剩余 ${100 - pct}%`);
    }

    /** 当前整体百分比（关闭时写回 catalog 用） */
    private currentPercent(): number {
        if (this.numPages === 0) return 0;
        return estimatePdfPercent(this.numPages, this.currentPageIndex(), this.currentPageRatio(this.currentPageIndex()));
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
        this.options.onSaveProgress({ chapterIndex: this.currentPageIndex(), scrollRatio: this.currentPageRatio(this.currentPageIndex()) });
        this.options.onProgressPersist?.(this.currentPercent());
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

/** Modal 包装（对齐 EpubReaderModal：弹窗铺满 + 面板挂载/销毁） */
export class PdfReaderModal extends Modal {
    private panel: PdfReaderPanel | null = null;

    constructor(app: App, private options: PdfReaderOptions) {
        super(app);
    }

    /** 摘抄列表刷新（main 层摘抄写入成功后重读笔记注入；转发给面板重绘书签 tab） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.panel?.refreshExcerpts(excerpts);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = '92%';
        this.modalEl.style.maxWidth = '1200px';
        this.modalEl.style.height = '90%';
        contentEl.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden';
        this.panel = new PdfReaderPanel(contentEl, new Scope(this.app.scope), this.options, () => this.close());
        this.panel.mount();
    }

    onClose(): void {
        // 立即落库 percent + 最后一次滚动位置（PdfReaderPanel.destroy 无调用点，此处兜底；幂等，重复调用仅重写同值）
        this.panel?.flushSave();
        this.panel?.destroy();
        this.panel = null;
        this.contentEl.empty();
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
