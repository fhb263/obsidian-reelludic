<!--
  「从网络搜索封面」候选网格（#498）—— 用户原话：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」。

  🔴 结构与纪律（照 #399-D `MusicDownload.svelte` 那一套，⛔ 别自创）：
    · 组件**零 obsidian / 零网络 / 零 vault**：搜索与下载都由 prop 注入（真源在 `main.ts` 的门面）。
    · 搜索 = **输入即搜**改成「回车 / 点按钮才搜」：图片搜索一次 35 条、每张缩略图都是一次请求，
      ⛔ 不能像歌曲那样边打边搜（一秒钟能打出三次请求来）。
    · 🔴 **空结果与失败必须分开呈现**：`rows.length === 0 && !err` 说「没搜到，换个词」，
      `err` 说「请求失败（HTTP …）」—— 合成一句会让用户把「网络挂了」当成「这作品没封面」。
    · 🔴 **缩略图是别人家 CDN**，掉图率不为零（本批实测：`ts1.mm.bing.net` 不通 / `tse1` 通）
      ⇒ 逐级回退（`posterThumbChain`），全用完退**占位块**，⛔ 不留破图标。
-->
<script lang="ts">
    import { onMount } from 'svelte';
    import { Notice } from 'obsidian';
    import Icon from './Icon.svelte';
    import { posterDomainLabel, posterThumbChain, type PosterCandidate } from 'pure/posterSearch';
    import { POSTER_SOURCE_LABELS, type PosterSource } from 'pure/posterSources';

    /**
     * 🔴 搜索词初值由**表单侧拼好传进来**，且**按来源分开**（`queries[source]`）——
     *    ⛔ 本组件刻意不认识 `EntryType`：类型词 / 平台词的规则是纯模块的事，组件再算一遍就是第二份口径。
     *    ⚠️ 两条默认词**本来就不一样**：必应那条要「标题 + 类型词」（图片搜索），
     *       平台那四条要「标题 + 歌手」（音乐平台的搜索框）—— 见 `pure/posterSources.buildPlatformCoverQuery`。
     */
    export let queries: Partial<Record<PosterSource, string>> = {};
    /**
     * #509：可用来源（**表单侧决定**：音乐给全 5 个，其它类型只有 `bing`）。
     * ⚠️ 只有一个来源时**不摆胶囊行**（摆一行只有一颗的胶囊是纯噪音）。
     */
    export let sources: PosterSource[] = ['bing'];
    /** 搜索（真源 = `main.searchPosterCandidatesBySource`）—— **来源随请求一起传** */
    export let search: (
        source: PosterSource,
        query: string,
        page: number,
    ) => Promise<{ candidates: PosterCandidate[]; error?: string }>;
    /** 下载并设为封面：成功回传**库内相对路径**（命名用的标题由宿主侧闭包带下去，⛔ 组件不用管） */
    export let pick: (c: PosterCandidate) => Promise<{ ok: boolean; message: string; path?: string }>;
    /** 拿到封面后由宿主（EntryModal）接管：写进表单 + 关闭弹窗 */
    export let onPicked: (relPath: string) => void;

    /** 当前来源（默认第一个 = 网络搜索） */
    let src: PosterSource = sources[0] ?? 'bing';
    /**
     * 每个来源**各记各的搜索词**（初值取 `queries[src]`，回落到第一个来源的）。
     * 🔴 刻意**不做「切换时把词搬过去」**那种聪明事：两套默认词语义不同，搬来搬去必然让人莫名其妙。
     */
    let queryBySource: Partial<Record<PosterSource, string>> = Object.fromEntries(
        sources.map((s) => [s, String(queries[s] ?? queries[sources[0] ?? 'bing'] ?? '')]),
    ) as Partial<Record<PosterSource, string>>;
    /** 模板里绑定用（`bind:value` 不能绑到 `queryBySource[src]` 这种成员表达式上 —— Svelte 4 不支持） */
    let query = queryBySource[src] ?? '';
    let page = 1;
    /** 已搜索过至少一次（首屏不自动搜：由用户确认关键词后回车 —— 也避免弹窗一开就发请求） */
    let searched = false;
    let busy = false;
    let picking = '';
    let rows: PosterCandidate[] = [];
    let err = '';
    /** 缩略图已回退到第几档（key = murl） */
    let thumbIdx: Record<string, number> = {};
    /** 缩略图全部档位都挂了的（渲染占位块） */
    let deadThumbs: Record<string, true> = {};

    onMount(() => {
        // 首屏自动搜一次：关键词已经由 `buildPosterQuery` 拼好，用户点进来就是想看结果。
        // ⚠️ 标题为空时 `buildPosterQuery` 回空串 ⇒ 直接给提示，⛔ 不发一个必空的请求。
        if (query.trim()) void runSearch(1);
    });

    async function runSearch(toPage: number): Promise<void> {
        const q = query.trim();
        if (!q) {
            err = '先填搜索词（默认用条目标题，可以改）';
            return;
        }
        busy = true;
        err = '';
        try {
            const r = await search(src, q, toPage);
            if (r.error) {
                err = r.error;
                return;
            }
            page = toPage;
            rows = r.candidates;
            searched = true;
            thumbIdx = {};
            deadThumbs = {};
        } finally {
            busy = false;
        }
    }

    /** 点一张：下载原图 → 本地化到 封面/ → 交给宿主。⚠️ 期间**只锁当前这张**（别整页禁用） */
    async function choose(c: PosterCandidate): Promise<void> {
        if (picking) return;
        picking = c.murl;
        err = '';
        try {
            const r = await pick(c);
            if (!r.ok) {
                err = r.message;
                return;
            }
            new Notice(r.message, 4000);
            if (r.path) onPicked(r.path);
        } finally {
            picking = '';
        }
    }

    /** 当前该显示的缩略图地址（回退链第 `thumbIdx` 档；全挂 ⇒ 空串，渲染占位块） */
    function thumbSrc(c: PosterCandidate): string {
        const chain = posterThumbChain(c.turl);
        return chain[thumbIdx[c.murl] ?? 0] ?? '';
    }
    /** 缩略图加载失败：退下一档；没有下一档 ⇒ 记死、渲染占位块 */
    function onThumbError(c: PosterCandidate): void {
        const chain = posterThumbChain(c.turl);
        const next = (thumbIdx[c.murl] ?? 0) + 1;
        if (next < chain.length) thumbIdx = { ...thumbIdx, [c.murl]: next };
        else deadThumbs = { ...deadThumbs, [c.murl]: true };
    }
    /** 主/副行文本 */
    function candTitle(c: PosterCandidate): string {
        return c.title || '（无标题）';
    }
    /** 首屏那一次搜索进行中（`searched` 还没置位）—— 抽成函数，⛔ 别在模板的 `{:else if}` 里堆三元表达式 */
    function searchingFirst(): boolean {
        return busy && !searched;
    }

    /**
     * #509 切换来源：把当前词写回、取出新来源自己的词，然后**立刻重搜**（用户点胶囊就是想看那一家的图）。
     * ⚠️ 必须清掉上一个来源的结果与缩略图回退状态 —— 否则会拿着 A 家的图配 B 家的来源标签（信息错位）。
     */
    function switchSource(next: PosterSource): void {
        if (next === src || busy) return;
        queryBySource = { ...queryBySource, [src]: query };
        src = next;
        query = queryBySource[next] ?? '';
        rows = [];
        searched = false;
        err = '';
        thumbIdx = {};
        deadThumbs = {};
        if (query.trim()) void runSearch(1);
    }

    /** 当前来源的说明（胶囊下面那行；⛔ 别把「必应」写成所有来源的说明） */
    function sourceHint(): string {
        if (src === 'bing') return '来源为必应图片搜索；点一张即下载原图并设为封面。';
        return '来源为该平台的搜索结果（取**专辑大图**，实测最大 1000~1500px）；点一张即下载并设为封面。';
    }
</script>

<div class="rl-ps">
    <!-- #509：来源胶囊（只有一个来源时不摆 —— 一行只有一颗胶囊纯属噪音）。
         🔴 音乐才有四个平台：影视 / 书籍 / 游戏在音乐平台上搜不到东西（见 `pure/posterSources.posterSourcesFor`）。 -->
    {#if sources.length > 1}
        <div class="rl-ps-src">
            {#each sources as s (s)}
                <button class="rl-ps-chip" class:is-on={s === src} disabled={busy} on:click={() => switchSource(s)}>
                    {POSTER_SOURCE_LABELS[s]}
                </button>
            {/each}
        </div>
    {/if}
    <div class="rl-ps-bar">
        <input
            class="rl-input rl-ps-q"
            bind:value={query}
            placeholder={src === 'bing' ? '搜索词（默认「标题 + 类型词」）' : '搜索词（默认「标题 + 作者」）'}
            on:keydown={(ev) => {
                if (ev.key === 'Enter') void runSearch(1);
            }} />
        <button class="rl-btn" disabled={busy} on:click={() => void runSearch(1)} data-tip="按这个关键词搜封面">
            {#if busy}<span class="rl-spinner" aria-hidden="true"></span>{/if}
            <span class="rl-sr">搜索</span><Icon icon="search" size={13} />
        </button>
    </div>
    <div class="rl-ps-hint rl-hint">{sourceHint()}</div>

    {#if err}
        <div class="rl-hint rl-hint-warn">{err}</div>
    {:else if searchingFirst()}
        <div class="rl-hint">正在搜索…</div>
    {:else if searched && rows.length === 0}
        <div class="rl-hint">
            {src === 'bing'
                ? '没有搜到图片 —— 换个关键词（比如只留作品名、去掉副标题）'
                : '这一家没搜到带封面的结果 —— 换个关键词，或换一个平台试试'}
        </div>
    {/if}

    {#if rows.length}
        <div class="rl-ps-grid">
            {#each rows as c (c.murl)}
                <button
                    class="rl-ps-card"
                    disabled={!!picking}
                    class:is-busy={picking === c.murl}
                    on:click={() => void choose(c)}
                    data-tip={`${candTitle(c)}\n来源：${posterDomainLabel(c)}\n点击下载这张并设为封面`}>
                    {#if deadThumbs[c.murl]}
                        <span class="rl-ps-ph" aria-hidden="true"><Icon icon="image-off" size={16} /></span>
                    {:else}
                        <img
                            class="rl-ps-thumb"
                            src={thumbSrc(c)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            referrerpolicy="no-referrer"
                            on:error={() => onThumbError(c)} />
                    {/if}
                    <span class="rl-ps-meta">
                        <span class="rl-ps-t">{candTitle(c)}</span>
                        <span class="rl-ps-d">{posterDomainLabel(c)}</span>
                    </span>
                    {#if picking === c.murl}<span class="rl-ps-mask">下载中…</span>{/if}
                </button>
            {/each}
        </div>
        <div class="rl-ps-foot">
            <button class="rl-btn" disabled={busy || page <= 1} on:click={() => void runSearch(page - 1)} data-tip="上一页 35 张">上一页</button>
            <span class="rl-ps-page">第 {page} 页 · 共 {rows.length} 张</span>
            <button class="rl-btn" disabled={busy} on:click={() => void runSearch(page + 1)} data-tip="下一页 35 张">下一页</button>
        </div>
    {/if}
</div>

<style>
    .rl-ps { display: flex; flex-direction: column; gap: 8px; }
    .rl-ps-bar { display: flex; gap: 6px; }
    /* #509 来源胶囊（网络搜索 / 网易云 / QQ音乐 / 酷狗 / 酷我）——
       ⚠️ 与「下载歌曲」窗口的平台胶囊**逐值一致**（那边是 `.rl-dl-cap`，scoped 在另一个组件里，
          拿不到 ⇒ 这里照样写一份。⛔ 改口径时**两边都要改**：它们是同一个视觉语言的两次落地）。
       ⛔ 悬停**只变文字色**（本仓约定：并排切换类按钮不铺底色）。 */
    .rl-ps-src { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .rl-ps-chip {
        padding: 2px 10px;
        border: none;
        border-radius: 4px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        box-shadow: none;
        font-size: var(--font-ui-smaller);
        cursor: pointer;
    }
    .rl-ps-chip.is-on { background: var(--text-accent); color: var(--text-on-accent); font-weight: 600; }
    .rl-ps-chip:disabled { opacity: 0.55; cursor: default; }
    .rl-ps-chip:not(.is-on):hover { color: var(--interactive-accent); }    /* 输入框吃满、按钮不缩 */
    .rl-ps-q { flex: 1 1 auto; min-width: 0; }
    .rl-ps-bar .rl-btn { flex: none; display: inline-flex; align-items: center; gap: 4px; }
    /* 网格：随宽度自动定列（手机/窄窗都能用），⛔ 别写死列数 */
    .rl-ps-grid {
        display: grid; gap: 8px;
        grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
        max-height: min(52vh, 460px); overflow-y: auto; padding-right: 2px;
    }
    .rl-ps-card {
        position: relative; display: flex; flex-direction: column; gap: 4px; padding: 4px;
        /* 🔴🔴 这三行是**必须的**：宿主 app.css 有一条「裸 button」规则
           （`display: inline-flex; align-items: center; justify-content: center;
             height: var(--input-height); white-space: nowrap`），而 `--input-height` = **30px** ⇒ 不覆盖的话：
             ⑴ 卡片是个 **30px 高的方块**（缩略图溢出去、被网格的 `overflow` 裁掉）；
             ⑵ `align-items: center` 让子项**不再撑满一列** ⇒ 长标题把 `.rl-ps-meta` 撑成 max-content 宽
                （仿真页实测 **319px**，比卡片本身 114px 宽得多），网格因此多出一条横向滚动条；
             ⑶ `white-space: nowrap` 被**继承**下去 ⇒ 标题永远只有一行（`-webkit-line-clamp: 2` 形同虚设）。
           本仓已有同族账（`styles.css` 里 `.rl-ai-name-row .rl-ai-prompt-btn` 那条注释写过同一件事）。
           ⚠️ 这三条都由断言钉住（源码侧 + 产物侧）。 */
        height: auto;
        align-items: stretch;
        white-space: normal;
        border: 1px solid var(--background-modifier-border); border-radius: var(--rl-t-radius-md, 6px);
        background: var(--background-primary); cursor: pointer; font-family: inherit; text-align: left;
    }
    .rl-ps-card:hover { border-color: var(--interactive-accent); }
    .rl-ps-card.is-busy { border-color: var(--interactive-accent); }
    .rl-ps-thumb, .rl-ps-ph {
        width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block;
        border-radius: 4px; background: var(--background-secondary);
    }
    .rl-ps-ph { display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
    .rl-ps-meta { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .rl-ps-t {
        font-size: 11px; color: var(--text-normal); line-height: 1.3;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .rl-ps-d { font-size: 10px; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* 下载中遮罩：盖在缩略图上（⛔ 不用整页禁用 —— 那样用户看不到是哪一张在忙） */
    .rl-ps-mask {
        position: absolute; left: 4px; top: 4px; right: 4px; height: calc(100% - 42px);
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .45); color: #fff; font-size: 11px; border-radius: 4px;
    }
    .rl-ps-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .rl-ps-page { font-size: 11px; color: var(--text-muted); }
</style>
