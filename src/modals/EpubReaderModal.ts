// EPUB 书籍阅读器面板（原 Modal 弹窗，随 ReaderView 视图渲染）：目录侧栏 + iframe 渲染章节 + 单页连续滚动/翻页式切换 + 进度持久化
// 排版：字号 ±（注入 iframe 内样式，会话级默认 16px，行距 1.8）；目录跳转（href 定位章节）；
// 滚动比例按章节持久化（与 TXT 阅读器共用 阅读进度/{id}.json，由 main.ts 读写）
// 渲染：章节 XHTML 文本 → iframe.srcdoc（注入基础 CSS；二进制资源如图片本期不支持，占位）
// 由 ReaderView 传入容器/scope 挂载；closeView 由视图层注入（detach leaf）
// batch1 镜像（T7）：头部三键 + auto-hide 外壳、侧栏 书签/摘抄 三 pane、选中动作条（书签/摘抄）、设置下拉、底部工具条；
// 正文为 iframe：选中/滚动/鼠标事件发生在 frame 内文档（不冒泡到宿主），监听在 onFrameLoad 内挂到 contentDocument。
import { Notice, requestUrl, setIcon, type Scope } from 'obsidian';
import { estimatePercent } from 'pure/readingProgress';
import { chapterTextLength, epubTocCharCounts, xhtmlToText } from 'pure/epubParse';
import { attachTocResizer, formatCharCount } from 'pure/readerToc';
import { attachHeadDensity } from 'pure/readerHead';
import { createReadingUnitCounter } from 'pure/readingUnits';
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
    highlightMarkCss,
    type HlStyle,
    type HlColor,
    type ReaderHighlight,
    type HlMarkTarget,
} from 'pure/highlight';
// 书内链接解析（纯逻辑）：拦截 srcdoc 内的 <a>，翻译成「跳章 / 滚锚点 / 外部链接」
import { resolveEpubHref } from 'pure/epubLink';
import { locateQuoteSpan } from 'pure/anchor';
import { normalizeLineWidth, normalizeScrollMode, pageToRatio, ratioToPage, isFirstPage, isLastPage, type ReaderLineWidth, type ScrollMode } from 'pure/paged';
import { footerReadout } from 'pure/readerFooter';
import { excerptCardLocLabel, excerptCardKeyAction, needsQuoteExpand, placeCard } from 'pure/excerptCard';
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
    /** 阅读排版设置（设置页持久化）：初始字号/行距/段落首行缩进/字体/字重/字距；调整写回 settings */
    settings?: ReaderTypoPayload;
    /** 排版变更回调（字号/行距/缩进调整后写回设置持久化；indent 缺省表示本次不改这一项） */
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
// 自动滚动速度 / 自动翻页间隔（用户 2026-09-15 裁定定速 150px/s、5 秒/页）：
// #341 起这两个值**可调**（右键「自动」弹窗滑条），参数与夹取真源在 `pure/readerAuto`。
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

/** 宿主配色与正文字体（每次构建章节时从**面板容器**读一次）：
 *  🔴 2026-09-15 修复「阅读器不适配深色模式」：原先把 body 的 computed bg/color 存进**模块级缓存且永不清除**，
 *  于是只要先浅色打开过阅读器，之后切到深色主题，正文 iframe 仍沿用旧色（白底黑字）。
 *  同时改为优先取主题变量：body 的 computed 背景是 --background-secondary（与正文画布 --background-primary 不一致）。
 *  getComputedStyle 为只读查询、不触发重排，每章读一次的成本可忽略（故不再缓存）。 */
function getHostStyle(host: HTMLElement): { fontFamily: string; bg: string; color: string } {
    const cs = getComputedStyle(host);
    // 正文字体跟随 Obsidian「设置 → 外观 → 字体 → 正文字体」（--font-text）；
    // body 自身的 font-family 取到的是界面字体（--font-interface）→ 正文会串成界面字体（用户 2026-09-15 报）
    const textFont = cs.getPropertyValue('--font-text').trim();
    const bg = cs.getPropertyValue('--background-primary').trim() || cs.backgroundColor;
    const color = cs.getPropertyValue('--text-normal').trim() || cs.color;
    return { fontFamily: textFont || cs.fontFamily, bg, color };
}

export class EpubReaderPanel {
    /** 当前章节索引（book.chapters 阅读序） */
    private chapterIndex: number;
    /** 目录条目（渲染目录列用） */
    private tocEntries: { label: string; href: string }[] = [];
    /** 目录列折叠状态（首次打开即收起；用户 2026-09-15 裁定） */
    private tocCollapsed = true;
    /** 模式（滚动 / 翻页；滚动为默认，翻页=单列一屏一页平移） */
    private mode: ScrollMode = 'continuous';
    /** 阅读行宽（严格=固定版心 / 全宽=铺满；启动读设置，菜单切换即时应用并写回） */
    private lineWidth: ReaderLineWidth = 'strict';
    /** 顶栏快捷「标注模式锁」：非空 = 该按钮已激活，之后选区 mouseup 自动触发对应标注动作 */
    private annotateMode: ReaderQuickMode | null = null;
    /** 四快捷按钮元素引用（激活态 .rl-quick-active 切换） */
    /** 顶栏「更多」⋮（#345 窄屏收纳快捷入口）：按钮 / 浮层 / 开合态 / observer 注销句柄 */
    private moreBtn: HTMLButtonElement | null = null;
    private morePanelEl: HTMLDivElement | null = null;
    private moreOpen = false;
    private disposeHeadDensity: (() => void) | null = null;
    private quickBtns: Partial<Record<ReaderQuickMode, HTMLButtonElement>> = {};
    /** 翻页模式当前页 index / 总页数 / 单页横向位移（列宽+gap；仅 paged 用） */
    private pageIndex = 0;
    private totalPages = 1;
    private pageW = 1;
    /**
     * 设置面板里的三个分段控制器（#351）：阅读模式 / 行宽 / 段落缩进。
     * ⚠️ 亮起态由 `syncSegItems(seg, String(current))` 按各段的 `data-val` 统一维护（原来三组各写一套同步）。
     */
    private modeSeg: HTMLElement | null = null;
    private widthSeg: HTMLElement | null = null;
    private indentSeg: HTMLElement | null = null;
    /** 阅读主题（会话档位，启动读设置；容器类换肤，follow 不挂类） */
    private theme: ReaderThemeId = 'follow';
    /** 菜单主题色卡按钮（每档一个，选中态 is-on） */
    private themeSwatches: Partial<Record<ReaderThemeId, HTMLButtonElement>> = {};
    /** 段落首行缩进（菜单视图行第 4 个按钮；会话态，写回 settings.readerIndent） */
    private indent = true;
    /** 字体族 / 字重 / 字距（#351「显示」组；会话态，写回 settings） */
    private fontFamily: ReaderFontFamily = 'default';
    private fontWeight: ReaderFontWeight = 'normal';
    private letterSpacing = LETTER_DEFAULT;
    /** 字重分段控制器 + 字距滑条与值文本（同步用） */
    /** 字体族切换（#351e 由下拉改成纯字变色切换，需要记引用才能同步亮起态） */
    private familySeg: HTMLElement | null = null;
    private weightSeg: HTMLElement | null = null;
    private letterSlider: HTMLInputElement | null = null;
    private letterVal: HTMLElement | null = null;
    /** 键位提示的最近一次时间戳（#351：连按 ↑↓ 时通知限流用） */
    private lastHotkeyNotice = 0;
    /** 高亮默认样式/颜色（会话态，pickHlStyle 后写回设置） */
    private hlStyle: HlStyle = DEFAULT_HL_STYLE;
    private hlColor: HlColor = DEFAULT_HL_COLOR;
    /** 样式选择器浮层 + 它当前要改的那条高亮 id */
    private hlPickerEl: HTMLDivElement | null = null;
    private hlPickerTargetId: string | null = null;
    /** 色板定位锚点（宿主 client 坐标；null = 贴动作条。顶栏高亮模式动作条不在场 → 以鼠标为锚） */
    private hlPickerAnchor: { x: number; y: number } | null = null;
    /** 动作条第 5 个按钮：垃圾桶（仅命中时显示） */
    /** 浮层里的样式按钮 / 颜色圆点 / 垃圾桶 */
    private hlStyleBtns: Partial<Record<HlStyle, HTMLButtonElement>> = {};
    private hlColorBtns: Partial<Record<HlColor, HTMLButtonElement>> = {};
    private hlTrashBtn: HTMLButtonElement | null = null;
    /** 当前选区是否命中已有高亮/摘抄（决定浮层里垃圾桶显隐） */
    private hlTrashReady = false;
    /** 跨章链接带的锚点（新章载入后定位；纯锚点跳转不走这里） */
    private pendingFrameFragment: string | null = null;
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
    /** 摘抄区计数文本（与高亮区并列的分区标题条，用户 2026-09-17：摘抄/高亮隔分栏） */
    private exCountEl: HTMLDivElement | null = null;
    /** 书签区计数（书签并入标注 pane 后与高亮/摘抄同款分区头） */
    private bmCountEl: HTMLDivElement | null = null;
    /** 书签列表容器（标注 pane 第一区） */
    private bmListEl: HTMLDivElement | null = null;
    /** 标注三区（书签/高亮/摘抄）的选择模式状态与头部句柄（#345：「清除全部」→ 选择模式 + 删除所选） */
    private bmSel: AnnoSelState = { on: false, ids: [] };
    private hlSel: AnnoSelState = { on: false, ids: [] };
    private exSel: AnnoSelState = { on: false, ids: [] };
    private bmHeadRef: AnnoHeadHandles | null = null;
    private hlHeadRef: AnnoHeadHandles | null = null;
    private exHeadRef: AnnoHeadHandles | null = null;
    /** 正文 iframe（srcdoc 每章重建） */
    private frameEl!: HTMLIFrameElement;
    /** 头部条元素（auto-hide 显示/隐藏目标） */
    private headEl: HTMLElement | null = null;
    /** 顶栏居中标题元素（显示当前章，切章时刷新；EPUB 无目录条目时回退文件名，全空回退书名） */
    private headTitleEl: HTMLSpanElement | null = null;
    /** 侧栏折叠开关按钮（head 首元素，最左；点击 toggleToc，图标/标题随折叠态变化） */
    private sidebarToggleEl: HTMLButtonElement | null = null;
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
    /** 菜单字号 / 行距滑条（用户 2026-09-16：± 按钮改滑条；键盘 +/− 与 ←/→ 快捷键仍可用） */
    private menuFontSlider: HTMLInputElement | null = null;
    private menuLineSlider: HTMLInputElement | null = null;
    /** 语音朗读服务（#340；环境不支持时为 null） */
    private ttsSvc: TtsService | null = null;
    /** 朗读按钮（下拉内，与全屏/沉浸/自动/缩进同排） */
    private ttsBtnEl: HTMLButtonElement | null = null;
    /** 视图按钮的右键弹窗（朗读=语速/语音、自动=速度；#341 起两个按钮**共用同一个浮层元素**） */
    private popEl: HTMLDivElement | null = null;
    /** 菜单视图三按钮（全屏 / 沉浸 / 自动；点击切换 + is-on 高亮） */
    private fsBtnEl: HTMLButtonElement | null = null;
    private immersiveBtnEl: HTMLButtonElement | null = null;
    private autoBtnEl: HTMLButtonElement | null = null;
    /** 沉浸模式开关（隐藏上下边栏；会话级，不落设置） */
    private immersive = false;
    /** 自动推进开关（滚动=自动滚动 / 翻页=自动翻页；会话级，不落设置） */
    private autoOn = false;
    /** 自动滚动速度（px/s；#341 起可在右键弹窗里调，初值取记忆值 / 缺省定速 150） */
    private autoScrollPx = loadAutoScrollPx() ?? AUTO_SCROLL_DEFAULT;
    /** 自动翻页间隔（ms；#341 起可在右键弹窗里调） */
    private autoTurnMs = AUTO_TURN_DEFAULT_MS;
    /** 自动滚动的**浮点位置**（#342）：实现见 `advanceAutoPos` —— 不能靠读回 `scrollTop` 累加（写入被取整） */
    private autoPos: number | null = null;
    /** 底部工具条元素（沉浸模式下改浮层，作为显隐目标） */
    private footEl: HTMLElement | null = null;
    /** 自动滚动 rAF / 自动翻页定时器（按模式二选一；停自动与销毁时清理） */
    private autoRaf: number | null = null;
    private autoTimer: number | null = null;
    /** 自动滚动上一帧时间戳（按时间增量推进，避免高刷屏过快） */
    private autoLastTs = 0;
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
    /** 当前选区记录（选中瞬间固化 文本/章/百分比 + 落点高亮 mark；hideSelbar 时清空）
     *  🔴 `mark` 是「选中的文字是否带高亮样式」的**唯一判据**（DOM 实测，不是清单匹配）——
     *     动作条垃圾桶显隐与删除目标都读它；用户 2026-09-18：没样式的选段不许出现垃圾桶。 */
    private selRecord: { text: string; chapter: number; pct: number; mark?: HlMarkTarget | null } | null = null;
    /** 动作条「高亮」按钮（口径随选区是否已高亮切换：高亮 / 取消高亮） */
    private selbarHlBtn: HTMLButtonElement | null = null;
    /** 动作条垃圾桶（仅「选中文字已有高亮」时显示；用户 2026-09-18） */
    private selbarTrashBtn: HTMLButtonElement | null = null;
    /** 译文就地浮层卡片（划词翻译结果；.hidden 收起；翻译批新增） */
    private translateCard: HTMLDivElement | null = null;
    /** 译文卡片内容容器（loading/译文/错误态更新目标） */
    private translateCardBody: HTMLDivElement | null = null;
    /** 搜索就地卡片（划词后点「搜索」浮出；用户 2026-09-17 裁定方案 A：引擎 chip 走浏览器 + AI 答案在卡内） */
    private searchCard: HTMLDivElement | null = null;
    /** 卡片内查询输入框（初值＝选中文字，可编辑；回车重跑 AI 搜索） */
    private searchQueryEl: HTMLInputElement | null = null;
    /** AI 答案容器（loading / 答案 / 错误 三态） */
    private searchBodyEl: HTMLDivElement | null = null;
    /** 「复制」按钮（复制 AI 答案） */
    private searchCopyBtn: HTMLButtonElement | null = null;
    /** AI 请求令牌：改词 / 重开卡片后旧响应作废（防慢响应覆盖新结果） */
    private searchRunToken = 0;
    /** 「网络搜索」浮层（5 类分组的文字 chip；用户 2026-09-18 拆分后的独立入口，取代原「二选一」浮层） */
    private netPanelEl: HTMLDivElement | null = null;
    /** 浮层顶部「用选中文字：…」预览行 */
    private netQuoteEl: HTMLDivElement | null = null;
    /** 浮层锁存的待搜文本（选中保持高亮 → 文本在用户点引擎前就锁存） */
    private netQueryText = '';
    /** AI 卡两态：'read' 解读选段（走设置页提示词）/ 'ask' 自定义提问（走内置固定提示词） */
    private searchMode: 'read' | 'ask' = 'read';
    /** 打开卡片时锁存的选段（「自定义提问」态在解读框被清空时兜底） */
    private searchCardText = '';
    /** 两态切换按钮（.is-on 亮起态） */
    private searchModeBtns: Partial<Record<'read' | 'ask', HTMLButtonElement>> = {};
    /** 「解读选段」态输入区容器（切到提问态即隐藏） */
    private searchReadSecEl: HTMLDivElement | null = null;
    /** 「自定义提问」态输入区容器（选段预览 + 问题输入框） */
    private searchAskSecEl: HTMLDivElement | null = null;
    /** 「自定义提问」态的问题输入框 */
    private searchQuestionEl: HTMLInputElement | null = null;
    /** 「自定义提问」态的选段预览行 */
    private searchQuoteEl: HTMLDivElement | null = null;
    /** 摘抄就地卡片（划词后就地写摘抄；用户 2026-09-17 裁定 C 方案，替换原 ReaderExcerptModal 弹窗） */
    private excerptCard: HTMLDivElement | null = null;
    private excerptLocEl: HTMLDivElement | null = null;
    private excerptQuoteEl: HTMLDivElement | null = null;
    private excerptMoreBtn: HTMLButtonElement | null = null;
    private excerptNoteEl: HTMLTextAreaElement | null = null;
    private excerptSaveBtn: HTMLButtonElement | null = null;
    /** 卡片当前待写入的引用文本与定位（保存时一并交给宿主） */
    private excerptCardQuote = '';
    private excerptCardLoc: { chapter: number; pct: number } | null = null;
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
    /** 上一条 quote 的定位提示比例（0-1）：仅当 quote 在正文里出现多次时用来消歧，不决定落点 */
    private pendingHighlightHint: number | null = null;
    /** 各章字符数（百分比估算加权；懒计算） */
    private chapterSizesCache: number[] | null = null;
    /** 会话行距（倍数，初始取设置默认 1.8） */
    private lineHeight: number;
    /** 全屏态变化：同步菜单全屏标签文案 */
    private onFsChange = (): void => {
        this.syncViewBtns();
    };
    /** 面板外 mousedown：收起选中动作条 + 设置下拉（mount 注册 / destroy 注销）；iframe 内容 mousedown 同样走此回调
     *  （iframe 事件不冒泡到宿主 document，onFrameLoad 内单独挂到 frame 文档；两者自身 mousedown 已 stopPropagation 不会触发） */
    /**
     * 阅读器键位（#351）：判定全在 `pure/readerHotkeys`（TXT / EPUB 共用一份），这里只做执行。
     *  - **空格**：朗读中 → 暂停 / 续读；否则自动在跑 → 暂停 / 继续自动；都没开 → 什么都不做；
     *  - **↑↓**：自动运行时调速（**就地改速，不重启** —— 滚动每帧读 `autoScrollPx`，翻页则重建定时器）。
     * 🔴 输入框里不接管（`isTypingTarget`）：笔记编辑框与搜索框里敲空格不该把朗读切掉。
     * 🔴 提示用 `Notice` 且**限流 500ms**：连按 ↑↓ 时不能刷出一屏通知。
     */
    private onReaderKeydown = (ev: KeyboardEvent): void => {
        if (ev.defaultPrevented || ev.isComposing) return;
        if (isTypingTarget(ev.target)) return;
        const svc = this.ttsSvc;
        const action = resolveReaderHotkey(
            ev.key,
            { ttsOn: !!svc?.isSpeaking, autoOn: this.autoOn },
            { ctrl: ev.ctrlKey, meta: ev.metaKey, alt: ev.altKey },
        );
        if (!action) return;
        ev.preventDefault();
        if (action === 'tts-toggle') {
            if (!svc?.isSpeaking) return;
            if (svc.isPaused) svc.resume();
            else svc.pause();
            return;
        }
        if (action === 'auto-toggle') {
            this.setAuto(!this.autoOn);
            return;
        }
        // ↑↓ 调速：翻页模式调「翻页间隔」，滚动模式调「滚动速度」——单位不同，但都用「快 = 数值更极端」表达
        const faster = action === 'auto-faster';
        let text: string;
        if (this.isPaged()) {
            this.autoTurnMs = clampAutoTurnMs(this.autoTurnMs + (faster ? -AUTO_TURN_STEP_MS : AUTO_TURN_STEP_MS));
            text = `自动翻页 ${autoTurnLabel(this.autoTurnMs)}`;
            this.restartAutoIfOn(); // 定时器按新间隔重建（滚动模式下无操作）
        } else {
            this.autoScrollPx = clampAutoScrollPx(this.autoScrollPx + (faster ? AUTO_SCROLL_STEP : -AUTO_SCROLL_STEP));
            saveAutoScrollPx(this.autoScrollPx); // 按帧读取 ⇒ 立刻生效，不打断
            text = `自动速度 ${autoSpeedLabel(this.autoScrollPx, this.currentFontPx())}`;
        }
        this.noticeHotkey(text);
    };

    /** 键位提示通知（500ms 限流；连按时不刷屏） */
    private noticeHotkey(text: string): void {
        const now = Date.now();
        if (now - this.lastHotkeyNotice < 500) return;
        this.lastHotkeyNotice = now;
        new Notice(text, 1200);
    }

    private onDocMouseDown = (): void => {
        this.hideSelbar();
        this.hideExcerptCard();
        this.hideSearchCard();
        this.hideNetPanel();
        this.hideMenu();
        this.hideMore();
        this.hideTranslateCard();
        this.closePop();
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
        // #351 键位：空格（朗读暂停/播放，没在朗读则暂停/继续自动）+ ↑↓（自动调速，不打断）
        document.addEventListener('keydown', this.onReaderKeydown);
        // 自动推进期间用户滚动/触摸即停（iframe 内另挂一份，见 onFrameLoad）
        this.container.addEventListener('wheel', this.onUserInterrupt, { passive: true });
        this.container.addEventListener('touchstart', this.onUserInterrupt, { passive: true });
        // 初始 pane 激活态同步：默认目录 tab 高亮；⚠️ 首次打开**始终收起目录**（用户 2026-09-15 裁定）
        this.activatePane('toc', false);
        this.tocEl.addClass('collapsed');
        this.syncSidebarToggle();
        this.renderChapter();

        // 键盘翻页/翻章：← 上一页（翻页）/上一章（连续）；→ 下一页/下一章（scope 由 ReaderView 注入）
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
        this.disposeHeadDensity?.(); // #345 顶栏窄屏收纳的 ResizeObserver 随面板注销
        this.disposeHeadDensity = null;
        this.ttsSvc?.destroy(); // 朗读随面板一并停止（cancel + 清高亮 + 摘 voiceschanged）
        this.resetAnnotate(); // 关面板复位标注模式
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (this.fsListenerRegistered) {
            document.removeEventListener('fullscreenchange', this.onFsChange);
            this.fsListenerRegistered = false;
        }
        // 选中动作条/设置下拉 document 监听随面板一并注销（bar 本身随 container.empty 移除；iframe 文档监听随 srcdoc 重建自动回收）
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

        // 目录/书签/摘抄 切换改由侧栏 tab 行承担（顶部仅渲染一次）；ops 仅保留 ≡ 设置
        const titleWrap = head.createDiv({ cls: 'rl-reader-title-wrap' });
        // 初值书名，mount 末尾 renderChapter 会立刻替换为当前章标题（用户 2026-09-16 裁定）
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
        this.morePanelEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
        // 阅读设置（≡）：T6 下拉菜单（字号/行距/模式/全屏）；行距±按钮已并入菜单
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        // 阻止 mousedown 冒泡到 document（onDocMouseDown 会先收起菜单，导致 click toggle 逻辑反相）
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);
        // 快捷入口（书签/摘抄/翻译/高亮）移到右侧设置按钮左边（用户 2026-09-15 裁定）
        ops.insertBefore(quickWrap, this.settingsBtn);
        // #345 窄屏收纳：head 宽度 < HEAD_NARROW_W 时把 quickWrap 整体搬进「更多」浮层（同一批按钮实例）
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

    /** 顶栏标题（#345）：文本 + 悬停全称 —— 被省略号截断后 data-tip 是唯一能看到完整标题的入口 */
    private setHeadTitle(text: string): void {
        const el = this.headTitleEl;
        if (!el) return;
        el.setText(text);
        el.setAttribute('data-tip', text);
    }

    /** 窄屏「更多」浮层开合（#345）：与设置下拉同款；两者互斥 */
    private toggleMore(): void {
        if (!this.morePanelEl) return;
        this.hideSelbar();
        this.hideMenu();
        this.moreOpen = !this.moreOpen;
        this.morePanelEl.toggleClass('hidden', !this.moreOpen);
        this.moreBtn?.toggleClass('active', this.moreOpen);
    }

    /** 收起「更多」浮层（外部 mousedown / 切走时调用）；未开则跳过 */
    private hideMore(): void {
        if (!this.moreOpen) return;
        this.moreOpen = false;
        this.morePanelEl?.addClass('hidden');
        this.moreBtn?.removeClass('active');
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
        // 点击即换肤（容器变量覆盖 + EPUB iframe 注入样式重建）+ 写回设置；当前档加强调色外圈环
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

    /** 设定字体族（切换；#351 建为下拉 / #351e 改纯字变色）：即时应用 + 同步亮起态 + 写回设置 */
    private setFontFamily(v: ReaderFontFamily): void {
        this.fontFamily = normalizeFontFamily(v);
        this.syncSegItems(this.familySeg, this.fontFamily);
        this.applyTypeStyle(true);
    }

    /** 设定字重（分段；#351）：即时应用 + 写回设置 */
    private setFontWeight(v: ReaderFontWeight): void {
        this.fontWeight = normalizeFontWeight(v);
        this.syncSegItems(this.weightSeg, this.fontWeight);
        this.applyTypeStyle(true);
    }

    /** 设定字距（滑条；#351）：口径同字号 —— 拖动上屏、松手落库 */
    private applyLetterValue(next: number, persist: boolean): void {
        const clamped = normalizeLetterSpacing(next);
        if (clamped === this.letterSpacing) {
            this.syncSettingsLabels();
            return;
        }
        this.letterSpacing = clamped;
        this.applyTypeVars();
        if (persist) {
            this.options.onSettingsChange?.({
                fontSize: this.currentFontPx(),
                lineHeight: this.currentLineHeight(),
                letterSpacing: this.letterSpacing,
            });
        }
        this.syncSettingsLabels();
    }

    /**
     * 应用字体族 / 字重 / 字距（#351）。
     * 🔴 EPUB 与 TXT 的实现差异**必须保留**：正文在 iframe 的独立文档里，**不继承容器内联样式** ⇒
     *    只能重建注入 CSS（refreshTheme）。所以本方法的真身是「改字段 + 让注入样式重新上屏」。
     * ⚠️ 改字距会改变文本度量 ⇒ 翻页模式的列宽要重算（`onResize` 在连续模式下是空操作）。
     */
    private applyTypeVars(): void {
        this.refreshTheme();
        this.onResize();
    }

    /** 应用 + （可选）写回设置 —— 打开面板时的初次应用也要走这里（persist=false） */
    private applyTypeStyle(persist: boolean): void {
        this.applyTypeVars();
        if (persist) {
            this.options.onSettingsChange?.({
                fontSize: this.currentFontPx(),
                lineHeight: this.currentLineHeight(),
                fontFamily: this.fontFamily,
                fontWeight: this.fontWeight,
                letterSpacing: this.letterSpacing,
            });
        }
        this.syncSettingsLabels();
    }

    // ── 语音朗读（#340 建立；#344 起两个音源）──

    /**
     * 建两个**音源引擎**与朗读服务（#344）。
     * 正文在 **iframe 内**（`contentDocument.body`），滚动容器用既有的 `frameScroller()`。
     * ⚠️ 高亮 span 必须用 iframe 自己的 `ownerDocument` 创建 —— 用宿主 document 创建的节点插不进去。
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
                text: () => this.frameEl?.contentDocument?.body?.textContent ?? "",
                root: () => this.frameEl?.contentDocument?.body ?? null,
                scroller: () => this.frameScroller(),
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

    /** 云合成 Key（每次现取 ⇒ 设置页刚填完就能用，不必重开阅读器） */
    private cloudKey(): string {
        return (this.options.getCloudKey?.() ?? "").trim();
    }

    /** 左键：朗读 / 停止切换；当前音源不可用时**说明原因**（不静默没反应） */
    private toggleTts(): void {
        const svc = this.ttsSvc;
        if (!svc) return;
        if (!svc.available()) {
            new Notice(
                svc.engineKind === "cloud"
                    ? "云合成不可用：请到 设置 → AI集成 › API凭据 · 硅基流动 填写 Key，或右键「朗读」切回系统语音"
                    : "当前环境不支持系统语音；可右键「朗读」切到云合成",
                6000,
            );
            return;
        }
        svc.toggle();
    }

    /** 同步按钮亮起态与提示（朗读中 = 亮 + 「停止朗读」） */
    private syncTtsBtn(on: boolean): void {
        this.ttsBtnEl?.toggleClass("is-on", on);
        this.ttsBtnEl?.setAttribute("data-tip", on ? "停止朗读" : "从当前段落开始朗读（右键可改语速 / 音色 / 音源）");
    }

    /**
     * 朗读按钮可用性。🔴 **只要还有一种音源可用就不置灰** —— 置灰会连右键都点不开，
     * 用户就被困在不可用的音源里，没法在弹窗里切回能用的那个。
     * 两种都不可用（移动端无系统语音 + 未配云 Key）才置灰，并写明原因。
     */
    private syncTtsAvailability(): void {
        const btn = this.ttsBtnEl;
        if (!btn) return;
        const anyOk = !!this.ttsSvc?.available() || ttsSupported() || !!this.cloudKey();
        btn.disabled = !anyOk;
        if (!anyOk) btn.setAttribute("data-tip", "当前环境不支持语音朗读（设置 → AI集成 › API凭据 · 硅基流动 可配置云合成）");
    }

    /**
     * 右键弹窗（#340 建立；#341 语速改滑条；#343 方案 A 加音调 / 分组 / 试听；#344 加音源切换与云音色）。
     * 分组由 `pure/tts.buildTtsMenu` 按当前音源产出：**音源 chips 恒在**（用户 #344 裁定「弹窗里也能切」），
     * 系统音源 = 音调 + 语音分组；云音源 = 音色分组（🔴 **无音调行** —— 云侧不支持 pitch）。
     * 🔴 滑条拖动中**只改显示值**，松手（`change`）才交给服务 —— 拖动每帧都重启朗读会卡成一片；
     *    `setRate` / `setPitch` 都走 `restart()`，朗读不中断、按钮不熄灭。
     * 🔴 语音 / 音色项右侧 `▶` = **试听**（不改变选中、不关弹窗）；点整行才是选中（并按音源分别记住）。
     */
    private openTtsMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.ttsBtnEl;
        const svc = this.ttsSvc;
        if (!btn || !svc) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
        for (const g of buildTtsMenu({
            engine: svc.engineKind,
            cloudReady: !!this.cloudKey(),
            rate: svc.currentRate,
            pitch: svc.currentPitch,
            volume: svc.currentVolume,
            voices: svc.voices(),
            curUri: svc.currentVoiceUri,
            cloudVoices: cloudVoiceGroups(loadCloudVoice()),
        })) {
            wrap.createDiv({ cls: "rl-reader-pop-title", text: g.title });
            if (g.select) {
                // 🔴 #351e 用户口径：音源由并排 chips 改成**下拉选择器**
                const opts = g.select;
                const cur = opts.find((c) => c.on)?.value ?? "";
                const sel = wrap.createEl("select", { cls: "rl-reader-pop-select" });
                for (const c of opts) {
                    // ⚠️ 不可用项**不置 disabled**：置灰的 <option> 根本选不了，用户就永远不知道要去哪配。
                    //    这里保持可选，选到不可用时弹一次说明再自动回落当前音源（#344 口径：不静默没反应）。
                    sel.createEl("option", { text: c.label, attr: { value: c.value } });
                }
                sel.value = cur;
                sel.addEventListener("change", () => {
                    const picked = opts.find((c) => c.value === sel.value);
                    if (picked?.disabled) {
                        new Notice(picked.hint || "当前音源不可用", 5000);
                        sel.value = cur; // 回落，不留下「显示云音源、实际还在系统语音」的假状态
                        return;
                    }
                    this.switchEngine(sel.value as TtsEngineKind);
                });
                continue;
            }
            if (g.slider) {
                const isRate = g.title === "语速";
                const isVolume = g.title === "音量";
                this.mkTtsSlider(wrap, {
                    slider: g.slider,
                    label: isRate ? ttsRateLabel : isVolume ? ttsVolumeLabel : ttsPitchLabel,
                    tip: isRate
                        ? "拖动调整朗读语速（键盘 ←/→ 微调）"
                        : isVolume
                          ? "拖动调整朗读音量（键盘 ←/→ 微调）"
                          : "拖动调整朗读音调（键盘 ←/→ 微调）",
                    apply: (v) => {
                        if (isRate) {
                            svc.setRate(v);
                            saveTtsRate(v); // 记住语速（跨书/跨面板）
                        } else if (isVolume) {
                            svc.setVolume(v);
                            saveTtsVolume(v); // 记住音量（跨书 / 跨音源）
                        } else {
                            svc.setPitch(v);
                        }
                    },
                });
                continue;
            }
            if (g.voiceGroups?.length) {
                // 🔴 #351e 用户口径：语音 / 音色也改成**下拉选择器**；原有分组（中文 → 英语 → 其它 /
                //    男声 → 女声）用 `<optgroup>` 保留 —— 分组是挑音色时最有用的信息，不能因为换控件丢掉。
                const box = wrap.createDiv({ cls: "rl-reader-pop-select-row" });
                const sel = box.createEl("select", { cls: "rl-reader-pop-select" });
                let curVoice = "";
                for (const vg of g.voiceGroups) {
                    const og = sel.createEl("optgroup", { attr: { label: vg.label } });
                    for (const it of vg.items) {
                        og.createEl("option", { text: it.label, attr: { value: it.value } });
                        if (it.on) curVoice = it.value;
                    }
                }
                sel.value = curVoice;
                // 试听从「每项一个 ▶」收成一个按钮：读**当前选中**那个（#343 的试听能力保留）
                const tryBtn = box.createEl("button", { cls: "rl-reader-pop-try", attr: { type: "button", "aria-label": "试听" } });
                setIcon(tryBtn, "play");
                tryBtn.setAttribute("data-tip", "试听当前音色");
                tryBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    svc.previewVoice(sel.value);
                });
                sel.addEventListener("change", () => {
                    svc.setVoice(sel.value);
                    // 🔴 按音源分别记：系统 voiceURI 与云音色全称不是同一个 id 空间
                    if (svc.engineKind === "cloud") saveCloudVoice(sel.value);
                    else saveVoiceUri(sel.value);
                    // ⚠️ 不再 closePop()：原来是「每项一个按钮、点完就收」；改成下拉后**留在原地**更顺手 ——
                    //    换完音色可以接着点「试听」或拖语速（同一块面板里一次调完）。
                });
            }
        }
        // 快捷键小字（#351 用户口径：[空格: 暂停/播放]）
        const hint = wrap.createDiv({ cls: "rl-reader-pop-hint" });
        hint.createDiv({ text: "空格：暂停 / 播放" });
    }

    /**
     * 弹窗里切音源（#344 用户裁定「弹窗里也能切」）。
     * 🔴 走 `setEngineKind` = restart 口径：在朗读则**从当前句用新引擎续读**，按钮不灭、位置不丢；
     *    切完装上**该音源自己的**记忆音色（没有记忆就用该音源的缺省），避免拿上一个音源的 id 串味。
     */
    private switchEngine(kind: TtsEngineKind): void {
        const svc = this.ttsSvc;
        if (!svc) return;
        if (kind !== svc.engineKind) {
            if (!svc.setEngineKind(kind)) {
                new Notice(
                    kind === "cloud"
                        ? "云合成不可用：请先到 设置 → AI集成 › API凭据 · 硅基流动 填写 Key"
                        : "当前环境不支持系统语音",
                    5000,
                );
                return;
            }
            svc.setVoice(kind === "cloud" ? loadCloudVoice() : loadVoiceUri());
            saveTtsEngine(kind);
            this.syncTtsAvailability();
        }
        this.closePop();
    }

    /** 朗读弹窗里的一行滑条（语速 / 音调共用）：拖动只改值文本，松手才落到服务 */
    private mkTtsSlider(
        wrap: HTMLElement,
        o: {
            slider: { min: number; max: number; step: number; value: number };
            label: (v: number) => string;
            tip: string;
            apply: (v: number) => void;
        },
    ): void {
        const line = wrap.createDiv({ cls: "rl-reader-menu-row" });
        const slider = line.createEl("input", {
            cls: "rl-reader-menu-slider",
            attr: {
                type: "range",
                min: String(o.slider.min),
                max: String(o.slider.max),
                step: String(o.slider.step),
                value: String(o.slider.value),
                "data-tip": o.tip,
            },
        });
        const val = line.createSpan({ cls: "rl-reader-menu-val", text: o.label(o.slider.value) });
        slider.addEventListener("input", () => val.setText(o.label(Number(slider.value))));
        slider.addEventListener("change", () => {
            const v = Number(slider.value);
            o.apply(v);
            val.setText(o.label(v));
        });
    }

    /**
     * 右键弹窗：自动推进的**速度**（#341 建立；#342 起**两行恒在**）。
     * 🔴 两行都给（用户 #342：「加个翻页模式下自动翻页的间隔秒数」）—— 不论当前是滚动还是翻页模式都能调，
     *   免得出现「切到某个模式才看得见」的「找不着」。两行生效方式不同：
     *   滚动速度**按帧读取 ⇒ 立即生效**；翻页间隔在定时器里 ⇒ 改完要 `restartAutoIfOn()` 重建。
     */
    private openAutoMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.autoBtnEl;
        if (!btn) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
        // #351 用户口径：**翻页间隔在前、滚动速度在后**（当前模式那一条先看到）
        this.mkAutoSlider(wrap, {
            title: "翻页间隔",
            min: AUTO_TURN_MIN_MS,
            max: AUTO_TURN_MAX_MS,
            step: AUTO_TURN_STEP_MS,
            value: this.autoTurnMs,
            tip: "拖动调整自动翻页间隔（键盘 ←/→ 微调；翻页模式使用）",
            label: autoTurnLabel,
            apply: (v) => {
                this.autoTurnMs = clampAutoTurnMs(v);
                if (this.autoOn && this.isPaged()) this.restartAutoIfOn(); // 定时器要按新间隔重建才生效
                return this.autoTurnMs;
            },
        });
        this.mkAutoSlider(wrap, {
            title: "滚动速度",
            min: AUTO_SCROLL_MIN,
            max: AUTO_SCROLL_MAX,
            step: AUTO_SCROLL_STEP,
            value: this.autoScrollPx,
            tip: "拖动调整自动滚动速度（键盘 ←/→ 微调；滚动模式使用）",
            // 🔴 速度文案按**当前字号**换算成「字/分」（#351 用户口径）；字号变了字/分跟着变，但 px/s 真源不动
            label: (v) => autoSpeedLabel(v, this.currentFontPx()),
            apply: (v) => {
                this.autoScrollPx = clampAutoScrollPx(v);
                saveAutoScrollPx(this.autoScrollPx); // 按帧读取 ⇒ 立刻生效，无需重启
                return this.autoScrollPx;
            },
        });
        // 快捷键小字（#351）：浮层里当下的键位提示
        const hint = wrap.createDiv({ cls: 'rl-reader-pop-hint' });
        hint.createDiv({ text: '↑↓：调速，不打断当前滚动' });
        hint.createDiv({ text: '空格：暂停 / 继续' });
    }

    /** 自动调速弹窗里的一行（标题 + 横向滑条 + 值文本；拖动只改值文本，松手才落库/生效） */
    private mkAutoSlider(
        wrap: HTMLElement,
        o: {
            title: string;
            min: number;
            max: number;
            step: number;
            value: number;
            tip: string;
            label: (v: number) => string;
            apply: (v: number) => number;
        },
    ): void {
        wrap.createDiv({ cls: "rl-reader-pop-title", text: o.title });
        const line = wrap.createDiv({ cls: "rl-reader-menu-row" });
        const slider = line.createEl("input", {
            cls: "rl-reader-menu-slider",
            attr: {
                type: "range",
                min: String(o.min),
                max: String(o.max),
                step: String(o.step),
                value: String(o.value),
                "data-tip": o.tip,
            },
        });
        const val = line.createSpan({ cls: "rl-reader-menu-val", text: o.label(o.value) });
        slider.addEventListener("input", () => val.setText(o.label(Number(slider.value))));
        slider.addEventListener("change", () => val.setText(o.label(o.apply(Number(slider.value)))));
    }

    /** 开一个按钮右键弹窗（挂在按钮所在行下方；两个弹窗互斥 —— 先收旧的） */
    private openPop(btn: HTMLButtonElement): HTMLDivElement | null {
        this.closePop();
        const row = btn.parentElement as HTMLElement | null;
        if (!row) return null;
        const wrap = row.createDiv({ cls: "rl-reader-pop" });
        // 🔴 #351e 修（#351 搬按钮时漏掉的配套）：浮层里的交互（下拉 / 试听 / 滑条）**必须自己挡住 mousedown**，
        //    否则 document 的 onDocMouseDown 会先把浮层 remove 掉 ⇒ mousedown 与 mouseup 之间目标被换掉，
        //    浏览器把 click 派发到两者的最近公共祖先（= 谁都不是），于是「点了一点反应都没有」。
        //    ⚠️ 老版浮层挂在**设置菜单**里，是被 `menu` 的 mousedown 挡板顺带保护着的；#351 把按钮搬到
        //    `.rl-reader-fops` 后就没人挡了 —— 换成 `<select>` 更会直接致命（原生下拉会被立刻关掉）。
        wrap.addEventListener("mousedown", (ev) => ev.stopPropagation());
        // 🔴 #351b 修：底栏图标组（`.rl-reader-fops`）是容器的**最后一行**，浮层若照旧向下开
        //    （`top: calc(100% + 4px)`，包含块 = `.rl-reader-footer`）会落到容器外/视口外 ⇒
        //    用户观感就是「右键没反应」。这一处必须**向上**开（`.rl-reader-pop-up`，配 `.rl-reader-fops { position: relative }`）。
        if (row.hasClass("rl-reader-fops")) wrap.addClass("rl-reader-pop-up");
        this.popEl = wrap;
        return wrap;
    }

    /** 收起按钮右键弹窗（外部 mousedown / 选完项） */
    private closePop(): void {
        this.popEl?.remove();
        this.popEl = null;
    }

    /** 设置下拉开合切换：加/去 hidden + 按钮 active 态；打开时同步当前字号/行距/全屏文案 */
    private toggleSettings(): void {
        if (!this.menuEl) return;
        // ≡ mousedown 已 stopPropagation（防 doc 先收起导致 toggle 反相），故这里显式收起可能残留的选中动作条
        this.hideSelbar();
        this.hideMore();
        this.settingsOpen = !this.settingsOpen;
        this.menuEl.toggleClass('hidden', !this.settingsOpen);
        this.settingsBtn?.toggleClass('active', this.settingsOpen);
        if (this.settingsOpen) {
            this.syncSettingsLabels();
            this.syncSegLabels();
            this.syncThemeSwatches();
            this.syncViewBtns();
        }
    }

    /** 收起设置下拉（外部 mousedown / 视情况调用）；未开则跳过 */
    private hideMenu(): void {
        if (!this.settingsOpen) return;
        this.settingsOpen = false;
        this.menuEl?.addClass('hidden');
        this.settingsBtn?.removeClass('active');
    }

    /** 刷新菜单字号 / 行距的当前值文本与滑条位置（打开菜单、调整后调用） */
    private syncSettingsLabels(): void {
        const px = this.currentFontPx();
        const lh = Math.round(this.currentLineHeight() * 100) / 100;
        if (this.menuFontVal) this.menuFontVal.setText(`${px}px`);
        if (this.menuLineVal) this.menuLineVal.setText(`${lh}`);
        // 滑条与真源对齐：键盘 +/− 走的是同一套 apply*，滑条必须跟着动
        if (this.menuFontSlider) this.menuFontSlider.value = String(px);
        if (this.menuLineSlider) this.menuLineSlider.value = String(lh);
        // 字距（#351）：值文本 + 滑条回位（同上口径）
        if (this.letterVal) this.letterVal.setText(formatLetterSpacing(this.letterSpacing));
        if (this.letterSlider) this.letterSlider.value = String(this.letterSpacing);
    }

    /** 同步三个分段控制器（阅读模式 / 行宽 / 缩进）—— 打开菜单、改设置后调用（#351） */
    private syncSegLabels(): void {
        this.syncSegItems(this.modeSeg, this.mode);
        this.syncSegItems(this.widthSeg, this.lineWidth);
        this.syncSegItems(this.indentSeg, String(this.indent));
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

    // ── 高亮样式/颜色（用户 2026-09-16 十五轮，按参考图重做）：A 样式预览 + 五色圆点 + 垃圾桶 ──

    /** 构建样式选择器浮层（懒建一次；挂在动作条同一父级） */
    private buildHlPicker(): HTMLDivElement | null {
        if (this.hlPickerEl) return this.hlPickerEl;
        const parent = this.selbarParent;
        if (!parent) return null;
        const p = parent.createDiv({ cls: 'rl-hl-picker hidden' });
        p.addEventListener('mousedown', (ev) => ev.stopPropagation());
        // 样式：字母 A 按该样式预览（高亮=底色 / 划线=下划线 / 波浪=波浪线），选中档加外圈环
        const styles = p.createDiv({ cls: 'rl-hl-styles' });
        for (const st of HL_STYLES) {
            const b = styles.createEl('button', {
                cls: 'rl-hl-style',
                attr: { type: 'button', 'data-style': st.id, 'data-tip': st.label },
            });
            b.createSpan({ cls: 'rl-hl-a', text: 'A' });
            b.createSpan({ cls: 'rl-sr', text: st.label });
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => void this.pickHlStyle(st.id, this.hlColor));
            this.hlStyleBtns[st.id] = b;
        }
        // 颜色：一行圆点（当前色打 ✓）
        const colors = p.createDiv({ cls: 'rl-hl-colors' });
        for (const co of HL_COLORS) {
            const d = colors.createEl('button', {
                cls: 'rl-hl-color',
                attr: { type: 'button', 'data-color': co.id, 'data-tip': `${co.label}色` },
            });
            d.addEventListener('mousedown', (ev) => ev.stopPropagation());
            d.addEventListener('click', () => void this.pickHlStyle(this.hlStyle, co.id));
            this.hlColorBtns[co.id] = d;
        }
        // 垃圾桶：仅当选区命中已有高亮/摘抄时可删（用户 2026-09-16 选定「搬进浮层」）
        const trash = p.createEl('button', { cls: 'rl-hl-trash hidden', attr: { type: 'button', 'data-tip': '删除该段摘抄/高亮' } });
        safeSetIcon(trash, 'trash-2');
        trash.addEventListener('mousedown', (ev) => ev.stopPropagation());
        trash.addEventListener('click', () => void this.trashSelection());
        this.hlTrashBtn = trash;
        this.hlPickerEl = p;
        return p;
    }

    /** 浮出选择器（默认贴在动作条上方，当前档打勾）。
     *  anchor = 宿主 client 坐标（顶栏「选中即高亮」模式动作条不在场 → 以鼠标位置为锚点，否则色板无处可贴）。 */
    private showHlPicker(anchor: { x: number; y: number } | null = null): void {
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
                // 鼠标锚点：水平居中于指针，优先贴选区上方，放不下转下方
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

    private hideHlPicker(): void {
        this.hlPickerEl?.addClass('hidden');
        this.hlPickerAnchor = null;
    }

    /** 选定样式或颜色：改「刚建/目标那条」高亮（删旧 + 按新样式重写）+ 记为下次默认 */
    private async pickHlStyle(style: HlStyle, color: HlColor): Promise<void> {
        this.hlStyle = style;
        this.hlColor = color;
        this.options.onSettingsChange?.({
            fontSize: this.currentFontPx(),
            lineHeight: this.currentLineHeight(),
            hlStyle: style,
            hlColor: color,
        });
        const id = this.hlPickerTargetId;
        if (!id) return;
        const rec = this.highlightList.find((h) => h.id === id);
        this.hlPickerTargetId = null;
        if (!rec) return;
        const loc = rec.loc ?? this.currentLoc();
        const recId = rec.id;
        if (!recId) return;
        // 🔴 本方法是「改写这一条的样式/颜色」→ 必须先删旧块再写新块。
        //    只写不删会在笔记里叠出多条同选段高亮（用户 2026-09-17 实测「点一次出两条」）。
        //    走不弹确认的直删通道（与浮层垃圾桶同一条），不用会弹窗的删除入口。
        if (!this.options.onTrashSelection) {
            new Notice('当前阅读器不支持改写高亮样式，请先删除该高亮再重新标注');
            return;
        }
        try {
            // 返回 0 = 笔记里已无该块（本地列表过期）→ 照常继续写新块
            // { quiet: true }：这一步是改样式的中间步骤，不该单独报「已删除 N 条」——
            // 改样式是**一次用户动作**，只在该方法末尾报一条（用户 2026-09-18 报「弹三条提示」）。
            await this.options.onTrashSelection({ highlightIds: [recId], excerptIds: [] }, { quiet: true });
        } catch (err) {
            new Notice(`改写高亮失败：${err instanceof Error ? err.message : String(err)}`);
            this.hlPickerTargetId = recId;
            return;
        }
        this.highlightList = this.highlightList.filter((h) => h.id !== recId);
        // 同样静默：新块由本方法末尾一条提示统一代表（写失败时 doHighlight 已自行 Notice，返回 null → 不再报「已更新」）
        const newId = await this.doHighlight(rec.quote, loc.chapter, loc.pct, style, color, true);
        if (!newId) return;
        // 重写后是新块 id → 让后续改动能继续命中同一条
        this.hlPickerTargetId = newId;
        this.hlTrashReady = Boolean(this.hlPickerTargetId);
        this.showHlPicker(this.hlPickerAnchor);
        // ⚠️ 选完一次样式**也不收起**（用户 2026-09-17 改口径：可继续换档/换色比对，改样式走
        //    「先删旧再写新」无副作用）——色板与动作条统一等「点正文其他区域」由
        //    onDocMouseDown → hideSelbar（内含 hideHlPicker）收起。
        new Notice('已更新高亮样式');
    }

    /** 浮层垃圾桶：删掉选区对应的高亮与摘抄（用户 2026-09-16 选定「不弹确认」） */
    private async trashSelection(): Promise<void> {
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
            const doc = this.frameEl.contentDocument;
            if (doc) this.applyHighlights(doc);
            this.refreshHighlightToc();
        }
        this.hlPickerTargetId = null;
        this.hlTrashReady = false;
        this.hideSelbar();
        this.hideHlPicker();
    }
    /** 设定首行缩进（排版分段：首行 / 齐头）：亮起态**先**重绘 → 应用 → 写回设置（#351） */
    private setIndent(on: boolean): void {
        this.indent = on;
        this.syncSegItems(this.indentSeg, String(on));
        this.applyIndent();
        this.options.onSettingsChange?.({
            fontSize: this.currentFontPx(),
            lineHeight: this.currentLineHeight(),
            indent: on,
        });
        requestAnimationFrame(() => this.syncSegItems(this.indentSeg, String(on)));
    }

    /** 切换首行缩进（键盘等旧调用点） */
    private toggleIndent(): void {
        this.setIndent(!this.indent);
    }

    /** 应用首行缩进：EPUB 正文在 iframe（独立文档，不继承容器类）→ 走 refreshTheme 重建注入样式 */
    private applyIndent(): void {
        this.refreshTheme();
    }

    /** 切换阅读主题（菜单色卡）：换肤 + iframe 注入样式重建 + 色卡选中态 + 写回设置持久化 */
    private setTheme(t: ReaderThemeId): void {
        this.theme = t;
        this.applyTheme();
        this.syncThemeSwatches();
        // 正文在 iframe 里（独立文档，不继承容器 CSS 变量）→ 必须重建注入样式才换色
        this.refreshTheme();
        this.options.onThemeChange?.(t);
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
        // body 参与 html 列流：清居中限制与列样式残留，避免干扰
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
        if (this.chapterIndex < this.options.book.chapters.length - 1) {
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
            this.switchToPrevChapterLast();
        } else {
            new Notice('已是第一页');
        }
    }

    /** 滚动模式翻一屏：iframe 内按可视高滚动（留 24px 重叠）；滚到底仍由触底自动翻章接管 */
    private scrollOneScreen(dir: 1 | -1): void {
        const sc = this.frameScroller();
        if (!sc) return;
        const step = Math.max(60, this.frameEl.clientHeight - 24);
        // ⚠️ 同 TXT：animateScrollTo 动画 scrollLeft → 纵向翻屏必须显式 scrollTo({top, behavior:'smooth'})
        const top = sc.scrollTop + dir * step;
        try {
            sc.scrollTo({ top, behavior: 'smooth' });
        } catch {
            sc.scrollTop = top;
        }
    }

    /** 切换滚动模式（下拉）：更新 mode + 重建当前章（applyLayout/buildFrameDoc 分支），写回设置 */
    private setMode(m: ScrollMode): void {
        // 单选语义（用户 2026-09-15）：点已选项只重绘勾选，避免原生 checkbox 被取消后两项皆空
        if (m === this.mode) {
            this.syncSegItems(this.modeSeg, this.mode);
            return;
        }
        const keepRatio = this.currentRatio();
        this.mode = m;
        // 勾选**先于一切副作用**重绘，且不设「菜单是否打开」前置条件（2026-09-16 修：原先写在宿主回调之后
        // 且带 settingsOpen 门，中途任何一步出偏差（回调抛错 / 菜单标志不同步）都会让勾选停在上一次状态）；
        // 下一帧再兜底校正一次，防浏览器默认激发行为在事件末尾翻转 checked。
        this.syncSegItems(this.modeSeg, this.mode);
        this.options.onScrollModeChange?.(m);
        requestAnimationFrame(() => this.syncSegItems(this.modeSeg, this.mode));
        // 重建当前章：renderChapter 会用新 mode 生成 srcdoc（翻页=单列 columns 样式），载入后按原比例对页
        this.jumpRatio = keepRatio;
        this.renderChapter();
        // 自动推进按模式分派：切换后重启（滚动用 rAF、翻页用定时器）
        this.restartAutoIfOn();
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

    /** 沉浸模式（用户 2026-09-15）：隐藏上下边栏；鼠标靠近顶部/底部边缘临时唤出；再点按钮退出 */
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
            const doc = this.frameEl.contentDocument;
            if (!doc) return;
            this.setupPagedLayout(doc);
            this.goToPage(ratioToPage(ratio, this.totalPages), false);
            this.updateProgress();
        });
    }

    /** 沉浸模式：点击正文空白 = 收起 / 展开上下边栏（用户 2026-09-15 裁定，替代原「鼠标移到边缘唤出」；非沉浸态跳过） */
    private toggleBars(): void {
        if (!this.immersive || !this.headEl) return;
        if (this.headEl.hasClass("hidden")) {
            this.headEl.removeClass("hidden");
            this.footEl?.addClass("rl-foot-show");
        } else {
            this.headEl.addClass("hidden");
            this.footEl?.removeClass("rl-foot-show");
            this.hideMenu(); // 顶栏收起时一并收起设置下拉，防菜单悬在空中
        }
    }

    /**
     * iframe 内点击正文：① #355 把**被点段落**设为朗读起读点（点哪儿听哪儿）；
     * ② 沉浸模式下再顺带切换上下边栏（用户 2026-09-15 裁定；点链接 / 有选区时不动作）。
     * frame 事件不冒泡到宿主 ⇒ 监听挂在 onFrameLoad 里（每章 srcdoc 重建后重挂）。
     * 🔴 顺序要紧：起读点判断必须在 `immersive` 门**之前** —— 否则非沉浸态下点段落毫无反应。
     */
    private onFrameClick = (ev: MouseEvent): void => {
        const target = ev.target as HTMLElement | null;
        if (target?.closest?.('a')) return;
        const sel = this.frameEl.contentDocument?.getSelection?.();
        if (sel && sel.toString().trim()) return;
        this.ttsSvc?.anchorAt(target);
        if (!this.immersive) return;
        this.toggleBars();
    };

    /** 自动推进期间用户手动滚动/触摸 → 停自动（避免与自动滚动打架） */
    private onUserInterrupt = (): void => {
        if (!this.autoOn) return;
        this.stopAuto();
        this.syncViewBtns();
    };

    /** 打开/关闭自动推进（用户 2026-09-15）：滚动模式匀速自动滚动；翻页模式定时自动翻页 */
    private setAuto(on: boolean): void {
        if (on === this.autoOn) return;
        this.stopAuto();
        if (on) {
            this.autoOn = true;
            if (this.isPaged()) this.startAutoTimer();
            else this.startAutoScroll();
        }
        // 🔴 #351b 修：同上 —— 自动按钮也在底栏，高亮同步不能再看面板开没开
        this.syncViewBtns();
    }

    /** 模式切换后重启自动推进（滚动用 rAF、翻页用定时器，两条实现不同） */
    private restartAutoIfOn(): void {
        if (!this.autoOn) return;
        this.stopAuto();
        this.autoOn = true;
        if (this.isPaged()) this.startAutoTimer();
        else this.startAutoScroll();
    }

    /** 开始自动滚动（rAF + 时间增量推进；按 `autoScrollPx`（#341 可调）匀速连续；到底由既有触底自动翻章接管） */
    private startAutoScroll(): void {
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
        const sc = this.frameScroller();
        const lastChapter = this.chapterIndex >= this.options.book.chapters.length - 1;
        if (!this.restoring && sc && dt > 0) {
            const max = sc.scrollHeight - this.frameEl.clientHeight;
            // #342：位置由**自己累积**（`advanceAutoPos`），⛔ 不能读回 `scrollTop` 再相加 ——
            //   `scrollTop` 写入被浏览器取整：120Hz 上 50px/s 每帧 0.417px ⇒ 被吸成 0 ⇒ 完全不动；
            //   60Hz 上 0.83px 又被抬成 1px ⇒ 实际超速 20%。偏差 > 2px 视为「外部挪过位置」→ 重新对表。
            const real = sc.scrollTop;
            if (this.autoPos === null || Math.abs(real - this.autoPos) > 2) this.autoPos = real;
            const next = advanceAutoPos(this.autoPos, this.autoScrollPx, dt, max);
            this.autoPos = next;
            if (max > 0 && next < max - 0.5) {
                sc.scrollTop = next;
            } else if (lastChapter && (max <= 0 || next >= max - 0.5)) {
                this.stopAuto();
                this.syncViewBtns();
                new Notice("已读完全书");
                return;
            }
        }
        this.autoRaf = requestAnimationFrame(this.autoTick);
    };

    /** 开始自动翻页（定时 goNextPage；到全书末页自动停） */
    private startAutoTimer(): void {
        if (this.autoTimer !== null) return;
        this.autoTimer = window.setInterval(() => this.autoTurnTick(), this.autoTurnMs);
    }

    /** 自动翻页一拍：全书末页 → 停并提示；否则翻下一页（翻页模式一页 / 滚动模式一屏） */
    private autoTurnTick(): void {
        if (!this.autoOn) return;
        const lastChapter = this.chapterIndex >= this.options.book.chapters.length - 1;
        if (lastChapter && isLastPage(this.pageIndex, this.totalPages)) {
            this.stopAuto();
            this.syncViewBtns();
            new Notice("已读完全书");
            return;
        }
        this.goNextPage();
    }

    /** 停止自动推进（关自动 / 销毁时调用）：清 rAF 与定时器 + 复位开关 */
    private stopAuto(): void {
        this.autoOn = false;
        this.autoPos = null; // #342：下次开自动重新与真实位置对表
        if (this.autoRaf !== null) {
            window.cancelAnimationFrame(this.autoRaf);
            this.autoRaf = null;
        }
        if (this.autoTimer !== null) {
            window.clearInterval(this.autoTimer);
            this.autoTimer = null;
        }
    }

    // ── 构建：底部工具条 ──

    /**
     * 构建底部工具条（用户 2026-09-21 象形稿定案，与 TXT 阅读器同一套）：
     *   `[«] [‹]  章节名… ━━━ 已读 29%  [⛶] [👁] [⏱] [🔊]  [›] [»]`
     * 🔴 结构必须与 TxtReaderModal.buildFooter **逐字对齐**（含注释口径）—— 两阅读器底栏是同一件东西，
     *    只差内容来源；改一边不改另一边正是「两处漂移」的老坑（本项目已由断言钉死两处计数相等）。
     */
    private buildFooter(): void {
        // 底栏挂到右侧栏（.rl-reader-main）内 —— 目录栏独立成一整列，底栏不再横跨到目录下方
        const mainCol = this.frameEl?.closest('.rl-reader-main') as HTMLElement | null;
        const footer = (mainCol ?? this.container).createDiv({ cls: 'rl-reader-footer' });
        this.footEl = footer;

        // ① 左端翻页组：上一章 / 上一页
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

        // ③ 高频操作（#351 用户口径）：点击即时生效 + 图标高亮；自动 / 朗读 右键开各自浮层
        const fops = footer.createDiv({ cls: 'rl-reader-fops' });
        const mkFop = (icon: string, tip: string, onClick: () => void): HTMLButtonElement => {
            const b = fops.createEl('button', { cls: 'rl-btn rl-reader-btn' });
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', tip);
            b.addEventListener('click', onClick);
            return b;
        };
        this.fsBtnEl = mkFop('maximize', '全屏显示', () => this.toggleFullscreen());
        this.immersiveBtnEl = mkFop('eye', '沉浸模式：隐藏上下边栏（鼠标移到顶部/底部可临时唤出）', () => this.setImmersive(!this.immersive));
        this.autoBtnEl = mkFop('timer', '自动滚动 / 自动翻页（按当前模式；再点停止，右键调速）', () => this.setAuto(!this.autoOn));
        this.autoBtnEl.addEventListener('contextmenu', (ev) => this.openAutoMenu(ev));
        this.ttsBtnEl = mkFop('volume-2', '从当前段落开始朗读（右键可改语速 / 音色 / 音源）', () => this.toggleTts());
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

        // 左侧目录列（复用 TXT 阅读器 rl-reader-toc 样式）：「目录 | 摘抄」两 tab
        // （用户 2026-09-17 裁定：书签并入摘抄栏，栏内顺序 书签 → 高亮 → 摘抄）
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '章节目录' } });
        safeSetIcon(tocTab, 'list-tree');
        const exTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签 / 高亮 / 摘抄' } });
        safeSetIcon(exTab, 'quote');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        this.tocEntries = this.options.book.toc;
        // href（去 #fragment）→ 章节索引，目录点击定位章节
        const byPath = new Map<string, number>();
        this.options.book.chapters.forEach((c, i) => byPath.set(c, i));
        // 每条目录的字数（#338；#345 改「阅读量单位」口径：中文按字、英文按词）：
        // fileMap 打开时已在内存，按 toc 逐条算（锚点分段 / 缺失不显示）。
        // ⚠️ 只计数、不把 segmenter 迭代器 spread 成数组；counter 复用同一个 segmenter。
        const countUnits = createReadingUnitCounter();
        const tocChars = epubTocCharCounts(this.options.book, this.options.fileMap, (html) =>
            countUnits(xhtmlToText(html)),
        );
        this.tocEntries.forEach((t, i) => {
            const item = this.tocListEl.createEl('button', { cls: 'rl-reader-toc-item', attr: { 'data-tip': t.label } });
            item.createSpan({ cls: 'rl-reader-toc-label', text: t.label });
            const n = tocChars[i];
            if (n !== undefined) item.createSpan({ cls: 'rl-reader-toc-chars', text: formatCharCount(n) });
            item.addEventListener('click', () => {
                const idx = byPath.get(t.href.split('#')[0]);
                if (idx !== undefined) this.switchChapter(idx);
            });
        });
        // 目录侧栏可拖宽（#338：为显示字数；记忆宽度在 localStorage，拖动期间关掉宽度过渡）
        attachTocResizer(this.tocEl);
        // 标注 pane（原「摘抄」页）：书签 / 高亮 / 摘抄三区上下叠放，各区自带「计数 + 选择」头
        // （#345 用户裁定：「清除全部」这种不可逆的一键清空改为**选择模式** —— 能看见具体条目、
        //   可勾选单条或多条后「删除所选」。三区结构同构，共用 pure/annoSelection.buildAnnoHead。）
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        // Ⅰ 书签区：列表填充 .rl-reader-bm-empty / .rl-reader-bm-item（点击定位 / 右键删除）
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
        // Ⅲ 摘抄区（与高亮区同款分区头 + 上分隔线 → 三区各成一栏）
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
        this.refreshHighlightToc();
        this.buildExcerptToc();
        tocTab.addEventListener('click', () => this.activatePane('toc'));
        exTab.addEventListener('click', () => this.activatePane('ex'));

        // 右侧 iframe 渲染区（srcdoc = 章节 HTML + 注入基础 CSS）
        // 右侧栏：正文 + 底栏同处一栏（目录栏因而独立成一整列，用户 2026-09-16）
        const mainCol = body.createDiv({ cls: 'rl-reader-main' });
        const frameWrap = mainCol.createDiv({ cls: 'rl-reader-frame' });
        // sandbox 仅 allow-same-origin：禁脚本防 EPUB 恶意 JS，同时保留同源访问 contentDocument
        this.frameEl = frameWrap.createEl('iframe', { attr: { sandbox: 'allow-same-origin' } });

        // 选中动作条（初始隐藏；摘录入口由「❝ 摘抄」按钮接管，不再选中即弹）
        this.selbar = this.buildSelbar();
        body.appendChild(this.selbar);
    }

    // ── 选中动作条（T5，iframe 适配） ──

    /** 构建选中动作条：纯图标按钮（书签 / 摘抄 / 高亮 / 翻译）——图标与顶栏快捷入口一致（用户 2026-09-15 裁定） */
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
        // 高亮：一键即黄即记（写阅读数据存档 + 页内持久 mark，iframe 内标黄）
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
        // 选区此刻还在 → 顺手记下它落在哪条高亮 mark 上（垃圾桶显隐 + 删除定位都用它；点按钮时选区已被清）
        this.selRecord = { text, chapter: loc.chapter, pct: loc.pct, mark: this.selMarkTarget() };
        this.syncSelbarHlTip(text);
        this.showSelbarAt(frameRect.left + ev.clientX, frameRect.top + ev.clientY);
    }

    /** 标注模式锁分派（EPUB）：坐标已换算到宿主 client）；高亮/摘抄/翻译各自触发后清 iframe 选区 */
    private dispatchAnnotate(text: string, loc: { chapter: number; pct: number }, clientX: number, clientY: number): void {
        const mode = this.annotateMode;
        this.hideSelbar();
        if (mode === 'highlighter') {
            // 传鼠标位置作色板锚点（坐标已是宿主 client）：该模式下动作条不在场（也不该出现）
            void this.highlightFromMode(text, loc, { x: clientX, y: clientY });
            this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        } else if (mode === 'quote') {
            // 就地摘抄卡片：顶栏「摘抄」模式动作条不在场 → 以鼠标位置为锚点（坐标已是宿主 client）
            this.showExcerptCard(text, { chapter: loc.chapter, pct: loc.pct }, { x: clientX, y: clientY });
            this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        } else if (mode === 'netsearch') {
            // 网络搜索：弹引擎浮层。🔴 **不清浏览器选区** —— 用户要求「选中保持高亮」
            this.showNetPanel(text, { x: clientX, y: clientY });
        } else if (mode === 'aisearch') {
            // AI 搜索：弹 AI 卡。同样**不清选区**（选中保持高亮）
            this.showSearchCard(text, { x: clientX, y: clientY });
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

    /**
     * 顶栏「高亮」模式（选中即高亮）：新增成功后浮出样式色板，与「点动作条高亮」同款可选样式行为
     * （用户 2026-09-17 裁定）。不弹图标动作条 —— 该模式本就是「选中即走」，动作条会打断连续标注；
     * 色板以鼠标位置为锚点，**选完样式也不收**，点正文其他区域才收。
     */
    private async highlightFromMode(text: string, loc: { chapter: number; pct: number }, anchor: { x: number; y: number } | null): Promise<void> {
        const before = this.highlightList.length;
        await this.toggleHighlight(text, loc);
        const added = this.highlightList.length > before ? this.highlightList[this.highlightList.length - 1] : null;
        if (!added?.id) return; // 取消高亮 / 新增失败：不动浮层
        this.hlTrashReady = true;
        this.hlPickerTargetId = added.id;
        this.showHlPicker(anchor);
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
        this.hideHlPicker();
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

    /** 动作条「❝ 摘抄」：收起动作条 → 就地弹出摘抄卡片（在卡里写想法，Enter 保存）；无回调则提示 */
    private addSelExcerpt(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        // 动作条收起前取它的位置作卡片锚点（client 坐标 → 卡片落在刚点的按钮上方）
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showExcerptCard(rec.text, { chapter: rec.chapter, pct: rec.pct }, anchor);
    }

    // ── 摘抄就地卡片（用户 2026-09-17 裁定 C 方案：划词就地写、不打断阅读） ──

    /** 动作条当前位置（宿主 client 坐标）：作卡片锚点；动作条未定位过 → null（卡片退回容器中部） */
    private selbarAnchorClient(): { x: number; y: number } | null {
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!bar || !parent) return null;
        const left = parseFloat(bar.style.left);
        const top = parseFloat(bar.style.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        const pRect = parent.getBoundingClientRect();
        return { x: pRect.left + left + (bar.offsetWidth || 0) / 2, y: pRect.top + top + bar.offsetHeight };
    }

    /** 懒建摘抄卡片（挂动作条同一父级=宿主文档；卡片自身 mousedown 不冒泡 → 点卡内不触发 onDocMouseDown） */
    private buildExcerptCard(): HTMLDivElement | null {
        if (this.excerptCard) return this.excerptCard;
        const parent = this.selbarParent;
        if (!parent) return null;
        const card = parent.createDiv({ cls: 'rl-excard hidden' });
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        const head = card.createDiv({ cls: 'rl-excard-head' });
        head.createDiv({ cls: 'rl-excard-title', text: '添加摘抄' });
        this.excerptLocEl = head.createDiv({ cls: 'rl-excard-loc' });
        const body = card.createDiv({ cls: 'rl-excard-body' });
        this.excerptQuoteEl = body.createDiv({ cls: 'rl-excard-quote' });
        // 引用默认收起（CSS max-height），超阈值才给「展开 / 收起」
        const more = body.createEl('button', { cls: 'rl-excard-more hidden', attr: { type: 'button' }, text: '展开' });
        more.addEventListener('click', () => {
            const q = this.excerptQuoteEl;
            if (!q) return;
            const open = !q.hasClass('is-open');
            q.toggleClass('is-open', open);
            more.setText(open ? '收起' : '展开');
        });
        this.excerptMoreBtn = more;
        const noteField = body.createDiv({ cls: 'rl-excard-field' });
        noteField.createDiv({ cls: 'rl-excard-label', text: '想法（可选，支持 [[双链]]）' });
        const note = noteField.createEl('textarea', {
            cls: 'rl-excard-note',
            attr: { rows: '3', placeholder: '写下此刻的想法…（可留空）' },
        });
        // 🔴 Ctrl / ⌘ + Enter 保存；单独 Enter 与 Shift+Enter 一律留给换行（想法多为多行）。
        // 输入法组合态不提交（中文选词的 Enter 不是命令）
        note.addEventListener('keydown', (ev) => {
            const action = excerptCardKeyAction({
                key: ev.key,
                ctrlKey: ev.ctrlKey,
                metaKey: ev.metaKey,
                composing: ev.isComposing || ev.keyCode === 229,
            });
            if (action !== 'submit') return;
            ev.preventDefault();
            void this.submitExcerptCard();
        });
        this.excerptNoteEl = note;
        const foot = card.createDiv({ cls: 'rl-excard-foot' });
        const cancel = foot.createEl('button', { cls: 'rl-excard-btn', attr: { type: 'button' }, text: '取消' });
        cancel.addEventListener('click', () => this.hideExcerptCard());
        const save = foot.createEl('button', { cls: 'rl-excard-btn rl-excard-save', attr: { type: 'button', 'data-tip': '保存摘抄（Ctrl / ⌘ + Enter）' }, text: '保存摘抄' });
        save.addEventListener('click', () => void this.submitExcerptCard());
        this.excerptSaveBtn = save;
        this.excerptCard = card;
        return card;
    }

    /** 就地弹出摘抄卡片（anchor = 宿主 client 坐标；Enter 保存、Esc / 点正文其他区域取消） */
    private showExcerptCard(quote: string, loc: { chapter: number; pct: number }, anchor: { x: number; y: number } | null): void {
        if (!this.options.onExcerptSave) {
            new Notice('当前阅读器不支持写摘抄');
            return;
        }
        const card = this.buildExcerptCard();
        const parent = this.selbarParent;
        if (!card || !parent) return;
        this.excerptCardQuote = quote;
        this.excerptCardLoc = loc;
        this.excerptLocEl?.setText(excerptCardLocLabel(this.options.title, loc));
        this.excerptQuoteEl?.setText(quote);
        this.excerptQuoteEl?.removeClass('is-open');
        this.excerptMoreBtn?.toggleClass('hidden', !needsQuoteExpand(quote));
        this.excerptMoreBtn?.setText('展开');
        if (this.excerptNoteEl) this.excerptNoteEl.value = '';
        this.excerptSaveBtn?.removeAttribute('disabled');
        card.removeClass('hidden');
        // 定位要量卡片尺寸（hidden 时 rect 全 0）→ 摘掉 hidden 后下一帧再算
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const pos = placeCard({
                anchorX: anchor ? anchor.x - pRect.left : pRect.width / 2,
                anchorY: anchor ? anchor.y - pRect.top : pRect.height / 3,
                cardW: cRect.width,
                cardH: cRect.height,
                boxW: pRect.width,
                boxH: pRect.height,
            });
            card.style.left = `${pos.left}px`;
            card.style.top = `${pos.top}px`;
            this.excerptNoteEl?.focus();
        });
    }

    /** 收起卡片并丢弃待写入内容（Esc / 点正文其他区域 / 保存成功后） */
    private hideExcerptCard(): void {
        this.excerptCard?.addClass('hidden');
        this.excerptCardQuote = '';
        this.excerptCardLoc = null;
    }

    /** 卡片是否打开（Esc 分派用：打开时只收卡片，不关整个阅读器） */
    private isExcerptCardOpen(): boolean {
        return Boolean(this.excerptCard && !this.excerptCard.hasClass('hidden'));
    }

    /** 保存卡片内容（Enter / 点「保存摘抄」）：成功收起卡片 + 清 iframe 选区残影；失败保留输入并解禁按钮重试 */
    private async submitExcerptCard(): Promise<void> {
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
            this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
        } else {
            btn?.removeAttribute('disabled');
        }
    }

    // ── 高亮（页内持久黄标 + 阅读数据存档；笔记「## 高亮」区是存档生成的只读镜像；正文在 iframe，mark 注入 frame 文档） ──

    /** 本章高亮（loc.chapter === 当前章（1 基）） */
    private currentChapterHighlights(): ReaderHighlight[] {
        return chapterHighlights(this.highlightList, this.chapterIndex + 1);
    }

    /** 给 iframe 正文段落包本章高亮 mark（幂等）：逐段算「该写入的 HTML」→ 只在真有变化时才写回。
     *  🔴 重绘规则（含**「删掉的高亮必须当场摊平」**）在 `pure/highlight.markParagraphHtml` —— TXT 与 EPUB 共用同一份；
     *     旧实现内联在此处且「无命中 → 跳过该段」→ 删掉的高亮会继续留在 iframe 里（2026-09-18 用户报障）。
     *  p 内嵌标签时整段摊平（沿用 v1 容错）。 */
    private applyHighlights(doc: Document): void {
        const hls = this.currentChapterHighlights();
        for (const p of Array.from(doc.querySelectorAll('p'))) {
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
        this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
            // ⚠️ 不 hideSelbar：动作条要留到「二次选择样式」完成后才收（用户 2026-09-16 要求）
            this.showHlPicker();
            return;
        }
        await this.toggleHighlight(text0, { chapter: rec.chapter, pct: rec.pct });
        const added = this.highlightList.length > before ? this.highlightList[this.highlightList.length - 1] : null;
        // 动作已消费选区：只清 iframe 内选区残影，**不收起动作条**（见下）
        this.frameEl.contentWindow?.getSelection()?.removeAllRanges();
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

    /** 选段落在哪条高亮 mark 上（EPUB：正文在 iframe，取 frame 内选区）→ 垃圾桶显隐 + 删除定位；null = 没有高亮样式 */
    private selMarkTarget(): HlMarkTarget | null {
        const sel = this.frameEl?.contentWindow?.getSelection?.();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        return hlMarkTargetOf(range.startContainer, range.endContainer);
    }

    /** 动作条「高亮」按钮口径：选区已是本章高亮 → 提示改「取消高亮」（点击即删除该条） */
    private syncSelbarHlTip(text: string): void {
        const b = this.selbarHlBtn;
        if (!b) return;
        const loc = this.currentLoc();
        const hl = findSameHighlight(this.highlightList, text, loc.chapter);
        const ex = findSameExcerpt(this.options.excerpts ?? [], text, loc.chapter);
        const label = hl ? '取消高亮' : '高亮';
        b.setAttribute('data-tip', label);
        const sr = b.querySelector('.rl-sr');
        if (sr) sr.textContent = label;
        // 动作条垃圾桶（用户 2026-09-18）：只在「选中文字就是本章某条已有高亮」时露脸 —— 危险操作不做常显。
        // 动作条垃圾桶（用户 2026-09-18）：只在**选段真的落在高亮 mark 上**（= 屏幕上看得见样式）时露脸。
        // 判据取 DOM 实际样式，而非「高亮清单里文本匹配」—— 后者在「清单有记录、本段没画出标记」时会假阳性。
        const hasMark = this.selRecord?.mark != null;
        this.selbarTrashBtn?.toggleClass('hidden', !hasMark);
        // 色板垃圾桶仍在「删得掉」时出现（选区命中已有高亮或摘抄）—— 浮层打开时据此显隐
        this.hlTrashReady = Boolean(hl || ex);
    }

    /** 一键即黄即记核心：写阅读数据存档（main 侧顺带同步笔记镜像）→ 本地列表追加 → 重包当前章 mark。
     *  返回新块 id（失败 null，已自行 Notice）；`quiet` ＝ 不播报「已高亮」（改样式路径用，由调用方统一报一条）。 */
    private async doHighlight(text: string, chapter: number, pct: number, style: HlStyle = this.hlStyle, color: HlColor = this.hlColor, quiet = false): Promise<string | null> {
        if (!text || !this.options.onHighlight) {
            new Notice('当前阅读器不支持高亮');
            return null;
        }
        const id = await this.options.onHighlight(text, { chapter, pct }, style, color);
        if (!id) return null; // 失败已 Notice
        this.highlightList = [...this.highlightList, { quote: text, id, loc: { chapter, pct }, style, color }];
        const doc = this.frameEl.contentDocument;
        if (doc) this.applyHighlights(doc);
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
        } else if (dec.action === 'blocked') {
            // 命中同文本但块缺 ^hl id（老数据/手写笔记）→ 删不了也不能重复新增，提示手动处理
            new Notice('该高亮缺少标识，无法从正文取消（可重开阅读器后再试）');
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
        // 🔴 #347（用户：「书签能不能从当前段落开始记录，不然不对齐不好看」）：记录**当前段落** ——
        //    引用 = 该段文本，百分比 = 段落**起点**位置。⚠️ root / scroller 都取 iframe 内的对象（同一坐标系）。
        const sc = this.frameScroller();
        const para = currentParagraph(this.frameEl?.contentDocument?.body ?? null, sc);
        const pct = para ? paraPct(para.top, sc?.scrollHeight ?? 0) : loc.pct;
        const updated = [...this.bookmarks(), newBookmark(loc.chapter, pct, para?.text)];
        this.options.bookmarks = updated;
        this.options.onBookmarksChange?.(updated);
        this.refreshBookmarks(updated);
        new Notice(`已添加书签：第${loc.chapter}章 ${pct}%`);
    }

    /**
     * 删除**选中的**高亮（#345）：confirm 一次 → 批量删除 → 本地列表移除 + 重包当前章（iframe 文档）。
     * 返回「是否真的删了」—— 用户取消确认必须返回 false，否则外层会把选择模式一并关掉。
     * ⚠️ 走 `onPurgeAnnotations` 批量通道（确认已在此处一次性完成）：逐条调 `onDeleteHighlight`
     * 会每条都弹确认，删 N 条要连点 N 次。
     */
    private async deleteSelectedHighlights(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条高亮吗？（将从阅读数据中移除，笔记里的镜像区同步清空）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        await this.options.onPurgeAnnotations?.('highlight', ids);
        this.highlightList = this.highlightList.filter((h) => !h.id || !sel.has(h.id));
        const doc = this.frameEl.contentDocument;
        if (doc) this.applyHighlights(doc);
        this.refreshHighlightToc();
        new Notice(`已删除 ${ids.length} 条高亮`);
        return true;
    }

    /** 删除**选中的**书签（#345）：confirm 一次 → 从内存列表移除 → 通知宿主落盘 → 重绘（书签只在阅读进度 JSON 里，不动笔记） */
    private async deleteSelectedBookmarks(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 个书签吗？（书签只记在阅读进度文件里，之后可重新添加）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        const remaining = this.bookmarks().filter((b) => !b.id || !sel.has(b.id));
        this.options.bookmarks = remaining;
        this.options.onBookmarksChange?.(remaining);
        this.buildBookmarkToc();
        new Notice(`已删除 ${ids.length} 个书签`);
        return true;
    }

    /** 删除**选中的**摘抄（#345）：confirm 一次 → 批量删除（onPurgeAnnotations）→ 本地列表移除重绘 */
    private async deleteSelectedExcerpts(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条摘抄吗？（将从笔记「## 摘抄」区一并移除）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        await this.options.onPurgeAnnotations?.('excerpt', ids);
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => !x.id || !sel.has(x.id));
        this.buildExcerptToc();
        new Notice(`已删除 ${ids.length} 条摘抄`);
        return true;
    }

    /**
     * 同步分区头按钮态（#345）：无条目时「选择」按钮藏起来（只留空态文案）；
     * 「删除所选」在没有勾选时禁用（避免空删）。
     */
    private syncAnnoBtns(h: AnnoHeadHandles | null, sel: AnnoSelState, total: number): void {
        if (!h) return;
        h.selectBtn.toggleClass('hidden', total === 0 && !sel.on);
        h.delBtn.disabled = sel.ids.length === 0;
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
        this.pendingHighlightHint = ratio;
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

    // ── 搜索卡片（用户 2026-09-17 裁定：划词后点「搜索」就地弹卡；方案 A）──
    // 网络搜索 = 引擎 chip → 系统浏览器打开结果页（不抓取列表：免 Key 的通用搜索 API 已不存在）；
    // AI 搜索 = 卡内出答案（复用翻译通道的服务商与 Key，提示词在设置页可改写）。

    /** 当前可用的搜索词：优先已记录的选区，其次 iframe 内实时选区，都没有则空（让用户自己输入） */
    private searchSeed(): string {
        const live = this.frameEl.contentWindow?.getSelection()?.toString().trim() ?? '';
        return this.selRecord?.text.trim() || live;
    }

    /** 动作条「网络搜索」/ 顶栏「网络搜索」模式：收起动作条 → 就地弹**引擎浮层**（查询词＝选中文字）。
     *  ⚠️ 与顶栏模式走同一条路；「AI 搜索」另有独立入口（openAiFromSelection → 搜索卡）。 */
    private openNetFromSelection(): void {
        const seed = this.searchSeed();
        // 取动作条位置作锚点要在 hideSelbar 之前（收起后仍读得到 style.left/top，这里只是取一次）
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showNetPanel(seed, anchor);
    }

    /** 动作条「AI搜索」/ 顶栏「AI 搜索」模式：收起动作条 → 就地弹 AI 卡并自动跑「解读选段」。 */
    private openAiFromSelection(): void {
        const seed = this.searchSeed();
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showSearchCard(seed, anchor);
    }

    /** 切 AI 卡两态（用户 2026-09-18）：'read' 解读选段（走设置页提示词）/ 'ask' 自定义提问（走内置固定提示词）。
     *  切态只改可见性与提示文案，**不自动发请求**（避免切一下就白烧一次额度）。 */
    private setSearchMode(m: 'read' | 'ask'): void {
        this.searchMode = m;
        (Object.keys(this.searchModeBtns) as ('read' | 'ask')[]).forEach((k) => {
            this.searchModeBtns[k]?.toggleClass('is-on', k === m);
        });
        this.searchReadSecEl?.toggleClass('hidden', m !== 'read');
        this.searchAskSecEl?.toggleClass('hidden', m !== 'ask');
        this.searchBodyEl?.removeClass('rl-search-loading');
        this.searchBodyEl?.removeClass('rl-search-error');
        this.searchBodyEl?.setText(m === 'read' ? '正在解读…' : '输入问题后按回车。');
        if (m === 'ask') this.searchQuestionEl?.focus();
        else this.searchQueryEl?.focus();
    }

    /** 构建搜索卡片（挂 selbarParent；标题「AI 搜索」+ 查询框 + 答案区 + 复制；网络搜索不在此卡） */
    private buildSearchCard(): HTMLDivElement | null {
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
            attr: { type: 'button', 'data-tip': '复制 AI 答案' },
            text: '复制',
        });
        copy.addEventListener('mousedown', (ev) => ev.stopPropagation());
        copy.addEventListener('click', () => void this.copySearchAnswer());
        this.searchCopyBtn = copy;

        // 卡片自身 mousedown 不冒泡到宿主 document：否则 onDocMouseDown 会把卡片立刻收掉
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.searchCard = card;
        return card;
    }

    /** 显示搜索卡（anchor = 宿主 client 坐标；null 退回容器中部）并自动发起「解读选段」。
     *  每次打开都回到「解读选段」态（上次可能停在「自定义提问」态），并锁存选段供提问态兜底。 */
    private showSearchCard(query: string, anchor: { x: number; y: number } | null): void {
        const card = this.buildSearchCard();
        const parent = this.selbarParent;
        if (!card || !parent) return;
        this.searchCardText = query;
        if (this.searchQueryEl) this.searchQueryEl.value = query;
        if (this.searchQuestionEl) this.searchQuestionEl.value = '';
        this.searchQuoteEl?.setText(query ? `选段：${truncateQuote(query)}` : '未选中文字（可直接提问）');
        this.setSearchMode('read');
        card.removeClass('hidden');
        // 定位要量卡片尺寸（hidden 时 rect 全 0）→ 摘掉 hidden 后下一帧再算；AI 请求一并放到这一帧，避免布局抖动
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const pos = placeCard({
                anchorX: anchor ? anchor.x - pRect.left : pRect.width / 2,
                anchorY: anchor ? anchor.y - pRect.top : pRect.height / 3,
                cardW: cRect.width,
                cardH: cRect.height,
                boxW: pRect.width,
                boxH: pRect.height,
            });
            card.style.left = `${pos.left}px`;
            card.style.top = `${pos.top}px`;
            this.searchQueryEl?.focus();
            void this.runAiSearch();
        });
    }

    /** 引擎图标（二选一浮层）：拼查询 URL → 系统浏览器打开结果页（空查询先提示选中文字） */
    private openEngineSearch(engineId: SearchEngineId, query: string): void {
        const url = searchEngineUrl(engineId, query);
        if (!url) {
            new Notice('先选中要搜索的内容', 2500);
            return;
        }
        const open = this.options.onOpenExternal;
        if (!open) {
            new Notice('当前阅读器不支持打开外部链接', 3000);
            return;
        }
        open(url);
    }

    /** 跑一次 AI 搜索（弹卡时自动 / 查询框回车）：令牌机制丢弃过期响应（改词、关卡片后再到达的结果不覆盖） */
    private async runAiSearch(): Promise<void> {
        const body = this.searchBodyEl;
        const card = this.searchCard;
        if (!body || !card) return;
        const q = this.searchQueryEl?.value.trim() ?? '';
        body.removeClass('rl-search-error');
        if (!q) {
            body.removeClass('rl-search-loading');
            body.setText('输入要搜索的内容后按回车。');
            return;
        }
        const run = this.options.onAiSearch;
        if (!run) {
            body.removeClass('rl-search-loading');
            body.addClass('rl-search-error');
            body.setText('当前阅读器不支持 AI 搜索');
            return;
        }
        const token = ++this.searchRunToken;
        body.addClass('rl-search-loading');
        body.setText('搜索中…');
        let answer: string | null = null;
        try {
            answer = await run(q);
        } catch {
            answer = null; // 宿主已弹 Notice（Key/网络/超时），这里只负责卡片状态
        }
        if (token !== this.searchRunToken || card.hasClass('hidden')) return; // 已改词/已关闭 → 丢弃
        body.removeClass('rl-search-loading');
        body.empty();
        if (answer) {
            body.setText(answer);
        } else {
            body.addClass('rl-search-error');
            body.setText('搜索失败');
        }
    }

    /** 跑一次「自定义提问」（提问框回车触发）：选段 + 问题一起发，**不读设置页提示词**。
     *  与 runAiSearch 共用 searchRunToken → 两条通道互相作废（答案永远对应最后一次操作）。 */
    private async runAiAsk(): Promise<void> {
        const body = this.searchBodyEl;
        const card = this.searchCard;
        if (!body || !card) return;
        const q = this.searchQuestionEl?.value.trim() ?? '';
        body.removeClass('rl-search-error');
        if (!q) {
            body.removeClass('rl-search-loading');
            body.setText('输入问题后按回车。');
            return;
        }
        const ask = this.options.onAiAsk;
        if (!ask) {
            body.removeClass('rl-search-loading');
            body.addClass('rl-search-error');
            body.setText('当前阅读器不支持 AI 提问');
            return;
        }
        // 选段以「解读选段」框当前内容为准（用户可能改过），空则回退打开卡片时锁存的选段
        const text = this.searchQueryEl?.value.trim() || this.searchCardText;
        const token = ++this.searchRunToken;
        body.addClass('rl-search-loading');
        body.setText('提问中…');
        let answer: string | null = null;
        try {
            answer = await ask(text, q);
        } catch {
            answer = null; // 宿主已弹 Notice（Key/网络/超时），这里只负责卡片状态
        }
        if (token !== this.searchRunToken || card.hasClass('hidden')) return; // 已改词/已关闭 → 丢弃
        body.removeClass('rl-search-loading');
        body.empty();
        if (answer) {
            body.setText(answer);
        } else {
            body.addClass('rl-search-error');
            body.setText('提问失败');
        }
    }

    /** 复制 AI 答案到剪贴板 */
    private async copySearchAnswer(): Promise<void> {
        const el = this.searchBodyEl;
        const text = el?.getText().trim() ?? '';
        if (!el || !text || el.hasClass('rl-search-loading')) {
            new Notice('还没有可复制的答案', 2500);
            return;
        }
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            new Notice('已复制', 2000);
        } catch {
            new Notice('复制失败，请手动选中复制', 3000);
        }
    }

    /** 收起搜索卡（✕ / Esc / 点正文其他区域 / 切章与重排）；不中断进行中的请求（结果到达时若已隐藏则丢弃） */
    private hideSearchCard(): void {
        this.searchCard?.addClass('hidden');
        this.searchBodyEl?.removeClass('rl-search-loading');
    }

    /** 搜索卡是否打开（Esc 分派用：打开时只收卡片，不关整个阅读器） */
    private isSearchCardOpen(): boolean {
        return Boolean(this.searchCard && !this.searchCard.hasClass('hidden'));
    }

    // ── 快捷搜索「二选一」浮层（用户 2026-09-17 二次裁定：顶栏搜索改模式开关）──
    // 拖选文字后先弹「网络搜索 / AI 搜索」，用户选了才真正搜（避免误触直接发 AI 请求）。

    // ── 「网络搜索」浮层（用户 2026-09-18：搜索拆成网络 / AI 两个独立入口，原「二选一」那一跳取消）──
    // 拖选文字 / 点动作条按钮 → 直接弹引擎浮层：24 个引擎按 5 类分组、**文字 chip**
    // （内置图标集没有各家品牌 logo，24 个纯图标分辨不出来），点引擎即开系统浏览器。
    // 🔴 **不清浏览器选区**：用户要求「选中保持高亮」—— 要看得见自己在搜哪一段；浮层按钮
    //    mousedown 同时 stopPropagation（防 document 收浮层）与 preventDefault（防焦点转移让选区消失）。

    /** 显示「网络搜索」浮层（text = 锁存的选中文字；anchor = 宿主 client 坐标，null 退容器中部） */
    private showNetPanel(text: string, anchor: { x: number; y: number } | null): void {
        const panel = this.buildNetPanel();
        const parent = this.selbarParent;
        if (!panel || !parent) return;
        this.netQueryText = text;
        this.netQuoteEl?.setText(text ? `用选中文字：${text}` : '未选中文字 —— 先选中正文再点引擎');
        panel.classList.remove('hidden');
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const bRect = panel.getBoundingClientRect();
            const evX = anchor ? anchor.x - pRect.left : pRect.width / 2;
            const evY = anchor ? anchor.y - pRect.top : pRect.height / 3;
            const gap = 8;
            const left = Math.min(Math.max(evX - bRect.width / 2, 4), Math.max(4, pRect.width - bRect.width - 4));
            let top = evY - bRect.height - gap;
            if (top < 4) top = evY + gap;
            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(Math.min(top, pRect.height - bRect.height - 4))}px`;
        });
    }

    /** 构建「网络搜索」浮层（挂 selbarParent；标题 + 选中文字预览 + 5 类分组文字 chip，超高内部滚动） */
    private buildNetPanel(): HTMLDivElement | null {
        const parent = this.selbarParent;
        if (!parent) return null;
        if (this.netPanelEl) return this.netPanelEl;
        const panel = parent.createDiv({ cls: 'rl-search-net hidden' });
        const head = panel.createDiv({ cls: 'rl-search-net-head' });
        head.createSpan({ cls: 'rl-search-net-title', text: '网络搜索' });
        const close = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-net-close', attr: { 'data-tip': '关闭' }, text: '✕' });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideNetPanel());
        this.netQuoteEl = panel.createDiv({ cls: 'rl-search-net-quote' });
        const list = panel.createDiv({ cls: 'rl-search-net-list' });
        // 分组与顺序的唯一真源 = pure/readerSearch.SEARCH_ENGINE_GROUPS（组序 + 组内序即 UI 顺序）
        // 用户 2026-09-19 追加：图标**竖排** —— 每个分组自成**一列**（标题在上、图标往下排），5 组横向并排
        for (const g of SEARCH_ENGINE_GROUPS) {
            const col = list.createDiv({ cls: 'rl-search-net-col' });
            col.createDiv({ cls: 'rl-search-net-group', text: g.label });
            const row = col.createDiv({ cls: 'rl-search-net-row' });
            for (const eng of g.engines) {
                // 用户 2026-09-19：chip 改**纯图标**（品牌官方色）+ 悬停提示 —— 引擎名不再直接显示，走 data-tip
                const b = row.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-net-engine', attr: { type: 'button', 'data-tip': eng.label } });
                // 读屏名走隐藏文本（UI-GUIDE §3：纯图标按钮不挂 aria-label，否则与 data-tip 气泡叠成两层）
                b.createSpan({ cls: 'rl-sr', text: eng.label });
                setSearchEngineIcon(b, eng.id);
                b.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
                b.addEventListener('click', () => {
                    const q = this.netQueryText; // hideNetPanel 会清空锁存文本 → 先取
                    this.hideNetPanel();
                    this.openEngineSearch(eng.id, q);
                });
            }
        }
        panel.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.netPanelEl = panel;
        return panel;
    }

    /** 收起「网络搜索」浮层（点正文其他区域 / Esc / 切章 / 选取引擎后） */
    private hideNetPanel(): void {
        this.netPanelEl?.addClass('hidden');
        this.netQueryText = '';
    }

    /** 浮层是否打开（Esc 分派用） */
    private isNetPanelOpen(): boolean {
        return Boolean(this.netPanelEl && !this.netPanelEl.hasClass('hidden'));
    }

    // ── 章节渲染 ──

    private renderChapter(): void {
        // 正文重建（切章 / 切模式 / 改字号）→ 摘抄卡片的位置与引用都失效，先收起
        this.hideExcerptCard();
        this.hideSearchCard();
        this.hideNetPanel();
        const chapters = this.options.book.chapters;
        // 顶栏居中标题 = 当前章（用户 2026-09-16 裁定）：目录 label 归一为「第几章：章名」，
        // 无 label（回退文件名）或空 → 回退书名，避免顶栏显示 chapter3 这种文件名
        const headLabel = formatChapterTitle(this.currentChapterLabel());
        // #345：改走 setHeadTitle，同步 data-tip（长章名被省略号截断后可悬停看全称）
        this.setHeadTitle(headLabel || this.options.title);
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
        // 沉浸模式：iframe 内点击正文空白 = 收起/展开上下边栏（frame 事件不冒泡宿主）；滚轮/触摸打断自动推进
        doc.addEventListener('click', this.onFrameClick);
        // 书内链接一律拦截（用户 2026-09-16 报障）：srcdoc 里点 <a href="chapter2.xhtml#x"> 会让 iframe
        // 自行导航到不存在的地址 → 正文变**空白页**；沉浸模式下「点空白唤回上下栏」的监听挂在旧文档上，
        // 随之失效 → 无法退出。捕获阶段先处理并 stopPropagation，避免同一次点击又切换沉浸态。
        doc.addEventListener('click', (ev) => {
            const a = (ev.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!a) return;
            ev.preventDefault();
            ev.stopPropagation();
            const t = resolveEpubHref(a.getAttribute('href') ?? '', this.options.book.chapters);
            if (t.kind === 'external') { window.open(t.href, '_blank'); return; }
            if (t.kind === 'fragment') { this.scrollFrameToFragment(t.fragment); return; }
            if (t.kind === 'chapter') {
                if (t.index === this.chapterIndex) {
                    if (t.fragment) this.scrollFrameToFragment(t.fragment);
                    return;
                }
                this.pendingFrameFragment = t.fragment || null;
                this.switchChapter(t.index);
            }
        }, { capture: true });
        doc.addEventListener('wheel', this.onUserInterrupt, { passive: true });
        doc.addEventListener('touchstart', this.onUserInterrupt, { passive: true });
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
        // 笔记内链接进场（M1 双向溯源）：本章布局与初始定位稳定后再消费目标块（一次性）；
        // 目标在别的章时由 jumpExcerpt/jumpHighlight 切章，届时新一次 onFrameLoad 会继续（pendingTargetId 已清）
        if (this.options.pendingTargetId) requestAnimationFrame(() => this.consumePendingTarget());
    };

    /** 当前章对应的目录项下标（无匹配 → -1）。
     *  🔴 多个目录项指向同一文件时**只取首个** —— 与顶栏章名口径一致。目录条目与 spine 章节可能非 1:1
     *  （Calibre「先写 NCX、后重切文件」的遗留会把好几章压到同一个文件上），若全量比对，目录会一次点亮多章
     *  （用户 2026-09-19 报的「目录连章」）。今日起解包侧会把这类错位目录按内容文件重建（见 main.unpackEpub），
     *  这里的「只取首个」是第二道保险（重建失败时原目录仍可用，只是退化成一项）。 */
    private tocIndexFor(chapterPath: string | undefined): number {
        if (chapterPath === undefined) return -1;
        return this.tocEntries.findIndex((e) => e.href.split('#')[0] === chapterPath);
    }

    /** 当前章标题：目录中匹配当前章路径的 label；无匹配回退文件名（去扩展名） */
    private currentChapterLabel(): string {
        const cur = this.options.book.chapters[this.chapterIndex];
        if (cur === undefined) return '';
        const i = this.tocIndexFor(cur);
        if (i >= 0) return this.tocEntries[i].label;
        const name = cur.split('/').pop() ?? cur;
        return name.replace(/\.[^.]+$/, '');
    }

    /** 滚动 iframe 到书内锚点（#x）；找不到就静默忽略（绝不退化成导航） */
    private scrollFrameToFragment(fragment: string): void {
        if (!fragment) return;
        const doc = this.frameEl?.contentDocument;
        if (!doc) return;
        let el: Element | null = null;
        try {
            el = doc.getElementById(fragment) ?? doc.querySelector(`[name="${fragment.replace(/"/g, '\\"')}"]`);
        } catch {
            el = null;
        }
        el?.scrollIntoView({ block: 'center' });
    }

    /** 面板尺寸变化（用户拖 Obsidian 侧栏宽度等）：按原比例重排 —— 翻页列宽是按当时视口算死的，
     *  原先完全没有 resize 处理，视口一变列宽就不匹配（用户 2026-09-16 报障「鼠标无法继续聚焦滚动正文」）。 */
    onResize(): void {
        // 连续模式版心是 CSS（min(74ch, 92%)）→ 自动跟随；翻页模式的列宽按当时视口算死，必须重设
        const doc = this.frameEl?.contentDocument;
        if (this.isPaged() && doc) this.setupPagedLayout(doc);
    }

    /** 注入 iframe 文档样式：字号/行距/单页限宽（srcdoc 每次重建后重新应用） */
    private applyLayout(doc: Document): void {
        const body = doc.body;
        body.style.fontSize = `${readerFontSize ?? 16}px`;
        body.style.lineHeight = `${readerLineHeight ?? this.lineHeight}`;
        // 翻页模式：单列分页 columns 由 setupPagedLayout 管理，此处不动列/宽（避免覆盖）
        if (this.isPaged()) return;
        // 行宽：严格 = 720px 版心居中；全宽 = 铺满可用宽度（用户 2026-09-15）
        body.style.maxWidth = this.lineWidth === 'full' ? 'none' : '720px';
    }

    /** iframe 注入样式（配色 / 字体 / 版心）：抽出来供「构建 srcdoc」与「主题切换刷新」共用 */
    private buildFrameCss(): string {
        const { fontFamily, bg, color } = getHostStyle(this.container);
        // 连续模式：单页限宽，纵向滚动 + 底部 40vh 给触底空间；
        // 翻页模式：单列分页（columns 由 onFrameLoad/setupPagedLayout 内联设置），底部留小 padding 避免大底距干扰列高
        const padB = this.isPaged() ? '24px' : '40vh';
        // 版心（用户 2026-09-16）：严格档改按字数自适应 min(74ch, 92%)（原固定 720px）
        const layout = `max-width:${this.lineWidth === 'full' ? 'none' : 'min(74ch, 92%)'};`;
        // 段落首行缩进（设置开关，默认关）
        const indentCss = this.indent ? 'text-indent:2em;' : '';
        // #351 字体 / 字重 / 字距：`default` 用宿主字体；`normal` 与 0 **一律不写这一项**
        // （写死 400 / 0em 会盖掉宿主主题与用户自定义 CSS）
        const fam = fontFamilyCss(this.fontFamily) || fontFamily;
        const fw = fontWeightCss(this.fontWeight);
        const weightCss = fw === 400 ? '' : `font-weight:${fw};`;
        const ls = formatLetterSpacing(this.letterSpacing);
        const letterCss = ls === '0em' ? '' : `letter-spacing:${ls};`;
        return `html,body{margin:0;padding:0;background:${bg};color:${color};}
body{font-family:${fam};${weightCss}${letterCss}font-size:${readerFontSize ?? 16}px;line-height:${readerLineHeight ?? this.lineHeight};margin:0 auto;padding:26px 32px ${padB};${layout}}
h1,h2,h3,h4,h5,h6{line-height:1.5;margin:0.8em 0 0.5em;}
p{margin:0 0 1em;text-align:justify;${indentCss}}
/* 正文滚动条跟随阅读主题（十轮）：iframe 是独立文档，收不到插件 CSS，只能注入 */
html{scrollbar-width:thin;scrollbar-color:color-mix(in srgb, ${color} 18%, transparent) transparent;}
::-webkit-scrollbar{width:10px;height:10px;background:transparent;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:color-mix(in srgb, ${color} 18%, transparent);border-radius:6px;border:2px solid transparent;background-clip:padding-box;}
::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb, ${color} 30%, transparent);background-clip:padding-box;}
.rl-excerpt-hl{background:rgba(255,200,60,.35);border-radius:2px;}
/* 朗读当前句（#340）：iframe 是独立文档，收不到插件 CSS ⇒ 必须注入。
   🔴 无 padding / 无 border（会挤动排版）+ color:inherit（深色模式才不会看不见）。 */
.rl-tts-cur{background:color-mix(in srgb, ${color} 14%, transparent);color:inherit;padding:0;border-radius:2px;}
${highlightMarkCss()}`;
    }

    /** 生成 iframe srcdoc：基础 CSS + 章节 HTML */
    private buildFrameDoc(bodyHtml: string): string {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${this.buildFrameCss()}</style></head><body>${bodyHtml}</body></html>`;
    }

    /** 主题切换后刷新 iframe 内配色（用户 2026-09-15：系统主题夜间自动切深色，正文仍停在浅色）：
     *  只替换 iframe 里的样式表，不重建章节 → DOM 与阅读位置都不动。 */
    refreshTheme(): void {
        const doc = this.frameEl?.contentDocument;
        const style = doc?.querySelector('style');
        if (style) style.textContent = this.buildFrameCss();
    }

    /** 目录高亮当前章（按 href 匹配，而非按 items 下标对齐 —— toc 条目与 spine 章节非 1:1
     *  （nav 可含 landmarks 前的多余链接 / 缺章）时，items[chapterIndex] 会滑到错行）。
     *  🔴 **一次只点亮一项**（`tocIndexFor` 取首个匹配）：多条目录项指向同一文件时全量比对会一次亮好几章。 */
    private highlightToc(): void {
        const items = this.tocListEl.querySelectorAll('.rl-reader-toc-item');
        const activeIdx = this.tocIndexFor(this.options.book.chapters[this.chapterIndex]);
        items.forEach((el, i) => el.toggleClass('active', i === activeIdx));
        const active = activeIdx >= 0 ? items[activeIdx] : undefined;
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    /** 切换到指定章（越界忽略）：先落盘当前进度，再渲染新章节 */
    private switchChapter(i: number): void {
        if (i < 0 || i >= this.options.book.chapters.length || i === this.chapterIndex) return;
        this.ttsSvc?.stop(); // 🔴 切章必须停朗读 —— 换 srcdoc 后旧章节点已销毁，继续读会往空节点写高亮
        this.ttsSvc?.resetAnchor(); // 🔴 点击锚点是**章内**偏移 ⇒ 换章必须作废，否则新章会从错位置读起
        this.resetAnnotate(); // 切章复位标注模式，防残留
        this.flushSave();
        this.chapterIndex = i;
        this.renderChapter();
    }

    // ── 顶栏快捷「标注模式锁」 ──

    /** 点快捷按钮：切换对应标注模式激活态（激活→再点取消；点另一钮切过去） */
    private toggleAnnotate(kind: ReaderQuickMode): void {
        this.setAnnotate(this.annotateMode === kind ? null : kind);
    }

    /** 设置激活标注模式（null=全部退出），同步按钮 .rl-quick-active；进入高亮模式提示一次 */
    private setAnnotate(kind: ReaderQuickMode | null): void {
        this.annotateMode = kind;
        (Object.keys(this.quickBtns) as ReaderQuickMode[]).forEach((k) => {
            this.quickBtns[k]?.toggleClass('rl-quick-active', k === kind);
        });
        if (kind === 'highlighter') new Notice('高亮模式：拖选文字即高亮（再点该按钮退出）');
        else if (kind === 'quote') new Notice('摘抄模式：拖选文字即加摘抄（再点该按钮退出）');
        else if (kind === 'languages') new Notice('翻译模式：拖选文字即翻译（再点该按钮退出）');
        else if (kind === 'bookmark') new Notice('书签模式：单击正文存书签（再点该按钮退出）');
        else if (kind === 'netsearch') new Notice('网络搜索模式：拖选文字后选搜索引擎（再点该按钮退出）');
        else if (kind === 'aisearch') new Notice('AI 搜索模式：拖选文字后由 AI 作答（再点该按钮退出）');
    }

    /** 清除激活标注模式（切章/关面板时调用，防残留） */
    private resetAnnotate(): void {
        if (this.annotateMode) this.setAnnotate(null);
        this.hideNetPanel();
    }

    /**
     * 激活左侧 pane（目录/书签/摘抄）：展开目录列（取消 collapsed），
     * 同步侧栏三 tab 与头部三键的 active 态，并互斥显隐三个 pane。
     * 供头部三键与侧栏 tab 共用；T 键仍为整体折叠/展开（toggleToc）。
     */
    private activatePane(pane: 'toc' | 'ex', expand = true): void {
        // 与 toggleToc 折叠态互斥：激活 pane 即展开目录列；首次挂载传 expand=false（保持「打开即收起」）
        if (expand) {
            this.tocEl.toggleClass('collapsed', false);
            this.tocCollapsed = false;
        }
        // pane 顺序（toc/ex）与创建顺序一致：侧栏 tab、pane 容器均按下标对应
        // （书签并入标注 pane 后只剩两页，用户 2026-09-17）
        const order: ReadonlyArray<'toc' | 'ex'> = ['toc', 'ex'];
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
        this.exCountEl?.setText(annoCountText('摘抄', exs.length, this.exSel));
        this.syncAnnoBtns(this.exHeadRef, this.exSel, exs.length);
        if (exs.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无摘抄' });
            return;
        }
        exs.forEach((ex) => {
            const item = list.createDiv({ cls: 'rl-reader-ex-item' });
            // #345 选择模式：行首勾选框（仅模式内显示）+ 点击改为勾选
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
            // 右键删除摘抄（左键定位/右键删除）；🔴 选择模式内禁用，避免与勾选语义打架
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
        this.pendingHighlightHint = ratio;
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

    /** iframe load 完成恢复滚动后：用 quote 文本锚精确找回目标段落（pct 只在同一 quote 多处出现时用于消歧），
     *  滚动到首个命中段、闪烁命中的全部段落 2.5s；命中不到 → 保持 pct 落点不动（不打扰读者）。
     *  ⚠️ 只加/去段落类名，不改 innerHTML —— 与 applyHighlights 的 <mark> 重建互不干扰。 */
    private highlightPending(): void {
        const quote = this.pendingHighlight;
        const hint = this.pendingHighlightHint;
        this.pendingHighlight = null;
        this.pendingHighlightHint = null;
        if (!quote) return;
        const doc = this.frameEl.contentDocument;
        if (!doc?.body) return;
        const paras = Array.from(doc.body.querySelectorAll('p'));
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

    /**
     * 笔记内链接进场（M1 双向溯源）：在已注入的高亮/摘抄/书签里按块 id 找目标 → 走既有跳转通道
     * （它们各自负责切章 + 恢复比例 + quote 定位）。找不到 → 提示一次；一次性消费，切章不会重复触发。
     */
    private consumePendingTarget(): void {
        const id = this.options.pendingTargetId;
        if (!id) return;
        this.options.pendingTargetId = undefined;
        const hl = this.highlightList.find((h) => h.id === id);
        if (hl) {
            this.jumpHighlight(hl);
            return;
        }
        const ex = (this.options.excerpts ?? []).find((x) => x.id === id);
        if (ex) {
            this.jumpExcerpt(ex);
            return;
        }
        const bm = this.bookmarks().find((b) => b.id === id);
        if (bm) {
            this.jumpBookmark(bm);
            return;
        }
        new Notice('笔记里的这个定位已找不到（可能已被删除）');
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
            // 定位行只留「第 N 章 · X%」（用户 2026-09-20：「书签不要显示标题」—— 与高亮/摘抄两行**同一格式**，三区对齐）
            item.createDiv({ cls: 'rl-reader-bm-loc', text: `第${bm.chapter}章 · ${bm.pct}%` });
            item.addEventListener('click', () => {
                if (this.bmSel.on) {
                    toggleAnnoSelItem(this.bmSel, bm.id);
                    this.buildBookmarkToc();
                    return;
                }
                this.jumpBookmark(bm);
            });
            // 右键删除书签：与摘抄右删（宿主 confirm + 回写笔记）不同，书签列表已在面板内存，
            // 直接移除本项并通知宿主落盘即可（新增书签同样走 onBookmarksChange 同一持久化通道，无需宿主确认回调）
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

    /** 删除书签（右键单删）：🔴 **必须先二次确认**（用户 2026-09-20：「右键单击任一条书签会直接删除，给我弹二次确认删除」）。
     *  确认走与「删除所选」同一个通道 `onConfirmClear`（口径一致，⛔ 不各写一套）；用户取消 → 什么都不做。 */
    private async removeBookmarkItem(id: string): Promise<void> {
        const msg = '确定删除这条书签吗？（只移除这条书签，不影响阅读进度与摘抄）';
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return;
        const remaining = this.bookmarks().filter((b) => b.id !== id);
        this.options.bookmarks = remaining;
        this.options.onBookmarksChange?.(remaining);
        this.buildBookmarkToc();
        new Notice('已删除书签');
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
        this.pendingHighlightHint = ratio;
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

    /** 各章纯文本字数（estimatePercent 加权；懒计算缓存）——
     *  用 chapterTextLength 剥离 XHTML 标签计数：原 fileMap 原始串长把封面/版权/壳页的标签高估为权重，
     *  纯文本字数才与实际阅读量成正比（全书 % 随滚动平滑、不虚高） */
    private chapterSizes(): number[] {
        if (this.chapterSizesCache === null) {
            this.chapterSizesCache = this.options.book.chapters.map((c) => chapterTextLength(this.options.fileMap[c] ?? ''));
        }
        return this.chapterSizesCache;
    }

    /**
     * 更新底部工具条：分页器数字 + 进度条填充宽度（口径见 pure/readerFooter，TXT/EPUB/PDF 共用）。
     * 数字恒为「已读 全书%」、填充取全书进度；页码与章内% 只走悬停提示。
     * 旧实现翻页分支自行显示页码 + 章内% 填充 → 与滚动模式同一位置读数对不上（用户 2026-09-17 报障）。
     */
    private updateProgress(): void {
        const ratio = this.currentRatio();
        const r = footerReadout({
            paged: this.isPaged(),
            page: this.pageIndex,
            totalPages: this.totalPages,
            chapPct: Math.round(ratio * 100),
            overallPct: estimatePercent(this.chapterSizes(), this.chapterIndex, ratio),
        });
        this.footerFpctEl?.setText(r.text);
        this.footerFpctEl?.setAttribute('data-tip', r.tip);
        this.footerFillEl?.style.setProperty('width', `${r.fillPct}%`);
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

    /** 切换行宽（严格/全宽）：写回设置 + 重建当前章（连续模式 applyLayout 按新行宽设限宽；翻页模式需按新列宽重排分页） */
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
        requestAnimationFrame(() => this.syncSegItems(this.widthSeg, this.lineWidth));
        this.jumpRatio = this.currentRatio();
        this.renderChapter();
    }

    // ── 字号 / 行距 / 布局 ──

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

    // ── 设置面板的分组 / 行 / 分段控制器（#351，与 TXT 阅读器同款，选项真源都在 pure/readerTypography）──

    /** 分组标题行（「▼ 显示」）：点击折叠整组；三角只旋转不换字符（两种字形宽度不同会让标题抖） */
    /**
     * 面板分组（#351）：标题 + 内容块。
     * 🔴 #351b 用户口径「**删除收起展示功能**」⇒ 分组**常显、不可折叠**：
     *    标题从 `<button>` 改成 `<div>` —— 一是折叠点击本就要撤，二是 `<button>` 会被 Obsidian 核心
     *    `button:not(.clickable-icon)`（0,1,1）压成**整行灰底 + 内阴影**，那正是用户说的「厚重感」（§3 的老坑）。
     */
    private buildMenuSection(menu: HTMLElement, title: string): HTMLElement {
        menu.createDiv({ cls: 'rl-reader-menu-sec', text: title });
        return menu.createDiv({ cls: 'rl-reader-menu-group' });
    }

    /** 面板一行：左标签 + 右控件槽 */
    private buildMenuRow(parent: HTMLElement, label: string): HTMLElement {
        const row = parent.createDiv({ cls: 'rl-reader-menu-row' });
        row.createSpan({ cls: 'rl-reader-menu-label', text: label });
        return row;
    }

    /** 分段控制器（#351）：胶囊容器 + 若干段，`data-val` 存取值；亮起态交给 syncSegItems */
    private buildSeg<T>(row: HTMLElement, options: readonly SegOption<T>[], current: T, onPick: (v: T) => void): HTMLElement {
        // 🔴 `rl-seg-text` = **纯字变色切换**（#351b 用户口径：大胶囊太重 ⇒ 去掉容器底与描边，只留字色变化）
        const seg = row.createDiv({ cls: 'rl-seg rl-seg-text' });
        for (const o of options) {
            const b = seg.createEl('button', {
                cls: 'rl-seg-item',
                text: o.label,
                attr: { type: 'button', 'data-val': String(o.value) },
            });
            if (o.tip) b.setAttribute('data-tip', o.tip);
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => onPick(o.value));
        }
        this.syncSegItems(seg, String(current));
        return seg;
    }

    /** 同步分段控制器亮起态（按 `data-val` 比对）—— 三组分段共用这一个同步函数 */
    private syncSegItems(seg: HTMLElement | null, current: string): void {
        if (!seg) return;
        for (const el of Array.from(seg.children)) {
            (el as HTMLElement).toggleClass('is-on', (el as HTMLElement).getAttribute('data-val') === current);
        }
    }

    /** 设定字号（滑条 / 键盘共用）：夹取 → 改 iframe 内样式 → 按比例保持位置 → 需要时写回设置 */
    private applyFontValue(next: number, persist: boolean): void {
        const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next)));
        if (clamped === readerFontSize) {
            this.syncSettingsLabels();
            return;
        }
        readerFontSize = clamped;
        // 保持当前阅读位置（字号变化前后按同一比例定位）
        const doc = this.frameEl.contentDocument;
        const scroller = doc?.scrollingElement || doc?.documentElement;
        let ratio = 0;
        if (scroller) {
            const max = scroller.scrollHeight - this.frameEl.clientHeight;
            ratio = max > 0 ? scroller.scrollTop / max : 0;
        }
        if (doc?.body) doc.body.style.fontSize = `${clamped}px`;
        if (scroller) {
            this.restoring = true;
            requestAnimationFrame(() => {
                const m2 = scroller.scrollHeight - this.frameEl.clientHeight;
                if (m2 > 0) scroller.scrollTop = ratio * m2;
                this.restoring = false;
                this.updateProgress();
            });
        }
        if (persist) this.options.onSettingsChange?.({ fontSize: clamped, lineHeight: readerLineHeight ?? this.lineHeight });
        this.syncSettingsLabels();
    }

    /** 设定行距（滑条 / 键盘共用）：改 iframe 内样式 + 按比例保持位置；口径同 applyFontValue */
    private applyLineValue(next: number, persist: boolean): void {
        if (readerLineHeight === null) readerLineHeight = this.lineHeight;
        const clamped = Math.round(Math.min(LINE_MAX, Math.max(LINE_MIN, next)) * 10) / 10;
        if (clamped === readerLineHeight) {
            this.syncSettingsLabels();
            return;
        }
        readerLineHeight = clamped;
        this.lineHeight = clamped;
        const doc = this.frameEl.contentDocument;
        const scroller = doc?.scrollingElement || doc?.documentElement;
        let ratio = 0;
        if (scroller) {
            const max = scroller.scrollHeight - this.frameEl.clientHeight;
            ratio = max > 0 ? scroller.scrollTop / max : 0;
        }
        if (doc?.body) doc.body.style.lineHeight = `${clamped}`;
        if (scroller) {
            this.restoring = true;
            requestAnimationFrame(() => {
                const m2 = scroller.scrollHeight - this.frameEl.clientHeight;
                if (m2 > 0) scroller.scrollTop = ratio * m2;
                this.restoring = false;
                this.updateProgress();
            });
        }
        if (persist) this.options.onSettingsChange?.({ fontSize: readerFontSize ?? 16, lineHeight: clamped });
        this.syncSettingsLabels();
    }

    private adjustFont(delta: number): void {
        this.applyFontValue((readerFontSize ?? this.options.settings?.fontSize ?? 16) + delta, true);
    }

    private adjustLineHeight(delta: number): void {
        this.applyLineValue((readerLineHeight ?? this.lineHeight) + delta, true);
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

/** HTML 转义（占位提示内嵌路径时防破标签） */
function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
