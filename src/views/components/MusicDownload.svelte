<script lang="ts">
    /**
     * 「下载歌曲」弹窗内容体 —— **四平台版**（#399-D 移植批；形态照 `obsidian-lyricflux/src/DownloadModal.ts`）。
     *
     * 三段视图：**推荐歌单**（首屏，按当前平台）/ **搜索结果** / **歌单歌曲**（带返回）。
     * 🔴 九条硬口径：
     *  ⑴ **四平台全可点**（网易云 / QQ / 酷狗 / 酷我）—— 正本就是这样；⛔ 别退回「只网易云可点」（那是 #398 的临时口径）。
     *  ⑵ **实时搜索**：输入即防抖触发（`SEARCH_DEBOUNCE_MS = 300`），回车立即搜；⛔ 不设「搜索」按钮。
     *  ⑶ **VIP / 付费的曲目照样列出**（逐首在**歌曲底部**标一枚 `VIP` 胶囊），⛔ 不静默过滤 —— 过滤会让用户以为「搜不到这首歌」。
     *  ⑷ **弹窗内没有「关闭」按钮**（退出走 Modal ✕ / Esc / 点外部），且**不内嵌任何音频标签**（用户 2026-09-28 明确不做）。
     *  ⑸ **下载成功 = 自动关联条目**（#402）：`onPicked(relPath)` 回传库内相对路径，条目侧据此写「本地音频」。
     *  ⑹ **每行右侧恒为「来源标签 → 试听 → 下载」三件**（#402 用户：「统一对齐试听与下载按钮」）——
     *    ⛔ 别再让 VIP 行用一枚标签顶掉下载按钮（那正是有 VIP 的行与普通行左右对不齐的原因）。
     *  ⑺ **歌单卡片可直达歌单网页**（#402）；酷狗歌单页反爬 ⇒ 拿不到链接时该位置退回纯文本标签。
     *  ⑻ 🔴 **歌单卡片的平台名本身就是跳转入口**（#403 用户：「歌单页面不要额外加『直达』按钮，改为直接点击
     *    『网易云』文字作为按钮进行跳转」）—— #402 那枚独立 ↗ 图标按钮**已撤除**，⛔ 别再加回来。
     *  ⑼ 🔴 **平台胶囊只在歌单语境显示**（#403 用户：「第一次进入音频下载界面不要出现四个平台的选择，
     *    只有点击『推荐歌单』时才显示该选择」）⇒ 搜索视图下整块不渲染（搜索仍始终四平台并行）。
     *  ⑽ 🔴 **B站是「另一条通道」，不是第 5 个平台**（#496）：顶部一枚「B站」按钮把视图切到 `bili`
     *    （复用同一个搜索框的关键词），列表是**视频**（标题 / UP主 / 时长 / 播放数），
     *    下载交给宿主侧 yt-dlp 抓音频转 mp3。⛔ 别把它塞进 `DL_PLATFORMS`（那是音乐平台清单：
     *    胶囊 / 设置页 / 推荐歌单都按它遍历，B站没有歌单也没有试听）。
     */
    import { onDestroy, onMount } from 'svelte';
    /**
     * 🔴 图标必须用**本仓自己的** `./Icon.svelte`（`setIcon` 渲染、随主题变色）。
     *    ⛔ 绝不能写 `import { Icon } from 'obsidian'` —— 那条 API **并不导出 `Icon`**
     *    （`obsidian.d.ts` 里只有 `setIcon` / `getIcon` / `addIcon`），编译出来是
     *    `new import_obsidianN.Icon({…})` ⇒ 运行时 `TypeError: Icon is not a constructor`
     *    ⇒ **整个弹窗渲染中断、只剩一片空白**（#399-B 用户实测现象，已用 jsdom 复现钉住）。
     */
    import Icon from './Icon.svelte';
    import { neteaseCoverUrl } from 'pure/musicDownload';
    /** `buildPlaylistWebUrl` = 平台歌单网页地址（#402 歌单卡片「直达歌单网页」用它；酷狗返回空串） */
    import { buildPlaylistWebUrl, formatDuration } from 'pure/dl/utils';
    /** B站（#496）：条目形状与播放数压缩都在纯模块里（⛔ 别在这里再写一份「万」的换算） */
    import { formatBiliPlay, type BiliVideo } from 'pure/dl/bilibili';
    import {
        DL_PLATFORMS,
        type DlPreviewResult,
        type DownloadProgressCallback,
        type DownloadSong,
        type PlaylistSource,
        type RecommendedPlaylist,
    } from 'services/dl';

    export let title = '';
    export let author = '';
    /** 搜索（四平台并行；`onPartial` 渐进上报，`onEmpty` 区分「网断了」与「没这首歌」） */
    export let search: (
        keyword: string,
        onPartial?: (songs: DownloadSong[]) => void,
        onEmpty?: (networkError: boolean) => void,
    ) => Promise<{ songs: DownloadSong[]; failedSources: PlaylistSource[] }>;
    /** 推荐歌单（按平台） */
    export let loadPlaylists: (
        source: PlaylistSource,
        limit?: number,
    ) => Promise<{ playlists: RecommendedPlaylist[]; error?: string }>;
    /** 歌单曲目（按平台） */
    export let loadPlaylist: (
        source: PlaylistSource,
        id: string,
    ) => Promise<{ songs: DownloadSong[]; error?: string }>;
    /** 单曲下载（按来源自动选链路；`onProgress` 上报阶段） */
    export let download: (
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ) => Promise<{ ok: boolean; message: string; relPath?: string }>;
    /**
     * 试听（2026-09-28 #400）：取**标准档**字节（不写盘），本组件转 Blob 播放。
     * 🔴 缓存由服务层做（**仅本会话有效**，重启即清）—— 用户明确「不做设置页试听缓存删除」
     *    ⇒ ⛔ 这里不加任何「清缓存」入口，也没有对应的设置项。
     */
    export let preview: (
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ) => Promise<DlPreviewResult>;
    /**
     * B站搜索（#496）：`error`（风控 / 网络）与「空列表」（真没搜到）**是两回事** ⇒ 分别呈现。
     * ⚠️ 它是**独立的一路**，不参与上面那个四平台并行搜索。
     */
    export let biliSearch: (keyword: string) => Promise<{ videos: BiliVideo[]; error?: string }>;
    /**
     * B站下载（#496）：宿主起 yt-dlp 抓音频转 mp3 再落库（与四平台共用命名 / 去重口径）。
     * ⚠️ 这里**不给试听按钮** —— yt-dlp 是「下完整段」的，没有便宜的先听一步（⛔ 别为了对称硬加）。
     */
    export let biliDownload: (
        video: BiliVideo,
        onProgress?: DownloadProgressCallback,
    ) => Promise<{ ok: boolean; message: string; relPath?: string }>;
    /**
     * 下载成功回传库内相对路径 —— 条目侧把「本地音频」指过去（**自动关联**，#402）；
     * 条目是否随后立刻落库由宿主决定（编辑态直接写回，新增态等「保存」统一提交）。
     */
    export let onPicked: (relPath: string) => void;
    // ⚠️ 2026-09-28 起**没有 `onClose` prop 了**（#399-C）：弹窗内不再有「关闭」按钮
    //    （用户：「去掉下方的关闭按钮（没什么用）」）⇒ 退出走 `Modal` 自带的 ✕ / Esc / 点外部。
    //    ⛔ 别为了「留一手」把它加回来 —— Svelte 会为**未被使用的 export** 报告警（构建告警数会 +1）。

    type View = 'playlists' | 'search' | 'playlist' | 'bili';

    /**
     * 平台显示名（正本 `sourcePlatforms` 同款四平台）。
     * 🔴 #402：用户要求界面内平台名一律改**简称**（去掉「音乐」两字）⇒ 本弹窗内一律用简称
     *    （胶囊 / 来源标签 / 各条 tooltip 全走这一份表）。全称仍留在设置页与歌词源的显示名里（不在本次口径内）；
     *    ⚠️ 连带约束：这个组件里**一个字都不许再写全称**（含注释）—— 产物断言按「源码里无全称」钉住。
     */
    const PLATFORM_LABELS: Record<PlaylistSource, string> = {
        netease: '网易云',
        qq: 'QQ',
        kugou: '酷狗',
        kuwo: '酷我',
    };

    let view: View = 'playlists';
    let source: PlaylistSource = 'netease';
    let query = '';
    let playlists: RecommendedPlaylist[] = [];
    let detail: { name: string; songs: DownloadSong[] } | null = null;
    let songs: DownloadSong[] = [];
    /** B站结果（#496）—— 与 `songs` **分开存**：两者都可能是「当前列表」，混一个数组会让切回去时串味 */
    let biliVideos: BiliVideo[] = [];
    let err = '';
    let busy = false;
    let downloadingId = '';
    let tip = '';
    /** 下载阶段文本（正本进度条的等价物） */
    let stage = '';
    /**
     * 阶段百分比（#496）：**只有 B站那条链路给得出**（yt-dlp 的 `[download] xx%` 行）。
     * `null` = 不知道进度 ⇒ 进度条走不确定态动画（四平台链路恒为 null，⛔ 别给它们编一个百分比）。
     */
    let stagePct: number | null = null;

    onMount(() => {
        /**
         * 🔴 **打开即搜**（2026-09-28 用户：「我在音乐条目编辑条目界面时点那个下载歌曲的按钮怎么不直接搜索
         * 该歌曲返回结果还要我自己搜」）：条目已经有标题 / 作者 ⇒ 直接用「标题 作者」当检索词**立刻搜一次**。
         * ⇒ 这**推翻**了 #399-D 那条「⛔ 不预填搜索框（预填会让人以为已经搜过了）」——现在预填**且真的搜了**，
         *    所以不存在「看起来搜过其实没有」的误会。
         * 标题作者都为空（理论上进不来）⇒ 退回推荐歌单首屏。
         */
        const q = [title.trim(), author.trim()].filter(Boolean).join(' ');
        if (q) {
            query = q;
            void runSearch();
            return;
        }
        void refreshPlaylists();
    });

    async function refreshPlaylists(): Promise<void> {
        if (busy) return;
        busy = true;
        err = '';
        tip = '';
        try {
            const out = await loadPlaylists(source, 30);
            playlists = out.playlists;
            err = out.error ? `推荐歌单加载失败（${out.error}）` : '';
            view = 'playlists';
        } finally {
            busy = false;
        }
    }

    /** 切换平台胶囊：重新拉该平台的推荐歌单（正本同款行为） */
    function switchSource(next: PlaylistSource): void {
        if (busy || next === source) return;
        source = next;
        detail = null;
        songs = [];
        void refreshPlaylists();
    }

    const SEARCH_DEBOUNCE_MS = 300;
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 实时搜索：停止输入 `SEARCH_DEBOUNCE_MS` 后自动搜（用户 2026-09-28：「搜索框旁去掉搜索按钮，
     * 改成敲一个字就实时搜索」）；回车强制立即搜。⚠️ 清空输入**不触发**搜索（保持当前视图）。
     */
    function scheduleSearch(): void {
        if (searchTimer !== null) clearTimeout(searchTimer);
        if (!query.trim()) {
            searchTimer = null;
            return;
        }
        searchTimer = setTimeout(() => {
            searchTimer = null;
            void runSearch();
        }, SEARCH_DEBOUNCE_MS);
    }
    function searchNow(): void {
        if (searchTimer !== null) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        void runSearch();
    }
    function inputVal(ev: Event): string {
        return (ev.target as HTMLInputElement).value;
    }

    async function runSearch(): Promise<void> {
        const q = query.trim();
        if (!q || busy) return;
        busy = true;
        err = '';
        tip = '';
        // 渐进渲染：任一平台先回来就先画（正本同款「不等最慢平台」）
        songs = [];
        view = 'search';
        try {
            const out = await search(
                q,
                (partial) => {
                    if (view === 'search') songs = [...songs, ...partial];
                },
                (networkError) => {
                    err = networkError ? '所有平台都没连上（网络或接口变更），换个时间再试' : '';
                },
            );
            songs = out.songs;
            // 🔴 #405：**单源失败不再报给用户**（用户点名：搜索时不要弹那句「某平台没连上」的提示）——
            //    其它源的结果照常给出，那条提示只是噪音。
            //    ⚠️ 「**全部**平台都没连上」那条仍然保留（见上面 `onEmpty`）：它说明「不是没这首歌，
            //    是网 / 接口的问题」，与「搜到了但某源没回」是两回事，删了会让用户误判成「搜不到」。
        } catch (e) {
            err = `搜索出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            busy = false;
        }
    }

    async function openPlaylist(p: RecommendedPlaylist): Promise<void> {
        if (busy) return;
        busy = true;
        err = '';
        tip = '';
        try {
            const out = await loadPlaylist(p.source, p.id);
            detail = out.error ? null : { name: p.name, songs: out.songs };
            err = out.error ? `歌单加载失败（${out.error}）` : '';
            view = 'playlist';
        } finally {
            busy = false;
        }
    }

    /**
     * 下载（#402 起 VIP 曲目**也给按钮**，只压暗不拦）：
     * 🔴 用户 2026-09-28：「当无法下载时需给出相应提醒」⇒ 失败文案按 VIP 语境前缀一句，
     *    免得只看到服务层那句含糊的「可能 VIP 受限」。
     * ⛔ 但**不预先拦截** VIP 曲目：网易云 / QQ 的 VIP 链路配了会员 Cookie 后有机会成功
     *    （#399-D 用户裁定「含 VIP/Cookie 全移植」）—— 提前 return 会让那条链路变成死代码。
     */
    async function pick(song: DownloadSong): Promise<void> {
        if (downloadingId) return;
        downloadingId = song.id;
        err = '';
        tip = '';
        stage = '';
        stagePct = null;
        try {
            const r = await download(song, (pct, label) => {
                stage = label;
                stagePct = pct;
            });
            if (r.ok) {
                tip = r.message;
                if (r.relPath) onPicked(r.relPath);
            } else {
                err = song.vip ? `该曲目标为 VIP / 付费：${r.message}` : r.message;
            }
        } finally {
            downloadingId = '';
            stage = '';
            stagePct = null;
        }
    }

    /**
     * B站搜索（#496）：用**当前搜索框里**的关键词去搜 —— 搜索框就是这一整个弹窗的唯一入口
     * （⛔ 别另给一个只服务于 B站 的输入框：两个框并存时用户永远不知道该改哪个）。
     * 🔴 空关键词 ⇒ 只提示、不发请求（宿主侧也会再挡一次）。
     */
    async function runBiliSearch(): Promise<void> {
        const q = query.trim();
        if (busy) return;
        if (!q) {
            err = '先在搜索框里输入关键词，再点「B站」';
            tip = '';
            return;
        }
        busy = true;
        err = '';
        tip = '';
        biliVideos = [];
        view = 'bili';
        try {
            const out = await biliSearch(q);
            biliVideos = out.videos;
            err = out.error ?? '';
        } catch (e) {
            err = `B站搜索出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            busy = false;
        }
    }

    /**
     * B站下载（#496）。🔴 `downloadingId` 存 **`bili:<bvid>`** —— 与音乐行的 `song.id`（纯平台 id）
     * 天然不撞车，于是 `class:is-busy` / 「同时只跑一个下载」这套既有约束**原样复用**，
     * ⛔ 不必为 B站 另开一个状态变量（那样反而会出现「两边同时在下」）。
     */
    async function pickBili(v: BiliVideo): Promise<void> {
        if (downloadingId) return;
        downloadingId = `bili:${v.bvid}`;
        err = '';
        tip = '';
        stage = '';
        stagePct = null;
        try {
            const r = await biliDownload(v, (pct, label) => {
                stage = label;
                stagePct = pct;
            });
            if (r.ok) {
                tip = r.message;
                if (r.relPath) onPicked(r.relPath);
            } else {
                err = r.message;
            }
        } finally {
            downloadingId = '';
            stage = '';
            stagePct = null;
        }
    }

    /** 正在拉取的试听键（`source:id`，按钮显示转圈并禁用；⛔ 与 `downloadingId` 分开，两件事可并行） */
    let previewingKey = '';
    /** 试听选中的曲目键（空 = 没在播）；再点一次 = 暂停 / 继续（#402 起不再是「停止」） */
    let playingKey = '';
    /** 是否**暂停**中（#402 新增态：播放中 → 暂停 → 继续，三态循环） */
    let paused = false;
    let audioEl: HTMLAudioElement | null = null;
    /** 播放用的 object URL（⛔ 必须 revoke，否则每听一首就漏一份内存） */
    let audioUrl = '';

    /** 音频 MIME（按服务层判定的真实扩展名给；`Blob` 无类型时部分平台解不了） */
    function audioMime(ext: string | undefined): string {
        if (ext === 'm4a') return 'audio/mp4';
        if (ext === 'flac') return 'audio/flac';
        return 'audio/mpeg';
    }

    /** 停掉试听并释放 object URL（换歌 / 关闭弹窗走这里；**暂停不走这里** ⇒ 暂停态要保住字节与播放位置） */
    function stopPreview(): void {
        if (audioEl) {
            audioEl.onended = null;
            audioEl.pause();
            audioEl = null;
        }
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = '';
        }
        playingKey = '';
        paused = false;
    }

    /** 试听按钮 tooltip（#402 四态各说各的，别让用户猜这一下会发生什么） */
    function previewTip(song: DownloadSong): string {
        const key = `${song.source}:${song.id}`;
        if (previewingKey === key) return '正在获取试听音频…';
        if (playingKey === key) return paused ? '继续试听' : '暂停试听';
        return '试听（拉标准档，不写入库）';
    }

    /** 下载按钮 tooltip（#402）：VIP / 需 Cookie / 常规三种语境说清「点了会发生什么」。
     *  🔴 #404：VIP 那句去掉**预测性 / 主观判断**的措辞（用户原话见 UI-GUIDE §16.14 —— 本注释刻意
     *     不复述那几个词：反向守卫按字面钉住源码，注释里写出来等于自己把它撞红）。
     *      现在只说事实（标为 VIP / 付费）与行为（点一下会尝试下载），能不能下由结果说话。 */
    function downloadTip(song: DownloadSong): string {
        if (song.vip) return '该曲目标为 VIP / 付费，点一下会尝试下载';
        if (song.needsCookie) return '该平台需要登录 Cookie（在设置里粘贴后可用）';
        return '下载到库内下载目录';
    }

    /**
     * 试听四态（#402 用户：「为试听按钮增加试听态和暂停态」）：
     *  **空闲 [▶] → 拉取中 [⟳ 转圈·禁用] → 播放中 [⏸ 蓝底] → 暂停中 [▶ 蓝底]**。
     * 🔴 播放中点第二下改成**暂停**（原先直接 `stopPreview`，用户明确要暂停态）；
     *    换另一首 / 关弹窗才真正停止并释放 object URL。
     * 🔴 **不写盘、不进「本地音频」** —— 试听是「先听听对不对」，落盘仍由「下载」按钮负责。
     */
    async function togglePreview(song: DownloadSong): Promise<void> {
        const key = `${song.source}:${song.id}`;
        if (playingKey === key && audioEl) {
            if (paused) {
                paused = false;
                await audioEl.play();
            } else {
                audioEl.pause();
                paused = true;
            }
            return;
        }
        if (previewingKey) return;
        stopPreview();
        previewingKey = key;
        err = '';
        tip = '';
        stage = '';
        stagePct = null;
        try {
            const r = await preview(song, (pct, label) => {
                stage = label;
                stagePct = pct;
            });
            if (!r.ok || !r.data) {
                err = r.message;
                return;
            }
            const blob = new Blob([r.data], { type: audioMime(r.ext) });
            audioUrl = URL.createObjectURL(blob);
            const el = new Audio(audioUrl);
            audioEl = el;
            el.onended = () => stopPreview();
            playingKey = key;
            paused = false;
            stage = `正在试听 ${song.name}（不写入库，试听后仍要点「下载」才会保存）`;
            await el.play();
        } catch (e) {
            stopPreview();
            err = `试听失败：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            previewingKey = '';
        }
    }

    // 弹窗关闭 / 组件销毁时停播并释放 object URL（⛔ 漏掉就是「关掉弹窗还在响」）
    onDestroy(stopPreview);

    /**
     * 元数据胶囊（2026-09-28 #401：照 `obsidian-lyricflux` 的行内胶囊搬）。
     * 顺序与正本一致：**格式 → 时长 → 大小 → 码率**（各平台没给的就跳过，⛔ 不补假值）。
     * 🔴 #405：**格式胶囊恒显示**（用户：「标记格式为 mp3 还是 m4a」）—— 原先只在非 mp3 时才标，
     *    结果 mp3 反而没有任何标记，用户看不出这首歌是什么格式。`ext` 拿不到（如 QQ 的
     *    搜索响应没给格式线索）⇒ 仍**不显示**（⛔ 不猜成 mp3）。
     * 🔴 #402：`VIP` 胶囊接在最末 —— 用户「改为在歌曲底部以『VIP』标签形式展示」，
     *    排在元数据之后 = 歌曲信息块的**底行末尾**（⛔ 不再占用行末那个位置，那里换成下载按钮）。
     */
    function songPills(s: DownloadSong): Array<{ text: string; ext?: boolean; vip?: boolean }> {
        const out: Array<{ text: string; ext?: boolean; vip?: boolean }> = [];
        // 蓝底只留给「比 mp3 值钱」的档位（FLAC / M4A）；mp3 也显示，但走灰底（与其它元数据胶囊同款）
        if (s.ext) out.push({ text: s.ext.toUpperCase(), ext: s.ext !== 'mp3' });
        if (s.duration) out.push({ text: formatDuration(s.duration) });
        if (s.size) out.push({ text: `${(s.size / (1024 * 1024)).toFixed(2)}MB` });
        if (s.bitrate) out.push({ text: `${s.bitrate}kbps` });
        if (s.vip) out.push({ text: 'VIP', vip: true });
        return out;
    }

    /** 副行：歌手 · 专辑（正本口径：歌手恒显示，专辑有才缀；⛔ 时长/大小别塞回来 —— 那是胶囊的事） */
    function songArtist(s: DownloadSong): string {
        const a = s.artist || '未知歌手';
        return s.album ? `${a} · ${s.album}` : a;
    }
    /**
     * B站结果胶囊（#496）：**时长 → 播放数 → 分区**，缺项跳过（⛔ 不补假值）。
     * ⚠️ 播放数的「万」换算在 `pure/dl/bilibili.formatBiliPlay`（唯一真源），这里只负责加单位后缀。
     */
    function biliPills(v: BiliVideo): string[] {
        const out: string[] = [];
        if (v.durationSec) out.push(formatDuration(v.durationSec));
        const play = formatBiliPlay(v.play);
        if (play) out.push(`${play}播放`);
        if (v.category) out.push(v.category);
        return out;
    }
    /** 封面地址：网易云要加 `?param=` 缩略（其余平台给的就是直链） */
    function cover(s: { source: PlaylistSource; coverUrl?: string }): string {
        if (!s.coverUrl) return '';
        return s.source === 'netease' ? neteaseCoverUrl(s.coverUrl) : s.coverUrl;
    }
    /** 歌单网页地址（#402）：酷狗反爬拿不到 ⇒ 返回空串，调用处据此**不渲染**跳转按钮 */
    function playlistWebUrl(p: RecommendedPlaylist): string {
        return buildPlaylistWebUrl(p.source, p.id);
    }
    /** 可下载数（VIP 之外的都算可下；需 Cookie 的平台由下载时给明确提示） */
    function downloadable(list: DownloadSong[]): number {
        return list.filter((s) => !s.vip).length;
    }

    $: searchMeta =
        view !== 'search'
            ? ''
            : songs.length === 0
              ? busy
                  ? '正在搜索…'
                  : '没有找到匹配的曲目，换个关键词试试'
              : `共 ${songs.length} 条${songs.some((s) => s.vip) ? ` · ${songs.filter((s) => s.vip).length} 条标 VIP` : ''}`;

    /** B站头部右侧文案（#496）：空列表分「正在搜」与「真没搜到」，⛔ 别合成一句 */
    $: biliMeta =
        view !== 'bili'
            ? ''
            : biliVideos.length === 0
              ? busy
                  ? '正在搜索…'
                  : '没有找到匹配的视频，换个关键词试试'
              : `共 ${biliVideos.length} 条`;
</script>

<div class="rl-dl">
    <!-- 当前曲目提示（用上宿主传进来的 `title` / `author`，也给用户一个「我在找哪首」的锚点；
         ⛔ 不预填搜索框 —— 预填会让人以为「已经搜过了」） -->
    <!-- ⛔ 2026-09-28 #401 起**没有那行「当前曲目」提示**了：打开弹窗直接用「标题 作者」搜一次，
         检索词就在上面输入框里看得见（原先那行提示是为了「不预填」时还能告诉用户「我在找哪首」）。 -->
    <div class="rl-dl-search">
        <!-- 实时搜索（用户 2026-09-28：「去掉搜索按钮，改成敲一个字就实时搜索」）：
             输入即防抖触发，回车立即搜。⛔ 别再把「搜索」按钮加回来。
             ⛔ 也**别加「百科」按钮** —— 2026-09-28 用户明确「不要百科按钮」（正本 `DownloadModal` 有，
                那条链路要整块搬 BaikeSearchModal + 聚合搜索，本批不做）。 -->
        <input
            class="rl-input"
            type="text"
            value={query}
            placeholder="输入歌名 / 歌手，如：作品名 作者名"
            on:input={(ev) => {
                query = inputVal(ev);
                scheduleSearch();
            }}
            on:keydown={(ev) => {
                if (ev.key === 'Enter') searchNow();
            }} />
        <button class="rl-btn" disabled={busy} on:click={() => void refreshPlaylists()} data-tip="回到推荐歌单首屏">推荐歌单</button>
        <!-- B站（#496）：**另一条通道**，与「推荐歌单」并列 —— 点它用当前关键词搜 B站视频（`view = 'bili'`）。
             ⛔ 别把它做成平台胶囊（那里是「拉哪个平台的歌单」，B站没有歌单）。 -->
        <button class="rl-btn" disabled={busy} on:click={() => void runBiliSearch()} data-tip="用当前关键词搜索 B站视频">B站</button>
    </div>

    <!-- 进度条（#401 照正本搬）：四平台传输层**没有流式回调** ⇒ 只做「不确定态」动画 + 阶段文字；
         B站（#496）那条链路给得出真百分比（yt-dlp 的 `[download] xx%`）⇒ 有值就画成确定态，
         ⛔ 别为了「好看」给四平台编一个不动的百分比。 -->
    {#if stage}
        <div class="rl-dl-progress">
            <div class="rl-dl-progress-track"><div class="rl-dl-progress-fill" class:is-indeterminate={stagePct === null} style={stagePct === null ? '' : `width:${stagePct}%`}></div></div>
            <div class="rl-dl-progress-text">{stage}</div>
        </div>
    {/if}

    <!-- 🔴 平台胶囊**只在歌单语境出现**（2026-09-28 #403 用户：「第一次进入音频下载界面不要出现四个平台的选择，
         只有点击『推荐歌单』时才显示该选择」）。
         ⇒ 判据 = `view === 'playlists' || view === 'playlist'`：
           打开即搜（有标题作者）⇒ 搜索视图，不显示；
           #496 新增的 B站视图（`bili`）**也不显示** —— 那四个胶囊管的是「拉哪个平台的歌单」，
           B站既没有歌单、也不参与那套平台选择。
         ⚠️ 搜索本身**始终四平台并行**，⛔ 别把「不显示胶囊」误做成「只搜当前平台」。 -->
    {#if view === 'playlists' || view === 'playlist'}
        <div class="rl-dl-caps">
            {#each DL_PLATFORMS as p (p)}
                <button
                    class="rl-dl-cap"
                    class:is-on={p === source}
                    disabled={busy}
                    on:click={() => switchSource(p)}
                    data-tip={`只看 ${PLATFORM_LABELS[p]} 的结果`}>{PLATFORM_LABELS[p]}</button>
            {/each}
        </div>
    {/if}

    <div class="rl-dl-body">
        {#if view === 'playlists'}
            <div class="rl-dl-head">
                <span class="rl-dl-head-t">推荐歌单</span>
                <button class="rl-dl-refresh" disabled={busy} on:click={() => void refreshPlaylists()} data-tip="刷新推荐歌单">
                    <Icon icon="refresh-cw" size={13} />
                    <span class="rl-sr">刷新推荐歌单</span>
                </button>
            </div>
            {#if busy && playlists.length === 0}
                <div class="rl-hint">加载推荐歌单…</div>
            {:else if playlists.length === 0}
                <div class="rl-hint">暂无推荐歌单，可在上方直接搜索歌名</div>
            {:else}
                {#each playlists as p (p.source + ':' + p.id)}
                    <!-- 🔴 #402 结构改动：卡片外层从按钮换成 **div 容器**（类名仍叫 `rl-dl-card`）——
                         原因是卡片里要放一枚**外链 `<a>`**（「歌单支持直接跳转到歌单网页」），
                         而 HTML 不允许 `<a>` 嵌在 `<button>` 里（嵌了浏览器会把按钮拆开、点击全乱）。
                         卡片主体仍是**真的按钮元素**（类名 `rl-dl-card-open`）⇒ 点击语义 / 禁用态 / a11y 都不变。
                         ⚠️ 本注释刻意不写出那两行的**完整标签形态**（`<div class=…>` / `<button class=…>`）——
                            产物断言按这些字符串锚源码，注释里出现同款字符串会让断言被自己撞绿（本仓踩过两次）。 -->
                    <div class="rl-dl-card">
                        <button class="rl-dl-card-open" disabled={busy} on:click={() => void openPlaylist(p)} data-tip="查看歌单曲目">
                            {#if cover(p)}
                                <img class="rl-dl-cover" src={cover(p)} alt="" loading="lazy" />
                            {:else}
                                <span class="rl-dl-cover rl-dl-cover-ph"></span>
                            {/if}
                            <span class="rl-dl-card-main">
                                <span class="rl-dl-card-t">{p.name}</span>
                                <span class="rl-dl-card-m">
                                    {PLATFORM_LABELS[p.source]}{#if p.trackCount} · {p.trackCount} 首{/if}{#if p.playCount} · {p.playCount} 次播放{/if}
                                </span>
                            </span>
                        </button>
                        <!-- 平台名本身就是**直达歌单网页**的入口（2026-09-28 #403 用户：「歌单页面不要额外加『直达』按钮，
                             改为直接点击『网易云』文字作为按钮进行跳转」）⇒ #402 那枚独立的 ↗ 图标按钮已撤除。
                             🔴 它**必须留在内层按钮之外**：`<a>` 嵌在 `<button>` 里是非法 HTML（浏览器会把按钮拆开）。
                             ⚠️ 酷狗歌单页反爬 ⇒ `buildPlaylistWebUrl` 给空串，此时降级为纯文本标签（⛔ 不出空 href 的链）。
                             ⚠️ `external-link` 类名是**给 Obsidian 的**：它的全局点击处理只认这个类。 -->
                        {#if playlistWebUrl(p)}
                            <a
                                class="rl-dl-tag is-link external-link"
                                href={playlistWebUrl(p)}
                                target="_blank"
                                rel="noopener noreferrer"
                                data-tip={`打开${PLATFORM_LABELS[p.source]}歌单页`}>{PLATFORM_LABELS[p.source]}</a>
                        {:else}
                            <span class="rl-dl-tag">{PLATFORM_LABELS[p.source]}</span>
                        {/if}
                    </div>
                {/each}
            {/if}
        {:else if view === 'search'}
            <div class="rl-dl-head">
                <span class="rl-dl-head-t">搜索结果</span>
                <span class="rl-dl-head-m">{searchMeta}</span>
            </div>
            {#each songs as s (s.source + ':' + s.id)}
                <!-- 歌曲行 = **卡片**（2026-09-28 #401 照正本搬）：有底色 + 圆角，而不是一行行贴在弹窗底上。
                     🔴 #402：右侧三件固定为「来源标签 → 试听 → 下载」（VIP 行也给下载按钮，只压暗）⇒ 逐行对齐。
                     ⚠️ 与歌单视图那一行**必须同款**（同一行的两次渲染）；改一处务必同步另一处。 -->
                <div class="rl-dl-row" class:is-vip={s.vip} class:is-busy={downloadingId === s.id}>
                    {#if cover(s)}
                        <img class="rl-dl-cover" src={cover(s)} alt="" loading="lazy" />
                    {:else}
                        <span class="rl-dl-cover rl-dl-cover-ph"><Icon icon="music" size={16} /></span>
                    {/if}
                    <span class="rl-dl-row-main">
                        <span class="rl-dl-name">{s.name}</span>
                        <span class="rl-dl-artist">{songArtist(s)}</span>
                        {#if songPills(s).length}
                            <span class="rl-dl-pills">
                                {#each songPills(s) as p}
                                    <span class="rl-dl-pill" class:is-ext={p.ext} class:is-vip={p.vip}>{p.text}</span>
                                {/each}
                            </span>
                        {/if}
                    </span>
                    <!-- 来源标签 = **直达歌曲页面的入口**（#400 补回；正本 `buildSongWebUrl` 口径）：
                         有 `webUrl` ⇒ 可点外链（新标签打开，弹窗保持打开）；缺 ID 时降级为纯文本标签。
                         ⚠️ `external-link` 类名是**给 Obsidian 的**：它的全局点击处理只认这个类，
                            少了它点了没反应（渲染成普通 <a> 但被阻断）。 -->
                    {#if s.webUrl}
                        <a
                            class="rl-dl-tag is-link external-link"
                            href={s.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-tip={`打开歌曲页`}
                            on:click|stopPropagation>{PLATFORM_LABELS[s.source]}</a>
                    {:else}
                        <span class="rl-dl-tag">{PLATFORM_LABELS[s.source]}</span>
                    {/if}
                    <!-- 试听（#400 / #402 四态）：先听再决定要不要下；再点一次 = 暂停，再点 = 继续。
                         VIP 行也给 —— 那正是最需要先听的情况。 -->
                    <button
                        class="rl-dl-play"
                        class:is-on={playingKey === `${s.source}:${s.id}`}
                        class:is-busy={previewingKey === `${s.source}:${s.id}`}
                        disabled={previewingKey === `${s.source}:${s.id}`}
                        on:click={() => void togglePreview(s)}
                        data-tip={previewTip(s)}>
                        {#if previewingKey === `${s.source}:${s.id}`}
                            <span class="rl-spinner"></span>
                        {:else}
                            <Icon icon={playingKey === `${s.source}:${s.id}` && !paused ? 'pause' : 'play'} size={13} />
                        {/if}
                        <span class="rl-sr">试听</span>
                    </button>
                    <!-- 下载 = **图标按钮**（#401 照正本搬：图标 + tooltip，不再是「下载」两个字）。
                         🔴 #402：VIP 行**也渲染它**（只加 `is-off` 压暗）—— 原先用一枚标签顶掉按钮，
                            于是「有 VIP 的行」右端少一格、与普通行对不齐（用户：「统一对齐试听与下载按钮」）。
                         下载中给 `is-busy`（正本 `.lyrics-download-downloading` 同款：整行按钮禁用+压暗）。 -->
                    <button
                        class="rl-dl-go"
                        class:is-off={!!s.vip}
                        disabled={!!downloadingId}
                        on:click={() => void pick(s)}
                        data-tip={downloadTip(s)}>
                        <Icon icon="download" size={13} />
                        <span class="rl-sr">下载到库内</span>
                    </button>
                </div>
            {/each}
        {:else if view === 'bili'}
            <div class="rl-dl-head">
                <span class="rl-dl-head-t">B站视频</span>
                <span class="rl-dl-head-m">{biliMeta}</span>
            </div>
            {#each biliVideos as v (v.bvid)}
                <div class="rl-dl-row" class:is-busy={downloadingId === `bili:${v.bvid}`}>
                    <!-- 🔴 `referrerpolicy="no-referrer"` 是**必需的、不是装饰**：B站图床
                         （`i0.hdslb.com`）按 Referer 防盗链 —— 实测同一张图无 Referer `200`、
                         带 `Referer: app://obsidian.md` **`403`**（Obsidian 内 `<img>` 的 Referer 恒是它）。
                         少了这个属性 = 列表里全是灰底占位图，且**没有任何报错**。 -->
                    {#if v.coverUrl}
                        <img class="rl-dl-cover" src={v.coverUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
                    {:else}
                        <span class="rl-dl-cover rl-dl-cover-ph"><Icon icon="video" size={16} /></span>
                    {/if}
                    <span class="rl-dl-row-main">
                        <span class="rl-dl-name">{v.title}</span>
                        <span class="rl-dl-artist">{v.author || '未知 UP 主'}</span>
                        {#if biliPills(v).length}
                            <span class="rl-dl-pills">
                                {#each biliPills(v) as t}
                                    <span class="rl-dl-pill">{t}</span>
                                {/each}
                            </span>
                        {/if}
                    </span>
                    <!-- 来源标签 = 直达视频页（与歌曲行的「来源标签」同位同形，⛔ 这里恒可点：B站 一定有 bvid） -->
                    <a
                        class="rl-dl-tag is-link external-link"
                        href={v.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-tip="打开 B站视频页"
                        on:click|stopPropagation>B站</a>
                    <!-- 下载按钮：与歌曲行同款（图标 + tooltip），⛔ 这里**没有试听按钮**
                         —— yt-dlp 只能「整段下完再转码」，给个假试听反而更贵。 -->
                    <button
                        class="rl-dl-go"
                        disabled={!!downloadingId}
                        on:click={() => void pickBili(v)}
                        data-tip="下载为 mp3 到库内下载目录（用 yt-dlp）">
                        <Icon icon="download" size={13} />
                        <span class="rl-sr">下载到库内</span>
                    </button>
                </div>
            {/each}
        {:else}
            <div class="rl-dl-head">
                <button class="rl-dl-back" disabled={busy} on:click={() => void refreshPlaylists()} data-tip="返回推荐歌单">
                    <Icon icon="arrow-left" size={13} />
                    <span>返回</span>
                </button>
                <span class="rl-dl-head-t">{detail?.name ?? '歌单'}</span>
                <span class="rl-dl-head-m">
                    共 {detail?.songs.length ?? 0} 首 · {downloadable(detail?.songs ?? [])} 首可下载
                </span>
            </div>
            {#each detail?.songs ?? [] as s (s.source + ':' + s.id)}
                <div class="rl-dl-row" class:is-vip={s.vip} class:is-busy={downloadingId === s.id}>
                    {#if cover(s)}
                        <img class="rl-dl-cover" src={cover(s)} alt="" loading="lazy" />
                    {:else}
                        <span class="rl-dl-cover rl-dl-cover-ph"><Icon icon="music" size={16} /></span>
                    {/if}
                    <span class="rl-dl-row-main">
                        <span class="rl-dl-name">{s.name}</span>
                        <span class="rl-dl-artist">{songArtist(s)}</span>
                        {#if songPills(s).length}
                            <span class="rl-dl-pills">
                                {#each songPills(s) as p}
                                    <span class="rl-dl-pill" class:is-ext={p.ext} class:is-vip={p.vip}>{p.text}</span>
                                {/each}
                            </span>
                        {/if}
                    </span>
                    <!-- ⚠️ 与搜索结果那一行**必须同款**（这里是同一个「歌曲行」的另一次渲染）：
                         改其中一处务必同步另一处，否则歌单里能试听、搜索里不能（或反之）。 -->
                    {#if s.webUrl}
                        <a
                            class="rl-dl-tag is-link external-link"
                            href={s.webUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-tip={`打开歌曲页`}
                            on:click|stopPropagation>{PLATFORM_LABELS[s.source]}</a>
                    {/if}
                    <button
                        class="rl-dl-play"
                        class:is-on={playingKey === `${s.source}:${s.id}`}
                        class:is-busy={previewingKey === `${s.source}:${s.id}`}
                        disabled={previewingKey === `${s.source}:${s.id}`}
                        on:click={() => void togglePreview(s)}
                        data-tip={previewTip(s)}>
                        {#if previewingKey === `${s.source}:${s.id}`}
                            <span class="rl-spinner"></span>
                        {:else}
                            <Icon icon={playingKey === `${s.source}:${s.id}` && !paused ? 'pause' : 'play'} size={13} />
                        {/if}
                        <span class="rl-sr">试听</span>
                    </button>
                    <button
                        class="rl-dl-go"
                        class:is-off={!!s.vip}
                        disabled={!!downloadingId}
                        on:click={() => void pick(s)}
                        data-tip={downloadTip(s)}>
                        <Icon icon="download" size={13} />
                        <span class="rl-sr">下载到库内</span>
                    </button>
                </div>
            {/each}
        {/if}
    </div>

    <!-- ⛔ 阶段文字已上移到进度条里（#401）；这里只剩错误与成功提示 -->
    {#if err}<div class="rl-hint rl-hint-warn">{err}</div>{/if}
    {#if tip}<div class="rl-hint">{tip}</div>{/if}
</div>

<style>
    /* 前缀 `rl-dl-`（下载）—— ⛔ 别复用 `rl-*` 的既有类名，两处样式会互相污染。
       🔴 2026-09-28 #401：整块**照 `obsidian-lyricflux/styles.css` 的 `.lyrics-download-*` 搬**
       （用户：「lyricflux 的下载歌曲 UI 界面能不能直接搬过来，现在的太丑了（不要百科按钮）」）。
       搬的是**观感**（卡片 / 胶囊 / 24×24 图标按钮 / 进度条），类名仍是本仓的 `rl-dl-*` 前缀。
       🔴 #402：歌曲行右侧改成「来源标签 → 试听 → 下载」三件恒定 + VIP 移到歌曲底部胶囊。 */
    .rl-dl {
        display: flex;
        flex-direction: column;
        gap: 8px;
        /* 🔴 #496 追加：整块**可伸缩**，空间不够时往下压 —— 见 `styles.css` 的 `.rl-dl-modal-shell`
           （弹窗外层 `overflow:hidden`，只留结果区那一条滚动条）。⛔ 少了 min-height:0，flex 项会被
           内容撑住、永远不缩，于是又变回「整个弹窗在滚」。 */
        flex: 1 1 auto;
        min-height: 0;
    }
    /* 🔴 #496 追加：**只有结果区**可以伸缩 —— 搜索行 / 进度块 / 平台胶囊 / 提示行一律不缩，
       否则矮窗下先被压扁的是输入框和进度条（那才是真正要看的东西）。 */
    .rl-dl-search,
    .rl-dl-progress,
    .rl-dl-caps,
    .rl-hint {
        flex: none;
    }
    .rl-dl-search {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .rl-dl-search .rl-input {
        flex: 1;
        min-width: 0;
    }
    /* 进度条（正本 `.lyrics-download-progress*`）：本仓传输层没有流式回调 ⇒ 只做**不确定态**动画 +
       阶段文字，⛔ 不假装有百分比（那只会出现一个永远不动或乱跳的数字）。 */
    .rl-dl-progress {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .rl-dl-progress-track {
        height: 6px;
        border-radius: 3px;
        background: var(--background-modifier-border);
        overflow: hidden;
    }
    .rl-dl-progress-fill {
        height: 100%;
        width: 0;
        border-radius: 3px;
        background: var(--text-accent);
    }
    .rl-dl-progress-fill.is-indeterminate {
        width: 40%;
        animation: rl-dl-progress-slide 1.2s ease-in-out infinite;
    }
    @keyframes rl-dl-progress-slide {
        0% { margin-left: -40%; }
        100% { margin-left: 100%; }
    }
    .rl-dl-progress-text {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    .rl-dl-caps {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }
    /* 平台胶囊 = 正本 `.lyrics-download-item-tag(-active)` 口径：**恒有底色**的胶囊，
       选中档铺强调色 + 反色字 —— 比「只描边」一眼看得出当前在哪一档。 */
    .rl-dl-cap {
        padding: 2px 10px;
        border: none;
        border-radius: 4px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        box-shadow: none;
        font-size: var(--font-ui-smaller);
        cursor: pointer;
    }
    .rl-dl-cap.is-on {
        background: var(--text-accent);
        color: var(--text-on-accent);
        font-weight: 600;
    }
    .rl-dl-cap:disabled {
        opacity: 0.55;
        cursor: default;
    }
    /* ⚠️ 悬停**只变文字色、不写 background**（用户 2026-09-14 约定：并排切换类按钮不铺底色）。
       ⛔ 别在这里补 `background:` —— 会被产物断言当成「铺底色」抓住。 */
    .rl-dl-cap:not(.is-on):hover {
        color: var(--interactive-accent);
    }
    /* 结果区**固定高度**（正本口径）：边搜边出也不改变布局高度，输入框不会被顶得上下跳。
       🔴 #496 追加：加 `flex: 0 1 auto` + `min-height: 0` ⇒ **有空间时就是 320px（口径不变）**，
       空间不够时**它先缩**（而不是让整个弹窗多出一条滚动条）。
       ⚠️ `flex-grow` 恒 0 —— 否则窗口一高它就跟着涨，「固定高度」那条口径就没了。 */
    .rl-dl-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 0 1 auto;
        height: min(320px, 45vh);
        min-height: 0;
        overflow-y: auto;
        padding-right: 2px;
    }
    .rl-dl-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 2px 2px;
    }
    .rl-dl-head-t {
        flex: 1;
        min-width: 0;
        font-size: var(--font-ui-small);
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rl-dl-head-m {
        flex: none;
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    /* 头部小图标按钮（刷新 / 返回）+ 行内（试听 / 下载 / 歌单跳转）统一 24×24
       —— 正本 `.lyrics-download-*-btn` 口径 */
    .rl-dl-refresh,
    .rl-dl-back,
    .rl-dl-play,
    .rl-dl-go {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        box-shadow: none;
        color: var(--text-muted);
        cursor: pointer;
    }
    /* 返回按钮带文字 ⇒ 自动宽 */
    .rl-dl-back {
        width: auto;
        padding: 0 6px;
        gap: 4px;
    }
    .rl-dl-refresh:hover,
    .rl-dl-back:hover {
        color: var(--text-accent);
        background: transparent;
    }
    /* 试听悬停蓝、下载悬停绿（正本口径）；播放/下载中铺强调色底 = 「正在跑」的唯一视觉信号 */
    .rl-dl-play:hover {
        color: var(--color-blue, var(--text-accent));
        background: transparent;
    }
    .rl-dl-go:hover {
        color: var(--color-green, var(--text-accent));
        background: transparent;
    }
    /* 试听**播放 / 暂停**两态共用强调色底（#402）：图标本身 ▶/⏸ 区分。
       ⚠️ 必须连 `:hover` 一起写死底色 —— 否则一悬停就被上面那条 `background: transparent` 抹掉。 */
    .rl-dl-play.is-on,
    .rl-dl-play.is-on:hover {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
    }
    /* 拉取中（#402 新增态）：转圈 + 压暗。转圈用全局 `.rl-spinner`（styles.css 里已带
   prefers-reduced-motion 停转处理，⛔ 别在这里另写一份 keyframes）。 */
    .rl-dl-play.is-busy {
        opacity: 0.75;
        cursor: default;
    }
    .rl-dl-play:disabled,
    .rl-dl-go:disabled {
        opacity: 0.45;
        cursor: default;
    }
    /* VIP 行的下载按钮（#402）：压暗 = 「多半下不了」，但**仍可点**（点了会尝试，失败给明确原因；
       ⛔ 别改成 `disabled` —— 「点了毫无反应」正是用户要修的那个问题）。悬停给黄色，与普通行的绿区分。 */
    .rl-dl-go.is-off {
        opacity: 0.45;
    }
    .rl-dl-go.is-off:hover {
        color: var(--color-yellow, var(--text-accent));
    }
    /* 歌单卡片（#402 起外层只是**容器**：底色/圆角/内边距归它；点击区是内层真按钮，
       右端那枚平台标签是**标签本身**当跳转入口，见 `.rl-dl-tag.is-link`）*/
    .rl-dl-card,
    .rl-dl-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: var(--background-secondary);
        text-align: left;
        cursor: pointer;
        box-shadow: none;
    }
    .rl-dl-row {
        cursor: default;
    }
    .rl-dl-card:hover {
        background: var(--background-modifier-hover);
        border-color: var(--background-modifier-border-hover);
    }
    /* 卡片主体按钮：**裸样式**（透明 / 无边框 / 无阴影 / 撑满剩余宽）——
       ⛔ Obsidian 核心 `button:not(.clickable-icon)` 会给按钮铺灰底 + 内阴影，必须显式清掉。 */
    .rl-dl-card-open {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .rl-dl-card-open:disabled {
        opacity: 0.55;
        cursor: default;
    }
    .rl-dl-cover {
        width: 40px;
        height: 40px;
        flex: 0 0 auto;
        border-radius: 4px;
        object-fit: cover;
        background: var(--background-modifier-hover);
    }
    /* 无封面 = 灰底 + 音符图标（正本 `renderCoverPlaceholder` 口径） */
    .rl-dl-cover-ph {
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
    }
    .rl-dl-card-main,
    .rl-dl-row-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
    }
    .rl-dl-card-t,
    .rl-dl-card-m,
    .rl-dl-name,
    .rl-dl-artist {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rl-dl-card-t,
    .rl-dl-name {
        font-size: var(--font-ui-small);
        font-weight: 600;
    }
    .rl-dl-card-m,
    .rl-dl-artist {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }
    /* 元数据胶囊行（正本 `.lyrics-download-item-meta` + `-pill`）：格式 / 时长 / 大小 / 码率（VIP 垫底） */
    .rl-dl-pills {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
    }
    .rl-dl-pill {
        flex: none;
        padding: 0 6px;
        border-radius: 10px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        line-height: 16px;
        white-space: nowrap;
    }
    /* 非 mp3 才出现（FLAC / M4A 是「值钱信息」，给个蓝底） */
    .rl-dl-pill.is-ext {
        background: var(--color-blue, var(--interactive-accent));
        color: var(--text-on-accent);
        font-weight: 600;
    }
    /* 「VIP」= 黄底反色胶囊（正本 `.lyrics-download-item-pill-vip` 口径），#402 起落在**歌曲底部**：
       用户原话「改为在歌曲底部以『VIP』标签形式展示」⇒ ⛔ 别再回到「行末单独一枚标签」那种排法。 */
    .rl-dl-pill.is-vip {
        background: var(--color-yellow, var(--background-modifier-hover));
        color: var(--text-on-accent);
        font-weight: 600;
    }
    /* 不可下载的曲目整体压暗（仍可读），配合歌曲底部那枚 VIP 胶囊 */
    .rl-dl-row.is-vip .rl-dl-name,
    .rl-dl-row.is-vip .rl-dl-artist,
    .rl-dl-row.is-vip .rl-dl-pills {
        opacity: 0.62;
    }
    /* 正在下载的那一行：两个按钮压暗且不可点（正本 `.lyrics-download-downloading` 同款） */
    .rl-dl-row.is-busy .rl-dl-play,
    .rl-dl-row.is-busy .rl-dl-go {
        opacity: 0.5;
        pointer-events: none;
    }
    .rl-dl-tag {
        flex: 0 0 auto;
        padding: 1px 6px;
        border-radius: 4px;
        background: var(--background-modifier-hover);
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
        white-space: nowrap;
    }
    /* 来源标签可点时 = **直达歌曲页面**（#400 补回；新标签打开、弹窗保持打开）。
       ⚠️ 悬停**不写 background**（保留胶囊底色，只变色 + 下划线） */
    .rl-dl-tag.is-link {
        color: var(--text-muted);
        text-decoration: none;
        cursor: pointer;
    }
    .rl-dl-tag.is-link:hover {
        color: var(--text-accent);
        text-decoration: underline;
    }
</style>
