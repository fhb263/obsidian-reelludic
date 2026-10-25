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

    /**
     * 行左侧的评分文本（#656 改版；#657 起改名 `rowText`）。
     * 🔴 参考 AnimeList 的写法：**「5.0」+「N 部作品」** 两行，而不是原来的「大 4 + 小 .5」拼字 ——
     *    拼字在小字号下容易读成「4 .5」，而补两位的定点数在等宽数字下上下对齐得好。
     * ⚠️ 同一个函数也喂**悬停提示**（`评分 5.0`）⇒ 提示里的数字与行里显示的**逐字一致**（⛔ 别另算一份）。
     */
    function rowText(row: RatingRow): string {
        if (row.unrated) return '未评分';
        return row.half !== null ? `${row.whole}.5` : `${row.whole}.0`;
    }

    /**
     * 🔴🔴 #689（用户 2026-10-19）：「为什么要分间隔开这么大，**多塞几个进去自适应**不行吗」。
     *
     * 上一版（#687）为了「末行不留空」去挑 **能整除件数** 的列数 —— 结果 55 件被拆成 11 列 × 5 行，
     * 一行只放 11 个、卡片被撑到 100px，整片看着又空又大。用户要的从来不是「除得开」，
     * 而是 **一排能放多少就放多少**。
     *
     * ⇒ 现在就是纯自适应：**按最小卡片宽能排几列就排几列**，`1fr` 均分宽度。
     *   · 窗口越宽 ⇒ 列数越多（`slotW` 由 `boardBodyW` 喂进来，ResizeObserver 触发重算）；
     *   · 末行自然不满 —— 这是「尽量多塞」的必然结果，⛔ 不再为它牺牲行内密度。
     */
    const MIN_CARD_PX = 56;
    /** 卡片宽上限：只用来挡住「一行只有 1~2 件被拉成巨图」（实测曾出现 1184px）。
     *  ⚠️ 正常行（十几件）算出来的宽远小于它，不参与限制，所以「多塞」仍是主行为。
     *  ⚠️ #690 起实际生效的上限是模板给的 `--rl-board-card-max`（= cardPx × 1.15，跟着缩放走）；
     *     这个常量只用来算兜底上限，⛔ 别再把它直接写进 CSS 变量。 */
    const MAX_CARD_PX = 104;
    /** 卡片间距（grid 的 column-gap / row-gap 同一值）。 */
    const BOARD_GAP = 8;
    /** 槽位实测可用宽（px）；0 = 还没量到。 */
    let boardBodyW = 0;
    $: slotW = Math.max(0, boardBodyW - 112); // 112 = 左侧评分列宽（见 .rl-board-anchor 的 flex-basis）

    /* 🔴🔴 #690（用户 2026-10-20）：「统计页-评分看板的 ctrl+鼠标滚轮缩放怎么只是标题字体放大缩小啊，
       我要的是封面作品随放大缩小」。

       根因：旧实现把 `scale` **只**当**列数下限**用（`minW = 56 * scale`），列宽仍是 `1fr` 均分剩余空间。
       1244px 宿主里槽内宽算出来是 1044，scale 拉到上限 1.6 时 `floor((1044+8)/(89.6+8)) = 10` 列
       ⇒ 每张 **~96px**，而 scale=1 时是 `floor((1044+8)/64) = 16` 列 ⇒ 每张 **~60px`**。
       也就是说卡片其实变大了，但代价是**整行件数从 16 掉到 10**、看板被拉高一大截；
       而 `--rl-board-scale` 同时还挂在 `.rl-board { font-size }` 上 —— 1.6 倍字号把标题顶得
       比封面还抢眼 ⇒ 用户的体感就是「只有字变大」。这个换列策略本来就是错的。

       ⇒ 现在改成 **显式 px 卡片宽**：`cardPx = 56 * scale` 直接决定格子宽度，
          `repeat(auto-fill, minmax(cardPx, 1fr))` 让浏览器自己决定一行塞几个（宽了就少塞、窄了就多塞），
          封面按 `aspect-ratio: 2/3` 撑高 ⇒ **封面本身在屏幕上真的变大变小**，标题字号不跟 scale 走。

       ⚠️ `1fr` 的副作用：末列会把剩余空间吃满 ⇒ 卡片被拉宽（实测跨过 8px 间距的整数倍就会出现）。
          这里给卡片补 `max-width: cardPx * 1.15` 兜住，多出来的空白走 `justify-content: center` 均分到两侧。
       ⚠️ 真正的宽度上限只有一个：一行至少要放得下 1 张卡（见 `cardPx` 与 avail 的夹取）。 */
    const CARD_BASE_PX = MIN_CARD_PX;
    /** 卡片当前目标宽（px）= 基准宽 × 缩放倍率（不取整，缩放才连续）。 */
    $: cardPx = Math.max(24, CARD_BASE_PX * scale);
    /** 卡片宽上限（挡住 1fr 把末列拉宽）。 */
    $: cardMaxPx = Math.round(cardPx * 1.15);
    $: slotStyleStr = `grid-template-columns:repeat(auto-fill,minmax(${Math.round(cardPx)}px,1fr))`;
</script>

<div class="rl-board" style={`--rl-board-card-max:${cardMaxPx}px`} on:wheel={onWheel} role="region" aria-label="评分看板">
    <div class="rl-board-head">
        <div class="rl-board-titlebar">评分看板</div>
    </div>
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
        <!-- 🔴 #658（用户：「拖封面到其它行改评分这提示放在【未评分62/131】右旁边」）：
             操作说明从「每行悬停弹一次」改成**这里的一处静态文字** —— 用户一进来就看得到，不用逐个去悬停。 -->
        <span class="rl-board-hint">拖封面到其它行即可改评分</span>
        {#if errorMsg}<span class="rl-board-err">{errorMsg}</span>{/if}
    </div>

    <div class="rl-board-body" bind:clientWidth={boardBodyW}>
        {#each rows as row, i}
            <div class="rl-board-row" class:hover={hoverRow === i}>
                <!-- 评分列（112px）：淡底 + 左缘色条；「5.0」+「N 部作品」两行（#656） -->
                <div class="rl-board-anchor tone-{row.tone}" class:unrated={row.unrated}>
                    <span class="rl-board-score">{rowText(row)}</span>
                    <span class="rl-board-count">{row.items.length} 部作品</span>
                </div>
                <!-- 分数区 + 作品展示区（拖放落点）。
                     🔴🔴 #659（用户：「我说评分看板每个行鼠标 hover 不要出现如『评分 5』之类的轻提示」）：
                     **`aria-label` 就是那个提示的来源** —— Obsidian 会给带 `aria-label` 的元素自绘官方气泡
                     （本仓记过这条：见 UI-GUIDE §3「aria-label 会触发官方 tooltip」）。
                     上一版虽然删了 `data-tip`，却把 `aria-label="评分 5"` 留在这儿 ⇒ 悬停照样弹「评分 5」。
                     ⇒ 行容器**不带 `aria-label`**；读屏语义改由**行首的评分文字**承担（它本来就在 DOM 里，
                       `role="list"` 的每个 item 读出来就带这个数字，⛔ 不需要再重复一遍）。
                     操作说明是顶部「未评分 N / M」右边那**一处**静态文字（见上方 `rl-board-meta`）。 -->
                <div
                    class="rl-board-slot"
                    class:empty={row.items.length === 0}
                    class:hover={hoverRow === i}
                    role="list"
                    style={slotStyleStr}
                    on:dragover|preventDefault={(ev) => onDragOver(ev, i)}
                    on:dragleave={() => onDragLeave(i)}
                    on:drop={(ev) => void onDrop(ev, row)}
                >
                    {#if row.items.length === 0}
                        <span class="rl-board-placeholder">{draggingId && hoverRow === i ? dropHint(row, draggingEntry?.title) : '暂无作品'}</span>
                    {:else}
                        {#each row.items as e (e.id)}
                            <!-- 🔴 #657：封面只挂**标题**（拖拽改分是整行的能力，不是这一张封面的属性）。
                                 🔴🔴 踩过的坑：Svelte 模板注释是**非嵌套**的 —— 注释正文里一旦再写一个
                                 左尖括号 + 叹号 + 两个连字符，浏览器 / 编译器会在**那里**提前收掉注释，
                                 剩下的右箭头就成了**页面上看得见的文字**（用户报障：「不能出现在属性列表中间」）。
                                 ⇒ 注释里要提到这个记号，只能像本节这样绕开书写，⛔ 别原样再写一遍。 -->
                            <div class="rl-board-card" class:busy={!!busy[e.id]}>
                                <button
                                    class="rl-board-cov"
                                    draggable="true"
                                    data-tip={e.title}
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
    /* ══ 🔴🔴 #656 改版（用户：「这个统计页的评分看板太丑了，参考 AnimeList 这评分看板」）══

       参考版 = AnimeList 的 Score Dashboard：**一行一条评分带**，「窄评分列（淡底 + 左缘色条）+ 封面流」，
       行间一条发丝线，封面大、标题单行。改前的三处毛病与对应改法：
         ⑴ **每行一个实心大渐变块**（六色铺满 15% 宽）⇒ 颜色成了页面主色，看板像一排彩色标签；
            ⇒ 评分列收窄到 **112px**、**淡底 + 左侧 4px 色条**（颜色只当标记）。
         ⑵ **封面 40×54 太小**、标题两行把行撑到 88px，内容区还各自 `overflow-y: auto`（右边缘多一条滚动条）；
            ⇒ 封面 **64×96**、标题**单行**省略、行高**随内容自适应**、内容区**不滚**。
         ⑶ **空行留一整条 88px 虚线大框** ⇒ 空行收到最小（只留一句灰字）。
       ⚠️ 拖拽 / 落点 / 缩放 / 乐观更新这些**行为一行没动**（那是 #635 定的，25 例单测钉着）。

       🔴 覆盖旧规则的坑（本批实测）：Svelte 编译后每条规则都会带 `.svelte-<hash>`，
          写成 `.rl-board-anchor`（0,1,0）**压不过**编译后的（0,2,0）—— 上一版我在 styles.css 里加覆盖层，
          结果行高、封面全都没生效。⇒ **直接改这里**，⛔ 别再在外部文件里加一层覆盖。 */
    /* 卡片式主体容器：与外层页面底色区分 */
    .rl-board {
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-m, 8px);
        padding: 14px 16px 16px;
        /* 🔴🔴 #690（用户 2026-10-20）：「ctrl+滚轮缩放怎么只是标题字体放大缩小，我要的是封面随放大缩小」。
           旧写法是 `font-size: calc(13px * var(--rl-board-scale))` —— 缩放**唯一**看得见的结果就是全看板字号变大
           （标题比封面还显眼），封面靠列数变少顺带变大。这就是用户报的「只有字在放大」。
           ⇒ 缩放**不再驱动本块字号**：封面大小由模板给的 grid 的 `minmax(cardPx, 1fr)` 决定，
             文字保持固定档（本看板本来就是信息密度工具，字跟着封面的比例放大没有必要）。 */
        font-size: 13px;
    }
    .rl-board-head { margin-bottom: 10px; }
    .rl-board-titlebar { font-size: 1.1em; font-weight: 700; color: var(--text-normal); margin-bottom: 4px; }
    /* ── 顶部 Tabs（选中 = 主题色胶囊 + 计数 Badge）── */
    .rl-board-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
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

    .rl-board-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: .9em; color: var(--text-muted); }
    .rl-board-unrated { color: var(--text-muted); font-variant-numeric: tabular-nums; }
    /* 🔴 #658：操作说明（「未评分 N / M」右边那一句）—— 浅一档，别抢过统计数字本身 */
    .rl-board-hint { color: var(--text-faint); font-size: .95em; }
    .rl-board-err { color: var(--text-error); }

    /* ── 主体：一行 = 评分列 + 封面流（行间一条发丝线，⛔ 不是每行一张卡）── */
    .rl-board-body { display: flex; flex-direction: column; }
    .rl-board-row {
        display: flex; align-items: stretch;
        border-top: 1px solid var(--background-modifier-border);
    }
    .rl-board-row:first-child { border-top: none; }
    .rl-board-row:hover { background: var(--background-secondary); }

    /* 左侧评分列：淡底 + 左侧 4px 色条；分数等宽数字，扫读时上下对齐 */
    .rl-board-anchor {
        flex: 0 0 112px; min-width: 0;
        display: flex; flex-direction: column; justify-content: center; gap: 2px;
        padding: 10px 12px 10px 14px;
        border-left: 4px solid var(--rl-bd-tone, var(--background-modifier-border));
        background: var(--background-secondary);
    }
    .rl-board-anchor.unrated { justify-content: center; }
    .rl-board-score { font-size: 1.05em; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--text-normal); }
    .rl-board-count { font-size: .85em; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    /* 🔴 六色阶（判据真源 = `pure/ratingBoard.toneOf`；⛔ 别在这里再判阈值）：
       只定义**色条用的那一个变量**，⛔ 不再给整块渐变背景。 */
    .rl-board-anchor.tone-gold { --rl-bd-tone: #f2c200; }
    .rl-board-anchor.tone-red { --rl-bd-tone: #e05a4f; }
    .rl-board-anchor.tone-purple { --rl-bd-tone: #9b6bd6; }
    .rl-board-anchor.tone-blue { --rl-bd-tone: #3f9bd8; }
    .rl-board-anchor.tone-green { --rl-bd-tone: #45b26b; }
    .rl-board-anchor.tone-gray { --rl-bd-tone: var(--background-modifier-border); }
    .rl-board-anchor.unrated { --rl-bd-tone: var(--text-faint); }

    /* 右侧封面流（拖放落点）：**行高随内容**，⛔ 不再固定 88px、⛔ 不再行内滚动 */
    /* 🔴 #670（用户：「评分看板最后显示的一个封面作品间隔开了，但有几个放大能塞进去」）：
       1244px 宿主里槽内宽 = 1244 − 评分列 112 − 槽左右内距 = 1044。
       旧（卡片 64 + 间距 10）⇒ 每行最多 **floor((1044+10)/74) = 14** 件 ⇒ 第 15 件被挤到第二行、
       行高翻倍、右侧留一条空白 —— 用户看到的正是「最后那一个间隔开了」。
       新（卡片 56 + 间距 8 + 内距 10）⇒ 每行 **floor((1044+8)/64) = 16** 件；同样 14 件时
       **空档从 18px 变成 160px**（实测见 `_probe_670_board.cjs`）⇒ 差一点点的那几行就回来了。
       ⚠️ 封面 96→84 是等比跟着宽度走的（64:96 = 2:3 = 56:84），⛔ 只改宽不改高会压扁封面。 */
    .rl-board-slot {
        flex: 1 1 auto; min-width: 0;
        /* 🔴🔴 #687（用户 2026-10-19）：「统计页评分看板作品封面最后一个间隔按填满」。
           旧写法是 flex + wrap + 固定卡片宽（56px）⇒ 每行件数由「槽宽 ÷ 卡片宽」决定，
           最后一行只剩几件时右侧留一大条空白（实测 5.0 分 55 件 = 18/18/18/**1**，
           末行空白 **1139px**；1 件的那几行看着像「孤零零一个小封面」）。
           ⇒ 改成 **grid**，列数由浏览器按「格子下限 + 可用宽」自动决定，
             所有行共用同一档 ⇒ 封面大小统一；`1fr` 把整行吃满 ⇒ 不再有「最后一个间隔」。
           ⚠️ 列宽用 `minmax(0, 1fr)`：不加 `minmax` 时 grid 的自动最小尺寸是内容宽，
              标题一长列就变宽（本仓 #446 踩过同类）。
           ⚠️ 卡片另有 `max-width: var(--rl-board-card-max)` 兜住「整行只 1 件」被拉成巨图。 */
        display: grid;
        /* 列数完全交给浏览器（`auto-fill`）：格子下限 = 当前缩放的卡片宽，
           所以**缩放越大一行塞得越少、每张封面越宽**。模板里 `slotStyleStr` 会覆盖这一行，
           这里只是没拿到内联样式时的兜底（⛔ 别在这里写死 `56px * scale`，那会把缩放写回「只改列数」的老路）。 */
        grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
        align-content: flex-start;
        align-items: flex-start;
        justify-items: center;
        justify-content: center;
        column-gap: 8px;
        row-gap: 8px;
        padding: 8px 10px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        overflow: visible;
    }
    /* 🔴 #656 ⑶：空档收成**一行灰字**（原来是 88px 高的虚线大框） */
    .rl-board-slot.empty { padding: 8px 12px; border-style: none; }
    .rl-board-placeholder { color: var(--text-faint); font-size: .9em; }
    /* 🔴 拖拽悬停的**视觉激活态**（用户规格 ④.1：边框高亮 / 背景变深） */
    .rl-board-slot.hover {
        border-color: var(--interactive-accent);
        background: var(--background-modifier-hover);
        box-shadow: 0 0 0 2px rgba(124, 58, 237, .12);
    }

    /* 一张作品卡 = 封面 + **单行**标题（标题截断 ⇒ 行高稳定）
       🔴🔴 #687：槽位改成 grid 等分后，卡片宽从「固定 56×scale」改为**跟随格子**（`width: 100%`）。
          封面再按 2:3 用 `aspect-ratio` 撑高 —— 这样：
            · 每行都被吃满，⛔ 不会再有「最后一个间隔」；
            · 卡片宽度直接由 `56px × scale` 决定（#690）——封面真的变大变小，⛔ 别再靠「改名后改列数」间接实现；
            · ⛔ 别再写死 cover 的 height：定高 + 变宽会把封面压扁。
       ⚠️ 缩放封顶仍是必需的老经验（#672）：卡片跟着 scale 无限放大会让「一行几件」塌到 13/14 件，
          所以格宽下限用 `calc(56px * scale)` 而**不是**让卡片无上限放大。 */
    .rl-board-card {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        /* ⚠️ 注释里不要写反引号：本仓在模板串里踩过三次（提前结束模板串） */
        width: 100%;
        min-width: 0;
        /* 🔴 #687/#689：格子里收一道上限，挡住「整行只 1~2 件被拉成 1184px 巨图」（实测踩过）。
           正常行（十几件）算出的格宽远小于上限，所以这里**不会**制造额外间隔。
           ⚠️ 上限走 CSS 变量（`--rl-board-card-max`，由模板按 scale 给）。 */
        max-width: var(--rl-board-card-max, 104px);
    }
    .rl-board-card.busy { opacity: .55; }
    .rl-board .rl-board-cov {
        width: 100%;
        aspect-ratio: 2 / 3;
        height: auto;
        margin: 0; padding: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px; background: var(--background-secondary);
        box-shadow: none; overflow: hidden; cursor: grab;
    }
    .rl-board-cov:active { cursor: grabbing; }
    .rl-board-cov img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .rl-board-cov-ph {
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 100%; color: var(--text-faint); font-weight: 700;
    }
    .rl-board-title {
        width: 100%; font-size: .8em; line-height: 1.3; text-align: center;
        color: var(--text-muted); cursor: pointer;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rl-board-title:hover { color: var(--interactive-accent); }
</style>
