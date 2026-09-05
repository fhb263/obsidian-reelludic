// G 双写冲突确认弹窗：笔记被外部修改（用户在 Obsidian 手动编辑）时二选一
// 覆盖为库数据 / 保留笔记改动（DOM API 渲染，样式写入 styles.css rl-nc-*）
import { App, Modal } from 'obsidian';

export type ConflictChoice = 'overwrite' | 'keep';

export class NoteConflictModal extends Modal {
    private resolve: ((v: ConflictChoice) => void) | null = null;

    constructor(app: App, private entryTitle: string) {
        super(app);
    }

    /** open() 返回 Promise，选中/关闭即 resolve */
    open(): Promise<ConflictChoice> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-icon', text: '⚠️' });
        contentEl.createEl('h2', { text: '笔记已被外部修改' });
        contentEl.createDiv({
            cls: 'rl-nc-desc',
            text: `《${this.entryTitle}》笔记与库数据不一致（检测到你在 Obsidian 中手动编辑过笔记内容）。选择如何处理？`,
        });
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const keep = ops.createEl('button', { cls: 'mod-cta', text: '保留笔记改动' });
        keep.title = '不重写笔记，保留你的手动编辑（库数据已保存）';
        keep.onclick = () => this.finish('keep');
        const overwrite = ops.createEl('button', { cls: 'rl-nc-danger', text: '覆盖为库数据' });
        overwrite.title = '用库数据重写笔记，你的手动编辑将被覆盖';
        overwrite.onclick = () => this.finish('overwrite');
    }

    onClose(): void {
        // 未选择直接关闭 → 默认保留（安全方向：不覆盖用户手改）
        this.resolve?.('keep');
        this.contentEl.empty();
    }

    private finish(c: ConflictChoice): void {
        this.resolve?.(c);
        this.resolve = null;
        this.close();
    }
}
