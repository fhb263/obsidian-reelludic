// PDF 书籍阅读器面板（宿主由 views/ReaderViews.ts 的 PdfReaderView 提供：工作区新标签页打开）：
// 连续滚动逐页 canvas 渲染（视口虚拟化：IntersectionObserver 只渲染可视 ± 缓冲页，离屏销毁释放内存）
// + textLayer 文本层选中（高亮 + 摘抄 + 区域截图，2026-10-23 补齐）+ PDF outline 目录侧栏 + 缩放 ±
// + 进度持久化（ReadingProgress 复用：chapterIndex = 页码索引 0 基，scrollRatio = 页内滚动比例）
// 渲染：复用 Obsidian 自带的 pdfjs（loadPdfJs 懒加载 5.3.34 + 自带 worker/wasm/cmaps 资源），
// 不再随产物打包 pdfjs-dist —— 见下方 `getPdfjs` 注释
import { Notice, Scope, setIcon, loadPdfJs } from 'obsidian';
import { estimatePdfPercent, normalizePdfOutline, resolveFlushPos, flattenPdfOutline, chooseActivePdfIndex, type PdfOutlineItem, type ReaderPos, type FlatPdfOutlineItem } from 'pure/pdfProgress';
import { READER_THEMES, normalizeReaderTheme, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
// 🔴 #603：底栏图标组里「描述行为」的悬停轻提示真源（与另外三件共用）
import { READER_FOPS } from 'pure/readerFops';
// #382：目录栏右缘拖宽（与 TXT/EPUB 同款共用件；#339 只写 CSS 变量 + localStorage 记忆）
import { attachScrollFades, resyncScrollFade, attachTocResizer } from 'pure/readerToc';
// #382b：书签（PDF 原先裁定「只做书签」；2026-10-22 起已补高亮，2026-10-23 补摘抄 + 区域截图）
import { newBookmark, type ReaderBookmark } from 'pure/bookmark';
// #379：PDF 顶栏没有快捷入口（不需要窄屏收纳），只挂「标题对称限宽」这一半
import { attachHeadTitle } from 'pure/readerHead';
import type { ParsedExcerpt } from 'pure/excerpt';
// 2026-10-23 路线 A：PDF 高亮复用 TXT/EPUB 那套高亮模型（同一条存档段、同一套三样式五色 UI），
// 差别只在 PDF 会额外存归一化页内矩形（`rects`）—— 见 `pure/pdfHighlight` 的坐标系说明。
import {
    DEFAULT_HL_COLOR,
    DEFAULT_HL_STYLE,
    HL_COLORS,
    HL_STYLES,
    type HlColor,
    type HlStyle,
    type ReaderHighlight,
} from 'pure/highlight';
import { highlightLabel, normalizeRects, rectsOverlap, relRectStyle, type PdfRelRect } from 'pure/pdfHighlight';
// 2026-10-23：PDF 摘抄就地卡片复用 TXT/EPUB 那套纯逻辑（落位/键盘/信息行文案），只是面板自己实现。
import { excerptCardKeyAction, excerptCardLocLabel, needsQuoteExpand, placeCard } from 'pure/excerptCard';
// 2026-10-23 区域截图：面板只交矩形 + 定位，取像素/落盘/写笔记在宿主（`saveReaderShot`）。
import type { ShotLoc, ShotRect } from 'pure/readerShot';
import { ShotOverlay } from 'modals/ShotOverlay';
// 2026-10-23：译文卡 + 网络搜索浮层（PDF 当年裁定不做，现在按用户指令补齐）。
// 🔴 抽在 `modals/ReaderOverlays` 而不是在面板里再抄一份 —— TXT/EPUB 各有内联实现（产物断言锁着，
//    本轮不动），PDF 是第三处，再抄一次就是三份真源。
import { ReaderOverlays } from 'modals/ReaderOverlays';
// 2026-10-23：PDF 补「翻页 / 滚动」双模式 —— 与 TXT/EPUB 共用同一套模式枚举与归一化函数。
import { normalizeScrollMode, type ScrollMode } from 'pure/paged';
// 2026-10-23：顶栏快捷模式 id —— 与 TXT/EPUB 共用同一个类型（顺序契约见该模块注释）。
import type { ReaderQuickMode } from 'pure/readerQuick';
// 阅读模式分段控制器的选项与类型（与 TXT/EPUB 同一份真源，⛔ 别在 PDF 里另写一份标签）
import { SCROLL_OPTIONS, type SegOption } from 'pure/readerTypography';
// 2026-10-23：分区头（计数 + 选择/全选/删除所选/取消）三端共用件 —— PDF 侧栏合并成一个「标注」页签后
// 三个分区都要它（书签 / 高亮 / 摘抄），否则 PDF 的列表就没有多选删除。
import { appendAnnoCheck, annoCountText, buildAnnoHead, isAnnoSelItem, toggleAnnoSelItem, type AnnoHeadHandles, type AnnoSelState } from 'pure/annoSelection';
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

/** pdf.js 运行时最小结构类型（刻意只声明用到的成员）：
 *  ① v5 起不再导出 `RenderTask`，`import type` 拿不到，只能结构化描述；
 *  ② 不引 `pdfjs-dist` 的 .d.ts ⇒ 卸载该依赖后 tsc 仍通过。 */
interface PdfRenderTask {
    cancel(): void;
    promise: Promise<void>;
}
interface PdfPageProxy {
    getViewport(p: { scale: number }): { width: number; height: number };
    render(p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): PdfRenderTask;
    streamTextContent(): unknown;
}
interface PdfDocumentProxy {
    numPages: number;
    getPage(n: number): Promise<PdfPageProxy>;
    getOutline(): Promise<unknown>;
    getDestination(name: string): Promise<unknown[] | null>;
    getPageIndex(ref: unknown): Promise<number>;
    destroy(): Promise<void>;
}
interface PdfjsLib {
    getDocument(p: { data: ArrayBuffer }): { promise: Promise<PdfDocumentProxy> };
    TextLayer: new (p: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) => { render(): Promise<void> };
}

/** 取 Obsidian 自带的 pdfjs（懒加载单例）。
 *  2026-10-22 用户裁定（方案 A）：不再打包 `pdfjs-dist@4.10.38` —— 它和 Obsidian 自带 5.3.34
 *  抢同一个 `window.pdfjsLib` 全局（我们产物里 `globalThis.pdfjsLib = {}` 会把原生那份覆盖成 v4 的形状），
 *  且内联 worker 让产物多背 ~1.3MB。改用官方 `loadPdfJs()`：它动态 import `/lib/pdfjs/pdf.min.mjs`，
 *  并自动把 `GlobalWorkerOptions.workerSrc` 指到 `/lib/pdfjs/pdf.worker.min.mjs`（资源全在 asar 内，实测 200）。
 *  ⚠️ JBIG2/CCITT 解码在 Obsidian 这版仍是纯 JS（worker 内 `jbig2.wasm` 计数为 0），
 *     不触发 CHANGELOG 里那条「v5 改为外部 wasm → 扫描版整页空白」的红线；OpenJPEG/QCMS 的 wasm
 *     由 Obsidian 通过 `wasmUrl` 提供，实测可取。
 *  ⚠️ 渲染 API 与 v4 一致（真机实测）：`page.render({ canvasContext })` 可用、`render({ canvas })` 报错、
 *     `new TextLayer({...})` 签名不变 ⇒ 渲染逻辑一行都不用改。 */
let pdfjsPromise: Promise<PdfjsLib> | null = null;
function getPdfjs(): Promise<PdfjsLib> {
    if (!pdfjsPromise) {
        pdfjsPromise = loadPdfJs().then((lib) => lib as PdfjsLib).catch((err) => {
            pdfjsPromise = null; // 失败可重试（用户可能刚重载插件）
            throw err;
        });
    }
    return pdfjsPromise;
}

/** 轻量页数探针：仅解析 PDF 获取 numPages（不渲染，供表单「进度页数」自动关联本地文件用）；
 *  复用 Obsidian 自带 pdfjs 单例（懒加载成功一次后全局复用）；失败返回 undefined（调用方静默/降级） */
export async function probePdfNumPages(data: ArrayBuffer): Promise<number | undefined> {
    try {
        const pdfjsLib = await getPdfjs();
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
    /**
     * 2026-10-23：PDF 摘抄写入口（动作条「❝ 摘抄」→ 就地卡片 → 保存）。
     * 与 TXT/EPUB **共用同一个签名与同一条宿主通道**（`main.addExcerpt` + `service.appendNoteSection`），
     * ⛔ 别为 PDF 另起一套写入逻辑 —— 笔记区段与 `noteFingerprint` 的唯一拥有者是 EntryService。
     * `loc.chapter` 对 PDF 是**页码 1 基**（不是章号），`pct` = 页内比例 0-100。
     */
    onExcerptSave?: (quote: string, note: string | undefined, loc: { chapter: number; pct: number }) => Promise<boolean>;
    /** PDF 加载完成回调（numPages 已知；main 层做进度基准校正 totalPage=本地页数） */
    onPdfReady?: (numPages: number) => void;
    /** 阅读主题（跟随/经典白/夜间黑/护眼绿/深灰/羊皮纸；缺省 follow = 跟随 Obsidian 主题） */
    theme?: ReaderThemeId;
    /** 阅读主题变更回调（切换后写回设置持久化） */
    onThemeChange?: (t: ReaderThemeId) => void;
    /**
     * 2026-10-23 路线 A：高亮数据源（阅读存档 `highlights` 段；打开阅读器时读取）。
     * PDF 与 TXT/EPUB 共用同一条 schema —— `rects`（可选）只有 PDF 会写，
     * 存归一化页内矩形，用于缩放/重开时直接还原，不必重跑文本定位。
     */
    highlights?: ReaderHighlight[];
    /**
     * 新建高亮（选区 → 一键即记）。`rects` 仅 PDF 传：归一化页内矩形数组。
     * 返回新块 id（null = 写入失败，面板据此决定要不要在本地列表里追加）。
     */
    onHighlight?: (
        quote: string,
        loc: { chapter: number; pct: number },
        style?: HlStyle,
        color?: HlColor,
        rects?: PdfRelRect[],
    ) => Promise<string | null>;
    /** 删除高亮（列表右键）；返回是否真的删掉（false 时面板刷新复原） */
    onDeleteHighlight?: (blockId: string) => Promise<boolean>;
    /**
     * 静默直删（不弹确认）：换样式走「先删旧再写新」的中间步骤时用 —— 那一步是**一次用户动作**，
     * 只该在末尾报一条「已更新高亮样式」，⛔ 不能弹 ConfirmModal。
     * 🔴 与 TXT/EPUB **共用同一个入口与签名**（`onTrashSelection` + `{quiet:true}`），
     *    ⛔ 别为 PDF 另造一个删除回调 —— 三条阅读器必须走同一条直删通道。
     */
    onTrashSelection?: (
        t: { highlightIds: string[]; excerptIds: string[]; highlightQuotes?: string[] },
        opts?: { quiet?: boolean },
    ) => Promise<number>;
    /**
     * 区域截图（2026-10-23 用户指令：TXT/EPUB/PDF 三阅读器加「区域截图回填笔记」）。
     * 面板只负责**框选 + 交矩形 + 交定位**，取像素/落盘/写笔记全在宿主 `saveReaderShot`
     * （笔记文件的唯一拥有者是 `EntryService`，⛔ 面板里不许碰 vault）。
     */
    onShotSave?: (rect: ShotRect, loc?: ShotLoc) => void;
    /**
     * 2026-10-23 用户指令：PDF 顶栏补「文本翻译」快捷入口。
     * 与 TXT/EPUB **共用同一个签名与同一条宿主通道**（`main.translateText`）；缺省 → 点翻译直接提示不支持。
     */
    onTranslate?: (text: string) => Promise<string | null>;
    /**
     * 2026-10-23 用户指令：PDF 顶栏补「网络搜索」快捷入口。
     * 引擎 chip → 系统浏览器，URL 由 `pure/readerSearch.searchEngineUrl` 统一拼；
     * 缺省 → 提示「当前阅读器不支持打开外部链接」。
     */
    onOpenExternal?: (url: string) => void;
    /**
     * 阅读模式（2026-10-23 用户指令：PDF 要「翻页模式 + 滚动模式」两种）。
     * `'continuous'`（缺省）= 连续滚动；`'paged'` = 一次一页（← → / PageUp PageDown / 滚轮切页）。
     * 🔴 与 TXT/EPUB **共用 `pure/paged.ScrollMode` 与同一个设置字段** `readerScrollMode`，
     *    ⛔ 别为 PDF 另起一套枚举或另一个设置键 —— 用户切的是「阅读模式」这一个概念。
     */
    scrollMode?: ScrollMode;
    /** 阅读模式变更回调（宿主写回 `settings.readerScrollMode` 持久化） */
    onScrollModeChange?: (m: ScrollMode) => void;
    /**
     * 初始缩放（会话恢复用；缺省 1 = 100%）。
     * 宿主传 `settings.readerPdfScale`，用户在设置菜单/Ctrl+滚轮/键盘「+−」调过后都写回它。
     */
    scale?: number;
    /** 缩放手势/菜单/键盘变更回调（宿主写回 `settings.readerPdfScale`；拖动滑条时也只在松手触发） */
    onScaleChange?: (scale: number) => void;
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
    renderTask: PdfRenderTask | null;
}

export class PdfReaderPanel {
    /** pdf.js 文档对象（加载成功后持有） */
    private pdf: PdfDocumentProxy | null = null;
    /** pdfjs 模块句柄（load 时从 getPdfjs() 取；renderPage 建 TextLayer 要用） */
    private pdfjs: PdfjsLib | null = null;
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
    /** 侧栏溢出渐隐的解绑器（见 `pure/readerToc.attachScrollFades`） */
    private disposeFade: (() => void) | null = null;
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
    /**
     * 自动**翻页**间隔（ms）—— 2026-10-23 PDF 补了翻页模式，翻页态下自动推进走定时器
     * （`autoScrollPx` 是 px/s，翻页态没有意义）。与 TXT 同一份参数与记忆键。
     */
    private autoTurnMs = AUTO_TURN_DEFAULT_MS;
    /** 自动翻页定时器（翻页态用；连续态用 `autoRaf`，二者互斥） */
    private autoTimer: number | null = null;
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
    /** 标注 pane 三区头（2026-10-23 合并页签后每区都有「计数 + 选择/全选/删除所选/取消」） */
    private bmHeadRef: AnnoHeadHandles | null = null;
    private hlHeadRef: AnnoHeadHandles | null = null;
    private exHeadRef: AnnoHeadHandles | null = null;
    /** 摘抄书签跳转待高亮引用（滚动定位后 textLayer 内查找高亮，一次性） */
    private pendingHighlight: string | null = null;
    /** 待高亮引用的目标页索引（textLayer span 异步渲染，页面就绪后重试命中） */
    private pendingHighlightPage: number | null = null;
    /** 区域截图的框选层（存在即「正在框选」；销毁阅读器时必须一并收掉） */
    private shotOverlay: ShotOverlay | null = null;

    // ── 2026-10-23 用户指令：顶栏快捷模式 + 译文/网络搜索浮层 + 双阅读模式 ──

    /** 当前标注模式（null = 没进模式，拖选不会触发任何动作） */
    private annotateMode: ReaderQuickMode | null = null;
    /** 模式型快捷按钮引用（切模式时统一 toggle `rl-quick-active`） */
    private quickBtns: Partial<Record<ReaderQuickMode, HTMLButtonElement>> = {};
    /** 译文卡 + 网络搜索浮层（共用件见 `modals/ReaderOverlays`） */
    private overlays: ReaderOverlays;
    /**
     * 阅读模式：`'continuous'` 连续滚动（缺省）/ `'paged'` 一次一页。
     * 🔴 与 TXT/EPUB 共用 `pure/paged.ScrollMode` 与同一个设置键，⛔ 别另起枚举。
     */
    private mode: ScrollMode = 'continuous';
    /** 阅读模式分段控制器（设置下拉里那一行） */
    private modeSeg: HTMLElement | null = null;

    // ── 2026-10-23 路线 A：PDF 高亮 ──

    /** 本会话的高亮副本（初值取 options.highlights；任何变更都整份交给宿主落库） */
    private highlightList: ReaderHighlight[] = [];
    /** 高亮列表容器（标注 pane 第 Ⅱ 区） */
    private hlListEl: HTMLDivElement | null = null;
    /** 当前样式/颜色（会话态；选一次后作为下次默认，与 TXT/EPUB 同口径） */
    private hlStyle: HlStyle = DEFAULT_HL_STYLE;
    private hlColor: HlColor = DEFAULT_HL_COLOR;
    /** 选区动作条（`rl-selbar`，挂在 .rl-reader-body 上绝对定位） + 定位父级 */
    private selbar: HTMLDivElement | null = null;
    private selbarParent: HTMLElement | null = null;
    /** 动作条上的高亮按钮（tip 随选区是否命中已有高亮改为「取消高亮」） */
    private selbarHlBtn: HTMLButtonElement | null = null;
    /** 样式色板浮层（`.rl-hl-picker`）+ 按钮表 + 垃圾桶 */
    private hlPickerEl: HTMLDivElement | null = null;
    private hlStyleBtns: Partial<Record<HlStyle, HTMLButtonElement>> = {};
    private hlColorBtns: Partial<Record<HlColor, HTMLButtonElement>> = {};
    private hlTrashBtn: HTMLButtonElement | null = null;
    /** 色板锚点（鼠标 client 坐标；null = 贴动作条上方） */
    private hlPickerAnchor: { x: number; y: number } | null = null;
    /** 本次选区记录（text 在被点按钮时已被浏览器清掉，必须提前存） */
    private selRecord: { text: string; pageIndex: number; rects: PdfRelRect[] } | null = null;
    /** 选区命中的已有高亮 id（垃圾桶显隐/直删用；几何判定） */
    private selHighlightId: string | null = null;

    // ── 2026-10-23：PDF 摘抄就地卡片（与 TXT/EPUB 同一套 .rl-excard 结构，由 pure/excerptCard 定落位） ──
    private excerptCard: HTMLDivElement | null = null;
    private excerptQuoteEl: HTMLDivElement | null = null;
    private excerptLocEl: HTMLDivElement | null = null;
    private excerptMoreBtn: HTMLButtonElement | null = null;
    private excerptNoteEl: HTMLTextAreaElement | null = null;
    private excerptSaveBtn: HTMLButtonElement | null = null;
    /** 卡片待写入内容（选区文本 + 页码/页内比例；卡片关闭后清空） */
    private excerptCardQuote = '';
    private excerptCardLoc: { chapter: number; pct: number } | null = null;

    constructor(
        private container: HTMLElement,
        private scope: Scope,
        private options: PdfReaderOptions,
        private closeView: () => void,
    ) {
        this.theme = normalizeReaderTheme(options.theme);
        // 2026-10-23：阅读模式与缩放都从设置恢复（两个都是「用户上次调过的值」，必须记住）
        this.mode = normalizeScrollMode(options.scrollMode);
        const initScale = options.scale;
        if (typeof initScale === 'number' && Number.isFinite(initScale)) {
            this.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(initScale * 100) / 100));
        }
        // 译文卡/网络搜索浮层：懒建 DOM，挂 `selbarParent`（= body，buildBody 里赋值）
        this.overlays = new ReaderOverlays(
            {
                translate: (text) => this.options.onTranslate?.(text) ?? Promise.resolve(null),
                openExternal: (url) => this.options.onOpenExternal?.(url),
            },
            () => this.selbarParent,
        );
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
        // 🔴 翻页模式必须在 buildBody 之后立刻补类（持久化设置是 paged 时，重开要直接是翻页外观）：
        //    旧版只在 setMode 里 toggleClass ⇒ 从设置恢复的 paged 永远没有配套 CSS 类，
        //    用户看到的就是「切换翻页模式不生效，始终是滚动模式」。
        this.scrollEl.toggleClass('rl-pdf-paged', this.isPaged());
        // 底部工具条：页码 + 全书进度条 + 已读百分比（对齐 TXT/EPUB 底栏；body 之后，.rl-reader 纵向排列）
        this.buildFooter();
        void this.load();

        // 面板外 mousedown 收起设置下拉（菜单/按钮自身已 stopPropagation）
        document.addEventListener('mousedown', this.onDocMouseDown);
        // 沉浸模式：点击正文空白收起 / 展开上下边栏；自动滚动期间用户滚轮 / 触摸即停
        this.scrollEl.addEventListener('click', this.onBodyClick);
        // Ctrl/⌘+滚轮调页面缩放（2026-10-23 用户指令：三阅读器统一支持滚轮改显示大小）。
        // 🔴 挂在 **scrollEl** 而不是 container：container 上那条是 `onUserInterrupt`（passive，只负责停自动滚动），
        //    passive 监听无法 preventDefault ⇒ Obsidian 会把 Ctrl+滚轮当整页缩放，阅读器自己的缩放就听不见了。
        // 📌 PDF 这里是「页面缩放」（不是字号），因为 PDF 的版式由页面尺寸决定、没有流式字号概念。
        this.scrollEl.addEventListener(
            'wheel',
            (ev) => {
                if (!ev.ctrlKey && !ev.metaKey) return;
                ev.preventDefault();
                this.adjustScale(ev.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
            },
            { passive: false },
        );
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
            if (this.isPaged()) this.goNextPage();
            else this.scrollToPage(this.currentPageIndex() + 1);
            return false;
        });
        this.scope.register([], 'ArrowLeft', () => {
            if (this.isPaged()) this.goPrevPage();
            else this.scrollToPage(this.currentPageIndex() - 1);
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

    /** 面板外 mousedown：收起设置下拉 + 按钮右键弹窗（≡ mousedown 已 stopPropagation，不会立即收起）
     *  + 收起选中动作条/色板（动作条与色板自身已 stopPropagation，不会误收起）
     *  + 收起摘抄卡片（卡片自身 mousedown 已 stopPropagation，点卡内不会误收起） */
    private onDocMouseDown = (): void => {
        this.hideSettings();
        this.closePop();
        this.hideSelbar();
        this.hideExcerptCard();
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
        this.disposeFade?.(); // 侧栏溢出渐隐的 scroll/RO/MO 监听随面板注销
        this.disposeFade = null;
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
        // 框选层是 fixed 遮罩、挂在 document.body 上 —— 面板没了它必须一起收（否则整窗点不动）
        this.shotOverlay?.destroy();
        this.shotOverlay = null;
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
        // 🔴 2026-10-25 文案统一：翻页 tip 对齐 TXT/EPUB（「上一页 / 下一页」）——
        //    原先 PDF 写「翻上一屏 / 翻下一屏」，四件同一动作两种说法。
        prev.setAttribute('data-tip', '上一页');
        prev.addEventListener('click', () => (this.isPaged() ? this.goPrevPage() : this.scrollOneScreen(-1)));

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
        // 🔴 #603：提示文案改走**四件共用**的真源 `pure/readerFops`（PDF 原先写「点空白收起」、TXT/EPUB 写
        //    「移到边缘唤出」—— 同一件事两种说法，且后者早就过期）；自动那枚 PDF 只有滚动，用 `autoScrollOnly`。
        // 🔴 #603：沉浸 / 自动推进的提示都走**四件共用**的真源 `pure/readerFops`。
        // 2026-10-23：PDF 本批补了「滚动 / 翻页」双模式 ⇒ 自动推进改用 `autoScrollPaged`
        //   （原 `autoScrollOnly` 的前提「PDF 只有连续滚动」已不成立，该常量已删除）。
        this.immersiveBtnEl = mkFop('eye', READER_FOPS.immersive, () => this.setImmersive(!this.immersive));
        this.autoBtnEl = mkFop('timer', READER_FOPS.autoScrollPaged, () => this.setAuto(!this.autoOn));
        this.autoBtnEl.addEventListener('contextmenu', (ev) => this.openAutoMenu(ev));
        if (!document.fullscreenEnabled) {
            this.fsBtnEl.disabled = true;
            this.fsBtnEl.setAttribute('data-tip', '当前环境不支持全屏');
        }

        // ④ 右端：翻下一屏
        const navR = footer.createDiv({ cls: 'rl-reader-fnav rl-reader-fnav-r' });
        const next = navR.createEl('button', { cls: 'rl-btn rl-reader-btn' });
        safeSetIcon(next, 'chevron-right');
        // 🔴 2026-10-25 文案统一：同左侧，对齐 TXT/EPUB 的「下一页」。
        next.setAttribute('data-tip', '下一页');
        next.addEventListener('click', () => (this.isPaged() ? this.goNextPage() : this.scrollOneScreen(1)));
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
        // 快捷入口（2026-10-23 用户指令：PDF 顶栏同步 TXT/EPUB 的快捷功能，并按下述顺序展示）：
        //   **书签 · 高亮 · 摘抄 · 区域截图 · 翻译 · 网络搜索**（第 7 项「设置」= 右侧 ≡ 按钮）
        // 🔴 顺序是用户明确的契约，由下面的调用顺序表达 —— ⛔ 别按字母/图标重排。
        // 交互口径与 TXT/EPUB 一致：**书签**是一键存当前位置（PDF 位置即当前页，无需选区）；
        // 其余四项进「模式」——点亮后拖选正文即执行，再点一次退出（见 `setAnnotate`）。
        //   🔴 放在 `ops` 内、≡ 之前 —— 与 TXT/EPUB 的快捷入口同一位置（#345 起的位置契约）。
        const quick = ops.createDiv({ cls: 'rl-reader-quick' });

        // ① 快捷书签：PDF 位置就是「当前页 + 页内比例」⇒ 一键存，不需要选区（与另两个有意不同）
        // 🔴 它是**一次性动作**，⛔ 不进 annotateMode —— 故传 onClick 覆盖默认的模式切换。
        this.bmBtnEl = this.mkQuick(quick, 'bookmark', 'bookmark', '存书签：一键记下当前页', () => this.addBookmark());

        // ② 快捷高亮 / ③ 快捷摘抄 —— 进模式后选中正文即生效
        // 🔴 2026-10-25 文案统一：措辞一律对齐 TXT / EPUB（「选中文字即…」）——
        //    四件同一件事必须同一句话，⛔ 别再写「拖选正文即…」这种同义不同辞的第二份。
        this.mkQuick(quick, 'highlighter', 'highlighter', '高亮模式：选中文字即高亮，再点退出');
        this.mkQuick(quick, 'quote', 'quote', '摘抄模式：选中文字即加摘抄，再点退出');

        // ④ 区域截图（2026-10-23）：拖框 → 宿主 capturePage 取像素 → 写笔记「## 阅读截图」。
        // 🔴 面板只交矩形 + 定位，不碰 vault / electron（见 `options.onShotSave` 注释）。
        // 🔴 一次性动作，⛔ 不走 `mkQuick`/`toggleAnnotate`（那不是模式，点一次框一次）。
        if (this.options.onShotSave) {
            const shotBtn = quick.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': '区域截图：框选区域截图回填笔记内' } });
            safeSetIcon(shotBtn, 'image');
            shotBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
            shotBtn.addEventListener('click', () => this.startShot());
        }

        // ⑤ 文本翻译 / ⑥ 网络搜索 —— 进模式后选中正文即弹浮层
        // 🔴 2026-10-25：措辞对齐 TXT/EPUB（原先 PDF 写「拖选正文即…」，同义不同辞）。
        // ⚠️ **这里没有 ⑦ AI 搜索**，是**真实功能缺口**，不是文案遗漏：
        //    TXT/EPUB 的 AI 搜索 = `onAiSearch` 选项 + `runAiSearch()` + 一整套搜索卡片 UI
        //    （提问框 / 答案正文 / loading / error 四态）。PDF 这三样**一样都没有**，options 里也没接
        //    —— 加一枚按钮只会点下去毫无反应，比没有更糟。要补得整条链路一起补（含 main.ts 传 onAiSearch）。
        this.mkQuick(quick, 'languages', 'languages', '翻译模式：选中文字即翻译，再点退出');
        this.mkQuick(quick, 'netsearch', 'globe', '网络搜索模式：拖选文字后选搜索引擎，再点退出');

        // ⑧ 设置（≡）：缩放滑条 / 阅读模式 / 主题 / 全屏（下拉菜单，对齐 EPUB 观感）
        this.settingsBtn = ops.createEl('button', { cls: 'rl-btn rl-reader-btn rl-reader-settings', attr: { 'data-tip': '设置' }, text: '≡' });
        this.settingsBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.buildSettingsMenu(ops);

        // #379：标题绝对居中，宽度按实测两侧边缘算
        this.disposeHeadTitle = attachHeadTitle({ headEl: head, opsEl: ops, titleEl: titleWrap });
    }

    /**
     * 建一个「模式型」快捷按钮（高亮/摘抄/翻译/网络搜索共用）。
     * 🔴 图标名 ≠ 模式 id（`netsearch` 的图标是 `globe`），故 icon 单独传。
     */
    private mkQuick(
        wrap: HTMLElement,
        id: Exclude<ReaderQuickMode, 'bookmark'> | 'bookmark',
        icon: string,
        tip: string,
        onClick?: () => void,
    ): HTMLButtonElement {
        const b = wrap.createEl('button', { cls: 'rl-btn rl-reader-btn', attr: { 'data-tip': tip } });
        safeSetIcon(b, icon);
        b.addEventListener('mousedown', (ev) => ev.stopPropagation());
        // 🔴 传了 onClick 就是**一次性动作**（如书签），不进 annotateMode；不传才是模式开关。
        b.addEventListener('click', () => (onClick ? onClick() : this.toggleAnnotate(id)));
        this.quickBtns[id] = b;
        return b;
    }

    /** 切换模式型快捷按钮：再点同一个 = 退出；点别的 = 直接换过去（永远只有一个亮） */
    private toggleAnnotate(kind: ReaderQuickMode): void {
        this.setAnnotate(this.annotateMode === kind ? null : kind);
    }

    /** 设定当前标注模式：同步按钮亮态 + 清掉上一种模式留下的浮层 */
    private setAnnotate(kind: ReaderQuickMode | null): void {
        this.annotateMode = kind;
        for (const [id, b] of Object.entries(this.quickBtns)) {
            b?.toggleClass('rl-quick-active', id === kind);
        }
        // 切模式/退出时把另一模式的浮层收掉，免两个浮层叠在一起
        if (kind !== 'languages') this.overlays.hideTranslate();
        if (kind !== 'netsearch') this.overlays.hideNet();
        if (kind) this.hideSelbar();
    }

    /** 退出标注模式（切章 / 点「取消」/ 面板失焦时调用） */
    private resetAnnotate(): void {
        if (this.annotateMode) this.setAnnotate(null);
        this.overlays.hideNet();
        this.overlays.hideTranslate();
    }

    /** 设置下拉菜单（追加到 ops 下，CSS 绝对定位右对齐）：缩放滑条 + 阅读模式 + 主题 + 全屏。
     *  2026-10-23 起 PDF 也支持「翻页 / 滚动」双模式（用户指令），菜单里多一行分段控制器。 */
    private buildSettingsMenu(ops: HTMLElement): void {
        const menu = ops.createDiv({ cls: 'rl-reader-menu hidden' });
        this.menuEl = menu;
        menu.addEventListener('mousedown', (ev) => ev.stopPropagation());

        // 🔴 2026-10-24 统一：分组标题「显示」+ 组容器，与 TXT / EPUB 完全同构
        //   （旧版 PDF 没有分组标题，菜单顶边直接贴着「缩放」行；行也直接挂菜单，
        //    而 TXT/EPUB 的行在 `.rl-reader-menu-group` 里 —— 两套 DOM 结构 ⇒ 行疏密不同）。
        menu.createDiv({ cls: 'rl-reader-menu-sec', text: '显示' });
        const group = menu.createDiv({ cls: 'rl-reader-menu-group' });

        // 缩放行（PDF **无字号概念** ⇒ 这一行调的是**页面缩放**，标签就叫「缩放」；
        // ⚠️ 旧标签写的是「字号」，与实际行为不符 ⇒ #382 改正，⛔ 别再写回「字号」）：滑条 50%-300% 步进 25% + 当前百分比文本。
        // ⚠️ PDF 缩放会清空并重渲染所有页，拖动过程只更新数值文本，松手（change）才真正应用。
        const fontRow = group.createDiv({ cls: 'rl-reader-menu-row' });
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

        // 阅读模式行（2026-10-23 用户指令：PDF 要「翻页模式 + 滚动模式」两种阅读方式）。
        // 🔴 与 TXT/EPUB 同一个分段控制器样式（`.rl-seg rl-seg-text`）与同一套 ScrollMode 取值，
        //    ⛔ 别为 PDF 造第三套模式名 —— 用户切的是「阅读模式」这一个概念，设置键共用一个。
        const modeRow = group.createDiv({ cls: 'rl-reader-menu-row' });
        modeRow.createSpan({ cls: 'rl-reader-menu-label', text: '阅读' });
        this.modeSeg = this.buildSeg(modeRow, SCROLL_OPTIONS, this.mode, (v) => this.setMode(v as ScrollMode));

        // 主题（用户 2026-09-16）：六档色卡并排 —— 跟随主题 / 经典白 / 夜间黑 / 护眼绿 / 深灰 / 羊皮纸；
        // 点击即换肤（容器变量覆盖）+ 写回设置；当前档加强调色外圈环（PDF 页面本体按原样渲染，只换阅读区底色）
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
     * 右键弹窗：自动推进的**速度 / 间隔**（#341 用户指令）。
     * 2026-10-23：PDF 有了翻页模式 ⇒ 按当前模式二选一 —— 连续态给 px/s 滑条、翻页态给 ms 滑条
     * （与 TXT/EPUB 同一口径；⛔ 别在翻页态给 px/s，那对定时翻页毫无意义）。
     */
    private openAutoMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.autoBtnEl;
        if (!btn) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
        if (this.isPaged()) {
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
                // 已在自动翻页中 ⇒ 立刻按新间隔重排定时器
                if (this.autoOn && this.autoTimer !== null) {
                    window.clearInterval(this.autoTimer);
                    this.autoTimer = null;
                    this.startAutoTimer();
                }
            });
            return;
        }
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

    /** 打开/关闭自动推进：连续态匀速滚动（rAF）、翻页态定时翻页（2026-10-23 PDF 有了翻页模式）；再点停止 */
    private setAuto(on: boolean): void {
        if (on === this.autoOn) return;
        this.stopAuto();
        if (on) {
            this.autoOn = true;
            if (this.isPaged()) this.startAutoTimer();
            else this.startAutoScroll();
        }
        // 🔴 #382 修（同上「沉浸」那处）：自动按钮自 #382 起在**底栏**（常显）⇒ 状态同步不得带设置菜单门。
        this.syncViewBtns();
    }

    /** 模式切换后重启自动推进（连续态 rAF / 翻页态定时器，两条实现不同） */
    private restartAutoIfOn(): void {
        if (!this.autoOn) return;
        this.stopAuto();
        this.autoOn = true;
        if (this.isPaged()) this.startAutoTimer();
        else this.startAutoScroll();
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

    /** 开始自动翻页（定时 `goNextPage`；到全书末页自动停）；间隔可在右键弹窗里调 */
    private startAutoTimer(): void {
        if (this.autoTimer !== null) return;
        this.autoTimer = window.setInterval(() => this.autoTurnTick(), this.autoTurnMs);
    }

    /** 自动翻页一拍：末页 → 停并提示；否则翻下一页 */
    private autoTurnTick(): void {
        if (!this.autoOn) return;
        if (this.currentPageIndex() >= this.numPages - 1) {
            this.stopAuto();
            this.syncViewBtns();
            new Notice('已读完全书');
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
        // 选中动作条 / 色板的定位上下文（与 TXT 阅读器同招：挂在 body 上绝对定位，
        // 不随 .rl-pdf-scroll 滚动位移 —— 挂在滚动容器里动作条会跟着页面滚走）
        body.style.position = 'relative';
        this.selbarParent = body;

        // 左侧目录列：`目录 | 标注` 两个 tab（2026-10-23 用户指令：三阅读器侧栏统一）
        // 🔴 用户原话：「统一为『目录』和『书签/高亮/摘抄』两个选项卡，其中书签、高亮、摘抄合并展示」
        //    ⇒ 第二页签内部把三区纵向排开（各自带计数 + 多选删除），⛔ 别再拆回四个平级 tab ——
        //    TXT/EPUB 早就是这个形态（`.rl-reader-ex-pane` + 三个 `buildAnnoHead`），PDF 此前是例外。
        this.tocEl = body.createDiv({ cls: 'rl-reader-toc' });
        const tabs = this.tocEl.createDiv({ cls: 'rl-reader-toc-tabs' });
        const tocTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab active', attr: { 'data-tip': '文档目录' } });
        safeSetIcon(tocTab, 'list-tree');
        const exTab = tabs.createEl('button', { cls: 'rl-reader-toc-tab', attr: { 'data-tip': '书签 · 高亮 · 摘抄' } });
        safeSetIcon(exTab, 'quote');
        const tocPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane' });
        this.tocListEl = tocPane.createDiv({ cls: 'rl-reader-toc-list' });
        // 标注 pane（书签 / 高亮 / 摘抄三区纵向排列，各带「计数 + 选择/全选/删除所选/取消」）
        const exPane = this.tocEl.createDiv({ cls: 'rl-reader-toc-pane rl-reader-ex-pane hidden' });
        // Ⅰ 书签区
        this.bmHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-bm-list',
            text: '书签（0）',
            onDelete: (ids) => this.deleteSelectedBookmarks(ids),
            allIds: () => this.bookmarks.map((b) => b.id),
            refresh: () => this.buildBookmarkToc(),
        });
        this.bmListEl = this.bmHeadRef.listEl;
        // Ⅱ 高亮区
        this.hlHeadRef = buildAnnoHead(exPane, {
            countCls: 'rl-reader-ex-hlcount',
            listCls: 'rl-reader-hl-list',
            text: '高亮（0）',
            extraCls: 'rl-reader-ex-head',
            onDelete: (ids) => this.deleteSelectedHighlights(ids),
            allIds: () => this.highlightList.map((h) => h.id),
            refresh: () => this.buildHighlightToc(),
        });
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
        this.exListEl = this.exHeadRef.listEl;
        const setTab = (which: 'toc' | 'ex'): void => {
            tocTab.toggleClass('active', which === 'toc');
            exTab.toggleClass('active', which === 'ex');
            tocPane.toggleClass('hidden', which !== 'toc');
            exPane.toggleClass('hidden', which !== 'ex');
            // 切到标注页签要展开侧栏（否则用户点了个 tab 却看不到列表，以为是死的）
            if (which !== 'toc') this.tocEl.removeClass('collapsed');
            // pane 由 display:none 恢复显示时 ROS 未必回调 ⇒ 补一枪，否则首次切页签没有渐隐提示
            resyncScrollFade(which === 'toc' ? this.tocListEl : exPane);
        };
        tocTab.addEventListener('click', () => setTab('toc'));
        exTab.addEventListener('click', () => setTab('ex'));
        this.bookmarks = [...(this.options.bookmarks ?? [])];
        this.buildBookmarkToc();
        this.highlightList = [...(this.options.highlights ?? [])];
        this.buildHighlightToc();
        this.buildExcerptToc();
        // 首次打开即收起（对齐 TXT/EPUB；点顶栏图标或按 T 展开）
        if (this.tocCollapsed) this.tocEl.addClass('collapsed');
        // 🔴 2026-10-25：初态必须同步一次开关图标 —— 否则收起态下图标仍是 `panel-left-close`（意为「收起」），
        //    与 TXT/EPUB 的「收起态显 panel-left-open」相反。
        this.syncSidebarToggle();
        // #382：目录栏**右缘可拖宽**（#339 那套：只写 CSS 变量 + localStorage 记忆，无返回值可 dispose）
        // —— 与 TXT/EPUB 同款，此前 PDF 缺这一件，是「看着不像同一套 UI」的另一处。
        attachTocResizer(this.tocEl, 'pdf');
        // 侧栏滚动条刻意隐藏 ⇒ 溢出时没有线索（末行被裁一半）。门控渐隐挂两个真滚容器：
        // 目录页 = tocPane 内的 .rl-reader-toc-list（与 TXT/EPUB 同构），标注页 = exPane 本人。
        this.disposeFade = attachScrollFades([this.tocListEl, exPane]);

        // 右侧滚动容器（连续滚动；textLayer 选中需要 user-select，防 Obsidian 全局拦截）
        // 右侧栏：正文 + 底栏同处一栏（目录栏因而独立成一整列，用户 2026-09-16）
        const mainCol = body.createDiv({ cls: 'rl-reader-main' });
        const frameWrap = mainCol.createDiv({ cls: 'rl-reader-frame' });
        this.scrollEl = frameWrap.createDiv({ cls: 'rl-pdf-scroll' });
        // 滚动实时刷新底栏进度/页码（此前 onScroll 未绑定，进度只在跨页/恢复等时机更新）
        this.scrollEl.addEventListener('scroll', this.onScroll);
        // 滚动即收起动作条/色板（选区已不对应当前屏幕 —— 与 TXT 阅读器同口径）
        this.scrollEl.addEventListener('scroll', () => {
            this.hideSelbar();
        });
        // 正文选中（mouseup）→ 弹动作条；挂滚动容器上（页内 mouseup 冒泡上来），
        // 拖到页间空隙/页边距松手也能收起，不产生「有选区无动作条」的死态
        this.scrollEl.addEventListener('mouseup', (ev) => this.onTextMouseUp(ev));
        // 翻页模式滚轮切页（2026-10-23 用户指令：PDF 要「翻页模式」）：
        // Ctrl/⌘+滚轮是缩放（上面那条已接管），这里只处理普通滚轮；无选区 + 超阈值才翻，防误触。
        this.scrollEl.addEventListener(
            'wheel',
            (ev) => {
                if (ev.ctrlKey || ev.metaKey) return; // 缩放那条已 preventDefault
                if (!this.isPaged()) return;
                if (window.getSelection()?.toString().trim()) return;
                if (Math.abs(ev.deltaY) < 24) return;
                ev.preventDefault();
                if (ev.deltaY > 0) this.goNextPage();
                else this.goPrevPage();
            },
            { passive: false },
        );
        this.pagesEl = this.scrollEl.createDiv({ cls: 'rl-pdf-pages' });
        // 加载中占位
        const loadingEl = this.pagesEl.createDiv({ cls: 'rl-pdf-loading' });
        loadingEl.createSpan({ cls: 'rl-spinner rl-spinner-lg' }); // 1.0.4：解析期间的内联 spinner
        loadingEl.createSpan({ text: '正在加载 PDF…' });

        // 选中动作条（初始隐藏；与 TXT 阅读器同一套类名/按钮工厂）
        this.selbar = this.buildSelbar();
        body.appendChild(this.selbar);
    }

    // ── 加载与渲染 ──

    private async load(): Promise<void> {
        try {
            const pdfjsLib = await getPdfjs();
            this.pdfjs = pdfjsLib;
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
            // 翻页模式：初始就把「当前页」标出来（否则整片页面全 hidden —— 用户会以为白屏）
            this.markCurrentPage(this.currentPageIndex());
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
            // render 参数仍是 canvasContext（2026-10-22 在 Obsidian 自带 5.3.34 上实测：
            // 传 canvasContext 正常，传 canvas 会报 "Cannot read properties of undefined (reading 'canvas')"）；
            // HiDPI 由上方 ctx 预变换承载
            const renderTask = page.render({ canvasContext: ctx, viewport });
            pv.renderTask = renderTask;
            const pdfjsLib = this.pdfjs;
            const done = renderTask.promise.then(() => {
                pv.renderTask = null;
                // 文本层（选中摘抄；textLayer div 覆盖 canvas）
                const tl = pv.el.createDiv({ cls: 'textLayer' });
                tl.style.width = `${viewport.width}px`;
                tl.style.height = `${viewport.height}px`;
                try {
                    if (!pdfjsLib) throw new Error('pdfjs 未就绪');
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
                        // 高亮覆盖层：页面离屏销毁后重建，必须每次渲染完补画（不画就「缩放后高亮没了」）
                        this.paintHighlightLayer(i);
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

    /**
     * 页顶偏移缓存刷新（offsetTop 在高度校正后变化，滚动计算依赖）。
     *
     * 🔴 2026-10-23 修：以前是**纯页高累加**（`acc += pv.height`），漏掉了 `.rl-pdf-pages` 的
     *    `padding-top:16px` 与页间 `gap:14px` ⇒ 每页累积偏差 +14.06px。真机实测《资本论》
     *    （3022 页）`pages[289]` 模型值 316521 / DOM 实际 320583，差 4062px，
     *    于是 `scrollToPage()` 写进去的 scrollTop 落在页中，`currentPageIndex()` 立刻判回原页
     *    —— 表现就是「切了翻页模式、滚轮也拦住了，但页码纹丝不动」。
     *    改用 DOM 真值（两者的 `offsetParent` 同为 `.rl-reader-main`，相减即相对页面容器的绝对顶部），
     *    这样缩放 / 换行 / 边距变化都不会再漂。
     */
    private refreshPageTops(): void {
        const base = this.pagesEl.offsetTop;
        // 可量性守卫：容器未布局（display:none / 尚未挂载）时整列 offsetTop 都会是 0，
        // 此时 DOM 值不可信 —— 退回累加，等下次 refresh（布局就绪后）再覆盖成真值。
        const measurable = this.pages.length > 0 && (this.pages.length === 1 || this.pages[1].el.offsetTop > 0);
        if (measurable) {
            for (const pv of this.pages) pv.top = pv.el.offsetTop - base;
            return;
        }
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
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无目录' });
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
    /**
     * 进入区域截图框选态（2026-10-23 用户指令）。
     *
     * 🔴 三个要点：
     *   ① 框选区 = `.rl-pdf-scroll`（正文滚动区），⛔ 别用 `container` —— 那会把顶栏/侧栏一起框进去。
     *   ② 矩形是**视口坐标**（`ShotOverlay` 用 fixed 遮罩），直接交给宿主 `capturePage`。
     *   ③ 定位取「当前页 + 页内比例」，与书签同一套口径（`currentPageIndex` / `currentPageRatio`）。
     */
    private startShot(): void {
        const save = this.options.onShotSave;
        if (!save) return;
        if (this.shotOverlay) return;
        this.hideSelbar();
        this.hideSettings();
        const overlay = new ShotOverlay(
            this.scrollEl,
            (rect) => {
                this.shotOverlay = null;
                const idx = this.currentPageIndex();
                save(rect, { page: idx + 1, pct: Math.round(this.currentPageRatio(idx) * 100) });
            },
            () => {
                this.shotOverlay = null;
            },
        );
        this.shotOverlay = overlay;
        overlay.start('拖拽框选要截图的区域 · Esc 取消');
    }

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
        this.bmBtnEl?.setAttribute('data-tip', n ? `存书签· 已有 ${n} 个` : '存书签');
        this.bmHeadRef?.countEl.setText(annoCountText('书签', n, this.bmHeadRef.sel));
        this.syncAnnoBtns(this.bmHeadRef, n);
        if (n === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无书签' });
            return;
        }
        for (const bm of this.bookmarks) {
            const item = list.createEl('button', {
                cls: 'rl-reader-toc-item',
                attr: { 'data-tip': `第 ${bm.chapter} 页 · ${bm.pct}%` },
            });
            // 选择模式：行首勾选框（仅模式内显示，见 CSS）+ 点击改为勾选
            if (this.bmHeadRef?.sel.on) appendAnnoCheck(item, isAnnoSelItem(this.bmHeadRef.sel, bm.id));
            item.createSpan({ cls: 'rl-reader-toc-label', text: `第 ${bm.chapter} 页 · ${bm.pct}%` });
            item.addEventListener('click', () => {
                if (this.bmHeadRef?.sel.on) {
                    toggleAnnoSelItem(this.bmHeadRef.sel, bm.id);
                    this.buildBookmarkToc();
                    return;
                }
                this.jumpToBookmark(bm);
            });
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                // 选择模式内禁用右键删除，避免与勾选语义打架（与 TXT 同口径）
                if (this.bmHeadRef?.sel.on) return;
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

    // ── 2026-10-23 标注 pane 三区的多选删除（与 TXT/EPUB 同构；确认框一律走宿主 onConfirmClear） ──

    /** 同步某区的「选择 / 删除所选」按钮可用态（与 TXT 的私有同名方法逐条对齐） */
    private syncAnnoBtns(h: AnnoHeadHandles | null, total: number): void {
        if (!h) return;
        h.selectBtn.toggleClass('hidden', total === 0 && !h.sel.on);
        h.delBtn.disabled = h.sel.ids.length === 0;
    }

    /** 批量删除书签：确认一次 → 从内存列表移除 → 通知宿主落盘 → 重绘（书签只在阅读存档里，不动笔记） */
    private async deleteSelectedBookmarks(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 个书签吗？（书签只记在阅读进度文件里，之后可重新添加）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : false;
        if (!ok) return false;
        const sel = new Set(ids);
        this.bookmarks = this.bookmarks.filter((b) => !b.id || !sel.has(b.id));
        this.options.onBookmarksChange?.(this.bookmarks);
        this.buildBookmarkToc();
        new Notice(`已删除 ${ids.length} 个书签`);
        return true;
    }

    /** 批量删除高亮：确认一次 → 勾选清理 → 通知宿主落盘（走 onTrashSelection 批量通道）→ 重绘覆盖层与列表 */
    private async deleteSelectedHighlights(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条高亮吗？（将从阅读数据中移除，不可恢复）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : false;
        if (!ok) return false;
        // 🔴 必须走**批量通道**（`onTrashSelection`）：逐条调 `onDeleteHighlight` 是旧的错法 ——
        //    那个回调会为每条弹一次确认框（选 10 条 = 弹 10 次），而这里已经确认过一次了。
        await this.options.onTrashSelection?.({ highlightIds: ids, excerptIds: [] }, { quiet: true });
        const sel = new Set(ids);
        this.highlightList = this.highlightList.filter((h) => !h.id || !sel.has(h.id));
        this.applyHighlights();
        this.buildHighlightToc();
        new Notice(`已删除 ${ids.length} 条高亮`);
        return true;
    }

    /** 批量删除摘抄：确认一次 → 走宿主 onTrashSelection 批量通道（同时移除笔记区）→ 本地列表移除重绘 */
    private async deleteSelectedExcerpts(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条摘抄吗？（将从笔记「## 摘抄」区一并移除）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : false;
        if (!ok) return false;
        await this.options.onTrashSelection?.({ highlightIds: [], excerptIds: ids }, { quiet: true });
        const sel = new Set(ids);
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => !x.id || !sel.has(x.id));
        this.buildExcerptToc();
        new Notice(`已删除 ${ids.length} 条摘抄`);
        return true;
    }

    private buildExcerptToc(): void {
        const exs = this.options.excerpts ?? [];
        const list = this.exListEl;
        if (!list) return;
        this.exHeadRef?.countEl.setText(annoCountText('摘抄', exs.length, this.exHeadRef.sel));
        this.syncAnnoBtns(this.exHeadRef, exs.length);
        list.empty();
        if (exs.length === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无摘抄' });
            return;
        }
        exs.forEach((ex) => {
            const item = list.createDiv({ cls: 'rl-reader-ex-item' });
            // 选择模式：行首勾选框（仅模式内显示）+ 点击改为勾选
            if (this.exHeadRef?.sel.on) appendAnnoCheck(item, isAnnoSelItem(this.exHeadRef.sel, ex.id));
            item.createDiv({ cls: 'rl-reader-ex-quote', text: truncateQuote(ex.quote) });
            item.createDiv({
                cls: 'rl-reader-ex-loc' + (ex.loc ? '' : ' none'),
                text: ex.loc ? `第${ex.loc.chapter}页 · ${ex.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => {
                if (this.exHeadRef?.sel.on) {
                    toggleAnnoSelItem(this.exHeadRef.sel, ex.id);
                    this.buildExcerptToc();
                    return;
                }
                this.jumpExcerpt(ex);
            });
            item.addEventListener('contextmenu', async (ev) => {
                ev.preventDefault();
                if (this.exHeadRef?.sel.on) return;
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

    // ── 2026-10-23 路线 A：PDF 高亮（选区 → 动作条 → 色板 → 页内覆盖层 → 侧栏列表） ──

    /** 侧栏「高亮」区重绘（计数写进区头；空态与书签/摘抄同款 .rl-reader-ex-empty） */
    private buildHighlightToc(): void {
        const list = this.hlListEl;
        if (!list) return;
        const n = this.highlightList.length;
        this.hlHeadRef?.countEl.setText(annoCountText('高亮', n, this.hlHeadRef.sel));
        this.syncAnnoBtns(this.hlHeadRef, n);
        list.empty();
        if (n === 0) {
            list.createDiv({ cls: 'rl-reader-ex-empty', text: '暂无高亮' });
            return;
        }
        // 按页码 + 页内比例排序：列表顺序 = 阅读顺序（与 TXT 的 refreshHighlightToc 同口径）
        const sorted = [...this.highlightList].sort((a, b) => {
            const ca = a.loc?.chapter ?? 0;
            const cb = b.loc?.chapter ?? 0;
            return ca - cb || (a.loc?.pct ?? 0) - (b.loc?.pct ?? 0);
        });
        for (const hl of sorted) {
            const item = list.createDiv({ cls: 'rl-reader-hl-item' });
            item.setAttribute('data-color', hl.color ?? DEFAULT_HL_COLOR);
            // 选择模式：行首勾选框（仅模式内显示）+ 点击改为勾选
            if (this.hlHeadRef?.sel.on) appendAnnoCheck(item, isAnnoSelItem(this.hlHeadRef.sel, hl.id));
            item.createDiv({ cls: 'rl-reader-hl-quote', text: highlightLabel(hl.quote) });
            item.createDiv({
                cls: 'rl-reader-hl-loc' + (hl.loc ? '' : ' none'),
                text: hl.loc ? `第${hl.loc.chapter}页 · ${hl.loc.pct}%` : '未定位',
            });
            item.addEventListener('click', () => {
                if (this.hlHeadRef?.sel.on) {
                    toggleAnnoSelItem(this.hlHeadRef.sel, hl.id);
                    this.buildHighlightToc();
                    return;
                }
                this.jumpHighlight(hl);
            });
            item.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                if (this.hlHeadRef?.sel.on) return;
                const bid = hl.id;
                if (bid) void this.removeHighlight(bid);
            });
        }
    }

    /** 高亮跳转：页码 + 页内比例 → 滚动定位 + 一次性闪烁目标文本（复用书签那套 pendingHighlight） */
    private jumpHighlight(hl: ReaderHighlight): void {
        if (!hl.loc) {
            new Notice('该高亮无定位信息');
            return;
        }
        const pageIndex = hl.loc.chapter - 1;
        if (pageIndex < 0 || pageIndex >= this.numPages) return;
        const ratio = Math.max(0, Math.min(1, hl.loc.pct / 100));
        this.pendingHighlight = hl.quote;
        this.pendingHighlightPage = pageIndex;
        this.pendingScroll = { pageIndex, ratio };
        void this.ensureRendered(pageIndex).then(() => this.restoreScroll());
    }

    /** 删除一条高亮：宿主确认删存档 → 本地移除 → 重绘覆盖层与列表 */
    private async removeHighlight(blockId: string): Promise<void> {
        if (!this.options.onDeleteHighlight) {
            new Notice('当前阅读器不支持删除高亮');
            return;
        }
        const ok = await this.options.onDeleteHighlight(blockId);
        if (!ok) return;
        this.highlightList = this.highlightList.filter((h) => h.id !== blockId);
        this.applyHighlights();
        this.buildHighlightToc();
        new Notice('已删除该高亮');
    }

    /** 当前页索引（PageView 内已缓存 top/height；沿用面板既有实现，下文高亮定位统一用它取 loc.chapter） */
    private selectionPageEl(): { el: HTMLDivElement; index: number } | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        const start = range.startContainer;
        const node: Element | null = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
        const pageEl = node?.closest('.rl-pdf-page') as HTMLDivElement | null;
        if (!pageEl) return null;
        const index = this.findPageIndex(pageEl);
        if (index < 0) return null;
        return { el: pageEl, index };
    }

    /** 把当前浏览器选区换算成目标页内的归一化矩形（跨页选区只取落在该页的框） */
    private selectionRects(pageEl: HTMLDivElement): PdfRelRect[] {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return [];
        const rects: DOMRect[] = [];
        for (let i = 0; i < sel.rangeCount; i += 1) {
            const r = sel.getRangeAt(i);
            for (const rc of Array.from(r.getClientRects())) {
                // 跨页选区：只保留与目标页纵向重心相符的框（否则夹取后会在页底糊成一条）
                const midY = (rc.top + rc.bottom) / 2;
                if (midY < pageEl.getBoundingClientRect().top || midY > pageEl.getBoundingClientRect().bottom) continue;
                rects.push(rc);
            }
        }
        const box = pageEl.getBoundingClientRect();
        // ⚠️ 用 clientWidth/clientHeight（布局尺寸，不含 border）而不是 box.width：
        //    页容器无 transform 缩放，两者相等；用 client* 与子元素百分比定位的基准一致。
        return normalizeRects(rects, { left: box.left, top: box.top }, pageEl.clientWidth, pageEl.clientHeight);
    }

    /** 选中动作条：纯图标按钮（读屏名走 .rl-sr，悬停说明走 data-tip —— 与 TXT 阅读器同一套 UI 规范） */
    private buildSelbar(): HTMLDivElement {
        const bar = document.createElement('div');
        bar.classList.add('rl-selbar', 'hidden');
        const mkBtn = (icon: string, label: string): HTMLButtonElement => {
            const b = document.createElement('button');
            b.setAttribute('type', 'button');
            safeSetIcon(b, icon);
            b.setAttribute('data-tip', label);
            b.createSpan({ cls: 'rl-sr', text: label });
            return b;
        };
        // 顺序（2026-10-23 用户要求补摘抄）：摘抄 · 高亮 · 复制 · 垃圾桶
        // PDF 无笔记正文页 ⇒ 仍不做翻译/网络搜索/AI，只保留这四件真能用的
        const excerptBtn = mkBtn('quote', '摘抄');
        excerptBtn.addEventListener('click', () => void this.addSelExcerpt());
        const hlBtn = mkBtn('highlighter', '高亮');
        this.selbarHlBtn = hlBtn;
        hlBtn.addEventListener('click', () => void this.toggleSelHighlight());
        const copyBtn = mkBtn('copy', '复制');
        copyBtn.addEventListener('click', () => void this.copySelection());
        // 垃圾桶：仅当选区压在某条已有高亮上时露脸（危险操作不做常显，与 TXT 同裁定）
        const trashBtn = mkBtn('trash-2', '删除该高亮');
        trashBtn.addClass('rl-selbar-trash');
        trashBtn.addClass('hidden');
        trashBtn.addEventListener('click', () => void this.trashSelection());
        bar.append(excerptBtn, hlBtn, copyBtn, trashBtn);
        // 动作条自身 mousedown 不冒泡到 document：先点按钮、后由动作完成收起，避免 document 提前收起
        bar.addEventListener('mousedown', (ev) => ev.stopPropagation());
        return bar;
    }

    /** 正文 mouseup：有非空选区 → 记录文本+页内矩形并弹动作条；空选/点击 → 收起。
     *  2026-10-23：若已点亮顶栏某个快捷模式（高亮/摘抄/翻译/网络搜索）→ 直接就地执行，不再弹动作条。 */
    private onTextMouseUp = (ev: MouseEvent): void => {
        const text = window.getSelection()?.toString().trim();
        if (!text) {
            this.hideSelbar();
            return;
        }
        const hit = this.selectionPageEl();
        if (!hit) {
            this.hideSelbar();
            return;
        }
        const rects = this.selectionRects(hit.el);
        this.selRecord = { text, pageIndex: hit.index, rects };
        // 选区时刻判定是否压在已有高亮上（点按钮时选区已被清，只能提前算）
        this.selHighlightId = this.findHighlightAt(hit.index, rects)?.id ?? null;
        // 模式优先：点亮模式后拖选 = 直接执行（与 TXT/EPUB 的 annotateMode 交互一致）
        if (this.annotateMode) {
            this.dispatchAnnotate(ev);
            return;
        }
        this.syncSelbarHlTip();
        this.showSelbarAt(ev);
    };

    /**
     * 把当前选区交给已点亮的快捷模式执行（与 TXT/EPUB 的 `dispatchAnnotate` 同构）。
     * 🔴 已点亮的模式只做**一件事**就够：这里不清选区 —— 翻译/网络搜索要看得见选中哪段，
     *    高亮/摘抄各自内部处理（高亮建完清选区，摘抄卡片保留引用文本）。
     */
    private dispatchAnnotate(ev: MouseEvent): void {
        const rec = this.selRecord;
        const mode = this.annotateMode;
        if (!rec || !mode) return;
        const page = rec.pageIndex + 1;
        const pct = rec.rects.length > 0 ? Math.round(rec.rects[0].y * 100) : 0;
        const anchor = this.selbarAnchorClient() ?? { x: ev.clientX, y: ev.clientY };
        const pRect = this.selbarParent?.getBoundingClientRect();
        const local = pRect ? { x: anchor.x - pRect.left, y: anchor.y - pRect.top } : { x: 0, y: 0 };
        switch (mode) {
            case 'highlighter':
                this.hideSelbar();
                void this.doHighlight(rec.text, page, pct, rec.rects, this.hlStyle, this.hlColor);
                window.getSelection()?.removeAllRanges();
                break;
            case 'quote':
                this.hideSelbar();
                this.showExcerptCard(rec.text, { chapter: page, pct }, anchor);
                window.getSelection()?.removeAllRanges();
                break;
            case 'languages':
                this.overlays.showTranslate(local.x, local.y, rec.text);
                break;
            case 'netsearch':
                this.overlays.showNet(rec.text, local);
                break;
            case 'bookmark':
                // 书签不是选区动作（PDF 位置 = 当前页）—— 顶栏那个按钮是一键存，不会走到这里
                break;
            default:
                break;
        }
    }

    /** 动作条高亮按钮文案 + 垃圾桶显隐 */
    private syncSelbarHlTip(): void {
        const b = this.selbarHlBtn;
        if (!b) return;
        const label = this.selHighlightId ? '取消高亮' : '高亮';
        b.setAttribute('data-tip', label);
        const sr = b.querySelector('.rl-sr');
        if (sr) sr.textContent = label;
        const trash = this.selbar?.querySelector('.rl-selbar-trash');
        trash?.classList.toggle('hidden', !this.selHighlightId);
        this.hlTrashBtn?.toggleClass('hidden', !this.selHighlightId);
    }

    /** 在指定页的已有高亮里找与矩形组重叠的那条（几何判定：PDF 没有 mark 元素可查） */
    private findHighlightAt(pageIndex: number, rects: PdfRelRect[]): ReaderHighlight | null {
        if (rects.length === 0) return null;
        const page = pageIndex + 1;
        for (const hl of this.highlightList) {
            if ((hl.loc?.chapter ?? -1) !== page) continue;
            if (hl.rects && hl.rects.length > 0 && rectsOverlap(rects, hl.rects)) return hl;
        }
        return null;
    }

    private showSelbarAt(ev: MouseEvent): void {
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!bar || !parent) return;
        bar.removeClass('hidden');
        const pRect = parent.getBoundingClientRect();
        const bRect = bar.getBoundingClientRect();
        const gap = 8;
        const left = Math.min(Math.max(ev.clientX - pRect.left, 4), Math.max(4, pRect.width - bRect.width - 4));
        let top = ev.clientY - pRect.top - bRect.height - gap;
        if (top < 4) top = ev.clientY - pRect.top + gap; // 选区上方放不下 → 转下方
        bar.style.left = `${Math.round(left)}px`;
        bar.style.top = `${Math.round(Math.max(4, Math.min(top, pRect.height - bRect.height - 4)))}px`;
    }

    /** 收起动作条 + 色板并清空选区记录（不动浏览器选区高亮） */
    private hideSelbar(): void {
        this.selbar?.addClass('hidden');
        this.selRecord = null;
        this.selHighlightId = null;
        this.hideHlPicker();
    }

    /** 复制选区文本（PDF 的文本层是透明 span，浏览器原生复制也能用；这里给个明确反馈） */
    private async copySelection(): Promise<void> {
        const text = this.selRecord?.text ?? window.getSelection()?.toString() ?? '';
        if (!text.trim()) return;
        try {
            await navigator.clipboard.writeText(text);
            new Notice('已复制');
        } catch {
            new Notice('复制失败，请用系统快捷键');
        }
        window.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    /** 动作条「❝ 摘抄」：收起动作条 → 就地弹出摘抄卡片（在卡里写想法，Ctrl/⌘+Enter 保存）；无回调则提示 */
    private addSelExcerpt(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        // 动作条收起前取它的位置作卡片锚点（client 坐标 → 卡片落在刚点的按钮上方）
        const anchor = this.selbarAnchorClient();
        // PDF 的 loc.chapter 沿用全书口径 = 页码 1 基（与摘抄/书签/高亮列表同一套文案「第N页 · P%」）
        const pct = rec.rects.length > 0 ? Math.round(rec.rects[0].y * 100) : 0;
        this.hideSelbar();
        this.showExcerptCard(rec.text, { chapter: rec.pageIndex + 1, pct }, anchor);
    }

    // ── 2026-10-23：摘抄就地卡片（与 TXT/EPUB 同一套 .rl-excard 结构；纯逻辑在 pure/excerptCard） ──

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

    /** 懒建摘抄卡片（挂动作条同一父级；卡片自身 mousedown 不冒泡 → 点卡内不触发 onDocMouseDown 收起） */
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
        // 输入法组合态不提交（中文选词的 Enter 不是命令）—— 判据统一走 pure/excerptCard。
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
        const save = foot.createEl('button', {
            cls: 'rl-excard-btn rl-excard-save',
            attr: { type: 'button', 'data-tip': '保存（Ctrl/⌘+Enter）' },
            text: '保存摘抄',
        });
        save.addEventListener('click', () => void this.submitExcerptCard());
        this.excerptSaveBtn = save;
        this.excerptCard = card;
        return card;
    }

    /** 就地弹出摘抄卡片（anchor = 宿主 client 坐标；Ctrl/⌘+Enter 保存、点正文其他区域取消） */
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
        this.excerptLocEl?.setText(excerptCardLocLabel(this.options.title, loc, '页'));
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

    /** 收起卡片并丢弃待写入内容（点正文其他区域 / 取消 / 保存成功后） */
    private hideExcerptCard(): void {
        this.excerptCard?.addClass('hidden');
        this.excerptCardQuote = '';
        this.excerptCardLoc = null;
    }

    /** 卡片是否打开（Esc 分派用：打开时只收卡片，不关整个阅读器） */
    private isExcerptCardOpen(): boolean {
        return Boolean(this.excerptCard && !this.excerptCard.hasClass('hidden'));
    }

    /** 保存卡片内容：成功收起卡片 + 清选区残影，并把新摘抄注入侧栏列表；失败保留输入并解禁按钮重试 */
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
            window.getSelection()?.removeAllRanges();
        } else {
            btn?.removeAttribute('disabled');
        }
    }
    /** 样式色板（复用 TXT 那套 .rl-hl-picker / .rl-hl-style / .rl-hl-color 类名，样式天然一致） */
    private buildHlPicker(): HTMLDivElement | null {
        if (this.hlPickerEl) return this.hlPickerEl;
        const parent = this.selbarParent;
        if (!parent) return null;
        const p = parent.createDiv({ cls: 'rl-hl-picker hidden' });
        p.addEventListener('mousedown', (ev) => ev.stopPropagation());
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
        const trash = p.createEl('button', { cls: 'rl-hl-trash hidden', attr: { type: 'button', 'data-tip': '删除这段' } });
        safeSetIcon(trash, 'trash-2');
        trash.addEventListener('mousedown', (ev) => ev.stopPropagation());
        trash.addEventListener('click', () => void this.trashSelection());
        this.hlTrashBtn = trash;
        this.hlPickerEl = p;
        return p;
    }

    /** 浮出色板（默认贴动作条上方；anchor = 宿主 client 坐标时以鼠标为锚点） */
    private showHlPicker(anchor: { x: number; y: number } | null = null): void {
        const p = this.buildHlPicker();
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!p || !parent) return;
        this.hlPickerAnchor = anchor;
        for (const st of HL_STYLES) this.hlStyleBtns[st.id]?.toggleClass('is-on', st.id === this.hlStyle);
        for (const co of HL_COLORS) this.hlColorBtns[co.id]?.toggleClass('is-on', co.id === this.hlColor);
        this.hlTrashBtn?.toggleClass('hidden', !this.selHighlightId);
        p.setAttribute('data-color', this.hlColor);
        p.removeClass('hidden');
        const pRect = parent.getBoundingClientRect();
        const box = p.getBoundingClientRect();
        let left: number;
        let top: number;
        if (anchor) {
            left = anchor.x - pRect.left - box.width / 2;
            top = anchor.y - pRect.top - box.height - 8;
            if (top < 4) top = anchor.y - pRect.top + 8;
        } else {
            // 动作条隐藏后 getBoundingClientRect 全 0 → 读它上次写入的 style.left/top（同 TXT 的坑）
            const barLeft = parseFloat(bar?.style.left ?? '');
            const barTop = parseFloat(bar?.style.top ?? '');
            left = Number.isFinite(barLeft) ? barLeft : Math.max(4, (pRect.width - box.width) / 2);
            top = Number.isFinite(barTop) ? barTop - box.height - 6 : 4;
        }
        p.style.left = `${Math.round(Math.max(4, Math.min(left, pRect.width - box.width - 4)))}px`;
        p.style.top = `${Math.round(Math.max(4, top))}px`;
    }

    private hideHlPicker(): void {
        this.hlPickerEl?.addClass('hidden');
        this.hlPickerAnchor = null;
    }

    /** 动作条「高亮」：命中已有高亮 → 取消；否则按当前默认样式新建并浮出色板 */
    private async toggleSelHighlight(): Promise<void> {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        const hit = this.findHighlightAt(rec.pageIndex, rec.rects);
        if (hit?.id) {
            await this.removeHighlight(hit.id);
            window.getSelection()?.removeAllRanges();
            this.hideSelbar();
            return;
        }
        const pct = rec.rects.length > 0 ? Math.round(rec.rects[0].y * 100) : 0;
        const id = await this.doHighlight(rec.text, rec.pageIndex + 1, pct, rec.rects, this.hlStyle, this.hlColor);
        if (!id) return;
        this.selHighlightId = id;
        this.syncSelbarHlTip();
        this.showHlPicker();
        window.getSelection()?.removeAllRanges();
    }

    /** 新建高亮：宿主写存档 → 本地追加 → 重绘覆盖层/列表（返回新块 id，失败 null） */
    private async doHighlight(
        quote: string,
        page: number,
        pct: number,
        rects: PdfRelRect[],
        style: HlStyle,
        color: HlColor,
        quiet = false,
    ): Promise<string | null> {
        if (!quote || !this.options.onHighlight) {
            new Notice('当前阅读器不支持高亮');
            return null;
        }
        const id = await this.options.onHighlight(quote, { chapter: page, pct }, style, color, rects);
        if (!id) return null; // 失败已由宿主 Notice
        this.highlightList = [...this.highlightList, { quote, id, loc: { chapter: page, pct }, style, color, rects }];
        this.applyHighlights();
        this.buildHighlightToc();
        if (!quiet) new Notice('已高亮');
        return id;
    }

    /**
     * 换样式/颜色：这条高亮的 id 会变（宿主只有 add/delete 两个入口，没有原地改）。
     * ⇒ 先取旧记录 → 删旧 → 用同样的 quote/loc/rects 按新样式重建，再重绘。
     * 🔴 删旧走**静默通道** `onTrashSelection({quiet:true})`（与 TXT/EPUB 同一个入口）：
     *    改样式是一次用户动作，只该在末尾报一条「已更新高亮样式」。走 `onDeleteHighlight`
     *    （会弹 ConfirmModal）会让用户为了换个颜色先点一次「删除」——真机实测 2026-10-23 就是这个毛病。
     */
    private async pickHlStyle(style: HlStyle, color: HlColor): Promise<void> {
        this.hlStyle = style;
        this.hlColor = color;
        const id = this.selHighlightId;
        if (!id) return;
        const rec = this.highlightList.find((h) => h.id === id);
        if (!rec) return;
        const quote = rec.quote;
        const loc = rec.loc ?? { chapter: 1, pct: 0 };
        const rects = rec.rects ?? [];
        // 删旧（宿主静默写盘）；删失败就中止，避免叠出两条同选段高亮
        if (!this.options.onTrashSelection) {
            new Notice('当前阅读器不支持改写高亮样式，请先删除该高亮再重新标注');
            return;
        }
        const n = await this.options.onTrashSelection({ highlightIds: [id], excerptIds: [] }, { quiet: true }).catch(() => 0);
        if (!n) {
            new Notice('改动样式失败，请先删除该高亮再重新标注');
            return;
        }
        this.highlightList = this.highlightList.filter((h) => h.id !== id);
        this.applyHighlights();
        const newId = await this.doHighlight(quote, loc.chapter, loc.pct, rects, style, color, true);
        if (newId) {
            this.selHighlightId = newId;
            this.syncSelbarHlTip();
            new Notice('已更新高亮样式');
        }
    }

    /** 垃圾桶：删掉选区命中的那条（不弹确认，与 TXT 的直删通道一致） */
    private async trashSelection(): Promise<void> {
        const id = this.selHighlightId;
        if (!id) {
            this.hideSelbar();
            return;
        }
        await this.removeHighlight(id);
        window.getSelection()?.removeAllRanges();
        this.hideSelbar();
    }

    /** 重绘所有已渲染页的高亮覆盖层（增删改后统一调用；未渲染页在 renderPage 完成时会补画） */
    private applyHighlights(): void {
        for (let i = 0; i < this.pages.length; i += 1) this.paintHighlightLayer(i);
    }

    /**
     * 画指定页的高亮覆盖层：`.rl-pdf-page > .rl-pdf-hl-layer`（`position:absolute; inset:0`），
     * 每个矩形一个子 div，位置走百分比（缩放不用重算）。
     * ⚠️ 覆盖层必须 `pointer-events: none`，否则会挡住 textLayer 的选区。
     */
    private paintHighlightLayer(pageIndex: number): void {
        const pv = this.pages[pageIndex];
        if (!pv) return;
        const page = pageIndex + 1;
        const mine = this.highlightList.filter((h) => (h.loc?.chapter ?? -1) === page);
        let layer = pv.el.querySelector(':scope > .rl-pdf-hl-layer') as HTMLDivElement | null;
        if (mine.length === 0) {
            layer?.remove();
            return;
        }
        if (!layer) {
            layer = pv.el.createDiv({ cls: 'rl-pdf-hl-layer' });
        }
        layer.empty();
        for (const hl of mine) {
            // 优先用存的矩形（缩放/重开都能还原）；没有几何数据的老记录（或未来手改的 JSON）
            // 退回按 quote 在 textLayer 里重定位 —— 见 locateHighlightRects
            const rects = hl.rects && hl.rects.length > 0 ? hl.rects : this.locateHighlightRects(hl, pv.el);
            for (const r of rects) {
                const box = layer.createDiv({ cls: 'rl-pdf-hl' });
                box.setAttribute('data-color', hl.color ?? DEFAULT_HL_COLOR);
                box.setAttribute('data-style', hl.style ?? DEFAULT_HL_STYLE);
                const st = relRectStyle(r);
                box.style.left = st.left;
                box.style.top = st.top;
                box.style.width = st.width;
                box.style.height = st.height;
                if (hl.id) box.setAttribute('data-id', hl.id);
            }
        }
    }

    /**
     * 兜底定位：没有存矩形的高亮，按 quote 在该页 textLayer 的 span 里找，
     * 用 `Range` 取框再归一化。命中失败返回 []（页面上就不画，列表里仍在，可点跳转）。
     */
    private locateHighlightRects(hl: ReaderHighlight, pageEl: HTMLDivElement): PdfRelRect[] {
        const quote = hl.quote.replace(/\s+/g, '');
        if (!quote) return [];
        const spans = Array.from(pageEl.querySelectorAll('.textLayer span')) as HTMLElement[];
        const texts = spans.map((s) => s.textContent ?? '');
        const joined = texts.join('').replace(/\s+/g, '');
        const at = joined.indexOf(quote);
        if (at < 0) return [];
        // 命中位置 → 找覆盖它的 span（按累计长度定位），取这些 span 的 client rect
        const rects: DOMRect[] = [];
        let acc = 0;
        const end = at + quote.length;
        for (const sp of spans) {
            const len = (sp.textContent ?? '').replace(/\s+/g, '').length;
            const s0 = acc;
            const s1 = acc + len;
            acc = s1;
            if (len === 0 || s1 <= at || s0 >= end) continue;
            for (const rc of Array.from(sp.getClientRects())) rects.push(rc);
        }
        const box = pageEl.getBoundingClientRect();
        return normalizeRects(rects, { left: box.left, top: box.top }, pageEl.clientWidth, pageEl.clientHeight);
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

    /** 设定缩放（滑条 / 键盘 / Ctrl+滚轮共用）：夹取范围 → 重渲染页面 → 恢复锚点位置 */
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
        // 2026-10-23 用户指令：记住用户调过的缩放（滑条松手 / Ctrl+滚轮 / 键盘 +− 全走这里）
        this.options.onScaleChange?.(clamped);
    }

    /** 缩放步进（键盘快捷键走此）：等价于 applyScaleValue(当前 + delta) */
    private adjustScale(delta: number): void {
        this.applyScaleValue(this.scale + delta);
    }

    // ── 2026-10-23 阅读模式（翻页 / 滚动） —— 与 TXT/EPUB 同一套分段控制器与同一套 ScrollMode ──

    /**
     * 建一个文字型分段控制器（`.rl-seg rl-seg-text`）—— 与 TXT/EPUB 的 `buildSeg` 同形。
     * 🔴 用 `.rl-seg-text` 而不是胶囊：用户口径「大胶囊太重」⇒ 只留字色变化（styles.css 里那套规则）。
     */
    private buildSeg<T>(row: HTMLElement, options: readonly SegOption<T>[], current: T, onPick: (v: T) => void): HTMLElement {
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

    /** 同步分段控制器亮起态（按 `data-val` 比对） */
    private syncSegItems(seg: HTMLElement | null, current: string): void {
        if (!seg) return;
        for (const el of Array.from(seg.children)) {
            const h = el as HTMLElement;
            h.toggleClass('is-on', h.getAttribute('data-val') === current);
        }
    }

    /**
     * 切换阅读模式（'continuous' 滚动 / 'paged' 翻页）。
     * 🔴 两种模式的差别只有三处，其余（缩放/高亮/摘抄/书签）全部照旧：
     *   ① 滚动容器加 `rl-pdf-paged` 类 → CSS 关掉纵向滚动、只让 `.is-current` 那页可见；
     *   ② 「当前页」由 `markCurrentPage()` 维护（翻页模式下它同时决定哪页可见）；
     *   ③ 上下滚动换成整页跳（底栏 ‹ ›、PageDown/PageUp、滚轮切页）。
     * PDF 的页是固定尺寸 canvas ⇒ 不需要 TXT 那套 multicol 重排，翻页就是 scrollTop 对齐页顶。
     */
    private setMode(m: ScrollMode): void {
        const next = normalizeScrollMode(m);
        if (next === this.mode) {
            this.syncSegItems(this.modeSeg, next);
            return;
        }
        this.mode = next;
        this.syncSegItems(this.modeSeg, next);
        this.scrollEl.toggleClass('rl-pdf-paged', next === 'paged');
        // 翻页模式下把当前页对齐到视口顶（否则切过去会停在「半页」处）
        if (next === 'paged') {
            requestAnimationFrame(() => {
                // 先按新几何重算页顶：DOM 可能刚被 CSS 改过 padding-bottom
                this.refreshPageTops();
                this.scrollToPage(this.currentPageIndex());
                this.updateProgress();
            });
        } else {
            this.markCurrentPage(this.currentPageIndex());
        }
        this.options.onScrollModeChange?.(next);
        // 自动推进的两种实现（rAF 匀速 / 定时翻页）不通用 ⇒ 模式一换就得重挂
        this.restartAutoIfOn();
    }

    /** 标记「当前页」（翻页模式下 CSS 只让这一页可见）。索引无效时清空所有标记。 */
    private markCurrentPage(pageIndex: number): void {
        const target = pageIndex >= 0 && pageIndex < this.pages.length ? this.pages[pageIndex].el : null;
        for (const pv of this.pages) pv.el.toggleClass('is-current', pv.el === target);
    }

    /** 是否翻页模式 */
    private isPaged(): boolean {
        return this.mode === 'paged';
    }

    /** 翻页模式：下一页（到页顶对齐；已是末页给提示） */
    private goNextPage(): void {
        const idx = this.currentPageIndex();
        // 页内还有剩余（翻页模式下不该有，但缩放刚切过来时可能停在页中）→ 先对齐页底再翻
        if (idx >= this.numPages - 1) {
            new Notice('已是最后一页');
            return;
        }
        const next = idx + 1;
        this.scrollToPage(next);
        this.updateProgress();
    }

    /** 翻页模式：上一页 */
    private goPrevPage(): void {
        const idx = this.currentPageIndex();
        if (idx <= 0) {
            new Notice('已是第一页');
            return;
        }
        this.scrollToPage(idx - 1);
        this.updateProgress();
    }

    private toggleToc(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.tocEl.toggleClass('collapsed', this.tocCollapsed);
        this.syncSidebarToggle();
    }

    /**
     * 同步侧栏折叠开关图标与标题（随 tocCollapsed：展开→panel-left-close/收起目录；折叠→panel-left-open/展开目录）。
     * 🔴 2026-10-25 四阅读器统一：本方法在 TXT / EPUB 里早已存在，PDF 原先只改 `data-tip`、**从不换图标**
     *    ⇒ 折叠后图标仍指「收起」，点了才发现是展开。现补齐为与 TXT/EPUB **逐字同构**。
     */
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
        this.markCurrentPage(pageIndex);
    }

    /** 翻一页高（PageDown/PageUp）——**翻页模式下一律对齐整页**（用户 2026-10-23：翻页模式要一页一页走）。
     *  连续滚动模式仍按 0.9 屏滚，保持原生滚动手感。 */
    private scrollByPage(dir: 1 | -1): void {
        if (this.isPaged()) {
            if (dir > 0) this.goNextPage();
            else this.goPrevPage();
            return;
        }
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
        // 翻页模式下「当前页」同时决定可见性（CSS 只让 .is-current 那页可见）
        if (this.isPaged()) this.markCurrentPage(idx);
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
