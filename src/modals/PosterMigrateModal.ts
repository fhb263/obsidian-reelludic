// 封面迁移结果弹窗（v0.4 持续优化：一键迁移结束后弹出，明确成功/失败与失败原因）
import { Modal } from 'obsidian';

export interface PosterMigrateResult {
    /** 成功张数 */
    success: number;
    /** 失败张数 */
    fail: number;
    /** 失败明细（标题 → 原因），供排查 */
    failures: { title: string; reason: string }[];
    /** true = 已有迁移在进行中，本次未执行（防重） */
    skipped: boolean;
    /** 待下载的网络封面总数（0 = 库内无 URL 封面） */
    total: number;
}

export class PosterMigrateModal extends Modal {
    constructor(app: unknown, private result: PosterMigrateResult) {
        super(app as never);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createDiv({ cls: 'rl-mig-head', text: '封面迁移结果' });
        let summary: string;
        if (this.result.skipped) {
            summary = '已有封面迁移正在进行中，本次未执行。';
        } else if (this.result.total === 0) {
            summary = '库内没有需要下载的网络封面（当前条目的封面均为本地文件）。如需重新下载，可先删除 封面/ 下对应文件。';
        } else {
            summary = `成功 ${this.result.success} 张${this.result.fail > 0 ? `，失败 ${this.result.fail} 张` : '，全部完成'}。`;
        }
        contentEl.createDiv({ cls: 'rl-mig-summary', text: summary });

        // 失败明细：标题 → 原因，逐条列出（可滚动）
        if (this.result.fail > 0 && this.result.failures.length > 0) {
            contentEl.createDiv({ cls: 'rl-mig-hint', text: '以下封面下载失败，可在网络恢复后重试一键迁移：' });
            const list = contentEl.createDiv({ cls: 'rl-mig-list' });
            for (const f of this.result.failures) {
                const row = list.createDiv({ cls: 'rl-mig-item' });
                row.createSpan({ cls: 'rl-mig-title', text: f.title });
                row.createSpan({ cls: 'rl-mig-reason', text: f.reason });
            }
        }

        const foot = contentEl.createDiv({ cls: 'rl-mig-foot' });
        const btn = foot.createEl('button', { cls: 'mod-cta', text: '关闭' });
        btn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
