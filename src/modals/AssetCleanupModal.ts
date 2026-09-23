// 附件清理弹窗（#349）：列出**未被引用的附件**（封面 / 阅读存档），逐项勾选后删除。
//
// 演进：本弹窗原为 `PosterCleanupModal`（只清封面目录），现扩为「附件清理」——
// 用户报障「无法有效清理或删除被遗弃的附件与封面」，而阅读存档 JSON 此前**没有任何清理入口**。
//
// 🔴 两条硬口径：
//   ⑴ **删除一律走 `fileManager.trashFile`** —— 尊重用户「删除文件」偏好（系统回收站 / Obsidian 回收站），
//      ⛔ 不用 `vault.delete`（那是永久删除，旧实现用的就是它，误删无法挽回）。
//   ⑵ 路径为**库内相对**（`封面/x.jpg` / `阅读进度/x.json`，与 poster 存储格式一致，展示干净）；
//      删除前必须拼上库目录再 `getAbstractFileByPath` —— 直接查 `封面/x` 会在库根找不到。
import { App, Modal, Notice, TFile, normalizePath } from 'obsidian';
import type { OrphanAsset } from 'pure/orphanAssets';

/** 类型徽章文案（弹窗里一行一项，用户要一眼看出「这是什么文件」） */
const KIND_LABEL: Record<OrphanAsset['kind'], string> = { cover: '封面', store: '阅读存档' };

export class AssetCleanupModal extends Modal {
    private checks: { asset: OrphanAsset; box: HTMLInputElement }[] = [];
    private delBtn: HTMLButtonElement | null = null;

    constructor(app: App, private assets: OrphanAsset[], private libraryDir = 'ReelLudic') {
        super(app);
    }

    /** 库内相对 → vault 全路径（{libraryDir}/{p}） */
    private toVaultPath(p: string): string {
        return normalizePath(`${this.libraryDir}/${p}`);
    }

    /** 选中数（含逐项取消勾选后的实时值） */
    private selected(): OrphanAsset[] {
        return this.checks.filter((c) => c.box.checked).map((c) => c.asset);
    }

    private syncDelBtn(): void {
        if (!this.delBtn) return;
        const n = this.selected().length;
        this.delBtn.setText(`删除选中（${n}）`);
        this.delBtn.disabled = n === 0;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        if (this.assets.length === 0) {
            contentEl.createDiv({ cls: 'rl-pc-empty', text: '没有未被引用的附件，无需清理' });
            return;
        }
        contentEl.createEl('h2', { text: '附件清理' });
        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: `发现 ${this.assets.length} 个未被任何条目引用的文件（条目删除后遗留的封面 / 阅读存档）：`,
        });

        const list = contentEl.createDiv({ cls: 'rl-pc-list' });
        for (const a of this.assets) {
            const row = list.createDiv({ cls: 'rl-pc-row' });
            const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            cb.checked = true;
            cb.addEventListener('change', () => this.syncDelBtn());
            row.createSpan({ cls: 'rl-pc-kind', text: KIND_LABEL[a.kind] });
            row.createSpan({ cls: 'rl-pc-name', text: a.name, attr: { 'data-tip': a.path } });
            this.checks.push({ asset: a, box: cb });
        }

        contentEl.createDiv({ cls: 'rl-pc-hint', text: '删除后进入回收站（跟随 Obsidian「删除文件」设置），可在回收站还原。' });
        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const cancel = foot.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancel.onclick = () => this.close();
        const delBtn = foot.createEl('button', { cls: 'rl-nc-danger', text: '删除选中' });
        this.delBtn = delBtn;
        delBtn.onclick = async () => {
            const selected = this.selected();
            if (selected.length === 0) {
                new Notice('未选择任何文件');
                return;
            }
            delBtn.disabled = true;
            let ok = 0;
            for (const a of selected) {
                const f = this.app.vault.getAbstractFileByPath(this.toVaultPath(a.path));
                if (!(f instanceof TFile)) {
                    new Notice(`文件不存在：${a.name}`);
                    continue;
                }
                try {
                    // 🔴 尊重用户的回收站偏好（⛔ 不用 vault.delete 的永久删除）
                    await this.app.fileManager.trashFile(f);
                    ok++;
                } catch (e) {
                    new Notice(`删除失败：${a.name}（${e instanceof Error ? e.message : String(e)}）`);
                }
            }
            new Notice(ok === selected.length ? `已清理 ${ok} 个文件` : `已清理 ${ok}/${selected.length} 个文件（其余失败）`);
            this.close();
        };
        this.syncDelBtn();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
