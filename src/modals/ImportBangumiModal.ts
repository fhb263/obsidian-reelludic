// 追番表「从 Bangumi 导入」弹窗：输入用户 ID（可选，留空自动获取） + 勾选收藏列表 → 逐项导入
// DOM API 渲染，样式写入 styles.css rl-import-* / rl-btn
import { Modal, Notice, type App } from 'obsidian';

interface ImportResult {
    added: number;
    skipped: number;
}

export class ImportBangumiModal extends Modal {
    constructor(
        app: App,
        private onImport: (
            userId: string | undefined,
            types: { want: boolean; watching: boolean; watched: boolean },
            onProgress: (done: number, total: number, label: string) => void,
        ) => Promise<ImportResult>,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-import-modal');

        contentEl.createEl('h2', { text: '从 Bangumi 导入追番' });
        contentEl.createEl('div', {
            cls: 'rl-import-hint',
            text: '拉取你的 Bangumi 收藏列表为动画条目（按标题+类型去重，已存在的跳过）。需已配置 Bangumi Token（设置 → 服务集成）。',
        });

        // 用户 ID 输入（可选）
        contentEl.createEl('label', { cls: 'rl-import-label', text: 'Bangumi 用户 ID（可选，留空自动从 Token 获取）' });
        const uidInput = contentEl.createEl('input', {
            cls: 'rl-input rl-import-uid',
            attr: { placeholder: '如 595130，留空自动获取', type: 'text' },
        });

        // 收藏列表勾选
        contentEl.createEl('label', { cls: 'rl-import-label', text: '导入哪些列表' });
        const checks: { key: 'want' | 'watching' | 'watched'; label: string; box: HTMLInputElement }[] = [];
        for (const [key, label] of [['want', '想看'], ['watching', '在看'], ['watched', '已看']] as const) {
            const row = contentEl.createDiv({ cls: 'rl-import-check' });
            const box = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
            box.checked = key === 'watching';
            row.createSpan({ text: label });
            checks.push({ key, label, box });
        }

        // 状态行（进度/错误）
        const status = contentEl.createDiv({ cls: 'rl-import-status', text: '' });

        // 操作区
        const ops = contentEl.createDiv({ cls: 'rl-import-ops' });
        const cancelBtn = ops.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());
        const goBtn = ops.createEl('button', { cls: 'rl-btn rl-btn-primary', text: '开始导入' });

        goBtn.addEventListener('click', async () => {
            const types = {
                want: checks.find((c) => c.key === 'want')?.box.checked ?? false,
                watching: checks.find((c) => c.key === 'watching')?.box.checked ?? false,
                watched: checks.find((c) => c.key === 'watched')?.box.checked ?? false,
            };
            if (!types.want && !types.watching && !types.watched) {
                new Notice('请至少勾选一个收藏列表');
                return;
            }
            goBtn.setAttr('disabled', 'true');
            goBtn.setText('导入中…');
            cancelBtn.setAttr('disabled', 'true');
            try {
                const r = await this.onImport(
                    uidInput.value.trim() || undefined,
                    types,
                    (done, total, label) => {
                        status.setText(`${label}（${done}/${total}）`);
                    },
                );
                status.setText(`导入完成：新增 ${r.added}，跳过 ${r.skipped}（重复/无效）`);
                new Notice(`Bangumi 导入完成：新增 ${r.added} 条`);
                if (r.added > 0) {
                    // 稍后自动关闭
                    window.setTimeout(() => this.close(), 1500);
                } else {
                    goBtn.removeAttribute('disabled');
                    goBtn.setText('开始导入');
                    cancelBtn.removeAttribute('disabled');
                }
            } catch (e) {
                status.setText('');
                new Notice(e instanceof Error ? e.message : String(e), 8000);
                goBtn.removeAttribute('disabled');
                goBtn.setText('开始导入');
                cancelBtn.removeAttribute('disabled');
            }
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
