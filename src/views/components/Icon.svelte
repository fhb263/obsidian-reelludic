<script lang="ts">
    // 通用纯色图标：Obsidian 内建 Lucide 风格图标（setIcon 渲染，随主题变色）
    // 用法：<Icon icon="plus" size={14} cls="rl-xxx" />
    import { onMount } from 'svelte';
    import { setIcon } from 'obsidian';

    export let icon: string;
    export let size = 14;
    export let cls = '';
    let el: HTMLSpanElement | null = null;

    onMount(() => {
        if (el) {
            try {
                setIcon(el, icon);
            } catch {
                // 图标名在当前 Obsidian lucide 集不存在：保持空 span，不抛错破坏宿主布局
            }
        }
    });
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
