/**
 * 「从网络搜索封面」候选弹窗（#498）。
 *
 * 本文件**只是壳**：设标题 + 挂 `PosterSearch.svelte`。搜索与下载都经注入的 `deps`
 * （来自 `main.ts` 的门面）⇒ 这里零 `obsidian` 网络 API、零 `vault` 调用。
 *
 * 🔴 与 `MusicDownloadModal` 同一套约定：**保存实例并在 `onClose` 里销毁** ——
 *    不销毁的话组件里的 `onMount` 请求在弹窗关掉后仍会往已卸载的 DOM 上写状态。
 *
 * 🔴 弹窗尺寸：候选是**图**，要的是宽而不是高 ⇒ 覆盖宿主默认宽度（歌单弹窗那套是 `min(720px, 92vw)`，
 *    这里给 `min(760px, 94vw)` —— 760/112 ≈ 6 列，正好是「一眼扫一排」的密度）。
 */
import { Modal, type App } from 'obsidian';
import PosterSearch from 'views/components/PosterSearch.svelte';
import type { PosterCandidate } from 'pure/posterSearch';
import type { PosterSource } from 'pure/posterSources';

/** 弹窗依赖（真源在 `main.ts`；这里只声明形状，便于将来换源 / 单测） */
export interface PosterSearchDeps {
    /**
     * 搜候选图：`error` 与「空列表」是两回事（后者 = 真没搜到）。
     * 🔴 #509：**来源随请求一起传**（必应 / 网易云 / QQ / 酷狗 / 酷我）——
     *    真源 = `main.searchPosterCandidatesBySource`（平台那四条走既有的四平台搜索链）。
     */
    search: (
        source: PosterSource,
        query: string,
        page: number,
    ) => Promise<{ candidates: PosterCandidate[]; error?: string }>;
    /** 下载某张原图 → 本地化到 封面/ → 回传库内相对路径（与既有封面本地化同一条口径） */
    download: (candidate: PosterCandidate) => Promise<{ ok: boolean; message: string; path?: string }>;
}

export interface PosterSearchModalOptions {
    /**
     * 各来源的**默认搜索词**（**由表单侧拼好**）。
     * ⚠️ 两套语义不同，⛔ 别合成一个：必应那条要「标题 + 类型词」（`buildPosterQuery`），
     *    平台那四条要「标题 + 作者」（`buildPlatformCoverQuery`）—— 图片搜索与音乐平台搜索的输入不是一回事。
     */
    queries: Partial<Record<PosterSource, string>>;
    /** #509 可用来源（**表单侧决定**：音乐给全 5 个，其它类型只给 `bing`） */
    sources: PosterSource[];
    /** 选好并下载成功后回传库内相对路径（表单据此把封面指向新文件） */
    onPicked: (relPath: string) => void;
}

export class PosterSearchModal extends Modal {
    private instance: PosterSearch | null = null;

    constructor(
        app: App,
        private readonly deps: PosterSearchDeps,
        private readonly opts: PosterSearchModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText('从网络搜索封面');
        this.modalEl.style.width = 'min(760px, 94vw)';
        this.modalEl.style.maxWidth = '760px';
        contentEl.empty();
        this.instance = new PosterSearch({
            target: contentEl,
            props: {
                queries: this.opts.queries,
                sources: this.opts.sources,
                search: this.deps.search,
                pick: this.deps.download,
                onPicked: (relPath: string) => {
                    this.opts.onPicked(relPath);
                    this.close();
                },
            },
        });
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}
