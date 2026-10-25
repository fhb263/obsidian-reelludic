// 「从豆瓣同步收藏」弹窗（#662 / #663）。
// DOM API 渲染，样式复用 `.rl-wshelf-*` + `.rl-douban-*`（⛔ 不另造一套视觉）。
//
// 🔴 用户口径：「豆瓣凭据入口再添加个同步导入按钮」→「导入曾标记想读在读等的条目」
//   →「不能一键读取所有导入吗。还要我选」。
//
// 🔴🔴 #663 **一键全部**才是主路径：
//   豆瓣没有「一次返回全部收藏」的接口（四类分属四个子域、每类三种状态）⇒ 全量 = **12 次请求**。
//   上一版让用户先选类型 + 状态再点读取（要选 2 次、还要自己记住拉了哪些）—— 被用户点名否掉。
//   ⇒ 现在：**打开即自动读取全部**（12 个组合依次拉，逐项报进度），列表按类型分组。
//     类型 / 状态筛选退化成**列表上方的过滤条**（可选、不挡路），⛔ 不再作为「读取」的前置步骤。
//
// 🔴 三条口径（与微信读书 / Bangumi 两个导入**完全一致**）：
//   ⑴ 列表勾选导入，默认勾「库里没有的」；已有的**禁用 + 标原因**；
//   ⑵ 已有的**跳过、不动它**（不覆盖评语 / 评分 / 进度）；
//   ⑶ 打开即自动读取。

import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import {
    DOUBAN_ALL_KINDS,
    DOUBAN_ALL_STATES,
    DOUBAN_KIND_LABELS,
    doubanItemKey,
    doubanStateLabel,
    doubanSyncJobs,
    type DoubanCollectionItem,
    type DoubanCollectionState,
    type DoubanSyncKind,
} from 'pure/doubanSync';

/** 列表一行：带上类型与状态（一键读取时四类混在一起，必须知道每条是哪类的） */
export interface DoubanSyncRow extends DoubanCollectionItem {
    kind: DoubanSyncKind;
    state: DoubanCollectionState;
    /** 库里已有同类型同 id 条目 */
    imported: boolean;
}

export interface DoubanSyncModalOptions {
    /** 当前 Cookie（用于判断"能不能读"） */
    cookie: () => string;
    /** 库里已有的豆瓣键集合（`kind:id`；与导入侧**同一份**判据） */
    existingKeys: () => Promise<Set<string>>;
    /** 拉某一类某一状态的全部条目（宿主内翻页 + 反爬） */
    onFetch: (kind: DoubanSyncKind, state: DoubanCollectionState) => Promise<DoubanCollectionItem[]>;
    /** 落库（宿主内按 `kind:id` 判重）；返回新增 / 跳过 / 失败 */
    onImport: (
        rows: DoubanSyncRow[],
        onProgress: (done: number, total: number, label: string) => void,
    ) => Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName?: number }>;
}

export class DoubanSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: DoubanSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        this.titleEl.setText('从豆瓣同步收藏');

        contentEl.createDiv({
            cls: 'rl-wshelf-hint',
            text:
                '读取你在豆瓣标记过的全部条目（想看 / 在看 / 看过、想读 / 在读 / 读过、想听、想玩 …），勾选后导入本库。' +
                '只读豆瓣、不改动那边的内容；库里已有的会跳过、不会被覆盖。' +
                '需要先在「设置 › 元数据源配置 › 元数据搜索源凭据 › 豆瓣」里粘贴登录态 Cookie。',
        });

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取全部收藏…' });

        // ── 过滤条（可选；⛔ 不是读取的前置步骤）──────────────────────────────
        const filterBar = contentEl.createDiv({ cls: 'rl-douban-picker' });
        filterBar.style.display = 'none';
        const kindSeg = filterBar.createDiv({ cls: 'rl-douban-seg', attr: { role: 'group', 'aria-label': '按类型过滤' } });
        kindSeg.createSpan({ cls: 'rl-douban-seglabel', text: '类型' });
        const stateSeg = filterBar.createDiv({ cls: 'rl-douban-seg', attr: { role: 'group', 'aria-label': '按状态过滤' } });
        stateSeg.createSpan({ cls: 'rl-douban-seglabel', text: '状态' });

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

        /** 过滤态（`null` = 全部） */
        let filterKind: DoubanSyncKind | null = null;
        let filterState: DoubanCollectionState | null = null;

        /** 全部行（分类型分状态拉回来的） */
        let allRows: DoubanSyncRow[] = [];
        /** 每个键对应的复选框引用 */
        let boxes = new Map<string, { row: DoubanSyncRow; box: HTMLInputElement }>();

        const keyOf = (r: DoubanSyncRow): string => doubanItemKey(r.kind, r.id);
        const visible = (): DoubanSyncRow[] =>
            allRows.filter((r) => (filterKind === null || r.kind === filterKind) && (filterState === null || r.state === filterState));
        // 🔴 #664：勾选**不再排除「库里已有」**—— 勾上它就是"覆盖"（用户要的能力就是这个）
        const picked = (): DoubanSyncRow[] => visible().filter((r) => boxes.get(keyOf(r))?.box.checked);
        const pickedOverrides = (): DoubanSyncRow[] => picked().filter((r) => r.imported);

        const refresh = (): void => {
            const vis = visible();
            const n = picked().length;
            const ov = pickedOverrides().length;
            countEl.setText(
                `共 ${allRows.length} 条 · 当前显示 ${vis.length} 条 · 已选 ${n} 条` + (ov ? `（含覆盖 ${ov} 条）` : ''),
            );
            goBtn.setText(n ? `导入 ${n} 条` : '导入');
            goBtn.disabled = n === 0;
            allBtn.setText(n >= vis.length && vis.length > 0 ? '全不选' : '全选');
        };

        /** 同步过滤条的高亮（与列表同源刷新） */
        const segBtns: Array<{ el: HTMLButtonElement; on: () => boolean }> = [];
        const addSegBtn = (parent: HTMLElement, text: string, isOn: () => boolean, onClick: () => void): void => {
            const b = parent.createEl('button', {
                cls: 'rl-douban-segitem',
                text,
                attr: { type: 'button', 'aria-pressed': 'false' },
            });
            b.addEventListener('click', () => {
                onClick();
                for (const x of segBtns) {
                    x.el.toggleClass('is-on', x.on());
                    x.el.setAttribute('aria-pressed', x.on() ? 'true' : 'false');
                }
                paint();
            });
            segBtns.push({ el: b, on: isOn });
        };

        addSegBtn(kindSeg, '全部', () => filterKind === null, () => (filterKind = null));
        for (const k of DOUBAN_ALL_KINDS) {
            addSegBtn(kindSeg, DOUBAN_KIND_LABELS[k], () => filterKind === k, () => (filterKind = k));
        }
        addSegBtn(stateSeg, '全部', () => filterState === null, () => (filterState = null));
        for (const s of DOUBAN_ALL_STATES) {
            addSegBtn(stateSeg, doubanStateLabel('movie', s), () => filterState === s, () => (filterState = s));
        }

        /**
         * 画列表：**按类型分组**（一键读取后四类混在一起，分组才看得出哪些是新拉到的）。
         * 🔴 勾选状态是**全局**的（不随过滤丢失）：过滤只改"显示哪些"，⛔ 不改勾选。
         */
        const paint = (): void => {
            list.empty();
            const vis = visible();
            if (!vis.length) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: allRows.length ? '当前过滤条件下没有条目' : '（没有读到条目）' });
                refresh();
                return;
            }
            for (const kind of DOUBAN_ALL_KINDS) {
                const group = vis.filter((r) => r.kind === kind);
                if (!group.length) continue;
                const head = list.createDiv({ cls: 'rl-douban-group' });
                head.setText(`${DOUBAN_KIND_LABELS[kind]}（${group.length} 条）`);
                for (const r of group) {
                    const k = keyOf(r);
                    const row = list.createDiv({ cls: 'rl-wshelf-row' + (r.imported ? ' is-done' : '') });
                    const box = row.createEl('input', { cls: 'rl-wshelf-box', attr: { type: 'checkbox' } });
                    const state = boxes.get(k);
                    // 🔴🔴 #664（用户：「为什么无法勾选库内已有的覆盖」）：
                    //    上一版把「库里已有」的行 `disabled` 了 —— 用户想**覆盖**那条时完全无路可走。
                    //    ⇒ 现在**可勾选**：默认仍不勾（避免误覆盖），勾上 = 覆盖库内那条（覆盖口径见弹窗顶部说明）。
                    box.checked = r.imported ? (state ? state.box.checked : false) : (state ? state.box.checked : true);
                    const main = row.createDiv({ cls: 'rl-wshelf-main' });
                    main.createDiv({ cls: 'rl-wshelf-title', text: r.title });
                    const meta: string[] = [doubanStateLabel(r.kind, r.state)];
                    if (r.rating) meta.push(`★${r.rating}`);
                    if (r.markedAt) meta.push(`标记于 ${r.markedAt}`);
                    if (r.imported) meta.push('库里已有 · 勾选=覆盖');
                    main.createDiv({ cls: 'rl-wshelf-sub', text: meta.join(' · ') });
                    box.addEventListener('change', () => {
                        boxes.set(k, { row: r, box });
                        row.toggleClass('is-override', r.imported && box.checked);
                        refresh();
                    });
                    row.toggleClass('is-override', r.imported && box.checked);
                    boxes.set(k, { row: r, box });
                }
            }
            refresh();
        };

        allBtn.addEventListener('click', () => {
            // 🔴 #664：「全选」也把「库里已有」算进来（那些勾上 = 覆盖）——
            //    ⛔ 别只全选"没同步过的"：用户点全选就是要"全都来一遍"。
            const vis = visible();
            const turnOn = picked().length < vis.length;
            for (const r of vis) {
                const st = boxes.get(keyOf(r));
                if (st) st.box.checked = turnOn;
            }
            paint();
        });

        /**
         * 🔴 #663 **一键读取全部**：依次跑 12 个组合（4 类 × 3 状态），逐项报进度。
         * ⚠️ 12 次请求串行 + 宿主内每页 900ms 间隔 ⇒ 豆瓣风控不会被触发；
         *    单个组合失败**不中断**整轮（否则一个类型没收藏就全白跑），但要**记下来**并如实显示。
         */
        const readAll = (): void => {
            if (!this.opts.cookie().trim()) {
                status.setText('还没有配置豆瓣 Cookie —— 请先到「设置 › 元数据源配置 › 元数据搜索源凭据 › 豆瓣」粘贴登录态 Cookie，然后点「重新读取」。');
                retryBtn.setText('重新读取');
                return;
            }
            retryBtn.disabled = true;
            goBtn.disabled = true;
            status.setText('正在读取全部收藏…');
            void (async () => {
                const jobs = doubanSyncJobs();
                const found: DoubanSyncRow[] = [];
                const seen = new Set<string>();
                const failed: string[] = [];
                let existing = new Set<string>();
                try {
                    existing = await this.opts.existingKeys();
                } catch {
                    /* 读不到就当空集（不影响读取，只影响"库里已有"标注） */
                }
                for (let i = 0; i < jobs.length; i++) {
                    const job = jobs[i];
                    status.setText(`正在读取 ${job.label}（${i + 1}/${jobs.length}）…`);
                    try {
                        const items = await this.opts.onFetch(job.kind, job.state);
                        for (const it of items) {
                            const k = doubanItemKey(job.kind, it.id);
                            if (seen.has(k)) continue;
                            seen.add(k);
                            found.push({ ...it, kind: job.kind, state: job.state, imported: existing.has(k) });
                        }
                    } catch (e) {
                        failed.push(`${job.label}：${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                allRows = found;
                boxes = new Map();
                filterBar.style.display = found.length ? 'flex' : 'none';
                bar.style.display = found.length ? 'flex' : 'none';
                for (const x of segBtns) {
                    x.el.toggleClass('is-on', x.on());
                    x.el.setAttribute('aria-pressed', x.on() ? 'true' : 'false');
                }
                paint();
                const head = found.length
                    ? `已读取全部收藏 ${found.length} 条（` +
                      DOUBAN_ALL_KINDS.map((k) => `${DOUBAN_KIND_LABELS[k]} ${found.filter((r) => r.kind === k).length}`).join(' · ') +
                      '）。'
                    : '没有读到任何收藏 —— 检查 Cookie 是否有效，或换个时间再试。';
                status.setText(head);
                note.setText(failed.length ? `有 ${failed.length} 项没读到：\n${failed.join('\n')}` : '');
                retryBtn.disabled = false;
                retryBtn.setText('重新读取');
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
                    // 🔴 2026-10-21（用户需求 4）：同名条目**必须**让用户看见 ——
                    //    它的笔记会与库内既有条目落到同一个 `.md`（路径按标题派生），静默覆盖最难查。
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

        // 🔴 打开即读（用户口径⑶：「点同步的心智就是拉给我看」）
        readAll();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
