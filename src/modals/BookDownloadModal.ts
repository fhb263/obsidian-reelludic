/**
 * 「下载书籍」弹窗（2026-09-28 #414；**#417 起 = 用户自备来源**；**#422 续四 删掉「粘贴直链」**）。
 *
 * 本文件**只是壳**（与 `MusicDownloadModal` 同构）：设标题 + 挂 `BookDownload.svelte`；
 * 所有网络与落盘都经注入的 `deps`（来自 `main.ts` 的门面）⇒ 这里零 `obsidian` 网络 API、零 `vault` 调用。
 *
 * 🔴 与 `EntryModal` 同一套约定：**保存实例并在 `onClose` 里销毁** ——
 *    不销毁的话组件里的 `onMount` 会在弹窗关掉后仍往已卸载的 DOM 上写状态。
 */
import { Modal, type App } from 'obsidian';
import type { NovelSourceSummary, SourceKind } from 'pure/sourceRule';
import type { NovelSearchHit, NovelSourceSearchResult, NovelTocItem } from 'services/novelSource';
import BookDownload from 'views/components/BookDownload.svelte';

/** 弹窗依赖（真源在 `main.ts`；这里只声明形状） */
export interface BookDownloadDeps {
    // ── #419 网文面（书源由用户自备）──
    /**
     * 已导入书源的摘要（`settings.novelSources` 经 `sourceSummary` 折过一遍）。
     * 🔴 #422 续二：**给全量**（每条带 `kind`），由组件自己「本类优先、本类为空则回退全部」——
     *    宿主按类硬过滤时，用户那批源一旦全在另一类，面板就一条都不显示（实测踩到，用户以为数据丢了）。
     */
    novelSources: () => NovelSourceSummary[];
    /** 多源搜索（渐进上报）；只搜 `kind` 那一类的源 */
    novelSearch: (
        keyword: string,
        kind: SourceKind,
        onPartial?: (r: NovelSourceSearchResult[]) => void,
    ) => Promise<NovelSourceSearchResult[]>;
    /** 取一本书的目录 */
    novelToc: (hit: NovelSearchHit) => Promise<{ items: NovelTocItem[]; error?: string }>;
    /** 抓整本并落盘（`format` = 成品格式：TXT / EPUB）。
     *  🔴 `tocText` = 抓到的章节名清单（一行一章）；**只对「文学」条目写回** —— 判定在表单侧。
     *  🔴 #428 `cancelled` = 用户按了取消（**没落盘**）；面板据此走**中性提示**，⛔ 不当成失败报红。 */
    novelDownload: (req: {
        hit: NovelSearchHit;
        from: number;
        to: number;
        format: 'txt' | 'epub';
        onProgress: (done: number, total: number, failed: number) => void;
    }) => Promise<{ ok: boolean; message: string; relPath?: string; tocText?: string; cancelled?: boolean }>;
    /**
     * 取消抓取。
     * 🔴 #428：宿主侧是**当帧生效**的（`CancelToken`：在飞的请求立刻不再被等待），
     *    且 **`onClose` 也会调它**（见下面那条说明）—— 所以它必须**幂等**。
     */
    novelCancel: () => void;
    /**
     * 就地导入书源（#421）：挑 `.json` → 导入 → 回报。
     * ⚠️ `null` = 用户点了取消（组件必须什么都不做）；结果消息由**面板自己显示**，宿主不再叠 Notice。
     * 🔴 #422：`kind` = 导进哪一类（= 弹窗当前分类）。
     */
    novelImport: (text: string, kind: SourceKind) => { ok: boolean; message: string };
    // 🔴 #455：原 `novelMoveAll`（把另一类整批搬进本类）**已从弹窗依赖里退场** ——
    //    用户：「两个不同类型的源不可能相通的，用网文源怎么搜文学类书籍完全是多此一举」。
    //    改分类是管理动作，归属地 = 设置页（那边的 `moveAllNovelSources` 仍在用）。⛔ 别再加回来。
}

export interface BookDownloadModalOptions {
    /**
     * 下载成功后回传库内相对路径（表单据此把「书籍文件」指过去）+ **章节名清单**（P1-C）。
     * ⚠️ 第二参只有书源那条路给得出（它有目录）；消费端按**条目是不是文学**决定要不要写回 `toc`。
     */
    onPicked: (relPath: string, tocText?: string) => void;
    /** 🔴 #422：这次下载属于哪一类书（网文 / 经典文学）—— 整场优先只用这一类的书源 */
    kind: SourceKind;
}

/**
 * 下载窗口的标题 / 按钮词——**按类分开**（#433）。
 *
 * 🔴 用户口径：「和网文源窗口独立开，做独立文学类下载按钮和窗口」⇒ 两个窗口各有各的名字，
 *    ⛔ 别再退回一个笼统的「下载书籍」（两个窗口同时开着时，用户分不清哪个是哪个）。
 * ⚠️ 用语与设置页那两节（`SOURCE_KIND_LABEL`：网络文学源 / 经典文学源）**同源**，⛔ 别自造第三套叫法。
 */
export function downloadWindowTitle(kind: SourceKind): string {
    return kind === 'novel' ? '下载网文' : '下载文学';
}

export class BookDownloadModal extends Modal {
    private instance: BookDownload | null = null;

    constructor(
        app: App,
        private readonly deps: BookDownloadDeps,
        private readonly opts: BookDownloadModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        // 🔴 #433：标题**按类分**（用户：「和网文源窗口独立开，做独立文学类下载按钮和窗口」）——
        //    ⛔ 别再退回一个笼统的「下载书籍」：两个窗口同时开着时用户分不清哪个是哪个。
        this.titleEl.setText(downloadWindowTitle(this.opts.kind));
        contentEl.addClass('rl-dl-modal'); // 与「下载歌曲」共用同一套弹窗外壳样式
        contentEl.empty();
        this.instance = new BookDownload({
            target: contentEl,
            props: {
                // ⛔ #422 续四：`title` / `author` 两个 props 已随「粘贴直链」一起删除 ——
                //    它们唯一的用途是给直链那路**预填落盘文件名**（书源路的文件名取自书源返回的书名）。
                onPicked: this.opts.onPicked,
                // 🔴 #422：分类由选项给（入口决定），组件据此取源 / 搜索 / 导入
                kind: this.opts.kind,
                novelSources: this.deps.novelSources,
                novelSearch: this.deps.novelSearch,
                novelToc: this.deps.novelToc,
                novelDownload: this.deps.novelDownload,
                novelCancel: this.deps.novelCancel,
                novelImport: this.deps.novelImport,
            },
        });
    }

    /**
     * 🔴 **#428：关弹窗（右上角叉 / Esc）= 取消这次抓取** —— 与面板里那枚「取消」**同一口径**。
     *
     * 起因是用户实测：「我点了叉才退出但能保存」。旧版这里只销毁组件、**不通知抓取层** ⇒
     * 抓取在后台继续跑完，然后**静默落盘**（用户既没有进度也没有回执，文件却出来了）。
     * 现在两件事一起做：先 `novelCancel()`（当帧让在飞的请求不再被等待），再销毁组件。
     * ⚠️ `novelCancel` 必须幂等（`CancelToken.stop()` 是幂等的）—— 这里可能紧随面板里的按钮再来一次。
     * ⚠️ 下载**已经结束**时调它也无害：宿主那侧 `this.novelCancel` 已被置回 `null`。
     */
    onClose(): void {
        this.deps.novelCancel();
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}

/**
 * 「下载书籍」弹窗 —— **文学与网文各一个窗口**（#433）。
 *
 * 🔴 一个共用基类 + **两个薄壳**：逻辑（搜索 / 选书 / 抓取 / 续传 / 取消 / 进度）**只有一份**，
 *    壳子只负责「我是哪一类」。⛔ 别把整个弹窗复制两份 —— 那份逻辑刚在 #428/#429/#431 收口，
 *    复制出去必然漂移（本仓「两套实现必然分家」栽过多次）。
 * ⚠️ 两个壳**各自固定 kind**：调用方再不用记「开窗时要传对分类」，⛔ 也别给壳子加 kind 参数。
 * ⚠️ ⛔ 必须写在**基类之后**： 是在**定义那一刻**求值的，写在前面会撞 TDZ
 *    （，只在运行时炸 —— 本仓最容易漏的一类）。
 */
export class NovelDownloadModal extends BookDownloadModal {}
export class LiteratureDownloadModal extends BookDownloadModal {}
