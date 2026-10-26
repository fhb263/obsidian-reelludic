// #685 记录弹窗（时长 / 重温 / 周目）：日期 + 数字 + 心得 → 写入笔记对应章节
// 仿摘抄弹窗（ExcerptModal）与旧 GameSessionModal 样式（rl-ex-*），固定挂载目标条目
// DOM API 渲染（非 Svelte），样式复用 styles.css 中的 rl-ex-*
// 🔴 三种形态共用一个弹窗（别拆三个文件）：差异只有「数字字段是小时还是次数」与「写哪个章节」
import { App, Modal, Notice } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry, EntryLogKind } from 'data/types';
import { formatPlaytime, hoursToMinutes } from 'pure/playtime';
import { applyScrollPref } from 'services/scrollPref';
// 🔴 用户 m00002：预览与落盘用**同一个**记录行模板（⛔ 别在这里手拼 `- **日期** · …`）
import { datedRecordLine } from 'pure/logLine';

interface LogKindMeta {
    /** 弹窗标题（= 右键菜单那一项的名字，一个动作一个名字） */
    title: string;
    /** 日期字段名 */
    dateLabel: string;
    /** 数字字段名 */
    numLabel: string;
    /** 数字字段占位符 */
    numPlaceholder: string;
    /** 数字字段单位（提示用） */
    numUnit: string;
    /** 文本字段名 */
    noteLabel: string;
    /** 文本字段占位符 */
    notePlaceholder: string;
}

const KIND_META: Record<EntryLogKind, LogKindMeta> = {
    time: {
        title: '记录时长',
        dateLabel: '日期（默认今天）',
        numLabel: '时长（小时，可小数）',
        numPlaceholder: '如 1.5',
        numUnit: '小时',
        noteLabel: '心得（可选，支持 [[双链]]）',
        notePlaceholder: '写下这次的感受…',
    },
    rewatch: {
        title: '记录重温',
        dateLabel: '重温日期（默认今天）',
        numLabel: '第几次重刷',
        numPlaceholder: '如 2',
        numUnit: '次',
        noteLabel: '感想（可选，支持 [[双链]]）',
        notePlaceholder: '这次重刷的感受…',
    },
    playthrough: {
        title: '记录周目',
        dateLabel: '周目日期（默认今天）',
        numLabel: '第几周目',
        numPlaceholder: '如 2',
        numUnit: '周目',
        noteLabel: '感想（可选，支持 [[双链]]）',
        notePlaceholder: '这一周目的感受…',
    },
};

/** 时长明细的笔记章节名（按类型分名，唯一真源在 noteGenerator，这里只用于**预览文案**） */
const TIME_SECTION: Record<string, string> = { game: '游玩记录', book: '阅读记录', music: '收听记录' };

export class EntryLogModal extends Modal {
    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private entry: MediaEntry,
        private kind: EntryLogKind,
    ) {
        super(app);
    }

    /** 本地日期 YYYY-MM-DD */
    private todayStr(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /** 笔记章节名：时长按类型分名；重温 / 周目各一个 */
    private sectionName(): string {
        if (this.kind === 'rewatch') return '重温记录';
        if (this.kind === 'playthrough') return '周目记录';
        return TIME_SECTION[this.entry.type] ?? '时长记录';
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        const meta = KIND_META[this.kind];

        const head = contentEl.createDiv({ cls: 'rl-ex-head' });
        head.createEl('h2', { text: meta.title });
        head.createSpan({ cls: 'rl-ex-hint', text: `${meta.dateLabel} + ${meta.numLabel} + 心得 → 写入笔记「${this.sectionName()}」章节` });

        // 挂载条目（固定）
        const fixedField = contentEl.createDiv({ cls: 'rl-ex-field' });
        fixedField.createEl('label', { cls: 'rl-ex-label', text: '条目（固定）' });
        fixedField.createDiv({
            cls: 'rl-ex-fixed-book',
            text: `《${this.entry.title}》${this.entry.platform ? ` · ${this.entry.platform}` : ''}${this.entry.developer ? ` · ${this.entry.developer}` : ''}`,
        });

        // 已有记录（可删）—— 时长明细 / 重温 / 周目 三个来源都从条目里读
        const listWrap = contentEl.createDiv({ cls: 'rl-ex-field' });
        listWrap.createEl('label', { cls: 'rl-ex-label', text: '已有记录' });
        const listEl = listWrap.createDiv({ cls: 'rl-ex-log-list' });
        const renderList = (e: MediaEntry) => {
            listEl.empty();
            const rows: { text: string; note?: string; index: number }[] = [];
            if (this.kind === 'time') {
                (e.playSessions ?? []).forEach((s, i) => {
                    rows.push({ text: `${s.date} · ${formatPlaytime(s.minutes)}`, note: s.note, index: i });
                });
            } else {
                (e.roundLogs ?? []).forEach((r, i) => {
                    if (r.kind !== this.kind) return;
                    rows.push({ text: `${r.date} · ${this.kind === 'rewatch' ? `第 ${r.round} 次重刷` : `第 ${r.round} 周目`}`, note: r.note, index: i });
                });
            }
            if (!rows.length) {
                listEl.createDiv({ cls: 'rl-ex-empty', text: '还没有记录' });
                return;
            }
            for (const r of rows) {
                const row = listEl.createDiv({ cls: 'rl-ex-log-item' });
                row.createSpan({ cls: 'rl-ex-log-date', text: r.text });
                if (r.note) row.createSpan({ cls: 'rl-ex-log-note', text: r.note });
                const del = row.createEl('button', { cls: 'rl-ex-log-del', text: '删除' });
                del.onclick = async () => {
                    del.setAttr('disabled', '');
                    try {
                        await this.plugin.deleteEntryLog(e.id, this.kind, r.index);
                        const fresh = await this.plugin.service.get(e.id);
                        if (fresh) renderList(fresh);
                    } catch (err) {
                        new Notice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
                        del.removeAttribute('disabled');
                    }
                };
            }
        };
        renderList(this.entry);

        // 日期
        const dateField = contentEl.createDiv({ cls: 'rl-ex-field' });
        dateField.createEl('label', { cls: 'rl-ex-label', text: meta.dateLabel });
        const dateEl = dateField.createEl('input', { cls: 'rl-ex-input', type: 'date' });
        dateEl.value = this.todayStr();

        // 数字（时长=小时 / 重温·周目=次数）+ 心得
        const metaRow = contentEl.createDiv({ cls: 'rl-ex-row' });
        const numField = metaRow.createDiv({ cls: 'rl-ex-field' });
        numField.createEl('label', { cls: 'rl-ex-label', text: meta.numLabel });
        const numEl = numField.createEl('input', {
            cls: 'rl-ex-input',
            type: 'number',
            attr: this.kind === 'time'
                ? { min: '0', step: '0.1', placeholder: meta.numPlaceholder }
                : { min: '1', step: '1', placeholder: meta.numPlaceholder },
        });
        // 重刷 / 周目的序号默认 = 已有条数 + 1（少写一次就多填一次）
        if (this.kind !== 'time') {
            const existing = (this.entry.roundLogs ?? []).filter((r) => r.kind === this.kind).length;
            numEl.value = String(existing + 1);
        }
        const noteField = metaRow.createDiv({ cls: 'rl-ex-field rl-ex-grow' });
        noteField.createEl('label', { cls: 'rl-ex-label', text: meta.noteLabel });
        const noteEl = noteField.createEl('input', { cls: 'rl-ex-input', placeholder: meta.notePlaceholder });

        // 预览（灰字占位 → 有效输入实时生成将写入笔记的那一行）
        const previewEl = contentEl.createDiv({ cls: 'rl-ex-preview', text: '填写日期和内容后显示预览' });

        // 🔴 #（用户 m00002）：「添加短评/记录重温等的功能项弹窗底部不要显示"取消"按钮，
        //   因为和弹窗顶部的叉重复了」⇒ 只留「记录」，关闭走右上角 ✕ / Esc。
        const foot = contentEl.createDiv({ cls: 'rl-ex-foot' });
        const submitBtn = foot.createEl('button', { cls: 'rl-ex-btn rl-ex-btn-primary', text: '记录', attr: { disabled: '' } });

        /** 校验 + 预览联动：日期与数字有效才启用提交，并实时渲染将写入笔记的那一行 */
        const updatePreview = () => {
            const date = dateEl.value.trim();
            const num = parseFloat(numEl.value);
            const note = noteEl.value.trim();
            const numOk = this.kind === 'time' ? !isNaN(num) && num > 0 : !isNaN(num) && num >= 1;
            if (!date || !numOk) {
                previewEl.setText('填写日期和内容后显示预览');
                previewEl.addClass('rl-ex-preview-muted');
                submitBtn.setAttr('disabled', '');
                return;
            }
            previewEl.removeClass('rl-ex-preview-muted');
            previewEl.empty();
            const lbl = previewEl.createDiv({ cls: 'rl-ex-preview-lbl', text: `将追加到《${this.entry.title}》${this.sectionName()}` });
            lbl.createSpan({ cls: 'rl-ex-preview-fname', text: `（${this.entry.notePath ? '已生成笔记' : '首次生成笔记'}）` });
            const md = this.kind === 'time'
                ? datedRecordLine(date, formatPlaytime(hoursToMinutes(num)), note)
                : datedRecordLine(
                      date,
                      this.kind === 'rewatch' ? `第 ${Math.round(num)} 次重刷` : `第 ${Math.round(num)} 周目`,
                      note,
                  );
            previewEl.createEl('pre', { cls: 'rl-ex-preview-md', text: md });
            submitBtn.removeAttribute('disabled');
        };
        dateEl.oninput = updatePreview;
        numEl.oninput = updatePreview;
        noteEl.oninput = updatePreview;

        submitBtn.onclick = async () => {
            const date = dateEl.value;
            const num = parseFloat(numEl.value);
            const note = noteEl.value.trim() || undefined;
            if (!date || isNaN(num)) return;
            submitBtn.setAttr('disabled', '');
            try {
                if (this.kind === 'time') {
                    await this.plugin.recordEntryLog(this.entry.id, this.kind, { date, hours: num, note });
                } else {
                    await this.plugin.recordEntryLog(this.entry.id, this.kind, { date, round: Math.round(num), note });
                }
                new Notice(`已${meta.title} · 《${this.entry.title}》`);
                this.close();
            } catch (err) {
                new Notice(`${meta.title}失败：${err instanceof Error ? err.message : String(err)}`);
                updatePreview();
            }
        };

        numEl.focus();
        updatePreview();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
