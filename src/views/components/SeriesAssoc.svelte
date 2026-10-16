<script lang="ts">
    // 系列「批量关联」弹窗的**内容组件**（#629）。
    //
    // 🔴 用户口径：「新增系列卡片右键菜单-批量关联按钮」→ 问答裁定 = **逐条清单**：
    //    把这一系列的条目列出来，逐行显示「关联到哪了」+ 一枚「关联入口」；
    //    点行开出**既有的**那条单条关联弹窗（`QuickAssociateModal`），改完自动保存、回来清单自己刷新。
    //    ⛔ 本组件**绝不自己画关联表单** —— 那必然与单条入口那套（自动保存 / 就地提示 / B站检索 /
    //       单集本地检索…）分叉，用户在两个入口之间来回切时会把两套认成两个功能（#446 的老教训）。
    //
    // ⚠️ 本组件**只画内容**（标题 + 读数 + 清单 + 关闭）—— 弹窗外壳 / 遮罩 / Esc / 点外面关闭全由
    //    `modals/SeriesAssociateModal`（宿主 `Modal`）提供，⛔ 别在这里写 `position: fixed` 或自造遮罩。
    // ⚠️ 文案真源：按钮上那三个字取 `pure/actionLabel.associateMenuLabel`（与右键菜单那条常驻入口
    //    **同一份**），⛔ 别在这里手写第二份（本仓「同一概念只准一份文案」）。
    import { seriesAssocStats, seriesAssocHeadline, type SeriesAssocRow } from 'pure/seriesAssoc';
    import { associateMenuLabel } from 'pure/actionLabel';
    import type { EntryType, MediaEntry } from 'data/types';

    export let title = '';
    /** 组的类型（只用来取那三个字的按钮文案 —— 真源签名要求它） */
    export let groupType: EntryType = 'movie';
    /** 清单行（宿主投影后传进来：`pure/seriesAssoc.seriesAssocRows`） */
    export let rows: SeriesAssocRow[] = [];
    /**
     * 点某一行 ⇒ 开那一条的关联弹窗。
     * 🔴 回传**整条目**（不是 id）：宿主 `quickAssociateEntry(entry)` 要的是它；
     *    组件不持有 plugin，也不做「按 id 去查」这种只有宿主才知道怎么查的事。
     */
    export let onOpenRow: (entry: MediaEntry) => void = () => {};

    /** 行 id → 条目对象（宿主同时给了两份：投影行用于显示、条目用于回传） */
    export let entries: MediaEntry[] = [];

    $: stats = seriesAssocStats(rows);
    $: byId = new Map(entries.map((e) => [e.id, e]));

    function open(ev: MouseEvent, id: string): void {
        ev.stopPropagation();
        // 🔴 清掉鼠标点击留下的焦点环：关掉子弹窗回来时这行还亮着描边很扎眼（与卡片上那几枚同一处理）
        ev.currentTarget?.blur?.();
        const e = byId.get(id);
        if (e) onOpenRow(e);
    }
</script>

<div class="rl-sa">
    <div class="rl-sa-head">
        <div class="rl-sa-title">{title}</div>
        <div class="rl-sa-stat">{seriesAssocHeadline(stats)}</div>
    </div>
    <p class="rl-sa-hint">点任意一行打开它的{associateMenuLabel(groupType)}；改完自动保存，这里的状态会跟着变。</p>
    {#if rows.length === 0}
        <div class="rl-sa-empty">这一系列已经没有条目了</div>
    {:else}
        <ul class="rl-sa-list">
            {#each rows as r (r.id)}
                <li class="rl-sa-item">
                    <!-- 🔴 整行就是**一枚真 `<button>`**（不是「行 + 行内按钮」）：原生可聚焦、
                         键盘全免费、也不需要 `role`/`tabindex`；
                         ⛔ 别把「关联入口」做成行内的第二枚按钮（按钮套按钮 = 非法结构 + 两条 a11y 告警）。 -->
                    <button
                        class="rl-sa-row"
                        class:is-linked={r.linked}
                        on:click={(ev) => open(ev, r.id)}
                        data-tip={`打开「${r.title}」的${associateMenuLabel(groupType)}`}>
                        <span class="rl-sa-no">{r.index !== undefined ? r.index : '—'}</span>
                        <span class="rl-sa-name">{r.title}</span>
                        <span class="rl-sa-sum">{r.summary}</span>
                        <span class="rl-sa-chip">{associateMenuLabel(groupType)}</span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
    <!-- 🔴 #630：底部那枚「关闭」**整体删除**（用户：「批量关联入口底部的关闭按钮也给我去除了」）——
         关窗出口回来走**宿主**那三样：右上角关闭钮 / Esc / 点遮罩外（与快捷关联弹窗 #593 的处置同一条口径：
         插件不自绘第二枚关闭件）。 -->
</div>

<style>
    /* 本组件挂在宿主 `Modal` 里 ⇒ 作用域类照常生效（Svelte 在初始化时就把规则注进文档）。
       ⚠️ 三枚按钮都显式写「框四件」（`border` / `background` / `box-shadow` / `border-radius`）——
          核心 `button:not(.clickable-icon)`（(0,1,1)）会铺灰底加内描边环，⛔ 别指望 scoped 哈希替我们压住它。 */
    .rl-sa { display: flex; flex-direction: column; gap: 8px; }
    .rl-sa-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .rl-sa-title { font-size: 15px; font-weight: 600; color: var(--text-normal); min-width: 0; }
    .rl-sa-stat { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; flex: none; }
    .rl-sa-hint { margin: 0; font-size: 11.5px; color: var(--text-faint); }
    .rl-sa-empty { padding: 22px 0; text-align: center; font-size: 12.5px; color: var(--text-faint); }
    /* 清单：条目多的系列（十几部）靠这里滚，⛔ 别让弹窗自己长高（宿主 Modal 会顶到屏幕外） */
    .rl-sa-list {
        list-style: none; margin: 0; padding: 0;
        max-height: 52vh; overflow: auto; overscroll-behavior: contain;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-lg, 8px);
    }
    .rl-sa-item + .rl-sa-item { border-top: 1px solid var(--background-modifier-border); }
    .rl-sa-row {
        display: flex; align-items: center; gap: 10px; width: 100%;
        margin: 0; padding: 7px 10px; border: none; box-shadow: none; border-radius: 0;
        background: transparent; color: var(--text-normal);
        font-family: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
    }
    .rl-sa-row:hover { background: var(--background-modifier-hover); }
    .rl-sa-row:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    /* 序号：定宽 + 等宽数字 ⇒ 两位数也不会把标题推得参差不齐 */
    .rl-sa-no {
        flex: none; width: 26px; text-align: right;
        font-size: 11px; color: var(--text-faint); font-variant-numeric: tabular-nums;
    }
    .rl-sa-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 关联摘要：已关联的用正常色（它是**可执行**的那一类）、未关联的压淡一档 */
    .rl-sa-sum { flex: none; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
    .rl-sa-row:not(.is-linked) .rl-sa-sum { color: var(--text-faint); }
    /* 「关联入口」：与右键菜单那条常驻入口**同名**；做成不铺底的浅描边小块 —— 它是**行内提示**，
       不是第二枚按钮（点击热区仍归整行）⇒ 用 `span` + `pointer-events: none`，⛔ 别换成 `button`。 */
    .rl-sa-chip {
        flex: none; pointer-events: none;
        font-size: 11px; color: var(--text-muted);
        padding: 2px 8px; border-radius: var(--rl-t-radius-pill, 999px);
        border: 1px solid var(--background-modifier-border);
    }
    .rl-sa-row:hover .rl-sa-chip { color: var(--interactive-accent); border-color: var(--interactive-accent); }
</style>
