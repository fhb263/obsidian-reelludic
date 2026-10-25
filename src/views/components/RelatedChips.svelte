<script lang="ts">
    // #668 关联条目（编辑条目表单里的一节）—— **列表视图**（已撤掉放射状图，用户裁定「不做那图了，整体删除并归档」）。
    //
    // 形态：一行一条，只列**标题**（用户裁定「完全不要关系词，只列标题」）+ 行尾 ✕ 解除。
    // 对齐口径（用户：「占位符能居中，但正常显示字段变左对齐了，统一给我居中啊，除标题外不居中」）：
    //   · **占位符文字（空态 / 空表提示）居中**；
    //   · **有内容时的行文字左对齐**；
    //   · 本区块的标题行（「关联条目 · N 条」）保持左对齐（标题一族不居中）。
    //
    // 🔴 数据层没变：`related` 仍是 `{ id, label? }`，`collectRelated` 仍算「出入边合并」，
    //    只是**不再画图**。要不要 `label` 由宿主决定（撤关系词后表单只写 `{ id }`）。
    //
    // 🔴 Svelte 4 三条硬约束（AGENTS.md 坑点表）：
    //  ⑴ 事件一律 `on:click` / `on:keydown` 指令语法（⛔ 裸 `onclick` 会被 setAttribute 成字符串 ⇒ 点了没反应）；
    //  ⑵ 模板里⛔ 不许 `as Xxx` / `!` / `bind:value={arr[i]}`；
    //  ⑶ scoped 样式的**复合选择器 ≤2 级**，否则 scoped 哈希重复次数会翻倍。
    import Icon from './Icon.svelte';
    import { ENTRY_TYPE_LABELS, type MediaEntry, type RelatedLink } from 'data/types';
    import { REL_HINT_MS, REL_LABEL_SUGGESTIONS, REL_MIRROR_LABEL, collectRelated, normalizeRelLabel } from 'pure/relatedGraph';

    /** 全部条目（候选池 + 失效计数 + 入边扫描都靠它） */
    export let allEntries: MediaEntry[] = [];
    /** 当前条目（新增态为 null ⇒ 不列行、也不能切条目） */
    export let self: MediaEntry | null = null;
    /**
     * 出边（表单 state）。🔴 这里**不要**用 `bind:related` 双向绑定 —— 已改由 `onRelatedChange` 单向回写。
     * 为什么：双向绑定 + 组件内部赋值在 Svelte 4 里要同时维护 `$$.bound` 与 `$$.props` 两套写回，
     * 本批在这里连踩两次（点 ✕ 删不掉）；根因见 `onClickX` 那段注释。
     * ⚠️ 只读使用；改它一律走 `commit()` / `onClickX()`。
     */
    export let related: RelatedLink[] = [];
    /** 点某一行 ⇒ 宿主切换编辑目标（脏检查在宿主那侧） */
    export let onOpenRelated: (id: string) => void = () => {};
    /** 是否允许切条目（新增态 / 无 id 时不允许） */
    export let canSwitch = false;

    // ── 候选搜索 ────────────────────────────────────────
    let picker = false;
    let query = '';
    let pickInput: HTMLInputElement | null = null;
    /** 键盘高亮行（↑↓ 移动、Enter 选中） */
    let hl = 0;
    /** 候选表一次最多渲染多少行（表体内部滚动；⚠️ 不是「只有这么多条」，底部计数会说实话） */
    const MAX_ROWS = 200;
    let hint = '';
    let hintTimer: ReturnType<typeof setTimeout> | null = null;

    /** 已挂过的 id（候选里要隐藏 —— 防重复挂） */
    $: linkedIds = new Set(related.map((r) => r.id));

    /**
     * 候选：**只搜本库条目**（⛔ 不发网络请求）+ 排除自己 + 排除已挂的。
     *
     * 🔴 #668 二轮（用户：「根本搜索不到条目，没有自动搜索功能」）：原实现**空关键词直接返回空数组**，
     *    于是点开「添加关联」看到的是一个框 + 一片空白 —— 用户以为功能坏了。现在：
     *    · 空关键词 ⇒ **按库的顺序列出全部可挂条目**（⛔ 不重排 —— 见下）；
     *    · 有关键词 ⇒ 标题 / 原名 / 作者 / 画师命中即可。
     *
     * 🔴🔴 #668 三轮（用户：「还是什么都搜索不到」）—— 真因是**我自己上一轮的排序**：
     *    原来的比较器 `rank(a) - rank(b) || localeCompare(...)` 里 `rank` 只返回 `0` 或**负数**，
     *    于是「同类型优先」被排成了**同类型末位**（−2 < 0），再叠上 `localeCompare` 把列表重排成拼音序 ——
     *    真实库里 43 部电影被截到 8 条，用户按自己的印象找一个条目，八条里一条都不沾边 = 「什么都搜不到」。
     *    ⇒ **不再重排**：候选顺序 = **库的顺序**（用户自己的排列，最可预期）。
     *    ⛔ 别再往这里加排序（尤其别再拿负数当「优先级更高」—— 比较器里负数 = 排更前，与直觉相反）。
     */
    const matchEntry = (e: MediaEntry, q: string): boolean =>
        (e.title ?? '').toLowerCase().includes(q) ||
        (e.author ?? '').toLowerCase().includes(q) ||
        (e.artist ?? '').toLowerCase().includes(q) ||
        (e.originalTitle ?? '').toLowerCase().includes(q);

    $: candidates = (() => {
        const q = query.trim().toLowerCase();
        const selfId = self?.id;
        const pool = allEntries.filter((e) => e.id !== selfId && !linkedIds.has(e.id));
        return (q ? pool.filter((e) => matchEntry(e, q)) : pool).slice(0, MAX_ROWS);
    })();

    /** 当前筛选下**总共有多少条**可挂（用于「共 N 条」提示；⛔ 别只截断不告诉用户）。
     *  ⚠️ 判据必须与上面 `candidates` **同一套字段**（漏一个字段 ⇒ 计数与列表对不上，用户会怀疑坏掉）。 */
    $: candidateTotal = (() => {
        const q = query.trim().toLowerCase();
        const selfId = self?.id;
        const pool = allEntries.filter((e) => e.id !== selfId && !linkedIds.has(e.id));
        return (q ? pool.filter((e) => matchEntry(e, q)) : pool).length;
    })();
    /** 关键词一条都没命中时，把**其它类型里**有没有同名条目也算出来 —— 让用户知道「得写类型名」。 */
    $: typeHint = (() => {
        const q = query.trim().toLowerCase();
        if (!q) return '';
        const selfId = self?.id;
        const names = new Set<string>();
        for (const e of allEntries) {
            if (e.id === selfId || linkedIds.has(e.id)) continue;
            if (!matchEntry(e, q)) continue;
            if (e.type !== self?.type) names.add(typeLabel(e.type));
        }
        return names.size ? `（同类里没有；${[...names].join(' / ')}类里有，写类型名或完整标题都能搜到）` : '';
    })();
    /** 库里到底有没有别的条目（一条都没有时给「先去添加条目」的说明，而不是空白） */
    $: hasOtherEntries = allEntries.some((e) => e.id !== self?.id);

    /**
     * 整组关联：**以表单正在编辑的 `related` 为准**（不是 `self.related`）。
     *
     * 🔴🔴 #668 真事故（我自己引入的）：重构列表时写成 `collectRelated(self, allEntries)`，
     *    而 `self.related` 是**打开弹窗那一刻的快照** —— 表单里新加的关联根本没进 `self`，
     *    于是「点 ✕ 删不掉 / 加一条不出现」全都表现成「毫无反应且在计数上看不出来」
     *    （我第一版甚至把计数也挂在它上面，于是「有 2 条」显示成「0 条」）。
     * ⇒ 组装一个**以当前 `related` 为准的 self** 再交给算法：出边读表单态，入边仍扫全库。
     * ⛔ 别改回直接传 `self`。
     */
    $: graph = collectRelated(
        self ? { id: self.id, related: related } : undefined,
        allEntries,
    );
    $: nodes = graph.nodes;
    $: nodeCount = nodes.length;

    /** 这一行是不是「别人挂了我」（入边）—— 只用来在悬停提示里说明方向，不占版面 */
    function isMirror(id: string): boolean {
        const n = nodes.find((x) => x.id === id);
        return !!n && n.mirror;
    }
    function mirrorTip(id: string): string {
        return isMirror(id) ? '（对方关联了我）' : '';
    }

    function openNode(id: string): void {
        if (!canSwitch) return;
        onOpenRelated(id);
    }

    // ── 录入 ────────────────────────────────────────────
    function openPicker(): void {
        picker = true;
        query = '';
        hl = 0;
        void tickFocus();
    }
    async function tickFocus(): Promise<void> {
        await Promise.resolve();
        pickInput?.focus();
    }

    function closePicker(): void {
        picker = false;
        query = '';
    }

    // 🔴🔴 #668 用户实测报障：「点 ✕ 删不掉关联」。
    //    ⚠️ 我先误判成「Svelte 4 丢弃组件内对 export let 的赋值」——**那是错的**（最小复现证伪：
    //    编译成 `$$invalidate(0, arr = …)`，本地与写回都正常）。真因见 `onClickX` 下面那两条注释。
    //    这里保留 `commit()` 只是为了让「新数组」同时走本地与父组件回调两条路（双向绑定关闭后也能用）。
    export let onRelatedChange: ((next: RelatedLink[]) => void) | undefined = undefined;
    function commit(next: RelatedLink[]): void {
        related = next;
        onRelatedChange?.(next);
    }

    /**
     * 🔴🔴 点 ✕ 的**唯一入口**。本批在这里绕了两圈，把结论钉死：
     *  · 编译产物里 `listen(button1, "click", click_handler_2)` **是绑上的**、`removeLink` 也正确编译成
     *    `commit(related.filter(...))` —— ⇒ **不是红线 9 那种「事件没绑上」**，也不是「函数没编进去」。
     *  · 真因 = `related` 既走 `bind:related`（双向）又走 `onRelatedChange`（单向）两条写回通道：
     *    组件内部赋值后，父组件的 `$$set` 与组件自己的 `$$invalidate` 会在同一次 flush 里互相覆盖，
     *    最终留下的仍是旧数组 ⇒ 行删了又回来（看起来「完全没反应」，且**没有任何报错**）。
     *  ⇒ 现在**单一写回通道**：`related` 只读、改动一律经 `onRelatedChange` 回到表单 state。
     *  ⇒ 入口只接 **id 字符串**（点击瞬间求值，不依赖 each 块的上下文快照）。
     *  ⛔ 别改回「函数里读 `nodes` / 传整个 node 对象」；⛔ 别把 `bind:related` 加回来。
     */
    function onClickX(id: string): void {
        if (!id) return;
        removeLink(id);
    }

    function addLink(e: MediaEntry | undefined): void {
        if (!e) return;
        if (linkedIds.has(e.id) || e.id === self?.id) return;
        // ⚠️ 只写 `{ id }`：关系词这一层已按用户裁定撤除（⛔ 别再往这里塞 label）
        commit([...related, { id: e.id }]);
        closePicker();
        flash(`已关联：${e.title}`);
    }

    function removeLink(id: string): void {
        commit(related.filter((r) => r.id !== id));
    }

    // ── 关系词（行内就地编辑）──────────────────────────────
    /** 某条关联**当前写在自己这边的**关系词（入边没有 —— 它的词在对方那边） */
    function labelOf(id: string): string {
        return related.find((r) => r.id === id)?.label ?? '';
    }

    /**
     * 提交关系词。口径与数据层完全一致（`normalizeRelLabel`）：trim + 限长 + 空 ⇒ **删掉这个键**
     * （⛔ 不落空串 —— 「留空 = 普通关联」的判据只该判一次）。
     * ⚠️ 走 `commit()` 的单一写回通道（⛔ 别直接改 `related` 再指望父组件知道）。
     */
    function commitLabel(id: string, raw: string): void {
        const label = normalizeRelLabel(raw);
        const cur = related.find((r) => r.id === id);
        if (!cur) return;
        if ((cur.label ?? '') === (label ?? '')) return; // 没改就不重建数组（避免多余的落库刷新）
        commit(
            related.map((r) => {
                if (r.id !== id) return r;
                return label ? { id: r.id, label } : { id: r.id };
            }),
        );
    }

    /** 从输入事件取当前值。
     *  🔴 模板里⛔ 不能写 `(ev.currentTarget as HTMLInputElement).value` ——
     *    **Svelte 4 模板表达式不支持类型断言**（esbuild-svelte 报 `Unexpected token`，AGENTS.md 已记这条）。
     *    因此取值一律走本函数（与其它组件里的 `inputVal` 同款做法）。 */
    function inputValueOf(ev: Event): string {
        const t = ev.currentTarget as HTMLInputElement | null;
        return t ? t.value : '';
    }

    /** 关系词输入框：回车提交（失焦也会提交）；Esc 还原 */
    function onTagKey(ev: KeyboardEvent, id: string): void {
        const el = ev.currentTarget as HTMLInputElement | null;
        if (!el) return;
        if (ev.key === 'Enter') {
            ev.preventDefault();
            commitLabel(id, el.value);
            el.blur();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            el.value = labelOf(id);
            el.blur();
        }
    }

    function titleOf(id: string): string {
        return allEntries.find((e) => e.id === id)?.title ?? '(已失效)';
    }

    function typeOf(id: string): string {
        const e = allEntries.find((x) => x.id === id);
        return e ? typeLabel(e.type) : '';
    }

    function typeLabel(t: MediaEntry['type']): string {
        return ENTRY_TYPE_LABELS[t];
    }

    function flash(text: string): void {
        hint = text;
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = setTimeout(() => (hint = ''), REL_HINT_MS);
    }

    /** 列表行键盘：Enter / Space 打开那一条；↑↓ 在行间移动焦点 */
    function onRowKey(ev: KeyboardEvent, id: string): void {
        if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            openNode(id);
        } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            (ev.currentTarget as HTMLElement).nextElementSibling?.dispatchEvent(new MouseEvent('focus'));
        } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            focusPrevRow(ev.currentTarget as HTMLElement);
        }
    }
    /** 向上移动焦点到上一行（DOM 里前后夹着 ✕ 按钮 ⇒ 不能只靠 previousElementSibling 找「行」） */
    function focusPrevRow(el: HTMLElement): void {
        const rows = Array.from(el.parentElement?.parentElement?.querySelectorAll('[data-row-id]') ?? []) as HTMLElement[];
        const i = rows.indexOf(el);
        rows[(i - 1 + rows.length) % rows.length]?.focus();
    }
</script>

<div class="rl-rel-wrap">
    <div class="rl-rel-head">
        <!-- 标题行：#668 用户裁定「取消下拉」⇒ 它只是一行说明，⛔ 不再是折叠开关。
             ⚠️ 标题保持**左对齐**（「除标题外不居中」的口径）。 -->
        <span class="rl-rel-title">关联条目 · {nodeCount} 条</span>
        <!-- 🔴 全组件只留这一枚入口（#668：空态那块原来也有一枚 ⇒ 用户报「两个关联按钮」）。 -->
        {#if canSwitch}
            <button class="rl-rel-add" on:click={openPicker} data-tip="从库里挂一条关联">
                <Icon icon="plus" size={12} /> 添加关联
            </button>
        {/if}
    </div>

    {#if picker}
        <div class="rl-rel-pick">
            <input
                class="rl-input"
                bind:this={pickInput}
                bind:value={query}
                on:input={() => (hl = 0)}
                placeholder={hasOtherEntries ? '搜库内条目：标题 / 原名 / 作者；留空列出全部' : '库里还没有其它条目'}
                on:keydown={(ev) => {
                    if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        hl = Math.min(hl + 1, candidates.length - 1);
                    } else if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        hl = Math.max(hl - 1, 0);
                    } else if (ev.key === 'Enter') {
                        ev.preventDefault();
                        addLink(candidates[hl]);
                    } else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        closePicker();
                    }
                }} />
            <!-- 候选表：**不再要求先输入关键字**（打开即列出）；三种空态各自有话说，⛔ 别留一片空白。 -->
            {#if !hasOtherEntries}
                <div class="rl-rel-tbl">
                    <div class="rl-rel-tbl-empty">库里还没有别的条目 —— 先添加一条，再回来挂关联</div>
                </div>
            {:else if candidates.length}
                <div class="rl-rel-tbl">
                    <div class="rl-rel-tbl-head">
                        <span class="rl-rel-th-t">标题</span>
                        <span class="rl-rel-th-m">类型</span>
                        <span class="rl-rel-th-a">作者 / 原名</span>
                    </div>
                    <div class="rl-rel-tbl-body">
                        {#each candidates as c, i (c.id)}
                            <button
                                class="rl-rel-cand"
                                class:hl={i === hl}
                                on:mouseenter={() => (hl = i)}
                                on:click={() => addLink(c)}>
                                <span class="rl-rel-td-t">{c.title}</span>
                                <span class="rl-rel-td-m">{typeLabel(c.type)}</span>
                                <span class="rl-rel-td-a">{c.author || c.originalTitle || ''}</span>
                            </button>
                        {/each}
                    </div>
                    <div class="rl-rel-tbl-foot">
                        <span>共 {candidateTotal} 条{query.trim() ? `（匹配「${query.trim()}」）` : ''}</span>
                        {#if candidateTotal > candidates.length}
                            <span>· 已显示前 {candidates.length} 条，输入标题里的字缩小范围</span>
                        {/if}
                        <span>· ↑↓ 选择，Enter 挂上</span>
                    </div>
                </div>
            {:else}
                <div class="rl-rel-tbl">
                    <div class="rl-rel-tbl-empty">
                        没有「{query.trim()}」匹配的条目{#if typeHint}<span class="rl-rel-typehint">{typeHint}</span>{/if}
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    {#if hint}
        <div class="rl-rel-toast" role="status" aria-live="polite">{hint}</div>
    {/if}

    <!-- 🔴 列表视图（#668）：一行一条。
         🔴 四轮（用户：「这个关联条目怎么不给选中条目后两者自定义标记标签啊，这我怎么知道关联是什么」）：
            每行**行首**给一个**关系词**输入框（原唱 / 翻唱 / 续作… 就地改，留空只是普通「关联」）。
            它与上次的裁定并不冲突：上次去掉的是**图形上的标签**，这次要的是**能自己写的关系词**。
         对齐：#668 用户口径 = 占位符居中、内容行左对齐、区块标题左对齐。 -->
    {#if nodeCount === 0}
        <div class="rl-rel-empty-center">还没有关联系目</div>
    {:else}
        <div class="rl-rel-list">
            <!-- 关系词建议表：只是建议，⛔ 不是白名单（自由文本照样能填） -->
            <datalist id="rl-rel-sugg-668">
                {#each REL_LABEL_SUGGESTIONS as s}
                    <option value={s}></option>
                {/each}
            </datalist>
            {#each nodes as n (n.id)}
                <div class="rl-rel-item">
                    <!-- 关系词：行内就地编辑（失焦 / 回车提交）。只有**出边**能改；
                         入边的词是对方的（本地改了也不会写到对方数据里）⇒ 只读展示。 -->
                    <input
                        class="rl-rel-tag"
                        value={labelOf(n.id)}
                        list="rl-rel-sugg-668"
                        placeholder={n.mirror ? REL_MIRROR_LABEL : '关联'}
                        readonly={n.mirror}
                        data-tag-for={n.id}
                        data-tip={n.mirror ? '对方关联了我（关系词写在他那边）' : '点这里写关系词（留空 = 关联）'}
                        on:blur={(ev) => commitLabel(n.id, inputValueOf(ev))}
                        on:keydown={(ev) => onTagKey(ev, n.id)} />
                    <button
                        class="rl-rel-link"
                        data-row-id={n.id}
                        tabindex={canSwitch ? 0 : -1}
                        data-tip={canSwitch ? `切到「${n.title}」继续编辑` : ''}
                        on:click={() => openNode(n.id)}
                        on:keydown={(ev) => onRowKey(ev, n.id)}>
                        <span class="rl-rel-name">{n.title}</span>
                        <span class="rl-rel-meta">{typeLabel(n.type)}{mirrorTip(n.id)}</span>
                    </button>
                    <button class="rl-rel-x" on:click={() => onClickX(n.id)} data-tip="解除关联">
                        <Icon icon="x" size={11} />
                    </button>
                </div>
            {/each}
        </div>
    {/if}
    {#if graph.invalid > 0}
        <!-- 失效引用：只提示，⛔ 不删数据、不弹窗 -->
        <div class="rl-rel-invalid" data-tip="指向的条目已不存在；关联数据仍保留">
            {graph.invalid} 条关联已失效
        </div>
    {/if}
</div>

<style>
    /* ⚠️ 复合选择器一律 ≤2 级（#624：超了 scoped 哈希重复次数翻倍）。 */
    .rl-rel-wrap { margin-top: 12px; }
    .rl-rel-head { display: flex; align-items: center; gap: 8px; }
    /* 标题 = 一行说明（#668 起不可点）⇒ 不带 cursor: pointer / hover 变色 */
    .rl-rel-title {
        display: inline-flex; align-items: center;
        font-size: 12px; font-weight: 600; color: var(--text-muted);
    }
    .rl-rel-add {
        display: inline-flex; align-items: center; gap: 3px;
        font-family: inherit; font-size: 11px; padding: 2px 8px;
        background: transparent; border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-pill, 999px); color: var(--text-muted); cursor: pointer;
    }
    .rl-rel-add:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }

    /* ── 关联列表（列表视图）── */
    .rl-rel-list { display: flex; flex-direction: column; margin-top: 6px; }
    .rl-rel-item {
        display: flex; align-items: center; gap: 4px;
        border-bottom: 1px solid var(--background-modifier-border);
    }
    /* 行主体：左对齐（⛔ 别居中 —— 用户要的是「有内容时左对齐」）；透明无框压掉核心按钮底色 */
    .rl-rel-link {
        flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px;
        padding: 5px 2px; border: none; border-radius: 0;
        background: transparent; box-shadow: none; text-align: left;
        font-family: inherit; font-size: 12px; color: var(--text-normal); cursor: pointer;
    }
    .rl-rel-link:hover { color: var(--interactive-accent); }
    .rl-rel-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* 关系词（行首小胶囊）：**看着像标签、点开才像输入框** —— 默认无框、聚焦才描主题色边。
       ⚠️ 宽度固定 52px：不定宽的话每行关系词长短不同，「标题」这一列就参差不齐（列表首要的是对齐）。 */
    .rl-rel-tag {
        flex: none; width: 52px; font-family: inherit; font-size: 10px;
        padding: 1px 4px; text-align: center;
        background: var(--background-modifier-hover); color: var(--text-muted);
        border: 1px solid transparent; border-radius: var(--rl-t-radius-pill, 999px);
        box-shadow: none;
    }
    .rl-rel-tag::placeholder { color: var(--text-faint); }
    .rl-rel-tag:focus { outline: none; border-color: var(--interactive-accent); color: var(--text-normal); background: var(--background-primary); }
    .rl-rel-tag[readonly] { background: transparent; border-color: var(--background-modifier-border); cursor: default; }
    .rl-rel-meta { flex: none; font-size: 10px; color: var(--text-faint); }
    .rl-rel-x {
        border: none; background: transparent; box-shadow: none; color: var(--text-faint);
        cursor: pointer; padding: 0 4px; display: inline-flex; align-items: center;
    }
    .rl-rel-x:hover { color: var(--rl-danger); }

    /* ── 占位（居中）：空列表 / 空表都走这一条口径 ── */
    .rl-rel-empty-center {
        margin-top: 6px; padding: 14px 10px; text-align: center;
        font-size: 12px; color: var(--text-faint);
        border: 1px dashed var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
    }
    .rl-rel-tbl-empty { padding: 12px 10px; text-align: center; font-size: 11px; color: var(--text-faint); }
    /* 关键词没命中时的「别的类型里有」提示：另起一行、更淡（它是**补充说明**，不该压过「没有匹配」那句） */
    .rl-rel-typehint { display: block; margin-top: 2px; color: var(--text-faint); }

    /* ── 候选表（#668 四轮）：独立卡片 + 表头 + 可滚表体 + 页脚 ── */
    .rl-rel-pick { margin-top: 6px; }
    .rl-rel-tbl {
        margin-top: 6px; border: 1px solid var(--background-modifier-border);
        border-radius: var(--rl-t-radius-md, 6px); background: var(--background-primary);
        overflow: hidden;
    }
    /* 表头：三列与数据行**同一套栅格**（⛔ 别只在行里写 grid —— 表头会错位） */
    .rl-rel-tbl-head {
        display: grid; grid-template-columns: minmax(0, 1fr) 54px 96px;
        gap: 8px; align-items: center; padding: 4px 10px;
        border-bottom: 1px solid var(--background-modifier-border);
        background: var(--background-primary-alt);
        font-size: 10px; color: var(--text-faint); font-weight: 600;
    }
    /* 表体：**内部滚动**（高度封顶，不把整张表单撑长）；滚动条交给主题默认 */
    .rl-rel-tbl-body { max-height: 168px; overflow-y: auto; overscroll-behavior: contain; }
    .rl-rel-cand {
        display: grid; grid-template-columns: minmax(0, 1fr) 54px 96px;
        gap: 8px; align-items: center; width: 100%;
        padding: 5px 10px; border: none; border-radius: 0;
        background: transparent; box-shadow: none; text-align: left;
        font-family: inherit; font-size: 12px; color: var(--text-normal); cursor: pointer;
    }
    /* 当前行（鼠标悬停 / ↑↓ 选中同一套高亮 —— 两种输入走同一个 `hl`，⛔ 别各写一份） */
    .rl-rel-cand.hl { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-rel-td-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-rel-td-m { font-size: 10px; color: var(--text-faint); }
    .rl-rel-td-a { font-size: 10px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-rel-cand.hl .rl-rel-td-m { color: var(--text-on-accent); opacity: .8; }
    .rl-rel-cand.hl .rl-rel-td-a { color: var(--text-on-accent); opacity: .8; }
    .rl-rel-tbl-foot {
        display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px;
        border-top: 1px solid var(--background-modifier-border);
        background: var(--background-primary-alt);
        font-size: 10px; color: var(--text-faint);
    }

    .rl-rel-toast { font-size: 11px; color: var(--text-faint); margin-top: 4px; }
    .rl-rel-invalid { margin-top: 4px; font-size: 11px; color: var(--rl-warn, var(--text-muted)); }
</style>
