// EPUB 书籍阅读器面板（原 Modal 弹窗，随 ReaderView 视图渲染）：目录侧栏 + iframe 渲染章节 + 单页连续滚动/双页两栏切换 + 进度持久化
// 排版：字号 ±（注入 iframe 内样式，会话级默认 16px，行距 1.8）；目录跳转（href 定位章节）；
// 滚动比例按章节持久化（与 TXT 阅读器共用 阅读进度/{id}.json，由 main.ts 读写）
// 渲染：章节 XHTML 文本 → iframe.srcdoc（注入基础 CSS；二进制资源如图片本期不支持，占位）
// 由 ReaderView 传入容器/scope 挂载；closeView 由视图层注入（detach leaf）
// batch1 镜像（T7）：头部三键 + auto-hide 外壳、侧栏 书签/摘抄 三 pane、选中动作条（书签/摘抄）、设置下拉、底部工具条；
// 正文为 iframe：选中/滚动/鼠标事件发生在 frame 内文档（不冒泡到宿主），监听在 onFrameLoad 内挂到 contentDocument。
import { Notice, setIcon, type Scope } from 'obsidian';
import { estimatePercent } from 'pure/readingProgress';
import type { ParsedExcerpt } from 'pure/excerpt';
import { newBookmark, type ReaderBookmark } from 'pure/bookmark';
import { chapterHighlights, findQuoteSegment, decideHighlightToggle, type ReaderHighlight } from 'pure/highlight';
import { normalizeScrollMode, pageToRatio, ratioToPage, isFirstPage, isLastPage, type ScrollMode } from 'pure/paged';

export interface EpubReaderOptions {
    /** 书籍标题（弹窗标题） */
    title: string;
    /** 解包后的文件映射（path → 文本内容；二进制资源如图片不在其中——本期仅文本渲染） */
    fileMap: Record<string, string>;
    /** 解析结果（epubParse 产出：title/chapters/toc/manifest） */
    book: { title: string; chapters: string[]; toc: { label: string; href: string }[]; manifest: Record<string, string> };
    /** 当前进度（恢复用；可为空） */
    progress?: { chapterIndex: number; scrollRatio: number };
    /** 保存进度回调（滚动节流调用） */
    onSaveProgress: (p: { chapterIndex: number; scrollRatio: number }) => void;
    /** 进度百分比落库回调（翻章/关闭时调用，percent 0-100；低频写 catalog） */
    onProgressPersist?: (percent: number) => void;
    /** 阅读排版设置（设置页持久化）：初始字号/行距；A± 调整写回 settings */
    settings?: { fontSize: number; lineHeight: number };
    /** 排版变更回调（字号/行距调整后写回设置持久化） */
    onSettingsChange?: (s: { fontSize: number; lineHeight: number }) => void;
    /** 滚动模式（连续/翻页；缺省 continuous）——会话内可切换，onScrollModeChange 写回设置 */
    scrollMode?: ScrollMode;
    /** 滚动模式变更回调（切换后写回设置持久化） */
    onScrollModeChange?: (m: ScrollMode) => void;
    /** 摘录选中回写（选中动作条「❝ 摘抄」→ 回调；loc = 当前章节+滚动比例定位） */
    onExcerpt?: (quote: string, page: number | undefined, loc?: { chapter: number; pct: number }) => void;
    /** 摘抄书签数据源（笔记「## 摘抄」区解析；打开阅读器时读取） */
    excerpts?: ParsedExcerpt[];
    /** 删除摘抄回调（书签右键 → main 层确认删除；返回是否成功，成功则面板刷新书签列表） */
    onDeleteExcerpt?: (blockId: string) => Promise<boolean>;
    /** 书签数据（打开阅读器时读取） */
    bookmarks?: ReaderBookmark[];
    /** 书签变更回调（面板内新增/删除后通知宿主落盘） */
    onBookmarksChange?: (list: ReaderBookmark[]) => void;
    /** 划词翻译回调（动作条「译翻译」/顶栏快捷翻译触发；宿主用 requestUrl POST DeepSeek AI，返回译文或 null（失败/空）） */
    onTranslate?: (text: string) => Promise<string | null>;
    /** 高亮数据源（笔记「## 高亮」区解析；打开阅读器时读取，用于页内持久黄标渲染） */
    highlights?: ReaderHighlight[];
    /** 高亮回写（选中 → 一键即黄即记：正文立即标 mark + 自动写笔记高亮区；返回新块 id，null=失败） */
    onHighlight?: (quote: string, loc: { chapter: number; pct: number }) => Promise<string | null>;
    /** 删除高亮（标注列表右键 → main 层确认 → 移除 <mark> + 从笔记删块；返回是否成功） */
    onDeleteHighlight?: (blockId: string) => Promise<boolean>;
}

/** 会话级字号（px，跨面板共享；null=未初始化，首次打开取设置默认） */
let readerFontSize: number | null = null;
/** 会话级行距（倍数，跨面板共享；null=未初始化，首次打开取设置默认） */
let readerLineHeight: number | null = null;
/** 字号调节范围（px） */
const FONT_MIN = 12;
const FONT_MAX = 30;
/** 行距调节范围（倍数） */
const LINE_MIN = 1.2;
const LINE_MAX = 2.4;
const LINE_STEP = 0.1;
/** 滚动保存节流（ms） */
const SAVE_THROTTLE = 300;
/** 头部 auto-hide 隐藏延时（ms）：保留方法以备将来复用 */
const HEAD_HIDE_DELAY = 1500;
/** 翻页动画时长（ms） */
const PAGE_FLIP_MS = 220;
/** 平滑滚动到 scrollLeft=target（ease-out 二次方）。overflow:hidden 下 scrollTo({behavior:smooth}) 不生效。 */
function animateScrollTo(el: HTMLElement, target: number, ms = PAGE_FLIP_MS): void {
    const state = (el as unknown as { __rlFlip?: { id: number } }).__rlFlip;
    const myId = (state?.id ?? 0) + 1;
    (el as unknown as { __rlFlip?: { id: number } }).__rlFlip = { id: myId };
    const start = el.scrollLeft;
    const change = target - start;
    if (change === 0) return;
    const t0 = performance.now();
    const step = (now: number): void => {
        const cur = (el as unknown as { __rlFlip?: { id: number } }).__rlFlip;
        if (!cur || cur.id !== myId) return;
        const p = Math.min(1, (now - t0) / ms);
        const ease = 1 - (1 - p) * (1 - p);
        el.scrollLeft = start + change * ease;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/** 宿主样式缓存（首次打开取一次，切章不再 getComputedStyle 触发主文档重排） */
let hostStyleCache: { fontFamily: string; bg: string; color: string } | null = null;
function getHostStyle(): { fontFamily: string; bg: string; color: string } {
    if (hostStyleCache === null) {
        const host = getComputedStyle(document.body);
        hostStyleCache = { fontFamily: host.fontFamily, bg: host.backgroundColor, color: host.color };
    }
    return hostStyleCache;
}

export class EpubReaderPanel {
    /** 当前章节索引（book.chapters 阅读序） */
    private chapterIndex: number;
    /** 目录条目（渲染目录列用） */
    private tocEntries: { label: string; href: string }[] = [];
    /** 目录列折叠状态 */
    private tocCollapsed = false;
    /** 双页两栏模式 */
    private doublePage = false;
    /** 滚动模式（连续/翻页；连续为主默认，翻页=单列一屏一页平移） */
    private mode: ScrollMode = 'continuous';
    /** 顶栏快捷「标注模式锁」：非空 = 该按钮已激活，之后选区 mouseup 自动触发对应标注动作 */
    private annotateMode: 'bookmark' | 'quote' | 'languages' | 'highlighter' | null = null;
    /** 四快捷按钮元素引用（激活态 .rl-quick-active 切换） */
    private quickBtns: Partial<Record<'bookmark' | 'quote' | 'languages' | 'highlighter', HTMLButtonElement>> = {};
    /** 翻页模式当前页 index / 总页数 / 单页横向位移（列宽+gap；仅 paged 用） */
    private pageIndex = 0;
    private totalPages = 1;
    private pageW = 1;
    /** 菜单「滚动模式」两 checkbox（连续/翻页；当前项 checked） */
    private modeContCb: HTMLInputElement | null = null;
    private modePageCb: HTMLInputElement | null = null;
    /** 目录列根元素（折叠/三 pane 容器） */
    private tocEl!: HTMLDivElement;
    /** 目录列表容器（章节目录 pane） */
    private tocListEl!: HTMLDivElement;
    /** 摘抄列表容器（摘抄 pane） */
    private exListEl: HTMLDivElement | null = null;
    /** 高亮列表容器（摘抄 pane 顶部「高亮」区） */
    private hlListEl: HTMLDivElement | null = null;
    /** 高亮区空态/计数文本 */
    private hlCountEl: HTMLDivElement | null = null;
    /** 「清除全部高亮」按钮 */
    private hlClearAllBtn: HTMLButtonElement | null = null;
    /** 书签列表容器（书签 pane 内） */
    private bmListEl: HTMLDivElement | null = null;
    /** 正文 iframe（srcdoc 每章重建） */
    private frameEl!: HTMLIFrameElement;
    /** 单页/双页切换按钮 */
    private layoutBtn!: HTMLButtonElement;
    /** 头部条元素（auto-hide 显示/隐藏目标） */
    private headEl: HTMLElement | null = null;
    /** 侧栏折叠开关按钮（head 首元素，最左；点击 toggleToc，图标/标题随折叠态变化） */
    private sidebarToggleEl: HTMLButtonElement | null = null;
    /** 头部 auto-hide 隐藏延时定时器 */
    private headHideTimer: number | null = null;
    /** 设置下拉菜单（≡ 按钮下方；hidden 初始收起） */
    private menuEl: HTMLDivElement | null = null;
    /** 设置按钮（打开态加 active 高亮） */
    private settingsBtn: HTMLButtonElement | null = null;
    /** 下拉当前开合状态（toggleSettings/hideMenu 同步） */
    private settingsOpen = false;
    /** 菜单字号当前值文本（调整后刷新） */
    private menuFontVal: HTMLSpanElement | null = null;
    /** 菜单行距当前值文本（调整后刷新） */
    private menuLineVal: HTMLSpanElement | null = null;
    /** 菜单「全屏显示」标签（全屏态切换为「退出全屏」） */
    private fsLabelEl: HTMLSpanElement | null = null;
    /** fullscreenchange 已注册标记（destroy 对称注销） */
    private fsListenerRegistered = false;
    /** 底部工具条：当前章标题文本 */
    private footerFchEl!: HTMLSpanElement;
    /** 底部工具条：章内/全书百分比文本（updateProgress 刷新） */
    private footerFpctEl!: HTMLSpanElement;
    /** 底部工具条：全书进度条填充（宽度 = 全书百分比） */
    private footerFillEl!: HTMLDivElement;
    /** 选中文本动作条（正文选区上方浮动 ★书签/❝摘抄/高亮/翻译；初始 .hidden） */
    private selbar: HTMLDivElement | null = null;
    /** 动作条坐标换算父容器（正文 .rl-reader-body；内联 relative 作定位上下文） */
    private selbarParent: HTMLElement | null = null;
    /** 当前选区记录（选中瞬间固化 文本/章/百分比；hideSelbar 时清空） */
    private selRecord: { text: string; chapter: number; pct: number } | null = null;
    /** 译文就地浮层卡片（划词翻译结果；.hidden 收起；翻译批新增） */
    private translateCard: HTMLDivElement | null = null;
    /** 译文卡片内容容器（loading/译文/错误态更新目标） */
    private translateCardBody: HTMLDivElement | null = null;
    /** 高亮本地态（真源在笔记；打开时 options.highlights 注入，一键后本地追加即时渲染，删高亮本地移除） */
    private highlightList: ReaderHighlight[] = [];
    /** 保存节流定时器 */
    private saveTimer: number | null = null;
    /** 滚动 rAF 节流 id（同一帧多次滚动合并处理一次，避免高频读 scrollHeight 强制布局） */
    private scrollRaf: number | null = null;
    /** 自动翻章延后定时器（滚动事件内不重建 iframe，宏任务再切章） */
    private switchTimer: number | null = null;
    /** 程序化滚动/恢复期间禁止自动翻章与保存（避免恢复进度时误触发） */
    private restoring = false;
    /** 首次渲染标记：仅第一次渲染恢复进度比例，切章后回顶部 */
    private firstRender = true;
    /** 章节加载后待恢复的滚动比例（0-1） */
    private pendingRatio = 0;
    /** 摘抄/书签跳转目标比例（0-1；切章后经 pendingRatio 恢复，一次性） */
    private jumpRatio: number | null = null;
    /** 摘抄/书签跳转后待高亮的引用文本（iframe load 完成后查找段落高亮，一次性） */
    private pendingHighlight: string | null = null;
    /** 各章字符数（百分比估算加权；懒计算） */
    private chapterSizesCache: number[] | null = null;
    /** 会话行距（倍数，初始取设置默认 1.8） */
    private lineHeight: number;
    /** 全屏态变化：同步菜单全屏标签文案 */
    private onFsChange = (): void => {
        this.syncFullscreenLabel();
    };
    /** 面板外 mousedown：收起选中动作条 + 设置下拉（mount 注册 / destroy 注销）；iframe 内容 mousedown 同样走此回调
     *  （iframe 事件不冒泡到宿主 document，onFrameLoad 内单独挂到 frame 文档；两者自身 mousedown 已 stopPropagation 不会触发） */
    private onDocMouseDown = (): void => {
        this.hideSelbar();
        this.hideMenu();
        this.hideTranslateCard();
    };

    constructor(
        private container: HTMLElement,
        private scope: Scope,
        private options: EpubReaderOptions,
        private closeView: () => void,
    ) {
        // 会话字号：首次打开取设置默认值，后续同会话 A± 调整共享
        if (readerFontSize === null) readerFontSize = options.settings?.fontSize ?? 16;
        this.lineHeight = options.settings?.lineHeight ?? 1.8;
        if (readerLineHeight === null) readerLineHeight = this.lineHeight;
        const p = options.progress;
        this.chapterIndex =
            p && Number.isInteger(p.chapterIndex) && p.chapterIndex >= 0 && p.chapterIndex < options.book.chapters.length
                ? p.chapterIndex
                : 0;
        this.highlightList = options.highlights ?? [];
        this.mode = normalizeScrollMode(options.scrollMode);
    }

    /** 挂载渲染（替代原 Modal.onOpen；容器需已铺满视图） */
    mount(): void {
        const { container } = this;
        container.empty();
        container.addClass('rl-reader');

        this.buildHeader();
        // 顶部常驻；自动隐藏撤销
        this.buildBody();
        // 译文就地浮层卡片（挂 selbarParent，buildBody 后已就绪）
        this.buildTranslateCard();
        // 底部工具条：章名 + 章内/全书百分比 + 进度条 + 翻屏/翻章按钮（head/body 之后，.rl-reader 纵向排列）
        this.buildFooter();
        // 全屏态变化（Esc/按钮退出）同步下拉「全屏显示/退出全屏」文案；桌面 Electron 支持，非桌面环境跳过
        if (document.fullscreenEnabled) {
            document.addEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = true;
        }
        // 点击面板外任意处收起选中动作条 / 设置下拉（新选区起点 mousedown 也在其中；两者自身 mousedown 已阻止冒泡）
        document.addEventListener('mousedown', this.onDocMouseDown);
        // 初始 pane 激活态同步：默认目录（头部三键首键 + 侧栏 tab 高亮一致）
        this.activatePane('toc');
        this.syncSidebarToggle();
        this.renderChapter();

        // 键盘翻页/翻章：← 上一页（翻页）/上一章（连续）；→ 下一页/下一章（scope 由 ReaderView 注入）
        this.scope.register([], 'ArrowLeft', () => {
            this.goPrevPage();
            return false;
        });
        this.scope.register([], 'ArrowRight', () => {
            this.goNextPage();
            return false;
        });
        // 键盘字号/目录：+/−（或 =/−）调字号、T 目录开关
        this.scope.register([], '=', () => {
            this.adjustFont(1);
            return false;
        });
        this.scope.register([], '+', () => {
            this.adjustFont(1);
            return false;
        });
        this.scope.register([], '-', () => {
            this.adjustFont(-1);
            return false;
        });
        this.scope.register([], 'T', () => {
            this.toggleToc();
            return false;
        });
    }

    /** 销毁清理（替代原 Modal.onClose）：刷新未落盘进度 + 清空容器 */
    destroy(): void {
        this.flushSave();
        this.resetAnnotate(); // 关面板复位标注模式
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.fsListenerRegistered) {
            document.removeEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = false;
        }
        // 选中动作条/设置下拉 document 监听随面板一并注销（bar 本身随 container.empty 移除；iframe 文档监听随 srcdoc 重建自动回收）
        document.removeEventListener('mousedown', this.onDocMouseDown);
        if (this.scrollRaf !== null) {
            window.cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
        if (this.switchTimer !== null) {
            window.clearTimeout(this.switchTimer);
            this.switchTimer = null;
        }
        if (this.headHideTimer !== null) {
            window.clearTimeout(this.headHideTimer);
            this.headHideTimer = null;
        }
        this.container.empty();
    }

    // ── 构建：头部 ──

    private buildHeader(): void {
        const head = this.container.createDiv({ cls: 'rl-reader-head' });
        this.headEl = head;

        // 侧栏折叠/展开开关（最左；点击 toggleToc；图标与标题随折叠态变化）
        const sidebarToggle = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-sidebar-toggle', attr: { 'data-tip': '收起目录' } });
        safeSetIcon(sidebarToggle, 'panel-left-close');
        sidebarToggle.addEventListener('mousedown', (ev) => ev.stopPropagation());
        sidebarToggle.addEventListener('click', () => this.toggleToc());
        this.sidebarToggleEl = sidebarToggle;

        // 顶栏左快捷入口：书签/批注/翻译/高亮 —— 标注模式锁（激活后选中即自动触发；再点退出）
        const quickWrap = head.createDiv({ cls: 'rl-reader-quick' });
        const mkQuick = (id: 'bookmark' | 'quote' | 'languages' | 'highlighter', title: string): HTMLButtonElement => {
            const b = quickWrap.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { title } });
            safeSetIcon(b, id);
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => this.toggleAnnotate(id));
            this.quickBtns[id] = b;
            return b;
        };
        mkQuick('bookmark', '书签模式：单击正文存书签，再点退出');
        mkQuick('quote', '批注模式：选中文字即加摘抄，再点退出');
        mkQuick('languages', '翻译模式：选中文字即翻译，再点退出');
        mkQuick('highlighter', '高亮模式：选中文字即高亮，再点退出');

        // 目录/书签/摘抄 切换改由侧栏 tab 行承担（顶部仅渲染一次）；保留 ⇆双页 等 ops 按钮
        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        const icon = titleWrap.createSpan({ cls: 'rl-reader-title-icon' });
        safeSetIcon(icon, 'book-open');
        titleWrap.createSpan({ cls: 'rl-reader-title', text: `${this.options.title} · EPUB` });

        const ops = head.createDiv({ cls: 'rl-reader-ops' });
        // 单页/双页切换（EPUB 专属，保留）
        this.layoutBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': '单页/双页切换' }, text: '⇆ 双页' });
        this.layoutBtn.addEventListener('click', () => this.toggleLayout());
        // 阅读设置（≡）：T6 下拉菜单（字号/行距/滚动模式状态/全屏）；行距±按钮已并入菜单
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        // 阻止 mousedown 冒泡到 document（onDocMouseDown 会先收起菜单，导致 click toggle 逻辑反相）
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);
    }

    /**
     * 设置下拉菜单（追加到 ops 下，CSS 绝对定位右对齐 ops 底部）：
     * 字号 −/+（adjustFont）、行距 −/+（adjustLineHeight）、滚动模式状态（连续滚动当前 / 翻页式置灰）、全屏显示。
     * 菜单自身 mousedown 阻止冒泡：点行内动作不触发 onDocMouseDown 收起；点外部才关（toggleSettings 反向切换即可）。
     */
    private buildSettingsMenu(ops: HTMLElement): void {
        const menu = ops.createDiv({ cls: 'rl-reader-menu hidden' });
        this.menuEl = menu;
        menu.addEventListener('mousedown', (ev) => ev.stopPropagation());

        // 字号行：− / {n}px / +
        const fontRow = menu.createDiv({ cls: 'rl-reader-menu-row' });
        fontRow.createSpan({ cls: 'rl-reader-menu-label', text: '字号' });
        const fontMinus = fontRow.createEl('button', { cls: 'rl-btn rl-reader-menu-btn', text: '−' });
        fontMinus.setAttribute('data-tip', '减小字号');
        fontMinus.addEventListener('click', () => this.adjustFont(-1));
        this.menuFontVal = fontRow.createSpan({ cls: 'rl-reader-menu-val' });
        const fontPlus = fontRow.createEl('button', { cls: 'rl-btn rl-reader-menu-btn', text: '+' });
        fontPlus.setAttribute('data-tip', '增大字号');
        fontPlus.addEventListener('click', () => this.adjustFont(1));

        // 行距行：− / {n} / +（步进 LINE_STEP=0.1，范围 LINE_MIN-MAX）
        const lineRow = menu.createDiv({ cls: 'rl-reader-menu-row' });
        lineRow.createSpan({ cls: 'rl-reader-menu-label', text: '行距' });
        const lineMinus = lineRow.createEl('button', { cls: 'rl-btn rl-reader-menu-btn', text: '−' });
        lineMinus.setAttribute('data-tip', '减小行距');
        lineMinus.addEventListener('click', () => this.adjustLineHeight(-LINE_STEP));
        this.menuLineVal = lineRow.createSpan({ cls: 'rl-reader-menu-val' });
        const linePlus = lineRow.createEl('button', { cls: 'rl-btn rl-reader-menu-btn', text: '+' });
        linePlus.setAttribute('data-tip', '增大行距');
        linePlus.addEventListener('click', () => this.adjustLineHeight(LINE_STEP));

        // 滚动模式（D4b）：连续/翻页两标签可点切换，当前项 checked 高亮；点击写回设置 + 重建章节视图
        const modeRow = menu.createDiv({ cls: 'rl-reader-menu-row' });
        modeRow.createSpan({ cls: 'rl-reader-menu-label', text: '滚动模式' });
        const mkModeCb = (text: string, m: ScrollMode): HTMLInputElement => {
            const lab = modeRow.createEl('label', { cls: 'rl-reader-menu-check' });
            const cb = lab.createEl('input', { attr: { type: 'checkbox' } });
            lab.createSpan({ text });
            cb.checked = this.mode === m;
            cb.setAttribute('data-tip', m === 'paged' ? '按屏翻页（每页一屏宽）' : '连续滚动');
            lab.addEventListener('mousedown', (ev) => ev.stopPropagation());
            lab.addEventListener('click', () => this.setMode(m));
            return cb;
        };
        this.modeContCb = mkModeCb('连续滚动', 'continuous');
        this.modePageCb = mkModeCb('翻页式', 'paged');

        // 全屏显示：整行按钮；目标 = 弹窗 .modal（兼容旧弹窗宿主）/ 视图容器；桌面 Electron 支持，失败/不支持静默
        const fsBtn = menu.createEl('button', { cls: 'rl-reader-menu-row rl-reader-menu-fs' });
        fsBtn.addEventListener('click', () => this.toggleFullscreen());
        this.fsLabelEl = fsBtn.createSpan({ text: '全屏显示' });
        if (!document.fullscreenEnabled) {
            fsBtn.disabled = true;
            fsBtn.setAttribute('data-tip', '当前环境不支持全屏');
        }
    }

    /** 设置下拉开合切换：加/去 hidden + 按钮 active 态；打开时同步当前字号/行距/全屏文案 */
    private toggleSettings(): void {
        if (!this.menuEl) return;
        // ≡ mousedown 已 stopPropagation（防 doc 先收起导致 toggle 反相），故这里显式收起可能残留的选中动作条
        this.hideSelbar();
        this.settingsOpen = !this.settingsOpen;
        this.menuEl.toggleClass('hidden', !this.settingsOpen);
        this.settingsBtn?.toggleClass('active', this.settingsOpen);
        if (this.settingsOpen) {
            this.syncSettingsLabels();
            this.syncModeLabels();
            this.syncFullscreenLabel();
        }
    }

    /** 收起设置下拉（外部 mousedown / 视情况调用）；未开则跳过 */
    private hideMenu(): void {
        if (!this.settingsOpen) return;
        this.settingsOpen = false;
        this.menuEl?.addClass('hidden');
        this.settingsBtn?.removeClass('active');
    }

    /** 刷新菜单字号/行距当前值文本（打开、调整后调用） */
    private syncSettingsLabels(): void {
        if (this.menuFontVal) this.menuFontVal.setText(`${this.currentFontPx()}px`);
        if (this.menuLineVal) {
            const lh = Math.round(this.currentLineHeight() * 100) / 100;
            this.menuLineVal.setText(`${lh}`);
        }
    }

    /** 同步滚动模式两 checkbox（当前项 checked） */
    private syncModeLabels(): void {
        if (this.modeContCb) this.modeContCb.checked = this.mode === 'continuous';
        if (this.modePageCb) this.modePageCb.checked = this.mode === 'paged';
    }

    // ── 翻页模式（iframe 内 body 单列 columns 分页 + transform 逐页平移） ──

    private isPaged(): boolean {
        return this.mode === 'paged';
    }

    private frameDoc(): Document | null {
        return this.frameEl.contentDocument;
    }

    /** iframe 内滚动元素（连续模式纵向；翻页模式体宽度超 frame，用其测总宽）——复用滚动节区既有 frameScroller() */

    /** 章内前进比例（0-1）：连续=iframe 纵向滚动比例；翻页=页index/总页−1 */
    private currentRatio(): number {
        if (this.isPaged()) return pageToRatio(this.pageIndex, this.totalPages);
        const scroller = this.frameScroller();
        if (!scroller) return 0;
        const max = scroller.scrollHeight - this.frameEl.clientHeight;
        return max > 0 ? scroller.scrollTop / max : 0;
    }

    /** 翻页模式：让 iframe 的滚动元素(html)成为 CSS 多列容器，整章内容按可视宽/高一屏一列横向排开，
     *  滚动元素横向溢出 → scrollLeft 逐屏翻页（方案 v2：对齐 TXT，免 body transform 水土不服）。 */
    private setupPagedLayout(doc: Document): number {
        const root = (doc.scrollingElement || doc.documentElement) as HTMLElement | null;
        if (!root) return 1;
        const fw = Math.max(120, this.frameEl.clientWidth);
        const fh = Math.max(60, this.frameEl.clientHeight);
        const gap = 2;
        // html 设 columns：内容自然按 fh 高分列（列高=可视高），列向右侧溢出
        root.style.columnWidth = `${fw}px`;
        root.style.columnGap = `${gap}px`;
        root.style.columnFill = 'auto';
        root.style.overflowX = 'hidden';
        root.style.overflowY = 'hidden';
        // 让 html 高度恰一屏，令列只在 fh 内断行并横向溢出（不出现纵向滚动）
        root.style.maxHeight = `${fh}px`;
        root.style.height = `${fh}px`;
        // body 参与 html 列流：清双栏/居中限制，避免干扰
        const body = doc.body;
        if (body) {
            body.style.maxWidth = 'none';
            body.style.columnCount = '';
            body.style.margin = '0 auto';
            // 版心：内容不占满整列，左右等内边距居中（对齐连续模式 EPUB body 720px 限宽），避免全宽
            const readW = 720;
            const lr = Math.max(0, Math.round((fw - readW) / 2));
            if (lr > 0) {
                body.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, blockquote, li').forEach((p) => {
                    p.style.paddingLeft = `${lr}px`;
                    p.style.paddingRight = `${lr}px`;
                });
            }
        }
        const pageW = fw + gap;
        this.pageW = pageW;
        this.totalPages = Math.max(1, Math.round(root.scrollWidth / pageW));
        return this.totalPages;
    }

    /** 关闭翻页列式（切回连续：清滚动元素列样式 + 还原 html 滚动） */
    private teardownPagedLayout(doc: Document): void {
        const root = (doc.scrollingElement || doc.documentElement) as HTMLElement | null;
        const body = doc.body;
        if (root) {
            root.style.columnWidth = '';
            root.style.columnGap = '';
            root.style.columnFill = '';
            root.style.overflowX = '';
            root.style.overflowY = '';
            root.style.maxHeight = '';
            root.style.height = '';
        }
        if (body) {
            body.style.maxWidth = '';
            body.style.columnCount = '';
            body.style.margin = '';
            body.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, blockquote, li').forEach((p) => {
                p.style.paddingLeft = '';
                p.style.paddingRight = '';
            });
        }
        this.totalPages = 1;
        this.pageIndex = 0;
        this.pageW = 1;
    }

    /** 翻页模式：横向滚动 iframe 滚动元素到第 N 列起始（scrollLeft），更新 pageIndex + 进度 */
    private goToPage(page: number, save = true): void {
        const doc = this.frameDoc();
        const root = doc ? ((doc.scrollingElement || doc.documentElement) as HTMLElement | null) : null;
        if (!root) return;
        const t = this.totalPages;
        const p = Math.max(0, Math.min(t - 1, Math.round(page)));
        if (p === this.pageIndex && !save) return;
        this.pageIndex = p;
        const target = p * this.pageW;
        animateScrollTo(root, target);
        this.updateProgress();
        if (save) this.scheduleSave(pageToRatio(p, t));
    }

    /** 切到上一章末页（switchChapter 内部会 flushSave 当前章 + 渲染；jumpRatio=1 令上一章载入后定位末页） */
    private switchToPrevChapterLast(): void {
        this.jumpRatio = 1;
        this.switchChapter(this.chapterIndex - 1);
    }

    /** 下一页（翻页=翻页；连续=翻章） */
    private goNextPage(): void {
        if (!this.isPaged()) {
            this.navNext();
            return;
        }
        if (!isLastPage(this.pageIndex, this.totalPages)) {
            this.goToPage(this.pageIndex + 1);
            return;
        }
        if (this.chapterIndex < this.options.book.chapters.length - 1) {
            this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
            this.switchChapter(this.chapterIndex + 1);
        } else {
            new Notice('已是最后一页');
        }
    }

    /** 上一页（翻页=翻页；连续=翻章） */
    private goPrevPage(): void {
        if (!this.isPaged()) {
            this.navPrev();
            return;
        }
        if (!isFirstPage(this.pageIndex)) {
            this.goToPage(this.pageIndex - 1);
            return;
        }
        if (this.chapterIndex > 0) {
            this.switchToPrevChapterLast();
        } else {
            new Notice('已是第一页');
        }
    }

    /** 切换滚动模式（下拉）：更新 mode + 重建当前章（applyLayout/buildFrameDoc 分支），写回设置 */
    private setMode(m: ScrollMode): void {
        if (m === this.mode) return;
        const keepRatio = this.currentRatio();
        this.mode = m;
        this.options.onScrollModeChange?.(m);
        if (this.settingsOpen) this.syncModeLabels();
        // 重建当前章：renderChapter 会用新 mode 生成 srcdoc（翻页=单列 columns 样式），载入后按原比例对页
        this.jumpRatio = keepRatio;
        this.renderChapter();
    }

    /** 会话当前字号（px） */
    private currentFontPx(): number {
        return readerFontSize ?? this.options.settings?.fontSize ?? 16;
    }

    /** 会话当前行距（倍数） */
    private currentLineHeight(): number {
        return readerLineHeight ?? this.lineHeight;
    }

    /** 全屏切换：已全屏 → 退出；否则对最近 .modal（兼容旧弹窗）或视图容器请求全屏；异常/不支持静默忽略 */
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

    /** 全屏标签文案同步（fullscreenchange 与下拉打开时调用） */
    private syncFullscreenLabel(): void {
        if (!this.fsLabelEl) return;
        this.fsLabelEl.setText(document.fullscreenElement ? '退出全屏' : '全屏显示');
    }

    // ── 构建：底部工具条 ──

    /** 构建底部工具条：左章名 + 全书进度条 + 章内/全书百分比 + ‹ › 翻屏/翻章 */
    private buildFooter(): void {
        const footer = this.container.createDiv({ cls: 'rl-reader-footer' });
        this.footerFchEl = footer.createSpan({ cls: 'rl-reader-fch' });
        // 全书进度条（单一整体填充，宽度 = 全书百分比；章节 tick 未做——最小实现留注释）
        const prog = footer.createDiv({ cls: 'rl-reader-fprog' });
        this.footerFillEl = prog.createDiv({ cls: 'rl-reader-fprog-fill' });
        this.footerFpctEl = footer.createSpan({ cls: 'rl-reader-fpct' });
        const nav = footer.createDiv({ cls: 'rl-reader-fnav' });
        const prev = nav.createEl('button', { cls: 'rl-btn rl-reader-btn', text: '‹' });
        prev.setAttribute('data-tip', '上一章/上一页');
        prev.addEventListener('click', () => this.goPrevPage());
        const next = nav.createEl('button', { cls: 'rl-btn rl-reader-btn', text: '›' });
        next.setAttribute('data-tip', '下一章/下一页');
        next.addEventListener('click', () => this.goNextPage());
    }

    /**
     * ‹ 上一章：非首章 → switchChapter(−1) 滚到章头；首章 → Notice
     */
    private navPrev(): void {
        if (this.chapterIndex === 0) {
            new Notice('已是开头');
            return;
        }
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 0 });
        this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 0));
        this.switchChapter(this.chapterIndex - 1);
    }

    /**
     * › 下一章：非末章 → switchChapter(+1)；末章 → Notice
     */
    private navNext(): void {
        if (this.chapterIndex >= this.options.book.chapters.length - 1) {
            new Notice('已是全书结尾');
            return;
        }
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 1 });
        this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
        this.switchChapter(this.chapterIndex + 1);
    }

    // ── 构建：正文区 ──

    private buildBody(): void {
        const body = this.container.createDiv({ cls: 'rl-reader-body' });
        // 选中动作条定位上下文：body 作为相对定位父级（动作条 absolute 悬浮正文区，不随 iframe 内滚动位移）
        body.style.position = 'relative';
        this.selbarParent = body;

        // 左侧目录列（复用 TXT 阅读器 rl-reader-toc 样式）：「目录 | 书签 | 摘抄」三 tab 切换
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '章节目录' } });
        safeSetIcon(tocTab, 'list-tree');
        const bmTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签' } });
        safeSetIcon(bmTab, 'bookmark');
        const exTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '摘抄' } });
        safeSetIcon(exTab, 'quote');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        this.tocEntries = this.options.book.toc;
        // href（去 #fragment）→ 章节索引，目录点击定位章节
        const byPath = new Map<string, number>();
        this.options.book.chapters.forEach((c, i) => byPath.set(c, i));
        this.tocEntries.forEach((t) => {
            const item = this.tocListEl.createEl('button', { cls: 'rl-reader-toc-item', attr: { 'data-tip': t.label }, text: t.label });
            item.addEventListener('click', () => {
                const idx = byPath.get(t.href.split('#')[0]);
                if (idx !== undefined) this.switchChapter(idx);
            });
        });
        // 书签 pane：列表填充 .rl-reader-bm-empty / .rl-reader-bm-item（点击定位 / 右键删除）
        const bmPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-bm-pane hidden' });
        this.bmListEl = bmPane.createDiv({ cls: 'rl-reader-bm-list' });
        this.buildBookmarkToc();
        // 摘抄 pane：原「书签」页承载的摘抄列表（语义不变，仅 tab 改名）；顶部叠加「高亮」标注区
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        const hlHead = exPane.createDiv({ cls: 'rl-reader-hl-head' });
        this.hlCountEl = hlHead.createDiv({ cls: 'rl-reader-ex-hlcount', text: '高亮（0）' });
        const clearAllBtn = hlHead.createEl('button', { cls: 'rl-btn rl-reader-btn rl-hl-clearall hidden', text: '清除全部' });
        clearAllBtn.setAttribute('data-tip', '删除全部高亮（含笔记「## 高亮」区对应块）');
        clearAllBtn.addEventListener('click', () => void this.clearAllHighlights(clearAllBtn));
        this.hlClearAllBtn = clearAllBtn;
        this.hlListEl = exPane.createDiv({ cls: 'rl-reader-hl-list' });
        this.exListEl = exPane.createDiv({ cls: 'rl-reader-ex-list' });
        this.refreshHighlightToc();
        this.buildExcerptToc();
        tocTab.addEventListener('click', () => this.activatePane('toc'));
        bmTab.addEventListener('click', () => this.activatePane('bm'));
        exTab.addEventListener('click', () => this.activatePane('ex'));

        // 右侧 iframe 渲染区（srcdoc = 章节 HTML + 注入基础 CSS）
        const frameWrap = body.createDiv({ cls: 'rl-reader-frame' });
        // sandbox 仅 allow-same-origin：禁脚本防 EPUB 恶意 JS，同时保留同源访问 contentDocument
        this.frameEl = frameWrap.createEl('iframe', { attr: { sandbox: 'allow-same-origin' } });

        // 选中动作条（初始隐藏；摘录入口由「❝ 摘抄」按钮接管，不再选中即弹）
        this.selbar = this.buildSelbar();
        body.appendChild(this.selbar);
    }

    // ── 选中动作条（T5，iframe 适配） ──

    /** 构建选中动作条：★ 书签 / ❝ 摘抄 / 高亮(占位) / 翻译(占位)；返回带 .rl-selbar.hidden 的条 */
    private buildSelbar(): HTMLDivElement {
        const bar = document.createElement('div');
        bar.classList.add('rl-selbar', 'hidden');

        const mkBtn = (text: string, disabled: boolean): HTMLButtonElement => {
            const b = document.createElement('button');
            b.textContent = text;
            if (disabled) b.classList.add('rl-selbar-disabled');
            return b;
        };
        // 书签：以当前选区新建书签（选中文本即引用），落库走 onBookmarksChange 同一通道
        const bmBtn = mkBtn('★ 书签', false);
        bmBtn.addEventListener('click', () => this.addSelBookmark());
        // 摘抄：进入既有摘录确认/写回流程（quote, 无页, 当前定位）
        const exBtn = mkBtn('❝ 摘抄', false);
        exBtn.addEventListener('click', () => this.addSelExcerpt());
        // 高亮：一键即黄即记（写笔记「## 高亮」区 + 页内持久 mark，iframe 内标黄）
        const hlBtn = mkBtn('高亮', false);
        hlBtn.setAttribute('data-tip', '划词高亮');
        hlBtn.addEventListener('click', () => void this.addSelHighlight());
        // 翻译：AI 划词翻译（本批真功能）；点击消费当前选区 → 就地译文浮层
        const trBtn = mkBtn('译翻译', false);
        trBtn.setAttribute('data-tip', '划词翻译');
        trBtn.addEventListener('click', () => this.addSelTranslate());

        bar.append(bmBtn, exBtn, hlBtn, trBtn);
        // 动作条自身 mousedown 不冒泡到 document（bar 挂在宿主文档，宿主 onDocMouseDown 会先收起）：先点按钮、后由动作完成收起
        bar.addEventListener('mousedown', (ev) => ev.stopPropagation());
        return bar;
    }

    /**
     * iframe 内容 mouseup：有非空选区 → 记录文本+定位并在鼠标处弹动作条；空选/点击 → 收起。
     * 事件坐标相对 iframe 文档（不冒泡宿主），换算到宿主坐标：frameRect + ev.clientX/Y。
     */
    private onTextMouseUp(ev: MouseEvent): void {
        const text = this.frameEl.contentWindow?.getSelection()?.toString().trim();
        const mode = this.annotateMode;
        const frameRect = this.frameEl.getBoundingClientRect();
        // 标注模式锁：有选区 → 分派；书签模式 + 空选区（单击正文）→ 存位置书签
        if (mode && text) {
            const loc = this.currentLoc();
            this.dispatchAnnotate(text, loc, frameRect.left + ev.clientX, frameRect.top + ev.clientY);
            return;
        }
        if (mode === 'bookmark' && !text) {
            this.addClickBookmark();
            return;
        }
        if (!text) {
            this.hideSelbar();
            return;
        }
        const loc = this.currentLoc();
        this.selRecord = { text, chapter: loc.chapter, pct: loc.pct };
        this.showSelbarAt(frameRect.left + ev.clientX, frameRect.top + ev.clientY);
    }

    /** 标注模式锁分派（EPUB）：坐标已换算到宿主 client）；高亮/批注/翻译各自触发后清 iframe 选区 */
    private dispatchAnnotate(text: string, loc: { chapter: number; pct: number }, clientX: number, clientY: number): void {
        const mode = this.annotateMode;
        this.hideSelbar();
        if (mode === 'highlighter') {
            void this.toggleHighlight(text, loc);
            this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        } else if (mode === 'quote') {
            this.options.onExcerpt?.(text, undefined, { chapter: loc.chapter, pct: loc.pct });
            this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        } else if (mode === 'languages') {
            const parent = this.selbarParent;
            let x = 60;
            let y = 40;
            if (parent) {
                const pRect = parent.getBoundingClientRect();
                x = Math.max(4, clientX - pRect.left);
                y = Math.max(4, clientY - pRect.top);
            }
            this.showTranslateCard(x, y, text);
        }
    }

    /** 在鼠标上方（放不下则下方）显示动作条，坐标换算到 selbarParent 局部空间，水平/垂直钳制不出正文区 */
    private showSelbarAt(clientX: number, clientY: number): void {
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!bar || !parent) return;
        bar.classList.remove('hidden');
        const pRect = parent.getBoundingClientRect();
        const bRect = bar.getBoundingClientRect();
        const gap = 8;
        const left = Math.min(Math.max(clientX - pRect.left, 4), pRect.width - bRect.width - 4);
        let top = clientY - pRect.top - bRect.height - gap;
        if (top < 4) top = clientY - pRect.top + gap; // 选区上方放不下 → 转下方
        bar.style.left = `${Math.round(left)}px`;
        bar.style.top = `${Math.round(Math.min(top, pRect.height - bRect.height - 4))}px`;
    }

    /** 收起动作条并清空选区记录（不动浏览器选区高亮）；滚动/点击面板外/动作完成后调用 */
    private hideSelbar(): void {
        this.selbar?.classList.add('hidden');
        this.selRecord = null;
    }

    /** 动作条「★ 书签」：用当前选区新建书签 → 内存列表更新 + 通知宿主落盘 + 重绘书签 pane；动作完成后清 iframe 选区防残留高亮 */
    private addSelBookmark(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        const updated = [...this.bookmarks(), newBookmark(rec.chapter, rec.pct, rec.text)];
        this.options.bookmarks = updated;
        this.options.onBookmarksChange?.(updated);
        this.refreshBookmarks(updated);
        new Notice('已添加书签');
        // 书签动作已消费选区：清掉 iframe 内选区高亮（残影），再收起动作条
        this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    /** 动作条「❝ 摘抄」：进入既有摘录弹窗确认/写回流程；无回调则仅收起；动作完成后清 iframe 选区防残留高亮 */
    private addSelExcerpt(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        this.options.onExcerpt?.(rec.text, undefined, { chapter: rec.chapter, pct: rec.pct });
        // 摘抄动作已消费选区：清掉 iframe 内选区高亮（残影），再收起动作条
        this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    // ── 高亮（页内持久黄标 + 写笔记「## 高亮」区；正文在 iframe，mark 注入 frame 文档） ──

    /** 本章高亮（loc.chapter === 当前章（1 基）） */
    private currentChapterHighlights(): ReaderHighlight[] {
        return chapterHighlights(this.highlightList, this.chapterIndex + 1);
    }

    /** 给 iframe 正文段落包本章高亮 mark（幂等：按段 textContent 区间重建 innerHTML；仅命中的段落受影响）。
     *  用 doc 无关的 innerHTML 重建，避免依赖 frame 文档 DOM API；若 p 内嵌标签则整段摊平（v1 容错）。 */
    private applyHighlights(doc: Document): void {
        const hls = this.currentChapterHighlights();
        if (hls.length === 0) return;
        const paras = Array.from(doc.querySelectorAll('p'));
        const escapeHtml = (s: string): string =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        for (const p of paras) {
            const plain = p.textContent ?? '';
            if (!plain) continue;
            const segs: { start: number; end: number; id?: string }[] = [];
            for (const hl of hls) {
                const seg = findQuoteSegment(plain, hl.quote);
                if (seg) segs.push({ ...seg, id: hl.id });
            }
            if (segs.length === 0) continue;
            segs.sort((a, b) => a.start - b.start);
            const kept: typeof segs = [];
            for (const s of segs) {
                if (kept.some((k) => s.start < k.end && s.end > k.start)) continue;
                kept.push(s);
            }
            if (kept.length === 0) continue;
            let html = '';
            let pos = 0;
            for (const k of kept) {
                const s = Math.max(pos, k.start);
                const e = Math.min(plain.length, k.end);
                if (e <= s) continue;
                html += escapeHtml(plain.slice(pos, s));
                const idAttr = k.id ? ` data-hl-id="${escapeHtml(k.id)}"` : '';
                html += `<mark class="rl-hl-persist"${idAttr}>${escapeHtml(plain.slice(s, e))}</mark>`;
                pos = e;
            }
            html += escapeHtml(plain.slice(pos));
            p.innerHTML = html;
        }
    }

    /** 动作条「高亮」：一键即黄即记核心 */
    private async addSelHighlight(): Promise<void> {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        await this.doHighlight(rec.text.trim(), rec.chapter, rec.pct);
        this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    /** 一键即黄即记核心：写笔记「## 高亮」区 → 本地列表追加 → 重包当前章 mark */
    private async doHighlight(text: string, chapter: number, pct: number): Promise<void> {
        if (!text || !this.options.onHighlight) {
            new Notice('当前阅读器不支持高亮');
            return;
        }
        const id = await this.options.onHighlight(text, { chapter, pct });
        if (!id) return; // 失败已 Notice
        this.highlightList = [...this.highlightList, { quote: text, id, loc: { chapter, pct } }];
        const doc = this.frameEl.contentDocument;
        if (doc) this.applyHighlights(doc);
        this.refreshHighlightToc();
        new Notice('已高亮');
    }

    /** 删除高亮（标注右键）：main 确认删笔记块 → 成功则本地列表移除 + 重包当前章（移除 mark） */
    async removeHighlight(id: string): Promise<void> {
        if (!this.options.onDeleteHighlight) return;
        const ok = await this.options.onDeleteHighlight(id);
        if (!ok) return;
        this.highlightList = this.highlightList.filter((h) => h.id !== id);
        const doc = this.frameEl.contentDocument;
        if (doc) this.applyHighlights(doc);
        this.refreshHighlightToc();
    }

    /** 标注模式「高亮」：toggle——选中文字已是本章高亮 → 取消该条；否则新增即黄 */
    private async toggleHighlight(text: string, loc: { chapter: number; pct: number }): Promise<void> {
        const dec = decideHighlightToggle(this.highlightList, text, loc);
        if (dec.action === 'remove') {
            await this.removeHighlight(dec.id);
            new Notice('已取消高亮');
        } else {
            await this.doHighlight(text, loc.chapter, loc.pct);
        }
    }

    /** 标注模式「书签」：单击正文(无选区)在当前位置存一个位置书签（按章去重） */
    private addClickBookmark(): void {
        const loc = this.currentLoc();
        const sameChapter = this.bookmarks().some((b) => b.chapter === loc.chapter);
        if (sameChapter) {
            new Notice('本章已有书签（去重，未重复添加）');
            return;
        }
        const updated = [...this.bookmarks(), newBookmark(loc.chapter, loc.pct, undefined)];
        this.options.bookmarks = updated;
        this.options.onBookmarksChange?.(updated);
        this.refreshBookmarks(updated);
        new Notice(`已添加书签：第${loc.chapter}章 ${loc.pct}%`);
    }

    /** 清除全部高亮：confirm 一次 → 逐条 onDeleteHighlight → 清空本地列表 + 重包当前章 */
    private async clearAllHighlights(btn: HTMLButtonElement): Promise<void> {
        const n = this.highlightList.length;
        if (n === 0) return;
        const ok = confirm(`确定删除全部 ${n} 条高亮吗？（将从笔记「## 高亮」区一并移除）`);
        if (!ok) return;
        btn.addClass('rl-hl-clearall-busy');
        try {
            for (const hl of [...this.highlightList]) {
                if (hl.id && this.options.onDeleteHighlight) await this.options.onDeleteHighlight(hl.id);
            }
            this.highlightList = [];
            const doc = this.frameEl.contentDocument;
            if (doc) this.applyHighlights(doc);
            this.refreshHighlightToc();
            new Notice('已清除全部高亮');
        } finally {
            btn.removeClass('rl-hl-clearall-busy');
        }
    }

    /** 重建标注 pane「高亮」列表（点击跳原书定位 + 右键删除）；空 → 占位 */
    private refreshHighlightToc(): void {
        const list = this.hlListEl;
        if (!list) return;
        list.empty();
        this.hlCountEl?.setText(`高亮（${this.highlightList.length}）`);
        this.hlClearAllBtn?.toggleClass('hidden', this.highlightList.length === 0);
        if (this.highlightList.length === 0) {
            list.createDiv({ cls: 'rl-reader-hl-empty', text: '暂无高亮' });
            return;
        }
        const sorted = [...this.highlightList].sort(
            (a, b) => (a.loc?.chapter ?? 0) - (b.loc?.chapter ?? 0) || (a.loc?.pct ?? 0) - (b.loc?.pct ?? 0),
        );
        for (const hl of sorted) {
            const item = list.createDiv({ cls: 'rl-reader-hl-item' });
            item.createDiv({ cls: 'rl-reader-hl-quote', text: truncateQuote(hl.quote) });
            item.createDiv({
                cls: 'rl-reader-hl-loc' + (hl.loc ? '' : ' none'),
                text: hl.loc ? `第${hl.loc.chapter}章 · ${hl.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => this.jumpHighlight(hl));
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                if (!hl.id) return;
                await this.removeHighlight(hl.id);
            });
        }
    }

    /** 高亮定位：切到对应章并滚到该 quote 段落 */
    private jumpHighlight(hl: ReaderHighlight): void {
        if (!hl.loc) {
            new Notice('该高亮无定位信息');
            return;
        }
        const i = hl.loc.chapter - 1;
        if (i < 0 || i >= this.options.book.chapters.length) return;
        const ratio = hl.loc.pct / 100;
        this.jumpRatio = ratio;
        this.pendingHighlight = hl.quote;
        if (i === this.chapterIndex) {
            this.jumpRatio = null;
            const doc = this.frameEl.contentDocument;
            const scroller = doc?.scrollingElement || doc?.documentElement;
            if (!scroller) return;
            this.restoring = true;
            requestAnimationFrame(() => {
                const max = scroller.scrollHeight - this.frameEl.clientHeight;
                scroller.scrollTop = max > 0 ? Math.min(max, Math.max(0, ratio * max)) : 0;
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    // ── 划词翻译（批3：AI，就地译文浮层；坐标用 viewport client 便于 iframe 换算） ──

    /** 动作条「译翻译」：消费当前选区 → 就地译文浮层（保留选区高亮对照）；锚点取动作条当前位置转回 client */
    private addSelTranslate(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        const parent = this.selbarParent;
        const bar = this.selbar;
        const pRect = parent?.getBoundingClientRect();
        let x = 60;
        let y = 80;
        if (pRect) {
            if (bar && !bar.classList.contains('hidden')) {
                // 动作条局部 left/top + 父容器 viewport 左上 = client 锚点
                x = pRect.left + parseFloat(bar.style.left || '0');
                y = pRect.top + parseFloat(bar.style.top || '0');
            } else {
                x = pRect.left + 60;
                y = pRect.top + 80;
            }
        }
        this.hideSelbar();
        this.showTranslateCard(x, y, rec.text);
    }

    /** 就地译文浮层卡片（挂 selbarParent；标题「译文」+ ✕关闭；内容随翻译态更新） */
    private buildTranslateCard(): void {
        if (!this.selbarParent || this.translateCard) return;
        const card = this.selbarParent.createDiv({ cls: 'rl-translate-card hidden' });
        const head = card.createDiv({ cls: 'rl-translate-card-head' });
        head.createSpan({ cls: 'rl-translate-card-title', text: '译文' });
        const close = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-translate-card-close', attr: { 'data-tip': '关闭' }, text: '✕' });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideTranslateCard());
        this.translateCardBody = card.createDiv({ cls: 'rl-translate-card-body' });
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.translateCard = card;
    }

    /** 显示译文浮层于 (clientX,clientY) 上方并异步翻译；client 坐标换算到 selbarParent 局部钳位 */
    private showTranslateCard(clientX: number, clientY: number, text: string): void {
        const card = this.translateCard;
        const bodyEl = this.translateCardBody;
        if (!card || !bodyEl) return;
        if (!this.options.onTranslate) {
            new Notice('当前阅读器不支持翻译');
            return;
        }
        bodyEl.empty();
        bodyEl.removeClass('rl-translate-error');
        bodyEl.addClass('rl-translate-loading');
        bodyEl.setText('翻译中…');
        card.classList.remove('hidden');
        void this.options.onTranslate(text)
            .then((translated) => {
                bodyEl.removeClass('rl-translate-loading');
                if (card.classList.contains('hidden')) return;
                bodyEl.empty();
                if (translated) {
                    bodyEl.setText(translated);
                } else {
                    bodyEl.addClass('rl-translate-error');
                    bodyEl.setText('翻译失败');
                }
            })
            .catch(() => {
                bodyEl.removeClass('rl-translate-loading');
                if (card.classList.contains('hidden')) return;
                bodyEl.empty();
                bodyEl.addClass('rl-translate-error');
                bodyEl.setText('翻译失败');
            });
        requestAnimationFrame(() => {
            const parent = this.selbarParent;
            if (!parent) return;
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const gap = 8;
            const left = Math.min(Math.max(clientX - pRect.left, 4), Math.max(4, pRect.width - cRect.width - 4));
            let top = clientY - pRect.top - cRect.height - gap;
            if (top < 4) top = clientY - pRect.top + gap;
            card.style.left = `${Math.round(left)}px`;
            card.style.top = `${Math.round(Math.min(top, pRect.height - cRect.height - 4))}px`;
        });
    }

    /** 收起译文浮层（✕/滚动/点外部/切章调用）；进行中的翻译结果到达时若已隐藏则丢弃 */
    private hideTranslateCard(): void {
        if (this.translateCard) this.translateCard.classList.add('hidden');
        if (this.translateCardBody) this.translateCardBody.removeClass('rl-translate-loading');
    }

    // ── 章节渲染 ──

    private renderChapter(): void {
        const chapters = this.options.book.chapters;
        // 底部工具条左：当前章标题（目录 label 优先，回退文件名）
        this.footerFchEl?.setText(this.currentChapterLabel());
        if (chapters.length === 0) {
            this.pendingRatio = 0;
            this.frameEl.addEventListener('load', this.onFrameLoad, { once: true });
            this.frameEl.srcdoc = this.buildFrameDoc('<p>（本书没有可渲染的章节）</p>');
            return;
        }
        const path = chapters[this.chapterIndex];
        const html = this.options.fileMap[path];
        // 待恢复比例：摘抄/书签跳转优先；其次首次渲染读进度；切章后回到顶部
        this.pendingRatio = this.jumpRatio !== null ? this.jumpRatio : this.firstRender ? this.options.progress?.scrollRatio ?? 0 : 0;
        this.jumpRatio = null;
        this.firstRender = false;
        // 章节文件缺失：占位提示
        const body = html !== undefined ? html : `<p style="color:#999">（章节文件缺失：${escapeHtml(path)}）</p>`;
        this.frameEl.addEventListener('load', this.onFrameLoad, { once: true });
        this.frameEl.srcdoc = this.buildFrameDoc(body);
        this.highlightToc();
    }

    /** iframe 章节加载完成：注入布局样式 + 绑 frame 内事件 + 恢复进度 */
    private onFrameLoad = (): void => {
        const doc = this.frameEl.contentDocument;
        if (!doc?.body) return;
        this.applyLayout(doc);
        // 页内持久黄标：把本章高亮 quote 命中片段包 <mark>（srcdoc 重建后 frame 内段落重建）
        this.applyHighlights(doc);
        // iframe 内容交互：mouseup → 选中动作条；mousedown → 收起动作条/设置下拉；mousemove → 顶区唤出头部、内容区延时收起
        // （srcdoc 每次重建，监听随旧文档回收；iframe 事件不冒泡宿主，onDocMouseDown 需单独在此挂一份）
        doc.addEventListener('mousedown', this.onDocMouseDown);
        doc.addEventListener('mouseup', (ev) => this.onTextMouseUp(ev));
        const scroller = doc.scrollingElement || doc.documentElement;
        if (!scroller) return;
        // iframe 内滚动监听：标准模式视口滚动（scrollingElement=html）的 scroll 事件 target 是 document，
        // 挂在 documentElement 上的普通监听收不到 → 进度/自动翻章全失灵（TXT 宿主 div 滚动 target=div 无此问题）。
        // 修复：scroller 元素监听 + document 捕获监听（capture 沿 document→target 必经）双保险；
        // 同一滚动最多触发两次，onFrameScroll 的 rAF 守卫合并同帧、hide 幂等无害。
        const onAnyScroll = (): void => {
            this.onFrameScroll();
            this.hideSelbar();
            this.hideTranslateCard();
        };
        scroller.addEventListener('scroll', onAnyScroll);
        doc.addEventListener('scroll', onAnyScroll, true);
        // 翻页模式：把 body 切成单列「一屏一页」columns 并测总页（连续模式维持纵向滚动）
        if (this.isPaged()) {
            this.setupPagedLayout(doc);
        }
        this.restoring = true;
        // 等布局稳定后恢复位置（连续=纵向 scrollTop；翻页=定位到对应页）
        requestAnimationFrame(() => {
            if (this.isPaged()) {
                this.goToPage(ratioToPage(this.pendingRatio, this.totalPages), false);
                this.pendingRatio = 0;
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
                return;
            }
            const max = scroller.scrollHeight - this.frameEl.clientHeight;
            const target = this.pendingRatio > 0 ? Math.min(max, Math.max(0, this.pendingRatio * max)) : 0;
            if (max > 0 && this.pendingRatio > 0) scroller.scrollTop = target;
            this.pendingRatio = 0;
            // 章尾着陆（navPrev 落上一章章尾 jumpRatio=1 / 保存进度=1）：scrollTop 赋值的程序化 scroll 事件异步派发，
            // 单帧内即清 restoring 会让迟到的触底任务以 restoring=false 运行 → handleFrameScroll 误判自动翻章翻回刚离开的章。
            // 对齐 TXT navPrev（TxtReaderModal 嵌套 rAF 内清 restoring）：底部着陆时再嵌套一帧等 restore 滚动派发完解锁；
            // 顶部/中段恢复无触底风险，保持单帧即时解锁（书签/摘抄跳转行为不变）。
            const settle = (): void => {
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            };
            if (max > 0 && target >= max - 1) {
                requestAnimationFrame(settle);
            } else {
                settle();
            }
        });
    };

    /** 当前章标题：目录中匹配当前章路径的 label；无匹配回退文件名（去扩展名） */
    private currentChapterLabel(): string {
        const cur = this.options.book.chapters[this.chapterIndex];
        if (cur === undefined) return '';
        const t = this.tocEntries.find((e) => e.href.split('#')[0] === cur);
        if (t) return t.label;
        const name = cur.split('/').pop() ?? cur;
        return name.replace(/\.[^.]+$/, '');
    }

    /** 注入 iframe 文档样式：字号/行距/列布局（srcdoc 每次重建后重新应用） */
    private applyLayout(doc: Document): void {
        const body = doc.body;
        body.style.fontSize = `${readerFontSize ?? 16}px`;
        body.style.lineHeight = `${readerLineHeight ?? this.lineHeight}`;
        // 翻页模式：单列分页 columns 由 setupPagedLayout 管理，此处不动列/宽（避免覆盖）
        if (this.isPaged()) return;
        body.style.columnCount = this.doublePage ? '2' : '1';
        body.style.columnGap = this.doublePage ? '2.5em' : '';
        body.style.maxWidth = this.doublePage ? 'none' : '720px';
    }

    /** 生成 iframe srcdoc：基础 CSS + 章节 HTML（字体/背景取宿主样式缓存，避免每次切章 getComputedStyle 触发主文档重排） */
    private buildFrameDoc(bodyHtml: string): string {
        const { fontFamily, bg, color } = getHostStyle();
        // 连续模式：双页两栏 columns:2 / 单页限宽，纵向滚动 + 底部 40vh 给触底空间；
        // 翻页模式：单列分页（columns 由 onFrameLoad/setupPagedLayout 内联设置），底部留小 padding 避免大底距干扰列高
        const padB = this.isPaged() ? '24px' : '40vh';
        const layout = this.doublePage && !this.isPaged() ? 'columns:2;column-gap:2.5em;max-width:none;' : 'max-width:720px;';
        const css = `html,body{margin:0;padding:0;background:${bg};color:${color};}
body{font-family:${fontFamily};font-size:${readerFontSize ?? 16}px;line-height:${readerLineHeight ?? this.lineHeight};margin:0 auto;padding:26px 32px ${padB};${layout}}
h1,h2,h3,h4,h5,h6{line-height:1.5;margin:0.8em 0 0.5em;}
p{margin:0 0 1em;text-align:justify;}
.rl-excerpt-hl{background:rgba(255,200,60,.35);border-radius:2px;}`;
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
    }

    /** 目录高亮当前章（toc href 去 fragment 与当前章节路径比对） */
    private highlightToc(): void {
        const items = this.tocListEl.querySelectorAll('.rl-reader-toc-item');
        const cur = this.options.book.chapters[this.chapterIndex];
        items.forEach((el, i) => {
            const href = this.tocEntries[i]?.href.split('#')[0];
            el.toggleClass('active', href !== undefined && href === cur);
        });
        const active = items[this.chapterIndex];
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    /** 切换到指定章（越界忽略）：先落盘当前进度，再渲染新章节 */
    private switchChapter(i: number): void {
        if (i < 0 || i >= this.options.book.chapters.length || i === this.chapterIndex) return;
        this.resetAnnotate(); // 切章复位标注模式，防残留
        this.flushSave();
        this.chapterIndex = i;
        this.renderChapter();
    }

    // ── 顶栏快捷「标注模式锁」 ──

    /** 点快捷按钮：切换对应标注模式激活态（激活→再点取消；点另一钮切过去） */
    private toggleAnnotate(kind: 'bookmark' | 'quote' | 'languages' | 'highlighter'): void {
        this.setAnnotate(this.annotateMode === kind ? null : kind);
    }

    /** 设置激活标注模式（null=全部退出），同步按钮 .rl-quick-active；进入高亮模式提示一次 */
    private setAnnotate(kind: 'bookmark' | 'quote' | 'languages' | 'highlighter' | null): void {
        this.annotateMode = kind;
        (Object.keys(this.quickBtns) as Array<'bookmark' | 'quote' | 'languages' | 'highlighter'>).forEach((k) => {
            this.quickBtns[k]?.toggleClass('rl-quick-active', k === kind);
        });
        if (kind === 'highlighter') new Notice('高亮模式：拖选文字即高亮（再点该按钮退出）');
        else if (kind === 'quote') new Notice('批注模式：拖选文字即加摘抄（再点该按钮退出）');
        else if (kind === 'languages') new Notice('翻译模式：拖选文字即翻译（再点该按钮退出）');
        else if (kind === 'bookmark') new Notice('书签模式：单击正文存书签（再点该按钮退出）');
    }

    /** 清除激活标注模式（切章/关面板时调用，防残留） */
    private resetAnnotate(): void {
        if (this.annotateMode) this.setAnnotate(null);
    }

    /**
     * 激活左侧 pane（目录/书签/摘抄）：展开目录列（取消 collapsed），
     * 同步侧栏三 tab 与头部三键的 active 态，并互斥显隐三个 pane。
     * 供头部三键与侧栏 tab 共用；T 键仍为整体折叠/展开（toggleToc）。
     */
    private activatePane(pane: 'toc' | 'bm' | 'ex'): void {
        // 与 toggleToc 折叠态互斥：激活 pane 即展开目录列
        this.tocEl.toggleClass('collapsed', false);
        this.tocCollapsed = false;
        // pane 顺序（toc/bm/ex）与创建顺序一致：侧栏 tab、pane 容器均按下标对应
        const order: ReadonlyArray<'toc' | 'bm' | 'ex'> = ['toc', 'bm', 'ex'];
        const idx = order.indexOf(pane);
        if (idx < 0) return;
        this.tocEl.querySelectorAll('.rl-reader-toc-tab').forEach((el, i) => el.toggleClass('active', i === idx));
        this.tocEl.querySelectorAll('.rl-reader-toc-pane').forEach((el, i) => el.toggleClass('hidden', i !== idx));
    }

    // ── 摘抄 ──

    /** 摘抄列表（摘抄 pane 内容）：点击跳原书定位并高亮；无定位提示 */
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
                text: ex.loc ? `第${ex.loc.chapter}章 · ${ex.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => this.jumpExcerpt(ex));
            // 右键删除摘抄（左键定位/右键删除）
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                const bid = ex.id;
                if (!bid) return;
                const ok = (await this.options.onDeleteExcerpt?.(bid)) ?? false;
                if (ok) this.removeExcerptItem(bid);
            });
        });
    }

    /** 删除成功后从摘抄列表移除该项并重绘 */
    private removeExcerptItem(blockId: string): void {
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => x.id !== blockId);
        this.buildExcerptToc();
    }

    /** 摘抄列表整体刷新（main 层摘抄写入成功后重读笔记注入；重绘摘抄 pane） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.options.excerpts = excerpts;
        this.buildExcerptToc();
    }

    /** 摘抄跳转：有定位 → 切章 + iframe load 后恢复滚动比例 + 定位段落高亮；无定位 → 提示；同章点击绕过 switchChapter 短路直接恢复 */
    private jumpExcerpt(ex: ParsedExcerpt): void {
        if (!ex.loc) {
            new Notice('该摘抄无定位信息');
            return;
        }
        const i = ex.loc.chapter - 1;
        if (i < 0 || i >= this.options.book.chapters.length) return;
        const ratio = ex.loc.pct / 100;
        this.jumpRatio = ratio;
        this.pendingHighlight = ex.quote;
        if (i === this.chapterIndex) {
            // 同章：switchChapter 对同章 return，直接在当前 iframe 内恢复滚动比例 + 定位段落高亮；jumpRatio 已消费防残留误触发
            this.jumpRatio = null;
            const doc = this.frameEl.contentDocument;
            const scroller = doc?.scrollingElement || doc?.documentElement;
            if (!scroller) return;
            this.restoring = true;
            requestAnimationFrame(() => {
                const max = scroller.scrollHeight - this.frameEl.clientHeight;
                scroller.scrollTop = max > 0 ? Math.min(max, Math.max(0, ratio * max)) : 0;
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    /** iframe load 完成恢复滚动后：在正文段落中查找摘抄引用文本，滚动到该段并高亮 2.5s（找不到则跳过） */
    private highlightPending(): void {
        const quote = this.pendingHighlight;
        this.pendingHighlight = null;
        if (!quote) return;
        const target = quote.replace(/\s+/g, '').slice(0, 24);
        if (!target) return;
        const doc = this.frameEl.contentDocument;
        if (!doc?.body) return;
        const paras = Array.from(doc.body.querySelectorAll('p'));
        for (const p of paras) {
            const pt = (p.textContent ?? '').replace(/\s+/g, '');
            if (pt.includes(target)) {
                p.scrollIntoView({ block: 'center' });
                p.classList.add('rl-excerpt-hl');
                window.setTimeout(() => p.classList.remove('rl-excerpt-hl'), 2500);
                return;
            }
        }
    }

    // ── 书签 ──

    /** 本会话书签数据源（面板内存态；宿主经 options.bookmarks 注入，变更走 onBookmarksChange 落盘） */
    private bookmarks(): ReaderBookmark[] {
        return this.options.bookmarks ?? [];
    }

    /** 书签列表（书签 pane 内容）：点击跳原书定位并高亮；空 → 「暂无书签」 */
    private buildBookmarkToc(): void {
        const list = this.bmListEl;
        if (!list) return;
        list.empty();
        const bms = this.bookmarks();
        if (bms.length === 0) {
            list.createDiv({ cls: 'rl-reader-bm-empty', text: '暂无书签' });
            return;
        }
        bms.forEach((bm) => {
            const item = list.createDiv({ cls: 'rl-reader-bm-item' });
            item.createDiv({ cls: 'rl-reader-bm-quote', text: bm.quote ? truncateQuote(bm.quote) : '书签' });
            item.createDiv({ cls: 'rl-reader-bm-loc', text: `第${bm.chapter}章 · ${bm.pct}%` });
            item.addEventListener('click', () => this.jumpBookmark(bm));
            // 右键删除书签：与摘抄右删（宿主 confirm + 回写笔记）不同，书签列表已在面板内存，
            // 直接移除本项并通知宿主落盘即可（新增书签同样走 onBookmarksChange 同一持久化通道，无需宿主确认回调）
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                const id = bm.id;
                if (!id) return; // 旧数据/手写书签可能缺 id，无法唯一定位，静默跳过（对齐摘抄右删守卫）
                this.removeBookmarkItem(id);
            });
        });
    }

    /** 删除书签：从内存列表移除 → 通知宿主落盘 → 重绘书签 pane */
    private removeBookmarkItem(id: string): void {
        const remaining = this.bookmarks().filter((b) => b.id !== id);
        this.options.bookmarks = remaining;
        this.options.onBookmarksChange?.(remaining);
        this.buildBookmarkToc();
    }

    /** 书签列表整体刷新（宿主读盘/新增落盘后注入最新数据；重绘书签 pane） */
    refreshBookmarks(list: ReaderBookmark[]): void {
        this.options.bookmarks = list;
        this.buildBookmarkToc();
    }

    /** 书签跳转：切章 + iframe load 后恢复滚动比例 + 定位段落高亮；quote 为空（纯位置书签）→ 仅定位不高亮（highlightPending 内部守卫空串） */
    private jumpBookmark(bm: ReaderBookmark): void {
        const i = bm.chapter - 1;
        if (i < 0 || i >= this.options.book.chapters.length) return;
        const ratio = bm.pct / 100;
        this.jumpRatio = ratio;
        this.pendingHighlight = bm.quote ?? null;
        if (i === this.chapterIndex) {
            // 同章：switchChapter 对同章 return，直接在当前 iframe 内恢复滚动比例 + 定位段落高亮；jumpRatio 已消费防残留误触发
            this.jumpRatio = null;
            const doc = this.frameEl.contentDocument;
            const scroller = doc?.scrollingElement || doc?.documentElement;
            if (!scroller) return;
            this.restoring = true;
            requestAnimationFrame(() => {
                const max = scroller.scrollHeight - this.frameEl.clientHeight;
                scroller.scrollTop = max > 0 ? Math.min(max, Math.max(0, ratio * max)) : 0;
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    // ── 滚动与进度 ──

    /** 当前 iframe 滚动元素（html/body 取 scrollingElement）；frame 未加载/已卸载 → null */
    private frameScroller(): HTMLElement | null {
        try {
            const doc = this.frameEl?.contentDocument;
            return (doc?.scrollingElement || doc?.documentElement) as HTMLElement | null;
        } catch {
            return null;
        }
    }

    /** iframe 滚动：rAF 节流（同一帧多次滚动合并处理一次，滚动中不反复读 scrollHeight） */
    private onFrameScroll = (): void => {
        if (this.restoring || this.scrollRaf !== null) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            this.handleFrameScroll();
        });
    };

    /** 滚动帧处理：算比例 → 触底自动翻章（延后宏任务）/ 节流保存。连续=纵向；翻页=横向滚动归页 */
    private handleFrameScroll(): void {
        if (this.restoring) return;
        const doc = this.frameEl.contentDocument;
        const scroller = doc?.scrollingElement || doc?.documentElement;
        if (!scroller) return;
        if (this.isPaged()) {
            const p = Math.round(scroller.scrollLeft / Math.max(1, this.pageW));
            const cp = Math.max(0, Math.min(this.totalPages - 1, p));
            if (cp !== this.pageIndex) this.pageIndex = cp;
            this.updateProgress();
            this.scheduleSave(pageToRatio(cp, this.totalPages));
            return;
        }
        const max = scroller.scrollHeight - this.frameEl.clientHeight;
        const ratio = max > 0 ? scroller.scrollTop / max : 0;
        // 触底或内容不足一屏（max<=0 短章节/版权页）→ 自动翻章：先保存当前章进度，再延后切章（不在滚动帧内重建 iframe）
        if ((max <= 0 || scroller.scrollTop >= max - 1) && this.chapterIndex < this.options.book.chapters.length - 1) {
            this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 1 });
            this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
            this.scheduleChapterSwitch(this.chapterIndex + 1);
            return;
        }
        this.updateProgress();
        this.scheduleSave(ratio);
    }

    /** 翻章延后到宏任务：滚动事件高频触发时避免同步重建 iframe srcdoc 阻塞滚动 */
    private scheduleChapterSwitch(i: number): void {
        if (this.switchTimer !== null) window.clearTimeout(this.switchTimer);
        this.switchTimer = window.setTimeout(() => {
            this.switchTimer = null;
            this.switchChapter(i);
        }, 0);
    }

    /** 滚动保存节流（300ms trailing） */
    private scheduleSave(ratio: number): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: ratio });
        }, SAVE_THROTTLE);
    }

    /** 立即保存当前进度（关面板/切章前调用，防最后一次滚动丢失）；翻章/关闭时同步落库整体百分比 */
    private flushSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            const doc = this.frameEl?.contentDocument;
            if (!doc) return;
            const ratio = this.currentRatio();
            this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: ratio });
            this.options.onProgressPersist?.(this.currentPercent());
        } catch {
            // iframe 已卸载：跳过
        }
    }

    /** 各章字符数（estimatePercent 加权；懒计算缓存） */
    private chapterSizes(): number[] {
        if (this.chapterSizesCache === null) {
            this.chapterSizesCache = this.options.book.chapters.map((c) => this.options.fileMap[c]?.length ?? 0);
        }
        return this.chapterSizesCache;
    }

    /**
     * 更新底部工具条：右侧「章内 X% · 全书 Y%」文本 + 全书进度条填充宽度。
     * 章内 pct = 当前章 iframe 滚动比例；全书 pct = estimatePercent 跨章累计（进度持久化同口径）。
     * （旧头部进度文本 T7 已迁至底部，头不再展示百分比）
     */
    private updateProgress(): void {
        const ratio = this.currentRatio();
        const overall = estimatePercent(this.chapterSizes(), this.chapterIndex, ratio);
        const chapPct = Math.round(ratio * 100);
        // 翻页模式：显示「页 N/总 N · 章内 X%」
        if (this.isPaged()) {
            this.footerFpctEl?.setText(`页 ${this.pageIndex + 1}/${this.totalPages} · 章内 ${chapPct}% · 全书 ${overall}%`);
            const pct = this.totalPages > 1 ? (this.pageIndex / (this.totalPages - 1)) * 100 : 0;
            this.footerFillEl?.style.setProperty('width', `${pct}%`);
            return;
        }
        this.footerFpctEl?.setText(`章内 ${chapPct}% · 全书 ${overall}%`);
        this.footerFillEl?.style.setProperty('width', `${chapPct}%`);
    }

    /** 当前整体百分比（翻章/关闭时写回 catalog 用） */
    private currentPercent(): number {
        try {
            return estimatePercent(this.chapterSizes(), this.chapterIndex, this.currentRatio());
        } catch {
            return estimatePercent(this.chapterSizes(), this.chapterIndex, 0);
        }
    }

    /** 当前摘录定位（章序 1 基 + 滚动百分比；保存摘抄时写入「· 定位：N:N」） */
    private currentLoc(): { chapter: number; pct: number } {
        try {
            return { chapter: this.chapterIndex + 1, pct: Math.round(this.currentRatio() * 100) };
        } catch {
            return { chapter: this.chapterIndex + 1, pct: 0 };
        }
    }

    // ── 字号 / 行距 / 布局 ──

    private adjustFont(delta: number): void {
        const next = Math.min(FONT_MAX, Math.max(FONT_MIN, (readerFontSize ?? 16) + delta));
        if (next === readerFontSize) return;
        readerFontSize = next;
        // 保持当前阅读位置（字号变化前后按同一比例定位）
        const doc = this.frameEl.contentDocument;
        const scroller = doc?.scrollingElement || doc?.documentElement;
        let ratio = 0;
        if (scroller) {
            const max = scroller.scrollHeight - this.frameEl.clientHeight;
            ratio = max > 0 ? scroller.scrollTop / max : 0;
        }
        if (doc?.body) doc.body.style.fontSize = `${readerFontSize}px`;
        if (scroller) {
            this.restoring = true;
            requestAnimationFrame(() => {
                const m2 = scroller.scrollHeight - this.frameEl.clientHeight;
                if (m2 > 0) scroller.scrollTop = ratio * m2;
                this.restoring = false;
                this.updateProgress();
            });
        }
        // 排版调整写回设置（全局记住）
        this.options.onSettingsChange?.({ fontSize: readerFontSize, lineHeight: readerLineHeight ?? this.lineHeight });
        if (this.settingsOpen) this.syncSettingsLabels();
    }

    /** 行距调节（LINE_STEP 步进，范围 1.2-2.4）：改 iframe 内样式 + 写回设置；同 adjustFont 按比例保持阅读位置 */
    private adjustLineHeight(delta: number): void {
        if (readerLineHeight === null) readerLineHeight = this.lineHeight;
        const next = Math.round(Math.min(LINE_MAX, Math.max(LINE_MIN, (readerLineHeight ?? this.lineHeight) + delta)) * 10) / 10;
        if (next === readerLineHeight) return;
        readerLineHeight = next;
        this.lineHeight = next;
        // 保持当前阅读位置（行高变化前后按同一比例定位）
        const doc = this.frameEl.contentDocument;
        const scroller = doc?.scrollingElement || doc?.documentElement;
        let ratio = 0;
        if (scroller) {
            const max = scroller.scrollHeight - this.frameEl.clientHeight;
            ratio = max > 0 ? scroller.scrollTop / max : 0;
        }
        if (doc?.body) doc.body.style.lineHeight = `${next}`;
        if (scroller) {
            this.restoring = true;
            requestAnimationFrame(() => {
                const m2 = scroller.scrollHeight - this.frameEl.clientHeight;
                if (m2 > 0) scroller.scrollTop = ratio * m2;
                this.restoring = false;
                this.updateProgress();
            });
        }
        this.options.onSettingsChange?.({ fontSize: readerFontSize ?? 16, lineHeight: next });
        if (this.settingsOpen) this.syncSettingsLabels();
    }

    /** 目录列折叠切换 */
    private toggleToc(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.tocEl.toggleClass('collapsed', this.tocCollapsed);
        this.syncSidebarToggle();
    }

    /** 同步侧栏折叠开关图标与标题（随 tocCollapsed：展开→panel-left-close/收起目录；折叠→panel-left-open/展开目录） */
    private syncSidebarToggle(): void {
        if (!this.sidebarToggleEl) return;
        if (this.tocCollapsed) {
            safeSetIcon(this.sidebarToggleEl, 'panel-left-open');
            this.sidebarToggleEl.setAttribute('data-tip', '展开目录');
        } else {
            safeSetIcon(this.sidebarToggleEl, 'panel-left-close');
            this.sidebarToggleEl.setAttribute('data-tip', '收起目录');
        }
    }

    /** 单页/双页两栏切换（CSS 注入 body 列布局，重排后回顶部；active 高亮当前布局态） */
    private toggleLayout(): void {
        this.doublePage = !this.doublePage;
        this.layoutBtn.setText(this.doublePage ? '⇆ 单页' : '⇆ 双页');
        this.layoutBtn.toggleClass('active', this.doublePage);
        const doc = this.frameEl.contentDocument;
        if (doc?.body) this.applyLayout(doc);
        const scroller = doc?.scrollingElement || doc?.documentElement;
        if (scroller) scroller.scrollTop = 0;
    }

    // ── 头部 auto-hide ──

    /** 显示头部：取消隐藏延时并移除 hidden（样式由 .rl-reader-head.hidden 上移出视野） */
    private showHead(): void {
        if (this.headHideTimer !== null) {
            window.clearTimeout(this.headHideTimer);
            this.headHideTimer = null;
        }
        this.headEl?.removeClass('hidden');
    }

    /** 隐藏头部：调度 HEAD_HIDE_DELAY 后加 hidden（容器 mouseleave / iframe 内容区 mousemove / 滚动时调度）；头部收起时一并收起设置下拉（防残留打开态） */
    private hideHead(): void {
        if (this.headEl === null || this.headHideTimer !== null) return;
        this.headHideTimer = window.setTimeout(() => {
            this.headHideTimer = null;
            this.headEl?.addClass('hidden');
            this.hideMenu();
        }, HEAD_HIDE_DELAY);
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

/** HTML 转义（占位提示内嵌路径时防破标签） */
function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
