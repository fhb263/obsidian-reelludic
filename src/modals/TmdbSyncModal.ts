// 「从 TMDB 同步账号清单」弹窗（#665）。
// DOM API 渲染，样式复用 `.rl-wshelf-*` / `.rl-douban-*`（⛔ 不另造一套视觉）。
//
// 🔴 用户口径：「做 TMDB 的同步接入（同先参考金标准）」—— 数据来源 = TMDB v3 账号接口
//    （watchlist / favorite × movie / tv，见 `pure/tmdbSync` 模块头）。
//
// 🔴 一键全量口径（#663 起）：**打开即读** 4 个组合，逐项报进度；列表按组合分组。
// 🔴 判重键 = `tmdb:{movie|tv}:{id}`（movie 与 tv 的 id 空间独立 —— 裸 id 会误合并）。
// 🔴 #664 口径：默认安全（未导入默认勾）+ 操作可达（已有的可勾 = 覆盖）+ 结果可见（覆盖单独报）。
// 🔴 TMDB 返回的是**社区分**（10 分制）⇒ 落库走 `communityScore`，⛔ 不写用户 rating（用户没打过分）。

import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import {
    TMDB_SYNC_COMBOS,
    tmdbComboLabel,
    tmdbItemKey,
    type TmdbAccountItem,
    type TmdbSyncList,
} from 'pure/tmdbSync';

/** 列表一行 */
export interface TmdbSyncRow extends TmdbAccountItem {
    /** 来自哪份清单（想看 / 收藏）—— 落库状态据此映射 */
    list: TmdbSyncList;
    imported: boolean;
}

export interface TmdbSyncModalOptions {
    credentials: () => { apiKey: string; sessionId: string };
    /** 库里已有的键（`tmdb:{movie|tv}:{id}`；与导入侧**同一份**判据） */
    existingKeys: () => Promise<Set<string>>;
    onFetch: (list: TmdbSyncList, mediaType: 'movie' | 'tv') => Promise<TmdbAccountItem[]>;
    onImport: (
        rows: TmdbSyncRow[],
        onProgress: (done: number, total: number, label: string) => void,
    ) => Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName?: number }>;
}

export class TmdbSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: TmdbSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        this.titleEl.setText('从 TMDB 同步想看清单与收藏');

        contentEl.createDiv({
            cls: 'rl-wshelf-hint',
            text:
                '读取你 TMDB 账号的想看清单（Watchlist）与收藏（Favorites）——电影和剧集都拉，勾选后导入本库。' +
                '只读 TMDB、不改动那边的内容；库里已有的默认不勾，勾上 = 覆盖（你自己的评语/进度/摘抄不会被动）。' +
                '需要先在「设置 › 元数据源配置 › 元数据搜索源凭据 › TMDB」里填 API Key 与 Session ID。',
        });

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取全部清单…' });
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

        let allRows: TmdbSyncRow[] = [];
        let boxes = new Map<string, HTMLInputElement>();

        const keyOf = (r: TmdbSyncRow): string => tmdbItemKey(r.mediaType, r.id);
        const picked = (): TmdbSyncRow[] => allRows.filter((r) => boxes.get(keyOf(r))?.checked);
        const pickedOverrides = (): TmdbSyncRow[] => picked().filter((r) => r.imported);

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
                const b = boxes.get(keyOf(r));
                if (b) b.checked = turnOn;
            }
            paint();
        });

        const paint = (): void => {
            list.empty();
            if (!allRows.length) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: '（没有读到条目）' });
                refresh();
                return;
            }
            for (const combo of TMDB_SYNC_COMBOS) {
                const group = allRows.filter((r) => r.list === combo.list && r.mediaType === combo.mediaType);
                if (!group.length) continue;
                list.createDiv({ cls: 'rl-douban-group', text: `${tmdbComboLabel(combo.list, combo.mediaType)}（${group.length} 条）` });
                for (const r of group) {
                    const k = keyOf(r);
                    const row = list.createDiv({ cls: 'rl-wshelf-row' + (r.imported ? ' is-done' : '') });
                    const box = row.createEl('input', { cls: 'rl-wshelf-box', attr: { type: 'checkbox' } });
                    box.checked = !r.imported;
                    const main = row.createDiv({ cls: 'rl-wshelf-main' });
                    main.createDiv({ cls: 'rl-wshelf-title', text: r.title });
                    const meta: string[] = [combo.mediaType === 'movie' ? '电影' : '剧集'];
                    if (r.releaseDate) meta.push(r.releaseDate.slice(0, 4));
                    if (r.voteAverage) meta.push(`TMDB ${r.voteAverage.toFixed(1)}`);
                    if (r.imported) meta.push('库里已有 · 勾选=覆盖');
                    main.createDiv({ cls: 'rl-wshelf-sub', text: meta.join(' · ') });
                    box.addEventListener('change', () => {
                        row.toggleClass('is-override', r.imported && box.checked);
                        refresh();
                    });
                    row.toggleClass('is-override', r.imported && box.checked);
                    boxes.set(k, box);
                }
            }
            refresh();
        };

        const readAll = (): void => {
            const { apiKey, sessionId } = this.opts.credentials();
            if (!apiKey.trim()) {
                status.setText('还没有配置 TMDB API Key —— 请先到「设置 › 元数据源配置 › 元数据搜索源凭据 › TMDB」填入。');
                return;
            }
            if (!sessionId.trim()) {
                status.setText('还没有配置 TMDB Session ID —— 到 themoviedb.org「设置 → API」生成后填入（同步个人清单需要它，搜索只用 API Key）。');
                return;
            }
            retryBtn.disabled = true;
            goBtn.disabled = true;
            status.setText('正在读取全部清单…');
            void (async () => {
                const found: TmdbSyncRow[] = [];
                const seen = new Set<string>();
                const failed: string[] = [];
                let existing = new Set<string>();
                try {
                    existing = await this.opts.existingKeys();
                } catch { /* 读不到就当空集 */ }
                for (let i = 0; i < TMDB_SYNC_COMBOS.length; i++) {
                    const combo = TMDB_SYNC_COMBOS[i];
                    status.setText(`正在读取 ${tmdbComboLabel(combo.list, combo.mediaType)}（${i + 1}/${TMDB_SYNC_COMBOS.length}）…`);
                    try {
                        const items = await this.opts.onFetch(combo.list, combo.mediaType);
                        for (const it of items) {
                            const k = tmdbItemKey(it.mediaType, it.id);
                            if (seen.has(k)) continue;
                            seen.add(k);
                            found.push({ ...it, list: combo.list, imported: existing.has(k) });
                        }
                    } catch (e) {
                        failed.push(`${tmdbComboLabel(combo.list, combo.mediaType)}：${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                allRows = found;
                boxes = new Map();
                bar.style.display = found.length ? 'flex' : 'none';
                paint();
                const head = found.length
                    ? `已读取 ${found.length} 条（` +
                      TMDB_SYNC_COMBOS.map((c) => `${tmdbComboLabel(c.list, c.mediaType)} ${found.filter((r) => r.list === c.list && r.mediaType === c.mediaType).length}`).join(' · ') +
                      '）。'
                    : '没有读到任何条目 —— 检查 Session ID 是否有效（想看清单/收藏是账号数据，API Key 不够）。';
                status.setText(head);
                note.setText(failed.length ? `有 ${failed.length} 项没读到：\n${failed.join('\n')}` : '');
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
