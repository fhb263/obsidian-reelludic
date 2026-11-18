// G 双写冲突确认弹窗：笔记文件被手动改过、与库数据不一致时二选一
// 「保留笔记修改」/「保留表单修改」（DOM API 渲染，样式写入 styles.css rl-nc-*）
//
// 🔴 文案口径沿革：
//   · #360（用户 2026-09-21「两个选项不明不清」）：旧「覆盖为库数据 / 保留笔记改动」含糊，
//     改成「保留笔记文件 / 用库数据重写笔记」，标题点明两端是**笔记文件**与**库数据**，
//     描述先给「库数据已保存」这个前提。
//   · 🔴 2026-11-12 用户再裁定（m00353 ①-13）：「冲突解决提示描述按钮改成
//     **『保留笔记修改』/『保留表单修改』**」。
//     ⇒ 两个按钮都改成「保留 X 修改」的同构句式 —— 用户此刻心里想的是**改哪一边**，
//       而不是「我选择保留一个文件还是重写一个文件」，同构句式把权衡摆在同一层。
//       ⛔ 「保留表单修改」语义 = 用表单（库数据）那一版覆盖笔记文件，别名不变（`overwrite`）；
//         别改成「丢弃笔记修改」这类带贬义的写法 —— 两条路都是用户自己的改动，没有对错。
//     ⚠️ `data-tip` 仍补后果，因为「保留表单修改」会丢掉手写进笔记的内容，光看按钮名看不出来。
import { App, Modal } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';

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
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        // 警告 emoji 圆形底（用户 2026-09-09 拍板回退 emoji 保证显示）
        const icon = contentEl.createDiv({ cls: 'rl-nc-icon', text: '⚠️' });
        void icon;
        contentEl.createEl('h2', { cls: 'rl-nc-title', text: '笔记文件与库数据不一致' });
        contentEl.createDiv({
            cls: 'rl-nc-desc',
            text: `《${this.entryTitle}》的库数据已保存。这篇笔记你手动改过，要怎么处理这个文件？`,
        });
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        // 安全方向（不动笔记）：中性次按钮靠左
        const keep = ops.createEl('button', { cls: 'rl-btn', text: '保留笔记修改' });
        keep.setAttribute('data-tip', '保留你手写进笔记的内容，之后不再提示');
        keep.onclick = () => this.finish('keep');
        // 危险动作（覆盖手改）：危险主按钮实心红靠右
        const overwrite = ops.createEl('button', { cls: 'rl-nc-danger', text: '保留表单修改' });
        overwrite.setAttribute('data-tip', '按表单内容重写笔记（你手写进笔记的内容会丢失）');
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
