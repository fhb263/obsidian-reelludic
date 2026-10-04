// G 双写冲突确认弹窗：笔记文件被手动改过、与库数据不一致时二选一
// 「保留笔记文件」/「用库数据重写笔记」（DOM API 渲染，样式写入 styles.css rl-nc-*）
//
// 🔴 文案口径（#360，用户 2026-09-21 反馈「两个选项不明不清」后重写）：
//    旧文案「覆盖为库数据 / 保留笔记改动」有两处含糊 ——
//    ① 「库数据」是内部叫法，用户不知道指什么；
//    ② 没说清**库数据其实已经保存了**（条目字段在点保存那一刻就落库），弹窗只决定
//       **那篇 .md 笔记文件**怎么办，但旧文案读起来像「二选一丢一边」。
//    故新文案：标题点明「不一致」的两端是**笔记文件**与**库数据**；描述先给「库数据已保存」
//    这个前提；两个按钮各自直接说出**对笔记文件做什么**，tip 补上后果与「不再重复提示」。
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
        const keep = ops.createEl('button', { cls: 'rl-btn', text: '保留笔记文件' });
        keep.setAttribute('data-tip', '保留你的笔记，不再提示');
        keep.onclick = () => this.finish('keep');
        // 危险动作（覆盖手改）：危险主按钮实心红靠右
        const overwrite = ops.createEl('button', { cls: 'rl-nc-danger', text: '用库数据重写笔记' });
        overwrite.setAttribute('data-tip', '重写笔记（你手写的会丢失）');
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
