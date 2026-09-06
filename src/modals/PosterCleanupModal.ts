// H 孤儿封面清理弹窗：列出封面目录中未被任何条目引用的文件，逐项勾选后删除
// DOM API 渲染，样式写入 styles.css rl-pc-*；删除走 vault.delete（TFile）
// 孤儿路径为「库目录相对」（封面/x.jpg，与 poster 存储格式一致，展示干净）；删除需解析成 vault 全路径
// （{libraryDir}/封面/x.jpg）再 getAbstractFileByPath——否则 vault.getAbstractFileByPath('封面/x') 查根目录找不到 → 文件不存在
import { App, Modal, Notice, TFile, normalizePath } from 'obsidian';

export class PosterCleanupModal extends Modal {
    constructor(app: App, private orphanPaths: string[], private libraryDir = 'ReelLudic') {
        super(app);
    }

    /** 库目录相对（封面/x.jpg）→ vault 全路径（{libraryDir}/封面/x.jpg） */
    private toVaultPath(p: string): string {
        return normalizePath(`${this.libraryDir}/${p}`);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '清理孤儿封面' });
        if (this.orphanPaths.length === 0) {
            contentEl.createDiv({ cls: 'rl-pc-empty', text: '封面目录没有未被引用的文件 — 无需清理 🎉' });
            return;
        }
        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: `发现 ${this.orphanPaths.length} 个未被任何条目引用的封面文件（可能来自取消的添加弹窗或旧版本残留）：`,
        });

        const list = contentEl.createDiv({ cls: 'rl-pc-list' });
        const checks: HTMLInputElement[] = [];
        for (const p of this.orphanPaths) {
            const row = list.createDiv({ cls: 'rl-pc-row' });
            const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            cb.checked = true;
            checks.push(cb);
            const name = row.createEl('span', { cls: 'rl-pc-name', text: p, attr: { 'data-tip': p } });
            void name;
        }

        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const delBtn = foot.createEl('button', { cls: 'rl-nc-danger', text: `删除选中（${checks.length}）` });
        delBtn.onclick = async () => {
            const selected = this.orphanPaths.filter((_, i) => checks[i]?.checked);
            if (selected.length === 0) {
                new Notice('未选择任何文件');
                return;
            }
            let ok = 0;
            for (const p of selected) {
                const f = this.app.vault.getAbstractFileByPath(this.toVaultPath(p));
                if (f instanceof TFile) {
                    try {
                        await this.app.vault.delete(f);
                        ok++;
                    } catch (e) {
                        new Notice(`删除失败：${p}（${e instanceof Error ? e.message : String(e)}）`);
                    }
                } else {
                    new Notice(`文件不存在：${p}`);
                }
            }
            new Notice(`已删除 ${ok}/${selected.length} 个孤儿封面`);
            this.close();
        };
        const cancel = foot.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.onclick = () => this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
