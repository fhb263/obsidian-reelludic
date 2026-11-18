<script lang="ts">
    /**
     * 条目卡右键菜单 —— **全仓唯一真源**（2026-11-26 从 `MediaList.svelte` 抽出）。
     *
     * 🔴 用户 2026-11-26 逐字：「合集卡内的卡片应该也和主视图交互操作一致才对而不是
     *    另做个右上角编辑属性图标」
     *    ⇒ 一致性**不能靠两份代码长得像**：合集视图里那张卡片右键必须弹出与海报墙
     *      **同一个组件**渲染的同一套菜单项。所以有了这个文件。
     *    ⛔ 别在 `CollectionBoard` 里再写一份菜单，也⛔ 别在 `MediaList` 里留第二份 ——
     *      两份菜单一定会漂移（这正是这条需求被提出来的原因）。
     *
     * 菜单项语义（原样搬运，逐条口径见 `MediaList` 里 #599 / #685 / 2026-10-21 的注释）：
     *   ① 主操作（观看 / 阅读 / 启动 / 播放）+ 常驻「关联入口」
     *   ② 编辑属性 + 按类型分叉的补录（摘抄 / 短评 / 攻略 / 重温 / 周目 / 时长）
     *   ③ 删除条目（危险色）
     *   ⚠️ 分割线是**内容层级**，⛔ 别用 `:nth-child` 钉死（各类型菜单项数不同）。
     *
     * 定位：锚点 + `absolute`（⛔ 不用 `position: fixed`）—— Obsidian 视图有 transform 祖先，
     *   `fixed` 会被整体偏移。坐标由 `pure/menuPlacement.placeMenu` 在**视口坐标**里算好
     *   （贴鼠标 → 越界翻转 → 仍越界钳制 → 超高封顶），再减去锚点左上角换算回锚点相对坐标。
     *
     * 用法（命令式，因为要拿 MouseEvent 定位）：
     *   `<EntryContextMenu bind:this={ctxMenu} bind:open={ctxOpen} {onWatch} … />`
     *   `ctxMenu?.open(entry, ev)` / `ctxMenu?.close()`
     *   ⚠️ 宿主必须 `bind:open` 到自己的状态上，并在更内层的 Esc 判断里读它 ——
     *     否则「关掉菜单」会顺手把系列视图也退出（本仓 #444 踩过）。
     */
    import { tick } from 'svelte';
    import type { EntryLogKind, EntryTextKind, MediaEntry } from 'data/types';
    import {
        actionMenuTitle,
        actionReadyHint,
        actionUnavailableHint,
        associateMenuLabel,
        hasActionEntry,
        hasLocalEntry,
    } from 'pure/actionLabel';
    import { normalizeBookKind } from 'pure/bookKind';
    import { placeMenu } from 'pure/menuPlacement';
    import type { EntryMenuHideKey } from 'pure/entryMenu';

    /** 主操作（入口可用时真的执行；不可用时由本组件转去 `onQuickAssociate`） */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /** 关联入口弹窗（常驻那条） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    /** 编辑属性 */
    export let onEditEntry: (id: string) => void = () => {};
    /** 添加摘抄（文学 / 网文） */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** 记录类弹窗（重温 / 周目 / 时长） */
    export let onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => void = () => {};
    /** 文本类弹窗（短评 / 攻略） */
    export let onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => void = () => {};
    /** 删除条目（确认在宿主的 `plugin.deleteEntry` 里，⛔ 别在组件内 `window.confirm`） */
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};

    /**
     * 要**隐藏**的菜单项（视图按场景取舍；⛔ 不传 = 全显示，与海报墙完全一致）。
     *
     * 🔴 用户 2026-11-08：「播放器详情页的简介封面右键菜单不要显示观看、删除条目项」。
     *    ⇒ 同一个组件在不同场景下允许少几项，但**菜单本体仍然只有这一份**。
     *    ⛔ 别为此再写一个「详情页专用菜单」—— 那就是本文件头注释里点名的两份漂移。
     * ⚠️ 被隐藏的项不只是 `{#if}` 掉按钮：**分割线也要跟着收**，否则会出现
     *    「一条线下面是空的」这种残骸（见模板里的 `showEntry` / `showEdit` / `showDanger` 三个判据）。
     */
    export let hideItems: readonly EntryMenuHideKey[] = [];

    /** 该菜单项是否被本场景隐藏 */
    function hidden(key: EntryMenuHideKey): boolean {
        return hideItems.includes(key);
    }

    /**
     * 是否有菜单挂着（`bind:open` 给宿主读）。
     * ⚠️ 它同时是本组件模板的唯一开关 —— 别另立一个内部 `if`。
     */
    export let open = false;

    let current: MediaEntry | null = null;
    let anchorEl: HTMLElement | null = null;
    let menuEl: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    let maxH: number | undefined;
    let maxW: number | undefined;
    let onDown: (() => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;

    function unbindWindow(): void {
        if (onDown) { window.removeEventListener('mousedown', onDown); onDown = null; }
        if (onKey) { window.removeEventListener('keydown', onKey); onKey = null; }
    }

    export function close(): void {
        unbindWindow();
        open = false;
        current = null;
    }

    /**
     * 打开菜单并把落点算好。
     * 🔴 必须 `preventDefault()`：卡片上还能有别的右键处理（系列折叠卡整卡挂着 `on:click`），
     *    不挡掉会连带触发浏览器原生菜单。
     */
    export async function openAt(entry: MediaEntry, ev: MouseEvent): Promise<void> {
        ev.preventDefault();
        ev.stopPropagation();
        unbindWindow();
        x = 0;
        y = 0;
        maxH = undefined;
        maxW = undefined;
        current = entry;
        open = true;
        await tick(); // 等 anchor 与菜单渲染出来才量得到尺寸
        const anchor = anchorEl;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const m = menuEl?.getBoundingClientRect();
        const p = placeMenu({
            x: ev.clientX,
            y: ev.clientY,
            menuW: m?.width ?? 0,
            menuH: m?.height ?? 0,
            vw: window.innerWidth,
            vh: window.innerHeight,
            // 🔴 可用区 = **锚点（内容区）左右界** ∩ 视口。不传的话 placeMenu 只按视口钳制，
            //    翻转/钳制会把菜单压到视口最左（6px），换算成锚点相对坐标是负值 ⇒ 被左侧栏盖住。
            minX: a.left,
            maxX: a.right,
        });
        maxW = p.maxWidth;
        maxH = p.maxHeight;
        x = p.left - a.left;
        y = p.top - a.top;
        onDown = () => close();
        onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
    }

    /** 主操作：入口可用就真的执行；不可用则直达快捷关联弹窗（⛔ 不再先开编辑表单） */
    function primary(e: MediaEntry): void {
        close();
        if (hasActionEntry(e)) onWatch(e);
        else onQuickAssociate(e);
    }

    /**
     * 主操作 title：可用=实际动作描述；不可用=去关联提示。
     * 🔴 可用时的文案随「有没有**本地**入口」分叉 —— 只有网络地址却写「打开书籍文件」是在骗人。
     *    ⛔ 门控仍一律走 `hasActionEntry`（`hasLocalEntry` **只**决定文案，不当门控）。
     */
    function primaryHint(e: MediaEntry): string {
        return hasActionEntry(e) ? actionReadyHint(e.type, hasLocalEntry(e)) : actionUnavailableHint(e.type);
    }

    async function remove(e: MediaEntry): Promise<void> {
        close();
        await onDeleteEntry(e.id);
    }

    /** 短评：电影 / 剧集 / 动画 / 音乐 + 漫画（漫画不算「摘抄」，走短评） */
    function canComment(e: MediaEntry): boolean {
        return e.type === 'movie' || e.type === 'tv' || e.type === 'anime' || e.type === 'music'
            || (e.type === 'book' && normalizeBookKind(e.bookKind) === 'comic');
    }
    /** 摘抄：文学 / 网文（⛔ 漫画不算） */
    function canExcerpt(e: MediaEntry): boolean {
        return e.type === 'book' && normalizeBookKind(e.bookKind) !== 'comic';
    }
    /** 重温记录：电影 / 剧集 / 动画 */
    function canRewatch(e: MediaEntry): boolean {
        return e.type === 'movie' || e.type === 'tv' || e.type === 'anime';
    }
    /** 记一次时长：书 / 音乐 / 游戏 */
    function canTime(e: MediaEntry): boolean {
        return e.type === 'book' || e.type === 'music' || e.type === 'game';
    }
</script>

<!-- 锚点：菜单 absolute 挂在它上面（在流末尾、不给高度 ⇒ 不占版面） -->
<div class="rl-ctx-anchor" bind:this={anchorEl}>
    {#if open && current}
        {@const e = current}
        <!-- 🔴 三组内容各算一次「这组还有没有项」：分割线是**内容层级**，某组被场景隐藏后
             那条线就成了「一条线下面是空的」残骸 ⇒ 线也必须跟着收（别用 :nth-child 钉）。 -->
        {@const sec1 = !hidden('watch') || !hidden('associate')}
        {@const sec2 = !hidden('edit')
            || (!hidden('excerpt') && canExcerpt(e))
            || (!hidden('comment') && canComment(e))
            || (!hidden('guide') && e.type === 'game')
            || (!hidden('rewatch') && canRewatch(e))
            || (!hidden('playthrough') && e.type === 'game')
            || (!hidden('time') && canTime(e))}
        {@const sec3 = !hidden('delete')}
        <!-- ⚠️ 容器上的三个事件处理器只做 `stopPropagation` / `preventDefault`（拦截冒泡到卡片与浏览器
             原生菜单），容器本身**不是**可交互控件 ⇒ svelte-check 会报两条 a11y 警告。
             那会打破「89 warnings = 基线」这条门禁（⛔ 不是省事，是守住基线）；
             先例见 `EntryForm.svelte:5471` 的同类写法。 -->
        <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
        <div
            class="rl-ctx"
            bind:this={menuEl}
            style={`left:${x}px;top:${y}px${maxH !== undefined ? `;max-height:${maxH}px` : ''}${maxW !== undefined ? `;max-width:${maxW}px` : ''}`}
            on:click={(ev) => ev.stopPropagation()}
            on:mousedown={(ev) => ev.stopPropagation()}
            on:contextmenu={(ev) => ev.preventDefault()}>
            <!-- ① 入口本身：主操作 + 常驻「关联入口」 -->
            {#if !hidden('watch')}
                <button on:click={() => primary(e)} data-tip={primaryHint(e)}>{actionMenuTitle(e)}</button>
            {/if}
            {#if !hidden('associate')}
                <button on:click={() => { close(); onQuickAssociate(e); }} data-tip="选择本地文件 / 网络地址（随时可改）">{associateMenuLabel(e.type)}</button>
            {/if}
            {#if sec1}<div class="rl-ctx-sep"></div>{/if}
            <!-- ② 改属性 + 按类型补录 -->
            {#if !hidden('edit')}
                <button on:click={() => { close(); onEditEntry(e.id); }} data-tip="编辑字段与关联">编辑属性</button>
            {/if}
            {#if !hidden('excerpt') && canExcerpt(e)}
                <button on:click={() => { close(); onAddExcerpt(e); }} data-tip="粘贴文本生成摘抄">添加摘抄</button>
            {/if}
            {#if !hidden('comment') && canComment(e)}
                <button on:click={() => { close(); onOpenEntryTextModal(e, 'comment'); }} data-tip="写一句短评 → 写入笔记独立的「短评」章节">添加短评</button>
            {/if}
            {#if !hidden('guide') && e.type === 'game'}
                <button on:click={() => { close(); onOpenEntryTextModal(e, 'guide'); }} data-tip="写下攻略 → 写入笔记「攻略」章节">添加攻略</button>
            {/if}
            {#if !hidden('rewatch') && canRewatch(e)}
                <button on:click={() => { close(); onOpenEntryLogModal(e, 'rewatch'); }} data-tip="第几次重刷 + 感想 → 写入笔记「重温记录」">记录重温</button>
            {/if}
            {#if !hidden('playthrough') && e.type === 'game'}
                <button on:click={() => { close(); onOpenEntryLogModal(e, 'playthrough'); }} data-tip="第几周目 + 感想 → 写入笔记「周目记录」">记录周目</button>
            {/if}
            {#if !hidden('time') && canTime(e)}
                <button on:click={() => { close(); onOpenEntryLogModal(e, 'time'); }} data-tip="记一次时长 → 写入笔记「阅读 / 收听 / 游玩记录」章节">记录时长</button>
            {/if}
            {#if sec2 && sec3}<div class="rl-ctx-sep"></div>{/if}
            <!-- ③ 删除 -->
            {#if !hidden('delete')}
                <button class="rl-ctx-danger" on:click={() => void remove(e)} data-tip="删除条目">删除条目</button>
            {/if}
        </div>
    {/if}
</div>

<style>
    .rl-ctx-anchor { position: relative; z-index: 50; isolation: isolate; }
    .rl-ctx {
        position: absolute; z-index: 100; min-width: 140px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu-strong, 0 4px 14px rgba(0, 0, 0, .18)); padding: 4px;
        /* 视口过矮/过窄时内联 max-height/max-width 生效 → 菜单内部滚动，不整块越界 */
        overflow: auto; overscroll-behavior: contain;
    }
    /* 🔴 每个菜单项**没有独立边框**（用户 2026-10-21 点名）。那圈「边框」不是 `border`，
       是核心给裸 `button` 的 `box-shadow: var(--input-shadow)` 内描边环 ⇒ 必须显式清掉。
       ⚠️ 本块是 Svelte 作用域样式，落地为 `.rl-ctx button.svelte-xxx`（0,2,1）⇒ 稳赢核心 (0,1,1)，
          ⛔ 不用 `!important`。 */
    .rl-ctx button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 6px 10px; border: none; box-shadow: none; background: transparent; color: var(--text-normal); border-radius: var(--rl-t-radius-md, 6px); cursor: pointer; font-family: inherit; }
    .rl-ctx-sep { height: 1px; margin: 4px 0; background: var(--background-modifier-border); }
    .rl-ctx button:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-ctx .rl-ctx-danger { color: var(--rl-danger-strong); }
    .rl-ctx .rl-ctx-danger:hover { background: var(--rl-danger-strong); color: #fff; }
</style>
