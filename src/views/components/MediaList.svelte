<script lang="ts">
    import { tick, afterUpdate, onDestroy, onMount } from 'svelte';

    /**
     * 🔴 #510 系列折叠卡的**首屏性能**：每张卡最多真正渲染几层封面。
     *
     * 用户原话：「还有优化第一次渲染海报墙上系列折叠卡封面的性能优化和动态显示效果」。
     *
     * 实测（`_shot/ml510.html`）：叠层不封顶时，18 部系列 = **18 个 `<img>`**（每个都带自己的
     * `calc()` 定位）⇒ 一屏几十张折叠卡就是**上千个节点**，全在首次挂载时同步建出来。
     * 「有多少折多少」（#502）是**观感**要求，不是「必须建 N 个元素」—— 4 层的观感已经足够，
     * 真实部数由右上角 `×N` 角标如实表达（⛔ 别把它当成「可以省」的东西）。
     *
     * ⚠️ 选 **4** 而不是 3 / 5：`--rl-stk-step = min(9px, 28px / (n − 1))`
     *    ⇒ n = 4 时 `28/3 = 9.33` ⇒ **步长正好还是 9px**；n = 5 起才开始收窄。
     *    也就是说 **≤4 部的系列视觉 100% 不变**（它们本来也渲染这么几层），
     *    只有 5 部以上的系列才从「窄步长一摞」变成「9px 步长的 4 张」——那正是 #503① 用户要的「露更多边缘」。
     */
    const STACK_MAX = 4;

    /** 进视口前多少像素就把叠层挂上（提前量：滚动时不会看到「忽然冒出来」） */
    const STACK_ROOT_MARGIN = '200px';

    /**
     * 🔴 #510 **可见性门控**：叠层（第 2 层起）只在卡片**接近视口**时才真正渲染。
     * · 主封面（第 1 层）**永远渲染** —— 它是卡的门面；
     * · 首屏之外的海报墙卡片 ⇒ 叠层**一个节点都不建**（首屏挂载量直接砍掉大头）；
     * · ⚠️ **能力回落**：没有 `IntersectionObserver`（老环境）⇒ 立刻挂上，绝不因此少画东西。
     * · ⚠️ 观察器是**模块级单例**（⛔ 别每张卡 new 一个 —— 那本身就成了新的性能问题）。
     */
    let stackObserver: IntersectionObserver | null = null;
    /** 已确认「接近视口」的组（key = 系列 key）；重渲染后据此决定挂不挂叠层 */
    const stackReady = new Set<string>();
    /** 重渲染信号（`Set` 的变化 Svelte 看不见 ⇒ 用它当信号） */
    let stackTick = 0;

    function ensureStackObserver(): IntersectionObserver | null {
        if (typeof IntersectionObserver === 'undefined') return null;
        if (!stackObserver) {
            stackObserver = new IntersectionObserver(
                (entries) => {
                    for (const e of entries) {
                        if (!e.isIntersecting) continue;
                        const key = (e.target as HTMLElement).dataset.stackKey ?? '';
                        if (key) stackReady.add(key);
                        stackObserver?.unobserve(e.target);
                    }
                    stackTick += 1;
                },
                { rootMargin: STACK_ROOT_MARGIN },
            );
        }
        return stackObserver;
    }

    /**
     * 挂在卡片元素上：接近视口就把这一组加入 `stackReady`。
     * ⚠️ `destroy` 里要 `unobserve`（卡被筛掉 / 换视图时不能留着观察器）。
     *
     * 🔴 #511：`destroy` 里**还要把 key 从 `stackReady` 里删掉**。原来只 `unobserve` ⇒
     *   `stackReady` **只增不减**：每换一次筛选 / 排序 / 类型 / 库，就留下一批永远不用的 key
     *   （内存缓慢增长），而更实际的后果是**旧 key 命中会让后来同名的卡跳过入场动画**。
     * 🔴 `update` 里比的是**闭包里那个 `cur`**、不是最初的 `key` —— Svelte 会多次调 `update`，
     *   拿最初的 `key` 比会在「参数改回原值」时误判成没变、于是 `dataset` 与观察都不更新。
     */
    function stackGate(node: HTMLElement, key: string) {
        const io = ensureStackObserver();
        if (!io) {
            stackReady.add(key);
            stackTick += 1;
            return { destroy() {} };
        }
        node.dataset.stackKey = key;
        io.observe(node);
        let cur = key;
        return {
            update(next: string) {
                if (next === cur) return;
                stackReady.delete(cur);
                cur = next;
                node.dataset.stackKey = next;
                io.observe(node);
            },
            destroy() {
                io.unobserve(node);
                stackReady.delete(cur);
            },
        };
    }
    import { MEDIA_STATUSES, canTransition } from 'pure/status';
    import type { SortBy } from 'pure/search';
    import { statusLabel, overviewUnitLabel } from 'pure/labels';
    import { actionAriaLabel, actionIcon, actionMenuTitle, actionReadyHint, actionUnavailableHint, associateMenuLabel, hasActionEntry, hasLocalEntry } from 'pure/actionLabel';
    import { starClass } from 'pure/rating';
    import { describeBulkApply } from 'pure/bulkConfirm';
    import { filterAndSort } from 'pure/search';
    // 🔴 #552：`BOOK_KIND_TOP_UNITS` 随库概览一起恢复 —— 阅读页签选中某个子分类时，
    //    工具栏那枚概览的量词跟着换（「12 本网文」而不是笼统的「本书」），对齐影视「8 部剧集」那套。
    import { BOOK_KINDS, BOOK_KIND_LABELS, BOOK_KIND_TOP_UNITS, bookKindCounts, normalizeBookKind } from 'pure/bookKind';
    // 🔴 #547：排序选项表搬到 `pure/sortOptions`（合并视图的顶端筛选栏要用**同一份**）——
    //    ⛔ 别在本组件里再写一张表：加一档排序时必然只改一处。
    import { SORT_OPTIONS, SORT_OPTIONS_BASE } from 'pure/sortOptions';
    // 🔴 #547 / #550 合并视图：作用域由宿主推下来，本组件只负责把它翻译成 typeFilter / kindFilter。
    //    🔴 #550：那枚「媒体类型」下拉也搬进本组件渲染（并入内容区筛选行，取消顶端独立行）⇒
    //    还要它的**选项表与文案**（⛔ 不在组件里手写第二份中文）。
    import { MERGED_SCOPES, mergedBookKind, mergedScopeLabel, type MergedScope } from 'pure/mergedScope';
    import { groupMusicByArtist } from 'pure/musicGroup';
    import { cardSubtitle, hasCardSubtitle, cardCreator, hasCardCreator, cardGenres, hasCardGenres, cardFieldValue, seriesCardFieldValue, cardFieldsFor, DEFAULT_CARD_FIELDS_BY_TYPE, type CardFieldKey } from 'pure/cardMeta';
    // 1.3.1 ②（#621）表格视图：列配置（pure/tableColumns）与单元格读写（pure/tableCell）真源
    import { DEFAULT_TABLE_COLUMNS_BY_TYPE, TABLE_COLUMN_LIMIT, columnAppliesTo, commonColumnsForTypes, seriesCellText, tableColumnDefsFor, tableColumnPoolFor, tableColumnsForTypes, type TableColumnDef } from 'pure/tableColumns';
    import { hasTableCellBinding, parseTableCellInput, tableCellCurrentPatch, tableCellDraft, tableCellText } from 'pure/tableCell';
    // ⚠️ 本组件其余分支**不用** `Notice`（回执一律在宿主侧）—— 这里是**唯一**例外：
    //    「改的这格写不进去」必须**当场**告诉用户（留在宿主侧会丢掉是哪个字段、为什么）
    import { Notice } from 'obsidian';
    import { resolveAddType } from 'pure/focusType';
    import { resolveEmptyState } from 'pure/emptyState';
    // 系列折叠卡（#434）：分组键 = type + 系列名（用户 2026-09-30 裁定「不做跨类型」）；
    // 组名的单一真源 = `seriesTitleOf`（折叠卡标题与展开态组头**必须同源**，⛔ 别两处各拼一次）。
    // 系列折叠卡（#434）：分组键 = type + 系列名；组名的单一真源 = `seriesTitleOf`。
    // 🔴 #444c：**季列表弹窗整个搬出本组件**（改成应用级 Modal `modals/SeriesPickerModal` + `SeriesPicker.svelte`）
    //    ⇒ 这里不再 import 任何 `seriesPanel*` 算式（宽度 / 列数是 Modal 的事），也**不再自造遮罩**。
    // 🔴 #625：`seriesYearSpan` / `seriesGenres` **不再从组件里直取** —— 折叠卡的信息行改走
    //    `pure/cardMeta.seriesCardFieldValue`（它内部才用这两个聚合函数）。
    //    ⛔ 别因为「组件里看不到它们了」就在视图层再拼一次（那样行数与取值又会各走一套）。
    import { foldSeries, listTreeRows, listFlatRows, listDisplayRows, seriesKeyOf, seriesStatus, nextSeriesEntry, seriesReadPercent, seriesReadDone, seriesIndexValue, type SeriesGroup, type SeriesRow } from 'pure/seriesGroup';
    // 进度 / 状态小字（#444c 下沉到纯模块）：卡片与弹窗**共用同一份口径**，⛔ 别在两处各写一套。
    import { listProgress, readPercent, bookUnitOf, cardPlaytimeBadge, cardReadBadge } from 'pure/mediaProgress';
    import { placeMenu } from 'pure/menuPlacement';
    // 🔴 #626 多带两样：`posterGridTemplateForWall`（墙的列模板 —— 自定义档的**间距比网格宽**，裁决收在 pure 层）、
    //    `POSTER_WALL_GAP`（墙的间距，必须与 `.rl-wall{gap}` 同值）。
    // 🔴 用户 2026-10-20 删除「海报墙列数」⇒ `POSTER_WALL_COLUMNS_MAX` 与 `wallColumns` prop 一并下线。
    import { posterGridTemplate, posterGridTemplateForWall, posterZoomColumns, normalizePosterColumns, POSTER_COLUMNS_DEFAULT, POSTER_COLUMNS_MAX, type PosterDensity } from 'pure/posterGrid';
    // 🔴 #598 视图切换的**唯一真源**（通用视图表 + 用户可见名 + lucide 图标名）＋ 时间线分组纯逻辑。
    //    ⛔ 别在这里手写第二份 label / icon（本仓「同一概念只准一份」）。
    import {
        VIEW_MODES, VIEW_LABELS, VIEW_ICONS, MUSIC_VIEW, buildTimeline, type ViewMode,
        // 🔴 #668 视图顺序（自由排序 + 持久化）与时间线缩放档 —— 判据全在纯模块，⛔ 组件里不复制
        buildViewChoices, moveViewValue, normalizeViewOrder,
        normalizeTimelineZoom, timelineItemWidth, timelineZoomStep, TL_ZOOM_DEFAULT,
    } from 'pure/viewModes';
    import {
        buildGenreOptions, genrePillLabel, matchesGenreScope,
        resolveGenreScope, seriesGenreScope, genreScopeKeyOf,
    } from 'pure/genreFilter';
    // 数据源展示名（封面评分角标与它的 data-tip 共用；单一真源 = pure/sourceRegistry 的 PROVIDER_META.label）
    // #430 封面角标的来源名（手填优先 / 回落数据源中文名）—— 唯一裁决入口
    // ⚠️ `pure/sourceRegistry` 的旧助手在这里**已无消费者**（角标改走 `entrySourceLabel`）⇒ 不再 import，
    //    ⛔ 别为「以防万一」把它加回来（未被调用的 import 就是一条会漂移的死路）。
    import { entrySourceLabel } from 'pure/sourceMeta';
    import { ENTRY_TYPES, ENTRY_TYPE_LABELS, TYPE_COLORS, type ColorTheme, type EntryType } from 'data/types';
    import type { MediaEntry, MediaStatus, BookKind, EntryLogKind, EntryTextKind } from 'data/types';
    import Icon from './Icon.svelte';
    // #566：受控下拉的自绘版（原生 `<select>` 的 popup 在 Windows 上不受 CSS 控制 ⇒ 列表无法居中）
    import MiniSelect from './MiniSelect.svelte';
    // 🔴 #680：题材面板是**手写 DOM**（不是 MiniSelect），要让同组的三个下拉在它展开时收起 ——
    //    走 MiniSelect 模块导出的广播口（⛔ 别在这里直接碰那个私有注册表）。
    import { broadcastClosePeers } from './MiniSelect.svelte';

    export let entries: MediaEntry[] = [];
    export let onAdd: (t?: EntryType, kind?: BookKind) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    export let onOpenLink: (url: string) => void = () => {};
    /** 主操作按钮（影视观看/书籍阅读/游戏启动/音乐播放）：plugin 层按类型分流执行 */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /**
     * 折叠卡右下角那枚按钮：**打开系列「季列表」弹窗**。
     * 🔴 #444c：弹窗改成**应用级 Modal**（`modals/SeriesPickerModal`，与「编辑条目」同构）——
     *    本组件不再自己造遮罩 / 绝对定位居中（那条路受正文区宽度限制，用户窗口下最多 4 列），
     *    只负责「报告用户点了哪一组」。
     */
    export let onOpenSeriesPicker: (g: SeriesGroup) => void = () => {};
    /**
     * 🔴 #609 折叠卡右键「排序号」→ 打开**拖拽排序弹窗**（翻面 #608 的「点一下自动重排」）。
     * 🔴 弹窗是**应用级 Modal**（宿主 `openSeriesReorder` 打开）—— 本组件只「报告用户点了哪一组」，
     *    落库（`bulkSetSeriesIndex`）与回执 `Notice` 都在宿主侧，⛔ 别在这里再存一份结果。
     */
    export let onOpenSeriesReorder: (g: SeriesGroup) => void = () => {};
    /**
     * 🔴 #629 折叠卡右键「批量关联」→ 打开**整个系列的逐条关联清单**（宿主 `openSeriesAssociate`）。
     * ⚠️ 与「排序号」同一条纪律：本组件只报「点了哪一组」「点了哪条菜单项」，弹窗与落库都在宿主侧。
     */
    export let onOpenSeriesAssociate: (g: SeriesGroup) => void = () => {};
    /** 右键「动词 · 去关联」直达：无入口时点主操作 → 快捷关联弹窗（不再整表单跳转） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onSetStatus: (id: string, s: MediaStatus) => Promise<void> = async () => {};
    export let onMarkUpdated: (id: string) => Promise<void> = async () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};
    /** 批量删除（多选）：一次 Modal 确认后逐条删（plugin.deleteEntries） */
    export let onBulkDelete: (ids: string[]) => Promise<void> = async () => {};
    /** 书籍卡片右键「添加摘抄」：打开摘抄弹窗并固定挂载该书 */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** #685 右键「记录时长 / 记录重温 / 记录周目」：打开记录弹窗并固定挂载该条目 */
    export let onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => void = () => {};
    /** #685 右键「添加短评 / 添加攻略」：打开文本记录弹窗并固定挂载该条目 */
    export let onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => void = () => {};
    /** 批量设置个人评分（rating 0 = 清除） */
    export let onBulkRating: (ids: string[], rating: number) => Promise<void> = async () => {};
    /** 批量追加标签（合并去重） */
    export let onBulkTags: (ids: string[], tags: string[]) => Promise<void> = async () => {};
    /**
     * #573 批量重排序号（**只在系列视图里出现**）：`pairs` = 逐条 `{ id, seriesIndex }` 补丁。
     * 🔴 「哪几条、各拿什么号」由纯模块 `planSeriesReindex` 算好再传下来 ⇒ 宿主只管落库。
     */
    // 🔴 #609：原 `onBulkSeriesIndex`（组件侧算补丁 → 宿主落库）**已整体撤除** —— 排序入口变成
    //    应用级弹窗后，补丁由宿主自己算（`main.openSeriesReorder` → `SeriesReorderModal` → `planSeriesReindexAll`），
    //    组件不再经手「哪几条拿什么号」。⛔ 别把它加回来（那会出现「组件也有一份编号逻辑」的第二真源）。
    /** 批量应用前置确认（批B）：返回 false = 用户取消。无撤销栈，把关口前移到动手之前 */
    export let onConfirmBulk: (message: string) => Promise<boolean> = async () => true;
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    /** 色彩主题：彩色显示类型色条；单色关闭（设置页配置，v0.4 起固定单色） */
    export let colorTheme: ColorTheme = 'colorful';
    /** 1.3.1 ①：海报墙卡片显示哪几行（高级设置 › 海报墙卡片）。
     *  🔴 #617 起**按条目类型各一份**（六键齐全，缺省 `DEFAULT_CARD_FIELDS_BY_TYPE`）——
     *     卡片按**自己那条的类型**取，所以一本书与一部电影可以显示不同的信息栏。
     *  🔴 数组顺序 = 渲染顺序；空数组 = 该类型三行都不显示（合法的用户选择）。 */
    export let cardFieldsByType: Record<EntryType, CardFieldKey[]> = DEFAULT_CARD_FIELDS_BY_TYPE;
    /** 🔴 #653：书籍**按子分类**（文学 / 网文 / 漫画）各一份的信息栏。
     *  ⚠️ 只对书籍生效；其余类型仍走 `cardFieldsByType`。缺省 = 三个子类都等于书籍那一份
     *     （回落链在 `pure/cardMeta.resolveCardFieldsByKind`，⛔ 别在组件里另写一套）。 */
    export let cardFieldsByKind: Record<BookKind, CardFieldKey[]> = {
        book: DEFAULT_CARD_FIELDS_BY_TYPE.book,
        novel: DEFAULT_CARD_FIELDS_BY_TYPE.book,
        comic: DEFAULT_CARD_FIELDS_BY_TYPE.book,
    };
    /** 1.3.1 ②（#621）：**表格视图的列**（按条目类型各一份；宿主已用 `resolveTableColumnsByType` 解析成六键齐全）。
     *  🔴 与上面的 `cardFieldsByType` **是两件事**（⛔ 别合并）：卡片信息栏是「精选 16 项、最多 5 行」，
     *     表格列是「该类型全部可写可读字段」。混在一起卡片那边会冒出 40 个候选。 */
    export let tableColumnsByType: Record<EntryType, string[]> = DEFAULT_TABLE_COLUMNS_BY_TYPE;
    /** 列配置变更（表头拖序 / 列菜单勾选）⇒ 回推宿主落盘（⛔ 组件不自己存一份设置） */
    export let onTableColumnsChange: (type: EntryType, keys: string[]) => void = () => {};
    /** 一格提交 ⇒ 宿主写回条目 + 笔记 + 刷新视图（组件只算 patch，**不碰 obsidian / 磁盘**） */
    export let onCellCommit: (id: string, patch: Partial<MediaEntry>) => Promise<void> = async () => {};
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list；页内切换只影响本次（#598 起还能切到时间线） */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 海报密度（设置页配置，用户 2026-09-22；pure/posterGrid 归一）：决定海报墙的最小卡片宽度 /
     *  自定义列数。⛔ 只作用于海报墙 —— 瀑布流列数走 masonryCols（用户 D-4 裁定不管瀑布流） */
    export let posterDensity: PosterDensity = 'standard';
    /**
     * 自定义列数的目标列数（仅 posterDensity === 'custom' 生效；实际列数仍由容器宽度决定）。
     * 🔴 用户 2026-10-20 删除「海报墙列数」后，这是**卡片网格 / 瀑布流 / 海报墙共用**的唯一列数真源
     *    （墙不再有自己的 `wallColumns` —— 那个 prop 已随设置项一起下线）。
     */
    export let posterColumns: number = POSTER_COLUMNS_DEFAULT;

    /**
     * 🔴 #591 Ctrl+滚轮缩放开关（设置页「外观与体验 › Ctrl + 滚轮缩放」，缺省关）。
     * `true` = 在本视图里**拦截** Ctrl+滚轮的默认页面缩放，改为缩放内容区卡片。
     */
    export let ctrlWheelZoom: boolean = false;
    /**
     * 🔴 #668「切换视图」各档的**显示顺序**（用户自由拖排，持久化在设置 `viewOrder` 里）。
     * ⚠️ 传的是**原始配置**（可能缺键 / 脏），归一由 `pure/viewModes.normalizeViewOrder` 在阅读时做 ——
     *    ⛔ 别在宿主里也归一一次（两处归一必然漂）。
     */
    export let viewOrder: string[] = [];
    /** 拖完后回写宿主落盘（与 `onTableColumnsChange` 同一条通道） */
    export let onViewOrderChange: (order: string[]) => void = () => {};
    /**
     * 🔴 #668 时间线视图自己的缩放档（持久化在设置 `timelineZoom` 里）。
     * ⚠️ 与海报密度**分开存**：共用会让「在时间线上缩一次，卡片网格也跟着变」（`wallColumns` 同款教训）。
     */
    export let timelineZoom: number = TL_ZOOM_DEFAULT;
    /** 时间线缩放后回写宿主落盘 */
    export let onTimelineZoomChange: (zoom: number) => void = () => {};
    /**
     * 🔴 #591 Ctrl+滚轮缩放的**回推出口**（受控口径：值由宿主持有并落盘）。
     * 宿主收到后写 `posterDensity = 'custom'` + `posterColumns = n` ⇒ `syncPosterGrid()` 重推
     * ⇒ 「海报密度」那一行自动显示为「自定义列数」（用户：「两者并存……下拉框需自动显示为自定义」）。
     * ⚠️ 未注入时（其它宿主 / 单测）整条缩放链路**静默不生效**（⛔ 不写一个点了没反应的手势）。
     * 🔴 #626 第 3 参 `view`：`grid`（含瀑布流）/ `wall` 两条落盘路分开 ——
     *    墙上缩放写 `wallColumns`，⛔ 不再连带改掉卡片网格的列数。
     */
    export let onPosterZoom: ((density: PosterDensity, columns: number, view: 'grid' | 'wall') => void) | null = null;
    /** 锁定类型（Tab 维度的分类视图）：传入时 typeFilter 受控，工具栏不显示类型 chips */
    export let lockType: EntryType | null = null;
    /** 类型池限制（聚合页签如「影视」）：传入时筛选 chips 只显示这些类型；null 显示全部类型 */
    export let typePool: EntryType[] | null = null;
    /**
     * 🔴 #547 / #550 合并视图：**媒体类型作用域**（`'all' | BookKind | 非书籍 EntryType`），由宿主驱动。
     * ⚠️ `null` = 非合并视图（本组件自管筛选，行为与 1.2.1 完全一致）。
     * ⚠️ 它**不替代** `lockType`：宿主已按 `pure/mergedScope.mergedLockType(scope)` 把锁类型推好，
     *    本组件只额外拿它同步**书籍子分类**（`kindFilter` 是内部态，宿主碰不到）。
     * 🔴 #550：`scope !== null` 时，原来那两排「类型 chips / 书籍子分类 chips」**整体退场**，
     *    改由下面那枚「媒体类型」下拉承担（9 项里已含 文学 / 网文 / 漫画，⛔ 不再并排出现）。
     */
    export let scope: MergedScope | null = null;
    /** 🔴 #547 合并视图：状态筛选由宿主受控（null = 自管） */
    export let scopeStatus: MediaStatus | 'all' | null = null;
    /** 🔴 #547 合并视图：排序由宿主受控（null = 自管） */
    export let scopeSort: SortBy | null = null;
    /**
     * 🔴 #550 三件筛选**回推宿主**：合并视图下宿主是唯一真源，本组件只是受控显示 ——
     *    用户在下拉里改值必须报回宿主，否则下一次宿主重推就把这次改动抹掉（症状 = 「选了没反应」）。
     *    ⚠️ 非合并视图下这几个回调**不会被调用**（那三枚下拉只有合并视图才受控，其余情况本组件自管）。
     */
    export let onScopePick: (scope: MergedScope) => void = () => {};
    export let onStatusPick: (status: MediaStatus | 'all') => void = () => {};
    export let onSortPick: (sort: SortBy) => void = () => {};
    /**
     * 🔴 需求 9（用户 2026-10-21）：**列表视图**「展示分组 / 不并组展示」的单循环开关。
     * `true`（含缺省）= 展示分组（同系列折叠成合集行 + 可展开成员子行，即 #592 起的老口径）；
     * `false` = 不并组展示（每条独立一行，行序 = `filtered` 的顺序，见 `pure/seriesGroup.listFlatRows`）。
     * ⚠️ 只作用于**列表视图** —— 海报墙 / 卡片网格 / 瀑布流 / 时间线**行为不变**
     *    （需求原文只点名列表视图；摊平那几种视图等于把同系列的 13 部散成 13 张卡，与 #592 的裁定相反）。
     * ⚠️ 缺省 `true`：设置里 `undefined` 也当「展示分组」（老库没这个键 ⇒ 观感与升级前一致）。
     */
    export let listGrouping = true;
    /**
     * 上面那枚按钮的回推出口（受控口径：值由宿主持有并落盘，⛔ 组件不自己存一份设置）。
     * ⚠️ **未注入（`null`）时整枚按钮不渲染** —— 本仓铁律：没接线就不画一个点了没反应的按钮。
     */
    export let onToggleGrouping: ((next: boolean) => void) | null = null;

    /**
     * 当前视图。
     * 🔴 #598：类型从写死的四元组改成 `ViewMode | 'grouped'` —— 通用视图表在 `pure/viewModes`
     *    （现 4 档：海报墙 / 列表 / 瀑布流 / **时间线**），`grouped` 是音乐专有那一档。
     *    ⚠️ 以后加视图只改 `pure/viewModes` 的 `VIEW_MODES` / `VIEW_LABELS` / `VIEW_ICONS` 三张表
     *    ＋ 本组件一条渲染分支，⛔ 不用再回来改这个联合类型（改这里必然漏）。
     */
    let viewMode: ViewMode | 'grouped' = defaultViewMode;
    /**
     * 瀑布流列数。
     * 🔴 D-4 仍成立：**档位**（紧凑 / 标准 / 宽松）不管瀑布流 —— 缺省按窗口宽度（宽窗 6 / 中窗 4 / 窄窗 3）。
     * 🔴 #591 唯一例外：`posterDensity === 'custom'` 时改用 `posterColumns`。
     *    理由：那时用户给的是一个**列数**（不是档位）—— Ctrl+滚轮缩放与「自定义列数」都会落到这里，
     *    若瀑布流仍走窗口宽度，就会出现「同一屏里海报墙缩了、瀑布流没缩」的割裂（用户在两个视图间来回切）。
     */
    function initialMasonryCols(): number {
        if (typeof window === 'undefined') return 4;
        const w = window.innerWidth;
        return w > 1300 ? 6 : w > 900 ? 4 : 3;
    }
    let masonryCols = initialMasonryCols();
    $: masonryCols = posterDensity === 'custom' ? normalizePosterColumns(posterColumns) : initialMasonryCols();
    function splitMasonry(items: MediaEntry[], cols: number): MediaEntry[][] {
        const out: MediaEntry[][] = Array.from({ length: cols }, () => []);
        items.forEach((it, idx) => out[idx % cols].push(it));
        return out;
    }

    /**
     * 🔴🔴 #624 瀑布流「**等宽不等高**」的已加载集合（用户 2026-10-13：「瀑布流视图改成等宽不等高」）。
     *
     * 占位与真实比例的分工：
     *   · 加载**前** ⇒ CSS 给 `aspect-ratio: 2/3`（不让未解码的图把卡片塌成 0 —— #623 实测过）；
     *   · `on:load` 一到 ⇒ 把 id 记进来 ⇒ 那一张的 `aspect-ratio` 让回给图片固有比例（高度参差）。
     *
     * ⚠️ 用 **id 集合**而不是直接 `classList.add`：瀑布流的 `{#each}` **没有 key**、DOM 会被复用，
     *    挂在元素上的类会跟着元素串到**另一个条目**上（表现为「某张明明没加载完却按原比例排」）。
     *    按 id 判 ⇒ 类由「当前这张是谁」决定，天然免疫。
     * ⚠️ 加载**失败**时 `load` 不触发 ⇒ 那一张一直停在 2:3 占位（比塌成 0 好，也不会跳）。
     * ⚠️ 集合只增不减：条目被删/换页后残留几个死 id，代价是一次 `has()` 查表，不值得为它写清理。
     */
    let loadedCovers = new Set<string>();
    function markCoverLoaded(id: string): void {
        if (loadedCovers.has(id)) return;
        loadedCovers = new Set(loadedCovers).add(id);
    }

    /**
     * 🔴 #591 Ctrl + 滚轮缩放（海报墙 / 瀑布流两处共用）。
     *
     * 三条纪律：
     *  ⑴ **只在开关打开且回推出口在**时才接管（`ctrlWheelZoom` / `onPosterZoom`）；否则原样放行。
     *  ⑵ 只有 `ev.ctrlKey` 才算缩放手势 —— 单独滚轮 = 正常滚动（⛔ 不许顺手拦）。
     *  ⑶ 🔴 监听必须**挂在元素上并显式 `{ passive: false }`**：Chrome 把 `window` / `document` / `body`
     *     上的 `wheel` 当**被动**监听（`preventDefault()` 无效并报 warning）⇒ 那样根本拦不住系统缩放。
     *
     * 步进方向 = 与浏览器一致（向上滚 = 放大 = 卡片变大 = **列数 -1**，见 `posterZoomColumns`）。
     * ⚠️ 一次滚轮手势会连发几十个 `wheel` ⇒ 时间戳**限流**，否则一划就从 12 列窜到 1 列。
     */
    /** 时间线当前缩放档（已归一）+ 每档对应的条目宽度 —— 模板里只读这两条反应式 */
    $: tlZoom = normalizeTimelineZoom(timelineZoom);
    $: tlItemW = timelineItemWidth(tlZoom);

    const ZOOM_THROTTLE_MS = 140;
    let lastZoomAt = 0;
    /**
     * 🔴 #626 `kind` 多一档 `'wall'` —— 海报墙与卡片网格**共用同一个容器**，
     * 缩放的上界与落盘出口按视图分流（见下）。
     * ⚠️ 参数一变 Svelte 会**重建这个 action**（旧监听先 destroy）—— 切视图时正好需要这个行为。
     */
    function zoomWheel(node: HTMLElement, kind: 'grid' | 'wall' | 'masonry' | 'timeline') {
        const onWheel = (ev: WheelEvent) => {
            // 🔴 守卫按 kind 分流（#668）：海报三档要 `onPosterZoom`；**时间线只认自己的 `onTimelineZoomChange`**
            //    —— 原写法 `if (!ctrlWheelZoom || !onPosterZoom) return;` 会让「时间线没传海报缩放出口」时
            //    整条路被挡掉（实测：探针不传 onPosterZoom，时间线 Ctrl+滚轮毫无反应）。
            // ⚠️ 开关仍是同一条 `ctrlWheelZoom`（用户在设置里统一控制），⛔ 别给时间线另开一个开关。
            if (!ctrlWheelZoom) return;
            const isTimeline = kind === 'timeline';
            if (!isTimeline && !onPosterZoom) return;
            if (isTimeline && !onTimelineZoomChange) return;
            if (!ev.ctrlKey) return;
            ev.preventDefault();   // 拦截系统默认缩放（Chromium 的 Ctrl+wheel 页面缩放）
            ev.stopPropagation();
            const now = Date.now();
            if (now - lastZoomAt < ZOOM_THROTTLE_MS) return;
            const dir: 'in' | 'out' = ev.deltaY < 0 ? 'in' : 'out';
            // 🔴 #668 时间线**不是列数模型**（按年份横向铺条目，没有「列」）⇒ 走自己的宽度档，
            //    也写自己的设置键。⛔ 别把它塞进 `onPosterZoom`（那会顺手改掉卡片网格的列数）。
            if (isTimeline) {
                const nextZ = timelineZoomStep(tlZoom, dir);
                if (nextZ === normalizeTimelineZoom(tlZoom)) return; // 已到边界 ⇒ no-op，不落盘
                lastZoomAt = now;
                onTimelineZoomChange(nextZ);
                return;
            }
            const isWall = kind === 'wall';
            // 从**实际渲染的列数**起步（用户眼前那个数），⛔ 不用设置里那份可能属于别的档位的数
            // 🔴 用户 2026-10-20 删除「海报墙列数」后，墙**没有第二套起步值**了 —— 与卡片网格同源。
            const cur = kind === 'masonry'
                ? masonryCols
                : measuredColumns(node) ?? posterColumns;
            // 🔴🔴 #598 **翻面**：不再按容器宽度夹上限（那套「卡片不小于 180px」实测把**缩小**堵死了：
            //    1080px 宽时限成 5 列 ⇒ 从 5 列再滚恒 no-op，用户报的正是「缩小失灵」）。
            //    上下界回到列数常量：放大到 1 列、**缩小到 `POSTER_COLUMNS_MAX`**。
            // 🔴 #626 曾经给墙开过一档更宽的上界（16 列），随「海报墙列数」设置项一起下线 ——
            //    ⛔ 别再加回来：那会让墙停在一个设置页调不动的列数上。
            const max = POSTER_COLUMNS_MAX;
            const next = posterZoomColumns(cur, dir, max);
            if (next === normalizePosterColumns(cur, max)) return;   // 已在边界 ⇒ 不动（天然 no-op，不落盘）
            lastZoomAt = now;
            onPosterZoom('custom', next, isWall ? 'wall' : 'grid');
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return { destroy() { node.removeEventListener('wheel', onWheel); } };
    }
    /** 海报墙**当前实际列数**：读计算样式 `grid-template-columns` 的轨道数；读不到 → null（回落设置值）。 */
    function measuredColumns(node: HTMLElement): number | null {
        try {
            const tpl = getComputedStyle(node).gridTemplateColumns;
            if (!tpl || tpl === 'none') return null;
            const n = tpl.trim().split(/\s+/).length;
            return n > 0 ? n : null;
        } catch {
            return null;
        }
    }
    let statusFilter: MediaStatus | 'all' = 'all';
    let typeFilter: 'all' | EntryType = lockType ?? 'all';
    // 页签切换同步：单类型页签锁死该类型；聚合页签（影视）重置为「全部」——
    // 否则组件被 Svelte 复用时 typeFilter 停留在上一个页签的类型，切回影视页签卡片不显示
    $: if (lockType) typeFilter = lockType;
    else typeFilter = 'all';
    // 书籍子分类（1.0.3）：阅读页签 chips【全部/文学/网文/漫画】，缺省归文学（pure/bookKind，原「出版」；漫画 2026-09-30 加回）
    let kindFilter: 'all' | BookKind = 'all';
    const kindChips: ReadonlyArray<'all' | BookKind> = ['all', ...BOOK_KINDS];
    // 🔴 #547 合并视图受控同步（其一）：**书籍子分类**必须由 scope 同步 —— 它是内部态，宿主没有别的入口。
    //   ⚠️ 类型那一维走宿主推的 `lockType` ⇒ 上面那条「lockType 变则 typeFilter 跟随」的老规则**不动**
    //      （两处各管一维，⛔ 别合并；状态 / 排序的同步见下面 `sortBy` 声明之后）。
    $: if (scope !== null) kindFilter = mergedBookKind(scope);
    // 音乐页签子分类行已于 1.0.3.1 下线（用户 2026-09-13 裁定删除「其他」，音乐回归单一类目）
    /** 清除全部筛选与搜索条件（空态「清除筛选」按钮用）：锁定类型页签的类型不可改，只重置可变条件 */
    function clearFilters() {
        statusFilter = 'all';
        if (!lockType) typeFilter = 'all';
        if (lockType === 'book') kindFilter = 'all';
        searchText = '';
        debouncedSearch = ''; // 立即生效，不等 300ms 防抖
        genreSel = []; // 题材也是筛选条件之一：清除筛选必须一并清掉，否则空态按钮形同虚设
        // 🔴 #550：合并视图下「媒体类型 / 状态」是**宿主受控**的 ⇒ 清筛选必须一并回推。
        //    只清本地会被下一帧宿主的重推抹掉（症状 = 点了「清除筛选」页面纹丝不动）。
        if (scope !== null) {
            onScopePick('all');
            onStatusPick('all');
        }
    }
    let sortBy: SortBy = 'recent';
    // 🔴 #547 合并视图受控同步（其二）：**状态 / 排序**由顶端筛选栏推下来。
    //   ⚠️ 判据是「宿主给了值才覆盖」—— 没传（null）时本组件自管，行为与 1.2.1 逐字一致。
    $: if (scopeStatus !== null) statusFilter = scopeStatus;
    $: if (scopeSort !== null) sortBy = scopeSort;
    /**
     * 🔴 #550 三枚受控下拉的**选中处理**。**为什么写成函数、不在模板里写内联箭头**：
     *    模板表达式里的 TS 断言（`… as MergedScope`）编译不过（`Unexpected token`），
     *    而 `<script>` 里可以（同 `EntryForm.onTypeSelEl` 那条既有写法）。
     * 🔴 每一条都「先本地赋值、再回推宿主」：本地赋值保证**当帧**就有反馈（不等宿主重推），
     *    回推让宿主那份唯一真源跟上（不然下一帧宿主重推会把这次改动抹掉 = 「选了没反应」）。
     *    ⚠️ 非合并视图下 `onXxxPick` 是空实现 ⇒ 等价于原来的 `bind:value`。
     * 🔴 #566 翻面：自绘下拉（`MiniSelect`）的回调给的是**值**（`v: string`），不再是
     *    事件对象的 `currentTarget` —— 原生下拉控件连同它「从事件里读值」的形态一并退场。
     */
    function pickScope(v: string): void {
        onScopePick(v as MergedScope);
    }
    function pickStatus(v: string): void {
        const picked = v as MediaStatus | 'all';
        statusFilter = picked;
        onStatusPick(picked);
    }
    function pickSort(v: string): void {
        const picked = v as SortBy;
        sortBy = picked;
        onSortPick(picked);
    }
    /**
     * 列表排序（用户 2026-09-14 裁定）：**不提供表头点击排序** —— 排序统一走工具栏「排序」下拉
     * （SORT_OPTIONS 已覆盖标题/年份/状态/双评分 × 正反 12 向）。
     * 曾经做过两版表头排序（th 直接 onclick → th 内 button + aria-sort），最终按上手观感整体移除：
     * 表头看着像按钮却不易发现，与下拉并存反而让人犹豫「该点哪个」。
     */
    // ── 进度 / 阅读百分比 / 单位（🔴 #444c 已**下沉**到 `pure/mediaProgress`）──
    // 为什么要下沉：季列表弹窗改成了应用级 Modal（不再长在本组件里），而它每一格下面的「状态 · 进度」小字
    // 必须与卡片 / 列表**同一口径** ⇒ 那些函数搬到纯模块，本组件与 `SeriesPicker.svelte` 一起用。
    // ⛔ 别在这里再把它们写回来（两套口径必然漂移：卡面说「已读 40%」、弹窗说「存档」）。
    let searchText: string = '';
    let menuOpenFor: string | null = null;
    /** 右键菜单状态（#608 起**两个宿主共用一套容器与定位**）：
     *  · `ctxFor`      = **条目卡**右键（条目 id）→ 主操作 / 关联入口 / 编辑条目 / 删除条目…
     *  · `ctxGroupKey` = **系列折叠卡**右键（系列 key）→ 只有一条「排序号」（#608）。
     *  🔴 二者互斥（打开一个先清另一个）—— 菜单一次只属于一个对象。⛔ 别让两个同时非空。 */
    let ctxFor: string | null = null;
    let ctxGroupKey: string | null = null;
    let ctxX = 0;
    let ctxY = 0;
    /** 菜单超出视口可用区域时的封顶尺寸（视口过矮/过窄时给菜单内部滚动用） */
    let ctxMaxH: number | undefined = undefined;
    let ctxMaxW: number | undefined = undefined;
    let ctxAnchorEl: HTMLDivElement | null = null;
    let ctxMenuEl: HTMLDivElement | null = null;
    /** 菜单外点击 / Esc 关闭的 window 监听（每次打开重新绑定，关闭时摘除，避免累积） */
    let ctxOnDown: ((ev: MouseEvent) => void) | null = null;
    let ctxOnKey: ((ev: KeyboardEvent) => void) | null = null;
    /** 批量选择（列表视图 checkbox） */
    let selectedIds: Set<string> = new Set();
    /** 🔴 #680 ⑤：搜索框 DOM 引用（Ctrl+F 聚焦它 —— 见 `onWindowKeydown`） */
    let searchInputEl: HTMLInputElement | null = null;
    /**
     * 🔴🔴 #680 ③-3（用户：「最左侧常驻的勾选框干扰视线。默认隐藏勾选框，在列表顶部加一个『批量管理』
     * 入口；点击后进入多选模式，勾选框才出现，同时顶部浮现批量操作栏」）：
     * **批量模式开关**。只有它为真时，表头与各行的勾选列才渲染（`{#if batchMode}`）。
     * · 关掉 = 勾选全部清空（⛔ 别留半套：看不到勾选框却还带着选中项，下次删东西会删到看不见的东西）；
     * · 表格列里那一列也是条件渲染的 ⇒ 关掉时「标题」自动占满（不会留一条空列）。
     */
    let batchMode = false;
    function enterBatchMode(): void {
        batchMode = true;
    }
    function exitBatchMode(): void {
        batchMode = false;
        clearSelection();
    }
    /** 从「已选 N 项」的批量条一键退出（与「取消选择」的区别：它也关掉批量模式本身） */
    function finishBatch(): void {
        exitBatchMode();
    }
    let bulkStatus: MediaStatus | '' = '';
    let bulkRating = 0;
    let bulkTagsText = '';
    // ── 视图级题材筛选（用户 2026-09-22）──
    /**
     * 题材值真源 = 条目笔记元数据的 `genres` 字段（本项目 frontmatter 键就叫 genres，海报墙卡片
     * 题材行 `.rl-tags` 读的也是它）⇒ 池与卡片**同源**，不需要另读笔记文件、也不并入 tags
     * （tags 混着类型键与自定义标签）。纯逻辑全部下沉 pure/genreFilter。
     *
     * ⚠️ 这几条必须写在 `filtered` / `emptyState` **之前**：Svelte 4 的 `$:` 按源码顺序求值，
     * 后写的块在同一轮里读不到本轮刚算出的值（kindCounts → emptyState 同款坑）。
     */
    /** 题材面板开合 */
    let genreOpen = false;
    /** 已选题材值（题材名本身 / 未分类保留键）；空数组 = 不筛（胶囊显示「全部」） */
    let genreSel: string[] = [];
    /**
     * 作用域**复位键**（与 `genreScope.key` 同一口径，但**不经过 `filtered`** —— 见 `genreScopeKeyOf`）。
     * 🔴 #444 为什么要抽这一层：系列视图下 `genreScope` 依赖 `activeGroup`，而 `activeGroup` 是
     *    `foldSeries(filtered)` 查出来的 ⇒ 复位逻辑若直接读 `genreScope.key`，就构成
     *    `genreScope → 复位键 → genreSel → filtered → activeGroup → genreScope` 的**响应式环**
     *    （Svelte 4 对环只能退化成语义未定义的求值顺序）。这里只吃「视图标识」这几个量。
     */
    $: genreScopeKey = genreScopeKeyOf(lockType, typeFilter, lockType === 'book' ? kindFilter : 'all', activeSeriesKey);
    // 🔴 #435 的「系列」筛选下拉**已按用户要求整块删除**（原话：「删除这个筛选系列框，海报墙有且默认折叠起来」）
    //    ⇒ 工具栏回到「状态 / 排序 / 题材」三件；系列这件事只由**折叠卡**承担（默认就是叠起来的那个状态）。
    //    ⛔ 别再加回来 —— 断言脚本里有反向守卫钉着。
    /**
     * 子视图切换复位为「全部」（用户 D-7 裁定）：池与已选都按子视图隔离 ——
     * 阅读的「科幻」与网文的「科幻」是两个独立集合，影视三分类同理。
     * 作用域 key 一变（含 null ↔ 有值）即清空，否则会把 A 视图的选中带进 B 视图。
     * 🔴 #444：**系列视图也在此列** —— 从 A 系列进 B 系列、以及进出系列视图都会清空
     *    ⇒「每个系列视图拥有独立题材池，互不影响」。
     */
    let genreScopeKeyPrev = '';
    $: if (genreScopeKey !== genreScopeKeyPrev) {
        genreScopeKeyPrev = genreScopeKey;
        genreSel = [];
        closeGenre();
    }

    /** 筛选栏状态 chips：全部/想看/在看/已看/存档（弃剧已移除） */
    const statusChips: (MediaStatus | 'all')[] = ['all', 'want', 'watching', 'watched', 'archived'];
    // 🔴 #566 自绘下拉（MiniSelect）的选项表：`value/label` 对 —— 模板里不再写 `<option>`。
    const scopeOptions = MERGED_SCOPES.map((s) => ({ value: s as string, label: mergedScopeLabel(s) }));
    // 状态的 label 随 lockType 变（非合并视图的状态名按类型给）⇒ 保持响应式
    $: statusOptions = statusChips.map((s) => ({ value: s as string, label: s === 'all' ? '全部' : statusLabel(lockType ?? 'movie', s) }));
    // 排序选项表换 `value/label` 对（⛔ map 别写在模板里 —— 表达式写不了 TS 断言，本批实测）
    $: sortSelOptions = sortOptions.map((o) => ({ value: o.value, label: o.label }));
    /** 类型筛选 chips：受 typePool 限制（聚合页签仅影视三类）；null 时显示全部类型 */
    $: typeChips = (['all'] as ('all' | EntryType)[]).concat(typePool ?? ENTRY_TYPES);
    /** 排序下拉选项：每项排序成对提供正/反向 —— 表在 `pure/sortOptions`（#547 起与顶端筛选栏共用一份） */

    // 🔴 #547：工具栏那枚「N 项媒体 / N 本书」**库概览已按用户要求整体删除**
    //    （用户原话「把 90 项媒体统计去除了没用」—— 那串字正是**没有类型时概览量词函数的兜底词**）。
    //    ⛔ 别再把它加回来；连带它依赖的两件纯逻辑（量词函数与书籍子分类量词表）也一起删了
    //      （**只剩这一个使用者** ⇒ 留着就是死码，本仓「死码不留」）。
    //    ⚠️ 这里**刻意不写出那两个被删导出名** —— 注释会进产物，写了会撞红自己的反向守卫（本仓老坑）。

    /** 搜索占位符随当前类型动态（书籍=书名/作者、游戏=标题/开发商、音乐=标题/作者，均已真实参与 matchesSearch）
     *  🔴 #689：影视 / 动画补「导演」—— 用户要求「列表视图全局搜索框可按导演筛选显示条目」，
     *    占位符必须跟上，否则功能做了也没人知道（⛔ 别只改逻辑不改文案）。 */
    $: searchPlaceholder = (() => {
        const t = lockType ?? (typeFilter !== 'all' ? typeFilter : null);
        if (t === 'book') return '搜索书名、作者…';
        if (t === 'game') return '搜索标题、开发商…';
        if (t === 'music') return '搜索标题、作者…';
        if (t === 'movie' || t === 'tv' || t === 'anime') return '搜索标题、导演…';
        return '搜索标题…';
    })();

    // C2 搜索防抖：输入 300ms 后才过滤，百级条目不卡
    let debouncedSearch = '';
    let searchTimer: number | undefined;
    $: {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            debouncedSearch = searchText;
        }, 300);
    }

    // 纯逻辑下沉的搜索/筛选/排序（pure/search.filterAndSort）：保证单测可锁定回归
    $: filtered = filterAndSort(entries, {
        status: statusFilter,
        type: lockType ?? typeFilter,
        query: debouncedSearch,
        sortBy,
        bookKind: lockType === 'book' ? kindFilter : undefined,
        genres: genreSel,
    });

    // 🔴🔴 #570（用户 2026-10-08：「海报墙条目**取消上限取消分页**」）：分页那套**整体退场**（含它那个
    //    纯模块与单测，一起删掉了）—— 本组件不再分页，**一次给出全部行**（`listRows = rowSource`）。
    //    ⚠️ 敢全量渲染的前提是本插件的量级是**百级条目**（见 PRODUCT），且封面是懒加载；
    //       ⛔ 别再引回任何「每页 N 条」的切片（那正是用户点名要去掉的东西）。

    // 🔴 #570 连带退场：那套「筛选 / 搜索 / 排序变化 ⇒ 回落第 1 页」的响应块（连同它用的那个 key 变量）
    //    随分页一起去掉了。
    //    ⚠️ 它当年还背着一条 #441 的结论「**筛选不把用户踢出系列视图**」—— 那条**结论继续有效**，
    //       但载体从「那个块的注释」变成了**结构**：`activeSeriesKey` 全仓**只在 `closeSeries()` 里**
    //       被置回 null（⛔ 别在任何筛选/排序/搜索的响应块里再写它）。

    // ── 系列（#434 折叠卡 / #437 单系列视图）：把「行」的概念插在 filtered 与绘制之间 ──
    /**
     * 绘制元素：散卡 / 折叠卡 / 组头三种，摊平成一维序列后由**同一段**卡片标记渲染。
     * 🔴 为什么要摊平：卡片标记近 90 行，若把「折叠」「系列视图」两态各写一遍就是三份拷贝 ——
     *    本仓「多个入口各写一套」栽过多次，复制三份必然漂移。摊平后卡片标记只写一遍。
     */
    type DrawItem =
        | { kind: 'card'; entry: MediaEntry }
        | { kind: 'folded'; group: SeriesGroup };

    /**
     * 当前**正在看的那个系列**（键 = `pure/seriesGroup.seriesKeyOf`）；`null` = 看整面墙（默认）。
     *
     * 🔴🔴 用户 2026-09-30 的第二次返工（#437，原话：「**其他条目怎么也在这个海绵宝宝系列里面**，
     *    应该**单独显示**，比如写了 2 个序号就展示这两个」）：
     *    上一版把「展开」做成**在整面墙里就地摊开**（组头 + N 张成员卡，紧接着就是**别的条目**）——
     *    成员卡与散卡同款同尺寸、成员之后又没有收尾边界，**看起来像后面那些条目也属于这个系列**。
     *    ⇒ 现在点折叠卡 = **进这一系列自己的视图**：墙上**只剩它的 N 条**，组头那枚按钮从「收起」改成
     *    「返回全部」。这样「哪些属于这个系列」不再靠肉眼分辨，而是**由视图本身保证**。
     * ⚠️ 墙上的默认态仍然是**折叠**（`activeSeriesKey` 初值 null）⇒ 用户要的「海报墙有且默认折叠」不变。
     */
    let activeSeriesKey: string | null = null;
    /**
     * 进系列视图前的排序档（#441）：系列视图是**临时交互态**（#437 的定位），
     * 离开时把它**原样还回去** —— ⛔ 别让「进去看一眼」把用户的排序偏好改掉。
     * ⚠️ 只有「用户在视图里没改过排序」时才还原（改过就以他改的为准）。
     */
    let sortBeforeSeries: SortBy | null = null;
    /**
     * 进系列视图前的**视图类型**（#444）：系列视图内的 grid/list/masonry 切换同样是**临时**的，
     * 退出时原样还原外层 —— 「每个系列视图可独立切换视图类型」的另一半就是**别把外面也改掉**。
     */
    let viewModeBeforeSeries: ViewMode | 'grouped' | null = null;

    /**
     * 系列视图的 **Esc 出口**（#444 用户：「仅在按 esc 退出系列视图才重新显示」）。
     * 🔴 逐层退出：季列表面板 / 右键菜单 / 题材面板还开着时，Esc 先关它们（第一下关弹窗、
     *    第二下才退系列视图）—— 与「Esc 关闭最内层浮层」的直觉一致；否则一按就直接跳回整面墙，
     *    用户在弹窗里按 Esc 会被弹到墙外。
     * ⚠️ 只在**系列视图存续期间**挂着（`openSeries` 绑、`closeSeries` 摘），不常驻。
     */
    let seriesViewOnKey: ((ev: KeyboardEvent) => void) | null = null;
    function unbindSeriesViewEsc(): void {
        if (!seriesViewOnKey) return;
        window.removeEventListener('keydown', seriesViewOnKey);
        seriesViewOnKey = null;
    }
    function bindSeriesViewEsc(): void {
        if (seriesViewOnKey) return;
        seriesViewOnKey = (ev: KeyboardEvent) => {
            if (ev.key !== 'Escape') return;
            // 🔴 #608：折叠卡右键菜单（`ctxGroupKey`）与条目右键菜单**同一层**，一并算作最内层
            if (ctxFor || ctxGroupKey || genreOpen || viewOpen) return; // 更内层的浮层（右键菜单 / 题材面板 / 视图菜单）优先
            closeSeries();
        };
        window.addEventListener('keydown', seriesViewOnKey);
    }

    function openSeries(key: string): void {
        activeSeriesKey = key;
        sortBeforeSeries = sortBy;
        viewModeBeforeSeries = viewMode;
        // 🔴 系列视图**默认按系列序号排**（用户点名）；随后可在排序下拉里换成别的 —— 换了就照换的来。
        sortBy = 'series-asc';
        bindSeriesViewEsc();
    }
    function closeSeries(): void {
        activeSeriesKey = null;
        unbindSeriesViewEsc();
        // 🔴 #444：系列序号那两档**只存在于系列视图**（`sortOptions`）⇒ 离开时必须换回一个还在的档，
        //    否则下拉会显示成空白（用户看不出自己选了什么）。
        if (sortBy === 'series-asc' || sortBy === 'series-desc') sortBy = sortBeforeSeries ?? 'recent';
        sortBeforeSeries = null;
        // 系列视图内切过的视图类型**不带走**（见 `viewModeBeforeSeries`）
        if (viewModeBeforeSeries !== null) viewMode = viewModeBeforeSeries;
        viewModeBeforeSeries = null;
    }
    /**
     * 折叠卡右下角那枚按钮（▶ / 阅读）的点击处理。
     * 🔴 必须挡冒泡：按钮长在折叠卡里，不挡的话这一下会**顺手把「进系列视图」也触发了**
     *    （⛔ 别只在模板里写 `ev.stopPropagation()` 了事 —— 那样这里就成了第二处口径，迟早漏一边。
     *     ⚠️ 也⛔ 别在模板里写 `as HTMLElement`：svelte-preprocess 处理模板表达式时不认 TS 断言）。
     */
    function openSeriesFromCard(group: SeriesGroup, ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        (ev.currentTarget as HTMLElement | null)?.blur(); // 收起焦点圈（与卡片上其它按钮一致）
        onOpenSeriesPicker(group);
    }
    /**
     * 🔴 #592：**列表视图**里哪些合集被展开（缺省全**收起** —— 用户点名「默认收起 + 箭头」）。
     *
     * ⚠️ 只存**分组键**（⛔ 不存组对象：组被筛空 / 跌到只剩 1 条就不再成组，存对象会让状态与视图脱节）。
     * ⚠️ 有意**不持久化**（用户裁定：刷新 / 换页签后回到收起态）⇒ 就是个普通局部 state。
     *    🔴 Svelte 4 靠**赋值**触发更新 ⇒ 用数组整体赋值，⛔ 别用 `Set.add`（那样改了不重渲染）。
     */
    let openGroupKeys: string[] = [];
    function toggleGroup(key: string): void {
        openGroupKeys = openGroupKeys.includes(key) ? openGroupKeys.filter((k) => k !== key) : [...openGroupKeys, key];
    }
    function isGroupOpen(key: string): boolean {
        return openGroupKeys.includes(key);
    }
    function openSeriesFromList(key: string): void {
        // 进「单系列视图」= 现有那条路（`openSeries` 会把排序切到系列序号，与折叠卡上的入口一致）
        openSeries(key);
    }
    /**
     * 🔴 #594：父级行勾选框的**三态**（用户：「合集条加个勾选框，一勾选子条目也被勾选」）。
     *
     * · `groupAllSelected` → `checked`（整组都选了）｜`groupSomeSelected` → `indeterminate`（只选了一部分）
     * ⚠️ 判据读**组的全部成员**，⛔ 不读「当前可见的那些」—— 收起状态下子行根本没渲染，
     *    而勾选语义应当覆盖整组（否则「收起后只勾一半」会得出错的半选态）。
     * ⚠️ 与行首单条勾选**共用 `selectedIds` 这一份真源**（⛔ 别为组另存一份选中态）。
     */
    function groupAllSelected(g: SeriesGroup): boolean {
        return g.items.length > 0 && g.items.every((it) => selectedIds.has(it.id));
    }
    function groupSomeSelected(g: SeriesGroup): boolean {
        return !groupAllSelected(g) && g.items.some((it) => selectedIds.has(it.id));
    }
    /** 勾 / 取消**一整组**（已全选 ⇒ 清掉这一组；否则 ⇒ 补齐这一组） */
    function toggleGroupSelection(g: SeriesGroup): void {
        const next = new Set(selectedIds);
        if (groupAllSelected(g)) for (const it of g.items) next.delete(it.id);
        else for (const it of g.items) next.add(it.id);
        selectedIds = next; // 🔴 整体换新（Svelte 4 靠赋值触发更新）
    }
    /**
     * `indeterminate` 是**属性、不是 attribute** ⇒ 只能写 DOM 属性，用 Svelte action 最省事。
     * ⛔ 别用 `bind:this` 再手动赋值：`{#each}` 里那是一个**共享变量**，最后一行会覆盖前面所有行。
     */
    function indeterminate(node: HTMLInputElement, v: boolean): { update: (v: boolean) => void } {
        node.indeterminate = v;
        return {
            update: (nv: boolean) => {
                node.indeterminate = nv;
            },
        };
    }
    /**
     * 🔴 #444 **翻面**：切换视图类型**不再离开系列视图**（用户：「每个系列视图可独立切换视图类型
     * （海报墙/列表/瀑布流），切换时不改变其系列视图」）。
     * ⚠️ #441 那条「折叠 / 系列视图只属于海报墙」的老口径**作废** —— 系列视图现在三态通吃：
     *    `rowSource` 在系列视图下一律只喂**这一组**的条目（见那里），列表 / 瀑布流也只显示它。
     * ⚠️ #444c：原来这里还要**顺手收掉季列表面板** —— 那个面板已改成**应用级 Modal**、不再是本组件里的浮层，
     *    ⇒ 这整块响应式逻辑（连同它记的「上一个视图类型」）一起退场：已经没有任何东西要关了。
     */


    /**
     * 折叠**只在海报墙（grid）视图**生效。
     * 🔴 列表 / 瀑布流是「逐条目」的阅读单位（每行/每张小卡就是一个条目），折起来会把 N 条藏进一张卡里、
     *    反而看不出条目 —— 与折叠卡的初衷（海报墙一屏同质海报）不是一回事。
     * ⚠️ 非 grid 视图下 `rows` 全是散卡 ⇒ 「摊回条目」的结果**与原口径逐条等价**（列表/瀑布流零回归）。
     */
    $: seriesRows = foldSeries(filtered);
    /**
     * 从分组结果里按键取组（**唯一入口**）：
     * ⚠️ 两个消费者（系列视图 / 折叠卡）都走它 ——
     * ⛔ 别各写一份 `.find(...)`（本仓「多个入口各写一套」栽过多次，判等条件一漂就是「点开是空面板」）。
     * 🔴 **不许把组对象存进 state**：从 `seriesRows` 查 ⇒ 被筛掉 / 只剩 1 条不再成组时**自动查不到**，
     * 视图与面板都会**自动回落/自动关闭**，⛔ 不需要任何手写的兜底分支。
     */
    function findSeriesGroup(rows: SeriesRow[], key: string): SeriesGroup | null {
        const row = rows.find((r): r is Extract<SeriesRow, { kind: 'series' }> => r.kind === 'series' && r.group.key === key);
        return row?.group ?? null;
    }
    /** 系列视图对应的组（null = 看整面墙） */
    $: activeGroup = activeSeriesKey ? findSeriesGroup(seriesRows, activeSeriesKey) : null;

    /**
     * 🔴 #449 **组一消失就退出系列视图**（用户：「进入了一个系列折叠卡后，又切换到其他如游戏视图，
     * 排序按钮会空白，退出系列折叠卡又恢复正常」）。
     *
     * 根因：本组件是**单实例复用**（HomeView 那支 `{:else}` 通吃 计划/阅读/影视/游戏/音乐），换页签只换
     * `lockType` / `entries` ⇒ `activeSeriesKey` 留着，而新页签里根本没有那一组（`activeGroup` = null）⇒
     * `sortOptions` 退回**不含 `series-*`** 的那份，而 `sortBy` 还停在 `series-asc` ⇒ `bind:value` 匹配不到任何选项
     * ⇒ **下拉显示成空白**（用户看不出自己选了什么）。`closeSeries()` 里那句「换回一个还在的档」只挂在显式出口上，
     * 换页签这条路径绕过了它。
     *
     * ⚠️ 与 #444 不冲突：那条「切换**视图类型**不退出系列视图」说的是同一范围换长相（grid/list/masonry）。
     * ⛔ 也别改成「只在换页签时退出」：组被**筛空** / 被删到**只剩 1 条**（不再成组）时同样查不到 —— 一并兜住。
     * ⚠️ 判空写进**函数体**：Svelte 4 的依赖分析不穿透函数体 ⇒ 这个 `$:` 不会与 `activeSeriesKey` 形成自环
     *    （写回也在函数里，编译器看不见 ⇒ 既不报「Cyclical dependency」也不会多出构建告警）。
     */
    function exitVanishedSeries(): void {
        if (activeSeriesKey) closeSeries();
    }
    $: if (activeSeriesKey && !activeGroup) exitVanishedSeries();

    // ── 题材作用域 / 池 / 选项（🔴 #444：从文件上部**搬到这里** —— 系列视图下它会读 `activeGroup`）──
    /**
     * 当前子视图的题材作用域：null = 该视图不提供题材筛选（阅读-全部 / 影视-全部 / 上层聚合视图）。
     * 🔴 #444：**系列视图恒提供**（`seriesGenreScope`，恒非 null）—— 系列视图本身就是具体子集，
     *    哪怕它从「影视-全部」这种不提供题材筛选的视图点进来（折叠卡在任何类型下都可能出现）。
     */
    $: genreScope = activeGroup
        ? seriesGenreScope(activeGroup.key, activeGroup.type)
        : resolveGenreScope(lockType, typeFilter, lockType === 'book' ? kindFilter : 'all');
    /**
     * 系列视图的池 = 该系列**全部**条目（不经状态 / 搜索 / 题材 —— 与普通视图池同口径）。
     * ⛔ 别改用 `activeGroup.items`：那是已经按状态与搜索筛过的，会让「一选状态 ⇒ 题材选项凭空少一排」。
     */
    $: seriesPoolEntries = activeSeriesKey ? entries.filter((e) => seriesKeyOf(e) === activeSeriesKey) : [];
    /** 题材池 = 当前子视图池（类型 / 分类收窄之后、状态与搜索之前 —— 与状态 chips 计数同口径） */
    $: genrePool = activeGroup ? seriesPoolEntries : genreScope ? entries.filter((e) => matchesGenreScope(e, genreScope)) : [];
    $: genreOptions = buildGenreOptions(genrePool);
    $: genrePill = genrePillLabel(genreOptions, genreSel);
    /** 池内是否已全选（含「未分类」；空池不算全选）—— 供「全选 ⇄ 清空」按钮切文案与行为 */
    $: allGenresSelected = genreOptions.length > 0 && genreOptions.every((o) => genreSel.includes(o.key));

    /**
     * 🔴 #444：**系列序号排序档只在系列视图里出现**（用户：「默认全类型视图下不显示系列序号排序状态」）。
     * ⚠️ 系列视图**默认**就是 `series-asc`（`openSeries` 切的）⇒ 下拉里必须有它，
     *    否则 `bind:value` 匹配不到任何选项、下拉会显示成空白。
     */
    $: sortOptions = activeGroup ? SORT_OPTIONS : SORT_OPTIONS_BASE;

    /**
     * 行序列。🔴 系列视图下**只喂这一组的条目**（当作散卡）⇒ 分页 / 「共 N 条」/ 批量选择
     * 全部自动跟着收窄，⛔ 不必为系列视图另写一套（另写一套 = 迟早与本口径漂移）。
     */
    // 🔴 #441：系列视图里的顺序**跟着排序下拉走**（默认那档 = 系列序号，由 `openSeries` 切过去）。
    //    原来这里是「直接拿 `activeGroup.items`」⇒ 下拉点了完全没反应，用户以为是坏了。
    //    ⚠️ 这里只**重排**，不再筛一遍：组内条目本来就是 `filtered` 里出来的（`foldSeries(filtered)`）。
    $: seriesViewItems = activeGroup
        ? filterAndSort(activeGroup.items, { status: 'all', type: 'all', query: '', sortBy })
        : [];
    /**
     * 🔴 #444：系列视图**三态通吃**（用户：「每个系列视图可独立切换视图类型（海报墙/列表/瀑布流），
     * 切换时不改变其系列视图」）—— 只要在系列视图里，就只喂**这一组**的条目；
     * 折叠卡（`seriesRows`）只在「海报墙 + 非系列视图」那条路上出现。
     *
     * 🔴 #592：**列表视图**改成「合集整体置顶 + 树形父子行」（用户：「海报墙把熊出没 13 部聚合了，
     * 但列表视图还是散开的 13 条，这不统一」）⇒ 它走 `listTreeRows`（合集恒在单集之前、组间按代表值），
     * ⛔ 与海报墙 `foldSeries` 的「折叠卡落在组内首个成员位置」**有意不同**。
     * ⚠️ 瀑布流**保持原样**（用户本批只点名列表视图）⇒ `masonry` 仍摊平成散卡。
     * 🔴 #624：**海报墙（`wall`）与卡片网格（`grid`）走同一条** —— 两者只差卡片的呈现
     *    （见容器上的 `class:rl-wall` 与 `.rl-wall …` 那组样式），系列折叠 / 组头 / 选择态 / 右键
     *    全都要一致。⛔ 别把 `wall` 漏在这里 —— 漏了就退化成「摊平散卡」，同一部剧的 13 部会散成 13 张。
     */
    $: rowSource = activeGroup
        ? seriesViewItems.map((e): SeriesRow => ({ kind: 'single', entry: e }))
        : viewMode === 'grid' || viewMode === 'wall'
            ? seriesRows
            : viewMode === 'list'
                ? // 🔴 需求 9（2026-10-21）：列表视图两种口径——`listGrouping` 开 = #592 起的
                  //    「合集整体置顶 + 树形父子行」；关 = **不并组展示**（`listFlatRows`：每条独立一行、
                  //    行序 = `filtered` 的顺序）。两分支都吐 `SeriesRow[]` ⇒ 下游 `listDisplayRows` /
                  //    `listItems` / `drawList` 一行都不用改（⚠️ 摊平态的 `openGroupKeys` 自然失效：
                  //    没有组行可展开；切回分组态时组件里那套展开集原样还在）。
                  listGrouping
                    ? listTreeRows(filtered, sortBy)
                    : listFlatRows(filtered)
                : filtered.map((e): SeriesRow => ({ kind: 'single', entry: e }));
    $: listRows = rowSource;
    /**
     * 🔴 #592：列表视图的**显示行** = 合集父级行 +（展开时）成员子行 / 单集行。
     * ⚠️ `openGroupKeys` **必须出现在这条 `$:` 里** —— Svelte 4 的依赖分析不穿透函数体，
     *    写成 `listDisplayRows(listRows, openGroupKeys)` 才会在展开/收起时重算。
     */
    $: listViewRows = listDisplayRows(listRows, openGroupKeys);
    /** 条目序列：列表 / 瀑布流 / 批量选择都用它（折叠卡在非 grid 视图不存在 ⇒ 非 grid 时它就是 `filtered` 本身） */
    $: listItems = listRows.flatMap((r) => (r.kind === 'single' ? [r.entry] : r.group.items));
    /** 绘制序列（grid 用）：折叠卡**恒是折叠态**（要看得进系列视图）；系列视图里则是「组内 N 张」。 */
    // 🔴 #444：系列视图的组头**搬到筛选栏**（`.rl-series-bar`）—— 三种视图类型共用一条，
    //    ⛔ 别在网格里再留一份（两处各写一份必然漂移；而且列表 / 瀑布流里网格组头本来也渲染不出来）。
    $: drawList = listRows.flatMap((r): DrawItem[] => (r.kind === 'single' ? [{ kind: 'card', entry: r.entry }] : [{ kind: 'folded', group: r.group }]));
    /** 瀑布流分列：纯封面等高卡片，轮流放入各列（保持排序结果从左到右横排，非 CSS columns 竖排） */
    /**
     * 🔴 #624 海报墙（wall）模式：卡片**只渲染封面 + 一行标题**（用户裁定「不带年份 / 评分 / 信息栏」）。
     * ⛔ 用「**不渲染**」而不是「CSS 隐藏」：隐藏得写「`.rl-wall` 限定 + 后代选择器」= **三个复合选择器**，
     *    而 Svelte 4 按 compound 个数给 scope 类（3 个 ⇒ 产物里 `.svelte-x.svelte-x.svelte-x` 三遍），
     *    当场撞坏全仓那些按「**两遍**」形态写的产物锚（本批实测：一改就红 29 条，逐条二分才定位到）。
     *    不渲染还顺带少一批 DOM —— 对「一屏几十张卡」的墙更划算。
     */
    $: wallView = viewMode === 'wall';
    /**
     * 🔴 #626 卡片网格 / 海报墙**各自的**列模板。
     * 差异只剩**间距**一处（⛔ 别把两份并成一个）：
     *   墙 `.rl-wall{gap:10px}` / 网格 `.rl-grid{gap:12px}`，而自定义列数要按真实 gap 反算列宽
     *   （`posterGridTemplate` 的第 3 参），所以墙走 `posterGridTemplateForWall` 把 gap 换掉。
     * 🔴 用户 2026-10-20 删除「海报墙列数」⇒ **列数来源已统一**（都是共享的密度档 / 列数），
     *    `wallColumns` 这个第一参已从函数签名里拿掉，⛔ 别再给墙传第二套列数。
     */
    $: gridColsTemplate = wallView
        ? posterGridTemplateForWall(posterDensity, posterColumns)
        : posterGridTemplate(posterDensity, posterColumns);
    $: masonryBuckets = splitMasonry(listItems, masonryCols);

    // 音乐页签歌单：按歌手分组（组名拼音序，未分类置底；组内专辑→年份→标题），纯逻辑见 pure/musicGroup
    $: musicGroups = lockType === 'music' ? groupMusicByArtist(filtered) : [];

    // 状态/类型计数必须是 reactive（依赖 entries 直接暴露给编译器）：
    // 之前是普通 const 函数闭包引用 entries，Svelte 编译器不追踪函数体内依赖，
    // 状态切换/增删后 statusbar 与类型 chips 的数字停在旧值（与 tabCount 同一类 bug）
    $: statusCounts = (() => {
        // 池子同时反映「锁定类型」与「类型筛选」：聚合页签（影视，lockType=null）下切换
        // 动画/电影/剧集 chips 时 typeFilter 变化，总数须跟随当前分类而非恒等于全部影视数，
        // 否则会出现「切换任一分类都显示总数 9」的虚增计数 bug
        const activeType = lockType ?? typeFilter;
        const pool = activeType === 'all'
            ? entries
            : entries.filter((e) => e.type === activeType);
        const out: Record<MediaStatus | 'all', number> = { all: pool.length };
        for (const s of MEDIA_STATUSES) out[s] = pool.filter((e) => e.status === s).length;
        return out;
    })();
    $: typeCounts = (() => {
        const out: Record<'all' | EntryType, number> = { all: entries.length };
        for (const t of ENTRY_TYPES) out[t] = entries.filter((e) => e.type === t).length;
        return out;
    })();
    // 书籍子分类四桶计数（阅读页签 chips 数字；all = book 总数，缺省归文学桶、comic 独立成桶）
    $: kindCounts = bookKindCounts(lockType === 'book' ? entries : []);

    // ── 🔴 #552 工具栏左端那枚**库概览**（「N 项媒体 / N 本书」）────────────────────────────
    //  用户上手后改主意：「把统计如 **90 项媒体加回来**吧」（#547 曾按「去除了没用」整体删掉它）。
    //  量词：阅读页签选中子分类时跟随子分类（本网文 / 本漫画），否则回落类型级
    //  （`pure/labels.overviewUnitLabel`：部电影 / 部剧集 / 部动画 / 本书 / 款游戏 / 首音乐；
    //   无类型 = 总库或影视聚合 ⇒「项媒体」）—— 与影视「8 部剧集」同一套口径。
    //  ⚠️ 必须写在 statusCounts / kindCounts **之后**：Svelte 4 的 `$:` 按源码顺序执行，
    //     提前引用这一轮会先算成 undefined（同下面 emptyPoolCount 那条注释）。
    $: overviewUnit =
        lockType === 'book' && kindFilter !== 'all' ? BOOK_KIND_TOP_UNITS[kindFilter]
        : overviewUnitLabel(lockType ?? (typeFilter !== 'all' ? typeFilter : null));
    //  总数与量词配套：子分类选中时取桶数（`kindCounts`，与 chips 上的数字**同源** ⇒ 不会两处对不上），
    //  否则取当前类型的视图池总数（`statusCounts.all`）。
    $: overviewTotal =
        lockType === 'book' && kindFilter !== 'all' ? kindCounts[kindFilter]
        : statusCounts.all;

    /**
     * 空状态的**视图池标识**（#444f）：「我现在在看哪一类」—— 决定 no-data 时用哪句措辞。
     * ⚠️ 与 `typeLabel` / `kindLabel`（no-match 时回显生效条件用的**显示名**）不是一回事，⛔ 别合并。
     */
    $: emptyViewPool = lockType === 'book' && kindFilter !== 'all'
        ? `book:${kindFilter}`
        : lockType === null
            ? (typePool && typeFilter !== 'all' ? `movieTv:${typeFilter}` : 'movieTv')
            : lockType;
    /**
     * 空状态的**池计数** = 当前**视图池**的条目数（页签 + 子分类 / 类型 chips），
     * ⛔ **不含**状态 / 题材 / 关键词 —— 那三项才是真正的「筛选」，它们把结果筛空了才是 no-match。
     *
     * 🔴 #444f（用户原话：「漫画视图下空状态怎么不跟随其他视图下的」）：阅读页签原来取 `statusCounts.all`，
     *    那只到「书」这一层、**不含子分类** ⇒ **漫画 0 本**时池子非 0 ⇒ 被判成 no-match，
     *    显示「没有匹配的条目 / 分类：漫画 / [清除筛选]」—— 可子分类是**视图**不是筛选，
     *    清完筛选也只是回到「全部」。⇒ 阅读页签的池必须收到 `kindCounts[kindFilter]` 这一层。
     * ⚠️ 影视页签**不用**额外收窄：HomeView 传进来的 `entries` 已按 `MEDIA_TYPES` 收过一道，
     *    `statusCounts` 又按 `lockType ?? typeFilter` 收了一道 ⇒ `statusCounts.all` 正是它的视图池。
     * 必须写在 statusCounts / kindCounts 之后：Svelte 4 的 $: 语句按源码顺序执行，提前引用会先算成 undefined。
     */
    $: emptyPoolCount = lockType === 'book' && kindFilter !== 'all' ? kindCounts[kindFilter] : statusCounts.all;
    $: emptyState = resolveEmptyState({
        poolCount: emptyPoolCount,
        poolKey: emptyViewPool,
        filteredCount: filtered.length,
        lockType,
        typeLabel: !lockType && typeFilter !== 'all' ? ENTRY_TYPE_LABELS[typeFilter] : undefined,
        kindLabel: lockType === 'book' && kindFilter !== 'all' ? BOOK_KIND_LABELS[kindFilter] : undefined,
        // 题材只在真选了之后回显（未选时不占位、不写「题材：全部」这种废话）
        genreLabel: genreSel.length > 0 ? genrePill : undefined,
        statusLabel: statusFilter !== 'all' ? statusLabel(lockType ?? 'movie', statusFilter) : undefined,
        query: debouncedSearch,
    });

    function toggleMenu(id: string) {
        menuOpenFor = menuOpenFor === id ? null : id;
    }

    async function applyStatus(e: MediaEntry, s: MediaStatus) {
        menuOpenFor = null;
        await onSetStatus(e.id, s);
    }

    // 游戏游玩时长角标（封面左下角，🔴 #471 从元信息区搬来）：实现**下沉到
    // `pure/mediaProgress.cardPlaytimeBadge`**，模板直接调它（⛔ 别在这里再包一层别名 —— 多一个名字就多一处会漂移的入口）。

    /** 大众评分数字格式化：整数去小数点（10 分制/5 分制均可） */
    function scoreText(e: MediaEntry): string {
        if (e.communityScore == null) return '';
        const n = Number(e.communityScore);
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }

    /**
     * 🔴 #530：系列视图内要标的**系列序号**（`undefined` = 不标）。
     * 🔴 `inSeries` 由**模板直接传**（`!!activeGroup`）—— ⛔ 别让本函数自己去读 `activeGroup`：
     *    Svelte 4 的依赖分析**不穿透函数体**（本仓 #446 已栽过一次）⇒ 那样写「进出系列视图」不会触发重算。
     * ⚠️ 用 `!== undefined` 而不是真值判断：`seriesIndexValue` 对脏数据可能归一到 `0`（读时取整），
     *    真值判断会把它当成「没填」。
     */
    function seriesNo(e: MediaEntry, inSeries: boolean): number | undefined {
        return inSeries ? seriesIndexValue(e) : undefined;
    }

    /** 状态 Badge 语义图标（○想看 / ●在看 / ✓已看 / ▢存档，字符统一风格） */
    function statusIcon(s: MediaStatus): string {
        return s === 'want' ? '○' : s === 'watching' ? '●' : s === 'watched' ? '✓' : s === 'archived' ? '▢' : '';
    }

    /** 豆瓣图床防盗链：无 Referer 返回 418，需 img referrerpolicy="unsafe-url" */
    function isDoubanImage(u: string | undefined): boolean {
        return !!u && /doubanio\.com/.test(u);
    }

    // 阅读进度百分比 / 书籍进度单位 —— 🔴 #444c 起实现下沉到 `pure/mediaProgress.readPercent` / `bookUnitOf`

    // ── B3 右键菜单（#608：条目卡与系列折叠卡**共用同一套容器 / 定位 / 关闭**）──
    /**
     * 打开之后的公共收尾：**定位 + 绑定「点外 / Esc 关闭」**。
     * 锚点容器内绝对定位（避开 Obsidian transform 祖先导致 fixed 偏移的问题）；
     * 边界自适应走 pure/menuPlacement：**视口系**算好落点（贴鼠标 → 越界翻转 → 仍越界钳制 → 超高封顶），
     * 最后减去锚点视口偏移换算回锚点相对坐标——旧实现直接用锚点相对量与视口宽高比较，锚点越靠内容末尾越失准。
     * 🔴 调用方负责先设好目标（`ctxFor` / `ctxGroupKey`，互斥）再 await 它。
     */
    async function placeCtxAt(ev: MouseEvent) {
        unbindCtxWindow();
        ctxX = 0;
        ctxY = 0;
        ctxMaxH = undefined;
        ctxMaxW = undefined;
        await tick(); // 等 anchor 与菜单渲染
        const anchor = ctxAnchorEl;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const m = ctxMenuEl?.getBoundingClientRect();
        const p = placeMenu({
            x: ev.clientX,
            y: ev.clientY,
            menuW: m?.width ?? 0,
            menuH: m?.height ?? 0,
            vw: window.innerWidth,
            vh: window.innerHeight,
            // 🔴 #610：可用区 = **锚点（内容区）的左右界** ∩ 视口。
            //    ⛔ 不传的话 `placeMenu` 只按视口钳制 ⇒ 翻转/钳制会把菜单压到视口最左（6px），
            //       换算成锚点相对坐标是负值 ⇒ 菜单整块落到 Obsidian 左侧栏底下被盖住。
            minX: a.left,
            maxX: a.right,
        });
        ctxMaxW = p.maxWidth;
        ctxMaxH = p.maxHeight;
        // 视口坐标 → 锚点相对坐标（菜单 absolute 挂在 .rl-ctx-anchor 上）
        ctxX = p.left - a.left;
        ctxY = p.top - a.top;
        // 点击菜单外 / Esc 关闭（本次会话内唯一一对监听，关闭时摘除）
        ctxOnDown = () => closeCtx();
        ctxOnKey = (ev2: KeyboardEvent) => { if (ev2.key === 'Escape') closeCtx(); };
        window.addEventListener('mousedown', ctxOnDown);
        window.addEventListener('keydown', ctxOnKey);
    }
    /** 条目卡右键（主操作 / 关联入口 / 编辑条目 / ±摘抄·游玩 / 删除条目） */
    async function openCtx(e: MediaEntry, ev: MouseEvent) {
        ev.preventDefault();
        ctxGroupKey = null; // 🔴 两宿主互斥：开条目菜单先清折叠卡菜单
        ctxFor = e.id;
        await placeCtxAt(ev);
    }
    /** #608 系列折叠卡右键（只有一条「排序号」）—— ⚠️ 必须 `stopPropagation`：
     *  折叠卡整卡还挂着 `on:click`（进系列视图），右键虽不触发 click，但别再让事件冒到外层容器。 */
    async function openGroupCtx(g: SeriesGroup, ev: MouseEvent) {
        ev.preventDefault();
        ev.stopPropagation();
        ctxFor = null;
        ctxGroupKey = g.key;
        await placeCtxAt(ev);
    }
    function unbindCtxWindow() {
        if (ctxOnDown) { window.removeEventListener('mousedown', ctxOnDown); ctxOnDown = null; }
        if (ctxOnKey) { window.removeEventListener('keydown', ctxOnKey); ctxOnKey = null; }
    }
    function closeCtx() {
        unbindCtxWindow();
        ctxFor = null;
        ctxGroupKey = null;
    }
    // ── 🔴🔴 #598 视图切换：**单枚下拉菜单** ────────────────────────────────────────────────
    //    用户：「切换海报墙/列表/瀑布流视图控件还是太丑了，有什么其他方案切换」→ `AskUserQuestion` 裁定
    //    「单枚下拉菜单（最省横向空间，与筛选栏那几个下拉同款）」。
    //    为什么换掉原来那套「分段控制器」：外容器浅底 + 选中白滑块 + 三枚 **Unicode 几何符号**
    //    （▦ ☷ ▥）三层叠加，符号在不同平台的字形还不一样（正是「丑」的来源）；下拉只剩一枚按钮，
    //    而且**图标 + 文字**都能给全（文字是原来给不了的 —— 符号没人猜得出哪个是瀑布流）。
    //    ⚠️ 开合纪律与题材面板**逐条同款**（窗口监听在 click 里绑、关闭即摘、Esc 关、外点关）——
    //       同一页里的两个浮层必须同一套手感，⛔ 别在这里发明第二种。
    let viewOpen = false;
    let viewOnDown: ((ev: MouseEvent) => void) | null = null;
    let viewOnKey: ((ev: KeyboardEvent) => void) | null = null;
    function unbindViewWindow() {
        if (viewOnDown) { window.removeEventListener('mousedown', viewOnDown); viewOnDown = null; }
        if (viewOnKey) { window.removeEventListener('keydown', viewOnKey); viewOnKey = null; }
    }
    function closeViewMenu() {
        unbindViewWindow();
        viewOpen = false;
    }
    function toggleViewMenu() {
        if (viewOpen) {
            closeViewMenu();
            return;
        }
        viewOpen = true;
        viewOnDown = (ev: MouseEvent) => {
            const el = ev.target as HTMLElement | null;
            if (el?.closest('.rl-vb-pop') || el?.closest('.rl-vb-btn')) return;
            closeViewMenu();
        };
        viewOnKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeViewMenu(); };
        window.addEventListener('mousedown', viewOnDown);
        window.addEventListener('keydown', viewOnKey);
    }
    /**
     * 🔴 #668 用户：「切换视图按钮也支持**自由排序并持久化**」。
     *
     * 三份状态，顺序有讲究（⛔ 别调换）：
     *  ① `curViewOrder` = **本地生效**的顺序。为什么要留一份而不直接读 prop：拖完我们只是**回调**宿主落盘，
     *     宿主回推要绕一圈 `refreshViews`；若直接读 prop，落盘那一瞬界面顺序不动 ⇒ 用户看着像「没拖成」
     *     （实测：回调已经拿到 `['wall', …]`，列表却还是原序）。
     *  ② `dragViewValue` / `overViewValue` = 拖拽进行中的那一档与落点（判据全在**值**上，⛔ 不依赖 DOM 下标 ——
     *     下标会随「分组歌单」是否在场而漂）。
     *  ③ 宿主那份 `viewOrder` 只在**首次注入**时收下（`gotHostOrder` 闸门）⇒ 拖动中不会被打回去。
     */
    let curViewOrder: string[] = [];
    let dragViewValue: string | null = null;
    let overViewValue: string | null = null;
    let gotHostOrder = false;
    // 宿主那份（设置页改了 / 首次注入）⇒ 只在第一次收下
    $: if (!gotHostOrder && viewOrder && viewOrder.length) {
        curViewOrder = viewOrder;
        gotHostOrder = true;
    }

    /**
     * 选项表 = 通用视图表（`pure/viewModes`）按**当前顺序**排 ＋ 音乐专有的「分组歌单」
     * （仅 `lockType === 'music'` 追加）。顺序 / 图标 / 名字一律经 `pure/viewModes.buildViewChoices`，
     * ⛔ 本组件不手写第二份。
     */
    $: viewChoices = buildViewChoices(curViewOrder, lockType);

    function onViewDragStart(ev: DragEvent, value: string): void {
        dragViewValue = value;
        overViewValue = value;
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', value);
        }
    }
    function onViewDragOver(ev: DragEvent, value: string): void {
        if (!dragViewValue) return;
        ev.preventDefault(); // 不拦就没有 drop
        overViewValue = value;
    }
    function onViewDrop(ev: DragEvent, value: string): void {
        if (!dragViewValue) return;
        ev.preventDefault();
        const from = dragViewValue;
        dragViewValue = null;
        overViewValue = null;
        if (from === value) return;
        const next = moveViewValue(curViewOrder, from, value);
        curViewOrder = next;   // 先本地生效（界面立刻跟上），再回传落盘
        onViewOrderChange(next);
    }
    function onViewDragEnd(): void {
        dragViewValue = null;
        overViewValue = null;
    }

    /**
     * 🔴🔴 #640 ⑷（1.4.0，用户点名）：**混类型视图下卡片信息区等高**
     * —— 「合并视图内所有卡片高度一致，同一行底部对齐；信息区最多 N 行，超出省略；
     *     字段少的卡片不拉伸海报；响应式下仍保持对齐」。
     *
     * 问题：信息栏行数现在**按条目类型各配一份**（#617）—— 电影配了 5 行、音乐只配了 3 行
     * ⇒ 同一排里两种卡片的 `.rl-card-meta` 高度差 2 行，**底部对不齐**，看着像卡片被裁了一截。
     * 此前只在「同一页签内所有卡片同类型」时才天然等高（那正是 `cardFieldsByType[e.type]` 的
     * 前提），一旦混类型（合并视图的「全部」/ 影视聚合页签）就露出来了。
     *
     * 🔴 解法 = **补齐到「当前渲染集合里最大的行数」**：行数少的卡片把信息区**撑到**那个行数
     *    （多出来的部分留空，`flex: 1 1 auto` 让 `.rl-card-meta` 吃到相同高度）。
     *    ⚠️ 为什么不用「所有类型里最大的」：那会让「只看音乐页签」时音乐卡片也留出电影的空白 ——
     *      高度的判据应当是**这一屏实际渲染了什么**，不是全库的类型表。
     *    ⚠️ 为什么是**补齐**而不是「统一成固定 N 行」：用户配 5 行就该看到 5 行，
     *      削到少的那个是**丢信息**（本仓最忌讳）。
     *    ⚠️ 海报（`.rl-cov` 的 `aspect-ratio: 2/3`）**一个字不动** —— 用户点名「字段少的卡片
     *      不拉伸海报」⇒ 补齐只能加在**信息区**，⛔ 不许去动封面比例。
     */
    $: cardRowMax = (() => {
        // 只统计**当前实际会渲染**的那些条目类型（`filtered` 才是这一屏的真源）
        const types = new Set<EntryType>();
        for (const e of filtered) types.add(e.type);
        let max = 0;
        for (const t of types) max = Math.max(max, (cardFieldsFor(t, t === 'book' ? 'novel' : undefined, cardFieldsByType, cardFieldsByKind) ?? []).length);
        // 空集合时给 0（下面的补位逻辑自然不做事）
        return max;
    })();

    /**
     * 该卡片信息区要渲染的**行位**（真字段 + 补位空行）。模板里只遍历这个数组。
     * ⚠️ 补位行的值走 `null`（模板据此渲染一个**不含文字但占位**的 div），
     *    ⛔ 不要用「—」填：那会让用户以为「这条条目这个字段是空的」（假数据）。
     */
    function cardRowsFor(type: EntryType, kind?: BookKind): Array<{ f: CardFieldKey | null; key: string }> {
        const real = cardFieldsFor(type, kind, cardFieldsByType, cardFieldsByKind);
        const out: Array<{ f: CardFieldKey | null; key: string }> = real.map((f) => ({ f, key: f }));
        for (let i = real.length; i < cardRowMax; i++) out.push({ f: null, key: `__pad${i}` });
        return out;
    }

    /** 闭合框显示的那一项（图标 + 名字）；查不到时退回第一项（⛔ 别留一个空按钮） */
    $: currentView = viewChoices.find((c) => c.value === viewMode) ?? viewChoices[0];
    function pickView(v: string) {
        viewMode = v as ViewMode | 'grouped';
        closeViewMenu();
    }
    /**
     * 🔴 单实例复用兜底（易复发点 ⑴）：`grouped` 是**音乐专有**档 —— 离开音乐页签后它不在
     * `viewChoices` 里，而渲染层也没有它的分支（会落到表格）。若不把它退掉，
     * 闭合框会显示成「海报墙」、实际渲染的却是列表 ⇒ **显示与实际不符**。查不到就自动退出。
     */
    $: if (viewMode === 'grouped' && lockType !== 'music') viewMode = 'grid';
    /** 时间线桶（#598）：按年份降序分桶、「年份未知」恒在最后 —— 纯逻辑在 `pure/viewModes.buildTimeline` */
    $: timelineBuckets = buildTimeline(filtered);

    // ── 题材面板开合（与右键菜单同一套窗口监听纪律：每次打开重绑，关闭即摘，卸载兜底）──
    let genreOnDown: ((ev: MouseEvent) => void) | null = null;
    let genreOnKey: ((ev: KeyboardEvent) => void) | null = null;
    function unbindGenreWindow() {
        if (genreOnDown) { window.removeEventListener('mousedown', genreOnDown); genreOnDown = null; }
        if (genreOnKey) { window.removeEventListener('keydown', genreOnKey); genreOnKey = null; }
    }
    function closeGenre() {
        unbindGenreWindow();
        genreOpen = false;
    }
    /**
     * 胶囊点击：开 / 关。⭐ 绑定时机必须在这一个 click 里（而不是 mousedown）：本轮的 mousedown
     * 早已派发完毕，否则会「刚打开就被自己的外点击监听关掉」。
     */
    function toggleGenrePanel() {
        if (genreOpen) {
            closeGenre();
            return;
        }
        // 🔴 #680：**题材面板与三个 MiniSelect 同属一组互斥** —— 题材是手写面板、不是 MiniSelect，
        //    所以这里要显式广播一次「别的下拉请收起」。注册表在 `MiniSelect` 模块内，这里通过共享组名
        //    `rl-toolbar-filters` + 事件桥接（见 `broadcastClosePeers`）。
        broadcastClosePeers('rl-toolbar-filters');
        genreOpen = true;
        genreOnDown = (ev: MouseEvent) => {
            const el = ev.target as HTMLElement | null;
            // 面板内（勾选项 / 全选）与胶囊自身不关闭 —— 胶囊走自己的 toggle
            if (el?.closest('.rl-genre-panel') || el?.closest('.rl-genre-btn')) return;
            closeGenre();
        };
        genreOnKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeGenre(); };
        window.addEventListener('mousedown', genreOnDown);
        window.addEventListener('keydown', genreOnKey);
    }
    /** 勾选 / 取消一项（点选立即生效，面板不收起 —— 多选本来就是连点） */
    function toggleGenreOption(key: string) {
        genreSel = genreSel.includes(key) ? genreSel.filter((k) => k !== key) : [...genreSel, key];
    }
    /**
     * 全选 ⇄ 清空（用户 2026-09-22：「题材筛选点全选后再点可以清空全选」）：
     * 已全选时再点 = 清空；否则 = 全选本视图池里的全部题材（**含「未分类」**，D-5）。
     * ⚠️ 与分页「全选」的口径不同：那是「本页」，这里没有分页概念（池 = 整个子视图）。
     */
    function selectAllGenres() {
        genreSel = allGenresSelected ? [] : genreOptions.map((o) => o.key);
    }
    onDestroy(() => {
        // 🔴 #510：模块级观察器随组件销毁一起收掉（⛔ 留着会对着已卸载的 DOM 继续观察）
        stackObserver?.disconnect();
        stackObserver = null;
    });
    onDestroy(unbindGenreWindow);
    // 🔴 #598：视图菜单那对窗口监听也要摘（同题材面板那条）
    onDestroy(unbindViewWindow);
    // 卸载兜底：系列视图的 Esc 监听（同上纪律 —— 系列视图开着时整个组件被卸载，监听不能留在 window 上）
    onDestroy(unbindSeriesViewEsc);
    /** 类型化主操作（阅读/观看/播放/启动）：入口可用直接执行；不可用 → 快捷关联弹窗直达（不再先开编辑表单） */
    function ctxPrimary(e: MediaEntry) {
        closeCtx();
        if (hasActionEntry(e)) onWatch(e);
        else onQuickAssociate(e);
    }
    /** 右键主操作 title：可用=实际动作描述；不可用=去关联提示（点击直达快捷关联弹窗）
     *  🔴 #535：可用时的文案要随「有没有**本地**入口」分叉 —— 只有网络地址却写「打开书籍文件」是在骗人。
     *     ⛔ 门控仍一律走 `hasActionEntry`（`hasLocalEntry` **只**决定文案，不当门控）。 */
    function ctxPrimaryHint(e: MediaEntry): string {
        return hasActionEntry(e) ? actionReadyHint(e.type, hasLocalEntry(e)) : actionUnavailableHint(e.type);
    }
    async function ctxDelete(e: MediaEntry) {
        closeCtx();
        // 确认在 plugin.deleteEntry 内（Modal 确认，替代 window.confirm）
        await onDeleteEntry(e.id);
    }
    // ── B5 批量操作 ──
    function toggleSelect(id: string) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selectedIds = next;
    }
    function clearSelection() {
        selectedIds = new Set();
    }
    /** 表头全选三态：○ 未选 / ⦿ 部分选（indeterminate）/ ⦿ 全选当前过滤结果 */
    let headCb: HTMLInputElement | null = null;
    $: visibleIds = listItems.map((e) => e.id);
    $: allChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    $: someChecked = selectedIds.size > 0 && !allChecked;
    $: if (headCb) headCb.indeterminate = someChecked && !allChecked;
    function toggleSelectAll() {
        if (allChecked) selectedIds = new Set();
        else selectedIds = new Set(visibleIds);
    }
    /** 批量应用：状态 / 评分 / 标签三组设置共用一个「应用」按钮，一次全部应用到选中条目 */
    async function applyBulkAll() {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        const status = bulkStatus;
        const rating = bulkRating;
        const tags = bulkTagsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        // 批B 前置确认：本插件不为批量操作提供撤销（回滚要重建笔记与目录项，冲突风险高），
        // 因此把关口前移到动手之前——先把「多少项、改什么」说清楚再执行。
        // 无可应用项时 describeBulkApply 返回 null（不弹空确认框），等价于原来的「三项全空直接返回」。
        const confirmText = describeBulkApply({
            count: ids.length,
            statusLabel: status ? statusLabel(lockType ?? 'movie', status) : undefined,
            rating: rating === 0 ? undefined : rating === -1 ? null : rating,
            tags,
        });
        if (!confirmText) return;
        if (!(await onConfirmBulk(confirmText))) return; // 取消 → 保留当前勾选与表单值，不改动任何数据
        clearSelection();
        bulkStatus = '';
        bulkRating = 0;
        bulkTagsText = '';
        if (status) {
            for (const id of ids) {
                try {
                    await onSetStatus(id, status);
                } catch {
                    // 单条失败不阻断其余
                }
            }
        }
        if (rating) {
            try {
                await onBulkRating(ids, rating === -1 ? 0 : rating);
            } catch {
                // 批量失败不阻断后续操作
            }
        }
        if (tags.length > 0) {
            try {
                await onBulkTags(ids, tags);
            } catch {
                // 批量失败不阻断
            }
        }
    }
    async function bulkDelete() {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        clearSelection();
        // 确认在 plugin.deleteEntries 内（一次 Modal 确认，替代 window.confirm）
        await onBulkDelete(ids);
    }

    function hash(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1.3.1 ②（#621）列表视图改**可编辑表格**
    //
    // 用户口径（2026-10-13）：「列表视图改表格式」＋「列的字段可自定义」＋「格子点击编辑、失焦保存、
    // Ctrl+Z 撤销」＋「列宽可拖」，且点名「看主流软件怎么做的」⇒ 对齐 Obsidian 官方 Bases。
    // （原本还有「双击自适应列宽」，v2 已于 2026-10-20 按用户要求删除。）
    //
    // 四条落点：
    //   ① 列 = **数据驱动**（`colViews`）—— ⛔ 不再把「年份 / 状态 / 评分 / 进度」写死在模板里；
    //   ② 一格 = 一个**可聚焦元素**（`span[role=button][tabindex=0]`）⇒ 方向键 / Tab / Enter / 退格
    //      全都免费拿到，且不触发 Svelte 的 a11y 警告（⛔ 用 `<td on:click>` 会 —— 那会把构建警告数顶上去）；
    //   ③ 值 ⇄ patch 的换算**全在 `pure/tableCell`**：组件只把 patch 交给宿主，
    //      ⛔ 不在这里拼 `Partial<MediaEntry>`（同一件事两处实现 = 迟早分叉）。
    //   ④ 🔴 行级 `on:click`（点整行开条目）**必须撤掉** —— 与「点格子改这一格」直接冲突，
    //      留着就是「想改年份结果打开了条目」。开条目的入口保留在**标题链接**与操作列那枚图标上。
    // ══════════════════════════════════════════════════════════════════════════

    /** 表内出现的类型（按出现先后）—— 决定用哪一套列配置 */
    $: tableTypes = (() => {
        const out: EntryType[] = [];
        for (const row of listViewRows) {
            if (row.kind !== 'entry') continue;
            if (!out.includes(row.entry.type)) out.push(row.entry.type);
        }
        return out;
    })();
    /** 单类型表 ⇒ 该类型（列可配置）；混类型（「全部」页签）⇒ `null`（走并集，列菜单禁用）
     *  🔴🔴 #688（用户报「表头字段也无法拖动」）：判据**必须优先认 `lockType`**。
     *    原来只看 `listViewRows` 里出现了几种类型 —— 而切页签后（尤其切换瞬间）行数据可能还是
     *    上一页的混类型结果 ⇒ `tableType` 为 null ⇒ `canEditColumns` 为 false ⇒ 表头 `draggable=false`，
     *    用户看到的就是「表头拖不动」，且**没有任何提示**。
     *    `lockType` 是宿主传下来的「本页锁定的类型」（阅读/影视/游戏/音乐页都有），它比「当前渲染了哪些行」
     *    更权威：行还没刷新时它就已经是对的。
     */
    $: tableType = lockType !== null && lockType !== undefined ? lockType : tableTypes.length === 1 ? tableTypes[0] : null;
    /** 渲染兜底用的类型集合（空表 / 混类型靠它取列名与默认权重；⛔ 不参与「这格能不能改」的判定） */
    $: tableDefTypes = tableTypes.length > 0 ? tableTypes : [lockType ?? 'movie'];
    /** 本表实际显示的列键。
     *  🔴 #668 用户裁定：「列表视图切换各类型**不要出现不是该类型的表头列**」。
     *     · 单类型（某个类型页签）⇒ 该类型自己的配置（专属列齐全）；
     *     · 混类型（「全部」页签）⇒ **公共列**（交集），不再是六类并集 ——
     *       并集会让电影行里出现「作者」「平台」这些它根本没有的列（整列都是 `—`）。
     *     ⚠️ 交集为空时 `commonColumnsForTypes` 内部回落到并集（⛔ 别让表退化成只剩标题）。
     */
    $: tableKeys = tableType
        ? (tableColumnsByType[tableType] ?? [])
        : commonColumnsForTypes(tableDefTypes, tableColumnsByType);
    $: columnDefs = tableColumnDefsFor(tableKeys, tableDefTypes);
    /** 列配置菜单：只有单类型表能开（混类型没有「哪一套」可改） */
    $: canEditColumns = tableType !== null;
    let colMenuOpen = false;
    $: colPool = tableType ? tableColumnPoolFor(tableType) : [];
    /**
     * 🔴🔴 #680 ③-4：列池**分三组显示**（用户：「面板改为支持分组的显示以区分不同的列字段重要性」）。
     * 判据只看列键，⛔ 不改 `pure/tableColumns` 的池子顺序与归一 —— 那套顺序是「拖表头定列序」的真源。
     *   ① 常用：状态 / 评分 / 进度 / 年份（每张表都看得见的东西）；
     *   ② 作品信息：题材 / 作者 / 画师 / 平台 / 导演 这些内容属性；
     *   ③ 其它：出版社 / 译者 / ISBN / 价格 这类低频字段。
     */
    const COL_GROUP_PRIMARY = new Set(['status', 'rating', 'year', '__community', '__progress']);
    const COL_GROUP_CONTENT = new Set(['genres', 'author', 'artist', 'platform', 'developer', 'director', 'cast', 'screenwriter', 'album', 'language', 'country', 'series', 'series_index']);
    function colGroupOf(key: string): string {
        if (COL_GROUP_PRIMARY.has(key)) return '常用';
        if (COL_GROUP_CONTENT.has(key)) return '作品信息';
        return '其它';
    }
    /** 分组后的列池（保持组内原池顺序；空组不渲染） */
    $: colGroups = (() => {
        const order = ['常用', '作品信息', '其它'];
        const map = new Map<string, { key: string; label: string; editable: boolean }[]>();
        for (const opt of colPool) {
            const g = colGroupOf(opt.key);
            if (!map.has(g)) map.set(g, []);
            map.get(g)!.push(opt);
        }
        return order.filter((t) => map.has(t)).map((t) => ({ title: t, items: map.get(t)! }));
    })();

    // ── 列宽：**权重**（不是 px、也不是 %）─────────────────────────────────────
    //   🔴 为什么是权重：整表恒撑满容器（#595 的口径 —— 用户嫌「书名栏占太大空间」，改成全部按比例给宽）。
    //      换算：`pct_i = w_i / Σw × FLEX_PCT`；`cb` / `ops` 两列走固定百分比（见样式表）。
    //   🔴 拖宽 = **「右邻让位」**（右侧没有邻居就向左邻借）：Σ 恒定 ⇒ 指针位移与列边 **1:1**。
    //      若改成「全体按比例缩放」，指针走 100px 而列边只挪 60px —— 手感是橡皮筋（本批实现时踩过）。
    //   ⚠️ 宽度**只在本次会话内有效**（不落盘）：拖宽是「我这一眼看舒服点」的临时动作，
    //      为它再开一个设置键 + 归一 + 迁移不划算。换视图 / 重载后回到默认比例。
    const CB_PCT = 5;
    const OPS_PCT = 7;
    const FLEX_PCT = 100 - CB_PCT - OPS_PCT;
    const MIN_WEIGHT = 0.35;
    /**
     * 🔴🔴 #680（用户：「标题列必须设为弹性列，占剩余最大宽度；次要列固定窄宽，绝不随窗口拉宽无限拉伸」）：
     * 窄列的**单列上限**（占总宽百分比）。1244px 下 1% ≈ 12.4px ⇒ 8% ≈ 100px。
     * ⚠️ 这不是「每列都封 8%」—— 列一多那样会把 88% 预算吃光（10 列时标题只剩 8%，比改之前更糟；
     *    探针 _probe_680_cols 第一版抓到过）。真正的算法在 buildColViews：
     *    **标题先保底 TITLE_MIN_PCT**，剩下的预算再按列数分给窄列（每列再受这里这个上限约束）。
     */
    /** ⚠️ #680 换框后**不再使用**百分比上限（改为固定 px，见 colPx）。保留一个 0 值以挡住误用。 */
    const NARROW_CAP_PCT = 0;
    /**
     * 🔴🔴 #684：**标题列的保底像素宽**。次要列再多，也必须给它留这么宽。
     * 依据：标题格里是「封面 + 间距 + 书名」，280px 能完整放下「三体全集（典藏版）· 刘慈欣」这一档长度。
     * ⚠️ 这是**硬闸**（`buildColViews` 用它算次要列预算），⛔ 别调小到让标题又开始截断。
     */
    const TITLE_MIN_PX = 280;
    /** 🔴 #684：勾选列 / 操作列的**固定像素宽**（原先是 5% / 7% 百分比，窄屏会跟着缩，宽屏又浪费）。 */
    const CB_W = 60;
    const OPS_W = 84;
    /**
     * 🔴 #684：表格**可用横向宽度**（px）。由 `bind:clientWidth` 实时喂进来
     * （`$: tableAvailPx = wrapW || 1244`）。⛔ 别在 `buildColViews` 里读 DOM —— 那是已渲染的旧值，
     * 而且会让 Svelte 的依赖分析失效（本仓 #446/#530 的老坑）。
     * 量不到时用 1244（用户常用窗口宽）做保守默认。
     */
    let wrapW = 0;
    let tableAvailPx = 1244;
    /** 次要列的**兜底宽度**（px）：内容没量到时用它。⚠️ #687 起这只是下限，不是固定宽 ——
     *  有实测内容宽时按实测分配（见 `buildColViews`）。 */
    const NARROW_PX_BASE = 80;
    /** 🔴 #687：纯数值列（页数 / 片长 / 集数）的兜底下限 —— 内容只有几个数字，别占 80px。 */
    const NARROW_PX_NUM = 56;
    /** 🔴 #687：评分类列（个人评分 / 大众评分）的下限 —— 格子里是「五颗星 + 数字」。 */
    const NARROW_PX_SCORE = 104;
    /** 长文本次要列（作者 / 平台 / 专辑）的兜底下限：80px 会截断两三个字，给 120。 */
    const NARROW_PX_LONG = 120;
    /** 拖窄时的下限（再窄就认不出是哪一列了）。 */
    const NARROW_PX_MIN = 48;
    /** 🔴 #680：标题列的**保底占比**（其余列只分 FLEX_PCT − 它）—— 保证长书名永远有地方放。 */
    const TITLE_MIN_PCT = 22;
    const TITLE_KEY = '__title';
    /**
     * 🔴🔴 用户 2026-10-20（v2 列表视图宽度重构）：**用户手动拖出来的列宽，单位就是 px**。
     *
     * 改前存的是「权重」（3.2 权重 = 80px 之类），拖 1px 要 `px → 权重 → px` 往返换算；
     * 而标题列还额外挂了一条补丁（`titlePinned()` / `tableExactWidth()` / `colPxForTitle()`），
     * 让表格宽度 = Σ 列宽 —— 与 `<table style="width:100%">` 和 `buildColViews` 的
     * 「availPx − CB_W − OPS_W 预算」三方互相抵消，结果是**标题列拖动被全部吃掉**（用户报障）。
     *
     * ⇒ v2：**px 是唯一真源**，拖多少记多少，⛔ 别再引入权重/百分比/比例。
     *   有键 = 这一列由用户定宽；没键 = 这一列走内容自适应（见 `buildColViews`）。
     *   标题列也在这张表里，和次要列**同一套规则**（不再有第二条分支）。
     */
    let manualPx: Record<string, number> = {};
    /** 🔴 #688：拖动列宽期间为 true —— 期间**禁止**自适应重算，否则每帧把用户拖出来的宽度冲回内容宽。 */
    let resizing = false;
    /** 🔴 用户 2026-10-20：正在拖的那一列（只用于给柄加 `.is-active` 高亮）。`null` = 没在拖。 */
    let resizeColKey: string | null = null;

    /**
     * 🔴 v2 说明：`autoWeights` 的内部仍是**权重口径**（量内容那一路没动，改动面越小越安全），
     * 本常量只服务权重 ↔ px 的换算（`recomputeAutoWeights` 的 `toWeight` 与 `buildColViews` 的
     * `fromMeasure`）。⛔ 拖动路径（`manualPx`）**完全不经过它** —— 拖多少记多少 px。
     * 权重 1 ≈ `NARROW_PX_BASE`(80px)。
     */
    const NARROW_DEFAULT_WEIGHT = 3.2;

    /** 🔴 v2（用户 2026-10-20「彻底重构 v2 版本的列表视图」）：`buildWeights()` 与 `defaultWeight()`
     *  已**整体删除**。它们是「手动权重 > 自适应权重 > 按 kind 兜底」三层优先级里最底那一层，
     *  在标题列上最终退化成 `TITLE_DEFAULT_WEIGHT` 这个凭空造的数 —— 标题列宽之所以拖不动，
     *  有一半原因就是它被这条兜底反复涂改。现在列宽**只有一条路**：`buildColViews()`。
     *  ⛔ 别再补回「按 kind 猜宽度」的函数，猜出来的数永远会和内容打架。 */

    /**
     * 内容自适应的实测结果（**内部仍是权重口径**，只在 `buildColViews` 里换算回 px）。
     *
     * 口径：**宽度由内容算**，`autoWeights` 只是「还没量到内容时的兜底」。
     *  · 量什么：本表**实际渲染的所有行**里该列文字的 `scrollWidth`（`.rl-tbl-mv` 是 `overflow:hidden`，
     *    `scrollWidth` 恰好是全文宽）+ 格内距；表头文字也算一份（列名比内容长时按列名）。
     *  · **无内容的列收窄**：全列都是 `—`（这一列对本表没有信息）⇒ 压到 `MIN_WEIGHT` 那一档，
     *    把空间让给有内容的列 —— 这正是「不是该类型的列占着宽度」的解法。
     *  · 手动拖**优先级更高**：`manualPx` 里有这个键就整列跳过，自适应不再覆盖它
     *    （否则每换一次数据就把人手拖的宽度冲掉）。
     *
     *  🌱 约定：`manualPx` 里有这个键，表示这一列是被手动拖动过的，不再参与内容自适应。
     *     ⚠️ 绝不能放进 `$:` 里直接量 DOM：`$:` 在**渲染之前**跑，那时候表格还是上一版的行
     *     （本仓「先算后画」的老坑）。⇒ 走 `afterUpdate` 量一次、写进 `autoWeights`，由 `$:` 去消费。
     */
    let autoWeights: Record<string, number> = {};

    /**
     * 量一列的内容宽（px），同时告诉调用方「这列有几格是**真实内容**」。
     * 🔴 #668 两个踩过的坑：
     *  ⑴ 空值的格子里渲染的是占位符 `—`，它的 `scrollWidth` **不是 0**（它继承整格宽）⇒
     *     只看宽度会把「整列都是 —」当成有内容，永远压不窄 ⇒ 判据必须是「**非占位符**的格子数」。
     *  ⑵ 选择器 `[data-col="…"] .rl-tbl-mv` 会**连表头一起选中**（`th` 也带 `data-col` 且有 `.rl-tbl-mv`）
     *     ⇒ 列数永远比真实行多 1，`real` 恒 > 0、压窄永不生效。表头只能算宽度，**不算内容格**。
     * ⇒ 本函数拆成 `tbody` 里的数据格（判 real + 量宽）与表头（只量宽）两段。
     */
    function measureCol(table: HTMLTableElement, key: string): { px: number; real: number } {
        let max = 0;
        let real = 0;
        // ① 只数 **tbody** 里的数据格（表头在 thead，天然被排除；合集父级行也在这里，算一格）
        // 🔴 占位符 `—` 是**格子里面**的 `<span class="rl-tbl-none">`，不是格子本身 ——
        //    选择器命中的是外层 `.rl-tbl-cell.rl-tbl-ed`（它也带 `.rl-tbl-mv`），
        //    所以「是不是占位符」必须看**这个格子内部有没有 `.rl-tbl-none`**。
        table.querySelectorAll<HTMLElement>(`tbody [data-col="${key}"] .rl-tbl-mv`).forEach((el) => {
            const placeholderOnly = !!el.querySelector(':scope > .rl-tbl-none');
            if (!placeholderOnly) real++;
            if (el.scrollWidth > max) max = el.scrollWidth;
        });
        // ② 表头文字只参与**宽度**（列名常常比内容长），⛔ 不计入 real
        const th = table.querySelector<HTMLElement>(`thead th[data-col="${key}"] .rl-tbl-mv`);
        if (th && th.scrollWidth > max) max = th.scrollWidth;
        return { px: max, real };
    }

    /**
     * 用**实测内容宽**重算整表权重（每列 = 内容宽 + 内距 + 余量）。
     * ⚠️ 只给**没被手动拖过**的列算（`colWeights` 里有的键原样跳过）—— 手动优先。
     */
    function recomputeAutoWeights(): void {
        // 🔴 #688：拖动列宽期间**不许重算**（见 startColResize 的注释）
        if (resizing) return;
        const table = tableEl;
        if (!table) return;
        const next: Record<string, number> = {};
        const px: Record<string, number> = {};
        const real: Record<string, number> = {};
        for (const def of columnDefs) {
            if (Object.prototype.hasOwnProperty.call(manualPx, def.key)) continue; // 手动拖过 ⇒ 不覆盖
            const m = measureCol(table, def.key);
            px[def.key] = m.px;
            real[def.key] = m.real;
        }
        const titlePx = (() => {
            const th = table.querySelector<HTMLElement>(`th[data-col="${TITLE_KEY}"] .rl-tbl-mv`);
            return th ? th.scrollWidth : 0;
        })();
        const haveAny = Object.values(px).some((v) => v > 0) || titlePx > 0;
        if (!haveAny) return; // 还没渲染出行：保持兜底权重（⛔ 别把表写成 0 宽）
        // 🔴🔴 #687：内容宽 → 权重，**按绝对值换算**（原来是「除以最宽一列 × 3.6」）。
        //    旧换算的分母是**本表最宽的那一列** ⇒ 列宽是「相对最宽列」的比例，最窄的列也恒得 0.9×
        //    权重 ≈ 22px，再被 `NARROW_PX_MIN` 抬回 48px ⇒ 12 列时所有列被压成同一个宽度（实测 106px），
        //    短字段（年份）与中字段（ISBN）分不开。现在权重 = 实测 px 直接换算（1 权重 = 80px），
        //    `buildColViews` 再按需求宽分配剩余空间给标题。
        const toWeight = (v: number): number => Math.max(MIN_WEIGHT, (v / NARROW_PX_BASE) * NARROW_DEFAULT_WEIGHT);
        if (titlePx > 0 && !Object.prototype.hasOwnProperty.call(manualPx, TITLE_KEY)) next[TITLE_KEY] = toWeight(titlePx);
        for (const def of columnDefs) {
            const v = px[def.key] ?? 0;
            // 🔴 整列**没有真实内容**（只有占位符 —）⇒ 压到最窄那一档，把宽度让给有信息的列。
            //    ⚠️ 判据是 `real === 0`（有真实内容的格子数），**不是** `v > 0` ——
            //       占位符 `—` 自己也有宽度，按宽度判会永远不压窄（本批实测踩到）。
            next[def.key] = real[def.key] > 0 ? toWeight(v) : MIN_WEIGHT;
        }
        // 🔴 只在**结果真的变了**时赋值：`autoWeights` 会驱动 `colViews` 重算 ⇒ 再触发 `afterUpdate`，
        //    无脑写就是无限更新（Svelte 的 `flush_loop`）。浮点差异按 0.05 一档比较。
        const same =
            Object.keys(next).length === Object.keys(autoWeights).length &&
            Object.keys(next).every((k) => Math.abs((autoWeights[k] ?? -1) - next[k]) < 0.05);
        if (!same) autoWeights = next;
    }

    /** 权重表（**纯函数：只吃参数**，⛔ 自己不读 `manualPx`）—— 缺省权重与兜底都收在这一处。
     *  🔴 v2：`buildWeights()` / `defaultWeight()` 已整体删除（列宽只走 `buildColViews()`）。 */

    /**
     * 逐列的渲染清单（列描述 + 已算好的像素宽）。
     * 🔴🔴 **依赖必须由调用点当实参传进来**：Svelte 4 的依赖分析**不穿透函数体** ——
     *    写成 `$: colViews = buildColViews()`（让函数自己去读 `manualPx`）时，拖列宽**不会触发重算**
     *    ⇒ 拖的时候列边不动、松手才跳一下。本仓 #446 / #530 都栽过同一件事，口径是
     *    「**函数只算参数，依赖由 `$:` 那一行显式给出**」。
     *
     * 🔴🔴 v2（用户 2026-10-20「彻底重构 v2 版本的列表视图」）模型，**三步，顺序不能换**：
     *
     *  ① **标题列先落定**（`titlePx`）：手动拖过 ⇒ 就是那个 px；没拖过 ⇒ 吃掉扣除全部次要列需求后的
     *     剩余宽，但**不低于 `TITLE_MIN_PX`**、**不高于可用宽**。
     *  ② **预算里必须先扣标题**：`room = avail − CB − OPS − titlePx`。这一条是本次返工的核心 ——
     *     旧代码的预算是 `avail − CB − OPS`，**不扣标题**，于是次要列按「整表宽」算需求，
     *     标题列多占的 px 只能从次要列身上抢回来 ⇒ 拖标题列被全部抵消（用户报障：
     *     「光标变成 ↔ 了，但无法向左或右拖动，其他列竖指示器正常」）。
     *  ③ 次要列在 `room` 里按「手动 > 需求」分配，**放得下就各拿各的**，放不下才按同一比例压缩。
     *
     * ⚠️ 不变式（`tools/verify-artifact.cjs` 会核）：`titlePx + Σ cols.px ≤ avail` 在需求能装下时恒成立；
     *    装不下时由 `tableMinWidth` 触发横向滚动，⛔ 不允许再把标题列的宽度反向补给次要列。
     */
    function buildColViews(manual: Record<string, number>, auto: Record<string, number>, defs: TableColumnDef[], availPx: number): { titlePx: number; cols: { def: TableColumnDef; px: number }[] } {
        // 🔴 #687（用户 2026-10-19）：「各列宽字段其他短内容字段**不要省略号**显示，
        //    按最小宽度缩显示以展示够 12 列」——次要列的需求宽 = 实测内容宽，量不到时退回兜底下限。
        const budgetAll = Math.max(0, availPx - CB_W - OPS_W);

        // ② 每列的「需求宽」/「手动宽」（手动的话 need 恒为 0，不参与后面的比例压缩）
        const demand = defs.map((def) => {
            if (Object.prototype.hasOwnProperty.call(manual, def.key)) {
                return { def, px: clampManualPx(manual[def.key], colPxMin(def)), manual: true, need: 0 };
            }
            const measured = auto[def.key];
            // `autoWeights` 里**仍然是权重口径**（量内容那一路没动，改动面越小越安全），换算回 px 当需求宽
            const fromMeasure = measured !== undefined ? Math.round((measured / NARROW_DEFAULT_WEIGHT) * NARROW_PX_BASE) : 0;
            const need = Math.max(fromMeasure, colPxMin(def));
            return { def, px: need, manual: false, need };
        });

        const manualTotal = demand.filter((d) => d.manual).reduce((a, c) => a + c.px, 0);
        const needTotal = demand.reduce((a, c) => a + (c.manual ? 0 : c.need), 0);

        // ① 标题列先落定 —— 手动值优先；否则吃「预算 − 次要列（手动 + 需求）」的剩余，夹在 [TITLE_MIN_PX, 可用宽]
        const titleManual = Object.prototype.hasOwnProperty.call(manual, TITLE_KEY);
        const titlePx = titleManual
            ? clampManualPx(manual[TITLE_KEY], TITLE_MIN_PX)
            : Math.min(budgetAll, Math.max(TITLE_MIN_PX, budgetAll - manualTotal - needTotal));

        // ③ 次要列在「扣掉标题之后」的余量里分配
        const room = Math.max(0, budgetAll - titlePx);
        let scale = 1;
        if (manualTotal + needTotal > room && needTotal > 0) {
            scale = Math.max(0, room - manualTotal) / needTotal;
        }
        const cols = demand.map((d) => ({
            def: d.def,
            // 手动列**绝不缩放**（拖多少就是多少）；压缩只发生在自动列身上
            px: d.manual ? d.px : Math.max(NARROW_PX_MIN, Math.round(d.need * scale)),
        }));
        return { titlePx: Math.round(titlePx), cols };
    }

    /**
     * 手动宽度的**唯一清洗口**：非有限数 / 非正数 ⇒ 退回兜底；低于 `NARROW_PX_MIN` ⇒ 抬到下限。
     * ⚠️ ⛔ 不要在这里取整 —— 拖动时保留小数，取整会让「拖 1px」在手感上被吞掉（v2 之前的坑，见 startColResize）。
     */
    function clampManualPx(px: number | undefined, fallbackPx: number): number {
        if (px === undefined || !Number.isFinite(px) || px <= 0) return fallbackPx;
        return Math.max(NARROW_PX_MIN, px);
    }

    /**
     * 一列的目标像素宽。
     * · 用户拖过列宽（`colWeights` 里记着这个键）⇒ 按拖出来的量换算（1 权重 ≈ NARROW_PX_STEP 像素）；
     * · 否则给**该类列的固定宽度**：数值 / 状态 / 评分这类 80px 足够；长文本列（作者 / 平台）给 120px。
     * ⚠️ 固定 px 是用户的明确要求（「次要列设定固定的窄宽度，绝不随窗口拉宽而无限拉伸」），
     *    ⛔ 别改成百分比或 min-width —— 那样窗口一宽就又拉长了。
     */
    /**
     * 🔴 #687：每列的**最小需求宽**（内容没量到 / 量到也比它小时的下限）。
     *
     * 意义变了：以前这些是「固定宽」（窗口拉宽也不动），现在只是**下限**
     * —— 实测内容更宽就按实测走（见 `buildColViews` ③），所以短字段不会再被无谓撑开。
     * 依据仍是实测：
     *   · 年份 `1991–2014` / 状态胶囊 / `★8.4` / `2012-08-01`：约 76~90px 够；
     *   · 页数 `1222` 这类纯数字列：56px 足够（`NARROW_PX_MIN` 之上一点点）；
     *   · 进度是「文字 + 42px 细条」并排，152px 才能不折行（#680 实测，⛔ 别调小）；
     *   · 作者 / 出版社 / 系列这类长文本：120px 起，实测更长时按实测。
     */
    function colPxMin(def: TableColumnDef): number {
        if (def.key === '__progress') return NARROW_PX_PROGRESS;
        // 🔴 #687：ISBN 是 13 位定长数字。**实测**（`_probe_isbn2`）：
        //    内层 `.rl-tbl-cell` 可用宽 = 列宽 − 12（格内距），13 位数字在该字体下要 **102px**；
        //    列宽 112 ⇒ 内层 100 ⇒ 差 2px 被省略。⇒ 下限给 **118**（内层 106，留 4px 余量）。
        if (def.key === 'isbn') return 118;
        // 🔴 #687：评分列格子里是五颗星 + 数字（约 92px），比纯数字列宽得多 ——
        //    按 kind=number 给 56px 会被截成「★★★★★ 4…」（实测踩到）。
        if (def.key === 'rating' || def.key === '__community') return NARROW_PX_SCORE;
        // 纯数值列（页数 / 片长 / 集数…）内容就是几个数字，给得比通用档小
        if (def.kind === 'number') return NARROW_PX_NUM;
        if (LONG_TEXT_COLUMNS.has(def.key)) return NARROW_PX_LONG;
        return NARROW_PX_BASE;
    }

    /** 一列的目标像素宽（手动拖过 / 还没量到内容时的兜底）。
     * · 用户拖过列宽（`manualPx` 里记着这个键）⇒ 直接用那个 px（`buildColViews` 已走这条路，
     *   本函数现在只服务「兜底下限」）；
     * · 否则给该列的最小需求宽（`colPxMin`）。
     * ⚠️ 有实测内容宽时由 `buildColViews` 按实测分配。
     * ⚠️ 本函数内部不再被引用（v2 后列宽统一由 `buildColViews` 出）—— 保留给未来单列兜底用。
     */
    function colPx(def: TableColumnDef, px: number | undefined): number {
        if (px !== undefined && Number.isFinite(px) && px > 0) return Math.max(NARROW_PX_MIN, Math.round(px));
        return colPxMin(def);
    }

    /** 🔴 #680：进度列宽度 —— 必须容纳「文字 + 42px 细条」并排。
     *  ⚠️ 实测（`_shot_680`）：132px 时「11/21 章 · 50%」+ 42px 条仍被挤到文字截断 ⇒ 给到 **152px**，
     *     并把条的伸缩改成 `flex: 0 1 42px`（文字完整优先、条先让位，见 `.rl-prog-chip` 注释）。 */
    const NARROW_PX_PROGRESS = 152;

    /** 🔴 #680：这些列的内容通常比短字段长（作者 / 平台 / 专辑 / 出版社），固定宽给 120px */
    const LONG_TEXT_COLUMNS = new Set(['author', 'platform', 'album', 'publisher', 'developer', 'genres']);

    $: colViews = buildColViews(manualPx, autoWeights, columnDefs, tableAvailPx);
    /** 🔴 #684：容器宽变了就重算（`bind:clientWidth` 已在模板上） */
    $: tableAvailPx = wrapW > 0 ? wrapW : 1244;

    /** 表宽下限：列多了要横向滚动。
     *  🔴 #687：改成 **按各列实际分配宽累加**（原来是 `520 + 列数 × 78` 的粗估 ——
     *     12 列时估成 1456px，与实际分配完全脱节，且会让所有列一起被硬撑到该宽度）。
     *  🔴🔴 v2：标题列宽由 `buildColViews` **算好返回**（`colViews.titlePx`），这里只负责累加 ——
     *     组件里**不再有第二条**计算标题列宽的路径（旧 `titlePinned()` / `colPxForTitle()` /
     *     `tableExactWidth()` 三件套已删，它们互相抵消正是标题列拖不动的根因）。 */
    $: tableMinWidth = colViews.titlePx + OPS_W + (batchMode ? CB_W : 0) + colViews.cols.reduce((a, c) => a + c.px, 0);

    /**
     * 🔴🔴 v2（用户 2026-10-20「彻底重构 v2 版本的列表视图」）拖列宽的唯一实现。
     *
     * 旧实现在这里叠了三层补丁（`colWeights` 权重 / `titlePinned()` / `tableExactWidth()`），
     * 三者互相抵消，最终表现是**标题列拖不动、其他列拖得动**。现在只剩一条算术：
     *   `新宽度 = 拖动起始宽度 + (当前指针 x − 按下时的指针 x)`，直接写进 `manualPx[key]`（单位 px）。
     * ⛔ 不要再引入权重 / 百分比 / 二次分配 —— 拖多少就是多少，这是 v2 的硬口径。
     *
     * @param key 列键（含 `TITLE_KEY`）
     * @param startPx 按下时那一列**实际渲染**的宽度
     * @param startX 按下时的指针 x
     * @param clientX 当前指针 x
     */
    function applyResize(key: string, startPx: number, startX: number, clientX: number): void {
        const nextPx = Math.max(NARROW_PX_MIN, startPx + (clientX - startX));
        // 保留小数：取整会让「拖 1px」在连续 move 里被吞掉，手感变成「不动、突然跳一格」
        manualPx = { ...manualPx, [key]: nextPx };
    }

    function startColResize(ev: PointerEvent, key: string): void {
        ev.preventDefault();
        ev.stopPropagation();
        // 🔴 用户 2026-10-20：柄已移到 `<table>` 下（不再在 `<th>` 里）—— `closest('th')` 会返回 null，
        //    所以列宽基准**必须**从 `data-resize-col` 反查到那一列的 `th` 再量。
        //    ⚠️ 这里量到的是**当前实际渲染宽**（标题列没拖过时是「吃掉剩余」算出来的那个值，
        //       不一定等于 TITLE_MIN_PX）—— v2 就以它为拖动起点，⛔ 别改成从 manualPx 或常量取。
        const table = tableEl;
        const th = table?.querySelector<HTMLElement>(`thead th[data-col="${key}"]`) ?? null;
        const startPx = th ? th.getBoundingClientRect().width : NARROW_PX_BASE;
        const startX = ev.clientX;
        /**
         * 🔴🔴 #688：拖动期间**必须锁住自适应**，否则拖动基本无效。
         *    根因：`afterUpdate` 每帧都跑 `recomputeAutoWeights()`，它按**实测内容宽**重算并写
         *    `autoWeights`；而实测内容宽是不变的 ⇒ 每帧都把人刚拖出来的宽度**冲回内容宽**。
         *    修法：拖动中置 `resizing=true`，`recomputeAutoWeights()` 直接返回；松手后再解冻。
         * 🔴 `resizing` 是**普通变量**，它的变化不驱动模板更新 —— 松手时**显式**调一次
         *    `recomputeAutoWeights()` + `syncColResizeHeight()`，别指望反应式。
         */
        resizing = true;
        resizeColKey = key;
        /**
         * 🔴🔴 v2 的关键一步：按下时**立刻**把这一列钉成「起始宽」的手动值。
         *    没有这一步，标题列（此前走「吃掉剩余」）在第一帧之前 `manualPx` 里还没有它，
         *    每帧都会按剩余宽重算一遍，拖动量被整段吞掉 —— 这正是「标题列拖不动」的直接成因。
         */
        manualPx = { ...manualPx, [key]: startPx };
        const onMove = (e: PointerEvent) => {
            e.preventDefault();
            applyResize(key, startPx, startX, e.clientX);
        };
        const finish = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            window.removeEventListener('blur', up);
            resizing = false;
            resizeColKey = null;
            // 松手后解冻：让自适应按**新宽度**重新量一次（此时 manualPx 已含该键，
            // `recomputeAutoWeights` 会跳过它，不会冲掉用户的选择）；再同步一次柄的坐标。
            recomputeAutoWeights();
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => syncColResizeHeight());
            else syncColResizeHeight();
        };
        // 🔴 `finish` 必须**幂等**：pointerup / pointercancel / window blur 三路都可能先到，
        //    不幂等就会重复重算（第二次 `recomputeAutoWeights` 时 `resizing` 已是 false，会按旧内容宽覆盖）。
        const up = () => {
            if (!resizing) return;
            finish();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', up);
        // 🔴 用户 2026-10-20：原来只挂 `pointerup` —— 指针拖出 Obsidian 窗口 / 系统抢占 / 触屏打断时
        //    收不到 `pointerup`，`resizing` 永远为 true ⇒ 自适应冻结、后续拖动全部失效（只能重载插件）。
        window.addEventListener('pointercancel', up);
        window.addEventListener('blur', up);
    }

    // ── 列序：表头横拖（列序 = 数组顺序，⛔ 归一不按池子重排，见 pure/tableColumns）──────────
    let dragColKey: string | null = null;
    let overColKey: string | null = null;
    function onColDragStart(ev: DragEvent, key: string): void {
        if (!canEditColumns) {
            ev.preventDefault();
            return;
        }
        dragColKey = key;
        overColKey = key;
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', key);
        }
    }
    function onColDragOver(ev: DragEvent, key: string): void {
        if (!canEditColumns || !dragColKey) return;
        ev.preventDefault();
        overColKey = key;
    }
    function onColDragEnd(): void {
        dragColKey = null;
        overColKey = null;
    }
    function onColDrop(ev: DragEvent, key: string): void {
        ev.preventDefault();
        const from = dragColKey;
        onColDragEnd();
        if (!from || from === key || !tableType) return;
        const keys = [...tableKeys];
        const i = keys.indexOf(from);
        const j = keys.indexOf(key);
        if (i < 0 || j < 0) return;
        keys.splice(i, 1);
        keys.splice(j, 0, from);
        onTableColumnsChange(tableType, keys);
    }

    // ── 列配置菜单（「＋ 列」；只有单类型表能开）───────────────────────────────
    /** 列配置面板的锚点与位置（#621 追加件：入口从工具栏挪到**表头**） */
    let colAnchorEl: HTMLDivElement | null = null;
    let colPanelEl: HTMLDivElement | null = null;
    let colX = 0;
    let colY = 0;

    /**
     * 打开「设置表格的列」面板。
     * 🔴 定位走**锚点 + `absolute`**（与 `.rl-ctx` 同一套）：Obsidian 视图有 transform 祖先，`position: fixed`
     *    会被整体偏移 —— 本仓 `.rl-ctx-anchor` 的注释里已记过这条（#610 也是同一件事）。
     * ⚠️ 混类型表（「全部」页签）**照样打开**：面板里换成一行说明。⛔ 别退回「点了没反应」。
     */
    async function openColMenu(ev: MouseEvent): Promise<void> {
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        colX = 0;
        colY = 0;
        colMenuOpen = true;
        await tick();
        const anchor = colAnchorEl;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const m = colPanelEl?.getBoundingClientRect();
        const p = placeMenu({
            x: r.right,
            y: r.bottom + 4,
            menuW: m?.width ?? 220,
            menuH: m?.height ?? 320,
            vw: window.innerWidth,
            vh: window.innerHeight,
            minX: a.left,
            maxX: a.right,
        });
        // 视口坐标 → 锚点相对坐标（面板 absolute 挂在 `.rl-tbl-col-anchor` 上）
        colX = p.left - a.left;
        colY = p.top - a.top;
    }
    function closeColMenu(): void {
        colMenuOpen = false;
    }
    /** 点面板与按钮之外 ⇒ 收起（与右键菜单同款「点空白就关」） */
    function onColDocMouseDown(ev: MouseEvent): void {
        if (!colMenuOpen) return;
        const t = ev.target as Element | null;
        if (t && (colPanelEl?.contains(t) || t.closest('.rl-tbl-colmenu'))) return;
        colMenuOpen = false;
    }
    function toggleCol(key: string): void {
        if (!tableType) return;
        const on = tableKeys.includes(key);
        if (!on && tableKeys.length >= TABLE_COLUMN_LIMIT) {
            new Notice(`列数最多 ${TABLE_COLUMN_LIMIT} 条`);
            return;
        }
        // 新列**追加在末位**（⛔ 不插到池子顺序的位置：那会让用户「明明勾在中间、它跑到别处」）
        onTableColumnsChange(tableType, on ? tableKeys.filter((k) => k !== key) : [...tableKeys, key]);
    }

    // ── 单元格：编辑 / 键盘 / 撤销 ────────────────────────────────────────────
    /** 正在编辑的格子（`null` = 没在编辑） */
    let editingCell: { id: string; key: string } | null = null;
    /** 编辑中的**条目与列**（宿主回调只拿 id；这里要还原整条才能算「原值 / 有没有改」） */
    let editingEntry: MediaEntry | null = null;
    let editingDef: TableColumnDef | null = null;
    let editDraft = '';
    let editInput: HTMLInputElement | null = null;
    /** 键盘光标：未编辑时也记着「当前格」，供方向键 / 上下移动用 */
    let cellCursor: { r: number; c: number } | null = null;
    let tableEl: HTMLTableElement | null = null;

    /** 一格改动（撤销栈的单元）—— `prev` / `next` 都是可直接交给宿主的 patch */
    interface CellChange { id: string; key: string; prev: Partial<MediaEntry>; next: Partial<MediaEntry>; label: string }
    const UNDO_LIMIT = 50;
    let undoStack: CellChange[] = [];
    let redoStack: CellChange[] = [];

    function pushCellChange(ch: CellChange): void {
        undoStack = [...undoStack, ch].slice(-UNDO_LIMIT);
        redoStack = [];
    }

    /** 这一格能不能改：列本身可编辑 + 有读写绑定 + **这个键适用于这一行的类型** */
    function cellEditable(e: MediaEntry, def: TableColumnDef): boolean {
        return def.editable && hasTableCellBinding(def.key) && columnAppliesTo(def.key, e.type);
    }

    function findEntry(id: string): MediaEntry | undefined {
        return entries.find((x) => x.id === id);
    }

    function beginEdit(e: MediaEntry, def: TableColumnDef, r: number, c: number): void {
        if (!cellEditable(e, def)) return;
        cellCursor = { r, c };
        editingCell = { id: e.id, key: def.key };
        editingEntry = e;
        editingDef = def;
        editDraft = tableCellDraft(e, def.key);
        void tick().then(() => {
            editInput?.focus();
            editInput?.select();
        });
    }

    function cancelEdit(): void {
        editingCell = null;
        editingEntry = null;
        editingDef = null;
        editDraft = '';
    }

    /**
     * 提交一格。
     * 🔴 解析失败**不关编辑态**（用户就着原值改一下比重新点进来快），并且**当场** `Notice` 说明原因 ——
     *    静默回滚是「我明明改了它自己变回去」这类最难查的体验。
     */
    async function commitEdit(): Promise<void> {
        const e = editingEntry;
        const def = editingDef;
        // 🔴 双保险：`change` 与 `blur` 会几乎同时到（下拉改完那一瞬间）——
        //    没有这道闸，同一个格子会被写两次（第二次带着已经清空的 `editDraft` = 把值抹掉）。
        if (!editingCell || !e || !def || editingCell.id !== e.id || editingCell.key !== def.key) return;
        const text = editDraft;
        const r = parseTableCellInput(e, def.key, text);
        if (!r.ok) {
            new Notice(`「${def.label}」没写入：${r.reason}`);
            return;
        }
        const unchanged = text.trim() === tableCellDraft(e, def.key).trim();
        cancelEdit();
        if (unchanged) return;
        const prev = tableCellCurrentPatch(e, def.key);
        if (prev) pushCellChange({ id: e.id, key: def.key, prev, next: r.patch, label: def.label });
        await onCellCommit(e.id, r.patch);
    }

    /** 编辑框失焦 / 下拉改选 ⇒ 提交（⚠️ 两个 handler **都是箭头函数之外的具名函数**：
     *  Svelte 4 的模板表达式解析器不吃 `as` 断言 —— 本批实测 `(ev.currentTarget as X).value`
     *  会让整段编译报 `Unexpected token`，所以类型断言一律挪进 `script`）。 */
    function onEditBlur(): void {
        void commitEdit();
    }
    /** 编辑框设的键：Enter 提交 / Esc 取消 / Tab 提交后走格（与 Bases 一致） */
    function onEditKeydown(ev: KeyboardEvent): void {
        if (!editingDef) return;
        if (ev.key === 'Escape') {
            ev.preventDefault();
            cancelEdit();
            return;
        }
        if (ev.key === 'Enter' || ev.key === 'Tab') {
            ev.preventDefault();
            const isTab = ev.key === 'Tab';
            const back = ev.shiftKey;
            void commitEdit().then(() => {
                if (isTab) moveCursor(back ? -1 : 1);
            });
        }
    }

    /** 退格 / Delete：把这一格清空（⛔ 本来就空的别再写一次 —— 那会白刷一次视图） */
    async function clearCell(e: MediaEntry, def: TableColumnDef): Promise<void> {
        if (tableCellText(e, def.key) === '') return;
        const r = parseTableCellInput(e, def.key, '');
        if (!r.ok) {
            new Notice(`「${def.label}」清不掉：${r.reason}`);
            return;
        }
        const prev = tableCellCurrentPatch(e, def.key);
        if (prev) pushCellChange({ id: e.id, key: def.key, prev, next: r.patch, label: def.label });
        await onCellCommit(e.id, r.patch);
    }

    /** 表内**可编辑格**的有序清单（键盘导航与 Tab 都在这条线上走） */
    function editableCellList(): { r: number; c: number }[] {
        const out: { r: number; c: number }[] = [];
        listViewRows.forEach((row, r) => {
            if (row.kind !== 'entry') return;
            columnDefs.forEach((def, c) => {
                if (cellEditable(row.entry, def)) out.push({ r, c });
            });
        });
        return out;
    }

    function focusCellAt(r: number, c: number): void {
        const el = tableEl?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
        if (!el) return;
        cellCursor = { r, c };
        el.focus();
        // 🔴 #668（用户：「选中的方向键上下应该焦点聚焦滚动」）：原来只 `focus()` —— 格子落在可视区外时
        //    **焦点去了看不见的地方**，屏幕不动，读起来就是「按了没反应」。
        //    `block:'nearest'`：只在真的超出时才滚，已经在视野里就一个像素都不动（⛔ 别用 'center'，
        //    每按一次都整页跳一下更晕）。横向同理交给 `inline:'nearest'`（表格可横向滚）。
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    /** 焦点进到某一格 ⇒ 记下光标（方向键 / 上下移动都以它为准）。
     *  ⚠️ 抽成具名函数是因为模板属性里写对象字面量的箭头体会撞 Svelte 4 的表达式解析（见 `onEditBlur` 注释）。 */
    function setCellCursor(r: number, c: number): void {
        cellCursor = { r, c };
    }

    /** 左右 / Tab：在**线性**的可编辑格序列上前后走（末端夹住，不绕圈 —— 绕圈会让人以为丢了焦点） */
    function moveCursor(step: number): void {
        const cells = editableCellList();
        if (cells.length === 0) return;
        let idx = cellCursor ? cells.findIndex((x) => x.r === cellCursor?.r && x.c === cellCursor?.c) : -1;
        if (idx < 0) idx = step > 0 ? -1 : cells.length;
        const next = cells[Math.max(0, Math.min(cells.length - 1, idx + step))];
        if (next) focusCellAt(next.r, next.c);
    }

    /**
     * 上下：优先落到**同一列**的上一行 / 下一行。
     * ⚠️ 混类型表里同一列对某些行不适用（那些格子不可编辑）⇒ 那几行直接跳过；
     *    跳完了就停在原地（⛔ 不「就近找一列」—— 上下移动却横向漂移，比不动更让人迷失）。
     */
    function moveCursorVertical(dir: number): void {
        if (!cellCursor) return;
        const cur = cellCursor;
        const cells = editableCellList().filter((x) => x.c === cur.c && (dir > 0 ? x.r > cur.r : x.r < cur.r));
        if (cells.length === 0) return;
        const target = dir > 0 ? cells[0] : cells[cells.length - 1];
        focusCellAt(target.r, target.c);
    }

    function onCellKeydown(ev: KeyboardEvent, r: number, c: number, e: MediaEntry, def: TableColumnDef): void {
        if (editingCell) return;
        cellCursor = { r, c };
        switch (ev.key) {
            case 'ArrowRight': ev.preventDefault(); moveCursor(1); break;
            case 'ArrowLeft': ev.preventDefault(); moveCursor(-1); break;
            case 'ArrowDown': ev.preventDefault(); moveCursorVertical(1); break;
            case 'ArrowUp': ev.preventDefault(); moveCursorVertical(-1); break;
            case 'Tab': ev.preventDefault(); moveCursor(ev.shiftKey ? -1 : 1); break;
            case 'Enter': case 'F2': ev.preventDefault(); beginEdit(e, def, r, c); break;
            case 'Backspace': case 'Delete': ev.preventDefault(); void clearCell(e, def); break;
            default: break;
        }
    }

    /**
     * 表格容器上的键：Ctrl/⌘+Z 撤销、Ctrl/⌘+Shift+Z（或 Ctrl+Y）重做。
     *
     * 🔴 挂在 `window` 上、而**不是**给容器 `<div>` 挂 `on:keydown`：后者在 Svelte 的 a11y 检查里
     *    怎么说都不对 —— 不给 role 报「div 挂 keydown 必须有 ARIA role」，给了 `role="group"` 又报
     *    「非交互元素不该挂键盘监听」。而这个容器**本来就不是控件**（真正的控件是格子里那个 button），
     *    它只是「快捷键的作用域」⇒ 挂窗口监听 + 自己判定作用域才是如实的写法。
     * 🔴 作用域判定（⛔ 别放宽）：事件目标在表格内，**或**焦点已经不在任何控件上（`body`，即刚提交完
     *    那一瞬间）**且**撤销栈非空。这样在笔记编辑器里按 Ctrl+Z 不会被我们抢走（那里 target 是编辑器）。
     */
    function onWindowKeydown(ev: KeyboardEvent): void {
        if (ev.key === 'Escape' && colMenuOpen) {
            ev.preventDefault();
            closeColMenu();
            return;
        }
        const mod = ev.ctrlKey || ev.metaKey;
        if (!mod) return;
        const k = ev.key.toLowerCase();
        // 🔴🔴 #680 ⑤（用户：「搜索框增加支持 Ctrl+F 快捷聚焦」）：
        //    作用域 = **本组件在文档里且焦点不在输入类控件上**（在编辑器/表单里按 Ctrl+F 不该被抢走）。
        //    ⚠️ 不拦默认行为时浏览器会开「页内查找」气泡 ⇒ 必须 `preventDefault`。
        if (k === 'f') {
            const t = ev.target as HTMLElement | null;
            const typing = !!t?.closest('input, textarea, select, [contenteditable="true"]');
            if (typing) return;
            const box = searchInputEl;
            if (!box) return;
            ev.preventDefault();
            box.focus();
            box.select();
            return;
        }
        if (k !== 'z' && k !== 'y') return;
        const target = ev.target;
        const inside = target instanceof Node && !!tableEl && tableEl.contains(target);
        const onBody = target === document.body;
        if (!inside && !onBody) return;
        if (undoStack.length === 0 && redoStack.length === 0) return;
        ev.preventDefault();
        if (k === 'y' || ev.shiftKey) void redoCellChange();
        else void undoCellChange();
    }

    onMount(() => {
        window.addEventListener('keydown', onWindowKeydown);
        document.addEventListener('mousedown', onColDocMouseDown);
        return () => {
            window.removeEventListener('keydown', onWindowKeydown);
            document.removeEventListener('mousedown', onColDocMouseDown);
        };
    });

    /**
     * 🔴 #668 自适应列宽的**量测时机**：`afterUpdate`（DOM 已经是**这一版**的行之后）。
     * ⚠️ 不能在 `$:` 里量（那时还是上一版 DOM）；也不能只在挂载时量（换页签 / 筛类型 / 增删列都会变）。
     * ⚠️ 写 `autoWeights` 会让 `colViews` 重算 ⇒ 再触发一次 `afterUpdate`；本函数**只在结果真的变了时**赋值
     *    （先比一遍），否则就是无限更新（Svelte 会报 `flush_loop`）。
     */
    /**
     * 🔴 #668 把每个「拖宽手柄」的竖线拉成**整列高**（用户：「调整列宽度的竖指示器没有格子只有表头」）。
     *
     * 为什么必须用 JS 写坐标：手柄在 `<th>` 里，而 `<th>` 是 `position: relative` 的定位祖先 ⇒
     *   `top:0;bottom:0` 只能撑到表头高（实测 29px vs 整表 2130px）。要把线拉满整列，只能让
     *   **横向/纵向坐标都由 JS 写给 CSS 变量**（`--rl-tbl-x` / `--rl-tbl-h`），由样式表去用。
     * ⚠️ 每个手柄各写一份变量（内联 `style` 优先级高于样式表里的 `var()` 默认值）。
     * ⚠️ 只在**列表视图**跑；`afterUpdate` 里调用 —— 那时 DOM 是本版的行，量出来的高度才对。
     * ⚠️ 列宽/行数/滚动位置都不必触发重算：线的高度跟随表格总高，横向跟随手柄左缘。
     */
    function syncColResizeHeight(): void {
        const table = tableEl;
        if (!table) return;
        const h = table.offsetHeight;
        if (h <= 0) return;
        // 🔴 横向坐标必须用 `getBoundingClientRect()` 相对**表格自身**算：
        //    `th.offsetLeft` 的基准是**行**（`tr`）而不是 `table`，两者混用会把线画到别的列上
        //    （本批实测：year 列变量写 583px、实际渲染到 1105px，差 450px ≈ 标题列宽）。
        const tableLeft = table.getBoundingClientRect().left;
        // 🔴🔴 用户 2026-10-20：柄现在挂在 `<table>` 下（⛔ 不再在 `<th>` 里），所以**不能**再
        //    `handle.closest('th')`（那次调用会返回 null ⇒ 整条柄永远停在 -99px = 「拖不动」的根因之一）。
        //    ⇒ 用柄自己的 `data-resize-col` 反查那一列的 `th`。
        table.querySelectorAll<HTMLElement>(':scope > .rl-tbl-resize').forEach((handle) => {
            const key = handle.dataset.resizeCol;
            if (!key) return;
            const th = table.querySelector<HTMLElement>(`thead th[data-col="${key}"]`);
            if (!th) return;
            // 线的**中心**落在列右缘（视觉上压在格线上）：柄宽 10px、竖条居中在 left 4px + 1px 处
            // ⇒ 柄左缘 = 列右缘 − 5。
            const x = th.getBoundingClientRect().right - tableLeft - 5;
            handle.style.setProperty('--rl-tbl-x', `${x}px`);
            handle.style.setProperty('--rl-tbl-h', `${h}px`);
        });
    }

    afterUpdate(() => {
        if (viewMode !== 'list' || !tableEl) return;
        // 🔴 顺序有讲究：`recomputeAutoWeights()` 会**改列宽**（写 `autoWeights` ⇒ 重算 colViews ⇒ 下一帧才重排），
        //    而 `syncColResizeHeight()` 量的正是列右缘 —— 先量后改会拿到**旧布局**的坐标
        //    （本批实测：变量写 587、真实列右缘 646，差 50px）。
        //    ⇒ 先算宽、再在**下一帧**量位置（`requestAnimationFrame` 里读，此时 DOM 已按新列宽重排）。
        recomputeAutoWeights();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => syncColResizeHeight());
        else syncColResizeHeight();
    });

    async function undoCellChange(): Promise<void> {
        const ch = undoStack[undoStack.length - 1];
        if (!ch) return;
        undoStack = undoStack.slice(0, -1);
        redoStack = [...redoStack, ch];
        await onCellCommit(ch.id, ch.prev);
    }

    async function redoCellChange(): Promise<void> {
        const ch = redoStack[redoStack.length - 1];
        if (!ch) return;
        redoStack = redoStack.slice(0, -1);
        undoStack = [...undoStack, ch];
        await onCellCommit(ch.id, ch.next);
    }

    /**
     * 一格「**有没有值**」用的显示文本（空串 ⇒ 渲染 `—` 占位）。
     * ⚠️ 它只服务**占位判定与「点这里填」提示**：`rating` / `status` / 两个虚拟列在模板里是**专属渲染**
     *    （星 / 徽标 / 进度条），不走 `pure/tableCell` —— 那边只管 frontmatter 字段的读写，没有这些展示形态。
     */
    function cellDisplayText(e: MediaEntry, def: TableColumnDef): string {
        if (def.key === 'status') return statusLabel(e.type, e.status);
        if (def.key === 'rating') return e.rating > 0 ? `${e.rating}` : '';
        if (def.key === '__community') return e.communityScore != null ? scoreText(e) : '';
        if (def.key === '__progress') return listProgress(e).text;
        return tableCellText(e, def.key);
    }

    /** 编辑框的占位提示（只给「值的形态有讲究」的那几列；其余留空 —— ⛔ 别给每列都塞一句废话） */
    function cellEditPlaceholder(def: TableColumnDef): string {
        switch (def.key) {
            case 'status': return '想看 / 在看 / 已看 / 搁置';
            case 'rating': return '0~5，或 0~10（9/10）';
            case 'year': return '4 位数字';
            default: return def.kind === 'list' ? '用逗号分隔' : def.kind === 'date' ? '2026-10-13' : '';
        }
    }

    /** 系列折叠行在某一列上的文本（父级行不承载单条数据，只给能真聚合的几列；其余留空给 `—`） */
    function groupCellText(g: SeriesGroup, key: string): string {
        return seriesCellText(g, key);
    }
</script>

<!-- 层2：搜索（定宽）+ 添加 + 概览（小字弱化置右） -->
<div class="rl-toolbar">
    <div class="rl-search-wrap">
        <!-- 占位字前置搜索图标（lucide search，灰同占位字；用户 2026-09-12 需求） -->
        <Icon icon="search" size={13} cls="rl-search-ico" />
        <!-- 🔴 #444：搜索框里的 Esc **只清空搜索、不透传**（`stopPropagation`）——
             否则系列视图的 Esc 出口会跟着触发，「清一下关键词」变成「退出系列视图」。 -->
        <input
            class="rl-search"
            type="search"
            placeholder={searchPlaceholder}
            bind:value={searchText}
            bind:this={searchInputEl}
            aria-label="搜索条目"
            on:keydown={(ev) => { if (ev.key === 'Escape') { searchText = ''; ev.stopPropagation(); } }}
        />
    </div>
    <!-- 影视聚合页签「添加跟随聚焦」：聚焦 动画/剧集/电影 时新增表单默认该类型（规则见 pure/focusType）；聚焦「全部」→ undefined = EntryForm 默认电影；单类型页签恒锁 lockType。
         🔴 #555：系列视图里再兜一层 —— 范围已被该系列切干净（组键含 `type`，见 pure/seriesGroup），
         而此时 lockType / typeFilter 都还停在「全部」⇒ 默认型别只能从 `activeGroup.type` 取
         （用户报：「动画系列卡内添加条目默认成电影」）。
         书籍页签同步传当前子分类（kindFilter）：聚焦「漫画」→ 表单下拉选中「漫画」并走漫画源；「网文」→ 书籍+网文；「文学/全部」→ 缺省文学 -->
    <button class="rl-add mod-cta" data-tip="新建条目" on:click={() => onAdd(resolveAddType(lockType, typeFilter, activeGroup ? activeGroup.type : null), lockType === 'book' && kindFilter !== 'all' ? kindFilter : undefined)}><Icon icon="plus" size={14} /> 添加</button>
    <!-- 🔴 #632：工具栏**只剩「＋ 添加」一枚**（#631 那枚「批量添加」按钮与整套批量添加已整体退场，
         用户：「批量添加按钮入口从首页上移除，改成新增条目后搜索窗口不消失、可继续添加」）。
         ⛔ 别再把第二枚 CTA 挂回来 —— 连续添加走的是「新建条目」表单自身的收口（见 `EntryModal.onSubmit`）。 -->
    <!-- 🔴🔴 #633：列配置入口**已从这一组搬走** —— 现在挨着「切换视图」按钮排（见下面 `.rl-vb-view` 之后）。
         用户：「调整列表头序的按钮放在切换视图按钮的右旁边」。搬走后这一组只剩「搜索框 + 添加」，
         🔴 **列表视图与海报墙视图的搜索框位置逐像素一致**（#630 那版挂在组里 ⇒ 唯独列表视图下这一组多出一件、
         搜索框被推开）。
         ⚠️ 顺带纠正一个此前写错的描述：这条行**不是**「居中三段」，而是
            `.rl-vb-view{margin-left: auto}` 撑开的**左段（搜索框 + 添加）＋ 右段（视图切换 …）**
            —— `justify-content: center` 被 auto margin 吃掉了，居中根本没生效（实测：1280px 宽下
            搜索框左缘 41px）。⛔ 别再照抄「整组仍居中」。
         ⛔ 别再挂回「＋ 添加」旁边，也⛔ 别搬回表头（#621 试过，用户否掉）。 -->
    <!-- 🔴 #546 导航入口的插槽（用户：「页签纯文字入口放在与搜索框并排显示」）：
         宿主（HomeView）把 `NavMenu` 塞进来，落在**这一行的最右端** —— 与左侧「共 N 部」左右对称，
         而搜索框+「添加」那一组仍保持居中（⛔ 所以它是绝对定位的，不走 flex 项：进流会把这一组挤偏）。
         ⚠️ 不传就是空的（其它宿主 / 顶部胶囊布局下这里什么都不渲染）。
         ⚠️ 本行已有 `position: relative`（下方 `.rl-toolbar` 规则），正是那个绝对定位的参照物。
         🔴 #547：这一行左端原来还有一枚「库概览」（`N 项媒体`）—— 已按用户要求**整体删除**。 -->
    <!-- 🔴 #552 工具栏**左端**那枚库概览（#547 删过，用户上手后要求加回来）：
         `position: absolute; left: 0` 钉左（见下方 `.rl-toolbar .rl-libstats`），⛔ 不进 flex 流 ——
         那一行是 `justify-content: center`，进流会把「搜索框 + 添加」整组挤偏。
         ⚠️ 它与右端那枚导航入口（`nav-entry`）**左右对称**，正是 #546 把入口钉在右端时的参照物。 -->
    <span class="rl-libstats" role="group" aria-label="库概览">
        <span class="rl-libstats-total">{overviewTotal} {overviewUnit}</span>
    </span>
    <slot name="nav-entry" />
</div>

<!-- 层3：类型 Pill（居左，分类导航感）+ 状态下拉 + 排序下拉 + 视图（一行，无边框） -->
<div class="rl-viewbar">
    <!-- 🔴 #444：**系列视图下类型 / 阅读分类分组整块隐藏**（用户：「点击进入任一系列视图后隐藏
         【全部/动画/剧集/电影】等或阅读分组，仅在按 esc 退出系列视图才重新显示」）——
         原位置换成**系列视图指示条**（海报墙 / 列表 / 瀑布流三态共用一条）。
         ⚠️ 状态 / 排序 / 题材 / 视图切换**照常保留**：用户点名要隐藏的只有「类型 / 分类」这两组。 -->
    {#if activeGroup}
        <span class="rl-series-bar" role="status">
            <span class="rl-series-bar-cnt">只显示</span>
            <span class="rl-series-bar-name">{activeGroup.title}</span>
            <span class="rl-series-bar-cnt">{activeGroup.items.length} 部</span>
            <button class="rl-series-bar-back" on:click={closeSeries} data-tip="返回全部（Esc）">返回全部</button>
        </span>
        <span class="rl-vb-sep" aria-hidden="true"></span>
    {:else}
        {#if scope !== null}
            <!-- 🔴 #550 合并视图：原来那两排 chips（类型 / 书籍子分类）**整体退场**，改由这一枚下拉承担 ——
                 9 项里已含 文学 / 网文 / 漫画，两排并排就是同一件事说两遍。
                 ⚠️ 受控：值来自宿主（`scope`），改动**回推**（`onScopePick`）—— ⛔ 不在本组件另存一份。 -->
            <span class="rl-vb-select">
                <span class="rl-sel-label">媒体类型</span>
                <!-- 🔴 #566 换自绘 `MiniSelect`：原生 select 的 popup（Windows）不受 CSS 控制，
                     `option{text-align:center}` 管不到展开列表（用户实测「弹出列表没居中」）。
                     受控口径不变：`value` 进、`onPick` 回推。 -->
                <MiniSelect
                    value={scope}
                    options={scopeOptions}
                    ariaLabel="媒体类型"
                    group="rl-toolbar-filters"
                    onPick={pickScope} />
            </span>
            <span class="rl-vb-sep" aria-hidden="true"></span>
        {:else if !lockType}
            <span class="rl-vb-group" role="group" aria-label="类型筛选">
                {#each typeChips as t}
                    <button class:on={typeFilter === t} aria-pressed={typeFilter === t} on:click={() => (typeFilter = t)}>
                        {t === 'all' ? '全部' : ENTRY_TYPE_LABELS[t]}<span class="rl-cnt">{typeCounts[t]}</span>
                    </button>
                {/each}
            </span>
            <span class="rl-vb-sep" aria-hidden="true"></span>
        {/if}
        {#if scope === null && lockType === 'book'}
            <span class="rl-vb-group" role="group" aria-label="书籍分类">
                {#each kindChips as k}
                    <button class:on={kindFilter === k} aria-pressed={kindFilter === k} on:click={() => (kindFilter = k)}>
                        {k === 'all' ? '全部' : BOOK_KIND_LABELS[k]}<span class="rl-cnt">{kindCounts[k]}</span>
                    </button>
                {/each}
            </span>
            <span class="rl-vb-sep" aria-hidden="true"></span>
        {/if}
    {/if}
    <!-- 状态下拉：合并视图下由宿主受控（改动回推宿主），其余情况本组件自管（`onStatusPick` 是空实现）。 -->
    <span class="rl-vb-select">
        <span class="rl-sel-label">状态</span>
        <!-- 🔴 #566 同上：自绘下拉，闭合框与展开列表都真居中 -->
        <MiniSelect
            value={statusFilter}
            options={statusOptions}
            ariaLabel="状态筛选"
            group="rl-toolbar-filters"
            onPick={pickStatus} />
    </span>
    {#if viewMode !== 'grouped'}
        <!-- 排序下拉：与状态同款受控（合并视图下改动回推宿主）；音乐分组视图没有排序 ⇒ 整段不渲染（#547 原门控）。 -->
        <span class="rl-vb-select">
            <span class="rl-sel-label">排序</span>
            <!-- 🔴 #566 同上：自绘下拉。🔴 #444 口径不变：选项走 `sortOptions` ——
                 系列序号两档**只在系列视图里出现**（见 script 里那条 `$:`） -->
            <!-- 🔴 #572：**不画下拉箭头** —— 排序的值自带 ↑/↓ 方向箭头（用户实测截图
                 「多了个向下箭头重叠了」），再画一枚 ▾ 就是两枚箭头叠在同一个框里。 -->
            <MiniSelect
                value={sortBy}
                options={sortSelOptions}
                ariaLabel="排序方式"
                chevron={false}
                group="rl-toolbar-filters"
                onPick={pickSort} />
        </span>
        <!-- 题材（视图级，用户 2026-09-22）：紧贴「排序」右侧的同款胶囊；genreScope 为 null 的视图
             （阅读-全部 / 影视-全部）整块不渲染 —— 题材池按子视图隔离，父级视图不提供这一维。
             与排序同受 grouped 门控（音乐分组歌单视图没有排序，也不该有题材）。 -->
        {#if genreScope}
            <span class="rl-vb-select rl-genre-wrap" class:is-open={genreOpen}>
                <span class="rl-sel-label">题材</span>
                <button
                    class="rl-genre-btn"
                    class:is-on={genreSel.length > 0}
                    aria-label="题材筛选"
                    aria-expanded={genreOpen}
                    on:click={toggleGenrePanel}>
                    {genrePill}<span class="rl-genre-caret" aria-hidden="true">▾</span>
                </button>
                {#if genreOpen}
                    <div class="rl-genre-panel">
                        <div class="rl-genre-head">
                            <span>题材</span>
                            <button class="rl-genre-all" on:click={selectAllGenres}>{allGenresSelected ? '清空' : '全选'}</button>
                        </div>
                        <div class="rl-genre-body">
                            {#if genreOptions.length === 0}
                                <div class="rl-genre-none">该视图下的条目暂无题材</div>
                            {:else}
                                {#each genreOptions as o (o.key)}
                                    <label class="rl-genre-opt">
                                        <input type="checkbox" checked={genreSel.includes(o.key)} on:change={() => toggleGenreOption(o.key)} />
                                        <span class="rl-genre-name">{o.label}</span>
                                        <span class="rl-genre-cnt">{o.count}</span>
                                    </label>
                                {/each}
                            {/if}
                        </div>
                    </div>
                {/if}
            </span>
        {/if}
        <!-- 🔴 #435 的「系列」筛选下拉已按用户要求**整块删除**（原话：「删除这个筛选系列框，海报墙有且默认折叠起来」）
             ⇒ 这里回到「状态 / 排序 / 题材」三件。系列只由**折叠卡**承担：折叠卡默认就是叠着的
                （`activeSeriesKey` 初值 null），点它是进**这一系列自己的视图**（#437；不是就地摊开），
                回来走工具栏那枚「返回全部」或直接按 Esc（#444）。
             ⚠️ 进系列视图后本行**左侧那一截会换成系列视图指示条**（`.rl-series-bar`），类型 / 分类分组隐藏（#444）。
             ⛔ 别把「系列」控件加回工具栏：断言脚本里有反向守卫钉着（工具栏不许再出现第二个「系列」控件）。 -->
    {/if}
    <!-- 🔴 #552：这里原先有一个**筛选行尾插槽**（#550 起挂合并视图那枚「更多」菜单，#551 还把
         它从三视图之后挪到之前）—— 用户上手后裁定「把海报墙更多菜单放在**右上角与搜索框并排**」
         ⇒ 它挪去工具栏那一行（走 `nav-entry`，与 `NavMenu` 同一个挂载点），本插槽**整体删除**
         （没有使用者的插槽 = 死码，本仓「死码不留」）。
         ⚠️ 注释**刻意不写那个被删的插槽名** —— 写了会撞红「它不得回潮」那条反向守卫（本仓老坑）。 -->
    <!-- 🔴🔴 #598：视图切换由「分段控制器（三枚符号按钮）」改成**单枚下拉菜单** ——
         用户：「切换海报墙/列表/瀑布流视图控件还是太丑了，有什么其他方案切换」。
         闭合框 = 「当前视图的图标 + 名字 + ▾」；点开是选项表（每项**图标 + 名字**，当前那项走主题色 + 一枚轻勾）。
         图标 / 名字一律取自 `pure/viewModes`，⛔ 不在这里手写第二份。
         ⚠️ 音乐专有的「分组歌单」由 `viewChoices` 按 `lockType === 'music'` 追加（不在通用表里）。 -->
    <!-- 🔴🔴 需求 9（用户 2026-10-21）：「列表视图工具栏……排布成：… 题材、批量管理、列、分组、切换视图」。
         ⇒ 本组（批量管理 / 列 / 分组）从「切换视图」**之后**搬到**之前**：视图切换仍是行尾最后一枚，
            三者贴着它左排（**取代** #633 那版「列按钮挨着切换视图右边」的排布）。
         ⚠️ 它们仍整体落在 `.rl-vb-view{margin-left:auto}` 的**右侧簇**里（auto 边距吃在「题材」与本组之间），
            ⛔ 别挪回左段那一组（#633 实测过：那会把搜索框推开，列表与海报墙两视图的搜索框左缘就不齐了）。
         ⚠️ 渲染条件仍是**只在列表视图**：其它视图没有表格列、没有勾选列，也没有「并组」这回事
            （#622 用户原话就是「海报墙…多出了个『列』按钮什么东西没用」⇒ ⛔ 常驻后置灰）。
         ⚠️ 行尾那枚导航入口是绝对定位、只在「侧边栏 / 合并视图」布局下才渲染（默认 `navLayout:'top'` 时插槽为空）
            ⇒ 共存时贴在本组右侧，⛔ 别给这里加绝对定位（会把导航入口压住）。
         ⚠️ 文案跟着工具栏的语言走（**图标 + 文字**，与「添加」同款），⛔ 不做纯图标小方块。 -->
    {#if viewMode === 'list'}
        <!-- 🔴🔴 #680 ③-3：**「批量管理」入口**（用户：「默认隐藏勾选框，列表顶部加一个批量管理入口；
             点击进入多选模式，勾选框才出现」）。只在列表视图出现 —— 其它视图没有表格列，也没有勾选列。 -->
        {#if batchMode}
            <button
                class="rl-tbl-colmenu is-on"
                type="button"
                aria-pressed="true"
                data-tip="退出批量管理（并清空已选）"
                on:click={finishBatch}><Icon icon="check-square" size={13} /> 批量管理</button>
        {:else}
            <button
                class="rl-tbl-colmenu"
                type="button"
                aria-pressed="false"
                data-tip="进入批量管理：出现勾选框，可批量改状态 / 评分 / 标签 / 删除"
                on:click={enterBatchMode}><Icon icon="check-square" size={13} /> 批量管理</button>
        {/if}
        <!-- 🔴 #633：列配置入口（勾选列 / 取消列；列头可拖动调序）。 -->
        <button
            class="rl-tbl-colmenu"
            type="button"
            aria-haspopup="true"
            aria-expanded={colMenuOpen}
            data-tip="设置表格的列（勾选 / 取消；列头可拖动调序）"
            on:click={openColMenu}><Icon icon="columns-2" size={13} /> 列</button>
        <!-- 🔴 需求 9 核心件：**「展示分组 / 不并组展示」单循环切换**（同一枚按钮两种口径来回翻，⛔ 不是两枚按钮）。
             可见文案 = **当前口径**（图标同步：树形 `list-tree` / 平铺 `list`），
             `aria-pressed` 标「不并组是否生效」，`data-tip` 先说当前口径、括号里再说点一下会变成什么。
             ⚠️ 只在列表视图出现（摊平只作用于列表；海报墙 / 卡片网格 / 瀑布流 / 时间线行为一律不变）。
             ⚠️ 宿主没注入 `onToggleGrouping`（`null`）时**整枚不渲染** —— 不画一枚点了没反应的按钮。 -->
        {#if onToggleGrouping}
            <button
                class="rl-tbl-colmenu"
                class:is-on={!listGrouping}
                type="button"
                aria-pressed={!listGrouping}
                data-tip={listGrouping
                    ? '展示分组：同系列折叠成组（点击改为不并组展示）'
                    : '不并组展示：每条独立一行（点击改为展示分组）'}
                on:click={() => onToggleGrouping?.(!listGrouping)}>
                <Icon icon={listGrouping ? 'list-tree' : 'list'} size={13} />
                {listGrouping ? '展示分组' : '不并组展示'}
            </button>
        {/if}
    {/if}
    <span class="rl-vb-view" role="group" class:is-open={viewOpen}>
        <!-- 🔴🔴 #670（用户：「鼠标 hover 轻提示还有覆盖两层不可见」）：这枚按钮**同时挂了 `aria-label` 与 `data-tip`**，
             而 Obsidian 会给带 `aria-label` 的元素自绘官方气泡、本仓的 `data-tip` 也是自绘的 ⇒ **同屏两层**。
             按钮里已经有可见文字（当前视图名 + ▾），读屏本来就念得出来 ⇒ **删掉 `aria-label`，只留 `data-tip`**
             （与 UI-GUIDE §3「`aria-label` 不得出现在带 `data-tip` 的元素或祖先链上」对齐）。
             ⚠️ 全仓只有这一处是同元素双挂（2026-10-19 以 `_audit670_chain2.cjs` 逐个标签扫过）。 -->
        <button
            class="rl-vb-btn"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={viewOpen}
            data-tip="切换视图"
            on:click={toggleViewMenu}>
            {#if currentView}<Icon icon={currentView.icon} size={14} />{/if}
            <span class="rl-vb-cur">{currentView ? currentView.label : ''}</span>
            <span class="rl-vb-caret" aria-hidden="true">▾</span>
        </button>
        {#if viewOpen}
            <div class="rl-vb-pop" role="listbox" aria-label="切换视图">
                <!-- 🔴 #668 用户：「切换视图按钮也支持**自由排序并持久化**」⇒ 选项可**上下拖**换位置，
                     松手即写设置（`onViewOrderChange`）。拖拽判据全在值上，见 `onViewDrop`。 -->
                {#each viewChoices as c (c.value)}
                    <button
                        class="rl-vb-opt"
                        class:on={c.value === viewMode}
                        class:is-dragging={dragViewValue === c.value}
                        class:is-over={dragViewValue !== null && overViewValue === c.value && dragViewValue !== c.value}
                        type="button"
                        role="option"
                        aria-selected={c.value === viewMode}
                        draggable="true"
                        on:dragstart={(ev) => onViewDragStart(ev, c.value)}
                        on:dragover={(ev) => onViewDragOver(ev, c.value)}
                        on:drop={(ev) => onViewDrop(ev, c.value)}
                        on:dragend={onViewDragEnd}
                        on:click={() => pickView(c.value)}>
                        <Icon icon={c.icon} size={14} />
                        <span class="rl-vb-opt-label">{c.label}</span>
                        <span class="rl-vb-tick" aria-hidden="true">{c.value === viewMode ? '✓' : ''}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </span>
</div>

{#if selectedIds.size > 0}
    <div class="rl-batchbar" role="group">
        <span class="rl-batch-cnt">已选 {selectedIds.size} 项</span>
        <!-- 🔴 #608：**批量条上那组「序号 [起始] [步长] [重排序号]」整体删除**（用户裁定）。
             重排序号的入口改挂**海报墙系列折叠卡的右键菜单**（一条「排序号」，整组按当前顺序 1..N）——
             ⛔ 别在这儿加回来：同一件事只留一个入口。 -->
        <select bind:value={bulkStatus} aria-label="批量状态">
            <option value="">批量改状态…</option>
            {#each MEDIA_STATUSES as s}
                <option value={s}>{statusLabel(lockType ?? 'movie', s)}</option>
            {/each}
        </select>
        <select bind:value={bulkRating} aria-label="批量评分">
            <option value={0}>批量评分…</option>
            {#each [1, 2, 3, 4, 5] as n}
                <option value={n}>{n}★</option>
            {/each}
            <option value={-1}>清除评分</option>
        </select>
        <input class="rl-batch-tags" placeholder="批量标签（逗号分隔）" bind:value={bulkTagsText} aria-label="批量标签" />
        <button class="rl-batch-btn" disabled={!bulkStatus && !bulkRating && !bulkTagsText.trim()} on:click={applyBulkAll} data-tip="应用到选中条目">应用</button>
        <button class="rl-batch-btn rl-batch-danger" on:click={bulkDelete} data-tip="删除选中（会二次确认）">删除</button>
        <button class="rl-batch-btn" on:click={clearSelection} data-tip="只清空已选，仍在批量管理模式">取消选择</button>
        <button class="rl-batch-btn" on:click={finishBatch} data-tip="退出批量管理（勾选框随之隐藏）">退出批量</button>
    </div>
{/if}

{#if lockType === 'music' && viewMode === 'grouped'}
    <!-- 音乐「分组歌单」视图（可切换；组头（歌手 + 计数）→ 组内窄行（封面/歌名/专辑·年份/状态/播放/编辑）） -->
    {#each musicGroups as g}
        <div class="rl-music-group">
            <div class="rl-music-group-head">{g.artist}<span class="rl-music-cnt">{g.entries.length} 首</span></div>
            {#each g.entries as e (e.id)}
                <div class="rl-music-row" class:rl-sel-card={selectedIds.has(e.id)} role="link" tabindex="0" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }} on:contextmenu={(ev) => openCtx(e, ev)}>
                    {#if posterUrl(e)}
                        <img class="rl-music-cov" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                    {:else}
                        <div class="rl-music-cov rl-music-cov-ph" aria-hidden="true"><Icon icon="music" size={15} /></div>
                    {/if}
                    <div class="rl-music-info">
                        <div class="rl-music-title">{e.title}</div>
                        <div class="rl-music-sub">{cardSubtitle(e)}</div>
                    </div>
                    <div class="rl-music-meta">
                        <span class="rl-badge rl-badge-{e.status}" on:click={(ev) => { ev.stopPropagation(); toggleMenu(e.id); }}>
                            {statusIcon(e.status)} {statusLabel(e.type, e.status)}
                        </span>
                        {#if e.rating > 0}
                            <!-- 🔴 #619 半星：星**不用字符**渲染（U+2BE8 字体覆盖不稳，实测成残缺星形），
                                 改为恒排 5 个满星 + `--fill` 交给 CSS 按比例裁切填充（见 `.rl-my-inline`）。
                                 ⚠️ 图形是 `aria-hidden` 的装饰 ⇒ 真值走旁边的 `.rl-sr` 给读屏。 -->
                            <span class="rl-my-inline" style={`--fill:${e.rating}`} aria-hidden="true">★★★★★</span>
                            <span class="rl-sr">个人评分 {e.rating} 星</span>
                        {/if}
                    </div>
                    <div class="rl-music-ops">
                        {#if e.audioPath}
                            <button class="rl-music-play" data-tip="播放音乐" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon="play" size={13} /><span class="rl-sr">播放音乐</span></button>
                        {/if}
                        <button class="rl-music-edit" data-tip="编辑属性" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onEditEntry(e.id); }}>✎<span class="rl-sr">编辑属性</span></button>
                    </div>
                </div>
            {/each}
        </div>
    {/each}
    {#if emptyState}
    <div class="rl-empty" role="status">
        <div class="rl-empty-title">{emptyState.title}</div>
        {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
        {#if emptyState.action === 'clear'}
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除筛选与搜索">清除筛选</button>
        {/if}
    </div>
{/if}
{:else if viewMode === 'grid' || viewMode === 'wall'}
    <!-- 🔴 #624：**卡片网格（grid）与海报墙（wall）共用这一支** —— 两者只差卡片的呈现：
         `wall` 时容器多一个 `rl-wall`，`.rl-wall …` 那组样式把信息栏与封面上的评分角标收掉，
         只留「封面（2:3 裁切）+ 一行标题」。⚠️ `.rl-cov` 本来就是 `aspect-ratio: 2/3` ⇒ 卡片天然等高。
         ⛔ 别为 `wall` 另开一个 `{:else if}` 分支：`drawList`（含折叠卡 / 组头）、右键菜单、选择态
            全在下面这一大段里，复制一份 = 两份必然漂移（本仓「同一件事只许一处实现」）。 -->
    <!-- 列数：设置档位 → grid-template-columns 串（pure/posterGrid）。
         ⛔ 不改 waterfall 列数；CSS 里的 fallback 与「标准」档完全一致（内联 style 缺席也不塌成单列） -->
    <!-- 🔴 #591：`use:zoomWheel` 挂的是**元素上的非被动** wheel 监听（见 script 里那三条纪律）。
         🔴 #626 参数按视图给 `'grid'` / `'wall'`，只为标明「缩的是哪个视图」——用户 2026-10-20
             删除「海报墙列数」后两者**落盘出口已统一**（都写共享的 posterDensity / posterColumns），
             ⛔ 别再按这个参数分流到第二个列数键。
         🔴 #626 列模板走 `gridColsTemplate`（墙与网格只差 gap）。 -->
    <div class="rl-grid" class:rl-wall={viewMode === 'wall'} use:zoomWheel={wallView ? 'wall' : 'grid'} style={`grid-template-columns:${gridColsTemplate}`}>
        <!-- 🔴 #434：从条目序列改成 `drawList` —— 一行可能是散卡 / 折叠卡 / 组头。
             摊平（而不是三个分支各写一遍卡片标记）的理由见 script 里 DrawItem 的注释。 -->
        {#each drawList as it (it.kind === 'card' ? it.entry.id : it.group.key)}
        {#if it.kind === 'card'}
            {@const e = it.entry}
            <div
                class="rl-card"
                class:rl-sel-card={selectedIds.has(e.id)}
                role="link"
                tabindex="0"
               
                on:click={() => onOpenEntry(e.id)}
                on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}
                on:contextmenu={(ev) => openCtx(e, ev)}>
                {#if colorTheme === 'colorful'}
                    <div class="rl-type-bar" style={`background:${TYPE_COLORS[e.type]}`}></div>
                {/if}
                <div class="rl-cov-wrap">
                    {#if posterUrl(e)}
                        <img class="rl-cov" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                    {:else}
                        <!-- 🔴 2026-09-30 #434 修一个**真 bug**：`--h` 与 `--tc` 之间原来是**空格**分隔
                             ⇒ 自定义属性的值**一直读到下一个分号** ⇒ 只声明了一条 `--h`（值 = `210 --tc:#378ADD`，
                             非法色相），**`--tc` 压根没声明**。而下面 CSS 里 `.rl-cov-ph[style*="--tc"]` 是
                             **属性子串匹配**、照样命中，于是把基础规则那条 `background` 顶掉、换上
                             `background:var(--tc)` ⇒ var 为空 ⇒ **invalid at computed-value time ⇒ 底色退成透明**
                             ⇒ 白字 + 透明底 = **封面整个看不见**（只剩 4px 类型色条）。
                             只有「没有封面的条目 + colorful 档」触发，所以一直没被发现（搜索回填的条目都有封面）。
                             ⇒ **分隔符必须是分号**（实测：`--h="210 --tc:#378ADD"`/`--tc=""`/底色透明
                               vs `--h:210;--tc:#378ADD`/`--tc="#378ADD"`/底色 `rgb(55,138,221)`）。
                             ⛔ 别为了「看着整齐」把它改回空格。 -->
                        <div class="rl-cov rl-cov-ph" style={`--h:${hash(e.id) % 360}${colorTheme === 'colorful' ? `;--tc:${TYPE_COLORS[e.type]}` : ''}`}><span>{e.title.slice(0, 2)}</span></div>
                    {/if}
                    <!-- 大众评分角标（用户 2026-09-22：从 meta 行搬到**封面右上角**常显，hover / 键盘聚焦封面时淡出）。
                         与 hover 遮罩（⋯ / 打开笔记 / 播放）共用同一块角 —— 两者**从不同时出现**，所以不打架。
                         ⚠️ 2026-09-22 用户追加「要显示数据源」⇒ 角标 = 「来源名 + 数值★」：
                            · 来源名 `.rl-cov-src`（弱化色）**#430 起由 `pure/sourceMeta.entrySourceLabel` 提供**
                              —— 手填的 `sourceName` 优先、否则回落到数据源键的中文名；
                            · 数值 + 后缀星仍是暖黄主角；`.rl-cov-src` 缺席时角标自然退化回「数值★」（老条目无 source）。
                         全类型通吃（书籍/影视/动画/游戏/音乐，只要 communityScore 有值就显示），无类型门控。 -->
                    <!-- 🔴 #624：海报墙上连**封面角标**也不出现（它同样是「评分」）。 -->
                    {#if !wallView && scoreText(e)}
                        <!-- 🔴 #430：来源名改走**唯一裁决入口** `entrySourceLabel(e)` ——
                             它**手填优先**（`sourceName`）、否则回落数据源键的中文名。
                             在此之前这里只认数据源键 ⇒ 手工新建的条目（没有数据源键）角标上只有「8.4★」，
                             用户要的「番茄8.4★」显示不出来。
                             ⛔ 别再退回「只认数据源键」的那个旧助手 —— 那条路正是本批要修的漏。 -->
                        {@const srcLabel = entrySourceLabel(e)}
                        <span class="rl-cov-score"
                              data-tip={`大众评分（来源：${srcLabel || '—'}）`}>{#if srcLabel}<span class="rl-cov-src">{srcLabel}</span>{/if}{scoreText(e)}★</span>
                    {/if}
                    <!-- 游戏游玩时长角标（🔴 #471，用户原话：「游戏类型海报墙上已玩 10h 放在游戏封面左下角用个标记」）
                         —— 从元信息区那行 `.rl-prog` **搬来**，呈现位置变了、取值口径没变（`cardPlaytimeBadge`）。
                         几何照抄右上角的 `.rl-cov-score`（6px 内距 / 10px / 黑底胶囊），⛔ 别发明第二套尺寸；
                         位置之所以选**左下**：左上是类型色条（`.rl-type-bar` 在封面之上）、右上已被评分角标与
                         hover 的 ⋯ 占用、右下是播放圆钮 —— 左下是唯一空角。
                         仅游戏且有时长才渲染（`cardPlaytimeBadge` 空串 ⇒ 整个角标不出现，封面不留空槽）。 -->
                    <!-- 🔴 #558（用户 2026-10-08：「把底部的进度信息（0%、进度条、0/14页）**移到封面图的最底部、
                         悬浮覆盖在封面上**」＋「第一行（序号① 和 已读 2h 并排）是**动态可选**的…第二行
                         （0% + 进度条 + 0/14页）固定且必须单行铺满」）——
                         **封面底部悬浮区**：两行共用一块半透明黑渐变遮罩。
                         · 第一行（可选）＝ 系列序号 + 时长（已玩 Nh / 已读 Nh），**恒左对齐 + 固定间距**；
                         · 第二行（有进度才出现）＝ 百分比 + 条 + N/M 页，单行铺满。
                         🔴 **无数据降级**：第一行两件都没有时**整行不渲染**（⛔ 不留空占位行），
                            遮罩随之只包住进度条 ⇒ 条直接贴底。
                         ⚠️ 时长 / 序号**沿用原来的类名**（`.rl-cov-playtime` / `.rl-cov-series-no`）：
                            它们是 #537 / #530 立下的单一真源（「同一个类、同一套几何」）；
                            本批只改**它们所处的容器**（两个绝对定位角标 → 一行 flex 子项）。
                         ⚠️ 文字改用白字（**唯一的偏离**）：原色是 `--text-faint`（浅色主题下是深灰），
                            压在黑色遮罩上会直接消失；「不要改风格」按**字号 / 条粗细 / 填充色**理解。
                            遮罩本身是**渐变**（不是实底）⇒ 封面下半部分仍看得见。 -->
                    <!-- 🔴 #624：海报墙上**封面底部的进度 / 时长遮罩**也不渲染（属「信息栏」那一类）。 -->
                    {#if !wallView && (cardPlaytimeBadge(e) || cardReadBadge(e) || seriesNo(e, !!activeGroup) !== undefined || readPercent(e) !== undefined)}
                        <div class="rl-cov-foot">
                            {#if cardPlaytimeBadge(e) || cardReadBadge(e) || seriesNo(e, !!activeGroup) !== undefined}
                                <div class="rl-cov-foot-top">
                                    {#if seriesNo(e, !!activeGroup) !== undefined}
                                        <span class="rl-cov-series-no" data-tip={`系列序号：${seriesNo(e, !!activeGroup)}`}>{seriesNo(e, !!activeGroup)}</span>
                                    {/if}
                                    {#if cardPlaytimeBadge(e)}
                                        <span class="rl-cov-playtime" data-tip="游玩时长（游玩记录累计）">{cardPlaytimeBadge(e)}</span>
                                    {:else if cardReadBadge(e)}
                                        <!-- 🔴 #537 书籍「已读 2h」：**同一个类** `.rl-cov-playtime`（几何只有一套；
                                             ⛔ 别新造 `.rl-cov-readtime`）。与游戏互斥（一卡只可能是其中一类）。 -->
                                        <span class="rl-cov-playtime" data-tip="阅读时长（阅读器累计 + 手动填写）">{cardReadBadge(e)}</span>
                                    {/if}
                                </div>
                            {/if}
                            {#if readPercent(e) !== undefined}
                                <div class="rl-readrow">
                                    <span class="rl-read-pct">{readPercent(e)}%</span>
                                    <div class="rl-readbar"><div class="rl-readbar-fill" style={`width:${readPercent(e)}%`}></div></div>
                                    {#if e.readingProgress?.totalPage}
                                        <span class="rl-read-pages">{e.readingProgress.page ?? 0}/{e.readingProgress.totalPage} {bookUnitOf(e)}</span>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                    <!-- 🔴 #552（用户上手后推翻 #549③：「海报墙上的阅读进度怎么是这样的**看不清进度**」
                         ⇒ 裁定「把条和数字和百分比**并排**显示，就像原来那样」）：
                         封面底边那条**整体撤除**，阅读进度回到元信息区那一行（百分比 + 条 + N/M 页，见下方 `.rl-readrow`）。
                         ⚠️ 病根是**位置 + 对比**：4px 通栏压在封面上，深色封面（黑底海报 / 暗色实拍）里根本读不出来；
                         而数字那行又小又浅。并排放成一行才有「一眼看到读了多少」的效果。
                         ⛔ 别再往封面底边加第二条（同屏两条 = 同一件事说两遍，本仓老规矩）。 -->
                    <!-- Hover 快速操作（阶段6：弱化播放器感——「打开笔记 ↗」文字按钮，而非大 ▶） -->
                    <div class="rl-cov-hover">
                        <button
                            class="rl-hover-more"
                            data-tip="更多（右键）"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openCtx(e, ev); }}>⋯<span class="rl-sr">更多操作</span></button>
                        <!-- 🔴🔴 #628 翻面 #626 ⑴：海报墙**也渲染**这枚「打开笔记 ↗」文字按钮（用户：
                             「海报墙和卡片网格视图的打开笔记按钮改成鼠标悬停显示的」）——
                             原先那层 `!wallView` 门控**撤掉** ⇒ 两种视图共用同一枚按钮，且都**只在
                             hover 封面时才出现**（`.rl-cov-hover` 的 `opacity: 0 → 1`；卡片网格本来就是
                             这套、海报墙照搬即可，⛔ 不需要给墙上另写一份浮现机制）。
                             🔴 外观同时改成**纯文字**（去胶囊框 + 无 hover 变色）——用户口径：
                             「UI 就像去除了胶囊按钮的框就只有文字那样，悬停不变色只出现」。
                             ⚠️ `⋯`（更多，右上角）与 `▶`（播放，右下角）两枚**图标保持原样**
                                （用户裁定「遮罩保留、图标不变」）。 -->
                        <button
                            class="rl-hover-open"
                            data-tip="新标签打开：{e.title}"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onOpenEntry(e.id); }}>打开笔记 ↗</button>
                    </div>
                    <!-- 主操作按钮：影视（有观看入口）、书籍（有文件）、游戏（有快捷方式）、音乐（有音频）→ 封面右下角圆形，hover 浮现 -->
                    {#if hasActionEntry(e)}
                        <button
                            class="rl-watch-btn"
                            class:rl-watch-play={actionIcon(e.type) === 'play'}
                            data-tip={actionAriaLabel(e.type)}
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon={actionIcon(e.type)} size={14} /><span class="rl-sr">{actionAriaLabel(e.type)}</span></button>
                    {/if}
                </div>
                <div class="rl-card-meta">
                    <div class="rl-ttl">{e.title}</div>
                    <!-- 海报墙防错位：这几行**要么全渲染、要么全不渲染**（同一份配置作用于所有卡片）
                         ⇒ 同列卡片元信息行数恒定（卡片 #1 vs #2 vs #3 高度齐平）。
                         缺失字段显示「—」占位（见 pure/cardMeta.cardFieldValue），行本身不会因某条缺值而消失。
                         🔴 1.3.1 ①（#615）显示哪几行由设置决定（最多 5 条），遍历顺序 = 渲染顺序。
                         🔴 #617 起**按条目类型**取（`cardFieldsByType[e.type]`）——
                            每张卡片照自己那条的类型取，⛔ 不是全墙共用一份。
                         ⚠️ 取值全走 `cardFieldValue`，这里只按 key 分**三种 class**：
                            · 只有 creator / genres 有各自的字号样式（`.rl-creator` 10px / `.rl-tags`），
                              其余一律走通用的副行 `.rl-sub`（11px）。
                            · 🔴 必须写成**静态**的 `{#if}` 分支 —— 用 `class={expr}` 动态绑定的话，
                              Svelte 编译器分析不出用到了哪些选择器，会把那两条样式当「未使用」而
                              **顶破 89 条告警基线**（本项目实测过的坑）。 -->
                    <!-- 🔴 #624：海报墙下**整段不渲染**（只留封面 + 标题）。
                         ⚠️ 与卡片网格一样「要么全渲染、要么全不渲染」—— 同一张墙上的卡片行数恒定，底部才齐平。 -->
                    {#if !wallView}
                        {#each cardRowsFor(e.type, e.bookKind) as row (row.key)}
                            {#if row.f === null}
                                <!-- 🔴 #640 ⑷：**补位空行** —— 只为把信息区撑到与同行最高卡片一致，
                                     ⛔ 不填「—」（那会伪装成一个真实存在的空字段）。 -->
                                <div class="rl-sub rl-pad-row"></div>
                            {:else if row.f === 'creator'}
                                <div class="rl-creator">{cardFieldValue(e, row.f)}</div>
                            {:else if row.f === 'genres'}
                                <div class="rl-tags">{cardFieldValue(e, row.f)}</div>
                            {:else}
                                <div class="rl-sub">{cardFieldValue(e, row.f)}</div>
                            {/if}
                        {/each}
                    {/if}
                    <!-- 🔴 #471：游戏「已玩 Nh」**不在元信息区**（已搬到封面左下角 `.rl-cov-playtime`）。
                         这里原本是「游戏进度行 + 未填时『-』空值占位」两块，随搬迁**整体退场**：
                         · 卡片上的书籍进度走下面 `readPercent` 的 `.rl-readrow`（百分比 + 条 + N/M 页），
                           与被删掉的 `cardProgressText` 书籍分支**从来是两套**（那个分支在卡片上无消费者）；
                         · 其余类型本就没有进度行 ⇒ 卡片行数不受影响（同排底部齐平靠 `.rl-row2` 的 `margin-top:auto`）。 -->
                    <!-- 🔴 #624：状态徽标 + 个人评分**也不在海报墙上出现**（用户：「不带年份 / 评分 / 信息栏」）。 -->
                    {#if !wallView}
                        <div class="rl-row1">
                            <span class="rl-badge rl-badge-{e.status}" on:click={(ev) => { ev.stopPropagation(); toggleMenu(e.id); }}>
                                {statusIcon(e.status)} {statusLabel(e.type, e.status)}
                            </span>
                            {#if e.rating > 0}
                                <!-- 🔴 #619 半星：星**不用字符**渲染（U+2BE8 字体覆盖不稳，实测成残缺星形），
                                     改为恒排 5 个满星 + `--fill` 交给 CSS 按比例裁切填充（见 `.rl-my-inline`）。
                                     ⚠️ 图形是 `aria-hidden` 的装饰 ⇒ 真值走旁边的 `.rl-sr` 给读屏。 -->
                                <span class="rl-my-inline" style={`--fill:${e.rating}`} aria-hidden="true">★★★★★</span>
                                <span class="rl-sr">个人评分 {e.rating} 星</span>
                            {/if}
                            <!-- 大众评分已搬到封面右上角常显（用户 2026-09-22 裁定：从这一行移走）——
                                 见 `.rl-cov-score`；这一行现在只剩「状态徽标 + 我的星」，窄卡挤压问题随之消失。
                                 DOM 顺序即「徽标 → 我的星」，两者**紧挨**（用户 2026-09-22「把个人评分放到
                                 观看状态右旁边」）；间距由 `.rl-row1` 的 `gap: 6px` 给出，⛔ 不靠 `margin-left:auto`。 -->
                        </div>
                    {/if}
                    <!-- 🔴 **保留这个空行**（2026-09-21 用户「海报墙书籍条目不要显示摘抄数量」后，
                         里面那条「摘抄 N」徽标已撤）—— 它带 `.rl-row2 { margin-top: auto }`，
                         是卡片元信息区的**底部定位行**，连同自身那 3px 上内距一起决定同排卡片底部是否齐平。
                         ⛔ 别顺手把这一行也删掉（会一起掉 `margin-top: auto` 与 3px ⇒ 同排卡片底部错开）。
                         ⚠️ 摘抄**入口**仍在卡片右键菜单「添加摘抄」（那是动作，不是计数显示）。 -->
                    <div class="rl-row2"></div>
                    <!-- 🔴 #558：阅读进度已搬到**封面底部悬浮区**（`.rl-cov-foot`，见 `.rl-cov-wrap` 里那段）——
                         元信息区这一行整体退场，⛔ 别在这里加回来（同屏两条 = 同一件事说两遍）。 -->
                </div>
                {#if menuOpenFor === e.id}
                    <div class="rl-menu" on:click={(ev) => ev.stopPropagation()}>
                        {#each MEDIA_STATUSES as s}
                            <button
                                class:rl-sel={s === e.status}
                                class:rl-illegal={!canTransition(e.status, s)}
                                disabled={!canTransition(e.status, s)}
                                on:click={() => applyStatus(e, s)}>
                                {statusLabel(e.type, s)}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {:else}
            {@const g = it.group}
            {@const cover = g.items[0]}
            {@const gStatus = seriesStatus(g.items)}
            <!-- 🔴 #502①（用户：「封面折叠系列卡**再多折，有多少折多少**」）：去掉 #501③ 的 `slice(0, 3)` 上限 ——
                 组里有几部就叠几层（只滤掉没封面图的）。
                 ⚠️ 层数一放开，**错位步长就不能再写死 8px**：10 部 × 8px = 累计让出 72px，主封面只剩 122px（被压扁）。
                 步长改由 CSS 自适应（`min(8px, 24px / (层数 − 1))`）⇒ 4 层以内每层 8px，再多的层**总让出恒定 24px**、
                 每层依次变窄（读起来像一摞书页，而不是把封面越挤越小）。
                 · 有几张就叠几张（1 张 ⇒ 铺满，与原来一致；≥2 张 ⇒ 向右下阶梯错位，见 CSS 的 `--si`/`--sn`）；
                 · ⛔ 别把「有封面」的过滤去掉 —— 缺图的条目塞进来会渲染成断图（`src` 空 ⇒ 破图标）；
                 · ⛔ 也别在这里写死张数以外的逻辑（错位量全在 CSS，模板只负责**顺序与张数**）。 -->
            {@const stackCovers = g.items.filter((it) => !!posterUrl(it))}
            <!-- 🔴 #510：**真正渲染的层数**封顶（`STACK_MAX`）。`--sn` 传的是**渲染层数**而不是真实部数 ——
                 步长 `min(9px, 28px / (sn − 1))` 是按**看得见的层**算的，传真实部数会让 4 层挤成 1.6px 一摞。
                 真实部数照旧由右上角 `×N` 角标表达。 -->
            {@const stackExtra = stackCovers.slice(1, STACK_MAX)}
            <!-- ⚠️ `stackTick` 在这里**只是为了造出响应式依赖** —— Svelte 看不见 `Set` 的内部变化
                 （`stackReady.add` 不触发重渲染），所以必须让模板表达式真的读一下那个计数器。
                 ⛔ 别把它删掉换成 `stackReady.has(...)` 单独一个调用（那样 IO 回调后不会重画）。 -->
            {@const stackShown = stackTick >= 0 && (stackExtra.length === 0 || stackReady.has(g.key))}
            {@const stackSn = 1 + (stackShown ? stackExtra.length : 0)}
            <!-- 🔴 #504：叠图层的**画序**（= 数组顺序，见模板里那个 `{#each}`）：把顺序**倒过来**，
                 让主封面（原序号 0）**最后画** ⇒ 它自然压在其余各层之上 —— 这样叠图层就**不需要 `z-index`**
                 （详见模板里那段说明）。`si` 保留**原序号**（= 层位，0 占左上），位置算法一字未动。 -->
            <!-- ⛔ 旧的「全部层」数组已删（#510）：现在只有 `stackCovers` / `stackExtra` / `stackShown` 三样。 -->
            <!-- 系列折叠卡（#434，点击语义 #437 改）：**结构与普通卡完全同构**（`.rl-card` + `.rl-cov-wrap` + `.rl-card-meta`），
                 只多一枚 `×N` 角标 ⇒ 同列宽同高，天然不会撑破网格（仿真页 sr434 量测 Δw=Δh=0）。
                 🔴 封面取**组内首条**（`items[0]`，已按序号排好）；标题 = `g.title`（`系列名 类型系列`）。
                 ⚠️ 点整张卡 = **进这一系列的视图**（不是打开笔记：折叠卡对应 N 条、没有唯一的「那一条」可打开）。
                 🔴 #437 之前这里是「在整面墙里就地摊开」——成员卡后面紧跟着别的条目又没有收尾边界，
                    用户看到的是「其他条目怎么也在这个系列里面」⇒ 改成进**独立视图**，见 `openSeries`。 -->
            <!-- 🔴 #501③（用户上手后对 #500⑤ 的二次裁定）：「**折叠卡边框样式改回原来的**，折叠卡封面改成
                 里面几张封面的**叠图**」⇒ 两处回退 / 替换：
                 ① 卡片那圈**类型色 `outline` 描边整条删除**（边框回到 `.rl-card` 原来的 1px 常规边框）；
                 ② 封面右侧那两条**纯色**窄边删除 ⇒ 改成组内**真实封面**的多层叠图（`stackCovers`，见上）。
                 ⚠️ 那个给 `×N` 角标描边用的**类型色注入变量**已随 #557（角标统一）整体退场 ——
                    ⛔ 别因为「卡片描边删了」就顺手把它加回来（角标现在与普通卡逐字同款）。 -->
            <!-- 🔴 #512：`>` **必须**写在 `use:stackGate={g.key}` 那一行之后（⛔ 别提前到上一行末尾）。
                 这个错**编译零告警**：Svelte 4.2.2 会把 `use:stackGate={g.key}` 当**普通文本**渲染进卡片里
                 （用户实机截图：标题上方浮出一行 `use:stackGate=`），同时 **action 一次都没跑**
                 ⇒ `stackReady` 永远是空集 ⇒ `stackShown` 恒假 ⇒ **叠层永不挂载**（只剩永远渲染的主封面）。
                 🔴 也就是说它同时造成「文本泄漏」+「叠层消失」两个症状，**同一个根因**。
                 ⛔ 为什么 tsc / 单测 / 产物断言 / 仿真页**全都抓不到**：
                   - tsc 不看模板；单测不编译组件；
                   - 断言只查 `use:stackGate` 这段**文本在不在**（在！只是被当文本用了）；
                   - 仿真页是**手搓 DOM**、⛔ 不经过 Svelte 编译 ⇒ 它证明的只是 CSS 对不对。
                 ⇒ 唯一可靠防线 = **组件级探针**（真 Svelte 编译 + jsdom 挂载），见 `_probe_series512.cjs`。 -->
            <div
                class="rl-card rl-series-card"
                role="button"
                tabindex="0"
                data-tip={`只看「${g.title}」（${g.items.length} 部）`}
                on:click={() => openSeries(g.key)}
                on:keydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openSeries(g.key); } }}
                on:contextmenu={(ev) => openGroupCtx(g, ev)}
                use:stackGate={g.key}>
                {#if colorTheme === 'colorful'}
                    <div class="rl-type-bar" style={`background:${TYPE_COLORS[g.type]}`}></div>
                {/if}
                <div class="rl-cov-wrap">
                    {#if stackCovers.length > 0}
                        <!-- 🔴 #501③ / #502① 叠图层（`.rl-cov-stack`）：`--si` = **层位**（0 = 主封面，占左上）、
                             `--sn` = 总张数，错位量由 CSS 的 `calc()` 算（层数多时**自适应收窄**，见 `--rl-stk-step`）。
                             🔴🔴 #504 修正：**DOM 顺序 = 叠放顺序，主封面必须排在最后**（#510 起：其余层先画、主封面最后画，
                             `--si` 仍取原序号 ⇒ 位置不变、只是画的先后变了）。
                             为什么不用 `z-index: calc(--sn − --si)` 那套：它**随层数无上界地涨**，
                             18 部时最高层是 18，把封面右上角的「×N」角标（z-index 5）与右下角播放钮（7）
                             **一起盖住**（用户报「18部 标识被遮住了」）。
                             现在叠图层不带 `z-index`（= auto，只有 DOM 先后），角标/播放钮照旧在上面 ——
                             且**层数再多也不会再翻车**（不存在「比它还大的数」）。
                             ⚠️ 保留 `--si` = 原序号：它同时决定位置（`top`/`left` 错位）与哪张当主封面，
                                ⛔ 别把 `--si` 也一起倒过来（那会换掉当门面那张海报）。 -->
                        <!-- 🔴 #510：**只有主封面是必渲染的**（它是卡的门面）；其余层：
                             ⑴ 层数封顶（`stackExtra` 最多 `STACK_MAX − 1` 张）；
                             ⑵ 只有这张卡**接近视口**（`stackShown`）才挂 —— 首屏之外一个节点都不建。
                             ⚠️ 贴回顺序：外层的**其余层**先画（DOM 在前 ⇒ 在下面），主封面**最后画**（压在顶上）。
                             ⚠️ `--sn` 用 `stackSn`（= **当前真正渲染的层数**）：IO 还没触发时它是 1 ⇒ 主封面铺满，
                                触发后变成 n ⇒ 主封面缩到 `100% − (n−1) × 9px`、其余层**依次推开**（入场动画见 CSS）。 -->
                        {#if stackShown}
                            {#each stackExtra.map((it, i) => ({ it, si: i + 1 })).reverse() as L (L.it.id)}
                                <img
                                    class="rl-cov-stack rl-cov-stack-extra"
                                    style={`--si:${L.si};--sn:${stackSn}`}
                                    src={posterUrl(L.it)}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    referrerpolicy={isDoubanImage(posterUrl(L.it)) ? 'unsafe-url' : undefined} />
                            {/each}
                        {/if}
                        <!-- 主封面（组内首条，占左上；#504 起它排最后画 ⇒ 天然压在其余层之上，不需要 z-index） -->
                        <img
                            class="rl-cov-stack rl-cov-stack-main"
                            style={`--si:0;--sn:${stackSn}`}
                            src={posterUrl(stackCovers[0])}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            referrerpolicy={isDoubanImage(posterUrl(stackCovers[0])) ? 'unsafe-url' : undefined} />
                    {:else}
                        <div class="rl-cov rl-cov-ph" style={`--h:${hash(cover.id) % 360}${colorTheme === 'colorful' ? `;--tc:${TYPE_COLORS[g.type]}` : ''}`}><span>{cover.title.slice(0, 2)}</span></div>
                    {/if}
                    <span class="rl-series-cnt">×{g.items.length}</span>
                    <!-- 🔴 #629：折叠卡的**悬停浮层**（用户：「优化系列卡片上的悬停样式（加遮罩，右上角更多菜单按钮，
                         「打开合集」文字样式，如【x15】在鼠标hover时隐藏）」）——
                         与普通卡那一层**逐字同款**（同一个 `.rl-cov-hover` / `.rl-hover-more` / `.rl-hover-open`）：
                           · **遮罩**：`.rl-cov-hover` 自己的 `rgba(0,0,0,.38)` + `opacity 0→1`（悬停才出现）；
                           · **右上 `⋯`**：开的是**这张卡自己的菜单**（`openGroupCtx` ⇒ 排序号 / 批量关联）——
                             ⛔ 别复用条目那个 `openCtx`（那张卡没有「那一条」可操作，`ctxGroupKey` / `ctxFor` 互斥）；
                           · **居中「打开合集」**：纯文字（无底无框、悬停不变色 —— #628 刚定的口径），
                             动作 = `openSeries(g.key)`（= 点卡片本体那个动作，两处同一出口）。
                         ⚠️ 两枚按钮都 `stopPropagation`：卡片本体挂着「进系列视图」，别让浮层顺带触发它两次。
                         ⚠️ 与普通卡一样**不做 `!wallView` 门控** —— 海报墙上的两枚图标（⋯ / ▶）本来就在，
                            浮层并入之后墙上也是同一套（#626 裁定保留 ⋯，本批只是给它补了「打开合集」这枚文字）。 -->
                    <div class="rl-cov-hover">
                        <button
                            class="rl-hover-more"
                            data-tip="更多（右键）"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openGroupCtx(g, ev); }}>⋯<span class="rl-sr">更多操作</span></button>
                        <button
                            class="rl-hover-open"
                            data-tip={`打开合集：${g.title}`}
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openSeries(g.key); }}>打开合集 ↗</button>
                    </div>
                    <!-- 系列操作按钮（#438）：右下角、与普通卡那枚 `▶` **同位置同动效同语义**
                         （hover/聚焦浮现、32px 圆形、`actionIcon` 定图标 ⇒ 动画=播放、书籍=阅读）。
                         🔴 点它**不进系列视图**（`stopPropagation`），而是弹出「季列表」——
                         每一部/每一季一行，各带一枚同样语义的动作按钮，可切着播。
                         ⚠️ 组的每一部都**没有可用入口**时不渲染（与普通卡的规则一致：没得播就别给按钮）。 -->
                    {#if g.items.some((it) => hasActionEntry(it))}
                        <button
                            class="rl-watch-btn rl-series-play"
                            class:rl-watch-play={actionIcon(g.type) === 'play'}
                            data-tip={`${actionAriaLabel(g.type)}（可切换 ${g.items.length} 部/季）`}
                            on:click={(ev) => openSeriesFromCard(g, ev)}><Icon icon={actionIcon(g.type)} size={14} /><span class="rl-sr">{actionAriaLabel(g.type)}</span></button>
                    {/if}
                    <!-- 🔴 #558：折叠卡的组级阅读进度也搬进**封面底部悬浮区**（与普通卡同一截 markup / 同一块遮罩），
                         ⛔ 别只搬普通卡那一处（#472 报的就是「折叠卡与普通卡不一致」）。
                         🔴 #625：再加一道「海报墙收窄」—— 普通卡在那个视图里连封面遮罩都不渲染，
                            折叠卡**同样**得收（不然又是「只改了一半」）。 -->
                    {#if !wallView && g.type === 'book' && seriesReadPercent(g.items) !== undefined}
                        <div class="rl-cov-foot">
                            <div class="rl-readrow">
                                <span class="rl-read-pct">{seriesReadPercent(g.items)}%</span>
                                <div class="rl-readbar"><div class="rl-readbar-fill" style={`width:${seriesReadPercent(g.items)}%`}></div></div>
                                <span class="rl-read-pages">{seriesReadDone(g.items)}/{g.items.length} 部</span>
                            </div>
                        </div>
                    {/if}
                </div>
                <div class="rl-card-meta">
                    <div class="rl-ttl">{g.title}</div>
                    <!-- 🔴🔴 #625（用户 2026-10-13 报障「系列卡不一致，视图里也空了一大块」）：
                         折叠卡的信息行**与普通卡同源同数** —— 同一份「按类型信息栏」配置、同一批行序与 class。
                         ⛔ 旧的「年份段 / 部数 / 题材」三行**写死**已整体退场，三个病灶都在它身上：
                           ⑴ 不跟设置走（普通卡 0~5 行、它恒 3 行）⇒ 同一面墙上两种卡**信息不一致**；
                           ⑵ 行数不一致 ⇒ **卡片高度不一致** ⇒ 矮的那些被网格拉高、正文下面空出一大块；
                           ⑶ 漏了海报墙的收窄门控 —— 那个视图里普通卡的信息行整段不渲染，它却照旧显示
                              （#624 只改了普通卡那一处）。**这次截图的现场就是 ⑶**。
                         取值走 `pure/cardMeta` 那颗折叠卡取值函数（与单条卡逐档对应：
                         年份 → 组内跨度、题材 → 组内并集，其余取组内首条，缺值一律 `—` 占位）。
                         ⚠️ 「部数」不再占信息栏位置 —— 它由封面右上角的 `×` 角标表达（同一件事不说两遍）。 -->
                    {#if !wallView}
                        {#each cardRowsFor(g.type) as row (row.key)}
                            {#if row.f === null}
                                <!-- 🔴 #640 ⑷：与普通卡同款补位（折叠卡也要跟同一排对齐） -->
                                <div class="rl-sub rl-pad-row"></div>
                            {:else if row.f === 'creator'}
                                <div class="rl-creator">{seriesCardFieldValue(g, row.f)}</div>
                            {:else if row.f === 'genres'}
                                <div class="rl-tags">{seriesCardFieldValue(g, row.f)}</div>
                            {:else}
                                <div class="rl-sub">{seriesCardFieldValue(g, row.f)}</div>
                            {/if}
                        {/each}
                    {/if}
                    <!-- 状态徽标（#438 次日补）：与普通卡**同款 markup / 同款配色 / 同一行位**。
                         🔴 显示的是**组的状态**（`seriesStatus` 纯函数 = 面板里标「继续」那一格的状态：
                         在看 > 想看 > 第一条；已看/存档不参与，滤空后退回首条）—— 组里几条状态不同也是它说了算。
                         ⚠️ 这里**刻意不可点**（普通卡上那枚点开会改状态）：一个组有 N 条，
                            「点一下改成什么」没有唯一答案 ⇒ 用 `.rl-series-card .rl-badge{cursor:default}` 明示只读，
                            ⛔ 别顺手挂 `toggleMenu`（那是单条语义）。 -->
                    {#if !wallView}
                        <div class="rl-row1">
                            {#if gStatus}
                                <span class="rl-badge rl-badge-{gStatus}" data-tip={`系列状态：${statusLabel(g.type, gStatus)}`}>
                                    {statusIcon(gStatus)} {statusLabel(g.type, gStatus)}
                                </span>
                            {/if}
                        </div>
                    {/if}
                    <div class="rl-row2"></div>
                </div>
            </div>
        {/if}
        {/each}
    </div>
    {#if emptyState}
    <div class="rl-empty" role="status">
        <div class="rl-empty-title">{emptyState.title}</div>
        {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
        {#if emptyState.action === 'clear'}
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除筛选与搜索">清除筛选</button>
        {/if}
    </div>
{/if}
{:else if viewMode === 'masonry'}
    <!-- 瀑布流：默认纯封面，hover 浮出标题/评分/年份；点击打开条目、右键菜单，顺序保持排序结果 -->
    <div class="rl-masonry" use:zoomWheel={'masonry'}>
        {#each masonryBuckets as col}
            <div class="rl-m-col">
                {#each col as e}
                    <div class="rl-m-card" role="link" tabindex="0" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }} on:contextmenu={(ev) => openCtx(e, ev)}>
                        {#if posterUrl(e)}
                            <!-- 🔴🔴 #624 瀑布流 = **等宽不等高**（用户：「改成等宽不等高」）：
                                 加载完成（`on:load`）后打上 `is-loaded` ⇒ 该张从「2:3 占位」交回**图片固有比例**
                                 （横版更矮、竖版更高 —— 参差正是瀑布流的样子）。
                                 加载**前**必须留着 2:3：没有它，未解码的图高度会算成 0，卡片整块塌成一条
                                 （#623 实测：空 src 高 0、16:9 只 123.2，而正常 2:3 是 328.5）。
                                 ⚠️ 判据是 **id 集合**（`loadedCovers`）而不是往元素上挂类：这个 `{#each}` 没有 key、
                                 DOM 会被复用，类会串到别的条目上。 -->
                            <img class="rl-m-cov" class:is-loaded={loadedCovers.has(e.id)} src={posterUrl(e)} alt={e.title} loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} on:load={() => markCoverLoaded(e.id)} />
                        {:else}
                            <div class="rl-m-cov rl-m-ph" style={`--tc:${TYPE_COLORS[e.type]}`}><span>{e.title.slice(0, 2)}</span></div>
                        {/if}
                        <div class="rl-m-overlay">
                            <span class="rl-m-title">{e.title}</span>
                            <span class="rl-m-meta">
                                {#if e.year}<span class="rl-m-yr">{e.year}</span>{/if}
                                {#if e.year && scoreText(e)}<span class="rl-m-dot">·</span>{/if}
                                {#if scoreText(e)}<span class="rl-m-sc">★ {scoreText(e)}</span>{/if}
                            </span>
                        </div>
                    </div>
                {/each}
            </div>
        {/each}
    </div>
    {#if emptyState}
    <div class="rl-empty" role="status">
        <div class="rl-empty-title">{emptyState.title}</div>
        {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
        {#if emptyState.action === 'clear'}
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除筛选与搜索">清除筛选</button>
        {/if}
    </div>
{/if}
{:else if viewMode === 'timeline'}
    <!-- 🔴 #598 **时间线**（新增视图）：按年份分桶（新的在前、「年份未知」垫底），
         每桶 = 左侧一条年份轴（年份 + 部数）+ 该年的条目横排。
         用户：「还有什么视图可新增展示」→ `AskUserQuestion` 选定「时间线」。
         ⚠️ 分桶是**纯逻辑**（`pure/viewModes.buildTimeline`，配单测），桶内**保持传入顺序** ——
            入口 `filterAndSort` 已按当前排序档排好，这里只做「分桶搬运」，⛔ 不重排一遍。 -->
    <!-- 🔴 #668 用户：「时间线视图展示的也要支持 **Ctrl+Z 缩放大小**」（即 Ctrl+滚轮缩放）。
         走与海报墙/瀑布流**同一枚** `zoomWheel` action（三条纪律都在那边注释里：只在开关开时接管 /
         只有 ctrlKey 才算缩放 / 监听必须挂元素且 passive:false），只是 `kind='timeline'` 走**宽度档**。
         ⚠️ 条目宽度由 `--rl-tl-w` 驱动（`tlItemW`），⛔ 样式里不再写死 76px。 -->
    <div
        class="rl-timeline"
        use:zoomWheel={'timeline'}
        style={`--rl-tl-w:${tlItemW}px`}
        data-tip={ctrlWheelZoom ? 'Ctrl+滚轮缩放条目大小' : ''}>
        {#each timelineBuckets as b (b.label)}
            <div class="rl-tl-group">
                <div class="rl-tl-axis">
                    <span class="rl-tl-year">{b.label}</span>
                    <span class="rl-tl-cnt">{b.items.length}</span>
                </div>
                <div class="rl-tl-items">
                    {#each b.items as e (e.id)}
                        <div
                            class="rl-tl-item"
                            class:rl-sel-card={selectedIds.has(e.id)}
                            role="link"
                            tabindex="0"
                            title={e.title}
                            on:click={() => onOpenEntry(e.id)}
                            on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}
                            on:contextmenu={(ev) => openCtx(e, ev)}>
                            {#if posterUrl(e)}
                                <img class="rl-tl-cov" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                            {:else}
                                <div class="rl-tl-cov rl-tl-ph" style={`--tc:${TYPE_COLORS[e.type]}`}><span>{e.title.slice(0, 2)}</span></div>
                            {/if}
                            <span class="rl-tl-title">{e.title}</span>
                            <span class="rl-tl-meta">
                                <span class="rl-badge rl-badge-{e.status}">{statusLabel(e.type, e.status)}</span>
                                {#if scoreText(e)}<span class="rl-tl-sc">★ {scoreText(e)}</span>{/if}
                            </span>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
    {#if emptyState}
    <div class="rl-empty" role="status">
        <div class="rl-empty-title">{emptyState.title}</div>
        {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
        {#if emptyState.action === 'clear'}
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除筛选与搜索">清除筛选</button>
        {/if}
    </div>
{/if}
{:else}
    <!-- ── 1.3.1 ②（#621）**可编辑表格** ────────────────────────────────────────
         列 = `colViews`（数据驱动）；首列「笔记名」与末列「操作」是**固定列**，不参与列配置。
         🔴 行级 `on:click` **已撤掉** —— 点格子要改这一格，与「点整行开条目」直接冲突；
            开条目的入口 = 标题链接 + 操作列那枚铅笔（⛔ 别把行点击加回来）。
         ⚠️ `<th>` 上 `draggable` 只在**单类型表**开（混类型没有「哪一套列序」可改）。 -->
    <!-- 🔴 这个容器**不挂** `on:keydown`（Ctrl+Z 走窗口监听，见 `onWindowKeydown` 的说明）——
         给它挂键盘监听在 a11y 检查里怎么摆都不对，而它本来就只是个滚动容器。 -->
    <!-- 🔴 #684：`bind:clientWidth` 把容器真实宽度喂给 `tableAvailPx` —— 列宽预算必须按**实际可用宽**算，
         否则窄窗口下标题列会被次要列挤没（用户实测 136px）。 -->
    <div class="rl-tbl-wrap" bind:clientWidth={wrapW}>
    <!-- 🔴🔴 v2（用户 2026-10-20）：表格**只写 min-width**，不再有「拖过标题列就改成精确 width」的分支。
         那条分支是标题列拖不动的另一半原因：`width` 钉死后 `buildColViews` 的预算却按「整表宽」算，
         标题列多占的 px 只能从次要列身上抢回来 ⇒ 拖动被全部抵消。现在宽度由 `min-width` 兜底、
         各列 `<col>` 各自给 px，`table-layout: fixed` 下一切可预测。 -->
    <table class="rl-table rl-tbl" bind:this={tableEl} style={`min-width:${tableMinWidth}px`}>
        <!-- 🔴 #590 口径不变：`table-layout: fixed` + `colgroup` 钉列宽（书名再长也只在自己那格里省略）。
             #621 起列宽由 `colViews` 逐列给出（权重换算，见 script），cb / ops 两列仍走固定百分比。 -->
        <colgroup>
            <!-- 🔴🔴 #683：勾选列**只在这里出现一次**，且与表头 / 数据行的 `{#if batchMode}` **严格配对**。
                 上一版这里多了一条裸 `<col class="rl-col-w-cb" />`（原来就有的那一条没删），而表头只有
                 一条条件 `th` ⇒ 三处列数对不上，`table-layout: fixed` 把每一列都错开一格：
                 用户看到的就是「表头整体右移、标题文字与表头差 72px、行首空出一条」。
                 ⚠️ 改这里时必须同时数三处：colgroup 的 `col` / thead 的 `th` / tbody 的 `td`。 -->
            {#if batchMode}
                <col class="rl-col-w-cb" />
            {/if}
            <!-- 🔴🔴 v2：标题列的 `<col>` **恒给显式 px**（`colViews.titlePx`），不再有「拖过 / 没拖过」两条分支。
                 改前是裸 `<col />` + `table-layout: fixed` 吃剩余 ⇒ 标题列宽实际由「表格宽 − 其余列」**反推**，
                 拖它只是在跟这个反推式打架。现在它和其它列**同一套规则**：px 从 `buildColViews` 一处出。
                 依据（用户报障原话）：「光标变成 ↔ 了，但无法向左或右拖动，其他列竖指示器正常」。 -->
            <col style={`width:${colViews.titlePx}px`} />
            {#each colViews.cols as cv (cv.def.key)}<col style={`width:${cv.px}px`} />{/each}
            <col class="rl-col-w-ops" />
        </colgroup>
        <thead>
        <tr>
            {#if batchMode}
                <th scope="col" class="rl-col-cb"><input type="checkbox" bind:this={headCb} checked={allChecked} on:click={toggleSelectAll} aria-label="全选当前筛选结果" /></th>
            {/if}
            <!-- 标题列：可拖宽，但**不参与列序拖拽**（它是固定首列，列序里没有它）。
                 🔴 用户 2026-10-20：「删除双击列自适应列宽的逻辑」⇒ 双击已不再自适应。 -->
            <th scope="col" class="rl-col-title rl-tbl-th" data-col={TITLE_KEY}>
                <span class="rl-tbl-head rl-tbl-mv">标题</span>
            </th>
            {#each colViews.cols as cv, c (cv.def.key)}
                <th
                    scope="col"
                    class="rl-tbl-th"
                    data-col={cv.def.key}
                    class:is-dragging={dragColKey === cv.def.key}
                    class:is-over={dragColKey !== null && overColKey === cv.def.key && dragColKey !== cv.def.key}
                    draggable={canEditColumns}
                    on:dragstart={(ev) => onColDragStart(ev, cv.def.key)}
                    on:dragover={(ev) => onColDragOver(ev, cv.def.key)}
                    on:dragend={onColDragEnd}
                    on:drop={(ev) => onColDrop(ev, cv.def.key)}>
                    <span class="rl-tbl-thbox">
                        <span class="rl-tbl-head rl-tbl-mv">{cv.def.label}</span>
                        <!-- 🔴 #668 用户：「表头拖动时**去掉六点图标，不要显示了**」。
                             六点握把**整体删除**（连同它的 `.rl-tbl-grip` 样式与悬停淡入规则）。
                             拖拽能力本身没变：`<th>` 仍带 `draggable` + dragstart/dragover/drop ⇒ 拖表头照样换列序，
                             只是不再有任何图标提示。`cursor: grab` 由 `.rl-tbl-th` 自己给（见样式表）。
                             ⛔ 别把 grip 图标加回来 —— 用户点了两次名。 -->
                    </span>
                </th>
            {/each}
            <th scope="col" class="rl-col-ops rl-tbl-opshead">
                <!-- 🔴🔴 #630 翻面 #622 ④：列配置入口**搬回工具栏那一行**（用户：「列表视图表头的列按钮给我返原回来」）
                     ⇒ 这一格只剩「操作」二字。
                     ⚠️ 按钮在 `.rl-toolbar` 里（`.rl-tbl-colmenu`，**只在列表视图**渲染）；面板锚点
                        （`.rl-tbl-col-anchor`）仍留在表格之后 —— 它是 0 高度的相对定位盒，`openColMenu`
                        按**按钮的实时 rect** 定位，与按钮搬去哪儿无关。 -->
                <span class="rl-tbl-opslabel">操作</span>
            </th>
        </tr>
        </thead>
        <tbody>
            {#if emptyState}
                <tr class="rl-empty-row">
                    <!-- 🔴 #680：勾选列现在**按 `batchMode` 条件渲染** ⇒ colspan 也要跟着算，
                         否则批次模式下空态行会短一列（右边留一条空白）。 -->
                    <td colspan={2 + colViews.cols.length + (batchMode ? 1 : 0)}>
                        <div class="rl-empty" role="status">
                            <div class="rl-empty-title">{emptyState.title}</div>
                            {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
                            {#if emptyState.action === 'clear'}
                                <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除筛选与搜索">清除筛选</button>
                            {/if}
                        </div>
                    </td>
                </tr>
            {/if}
        <!-- 🔴 #592：列表视图按**显示行**渲染 —— 合集父级行，其后（展开时）是它的成员子行；
             单集行与子行**共用同一段行 markup**（子行只多一枚语义类名，🔴 #594 起**不缩进**、与单集逐列对齐）。
             ⚠️ `ri`（行号）是**键盘导航的坐标系**：`data-r` / `data-c` 与它同源，⛔ 别改用行的下标去算。 -->
        {#each listViewRows as row, ri (row.kind === 'group' ? 'G' + row.group.key : 'E' + row.entry.id)}
            {#if row.kind === 'group'}
                {@const g = row.group}
                {@const gOpen = isGroupOpen(g.key)}
                {@const gStatus = seriesStatus(g.items) ?? g.items[0].status}
                {@const gPct = g.type === 'book' ? seriesReadPercent(g.items) : undefined}
                <tr class="rl-grp-row" class:is-open={gOpen}>
                    <!-- 🔴 #594：父级行的勾选框 = **整组联动**（用户：「合集条加个勾选框，一勾选子条目也被勾选」）——
                         状态三态：全选 = ✓ / 部分 = 半选（`indeterminate`）/ 全不选 = 空。
                         🔴 #686：整格随 `batchMode` 一起出现/消失 —— 与条目行的 `rl-col-cb` 同一口径，
                            ⛔ 别只藏里面的 input 而留着空格（那会让合集行也整体错开一列）。 -->
                    {#if batchMode}
                    <td class="rl-col-cb">
                        <input
                            type="checkbox"
                            checked={groupAllSelected(g)}
                            use:indeterminate={groupSomeSelected(g)}
                            on:click={(ev) => { ev.stopPropagation(); toggleGroupSelection(g); }}
                            aria-label={`选中整个合集（${g.items.length} 部）`} />
                    </td>
                    {/if}
                    <td class="rl-col-title" data-col={TITLE_KEY}>
                        <div class="rl-title-cell" title={g.title}>
                            {#if posterUrl(g.items[0])}<img class="rl-thumb" src={posterUrl(g.items[0])} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(g.items[0])) ? 'unsafe-url' : undefined} />{/if}<button
                                class="rl-grp-toggle"
                                aria-expanded={gOpen}
                                data-tip={gOpen ? '收起合集' : `展开合集（${g.items.length} 部）`}
                                on:click={(ev) => { ev.stopPropagation(); toggleGroup(g.key); }}>
                                <span class="rl-grp-name rl-tbl-mv">{g.title}</span>
                                <span class="rl-grp-cnt">共 {g.items.length} 部</span>
                            </button>
                        </div>
                    </td>
                    <!-- 父级行的数据格：**只给能真聚合的列**（年份段 / 题材 / 状态 / 书籍进度），其余 `—`。
                         ⛔ 别拿组里第一部的值冒充整组 —— 用户看到组行写着某一部的年份会以为那就是组的年份。 -->
                    {#each colViews.cols as cv (cv.def.key)}
                        <!-- 🔴 #668 用户：「竖指示器要下面格也显示」⇒ 合集父级行的数据格也挂同一个 `is-over`，
                             与表头格的竖线连成一条（⛔ 别只在条目行挂，否则合集行那儿会断一截）。 -->
                        <td
                            class="rl-tbl-td"
                            class:is-over={dragColKey !== null && overColKey === cv.def.key && dragColKey !== cv.def.key}
                            data-col={cv.def.key}>
                            {#if cv.def.key === 'status'}
                                <!-- 🔴 #668（用户：「列表视图的系列的状态字段值不能居中对齐」）：这里原来是**裸** `<span class="rl-badge">`，
                                     不带 `.rl-tbl-cell` ⇒ 既不吃居中也不吃省略号。包一层与条目行**同款**的
                                     `.rl-tbl-cell`（再加上 `.rl-tbl-series-cell` 让徽标真正落在格子中线）——
                                     ⛔ 别只给 `.rl-badge` 写 `margin: auto`：徽标是 `inline-flex`，行内元素上下外边距无效。 -->
                                <span class="rl-tbl-cell rl-tbl-series-cell">
                                    <span class="rl-badge rl-badge-{gStatus}">{statusLabel(g.type, gStatus)}</span>
                                </span>
                            {:else if cv.def.key === '__progress'}
                                {#if gPct !== undefined}
                                    <!-- 🔴 #680 ③-2：合集行同样收成微型胶囊（与条目行同一套视觉） -->
                                    <span class="rl-prog-chip" data-tip={`已读 ${gPct}% · ${seriesReadDone(g.items)}/${g.items.length} 部`}>
                                        <span class="rl-prog-chip-txt">{gPct}% · {seriesReadDone(g.items)}/{g.items.length} 部</span>
                                        <span class="rl-prog-chip-bar" aria-hidden="true"><span style={`width:${gPct}%`}></span></span>
                                    </span>
                                {:else}<span class="rl-tbl-none">—</span>{/if}
                            {:else}
                                {@const gt = groupCellText(g, cv.def.key)}
                                {#if gt}<span class="rl-tbl-cell rl-tbl-ro rl-tbl-mv">{gt}</span>{:else}<span class="rl-tbl-none">—</span>{/if}
                            {/if}
                        </td>
                    {/each}
                    <td class="rl-col-ops">
                        <!-- 父级行**不给**编辑 / 打开两枚图标（用户点名），只留「打开合集」= 进单系列视图 -->
                        <div class="rl-ops-row">
                            <button
                                class="rl-edit-row"
                                data-tip="打开合集"
                                on:click={(ev) => { ev.stopPropagation(); openSeriesFromList(g.key); }}><Icon icon="layers" size={14} /><span class="rl-sr">打开合集</span></button>
                        </div>
                    </td>
                </tr>
            {:else}
            {@const e = row.entry}
            {@const lp = listProgress(e)}
            <tr class:rl-row-child={row.child}>
                <!-- 🔴🔴 #686：表体这一格**必须与表头 / colgroup 严格配对** ——
                     上一版写的是恒渲染 `<td class="rl-col-cb">`，而 colgroup 的 `<col class="rl-col-w-cb">`
                     与表头的 `<th class="rl-col-cb">` 都在 `{#if batchMode}` 里 ⇒ 非批量模式下
                     **表体 6 格、表头 4 列**，`table-layout: fixed` 把每一格都错开一位：
                     用户看到的就是「标题栏空一条、年份跑到标题列底下、状态跑到年份底下、评分跑到状态底下」。
                     ⚠️ 这与 #683 修的是**同一个坑的另一半**（那次是 colgroup 多一条 col）——
                     改这里时三处一起数：colgroup 的 `col` / thead 的 `th` / tbody 的 `td`。 -->
                {#if batchMode}
                <td class="rl-col-cb">
                    <input
                        type="checkbox"
                        checked={selectedIds.has(e.id)}
                        on:click={(ev) => { ev.stopPropagation(); toggleSelect(e.id); }} />
                </td>
                {/if}
                <td class="rl-col-title" data-col={TITLE_KEY}>
                    <!-- 封面 + 书名同一行；书名 `flex: 1` 自适应 + 超出省略号，`title` 提供全名悬停提示 -->
                    <!-- 🔴 #621 追加件（用户报障）：「点标题跳笔记」必须**显式挂在这个 span 上** ——
                         #621 撤掉行级 `on:click` 时只把键盘那条路留着了 ⇒ 鼠标点标题没反应。 -->
                    <div class="rl-title-cell" title={e.title}>
                        {#if posterUrl(e)}<img class="rl-thumb" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />{/if}<span
                            class="rl-row-link rl-tbl-mv"
                            role="link"
                            tabindex="0"
                            on:click={() => onOpenEntry(e.id)}
                            on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}>{e.title}</span>
                    </div>
                </td>
                {#each colViews.cols as cv, c (cv.def.key)}
                    {@const d = cv.def}
                    {@const ed = cellEditable(e, d)}
                    {@const isEditing = editingCell !== null && editingCell.id === e.id && editingCell.key === d.key}
                    {@const shown = cellDisplayText(e, d)}
                    <td
                        class="rl-tbl-td"
                        class:is-over={dragColKey !== null && overColKey === d.key && dragColKey !== d.key}
                        data-col={d.key}>
                        {#if isEditing}
                            <!-- 🔴 编辑态**只有一种**：文本输入框（状态也走它，预填中文标签「在看」）。
                                 ⛔ 别在这里换原生 `<select>` —— 本仓 #566 起「原生下拉整体退场」
                                 （Windows 上它的弹出列表不受 CSS 控制），断言里有反向守卫钉着。
                                 ⚠️ 预填值走 `tableCellDraft`（状态预填**中文标签**、评分预填 `9/10`）。 -->
                            <input
                                class="rl-tbl-input"
                                bind:this={editInput}
                                bind:value={editDraft}
                                placeholder={cellEditPlaceholder(d)}
                                on:keydown={onEditKeydown}
                                on:blur={onEditBlur} />
                        {:else}
                            <!-- 🔴 可编辑 / 只读**同一段内容**（⛔ 别把取值块写两遍，两份迟早不一致）：
                                 只换**外层标签** —— 能改的渲染成真 `<button>`（原生可聚焦，键盘全免费、
                                 且不需要 `role`/`tabindex`），不能改的渲染成 `<span>`。
                                 ⚠️ 用 `<svelte:element>` 而不是「`<span>` + 动态 `role`/`tabindex`」：
                                    后者会被 Svelte 的 a11y 检查判成「非交互元素挂了非负 tabindex」（本批实测
                                    构建警告 87 → 89 里的一条）。`data-r`/`data-c` 只挂可编辑格。 -->
                            <svelte:element
                                this={ed ? 'button' : 'span'}
                                type={ed ? 'button' : undefined}
                                role={ed ? 'button' : undefined}
                                class="rl-tbl-cell rl-tbl-mv"
                                class:rl-tbl-ed={ed}
                                class:rl-tbl-ro={!ed}
                                data-r={ed ? ri : undefined}
                                data-c={ed ? c : undefined}
                                data-tip={ed && !shown ? `点击填写「${d.label}」` : undefined}
                                on:click={ed ? () => beginEdit(e, d, ri, c) : undefined}
                                on:focus={ed ? () => setCellCursor(ri, c) : undefined}
                                on:keydown={ed ? (ev) => onCellKeydown(ev, ri, c, e, d) : undefined}>
                                {#if d.key === 'rating'}
                                    <!-- 🔴 #619/#620 半星同卡片：恒排 5 个满星 + `--fill` 比例裁切（⛔ 不用字符星） -->
                                    {#if e.rating > 0}
                                        <span class="rl-stars {starClass(e.rating)}" style={`--fill:${e.rating}`} aria-hidden="true">★★★★★</span>
                                        <span class="rl-sr">{e.rating} 星</span>
                                    {:else}<span class="rl-tbl-none">—</span>{/if}
                                {:else if d.key === 'status'}
                                    <span class="rl-badge rl-badge-{e.status}">{statusLabel(e.type, e.status)}</span>
                                {:else if d.key === '__community'}
                                    {#if e.communityScore != null}<span class="rl-thumb-score">★ {scoreText(e)}</span>{:else}<span class="rl-tbl-none">—</span>{/if}
                                {:else if d.key === '__progress'}
                                    <!-- 🔴🔴 #680 ③-2（用户：「进度条贯穿整列、文字与条分离、视觉松散」）：
                                         改成**微型胶囊** —— 一个 `inline-flex` 容器里并排「文字 + 4px 细条」，
                                         不再让进度条单独占一行撑满整列。悬停 capsule 出 `data-tip` 看详情。 -->
                                    {#if lp.text}
                                        <span
                                            class="rl-prog-chip"
                                            data-tip={lp.pct !== undefined ? `已读 ${lp.pct}% · ${lp.text}` : lp.text}>
                                            <span class="rl-prog-chip-txt">{lp.text}{#if lp.pct !== undefined} · {lp.pct}%{/if}</span>
                                            {#if lp.pct !== undefined}
                                                <span class="rl-prog-chip-bar" aria-hidden="true"><span style={`width:${lp.pct}%`}></span></span>
                                            {/if}
                                        </span>
                                    {:else}<span class="rl-tbl-none">—</span>{/if}
                                {:else if shown}
                                    {shown}
                                {:else}
                                    <span class="rl-tbl-none">—</span>
                                {/if}
                            </svelte:element>
                        {/if}
                    </td>
                {/each}
                <td class="rl-col-ops">
                    <!-- 🔴 #590：操作栏统一成**纯线条图标 + 去边框**（原来是带圆角边框的 ✎ / 图标两枚）——
                         默认浅灰，悬停行或图标时变主题色（详见 `.rl-edit-row` 样式）。
                         🔴 #595：两枚包进 `.rl-ops-row`（flex）⇒ **恒横向排列**（原来是 `inline-flex` 行内盒，
                         格子一窄就自动换行成上下两排 —— 用户：「这右侧控件改成横向排列」）。 -->
                    <div class="rl-ops-row">
                        <button
                            class="rl-edit-row"
                            data-tip="编辑属性"
                            on:click={(ev) => { ev.stopPropagation(); onEditEntry(e.id); }}><Icon icon="pencil" size={14} /><span class="rl-sr">编辑属性</span></button>
                        {#if hasActionEntry(e)}
                            <button
                                class="rl-edit-row rl-edit-watch"
                                data-tip={actionAriaLabel(e.type)}
                                on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon={actionIcon(e.type)} size={14} /><span class="rl-sr">{actionAriaLabel(e.type)}</span></button>
                        {/if}
                    </div>
                </td>
            </tr>
            {/if}
        {/each}
        </tbody>
        <!-- 🔴🔴 列宽手柄（用户 2026-10-20：「列表视图怎么作品标题的竖状指示器不能拉动」）——
             **必须挂在 `<table>` 这一层，⛔ 别放回 `<th>` 里面**。
             上一版把它们写在各自的 `<th>` 里，但 `.rl-tbl-th` 是 `position: static`（#668 为了让竖线
             拉满整列），于是手柄实际锚定的是 `.rl-table`（唯一的定位祖先），坐标全靠
             `--rl-tbl-x` / `--rl-tbl-h` 两个变量算出来 —— **而这两个变量只由 `afterUpdate` 显式赋值**：
              ① 表头被横向滚出视野 / 重新布局时没有 `afterUpdate` ⇒ 变量停在旧值，手柄画在**别的列**上；
              ② 变量没写之前兜底是 `left: -99px` ⇒ 表格**左外侧**那条看不见的线；
              ③ `.rl-tbl-wrap` 是 `overflow-x: auto` 的滚动容器 ⇒ 任何落在 wrap 外面的部分被裁掉。
             结果就是用户看到的「竖指示器拖不动」（视觉上那条线是 `th` 的边框，拖的是另一条不存在的线）。
             ⇒ 现在手柄**直接挂在 table 下**（它本来就是 table 的子级，语义与坐标一致），仍由
               `syncColResizeHeight()` 按 `th` 右缘写坐标；`role="separator"` 原样保留。
             🔴 用户 2026-10-20：「删除双击列自适应列宽的逻辑」⇒ `on:dblclick` 与 `autofitCol()` 已整体删除，
               列宽**只由拖动决定**（双击不做任何事，⛔ 别再加回来）。
             ⚠️ 列数 = `colViews.cols.length + 1`（标题列 + 所有数据列）；每列右缘一条，
                竖线落在「列与列之间」，最后一条压在操作列左缘（拖动同样只改它左边那一列）。
             ⚠️ `aria-label` 里的列名 = 手柄**左边**那一列（拖的就是它），⛔ 别写成右边那列。 -->
        {#each [{ key: TITLE_KEY, label: '标题' }, ...colViews.cols.map((cv) => ({ key: cv.def.key, label: cv.def.label }))] as hd (hd.key)}
            <span
                class="rl-tbl-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label={`调整「${hd.label}」列宽`}
                class:is-active={resizeColKey === hd.key}
                data-resize-col={hd.key}
                on:pointerdown={(ev) => startColResize(ev, hd.key)}></span>
        {/each}
    </table>
    </div>
{/if}

<div class="rl-ctx-anchor" bind:this={ctxAnchorEl}>
    <!-- 🔴 #608：**一个容器服务两个宿主**（条目卡 / 系列折叠卡）。容器只在「至少一个目标非空」时挂载，
         内容按目标分叉 —— ⛔ 别做成两个并列的 `.rl-ctx` 容器：那会有两个 `bind:this`，切换分支时
         旧块的 teardown 可能把 `ctxMenuEl` 抹成 null（`placeCtxAt` 量不到尺寸 ⇒ 落点恒贴左上角）。 -->
    {#if ctxFor || ctxGroupKey}
        <div
            class="rl-ctx"
            bind:this={ctxMenuEl}
            style={`left:${ctxX}px;top:${ctxY}px${ctxMaxH !== undefined ? `;max-height:${ctxMaxH}px` : ''}${ctxMaxW !== undefined ? `;max-width:${ctxMaxW}px` : ''}`}
            on:click={(ev) => ev.stopPropagation()}
            on:mousedown={(ev) => ev.stopPropagation()}
            on:contextmenu={(ev) => ev.preventDefault()}>
            {#if ctxFor}
                {@const ctxEntry = entries.find((x) => x.id === ctxFor)}
                {#if ctxEntry}
                    <!-- 主操作（四类统一）：入口可用=动词直接执行；不可用=点开快捷关联弹窗补录 -->
                    <button on:click={() => ctxPrimary(ctxEntry)} data-tip={ctxPrimaryHint(ctxEntry)}>{actionMenuTitle(ctxEntry)}</button>
                    <!-- 🔴 #599：**常驻**的关联入口（不论有没有关联都在）—— 文案与弹窗标题同一真源
                         （`associateMenuLabel`）。有入口时主操作是「观看 / 阅读 / 启动 / 播放」，
                         改关联 / 换关联只剩这一条路；无入口时它与主操作同一个动作（进路不变）。 -->
                    <button on:click={() => { closeCtx(); onQuickAssociate(ctxEntry); }} data-tip="选择本地文件 / 网络地址（随时可改）">{associateMenuLabel(ctxEntry.type)}</button>
                    <!-- 🔴 2026-10-21（用户：「用细灰线（分割线）把菜单分成 3 组」）——
                         第 1 组 = 入口本身（主操作 + 关联入口），第 2 组 = 改属性与补录，第 3 组 = 删除。
                         ⚠️ 分隔线是**普通 div**（不是 `hr`）：`hr` 在 Obsidian 里被样式表当成正文分隔符压过边距。 -->
                    <div class="rl-ctx-sep"></div>
                    <!-- 🔴 2026-10-21（用户：「把『编辑条目』统一改成『编辑属性』」）——
                         与属性面板/字段编辑同一套词，⛔ 别改回「条目」：弹窗改的是**属性**，不是那一条记录。
                         ⚠️ 全仓另有 4 处「编辑条目」字面量（音乐行 ✎ 提示、列表铅笔提示、追更表按钮、
                            `EntryForm` 的浮层标题）—— 🔴 #686（用户 2026-10-22：「全仓 4 处也改成编辑属性名称」）
                            已全部统一为「编辑属性」；注释 / 文档里的历史引用**保留**（那是当时的语境，不是用户看到的字）。 -->
                    <button on:click={() => { closeCtx(); onEditEntry(ctxEntry.id); }} data-tip="编辑字段与关联">编辑属性</button>
                    <!-- 🔴 #685（用户 2026-10-22）：右键补录组，按**条目类型**给对应动作 ——
                         摘抄 = 文学 / 网文（⛔ 漫画不算，漫画走「添加短评」）｜短评 = 电影 / 剧集 / 动画 / 漫画 / 音乐｜
                         攻略 = 游戏｜重温 = 电影 / 剧集 / 动画｜周目 = 游戏｜时长 = 文学 / 网文 / 漫画 / 音乐 / 游戏。
                         ⚠️ 分隔线是**内容层级**（⛔ 别用 `:nth-child` 钉死 —— 各类型菜单项数不同）。 -->
                    {#if ctxEntry.type === 'book' && normalizeBookKind(ctxEntry.bookKind) !== 'comic'}
                        <button on:click={() => { closeCtx(); onAddExcerpt(ctxEntry); }} data-tip="粘贴文本生成摘抄">添加摘抄</button>
                    {/if}
                    {#if ctxEntry.type === 'movie' || ctxEntry.type === 'tv' || ctxEntry.type === 'anime' || ctxEntry.type === 'music' || (ctxEntry.type === 'book' && normalizeBookKind(ctxEntry.bookKind) === 'comic')}
                        <button on:click={() => { closeCtx(); onOpenEntryTextModal(ctxEntry, 'comment'); }} data-tip="写一句短评 → 写入笔记独立的「短评」章节">添加短评</button>
                    {/if}
                    {#if ctxEntry.type === 'game'}
                        <button on:click={() => { closeCtx(); onOpenEntryTextModal(ctxEntry, 'guide'); }} data-tip="写下攻略 → 写入笔记「攻略」章节">添加攻略</button>
                    {/if}
                    {#if ctxEntry.type === 'movie' || ctxEntry.type === 'tv' || ctxEntry.type === 'anime'}
                        <button on:click={() => { closeCtx(); onOpenEntryLogModal(ctxEntry, 'rewatch'); }} data-tip="第几次重刷 + 感想 → 写入笔记「重温记录」">记录重温</button>
                    {/if}
                    {#if ctxEntry.type === 'game'}
                        <button on:click={() => { closeCtx(); onOpenEntryLogModal(ctxEntry, 'playthrough'); }} data-tip="第几周目 + 感想 → 写入笔记「周目记录」">记录周目</button>
                    {/if}
                    {#if ctxEntry.type === 'book' || ctxEntry.type === 'music' || ctxEntry.type === 'game'}
                        <button on:click={() => { closeCtx(); onOpenEntryLogModal(ctxEntry, 'time'); }} data-tip="记一次时长 → 写入笔记「阅读 / 收听 / 游玩记录」章节">记录时长</button>
                    {/if}
                    <div class="rl-ctx-sep"></div>
                    <button class="rl-ctx-danger" on:click={() => ctxDelete(ctxEntry)} data-tip="删除条目">删除条目</button>
                {/if}
            {:else if ctxGroupKey}
                <!-- 🔴 #608 系列折叠卡右键：**只放「这一组」的事**（用户口径「右键菜单排序号」）。
                     ⛔ 别把条目那几条（主操作 / 关联入口 / 删除）搬过来 —— 折叠卡是一张聚合卡，不是条目。
                     🔴 #609 翻面：点的动作从「当场自动重排」改成「**打开拖拽排序弹窗**」（用户：
                        「弹窗批量勾选排序手动排，**不是自动排**」）⇒ 这里只负责转交 `onOpenSeriesReorder`。
                     🔴 #629 新增第二条「**批量关联**」（用户：「新增系列卡片右键菜单-批量关联按钮」）——
                        动作 = 打开那一组的**逐条关联清单**（宿主 `SeriesAssociateModal`），
                        ⛔ 不是「一键给全组填同一个值」（问答裁定的是**逐条**）。 -->
                {@const ctxGroup = findSeriesGroup(seriesRows, ctxGroupKey)}
                {#if ctxGroup}
                    <button on:click={() => { closeCtx(); onOpenSeriesReorder(ctxGroup); }} data-tip="拖拽调整这一系列的先后，确定后按新顺序编号">排序号</button>
                    <button on:click={() => { closeCtx(); onOpenSeriesAssociate(ctxGroup); }} data-tip={`逐条打开「${ctxGroup.title}」各成员的${associateMenuLabel(ctxGroup.type)}`}>批量关联</button>
                {/if}
            {/if}
        </div>
    {/if}
</div>

<!-- ── 1.3.1 ②（#621）表格列配置面板的**锚点** ─────────────────────────────────
     🔴 与 `.rl-ctx-anchor` 同款做法：菜单用 `absolute` 挂在锚点上，坐标由 `placeMenu` 在**视口坐标**里算好
        再减去锚点左上角换算过来。⛔ 不用 `position: fixed` —— Obsidian 视图有 transform 祖先，
        `fixed` 会被整体偏移（本仓 `.rl-ctx-anchor` 的注释里已经记过这条，#610 也是同一件事）。
     ⚠️ 锚点在流的末尾、且不给高度 ⇒ 不占版面。 -->
<div class="rl-tbl-col-anchor" bind:this={colAnchorEl}>
    {#if colMenuOpen}
        <div
            class="rl-tbl-colpop"
            role="group"
            aria-label="表格的列"
            style={`left:${colX}px; top:${colY}px`}
            bind:this={colPanelEl}>
            {#if canEditColumns}
                <!-- 🔴🔴 #680 ③-4（用户：「删掉顶部快捷键说明，把提示放到页面帮助文档/设置里；
                     面板改为**支持分组的显示**以区分不同的列字段重要性」）：
                  ⑴ 「点格子即编辑 · Enter 进入 · …」那行**整条删除**（不是隐藏）——
                     它是后台系统式的硬核说明，用户点名不要；入口已经移到阅读器/关于页的新手引导。
                  ⑵ 选项按 `colGroupOf()` **分三组**：常用字段 / 作品信息 / 其它。
                     ⛔ 分组只是**显示层**（DOM 分了 section），`tableKeys` 的顺序与归一不受影响 ——
                     列序仍由用户拖表头决定（见 `pure/tableColumns` 文件头那条口径）。 -->
                {#each colGroups as g (g.title)}
                    <div class="rl-tbl-colgroup">
                        <div class="rl-tbl-colgroup-title">{g.title}</div>
                        <div class="rl-tbl-colgrid">
                            {#each g.items as opt (opt.key)}
                                <label class="rl-tbl-colopt">
                                    <input type="checkbox" checked={tableKeys.includes(opt.key)} on:change={() => toggleCol(opt.key)} />
                                    <span class="rl-tbl-colhead">{opt.label}</span>
                                    {#if !opt.editable}<span class="rl-tbl-colro">只读</span>{/if}
                                </label>
                            {/each}
                        </div>
                    </div>
                {/each}
                <div class="rl-tbl-colfoot">已选 {tableKeys.length} / {TABLE_COLUMN_LIMIT}</div>
            {:else}
                <div class="rl-tbl-colhint">当前是「全部」页签：表格按<b>各类型共有的列</b>显示（各类型专属列不进混排表），没有「哪一套配置」可改。<br />进入某个类型页签（电影 / 书籍 / …）后再来点这里，就能勾选列了。</div>
            {/if}
        </div>
    {/if}
</div>

<style>
    /* 工具栏：搜索框 + 添加按钮整体居中 */
    /* 🔴 #547：左端那枚「库概览」（`N 项媒体 / N 本书`）已按用户要求整体删除 ⇒
       这里原来三条 `.rl-libstats*` 规则一并删掉（选择器没了使用者，留着会被判「未使用选择器」并 +1 告警）。
       ⚠️ `position: relative` **必须留着** —— 它是 `#546` 那个「搜索框那一行右端」导航入口的定位参照物。 */
    .rl-toolbar { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 8px; position: relative; }
    /* 🔴 #552 库概览（工具栏**左端**）：`absolute; left: 0` 钉左 —— ⛔ 不进 flex 流，
       否则会把居中的「搜索框 + 添加」那一组挤偏（与右端那枚导航入口同一条纪律）。
       观感沿用删除前那一版（10.5px / `--text-faint`，数字重一档），⛔ 别再改成大字号：
       它是**弱化的辅助小字**，不是统计页那种主数字。 */
    .rl-toolbar .rl-libstats {
        position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        display: inline-flex; align-items: center; gap: 5px; flex: none; white-space: nowrap;
        font-size: 10.5px; color: var(--text-faint);
    }
    .rl-libstats-total { font-weight: 600; color: var(--text-muted); }
    .rl-toolbar button {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); padding: 3px 10px; cursor: pointer;
    }
    .rl-toolbar .rl-cnt { opacity: .6; font-size: 10px; }
    /* 搜索框定宽（阶段7+：240~320px，无需通栏拉伸）；内嵌 lucide 搜索图标（09-12） */
    .rl-toolbar .rl-search-wrap { position: relative; flex: none; width: 280px; max-width: 320px; min-width: 240px; }
    .rl-toolbar :global(.rl-search-ico) {
        position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
        color: var(--text-faint); pointer-events: none;
    }
    .rl-toolbar .rl-search {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px);
        padding: 5px 10px 5px 27px; width: 100%;
    }
    .rl-toolbar .rl-search:focus { outline: none; border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-toolbar .rl-search::placeholder { color: var(--text-faint); }
    /* ＋添加：Obsidian 主题 accent 主按钮（mod-cta 语义，随主题变色——阶段7 原生融合） */
    .rl-toolbar .rl-add.mod-cta {
        background: var(--interactive-accent) !important;
        border-color: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
        font-weight: 600; flex: none;
    }
    /* 🔴 #594：批量条**吸顶**（用户：「批量改标签条要始终冻结保持页面滚动不被滚动」）。
       滚动容器是 Obsidian 的 `.view-content`（`.rl-home` 没有 overflow ⇒ sticky 有正确的参照系）。
       ⚠️ **底必须不透明**：本来的 `--background-modifier-hover` 是**半透明覆盖层**，吸顶时下面的行会透出来
          （看着像糊了一层）⇒ 用「同色渐变垫在不透明底上」的写法得到**同款观感 + 完全不透明**。
       ⚠️ `z-index` 要**低于**模态族（`.rl-ctx` 50 / `.rl-ctx-anchor` 100）与题材浮层，高于普通卡片即可。
       ⛔ 这道 sticky **不撞**全仓那道反向守卫 —— 那条只禁 `.rl-tabs` / `.rl-nav` / `.rl-genre-head` / `.rl-sticky-head`
          （「页签吸顶已撤」那件事），与批量条无关。 */
    .rl-batchbar {
        position: sticky; top: 0; z-index: 20;
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; padding: 6px 10px;
        border: 1px solid var(--interactive-accent); border-radius: var(--rl-t-radius-lg, 8px);
        background: linear-gradient(var(--background-modifier-hover), var(--background-modifier-hover)), var(--background-primary);
    }
    .rl-batch-cnt { font-size: 12px; font-weight: 600; color: var(--text-normal); }
    /* 🔴 #608：批量条里「序号」那组的三条样式（标签 + 两个窄数字框 + 一条分隔竖线）随该组一起**删除**。
       ⛔ 别在删了 markup 之后留着它们（Svelte 会对**未使用的选择器**发告警，直接顶破 89 条基线）；
       ⚠️ 也⛔ 别在本注释里把被删的类名照抄一遍 —— 本仓的反向守卫按类名串判「0 处」，注释**会进产物**，
          抄一遍就等于自己把守卫打穿（这是本仓踩过 8+ 次的老坑）。 */
    .rl-batchbar select, .rl-batchbar button {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); padding: 2px 8px; cursor: pointer;
    }
    .rl-batchbar button:hover { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }
    .rl-batchbar button:active { transform: scale(.96); }
    .rl-batchbar button:disabled { opacity: .4; cursor: not-allowed; }
    .rl-batch-danger { color: var(--rl-danger) !important; border-color: var(--rl-danger) !important; }
    .rl-batch-danger:hover { background: var(--rl-danger-strong) !important; color: #fff !important; border-color: var(--rl-danger-strong) !important; }
    .rl-batch-tags {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px);
        padding: 2px 8px; min-width: 150px; max-width: 200px;
    }
    .rl-batch-tags::placeholder { color: var(--text-faint); }
    /* 层3 控制栏（阶段7：状态/类型/排序/视图一行，无边框容器——选项为无边框 pill，选中浅背景+accent 文字） */
    .rl-viewbar {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        margin-bottom: 12px;
    }
    .rl-vb-group { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; }
    .rl-vb-group button {
        font-family: inherit; font-size: 12px; color: var(--text-muted);
        background: transparent; border: none; padding: 4px 10px; border-radius: var(--rl-t-radius-pill, 999px); cursor: pointer;
        transition: background .15s ease, color .15s ease;
    }
    /* 1.0.4：悬停只让**文字**变主题色、不铺底色（用户 2026-09-14 裁定，与视图切换图标同一语言）；
       按下内缩保留（.on 规则写在其后 → 选中项悬停保持选中外观） */
    .rl-vb-group button:hover { color: var(--interactive-accent); }
    .rl-vb-group button:active { transform: scale(.96); }
    .rl-vb-group button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -1px; }
    /* 键盘可达（批C）：卡片与列表标题聚焦时必须有可见指示，否则键盘用户不知道焦点在哪 */
    .rl-card:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -1px; }
    .rl-row-link:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; border-radius: 3px; }
    .rl-vb-group button.on { background: var(--background-modifier-hover); color: var(--interactive-accent); font-weight: 600; }
    .rl-vb-group .rl-cnt { font-size: 10px; opacity: .6; margin-left: 2px; }
    .rl-vb-group button.on .rl-cnt { opacity: .85; }
    .rl-vb-sep { width: 1px; height: 16px; background: var(--background-modifier-border); margin: 0 6px; flex: none; }
    /* 下拉组（状态/排序）：标签 + 下拉，通用 */
    .rl-vb-select { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
    .rl-sel-label { font-size: 10px; color: var(--text-faint); }
    /* 🔴 #566：原生 `<select>` 那两版（#555 闭合框居中 / #565 逐个 option 居中）**整条退场** ——
       Windows Chromium 的 popup 不受页面 CSS 控制，给 option 写对齐在实机上无效
       （用户实测「弹出列表没居中」）；闭合框居中 + 弹出列表居中改由 `MiniSelect` 组件承担
       （同款盒模型见它的 scoped 样式：`height: var(--input-height)` / `padding: 2px 8px` /
       半径 `--rl-t-radius-md` / 字号 12px，与本处原 select 逐项相同）。
       ⛔ 别把那两条 select 规则加回来 —— 模板里已无 `<select>`/`<option>`，加了也是死代码。 */
    /* ── 题材筛选（用户 2026-09-22）──
       胶囊 = 工具栏「状态 / 排序」两个 select 的**同款盒模型**（同字号 / 同圆角 / 同边框 / 同内距 / **同高度 + 同内阴影**），
       只是把 <select> 换成按钮 + 浮层（多选没法用原生 select 表达）。
       🔴 规则一律写**两级前缀**（`.rl-genre-wrap .rl-genre-btn`）：单类 (0,1,0) 会被核心
       `button:not(.clickable-icon)` (0,1,1) 压出主题灰底 + `--input-shadow`（UI-GUIDE §3 v14/v15 老坑，
       本批「全选」按钮就踩到了 —— 实机截图里它是个带边框的方按钮）。
       注：面板内那个「全选」按钮要**拍平**（透明、无边框、无阴影），而**胶囊不要拍平阴影**（它就该有和 select 一样的内阴影）。 */
    .rl-genre-wrap { position: relative; }
    /* 🔴 与工具栏「状态 / 排序」两个 select **同款盒模型**（用户 2026-09-22 截图：胶囊矮一半 + 悬停变蓝边）。
       实测（`_probe_pill370.cjs`：真实 app.css + 真实组件 CSS）差异只有两项 —— 高度 30 vs 21、内阴影 有/无；
       其余（边框色/宽、圆角、内距、背景、字号、字重、字色、box-sizing）本就逐项相同。两处都跟随**核心真源**：
         · `height: var(--input-height)`  ← 核心 `select, .combobox-button, .dropdown { height: var(--input-height) }`（缺省 30px）
         · `box-shadow: var(--input-shadow)` ← 核心输入控件的「内描边 + 1px 投影」
       ⛔ 不要把高度/阴影写死成 px（主题若改 `--input-height`，select 会跟着变，胶囊就又不一致了）。 */
    .rl-genre-wrap .rl-genre-btn {
        font-family: inherit; font-size: 12px; color: var(--text-normal);
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); box-shadow: var(--input-shadow); padding: 2px 8px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 4px; height: var(--input-height);
    }
    /* 悬停：⛔ **不动描边**（相邻两个 select 的描边永不变化，动它就成了截图里那条蓝边）——
       只让**文字 + 箭头**变主题色（本项目并排控件的既定语言），阴影按核心 select 的 hover 档加深一档，
       同样 ⛔ 不铺底色（并排控件铺底会连成色带）。 */
    .rl-genre-wrap .rl-genre-btn:hover { color: var(--interactive-accent); box-shadow: var(--input-shadow-hover); }
    /* 🔴 #594：**下拉打开时保持高亮**（用户：「鼠标悬停保持高亮，下拉时也保持高亮，取消悬停恢复正常，取消下拉恢复正常」）——
       展开面板后鼠标移进面板、闭合框就丢了 `:hover` ⇒ 高亮一闪就没了。这里补一条 `is-open` 档，
       样式与悬停**逐条同款**（同样只变色、不动描边，与相邻 select 的语言一致）。
       ⚠️ 与 MiniSelect 的 `.rl-sel-wrap.is-open` 是同一条口径的两半（那边在组件里，这边在宿主里）。 */
    .rl-genre-wrap.is-open .rl-genre-btn { color: var(--interactive-accent); box-shadow: var(--input-shadow-hover); }
    .rl-genre-wrap.is-open .rl-genre-caret { color: var(--interactive-accent); }
    .rl-genre-wrap .rl-genre-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    /* 已筛选态：只留**文字**变主题色（标签本身会显示「推理+1」）。
       ⛔ 不给描边上色 —— 那正是相邻 select 永远不会有的形态（用户 2026-09-22 截图点名）。 */
    .rl-genre-wrap .rl-genre-btn.is-on { color: var(--interactive-accent); }
    .rl-genre-caret { font-size: 9px; opacity: .7; }
    /* 浮层向下开（用户 D-8）：工具栏在视图顶部，下方只会被 .view-content 裁掉——封顶高度 + 内部滚动兜住；
       ⛔ 不用 placeMenu（那是右键菜单的视口贴点逻辑，这里要的是「贴着胶囊左对齐向下」）。
       ⚠️ 题头固定靠 **flex 三段（head flex:none + body overflow:auto）**，⛔ 不用 `position: sticky`
       —— 产物里有一道全仓反向守卫禁止 `position:sticky;top:0`（页签吸顶已撤，勿回潮）。 */
    .rl-genre-panel {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 40;
        min-width: 190px; max-width: 260px; max-height: 280px;
        display: flex; flex-direction: column; overflow: hidden;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu, 0 4px 14px rgba(0, 0, 0, .15));
        cursor: default;
    }
    .rl-genre-head {
        flex: none;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border);
        font-size: 11px; color: var(--text-faint);
    }
    /* 「全选 / 清空」：也是 <button> ⇒ 同样两级前缀 + 显式拍平（核心那套灰底/内阴影必须压掉） */
    .rl-genre-head .rl-genre-all {
        font-family: inherit; font-size: 11px; color: var(--interactive-accent);
        background: transparent; border: none; box-shadow: none; padding: 0; height: auto;
        cursor: pointer;
    }
    .rl-genre-head .rl-genre-all:hover { text-decoration: underline; }
    .rl-genre-body { flex: 1 1 auto; overflow: auto; padding: 4px 0; }
    /* 列表行 = 勾选框 + 名称 + 计数（计数列右对齐并等宽，数字成列好读） */
    .rl-genre-opt { display: flex; align-items: center; gap: 8px; margin: 0 4px; padding: 3px 6px; border-radius: 4px; font-size: 12px; cursor: pointer; }
    .rl-genre-opt:hover { background: var(--background-modifier-hover); }
    /* 🔴 勾选框尺寸/圆角一律**就地覆盖主题变量**：核心 `input[type=checkbox]` 的 width/height 走
       `--checkbox-size`（缺省 = --font-text-size）、圆角走 `--checkbox-radius` —— 用户主题把它们放大到
       实测 **26px + 全圆**（截图里那几个大圆圈）。变量覆盖最稳（比硬写尺寸更抗主题），尺寸再显式写一遍兜底。 */
    .rl-genre-opt input[type="checkbox"] {
        --checkbox-size: 13px; --checkbox-radius: 3px;
        width: 13px; height: 13px; margin: 0; flex: none;
    }
    .rl-genre-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-genre-cnt { margin-left: auto; font-size: 10px; color: var(--text-faint); flex: none; min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
    .rl-genre-none { padding: 8px 10px; font-size: 11px; color: var(--text-faint); }
    /* 🔴🔴 #598 **翻面**：视图切换由「分段控制器」改成**单枚下拉菜单**（原来那套
       「浅灰外容器 + 白滑块 + 三枚 Unicode 几何符号 ▦☷▥」整体退场 —— 用户：「还是太丑了，有什么其他方案切换」）。
       闭合框与筛选栏那几个下拉**同款盒模型**（`--input-height` 定高 + `--input-shadow` 内描边环）⇒
       工具栏右侧那一排读作一家；`margin-left: auto` 仍把它推到行尾。
       🔴 hover / 打开态**只变色、不铺底**（本仓「并排切换类悬停只变色」口径，产物里有反向守卫钉着
       `.rl-vb-view…:hover{color:…}`）—— ⛔ 别把底色挪进 hover。 */
    .rl-vb-view { position: relative; display: inline-flex; margin-left: auto; }
    .rl-vb-view .rl-vb-btn {
        display: inline-flex; align-items: center; gap: 6px;
        height: var(--input-height); padding: 2px 8px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); box-shadow: var(--input-shadow);
        color: var(--text-normal); font-family: inherit; font-size: 12px; cursor: pointer;
    }
    .rl-vb-view .rl-vb-btn:hover { color: var(--interactive-accent); }
    .rl-vb-view.is-open .rl-vb-btn { color: var(--interactive-accent); }
    .rl-vb-view .rl-vb-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    .rl-vb-cur { white-space: nowrap; }
    /* 小倒三角与「题材」那枚 `.rl-genre-caret` / MiniSelect 的 `.rl-sel-chev` **逐字同款**（9px / .7） */
    .rl-vb-caret { font-size: 9px; opacity: .7; color: var(--text-muted); }
    .rl-vb-view .rl-vb-btn:hover .rl-vb-caret,
    .rl-vb-view.is-open .rl-vb-caret { color: var(--interactive-accent); }
    /* 浮层：贴按钮下沿 4px、**右对齐**（按钮在行尾 —— 左对齐会把面板顶出容器右缘）、至少与按钮同宽。
       🔴 z-index 显式给 30：与 `MiniSelect` 的 `.rl-sel-pop` 同档（高于海报墙卡片、低于右键菜单族 50/100）。 */
    .rl-vb-pop {
        position: absolute; right: 0; top: calc(100% + 4px); z-index: 30;
        min-width: 100%; padding: 4px;
        display: flex; flex-direction: column;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px);
    }
    /* 选项 = **图标 + 名字 + 尾部勾**三段；尾部那格**恒占位**（勾只出现在当前项）⇒ 三项的文字左缘对齐 */
    .rl-vb-view .rl-vb-opt {
        display: flex; align-items: center; gap: 7px; width: 100%;
        padding: 5px 8px; border: none; background: transparent; box-shadow: none;
        color: var(--text-normal); font-family: inherit; font-size: 12px; text-align: left;
        white-space: nowrap; border-radius: var(--rl-t-radius-sm, 4px); cursor: pointer;
    }
    .rl-vb-view .rl-vb-opt:hover { color: var(--interactive-accent); }
    /* 当前项**只变色 + 轻加粗**（全仓「并排的切换类只变色」口径，⛔ 不铺底） */
    .rl-vb-view .rl-vb-opt.on { color: var(--interactive-accent); font-weight: 600; }
    .rl-vb-view .rl-vb-opt-label { flex: 1 1 auto; }
    .rl-vb-tick { flex: none; width: 12px; text-align: right; font-size: 11px; }
    .rl-vb-view .rl-vb-opt:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    /* 🔴🔴 #680 用户：「直接去掉每一个视图上的『点切换·拖动可调整顺序』Tooltip。既然支持拖动排序，
       最直观的反馈是光标」⇒ 那条 `data-tip` 已从模板删除（⛔ 别加回来），改为：
       · `cursor: grab` = 悬停即「可抓」；按住拖动时 `cursor: grabbing` = 「正在抓」；
       · 拖拽中那一项半透明；落点用**顶部一条主题色线**（列表竖排，横线才读得出「插到谁前面」）。
       · ⚠️ 落点线用 `inset box-shadow` 而不是 `border-top` —— border 会让那一行高 1px、整列抖一下。
       · ⚠️ `grabbing` 必须同时挂在 `:active` 与 `.is-dragging` 上：拖拽过程中指针常常已经不在那一行上，
         `:active` 会掉（实测：按住往隔壁项上拖时，光标会跳回 grab）。 */
    .rl-vb-view .rl-vb-opt { cursor: grab; }
    .rl-vb-view .rl-vb-opt:active,
    .rl-vb-view .rl-vb-opt.is-dragging { cursor: grabbing; }
    .rl-vb-view .rl-vb-opt.is-dragging { opacity: .45; }
    .rl-vb-view .rl-vb-opt.is-over { box-shadow: inset 0 2px 0 var(--interactive-accent); }

    /* ── 🔴 #598 时间线视图 ──────────────────────────────────────────────
       结构 = 若干「桶」（一年一桶，新的在前）→ 每桶 = 左侧**年份轴**（年份 + 部数）
       + 右侧该年条目的**横向流**（`flex-wrap`）。年份轴用 `border-right` 画那根竖线，
       ⚠️ 轴**定宽 + 右对齐**：年份数字右缘对齐 ⇒ 各桶的竖线落在同一条线上（左对齐会参差不齐）。 */
    .rl-timeline { display: flex; flex-direction: column; gap: 14px; }
    .rl-tl-group { display: flex; align-items: flex-start; gap: 12px; }
    .rl-tl-axis {
        flex: none; width: 64px; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px;
        padding: 2px 10px 0 0; border-right: 1px solid var(--background-modifier-border);
    }
    .rl-tl-year { font-size: 12px; font-weight: 600; color: var(--text-normal); font-variant-numeric: tabular-nums; }
    .rl-tl-cnt { font-size: 10px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
    .rl-tl-items { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; gap: 10px; }
    .rl-tl-item { width: var(--rl-tl-w, 76px); display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
    .rl-tl-cov { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: var(--rl-t-radius-sm, 4px); display: block; }
    .rl-tl-ph {
        display: flex; align-items: center; justify-content: center;
        background: var(--background-modifier-hover); color: var(--tc, var(--text-muted));
        font-size: 16px; font-weight: 600;
    }
    .rl-tl-title {
        font-size: 11px; color: var(--text-normal); line-height: 1.3;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .rl-tl-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .rl-tl-sc { font-size: 10px; color: var(--text-muted); }
    .rl-tl-item:hover .rl-tl-title { color: var(--interactive-accent); }
    .rl-tl-item:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }
    /* 🔴 勾选态自己一条：`grid` 那条 `.rl-card.rl-sel-card` 管不到时间线的条目（类名不同）——
       ⛔ 别给它挂 `.rl-card`（那会把海报墙卡片的整套盒模型也带进来）。*/
    .rl-tl-item.rl-sel-card .rl-tl-cov { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    /* 卡片网格：列数由设置「海报密度」决定（内联 style 注入 pure/posterGrid 的模板串）。
       这里是**兜底值**，与「标准」档产物逐字一致（FALLBACK_POSTER_GRID_TEMPLATE）：
       min(…, 100%) 是「容器比一张卡片的最小宽还窄时不横向溢出」的保护（原写法缺它，窄侧栏会溢出）。 */
    .rl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr)); gap: 12px; align-items: stretch; }
    /* ── 🔴 #624 海报墙（`wall`）：与卡片网格**共用** `.rl-grid` 容器 ──────────────────────────
       形态 = **封面（`.rl-cov` 已是 `aspect-ratio: 2/3` ⇒ 天然等宽等高）+ 一行标题**。
       用户裁定「不带年份 / 评分 / 信息栏」⇒ 那些部分**整段不渲染**（见卡片标记里的 `!wallView` 分支）。
       🔴 **收窄刻意不在 CSS 里做** —— 本批实测的硬约束：要「`.rl-wall` 限定 + 命中信息栏里的行」，
          选择器必然有**三个复合选择器**，而 Svelte 4 按 compound 个数给 scope 类
          （3 个 ⇒ 产物里 `.svelte-x.svelte-x.svelte-x` **三遍**）⇒ 立刻撞坏全仓按「两遍」形态写的产物锚
          （当场 29 条 FAIL，靠二分实验逐条定位）。**本组规则 compound 数一律 ≤2。**
       ⚠️ 保留 `.rl-type-bar`（colorful 主题的类型色条）与 hover 的「⋯ / ▶」——
          前者是装饰、后者是操作，都不占高度、也不属于用户点名要去掉的那三类。
       🔴 #627（用户截图报障：「就一行标题怎么空几行啊」）：
          `.rl-card-meta` 那条 `min-height: 74px` 是给**普通卡那 0~5 行信息栏**准备的
          （保证同排各类型的卡片一样高）；海报墙只剩**一行标题**，那 74px 就变成标题下的**纯白留白**
          （实测：标题下净留白 **54.5px**）。⇒ 在墙上把它归零。
       ⚠️ 复合选择器 **2 个**（`.rl-wall` + `.rl-card-meta`）—— 守本组「compound ≤2」的铁律（见上）。
       ⚠️ 归零**不会**让同排卡片高矮不一：墙上一行里所有卡都是「同一个 2:3 封面 + 一行 nowrap 标题」，
          高度天然相等。⛔ 别顺手把 `.rl-row2`（带 `margin-top:auto` 的底部定位行）也删了 —— 它对普通卡是必需的，
          在墙上高度为 0 不碍事（只留 3px 上内距）。 */
    .rl-wall { gap: 10px; }
    .rl-wall .rl-card-meta { min-height: 0; }
    /* 卡片统一尺寸：列内 flex 等高，meta 区域最小高度保证各类型（电影/剧集/动画/书籍/游戏）
       的卡片在视觉上同高，进度行贴底对齐 */
    .rl-card { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-card-radius, var(--rl-t-radius-lg, 8px)); overflow: hidden; cursor: pointer; position: relative; display: flex; flex-direction: column; }
    .rl-card:hover { box-shadow: var(--rl-t-shadow-card-hover, 0 2px 8px rgba(0, 0, 0, .12)); transform: translateY(var(--rl-t-lift, 0px)) scale(var(--rl-t-scale, 1)); }
    .rl-card.rl-sel-card { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-type-bar { height: 4px; flex: none; }

    /* ── 系列折叠卡（#434）─────────────────────────────────────────────────
       🔴 **不新建骨架**：模板里折叠卡写的还是 `.rl-card` + `.rl-cov-wrap` + `.rl-card-meta`，
          这里只补「角标 / 展开提示 / 组头」三件。⛔ 别给 `.rl-series-card` 另加宽高或内距 ——
          一旦与 `.rl-card` 不同，同排卡片底部就不齐了（仿真页 sr434 量测过：现在 Δw=Δh=0）。
       ⚠️ 角标几何**与** `.rl-cov-score` **逐字同款**（top/right 6px、11.5px、`rgba(0,0,0,.6)`、`padding: 4px 9px`、
          胶囊圆角）：海报墙上「封面右上角」只有这一个语汇，⛔ 别再发明第二套尺寸。
       🔴 #557（用户 2026-10-08「异构卡角标统一」）：**那段类型色描边已整体删除** —— 它让折叠卡角标在
          某些类型下泛蓝，与普通卡的纯深色角标并排就像两种东西；现在两枚角标**只差文字内容**。
          ⇒ 那个「类型色注入变量」也随之**没有任何消费者**，注入点一并退场（本仓「死码不留」）。
          ⚠️ 本条注释**刻意不写出那个变量名** —— 注释会进产物，写了会撞红「它不得回潮」的反向守卫（本仓老坑）。 */
    .rl-series-cnt {
        /* ⚠️ #504：这个 `z-index: 5` 现在**唯一**的对手只剩封面（叠图层已不带 z-index，见下方那段）。
           它必须高于封面才不被叠图吃掉 —— 这正是 #504 修的那件事（当时叠图层的 z-index 能涨到 18）。 */
        position: absolute; top: 6px; right: 6px; z-index: 5;
        background: rgba(0, 0, 0, .6); color: #fff;
        font-size: 11.5px; font-weight: 700; line-height: 1;
        padding: 4px 9px; border-radius: var(--rl-t-radius-pill, 999px);
        /* 🔴 #629：与大众评分角标（`.rl-cov-score`）**同一条显隐纪律** —— 悬停封面 / 键盘聚焦卡片时**淡出**
            把那个角让给浮层里那两枚动作（用户：「如【x15】在鼠标hover时隐藏」）。
           ⚠️ `.15s` 与 `.rl-cov-score` 逐字同值：两张角标同框出现时淡出的节奏必须一致（差一点点就看得出「两套」）。 */
        transition: opacity .15s ease;
    }
    .rl-card:hover .rl-series-cnt, .rl-card:focus-within .rl-series-cnt { opacity: 0; }

    /* ── #501③ 叠图封面（「里面几张封面的**叠图**」）：组内前 N 张的**真实封面**层叠 ──
       🔴 **外尺寸必须与普通卡完全一致**（既有铁律：同排卡片底部要齐，仿真页 sr434 量过 Δw=Δh=0）。
          这里的做法 = 高度由 `.rl-cov-wrap` 的 `aspect-ratio: 2/3` **独占**决定，
          封面层全部 `position: absolute` 挂在 wrap 里 ⇒ 无论露几层，**卡的外框一寸不变**。
          ⚠️ 正因为 wrap 自己撑高，这里**不再需要** #500⑤ 那套「`width: calc(100% - 9px)` + `height: 100%`
             把 `aspect-ratio` 顶失效」的技巧 —— 那是为了给**纯色窄边**腾位；换成绝对定位的叠图层后就多余了
             （⚠️ `.rl-cov` 上那条 `aspect-ratio: auto` 一并撤掉，普通卡的封面样式不受影响）。
       🔴 #501③ 相对 #500⑤ 的两处**回退 / 替换**（用户上手后判的）：
          ① **卡片边框回退** —— `.rl-series-card { outline: … }` 整条**删除** ⇒ 描边不再有，卡片边框回到
             `.rl-card` 原来那条 `1px solid var(--background-modifier-border)`（普通卡同款）。
          ② **窄边 → 叠图** —— `::before` / `::after` 那两条**纯色**窄边删除，改成渲染组内**真实封面**
             的多层（模板里那个 `{#each stackCovers}`），错位量见下。
       ⚠️ 错位量写成 `calc(var(--si) * 8px)` ⇒ **2 张 / 3 张自动均匀**，⛔ 不必按张数写两套。
       🔴🔴 **必须显式给 `width` / `height`，⛔ 不能靠 `left` + `right` 去「拉」** ——
           `<img>` 是**替换元素**：`width: auto` 时它的宽度取**图片固有宽度**（这里是原图尺寸），
           `left` + `right` 那套「两端定位夹出宽度」的算法**对它不适用**（CSS 2.1 §10.3.8）。
           实测（`_shot/sr501.html` 首版）：`right` 的计算值明明算对了（16px），
           但元素仍是 200px 宽、直接溢出 wrap ⇒ 叠图看上去「只有主封面 + 一堆溢出」。
       ⇒ 每层尺寸统一 = `100% - (总张数 − 1) × 8px`，位置由 `top`/`left` 错开。 */
    /* 🔴 #626：给叠图那套 `cqw` 造一个**查询容器**（见下面 `--rl-stk-step` 的第 3 个 `min()`）。
       ⚠️ 用 `inline-size` 而不是 `size`：`size` 要求**两轴**尺寸都由外部给定、并会把内容隔离得更死，
          而本元素正是靠 `aspect-ratio` 反算高度的 —— 只隔离横向风险最小。
       ⚠️ 写在 `.rl-series-card` 作用域内 = **2 个复合选择器**（compound ≤2 是本组件铁律，见上面 `.rl-wall` 那段）。 */
    .rl-series-card .rl-cov-wrap { position: relative; aspect-ratio: 2 / 3; container-type: inline-size; }
    .rl-series-card .rl-cov-stack {
        position: absolute; display: block; object-fit: cover;
        /* 🔴 #502① **错位步长自适应**（层数不再封顶 3 张后的必然要求）：
           4 层以内每层 **9px**；再多的层**总让出量固定 28px** ⇒ 每层 = 28 / (层数 − 1)（越叠越窄，像一摞书页）。
           ⛔ 别退回写死 `9px` —— 10 部时累计让出 81px，主封面只剩 113px。
           ⚠️ `max(1, …)` 是必需的兜底：1 层时 `(1 − 1) = 0` ⇒ 除零 ⇒ 整个值失效 ⇒ 尺寸规则整条丢失。
           🔴 #503① 用户：「目前的层叠效果有点生硬…**露出更多边缘**」⇒ 步长 8→**9**、总让出 24→**28**
           （主封面从 170 收到 **166**，比原来多露 4px 的边）。 */
        /*  🔴 #626 **再加一层「按卡宽封顶」**（第 3 个 `min()`）：总让出量 ≤ **卡宽的 15.5%**。
            为什么需要：前两档（9px 步长 / 总让出 28px）是照 **180px 标准卡**配的 ——
            紧凑档（`POSTER_CARD_MIN_WIDTHS.compact` = 150px）尤其 Ctrl+滚轮缩到 8~16 列
            （海报墙 16 列 ≈ 60px 一张）时，固定 28px 让出会吃掉卡宽的**三成以上**，主封面被压得明显偏小。
            为什么是 15.5%：180 × 15.5% = **27.9px ≈ 28px** ⇒ **标准 / 宽松档逐像素不变**，
            只有更窄的卡才会被这一档夹到（150px 卡 ⇒ 总让出 23.25px；60px 卡 ⇒ 9.3px）。
            ⚠️ `cqw` 依赖上面那条 `container-type: inline-size`；万一它没生效（老内核），
               `cqw` 退回视口单位给出的**大值** ⇒ `min()` 取到前面那条 9px ⇒ **退化成今天的行为**，不会更糟。
            ⚠️ 三步长度全部走 `min()`，⛔ 别拆成两条自定义属性（一拆就丢了「总让出」这个语义）。 */
        --rl-stk-step: min(9px, calc(28px / max(1, var(--sn, 1) - 1)), calc(15.5cqw / max(1, var(--sn, 1) - 1)));
        top: calc(var(--si, 0) * var(--rl-stk-step));
        left: calc(var(--si, 0) * var(--rl-stk-step));
        width: calc(100% - (var(--sn, 1) - 1) * var(--rl-stk-step));
        height: calc(100% - (var(--sn, 1) - 1) * var(--rl-stk-step));
        /* 🔴🔴 #504 **不给 `z-index`**（= auto ⇒ 叠放完全由 DOM 先后决定，见模板里「其余层先画、主封面最后画」）。
           这里曾经是 `z-index: calc(var(--sn, 1) - var(--si, 0))` —— 它**随层数无上界地涨**：
           3 部时最高 3（< 角标 5，看不出问题），18 部时最高 **18** ⇒ 把封面右上角的
           「×N」角标（`.rl-series-cnt`，z-index **5**）与右下角播放钮（`.rl-watch-btn`，z-index **7**）
           **一起盖住**（用户报「右上角『18部』标识被遮住了」）。
           ⛔ 别改回任何「跟着层数涨」的写法，也 ⛔ 别去把角标/播放钮的 z-index 往上抬（那是治标：
              层数没有上限，抬到多少都可能被超过）—— 正解是**叠图层根本不参与 z-index 竞争**。 */
        /* 🔴 #503① 「一叠碟片」的关键一件（用户：「加上微弱的阴影，营造出一叠碟片的感觉」）：
           两条一起给 ——
             ① `0 0 0 1px rgba(255,255,255,.45)`：每层边缘一条**极细的亮边**。真实封面大多是深色海报，
                纯阴影落在深色上几乎看不出对比；这条亮边才是「层与层的分界」真正的承担者（像碟片之间的缝）。
             ② `0 2px 5px rgba(0,0,0,.28)`：朝**自己下面那一层**投的淡影 —— 偏移 2px + 模糊 5px
                刚好落进下面那层露出的 9px 条里（错位 9px ⇒ 影不会越过它、也不会被挤没）。
           ⚠️ `box-shadow` **不参与布局** ⇒ 加它不动任何尺寸（铁律：折叠卡外框必须与普通卡一致）。
           ⚠️ 阴影朝右下投、正好落在下面那层上；最底层那条会被卡片 `overflow: hidden` 裁掉一角 —— 无妨。 */
        box-shadow: 0 0 0 1px rgba(255, 255, 255, .45), 0 2px 5px rgba(0, 0, 0, .28);
    }
    /* ── 🔴 #510 动态显示效果（用户：「…和动态显示效果」）─────────────────────────────
       两条都**只动 `transform` / `opacity`**（都不参与布局）⇒ 折叠卡外框尺寸一字不变
       （#500 铁律：外尺寸必须与普通卡完全一致，⛔ 别在这里碰 width/height/top/left）。
       ⚠️ 只作用于**其余层**（`.rl-cov-stack-extra`）：主封面是门面，不该跟着一起动。 */

    /* ⑴ 入场：这叠「抽出来」——其余层从**主封面附近**滑到自己该在的错位处，依次错开 45ms。
       ⚠️ 方向 = 错位的**反方向**：它们本来的位置由 `top/left: si × step` 决定，
          所以起点要减掉同样的量（`translate(-si×step×系数, …)`）⇒ 视觉上是从主封面里「抽出来」。
       ⚠️ `backwards` 是必需的：延迟期间要停在起点（否则会先出现在终点、到点再跳回起点重播）。

       🔴🔴 #511 用户裁定（2026-10-04，起点**不许与主封面完全重合**）：
       #510 首版起点写的是 `× -1`（退掉**全部**错位量）+ `opacity: 0` ⇒ 其余层在延迟期间
       **与主封面 100% 重叠**，加上每层 45ms 错峰（最外层 135ms 才起步）⇒ 卡片进视口后
       **前约 475ms 看上去就是「一张封面带重影」，然后突然炸成 4 张**；一屏十几张折叠卡
       同时进视口 ⇒ **整墙跳一下**（实测截图 `_shot/ml510-freeze.png` 定格 120ms 就是那个样子）。
       ⇒ 起点改成**只退掉 1/3 错位量**（系数 `-0.34`）且 `opacity: .4`：
          任何时刻都看得出是「一叠」，⛔ 不再出现「先是一张、随后炸开」的跳变。
       ⚠️ 系数 `-0.34` 是 1/3 的余数（步长是 px 小数，0.33 会让 9px 步长退成 2.97px，
          与 hover 散开的 3px 撞成同一个值 ⇒ 两条动效在视觉上分不开）；别随手改成 `-0.33`。
       ⚠️ 错峰 45ms **保留**：起点不再重合之后它只贡献「依次抽出来」的层次，不再造成重影。 */
    @keyframes rl-stk-in {
        from {
            transform: translate(calc(var(--si, 0) * var(--rl-stk-step) * -0.34), calc(var(--si, 0) * var(--rl-stk-step) * -0.34));
            opacity: .4;
        }
        to { transform: translate(0, 0); opacity: 1; }
    }
    .rl-series-card .rl-cov-stack-extra {
        animation: rl-stk-in .34s cubic-bezier(.2, .7, .3, 1) backwards;
        animation-delay: calc(var(--si, 0) * 45ms);
    }
    /* 🔴 #513 用户裁定（2026-10-04）：**悬停 / 聚焦的「整叠再散开」整条删除**，只留入场那一条。
       为什么连带把 `transition: transform .18s ease` 也删了：它的**唯一消费者就是这条悬停规则**
       （`transform` 的过渡在静止态毫无意义）⇒ 留着就是一条**死样式**，
       而死样式会被 esbuild 报成 `Unused CSS` 警告 ⇒ **破坏「89 warnings = 基线」这条门禁**。
       ⚠️ 别只删规则体留着 transition（也不必留着 `animation` 里的 `backwards` —— 那个是入场动画的，
       它仍需要，`animation-delay` 的错峰也仍需要）。
       ⚠️ 「入场」与「悬停」是**两条独立动效**（见上面 ⑴ 与这里的 ⑵），删 ⑵ 不许碰 ⑴。 */
    /* ⚠️ 尊重系统「减少动效」：入场动画关掉（本仓 spinner 同款纪律） */
    @media (prefers-reduced-motion: reduce) {
        .rl-series-card .rl-cov-stack-extra { animation: none; }
    }
    /* ⚠️ #434~#437 这里还有一枚常显的「只看这一系列」角标；#438 起**位置让给播放/阅读按钮**
       （用户点名「右下角加个播放/阅读按钮」），那句话搬到了操作面板底部的入口里。
       ⛔ 别再往封面右下角叠第二枚常显角标 —— 那个位置现在归 `.rl-series-play`。 */
    /* 🔴 折叠卡上的状态徽标是**只读**的（#438 次日补，用户「系列折叠卡怎么没有标签状态显示的如想看存档之类的」）：
       与普通卡**同款 markup / 同款配色 / 同一行位置**，但它显示的是**组**的状态 ⇒
       点一下「改成什么」没有唯一答案（组里 N 条状态可能各不相同）⇒ 这里把可点的手势去掉。
       ⛔ 别顺手给它挂 `toggleMenu`（那是单条语义，会把整组的状态改乱）。 */
    .rl-series-card .rl-badge { cursor: default; }
    /* 🔴 #504 这里原有的四条 `.rl-series-card …{padding/line-height}` **已整块删除**：
       它们是 #503② 为「信息行并成一行」补重心的（用户：「为平衡少一行的视觉效果给增加行高与间距」），
       #503② 的信息行合并已被用户判回 ⇒ 补重心失去对象。**行数与普通卡一致 = 结构性齐平**，
       ⛔ 别再用 padding / line-height 去「补」任何东西（那只会让折叠卡与普通卡错开）。 */

    /* 系列视图指示条（#444 从 #437 的**网格组头搬进筛选栏**）：
       🔴 三态共用一条（海报墙 / 列表 / 瀑布流都在同一处告诉用户「现在只看哪个系列 + 回去的路」）——
          #437 那版组头长在 `.rl-grid` 里（`grid-column: 1 / -1`），列表 / 瀑布流里**根本渲染不出来**，
          而 #444 起系列视图三态通吃 ⇒ 组头必须搬到网格之外。
       ⚠️ 搬迁同时把 `grid-column` 与 `margin: 4px 0 -4px`（网格内的贴边补偿）一并撤掉。 */
    .rl-series-bar { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rl-series-bar-name { font-size: 12.5px; font-weight: 600; color: var(--text-normal); white-space: nowrap; }
    .rl-series-bar-cnt { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
    /* 「返回全部」= 与工具栏其它小控件同语言（并排按钮 hover 只变色，⛔ 不铺底 —— 本仓既定口径） */
    .rl-series-bar-back {
        font-family: inherit; font-size: 11.5px; padding: 1px 8px; cursor: pointer;
        border: 1px solid var(--background-modifier-border); background: var(--background-primary);
        color: var(--text-muted); border-radius: var(--rl-t-radius-pill, 999px);
    }
    .rl-series-bar-back:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    /* Hover 快速操作（阶段6）：封面遮罩，默认透明；「打开笔记 ↗」文字按钮居中、⋯ 更多右上 */
    .rl-cov-wrap { position: relative; }
    .rl-cov-hover {
        position: absolute; inset: 0; z-index: 6;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .38);
        opacity: 0; transition: opacity .18s ease;
    }
    .rl-card:hover .rl-cov-hover, .rl-card:focus-within .rl-cov-hover { opacity: 1; }
    /* 大众评分角标（用户 2026-09-22）：封面**右上角**常显，hover / 聚焦封面时淡出。
       — 位置：`top/right: 6px`，比 ⋯ 更多按钮（8px）略靠外一档，但两者不同时出现（角标淡出后遮罩才亮）。
       — 配色：深色半透明胶囊 + **来源名白 / 数值暖黄**（🔴 #564 回摆，见下方那段）。
       — `white-space: nowrap`：角标只有「来源 + 数值★」这几个字符，⛔ 绝不允许换行。
       — `max-width: calc(100% - 12px)` + 省略号：卡片窄于内容时（窄侧栏 / 极端分屏）角标不越出封面，
         而是在自己的深底胶囊里收成「…」；⛔ 别靠 `.rl-card { overflow: hidden }` 硬裁（那会把胶囊右半截切掉）。
       — 两段层级（2026-09-22 起）：来源名 `.rl-cov-src` 弱化（白 .78），**数值暖黄** ⇒ 扫读时数字是锚点，
         且「评分」这个语义靠颜色就说清了（与 `×N` 的白字数量角标各表各的事）。
       — z-index 5 < 遮罩 6：即使淡出动画没跑完，也被遮罩压住，不会浮在按钮上。 */
    /* 🔴 #557（用户 2026-10-08）**异构卡角标统一**：折叠卡的 `×N`（数量）与普通卡的「来源 8.3★」（评分）
       是同一格海报墙里**并排出现**的两种角标 —— 此前它们在**配色**（类型色描边）与
       **尺寸**（11.5px vs 10px、4×9 vs 3×6）上各走各的，同框看就是「两种东西」。
       用户裁定：**一律深色半透明底 + 完全相同的圆角与内距**（`.rl-series-cnt` 逐字同款）。
       ⚠️ 尺寸取**较大那一档**（11.5px / 4px 9px）：两枚角标现在是同一种视觉，缩到 10px 会让折叠卡的
          「有几部」一起变轻，而它正是折叠卡最该被一眼看到的信息（#500⑤ 的初衷）。
       🔴 **#564 回摆（用户 2026-10-08 二轮：「海报墙豆瓣 8.3★ 样式返回到原来 8.3 不同颜色状态」）**：
          上一轮连**数值颜色**也一并改成了纯白，用户看过之后要**数值的暖黄回来** ⇒
          统一的部分**保留**（深底 / 圆角 / 内距 / 字号两枚逐字同款），只把**数值色**还原成 `#ffd76b`。
          ⇒ 结论写进口径：**「统一」指的是容器与几何，不是把语义色也抹平** ——
             `×N`（数量，白）与 `8.3★`（评分，暖黄）本来就该一眼分得开。
       ⚠️ 与左下角 `.rl-cov-playtime` 是**另一件事**（那个是时长，位置/语义都不同），⛔ 别顺手一起改。
       — z-index 5 < 遮罩 6：即使淡出动画没跑完，也被遮罩压住，不会浮在按钮上。 */
    .rl-cov-score {
        position: absolute; top: 6px; right: 6px; z-index: 5;
        background: rgba(0, 0, 0, .6); color: #ffd76b;
        font-size: 11.5px; font-weight: 700; line-height: 1;
        padding: 4px 9px; border-radius: var(--rl-t-radius-pill, 999px);
        white-space: nowrap; transition: opacity .15s ease;
        max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis;
    }
    /* 角标里的数据源名（用户 2026-09-22：「要显示数据源」）—— 弱化一档，让暖黄数值仍是第一眼目标。
       间距走 `margin-right`，⛔ 不在模板里写空格文本节点（Svelte 会裁掉相邻标签间的空白，间距会时有时无）。
       ⚠️ #564：来源名保持白 .78 —— 与数值的暖黄**同时**提供层级（明度 + 色相两道），
          这就是用户说的「原来 8.3 不同颜色」那套。 */
    .rl-cov-src { color: rgba(255, 255, 255, .78); font-weight: 600; margin-right: 4px; }
    .rl-card:hover .rl-cov-score, .rl-card:focus-within .rl-cov-score { opacity: 0; }
    /* ── 🔴 #558 封面底部悬浮区（`.rl-cov-foot`）────────────────────────────────
       用户 2026-10-08：「把底部的进度信息（0%、进度条、0/14页）**移到封面图的最底部、悬浮覆盖在封面上**」＋
       「第一行（序号① 和 已读 2h 并排）是**动态可选**的…第二行（0% + 进度条 + 0/14页）固定且必须单行铺满」。
       ⇒ 一个绝对定位的底部容器，内部两行；**渐变遮罩**由 `::before` 提供。
       🔴 **无数据降级**：第一行两件都没有时模板**整行不渲染**（⛔ 不留空占位行）⇒ 容器只剩进度条那一行，
          `padding-top` 不动、`padding-bottom` 贴底 ⇒ 条**直接贴底**（用户点名的降级形态）。
       ⚠️ `pointer-events: none`：整块是**展示层**，点击要穿到卡片本体（打开笔记）——
          与原来两枚角标同口径，⛔ 别让它吃掉点击（尤其别挡住右下角的动作圆钮）。
       ⚠️ `z-index: 5` < hover 遮罩 6：hover 时被压住，⛔ 不许浮在「打开笔记 / ⋯」之上。 */
    .rl-cov-foot {
        position: absolute; left: 0; right: 0; bottom: 0; z-index: 5;
        display: flex; flex-direction: column; gap: 4px;
        padding: 16px 8px 6px;
        pointer-events: none;
    }
    /* 半透明黑**渐变**遮罩（⛔ 不是实底 —— 封面下半部分仍要看得见，只是把文字托起来）。
       ⚠️ 负 z-index 落在 `.rl-cov-foot` 自己的层叠上下文里（它有 z-index ⇒ 自成上下文）
          ⇒ 恰好垫在内容之下、封面之上。 */
    .rl-cov-foot::before {
        content: ''; position: absolute; inset: 0; z-index: -1;
        background: linear-gradient(to top, rgba(0, 0, 0, .74), rgba(0, 0, 0, .34) 58%, rgba(0, 0, 0, 0));
    }
    /* 第一行（可选）：序号 + 时长 —— 🔴 「永远左对齐、中间留固定间距」（用户点名）。
       ⚠️ 用 `justify-content: flex-start`（⛔ 不写 `margin-left:auto`：那会把它们推到右边）。 */
    .rl-cov-foot-top { display: flex; align-items: center; justify-content: flex-start; gap: 6px; }
    /* 🔴 #558：这两枚从「封面左下角两个**绝对定位**角标」改成**同一行里的 flex 子项** ——
       位置由 `.rl-cov-foot-top` 统一给（左对齐 + 固定 6px 间距），⛔ 别再各自写 `absolute`。
       ⚠️ 胶囊几何**保持不变**（10px / 700 / 3px 6px / 胶囊圆角 / 黑底白字）—— 用户「不要改风格」。
       🔴 #471 的由来不变：游戏时长从元信息区搬到封面；
       🔴 #537 的「同一个类」不变：书籍「已读 Nh」仍复用这枚类名（⛔ 别新造）。 */
    .rl-cov-playtime, .rl-cov-series-no {
        position: static;
        background: rgba(0, 0, 0, .6); color: rgba(255, 255, 255, .92);
        font-size: 10px; font-weight: 700; line-height: 1;
        padding: 3px 6px; border-radius: var(--rl-t-radius-pill, 999px);
        white-space: nowrap; pointer-events: none;
        max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis;
    }
    /* 🔴 #530 系列序号角标（**只在系列视图内**渲染，见模板 `seriesNo`）：
       几何与 `.rl-cov-playtime` **同一条规则**（上面那条合并选择器），⛔ 别在这里再写第二份尺寸。
       🔴🔴 #558（用户 2026-10-08「封面底部的信息排布」）：它现在与时长**并排成一行**
       （`.rl-cov-foot-top`：左对齐 + 固定 6px 间距）—— 原先那套「同角两个绝对定位角标、
       有已玩时把序号顶上去 26px」的避让逻辑（`:has()` 覆写 `bottom`）**整体退场**：
       两枚现在是 flex 兄弟，横向排开，**再没有重叠可言**。
       ⛔ 别把 `position: absolute` 写回来（会同时破坏左对齐与固定间距两条用户口径）。 */
    /* 瀑布流视图：只展示封面的多列流（列内卡片等高，列间自然参差） */
    .rl-masonry { display: flex; gap: 8px; align-items: flex-start; }
    .rl-m-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .rl-m-card { position: relative; border-radius: var(--rl-t-radius-md, 6px); overflow: hidden; cursor: pointer; }
    .rl-m-card:hover { box-shadow: var(--rl-t-shadow-card-hover, 0 2px 8px rgba(0, 0, 0, .16)); transform: translateY(var(--rl-t-lift, 0px)) scale(var(--rl-t-scale, 1)); }
    /* 🔴🔴 #624 瀑布流封面 = **等宽不等高**（翻面 #623 的「恒定 2:3」；用户 2026-10-13：
       「瀑布流视图改成等宽不等高」）。两档分工 —— 缺任何一档都会退化：
         · 默认（加载**前**）：`aspect-ratio: 2/3` ＋ `object-fit: cover` = **占位比例**。
           没有它，未解码的图没有固有尺寸 ⇒ 高度算成 **0**、卡片整块塌成一条
           （#623 实测：空 src 高 0、16:9 只 123.2，而正常 2:3 是 328.5；列宽 294.7 三列一致 ⇒ 问题只在高度）。
         · `is-loaded`（`on:load` 之后，见组件里的 `loadedCovers`）：`aspect-ratio: auto` ⇒
           交回**图片固有比例** ⇒ 横版更矮、竖版更高、列间自然参差 —— 这才是瀑布流本来的样子。
       ⚠️ 少一条都不行：删 `is-loaded` 那条 ⇒ 退回 #623 的等高卡片（名不副实）；
          删默认那条 ⇒ 退回「未加载 = 塌成一条」的老 bug。
       ⚠️ `background` 是加载期的底色（与 `.rl-cov` 同款），⛔ 别省 —— 省了就是一块透明洞。 */
    .rl-m-cov { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; background: var(--background-secondary); border-radius: var(--rl-t-radius-md, 6px); }
    .rl-m-cov.is-loaded { aspect-ratio: auto; object-fit: fill; }
    .rl-m-ph {
        aspect-ratio: 2 / 3; width: 100%; border-radius: var(--rl-t-radius-md, 6px);
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--tc) 18%, var(--background-secondary));
        color: var(--tc); font-size: 22px; font-weight: 500;
    }
    /* 默认纯封面；hover 才浮出标题/评分/年份（底部渐变托底 + 底部对齐） */
    .rl-m-overlay {
        position: absolute; inset: 0; border-radius: var(--rl-t-radius-md, 6px);
        display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
        padding-bottom: 6px;
        background: linear-gradient(0deg, rgba(0, 0, 0, .8), rgba(0, 0, 0, .3) 55%, transparent);
        opacity: 0; transition: opacity .15s ease;
    }
    .rl-m-card:hover .rl-m-overlay { opacity: 1; }
    .rl-m-title { color: #fff; font-size: 12px; font-weight: 500; padding: 0 8px; text-align: center; line-height: 1.4; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-m-meta { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
    .rl-m-yr { color: rgba(255, 255, 255, .82); font-size: 10px; }
    .rl-m-dot { color: rgba(255, 255, 255, .5); font-size: 10px; }
    .rl-m-sc { color: #ffd76b; font-size: 10px; font-weight: 600; }
    /* 观看按钮：封面右下角圆形，hover 浮现（z-index 高于 hover 遮罩层）；直达观看语义 */
    .rl-watch-btn {
        position: absolute; right: 8px; bottom: 8px; z-index: 7;
        width: 32px; height: 32px; border-radius: 50%;
        border: none; cursor: pointer;
        background: var(--interactive-accent); color: #fff;
        font-size: 13px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
        opacity: 0; transition: opacity .18s ease, transform .15s ease;
    }
    /* ▶ 播放三角形的视觉重心偏左 → 仅播放类图标补 2px 左内距；
       书籍（book-open）等本身居中的图标不加，否则图标右偏（用户 2026-09-15 报「阅读按钮图标不居中」） */
    .rl-watch-btn.rl-watch-play { padding-left: 2px; }
    .rl-card:hover .rl-watch-btn, .rl-card:focus-within .rl-watch-btn { opacity: 1; }
    .rl-watch-btn:hover { transform: scale(1.12); }
    /* 🔴🔴 #628 翻面 #626 ⑴（用户原话：「海报墙和卡片网格视图的打开笔记按钮改成鼠标悬停显示的，UI 就像
       去除了胶囊按钮的框就只有文字那样，悬停不变色只出现」）——这枚按钮从「黑底胶囊 + hover 变主题色/放大」
       改成**纯文字**：
         · **去框**：`background: transparent` / `border-radius: 0`（原来是 rgba(0,0,0,.55) 的胶囊）；
         · **无 hover 反馈**：从前的 `:hover { background: accent; transform: scale(1.12) }` **整条删除**
           —— 「悬停不变色，只出现」，而「出现」这件事由外层遮罩的 `opacity` 负责（不是这枚按钮的职责）。
       ⚠️ 可读性靠**外层遮罩**（`.rl-cov-hover` 的 rgba(0,0,0,.38)）而不是自家底色 ——
          这正是用户裁定「遮罩保留」的前提（⛔ 别为了「更干净」顺手把遮罩也撤了：深色海报上白字会读不出来）。
       ⚠️ `padding` **保留**：它不参与视觉（底色已透明），只当**点击热区** —— 去掉就只剩 12px 高的文字盒。
       ⚠️ `:focus-visible` 描边保留：按钮仍可 Tab 聚焦，键盘用户不能没有落点反馈
          （模板里 `ev.currentTarget.blur()` 只清鼠标点击后的残留焦点，不影响 Tab 进入）。 */
    .rl-hover-open {
        font-family: inherit; font-size: 12px; font-weight: 600;
        border: none; cursor: pointer; box-shadow: none; background: transparent; color: #fff;
        border-radius: 0; padding: 7px 14px; line-height: 1;
    }
    .rl-hover-open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .rl-hover-more {
        position: absolute; top: 8px; right: 8px;
        width: 26px; height: 26px; border-radius: var(--rl-t-radius-md, 6px);
        border: none; cursor: pointer; background: rgba(0, 0, 0, .55); color: #fff;
        font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center;
        transition: background .15s ease;
    }
    .rl-hover-more:hover { background: var(--interactive-accent); }
    .rl-cov { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--background-secondary); flex-shrink: 0; }
    .rl-cov-ph { display: flex; align-items: flex-end; justify-content: flex-start; padding: 6px; font-size: 12px; color: #fff; background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph:not([style*="--tc"]) { background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph[style*="--tc"] { background: var(--tc); }
    /* 列表视图操作栏（🔴 #590 翻面「带圆角边框的两枚图标」）：**纯线条图标 + 去边框**——
       默认浅灰（`--text-faint`），**悬停整行或指到图标本身**时变主题色；指到图标再补一层浅圆底。
       用户原话：「统一替换为 Obsidian 原生图标（或纯线条图标），去掉边框。默认状态为浅灰色，
       鼠标悬停在行或图标上时再变为主题色/出现浅色圆形背景」。
       ⛔ 编辑与观看两枚**同款**（原来观看那枚 hover 会铺主题底白字 —— 那正是「两枚不像一家」的来源）。 */
    .rl-edit-row {
        display: inline-flex; align-items: center; justify-content: center;
        width: 24px; height: 24px; padding: 0; line-height: 1; vertical-align: middle;
        border: none; background: transparent; color: var(--text-faint);
        border-radius: 50%; cursor: pointer; font-size: 12px;
        transition: color .15s ease, background .15s ease;
    }
    /* 🔴🔴 #595：操作列两枚图标的**横向排列**容器（用户：「这右侧控件改成横向排列」）——
       原来是两个行内盒（`inline-flex`）直接躺在格子里，格子一窄就**自动换行**成上下两排
       （窄屏实测那两枚会叠起来）。`flex` + `nowrap` 是硬保证：⛔ 别退回行内盒。
       `margin-left` 间距一并收进 `gap`（⛔ 别再写第二条 `+ .rl-edit-row { margin-left }`，会叠成 4px）。 */
    /* 🔴 #595 起这两枚图标恒**横向**（`flex` 不被行内盒的换行规则左右）；
       🔴 #598 起由「贴行右缘」（`flex-end`）改成**居中** —— 与上面居中的表头「操作」同侧，
       否则 8% 的窄列里表头与图标会错开半个格子。 */
    .rl-ops-row { display: flex; align-items: center; justify-content: center; gap: 2px; }
    .rl-table tr:hover .rl-edit-row { color: var(--interactive-accent); }
    .rl-edit-row:hover { background: var(--background-modifier-hover); color: var(--interactive-accent); }
    .rl-edit-row:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    /* meta 用 flex 1 撑满卡片剩余空间；min-height 让进度行即便短/为空也能与同行卡片等高。
       🔴 #627：这 74px 是给**普通卡那 0~5 行信息栏**用的 —— **海报墙只剩一行标题**，
          那 74px 会变成标题下的纯白留白（实测 54.5px，用户截图报障「就一行标题怎么空几行」）
          ⇒ `.rl-wall .rl-card-meta` 把 min-height 归零（见 `.rl-wall` 那组）。
          ⛔ 别在这里删/改这条 —— 普通卡的同排等高全靠它。 */
    .rl-card-meta { padding: 7px 8px; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 74px; }
    /* 🔴 #640 ⑷：**补位空行** —— 信息区行数按条目类型各配一份（#617）⇒ 混类型视图里
       行数少的卡片比同行矮一截（底部对不齐）。补齐到「这一屏最大的行数」后，
       多出来的那一行就是这个空 div —— 它只提供**高度**（与真行同款的行高/外边距），
       ⛔ 不含任何文字（填「—」会伪装成一个真实存在的空字段）。
       ⚠️ 与 `.rl-sub` 同行高（`font-size` 相同 ⇒ `line-height` 相同）才能对齐；
          这里显式给 `line-height` 以防某个主题改了默认值。 */
    .rl-pad-row { line-height: 1.4; }
    /* 视觉层级（阶段3+6）：标题 → 原名·年份 → 创作者 → 标签 → 进度 → 状态+评分 */
    .rl-ttl { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-creator { font-size: 10px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* 标签行（阶段6：前 2 个标签，知识库感；多标签 title 显示全量） */
    .rl-tags {
        font-size: 10px; color: var(--text-faint); margin-top: 3px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* 卡片元信息行：只有「状态徽标 + 我的星」两项（大众评分已搬到封面右上角，用户 2026-09-22）。
       `flex-wrap: wrap` + 子项各自 nowrap 保留 —— 窄卡（紧凑档）下宁可**整项换行**，也不许把
       「存档」这类徽标文字压成竖排（#369 跟修实测：卡宽 152 时徽标高 26px = 两行）。
       🔴 我的星**紧跟徽标右侧**（用户 2026-09-22「把个人评分放到观看状态右旁边」⇒ 已撤掉
       原先那条 `.rl-row1 .rl-my-inline { margin-left: auto }`）。两者间距 = 本行 `gap: 6px`。
       ⛔ 别再给 `.rl-my-inline` 加 auto 边距、也别把本行改成 `justify-content: space-between`
       —— 那会把两颗元素推成「分踞两端」，正是这次要去掉的观感。 */
    .rl-row1 { display: flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap; row-gap: 3px; }
    .rl-row2 { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 3px; }
    /* 书籍进度：百分比 + 绿色进度条 + 页数（页数在条右侧） */
    .rl-read-pages { font-size: 9px; color: var(--text-faint); flex: none; white-space: nowrap; }
    /* 状态徽标样式并入全局 styles.css .rl-badge（唯一实现，四色变量见 styles 文件头） */
    /* 大众评分样式已搬到封面角标 `.rl-cov-score`（用户 2026-09-22）——原来的 `.rl-score` 随模板一并退场，
       ⛔ 别在这里复活它（这一行已经没有第三个元素了）。 */
    /* 我的评分（阶段6：有评分才显示，前缀「我的评分」区分大众分；未评分不占位） */
    .rl-mystars { font-size: 9px; letter-spacing: .3px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .rl-my-label { font-size: 9px; color: var(--text-faint); }
    /* 星级热度分档：≥4 金 / 1~3 灰 / 未评分淡灰 */
    /* 🔴 #619 半星（用户 2026-10-13 截图报障）：星**一律不用字符**渲染 ——
       原来走 `starString()` 的半星字符 U+2BE8字体覆盖极差，在海报墙上渲染成**残缺星形碎块**。
       现在恒排 **5 个满星**，用 `--fill`（= rating 值）+ background-clip 按 **rating/5** 裁切填充：
       4.5 星 = 填到 90%，且**任何字体 / 主题下形状都一致**（与编辑表单里的星同一套观感）。
       ⚠️ `--fill` 由模板内联给出；图形本身 `aria-hidden`，真值走相邻的 `.rl-sr`。 */
    .rl-my-inline {
        font-size: 12px; white-space: nowrap; line-height: 1;
        background: linear-gradient(90deg, var(--rl-score) calc(var(--fill) * 20%), var(--rl-score-none) 0);
        -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    /* 列表视图的星：保留原来的三档着色（用 `--c` 间接，逐档只改一个变量），裁切同上 */
    .rl-stars {
        font-size: 9px; letter-spacing: .5px;
        background: linear-gradient(90deg, var(--c, var(--rl-score-none)) calc(var(--fill) * 20%), var(--rl-score-none) 0);
        -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    .rl-stars-hot { --c: var(--rl-score); }
    .rl-stars-mid { --c: var(--rl-score-mid); }
    .rl-stars-none { --c: var(--rl-score-none); }
    /* （`.rl-prog` / `.rl-prog-na` 已随 **#471「游戏时长搬到封面左下角角标」整体退场** ——
       它俩唯一的使用点就是游戏进度行与它的「-」空值占位，模板那一块已撤。
       要加回来需**同时**补回模板里的行，⛔ 只补样式不补模板 = 死规则。） */
    /* （`.rl-ex-cnt` 摘抄计数徽标样式已随 2026-09-21「海报墙书籍条目不要显示摘抄数量」整体退场；
       要加回来需**同时**补回 MediaList 海报墙分支里的徽标行，⛔ 只补样式不补模板 = 死规则。） */
    /* ── #552 阅读进度行：**百分比 + 条 + N/M 页 并排**（撤销 #549③ 那次「条搬去封面底边」）──
       用户上手后裁定：「把条和数字和百分比**并排**显示，就像原来那样」（封面底边那条 4px 通栏
       压在深色海报上根本读不出来）。
       ⚠️ 条走下面那条 `.rl-readbar`：`flex: 1 1 auto` 自动吃掉中间那段 ⇒「93% ▬▬▬▬ 13/14 页」
          天然并排，⛔ 本行不需要再给条写任何尺寸。
       ⚠️ `.rl-readbar` / `.rl-readbar-fill` 同时被**列表进度列**（`.rl-readbar-inline`）与表单预览条
          使用 ⇒ 三处共用同一根条，改它的样式要一起看（这正是本节**没有**另立一根条的原因）。 */
    /* 🔴 #558：这一行现在长在**封面底部悬浮区**里（`.rl-cov-foot`）——
       `margin-top` 交给 `.rl-cov-foot` 的 `gap: 4px`（⛔ 别在这里再写一份，会双倍）。 */
    .rl-readrow { display: flex; align-items: center; gap: 6px; }
    .rl-read-pct { font-size: 9px; line-height: 1; color: var(--text-faint); flex: none; }
    /* 阅读进度条：仅已开始的书渲染（未开始无灰线，避免像未加载占位符）；填充色更有存在感 */
    .rl-readbar { height: 4px; flex: 1 1 auto; background: var(--background-modifier-border); border-radius: var(--rl-t-radius-pill, 999px); overflow: hidden; }
    .rl-readbar-fill { height: 100%; background: var(--rl-good-bar); border-radius: var(--rl-t-radius-pill, 999px); transition: width .3s ease; }
    /* 🔴 #558 悬浮区里的配色覆写：原色 `--text-faint` / `--background-modifier-border` 是为**浅底**挑的，
       压在黑遮罩上会消失 ⇒ **只在这一层**换成白字 + 半透明白轨道。
       ⛔ 别全局改这两条：`.rl-readbar` 还被**列表进度列**（`.rl-readbar-inline`）与表单预览条共用；
       ⚠️ **填充色不动**（`--rl-good-bar` 绿条 + 4px 粗细 + 胶囊圆角）—— 用户「不要改风格」。 */
    .rl-cov-foot .rl-read-pct, .rl-cov-foot .rl-read-pages { color: rgba(255, 255, 255, .92); }
    .rl-cov-foot .rl-readbar { background: rgba(255, 255, 255, .3); }
    .rl-menu { position: absolute; top: 100%; left: 6px; margin-top: 4px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu, 0 4px 14px rgba(0, 0, 0, .15)); padding: 4px; z-index: 30; min-width: 110px; }
    .rl-menu button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 5px 10px; border: none; background: transparent; color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer; font-family: inherit; }
    .rl-menu button:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-menu button.rl-sel { font-weight: 600; color: var(--interactive-accent); }
    .rl-menu button.rl-illegal { opacity: .35; cursor: not-allowed; }
    /* 右键菜单：anchor 容器相对定位，菜单 absolute 贴鼠标（避开 Obsidian transform 祖先使 fixed 偏移的问题）
       z-index + isolation：grid 卡片 overflow:hidden+relative+背景组合被 Chromium 视为独立 stacking context，
       曾盖住菜单（2026-09-09 修复）——anchor 提 z-index 并强制独立层，菜单整体跳出卡片层级 */
    .rl-ctx-anchor { position: relative; z-index: 50; isolation: isolate; }
    .rl-ctx {
        position: absolute; z-index: 100; min-width: 140px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu-strong, 0 4px 14px rgba(0, 0, 0, .18)); padding: 4px;
        /* 视口过矮/过窄时内联 max-height/max-width 生效 → 菜单内部滚动，不整块越界 */
        overflow: auto; overscroll-behavior: contain;
    }
    /* 🔴 2026-10-21（用户：「去掉每个菜单项的独立边框，改成**平铺的列表项**（像 Obsidian 原生的右键菜单那样）」）：
       那圈「独立边框」**从来不是 `border`**（下面这行早就写了 `border: none`），是核心给裸 `button` 的
       `box-shadow: var(--input-shadow)`（亮色主题第一段 = `inset 0 0 0 1px rgba(0,0,0,.12)`，即 1px 内描边环）。
       ⚠️ 本 `<style>` 是 Svelte 作用域样式，选择器落地为 `.rl-ctx button.svelte-xxxx`（0,2,1）⇒ 稳赢核心 (0,1,1)，
         ⛔ 不用 `!important`。 */
    .rl-ctx button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 6px 10px; border: none; box-shadow: none; background: transparent; color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer; font-family: inherit; }
    /* 🔴 2026-10-21（用户：「用细灰线（分割线）把菜单分成 **3 组**」）——
       分组是**内容层级**（主操作/关联 → 编辑与补录 → 删除），所以分隔线写在模板里按分支插，
       ⛔ 别用 `:nth-child` 钉死（类型不同菜单项数不同，钉死必错位）。 */
    .rl-ctx-sep { height: 1px; margin: 4px 0; background: var(--background-modifier-border); }
    .rl-ctx button:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-ctx .rl-ctx-danger { color: var(--rl-danger-strong); }
    .rl-ctx .rl-ctx-danger:hover { background: var(--rl-danger-strong); color: #fff; }

    /* 空状态（1.0.4）：两种形态共用一套外壳 —— no-data 只有标题，no-match 多一行条件回显 + 清除按钮 */
    .rl-empty {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        text-align: center; color: var(--text-faint); padding: 40px 0; font-size: 13px;
    }
    .rl-empty-title { color: var(--text-muted); }
    .rl-empty-hint { font-size: 11px; }
    .rl-empty-act { font-family: inherit; font-size: 12px; margin-top: 4px; }
    /* 表格里的空态：整行单元格不该表现成可点行 */
    .rl-empty-row td { cursor: default; }
    /* 🔴 #590：`table-layout: fixed` —— 列宽由上面的 `colgroup` 钉死。
       🔴🔴 #595：列宽改**百分比**（八列都给宽，标题列封顶 39%）⇒ 整行恒撑满、富余宽度按比例分给各列。
       `min-width` 兜底：容器过窄时整表横向滚动，⛔ 不把状态列挤成两行。
       ⚠️ 780px 是「操作列仍容得下横向两枚 24px 图标」的下限（改列宽/图标尺寸就要一起复核）。 */
    /* 🔴 #621：`min-width` **不再写死** —— 列数可变 ⇒ 由模板内联 `style={min-width:...px}` 逐表给（见 `tableMinWidth`）。
       🔴 #668：`position: relative` 是**拖宽竖线拉满整列**的定位上下文（见 `.rl-tbl-resize`）——
       ⛔ 删掉它，手柄就会退回「只有表头那么高」（因为定位祖先会变成 `<th>`）。
       ⚠️ 表格成为定位上下文后，`th` 里其它绝对定位元素（如列宽手柄）不受影响：`th` 自己仍是 `relative`。 */
    .rl-table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; position: relative; }
    /* 🔴 #598（用户 2026-10-10）：「**列表视图表头文字要居中对齐**」—— 表头由 `text-align: left`
       改成 **center**（`#590` 起一直是左对齐）。
       ⚠️ 只动**表头**：单元格内容（年份 / 状态 / 评分 / 进度）仍是左对齐 —— 那几列的值长短不一，
       一起居中反而看不出列的边界（用户只说表头）。
       ⚠️ 操作列是唯一的例外：它表头居中、图标也居中（见下 `.rl-ops-row`）——
       8% 的窄列里「表头居中 + 图标贴右」会错开半个格子，看着像没对齐。 */
    .rl-table th { text-align: center; padding: 5px 6px; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* ⚠️ #621 起 `td` **不再**是 `cursor: pointer`（原来点整行开条目）—— 现在点格子是「改这一格」，
       光标交给里面那个可编辑格（`.rl-tbl-cell` = `cursor: text`；只读格 `.rl-tbl-ro` = 默认箭头）。 */
    .rl-table td { padding: 5px 6px; border-bottom: 1px solid var(--background-modifier-border); overflow: hidden; }
    /* 🔴 #668（用户：「统一给我居中啊，**除标题外**不居中」）：上面的 `text-align: center` 落在
       `.rl-tbl-cell` 上，而**标题格里的文字不是 `.rl-tbl-cell`**（是 `.rl-row-link` / 合集名），
       会去继承 `td` 的对齐 ⇒ 标题也被居中了。这里把标题列**显式钉回左对齐**。
       ⚠️ 必须作用在 `td` 上（继承源），⛔ 只给 `.rl-row-link` 写不行：同一个标题格里还有副标题/徽标/合集名。 */
    .rl-table td.rl-col-title { text-align: left; }
    /* 🔴 #668 系列合集行的**状态徽标**居中：`.rl-badge` 是 `inline-flex`（行内级），
       `text-align: center` 只把它摆到格子的水平中间，**垂直**方向仍贴基线 ⇒ 与条目行里那枚
       「上下居中」的徽标高度对不齐。这里用 flex 把徽标在格子里真正居中（水平 + 垂直）。 */
    .rl-tbl-series-cell { display: flex; align-items: center; justify-content: center; }
    /* 行首勾选列（居中；宽度交给 colgroup 的 `.rl-col-w-cb`，⛔ 这里别再写第二份 width） */
    .rl-col-cb { text-align: center; }
    /* 🔴🔴 列宽：`cb` / `ops` 两列走**固定百分比**（不参与拖动分配），其余列由 `colViews` 逐列给宽。
       ⚠️ 这三个数必须与 script 里的 `CB_PCT` / `OPS_PCT` 一致（`FLEX_PCT = 100 − 5 − 7 = 88`）——
          对不上就会出现「所有列加起来不是 100%」的静默偏差。 */
    /* 🔴🔴 #684：勾选列 / 操作列改成**固定像素宽**（原来是 5% / 7% 百分比）。
       百分比在窄屏会跟着缩（勾选框挤成一团），在宽屏又浪费（操作列白占 7%）；
       而 `buildColViews` 的预算算式 `availPx − CB_W − OPS_W − TITLE_MIN_PX` 里用的就是这两个 px 值
       —— 两边必须一致，⛔ 别一边写 px 一边写 %（本仓 #446 因为这类双真源栽过）。 */
    .rl-table .rl-col-w-cb { width: 60px; }
    .rl-table .rl-col-w-ops { width: 84px; }
    /* 操作列：左右内距收窄（图标贴右缘即可）⇒ 窄屏下也够放**横向**两枚（见 `.rl-ops-row`） */
    .rl-table .rl-col-ops { padding-left: 4px; padding-right: 4px; }

    /* ══ 1.3.1 ②（#621）可编辑表格 ══════════════════════════════════════════ */
    /* 表宽下限由内联 `min-width` 给（列多了横向滚动）；外层兜一层滚动容器 */
    .rl-tbl-wrap { overflow-x: auto; }
    /* 🔴 表头格要能挂绝对定位的拖宽手柄 —— 且**必须 `overflow: visible`**：
       手柄挂在 `right: -4px`（跨在右邻格的边上），而 `.rl-table th` 是 `overflow: hidden` ⇒
       整条手柄被裁掉 = 看得见一条看不出、鼠标也**点不到**（用户报障：「表头不能自由调整宽度」）。
       ⚠️ 表头文字自己的省略号在 `.rl-tbl-head`（`.rl-tbl-mv`）上，不靠 th 的 overflow。 */
    /* 🔴🔴 #668 拖宽竖线要**拉满整列**，就必须让 `<th>` **不再是定位上下文**：
       `position: relative` 的祖宗会把绝对定位的子元素锚在自己身上（实测：竖线只在表头那 29px 里）。
       ⇒ 两处 `relative` 全部改成 `static`（`overflow: visible` 保留，右缘手柄要露出来），
          手柄改为相对 `<table>`（`.rl-table` 是 `relative`）定位，坐标由 CSS 变量给。
       ⚠️ 本仓曾有「`th` 必须 relative 才能让右缘手柄可见」的写法 —— 那条约束**已随竖线拉满整列而失效**
          （手柄现在整条都在表格坐标系里，不需要 th 来定位）。
       ⚠️ 现在 `th` 里**没有**任何其它绝对定位子元素（六点握把已整体删除），所以改 static 安全。 */
    .rl-table .rl-tbl-th { position: static; overflow: visible; }
    .rl-tbl-th { position: static; }
    .rl-tbl-head { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 🔴 #668 用户：「拖序不要显示那六个点图标为中心了，**以文字为中心**」。
       旧写法 = 握把 `position: absolute; left: 1px`（贴左缘）+ 表头 `padding-left: 16px` 给它让位
       ⇒ 文字被推到右半边，视觉中心成了那个六点图标。
       🔴🔴 **第一版改错并返工**：我直接把 `display: flex` 写在 `<th>` 上 —— **`<th>` 一旦变成 flex 容器，
       就不再参与表格的列宽分配**（`table-layout: fixed` 下所有列塌成同宽，实测四列表头 left 全是 522）。
       ⇒ 正确做法：`<th>` 保持 `table-cell`（⛔ 别给它 display/flex），居中的是**内层 `.rl-tbl-thbox`**
          （`inline-flex` 纵排：文字在上、握把在下），`th` 只负责 `text-align: center`。
       ⚠️ ⛔ 别再给绝对定位的握把留 `padding-left`（那正是「文字偏心」的根因）。 */
    .rl-table .rl-tbl-th:not(.rl-col-title) {
        padding-left: 4px;
        padding-right: 4px;
        text-align: center;
    }
    .rl-tbl-thbox {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        vertical-align: middle;
        max-width: 100%;
    }
    /* 🔴 #668 六点握把（`.rl-tbl-grip`）连同它的悬停淡入规则**整体退场** ——
       用户：「表头拖动时去掉六点图标，不要显示了」。拖拽仍挂在 `<th>` 上，只是没有图标提示了。
       ⛔ 别再为它加样式：没有模板节点时这些规则只会变成「未使用选择器」告警（构建 87 的基线会被打破）。 */
    .rl-tbl-th.is-dragging { opacity: .45; }
    /* 🔴 #668 用户：「**竖指示器要下面格也显示**」—— 落点竖线原来只有表头格有 `inset` 阴影，
       数据行列一点都看不见，读不出「插到哪一列」。修法 = 同一条竖线**也挂到该列的数据格**
       （模板上 `td.rl-tbl-td` 带 `class:is-over`，见那边的注释）。
       ⚠️ 两处都必须用 `inset` 阴影而不是 `border`：`border` 会改列宽 ⇒ 拖动时整表抖一下。 */
    .rl-tbl-th.is-over { box-shadow: inset -2px 0 0 var(--interactive-accent); }
    .rl-tbl-td.is-over { box-shadow: inset -2px 0 0 var(--interactive-accent); }
    /* 🔴🔴 #668 用户：「调整列宽度的**竖指示器没有格子只有表头**」——
       原写法 `position: absolute; top: 0; bottom: 0` 是**相对最近的定位祖先**展开的，而这个祖先就是
       `<th>`（它自己 `position: relative`，为了右缘手柄能被看见）⇒ 竖线只有**表头那么高**
       （实测 29px，整表 2130px，漏掉 2100px）。
       ⇒ 修法：把这条线改成**相对整张表**定位 —— `<table>` 是 `position: relative`，
          `th` 的 `relative` **拦不住绝对定位的子元素**（子元素照样锚到最近的定位祖先）。
          🔴 所以不能只改 `<table>`：必须**让 `th` 不再构成定位上下文**，手柄才会去锚表格。
          做法 = 手柄的坐标全部交给 CSS 变量（`--rl-tbl-x` / `--rl-tbl-h`，由 `syncColResizeHeight()` 每帧写），
          而 `th` 上的 `position: relative` 只保留给... 什么都没有了 ⇒ 见下条：`th` 改 `static`，
          右缘那条竖线的可见性不再依赖 th 的定位（它现在整列都在表格坐标系里）。
       ⚠️ 横向位置与高度**都必须**由变量给，⛔ 别再写 `right: -4px`（那是相对 th 的坐标）。
       🔴🔴 用户 2026-10-20：「列表视图怎么作品标题的竖状指示器**不能拉动**」—— 这条的上一版把柄留在
          `<th>` 里，而 `th` 是 `static` ⇒ 柄锚在 `.rl-table` 上、坐标全靠变量；变量只在 `afterUpdate`
          里写 ⇒ 表头滚动 / 未初始化时柄跑到 -99px（表格左外侧，还被 `.rl-tbl-wrap` 的 `overflow-x`
          裁掉），真正被拖到的是 `th` 边框那条**装饰线**，不是这个柄。
       ⇒ 现在的**结构保证**：柄的 DOM 父节点就是 `<table>`（见模板末尾那段），它自然锚在表格坐标系，
         与变量算出来的坐标同一空间 —— 「看得见的那条线」和「能拖的那条线」从此是同一条。
       ⚠️ 兜底值仍写 `-99px`（未初始化时藏起来），但 `afterUpdate` 之后一定有值；⛔ 别改成 `right: 0`
          之类相对 th 的写法（th 已不是定位祖先）。 */
    .rl-tbl-resize {
        position: absolute; top: 0;
        /* 🔴 宽度 = 视口令柄条（2px，见 ::before）+ 两侧命中带（4px ± → 共 10px）。
           ⛔ 别把 width 收窄回 2px：`<span>` 的命中区只有自身盒子，2px 在触控板上根本点不中。 */
        left: var(--rl-tbl-x, -99px); height: var(--rl-tbl-h, 30px);
        width: 10px; margin-left: -5px; z-index: 2;
        cursor: col-resize; touch-action: none; background: transparent;
    }
    /* 可见的竖条（细、居中压在格线上）。⚠️ 用伪元素画而不是给柄本身背景色 —— 那样 10px 的命中带会变成
       一条粗色带，视觉上把两列硬切开。 */
    .rl-tbl-resize::before { content: ''; position: absolute; left: 4px; top: 0; bottom: 0; width: 2px; background: transparent; }
    /* 悬停 / 拖动中 = **整条竖线**亮起（用户要的正是「下面格子也显示」） */
    .rl-tbl-resize:hover::before,
    .rl-tbl-resize.is-active::before { background: var(--interactive-accent); }
    /* 值格：恒定「整格宽 + 省略号」。🔴 `overflow:hidden` 同时是**内容自适应**的测量基础 ——
       `scrollWidth` 给出的才是全文宽度（不裁就不是这个数）。
       （用户 2026-10-20 删掉了「双击表头自适应」这个交互，但测量本身仍由 `measureCol` 用来算列宽，
        ⛔ 别因为删了双击就把 `overflow:hidden` 也去掉。） */
    .rl-tbl-mv { display: block; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-tbl-cell {
        width: 100%; height: auto; margin: 0; padding: 3px 4px; min-height: 18px;
        border-radius: var(--rl-t-radius-sm, 4px);
        /* 🔴 #668（用户：「占位符能居中对齐，其他填入的仍为左对齐…统一给我居中啊，除标题外不居中」）：
           **有值也居中**（占位符「—」本来就居中，一列里两种对齐看着像没对齐）。
           ⚠️ 表格里**唯一例外是标题列**（不挂本类的 .rl-col-title）—— 标题长短不一且常带副标题/徽标，
              居中会看不出列的起点。⛔ 别把本条挪到 .rl-tbl-mv 上（那会连标题列的省略号盒一起居中）。 */
        text-align: center;
    }
    /* 可编辑格是**真 `<button>`** ⇒ 必须把浏览器默认样式整套抹掉；🔴 `height: auto` 上面已给
       （核心 `button:not(.clickable-icon)` 写死了 `height: var(--input-height)`，不覆盖就是 30px 高）。 */
    .rl-tbl-ed {
        background: transparent; border: none; box-shadow: none;
        color: var(--text-normal); font: inherit;
        /* 与 .rl-tbl-cell 同口径（居中）；核心 button 的默认居中会与它冲突，这里显式钉死 */
        text-align: center; cursor: text;
    }
    .rl-tbl-ed:hover { background: var(--background-modifier-hover); }
    .rl-tbl-ed:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -1px; }
    /* 只读格（虚拟列 / 这一列不适用于本行的类型）：无悬停反馈、无指针变化 —— ⛔ 别让它看着像能点 */
    .rl-tbl-ro { color: var(--text-normal); }
    /* 🔴 #628 ②（用户：「列表视图表头下的占位符怎么不居中显示」）——空值占位「—」**居中**。
       背景：#598 把**表头**改成了居中，而这枚占位符仍是左对齐 ⇒ 同一列里「表头在中间、占位贴左边」，
       看着像没对齐。
       ⚠️ **只作用于这枚占位符**：有值的格仍左对齐（#598 的口径 —— 那几列值长短不一，一起居中反而
          看不出列的边界；用户本次也只点了「占位符」）。
       ⚠️ `display: block` 是**必需**的：`text-align` 只对块级容器生效，光给行内 `<span>` 写它是死规则。
       ⚠️ 因此它两种落点都居中：直接挂在 `<td>` 下的（合集父级行）与嵌在 `.rl-tbl-cell` 里的（条目行）——
          后者那个宿主是 `width: 100%` 的块，本规则占满它 ⇒ 居中的仍是**整格**。 */
    .rl-tbl-none { display: block; text-align: center; color: var(--rl-score-none, var(--text-faint)); }
    /* 编辑框：**铺满整格**（不铺满会看起来像「格子里又开了个小框」） */
    .rl-tbl-input {
        width: 100%; min-width: 0; height: 20px; padding: 0 4px; margin: 0;
        /* 值居中 ⇒ 进入编辑态时**光标也从中间起**，不然输入瞬间文字会「跳一下」 */
        text-align: center;
        font-family: inherit; font-size: 12px; color: var(--text-normal);
        background: var(--background-primary); border: 1px solid var(--interactive-accent);
        border-radius: var(--rl-t-radius-sm, 4px);
    }

    /* ── 列配置面板（#621 追加件：入口从工具栏挪到**表头**）────────────────────────
       🔴 定位 = **锚点 + `absolute`**：`.rl-tbl-col-anchor` 是组件末尾一个 0 高度的相对定位盒子，
          坐标由 `openColMenu` 用 `placeMenu` 在视口坐标里算好再换算过来。
           ⛔ 不用 `position: fixed` —— Obsidian 视图有 transform 祖先，fixed 会被整体偏移
           （本仓 `.rl-ctx-anchor` 的注释里已记过这条，与 #610 同一件事）。
       ⛔ 也**不能**把面板留在表头格里：`.rl-tbl-wrap` 为了横向滚动带了 `overflow-x: auto`
          （CSS 规定另一轴留 visible 时会一并算成 auto）⇒ 面板会被那层裁掉。 */
    .rl-tbl-col-anchor { position: relative; z-index: 60; isolation: isolate; }
    .rl-tbl-colpop {
        position: absolute; z-index: 100; width: 430px; max-height: 320px; overflow-y: auto;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu-strong, 0 4px 14px rgba(0, 0, 0, .18));
        padding: 4px; overscroll-behavior: contain;
    }
    /* 🔴 #668 列选择器 = **三列网格**（用户：「改成三列排布」）。
       ⚠️ 面板宽度从 200px 提到 430px —— 三列挤在 200px 里每列只有 ~62px，列名会被截成两三个字。
       ⚠️ 每项 `min-width: 0` 是网格里的必需项：不给它，长列名会把整列撑宽、三列变成不等宽。 */
    .rl-tbl-colgrid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0 4px;
    }
    /* 🔴 #680 ③-4：列池**分组**（常用 / 作品信息 / 其它）—— 组标题一行小字 + 组内三列网格。
       ⚠️ 组间距用 `margin-top` 而不是 `gap`：`.rl-tbl-colgrid` 是独立的 grid 容器，组之间不是它的孩子。 */
    .rl-tbl-colgroup + .rl-tbl-colgroup { margin-top: 8px; }
    .rl-tbl-colgroup-title {
        margin-bottom: 3px; padding-left: 2px;
        font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
        color: var(--text-faint);
    }
    /* 表头「操作」格：🔴 #630 起**只剩「操作」二字**（那枚列设置按钮已按用户要求搬回工具栏，
       见上方 `.rl-tbl-colmenu`）—— 保留 flex + 居中，是给将来可能回到这一格的件留的位，⛔ 别改成纯文本块
       （`.rl-table th` 是 `text-align: center`，但这一格的表头还要跟下面图标列对齐）。 */
    .rl-tbl-opshead { display: flex; align-items: center; justify-content: center; gap: 3px; }
    .rl-tbl-opslabel { flex: none; }
    /* 🔴🔴 #630：工具栏那一行的列配置按钮（**只在列表视图**渲染；翻面 #622 ④ 的「搬进表头」）。
       底色 / 边框 / 字号由 `.rl-toolbar button` 那条基础规则给（本行按钮的统一语言），这里只补：
         · `inline-flex + gap` —— 图标与「列」二字同一行；
         · hover / focus 反馈（工具栏里那几枚控件同一个口径：hover 转主题色）。 */
    .rl-tbl-colmenu {
        display: inline-flex; align-items: center; gap: 4px; flex: none;
    }
    .rl-tbl-colmenu:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-tbl-colmenu:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    .rl-tbl-colhint { padding: 2px 6px 6px; color: var(--text-muted); font-size: 11px; line-height: 1.6; white-space: normal; }
    .rl-tbl-colopt { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--rl-t-radius-sm, 4px); cursor: pointer; font-size: 12px; min-width: 0; }
    .rl-tbl-colopt:hover { background: var(--background-modifier-hover); }
    .rl-tbl-colopt input[type='checkbox'] { margin: 0; flex: none; }
    /* 三列网格里的列名：窄了要省略号，⛔ 别让它把格子撑开（撑开 = 三列不等宽） */
    .rl-tbl-colopt .rl-tbl-colhead { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-tbl-colhead { flex: 1 1 auto; }
    .rl-tbl-colro { flex: none; color: var(--text-faint); font-size: 10px; }
    .rl-tbl-colfoot {
        margin-top: 4px; padding: 4px 6px 2px; border-top: 1px solid var(--background-modifier-border);
        color: var(--text-muted); font-size: 11px;
    }
    /* 单元格里的进度条：与 `.rl-readbar-inline` 同宽，但落在这个更窄的容器里 */
    .rl-tbl-cell .rl-readbar { margin-top: 2px; }

    /* 标题格：封面 + 书名同一行；书名 `flex: 1` 自适应（用户：「书名列采用自适应布局 flex:1」），
       超出省略号、悬停 `title` 显示全名。 */
    /* 🔴🔴 #686：缩略图由 20×28 放大到 **28×40**（真机实测：20×28 时封面只是个小色块，
       连「是书还是电影」都分辨不出，白白占一个 254px 宽的标题列）。
       仍是 2:3 比例（与海报卡一致，⛔ 别改比例 —— 封面会被拉伸或裁掉关键部分），
       只放大不改形状；行高随之从 41px 涨到 ~53px，仍比海报卡(≈350px)紧凑得多。
       ⚠️ 锁定区里的其它规则引用了 `--rl-list-thumb-w/h`，改尺寸只改这对变量。 */
    .rl-title-cell {
        --rl-list-thumb-w: 28px;
        --rl-list-thumb-h: 40px;
        display: flex; align-items: center; min-width: 0;
    }
    /* 🔴 #621 追加件（用户报障）：表格行撤了整行点击之后，**标题自己**必须既是入口又看得出来能点 ——
       `cursor: pointer` + 悬停转主题色（与折叠卡的组名同款反馈）。 */
    .rl-title-cell .rl-row-link { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .rl-title-cell .rl-row-link:hover { color: var(--interactive-accent); }
    .rl-title-cell .rl-row-link:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; border-radius: var(--rl-t-radius-sm, 4px); }
    .rl-thumb {
        flex: none;
        width: var(--rl-list-thumb-w, 28px);
        height: var(--rl-list-thumb-h, 40px);
        object-fit: cover; border-radius: 3px; margin-right: 8px; vertical-align: middle;
        /* 底色兜住还没解码完的那一帧（加载中不闪白条）；主题自适应，⛔ 不写死色值 */
        background: var(--background-modifier-border);
    }
    /* 表头：纯文本，不提供排序交互，也没有 hover 反馈（排序见工具栏「排序」下拉） */
    /* 列表大众评分列 */
    .rl-thumb-score { font-size: 11px; font-weight: 600; color: var(--rl-score); white-space: nowrap; }
    .rl-thumb-score-na { color: var(--text-faint); font-weight: 400; }
    /* 列表进度列：文本 + 内联绿色进度条 */
    .rl-list-prog { font-size: 11px; color: var(--text-muted); display: block; white-space: nowrap; }
    /* 🔴 #595：进度条由**钉死 90px** 改成**吃满这一格**（`width: 100%`）—— 进度列现在按百分比分宽，
       90px 在窄屏会顶出格子、宽屏又浪费（与「各列都宽一点」同一条口径）。 */
    .rl-readbar-inline { height: 3px; width: 100%; display: block; margin-top: 3px; flex: none; }

    /* ── 🔴🔴 #680 ③-2：列表进度列的**微型胶囊**（用户：「进度条贯穿整列、文字与条分离、视觉松散」）──
       结构 = 一个 `inline-flex` 胶囊，里面「文字 + 4px 细条」并排；条**不再独占一行、不再撑满整列**。
       · 宽度跟着文字走（`width: fit-content`），右侧不会再拖出一条长条；
       · 条最多 42px —— 只是「读到哪」的视觉提示，精确值看文字与悬停提示；
       · `vertical-align: middle`：格子里它与其它文字基线对齐，行高不变。 */
    .rl-prog-chip {
        display: inline-flex; align-items: center; gap: 5px;
        max-width: 100%; padding: 1px 6px;
        border-radius: var(--rl-t-radius-pill, 999px);
        background: var(--background-modifier-hover);
        font-size: 11px; line-height: 1.5; color: var(--text-muted);
        white-space: nowrap; vertical-align: middle;
        /* 🔴 #680：整格宽度不够时**让条先让位、文字保持完整**（实测 132px 列里「11/21 章 · 50%」+ 42px 条
           会挤到文字被截成「…章 · 5…」）。条给 `min-width` 下限，文字 `flex: 0 0 auto`。 */
    }
    .rl-prog-chip-txt { flex: 0 0 auto; }
    .rl-prog-chip-bar {
        flex: 0 1 42px; min-width: 18px; height: 4px; overflow: hidden;
        background: var(--background-modifier-border);
        border-radius: var(--rl-t-radius-pill, 999px);
    }
    .rl-prog-chip-bar > span {
        display: block; height: 100%; background: var(--rl-good-bar, #4d9b52);
        border-radius: var(--rl-t-radius-pill, 999px);
    }

    /* ── 🔴 #592 列表视图的**合集父级行 / 成员子行**（#594 两处翻面见下）──────────────
       父级行 = 组头：一层很淡的底 + 组名加粗 + 「共 N 部」读数 + 行首**整组勾选框**；
       子行 = 组内成员，**与普通条目同一层级**（#594 撤销 #592 的 20px 缩进）。 */
    .rl-grp-row > td { background: var(--background-modifier-hover); }
    .rl-grp-row .rl-grp-name { font-weight: 600; }
    .rl-grp-toggle {
        /* 🔴 「框四件」一起压（核心 `button:not(.clickable-icon)` 的 (0,1,1) 会铺灰底/加内描边环）——
           本组件的 scope 类让它天然 ≥2 类，但四条显式写出来才不依赖特异性侥幸。 */
        display: flex; align-items: center; gap: 6px; min-width: 0;
        /* 🔴🔴 #688（用户：「标题字段超过 8 个字就省略号」）：合集名那一行**必须吃掉标题列的剩余宽度**。
           原来没写 `flex` ⇒ `button` 在 flex 容器里是 `0 1 auto`（基础宽 = 内容宽的上限受挤），
           而里面的 `.rl-grp-name` 也只拿了「几个字」的宽 ⇒ **8 个字就被省略**（实测 cw=88px，
           标题列有 1036px 却全空着）。这里给 `1 1 auto` + `min-width: 0`（可收缩），
           名字再 `flex: 1` 撑满 ⇒ 长合集名可以一直显示到列宽为止。 */
        flex: 1 1 auto;
        border: none; box-shadow: none; border-radius: 4px; padding: 2px 6px 2px 2px;
        background: transparent; color: var(--text-normal);
        font-family: inherit; font-size: 12px; cursor: pointer; text-align: left;
    }
    .rl-grp-toggle:hover { color: var(--interactive-accent); }
    /* 🔴🔴 #594 **翻面**：名字左边那枚倒三角**整体退场**（用户：「把合集名称左边的倒三角样式去掉」）——
       展开 / 收起仍由**点合集名**触发（那个 `button` 与 `aria-expanded` 都还在，只是不再画箭头）。⛔ 别挪回来。 */
    /* 🔴 #688：`flex: 1` 让名字吃掉按钮可用宽（配合上面的 `flex: 1 1 auto`）⇒ 不再 8 个字就省略。 */
    .rl-grp-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-grp-cnt { flex: none; font-size: 11px; font-weight: 400; color: var(--text-muted); }
    /* 🔴🔴 #594 **翻面**：子行**不再缩进** —— 用户：「合集系列下的子条目**不位于与其他条目一层级**」
       ⇒ 撤掉 #592 那条「只推标题格 20px」的规则，子行与单集**逐列对齐**。
       ⚠️ 行上那枚语义类名保留（纯标记：标出「这行是合集的成员」），⛔ **不给它写任何样式**；
          它同时是断言 / 仿真页的稳定锚（去掉它，「子行」就失去唯一可识别的形态）。
       ⛔ 别再用「缩进 / 左边竖线 / 更淡的字色」去区分层级 —— 用户要的就是**同一层级**。 */
</style>
