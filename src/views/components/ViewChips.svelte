<script lang="ts">
    /**
     * 分类视图切换（下拉选择）—— **全仓唯一真源**。
     *
     * 🔴 2026-11-26 用户逐字（m04553）：「新视图只能在插件高级设置页里加，首页不显示加按钮，
     *    …默认视图/合集视图/新视图改成下拉选择，还有这些胶囊样式的按钮有点不符合整体协调观了
     *    改成距形和筛选、排序相符的样式」
     *    ⇒ 三件事：
     *      ⑴ **删掉那颗「＋ 新建视图」**：建视图的唯一入口是设置页「高级 → 分类视图」。
     *         ⛔ 别把「＋」加回来 —— 首页是「用视图」的地方，不是「配视图」的地方。
     *      ⑵ **胶囊 → 下拉**：N 个视图并排会把工具栏撑爆（视图越多越糟），
     *         下拉是 O(1) 宽度，且与「状态 / 排序」两枚下拉同一种控件语言。
     *      ⑶ 因此样式自动「矩形」—— 用的是全仓自绘下拉 `MiniSelect`（`.rl-sel-btn` 盒模型），
     *         ⛔ 别再手写一套 `.rl-view-chip` 胶囊（那正是用户说「不符合整体协调观」的那个）。
     *
     * 🔴 从 `HomeView.svelte` 抽出成组件的原因：合集视图**不用** `MediaList`
     *    （它换的是整页骨架），若这个下拉只写在 HomeView 里，合集视图那一支就得不到 ——
     *    而「默认视图有、合集视图没有」正是用户反复报的那种不一致。
     *    ⚠️ 一致性不能靠两处代码长得像：**只有一份实现**，两处各自 `slot` 塞进去。
     *
     * ⚠️ 纯展示：选中态由宿主 `activeViewId` 给，点击只回推 `onPickView`；
     *    增删改视图定义一律在设置页（`Settings.renderMediaViewsRows`），⛔ 别在这里改库。
     */
    import { VIEW_KIND_LABELS, type MediaView } from 'pure/mediaViews';
    import MiniSelect, { TOOLBAR_FILTER_GROUP } from './MiniSelect.svelte';

    /** 要铺出来的视图（宿主已按「显示/隐藏 + 当前选中兜底」算好，⛔ 这里别再筛一遍） */
    export let views: MediaView[] = [];
    /** 当前选中的视图 id */
    export let activeViewId = '';
    /** 选了某个视图 */
    export let onPickView: (id: string) => void = () => {};

    /**
     * 下拉选项：`value` 用 id（改名不影响选中），`label` 用名字。
     *
     * 🔴 2026-11-08 用户 m04478 逐字：「且在首页视图展示下拉隐藏默认视图和合集视图旁的[内置]样式」
     *    ⇒ label **恒等于 `v.name`**，⛔ 别再把「（内置）」拼回去。
     *    原本加这枚后缀的理由是「内置视图没有删除入口，得说明原因」—— 那条解释仍然成立，
     *    但设置页那行已经给了（`src/Settings.ts` 的 `.rl-view-row-badge` = `[系统内置]`）。
     *    首页工具条是用户天天点的操作面，不该反复念同一句免责声明；
     *    ⚠️ 因此「不可删」的正源是设置页那枚徽章，⛔ 别为了平衡把它也摘了。
     */
    $: options = views.map((v: MediaView) => ({ value: v.id, label: v.name }));

    /** 空列表时给个兜底名，避免闭合框里一片空白（归一器理论上恒 ≥1，这里只防脏数据） */
    $: fallback = VIEW_KIND_LABELS.default;
</script>

<!-- 🔴 外层判 `views.length`（不是「可见条数」）：全被隐藏时这条也在，才能切回其它视图。
     ⚠️ 判空用的是「有没有可选视图」——没选项的下拉比不渲染更糟（点了弹个空面板）。
     🔴🔴 2026-11-15 用户 m05159 问题二（逐字）：
        「仅勾选一个视图时：首页不显示下拉框，**也不显示任何纯文本视图信息**，
          直接展示该唯一视图内容。」
        ⇒ 这条**推翻了** m13127 ② 那个「退化成静态名字」的折中。原折中的理由是
          「名字是信息，砍掉就失去方向感」；但只有一个视图时，那个名字恒等于用户
          自己刚勾的那一条，没有任何信息量，只是占着最左端一格空位。
          ⛔ 别把 `.rl-viewpick-single` / `singleName` 加回来：
             留着就是 Unused CSS selector，顶破 svelte-check 的 89 基线。
     ⚠️ 判据是 `views.length`（宿主传进来的 `shownViews`），⛔ 别在这里再按 `hidden` 过滤一遍。
     ⚠️ `{:else}` 那支（`views.length === 0`）必须保留：它是脏数据兜底，
        与「只剩一个」是两个不同的分支，⛔ 别一起删。 -->
{#if views.length > 1}
    <span class="rl-vb-select rl-viewpick">
        <MiniSelect
            value={activeViewId}
            {options}
            ariaLabel="分类视图"
            group={TOOLBAR_FILTER_GROUP}
            onPick={onPickView} />
    </span>
{:else if views.length === 0}
    <span class="rl-vb-select rl-viewpick">
        <span class="rl-viewpick-none">{fallback}</span>
    </span>
{/if}

<style>
    /* 🔴 2026-11-26：从「一排胶囊」改成「一枚带标签的下拉」。
       盒模型与 `MediaList` 的 `.rl-vb-select`（状态下拉那一族）逐字同款 —— 用户要的就是
       「和筛选、排序相符」，所以这里只负责**标签 + 间距**，控件本体交给 `MiniSelect`。
       ⛔ 别再写 `margin-bottom`（工具栏那行自己有间距，叠起来就是双份留白）。

       🔴 2026-11-13 用户逐字（m12719）：「首页视图切换下拉项旁边的"视图"删除掉」
       ⇒ 那枚 10px 的 `视图` 文字标签**整枚退场**（`MediaList` 的「状态 / 排序」两枚不受影响，
       它们各自在别的组件里）。因此：
         ⑴ 模板两处 `<span class="rl-sel-label">视图</span>` 一并删除（正常分支 + 脏数据兜底分支）；
         ⑵ `.rl-sel-label` 规则**同时删除** —— 留着就是 Unused CSS selector，会顶破 svelte-check 的 89 基线；
         ⑶ `gap: 6px` 一并去掉 —— 标签走了就只剩 `MiniSelect` 一个子元素，间距没有间距可言。
       ⚠️ 不要因此把「状态 / 排序」的标签也删了：用户只点了「视图」这一枚，
       而且那两枚的语义是「值可能不含自身名称」（`全部` / `评分高→低`），去掉就分不清在选什么。 */
    .rl-viewpick {
        display: inline-flex;
        align-items: center;
        flex: none;
    }
    /* 脏数据兜底：没有可选视图时也要有个能看的东西，⛔ 别留一片空白 */
    .rl-viewpick-none {
        font-size: 12px;
        color: var(--text-muted);
        white-space: nowrap;
    }
</style>
