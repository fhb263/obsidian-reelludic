<script lang="ts">
    // 统计页三层重构（2026-09-22 / #371，用户批准的方向）：
    //   ① 核心指标 = 1 主（今年看完 + 同比徽标 + 主 CTA 生成今年总结 / 往年报告）+ 4 辅；页眉只留标题
    //   ② 动态（「添加 / 随机 / 想看清单」三个次要入口**常驻标题行**；空态只给说明，⛔ 不重复那三个按钮）
    //   ③④ 月度趋势 + 分类概览 **左右并排**（`.rl-s-mid`：50/50 + gap 12，窄屏 <900px 退单列）
    // 纯逻辑全部下沉：pure/stats.ts（完成判定 / 月度序列 / 截断月份）+ pure/statOverview.ts
    //   （同比 + 环比 + 分类概览聚合 + 趋势序列打包）——组件只做渲染，口径都有同位单测兜底。
    // 颜色单一真源：CATEGORY_COLORS ← TYPE_COLORS（⛔ 本组件不出现硬编码色值）
    // 保留（前序版本已完成，本批不动）：手写 SVG 折线 + 悬停气泡、当年只画到当前月、想看清单弹层、往年报告下拉
    import type { ActivityEvent, MediaEntry, EntryType } from 'data/types';
    import { ENTRY_TYPE_LABELS } from 'data/types';
    import { finishedInYear, trendShownMonths } from 'pure/stats';
    import {
        CATEGORY_COLORS,
        CATEGORY_KEYS,
        CATEGORY_LABELS,
        categoryOverview,
        monthOverMonth,
        trendMaxOf,
        trendSeriesOf,
        visibleTrendSeries,
        yearOverYear,
        type OverviewCategory,
    } from 'pure/statOverview';
    import { FEED_KIND_LABELS, FEED_RANGE_WORDS, collectFeed, feedSpan, formatFeedTime, groupFeed, type FeedKind, type FeedRange } from 'pure/activityFeed';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），概览书籍 Tab 用 */
    export let excerptCounts: Record<string, number> = {};
    export let onAdd: (t?: EntryType) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    /** 生成今年年度总结（保存到 {libraryDir}/报告/YYYY-年度总结.md 并打开） */
    export let onGenerateReport: () => Promise<void> = async () => {};
    /** 已生成的往年报告（年份降序；main.listYearReports） */
    export let yearReports: { year: number; path: string }[] = [];
    /** 活动日志（状态翻转）：动态面板数据源 */
    export let activityLog: ActivityEvent[] = [];
    /** 一键把动态写进当天日记：**范围跟随当前 日/周/月/年 切换** */
    export let onRecordJournal: (range: FeedRange) => Promise<void> = async () => {};
    /** 打开某份年度报告（main.openReport） */
    export let onOpenReport: (path: string) => void = () => {};

    let recording = false;
    /** 年度总结生成中（1.0.4）：按钮显示内联 spinner 并禁用，防重复触发 */
    let reportBusy = false;
    /** 生成年度总结：busy 包装保证 finally 复位——失败也不会卡在加载态 */
    async function generateReport() {
        if (reportBusy) return;
        reportBusy = true;
        try {
            await onGenerateReport();
        } finally {
            reportBusy = false;
        }
    }
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

    const now = new Date();
    const year = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const yearStr = String(year);
    const pad = (n: number) => String(n).padStart(2, '0');
    const monthPrefix = `${yearStr}-${pad(thisMonth)}`;
    /** 12 个月刻度（趋势图 X 轴；与序列长度解耦，便于筛选后仍画全刻度） */
    const MONTH_TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    /** 概览 Tab 图标（与类型图标同一套 Lucide 白名单） */
    const CATEGORY_ICONS: Record<OverviewCategory, string> = {
        book: 'book-open',
        media: 'film',
        game: 'gamepad-2',
        music: 'music',
    };
    /** Top3 空态文案（按分类说人话） */
    const CATEGORY_TOP_EMPTY: Record<OverviewCategory, string> = {
        book: '本年暂无读完的书',
        media: '本年暂无看完的影视',
        game: '本年暂无通关的游戏',
        music: '本年暂无已听的歌',
    };

    // ── 第一层：核心指标（1 主 + 4 辅）──
    $: watchedThisYear = entries.filter((e) => finishedInYear(e, year)).length;
    $: yoy = yearOverYear(entries, year);
    /** 同比徽标：**有去年基线才画箭头**（去年 0 → 只报「去年 —」，+N 在无基线时是误导） */
    $: yoyText = !yoy.hasBaseline
        ? '去年 —'
        : yoy.delta > 0
          ? `↑ 比去年 +${yoy.delta}`
          : yoy.delta < 0
            ? `↓ 比去年 −${Math.abs(yoy.delta)}`
            : '与去年持平';
    $: yoyTone = !yoy.hasBaseline ? 'none' : yoy.delta > 0 ? 'up' : yoy.delta < 0 ? 'down' : 'flat';
    $: watchedThisMonth = entries.filter((e) => e.watchedDate?.startsWith(monthPrefix)).length;
    $: watchingNow = entries.filter((e) => e.status === 'watching').length;
    $: plannedThisMonth = entries.filter((e) => !!e.plannedDate && e.plannedDate.startsWith(monthPrefix)).length;
    $: libraryTotal = entries.length;

    // ── 第二层 A：动态时间轴（合并「今日」+「今年动态」）：日 / 周 / 月 / 年 日历范围切换 ──
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
    // 🔴 #449：类目文案**唯一真源 = `pure/activityFeed.FEED_KIND_LABELS`**（行标签用的是同一张表）——
    // 这里以前内联一份 `['watch','完成']`… 双份必然漂（同一条动态汇总叫「完成」、行里叫「已看」= 用户看到的两个「已看」）。
    $: feedSummary = (Object.keys(FEED_KIND_LABELS) as FeedKind[])
        .filter((k) => feedCounts[k])
        .map((k) => `${FEED_KIND_LABELS[k]} ${feedCounts[k]}`)
        .join(' · ');
    const todayStr = `${yearStr}-${monthPrefix.slice(5)}-${pad(now.getDate())}`;
    function fmtDate(d: string): string {
        if (d === todayStr) return '今天';
        return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
    }

    // ── 第二层 B：月度趋势（序列打包 / 分类筛选 / 结论行）──
    $: trendSeries = trendSeriesOf(entries, year);
    /** chips = 只给**本年有数据**的分类（0 值不进 chips，免得点了空白） */
    $: trendChips = trendSeries.filter((s) => s.on);
    let trendSel: OverviewCategory[] = [];
    /** 选择落到**当前存在的分类**上再参与渲染（数据被删后自愈）；⛔ 不写回 trendSel —— 自依赖会让 Svelte 反应式成环 */
    $: trendSelLive = trendSel.filter((k) => trendChips.some((s) => s.key === k));
    $: trendVisible = visibleTrendSeries(trendSeries, trendSelLive);
    $: trendMax = trendMaxOf(trendSeries, trendSelLive);
    $: trendEmpty = trendVisible.length === 0;
    $: mom = monthOverMonth(entries, year, thisMonth);
    /** 图下结论行：让图有结论（金标准：图不能只给线，要给人话） */
    $: momText =
        !mom.hasBaseline
            ? mom.current > 0
                ? `本月完成 ${mom.current}`
                : '本月还没有完成记录'
            : mom.delta > 0
              ? `本月完成 ${mom.current} · 比上月 +${mom.delta}`
              : mom.delta < 0
                ? `本月完成 ${mom.current} · 比上月 −${Math.abs(mom.delta)}`
                : `本月完成 ${mom.current} · 与上月持平`;
    /** 单选/多选切换（多选 = OR；全部取消 = 回到「全部」） */
    function toggleTrend(k: OverviewCategory) {
        trendSel = trendSel.includes(k) ? trendSel.filter((x) => x !== k) : [...trendSel, k];
    }
    const TREND_W = 620;
    const TREND_H = 130;
    /** T2 截断：当年视图实线/点位只画到当前月，未来月份刻度淡显（2026-09-12 用户批准） */
    $: shownMonths = trendShownMonths(year, now);
    /** T3 悬停：气泡锚定月份（0-11），列出该月**在画**的序列的值 */
    let hoverM: number | null = null;
    $: hoverRows =
        hoverM === null
            ? []
            : trendVisible.map((s) => ({ label: s.label, color: CATEGORY_COLORS[s.key], v: s.arr[hoverM as number] }));
    /** 单点 Y 坐标（折线与圆点共用）；极值只按可见序列算（筛选后坐标轴跟着变） */
    function trendPtY(v: number): number {
        return TREND_H - TREND_PAD_Y - (v / trendMax) * (TREND_H - 2 * TREND_PAD_Y);
    }
    const TREND_PAD_X = 26;
    const TREND_PAD_Y = 10;
    function trendPts(arr: number[]): string {
        return arr
            .slice(0, shownMonths)
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

    // ── 第三层：分类概览（Tab 一次看一类：指标 + 子类型行 + Top3）──
    let partTab: OverviewCategory = 'book';
    $: overview = categoryOverview(entries, year, excerptCounts, partTab);
    /** 分钟 → 小时（保留 1 位小数，无值显示 —） */
    function fmtHours(minutes: number): string {
        if (!minutes) return '—';
        const h = minutes / 60;
        return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
    }

    // ── 快捷入口（次要动作）：随机推荐 / 想看的清单弹层 ──
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
    <!-- 页眉：只留标题（主 CTA 已收进主指标卡内 = D-9 线框图版）；「添加 / 随机 / 清单」在动态区 -->
    <header class="rl-s-head">
        <div class="rl-s-title">{year} 统计</div>
    </header>

    <!-- 第一层：核心指标 —— 1 主（今年看完 + 同比）+ 4 辅（一排等权卡里后几个基本不被看，Tableau 眼动） -->
    <section class="rl-hero">
        <div class="rl-hero-main">
            <div class="rl-hero-label">今年看完</div>
            <div class="rl-hero-num">{watchedThisYear}</div>
            <div class="rl-yoy rl-yoy-{yoyTone}">{yoyText}</div>
            <!-- 主 CTA：与「今年看完」大数字同卡（生成今年总结 + 往年报告下拉） -->
            <div class="rl-s-actions">
                <button class="rl-btn rl-btn-primary" class:rl-btn-loading={reportBusy} disabled={reportBusy} on:click={() => void generateReport()}>生成今年总结</button>
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
        </div>
        <div class="rl-hero-side">
            <div class="rl-hero-m"><b>{watchedThisMonth}</b><span>本月看完</span></div>
            <div class="rl-hero-m"><b>{watchingNow}</b><span>在追/在读</span></div>
            <div class="rl-hero-m"><b>{plannedThisMonth}</b><span>本月计划</span></div>
            <div class="rl-hero-m"><b>{libraryTotal}</b><span>库内总数</span></div>
        </div>
    </section>

    <!-- 第二层 A：动态（状态变更 / 新增 / 追更 / 计划 / 游玩）；空态只留说明 —— 三个入口在标题行，⛔ 不重复（用户 2026-09-22 裁定） -->
    <section class="rl-s-panel rl-s-today">
        <div class="rl-s-panel-title">
            动态 · {span.label}
            <span class="rl-s-title-right">
                <span class="rl-s-aux">
                    <button class="rl-s-qbtn" on:click={() => onAdd()}><Icon icon="plus" size={13} /> 添加条目</button>
                    <button class="rl-s-qbtn" on:click={randomPick}><Icon icon="shuffle" size={13} /> 随机推荐</button>
                    <button class="rl-s-qbtn" on:click={() => (wantOpen = true)}><Icon icon="list" size={13} /> 想看的清单（{wantList.length}）</button>
                </span>
                <span class="rl-feed-switch" role="group" aria-label="动态时间范围">
                    {#each FEED_RANGES as r}
                        <button class="rl-feed-tab" class:on={feedRange === r.value} on:click={() => (feedRange = r.value)}>{r.label}</button>
                    {/each}
                </span>
                <button class="rl-btn rl-today-rec" disabled={recording || feed.length === 0} data-tip={feed.length === 0 ? `${rangeWord}还没有观影/阅读动态` : `写进当天日记（重复点击只更新该块）`} on:click={() => void recordCurrent()}>
                    {recording ? '记录中…' : `记录${rangeWord}`}
                </button>
            </span>
        </div>
        {#if feed.length === 0}
            <div class="rl-s-empty-act">
                <div class="rl-s-empty-t">{rangeWord}还没有观影/阅读动态</div>
                <div class="rl-s-empty-d">添加条目后标记「在看 / 已看」，动态就会出现在这里</div>
            </div>
        {:else if feedRange === 'day'}
            <div class="rl-today-list">
                {#each feed as f}
                    <div class="rl-today-item" role="link" tabindex="0"
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
                                        <span class="rl-feed-chip" role="link" tabindex="0"
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

    <div class="rl-s-mid">
        <!-- 第二层 B + 第三层：趋势 与 分类概览 **并排**（`.rl-s-mid` = 50/50 + gap 12；窄屏 <900px 退单列） -->
        <section class="rl-s-panel rl-s-trend">
            <div class="rl-s-panel-title">
                {year} 月度看完趋势
                <span class="rl-trend-chips">
                    <button class="rl-tchip" class:on={trendSelLive.length === 0} on:click={() => (trendSel = [])}>全部</button>
                    {#each trendChips as s}
                        <button class="rl-tchip" class:on={trendSelLive.includes(s.key)} style={`--rl-cat:${CATEGORY_COLORS[s.key]}`} on:click={() => toggleTrend(s.key)}>
                            <i class="rl-tchip-dot" style={`background:${CATEGORY_COLORS[s.key]}`}></i>{s.label}
                        </button>
                    {/each}
                </span>
            </div>
            {#if trendEmpty}
                <div class="rl-s-empty">本年暂无完成记录 — 添加并标记观看/阅读/通关/收听后显示趋势</div>
            {:else}
                <svg class="rl-trend" viewBox={`0 0 ${TREND_W} ${TREND_H}`} preserveAspectRatio="none" role="img" aria-label="{year} 月度看完趋势折线图">
                    {#each [0, 2, 4] as g}
                        <line class="rl-trend-grid" x1={TREND_PAD_X} y1={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} x2={TREND_W - TREND_PAD_X} y2={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} />
                    {/each}
                    <text class="rl-trend-y" x="2" y={TREND_PAD_Y + 3} text-anchor="start">{trendMax}</text>
                    <text class="rl-trend-y" x="2" y={TREND_H - TREND_PAD_Y + 3} text-anchor="start">0</text>
                    {#each trendVisible as s}
                        <polyline class="rl-trend-line" points={trendPts(s.arr)} stroke={CATEGORY_COLORS[s.key]} />
                    {/each}
                    {#each trendVisible as s}
                        {#each s.arr.slice(0, shownMonths) as v, i}
                            {#if v > 0}
                                <circle class="rl-trend-dot" cx={trendTickX(i)} cy={trendPtY(v)} r="2.5" fill={CATEGORY_COLORS[s.key]} />
                            {/if}
                        {/each}
                    {/each}
                    {#each MONTH_TICKS as m, i}
                        <text class="rl-trend-tick" class:rl-trend-tick-future={i + 1 > shownMonths} x={trendTickX(i)} y={TREND_H - 1} text-anchor="middle">{m}</text>
                    {/each}
                    {#each MONTH_TICKS as _, i}
                        {#if i < shownMonths}
                            <rect class="rl-trend-hot" role="presentation" aria-hidden="true" x={trendTickX(i) - (TREND_W - 2 * TREND_PAD_X) / 22} y="0" width={(TREND_W - 2 * TREND_PAD_X) / 11} height={TREND_H} fill="transparent" on:mouseenter={() => (hoverM = i)} on:mouseleave={() => (hoverM = null)} />
                        {/if}
                    {/each}
                </svg>
            {/if}
            {#if !trendEmpty}<div class="rl-trend-foot">{momText}</div>{/if}
            {#if hoverM !== null && hoverRows.length > 0}
                <div class="rl-trend-tip" style={`left:${(trendTickX(hoverM) / TREND_W) * 100}%; transform:${hoverM < 2 ? 'none' : hoverM > 9 ? 'translateX(-100%)' : 'translateX(-50%)'};`}>
                    <b>{hoverM + 1} 月</b>
                    {#each hoverRows as r}
                        <span><i style={`background:${r.color}`}></i>{r.label} {r.v}</span>
                    {/each}
                </div>
            {/if}
        </section>

            <!-- 第三层：分类概览（四宫格 → Tab，一次看一类）—— 与趋势同排 -->
        <section class="rl-s-panel rl-s-part">
            <div class="rl-part-tabs" role="tablist" aria-label="分类概览">
                {#each CATEGORY_KEYS as k}
                    <button class="rl-part-tab" class:on={partTab === k} role="tab" aria-selected={partTab === k} style={`--rl-cat:${CATEGORY_COLORS[k]}`} on:click={() => (partTab = k)}>
                        <Icon icon={CATEGORY_ICONS[k]} size={13} /> {CATEGORY_LABELS[k]}
                    </button>
                {/each}
            </div>
            {#if !overview.hasAny}
                <div class="rl-s-empty-act">
                    <div class="rl-s-empty-t">还没有{CATEGORY_LABELS[partTab]}条目</div>
                    <div class="rl-s-empty-d">添加后这里会显示完成数、时长与 Top 3</div>
                    <div class="rl-s-empty-btns">
                        <button class="rl-btn rl-btn-primary" on:click={() => onAdd()}><Icon icon="plus" size={13} /> 添加条目</button>
                    </div>
                </div>
            {:else}
                <div class="rl-part-body" style={`--rl-cat:${CATEGORY_COLORS[partTab]}`}>
                    <div class="rl-part-head">
                        {overview.label}
                        {#if overview.subText}<span class="rl-part-sub">{overview.subText}</span>{/if}
                    </div>
                    <div class="rl-part-metrics">
                        {#each overview.metrics as m}
                            <div class="rl-part-m"><b>{m.kind === 'hours' ? fmtHours(m.value) : m.value}</b><span>{m.label}</span></div>
                        {/each}
                    </div>
                    <div class="rl-part-top">
                        <div class="rl-part-top-title">Top 3</div>
                        {#if overview.top.length === 0}
                            <div class="rl-part-top-empty">{overview.hasFinished ? '本年完成的条目还没有评分' : CATEGORY_TOP_EMPTY[partTab]}</div>
                        {:else}
                            {#each overview.top as e}
                                <div class="rl-part-top-item" role="link" tabindex="0" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>★{e.rating} 《{e.title}》</div>
                            {/each}
                        {/if}
                    </div>
                </div>
            {/if}
        </section>
    </div>
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
                            <span class="rl-want-title" role="link" tabindex="0" on:click={() => { wantOpen = false; onOpenEntry(e.id); }} on:keydown={(ev) => { if (ev.key === 'Enter') { wantOpen = false; onOpenEntry(e.id); } }}>{e.title}</span>
                            <span class="rl-want-meta">{e.year ?? ''}{e.plannedDate ? ` · 计划 ${fmtDate(e.plannedDate)}` : ''}</span>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
    </div>
{/if}

<style>
    /* ── 页面骨架（三层倒金字塔：核心指标 → 动态 / 趋势 → 分类概览；圆角走 --rl-t-*，克制卡片） ── */
    .rl-sb { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

    .rl-s-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .rl-s-title { font-size: 16px; font-weight: 800; color: var(--text-normal); }
    .rl-s-actions { display: flex; align-items: center; gap: 8px; }
    /* 主 CTA 在主指标卡内：距同比徽标 8px，跟随卡片居中轴（D-9 线框图版） */
    .rl-hero-main .rl-s-actions { margin-top: 8px; justify-content: center; flex-wrap: wrap; }

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
    .rl-s-panel-title { font-size: 12px; font-weight: 700; color: var(--text-normal); margin-bottom: 10px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    /* 第二层 B + 第三层并排（用户 2026-09-22 裁定「趋势与四库概览并排」；沿用改版前的 `.rl-s-mid` 口径：1fr/1fr + gap 12 + 等高拉伸） */
    .rl-s-mid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
    .rl-s-empty { font-size: 12px; color: var(--text-faint); text-align: center; padding: 22px 0; }

    /* 空态（三要素：为什么空 + 下一步按钮 + 引导文案） */
    .rl-s-empty-act { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 18px 0 14px; }
    .rl-s-empty-t { font-size: 12.5px; font-weight: 600; color: var(--text-muted); }
    .rl-s-empty-d { font-size: 11.5px; color: var(--text-faint); text-align: center; }
    .rl-s-empty-btns { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; }

    /* ── 第一层：核心指标（1 主 + 4 辅）── */
    .rl-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: 10px; }
    .rl-hero-main {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 10px; padding: 14px 12px;
    }
    .rl-hero-label { font-size: 11.5px; color: var(--text-muted); }
    .rl-hero-num { font-size: 40px; font-weight: 800; line-height: 1.05; color: var(--text-normal); font-variant-numeric: tabular-nums; }
    /* 同比徽标：有去年基线才上色画箭头；无基线（去年 0 / 新库）保持中性灰 */
    .rl-yoy { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
    .rl-yoy-up { color: var(--rl-good); }
    .rl-yoy-down { color: var(--rl-warn); }
    .rl-hero-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .rl-hero-m {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 10px; padding: 10px 6px;
    }
    .rl-hero-m b { font-size: 20px; font-weight: 800; line-height: 1.1; color: var(--text-normal); font-variant-numeric: tabular-nums; }
    .rl-hero-m span { font-size: 10.5px; color: var(--text-muted); }

    /* ── 趋势：分类筛选 chips（点 = 分类色，与折线同一份编码）+ 结论行 ── */
    .rl-trend-chips { margin-left: auto; display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    /* 两级前缀 + 显式拍平：核心 `button:not(.clickable-icon)` 会压过单类（UI-GUIDE §12.5） */
    .rl-s-trend .rl-tchip {
        font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-pill, 999px);
        background: transparent; box-shadow: none; height: auto; line-height: normal;
        padding: 1px 9px; color: var(--text-muted);
    }
    /* 并排筛选控件：悬停只变文字色（⛔ 不铺底、⛔ 不动描边） */
    .rl-s-trend .rl-tchip:hover { color: var(--text-normal); }
    /* 已筛选中也只是文字染主题色（与题材胶囊同一口径，⛔ 不染描边） */
    .rl-s-trend .rl-tchip.on { color: var(--rl-cat, var(--interactive-accent)); }
    .rl-tchip-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
    .rl-trend { width: 100%; height: 130px; display: block; }
    .rl-trend-grid { stroke: var(--background-modifier-border); stroke-width: 1; stroke-dasharray: 3 4; }
    .rl-trend-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .92; }
    .rl-trend-tick { font-size: 9px; fill: var(--text-faint); }
    .rl-trend-tick-future { opacity: .35; }
    .rl-trend-dot { stroke: var(--background-primary); stroke-width: 1; }
    .rl-trend-y { font-size: 9px; fill: var(--text-faint); }
    .rl-trend-hot { cursor: crosshair; }
    .rl-trend-foot { margin-top: 6px; font-size: 11px; color: var(--text-muted); }
    .rl-s-trend { position: relative; }
    .rl-trend-tip {
        position: absolute; top: 30px; z-index: 5; pointer-events: none;
        display: flex; flex-direction: column; gap: 2px; white-space: nowrap;
        background: var(--background-secondary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px); padding: 4px 8px; font-size: 11px; color: var(--text-normal);
    }
    .rl-trend-tip b { font-weight: 600; }
    .rl-trend-tip span { display: inline-flex; align-items: center; gap: 4px; }
    .rl-trend-tip i { width: 8px; height: 8px; border-radius: 2px; flex: none; display: inline-block; }

    /* ── 第三层：分类概览 Tab（一次一类；左侧色条 = 该分类色）── */
    .rl-part-tabs { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 12px; }
    .rl-s-part .rl-part-tab {
        font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        border: none; border-bottom: 2px solid transparent; border-radius: 0;
        background: transparent; box-shadow: none; height: auto; line-height: normal;
        color: var(--text-muted); padding: 6px 10px; margin-bottom: -1px;
    }
    .rl-s-part .rl-part-tab:hover { color: var(--text-normal); }
    .rl-s-part .rl-part-tab.on { color: var(--rl-cat, var(--interactive-accent)); border-bottom-color: var(--rl-cat, var(--interactive-accent)); }
    .rl-part-body { display: flex; flex-direction: column; gap: 10px; border-left: 3px solid var(--rl-cat, var(--interactive-accent)); padding-left: 12px; min-width: 0; }
    .rl-part-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: 13px; font-weight: 700; color: var(--text-normal); }
    .rl-part-sub { font-size: 10.5px; font-weight: 400; color: var(--text-faint); }
    .rl-part-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .rl-part-m {
        display: flex; flex-direction: column; align-items: center; gap: 1px;
        background: var(--background-secondary); border-radius: 7px; padding: 7px 2px;
    }
    .rl-part-m b { font-size: 16px; font-weight: 800; color: var(--text-normal); font-variant-numeric: tabular-nums; }
    .rl-part-m span { font-size: 9.5px; color: var(--text-faint); }
    .rl-part-top-title { font-size: 10px; font-weight: 700; color: var(--text-muted); margin-bottom: 3px; }
    .rl-part-top-item {
        font-size: 11.5px; color: var(--text-normal); padding: 2px 4px; border-radius: 5px;
        cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rl-part-top-item:hover { background: var(--background-modifier-hover); color: var(--interactive-accent); }
    .rl-part-top-empty { font-size: 11px; color: var(--text-faint); opacity: .85; padding: 3px 2px; }

    /* ── 快捷入口（次要动作）：动态区标题行右上 ── */
    .rl-s-qbtn {
        font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px);
        background: var(--background-primary); color: var(--text-muted);
        padding: 3px 9px; transition: background .15s ease, color .15s ease;
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

    /* ── 动态：面板题头右侧（次要入口 + 时间范围 + 记录今天）── */
    .rl-s-today .rl-s-panel-title { justify-content: space-between; align-items: center; }
    .rl-s-title-right { margin-left: auto; display: inline-flex; align-items: center; flex-wrap: wrap; gap: 10px; }
    .rl-s-aux { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
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

    /* 窄屏收敛：核心指标改上下堆叠，概览指标保持一行四格 */
    @media (max-width: 900px) {
        .rl-hero { grid-template-columns: 1fr; }
        .rl-s-mid { grid-template-columns: 1fr; }
        .rl-hero-side { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .rl-part-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
</style>
