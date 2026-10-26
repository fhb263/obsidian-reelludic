// 附件管理弹窗（设置页 › 封面与清理 › 附件管理）。
//
// 历史沿革：本类原先与 `EntryRestoreModal` 同住 `modals/EntryRestoreModal.ts`，共用一套 `.rl-pc-*` 类名。
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ③④）：**整体搬出来重写** ——
//    · 类名换成 `.rl-am-*`：`.rl-pc-*` 那套还被 `AssetCleanupModal` / `EntryRestoreModal` 用着，
//      两者混用会让 CSS 改动互相牵连（用户报障的排版问题就是这么糊起来的）；
//    · 结构从「一级（条目）→ 文件」升级成**双层折叠**：一级 = 条目类型（电影/剧集/…），
//      二级 = 系列（`熊出没系列 · 共 N 部`）；没有系列名的条目作为「散件」直接平铺在一级里。
//      用户原话：「附件管理的分类再多一层，按条目类型分，一个类型里再按系列分」。
//    · 标题与副标题必须是 **DOM 兄弟节点**（⛔ 别用 position:absolute / 负 margin 摆位）——
//      用户报障的正是「这两个叠在一起了」。
//
// 🔴 口径（与旧实现一致，⛔ 别在重构里改掉）：
//  ⑴ 删除一律 `fileManager.trashFile`（尊重用户「删除文件」偏好，可从回收站还原），⛔ 不用 `vault.delete`。
//  ⑵ 库外绝对路径媒体只展示、`deletable: false`（本插件不碰库外文件）。
//  ⑶ 删文件只是删文件 —— 用户在这里是「管理文件」，不是「删条目」；⛔ 不动 catalog 记录。
//  ⑷ 底部另有一组「已删条目遗留」：那是**已经删掉**的条目留在 `trash.json` 里的路径，
//     条目已不在列表里（所以文件是「没人引用」的）；只有文件仍在库里时才列出来 —— 这是
//     「条目已删、附件还留着」那条尾巴的唯一出口。
import { App, Modal, Notice, TFile, normalizePath, setIcon } from 'obsidian';
import { parseTrashFile, type TrashRecord } from 'pure/entryTrash';
import { ENTRY_ASSET_LABEL, type EntryAsset } from 'pure/orphanAssets';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, type EntryType } from 'data/types';
import { forceHideScroll, markScrollInside } from 'services/scrollPref';
import { createVaultIO } from 'services/vaultIO';

/** 一个条目在附件管理里的分组（宿主 `listEntryAssets()` 的产物形状） */
export interface AssetGroup {
    entry: {
        id: string;
        title: string;
        type: EntryType;
        /**
         * 所属系列名（`MediaEntry.series`，可空）。
         * 🔴 2026-10-19 新增：二级折叠按它聚合；⛔ 别让弹窗回头 `service.list()` 反查
         * —— 那份数据会与打开弹窗时的快照不同步。
         */
        series?: string;
    };
    assets: EntryAsset[];
}

/**
 * 条目类型 → 一级折叠头的图标名（Obsidian 内建 Lucide）。
 * ⚠️ 为什么不复用 `pure/homeTabs.homeTabIcon`：那是**页签**轴的图标表（影视只给 `film`、
 *    没有 tv/anime 的拆分），而这里要按六个 `EntryType` 一一对应 ⇒ 两条轴不同，⛔ 别硬并。
 */
const ASSET_TYPE_ICON: Record<EntryType, string> = {
    movie: 'film',
    tv: 'tv',
    anime: 'sparkles',
    book: 'book-open',
    game: 'gamepad-2',
    music: 'music',
};

/** `setIcon` 遇到不存在的图标名会抛 ⇒ 图标只是装饰，失败**不该**让整个弹窗挂掉（与各 modal 同款兜底） */
function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 图标名不认识：留空即可，不影响功能
    }
}

/**
 * 附件管理弹窗（设置页 › 封面与清理 › 附件管理）。
 *
 * 🔴 删除由弹窗自己执行（`trashFile`），⛔ 不经宿主 —— 这样列表能**当场刷新**，
 *    不会出现「删完了界面上还列着」。删除完成后回调 `onChanged`，宿主据此刷新卡片视图。
 */
export class AssetManagerModal extends Modal {
    private checks: { asset: EntryAsset; box: HTMLInputElement }[] = [];
    private trashChecks: { path: string; box: HTMLInputElement }[] = [];
    private delBtn: HTMLButtonElement | null = null;
    private subEl: HTMLElement | null = null;
    private query = '';
    private busy = false;
    /** 打开时的总量（副标题在筛选态下要拿它当「全库」参照） */
    private totals = { entries: 0, files: 0 };

    constructor(
        app: App,
        /** 现存条目 → 关联文件（**含全部**，不只是能删的） */
        private groups: AssetGroup[],
        /** 条目回收站文件路径（`{库目录}/trash.json`），只读用来列「已删条目带走的文件」 */
        private trashPath: string,
        /** 删完回调（宿主刷新视图）；抛错不影响删除结果 */
        private onChanged: () => Promise<void>,
        /**
         * 弹窗关闭时回调。
         * 🔴 2026-10-19 用户报障「附件管理关掉后再点打不开」：宿主的 `openAssetManager()` 用
         *    `assetManagerOpen` 做防重入，而旧实现的 `onClose()` 只清 DOM、**从不复位标志** ⇒
         *    关一次就永远走 early-return。复位职责只能挂在弹窗关闭上（宿主不知道用户何时关窗）。
         */
        private onClosed?: () => void,
    ) {
        super(app);
    }

    private picked(): EntryAsset[] {
        return this.checks.filter((c) => c.box.checked && c.asset.deletable).map((c) => c.asset);
    }

    private pickedTrashPaths(): string[] {
        return this.trashChecks.filter((c) => c.box.checked).map((c) => c.path);
    }

    private syncBtn(): void {
        if (!this.delBtn) return;
        const n = this.picked().length + this.pickedTrashPaths().length;
        this.delBtn.setText(`删除选中（${n}）`);
        this.delBtn.disabled = n === 0 || this.busy;
    }

    /** 文件是否仍在库里（分组与回收站两块共用同一判定） */
    private exists(p: string): boolean {
        return this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile;
    }

    /** 读回收站里「已删条目带走的、但文件仍在库里」的路径（去重，保序） */
    private async orphanedFromTrash(): Promise<string[]> {
        let records: TrashRecord[] = [];
        try {
            records = parseTrashFile(await createVaultIO(this.app).readText(this.trashPath)).records;
        } catch {
            return []; // 没有回收站文件（从未删过条目）= 空，⛔ 不报错
        }
        const seen = new Set<string>();
        const out: string[] = [];
        for (const r of records) {
            for (const p of r.files ?? []) {
                if (seen.has(p)) continue;
                seen.add(p);
                if (this.exists(p)) out.push(p);
            }
        }
        return out;
    }

    onOpen(): void {
        // 🔴 2026-10-21 用户指令：这个弹窗的滚动条**恒隐藏**（不是跟随全局开关）。
        // 列表做成双层折叠后，滚动条紧贴着分组卡右边框，视觉上像把卡片切了一刀；
        // 鼠标滚轮 / 触控板照常滚，只是不画那条槽。先例：EpisodePickerModal / QuickAssociateModal。
        forceHideScroll(this.modalEl);
        this.modalEl.addClass('rl-am-modal');
        void this.render();
    }

    /** 副标题文案（筛选态要同时给出「筛出」与「全库」，否则用户不知道过滤掉了多少） */
    private subText(entries: number, files: number): string {
        if (!this.query) {
            return `共 ${entries} 个条目、${files} 个关联文件（笔记 / 封面 / 阅读存档 / 书签 / 媒体）`;
        }
        return `筛出 ${entries} 个条目、${files} 个文件（全库 ${this.totals.entries} 个条目 / ${this.totals.files} 个文件）`;
    }

    private async render(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        this.checks = [];
        this.trashChecks = [];
        this.delBtn = null;

        // ① 头（标题 + 副标题：**两个兄弟节点**，见文件头注释）
        const head = contentEl.createDiv({ cls: 'rl-am-head' });
        head.createDiv({ cls: 'rl-am-title', text: '附件管理' });
        this.subEl = head.createDiv({ cls: 'rl-am-sub' });

        const total = this.groups.reduce((n, g) => n + g.assets.length, 0);
        this.totals = { entries: this.groups.length, files: total };
        const leftovers = await this.orphanedFromTrash();

        if (total === 0 && leftovers.length === 0) {
            this.subEl.setText(this.subText(0, 0));
            contentEl.createDiv({ cls: 'rl-am-empty', text: '没有找到任何关联文件' });
            this.renderFoot(contentEl, false);
            return;
        }
        this.subEl.setText(this.subText(this.totals.entries, this.totals.files));
        // 内部列表滚动（与 DeleteEntryModal 同结构：滚动只在列表里，头部与底部常驻）
        markScrollInside(this.modalEl);

        // ② 搜索（同时匹配 条目名 / 文件名 / 系列名 —— 见下面 row 的 `data-q`）
        const searchWrap = contentEl.createDiv({ cls: 'rl-am-search' });
        const input = searchWrap.createEl('input', { type: 'search' }) as HTMLInputElement;
        input.placeholder = '搜索条目名 / 文件名 / 系列名';
        input.addEventListener('input', () => {
            this.query = input.value.trim().toLowerCase();
            this.applyFilter();
        });

        // ③ 列表：一级 = 类型（顺序 = ENTRY_TYPES / ENTRY_TYPE_LABELS 的键序），二级 = 系列
        const list = contentEl.createDiv({ cls: 'rl-am-list' });
        for (const t of ENTRY_TYPES) {
            const inType = this.groups.filter((g) => g.entry.type === t);
            if (!inType.length) continue;
            /** 该类型的系列分组（保序：按首次出现顺序，用户扫读时与列表顺序一致） */
            const bySeries = new Map<string, AssetGroup[]>();
            const loose: AssetGroup[] = [];
            for (const g of inType) {
                const s = (g.entry.series ?? '').trim();
                if (!s) {
                    loose.push(g);
                    continue;
                }
                const arr = bySeries.get(s);
                if (arr) arr.push(g);
                else bySeries.set(s, [g]);
            }
            const assetCount = inType.reduce((n, g) => n + g.assets.length, 0);

            const l1 = document.createElement('details');
            l1.className = 'rl-am-l1';
            // 🔴 2026-10-25 用户指令：「附件管理弹窗**默认全部折叠**起来」。
            //    ⇒ 一级与二级初值都是收起（`open = false` 就是不写这个属性）。
            //    ⛔ 别再按「最多六个类型，收起后整屏只剩六个标题」的老理由恒展开 —— 用户要的是
            //       打开弹窗先看到**分组全貌**，而不是一屏文件行。
            const sum1 = l1.createEl('summary', { cls: 'rl-am-l1-head' });
            safeSetIcon(sum1.createSpan({ cls: 'rl-am-ico' }), ASSET_TYPE_ICON[t]);
            sum1.createSpan({ cls: 'rl-am-l1-name', text: ENTRY_TYPE_LABELS[t] ?? t });
            sum1.createSpan({ cls: 'rl-am-count', text: `${assetCount} 项` });

            for (const [series, inSeries] of bySeries) {
                const l2 = document.createElement('details');
                l2.className = 'rl-am-l2';
                // 🔴 2026-10-25：默认全折叠（原「系列少的默认展开」已撤 —— 用户要的是一进来全收起）
                const sum2 = l2.createEl('summary', { cls: 'rl-am-l2-head' });
                sum2.createSpan({ cls: 'rl-am-l2-name', text: `${series}系列` });
                sum2.createSpan({ cls: 'rl-am-count', text: `共 ${inSeries.length} 部` });
                for (const g of inSeries) {
                    for (const a of g.assets) this.renderRow(l2, g, a);
                }
                l1.appendChild(l2);
            }
            // 散件（无系列名）：**平铺在一级里**，⛔ 不硬造一个「未分类」二级组
            for (const g of loose) {
                for (const a of g.assets) this.renderRow(l1, g, a, true);
            }
            list.appendChild(l1);
        }

        // ③.5 已删条目遗留（一级组，无二级：这些路径已经没有条目可归）
        if (leftovers.length > 0) {
            const l1 = document.createElement('details');
            l1.className = 'rl-am-l1';
            // 默认全折叠（同上一级组）
            const sum = l1.createEl('summary', { cls: 'rl-am-l1-head' });
            safeSetIcon(sum.createSpan({ cls: 'rl-am-ico' }), 'trash-2');
            sum.createSpan({ cls: 'rl-am-l1-name', text: '已删条目' });
            sum.createSpan({ cls: 'rl-am-count', text: `${leftovers.length} 项` });
            for (const p of leftovers) {
                const name = p.slice(p.lastIndexOf('/') + 1);
                const row = l1.createDiv({ cls: 'rl-am-row' });
                row.dataset.q = `${name} ${p} 遗留`.toLowerCase();
                const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                cb.addEventListener('change', () => this.syncBtn());
                this.trashChecks.push({ path: p, box: cb });
                row.createSpan({ cls: 'rl-am-entry', text: '条目已删除' });
                row.createSpan({ cls: 'rl-am-kind', text: '遗留' });
                row.createSpan({ cls: 'rl-am-name', text: name, attr: { 'data-tip': p } });
            }
            list.appendChild(l1);
        }

        // ④ 底部（提示文案 + 危险色说明 + 按钮）
        this.renderFoot(contentEl, true);

        // 删除后走 `render()` 重绘：搜索框是新建的空 input，但 `this.query` 还是上一次的
        // ⇒ 把值写回去再套一次过滤，否则「框里空的、列表却只显示一部分」自相矛盾。
        input.value = this.query;
        if (this.query) this.applyFilter();
    }

    /**
     * 画一行资产（条目名 / 资产种类 / 文件名 / 附加提示）—— 一级与二级共用同一份行结构。
     *
     * @param loose 该行是「散件」（无系列名，直接挂在**一级**里）：
     *   加 `is-loose` 让左内边距回到 12px —— 二级里的行缩进更深是层级语义，
     *   散件没有二级可缩，硬吃 32px 会看着像「漏了父级」。类名由 CSS 包约定（`.rl-am-row.is-loose`）。
     */
    private renderRow(host: HTMLElement, g: AssetGroup, a: EntryAsset, loose = false): void {
        const row = host.createDiv({ cls: loose ? 'rl-am-row is-loose' : 'rl-am-row' });
        row.dataset.entryId = g.entry.id;
        // 搜索命中面 = 条目名 + 系列名 + 文件名 + 种类文案（用户在搜索框里可能输任何一项）
        row.dataset.q = `${g.entry.title} ${g.entry.series ?? ''} ${a.name} ${ENTRY_ASSET_LABEL[a.kind]}`.toLowerCase();
        const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
        cb.disabled = !a.deletable;
        cb.addEventListener('change', () => this.syncBtn());
        this.checks.push({ asset: a, box: cb });
        row.createSpan({ cls: 'rl-am-entry', text: g.entry.title, attr: { 'data-tip': g.entry.id } });
        row.createSpan({ cls: 'rl-am-kind', text: ENTRY_ASSET_LABEL[a.kind] });
        row.createSpan({ cls: 'rl-am-name', text: a.name, attr: { 'data-tip': a.path } });
        if (a.hint) row.createSpan({ cls: 'rl-am-note', text: `（${a.hint}）` });
        else if (a.risk === 'risky') row.createSpan({ cls: 'rl-am-note', text: '（你自己的媒体文件）' });
    }

    private renderFoot(contentEl: HTMLElement, canDelete: boolean): void {
        const foot = contentEl.createDiv({ cls: 'rl-am-foot' });
        const hint = foot.createDiv({ cls: 'rl-am-foot-hint' });
        hint.createDiv({
            cls: 'rl-am-foot-line',
            text: `共 ${this.totals.entries} 个条目、${this.totals.files} 个关联文件。`,
        });
        // 危险色说明：删除键用 `.rl-nc-danger`，这句话就是它为什么是红色
        hint.createDiv({
            cls: 'rl-am-foot-danger',
            text: '删除的文件进入 Obsidian 回收站（可在回收站还原）；条目记录本身不受影响。',
        });
        const acts = foot.createDiv({ cls: 'rl-am-foot-acts' });
        // 🔴 2026-10-25 用户指令：底部**不画「关闭」** —— 右上角 ✕ 就是关闭。
        if (!canDelete) return;
        const del = acts.createEl('button', { cls: 'rl-nc-danger', text: '删除选中' });
        this.delBtn = del;
        del.onclick = () => void this.doDelete();
        this.syncBtn();
    }

    /** 真正删除：逐个 trashFile → 回调 → **重扫并重绘**（列表不再列已删掉的文件） */
    private async doDelete(): Promise<void> {
        const assets = this.picked();
        const leftoverPaths = this.pickedTrashPaths();
        if (assets.length + leftoverPaths.length === 0) {
            new Notice('未选择任何文件');
            return;
        }
        this.busy = true;
        this.syncBtn();
        let ok = 0;
        for (const a of assets) {
            if (!a.deletable) continue;
            const f = this.app.vault.getAbstractFileByPath(normalizePath(a.path));
            if (!(f instanceof TFile)) continue;
            try {
                await this.app.fileManager.trashFile(f);
                ok++;
            } catch {
                // 文件可能已被外部移除：不阻断
            }
        }
        for (const p of leftoverPaths) {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
            if (!(f instanceof TFile)) continue;
            try {
                await this.app.fileManager.trashFile(f);
                ok++;
            } catch {
                // 同上
            }
        }
        const want = assets.length + leftoverPaths.length;
        new Notice(ok === want ? `已删除 ${ok} 个文件` : `已删除 ${ok}/${want} 个文件（其余失败）`);
        try {
            await this.onChanged();
        } catch {
            // 刷新视图失败不影响删除结果
        }
        this.busy = false;
        if (ok > 0) {
            // 重扫：宿主给的 groups 是快照，这里按「现存文件」把已删掉的剔掉，避免列表骗人
            for (const g of this.groups) g.assets = g.assets.filter((a) => this.exists(a.path));
            this.groups = this.groups.filter((g) => g.assets.length > 0);
            await this.render();
        } else {
            this.syncBtn();
        }
    }

    /**
     * 筛选：整组隐藏 + **计数跟着重算**，⛔ 不重建 DOM（重建会丢勾选状态）。
     * 🔴 2026-10-19 用户要求「过滤后一级/二级计数按过滤结果算」：所以先定行的显隐，
     *    再由「可见行」反推二级的「共 N 部」与一级的「N 项」（⛔ 别在过滤时跳过计数）。
     */
    private applyFilter(): void {
        const q = this.query;
        const hitEntries = new Set<string>();
        let hitFiles = 0;
        for (const row of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.rl-am-row'))) {
            const hit = !q || (row.dataset.q ?? '').includes(q);
            row.style.display = hit ? '' : 'none';
            if (!hit) continue;
            hitFiles++;
            const id = row.dataset.entryId;
            if (id) hitEntries.add(id);
        }
        for (const l2 of Array.from(this.contentEl.querySelectorAll<HTMLDetailsElement>('details.rl-am-l2'))) {
            const visible = Array.from(l2.querySelectorAll<HTMLElement>('.rl-am-row')).filter(
                (r) => r.style.display !== 'none',
            );
            l2.style.display = visible.length ? '' : 'none';
            if (q && visible.length) l2.open = true;
            const n = l2.querySelector<HTMLElement>('.rl-am-l2-head .rl-am-count');
            const series = new Set(visible.map((r) => r.dataset.entryId ?? '').filter((id) => !!id));
            n?.setText(`共 ${series.size} 部`);
        }
        for (const l1 of Array.from(this.contentEl.querySelectorAll<HTMLDetailsElement>('details.rl-am-l1'))) {
            const visible = Array.from(l1.querySelectorAll<HTMLElement>('.rl-am-row')).filter(
                (r) => r.style.display !== 'none',
            );
            l1.style.display = visible.length ? '' : 'none';
            if (q && visible.length) l1.open = true;
            l1.querySelector<HTMLElement>('.rl-am-l1-head .rl-am-count')?.setText(`${visible.length} 项`);
        }
        this.subEl?.setText(this.subText(hitEntries.size, hitFiles));
    }

    onClose(): void {
        this.contentEl.empty();
        // 🔴 复位宿主的「已打开」标志（见构造器 `onClosed` 的注释）—— 这一行就是「二次打不开」的修复点
        this.onClosed?.();
    }
}
