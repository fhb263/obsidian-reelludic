// 字幕选择弹窗（对齐 EpisodePickerModal 的轻量形态）：列出同目录候选字幕 → 选中即挂载；
// 另有「从文件选择…」（系统对话框挑任意 .srt/.vtt）与「关闭字幕」。
// open() 返回选择结果：{ kind: 'pick' } 表示已选同目录候选（带 fileName）；{ kind: 'browse' } 表示改走系统选择器；{ kind: 'off' } 关闭字幕；null = 取消。
import { App, Modal } from 'obsidian';
import type { SubtitleCandidate } from 'pure/subtitle';
import { subtitleLangLabel } from 'pure/subtitle';

export type SubtitlePickResult =
    | { kind: 'pick'; fileName: string }
    | { kind: 'browse' }
    | { kind: 'off' };

export class SubtitlePickerModal extends Modal {
    private resolve: ((r: SubtitlePickResult | null) => void) | null = null;

    constructor(
        app: App,
        private title: string,
        private candidates: SubtitleCandidate[],
        /** 当前已挂载的字幕文件名（同目录候选里高亮；外部文件挂载时为空） */
        private current: string | null,
    ) {
        super(app);
    }

    open(): Promise<SubtitlePickResult | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-desc rl-sub-title', text: `选择字幕：《${this.title}》` });

        if (this.candidates.length === 0) {
            contentEl.createDiv({ cls: 'rl-sub-empty', text: '同目录没有找到字幕文件（支持 .srt / .vtt）' });
        } else {
            const list = contentEl.createDiv({ cls: 'rl-sub-list' });
            this.candidates.forEach((c) => {
                const lang = subtitleLangLabel(c.lang);
                const active = this.current === c.fileName;
                const row = list.createEl('button', {
                    cls: active ? 'rl-sub-row is-on' : 'rl-sub-row',
                    attr: { 'data-tip': lang ? `${lang} · ${c.fileName}` : c.fileName },
                });
                row.createSpan({ cls: 'rl-sub-lang', text: lang || '字幕' });
                row.createSpan({ cls: 'rl-sub-file', text: c.fileName });
                row.addEventListener('click', () => this.finish({ kind: 'pick', fileName: c.fileName }));
            });
        }

        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const browse = ops.createEl('button', { cls: 'rl-btn', text: '从文件选择…' });
        browse.setAttribute('data-tip', '从任意位置挑一个 .srt / .vtt 文件');
        browse.addEventListener('click', () => this.finish({ kind: 'browse' }));
        const off = ops.createEl('button', { cls: 'rl-btn', text: '关闭字幕' });
        off.addEventListener('click', () => this.finish({ kind: 'off' }));
        const cancel = ops.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.addEventListener('click', () => this.finish(null));
    }

    onClose(): void {
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(r: SubtitlePickResult | null): void {
        this.resolve?.(r);
        this.resolve = null;
        this.close();
    }
}
