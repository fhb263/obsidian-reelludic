<script lang="ts">
    // 月历计划表：周一开头 7 列细边框网格；7:3 分栏（左待排区 + 右主日历）
    // 交互：月份导航（‹ › 今天）→ 点击日期打开当天详情；待排卡片拖拽到日期格完成排期
    import { ENTRY_TYPE_LABELS, TYPE_COLORS, type EntryType } from 'data/types';
    import type { MediaEntry } from 'data/types';
    import { duePlannedEntries } from 'pure/tracking';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    /** 点击某天：HomeView 层打开 CalendarDayModal */
    export let onSelectDay: (dateStr: string) => void = () => {};
    /** 拖拽排期：待排卡片拖到日期格 → 设置计划观看日期 */
    export let onPlanDate: (id: string, dateStr: string) => Promise<void> = async () => {};
    /** 到期横幅「开始观看」：状态 want→watching（HomeView 层调 service.setStatus） */
    export let onStartWatching: (id: string) => Promise<void> = async () => {};

    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

    const now = new Date();
    let cursor = { year: now.getFullYear(), month: now.getMonth() };

    /** 视图模式：月历（默认）/ 周历（更详细排期） */
    let viewMode: 'month' | 'week' = 'month';
    /** 周光标：所在周的任一天（导航基准） */
    let weekCursor = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

    /** 到期横幅：横幅关闭标记（会话级）与已开始观看的条目 id（点击后立即从横幅移除） */
    let bannerDismissed = false;
    let startedIds: Set<string> = new Set();

    /** 到期且待开始的条目（plannedDate <= 今天 且 want）——横幅数据源 */
    $: due = duePlannedEntries(entries, toDateStr(new Date())).filter((e) => !startedIds.has(e.id));

    /** 有到期条目且未手动关闭 → 显示横幅 */
    $: showBanner = !bannerDismissed && due.length > 0;

    /** 一键开始观看：立即从横幅移除（乐观），再落盘；失败则重新出现 */
    async function startWatching(e: MediaEntry): Promise<void> {
        startedIds = new Set([...startedIds, e.id]);
        try {
            await onStartWatching(e.id);
        } catch {
            startedIds = new Set([...startedIds].filter((x) => x !== e.id));
        }
    }

    /** 待排条目（想看/想读 未排期）：左侧待排区数据源 */
    $: unscheduled = entries.filter((e) => e.status === 'want' && !e.plannedDate);

    /** plannedDate → 条目索引（仅当月历数据源） */
    $: byDate = (() => {
        const m = new Map<string, MediaEntry[]>();
        for (const e of entries) {
            if (!e.plannedDate) continue;
            const list = m.get(e.plannedDate) ?? [];
            list.push(e);
            m.set(e.plannedDate, list);
        }
        for (const list of m.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
        return m;
    })();

    $: year = cursor.year;
    $: month = cursor.month; // 0-11
    $: startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // 周一=0
    $: daysInMonth = new Date(year, month + 1, 0).getDate();
    $: monthLabel = `${year}年${month + 1}月`;
    $: todayStr = toDateStr(new Date());
    $: monthTotal = (() => {
        let n = 0;
        for (let d = 1; d <= daysInMonth; d++) {
            const key = toDateStr(new Date(year, month, d));
            n += (byDate.get(key) ?? []).length;
        }
        return n;
    })();

    /** 42 格（6 周）月历单元格；非当月显示真实日期数字（上月月末/下月月初）并弱化；
     *  过去日期（isPast，早于今天）灰色禁用：不可点击、不可拖拽排期 */
    $: cells = (() => {
        const out: { key: string; dayNum: number; inMonth: boolean; isPast: boolean; items: MediaEntry[] }[] = [];
        for (let i = 0; i < 42; i++) {
            const d = new Date(year, month, i - startOffset + 1);
            const key = toDateStr(d);
            out.push({
                key,
                dayNum: d.getDate(), // 修复：显示真实日期（上月末 28-31 / 下月初 1-3，不再出现 0/-1/32）
                inMonth: i - startOffset + 1 >= 1 && i - startOffset + 1 <= daysInMonth,
                isPast: key < todayStr,
                items: byDate.get(key) ?? [],
            });
        }
        return out;
    })();

    /** 周视图：当前周 7 天（周一起始）——day 集合 + 每天条目 */
    $: weekDays = (() => {
        const base = new Date(weekCursor.year, weekCursor.month, weekCursor.day);
        const start = new Date(base);
        start.setDate(base.getDate() - ((base.getDay() + 6) % 7)); // 回到周一
        const out: { key: string; dateNum: number; monthLabel: string; isPast: boolean; isToday: boolean; items: MediaEntry[] }[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            const key = toDateStr(d);
            out.push({
                key,
                dateNum: d.getDate(),
                monthLabel: `${d.getMonth() + 1}月`,
                isPast: key < todayStr,
                isToday: key === todayStr,
                items: byDate.get(key) ?? [],
            });
        }
        return out;
    })();

    /** 周视图标题：9月1日 – 9月7日（跨月显示 8月29日 – 9月4日） */
    $: weekLabel = (() => {
        const d0 = weekDays[0], d1 = weekDays[6];
        return `${d0.monthLabel}${d0.dateNum}日 – ${d1.monthLabel}${d1.dateNum}日`;
    })();

    /** 周视图：本周条目总数 */
    $: weekTotal = weekDays.reduce((s, d) => s + d.items.length, 0);

    function toDateStr(d: Date): string {
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    function shiftMonth(delta: number): void {
        const d = new Date(year, month + delta, 1);
        cursor = { year: d.getFullYear(), month: d.getMonth() };
    }

    function goToday(): void {
        const n = new Date();
        cursor = { year: n.getFullYear(), month: n.getMonth() };
    }

    function shiftWeek(delta: number): void {
        const d = new Date(weekCursor.year, weekCursor.month, weekCursor.day + delta * 7);
        weekCursor = { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
    }

    function goThisWeek(): void {
        const n = new Date();
        weekCursor = { year: n.getFullYear(), month: n.getMonth(), day: n.getDate() };
    }

    /** 拖拽悬停中的日期格（显示虚线高亮，代表选中该日排期） */
    let dragOverKey: string | null = null;

    /** 拖拽开始：记录条目 id */
    function dragStart(ev: DragEvent, id: string): void {
        ev.dataTransfer?.setData('text/plain', id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
    }

    /** 拖拽悬停：允许放置 + 记录当前格子做虚线高亮 */
    function dragOver(ev: DragEvent, key: string): void {
        ev.preventDefault();
        dragOverKey = key;
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    }

    /** 拖拽离开：清除高亮 */
    function dragLeave(): void {
        dragOverKey = null;
    }

    /** 拖拽放置：设置该日排期并清除高亮 */
    function dropTo(ev: DragEvent, dateStr: string): void {
        ev.preventDefault();
        dragOverKey = null;
        const id = ev.dataTransfer?.getData('text/plain');
        if (id) void onPlanDate(id, dateStr);
    }
</script>

<div class="rl-cal">
    <!-- 单行控制栏（ghost 按钮，Obsidian 原生轻量） -->
    <div class="rl-cal-head">
        <span class="rl-cal-title">计划表</span>
        <span class="rl-cal-sub">{monthTotal} 条计划</span>
        <div class="rl-cal-nav">
            {#if viewMode === 'month'}
                <button class="rl-cal-ghost" aria-label="上个月" on:click={() => shiftMonth(-1)}><Icon icon="chevron-left" size={14} /></button>
                <span class="rl-cal-month">{monthLabel}</span>
                <button class="rl-cal-ghost" aria-label="下个月" on:click={() => shiftMonth(1)}><Icon icon="chevron-right" size={14} /></button>
            {:else}
                <button class="rl-cal-ghost" aria-label="上一周" on:click={() => shiftWeek(-1)}><Icon icon="chevron-left" size={14} /></button>
                <span class="rl-cal-month">{weekLabel}</span>
                <button class="rl-cal-ghost" aria-label="下一周" on:click={() => shiftWeek(1)}><Icon icon="chevron-right" size={14} /></button>
            {/if}
            {#if viewMode === 'month'}
                <button class="rl-cal-ghost rl-cal-today-btn" on:click={goToday}>今天</button>
            {:else}
                <button class="rl-cal-ghost rl-cal-today-btn" on:click={goThisWeek}>今天</button>
            {/if}
            <span class="rl-cal-viewswitch">
                <button class="rl-cal-viewbtn" class:on={viewMode === 'month'} on:click={() => (viewMode = 'month')}>月</button>
                <button class="rl-cal-viewbtn" class:on={viewMode === 'week'} on:click={() => (viewMode = 'week')}>周</button>
            </span>
        </div>
    </div>

    <!-- 到期横幅（UI-2）：plannedDate <= 今天 且想看 的条目，一键开始观看 → want→watching；
         标题中性文案（due 含过去排期，不写死"今天"） -->
    {#if showBanner}
        <div class="rl-cal-banner">
            <span class="rl-cal-banner-txt"><Icon icon="calendar" size={12} /> {due.length} 项排期待开始：</span>
            {#each due as e}
                <span class="rl-cal-banner-item">
                    <span class="rl-cal-banner-title" role="link" tabindex="0" data-tip="打开笔记：{e.title}" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>
                        {e.title}
                    </span>
                    <button class="rl-cal-banner-btn" on:click={() => startWatching(e)}>开始观看</button>
                </span>
            {/each}
            <button class="rl-cal-banner-close" aria-label="关闭提醒（今天不再提醒）" on:click={() => (bannerDismissed = true)}><Icon icon="x" size={12} /></button>
        </div>
    {/if}

    <div class="rl-cal-main">
        <!-- 左侧待排区（7:3 分栏）：想看/想读未排期，拖拽到日历格完成排期；点击直接编辑 -->
        <aside class="rl-cal-side">
            <div class="rl-cal-side-head">
                待排期
                <span class="rl-cal-side-cnt">{unscheduled.length}</span>
            </div>
            {#if unscheduled.length === 0}
                <div class="rl-cal-side-empty">没有待排期的条目</div>
            {:else}
                {#each unscheduled as e}
                    <div
                        class="rl-cal-card"
                        draggable="true"
                        on:dragstart={(ev) => dragStart(ev, e.id)}
                        on:click={() => onEditEntry(e.id)}
                        data-tip="拖拽到日期格排期，或点击编辑">
                        {#if posterUrl(e)}
                            <img class="rl-cal-card-cov" src={posterUrl(e)} alt="" loading="lazy" />
                        {:else}
                            <div class="rl-cal-card-cov rl-cal-card-ph" style={`background:${TYPE_COLORS[e.type]}`}>{e.title.slice(0, 1)}</div>
                        {/if}
                        <div class="rl-cal-card-meta">
                            <span class="rl-cal-card-t">{e.title}</span>
                            <span class="rl-cal-card-tag">{ENTRY_TYPE_LABELS[e.type]}</span>
                        </div>
                    </div>
                {/each}
            {/if}
        </aside>

        <!-- 右侧主视图：月历 / 周历（切换） -->
        {#if viewMode === 'month'}
            <div class="rl-cal-body">
                <div class="rl-cal-grid">
                    {#each WEEKDAYS as w}
                        <div class="rl-cal-wd">{w}</div>
                    {/each}
                    {#each cells as cell}
                        <button
                            class="rl-cal-cell"
                            class:rl-cal-off={!cell.inMonth}
                            class:rl-cal-past={cell.isPast}
                            class:rl-cal-today={cell.key === todayStr}
                            class:rl-cal-dragover={dragOverKey === cell.key}
                            on:click={() => onSelectDay(cell.key)}
                            on:dragover={(ev) => { if (!cell.isPast) dragOver(ev, cell.key); }}
                            on:dragleave={dragLeave}
                            on:drop={(ev) => { if (!cell.isPast) dropTo(ev, cell.key); }}>
                            <span class="rl-cal-d">{cell.dayNum}</span>
                            {#each cell.items.slice(0, 3) as e}
                                <span class="rl-cal-it" data-tip={e.title} style={`--tc:${TYPE_COLORS[e.type]}`}>
                                    <span class="rl-cal-it-txt">{e.title}</span>
                                </span>
                            {/each}
                            {#if cell.items.length > 3}
                                <span class="rl-cal-more">+{cell.items.length - 3} 更多…</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        {:else}
            <div class="rl-cal-week">
                {#each weekDays as day, i}
                    <div
                        class="rl-cal-wday"
                        class:rl-cal-wpast={day.isPast}
                        class:rl-cal-wtoday={day.isToday}
                        class:rl-cal-wdragover={dragOverKey === day.key}
                        on:click={() => onSelectDay(day.key)}
                        on:dragover={(ev) => { if (!day.isPast) dragOver(ev, day.key); }}
                        on:dragleave={dragLeave}
                        on:drop={(ev) => { if (!day.isPast) dropTo(ev, day.key); }}>
                        <div class="rl-cal-whead">
                            <span class="rl-cal-wday-name">{WEEKDAYS[i]}</span>
                            <span class="rl-cal-wdate">{day.monthLabel}{day.dateNum}日</span>
                        </div>
                        <div class="rl-cal-witems">
                            {#each day.items as e}
                                <div class="rl-cal-wcard" style={`--tc:${TYPE_COLORS[e.type]}`} data-tip="打开笔记：{e.title}" role="link" tabindex="0"
                                    on:click|stopPropagation={() => onOpenEntry(e.id)}
                                    on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>
                                    {#if posterUrl(e)}
                                        <img class="rl-cal-wcard-cov" src={posterUrl(e)} alt="" loading="lazy" />
                                    {:else}
                                        <div class="rl-cal-wcard-cov rl-cal-wcard-ph" style={`background:${TYPE_COLORS[e.type]}`}>{e.title.slice(0, 1)}</div>
                                    {/if}
                                    <div class="rl-cal-wcard-body">
                                        <span class="rl-cal-wcard-t">{e.title}</span>
                                        <span class="rl-cal-wcard-tag">{ENTRY_TYPE_LABELS[e.type]}</span>
                                        {#if e.progress && (e.type === 'tv' || e.type === 'anime')}
                                            <span class="rl-cal-wcard-prog">S{e.progress.season}E{e.progress.episode}{e.progress.totalEpisodes ? `/${e.progress.totalEpisodes}` : ''}</span>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <div class="rl-cal-wempty">空</div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .rl-cal {
        /* 主视图统一高度基准：≈ 月历 6 行 × 84px + 星期表头 + 网格边框。月历/周历/待排侧栏共用，切换视图高度稳定 */
        --cal-h: 532px;
        display: flex; flex-direction: column;
    }
    /* ── 单行控制栏（ghost 按钮） ── */
    .rl-cal-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .rl-cal-title { font-size: 14px; font-weight: 700; }
    .rl-cal-sub { font-size: 11px; color: var(--text-muted); }
    .rl-cal-nav { margin-left: auto; display: flex; align-items: center; gap: 2px; }
    .rl-cal-ghost {
        font-family: inherit; font-size: 12px; border: none; background: transparent;
        color: var(--text-muted); border-radius: 6px; padding: 3px 9px; cursor: pointer; line-height: 1.4;
        transition: background .15s ease, color .15s ease;
    }
    .rl-cal-ghost:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-cal-today-btn { font-weight: 600; color: var(--interactive-accent); }
    .rl-cal-month { font-size: 13px; font-weight: 600; min-width: 88px; text-align: center; }

    /* ── 到期横幅（UI-2）：浅警示底 + 条目标题 + 开始观看按钮 + ✕ 关闭 ── */
    .rl-cal-banner {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        background: rgba(255, 107, 107, .10); border: 1px solid rgba(255, 107, 107, .28);
        border-radius: 8px; padding: 7px 12px; margin-bottom: 12px; font-size: 12px;
    }
    .rl-cal-banner-txt { font-weight: 600; color: var(--text-normal); white-space: nowrap; }
    .rl-cal-banner-item { display: inline-flex; align-items: center; gap: 6px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 2px 8px; }
    .rl-cal-banner-title { cursor: pointer; font-weight: 500; color: var(--text-normal); }
    .rl-cal-banner-title:hover { color: var(--interactive-accent); text-decoration: underline; }
    .rl-cal-banner-btn {
        font-family: inherit; font-size: 11px; border: 1px solid var(--interactive-accent);
        background: var(--interactive-accent); color: var(--text-on-accent); border-radius: 5px; padding: 1px 8px;
        cursor: pointer; transition: opacity .12s ease;
    }
    .rl-cal-banner-btn:hover { opacity: .85; }
    .rl-cal-banner-close {
        font-family: inherit; font-size: 11px; border: none; background: transparent; color: var(--text-faint);
        cursor: pointer; padding: 2px 4px; margin-left: auto; border-radius: 4px; line-height: 1;
    }
    .rl-cal-banner-close:hover { background: var(--background-modifier-hover); color: var(--text-normal); }

    /* ── 7:3 分栏：左待排区（限高滚动）+ 右日历（月/周共用同一高度，切换不跳动） ── */
    .rl-cal-main { display: flex; gap: 14px; align-items: stretch; height: var(--cal-h); }
    .rl-cal-side { width: 210px; flex: none; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; padding-right: 2px; height: 100%; }
    .rl-cal-side-head { font-size: 11px; font-weight: 600; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
    .rl-cal-side-cnt {
        font-size: 10px; font-weight: 600; color: var(--interactive-accent);
        background: var(--background-modifier-hover); border-radius: 999px; padding: 0 7px; line-height: 1.5;
    }
    .rl-cal-side-empty { font-size: 11px; color: var(--text-faint); padding: 10px 2px; }
    /* 待排迷你卡片：封面 + 标题 + 类型 tag，可拖拽 */
    .rl-cal-card {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border: 1px solid var(--background-modifier-border); border-radius: 8px;
        background: var(--background-primary); cursor: grab; user-select: none;
        transition: border-color .15s ease, box-shadow .15s ease, transform .12s ease;
    }
    .rl-cal-card:hover { border-color: var(--interactive-accent); box-shadow: 0 2px 8px rgba(0, 0, 0, .1); transform: translateY(-1px); }
    .rl-cal-card:active { cursor: grabbing; }
    .rl-cal-card-cov { width: 30px; height: 42px; object-fit: cover; border-radius: 4px; flex: none; background: var(--background-secondary); }
    .rl-cal-card-ph { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; font-weight: 600; }
    .rl-cal-card-meta { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .rl-cal-card-t { font-size: 11px; font-weight: 500; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-cal-card-tag { font-size: 9px; color: var(--text-faint); }

    .rl-cal-body { flex: 1; min-width: 0; height: 100%; overflow: hidden; }
    /* ── 细边框连贯网格（非浮空圆角）：容器 1px 边框 + 格子右/下边线，overflow 裁边 ── */
    .rl-cal-grid {
        display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));
        border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden;
    }
    .rl-cal-wd {
        text-align: center; font-size: 10.5px; font-weight: 600; color: var(--text-faint);
        padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
    }
    .rl-cal-cell {
        display: flex; flex-direction: column; align-items: stretch; text-align: left;
        min-height: 84px; border: none; border-right: 1px solid var(--background-modifier-border);
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal);
        font-family: inherit; font-size: 12px; padding: 5px 7px; cursor: pointer; overflow: hidden;
        transition: background .12s ease;
    }
    .rl-cal-cell:nth-child(7n) { border-right: none; }
    .rl-cal-cell:hover { background: var(--background-modifier-hover); }
    /* 拖拽悬停：虚线框高亮代表选中该日排期 */
    .rl-cal-dragover { outline: 2px dashed var(--interactive-accent); outline-offset: -2px; background: var(--background-modifier-hover); }
    /* 过去日期：灰色弱化；可点击打开当天弹窗管理（编辑/清除排期），但不可拖入新排期（dragover/drop 守卫） */
    .rl-cal-past { background: var(--background-secondary); opacity: .55; }
    .rl-cal-past:hover { background: var(--background-modifier-hover); }
    /* 非当月：真实日期数字 + opacity 弱化 */
    .rl-cal-off { opacity: .35; }
    .rl-cal-d { font-size: 11px; color: var(--text-muted); margin-bottom: 3px; font-weight: 500; display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; border-radius: 50%; }
    /* 今天：日期数字主题色圆形 Badge（不填充整格，不遮事件内容） */
    .rl-cal-today .rl-cal-d { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 700; }
    /* 格子内事件：浅底色胶囊（类型色 14% 底 + 对应深色文字 + 类型图标），有边界感且易点击 */
    .rl-cal-it {
        display: flex; align-items: center; gap: 4px;
        font-size: 10px; line-height: 1.6; color: var(--tc);
        background: color-mix(in srgb, var(--tc) 14%, transparent);
        border-radius: 4px; padding: 1px 6px; margin-bottom: 2px;
        min-width: 0; cursor: pointer;
    }
    .rl-cal-it:hover { background: color-mix(in srgb, var(--tc) 22%, transparent); }
    .rl-cal-it-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-cal-more { font-size: 9.5px; color: var(--text-faint); padding: 1px 2px; }

    /* ── 视图切换 ── */
    .rl-cal-viewswitch { display: inline-flex; align-items: center; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; margin-left: 4px; }
    .rl-cal-viewbtn { font-family: inherit; font-size: 11px; border: none; background: transparent; color: var(--text-muted); padding: 3px 10px; cursor: pointer; }
    .rl-cal-viewbtn.on { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }

    /* ── 周视图：7 天列等高填满主区（与月历同高）；单日条目过多列内滚动 ── */
    .rl-cal-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 8px; flex: 1; min-width: 0; height: 100%; }
    .rl-cal-wday { display: flex; flex-direction: column; gap: 6px; min-height: 0; border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 8px; background: color-mix(in srgb, var(--background-primary) 88%, transparent); cursor: pointer; }
    .rl-cal-wday.rl-cal-wpast { opacity: .55; }
    .rl-cal-wday.rl-cal-wtoday { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-cal-wday.rl-cal-wdragover { border-style: dashed; border-color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 8%, transparent); }
    .rl-cal-whead { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
    .rl-cal-wday-name { font-size: 12px; font-weight: 700; color: var(--text-muted); }
    .rl-cal-wdate { font-size: 11px; color: var(--text-faint); }
    .rl-cal-witems { display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; overflow-y: auto; }
    .rl-cal-wcard { display: flex; gap: 6px; align-items: center; border: 1px solid color-mix(in srgb, var(--tc) 30%, transparent); background: color-mix(in srgb, var(--tc) 8%, transparent); border-radius: 8px; padding: 4px 6px; cursor: pointer; min-width: 0; }
    .rl-cal-wcard:hover { background: color-mix(in srgb, var(--tc) 16%, transparent); }
    .rl-cal-wcard-cov { width: 28px; height: 38px; object-fit: cover; border-radius: 4px; flex: none; }
    .rl-cal-wcard-ph { display: flex; align-items: center; justify-content: center; font-size: 13px; color: #fff; font-weight: 700; }
    .rl-cal-wcard-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .rl-cal-wcard-t { font-size: 11px; font-weight: 600; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-cal-wcard-tag { font-size: 9.5px; color: var(--text-muted); }
    .rl-cal-wcard-prog { font-size: 9.5px; color: var(--text-faint); font-family: ui-monospace, Consolas, monospace; }
    .rl-cal-wempty { font-size: 11px; color: var(--text-faint); opacity: .6; text-align: center; padding: 12px 0; }
</style>
