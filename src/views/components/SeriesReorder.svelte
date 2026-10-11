<script lang="ts">
    // 系列「排序号」弹窗的**内容组件**（#609）。
    //
    // 🔴 起因（用户原话）：「右键菜单点击排序号给用户弹窗批量勾选排序手动排，**不是自动排**」——
    //    翻面 #608 那条「点一下整组按当前顺序自动重排」：改成**打开这个弹窗、自己拖着排**。
    //
    // 🔴 口径（问答裁定）：
    //    · **拖拽排序**（不是上下箭头、也不是填序号数字）；
    //    · **没有勾选框** —— 拖完直接按列表顺序编号 1..N（「按拖动列表自动更替序号排」）。
    //
    // ⚠️ 本组件**只画内容**（标题 + 列表 + 两枚按钮）—— 弹窗外壳 / 遮罩 / Esc / 点外面关闭全由
    //    `modals/SeriesReorderModal`（宿主 `Modal`）提供，⛔ 别在这里写 `position: fixed` 或自造遮罩。
    // ⚠️ 排序算法在纯模块 `pure/seriesGroup.moveItem`（可单测），本组件只管「取下标 → 调它 → 换 order」。
    import { moveItem } from 'pure/seriesGroup';

    /** 一行要显示的东西（封面由宿主解析好传进来 —— 组件不碰 `plugin.resolvePoster`） */
    type ReorderItem = { id: string; title: string; sub?: string; poster?: string };

    export let title = '';
    export let items: ReorderItem[] = [];
    /** 确认：回传**新顺序的 id 列表**（编号由宿主算 —— `planSeriesReindexAll`） */
    export let onConfirm: (ids: string[]) => void = () => {};
    export let onCancel: () => void = () => {};

    /** 当前顺序（拖拽唯一的可变状态）。⚠️ 整体换新数组 ⇒ Svelte 才看得见（本仓 `openGroupKeys` 同款纪律） */
    let order: string[] = items.map((i) => i.id);
    /** 正在拖的那条 / 落点那条（都按 id 记，⛔ 不按下标 —— 拖动过程中下标会变） */
    let dragId: string | null = null;
    let overId: string | null = null;

    $: byId = new Map(items.map((i) => [i.id, i]));
    /** 渲染行 = 按 `order` 取回对象（查不到的自动跳过：组一变就自然消失，不残留脏行） */
    $: rows = order.map((id) => byId.get(id)).filter((x): x is ReorderItem => !!x);

    function onDragStart(ev: DragEvent, id: string): void {
        dragId = id;
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            // 某些环境不发 dataTransfer 就**不认**这是一次拖拽（值本身没人读，给个占位）
            ev.dataTransfer.setData('text/plain', id);
        }
    }
    function onDragOver(ev: DragEvent, id: string): void {
        if (!dragId) return;
        ev.preventDefault(); // ⛔ 不 preventDefault 就不会触发 drop
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        overId = id;
    }
    function onDrop(ev: DragEvent, id: string): void {
        ev.preventDefault();
        commit(id);
    }
    function onDragEnd(): void {
        dragId = null;
        overId = null;
    }
    /** 把**正在拖的那条**落到 `targetId` 的位置（算法在 `moveItem`：搬走 + 插入，其余保序） */
    function commit(targetId: string): void {
        if (!dragId) return;
        order = moveItem(order, order.indexOf(dragId), order.indexOf(targetId));
        dragId = null;
        overId = null;
    }
    /**
     * 键盘等价物：聚焦某行时 `↑` / `↓` 把它上移 / 下移一格。
     * 🔴 为什么必须有：拖拽是**纯指针**操作，键盘用户与读屏用户否则完全够不着这个弹窗；
     *    ⛔ 但**不加**可见的上下箭头按钮 —— 用户点名要「拖动排序」这一种形态。
     */
    function onKeydown(ev: KeyboardEvent, id: string): void {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const i = order.indexOf(id);
        const to = ev.key === 'ArrowUp' ? i - 1 : i + 1;
        if (i < 0 || to < 0 || to >= order.length) return;
        order = moveItem(order, i, to);
        // 换完把焦点还给**同一行**（否则焦点会跟着 DOM 顺序跳到别处，连按就乱了）
        queueMicrotask(() => {
            const el = document.querySelector(`.rl-sro-row[data-id="${id}"]`);
            if (el instanceof HTMLElement) el.focus();
        });
    }
</script>

<h2 class="rl-sro-title">{title}</h2>
<div class="rl-sro-hint">拖动左侧把手调整顺序；确定后按这个顺序重编 1、2、3…</div>
<!-- 🔴 `role="listbox"` + 每行 `role="option"`：**可聚焦、可键盘操作**的列表语义
     （⛔ 别用 `role="list"` / `role="listitem"` —— 那是**非交互**语义，配 `tabindex="0"` 会触发
      Svelte 的两条 a11y 告警，直接顶破 89 条基线）。 -->
<div class="rl-sro-list" role="listbox" aria-label={title || '排序'}>
    {#each rows as r, i (r.id)}
        <div
            class="rl-sro-row"
            class:is-dragging={dragId === r.id}
            class:is-dropBefore={!!dragId && overId === r.id && dragId !== r.id}
            data-id={r.id}
            role="option"
            aria-selected="false"
            tabindex="0"
            draggable="true"
            data-tip="拖动排序（键盘：↑ / ↓）"
            on:dragstart={(ev) => onDragStart(ev, r.id)}
            on:dragover={(ev) => onDragOver(ev, r.id)}
            on:drop={(ev) => onDrop(ev, r.id)}
            on:dragend={onDragEnd}
            on:keydown={(ev) => onKeydown(ev, r.id)}>
            <span class="rl-sro-handle" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    ><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" /></svg>
            </span>
            {#if r.poster}
                <img class="rl-sro-cov" alt="" src={r.poster} loading="lazy" />
            {:else}
                <span class="rl-sro-cov rl-sro-cov-ph"></span>
            {/if}
            <span class="rl-sro-txt">
                <span class="rl-sro-name">{r.title}</span>
                {#if r.sub}<span class="rl-sro-sub">{r.sub}</span>{/if}
            </span>
            <span class="rl-sro-idx">{i + 1}</span>
        </div>
    {/each}
</div>
<div class="rl-sro-actions">
    <button class="rl-sro-btn" on:click={onCancel}>取消</button>
    <button class="rl-sro-btn mod-cta" on:click={() => onConfirm(order)}>确定</button>
</div>

<style>
    /* 🔴 本组件挂在宿主 `Modal` 里（DOM-API 弹窗）—— 但它是 **Svelte 组件** ⇒ scoped 样式**照常生效**
       （与 `SeriesPicker.svelte` 同款）。⛔ 别把这些搬到 `styles.css` 去做「全局兜底」：
       那会与 scoped 那份形成两份真源（同一件事两处写 = 迟早漂）。 */
    .rl-sro-title {
        margin: 0 0 4px;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-normal);
    }
    .rl-sro-hint {
        font-size: 11.5px;
        color: var(--text-muted);
        margin-bottom: 10px;
    }
    .rl-sro-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 320px;
        overflow-y: auto;
    }
    .rl-sro-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: var(--background-primary);
        cursor: default;
    }
    .rl-sro-row:hover { background: var(--background-modifier-hover); }
    .rl-sro-row:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    /* 🔴 拖动把手：`cursor: grab` 是唯一的「这行能拖」提示（⛔ 不再叠一枚图标按钮） */
    .rl-sro-handle {
        flex: none;
        display: inline-flex;
        color: var(--text-faint);
        cursor: grab;
    }
    .rl-sro-cov {
        flex: none;
        width: 32px;
        height: 44px;
        border-radius: 4px;
        object-fit: cover;
        background: var(--background-modifier-hover);
    }
    .rl-sro-txt {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .rl-sro-name {
        font-size: 13px;
        color: var(--text-normal);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rl-sro-sub { font-size: 11px; color: var(--text-faint); }
    /* 序号徽标：**显示当下这个位置**（拖完跟着变），不是条目原序号 */
    .rl-sro-idx {
        flex: none;
        min-width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        background: var(--background-modifier-hover);
        font-variant-numeric: tabular-nums;
    }
    /* 拖动中：被拖那行浮起半透明（观感取自象形稿 `_shot/sr609.html` 的 B 帧） */
    .rl-sro-row.is-dragging { opacity: .45; background: var(--background-modifier-hover); }
    /* 落点：上方一条强调色插入线（比整行高亮更准 —— 用户能看清是「插到它前面」） */
    .rl-sro-row.is-dropBefore { box-shadow: inset 0 2px 0 0 var(--interactive-accent); }
    .rl-sro-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 12px;
    }
    /* 两枚按钮都是**两级选择器**：单类 (0,1,0) 压不过核心 `button:not(.clickable-icon)` 的 (0,1,1) 灰底 */
    .rl-sro-actions .rl-sro-btn {
        font-family: inherit;
        font-size: 12.5px;
        padding: 4px 14px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
    }
    .rl-sro-actions .rl-sro-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-sro-actions .rl-sro-btn.mod-cta {
        background: var(--interactive-accent);
        border-color: var(--interactive-accent);
        color: var(--text-on-accent);
        font-weight: 600;
    }
</style>
