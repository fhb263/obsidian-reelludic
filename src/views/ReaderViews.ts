// 阅读器视图（工作区新标签页，Media Extended 式）：三个薄壳包装各自的 Panel。
// 面板（TxtReaderPanel / EpubReaderPanel / PdfReaderPanel）与宿主无关 —— 构造收 (container, scope, options, closeView)，
// 全屏目标写的是 `container.closest('.modal') ?? container`（天然兼容视图宿主），故 Modal → 视图只改这层薄壳。
//
// 🔴 历史与防线（2026-08-30 曾把阅读器改成 ItemView 又因「空白」回归弹窗，见进度表 #147~#150）：
//    本批重启这条路线，针对当年两类根因各设一道防线 ——
//      ① 当年把 TXT 全文 / EPUB fileMap 塞进 setViewState 的 state → 大对象序列化失败、onOpen 拿到残缺 state → 空白。
//         现在 **options 只经 openWith() 直接传给视图实例**，getState() 恒为空对象：不序列化、不落盘、不走 state。
//      ② 当年在容器尚未布局（高度 0）时 mount → 排版/分页测量归零 → 看起来一片空白（#148 修过 contentEl 高度）。
//         现在 contentEl 显式 `height:100%` + 等容器可测量（clientHeight > 0，最多 6 帧）再 mount。
//    若某个阅读器仍空白：三个薄壳互相独立，可按单个阅读器回退，不必整体推翻。
import { ItemView, Scope, WorkspaceLeaf } from 'obsidian';
import { TxtReaderPanel, type TxtReaderOptions } from 'modals/TxtReaderModal';
import { EpubReaderPanel, type EpubReaderOptions } from 'modals/EpubReaderModal';
import { PdfReaderPanel, type PdfReaderOptions } from 'modals/PdfReaderModal';
import { ConfirmModal } from 'modals/ConfirmModal';
import type { ParsedExcerpt } from 'pure/excerpt';

export const TXT_READER_VIEW_TYPE = 'reelludic-txt-reader';
export const EPUB_READER_VIEW_TYPE = 'reelludic-epub-reader';
export const PDF_READER_VIEW_TYPE = 'reelludic-pdf-reader';

/** 面板要能挂载 / 销毁 / 刷新摘抄（三个面板的公共面） */
interface ReaderPanelLike {
    mount(): void;
    destroy(): void;
    refreshExcerpts(excerpts: ParsedExcerpt[]): void;
    refreshTheme?(): void;
    /** 面板尺寸变化（容器被 Obsidian 侧栏挤压等）→ 重排；三件各自实现 */
    onResize?(): void;
}

/**
 * 容器可测量后再挂面板：Obsidian 新建标签页的那一帧容器高度可能还是 0，
 * 此时排版的测量（列宽/滚动高/分页）会全部归零、读起来就是「空白」。等 clientHeight > 0，最多 6 帧兜底。
 */
function mountWhenMeasurable(container: HTMLElement, mount: () => void, tries = 6): void {
    if (container.clientHeight > 0 || tries <= 0) {
        mount();
        return;
    }
    window.requestAnimationFrame(() => mountWhenMeasurable(container, mount, tries - 1));
}

/** 三个阅读器视图的公共骨架（各自的 openWith 参数类型不同，故用泛型基类 + 子类补类型） */
abstract class ReaderViewBase<TOpts extends { title: string }> extends ItemView {
    private opts: TOpts | null = null;
    private panel: ReaderPanelLike | null = null;
    private scopeRef: Scope | null = null;
    /** 容器尺寸监听（拖侧栏宽度 / 窗口变化）→ 转发面板重排 */
    private resizeObs: ResizeObserver | null = null;
    /** 是否已完成 onOpen（未完成时 openWith 只记 options，由 onOpen 负责挂载） */
    private opened = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        // 阅读视图不是「文件导航」语义：不显示前进/后退，也不参与文件历史
        this.navigation = false;
    }

    protected abstract mountPanel(container: HTMLElement, scope: Scope, opts: TOpts): ReaderPanelLike;
    protected abstract emptyHint(): string;

    /** 挂载前补默认项（如 ConfirmModal 注入）；子类可覆写 */
    protected prepare(opts: TOpts): TOpts {
        return opts;
    }

    getDisplayText(): string {
        return this.opts?.title ?? '阅读器';
    }

    async onOpen(): Promise<void> {
        const scope = new Scope(this.app.scope);
        this.scopeRef = scope;
        // 本标签页为活动页时，Obsidian 会通过 view.scope 使用这套快捷键（方向键翻章 / T 目录 / A± 等）
        this.scope = scope;
        scope.register([], 'Escape', () => {
            // Esc **不再关闭阅读器**（用户 2026-09-17 裁定：退出只经由关闭标签页，Esc 也收敛掉）。
            // 全屏中返回 true 交回浏览器退全屏；其余一律返回 false 阻止传播（不再 detach 本 leaf）。
            if (document.fullscreenElement) return true;
            return false;
        });
        this.containerEl.addClass('rl-reader-view');
        // contentEl = .view-content：去默认内距/滚动交由 CSS；再显式撑满（防高度 auto → 0）
        this.contentEl.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden';
        this.opened = true;
        // Obsidian 主题变更（含「跟随系统」夜间自动切深色）：通知面板刷新注入型配色
        this.registerEvent(this.app.workspace.on('css-change', () => this.panel?.refreshTheme?.()));
        if (this.opts && this.scopeRef) this.build();
        else this.renderEmpty();
    }

    async onClose(): Promise<void> {
        this.panel?.destroy();
        this.panel = null;
        this.contentEl.empty();
    }

    /** 载入要阅读的书（main 层在 setViewState 后调用；同一标签页换书也走这里） */
    openWith(opts: TOpts): void {
        this.opts = this.prepare(opts);
        if (this.opened && this.scopeRef) this.build();
        // 标签页标题跟随书名：Obsidian 只在特定时机刷新 tab header，而开新标签页时读到的是占位名「阅读器」，
        // 故载入后手动刷一次（updateHeader 不在公开 d.ts → 窄化断言后可选调用）
        const leaf = this.leaf as unknown as { updateHeader?: () => void };
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
    }

    /** 摘抄列表刷新（main 层摘抄写入成功后重读笔记注入；转发给面板重绘书签 tab） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.panel?.refreshExcerpts(excerpts);
    }

    private build(): void {
        const opts = this.opts;
        const scope = this.scopeRef;
        if (!opts || !scope) return;
        this.panel?.destroy();
        this.panel = null;
        const container = this.contentEl;
        mountWhenMeasurable(container, () => {
            // 异步等帧期间视图可能已被关闭/换书：用当前 opts 与 panel 状态做最终判据
            if (this.opts !== opts) return;
            this.panel = this.mountPanel(container, scope, opts);
            this.panel.mount();
        });
        // 容器尺寸变化 → 面板重排（用户 2026-09-16 报障：调过 Obsidian 左右侧栏宽度后正文聚焦/滚动异常）。
        // 拖侧栏只引起内部回流、**不触发 window.resize**，所以必须用 ResizeObserver 盯着容器本身；
        // clientHeight 为 0（尚未排版）时跳过，避免用无效尺寸重排。用 Component.register 挂清理（视图卸载即断开）。
        this.resizeObs?.disconnect();
        const obs = new ResizeObserver(() => {
            if (container.clientHeight > 0) this.panel?.onResize?.();
        });
        obs.observe(container);
        this.resizeObs = obs;
        this.register(() => obs.disconnect());
    }

    /** 无内容（Obsidian 恢复上次布局、或状态丢失）：占位提示，避免一片空白 */
    private renderEmpty(): void {
        const box = this.contentEl.createDiv({ cls: 'rl-reader-empty' });
        box.createDiv({ cls: 'rl-reader-empty-title', text: '阅读器' });
        box.createDiv({ cls: 'rl-reader-empty-hint', text: this.emptyHint() });
    }
}

/** 书籍阅读器视图（TXT）：窄栏正文 + 目录/书签/摘抄侧栏 + 划词动作条 */
export class TxtReaderView extends ReaderViewBase<TxtReaderOptions> {
    getViewType(): string {
        return TXT_READER_VIEW_TYPE;
    }

    getIcon(): string {
        return 'book-open';
    }

    protected emptyHint(): string {
        return '在书籍条目上点「阅读」即可在这个标签页里打开';
    }

    /** 清除全部高亮确认注入 ConfirmModal（面板无 app；替代原生 confirm 统一风格） */
    protected prepare(opts: TxtReaderOptions): TxtReaderOptions {
        return opts.onConfirmClear
            ? opts
            : { ...opts, onConfirmClear: (m: string) => new ConfirmModal(this.app, m).open() };
    }

    protected mountPanel(container: HTMLElement, scope: Scope, opts: TxtReaderOptions): ReaderPanelLike {
        return new TxtReaderPanel(container, scope, opts, () => void this.leaf.detach());
    }
}

/** 书籍阅读器视图（EPUB）：iframe 渲染 + 同套侧栏/工具条 */
export class EpubReaderView extends ReaderViewBase<EpubReaderOptions> {
    getViewType(): string {
        return EPUB_READER_VIEW_TYPE;
    }

    getIcon(): string {
        return 'book-open';
    }

    protected emptyHint(): string {
        return '在书籍条目上点「阅读」即可在这个标签页里打开';
    }

    protected prepare(opts: EpubReaderOptions): EpubReaderOptions {
        return opts.onConfirmClear
            ? opts
            : { ...opts, onConfirmClear: (m: string) => new ConfirmModal(this.app, m).open() };
    }

    protected mountPanel(container: HTMLElement, scope: Scope, opts: EpubReaderOptions): ReaderPanelLike {
        return new EpubReaderPanel(container, scope, opts, () => void this.leaf.detach());
    }
}

/** PDF 阅读器视图：页卡 + 缩放（无字号/行距设置） */
export class PdfReaderView extends ReaderViewBase<PdfReaderOptions> {
    getViewType(): string {
        return PDF_READER_VIEW_TYPE;
    }

    getIcon(): string {
        return 'file-text';
    }

    protected emptyHint(): string {
        return '在书籍条目上点「阅读」即可在这个标签页里打开';
    }

    /** #382b 删除书签确认注入 ConfirmModal（面板无 app；与 TXT/EPUB 同一套口径，⛔ 不用原生 confirm） */
    protected prepare(opts: PdfReaderOptions): PdfReaderOptions {
        return opts.onConfirmClear
            ? opts
            : { ...opts, onConfirmClear: (m: string) => new ConfirmModal(this.app, m).open() };
    }

    protected mountPanel(container: HTMLElement, scope: Scope, opts: PdfReaderOptions): ReaderPanelLike {
        return new PdfReaderPanel(container, scope, opts, () => void this.leaf.detach());
    }
}
