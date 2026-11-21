<script lang="ts">
    // 系列卡「编辑系列属性」弹窗的**内容组件**（m07813②）。
    //
    // 🔴 用户原话（m07813，逐字）：「给系列卡也做一个编辑属性窗口（同时右键菜单的改系列名、批量填合集、
    //    批量填标签收进编辑系列属性页面内。同单击单卡卡片网格信息栏逻辑一样，单击系列卡信息栏也打开编辑属性窗口）」
    //
    // 🔴 2026-11-15 用户第二次裁定（**推翻上一版「右键保留 + 窗口里再给一份」**，逐字）：
    //    「还是将改系列名、排序号、批量填合集、批量填标签放进编辑系列属性页面窗口里较好，
    //      删除右键菜单和其单独改的入口和页面」
    //    ⇒ 改名 / 排序号 / 批量填合集 / 批量填标签**只在这里**（那四个独立弹窗已整体删除）。
    //    ⚠️ 第五轮 ask_user_question 又裁定「右键菜单保留，只留这一条」——那条指的是**批量关联**
    //      （它是逐条清单，不是这四件批量操作），所以右键菜单现在只有「批量关联」一条。
    //
    // ⚠️ 本组件**只画内容** —— 弹窗外壳 / 遮罩 / Esc / 点外面关闭由 `modals/SeriesPropsModal`（宿主 `Modal`）提供，
    //    ⛔ 别在这里写 `position: fixed` 或自造遮罩（照抄原 `SeriesReorder.svelte` 的壳约定）。
    // ⚠️ 落库全在宿主（`plugin.service` / `plugin.bulk*`）：组件只回传「用户想改成什么」，不碰 plugin。
    // ⚠️ 排序算法在纯模块 `pure/seriesGroup.moveItem`（可单测），本组件只管「取下标 → 调它 → 换 order」。
    //
    // 🔴🔴 2026-11-16 用户第三次裁定（逐字）：「编辑属性 UI 应该和单卡编辑属性 UI 风格一致」
    //    ⇒ 本组件与 `EntryForm.svelte` **视觉语言对齐**（⛔ 不搬全量表单、⛔ 不复用 EntryForm 组件）：
    //      · 标签行：11px / 600 / `--text-muted` / 上 9px 下 4px（照抄 `.rl-lbl`）
    //      · 输入框：12px / padding 5px 9px / radius 6px（照抄 `.rl-input`）
    //      · 评分：**半星 + 10 分制**（照抄 `.rl-stars-input` 与 `onStarClick`/`setStar` 那套判定，
    //        判定本身仍调 `pure/rating.isHalfStarClick`，⛔ 别在本组件里另写一份「左半边」算法）
    //      · 标签/合集这类「一串值」用**胶囊**呈现（照抄 `.rl-chip` 的皮肤，⛔ 不 import 那个类名）
    //    ⚠️ 五个字段一个都没增删（系列名 / 评分 / 归属合集 / 标签 / 成员排序）。
    import { moveItem } from 'pure/seriesGroup';
    import { isHalfStarClick, normalizeRating, ratingToTenths, stepRating, tenthsToRating } from 'pure/rating';

    /** 一行成员（封面由宿主解析好传进来 —— 组件不碰 `plugin.resolvePoster`） */
    type MemberRow = { id: string; title: string; sub?: string; poster?: string };

    export let title = '';
    /** 组类型中文（电影 / 剧集 / 小说…），用于副标题 */
    export let typeLabel = '';
    export let members: MemberRow[] = [];
    /** 当前系列名（`group.name`，不含类型前缀） */
    export let name = '';
    /** 当前合集评分（0 = 未评分）；范围 0~5、半星 */
    export let rating = 0;
    /** 当前合集名（组内首个非空，供「批量填合集」预填） */
    export let collection = '';
    /** 当前标签并集（只做展示提示，供「批量填标签」预填空串） */
    export let tagsHint = '';

    /** 改系列名（整组） */
    export let onRename: (next: string) => void = () => {};
    /** 改合集分（0 = 清空） */
    export let onRate: (next: number) => void = () => {};
    /** 批量填合集（覆盖语义，空串 = 清空） */
    export let onSetCollection: (next: string) => void = () => {};
    /** 批量追加标签（逗号分隔） */
    export let onAddTags: (raw: string) => void = () => {};
    /** 保存排序：回传**新顺序的 id 列表**（编号由宿主算 —— `planSeriesReindexAll`） */
    export let onReorder: (ids: string[]) => void = () => {};
    /** 跳「批量关联」逐条清单（那是逐条操作，不在本窗口内做） */
    export let onAssociate: () => void = () => {};
    /**
     * 当前是否「隐藏此系列卡片」（m03458，用户 2026-11-21 逐字：
     * 「在右上角加个『[复选框]隐藏此系列卡片』就只隐藏该系列封面和此信息栏，里面的系列条目不受影响」）。
     * ⚠️ 这是**系列级**标记（`Catalog.seriesHidden`），⛔ 与单条 `MediaEntry.cardHidden` 无关。
     */
    export let hiddenCard = false;
    /** 勾/取消「隐藏此系列卡片」（落库在宿主，组件只回传意图） */
    export let onToggleHidden: (next: boolean) => void = () => {};
    // ⚠️ m03458：原有的 `onClose` prop 已删除 —— 底部那枚「关闭」按钮与宿主 Modal 自带的关闭钮
    //    逻辑重复（`SeriesPropsModal.ts` 文件头第 19 行早已立规「⛔ 别自绘第二枚关闭钮」）。
    //    ⛔ 别因为「组件不该知道怎么关自己」就把它加回来：关窗由宿主 `Modal` 全权负责。

    // ── 表单本地状态 ──
    let nameDraft = name;
    let collectionDraft = collection;
    let tagsDraft = '';
    /** 10 分制输入框是否展开（点数值切换，照抄 EntryForm 的 `startRatingEdit` 手感） */
    let ratingEditing = false;
    let ratingInputEl: HTMLInputElement | null = null;

    /** 星标：0 表示未评分（渲染成空心）；点同一颗已选的星 = 清空 */
    const STARS = [1, 2, 3, 4, 5];
    /**
     * 点星（#619 半星口径，与 `EntryForm.setStar` 同一套）：
     * · 左半边 ⇒ `n - 0.5`（半星）；右半边 ⇒ `n`（整星）
     * · 点**同一个当前值** ⇒ 清回 0（保留「再点一下取消」的手感）
     * 🔴 半星判定调 `pure/rating.isHalfStarClick`（纯函数、有单测）—— ⛔ 别在这里手写 `offsetX * 2 < width`。
     */
    function pickStar(ev: MouseEvent, n: number): void {
        const el = ev.currentTarget as HTMLElement;
        const half = isHalfStarClick(ev.offsetX, el.offsetWidth);
        const next = normalizeRating(half ? n - 0.5 : n);
        onRate(rating === next ? 0 : next);
    }
    /** 键盘等价物：Enter / 空格按**整星**处理（读屏与纯键盘用户够得着半星靠数值框） */
    function pickStarKey(n: number): void {
        const next = normalizeRating(n);
        onRate(rating === next ? 0 : next);
    }
    /** 滚轮增减一档（`RATING_STEPS` 是唯一档位表）；必须 `preventDefault` 否则弹窗跟着滚 */
    function onStarWheel(ev: WheelEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        onRate(stepRating(normalizeRating(rating), ev.deltaY < 0 ? 1 : -1));
    }
    /** 点数值 ⇒ 展开 10 分制输入框并聚焦全选 */
    function startRatingEdit(): void {
        ratingEditing = true;
        queueMicrotask(() => {
            if (ratingInputEl) {
                ratingInputEl.focus();
                ratingInputEl.select();
            }
        });
    }
    /** 输入框落回存储（÷2：10 分制 → 半星）；清空 ⇒ 归 0 */
    function commitRatingEdit(v: string): void {
        ratingEditing = false;
        const n = Number(v);
        const next = Number.isFinite(n) && v.trim() !== '' ? tenthsToRating(n) : 0;
        if (next !== normalizeRating(rating)) onRate(next);
    }

    function submitName(): void {
        const next = nameDraft.trim();
        if (!next || next === name) return;
        onRename(next);
    }
    function submitCollection(): void {
        const next = collectionDraft.trim();
        onSetCollection(next);
    }
    function submitTags(): void {
        const raw = tagsDraft.trim();
        if (!raw) return;
        onAddTags(raw);
        tagsDraft = '';
    }
    /** 点击只读胶囊 ⇒ 直接追加那一条（把 `tagsHint` 那串提示变成可点的快捷入口） */
    function addTag(t: string): void {
        onAddTags(t);
    }
    /** 组内现有标签拆成胶囊（`tagsHint` 是宿主拼好的「a、b、c」，本条只做展示拆分） */
    $: tagChips = tagsHint
        ? tagsHint.split('、').map((s) => s.trim()).filter((s) => s.length > 0)
        : [];

    // ── 排序（原「排序号」弹窗搬进来） ──
    // 🔴 当前顺序（拖拽唯一的可变状态）。⚠️ 整体换新数组 ⇒ Svelte 才看得见（本仓 `openGroupKeys` 同款纪律）
    let order: string[] = members.map((m) => m.id);
    /** 正在拖的那条 / 落点那条（都按 id 记，⛔ 不按下标 —— 拖动过程中下标会变） */
    let dragId: string | null = null;
    let overId: string | null = null;

    $: byId = new Map(members.map((m) => [m.id, m]));
    /** 渲染行 = 按 `order` 取回对象（查不到的自动跳过：组一变就自然消失，不残留脏行） */
    $: rows = order.map((id) => byId.get(id)).filter((x): x is MemberRow => !!x);
    /** 顺序是否被改过（只有改过才让「保存排序」可点，⛔ 别让用户以为必须点一下才算数） */
    $: orderDirty = order.join('\u0001') !== members.map((m) => m.id).join('\u0001');

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
     * 🔴 为什么必须有：拖拽是**纯指针**操作，键盘用户与读屏用户否则完全够不着这个功能；
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
            const el = document.querySelector(`.rl-sr-row[data-id="${id}"]`);
            if (el instanceof HTMLElement) el.focus();
        });
    }
    function saveOrder(): void {
        onReorder([...order]);
    }

    /** 成员清单收起/展开（组大时默认张开，超过 8 条才收） */
    let listOpen = true;
    $: listCollapsible = members.length > 8;
</script>

<!-- 🔴 m03458（用户 2026-11-21 逐字）：「再在右上角加个『[复选框]隐藏此系列卡片』就只隐藏该系列
     封面和此信息栏，里面的系列条目不受影响」⇒ 复选框挂在标题行**右侧**（与本弹窗无关的其它控件都往下走）。
     ⚠️ 语义只是**模糊化**（用户追加澄清「就像单卡那样」）：模糊封面 + 信息栏打码，
        ⛔ 不是把卡片藏掉，也⛔ 不碰组内条目自己的卡片。 -->
<div class="rl-sp-head">
    <h2 class="rl-sp-title">编辑系列属性</h2>
    <label class="rl-sp-hidecard" title="只把这张系列卡的封面打模糊、信息栏打码；里面的条目照常显示">
        <input type="checkbox" bind:checked={hiddenCard} on:change={() => onToggleHidden(hiddenCard)} />
        隐藏此系列卡片
    </label>
</div>
<div class="rl-sp-sub">{title}{typeLabel ? ` · ${typeLabel}` : ''} · 共 {members.length} 部</div>

<!-- 🔴 用户 2026-11-21（逐字）：「系列卡编辑属性窗口把改成两两并排，依次是改系列名、改合集评分、
     改归属合集、改归属标签」⇒ 前四段排成 2×2：左列第 1、3 段，右列第 2、4 段，阅读顺序（先行后列）
     恰是用户点名的顺序。成员清单仍独占整行。
     ⚠️ 段序就是用户点名的顺序，⛔ 别按「输入类排前、控件类排后」重排 —— 那会打乱用户给的次序。 -->
<div class="rl-sp-grid">
<!-- ① 系列名（整组一起改） -->
<div class="rl-sp-sec">
    <label class="rl-sp-lbl" for="rl-sp-name">系列名</label>
    <div class="rl-sp-row">
        <input
            id="rl-sp-name"
            class="rl-sp-input"
            bind:value={nameDraft}
            placeholder="这个系列叫什么"
            on:keydown={(ev) => { if (ev.key === 'Enter') submitName(); }} />
        <button
            class="rl-sp-btn mod-cta"
            disabled={!nameDraft.trim() || nameDraft.trim() === name}
            on:click={submitName}>改名</button>
    </div>
    <div class="rl-sp-hint">会把这 {members.length} 部的系列名一起改掉；组成员与序号不变，合集分会跟着搬到新名字下。</div>
</div>

<!-- ② 合集评分（系列分）—— 半星 + 10 分制，皮肤同单卡编辑属性 -->
<div class="rl-sp-sec">
    <span class="rl-sp-lbl">合集评分</span>
    <!-- 🔴 每颗星分**左右两半**：左 = 半星、右 = 整星；数值按 10 分制显示（`9/10` ⟷ `4.5 星`），
         点它切成输入框；滚轮在星上增减并阻止弹窗滚动。半星用**伪元素裁切左半**渲染
         （⛔ 不用 U+2BE8 字符：字体覆盖不稳，实测渲染成残缺星块）。 -->
    <div class="rl-sp-stars" role="group" aria-label="合集评分" on:wheel={onStarWheel}>
        {#each STARS as s (s)}
            <span
                class="rl-sp-star"
                class:is-on={s <= rating}
                class:is-half={s - 0.5 === rating}
                role="button"
                tabindex="0"
                data-tip={rating === s ? '再点一次清空' : `${s - 0.5} 星`}
                on:click={(ev) => pickStar(ev, s)}
                on:keydown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickStarKey(s); }
                }}>★<span class="rl-sr">{s - 0.5} 星</span></span>
        {/each}
        {#if ratingEditing}
            <input
                class="rl-sp-num"
                type="number"
                step="1"
                min="0"
                max="10"
                bind:this={ratingInputEl}
                value={ratingToTenths(normalizeRating(rating))}
                on:input={(ev) => { const t = Number(ev.currentTarget.value); if (Number.isFinite(t)) onRate(tenthsToRating(t)); }}
                on:blur={(ev) => commitRatingEdit(ev.currentTarget.value)}
                on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commitRatingEdit(ev.currentTarget.value); } }}
                aria-label="合集评分（10 分制）" />
            <span class="rl-sp-suffix">/10</span>
        {:else}
            <button class="rl-sp-stars-val" on:click={startRatingEdit}>
                {rating > 0 ? `${ratingToTenths(normalizeRating(rating))}/10` : '未评分'}
            </button>
        {/if}
    </div>
    <!-- ⚠️ 原写 `**整组**` / `**覆盖**` / `**追加**`：模板里是纯文本，Markdown 的 `**` **不会**变粗，
         页面上就是字面带星号。本行起改用 `<strong>`。 -->
    <div class="rl-sp-hint">这是<strong>整组</strong>的分（独立字段），不是组内平均分；左半边点 = 半星，再点当前档位可清空。</div>
</div>

<!-- ③ 批量填合集（覆盖） -->
<div class="rl-sp-sec">
    <label class="rl-sp-lbl" for="rl-sp-coll">归属合集</label>
    <div class="rl-sp-row">
        <input
            id="rl-sp-coll"
            class="rl-sp-input"
            bind:value={collectionDraft}
            placeholder="例如：熊出没（留空 = 清空）"
            on:keydown={(ev) => { if (ev.key === 'Enter') submitCollection(); }} />
        <button class="rl-sp-btn" on:click={submitCollection}>填入</button>
    </div>
    <div class="rl-sp-hint"><strong>覆盖</strong>语义：组内每一部统一成同一个值（不是追加）。填了才会出现在合集视图里。</div>
</div>

<!-- ④ 批量追加标签 -->
<div class="rl-sp-sec">
    <label class="rl-sp-lbl" for="rl-sp-tags">追加标签</label>
    {#if tagChips.length}
        <!-- 组内现有标签：只读胶囊（点击即追加该条，省一次手打） -->
        <div class="rl-sp-chips" role="group" aria-label="组内现有标签，点击追加">
            {#each tagChips as t (t)}
                <button class="rl-sp-chip" type="button" data-tip={`追加标签「${t}」`} on:click={() => addTag(t)}>{t}</button>
            {/each}
        </div>
    {/if}
    <div class="rl-sp-row">
        <input
            id="rl-sp-tags"
            class="rl-sp-input"
            bind:value={tagsDraft}
            placeholder="多个用逗号分隔，例如：工作, 日常"
            on:keydown={(ev) => { if (ev.key === 'Enter') submitTags(); }} />
        <button class="rl-sp-btn" disabled={!tagsDraft.trim()} on:click={submitTags}>追加</button>
    </div>
    <div class="rl-sp-hint"><strong>追加</strong>语义：已有标签全部保留，只多几个。{tagsHint ? '（上方胶囊即组内现有标签）' : ''}</div>
</div>
</div>

<!-- ⑤ 排序号（原独立弹窗搬进来：就地拖动 + 保存）+ 成员清单 + 批量关联入口 -->
<div class="rl-sp-sec">
    <div class="rl-sp-row">
        <span class="rl-sp-lbl">组成员（{members.length}）· 拖动排序</span>
        <span class="rl-sp-grow"></span>
        <button class="rl-sp-btn" on:click={onAssociate} data-tip="打开逐条关联清单（每一条单独选关联对象）">批量关联…</button>
        <button class="rl-sp-btn mod-cta" disabled={!orderDirty} on:click={saveOrder} data-tip="按当前列表顺序重编 1、2、3…">保存排序</button>
        {#if listCollapsible}
            <button class="rl-sp-btn" on:click={() => (listOpen = !listOpen)}>{listOpen ? '收起' : '展开'}</button>
        {/if}
    </div>
    <div class="rl-sp-hint">拖左侧把手调整先后；「保存排序」按现在的顺序重编 1、2、3…（键盘：聚焦某行按 ↑ / ↓）。</div>
    {#if !listCollapsible || listOpen}
        <!-- 🔴 `role="listbox"` + 每行 `role="option"`：**可聚焦、可键盘操作**的列表语义
             （⛔ 别用 `role="list"` / `role="listitem"` —— 那是**非交互**语义，配 `tabindex="0"` 会触发
              Svelte 的两条 a11y 告警，直接顶破 89 条 warning 基线）。 -->
        <div class="rl-sp-list" role="listbox" aria-label={`${title || '系列'}的组成员（拖动排序）`}>
            {#each rows as m, i (m.id)}
                <div
                    class="rl-sr-row"
                    class:is-dragging={dragId === m.id}
                    class:is-dropBefore={!!dragId && overId === m.id && dragId !== m.id}
                    data-id={m.id}
                    role="option"
                    aria-selected="false"
                    tabindex="0"
                    draggable="true"
                    data-tip="拖动排序（键盘：↑ / ↓）"
                    on:dragstart={(ev) => onDragStart(ev, m.id)}
                    on:dragover={(ev) => onDragOver(ev, m.id)}
                    on:drop={(ev) => onDrop(ev, m.id)}
                    on:dragend={onDragEnd}
                    on:keydown={(ev) => onKeydown(ev, m.id)}>
                    <span class="rl-sr-handle" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                            ><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" /></svg>
                    </span>
                    {#if m.poster}
                        <img class="rl-sp-cov" alt="" src={m.poster} loading="lazy" />
                    {:else}
                        <span class="rl-sp-cov rl-sp-cov-ph"></span>
                    {/if}
                    <span class="rl-sp-txt">
                        <span class="rl-sp-name">{m.title}</span>
                        {#if m.sub}<span class="rl-sp-msub">{m.sub}</span>{/if}
                    </span>
                    <span class="rl-sr-idx">{i + 1}</span>
                </div>
            {/each}
        </div>
    {/if}
</div>

<!-- 🔴 m03458：底部「关闭」按钮已删除（用户逐字：「底部的『关闭』按钮删除掉（逻辑重复了）」）。
     宿主 `Modal` 自带关闭钮 + Esc + 点遮罩三条路，本组件再画一枚纯属重复。
     ⛔ 别以「组件自给自足」为理由加回来，也别新增 `onClose` prop —— 关窗是宿主的职责。 -->

<style>
    /* 本组件挂在宿主 `Modal` 里（DOM-API 弹窗），但它是 Svelte 组件 ⇒ scoped 样式照常生效
       （与 `SeriesPicker.svelte` 同款）。⛔ 别搬到 styles.css 做全局兜底。 */
    /* 标题行：标题在左、「隐藏此系列卡片」复选框在右（m03458，用户要求「右上角」）。 */
    .rl-sp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 0 2px;
    }
    .rl-sp-title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-normal);
    }
    /* 复选框皮肤照抄 `EntryForm.svelte` 的 `.rl-cardhidden`（11px / `--text-muted` / 悬停转正常色），
       ⛔ 别另造一套尺寸，那就是「与单卡编辑属性 UI 风格一致」这条纪律要挡的漂移。 */
    .rl-sp-hidecard {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
        font-size: 11px;
        color: var(--text-muted);
        cursor: pointer;
        user-select: none;
    }
    .rl-sp-hidecard input { margin: 0; }
    .rl-sp-hidecard:hover { color: var(--text-normal); }
    .rl-sp-sub { font-size: 11.5px; color: var(--text-muted); margin-bottom: 12px; }
    /* 🔴 用户 2026-11-21：「改成两两并排」⇒ 前四段 2×2。阅读顺序（先行后列）= 用户点名的次序：
       系列名 / 合集评分 / 归属合集 / 追加标签。
       ⚠️ 分隔线必须**重新画**：并排后如果还用每段 `border-top`，左右两段各自画一条会在中间断成
          两截短线，且第一行的下边线画不出来。改为「网格自己画行线 + 首行无上边线」，见下面两条规则。 */
    .rl-sp-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 14px;
        align-items: start;
    }
    .rl-sp-grid > .rl-sp-sec {
        padding: 0;
        border-top: none;
    }
    /* 第一行（第 1、2 段）与第二行（第 3、4 段）之间的那条横线：只给第 3、4 段加上边距与上边线 */
    .rl-sp-grid > .rl-sp-sec:nth-child(n + 3) {
        border-top: 1px solid var(--background-modifier-border);
        padding-top: 12px;
    }
    /* 窄窗兜底：屏宽 ≤560px 时窗口只有 ~92vw、两列各约 240px 撑不住，回落单列。
       🔴 断点必须用既有档位（`tests/narrowScreenAdapt.test.ts` 的 ALLOWED_BREAKPOINTS
          = 900/760/719/700/560/420），⛔ 别为这事新开一个一次性阈值。 */
    @media (max-width: 560px) {
        .rl-sp-grid { grid-template-columns: 1fr; }
        .rl-sp-grid > .rl-sp-sec:nth-child(n + 2) {
            border-top: 1px solid var(--background-modifier-border);
            padding-top: 12px;
        }
    }
    .rl-sp-sec { padding: 10px 0; border-top: 1px solid var(--background-modifier-border); }
    .rl-sp-sec:first-of-type { border-top: none; padding-top: 0; }
    /* 标签行：与单卡编辑属性 `.rl-lbl` 同款（11px / 600 / 上 9px 下 4px），⛔ 别再另起一套字号 */
    .rl-sp-lbl { display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin: 9px 0 4px; }
    .rl-sp-sec:first-of-type .rl-sp-lbl { margin-top: 0; }
    .rl-sp-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .rl-sp-row .rl-sp-lbl { margin-bottom: 0; }
    .rl-sp-grow { flex: 1 1 auto; }
    /* 输入框：与 `.rl-input` 同款（12px / padding 5px 9px / radius 6px） */
    .rl-sp-input {
        flex: 1 1 auto;
        min-width: 0;
        font-family: inherit;
        font-size: 12px;
        padding: 5px 9px;
        border-radius: var(--rl-t-radius-md, 6px);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
    }
    .rl-sp-input:focus { outline: none; border-color: var(--interactive-accent); }
    .rl-sp-hint { font-size: 11px; color: var(--text-faint); margin-top: 5px; line-height: 1.45; }
    /* 现有标签胶囊（皮肤同 `.rl-chip`，⛔ 不复用那个全局类名，免得被别处规则波及） */
    .rl-sp-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
    .rl-sp-chip {
        font-family: inherit;
        font-size: 12px;
        padding: 3px 12px;
        border-radius: var(--rl-t-radius-pill, 999px);
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-muted);
        box-shadow: none;
        cursor: pointer;
        line-height: 1.5;
    }
    .rl-sp-chip:hover {
        background: var(--interactive-accent);
        border-color: var(--interactive-accent);
        color: var(--text-on-accent);
    }
    /* 两级选择器：单类 (0,1,0) 压不过核心 `button:not(.clickable-icon)` 的 (0,1,1) 灰底 */
    .rl-sp-row .rl-sp-btn {
        flex: none;
        font-family: inherit;
        font-size: 12.5px;
        padding: 4px 12px;
        border-radius: 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
    }
    .rl-sp-row .rl-sp-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-sp-row .rl-sp-btn:disabled { opacity: .45; cursor: default; }
    .rl-sp-row .rl-sp-btn.mod-cta {
        background: var(--interactive-accent);
        border-color: var(--interactive-accent);
        color: var(--text-on-accent);
        font-weight: 600;
    }
    /* 星控件：皮肤照抄单卡编辑属性的 `.rl-stars-input`（20px / gap 2px / `--rl-score-input` 打底色）。
       半星用**伪元素裁切左 50%** 画（⛔ 不用 U+2BE8 字符——字体覆盖不稳，实测渲染成残缺星块）。 */
    .rl-sp-stars { display: inline-flex; align-items: center; gap: 2px; font-size: 20px; color: var(--rl-score-input); }
    .rl-sp-star {
        position: relative;
        display: inline-block;
        padding: 0;
        border: none;
        background: transparent;
        box-shadow: none;
        color: var(--rl-score-input);
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
        user-select: none;
    }
    .rl-sp-star.is-on { color: var(--rl-score); }
    .rl-sp-star.is-half { color: var(--rl-score-input); }
    .rl-sp-star.is-half::before {
        content: '★';
        position: absolute;
        left: 0;
        top: 0;
        width: 50%;
        overflow: hidden;
        color: var(--rl-score);
    }
    .rl-sp-star:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; border-radius: 3px; }
    /* 数值（`9/10`）：透明按钮，点了切输入框 —— 同 `.rl-stars-val`，
       🔴 它是 `<button>` ⇒ 必须压掉核心那条 `button:not(.clickable-icon)` 的灰底 */
    .rl-sp-stars-val {
        margin-left: 8px;
        padding: 0 4px;
        font-size: 11px;
        font-family: inherit;
        background: transparent;
        border: none;
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
    }
    .rl-sp-stars-val:hover { color: var(--text-normal); }
    .rl-sp-num { margin-left: 8px; width: 52px; font-size: 12px; }
    .rl-sp-suffix { margin-left: 2px; font-size: 11px; color: var(--text-muted); }
    .rl-sp-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
        max-height: 240px;
        overflow-y: auto;
        margin-top: 6px;
    }
    /* 成员行 = 可拖排序行（原 `SeriesReorder.svelte` 的形态搬进来） */
    .rl-sr-row {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: var(--background-primary);
        cursor: default;
    }
    .rl-sr-row:hover { background: var(--background-modifier-hover); }
    .rl-sr-row:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -2px; }
    /* 拖动中：被拖那行浮起半透明 */
    .rl-sr-row.is-dragging { opacity: .45; background: var(--background-modifier-hover); }
    /* 落点：上方一条强调色插入线（比整行高亮更准 —— 用户能看清是「插到它前面」） */
    .rl-sr-row.is-dropBefore { box-shadow: inset 0 2px 0 0 var(--interactive-accent); }
    /* 拖动把手：`cursor: grab` 是唯一的「这行能拖」提示（⛔ 不再叠一枚图标按钮） */
    .rl-sr-handle {
        flex: none;
        display: inline-flex;
        color: var(--text-faint);
        cursor: grab;
    }
    .rl-sp-cov {
        flex: none;
        width: 28px;
        height: 38px;
        border-radius: 4px;
        object-fit: cover;
        background: var(--background-modifier-hover);
    }
    .rl-sp-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .rl-sp-name { font-size: 12.5px; color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-sp-msub { font-size: 11px; color: var(--text-faint); }
    /* 序号徽标：**显示当下这个位置**（拖完跟着变），不是条目原序号 */
    .rl-sr-idx {
        flex: none;
        min-width: 20px;
        text-align: center;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
    }
</style>
