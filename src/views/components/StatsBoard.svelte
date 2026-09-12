<script lang="ts">
    // 统计页（17-统计页完全重构规划落地）：数据优先 / 克制视觉 / 对齐 UI-GUIDE
    //   页眉动作（生成今年总结 + 往年报告下拉）→ KPI 行（今年看完/本月看完/在追/本月计划/库内总数）
    //   → 月度看完趋势 × 今年动态 → 概览（数据主体）→ 快捷行；想看清单弹层保留
    // 移除（规划 D1/D2/D3 + 年度目标丢弃）：类型分布玻璃卡（子类型并入影视列）、霓虹热力图、
    //   年度目标圆环（localStorage 键不再读写）、emoji 图标（全量替换为文本/Lucide 白名单）
    import type { ActivityEvent, MediaEntry, EntryType } from 'data/types';
    import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from 'data/types';
    import {
        durationStats,
        finishedInYear,
        monthlyFinished,
        topRatedInYear,
        trendShownMonths,
    } from 'pure/stats';
    import { FEED_RANGE_WORDS, collectFeed, feedSpan, formatFeedTime, groupFeed, type FeedRange } from 'pure/activityFeed';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），概览书籍列用 */
    export let excerptCounts: Record<string, number> = {};
    export let onAdd: (t?: EntryType) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    /** 生成今年年度总结（保存到 {libraryDir}/报告/YYYY-年度总结.md 并打开） */
    export let onGenerateReport: () => Promise<void> = async () => {};
    /** 已生成的往年报告（年份降序；main.listYearReports） */
    export let yearReports: { year: number; path: string }[] = [];

    /** 活动日志（状态翻转）：今日面板数据源 */
    export let activityLog: ActivityEvent[] = [];

    /** 一键把动态写进当天日记：**范围跟随当前 日/周/月/年 切换** */
    export let onRecordJournal: (range: FeedRange) => Promise<void> = async () => {};

    let recording = false;
    /** 记录：把「当前范围」的动态写成打卡区块（切到周就记本周、切到月就记本月） */
    async function recordCurrent() {
        if (recording) return;
        recording = true;
        try {
            await onRecordJournal(feedRange);
        } finally {
            recording = false;
        }
    }
    /** 打开某份年度报告（main.openReport） */
    export let onOpenReport: (path: string) => void = () => {};

    const now = new Date();
    const year = now.getFullYear();
    const yearStr = String(year);
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthPrefix = `${yearStr}-${pad(now.getMonth() + 1)}`;

    // ── KPI 行（纯数字卡；年度目标已弃用，不再有环/百分比） ──
    $: watchedThisYear = entries.filter((e) => finishedInYear(e, year)).length;
    $: watchedThisMonth = entries.filter((e) => e.watchedDate?.startsWith(monthPrefix)).length;
    $: watchingNow = entries.filter((e) => e.status === 'watching').length;
    $: plannedThisMonth = entries.filter((e) => !!e.plannedDate && e.plannedDate.startsWith(monthPrefix)).length;
    $: libraryTotal = entries.length;

    // ── 动态时间轴（合并原「今日」+「今年动态」）：日 / 周 / 月 / 年 日历范围切换 ──
    const FEED_RANGES: { value: FeedRange; label: string }[] = [
        { value: 'day', label: '日' },
        { value: 'week', label: '周' },
        { value: 'month', label: '月' },
        { value: 'year', label: '年' },
    ];
    let feedRange: FeedRange = 'day';
    $: span = feedSpan(feedRange);
    $: feed = collectFeed(entries, activityLog, span);
    $: feedCounts = feed.reduce(
        (acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }),
        {} as Partial<Record<string, number>>,
    );
    $: rangeWord = FEED_RANGE_WORDS[feedRange];
    /** 周/月/年为「周期汇总」视图（周按日 / 月按周 / 年按月分块，块内归并成行）；日视图保留逐条时间轴 */
    $: feedGroups = feedRange === 'day' ? [] : groupFeed(feed, feedRange);
    $: feedSummary = ([
        ['status', '状态变更'],
        ['created', '新增'],
        ['track', '追更'],
        ['plan', '计划'],
        ['watch', '完成'],
        ['play', '游玩'],
    ] as const)
        .filter(([k]) => feedCounts[k])
        .map(([k, label]) => `${label} ${feedCounts[k]}`)
        .join(' · ');
    const todayStr = `${yearStr}-${monthPrefix.slice(5)}-${pad(now.getDate())}`;
    function fmtDate(d: string): string {
        if (d === todayStr) return '今天';
        return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
    }

    // ── 概览（数据主体） ──
    const isMedia = (t: EntryType) => t === 'movie' || t === 'tv' || t === 'anime';
    const isBook = (t: EntryType) => t === 'book';
    const isGame = (t: EntryType) => t === 'game';
    const isMusic = (t: EntryType) => t === 'music';
    $: mediaEntries = entries.filter((e) => isMedia(e.type));
    $: bookEntries = entries.filter((e) => isBook(e.type));
    $: gameEntries = entries.filter((e) => isGame(e.type));
    $: musicEntries = entries.filter((e) => isMusic(e.type));
    $: mediaFinished = mediaEntries.filter((e) => finishedInYear(e, year)).length;
    $: bookFinished = bookEntries.filter((e) => finishedInYear(e, year)).length;
    $: gameFinished = gameEntries.filter((e) => finishedInYear(e, year)).length;
    $: musicFinished = musicEntries.filter((e) => finishedInYear(e, year)).length;
    $: mediaWatching = mediaEntries.filter((e) => e.status === 'watching').length;
    $: bookReading = bookEntries.filter((e) => e.status === 'watching').length;
    $: gameActive = gameEntries.filter((e) => (e.playSessions?.length ?? 0) > 0).length;
    $: musicWatching = musicEntries.filter((e) => e.status === 'watching').length;
    $: musicCount = musicEntries.length;
    /** 音乐总时长（分钟，durationMin 求和，无值回退曲目数） */
    $: musicDurMinutes = musicEntries.reduce((sum, e) => sum + (e.durationMin ?? 0), 0) || musicCount;
    $: mediaSub = {
        movie: mediaEntries.filter((e) => e.type === 'movie').length,
        tv: mediaEntries.filter((e) => e.type === 'tv').length,
        anime: mediaEntries.filter((e) => e.type === 'anime').length,
    };
    /** 影视列子类型计数文字（D1：原类型分布大卡信息就近并入） */
    $: mediaSubText = `电影 ${mediaSub.movie} · 剧集 ${mediaSub.tv} · 动画 ${mediaSub.anime}`;
    $: bookDur = durationStats(bookEntries);
    $: mediaDur = durationStats(mediaEntries);
    $: gameDur = durationStats(gameEntries);
    $: bookExcerpts = bookEntries.reduce((sum, e) => sum + (excerptCounts[e.id] ?? 0), 0);
    $: bookTop = topRatedInYear(bookEntries, year, 3);
    $: mediaTop = topRatedInYear(mediaEntries, year, 3);
    $: gameTop = topRatedInYear(gameEntries, year, 3);
    $: musicTop = topRatedInYear(musicEntries, year, 3);
    /** 分钟 → 小时（保留 1 位小数，无值显示 —） */
    function fmtHours(minutes: number): string {
        if (!minutes) return '—';
        const h = minutes / 60;
        return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
    }

    // ── 月度看完趋势（折线；共享 1-12 月 X 轴 + 图例） ──
    $: monthlyBooks = monthlyFinished(bookEntries, year);
    $: monthlyMedia = monthlyFinished(mediaEntries, year);
    $: monthlyGames = monthlyFinished(gameEntries, year);
    $: monthlyMusic = monthlyFinished(musicEntries, year);
    $: monthlyAllMax = Math.max(1, ...monthlyBooks, ...monthlyMedia, ...monthlyGames, ...monthlyMusic);
    /** 趋势序列（含「本年是否有数据」标记：0 条的类型不画线——否则多条零值会叠成一条无信息量的贴底线） */
    $: trendSeries = [
        { label: '书籍', color: '#5f9d70', arr: monthlyBooks },
        { label: '影视', color: '#4f8cc9', arr: monthlyMedia },
        { label: '游戏', color: '#c98f4a', arr: monthlyGames },
        { label: '音乐', color: '#1f9b90', arr: monthlyMusic },
    ].map((t) => ({ ...t, on: t.arr.some((v) => v > 0) }));
    $: trendEmpty =
        monthlyAllMax <= 1 &&
        [...monthlyBooks, ...monthlyMedia, ...monthlyGames, ...monthlyMusic].every((v) => v === 0);
    const TREND_W = 620;
    const TREND_H = 130;
    /** T2 截断：当年视图实线/点位只画到当前月，未来月份刻度淡显（2026-09-12 用户批准） */
    $: shownMonths = trendShownMonths(year, now);
    /** T3 悬停：气泡锚定月份（0-11），列出该月各在画序列的值 */
    let hoverM: number | null = null;
    $: hoverRows =
        hoverM === null
            ? []
            : trendSeries.filter((t) => t.on).map((t) => ({ label: t.label, color: t.color, v: t.arr[hoverM as number] }));
    /** 单点 Y 坐标（折线与圆点共用） */
    function trendPtY(v: number): number {
        return TREND_H - TREND_PAD_Y - (v / monthlyAllMax) * (TREND_H - 2 * TREND_PAD_Y);
    }
    const TREND_PAD_X = 26;
    const TREND_PAD_Y = 10;
    function trendPts(arr: number[]): string {
        return arr.slice(0, shownMonths)
            .map((v, i) => {
                const x = TREND_PAD_X + (i * (TREND_W - 2 * TREND_PAD_X)) / 11;
                const y = trendPtY(v);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
    }
    function trendTickX(i: number): number {
        return TREND_PAD_X + (i * (TREND_W - 2 * TREND_PAD_X)) / 11;
    }

    // ── 快捷行：想看清单弹层 ──
    let wantOpen = false;
    $: wantList = entries
        .filter((e) => e.status === 'want')
        .sort((a, b) => (a.plannedDate ?? '9999').localeCompare(b.plannedDate ?? '9999'));
    function randomPick() {
        if (!entries.length) return;
        onOpenEntry(entries[Math.floor(Math.random() * entries.length)].id);
    }

    // ── 往年报告下拉 ──
    let reportMenuOpen = false;
    function openReport(p: string) {
        reportMenuOpen = false;
        onOpenReport(p);
    }
</script>

<div class="rl-sb">
    <!-- 页眉：标题 + 动作（生成今年总结 / 往年报告下拉） -->
    <header class="rl-s-head">
        <div class="rl-s-title">{year} 统计</div>
        <div class="rl-s-actions">
            <button class="rl-s-qbtn" on:click={() => onAdd()}><Icon icon="plus" size={13} /> 添加条目</button>
            <button class="rl-s-qbtn" on:click={randomPick}><Icon icon="shuffle" size={13} /> 随机推荐</button>
            <button class="rl-s-qbtn" on:click={() => (wantOpen = true)}><Icon icon="list" size={13} /> 想看的清单（{wantList.length}）</button>
            <button class="rl-btn rl-btn-primary" on:click={() => void onGenerateReport()}>生成今年总结</button>
            <div class="rl-dd">
                <button class="rl-btn" on:click={() => (reportMenuOpen = !reportMenuOpen)}>
                    往年报告<Icon icon="chevron-down" size={13} />
                </button>
                {#if reportMenuOpen}
                    <div class="rl-dd-back" on:click={() => (reportMenuOpen = false)} />
                    <div class="rl-dd-menu">
                        {#if yearReports.length === 0}
                            <div class="rl-dd-empty">还没有往年年报 — 先「生成今年总结」，明年起这里会列出历史报告</div>
                        {:else}
                            {#each yearReports as r}
                                <button class="rl-dd-item" on:click={() => openReport(r.path)}>
                                    <b>{r.year}</b> 年度总结<span class="rl-dd-go">›</span>
                                </button>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </header>

    <!-- KPI 行：纯数字卡，无环无百分比 -->
    <section class="rl-kpis">
        <div class="rl-kpi"><b>{watchedThisYear}</b><span>今年看完</span></div>
        <div class="rl-kpi"><b>{watchedThisMonth}</b><span>本月看完</span></div>
        <div class="rl-kpi"><b>{watchingNow}</b><span>在追/在读</span></div>
        <div class="rl-kpi"><b>{plannedThisMonth}</b><span>本月计划</span></div>
        <div class="rl-kpi"><b>{libraryTotal}</b><span>库内总数</span></div>
    </section>

    <!-- 动态：状态变更 / 新增 / 追更 / 计划 / 游玩按 日·周·月·年 查看；一键把当天动态写进日记 -->
    <section class="rl-s-panel rl-s-today">
        <div class="rl-s-panel-title">
            动态 · {span.label}
            <span class="rl-s-title-right">
                <span class="rl-feed-switch" role="group" aria-label="动态时间范围">
                    {#each FEED_RANGES as r}
                        <button class="rl-feed-tab" class:on={feedRange === r.value} on:click={() => (feedRange = r.value)}>{r.label}</button>
                    {/each}
                </span>
                <button class="rl-btn rl-today-rec" disabled={recording || feed.length === 0} data-tip={feed.length === 0 ? `${rangeWord}还没有观影/阅读动态` : `把${rangeWord}的动态写成打卡区块，写入当天日记（重复点击只更新该区块）`} on:click={() => void recordCurrent()}>
                    {recording ? '记录中…' : `记录${rangeWord}`}
                </button>
            </span>
        </div>
        {#if feed.length === 0}
            <div class="rl-s-empty">{rangeWord}还没有观影/阅读动态 — 标记「在看 / 已看」或添加条目后会出现在这里</div>
        {:else if feedRange === 'day'}
            <div class="rl-today-list">
                {#each feed as f}
                    <div class="rl-today-item" role="link" tabindex="0" data-tip="打开笔记"
                        on:click={() => onOpenEntry(f.id)}
                        on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(f.id); }}>
                        <span class="rl-today-time">{formatFeedTime(f, feedRange)}</span>
                        <span class="rl-today-badge {f.status ? `rl-today-${f.status}` : 'rl-today-kind'}">{f.text}</span>
                        <span class="rl-today-title">《{f.title}》</span>
                    </div>
                {/each}
            </div>
            <div class="rl-today-foot">共 {feed.length} 条动态（{feedSummary}）</div>
        {:else}
            <!-- 周 / 月 / 年：逐级细分的周期汇总（周按日分块、月按周分块、年按月分块），块内归并成「已读《A》《B》」这样的行 -->
            <div class="rl-feed-groups">
                {#each feedGroups as g}
                    {#if g.label}
                        <div class="rl-feed-group-title">{g.label}{#if g.range}<span class="rl-feed-group-range">{g.range}</span>{/if}<span class="rl-feed-group-n">共 {g.total} 条</span></div>
                    {/if}
                    <div class="rl-feed-rows">
                        {#each g.rows as row}
                            <div class="rl-feed-row">
                                <span class="rl-feed-row-label">{row.label}</span>
                                <div class="rl-feed-row-items">
                                    {#each row.items as it}
                                        <span class="rl-feed-chip" role="link" tabindex="0" data-tip="打开笔记"
                                            on:click={() => onOpenEntry(it.id)}
                                            on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(it.id); }}>《{it.title}》{#if it.detail}<i class="rl-feed-detail">{it.detail}</i>{/if}</span>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>
            <div class="rl-today-foot">共 {feed.length} 条动态（{feedSummary}）</div>
        {/if}
    </section>

    <!-- 中排：月度看完趋势 × 今年动态 -->
    <div class="rl-s-mid">
        <section class="rl-s-panel rl-s-trend">
            <div class="rl-s-panel-title">
                {year} 月度看完趋势
                <span class="rl-trend-legend">
                    {#each trendSeries as s}
                        <span class="rl-tg" class:rl-tg-off={!s.on}>
                            <i class="rl-tg-dot" style={`background:${s.color}`}></i>{s.label}{s.on ? '' : ' 0'}
                        </span>
                    {/each}
                </span>
            </div>
            {#if trendEmpty}
                <div class="rl-s-empty">本年暂无完成记录 — 添加并标记观看/阅读/通关/收听后显示趋势</div>
            {:else}
                <svg class="rl-trend" viewBox={`0 0 ${TREND_W} ${TREND_H}`} preserveAspectRatio="none" role="img" aria-label="{year} 月度看完趋势折线图">
                    {#each [0, 1, 2, 3, 4] as g}
                        <line class="rl-trend-grid" x1={TREND_PAD_X} y1={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} x2={TREND_W - TREND_PAD_X} y2={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} />
                    {/each}
                    <text class="rl-trend-y" x="2" y={TREND_PAD_Y + 3} text-anchor="start">{monthlyAllMax}</text>
                    <text class="rl-trend-y" x="2" y={TREND_H - TREND_PAD_Y + 3} text-anchor="start">0</text>
                    {#each trendSeries as s}
                        {#if s.on}
                            <polyline class="rl-trend-line" points={trendPts(s.arr)} stroke={s.color} />
                        {/if}
                    {/each}
                    {#each trendSeries as s}
                        {#if s.on}
                            {#each s.arr.slice(0, shownMonths) as v, i}
                                {#if v > 0}
                                    <circle class="rl-trend-dot" cx={trendTickX(i)} cy={trendPtY(v)} r="2.5" fill={s.color} />
                                {/if}
                            {/each}
                        {/if}
                    {/each}
                    {#each monthlyBooks as _, i}
                        <text class="rl-trend-tick" class:rl-trend-tick-future={i + 1 > shownMonths} x={trendTickX(i)} y={TREND_H - 1} text-anchor="middle">{i + 1}</text>
                    {/each}
                    {#each monthlyBooks as _, i}
                        {#if i < shownMonths}
                            <rect class="rl-trend-hot" role="presentation" aria-hidden="true" x={trendTickX(i) - (TREND_W - 2 * TREND_PAD_X) / 22} y="0" width={(TREND_W - 2 * TREND_PAD_X) / 11} height={TREND_H} fill="transparent" on:mouseenter={() => (hoverM = i)} on:mouseleave={() => (hoverM = null)} />
                        {/if}
                    {/each}
                </svg>
            {/if}
            {#if hoverM !== null && hoverRows.length > 0}
                <div class="rl-trend-tip" style={`left:${(trendTickX(hoverM) / TREND_W) * 100}%; transform:${hoverM < 2 ? 'none' : hoverM > 9 ? 'translateX(-100%)' : 'translateX(-50%)'};`}>
                    <b>{hoverM + 1} 月</b>
                    {#each hoverRows as r}
                        <span><i style={`background:${r.color}`}></i>{r.label} {r.v}</span>
                    {/each}
                </div>
            {/if}
        </section>

    <!-- 概览：数据主体（子类型计数并入影视列，D1）——与趋势并排（1:1），窄容器内部自适应 2×2 -->
    <section class="rl-s-panel rl-s-part">
        <div class="rl-s-panel-title">{year} 概览</div>
        <div class="rl-part-grid">
            <!-- 书籍 -->
            <div class="rl-part-col">
                <div class="rl-part-head"><Icon icon="book-open" size={13} /> 书籍</div>
                <div class="rl-part-metrics">
                    <div class="rl-part-m"><b>{bookFinished}</b><span>读完</span></div>
                    <div class="rl-part-m"><b>{bookReading}</b><span>在读</span></div>
                    <div class="rl-part-m"><b>{bookDur.bookPages}</b><span>已读页</span></div>
                    <div class="rl-part-m"><b>{bookExcerpts}</b><span>摘抄</span></div>
                </div>
                <div class="rl-part-top">
                    <div class="rl-part-top-title">Top 3</div>
                    {#if bookTop.length === 0}
                        <div class="rl-part-top-empty">本年暂无读完的书</div>
                    {:else}
                        {#each bookTop as e}
                            <div class="rl-part-top-item" role="link" tabindex="0" data-tip="打开笔记" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>★{e.rating} 《{e.title}》</div>
                        {/each}
                    {/if}
                </div>
            </div>
            <!-- 影视（子类型计数文字行） -->
            <div class="rl-part-col">
                <div class="rl-part-head"><Icon icon="film" size={13} /> 影视</div>
                <div class="rl-part-sub">{mediaSubText}</div>
                <div class="rl-part-metrics">
                    <div class="rl-part-m"><b>{mediaFinished}</b><span>看完</span></div>
                    <div class="rl-part-m"><b>{mediaWatching}</b><span>在追</span></div>
                    <div class="rl-part-m"><b>{fmtHours(mediaDur.movieMinutes)}</b><span>观影</span></div>
                    <div class="rl-part-m"><b>{mediaDur.episodes}</b><span>追剧集</span></div>
                </div>
                <div class="rl-part-top">
                    <div class="rl-part-top-title">Top 3</div>
                    {#if mediaTop.length === 0}
                        <div class="rl-part-top-empty">本年暂无看完的影视</div>
                    {:else}
                        {#each mediaTop as e}
                            <div class="rl-part-top-item" role="link" tabindex="0" data-tip="打开笔记" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>★{e.rating} 《{e.title}》</div>
                        {/each}
                    {/if}
                </div>
            </div>
            <!-- 游戏 -->
            <div class="rl-part-col">
                <div class="rl-part-head"><Icon icon="gamepad-2" size={13} /> 游戏</div>
                <div class="rl-part-metrics">
                    <div class="rl-part-m"><b>{gameFinished}</b><span>通关</span></div>
                    <div class="rl-part-m"><b>{gameActive}</b><span>玩过</span></div>
                    <div class="rl-part-m"><b>{fmtHours(gameDur.playMinutes)}</b><span>游玩</span></div>
                    <div class="rl-part-m"><b>{gameDur.playSessions}</b><span>记录</span></div>
                </div>
                <div class="rl-part-top">
                    <div class="rl-part-top-title">Top 3</div>
                    {#if gameTop.length === 0}
                        <div class="rl-part-top-empty">本年暂无通关的游戏</div>
                    {:else}
                        {#each gameTop as e}
                            <div class="rl-part-top-item" role="link" tabindex="0" data-tip="打开笔记" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>★{e.rating} 《{e.title}》</div>
                        {/each}
                    {/if}
                </div>
            </div>
            <!-- 音乐 -->
            <div class="rl-part-col">
                <div class="rl-part-head"><Icon icon="music" size={13} /> 音乐</div>
                <div class="rl-part-metrics">
                    <div class="rl-part-m"><b>{musicFinished}</b><span>已听</span></div>
                    <div class="rl-part-m"><b>{musicWatching}</b><span>在听</span></div>
                    <div class="rl-part-m"><b>{musicCount}</b><span>曲目</span></div>
                    <div class="rl-part-m"><b>{fmtHours(musicDurMinutes)}</b><span>时长</span></div>
                </div>
                <div class="rl-part-top">
                    <div class="rl-part-top-title">Top 3</div>
                    {#if musicTop.length === 0}
                        <div class="rl-part-top-empty">本年暂无已听的歌</div>
                    {:else}
                        {#each musicTop as e}
                            <div class="rl-part-top-item" role="link" tabindex="0" data-tip="打开笔记" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>★{e.rating} 《{e.title}》</div>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    </section>
    </div>

    <!-- 快捷行 -->
</div>

<!-- 想看清单弹层 -->
{#if wantOpen}
    <div class="rl-want-mask" on:click={() => (wantOpen = false)} on:contextmenu|preventDefault>
        <div class="rl-want-panel" on:click|stopPropagation>
            <div class="rl-want-head">
                <span>想看的清单（{wantList.length}）</span>
                <button class="rl-btn" data-tip="关闭想看清单" on:click={() => (wantOpen = false)}>✕ 关闭</button>
            </div>
            {#if wantList.length === 0}
                <div class="rl-s-empty">没有「想看」的条目 — 标记为「想看」后出现在这里</div>
            {:else}
                <ul class="rl-want-list">
                    {#each wantList as e}
                        <li>
                            <span class="rl-want-type">{ENTRY_TYPE_LABELS[e.type]}</span>
                            <span class="rl-want-title" role="link" tabindex="0" data-tip="打开笔记" on:click={() => { wantOpen = false; onOpenEntry(e.id); }} on:keydown={(ev) => { if (ev.key === 'Enter') { wantOpen = false; onOpenEntry(e.id); } }}>{e.title}</span>
                            <span class="rl-want-meta">{e.year ?? ''}{e.plannedDate ? ` · 计划 ${fmtDate(e.plannedDate)}` : ''}</span>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    </div>
{/if}

<style>
    /* ── 页面骨架（17-规划：数据优先，克制卡片，CSS 变量，无渐变/霓虹/玻璃拟态） ── */
    .rl-sb { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

    .rl-s-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .rl-s-title { font-size: 16px; font-weight: 800; color: var(--text-normal); }
    .rl-s-actions { display: flex; align-items: center; gap: 8px; }

    /* 通用按钮（本页作用域；克制小按钮） */
    .rl-btn {
        font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        border: 1px solid var(--background-modifier-border); border-radius: 7px;
        background: var(--background-primary); color: var(--text-normal);
        padding: 5px 12px; transition: background .15s ease;
    }
    .rl-btn:hover { background: var(--background-modifier-hover); }
    .rl-btn-primary { background: var(--interactive-accent); border-color: transparent; color: var(--text-on-accent); }
    .rl-btn-primary:hover { background: var(--interactive-accent); opacity: .9; }

    /* 面板 */
    .rl-s-panel {
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 10px; padding: 12px 14px; min-width: 0;
    }
    .rl-s-panel-title { font-size: 12px; font-weight: 700; color: var(--text-normal); margin-bottom: 10px; display: flex; align-items: baseline; gap: 10px; }
    .rl-s-empty { font-size: 12px; color: var(--text-faint); text-align: center; padding: 22px 0; }

    /* ── KPI 行 ── */
    .rl-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
    .rl-kpi {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 10px; padding: 12px 4px 10px;
    }
    .rl-kpi b { font-size: 23px; font-weight: 800; color: var(--text-normal); line-height: 1.1; }
    .rl-kpi span { font-size: 10.5px; color: var(--text-muted); }

    /* ── 趋势 × 概览并排（1.4:1）；≤900px 回落上下堆叠（见下方媒体查询） ── */
    .rl-s-mid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
    /* 趋势标题 + 图例：窄列里图例允许换行，避免溢出 */
    .rl-s-trend .rl-s-panel-title { flex-wrap: wrap; }
    .rl-trend-legend { margin-left: auto; display: inline-flex; align-items: center; gap: 9px; }
    .rl-trend-legend .rl-tg { font-size: 10px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .rl-tg-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
    /* 本年 0 完成的类型：图例灰显并标 0（折线不画，避免贴底重叠） */
    .rl-trend-legend .rl-tg-off { opacity: .45; }
    .rl-trend { width: 100%; height: 130px; display: block; }
    .rl-trend-grid { stroke: var(--background-modifier-border); stroke-width: 1; stroke-dasharray: 3 4; }
    .rl-trend-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .92; }
    .rl-trend-tick { font-size: 9px; fill: var(--text-faint); }
    .rl-trend-tick-future { opacity: .35; }
    .rl-trend-dot { stroke: var(--background-primary); stroke-width: 1; }
    .rl-trend-y { font-size: 9px; fill: var(--text-faint); }
    .rl-trend-hot { cursor: crosshair; }
    .rl-s-trend { position: relative; }
    .rl-trend-tip {
        position: absolute; top: 26px; z-index: 5; pointer-events: none;
        display: flex; flex-direction: column; gap: 2px; white-space: nowrap;
        background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px); padding: 4px 8px; font-size: 11px; color: var(--text-normal);
    }
    .rl-trend-tip b { font-weight: 600; }
    .rl-trend-tip span { display: inline-flex; align-items: center; gap: 4px; }
    .rl-trend-tip i { width: 8px; height: 8px; border-radius: 2px; flex: none; display: inline-block; }

    /* ── 概览（容器查询自适应：并排时容器约四成宽 → 内部 2×2；堆叠全宽 → 4 列） ── */
    .rl-s-part { container-type: inline-size; }
    .rl-part-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    @container (min-width: 560px) {
        .rl-part-grid { grid-template-columns: repeat(4, 1fr); }
    }
    .rl-part-col {
        display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
        background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
        border-radius: 10px; min-width: 0;
    }
    .rl-part-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-normal); }
    .rl-part-sub { font-size: 10px; color: var(--text-faint); margin-top: -5px; }
    .rl-part-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .rl-part-m {
        display: flex; flex-direction: column; align-items: center; gap: 1px;
        background: var(--background-primary); border-radius: 7px; padding: 5px 2px;
    }
    .rl-part-m b { font-size: 15px; font-weight: 800; color: var(--text-normal); }
    .rl-part-m span { font-size: 9.5px; color: var(--text-faint); }
    .rl-part-top { margin-top: auto; }
    .rl-part-top-title { font-size: 10px; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; }
    .rl-part-top-item {
        font-size: 11.5px; color: var(--text-normal); padding: 2px 4px; border-radius: 5px;
        cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rl-part-top-item:hover { background: var(--background-modifier-hover); color: var(--interactive-accent); }
    .rl-part-top-empty { font-size: 11px; color: var(--text-faint); opacity: .85; padding: 3px 2px; }

    /* ── 快捷行 ── */
    /* 快捷按钮（原独立快捷行 → 页眉动作区，在「生成今年总结」左侧） */
    .rl-s-qbtn {
        font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px);
        background: var(--background-primary); color: var(--text-muted);
        padding: 6px 12px; transition: background .15s ease, color .15s ease;
    }
    .rl-s-qbtn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }

    /* ── 往年报告下拉 ── */
    .rl-dd { position: relative; }
    .rl-dd-back { position: fixed; inset: 0; z-index: 48; }
    .rl-dd-menu {
        position: absolute; right: 0; top: calc(100% + 5px); z-index: 49;
        min-width: 210px; max-height: 320px; overflow-y: auto;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 9px; box-shadow: 0 8px 24px rgba(0, 0, 0, .16);
        padding: 5px; display: flex; flex-direction: column; gap: 2px;
    }
    .rl-dd-empty { font-size: 11px; color: var(--text-faint); padding: 8px 10px; line-height: 1.5; }
    .rl-dd-item {
        font-family: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
        display: flex; align-items: center; gap: 7px;
        border: none; background: transparent; color: var(--text-normal);
        padding: 7px 9px; border-radius: var(--rl-t-radius-md, 6px);
    }
    .rl-dd-item:hover { background: var(--background-modifier-hover); }
    .rl-dd-item b { color: var(--interactive-accent); font-size: 12.5px; }
    .rl-dd-go { margin-left: auto; color: var(--text-faint); }

    /* ── 想看清单弹层 ── */
    .rl-want-mask { position: fixed; inset: 0; z-index: 999; background: rgba(0, 0, 0, .35); display: flex; align-items: center; justify-content: center; }
    .rl-want-panel { width: min(560px, 90vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--background-primary); border-radius: 12px; box-shadow: 0 8px 30px rgba(0, 0, 0, .25); padding: 14px 16px; }
    .rl-want-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; margin-bottom: 10px; }
    .rl-want-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .rl-want-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; padding: 5px 8px; border-radius: var(--rl-t-radius-md, 6px); }
    .rl-want-list li:hover { background: var(--background-modifier-hover); }
    .rl-want-type { flex: none; font-size: 10px; color: var(--text-muted); background: var(--background-modifier-border); border-radius: 5px; padding: 1px 7px; }
    .rl-want-title { cursor: pointer; font-weight: 600; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-want-title:hover { color: var(--interactive-accent); text-decoration: underline; }
    .rl-want-meta { flex: none; font-size: 11px; color: var(--text-faint); }

    /* ── 今日记录（状态变更「何时何分」+ 新增条目数；一键写进当天日记） ── */
    .rl-s-today .rl-s-panel-title { justify-content: space-between; align-items: center; }
    .rl-s-title-right { margin-left: auto; display: inline-flex; align-items: center; gap: 10px; }
    /* 时间范围切换（日/周/月/年）：分段控件，当前项用 accent 实心 */
    .rl-feed-switch { display: inline-flex; border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px); overflow: hidden; }
    .rl-feed-tab {
        font-family: inherit; font-size: 11px; padding: 2px 9px; border: none;
        background: transparent; color: var(--text-muted); cursor: pointer;
    }
    .rl-feed-tab:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-feed-tab.on { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    /* 周期汇总（周/月/年）：组标题（年视图按月）+ 归并行的标题清单；超高同样内部滚动 */
    .rl-feed-groups { max-height: 260px; overflow-y: auto; overscroll-behavior: contain; padding-right: 6px; }
    .rl-feed-group-title { display: flex; align-items: baseline; gap: 8px; font-size: 11px; font-weight: 600; color: var(--text-muted); margin: 6px 0 4px; }
    .rl-feed-group-title:first-child { margin-top: 0; }
    .rl-feed-group-n { font-weight: 400; font-size: 10px; color: var(--text-faint); }
    .rl-feed-group-range { font-weight: 400; font-size: 10px; color: var(--text-faint); }
    .rl-feed-rows { display: flex; flex-direction: column; gap: 4px; }
    .rl-feed-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
    .rl-feed-row-label { flex: none; min-width: 42px; font-size: 11px; color: var(--text-muted); }
    .rl-feed-row-items { flex: 1 1 auto; display: flex; flex-wrap: wrap; gap: 2px 10px; min-width: 0; }
    .rl-feed-chip { color: var(--text-normal); cursor: pointer; }
    .rl-feed-chip:hover { color: var(--interactive-accent); }
    .rl-feed-detail { font-style: normal; font-size: 10px; color: var(--text-faint); margin-left: 3px; }
    /* 非状态类动态（新增/追更/计划/完成/游玩）的徽标：中性灰，不借用状态色 */
    .rl-today-badge.rl-today-kind { background: var(--background-modifier-hover); color: var(--text-faint); }
    .rl-today-rec { flex: none; font-size: 11px; padding: 2px 10px; cursor: pointer; }
    .rl-today-rec:disabled { opacity: .45; cursor: not-allowed; }
    /* 今日动态列表：一行一条（时间 + 状态 + 作品），条目多时纵向滚动（滑块见 styles.css 的豁免规则） */
    .rl-today-list {
        display: flex; flex-direction: column; gap: 4px;
        max-height: 180px; overflow-y: auto; overscroll-behavior: contain;
        padding-right: 6px; /* 给滑块留位，避免压住文字 */
    }
    .rl-today-item { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
    .rl-today-time { flex: none; min-width: 40px; font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
    .rl-today-badge { flex: none; font-size: 10px; border-radius: 5px; padding: 1px 7px; background: var(--background-modifier-border); color: var(--text-muted); }
    .rl-today-badge.rl-today-watched { color: var(--rl-good); }
    .rl-today-badge.rl-today-watching { color: var(--interactive-accent); }
    .rl-today-title { flex: 1 1 auto; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-today-foot { margin-top: 4px; font-size: 11px; color: var(--text-faint); }

    /* 窄屏收敛：概览 2 列、KPI 保持可读 */
    @media (max-width: 900px) {
        .rl-s-mid { grid-template-columns: 1fr; }
        .rl-part-grid { grid-template-columns: repeat(2, 1fr); }
        .rl-kpis { grid-template-columns: repeat(3, 1fr); }
    }
</style>
