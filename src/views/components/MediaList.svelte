<script lang="ts">
    import { tick, onDestroy } from 'svelte';

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
    import { actionAriaLabel, actionIcon, actionMenuTitle, actionReadyHint, actionUnavailableHint, hasActionEntry } from 'pure/actionLabel';
    import { starString, starClass } from 'pure/rating';
    import { describeBulkApply } from 'pure/bulkConfirm';
    import { filterAndSort } from 'pure/search';
    import { BOOK_KINDS, BOOK_KIND_LABELS, BOOK_KIND_TOP_UNITS, bookKindCounts } from 'pure/bookKind';
    import { groupMusicByArtist } from 'pure/musicGroup';
    import { cardSubtitle, hasCardSubtitle, cardCreator, hasCardCreator, cardGenres, hasCardGenres } from 'pure/cardMeta';
    import { resolveAddType } from 'pure/focusType';
    import { resolveEmptyState } from 'pure/emptyState';
    import { pageCountOf, clampPage, paginate, pageNumbers } from 'pure/paginate';
    // 系列折叠卡（#434）：分组键 = type + 系列名（用户 2026-09-30 裁定「不做跨类型」）；
    // 组名的单一真源 = `seriesTitleOf`（折叠卡标题与展开态组头**必须同源**，⛔ 别两处各拼一次）。
    // 系列折叠卡（#434）：分组键 = type + 系列名；组名的单一真源 = `seriesTitleOf`。
    // 🔴 #444c：**季列表弹窗整个搬出本组件**（改成应用级 Modal `modals/SeriesPickerModal` + `SeriesPicker.svelte`）
    //    ⇒ 这里不再 import 任何 `seriesPanel*` 算式（宽度 / 列数是 Modal 的事），也**不再自造遮罩**。
    import { foldSeries, seriesKeyOf, seriesYearSpan, seriesGenres, seriesStatus, nextSeriesEntry, seriesReadPercent, seriesReadDone, type SeriesGroup, type SeriesRow } from 'pure/seriesGroup';
    // 进度 / 状态小字（#444c 下沉到纯模块）：卡片与弹窗**共用同一份口径**，⛔ 别在两处各写一套。
    import { listProgress, readPercent, bookUnitOf, cardPlaytimeBadge } from 'pure/mediaProgress';
    import { placeMenu } from 'pure/menuPlacement';
    import { posterGridTemplate, POSTER_COLUMNS_DEFAULT, type PosterDensity } from 'pure/posterGrid';
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
    import type { MediaEntry, MediaStatus, BookKind } from 'data/types';
    import Icon from './Icon.svelte';

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
    /** 右键「动词 · 去关联」直达：无入口时点主操作 → 快捷关联弹窗（不再整表单跳转） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onSetStatus: (id: string, s: MediaStatus) => Promise<void> = async () => {};
    export let onMarkUpdated: (id: string) => Promise<void> = async () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};
    /** 批量删除（多选）：一次 Modal 确认后逐条删（plugin.deleteEntries） */
    export let onBulkDelete: (ids: string[]) => Promise<void> = async () => {};
    /** 书籍卡片右键「添加摘抄」：打开摘抄弹窗并固定挂载该书 */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** 游戏卡片右键「记录游玩」：打开游玩记录弹窗并固定挂载该游戏 */
    export let onOpenGameSessionModal: (game: MediaEntry) => void = () => {};
    /** 批量设置个人评分（rating 0 = 清除） */
    export let onBulkRating: (ids: string[], rating: number) => Promise<void> = async () => {};
    /** 批量追加标签（合并去重） */
    export let onBulkTags: (ids: string[], tags: string[]) => Promise<void> = async () => {};
    /** 批量应用前置确认（批B）：返回 false = 用户取消。无撤销栈，把关口前移到动手之前 */
    export let onConfirmBulk: (message: string) => Promise<boolean> = async () => true;
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    /** 色彩主题：彩色显示类型色条；单色关闭（设置页配置，v0.4 起固定单色） */
    export let colorTheme: ColorTheme = 'colorful';
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list；页内切换只影响本次 */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 海报密度（设置页配置，用户 2026-09-22；pure/posterGrid 归一）：决定海报墙的最小卡片宽度 /
     *  自定义列数。⛔ 只作用于海报墙 —— 瀑布流列数走 masonryCols（用户 D-4 裁定不管瀑布流） */
    export let posterDensity: PosterDensity = 'standard';
    /** 自定义列数的目标列数（仅 posterDensity === 'custom' 生效；实际列数仍由容器宽度决定） */
    export let posterColumns: number = POSTER_COLUMNS_DEFAULT;
    /** 锁定类型（Tab 维度的分类视图）：传入时 typeFilter 受控，工具栏不显示类型 chips */
    export let lockType: EntryType | null = null;
    /** 类型池限制（聚合页签如「影视」）：传入时筛选 chips 只显示这些类型；null 显示全部类型 */
    export let typePool: EntryType[] | null = null;

    let viewMode: 'grid' | 'list' | 'masonry' | 'grouped' = defaultViewMode;
    /** 瀑布流列数（按窗口宽度初始化：宽窗 6 列 / 中窗 4 列 / 窄窗 3 列） */
    function initialMasonryCols(): number {
        if (typeof window === 'undefined') return 4;
        const w = window.innerWidth;
        return w > 1300 ? 6 : w > 900 ? 4 : 3;
    }
    let masonryCols = initialMasonryCols();
    function splitMasonry(items: MediaEntry[], cols: number): MediaEntry[][] {
        const out: MediaEntry[][] = Array.from({ length: cols }, () => []);
        items.forEach((it, idx) => out[idx % cols].push(it));
        return out;
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
    // 音乐页签子分类行已于 1.0.3.1 下线（用户 2026-09-13 裁定删除「其他」，音乐回归单一类目）
    /** 清除全部筛选与搜索条件（空态「清除筛选」按钮用）：锁定类型页签的类型不可改，只重置可变条件 */
    function clearFilters() {
        statusFilter = 'all';
        if (!lockType) typeFilter = 'all';
        if (lockType === 'book') kindFilter = 'all';
        searchText = '';
        debouncedSearch = ''; // 立即生效，不等 300ms 防抖
        genreSel = []; // 题材也是筛选条件之一：清除筛选必须一并清掉，否则空态按钮形同虚设
    }
    let sortBy: SortBy = 'recent';
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
    /** 右键菜单状态：条目 id + 定位坐标（相对 anchor 容器） */
    let ctxFor: string | null = null;
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
    /** 类型筛选 chips：受 typePool 限制（聚合页签仅影视三类）；null 时显示全部类型 */
    $: typeChips = (['all'] as ('all' | EntryType)[]).concat(typePool ?? ENTRY_TYPES);
    /** 排序下拉选项：每项排序成对提供正/反向（标题 A-Z/Z-A；其余 ↓=新/高在前，↑=旧/低在前）——底层 filterAndSort 12 向已实现，仅下拉曾砍剩默认方向 */
    const SORT_OPTIONS: { value: SortBy; label: string }[] = [
        { value: 'recent', label: '最近更新 ↓' },
        { value: 'recent-asc', label: '最近更新 ↑' },
        { value: 'release-desc', label: '发布日期 ↓' },
        { value: 'release-asc', label: '发布日期 ↑' },
        { value: 'title-asc', label: '标题 A-Z' },
        { value: 'title-desc', label: '标题 Z-A' },
        { value: 'score-desc', label: '大众评分 ↓' },
        { value: 'score-asc', label: '大众评分 ↑' },
        { value: 'myrating-desc', label: '个人评分 ↓' },
        { value: 'myrating-asc', label: '个人评分 ↑' },
        // 🔴 #441：系列序号档 —— 进「单系列视图」时**默认切到 `series-asc`**（用户点名
        //    ⛔ 本注释不许写出那个被撤掉的底部入口文案：`<script>` 里的注释会进产物，
        //       而它有一条「不许长回来」的反向守卫 ⇒ 写了就是自撞（本仓栽过四次）。
        //    「系列视图里条目排序默认为系列序号排序优先」）；比较逻辑走 `seriesGroup` 那份单一真源。
        { value: 'series-asc', label: '系列序号 ↑' },
        { value: 'series-desc', label: '系列序号 ↓' },
    ];

    // 概览量词（「N X」里的 X）：类型级回落 pure/labels.overviewUnitLabel（本书/首音乐/部电影…）；
    // 单类型页签下子分类 chip 选中（非 all）时跟随子分类（本网文）——对齐影视「8 部电视剧」模式
    $: overviewUnit =
        lockType === 'book' && kindFilter !== 'all' ? BOOK_KIND_TOP_UNITS[kindFilter]
        : overviewUnitLabel(lockType ?? (typeFilter !== 'all' ? typeFilter : null));
    // 概览总数与量词配套：子分类选中时取桶数（kindCounts，与 chips 数字同源），否则类型池总数
    $: overviewTotal =
        lockType === 'book' && kindFilter !== 'all' ? kindCounts[kindFilter]
        : statusCounts.all;

    /** 搜索占位符随当前类型动态（书籍=书名/作者、游戏=标题/开发商、音乐=标题/作者，均已真实参与 matchesSearch；影视仅标题可搜，原名不宣传） */
    $: searchPlaceholder = (() => {
        const t = lockType ?? (typeFilter !== 'all' ? typeFilter : null);
        if (t === 'book') return '搜索书名、作者…';
        if (t === 'game') return '搜索标题、开发商…';
        if (t === 'music') return '搜索标题、作者…';
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

    // ── 分页（1.0.4 批次C ⑥）状态 ──
    /** 当前页码（1-based）；筛选 / 搜索 / 排序变化会回落第 1 页，越界由 safePage 钳制 */
    let page = 1;
    /** 翻页后回顶用：工具栏元素，向上找滚动容器（Obsidian 的 .view-content） */
    let toolbarEl: HTMLElement | null = null;

    // 分页派生：**必须写在 filtered 之后、masonryBuckets 之前** ——
    // Svelte 4 的 $: 按源码顺序求值，提前引用会读到 undefined（emptyState 同款坑）。
    // 海报墙 / 列表 / 瀑布流三个「条目流」视图共用同一页码；分组歌单（音乐）以「组」为阅读单位，不分页。
    // 已选题材必须并进 key：否则换题材后结果集变了、页码却停在第 3 页（出现「翻页后空列表」）。
    $: pageKey = [statusFilter, typeFilter, kindFilter, debouncedSearch, sortBy, genreSel.slice().sort().join('\u0002')].join('\u0001');
    let pageResetKey = '';
    $: if (pageKey !== pageResetKey) {
        pageResetKey = pageKey;
        page = 1;
        // 🔴🔴 #441 **翻面**：这里原来还会 `activeSeriesKey = null`（换筛选/排序/搜索就把用户**踢出**系列视图）。
        //    用户实测（2026-09-30）：「进入只显示『海绵宝宝 动画系列』的系列视图后，**一点筛选就回到全类型视图**」。
        //    ⇒ 筛选改的是**条件**、系列视图改的是**范围**，两件事不该互相顶掉。
        //      🔴 ⛔ 注释里不许写出那个被撤掉的底部入口文案（产物不剥注释 ⇒ 会自撞它的反向守卫，本仓栽过四次）。
        //    ⚠️ 真该回落的情形（成员被筛得不足 2 条、或切了类型 ⇒ 那一组不在这一面墙里）**不用手写**——
        //       `activeGroup` 是 `seriesRows` **查**出来的（#437 的设计），组没了自然回到整面墙。
    }

    // ── 系列（#434 折叠卡 / #437 单系列视图）：把「行」的概念插在 filtered 与分页之间 ──
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
    let viewModeBeforeSeries: 'grid' | 'list' | 'masonry' | 'grouped' | null = null;

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
            if (ctxFor || genreOpen) return; // 更内层的浮层（右键菜单 / 题材面板）优先
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
        page = 1; // 换视图必须回落第 1 页（否则从第 3 页进系列视图会看到空白页）
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
        page = 1;
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
    $: sortOptions = activeGroup ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => !o.value.startsWith('series-'));

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
     */
    $: rowSource = activeGroup
        ? seriesViewItems.map((e): SeriesRow => ({ kind: 'single', entry: e }))
        : viewMode !== 'grid'
            ? filtered.map((e): SeriesRow => ({ kind: 'single', entry: e }))
            : seriesRows;
    $: pageCount = pageCountOf(rowSource.length);
    $: safePage = clampPage(page, rowSource.length);
    $: pagedRows = paginate(rowSource, safePage).items;
    /** 条目切片：列表 / 瀑布流 / 批量选择都用它（折叠卡在非 grid 视图不存在，故此式等价于原 `pagedItems`） */
    $: pagedItems = pagedRows.flatMap((r) => (r.kind === 'single' ? [r.entry] : r.group.items));
    /** 绘制序列（grid 用）：折叠卡**恒是折叠态**（要看得进系列视图）；系列视图里则是「组内 N 张」。 */
    // 🔴 #444：系列视图的组头**搬到筛选栏**（`.rl-series-bar`）—— 三种视图类型共用一条，
    //    ⛔ 别在网格里再留一份（两处各写一份必然漂移；而且列表 / 瀑布流里网格组头本来也渲染不出来）。
    $: drawList = pagedRows.flatMap((r): DrawItem[] => (r.kind === 'single' ? [{ kind: 'card', entry: r.entry }] : [{ kind: 'folded', group: r.group }]));
    /** 瀑布流分列：纯封面等高卡片，轮流放入各列（保持排序结果从左到右横排，非 CSS columns 竖排） */
    $: masonryBuckets = splitMasonry(pagedItems, masonryCols);

    // 音乐页签歌单：按歌手分组（组名拼音序，未分类置底；组内专辑→年份→标题），纯逻辑见 pure/musicGroup
    $: musicGroups = lockType === 'music' ? groupMusicByArtist(filtered) : [];

    // 状态/类型计数必须是 reactive（依赖 entries 直接暴露给编译器）：
    // 之前是普通 const 函数闭包引用 entries，Svelte 编译器不追踪函数体内依赖，
    // 状态切换/增删后 statusbar 与类型 chips 的数字停在旧值（与 tabCount 同一类 bug）
    $: statusCounts = (() => {
        // 池子同时反映「锁定类型」与「类型筛选」：聚合页签（影视，lockType=null）下切换
        // 动画/电影/电视剧 chips 时 typeFilter 变化，总数须跟随当前分类而非恒等于全部影视数，
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

    /** 状态 Badge 语义图标（○想看 / ●在看 / ✓已看 / ▢存档，字符统一风格） */
    function statusIcon(s: MediaStatus): string {
        return s === 'want' ? '○' : s === 'watching' ? '●' : s === 'watched' ? '✓' : s === 'archived' ? '▢' : '';
    }

    /** 豆瓣图床防盗链：无 Referer 返回 418，需 img referrerpolicy="unsafe-url" */
    function isDoubanImage(u: string | undefined): boolean {
        return !!u && /doubanio\.com/.test(u);
    }

    // 阅读进度百分比 / 书籍进度单位 —— 🔴 #444c 起实现下沉到 `pure/mediaProgress.readPercent` / `bookUnitOf`

    // ── B3 右键菜单 ──
    /** 打开右键菜单：锚点容器内绝对定位（避开 Obsidian transform 祖先导致 fixed 偏移的问题）。
     *  边界自适应走 pure/menuPlacement：**视口系**算好落点（贴鼠标 → 越界翻转 → 仍越界钳制 → 超高封顶），
     *  最后减去锚点视口偏移换算回锚点相对坐标——旧实现直接用锚点相对量与视口宽高比较，锚点越靠内容末尾越失准。 */
    async function openCtx(e: MediaEntry, ev: MouseEvent) {
        ev.preventDefault();
        unbindCtxWindow();
        ctxFor = e.id;
        ctxX = 0;
        ctxY = 0;
        ctxMaxH = undefined;
        ctxMaxW = undefined;
        await tick(); // 等 anchor 与菜单渲染
        const anchor = ctxAnchorEl;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const menu = ctxMenuEl;
        const m = menu?.getBoundingClientRect();
        const p = placeMenu({
            x: ev.clientX,
            y: ev.clientY,
            menuW: m?.width ?? 0,
            menuH: m?.height ?? 0,
            vw: window.innerWidth,
            vh: window.innerHeight,
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
    function unbindCtxWindow() {
        if (ctxOnDown) { window.removeEventListener('mousedown', ctxOnDown); ctxOnDown = null; }
        if (ctxOnKey) { window.removeEventListener('keydown', ctxOnKey); ctxOnKey = null; }
    }
    function closeCtx() {
        unbindCtxWindow();
        ctxFor = null;
    }

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
    // 卸载兜底：系列视图的 Esc 监听（同上纪律 —— 系列视图开着时整个组件被卸载，监听不能留在 window 上）
    onDestroy(unbindSeriesViewEsc);
    /** 类型化主操作（阅读/观看/播放/启动）：入口可用直接执行；不可用 → 快捷关联弹窗直达（不再先开编辑表单） */
    function ctxPrimary(e: MediaEntry) {
        closeCtx();
        if (hasActionEntry(e)) onWatch(e);
        else onQuickAssociate(e);
    }
    /** 右键主操作 title：可用=实际动作描述；不可用=去关联提示（点击直达快捷关联弹窗） */
    function ctxPrimaryHint(e: MediaEntry): string {
        return hasActionEntry(e) ? actionReadyHint(e.type) : actionUnavailableHint(e.type);
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
    $: visibleIds = pagedItems.map((e) => e.id);
    $: allChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    $: someChecked = selectedIds.size > 0 && !allChecked;
    $: if (headCb) headCb.indeterminate = someChecked && !allChecked;
    function toggleSelectAll() {
        if (allChecked) selectedIds = new Set();
        else selectedIds = new Set(visibleIds);
    }
    // ── 分页（⑥）──
    /** 翻页：换页后把滚动容器拉回顶部（不猜容器，向上找第一个可滚动祖先——Obsidian 的 .view-content） */
    function gotoPage(next: number) {
        const target = clampPage(next, filtered.length);
        if (target === safePage) return;
        page = target;
        scrollListTop();
    }
    function scrollListTop() {
        let el: HTMLElement | null = toolbarEl?.parentElement ?? null;
        while (el) {
            if (el.scrollHeight > el.clientHeight + 1) {
                el.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            el = el.parentElement;
        }
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
</script>

<!-- 层2：搜索（定宽）+ 添加 + 概览（小字弱化置右） -->
<div class="rl-toolbar" bind:this={toolbarEl}>
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
            aria-label="搜索条目"
            on:keydown={(ev) => { if (ev.key === 'Escape') { searchText = ''; ev.stopPropagation(); } }}
        />
    </div>
    <!-- 影视聚合页签「添加跟随聚焦」：聚焦 动画/电视剧/电影 时新增表单默认该类型（规则见 pure/focusType）；聚焦「全部」→ undefined = EntryForm 默认电影；单类型页签恒锁 lockType。
         书籍页签同步传当前子分类（kindFilter）：聚焦「漫画」→ 表单下拉选中「漫画」并走漫画源；「网文」→ 书籍+网文；「文学/全部」→ 缺省文学 -->
    <button class="rl-add mod-cta" data-tip="新建条目" on:click={() => onAdd(resolveAddType(lockType, typeFilter), lockType === 'book' && kindFilter !== 'all' ? kindFilter : undefined)}><Icon icon="plus" size={14} /> 添加</button>
    <span class="rl-libstats" role="group" aria-label="库概览">
        <span class="rl-libstats-total">{overviewTotal} {overviewUnit}</span>
    </span>
</div>

<!-- 层3：类型 Pill（居左，分类导航感）+ 状态下拉 + 排序下拉 + 视图（一行，无边框） -->
<div class="rl-viewbar">
    <!-- 🔴 #444：**系列视图下类型 / 阅读分类分组整块隐藏**（用户：「点击进入任一系列视图后隐藏
         【全部/动画/电视剧/电影】等或阅读分组，仅在按 esc 退出系列视图才重新显示」）——
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
        {#if !lockType}
            <span class="rl-vb-group" role="group" aria-label="类型筛选">
                {#each typeChips as t}
                    <button class:on={typeFilter === t} aria-pressed={typeFilter === t} on:click={() => (typeFilter = t)}>
                        {t === 'all' ? '全部' : ENTRY_TYPE_LABELS[t]}<span class="rl-cnt">{typeCounts[t]}</span>
                    </button>
                {/each}
            </span>
            <span class="rl-vb-sep" aria-hidden="true"></span>
        {/if}
        {#if lockType === 'book'}
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
    <span class="rl-vb-select">
        <span class="rl-sel-label">状态</span>
        <select class="rl-sort-select" bind:value={statusFilter} aria-label="状态筛选">
            {#each statusChips as s}
                <option value={s}>{s === 'all' ? '全部' : statusLabel(lockType ?? 'movie', s)}</option>
            {/each}
        </select>
    </span>
    {#if viewMode !== 'grouped'}
        <span class="rl-vb-select">
            <span class="rl-sel-label">排序</span>
            <select class="rl-sort-select" bind:value={sortBy} aria-label="排序方式">
                <!-- 🔴 #444：选项走 `sortOptions` —— 系列序号两档**只在系列视图里出现**（见 script 里那条 `$:`） -->
                {#each sortOptions as o}
                    <option value={o.value}>{o.label}</option>
                {/each}
            </select>
        </span>
        <!-- 题材（视图级，用户 2026-09-22）：紧贴「排序」右侧的同款胶囊；genreScope 为 null 的视图
             （阅读-全部 / 影视-全部）整块不渲染 —— 题材池按子视图隔离，父级视图不提供这一维。
             与排序同受 grouped 门控（音乐分组歌单视图没有排序，也不该有题材）。 -->
        {#if genreScope}
            <span class="rl-vb-select rl-genre-wrap">
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
    <span class="rl-vb-view" role="group">
        <button class:on={viewMode === 'grid'} aria-pressed={viewMode === 'grid'} on:click={() => (viewMode = 'grid')} data-tip="海报墙视图">▦<span class="rl-sr">海报墙视图</span></button>
        <button class:on={viewMode === 'list'} aria-pressed={viewMode === 'list'} on:click={() => (viewMode = 'list')} data-tip="列表视图">☷<span class="rl-sr">列表视图</span></button>
        <button class:on={viewMode === 'masonry'} aria-pressed={viewMode === 'masonry'} on:click={() => (viewMode = 'masonry')} data-tip="瀑布流视图">▥<span class="rl-sr">瀑布流视图</span></button>
        {#if lockType === 'music'}
            <button class:on={viewMode === 'grouped'} aria-pressed={viewMode === 'grouped'} on:click={() => (viewMode = 'grouped')} data-tip="分组歌单视图">☰<span class="rl-sr">分组歌单视图</span></button>
        {/if}
    </span>
</div>

{#if selectedIds.size > 0}
    <div class="rl-batchbar" role="group">
        <span class="rl-batch-cnt">已选 {selectedIds.size} 项</span>
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
        <button class="rl-batch-btn" on:click={clearSelection} data-tip="取消选中">取消选择</button>
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
                            <span class="rl-my-inline">{starString(e.rating)}</span>
                        {/if}
                    </div>
                    <div class="rl-music-ops">
                        {#if e.audioPath}
                            <button class="rl-music-play" data-tip="播放音乐" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon="play" size={13} /><span class="rl-sr">播放音乐</span></button>
                        {/if}
                        <button class="rl-music-edit" data-tip="编辑条目" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onEditEntry(e.id); }}>✎<span class="rl-sr">编辑条目</span></button>
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
{:else if viewMode === 'grid'}
    <!-- 海报墙列数：设置档位 → grid-template-columns 串（pure/posterGrid）。
         ⛔ 不改 waterfall 列数；CSS 里的 fallback 与「标准」档完全一致（内联 style 缺席也不塌成单列） -->
    <div class="rl-grid" style={`grid-template-columns:${posterGridTemplate(posterDensity, posterColumns)}`}>
        <!-- 🔴 #434：从 `pagedItems` 改成 `drawList` —— 一行可能是散卡 / 折叠卡 / 组头。
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
                    {#if scoreText(e)}
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
                    {#if cardPlaytimeBadge(e)}
                        <span class="rl-cov-playtime" data-tip="游玩时长（游玩记录累计）">{cardPlaytimeBadge(e)}</span>
                    {/if}
                    <!-- Hover 快速操作（阶段6：弱化播放器感——「打开笔记 ↗」文字按钮，而非大 ▶） -->
                    <div class="rl-cov-hover">
                        <button
                            class="rl-hover-more"
                            data-tip="更多（右键）"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openCtx(e, ev); }}>⋯<span class="rl-sr">更多操作</span></button>
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
                    <!-- 海报墙防错位：subtitle/creator 两行始终渲染，缺失字段显示「—」占位
                         保证同列卡片元信息行数恒定（卡片 #1 vs #2 vs #3 高度齐平） -->
                    <div class="rl-sub">{cardSubtitle(e)}</div>
                    <div class="rl-creator">{cardCreator(e)}</div>
                    <!-- 题材行恒渲染（缺题材显示「—」同款占位）：空题材卡片不再整行消失，行数恒定防同排错位 -->
                    <div class="rl-tags">{cardGenres(e)}</div>
                    <!-- 🔴 #471：游戏「已玩 Nh」**不在元信息区**（已搬到封面左下角 `.rl-cov-playtime`）。
                         这里原本是「游戏进度行 + 未填时『-』空值占位」两块，随搬迁**整体退场**：
                         · 卡片上的书籍进度走下面 `readPercent` 的 `.rl-readrow`（百分比 + 条 + N/M 页），
                           与被删掉的 `cardProgressText` 书籍分支**从来是两套**（那个分支在卡片上无消费者）；
                         · 其余类型本就没有进度行 ⇒ 卡片行数不受影响（同排底部齐平靠 `.rl-row2` 的 `margin-top:auto`）。 -->
                    <div class="rl-row1">
                        <span class="rl-badge rl-badge-{e.status}" on:click={(ev) => { ev.stopPropagation(); toggleMenu(e.id); }}>
                            {statusIcon(e.status)} {statusLabel(e.type, e.status)}
                        </span>
                        {#if e.rating > 0}
                            <span class="rl-my-inline">{starString(e.rating)}</span>
                        {/if}
                        <!-- 大众评分已搬到封面右上角常显（用户 2026-09-22 裁定：从这一行移走）——
                             见 `.rl-cov-score`；这一行现在只剩「状态徽标 + 我的星」，窄卡挤压问题随之消失。
                             DOM 顺序即「徽标 → 我的星」，两者**紧挨**（用户 2026-09-22「把个人评分放到
                             观看状态右旁边」）；间距由 `.rl-row1` 的 `gap: 6px` 给出，⛔ 不靠 `margin-left:auto`。 -->
                    </div>
                    <!-- 🔴 **保留这个空行**（2026-09-21 用户「海报墙书籍条目不要显示摘抄数量」后，
                         里面那条「摘抄 N」徽标已撤）—— 它带 `.rl-row2 { margin-top: auto }`，
                         是卡片元信息区的**底部定位行**，连同自身那 3px 上内距一起决定同排卡片底部是否齐平。
                         ⛔ 别顺手把这一行也删掉（会一起掉 `margin-top: auto` 与 3px ⇒ 同排卡片底部错开）。
                         ⚠️ 摘抄**入口**仍在卡片右键菜单「添加摘抄」（那是动作，不是计数显示）。 -->
                    <div class="rl-row2"></div>
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
                 ⚠️ `--rl-series-tc` 现在只剩 **×N 角标描边**一个消费者，仍由这一行按**类型色真源**注入
                    （⛔ 别在 CSS 里硬编码六种色；⛔ 也别因为卡片描边删了就把这里一起删）。 -->
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
                style={`--rl-series-tc:${TYPE_COLORS[g.type]}`}
                role="button"
                tabindex="0"
                data-tip={`只看「${g.title}」（${g.items.length} 部）`}
                on:click={() => openSeries(g.key)}
                on:keydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openSeries(g.key); } }}
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
                </div>
                <div class="rl-card-meta">
                    <div class="rl-ttl">{g.title}</div>
                    <!-- 🔴 #504（用户上手后对 #503② 的裁定）：「**信息行恢复成原样**，行高与间距也恢复」
                         ⇒ 「N 部」与年份段**退回两行**（`.rl-sub` + `.rl-creator`，与普通卡同一行序），
                         样式里那几条补重心的 `.rl-series-card …{padding/line-height}` 一并删除。
                         🔴 #505 再调：**两行对调**（用户：「把年份和部数调换一下行」）——
                         年份段挪到**上面那一行**（`.rl-sub`）、部数落到下面（`.rl-creator`）。
                         ⚠️ 口径依据：普通卡的 `.rl-sub` 那一行放的**本来就是年份**
                            （`cardSubtitle` → 电影是 `2004`），所以年份段占 `.rl-sub` 与普通卡**同行同意**，
                            连带字号也跟着普通卡的年份走（11px，比下面那行 10px 略重）。
                         ⚠️ 行数**必须与普通卡一致**（这里原样 = 6 行）：折叠卡与普通卡混排在同一面墙，
                            少一行就得靠 padding 硬补（#503② 那么干过，用户判了「恢复」）—— ⛔ 别再合并。 -->
                    <div class="rl-sub">{seriesYearSpan(g.items)}</div>
                    <div class="rl-creator">{g.items.length} 部</div>
                    <div class="rl-tags">{seriesGenres(g.items)}</div>
                    <!-- 状态徽标（#438 次日补）：与普通卡**同款 markup / 同款配色** —— 位置也一致（元信息区第 5 行）。
                         🔴 显示的是**组的状态**（`seriesStatus` 纯函数 = 面板里标「继续」那一格的状态：
                         在看 > 想看 > 第一条；已看/存档不参与，滤空后退回首条）—— 组里几条状态不同也是它说了算。
                         ⚠️ 这里**刻意不可点**（普通卡上那枚点开会改状态）：一个组有 N 条，
                            「点一下改成什么」没有唯一答案 ⇒ 用 `.rl-series-card .rl-badge{cursor:default}` 明示只读，
                            ⛔ 别顺手挂 `toggleMenu`（那是单条语义）。 -->
                    <div class="rl-row1">
                        {#if gStatus}
                            <span class="rl-badge rl-badge-{gStatus}" data-tip={`系列状态：${statusLabel(g.type, gStatus)}`}>
                                {statusIcon(gStatus)} {statusLabel(g.type, gStatus)}
                            </span>
                        {/if}
                    </div>
                    <div class="rl-row2"></div>
                    <!-- 组级阅读进度（🔴 #472，用户报障：「书籍类型下系列折叠卡没有进度条样式不一致」）——
                         与普通书籍卡**同一截 markup、同一份纯函数口径**（`.rl-readrow`：百分比 + 绿条 + 右侧小字）。
                         🔴 只在**书籍**组渲染（`g.type === 'book'`）：其它类型的普通卡在海报墙上本来就没有进度行
                            （影视的 S/E 只在列表视图显示、游戏时长已挪到封面角标）⇒ 补它们反而制造**新的**不一致。
                         🔴 值 = **按部平均**（`seriesReadPercent`：没开始读的部**按 0 计入分母**）；
                            右侧小字 = 「已读完的部数/总部数」（与普通卡那格「N/M 章」结构对称）。
                            全都没进度 ⇒ 整行不渲染（与普通卡「未开始不渲染灰线」同口径，⛔ 不画空槽）。 -->
                    {#if g.type === 'book' && seriesReadPercent(g.items) !== undefined}
                        <div class="rl-readrow">
                            <span class="rl-read-pct">{seriesReadPercent(g.items)}%</span>
                            <div class="rl-readbar"><div class="rl-readbar-fill" style={`width:${seriesReadPercent(g.items)}%`}></div></div>
                            <span class="rl-read-pages">{seriesReadDone(g.items)}/{g.items.length} 部</span>
                        </div>
                    {/if}
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
    <div class="rl-masonry">
        {#each masonryBuckets as col}
            <div class="rl-m-col">
                {#each col as e}
                    <div class="rl-m-card" role="link" tabindex="0" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }} on:contextmenu={(ev) => openCtx(e, ev)}>
                        {#if posterUrl(e)}
                            <img class="rl-m-cov" src={posterUrl(e)} alt={e.title} loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
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
{:else}
    <table class="rl-table">
        <thead>
        <tr>
            <th scope="col" class="rl-col-cb"><input type="checkbox" bind:this={headCb} checked={allChecked} on:click={toggleSelectAll} aria-label="全选本页条目" /></th>
            <th scope="col">标题</th>
            <th scope="col">年份</th>
            <th scope="col">状态</th>
            <th scope="col">大众评分</th>
            <th scope="col">个人评分</th>
            <th scope="col">进度</th>
            <th scope="col">操作</th>
        </tr>
        </thead>
        <tbody>
            {#if emptyState}
                <tr class="rl-empty-row">
                    <td colspan="8">
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
        {#each pagedItems as e (e.id)}
            {@const lp = listProgress(e)}
            <tr on:click={() => onOpenEntry(e.id)}>
                <td class="rl-col-cb">
                    <input
                        type="checkbox"
                        checked={selectedIds.has(e.id)}
                        on:click={(ev) => { ev.stopPropagation(); toggleSelect(e.id); }} />
                </td>
                <td>
                    {#if posterUrl(e)}<img class="rl-thumb" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />{/if}<span
                        class="rl-row-link"
                        role="link"
                        tabindex="0"
                        on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}>{e.title}</span>
                </td>
                <td>{e.year ?? '—'}</td>
                <td><span class="rl-badge rl-badge-{e.status}">{statusLabel(e.type, e.status)}</span></td>
                <td>{#if e.communityScore != null}<span class="rl-thumb-score">★ {scoreText(e)}</span>{:else}<span class="rl-thumb-score rl-thumb-score-na">—</span>{/if}</td>
                <td><span class="rl-stars {starClass(e.rating)}">{starString(e.rating)}</span></td>
                <td>
                    {#if lp.text}
                        {#if lp.pct !== undefined}
                            <span class="rl-list-prog">{lp.text} · {lp.pct}%</span>
                            <div class="rl-readbar rl-readbar-inline"><div class="rl-readbar-fill" style={`width:${lp.pct}%`}></div></div>
                        {:else}
                            <span class="rl-list-prog">{lp.text}</span>
                        {/if}
                    {/if}
                </td>
                <td>
                    <button
                        class="rl-edit-row"
                        data-tip="编辑条目"
                        on:click={(ev) => { ev.stopPropagation(); onEditEntry(e.id); }}>✎<span class="rl-sr">编辑条目</span></button>
                    {#if hasActionEntry(e)}
                        <button
                            class="rl-edit-row rl-edit-watch"
                            data-tip={actionAriaLabel(e.type)}
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon={actionIcon(e.type)} size={14} /><span class="rl-sr">{actionAriaLabel(e.type)}</span></button>
                    {/if}
                </td>
            </tr>
        {/each}
        </tbody>
    </table>
{/if}

{#if pageCount > 1 && viewMode !== 'grouped'}
    <!-- 分页（⑥）：一页装不下时才出现；页码窗两侧超出才用省略号。
         分组歌单（音乐）以「组」为单位、不分页 → 该视图下不显示分页器（否则是翻页无反应的假控件） -->
    <nav class="rl-pager">
        <button
            class="rl-pager-btn"
            disabled={safePage <= 1}
            on:click={() => gotoPage(safePage - 1)}
            data-tip="上一页">‹<span class="rl-sr">上一页</span></button>
        {#each pageNumbers(safePage, pageCount) as p, i (i)}
            {#if p === '…'}
                <span class="rl-pager-gap" aria-hidden="true">…</span>
            {:else}
                <button
                    class="rl-pager-btn"
                    class:on={p === safePage}
                    aria-current={p === safePage ? 'page' : undefined}
                    on:click={() => gotoPage(p)}>{p}</button>
            {/if}
        {/each}
        <button
            class="rl-pager-btn"
            disabled={safePage >= pageCount}
            on:click={() => gotoPage(safePage + 1)}
            data-tip="下一页">›<span class="rl-sr">下一页</span></button>
        <span class="rl-pager-info">第 {safePage}/{pageCount} 页 · 共 {filtered.length} 条</span>
    </nav>
{/if}

<div class="rl-ctx-anchor" bind:this={ctxAnchorEl}>
    {#if ctxFor}
        {@const ctxEntry = entries.find((x) => x.id === ctxFor)}
        {#if ctxEntry}
            <div
                class="rl-ctx"
                bind:this={ctxMenuEl}
                style={`left:${ctxX}px;top:${ctxY}px${ctxMaxH !== undefined ? `;max-height:${ctxMaxH}px` : ''}${ctxMaxW !== undefined ? `;max-width:${ctxMaxW}px` : ''}`}
                on:click={(ev) => ev.stopPropagation()}
                on:mousedown={(ev) => ev.stopPropagation()}
                on:contextmenu={(ev) => ev.preventDefault()}>
                <!-- 主操作（四类统一）：入口可用=动词直接执行；不可用=「动词 · 去关联」→ 快捷关联弹窗 -->
                <button on:click={() => ctxPrimary(ctxEntry)} data-tip={ctxPrimaryHint(ctxEntry)}>{actionMenuTitle(ctxEntry)}</button>
                <button on:click={() => { closeCtx(); onEditEntry(ctxEntry.id); }} data-tip="编辑字段与关联">编辑条目</button>
                {#if ctxEntry.type === 'book'}
                    <button on:click={() => { closeCtx(); onAddExcerpt(ctxEntry); }} data-tip="粘贴文本生成摘抄">添加摘抄</button>
                {/if}
                {#if ctxEntry.type === 'game'}
                    <button on:click={() => { closeCtx(); onOpenGameSessionModal(ctxEntry); }} data-tip="记一次游玩（日期 + 时长 + 心得）">记录游玩</button>
                {/if}
                <button class="rl-ctx-danger" on:click={() => ctxDelete(ctxEntry)} data-tip="删除条目">删除条目</button>
            </div>
        {/if}
    {/if}
</div>

<style>
    /* 工具栏：搜索框 + 添加按钮整体居中；概览 absolute 钉左（阶段7+） */
    .rl-toolbar { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 8px; position: relative; }
    .rl-toolbar .rl-libstats {
        position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        display: inline-flex; align-items: center; gap: 5px; flex: none; white-space: nowrap;
        font-size: 10.5px; color: var(--text-faint);
    }
    .rl-libstats-total { font-weight: 600; color: var(--text-muted); }
    .rl-libstats-sep { opacity: .7; }
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
    .rl-batchbar { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; padding: 6px 10px; border: 1px solid var(--interactive-accent); border-radius: var(--rl-t-radius-lg, 8px); background: var(--background-modifier-hover); }
    .rl-batch-cnt { font-size: 12px; font-weight: 600; color: var(--text-normal); }
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
    /* 下拉组（状态/排序）：标签 + select，通用 */
    .rl-vb-select { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
    .rl-sel-label { font-size: 10px; color: var(--text-faint); }
    .rl-sort-select {
        font-family: inherit; font-size: 12px; color: var(--text-normal);
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); padding: 2px 8px; cursor: pointer;
    }
    .rl-sort-select:focus { outline: none; border-color: var(--interactive-accent); }
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
    /* 视图切换：纯图标 + 浅色 hover（阶段7 弱化重背景） */
    .rl-vb-view { display: inline-flex; margin-left: auto; }
    .rl-vb-view button {
        font-family: inherit; font-size: 13px; color: var(--text-muted);
        background: transparent; border: none; padding: 4px 9px; border-radius: var(--rl-t-radius-md, 6px); cursor: pointer;
        transition: background .15s ease, color .15s ease;
    }
    /* 视图切换（用户 2026-09-14 裁定）：hover **只让图标变色、不铺底色** ——
       几个图标按钮铺底色会连成一条色带，且与「当前视图」的选中色互相干扰 */
    .rl-vb-view button:hover { color: var(--interactive-accent); }
    .rl-vb-view button:active { transform: scale(.96); }
    .rl-vb-view button.on { color: var(--interactive-accent); }
    /* 卡片网格：列数由设置「海报密度」决定（内联 style 注入 pure/posterGrid 的模板串）。
       这里是**兜底值**，与「标准」档产物逐字一致（FALLBACK_POSTER_GRID_TEMPLATE）：
       min(…, 100%) 是「容器比一张卡片的最小宽还窄时不横向溢出」的保护（原写法缺它，窄侧栏会溢出）。 */
    .rl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr)); gap: 12px; align-items: stretch; }
    /* 卡片统一尺寸：列内 flex 等高，meta 区域最小高度保证各类型（电影/电视剧/动画/书籍/游戏）
       的卡片在视觉上同高，进度行贴底对齐 */
    .rl-card { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px); overflow: hidden; cursor: pointer; position: relative; display: flex; flex-direction: column; }
    .rl-card:hover { box-shadow: var(--rl-t-shadow-card-hover, 0 2px 8px rgba(0, 0, 0, .12)); transform: translateY(var(--rl-t-lift, 0px)) scale(var(--rl-t-scale, 1)); }
    .rl-card.rl-sel-card { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-type-bar { height: 4px; flex: none; }

    /* ── 系列折叠卡（#434）─────────────────────────────────────────────────
       🔴 **不新建骨架**：模板里折叠卡写的还是 `.rl-card` + `.rl-cov-wrap` + `.rl-card-meta`，
          这里只补「角标 / 展开提示 / 组头」三件。⛔ 别给 `.rl-series-card` 另加宽高或内距 ——
          一旦与 `.rl-card` 不同，同排卡片底部就不齐了（仿真页 sr434 量测过：现在 Δw=Δh=0）。
       ⚠️ 角标几何**照抄** `.rl-cov-score`（top/right 6px、10px、黑底胶囊）：海报墙上「封面右上角」
          这个位置已经有语汇，⛔ 别再发明第二套尺寸。折叠卡没有单条大众评分 ⇒ 两者不会同时出现。 */
    /* 🔴 #500⑤ 角标加大：10px → 11.5px、内距也放开一档，并**描一圈类型色** ——
       「系列有几部」是折叠卡最该被一眼看到的信息，它得比普通卡那个 10px 的「大众评分」角标更重。
       ⚠️ 位置语汇不变（封面右上角那个胶囊，`.rl-cov-score` 同一语汇），⛔ 别把位置也换掉。 */
    .rl-series-cnt {
        /* ⚠️ #504：这个 `z-index: 5` 现在**唯一**的对手只剩封面（叠图层已不带 z-index，见下方那段）。
           它必须高于封面才不被叠图吃掉 —— 这正是 #504 修的那件事（当时叠图层的 z-index 能涨到 18）。 */
        position: absolute; top: 6px; right: 6px; z-index: 5;
        background: rgba(0, 0, 0, .72); color: #fff;
        font-size: 11.5px; font-weight: 700; line-height: 1;
        padding: 4px 9px; border-radius: var(--rl-t-radius-pill, 999px);
        border: 1px solid var(--rl-series-tc, var(--background-modifier-border));
    }

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
    .rl-series-card .rl-cov-wrap { position: relative; aspect-ratio: 2 / 3; }
    .rl-series-card .rl-cov-stack {
        position: absolute; display: block; object-fit: cover;
        /* 🔴 #502① **错位步长自适应**（层数不再封顶 3 张后的必然要求）：
           4 层以内每层 **9px**；再多的层**总让出量固定 28px** ⇒ 每层 = 28 / (层数 − 1)（越叠越窄，像一摞书页）。
           ⛔ 别退回写死 `9px` —— 10 部时累计让出 81px，主封面只剩 113px。
           ⚠️ `max(1, …)` 是必需的兜底：1 层时 `(1 − 1) = 0` ⇒ 除零 ⇒ 整个值失效 ⇒ 尺寸规则整条丢失。
           🔴 #503① 用户：「目前的层叠效果有点生硬…**露出更多边缘**」⇒ 步长 8→**9**、总让出 24→**28**
           （主封面从 170 收到 **166**，比原来多露 4px 的边）。 */
        --rl-stk-step: min(9px, calc(28px / max(1, var(--sn, 1) - 1)));
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
       — 配色：深色半透明胶囊 + 暖黄字（与瀑布流 hover 评分 `.rl-m-sc` 同一套「封面上的字」语言，
         白字在浅色封面上会糊，暖黄 + 深底两种封面都读得清）。
       — `white-space: nowrap`：角标只有「来源 + 数值★」这几个字符，⛔ 绝不允许换行。
       — `max-width: calc(100% - 12px)` + 省略号：卡片窄于内容时（窄侧栏 / 极端分屏）角标不越出封面，
         而是在自己的深底胶囊里收成「…」；⛔ 别靠 `.rl-card { overflow: hidden }` 硬裁（那会把胶囊右半截切掉）。
       — 两段配色（2026-09-22 起）：来源名 `.rl-cov-src` 弱化（白 .78）+ 数值暖黄，扫读时数字仍是锚点。
       — z-index 5 < 遮罩 6：即使淡出动画没跑完，也被遮罩压住，不会浮在按钮上。 */
    .rl-cov-score {
        position: absolute; top: 6px; right: 6px; z-index: 5;
        background: rgba(0, 0, 0, .6); color: #ffd76b;
        font-size: 10px; font-weight: 700; line-height: 1;
        padding: 3px 6px; border-radius: var(--rl-t-radius-pill, 999px);
        white-space: nowrap; transition: opacity .15s ease;
        max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis;
    }
    /* 角标里的数据源名（用户 2026-09-22：「要显示数据源」）—— 弱化一档，让暖黄数值仍是第一眼目标。
       间距走 `margin-right`，⛔ 不在模板里写空格文本节点（Svelte 会裁掉相邻标签间的空白，间距会时有时无）。 */
    .rl-cov-src { color: rgba(255, 255, 255, .78); font-weight: 600; margin-right: 4px; }
    .rl-card:hover .rl-cov-score, .rl-card:focus-within .rl-cov-score { opacity: 0; }
    /* 封面左下角「已玩 Nh」角标（🔴 #471）：几何**照抄**右上角的 `.rl-cov-score`（6px 内距 / 10px /
       font-weight 700 / 黑底胶囊），只改两点 —— 位置在左下、文字走白色系（暖黄已被「大众评分」占用：
       一个颜色只表达一件事）。
       — `pointer-events: none`：角标不是按钮，点击要穿到卡片本体（打开笔记），⛔ 别让它吃掉点击。
       — `z-index 5` < 遮罩 6：hover 时应被遮罩压住，⛔ 不许浮在「打开笔记 / ⋯」按钮层之上。
       — 与 `.rl-cov-score` **不同，这里不做 hover 淡出**：右上角淡出是给 ⋯ 让位，左下角没有东西要腾；
         遮罩（半透明黑）盖上来后它自然变暗，不需要第二条动画规则（少一条就少一处会漂的规则）。
       — `max-width` + 省略号同 `.rl-cov-score`：卡片窄时角标不越出封面。 */
    .rl-cov-playtime {
        position: absolute; left: 6px; bottom: 6px; z-index: 5;
        background: rgba(0, 0, 0, .6); color: rgba(255, 255, 255, .92);
        font-size: 10px; font-weight: 700; line-height: 1;
        padding: 3px 6px; border-radius: var(--rl-t-radius-pill, 999px);
        white-space: nowrap; pointer-events: none;
        max-width: calc(100% - 12px); overflow: hidden; text-overflow: ellipsis;
    }
    /* 瀑布流视图：只展示封面的多列流（列内卡片等高，列间自然参差） */
    .rl-masonry { display: flex; gap: 8px; align-items: flex-start; }
    .rl-m-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .rl-m-card { position: relative; border-radius: var(--rl-t-radius-md, 6px); overflow: hidden; cursor: pointer; }
    .rl-m-card:hover { box-shadow: var(--rl-t-shadow-card-hover, 0 2px 8px rgba(0, 0, 0, .16)); transform: translateY(var(--rl-t-lift, 0px)) scale(var(--rl-t-scale, 1)); }
    .rl-m-cov { display: block; width: 100%; height: auto; border-radius: var(--rl-t-radius-md, 6px); }
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
    .rl-hover-open {
        font-family: inherit; font-size: 12px; font-weight: 600;
        border: none; cursor: pointer; background: rgba(0, 0, 0, .55); color: #fff;
        border-radius: var(--rl-t-radius-pill, 999px); padding: 7px 14px; line-height: 1;
        transition: background .15s ease, transform .15s ease;
    }
    .rl-hover-open:hover { background: var(--interactive-accent); transform: scale(1.12); }
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
    /* 列表视图编辑按钮：默认灰、hover 主题色 + 轻微放大；固定高度 + flex 居中保证与观看按钮绝对等高 */
    .rl-edit-row {
        display: inline-flex; align-items: center; justify-content: center;
        height: 22px; line-height: 1; vertical-align: middle;
        border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted);
        border-radius: 5px; padding: 0 8px; cursor: pointer; font-size: 12px;
        transition: color .15s ease, border-color .15s ease, background .15s ease, transform .12s ease;
    }
    .rl-edit-row + .rl-edit-row { margin-left: 4px; }
    .rl-edit-row:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); transform: scale(1.12); }
    /* 列表视图观看按钮：与编辑按钮统一——未 hover 灰，hover 主题底白字 + 放大（不再常驻主题色） */
    .rl-edit-watch:hover { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); transform: scale(1.12); }
    /* meta 用 flex 1 撑满卡片剩余空间；min-height 让进度行即便短/为空也能与同行卡片等高 */
    .rl-card-meta { padding: 7px 8px; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 74px; }
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
    /* 我的评分（观看状态后内联星，无文字标签；字号高于大众评分一档，让「我的判断」成为行内锚点） */
    .rl-my-inline { font-size: 12px; color: var(--rl-score); white-space: nowrap; line-height: 1; }
    /* 书籍进度：百分比 + 绿色进度条 + 页数（页数在条右侧） */
    .rl-read-pages { font-size: 9px; color: var(--text-faint); flex: none; white-space: nowrap; }
    /* 状态徽标样式并入全局 styles.css .rl-badge（唯一实现，四色变量见 styles 文件头） */
    /* 大众评分样式已搬到封面角标 `.rl-cov-score`（用户 2026-09-22）——原来的 `.rl-score` 随模板一并退场，
       ⛔ 别在这里复活它（这一行已经没有第三个元素了）。 */
    /* 我的评分（阶段6：有评分才显示，前缀「我的评分」区分大众分；未评分不占位） */
    .rl-mystars { font-size: 9px; letter-spacing: .3px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .rl-my-label { font-size: 9px; color: var(--text-faint); }
    /* 星级热度分档：≥4 金 / 1~3 灰 / 未评分淡灰 */
    .rl-stars { font-size: 9px; letter-spacing: .5px; }
    .rl-stars-hot { color: var(--rl-score); }
    .rl-stars-mid { color: var(--rl-score-mid); }
    .rl-stars-none { color: var(--rl-score-none); }
    /* （`.rl-prog` / `.rl-prog-na` 已随 **#471「游戏时长搬到封面左下角角标」整体退场** ——
       它俩唯一的使用点就是游戏进度行与它的「-」空值占位，模板那一块已撤。
       要加回来需**同时**补回模板里的行，⛔ 只补样式不补模板 = 死规则。） */
    /* （`.rl-ex-cnt` 摘抄计数徽标样式已随 2026-09-21「海报墙书籍条目不要显示摘抄数量」整体退场；
       要加回来需**同时**补回 MediaList 海报墙分支里的徽标行，⛔ 只补样式不补模板 = 死规则。） */
    /* 阅读进度行（阶段7+）：左百分比 + 进度条，垂直居中对齐；百分比 muted 小字随风格 */
    .rl-readrow { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .rl-read-pct { font-size: 9px; line-height: 1; color: var(--text-faint); flex: none; }
    /* 阅读进度条：仅已开始的书渲染（未开始无灰线，避免像未加载占位符）；填充色更有存在感 */
    .rl-readbar { height: 4px; flex: 1 1 auto; background: var(--background-modifier-border); border-radius: var(--rl-t-radius-pill, 999px); overflow: hidden; }
    .rl-readbar-fill { height: 100%; background: var(--rl-good-bar); border-radius: var(--rl-t-radius-pill, 999px); transition: width .3s ease; }
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
    .rl-ctx button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 6px 10px; border: none; background: transparent; color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer; font-family: inherit; }
    .rl-ctx button:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-ctx .rl-ctx-danger { color: var(--rl-danger-strong); }
    .rl-ctx .rl-ctx-danger:hover { background: var(--rl-danger-strong); color: #fff; }
    /* ── 分页（1.0.4 批次C ⑥）：按钮语言与视图切换 / chips 一致（不铺底色，悬停只变色） ── */
    .rl-pager { display: flex; align-items: center; justify-content: center; gap: 4px; flex-wrap: wrap; margin: 14px 0 2px; }
    .rl-pager-btn {
        font-family: inherit; font-size: 12px; min-width: 26px; padding: 3px 7px;
        border: 1px solid var(--background-modifier-border); background: var(--background-primary);
        color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer;
        transition: color .15s ease, border-color .15s ease;
    }
    .rl-pager-btn:hover:not(:disabled) { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-pager-btn:active:not(:disabled) { transform: scale(.96); }
    .rl-pager-btn:disabled { opacity: .4; cursor: not-allowed; }
    .rl-pager-btn.on { color: var(--interactive-accent); border-color: var(--interactive-accent); font-weight: 600; }
    .rl-pager-gap { font-size: 12px; color: var(--text-faint); padding: 0 2px; }
    .rl-pager-info { font-size: 11px; color: var(--text-faint); margin-left: 6px; }

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
    .rl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .rl-table th { text-align: left; padding: 6px 8px; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); white-space: nowrap; }
    .rl-table td { padding: 6px 8px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
    .rl-col-cb { width: 30px; text-align: center; }
    .rl-thumb { width: 22px; height: 30px; object-fit: cover; border-radius: 3px; margin-right: 8px; vertical-align: middle; }
    /* 表头：纯文本，不提供排序交互，也没有 hover 反馈（排序见工具栏「排序」下拉） */
    /* 列表大众评分列 */
    .rl-thumb-score { font-size: 11px; font-weight: 600; color: var(--rl-score); white-space: nowrap; }
    .rl-thumb-score-na { color: var(--text-faint); font-weight: 400; }
    /* 列表进度列：文本 + 内联绿色进度条 */
    .rl-list-prog { font-size: 11px; color: var(--text-muted); display: block; white-space: nowrap; }
    .rl-readbar-inline { height: 3px; width: 90px; display: block; margin-top: 3px; flex: none; }
</style>
