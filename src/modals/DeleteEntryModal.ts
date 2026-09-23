// 删除条目的资产清单弹窗（#350 · 方案文档 M3）：把原来那句「已生成的笔记文件将一并删除」的轻量警告
// 换成**逐项可见、可取消勾选**的清单 —— 用户报障「无法有效清理或删除被遗弃的附件与封面」，
// 「被遗弃」必须靠**清单**表达（哪些文件会被一起清掉、哪些不会）。
//
// 🔴 三条口径：
//  ⑴ **本弹窗就是那次「必确认」**：应用内不再有别的确认（官方 `promptForDeletion` 在
//     `promptDelete=false` 时**不弹窗直接删**，所以确认必须由我们自己承担 —— 方案文档 D-9）。
//  ⑵ 媒体文件（书 / 影片）标 `risky` ⇒ **默认不勾**；库外的再标 `deletable: false`（只展示不提供删除）。
//  ⑶ 用户取消 → resolve `null`，宿主**什么都不做**（⛔ 不产出「半个删除」）。
import { App, Modal } from 'obsidian';
import { ENTRY_ASSET_LABEL, type EntryAsset } from 'pure/orphanAssets';

export class DeleteEntryModal extends Modal {
    private resolve: ((v: EntryAsset[] | null) => void) | null = null;
    private checks: { asset: EntryAsset; box: HTMLInputElement }[] = [];
    private delBtn: HTMLButtonElement | null = null;

    constructor(app: App, private heading: string, private assets: EntryAsset[]) {
        super(app);
    }

    /** 返回用户勾选的项（含未勾的都不算）；取消 / 直接关闭 → `null` */
    open(): Promise<EntryAsset[] | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    /** 选中项：⛔ `deletable: false` 的（库外媒体）即使被勾也不参与删除 */
    private picked(): EntryAsset[] {
        return this.checks.filter((c) => c.box.checked && c.asset.deletable).map((c) => c.asset);
    }

    private syncDelBtn(): void {
        if (!this.delBtn) return;
        this.delBtn.setText(`删除（${this.picked().length + 1} 项）`);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.heading });
        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: this.assets.length
                ? '将删除下列内容，不需要的可以取消勾选：'
                : '未发现关联文件，将只删除条目记录：',
        });

        if (this.assets.length) {
            const list = contentEl.createDiv({ cls: 'rl-pc-list' });
            for (const a of this.assets) {
                const row = list.createDiv({ cls: 'rl-pc-row' });
                const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                cb.checked = a.risk === 'safe'; // safe 默认勾选；媒体（risky）默认不勾
                cb.disabled = !a.deletable;
                cb.addEventListener('change', () => this.syncDelBtn());
                this.checks.push({ asset: a, box: cb });
                row.createSpan({ cls: 'rl-pc-kind', text: ENTRY_ASSET_LABEL[a.kind] });
                row.createSpan({ cls: 'rl-pc-name', text: a.name, attr: { 'data-tip': a.path } });
                if (a.hint) row.createSpan({ cls: 'rl-pc-hint-inline', text: `（${a.hint}）` });
            }
        }

        contentEl.createDiv({ cls: 'rl-pc-hint', text: '勾选的文件删除后进入回收站（跟随 Obsidian「删除文件」设置），可在回收站还原。' });
        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const cancel = foot.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancel.onclick = () => this.finish(null);
        const del = foot.createEl('button', { cls: 'rl-nc-danger', text: '删除' });
        this.delBtn = del;
        del.onclick = () => this.finish(this.picked());
        this.syncDelBtn();
    }

    onClose(): void {
        // 直接关掉（Esc / 点遮罩）→ 取消方向
        this.resolve?.(null);
        this.resolve = null;
        this.contentEl.empty();
    }

    private finish(v: EntryAsset[] | null): void {
        this.resolve?.(v);
        this.resolve = null;
        this.close();
    }
}
