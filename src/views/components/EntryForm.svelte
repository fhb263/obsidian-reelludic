<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { ENTRY_TYPES, ENTRY_TYPE_LABELS, type EntryType } from 'data/types';
    import { statusLabel, statusVerb, reviewLabel } from 'pure/labels';
    import { reconcileBookProgress, pageFromPercent, type BookProbeResult, type BookProgressFields } from 'pure/bookProgress';
    import { Notice } from 'obsidian';
    import { posterUrl } from 'services/tmdb';
    import type { TmdbDetail, TmdbSearchResult } from 'services/tmdb';
    import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
    import type { BangumiSearchResult } from 'services/bangumi';
    import { describeSearchResult, sourceIdOf, SOURCE_VIEW } from 'pure/searchDisplay';
    import { sourceEnList, sourceEnLabel } from 'pure/sourceRegistry';
    import { mergeTmdbDetail } from 'pure/resultMerge';
    import type { SearchProgressCb, SearchProgress } from 'pure/searchProgress';
    import type { MediaStatus } from 'pure/status';
    import Icon from './Icon.svelte';
    import type { MediaEntry } from 'data/types';

    type SearchResult = TmdbSearchResult | OmdbSearchResult | BookSearchResult | GameSearchResult | BangumiSearchResult | MusicSearchResult;

    /** 状态选项（想看/在看/已看/存档；存档选中时右侧不显示日期输入框；弃剧已移除，旧数据 dropped 编辑保存时迁移为存档） */
    const STATUS_OPTIONS: MediaStatus[] = ['want', 'watching', 'watched', 'archived'];

    export let initialType: EntryType = 'movie';
    export let entry: MediaEntry | null = null;
    export let canSearch: boolean = false;
    export let canSearchBook: boolean = true;
    export let canSearchGame: boolean = false;
    export let onSearch: (q: string, t: 'movie' | 'tv', onProgress?: SearchProgressCb) => Promise<TmdbSearchResult[]> = async () => [];
    export let onSearchBook: (q: string, onProgress?: SearchProgressCb) => Promise<BookSearchResult[]> = async () => [];
    export let onSearchGame: (q: string, onProgress?: SearchProgressCb) => Promise<GameSearchResult[]> = async () => [];
    export let onSearchAnime: (q: string, onProgress?: SearchProgressCb) => Promise<BangumiSearchResult[]> = async () => [];
    export let onSearchMusic: (q: string, onProgress?: SearchProgressCb) => Promise<MusicSearchResult[]> = async () => [];
    export let onFetchDetail: (r: TmdbSearchResult) => Promise<Partial<TmdbDetail> & { posterPath?: string }> = async () => ({});
    /** 豆瓣兜底详情按需补全：选中搜索结果时动态拉取 JSON-LD + #info（仅前 3 条搜索时预补全） */
    export let onFetchDoubanDetail: (id: string, type: EntryType) => Promise<Record<string, unknown> | null> = async () => null;
    /** Bangumi 详情按需补全（选中搜索结果时调用：persons+subjects API → 导演/评分/主演） */
    export let onFetchBangumiDetail: (id: number) => Promise<{ rating?: number; ratingCount?: number; director?: string; cast?: string[] }> = async () => ({});
    /** Open Library 书籍详情按需补全（选中搜索书籍时调用：works.json → 简介/页数/出版社；失败返回 null 静默） */
    export let onFetchOpenLibraryDetail: (key: string) => Promise<Record<string, unknown> | null> = async () => null;
    /** OMDb（IMDb）影视详情按需补全（选中结果时调用：i= 详情 → Plot/导演/演员/评分；失败返回 null 静默） */
    export let onFetchOmdbDetail: (imdbID: string) => Promise<Record<string, unknown> | null> = async () => null;
    export let onSubmit: (input: Record<string, unknown>) => Promise<void> = async () => {};
    export let onCancel: () => void = () => {};
    /** 点击来源徽标直达数据源官方页（弹窗侧校验 http/https） */
    export let onOpenSource: (url: string) => void = () => {};
    /** 「集按钮」打开本地剧集视频（弹窗侧 Electron 系统播放器） */
    export let onPlayEpisode: (path: string) => void = () => {};
    /** 「浏览」系统文件选择器选本地视频（Electron remote.dialog 返回绝对路径；input file 的 File.path 在 Obsidian 不可用） */
    export let onPickLocalVideo: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 「本地音频」系统文件选择器选音乐文件（返回 vault 相对路径，库外绝对路径） */
    export let onPickLocalAudio: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 「启动快捷方式」系统文件选择器选游戏 .lnk（返回 vault 相对路径，库外绝对路径） */
    export let onPickGameLaunch: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 编辑模式删除条目（弹窗侧提供确认与刷新） */
    export let onDelete: () => Promise<void> = async () => {};
    /** 结果栏数上报（宿主据此动态调弹窗宽度：三栏并排需加宽，一/两栏与编辑态用常规宽度）；
     *  0 = 未展示结果（搜索输入中/已选结果进编辑/手动填写） */
    export let onResultCols: (cols: number) => void = () => {};
    /** 某类型本次搜索实际会发起的源集合（固定占栏依据：栏位只随源链/凭据配置变化，不随源成败增减） */
    export let onSourcesForType: (type: EntryType) => string[] = () => [];
    /** 书籍编辑表单「添加摘抄」：弹窗侧打开摘抄录入（固定挂载当前条目） */
    export let onAddExcerpt: () => void = () => {};
    /** 书籍编辑表单「阅读」：打开书籍阅读器，关闭后返回最新阅读进度（percent 真源 → 表单自动同步当前页/章） */
    export let onOpenReader: () => Promise<BookProgressFields | undefined> = async () => undefined;
    /** 书籍编辑浮层「浏览…」：系统文件选择器选 TXT/EPUB/PDF，返回 vault 相对路径 */
    export let onPickBookFile: (ev?: MouseEvent) => Promise<string | undefined> = async () => undefined;
    /** 书籍「进度页数」自动关联：探针本地书籍文件基准（PDF → numPages；TXT → 按章节解析 totalChapters；EPUB/失败 → undefined） */
    export let onProbeBookPages: (path: string) => Promise<BookProbeResult | undefined> = async () => undefined;
    /** 选视频文件夹（动画/电视剧「从文件夹检索剧集」目录选择器；非桌面/取消 → undefined） */
    export let onPickVideoDir: () => Promise<string | undefined> = async () => undefined;
    /** 读文件夹内视频并识别集号（按集号升序 {ep,path,name}；不可读/无命中 → []） */
    export let onScanEpisodeDir: (dir: string) => Promise<{ ep: number; path: string; name: string }[]> = async () => [];
    /** 游戏编辑表单「▶ 启动」：弹窗侧启动游戏（编辑模式挂载当前条目；表单新选未保存时以已存条目为准） */
    export let onLaunchGame: () => void = () => {};
    /** 音乐编辑表单「▶ 播放」：弹窗侧播放音频（同上） */
    export let onPlayMusic: () => void = () => {};
    /** 游戏编辑表单「记录游玩」：弹窗侧打开游玩记录弹窗（固定挂载当前游戏） */
    export let onRecordPlaySession: () => void = () => {};
    /** 拖入本地图片上传为封面：返回相对路径（covers/xxx） */
    export let onUploadPoster: (file: File) => Promise<string> = async () => '';
    /** 解析封面字符串为可显示地址（http 直用 / 本地路径映射 vault 资源） */
    export let onResolvePoster: (p: string) => string | undefined = (p) => p;
    /** 豆瓣封面防盗链：下载远程豆瓣图片到本地封面目录（按标题命名），返回相对路径 */
    export let onDownloadPoster: (url: string, title: string) => Promise<string> = async (url) => url;

    // ── 编辑模式：用既有条目初始化字段 ──
    let type: EntryType = entry?.type ?? initialType;
    let query = '';
    let searching = false;
    let searchError = '';
    let results: SearchResult[] = [];
    /** 搜索进度（确定性进度条 + 预计耗时）：done/total/label/etaSec */
    let progDone = 0;
    let progTotal = 0;
    let progLabel = '';
    /** 模拟进度（单步搜索 total 未知时显示爬升百分比，避免「看不到进度」；有真实步骤时用真实值） */
    let progSim = 0;
    let progSimTimer: ReturnType<typeof setInterval> | undefined;
    /** 进度百分比：total 已知用真实值；未知用模拟爬升（封顶 88%，完成时跳 100） */
    $: progPct = progTotal > 0
        ? Math.min(100, Math.round((progDone / progTotal) * 100))
        : progSim;
    /** 逐源真实进度：各参与源完成状态（sourceDone[id] = 已返回结果数；失败/超时等由 doneState 表达） */
    interface SrcLive {
        /** undefined = 等待中/尚未回报；'ok'|'empty'|'failed'|'timeout'|'blocked' 见 SourceDoneState */
        state?: 'ok' | 'empty' | 'failed' | 'timeout' | 'blocked';
        count?: number;
    }
    let srcLive: Record<string, SrcLive> = {};
    const srcStateText = (s: SrcLive | undefined, en: string): string => {
        if (!s || !s.state) return `${en} 搜索中…`;
        switch (s.state) {
            case 'ok': return `${en} 已返回 ${s.count ?? 0} 条`;
            case 'empty': return `${en} 无匹配`;
            case 'failed': return `${en} 请求失败`;
            case 'timeout': return `${en} 超时`;
            case 'blocked': return `${en} 不可用`;
        }
    };
    const onSearchProgress: SearchProgressCb = (p: SearchProgress) => {
        progDone = p.done;
        progTotal = p.total;
        progLabel = p.label;
        // 逐源事件：收到即更新该源实时状态（先返回先亮，其余保持「搜索中…」）
        if (p.source) {
            srcLive = { ...srcLive, [p.source.id]: { state: p.source.state, count: p.source.count } };
        }
    };
    function startSimProgress() {
        progSim = 4;
        clearInterval(progSimTimer);
        progSimTimer = setInterval(() => {
            progSim = Math.min(88, progSim + Math.round(4 + Math.random() * 6));
        }, 420);
    }
    function stopSimProgress() {
        clearInterval(progSimTimer);
        progSimTimer = undefined;
        progSim = 100;
    }
    /** 编辑模式默认已"选/填"（picked=true 直接渲染字段区）；新增需搜索点结果才置 true */
    let picked: boolean = entry !== null;
    /** 编辑模式「重新拉取」展开态：true 时显示搜索区（预填当前标题），选结果回填客观字段 */
    let refetchOpen = false;

    let title = entry?.title ?? '';
    /** 添加模式点选结果后回显的标题（fhd 头部「添加条目：xx」用；手动填写时保持默认文案） */
    let pickedTitle = '';
    /** 标题输入框引用：点选结果后自动聚焦（tick 等待字段区渲染） */
    let titleInput: HTMLInputElement | null = null;
    let originalTitle = entry?.originalTitle ?? '';
    let year = entry?.year ? String(entry.year) : '';
    let director = entry?.director ?? '';
    /** 导演/编剧合并输入（显示与编辑用单框；提交时第一个 / 前为导演、其余为编剧） */
    let directorWriters = '';
    $: directorWriters = [director, screenwriter].filter(Boolean).join(' / ');
    let screenwriter = (entry?.screenwriter ?? []).join(' / ');
    let cast = (entry?.cast ?? []).join(' / ');
    let genres = (entry?.genres ?? []).join(' / ');
    /** 题材：普通 input（/ 分隔文本，非标签）——提交时拆分存 genres 数组 */
    let country = entry?.country ?? '';
    let language = entry?.language ?? '';
    let durationMin = entry?.durationMin ? String(entry.durationMin) : '';
    let aliases = (entry?.aliases ?? []).join(' / ');
    /** 简介/剧情简介（搜索回填自动记录；落库 summary 字段，笔记「## 简介」章节） */
    let summary = entry?.summary ?? '';
    /** 简介类 textarea 引用（auto-grow：高度随文字多少自动伸缩） */
    let summaryEl: HTMLTextAreaElement | null = null;
    let authorIntroEl: HTMLTextAreaElement | null = null;
    let tocEl: HTMLTextAreaElement | null = null;
    /** auto-grow 核心：先归零再取 scrollHeight（textarea 的 scrollHeight 不会小于当前渲染高度，复位 auto 仍停在 rows 基线高度导致文字少时缩不回去） */
    function autosizeTextarea(el: HTMLTextAreaElement | null) {
        if (!el) return;
        el.style.height = '0px';
        el.style.height = el.scrollHeight + 'px';
    }
    // 用户输入（bind:value 更新）与搜索程序化回填都会触发重算；el 挂载时跑一次定初始高度
    $: { if (summaryEl) autosizeTextarea(summaryEl); void summary; }
    $: { if (authorIntroEl) autosizeTextarea(authorIntroEl); void authorIntro; }
    $: { if (tocEl) autosizeTextarea(tocEl); void toc; }
    let author = entry?.author ?? '';
    let album = entry?.album ?? '';
    let audioPath = entry?.audioPath ?? '';
    /** 游戏启动快捷方式（.lnk）路径（表单「启动快捷方式」行） */
    let gameLaunchPath = entry?.gameLaunchPath ?? '';
    /** 书籍文件路径（阅读器打开入口）：右键编辑浮层浏览/手动输入，存 bookFile */
    let bookFileVal = entry?.bookFile ?? '';
    /** 书籍文件右键编辑浮层开关 */
    let bookEditOpen = false;
    /** 游戏启动快捷方式右键编辑浮层开关 + 编辑缓冲值（保存才写回 gameLaunchPath） */
    let gameEditOpen = false;
    let gameLaunchVal = '';
    /** 本地音频右键编辑浮层开关 + 编辑缓冲值（保存才写回 audioPath） */
    let audioEditOpen = false;
    let audioPathVal = '';
    let translator = entry?.translator ?? '';
    let publisher = entry?.publisher ?? '';
    let producer = entry?.producer ?? '';
    let isbn = entry?.isbn ?? '';
    let binding = entry?.binding ?? '';
    let price = entry?.price ?? '';
    let series = entry?.series ?? '';
    let platform = entry?.platform ?? '';
    let developer = entry?.developer ?? '';
    let poster = entry?.poster ?? '';
    /** 表单 UI 模式：douban（豆瓣版，全类型）/ tmdb（电影/电视剧）/ bangumi（动画）；命中搜索结果或编辑已有条目时按 source 确定 */
    let formMode: 'douban' | 'tmdb' | 'bangumi' = entry
        ? (entry.source === 'tmdb' ? 'tmdb' : entry.source === 'bangumi' ? 'bangumi' : 'douban')
        : 'douban';
    /** 数据源自动记录（笔记「来源」行跟随数据源官方链接） */
    let sourceFrom = entry?.source ?? '';
    let sourceUrl = entry?.sourceUrl ?? '';
    /** 大众评分（数据源评分，搜索回填自动记录；只读展示） */
    let communityScore = entry?.communityScore ? String(entry.communityScore) : '';
    /** 豆瓣评价人数（搜索/详情回填，展示「★ 8.5 · N人评价」；只读） */
    let ratingCount = entry?.ratingCount ? String(entry.ratingCount) : '';
    /** 作者简介（图书，豆瓣详情回填；表单可改，落库 authorIntro） */
    let authorIntro = entry?.authorIntro ?? '';
    /** 目录（图书，豆瓣详情回填；表单可改，落库 toc） */
    let toc = entry?.toc ?? '';
    let status: MediaStatus = entry?.status ?? 'want';
    let rating = entry?.rating ?? 0;
    let season = entry?.progress?.season ?? 1;
    let episode = entry?.progress?.episode ?? 1;
    /** 「已看到」手填钳制：季 ≥ 1、集 ≥ 0；非法/空输入回退初始值（保持 progress 恒为有效整数，防 NaN 落库） */
    function clampWatch(n: number, min: number, dft: number): number {
        return Number.isFinite(n) && n >= min ? Math.round(n) : dft;
    }
    // 影视条目默认总集数：电影固定语义为单集（默认 1，编辑表单不显示总集数框；观看链接渲染单集 ▶ 播放钮，关联第 1 集）；剧集/动画由输入框决定
    let totalEpisodes = entry?.progress?.totalEpisodes ? String(entry.progress.totalEpisodes) : type === 'movie' ? '1' : '';
    /** 观看链接双路径（index 0 = 第 1 集）：本地路径 episodeFiles + 网络地址 episodeUrls + 集标题 episodeTitles，随条目保存 */
    let episodeFiles: (string | undefined)[] = [];
    let episodeUrls: (string | undefined)[] = [];
    let episodeTitles: (string | undefined)[] = [];
    {
        const n = totalEpisodes ? Number(totalEpisodes) : 0;
        const srcF = entry?.episodeFiles ?? [];
        // 旧「资源链接」(links) 自动迁移为网络地址：episodeUrls 为空时取 links 的 url（label 忽略、url 不丢），保存后 links 清空
        const srcU = entry?.episodeUrls && entry.episodeUrls.length > 0
            ? entry.episodeUrls
            : (entry?.links ?? []).map((l) => l.url).filter(Boolean);
        const srcT = entry?.episodeTitles ?? [];
        episodeFiles = Array.from({ length: n }, (_, i) => (i < srcF.length ? srcF[i] : undefined));
        episodeUrls = Array.from({ length: n }, (_, i) => (i < srcU.length ? srcU[i] : undefined));
        episodeTitles = Array.from({ length: n }, (_, i) => (i < srcT.length ? srcT[i] : undefined));
    }
    /** 集编辑弹窗状态：正在编辑的集下标（null=关闭）+ 表单值 */
    let editEp: number | null = null;
    let editLocal = '';
    let editUrl = '';
    let editTitle = '';
    /** 最近观看日期（在看状态可设置，写入 progress.lastWatchedDate 供追更表活跃度计算） */
    let lastWatchedDate = entry?.progress?.lastWatchedDate ?? '';
    let watchedDate = entry?.watchedDate ?? '';
    let plannedDate = entry?.plannedDate ?? '';
    let readingPage = entry?.readingProgress?.page ? String(entry.readingProgress.page) : '';
    let readingTotalPage = entry?.readingProgress?.totalPage ? String(entry.readingProgress.totalPage) : '';
    /** 元数据页数（豆瓣实体书；仅展示/统计，不参与进度换算——进度基准以本地文件为准） */
    let pageCountVal = entry?.pageCount ? String(entry.pageCount) : '';
    /** 阅读百分比：由 page/totalPage 自动派生（只读展示，进度条与提示文字用，不落库） */
    $: readPct =
        readingPage && readingTotalPage
            ? Math.min(100, Math.round((Number(readingPage) / Number(readingTotalPage)) * 100))
            : 0;
    /** 进度条色阶：起步<30% / 进行中<70% / 接近完成<100% / 读完=深绿 */
    $: readbarClass =
        !readingPage || !readingTotalPage
            ? ''
            : readPct < 30
              ? 'rl-readbar-low'
              : readPct < 70
                ? 'rl-readbar-mid'
                : readPct < 100
                  ? 'rl-readbar-high'
                  : 'rl-readbar-done';
    /** 进度单位：关联 TXT 按章节解析 → 章；否则（PDF/手填）→ 页 */
    $: bookUnit = bookFileVal.trim().toLowerCase().endsWith('.txt') ? '章' : '页';
    $: bookUnitLabel = bookUnit === '章' ? '进度章节' : '进度页数';
    /** 游戏游玩时长（小时录入，落库转分钟；有游玩记录明细时以明细累计为准） */
    let playtimeHours = entry?.playtimeMinutes ? String(Math.round(entry.playtimeMinutes / 60)) : '';
    let notes = entry?.notes ?? '';
    /** 搜索框引用（添加模式自动聚焦） */
    let queryInput: HTMLInputElement | null = null;
    /** 封面：网络图片 URL 输入；previewUrl 供预览区显示（poster 变化自动刷新） */
    let posterUrlInput = '';
    $: previewUrl = poster ? (onResolvePoster(poster) ?? poster) : '';
    /** poster 为 http URL 时同步到输入框（编辑已有条目 / 搜索回填后自动填入，可直接查看或修改） */
    function syncPosterUrlInput() {
        posterUrlInput = /^https?:\/\//.test(poster) ? poster : '';
    }
    /** 封面右键菜单状态 */
    let ctxOpen = false;
    let ctxX = 0;
    let ctxY = 0;
    let ctxUrlMode = false;
    let fileInput: HTMLInputElement | null = null;

    function openPosterCtx(ev: MouseEvent) {
        ev.preventDefault();
        ctxX = ev.clientX;
        ctxY = ev.clientY;
        ctxUrlMode = false;
        ctxOpen = true;
    }
    function closeCtx() {
        ctxOpen = false;
        ctxUrlMode = false;
    }
    function pickFile() {
        closeCtx();
        fileInput?.click();
    }
    async function onFileSelected(ev: Event) {
        const input = ev.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            new Notice('仅支持图片文件');
            input.value = '';
            return;
        }
        try {
            const p = await onUploadPoster(file);
            if (p) {
                poster = p;
                syncPosterUrlInput();
            }
        } catch (e) {
            new Notice('封面上传失败：' + (e instanceof Error ? e.message : String(e)));
        }
        input.value = ''; // 允许再次选同一文件
    }

    // 添加模式：弹窗打开后自动聚焦搜索框（所有类型通用；编辑模式无搜索框跳过）
    onMount(() => {
        syncPosterUrlInput(); // 编辑已有条目：http 封面 URL 自动填入输入框
        // 存量数据补全：旧版本 percent 落库但未派生 page（阅读器只产 percent）→ 打开表单即按 percent 真源派生当前页/章
        const rp = entry?.readingProgress;
        if (entry && rp && typeof rp.percent === 'number' && !rp.page && rp.totalPage) {
            readingPage = String(pageFromPercent(rp.percent, rp.totalPage));
            if (!readingTotalPage) readingTotalPage = String(rp.totalPage);
        }
        // 点击外部关闭右键菜单
        const onWinClick = (ev: MouseEvent) => {
            if (ctxOpen && !(ev.target as HTMLElement).closest('.rl-ctx')) closeCtx();
        };
        window.addEventListener('click', onWinClick);
        if (!entry && queryInput) {
            // 防 Obsidian 弹窗焦点还原（上一弹窗关闭动画后延迟执行）抢走搜索框焦点：
            // 多轮重试直到输入框真正获得焦点（最多 ~640ms），解决「新增条目后偶发无法输入搜索」
            let tries = 0;
            queryInput.focus();
            const timer = window.setInterval(() => {
                if (!queryInput) {
                    clearInterval(timer);
                    return;
                }
                if (document.activeElement === queryInput || tries >= 8) {
                    clearInterval(timer);
                    return;
                }
                tries++;
                queryInput.focus();
            }, 80);
        }
        // Bangumi 源条目：详情（评分/导演）由搜索前 3 条补全时写入；编辑打开不自动拉取
        return () => window.removeEventListener('click', onWinClick);
    });

    $: sourceReady = true; // 全部类型均可搜（Douban 单源/并存；影视/动画未配 Key 时仅 Douban 结果）
    $: sourceHint = (type === 'movie' || type === 'tv') && !canSearch
        ? 'TMDB API Key 未配置 — 电影/剧集仅显示 Douban 结果（可在 设置 → 服务集成 · TMDB 配置后叠加）'
        : '';

    /**
     * 头部「数据源」栏文案：跟随当前类型在设置页「数据源启用」勾选的源（onSourcesForType 实时解析，
     * 含已配置/免 Key 判断），如 movieTv 勾选 Douban+TMDB+OMDb → 「数据源：Douban / TMDB / OMDb」。
     */
    $: activeSourcesForType = onSourcesForType(type);
    $: sourceListText = (() => {
        const names = activeSourcesForType;
        return `数据源：${names.length > 0 ? sourceEnList(names) : sourceEnLabel('douban')}`;
    })();

    function resultKey(r: SearchResult): string {
        return ('id' in r ? String(r.id) : r.title) + '|' + r.title;
    }

    /** 分栏展示用的单栏（id+列头文本+该来源结果；items 空时渲染占位文案而非整栏消失） */
    interface ResultColumn {
        id: string;
        label: string;
        items: SearchResult[];
        /** 该栏所代表的源是否在本次搜索中返回过结果（false → 显示「无匹配」占位） */
        empty: boolean;
    }

    /**
     * 按来源把合并结果重分栏（子任务2 + 固定占栏修正）：每栏固定单一数据源，不再跨源交叉/全局相似度重排。
     * 栏位 = 上次搜索「实际会发起」的源集合（onSourcesForType 在搜索时取快照）——栏数与各源本次成败无关，
     * 避免「某源失败/无结果 → 整栏消失 → 看着像少一栏/布局塌缩」。
     * 仅保留有结果的源混排的旧逻辑不再用于结果区（仍作兜底：onSourcesForType 为空时按结果反推）。
     */
    let sourcePlan: string[] = []; // 最近一次搜索时的参与源快照（切到编辑/手动时保持，避免栏位跳动）
    $: resultColumns = (() => {
        // 兜底：宿主未提供参与源 → 退回「按结果里实际出现的源反推」（旧行为，单源/直连等场景安全）
        if (sourcePlan.length === 0) {
            const map = new Map<string, ResultColumn>();
            for (const r of results) {
                const id = sourceIdOf(r);
                const col = map.get(id);
                if (col) col.items.push(r);
                else map.set(id, { id, label: SOURCE_VIEW[id]?.label ?? id, items: [r], empty: false });
            }
            return Array.from(map.values());
        }
        // 固定占栏：按参与源建栏，结果按 sourceIdOf 归入对应栏；无该源结果 → empty 占位
        return sourcePlan.map((id) => {
            const items = results.filter((r) => sourceIdOf(r) === id);
            return { id, label: SOURCE_VIEW[id]?.label ?? id, items, empty: items.length === 0 };
        });
    })();

    /** 结果栏数上报：未展示结果（搜索输入中/已选/手动）→ 0，否则按固定参与源栏数（含空栏）。
     *  宿主仅在栏数 ≥3（三源并排）时加宽弹窗，1~2 栏与编辑态保持常规宽度 */
    let lastCols = 0;
    $: shownCols = !picked && results.length > 0 ? resultColumns.length : 0;
    $: {
        if (shownCols !== lastCols) {
            lastCols = shownCols;
            onResultCols(shownCols);
        }
    }

    /** 豆瓣图床（img*.doubanio.com）防盗链：无 Referer/空 Referer 返回 HTTP 418。
     *  必须用 <img referrerpolicy="unsafe-url"> 强制携带完整 Referer 才能加载封面 */
    function isDoubanImage(u: string): boolean {
        return /doubanio\.com/.test(u);
    }

    /** 类型 → 占位图标（搜索结果无封面 / 豆瓣防盗链封面时显示） */
    function typeIcon(t: EntryType): string {
        return ({ movie: '🎬', tv: '📺', anime: '🌸', book: '📖', game: '🎮', music: '🎵' } as Record<EntryType, string>)[t];
    }

    /** 推断数据源标识：显式 source（douban/tmdb/bangumi）优先，未标记的按结果类型回退（书籍/游戏仅 Douban） */
    function inferSource(r: SearchResult): string {
        if (r.source) return r.source;
        if ('author' in r) return 'douban';
        if ('platform' in r) return 'douban';
        if ('studio' in r) return 'bangumi';
        return 'tmdb';
    }

    async function doSearch() {
        if (!query.trim()) return;
        searching = true;
        searchError = '';
        results = [];
        picked = false;
        // 固定占栏：在发起搜索前按当前类型快照参与源（栏位自此恒定，不随本次各源成败增减）
        sourcePlan = onSourcesForType(type);
        srcLive = {}; // 逐源进度清零（本次重新搜索）
        progDone = 0;
        progTotal = 0;
        progLabel = '';
        startSimProgress();
        try {
            const q = query.trim();
            if (type === 'book') {
                results = await onSearchBook(q, onSearchProgress);
            } else if (type === 'game') {
                results = await onSearchGame(q, onSearchProgress);
            } else if (type === 'anime') {
                // 动画走 Bangumi（bgm.tv，中文标题权威，需 Access Token）+ Douban 并行
                results = await onSearchAnime(q, onSearchProgress);
            } else if (type === 'music') {
                results = await onSearchMusic(q, onSearchProgress);
            } else {
                results = await onSearch(q, type, onSearchProgress);
            }
            if (results.length === 0) {
                searchError = '未找到相关结果，可换个关键词或直接手动填写';
            }
        } catch (e) {
            searchError = e instanceof Error ? e.message : String(e);
            new Notice(searchError, 8000);
        } finally {
            stopSimProgress();
            searching = false;
            void prefetchTmdbDetails(); // 后台预取 TMDB 详情，不阻塞结果展示
        }
    }

    /**
     * 搜索完成后异步并发预取 TMDB 详情：只对 source==='tmdb' 的影视结果拉详情，
     * 回填 year/rating/director/cast/genres 到 row2「一览即见」。
     * 分批并发（5 个/批）避免 30 个请求同时打 TMDB 触发限流；失败静默。
     */
    async function prefetchTmdbDetails() {
        const tmdbResults = results.filter(
            (x): x is TmdbSearchResult => 'mediaType' in x && (x as TmdbSearchResult).source === 'tmdb',
        );
        if (tmdbResults.length === 0) return;
        const BATCH = 5;
        for (let i = 0; i < tmdbResults.length; i += BATCH) {
            await Promise.all(
                tmdbResults.slice(i, i + BATCH).map(async (r) => {
                    try {
                        const d = await onFetchDetail(r);
                        if (!d || typeof d !== 'object') return;
                        const idx = results.findIndex((x) => x === r);
                        if (idx < 0) return; // 期间已换搜索，丢弃
                        results[idx] = mergeTmdbDetail(r, d);
                    } catch {
                        /* 预取失败静默：不影响结果展示 */
                    }
                }),
            );
        }
        results = [...results]; // 触发 Svelte 响应式更新 row2
    }

    /** 编辑模式「重新拉取」：展开搜索区（预填当前标题）并立即用该标题触发一次搜索，直接展示结果（复用 doSearch 的状态重置与搜索流程），选结果回填客观字段 */
    function startRefetch() {
        if (!entry) return;
        refetchOpen = true;
        query = entry.title;
        void doSearch(); // 点击即搜，无需再手动点「搜索」按钮
    }

    /** 搜索结果区点击空白处（非条目）→ 取消并关闭弹窗（替代原底部「取消」按钮） */
    function onResClick(ev: MouseEvent) {
        if ((ev.target as HTMLElement).closest('.rl-res-item')) return;
        onCancel();
    }

    async function pick(r: SearchResult) {
        searchError = '';
        try {
            picked = true;
            refetchOpen = false; // 重新拉取选中结果后收起搜索区
            // 数据源决定表单 UI 模式：douban → 豆瓣版（全类型）；tmdb/bangumi → 对应版
            formMode = r.source === 'douban' ? 'douban' : 'studio' in r ? 'bangumi' : 'tmdb';
            title = r.title;
            // 数据源自动记录：笔记「来源」行跟随数据源官方链接（Douban/TMDB/Bangumi）
            sourceFrom = inferSource(r);
            sourceUrl = describeSearchResult(r).sourceUrl ?? '';
            communityScore = r.rating != null ? String(r.rating) : '';
            ratingCount = r.ratingCount ? String(r.ratingCount) : '';
            if ('author' in r) {
                // 书籍：Douban 一次返回全部信息（含豆瓣详情字段；Open Library 搜索级字段见下 works.json 补全）
                originalTitle = '';
                if (r.year) year = String(r.year);
                author = r.author ?? '';
                publisher = r.publisher ?? '';
                producer = r.producer ?? '';
                isbn = r.isbn ?? '';
                binding = r.binding ?? '';
                price = r.price ?? '';
                series = r.series ?? '';
                if (r.pageCount) pageCountVal = String(r.pageCount);
                genres = r.genres?.length ? r.genres.join(' / ') : '';
                summary = r.description ?? '';
                authorIntro = r.authorIntro ?? '';
                toc = r.toc ?? '';
                if (r.thumbnail) poster = r.thumbnail;
                // 豆瓣书籍兜底：搜索级缺 ISBN/装帧/定价 等，点击时按需拉详情补全
                if (r.source === 'douban' && !r.publisher) {
                    try {
                        const d = await onFetchDoubanDetail(r.id.replace('douban:', ''), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.publisher || d.isbn) new Notice('已自动补全豆瓣书籍详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
                // Open Library 书籍：search.json 不含简介/页数 → 点选时走 works.json 轻量补全（失败静默）
                if (r.source === 'openLibrary') {
                    try {
                        const d = await onFetchOpenLibraryDetail(r.id);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.summary || d.pageCount) new Notice('已自动补全 Open Library 书籍详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留搜索级字段
                    }
                }
            } else if ('platform' in r) {
                // 游戏：Douban 搜索级字段（平台/开发商缺失）→ 选中时按需拉详情补全
                originalTitle = '';
                if (r.year) year = String(r.year);
                platform = r.platform ?? '';
                developer = r.developer ?? '';
                genres = r.genres?.length ? r.genres.join(' / ') : '';
                summary = r.summary ?? '';
                if (r.cover) poster = r.cover;
                // 豆瓣游戏兜底：搜索级缺平台/开发商时，点击时按需拉详情补全
                // ⚠️ 游戏 id 是 number（toGameResult id: Number(s.id)），不能用 replace 剥 douban: 前缀（书/音乐才是字符串 id）——String() 通用安全
                if (r.source === 'douban' && !r.platform && !r.developer) {
                    try {
                        const d = await onFetchDoubanDetail(String(r.id), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.platform || d.developer) new Notice('已自动补全豆瓣游戏详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
            } else if ('album' in r) {
                // 音乐：Douban 一次返回全部信息（歌手/专辑/年份/封面/简介/评分）
                originalTitle = '';
                if (r.year) year = String(r.year);
                author = r.artist ?? '';
                album = r.album ?? '';
                summary = r.summary ?? '';
                if (r.cover) poster = r.cover;
                // 豆瓣音乐兜底：搜索级缺歌手/专辑时，点击时按需拉详情补全
                if (r.source === 'douban' && (!r.artist || !r.album)) {
                    try {
                        const d = await onFetchDoubanDetail(r.id.replace('douban:', ''), type);
                        if (d) {
                            applyDoubanDetail(d);
                            if (d.author || d.album) new Notice('已自动补全豆瓣音乐详情', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默
                    }
                }
            } else if ('studio' in r) {
                // 动画：Bangumi/AniList 搜索级字段直接回填（评分/制作公司/简介等已带）；Bangumi 另补详情
                originalTitle = r.originalTitle;
                if (r.year) year = String(r.year);
                genres = (r.genres ?? []).join(' / ');
                summary = r.summary ?? '';
                if (r.cover) poster = r.cover;
                // 详情补全后字段回填（搜索级无，persons/subject 详情 API 写入；主演字段仅 douban/tmdb 源显示，bangumi 隐藏但数据保留）
                if (r.director) directorWriters = r.director;
                if (r.cast?.length) cast = r.cast.join(' / ');
                // #165 T10 决策：只有 bgm.tv subject 语义的结果（bangumi 原生不设 source / 显式 'bangumi'）缺导演时才拉
                // Bangumi 详情；anilist 结果是 anilist.co/anime/{id}（source='anilist'，id 数值区间与 bgm 重叠），
                // 豆瓣兜底结果是 douban 站 id —— 两者发往 bgm API 会回填毫不相关条目的导演/评分，一律不发。
                // anilist 搜索级已含 genres/studio/desc/rating → 无需额外 detail GraphQL 往返（点选补全决策）。
                if ((!r.source || r.source === 'bangumi') && !r.director) {
                    try {
                        const d = await onFetchBangumiDetail(r.id);
                        if (d?.director) {
                            directorWriters = d.director;
                            if (d.rating != null) communityScore = String(d.rating);
                            if (d.ratingCount != null) ratingCount = String(d.ratingCount);
                            if (d.cast?.length) cast = d.cast.join(' / ');
                            new Notice('已自动补全 Bangumi 详情（导演/评分）', 2000);
                        }
                    } catch {
                        // 补全失败静默，保留搜索级字段
                    }
                }
                // 豆瓣动画兜底：豆瓣搜索级不含题材/导演/主演（parseDoubanItem 只出标题/年份/封面/简介），
                // 点选豆瓣动画结果时按需拉详情回填（JSON-LD + #info 有 导演/编剧/主演/类型/国家/集数 等）。
                // ⚠️ 此前动画分支没有此段，豆瓣结果只停留在搜索级 → 题材/导演/主演恒空（电影/剧集分支一直有）。
                if (r.source === 'douban' && !r.director && !r.cast?.length && !r.author && !r.developer) {
                    try {
                        const d = await onFetchDoubanDetail(String(r.id), type);
                        if (d) {
                            applyDoubanDetail(d);
                            new Notice('已自动补全豆瓣详情字段', 2000);
                        }
                    } catch {
                        // 详情拉取失败静默，保留已有搜索级字段（可手动填写，不阻塞保存）
                    }
                }
            } else {
                // 影视/剧集：TMDB/OMDb（IMDb）搜索后按源拉详情回填；豆瓣兜底结果直接可用（封面为完整 URL）
                originalTitle = r.originalTitle;
                if (r.year) year = String(r.year);
                if (r.source === 'omdb') {
                    const om = r as OmdbSearchResult;
                    // IMDb 海报搜索级直填（服务端 Poster=N/A 已滤除 → 无封面走占位图）
                    if (om.poster) poster = om.poster;
                    // i= 详情补 Plot/导演/演员(截5)/类型(截3)/imdbRating/imdbVotes(去逗号)；失败 null 静默
                    try {
                        const d = await onFetchOmdbDetail(om.imdbID);
                        if (d) {
                            applyDoubanDetail(d); // director/cast/genres/summary/cover/ratingCount/year 幂等回填
                            if (d.rating != null && !communityScore) communityScore = String(d.rating); // applyDoubanDetail 不读 rating → 评分单独回填
                        }
                    } catch {
                        // 详情补全失败静默：保留搜索级字段，不阻塞保存
                    }
                } else if (r.source === 'douban') {
                    if (r.posterPath) poster = r.posterPath;
                    if (r.overview) summary = r.overview;
                    // 详情字段：优先用 r 自带（仅前 3 条搜索时已补）；其余点击时按需拉详情补全
                    applyDoubanDetail(r as unknown as Record<string, unknown>);
                    if (!r.director && !r.cast?.length && !r.author && !r.developer) {
                        try {
                            const d = await onFetchDoubanDetail(String(r.id), type);
                            if (d) {
                                applyDoubanDetail(d);
                                new Notice('已自动补全豆瓣详情字段', 2000);
                            }
                        } catch {
                            // 详情拉取失败静默，保留已有搜索级字段
                        }
                    }
                } else {
                    const d = await onFetchDetail(r);
                    if (d.posterPath) poster = posterUrl(d.posterPath) ?? '';
                    if (d.genres?.length) genres = d.genres.join(' / ');
                    if (d.director) director = d.director;
                    if (d.cast?.length) cast = d.cast.join(' / ');
                    if (d.overview) summary = d.overview;
                    // 详情补全评价人数/评分（搜索级缺失时兜底）
                    if (d.ratingCount != null && !ratingCount) ratingCount = String(d.ratingCount);
                    if (d.rating != null && !communityScore) communityScore = String(d.rating);
                }
            }
            status = 'want';
            // 豆瓣封面防盗链（doubanio.com 需 Referer，Obsidian 直连 403）：下载到本地，失败保留远程 URL
            if (poster && isDoubanImage(poster)) {
                try {
                    poster = await onDownloadPoster(poster, title);
                } catch {
                    // 下载失败：保留远程 URL（预览可能空白，但不丢数据）
                }
            }
            syncPosterUrlInput(); // 回填后 http 封面 URL 同步到输入框
            pickedTitle = r.title; // fhd 头部回显「添加条目：xx」
            await tick(); // 字段区刚渲染，等 DOM 挂载后聚焦标题输入框
            titleInput?.focus();
        } catch (e) {
            picked = false;
            searchError = '回填详情失败：' + (e instanceof Error ? e.message : String(e));
            new Notice(searchError, 8000);
        }
    }

    /** 复制链接到剪贴板（桌面 Obsidian 支持 navigator.clipboard） */
    async function copyLink(url: string | undefined) {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            new Notice('已复制链接');
        } catch {
            new Notice('复制失败，请手动复制');
        }
    }

    // ── 观看链接双路径：总集数变化时对齐 episodeFiles/episodeUrls 长度 ──
    // 只扩不缩：总集数变小时保留数据（渲染按当前总集数截取、提交时截断写入），
    // 避免 on:input 逐键重填（如 52→"5"→"52"）中间值把数组截断导致数据永久丢失
    function resizeEpisodeFiles() {
        const n = totalEpisodes ? Number(totalEpisodes) : 0;
        if (n > episodeFiles.length) {
            episodeFiles = Array.from({ length: n }, (_, i) => (i < episodeFiles.length ? episodeFiles[i] : undefined));
            episodeUrls = Array.from({ length: n }, (_, i) => (i < episodeUrls.length ? episodeUrls[i] : undefined));
            episodeTitles = Array.from({ length: n }, (_, i) => (i < episodeTitles.length ? episodeTitles[i] : undefined));
        }
    }
    /** 左键点击集按钮：本地优先播放，否则打开网络，都无提示右键编辑 */
    function playOrOpenEpisode(i: number) {
        resizeEpisodeFiles();
        const p = episodeFiles[i];
        const u = episodeUrls[i];
        if (p) {
            onPlayEpisode(p);
            return;
        }
        if (u) {
            openSource(u);
            return;
        }
        new Notice(`第 ${i + 1} 集未关联 — 右键该按钮编辑本地/网络链接`);
    }
    /** 批量检索本地剧集文件：选文件夹 → main 读目录识别文件名集号 → 未关联集保位填入本地路径；
     *  总集数不足时自动扩到最大命中集号；已填本地路径的集跳过（不覆盖）。 */
    async function batchScanLocalEps() {
        const dir = await onPickVideoDir();
        if (!dir) {
            new Notice('未选择文件夹或系统对话框不可用');
            return;
        }
        const hits = await onScanEpisodeDir(dir);
        if (hits.length === 0) {
            new Notice('该文件夹没有可识别集号的视频文件', 5000);
            return;
        }
        const maxEp = hits[hits.length - 1].ep;
        // 只扩不缩：总集数取当前值与最大命中集号的大者，随后按新总集数扩展数组（保位）
        const curTotal = totalEpisodes ? Number(totalEpisodes) : 0;
        if (maxEp > curTotal) {
            totalEpisodes = String(maxEp);
        }
        resizeEpisodeFiles();
        let filled = 0;
        let skipped = 0;
        for (const h of hits) {
            const i = h.ep - 1;
            if (episodeFiles[i]) {
                skipped++;
                continue;
            }
            episodeFiles[i] = h.path;
            filled++;
        }
        // 数组元素写入后重设引用触发响应式（集按钮 linked 角标/悬停提示即时更新）
        episodeFiles = [...episodeFiles];
        new Notice(`已填入 ${filled} 集本地路径${skipped ? `，跳过已关联 ${skipped} 集` : ''}`, 4000);
    }
    /** 右键编辑：打开第 N 集编辑弹窗（填集标题 / 本地路径 / 网络地址） */
    function openEpEditor(i: number) {
        resizeEpisodeFiles();
        editEp = i;
        editTitle = episodeTitles[i] ?? '';
        editLocal = episodeFiles[i] ?? '';
        editUrl = episodeUrls[i] ?? '';
    }
    /** 编辑弹窗保存：写回数组（空串 → undefined），重新赋值触发响应式 */
    function saveEpEditor() {
        if (editEp === null) return;
        const i = editEp;
        episodeFiles = episodeFiles.map((v, idx) => (idx === i ? editLocal.trim() || undefined : v));
        episodeUrls = episodeUrls.map((v, idx) => (idx === i ? editUrl.trim() || undefined : v));
        episodeTitles = episodeTitles.map((v, idx) => (idx === i ? editTitle.trim() || undefined : v));
        editEp = null;
        new Notice(`第 ${i + 1} 集关联已保存`);
    }
    /** 编辑弹窗清除该集全部关联 */
    function clearEpEditor() {
        if (editEp === null) return;
        const i = editEp;
        episodeFiles = episodeFiles.map((v, idx) => (idx === i ? undefined : v));
        episodeUrls = episodeUrls.map((v, idx) => (idx === i ? undefined : v));
        episodeTitles = episodeTitles.map((v, idx) => (idx === i ? undefined : v));
        editEp = null;
        new Notice(`第 ${i + 1} 集关联已清除`);
    }
    /** 集按钮 hover 提示：第 N 集 + 填写的集标题（如「第 1 集 开始」；未填标题只显示「第 N 集」） */
    function epLinkHint(i: number): string {
        const t = episodeTitles[i];
        return t ? `第 ${i + 1} 集 ${t}` : `第 ${i + 1} 集`;
    }
    /** 编辑弹窗「浏览…」：系统文件选择器（Electron remote.dialog 绝对路径），填入编辑框，保存时写回 */
    async function browseLocalVideo(ev?: MouseEvent) {
        const p = await onPickLocalVideo(ev);
        if (p) {
            editLocal = p;
            new Notice('已选择本地视频，点「保存」生效');
        } else {
            new Notice('无法打开文件选择器，请手动输入路径');
        }
    }
    /** 音乐编辑浮层「浏览…」：系统文件选择器选本地音频，回填 audioPathVal（保存才写回 audioPath） */
    async function browseAudio(ev?: MouseEvent) {
        const p = await onPickLocalAudio(ev);
        if (p) {
            audioPathVal = p;
            new Notice('已选择本地音频，点「保存」生效');
        } else {
            new Notice('未选择文件或系统对话框不可用，请重试');
        }
    }
    /** 游戏编辑浮层「浏览…」：系统文件选择器选启动快捷方式（.lnk），回填 gameLaunchVal（保存才写回 gameLaunchPath） */
    async function browseGameLaunch(ev?: MouseEvent) {
        const p = await onPickGameLaunch(ev);
        if (p) {
            gameLaunchVal = p;
            new Notice('已选择启动快捷方式，点「保存」生效');
        } else {
            new Notice('未选择文件或系统对话框不可用，可手动输入路径');
        }
    }
    /** 书籍「▶ 观看」左键：有关联文件 → 打开阅读器，关闭后自动同步阅读器最新进度（percent 真源派生当前页/章）；无 → 提示右键编辑 */
    async function watchBook() {
        if (bookFileVal.trim()) {
            const rp = await onOpenReader();
            // 阅读器关闭后自动解析当前进度：percent 唯一真源 → 派生当前页/章；totalPage 同步本地基准（PDF 页/TXT 章）
            if (rp) {
                if (rp.totalPage !== undefined) readingTotalPage = String(rp.totalPage);
                if (typeof rp.percent === 'number' && rp.totalPage) {
                    readingPage = String(pageFromPercent(rp.percent, rp.totalPage));
                } else if (rp.page !== undefined) {
                    readingPage = String(rp.page);
                }
            }
        } else {
            new Notice('未关联书籍文件 — 右键「观看」选择 TXT/EPUB/PDF', 5000);
        }
    }
    /** 书籍「▶ 观看」右键：弹编辑浮层（浏览/手动输入路径） */
    function openBookEditor() {
        bookEditOpen = true;
    }
    /** 书籍编辑浮层保存：路径写回 bookFileVal（保存条目时入库） */
    function saveBookEditor() {
        bookEditOpen = false;
        new Notice('书籍文件已更新，点「保存」生效');
        void autoLinkBookProgress(bookFileVal.trim());
    }
    /** 书籍编辑浮层清除：清空关联 */
    function clearBookEditor() {
        bookFileVal = '';
        bookEditOpen = false;
        new Notice('书籍文件关联已清除');
    }
    /** 书籍编辑浮层「浏览…」：系统文件选择器选 TXT/EPUB/PDF，回填 bookFileVal */
    async function browseBookFile(ev?: MouseEvent) {
        const p = await onPickBookFile(ev);
        if (p) {
            bookFileVal = p;
            new Notice('已选择书籍文件，点「保存」生效');
            await autoLinkBookProgress(p);
        } else {
            new Notice('无法打开文件选择器，请手动输入路径');
        }
    }
    /** 进度页数自动关联本地文件：PDF 解析本地页数、TXT 按章节解析 → totalPage 收紧本地基准、当前进度按既有 percent 重算/钳制
     *  （复用 reconcileBookProgress）；EPUB 无轻量探针不解析；无变化/失败静默（保持手填） */
    /** 进度页数自动关联解析。notify=true 时（刷新按钮测试获取）无变化/失败也明确反馈；浏览/保存场景保持静默不打扰 */
    async function autoLinkBookProgress(path: string, notify = false) {
        if (!path) {
            if (notify) new Notice('未关联书籍文件 — 先右键编辑选择 TXT/EPUB/PDF', 4000);
            return;
        }
        const info = await onProbeBookPages(path);
        if (!info) {
            if (notify) new Notice('解析失败：请确认文件存在且为 PDF/TXT', 4000);
            return;
        }
        const total = info.format === 'txt' ? info.totalChapters : info.numPages;
        const unit = info.format === 'txt' ? '章' : '页';
        const r = reconcileBookProgress(
            {
                page: readingPage ? Number(readingPage) || undefined : undefined,
                totalPage: readingTotalPage ? Number(readingTotalPage) || undefined : undefined,
                percent: entry?.readingProgress?.percent,
            },
            info
        );
        if (!r.readingProgress) {
            // 无变化（已解析过）：浏览/保存静默，刷新测试场景明确反馈「已是最新」
            if (notify) new Notice(`解析成功：本地 ${total} ${unit}（已是最新）`, 4000);
            return;
        }
        if (r.readingProgress.totalPage !== undefined) readingTotalPage = String(r.readingProgress.totalPage);
        if (r.readingProgress.page !== undefined) readingPage = String(r.readingProgress.page);
        const hint = r.readingProgress.page !== undefined ? `，当前${unit}同步为 ${r.readingProgress.page}` : '';
        new Notice(`已从本地文件解析：共 ${total} ${unit}${hint}`);
    }
    /** 游戏「▶ 启动」左键：有关联 → 启动游戏；无 → 提示右键编辑 */
    function launchGameFromForm() {
        if (gameLaunchPath.trim()) {
            onLaunchGame();
        } else {
            new Notice('未关联启动快捷方式 — 右键「启动」选择 .lnk 文件', 5000);
        }
    }
    /** 游戏「▶ 启动」右键：弹编辑浮层（浏览/手动输入路径） */
    function openGameEditor() {
        gameLaunchVal = gameLaunchPath;
        gameEditOpen = true;
    }
    /** 游戏编辑浮层保存：路径写回 gameLaunchPath（保存条目时入库） */
    function saveGameEditor() {
        gameLaunchPath = gameLaunchVal.trim();
        gameEditOpen = false;
        new Notice('启动快捷方式已更新，点「保存」生效');
    }
    /** 游戏编辑浮层清除：清空关联 */
    function clearGameEditor() {
        gameLaunchPath = '';
        gameEditOpen = false;
        new Notice('启动快捷方式关联已清除');
    }
    /** 音乐「▶ 播放」左键：有关联 → 播放音频；无 → 提示右键编辑 */
    function playMusicFromForm() {
        if (audioPath.trim()) {
            onPlayMusic();
        } else {
            new Notice('未关联本地音频 — 右键「播放」选择音频文件', 5000);
        }
    }
    /** 音乐「▶ 播放」右键：弹编辑浮层（浏览/手动输入路径） */
    function openAudioEditor() {
        audioPathVal = audioPath;
        audioEditOpen = true;
    }
    /** 音乐编辑浮层保存：路径写回 audioPath（保存条目时入库） */
    function saveAudioEditor() {
        audioPath = audioPathVal.trim();
        audioEditOpen = false;
        new Notice('本地音频已更新，点「保存」生效');
    }
    /** 音乐编辑浮层清除：清空关联 */
    function clearAudioEditor() {
        audioPath = '';
        audioEditOpen = false;
        new Notice('本地音频关联已清除');
    }
    /** Svelte 4 模板不支持 as 断言：统一取值 helper */
    function inputVal(ev: Event): string {
        return (ev.target as HTMLInputElement).value;
    }

    /** 拖入本地图片 → 上传为封面并更新预览 */
    async function onDropPoster(ev: DragEvent) {
        ev.preventDefault();
        const file = ev.dataTransfer?.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            new Notice('仅支持图片文件');
            return;
        }
        try {
            const p = await onUploadPoster(file);
            if (p) {
                poster = p;
                posterUrlInput = '';
            }
        } catch (e) {
            new Notice('封面上传失败：' + (e instanceof Error ? e.message : String(e)));
        }
    }

    /** 网络图片 URL 应用到封面（校验 http/https） */
    function applyPosterUrl() {
        const u = posterUrlInput.trim();
        if (!u) return;
        if (!/^https?:\/\//.test(u)) {
            new Notice('仅支持 http/https 图片链接');
            return;
        }
        poster = u;
        posterUrlInput = '';
    }

    /** 移除封面（手动清空自动回填的封面） */
    function removePoster() {
        poster = '';
        posterUrlInput = '';
    }

    /** 把豆瓣详情字段对象应用到表单变量（幂等：已有值不覆盖） */
    function applyDoubanDetail(d: Record<string, unknown>) {
        if (d.director && !director) director = String(d.director);
        if (Array.isArray(d.screenwriter) && d.screenwriter.length && !screenwriter) screenwriter = d.screenwriter.join(' / ');
        if (Array.isArray(d.cast) && d.cast.length && !cast) cast = d.cast.join(' / ');
        if (Array.isArray(d.genres) && d.genres.length && !genres) genres = d.genres.join(' / ');
        if (d.country && !country) country = String(d.country);
        if (d.language && !language) language = String(d.language);
        if (d.durationMin && !durationMin) durationMin = String(d.durationMin);
        if (type !== 'game' && Array.isArray(d.aliases) && d.aliases.length && !aliases) aliases = d.aliases.join(' / ');
        if (d.episodeCount && (type === 'tv' || type === 'anime') && !totalEpisodes) totalEpisodes = String(d.episodeCount);
        if (d.author && !author) author = String(d.author);
        if (d.album && !album) album = String(d.album);
        if (d.platform && !platform) platform = String(d.platform);
        if (d.developer && !developer) developer = String(d.developer);
        // 译者：书籍条目已删除译者框（用户指示），不再回填；字段按 schema 红线保留
        if (type !== 'book' && d.translator && !translator) translator = String(d.translator);
        if (type !== 'game' && d.publisher && !publisher) publisher = String(d.publisher);
        if (d.producer && !producer) producer = String(d.producer);
        if (d.isbn && !isbn) isbn = String(d.isbn);
        if (d.binding && !binding) binding = String(d.binding);
        if (d.price && !price) price = String(d.price);
        if (d.series && !series) series = String(d.series);
        if (d.pageCount && !pageCountVal) pageCountVal = String(d.pageCount);
        if (d.year && !year) year = String(d.year);
        if (d.summary && !summary) summary = String(d.summary);
        if (d.ratingCount && !ratingCount) ratingCount = String(d.ratingCount);
        if (d.authorIntro && !authorIntro) authorIntro = String(d.authorIntro);
        if (d.toc && !toc) toc = String(d.toc);
        if (d.cover && !poster) poster = String(d.cover);
    }

    /** 题材：普通 input（/ 分隔文本，非标签）——提交时拆分存 genres 数组 */

    /** 主演/声优：普通 input（/ 分隔文本，非标签）——提交时拆分存 cast 数组 */

    async function submit() {
        if (!title.trim()) return;
        // 导演/编剧合并框 → 拆分：第一个 / 前为导演，其余为编剧
        const writers = directorWriters.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean);
        const input: Record<string, unknown> = {
            type,
            title: title.trim(),
            originalTitle: originalTitle.trim() || undefined,
            status,
            rating,
            year: year ? Number(year) || undefined : undefined,
            director: writers[0] ?? undefined,
            screenwriter: writers.slice(1),
            cast: cast.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            genres: genres.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            country: country.trim() || undefined,
            language: language.trim() || undefined,
            durationMin: durationMin ? Number(durationMin) || undefined : undefined,
            aliases: type === 'game' ? undefined : aliases.split(/[\/、,，]/).map((s) => s.trim()).filter(Boolean),
            notes: notes.trim(),
        };
        // 影视类型（电影/电视剧/动画）：观看链接双路径——旧「资源链接」(links) 已迁移到 episodeUrls，此处清空（url 不丢）
        if (type === 'movie' || type === 'tv' || type === 'anime') {
            input.links = [];
            // 按当前总集数截取写入（resize 只扩不缩，超出部分不入库）
            const n = totalEpisodes ? Number(totalEpisodes) : 0;
            const eps = episodeFiles.slice(0, n).filter((p): p is string => !!p);
            const urls = episodeUrls.slice(0, n).filter((u): u is string => !!u);
            const titles = episodeTitles.slice(0, n).filter((t): t is string => !!t);
            input.episodeFiles = eps.length ? eps : undefined;
            input.episodeUrls = urls.length ? urls : undefined;
            input.episodeTitles = titles.length ? titles : undefined;
        } else {
            input.links = entry?.links ?? [];
        }
        if (type === 'book') {
            input.author = author.trim() || undefined;
            input.publisher = publisher.trim() || undefined;
            input.producer = producer.trim() || undefined;
            input.isbn = isbn.trim() || undefined;
            input.binding = binding.trim() || undefined;
            input.price = price.trim() || undefined;
            input.series = series.trim() || undefined;
            input.authorIntro = authorIntro.trim() || undefined;
            input.toc = toc.trim() || undefined;
            input.bookFile = bookFileVal.trim() || undefined;
        }
        if (type === 'game') {
            input.platform = platform.trim() || undefined;
            input.developer = developer.trim() || undefined;
            // 发行商/别名：对游戏条目废弃（豆瓣游戏页无此数据），不再读写
            input.gameLaunchPath = gameLaunchPath.trim() || undefined; // 启动快捷方式（.lnk）
        }
        if (type === 'music') {
            input.author = author.trim() || undefined;
            input.album = album.trim() || undefined;
            input.audioPath = audioPath.trim() || undefined;
        }
        if (poster) input.poster = poster;
        input.source = sourceFrom.trim() || undefined;
        input.sourceUrl = sourceUrl.trim() || undefined;
        input.communityScore = communityScore ? Number(communityScore) || undefined : undefined;
        input.ratingCount = ratingCount ? Number(ratingCount.replace(/,/g, '')) || undefined : undefined;
        input.summary = summary.trim() || undefined;
        // 计划观看日期：仅想看状态携带；其他状态显式清空，避免旧排期残留
        // 过去日期校验：计划观看应面向未来，弹提示并阻止保存
        if (status === 'want' && plannedDate) {
            const t = new Date();
            const tStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
            if (plannedDate < tStr) {
                new Notice('计划观看日期不能是过去的日期 — 请选择今天或之后的日期');
                return;
            }
            input.plannedDate = plannedDate;
        } else {
            input.plannedDate = undefined;
        }
        // 最近观看日期：在看状态携带（所有类型写入 progress.lastWatchedDate，供追更表活跃度计算）；
        // 非在看的剧集/动画显式清空，避免旧日期残留
        if (status === 'watching') {
            input.progress = {
                season: type === 'tv' || type === 'anime' ? season : (entry?.progress?.season ?? 1),
                episode: type === 'tv' || type === 'anime' ? episode : (entry?.progress?.episode ?? 0),
                totalEpisodes: type === 'movie' || type === 'tv' || type === 'anime'
                    ? (totalEpisodes ? Number(totalEpisodes) || undefined : undefined)
                    : entry?.progress?.totalEpisodes,
                lastWatchedDate: lastWatchedDate || undefined,
                history: entry?.progress?.history ?? [],
            };
        } else if (type === 'movie' || type === 'tv' || type === 'anime') {
            // 编辑时保留既有追更历史，但非在看状态清空最近观看日期；电影无季/集进度，保留原值仅写总集数
            input.progress = {
                season: type === 'movie' ? (entry?.progress?.season ?? 1) : season,
                episode: type === 'movie' ? (entry?.progress?.episode ?? 0) : episode,
                totalEpisodes: totalEpisodes ? Number(totalEpisodes) || undefined : undefined,
                lastWatchedDate: undefined,
                history: entry?.progress?.history ?? [],
            };
        }
        // 观看日期：已看状态携带（所有类型；含剧集/动画）
        if (status === 'watched' && watchedDate) input.watchedDate = watchedDate;
        // 书籍阅读进度 / 游戏游玩时长（有值才携带）
        if (type === 'book') {
            const page = readingPage ? Number(readingPage) || undefined : undefined;
            const totalPage = readingTotalPage ? Number(readingTotalPage) || undefined : undefined;
            // percent 唯一真源：表单无 percent 输入项，保存保留既有值（阅读器自动落库进度不被覆盖；无则缺省）
            const percent = entry?.readingProgress?.percent;
            const rp: { page?: number; totalPage?: number; percent?: number } = { page, totalPage };
            if (percent !== undefined) rp.percent = percent;
            input.readingProgress = rp.page || rp.totalPage || rp.percent !== undefined ? rp : undefined;
            // 元数据页数（豆瓣实体书；与进度基准分离，仅展示/统计）
            input.pageCount = pageCountVal ? Number(pageCountVal) || undefined : undefined;
        }
        if (type === 'game') {
            // 游玩时长：小时录入 → 落库分钟（游玩记录明细由弹窗即时落盘，submit 不再重复提交）
            input.playtimeMinutes = playtimeHours ? Math.round(Number(playtimeHours) * 60) || undefined : undefined;
        }
        await onSubmit(input);
    }

    function setStar(n: number) {
        rating = rating === n ? 0 : n;
    }

    /** 来源徽标直达：模板属性按 JS 解析不能用 TS `!`，故在 script 端守卫 undefined */
    function openSource(url: string | undefined): void {
        if (url) onOpenSource(url);
    }
    function openSourceOnEnter(ev: KeyboardEvent, url: string | undefined): void {
        if (ev.key === 'Enter' && url) onOpenSource(url);
    }

    /** 数据源标识 → 徽标文本（标题旁来源链接用；未知/空回退「来源」） */
    function sourceLabelText(): string {
        return (
            { douban: '豆瓣', tmdb: 'TMDB', bangumi: 'Bangumi', google: 'Google Books', openlibrary: 'Open Library', igdb: 'IGDB', steam: 'Steam', musicbrainz: 'MusicBrainz', itunes: 'iTunes', omdb: 'IMDb', anilist: 'AniList' } as Record<string, string>
        )[sourceFrom] ?? (sourceFrom || '来源');
    }
</script>

<div
    class="rl-form"
    on:keydown={(ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
            ev.preventDefault();
            submit();
        }
    }}
>
    <div class="rl-fhd">
        {entry ? `编辑条目：${entry.title}` : pickedTitle ? `添加条目：${pickedTitle}` : '添加条目'}
        <span class="rl-fsrc">类型：{ENTRY_TYPE_LABELS[type]} · {sourceListText}</span>
    </div>

    {#if !entry || refetchOpen}
        <div class="rl-frow">
            <div class="rl-searchbox">
                <select class="rl-search-type" bind:value={type} aria-label="条目类型">
                    {#each ENTRY_TYPES as t}
                        <option value={t}>{ENTRY_TYPE_LABELS[t]}</option>
                    {/each}
                </select>
                <input class="rl-search-input" placeholder="输入标题…" bind:value={query} bind:this={queryInput}
                    on:keydown={(ev) => { if (ev.key === 'Enter') doSearch(); else if (ev.key === 'Escape') query = ''; }} />
            </div>
            <button class="rl-btn rl-btn-primary" disabled={searching} on:click={doSearch}>
                {searching ? '搜索中…' : '搜索'}
            </button>
            <!-- 手动填写：跳过搜索直接进入字段区手填；编辑模式「重新拉取」时点此收起搜索区保留现状 -->
            <button class="rl-btn" on:click={() => { results = []; searchError = ''; picked = true; refetchOpen = false; }}>手动填写</button>
        </div>
    {/if}

    {#if searching}
        <!-- 逐源真实进度：每个参与源一行实时状态（先返回先亮「已返回 N 条」，未完成「搜索中…」，超时/失败给文案） -->
        <div class="rl-prog-srcs" aria-hidden="true">
            {#each sourcePlan as sid}
                {@const sl = srcLive[sid]}
                <span
                    class="rl-prog-src"
                    class:rl-prog-src-ok={sl?.state === 'ok' || sl?.state === 'empty'}
                    class:rl-prog-src-bad={sl?.state === 'failed' || sl?.state === 'timeout' || sl?.state === 'blocked'}>
                    {srcStateText(sl, sourceEnLabel(sid))}
                </span>
            {/each}
        </div>
        <div class="rl-progress" aria-hidden="true">
            <div class="rl-progress-fill" style={`width:${progPct}%`}></div>
        </div>
        <div class="rl-progress-meta">
            <span class="rl-progress-label">{sourcePlan.length > 0 ? `正在搜索 ${sourcePlan.length} 个数据源` : (progLabel || '正在搜索…')}</span>
            <span class="rl-progress-eta">{progPct}%</span>
        </div>
    {/if}

    {#if !sourceReady}
        <div class="rl-hint">{sourceHint}</div>
    {/if}
    {#if searchError}
        <div class="rl-err">{searchError}</div>
    {/if}

    {#if results.length > 0 && !picked}
        <div class="rl-res-head">
            <span class="rl-res-head-cnt">共 {results.length} 条结果</span>
            <span class="rl-res-head-hint">点击卡片回填 · 点击空白取消 · 徽标直达来源</span>
        </div>
        <div class="rl-res" style={`--rl-cols:${Math.max(1, resultColumns.length)}`} on:click={onResClick}>
            {#each resultColumns as col}
                <div class="rl-res-col">
                    <div class="rl-res-col-head">
                        <span class="rl-res-col-name">{col.label}</span>
                        <span class="rl-res-col-cnt">{col.items.length}</span>
                    </div>
                    {#each col.items as r (resultKey(r))}
                        {@const d = describeSearchResult(r)}
                        <button class="rl-res-item" on:click|stopPropagation={() => pick(r)} data-tip="点击回填该条目">
                            {#if d.cover}
                                <img class="rl-res-cv" src={d.cover} alt="" loading="lazy" referrerpolicy={isDoubanImage(d.cover) ? 'unsafe-url' : undefined} />
                            {:else}
                                <span class="rl-res-cv rl-res-ph"><span class="rl-res-ico">{typeIcon(type)}</span></span>
                            {/if}
                            <span class="rl-res-inf">
                                <span class="rl-res-rows">
                                    <span class="rl-res-row1">
                                        <span class="rl-res-t">{d.title}</span>
                                    </span>
                                    <span class="rl-res-row2">
                                        {#if d.year}<span class="rl-res-yr">{d.year}</span>{/if}{#if d.year && d.rating != null}<span class="rl-res-dot">·</span>{/if}
                                        {#if d.rating != null}<span class="rl-res-score">★ {d.rating}</span>{/if}
                                        {#if d.sub}{#if d.year || d.rating != null}<span class="rl-res-dot">·</span>{/if}<span class="rl-res-o">{d.sub}</span>{/if}
                                    </span>
                                </span>
                                {#if d.sourceUrl}
                                    <span
                                        class="rl-res-source"
                                        role="link"
                                        tabindex="0"
                                        data-tip="打开 {d.source} 页面"
                                        on:click|stopPropagation={() => openSource(d.sourceUrl)}
                                        on:keydown={(ev) => openSourceOnEnter(ev, d.sourceUrl)}>
                                        {d.source} ↗
                                    </span>
                                {/if}
                            </span>
                        </button>
                    {/each}
                    {#if col.empty}
                        <div class="rl-res-col-empty" on:click|stopPropagation data-tip="该来源本次搜索未返回可展示结果">
                            该源暂无匹配结果
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    {#if picked}
        <div class="rl-fields">
            <!-- 1. 作品基础信息（左封面边栏 + 右字段区，两列布局） -->
            <div class="rl-section">作品基础信息</div>
            <div class="rl-basic-grid">
                <!-- 左：封面边栏（右键弹菜单更换 / 拖入本地图片） -->
                <div class="rl-poster-col">
                    <div
                        class="rl-poster-zone"
                        class:on={!!previewUrl}
                        on:contextmenu|preventDefault={openPosterCtx}
                        on:dragover|preventDefault
                        on:drop={onDropPoster}
                        data-tip="右键更换封面 / 拖入本地图片">
                        {#if previewUrl}
                            <img class="rl-poster-preview" src={previewUrl} alt="封面" referrerpolicy={isDoubanImage(previewUrl) ? 'unsafe-url' : undefined} />
                        {:else}
                            <div class="rl-poster-ph">拖入图片<br/>右键更换</div>
                        {/if}
                    </div>
                    <!-- 隐藏的文件选择器（右键菜单「更换本地图片」触发） -->
                    <input type="file" accept="image/*" class="rl-hidden" bind:this={fileInput} on:change={onFileSelected} />
                    <div class="rl-poster-hint">右键更换封面</div>
                    <!-- 右键菜单：本地 / 网络 / 移除 -->
                    {#if ctxOpen}
                        <div class="rl-ctx" style={`left:${ctxX}px;top:${ctxY}px`} role="menu" on:click|stopPropagation>
                            {#if !ctxUrlMode}
                                <button on:click={pickFile}>更换本地图片…</button>
                                <button on:click={() => (ctxUrlMode = true)}>更换网络图片…</button>
                                {#if previewUrl}
                                    <button class="rl-ctx-danger" on:click={removePoster}>移除封面</button>
                                {/if}
                            {:else}
                                <div class="rl-ctx-url">
                                    <input class="rl-input" placeholder="https://…" bind:value={posterUrlInput}
                                        on:keydown={(ev) => { if (ev.key === 'Enter') applyPosterUrl(); else if (ev.key === 'Escape') closeCtx(); }} />
                                    <button class="rl-btn rl-btn-primary" on:click={applyPosterUrl}>使用</button>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
                <!-- 右：字段区 -->
                <div class="rl-fields-col">
                    {#if type === 'book'}
                        <label class="rl-lbl">书名</label>
                        <div class="rl-title-row">
                            <input class="rl-input" bind:value={title} bind:this={titleInput} />
                            {#if communityScore || ratingCount}
                                <span class="rl-title-score" data-tip="大众评分（数据源回填，只读）">★ {communityScore || '—'}{ratingCount ? ` · ${ratingCount}人评价` : ''}</span>
                            {/if}
                            {#if sourceUrl}
                                <button class="rl-btn rl-btn-src" data-tip="打开数据源页面" on:click={() => openSource(sourceUrl)}>{sourceLabelText()} ↗</button>
                            {/if}
                        </div>
                    {:else}
                        <label class="rl-lbl">标题</label>
                        <div class="rl-title-row">
                            <input class="rl-input" bind:value={title} bind:this={titleInput} />
                            {#if communityScore || ratingCount}
                                <span class="rl-title-score" data-tip="大众评分（数据源回填，只读）">★ {communityScore || '—'}{ratingCount ? ` · ${ratingCount}人评价` : ''}</span>
                            {/if}
                            {#if sourceUrl}
                                <button class="rl-btn rl-btn-src" data-tip="打开数据源页面" on:click={() => openSource(sourceUrl)}>{sourceLabelText()} ↗</button>
                            {/if}
                        </div>
                    {/if}
                    {#if type !== 'book' && type !== 'music'}
                    <div class="rl-2col">
                        <div>
                            <label class="rl-lbl">题材</label>
                            <input class="rl-input" bind:value={genres} placeholder="多个题材用 / 分隔" />
                        </div>
                        <div>
                            <label class="rl-lbl">{type === 'movie' ? '上映年' : type === 'game' || type === 'music' ? '发行年' : '首播年'}</label>
                            <input class="rl-input" bind:value={year} />
                        </div>
                    </div>
                    {/if}
            {#if type === 'book'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">出版年</label><input class="rl-input" bind:value={year} /></div>
                    <div><label class="rl-lbl">出版社</label><input class="rl-input" bind:value={publisher} /></div>
                </div>
                <div><label class="rl-lbl">作者</label><input class="rl-input" bind:value={author} /></div>
            {/if}
            {#if type === 'music'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">作者</label><input class="rl-input" bind:value={author} placeholder="歌手 / 艺术家" /></div>
                    <div><label class="rl-lbl">专辑</label><input class="rl-input" bind:value={album} placeholder="所属专辑（手动填写）" /></div>
                </div>
            {/if}
            {#if type === 'movie' || type === 'tv' || type === 'anime'}
                <div class="rl-2col">
                    <div>
                        <label class="rl-lbl">导演</label>
                        <input class="rl-input" bind:value={directorWriters} placeholder="导演 / 编剧 用 / 分隔" />
                    </div>
                    {#if formMode !== 'bangumi'}
                        <div>
                            <label class="rl-lbl">{type === 'anime' ? '主演（声优）' : '主演'}</label>
                            <input class="rl-input" bind:value={cast} placeholder="多个主演用 / 分隔" />
                        </div>
                    {:else if type === 'tv' || type === 'anime'}
                        <div>
                            <label class="rl-lbl">总集数</label>
                            <input class="rl-input" type="number" min="0" bind:value={totalEpisodes} on:input={resizeEpisodeFiles} placeholder="可留空" />
                        </div>
                    {/if}
                </div>
            {/if}
            {#if type === 'game'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">平台</label><input class="rl-input" bind:value={platform} placeholder="PC / Switch / PS5" /></div>
                    <div><label class="rl-lbl">开发商</label><input class="rl-input" bind:value={developer} /></div>
                </div>
            {/if}

            {#if (type === 'tv' || type === 'anime') && formMode !== 'bangumi'}
                <!-- 总集数 + 当前进度并排（动画/电视剧；电影无总集数概念，观看链接区渲染单集播放钮）：
                     两字段同一行两列，行高与同列条目一致、信息密度更高 -->
                <div class="rl-2col">
                    <div>
                        <label class="rl-lbl">总集数</label>
                        <input class="rl-input" type="number" min="0" bind:value={totalEpisodes} on:input={resizeEpisodeFiles} placeholder="可留空" />
                    </div>
                    <div>
                        <label class="rl-lbl" data-tip="列表/月历按此显示进度">当前进度</label>
                        <div class="rl-watch-prog">
                            <span class="rl-watch-prefix">S</span>
                            <input class="rl-input rl-watch-num" type="number" min="1" value={season} on:input={(ev) => (season = clampWatch(Number(ev.currentTarget.value), 1, entry?.progress?.season ?? 1))} />
                            <span class="rl-watch-prefix">E</span>
                            <input class="rl-input rl-watch-num" type="number" min="0" value={episode} on:input={(ev) => (episode = clampWatch(Number(ev.currentTarget.value), 0, entry?.progress?.episode ?? 1))} />
                        </div>
                    </div>
                </div>
            {/if}
            {#if type === 'book'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">ISBN</label><input class="rl-input" bind:value={isbn} placeholder="如 9787536692930" /></div>
                    <div>
                        <label class="rl-lbl">元数据页数</label>
                        <input class="rl-input" type="number" min="0" bind:value={pageCountVal} placeholder="豆瓣页数（实体书，仅展示/统计）" />
                    </div>
                </div>
            {/if}

            <label class="rl-lbl">{type === 'book' ? '内容简介' : '简介'}</label>
            <textarea class="rl-input rl-summary" rows="6" bind:this={summaryEl} placeholder={type === 'book' ? '图书内容简介（豆瓣详情回填，可手动修改）' : '作品剧情简介（搜索自动回填，可手动修改）'} bind:value={summary}></textarea>
            {#if type === 'game'}
                <div class="rl-2col">
                    <div><label class="rl-lbl">游玩时长（小时）</label><input class="rl-input" type="number" min="0" step="0.1" bind:value={playtimeHours} placeholder="如 12（有游玩记录时以明细为准）" /></div>
                </div>
                <div>
                    <label class="rl-lbl">启动快捷方式</label>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!gameLaunchPath.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={launchGameFromForm}
                                on:contextmenu={(ev) => { ev.preventDefault(); openGameEditor(); }}
                                data-tip={gameLaunchPath.trim() ? `启动：${gameLaunchPath}\n右键编辑/浏览更换` : '未关联启动快捷方式 — 右键编辑选择 .lnk'}>
                                <Icon icon="play" size={11} /> 启动
                            </button>
                        </span>
                        {#if gameEditOpen}
                            <!-- 启动快捷方式编辑浮层（参照书籍文件浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={() => (gameEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-label="编辑启动快捷方式">
                                <div class="rl-ep-edit-title">启动快捷方式（.lnk）</div>
                                <label class="rl-lbl-inline">文件路径</label>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={gameLaunchVal} on:input={(ev) => (gameLaunchVal = inputVal(ev))} placeholder="vault 相对路径或系统绝对路径（.lnk）" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseGameLaunch(ev)} data-tip="选择游戏启动快捷方式（库内/系统二选一）">浏览…</button>
                                </div>
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveGameEditor} data-tip="保存启动快捷方式关联">保存</button>
                                    <button class="rl-btn" disabled={!gameLaunchPath} on:click={clearGameEditor} data-tip="清除启动快捷方式关联">清除</button>
                                    <button class="rl-btn" on:click={() => (gameEditOpen = false)}>取消</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}
            {#if type === 'book'}
                <label class="rl-lbl">作者简介</label>
                <textarea class="rl-input rl-summary" rows="3" bind:this={authorIntroEl} placeholder="作者介绍（豆瓣详情页回填，可手动修改）" bind:value={authorIntro}></textarea>
                <label class="rl-lbl">目录</label>
                <textarea class="rl-input rl-summary" rows="4" bind:this={tocEl} placeholder="图书目录（豆瓣详情页回填，可手动修改）" bind:value={toc}></textarea>
                <label class="rl-lbl">{bookUnitLabel}</label>
                <div class="rl-prog-range">
                    <input class="rl-input rl-prog-input" type="number" min="0" bind:value={readingPage} placeholder="当前" />
                    <span class="rl-prog-dash">-</span>
                    <input class="rl-input rl-prog-input" type="number" min="0" bind:value={readingTotalPage} placeholder={bookUnit === '章' ? '总章节（自动解析）' : '总页数（自动解析）'} />
                    <button
                        class="rl-prog-refresh"
                        on:click={() => void autoLinkBookProgress(bookFileVal.trim(), true)}
                        aria-label="重新解析本地文件（测试获取）">
                        <Icon icon="refresh-cw" size={11} />
                    </button>
                </div>
                {#if readingPage && readingTotalPage}
                    <div class="rl-readbar {readbarClass}"><div class="rl-readbar-fill" style={`width:${readPct}%`}></div></div>
                    <div class="rl-hint">已读 {readingPage} / {readingTotalPage} {bookUnit} · 进度 {readPct}%{#if readPct >= 100} · 已读完，可标记「已读」{/if}</div>
                    {#if status === 'want' && Number(readingPage) > 0}
                        <div class="rl-hint rl-hint-warn">⚠ 已有阅读进度 {readPct}%，建议切到「在读」</div>
                    {/if}
                {/if}
            {/if}
            {#if type === 'music'}
                <div>
                    <label class="rl-lbl">本地音频</label>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!audioPath.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={playMusicFromForm}
                                on:contextmenu={(ev) => { ev.preventDefault(); openAudioEditor(); }}
                                data-tip={audioPath.trim() ? `播放：${audioPath}\n右键编辑/浏览更换` : '未关联本地音频 — 右键编辑选择音频文件'}>
                                <Icon icon="play" size={11} /> 播放
                            </button>
                        </span>
                        {#if audioEditOpen}
                            <!-- 本地音频编辑浮层（参照书籍文件浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={() => (audioEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-label="编辑本地音频">
                                <div class="rl-ep-edit-title">本地音频</div>
                                <label class="rl-lbl-inline">文件路径</label>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={audioPathVal} on:input={(ev) => (audioPathVal = inputVal(ev))} placeholder="vault 相对路径或系统绝对路径" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseAudio(ev)} data-tip="选择音频（库内/系统二选一）">浏览…</button>
                                </div>
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveAudioEditor} data-tip="保存本地音频关联">保存</button>
                                    <button class="rl-btn" disabled={!audioPath} on:click={clearAudioEditor} data-tip="清除本地音频关联">清除</button>
                                    <button class="rl-btn" on:click={() => (audioEditOpen = false)}>取消</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            {#if type === 'book'}
                <div>
                    <label class="rl-lbl">书籍文件</label>
                    <div class="rl-ep-row">
                        <span class="rl-ep-wrap" class:linked={!!bookFileVal.trim()}>
                            <button
                                class="rl-ep-btn rl-ep-btn-book"
                                on:click={watchBook}
                                on:contextmenu={(ev) => { ev.preventDefault(); openBookEditor(); }}
                                data-tip={bookFileVal.trim() ? `打开阅读器：${bookFileVal}\n右键编辑/浏览更换` : '未关联书籍文件 — 右键编辑选择 TXT/EPUB/PDF'}>
                                <Icon icon="book-open" size={11} /> 阅读
                            </button>
                        </span>
                        {#if bookEditOpen}
                            <!-- 书籍文件编辑浮层（参照集按钮浮层）：浏览选择/手动输入路径 -->
                            <div class="rl-ep-edit-mask" on:click={() => (bookEditOpen = false)}></div>
                            <div class="rl-ep-edit" role="dialog" aria-label="编辑书籍文件">
                                <div class="rl-ep-edit-title">书籍文件（TXT/EPUB/PDF）</div>
                                <label class="rl-lbl-inline">文件路径</label>
                                <div class="rl-ep-edit-row">
                                    <input class="rl-input rl-ep-edit-input" value={bookFileVal} on:input={(ev) => (bookFileVal = inputVal(ev))} placeholder="vault 相对路径，如 书籍/三体.txt" />
                                    <button class="rl-btn rl-link-act" on:click={(ev) => browseBookFile(ev)} data-tip="选择书籍文件（库内/系统二选一）">浏览…</button>
                                </div>
                                <div class="rl-ep-edit-ops">
                                    <button class="rl-btn" on:click={saveBookEditor} data-tip="保存书籍文件关联">保存</button>
                                    <button class="rl-btn" on:click={clearBookEditor} data-tip="清除书籍文件关联">清除</button>
                                    <button class="rl-btn" on:click={() => (bookEditOpen = false)}>取消</button>
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- 观看链接（网络 + 本地合一）：电影 = 单集 ▶ 观看按钮（左键播放/打开第 1 集，右键编辑关联）；
                 剧集/动画 = 1..N 集小按钮（左键播放/打开、右键编辑本地或网络），支持「从文件夹检索剧集…」批量按文件名集号填入 -->
            {#if type === 'movie' || type === 'tv' || type === 'anime'}
                <div>
                    <div class="rl-lbl-row">
                        <label class="rl-lbl">观看链接</label>
                        {#if type !== 'movie'}
                            <!-- 批量检索（动画/电视剧）图标：选文件夹 → 识别文件名集号自动填入未关联集本地路径（已填跳过） -->
                            <button
                                class="rl-ep-batch-btn"
                                aria-label="从文件夹检索剧集"
                                data-tip="从文件夹检索剧集：选含剧集文件的文件夹，识别文件名集号（第N集 / S01E0N / 01…）自动填入本地路径，已填集跳过"
                                on:click={() => void batchScanLocalEps()}><Icon icon="folder-search" size={13} /></button>
                        {/if}
                    </div>
                    {#if type === 'movie' || Number(totalEpisodes) > 0}
                        <div class="rl-ep-grid">
                            {#if type === 'movie'}
                                <span class="rl-ep-wrap" class:linked={!!episodeFiles[0] || !!episodeUrls[0]}>
                                    <button
                                        class="rl-ep-btn rl-ep-btn-book"
                                        aria-label="观看（第 1 集）"
                                        on:click={() => playOrOpenEpisode(0)}
                                        on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(0); }}
                                        data-tip={epLinkHint(0)}><Icon icon="play" size={12} /> 观看</button>
                                </span>
                            {:else}
                                {#each Array.from({ length: Number(totalEpisodes) }, (_, i) => i) as i}
                                    <span class="rl-ep-wrap" class:linked={!!episodeFiles[i] || !!episodeUrls[i]}>
                                        <button
                                            class="rl-ep-btn"
                                            on:click={() => playOrOpenEpisode(i)}
                                            on:contextmenu={(ev) => { ev.preventDefault(); openEpEditor(i); }}
                                            data-tip={epLinkHint(i)}>{i + 1}</button>
                                    </span>
                                {/each}
                            {/if}
                        </div>
                    {:else}
                        <div class="rl-hint">填总集数后可逐集关联；或点标题旁「检索文件夹」图标按文件名集号自动填入</div>
                    {/if}
                </div>
                {#if editEp !== null}
                    <!-- 第 N 集编辑弹窗（EntryForm 内自绘浮层，不需 Obsidian App）：填写集标题 / 本地路径 / 网络地址 -->
                    <div class="rl-ep-edit-mask" on:click={() => (editEp = null)}></div>
                    <div class="rl-ep-edit" role="dialog" aria-label={`编辑第 ${editEp + 1} 集`}>
                        <div class="rl-ep-edit-title">编辑第 {editEp + 1} 集</div>
                        <label class="rl-lbl-inline">集标题（悬停显示「第 N 集 + 标题」）</label>
                        <input class="rl-input rl-ep-edit-input" value={editTitle} on:input={(ev) => (editTitle = inputVal(ev))} placeholder="如：开始" />
                        <label class="rl-lbl-inline">本地路径</label>
                        <div class="rl-ep-edit-row">
                            <input class="rl-input rl-ep-edit-input" value={editLocal} on:input={(ev) => (editLocal = inputVal(ev))} placeholder="本地视频路径" />
                            <button class="rl-btn rl-link-act" on:click={(ev) => browseLocalVideo(ev)} data-tip="选择本地视频（库内/系统二选一）">浏览…</button>
                        </div>
                        <label class="rl-lbl-inline">网络地址</label>
                        <input class="rl-input rl-ep-edit-input" value={editUrl} on:input={(ev) => (editUrl = inputVal(ev))} placeholder="https://…" />
                        <div class="rl-ep-edit-ops">
                            <button class="rl-btn" on:click={saveEpEditor} data-tip="保存本集标题/本地/网络关联">保存</button>
                            <button class="rl-btn" on:click={clearEpEditor} data-tip="清除本集标题与本地/网络关联">清除</button>
                            <button class="rl-btn" on:click={() => (editEp = null)}>取消</button>
                        </div>
                    </div>
                {/if}
            {/if}
            <!-- 个人状态与评价——标题左移对齐"作品基础信息"首字（弹窗最左）；内容仍与"简介"label 同列 -->
            <div class="rl-section rl-section-left">个人状态与评价</div>
            <div class="rl-status-row rl-status-lg">
                <span class="rl-status-chips">
                    <span class="rl-lbl-inline">{statusVerb(type)}状态</span>
                    {#each STATUS_OPTIONS as s}
                        <button class:on={status === s} class="rl-chip" on:click={() => (status = s)}>
                            {statusLabel(type, s)}
                        </button>
                    {/each}
                </span>
                {#if status === 'want'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">计划{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={plannedDate} />
                    </span>
                {:else if status === 'watching'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">最近{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={lastWatchedDate} data-tip="追番表活跃度按此日期计算：≤3 天活跃、≤7 天待看、>7 天滞后" />
                    </span>
                {:else if status === 'watched'}
                    <span class="rl-status-date">
                        <span class="rl-lbl-inline">{statusVerb(type)}日期</span>
                        <input class="rl-input" type="date" bind:value={watchedDate} />
                    </span>
                {/if}
            </div>
            <label class="rl-lbl">我的评分</label>
            <div class="rl-stars-input">
                {#each [1, 2, 3, 4, 5] as n}
                    <span class:on={n <= rating} on:click={() => setStar(n)}>★</span>
                {/each}
                <span class="rl-stars-val">{rating ? `${rating}/5` : '未评分'}</span>
            </div>
            <label class="rl-lbl">个人评语</label>
            <textarea class="rl-input rl-notes" rows="3" placeholder={`支持 [[双链]] 语法，写下你的${reviewLabel(type)}…`} bind:value={notes}></textarea>

                </div><!-- /rl-fields-col -->
            </div><!-- /rl-basic-grid -->
        </div><!-- /rl-fields -->
    {/if}

    <div class="rl-fft">
        <div>
            {#if entry}
                <button class="rl-btn rl-btn-danger" on:click={onDelete}>删除条目</button>
                <button class="rl-btn" on:click={startRefetch} data-tip="按当前标题重搜数据源，回填客观字段（不覆盖主观内容与关联）">重新拉取</button>
                {#if entry.type === 'book'}
                    <button class="rl-btn rl-btn-excerpt" on:click={onAddExcerpt} data-tip="从外部阅读器复制文本，生成摘抄块">添加摘抄</button>
                {:else if entry.type === 'game'}
                    <button class="rl-btn rl-btn-excerpt" on:click={onRecordPlaySession} data-tip="日期 + 时长 + 心得，保存到游戏笔记">记录游玩</button>
                {/if}
            {/if}
        </div>
        <div class="rl-fft-right">
            {#if picked}
                <button class="rl-btn rl-btn-primary" disabled={!title.trim()} on:click={submit}>保存并生成笔记</button>
            {/if}
        </div>
    </div>
</div>

<style>
    .rl-form {
        font-size: 13px;
        height: 100%; display: flex; flex-direction: column;
        min-height: 0;
    }
    /* 头部与滚动内容区（flex 布局让底部操作栏固定在弹窗底部，内容滚动时完全遮住背后信息） */
    .rl-fhd { flex: none; }
    .rl-frow { flex: none; }
    .rl-fhd { font-weight: 600; font-size: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: baseline; }
    .rl-fsrc { font-size: 11px; color: var(--text-faint); font-weight: 400; }
    .rl-frow { display: flex; gap: 8px; align-items: center; }
    /* 组合输入框：类型下拉（左 Label）+ 输入框（右），共享边框与圆角 */
    .rl-searchbox { display: flex; align-items: stretch; flex: 1; min-width: 0; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); overflow: hidden; }
    .rl-searchbox:focus-within { border-color: var(--interactive-accent); }
    .rl-search-type { border: none; background: transparent; color: var(--text-muted); font-size: 12px; padding: 5px 8px; cursor: pointer; flex: none; border-right: 1px solid var(--background-modifier-border); }
    /* 类型下拉展开的选项列表：原生 option 不继承主题变量，暗黑模式下默认白底蓝字——显式设主题色（亮/暗自适应） */
    .rl-search-type option { background: var(--background-secondary); color: var(--text-normal); }
    .rl-search-input { border: none; background: transparent; color: var(--text-normal); font-size: 12px; padding: 5px 9px; flex: 1; min-width: 0; }
    .rl-search-input:focus { outline: none; }
    .rl-input { font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); border-radius: 6px; padding: 5px 9px; width: 100%; }
    .rl-input:focus { outline: none; border-color: var(--interactive-accent); }
    .rl-btn-danger { color: var(--text-error); border-color: var(--text-error); background: transparent; font-weight: 600; }
    .rl-btn-danger:hover { background: var(--text-error); color: #fff; }
    .rl-btn-excerpt { color: var(--interactive-accent); border-color: var(--interactive-accent); background: transparent; font-weight: 600; margin-left: 8px; }
    .rl-btn-excerpt:hover { background: var(--interactive-accent); color: var(--text-on-accent); }
    .rl-hint { font-size: 11px; color: var(--text-faint); margin-top: 6px; }
    .rl-err { font-size: 11px; color: var(--text-error); margin-top: 6px; }
    /* ── 搜索进度条（朴素版：无流光/脉冲/淡出等网页式动效，符合 Obsidian 插件观感） ── */
    .rl-progress { position: relative; height: 6px; background: var(--background-modifier-border); border-radius: 4px; overflow: hidden; margin-top: 10px; }
    /* 填充：纯色 + 平滑宽度过渡 */
    .rl-progress-fill {
        height: 100%; border-radius: 4px;
        background: var(--interactive-accent);
        transition: width .3s ease;
    }
    .rl-progress-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 5px; font-size: 11px; color: var(--text-faint); }
    .rl-progress-label { color: var(--text-muted); }
    .rl-progress-eta { color: var(--text-faint); }
    /* 逐源进度行：每源一个小标签，先返回的标记为已完成（主题色），未完成灰态 */
    .rl-prog-srcs { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 2px 0 6px; }
    .rl-prog-src { font-size: 11px; color: var(--text-faint); border: 1px solid var(--background-modifier-border); border-radius: 999px; padding: 1px 9px; line-height: 18px; white-space: nowrap; user-select: none; }
    .rl-prog-src-ok { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-prog-src-bad { color: var(--text-error); border-color: var(--text-error); }
    .rl-res-head { display: flex; align-items: baseline; gap: 10px; margin: 8px 0 10px; }
    .rl-res-head-cnt { font-size: 12px; font-weight: 700; color: var(--text-normal); }
    .rl-res-head-cnt::before { content: ''; display: inline-block; width: 3px; height: 12px; border-radius: 2px; background: var(--interactive-accent); margin-right: 7px; vertical-align: -2px; }
    .rl-res-head-hint { font-size: 10px; color: var(--text-faint); }
    /* 单列横排卡片：左侧小封面 + 右侧信息列（标题 + 年份/评分/原名紧凑排布 + 来源徽标右上角） */
    /* 结果多栏 grid：列数 = 当前栏数（固定占栏），1~3 栏显式排布不再 auto-fit 猜——避免窄窗下栏位换行堆叠 */
    .rl-res { margin-top: 4px; flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 4px 4px 0; max-height: 52vh; display: grid; grid-template-columns: repeat(var(--rl-cols, 1), minmax(0, 1fr)); gap: 10px 12px; align-items: start; }
    .rl-res-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 4px 6px 6px; background: var(--background-secondary); }
    .rl-res-col-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px; margin-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border); user-select: none; }
    .rl-res-col-name { font-size: 12px; font-weight: 600; color: var(--text-normal); flex: none; display: inline-flex; align-items: center; gap: 6px; }
    .rl-res-col-name::before { content: ''; display: inline-block; width: 3px; height: 12px; border-radius: 2px; background: var(--interactive-accent); flex: none; }
    .rl-res-col-cnt { font-size: 10px; color: var(--text-muted); background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 0 6px; line-height: 16px; flex: none; margin-left: auto; }
    .rl-res-col-empty { font-size: 11px; color: var(--text-faint); border: 1px dashed var(--background-modifier-border); border-radius: 8px; padding: 12px 8px; text-align: center; line-height: 1.5; user-select: none; }
    .rl-res-item { display: flex; gap: 12px; align-items: center; width: 100%; text-align: left; font-family: inherit; font-size: 12px; border: 1px solid transparent; background: var(--background-primary); border-radius: 8px; padding: 6px 10px; cursor: pointer; color: var(--text-normal); line-height: 1.4; transition: background-color .12s, border-color .12s; }
    .rl-res-item:hover { background: var(--background-modifier-hover); border-color: var(--background-modifier-border-hover, var(--background-modifier-border)); }
    .rl-res-item:focus-visible { outline: none; border-color: var(--interactive-accent); }
    /* 封面：48×72 px 缩略图（2:3 海报比例，object-fit: contain 完整显示不裁切；横图/方图上下留背景色） */
    .rl-res-cv { width: 48px; height: 72px; border-radius: 4px; flex: none; display: block; object-fit: contain; background-color: var(--background-secondary); overflow: hidden; }
    .rl-res-ph { display: flex; align-items: center; justify-content: center; background: var(--background-secondary); }
    .rl-res-ico { font-size: 16px; opacity: .7; }
    .rl-res-inf { flex: 1; min-width: 0; display: flex; gap: 10px; align-items: center; padding-right: 4px; }
    .rl-res-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; justify-content: center; }
    .rl-res-row1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .rl-res-t { font-weight: 600; font-size: 14px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .rl-res-row2 { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--text-normal); min-width: 0; }
    .rl-res-yr { color: var(--text-muted); flex: none; }
    .rl-res-score { color: #d99a2b; font-weight: 700; flex: none; }
    .rl-res-o { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
    .rl-res-dot { color: var(--text-faint); flex: none; }
    .rl-res-source { font-size: 10px; color: var(--text-faint); flex: none; cursor: pointer; white-space: nowrap; font-weight: 500; user-select: none; padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; line-height: 1.5; }
    .rl-res-source:hover, .rl-res-source:focus-visible { color: var(--interactive-accent); outline: none; }
    .rl-fields { margin-top: 10px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    .rl-lbl { display: block; font-size: 11px; color: var(--text-muted); margin: 9px 0 4px; font-weight: 600; }
    /* 豆瓣评分评价人数小字（「8.5 分 · 123456人评价」） */
    .rl-rate-cnt { font-size: 11px; color: var(--text-faint); margin-top: 4px; }
    /* 补充信息区（默认展开）：顶部小标题分隔，字段 2 列紧凑排版，无折叠/无虚线边框 */
    .rl-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
    /* 当前进度手填（S/E 与列表/月历/追番表展示同源；数字输入 + 前缀符号） */
    .rl-watch-prog { display: flex; align-items: center; gap: 5px; }
    .rl-watch-prefix { font-size: 13px; font-weight: 800; color: var(--text-muted); }
    .rl-watch-num { width: 64px; }
    .rl-watch-hint { font-size: 10.5px; color: var(--text-faint); margin-left: 4px; }
    .rl-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 10px; }
    .rl-readbar { height: 5px; background: var(--background-modifier-border); border-radius: 3px; overflow: hidden; margin-top: 6px; }
    .rl-readbar-fill { height: 100%; background: var(--rl-badge-watched, #4d9b52); border-radius: 3px; transition: background-color .2s; }
    /* 进度条分阶段色阶：起步 / 进行中 / 接近完成 / 读完 */
    .rl-readbar-low .rl-readbar-fill { background: #e85a4f; }   /* <30% 警告红 */
    .rl-readbar-mid .rl-readbar-fill { background: #d99a2b; }   /* 30-69% 进行中 琥珀 */
    .rl-readbar-high .rl-readbar-fill { background: #5a9e7d; }  /* 70-99% 接近完成 绿 */
    .rl-readbar-done .rl-readbar-fill { background: #4d9b52; }  /* 100% 读完 深绿 */
    .rl-hint-warn { color: #c0493f; font-weight: 600; }
    /* 分区标题 */
    .rl-section {
        font-size: 12px; font-weight: 700; color: var(--text-normal);
        margin: 16px 0 10px; padding: 4px 0 5px;
        border-bottom: 1px solid var(--background-modifier-border); /* 仅一条线（章节标题下方），与上方"作品基础信息"下线对齐 */
    }
    .rl-section:first-child { margin-top: 4px; }
    /* 章节标题左移对齐"作品基础信息"首字（弹窗最左）：负 margin 抵消 cover 列宽(100px)+gap(12px) */
    .rl-section-left { margin-left: -112px; }
    /* 基础信息两列布局：左封面边栏 + 右字段区 */
    .rl-basic-grid { display: grid; grid-template-columns: 100px 1fr; gap: 12px; align-items: stretch; margin-bottom: 4px; }
    .rl-fields-col { min-width: 0; }
    /* 封面区：拖放上传 / 右键菜单更换（默认小尺寸，紧凑不占头部；虚线边框 = 拖拽视觉引导） */
    .rl-poster-col { position: relative; display: flex; flex-direction: column; }
    /* 章节标题绝对定位在 cover 列底部（不依赖 grid stretch/flex auto）——与"作品基础信息"同列对齐 cover 列最左 */
    .rl-section-cover-bottom { position: absolute; bottom: 0; left: 0; right: 0; margin-top: 0 !important; }
    .rl-poster-zone {
        width: 100px; height: 140px; border: 1.5px dashed var(--background-modifier-border-hover);
        border-radius: 6px; display: flex; align-items: center; justify-content: center;
        cursor: pointer; overflow: hidden; background: var(--background-secondary);
        transition: border-color .15s, background-color .15s;
    }
    .rl-poster-zone:hover { border-color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .rl-poster-zone.on { border-style: solid; }
    .rl-poster-ph { font-size: 10.5px; color: var(--text-faint); text-align: center; padding: 8px; line-height: 1.5; }
    .rl-poster-preview { width: 100%; height: 100%; object-fit: cover; display: block; }
    .rl-poster-hint { font-size: 10px; color: var(--text-faint); text-align: center; margin-top: 6px; line-height: 1.5; }
    /* 日期输入框：日历图标固定右侧作为点击触发器（WebKit indicator 默认位置受主题影响） */
    input[type="date"] { position: relative; padding-right: 26px; }
    input[type="date"]::-webkit-calendar-picker-indicator {
        position: absolute; right: 6px; left: auto; margin: 0; cursor: pointer; opacity: .65;
    }
    input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 1; }
    /* 右键菜单（与 MediaList 卡片右键风格一致） */
    .rl-ctx {
        position: fixed; z-index: 1000; min-width: 140px;
        background: var(--background-primary); border: 1px solid var(--background-modifier-border);
        border-radius: 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, .18); padding: 4px;
        display: flex; flex-direction: column;
    }
    .rl-ctx button {
        font-family: inherit; font-size: 12px; text-align: left;
        background: transparent; border: none; color: var(--text-normal);
        padding: 5px 10px; border-radius: 5px; cursor: pointer;
    }
    .rl-ctx button:hover { background: var(--background-modifier-hover); }
    .rl-ctx-danger { color: #e03131; }
    .rl-ctx-danger:hover { background: rgba(192, 73, 63, .14); }
    .rl-ctx-url { display: flex; flex-direction: column; gap: 4px; padding: 4px; }
    .rl-ctx-url .rl-input { font-size: 11px; padding: 3px 6px; }
    .rl-ctx-url .rl-btn { font-size: 11px; padding: 3px 8px; }
    .rl-hidden { display: none; }
    /* 大尺寸状态胶囊 */
    .rl-status-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    /* 状态按钮组（左）+ 日期（右，并排） */
    .rl-status-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .rl-status-date { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .rl-status-date input[type="date"] { width: auto; min-width: 150px; }
    .rl-lbl-inline { font-size: 11px; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
    /* 标题行 + 来源徽标（书名/标题右侧并排，点击跳数据源页） */
    .rl-title-row { display: flex; gap: 6px; align-items: center; }
    .rl-title-row .rl-input { flex: 1; min-width: 0; }
    /* 进度页数：两个 input 中间 - 分隔（紧凑） */
    .rl-prog-range { display: flex; align-items: center; gap: 6px; }
    .rl-prog-input { flex: 1; min-width: 0; text-align: center; }
    .rl-prog-dash { font-size: 14px; color: var(--text-faint); font-weight: 600; flex: none; }
    /* 进度页数右侧「重新解析」小按钮：手动触发本地文件探针（测试获取），朴素功能样式 */
    .rl-prog-refresh {
        width: 22px; height: 22px; padding: 0; flex: none;
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid var(--background-modifier-border); background: transparent;
        color: var(--text-muted); border-radius: 4px; cursor: pointer;
    }
    .rl-prog-refresh:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    /* 大众评分与标题并排（只读，搜索/详情回填后显示） */
    .rl-title-score { font-size: 12px; font-weight: 600; color: #d99a2b; white-space: nowrap; flex: none; }
    .rl-src-link {
        flex: none; font-size: 11px; color: var(--text-faint); background: transparent;
        border: 1px solid var(--background-modifier-border); border-radius: 5px;
        padding: 3px 8px; cursor: pointer; white-space: nowrap; font-family: inherit;
    }
    .rl-src-link:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-status-lg .rl-chip { font-size: 13px; padding: 7px 18px; }
    .rl-chip { font-family: inherit; font-size: 12px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); border-radius: 999px; padding: 3px 12px; cursor: pointer; }
    .rl-chip.on { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    /* 类型/题材标签 chips（原格式：灰底胶囊，无 # 前缀） */
    .rl-tagbox { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 5px 7px; background: var(--background-primary); }
    .rl-tagbox:focus-within { border-color: var(--interactive-accent); }
    .rl-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; background: var(--background-modifier-hover); border-radius: 999px; padding: 2px 8px; color: var(--text-normal); }
    .rl-tag-x { border: none; background: transparent; color: var(--text-faint); cursor: pointer; font-size: 10px; padding: 0 2px; line-height: 1; }
    .rl-tag-x:hover { color: #c0493f; }
    .rl-tag-input { flex: 1; min-width: 90px; border: none; background: transparent; color: var(--text-normal); font-size: 12px; font-family: inherit; padding: 2px 4px; }
    .rl-tag-input:focus { outline: none; }
    .rl-tag-input::placeholder { color: var(--text-faint); }
    .rl-stars-input { font-size: 20px; color: #d9cba0; cursor: pointer; letter-spacing: 2px; }
    .rl-stars-input span.on { color: #d99a2b; }
    .rl-stars-val { font-size: 11px; color: var(--text-muted); margin-left: 8px; }
    .rl-link-row { display: flex; gap: 6px; margin-top: 5px; }
    .rl-link-label { width: 110px; flex: none; }
    /* 观看链接行操作按钮（浏览/播放/打开/复制/清除）：小图标紧凑样式，hover 高亮 */
    .rl-link-act { padding: 2px 8px; flex: none; font-size: 12px; line-height: 1.4; }
    .rl-link-act:hover:not(:disabled) { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-link-act:disabled { opacity: .4; cursor: not-allowed; }
    /* 观看链接区块：1..N 集按钮网格，左键播放/打开、右键编辑；本地绿点 / 网络蓝点双角标 */
    .rl-ep-grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    /* 「观看链接」标题行：label + 批量检索小图标（动画/电视剧）并排；行内覆盖 label 底边距防图标下沉 */
    .rl-lbl-row { display: flex; align-items: center; gap: 2px; }
    .rl-lbl-row .rl-lbl { margin-bottom: 0; }
    .rl-ep-batch-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 20px; height: 18px; padding: 0;
        border: none; background: transparent; color: var(--text-muted);
        border-radius: 4px; cursor: pointer;
        transition: color .12s ease, background .12s ease;
    }
    .rl-ep-batch-btn:hover { color: var(--interactive-accent); background: var(--background-modifier-hover); }
    /* 关联按钮单行（书籍文件/游戏启动/本地音频）：小按钮 + 右键编辑浮层 */
    .rl-ep-row { display: flex; gap: 6px; align-items: center; }
    .rl-ep-wrap { position: relative; }
    .rl-ep-btn {
        position: relative; width: 36px; height: 30px; font-family: inherit; font-size: 12px;
        border: 1px solid var(--background-modifier-border); background: var(--background-primary);
        color: var(--text-muted); border-radius: 6px; cursor: pointer;
        transition: background .12s ease, color .12s ease;
    }
    /* 电影单集「▶ 观看」按钮：与书籍「▶ 阅读」同款 auto 宽（图标+文字），沿用 rl-ep-btn-book */
    .rl-ep-btn-book {
        width: auto; min-width: 56px; padding: 0 12px;
        display: inline-flex; align-items: center; gap: 4px;
        justify-content: center;
    }
    .rl-ep-wrap.linked .rl-ep-btn { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }
    /* 第 N 集编辑弹窗（EntryForm 自绘浮层，fixed 遮罩 + 居中卡片） */
    .rl-ep-edit-mask { position: fixed; inset: 0; z-index: 999; background: rgba(0, 0, 0, .35); }
    .rl-ep-edit {
        position: fixed; z-index: 1000; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: min(420px, 90vw); background: var(--background-primary);
        border: 1px solid var(--background-modifier-border); border-radius: 10px;
        padding: 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, .22);
    }
    .rl-ep-edit-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
    .rl-ep-edit-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .rl-ep-edit-input { flex: 1; min-width: 0; }
    .rl-ep-edit-input + .rl-ep-edit-input { margin-top: 6px; }
    .rl-ep-edit-ops { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .rl-notes { resize: vertical; }
    /* 简介类 textarea auto-grow：高度由内容驱动（scrollHeight 计算），隐藏滚动条防高度抖动；min-height 为空/少文字基线（约 2 行） */
    .rl-summary { overflow: hidden; min-height: 2.4em; }
    .rl-fft {
        display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; align-items: center;
        flex: none; /* 固定在弹窗底部（rl-form flex 布局），内容滚动时完整遮住背后信息 */
        position: sticky; bottom: 0; z-index: 10;
        background: var(--background-primary);
        padding: 8px 0 2px;
    }
    .rl-fft-right { display: flex; gap: 8px; align-items: center; }
</style>
