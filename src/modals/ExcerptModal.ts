// 摘抄录入弹窗：外部阅读器复制 → 粘贴 + 页码 + 挂载书目 + 心得 → 生成摘抄块（^id）
// DOM API 渲染（非 Svelte），样式写入 styles.css（rl-ex-*）
import { App, Modal, Notice, setIcon } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry } from 'data/types';
import { renderExcerptBlock } from 'pure/excerpt';

export class ExcerptModal extends Modal {
    /** 当前选中的挂载书目（从书籍表单/右键菜单进入时由调用方固定传入；命令入口为 null 需搜索选择） */
    private selected: MediaEntry | null = null;
    private bookList: MediaEntry[] = [];

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private book?: MediaEntry,
    ) {
        super(app);
        this.selected = book ?? null;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();

        const head = contentEl.createDiv({ cls: 'rl-ex-head' });
        head.createEl('h2', { text: '添加摘抄' });
        head.createSpan({ cls: 'rl-ex-hint', text: '外部阅读器选中复制 → 粘贴 + 填页码 → 挂载书目 → 生成' });

        // 引用文本（剪贴板带入）
        const qField = contentEl.createDiv({ cls: 'rl-ex-field' });
        qField.createEl('label', { cls: 'rl-ex-label', text: '引用文本（自动带入剪贴板，可修改）' });
        const quoteEl = qField.createEl('textarea', {
            cls: 'rl-ex-textarea',
            attr: { rows: '3', placeholder: '粘贴摘抄的原文片段…' },
        });

        // 页码 + 心得
        const metaRow = contentEl.createDiv({ cls: 'rl-ex-row' });
        const pageField = metaRow.createDiv({ cls: 'rl-ex-field' });
        pageField.createEl('label', { cls: 'rl-ex-label', text: '页码（可选）' });
        const pageEl = pageField.createEl('input', { cls: 'rl-ex-input', type: 'number', attr: { min: '0', placeholder: '如 128' } });
        const noteField = metaRow.createDiv({ cls: 'rl-ex-field rl-ex-grow' });
        noteField.createEl('label', { cls: 'rl-ex-label', text: '心得（可选，支持 [[双链]]）' });
        const noteEl = noteField.createEl('input', { cls: 'rl-ex-input', placeholder: '写下此刻的想法…' });

        // 挂载书目：命令入口需搜索选择；从书籍表单/右键菜单进入时固定绑定（隐藏搜索区）
        let searchEl: HTMLInputElement | null = null;
        let listEl: HTMLElement | null = null;
        if (this.book) {
            const fixedField = contentEl.createDiv({ cls: 'rl-ex-field' });
            fixedField.createEl('label', { cls: 'rl-ex-label', text: '挂载书目（固定）' });
            fixedField.createDiv({ cls: 'rl-ex-fixed-book', text: `《${this.book.title}》${this.book.author ? ` · ${this.book.author}` : ''}` });
        } else {
            const bookField = contentEl.createDiv({ cls: 'rl-ex-field' });
            bookField.createEl('label', { cls: 'rl-ex-label', text: '挂载书目（从库内书籍中选择）' });
            // 搜索框与 MediaList 同款：占位字前置 lucide 搜索图标（2026-09-12「所有搜索框加同款」）
            const searchWrap = bookField.createDiv({ cls: 'rl-ex-search-wrap' });
            searchEl = searchWrap.createEl('input', { cls: 'rl-ex-input', placeholder: '搜索书名 / 作者…' });
            const searchIco = searchWrap.createSpan({ cls: 'rl-ex-search-ico' });
            setIcon(searchIco, 'search');
            listEl = bookField.createDiv({ cls: 'rl-ex-book-list' });
        }

        // 预览
        const previewEl = contentEl.createDiv({ cls: 'rl-ex-preview', text: this.selected ? '填写引用文本后显示预览' : '选择书目后显示生成预览' });

        // 操作
        const foot = contentEl.createDiv({ cls: 'rl-ex-foot' });
        const cancelBtn = foot.createEl('button', { cls: 'rl-ex-btn', text: '取消' });
        const submitBtn = foot.createEl('button', { cls: 'rl-ex-btn rl-ex-btn-primary', text: '生成摘抄', attr: { disabled: '' } });

        const allBooks = this.book ? [] : (await this.plugin.service.list()).filter((e) => e.type === 'book');

        const renderList = () => {
            if (!searchEl || !listEl) return;
            const q = searchEl.value.trim().toLowerCase();
            const matched = q
                ? allBooks.filter((e) => (e.title + ' ' + (e.author ?? '')).toLowerCase().includes(q))
                : allBooks;
            listEl.empty();
            if (allBooks.length === 0) {
                listEl.createDiv({ cls: 'rl-ex-empty', text: '库内还没有书籍 — 先在「阅读」页签添加书目，再回来添加摘抄' });
                return;
            }
            if (matched.length === 0) {
                listEl.createDiv({ cls: 'rl-ex-empty', text: `没有匹配「${searchEl.value.trim()}」的书籍` });
                return;
            }
            for (const b of matched.slice(0, 8)) {
                const item = listEl.createDiv({ cls: 'rl-ex-book-item' + (this.selected?.id === b.id ? ' sel' : '') });
                const title = item.createDiv({ cls: 'rl-ex-book-ttl', text: b.title });
                title.createSpan({ cls: 'rl-ex-book-au', text: b.author ? ` · ${b.author}` : '' });
                if (this.selected?.id === b.id) item.createSpan({ cls: 'rl-ex-book-check', text: '✓' });
                item.onclick = () => {
                    this.selected = b;
                    renderList();
                    updatePreview();
                };
            }
        }

        const updatePreview = () => {
            const quote = quoteEl.value.trim();
            if (!this.selected || !quote) {
                previewEl.setText(this.selected ? '填写引用文本后显示预览' : '选择书目后显示生成预览');
                previewEl.addClass('rl-ex-preview-muted');
                submitBtn.setAttr('disabled', '');
                return;
            }
            const page = pageEl.value ? parseInt(pageEl.value, 10) : undefined;
            const md = renderExcerptBlock({ quote, page, note: noteEl.value.trim() || undefined });
            previewEl.removeClass('rl-ex-preview-muted');
            previewEl.empty();
            const lbl = previewEl.createDiv({ cls: 'rl-ex-preview-lbl', text: `将追加到《${this.selected.title}》摘抄区` });
            lbl.createSpan({ cls: 'rl-ex-preview-fname', text: `（${this.selected.notePath ? '已生成笔记' : '首次生成笔记'}）` });
            const code = previewEl.createEl('pre', { cls: 'rl-ex-preview-md', text: md });
            submitBtn.removeAttribute('disabled');
        }

        const clearInputs = () => {
            quoteEl.value = '';
            pageEl.value = '';
            noteEl.value = '';
            updatePreview();
            quoteEl.focus();
        }

        if (searchEl) searchEl.oninput = renderList;
        quoteEl.oninput = updatePreview;
        noteEl.oninput = updatePreview;
        pageEl.oninput = updatePreview;

        submitBtn.onclick = async () => {
            const quote = quoteEl.value.trim();
            if (!this.selected || !quote) return;
            const page = pageEl.value ? parseInt(pageEl.value, 10) : undefined;
            submitBtn.setAttr('disabled', '');
            try {
                const r = await this.plugin.addExcerpt(this.selected.id, {
                    quote,
                    page,
                    note: noteEl.value.trim() || undefined,
                });
                new Notice(`已添加摘抄 · 《${this.selected.title}》现有 ${r.count} 条`);
                // 连续录入：清空文本，保留挂载书目
                clearInputs();
                this.bookList = allBooks;
            } catch (err) {
                new Notice(`添加摘抄失败：${err instanceof Error ? err.message : String(err)}`);
                updatePreview();
            }
        };

        cancelBtn.onclick = () => this.close();

        // 剪贴板带入（Electron 支持；无权限/失败静默）
        void navigator.clipboard?.readText?.().then((t) => {
            if (t && t.trim() && !quoteEl.value) {
                quoteEl.value = t.trim();
                updatePreview();
            }
        }).catch(() => {});

        renderList();
        updatePreview();
        quoteEl.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
