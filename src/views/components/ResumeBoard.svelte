<!--
  「继续观看 / 阅读」队列面板（用户 m07854 ⑪ ①）。

  用户原话：「首页页签计划页新增 tab「继续观看/阅读」队列（自动聚合所有状态为「在看」且
  `last_position` 不为空的媒体，按最近活跃时间排序，可切卡片/列表视图）」

  🔴 纪律（与 `TrackingBoard.svelte` / `CollectionBoard.svelte` 同一套）：
    · 组件**零 obsidian / 零网络 / 零 vault**：数据由 `pure/resumeQueue` 算好，回调由 `HomeView` 注入。
    · ⛔ 本组件不认识 `MediaEntry` 的字段口径 —— 「有没有可续的位置」只问 `resumeSpotOf`，
      别在这里再写一遍 `videoPositions` / `readingProgress` 的判定（那会变成第二份真源）。
    · 视图切换（卡片 / 列表）用本地 `viewMode`，两种视图吃到的是**同一份**队列。
-->
<script lang="ts">
    import { buildResumeQueue } from 'pure/resumeQueue';
    import { statusLabel } from 'pure/labels';
    import type { MediaEntry } from 'data/types';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    export let onOpenEntry: (id: string) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};

    /** 视图：卡片 / 列表（用户原话「可切卡片/列表视图」） */
    let viewMode: 'card' | 'list' = 'card';

    /**
     * 队列真源（`$:` 直接引用 `entries` 才会被 Svelte 追踪 —— 本仓 #10 那个坑的同一形态）。
     * ⚠️ `entries` 每次宿主重推都是新引用，所以这里必然重算，不需要额外的 version 计数。
     */
    $: queue = buildResumeQueue(entries);

    /** 列表视图的列宽：卡片视图靠 CSS grid 自适应，列表靠 table 的固定布局 */
    function posterOf(e: MediaEntry): string | undefined {
        return posterUrl(e);
    }
</script>

<div class="rl-resume">
    <div class="rl-rs-head">
        <span class="rl-rs-title">继续观看 / 阅读</span>
        <span class="rl-rs-cnt">{queue.length} 条待续</span>
        <span class="rl-rs-hint">只看「在看」且有进度 · 最近动过的在前</span>
        <span class="rl-rs-switch">
            <button
                class:on={viewMode === 'card'}
                aria-pressed={viewMode === 'card'}
                data-tip="卡片视图"
                on:click={() => (viewMode = 'card')}><Icon icon="layout-grid" size={12} /> 卡片</button>
            <button
                class:on={viewMode === 'list'}
                aria-pressed={viewMode === 'list'}
                data-tip="列表视图"
                on:click={() => (viewMode = 'list')}><Icon icon="list" size={12} /> 列表</button>
        </span>
    </div>

    {#if queue.length === 0}
        <div class="rl-rs-empty">没有可续的条目 — 标记为「在看」并播过 / 读过之后会出现在这里</div>
    {:else if viewMode === 'card'}
        <div class="rl-rs-cards">
            {#each queue as row (row.entry.id)}
                {@const e = row.entry}
                <button
                    class="rl-rs-card"
                    data-tip={`打开：${e.title}`}
                    on:click={() => onOpenEntry(e.id)}>
                    <span class="rl-rs-cover">
                        {#if posterOf(e)}
                            <img src={posterOf(e)} alt="" loading="lazy" />
                        {:else}
                            <span class="rl-rs-cover-ph"><Icon icon="gallery-horizontal" size={18} /></span>
                        {/if}
                        <!-- 进度条：只在算得出比例时画（`percent` 为 0 说明不知道片长，⛔ 别画个 0% 的条） -->
                        {#if row.spot.percent > 0}
                            <span class="rl-rs-bar"><span class="rl-rs-bar-fill" style={`width:${row.spot.percent}%`}></span></span>
                        {/if}
                    </span>
                    <span class="rl-rs-name">{e.title}</span>
                    <span class="rl-rs-spot">{row.spot.text}</span>
                    <span class="rl-rs-meta">{statusLabel(e.type, 'watching')}{e.year ? ` · ${e.year}` : ''}</span>
                </button>
            {/each}
        </div>
    {:else}
        <table class="rl-rs-table">
            <thead>
                <tr>
                    <th>标题</th>
                    <th>续播位置</th>
                    <th>进度</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                {#each queue as row (row.entry.id)}
                    {@const e = row.entry}
                    <tr>
                        <td>
                            <span
                                class="rl-rs-title-cell"
                                role="link"
                                tabindex="0"
                                on:click={() => onOpenEntry(e.id)}
                                on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>{e.title}</span>
                        </td>
                        <td><span class="rl-rs-spot">{row.spot.text}</span></td>
                        <td>
                            {#if row.spot.percent > 0}
                                <span class="rl-rs-pct">{row.spot.percent}%</span>
                            {:else}
                                <span class="rl-rs-pct rl-rs-pct-na">—</span>
                            {/if}
                        </td>
                        <td>
                            <button class="rl-rs-btn" data-tip="编辑属性" on:click={() => onEditEntry(e.id)}><Icon icon="pencil" size={12} /> 编辑</button>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
</div>

<style>
    .rl-resume { font-size: 13px; }
    .rl-rs-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .rl-rs-title { font-size: 14px; font-weight: 700; }
    .rl-rs-cnt { font-size: 11px; color: var(--text-muted); background: var(--background-modifier-hover); border-radius: var(--rl-t-radius-pill, 999px); padding: 1px 9px; }
    .rl-rs-hint { font-size: 11px; color: var(--text-faint); }
    /* 与计划页既有的 `.rl-tracking-switch` 同一套胶囊造型（同页两个切换器样式必须一致） */
    .rl-rs-switch { display: flex; gap: 0; margin-left: auto; border: 1px solid var(--background-modifier-border); border-radius: 7px; overflow: hidden; }
    .rl-rs-switch button { font-family: inherit; font-size: 11px; border: none; background: var(--background-primary); color: var(--text-muted); padding: 2px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .rl-rs-switch button + button { border-left: 1px solid var(--background-modifier-border); }
    .rl-rs-switch button.on { background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    .rl-rs-empty { text-align: center; color: var(--text-faint); padding: 36px 0; font-size: 13px; }

    .rl-rs-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }
    .rl-rs-card { display: flex; flex-direction: column; gap: 3px; padding: 0; border: 0; background: transparent; box-shadow: none; text-align: left; cursor: pointer; font-family: inherit; }
    .rl-rs-cover { position: relative; display: block; width: 100%; aspect-ratio: 2 / 3; border-radius: var(--rl-t-radius-md, 6px); overflow: hidden; background: var(--background-modifier-hover); }
    .rl-rs-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rl-rs-cover-ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--text-faint); }
    .rl-rs-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(0, 0, 0, .35); }
    .rl-rs-bar-fill { display: block; height: 100%; background: var(--interactive-accent); }
    .rl-rs-card:hover .rl-rs-name { color: var(--interactive-accent); }
    .rl-rs-name { font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-rs-spot { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
    .rl-rs-meta { font-size: 10.5px; color: var(--text-faint); }

    .rl-rs-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .rl-rs-table th, .rl-rs-table td { padding: 7px 10px; border-bottom: 1px solid var(--background-modifier-border); text-align: left; vertical-align: middle; }
    .rl-rs-table th { font-size: 11px; color: var(--text-faint); font-weight: 600; white-space: nowrap; }
    .rl-rs-table tbody tr:hover { background: var(--background-modifier-hover); }
    .rl-rs-title-cell { cursor: pointer; font-weight: 600; color: var(--text-normal); }
    .rl-rs-title-cell:hover { color: var(--interactive-accent); text-decoration: underline; }
    .rl-rs-pct { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--text-normal); }
    .rl-rs-pct-na { color: var(--text-faint); }
    .rl-rs-btn { font-family: inherit; font-size: 11px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); padding: 2px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .rl-rs-btn:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
</style>
