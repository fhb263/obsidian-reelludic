// 「从 Steam 同步游戏库与愿望单」弹窗（2026-10-25，用户报障后补）。
//
// 🔴 用户原话（2026-10-25）：
//   「所有类型账号同步是要先列出弹窗列出游戏让我勾选才同步（库内已有要提示覆盖）
//     还有拉取到的steam游戏怎么连封面和任何信息都没有啊只拉了个标题」
//   ⇒ 本弹窗解决两件事：⑴ **先列出来、勾选后才落库**（原来是点一下按钮直接全量写盘，用户没有否决权）；
//     ⑵ 库内已有的行**如实标「库里已有 · 勾选=覆盖」**（勾上才覆盖，默认不勾）。
//
// 🔴 口径与既有四个同步弹窗（豆瓣 / Bangumi / TMDB / 微信读书）**完全同构** —— 本仓既定：
//    同一个「账号同步」交互不许出现第二套视觉与第二套勾选语义。
//    · 打开即读（用户点「立即同步」的心智就是「拉给我看」），⛔ 不要求他再点一次「读取」；
//    · 默认勾「库里没有的」；库里已有的默认不勾、**可勾**=覆盖；
//    · 底部⛔ 不放「取消」（右上角 ✕ 就是关闭，用户 2026-10-25 已就同类弹窗裁定过）；
//    · 落库结果给 Notice 回执，含「覆盖 N 条 / 跳过 N 条」。
//
// ⚠️ 渲染全走 DOM API、样式复用 `.rl-wshelf-*`（⛔ 不另造 CSS）—— 与 `TmdbSyncModal` 同款。
//
// 🔴🔴 行**只建一次**（`buildRows`），勾选状态存在 `RowRef.checked` 里：
//    上一版把建行写在 `paint()` 里、每次全选/勾选都重画 ⇒ 重建会按「库里已有就不勾」的默认值复位，
//    用户勾上的项被自己抹掉（真机点两下就会发现）。⛔ 别把建行逻辑放回 paint。

import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import { steamHintSections } from 'pure/syncHint';
import { renderSyncHint } from 'modals/syncHintView';
import { minutesToHours, type SteamSyncCandidate } from 'pure/steamSync';
import { steamCoverUrl } from 'pure/steamCover';

/** 列表一行 = 一条候选 + 库内是否已有 */
export interface SteamSyncRow extends SteamSyncCandidate {
    /** 库里已有（按 `steam:{appid}` 判）—— 默认不勾，勾上=覆盖 */
    imported: boolean;
}

export interface SteamSyncFetchOutcome {
    rows: SteamSyncRow[];
    /** 顶部结论（拉到了几库几条、哪半没拉到 —— 由宿主用 `syncFetchHeadline` 生成） */
    headline: string;
    /** 额外说明（愿望单里有条目但取不到名字等；`null` = 无需说明） */
    note: string | null;
}

export type SteamSyncFetchResult =
    | { ok: true; snapshot: SteamSyncFetchOutcome }
    | { ok: false; message: string };

export interface SteamSyncModalOptions {
    /** 读库 + 愿望单（宿主负责凭据判定与失败文案；⛔ 不要抛） */
    onFetch: () => Promise<SteamSyncFetchResult>;
    /** 用户点「导入 N 条」后落库（宿主按 appid 判重；`overridden` = 覆盖了几条库内已有的） */
    onImport: (
        rows: SteamSyncRow[],
        onProgress: (done: number, total: number, label: string) => void,
    ) => Promise<{ added: number; skipped: number; overridden: number; failed: number; sameName?: number }>;
}

/** 一行的全部可变状态（⛔ 不把状态放 DOM：重画会丢） */
interface RowRef {
    row: SteamSyncRow;
    checked: boolean;
    box: HTMLInputElement;
    rowEl: HTMLDivElement;
}

export class SteamSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: SteamSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        this.titleEl.setText('从 Steam 同步游戏库与愿望单');

        // 🔴 2026-11-11 用户 m05717 ②：三段式（同步数据 / 冲突处理 / 前置条件），标签加粗 + 全角冒号
        renderSyncHint(contentEl.createDiv({ cls: 'rl-wshelf-hint' }), steamHintSections());

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取游戏库与愿望单…' });
        const bar = contentEl.createDiv({ cls: 'rl-wshelf-bar' });
        bar.style.display = 'none';
        const countEl = bar.createSpan({ cls: 'rl-wshelf-count', text: '' });
        const allBtn = bar.createEl('button', { cls: 'rl-btn', text: '全选' });
        const list = contentEl.createDiv({ cls: 'rl-wshelf-list' });
        const note = contentEl.createDiv({ cls: 'rl-wshelf-note' });

        const ops = contentEl.createDiv({ cls: 'rl-wshelf-ops' });
        const retryBtn = ops.createEl('button', { cls: 'rl-btn', text: '重新读取' });
        // ⛔ 不放「取消」：右上角 ✕ 就是关闭（与另外四个同步弹窗同一口径）
        const goBtn = ops.createEl('button', { cls: 'rl-btn mod-cta', text: '导入' });
        goBtn.disabled = true;

        let refs: RowRef[] = [];

        const picked = (): SteamSyncRow[] => refs.filter((r) => r.checked).map((r) => r.row);
        const pickedOverrides = (): SteamSyncRow[] => picked().filter((r) => r.imported);

        /** 只刷数字与按钮态（⛔ 不重建行） */
        const refresh = (): void => {
            const n = picked().length;
            const ov = pickedOverrides().length;
            countEl.setText(`共 ${refs.length} 条 · 已选 ${n} 条` + (ov ? `（含覆盖 ${ov} 条）` : ''));
            goBtn.setText(n ? `导入 ${n} 条` : '导入');
            goBtn.disabled = n === 0;
            allBtn.setText(n >= refs.length && refs.length > 0 ? '全不选' : '全选');
        };

        allBtn.addEventListener('click', () => {
            const turnOn = picked().length < refs.length;
            for (const r of refs) {
                r.checked = turnOn;
                r.box.checked = turnOn;
                r.rowEl.toggleClass('is-override', r.row.imported && turnOn);
            }
            refresh();
        });

        /** 建行（**只调用一次**，见文件头 🔴🔴） */
        const buildRows = (rows: SteamSyncRow[]): void => {
            list.empty();
            refs = [];
            if (!rows.length) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: '（没有读到条目）' });
                refresh();
                return;
            }
            // 分组：先库、后愿望单（库里的是「已拥有」，语义上排前面）
            const groups: { label: string; rows: SteamSyncRow[] }[] = [
                { label: '游戏库（已拥有）', rows: rows.filter((r) => r.source === 'owned') },
                { label: '愿望单（想玩）', rows: rows.filter((r) => r.source === 'wishlist') },
            ];
            for (const g of groups) {
                if (!g.rows.length) continue;
                list.createDiv({ cls: 'rl-douban-group', text: `${g.label}（${g.rows.length} 条）` });
                for (const r of g.rows) {
                    const rowEl = list.createDiv({ cls: 'rl-wshelf-row' + (r.imported ? ' is-done is-dup' : '') });
                    const box = rowEl.createEl('input', { cls: 'rl-wshelf-box', attr: { type: 'checkbox' } });
                    box.checked = !r.imported; // 默认勾「库里没有的」
                    // 封面：竖版（与落库那张同源）—— ⛔ 不用 32×32 的 img_icon_url
                    rowEl.createEl('img', {
                        cls: 'rl-wshelf-cv',
                        attr: {
                            src: steamCoverUrl(r.appid),
                            loading: 'lazy',
                            decoding: 'async',
                            alt: '',
                        },
                    });
                    const main = rowEl.createDiv({ cls: 'rl-wshelf-main' });
                    main.createDiv({ cls: 'rl-wshelf-t', text: r.name });
                    const bits: string[] = [r.source === 'owned' ? '已拥有' : '愿望单'];
                    if (r.playtimeForever > 0) bits.push(`已玩 ${minutesToHours(r.playtimeForever)}h`);
                    bits.push(`appid ${r.appid}`);
                    if (r.imported) bits.push('库里已有 · 勾选=覆盖');
                    main.createDiv({ cls: 'rl-wshelf-sub', text: bits.join(' · ') });
                    if (r.imported) rowEl.createSpan({ cls: 'rl-wshelf-dup', text: '库里已有' });
                    const ref: RowRef = { row: r, checked: !r.imported, box, rowEl };
                    box.addEventListener('change', () => {
                        ref.checked = box.checked;
                        rowEl.toggleClass('is-override', r.imported && box.checked);
                        refresh();
                    });
                    refs.push(ref);
                }
            }
            refresh();
        };

        const setBusy = (busy: boolean): void => {
            retryBtn.disabled = busy;
            goBtn.disabled = busy || picked().length === 0;
            allBtn.disabled = busy;
            for (const r of refs) r.box.disabled = busy;
            if (!busy) refresh();
        };

        const readAll = (): void => {
            setBusy(true);
            status.setText('正在读取游戏库与愿望单…');
            note.setText('');
            void (async () => {
                let out: SteamSyncFetchResult;
                try {
                    out = await this.opts.onFetch();
                } catch (e) {
                    status.setText(`读取失败：${e instanceof Error ? e.message : String(e)}`);
                    setBusy(false);
                    return;
                }
                if (!out.ok) {
                    status.setText(out.message);
                    setBusy(false);
                    return;
                }
                const { rows, headline, note: extra } = out.snapshot;
                bar.style.display = rows.length ? 'flex' : 'none';
                status.setText(headline);
                note.setText(extra ?? '');
                buildRows(rows);
                setBusy(false);
            })();
        };
        retryBtn.addEventListener('click', readAll);

        goBtn.addEventListener('click', () => {
            const chosen = picked();
            if (!chosen.length) return;
            setBusy(true);
            status.setText('正在导入…');
            void (async () => {
                try {
                    const res = await this.opts.onImport(chosen, (done, total, label) =>
                        status.setText(`${label}（${done}/${total}）`),
                    );
                    const parts = [`已导入 ${res.added} 条 Steam 游戏`];
                    if (res.overridden) parts.push(`覆盖 ${res.overridden} 条`);
                    if (res.skipped) parts.push(`跳过 ${res.skipped} 条`);
                    // 🔴 同名条目必须让用户看见（笔记路径按标题派生，会覆盖）
                    if (res.sameName) parts.push(`库内存在同名文件 ${res.sameName} 条，已跳过`);
                    if (res.failed) parts.push(`失败 ${res.failed} 条`);
                    new Notice(parts.join('，'));
                    this.close();
                } catch (e) {
                    status.setText(`导入失败：${e instanceof Error ? e.message : String(e)}`);
                    setBusy(false);
                }
            })();
        });

        readAll();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
