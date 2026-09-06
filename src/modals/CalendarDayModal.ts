// 月历某天详情弹窗：显示当天 plannedDate 的想看条目列表
// DOM API 渲染（非 Svelte），样式写入 styles.css（rl-day-*）
import { App, Modal } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { statusLabel } from 'pure/labels';

export class CalendarDayModal extends Modal {
    private dayEntries: MediaEntry[];

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private dateStr: string,
        entries: MediaEntry[],
    ) {
        super(app);
        this.dayEntries = entries
            .filter((e) => e.plannedDate === dateStr)
            .sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        const head = contentEl.createDiv({ cls: 'rl-day-head' });
        head.createEl('h2', { text: `${this.dateStr} 计划` });
        head.createSpan({ cls: 'rl-day-cnt', text: `${this.dayEntries.length} 条` });

        if (this.dayEntries.length === 0) {
            contentEl.createDiv({ cls: 'rl-day-empty', text: '当天没有计划观看的条目 — 编辑条目在「想看」状态下设置计划观看日期' });
            return;
        }

        const list = contentEl.createDiv({ cls: 'rl-day-list' });
        for (const e of this.dayEntries) {
            const row = list.createDiv({ cls: 'rl-day-item' });

            const cover = row.createDiv({ cls: 'rl-day-cv' });
            const url = this.plugin.resolvePoster(e);
            if (url) {
                // 豆瓣图床防盗链（无 Referer → 418）：img + referrerpolicy="unsafe-url" 强制携带 Referer
                const attrs: Record<string, string> = { src: url };
                if (/doubanio\.com/.test(url)) attrs.referrerpolicy = 'unsafe-url';
                cover.createEl('img', { attr: attrs });
            } else {
                cover.setText(e.title.slice(0, 2));
            }

            const inf = row.createDiv({ cls: 'rl-day-inf' });
            inf.createDiv({ cls: 'rl-day-t', text: e.title, attr: { 'data-tip': e.title } });
            const meta = inf.createDiv({ cls: 'rl-day-meta' });
            meta.createSpan({ cls: 'rl-day-type', text: ENTRY_TYPE_LABELS[e.type] });
            if (e.year) meta.createSpan({ cls: 'rl-day-year', text: String(e.year) });
            if ((e.type === 'tv' || e.type === 'anime') && e.progress) {
                const p = e.progress;
                meta.createSpan({
                    cls: 'rl-day-prog',
                    text: p.totalEpisodes ? `S${p.season}E${p.episode}/${p.totalEpisodes}` : `S${p.season}E${p.episode}`,
                });
            }
            meta.createSpan({ cls: `rl-badge rl-badge-${e.status}`, text: statusLabel(e.type, e.status) });

            const ops = row.createDiv({ cls: 'rl-day-ops' });
            const editBtn = ops.createEl('button', { cls: 'rl-day-btn', text: '编辑' });
            editBtn.onclick = () => {
                this.close();
                void this.plugin.openEditModal(e.id);
            };
            if (e.notePath) {
                const noteBtn = ops.createEl('button', { cls: 'rl-day-btn', text: '打开笔记' });
                noteBtn.onclick = () => {
                    this.close();
                    void this.plugin.openEntryNote(e.id);
                };
            }
            // 清除排期：删除此条目排期，计划观看日期置空（条目回到待排区）；
            // 弹窗保持打开并重绘——可连续清除当天多条排期，不必反复打开
            const clearBtn = ops.createEl('button', { cls: 'rl-day-btn rl-day-btn-danger', text: '清除排期' });
            clearBtn.setAttribute('data-tip', '删除此条目排期，日期置空');
            clearBtn.onclick = async () => {
                await this.plugin.planEntry(e.id, '');
                this.dayEntries = this.dayEntries.filter((x) => x.id !== e.id);
                this.onOpen();
            };
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
