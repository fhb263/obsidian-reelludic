<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import MediaList from './MediaList.svelte';
    import CalendarBoard from './CalendarBoard.svelte';
    import TrackingBoard from './TrackingBoard.svelte';
    import StatsBoard from './StatsBoard.svelte';
    // #546：导航本体（大字 + 面板 + 键盘）抽成独立组件 —— **两个挂载点共用同一份实现**：
    //   有工具栏的页签经 MediaList 的 `nav-entry` 插槽放进搜索框那一行，计划/统计由本组件包一行。
    import NavMenu from './NavMenu.svelte';
    // 🔴 #550：合并视图那枚「更多」菜单（媒体库 / 追更 / 统计）抽成独立组件 —— 同样**两个挂载点**：
    //   库列表页经工具栏的 `nav-entry` 插槽落在**与搜索框并排的右端**（#552 起）；追更 / 统计页由本组件包一行。
    import MergedPageMenu from './MergedPageMenu.svelte';
    import type { MergedPage } from 'pure/mergedPages';
    // 🔴 #603：合并视图那块的**读屏名**要用页名真源（原先写死「媒体库」—— 追更 / 统计两页也叫这个名）
    import { mergedPageLabel } from 'pure/mergedPages';
    // #570「回到顶部」的显隐判据 + 「只认本视图滚动容器」的归属判定（纯模块，配单测）
    import { shouldShowTop, wrapsRoot } from 'pure/topButton';
    import { type ColorTheme, type EntryType } from 'data/types';
    import type { ActivityEvent, BookKind, MediaEntry, MediaStatus } from 'data/types';
    import type { FeedRange } from 'pure/activityFeed';
    import { MEDIA_TYPES, type HomeTab } from '../tab';
    // 🔴 #541：页签的**顺序 / 显示名 / 图标 / 归一全部来自 `pure/homeTabs`** —— 那是唯一真源
    //    （设置页「起始页」下拉与下面的文字菜单分支都读它）⇒ ⛔ 别在本组件里再留一份 TAB_ORDER / tabLabel / tabIcon。
    import { HOME_TAB_ORDER, homeTabIcon, homeTabLabel, isNavTab } from 'pure/homeTabs';
    import { indicatorStyle } from 'pure/themeTokens';
    import { resolveTabKey } from 'pure/tabNav';
    // 🔴 #547 / #550 合并视图：类型那一维的**锁类型**仍在本组件算（`listLockType`），
    //    但那三个下拉本身（选项表 / 文案）已并入 `MediaList` 的筛选行（#550）⇒ 这边只留 `mergedLockType`。
    import { mergedLockType, type MergedScope } from 'pure/mergedScope';
    import type { SortBy } from 'pure/search';
    import { POSTER_COLUMNS_DEFAULT, type PosterDensity } from 'pure/posterGrid';
    import type { SeriesGroup } from 'pure/seriesGroup';
    import Icon from './Icon.svelte';

    // Tab 顺序 / 图标 / 显示名：#541 起统一由 `pure/homeTabs` 提供（`HOME_TAB_ORDER` / `homeTabIcon` /
    // `homeTabLabel`）—— 顶部胶囊与左侧侧边栏共用同一份，⛔ 别在这里再定义一遍。

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），书架卡片徽标数据源 */
    export let excerptCounts: Record<string, number> = {};
    export let initialTab: HomeTab = 'media';
    export let onTabChange: (tab: HomeTab) => void = () => {};
    export let onAdd: (t?: EntryType, kind?: BookKind) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    export let onOpenLink: (url: string) => void = () => {};
    /** 主操作按钮（海报墙/列表）：plugin 层按类型分流——影视观看（单/多源）、书籍阅读、游戏启动、音乐播放 */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /** 折叠卡右下角那枚按钮：打开系列「季列表」弹窗
     *  🔴 #444c：宿主侧开的是**应用级 Modal**（`SeriesPickerModal`）—— 视图只负责「报告用户点了哪一组」。 */
    export let onOpenSeriesPicker: (g: SeriesGroup) => void = () => {};
    /** 🔴 #609 折叠卡右键「排序号」→ 拖拽排序弹窗（同样是宿主侧的应用级 Modal） */
    export let onOpenSeriesReorder: (g: SeriesGroup) => void = () => {};
    /** 右键「动词 · 去关联」直达快捷关联弹窗（无入口时主操作不再跳整编辑表单） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onSetStatus: (id: string, s: MediaStatus) => Promise<void> = async () => {};
    export let onMarkUpdated: (id: string) => Promise<void> = async () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};
    /** 批量删除（多选）：一次确认后逐条删（plugin.deleteEntries） */
    export let onBulkDelete: (ids: string[]) => Promise<void> = async () => {};
    /** 书籍卡片右键「添加摘抄」：固定挂载该书打开摘抄弹窗 */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** 游戏卡片右键「记录游玩」：固定挂载该游戏打开游玩记录弹窗 */
    export let onOpenGameSessionModal: (game: MediaEntry) => void = () => {};
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
    /**
     * 界面主题（1.0.3）：native 原生（默认，页签保持 1.0.2 下划线形态）/
     * modern 现代（分段控件 + 滑动指示器；图标两主题恒渲染——2026-09-12 用户裁定恢复）。
     * 默认值取 'native' 而非从 colorTheme 推导——必须与 Settings 的 DEFAULT_SETTINGS 一致，
     * 且与 normalizeUiTheme 的兜底值相同，避免「设置缺失」时落进现代主题。
     */
    export let uiTheme: 'native' | 'modern' = 'native';
    /**
     * 🔴 #541 主导航布局：`'top'` 顶部横向胶囊（默认 = 1.2.0 观感）/ `'sidebar'` **文字菜单**
     * （内容区右上角一行当前页名，hover 从它正下方展开页签列表；#545 定形）。
     * ⚠️ 与 `uiTheme` **正交** —— 后者管顶部胶囊「长什么样」（下划线 vs 描边指示器），本 prop 管导航「排在哪」。
     * ⚠️ 整块都在**同一个视图内**（视图仍是同一个 ItemView），⛔ 与 Obsidian 工作区侧栏无关。
     * ⚠️ id `'sidebar'` 是**存量数据里的值**（旧 data.json 存过它）⇒ 只改文案，⛔ 别改 id（见 `pure/navLayout`）。
     */
    export let navLayout: 'top' | 'sidebar' = 'top';
    /**
     * 🔴 #541 起始页的**一次性请求**：设置页改了「起始页」后宿主推一个新值进来，本组件消费掉就置回 null。
     * ⚠️ 为什么不复用 `initialTab`：那个 prop 只在**创建时**播种 `activeTab`，之后再改它不会让任何东西动
     *    （症状 = 「改了起始页看不到变化」）；而这里要的正是「当场切过去」。
     * ⚠️ 置回 null 是**必须**的：下面那个响应式块依赖本变量，不置回的话「用户手动切到别的页签」会被它
     *    立刻纠正回请求值（页签自己弹回去）。
     */
    export let requestedTab: HomeTab | null = null;
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 海报密度（设置页配置，pure/posterGrid 归一）：紧凑 / 标准 / 宽松 / 自定义列数 */
    export let posterDensity: PosterDensity = 'standard';
    /** 自定义列数的目标列数（仅 posterDensity === 'custom' 生效；实际列数仍由容器宽度决定） */
    export let posterColumns: number = POSTER_COLUMNS_DEFAULT;
    /** 🔴 #591 媒体库内 Ctrl+滚轮缩放开关（设置页配置；缺省关 —— 要接管系统手势） */
    export let ctrlWheelZoom: boolean = false;
    /**
     * 🔴 #591 缩放**回推出口**：MediaList 只报告「缩到几列」，落盘与重推由宿主承担
     * （`plugin.applyPosterZoom` → 写 `posterColumns` + `posterDensity='custom'` → `syncPosterGrid()`）。
     */
    export let onPosterZoom: (density: PosterDensity, columns: number) => void = () => {};

    let activeTab: HomeTab = initialTab;
    /** 计划页签视图：追更表 / 月历 */
    let trackingMode: 'board' | 'calendar' = 'board';

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
    /** 传给 `MediaList` 的三件（两种布局在这里合流，⛔ 别在模板里各写一份） */
    $: listLockType = mergedOn
        ? mergedLockType(mergedScope)
        : activeTab === 'media' ? null : activeTab;
    $: listTypePool = mergedOn ? null : activeTab === 'media' ? MEDIA_TYPES : null;
    $: listEntries = mergedOn
        ? entries
        : activeTab === 'media' ? entries.filter((e) => MEDIA_TYPES.includes(e.type)) : entries;

    function tabLabel(t: HomeTab): string {
        return homeTabLabel(t);
    }

    /** #541：消费「起始页」的一次性请求（消费完置回 null，避免它继续纠正后续的手动切页） */
    $: if (requestedTab !== null) {
        const want = requestedTab;
        requestedTab = null;
        if (isNavTab(want) && want !== activeTab) switchTab(want);
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
        const r = resolveTabKey(ev.key, HOME_TAB_ORDER.indexOf(current), HOME_TAB_ORDER.length);
        if (!r.handled) return;
        ev.preventDefault();
        const next = HOME_TAB_ORDER[r.index];
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
    /** 同步显隐（判据在纯模块；找不到容器时按 0 处理 —— 首帧不该谎报「已经滚下去了」） */
    function syncTop(): void {
        showTop = shouldShowTop(scrollEl?.scrollTop ?? 0);
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
            syncTop();
        };
        document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
        // 现代主题：窗口尺寸变化后按钮宽度会变，指示器必须重算（native 下 syncIndicator 自身会短路）
        window.addEventListener('resize', syncIndicator);
        // 🔴 但只靠 window resize 不够（2026-09-23 修）：**后台 leaf 重新可见**、侧栏收放、拖分隔条
        //    都不会触发 window.resize —— 而「视图先前不可见 ⇒ 首测读到 0 宽」正是那次 bug 的入口。
        //    ResizeObserver 盯住页签容器自身：容器 0×0 → 真实尺寸的**那一次**也会回调，
        //    就是「不可见期间测错、可见后自愈」的那条路径。
        //    ⚠️ 指示器是容器的 absolute 子项、不参与容器尺寸 ⇒ 改宽度不会反过来触发 RO（无回调环）。
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => syncIndicator());
        if (ro && tabsEl) ro.observe(tabsEl);
        return () => {
            ro?.disconnect();
            document.removeEventListener('scroll', onAnyScroll, { capture: true });
            window.removeEventListener('resize', syncIndicator);
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
    onDestroy(() => clearTimeout(topSyncTimer));


    // 指示器重算时机：首帧渲染后、主题切换时、activeTab 变化时。
    // 显式 void activeTab 建立依赖——否则 Svelte 无法从函数体内推出该响应式块依赖 activeTab。
    // 不能依赖 `await tick()` 的微任务顺序来替代：这里用 .then 是为了不阻塞 Svelte 的更新队列。
    $: if (uiTheme === 'modern' && activeTab) {
        void activeTab;
        void tick().then(() => {
            syncIndicator();
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
    const TAB_PAD = 5;
    /** 布局未就绪时的重试计数（防无限 rAF） */
    let indRetry = 0;
    /** 重试上限（约 10 帧）；仍不就绪则交给 ResizeObserver —— 视图一旦可见它会立刻回调 */
    const IND_RETRY_MAX = 10;

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
    {#if navLayout === 'sidebar'}
        <!-- 🔴 #546 入口挂载点之二：**没有工具栏的页签**（计划 / 统计 —— 那两页没有搜索框那一行）
             由本组件渲染成靠右的**独立一行**（用户 2026-10-07 裁定）。
             ⚠️ 有工具栏的页签（阅读/影视/游戏/音乐）走**另一个挂载点** —— 经 `<slot name="nav-entry">`
                放进 MediaList 的搜索框那一行右端（用户原话：「页签纯文字入口放在与搜索框并排显示」）。
             🔴 两处是**同一个组件** `NavMenu`（文案 / ARIA / 键盘 / 面板 / 交互一字不差）；
                ⛔ 别在这儿再手写一份面板 DOM —— 那就是「同一概念两份实现」，必然漂移。 -->
        {#if !hasToolbar}
            <div class="rl-navbar">
                <NavMenu {activeTab} onSelect={switchTab} />
            </div>
        {/if}
    {:else if navLayout === 'top'}
        <!-- 🔴🔴 #551 修回归：这里**必须显式写成一个档位**（`top`），⛔ 不许用不带条件的兜底分支 ——
             合并视图那一档自己不再渲染任何导航行（三下拉与「更多」都在内容区），
             兜底分支会把 merged **一并吃进来**，于是在合并视图里顶部还挂着一整排页签
             （#550 删掉合并视图那条分支时留下的洞，用户上手第一眼就抓到了）。
         🔴 #603 同类修正：这条页签栏 `width: 100%`（页签居中、两侧全是空白）⇒ 原先把可访问名挂在它上面
         （`aria-label`，值就是插件名）会让「鼠标划过页签栏两端的空白」也浮出一个气泡 ⇒ 一并改成
         `aria-labelledby` 指向 `.rl-sr` 文本节点（同一套口径，见下面那块面板）。 -->
        <span class="rl-sr" id="rl-home-tabs-label">ReelLudic</span>
        <div
            class="rl-tabs"
            class:rl-tabs-modern={uiTheme === 'modern'}
            role="tablist"
            aria-labelledby="rl-home-tabs-label"
            aria-orientation="horizontal"
            bind:this={tabsEl}>
            {#if uiTheme === 'modern'}
                <span class="tab-ind" bind:this={indEl} style={indStyle}></span>
            {/if}
            {#each HOME_TAB_ORDER as t}
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
                    {tabLabel(t)}
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
        aria-labelledby={mergedOn ? 'rl-merged-page-label' : `rl-tab-${activeTab}`}
        tabindex="0">
        {#if mergedOn}
            <span class="rl-sr" id="rl-merged-page-label">{mergedPageLabel(effPage)}</span>
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
            <StatsBoard {entries} {excerptCounts} {activityLog} {onAdd} {onOpenEntry} {onGenerateReport} {yearReports} {onOpenReport} {onRecordJournal} />
        {:else}
            <MediaList
                entries={listEntries}
                {posterUrl}
                {colorTheme}
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
                {onOpenSeriesReorder}
                {onQuickAssociate}
                {onSetStatus}
                {onMarkUpdated}
                {onDeleteEntry}
                {onBulkDelete}
                {onAddExcerpt}
                {onOpenGameSessionModal}
                {onBulkRating}
                {onBulkTags}
                {onConfirmBulk}
                lockType={listLockType}
                typePool={listTypePool}
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
                        <NavMenu {activeTab} onSelect={switchTab} inline />
                    {:else if mergedOn}
                        <MergedPageMenu page={mergedPage} onPick={(p) => (mergedPage = p)} inline />
                    {/if}
                </svelte:fragment>
            </MediaList>
        {/if}
    </div>

    <!-- 回到顶部：下滑超过页签+筛选栏后右下角浮现，点击平滑回顶 -->
    <button
        class="rl-to-top"
        class:show={showTop}
        data-tip="回到顶部"
        on:click={scrollToTop}>↑<span class="rl-sr">回到顶部</span></button>
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

    /* 回到顶部按钮：右下角 fixed 圆形，下滑超过阈值后淡入（class:show 控制） */
    .rl-to-top {
        position: fixed; right: 22px; bottom: 22px; z-index: 1000;
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
    .rl-tabs button:active { transform: scale(.96); }
    .rl-tabs button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    .rl-tabs button.on {
        color: var(--interactive-accent); font-weight: 600;
        border-bottom-color: var(--interactive-accent);
    }

    /* ── 1.0.3 现代主题页签：分段控件（胶囊容器 + 描边滑动指示器）──
       为何必须走结构分支而非纯 CSS 变量：变量能改颜色与圆角，但变不出新 DOM 节点（指示器），
       只能靠模板 {#if} 表达。页签图标两主题恒渲染（定稿曾为纯文字，2026-09-12 用户裁定恢复）。
       fallback 说明：本块整体挂在 .rl-tabs-modern 下，native 主题选择器不匹配、规则根本不生效，
       故 var() 的第二参数纯属防御性冗余；此处仍一并写上，与 Task 3/4 中「native 也会命中」的规则保持一致纪律。 */
    .rl-tabs.rl-tabs-modern {
        position: relative;
        display: inline-flex; align-items: center; gap: 0;
        width: fit-content; max-width: 100%;
        margin: 0 auto 12px; padding: 5px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-bottom: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-pill, 999px);
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
    /* 指示器：绝对定位 + transform 平移，left/top 固定为 padding 值 */
    .rl-tabs.rl-tabs-modern .tab-ind {
        position: absolute; top: 5px; left: 5px; height: calc(100% - 10px);
        background: var(--background-primary);
        border: 1.5px solid var(--interactive-accent);
        border-radius: var(--rl-t-radius-pill, 999px);
        box-shadow: var(--rl-t-shadow-ind, none);
        transition: transform var(--rl-t-dur-ind, .28s) var(--rl-t-ease-ind, cubic-bezier(.34, 1.3, .64, 1)),
                    width var(--rl-t-dur-ind, .28s) var(--rl-t-ease-ind, cubic-bezier(.34, 1.3, .64, 1));
        pointer-events: none; z-index: 0;
    }
    /* 图标与文字压在指示器之上（z-index:1），并剥掉 native 的下划线/margin 负值 */
    .rl-tabs.rl-tabs-modern button {
        position: relative; z-index: 1;
        padding: 7px 17px; border-radius: var(--rl-t-radius-pill, 999px);
        border-bottom: none; margin-bottom: 0;
        background: transparent; white-space: nowrap;
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
</style>
