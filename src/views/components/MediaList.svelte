<script lang="ts">
    import { tick } from 'svelte';
    import { MEDIA_STATUSES, canTransition } from 'pure/status';
    import type { SortBy } from 'pure/search';
    import { statusLabel, overviewUnitLabel } from 'pure/labels';
    import { actionAriaLabel, actionIcon, actionMenuTitle, actionReadyHint, actionUnavailableHint, hasActionEntry } from 'pure/actionLabel';
    import { starString, starClass } from 'pure/rating';
    import { describeBulkApply } from 'pure/bulkConfirm';
    import { filterAndSort } from 'pure/search';
    import { groupMusicByArtist } from 'pure/musicGroup';
    import { cardSubtitle, hasCardSubtitle, cardCreator, hasCardCreator, cardGenres, hasCardGenres } from 'pure/cardMeta';
    import { resolveAddType } from 'pure/focusType';
    import { placeMenu } from 'pure/menuPlacement';
    import { ENTRY_TYPES, ENTRY_TYPE_LABELS, TYPE_COLORS, type ColorTheme, type EntryType } from 'data/types';
    import type { MediaEntry, MediaStatus } from 'data/types';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    /** 书籍摘抄计数（bookId → 摘抄区块数），卡片徽标数据源 */
    export let excerptCounts: Record<string, number> = {};
    export let onAdd: (t?: EntryType) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenEntry: (id: string) => void = () => {};
    export let onOpenLink: (url: string) => void = () => {};
    /** 主操作按钮（影视观看/书籍阅读/游戏启动/音乐播放）：plugin 层按类型分流执行 */
    export let onWatch: (e: MediaEntry) => void = () => {};
    /** 右键「动词 · 去关联」直达：无入口时点主操作 → 快捷关联弹窗（不再整表单跳转） */
    export let onQuickAssociate: (e: MediaEntry) => void = () => {};
    export let onSetStatus: (id: string, s: MediaStatus) => Promise<void> = async () => {};
    export let onMarkUpdated: (id: string) => Promise<void> = async () => {};
    export let onDeleteEntry: (id: string) => Promise<void> = async () => {};
    /** 批量删除（多选）：一次 Modal 确认后逐条删（plugin.deleteEntries） */
    export let onBulkDelete: (ids: string[]) => Promise<void> = async () => {};
    /** 书籍卡片右键「添加摘抄」：打开摘抄弹窗并固定挂载该书 */
    export let onAddExcerpt: (book: MediaEntry) => void = () => {};
    /** 游戏卡片右键「记录游玩」：打开游玩记录弹窗并固定挂载该游戏 */
    export let onOpenGameSessionModal: (game: MediaEntry) => void = () => {};
    /** 批量设置个人评分（rating 0 = 清除） */
    export let onBulkRating: (ids: string[], rating: number) => Promise<void> = async () => {};
    /** 批量追加标签（合并去重） */
    export let onBulkTags: (ids: string[], tags: string[]) => Promise<void> = async () => {};
    /** 批量应用前置确认（批B）：返回 false = 用户取消。无撤销栈，把关口前移到动手之前 */
    export let onConfirmBulk: (message: string) => Promise<boolean> = async () => true;
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    /** 色彩主题：彩色显示类型色条；单色关闭（设置页配置，v0.4 起固定单色） */
    export let colorTheme: ColorTheme = 'colorful';
    /** 书架默认视图（设置页配置）：海报墙 grid / 列表 list；页内切换只影响本次 */
    export let defaultViewMode: 'grid' | 'list' = 'grid';
    /** 锁定类型（Tab 维度的分类视图）：传入时 typeFilter 受控，工具栏不显示类型 chips */
    export let lockType: EntryType | null = null;
    /** 类型池限制（聚合页签如「影视」）：传入时筛选 chips 只显示这些类型；null 显示全部类型 */
    export let typePool: EntryType[] | null = null;

    let viewMode: 'grid' | 'list' | 'masonry' | 'grouped' = defaultViewMode;
    /** 瀑布流列数（按窗口宽度初始化：宽窗 6 列 / 中窗 4 列 / 窄窗 3 列） */
    function initialMasonryCols(): number {
        if (typeof window === 'undefined') return 4;
        const w = window.innerWidth;
        return w > 1300 ? 6 : w > 900 ? 4 : 3;
    }
    let masonryCols = initialMasonryCols();
    /** 瀑布流分列：纯封面等高卡片，轮流放入各列（保持排序结果从左到右横排，非 CSS columns 竖排） */
    $: masonryBuckets = splitMasonry(filtered, masonryCols);
    function splitMasonry(items: MediaEntry[], cols: number): MediaEntry[][] {
        const out: MediaEntry[][] = Array.from({ length: cols }, () => []);
        items.forEach((it, idx) => out[idx % cols].push(it));
        return out;
    }
    let statusFilter: MediaStatus | 'all' = 'all';
    let typeFilter: 'all' | EntryType = lockType ?? 'all';
    // 页签切换同步：单类型页签锁死该类型；聚合页签（影视）重置为「全部」——
    // 否则组件被 Svelte 复用时 typeFilter 停留在上一个页签的类型，切回影视页签卡片不显示
    $: if (lockType) typeFilter = lockType;
    else typeFilter = 'all';
    /** 空状态文案按锁定类型动态化（聚合页签用通用「库」文案；音乐页签不再显示「书架」） */
    function emptyText(): string {
        switch (lockType) {
            case 'book':
                return '书架还是空的 — 点「＋ 添加」录入第一本书';
            case 'game':
                return '游戏库还是空的 — 点「＋ 添加」录入第一款游戏';
            case 'music':
                return '歌单还是空的 — 点「＋ 添加」录入第一首歌';
            default:
                // movie/tv/anime 单类型页签与聚合页签共用通用文案
                return '库还是空的 — 点「＋ 添加」录入第一条条目';
        }
    }
    let sortBy: SortBy = 'recent';
    /** 表头点击排序（列表视图）：列 → [asc, desc] 值对；点击同列翻转方向，首次点击默认升序 */
    function toggleSort(col: 'title' | 'year' | 'status' | 'score' | 'myrating'): void {
        const pairs: Record<string, [SortBy, SortBy]> = {
            title: ['title-asc', 'title-desc'],
            year: ['release-asc', 'release-desc'],
            status: ['status-asc', 'status-desc'],
            score: ['score-asc', 'score-desc'],
            myrating: ['myrating-asc', 'myrating-desc'],
        };
        const [asc, desc] = pairs[col];
        sortBy = sortBy === asc ? desc : sortBy === desc ? asc : asc;
    }
    /** 表头排序指示：当前排序列 asc 显示 ▲、desc 显示 ▼、其他列空 */
    function sortArrow(col: 'title' | 'year' | 'status' | 'score' | 'myrating'): string {
        const asc: Record<string, SortBy> = { title: 'title-asc', year: 'release-asc', status: 'status-asc', score: 'score-asc', myrating: 'myrating-asc' };
        const desc: Record<string, SortBy> = { title: 'title-desc', year: 'release-desc', status: 'status-desc', score: 'score-desc', myrating: 'myrating-desc' };
        if (sortBy === asc[col]) return ' ▲';
        if (sortBy === desc[col]) return ' ▼';
        return '';
    }
    /** 列表视图进度列：百分比 + 进度条（书/剧集有总量）；阅读器进度（percent 无页码）显示百分比；无总量回退文本 */
    function listProgress(e: MediaEntry): { text: string; pct?: number } {
        if (e.type === 'book') {
            const rp = e.readingProgress;
            if (rp?.totalPage) {
                const p = rp.page ?? 0;
                return { text: `${p}/${rp.totalPage} ${bookUnitOf(e)}`, pct: readPct(e) };
            }
            if (typeof rp?.percent === 'number') {
                return { text: `已读 ${readPct(e)}%`, pct: readPct(e) };
            }
            return { text: '' };
        }
        // 列表进度列仅在「在看」状态对剧集/动画有意义——想看（待开始）/已看（已看完）/存档 都不应显示追剧进度
        if ((e.type === 'tv' || e.type === 'anime') && e.status === 'watching' && e.progress) {
            const s = `S${e.progress.season}E${e.progress.episode}`;
            if (e.progress.totalEpisodes && e.progress.totalEpisodes > 0) {
                const pct = Math.max(0, Math.min(100, Math.round((e.progress.episode / e.progress.totalEpisodes) * 100)));
                return { text: s, pct };
            }
            return { text: s };
        }
        if (e.type === 'game' && e.playtimeMinutes) {
            return { text: `已玩 ${Math.round(e.playtimeMinutes / 60)}h` };
        }
        return { text: '' };
    }
    let searchText: string = '';
    let menuOpenFor: string | null = null;
    /** 右键菜单状态：条目 id + 定位坐标（相对 anchor 容器） */
    let ctxFor: string | null = null;
    let ctxX = 0;
    let ctxY = 0;
    /** 菜单超出视口可用区域时的封顶尺寸（视口过矮/过窄时给菜单内部滚动用） */
    let ctxMaxH: number | undefined = undefined;
    let ctxMaxW: number | undefined = undefined;
    let ctxAnchorEl: HTMLDivElement | null = null;
    let ctxMenuEl: HTMLDivElement | null = null;
    /** 菜单外点击 / Esc 关闭的 window 监听（每次打开重新绑定，关闭时摘除，避免累积） */
    let ctxOnDown: ((ev: MouseEvent) => void) | null = null;
    let ctxOnKey: ((ev: KeyboardEvent) => void) | null = null;
    /** 批量选择（列表视图 checkbox） */
    let selectedIds: Set<string> = new Set();
    let bulkStatus: MediaStatus | '' = '';
    let bulkRating = 0;
    let bulkTagsText = '';

    /** 筛选栏状态 chips：全部/想看/在看/已看/存档（弃剧已移除） */
    const statusChips: (MediaStatus | 'all')[] = ['all', 'want', 'watching', 'watched', 'archived'];
    /** 类型筛选 chips：受 typePool 限制（聚合页签仅影视三类）；null 时显示全部类型 */
    $: typeChips = (['all'] as ('all' | EntryType)[]).concat(typePool ?? ENTRY_TYPES);
    /** 排序下拉选项：每项排序成对提供正/反向（标题 A-Z/Z-A；其余 ↓=新/高在前，↑=旧/低在前）——底层 filterAndSort 12 向已实现，仅下拉曾砍剩默认方向 */
    const SORT_OPTIONS: { value: SortBy; label: string }[] = [
        { value: 'recent', label: '最近更新 ↓' },
        { value: 'recent-asc', label: '最近更新 ↑' },
        { value: 'release-desc', label: '发布日期 ↓' },
        { value: 'release-asc', label: '发布日期 ↑' },
        { value: 'title-asc', label: '标题 A-Z' },
        { value: 'title-desc', label: '标题 Z-A' },
        { value: 'score-desc', label: '大众评分 ↓' },
        { value: 'score-asc', label: '大众评分 ↑' },
        { value: 'myrating-desc', label: '个人评分 ↓' },
        { value: 'myrating-asc', label: '个人评分 ↑' },
    ];

    // 概览量词（「N X」里的 X）：映射下沉到 pure/labels.overviewUnitLabel，避免此处逐类型 if 链漏项
    $: overviewUnit = overviewUnitLabel(lockType ?? (typeFilter !== 'all' ? typeFilter : null));

    /** 搜索占位符随当前类型动态（书籍=书名/作者、游戏=标题/开发商、音乐=标题/作者，均已真实参与 matchesSearch；影视仅标题可搜，原名不宣传） */
    $: searchPlaceholder = (() => {
        const t = lockType ?? (typeFilter !== 'all' ? typeFilter : null);
        if (t === 'book') return '搜索书名、作者…';
        if (t === 'game') return '搜索标题、开发商…';
        if (t === 'music') return '搜索标题、作者…';
        return '搜索标题…';
    })();

    /** 大众评分来源标签（阶段6：★ 8.3 豆瓣） */
    function sourceLabel(s: string | undefined): string {
        return s === 'douban' ? '豆瓣' : s === 'tmdb' ? 'TMDB' : s === 'bangumi' ? 'Bangumi' : s === 'google' ? 'Google' : s === 'openlibrary' ? 'Open Library' : '';
    }

    // C2 搜索防抖：输入 300ms 后才过滤，百级条目不卡
    let debouncedSearch = '';
    let searchTimer: number | undefined;
    $: {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
            debouncedSearch = searchText;
        }, 300);
    }

    // 纯逻辑下沉的搜索/筛选/排序（pure/search.filterAndSort）：保证单测可锁定回归
    $: filtered = filterAndSort(entries, {
        status: statusFilter,
        type: lockType ?? typeFilter,
        query: debouncedSearch,
        sortBy,
    });

    // 音乐页签歌单：按歌手分组（组名拼音序，未分类置底；组内专辑→年份→标题），纯逻辑见 pure/musicGroup
    $: musicGroups = lockType === 'music' ? groupMusicByArtist(filtered) : [];

    // 状态/类型计数必须是 reactive（依赖 entries 直接暴露给编译器）：
    // 之前是普通 const 函数闭包引用 entries，Svelte 编译器不追踪函数体内依赖，
    // 状态切换/增删后 statusbar 与类型 chips 的数字停在旧值（与 tabCount 同一类 bug）
    $: statusCounts = (() => {
        // 池子同时反映「锁定类型」与「类型筛选」：聚合页签（影视，lockType=null）下切换
        // 动画/电影/电视剧 chips 时 typeFilter 变化，总数须跟随当前分类而非恒等于全部影视数，
        // 否则会出现「切换任一分类都显示总数 9」的虚增计数 bug
        const activeType = lockType ?? typeFilter;
        const pool = activeType === 'all'
            ? entries
            : entries.filter((e) => e.type === activeType);
        const out: Record<MediaStatus | 'all', number> = { all: pool.length };
        for (const s of MEDIA_STATUSES) out[s] = pool.filter((e) => e.status === s).length;
        return out;
    })();
    $: typeCounts = (() => {
        const out: Record<'all' | EntryType, number> = { all: entries.length };
        for (const t of ENTRY_TYPES) out[t] = entries.filter((e) => e.type === t).length;
        return out;
    })();

    function toggleMenu(id: string) {
        menuOpenFor = menuOpenFor === id ? null : id;
    }

    async function applyStatus(e: MediaEntry, s: MediaStatus) {
        menuOpenFor = null;
        await onSetStatus(e.id, s);
    }

    /** 底部进度/信息行：书籍页码/阅读百分比、游戏时长（年份并入 subtitle 第二层，阶段3 层级重构） */
    function progressText(e: MediaEntry): string {
        if (e.type === 'book') {
            const rp = e.readingProgress;
            if (rp?.totalPage) return `${rp.page ?? 0}/${rp.totalPage} 页`;
            if (typeof rp?.percent === 'number') return `已读 ${readPct(e)}%`;
            return '';
        }
        if (e.type === 'game' && e.playtimeMinutes) {
            const h = Math.round(e.playtimeMinutes / 60);
            return `已玩 ${h}h`;
        }
        return '';
    }

    /** 大众评分数字格式化：整数去小数点（10 分制/5 分制均可） */
    function scoreText(e: MediaEntry): string {
        if (e.communityScore == null) return '';
        const n = Number(e.communityScore);
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }

    /** 状态 Badge 语义图标（○想看 / ●在看 / ✓已看 / ▢存档，字符统一风格） */
    function statusIcon(s: MediaStatus): string {
        return s === 'want' ? '○' : s === 'watching' ? '●' : s === 'watched' ? '✓' : s === 'archived' ? '▢' : '';
    }

    /** 豆瓣图床防盗链：无 Referer 返回 418，需 img referrerpolicy="unsafe-url" */
    function isDoubanImage(u: string | undefined): boolean {
        return !!u && /doubanio\.com/.test(u);
    }

    /** 阅读进度百分比（0-100）：阅读器进度 percent 优先（自动落库）；无则回退手填页码进度；未开始返回 undefined 不渲染灰线 */
    function readPct(e: MediaEntry): number | undefined {
        const rp = e.readingProgress;
        if (e.type !== 'book') return undefined;
        if (typeof rp?.percent === 'number') return Math.max(0, Math.min(100, Math.round(rp.percent)));
        // 仅 totalPage（自动解析未手填当前页）：按 0 计算，进度行照常渲染（0/N）
        if (!rp?.totalPage) return undefined;
        return Math.max(0, Math.min(100, Math.round(((rp.page ?? 0) / rp.totalPage) * 100)));
    }

    /** 书籍进度单位：关联 TXT（按章节解析）→ 章，其余（PDF/手填/豆瓣兜底）→ 页 */
    function bookUnitOf(e: MediaEntry): string {
        return e.bookFile?.toLowerCase().endsWith('.txt') ? '章' : '页';
    }

    // ── B3 右键菜单 ──
    /** 打开右键菜单：锚点容器内绝对定位（避开 Obsidian transform 祖先导致 fixed 偏移的问题）。
     *  边界自适应走 pure/menuPlacement：**视口系**算好落点（贴鼠标 → 越界翻转 → 仍越界钳制 → 超高封顶），
     *  最后减去锚点视口偏移换算回锚点相对坐标——旧实现直接用锚点相对量与视口宽高比较，锚点越靠内容末尾越失准。 */
    async function openCtx(e: MediaEntry, ev: MouseEvent) {
        ev.preventDefault();
        unbindCtxWindow();
        ctxFor = e.id;
        ctxX = 0;
        ctxY = 0;
        ctxMaxH = undefined;
        ctxMaxW = undefined;
        await tick(); // 等 anchor 与菜单渲染
        const anchor = ctxAnchorEl;
        if (!anchor) return;
        const a = anchor.getBoundingClientRect();
        const menu = ctxMenuEl;
        const m = menu?.getBoundingClientRect();
        const p = placeMenu({
            x: ev.clientX,
            y: ev.clientY,
            menuW: m?.width ?? 0,
            menuH: m?.height ?? 0,
            vw: window.innerWidth,
            vh: window.innerHeight,
        });
        ctxMaxW = p.maxWidth;
        ctxMaxH = p.maxHeight;
        // 视口坐标 → 锚点相对坐标（菜单 absolute 挂在 .rl-ctx-anchor 上）
        ctxX = p.left - a.left;
        ctxY = p.top - a.top;
        // 点击菜单外 / Esc 关闭（本次会话内唯一一对监听，关闭时摘除）
        ctxOnDown = () => closeCtx();
        ctxOnKey = (ev2: KeyboardEvent) => { if (ev2.key === 'Escape') closeCtx(); };
        window.addEventListener('mousedown', ctxOnDown);
        window.addEventListener('keydown', ctxOnKey);
    }
    function unbindCtxWindow() {
        if (ctxOnDown) { window.removeEventListener('mousedown', ctxOnDown); ctxOnDown = null; }
        if (ctxOnKey) { window.removeEventListener('keydown', ctxOnKey); ctxOnKey = null; }
    }
    function closeCtx() {
        unbindCtxWindow();
        ctxFor = null;
    }
    /** 类型化主操作（阅读/观看/播放/启动）：入口可用直接执行；不可用 → 快捷关联弹窗直达（不再先开编辑表单） */
    function ctxPrimary(e: MediaEntry) {
        closeCtx();
        if (hasActionEntry(e)) onWatch(e);
        else onQuickAssociate(e);
    }
    /** 右键主操作 title：可用=实际动作描述；不可用=去关联提示（点击直达快捷关联弹窗） */
    function ctxPrimaryHint(e: MediaEntry): string {
        return hasActionEntry(e) ? actionReadyHint(e.type) : actionUnavailableHint(e.type);
    }
    async function ctxDelete(e: MediaEntry) {
        closeCtx();
        // 确认在 plugin.deleteEntry 内（Modal 确认，替代 window.confirm）
        await onDeleteEntry(e.id);
    }
    // ── B5 批量操作 ──
    function toggleSelect(id: string) {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selectedIds = next;
    }
    function clearSelection() {
        selectedIds = new Set();
    }
    /** 表头全选三态：○ 未选 / ⦿ 部分选（indeterminate）/ ⦿ 全选当前过滤结果 */
    let headCb: HTMLInputElement | null = null;
    $: visibleIds = filtered.map((e) => e.id);
    $: allChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    $: someChecked = selectedIds.size > 0 && !allChecked;
    $: if (headCb) headCb.indeterminate = someChecked && !allChecked;
    function toggleSelectAll() {
        if (allChecked) selectedIds = new Set();
        else selectedIds = new Set(visibleIds);
    }
    /** 批量应用：状态 / 评分 / 标签三组设置共用一个「应用」按钮，一次全部应用到选中条目 */
    async function applyBulkAll() {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        const status = bulkStatus;
        const rating = bulkRating;
        const tags = bulkTagsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        // 批B 前置确认：本插件不为批量操作提供撤销（回滚要重建笔记与目录项，冲突风险高），
        // 因此把关口前移到动手之前——先把「多少项、改什么」说清楚再执行。
        // 无可应用项时 describeBulkApply 返回 null（不弹空确认框），等价于原来的「三项全空直接返回」。
        const confirmText = describeBulkApply({
            count: ids.length,
            statusLabel: status ? statusLabel(lockType ?? 'movie', status) : undefined,
            rating: rating === 0 ? undefined : rating === -1 ? null : rating,
            tags,
        });
        if (!confirmText) return;
        if (!(await onConfirmBulk(confirmText))) return; // 取消 → 保留当前勾选与表单值，不改动任何数据
        clearSelection();
        bulkStatus = '';
        bulkRating = 0;
        bulkTagsText = '';
        if (status) {
            for (const id of ids) {
                try {
                    await onSetStatus(id, status);
                } catch {
                    // 单条失败不阻断其余
                }
            }
        }
        if (rating) {
            try {
                await onBulkRating(ids, rating === -1 ? 0 : rating);
            } catch {
                // 批量失败不阻断后续操作
            }
        }
        if (tags.length > 0) {
            try {
                await onBulkTags(ids, tags);
            } catch {
                // 批量失败不阻断
            }
        }
    }
    async function bulkDelete() {
        const ids = [...selectedIds];
        if (ids.length === 0) return;
        clearSelection();
        // 确认在 plugin.deleteEntries 内（一次 Modal 确认，替代 window.confirm）
        await onBulkDelete(ids);
    }
    function hash(s: string): number {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return h;
    }
</script>

<!-- 层2：搜索（定宽）+ 添加 + 概览（小字弱化置右） -->
<div class="rl-toolbar">
    <input
        class="rl-search"
        type="search"
        placeholder={searchPlaceholder}
        bind:value={searchText}
        aria-label="搜索条目"
        on:keydown={(ev) => { if (ev.key === 'Escape') searchText = ''; }}
    />
    <!-- 影视聚合页签「添加跟随聚焦」：聚焦 动画/电视剧/电影 时新增表单默认该类型（规则见 pure/focusType）；聚焦「全部」→ undefined = EntryForm 默认电影；单类型页签恒锁 lockType -->
    <button class="rl-add mod-cta" on:click={() => onAdd(resolveAddType(lockType, typeFilter))}><Icon icon="plus" size={14} /> 添加</button>
    <span class="rl-libstats" role="group" aria-label="库概览">
        <span class="rl-libstats-total">{statusCounts.all} {overviewUnit}</span>
    </span>
</div>

<!-- 层3：类型 Pill（居左，分类导航感）+ 状态下拉 + 排序下拉 + 视图（一行，无边框） -->
<div class="rl-viewbar">
    {#if !lockType}
        <span class="rl-vb-group" role="group" aria-label="类型筛选">
            {#each typeChips as t}
                <button class:on={typeFilter === t} on:click={() => (typeFilter = t)}>
                    {t === 'all' ? '全部' : ENTRY_TYPE_LABELS[t]}<span class="rl-cnt">{typeCounts[t]}</span>
                </button>
            {/each}
        </span>
        <span class="rl-vb-sep" aria-hidden="true"></span>
    {/if}
    <span class="rl-vb-select">
        <span class="rl-sel-label">状态</span>
        <select class="rl-sort-select" bind:value={statusFilter} aria-label="状态筛选">
            {#each statusChips as s}
                <option value={s}>{s === 'all' ? '全部' : statusLabel(lockType ?? 'movie', s)}</option>
            {/each}
        </select>
    </span>
    {#if viewMode === 'grid'}
        <span class="rl-vb-select">
            <span class="rl-sel-label">排序</span>
            <select class="rl-sort-select" bind:value={sortBy} aria-label="排序方式">
                {#each SORT_OPTIONS as o}
                    <option value={o.value}>{o.label}</option>
                {/each}
            </select>
        </span>
    {/if}
    <span class="rl-vb-view" role="group" aria-label="视图切换">
        <button class:on={viewMode === 'grid'} on:click={() => (viewMode = 'grid')}>▦<span class="rl-sr">海报墙视图</span></button>
        <button class:on={viewMode === 'list'} on:click={() => (viewMode = 'list')}>☷<span class="rl-sr">列表视图</span></button>
        <button class:on={viewMode === 'masonry'} on:click={() => (viewMode = 'masonry')}>▥<span class="rl-sr">瀑布流视图</span></button>
        {#if lockType === 'music'}
            <button class:on={viewMode === 'grouped'} on:click={() => (viewMode = 'grouped')}>☰<span class="rl-sr">分组歌单视图</span></button>
        {/if}
    </span>
</div>

{#if selectedIds.size > 0}
    <div class="rl-batchbar">
        <span class="rl-batch-cnt">已选 {selectedIds.size} 项</span>
        <select bind:value={bulkStatus} aria-label="批量状态">
            <option value="">批量改状态…</option>
            {#each MEDIA_STATUSES as s}
                <option value={s}>{statusLabel(lockType ?? 'movie', s)}</option>
            {/each}
        </select>
        <select bind:value={bulkRating} aria-label="批量评分">
            <option value={0}>批量评分…</option>
            {#each [1, 2, 3, 4, 5] as n}
                <option value={n}>{n}★</option>
            {/each}
            <option value={-1}>清除评分</option>
        </select>
        <input class="rl-batch-tags" placeholder="批量标签（逗号分隔）" bind:value={bulkTagsText} aria-label="批量标签" />
        <button class="rl-batch-btn" disabled={!bulkStatus && !bulkRating && !bulkTagsText.trim()} on:click={applyBulkAll} data-tip="应用到选中条目">应用</button>
        <button class="rl-batch-btn rl-batch-danger" on:click={bulkDelete}>删除</button>
        <button class="rl-batch-btn" on:click={clearSelection}>取消选择</button>
    </div>
{/if}

{#if lockType === 'music' && viewMode === 'grouped'}
    <!-- 音乐「分组歌单」视图（可切换；组头（歌手 + 计数）→ 组内窄行（封面/歌名/专辑·年份/状态/播放/编辑）） -->
    {#each musicGroups as g}
        <div class="rl-music-group">
            <div class="rl-music-group-head">{g.artist}<span class="rl-music-cnt">{g.entries.length} 首</span></div>
            {#each g.entries as e (e.id)}
                <div class="rl-music-row" class:rl-sel-card={selectedIds.has(e.id)} on:click={() => onOpenEntry(e.id)} on:contextmenu={(ev) => openCtx(e, ev)}>
                    {#if posterUrl(e)}
                        <img class="rl-music-cov" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                    {:else}
                        <div class="rl-music-cov rl-music-cov-ph" aria-hidden="true"><Icon icon="music" size={15} /></div>
                    {/if}
                    <div class="rl-music-info">
                        <div class="rl-music-title" data-tip={e.title}>{e.title}</div>
                        <div class="rl-music-sub" data-tip={hasCardSubtitle(e) ? cardSubtitle(e) : ''}>{cardSubtitle(e)}</div>
                    </div>
                    <div class="rl-music-meta">
                        <span class="rl-badge rl-badge-{e.status}" on:click={(ev) => { ev.stopPropagation(); toggleMenu(e.id); }}>
                            {statusIcon(e.status)} {statusLabel(e.type, e.status)}
                        </span>
                        {#if e.rating > 0}
                            <span class="rl-my-inline" data-tip="我的评分">{starString(e.rating)}</span>
                        {/if}
                    </div>
                    <div class="rl-music-ops">
                        {#if e.audioPath}
                            <button class="rl-music-play" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon="play" size={13} /><span class="rl-sr">播放音乐</span></button>
                        {/if}
                        <button class="rl-music-edit" on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onEditEntry(e.id); }}>✎<span class="rl-sr">编辑条目</span></button>
                    </div>
                </div>
            {/each}
        </div>
    {/each}
    {#if filtered.length === 0}
        <div class="rl-empty">{emptyText()}</div>
    {/if}
{:else if viewMode === 'grid'}
    <div class="rl-grid">
        {#each filtered as e (e.id)}
            <div
                class="rl-card"
                class:rl-sel-card={selectedIds.has(e.id)}
                role="link"
                tabindex="0"
                on:click={() => onOpenEntry(e.id)}
                on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}
                on:contextmenu={(ev) => openCtx(e, ev)}>
                {#if colorTheme === 'colorful'}
                    <div class="rl-type-bar" style={`background:${TYPE_COLORS[e.type]}`}></div>
                {/if}
                <div class="rl-cov-wrap">
                    {#if posterUrl(e)}
                        <img class="rl-cov" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                    {:else}
                        <div class="rl-cov rl-cov-ph" style={`--h:${hash(e.id) % 360}${colorTheme === 'colorful' ? ` --tc:${TYPE_COLORS[e.type]}` : ''}`}><span>{e.title.slice(0, 2)}</span></div>
                    {/if}
                    <!-- Hover 快速操作（阶段6：弱化播放器感——「打开笔记 ↗」文字按钮，而非大 ▶） -->
                    <div class="rl-cov-hover">
                        <button
                            class="rl-hover-more"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); openCtx(e, ev); }}>⋯<span class="rl-sr">更多操作</span></button>
                        <button
                            class="rl-hover-open"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onOpenEntry(e.id); }}>打开笔记 ↗</button>
                    </div>
                    <!-- 主操作按钮：影视（有观看入口）、书籍（有文件）、游戏（有快捷方式）、音乐（有音频）→ 封面右下角圆形，hover 浮现 -->
                    {#if hasActionEntry(e)}
                        <button
                            class="rl-watch-btn"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon={actionIcon(e.type)} size={14} /><span class="rl-sr">{actionAriaLabel(e.type)}</span></button>
                    {/if}
                </div>
                <div class="rl-card-meta">
                    <div class="rl-ttl" data-tip={e.title}>{e.title}</div>
                    <!-- 海报墙防错位：subtitle/creator 两行始终渲染，缺失字段显示「—」占位
                         保证同列卡片元信息行数恒定（卡片 #1 vs #2 vs #3 高度齐平） -->
                    <div class="rl-sub" data-tip={hasCardSubtitle(e) ? cardSubtitle(e) : ''}>{cardSubtitle(e)}</div>
                    <div class="rl-creator" data-tip={hasCardCreator(e) ? cardCreator(e) : ''}>{cardCreator(e)}</div>
                    <!-- 题材行恒渲染（缺题材显示「—」同款占位）：空题材卡片不再整行消失，行数恒定防同排错位 -->
                    <div class="rl-tags" data-tip={hasCardGenres(e) ? e.genres.join(' · ') : ''}>{cardGenres(e)}</div>
                    {#if progressText(e) && e.type !== 'book'}
                        <div class="rl-prog">{progressText(e)}</div>
                    {:else if e.type === 'game'}
                        <!-- 游戏未填游玩时长：进度行恒渲染，「-」灰字空值占位（与已填「已玩 Xh」行高等高，防卡片错位） -->
                        <div class="rl-prog rl-prog-na">-</div>
                    {/if}
                    <div class="rl-row1">
                        <span class="rl-badge rl-badge-{e.status}" on:click={(ev) => { ev.stopPropagation(); toggleMenu(e.id); }}>
                            {statusIcon(e.status)} {statusLabel(e.type, e.status)}
                        </span>
                        {#if e.rating > 0}
                            <span class="rl-my-inline" data-tip="我的评分">{starString(e.rating)}</span>
                        {/if}
                        {#if scoreText(e)}
                            <span class="rl-score" data-tip={`大众评分（数据源：${sourceLabel(e.source) || '—'}）`}>★ {scoreText(e)}{sourceLabel(e.source) ? ` ${sourceLabel(e.source)}` : ''}</span>
                        {/if}
                    </div>
                    <div class="rl-row2">
                        {#if e.type === 'book' && (excerptCounts[e.id] ?? 0) > 0}
                            <span class="rl-ex-cnt" data-tip={`《${e.title}》摘抄 ${excerptCounts[e.id]} 条`}>摘抄 {excerptCounts[e.id]}</span>
                        {/if}
                    </div>
                    {#if readPct(e) !== undefined}
                        <div class="rl-readrow">
                            <span class="rl-read-pct">{readPct(e)}%</span>
                            <div class="rl-readbar"><div class="rl-readbar-fill" style={`width:${readPct(e)}%`}></div></div>
                            {#if e.readingProgress?.totalPage}
                                <span class="rl-read-pages">{e.readingProgress.page ?? 0}/{e.readingProgress.totalPage} {bookUnitOf(e)}</span>
                            {/if}
                        </div>
                    {/if}
                </div>
                {#if menuOpenFor === e.id}
                    <div class="rl-menu" on:click={(ev) => ev.stopPropagation()}>
                        {#each MEDIA_STATUSES as s}
                            <button
                                class:rl-sel={s === e.status}
                                class:rl-illegal={!canTransition(e.status, s)}
                                disabled={!canTransition(e.status, s)}
                                on:click={() => applyStatus(e, s)}>
                                {statusLabel(e.type, s)}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
    {#if filtered.length === 0}
        <div class="rl-empty">{emptyText()}</div>
    {/if}
{:else if viewMode === 'masonry'}
    <!-- 瀑布流：默认纯封面，hover 浮出标题/评分/年份；点击打开条目、右键菜单，顺序保持排序结果 -->
    <div class="rl-masonry">
        {#each masonryBuckets as col}
            <div class="rl-m-col">
                {#each col as e}
                    <div class="rl-m-card" on:click={() => onOpenEntry(e.id)} on:contextmenu={(ev) => openCtx(e, ev)}>
                        {#if posterUrl(e)}
                            <img class="rl-m-cov" src={posterUrl(e)} alt={e.title} loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />
                        {:else}
                            <div class="rl-m-cov rl-m-ph" style={`--tc:${TYPE_COLORS[e.type]}`}><span>{e.title.slice(0, 2)}</span></div>
                        {/if}
                        <div class="rl-m-overlay">
                            <span class="rl-m-title">{e.title}</span>
                            <span class="rl-m-meta">
                                {#if e.year}<span class="rl-m-yr">{e.year}</span>{/if}
                                {#if e.year && scoreText(e)}<span class="rl-m-dot">·</span>{/if}
                                {#if scoreText(e)}<span class="rl-m-sc">★ {scoreText(e)}</span>{/if}
                            </span>
                        </div>
                    </div>
                {/each}
            </div>
        {/each}
    </div>
    {#if filtered.length === 0}
        <div class="rl-empty">{emptyText()}</div>
    {/if}
{:else}
    <table class="rl-table">
        <tr>
            <th class="rl-col-cb"><input type="checkbox" bind:this={headCb} checked={allChecked} on:click={toggleSelectAll} aria-label="全选当前结果" /></th>
            <th class="rl-th-sort" on:click={() => toggleSort('title')} data-tip="按标题排序">标题{sortArrow('title')}</th>
            <th class="rl-th-sort" on:click={() => toggleSort('year')} data-tip="按年份排序">年份{sortArrow('year')}</th>
            <th class="rl-th-sort" on:click={() => toggleSort('status')} data-tip="按状态排序">状态{sortArrow('status')}</th>
            <th class="rl-th-sort" on:click={() => toggleSort('score')} data-tip="按大众评分排序">大众评分{sortArrow('score')}</th>
            <th class="rl-th-sort" on:click={() => toggleSort('myrating')} data-tip="按个人评分排序">个人评分{sortArrow('myrating')}</th>
            <th>进度</th>
            <th>操作</th>
        </tr>
        {#each filtered as e (e.id)}
            {@const lp = listProgress(e)}
            <tr on:click={() => onOpenEntry(e.id)}>
                <td class="rl-col-cb">
                    <input
                        type="checkbox"
                        checked={selectedIds.has(e.id)}
                        on:click={(ev) => { ev.stopPropagation(); toggleSelect(e.id); }} />
                </td>
                <td>
                    {#if posterUrl(e)}<img class="rl-thumb" src={posterUrl(e)} alt="" loading="lazy" decoding="async" referrerpolicy={isDoubanImage(posterUrl(e)) ? 'unsafe-url' : undefined} />{/if}<span
                        class="rl-row-link"
                        role="link"
                        tabindex="0"
                        on:keydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onOpenEntry(e.id); } }}>{e.title}</span>
                </td>
                <td>{e.year ?? '—'}</td>
                <td><span class="rl-badge rl-badge-{e.status}">{statusLabel(e.type, e.status)}</span></td>
                <td>{#if e.communityScore != null}<span class="rl-thumb-score">★ {scoreText(e)}</span>{:else}<span class="rl-thumb-score rl-thumb-score-na">—</span>{/if}</td>
                <td><span class="rl-stars {starClass(e.rating)}">{starString(e.rating)}</span></td>
                <td>
                    {#if lp.text}
                        {#if lp.pct !== undefined}
                            <span class="rl-list-prog">{lp.text} · {lp.pct}%</span>
                            <div class="rl-readbar rl-readbar-inline"><div class="rl-readbar-fill" style={`width:${lp.pct}%`}></div></div>
                        {:else}
                            <span class="rl-list-prog">{lp.text}</span>
                        {/if}
                    {/if}
                </td>
                <td>
                    <button
                        class="rl-edit-row"
                        on:click={(ev) => { ev.stopPropagation(); onEditEntry(e.id); }}>✎<span class="rl-sr">编辑条目</span></button>
                    {#if hasActionEntry(e)}
                        <button
                            class="rl-edit-row rl-edit-watch"
                            on:click={(ev) => { ev.stopPropagation(); ev.currentTarget.blur(); onWatch(e); }}><Icon icon={actionIcon(e.type)} size={14} /><span class="rl-sr">{actionAriaLabel(e.type)}</span></button>
                    {/if}
                </td>
            </tr>
        {/each}
    </table>
{/if}

<div class="rl-ctx-anchor" bind:this={ctxAnchorEl}>
    {#if ctxFor}
        {@const ctxEntry = entries.find((x) => x.id === ctxFor)}
        {#if ctxEntry}
            <div
                class="rl-ctx"
                bind:this={ctxMenuEl}
                style={`left:${ctxX}px;top:${ctxY}px${ctxMaxH !== undefined ? `;max-height:${ctxMaxH}px` : ''}${ctxMaxW !== undefined ? `;max-width:${ctxMaxW}px` : ''}`}
                on:click={(ev) => ev.stopPropagation()}
                on:mousedown={(ev) => ev.stopPropagation()}
                on:contextmenu={(ev) => ev.preventDefault()}>
                <!-- 主操作（四类统一）：入口可用=动词直接执行；不可用=「动词 · 去关联」→ 快捷关联弹窗 -->
                <button on:click={() => ctxPrimary(ctxEntry)} data-tip={ctxPrimaryHint(ctxEntry)}>{actionMenuTitle(ctxEntry)}</button>
                <button on:click={() => { closeCtx(); onEditEntry(ctxEntry.id); }}>编辑条目</button>
                {#if ctxEntry.type === 'book'}
                    <button on:click={() => { closeCtx(); onAddExcerpt(ctxEntry); }} data-tip="从外部阅读器复制文本，生成摘抄块">添加摘抄</button>
                {/if}
                {#if ctxEntry.type === 'game'}
                    <button on:click={() => { closeCtx(); onOpenGameSessionModal(ctxEntry); }} data-tip="日期 + 时长 + 心得，保存到游戏笔记">记录游玩</button>
                {/if}
                <button class="rl-ctx-danger" on:click={() => ctxDelete(ctxEntry)}>删除条目</button>
            </div>
        {/if}
    {/if}
</div>

<style>
    /* 工具栏：搜索框 + 添加按钮整体居中；概览 absolute 钉左（阶段7+） */
    .rl-toolbar { display: flex; gap: 8px; align-items: center; justify-content: center; margin-bottom: 8px; position: relative; }
    .rl-toolbar .rl-libstats {
        position: absolute; left: 0; top: 50%; transform: translateY(-50%);
        display: inline-flex; align-items: center; gap: 5px; flex: none; white-space: nowrap;
        font-size: 10.5px; color: var(--text-faint);
    }
    .rl-libstats-total { font-weight: 600; color: var(--text-muted); }
    .rl-libstats-sep { opacity: .7; }
    .rl-toolbar button {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-muted); border-radius: 6px; padding: 3px 10px; cursor: pointer;
    }
    .rl-toolbar .rl-cnt { opacity: .6; font-size: 10px; }
    /* 搜索框定宽（阶段7+：240~320px，无需通栏拉伸） */
    .rl-toolbar .rl-search {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal); border-radius: 6px;
        padding: 5px 10px; width: 280px; max-width: 320px; min-width: 240px; flex: none;
    }
    .rl-toolbar .rl-search:focus { outline: none; border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-toolbar .rl-search::placeholder { color: var(--text-faint); }
    /* ＋添加：Obsidian 主题 accent 主按钮（mod-cta 语义，随主题变色——阶段7 原生融合） */
    .rl-toolbar .rl-add.mod-cta {
        background: var(--interactive-accent) !important;
        border-color: var(--interactive-accent) !important;
        color: var(--text-on-accent) !important;
        font-weight: 600; flex: none;
    }
    .rl-batchbar { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; padding: 6px 10px; border: 1px solid var(--interactive-accent); border-radius: 8px; background: var(--background-modifier-hover); }
    .rl-batch-cnt { font-size: 12px; font-weight: 600; color: var(--text-normal); }
    .rl-batchbar select, .rl-batchbar button {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-muted); border-radius: 6px; padding: 2px 8px; cursor: pointer;
    }
    .rl-batchbar button:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .rl-batchbar button:disabled { opacity: .4; cursor: not-allowed; }
    .rl-batch-danger { color: var(--rl-danger) !important; border-color: var(--rl-danger) !important; }
    .rl-batch-tags {
        font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border);
        background: var(--background-primary); color: var(--text-normal); border-radius: 6px;
        padding: 2px 8px; min-width: 150px; max-width: 200px;
    }
    .rl-batch-tags::placeholder { color: var(--text-faint); }
    /* 层3 控制栏（阶段7：状态/类型/排序/视图一行，无边框容器——选项为无边框 pill，选中浅背景+accent 文字） */
    .rl-viewbar {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        margin-bottom: 12px;
    }
    .rl-vb-group { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; }
    .rl-vb-group button {
        font-family: inherit; font-size: 12px; color: var(--text-muted);
        background: transparent; border: none; padding: 4px 10px; border-radius: 999px; cursor: pointer;
        transition: background .15s ease, color .15s ease;
    }
    .rl-vb-group button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-vb-group button:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -1px; }
    /* 键盘可达（批C）：卡片与列表标题聚焦时必须有可见指示，否则键盘用户不知道焦点在哪 */
    .rl-card:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: -1px; }
    .rl-row-link:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; border-radius: 3px; }
    .rl-vb-group button.on { background: var(--background-modifier-hover); color: var(--interactive-accent); font-weight: 600; }
    .rl-vb-group .rl-cnt { font-size: 10px; opacity: .6; margin-left: 2px; }
    .rl-vb-group button.on .rl-cnt { opacity: .85; }
    .rl-vb-sep { width: 1px; height: 16px; background: var(--background-modifier-border); margin: 0 6px; flex: none; }
    /* 下拉组（状态/排序）：标签 + select，通用 */
    .rl-vb-select { display: inline-flex; align-items: center; gap: 6px; margin-left: 4px; }
    .rl-sel-label { font-size: 10px; color: var(--text-faint); }
    .rl-sort-select {
        font-family: inherit; font-size: 12px; color: var(--text-normal);
        border: 1px solid var(--background-modifier-border); border-radius: 6px;
        background: var(--background-primary); padding: 2px 8px; cursor: pointer;
    }
    .rl-sort-select:focus { outline: none; border-color: var(--interactive-accent); }
    /* 视图切换：纯图标 + 浅色 hover（阶段7 弱化重背景） */
    .rl-vb-view { display: inline-flex; margin-left: auto; }
    .rl-vb-view button {
        font-family: inherit; font-size: 13px; color: var(--text-muted);
        background: transparent; border: none; padding: 4px 9px; border-radius: 6px; cursor: pointer;
        transition: background .15s ease, color .15s ease;
    }
    .rl-vb-view button:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .rl-vb-view button.on { color: var(--interactive-accent); }
    /* 卡片网格：minmax 180px 自适应（阶段1 空间压缩——卡片更饱满，桌面端 4-6 列），gap 12px */
    .rl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; align-items: stretch; }
    /* 卡片统一尺寸：列内 flex 等高，meta 区域最小高度保证各类型（电影/电视剧/动画/书籍/游戏）
       的卡片在视觉上同高，进度行贴底对齐 */
    .rl-card { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; overflow: hidden; cursor: pointer; position: relative; display: flex; flex-direction: column; }
    .rl-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, .12); }
    .rl-card.rl-sel-card { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
    .rl-type-bar { height: 4px; flex: none; }
    /* Hover 快速操作（阶段6）：封面遮罩，默认透明；「打开笔记 ↗」文字按钮居中、⋯ 更多右上 */
    .rl-cov-wrap { position: relative; }
    .rl-cov-hover {
        position: absolute; inset: 0; z-index: 6;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, .38);
        opacity: 0; transition: opacity .18s ease;
    }
    .rl-card:hover .rl-cov-hover, .rl-card:focus-within .rl-cov-hover { opacity: 1; }
    /* 瀑布流视图：只展示封面的多列流（列内卡片等高，列间自然参差） */
    .rl-masonry { display: flex; gap: 8px; align-items: flex-start; }
    .rl-m-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .rl-m-card { position: relative; border-radius: 6px; overflow: hidden; cursor: pointer; }
    .rl-m-card:hover { box-shadow: 0 2px 8px rgba(0, 0, 0, .16); }
    .rl-m-cov { display: block; width: 100%; height: auto; border-radius: 6px; }
    .rl-m-ph {
        aspect-ratio: 2 / 3; width: 100%; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--tc) 18%, var(--background-secondary));
        color: var(--tc); font-size: 22px; font-weight: 500;
    }
    /* 默认纯封面；hover 才浮出标题/评分/年份（底部渐变托底 + 底部对齐） */
    .rl-m-overlay {
        position: absolute; inset: 0; border-radius: 6px;
        display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
        padding-bottom: 6px;
        background: linear-gradient(0deg, rgba(0, 0, 0, .8), rgba(0, 0, 0, .3) 55%, transparent);
        opacity: 0; transition: opacity .15s ease;
    }
    .rl-m-card:hover .rl-m-overlay { opacity: 1; }
    .rl-m-title { color: #fff; font-size: 12px; font-weight: 500; padding: 0 8px; text-align: center; line-height: 1.4; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rl-m-meta { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
    .rl-m-yr { color: rgba(255, 255, 255, .82); font-size: 10px; }
    .rl-m-dot { color: rgba(255, 255, 255, .5); font-size: 10px; }
    .rl-m-sc { color: #ffd76b; font-size: 10px; font-weight: 600; }
    /* 观看按钮：封面右下角圆形，hover 浮现（z-index 高于 hover 遮罩层）；直达观看语义 */
    .rl-watch-btn {
        position: absolute; right: 8px; bottom: 8px; z-index: 7;
        width: 32px; height: 32px; border-radius: 50%;
        border: none; cursor: pointer;
        background: var(--interactive-accent); color: #fff;
        font-size: 13px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        padding: 0; padding-left: 2px; /* ▶ 视觉居中微调 */
        opacity: 0; transition: opacity .18s ease, transform .15s ease;
    }
    .rl-card:hover .rl-watch-btn, .rl-card:focus-within .rl-watch-btn { opacity: 1; }
    .rl-watch-btn:hover { transform: scale(1.12); }
    .rl-hover-open {
        font-family: inherit; font-size: 12px; font-weight: 600;
        border: none; cursor: pointer; background: rgba(0, 0, 0, .55); color: #fff;
        border-radius: 999px; padding: 7px 14px; line-height: 1;
        transition: background .15s ease, transform .15s ease;
    }
    .rl-hover-open:hover { background: var(--interactive-accent); transform: scale(1.12); }
    .rl-hover-more {
        position: absolute; top: 8px; right: 8px;
        width: 26px; height: 26px; border-radius: 6px;
        border: none; cursor: pointer; background: rgba(0, 0, 0, .55); color: #fff;
        font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center;
        transition: background .15s ease;
    }
    .rl-hover-more:hover { background: var(--interactive-accent); }
    .rl-cov { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--background-secondary); flex-shrink: 0; }
    .rl-cov-ph { display: flex; align-items: flex-end; justify-content: flex-start; padding: 6px; font-size: 12px; color: #fff; background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph:not([style*="--tc"]) { background: hsl(var(--h) 40% 45%); }
    .rl-cov-ph[style*="--tc"] { background: var(--tc); }
    /* 列表视图编辑按钮：默认灰、hover 主题色 + 轻微放大；固定高度 + flex 居中保证与观看按钮绝对等高 */
    .rl-edit-row {
        display: inline-flex; align-items: center; justify-content: center;
        height: 22px; line-height: 1; vertical-align: middle;
        border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted);
        border-radius: 5px; padding: 0 8px; cursor: pointer; font-size: 12px;
        transition: color .15s ease, border-color .15s ease, background .15s ease, transform .12s ease;
    }
    .rl-edit-row + .rl-edit-row { margin-left: 4px; }
    .rl-edit-row:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); transform: scale(1.12); }
    /* 列表视图观看按钮：与编辑按钮统一——未 hover 灰，hover 主题底白字 + 放大（不再常驻主题色） */
    .rl-edit-watch:hover { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); transform: scale(1.12); }
    /* meta 用 flex 1 撑满卡片剩余空间；min-height 让进度行即便短/为空也能与同行卡片等高 */
    .rl-card-meta { padding: 7px 8px; flex: 1 1 auto; display: flex; flex-direction: column; min-height: 74px; }
    /* 视觉层级（阶段3+6）：标题 → 原名·年份 → 创作者 → 标签 → 进度 → 状态+评分 */
    .rl-ttl { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rl-creator { font-size: 10px; color: var(--text-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* 标签行（阶段6：前 2 个标签，知识库感；多标签 title 显示全量） */
    .rl-tags {
        font-size: 10px; color: var(--text-faint); margin-top: 3px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .rl-row1 { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
    .rl-row1 .rl-score { margin-left: auto; }
    .rl-row2 { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 3px; }
    /* 我的评分（观看状态后内联星，无文字标签） */
    .rl-my-inline { font-size: 10px; color: var(--rl-score); white-space: nowrap; line-height: 1; }
    /* 书籍进度：百分比 + 绿色进度条 + 页数（页数在条右侧） */
    .rl-read-pages { font-size: 9px; color: var(--text-faint); flex: none; white-space: nowrap; }
    /* 状态徽标样式并入全局 styles.css .rl-badge（唯一实现，四色变量见 styles 文件头） */
    /* 大众评分（阶段7：中性色让位给状态徽标主题色，极小 ★ 图标） */
    .rl-score { font-size: 11px; font-weight: 700; color: var(--rl-score); }
    /* 我的评分（阶段6：有评分才显示，前缀「我的评分」区分大众分；未评分不占位） */
    .rl-mystars { font-size: 9px; letter-spacing: .3px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px; }
    .rl-my-label { font-size: 9px; color: var(--text-faint); }
    /* 星级热度分档：≥4 金 / 1~3 灰 / 未评分淡灰 */
    .rl-stars { font-size: 9px; letter-spacing: .5px; }
    .rl-stars-hot { color: var(--rl-score); }
    .rl-stars-mid { color: var(--rl-score-mid); }
    .rl-stars-none { color: var(--rl-score-none); }
    .rl-prog { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
    /* 游戏时长空值占位：灰字「-」（与已填「已玩 Xh」同字重区，弱化不抢眼） */
    .rl-prog-na { color: var(--text-faint); }
    .rl-ex-cnt { font-size: 10px; font-weight: 600; color: var(--interactive-accent); background: var(--background-modifier-hover); border-radius: 999px; padding: 1px 7px; margin-left: auto; }
    /* 阅读进度行（阶段7+）：左百分比 + 进度条，垂直居中对齐；百分比 muted 小字随风格 */
    .rl-readrow { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
    .rl-read-pct { font-size: 9px; line-height: 1; color: var(--text-faint); flex: none; }
    /* 阅读进度条：仅已开始的书渲染（未开始无灰线，避免像未加载占位符）；填充色更有存在感 */
    .rl-readbar { height: 4px; flex: 1 1 auto; background: var(--background-modifier-border); border-radius: 999px; overflow: hidden; }
    .rl-readbar-fill { height: 100%; background: var(--rl-good-bar); border-radius: 999px; transition: width .3s ease; }
    .rl-menu { position: absolute; top: 100%; left: 6px; margin-top: 4px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, .15); padding: 4px; z-index: 30; min-width: 110px; }
    .rl-menu button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 5px 10px; border: none; background: transparent; color: var(--text-normal); border-radius: 6px; cursor: pointer; font-family: inherit; }
    .rl-menu button:hover { background: var(--background-modifier-hover); }
    .rl-menu button.rl-sel { font-weight: 600; color: var(--interactive-accent); }
    .rl-menu button.rl-illegal { opacity: .35; cursor: not-allowed; }
    /* 右键菜单：anchor 容器相对定位，菜单 absolute 贴鼠标（避开 Obsidian transform 祖先使 fixed 偏移的问题）
       z-index + isolation：grid 卡片 overflow:hidden+relative+背景组合被 Chromium 视为独立 stacking context，
       曾盖住菜单（2026-09-09 修复）——anchor 提 z-index 并强制独立层，菜单整体跳出卡片层级 */
    .rl-ctx-anchor { position: relative; z-index: 50; isolation: isolate; }
    .rl-ctx {
        position: absolute; z-index: 100; min-width: 140px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, .18); padding: 4px;
        /* 视口过矮/过窄时内联 max-height/max-width 生效 → 菜单内部滚动，不整块越界 */
        overflow: auto; overscroll-behavior: contain;
    }
    .rl-ctx button { display: block; width: 100%; text-align: left; font-size: 12px; padding: 6px 10px; border: none; background: transparent; color: var(--text-normal); border-radius: 6px; cursor: pointer; font-family: inherit; }
    .rl-ctx button:hover { background: var(--background-modifier-hover); }
    .rl-ctx .rl-ctx-danger { color: var(--rl-danger-strong); }
    .rl-ctx .rl-ctx-danger:hover { background: var(--rl-danger-strong); color: #fff; }
    .rl-empty { text-align: center; color: var(--text-faint); padding: 40px 0; font-size: 13px; }
    .rl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .rl-table th { text-align: left; padding: 6px 8px; font-size: 11px; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); white-space: nowrap; }
    .rl-table td { padding: 6px 8px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
    .rl-col-cb { width: 30px; text-align: center; }
    .rl-thumb { width: 22px; height: 30px; object-fit: cover; border-radius: 3px; margin-right: 8px; vertical-align: middle; }
    /* 表头点击排序：可点击 + hover 反馈 + 排序指示 */
    .rl-th-sort { cursor: pointer; user-select: none; }
    .rl-th-sort:hover { color: var(--text-normal); }
    /* 列表大众评分列 */
    .rl-thumb-score { font-size: 11px; font-weight: 600; color: var(--rl-score); white-space: nowrap; }
    .rl-thumb-score-na { color: var(--text-faint); font-weight: 400; }
    /* 列表进度列：文本 + 内联绿色进度条 */
    .rl-list-prog { font-size: 11px; color: var(--text-muted); display: block; white-space: nowrap; }
    .rl-readbar-inline { height: 3px; width: 90px; display: block; margin-top: 3px; flex: none; }
</style>
