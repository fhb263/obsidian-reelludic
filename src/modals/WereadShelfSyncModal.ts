// 「从微信读书同步书架」弹窗（#581）。**DOM API 渲染，样式写入 styles.css**（`rl-wshelf-*`）——
// 与 `ImportBangumiModal` / `SourceSubscribeModal` 同款（本仓既定：轻量一次性弹窗不必上 Svelte 组件）。
//
// 🔴 三条口径，全部来自用户 2026-10-09 的裁定：
//   ⑴ **列表勾选导入，默认勾「库里没有的」**；库里已有的**禁用 + 标原因**（「库里已有」）——
//      ⛔ 不做「默认不勾但可勾」：那样用户勾了却什么都不发生，比禁用更让人困惑。
//   ⑵ 库里已有的**一律跳过、不动它**（不覆盖评语 / 评分 / 进度）—— 与 `main.importWereadShelf` 同一口径。
//   ⑶ 专辑（有声书）与文章收藏**不导入**，但**必须写一句说明**（本仓「不静默丢」的口径，见 `shelfExtraNote`）。
//
// 🔴 打开即**自动读取**（用户点「同步」的心智就是「拉给我看」），⛔ 不再要求他先点一次「读取」。
// 🔴 读取失败 → 把 `message` **原样显示**（哪一步失败、要不要重填 Cookie，都在那句话里）。

import { Modal, Notice, type App } from 'obsidian';
import type { WereadShelfBook } from 'pure/wereadShelf';
import { shelfLastReadLabel } from 'pure/wereadShelf';

/** 列表一行（`imported` = 库里已有同名书，由宿主用 `partitionShelfBooks` 预先算好） */
export interface WereadShelfRow extends WereadShelfBook {
    imported: boolean;
}

export interface WereadShelfSnapshot {
    rows: WereadShelfRow[];
    /** 额外条目（专辑等非电子书）的说明（`null` = 无需说明） */
    note: string | null;
}

export type WereadShelfFetchOutcome =
    | { ok: true; snapshot: WereadShelfSnapshot }
    | { ok: false; message: string };

export interface WereadShelfSyncModalOptions {
    /** 读书架（宿主负责桌面守卫 + Cookie；失败给**可读文案**，不要抛） */
    onFetch: () => Promise<WereadShelfFetchOutcome>;
    /** 用户点「导入 N 本」后落库（宿主内按书名去重） */
    onImport: (
        books: WereadShelfBook[],
        onProgress: (done: number, total: number, label: string) => void,
    ) => Promise<{ added: number; skipped: number }>;
}

interface RowRef {
    book: WereadShelfRow;
    box: HTMLInputElement;
}

export class WereadShelfSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: WereadShelfSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        this.titleEl.setText('从微信读书同步书架');

        contentEl.createDiv({
            cls: 'rl-wshelf-hint',
            text:
                '读取你微信读书书架里的电子书，勾选后导入本库（只读微信读书，不会改动那边的内容）。' +
                '库里已有同名的书会跳过、不会被覆盖。需要先在「设置 › 元数据源配置 › 元数据源凭据 › 微信读书」里粘贴 Cookie。',
        });

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取书架…' });
        const bar = contentEl.createDiv({ cls: 'rl-wshelf-bar' });
        bar.style.display = 'none';
        const countEl = bar.createSpan({ cls: 'rl-wshelf-count', text: '' });
        const allBtn = bar.createEl('button', { cls: 'rl-btn', text: '全选' });        const list = contentEl.createDiv({ cls: 'rl-wshelf-list' });
        const note = contentEl.createDiv({ cls: 'rl-wshelf-note' });

        const ops = contentEl.createDiv({ cls: 'rl-wshelf-ops' });
        const cancelBtn = ops.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());
        const goBtn = ops.createEl('button', { cls: 'rl-btn mod-cta', text: '导入' });
        goBtn.disabled = true;

        let rows: RowRef[] = [];

        /** 只统计**可导入**（未导入且被勾）的行 —— 禁用的行即使被程序勾上也不算 */
        const picked = (): WereadShelfRow[] => rows.filter((r) => r.box.checked && !r.book.imported).map((r) => r.book);
        const refresh = (): void => {
            const importable = rows.filter((r) => !r.book.imported).length;
            const n = picked().length;
            countEl.setText(`书架 ${rows.length} 本 · 可导入 ${importable} 本 · 已选 ${n} 本`);
            goBtn.setText(n ? `导入 ${n} 本` : '导入');
            goBtn.disabled = n === 0;
            allBtn.setText(n >= importable && importable > 0 ? '全不选' : '全选');
        };

        allBtn.addEventListener('click', () => {
            const importable = rows.filter((r) => !r.book.imported);
            const turnOn = picked().length < importable.length;
            for (const r of importable) r.box.checked = turnOn;
            refresh();
        });

        goBtn.addEventListener('click', () => {
            const books = picked();
            if (!books.length) return;
            void (async () => {
                setBusy(true);
                status.setText('正在导入…');
                try {
                    const res = await this.opts.onImport(books, (done, total, label) =>
                        status.setText(`${label}（${done}/${total}）`),
                    );
                    new Notice(`已导入 ${res.added} 本微信读书书架书籍${res.skipped ? `，跳过 ${res.skipped} 本` : ''}`);
                    this.close();
                } catch (e) {
                    status.setText(`导入失败：${e instanceof Error ? e.message : String(e)}`);
                    setBusy(false);
                }
            })();
        });

        /** 导入中：整条列表锁住（⛔ 别让用户在落库途中再改勾选） */
        const setBusy = (busy: boolean): void => {
            goBtn.disabled = busy;
            cancelBtn.disabled = busy;
            allBtn.disabled = busy;
            for (const r of rows) r.box.disabled = busy || r.book.imported;
            if (!busy) refresh();
        };

        void (async () => {
            let out: WereadShelfFetchOutcome;
            try {
                out = await this.opts.onFetch();
            } catch (e) {
                status.setText(`读取失败：${e instanceof Error ? e.message : String(e)}`);
                return;
            }
            if (!out.ok) {
                status.setText(out.message);
                return;
            }
            const { rows: data, note: extra } = out.snapshot;
            if (!data.length) {
                status.setText('微信读书书架里没有可导入的电子书。');
                return;
            }
            const importable = data.filter((r) => !r.imported).length;
            status.setText(
                importable
                    ? `读到 ${data.length} 本，其中 ${importable} 本还没进库。`
                    : `读到 ${data.length} 本，全都已在库里。`,
            );
            bar.style.display = '';
            if (extra) note.setText(extra);
            rows = data.map((book) => ({ book, box: this.renderRow(list, book, refresh) }));
            refresh();
        })();
    }

    /**
     * 一行：`<label>` 包住 checkbox + 封面 + 书名/副行 + 徽标 —— 点哪都能勾（⛔ 不给「只能点小方块」的手感）。
     * 库里已有的行：勾选框 **disabled + 不勾**，并挂一枚「库里已有」标（原因写在用户看得见的地方）。
     */
    private renderRow(list: HTMLDivElement, book: WereadShelfRow, onChange: () => void): HTMLInputElement {
        const row = list.createEl('label', { cls: 'rl-wshelf-row' });
        if (book.imported) row.addClass('is-dup');
        const box = row.createEl('input', { cls: 'checkbox', attr: { type: 'checkbox' } });
        box.checked = !book.imported;
        box.disabled = book.imported;
        box.addEventListener('change', onChange);

        if (book.coverUrl) {
            row.createEl('img', {
                cls: 'rl-wshelf-cv',
                attr: { src: book.coverUrl, loading: 'lazy', decoding: 'async', alt: '' },
            });
        } else {
            row.createSpan({ cls: 'rl-wshelf-cv is-ph' });
        }

        const main = row.createDiv({ cls: 'rl-wshelf-main' });
        main.createDiv({ cls: 'rl-wshelf-t', text: book.title });
        const bits: string[] = [];
        if (book.author) bits.push(book.author);
        if (book.archives && book.archives.length) bits.push(book.archives.join(' / '));
        const last = shelfLastReadLabel(book);
        if (last) bits.push(`最近阅读 ${last}`);
        main.createDiv({ cls: 'rl-wshelf-sub', text: bits.join(' · ') });

        row.createSpan({ cls: 'rl-wshelf-tag', text: book.finished ? '已读完' : '在读' });
        if (book.imported) row.createSpan({ cls: 'rl-wshelf-dup', text: '库里已有' });
        return box;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
