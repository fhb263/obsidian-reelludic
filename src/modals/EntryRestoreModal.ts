// 设置页 › 封面与清理 的「条目还原」弹窗：最近删除的 5 条条目，勾选后一键复活。
//
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ③）：原先同住本文件的 `AssetManagerModal`（附件管理）
//    **已整体搬去 `modals/AssetManagerModal.ts`** —— 它要改成「条目类型 → 系列」两级折叠并换用
//    独立的 `.rl-am-*` 类名，留在这里会和本文件的 `.rl-pc-*` 样式互相牵连。
//    ⛔ 别再把两个弹窗并回一个文件（用户报障的排版问题正是共类名引起的）。
//
// 🔴 口径：文件本身（笔记 / 封面 / 阅读存档）在 Obsidian 回收站，这里只还原**条目记录**；
//    要连文件一起找回得去回收站。⛔ 别在弹窗里偷偷重建文件。
import { App, Modal, Notice } from 'obsidian';
import { canRestoreWithSameId, type TrashRecord } from 'pure/entryTrash';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';

/** 删除时间 → 本地「YYYY-MM-DD HH:mm」；解析不了原样返回（⛔ 不显示 NaN） */
function fmtWhen(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─────────────────────────────── 条目还原 ───────────────────────────────

export class EntryRestoreModal extends Modal {
    private checks: { record: TrashRecord; box: HTMLInputElement }[] = [];
    private okBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        private records: TrashRecord[],
        /** 当前库里还活着的 id（判断「原 id 是否已被占用」） */
        private liveIds: readonly string[],
        /** 执行还原：收到被勾选的记录，返回成功条数；整体失败要抛（弹窗据此提示） */
        private onRestore: (picked: TrashRecord[]) => Promise<number>,
    ) {
        super(app);
    }

    private picked(): TrashRecord[] {
        return this.checks.filter((c) => c.box.checked).map((c) => c.record);
    }

    private syncBtn(): void {
        if (!this.okBtn) return;
        const n = this.picked().length;
        this.okBtn.setText(`还原选中（${n}）`);
        this.okBtn.disabled = n === 0;
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        if (this.records.length === 0) {
            contentEl.createEl('h2', { text: '条目还原' });
            contentEl.createDiv({ cls: 'rl-pc-empty', text: '暂无已删除的条目' });
            return;
        }
        // #634：与 DeleteEntryModal 同结构（内部列表 + 底部操作行）⇒ 滚动只在内部
        markScrollInside(this.modalEl);
        contentEl.createEl('h2', { text: '条目还原' });
        contentEl.createDiv({ cls: 'rl-pc-desc', text: `最近删除的 ${this.records.length} 个条目，勾选后可还原：` });

        const list = contentEl.createDiv({ cls: 'rl-pc-list' });
        for (const r of this.records) {
            const row = list.createDiv({ cls: 'rl-pc-row' });
            const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            cb.checked = true;
            cb.addEventListener('change', () => this.syncBtn());
            this.checks.push({ record: r, box: cb });
            row.createSpan({ cls: 'rl-pc-kind', text: ENTRY_TYPE_LABELS[r.entry.type] ?? r.entry.type });
            row.createSpan({ cls: 'rl-pc-name', text: r.entry.title, attr: { 'data-tip': r.entry.id } });
            const n = r.files?.length ?? 0;
            const extra = [r.entry.notePath ? '笔记' : '', n ? `${n} 个附件` : ''].filter(Boolean).join(' · ');
            if (extra) row.createSpan({ cls: 'rl-pc-hint-inline', text: `（${extra}）` });
            row.createSpan({ cls: 'rl-pc-when', text: fmtWhen(r.deletedAt) });
            if (!canRestoreWithSameId(r, this.liveIds)) {
                row.createDiv({ cls: 'rl-pc-warn', text: '原编号已被占用，将作为新条目还原' });
            }
        }

        contentEl.createDiv({
            cls: 'rl-pc-hint',
            text: '条目记录会直接回到列表；曾经连带删除的笔记 / 封面 / 阅读存档若要一起找回，请在 Obsidian 的回收站中还原对应文件。',
        });
        // 🔴 2026-10-25 用户指令：底部**不画「取消」** —— 右上角 ✕ 就是取消。
        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const ok = foot.createEl('button', { cls: 'rl-btn', text: '还原选中' });
        this.okBtn = ok;
        ok.onclick = async () => {
            const picked = this.picked();
            if (picked.length === 0) {
                new Notice('未选择任何条目');
                return;
            }
            ok.disabled = true;
            try {
                const done = await this.onRestore(picked);
                new Notice(done === picked.length ? `已还原 ${done} 个条目` : `已还原 ${done}/${picked.length} 个条目（其余失败）`);
                this.close();
            } catch (e) {
                ok.disabled = false;
                this.syncBtn();
                new Notice(`还原失败：${e instanceof Error ? e.message : String(e)}`);
            }
        };
        this.syncBtn();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
