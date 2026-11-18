// 笔记导入弹窗（用户 2026-11-08）：「有没有再加个检索库内笔记文件生成条目的项在基本设置下」
//
// 职责划分（与 `openPosterMigrate` 同架构，⛔ 别把扫库搬进弹窗）：
//  · 扫库 / 判定 / 写盘 / 落 catalog 全在 `main.importNotesToEntries()` —— 扫描口径只此一处；
//  · 本弹窗**只负责**：列清单、让用户勾选、回调把选中的 path 交回去。
// 两边各写一份判据必然分叉（弹窗列出 50 条、实导 48 条，那两条不动会被当成故障）。
//
// 🔴 合规候选默认**勾上**：用户点这个按钮的意图就是「把那些笔记捞出来」，默认全不选等于点了没反应。
//    但每一条仍可单独取消 —— 用户裁定的是「勾选后导入」，不是「全自动导入」。
// ⚠️ 被跳过的（模板 / 自定义 type / 已被占用）**不进勾选列表**，只作说明展示：
//    它们一旦可勾选，就等于把「看一眼再决定」这道闸交给默认值去关。
import { App, Modal } from 'obsidian';
import type { NoteImportCandidate, NoteImportSkipped } from 'pure/noteImport';

export class NoteImportModal extends Modal {
    private checks: { cand: NoteImportCandidate; box: HTMLInputElement }[] = [];
    private okBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        private candidates: readonly NoteImportCandidate[],
        private skipped: readonly NoteImportSkipped[],
        /** 选中项的 path 列表（被 tick 勾选的、默认全勾） */
        private onConfirm: (paths: string[]) => void,
    ) {
        super(app);
    }

    private selected(): string[] {
        return this.checks.filter((c) => c.box.checked).map((c) => c.cand.path);
    }

    private syncOkBtn(): void {
        if (!this.okBtn) return;
        const n = this.selected().length;
        this.okBtn.setText(`导入选中（${n}）`);
        this.okBtn.disabled = n === 0;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '从笔记导入条目' });

        if (this.candidates.length === 0) {
            contentEl.createDiv({
                cls: 'rl-pc-empty',
                text: '没有可导入的笔记（六种类型、标题非占位符、且未被现有条目占用的笔记才会出现在这里）',
            });
            this.renderSkipped(contentEl);
            return;
        }

        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: `发现 ${this.candidates.length} 篇可导入的笔记。导入后它们会出现在海报墙上，并把新 id 写回笔记。`,
        });

        const list = contentEl.createDiv({ cls: 'rl-pc-list' });
        for (const c of this.candidates) {
            const row = list.createDiv({ cls: 'rl-pc-row' });
            const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            cb.checked = true;
            cb.addEventListener('change', () => this.syncOkBtn());
            // 类型徽章：用户要一眼看出「这条会被归到哪个库」
            row.createSpan({ cls: 'rl-pc-kind', text: c.type });
            row.createSpan({ cls: 'rl-pc-name', text: c.title, attr: { 'data-tip': c.path } });
            // 🔴 降级提示（用户 2026-11-08 裁定「降级提示」）：非法值不阻断导入，但必须让用户看见
            //    「哪里不认识、降成了什么」—— 否则条目导进来了、状态是错的、用户以为成功了。
            //    文案来自 `cand.warnings`（判据唯一真源在 pure/noteImport），⛔ 这里不重推原因。
            //    样式复用现成的 `.rl-pc-warn`（styles.css:4742），不新造类名。
            if (c.warnings?.length) {
                row.createDiv({
                    cls: 'rl-pc-warn',
                    text: c.warnings.join('；'),
                    attr: { 'data-tip': c.warnings.join('\n') },
                });
            }
            this.checks.push({ cand: c, box: cb });
        }

        this.renderSkipped(contentEl);

        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const okBtn = foot.createEl('button', { cls: 'mod-cta', text: '导入选中' });
        this.okBtn = okBtn;
        okBtn.onclick = () => {
            const paths = this.selected();
            if (paths.length === 0) return;
            this.close();
            this.onConfirm(paths);
        };
        this.syncOkBtn();
    }

    /**
     * 被跳过的清单。
     * 🔴 必须显示：用户看到「为什么它没被收」，才不会把「扫描器很谨慎」误读成「功能坏了」。
     *    尤其是 `musicCN` 那 140 篇 —— 不解释的话用户只会觉得「我库里明明有一堆笔记」。
     */
    private renderSkipped(parent: HTMLElement): void {
        if (this.skipped.length === 0) return;
        const box = parent.createDiv({ cls: 'rl-pc-hint' });
        box.createDiv({ text: `另有 ${this.skipped.length} 篇被跳过（不属于这六种类型 / 标题是模板占位符 / 已被现有条目占用）：` });
        const list = box.createEl('ul');
        // 只列前 12 条：再多会把弹窗撑成一份日志，反而没人看
        for (const s of this.skipped.slice(0, 12)) {
            list.createEl('li', { text: `${s.path} —— ${s.reason}` });
        }
        if (this.skipped.length > 12) {
            list.createEl('li', { text: `……其余 ${this.skipped.length - 12} 篇同类型跳过` });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
