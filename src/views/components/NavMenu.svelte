<!--
  主视图一级导航的**第二种形态**（用户裁定：图表菜单 / 文字菜单）。

  🔴 **为什么是一个独立组件**（#546）：这一套东西有**两个挂载点** ——
     ⑴ 有工具栏的页签（阅读/影视/游戏/音乐）⇒ 由宿主经 `<slot name="nav-entry">` 放进 MediaList
        **搜索框那一行的最右端**（用户 2026-10-07：「页签纯文字入口放在与搜索框并排显示」）；
     ⑵ 没有工具栏的页签（计划/统计）⇒ 由 HomeView 自己渲染成**靠右的独立一行**。
     ⇒ 两处必须是**同一份实现**（⛔ 不许各写一份 DOM）：文案、ARIA、键盘、面板全在这里。

  🔴 形态约定（#545 定形、#546 只换挂载位置，形态一字未改）：
     · 入口 = 一行**当前页名大字**（19px 纯文字，无底无边无图标）—— 因为它是纯文字，
       所以必须有反馈：悬停 / 键盘聚焦时**转强调色**；
     · 🔴🔴 **#597：揭示改「状态驱动」**（用户 2026-10-10：「优化导航布局为文字菜单时的交互逻辑，悬停展开移开收回，
       选中新页签后下拉自动收回」）—— 组件内 `open` 一个布尔，由 `mouseenter/mouseleave` + `focusin/focusout`
       驱动，CSS 只看 `.is-open`。
       ⛔ **别再退回纯 CSS 的悬停 / 焦点揭示**（那两条规则本批已从样式里删掉）：那条路有两个治不好的洞 ——
       ⑴ 点完页签那个 button 还拿着焦点 ⇒ 焦点态让它**一直开着**（用户报的正是这个）；
       ⑵ 鼠标还压在下拉上 ⇒ 悬停态也让它一直开着 —— 两条都**没法在选中那一刻收起来**。
       ⚠️ 选中后**不 blur**（键盘 Enter 选页签时 blur 会把焦点丢回 body ⇒ 键盘用户失去位置）；
       靠「click 里的 `open = false` 跑在 focusin 之后」这一条顺序保证收回。
     · 隐藏态用 `opacity + pointer-events`（收起后不再吃指针 ⇒ 指针留在原处也不会把它重新点亮）：
       悬停大字 / 键盘聚焦 ⇒ 从大字**正下方**展开 208px 页签列表（绝对定位浮层，⛔ 不推动内容）；
     · 🔴 **面板必须跟随入口**：入口在右、面板若浮在别处，鼠标移过去会先移出热区 ⇒ 面板当场收起、
       一项都点不到 —— 这不是审美问题，是**够不着**；
     · 🔴 面板默认态用 `opacity + pointer-events` 收，⛔ **不用 visibility 藏**（后者会把面板里的
       button 一并移出 Tab 序，而大字不是 button、没有替身可聚焦 ⇒ 键盘用户彻底没有导航）。

  ⚠️ `inline` 只影响**自身在宿主行里的定位**（绝对定位贴右端），面板内部一字不变。
-->
<script lang="ts">
    import { tick } from 'svelte';
    import Icon from './Icon.svelte';
    // 🔴 页签的**顺序 / 显示名 / 图标**只有 `pure/homeTabs` 一份 —— 顶部胶囊与这里共用，
    //    ⛔ 别在本组件里再写第二份 TAB_ORDER / tabLabel / tabIcon。
    import { HOME_TAB_ORDER, homeTabIcon, homeTabLabel, type HomeTab } from 'pure/homeTabs';
    import { resolveTabKey } from 'pure/tabNav';

    /** 当前页签：大字显示它，面板里那一项高亮 */
    export let activeTab: HomeTab;
    /** 选中回调（宿主负责切页并落库） */
    export let onSelect: (t: HomeTab) => void = () => {};
    /** #546：挂进**工具栏那一行**（MediaList 右端，与搜索框并排）时为 true */
    export let inline = false;

    let tabsEl: HTMLElement | null = null;

    /**
     * 🔴 #597：面板开合 = **组件自己的状态**（⛔ 不是 CSS 的悬停 / 焦点态，理由见文件头）。
     *  · `reveal`（悬停大字 / 面板 或 键盘聚焦进来）⇒ 开；
     *  · `hide`（移开整个 wrap / 焦点离开）⇒ 收；
     *  · `select`（点了某一页）⇒ **先收再切页** —— 鼠标还压在下拉上时也能收（纯 CSS 的悬停态做不到这件事）。
     */
    let open = false;
    function reveal(): void {
        open = true;
    }
    function hide(): void {
        open = false;
    }
    function select(t: HomeTab): void {
        open = false;
        onSelect(t);
    }

    /**
     * 页签键盘导航：本形态恒为**竖向**（↑/↓ 移动，另一对方向键留给页面滚动）。
     * ⚠️ 与顶部胶囊走**同一份**纯逻辑 `pure/tabNav`，差别只在轴向（#541 起「按布局换轴」）。
     */
    function onTabKeydown(ev: KeyboardEvent, current: HomeTab) {
        const r = resolveTabKey(ev.key, HOME_TAB_ORDER.indexOf(current), HOME_TAB_ORDER.length, {
            orientation: 'vertical',
        });
        if (!r.handled) return;
        ev.preventDefault();
        const next = HOME_TAB_ORDER[r.index];
        if (next !== current) onSelect(next);
        // 焦点跟随：不主动聚焦会留在原按钮上，而那个按钮已变成 tabindex=-1
        void tick().then(() => {
            tabsEl?.querySelectorAll<HTMLElement>('button')[r.index]?.focus();
        });
    }
</script>

<!-- 🔴 #597：wrap 现在带 `mouseenter` / `mouseleave`（状态驱动的揭示）⇒ 必须给它一个 ARIA role，
     否则 Svelte 的 a11y 检查报「div with mouseenter, mouseleave handlers must have an ARIA role」
     （基线 89 warnings 会变 90）。`role="navigation"` 语义上也对：它就是这一页的主导航。
     🔴 #603：主导航的**可访问名**改走 `aria-labelledby` → 下面那枚 `.rl-sr` 文本节点。
     ⛔ 别再挂 `aria-label` —— Obsidian 会把带 `aria-label` 的元素当成**悬停提示**，而本 wrap 正是
     「文字菜单」布局里**专门用来悬停唤出面板**的那块区域 ⇒ 鼠标一进去就多浮一个「ReelLudic 主导航」
     的气泡（与用户报障的「悬停海报墙空隙浮出『媒体库』」同一个病根）。
     ⚠️ `.rl-sr` 是 1×1 被裁掉的（`clip: rect(0 0 0 0)`）⇒ 鼠标够不着它，不会形成第二个气泡。 -->
<div
    class="rl-nav-wrap"
    role="navigation"
    aria-labelledby="rl-nav-wrap-label"
    class:is-toolbar={inline}
    class:is-open={open}
    on:mouseenter={reveal}
    on:mouseleave={hide}
    on:focusin={reveal}
    on:focusout={hide}>
    <span class="rl-sr" id="rl-nav-wrap-label">ReelLudic 主导航</span>
    <!-- 大字：**不是 button** —— 揭示由上面那四个事件驱动（#597），
         挂一个假 button 只会多出一个「点下去没反应」的控件（真页签是面板里那 6 个）。 -->
    <div class="rl-nav-title">{homeTabLabel(activeTab)}</div>
    <!-- 面板内那列页签：名字同样走 `aria-labelledby` → `.rl-sr`（口径见上面 wrap 那段）。
         ⚠️ 面板有 10px 内距 + 4px 行距，鼠标从边缘挪到某一项会经过这些缝 ⇒ 挂 `aria-label` 就会在那里
         冒气泡（#603）。 -->
    <span class="rl-sr" id="rl-nav-tabs-label">ReelLudic</span>
    <div
        class="rl-nav"
        role="tablist"
        aria-labelledby="rl-nav-tabs-label"
        aria-orientation="vertical"
        bind:this={tabsEl}>
        {#each HOME_TAB_ORDER as t}
            <button
                id={`rl-tab-${t}`}
                class:on={activeTab === t}
                role="tab"
                aria-selected={activeTab === t}
                aria-controls="rl-home-tabpanel"
                tabindex={activeTab === t ? 0 : -1}
                on:click={() => select(t)}
                on:keydown={(ev) => onTabKeydown(ev, t)}>
                <Icon icon={homeTabIcon(t)} size={17} />
                <span class="rl-nav-label">{homeTabLabel(t)}</span>
            </button>
        {/each}
    </div>
</div>

<style>
    /* 🔴 选择器一律带 `.rl-nav-wrap` 前缀：宿主核心有 `button:not(.clickable-icon)`（0,1,1），
       单类（0,1,0）压不过它 ⇒ 会出灰底 + `--input-shadow` 内阴影（§3 v15 老坑）。
       前缀取**本组件自己的根类**（`.rl-nav-wrap` 就是根），这样两个挂载点都命中。 */
    .rl-nav-wrap {
        position: relative;
        /* 🔴 这 6px 内距是**桥接缝**、不是留白：面板与大字的视觉缝要落在 wrap 的**盒内**，
           否则鼠标从大字往下移会先离开 wrap ⇒ 悬停态断掉、面板收起，跨不过去也就点不到。
           ⚠️ 缝的**下界取本元素底边**（悬停态面板顶 == 它）；别拿默认态面板的 rect.top 去量
              （那上面还挂着 -4px 抬升，会量出 2px 的假读数）。 */
        padding-bottom: 6px;
        z-index: 20; /* 🔴 内容里的卡片是 `position: relative`、DOM 又排在本浮层之后，不给就被盖住 */
    }
    /* #546：挂进工具栏那一行时，贴该行**右端**垂直居中（`.rl-toolbar` 自带 position:relative）；
       ⛔ 不走 flex 项 —— 那一行是 `justify-content: center`，插进去会把搜索框整体挤偏。 */
    .rl-nav-wrap.is-toolbar {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
    }
    .rl-nav-title {
        font-size: 19px; font-weight: 500; line-height: 1.2; color: var(--text-normal);
        /* ⛔ 别写 `cursor: pointer`：它不是可点的控件（揭示靠 hover/focus）；也别让悬停把它选蓝 */
        cursor: default; user-select: none;
        transition: color var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    /* 🔴 #597：大字变色跟着**状态**（⛔ 不是悬停 / 焦点态）—— 面板被选中动作收起来后，
       大字也跟着回到常规色（否则会留下「鼠标压着的地方还是强调色、面板却没了」的错位感）。 */
    .rl-nav-wrap.is-open .rl-nav-title { color: var(--interactive-accent); }
    .rl-nav {
        position: absolute; right: 0; top: 100%;
        display: flex; flex-direction: column; gap: 4px;
        width: 208px; box-sizing: border-box; padding: 10px;
        background: var(--background-secondary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px);
        box-shadow: var(--rl-t-shadow-menu, 0 4px 14px rgba(0, 0, 0, .15));
        /* 🔴 默认态用 `opacity + pointer-events` 收起来、⛔ **不用 visibility 藏**：
           后者会把面板里的 button 一并移出 Tab 序 ⇒ 键盘用户彻底没有导航入口
           （大字不是 button、没有替身可聚焦）。保留可聚焦 ⇒ Tab 进来时 `focusin` 把它揭示出来（#597）。
           ⚠️ 位移只用 4px 的小抬升（⛔ 别写 -100% / 大位移：那纯属为动画给自己添横向溢出风险）。 */
        opacity: 0; pointer-events: none;
        transform: translateY(-4px);
        transition: opacity var(--rl-t-dur, .18s) var(--rl-t-ease, ease),
                    transform var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    /* 🔴 #597：揭示只看 `.is-open`（状态驱动）；收起后 `pointer-events: none` ⇒ 指针留在原处
       也不会把它重新点亮（用户要的「选中新页签后下拉自动收回」在鼠标仍压着面板时也成立）。 */
    .rl-nav-wrap.is-open .rl-nav {
        opacity: 1; pointer-events: auto; transform: translateY(0);
    }
    /* 🔴 深色下浮层必须**比页面亮**一档 —— 与 §6.2 那条同源（#375 实测：Minimal 系主题的
       `--background-secondary` 比页面**暗** 2% 亮度 ⇒ 整块面板「凹下去」）。写法与 `.rl-tabs` 深色分支逐字同款。 */
    :global(body.theme-dark) .rl-nav {
        background: color-mix(in srgb, var(--background-primary), var(--color-base-100, #ffffff) 6%);
    }
    .rl-nav-wrap .rl-nav button {
        display: flex; align-items: center; gap: 10px;
        width: 100%; height: 36px; box-sizing: border-box; padding: 0 10px;
        border: none; border-radius: var(--rl-t-radius-md, 6px);
        background: transparent; color: var(--text-muted);
        font-family: inherit; font-size: 13.5px; font-weight: 500;
        text-align: left; white-space: nowrap; cursor: pointer;
        transition: color var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    /* 激活态 / 悬停**都只变色**（用户裁定的 C 档，与全仓「并排切换只变色」同口径）——
       一旦悬停铺底，「悬停」与「我在这一页」就会互相冒充。 */
    .rl-nav-wrap .rl-nav button:hover { color: var(--text-normal); }
    .rl-nav-wrap .rl-nav button.on { color: var(--interactive-accent); }
    .rl-nav-wrap .rl-nav button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    .rl-nav-label { overflow: hidden; text-overflow: ellipsis; }
</style>
