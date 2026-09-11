<script lang="ts">
    import { onMount } from 'svelte';
    import MediaList from './MediaList.svelte';
    import CalendarBoard from './CalendarBoard.svelte';
    import TrackingBoard from './TrackingBoard.svelte';
    import StatsBoard from './StatsBoard.svelte';
    import { ENTRY_TYPE_LABELS, type ColorTheme, type EntryType } from 'data/types';
    import type { ActivityEvent, MediaEntry, MediaStatus } from 'data/types';
    import type { FeedRange } from 'pure/activityFeed';
    import { MEDIA_TYPES, type HomeTab } from '../tab';
    import Icon from './Icon.svelte';

    /** Tab 顺序：追番表(月历) → 书籍 → 影视(动画/剧集/电影聚合) → 游戏 → 统计 */
    const TAB_ORDER: HomeTab[] = ['tracking', 'book', 'media', 'game', 'music', 'stats'];

    /** 页签图标（Obsidian 内建 Lucide）：计划表/书籍/影视/游戏/音乐/统计 */
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
    export let onAdd: (t?: EntryType) => void = () => {};
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
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list */
    export let defaultViewMode: 'grid' | 'list' = 'grid';

    let activeTab: HomeTab = initialTab;
    /** 计划表视图：追更表 / 月历 */
    let trackingMode: 'board' | 'calendar' = 'board';

    function tabLabel(t: HomeTab): string {
        if (t === 'tracking') return '计划表';
        if (t === 'media') return '影视';
        if (t === 'stats') return '统计';
        return ENTRY_TYPE_LABELS[t];
    }

    function switchTab(t: HomeTab) {
        activeTab = t;
        onTabChange(t);
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
        return () => scrollEl?.removeEventListener('scroll', onScroll);
    });

    function scrollToTop() {
        scrollEl?.scrollTo({ top: 0, behavior: 'smooth' });
    }
</script>

<div class="rl-home" bind:this={rootEl}>
    <div class="rl-tabs" role="tablist" aria-label="ReelLudic">
        {#each TAB_ORDER as t}
            <button
                class:on={activeTab === t}
                role="tab"
                aria-selected={activeTab === t}
                on:click={() => switchTab(t)}>
                <Icon icon={tabIcon(t)} size={13} />
                {tabLabel(t)}
            </button>
        {/each}
    </div>

    <div class="rl-tab-body">
        {#if activeTab === 'tracking'}
            <div class="rl-tracking-switch">
                <button class:on={trackingMode === 'board'} on:click={() => (trackingMode = 'board')}>追番表</button>
                <button class:on={trackingMode === 'calendar'} on:click={() => (trackingMode = 'calendar')}>排期表</button>
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
                {excerptCounts}
                {posterUrl}
                {colorTheme}
                {defaultViewMode}
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
        border-radius: 6px 6px 0 0;
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
    .rl-tab-body { flex: 1; min-width: 0; }
</style>
