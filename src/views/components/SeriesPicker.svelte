<script lang="ts">
    // 系列选择面板（2026-09-30 #444c：从「插件视图内的绝对定位浮层」改成**应用级 Modal 的内容**）。
    //
    // 🔴 为什么换形态（用户原话）：「直接改成全仓库，不局限于当前插件视图内了，**改成编辑条目弹出窗口这样**」
    //    —— 那两个诉求（不要遮罩 / 弹窗要更大）在「视图内居中弹窗」这个形态下**互相冲突**：
    //    去掉遮罩仍受正文区限制（窄），要变大只能留在正文区里做，怎么做都是 4 列。
    //    ⇒ 改成宿主 `Modal`（挂 `document.body`）：宽度按**整个窗口**算（不再被正文区卡住），
    //      遮罩交给宿主（与「编辑条目」等同款），插件内不再自己造遮罩。
    //
    // ⚠️ 本组件**只画内容**（头部 + 封面网格）—— 弹窗外壳、宽度、遮罩、Esc / 点外面关闭全部由
    //    `modals/SeriesPickerModal`（宿主 `Modal`）提供，⛔ 别在这里再写 `position: absolute` 或遮罩。
    import { hasActionEntry, actionIcon, actionAriaLabel, actionUnavailableHint } from 'pure/actionLabel';
    import { nextSeriesEntry, type SeriesGroup } from 'pure/seriesGroup';
    import { seasonRowMeta } from 'pure/mediaProgress';
    import { TYPE_COLORS, type ColorTheme, type MediaEntry } from 'data/types';
    import Icon from './Icon.svelte';

    export let group: SeriesGroup;
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    export let colorTheme: ColorTheme = 'colorful';
    /** 点某一部 / 某一季：宿主侧负责「先关弹窗，再执行播放 / 阅读」 */
    export let onPlay: (e: MediaEntry) => void = () => {};
    // 🔴 #444d：**关闭钮不归内容组件**（没有 `onClose` prop）—— 出口只有宿主那一枚
    //    `.modal-close-button`（Obsidian 挂在 `.modal` 内右上角，Esc / 点遮罩外也走它）。
    //    ⛔ 别在这里再加一个 prop + 自绘一枚 ✕（上一版就是这么干的，用户看到**两个叉**）。

    /**
     * 「继续」= 那一部**还值得接着看**（在看 → 想看），规则在 `pure/seriesGroup.nextSeriesEntry`。
     * ⚠️ 先滤掉「已看 / 存档」再挑：全看完的系列不该被标「继续」（那时 next 是 undefined ⇒ 一个标记都不出）。
     */
    $: next = nextSeriesEntry(group.items.filter((x) => x.status === 'watching' || x.status === 'want'));

    /** 豆瓣图床防盗链：无 Referer 返回 418，需 img referrerpolicy="unsafe-url" */
    function isDoubanImage(u: string | undefined): boolean {
        return !!u && /doubanio\.com/.test(u);
    }
    function hash(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
    }
</script>

<!-- 🔴 #444d：头部**只有**「组名 + N 部」—— ⛔ 这里不再自绘关闭钮。
     关闭归宿主 `.modal-close-button`（Obsidian 挂在 `.modal` 内、右上角；Esc / 点遮罩外同效）。 -->
<div class="rl-series-act-head">
    <span class="rl-series-act-name">{group.title}</span>
    <span class="rl-series-act-cnt">{group.items.length} 部</span>
</div>
<!-- 一格 = 一部/一季的**海报**（与海报墙上同款 `.rl-cov` / 占位 `.rl-cov-ph`），hover 浮出动作遮罩，点即播。 -->
<div class="rl-series-act-tiles">
    {#each group.items as it (it.id)}
        {@const usable = hasActionEntry(it)}
        <button
            class="rl-series-act-tile"
            class:rl-series-act-na={!usable}
            class:rl-series-act-play={actionIcon(it.type) === 'play'}
            data-tip={usable ? `${actionAriaLabel(it.type)}：${it.title}` : actionUnavailableHint(it.type)}
            on:click={() => onPlay(it)}>
            <span class="rl-series-act-thumb">
                {#if posterUrl(it)}
                    <img class="rl-cov" src={posterUrl(it)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(it)) ? 'unsafe-url' : undefined} />
                {:else}
                    <!-- ⚠️ `--h` 与 `--tc` 之间必须是**分号**（#434 的「占位封面透明」就是这个空格造的，有反向守卫钉着） -->
                    <span class="rl-cov rl-cov-ph" style={`--h:${hash(it.id) % 360}${colorTheme === 'colorful' ? `;--tc:${TYPE_COLORS[it.type]}` : ''}`}><span>{it.title.slice(0, 2)}</span></span>
                {/if}
                <!-- 「继续」= 建议接着看的那一部（规则在 pure/seriesGroup.nextSeriesEntry），钉在封面左上角 -->
                {#if next && next.id === it.id}<span class="rl-series-act-next">继续</span>{/if}
                <span class="rl-series-act-mask">
                    {#if usable}
                        <Icon icon={actionIcon(it.type)} size={18} /><span class="rl-sr">{actionAriaLabel(it.type)}</span>
                    {:else}
                        <span class="rl-series-act-na-txt">未关联</span>
                    {/if}
                </span>
            </span>
            <span class="rl-series-act-tile-ttl">{it.title}</span>
            <span class="rl-series-act-tile-meta">{seasonRowMeta(it)}</span>
        </button>
    {/each}
</div>

<style>
    /* 头部（组名 + N 部）。⚠️ 这一族类名/数值是从 `MediaList.svelte` **原样搬来**的
       （#444c 换形态时只换了「谁提供外壳」，⛔ 没动任何几何）。 */
    .rl-series-act-head {
        flex: none; display: flex; align-items: baseline; gap: 8px;
        padding: 0 0 8px;
        margin-bottom: 10px;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    .rl-series-act-name { font-size: 13px; font-weight: 600; color: var(--text-normal); }
    .rl-series-act-cnt { font-size: 11px; color: var(--text-faint); }
    /* 封面网格：**居中排**（弹窗比内容宽时左右留白对称），一行放不下就换行 */
    .rl-series-act-tiles { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    /* 🔴🔴 `height: auto` **不能省**（2026-09-30 仿真页量出来的，值一整轮排查）：
       宿主核心有一条**裸元素**规则 `button { … height: var(--input-height); … }`（=`30px`，特异性只有 (0,0,1)）。
       它只声明 `height`，我们这条规则里又**没有** `height` ⇒ 格子的高度被那一条按 **30px** 顶死，
       于是「封面 180 + 标题 + 小字」全被挤：封面被压到 20.7px、标题行塌成 0、整个面板高度也对不上。
       ⛔ 别只写 `min-height: 0` 或指望 `display:flex` 能撑开 —— **高度是被别人写死的**，必须自己声明回来。 */
    .rl-series-act-tile {
        flex: none; width: 110px; height: auto; box-sizing: border-box;
        display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start;
        gap: 3px; padding: 0; margin: 0; min-height: 0;
        background: transparent; box-shadow: none; border: none; border-radius: var(--rl-t-radius-md, 6px);
        text-align: left; font-family: inherit; cursor: pointer;
    }
    .rl-series-act-thumb { position: relative; display: block; border-radius: var(--rl-t-radius-md, 6px); overflow: hidden; }
    .rl-series-act-mask {
        position: absolute; inset: 0; z-index: 2;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .42); color: #fff;
        opacity: 0; transition: opacity .15s ease;
    }
    .rl-series-act-tile:not(.rl-series-act-na):hover .rl-series-act-mask,
    .rl-series-act-tile:not(.rl-series-act-na):focus-visible .rl-series-act-mask { opacity: 1; }
    /* ▶ 三角形视觉重心偏左 ⇒ 只给播放类补 2px 左内距（与 `.rl-watch-btn.rl-watch-play` 同一条理由） */
    .rl-series-act-tile.rl-series-act-play .rl-series-act-mask { padding-left: 2px; }
    /* 名字在 hover 时变强调色（与海报墙上「并排按钮只变文字色」同一克制口径，⛔ 不铺底） */
    .rl-series-act-tile:hover .rl-series-act-tile-ttl { color: var(--interactive-accent); }
    /* 「继续」钉封面**左上角**（右上角是墙上的评分/×N 语汇，别抢） */
    .rl-series-act-next {
        position: absolute; left: 5px; top: 5px; z-index: 3;
        background: var(--interactive-accent); color: var(--text-on-accent, #fff);
        font-size: 9.5px; font-weight: 600; line-height: 1;
        padding: 3px 6px; border-radius: var(--rl-t-radius-pill, 999px);
    }
    .rl-series-act-tile-ttl { font-size: 11.5px; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-series-act-tile-meta { font-size: 10px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 这一部没有可用入口：整格压暗、遮罩常显「未关联」，⛔ 不给点了没反应的播放感 */
    .rl-series-act-na { cursor: default; }
    .rl-series-act-na .rl-series-act-thumb { opacity: .5; }
    .rl-series-act-na:hover .rl-series-act-tile-ttl { color: var(--text-normal); }
    .rl-series-act-na .rl-series-act-mask { opacity: 1; background: rgba(0, 0, 0, .3); }
    .rl-series-act-na-txt {
        background: rgba(0, 0, 0, .55); color: #fff;
        font-size: 10px; line-height: 1; padding: 4px 7px;
        border-radius: var(--rl-t-radius-pill, 999px);
    }
    /* 封面与占位封面：与海报墙同款（本组件自己带一份 scoped 副本 —— 搬形态时弹窗不再长在 MediaList 里了） */
    .rl-cov { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--background-secondary); flex-shrink: 0; }
    .rl-cov-ph { display: flex; align-items: flex-end; justify-content: flex-start; padding: 6px; font-size: 12px; color: #fff; background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph:not([style*="--tc"]) { background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph[style*="--tc"] { background: var(--tc); }
</style>
