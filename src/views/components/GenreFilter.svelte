<!--
  题材筛选（视图级多选）—— 合集视图用。

  🔴 2026-11-08（用户 m03712）：「合集视图的筛选栏要和默认视图的筛选栏统一」
     ⇒ 合集视图原来只有「类型 / 状态 / 排序」三枚下拉，**完全没有题材**。本组件补上这一项。

  ⚠️⚠️ **已知重复，如实登记（⛔ 别把它当「唯一真源」宣传）**：
     主视图 `MediaList.svelte` 里**仍然保留着自己那份内联题材实现**（`:2544-2577` 模板 +
     `:1360-1403` 逻辑 + `:3873-3939` 的 19 条 scoped 样式）。本组件是照那份**逐条搬过来**的，
     行为应当一致，但**是两份**。
     为什么这批没一并搬迁：断言脚本对主视图那份是**逐字锁死**的 —— `check594` 要
     `<span class="rl-vb-select rl-genre-wrap" class:is-open={genreOpen}>` 原样出现在
     `MediaList.svelte` 里（`assert-symbols.cjs:22664`），`#369` 那一整段（`:5704-5934`）
     还锁着它的面板结构 / 双向前缀选择器 / `overflow:auto` / 反 sticky 等约 30 条。
     改主视图 = 一次性重写那 30 条守卫，风险远大于本批收益 ⇒ 留作独立批次。
     ⇒ 迁移时的正确做法：让主视图改用它、删掉它那 19 条 scoped 样式与内联逻辑，
       同时把 `#369` / `check594` 那批断言改为**读本组件**（它们是「题材功能存在」的唯一机器保证，
       ⛔ 不能简单删掉）。

  ⚠️ 纯逻辑**一律**在 `pure/genreFilter`（池构建 / 命中判定 / 胶囊文案 / 作用域键），
     ⛔ 本组件不自己算题材池，也不自己写「未分类」桶的口径。
  ⚠️ 本组件**只渲染胶囊 + 浮层**（根节点 `.rl-genre-wrap`），外层的
     `<span class="rl-vb-select"><span class="rl-sel-label">题材</span>…</span>` 由宿主负责 ——
     那两枚类名的样式在各自宿主的 scoped 块里，组件内的样式作用不到宿主的元素上。
-->
<script lang="ts">
    import { onDestroy } from 'svelte';
    import { buildGenreOptions, genrePillLabel, type GenreOption } from 'pure/genreFilter';
    import { broadcastClosePeers } from './MiniSelect.svelte';

    /**
     * 题材池的**候选范围**（该子视图作用域内的条目）。
     * ⚠️ 传的是条目本身而不是选项：池必须由 `buildGenreOptions` 现场算（频次会随筛选变化）。
     *    没有作用域（父级视图不提供题材筛选）时，宿主应当**整个不渲染**本组件 ——
     *    这里不写「空了就藏」的兜底，那会让「该视图本不提供题材」和「该视图恰好没题材」混成一个样子。
     */
    export let pool: ReadonlyArray<{ genres?: string[] }> = [];

    /** 已选题材 key（多选 OR）。宿主 `bind:` 它。 */
    export let selected: string[] = [];

    /**
     * 作用域**复位键**（`pure/genreFilter.genreScopeKeyOf` 的返回值）。
     * 键一变就把已选清空：从「文学」切到「网文」是两套独立池，留着旧选项会让列表莫名其妙变空。
     * ⚠️ 宿主必须传「不经过筛选结果」的量算出来的键，否则会构成响应式环（`genreScopeKeyOf` 的注释细讲）。
     */
    export let scopeKey = '';

    /**
     * 主题分组名（同一行里的下拉互斥用）。
     * ⚠️ 默认值与 `MediaList` / `CollectionBoard` 那三枚 `MiniSelect` 相同 ⇒ 点开题材会把类型/状态/排序收起来。
     */
    export let group = 'rl-toolbar-filters';

    /** 读屏 / 面板标题用的名字。 */
    export let label = '题材';

    let open = false;
    let onDown: ((ev: MouseEvent) => void) | null = null;
    let onKey: ((ev: KeyboardEvent) => void) | null = null;
    let scopeKeyPrev = '';

    $: options = buildGenreOptions(pool);
    $: pill = genrePillLabel(options, selected);
    $: allSelected = options.length > 0 && options.every((o: GenreOption) => selected.includes(o.key));

    // 作用域换了 ⇒ 已选作废（口径见 pure/genreFilter 的 D-7）
    $: if (scopeKey !== scopeKeyPrev) {
        scopeKeyPrev = scopeKey;
        if (selected.length > 0) selected = [];
        close();
    }

    function unbindWindow(): void {
        if (onDown) {
            window.removeEventListener('mousedown', onDown);
            onDown = null;
        }
        if (onKey) {
            window.removeEventListener('keydown', onKey);
            onKey = null;
        }
    }

    function close(): void {
        unbindWindow();
        open = false;
    }

    /**
     * 胶囊点击：开 / 关。
     * ⭐ 绑定 window 监听的时机必须在这一个 click 里（不是 mousedown）——
     *    本轮 mousedown 早已派发完毕，否则会「刚打开就被自己的外点击监听关掉」。
     */
    function toggle(): void {
        if (open) {
            close();
            return;
        }
        // 题材是手写面板、不是 MiniSelect ⇒ 要显式广播一次「别的下拉请收起」
        broadcastClosePeers(group);
        open = true;
        onDown = (ev: MouseEvent) => {
            const el = ev.target as HTMLElement | null;
            // 面板内（勾选项 / 全选）与胶囊自身不关闭 —— 胶囊走自己的 toggle
            if (el?.closest('.rl-genre-panel') || el?.closest('.rl-genre-btn')) return;
            close();
        };
        onKey = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') close();
        };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
    }

    /** 勾选 / 取消一项（点选立即生效，面板不收起 —— 多选本来就是连点） */
    function toggleOption(key: string): void {
        selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    }

    /**
     * 全选 ⇄ 清空（用户 2026-09-22：「题材筛选点全选后再点可以清空全选」）：
     * 已全选时再点 = 清空；否则 = 全选本视图池里的全部题材（**含「未分类」**）。
     * ⚠️ 池 = 整个子视图，没有分页概念（⛔ 别照搬表格那套「本页全选」）。
     */
    function selectAll(): void {
        selected = allSelected ? [] : options.map((o) => o.key);
    }

    onDestroy(unbindWindow);
</script>

<span class="rl-genre-wrap" class:is-open={open}>
    <button
        type="button"
        class="rl-genre-btn"
        class:is-on={selected.length > 0}
        aria-expanded={open}
        data-tip={`${label}筛选`}
        on:click={toggle}>
        {pill}<span class="rl-genre-caret" aria-hidden="true">▾</span>
    </button>
    {#if open}
        <div class="rl-genre-panel">
            <div class="rl-genre-head">
                <span>{label}</span>
                <button type="button" class="rl-genre-all" on:click={selectAll}>{allSelected ? '清空' : '全选'}</button>
            </div>
            <div class="rl-genre-body">
                {#if options.length === 0}
                    <div class="rl-genre-none">该视图下的条目暂无题材</div>
                {:else}
                    {#each options as o (o.key)}
                        <label class="rl-genre-opt">
                            <input type="checkbox" checked={selected.includes(o.key)} on:change={() => toggleOption(o.key)} />
                            <span class="rl-genre-name">{o.label}</span>
                            <span class="rl-genre-cnt">{o.count}</span>
                        </label>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}
</span>

<style>
    /* ⚠️ 本文件的规则原样搬自 `MediaList.svelte`（那批注释保留，都是踩过的坑）。
       🔴 规则一律写**两级前缀**（`.rl-genre-wrap .rl-genre-btn`）：单类 (0,1,0) 会被核心
       `button:not(.clickable-icon)` (0,1,1) 压出主题灰底 + `--input-shadow`（UI-GUIDE §3 v14/v15 老坑，
       实机截图里「全选」按钮就踩到过 —— 它是个带边框的方按钮）。
       注：面板内那个「全选」按钮要**拍平**（透明、无边框、无阴影），而**胶囊不要拍平阴影**
       （它就该有和 select 一样的内阴影）。 */
    .rl-genre-wrap { position: relative; display: inline-flex; }
    /* 🔴 与工具栏「状态 / 排序」两个 select **同款盒模型**（用户 2026-09-22 截图：胶囊矮一半 + 悬停变蓝边）。
       实测差异只有两项 —— 高度 30 vs 21、内阴影 有/无；其余（边框色/宽、圆角、内距、背景、字号、
       字重、字色、box-sizing）本就逐项相同。两处都跟随**核心真源**：
         · `height: var(--input-height)`  ← 核心 `select, .combobox-button, .dropdown { height: var(--input-height) }`
         · `box-shadow: var(--input-shadow)` ← 核心输入控件的「内描边 + 1px 投影」
       ⛔ 不要把高度/阴影写死成 px（主题若改 `--input-height`，select 会跟着变，胶囊就又不一致了）。 */
    .rl-genre-wrap .rl-genre-btn {
        font-family: inherit; font-size: 12px; color: var(--text-normal);
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); box-shadow: var(--input-shadow); padding: 2px 8px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 4px; height: var(--input-height);
    }
    /* 悬停：⛔ **不动描边**（相邻两个 select 的描边永不变化，动它就成了截图里那条蓝边）——
       只让**文字 + 箭头**变主题色（本项目并排控件的既定语言），阴影按核心 select 的 hover 档加深一档，
       同样 ⛔ 不铺底色（并排控件铺底会连成色带）。 */
    .rl-genre-wrap .rl-genre-btn:hover { color: var(--interactive-accent); box-shadow: var(--input-shadow-hover); }
    /* 🔴 #594：**下拉打开时保持高亮**（用户：「鼠标悬停保持高亮，下拉时也保持高亮，取消悬停恢复正常，
       取消下拉恢复正常」）—— 展开面板后鼠标移进面板、闭合框就丢了 `:hover` ⇒ 高亮一闪就没了。
       这里补一条 `is-open` 档，样式与悬停**逐条同款**（同样只变色、不动描边）。
       ⚠️ 与 MiniSelect 的 `.rl-sel-wrap.is-open` 是同一条口径的两半。 */
    .rl-genre-wrap.is-open .rl-genre-btn { color: var(--interactive-accent); box-shadow: var(--input-shadow-hover); }
    .rl-genre-wrap.is-open .rl-genre-caret { color: var(--interactive-accent); }
    .rl-genre-wrap .rl-genre-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    /* 已筛选态：只留**文字**变主题色（标签本身会显示「推理+1」）。
       ⛔ 不给描边上色 —— 那正是相邻 select 永远不会有的形态（用户 2026-09-22 截图点名）。 */
    .rl-genre-wrap .rl-genre-btn.is-on { color: var(--interactive-accent); }
    .rl-genre-caret { font-size: 9px; opacity: .7; }
    /* 浮层向下开（用户 D-8）：工具栏在视图顶部，下方只会被 .view-content 裁掉 —— 封顶高度 + 内部滚动兜住；
       ⛔ 不用 placeMenu（那是右键菜单的视口贴点逻辑，这里要的是「贴着胶囊左对齐向下」）。
       ⚠️ 题头固定靠 **flex 三段（head flex:none + body overflow:auto）**，⛔ 不用 `position: sticky`
       —— 产物里有一道全仓反向守卫禁止 `position:sticky;top:0`（页签吸顶已撤，勿回潮）。 */
    .rl-genre-panel {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 40;
        min-width: 190px; max-width: 260px; max-height: 280px;
        display: flex; flex-direction: column; overflow: hidden;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-lg, 8px); box-shadow: var(--rl-t-shadow-menu, 0 4px 14px rgba(0, 0, 0, .15));
        cursor: default;
    }
    .rl-genre-head {
        flex: none;
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border);
        font-size: 11px; color: var(--text-faint);
    }
    /* 「全选 / 清空」：也是 <button> ⇒ 同样两级前缀 + 显式拍平（核心那套灰底/内阴影必须压掉） */
    .rl-genre-head .rl-genre-all {
        font-family: inherit; font-size: 11px; color: var(--interactive-accent);
        background: transparent; border: none; box-shadow: none; padding: 0; height: auto;
        cursor: pointer;
    }
    .rl-genre-head .rl-genre-all:hover { text-decoration: underline; }
    .rl-genre-body { flex: 1 1 auto; overflow: auto; padding: 4px 0; }
    /* 列表行 = 勾选框 + 名称 + 计数（计数列右对齐并等宽，数字成列好读） */
    .rl-genre-opt { display: flex; align-items: center; gap: 8px; margin: 0 4px; padding: 3px 6px; border-radius: 4px; font-size: 12px; cursor: pointer; }
    .rl-genre-opt:hover { background: var(--background-modifier-hover); }
    /* 🔴 勾选框尺寸/圆角一律**就地覆盖主题变量**：核心 `input[type=checkbox]` 的 width/height 走
       `--checkbox-size`（缺省 = --font-text-size）、圆角走 `--checkbox-radius` —— 用户主题把它们放大到
       实测 **26px + 全圆**（截图里那几个大圆圈）。变量覆盖最稳（比硬写尺寸更抗主题），尺寸再显式写一遍兜底。 */
    .rl-genre-opt input[type="checkbox"] {
        --checkbox-size: 13px; --checkbox-radius: 3px;
        width: 13px; height: 13px; margin: 0; flex: none;
    }
    .rl-genre-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-genre-cnt { margin-left: auto; font-size: 10px; color: var(--text-faint); flex: none; min-width: 18px; text-align: right; font-variant-numeric: tabular-nums; }
    .rl-genre-none { padding: 8px 10px; font-size: 11px; color: var(--text-faint); }
</style>
