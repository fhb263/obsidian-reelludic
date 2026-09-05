// 书籍阅读器弹窗（Modal 包装 TxtReaderPanel / EpubReaderPanel）：
// 视图（新 Tab）方式在多版本 Obsidian 下渲染不可靠，回归弹窗；面板渲染逻辑复用
import { Modal, Scope, type App } from 'obsidian';
import { TxtReaderPanel, type TxtReaderOptions } from './TxtReaderModal';
import { EpubReaderPanel, type EpubReaderOptions } from './EpubReaderModal';
import type { ParsedExcerpt } from 'pure/excerpt';

export class TxtReaderModal extends Modal {
    private panel: TxtReaderPanel | null = null;

    constructor(app: App, private options: TxtReaderOptions) {
        super(app);
    }

    /** 摘抄列表刷新（main 层摘抄写入成功后重读笔记注入；转发给面板重绘书签 tab） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.panel?.refreshExcerpts(excerpts);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        // 弹窗铺满：宽 92% 高 90%（Obsidian Modal 默认 ~520px 宽，对双栏阅读器过窄）
        this.modalEl.style.width = '92%';
        this.modalEl.style.maxWidth = '1000px';
        this.modalEl.style.height = '90%';
        // 兜底撑开（Modal contentEl 默认无高度）
        contentEl.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden';
        // 软件式沉浸：去原生 modal 边框/标题栏，阅读器自绘顶栏直铺（批 1.5 P1）
        this.modalEl.addClass('rl-reader-immersive');
        // 隐藏插件内滚动条（外观设置）：隐藏阅读器外壳层滚动条（TXT 主滚动/EPUB 侧栏）
        if (this.options.hideScrollbars) this.modalEl.addClass('rl-hide-scroll');
        this.panel = new TxtReaderPanel(contentEl, new Scope(this.app.scope), this.options, () => this.close());
        this.panel.mount();
    }

    onClose(): void {
        this.panel?.destroy();
        this.panel = null;
        this.contentEl.empty();
    }
}

export class EpubReaderModal extends Modal {
    private panel: EpubReaderPanel | null = null;

    constructor(app: App, private options: EpubReaderOptions) {
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
        this.modalEl.style.maxWidth = '1000px';
        this.modalEl.style.height = '90%';
        contentEl.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden';
        // 软件式沉浸：去原生 modal 边框/标题栏，阅读器自绘顶栏直铺（批 1.5 P1）
        this.modalEl.addClass('rl-reader-immersive');
        // 隐藏插件内滚动条（外观设置）：隐藏阅读器外壳层滚动条（TXT 主滚动/EPUB 侧栏）
        if (this.options.hideScrollbars) this.modalEl.addClass('rl-hide-scroll');
        this.panel = new EpubReaderPanel(contentEl, new Scope(this.app.scope), this.options, () => this.close());
        this.panel.mount();
    }

    onClose(): void {
        this.panel?.destroy();
        this.panel = null;
        this.contentEl.empty();
    }
}
