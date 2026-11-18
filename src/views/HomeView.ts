// 统一视图（书架 + 追番表页签）：单 ItemView 承载 HomeView.svelte，页签切换由组件内部完成
import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import HomeViewSvelte from 'views/components/HomeView.svelte';
import { CalendarDayModal } from 'modals/CalendarDayModal';
import { ConfirmModal } from 'modals/ConfirmModal';
import { ImportBangumiModal } from 'modals/ImportBangumiModal';
import type ReelLudicPlugin from '../../main';
import type { MediaStatus } from 'pure/status';
import type { ActivityEvent, BookKind, EntryLogKind, EntryTextKind, EntryType, MediaEntry, UiTheme } from 'data/types';
import type { HomeTab } from './tab';
import type { SeriesGroup } from 'pure/seriesGroup';
import { normalizeUiTheme } from 'pure/themeTokens';
// #541：主导航布局（顶部胶囊 / 左侧侧边栏）—— 归一在 pure 侧，这里只转交
import { normalizeNavLayout } from 'pure/navLayout';
// 🔴 m09565 ①-4：页签分类轴（全类型摊开 / 聚合六枚）—— 归一同样在 pure 侧
import { normalizeTabAxis } from 'pure/homeTabs';
import { normalizePosterDensity, normalizePosterColumns, type PosterDensity } from 'pure/posterGrid';
import { libraryDisplayName } from 'pure/libraryDir';
// 1.3.1 ①：海报墙卡片「显示哪些属性」（高级设置 › 海报墙卡片）
import { resolveCardFieldsByKind, resolveCardFieldsByType } from 'pure/cardMeta';
// 🔴 #657：统计页区块顺序（自由排序 + 自适应；真源在 pure/statsLayout）
import { normalizeStatsOrder, type StatsBlockKey } from 'pure/statsLayout';
import { resolveTableColumnsByType } from 'pure/tableColumns';
import type { FeedRange } from 'pure/activityFeed';
// 🔴 #635 ④：评分看板的评分载荷类型（与存储口径同源）
import type { Rating } from 'pure/rating';
import type { MediaView } from 'pure/mediaViews';
import { applyScrollPref } from 'services/scrollPref';

export const HOME_VIEW_TYPE = 'reelludic-home';

export class HomeView extends ItemView {
    private component: HomeViewSvelte | null = null;
    /** 条目数据源（render 加载后维护，乐观更新也用此引用） */
    private entries: MediaEntry[] = [];

    constructor(leaf: WorkspaceLeaf, private plugin: ReelLudicPlugin) {
        super(leaf);
    }

    getViewType(): string {
        return HOME_VIEW_TYPE;
    }

    getDisplayText(): string {
        // 顶部名称动态跟随「媒体库目录」设置（v0.4 持续优化）；空值回退默认名。
        // 1.1.1：只显示**叶子段**（`3-资源 Resource/媒体库` → `媒体库`）——显示名与存储路径解耦，
        // 否则标签页标题会拖出整条路径（用户 2026-09-27 ①）。
        return libraryDisplayName(this.plugin.settings.libraryDir ?? '');
    }

    getIcon(): string {
        return 'library';
    }

    async onOpen(): Promise<void> {
        await this.render();
    }

    async onClose(): Promise<void> {
        // 🔴 2026-11-27（m06545）：原这里还有 `this.plugin.teardownAiChat()`
        //    （AI 挂件挂在 contentEl 的 `.rl-ai-host` 上，视图关掉必须一起收）。
        //    挂件整体删除后这行也一并删了 —— ⛔ 别补回来。
        this.component?.$destroy();
        this.component = null;
    }

    async refresh(): Promise<void> {
        await this.render();
    }

    /**
     * 🔴🔴 2026-11-26（用户 m04553）：「新视图只能在插件高级设置页里加，首页不显示加按钮」
     *    ⇒ 这里原来的 `handleViewsChange`（首页「＋ 新建视图」的写出口）**整块删除**。
     *    视图的增删改唯一入口 = 设置页「高级 → 分类视图」→ `plugin.setMediaViews()`
     *    （⇒ `EntryService.setViews` ⇒ 写进媒体库 catalog，⛔ 不进 settings）。
     * ⛔ 别因为「首页将来也许要建视图」把它加回来：本视图现在**只读** `views`，
     *    没有调用者的私有方法会被 tsc 的 `noUnusedLocals` 挡下。
     */

    /**
     * 主题切换即时生效（1.0.3）：仅重推 uiTheme prop，不重新读取条目。
     * 与 refresh() 的区别：refresh() 会重新 list() 全量条目 + 摘抄计数 + 年度报告（磁盘 IO），
     * 而主题切换只影响一处结构分支（页签指示器），走全量刷新属于不必要的开销。
     * 组件尚未挂载（视图未打开）时静默跳过——下一次 render() 会带上正确的 uiTheme。
     */
    setUiTheme(theme: UiTheme): void {
        this.component?.$set({ uiTheme: theme });
    }

    /**
     * 海报密度即时生效（用户 2026-09-22）：与 setUiTheme 同思路 —— 只重推几个 prop，不重读条目。
     * 设置页改档位/列数后调用，否则要等下次 refresh() 才看到新密度。
     *
     * 🔴 用户 2026-10-20 删除「海报墙列数」⇒ 形参从 3 个收回 2 个（`wallColumns` 已下线，
     *    ⛔ 别再加回来：设置页没有入口的键，传进来就是鬼开关）。
     */
    setPosterGrid(density: unknown, columns: unknown): void {
        this.component?.$set({
            posterDensity: normalizePosterDensity(density),
            posterColumns: normalizePosterColumns(columns),
            // 🔴 #591：Ctrl+滚轮缩放的开关走**同一条重推通道**（设置页一改就生效，⛔ 不必等下次刷新）。
            //    直接读 settings —— 调用点（`syncPosterGrid` / `applyWallZoom`）本来就从设置取值。
            ctrlWheelZoom: !!this.plugin.settings.ctrlWheelZoom,
        });
    }

    /**
     * #541/#543 主导航布局即时生效（设置页「外观与体验 › 导航布局」改动后调用）。
     * 与 setUiTheme / setPosterGrid 同思路：只重推 prop，不重读条目。
     * 🔴 布局是**结构分支**（图标轨那一支要增删 DOM 节点）⇒ 必须走 `$set`；纯 CSS 变不出新节点。
     * ⚠️ #543 起**不再有 `collapsed` 参数** —— 侧边栏已改成恒定图标轨，折叠钮与折叠态一并退场
     *    （`settings.navCollapsed` 字段按 append-only 红线保留，但不再被读取）。
     */
    setNavLayout(layout: unknown): void {
        this.component?.$set({ navLayout: normalizeNavLayout(layout) });
    }

    /**
     * #541 起始页即时切换（设置页「起始页」改动后调用）：把一个**一次性请求**推给组件。
     * 🔴 为什么不直接 `$set({ initialTab })`：`initialTab` 只在组件**创建**时用来播种内部 `activeTab`，
     *    之后再改这个 prop 不会让任何东西动（它不是响应式的）⇒ 「改了起始页看不到变化」。
     *    走 `requestedTab` 这条**一次性通道**，组件消费掉就置回 null（见 HomeView.svelte 的同名 prop）。
     */
    setRequestedTab(tab: HomeTab): void {
        this.component?.$set({ requestedTab: tab });
    }

    /**
     * 🔴 用户 m09565 ①-4：页签分类轴即时切换（设置页「按全类型分页签」开关改动后调用）。
     *
     * 与 `setNavLayout` 同思路：只重推 prop，不重读条目。**但比它更重** —— 这一档换的是
     * 页签**集合本身**（十枚 ↔ 六枚），不是排版 ⇒ 组件侧必须按 `equivalentTabFor` 折算
     * 当前选中项（见 HomeView.svelte 里的 `@const folded` 那个块）。
     * ⚠️ 别在这里先折算再推 `requestedTab`：那会把「另一条轴记到哪」抢先写成本轴的值。
     */
    setTabAxis(axis: unknown): void {
        this.component?.$set({ tabAxis: normalizeTabAxis(axis) });
    }

    private async render(): Promise<void> {
        const [entries, excerptCounts, yearReports, activityLog, seriesRatings, views] = await Promise.all([
            this.plugin.service.list(),
            this.plugin.excerptCounts(),
            this.plugin.listYearReports(),
            this.plugin.listActivity(),
            // 🔴 系列（合集）评分：与 entries **同一个 Promise.all** 里取（不多开一趟磁盘读）。
            //    它是 catalog 的**顶层字段**（不是条目字段）⇒ 必须单独取一次。
            this.plugin.service.seriesRatings(),
            // 🔴 分类视图（用户 2026-11-23）：同样是 catalog 顶层字段 ⇒ 与上面同一趟里取。
            //    归一器恒返回 ≥1 条（默认视图永远在）⇒ 这里不需要兜底。
            this.plugin.service.views(),
        ]);
        this.entries = entries;
        // 🔴 #630：隐藏插件内滚动条（外观设置）—— 走 `services/scrollPref` 那一处真源（跟随开关）
        applyScrollPref(this.contentEl);
        if (this.component) {
            // 增量更新：保留组件实例与本地状态（当前 Tab/视图模式/筛选），仅刷新数据，立即生效
            // ⚠️ 本条里列出的每个 prop 都必须同步交给 `$set` —— 漏一个就是
            //    「改了设置要重开视图才生效」（#621 的 `tableColumnsByType`、#626 的 `wallColumns`、
            //    #660 的 `statsOrder` 都踩过同一条坑）。
            //    `wallColumns` 已随「海报墙列数」设置项整条下线（用户 2026-10-20），
            //    墙现在和卡片网格共用 `posterColumns` ⇒ 它在这条里就够了。
            // 🔴🔴 #660：`statsOrder` 也踩了同一个坑！拖动改顺序后 `applyStatsOrder` 会调 `refreshViews()`
            //    ⇒ 走到这条**增量**刷新，而这里逐个列出的 prop **没有 statsOrder**
            //    ⇒ 组件里的 `order` 还是旧值 ⇒ **拖完画面纹丝不动**（用户：「按住拖动有变色效果但UI无变动」）。
            //    ⛔ 以后在本条新增任何「响应式 prop」都必须同步加进这里。
            // 🔴🔴 2026-11-09（第 16 轮，用户报「卡片信息栏改动了不正确反映」）：`cardFieldsByType` /
            //    `cardFieldsByKind` 也踩了同一条坑！设置页 `commit()` 落盘后调 `refreshViews()`
            //    ⇒ 走到**这条增量路径**，而这里没列这两个 prop ⇒ 组件里的卡片行序仍是旧值，
            //    表现为「设置里改了、卡片纹丝不动，重开视图才对」。这是 #621 / #626 / #660 / #678 之后**第五次**。
            //    ⚠️ 两个都要传：只传 byType 会让书籍三个子分类格继续吃旧值。
            this.component.$set({ entries, tableColumnsByType: resolveTableColumnsByType(this.plugin.settings.tableColumnsByType), cardFieldsByType: resolveCardFieldsByType(this.plugin.settings.cardFieldsByType), cardFieldsByKind: resolveCardFieldsByKind(this.plugin.settings.cardFieldsByType, this.plugin.settings.cardFieldsByKind), colorTheme: this.plugin.settings.colorTheme, uiTheme: normalizeUiTheme(this.plugin.settings.uiTheme), navLayout: normalizeNavLayout(this.plugin.settings.navLayout), tabAxis: normalizeTabAxis(this.plugin.settings.tabAxis), defaultViewMode: this.plugin.settings.defaultViewMode, posterDensity: normalizePosterDensity(this.plugin.settings.posterDensity), posterColumns: normalizePosterColumns(this.plugin.settings.posterColumns), ctrlWheelZoom: !!this.plugin.settings.ctrlWheelZoom, statsOrder: normalizeStatsOrder(this.plugin.settings.statsOrder), viewOrder: this.plugin.settings.viewOrder, timelineZoom: this.plugin.settings.timelineZoom, listGrouping: this.plugin.settings.listGrouping !== false, unfoldSeries: this.plugin.settings.unfoldSeries === true, excerptCounts, yearReports, activityLog, seriesRatings, views });
            // 🔴 2026-11-27（m06545）：原这里还有 `this.syncAiChatContext()`
            //    （切页签/切视图时把语境推给 AI 挂件）。挂件整体删除后一并删了。
            return;
        }
        this.contentEl.empty();
        this.component = new HomeViewSvelte({
            target: this.contentEl,
            props: {
                entries,
                // 🔴 系列（合集）评分：**初始 props 与增量 `$set` 两处都要传**（#678 那条坑的镜像面）。
                //    漏这里 ⇒ 存档里的合集分永远读不回来（重开 Obsidian 就归零）。
                seriesRatings,
                // 🔴 分类视图（用户 2026-11-23）：**初始 props 与增量 `$set` 两处都要传**。
                //    漏这里 ⇒ 首次挂载拿到空表，「视图切换条」上只剩默认视图（存档里的自定义视图读不回来）。
                //    ⚠️ 这是 #678 那条坑的镜像面，判据同上：新增响应式 prop 两处都加。
                views,
                // 🔴🔴 2026-11-26（用户 m04553）：「新视图只能在插件高级设置页里加，首页不显示加按钮」
                //    ⇒ 2026-11-24 加的那颗首页「＋ 新建视图」及其 `onViewsChange` 写出口**已整体删除**。
                //    ⛔ 别再往这两处传 `onViewsChange`：组件那边已无此 prop，传过去是死参数。
                excerptCounts,
                yearReports,
                activityLog,
                initialTab: this.plugin.homeTab,
                colorTheme: this.plugin.settings.colorTheme,
                // 1.3.1 ①（#617 起按类型各一份）：卡片显示哪几行（六键齐全传下去）。
                // 缺哪一类 ⇒ 走**该类型自己的预填**；老键 `cardFields` 自 #617 追加件起已不参与（见 pure/cardMeta）
                cardFieldsByType: resolveCardFieldsByType(this.plugin.settings.cardFieldsByType),
                // 🔴 #653：书籍**按子分类**（文学 / 网文 / 漫画）各一份 —— 回落链在 `resolveCardFieldsByKind`
                cardFieldsByKind: resolveCardFieldsByKind(
                    this.plugin.settings.cardFieldsByType,
                    this.plugin.settings.cardFieldsByKind,
                ),
                uiTheme: normalizeUiTheme(this.plugin.settings.uiTheme),
                // #541/#543 个性化：主导航布局（缺省 top ⇒ 与 1.2.0 逐像素一致）
                navLayout: normalizeNavLayout(this.plugin.settings.navLayout),
                // 🔴 m09565 ①-4：页签分类轴（初始 props 与增量 `$set` **两处都要传**，判据同 #678）
                tabAxis: normalizeTabAxis(this.plugin.settings.tabAxis),
                // 🔴 #657 统计页区块顺序（自由排序 + 自适应）：归一后传下去；变化时写回设置。
                statsOrder: normalizeStatsOrder(this.plugin.settings.statsOrder),
                onStatsOrderChange: (next: StatsBlockKey[]) => void this.plugin.applyStatsOrder(next),
                // 🔴🔴 #678：viewOrder / timelineZoom / tableColumnsByType **也必须在这份初始 props 里**。
                //    用户 2026-10-19：「切换视图按钮自由排序也无持久化保存」。
                //    真因：这三个键只出现在**增量刷新** this.component.$set({...}) 里，首次挂载
                //    （new HomeViewSvelte({ props })）没传 ⇒ 组件拿到默认值（viewOrder = []），
                //    而组件内 gotHostOrder 闸门会把「这第一个空数组」当成宿主顺序收下 ⇒ 存档里的顺序
                //    **永远读不回来**（拖动当时有效，重开 Obsidian 就还原）。
                //    ⚠️ 这是 #626 / #660 那条坑的镜像面：那时是「$set 漏了」，这里是「初始 props 漏了」。
                //    ⛔ 以后新增任何响应式 prop，两处都要加（判据 _probe_678_props.cjs 盯着）。
                viewOrder: this.plugin.settings.viewOrder,
                timelineZoom: this.plugin.settings.timelineZoom,
                // 🔴 需求 9（用户 2026-10-21）：列表视图「展示分组 / 不并组展示」的**初始口径 + 回推出口**。
                //    `undefined`（老 data.json 没这个键）⇒ 当 `true`（= 升级前的并组观感，⛔ 别默认 false）。
                //    ⚠️ 与上面 #678 那段同一个判据：`listGrouping` 在**增量 $set 与这份初始 props 两处都出现**
                //    （漏 $set = 改了设置要重开视图才生效；漏这里 = 存档读不回来）。
                listGrouping: this.plugin.settings.listGrouping !== false,
                /** 切换口径 ⇒ 宿主落盘 + 刷视图（落盘只走宿主方法，⛔ 组件里不碰 settings） */
                onToggleGrouping: (next: boolean) => void this.plugin.setListGrouping(next),
                // 🔴 m07854 ⑬（2026-11-13）：系列卡摊平的**初始口径 + 回推出口**。
                //    `undefined`（老 data.json 没这个键）⇒ 当 `false`（= 升级前的堆叠观感）。
                //    ⚠️ 与上面那对同一个判据：**初始 props 与增量 $set 两处都必须出现**
                //    （漏 $set = 点了按钮要重开视图才生效；漏这里 = 存档读不回来）。
                unfoldSeries: this.plugin.settings.unfoldSeries === true,
                /** 切换口径 ⇒ 宿主落盘 + 刷视图（落盘只走宿主方法，⛔ 组件里不碰 settings） */
                onToggleUnfoldSeries: (next: boolean) => void this.plugin.setUnfoldSeries(next),
                /**
                 * 🔴 m07854 ⑭：「今天看什么」骰子 ⇒ 宿主弹全屏抽卡。
                 * ⚠️ 这是**动作**不是状态，所以只在初始 props 出现一次即可（无对应设置项，
                 *    也就不存在「$set 漏传」这条坑）；但仍要走宿主方法，⛔ 组件里不 new Modal。
                 * 🔴🔴 **2026-11-13 用户指令**：候选池跟**当前页签**走，只有合并视图才全库。
                 *    ⇒ 组件会传「当前页签 + 当前视图筛过的条目」或 `null`（= 合并视图 ⇒ 全库），
                 *      这里原样转交宿主，⛔ 别在这里判 `navLayout`（判据在组件的 `watchDiceOpen`）。
                 */
                onOpenWhatToWatch: (entries: readonly MediaEntry[] | null) =>
                    this.plugin.openWhatToWatchModal(entries),
                tableColumnsByType: resolveTableColumnsByType(this.plugin.settings.tableColumnsByType),
                defaultViewMode: this.plugin.settings.defaultViewMode,
                posterDensity: normalizePosterDensity(this.plugin.settings.posterDensity),
                posterColumns: normalizePosterColumns(this.plugin.settings.posterColumns),
                // 🔴 用户 2026-10-20 删除「海报墙列数」⇒ 墙与卡片网格共用这一对，⛔ 不再推第二套列数。
                // 🔴 #591 Ctrl+滚轮缩放：开关 + 落盘出口（MediaList 只报告「缩到几列」）
                // 🔴 #626 第 3 参 `view` 只标「缩的是哪个视图」；用户 2026-10-20 删除「海报墙列数」后
                //    两个出口写的是**同一对**共享键（`applyWallZoom` 也写 posterColumns），⛔ 别再分流到第二套键。
                ctrlWheelZoom: !!this.plugin.settings.ctrlWheelZoom,
                onPosterZoom: (density: PosterDensity, columns: number, view: 'grid' | 'wall') =>
                    view === 'wall'
                        ? this.plugin.applyWallZoom(columns)
                        : this.plugin.applyPosterZoom(density, columns),
                onTabChange: (tab: HomeTab) => {
                    this.plugin.homeTab = tab;
                },
                // 🔴 2026-11-27（m06545）：原 `onActiveViewChange` 只服务 AI 挂件的语境推送，已随挂件删除。

                posterUrl: (e: MediaEntry) => this.plugin.resolvePoster(e),
                onAdd: (t?: EntryType, kind?: BookKind, q?: string) => this.plugin.openAddModal(t, kind, q),
                onSelectDay: (dateStr: string) => new CalendarDayModal(this.app, this.plugin, dateStr, this.entries).open(),
                /** 月历拖拽排期：待排卡片拖到日期格 → 设置计划观看日期 */
                onPlanDate: (id: string, dateStr: string) => this.plugin.planEntry(id, dateStr),
                onEditEntry: (id: string) => void this.plugin.openEditModal(id),
                /** #621 表格列配置变更（表头拖序 / 列菜单勾选）⇒ 落盘 + 刷视图 */
                onTableColumnsChange: (type: EntryType, keys: string[]) => void this.plugin.setTableColumns(type, keys),
                /** #621 一格提交 ⇒ 写回条目 + 同步笔记 + 刷视图（解析与 patch 都在组件侧算好） */
                onCellCommit: (id: string, patch: Partial<MediaEntry>) => this.plugin.commitTableCell(id, patch),
                /** #668 视图切换下拉的**自由排序**（拖完落盘 + 刷视图） */
                onViewOrderChange: (order: string[]) => void this.plugin.setViewOrder(order),
                /** #668 时间线自己的 Ctrl+滚轮缩放档（⛔ 不与海报列数共用设置键） */
                onTimelineZoomChange: (zoom: number) => void this.plugin.setTimelineZoom(zoom),
                onOpenEntry: (id: string) => this.plugin.openEntryNote(id),
                onOpenLink: (url: string) => this.plugin.openExternalUrl(url),
                /** 海报墙「观看/播放/启动」按钮：书籍 → 阅读器；游戏 → 启动 .lnk；音乐 → 播放音频；影视 → 单链接直接打开/多链接弹窗选择播放源
                 *  🔴 #444c：分流**下沉到 `plugin.runEntryAction`**（系列选择弹窗也要执行同一件事 —— ⛔ 别两处各写一套分流） */
                onWatch: (e: MediaEntry) => this.plugin.runEntryAction(e),
                /** 折叠卡右下角那枚按钮：打开系列「季列表」弹窗
                 *  🔴 #444c：改成**应用级 Modal**（宿主 `Modal`，与「编辑条目」同构）—— 不再由视图造遮罩 + 绝对定位居中 */
                onOpenSeriesPicker: (g: SeriesGroup) => this.plugin.openSeriesPicker(g),
                /** 🔴 #629 折叠卡右键「批量关联」：整个系列的逐条关联清单（宿主侧应用级 Modal）
                 *  🔴 2026-11-15 m08506 起它是折叠卡右键菜单里**唯一**的一条 —— 改名 / 排序号 /
                 *     批量填合集 / 批量填标签都搬进了「编辑系列属性」窗口，四个独立宿主入口已删除。 */
                onOpenSeriesAssociate: (g: SeriesGroup) => this.plugin.openSeriesAssociate(g),
                /** 🔴 m07813②（用户逐字）：「给系列卡也做一个编辑属性窗口（同时右键菜单的改系列名、
                 *  批量填合集、批量填标签收进编辑系列属性页面内。同单击单卡卡片网格信息栏逻辑一样，
                 *  单击系列卡信息栏也打开编辑属性窗口）」
                 *  🔴 2026-11-15 m08506 用户第二次裁定：「还是将改系列名、排序号、批量填合集、批量填标签
                 *  放进编辑系列属性页面窗口里较好，删除右键菜单和其单独改的入口和页面」
                 *  ⇒ 两个入口（单击信息栏 / 悬停 ⋯ 菜单）都落到这一个方法上。
                 *  ⚠️ 落库全在 `SeriesPropsModal` 里用既有批量原语做（`bulkSetSeriesIndex` /
                 *     `bulkSetCollection` / `bulkAddTags` / `service.update` / `service.setSeriesRating`）
                 *     —— 那三个 Prompt 与 `SeriesReorderModal` 已整体删除，⛔ 别再接线回来。 */
                onOpenSeriesProps: (g: SeriesGroup) => this.plugin.openSeriesProps(g),
                /** 右键「动词 · 去关联」直达：无入口 → 快捷关联弹窗（书/游戏/音乐路径；影视选集网络/本地源） */
                onQuickAssociate: (e: MediaEntry) => this.plugin.quickAssociateEntry(e),
                onDeleteEntry: (id: string) => this.plugin.deleteEntry(id),
                /** 批量删除（多选）：一次 Modal 确认后逐条删（plugin.deleteEntries） */
                onBulkDelete: (ids: string[]) => this.plugin.deleteEntries(ids),
                /** 书籍卡片右键「添加摘抄」：固定挂载该书打开摘抄弹窗 */
                onAddExcerpt: (book: MediaEntry) => this.plugin.openExcerptModal(book),
                /** #685 右键「记录时长 / 记录重温 / 记录周目」：固定挂载该条目打开记录弹窗 */
                onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => this.plugin.openEntryLogModal(e, kind),
                /** #685 右键「添加短评 / 添加攻略」：固定挂载该条目打开文本记录弹窗 */
                onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => this.plugin.openEntryTextModal(e, kind),
                /** 批量评分 / 批量追加标签（🔴 #609：原 `onBulkSeriesIndex` 已撤 —— 系列排序改走排序弹窗） */
                onBulkRating: (ids: string[], rating: number) => this.plugin.bulkSetRating(ids, rating),
                onBulkTags: (ids: string[], tags: string[]) => this.plugin.bulkAddTags(ids, tags),
                /** 批量应用前置确认（批B）：文案由 pure/bulkConfirm 生成，这里只负责弹窗取用户意图 */
                onConfirmBulk: (message: string) => new ConfirmModal(this.app, message, '继续').open(),
                onSetStatus: async (id: string, s: MediaStatus) => {
                    // 乐观更新：先本地 $set（一帧内 ~10ms 反映新状态），再后台落盘；
                    // 成功后用落盘结果（含最新 updatedAt）对齐本地 entries——排序/计数即刻精确，
                    // 不依赖 500ms vault 监听兜底；失败回滚并提示
                    this.applyLocalStatus(id, s);
                    try {
                        const merged = await this.plugin.service.setStatus(id, s);
                        this.applyMergedEntry(merged);
                    } catch (e) {
                        new Notice('状态保存失败：' + (e instanceof Error ? e.message : String(e)));
                        await this.plugin.refreshViews();
                    }
                },
                onMarkUpdated: async (id: string) => {
                    await this.plugin.service.markUpdated(id);
                    await this.plugin.refreshViews();
                },
                /** 网站更新检测：抓观看网址 HTML 提取最新集数（结果 10min 缓存；force=true 跳过缓存供「重新检测」） */
                onCheckUpdate: (url: string, watched: number, force?: boolean) => this.plugin.checkUpdateFor(url, watched, force),
                /** A2 落库：检测到新最新集写回条目（仅落库不重写笔记；失败静默——不影响追更表展示） */
                onSaveLatestKnown: async (id: string, latestEpisode: number) => {
                    try {
                        await this.plugin.service.update(id, { latestKnownEpisode: latestEpisode });
                    } catch {
                        // 落库失败静默：去重基线不持久化，下次进视图重新检测即可
                    }
                },
                /** 追番表「从 Bangumi 导入」：打开导入弹窗（用户 ID 可选，勾选列表逐项导入） */
                onImportBangumi: () => {
                    new ImportBangumiModal(
                        this.app,
                        (userId, types, onProgress) => this.plugin.importBangumiCollections(userId, types, onProgress),
                    ).open();
                },
                /** 排期到期横幅「开始观看」：want→watching（复用状态流转，排期日期保留） */
                onStartWatching: async (id: string) => {
                    try {
                        await this.plugin.service.setStatus(id, 'watching');
                        await this.plugin.refreshViews();
                    } catch (e) {
                        new Notice('状态保存失败：' + (e instanceof Error ? e.message : String(e)));
                    }
                },
                /** 生成年度总结（统计页快捷入口） */
                onGenerateReport: () => this.plugin.generateReport(),
                /** 一键把动态写进当天日记：范围跟随统计页「动态」面板的 日/周/月/年 切换 */
                onRecordJournal: (range: FeedRange) => this.plugin.recordTodayJournal(range),
                /** 打开某份年度报告（统计页「往年报告」入口） */
                onOpenReport: (path: string) => void this.plugin.openReport(path),
                /**
                 * 🔴 #635 ④：评分看板「拖入即改评分」——落库 + 重写笔记 + 刷新视图。
                 * 🔴 复用 `commitTableCell`（同一出口：`update` → `writeNote` → `refreshViews`）——
                 *    ⛔ 别另写一条「只改内存」的近路：那会让笔记里的 frontmatter 与界面不一致。
                 * ⚠️ 失败**向上抛**（组件据它回滚乐观更新并显示红字），⛔ 不在这里静默吞。
                 */
                onSetRating: (id: string, rating: Rating) => this.plugin.commitTableCell(id, { rating }),
                /**
                 * 🔴 用户 2026-10-27 裁定「加合集分」：海报墙/评分看板上给**整个系列**打分。
                 *
                 * 🔴 走 `service.setSeriesRating` 那一条出口（catalog 顶层 `seriesRatings` 字段），
                 *    ⛔ 绝不落到组内某条 `entry.rating` 上 —— 那会把用户手打的单条分抹掉且不可逆。
                 * 🔴 落库后要 `refreshViews()`：评分看板与海报墙都读这份数据，不刷就停在旧值。
                 * ⚠️ 失败**向上抛**（组件据它回滚乐观更新 + 显示红字），⛔ 不在这里静默吞。
                 */
                onSetSeriesRating: async (key: string, rating: Rating) => {
                    await this.plugin.service.setSeriesRating(key, rating);
                    this.plugin.refreshViews();
                },
            },
        });
        // 🔴 2026-11-27（m06545）：原 `syncAiChatContext()` 已随 AI 挂件删除。
    }

    /**
     * 🔴 2026-11-27（m06545）：这里原本有 `syncAiChatContext()` 与 `currentViewIsCollection()`
     * 两个方法 —— 它们只服务 AI 挂件的「语境建议」（用户 m05414）。挂件整体删除后一并删除。
     * ⛔ 别再按「给某个全局小挂件推语境」的思路补回来。
     */

    /** 乐观更新：直接修改本地 entries 并 $set 触发 Svelte 重渲染，用于状态徽标即时变色 */
    private applyLocalStatus(id: string, status: MediaStatus): void {
        if (!this.component) return;
        this.entries = this.entries.map((e) => (e.id === id ? { ...e, status } : e));
        this.component.$set({ entries: this.entries });
    }

    /** 落盘结果对齐：用服务端返回的 merged（含最新 updatedAt/status）替换本地对应条目，保证排序与计数精确同步 */
    private applyMergedEntry(merged: MediaEntry): void {
        if (!this.component) return;
        const idx = this.entries.findIndex((e) => e.id === merged.id);
        if (idx < 0) {
            this.entries = [...this.entries, merged];
        } else {
            this.entries = this.entries.map((e) => (e.id === merged.id ? merged : e));
        }
        this.component.$set({ entries: this.entries });
    }
}
