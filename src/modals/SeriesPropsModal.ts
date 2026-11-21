/**
 * 系列卡「编辑系列属性」弹窗（m07813②）—— 折叠卡**单击信息栏 / 悬停 ⋯ 菜单**的落点。
 *
 * 🔴 用户原话（m07813，逐字）：「给系列卡也做一个编辑属性窗口（同时右键菜单的改系列名、批量填合集、
 *    批量填标签收进编辑系列属性页面内。同单击单卡卡片网格信息栏逻辑一样，单击系列卡信息栏也打开编辑属性窗口）」
 *
 * 🔴 2026-11-15 第二次裁定（**推翻上一版「右键保留 + 窗口里再给一份」**，用户逐字）：
 *    「还是将改系列名、排序号、批量填合集、批量填标签放进编辑系列属性页面窗口里较好，
 *      删除右键菜单和其单独改的入口和页面」
 *    ⇒ 本窗口现在是这四件事的**唯一入口**；`openSeriesRenamePrompt` / `openGroupCollectionPrompt` /
 *      `openGroupTagsPrompt` 三个独立弹窗**已整体删除**，`SeriesReorderModal`（拖拽弹窗）也删了
 *      （排序就地做在窗口里）。
 *    ⚠️ 第五轮 ask_user_question 裁定「右键菜单保留，只留这一条」——留下的是**批量关联**
 *      （逐条清单，不是批量写操作），本窗口给它一枚跳转按钮。
 *
 * 🔴 与 `SeriesPickerModal` 同一套壳约定（照抄那三条）：
 *    · 挂在宿主 `Modal` ⇒ 遮罩 / Esc / 点外面关闭 / 焦点管理全交给宿主，插件内**不自造遮罩**；
 *    · **保存实例并在 `onClose` 里销毁** —— 不销毁的话响应式逻辑会在弹窗关掉后继续往已卸载的 DOM 上写；
 *    · 清空宿主自带的标题文字（标题由内容里的 `h2` 承担），⛔ 别隐藏宿主那枚关闭钮、也别自绘第二枚。
 *
 * ⚠️ 本文件**只是壳**：算宽度 + 挂 `SeriesProps.svelte` + 把回传值落库。
 * 🔴 落库只走宿主既有的批量原语（`service.update` / `bulkSetSeriesIndex` / `bulkSetCollection` /
 *    `bulkAddTags` / `service.setSeriesRating`）—— ⛔ 别在这里另写一套 catalog 写入。
 */
import { Modal, Notice, type App } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import { normalizeSeriesName, planSeriesReindexAll, type SeriesGroup } from 'pure/seriesGroup';
import { seriesGroupHidden } from 'pure/seriesHidden';
import SeriesProps from 'views/components/SeriesProps.svelte';
import { applyScrollPref } from 'services/scrollPref';
import { ConfirmModal } from 'modals/ConfirmModal';
import { releaseCardFocusOnClose } from 'ui/components';

/** 组类型 → 中文（副标题用；与卡片上的类型文案同口径） */
const TYPE_LABEL: Record<string, string> = {
    movie: '电影',
    tv: '剧集',
    anime: '动画',
    game: '游戏',
    book: '书籍',
    music: '音乐',
};

export class SeriesPropsModal extends Modal {
    private instance: SeriesProps | null = null;
    /** 窗口内实时改动的系列名（改名后组键会变，但窗口不重开 —— 只更新本地快照避免重复提交） */
    private curName: string;
    /** 窗口内实时改动的合集分 */
    private curRating = 0;
    /** 窗口内实时改动的「隐藏此系列卡片」态（m03458；落库失败会回滚到此值的前一态） */
    private curHidden = false;

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        /** 打开那一刻的组快照（键 + 类型 + 显示名 + 已排好序的成员） */
        private group: SeriesGroup,
    ) {
        super(app);
        this.curName = group.name;
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        this.titleEl.setText('');
        contentEl.empty();
        // 🔴 用户 2026-11-21「改成两两并排」⇒ 从 560px 放宽到 660px：两列各约 310px，
        //    半星控件（5 颗 × 20px + `9/10`）和「输入框 + 改名按钮」才都在一行里不折行。
        //    ⚠️ 仍留 92vw 上限，窄屏 / 移动端不会溢出。
        this.modalEl.style.width = 'min(660px, 92vw)';
        this.modalEl.style.maxWidth = 'min(660px, 92vw)';

        void this.mount();
    }

    /** 读合集分后挂载（`seriesRatings` 是异步的；先挂空壳会闪一下「未评分」再跳分） */
    private async mount(): Promise<void> {
        try {
            const table = await this.plugin.service.seriesRatings();
            this.curRating = Number(table[this.group.key] ?? 0) || 0;
        } catch {
            // 读分失败不该让整个窗口打不开 —— 按未评分展示，用户重新打分即可。
            this.curRating = 0;
        }
        // 隐藏态：与合集分同批读（同一份 catalog，分两次读会白多一次磁盘往返）。
        // ⚠️ 读失败按「未隐藏」展示：窗口先能打开比态精确更重要，用户重勾一次即可。
        try {
            const hiddenTable = await this.plugin.service.seriesHidden();
            this.curHidden = seriesGroupHidden(hiddenTable, this.group.key);
        } catch {
            this.curHidden = false;
        }
        if (!this.contentEl.isConnected) return; // 读分期间用户已关窗 ⇒ 别再往上挂

        const tags = Array.from(new Set(this.group.items.flatMap((e) => e.tags ?? []))).filter((t) => !!t);

        this.instance = new SeriesProps({
            target: this.contentEl,
            props: {
                title: this.group.title,
                typeLabel: TYPE_LABEL[this.group.type] ?? '',
                // 🔴 封面在**宿主**解析后传进来（组件不碰 `plugin`）
                members: this.group.items.map((e) => ({
                    id: e.id,
                    title: e.title,
                    sub: e.year ? String(e.year) : undefined,
                    poster: this.plugin.resolvePoster(e),
                })),
                name: this.curName,
                rating: this.curRating,
                hiddenCard: this.curHidden,
                collection: this.group.items.map((e) => e.collection).find((c) => !!c && c.trim().length > 0) ?? '',
                tagsHint: tags.slice(0, 12).join('、'),
                onRename: (next: string) => void this.doRename(next),
                onRate: (next: number) => void this.doRate(next),
                onToggleHidden: (next: boolean) => void this.doSetHidden(next),
                onSetCollection: (next: string) => void this.doSetCollection(next),
                onAddTags: (raw: string) => void this.doAddTags(raw),
                onReorder: (ids: string[]) => void this.doReorder(ids),
                onAssociate: () => {
                    // 🔴 批量关联是**逐条清单**（每一条单独选关联对象），不是批量写 ⇒ 仍走宿主那个弹窗。
                    //    先关本窗口，避免两层 Modal 叠着 —— 用户看不清自己在操作哪一层。
                    this.close();
                    this.plugin.openSeriesAssociate(this.group);
                },
            },
        });
    }

    /**
     * 勾/取消「隐藏此系列卡片」（m03458）。
     *
     * 🔴 与 `doRate` 同一条纪律：**先 `$set` 让界面立刻响应，再落库；失败回滚到落库前的值**。
     *    反过来的写法（等磁盘写完再刷 UI）会让复选框「点了不动」几百毫秒。
     * 🔴 只写 `catalog.seriesHidden`，⛔ **不碰组内任何一条的 `cardHidden`** ——
     *    用户明确要求「里面的系列条目不受影响」，改了就是把整个系列打码。
     * ⚠️ 不关窗口、不弹多余提示：卡片本身变模糊就是最好的回执（用户回头就能看见）。
     */
    private async doSetHidden(next: boolean): Promise<void> {
        const prev = this.curHidden;
        if (next === prev) return;
        this.curHidden = next;
        this.instance?.$set({ hiddenCard: next });
        try {
            await this.plugin.service.setSeriesHidden(this.group.key, next);
        } catch (e) {
            this.curHidden = prev;
            this.instance?.$set({ hiddenCard: prev });
            new Notice(`改不了隐藏状态：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * 改系列名（整组）。
     *
     * 🔴 为什么改 `series` 而不是 `collection`：折叠卡的分组键是 `pure/seriesGroup.seriesKeyOf`
     *    （`type` + `归一化系列名`）⇒ 只改一个成员的 `series` 会把那一条从组里拆出去，
     *    组名又由「组内首个成员」决定 ⇒ 必须**整组一起改**，否则表现成「改完还是旧名 + 少了一部」。
     * 🔴 合集分要**跟着搬家**（`catalog.seriesRatings` 的键 = 旧分组键）：
     *    不改索引的话，用户给这一组打的分在改名瞬间变孤儿 —— 界面上就是「分没了」。
     * ⚠️ 系列序号（`seriesIndex`）**不动**：改名不改顺序。
     * ⚠️ 新名归一后与旧键相同 ⇒ 什么都不做（⛔ 别产出一次无意义的全量写入与刷屏回执）。
     */
    private async doRename(next: string): Promise<void> {
        const trimmed = next.trim();
        if (!trimmed || trimmed === this.curName) return;
        const ids = this.group.items.map((e) => e.id);
        const oldKey = this.group.key;
        const newKey = `${this.group.type}${String.fromCharCode(1)}${normalizeSeriesName(trimmed)}`;
        for (const id of ids) {
            try {
                await this.plugin.service.update(id, { series: trimmed });
            } catch {
                // 单条失败不阻断其余（与 bulkSetSeriesIndex / bulkSetCollection 同款）。
            }
        }
        if (newKey !== oldKey) {
            // 合集分搬家：先写新键，再把旧键清0 删键。
            try {
                const table = await this.plugin.service.seriesRatings();
                const oldRating = table[oldKey];
                if (oldRating !== undefined) {
                    await this.plugin.service.setSeriesRating(newKey, oldRating);
                    await this.plugin.service.setSeriesRating(oldKey, 0);
                }
            } catch {
                // 分数搬家失败不该让改名整体失手 —— 条目已经改好了，下次改名还能再试。
            }
        }
        this.curName = trimmed;
        // 组键随名字变 ⇒ 换成本地快照，后续打分 / 排序仍落在正确的组上。
        this.group = { ...this.group, key: newKey, name: trimmed, title: trimmed };
        await this.plugin.refreshViews();
        new Notice(`已把 ${ids.length} 部改名为「${trimmed}」`);
    }

    /**
     * 打合集分（点星即变）。
     *
     * 🔴🔴 2026-11-16 用户报障「系列的评分不能实时即点即变化」——**根因不在组件、不在落库**，
     *    而是这里只写了 `this.curRating`（本类私有字段，父级）却**从不回推已挂载的实例**：
     *    星星的高亮状态读的是 `SeriesProps` 的 `rating` prop，prop 没有 `$set` 就永远停在
     *    开窗那一刻读到的值 ⇒ 用户点第一颗星时界面纹丝不动，点第二颗仍然纹丝不动
     *    （`pickStar` 里 `rating === n ? 0 : n` 也基于旧 prop 判断，所以连「再点一次取消」都失效）。
     *    ⛔ 别改成「关窗重开」或「整块重建组件」来绕过：那会丢焦点、丢已拖好的排序，还会闪一下。
     *    ⇒ 顺序固定：**先 `$set` 让界面立刻响应**，再落库，最后 `refreshViews` 让卡片也跟着变。
     *      落库失败时把界面退回落库前的值（不能让界面显示一个没存进库的分数）。
     */
    private async doRate(next: number): Promise<void> {
        const prev = this.curRating;
        this.curRating = next;
        this.instance?.$set({ rating: next });
        try {
            await this.plugin.service.setSeriesRating(this.group.key, next);
        } catch {
            // 落库失手 ⇒ 界面退回真实值，并告诉用户没存上（静默失败会让人以为分已经保存）。
            this.curRating = prev;
            this.instance?.$set({ rating: prev });
            new Notice(`「${this.group.title}」的合集分保存失败，请重试`);
            return;
        }
        await this.plugin.refreshViews();
        new Notice(next > 0 ? `已把「${this.group.title}」的合集分设为 ${next} 星` : `已清空「${this.group.title}」的合集分`);
    }

    /**
     * 批量填合集（**覆盖**语义，空串 = 清空）。
     * 🔴 确认弹窗放在这里（不是组件里）：这是覆盖写，组里原来各写各的合集名会被统一成同一个，
     *    且本仓没有撤销栈 ⇒ 把关口前移到动手之前。
     */
    private async doSetCollection(next: string): Promise<void> {
        const ids = this.group.items.map((e) => e.id);
        const ok = await new ConfirmModal(
            this.app,
            `给「${this.group.title}」的 ${ids.length} 部都填上归属合集「${next || '（清空）'}」？原有值会被覆盖。`,
            '继续',
        ).open();
        if (!ok) return;
        await this.plugin.bulkSetCollection(ids, next);
        new Notice(
            next
                ? `已给「${this.group.title}」的 ${ids.length} 部填上归属合集「${next}」`
                : `已清空「${this.group.title}」的归属合集`,
        );
    }

    /**
     * 批量追加标签（**追加**语义，合并去重）。
     * ⚠️ 与合集口径**相反**，⛔ 别把两者写成同一套：合集是单值 ⇒ 覆盖且要确认；标签是多值 ⇒ 追加不弹确认。
     * ⚠️ 切分口径 `/[,，]/`（中英文逗号都认），与 `EntryForm` 同一套。
     */
    private async doAddTags(raw: string): Promise<void> {
        const tags = raw
            .split(/[,，]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        if (tags.length === 0) return;
        const ids = this.group.items.map((e) => e.id);
        await this.plugin.bulkAddTags(ids, tags);
        new Notice(`已给「${this.group.title}」的 ${ids.length} 部追加标签：${tags.join('、')}`);
    }

    /**
     * 保存排序：`orderedIds` = 用户在窗口里拖出来的新顺序。
     * 🔴 编号在纯模块 `planSeriesReindexAll`（只编号、不排序 —— ⛔ 别在这里再排一次，
     *    那会与用户看到的顺序不一致）。落库走 `bulkSetSeriesIndex`（只写 `seriesIndex` 一个字段）。
     * 🔴 回执必须有：折叠卡封面只显示 `×N`、看不到序号，没有 Notice 的话用户点完像没反应。
     */
    private async doReorder(orderedIds: string[]): Promise<void> {
        const pairs = planSeriesReindexAll(orderedIds);
        if (pairs.length === 0) return;
        await this.plugin.bulkSetSeriesIndex(pairs);
        new Notice(`已按顺序重排「${this.group.title}」${pairs.length} 部的序号`);
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
        // 关窗后宿主会把焦点还给打开前的信息栏 ⇒ `:focus-within` 永久命中、封面遮罩不消失。
        // ⛔ 别去改 `:focus-within`（键盘用户靠它看见「打开 ↗」），只归还焦点。
        releaseCardFocusOnClose();
    }
}
