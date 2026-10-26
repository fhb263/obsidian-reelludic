// 封面迁移「勾选清单」弹窗（2026-10-25 用户指令）：
//   「设置页的下载封面功能项点击"一键迁移"先弹窗列出当前可以迁移的封面条目出来然后用户勾选再迁移，默认全选」
//
// 🔴 两条硬口径：
//   ⑴ **默认全选**（用户明说）。旧行为是「点一下就全量跑」，所以全选 = 保持旧默认结果不变，
//      用户想少迁才动手取消勾选 —— ⛔ 别默认不勾，那会让原本一键完成的动作变成两步。
//   ⑵ 列表只由调用方给的候选集渲染；弹窗**自己不扫库**（扫描口径归 `main`，两处各写一份必然分叉）。
import { App, Modal, Notice } from 'obsidian';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';

/** 一条可迁移的封面（`poster` 是网络地址；本地化的目标由 main 决定，弹窗不猜） */
export interface PosterMigrateCandidate {
    id: string;
    title: string;
    /** 网络封面地址（原样展示，悬停看全文） */
    poster: string;
}

export class PosterMigratePickModal extends Modal {
    private boxes: { cand: PosterMigrateCandidate; box: HTMLInputElement }[] = [];
    private goBtn: HTMLButtonElement | null = null;
    private countEl: HTMLElement | null = null;

    constructor(
        app: App,
        private candidates: PosterMigrateCandidate[],
        /** 用户点「开始迁移」后回调勾选的 id 列表；弹窗只负责收集，不负责跑迁移 */
        private onConfirm: (ids: string[]) => void,
    ) {
        super(app);
    }

    private picked(): string[] {
        return this.boxes.filter((b) => b.box.checked).map((b) => b.cand.id);
    }

    private refresh(): void {
        const n = this.picked().length;
        if (this.countEl) this.countEl.setText(`共 ${this.candidates.length} 条 · 已选 ${n} 条`);
        if (this.goBtn) {
            this.goBtn.setText(n ? `迁移 ${n} 条` : '迁移');
            this.goBtn.disabled = n === 0;
        }
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();

        if (this.candidates.length === 0) {
            // 空态：只一行字，⚠️ 放在 markScrollInside 之前（与 AssetCleanupModal 同一条理由）
            contentEl.createEl('h2', { text: '下载封面' });
            contentEl.createDiv({ cls: 'rl-pc-empty', text: '没有待迁移的封面（当前没有使用网络封面的条目）' });
            return;
        }
        markScrollInside(this.modalEl);
        contentEl.createEl('h2', { text: '下载封面' });
        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: `发现 ${this.candidates.length} 个条目仍在使用网络封面，勾选后下载到本地（默认全选）：`,
        });

        const list = contentEl.createDiv({ cls: 'rl-pc-list' });
        for (const c of this.candidates) {
            const row = list.createDiv({ cls: 'rl-pc-row' });
            const box = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            box.checked = true; // 🔴 默认全选（用户明说）
            box.addEventListener('change', () => this.refresh());
            row.createSpan({ cls: 'rl-pc-kind', text: '封面' });
            row.createSpan({ cls: 'rl-pc-name', text: c.title, attr: { 'data-tip': c.poster } });
            this.boxes.push({ cand: c, box });
        }

        const bar = contentEl.createDiv({ cls: 'rl-pc-hint' });
        this.countEl = bar.createSpan({ cls: 'rl-pc-hint-inline', text: '' });
        const allBtn = bar.createEl('button', { cls: 'rl-btn', text: '全不选' });
        allBtn.addEventListener('click', () => {
            // 全选 / 全不选 二态切换：当前已全选就清空，否则全勾上
            const turnOn = this.picked().length < this.candidates.length;
            for (const b of this.boxes) b.box.checked = turnOn;
            allBtn.setText(turnOn ? '全不选' : '全选');
            this.refresh();
        });

        contentEl.createDiv({
            cls: 'rl-pc-hint',
            text: '迁移过程中随时可点右上角 ✕ 关闭窗口，已下载的封面不会回滚。',
        });

        // ⛔ 底部不放「取消」：右上角 ✕ 就是退出（与另外几个弹窗同一口径）
        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const goBtn = foot.createEl('button', { cls: 'mod-cta', text: '迁移' });
        this.goBtn = goBtn;
        goBtn.onclick = () => {
            const ids = this.picked();
            if (ids.length === 0) {
                new Notice('未选择任何条目');
                return;
            }
            this.close();
            this.onConfirm(ids);
        };
        this.refresh();
    }

    onClose(): void {
        this.boxes = [];
        this.goBtn = null;
        this.countEl = null;
        this.contentEl.empty();
    }
}
