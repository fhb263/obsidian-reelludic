/**
 * 「下载歌曲」弹窗（#399-D 起 = **四平台版**；形态照 `obsidian-lyricflux/src/DownloadModal.ts`）。
 *
 * 本文件**只是壳**：设标题 + 挂 `MusicDownload.svelte`。所有网络与落盘都经注入的 `deps`
 * （来自 `main.ts` 的门面）⇒ 这里零 `obsidian` 网络 API、零 `vault` 调用。
 *
 * 🔴 与 `EntryModal` 同一套约定：**保存实例并在 `onClose` 里销毁** ——
 *    不销毁的话组件里的 `onMount` 请求在弹窗关掉后仍会往已卸载的 DOM 上写状态。
 */
import { Modal, type App } from 'obsidian';
import MusicDownload from 'views/components/MusicDownload.svelte';
import type {
    DlPreviewResult,
    DownloadProgressCallback,
    DownloadSong,
    PlaylistSource,
    RecommendedPlaylist,
} from 'services/dl';
import type { BiliVideo } from 'pure/dl/bilibili';

/** 弹窗依赖（真源在 `main.ts`；这里只声明形状，便于将来换源 / 单测） */
export interface MusicDownloadDeps {
    search: (
        keyword: string,
        onPartial?: (songs: DownloadSong[]) => void,
        onEmpty?: (networkError: boolean) => void,
    ) => Promise<{ songs: DownloadSong[]; failedSources: PlaylistSource[] }>;
    loadPlaylists: (source: PlaylistSource, limit?: number) => Promise<{ playlists: RecommendedPlaylist[]; error?: string }>;
    loadPlaylist: (source: PlaylistSource, id: string) => Promise<{ songs: DownloadSong[]; error?: string }>;
    download: (
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ) => Promise<{ ok: boolean; message: string; relPath?: string }>;
    /** 试听（#400）：取标准档字节（不写盘），由组件转 Blob 播放；缓存仅本会话有效 */
    preview: (song: DownloadSong, onProgress?: DownloadProgressCallback) => Promise<DlPreviewResult>;
    /** B站搜索（#496）：`error` 与「空列表」是两回事（后者 = 真没搜到） */
    biliSearch: (keyword: string) => Promise<{ videos: BiliVideo[]; error?: string }>;
    /** B站下载（#496）：yt-dlp 抓音频转 mp3；成功后回传库内相对路径（与四平台同一套落盘口径） */
    biliDownload: (
        video: BiliVideo,
        onProgress?: DownloadProgressCallback,
    ) => Promise<{ ok: boolean; message: string; relPath?: string }>;
}

export interface MusicDownloadModalOptions {
    /** 条目标题（检索词初值） */
    title: string;
    /** 条目作者（检索词初值） */
    author: string;
    /** 下载成功后回传库内相对路径（表单据此把「本地音频」指向新文件） */
    onPicked: (relPath: string) => void;
}

export class MusicDownloadModal extends Modal {
    private instance: MusicDownload | null = null;

    constructor(
        app: App,
        private readonly deps: MusicDownloadDeps,
        private readonly opts: MusicDownloadModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText('下载歌曲');
        contentEl.addClass('rl-dl-modal');
        /**
         * 🔴 #496 追加：给**弹窗外壳**也挂一个类 —— 「只留一条滚动条」那条规则（`styles.css`）
         *    必须作用在 `.modal` 上（宿主给它写了 `overflow: auto`），⛔ 不能作用在 `contentEl`。
         *    ⚠️ 与 `rl-dl-modal`（contentEl）是**两个不同的元素**，⛔ 别合并成一个类名。
         */
        this.modalEl.addClass('rl-dl-modal-shell');
        contentEl.empty();
        this.instance = new MusicDownload({
            target: contentEl,
            props: {
                title: this.opts.title,
                author: this.opts.author,
                search: this.deps.search,
                loadPlaylists: this.deps.loadPlaylists,
                loadPlaylist: this.deps.loadPlaylist,
                download: this.deps.download,
                preview: this.deps.preview,
                biliSearch: this.deps.biliSearch,
                biliDownload: this.deps.biliDownload,
                onPicked: this.opts.onPicked,
                // ⚠️ #399-C 起**不再传 `onClose`**（弹窗内的「关闭」按钮已按用户要求删除；
                //    退出走 Modal 自带 ✕ / Esc / 点外部）⇒ 组件侧也删掉了该 prop（留 unused export 会 +1 构建告警）。
            },
        });
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}
