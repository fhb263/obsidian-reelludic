<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import MediaList from './MediaList.svelte';
    import CalendarBoard from './CalendarBoard.svelte';
    import TrackingBoard from './TrackingBoard.svelte';
    // 🔴 m07854 ⑪ ①：计划页第三档「继续观看 / 阅读」
    import ResumeBoard from './ResumeBoard.svelte';
    import StatsBoard from './StatsBoard.svelte';
    // 🔴 #657：统计页区块顺序的缺省值与类型（真源在 pure/statsLayout）
    import { STATS_BLOCK_DEFAULTS, type StatsBlockKey } from 'pure/statsLayout';
    // #546：导航本体（大字 + 面板 + 键盘）抽成独立组件 —— **两个挂载点共用同一份实现**：
    //   有工具栏的页签经 MediaList 的 `nav-entry` 插槽放进搜索框那一行，计划/统计由本组件包一行。
    import NavMenu from './NavMenu.svelte';
    // 🔴 #550：合并视图那枚「更多」菜单（媒体库 / 追更 / 统计）抽成独立组件 —— 同样**两个挂载点**：
    //   库列表页经工具栏的 `nav-entry` 插槽落在**与搜索框并排的右端**（#552 起）；追更 / 统计页由本组件包一行。
    import MergedPageMenu from './MergedPageMenu.svelte';
    // 🔴 合集视图（2026-11-23）：IP 卡片 → 子系列行 的另一套骨架。
    //    ⚠️ 它**不是** MediaList 的一档：合集视图换的是整页骨架，塞进 MediaList 会让三维筛选/分组/表格列
    //       全部多出一层语义（那边已经 4700 行）。
    import CollectionBoard from './CollectionBoard.svelte';
    // 🔴 2026-11-26（m04109）分类视图切换条抽成**唯一真源组件** `ViewChips`：
    //    用户原话「把顶级分类和搜索框添加条目按钮并排显示」⇒ 这一条不再是首页顶上独立的一行，
    //    而是被塞进两个视图**各自的工具栏行**（默认视图走 MediaList 的 `view-chips` 插槽，
    //    合集视图直接写在 CollectionBoard 的 `.rl-toolbar` 里）。
    //    ⛔ 别在本组件再手写一遍胶囊 DOM —— 那就是「同一概念两份实现」，两边必然漂移。
    import ViewChips from './ViewChips.svelte';
    import type { MergedPage } from 'pure/mergedPages';
    // 🔴 #603：合并视图那块的**读屏名**要用页名真源（原先写死「媒体库」—— 追更 / 统计两页也叫这个名）
    import { mergedPageLabel } from 'pure/mergedPages';
    // #570「回到顶部」的显隐判据 + 「只认本视图滚动容器」的归属判定（纯模块，配单测）
    // 🔴 #624：`shouldShowTop` 不再直接引用 —— 显隐统一走 `topVisible`（它内部就是 `shouldShowTop` + 静止/悬停两条）
    import { topVisible, wrapsRoot, TOP_IDLE_MS } from 'pure/topButton';
    // 🔴 #541：主导航布局的 id 真源（`navLayout` prop 的类型从这里取，⛔ 别手写字面量联合）
    import type { NavLayout } from 'pure/navLayout';
    import { type ColorTheme, type EntryType } from 'data/types';
    import type { ActivityEvent, BookKind, MediaEntry, EntryLogKind, EntryTextKind } from 'data/types';
    // 🔴 `MediaStatus` 的真源在 `pure/status`（`data/types` 只是 import 进来自用，**没有再导出**）。
    //    ⛔ 别改成从 `data/types` 拿：那样 svelte-check 报「declares MediaStatus locally, but it is not exported」，
    //    而 tsc 因为 `include` 不含 `.svelte` 看不见这条错（P1-4 债）。全仓其余 13 处都走 `pure/status`。
    import type { MediaStatus } from 'pure/status';
    // 🔴 #635：评分看板「拖入即改评分」的载荷类型（与存储口径同源 `pure/rating`）
    import type { Rating } from 'pure/rating';
    import type { FeedRange } from 'pure/activityFeed';
    import { MEDIA_TYPES, type HomeTab } from '../tab';
    // 🔴 #541：页签的**顺序 / 显示名 / 图标 / 归一全部来自 `pure/homeTabs`** —— 那是唯一真源
    //    （设置页「起始页」下拉与下面的文字菜单分支都读它）⇒ ⛔ 别在本组件里再留一份 TAB_ORDER / tabLabel / tabIcon。
    import { homeTabIcon, homeTabLabel, resolveVisibleTab, visibleTabs, bookKindOfTab, tabLockType, tabMatchesEntry, equivalentTabFor, tabOrderFor, type TabAxis } from 'pure/homeTabs';
    import { indicatorStyle } from 'pure/themeTokens';
    import { resolveTabKey } from 'pure/tabNav';
    // 🔴 #547 / #550 合并视图：类型那一维的**锁类型**仍在本组件算（`listLockType`），
    //    但那三个下拉本身（选项表 / 文案）已并入 `MediaList` 的筛选行（#550）⇒ 这边只留 `mergedLockType`。
    import { mergedLockType, type MergedScope } from 'pure/mergedScope';
    // 🔴 2026-11-26（m04553）：合集视图左上角要显示「N 个媒体」⇒ 量词必须与主视图 `.rl-libstats` 同源。
    //    ⛔ 别在这里写 `'个'`/`'部'` 字面量 —— 分类量词的真源是 `pure/labels.overviewUnitLabel`。
    import { overviewUnitLabel } from 'pure/labels';
    import type { SortBy } from 'pure/search';
    import { POSTER_COLUMNS_DEFAULT, type PosterDensity } from 'pure/posterGrid';
    // 1.3.1 ①：海报墙卡片显示哪几行（高级设置 › 海报墙卡片）
    import { DEFAULT_CARD_FIELDS_BY_TYPE, type CardFieldKey } from 'pure/cardMeta';
    import { DEFAULT_TABLE_COLUMNS_BY_TYPE } from 'pure/tableColumns';
    import type { SeriesGroup } from 'pure/seriesGroup';
    // 🔴 分类视图（2026-11-23）：模型 / 归一 / 筛选 / IP 聚合**全在 pure/mediaViews** ——
    //    ⛔ 别在本组件里再算一遍「哪些条目进这个视图」（那就是两份口径，必然漂）。
    import {
        DEFAULT_VIEW_ID,
        buildCollectionGroups,
        customViewTagPool,
        filterForView,
        viewBookKindPool,
        viewTypePool,
        visibleViews,
        type MediaView,
    } from 'pure/mediaViews';
    // 🔴 2026-11-26（m05012）：「N 个媒体」的量词在书籍子分类视图下要更具体（本网文 / 本漫画），
    //    量词真源仍是 `pure/bookKind.BOOK_KIND_TOP_UNITS`，⛔ 别在模板里写字面量。
    import { BOOK_KIND_TOP_UNITS } from 'pure/bookKind';
    // ⚠️ 2026-11-26（m04109）：`VIEW_KIND_LABELS` / `isBuiltinView` / `viewIconOf` 三个导入已从这里删除 ——
    //    它们原来只服务本组件内联的胶囊 DOM，现在那段整体搬进了 `ViewChips.svelte`（唯一真源）。
    //    ⛔ 别再加回来：本组件不再自己渲染胶囊，留着只会是「未使用导入」的警告。
    import Icon from './Icon.svelte';

    // Tab 顺序 / 图标 / 显示名：#541 起统一由 `pure/homeTabs` 提供（`HOME_TAB_ORDER` / `homeTabIcon` /
    // `homeTabLabel`）—— 顶部胶囊与左侧侧边栏共用同一份，⛔ 别在这里再定义一遍。

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），书架卡片徽标数据源 */
    export let excerptCounts: Record<string, number> = {};
    export let initialTab: HomeTab = 'media';
    export let onTabChange: (tab: HomeTab) => void = () => {};
    /** 🔴 #632：`onBatchAdd` 已随「批量添加」整体退场（连续添加改走新建条目表单自身的收口） */
    export let onAdd: (t?: EntryType, kind?: BookKind) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    export let onOpenLink: (url: string) => void = () => {};
    /** 主操作按钮（海报墙/列表）：plugin 层按类型分流——影视观看（单/多源）、书籍阅读、游戏启动、音乐播放 */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /** 折叠卡右下角那枚按钮：打开系列「季列表」弹窗
     *  🔴 #444c：宿主侧开的是**应用级 Modal**（`SeriesPickerModal`）—— 视图只负责「报告用户点了哪一组」。 */
    export let onOpenSeriesPicker: (g: SeriesGroup) => void = () => {};
    /** 🔴 #629 折叠卡右键「批量关联」→ 系列逐条关联清单（宿主侧应用级 Modal）
     *  🔴 2026-11-15 m08506 起它是折叠卡右键菜单里**唯一**的一条。 */
    export let onOpenSeriesAssociate: (g: SeriesGroup) => void = () => {};

    /** 🔴 m07813②（用户逐字）：「给系列卡也做一个编辑属性窗口…同单击单卡卡片网格信息栏逻辑一样，
     *  单击系列卡信息栏也打开编辑属性窗口」
     *  🔴 2026-11-15 m08506 用户第二次裁定：「还是将改系列名、排序号、批量填合集、批量填标签
     *  放进编辑系列属性页面窗口里较好，删除右键菜单和其单独改的入口和页面」
     *  ⇒ 两个入口（单击信息栏 / 悬停 ⋯ 菜单）都落到这一个 prop 上。
     *  ⚠️ 纯透传给 `MediaList`，组件本身不落库（只报「点了哪一组」）。 */
    export let onOpenSeriesProps: (g: SeriesGroup) => void = () => {};
    /** 右键「动词 · 去关联」直达快捷关联弹窗（无入口时主操作不再跳整编辑表单） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onSetStatus: (id: string, s: MediaStatus) => Promise<void> = async () => {};
    export let onMarkUpdated: (id: string) => Promise<void> = async () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};
    /** 批量删除（多选）：一次确认后逐条删（plugin.deleteEntries） */
    export let onBulkDelete: (ids: string[]) => Promise<void> = async () => {};
    /** 书籍卡片右键「添加摘抄」：固定挂载该书打开摘抄弹窗 */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** #685 右键「记录时长 / 记录重温 / 记录周目」：固定挂载该条目打开记录弹窗 */
    export let onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => void = () => {};
    /** #685 右键「添加短评 / 添加攻略」：固定挂载该条目打开文本记录弹窗 */
    export let onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => void = () => {};
    /** 批量设置个人评分 */
    export let onBulkRating: (ids: string[], rating: number) => Promise<void> = async () => {};
    /** 批量追加标签 */
    export let onBulkTags: (ids: string[], tags: string[]) => Promise<void> = async () => {};
    /** 批量应用前置确认（HomeView.ts 层创建 ConfirmModal，返回 false = 用户取消） */
    export let onConfirmBulk: (message: string) => Promise<boolean> = async () => true;
    /** 网站更新检测（追更表）：抓观看网址 HTML 提取最新集数；force=true 跳过缓存（「重新检测」用） */
    export let onCheckUpdate: (url: string, watched: number, force?: boolean) => Promise<import('pure/updateCheck').UpdateCheckResult | null> = async () => null;
    /** A2 落库：追更检测到新最新集时写回条目（去重基线） */
    export let onSaveLatestKnown: (id: string, latestEpisode: number) => Promise<void> = async () => {};
    /** 追番表「从 Bangumi 导入」：打开导入弹窗（HomeView.ts 层创建 Modal） */
    export let onImportBangumi: () => void = () => {};
    /** 排期到期横幅「开始观看」：want→watching */
    export let onStartWatching: (id: string) => Promise<void> = async () => {};
    /** 生成年度总结（统计页快捷入口） */
    export let onGenerateReport: () => Promise<void> = async () => {};
    /** 已生成的往年年度报告（年份降序），统计页「往年报告」入口数据源 */
    export let yearReports: { year: number; path: string }[] = [];
    /** 活动日志（状态翻转）：统计页「今日」面板数据源 */
    export let activityLog: ActivityEvent[] = [];
    /**
     * 🔴 系列（合集）评分（用户 2026-10-27 裁定「加合集分」）：`分组键 → 0~5`。
     *    键 = `pure/seriesGroup.seriesKeyOf` 产出的 `type\u0001归一化名`。
     * ⚠️ 它是 catalog 的**顶层字段**，不挂在任何条目上 ⇒ 必须由宿主单独取一次再传进来
     *    （`HomeView.ts` 的 `render()` 已并进 `Promise.all`，初始 props 与增量 `$set` 两处都传）。
     * ⛔ 别在这里「算」合集分：整个系列的分数是**用户直接打的**，不是组内单条分的平均
     *    （真实数据组内分歧极大，平均会被未评分条目稀释成一个谁也不认得的数）。
     */
    export let seriesRatings: Record<string, number> = {};
    /** 写某个系列的合集分（宿主落盘 + 刷视图；组件只报告，不碰磁盘） */
    export let onSetSeriesRating: (key: string, rating: Rating) => Promise<void> = async () => {};
    /**
     * 🔴 分类视图（用户 2026-11-23 裁定「视图存进媒体库，跟库走」）。
     *
     * 三档（真源 `pure/mediaViews`）：
     *   · `default`    默认视图 = **物本位**：现在这套分类胶囊栏原样不动。
     *   · `collection` 合集视图 = 先出 IP 卡片，点进去才展开子系列行。
     *   · `custom`     自定义视图 = **事本位**：按标签筛选（如「工作」「日常」）。
     *
     * ⚠️ 与 `seriesRatings` 同构：它是 catalog 的**顶层字段**，宿主单独取一次再传进来
     *    （`HomeView.ts` 的 `render()` 已并进 `Promise.all`，初始 props 与增量 `$set` 两处都传）。
     * 🔴 归一器恒返回 ≥1 条且默认视图恒在 index 0 ⇒ ⛔ 这边别写「空数组就兜底」的第二套逻辑。
     */
    export let views: MediaView[] = [];
    /**
     * 🔴 2026-11-27（m06545）：原 `onActiveViewChange` 只用于「切档后把语境推给 AI 挂件」
     *    （用户 m05414）。挂件整体删除 ⇒ 这个回调与 `pickView()` 的转发一并删除，
     *    视图切换回到最朴素的 `activeViewId = id`。
     * ⛔ 别再为「给某个全局小挂件推状态」把它补回来。
     */
    /**
     * 🔴🔴 2026-11-26（用户 m04553）：「新视图只能在插件高级设置页里加，首页不显示加按钮」
     *    ⇒ 原来那个 `onViewsChange` 写出口**已删除**：它唯一的使用者是首页「＋ 新建视图」，
     *       而那颗按钮没了 ⇒ 本组件**只读** `views`，不再回写。
     *    ⛔ 别因为「留着也许有用」把它加回来 —— 没有调用者的 `export let` 会触发
     *       `unused export property` 警告并顶破 89 条基线（本仓踩过）。
     *    视图的增删改一律走设置页 → `plugin.setMediaViews()`（宿主 `main.ts` 那条唯一写出口）。
     */
    /** 一键把动态写进当天日记（范围跟随面板的 日/周/月/年 切换） */
    export let onRecordJournal: (range: FeedRange) => Promise<void> = async () => {};
    /** 打开某份年度报告（统计页「往年报告」入口） */
    export let onOpenReport: (path: string) => void = () => {};
    /** 点击月历某天：HomeView 层打开当天详情弹窗 */
    export let onSelectDay: (dateStr: string) => void = () => {};
    /** 月历拖拽排期：待排卡片拖到日期格 → 设置计划观看日期 */
    export let onPlanDate: (id: string, dateStr: string) => Promise<void> = async () => {};
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    /** 色彩主题（设置页配置）：彩色显示类型色条 / 单色关闭 */
    export let colorTheme: ColorTheme = 'colorful';
    /** 1.3.1 ①：海报墙卡片显示哪几行（高级设置 › 海报墙卡片）。
     *  🔴 #617 起**按条目类型各一份**（六键齐全）；缺省 = 三类全显（与 1.3.1 前一致） */
    export let cardFieldsByType: Record<EntryType, CardFieldKey[]> = DEFAULT_CARD_FIELDS_BY_TYPE;
    /** 🔴 #653：书籍**按子分类**（文学 / 网文 / 漫画）各一份的信息栏，只对书籍生效。
     *  ⚠️ 这个 prop 曾经**漏声明**（`HomeView.ts` 传了，本组件没有 `export let`）——
     *     Svelte 4 对「多传的 prop」**静默忽略**（与 L558 记的 #659 是同一类坑），后果是
     *     用户在设置页给网文 / 漫画单独配的信息栏**完全不生效**，且零报错、零警告。
     *     ⛔ 别再让它只存在于宿主的 props 字面量里：改 prop 名/增删时必须两侧同步。
     *  缺省 = 三个子类都等于书籍那一份（回落链在 `pure/cardMeta.resolveCardFieldsByKind`）。 */
    export let cardFieldsByKind: Record<BookKind, CardFieldKey[]> = {
        book: DEFAULT_CARD_FIELDS_BY_TYPE.book,
        novel: DEFAULT_CARD_FIELDS_BY_TYPE.book,
        comic: DEFAULT_CARD_FIELDS_BY_TYPE.book,
    };
    /** 1.3.1 ②（#621）表格视图的列（按类型各一份；六键齐全，宿主已归一） */
    export let tableColumnsByType: Record<EntryType, string[]> = DEFAULT_TABLE_COLUMNS_BY_TYPE;
    /** 列配置变更（表头拖序 / 列菜单勾选）⇒ 回推宿主落盘 */
    export let onTableColumnsChange: (type: EntryType, keys: string[]) => void = () => {};
    /** 表格格子提交 ⇒ 宿主写回条目 + 笔记 + 刷新视图 */
    export let onCellCommit: (id: string, patch: Partial<MediaEntry>) => Promise<void> = async () => {};
    /**
     * 🔴 #668 用户：「切换视图按钮也支持**自由排序并持久化**」。
     * 顺序原样传给 `MediaList`（⛔ 两处不各归一一次），归一只在 `pure/viewModes.normalizeViewOrder`。
     */
    export let viewOrder: string[] = [];
    /** 拖完 ⇒ 宿主落盘 + 刷视图 */
    export let onViewOrderChange: (order: string[]) => void = () => {};
    /** 🔴 #668：时间线自己的缩放档（⛔ 与海报列数**分开存**，见设置里那条注释） */
    export let timelineZoom: number = 3;
    /** 时间线缩放 ⇒ 宿主落盘 + 刷视图 */
    export let onTimelineZoomChange: (zoom: number) => void = () => {};
    /**
     * 🔴 需求 9（用户 2026-10-21）：**列表视图**「展示分组 / 不并组展示」的单循环口径。
     *  `true`（含缺省 = 老库没这个键）= 展示分组（同系列折成合集行、可展开）；`false` = 不并组展示（每条独立一行）。
     *  ⚠️ 只作用于列表视图 —— 海报墙 / 卡片网格 / 瀑布流 / 时间线的排布与行为一律不变。
     */
    export let listGrouping = true;
    /**
     * 上面那枚切换按钮的回推出口（受控口径：值与落盘都归宿主，⛔ 组件不自己存设置）。
     * ⚠️ `null` = 宿主没接线 ⇒ `MediaList` 里**整枚按钮不渲染**（不画点了没反应的按钮）。
     */
    export let onToggleGrouping: ((next: boolean) => void) | null = null;
    /**
     * 🔴 m07854 ⑬（2026-11-13）**系列卡是否摊平**（视图切换下拉左旁那枚循环按钮）。
     * `true` = 全部单卡平铺；`false`/缺省 = 系列卡堆叠。
     * ⚠️ 与上面的 `listGrouping` **是两件事**：后者管列表视图的行形态，本字段管卡片网格 / 海报墙的系列折叠卡。
     * ⚠️ 缺省 `false`：设置里 `undefined` 也当「堆叠」（老库没这个键 ⇒ 观感与升级前一致）。
     */
    export let unfoldSeries = false;
    /** 上面那枚按钮的回推出口（`null` = 宿主没接线 ⇒ `MediaList` 里整枚不渲染） */
    export let onToggleUnfoldSeries: ((next: boolean) => void) | null = null;
    /**
     * 🔴 m07854 ⑭：「今天看什么」骰子的回推出口（`null` = 没接线 ⇒ 两处搜索框里都不画那枚按钮）。
     *
     * 🔴🔴 **2026-11-13 用户指令（本批反转了⑭的候选池口径）**，原话：
     *    「在对应的页签下的随机看一部应该是当前类型的随机出来而不是全部类型混在一起
     *     （只有当导航布局为合并视图时随机看一部才是全库中挑）」
     *    ⇒ 出口签名带上候选池：普通布局传 `listEntries`（**当前页签 + 当前视图**筛过的那份），
     *      合并视图传 `null` 让宿主回退全库。⛔ 别在这里自己判 `mergedOn` 之后又传全量 ——
     *      判据只有一处（下面的 `watchDiceOpen`），两处各判必然漂移。
     */
    export let onOpenWhatToWatch: ((entries: readonly MediaEntry[] | null) => void) | null = null;
    /**
     * 🔴 #635 ④：评分看板「拖入即改评分」⇒ 宿主写回条目 + 笔记 + 刷新视图。
     * ⚠️ 与 `onCellCommit` **分开**（那是通用 patch、这是评分专用）：看板要的是「明确的评分数」，
     *    复用一个泛 patch 通道会让「拖错了怎么办」的失败回滚判据失去抓手。
     */
    export let onSetRating: (id: string, rating: Rating) => Promise<void> = async () => {};
    /**
     * 界面主题（1.0.3）：native 原生（默认，页签保持 1.0.2 下划线形态）/
     * modern 现代（分段控件 + 滑动指示器；图标两主题恒渲染——2026-09-12 用户裁定恢复）。
     * 默认值取 'native' 而非从 colorTheme 推导——必须与 Settings 的 DEFAULT_SETTINGS 一致，
     * 且与 normalizeUiTheme 的兜底值相同，避免「设置缺失」时落进现代主题。
     */
    export let uiTheme: 'native' | 'modern' = 'native';
    /**
     * 🔴 #541 主导航布局：`'top'` 顶部横向胶囊（默认 = 1.2.0 观感）/ `'sidebar'` **文字菜单**
     * （内容区右上角一行当前页名，hover 从它正下方展开页签列表；#545 定形）/ `'merged'` 合并视图（#547）。
     * ⚠️ 与 `uiTheme` **正交** —— 后者管顶部胶囊「长什么样」（下划线 vs 描边指示器），本 prop 管导航「排在哪」。
     * ⚠️ 整块都在**同一个视图内**（视图仍是同一个 ItemView），⛔ 与 Obsidian 工作区侧栏无关。
     * ⚠️ id `'sidebar'` 是**存量数据里的值**（旧 data.json 存过它）⇒ 只改文案，⛔ 别改 id（见 `pure/navLayout`）。
     * 🔴 类型直接取 `NavLayout`（真源 `pure/navLayout`），⛔ 别在这里手写 `'top' | 'sidebar'` ——
     *    漏掉 `'merged'` 时下面 `navLayout === 'merged'` 会被 TS 判成「两个类型没有重叠」的恒假比较，
     *    而 `HomeView.ts` 推 `normalizeNavLayout()` 的返回值又塞不进来（P1-4 债，svelte-check 4 条错）。
     */
    export let navLayout: NavLayout = 'top';
    /**
     * 🔴 #541 起始页的**一次性请求**：设置页改了「起始页」后宿主推一个新值进来，本组件消费掉就置回 null。
     * ⚠️ 为什么不复用 `initialTab`：那个 prop 只在**创建时**播种 `activeTab`，之后再改它不会让任何东西动
     *    （症状 = 「改了起始页看不到变化」）；而这里要的正是「当场切过去」。
     * ⚠️ 置回 null 是**必须**的：下面那个响应式块依赖本变量，不置回的话「用户手动切到别的页签」会被它
     *    立刻纠正回请求值（页签自己弹回去）。
     */
    export let requestedTab: HomeTab | null = null;
    /**
     * 页签分类轴（用户 m09565 ①-4）：`expanded` = 全类型摊开十枚 / `classic` = 聚合六枚。
     * 缺省 `expanded` ⇒ 与 2026-11-08 起的行为逐项一致（⛔ 别把缺省改成 classic，那是升级即换脸）。
     * ⚠️ 改这个值会**换掉页签集合**（不是只换排版）⇒ 当前 `activeTab` 很可能在新集合里不存在，
     *    必须靠 `setTabAxis()` 那条通道折到就近页签（见下方 `onTabAxis` 的消费块）。
     */
    export let tabAxis: TabAxis = 'expanded';
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 海报密度（设置页配置，pure/posterGrid 归一）：紧凑 / 标准 / 宽松 / 自定义列数 */
    export let posterDensity: PosterDensity = 'standard';
    /** 自定义列数的目标列数（仅 posterDensity === 'custom' 生效；实际列数仍由容器宽度决定） */
    export let posterColumns: number = POSTER_COLUMNS_DEFAULT;
    /**
     * 🔴 用户 2026-10-20 删除「海报墙列数」⇒ 墙**没有第二套列数**了，与卡片网格共用 `posterColumns`。
     *    （原 #626 的 `wallColumns` prop 已随之整条下线，⛔ 别再补回来。）
     */
    /** 🔴 #591 媒体库内 Ctrl+滚轮缩放开关（设置页配置；缺省关 —— 要接管系统手势） */
    export let ctrlWheelZoom: boolean = false;
    /** 🔴 #657 统计页区块顺序（`settings.statsOrder` 归一后的值；缺省 = 原视觉顺序）。 */
    export let statsOrder: StatsBlockKey[] = [...STATS_BLOCK_DEFAULTS];
    /** 🔴 #657 顺序变化 → 宿主落盘（与缺省一致时宿主会删键）。 */
    export let onStatsOrderChange: (next: StatsBlockKey[]) => void = () => {};
    /**
     * 🔴 #591 缩放**回推出口**：MediaList 只报告「缩到几列 + 哪个视图」，落盘与重推由宿主承担。
     * 🔴 #626 第 3 参 `view`：`grid` / `wall` —— 用户 2026-10-20 删除「海报墙列数」后
     *    两条路写的是**同一对**共享键（`applyWallZoom` 也只写 posterColumns），
     *    这个参数只剩「标明缩的是哪个视图」的语义，⛔ 别再拿它分流到第二套列数键。
     */
    export let onPosterZoom: (density: PosterDensity, columns: number, view: 'grid' | 'wall') => void = () => {};

    let activeTab: HomeTab = initialTab;
    /** 计划页签视图：追更表 / 月历 */
    let trackingMode: 'board' | 'calendar' | 'resume' = 'board';

    /**
     * 🔴 当前选中的分类视图（用户 2026-11-23）。
     *
     * ⚠️ 选中的是 **id 不是对象**：视图改名/改标签后 id 不变，选中态才不会莫名跳回默认。
     * ⚠️ 存档里那张表被删到不含这个 id（设置页删了当前视图）时，**不回写 `activeViewId`** ——
     *    真实态由 `activeView` 兜底（落到 `views[0]` = 默认视图），高亮判据也读 `activeView.id`。
     *    ⛔ 别再「顺手纠正 activeViewId」：那会构成 `activeView → activeViewId → activeView` 的
     *    响应式环（svelte-check: Cyclical dependency detected），编译期就红。
     */
    let activeViewId: string = DEFAULT_VIEW_ID;

    /**
     * 首页真正露出来的那几条（🔴 **唯一**的「哪些视图上首页」判断，见 `visibleViews`）。
     *
     * 🔴🔴 2026-11-15 用户 m05159 问题二（逐字）：
     *    「保存分类视图配置后，首页应自动切换为已勾选视图，且只展示已启用视图，
     *      **不显示未启用的「默认视图」选项及相关文案**。」
     *    ⇒ 这条**推翻了** 2026-11-25 那条「当前选中要破例留着」的兜底。
     *       原兜底的理由是「别在用户脚下抽地毯」，但代价正是用户这次报的毛病：
     *       设置页明明取消了勾选，首页那条选项还在，看起来像没保存。
     *       现在的取舍：**配置说了算** —— 取消勾选就从首页消失，选中态由下面的
     *       `activeView` 自动落到「仍然启用的那一条」上。
     * ⛔ 别再把 `activeView` 拼回这个数组（那就是回来一半的抽地毯）。
     */
    $: shownViews = visibleViews(views);

    /**
     * 当前视图对象。
     *
     * 三条兜底，顺序不能变：
     *   ① 选中的那条**仍在启用列表里** ⇒ 用它（用户的选择优先，哪怕它不在第一位）；
     *   ② 选中那条被取消勾选了 / 被删了 ⇒ 落到**第一条启用视图**（这就是用户要的
     *      「保存配置后首页自动切换为已勾选视图」）；
     *   ③ 一条启用的都没有（理论不可能：问题一已拦住「全部取消」；但仍要防脏数据 /
     *      旧存档）⇒ `views[0]`，归一器保证它是默认视图。
     * ⚠️ 依赖方向是 `shownViews → activeView`（单向），⛔ 别让它反过来读 `activeView`，
     *    否则就是 svelte-check 的 Cyclical dependency。
     */
    $: activeView = shownViews.find((v) => v.id === activeViewId) ?? shownViews[0] ?? views[0];

    /** 是否处于「合集视图」（= IP 聚合，走 `CollectionBoard`，⛔ 不进 MediaList） */
    $: viewIsCollection = activeView?.kind === 'collection';

    /**
     * 视图过滤后的条目（**唯一一处**过滤出口）。
     *
     * 🔴 默认视图**不过滤**（`filterForView` 对它也只按 `types` 过滤，而默认视图 types 恒空
     *    ⇒ 原样返回）—— 这一步不能省，但它对默认视图是恒等变换，所以现有行为零风险。
     * ⚠️ 在 `listEntries` **之前**接：视图是「库 → 视图」的第一道筛，
     *    后面页签/合并视图那套三维筛选照旧在 MediaList 内部跑（两层是**叠加**关系）。
     */
    $: viewEntries = activeView ? filterForView(entries, activeView) : entries;
    /**
     * 统计页词云要**整体排除**的标签 = 所有自定义视图的归属标签并集。
     *
     * 🔴 2026-11-16 用户逐字：「如果按标签归属自定义视图（如日常、工作），那标签词云统计的
     *    如工作、日常标签怎么办这些不是正常的标签」⇒ 这些是「视图归属键」，不是兴趣标签。
     * ⚠️ 取 **`views`（全部视图）而不是 `activeView`**：词云统计的是整库长期画像，
     *    跟用户此刻停在哪一档无关；按当前视图算 ⇒ 切一下视图词云就变一批词，那是 bug 不是特性。
     * ⚠️ 排除发生在 `pure/wordCloud.buildWordCloud` 内部（第三参），⛔ 不在这里过滤条目 ——
     *    条目该不该进视图是 `filterForView` 的事，两者是正交的两件筛法。
     */
    $: cloudDiscardTags = customViewTagPool(views);
    /** 合集视图的 IP 分组（⛔ 别在模板里 map —— 卡片顺序/行顺序全在 `buildCollectionGroups` 定） */
    $: collectionGroups = viewIsCollection ? buildCollectionGroups(viewEntries) : [];
    /**
     * 当前视图的**类型白名单**（`null` = 不限制）。
     * 🔴 名字带 `ViewPool` 而不是 `viewTypePool`：后者是 `pure/mediaViews` 的函数名，重名会把它遮住。
     */
    $: activeViewPool = activeView ? viewTypePool(activeView) : null;
    /** 当前视图的**书籍子分类白名单**（`null` = 不限制）。必须先于 `navTabs` 声明/被它依赖。 */
    $: activeViewBookKinds = activeView ? viewBookKindPool(activeView) : null;
    /**
     * 🔴 #727 顶部胶囊 / 文字菜单**实际渲染哪几枚页签**。
     *
     * 用户裁定（2026-11-08）：「在设置新自定义视图勾选类型，然后其他不勾选的不展示出来」，
     * 映射规则选定为「类型页签按勾选过滤，计划 / 统计常驻」。
     *
     * 🔴 2026-11-08（用户 m03712）第二轮：「页签要把所有类型摊开」⇒ 文学 / 网文 / 漫画
     *    三枚子分类页签也要按视图勾的子分类过滤，故第二参传 `activeViewBookKinds`。
     *
     * ⚠️ 判据用 `activeViewPool`（视图那维），⛔ 不用 `listTypePoolMerged` —— 后者已经把
     *    页签那维也乘进去了，再用它过滤页签会形成**自指**：切到「阅读」页签后池子只剩 book，
     *    于是「影视/游戏/音乐」当场消失，用户再也切不回去。
     * ⚠️ 必须与渲染、键盘导航**共用这一份**（`onTabKeydown` 也用它）；
     *    否则 ←/→ 会按旧顺序数下标、焦点落到不存在的按钮上。
     * ⚠️ 合并视图那一档不渲染页签，但这个值仍然安全（它只做减法，不影响内容区）。
     */
    $: navTabs = visibleTabs(activeViewPool, activeViewBookKinds, tabAxis);
    /**
     * 🔴 用户 m09565 ①-4：换分类轴时把当前页签**就近折算**过去。
     *
     * 两种轴不是子集关系（classic 有聚合 `book`/`media`，expanded 有书籍三子分类 + 影视三型）
     * ⇒ 换轴后 `activeTab` 很可能在新集合里不存在。若放任下面那条 `resolveVisibleTab` 兜底，
     * 它会落到**第一枚**（= 计划），用户从「电影」切过去会莫名跳到追更表 —— 那不是「保持位置」。
     * ⇒ 这里先用 `equivalentTabFor` 按语义折（电影/剧集/动画 → 影视；文学/网文/漫画 → 阅读），
     *    再交给下面那条通用纠偏处理「折过去但被视图类型池过滤掉」的情况。
     * ⚠️ 判据只在这一条块里做，⛔ 别把 `equivalentTabFor` 塞进 `resolveVisibleTab`：
     *    那个纯函数按设计「不可见就落第一枚」，掺进语义折算会让它承担两种职责。
     */
    $: {
        const folded = equivalentTabFor(tabAxis, activeTab);
        // 🔴🔴 用户 m09565 ①-4「两种模式的导航状态要独立保存」——**这里绝不能调 `switchTab`**。
        //    真机实测（2026-11-12）踩到的第二个缺陷：切回聚合轴时视图停在「影视」，
        //    且 `homeTabByAxis.classic` 被从 `'game'` 覆盖成 `'media'` —— 正是丢弃了用户的位置。
        //    根因：`switchTab` 会走 `onTabChange` → `plugin.homeTab = t` → 写进**当前轴**那一格，
        //    于是「折算」这个纯展示动作反倒篡改了记忆。
        //    ⇒ 折算只动本地 `activeTab`；轴记忆由 `main.ts syncTabAxis` 推 `requestedTab` 决定。
        if (folded !== activeTab) activeTab = folded;
    }
    /**
     * 🔴 #727 当前页签被过滤掉了 ⇒ 自动落到第一枚可见页签。
     *  典型场景：用户停在「游戏」页签，然后切到一个只收影视的视图 —— 游戏页签消失，
     *  若不兜底，内容区会继续渲染「游戏」的空列表，而顶部没有任何按钮处于选中态（看起来像卡死）。
     *  ⚠️ 只在真的不可见时才切（`resolveVisibleTab` 可见时原样返回）⇒ 不会打断正常点击。
     *  ⚠️ 用 `switchTab` 而非直接赋值：那两条出口（React 侧 `onTabChange`）要保持一致；
     *     它只写内存字段，⛔ 不碰 `settings.startTab`（起始页是用户的设置，不该被自动切页改写）。
     */
    $: {
        const fixed = resolveVisibleTab(navTabs, activeTab);
        if (fixed !== activeTab) switchTab(fixed);
    }
    /**
     * 合集视图左上角「N 个媒体」的量词。
     *
     * 🔴 2026-11-26（m05012）之后视图可能只收书籍的**某个子分类**
     *    （`bookKinds: ['novel']`）⇒ 量词必须是「本网文」而不是「本书」。
     *    所以先取书子分类池，再退化到「类型池恰好只剩一种」时用该类型的量词。
     * ⚠️ 顺序不能颠倒：子分类比主类型更具体，反了会让「网文视图」显示成「本书」。
     * ⚠️ `activeViewBookKinds` 的声明已上移到 `navTabs` 之前（页签过滤要先用到它），
     *    ⛔ 别在这里再写一条 —— 同一个 `$:` 声明两次，Svelte 编译能过但语义只剩后一条。
     */
    $: viewUnit = (() => {
        const kinds = activeViewBookKinds;
        if (kinds && kinds.length === 1) return BOOK_KIND_TOP_UNITS[kinds[0]];
        const pool = activeViewPool;
        return overviewUnitLabel(pool && pool.length === 1 ? pool[0] : null);
    })();

    /**
     * 🔴🔴 2026-11-26（用户 m04553）逐字：「新视图只能在插件高级设置页里加，首页不显示加按钮」
     *    ⇒ 原来这里那条 `addView()`（＋ 新建视图）**整块删除**，连 `viewAddDisabled` 一起。
     *    建视图的唯一入口 = 设置页「高级 → 分类视图 → + 新建自定义视图」。
     *    ⛔ 别把它加回来：首页是「用视图」的地方，不是「配视图」的地方 ——
     *       用户点一下就在库里多一条空视图、还得再去设置页配标签，那条链路本来就走不通。
     *    ⚠️ 因此 `MAX_VIEWS` / `createView` / `nextViewId` 三个导入也从本文件移除了
     *       （它们只服务那条已删的函数；留着是「未使用导入」）。
     */

    /**
     * 当前页签**有没有「搜索框那一行」**（= 是否由 `MediaList` 承载）。
     * 🔴 #546 导航入口的挂载点由它决定：有工具栏 ⇒ 经插槽放进搜索框那一行右端；
     *    没有（计划 / 统计）⇒ 本组件渲染成靠右的独立一行。二者是**同一个 `NavMenu`**。
     * ⚠️ 必须跟着 `MediaList` 的承载范围走（下面模板里那两个分支），⛔ 别按「是不是媒体类型」另做判断。
     */
    $: hasToolbar = activeTab !== 'tracking' && activeTab !== 'stats';

    /**
     * 🔴 #547 合并视图（第三档导航布局）：**取消分类页签**，改由顶端一行筛选栏导航 ——
     *    `[媒体类型 ▾] [状态 ▾] [排序 ▾]` ＋ 右端两枚图标按钮（追更 / 统计）。
     *
     * 🔴 三个筛选的**真源就在本组件**（`mergedScope` / `mergedStatus` / `mergedSort`），
     *    经受控 props 推给 `MediaList` —— ⛔ 别让两边各存一份（那就是同一件事两个真相，必然漂移）。
     *    类型那一维推两条：`lockType`（由 `pure/mergedScope.mergedLockType` 算）+ `scope`（供它同步书籍子分类）。
     * 🔴 追更 / 统计**降级为图标按钮**（用户原话），点击进入；**再点一次回到库列表** ——
     *    所以这两枚是「互斥的三态之一」，不是单向上跳。
     * ⚠️ 这一档下「起始页」设置不适用（那 6 个页签已不存在）：合并视图恒从**库列表**开始。
     */
    let mergedPage: MergedPage = 'library';
    let mergedScope: MergedScope = 'all';
    let mergedStatus: MediaStatus | 'all' = 'all';
    let mergedSort: SortBy = 'recent';

    /** 合并视图下「当前该显示哪一页」—— 把两种导航统一成一个值，模板里只写一次三分支 */
    $: mergedOn = navLayout === 'merged';
    $: effPage = mergedOn
        ? mergedPage
        : (activeTab === 'tracking' ? 'tracking' : activeTab === 'stats' ? 'stats' : 'library');
    /**
     * 🔴 2026-11-08（用户 m03712）摊开页签后，当前页签要翻译成 `MediaList` 的三件受控参数：
     *    · 普通类型页签（movie/tv/anime/game/music）⇒ `lockType = 该类型`
     *    · 书籍子分类页签（`kind:book` / `kind:novel` / `kind:comic`）⇒ `lockType = 'book'`
     *      **且** `lockKind = 该子分类`（子分类这一维宿主以前碰不到，本批新增通道）
     *    · 非条目页签（计划 / 统计）⇒ 不锁（它们压根不渲染 MediaList）
     *    ⚠️ `bookKindOfTab` 是子分类唯一的翻译入口，⛔ 别在这里手写 `startsWith('kind:')`。
     */
    $: tabKind = bookKindOfTab(activeTab);
    $: listLockType = mergedOn
        ? mergedLockType(mergedScope)
        : tabLockType(activeTab);
    /** 传给 `MediaList` 的书籍子分类锁（`null` = 不锁，见组件里 `lockKind` 的注释） */
    $: listLockKind = mergedOn ? null : tabKind;
    $: listTypePool = mergedOn ? null : activeTab === 'media' ? MEDIA_TYPES : null;
    /**
     * 🔴 分类视图（2026-11-23）与页签那一维**取交集** —— 二者是独立维度，但 MediaList 只收一个 `typePool`。
     *
     * · 视图没配类型（默认视图 / 合集视图）⇒ `activeViewPool` 为 null ⇒ 原样用页签那维；
     * · 页签那维不限制（合并视图 / 媒体页签）⇒ 用视图那维；
     * · 都有 ⇒ 交集。空交集是**正确结果**（用户选了一个本视图没收录的页签），⛔ 别兜底成全量。
     * ⚠️ 默认视图这一路恒为 null ⇒ 对现有行为零影响。
     */
    $: listTypePoolMerged = (() => {
        // ⚠️ 先把值抄进 const：箭头闭包里 TS 会丢掉 `if (!x) return` 的收窄（报 'possibly null'）
        const viewPool = activeViewPool;
        const tabPool = listTypePool;
        if (!viewPool) return tabPool;
        if (!tabPool) return viewPool;
        return tabPool.filter((t) => viewPool.includes(t));
    })();
    /**
     * ⚠️ 2026-11-08：原来这里还有一条 `mediaListLockType = listLockType === 'tracking' || 'stats' ? null : listLockType`
     *    —— 它存在的理由是「`listLockType` 可能装非条目页签」。摊开页签后翻译已收进
     *    `pure/homeTabs.tabLockType()`，那个函数对 tracking / stats **直接返回 `null`**，
     *    于是这条比较永远为假、成了死代码（svelte-check 也会报「两种类型没有重叠」）。
     *    ⇒ 整条删除，模板直接用 `listLockType`。⛔ 别再把「归 null」这层搬回组件里 ——
     *      那是页签语义的一部分，属于 `pure/homeTabs`。
     */
    $: listEntries = mergedOn ? viewEntries : viewEntries.filter((e) => tabMatchesEntry(activeTab, e));
    /**
     * 🔴 2026-11-13 用户口径：骰子的候选池跟着**当前页签**走，只有合并视图才回退全库。
     *    ⇒ 这一处判据是唯一真源（`mergedOn`），⛔ 别在模板里再写一遍 `navLayout === 'merged'`。
     *    · 合并视图 ⇒ 传 `null`（宿主 `openWhatToWatchModal(null)` 会 `service.list()` 全库）
     *    · 其余布局 ⇒ 传 `listEntries`（当前页签 + 当前视图筛过的那份）
     * ⚠️ 收成一个受控变量而不是内联箭头闭包：内联写法每次渲染都造一个新函数，
     *    子组件的 `class:has-dice={onOpenWhatToWatch && …}` 会跟着无谓重算。
     */
    $: watchDiceOpen = onOpenWhatToWatch
        ? () => onOpenWhatToWatch?.(mergedOn ? null : listEntries)
        : null;
    function tabLabel(t: HomeTab): string {
        return homeTabLabel(t);
    }

    /** #541：消费「起始页」的一次性请求（消费完置回 null，避免它继续纠正后续的手动切页） */
    $: if (requestedTab !== null) {
        const want = requestedTab;
        requestedTab = null;
        // 🔴 用户 m09565 ①-4：判据从 `isNavTab(want)` 换成 `tabOrderFor(tabAxis)`。
        //    旧写法只认 `HOME_TAB_ORDER`（全类型十枚）⇒ 聚合模式下宿主推来的 `'book'` / `'media'`
        //    会被判非法、请求被**静默丢弃**（症状：聚合模式下改起始页毫无反应）。
        //    ⚠️ 折轴这一步也不能省：宿主推的是「用户设置的起始页」，它可能属于另一条轴。
        const folded = equivalentTabFor(tabAxis, want);
        if ((tabOrderFor(tabAxis) as readonly string[]).includes(folded) && folded !== activeTab) switchTab(folded);
    }

    /** #543 侧边栏已改成**恒定图标轨** ⇒ 折叠钮与 #541 那个 `toggleNavCollapsed` 一并退场
     *  （图标轨本身就是最省宽那一态；`settings.navCollapsed` 字段按 append-only 红线保留但不再被读取）。 */

    function switchTab(t: HomeTab) {
        activeTab = t;
        onTabChange(t);
    }
    /**
     * 顶部胶囊的页签键盘导航（1.0.4，ARIA APG Tabs 模式）：
     * 整组只占一个 Tab 停留点（仅当前页签 tabindex=0），进入后用 ←/→ 在组内移动并立即激活，
     * Home/End 跳首尾（是否回绕见 pure/tabNav）。与页签无关的按键一律放行 ——
     * 否则会吃掉 Tab 本身与浏览器/输入法的默认行为。
     * 🔴 #546：**竖向那一套已随导航搬进 `NavMenu.svelte`**（它恒为竖向）⇒ 这里不再按布局换轴，
     *    顶部胶囊永远是 ←/→（⛔ 别把那个三元判断加回来 —— 本组件已经没有竖向导航了）。
     */
    function onTabKeydown(ev: KeyboardEvent, current: HomeTab) {
        const r = resolveTabKey(ev.key, navTabs.indexOf(current), navTabs.length);
        if (!r.handled) return;
        ev.preventDefault();
        const next = navTabs[r.index];
        if (next !== current) switchTab(next);
        // 焦点跟随：不主动聚焦会留在原按钮上，而那个按钮已变成 tabindex=-1
        void tick().then(() => {
            tabsEl?.querySelectorAll<HTMLElement>('button')[r.index]?.focus();
        });
    }

    // ── 回到顶部按钮（#570 重写）：显隐判据 + 滚动源解析都在纯模块 `pure/topButton` ──
    let rootEl: HTMLDivElement | null = null;
    let showTop = false;
    /**
     * 当前认准的滚动容器（视图滚动发生的地方：Obsidian 的 `.view-content`，或将来若改成内层滚动容器）。
     * 🔴 #570 起**不是猜出来的**：`scroll` 事件的 `target` 就是真正在滚的那个元素（见 `onAnyScroll`）。
     */
    let scrollEl: HTMLElement | null = null;

    /** 从视图根往上找第一个**真能滚**的祖先（首测用；之后一律以事件 target 为准） */
    function findScroller(): HTMLElement | null {
        let el: HTMLElement | null = rootEl?.parentElement ?? null;
        while (el) {
            if (el.scrollHeight > el.clientHeight + 1) return el;
            el = el.parentElement;
        }
        return null;
    }
    /**
     * 🔴 #624 自动隐藏的两个状态（用户 2026-10-13：「添加鼠标无上下滑动动作则自动隐藏的机制」）：
     *   · `topHovering` —— 鼠标是否停在按钮上（**悬停时不许隐藏**，否则想点的那一刻它刚好淡出）；
     *   · `topIdle` —— 是否已「静止」够久（滚动时清零，停够 `TOP_IDLE_MS` 才置位）。
     *   判据收在纯模块 `topVisible`（可单测），这里只管状态与计时。
     */
    let topHovering = false;
    let topIdle = false;
    let topIdleTimer: ReturnType<typeof setTimeout> | undefined;
    /** 重新计时：每次滚动都调用（等价于防抖 —— 滚一下就把「静止」从头数） */
    function armTopIdle(): void {
        clearTimeout(topIdleTimer);
        topIdleTimer = setTimeout(() => {
            topIdle = true;
            syncTop();
        }, TOP_IDLE_MS);
    }
    /** 同步显隐（判据在纯模块；找不到容器时按 0 处理 —— 首帧不该谎报「已经滚下去了」） */
    function syncTop(): void {
        showTop = topVisible(scrollEl?.scrollTop ?? 0, { hovering: topHovering, idle: topIdle });
    }

    onMount(() => {
        scrollEl = findScroller();
        syncTop();   // 🔴 首帧就同步一次：旧实现要等第一次 scroll 事件才知道自己在哪（一进来就是「不显示」）
        /**
         * 🔴🔴 #570 核心修正（用户：「回到顶部按钮**滑到底部不显示了**」）：
         *   旧实现只在 mount 时**猜一次**容器，猜错 / 那会儿内容还短（没得滚）/ 之后换了容器
         *   ⇒ 事件永远收不到、`showTop` 卡死在 false。
         *   现在：`scroll` 事件**不冒泡但会经过捕获阶段** ⇒ 挂在 `document` 上就能收到**任何**滚动容器的事件，
         *   而 `ev.target` **就是**那个容器 —— 直接认它（`wrapsRoot` 只认「包着本视图」的容器，
         *   免得侧栏 / 别的面板滚动把按钮带得乱闪）。**不猜 = 不会猜错。**
         */
        const onAnyScroll = (ev: Event): void => {
            const t = ev.target;
            const cand = t === document ? document.documentElement : t;
            if (wrapsRoot(cand, rootEl)) scrollEl = cand as HTMLElement;
            // 🔴 #624：滚一下就说明用户还在动 ⇒ 清掉「静止」并重新计时（按钮立刻回来）
            topIdle = false;
            armTopIdle();
            syncTop();
        };
        document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
        // 现代主题：窗口尺寸变化后按钮宽度会变，指示器必须重算（native 下 syncIndicator 自身会短路）
        // 🔴 用户 m09565 ①-5：收窄判定也挂在这里 —— 先量该不该收窄，**等它落定**再定位指示器
        //    （按钮宽度会因藏字而变，先定位后收窄 = 指示器错位）。
        const refit = (): void => {
            void syncTabFit().then(() => syncIndicator());
        };
        window.addEventListener('resize', refit);
        // 🔴 但只靠 window resize 不够（2026-09-23 修）：**后台 leaf 重新可见**、侧栏收放、拖分隔条
        //    都不会触发 window.resize —— 而「视图先前不可见 ⇒ 首测读到 0 宽」正是那次 bug 的入口。
        //    ResizeObserver 盯住页签容器自身：容器 0×0 → 真实尺寸的**那一次**也会回调，
        //    就是「不可见期间测错、可见后自愈」的那条路径。
        //    ⚠️ 指示器是容器的 absolute 子项、不参与容器尺寸 ⇒ 改宽度不会反过来触发 RO（无回调环）。
        //    🔴🔴 但 2026-11-12 实测发现「盯自身」会形成死循环：收窄**本身**会改 `.rl-tabs` 的宽度
        //    ⇒ RO 再回调 ⇒ 摘类重量 ⇒ 又改宽度…实测每 ~12ms 抖一次、永不收敛。RO 的职责是
        //    「可用宽度变了才重量」，而可用宽度由**父级**决定 ⇒ 盯父级，不盯自己。
        const fitHost = tabsEl?.parentElement ?? null;
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => refit());
        if (ro && fitHost) ro.observe(fitHost);
        return () => {
            ro?.disconnect();
            document.removeEventListener('scroll', onAnyScroll, { capture: true });
            window.removeEventListener('resize', refit);
        };
    });

    /**
     * 换页签后补一次同步：内容整体换了一批（长列表 ⇄ 空态）时滚动位置可能被浏览器钳掉，
     * 而那一钳**不一定**派发 scroll 事件 ⇒ 光等事件会让按钮停在上一页的状态。
     * ⚠️ Svelte 4 不穿透函数体做依赖分析 ⇒ 显式 `void activeTab` 建依赖（同本文件既有的 syncIndicator 写法）。
     */
    $: if (activeTab) {
        void activeTab;
        scheduleTopSync();
    }
    let topSyncTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleTopSync(): void {
        clearTimeout(topSyncTimer);
        topSyncTimer = setTimeout(() => {
            if (!scrollEl) scrollEl = findScroller();
            syncTop();
        }, 0);
    }
    onDestroy(() => {
        clearTimeout(topSyncTimer);
        clearTimeout(topIdleTimer);
    });


    // 指示器重算时机：首帧渲染后、主题切换时、activeTab 变化时。
    // 显式 void activeTab 建立依赖——否则 Svelte 无法从函数体内推出该响应式块依赖 activeTab。
    // 不能依赖 `await tick()` 的微任务顺序来替代：这里用 .then 是为了不阻塞 Svelte 的更新队列。
    $: if (uiTheme === 'modern' && activeTab) {
        void activeTab;
        // 🔴 换分类轴时 `activeTab` 可以是同一枚（「游戏」两轴同名），但页签数量 6⇄10 变了
        //    ⇒ 显式对数量建依赖，否则收窄结果不会重算、第二轴沿用第一轴的判定。
        void navTabs.length;
        void tick().then(() => {
            // 🔴 用户 m09565 ①-5：换页签后「哪一枚该展开」变了 ⇒ 收窄结果也要重算，
            //    否则从「统计」切到「电影」时，明明能放下却还是全图标（或反过来把当前项截断）。
            void syncTabFit().then(() => {
                syncIndicator();
            });
            void indEl; // 建立对指示器节点的依赖：节点在 {#if} 内后挂载，需待其就位后重算
        });
    }

    /**
     * 平滑回顶。🔴 #570：容器**现找一次**再滚（认准的那份可能还没建立——比如刚切到本页、
     * 或旧实现那种「猜错就一直错」的情形），再回退到窗口滚动 —— ⛔ 不给「点了没反应」的死路。
     */
    function scrollToTop() {
        const el = scrollEl ?? findScroller();
        if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
        // 🔴 #624：回顶后把「静止」一并清掉 —— 否则它在 3 秒后又把按钮的隐藏态前置一次，
        //    而那时位置已经到顶、本就该是隐藏的（两个判据打架没有意义）。
        topIdle = false;
        clearTimeout(topIdleTimer);
        showTop = false;   // 乐观置位：平滑滚动的第一帧之前按钮就该开始退场
    }

    // ── 现代主题页签：滑动指示器定位（纯函数 indicatorTransform 算最终样式串）──
    /** 页签容器引用（读取 offsetLeft/scrollLeft 作为定位基准） */
    let tabsEl: HTMLElement | null = null;
    /** 指示器节点引用（仅 modern 下渲染，故可能为 null） */
    let indEl: HTMLElement | null = null;
    /** 指示器的 transform + width（走内联 style，因数值随布局实时变化） */
    let indStyle = '';
    /** 容器内边距，必须与下方 CSS `.rl-tabs.rl-tabs-modern` 的 padding 保持一致 */
    // ⚠️ m07364：容器 padding 由 5px 收到 4px（iOS 分段控制器），本常量必须同步 ——
    //    指示器用 `offsetLeft - TAB_PAD` 算位移，常量与 CSS padding 不同值会让滑块整体偏移。
    const TAB_PAD = 4;
    /** 布局未就绪时的重试计数（防无限 rAF） */
    let indRetry = 0;
    /** 重试上限（约 10 帧）；仍不就绪则交给 ResizeObserver —— 视图一旦可见它会立刻回调 */
    const IND_RETRY_MAX = 10;

    /**
     * 🔴 用户 m09565 ①-5：窄屏下**非激活页签只显示图标，激活页签展开成「图标 + 文字」**。
     *
     * 为什么不用媒体查询 / 断点：可用宽度取决于**侧栏/分栏**，不是视口宽 —— 实测同一窗口下
     * 容器只有 461px、六枚页签各 78px 合计 478px（溢出 17px）。写死断点必然在某种分栏下判错。
     * ⇒ 直接量 `scrollWidth > clientWidth`（真实是否溢出），再按实测结果收窄。
     *
     * 🔴 状态必须走**变量 + `class:` 指令**，⛔ 不能直接 `el.classList.add(...)`：
     *    Svelte 4 的样式裁剪只看模板里出现过的类名，纯 JS 加的类会让 `is-narrow` / `is-tight`
     *    那两条规则被判成 `Unused CSS selector`（实测顶破 89 warnings 基线，涨到 91）。
     *    写成 `class:is-narrow` 后模板里就有了这两个名字，裁剪器认账。
     * ⚠️ 量之前必须先把类摘掉（下面的 `tabFit = 'none'`），否则量到的是「已收窄」的宽度、永远判不出该不该收窄。
     */
    let tabFit: 'none' | 'narrow' | 'tight' = 'none';
    /** 收窄判定的重试计数（布局未就绪时 `scrollWidth` 读到 0，不能当成「没溢出」） */
    let fitRetry = 0;
    /** 上次判定时的「父级可用宽度 + 激活页签」，两者都没变就不用重量（见下面的抖动说明） */
    let fitSig = '';
    /**
     * 量测期间临时关掉过渡（见 `syncTabFit` 的第三段说明）。
     * ⚠️ 必须走变量 + `class:` 指令，⛔ 不能 `classList.add` —— 同 `is-narrow` 那条，
     *    Svelte 4 样式裁剪只认模板里出现过的类名。
     */
    let fitMeasuring = false;
    /**
     * 一次收窄判定 = 两趟量测（摘掉收窄态 → 量自然宽 → 决定加不加）。
     *
     * 🔴🔴 判据必须拿**父级可用宽度**比，⛔ 不能比自己的 `clientWidth`：
     *    `.rl-tabs` 是 `width: fit-content`（容器按内容收缩），它的 `clientWidth` **永远**跟着内容走
     *    ⇒ `scrollWidth > clientWidth` 只会在 padding/border 上差几像素，于是**恒判为溢出**。
     *    2026-11-12 真机实测踩到：自然宽 327px、父级可用 481px（明明放得下），却一直挂在 `is-narrow`。
     *    ⇒ 改成 `scrollWidth > 父级内容宽`，那才是「这一排放不下」的真判据。
     * ⚠️ 并且必须先摘掉收窄态再量：带着收窄类量到的是「已收窄」宽度，判定只会单向收紧、退不回来。
     *
     * 🔴🔴 **布局未就绪时 `scrollWidth` 是 0**，而 `0 <= avail + 1` 恒真 ⇒ 会被当成「放得下」而
     *    再也不量。2026-11-12 真机实测踩到：页面全展开、实测 `scrollW 478 / avail 461`（确实溢出），
     *    但界面一直是未收窄态 —— 因为 `onMount` 那一趟量到的是 0。
     *    ⇒ 补「量不出数就重试若干帧」+ 额外盯住**父级**（容器是 fit-content，父级变宽时它自己不一定变）。
     */
    async function syncTabFit(): Promise<void> {
        const box = tabsEl;
        const host = box?.parentElement ?? null;
        if (!box || !host) return;
        // 父级的内容宽（扣掉左右内距）
        const hs = getComputedStyle(host);
        const padX = (parseFloat(hs.paddingLeft) || 0) + (parseFloat(hs.paddingRight) || 0);
        const avail = host.clientWidth - padX;
        /*
         * 🔴🔴 幂等闸门（2026-11-12 真机实测抓出的**死循环**）：
         *    RO 原先盯的是 `.rl-tabs` **自己**，而收窄会改它自己的宽度 ⇒ 又触发 RO ⇒ 再摘类重量…
         *    实测 MutationObserver 每 ~12ms 记一次「摘 is-narrow / 加 is-narrow」，永不收敛，
         *    外部任何时刻量到的都可能正好落在「刚摘掉」那一帧（`fit:"none"`），像是判定没跑。
         *    两处一起修：① RO 改盯**父级**（见 onMount）；② 这里加签名闸门 —— 父级可用宽度与
         *    激活页签都没变时，结果必然一样，直接跳过，别为了「重新确认」把类摘掉又加回去。
         */
        // 签名必须含**页签数量**：换分类轴时 6 枚⇄10 枚，父宽与激活页签都可能不变
        // （「游戏」两轴同名）⇒ 只靠 avail+activeTab 会误判成「结果必然一样」而跳过重量。
        const sig = `${avail}|${navTabs.length}|${activeTab}`;
        if (sig === fitSig && tabFit !== 'none') return;
        fitSig = sig;
        /*
         * 🔴🔴 量之前必须**关掉过渡**（2026-11-12 真机实测抓出的第三个坑）：
         *    `.rl-tab-txt` 有 `max-width .18s` 过渡，摘掉 `is-narrow` 后文字宽度是**动画式**回到 26px 的
         *    ⇒ `await tick()` 后立刻量到的 `scrollWidth` 还停在「文字几乎为 0」的中途值（实测 6 枚本该
         *    478px，却量到 ≈273px）⇒ 判成「放得下」⇒ 永不收窄。
         *    真机症状：切回另一条轴后 6 枚全是 78px 宽、撑出 17px 横向溢出（`fit:"none", scrollW:478`）。
         *    ⇒ 量测期挂 `is-measuring` 把过渡掐掉，量完再摘。
         */
        fitMeasuring = true;
        if (tabFit !== 'none') {
            tabFit = 'none';
            await tick();
        }
        const live = tabsEl;
        if (!live) {
            fitMeasuring = false;
            return;
        }
        const natural = live.scrollWidth;
        // 量不出数 ⇒ 还没布局好，重试（⛔ 别当成「没溢出」）
        if (avail <= 0 || natural <= 0) {
            fitMeasuring = false;
            fitSig = '';
            if (fitRetry < IND_RETRY_MAX) {
                fitRetry++;
                requestAnimationFrame(() => void syncTabFit());
            }
            return;
        }
        fitRetry = 0;
        if (natural <= avail + 1) {
            fitMeasuring = false;
            return;
        }
        tabFit = 'narrow';
        await tick();
        if (!tabsEl) {
            fitMeasuring = false;
            return;
        }
        if (tabsEl.scrollWidth <= avail + 1) {
            fitMeasuring = false;
            return;
        }
        tabFit = 'tight';
        fitMeasuring = false;
    }

    /**
     * 重算指示器位置。切换 Tab、窗口缩放后调用（横向滚动不需重算：指示器随内容一起滚，坐标系一致）。
     * 依赖 tick()：调用时机可能早于 DOM 完成布局（offsetLeft 会读到 0），故调用方一律 tick 后再调。
     * 任一引用缺失即静默返回——native 主题下指示器不渲染，属正常路径而非异常。
     */
    function syncIndicator(): void {
        if (uiTheme !== 'modern' || !tabsEl || !indEl) return;
        const btn = tabsEl.querySelector<HTMLElement>('button.on');
        if (!btn) return;
        const style = indicatorStyle(btn.offsetLeft, btn.offsetWidth, TAB_PAD);
        // 🔴 测量未就绪（视图不可见 / 首帧，容器与按钮的 offsetWidth 读到 0）：**不提交**。
        //    提交了就会得到「0 宽指示器 = 只剩左右两条描边的一条竖线，且 translateX(0) 把它钉在容器最左」，
        //    选中项同时失去描边（描边本就由指示器承担）—— 2026-09-23 用户截图报障的正是这个形态
        //    （实测：x=29..32、高 30px 的 4px 竖线；文字却正常变蓝，因为那是 `.on` 的职责）。
        //    ⛔ 别指望「用户再点一次就好」：`activeTab = t` 赋同值时 Svelte 不标记脏，
        //    而重算时机只有 window resize 与 activeTab 变化 ⇒ 点「已选中项」永远不会触发重算。
        if (!style) {
            if (indRetry < IND_RETRY_MAX) {
                indRetry++;
                requestAnimationFrame(syncIndicator);
            }
            return;
        }
        indRetry = 0;
        indStyle = style;
    }

</script>

<div class="rl-home" class:rl-home-side={navLayout === 'sidebar'} bind:this={rootEl}>
    <!-- 🔴🔴 2026-11-26（m04109）视图切换条**不再占一整行**。
         用户逐字：「这个合集视图下也要搜索框、添加条目、筛选栏同步主视图，
         并且把顶级分类和搜索框添加条目按钮并排显示」
         ⇒ 「顶级分类」就是这排视图胶囊，现在它被塞进**工具栏那一行**：
            · 默认视图 / 自定义视图 ⇒ 走 `<svelte:fragment slot="view-chips">` 进 MediaList 的工具栏最左端；
            · 合集视图         ⇒ 由 `<CollectionBoard>` 自己渲染（它照同一套类名自建工具栏）。
         ⚠️ 所以这里原本那条 `{#if effPage === 'library' && views.length > 0}` + `.rl-views` 整行已删除。
         ⛔ 别再恢复成独立一行 —— 那正是用户这次要消掉的「多一层」。
         历史记录（保留，供追溯）：2026-11-23 用户裁定「在现有分类胶囊栏**上方**加一条视图切换」；
         2026-11-24 用户报障「怎么没有用户添加的自定义视图」⇒ 补「＋ 新建视图」。
         两条裁定现在都由 `ViewChips` 承载（它内部就带那颗「＋」，且只在 `views.length > 0` 时渲染 —
         ⚠️ 判的是 `views.length` 而不是可见条数：全都藏起来时「＋」也得在，否则没路建新视图）。 -->

    {#if navLayout === 'sidebar'}
        <!-- 🔴 #546 入口挂载点之二：**没有工具栏的页签**（计划 / 统计 —— 那两页没有搜索框那一行）
             由本组件渲染成靠右的**独立一行**（用户 2026-10-07 裁定）。
             ⚠️ 有工具栏的页签（阅读/影视/游戏/音乐）走**另一个挂载点** —— 经 `<slot name="nav-entry">`
                放进 MediaList 的搜索框那一行右端（用户原话：「页签纯文字入口放在与搜索框并排显示」）。
             🔴 两处是**同一个组件** `NavMenu`（文案 / ARIA / 键盘 / 面板 / 交互一字不差）；
                ⛔ 别在这儿再手写一份面板 DOM —— 那就是「同一概念两份实现」，必然漂移。 -->
        {#if !hasToolbar}
            <div class="rl-navbar">
                <NavMenu {activeTab} tabs={navTabs} onSelect={switchTab} />
            </div>
        {/if}
    {:else if navLayout === 'top' && !viewIsCollection}
        <!-- 🔴🔴 #551 修回归：这里**必须显式写成一个档位**（`top`），⛔ 不许用不带条件的兜底分支 ——
             合并视图那一档自己不再渲染任何导航行（三下拉与「更多」都在内容区），
             兜底分支会把 merged **一并吃进来**，于是在合并视图里顶部还挂着一整排页签
             （#550 删掉合并视图那条分支时留下的洞，用户上手第一眼就抓到了）。
         🔴🔴 2026-11-26（m04870）**合集视图不渲染这排页签**。
         用户逐字：「还有这个合集视图不要出现顶部胶囊，只类似合并视图的菜单」→ 追问后裁定：
         「合集视图进入后只能切换到默认视图上才先完全不要页签了」
         ⇒ 合集视图里**一枚导航入口都不留**（页签、文字菜单、「更多」都不给）。
         换页的唯一出路 = 工具栏那枚**视图下拉**切回默认视图（默认视图的页签就回来了）。
         ⛔ 别给合集视图再补「更多」菜单当退路：用户要的就是这块干净，
            而且合集视图的工具栏里已经有视图下拉，不存在「进得去出不来」。
         ⚠️ 条件必须写在**这一档**上（`&& !viewIsCollection`），不能改成兜底分支 —— 理由见上面 #551。
         排序/筛选/搜索全在 `CollectionBoard` 自己的工具栏里，不受这里影响。
         🔴 #603 同类修正：这条页签栏 `width: 100%`（页签居中、两侧全是空白）⇒ 原先把可访问名挂在它上面
         （`aria-label`，值就是插件名）会让「鼠标划过页签栏两端的空白」也浮出一个气泡 ⇒ 一并改成
         `aria-labelledby` 指向 `.rl-sr` 文本节点（同一套口径，见下面那块面板）。 -->
        <span class="rl-sr" id="rl-home-tabs-label">ReelLudic</span>
        <div
            class="rl-tabs"
            class:rl-tabs-modern={uiTheme === 'modern'}
            class:is-narrow={tabFit === 'narrow'}
            class:is-tight={tabFit === 'tight'}
            class:is-measuring={fitMeasuring}
            role="tablist"
            aria-labelledby="rl-home-tabs-label"
            aria-orientation="horizontal"
            bind:this={tabsEl}>
            {#if uiTheme === 'modern'}
                <span class="tab-ind" bind:this={indEl} style={indStyle}></span>
            {/if}
            {#each navTabs as t}
                <button
                    id={`rl-tab-${t}`}
                    class:on={activeTab === t}
                    role="tab"
                    aria-selected={activeTab === t}
                    aria-controls="rl-home-tabpanel"
                    tabindex={activeTab === t ? 0 : -1}
                    on:click={() => switchTab(t)}
                    on:keydown={(ev) => onTabKeydown(ev, t)}>
                    <Icon icon={homeTabIcon(t)} size={13} />
                    <!-- 🔴 用户 m09565 ①-5：文字必须包一层 span —— 窄屏下要「非激活项只留图标、激活项图例+文字」，
                         只能整体隐藏这个 span。⛔ 别直接把文字留在 button 里：那样 CSS 没有任何钩子能只藏文字。
                         `aria-hidden` 不加：读屏仍可凭可见文字念出页签名（隐藏是纯视觉收窄，不是语义消失）。 -->
                    <span class="rl-tab-txt">{tabLabel(t)}</span>
                </button>
            {/each}
        </div>
    {/if}

    <!-- 单一面板承载全部页签内容：id 固定，所有 tab 的 aria-controls 都指向它（比「每 tab 一个 panel」更贴合实际结构）。
         🔴 #547 合并视图下**没有 tablist**（页签已取消）⇒ `aria-labelledby` 会指向一个不存在的 id，
         所以那一档换成 `aria-label`（⛔ 别留着悬空引用，读屏会念出错乱的「tab」）。
         🔴🔴 #603 用户报障：「悬停海报墙中间隙条目卡片为什么会显示『媒体库』提示」——
         真根因就是那枚 `aria-label`：**Obsidian 会把带 `aria-label` 的元素当成悬停提示**，
         而本面板**罩着整块内容区** ⇒ 鼠标落在海报墙卡片之间的空隙上（那里没有卡片接手 hover）
         就会浮出一个「媒体库」气泡。
         ⇒ 合并视图那一档改走 `aria-labelledby` 指向**下面那枚视觉隐藏的页名节点**：
         ⑴ 读屏照样有名字，而且**跟着当前页走**（媒体库 / 追更表 / 统计页，比写死一个准确）；
         ⑵ `.rl-sr` 是 1×1 被裁掉的，鼠标够不着 ⇒ 不会再有气泡。
         ⚠️ `aria-labelledby` 不会触发官方气泡 —— 非合并档本来就用它指向页签，一直没有人报过气泡。 -->
    <div
        class="rl-tab-body"
        id="rl-home-tabpanel"
        role="tabpanel"
        aria-labelledby={mergedOn ? 'rl-merged-page-label' : viewIsCollection ? 'rl-coll-view-label' : `rl-tab-${activeTab}`}
        tabindex="0">
        {#if mergedOn}
            <span class="rl-sr" id="rl-merged-page-label">{mergedPageLabel(effPage)}</span>
        {/if}
        <!-- 🔴 2026-11-26（m04870）合集视图的那排页签已不渲染（见上面导航分支）⇒ `rl-tab-${activeTab}`
             会变成**悬空引用**（读屏念出错乱的「tab」）。这里补一枚同名 `.rl-sr` 节点接住它，
             值取当前视图名（默认视图 / 合集视图 / 自定义视图那一条），跟着视图走比写死准确。
         ⚠️ `.rl-sr` 是 1×1 被裁掉的 ⇒ 鼠标够不着、不会冒出悬停气泡（#603 的同一条口径）。 -->
        {#if !mergedOn && viewIsCollection}
            <span class="rl-sr" id="rl-coll-view-label">{activeView?.name ?? ''}</span>
        {/if}
        <!-- 🔴 #544：内容区那枚 19px 大标题**已按用户要求删除** —— 页名改由浮现面板里的文字承担。 -->
        {#if mergedOn && effPage !== 'library'}
            <!-- 🔴 #550：追更 / 统计两页**没有筛选行** ⇒ 「更多」在这里自占一行（右对齐，与库列表页那枚
                 同一条右缘）。⛔ 这行不能省：合并视图下没有别的回程入口，省了就「进得去出不来」。 -->
            <div class="rl-more-bar">
                <MergedPageMenu page={mergedPage} onPick={(p) => (mergedPage = p)} />
            </div>
        {/if}
        {#if effPage === 'tracking'}
            <div class="rl-tracking-switch">
                <button class:on={trackingMode === 'board'} aria-pressed={trackingMode === 'board'} data-tip="列表看板（按更新时间）" on:click={() => (trackingMode = 'board')}>追番表</button>
                <button class:on={trackingMode === 'calendar'} aria-pressed={trackingMode === 'calendar'} data-tip="日历看板（按播出日期）" on:click={() => (trackingMode = 'calendar')}>排期表</button>
                <!-- 🔴 m07854 ⑪ ①：计划页第三档「继续观看 / 阅读」——
                     用户原话「首页页签计划页新增 tab「继续观看/阅读」队列」。
                     ⚠️ 做成与「追番表 / 排期表」同级的二级切换档，⛔ 不加进一级页签：
                     一级页签走 `pure/homeTabs.HOME_TAB_ORDER`，加一枚会连带改分类轴、导航记忆、
                     `isNavTab` 白名单与设置页起始页下拉，代价远大于收益。 -->
                <button class:on={trackingMode === 'resume'} aria-pressed={trackingMode === 'resume'} data-tip="继续观看 / 阅读（按最近活跃）" on:click={() => (trackingMode = 'resume')}>继续</button>
            </div>
            {#if trackingMode === 'calendar'}
                <CalendarBoard
                    {entries}
                    {posterUrl}
                    {onEditEntry}
                    {onOpenEntry}
                    {onSelectDay}
                    {onPlanDate}
                    {onStartWatching} />
            {:else if trackingMode === 'resume'}
                <!-- 🔴 m07854 ⑪ ①：只传它真需要的四个 prop（`ResumeBoard` 不读更新检测/导入那套，
                     多传会被 Svelte 4 收下但没人用 —— 少传反而让契约清楚）。 -->
                <ResumeBoard
                    {entries}
                    {posterUrl}
                    {onOpenEntry}
                    {onEditEntry} />
            {:else}
                <TrackingBoard
                    {entries}
                    {posterUrl}
                    {onOpenEntry}
                    {onEditEntry}
                    {onOpenLink}
                    {onCheckUpdate}
                    {onSaveLatestKnown}
                    {onImportBangumi} />
            {/if}
        {:else if effPage === 'stats'}
            <!-- 🔴 #635 ④：评分看板要「封面 + Ctrl 滚轮缩放 + 拖入落库」三样 ——
                 `posterUrl` / `ctrlWheelZoom` 本组件已有（与主视图同源，⛔ 不新造），
                 只多传一个 `onSetRating`（拖入即改评分 → 宿主落库）。
                 🔴 #657：另传统计页**区块顺序**与其落盘回调（自由排序，自适应 —— 见 `pure/statsLayout`）。 -->
            <!-- 🔴🔴 #659：prop 名必须与 `StatsBoard` 的 `export let` **逐字一致** ——
                 上一版 StatsBoard 里叫 `onOrderChange`、这里传的是 `onStatsOrderChange`，
                 Svelte 4 对「多传的 prop」**静默忽略** ⇒ 拖动后回调永远是默认空函数 ⇒ **拖了没反应**（零报错）。 -->
            <!-- ⚠️ `coverUrlOf` 的契约是 `(e) => string | null | undefined`（见 `StatsBoard.svelte` /
                 `RatingBoard.svelte` 的 `export let coverUrlOf`），与 `posterUrl` 的
                 `(e) => string | undefined` 直接兼容 ⇒ **字面复用 `{posterUrl}`**，不新造 prop、也不包包装函数。
                 🔴 `#635 ③` 的产物断言锚的正是 `coverUrlOf={posterUrl}` 这个字面形态
                 （`assert-symbols.cjs:12976`）—— 包一层 `(e) => posterUrl(e) ?? null` 会让它判红。
                 ⛔ 反过来也别把 `StatsBoard` / `RatingBoard` 收窄成 `string | null`（那会逼着这里包一层）。 -->
            <!-- ⚠️ 新增 prop 一律**追加在 `{ctrlWheelZoom}` 之后**，⛔ 别插进 `coverUrlOf={posterUrl} {onSetRating} {ctrlWheelZoom}`
                 这段里面 —— 产物断言 `#635 ③` 锚的就是这三者**连续字面**相邻的形态。 -->
            <StatsBoard {entries} {excerptCounts} {activityLog} {onAdd} {onOpenEntry} {onGenerateReport} {yearReports} {onOpenReport} {onRecordJournal} coverUrlOf={posterUrl} {onSetRating} {ctrlWheelZoom} {seriesRatings} {onSetSeriesRating} order={statsOrder} onOrderChange={onStatsOrderChange} {unfoldSeries} {onToggleUnfoldSeries} discardTags={cloudDiscardTags} />
        {:else}
            {#if viewIsCollection}
                <!-- 🔴 2026-11-23 合集视图：换的是**整页骨架**（IP 卡片 → 类型分段卡片网格），不走 MediaList。
                     ⚠️ 条目已经过 `filterForView`（`viewEntries`），这里只负责分组展示。
                     🔴 2026-11-26（m04109）用户要求「合集视图下也要搜索框、添加条目、筛选栏同步主视图」
                        ⇒ 这几件**由 CollectionBoard 自己渲染**（它照 MediaList 的类名与尺寸自建同一行），
                          所以这里必须把宿主能力透传下去：增删改、缩放、视图胶囊、右键菜单全套回调。
                        ⚠️ 少传一个就会在那边变成「点了没反应」的哑按钮 —— 与 MediaList 那段是**同一份契约**。 -->
                <CollectionBoard
                    groups={collectionGroups}
                    {posterUrl}
                    {colorTheme}
                    {onOpenEntry}
                    {onEditEntry}
                    {onWatch}
                    {onAdd}
                    {onQuickAssociate}
                    {onAddExcerpt}
                    {onOpenEntryLogModal}
                    {onOpenEntryTextModal}
                    {onDeleteEntry}
                    {posterDensity}
                    {posterColumns}
                    {ctrlWheelZoom}
                    {onPosterZoom}
                    views={shownViews}
                    activeViewId={activeView?.id ?? ''}
                    onPickView={(id) => (activeViewId = id)}
                    viewCount={viewEntries.length}
                    viewUnit={viewUnit}
                    onOpenWhatToWatch={watchDiceOpen} />
                <!-- 🔴 2026-11-26（m04870）合集视图**不再透传** mergedOn / mergedPage / onPickMergedPage。
                     用户裁定：「合集视图进入后只能切换到默认视图上才先完全不要页签了」
                     ⇒ 合集视图里一枚导航入口都不留，连同上一轮加的「更多」菜单一起撤掉。
                     ⛔ 别再补回来：换页出路 = 工具栏那枚**视图下拉**切回默认视图。 -->
            {:else}
            <MediaList
                entries={listEntries}
                {posterUrl}
                {colorTheme}
                {cardFieldsByType}
                {cardFieldsByKind}
                {tableColumnsByType}
                {onTableColumnsChange}
                {onCellCommit}
                {onViewOrderChange}
                {onTimelineZoomChange}
                {viewOrder}
                {timelineZoom}
                {listGrouping}
                {onToggleGrouping}
                {unfoldSeries}
                {onToggleUnfoldSeries}
                onOpenWhatToWatch={watchDiceOpen}
                {defaultViewMode}
                {posterDensity}
                {posterColumns}
                {ctrlWheelZoom}
                {onPosterZoom}
                {onAdd}
                {onEditEntry}
                {onOpenEntry}
                {onOpenLink}
                {onWatch}
                {onOpenSeriesPicker}
                {onOpenSeriesAssociate}
                {onOpenSeriesProps}
                {onQuickAssociate}
                {onSetStatus}
                {onMarkUpdated}
                {onDeleteEntry}
                {onBulkDelete}
                {onAddExcerpt}
                {onOpenEntryLogModal}
                {onOpenEntryTextModal}
                {onBulkRating}
                {seriesRatings}
                {onBulkTags}
                {onConfirmBulk}
                lockType={listLockType}
                lockKind={listLockKind}
                typePool={listTypePoolMerged}
                scope={mergedOn ? mergedScope : null}
                scopeStatus={mergedOn ? mergedStatus : null}
                scopeSort={mergedOn ? mergedSort : null}
                onScopePick={(s) => (mergedScope = s)}
                onStatusPick={(s) => (mergedStatus = s)}
                onSortPick={(s) => (mergedSort = s)}>
                <!-- 🔴 #546 入口挂载点之一：**搜索框那一行的最右端**（与左侧「共 N 部」左右对称，
                     搜索框仍居中）。⚠️ 走 MediaList 的具名插槽，不是本组件里再堆一行 ——
                     用户原话「页签纯文字入口放在与搜索框并排显示」。
                     ⚠️ `{#if}` 必须在 `<svelte:fragment>` **里面** —— 反过来写会报
                        「`<svelte:fragment>` must be a child of a component」（片段只能是组件的直接子节点）。 -->
                <!-- 🔴 #552 两个布局**共用同一个挂载点**（工具栏那一行的最右端，靠 `absolute; right: 0` 贴边）：
                     文字菜单放 `NavMenu`；合并视图放那枚「更多」菜单 —— 它本批从**内容区筛选行**
                     挪到这里（用户原话：「把海报墙更多菜单放在**右上角与搜索框并排**」）。
                     ⚠️ 两者都传 `inline`：那一行是 `justify-content: center`，不绝对定位会把「搜索框 + 添加」挤偏。
                     ⚠️ 二者互斥（`navLayout` 只有一个值），⛔ 不会同时渲染。 -->
                <svelte:fragment slot="nav-entry">
                    {#if navLayout === 'sidebar'}
                        <NavMenu {activeTab} tabs={navTabs} onSelect={switchTab} inline />
                    {:else if mergedOn}
                        <MergedPageMenu page={mergedPage} onPick={(p) => (mergedPage = p)} inline />
                    {/if}
                </svelte:fragment>
                <!-- 🔴🔴 2026-11-26（m04109）视图胶囊进工具栏**最左端**（与搜索框 + 添加并排）。
                     用户原话：「把顶级分类和搜索框添加条目按钮并排显示」。
                     ⚠️ 传的是 `shownViews`（设置页勾了「显示」的 + 当前选中那条兜底），⛔ 不是 `views`；
                        「全都藏起来」时仍要送来非空的一行 —— 那颗「＋ 新建视图」就在 `ViewChips` 内部，
                        它的外层判据是 `views.length > 0`（见组件注释）。
                     ⚠️ `ViewChips` 是**唯一真源**：合集视图那边用的是同一个组件。
                        ⛔ 别在这里手写胶囊 DOM —— 两份实现必然漂移（用户上次就是被这种漂移咬到）。 -->
                <svelte:fragment slot="view-chips">
                    <ViewChips
                        views={shownViews}
                        activeViewId={activeView?.id ?? ''}
                        onPickView={(id) => (activeViewId = id)} />
                </svelte:fragment>
            </MediaList>
            {/if}
        {/if}
    </div>

    <!-- 回到顶部：下滑超过页签+筛选栏后，钉在**本视图滚动可见区**的右下角浮现，点击平滑回顶。
         🔴 2026-10-13（用户报障「按钮不保持在底部」）：外层改成 `position: sticky; bottom: 0` 的
         **0 高度锚点**、按钮 `absolute` 挂在它右下角 —— ⛔ 不再用 `position: fixed`。
         原因：Obsidian 的视图外层带 `transform`（本仓 `.rl-ctx-anchor` 的注释里已记过这条），
         `fixed` 会被重定向到那个祖先 ⇒ 按钮被钉到**内容底部**（表现为「不滚到底就看不见」）。
         `sticky` 的参照系是**滚动容器**（`.view-content`），与本视图绑定、不受 transform 影响，
         也不会跑到别的面板上去。 -->
    <div class="rl-to-anchor">
        <button
            class="rl-to-top"
            class:show={showTop}
            data-tip="回到顶部"
            on:mouseenter={() => { topHovering = true; syncTop(); }}
            on:mouseleave={() => { topHovering = false; syncTop(); }}
            on:click={scrollToTop}>↑<span class="rl-sr">回到顶部</span></button>
    </div>
</div>

<style>
    .rl-home {
        display: flex; flex-direction: column; min-height: 100%;
        /* 极浅灰白基调（炫酷视觉升级要求），暗色主题回退到主题背景 */
        background: #f8f9fa; border-radius: 10px; padding: 10px;
        /* 适配 Obsidian 正文字体：插件内容区跟随 --font-text（自定义中文字体生效） */
        font-family: var(--font-text);
    }
    :global(body.theme-dark) .rl-home { background: var(--background-primary); }

    /* ── #546 导航入口的**独立一行**（只给没有搜索框的两页：计划 / 统计）──────────────
       🔴 导航本体（大字 + 面板 + 键盘）已抽成独立组件 `NavMenu.svelte` —— 它有两个挂载点：
          · 有工具栏的页签 ⇒ 经 `<slot name="nav-entry">` 放进 MediaList **搜索框那一行右端**；
          · 计划 / 统计（没有工具栏）⇒ 由本组件包一层靠右的行（就是下面这条）。
       ⚠️ 靠右的理由：与「三视图按钮」那一行**同一条右缘**（视图栏右缘 = 内容右缘）——
          用户要的「放在切换三视图按钮上方」在这一行上依然成立。
       ⚠️ 这一层只负责**摆放**，⛔ 不再有任何导航自身的样式（那些全在 NavMenu 里，两个挂载点共用）。 */
    .rl-navbar { display: flex; justify-content: flex-end; margin-bottom: 6px; }

    /* ── 🔴 2026-11-26（m04109）分类视图切换条的样式**整体搬走**了 ──────────────────
       用户原话：「把顶级分类和搜索框添加条目按钮并排显示」⇒ 胶囊不再占独立一行，
       而是进了两个视图各自的工具栏 ⇒ 它连带自己的样式一起搬进了 `ViewChips.svelte`（唯一真源）。
       ⛔ 别把 `.rl-views` / `.rl-view-chip` / `.rl-view-add` 这套写回本组件：
          · 本组件已经**不渲染**胶囊 DOM（只剩 `<ViewChips>` 这个组件标签）⇒ 写在这里一律是
            dead CSS（svelte-check 会报 `Unused CSS selector`，直接破 89 警告基线）；
          · 更根本的是两份样式必然漂移 —— 合集视图那边用的是同一个组件，不共享就会一改一漏。
       历史记录（保留，供追溯）：2026-11-23 用户裁定「在现有分类胶囊栏**上方**加一条」；
       2026-11-24 「怎么没有用户添加的自定义视图」⇒ 补「＋ 新建视图」（虚线圆、到上限置灰但仍留 tooltip）。 */

    /* ── #550 合并视图：追更 / 统计两页的「更多」行 ────────────────────────────────
       🔴 #547 那条顶端独立筛选栏已按用户要求**整体删除**（三个下拉并入内容区筛选行、
          两枚图标按钮收成一枚「更多」）⇒ 它那套样式一并退场（⛔ 源码注释刻意不写被删类的名字）。
       ⚠️ 库列表页那枚「更多」不在这儿 —— 它经工具栏的 `nav-entry` 插槽落在与搜索框并排的右端。
       本行只服务**没有筛选行**的两页（右对齐，与库列表页那枚同一条右缘）。 */
    .rl-more-bar { display: flex; justify-content: flex-end; margin-bottom: 8px; }

    .rl-tracking-switch { display: flex; gap: 0; margin-bottom: 10px; border: 1px solid var(--background-modifier-border); border-radius: 7px; overflow: hidden; width: fit-content; }
    .rl-tracking-switch button { font-family: inherit; font-size: 12px; border: none; background: var(--background-primary); color: var(--text-muted); padding: 4px 16px; cursor: pointer; }
    .rl-tracking-switch button + button { border-left: 1px solid var(--background-modifier-border); }
    .rl-tracking-switch button.on { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }

    /* 回到顶部按钮：钉在**本视图可见区**的右下角，下滑超过阈值后淡入（class:show 控制）。
       🔴 定位拆两件（用户 2026-10-13 报障「不保持在底部」）：
          · `.rl-to-anchor` = **0 高度**的 `sticky; bottom: 0` 盒子 —— 它是「可见区右下角」这个位置的载体；
          · `.rl-to-top` = 挂在锚点右下角的 absolute 按钮。
       ⛔ 别退回 `position: fixed`：Obsidian 视图外层有 transform 祖先，fixed 会被重定向到那个祖先
          （内容高度的盒子）⇒ 按钮跑到**内容底部**去了。sticky 的参照系是滚动容器，天生免疫。
       ⚠️ 锚点 `height: 0` ⇒ 不占版面（`.rl-home` 的底部内距仍是 10px + 按钮的 22px 偏移）。 */
    .rl-to-anchor { position: sticky; bottom: 0; height: 0; z-index: 1000; }
    .rl-to-top {
        position: absolute; right: 22px; bottom: 22px;
        width: 40px; height: 40px; border-radius: 50%;
        border: none; cursor: pointer;
        background: var(--interactive-accent); color: var(--text-on-accent);
        font-size: 17px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, .22);
        opacity: 0; pointer-events: none; transform: translateY(6px);
        transition: opacity .18s ease, transform .18s ease;
    }
    .rl-to-top.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .rl-to-top:hover { transform: translateY(0) scale(1.1); }

    /* ── 一级导航 Tab（v0.4 阶段2：下划线指示当前空间，非按钮；Obsidian 原生 Tab 风格） ── */
    .rl-tabs {
        display: flex; justify-content: center; gap: 2px;
        margin-bottom: 12px; flex-wrap: wrap;
        border-bottom: 1px solid var(--background-modifier-border);
        width: 100%;
    }
    .rl-tabs button {
        font-family: inherit; font-size: 13px; font-weight: 500;
        display: inline-flex; align-items: center; gap: 5px;
        border: none; background: transparent; color: var(--text-muted);
        border-radius: var(--rl-t-radius-md, 6px) var(--rl-t-radius-md, 6px) 0 0;
        padding: 7px 16px; cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        transition: color .18s ease, border-color .18s ease, background .18s ease, font-weight .12s ease;
    }
    .rl-tabs button:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
    /* 🔴 用户 m09565 ①-5：窄屏下非激活页签只留图标、激活项展开成「图标 + 文字」。
       判定由 `syncTabFit()` 实测 `scrollWidth` 给出（⛔ 不用媒体查询：可用宽度取决于分栏而非视口）。
       · `.is-narrow`：非激活项藏文字（当前项仍带文字，用户永远看得懂自己在哪）；
       · `.is-tight`：藏完仍溢出 ⇒ 全部只留图标，保证最后一枚不被裁掉。
       ⚠️ 状态走 `class:is-narrow` 指令（⛔ 不许改回 `el.classList.add`）：Svelte 4 的样式裁剪
          只认模板里出现过的类名，纯 JS 加的类会让这两条规则被判 `Unused CSS selector`、顶破 89 告警基线。
       ⚠️ 文字节点被藏时按钮变窄，`offsetLeft/offsetWidth` 也跟着变 ⇒ `syncIndicator()` 必须在
          `syncTabFit()` **落定之后**调用（已按此顺序接好）。
       ⚠️ 藏字不用 `display:none`：那会让 `scrollWidth` 的测量口径在「藏了」与「没藏」之间横跳，
          而这里恰恰靠 `scrollWidth` 判是否溢出。用 `max-width:0` + `opacity:0` 收干净，保留可量性。 */
    .rl-tabs.rl-tabs-modern.is-narrow button:not(.on) .rl-tab-txt,
    .rl-tabs.rl-tabs-modern.is-tight button .rl-tab-txt {
        max-width: 0; opacity: 0; overflow: hidden; margin-left: -5px;
    }
    /* 收窄态按钮左右内距同步收一点，否则「只有图标」时按钮里会剩一圈空 */
    .rl-tabs.rl-tabs-modern.is-narrow button:not(.on),
    .rl-tabs.rl-tabs-modern.is-tight button { padding-left: 12px; padding-right: 12px; }
    /* 文字节点本身的过渡：展开/收窄时不跳一下 */
    .rl-tab-txt {
        display: inline-block; max-width: 200px;
        transition: max-width .18s ease, opacity .14s ease, margin-left .18s ease;
    }
    /* 🔴 量测期掐掉过渡：否则摘掉 is-narrow 后量到的是「文字还在动画中途」的宽度（见 syncTabFit 注释）。 */
    .rl-tabs.is-measuring .rl-tab-txt,
    .rl-tabs.is-measuring button { transition: none !important; }
    .rl-tabs button:active { transform: scale(.96); }
    .rl-tabs button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    .rl-tabs button.on {
        color: var(--interactive-accent); font-weight: 600;
        border-bottom-color: var(--interactive-accent);
    }

    /* ── 1.0.3 现代主题页签：分段控件（矩形容器 + 描边滑动指示器）──
       为何必须走结构分支而非纯 CSS 变量：变量能改颜色与圆角，但变不出新 DOM 节点（指示器），
       只能靠模板 {#if} 表达。页签图标两主题恒渲染（定稿曾为纯文字，2026-09-12 用户裁定恢复）。
       fallback 说明：本块整体挂在 .rl-tabs-modern 下，native 主题选择器不匹配、规则根本不生效，
       故 var() 的第二参数纯属防御性冗余；此处仍一并写上，与 Task 3/4 中「native 也会命中」的规则保持一致纪律。

       🔴🔴 2026-11-26（m04870 / m04553）**胶囊 → 矩形**。
       用户逐字：「这些胶囊样式的按钮有点不符合整体协调观了改成距形和筛选、排序相符的样式」
       「顶部胶囊怎么没改样式」⇒ 「胶囊」指的就是**本块**这三处 `--rl-t-radius-pill` 圆角：
         ⑴ 容器 `.rl-tabs.rl-tabs-modern`；⑵ 滑动指示器 `.tab-ind`；⑶ 页签按钮 `button`。
       三处必须**同值**改成 `--rl-t-radius-md`（= 筛选/排序那排 MiniSelect 的 `.rl-sel-btn` 圆角），
       否则会出现「按钮方了、底下那块描边还是药丸」的错位 —— 用户上一轮说的「没改样式」正是这个病。
       ⛔ 别再退回 pill（999px）：那会让左右两端页签露在容器圆角外面。

       ⚠️ 2026-11-15（m07364）**上面「三处同值」已被下面 iOS 分段控制器那一版部分推翻**：
         容器圆角改成 `--rl-t-radius-lg`（8px，比按钮的 md 大一档），指示器与按钮仍用 md。
         这不是笔误 —— iOS 分段控制器正是「外槽比内滑块圆角略大」的形态，且容器圆角 >
         按钮圆角**不会**像 pill 那样把两端页签顶出去（差 2px，肉眼几乎不可见）。
         ⛔ 别为了「同值」把容器改回 md：那会让底槽与滑块的圆角完全重合、失去 iOS 的层次感。

       🔴🔴 2026-11-15（m07364）**矩形描边 → iOS 分段控制器（Segmented）**。
       用户逐字：「采用"iOS 分段控制器 (Segmented)"风格 去边框：把内部所有小按钮的边框（border）
       全删掉。做底槽：给最外层的大容器加一个极浅的灰色背景（例如 #F1F3F5），圆角调大
       （如 8px 或 10px），去掉大外框的边框线…间距：减少按钮之间的间距（仅留 2-4px），
       让它们看起来是一个整体控件。」
       本块四条对应改动：
         ⑴ **去掉大外框的两条 border**（正边框 + 下边框）—— 底槽只靠底色与圆角成形；
         ⑵ 圆角 md(6px) → **lg(8px)**，比按钮圆角大一档 ⇒ 按钮不再露到容器圆角外面；
         ⑶ `gap: 0` → **3px**（用户要 2-4px），让相邻按钮之间留一道底槽色的缝，
            选中滑块浮在上面才像一整块控件而不是连成一片；
         ⑷ `padding: 5px` → **4px**。⚠️ 改这里**必须同步** `TAB_PAD`（:732 的 `const TAB_PAD = 5;`）
            与 `.tab-ind` 的 `top/left/height`（`4px` / `4px` / `calc(100% - 8px)`）—— 指示器是
            用 `offsetLeft - TAB_PAD` 算位移的，三处不同值会让滑块整体偏移、高度也不再居中。
       ⚠️ 底槽色**仍走 `background: var(--background-secondary)`**，⛔ 别改成字面 `#F1F3F5`：
         浅色主题下 secondary 本身就是 `#f6f6f6` 量级（与用户举例的 #F1F3F5 同档），
         而 `assert-symbols.cjs` 有一条专门钉「基础分支原样保留 `background:var(--background-secondary)`」
         —— 写死色值会当场打红，且深色主题会跟着失真（下面那条 `body.theme-dark` 才管深色）。 */
    .rl-tabs.rl-tabs-modern {
        position: relative;
        display: inline-flex; align-items: center; gap: 3px;
        width: fit-content; max-width: 100%;
        margin: 0 auto 12px; padding: 4px;
        background: var(--background-secondary);
        border: none;
        border-radius: var(--rl-t-radius-lg, 8px);
        box-shadow: var(--rl-t-shadow-inset, none);
        flex-wrap: nowrap;
        /* 🔴 必须显式 flex-start（2026-09-21 用户报「窄栏下胶囊与按钮容器边界冲突」的根因）：
           上面 `.rl-tabs`（原生主题）那条 `justify-content: center` 会**继承到这里**（同一元素、
           且本块没声明该属性）。一旦溢出（窄侧栏 + 6 页签 ≈ 508px 宽），居中会把内容整体左移
           `C = (内容宽 - 可用宽) / 2`：① 首个页签被推出容器**左缘之外**，而 `scrollLeft` 最小值是 0
           ⇒ **永久看不见、也滚不回来**；② 指示器是 absolute 定位（不是 flex 项），**不参与居中位移**
           ⇒ 与选中页签错开 C 像素（实测 dx=40~73px），而宽度仍正确 —— 正是用户在截图里看到的
           「选中态（胶囊）压在两个页签边界上」。
           容器自身的居中由 `margin: 0 auto` 承担，与 justify-content 无关，故改成 flex-start
           观感零变化；附带好处：offsetLeft 变成与面板宽度无关的常量 ⇒ 面板拖宽拖窄都不会让
           指示器失准（原先只在 window.resize 时重算，拖分隔条不触发）。 */
        justify-content: flex-start;
        /* 窄侧栏（~320px）：横向滚动而非压缩字号，保证点击目标不缩小 */
        overflow-x: auto;
        scrollbar-width: none;
    }
    .rl-tabs.rl-tabs-modern::-webkit-scrollbar { display: none; }
    /* 🔴 深色模式：轨道必须**比页面亮**一档（#375 用户实测报障：「页签为什么在深色模式下会深一个度」）——
       上面那条 `background: var(--background-secondary)` 暗含一个**只在自带主题成立**的假定：
       自带深色里 secondary = base-20 = `#282828`，比页面 primary = base-00 = `#1C1C1C` **亮**（浮起面）。
       而用户主题（Minimal 系）恰好相反 —— `--bg2 = hsl(base-l - 2%)`、`--bg1 = hsl(base-l)`
       ⇒ secondary **比页面暗 2% 亮度**（实测 页面 `#262626` / 轨道 `#212121`），于是整条页签凹下去一个色阶。
       ⚠️ 同族的 `--background-secondary-alt` / `--background-primary-alt` 在该主题里同样偏暗，**换哪个都不救**。
       🔴 写法与 `body.theme-dark` 的 `.rl-home` 一致：**只覆盖深色**，浅色模式保持原观感
       （用户 2026-09-22 裁定「方案 B · 只修深色」）。
       色向 = 页面色混入 6% 主题色阶**亮端**；自带深色下 `--color-base-100` = `#dadada` ⇒ 实测落 `#313131`
       （与 Minimal 自己的 `--ui1`（base-l + 6%）同量级 ⇒ 不突兀）。
       兜底 `#ffffff`：主题若删掉 `--color-base-100`，`color-mix` 里含无效 var 会让**整条声明失效**
       ⇒ 轨道退回透明（比原来的「暗一档」更糟）；深色分支下兜白是安全方向。
       ⛔ 别把它写成 `inset` 内阴影去「补光」——`--rl-t-shadow-inset` 是另一条令牌（仅本容器在用）。 */
    :global(body.theme-dark) .rl-tabs.rl-tabs-modern {
        background: color-mix(in srgb, var(--background-primary), var(--color-base-100, #ffffff) 6%);
    }
    /* 🔴 m07364：深色主题下选中滑块不能是纯白（在 #1C1C1C 底上刺眼、与底槽反差过大）。
       取「页面色混亮端 18%」= 明显比底槽（6%）亮一档，仍属同明度区间，观感即 iOS 深色模式。
       ⚠️ 必须带 `body.theme-dark` 前缀 —— 与上面那条同族，浅色主题保持纯白不变。 */
    :global(body.theme-dark) .rl-tabs.rl-tabs-modern .tab-ind {
        background: color-mix(in srgb, var(--background-primary), var(--color-base-100, #ffffff) 18%);
    }
    /* 指示器：绝对定位 + transform 平移，left/top 固定为 padding 值。
       🔴 m07364：iOS 分段控制器的选中滑块是**一块浮起的纯白圆角块**，不是描边药丸 ⇒
         ⑴ 删掉 `border: 1.5px solid var(--interactive-accent)`（用户「把内部所有小按钮的
            边框全删掉」；描边是上一版矩形风用来表达选中的，现在改由白色底 + 阴影表达）；
         ⑵ 底色由 `--background-primary` 改成**纯白**（用户「选中的"电影"，背景色变成纯白色」）。
            深色主题下纯白会刺眼，由下面 `body.theme-dark` 那条换成同明度的浅面；
         ⑶ `top/left` 与 `height` 跟着容器 `padding` 从 5px 收到 **4px**
            （`calc(100% - 8px)`），否则滑块会比按钮高出一圈。
       ⚠️ 阴影继续用 `--rl-t-shadow-ind`（modern 下已是 `0 2px 6px rgba(0,0,0,.13)`）——
         这正是 iOS 滑块那种「轻轻浮起」的观感，⛔ 别在这里另写字面 box-shadow。 */
    .rl-tabs.rl-tabs-modern .tab-ind {
        position: absolute; top: 4px; left: 4px; height: calc(100% - 8px);
        background: #ffffff;
        border: none;
        border-radius: var(--rl-t-radius-md, 6px);
        box-shadow: var(--rl-t-shadow-ind, none);
        transition: transform var(--rl-t-dur-ind, .28s) var(--rl-t-ease-ind, cubic-bezier(.34, 1.3, .64, 1)),
                    width var(--rl-t-dur-ind, .28s) var(--rl-t-ease-ind, cubic-bezier(.34, 1.3, .64, 1));
        pointer-events: none; z-index: 0;
    }
    /* 图标与文字压在指示器之上（z-index:1），并剥掉 native 的下划线/margin 负值 */
    .rl-tabs.rl-tabs-modern button {
        position: relative; z-index: 1;
        /* m07364：17px → 14px，配合容器 gap 3px，六个页签整体更紧凑（用户「让它们看起来是一个整体控件」） */
        padding: 7px 14px; border-radius: var(--rl-t-radius-md, 6px);
        /* 🔴🔴 m07364「把内部所有小按钮的边框（border）全删掉」—— 2026-11-15 真机实测：
           `border` 早就是 `0px none` 了，屏幕上那圈方框**不是 border**，而是核心给 `button`
           的 `box-shadow: var(--input-shadow)` —— 计算值实测
           `rgba(0,0,0,.12) 0 0 0 1px inset, rgba(0,0,0,.067) 0 1px 2px 0, …`，
           第一段就是 **1px 内阴影冒充的描边**。所以只删 `border` 永远消不掉它，
           必须同时 `box-shadow: none`。⛔ 别把这两条删回去 —— 删了按钮又开始画框。
           （`border: none` 仍要留着：核心 `button:not(.clickable-icon)` 的特异性是 (0,1,1)，
           单靠 `border-bottom: none` 压不住上/左/右三边。） */
        border: none; box-shadow: none; margin-bottom: 0;
        background: transparent; white-space: nowrap;
        /* m07364：未选中态文字 = 深灰（用户「不要用纯黑，用 #4B5563 之类的灰」）。
           ⛔ 别写死 #4B5563 —— `--text-muted` 就是这一档灰，且深色主题会自动翻成浅灰；
           图标继承 currentColor（见 Icon.svelte），所以这一条同时让图标跟着变灰。 */
        color: var(--text-muted);
        transition: color var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    .rl-tabs.rl-tabs-modern button:hover { background: transparent; }
    /* 现代主题：分段控件按下不做缩放（native 的 :active scale(.96) 是原生按钮抖动，modern 下应克制） */
    .rl-tabs.rl-tabs-modern button:active { transform: none; }
    /* 选中态不再用下划线+放大字重：由指示器承担视觉焦点，避免「描边药丸 + 下划线」双重强调 */
    .rl-tabs.rl-tabs-modern button.on {
        border-bottom: none; font-weight: 600;
        color: var(--interactive-accent);
    }

    .rl-tab-body { flex: 1; min-width: 0; }

    /* ── 🔴 2026-11-14（用户 m05195 提需求、m05299 拍板「做首页窄屏适配」） ───────────────
       首页这一层只负责**外框与页签**（各页签内部的网格在 MediaList / CollectionBoard /
       StatsBoard / CalendarBoard 各自的 style 块里适配）。窄屏要处理的是三处外框留白：
         · `.rl-home` 的 10px 内距在 360pt 手机上吃掉近 3% 宽度 —— 收到 6px；
         · 页签栏在 `is-narrow` / `is-tight` 下已经由 JS（`syncTabFit`）藏掉文字，
           这里只把左右内距再收一档，让图标间距不至于散成一片；
         · `.rl-more-bar` / `.rl-navbar` 两行右对齐的入口栏在窄屏下与内容抢宽度 ⇒ 允许换行。
       ⚠️ 阈值 560px 复用 `styles.css` 里卡片网格那一档（`.rl-wtw-card` / `.rl-rm-grid`），
          ⛔ 不新增一次性阈值。 */
    @media (max-width: 560px) {
        .rl-home { padding: 6px; border-radius: 6px; }
        .rl-tabs.rl-tabs-modern { margin-bottom: 8px; padding: 4px; }
        .rl-tabs.rl-tabs-modern button,
        .rl-tabs button { padding-left: 8px; padding-right: 8px; }
        .rl-navbar,
        .rl-more-bar { flex-wrap: wrap; row-gap: 4px; }
        .rl-tracking-switch { flex-wrap: wrap; }
    }
</style>
