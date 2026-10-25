// 选择观看来源弹窗（海报墙「观看」按钮多链接时使用）
// DOM API 渲染，风格复用 ConfirmModal/NoteConflictModal（rl-nc-* 样式）
// open() 返回所选链接 URL；取消/关闭返回 null（安全方向：不打开任何链接）
import { App, Modal } from 'obsidian';
import type { WatchLink } from 'data/types';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';

export class LinkPickerModal extends Modal {
    private resolve: ((url: string | null) => void) | null = null;

    constructor(app: App, private entryTitle: string, private links: WatchLink[]) {
        super(app);
    }

    open(): Promise<string | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        // 🔴 #634：本窗有内层自滚列表（`.rl-linkpick-list`）+ 底部操作行 ⇒ 实测**双滚动条嵌套**
        //    （`_probe_634_nestscroll.cjs`：外层 scroll=682 client=585 可滚、内层 840/320 也可滚）
        //    ⇒ 标记「滚动只在内部」，外层不再滚。
        markScrollInside(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-desc rl-linkpick-title', text: `选择观看来源：《${this.entryTitle}》` });
        const list = contentEl.createDiv({ cls: 'rl-linkpick-list' });
        for (const l of this.links) {
            const row = list.createDiv({ cls: 'rl-linkpick-row', attr: { role: 'button', tabindex: '0' } });
            const label = row.createDiv({ cls: 'rl-linkpick-label', text: l.label || '自定义' });
            const url = row.createDiv({ cls: 'rl-linkpick-url', text: l.url });
            row.onclick = () => this.finish(l.url);
            row.onkeydown = (ev: KeyboardEvent) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    this.finish(l.url);
                }
            };
        }
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const cancel = ops.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.onclick = () => this.finish(null);
    }

    onClose(): void {
        // 关闭未选择 → null（安全方向）
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(url: string | null): void {
        this.resolve?.(url);
        this.resolve = null;
        this.close();
    }
}
