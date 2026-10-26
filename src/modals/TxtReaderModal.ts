// TXT 书籍阅读器面板（原 Modal 弹窗，随 ReaderView 视图渲染）：目录侧栏 + 正文连续滚动 + 进度持久化
// 排版：字号/行距（设置页后续统一，先默认跟随 --font-text）；目录跳转；滚动位置按章节+比例恢复
// DOM API 渲染（参照 ImportBangumiModal 范式），样式写入 styles.css rl-read-*
// 由 ReaderView 传入容器/scope 挂载；closeView 由视图层注入（detach leaf）
import { Notice, requestUrl, setIcon, type Scope } from 'obsidian';
import { ReaderPanelBase } from 'modals/ReaderPanelBase';
import { parseTxtBook, chapterParagraphs, txtChapterUnits, type TxtBook } from 'pure/txtParse';
import { attachScrollFades, resyncScrollFade, attachTocResizer, formatCharCount } from 'pure/readerToc';
import { attachHeadDensity } from 'pure/readerHead';
import {
    annoCountText,
    appendAnnoCheck,
    buildAnnoHead,
    isAnnoSelItem,
    toggleAnnoSelItem,
    type AnnoHeadHandles,
    type AnnoSelState,
} from 'pure/annoSelection';
import {
    buildTtsMenu,
    loadTtsEngine,
    loadTtsRate,
    loadTtsVolume,
    loadVoiceUri,
    saveTtsEngine,
    saveTtsRate,
    saveTtsVolume,
    saveVoiceUri,
    ttsPitchLabel,
    ttsRateLabel,
    ttsVolumeLabel,
    TTS_RATE_DEFAULT,
    TTS_VOLUME_DEFAULT,
    type TtsEngineKind,
} from 'pure/tts';
import { cloudVoiceGroups, loadCloudVoice, saveCloudVoice } from 'pure/ttsCloud';
import {
    AUTO_SCROLL_DEFAULT,
    AUTO_SCROLL_MAX,
    AUTO_SCROLL_MIN,
    AUTO_SCROLL_STEP,
    AUTO_TURN_DEFAULT_MS,
    AUTO_TURN_MAX_MS,
    AUTO_TURN_MIN_MS,
    AUTO_TURN_STEP_MS,
    autoSpeedLabel,
    autoTurnLabel,
    advanceAutoPos,
    clampAutoScrollPx,
    clampAutoTurnMs,
    loadAutoScrollPx,
    saveAutoScrollPx,
} from 'pure/readerAuto';
import { CloudSpeechEngine } from 'services/CloudSpeechEngine';
import { SystemSpeechEngine, ttsSupported } from 'services/SpeechEngine';
import { TtsService } from 'services/TtsService';
import { estimatePercent, readerRatio } from 'pure/readingProgress';
import type { ParsedExcerpt } from 'pure/excerpt';
import { newBookmark, type ReaderBookmark } from 'pure/bookmark';
import {
    chapterHighlights,
    markParagraphHtml,
    hlMarkTargetOf,
    decideHighlightToggle,
    findSameHighlight,
    findSameExcerpt,
    normalizeHlStyle,
    normalizeHlColor,
    HL_STYLES,
    HL_COLORS,
    DEFAULT_HL_STYLE,
    DEFAULT_HL_COLOR,
    type HlStyle,
    type HlColor,
    type ReaderHighlight,
    type HlMarkTarget,
} from 'pure/highlight';
import { locateQuoteSpan } from 'pure/anchor';
import { normalizeLineWidth, normalizeScrollMode, pageToRatio, ratioToPage, isFirstPage, isLastPage, type ReaderLineWidth, type ScrollMode } from 'pure/paged';
import { footerReadout } from 'pure/readerFooter';
import { excerptCardLocLabel, excerptCardKeyAction, needsQuoteExpand, placeCard } from 'pure/excerptCard';
// 2026-10-23 区域截图：面板只交矩形 + 定位，取像素/落盘/写笔记在宿主（`saveReaderShot`）。
import type { ShotLoc, ShotRect } from 'pure/readerShot';
import { ShotOverlay } from 'modals/ShotOverlay';
import { SEARCH_ENGINE_GROUPS, searchEngineUrl, type SearchEngineId } from 'pure/readerSearch';
import { SEARCH_ENGINE_ICONS } from 'pure/searchIcons';

/** 顶栏快捷模式（标注模式锁）：激活后正文选中即执行对应动作，再点按钮退出。
 *  🔴 模式 id 联合类型的真源在 `pure/readerQuick`（TXT / EPUB 共用，⛔ 不各写一份） */
import type { ReaderQuickMode } from 'pure/readerQuick';
// #351 设置面板：分段控制器的**选项真源**（两个阅读器共用，⛔ 不各写一份）
import {
    FONT_FAMILY_OPTIONS,
    FONT_WEIGHT_OPTIONS,
    INDENT_OPTIONS,
    LETTER_DEFAULT,
    LETTER_MAX,
    LETTER_MIN,
    LETTER_STEP,
    SCROLL_OPTIONS,
    WIDTH_OPTIONS,
    fontFamilyCss,
    fontWeightCss,
    formatLetterSpacing,
    normalizeFontFamily,
    normalizeFontWeight,
    normalizeLetterSpacing,
    type ReaderFontFamily,
    type ReaderFontWeight,
    type ReaderTypoPayload,
    type SegOption,
} from 'pure/readerTypography';
import { currentParagraph, paraPct } from 'pure/readerParagraph';
import { isTypingTarget, resolveReaderHotkey } from 'pure/readerHotkeys';
import { formatChapterTitle } from 'pure/chapterTitle';
import { READER_THEMES, normalizeReaderTheme, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
// 🔴 #603：底栏图标组里「描述行为」的悬停轻提示真源（TXT / EPUB / PDF / 漫画 四件共用）
import { READER_FOPS } from 'pure/readerFops';

export interface TxtReaderOptions {
    /** 书籍标题（弹窗标题） */
    title: string;
    /** TXT 全文（已读入） */
    text: string;
    /** 当前进度（恢复用；可为空） */
    progress?: { chapterIndex: number; scrollRatio: number };
    /** 保存进度回调（滚动停止后节流调用） */
    onSaveProgress: (p: { chapterIndex: number; scrollRatio: number }) => void;
    /** 进度百分比落库回调（翻章/关闭时调用，percent 0-100；低频写 catalog） */
    onProgressPersist?: (percent: number) => void;
    /** 阅读排版设置（设置页持久化）：初始字号/行距/段落首行缩进/字体/字重/字距；调整写回 settings */
    settings?: ReaderTypoPayload;
    /** 排版变更回调（字号/行距/缩进/字体/字重/字距调整后写回设置持久化；缺省字段表示本次不改这一项） */
    onSettingsChange?: (s: ReaderTypoPayload) => void;
    /** 滚动模式（连续/翻页；缺省 continuous）——会话内可切换，onScrollModeChange 写回设置 */
    scrollMode?: ScrollMode;
    /** 滚动模式变更回调（切换后写回设置持久化） */
    onScrollModeChange?: (m: ScrollMode) => void;
    /** 阅读行宽（严格=固定版心 / 全宽=铺满；缺省 strict）——会话内可切换，onLineWidthChange 写回设置 */
    lineWidth?: ReaderLineWidth;
    /** 行宽变更回调（切换后写回设置持久化） */
    onLineWidthChange?: (w: ReaderLineWidth) => void;
    /** 阅读主题（跟随/经典白/夜间黑/护眼绿/深灰/羊皮纸；缺省 follow = 跟随 Obsidian 主题） */
    theme?: ReaderThemeId;
    /** 阅读主题变更回调（切换后写回设置持久化） */
    onThemeChange?: (t: ReaderThemeId) => void;
    /** 云合成 API Key 读取（#344 方案 C；每次现取）。未注入 = 云音源不可用，朗读弹窗里对应项置灰 */
    getCloudKey?: () => string;
    /** 摘抄保存（就地卡片 → 写回笔记「## 摘抄」区）；返回是否成功（false 保留卡片与输入便于重试） */
    onExcerptSave?: (quote: string, note: string | undefined, loc: { chapter: number; pct: number }) => Promise<boolean>;
    /**
     * 区域截图（2026-10-23 用户指令：TXT/EPUB/PDF 三阅读器加「区域截图回填笔记」）。
     * 面板只交**视口矩形 + 定位**；取像素/落盘/写笔记全在宿主 `main.ts:saveReaderShot`
     * （笔记文件唯一拥有者是 `EntryService`，⛔ 面板里不许 `vault.modify`）。
     */
    onShotSave?: (rect: ShotRect, loc?: ShotLoc) => void;
    /** 摘抄书签数据源（笔记「## 摘抄」区解析；打开阅读器时读取） */
    excerpts?: ParsedExcerpt[];
    /** 删除摘抄回调（书签右键 → main 层确认删除；返回是否成功，成功则面板刷新书签列表） */
    onDeleteExcerpt?: (blockId: string) => Promise<boolean>;
    /** 动作条垃圾桶（十四轮）：直删选区命中的高亮与摘抄，返回删除条数；**不弹确认**（用户选定） */
    /** 动作条垃圾桶直删（高亮按块 id / 摘抄按块 id）；**高亮块缺 ^id 时**用 highlightQuotes 按引用文本兜底删 */
    /** `opts.quiet` ＝ 静默删（改样式路径「先删旧再写新」用：三步只该报一条提示，用户 2026-09-18 报「弹三条」） */
    onTrashSelection?: (t: { highlightIds: string[]; excerptIds: string[]; highlightQuotes?: string[] }, opts?: { quiet?: boolean }) => Promise<number>;
    /** 书签数据（打开阅读器时读取） */
    bookmarks?: ReaderBookmark[];
    /** 笔记内链接进场（M1 双向溯源）：目标块 id（`^bk…`/`^hl…` 去掉 `^`）；阅读器挂载后消费一次并定位 */
    pendingTargetId?: string;
    /** 打开条目笔记（顶栏「打开笔记」按钮；宿主注入 → main.openEntryNote；条目无笔记时由宿主提示） */
    onOpenNote?: () => void;
    /** 书签变更回调（面板内新增/删除后通知宿主落盘） */
    onBookmarksChange?: (list: ReaderBookmark[]) => void;
    /** 划词翻译回调（动作条「译翻译」/顶栏快捷翻译触发；宿主用 requestUrl POST DeepSeek AI，返回译文或 null（失败/空）） */
    onTranslate?: (text: string) => Promise<string | null>;
    /** AI 搜索回调（AI 卡「解读选段」态：打开即自动发起 / 回车重跑；宿主读设置里的搜索服务商与提示词，返回答案或 null） */
    onAiSearch?: (text: string) => Promise<string | null>;
    /** AI 提问回调（AI 卡「自定义提问」态回车触发；宿主走同一条 AI 通道，**不读设置页提示词**，返回答案或 null） */
    onAiAsk?: (text: string, question: string) => Promise<string | null>;
    /** 打开外部链接（搜索卡引擎 chip → 系统浏览器；宿主 openExternalUrl 已限 http/https） */
    onOpenExternal?: (url: string) => void;
    /** 高亮数据源（阅读数据 JSON 注入；打开阅读器时读取一次，用于页内持久黄标渲染） */
    highlights?: ReaderHighlight[];
    /** 高亮回写（选中 → 一键即黄即记：正文立即标 mark + 自动写笔记高亮区；返回新块 id，null=失败） */
    onHighlight?: (quote: string, loc: { chapter: number; pct: number }, style?: HlStyle, color?: HlColor) => Promise<string | null>;
    /** 删除高亮（标注列表右键 → main 层确认 → 移除 <mark> + 从笔记删块；返回是否成功） */
    onDeleteHighlight?: (blockId: string) => Promise<boolean>;
    /** 通用确认（ConfirmModal 由视图层注入，替代原生 confirm）：书签 / 高亮 / 摘抄三处「清除全部」共用 */
    onConfirmClear?: (message: string) => Promise<boolean>;
    /** 批量删除标注（「清除全部」用；已一次性确认 → **不再逐条弹窗**）；kind 区分高亮/摘抄；返回删除条数 */
    onPurgeAnnotations?: (kind: 'highlight' | 'excerpt', blockIds: string[]) => Promise<number>;
}

/** 本次会话字号（会话内生效，跨面板共享；null=未初始化，打开时取设置默认） */
let readerFontSize: number | null = null;
/** 本次会话行距（倍数，跨面板共享；null=未初始化，打开时取设置默认） */
let readerLineHeight: number | null = null;
/** 字号调节范围（px） */
const FONT_MIN = 12;
const FONT_MAX = 30;
/** Ctrl/⌘+滚轮一次调多少（2026-10-23 用户指令：三阅读器统一支持滚轮改显示大小）。
 *  取 2 = 滑条一格的两倍 —— 滚轮手感上「一滚就看得见变化」，但仍能在 12–30 区间内微调。 */
const FONT_STEP = 2;
/** 行距调节范围（倍数） */
const LINE_MIN = 1.2;
const LINE_MAX = 2.4;
const LINE_STEP = 0.1;
/** 滚动保存节流（ms） */
const SAVE_THROTTLE = 300;
// 自动滚动速度 / 自动翻页间隔（用户 2026-09-15 裁定定速 150px/s、5 秒/页）：
// #341 起这两个值**可调**（右键「自动」弹窗滑条），参数与夹取真源在 `pure/readerAuto`，
// 面板侧只持有实例字段 `autoScrollPx` / `autoTurnMs`（初值取记忆值 / 缺省）。

/** 翻页动画时长（ms）：CSS scroll-snap 风格的 JS 平滑滚动（overflow:hidden 下 scrollTo({behavior:smooth}) 不生效） */
const PAGE_FLIP_MS = 220;

/** 平滑滚动到 scrollLeft=target（ease-out 二次方）。同帧内取消旧动画避免抖动。 */
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
        if (!cur || cur.id !== myId) return; // 被新动画顶掉
        const p = Math.min(1, (now - t0) / ms);
        const ease = 1 - (1 - p) * (1 - p);
        el.scrollLeft = start + change * ease;
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

export class TxtReaderPanel extends ReaderPanelBase<TxtReaderOptions> {
    private book: TxtBook;
    /** 正文滚动容器（右侧） */
    private scrollEl!: HTMLDivElement;
    /** 正文段落容器（字体调节作用域） */
    private textEl!: HTMLDivElement;

    constructor(
        container: HTMLElement,
        scope: Scope,
        options: TxtReaderOptions,
        closeView: () => void,
    ) {
        super(container, scope, options, closeView);
        this.book = parseTxtBook(options.text);
        this.lineHeight = options.settings?.lineHeight ?? 1.8;
        if (readerLineHeight === null) readerLineHeight = this.lineHeight;
        const p = options.progress;
        this.chapterIndex =
            p && Number.isInteger(p.chapterIndex) && p.chapterIndex >= 0 && p.chapterIndex < this.book.chapters.length
                ? p.chapterIndex
                : 0;
        this.highlightList = options.highlights ?? [];
        this.mode = normalizeScrollMode(options.scrollMode);
        this.lineWidth = normalizeLineWidth(options.lineWidth);
        this.theme = normalizeReaderTheme(options.theme);
        this.indent = options.settings?.indent !== false;
        this.fontFamily = normalizeFontFamily(options.settings?.fontFamily);
        this.fontWeight = normalizeFontWeight(options.settings?.fontWeight);
        this.letterSpacing = normalizeLetterSpacing(options.settings?.letterSpacing);
        this.hlStyle = normalizeHlStyle(options.settings?.hlStyle);
        this.hlColor = normalizeHlColor(options.settings?.hlColor);
    }

    /** 挂载渲染（替代原 Modal.onOpen；容器需已铺满视图） */
    mount(): void {
        const { container } = this;
        container.empty();
        container.addClass('rl-reader');
        // 阅读主题换肤：容器上挂 rl-rt-* 类覆盖 Obsidian 语义变量（follow 不挂类 = 完整继承主题）
        this.applyTheme();

        this.buildHeader();
        // 顶部常驻；自动隐藏撤销
        this.buildBody();
        // 译文就地浮层卡片（挂 selbarParent，buildBody 后 selbarParent 已就绪）
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
        // #351 键位：空格（朗读暂停/播放，没在朗读则暂停/继续自动）+ ↑↓（自动调速，不打断）
        document.addEventListener('keydown', this.onReaderKeydown);
        // 自动推进期间用户滚动/触摸即停
        this.container.addEventListener('wheel', this.onUserInterrupt, { passive: true });
        this.container.addEventListener('touchstart', this.onUserInterrupt, { passive: true });
        // 初始 pane 激活态同步：默认目录 tab 高亮；⚠️ 首次打开**始终收起目录**（用户 2026-09-15 裁定）
        this.activatePane('toc', false);
        this.tocEl.addClass('collapsed');
        this.syncSidebarToggle();
        this.applyFontSize();
        this.applyLineWidth();
        this.applyIndent();
        // 初始即翻页模式 → 挂 rl-paged 裁剪类（列式内联由 renderContent/setupPagedLayout 应用）
        this.scrollEl.toggleClass('rl-paged', this.isPaged());
        this.renderContent();
        // 初始章节滚动比例恢复（等布局完成后执行；溯源跳转已由 renderContent 内 jumpRatio 处理）
        const ratio = this.options.progress?.scrollRatio ?? 0;
        // 带目标块进场时不做进度恢复：目标位置优先，免得先滚到进度处再跳走（视觉上闪一下）
        if (ratio > 0 && this.jumpRatio === null && !this.options.pendingTargetId) {
            this.restoring = true;
            requestAnimationFrame(() => {
                this.restoreScroll(ratio);
                this.restoring = false;
            });
        }
        // 笔记内链接进场（M1 双向溯源）：正文已渲染，按块 id 定位到目标摘抄/高亮/书签
        this.consumePendingTarget();

        // 键盘翻页/翻章：← 上一页（翻页）/上一章（连续）；→ 下一页/下一章（scope 由 ReaderView 注入，仅阅读器 Tab 聚焦时生效）
        this.scope.register([], 'ArrowLeft', () => {
            this.goPrevPage();
            return false;
        });
        // Esc：只用于收起摘抄卡片 —— **不关闭阅读器**（用户 2026-09-17 裁定：退出只经由关闭标签页）。
        // 恒返回 false 阻止传播（视图层同键 handler 也已不再 detach）
        this.scope.register([], 'Escape', () => {
            if (this.isExcerptCardOpen()) this.hideExcerptCard();
            if (this.isSearchCardOpen()) this.hideSearchCard();
            if (this.isNetPanelOpen()) this.hideNetPanel();
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
        this.saveTimer = null;
        this.disposeHeadDensity?.(); // #345 顶栏窄屏收纳的 ResizeObserver 随面板注销
        this.disposeHeadDensity = null;
        this.disposeFade?.(); // 侧栏溢出渐隐的 scroll/RO/MO 监听随面板注销
        this.disposeFade = null;
        this.ttsSvc?.destroy(); // 朗读随面板一并停止（cancel + 清高亮）
        this.resetAnnotate(); // 关面板复位标注模式
        if (this.fsListenerRegistered) {
            document.removeEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = false;
        }
        // 选中动作条 document 监听随面板一并注销（bar 本身随 container.empty 移除）
        document.removeEventListener('mousedown', this.onDocMouseDown);
        document.removeEventListener('keydown', this.onReaderKeydown);
        if (this.scrollRaf !== null) {
            window.cancelAnimationFrame(this.scrollRaf);
            this.scrollRaf = null;
        }
        // 自动推进（自动滚动 rAF / 自动翻页定时器）随面板一并停止
        this.stopAuto();
        if (this.switchTimer !== null) {
            window.clearTimeout(this.switchTimer);
            this.switchTimer = null;
        }
        // 框选层是 fixed 遮罩、挂在 document.body 上 —— 面板没了它必须一起收（否则整窗点不动）
        this.shotOverlay?.destroy();
        this.shotOverlay = null;
        this.container.empty();
    }

    // ── 构建 ──

    private buildHeader(): void {
        const head = this.container.createDiv({ cls: 'rl-reader-head' });
        this.headEl = head;

        // 侧栏折叠/展开开关（最左；点击 toggleToc；图标与标题随折叠态变化）
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

        // 快捷入口（书签/摘抄/翻译/高亮）：先建在 head 上，ops 就绪后搬进右侧设置按钮左边（用户 2026-09-15 裁定）
        // 标注模式锁：激活后选中即自动触发；再点退出
        const quickWrap = head.createDiv({ cls: 'rl-reader-quick' });
        const mkQuick = (id: ReaderQuickMode, icon: string, title: string): HTMLButtonElement => {
            const b = quickWrap.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': title } });
            safeSetIcon(b, icon);
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => this.toggleAnnotate(id));
            this.quickBtns[id] = b;
            return b;
        };
        // 顺序（用户 2026-09-18）：书签 · 高亮 · 摘抄 · 翻译 · 网络搜索 · AI搜索
        mkQuick('bookmark', 'bookmark', '书签模式：单击正文存书签，再点退出');
        mkQuick('highlighter', 'highlighter', '高亮模式：选中文字即高亮，再点退出');
        mkQuick('quote', 'quote', '摘抄模式：选中文字即加摘抄，再点退出');
        mkQuick('languages', 'languages', '翻译模式：选中文字即翻译，再点退出');
        // 搜索拆成两个独立快捷入口（用户 2026-09-18）：与其他快捷入口同款**模式开关**，
        // 拖选文字后直接进各自通道（不再有「网络搜索 / AI 搜索 二选一」那一跳）。
        // 图标名≠模式 id（netsearch / aisearch 不是图标名），故 mkQuick 显式收 icon。
        mkQuick('netsearch', 'globe', '网络搜索模式：拖选文字后选搜索引擎，再点退出');
        mkQuick('aisearch', 'sparkles', 'AI 搜索模式：拖选文字后由 AI 作答，再点退出');
        // 区域截图（2026-10-23 用户指令）：一次性动作，⛔ 不走 toggleAnnotate（那不是「模式」，
        //   点一次框一次；做成模式会留下一个「激活态」按钮而没有任何持续语义）。
        if (this.options.onShotSave) {
            const shotBtn = quickWrap.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': '区域截图：框选区域截图回填笔记内' } });
            safeSetIcon(shotBtn, 'image');
            shotBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
            shotBtn.addEventListener('click', () => this.startShot());
        }

        // 目录/书签/摘抄 切换改由侧栏 tab 行承担（顶部仅渲染一次）
        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        // 初值书名，mount 末尾 renderContent 会立刻替换为当前章「第几章：章名」（用户 2026-09-16 裁定）
        this.headTitleEl = titleWrap.createSpan({ cls: 'rl-reader-title', text: this.options.title });
        // #345：标题同时挂 data-tip 全称 —— 长章节名被省略号截断后，悬停是唯一能看到完整标题的入口
        this.setHeadTitle(this.options.title);

        const ops = head.createDiv({ cls: 'rl-reader-ops' });
        // #345 窄屏「更多」⋮：常态隐藏（窄屏才由 CSS 显示），快捷入口会被整体搬进它下面的浮层
        this.moreBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-more', attr: { 'data-tip': '更多' } });
        safeSetIcon(this.moreBtn, 'ellipsis-vertical');
        this.moreBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.moreBtn.addEventListener('click', () => this.toggleMore());
        this.morePanelEl = ops.createDiv({ cls: 'rl-reader-menu rl-reader-more-panel hidden' });
        // 浮层自 mousedown 不冒泡：点浮层里的快捷入口不能触发 onDocMouseDown 把它自己收掉
        this.morePanelEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        // 阅读设置（≡）：T6 下拉菜单（字号/行距/模式/全屏）；行距±按钮已并入菜单
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        // 阻止 mousedown 冒泡到 document（onDocMouseDown 会先收起菜单，导致 click toggle 逻辑反相）
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);
        // 快捷入口（书签/摘抄/翻译/高亮）移到右侧设置按钮左边（用户 2026-09-15 裁定）
        ops.insertBefore(quickWrap, this.settingsBtn);
        // #345 窄屏收纳：head 宽度 < HEAD_NARROW_W 时把 quickWrap **整体搬进**「更多」浮层（同一批按钮实例，
        // 激活态/监听器原样保留），宽屏再搬回 ops。dispose 在 destroy() 里注销。
        this.disposeHeadDensity = attachHeadDensity({
            headEl: head,
            quickWrap,
            opsEl: ops,
            anchor: this.settingsBtn,
            moreSlot: this.morePanelEl,
            // #379：标题绝对居中，宽度由 readerHead 按实测两侧边缘算（恒居中且不压图标）
            titleEl: titleWrap,
        });
    }

    /**
     * 设置下拉菜单（追加到 ops 下，CSS 绝对定位右对齐 ops 底部）：
     * 字号 −/+（adjustFont）、行距 −/+（adjustLineHeight）、模式（滚动 / 翻页，当前项勾选）、全屏显示。
     * 菜单自身 mousedown 阻止冒泡：点行内动作不触发 onDocMouseDown 收起；点外部才关（toggleSettings 反向切换即可）。
     */
    private buildSettingsMenu(ops: HTMLElement): void {
        const menu = ops.createDiv({ cls: 'rl-reader-menu hidden' });
        this.menuEl = menu;
        menu.addEventListener('mousedown', (ev) => ev.stopPropagation());

        // ── 显示 ──（#351 建为「显示 / 排版」两组；🔴 #351b 用户口径：阅读 / 行宽 / 缩进**并到字体与字重之间**、
        //    「排版」分组整体撤除 ⇒ 现在只剩一个分组，行序 = 字体 / 阅读 / 行宽 / 缩进 / 字重 / 字号 / 行距 / 字距 / 主题）
        const disp = this.buildMenuSection(menu, '显示');

        // 字体行（#351 建为下拉；🔴 #351e 用户口径「字体也改成纯字变色选择」⇒ 与其余排版项同款切换）
        // `default` = 不写 font-family，完全交回宿主与主题
        const famRow = this.buildMenuRow(disp, '字体');
        this.familySeg = this.buildSeg(famRow, FONT_FAMILY_OPTIONS, this.fontFamily, (v) => this.setFontFamily(v));

        // 阅读 / 行宽 / 缩进（🔴 #351b 用户口径：从「排版」分组**并到字体与字重之间**）
        const modeRow = this.buildMenuRow(disp, '阅读');
        this.modeSeg = this.buildSeg(modeRow, SCROLL_OPTIONS, this.mode, (v) => this.setMode(v as ScrollMode));
        // 行宽（`strict` 的**标签**按用户口径显示「适中」，取值不动 → 旧数据照旧读）
        const widthRow = this.buildMenuRow(disp, '行宽');
        this.widthSeg = this.buildSeg(widthRow, WIDTH_OPTIONS, this.lineWidth, (v) => this.setLineWidth(v as ReaderLineWidth));
        // 缩进（首行 / 齐头）
        const indentRow = this.buildMenuRow(disp, '缩进');
        this.indentSeg = this.buildSeg(indentRow, INDENT_OPTIONS, this.indent, (v) => this.setIndent(v));

        // 字重行（纯字变色切换）：常规 / 粗体
        const weightRow = this.buildMenuRow(disp, '字重');
        this.weightSeg = this.buildSeg(weightRow, FONT_WEIGHT_OPTIONS, this.fontWeight, (v) => this.setFontWeight(v));

        // 字号行：滑条（12-30px 步进 1）+ 当前值文本（用户 2026-09-16 指示：± 按钮改滑条）
        const fontRow = this.buildMenuRow(disp, '字号');
        this.menuFontSlider = this.buildSlider(fontRow, {
            min: FONT_MIN,
            max: FONT_MAX,
            step: 1,
            tip: '拖动调整正文字号（←/→ 微调）',
            onInput: (v) => this.applyFontValue(v, false),
            onChange: (v) => this.applyFontValue(v, true),
        });
        this.menuFontVal = fontRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 行距行：滑条（1.2-2.4 步进 0.1）+ 当前值文本
        const lineRow = this.buildMenuRow(disp, '行距');
        this.menuLineSlider = this.buildSlider(lineRow, {
            min: LINE_MIN,
            max: LINE_MAX,
            step: LINE_STEP,
            tip: '拖动调整行距（←/→ 微调）',
            onInput: (v) => this.applyLineValue(v, false),
            onChange: (v) => this.applyLineValue(v, true),
        });
        this.menuLineVal = lineRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 字距行（#351）：滑条（-0.02 ～ 0.12em 步进 0.01）；负值收紧，长文更紧凑
        const letterRow = this.buildMenuRow(disp, '字距');
        this.letterSlider = this.buildSlider(letterRow, {
            min: LETTER_MIN,
            max: LETTER_MAX,
            step: LETTER_STEP,
            tip: '拖动调整字距（←/→ 微调）',
            onInput: (v) => this.applyLetterValue(v, false),
            onChange: (v) => this.applyLetterValue(v, true),
        });
        this.letterVal = letterRow.createSpan({ cls: 'rl-reader-menu-val' });

        // 主题（用户 2026-09-16）：六档色卡并排 —— 跟随主题 / 经典白 / 夜间黑 / 护眼绿 / 深灰 / 羊皮纸；
        // 点击即换肤（容器变量覆盖，见 styles.css .rl-rt-*）+ 写回设置；当前档加强调色外圈环
        const themeRow = disp.createDiv({ cls: 'rl-reader-menu-row rl-reader-theme-row' });
        themeRow.createSpan({ cls: 'rl-reader-menu-label', text: '主题' });
        for (const meta of READER_THEMES) {
            const sw = themeRow.createEl('button', {
                cls: 'rl-btn rl-reader-theme-swatch',
                attr: { type: 'button', 'data-theme': meta.id, 'data-tip': meta.label },
            });
            sw.addEventListener('click', () => this.setTheme(meta.id));
            this.themeSwatches[meta.id] = sw;
        }

        // 🔴 全屏 / 沉浸 / 自动 / 朗读 已迁移到**底栏图标组**（`buildFooter` 的 `.rl-reader-fops`）——
        //    用户口径：「这些高频操作做成图标按钮放到底部控制栏上，不要塞进设置面板里」（#351）

        // 🔴 #351b 用户口径「删除排版下面的小字」⇒ 面板底部那两行快捷键小字**整块撤除**。
        //    ⚠️ 两处浮层（自动 / 朗读）底部的键位小字（`.rl-reader-pop-hint`）**保留** ——
        //    那里才是「按下这个键时眼睛正好在的地方」，撤掉面板那份不损失可达性。
        this.syncSettingsLabels();
    }

    /** 设定字距（滑条；#351）：口径同字号 —— 拖动只上屏，松手才落库 */
    private applyLetterValue(next: number, persist: boolean): void {
        const clamped = normalizeLetterSpacing(next);
        if (clamped === this.letterSpacing) {
            this.syncSettingsLabels();
            return;
        }
        this.letterSpacing = clamped;
        // 字距只改文本度量，**不改换行宽度预算** ⇒ 仍按比例归位（与字号/行距同一套）
        const ratio = this.currentRatio();
        this.applyTypeVars();
        this.reflowKeepRatio(ratio);
        if (persist) this.applyTypeStyle(true);
        else this.syncSettingsLabels();
    }

    /**
     * 应用字体族 / 字重 / 字距到正文容器（#351）。
     * 🔴 `default` / `normal` / 0 一律**清内联**（`removeProperty`），而不是写回宿主的默认值 ——
     *    主题换肤 / 用户自定义 CSS 才能继续生效（写死 `font-family: inherit` 会盖掉它们）。
     */
    protected applyTypeVars(): void {
        const el = this.textEl;
        if (!el) return;
        const fam = fontFamilyCss(this.fontFamily);
        if (fam) el.style.fontFamily = fam;
        else el.style.removeProperty('font-family');
        const w = fontWeightCss(this.fontWeight);
        if (w === 400) el.style.removeProperty('font-weight');
        else el.style.fontWeight = String(w);
        const ls = formatLetterSpacing(this.letterSpacing);
        if (ls === '0em') el.style.removeProperty('letter-spacing');
        else el.style.letterSpacing = ls;
    }

    // ── 语音朗读（#340 建立；#344 起两个音源）──

    /**
     * 建两个**音源引擎**与朗读服务（#344 方案 C）：
     *  - 系统语音：Web Speech API（移动端常没有 ⇒ `available()` false）；
     *  - 云合成：硅基流动（未配 Key ⇒ `available()` false，弹窗里对应项给出原因）。
     * 🔴 音源真源 = localStorage（`pure/tts` 的 `rl-tts-engine`）：本弹窗 chips 与设置页下拉读写同一份。
     * 🔴 音色记忆**按音源分开**（系统 voiceURI / 云音色全称）—— 拿系统 id 去当云音色会被云侧拒（400）。
     */
    private initTts(): void {
        const cloud = new CloudSpeechEngine({
            http: async (req) => {
                const res = await requestUrl({
                    url: req.url,
                    method: "POST",
                    contentType: "application/json",
                    headers: req.headers,
                    body: req.body,
                    responseType: "arraybuffer",
                } as unknown as Parameters<typeof requestUrl>[0]);
                return { status: res.status, arrayBuffer: res.arrayBuffer, text: res.text };
            },
            key: () => this.cloudKey(),
            notice: (msg) => new Notice(msg, 5000),
        });
        const kind: TtsEngineKind = loadTtsEngine() ?? "system";
        this.ttsSvc = new TtsService(
            {
                text: () => this.textEl?.textContent ?? "",
                root: () => this.textEl ?? null,
                scroller: () => this.scrollEl ?? null,
                onState: (on) => this.syncTtsBtn(on),
            },
            {
                engines: { system: new SystemSpeechEngine(), cloud },
                engine: kind,
                rate: loadTtsRate() ?? TTS_RATE_DEFAULT,
                volume: loadTtsVolume() ?? TTS_VOLUME_DEFAULT,
                voice: kind === "cloud" ? loadCloudVoice() : loadVoiceUri(),
            },
        );
    }

    /** 切换阅读主题（菜单色卡）：即时换肤 + 色卡选中态 + 写回设置持久化 */
    private setTheme(t: ReaderThemeId): void {
        this.theme = t;
        this.applyTheme();
        this.syncThemeSwatches();
        this.options.onThemeChange?.(t);
    }

    /** 浮出选择器（默认贴在动作条上方，当前档打勾）。
     *  anchor = 宿主 client 坐标（顶栏「选中即高亮」模式动作条不在场 → 以鼠标位置为锚点，否则色板无处可贴）。 */
    protected showHlPicker(anchor: { x: number; y: number } | null = null): void {
        const p = this.buildHlPicker();
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!p || !parent) return;
        this.hlPickerAnchor = anchor;
        for (const st of HL_STYLES) this.hlStyleBtns[st.id]?.toggleClass('is-on', st.id === this.hlStyle);
        for (const co of HL_COLORS) this.hlColorBtns[co.id]?.toggleClass('is-on', co.id === this.hlColor);
        this.hlTrashBtn?.toggleClass('hidden', !this.hlTrashReady);
        // 样式预览跟随当前颜色（A 的底色/线色）
        p.setAttribute('data-color', this.hlColor);
        p.removeClass('hidden');
        if (anchor || bar) {
            const pRect = parent.getBoundingClientRect();
            const box = p.getBoundingClientRect();
            let left: number;
            let top: number;
            if (anchor) {
                // 鼠标锚点：水平居中于指针，优先贴选选区上方，放不下转下方
                left = anchor.x - pRect.left - box.width / 2;
                top = anchor.y - pRect.top - box.height - 8;
                if (top < 4) top = anchor.y - pRect.top + 8;
            } else {
                // ⚠️ 动作条可能已 display:none（隐藏后 getBoundingClientRect 全 0）→ 改用动作条**上次写入的
                //    left/top**（隐藏后仍在 style 上），否则色卡会飞到左上角。
                const barLeft = parseFloat(bar?.style.left ?? '');
                const barTop = parseFloat(bar?.style.top ?? '');
                left = Number.isFinite(barLeft) ? barLeft : Math.max(4, (pRect.width - box.width) / 2);
                top = Number.isFinite(barTop) ? barTop - box.height - 6 : 4;
            }
            p.style.left = `${Math.round(Math.max(4, Math.min(left, pRect.width - box.width - 4)))}px`;
            p.style.top = `${Math.round(Math.max(4, top))}px`;
        }
    }

    /** 浮层垃圾桶：删掉选区对应的高亮与摘抄（用户 2026-09-16 选定「不弹确认」） */
    protected async trashSelection(): Promise<void> {
        const text = this.selRecord?.text.trim() ?? '';
        const loc = this.currentLoc();
        // 选段落在哪条高亮 mark 上（DOM 判据，与垃圾桶显隐同源）：拿到块 id 就直接按 id 删 ——
        // 即使本地清单里没有这条记录（列表过期）也删得掉，重绘的「无命中摊平」会把屏幕上的残影清掉。
        const mark = this.selRecord?.mark ?? null;
        const targetId = this.hlPickerTargetId ?? (mark?.id || null);
        const hl = targetId
            ? this.highlightList.find((h) => h.id === targetId) ?? null
            : findSameHighlight(this.highlightList, text, loc.chapter);
        const ex = findSameExcerpt(this.options.excerpts ?? [], text || hl?.quote || mark?.quote || '', loc.chapter);
        const highlightIds = hl?.id ? [hl.id] : targetId ? [targetId] : [];
        // 🔴 兜底通道（2026-09-18）：块缺 ^id（老数据 / 手写笔记 / 块被外部改写）时，按**引用文本**删 ——
        //    否则垃圾桶点下去「什么都没发生」（旧实现：highlightIds 为空 → 直接提示「没有可删除的」）。
        const highlightQuotes = hl && !hl.id ? [hl.quote] : mark && !mark.id ? [mark.quote] : [];
        const excerptIds = ex?.id ? [ex.id] : [];
        if (highlightIds.length === 0 && highlightQuotes.length === 0 && excerptIds.length === 0) {
            new Notice('这段没有可删除的摘抄或高亮（高亮可能已在别处删除）');
            this.hideHlPicker();
            return;
        }
        if (!this.options.onTrashSelection) {
            new Notice('当前阅读器不支持删除');
            this.hideHlPicker();
            return;
        }
        try {
            const n = await this.options.onTrashSelection({ highlightIds, excerptIds, highlightQuotes });
            if (!n) new Notice('删除未生效：高亮存档里找不到该条（可重开阅读器后再试）');
        } catch (err) {
            new Notice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
        }
        if (highlightIds.length || highlightQuotes.length) {
            // 本地列表同步清掉：按 id 命中，或（无 id 时）按引用文本命中
            const qs = highlightQuotes.map((q) => q.replace(/\s+/g, ''));
            this.highlightList = this.highlightList.filter(
                (h) => !highlightIds.includes(h.id ?? '') && !qs.includes((h.quote ?? '').replace(/\s+/g, '')),
            );
            this.applyHighlights();
            this.refreshHighlightToc();
        }
        this.hlPickerTargetId = null;
        this.hlTrashReady = false;
        this.hideSelbar();
        this.hideHlPicker();
    }
    /** 设定首行缩进（排版分段：首行 / 齐头）：亮起态**先**重绘（无条件、不落在宿主回调之后）→ 应用 → 写回设置 */
    protected setIndent(on: boolean): void {
        this.indent = on;
        this.syncSegItems(this.indentSeg, String(on));
        this.applyIndent();
        const ratio = this.currentRatio();
        this.reflowKeepRatio(ratio);
        this.options.onSettingsChange?.({
            fontSize: this.currentFontPx(),
            lineHeight: this.currentLineHeight(),
            indent: on,
        });
        requestAnimationFrame(() => this.syncSegItems(this.indentSeg, String(on)));
    }

    /** 应用首行缩进：正文列挂 rl-indent 类（CSS text-indent: 2em） */
    private applyIndent(): void {
        this.textEl.toggleClass('rl-indent', this.indent);
    }

    /** 会话当前字号（px） */
    protected currentFontPx(): number {
        return readerFontSize ?? this.options.settings?.fontSize ?? 16;
    }

    /** 会话当前行距（倍数） */
    protected currentLineHeight(): number {
        return readerLineHeight ?? this.lineHeight;
    }

    /** 沉浸模式（用户 2026-09-15）：隐藏上下边栏；**点正文空白**收起 / 展开；再点按钮退出。
     *  🔴 #603 改正注释：这里**没有**「鼠标靠近顶部 / 底部边缘临时唤出」那条热区 —— 它在 2026-09-15
     *     就被用户裁定撤掉了（换成点击正文空白）。旧注释一直没跟着改，底栏那枚按钮的悬停提示便跟着错了。*/
    private setImmersive(on: boolean): void {
        if (on === this.immersive) return;
        this.immersive = on;
        this.container.toggleClass("rl-reader-focus", on);
        // 进入即无唤出态：顶栏上移出视野、底栏下滑收起（底栏改浮层不占位 → 正文铺满）
        this.headEl?.toggleClass("hidden", on);
        this.footEl?.removeClass("rl-foot-show");
        // 🔴 #351b 修：不再用 `settingsOpen` 门 —— 沉浸按钮自 #351 起在**底栏**（常显），
        //    带门就等于「面板没开时点了不亮」，用户报障「点击不保持高亮」的真因。
        this.syncViewBtns();
        // 上下边栏不再占位 → 正文可视高变化；翻页模式按新列高重排并保持阅读位置
        requestAnimationFrame(() => {
            if (!this.isPaged()) return;
            const ratio = this.currentRatio();
            this.setupPagedLayout();
            this.goToPage(ratioToPage(ratio, this.totalPages), false);
            this.updateProgress();
        });
    }

    /** 开始自动滚动（rAF + 时间增量推进；按 `autoScrollPx`（#341 可调）匀速连续；到底由既有触底自动翻章接管） */
    protected startAutoScroll(): void {
        if (this.autoRaf !== null) return;
        this.autoLastTs = 0;
        this.autoPos = null; // 起手先与真实位置对表（见 autoTick）
        this.autoRaf = requestAnimationFrame(this.autoTick);
    }

    /** 自动滚动帧：按时间增量推进滚动位置（限幅防恢复/切页期间跳变）；末章读完自动停 */
    private autoTick = (ts: number): void => {
        if (!this.autoOn) {
            this.autoRaf = null;
            return;
        }
        const dt = this.autoLastTs > 0 ? Math.min(0.1, (ts - this.autoLastTs) / 1000) : 0;
        this.autoLastTs = ts;
        const el = this.scrollEl;
        const lastChapter = this.chapterIndex >= this.book.chapters.length - 1;
        if (!this.restoring && el && dt > 0) {
            const max = el.scrollHeight - el.clientHeight;
            // #342：位置由**自己累积**（`advanceAutoPos`），⛔ 不能读回 `el.scrollTop` 再相加 ——
            //   `scrollTop` 写入被浏览器取整：120Hz 上 50px/s 每帧 0.417px ⇒ 被吸成 0 ⇒ 完全不动；
            //   60Hz 上 0.83px 又被抬成 1px ⇒ 实际超速 20%。偏差 > 2px 视为「外部挪过位置」→ 重新对表。
            const real = el.scrollTop;
            if (this.autoPos === null || Math.abs(real - this.autoPos) > 2) this.autoPos = real;
            const next = advanceAutoPos(this.autoPos, this.autoScrollPx, dt, max);
            this.autoPos = next;
            if (max > 0 && next < max - 0.5) {
                el.scrollTop = next;
            } else if (lastChapter && (max <= 0 || next >= max - 0.5)) {
                this.stopAuto();
                this.syncViewBtns();
                new Notice("已读完全书");
                return;
            }
        }
        this.autoRaf = requestAnimationFrame(this.autoTick);
    };

    /** 自动翻页一拍：全书末页 → 停并提示；否则翻下一页（翻页模式一页 / 滚动模式一屏） */
    protected autoTurnTick(): void {
        if (!this.autoOn) return;
        const lastChapter = this.chapterIndex >= this.book.chapters.length - 1;
        if (lastChapter && isLastPage(this.pageIndex, this.totalPages)) {
            this.stopAuto();
            this.syncViewBtns();
            new Notice("已读完全书");
            return;
        }
        this.goNextPage();
    }

    // ── 底部工具条（T6） ──

    /**
     * 构建底部工具条（用户 2026-09-21 象形稿定案）：
     *   `[«] [‹]  章节名… ━━━ 已读 29%  [⛶] [👁] [⏱] [🔊]  [›] [»]`
     * 即**五段**：左端翻页组 → 章名 → 进度条 → 已读百分比 → 高频四钮 → 右端翻页组。
     * 🔴 两端各放一组翻页钮的用意：底栏两端是鼠标最容易停的位置（Fitts），章节级与页级各一组，
     *    中段整块留给「我现在读到哪儿」；原先四钮挤在一处 + 章名顶在最左，读一次位置要横跨整条。
     * ⚠️ 两组翻页钮共用 `.rl-reader-fnav`（既有 22px 定高、2px 间隙等规则一并复用），
     *    另加 `-l` / `-r` 只用于区分左右（同一套样式，不额外写过第二条规则）。
     */
    private buildFooter(): void {
        // 底栏挂到右侧栏（.rl-reader-main）内 —— 目录栏独立成一整列，底栏不再横跨到目录下方
        const mainCol = this.scrollEl?.closest('.rl-reader-main') as HTMLElement | null;
        const footer = (mainCol ?? this.container).createDiv({ cls: 'rl-reader-footer' });
        this.footEl = footer;

        // ① 左端翻页组：上一章 / 上一页（用户 2026-09-16 起就有的两个动作，本轮只挪位置）
        const navL = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-l' });
        const prevCh = navL.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(prevCh, 'chevrons-left');
        prevCh.setAttribute('data-tip', '上一章');
        prevCh.addEventListener('click', () => this.navPrev());
        const prev = navL.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(prev, 'chevron-left');
        prev.setAttribute('data-tip', '上一页');
        prev.addEventListener('click', () => this.goPrevPage());

        // ② 中段读数：章名 → 全书进度条 → 已读 X%（口径见 pure/readerFooter，TXT/EPUB/PDF 共用）
        this.footerFchEl = footer.createSpan({ cls: 'rl-reader-fch' });
        const prog = footer.createDiv({ cls: 'rl-reader-fprog' });
        this.footerFillEl = prog.createDiv({ cls: 'rl-reader-fprog-fill' });
        this.footerFpctEl = footer.createSpan({ cls: 'rl-reader-fpct' });

        // ③ 高频操作（#351 用户口径：「全屏 / 沉浸 / 自动 / 朗读做成图标按钮放到底部控制栏上，
        //    不要塞进设置面板里」）：纯状态切换 —— 点击即时生效 + 图标高亮，悬停出轻提示；
        //    自动 / 朗读 支持**右键**开各自的小设置浮层（复用既有 openAutoMenu / openTtsMenu）。
        const fops = footer.createDiv({ cls: 'rl-reader-fops' });
        const mkFop = (icon: string, tip: string, onClick: () => void): HTMLButtonElement => {
            const b = fops.createEl('button', { cls: 'rl-btn rl-reader-btn' });
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', tip);
            b.addEventListener('click', onClick);
            return b;
        };
        this.fsBtnEl = mkFop('maximize', '全屏显示', () => this.toggleFullscreen());
        // 🔴 #603：这三条「描述行为」的提示走**四件共用**的真源 `pure/readerFops`
        //    （⛔ 别在这里写第二份字面量 —— TXT / EPUB 那两句**漏改**的老路就是这么来的，
        //      详见 `pure/readerFops` 头部那两条由来）。
        this.immersiveBtnEl = mkFop('eye', READER_FOPS.immersive, () => this.setImmersive(!this.immersive));
        this.autoBtnEl = mkFop('timer', READER_FOPS.autoScrollPaged, () => this.setAuto(!this.autoOn));
        this.autoBtnEl.addEventListener('contextmenu', (ev) => this.openAutoMenu(ev));
        this.ttsBtnEl = mkFop('volume-2', '从本段开始朗读', () => this.toggleTts());
        this.ttsBtnEl.addEventListener('contextmenu', (ev) => this.openTtsMenu(ev));
        this.initTts();
        this.syncTtsAvailability();

        // ④ 右端翻页组：下一页 / 下一章
        const navR = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-r' });
        const next = navR.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(next, 'chevron-right');
        next.setAttribute('data-tip', '下一页');
        next.addEventListener('click', () => this.goNextPage());
        const nextCh = navR.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(nextCh, 'chevrons-right');
        nextCh.setAttribute('data-tip', '下一章');
        nextCh.addEventListener('click', () => this.navNext());

        if (!document.fullscreenEnabled) {
            this.fsBtnEl.disabled = true;
            this.fsBtnEl.setAttribute('data-tip', '当前环境不支持全屏');
        }
        this.syncViewBtns();
    }

    /**
     * › 下一章：非末章 → switchChapter(+1)；末章 → Notice
     */
    private navNext(): void {
        if (this.chapterIndex >= this.book.chapters.length - 1) {
            new Notice('已是全书结尾');
            return;
        }
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 1 });
        this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
        this.switchChapter(this.chapterIndex + 1);
    }

    private buildBody(): void {
        const body = this.container.createDiv({ cls: 'rl-reader-body' });
        // 选中动作条定位上下文：body 作为相对定位父级（动作条 absolute 悬浮正文区，不随 scrollEl 滚动位移）
        body.style.position = 'relative';
        this.selbarParent = body;

        // 左侧目录列：「目录 | 摘抄」两 tab（用户 2026-09-17 裁定：书签并入摘抄栏，栏内顺序 书签 → 高亮 → 摘抄）
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '章节目录' } });
        safeSetIcon(tocTab, 'list-tree');
        const exTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签 · 高亮 · 摘抄' } });
        safeSetIcon(exTab, 'quote');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        // 每章字数（#338 目录显示 / #345 口径：中文按字、英文按词）：章界是段落下标，book.paragraphs 已在内存，直接累计
        const tocChars = txtChapterUnits(this.book.paragraphs, this.book.chapters);
        this.book.chapters.forEach((ch, i) => {
            const item = this.tocListEl.createEl('button', { cls: 'rl-reader-toc-item', attr: { 'data-tip': ch.title } });
            item.createSpan({ cls: 'rl-reader-toc-label', text: ch.title });
            item.createSpan({ cls: 'rl-reader-toc-chars', text: formatCharCount(tocChars[i] ?? 0) });
            item.addEventListener('click', () => this.switchChapter(i));
        });
        // 目录侧栏可拖宽（#338：为显示字数；记忆宽度在 localStorage，拖动期间关掉宽度过渡）
        attachTocResizer(this.tocEl, 'txt');
        // 标注 pane（原「摘抄」页）：书签 / 高亮 / 摘抄三区上下叠放，各区自带「计数 + 选择」头
        // （#345 用户裁定：「清除全部」这种不可逆的一键清空改为**选择模式** —— 能看见具体条目、
        //   可勾选单条或多条后「删除所选」。三区结构同构，共用 pure/annoSelection.buildAnnoHead。）
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        // Ⅰ 书签区（列表填充 .rl-reader-bm-empty / .rl-reader-bm-item；点击定位 / 右键删除）
        this.bmHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-bm-list',
            text: '书签（0）',
            onDelete: (ids) => this.deleteSelectedBookmarks(ids),
            allIds: () => this.bookmarks().map((b) => b.id),
            refresh: () => this.buildBookmarkToc(),
        });
        this.bmSel = this.bmHeadRef.sel;
        this.bmCountEl = this.bmHeadRef.countEl;
        this.bmListEl = this.bmHeadRef.listEl;
        this.buildBookmarkToc();
        // Ⅱ 高亮区
        this.hlHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-hl-list',
            text: '高亮（0）',
            extraCls: 'rl-reader-ex-head',
            onDelete: (ids) => this.deleteSelectedHighlights(ids),
            allIds: () => this.highlightList.map((h) => h.id),
            refresh: () => this.refreshHighlightToc(),
        });
        this.hlSel = this.hlHeadRef.sel;
        this.hlCountEl = this.hlHeadRef.countEl;
        this.hlListEl = this.hlHeadRef.listEl;
        // Ⅲ 摘抄区
        this.exHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-ex-list',
            text: '摘抄（0）',
            extraCls: 'rl-reader-ex-head',
            onDelete: (ids) => this.deleteSelectedExcerpts(ids),
            allIds: () => (this.options.excerpts ?? []).map((x) => x.id),
            refresh: () => this.buildExcerptToc(),
        });
        this.exSel = this.exHeadRef.sel;
        this.exCountEl = this.exHeadRef.countEl;
        this.exListEl = this.exHeadRef.listEl;
        // 侧栏滚动条刻意隐藏 ⇒ 溢出时没有任何线索（末行被裁一半，用户读作「显示不全」）。
        // 门控渐隐挂到两个**真正会滚**的容器：目录页 = tocListEl（它有 flex:1 + overflow-y:auto），
        // 标注页 = exPane 本人（书签/高亮/摘抄三个 list 都没有自己的滚动框，是 pane 在滚）。
        this.disposeFade = attachScrollFades([this.tocListEl, exPane]);
        this.refreshHighlightToc();
        this.buildExcerptToc();
        tocTab.addEventListener('click', () => this.activatePane('toc'));
        exTab.addEventListener('click', () => this.activatePane('ex'));

        // 右侧栏：正文 + 底栏同处一栏（目录栏因而独立成一整列，用户 2026-09-16）
        const mainCol = body.createDiv({ cls: 'rl-reader-main' });
        // 右侧正文区（连续滚动容器）
        this.scrollEl = mainCol.createDiv({ cls: 'rl-reader-scroll' });
        this.scrollEl.createDiv({ cls: 'rl-reader-chapter-title' });
        this.textEl = this.scrollEl.createDiv({ cls: 'rl-reader-text' });
        // #351：字体 / 字重 / 字距在**建好正文容器后立刻应用一次**（否则要等用户打开面板才生效）
        this.applyTypeVars();

        // 滚动事件：保存进度（节流）+ 触底自动翻章（连续阅读）
        this.scrollEl.addEventListener('scroll', () => this.onScroll());
        // 滚动即收起选中动作条与译文浮层（选区/译文已不对应当前屏幕）
        this.scrollEl.addEventListener('scroll', () => {
            this.hideSelbar();
            this.hideTranslateCard();
        });

        // 正文选中（mouseup）→ 弹出选中动作条；挂在滚动容器上（textEl 的 mouseup 会冒泡），
        // 拖动结束落在正文 padding/外缘时也能收起或弹出，不产生「有选区无动作条」的死态；
        // 选中非空才显示，空选（普通点击）直接收起
        this.scrollEl.addEventListener('mouseup', (ev) => this.onTextMouseUp(ev));
        // #355 点击正文段落 → 重设朗读起读点（点哪儿听哪儿）；挂在 textEl 上 ⇒ 只有点到正文才算
        this.textEl.addEventListener('click', (ev) => this.onTextClickAnchor(ev));
        // 翻页模式点屏两侧翻页：仅在无文字选区 + 落在正文左右 1/4 时触发（点中央保留选中/不误翻）
        this.scrollEl.addEventListener('click', (ev) => this.onBodyClickPage(ev));
        // 翻页模式滚轮横向切页 + Ctrl/⌘+滚轮调字号（2026-10-23 用户指令：三阅读器统一支持 Ctrl+滚轮改显示大小）。
        // 🔴 Ctrl+滚轮优先级最高：命中即 preventDefault（否则 Obsidian 自身会把它当整页缩放），且不再翻页。
        this.scrollEl.addEventListener(
            'wheel',
            (ev) => {
                if (ev.ctrlKey || ev.metaKey) {
                    ev.preventDefault();
                    // 方向：向上滚（deltaY < 0）= 放大，与系统/浏览器缩放一致
                    this.adjustFont(ev.deltaY < 0 ? FONT_STEP : -FONT_STEP);
                    return;
                }
                if (!this.isPaged()) return;
                if (window.getSelection()?.toString().trim()) return;
                if (Math.abs(ev.deltaY) < 24) return;
                ev.preventDefault();
                if (ev.deltaY > 0) this.goNextPage();
                else this.goPrevPage();
            },
            { passive: false },
        );

        // 选中动作条（初始隐藏；摘录入口由「❝ 摘抄」按钮接管，不再选中即弹）
        this.selbar = this.buildSelbar();
        body.appendChild(this.selbar);
    }

    // ── 选中动作条（T5） ──

    /** 构建选中动作条：纯图标按钮（书签 / 摘抄 / 高亮 / 翻译 / 搜索）——图标与顶栏快捷入口一致（用户 2026-09-15 裁定） */
    private buildSelbar(): HTMLDivElement {
        const bar = document.createElement('div');
        bar.classList.add('rl-selbar', 'hidden');

        // 纯图标按钮：读屏名走隐藏文本 .rl-sr（UI-GUIDE §3：不挂 aria-label），悬停说明走 data-tip
        const mkBtn = (icon: string, label: string): HTMLButtonElement => {
            const b = document.createElement('button');
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', label);
            b.createSpan({ cls: 'rl-sr', text: label });
            return b;
        };
        // 顺序（用户 2026-09-18）：书签 · 高亮 · 摘抄 · 翻译 · 网络搜索 · AI搜索
        // 书签：以当前选区新建书签（选中文本即引用），落库走 onBookmarksChange 同一通道
        const bmBtn = mkBtn('bookmark', '书签');
        bmBtn.addEventListener('click', () => this.addSelBookmark());
        // 高亮：一键即黄即记（写笔记「## 高亮」区 + 页内持久 mark）
        // 高亮：toggle——选区已是本章高亮则取消该条，否则新增即黄（用户 2026-09-16：再次选中应能删除）
        const hlBtn = mkBtn('highlighter', '高亮');
        this.selbarHlBtn = hlBtn;
        hlBtn.addEventListener('click', () => void this.toggleSelHighlight());
        // 摘抄：进入既有摘录确认/写回流程（quote, 无页, 当前定位）
        const exBtn = mkBtn('quote', '摘抄');
        exBtn.addEventListener('click', () => this.addSelExcerpt());
        // 翻译：AI 划词翻译；点击消费当前选区 → 就地译文浮层
        const trBtn = mkBtn('languages', '翻译');
        trBtn.addEventListener('click', () => this.addSelTranslate());
        // 网络搜索：就地弹引擎浮层（5 类 24 个引擎 → 系统浏览器；用户 2026-09-18）
        const netBtn = mkBtn('globe', '网络搜索');
        netBtn.addEventListener('click', () => this.openNetFromSelection());
        // AI 搜索：就地弹 AI 卡（卡内自动解读选段，也可切「自定义提问」；用户 2026-09-18）
        const aiBtn = mkBtn('sparkles', 'AI搜索');
        aiBtn.addEventListener('click', () => this.openAiFromSelection());

        // 垃圾桶（用户 2026-09-18）：**仅当「选中的文字本身就是一条已有高亮」时出现**，点了走与色板垃圾桶
        // 同一条直删通道（不弹确认）。放在动作条**最右**：危险操作远离主按钮，且常显按钮不随它出现而跳位。
        const trashBtn = mkBtn('trash-2', '删除该高亮');
        trashBtn.addClass('rl-selbar-trash');
        trashBtn.addClass('hidden');
        trashBtn.addEventListener('click', () => void this.trashSelection());
        this.selbarTrashBtn = trashBtn;

        bar.append(bmBtn, hlBtn, exBtn, trBtn, netBtn, aiBtn, trashBtn);
        // 动作条自身 mousedown 不冒泡到 document：先点按钮、后由动作完成收起，避免 document 提前收起
        bar.addEventListener('mousedown', (ev) => ev.stopPropagation());
        return bar;
    }

    /** 正文 mouseup：有非空选区 → 记录文本+定位并在鼠标处弹动作条；空选/点击 → 收起。
     *  标注模式锁激活时：有选区则直接分派对应标注动作（不弹动作条）；无选区且书签模式 → 存位置书签。 */
    private onTextMouseUp(ev: MouseEvent): void {
        const text = window.getSelection()?.toString().trim();
        const mode = this.annotateMode;
        if (mode && text) {
            const loc = this.currentLoc();
            this.dispatchAnnotate(text, loc, ev);
            return;
        }
        // 书签模式 + 空选区（单击正文）→ 存位置书签
        if (mode === 'bookmark' && !text) {
            this.addClickBookmark();
            return;
        }
        if (!text) {
            this.hideSelbar();
            return;
        }
        const loc = this.currentLoc();
        // 选区此刻还在 → 顺手记下它落在哪条高亮 mark 上（垃圾桶显隐 + 删除定位都用它；点按钮时选区已被清）
        this.selRecord = { text, chapter: loc.chapter, pct: loc.pct, mark: this.selMarkTarget() };
        this.syncSelbarHlTip(text);
        this.showSelbarAt(ev);
    }

    /** 标注模式锁分派：按激活模式执行对应标注（高亮/摘抄/翻译），完成后清浏览器选区防残留 */
    private dispatchAnnotate(text: string, loc: { chapter: number; pct: number }, ev?: MouseEvent): void {
        const mode = this.annotateMode;
        this.hideSelbar();
        if (mode === 'highlighter') {
            // 传鼠标位置作色板锚点：该模式下动作条不在场（也不该出现）
            void this.highlightFromMode(text, loc, ev ? { x: ev.clientX, y: ev.clientY } : null);
            window.getSelection()?.removeAllRanges();
        } else if (mode === 'quote') {
            // 就地摘抄卡片：顶栏「摘抄」模式动作条不在场 → 以鼠标位置为锚点
            this.showExcerptCard(text, { chapter: loc.chapter, pct: loc.pct }, ev ? { x: ev.clientX, y: ev.clientY } : null);
            window.getSelection()?.removeAllRanges();
        } else if (mode === 'netsearch') {
            // 网络搜索：弹引擎浮层。🔴 **不清浏览器选区** —— 用户要求「选中保持高亮」
            this.showNetPanel(text, ev ? { x: ev.clientX, y: ev.clientY } : null);
        } else if (mode === 'aisearch') {
            // AI 搜索：弹 AI 卡。同样**不清选区**（选中保持高亮）
            this.showSearchCard(text, ev ? { x: ev.clientX, y: ev.clientY } : null);
        } else if (mode === 'languages') {
            // 就地译文浮层：用选区位置近似定位
            const parent = this.selbarParent;
            let x = 60;
            let y = 80;
            if (ev && parent) {
                const pRect = parent.getBoundingClientRect();
                x = Math.max(4, ev.clientX - pRect.left);
                y = Math.max(4, ev.clientY - pRect.top);
            }
            this.showTranslateCard(x, y, text);
        }
    }

    /** 在鼠标上方（放不下则下方）显示动作条，坐标换算到 selbarParent 局部空间，水平/垂直钳制不出正文区 */
    private showSelbarAt(ev: MouseEvent): void {
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!bar || !parent) return;
        bar.classList.remove('hidden');
        const pRect = parent.getBoundingClientRect();
        const bRect = bar.getBoundingClientRect();
        const gap = 8;
        const left = Math.min(Math.max(ev.clientX - pRect.left, 4), pRect.width - bRect.width - 4);
        let top = ev.clientY - pRect.top - bRect.height - gap;
        if (top < 4) top = ev.clientY - pRect.top + gap; // 选区上方放不下 → 转下方
        bar.style.left = `${Math.round(left)}px`;
        bar.style.top = `${Math.round(Math.min(top, pRect.height - bRect.height - 4))}px`;
    }

    /** 动作条「★ 书签」：用当前选区新建书签 → 内存列表更新 + 通知宿主落盘 + 重绘书签 pane；动作完成后清浏览器选区防残留高亮 */
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
        // 书签动作已消费选区：清掉浏览器选区高亮（残影），再收起动作条
        window.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    /** 保存卡片内容（Enter / 点「保存摘抄」）：成功收起卡片 + 清选区残影；失败保留输入并解禁按钮重试 */
    protected async submitExcerptCard(): Promise<void> {
        const quote = this.excerptCardQuote;
        const loc = this.excerptCardLoc;
        const save = this.options.onExcerptSave;
        if (!quote || !loc || !save) return;
        const btn = this.excerptSaveBtn;
        if (btn?.hasAttribute('disabled')) return; // 防 Enter 连击重复写入
        btn?.setAttribute('disabled', '');
        const note = this.excerptNoteEl?.value.trim() || undefined;
        let ok = false;
        try {
            ok = await save(quote, note, loc);
        } catch {
            ok = false; // 宿主已弹 Notice，这里只负责状态
        }
        if (ok) {
            this.hideExcerptCard();
            window.getSelection()?.removeAllRanges();
        } else {
            btn?.removeAttribute('disabled');
        }
    }

    // ── 划词翻译（批3：AI，就地译文浮层） ──

    /** 动作条「译翻译」：消费当前选区 → 就地译文浮层（保留选区高亮便于对照译文）；无选区/无回调则仅收起 */
    private addSelTranslate(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        // 用动作条当前位置作浮层锚点（动作条收起前读取其 left/top，近似选区附近）
        const bar = this.selbar;
        let x: number;
        let y: number;
        if (bar && !bar.classList.contains('hidden')) {
            x = parseFloat(bar.style.left || '0');
            y = parseFloat(bar.style.top || '0');
        } else {
            x = 60;
            y = 80;
        }
        this.hideSelbar();
        this.showTranslateCard(x, y, rec.text);
    }

    /** 显示译文浮层于 (x,y) 上方并异步翻译；无 onTranslate → 立即提示不支持 */
    private showTranslateCard(x: number, y: number, text: string): void {
        const card = this.translateCard;
        const bodyEl = this.translateCardBody;
        if (!card || !bodyEl) return;
        if (!this.options.onTranslate) {
            new Notice('当前阅读器不支持翻译');
            return;
        }
        // 先置 loading（hidden 移除后布局一次以测卡片尺寸，再钳位定位）
        bodyEl.empty();
        bodyEl.removeClass('rl-translate-error');
        bodyEl.addClass('rl-translate-loading');
        bodyEl.setText('翻译中…');
        card.classList.remove('hidden');
        // 异步翻译：loading 后填译文/错误
        void this.options.onTranslate(text)
            .then((translated) => {
                bodyEl.removeClass('rl-translate-loading');
                if (card.classList.contains('hidden')) return; // 已关闭，丢弃
                bodyEl.empty();
                if (translated) {
                    bodyEl.setText(translated);
                } else {
                    // main 层已弹 Notice（端点/网络错误），卡片提示非译文
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
        // 定位：card 在 selbarParent 内 absolute，(x,y) 上方，放不下转下方；水平钳制
        requestAnimationFrame(() => {
            const parent = this.selbarParent;
            if (!parent) return;
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const gap = 8;
            const left = Math.min(Math.max(x, 4), Math.max(4, pRect.width - cRect.width - 4));
            let top = y - cRect.height - gap;
            if (top < 4) top = y + gap;
            card.style.left = `${Math.round(left)}px`;
            card.style.top = `${Math.round(Math.min(top, pRect.height - cRect.height - 4))}px`;
        });
    }

    // ── 搜索卡片（用户 2026-09-17 裁定：划词后点「搜索」就地弹卡；方案 A）──
    // 网络搜索 = 引擎 chip → 系统浏览器打开结果页（不抓取列表：免 Key 的通用搜索 API 已不存在）；
    // AI 搜索 = 卡内出答案（复用翻译通道的服务商与 Key，提示词在设置页可改写）。

    /** 当前可用的搜索词：优先已记录的选区，其次浏览器实时选区，都没有则空（让用户自己输入） */
    protected searchSeed(): string {
        return this.selRecord?.text.trim() || (window.getSelection()?.toString().trim() ?? '');
    }

    /** 构建搜索卡片（挂 selbarParent；标题「AI 搜索」+ 查询框 + 答案区 + 复制；网络搜索不在此卡） */
    protected buildSearchCard(): HTMLDivElement | null {
        if (!this.selbarParent) return null;
        if (this.searchCard) return this.searchCard;
        const card = this.selbarParent.createDiv({ cls: 'rl-search-card hidden' });
        const head = card.createDiv({ cls: 'rl-search-card-head' });
        head.createSpan({ cls: 'rl-search-card-title', text: 'AI 搜索' });
        const close = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-card-close', attr: { 'data-tip': '关闭' }, text: '✕' });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideSearchCard());

        // 两态切换（用户 2026-09-18）：「解读选段」走设置页「搜索提示词」；「自定义提问」走内置固定提示词
        const modes = card.createDiv({ cls: 'rl-search-card-modes' });
        const mkMode = (id: 'read' | 'ask', label: string, tip: string): void => {
            const b = modes.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-card-mode', attr: { type: 'button', 'data-tip': tip }, text: label });
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => this.setSearchMode(id));
            this.searchModeBtns[id] = b;
        };
        mkMode('read', '解读选段', '按设置页「搜索提示词」解读选中的文字');
        mkMode('ask', '自定义提问', '用自己的问题提问（不读设置页提示词）');

        // 「解读选段」态输入区：初值＝选中文字，可编辑；回车重跑 AI 搜索（输入法组合态不触发）
        const qSec = card.createDiv({ cls: 'rl-search-card-sec rl-search-read-sec' });
        const input = qSec.createEl('input', {
            cls: 'rl-search-card-query',
            attr: { type: 'text', spellcheck: 'false', placeholder: '输入要搜索的内容' },
        });
        input.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
            ev.preventDefault();
            void this.runAiSearch();
        });
        this.searchQueryEl = input;
        this.searchReadSecEl = qSec;

        // 「自定义提问」态输入区：选段预览（只读）+ 问题输入框；回车走 runAiAsk（**不读设置页提示词**）
        const askSec = card.createDiv({ cls: 'rl-search-card-sec rl-search-ask-sec hidden' });
        this.searchQuoteEl = askSec.createDiv({ cls: 'rl-search-card-quote' });
        const askInput = askSec.createEl('input', {
            cls: 'rl-search-card-query',
            attr: { type: 'text', spellcheck: 'false', placeholder: '针对这段内容提问…' },
        });
        askInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
            ev.preventDefault();
            void this.runAiAsk();
        });
        this.searchAskSecEl = askSec;
        this.searchQuestionEl = askInput;

        // 答案区（loading / 答案 / 错误 三态）。⚠️ 卡片是 **AI 搜索专用** ——
        // 网络搜索已改由「二选一 → 引擎图标浮层」承载（用户 2026-09-17：AI 卡里不该还有网络搜索内容）。
        const aiSec = card.createDiv({ cls: 'rl-search-card-sec' });
        this.searchBodyEl = aiSec.createDiv({ cls: 'rl-search-card-body' });

        const foot = card.createDiv({ cls: 'rl-search-card-foot' });
        const copy = foot.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-search-card-copy',
            attr: { type: 'button', 'data-tip': '复制' },
            text: '复制',
        });
        copy.addEventListener('mousedown', (ev) => ev.stopPropagation());
        copy.addEventListener('click', () => void this.copySearchAnswer());
        this.searchCopyBtn = copy;

        // 卡片自身 mousedown 不冒泡到 document：否则 onDocMouseDown 会把卡片立刻收掉
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.searchCard = card;
        return card;
    }

    // ── 渲染 ──

    private renderContent(): void {
        // 正文重建（切章 / 切模式 / 改字号）→ 摘抄卡片的位置与引用都失效，先收起
        this.hideExcerptCard();
        this.hideSearchCard();
        this.hideNetPanel();
        const ch = this.book.chapters[this.chapterIndex];
        const titleEl = this.scrollEl.querySelector('.rl-reader-chapter-title') as HTMLDivElement | null;
        // ⚠️ 可选链不是洁癖：该元素理论上常驻，但一旦缺失，这里抛错会**中断调用方**（setMode / 字号调整 /
        // 切章）的后续步骤 —— 表现为「模式切了但勾选没跟上」这类鬼现象，防御成本为零。
        titleEl?.setText(ch.title);
        // 顶栏居中标题 = 当前章「第几章：章名」（用户 2026-09-16 裁定；无章节信息回退书名）
        // #345：改走 setHeadTitle，同步 data-tip（省略号截断后可悬停看全称）
        this.setHeadTitle(this.chapterHeading());
        // 底部工具条左：当前章标题
        this.footerFchEl?.setText(ch.title);

        // 段落渲染：章节标题行本身是段落首段（parseTxtBook 保留），跳过避免与标题重复
        const paras = chapterParagraphs(this.book, this.chapterIndex);
        const start = paras[0] === ch.title ? 1 : 0;
        // DocumentFragment 批量构建一次 append（避免逐段插入触发多次重排）
        const frag = document.createDocumentFragment();
        for (let i = start; i < paras.length; i++) {
            const p = document.createElement('p');
            p.textContent = paras[i];
            frag.appendChild(p);
        }
        this.textEl.empty();
        this.textEl.appendChild(frag);
        // 页内持久黄标：把本章高亮 quote 命中片段包 <mark>（textEl 已重建为纯文本段，直接走文本偏移包裹）
        this.applyHighlights();

        // 目录高亮当前章
        const items = this.tocListEl.querySelectorAll('.rl-reader-toc-item');
        items.forEach((el, i) => el.toggleClass('active', i === this.chapterIndex));
        // 当前章滚到目录可见位置
        const cur = items[this.chapterIndex];
        if (cur) cur.scrollIntoView({ block: 'nearest' });

        // 定位：连续模式置顶 / 翻页模式重置列式并到首页（setupPagedLayout 测总列需内容在 DOM）
        if (this.isPaged()) {
            this.setupPagedLayout();
            this.pageIndex = 0;
            this.scrollEl.scrollLeft = 0;
        } else {
            this.scrollEl.scrollTop = 0;
        }
        // 摘抄/书签/上一章末页跳转：布局稳定后恢复目标比例（一次性），随后高亮目标段落
        if (this.jumpRatio !== null) {
            const ratio = this.jumpRatio;
            this.jumpRatio = null;
            this.restoring = true;
            requestAnimationFrame(() => {
                this.applyRatio(ratio);
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
        } else if (this.isPaged()) {
            this.updateProgress();
        }
        this.updateProgress();
    }

    /**
     * 顶栏标题文本（当前章）。
     * 章标题原文形如「第三章 风起」→「第三章：风起」（pure/chapterTitle）；
     * 整书单章（parseTxtBook 占位「全文」）或空标题 → 回退书名，避免顶栏只剩「全文」两个字。
     */
    private chapterHeading(): string {
        const raw = this.book.chapters[this.chapterIndex]?.title ?? '';
        if (!raw || raw === '全文') return this.options.title;
        return formatChapterTitle(raw) || this.options.title;
    }

    /** 各章段落数（estimatePercent 加权；懒计算缓存） */
    protected chapterSizes(): number[] {
        if (this.chapterSizesCache === null) {
            this.chapterSizesCache = this.book.chapters.map((_, i) => chapterParagraphs(this.book, i).length);
        }
        return this.chapterSizesCache;
    }

    /** 当前整体百分比（翻章/关闭时写回 catalog 用） */
    private currentPercent(): number {
        return estimatePercent(this.chapterSizes(), this.chapterIndex, this.currentRatio());
    }

    /** 当前摘录定位（章序 1 基 + 滚动百分比；保存摘抄时写入「· 定位：N:N」） */
    protected currentLoc(): { chapter: number; pct: number } {
        return { chapter: this.chapterIndex + 1, pct: Math.round(this.currentRatio() * 100) };
    }

    /**
     * 进入区域截图框选态（2026-10-23 用户指令）。
     *
     * 🔴 三个要点：
     *   ① 框选区 = `this.scrollEl`（正文滚动区），⛔ 别用 `container` —— 顶栏/侧栏不参与截图。
     *   ② 矩形是**视口坐标**（`ShotOverlay` 用 fixed 遮罩），直接交给宿主 `capturePage`。
     *   ③ 定位与摘抄同一口径（`currentLoc()`），截图块落进笔记「## 阅读截图」区。
     */
    private startShot(): void {
        const save = this.options.onShotSave;
        if (!save) return;
        if (this.shotOverlay) return;
        this.hideSelbar();
        this.hideMenu();
        this.hideMore();
        const overlay = new ShotOverlay(
            this.scrollEl,
            (rect) => {
                this.shotOverlay = null;
                save(rect, this.currentLoc());
            },
            () => {
                this.shotOverlay = null;
            },
        );
        this.shotOverlay = overlay;
        overlay.start('拖拽框选要截图的区域 · Esc 取消');
    }

    /** 切换到指定章（越界忽略），滚动重置到顶部 */
    protected switchChapter(i: number): void {
        if (i < 0 || i >= this.book.chapters.length || i === this.chapterIndex) return;
        this.ttsSvc?.stop(); // 🔴 切章必须停朗读 —— 否则会照着旧章的句子继续读、并往已销毁的节点写高亮
        this.ttsSvc?.resetAnchor(); // 🔴 点击锚点是**章内**偏移 ⇒ 换章必须作废，否则新章会从错位置读起
        this.resetAnnotate(); // 切章复位标注模式，防残留
        this.chapterIndex = i;
        // #469：换了章 ⇒ 「已知位置」归零（新章从章头开始），否则上一次的章内比例会被当成本章的位置
        this.markRatio(0);
        this.renderContent();
    }

    /** 摘抄列表（摘抄 pane 内容）：点击跳原书定位并高亮；无定位提示 */
    protected buildExcerptToc(): void {
        const exs = this.options.excerpts ?? [];
        const list = this.exListEl;
        if (!list) return;
        list.empty();
        this.exCountEl?.setText(annoCountText('摘抄', exs.length, this.exSel));
        this.syncAnnoBtns(this.exHeadRef, this.exSel, exs.length);
        if (exs.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无摘抄' });
            return;
        }
        exs.forEach((ex) => {
            const item = list.createDiv({ cls: 'rl-reader-ex-item' });
            // #345 选择模式：行首勾选框（仅模式内显示，见 CSS）+ 点击改为勾选
            if (this.exSel.on) appendAnnoCheck(item, isAnnoSelItem(this.exSel, ex.id));
            item.createDiv({ cls: 'rl-reader-ex-quote', text: truncateQuote(ex.quote) });
            item.createDiv({
                cls: 'rl-reader-ex-loc' + (ex.loc ? '' : ' none'),
                text: ex.loc ? `第${ex.loc.chapter}章 · ${ex.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => {
                if (this.exSel.on) {
                    toggleAnnoSelItem(this.exSel, ex.id);
                    this.buildExcerptToc();
                    return;
                }
                this.jumpExcerpt(ex);
            });
            // 右键删除摘抄（左键定位/右键删除）；🔴 选择模式内禁用右键删除，避免与勾选语义打架
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                if (this.exSel.on) return;
                const bid = ex.id;
                if (!bid) return;
                const ok = (await this.options.onDeleteExcerpt?.(bid)) ?? false;
                if (ok) this.removeExcerptItem(bid);
            });
        });
    }

    /** 摘抄书签跳转：有定位 → 切章 + 恢复滚动比例 + 定位段落高亮；无定位 → 提示；同章点击绕过 switchChapter 短路直接恢复 */
    protected jumpExcerpt(ex: ParsedExcerpt): void {
        if (!ex.loc) {
            new Notice('该摘抄无定位信息');
            return;
        }
        const i = ex.loc.chapter - 1;
        if (i < 0 || i >= this.book.chapters.length) return;
        const ratio = ex.loc.pct / 100;
        this.jumpRatio = ratio;
        this.pendingHighlight = ex.quote;
        this.pendingHighlightHint = ratio;
        if (i === this.chapterIndex) {
            // 同章：switchChapter 对同章 return，直接恢复滚动比例 + 定位段落高亮；jumpRatio 已消费防残留误触发
            this.jumpRatio = null;
            this.restoring = true;
            requestAnimationFrame(() => {
                this.restoreScroll(ratio);
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    /** 切章恢复滚动后：用 quote 文本锚精确找回目标段落（pct 只在同一 quote 多处出现时用于消歧），
     *  滚动到首个命中段、闪烁命中的全部段落 2.5s；命中不到 → 保持 pct 落点不动（不打扰读者）。
     *  ⚠️ 只加/去段落类名，不改 innerHTML —— 与 applyHighlights 的 <mark> 重建互不干扰。 */
    private highlightPending(): void {
        const quote = this.pendingHighlight;
        const hint = this.pendingHighlightHint;
        this.pendingHighlight = null;
        this.pendingHighlightHint = null;
        if (!quote) return;
        const paras = Array.from(this.textEl.querySelectorAll('p'));
        if (paras.length === 0) return;
        const hit = locateQuoteSpan(paras.map((p) => p.textContent ?? ''), quote, hint ?? undefined);
        if (!hit) return;
        for (const r of hit.ranges) {
            const el = paras[r.index];
            if (!el) continue;
            el.classList.add('rl-excerpt-hl');
            window.setTimeout(() => el.classList.remove('rl-excerpt-hl'), 2500);
        }
        paras[hit.ranges[0].index]?.scrollIntoView({ block: 'center' });
    }

    /** 给段落流包本章高亮 mark（幂等）：逐段算「该写入的 HTML」→ 只在真的有变化时写回（无谓重排/丢选区的风险都归零）。
     *  🔴 重绘规则（含**「删掉的高亮必须当场摊平」**）在 `pure/highlight.markParagraphHtml` —— TXT 与 EPUB 共用同一份，
     *     不要再在本文件里内联第二套（旧实现「无命中 → 直接跳过该段」会让删掉的高亮继续留在屏幕上）。 */
    private applyHighlights(): void {
        const hls = this.currentChapterHighlights();
        for (const p of Array.from(this.textEl.querySelectorAll('p'))) {
            const plain = p.textContent ?? '';
            if (!plain) continue;
            const html = markParagraphHtml(plain, hls, p.querySelector('mark.rl-hl-persist') !== null);
            if (html !== null && html !== p.innerHTML) p.innerHTML = html;
        }
    }

    /** 动作条「高亮」：toggle（再次选中即取消）；新增成功后浮出样式选择器，可立刻改成任意样式/颜色 */
    private async toggleSelHighlight(): Promise<void> {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        const text0 = rec.text.trim();
        const existing = findSameHighlight(this.highlightList, text0, rec.chapter);
        const before = this.highlightList.length;
        if (existing) {
            // 已是高亮 → 不直接删（删除改由浮层垃圾桶负责）：打开浮层可改样式/颜色或删除
            this.hlPickerTargetId = existing.id ?? null;
            this.hlTrashReady = true;
        window.getSelection()?.removeAllRanges();
            // ⚠️ 不 hideSelbar：动作条要留到「二次选择样式」完成后才收（用户 2026-09-16 要求）
            this.showHlPicker();
            return;
        }
        await this.toggleHighlight(text0, { chapter: rec.chapter, pct: rec.pct });
        const added = this.highlightList.length > before ? this.highlightList[this.highlightList.length - 1] : null;
        // 动作已消费选区：只清浏览器选区残影，**不收起动作条**（见下）
        window.getSelection()?.removeAllRanges();
        // 新增成功才浮出选择器 ——用户 2026-09-16 选定「先上默认色，再弹选择器改」
        if (added?.id) {
            this.hlTrashReady = true;
            this.hlPickerTargetId = added.id;
            // ⚠️ 不 hideSelbar：动作条与色板一起留着，**选完样式/颜色也不收**，唯一收起路径 =
            //    点正文其他区域（onDocMouseDown → hideSelbar 内含 hideHlPicker）
            //    （用户 2026-09-17 报障：旧实现先 hideSelbar 再 showHlPicker → 动作条被提前收掉）
            this.showHlPicker();
        } else {
            this.hideSelbar();
        }
    }

    /** 选段落在哪条高亮 mark 上（TXT：正文在宿主文档）→ 垃圾桶显隐 + 删除定位；null = 选中的文字**没有高亮样式** */
    private selMarkTarget(): HlMarkTarget | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        return hlMarkTargetOf(range.startContainer, range.endContainer);
    }

    /** 一键即黄即记核心：写阅读数据存档（高亮真源；#528 起不再写笔记）→ 本地列表追加 → 重包当前章 mark。
     *  返回新块 id（失败 null，已自行 Notice）；`quiet` ＝ 不播报「已高亮」（改样式路径用，由调用方统一报一条）。 */
    protected async doHighlight(text: string, chapter: number, pct: number, style: HlStyle = this.hlStyle, color: HlColor = this.hlColor, quiet = false): Promise<string | null> {
        if (!text || !this.options.onHighlight) {
            new Notice('当前阅读器不支持高亮');
            return null;
        }
        const id = await this.options.onHighlight(text, { chapter, pct }, style, color);
        if (!id) return null; // 失败已 Notice
        this.highlightList = [...this.highlightList, { quote: text, id, loc: { chapter, pct }, style, color }];
        this.applyHighlights();
        this.refreshHighlightToc();
        if (!quiet) new Notice('已高亮');
        return id;
    }

    /** 删除高亮（标注右键）：main 确认删笔记块 → 成功则本地列表移除 + 重包当前章（移除 mark） */
    async removeHighlight(id: string): Promise<void> {
        if (!this.options.onDeleteHighlight) return;
        const ok = await this.options.onDeleteHighlight(id);
        if (!ok) return;
        this.highlightList = this.highlightList.filter((h) => h.id !== id);
        this.applyHighlights();
        this.refreshHighlightToc();
    }

    /** 标注模式「高亮」：toggle——选中文字已是本章高亮 → 取消该条；否则新增即黄 */
    protected async toggleHighlight(text: string, loc: { chapter: number; pct: number }): Promise<void> {
        const dec = decideHighlightToggle(this.highlightList, text, loc);
        if (dec.action === 'remove') {
            await this.removeHighlight(dec.id);
            new Notice('已取消高亮');
        } else if (dec.action === 'blocked') {
            // 命中同文本但没有 id（手改/脏 JSON）→ 删不了也不能重复新增，提示处理
            new Notice('该高亮缺少标识，无法从正文取消（可重开阅读器后再试）');
        } else {
            await this.doHighlight(text, loc.chapter, loc.pct);
        }
    }

    /** 标注模式「书签」：单击正文(无选区)在当前位置存一个位置书签（按章去重：同章已存则不重复建） */
    private addClickBookmark(): void {
        const loc = this.currentLoc();
        const sameChapter = this.bookmarks().some((b) => b.chapter === loc.chapter);
        if (sameChapter) {
            new Notice('本章已有书签（去重，未重复添加）');
            return;
        }
        // 🔴 #347（用户：「书签能不能从当前段落开始记录，不然不对齐不好看」）：
        //    书签改为记录**当前段落** —— 引用 = 该段文本（列表里就有内容可显示，与高亮/摘抄两行同构），
        //    百分比 = 段落**起点**的章节内位置（跳回去落在段首，而不是随手一个滚动偏移）。
        //    找不到段落（空章 / 未布局）→ 回退旧口径：只存位置（quote 缺省 = 纯位置书签）。
        const para = currentParagraph(this.textEl, this.scrollEl);
        const pct = para ? paraPct(para.top, this.scrollEl?.scrollHeight ?? 0) : loc.pct;
        const updated = [...this.bookmarks(), newBookmark(loc.chapter, pct, para?.text)];
        this.options.bookmarks = updated;
        this.options.onBookmarksChange?.(updated);
        this.refreshBookmarks(updated);
        new Notice(`已添加书签：第${loc.chapter}章 ${pct}%`);
    }

    /**
     * 删除**选中的**高亮（#345）：confirm 一次 → 批量删除 → 本地列表移除 + 重包当前章。
     * 返回「是否真的删了」—— 用户取消确认必须返回 false，否则外层会把选择模式一并关掉。
     * ⚠️ 走 `onPurgeAnnotations` 批量通道（确认已在此处一次性完成）：逐条调 `onDeleteHighlight`
     * 会每条都弹确认，删 8 条要连点 8 次。
     */
    private async deleteSelectedHighlights(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条高亮吗？（将从阅读数据中移除，不可恢复）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        await this.options.onPurgeAnnotations?.('highlight', ids);
        this.highlightList = this.highlightList.filter((h) => !h.id || !sel.has(h.id));
        this.applyHighlights();
        this.refreshHighlightToc();
        new Notice(`已删除 ${ids.length} 条高亮`);
        return true;
    }

    /** 重建标注 pane「高亮」列表（点击跳原书定位 + 右键删除）；空 → 占位 */
    private refreshHighlightToc(): void {
        const list = this.hlListEl;
        if (!list) return;
        list.empty();
        this.hlCountEl?.setText(annoCountText('高亮', this.highlightList.length, this.hlSel));
        this.syncAnnoBtns(this.hlHeadRef, this.hlSel, this.highlightList.length);
        if (this.highlightList.length === 0) {
            list.createDiv({ cls: 'rl-reader-hl-empty', text: '暂无高亮' });
            return;
        }
        // 按章+比例排序，便于浏览
        const sorted = [...this.highlightList].sort(
            (a, b) => (a.loc?.chapter ?? 0) - (b.loc?.chapter ?? 0) || (a.loc?.pct ?? 0) - (b.loc?.pct ?? 0),
        );
        for (const hl of sorted) {
            const item = list.createDiv({ cls: 'rl-reader-hl-item' });
            // #345 选择模式：行首勾选框（仅模式内显示）+ 点击改为勾选
            if (this.hlSel.on) appendAnnoCheck(item, isAnnoSelItem(this.hlSel, hl.id));
            item.createDiv({ cls: 'rl-reader-hl-quote', text: truncateQuote(hl.quote) });
            item.createDiv({
                cls: 'rl-reader-hl-loc' + (hl.loc ? '' : ' none'),
                text: hl.loc ? `第${hl.loc.chapter}章 · ${hl.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => {
                if (this.hlSel.on) {
                    toggleAnnoSelItem(this.hlSel, hl.id);
                    this.refreshHighlightToc();
                    return;
                }
                this.jumpHighlight(hl);
            });
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                if (this.hlSel.on) return; // 选择模式内禁用右键单删
                if (!hl.id) return;
                await this.removeHighlight(hl.id);
            });
        }
    }

    /** 高亮定位：切到对应章并滚到该 quote 段落（复用跳转高亮机制） */
    protected jumpHighlight(hl: ReaderHighlight): void {
        if (!hl.loc) {
            new Notice('该高亮无定位信息');
            return;
        }
        const i = hl.loc.chapter - 1;
        if (i < 0 || i >= this.book.chapters.length) return;
        this.jumpRatio = hl.loc.pct / 100;
        this.pendingHighlight = hl.quote;
        this.pendingHighlightHint = hl.loc.pct / 100;
        if (i === this.chapterIndex) {
            this.jumpRatio = null;
            this.restoring = true;
            requestAnimationFrame(() => {
                this.restoreScroll(hl.loc!.pct / 100);
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    /** 书签列表（书签 pane 内容）：点击跳原书定位并高亮；空 → 「暂无书签」 */
    protected buildBookmarkToc(): void {
        const list = this.bmListEl;
        if (!list) return;
        list.empty();
        const bms = this.bookmarks();
        this.bmCountEl?.setText(annoCountText('书签', bms.length, this.bmSel));
        this.syncAnnoBtns(this.bmHeadRef, this.bmSel, bms.length);
        if (bms.length === 0) {
            list.createDiv({ cls: 'rl-reader-bm-empty', text: '暂无书签' });
            return;
        }
        bms.forEach((bm) => {
            // 🔴 #346 用户报「书签标题不对齐」：纯位置书签没有引用文本，空的引用块（flex:1）会把章节标签顶到最右边，
            //    看着像「一行空白 + 文字飘在右侧」。挂 `no-quote` ⇒ CSS 收掉空引用块、标签左对齐到文本线（标签就是这一行的标题）。
            const item = list.createDiv({ cls: 'rl-reader-bm-item' + (bm.quote ? '' : ' no-quote') });
            // #345 选择模式：行首勾选框（仅模式内显示）+ 点击改为勾选
            if (this.bmSel.on) appendAnnoCheck(item, isAnnoSelItem(this.bmSel, bm.id));
            // 纯位置书签（无引用文本）→ 留空：类型已由前缀绿条表达，不再用「书签」二字占位（用户 2026-09-17）
            item.createDiv({ cls: 'rl-reader-bm-quote', text: bm.quote ? truncateQuote(bm.quote) : '' });
            // 定位行只留「第 N 章 · X%」（用户 2026-09-20：「书签不要显示标题」—— 与高亮/摘抄两行**同一格式**，
            // 三区对齐；章节名已在顶栏/正文里看得到，书签行不必重复）
            item.createDiv({ cls: 'rl-reader-bm-loc', text: `第${bm.chapter}章 · ${bm.pct}%` });
            item.addEventListener('click', () => {
                if (this.bmSel.on) {
                    toggleAnnoSelItem(this.bmSel, bm.id);
                    this.buildBookmarkToc();
                    return;
                }
                this.jumpBookmark(bm);
            });
            // 右键删除书签：🔴 必须二次确认（见 removeBookmarkItem）—— 用户 2026-09-20 报「右键直接删掉了」
            // 🔴 选择模式内禁用：右键与勾选两套选择语义会打架
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                if (this.bmSel.on) return;
                const id = bm.id;
                if (!id) return; // 旧数据/手写书签可能缺 id，无法唯一定位，静默跳过（对齐摘抄右删守卫）
                void this.removeBookmarkItem(id);
            });
        });
    }

    /** 书签跳转：切章 + 恢复滚动比例 + 定位段落高亮；quote 为空（纯位置书签）→ 仅定位不高亮（highlightPending 内部守卫空串） */
    protected jumpBookmark(bm: ReaderBookmark): void {
        const i = bm.chapter - 1;
        if (i < 0 || i >= this.book.chapters.length) return;
        const ratio = bm.pct / 100;
        this.jumpRatio = ratio;
        this.pendingHighlight = bm.quote ?? null;
        this.pendingHighlightHint = ratio;
        if (i === this.chapterIndex) {
            // 同章：switchChapter 对同章 return，直接恢复滚动比例 + 定位段落高亮；jumpRatio 已消费防残留误触发
            this.jumpRatio = null;
            this.restoring = true;
            requestAnimationFrame(() => {
                this.restoreScroll(ratio);
                this.restoring = false;
                this.updateProgress();
                this.highlightPending();
            });
            return;
        }
        this.switchChapter(i);
    }

    // ── 滚动与进度 ──

    /** 滚动事件：rAF 节流（同一帧多次滚动合并处理一次，滚动中不反复读 scrollHeight） */
    private onScroll(): void {
        if (this.restoring || this.scrollRaf !== null) return;
        this.scrollRaf = requestAnimationFrame(() => {
            this.scrollRaf = null;
            this.handleScrollFrame();
        });
    }

    /** 滚动帧处理：算比例 → 触底自动翻章（延后宏任务）/ 节流保存。仅连续模式（翻页无纵向滚动事件） */
    private handleScrollFrame(): void {
        const el = this.scrollEl;
        if (this.restoring) return;
        // 翻页模式：原生横向滚动 scrollLeft → 归位到最近页 + 进度
        if (this.isPaged()) {
            // 不齐整的 scrollLeft（拖滚动条/触控板横向半途）→ 取最近整页
            const p = Math.round(el.scrollLeft / Math.max(1, this.pageW));
            const cp = Math.max(0, Math.min(this.totalPages - 1, p));
            if (cp !== this.pageIndex) this.pageIndex = cp;
            this.updateProgress();
            this.scheduleSave(pageToRatio(cp, this.totalPages));
            return;
        }
        // 🔴 #469：元素没有布局盒（标签页被隐藏 / leaf 被 detach）时 sh 与 ch **同为 0** ——
        // 那不是「内容不足一屏」，⛔ 既不能当成「触底」去自动翻章，也不能把 0 当进度存下去
        // （本批根因：`pure/readingProgress.readerRatio` 的两档口径，那条注释里有完整链路）
        if (el.clientHeight <= 0) return;
        const max = el.scrollHeight - el.clientHeight;
        const ratio = max > 0 ? el.scrollTop / max : 0;
        // 触底或内容不足一屏（max<=0 短章节）→ 自动翻章：先保存当前章进度，再延后切章（不在滚动帧内重建 DOM）
        if ((max <= 0 || el.scrollTop >= max - 1) && this.chapterIndex < this.book.chapters.length - 1) {
            this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 1 });
            this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
            this.scheduleChapterSwitch(this.chapterIndex + 1);
            return;
        }
        this.updateProgress();
        this.scheduleSave(ratio);
    }

    /** 立即保存当前进度（关闭面板/自动翻章前调用，防最后一次滚动丢失）；翻章/关闭时同步落库整体百分比 */
    private flushSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const el = this.scrollEl;
        if (!el) return;
        const ratio = this.currentRatio();
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: ratio });
        this.options.onProgressPersist?.(this.currentPercent());
    }

    /** 恢复滚动：内容高度 × 比例（0-1 钳制，mode 感知） */
    private restoreScroll(ratio: number): void {
        this.markRatio(ratio);
        if (this.isPaged()) {
            this.goToPage(ratioToPage(ratio, this.totalPages), false);
            return;
        }
        const el = this.scrollEl;
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(max, Math.max(0, ratio * max));
    }

    /**
     * 当前章内前进比例（0-1）：连续=scrollTop/可滚长；翻页=页index/(总列−1)。口径与持久化进度一致。
     *
     * 🔴 #469：取值下沉到 `pure/readingProgress.readerRatio` —— **不可测量 ≠ 章头**。
     * 元素没有布局盒时（标签页被切走 / leaf 被 detach）sh 与 ch 双双为 0，旧实现 `return 0`
     * 会把「读到章中间」静默抹成「章头」并落库（关闭阅读器的 `flushSave` 正是取这里）。
     * ⚠️ 本方法**带缓存副作用**（测量成功即刷新 `lastRatio`）—— 它是全类唯一的刷新点，
     * 不可测量时返回的就是 `lastRatio`，写回等值无副作用；⛔ 别改成纯读取（那样 `lastRatio` 永不推进）。
     */
    protected currentRatio(): number {
        if (this.isPaged()) return pageToRatio(this.pageIndex, this.totalPages);
        const el = this.scrollEl;
        const r = readerRatio(
            el ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight } : null,
            this.lastRatio,
        );
        this.markRatio(r);
        return r;
    }

    /** 应用指定比例位置（mode 感知）：连续滚到 scrollTop；翻页定位到对应页并平移 */
    private applyRatio(ratio: number): void {
        this.markRatio(ratio);
        if (this.isPaged()) {
            this.goToPage(ratioToPage(ratio, this.totalPages), false);
            return;
        }
        const el = this.scrollEl;
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(max, Math.max(0, ratio * max));
    }

    /**
     * 翻页模式（方案 v2）：把 scrollEl 自身设为 CSS 多列容器，让整章内容(title+段落)作为一列流
     * 按可视宽/高自然分 N 列并横向溢出；scrollEl 横向滚动(overflow-x:auto)承载，scrollLeft 逐屏翻页。
     * 列宽 = scrollEl 可视内容宽，列高受 max-height 限制恰为一屏。返回总列数。
     * 依据 Readium/epub.js/foliate-js 同款 multicol + 横向滚动做法。
     */
    private setupPagedLayout(): number {
        const el = this.scrollEl;
        const cs = getComputedStyle(el);
        // 可视内容盒（clientWidth 含内边距 → 减两侧 padding 得正文实际列宽）。列宽=可视宽：保证一屏恰好一列。
        const cw = Math.max(120, el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
        // gap 与 JS 侧翻页位移保持一致（scrollLeft 步进 = 列宽 + gap）
        const gap = 2;
        el.style.columnWidth = `${cw}px`;
        el.style.columnGap = `${gap}px`;
        el.style.columnFill = 'auto';
        // 版心：文字不占满整列，改为与连续模式同款限宽居中（左右等内边距），
        // 让翻页每页呈现「版心居中 + 两侧留白」而非全宽。readWidth 对齐连续 textEl max-width。
        const readW = 680;
        const lr = Math.max(0, Math.round((cw - readW) / 2));
        Array.from(this.textEl.querySelectorAll<HTMLElement>('p')).forEach((p) => {
            p.style.paddingLeft = lr > 0 ? `${lr}px` : '';
            p.style.paddingRight = lr > 0 ? `${lr}px` : '';
        });
        // scrollEl 由 flex 撑满可视高（overflow 被 .rl-paged 裁成横向），multicol 即按此高断列（每列恰一屏）
        // 触发重排后，列内容横向溢出 → scrollWidth ≈ N×(列宽+gap)；据此算总列
        const pageW = cw + gap;
        this.totalPages = Math.max(1, Math.round(el.scrollWidth / pageW));
        this.pageW = pageW;
        return this.totalPages;
    }

    /** 关闭翻页列式样式（切回连续模式时清理 scrollEl 内联列样式） */
    private teardownPagedLayout(): void {
        const el = this.scrollEl;
        el.style.columnWidth = '';
        el.style.columnGap = '';
        el.style.columnFill = '';
        Array.from(this.textEl.querySelectorAll<HTMLElement>('p')).forEach((p) => {
            p.style.paddingLeft = '';
            p.style.paddingRight = '';
        });
        this.totalPages = 1;
        this.pageIndex = 0;
        this.pageW = 1;
    }

    /** 跳转/显示到指定页（paged）：横向滚动 scrollEl 到第 N 列起始，更新 pageIndex + 进度保存 */
    private goToPage(page: number, save = true): void {
        const t = this.totalPages;
        const p = Math.max(0, Math.min(t - 1, Math.round(page)));
        if (p === this.pageIndex && !save) return; // 已定位且非首次（jump 路径），跳动画
        this.pageIndex = p;
        const el = this.scrollEl;
        const target = p * this.pageW;
        animateScrollTo(el, target);
        this.updateProgress();
        if (save) this.scheduleSave(pageToRatio(p, t));
    }

    /** 下一页：翻页模式 = 翻一页；滚动模式 = 向下翻一屏（用户 2026-09-15：两种模式都翻一屏） */
    private goNextPage(): void {
        if (!this.isPaged()) {
            this.scrollOneScreen(1);
            return;
        }
        if (!isLastPage(this.pageIndex, this.totalPages)) {
            this.goToPage(this.pageIndex + 1);
            return;
        }
        // 章尾再翻 → 下一章首页
        if (this.chapterIndex < this.book.chapters.length - 1) {
            this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 1));
            this.switchChapter(this.chapterIndex + 1);
        } else {
            new Notice('已是最后一页');
        }
    }

    /** 上一页：翻页模式 = 翻一页；滚动模式 = 向上翻一屏；首页再上 → 上一章末页（翻页模式） */
    private goPrevPage(): void {
        if (!this.isPaged()) {
            this.scrollOneScreen(-1);
            return;
        }
        if (!isFirstPage(this.pageIndex)) {
            this.goToPage(this.pageIndex - 1);
            return;
        }
        if (this.chapterIndex > 0) {
            // 上一章末页（切过去后跳到该章末页）
            this._switchToPrevChapterLast();
        } else {
            new Notice('已是第一页');
        }
    }

    /** 滚动模式翻一屏：按可视高滚动（留 24px 重叠，避免整行被切在屏幕边界）；滚到底仍由触底自动翻章接管 */
    private scrollOneScreen(dir: 1 | -1): void {
        const el = this.scrollEl;
        const step = Math.max(60, el.clientHeight - 24);
        // ⚠️ 不可用 animateScrollTo：它动画的是 scrollLeft（翻页模式横向列滚动专用）→ 纵向翻屏无效（用户实测「点了没反应」）
        const top = el.scrollTop + dir * step;
        try {
            el.scrollTo({ top, behavior: 'smooth' });
        } catch {
            el.scrollTop = top;
        }
    }

    /** 切到上一章并定位到其末页（经保存原章进度后 switchChapter，renderContent 内按 jump 到 ratio≈1 归位） */
    private _switchToPrevChapterLast(): void {
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 0 });
        this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 0));
        this.jumpRatio = 1;
        this.switchChapter(this.chapterIndex - 1);
    }

    /**
     * #355（用户指令）：**点击正文段落 = 重设朗读起读点**，把起读粒度从「章节」细化到「段落」。
     * 用户场景原话：长文里已经读到中间，只希望「从当前正在阅读的段落继续听」，而不是倒回章首。
     *
     * 三类点击**不算**换起读点（都会被静默忽略）：
     *  ㈠ 点链接 —— 那是要跳转；
     *  ㈡ 带文字选区 —— 那是要摘抄 / 高亮，不是要听；
     *  ㈢ 点在正文空白（不在任何段落里）—— 交给 `TtsService.clickOffset` 判 null。
     *
     * 未在朗读时只记锚点（之后点朗读就从这一段开始）；正在朗读时由 TtsService **立刻**从这一段读起，
     * 高亮随之平滑跳过去。锚点只是界面态：不落库、不写阅读存档、不碰用户高亮。
     */
    private onTextClickAnchor(ev: MouseEvent): void {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (target.closest?.('a')) return;
        if (window.getSelection()?.toString().trim()) return;
        this.ttsSvc?.anchorAt(target);
    }

    /** 正文点击（click 于 scrollEl）：翻页模式两侧 1/4 翻页；其余位置在沉浸模式下 = 收起 / 展开上下边栏 */
    private onBodyClickPage(ev: MouseEvent): void {
        // 有文字选区（可能是点一下收起的残选）→ 交给选中逻辑，不翻页也不切换边栏
        const sel = window.getSelection();
        if (sel && sel.toString().trim()) return;
        const el = this.scrollEl;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = ev.clientX - rect.left;
        // 翻页模式：左右 1/4 仍翻页（翻页优先），中央留给沉浸切换
        if (this.isPaged()) {
            if (x < rect.width * 0.25) {
                this.goPrevPage();
                return;
            }
            if (x > rect.width * 0.75) {
                this.goNextPage();
                return;
            }
        }
        this.toggleBars();
    }

    /** 切换滚动模式（下拉）：更新 mode + 重渲染当前章以应用列式/连续，写回设置 */
    private setMode(m: ScrollMode): void {
        // 单选语义（用户 2026-09-15）：点已选项只重绘勾选，避免原生 checkbox 被取消后两项皆空
        if (m === this.mode) {
            this.syncSegItems(this.modeSeg, this.mode);
            return;
        }
        const keepRatio = this.currentRatio();
        this.mode = m;
        // 勾选**先于一切副作用**重绘，且不设「菜单是否打开」前置条件（2026-09-16 修：原先写在宿主回调与
        // 重建正文之后并带 settingsOpen 门，中途任何一步出偏差（回调抛错 / 菜单标志不同步）都会让勾选
        // 停在上一次状态）；下一帧再兜底校正一次，防浏览器默认激发行为在事件末尾翻转 checked。
        this.syncSegItems(this.modeSeg, this.mode);
        this.options.onScrollModeChange?.(m);
        const nowPaged = m === 'paged';
        this.scrollEl.toggleClass('rl-paged', nowPaged);
        if (!nowPaged) this.teardownPagedLayout();
        // 重渲染当前章：连续模式按原比例归位；翻页模式 setupPagedLayout 后按原比例对页
        this.renderContent();
        requestAnimationFrame(() => {
            if (nowPaged) {
                this.setupPagedLayout();
                this.goToPage(ratioToPage(keepRatio, this.totalPages), false);
            } else {
                this.applyRatio(keepRatio);
            }
        });
        requestAnimationFrame(() => this.syncSegItems(this.modeSeg, this.mode));
        // 自动推进按模式分派：切换后重启（滚动用 rAF、翻页用定时器）
        this.restartAutoIfOn();
    }

    /** 切换行宽（严格/全宽）：写回设置 + 即时应用（宽度变化会改变换行 → 按原比例保持阅读位置） */
    private setLineWidth(w: ReaderLineWidth): void {
        // 单选语义（用户 2026-09-15）：点已选项只重绘勾选，保证恒有一项被选中
        if (w === this.lineWidth) {
            this.syncSegItems(this.widthSeg, this.lineWidth);
            return;
        }
        this.lineWidth = w;
        // 勾选先于副作用重绘（同 setMode 的理由：不带 settingsOpen 门 + 不落在宿主回调之后）
        this.syncSegItems(this.widthSeg, this.lineWidth);
        this.options.onLineWidthChange?.(w);
        const ratio = this.currentRatio();
        this.applyLineWidth();
        this.reflowKeepRatio(ratio);
        requestAnimationFrame(() => this.syncSegItems(this.widthSeg, this.lineWidth));
    }

    // ── 字号 ──

    /** 初始化/应用会话字号与行距（取设置默认，解析失败回退 16px / 1.8） */
    private applyFontSize(): void {
        if (readerFontSize === null) {
            readerFontSize = this.options.settings?.fontSize ?? 16;
        }
        this.textEl.style.fontSize = `${readerFontSize}px`;
        this.textEl.style.lineHeight = `${readerLineHeight ?? this.lineHeight}`;
    }

    /** 面板尺寸变化（用户拖 Obsidian 侧栏宽度等）：按原比例重排 —— 翻页列宽按当时视口算死，
     *  原先完全没有 resize 处理（用户 2026-09-16 报障「鼠标无法继续聚焦滚动正文」）。 */
    onResize(): void {
        this.reflowKeepRatio(this.currentRatio());
    }

    /** 应用行宽：严格 = 回落 CSS 版心（min(74ch, 92%) 居中，随字号/窗口自适应）；全宽 = 取消 max-width */
    private applyLineWidth(): void {
        this.textEl.style.maxWidth = this.lineWidth === 'full' ? 'none' : '';
    }

    /** 设定字号（滑条 / 键盘共用）：夹取范围 → 应用 → 按比例保持阅读位置 → 需要时写回设置 */
    private applyFontValue(next: number, persist: boolean): void {
        if (readerFontSize === null) this.applyFontSize();
        const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next)));
        if (clamped === readerFontSize) {
            this.syncSettingsLabels();
            return;
        }
        readerFontSize = clamped;
        const ratio = this.currentRatio();
        this.textEl.style.fontSize = `${clamped}px`;
        this.reflowKeepRatio(ratio);
        if (persist) this.options.onSettingsChange?.({ fontSize: clamped, lineHeight: readerLineHeight ?? this.lineHeight });
        this.syncSettingsLabels();
    }

    /** 设定行距（滑条 / 键盘共用）；口径同 applyFontValue */
    private applyLineValue(next: number, persist: boolean): void {
        if (readerLineHeight === null) readerLineHeight = this.lineHeight;
        const clamped = Math.round(Math.min(LINE_MAX, Math.max(LINE_MIN, next)) * 10) / 10;
        if (clamped === readerLineHeight) {
            this.syncSettingsLabels();
            return;
        }
        readerLineHeight = clamped;
        this.lineHeight = clamped;
        const ratio = this.currentRatio();
        this.textEl.style.lineHeight = `${clamped}`;
        this.reflowKeepRatio(ratio);
        if (persist) this.options.onSettingsChange?.({ fontSize: readerFontSize ?? 16, lineHeight: clamped });
        this.syncSettingsLabels();
    }

    private adjustFont(delta: number): void {
        this.applyFontValue((readerFontSize ?? this.options.settings?.fontSize ?? 16) + delta, true);
    }

    private adjustLineHeight(delta: number): void {
        this.applyLineValue((readerLineHeight ?? this.lineHeight) + delta, true);
    }

    /** 字号/行距变化后按原比例归位（连续滚到 scrollTop；翻页重测列数并到对应页） */
    private reflowKeepRatio(ratio: number): void {
        const el = this.scrollEl;
        this.markRatio(ratio);
        this.restoring = true;
        requestAnimationFrame(() => {
            if (this.isPaged()) {
                this.setupPagedLayout();
                this.goToPage(ratioToPage(ratio, this.totalPages), false);
            } else {
                const m2 = el.scrollHeight - el.clientHeight;
                el.scrollTop = ratio * m2;
            }
            this.restoring = false;
            this.updateProgress();
        });
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

/**
 * 给「网络搜索」浮层的引擎 chip 挂图标（用户 2026-09-19 裁定：纯图标 + 悬停提示 + 品牌官方色）。
 * 品牌 logo 走自绘 `<svg><path>`（simple-icons，24×24 单路径、填充式），色值经 CSS 变量
 * `--rl-eng-c` / `--rl-eng-c-dark` 落到 `path{fill}` —— **样式侧不出现字面色值**（换肤只改容器变量）。
 * 无品牌 logo 的引擎走 Obsidian 内置图标（`safeSetIcon`，描边式、跟随主题文字色）。
 * 图标表与名单见 `pure/searchIcons`（完整性由类型 + 单测双重兜住）。
 */
function setSearchEngineIcon(host: HTMLElement, id: SearchEngineId): void {
    const box = host.createSpan({ cls: 'rl-search-net-icon' });
    const icon = SEARCH_ENGINE_ICONS[id];
    if (icon.kind === 'builtin') {
        safeSetIcon(box, icon.id);
        return;
    }
    box.style.setProperty('--rl-eng-c', icon.hex);
    if (icon.hexDark) box.style.setProperty('--rl-eng-c-dark', icon.hexDark);
    const svg = box.createSvg('svg', { cls: 'rl-eng-brand', attr: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' } });
    svg.createSvg('path', { attr: { d: icon.path } });
}

/** 摘抄书签引用文本截断（多行压平 + 超长省略号） */
function truncateQuote(s: string, n = 18): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > n ? flat.slice(0, n) + '…' : flat;
}
