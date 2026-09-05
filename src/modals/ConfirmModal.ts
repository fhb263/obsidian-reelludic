// 通用确认弹窗（替代 window.confirm——Electron 原生 confirm 会阻塞主线程，
// 关闭后与 Obsidian Modal 关闭动画竞争导致下一个弹窗失焦/被遮罩拦截，无法输入）
// DOM API 渲染，样式复用 rl-nc-*（NoteConflictModal 同款）
import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
    private resolve: ((v: boolean) => void) | null = null;

    constructor(app: App, private message: string, private confirmText = '确定') {
        super(app);
    }

    open(): Promise<boolean> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-icon', text: '⚠️' });
        contentEl.createDiv({ cls: 'rl-nc-desc', text: this.message });
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const cancel = ops.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.onclick = () => this.finish(false);
        const ok = ops.createEl('button', { cls: 'rl-nc-danger', text: this.confirmText });
        ok.onclick = () => this.finish(true);
    }

    onClose(): void {
        // 关闭未选择 → false（安全方向）
        this.resolve?.(false);
        this.contentEl.empty();
    }

    private finish(v: boolean): void {
        this.resolve?.(v);
        this.resolve = null;
        this.close();
    }
}
