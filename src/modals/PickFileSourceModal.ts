// 文件来源二选一弹窗（替代 Menu——弹窗内 Menu 定位受 Modal 层影响不可靠）：
// 「从库中选择…」→ vault 文件选择器 / 「从系统浏览…」→ 系统对话框
import { App, Modal } from 'obsidian';

export interface PickSourceChoice {
    title: string;
    icon: string;
}

export class PickFileSourceModal extends Modal {
    constructor(
        app: App,
        private choices: [PickSourceChoice, PickSourceChoice],
        private onPick: (index: 0 | 1) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-pick-src');

        const grid = contentEl.createDiv({ cls: 'rl-pick-src-grid' });
        this.choices.forEach((c, i) => {
            const btn = grid.createEl('button', {
                cls: 'rl-pick-src-btn',
            });
            const icon = btn.createSpan({ cls: 'rl-pick-src-icon' });
            // Obsidian 内建图标（setIcon）
            (window as unknown as { setIcon?: (el: HTMLElement, id: string) => void }).setIcon?.(icon, c.icon);
            btn.createDiv({ cls: 'rl-pick-src-name', text: c.title });
            btn.addEventListener('click', () => {
                this.onPick(i as 0 | 1);
                this.close();
            });
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
