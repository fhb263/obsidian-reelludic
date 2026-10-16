<script lang="ts">
    // 「受控下拉」的自绘版（#566）：把原生下拉控件换成「按钮 + 浮层列表」。
    //
    // 🔴 为什么必须自绘：用户实测「媒体类型筛选栏『全部』下拉框……弹出列表没居中」——
    //    **Windows Chromium 的原生下拉 popup 不受页面 CSS 控制**：列表项的对齐声明
    //    在闭合框上有效，但**弹出列表是 UA 自绘的原生层**，写了也无效
    //    （#565② 的修法在 Windows 实机上落空；
    //    此前仿真页量的是 DOM 计算样式，量不到真 popup ⇒ 假绿，本批换真实修法）。
    //
    // 🔴 受控口径不变（#547）：值由父组件唯一持有，本组件只「显示 + 报告选了哪项」——
    //    `value` 进、`onPick(v)` 出；⛔ 不用 `bind:value`（会与受控回推抢同一个值，
    //    与 #550 那条「不用 bind:value」同一理由）。
    //
    // ⚠️ MediaList 是**单实例复用**组件（易复发点 ⑴）：切页签时 `options` 会整组换掉，
    //    若「展开中」且当前值不在新列表里 ⇒ **自动收起**兜底（否则浮层悬在不属于它的工具栏上）。
    import { onDestroy } from 'svelte';

    /** 当前值（父组件唯一真源） */
    export let value: string;
    /** 选项表（含 label；合并视图 / 状态 / 排序三处各自拼装） */
    export let options: readonly { value: string; label: string }[];
    /** 读屏名（原 select 的 aria-label 原样搬过来） */
    export let ariaLabel: string;
    /**
     * 闭合框右侧那枚「可展开」箭头。
     * 🔴 #572（用户实测截图「排序筛选怎么**多了个向下箭头重叠了**」）：**值本身已经带方向箭头**的下拉
     *   （排序：`最近更新 ↑` / `最近更新 ↓`）传 `false` —— 否则闭合框里就是「↑ + ▾」两枚箭头叠在一起。
     *   ⛔ 状态 / 媒体类型那两处**必须保留**（它们的值没有方向字符，删了就完全看不出能展开）。
     */
    export let chevron: boolean = true;
    /** 选中回调（父组件据此回推宿主真源） */
    export let onPick: (v: string) => void = () => {};

    let open = false;
    let onDown: ((ev: MouseEvent) => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;

    $: current = options.find((o) => o.value === value);
    // 🔴 单实例复用兜底：展开中 options 被换、当前值不在新列表 ⇒ 立即收起（⛔ 别留着僵尸浮层）
    $: if (open && !current) open = false;

    function unbind() {
        if (onDown) { window.removeEventListener('mousedown', onDown); onDown = null; }
        if (onKey) { window.removeEventListener('keydown', onKey); onKey = null; }
    }
    function close() {
        unbind();
        open = false;
    }
    /**
     * 开 / 关。⭐ 窗口监听绑在 click 之后的下一轮（监听 `mousedown`）—— 与 `MergedPageMenu` /
     * `MediaList` 题材面板同一条纪律：本轮的 mousedown 早已派发完毕，否则「刚打开就被自己的外点击关掉」。
     */
    function toggle() {
        if (open) {
            close();
            return;
        }
        open = true;
        onDown = (ev: MouseEvent) => {
            const el = ev.target as HTMLElement | null;
            if (el?.closest('.rl-sel-pop') || el?.closest('.rl-sel-btn')) return;
            close();
        };
        onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') close(); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
    }
    function pick(v: string) {
        onPick(v);
        close();
    }
    /** 打开时把焦点放到当前选中项（键盘可达：Tab 进入浮层即落在「现在这项」上） */
    function focusIfCurrent(node: HTMLElement, isCurrent: boolean) {
        if (isCurrent) node.focus();
    }
    /** 浮层内 ↑/↓ 在选项间移动焦点（Enter 由 option 按钮原生触发） */
    function onPopKey(ev: KeyboardEvent) {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        ev.preventDefault();
        const opts = Array.from((ev.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.rl-sel-opt'));
        const i = opts.indexOf(document.activeElement as HTMLElement);
        const next = ev.key === 'ArrowDown'
            ? opts[Math.min(opts.length - 1, i + 1)] ?? opts[0]
            : opts[Math.max(0, i - 1)] ?? opts[opts.length - 1];
        next?.focus();
    }
    onDestroy(unbind);
</script>

<div class="rl-sel-wrap" class:is-open={open}>
    <button
        class="rl-sel-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        on:click={toggle}>
        <!-- 🔴 闭合框文字**水平垂直居中**：flex 居中（核心 `button{justify-content:center}` 反而帮了忙，
             但⛔ 不能依赖它 —— 我们显式写，特异性输了才去用别人的）。 -->
        <span class="rl-sel-cur">{current ? current.label : ''}</span>
        <!-- 🔴 #590：箭头**与「题材」那枚同款** —— 统一成小倒三角文本 `▾`（原来是 lucide
             `chevron-down` 图标：细线条，与题材的实心三角并排就是两种东西，用户点名统一）。 -->
        {#if chevron}
            <span class="rl-sel-chev" aria-hidden="true">▾</span>
        {/if}
    </button>
    {#if open}
        <div class="rl-sel-pop" role="listbox" tabindex="-1" aria-label={ariaLabel} on:keydown={onPopKey}>
            {#each options as o (o.value)}
                <button
                    class="rl-sel-opt"
                    class:on={o.value === value}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    use:focusIfCurrent={o.value === value}
                    on:click={() => pick(o.value)}>
                    {o.label}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .rl-sel-wrap { position: relative; display: inline-flex; }
    /* 闭合按钮：与原 `.rl-sort-select` **同款盒模型**（同字号 / 同边框 / 同圆角 / 同内距 / 同核心定高），
       拍平核心 button 的灰底走 background-primary（与 select 的核心底色一致）。
       ⚠️ 选择器两级（压过核心 `button:not(.clickable-icon)` 的 (0,1,1)）。 */
    .rl-sel-wrap .rl-sel-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        height: var(--input-height); padding: 2px 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); box-shadow: var(--input-shadow);
        color: var(--text-normal); font-family: inherit; font-size: 12px; cursor: pointer;
        transition: color var(--rl-t-dur, .18s) var(--rl-t-ease, ease);
    }
    /* 🔴 #590：悬停 = **文字 + 箭头一起变主题色**（用户：「文字+倒三角统一加上 Hover 变色效果」）——
       ⛔ 仍不铺底色（本仓「并排控件只变色」口径）。箭头那枚 `.rl-sel-chev` 自己写着 `--text-muted`
       （见下，那条被断言钉着）⇒ 悬停必须**单独再指一次**它，否则它不跟随按钮变色。 */
    .rl-sel-wrap .rl-sel-btn:hover { color: var(--interactive-accent); }
    .rl-sel-wrap .rl-sel-btn:hover .rl-sel-chev { color: var(--interactive-accent); }
    /* 🔴 #594：**下拉打开时保持高亮**（用户：「鼠标悬停保持高亮，下拉时也保持高亮，取消悬停恢复正常，
       取消下拉恢复正常」）—— 面板一开、鼠标移进面板，闭合框就丢了 `:hover` ⇒ 高亮一闪即灭。
       这条与悬停档**逐字同款**（⛔ 不引入底色：用户选了「沿用现在的主题色悬停样式」）。
       ⚠️ 宿主侧的题材下拉有同款一条（`.rl-genre-wrap.is-open`）—— 同一条口径的两半。 */
    .rl-sel-wrap.is-open .rl-sel-btn { color: var(--interactive-accent); }
    .rl-sel-wrap.is-open .rl-sel-btn .rl-sel-chev { color: var(--interactive-accent); }
    .rl-sel-wrap .rl-sel-btn:focus-visible { outline: none; border-color: var(--interactive-accent); }
    /* 🔴🔴 #572（用户实测截图：「排序筛选怎么**多了个向下箭头重叠了**」）：闭合框里是
       「值 + 箭头」**整组居中** —— 箭头是 flex 的**普通孩子**，参与布局、由 `gap` 与值隔开。
       ⛔ ⛔ 别再把箭头改回 `position: absolute; right: 8px`（脱流）：那样按钮宽 = 文字宽 + 左右各 8px
       内距 ⇒ 值的右端**恰好落在箭头所在的 8px 处**，必然压住 12px（本次就是这么撞的）。
       ⚠️ 也别给值加 `margin: 0 auto`（那会把它按「排除箭头后的剩余空间」居中 ⇒ 与箭头贴死）。 */
    .rl-sel-cur { line-height: 1.4; white-space: nowrap; }
    .rl-sel-chev { display: inline-flex; align-items: center; color: var(--text-muted); }
    /* 🔴 #590：小倒三角的**字号/透明度**与题材那枚 `.rl-genre-caret` 逐字同款（同一枚语汇）。 */
    .rl-sel-wrap .rl-sel-chev { font-size: 9px; opacity: .7; }
    /* 浮层：贴按钮下沿 4px、与按钮左缘对齐、**至少与按钮同宽**（选项比按钮长也不破版）。
       🔴 z-index 必须显式给：海报墙卡片 relative 且 DOM 排在工具栏之后（#327 / #553 同一条账）；
       取 30 —— 高于卡片，低于右键菜单族（`.rl-ctx` 50 / `.rl-ctx-anchor` 100）。 */
    .rl-sel-pop {
        position: absolute; left: 0; top: calc(100% + 4px); z-index: 30;
        min-width: 100%; max-height: 260px; overflow: auto; padding: 4px;
        display: flex; flex-direction: column;
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px);
    }
    /* 🔴 #566（用户：「弹出列表没居中」）：**列表项逐条 `text-align: center`** ——
       原生 select 的 popup 在 Windows 上不受 CSS 控制（这正是换自绘的原因），
       自绘之后每一项都是普通 button，居中终于真的可控。 */
    .rl-sel-wrap .rl-sel-opt {
        display: block; width: 100%; height: auto; padding: 4px 10px;
        border: none; background: transparent; box-shadow: none;
        color: var(--text-normal); font-family: inherit; font-size: 12px;
        text-align: center; white-space: nowrap;
        border-radius: var(--rl-t-radius-sm, 4px); cursor: pointer;
    }
    .rl-sel-wrap .rl-sel-opt:hover { color: var(--interactive-accent); }
    /* 当前选中项**只变色**（全仓「并排的切换类只变色」口径，⛔ 不铺底）。 */
    .rl-sel-wrap .rl-sel-opt.on { color: var(--interactive-accent); font-weight: 600; }
    .rl-sel-wrap .rl-sel-opt:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
</style>
