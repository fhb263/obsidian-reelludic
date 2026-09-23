// 本地剧集集数选择弹窗（海报墙「观看」按钮 → 影视条目二次列出 1..N 集；电影多资源时按「文件 N」措辞）
// 每集按钮只显示集数数字，「第 N 集 + 集标题」悬停提示（如悬停显示「第 1 集 开始」）；点击返回集下标，播放逻辑由调用方按本地优先处理
// DOM API 渲染，风格复用 ConfirmModal/LinkPickerModal；open() 返回选中的集下标（0-based），取消/关闭返回 null
import { App, Modal } from 'obsidian';

export class EpisodePickerModal extends Modal {
    private resolve: ((idx: number | null) => void) | null = null;

    constructor(
        app: App,
        private entryTitle: string,
        private episodeFiles: (string | undefined)[],
        private episodeUrls: (string | undefined)[],
        private episodeTitles: (string | undefined)[],
        /** 电影（无「集」概念，多资源 = 多个文件）：标题与提示改用「文件 N」措辞 */
        private single = false,
    ) {
        super(app);
    }

    open(): Promise<number | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-desc rl-eps-title', text: this.single ? `选择要播放的文件：《${this.entryTitle}》` : `选择集数：《${this.entryTitle}》` });
        const grid = contentEl.createDiv({ cls: 'rl-eps-grid' });
        this.episodeFiles.forEach((path, i) => {
            const url = this.episodeUrls[i];
            const title = this.episodeTitles[i];
            const linked = !!path || !!url;
            // 按钮文字 = 序号；悬停提示 = 「第 N 集 集标题」（电影态 = 「文件 N 标题」）
            const label = this.single ? `文件 ${i + 1}${title ? ` ${title}` : ''}` : `第 ${i + 1} 集${title ? ` ${title}` : ''}`;
            const hint = linked
                ? [label, path ? `本地：${path}` : '', url ? `网络：${url}` : ''].filter(Boolean).join('\n')
                : `${label}（未关联，可在编辑表单中添加）`;
            const btn = grid.createEl('button', {
                cls: linked ? 'rl-eps-btn linked' : 'rl-eps-btn',
                text: String(i + 1),
                attr: linked ? { title: hint } : { title: hint, disabled: 'true' },
            });
            if (linked) btn.onclick = () => this.finish(i);
        });
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const cancel = ops.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.onclick = () => this.finish(null);
    }

    onClose(): void {
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(idx: number | null): void {
        this.resolve?.(idx);
        this.resolve = null;
        this.close();
    }
}

