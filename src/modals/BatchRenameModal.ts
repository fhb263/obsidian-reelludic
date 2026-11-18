// 关联媒体重命名弹窗：先**列出计划**再执行。
//
// 🔴🔴 2026-11-13 用户指令（现行定稿）：
//   ⑴ 标题从「批量重命名」→ **「关联媒体重命名」**（设置页行名同步）；
//   ⑵ **不再显示「有多少个文件被跳过」**，只显示**关联的文件**（用户原话：「重命名这个页面不要
//      显示什么有多少个文件被跳过了只显示关联的文件」）⇒ 跳过项既不列清单、也不报数。
//
// 🔴🔴 2026-11-14 用户指令（**推翻上一版的 ⑶**，现行定稿）：
//   ⑶ 弹窗里**不要显示规则模板区**（用户原话：「这个重命名规则模板不要显示，还有这两个主次按钮
//      都被截断了」）⇒ 上一版加的 `renderTemplates` / `.rl-rename-templates` 整块已删除；
//      模板说明只留在设置页（`Settings.ts` 的「关联媒体重命名」行 tooltip 与 `RENAME_TEMPLATE_GROUPS`），
//      ⛔ 别再往弹窗里塞回来。
//   ⑷ 底部「取消 / 重命名」**必须完整可见**：`.rl-rename-ops` 固定在内容流末尾且在滚动区之外，
//      `.rl-rename-list` 自己滚（见 `styles.css`），⛔ 不要再给 ops 套滚动容器。
//
// 🔴 三条硬口径：
//   ⑴ **只弹计划、不动文件** —— 真正改名由宿主 `plugin.runBatchRename()` 做（`fileManager.renameFile`），
//      本弹窗只负责「让用户看清会变成什么」+ 确认。
//   ⑵ 默认**全选可改的**（能活到这里的条目都有可改名文件，见 `planBatchRename` 的过滤口径）。
//   ⑶ 改名不可撤销 ⇒ 逐条列「旧 → 新」，⛔ 别做成「点一下直接跑」。
import { App, Modal, Notice } from 'obsidian';
import type { RenamePlan } from 'pure/batchRename';
import { renamePlanTip } from 'pure/batchRename';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';

export class BatchRenameModal extends Modal {
    private boxes: Array<{ plan: RenamePlan; box: HTMLInputElement }> = [];
    private runBtn: HTMLButtonElement | null = null;
    private busy = false;

    constructor(
        app: App,
        private plans: RenamePlan[],
        /** 执行体留在宿主（⛔ 弹窗里不直接碰 vault） */
        private run: (picked: RenamePlan[]) => Promise<{ renamed: number; failed: number }>,
    ) {
        super(app);
    }

    private picked(): RenamePlan[] {
        return this.boxes.filter((b) => b.box.checked && b.plan.renames.length > 0).map((b) => b.plan);
    }

    private totalFiles(): number {
        return this.picked().reduce((n, p) => n + p.renames.length, 0);
    }

    private syncRunBtn(): void {
        if (!this.runBtn) return;
        const n = this.totalFiles();
        this.runBtn.setText(n > 0 ? `重命名 ${n} 个文件` : '重命名');
        this.runBtn.disabled = n === 0 || this.busy;
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '关联媒体重命名' });

        const actionable = this.plans.filter((p) => p.renames.length > 0);
        if (actionable.length === 0) {
            // 空态只说「没得改」，⛔ 不提跳过数量（用户 2026-11-13 口径 ⑵）。
            contentEl.createDiv({ cls: 'rl-rename-empty', text: '没有需要重命名的文件。' });
            return;
        }

        markScrollInside(this.modalEl);
        contentEl.createDiv({
            cls: 'rl-rename-desc',
            text: `按清单里的规则改名，共 ${actionable.length} 条条目、`
                + `${actionable.reduce((n, p) => n + p.renames.length, 0)} 个文件。勾选后执行：`,
        });

        const list = contentEl.createDiv({ cls: 'rl-rename-list' });
        for (const plan of actionable) {
            const row = list.createDiv({ cls: 'rl-rename-row' });
            const label = row.createEl('label', { cls: 'rl-rename-label' });
            const box = label.createEl('input', { type: 'checkbox' });
            box.checked = true;
            box.addEventListener('change', () => this.syncRunBtn());
            const body = label.createDiv({ cls: 'rl-rename-body' });
            body.createDiv({ cls: 'rl-rename-title', text: plan.title });
            for (const r of plan.renames) {
                body.createDiv({ cls: 'rl-rename-pair', text: `${r.name} → ${r.next}` });
            }
            this.boxes.push({ plan, box });
        }

        const ops = contentEl.createDiv({ cls: 'rl-rename-ops' });
        ops.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
        this.runBtn = ops.createEl('button', { cls: 'mod-cta', text: '重命名' });
        this.runBtn.addEventListener('click', () => void this.commit());
        this.syncRunBtn();
    }

    private async commit(): Promise<void> {
        if (this.busy) return;
        const picked = this.picked();
        if (picked.length === 0) return;
        this.busy = true;
        this.syncRunBtn();
        try {
            const r = await this.run(picked);
            // 🔴 结果必须报出来：改了几个、失败几个。⛔ 静默关窗会让用户不知道发生了什么。
            if (r.failed > 0) {
                new Notice(`重命名：成功 ${r.renamed} 个，失败 ${r.failed} 个（详见控制台）`, 8000);
            } else {
                new Notice(`已重命名 ${r.renamed} 个文件`, 5000);
            }
            this.close();
        } catch {
            this.busy = false;
            this.syncRunBtn();
            new Notice('重命名失败，请稍后再试');
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** 供测试/守卫读的一条摘要（与设置页行用同一函数，⛔ 别各拼一套） */
    static tipOf(plan: RenamePlan): string {
        return renamePlanTip(plan);
    }
}
