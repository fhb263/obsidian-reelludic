<script lang="ts">
    /**
     * 统计页「评分看板」（#635 ④，用户 2026-10-15）。
     *
     * 用户规格：卡片式主体容器 / 三大横向模块（评分标签区 · 分数区 · 作品展示区）/
     * 顶部分类 Tabs（带实时计数 Badge）/ 10 行（5★→0.5★）/ 左侧星级锚点约 15% /
     * 右侧拖放落点（空态浅灰「暂无作品」）/ 六色阶 / Ctrl+滚轮等比缩放。
     *
     * 🔴 #635 追问四项裁定：⑴ **加一行「未评分」**（最低行，拖进去 = 清除评分）；
     *    ⑵ 拖放来源 = **看板自己列出的未评分池**（就是最低那一行，往上拖即打分）；
     *    ⑶ 拖入**立即落库**；⑷ 同行多张**横排 + 自动换行**。
     *
     * ⚠️ 本组件**不做**任何阈值判断 / 排序 / 过滤 —— 全部走 `pure/ratingBoard`（有 25 例单测）。
     *    这里只做渲染 + 拖拽接线。
     */
    import type { MediaEntry } from 'data/types';
    import {
        BOARD_TABS,
        BOARD_TAB_LABELS,
        buildBoard,
        tabCounts,
        unratedRatio,
        ratingForRow,
        dropHint,
        type BoardTab,
        type RatingRow,
    } from 'pure/ratingBoard';
    import type { Rating } from 'pure/rating';

    export let entries: MediaEntry[] = [];
    /** 封面 URL 解析（与主视图同一条出口；拿不到时显示占位块） */
    export let coverUrlOf: (e: MediaEntry) => string | null = () => null;
    export let onOpenEntry: (id: string) => void = () => {};
    /**
     * 🔴 拖入即落库：宿主写 `rating` + 生成笔记，成功后刷新视图。
     * ⚠️ 用 `Promise` 让组件能显示「保存中」并**失败时回滚本地乐观更新**。
     */
    export let onSetRating: (id: string, rating: Rating) => Promise<void> = async () => {};

    /** 当前页签 */
    let tab: BoardTab = 'all';
    /** 本地乐观覆盖（id → rating）：拖入后立刻变位置，落库失败时回滚 */
    let optimistic: Record<string, Rating> = {};
    /** 正在提交的条目 id（显示保存态、防重复拖） */
    let busy: Record<string, true> = {};
    /** 错误提示（落库失败时给一句话，⛔ 不静默吞） */
    let errorMsg = '';

    /** 🔴 Ctrl+滚轮缩放：只作用于**本看板**（⛔ 不动主视图海报密度）；0.8 ~ 1.6 三档外插值 */
    let scale = 1;
    const SCALE_MIN = 0.8;
    const SCALE_MAX = 1.6;
    const SCALE_STEP = 0.1;

    /**
     * 🔴 缩放开关跟随设置页那条既有开关（`外观与体验 › Ctrl + 滚轮缩放`）——
     *    **不新开开关**（同一个手势两处开关会互相打架）。
     */
    export let ctrlWheelZoom = false;

    /** 应用乐观值后的条目集合（渲染与统计都吃它 ⇒ 拖完立刻看到变化） */
    $: merged = entries.map((e) => (optimistic[e.id] !== undefined ? { ...e, rating: optimistic[e.id] } : e));
    $: counts = tabCounts(merged);
    $: rows = buildBoard(merged, tab);
    $: ratio = unratedRatio(merged, tab);

    /** 拖拽中的条目 id（`dataTransfer` 在某些环境读不到，本地留一份更可靠） */
    let draggingId: string | null = null;
    /** 当前悬停的行下标（−1 = 没悬停）—— 就是规格里的「视觉激活态」 */
    let hoverRow = -1;

    function onDragStart(ev: DragEvent, e: MediaEntry) {
        draggingId = e.id;
        errorMsg = '';
        // `text/plain` 给浏览器一个「这是可拖内容」的最小信息；真正读的是本地 `draggingId`
        ev.dataTransfer?.setData('text/plain', e.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    }

    function onDragEnd() {
        draggingId = null;
        hoverRow = -1;
    }

    /**
     * 🔴 拖到某一行上方 = 让该行进入**视觉激活态**（用户规格 ④.1）。
     * ⚠️ 抽成具名函数（而不是模板里的多行箭头）：Svelte 4 的模板解析器对
     *    「属性里跨行的箭头函数体」很脆（会报 `Unexpected token`）—— 本仓记过同族坑。
     */
    function onDragOver(ev: DragEvent, i: number) {
        if (!draggingId) return;
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        hoverRow = i;
    }

    /** 拖出该行 ⇒ 收起激活态（⛔ 只在「确实是自己」时清，免得划过子元素时闪一下） */
    function onDragLeave(i: number) {
        if (hoverRow === i) hoverRow = -1;
    }

    /** 拖住的条目（视角高亮与提示文案都要它） */
    $: draggingEntry = draggingId ? merged.find((e) => e.id === draggingId) ?? null : null;

    async function onDrop(ev: DragEvent, row: RatingRow) {
        ev.preventDefault();
        const id = draggingId ?? ev.dataTransfer?.getData('text/plain') ?? '';
        hoverRow = -1;
        draggingId = null;
        if (!id) return;
        const e = merged.find((x) => x.id === id);
        if (!e) return;
        const next = ratingForRow(row);
        // 拖到自己原来那一行 ⇒ 什么都不做（⛔ 别白写一次笔记）
        if (e.rating === next) return;
        const prev = e.rating;
        optimistic = { ...optimistic, [id]: next };
        busy = { ...busy, [id]: true };
        try {
            await onSetRating(id, next);
        } catch (err) {
            // 🔴 失败**必须回滚**（否则界面显示已改成 3 星，库里还是原来的分）
            const back = { ...optimistic };
            delete back[id];
            optimistic = back;
            errorMsg = `保存失败：${err instanceof Error ? err.message : String(err)}（已还原为 ${prev} 星）`;
        } finally {
            const b = { ...busy };
            delete b[id];
            busy = b;
        }
    }

    function onWheel(ev: WheelEvent) {
        if (!ctrlWheelZoom || !ev.ctrlKey) return;
        ev.preventDefault();
        const next = Math.round((scale + (ev.deltaY > 0 ? -SCALE_STEP : SCALE_STEP)) * 100) / 100;
        scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, next));
    }

    /** 行左侧的主星数 / 半星数文本（「未评分」行显示「未」） */
    function anchorText(row: RatingRow): { main: string; sub: string } {
        if (row.unrated) return { main: '未', sub: '' };
        return { main: String(row.whole), sub: row.half !== null ? '.5' : '' };
    }
</script>

<div class="rl-board" style={`--rl-board-scale:${scale}`} on:wheel={onWheel} role="region" aria-label="评分看板">
    <!-- 顶部分类 Tabs（选中高亮 + 实时计数 Badge） -->
    <div class="rl-board-tabs" role="tablist" aria-label="内容分类">
        {#each BOARD_TABS as t}
            <button
                class="rl-board-tab"
                class:on={tab === t}
                role="tab"
                aria-selected={tab === t}
                on:click={() => (tab = t)}
            >
                <span class="rl-board-tab-label">{BOARD_TAB_LABELS[t]}</span>
                <span class="rl-board-tab-n">{counts[t]}</span>
            </button>
        {/each}
    </div>

    <div class="rl-board-meta">
        <span class="rl-board-unrated">未评分 {ratio[0]} / {ratio[1]}</span>
        {#if errorMsg}<span class="rl-board-err">{errorMsg}</span>{/if}
    </div>

    <div class="rl-board-body">
        {#each rows as row, i}
            <div class="rl-board-row" class:hover={hoverRow === i}>
                <!-- 评分标签区（约 15%）：大字号主星数 + 小字号半星数 -->
                <div class="rl-board-anchor tone-{row.tone}" class:unrated={row.unrated}>
                    <span class="rl-board-whole">{anchorText(row).main}</span>
                    {#if anchorText(row).sub}<span class="rl-board-half">{anchorText(row).sub}</span>{/if}
                </div>
                <!-- 分数区 + 作品展示区（拖放落点） -->
                <div
                    class="rl-board-slot"
                    class:empty={row.items.length === 0}
                    class:hover={hoverRow === i}
                    role="list"
                    aria-label={row.unrated ? '未评分' : `评分 ${row.rating}`}
                    on:dragover|preventDefault={(ev) => onDragOver(ev, i)}
                    on:dragleave={() => onDragLeave(i)}
                    on:drop={(ev) => void onDrop(ev, row)}
                >
                    {#if row.items.length === 0}
                        <span class="rl-board-placeholder">{draggingId && hoverRow === i ? dropHint(row, draggingEntry?.title) : '暂无作品'}</span>
                    {:else}
                        {#each row.items as e (e.id)}
                            <div class="rl-board-card" class:busy={!!busy[e.id]}>
                                <button
                                    class="rl-board-cov"
                                    draggable="true"
                                    data-tip={`《${e.title}》· 拖到其它行改评分`}
                                    on:dragstart={(ev) => onDragStart(ev, e)}
                                    on:dragend={onDragEnd}
                                    on:click={() => onOpenEntry(e.id)}
                                >
                                    {#if coverUrlOf(e)}
                                        <img src={coverUrlOf(e)} alt="" loading="lazy" decoding="async" />
                                    {:else}
                                        <span class="rl-board-cov-ph">{e.title.slice(0, 1)}</span>
                                    {/if}
                                </button>
                                <span class="rl-board-title" role="link" tabindex="0" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>{e.title}</span>
                            </div>
                        {/each}
                    {/if}
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    /* 🔴 卡片式主体容器：浅灰大卡 + 圆角 + 轻投影，与页面底色区分（用户规格 ①.1） */
    .rl-board {
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 10px);
        padding: 14px 16px 16px;
        /* 🔴 缩放走一个自定义属性：文字 / 卡片宽高 / 图标全部按它等比 */
        font-size: calc(13px * var(--rl-board-scale, 1));
    }
    /* ── 顶部 Tabs（选中 = 主题色胶囊 + 计数 Badge）── */
    .rl-board-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .rl-board .rl-board-tab {
        display: inline-flex; align-items: center; gap: 5px;
        height: auto; margin: 0; padding: 3px 10px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        background: var(--background-primary);
        color: var(--text-muted);
        font-family: inherit; font-size: .95em; font-weight: 500;
        box-shadow: none; cursor: pointer;
        transition: background .12s ease, color .12s ease, border-color .12s ease;
    }
    .rl-board .rl-board-tab:hover { color: var(--text-normal); }
    .rl-board .rl-board-tab.on {
        background: var(--interactive-accent); border-color: var(--interactive-accent);
        color: var(--text-on-accent); font-weight: 600;
    }
    .rl-board-tab-n { font-size: .85em; opacity: .75; font-variant-numeric: tabular-nums; }

    .rl-board-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: .9em; }
    .rl-board-unrated { color: var(--text-faint); font-variant-numeric: tabular-nums; }
    .rl-board-err { color: var(--text-error); }

    .rl-board-body { display: flex; flex-direction: column; gap: 5px; }
    /* 🔴 一行 = 评分标签区（约 15%）+ 作品展示区；**严格横向对齐**（用户规格 ①.2）。
       🔴🔴 行高**恒等**（用户 2026-10-15 裁定：「所有行统一高度（按有封面的高度）」）——
          这是用户规格「每行高度统一」与本批「横排 + 自动换行」两处对撞后的裁定：
          空行也占同样高，整张看板呈现**严格的表格对齐**（规格 ①.2），代价是空行留白。
       ⚠️ 高度按「封面(54) + 标题两行 + 上下内距」定 ⇒ 改封面尺寸要同步改这里（单一数字，别处不写）。 */
    .rl-board-row { display: flex; align-items: stretch; gap: 10px; height: calc(88px * var(--rl-board-scale, 1)); }

    /* 评分标签区：大字号主星数 + 小字号半星数 */
    .rl-board-anchor {
        flex: none; width: 15%; min-width: 72px;
        display: flex; align-items: baseline; justify-content: center; gap: 1px;
        padding: 10px 6px; border-radius: 8px; color: #fff;
    }
    .rl-board-anchor.unrated { font-size: .95em; align-items: center; }
    .rl-board-whole { font-size: 1.7em; font-weight: 800; line-height: 1; }
    .rl-board-half { font-size: 1em; font-weight: 700; line-height: 1; opacity: .92; }
    /* 🔴 六色阶（判据真源 = `pure/ratingBoard.toneOf`；⛔ 别在这里再判阈值） */
    .rl-board-anchor.tone-gold { background: linear-gradient(135deg, #f2c200, #f7dd6b); }
    .rl-board-anchor.tone-red { background: linear-gradient(135deg, #c0392b, #e57368); }
    .rl-board-anchor.tone-purple { background: linear-gradient(135deg, #7d3c98, #a569bd); }
    .rl-board-anchor.tone-blue { background: linear-gradient(135deg, #2471a3, #5dade2); }
    .rl-board-anchor.tone-green { background: linear-gradient(135deg, #1e8449, #58d68d); }
    /* 灰色 = 空数据 / 未评分（用户规格 ①.1 注） */
    .rl-board-anchor.tone-gray { background: linear-gradient(135deg, #95a5a6, #bdc3c7); }

    /* 作品展示区 = 拖放落点。
       🔴 行高固定 ⇒ 这里必须是 `overflow-y: auto`（作品多到换行放不下时**行内自滚**，
          ⛔ 不能让内容顶破行高把整张表的对齐搞乱）。
       ⚠️ 行内滚动条受 #634 的「滚动条偏好」管辖（跟随设置开关），这里不额外声明。 */
    .rl-board-slot {
        flex: 1 1 auto; min-width: 0;
        display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 8px;
        background: var(--background-primary);
        border: 1px dashed transparent;
        overflow-y: auto;
    }
    .rl-board-slot.empty { border-color: var(--background-modifier-border); }
    /* 🔴 拖拽悬停的**视觉激活态**（用户规格 ④.1：边框高亮 / 背景变深） */
    .rl-board-slot.hover {
        border-style: solid; border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
        box-shadow: 0 0 0 2px rgba(124, 58, 237, .12);
    }
    .rl-board-placeholder { color: var(--text-faint); font-size: .92em; }

    /* 一张作品卡 = 封面 + 标题（横排 + 自动换行 ⇒ 行高自适应，用户裁定 ⑷） */
    .rl-board-card { display: flex; flex-direction: column; align-items: center; gap: 3px; max-width: 92px; }
    .rl-board-card.busy { opacity: .55; }
    .rl-board .rl-board-cov {
        width: calc(40px * var(--rl-board-scale, 1)); height: calc(54px * var(--rl-board-scale, 1));
        margin: 0; padding: 0; border: 1px solid var(--background-modifier-border);
        border-radius: 4px; background: var(--background-secondary);
        box-shadow: none; overflow: hidden; cursor: grab;
    }
    .rl-board-cov:active { cursor: grabbing; }
    .rl-board-cov img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .rl-board-cov-ph {
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 100%; color: var(--text-faint); font-weight: 700;
    }
    .rl-board-title {
        max-width: 100%; font-size: .85em; line-height: 1.3; text-align: center;
        color: var(--text-muted); cursor: pointer;
        overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
        -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .rl-board-title:hover { color: var(--interactive-accent); }
</style>
