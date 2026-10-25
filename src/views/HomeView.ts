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
        this.component?.$destroy();
        this.component = null;
    }

    async refresh(): Promise<void> {
        await this.render();
    }

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

    private async render(): Promise<void> {
        const [entries, excerptCounts, yearReports, activityLog] = await Promise.all([
            this.plugin.service.list(),
            this.plugin.excerptCounts(),
            this.plugin.listYearReports(),
            this.plugin.listActivity(),
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
            this.component.$set({ entries, tableColumnsByType: resolveTableColumnsByType(this.plugin.settings.tableColumnsByType), colorTheme: this.plugin.settings.colorTheme, uiTheme: normalizeUiTheme(this.plugin.settings.uiTheme), navLayout: normalizeNavLayout(this.plugin.settings.navLayout), defaultViewMode: this.plugin.settings.defaultViewMode, posterDensity: normalizePosterDensity(this.plugin.settings.posterDensity), posterColumns: normalizePosterColumns(this.plugin.settings.posterColumns), ctrlWheelZoom: !!this.plugin.settings.ctrlWheelZoom, statsOrder: normalizeStatsOrder(this.plugin.settings.statsOrder), viewOrder: this.plugin.settings.viewOrder, timelineZoom: this.plugin.settings.timelineZoom, listGrouping: this.plugin.settings.listGrouping !== false, excerptCounts, yearReports, activityLog });
            return;
        }
        this.contentEl.empty();
        this.component = new HomeViewSvelte({
            target: this.contentEl,
            props: {
                entries,
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
                posterUrl: (e: MediaEntry) => this.plugin.resolvePoster(e),
                onAdd: (t?: EntryType, kind?: BookKind) => this.plugin.openAddModal(t, kind),
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
                /** 🔴 #609 折叠卡右键「排序号」：拖拽排序弹窗（落库与 `Notice` 都在宿主侧） */
                onOpenSeriesReorder: (g: SeriesGroup) => this.plugin.openSeriesReorder(g),
                /** 🔴 #629 折叠卡右键「批量关联」：整个系列的逐条关联清单（宿主侧应用级 Modal） */
                onOpenSeriesAssociate: (g: SeriesGroup) => this.plugin.openSeriesAssociate(g),
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
            },
        });
    }

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
