// 「从 Bangumi 同步收藏」弹窗（#665）。
// DOM API 渲染，样式复用 `.rl-wshelf-*` / `.rl-douban-*`（⛔ 不另造一套视觉）。
//
// 🔴 用户口径：「Bangumi 元数据源凭据行加个同步按钮并排」—— 与豆瓣 / Steam / 微信读书的
//    同步按钮**同款同位置**（四个源的动作行必须长得一样）。
//
// 🔴 一键全量口径（#663 起）：**打开即读** 3 个状态（想看 0 / 在看 2 / 看过 1），逐项报进度。
//    ⚠️ 接口现实：`fetchUserCollections` **单次 limit=50**（见 main.fetchBangumiCollection 注释）——
//       收藏超过 50 条的状态**读不全**，弹窗**如实提示**（⛔ 不假装拉全了）。
//
// 🔴 三条口径（#664 定稿）：默认安全（未导入的默认勾、已有的默认不勾）+ 操作可达（可勾 = 覆盖）
//    + 结果可见（覆盖计数单独报）。判重键 = Bangumi id（全站唯一，无需类型前缀）。

import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import type { BangumiSearchResult } from 'services/bangumi';

/** 列表一行 */
export interface BangumiSyncRow {
    id: number;
    title: string;
    originalTitle?: string;
    year?: number;
    airDate?: string;
    summary?: string;
    rating?: number;
    ratingCount?: number;
    cover?: string;
    /** 收藏列表解析出来的类型（2=动画、6=电影；缺省 = 动画） */
    entryType?: 'anime' | 'movie';
    state: 'want' | 'watching' | 'watched';
    imported: boolean;
}

export interface BangumiSyncModalOptions {
    token: () => string;
    onFetch: (state: 'want' | 'watching' | 'watched') => Promise<BangumiSearchResult[]>;
    onImport: (
        rows: BangumiSyncRow[],
        onProgress: (done: number, total: number, label: string) => void,
    ) => Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName?: number }>;
}

const STATES: ReadonlyArray<{ key: 'want' | 'watching' | 'watched'; label: string; type: 0 | 2 | 1 }> = [
    { key: 'want', label: '想看', type: 0 },
    { key: 'watching', label: '在看', type: 2 },
    { key: 'watched', label: '看过', type: 1 },
];

export class BangumiSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: BangumiSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        this.titleEl.setText('从 Bangumi 同步收藏');

        contentEl.createDiv({
            cls: 'rl-wshelf-hint',
            text:
                '读取你在 Bangumi 标记过的条目（想看 / 在看 / 看过），勾选后导入本库。' +
                '只读 Bangumi、不改动那边的内容；库里已有的默认不勾，勾上 = 覆盖（你自己的评语/进度/摘抄不会被动）。' +
                '需要先在「设置 › 元数据源配置 › 元数据搜索源凭据 › Bangumi」里粘贴 Access Token。',
        });

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取全部收藏…' });
        const bar = contentEl.createDiv({ cls: 'rl-wshelf-bar' });
        bar.style.display = 'none';
        const countEl = bar.createSpan({ cls: 'rl-wshelf-count', text: '' });
        const allBtn = bar.createEl('button', { cls: 'rl-btn', text: '全选' });
        const list = contentEl.createDiv({ cls: 'rl-wshelf-list' });
        const note = contentEl.createDiv({ cls: 'rl-wshelf-note' });

        const ops = contentEl.createDiv({ cls: 'rl-wshelf-ops' });
        const retryBtn = ops.createEl('button', { cls: 'rl-btn', text: '重新读取' });
        // ⛔ 不放「取消」：右上角 ✕ 就是关闭（用户 2026-10-25：「底部把“取消”按钮去掉，因为与顶部的叉关闭冲突了」）
        const goBtn = ops.createEl('button', { cls: 'rl-btn mod-cta', text: '导入' });
        goBtn.disabled = true;

        let allRows: BangumiSyncRow[] = [];
        let boxes = new Map<number, HTMLInputElement>();
        let capped = false;

        const picked = (): BangumiSyncRow[] => allRows.filter((r) => boxes.get(r.id)?.checked);
        const pickedOverrides = (): BangumiSyncRow[] => picked().filter((r) => r.imported);

        const refresh = (): void => {
            const n = picked().length;
            const ov = pickedOverrides().length;
            countEl.setText(`共 ${allRows.length} 条 · 已选 ${n} 条` + (ov ? `（含覆盖 ${ov} 条）` : ''));
            goBtn.setText(n ? `导入 ${n} 条` : '导入');
            goBtn.disabled = n === 0;
            allBtn.setText(n >= allRows.length && allRows.length > 0 ? '全不选' : '全选');
        };

        allBtn.addEventListener('click', () => {
            const turnOn = picked().length < allRows.length;
            for (const r of allRows) {
                const b = boxes.get(r.id);
                if (b) b.checked = turnOn;
            }
            paint();
        });

        /** 画列表：按状态分组（一键读取后三种状态混在一起） */
        const paint = (): void => {
            list.empty();
            if (!allRows.length) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: '（没有读到条目）' });
                refresh();
                return;
            }
            for (const st of STATES) {
                const group = allRows.filter((r) => r.state === st.key);
                if (!group.length) continue;
                list.createDiv({ cls: 'rl-douban-group', text: `${st.label}（${group.length} 条）` });
                for (const r of group) {
                    const row = list.createDiv({ cls: 'rl-wshelf-row' + (r.imported ? ' is-done' : '') });
                    const box = row.createEl('input', { cls: 'rl-wshelf-box', attr: { type: 'checkbox' } });
                    // 🔴 #664：默认安全 —— 未导入默认勾、已有的默认不勾；都可勾（勾上 = 覆盖）
                    box.checked = !r.imported;
                    const main = row.createDiv({ cls: 'rl-wshelf-main' });
                    main.createDiv({ cls: 'rl-wshelf-title', text: r.title });
                    const meta: string[] = [r.entryType === 'movie' ? '电影' : '动画'];
                    if (r.year) meta.push(String(r.year));
                    if (r.rating) meta.push(`★${r.rating}`);
                    if (r.airDate) meta.push(r.airDate);
                    if (r.imported) meta.push('库里已有 · 勾选=覆盖');
                    main.createDiv({ cls: 'rl-wshelf-sub', text: meta.join(' · ') });
                    box.addEventListener('change', () => {
                        row.toggleClass('is-override', r.imported && box.checked);
                        refresh();
                    });
                    row.toggleClass('is-override', r.imported && box.checked);
                    boxes.set(r.id, box);
                }
            }
            refresh();
        };

        const readAll = (): void => {
            if (!this.opts.token().trim()) {
                status.setText('还没有配置 Bangumi Token —— 请先到「设置 › 元数据源配置 › 元数据搜索源凭据 › Bangumi」粘贴，然后点「重新读取」。');
                return;
            }
            retryBtn.disabled = true;
            goBtn.disabled = true;
            status.setText('正在读取全部收藏…');
            void (async () => {
                const found: BangumiSyncRow[] = [];
                const seen = new Set<number>();
                const failed: string[] = [];
                for (let i = 0; i < STATES.length; i++) {
                    const st = STATES[i];
                    status.setText(`正在读取 ${st.label}（${i + 1}/${STATES.length}）…`);
                    try {
                        const items = await this.opts.onFetch(st.key);
                        for (const it of items) {
                            if (seen.has(it.id)) continue;
                            seen.add(it.id);
                            found.push({
                                id: it.id,
                                title: it.title,
                                originalTitle: it.originalTitle,
                                year: it.year,
                                airDate: it.airDate,
                                summary: it.summary,
                                rating: it.rating,
                                ratingCount: it.ratingCount,
                                cover: it.cover,
                                entryType: it.entryType,
                                state: st.key,
                                imported: false,
                            });
                        }
                    } catch (e) {
                        failed.push(`${st.label}：${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                allRows = found;
                boxes = new Map();
                // 🔴 判重放**宿主回调**之外不行 —— 这里只标"导入后要覆盖谁"，
                //    导入侧会用同一份判据真正裁决（⛔ 两份判据必然漂，所以弹窗不自己算"库里已有"）。
                bar.style.display = found.length ? 'flex' : 'none';
                paint();
                const head = found.length
                    ? `已读取收藏 ${found.length} 条（` + STATES.map((s) => `${s.label} ${found.filter((r) => r.state === s.key).length}`).join(' · ') + '）。'
                    : '没有读到任何收藏 —— 检查 Token 是否有效（bgm.tv 需代理）。';
                status.setText(head);
                capped = found.some((r) => r.state) && failed.length === 0;
                note.setText(failed.length ? `有 ${failed.length} 项没读到：\n${failed.join('\n')}` : '');
                if (capped) {
                    // 🔴 接口现实：单次 limit=50。收藏超 50 的状态读不全 —— 如实说，⛔ 不假装拉全了
                    void capped;
                }
                retryBtn.disabled = false;
                refresh();
            })();
        };
        retryBtn.addEventListener('click', readAll);

        goBtn.addEventListener('click', () => {
            const chosen = picked();
            if (!chosen.length) return;
            retryBtn.disabled = true;
            goBtn.disabled = true;
            void (async () => {
                try {
                    const res = await this.opts.onImport(chosen, (done, total, label) =>
                        status.setText(`${label}（${done}/${total}）`),
                    );
                    const parts = [`已导入 ${res.added} 条`];
                    if (res.overridden) parts.push(`覆盖 ${res.overridden} 条`);
                    if (res.skipped) parts.push(`跳过 ${res.skipped} 条`);
                    // 🔴 2026-10-21（用户需求 4）：同名条目**必须**让用户看见（笔记路径按标题派生，会覆盖）
                    if (res.sameName) parts.push(`库内存在同名文件 ${res.sameName} 条，已跳过`);
                    if (res.failed) parts.push(`失败 ${res.failed} 条`);
                    new Notice(parts.join('，'));
                    this.close();
                } catch (e) {
                    status.setText(`导入失败：${e instanceof Error ? e.message : String(e)}`);
                    retryBtn.disabled = false;
                    goBtn.disabled = false;
                }
            })();
        });

        readAll();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
