// 游玩记录录入弹窗：日期 + 时长（小时）+ 心得 → 保存到游戏笔记「游玩记录」章节
// 仿书籍摘抄弹窗（ExcerptModal）样式（rl-ex-*），固定挂载目标游戏；含生成预览（rl-ex-preview）
// DOM API 渲染（非 Svelte），样式复用 styles.css 中的 rl-ex-*
import { App, Modal, Notice } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry } from 'data/types';
import { formatPlaytime, hoursToMinutes } from 'pure/playtime';

export class GameSessionModal extends Modal {
    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private game: MediaEntry,
    ) {
        super(app);
    }

    /** 本地日期 YYYY-MM-DD */
    private todayStr(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const head = contentEl.createDiv({ cls: 'rl-ex-head' });
        head.createEl('h2', { text: '记录游玩' });
        head.createSpan({ cls: 'rl-ex-hint', text: '日期 + 游玩时长（小时）+ 心得 → 保存到游戏笔记' });

        // 挂载游戏（固定）
        const gameField = contentEl.createDiv({ cls: 'rl-ex-field' });
        gameField.createEl('label', { cls: 'rl-ex-label', text: '游戏（固定）' });
        gameField.createDiv({
            cls: 'rl-ex-fixed-book',
            text: `《${this.game.title}》${this.game.platform ? ` · ${this.game.platform}` : ''}${this.game.developer ? ` · ${this.game.developer}` : ''}`,
        });

        // 日期
        const dateField = contentEl.createDiv({ cls: 'rl-ex-field' });
        dateField.createEl('label', { cls: 'rl-ex-label', text: '游玩日期（默认今天）' });
        const dateEl = dateField.createEl('input', { cls: 'rl-ex-input', type: 'date' });
        dateEl.value = this.todayStr();

        // 时长（小时）+ 心得
        const metaRow = contentEl.createDiv({ cls: 'rl-ex-row' });
        const hoursField = metaRow.createDiv({ cls: 'rl-ex-field' });
        hoursField.createEl('label', { cls: 'rl-ex-label', text: '游玩时长（小时，可小数）' });
        const hoursEl = hoursField.createEl('input', { cls: 'rl-ex-input', type: 'number', attr: { min: '0', step: '0.1', placeholder: '如 1.5' } });
        const noteField = metaRow.createDiv({ cls: 'rl-ex-field rl-ex-grow' });
        noteField.createEl('label', { cls: 'rl-ex-label', text: '心得（可选，支持 [[双链]]）' });
        const noteEl = noteField.createEl('input', { cls: 'rl-ex-input', placeholder: '写下本次游玩的想法…' });

        // 预览（与摘抄弹窗一致：灰字占位 → 有效输入实时生成 Markdown 预览行）
        const previewEl = contentEl.createDiv({ cls: 'rl-ex-preview', text: '填写日期和时长后显示预览' });

        // 操作
        const foot = contentEl.createDiv({ cls: 'rl-ex-foot' });
        const cancelBtn = foot.createEl('button', { cls: 'rl-ex-btn', text: '取消' });
        const submitBtn = foot.createEl('button', { cls: 'rl-ex-btn rl-ex-btn-primary', text: '记录', attr: { disabled: '' } });

        /** 校验 + 预览联动：日期与时长有效才启用提交，并实时渲染将写入笔记的游玩记录行 */
        const updatePreview = () => {
            const date = dateEl.value.trim();
            const hours = parseFloat(hoursEl.value);
            const note = noteEl.value.trim();
            if (!date || isNaN(hours) || hours <= 0) {
                previewEl.setText('填写日期和时长后显示预览');
                previewEl.addClass('rl-ex-preview-muted');
                submitBtn.setAttr('disabled', '');
                return;
            }
            previewEl.removeClass('rl-ex-preview-muted');
            previewEl.empty();
            const lbl = previewEl.createDiv({ cls: 'rl-ex-preview-lbl', text: `将追加到《${this.game.title}》游玩记录` });
            lbl.createSpan({ cls: 'rl-ex-preview-fname', text: `（${this.game.notePath ? '已生成笔记' : '首次生成笔记'}）` });
            const md = `- **${date}** · ${formatPlaytime(hoursToMinutes(hours))}${note ? ` · ${note}` : ''}`;
            previewEl.createEl('pre', { cls: 'rl-ex-preview-md', text: md });
            submitBtn.removeAttribute('disabled');
        };
        dateEl.oninput = updatePreview;
        hoursEl.oninput = updatePreview;
        noteEl.oninput = updatePreview;

        submitBtn.onclick = async () => {
            const hours = parseFloat(hoursEl.value);
            if (!dateEl.value || isNaN(hours) || hours <= 0) return;
            submitBtn.setAttr('disabled', '');
            try {
                await this.plugin.recordPlaySession(this.game.id, {
                    date: dateEl.value,
                    hours,
                    note: noteEl.value.trim() || undefined,
                });
                new Notice(`已记录游玩 · 《${this.game.title}》+${hours}h`);
                this.close();
            } catch (err) {
                new Notice(`记录游玩失败：${err instanceof Error ? err.message : String(err)}`);
                updatePreview();
            }
        };

        cancelBtn.onclick = () => this.close();

        hoursEl.focus();
        updatePreview();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}