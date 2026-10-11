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

    private stageEl!: HTMLDivElement;
    private imgEl: HTMLImageElement | null = null;
    private placeholderEl: HTMLElement | null = null;
    private headEl!: HTMLDivElement;
    private footEl!: HTMLDivElement;
    private footerPageEl!: HTMLSpanElement;
    private footerFillEl!: HTMLDivElement;
    private footerPctEl!: HTMLSpanElement;
    private settingsBtn!: HTMLButtonElement;
    private menuEl: HTMLElement | null = null;
    private settingsOpen = false;
    private menuZoomVal: HTMLSpanElement | null = null;
    private menuZoomSlider: HTMLInputElement | null = null;
    private themeSwatches: Partial<Record<ReaderThemeId, HTMLButtonElement>> = {};
    private fsBtnEl: HTMLButtonElement | null = null;
    private immersiveBtnEl: HTMLButtonElement | null = null;
    private immersive = false;
    private disposeHeadTitle: (() => void) | null = null;
    /** 保存节流定时器 */
    private saveTimer: number | null = null;
    /** 当前页的 blob URL（换页 / 销毁时 revoke，防内存泄漏） */
    private currentUrl: string | null = null;
    /** #540 下一页预取（单槽）：压缩包逐页解压有延迟，预取后翻页**零等待**（⛔ 只留一页，别攒缓存） */
    private nextBlob: { index: number; blob: Blob } | null = null;
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
        if (document.fullscreenEnabled) {
            document.addEventListener('fullscreenchange', this.onFsChange);
        }
        this.registerKeys();

        void this.renderPage();
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
    }

    private buildBody(): void {
        const main = this.container.createDiv({ cls: 'rl-reader-main' });
        const body = main.createDiv({ cls: 'rl-reader-body' });
        // 舞台：整页居中 + 溢出滚动（放大后平移靠它）
        this.stageEl = body.createDiv({ cls: 'rl-comic-stage' });
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
