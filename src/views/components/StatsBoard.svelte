<script lang="ts">
    // 统计页（17-统计页完全重构规划落地）：数据优先 / 克制视觉 / 对齐 UI-GUIDE
    //   页眉动作（生成今年总结 + 往年报告下拉）→ KPI 行（今年看完/本月看完/在追/本月计划/库内总数）
    //   → 月度看完趋势 × 今年动态 → 四库分区（数据主体）→ 快捷行；想看清单弹层保留
    // 移除（规划 D1/D2/D3 + 年度目标丢弃）：类型分布玻璃卡（子类型并入影视列）、霓虹热力图、
    //   年度目标圆环（localStorage 键不再读写）、emoji 图标（全量替换为文本/Lucide 白名单）
    import type { MediaEntry, EntryType } from 'data/types';
    import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from 'data/types';
    import {
        durationStats,
        finishedInYear,
        monthlyFinished,
        recentActivity,
        topRatedInYear,
    } from 'pure/stats';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），书籍分区列用 */
    export let excerptCounts: Record<string, number> = {};
    export let onAdd: (t?: EntryType) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    /** 生成今年年度总结（保存到 {libraryDir}/报告/YYYY-年度总结.md 并打开） */
    export let onGenerateReport: () => Promise<void> = async () => {};
    /** 已生成的往年报告（年份降序；main.listYearReports） */
    export let yearReports: { year: number; path: string }[] = [];
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

    // ── 今年动态（时间线；D3=限今年，复用 pure/stats.recentActivity） ──
    const TYPE_COLORS: Record<EntryType, string> = {
        movie: '#5b9bd5',
        tv: '#8e7cc3',
        anime: '#c07ab8',
        book: '#6aa87a',
        game: '#d99b53',
        music: '#2AA89B',
    };
    $: activity = recentActivity(entries, year, 8);
    const todayStr = `${yearStr}-${monthPrefix.slice(5)}-${pad(now.getDate())}`;
    function fmtDate(d: string): string {
        if (d === todayStr) return '今天';
        return `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
    }

    // ── 四库分区（数据主体） ──
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
    $: trendEmpty =
        monthlyAllMax <= 1 &&
        [...monthlyBooks, ...monthlyMedia, ...monthlyGames, ...monthlyMusic].every((v) => v === 0);
    const TREND_W = 620;
    const TREND_H = 130;
    const TREND_PAD_X = 8;
    const TREND_PAD_Y = 10;
    function trendPts(arr: number[]): string {
        return arr
            .map((v, i) => {
                const x = TREND_PAD_X + (i * (TREND_W - 2 * TREND_PAD_X)) / 11;
                const y = TREND_H - TREND_PAD_Y - (v / monthlyAllMax) * (TREND_H - 2 * TREND_PAD_Y);
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

    <!-- 中排：月度看完趋势 × 今年动态 -->
    <div class="rl-s-mid">
        <section class="rl-s-panel rl-s-trend">
            <div class="rl-s-panel-title">
                {year} 月度看完趋势
                <span class="rl-trend-legend">
                    <span class="rl-tg-book">书籍</span><span class="rl-tg-media">影视</span><span class="rl-tg-game">游戏</span><span class="rl-tg-music">音乐</span>
                </span>
            </div>
            {#if trendEmpty}
                <div class="rl-s-empty">本年暂无完成记录 — 添加并标记观看/阅读/通关/收听后显示趋势</div>
            {:else}
                <svg class="rl-trend" viewBox={`0 0 ${TREND_W} ${TREND_H}`} preserveAspectRatio="none" role="img" aria-label="{year} 月度看完趋势折线图">
                    {#each [0, 1, 2, 3, 4] as g}
                        <line class="rl-trend-grid" x1={TREND_PAD_X} y1={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} x2={TREND_W - TREND_PAD_X} y2={TREND_PAD_Y + (g * (TREND_H - 2 * TREND_PAD_Y)) / 4} />
                    {/each}
                    <polyline class="rl-trend-line" points={trendPts(monthlyBooks)} stroke="#5f9d70" />
                    <polyline class="rl-trend-line" points={trendPts(monthlyMedia)} stroke="#4f8cc9" />
                    <polyline class="rl-trend-line" points={trendPts(monthlyGames)} stroke="#c98f4a" />
                    <polyline class="rl-trend-line" points={trendPts(monthlyMusic)} stroke="#1f9b90" />
                    {#each monthlyBooks as _, i}
                        <text class="rl-trend-tick" x={trendTickX(i)} y={TREND_H - 1} text-anchor="middle">{i + 1}</text>
                    {/each}
                </svg>
            {/if}
        </section>

        <section class="rl-s-panel rl-s-act">
            <div class="rl-s-panel-title">今年动态</div>
            {#if activity.length === 0}
                <div class="rl-s-empty">暂无动态 — 观看/追更/计划后显示</div>
            {:else}
                <ul class="rl-timeline">
                    {#each activity as a}
                        <li class="rl-tl-item" role="link" tabindex="0" data-tip="打开笔记"
                            on:click={() => onOpenEntry(a.id)}
                            on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(a.id); }}>
                            <span class="rl-tl-dot" style={`background:${TYPE_COLORS[a.type]}`}></span>
                            <div class="rl-tl-body">
                                <span class="rl-tl-date">{fmtDate(a.date)}</span>
                                <span class="rl-tl-text">{a.text}</span>
                            </div>
                            <Icon icon="chevron-right" size={12} />
                        </li>
                    {/each}
                </ul>
            {/if}
        </section>
    </div>

    <!-- 四库分区：数据主体（子类型计数并入影视列，D1） -->
    <section class="rl-s-panel rl-s-part">
        <div class="rl-s-panel-title">{year} 四库分区</div>
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

    <!-- 快捷行 -->
    <section class="rl-s-quick">
        <button class="rl-s-qbtn" on:click={() => onAdd()}><Icon icon="plus" size={13} /> 添加条目</button>
        <button class="rl-s-qbtn" on:click={randomPick}><Icon icon="shuffle" size={13} /> 随机推荐</button>
        <button class="rl-s-qbtn" on:click={() => (wantOpen = true)}><Icon icon="list" size={13} /> 想看的清单（{wantList.length}）</button>
    </section>
</div>

<!-- 想看清单弹层 -->
{#if wantOpen}
    <div class="rl-want-mask" on:click={() => (wantOpen = false)} on:contextmenu|preventDefault>
        <div class="rl-want-panel" on:click|stopPropagation>
            <div class="rl-want-head">
                <span>想看的清单（{wantList.length}）</span>
                <button class="rl-btn" on:click={() => (wantOpen = false)}>✕ 关闭</button>
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

    /* ── 中排：趋势 × 动态 ── */
    .rl-s-mid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 12px; align-items: stretch; }
    .rl-trend-legend { margin-left: auto; display: inline-flex; align-items: center; gap: 9px; }
    .rl-trend-legend span { font-size: 10px; color: var(--text-muted); }
    .rl-tg-book { color: #5f9d70; font-weight: 600; }
    .rl-tg-media { color: #4f8cc9; font-weight: 600; }
    .rl-tg-game { color: #c98f4a; font-weight: 600; }
    .rl-tg-music { color: #1f9b90; font-weight: 600; }
    .rl-trend { width: 100%; height: 130px; display: block; }
    .rl-trend-grid { stroke: var(--background-modifier-border); stroke-width: 1; stroke-dasharray: 3 4; }
    .rl-trend-line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .92; }
    .rl-trend-tick { font-size: 9px; fill: var(--text-faint); }

    /* ── 今年动态时间线 ── */
    .rl-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .rl-tl-item {
        position: relative; padding: 6px 6px 6px 18px; border-radius: 7px;
        display: flex; align-items: center; gap: 7px; cursor: pointer; min-width: 0;
    }
    .rl-tl-item:hover { background: var(--background-modifier-hover); }
    .rl-tl-item::before {
        content: ''; position: absolute; left: 4px; top: 24px; bottom: -4px; width: 1.5px;
        background: var(--background-modifier-border);
    }
    .rl-tl-item:last-child::before { display: none; }
    .rl-tl-dot { position: absolute; left: 0; top: 12px; width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .rl-tl-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .rl-tl-date { font-size: 10px; color: var(--text-faint); }
    .rl-tl-text { font-size: 12px; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-tl-item :global(svg) { flex: none; color: var(--text-faint); opacity: 0; }
    .rl-tl-item:hover :global(svg) { opacity: 1; }

    /* ── 四库分区 ── */
    .rl-part-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
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
    .rl-s-quick { display: flex; flex-wrap: wrap; gap: 8px; }
    .rl-s-qbtn {
        font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        border: 1px solid var(--background-modifier-border); border-radius: 8px;
        background: var(--background-primary); color: var(--text-muted);
        padding: 7px 14px; transition: background .15s ease, color .15s ease;
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
        padding: 7px 9px; border-radius: 6px;
    }
    .rl-dd-item:hover { background: var(--background-modifier-hover); }
    .rl-dd-item b { color: var(--interactive-accent); font-size: 12.5px; }
    .rl-dd-go { margin-left: auto; color: var(--text-faint); }

    /* ── 想看清单弹层 ── */
    .rl-want-mask { position: fixed; inset: 0; z-index: 999; background: rgba(0, 0, 0, .35); display: flex; align-items: center; justify-content: center; }
    .rl-want-panel { width: min(560px, 90vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--background-primary); border-radius: 12px; box-shadow: 0 8px 30px rgba(0, 0, 0, .25); padding: 14px 16px; }
    .rl-want-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; margin-bottom: 10px; }
    .rl-want-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    .rl-want-list li { display: flex; align-items: baseline; gap: 8px; font-size: 12px; padding: 5px 8px; border-radius: 6px; }
    .rl-want-list li:hover { background: var(--background-modifier-hover); }
    .rl-want-type { flex: none; font-size: 10px; color: var(--text-muted); background: var(--background-modifier-border); border-radius: 5px; padding: 1px 7px; }
    .rl-want-title { cursor: pointer; font-weight: 600; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-want-title:hover { color: var(--interactive-accent); text-decoration: underline; }
    .rl-want-meta { flex: none; font-size: 11px; color: var(--text-faint); }

    /* 窄屏收敛：分区 2 列、KPI 保持可读 */
    @media (max-width: 900px) {
        .rl-s-mid { grid-template-columns: 1fr; }
        .rl-part-grid { grid-template-columns: repeat(2, 1fr); }
        .rl-kpis { grid-template-columns: repeat(3, 1fr); }
    }
</style>
