// 阅读器摘录回写弹窗：阅读器内选中文本（quote）已捕获 → 手动确认页码/心得 → 调 onConfirm 写回笔记
// 与 ExcerptModal 的关系：quote 由阅读器直接带入（免去粘贴/搜索书目），保存走注入的 onConfirm 回调
// DOM API 渲染（参照 ExcerptModal rl-ex-* 样式，quote 只读块新增 rl-ex-quote）
import { Modal, Notice, type App } from 'obsidian';

export interface ReaderExcerptOptions {
    /** 书籍条目 id（回写目标） */
    entryId: string;
    /** 选中的文本（已去空白） */
    quote: string;
    /** 页码（TXT 无页码传 undefined；EPUB 章节序号） */
    page?: number;
    /** 原书定位（章序 1 基 + 滚动百分比；随摘抄写入笔记「· 定位：N:N」） */
    loc?: { chapter: number; pct: number };
    /** 确认回调：调用 plugin.addExcerpt(entryId, ParsedExcerpt) 写回笔记 */
    onConfirm: (excerpt: { quote: string; page?: number; note?: string; loc?: { chapter: number; pct: number } }) => Promise<void>;
}

export class ReaderExcerptModal extends Modal {
    constructor(
        app: App,
        private options: ReaderExcerptOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const head = contentEl.createDiv({ cls: 'rl-ex-head' });
        head.createEl('h2', { text: '添加摘抄（阅读器回写）' });
        head.createSpan({ cls: 'rl-ex-hint', text: '阅读器内选中文本 → 确认页码/心得 → 写入书目笔记' });

        // 引用文本（只读展示，灰色块）
        const qField = contentEl.createDiv({ cls: 'rl-ex-field' });
        qField.createEl('label', { cls: 'rl-ex-label', text: '引用文本' });
        const quoteEl = qField.createDiv({ cls: 'rl-ex-quote', text: this.options.quote });

        // 页码（预填阅读器传入值）+ 心得
        const metaRow = contentEl.createDiv({ cls: 'rl-ex-row' });
        const pageField = metaRow.createDiv({ cls: 'rl-ex-field' });
        pageField.createEl('label', { cls: 'rl-ex-label', text: '页码（可选）' });
        const pageEl = pageField.createEl('input', { cls: 'rl-ex-input', type: 'number', attr: { min: '0', placeholder: '如 128' } });
        if (this.options.page !== undefined) pageEl.value = String(this.options.page);
        const noteField = metaRow.createDiv({ cls: 'rl-ex-field rl-ex-grow' });
        noteField.createEl('label', { cls: 'rl-ex-label', text: '心得（可选，支持 [[双链]]）' });
        const noteEl = noteField.createEl('input', { cls: 'rl-ex-input', placeholder: '写下此刻的想法…' });

        // 操作
        const foot = contentEl.createDiv({ cls: 'rl-ex-foot' });
        const cancelBtn = foot.createEl('button', { cls: 'rl-ex-btn', text: '取消' });
        const saveBtn = foot.createEl('button', { cls: 'rl-ex-btn rl-ex-btn-primary', text: '保存摘抄' });

        cancelBtn.onclick = () => this.close();
        saveBtn.onclick = async () => {
            const page = pageEl.value ? parseInt(pageEl.value, 10) : undefined;
            saveBtn.setAttr('disabled', '');
            try {
                await this.options.onConfirm({ quote: this.options.quote, page, note: noteEl.value.trim() || undefined, loc: this.options.loc });
                new Notice('已写入摘抄');
                this.close();
            } catch (err) {
                new Notice(`写入摘抄失败：${err instanceof Error ? err.message : String(err)}`);
                saveBtn.removeAttribute('disabled');
            }
        };
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
