<script lang="ts">
    import { tick, onDestroy } from 'svelte';
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
    import { placeMenu } from 'pure/menuPlacement';
    import { posterGridTemplate, POSTER_COLUMNS_DEFAULT, type PosterDensity } from 'pure/posterGrid';
    import {
        buildGenreOptions, genrePillLabel, matchesGenreScope,
        resolveGenreScope,
    } from 'pure/genreFilter';
    // 数据源展示名（封面评分角标与它的 data-tip 共用；单一真源 = pure/sourceRegistry 的 PROVIDER_META.label）
    import { sourceLabel } from 'pure/sourceRegistry';
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
    // 书籍子分类（1.0.3）：阅读页签 chips【全部/文学/网文】，缺省归文学（pure/bookKind，原「出版」；1.0.3.1 漫画已下线）
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
    /** 列表视图进度列：百分比 + 进度条（书/剧集有总量）；阅读器进度（percent 无页码）显示百分比；无总量回退文本 */
    function listProgress(e: MediaEntry): { text: string; pct?: number } {
        if (e.type === 'book') {
            const rp = e.readingProgress;
            if (rp?.totalPage) {
                const p = rp.page ?? 0;
                return { text: `${p}/${rp.totalPage} ${bookUnitOf(e)}`, pct: readPct(e) };
            }
            if (typeof rp?.percent === 'number') {
                return { text: `已读 ${readPct(e)}%`, pct: readPct(e) };
            }
            return { text: '' };
        }
        // 列表进度列仅在「在看」状态对剧集/动画有意义——想看（待开始）/已看（已看完）/存档 都不应显示追剧进度
        if ((e.type === 'tv' || e.type === 'anime') && e.status === 'watching' && e.progress) {
            const s = `S${e.progress.season}E${e.progress.episode}`;
            if (e.progress.totalEpisodes && e.progress.totalEpisodes > 0) {
                const pct = Math.max(0, Math.min(100, Math.round((e.progress.episode / e.progress.totalEpisodes) * 100)));
                return { text: s, pct };
            }
            return { text: s };
        }
        if (e.type === 'game' && e.playtimeMinutes) {
            return { text: `已玩 ${Math.round(e.playtimeMinutes / 60)}h` };
        }
        return { text: '' };
    }
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
    /** 当前子视图的题材作用域：null = 该视图不提供题材筛选（阅读-全部 / 影视-全部 / 上层聚合视图） */
    $: genreScope = resolveGenreScope(lockType, typeFilter, lockType === 'book' ? kindFilter : 'all');
    /** 题材池 = 当前子视图池（类型 / 分类收窄之后、状态与搜索之前 —— 与状态 chips 计数同口径） */
    $: genrePool = genreScope ? entries.filter((e) => matchesGenreScope(e, genreScope)) : [];
    $: genreOptions = buildGenreOptions(genrePool);
    $: genrePill = genrePillLabel(genreOptions, genreSel);
    /** 池内是否已全选（含「未分类」；空池不算全选）—— 供「全选 ⇄ 清空」按钮切文案与行为 */
    $: allGenresSelected = genreOptions.length > 0 && genreOptions.every((o) => genreSel.includes(o.key));
    /**
     * 子视图切换复位为「全部」（用户 D-7 裁定）：池与已选都按子视图隔离 ——
     * 阅读的「科幻」与网文的「科幻」是两个独立集合，影视三分类同理。
     * 作用域 key 一变（含 null ↔ 有值）即清空，否则会把 A 视图的选中带进 B 视图。
     */
    let genreScopeKey = '';
    $: if ((genreScope?.key ?? '') !== genreScopeKey) {
        genreScopeKey = genreScope?.key ?? '';
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
    }
    $: pageCount = pageCountOf(filtered.length);
    $: safePage = clampPage(page, filtered.length);
    $: pagedItems = paginate(filtered, safePage).items;
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
    // 书籍子分类三桶计数（阅读页签 chips 数字；all = book 总数，缺省与存量漫画归文学桶）
    $: kindCounts = bookKindCounts(lockType === 'book' ? entries : []);

    /**
     * 空状态（1.0.4）：池口径取「类型 / 分类筛选之后、状态与关键词筛选之前」——
     * 否则「切到某个类型后为空」会被误判成「整个库是空的」，提示用户去添加而不是改筛选。
     * 必须写在 statusCounts / kindCounts 之后：Svelte 4 的 $: 语句按源码顺序执行，提前引用会先算成 undefined。
     */
    $: emptyState = resolveEmptyState({
        poolCount: statusCounts.all,
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

    /** 底部进度/信息行：书籍页码/阅读百分比、游戏时长（年份并入 subtitle 第二层，阶段3 层级重构） */
    function progressText(e: MediaEntry): string {
        if (e.type === 'book') {
            const rp = e.readingProgress;
            if (rp?.totalPage) return `${rp.page ?? 0}/${rp.totalPage} 页`;
            if (typeof rp?.percent === 'number') return `已读 ${readPct(e)}%`;
            return '';
        }
        if (e.type === 'game' && e.playtimeMinutes) {
            const h = Math.round(e.playtimeMinutes / 60);
            return `已玩 ${h}h`;
        }
        return '';
    }

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

    /** 阅读进度百分比（0-100）：阅读器进度 percent 优先（自动落库）；无则回退手填页码进度；未开始返回 undefined 不渲染灰线 */
    function readPct(e: MediaEntry): number | undefined {
        const rp = e.readingProgress;
        if (e.type !== 'book') return undefined;
        if (typeof rp?.percent === 'number') return Math.max(0, Math.min(100, Math.round(rp.percent)));
        // 仅 totalPage（自动解析未手填当前页）：按 0 计算，进度行照常渲染（0/N）
        if (!rp?.totalPage) return undefined;
        return Math.max(0, Math.min(100, Math.round(((rp.page ?? 0) / rp.totalPage) * 100)));
    }

    /** 书籍进度单位：关联 TXT（按章节解析）→ 章，其余（PDF/手填/豆瓣兜底）→ 页 */
    function bookUnitOf(e: MediaEntry): string {
        return e.bookFile?.toLowerCase().endsWith('.txt') ? '章' : '页';
    }

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
    onDestroy(unbindGenreWindow);
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
        <input
            class="rl-search"
            type="search"
            placeholder={searchPlaceholder}
            bind:value={searchText}
            aria-label="搜索条目"
            on:keydown={(ev) => { if (ev.key === 'Escape') searchText = ''; }}
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
                {#each SORT_OPTIONS as o}
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
        <button class="rl-batch-btn rl-batch-danger" on:click={bulkDelete} data-tip="删除选中条目（不可撤销，删除前会二次确认）">删除</button>
        <button class="rl-batch-btn" on:click={clearSelection} data-tip="取消当前选中（不改动任何条目）">取消选择</button>
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
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除当前全部筛选与搜索条件">清除筛选</button>
        {/if}
    </div>
{/if}
{:else if viewMode === 'grid'}
    <!-- 海报墙列数：设置档位 → grid-template-columns 串（pure/posterGrid）。
         ⛔ 不改 waterfall 列数；CSS 里的 fallback 与「标准」档完全一致（内联 style 缺席也不塌成单列） -->
    <div class="rl-grid" style={`grid-template-columns:${posterGridTemplate(posterDensity, posterColumns)}`}>
        {#each pagedItems as e (e.id)}
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
                        <div class="rl-cov rl-cov-ph" style={`--h:${hash(e.id) % 360}${colorTheme === 'colorful' ? ` --tc:${TYPE_COLORS[e.type]}` : ''}`}><span>{e.title.slice(0, 2)}</span></div>
                    {/if}
                    <!-- 大众评分角标（用户 2026-09-22：从 meta 行搬到**封面右上角**常显，hover / 键盘聚焦封面时淡出）。
                         与 hover 遮罩（⋯ / 打开笔记 / 播放）共用同一块角 —— 两者**从不同时出现**，所以不打架。
                         ⚠️ 2026-09-22 用户追加「要显示数据源」⇒ 角标 = 「来源名 + 数值★」：
                            · 来源名 `.rl-cov-src`（弱化色）由 pure/sourceRegistry 的 `sourceLabel()` 提供，
                              与 `data-tip` 同一助手、同一真源（PROVIDER_META.label，全 11 源齐备）；
                            · 数值 + 后缀星仍是暖黄主角；`.rl-cov-src` 缺席时角标自然退化回「数值★」（老条目无 source）。
                         全类型通吃（书籍/影视/动画/游戏/音乐，只要 communityScore 有值就显示），无类型门控。 -->
                    {#if scoreText(e)}
                        <span class="rl-cov-score"
                              data-tip={`大众评分（数据源：${sourceLabel(e.source) || '—'}）`}>{#if sourceLabel(e.source)}<span class="rl-cov-src">{sourceLabel(e.source)}</span>{/if}{scoreText(e)}★</span>
                    {/if}
                    <!-- Hover 快速操作（阶段6：弱化播放器感——「打开笔记 ↗」文字按钮，而非大 ▶） -->
                    <div class="rl-cov-hover">
                        <button
                            class="rl-hover-more"
                            data-tip="更多操作（右键菜单）"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openCtx(e, ev); }}>⋯<span class="rl-sr">更多操作</span></button>
                        <button
                            class="rl-hover-open"
                            data-tip="在新选项卡打开：{e.title}"
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
                    {#if progressText(e) && e.type !== 'book'}
                        <div class="rl-prog">{progressText(e)}</div>
                    {:else if e.type === 'game'}
                        <!-- 游戏未填游玩时长：进度行恒渲染，「-」灰字空值占位（与已填「已玩 Xh」行高等高，防卡片错位） -->
                        <div class="rl-prog rl-prog-na">-</div>
                    {/if}
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
                    {#if readPct(e) !== undefined}
                        <div class="rl-readrow">
                            <span class="rl-read-pct">{readPct(e)}%</span>
                            <div class="rl-readbar"><div class="rl-readbar-fill" style={`width:${readPct(e)}%`}></div></div>
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
        {/each}
    </div>
    {#if emptyState}
    <div class="rl-empty" role="status">
        <div class="rl-empty-title">{emptyState.title}</div>
        {#if emptyState.hint}<div class="rl-empty-hint">{emptyState.hint}</div>{/if}
        {#if emptyState.action === 'clear'}
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除当前全部筛选与搜索条件">清除筛选</button>
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
            <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除当前全部筛选与搜索条件">清除筛选</button>
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
                                <button class="rl-btn rl-empty-act" on:click={clearFilters} data-tip="清除当前全部筛选与搜索条件">清除筛选</button>
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
                <button on:click={() => { closeCtx(); onEditEntry(ctxEntry.id); }} data-tip="修改该条目的字段与关联">编辑条目</button>
                {#if ctxEntry.type === 'book'}
                    <button on:click={() => { closeCtx(); onAddExcerpt(ctxEntry); }} data-tip="从外部阅读器复制文本，生成摘抄块">添加摘抄</button>
                {/if}
                {#if ctxEntry.type === 'game'}
                    <button on:click={() => { closeCtx(); onOpenGameSessionModal(ctxEntry); }} data-tip="日期 + 时长 + 心得，保存到游戏笔记">记录游玩</button>
                {/if}
                <button class="rl-ctx-danger" on:click={() => ctxDelete(ctxEntry)} data-tip="删除该条目（会二次确认）">删除条目</button>
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
    .rl-prog { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
    /* 游戏时长空值占位：灰字「-」（与已填「已玩 Xh」同字重区，弱化不抢眼） */
    .rl-prog-na { color: var(--text-faint); }
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
