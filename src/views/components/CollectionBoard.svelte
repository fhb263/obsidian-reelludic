<script lang="ts">
    /**
     * 合集视图（用户 2026-11-23 裁定；2026-11-25 改形态；2026-11-26 再改）。
     *
     * 🔴 2026-11-25 用户逐字：「合集视图显示为一个归属合集一个海报墙样式显示为入口」
     *    ⇒ 一级是**海报墙**：一个「归属合集」一张海报卡（2:3 封面 + 标题栏），
     *      点卡片才进到那个合集的内部。卡片是入口，不是可展开的抽屉。
     * 🔴 2026-11-26 用户逐字：「合集卡片内打开显示为小标题做如动画系列、电影系列、游戏系列
     *    下为卡片网格样式风格」
     *    ⇒ 二级 = 每个类型一段小标题（行标题由 `mediaViews` 给，纯「{类型}系列」，无合集名前缀）
     *      + 其下**卡片网格**（与一级/海报墙同一套 `.rl-card` 与同一网格模板）。
     *
     * 🔴🔴 2026-11-26 用户逐字（m04109）：「合集卡怎么鼠标右键一下后始终是悬停态的？，
     *    还有鼠标滑过的动效怎么不和主视图一致的改回来，还有给合集视图入口和合集卡内加
     *    ctrl+鼠标滚轮缩放，合集卡内的卡片应该也和主视图交互操作一致才对而不是另做个
     *    右上角编辑属性图标，合集视图下也要搜索框、添加条目、筛选栏同步主视图，
     *    并且把顶级分类和搜索框添加条目按钮并排显示」
     *    ⇒ 四件事，都是「让这里和主视图 `MediaList` 用同一套语言」：
     *      ⑴ **悬停态卡住**：卡片带 `tabindex="0"`，右键会让它拿到焦点 ⇒
     *         `.rl-card:focus-within .rl-cov-hover{opacity:1}` 永久命中，遮罩一直亮着。
     *         修法 = 右键后 `blur()` 掉那张卡（`releaseFocus`），⛔ 别去改 `:focus-within`
     *         ——那是键盘可达性的正解，主视图也有同一条规则。
     *      ⑵ **Ctrl+滚轮缩放**：照抄 `MediaList.zoomWheel`（同一组守卫/节流/上下界常量），
     *         落盘出口是同一条 `onPosterZoom` ⇒ 两个视图共用一个「海报密度/列数」设置。
     *      ⑶ **条目卡交互对齐**：删除本组件自造的右上角铅笔（`.rl-hover-edit`），
     *         改用**全仓唯一**的 `EntryContextMenu`（右键菜单 = 主视图那套：主操作 / 关联入口 /
     *         编辑属性 / 摘抄 / 短评 / 攻略 / 重温 / 周目 / 时长 / 删除）。
     *      ⑷ **工具栏同步**：搜索框 + 「＋ 添加」+ 筛选栏（类型胶囊 / 状态）照主视图同一套类名与尺寸；
     *         视图胶囊（`ViewChips`，唯一真源）塞在同一行最左 ⇒ 与搜索框、添加按钮并排。
     *
     * 两级结构：
     *    · 一级（`activeKey === null`）：海报墙，每 IP 一张卡；
     *    · 二级（`activeGroup !== null`）：返回栏 + 按类型分段的「小标题 + 卡片网格」。
     *
     * ⚠️ 纯展示层：分组/排序/命名全在 `pure/mediaViews.buildCollectionGroups`（有单测），
     *    ⛔ 别在本组件再分组一次。搜索/筛选只做**收窄**，不改分组口径。
     * ⚠️ 封面一律走 `posterUrl`（与海报墙同源），⛔ 不新造取图逻辑。
     */
    import { ENTRY_TYPE_LABELS, TYPE_COLORS, type ColorTheme, type EntryType, type MediaEntry } from 'data/types';
    import { collectionSubtitleOf, type CollectionGroup } from 'pure/mediaViews';
    import { actionAriaLabel, actionIcon, hasActionEntry } from 'pure/actionLabel';
    import { matchesSearch, matchesStatus, sortEntries, type SortBy } from 'pure/search';
    import { MEDIA_STATUSES, STATUS_LABELS, type MediaStatus } from 'pure/status';
    import { SORT_OPTIONS_BASE, normalizeSortBy } from 'pure/sortOptions';
    import { POSTER_COLUMNS_MAX, normalizePosterColumns, posterGridTemplate, posterZoomColumns, type PosterDensity } from 'pure/posterGrid';
    import type { BookKind, EntryLogKind, EntryTextKind } from 'data/types';
    import Icon from './Icon.svelte';
    import ViewChips from './ViewChips.svelte';
    import EntryContextMenu from './EntryContextMenu.svelte';
    import MiniSelect, { TOOLBAR_FILTER_GROUP } from './MiniSelect.svelte';
    import type { MediaView } from 'pure/mediaViews';
// 🔴 m07854 ⑭：骰子的显隐判据（纯函数，与主视图共用同一份 —— ⛔ 别在这里另写一个 trim 判定）
import { shouldShowWatchDice } from 'pure/whatToWatch';
/**
 * 🔴 m07854 ⑮：「待补」漏斗（缺关联 ∪ 缺个人评分）。
 * 判据与文案都在 `pure/incomplete` —— ⛔ 别在本组件里重写条件。
 */
import { incompleteTip, isIncomplete } from 'pure/incomplete';

    /** 已聚合好的 IP 分组（上游 `buildCollectionGroups` 的产物） */
    export let groups: CollectionGroup[] = [];
    /** 条目封面（与海报墙同源，⛔ 不新造取图逻辑） */
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    /** 打开条目（点击条目卡片） */
    export let onOpenEntry: (id: string) => void = () => {};
    /** 编辑条目（右键菜单「编辑属性」） */
    export let onEditEntry: (id: string) => void = () => {};
    /** 主操作（观看/阅读/启动/播放），与海报墙那枚同源 */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /** 色彩主题：彩色显示类型色条；单色关闭（与 MediaList 同一口径） */
    export let colorTheme: ColorTheme = 'colorful';

    /* ── ⑤ 工具栏 / 筛选栏（与主视图同名同款）：搜索、添加、类型、状态 ────────────── */
    /** 「＋ 添加」：与 `MediaList` 同一条出口（`plugin.openAddModal`），类型留空 = 表单默认 */
    export let onAdd: (t?: EntryType, kind?: BookKind) => void = () => {};
    /** 右键菜单其余动作（与 `MediaList` 逐条同源，⛔ 别在这里少一条） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    export let onOpenEntryLogModal: (e: MediaEntry, kind: EntryLogKind) => void = () => {};
    export let onOpenEntryTextModal: (e: MediaEntry, kind: EntryTextKind) => void = () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};

    /* ── ③ Ctrl+滚轮缩放（与主视图同一组设置键与出口） ───────────────────────── */
    export let posterDensity: PosterDensity = 'standard';
    export let posterColumns = 6;
    export let ctrlWheelZoom = false;
    export let onPosterZoom: (density: PosterDensity, columns: number, view: 'grid' | 'wall') => void = () => {};

    /* ── ⑥ 视图下拉（唯一真源 `ViewChips`，与默认视图用的是同一个组件） ─────────── */
    export let views: MediaView[] = [];
    export let activeViewId = '';
    export let onPickView: (id: string) => void = () => {};
    /**
     * 🔴🔴 2026-11-26（用户 m04553）：「新视图只能在插件高级设置页里加，首页不显示加按钮」
     *    ⇒ 原来的 `onAddView` / `viewAddDisabled` **已删除**（那颗「＋」不再存在）。
     *    ⛔ 别加回来：建视图的唯一入口是设置页「高级 → 分类视图」。
     */

    /* ── ② 左上角「N 个媒体」（用户 m04553：「合集视图左上角也应该显示"N个媒体"」） ── */
    /** 当前视图下的条目总数（**筛选后**的，与主视图 `.rl-libstats` 同口径） */
    export let viewCount = 0;
    /** 量词（`overviewUnitLabel` 给的「部电影」/「本书」…；多类型/不限时是「项媒体」） */
    export let viewUnit = '项媒体';

    /**
     * 🔴 m07854 ⑭：「今天看什么」骰子（与主视图 `MediaList` 同一套约定）。
     * ⚠️ **未注入（`null`）时整枚按钮不渲染** —— 没接线不画点了没反应的按钮。
     * ⚠️ 候选池由宿主从**全库**筛（「所有想看且评分高的」），合集视图这里只负责报「用户点了」。
     */
    export let onOpenWhatToWatch: (() => void) | null = null;

    /* ── ⑤ 合并视图的「更多」菜单：**已按用户裁定撤掉**（2026-11-26 / m04870） ─────
     * 历史：m04672 用户曾说「…留更多菜单…」，为此这里曾透传 `mergedOn` / `mergedPage` /
     *       `onPickMergedPage` 并在工具栏右端挂 `MergedPageMenu`。
     * 🔴 现在的裁定（m04870 追问后的原话）：「合集视图进入后只能切换到默认视图上才先完全不要页签了」
     *    ⇒ 合集视图里**一枚导航入口都不留**（顶部页签、文字菜单、「更多」全都不给），
     *      连同那三个 prop 与这里的 `MergedPageMenu` 一并删除。
     * ⚠️ 不存在「进得去出不来」：换页出路 = 工具栏最左那枚**视图下拉**切回默认视图，
     *    默认视图的顶部页签就回来了。
     * ⛔ 别再把「更多」菜单补回这个组件 —— 用户要的就是这块干净。
     */

    /**
     * 当前**进入**了哪个合集（`null` = 停在海报墙那一级）。
     * 🔴 存 `group.key` 而不是下标：`groups` 会随筛选变化重排，下标会指到别的合集上。
     * ⚠️ 用 `null` 不用 `''`：`''` 是合法空串键，会让「没进入」与「进入空合集」混淆。
     */
    let activeKey: string | null = null;

    /* ── ⑤ 搜索 / 筛选 / 排序（两级都搜：先筛合集、再筛合集内条目） ─────────────── */
    let searchText = '';
    let statusFilter: MediaStatus | 'all' = 'all';
    /**
     * 🔴 m07854 ⑮：「待补」漏斗开关（缺关联 ∪ 缺个人评分）。
     * ⚠️ 与主视图那枚同口径，但**各自独立**：两个视图的临时筛选互不影响
     *    （用户在这边筛半成品、切到主视图不该被继承；反之亦然）。
     * ⚠️ 不落盘 —— 这是「当下看一眼」的临时态，⛔ 别加设置键。
     */
    let incompleteOnly = false;
    /**
     * 🔴 排序（用户 m04672：「…筛选栏和排序栏」⇒ 合集视图也要排序栏）。
     *    语义**复用 `pure/search.sortEntries`**（与主视图 `filterAndSort` 内部同一份 switch），
     *    ⛔ 别在这个组件里另写一套比较函数。
     *    ⚠️ 默认 `recent`（历史缺省），且**不持久化** —— 合集视图的排序是「当下看一眼」的临时态，
     *      主视图那枚才写进 settings（⛔ 别为它加设置键）。
     */
    let sortBy: SortBy = normalizeSortBy('recent');
    /**
     * 🔴 2026-11-10（用户 m02255 + m02674 裁定）：「类型」与「题材」两维**整枚控件从合集筛选栏移除**。
     *
     * 为什么两维一起删（不是只删「全部类型」选项）：
     *   本组件的题材作用域原先是 `resolveGenreScope(null, typeFilter, 'all')`，而
     *   `pure/genreFilter.ts` 里「`typeFilter === 'all'` ⇒ 返回 `null`」是硬口径
     *   ⇒ 类型控件一消失，`typeFilter` 恒为 `'all'`，题材控件就**永远不渲染**。
     *   用户在看到这条连带影响后明确选择「题材也一起移除（与现在的实际效果一致）」
     *   ⇒ 两维一起下线的结果，与用户在改之前实际能看到的东西完全一致，没有静默丢功能。
     *
     * ⚠️ 仍然保留的两枚下拉：状态（`statusFilter`）、排序（`sortBy`）。
     * ⚠️ `pure/genreFilter` 的 `resolveGenreScope` 口径**一个字都没改** —— 主视图 `MediaList`
     *    还在用它（聚合页签按类型切池、系列视图走 `seriesGenreScope`），那边照常工作。
     *    ⛔ 别因为本组件不用了就去删 `pure/genreFilter` 里的函数或改它的返回语义。
     */
    /** 排序下拉选项：不含「系列序号」两档（那是**单系列视图**专属，`SORT_OPTIONS_BASE` 的注释写明了） */
    $: sortSelOptions = SORT_OPTIONS_BASE.map((o) => ({ value: o.value, label: o.label }));
    /**
     * 状态下拉选项（与主视图同一套 `MEDIA_STATUSES`/`STATUS_LABELS`）。
     * 🔴 用户 m07854 ⑥：「合集视图的搜索栏和默认视图的筛选工具栏 UI 不统一 ⇒ 统一
     *    （状态下拉项统一为「全部」而不是「全部状态」）」。
     *    ⇒ 首项文案从 `全部状态` 改成 `全部`，与 `MediaList.svelte` 的 `statusOptions`
     *      （`s === 'all' ? '全部' : …`）逐字一致。⛔ 别在这里又写成「全部状态」：
     *      两视图切一下就能看出同一枚控件两种叫法。
     */
    $: statusOptions = [
        { value: 'all', label: '全部' },
        ...MEDIA_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
    ];

    /**
     * 收窄后的分组（⛔ 不改分组口径，只做过滤 + 行内排序）。
     * 🔴 搜索口径**复用 `pure/search.matchesSearch`**（主视图同一份），⛔ 别另造一套。
     * 🔴 两级都搜（用户裁定）：合集名命中 ⇒ 保留该合集全部条目；否则只留命中的条目。
     * 🔴 排序（m04672 的「排序栏」）：**只排行内条目**，⛔ 不重排类型行、也不重排合集卡 ——
     *    类型行的顺序由 `buildCollectionGroups` 按 `ENTRY_TYPES` 固定序给（那是分组语义，
     *    跟着排序档变会让「电影/动画/游戏」三行上下乱跳，比不排还难用）。
     *    合集卡顺序同理保留「首次出现序」。
     * 🔴 2026-11-10（m02255 / m02674）：类型维度随控件一起下线 ⇒ 这里**不再按 `typeFilter` 筛行**，
     *    每行的类型就是它本来的类型（`buildCollectionGroups` 已经分好了，不缺这道）。
     */
    $: shownGroups = (() => {
        const q = searchText.trim();
        const ql = q.toLowerCase();
        const out: CollectionGroup[] = [];
        for (const g of groups) {
            const nameHit = ql.length > 0 && g.name.toLowerCase().includes(ql);
            const rows = g.rows
                .map((r) => ({
                    ...r,
                    // 行内先过滤再排序：`sortEntries` 自己会 `slice()`，不会原地动上游数组
                    items: sortEntries(
                        r.items.filter((e) => {
                            if (!matchesStatus(e, statusFilter)) return false;
                            // 🔴 m07854 ⑮：漏斗开关（缺关联 ∪ 缺个人评分）。判据走 `pure/incomplete.isIncomplete`，
                            //    ⛔ 别在这里内联条件 —— 那是本仓反复栽过的「同一件事两份真源」。
                            if (incompleteOnly && !isIncomplete(e)) return false;
                            if (!q) return true;
                            return nameHit || matchesSearch(e, q);
                        }),
                        sortBy
                    ),
                }))
                .filter((r) => r.items.length > 0);
            if (rows.length === 0) continue;
            out.push({ ...g, rows, count: rows.reduce((n, r) => n + r.items.length, 0) });
        }
        return out;
    })();

    /**
     * 🔴 m07854 ⑮：漏斗按钮上的条数 —— 与 `shownGroups` 同一套前置筛选，但**不套** `incompleteOnly`。
     * 理由：用户点漏斗时看的是眼前这屏，提示里的数字必须与点下去剩下的条数对得上；
     * 算全库会出现「说 40 条、点完只剩 3 条」。⚠️ 这里也必须套 `nameHit` 那层两级搜索语义。
     */
    $: incompleteCount = (() => {
        const q = searchText.trim();
        const ql = q.toLowerCase();
        let n = 0;
        for (const g of groups) {
            const nameHit = ql.length > 0 && g.name.toLowerCase().includes(ql);
            for (const r of g.rows) {
                for (const e of r.items) {
                    if (!matchesStatus(e, statusFilter)) continue;
                    if (q && !nameHit && !matchesSearch(e, q)) continue;
                    if (isIncomplete(e)) n++;
                }
            }
        }
        return n;
    })();

    /** 当前进入的合集（`groups` 变了、它被筛掉 ⇒ 自动回退海报墙那一级） */
    $: activeGroup = activeKey === null ? null : shownGroups.find((g) => g.key === activeKey) ?? null;

    /** 一级海报卡的封面：取组内**第一张真实存在的封面**（⛔ 不拿第一张硬顶，它可能是空的） */
    function coverOf(g: CollectionGroup): string | undefined {
        for (const row of g.rows) {
            for (const e of row.items) {
                const url = posterUrl(e);
                if (url) return url;
            }
        }
        return undefined;
    }

    /**
     * 代表类型（类型色条 / 播放钮图标用）。
     * ⚠️ 一个合集可能横跨多类型（熊出没 电影+动画+游戏），这里取**第一行**的类型当代表色，
     *    「横跨几种」由二级返回栏的 `collectionSubtitleOf` 说清，⛔ 别在这儿再发明第二套配色。
     */
    function repTypeOf(g: CollectionGroup): EntryType {
        return g.rows[0]?.type ?? 'movie';
    }

    /** 合集里第一个「有可用入口」的条目（右下 `▶` 的播放目标）—— 没有则整钮不渲染 */
    function firstActionable(g: CollectionGroup): MediaEntry | null {
        for (const row of g.rows) {
            for (const e of row.items) {
                if (hasActionEntry(e)) return e;
            }
        }
        return null;
    }

    /** 类型徽标 —— 真源 `ENTRY_TYPE_LABELS`，⛔ 别写字面量 */
    function typeLabel(t: EntryType): string {
        return ENTRY_TYPE_LABELS[t];
    }

    /** 占位封面色（无封面时用标题前两字 + 稳定色相）—— 与 MediaList 的 `hash` 同一算法 */
    function hash(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
    }

    /** 豆瓣图床防盗链：无 Referer 返回 418，需 img referrerpolicy="unsafe-url"（与 MediaList 同款） */
    function isDoubanImage(u: string | undefined): boolean {
        return !!u && /doubanio\.com/.test(u);
    }

    function enter(key: string): void {
        activeKey = key;
    }

    function back(): void {
        activeKey = null;
    }

    /**
     * 🔴 2026-11-26 用户：「合集卡怎么鼠标右键一下后始终是悬停态的？」
     *    根因 = 卡片带 `tabindex="0"`，右键（或点击）会让它拿到焦点，而悬停遮罩的显隐条件里
     *    有一条 `.rl-card:focus-within .rl-cov-hover{opacity:1}`（与主视图同一条规则，**不能删**，
     *    它是键盘用户看见「打开 ↗」的唯一途径）。
     *    ⇒ 所以我们**在动作完成后主动交还焦点**：`window.setTimeout(…, 0)` 让浏览器先把原生
     *      右键菜单/焦点处理走完，再 blur，⛔ 别同步 blur（部分平台会把原生菜单一起关掉）。
     *    ⚠️ 放在 `contextmenu` 而不是 `mousedown`：`mousedown` 时焦点可能还没落到卡片上。
     */
    function releaseFocus(ev: MouseEvent): void {
        const el = ev.currentTarget as HTMLElement | null;
        if (!el) return;
        window.setTimeout(() => el.blur(), 0);
    }

    /* ── ③ Ctrl+滚轮缩放：照抄 `MediaList.zoomWheel`（同一组守卫 / 节流 / 上下界） ──── */
    const ZOOM_THROTTLE_MS = 140;
    let lastZoomAt = 0;

    /**
     * ⚠️ 监听必须挂在**元素**上并显式 `{ passive: false }` —— Chrome 把 `window`/`document`/`body`
     *    上的 `wheel` 当被动监听，`preventDefault()` 无效 ⇒ 拦不住系统缩放（同主视图那条注释）。
     * ⚠️ 参数写成数组 ⇒ 设置一变 Svelte 会**重建**这个 action（旧监听先 destroy），
     *    否则闭包里读到的永远是第一次渲染时的 `ctrlWheelZoom` / `posterColumns`。
     */
    function zoomWheel(node: HTMLElement, _deps: [boolean, number]) {
        const onWheel = (ev: WheelEvent) => {
            if (!ctrlWheelZoom) return;
            if (!ev.ctrlKey) return;
            ev.preventDefault();   // 拦系统页面缩放
            ev.stopPropagation();
            const now = Date.now();
            if (now - lastZoomAt < ZOOM_THROTTLE_MS) return;
            const dir: 'in' | 'out' = ev.deltaY < 0 ? 'in' : 'out';
            // 从**实际渲染的列数**起步（用户眼前那个数），读不到才回落设置值（与主视图同口径）
            const cur = measuredColumns(node) ?? posterColumns;
            const next = posterZoomColumns(cur, dir, POSTER_COLUMNS_MAX);
            if (next === normalizePosterColumns(cur, POSTER_COLUMNS_MAX)) return; // 已在边界 ⇒ no-op，不落盘
            lastZoomAt = now;
            onPosterZoom('custom', next, 'grid');
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return { destroy() { node.removeEventListener('wheel', onWheel); } };
    }

    /** 网格**当前实际列数**：读计算样式 `grid-template-columns` 的轨道数；读不到 → null（回落设置值） */
    function measuredColumns(node: HTMLElement): number | null {
        try {
            const tpl = getComputedStyle(node).gridTemplateColumns;
            if (!tpl || tpl === 'none') return null;
            const n = tpl.trim().split(/\s+/).length;
            return n > 0 ? n : null;
        } catch {
            return null;
        }
    }

    /** 两个网格共用的列模板（与 `MediaList` 的 `.rl-grid` 同一函数、同一密度/列数设置） */
    $: gridTemplate = posterGridTemplate(posterDensity, posterColumns);

    /* ── ④ 右键菜单：全仓唯一真源 `EntryContextMenu`（⛔ 别在本组件自造一套） ────── */
    let entryMenu: EntryContextMenu | null = null;
    let entryMenuOpen = false;

    async function openCtx(e: MediaEntry, ev: MouseEvent): Promise<void> {
        ev.preventDefault();
        ev.stopPropagation();
        await entryMenu?.openAt(e, ev);
    }

    $: totalShown = shownGroups.length;

    /**
     * ⚠️ 下拉回填写在这一层（不是模板里的内联箭头）：
     * ⑴ `MiniSelect.onPick` 给的是 `string`，模板里写 `(v) => (statusFilter = v as MediaStatus | 'all')`
     *    会让 Svelte 表达式解析器报 `Unexpected token` —— 类型断言在模板里不受支持。
     * ⑵ 归一必须过 `normalizeSortBy`（非法值回 `recent`），⛔ 别用裸赋值 `sortBy = v as SortBy`，
     *    否则一次脏值就能让整个排序栏选中项消失。
     */
    function pickStatus(v: string): void {
        statusFilter = v === 'all' ? 'all' : (v as MediaStatus);
    }

    function pickSort(v: string): void {
        sortBy = normalizeSortBy(v);
    }
</script>

<!-- 🔴🔴 2026-11-26（用户 m04553 / m04672）合集视图工具栏的最终口径：
     逐字：「合集视图的工具栏保持干净（视图下拉+搜索+添加）再留N个媒体，留更多菜单，筛选栏和排序栏」
     ⇒ 本行 = 左端「N 个媒体」+ 视图下拉 + 搜索框 + 添加 +（合并布局下）更多菜单。
     ⚠️ 「文字菜单」（`NavMenu` 那排页签文字）**不在合集视图出现** —— 用户明确要它干净；
        但顶栏布局（`navLayout === 'top'`）的页签栏在 `HomeView` 里，与这里无关，那条照常。
     类名与尺寸照 `MediaList` 的 `.rl-toolbar` / `.rl-search-wrap` / `.rl-search` / `.rl-libstats` /
     `.rl-add.mod-cta`，⛔ 别另起一套（两视图一切换就看得出粗细不一）。 -->
<div class="rl-toolbar">
    <!-- ② 左上角「N 个媒体」：与主视图 `.rl-libstats` 逐字同款（绝对定位贴最左，不挤占中间那组） -->
    <span class="rl-libstats" role="group" aria-label="库概览">
        <span class="rl-libstats-total">{viewCount}</span> {viewUnit}
    </span>
    <ViewChips {views} {activeViewId} {onPickView} />
    <div class="rl-search-wrap" class:has-dice={onOpenWhatToWatch && shouldShowWatchDice(searchText)} class:tools-hidden={!shouldShowWatchDice(searchText)}>
        <Icon icon="search" size={13} cls="rl-search-ico" />
        <!-- 🔴 与主视图同一条纪律：搜索框里的 Esc **只清空搜索、不透传** -->
        <input
            class="rl-search"
            type="search"
            placeholder="搜索合集或条目"
            bind:value={searchText}
            aria-label="搜索合集或条目"
            on:keydown={(ev) => { if (ev.key === 'Escape') { searchText = ''; ev.stopPropagation(); } }}
        />
        <!-- 🔴 m07854 ⑳ ①：右端**工具槽**（骰子 + 漏斗同槽）—— 与主视图 `MediaList.svelte` 逐字同款
             （⑥ 的 parity 口径）。⑳ ① 的两条裁定同步落在这里：漏斗搬进搜索框内、骰子换内置图标。
             ⚠️ 骰子不用 `🎲` emoji：全仓没有 dice 类图标（`dices` 不存在 ⇒ `setIcon` 静默不画），
                `shuffle` 是已实名可用且语义就是「随机」的那枚。 -->
        <span class="rl-search-tools">
            <!-- 🔴 m07854 ⑭：「今天看什么」骰子。
                 ⚠️ 两个视图的搜索框长得一样，只给一边加骰子会让「切视图时输入框右端多/少一枚」；
                    所以这里的条件、类名、`data-tip` 文案都与 `MediaList.svelte` 保持一致。
                 ⚠️ 判据同样走纯函数 `shouldShowWatchDice`（trim 后非空 = 在用搜索框 ⇒ 藏起来）。 -->
            {#if onOpenWhatToWatch && shouldShowWatchDice(searchText)}
                <button
                    class="rl-search-dice"
                    type="button"
                    data-tip="今天看什么？（从「想看」且评分 ≥ 4 的条目里随机抽一部）"
                    on:click={() => onOpenWhatToWatch?.()}>
                    <Icon icon="shuffle" size={14} />
                </button>
            {/if}
            <!-- 🔴 m07854 ⑮：「待补」漏斗 —— 与主视图 `.rl-incomplete` 逐字同款（⑥ 的 parity 口径：
                 两个视图切换时工具栏不该多/少一件）。判据与计数都在 `pure/incomplete`。
                 ⑳ ① 起它住在搜索框右端的工具槽里（用户：「这个待补图标放在首页搜索框内」）。
                 🔴 m13127 ②：输入文字搜索时与骰子一起让位（用户：「…在输入文字搜索时要隐藏，
                    没有文字时显示」）。判据复用 `shouldShowWatchDice`，⛔ 别另写一套。 -->
            {#if shouldShowWatchDice(searchText)}
                <button
                    class="rl-incomplete"
                    class:is-on={incompleteOnly}
                    type="button"
                    aria-pressed={incompleteOnly}
                    data-tip={incompleteTip(incompleteCount, incompleteOnly)}
                    on:click={() => (incompleteOnly = !incompleteOnly)}>
                    <Icon icon="filter" size={14} />
                </button>
            {/if}
        </span>
    </div>
    <button class="rl-add mod-cta" data-tip="新建条目" on:click={() => onAdd()}><Icon icon="plus" size={14} /> 添加</button>
</div>

<!-- 🔴 ⑤ 筛选栏 + 排序栏：状态下拉 + 排序下拉 —— **两枚**同款 MiniSelect。
     用户 m04672 点名「筛选栏和排序栏」都要留；m04553 点名按钮要「距形和筛选、排序相符」。
     🔴 2026-11-10（m02255 / m02674）：**「类型」与「题材」两枚一起下线**，原因见脚本里那段
        「为什么两维一起删」的注释 —— 题材的作用域本来就挂在类型上，类型没了它永远不渲染。
        剩下的两枚（状态 / 排序）与主视图仍是同一套 `MiniSelect` 形态，⛔ 别退回一排矩形按钮。 -->
<div class="rl-viewbar">
    <span class="rl-vb-select">
        <span class="rl-sel-label">状态</span>
        <MiniSelect
            value={statusFilter}
            options={statusOptions}
            ariaLabel="状态筛选"
            group={TOOLBAR_FILTER_GROUP}
            onPick={pickStatus} />
    </span>
    <span class="rl-vb-select">
        <span class="rl-sel-label">排序</span>
        <!-- 🔴 用户 m07854 ⑥：「排序下拉不要倒三角标」。
             与主视图 `MediaList.svelte` 的排序那枚同一口径（#572：排序的值自带 ↑/↓ 方向箭头，
             再画一枚 ▾ 就是两枚箭头叠在同一个框里）⇒ 传 `chevron={false}`。⛔ 别写回默认值。 -->
        <MiniSelect
            value={sortBy}
            options={sortSelOptions}
            ariaLabel="排序方式"
            chevron={false}
            group={TOOLBAR_FILTER_GROUP}
            onPick={pickSort} />
    </span>
</div>

<div class="rl-coll">
    {#if totalShown === 0}
        <div class="rl-coll-empty">
            {#if searchText.trim() || statusFilter !== 'all'}
                当前筛选下没有匹配的合集。清空搜索框或切回「全部」再试。
            {:else}
                这个合集视图里还没有条目。到条目的属性窗口填上「归属合集」就会出现。
            {/if}
        </div>
    {:else if activeGroup}
        <!-- ── 二级：某个合集内部 = 小标题 + 卡片网格 ───────────────────────── -->
        <div class="rl-coll-backbar">
            <button class="rl-coll-back" data-tip="回到合集海报墙" on:click={back}>
                <Icon icon="arrow-left" size={14} />
                <span>全部合集</span>
            </button>
            <span class="rl-coll-name">{activeGroup.name}</span>
            <span class="rl-coll-sub">{collectionSubtitleOf(activeGroup)}</span>
        </div>

        {#each activeGroup.rows as row (row.type)}
            <!-- 🔴 2026-11-26：小标题（「电影系列」这种）+ 其下卡片网格，与海报墙同一套卡 -->
            <div class="rl-coll-sec">
                <div class="rl-coll-rowhead">
                    <span class="rl-coll-rowtitle">{row.title}</span>
                </div>
                <div
                    class="rl-coll-wall"
                    use:zoomWheel={[ctrlWheelZoom, posterColumns]}
                    style={`grid-template-columns:${gridTemplate}`}>
                    {#each row.items as e (e.id)}
                        {@const cover = posterUrl(e)}
                        {@const playable = hasActionEntry(e) ? e : null}
                        <div
                            class="rl-card rl-coll-card"
                            role="button"
                            tabindex="0"
                            data-tip={`打开：${e.title}`}
                            on:click={() => onOpenEntry(e.id)}
                            on:contextmenu={(ev) => { releaseFocus(ev); void openCtx(e, ev); }}
                            on:keydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpenEntry(e.id); } }}>
                            {#if colorTheme === 'colorful'}
                                <div class="rl-type-bar" style={`background:${TYPE_COLORS[row.type]}`}></div>
                            {/if}
                            <div class="rl-cov-wrap">
                                {#if cover}
                                    <img
                                        class="rl-cov"
                                        src={cover}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        referrerpolicy={isDoubanImage(cover) ? 'unsafe-url' : undefined} />
                                {:else}
                                    <div class="rl-cov rl-cov-ph" style={`--h:${hash(e.id) % 360}${colorTheme === 'colorful' ? `;--tc:${TYPE_COLORS[row.type]}` : ''}`}><span>{e.title.slice(0, 2)}</span></div>
                                {/if}
                                <!-- 🔴 2026-11-26 用户：「合集卡内的卡片应该也和主视图交互操作一致才对
                                     而不是另做个右上角编辑属性图标」⇒ 这里**不再**有自造的小铅笔，
                                     编辑/摘抄/短评/攻略/删除全走右键菜单（`EntryContextMenu`，主视图同一份）。 -->
                                <div class="rl-cov-hover">
                                    <button
                                        class="rl-hover-open"
                                        data-tip={`打开：${e.title}`}
                                        on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onOpenEntry(e.id); }}>打开 ↗</button>
                                </div>
                                {#if playable}
                                    <button
                                        class="rl-watch-btn"
                                        class:rl-watch-play={actionIcon(row.type) === 'play'}
                                        data-tip={actionAriaLabel(row.type)}
                                        on:click={(ev) => { ev.stopPropagation(); onWatch(playable); }}>
                                        <Icon icon={actionIcon(row.type)} size={14} /><span class="rl-sr">{actionAriaLabel(row.type)}</span>
                                    </button>
                                {/if}
                            </div>
                            <div class="rl-card-meta">
                                <div class="rl-coll-capname">{e.title}</div>
                                <div class="rl-coll-capsub">{typeLabel(row.type)}</div>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    {:else}
        <!-- ── 一级：海报墙（一个合集一张卡 = 一个入口）──────────────────────
             🔴 卡片结构与 `MediaList` 的 `.rl-card`（系列折叠卡）**逐件同源**：
                类型色条 → `.rl-cov-wrap`（封面 / 占位）→ `.rl-cov-hover`（居中的「打开合集 ↗」）
                → 右下 `.rl-watch-btn` → `.rl-card-meta` 标题栏。
             🔴 2026-11-26 用户点名去掉：`×N` 角标、右键菜单与 `⋯`、信息栏副标题部数。 -->
        <div
            class="rl-coll-wall"
            use:zoomWheel={[ctrlWheelZoom, posterColumns]}
            style={`grid-template-columns:${gridTemplate}`}>
            {#each shownGroups as g (g.key)}
                {@const cover = coverOf(g)}
                {@const rt = repTypeOf(g)}
                {@const playable = firstActionable(g)}
                <div
                    class="rl-card rl-coll-card"
                    role="button"
                    tabindex="0"
                    data-tip={`进入合集：${g.name}`}
                    on:click={() => enter(g.key)}
                    on:contextmenu={releaseFocus}
                    on:keydown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); enter(g.key); } }}>
                    {#if colorTheme === 'colorful'}
                        <div class="rl-type-bar" style={`background:${TYPE_COLORS[rt]}`}></div>
                    {/if}
                    <div class="rl-cov-wrap">
                        {#if cover}
                            <img
                                class="rl-cov"
                                src={cover}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                referrerpolicy={isDoubanImage(cover) ? 'unsafe-url' : undefined} />
                        {:else}
                            <div class="rl-cov rl-cov-ph" style={`--h:${hash(g.key) % 360}${colorTheme === 'colorful' ? `;--tc:${TYPE_COLORS[rt]}` : ''}`}><span>{g.name.slice(0, 2)}</span></div>
                        {/if}
                        <!-- 悬停浮层：只剩居中「打开合集 ↗」（⋯ 已按 2026-11-26 用户要求删除） -->
                        <div class="rl-cov-hover">
                            <button
                                class="rl-hover-open"
                                data-tip={`打开合集：${g.name}`}
                                on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); enter(g.key); }}>打开合集 ↗</button>
                        </div>
                        <!-- 右下 ▶：播合集里第一个可播的（无可用入口则不渲染，与海报墙同规则） -->
                        {#if playable}
                            <button
                                class="rl-watch-btn"
                                class:rl-watch-play={actionIcon(rt) === 'play'}
                                data-tip={`${actionAriaLabel(rt)}（合集内第 1 个可播）`}
                                on:click={(ev) => { ev.stopPropagation(); onWatch(playable); }}>
                                <Icon icon={actionIcon(rt)} size={14} /><span class="rl-sr">{actionAriaLabel(rt)}</span>
                            </button>
                        {/if}
                    </div>
                    <!-- 信息栏只留合集名（⛔ 2026-11-26 用户点名隐藏部数副标题） -->
                    <div class="rl-card-meta">
                        <div class="rl-coll-capname">{g.name}</div>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- ④ 条目右键菜单：与 `MediaList` 用的是**同一个组件**（`EntryContextMenu`），
     ⛔ 别在这里再写一份菜单 —— 那正是用户 m04109 说的「另做一个」的毛病。 -->
<EntryContextMenu
    bind:this={entryMenu}
    bind:open={entryMenuOpen}
    {onWatch}
    {onQuickAssociate}
    {onEditEntry}
    {onAddExcerpt}
    {onOpenEntryLogModal}
    {onOpenEntryTextModal}
    {onDeleteEntry} />

<style>
    /* ── ⑤ 工具栏 / 筛选栏：类名与几何照 `MediaList`（那边是 Svelte scoped，跨组件用不到，只能照抄数值）
       🔴🔴 2026-11-08（用户 m03712 逐字）：「合集视图展示的搜索框和切换视图按钮位置怎么不居中啊
          （结构布局要和其他视图统一）」
       ⇒ 原来这里写的是 `justify-content: flex-start`，2026-11-26 那版理由（「多了视图胶囊，
          居中会让整组飘在中间」）**已被用户当场否掉**：他要的就是「和主视图一样居中」。
       ⚠️ 所以**必须**与 `MediaList.svelte` 的 `.rl-toolbar` 逐字同款（那边是 `center`）；
          ⛔ 别再按「这一行多了什么」去推导对齐方式 —— 两边的视觉一致性优先于局部观感。
       ⚠️ `flex-wrap: wrap` 保留（合集视图的搜索框 max-width 窄一些，窄屏会换行；
          主视图那份没有 wrap 是因为它没被压到过那个宽度）。 */
    /* 🔴🔴 2026-11-12（用户 m09565 ①-7）逐字：「合集视图的搜索栏和默认视图的筛选工具栏UI
       怎么不一套的，改成统一的」——真机量测出的**唯一**实质差异就在这里：
       · 默认视图 `.rl-toolbar`：`nowrap`，一行 32px（106+280+60+gap 合计 462 ≈ 容器 461，刚好装下）
       · 合集视图 `.rl-toolbar`：**`wrap`** ⇒ 同样那 4 个子项被判成「超出 1px」而折成**两行 72px**
       ⇒ 观感上「合集视图那行挤成两截」。已去掉 `flex-wrap`，与主视图逐字对齐。
       ⛔ 别再按「合集视图这一行多了视图下拉」去推导 wrap —— 那一枚主视图同样有。 */
    .rl-toolbar {
        display: flex; gap: 8px; align-items: center;
        justify-content: center; margin-bottom: 8px; position: relative;
    }
    .rl-toolbar button {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-muted);
        border-radius: var(--rl-t-radius-md, 6px); padding: 3px 10px; cursor: pointer;
    }
    /* 🔴 2026-11-08（用户 m03712：「结构布局要和其他视图统一」）：
       原来 `min-width: 200px`，而主视图 `MediaList.svelte` 的 `.rl-toolbar .rl-search-wrap`
       是 `240px`。搜索框是同一件东西在两种视图里各写一份 scoped 样式 —— 数值必须逐字对齐，
       否则切换视图时输入框会「跳一下宽度」。⛔ 改一处就要改另一处。
       🔴 m07854 ⑪ ③：宽度改成可收缩（`flex: 0 1 280px` + `min-width: 160px`），
       窄窗口下搜索框跟着让位，不再把工具栏挤到出横向滚动条。⛔ 仍与主视图逐字一致。 */
    .rl-search-wrap { position: relative; flex: 0 1 280px; width: 280px; max-width: 320px; min-width: 160px; }
    .rl-toolbar :global(.rl-search-ico) {
        position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
        color: var(--text-faint); pointer-events: none;
    }
    .rl-search {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal);
        border-radius: var(--rl-t-radius-md, 6px);
        /* 右侧 30px 给搜索框内那枚漏斗留位（与左侧 27px 放大镜对称）。⛔ 必须与
           `MediaList.svelte` 的 `.rl-toolbar .rl-search` 逐字一致，否则切视图输入框会跳。
           ⚠️ 骰子也在右侧时由 `.rl-search-wrap.has-dice .rl-search` 追加到 52px
              （两枚 22px + 缝 + 贴边）；这里保留**单枚**口径，⛔ 别写死 52px ——
              骰子按 `shouldShowWatchDice` 时隐时现，写死会在它隐藏时白留一条。 */
        padding: 5px 30px 5px 27px; width: 100%;
    }
    .rl-search:focus { outline: none; border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-search::placeholder { color: var(--text-faint); }
    /* 🔴 m07854 ⑳ ①：搜索框右端的**工具槽**（骰子 + 漏斗同槽横排）—— 与主视图逐字同款。
       为什么是槽而不是两枚各自绝对定位：骰子会随输入时隐时现，两枚各钉 `right` 时
       漏斗要么被骰子压住、要么骰子消失后留个空位；同槽 `right: 4px` + `gap: 2px`
       才能让它们在两种状态下都贴齐右端。 */
    .rl-toolbar .rl-search-tools {
        position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
        display: inline-flex; align-items: center; gap: 2px;
    }
    /* 骰子在场时右内距加宽到 52px（两枚 22px + 2px 缝 + 4px 贴边 + 2px 余量）。
       ⚠️ 判据挂在 `.rl-search-wrap.has-dice` 上（模板里由 `shouldShowWatchDice` 给）——
          ⛔ 别在 CSS 里猜图标数量。 */
    .rl-search-wrap.has-dice .rl-search { padding-right: 52px; }
    /* 🔴 m13127 ②：**输入文字搜索时两枚图标都让位** ⇒ 右内距跟着收回去（与主视图逐字同款）。
       ⚠️ 单靠 `{#if}` 藏按钮会留一块没有图标的空白，长关键词能用宽度被白吃。
       ⚠️ 判据与模板同一个 `shouldShowWatchDice`，⛔ 别用 `:not(:placeholder-shown)`。 */
    .rl-search-wrap.tools-hidden .rl-search { padding-right: 12px; }
    /* 🔴 m07854 ⑭：「今天看什么」骰子（无边框透明化）—— **与主视图逐字同款**。
       🔴 m07854 ⑳ ①：图标换成内置 lucide `shuffle`（用户：「不要 emoji 图标，改成 Ob 对应的图标」）。
          全仓没有 dice 类图标（`dices` 实测不存在 ⇒ `setIcon` 静默不画、按钮变空白）。
       ⚠️ 两处都必须存在，否则切视图时输入框右端会多/少一枚按钮。
       ⚠️ 宿主 `button:not(.clickable-icon)` 的 (0,1,1) 灰底压得过单类选择器 ⇒ 这里同样写两级
          （`.rl-toolbar .rl-search-dice`），本仓老坑 `src/modals/ReaderPanelBase.ts:1633`。 */
    .rl-toolbar .rl-search-dice {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0; margin: 0;
        border: 0; border-radius: var(--rl-t-radius-sm, 4px);
        background: transparent; box-shadow: none;
        line-height: 1; cursor: pointer;
        color: var(--text-muted); opacity: .8;
    }
    .rl-toolbar .rl-search-dice:hover { opacity: 1; color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .rl-toolbar .rl-search-dice:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    /* 🔴 m07854 ⑮ / ⑳ ①：「待补」漏斗 —— **与主视图逐字同款**（同样必须两级选择器压过宿主灰底）。
       ⑳ ① 起住在搜索框右端的工具槽里 ⇒ 不再是独立 flex 项，尺寸改成与骰子同款 22×22
       （两枚同高才在一条线上；原来那套 `height: var(--input-height)` 是作为工具栏按钮时的尺子）。 */
    .rl-toolbar .rl-incomplete {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0; margin: 0;
        border: 0; border-radius: var(--rl-t-radius-sm, 4px);
        background: transparent; box-shadow: none;
        font-family: inherit; cursor: pointer;
        color: var(--text-muted); opacity: .85;
    }
    .rl-toolbar .rl-incomplete:hover { opacity: 1; color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .rl-toolbar .rl-incomplete.is-on { color: var(--interactive-accent); opacity: 1; }
    .rl-toolbar .rl-incomplete:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    .rl-toolbar .rl-add.mod-cta {
        background: var(--interactive-accent) !important;
        border-color: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
        font-weight: 600; flex: none;
    }

    /* ② 左上角「N 个媒体」：与主视图 `.rl-toolbar .rl-libstats` 逐字同款
       （绝对定位贴最左 / 10.5px / `--text-faint` / 数字加粗用 `--text-muted`）。
       ⚠️ 靠 `left:0` 钉在最左 ⇒ 中间那组（视图下拉 + 搜索 + 添加）的视觉重心不变。 */
    .rl-libstats {
        position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        display: inline-flex; align-items: center; gap: 5px; flex: none;
        white-space: nowrap; font-size: 10.5px; color: var(--text-faint);
    }
    .rl-libstats-total { font-weight: 600; color: var(--text-muted); }

    /* 🔴 m07854 ⑳ ②：**窄窗下工具栏重排** —— 与主视图 `MediaList.svelte` 逐字同款。
       真因：这一行是「左端库概览（`absolute; left: 0`）+ 居中那组 + 右端导航入口
       （`absolute; right: 0`）」—— 两个绝对定位的端头**不参与居中那组的让位计算**，
       窄到一定程度就和居中的搜索框顶在一起（视觉上就是「压住了」）。
       ⇒ 窄窗改成**两行流式**：第一行只有库概览（静态、独占一行、可省略号），第二行是
         居中那组（视图下拉 + 搜索 + 添加）。⛔ 不用 `overflow: hidden` 切掉内容 ——
         切掉才是真的「没跟着调整」。
       ⚠️ 阈值 760px 与主视图一致（两视图切换时不该出现「一边重排一边不重排」）。 */
    @media (max-width: 760px) {
        .rl-toolbar { flex-wrap: wrap; row-gap: 6px; }
        .rl-libstats {
            position: static; transform: none; order: -1;
            flex: 1 0 100%; justify-content: flex-start;
            overflow: hidden; text-overflow: ellipsis;
        }
        .rl-search-wrap { flex: 0 1 280px; }
    }

    .rl-viewbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    /* 🔴 2026-11-26（m05012）：类型筛选改成下拉后，`.rl-vb-group` 那排矩形按钮的整套样式**已删除** ——
       留着会报 `Unused CSS selector` 顶破「89 warnings = 基线」那条门禁，也留着会诱使人再写回去。
       ⛔ 别再补回来：这一行现在只有三枚同款 MiniSelect（类型 / 状态 / 排序）。 */
    /* 🔴 `.rl-vb-select` 现在是「标签 + MiniSelect」的**包裹 span**（不再是原生 `<select>`），
       ⇒ 自身不能再有边框/内边距（否则会套一个方框在 MiniSelect 外面）。
       与 `MediaList.svelte:3843` 那条同款：只负责横排与间距。 */
    .rl-vb-select { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
    .rl-sel-label { font-size: 10px; color: var(--text-faint); white-space: nowrap; }

    .rl-coll { display: flex; flex-direction: column; gap: 10px; }
    .rl-coll-empty { padding: 28px 12px; text-align: center; font-size: 13px; color: var(--text-muted); }

    /* ── 卡片网格 ──────────────────────────────────────────────────────────
       ⚠️ 列模板由内联 `style` 给（`posterGridTemplate`，与主视图同一函数、同一设置），
          这里的兜底与「标准」档产物一致 —— 内联 style 缺席时退回历史观感，而不是塌成单列。
       🔴 一级海报墙与二级类型分段**共用这一条**，⛔ 别给二级另立一套网格。 */
    .rl-coll-wall {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
        gap: 12px;
        align-items: stretch;
    }

    /* 卡片骨架（照搬 MediaList 的 `.rl-card`）：圆角 + 边框 + overflow hidden + hover 抬起。
       🔴 2026-11-26 **刻意不写 `transition`** —— 用户逐字「鼠标滑过的动效怎么不和主视图一致的改回来」。
          主视图 `.rl-card`（`MediaList.svelte:4046`）**没有** transition，抬升/阴影是**瞬时**的；
          这里原先自己加了 `transition: box-shadow .15s ease, transform .15s ease` ⇒ 滑过时明显更"肉"，
          两视图切换一眼就看出不一样。⛔ 别再加回来：要改动效就改主视图那一处，两边一起动。 */
    .rl-card {
        background: var(--background-primary);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-card-radius, var(--rl-t-radius-lg, 8px));
        overflow: hidden; cursor: pointer; position: relative;
        display: flex; flex-direction: column;
    }
    .rl-card:hover {
        box-shadow: var(--rl-t-shadow-card-hover, 0 2px 8px rgba(0, 0, 0, .12));
        transform: translateY(var(--rl-t-lift, 0px)) scale(var(--rl-t-scale, 1));
    }

    .rl-type-bar { height: 4px; flex: none; }

    .rl-cov-wrap { position: relative; }
    .rl-cov { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--background-secondary); flex-shrink: 0; }
    .rl-cov-ph {
        display: flex; align-items: flex-end; justify-content: flex-start; padding: 6px;
        font-size: 12px; color: #fff; background: hsl(var(--h) 40% 45%);
    }
    .rl-cov-ph[style*="--tc"] { background: var(--tc); }

    /* 悬停遮罩 + 居中的「打开 ↗」（与 MediaList 逐字同款）。
       ⚠️ `:focus-within` 那条**不能删** —— 键盘用户靠它看见「打开 ↗」；
          右键后遮罩卡住的问题由 `releaseFocus()` 主动 blur 解决，⛔ 别从这里下手。 */
    .rl-cov-hover {
        position: absolute; inset: 0; z-index: 6;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .38);
        opacity: 0; transition: opacity .18s ease;
    }
    .rl-card:hover .rl-cov-hover, .rl-card:focus-within .rl-cov-hover { opacity: 1; }
    .rl-hover-open {
        font-family: inherit; font-size: 12px; font-weight: 600;
        border: none; cursor: pointer; box-shadow: none; background: transparent; color: #fff;
        border-radius: 0; padding: 7px 14px; line-height: 1;
    }
    .rl-hover-open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

    /* 右下 ▶ 播放钮（与 MediaList `.rl-watch-btn` 同款） */
    .rl-watch-btn {
        position: absolute; right: 8px; bottom: 8px; z-index: 7;
        width: 32px; height: 32px; border-radius: 50%;
        border: none; cursor: pointer;
        background: var(--interactive-accent); color: #fff;
        font-size: 13px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
        opacity: 0; transition: opacity .18s ease, transform .15s ease;
    }
    /* ▶ 视觉重心偏左 → 播放类图标补 2px 左内距（书籍等居中图标不加） */
    .rl-watch-btn.rl-watch-play { padding-left: 2px; }
    .rl-card:hover .rl-watch-btn, .rl-card:focus-within .rl-watch-btn { opacity: 1; }
    .rl-watch-btn:hover { transform: scale(1.12); }

    /* 标题栏 */
    .rl-card-meta {
        padding: 7px 8px; flex: 1 1 auto;
        display: flex; flex-direction: column; gap: 1px; min-width: 0;
    }
    .rl-coll-capname {
        font-size: 12.5px; font-weight: 600; color: var(--text-normal);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .rl-coll-capsub {
        font-size: 11px; color: var(--text-faint);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* 屏幕阅读器专用（▶ 里的隐藏文案） */
    .rl-sr {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }

    /* ── 二级：返回栏 + 类型分段 ─────────────────────────────────────────── */
    .rl-coll-backbar { display: flex; align-items: center; gap: 8px; padding: 2px 0 2px; }
    .rl-coll-back {
        display: inline-flex; align-items: center; gap: 4px; flex: none;
        border: 1px solid var(--background-modifier-border); border-radius: 6px;
        background: transparent; color: var(--text-muted);
        font-family: inherit; font-size: 12px; padding: 3px 8px; cursor: pointer;
    }
    .rl-coll-back:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-coll-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-coll-sub { flex: none; font-size: 11.5px; color: var(--text-muted); }

    /* 类型分段：小标题 + 网格（段与段之间留白，网格内部靠 gap） */
    .rl-coll-sec { display: flex; flex-direction: column; gap: 6px; }
    .rl-coll-sec + .rl-coll-sec { margin-top: 6px; }
    .rl-coll-rowhead { display: flex; align-items: baseline; gap: 6px; padding: 2px 0 0; }
    .rl-coll-rowtitle { font-size: 12px; font-weight: 600; color: var(--text-muted); }
</style>
