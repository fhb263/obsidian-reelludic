<script lang="ts">
    // 「合并视图」的「更多」菜单（#550）：把 #547 那两枚并排图标（追更 / 统计）收成**一枚**
    // 纯图标按钮 + 弹出菜单，三项 = 媒体库 · 追更表 · 统计页（真源 `pure/mergedPages`）；
    // ⚠️ #567 起标签用**页名**（追更那页的表 / 统计那页）—— ⛔ 别退回「追更 / 统计」。
    //
    // 🔴 为什么抽组件：它有**两个挂载点** —— 库列表页经工具栏的 `nav-entry` 插槽落在
    //    **与搜索框并排的右端**（#552 用户裁定「把海报墙更多菜单放在右上角与搜索框并排」）；
    //    追更 / 统计页（没有工具栏）由 `HomeView` 自己包一行。
    //    两处必须一字不差（同 #546 的 `NavMenu`），⛔ 别在 HomeView 里再手写一份面板 DOM。
    //
    // ⚠️ 当前所在页由父组件持有（`page`），本组件只负责「显示 + 报告点了哪一项」——
    //    ⛔ 不在本地存一份选中态（同一件事两个真相必然漂移）。
    import { onDestroy } from 'svelte';
    import Icon from './Icon.svelte';
    import { MERGED_PAGES, mergedPageIcon, mergedPageLabel, type MergedPage } from 'pure/mergedPages';

    /**
     * 🔴 #552：`inline` = 本组件被塞进**宿主工具栏那一行**（与搜索框并排）时的定位方式 ——
     *    `absolute; right: 0` 贴右端，⛔ 不进 flex 流（那一行是 `justify-content: center`，
     *    进流会把居中的「搜索框 + 添加」整组挤偏）。与 `NavMenu` 的 `inline` 同一套做法、同一份理由。
     *    ⚠️ 追更 / 统计页那一处（`.rl-more-bar`）**不传**它 —— 那边本来就是单独一行，走正常流即可。
     */
    export let inline = false;
    /** 当前所在页（父组件是唯一真源） */
    export let page: MergedPage = 'library';
    /** 选了某一页（父组件据此切换 `mergedPage`） */
    export let onPick: (p: MergedPage) => void = () => {};

    let open = false;
    let onDown: ((ev: MouseEvent) => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;

    function unbind() {
        if (onDown) { window.removeEventListener('mousedown', onDown); onDown = null; }
        if (onKey) { window.removeEventListener('keydown', onKey); onKey = null; }
    }
    function close() {
        unbind();
        open = false;
    }
    /**
     * 开 / 关。⭐ 窗口监听绑在 **click** 里（不是 mousedown）：本轮的 mousedown 早已派发完毕，
     * 否则会「刚打开就被自己的外点击监听关掉」（与 `MediaList` 题材面板同一条纪律）。
     */
    function toggle() {
        if (open) {
            close();
            return;
        }
        open = true;
        onDown = (ev: MouseEvent) => {
            const el = ev.target as HTMLElement | null;
            // 菜单内与按钮自身不关闭 —— 按钮走自己的 toggle
            if (el?.closest('.rl-more-pop') || el?.closest('.rl-more-btn')) return;
            close();
        };
        onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
    }
    function pick(p: MergedPage) {
        onPick(p);
        close();
    }
    onDestroy(unbind);
</script>

<div class="rl-more-wrap" class:is-inline={inline}>
    <button
        class="rl-more-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="更多"
        on:click={toggle}>
        <Icon icon="more-horizontal" size={15} /><span class="rl-sr">更多</span>
    </button>
    {#if open}
        <div class="rl-more-pop" role="menu">
            {#each MERGED_PAGES as p}
                <button
                    class="rl-more-item"
                    class:on={page === p}
                    type="button"
                    role="menuitemradio"
                    aria-checked={page === p}
                    on:click={() => pick(p)}>
                    <!-- 🔴 #555：图标与文字**各自一个固定槽位**（图标列定宽 + 文字左对齐）——
                         用户：「更多菜单展开的改成**固定图标列 + 文字左对齐**」。成因是核心
                         `button { justify-content: center }`（(0,0,1)，我们不写就被它居中）。
                         图标槽位另起一层 span，⛔ 不靠 `Icon` 自带宽度硬凑（换图标尺寸就漂）。 -->
                    <span class="rl-more-ico"><Icon icon={mergedPageIcon(p)} size={14} /></span>
                    <span class="rl-more-text">{mergedPageLabel(p)}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    /* 🔴 按钮尺寸必须**显式**写出来：宿主给所有 `button` 按死了 `height: var(--input-height)`（30px），
       不写回来按钮会被压成扁条（UI-GUIDE §3 老坑）。
       ⚠️ 选择器写**两级**（`.rl-more-wrap .rl-more-btn`）：单类（0,1,0）压不过核心的
       `button:not(.clickable-icon)`（0,1,1），会连带吃下它的灰底与内阴影。 */
    .rl-more-wrap { position: relative; display: inline-flex; }
    /* 🔴 #552 进宿主工具栏那一行时：`absolute; right: 0` 贴右端 —— ⛔ 不进 flex 流，
       否则把居中的「搜索框 + 添加」挤偏（同 `NavMenu` 的 `.rl-nav-wrap.is-toolbar`）。
       ⚠️ 仍是**定位元素**，所以下面那层弹出菜单照旧以它为准（`right: 0; top: 100% + 4px`）。 */
    .rl-more-wrap.is-inline {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        /* 🔴🔴 #553：**这一条不能省** —— 上面那句 `transform` 会**创建层叠上下文**，
           于是本 wrap 的层级被钉在 `auto`（= 0 层），而海报墙网格在 DOM 里排在工具栏**之后**
           ⇒ 同为 0 层、靠后的赢 ⇒ **弹出菜单被卡片盖住**（用户上手报的就是这个）。
           给一个明确层级即跳出这个死局（wrap 本身已是层叠上下文，z-index 直接生效）。
           ⚠️ 值取 40：要高于网格卡片，但**低于**右键菜单那一族（`.rl-ctx` / `.rl-ctx-anchor` 是 50/100）——
             后者是模态性质的浮层，压过它反而会让右键菜单钻到我们的菜单下面。
           ⚠️ 同类风险：`NavMenu` 的 `.rl-nav-wrap.is-toolbar` 也带 `transform`（同样是层叠上下文），
             它那层面板靠内部 `.rl-nav` 的 `z-index: 20` 撑着 —— 改那边之前先照这条口径核一遍。 */
        z-index: 40;
    }
    .rl-more-wrap .rl-more-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; padding: 0;
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px);
        background: transparent; color: var(--text-muted); box-shadow: none;
        cursor: pointer; font-family: inherit;
        transition: color var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    .rl-more-wrap .rl-more-btn:hover { color: var(--text-normal); }
    .rl-more-wrap .rl-more-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    /* 弹出菜单：右缘与按钮对齐、贴着下沿 4px（与 `NavMenu` 的面板同一条「够得着」纪律）。
       ⚠️ `z-index` 必须给：内容里的 `.rl-card` 是 relative 且 DOM 排在浮层之后。 */
    .rl-more-pop {
        position: absolute; right: 0; top: calc(100% + 4px); z-index: 20;
        min-width: 118px; padding: 4px;
        display: flex; flex-direction: column; gap: 2px;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px);
    }
    /* 菜单项：无边框无底（拍平）—— 核心 `button:not(.clickable-icon)` 的灰底 / 内阴影 / 定高
       全部要压掉（同样是两级选择器 + 显式 `height: auto`）。
       🔴 #555：**必须显式 `justify-content: flex-start`** —— 核心 `button { justify-content: center }`
       是 (0,0,1) 的常驻声明，我们不写它就照样生效（菜单项内容被居中）。
       ⛔ 别指望「没写就不生效」：CSS 只在**同属性**相撞时才比特异性，缺声明＝让对方接管。 */
    .rl-more-wrap .rl-more-item {
        display: inline-flex; align-items: center; justify-content: flex-start; gap: 8px;
        width: 100%; height: auto; padding: 4px 8px;
        border: none; background: transparent; box-shadow: none;
        color: var(--text-normal); font-family: inherit; font-size: 12px;
        border-radius: var(--rl-t-radius-sm, 4px); cursor: pointer; text-align: left;
    }
    /* 固定图标列：无论图标实际多宽，文字都从**同一条 x** 起排（⛔ 不要让 `gap` 独自承担对齐）。 */
    .rl-more-ico {
        flex: none; width: 16px; display: inline-flex; align-items: center; justify-content: center;
    }
    .rl-more-text { text-align: left; white-space: nowrap; }
    .rl-more-wrap .rl-more-item:hover { color: var(--interactive-accent); }
    /* 当前所在项**只变色**（与全仓「并排的切换类只变色」同口径，⛔ 不铺底）。 */
    .rl-more-wrap .rl-more-item.on { color: var(--interactive-accent); font-weight: 600; }
    .rl-more-wrap .rl-more-item:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
</style>
