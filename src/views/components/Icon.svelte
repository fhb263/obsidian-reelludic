<script lang="ts">
    // 通用纯色图标：Obsidian 内建 Lucide 风格图标（setIcon 渲染，随主题变色）
    // 用法：<Icon icon="plus" size={14} cls="rl-xxx" />
    //
    // 🔴🔴 #599：原先只在 `onMount` 里 `setIcon` **一次** ⇒ **`icon` 变了不重画**。
    //    症状：视图下拉的闭合框（`<Icon icon={currentView.icon} />`）**永远停在初始那一枚**
    //    —— 切到列表/瀑布流/时间线后名字跟着换了、图标还是「海报墙」那枚
    //    （下拉里每项都是新挂载的组件，所以那边看着是对的，只有闭合框这一处露馅）。
    //    ⇒ 改成按 `(el, icon)` 重画：`el` 由 `bind:this` 在挂载时赋值 ⇒ 首帧与后续变更都会跑到。
    //    ⛔ 别再退回「只在 onMount 画一次」；⚠️ `setIcon` 是**整体替换**子节点，重复画是幂等的。
    import { setIcon } from 'obsidian';

    export let icon: string;
    export let size = 14;
    export let cls = '';
    let el: HTMLSpanElement | null = null;

    /** 画一次（图标名在当前 Obsidian lucide 集不存在时保持空 span，⛔ 不抛错破坏宿主布局） */
    function paint(target: HTMLElement, name: string): void {
        try {
            setIcon(target, name);
        } catch {
            /* 静默：未知图标名 */
        }
    }
    // 依赖是 `el` 与 `icon` 两个值本体（⛔ 别把读取藏进函数体再喂反应式 —— Svelte 4 不穿透函数体）
    $: if (el && icon) paint(el, icon);
</script>

<span class="rl-icon {cls}" style={`width:${size}px;height:${size}px;`} bind:this={el} aria-hidden="true"></span>

<style>
    .rl-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        vertical-align: -2px;
    }
    .rl-icon :global(svg) {
        width: 100%;
        height: 100%;
        stroke-width: 2;
    }
</style>
