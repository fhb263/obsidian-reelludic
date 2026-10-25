// #685 文本记录弹窗（短评 / 攻略）：一段文字 → 写入笔记对应章节
// 仿摘抄弹窗（ExcerptModal）样式（rl-ex-*），固定挂载目标条目
// DOM API 渲染（非 Svelte），样式复用 styles.css 中的 rl-ex-*
// 🔴 与 EntryLogModal 分开：那边是「日期 + 数字」的结构化记录，这边是纯文本 ⇒ 别塞进同一个弹窗
import { App, Modal, Notice } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry, EntryTextKind } from 'data/types';
import { applyScrollPref } from 'services/scrollPref';
// 短评日期前缀 + 预览与落盘共用同一模板（用户 m00002）
import { commentRecordBlock } from 'pure/logLine';
import { todayLocal } from 'pure/dailyLog';

interface TextKindMeta {
    /** 弹窗标题（= 右键菜单那一项的名字） */
    title: string;
    /** 笔记章节名 */
    section: string;
    /** 输入框占位符 */
    placeholder: string;
    /**
     * 保存语义：
     * - `append` = 追加到现有内容后面（空行分隔）——「添加」不许吃掉用户已经写的内容
     * - `replace` = 整体覆盖（这份文本本身就是一份完整文档，改它就该覆盖）
     */
    mode: 'append' | 'replace';
}

const KIND_META: Record<EntryTextKind, TextKindMeta> = {
    comment: {
        title: '添加短评',
        // 🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」
        //   ⇒ 章节名是**短评**（笔记里独立 `## 短评`），⛔ 别再写成「个人评语」。
        section: '短评',
        placeholder: '写一句短评…',
        mode: 'append',
    },
    guide: {
        title: '添加攻略',
        section: '攻略',
        placeholder: '写下攻略正文（支持 [[双链]]）…',
        mode: 'replace',
    },
};

export class EntryTextModal extends Modal {
    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private entry: MediaEntry,
        private kind: EntryTextKind,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        const meta = KIND_META[this.kind];

        const head = contentEl.createDiv({ cls: 'rl-ex-head' });
        head.createEl('h2', { text: meta.title });
        head.createSpan({
            cls: 'rl-ex-hint',
            text:
                meta.mode === 'append'
                    ? `保存后追加到笔记独立的「${meta.section}」章节（日期倒序）`
                    : `保存后写入笔记「${meta.section}」章节`,
        });

        // 挂载条目（固定）
        const fixedField = contentEl.createDiv({ cls: 'rl-ex-field' });
        fixedField.createEl('label', { cls: 'rl-ex-label', text: '条目（固定）' });
        fixedField.createDiv({
            cls: 'rl-ex-fixed-book',
            text: `《${this.entry.title}》${this.entry.platform ? ` · ${this.entry.platform}` : ''}${this.entry.developer ? ` · ${this.entry.developer}` : ''}`,
        });

        // 现有内容：追加模式只读展示（让人知道会接在什么后面）；覆盖模式直接进输入框
        // 🔴 用户 2026-10-25：短评不再进「个人评语」⇒ 这里展示的是**已有短评流水**，
        //   ⛔ 别再读 `entry.notes`（那会把用户的整段个人评语当成短评历史显示出来）。
        const existing =
            this.kind === 'comment'
                ? [...(this.entry.commentLog ?? [])]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((cm) => commentRecordBlock(cm.date, cm.text))
                      .join('\n\n')
                : this.entry.guide ?? '';
        if (meta.mode === 'append' && existing.trim()) {
            const prevField = contentEl.createDiv({ cls: 'rl-ex-field' });
            prevField.createEl('label', {
                cls: 'rl-ex-label',
                text: `现有${meta.section}（保留，新内容追加在后面）`,
            });
            prevField.createDiv({ cls: 'rl-ex-quote', text: existing });
        }

        const field = contentEl.createDiv({ cls: 'rl-ex-field' });
        field.createEl('label', { cls: 'rl-ex-label', text: meta.mode === 'replace' ? `${meta.section}正文` : '短评内容' });
        const area = field.createEl('textarea', { cls: 'rl-ex-textarea' });
        area.placeholder = meta.placeholder;
        area.rows = 6;
        if (meta.mode === 'replace') area.value = existing;

        // 🔴 用户 m00002：「添加短评…加上时间前缀，预览效果」
        //   ⇒ 追加模式给一个日期（默认今天）+ 一块「将写入」实时预览；
        //     预览与真写入共用 `pure/logLine`（⛔ 别在预览里另拼一套模板）。
        //   ⚠️ `replace` 模式（攻略是整篇正文，不是流水记录）**不加日期前缀、不出预览** ——
        //     攻略是「一份文档」，给它挂个 `- **日期** ·` 反而毁掉正文结构。
        let dateEl: HTMLInputElement | undefined;
        let previewEl: HTMLDivElement | undefined;
        if (meta.mode === 'append') {
            const dateField = contentEl.createDiv({ cls: 'rl-ex-field' });
            dateField.createEl('label', { cls: 'rl-ex-label', text: '日期（默认今天）' });
            dateEl = dateField.createEl('input', { cls: 'rl-ex-input', type: 'date' });
            dateEl.value = todayLocal();
            previewEl = contentEl.createDiv({ cls: 'rl-ex-preview', text: '写好短评后显示将追加的那一行' });
        }

        // 操作
        // 🔴 #（用户 m00002）：「添加短评/记录重温等的功能项弹窗底部不要显示"取消"按钮，
        //   因为和弹窗顶部的叉重复了」⇒ 只留「保存」，关闭走右上角 ✕ / Esc。
        //   ⛔ 别再把「取消」加回来：底部单按钮右对齐，视觉上更干净。
        const foot = contentEl.createDiv({ cls: 'rl-ex-foot' });
        const submitBtn = foot.createEl('button', { cls: 'rl-ex-btn rl-ex-btn-primary', text: '保存', attr: { disabled: '' } });

        /** 预览 + 可提交联动：追加模式实时渲染「将写入的这行」；覆盖模式只看非空 */
        const updateSubmit = () => {
            const text = area.value.trim();
            if (previewEl && dateEl) {
                if (!text) {
                    previewEl.setText('写好短评后显示将追加的那一行');
                    previewEl.addClass('rl-ex-preview-muted');
                } else {
                    previewEl.removeClass('rl-ex-preview-muted');
                    previewEl.empty();
                    previewEl.createDiv({
                        cls: 'rl-ex-preview-lbl',
                        text: `将追加到《${this.entry.title}》「${meta.section}」`,
                    });
                    previewEl.createEl('pre', { cls: 'rl-ex-preview-md', text: commentRecordBlock(dateEl.value, text) });
                }
            }
            if (text) submitBtn.removeAttribute('disabled');
            else submitBtn.setAttr('disabled', '');
        };
        area.oninput = updateSubmit;
        dateEl?.addEventListener('change', updateSubmit);
        updateSubmit();

        submitBtn.onclick = async () => {
            const text = area.value.trim();
            if (!text) return;
            submitBtn.setAttr('disabled', '');
            try {
                await this.plugin.saveEntryText(this.entry.id, this.kind, text, dateEl?.value);
                new Notice(`已${meta.title} · 《${this.entry.title}》`);
                this.close();
            } catch (err) {
                new Notice(`${meta.title}失败：${err instanceof Error ? err.message : String(err)}`);
                updateSubmit();
            }
        };

        area.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
