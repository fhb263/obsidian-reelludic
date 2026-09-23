<script lang="ts">
    import { onMount, tick } from 'svelte';
    import MediaList from './MediaList.svelte';
    import CalendarBoard from './CalendarBoard.svelte';
    import TrackingBoard from './TrackingBoard.svelte';
    import StatsBoard from './StatsBoard.svelte';
    import { ENTRY_TYPE_LABELS, type ColorTheme, type EntryType } from 'data/types';
    import type { ActivityEvent, BookKind, MediaEntry, MediaStatus } from 'data/types';
    import type { FeedRange } from 'pure/activityFeed';
    import { MEDIA_TYPES, type HomeTab } from '../tab';
    import { indicatorStyle } from 'pure/themeTokens';
    import { resolveTabKey } from 'pure/tabNav';
    import { POSTER_COLUMNS_DEFAULT, type PosterDensity } from 'pure/posterGrid';
    import Icon from './Icon.svelte';

    /** Tab 顺序：追番表(月历) → 书籍 → 影视(动画/剧集/电影聚合) → 游戏 → 统计 */
    const TAB_ORDER: HomeTab[] = ['tracking', 'book', 'media', 'game', 'music', 'stats'];

    /** 页签图标（Obsidian 内建 Lucide）：计划/书籍/影视/游戏/音乐/统计 */
    function tabIcon(t: HomeTab): string {
        if (t === 'tracking') return 'calendar-check';
        if (t === 'book') return 'book-open';
        if (t === 'media') return 'film';
        if (t === 'game') return 'gamepad-2';
        if (t === 'music') return 'music';
        return 'trending-up';
    }

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
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 海报密度（设置页配置，pure/posterGrid 归一）：紧凑 / 标准 / 宽松 / 自定义列数 */
    export let posterDensity: PosterDensity = 'standard';
    /** 自定义列数的目标列数（仅 posterDensity === 'custom' 生效；实际列数仍由容器宽度决定） */
    export let posterColumns: number = POSTER_COLUMNS_DEFAULT;

    let activeTab: HomeTab = initialTab;
    /** 计划页签视图：追更表 / 月历 */
    let trackingMode: 'board' | 'calendar' = 'board';

    function tabLabel(t: HomeTab): string {
        if (t === 'tracking') return '计划';
        if (t === 'media') return '影视';
        if (t === 'stats') return '统计';
        // 页签显示名覆盖（1.0.3 用户裁定）：书籍→阅读，仅页签生效，其余场景仍走 ENTRY_TYPE_LABELS；
        // 音乐页签 1.0.3.1 起回归类型本名「音乐」（原「收听」，用户 2026-09-13 裁定）
        if (t === 'book') return '阅读';
        return ENTRY_TYPE_LABELS[t];
    }

    function switchTab(t: HomeTab) {
        activeTab = t;
        onTabChange(t);
    }

    /**
     * 页签键盘导航（1.0.4，ARIA APG Tabs 模式）：
     * 整组只占一个 Tab 停留点（仅当前页签 tabindex=0），进入后用 ←/→ 在组内移动并立即激活，
     * Home/End 跳首尾（是否回绕见 pure/tabNav）。与页签无关的按键一律放行 ——
     * 否则会吃掉 Tab 本身与浏览器/输入法的默认行为。
     */
    function onTabKeydown(ev: KeyboardEvent, current: HomeTab) {
        const r = resolveTabKey(ev.key, TAB_ORDER.indexOf(current), TAB_ORDER.length);
        if (!r.handled) return;
        ev.preventDefault();
        const next = TAB_ORDER[r.index];
        if (next !== current) switchTab(next);
        // 焦点跟随：不主动聚焦会留在原按钮上，而那个按钮已变成 tabindex=-1
        void tick().then(() => {
            tabsEl?.querySelectorAll<HTMLElement>('button')[r.index]?.focus();
        });
    }

    // ── 回到顶部按钮：下滑超过页签+筛选栏高度时右下角浮现 ──
    let rootEl: HTMLDivElement | null = null;
    let showTop = false;
    /** 视图滚动容器（.rl-home 向上找第一个可滚动祖先，Obsidian view-content） */
    let scrollEl: HTMLElement | null = null;
    /** 触发阈值：页签(≈34) + 搜索/概览行(≈38) + 筛选行(≈40) 总高，越过即显示 */
    const SHOW_TOP_THRESHOLD = 110;

    onMount(() => {
        let el = rootEl?.parentElement ?? null;
        while (el) {
            if (el.scrollHeight > el.clientHeight + 1) {
                scrollEl = el;
                break;
            }
            el = el.parentElement;
        }
        const onScroll = () => {
            showTop = (scrollEl?.scrollTop ?? 0) > SHOW_TOP_THRESHOLD;
        };
        scrollEl?.addEventListener('scroll', onScroll, { passive: true });
        // 现代主题：窗口尺寸变化后按钮宽度会变，指示器必须重算（native 下 syncIndicator 自身会短路）
        window.addEventListener('resize', syncIndicator);
        // 🔴 但只靠 window resize 不够（2026-09-23 修）：**后台 leaf 重新可见**、侧栏收放、拖分隔条
        //    都不会触发 window.resize —— 而「视图先前不可见 ⇒ 首测读到 0 宽」正是这次 bug 的入口。
        //    ResizeObserver 盯住页签容器自身：容器 0×0 → 真实尺寸的**那一次**也会回调，
        //    就是「不可见期间测错、可见后自愈」的那条路径。
        //    ⚠️ 指示器是容器的 absolute 子项、不参与容器尺寸 ⇒ 改宽度不会反过来触发 RO（无回调环）。
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => syncIndicator());
        if (ro && tabsEl) ro.observe(tabsEl);
        return () => {
            ro?.disconnect();
            scrollEl?.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', syncIndicator);
        };
    });

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

    function scrollToTop() {
        scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
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

<div class="rl-home" bind:this={rootEl}>
    <div
        class="rl-tabs"
        class:rl-tabs-modern={uiTheme === 'modern'}
        role="tablist"
        aria-label="ReelLudic"
        aria-orientation="horizontal"
        bind:this={tabsEl}>
        {#if uiTheme === 'modern'}
            <span class="tab-ind" bind:this={indEl} style={indStyle}></span>
        {/if}
        {#each TAB_ORDER as t}
            <button
                id={`rl-tab-${t}`}
                class:on={activeTab === t}
                role="tab"
                aria-selected={activeTab === t}
                aria-controls="rl-home-tabpanel"
                tabindex={activeTab === t ? 0 : -1}
                on:click={() => switchTab(t)}
                on:keydown={(ev) => onTabKeydown(ev, t)}>
                <Icon icon={tabIcon(t)} size={13} />
                {tabLabel(t)}
            </button>
        {/each}
    </div>

    <!-- 单一面板承载全部页签内容：id 固定，所有 tab 的 aria-controls 都指向它（比「每 tab 一个 panel」更贴合实际结构） -->
    <div class="rl-tab-body" id="rl-home-tabpanel" role="tabpanel" aria-labelledby={`rl-tab-${activeTab}`} tabindex="0">
        {#if activeTab === 'tracking'}
            <div class="rl-tracking-switch">
                <button class:on={trackingMode === 'board'} aria-pressed={trackingMode === 'board'} data-tip="列表式追番看板（按更新时间排序）" on:click={() => (trackingMode = 'board')}>追番表</button>
                <button class:on={trackingMode === 'calendar'} aria-pressed={trackingMode === 'calendar'} data-tip="日历式排期看板（按播出日期）" on:click={() => (trackingMode = 'calendar')}>排期表</button>
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
        {:else if activeTab === 'stats'}
            <StatsBoard {entries} {excerptCounts} {activityLog} {onAdd} {onOpenEntry} {onGenerateReport} {yearReports} {onOpenReport} {onRecordJournal} />
        {:else}
            <MediaList
                entries={activeTab === 'media' ? entries.filter((e) => MEDIA_TYPES.includes(e.type)) : entries}
                {posterUrl}
                {colorTheme}
                {defaultViewMode}
                {posterDensity}
                {posterColumns}
                {onAdd}
                {onEditEntry}
                {onOpenEntry}
                {onOpenLink}
                {onWatch}
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
                lockType={activeTab === 'media' ? null : activeTab}
                typePool={activeTab === 'media' ? MEDIA_TYPES : null} />
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
