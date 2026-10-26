// 添加/编辑条目弹窗（Douban/TMDB/Bangumi 搜索回填 + 手动覆盖）
import { App, Modal, Notice, TFile, normalizePath } from 'obsidian';
// 🔴 #635：Svelte 4 只有在组件**被绑定**时才会保留 `export function`（如 `isDirty()`），
//    否则编译期就把它们摇成空壳（实测产物里 `function isDirty() { return false; }`）。
//    `bind()` 就是 `<Component bind:this={…}>` 背后那一句 —— 本仓没有用自定义元素，故直接调它。
//    ⚠️ `svelte/internal` 已在 esbuild 的 external 名单里（红线 5），运行时由宿主提供。
import { bind as bindComponent } from 'svelte/internal';
import EntryForm from 'views/components/EntryForm.svelte';
import type ReelLudicPlugin from '../../main';
import type { TmdbSearchResult } from 'services/tmdb';
import type { EntryType, MediaEntry, EntryLogKind } from 'data/types';
import { SOURCE_VIEW, type SearchResult } from 'pure/searchDisplay';
import { extractEditableFromNote, extractFrontmatterFromNote } from 'pure/noteEditable';
// 1.3.1 ① 字段映射：笔记里的键名可能被用户改过，读回时要按同一份配置反查
import { compileFieldMapText } from 'pure/fieldMap';
import { lrcBlockLyrics } from 'pure/lrcSource';
import { orphanedDownloadedPosters } from 'pure/posterFile';
import { NoteConflictModal } from 'modals/NoteConflictModal';
// 🔴 #635 切条目前的脏检查确认框（`window.confirm` 在 Electron 里会阻塞主线程 + 与 Modal 关闭动画抢焦点）
import { ConfirmModal } from 'modals/ConfirmModal';
import { PosterSearchModal } from 'modals/PosterSearchModal';
import type { PosterCandidate } from 'pure/posterSearch';
import type { PosterSource } from 'pure/posterSources';
import type { SearchProgressCb } from 'pure/searchProgress';
import type { BookKind } from 'data/types';
import type { AiSummaryInput } from 'pure/aiSummary';
import type { AiPrefillInput } from 'pure/aiPrefill';
import type { LyricSourceId } from 'pure/lyricOnline';
import type { LocalEpisodeQuery } from 'pure/localEpisode';
// 🔴 #602：书籍本地检索的查询形状（与关联弹窗**同一份**，收在纯模块 —— ⛔ 别在组件侧另立一个）
import type { LocalBookSearchQuery } from 'pure/localDirs';
import { applyScrollPref } from 'services/scrollPref';
// 🔴 #632 连续添加：序号 +1 的唯一算法（另见 `EntryForm.repeatAddState` —— 会话状态的产出方）
import { nextSeriesIndexLabel, type RepeatAddState } from 'pure/repeatAdd';
// ⑬ 搜索累积池（会话内）：合并/去重/桶键口径都在纯模块里，⛔ 别在本文件里再写一份
import { bucketOf, mergeSearchResults, searchBucketKey, withBucket, SEARCH_POOL_KEEP, type SearchPool } from 'pure/searchAccum';

export class EntryModal extends Modal {
    /**
     * 表单实例（`mountForm` 建、`onClose` / 重建时 `$destroy`）。
     * 🔴 #635：本类现在**要调组件的导出方法**（`isDirty()` / `repeatAddState()`）——
     * Svelte 4 的 `export function` 只在组件**被 `bind:this` 绑定过**时才会留下代码：
     * 否则树摇会把它整个删掉（产物里只剩个壳）。本字段就是这个绑定点，⛔ 别改成局部变量。
     */
    private form: EntryForm | null = null;
    /** 本次会话 douban 封面下载的本地相对路径集合（保存失败/取消时清理孤儿文件，防止 封面/ 残留垃圾） */
    private downloadedPosters = new Set<string>();
    /** 保存是否成功（onClose 时决定：清理全部 vs 仅保留被条目引用的那张） */
    private saved = false;
    /** 保存成功时条目实际引用的封面相对路径（未保存/封面被清空时为 undefined） */
    private savedPoster?: string;
    /**
     * 🔴 #632 连续添加的会话状态（**新建态**保存成功后更新一次，重建表单时注回去）。
     * ⚠️ 编辑态永不写它 —— 「保存后不关窗」只属于新增（用户要的是「接着加下一条」）。
     */
    private repeat: RepeatAddState = { results: [], query: '', addedKey: null, series: '', seriesIndex: '' };
    /** 「已添加」标记键集：本次会话里**建成过条目**的候选（`pure/repeatAdd.resultKeyOf`）—— 跨重建累积 */
    private addedHits = new Set<string>();
    /**
     * ⑬ 搜索累积池（用户 2026-10-25 改口径：「添加条目窗口保存逻辑仅搜索完毕不关闭窗口才保存，
     * 退出再重新搜索为清除」）。
     *
     * 🔴 **只活在本实例的内存里**，落盘那套已整段拆掉（原 `{lib}/search-pool.json`）：
     *   - 弹窗关掉 ⇒ 实例被丢弃 ⇒ 池子随之蒸发 ⇒ 再点「添加」重新搜索是空的（正是用户要的「清除」）；
     *   - 弹窗**没关**时，换关键词再搜仍会并进同一个桶（「上限 20 条可再搜索突破」这条照旧有效）；
     *   - 保存并继续（`mountForm` 重建表单）时实例还在 ⇒ 池子不丢，用户挑的那批还在屏上。
     * ⛔ 别把它挪到 `plugin` 上：那就等于回到跨会话持久化，用户明确否掉的正是这个。
     */
    private searchPool: SearchPool = {};
    // 🔴 #668 关联功能区已下线归档（用户：「编辑条目的关联功能区全部给我移除掉吧归档下未来实现」）：
    //    这里的「关联候选池」(`pool`) 与「切条目重入守卫」(`switching`) 随之退场 —— 它们只服务那套 UI。
    //    ⚠️ 数据层与笔记侧**未删除**（`MediaEntry.related` / `normalizeEntry` 白名单 / 笔记 `## 关联` 章节）。

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        private entry?: MediaEntry,
        /** 新增模式初始类型：从某个 Tab 点「＋ 添加」时传入该 Tab 类型（默认电影） */
        private initialType?: EntryType,
        /** 新增模式初始书籍分类：书籍页签聚焦子分类（漫画/网文）时传入（漫画态表单下拉选中「漫画」） */
        private initialBookKind?: BookKind,
    ) {
        super(app);
    }

    /** 按结果栏数调整弹窗宽度：三源/三栏并排需宽（~1200），一/两栏与搜索输入/编辑态用常规宽度 720 */
    private applyResultCols(cols: number): void {
        if (cols >= 3) {
            this.modalEl.style.width = 'min(1200px, 96vw)';
            this.modalEl.style.maxWidth = '1200px';
        } else {
            this.modalEl.style.width = 'min(720px, 92vw)';
            this.modalEl.style.maxWidth = '720px';
        }
    }

    async onOpen(): Promise<void> {
        this.contentEl.empty();
        // 统一先以常规宽度 720 呈现（新增/编辑/搜索输入阶段都不需要宽屏），
        // 待结果展示达到三栏（EntryForm 上报 cols≥3）才动态加宽
        this.applyResultCols(0);
        // 编辑表单适配 Obsidian 正文字体（--font-text），与视图内容区一致
        this.contentEl.addClass('rl-form-root');
        // 🔴 #630：滚动条偏好走 `services/scrollPref` 那一处真源（**跟随设置开关**）——
        //    原先这里自己判 `settings.hideScrollbars`，与另外二十多个弹窗各写各的 ⇒ 口径一改全仓找。
        applyScrollPref(this.modalEl);
        /**
         * 🔴 ⑬ 搜索累积池（用户 2026-10-25 定稿口径：「保存逻辑仅搜索完毕不关闭窗口才保存，
         * 退出再重新搜索为清除」）：
         * **不再从盘上注回任何东西** —— `searchPool` 是本实例的字段，新建实例必然是空的。
         * 所以「关掉弹窗再点添加」看到的就是空列表，正是用户要的「清除」。
         * ⚠️ 唯一还沿用池子的地方是 `repeat.results`（「保存并继续」带回来的本次会话列表）——
         *    它属于**同一个实例、窗口没关**的场景，与「退出再重新搜索」不冲突。
         */
        const { effective, lrc: initialLrc } = await this.readEntryForForm(this.entry);
        this.mountForm(effective ?? null, initialLrc);
    }

    /**
     * 取「表单该用的条目 + LRC 初值」。编辑模式：catalog 是结构化数据源，但用户可能直接在笔记里
     * 手动编辑过「个人评语/观看·相关链接/简介/作者简介/目录」与顶部 frontmatter（评分/状态/年份/进度等）——
     * 打开表单时读笔记覆盖 catalog 值，避免内容「消失」（全类型通用）。
     *
     * 🔴 #635 从 `onOpen` 里**原样抽出**：切条目（`openRelated`）必须走**同一份口径** ——
     *    两处各写一遍，迟早只改一处，表现为「切过去之后笔记里手改的评语看不到了」。
     * 无 notePath / 笔记不可读 ⇒ 原样返回 catalog 值（⛔ 不抛错：没笔记的条目就是没笔记）。
     */
    private async readEntryForForm(source: MediaEntry | undefined): Promise<{ effective: MediaEntry | undefined; lrc: string }> {
        let effective = source;
        let initialLrc = '';
        if (source?.notePath) {
            try {
                const f = this.app.vault.getAbstractFileByPath(source.notePath);
                if (f instanceof TFile) {
                    const text = await this.app.vault.read(f);
                    initialLrc = lrcBlockLyrics(text);
                    const ext = extractEditableFromNote(text);
                    const fm = extractFrontmatterFromNote(text, compileFieldMapText(this.plugin.settings.fieldMap ?? ''));
                    if (ext.notes !== undefined || ext.links || ext.summary !== undefined || ext.authorIntro !== undefined || ext.toc !== undefined || ext.aiSummary !== undefined || ext.aiHighlights !== undefined || ext.sourceUrl !== undefined || Object.keys(fm).length > 0) {
                        // banner（frontmatter 为库内完整路径，如 媒体库/封面/xx.jpg）→ poster（相对路径 封面/xx.jpg）
                        let poster = fm.poster;
                        if (poster && !/^https?:\/\//.test(poster)) {
                            const dir = (this.plugin.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
                            if (poster.startsWith(dir + '/')) poster = poster.slice(dir.length + 1);
                        }
                        effective = {
                            ...source,
                            notes: ext.notes ?? source.notes,
                            links: ext.links ?? source.links,
                            summary: ext.summary ?? source.summary,
                            authorIntro: ext.authorIntro ?? source.authorIntro,
                            toc: ext.toc ?? source.toc,
                            aiSummary: ext.aiSummary ?? source.aiSummary,
                            aiHighlights: ext.aiHighlights ?? source.aiHighlights,
                            source: ext.source ?? source.source,
                            sourceUrl: ext.sourceUrl ?? source.sourceUrl,
                            ...fm,
                            // frontmatter 无 history 字段：进度合并保留条目既有追更历史，避免保存时清空
                            progress: fm.progress
                                ? { ...(source.progress ?? { season: 1, episode: 0, history: [] }), ...fm.progress, history: source.progress?.history ?? [] }
                                : source.progress,
                            poster: poster ?? source.poster,
                        };
                    }
                }
            } catch {
                // 笔记不可读：忽略，沿用 catalog 值
            }
        }
        return { effective, lrc: initialLrc };
    }

    /**
     * 🔴 #632 连续添加 —— **建 / 重建**表单组件（新建态保存成功后走一遍，见 `repeatAdd()`）。
     *
     * 为什么重建而不是「把字段一个个复位」：表单有 60+ 个 state（各源 UI 模式、进度、浮层开关、
     * 下载态……），逐个复位迟早漏一个 —— 而漏掉的那个会**带着上一条的脏值落库**。
     * 重建 = 所有初值回到 `entry: null` 那一套，天然干净。
     * 而「跨次还要用」的四样（候选列表 / 关键词 / 已添加标记 / 系列两栏）由宿主拿着、经 `preset*` 注回。
     *
     * ⚠️ 重建 **≠ 重开弹窗**：Modal 外壳与 `contentEl` 都留着 ⇒ 这里**不碰** `onOpen` 里那套
     *    （`titleEl` / 宽度初值 / 滚动条偏好），只换里面的组件实例。
     * ⚠️ 顺带 `applyResultCols(0)` 把宽度收回常规值：上一条可能是在三栏（宽屏 1200）态保存的。
     */
    private mountForm(effective: MediaEntry | null, initialLrc: string): void {
        this.form?.$destroy();
        this.applyResultCols(0);
        this.form = new EntryForm({
            target: this.contentEl,
            props: {
                entry: effective,
                // 🔴 #632 连续添加的会话状态（新建态才有值；编辑态恒为空 ⇒ 与旧行为逐字一致）
                presetResults: this.repeat.results,
                presetQuery: this.repeat.query,
                addedHits: this.addedHits,
                initialSeries: this.repeat.series,
                initialSeriesIndex: this.repeat.seriesIndex,
                initialType: this.entry?.type ?? this.initialType ?? 'movie',
                initialBookKind: this.entry?.bookKind ?? this.initialBookKind,
                canSearch: !!this.plugin.settings.tmdbApiKey,
                canSearchBook: true,
                canSearchGame: true, // 游戏仅 Douban 源，始终可搜
                /** 结果栏数变化 → 动态宽度（仅三栏加宽） */
                onResultCols: (cols: number) => this.applyResultCols(cols),
                /** 该类型本次搜索实际会发起的源集合（固定占栏用）—— 🔴 2026-09-30 起带 `kind`：
                 *  漫画独立成组后，书籍态必须按子分类问（否则漫画态会多报一个源、栏位数跟着错）。 */
                onSourcesForType: (type: EntryType, kind?: BookKind) => this.plugin.sourcesForType(type, kind),
                onSearch: (q: string, t: 'movie' | 'tv', onProgress?: SearchProgressCb) => this.plugin.searchWithFallback(q, t, onProgress),
                onSearchBook: (q: string, kind?: BookKind, onProgress?: SearchProgressCb) => this.plugin.searchBook(q, kind, onProgress),
                onSearchGame: (q: string, onProgress?: SearchProgressCb) => this.plugin.searchGame(q, onProgress),
                onSearchAnime: (q: string, onProgress?: SearchProgressCb) => this.plugin.searchAnime(q, onProgress),
                onSearchMusic: (q: string, onProgress?: SearchProgressCb) => this.plugin.searchMusic(q, onProgress),
                /**
                 * 🔴 ⑬「可再搜索突破」的会话内接线（用户 2026-10-25 改口径：**不落盘**）。
                 * 合并/去重/截断的算法在 `pure/searchAccum`；池子存本实例的 `searchPool` 字段，
                 * 弹窗一关随实例销毁 ⇒「退出再重新搜索为清除」由生命周期保证，⛔ 不需要额外的清理代码。
                 * ⚠️ 组件只把「本次新鲜结果」交过来，拿**合并后的完整列表**回去渲染 —— 不碰 vault。
                 */
                onMergeSearchPool: (t: EntryType, k: BookKind | undefined, fresh: SearchResult[]) =>
                    this.mergeSearchPool(t, k, fresh),
                onFetchDetail: (r: TmdbSearchResult) => this.plugin.fetchTmdbDetail(r),
                // 豆瓣兜底结果：点击时按需拉详情补全表单字段（搜索仅前 3 条预补全）
                onFetchDoubanDetail: (id: string, type: EntryType) => this.plugin.fetchDoubanDetailForEntry(id, type),
                // 🔴 #623 Steam 游戏选中结果按需补全（appdetails 公开端点 → 平台/开发商/发行年/题材/简介；
                //    失败 null 静默）。⚠️ 与上面的 TMDB 详情**是两条独立回调** —— 别为了省一个 prop 把
                //    Steam 的 appid 塞进 `onFetchDetail`（那条只通 TMDB，会拼出 /undefined/{appid} 打 404）。
                onFetchSteamDetail: (appid: number) => this.plugin.fetchSteamDetailForEntry(appid),
                // Bangumi 选中结果按需补全（persons+subjects API → 导演/评分/主演）
                onFetchBangumiDetail: (id: number) => this.plugin.fetchBangumiDetailForEntry(id),
                // Open Library 书籍选中结果按需补全（works.json → 简介/页数/出版社；失败 null 静默）
                onFetchOpenLibraryDetail: (key: string) => this.plugin.fetchOpenLibraryDetailForEntry(key),
                // 🔴 #609 微信读书书籍选中结果按需补全（/web/book/info → 出版年/出版社/ISBN/分类/完整简介/大图封面；
                //    与「从微信读书同步书架」逐本补详情同一端点、同一解析、同一闸门；失败 null 静默）
                onFetchWereadDetail: (bookId: string) => this.plugin.fetchWereadDetailForEntry(bookId),
                // OMDb（IMDb）影视选中结果按需补全（i= 详情 → Plot/导演/演员/评分；失败 null 静默）
                onFetchOmdbDetail: (imdbID: string) => this.plugin.fetchOmdbDetailForEntry(imdbID),
                onSubmit: async (raw: Record<string, unknown>) => {
                    // 数据保存成功才关弹窗；笔记生成失败不阻断（条目已落库，仍刷新视图）
                    // 🔴 `lrc`（LRC 歌词正文）**不是 catalog 字段**：它住在笔记的 ` ```lrc ` 块里，
                    //    必须从落库字段里剥掉，稍后经 `service.setNoteLrc` 单独写回笔记（#396）。
                    const { lrc, ...input } = raw;
                    let targetId = '';
                    let noteWritten = false;
                    let saved = false;
                    try {
                        if (this.entry) {
                            const updated = await this.plugin.service.update(this.entry.id, input);
                            targetId = updated.id;
                            // 封面本地化开关开启且封面是 URL → 下载到 covers/ 并更新引用（失败静默，不影响保存）
                            if (this.plugin.settings.localizePosters && updated.poster && /^https?:\/\//.test(updated.poster)) {
                                await this.plugin.localizeEntryPoster(updated.id);
                            }
                            try {
                                // G 双写冲突：笔记被外部修改（手动编辑过）→ 弹窗二选一；「保留」跳过重写（catalog 已保存）
                                if (await this.plugin.service.noteWasExternallyModified(updated.id)) {
                                    const choice = await new NoteConflictModal(this.app, updated.title).open();
                                    // 🔴 两种情况都必须让指纹跟上，否则该条目**下次保存还会再问一遍**
                                    //    （用户 2026-09-21 报「总会有外部修改提示」的真因之一）：
                                    //    「覆盖」= writeNote 用库数据重写（自带刷指纹）；
                                    //    「保留」= 认可当前笔记为新基线（旧实现这里什么也没做 ⇒ 永远问不完）。
                                    if (choice === 'overwrite') {
                                        await this.plugin.service.writeNote(updated.id);
                                        noteWritten = true;
                                    } else {
                                        await this.plugin.service.adoptNoteAsBaseline(updated.id);
                                    }
                                } else {
                                    await this.plugin.service.writeNote(updated.id);
                                    noteWritten = true;
                                }
                                new Notice(`已更新：${updated.title}`);
                            } catch (e) {
                                new Notice(`已更新，但笔记生成失败：${e instanceof Error ? e.message : String(e)}`);
                            }
                        } else {
                            const entry = await this.plugin.service.create(input);
                            targetId = entry.id;
                            if (this.plugin.settings.localizePosters && entry.poster && /^https?:\/\//.test(entry.poster)) {
                                await this.plugin.localizeEntryPoster(entry.id);
                            }
                            try {
                                await this.plugin.service.writeNote(entry.id);
                                noteWritten = true;
                                new Notice(`已添加：${entry.title}`);
                            } catch (e) {
                                new Notice(`已添加，但笔记生成失败：${e instanceof Error ? e.message : String(e)}`);
                            }
                        }
                        // LRC 歌词写回笔记（#396）：只在**本次真的写过笔记**时写 ——
                        // 冲突弹窗选「保留笔记文件」= 用户要求保留笔记现状，此时连歌词框一起尊重（⛔ 别覆盖）。
                        // `setNoteLrc` 自带「内容无变化不写盘 / 不刷无谓指纹」，所以未改歌词时空跑一次没有代价。
                        if (noteWritten && targetId && lrc !== undefined) {
                            await this.plugin.service.setNoteLrc(targetId, String(lrc));
                        }
                        // 保存成功：记录实际引用的封面（onClose 清理时保留它，只删本次会话的其他下载）
                        this.saved = true;
                        this.savedPoster = typeof input.poster === 'string' ? input.poster : undefined;
                        saved = true;
                    } catch (e) {
                        new Notice('保存失败：' + (e instanceof Error ? e.message : String(e)));
                    } finally {
                        // 无论成败都刷新：数据可能已变更（如 writeNote 部分成功），界面必须反映最新状态
                        if (saved) {
                            // 🔴 #632：**编辑态照旧关窗**（改完就走）；新建态不关 —— 回到候选列表接着挑下一条
                            //    （用户：「新增一个条目后搜索源出来的窗口不消失可继续添加」）。
                            if (this.entry) this.close();
                            else this.repeatAdd();
                        }
                        await this.plugin.refreshViews();
                    }
                },
                onDelete: () => this.deleteEntry(),
                onCancel: () => this.close(),
                /** 书籍编辑表单「添加摘抄」：固定挂载当前条目打开摘抄弹窗 */
                onAddExcerpt: () => {
                    if (this.entry) this.plugin.openExcerptModal(this.entry);
                },
                /** #685 编辑表单「记录时长 / 记录周目」：固定挂载当前条目打开记录弹窗 */
                onOpenEntryLogModal: (kind: EntryLogKind) => {
                    if (this.entry) this.plugin.openEntryLogModal(this.entry, kind);
                },
                onOpenSource: (url: string) => this.plugin.openExternalUrl(url),
                /** 编辑表单「集按钮」：打开本地剧集视频（桌面 Electron 系统播放器） */
                onPlayEpisode: (path: string) => void this.plugin.playLocalEpisode(path),
                /** 编辑表单「浏览」：系统文件选择器选本地视频，返回绝对路径（Electron remote.dialog） */
                onPickLocalVideo: () => this.plugin.pickLocalVideoPath(),
                /** 编辑表单「本地音频」：系统文件选择器选音频，返回 vault 相对路径（库外绝对路径） */
                onPickLocalAudio: () => this.plugin.pickLocalAudioPath(),
                /** #462 编辑表单「播放」按钮的悬停提示：探关联音频的**体积 + 时长**（拿不到的那项不显示） */
                onProbeAudioInfo: (path: string) => this.plugin.probeAudioInfo(path),
                /** 编辑表单「总结摘要」小标题右侧 ✨：AI 生成一句话总结 + 核心看点（复用阅读器翻译的服务商与 Key；失败返回 null 且已提示） */
                onAiSummarize: (input: AiSummaryInput) => this.plugin.aiSummarizeEntry(input),
                /** #499 新增条目标题行 ✨：AI 预填客观字段（返回字段表 + 工具来源；失败返回 null 且已提示）。⚠️ 只表字段，不落库 —— 预览确认后由表单回填
                 *  #499D 第二参 `onStep`：agent 工具回路里每次调工具的进度回执（宿主执行工具，表单只显示） */
                onAiPrefill: (input: AiPrefillInput, onStep?: (label: string) => void) =>
                    this.plugin.aiPrefillEntry(input, onStep),
                /** 编辑表单游戏「启动快捷方式」：系统文件选择器选 .lnk，返回 vault 相对路径（库外绝对路径） */
                onPickGameLaunch: () => this.plugin.pickGameLaunchPath(),
                /** 编辑表单书籍「浏览」：系统文件选择器选 TXT/EPUB/PDF/CBZ/CBT，返回 vault 相对路径 */
                onPickBookFile: () => this.plugin.pickBookFilePath(),
                /**
                 * 🔴 #539 编辑表单书籍「选文件夹」：**漫画「散装文件夹型」**把**文件夹本身**关联成书。
                 * ⚠️ 与 `onPickBookFile`（`openFile`）**分开两枚** —— Electron 在 Windows/Linux 上不能
                 *    同时选文件与目录（组合形态会退化成只能选文件，实测报障即此）。
                 * 三态透传：`string` 选中 / `null` 取消 / `undefined` 本环境无系统对话框。
                 */
                onPickBookFolder: () => this.plugin.pickBookFolderPath(),
                onPickVideoDir: () => this.plugin.pickVideoDirPath(),
                /**
                 * 🔴 #602 编辑表单「检索本地书籍」：**与影视那枚单集本地检索同一条链** —— 宿主按子分类
                 * 取设置里的「文学 / 网文 / 漫画目录」，递归扫 + 按标题匹配（`main.searchLocalBookFile`）。
                 * ⚠️ #524 那套「先弹系统目录选择器」的 `onPickBookDir` / `onListBookFilesInDir` 连同
                 *    只服务它们的 `onListLibraryBooks` **一并退场**（用户：那枚图标「怎么是选文件夹关联的，
                 *    统一成检索关联」+ 问答裁定「两处一起改」）⇒ 三个 prop 与对应宿主方法都已删。
                 */
                onSearchLocalBook: (q: LocalBookSearchQuery) => this.plugin.searchLocalBookFile(q),
                /** 🔴 #534 游戏「检索本地」：同样**先弹系统目录选择器**，再在选中目录里找同名**可启动文件**（.lnk/.exe/.bat…） */
                onPickGameDir: () => this.plugin.pickGameDirPath(),
                onListGameLaunchFilesInDir: (dir: string) => this.plugin.listGameLaunchFilesInDir(dir),
                onScanEpisodeDir: (dir: string) => this.plugin.scanEpisodeDir(dir),
                /** 🔴 #563 编辑浮层「本地路径」旁那枚**单集本地检索**：按条目类型去设置里的分类目录递归找当前集
                 *  （与上面几条「先选目录再找」不同 —— 它**不问用户**，目录来自设置页） */
                onSearchLocalEpisode: (o: LocalEpisodeQuery) => this.plugin.searchLocalEpisode(o),
                /** 书籍「进度页数」自动关联：探针本地书籍文件基准（PDF → numPages；TXT → 按章节解析 totalChapters；EPUB/失败 → undefined） */
                onProbeBookPages: (path: string) => this.plugin.probeBookPages(path),
                /** 编辑表单「阅读」：打开书籍阅读器（TXT 立即读入；EPUB 后置），关闭后返回最新阅读进度供表单同步 */
                onOpenReader: () => (this.entry ? this.plugin.openBookReader(this.entry) : Promise.resolve(undefined)),
                /** 编辑表单「▶ 启动」：启动游戏（编辑模式挂载当前条目；新增模式提示先保存） */
                onLaunchGame: () => {
                    if (this.entry) void this.plugin.launchGame(this.entry);
                    else new Notice('保存后可启动游戏', 3000);
                },
                /** 编辑表单「▶ 播放」：播放音乐音频（编辑模式挂载当前条目；新增模式提示先保存） */
                onPlayMusic: () => {
                    if (this.entry) void this.plugin.playAudioEntry(this.entry);
                    else new Notice('保存后可播放音频', 3000);
                },
                /** 编辑表单 LRC 框初值：从笔记 ` ```lrc ` 块读回（#396；真源 `pure/lrcSource`，与播放器同一份口径） */
                initialLrc,
                /** 编辑表单「获取歌词」：在线检索四个源（桌面端；移动端宿主返回空档） */
                onSearchLyrics: (t: string, a: string) => this.plugin.searchOnlineLyrics(t, a),
                /** 编辑表单候选「填入」：取该源该条的歌词正文 */
                onLoadLyric: (source: LyricSourceId, id: string) => this.plugin.fetchOnlineLyric(source, id),
                /**
                 * 🔴 #507 LRC 双语歌词（用户：「为当前 LRC 歌词 AI 搜索并生成双语歌词
                 * `[00:15.16]hello | 你好` 格式，入口排在**搜歌词图标按钮旁边**」）。
                 * 走「AI集成 › 用途 · 翻译服务」的服务商与 Key（⛔ 不为它单开一套凭据）——
                 * 与 `onAiSummarize` 同款：只把调用包一层传进组件，门控/提示都在宿主那侧。
                 * ⚠️ 返回**合并后的整份 LRC**（时间标签原样保留）；写回表单由组件负责。
                 */
                onAiBilingualLrc: (lrc: string, meta?: { title?: string; artist?: string }) =>
                    this.plugin.aiBilingualLyrics(lrc, meta),
                /**
                 * #500③ 集编辑浮层「网络地址」旁的「B站」：搜索候选（复用**音乐下载那条 B 站搜索链** ——
                 * 同一个 `pure/dl/bilibili` 解析、同一个 `services/dl/bilibili` 两步请求与 `buvid3` 缓存）。
                 * ⛔ 只取候选，**不下载**（下载是音乐下载弹窗那条路的职责）。
                 * 🔴 门控在宿主那侧（`dlBiliSearch` 自己判 `Platform.isDesktopApp` 并给「仅桌面端支持」），
                 *    组件里不重复判断。
                 */
                onBiliSearch: (keyword: string) => this.plugin.dlBiliSearch(keyword),
                /**
                 * #505 分P 勾选表：拿一条视频的**分P 列表**（用户 2026-10-03 选的是「入口 C」——
                 * 点候选不是直接填，而是**展开它的分P 让用户勾**）。
                 * 🔴 实测驱动：搜索接口**不返回分P 数** ⇒「这一条是单P 还是 52P」只能点开才知道；
                 *    实测「熊出没」前 10 条里 6 条是多P（3 条正是 52P），所以这条路是真用得上的。
                 * ⚠️ 读不到分P（失败 / 单P）时组件**回落到「直接填这一条」**，⛔ 不把能用的路堵死。
                 */
                onBiliParts: (bvid: string) => this.plugin.dlBiliView(bvid),
                /**
                 * #529 书籍「检索在线书籍阅读」：搜**微信读书**网页版，回填在线阅读链接。
                 * ⛔ 只取候选（书名/作者/封面/评分 + `web/reader/<hash>`），**不下载、不解析正文**。
                 * 🔴 门控在宿主那侧（`searchWeread` 自判 `Platform.isDesktopApp` 并给文案），组件不重复判断。
                 */
                onSearchWeread: (keyword: string) => this.plugin.searchWeread(keyword),
                /**
                 * 🔴 #685（用户：「音乐也要加网络检索小图标按钮，参考弹出搜索b站视频链接回填就行了」）：
                 * 音乐「网络地址」标签行那枚 globe 的宿主出口 —— **在线曲库检索**。
                 * ⛔ 只回传候选（歌名 / 歌手·专辑 / 平台试听页链接），**不下载、不解析正文**。
                 * 🔴 与「快捷关联」弹窗那枚 globe **同一个出口**（`searchSongLibraryForAssociate`）⇒
                 *    两处口径必然一致（⛔ 别在组件里另拼一份四平台请求）。
                 */
                onSearchSongLibrary: (keyword: string) => this.plugin.searchSongLibraryForAssociate(keyword),
                /**
                 * 🔴 #527 / #531 链接失效状态（**只读注入**）：从宿主内存缓存读一次 ——
                 * 缓存由「设置 › 基本设置 › 封面与清理 › 失效链接检测」扫**全库**时写入。
                 * ⛔ 本弹窗不再提供检测入口（用户 2026-10-05 指令：按钮挪到设置页）。
                 */
                linkStatuses: this.entry ? this.plugin.getLinkStatuses(this.entry.id) : [],
                /**
                 * ⑤-c 下载歌曲：**仅桌面端 + 「启用内置音乐播放器」开启时**才给按钮。
                 * 移动端没有 Node http ⇒ 显示了也必然失败，不如不给（与「获取歌词」同口径）。
                 * 🔴 #399 起门控真源由 `musicDownloadEnabled` 换成 `audioInlinePlayer` ——
                 *    一个开关同时管「笔记内 lrc 播放器」与「下载按钮」，用户要求「关闭后不显示下载按钮」。
                 * 🔴 #464：门控口径上移到宿主 `canUseAudioDownload()`（**单一真源**）——
                 *    同一枚开关现在还管「在线曲库」结果栏（音乐搜索里的歌曲栏，走的正是下载那条四平台链），
                 *    两处各写一遍 `Platform.isDesktopApp && settings.audioInlinePlayer` ⇒ 必然出现
                 *    「按钮亮着、曲库栏却永远空」这类不一致。
                 */
                canDownload: this.plugin.canUseAudioDownload(),
                /* 🔴 #538 在线曲库栏的**独立开关**（用户：「设置项可选择开启或关闭新增音乐条目『在线曲库』的搜索，
                   默认关闭」）。与 `canDownload` **不是同一件事**：
                   · `canDownload` = 能力（桌面端 + 内置音乐播放器）⇒ 管表单「下载歌曲」按钮；
                   · `songLibraryEnabled` = 能力 ∧ 用户开关（`canUseSongLibrary()`，单一真源）⇒ 管「在线曲库」那一栏。
                   ⛔ 别再让曲库栏共用 `canDownload`。 */
                songLibraryEnabled: this.plugin.canUseSongLibrary(),
                onOpenDownloader: (t: string, a: string, onPicked: (relPath: string) => void) =>
                    this.plugin.openMusicDownloader(t, a, onPicked),
                /* 🔴 #523：书籍下载那一套接线（两个门控 prop + 一个写回回调）按用户 2026-10-04 裁定
                   「下载只保留音乐」**整块撤除** —— 书籍「路径」旁不再有下载按钮（门控真源 `pure/featureGate`
                   的封禁清单已同步改写）。⚠️ 下载实现本体（`BookDownload.svelte` / 插件那支 open…Downloader
                   方法 / 书源服务）与两条命令面板入口原样保留；「库内同名书籍检索」照旧注入。
                   ⚠️ 被删那三处标识符的全名**刻意不写**：注释会进产物，抄了会撞红反向守卫（本仓老坑）。 */
                /**
                 * #404：**库内音乐目录**下的音频清单（「本地音频」浮层里那枚「检索同名音频」按钮用）。
                 * 🔴 目录与扩展名真源都在宿主（`listLibraryAudioFiles`）—— 组件只拿去和条目标题比对，
                 *    ⛔ 组件不碰 vault、也不自己拼目录。
                 */
                onListLibraryAudio: () => this.plugin.listLibraryAudioFiles(),
                /**
                 * #497 改关联音频文件的名字（用户：「再添加在音乐条目上修改关联的音频文件名称的功能」）。
                 * 🔴 全部动作在宿主（`main.renameEntryAudio`：库内/库外分流 + 同名 `.lrc` 一起改 + 回写条目与笔记），
                 *    这里只做两件**界面侧**的事：把当前条目 id 传下去（新增态传 `null`）、成功后把
                 *    `this.entry.audioPath` 同步成新路径 —— 否则弹窗侧缓存的条目还指着旧路径，
                 *    后续任何基于它的判断（外部改过没有 / 冲突比对）都拿的是过期的关联。
                 */
                onRenameAudio: async (currentPath: string, newStem: string) => {
                    const r = await this.plugin.renameEntryAudio(this.entry?.id ?? null, currentPath, newStem);
                    if (r.ok && r.path && this.entry) this.entry.audioPath = r.path;
                    return r;
                },
                /**
                 * 🔴 #402 下载后**自动关联到条目**（用户：「下载后的音频需能自动关联到对应的音乐类型条目」）。
                 * 编辑态直接写回 catalog 的 `audioPath`；`service.update` 是**按字段合并**（`{...prev, ...patch}`），
                 * 不会冲掉用户在表单里还没提交的其它改动。新增态还没有条目可写 ⇒ 静默返回（仍走「保存」提交）。
                 * ⚠️ 笔记被外部改过时**不重写**（与 `onSubmit` 的冲突口径一致）—— 那只更新字段，别覆盖用户手改。
                 */
                onApplyAudio: async (relPath: string) => {
                    const target = this.entry;
                    if (!target) return;
                    try {
                        await this.plugin.service.update(target.id, { audioPath: relPath });
                        target.audioPath = relPath;
                        if (target.notePath && !(await this.plugin.service.noteWasExternallyModified(target.id))) {
                            await this.plugin.service.writeNote(target.id);
                        }
                        await this.plugin.refreshViews();
                        new Notice(`已关联到「本地音频」：${relPath}`, 4000);
                    } catch (e) {
                        new Notice(`音频已下载，但写回条目失败：${e instanceof Error ? e.message : String(e)}`, 5000);
                    }
                },
                /** 拖入本地图片上传为封面：返回相对路径（covers/xxx） */
                onUploadPoster: (file: File) => this.plugin.uploadPoster(file),
                /** 解析封面字符串为可显示地址（http 直用 / 本地路径映射 vault 资源） */
                onResolvePoster: (p: string) => this.plugin.resolvePosterUrl(p),
                /** 豆瓣封面防盗链：下载远程豆瓣图片到本地（按标题命名），返回相对路径；记录到会话集合供未保存时清理 */
                onDownloadPoster: async (url: string, title: string) => {
                    const rel = await this.plugin.downloadPosterToLocal(url, title);
                    if (rel) this.downloadedPosters.add(rel);
                    return rel;
                },
                /**
                 * #498「从网络搜索封面」（用户：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」）。
                 * 🔴 两条纪律：
                 *  ⑴ 下载下来的封面要进 `downloadedPosters` —— 与「豆瓣封面本地化」「更换本地图片」**同一本账**：
                 *     用户最后**取消弹窗 / 换掉封面**时，`cleanupOrphanedPosters` 才会把它清掉，
                 *     ⛔ 不记账 = 每次点一张就在 `封面/` 里留一个没人引用的文件。
                 *  ⑵ `apply(relPath)` 是**表单侧传进来的写入口**（改 `poster` 字段），⛔ 弹窗不直接碰表单。
                 */
                onOpenPosterSearch: (
                    query: string,
                    title: string,
                    apply: (relPath: string) => void,
                    platformQuery?: string,
                    sources?: PosterSource[],
                ) => {
                    new PosterSearchModal(
                        this.app,
                        {
                            search: (source: PosterSource, q: string, page: number) =>
                                this.plugin.searchPosterCandidatesBySource(source, q, page),
                            download: (c: PosterCandidate) => this.plugin.downloadSearchedPoster(c, title),
                        },
                        {
                            // 🔴 #509 两套默认词**分开给**：必应要「标题 + 类型词」、平台要「标题 + 作者」
                            queries: { bing: query, netease: platformQuery, qq: platformQuery, kugou: platformQuery, kuwo: platformQuery },
                            // 表单侧决定可用来源（音乐 = 五个；其它类型只有网络搜索）
                            sources: sources?.length ? sources : ['bing'],
                            onPicked: (relPath: string) => {
                                this.downloadedPosters.add(relPath);
                                apply(relPath);
                            },
                        },
                    ).open();
                },
            },
        });
        // 🔴 #635 绑定组件实例 —— 这就是 `<EntryForm bind:this={form} />` 编译出来的那一句。
        //    没有它，`EntryForm` 的 `export function`（`isDirty()` / `repeatAddState()`）会在编译期
        //    被摇成 `function isDirty() { return false; }`（本批实测：脏检查恒不拦）。
        //    ⚠️ `bind` 会**立即回调一次**当前值，故它必须跟在构造之后、且不能用它覆盖 `this.form`。
        if (this.form) bindComponent(this.form, 'form', () => undefined);
    }

    /**
     * 🔴 #668 归档说明：「点关联条目 ⇒ 在同一个弹窗里切到那条继续编辑」（#635 的 `openRelated`）**已整体退场** ——
     * 用户裁定「编辑条目的关联功能区全部给我移除掉吧归档下未来实现」。
     * ⚠️ 重新实现时注意那两条当年踩出来的硬结论（留在这里免得再踩）：
     *   ① 切换必须**同时换 `this.entry`**，否则界面是 B、保存却写进 A；
     *   ② 切换前要**脏检查**（`form.isDirty()` + `ConfirmModal`），且重建走 `mountForm`、笔记覆盖值走
     *      `readEntryForForm`（与 `onOpen` 同一份口径）。
     */

    /** 清理本次会话下载但未被条目引用的本地封面：用户取消/未保存 → 全部删除；保存成功 → 仅保留条目实际引用的那张。
     *  删除失败静默（文件可能已被外部移除），尽力而为。 */
    private async cleanupOrphanedPosters(): Promise<void> {
        const keep = this.saved ? this.savedPoster : undefined;
        const orphans = orphanedDownloadedPosters(Array.from(this.downloadedPosters), keep);
        for (const rel of orphans) {
            try {
                const full = normalizePath(`${this.plugin.settings.libraryDir}/${rel}`);
                const f = this.app.vault.getAbstractFileByPath(full);
                if (f instanceof TFile) await this.app.vault.delete(f);
            } catch {
                // 文件不存在/删除失败：忽略
            }
        }
        this.downloadedPosters.clear();
    }

    /**
     * 🔴 #632 连续添加：**新建**条目保存成功后的收口 —— 弹窗不关，回到候选列表继续挑（替代 #631 那套独立批量弹窗）。
     *
     * 三步（顺序有讲究）：
     *   ① 从**旧实例**收下会话状态（候选 / 关键词 / 刚挑的那条 / 系列两栏）—— `$destroy()` 之后就取不到了；
     *   ② 把刚建的那条记为「已添加」，并把序号 +1（系列名留着：一次填好连编 13 部）；
     *   ③ 重建表单（`mountForm`）⇒ `picked=false`，直接回到候选列表。
     *
     * ⚠️ 只在**新建态**被调用（编辑态走 `close()`）—— 所以不需要判 `this.entry`。
     */
    private repeatAdd(): void {
        const st = this.form?.repeatAddState();
        if (st) {
            if (st.addedKey) this.addedHits.add(st.addedKey);
            // 序号跨次继承 + 自动 +1（`'2'` → `'3'`；空 / 非纯数字原样返回 —— 见 `tests/repeatAdd.test.ts`）
            this.repeat = { ...st, seriesIndex: nextSeriesIndexLabel(st.seriesIndex) };
        }
        new Notice('已保存，可继续挑下一条', 2000);
        this.mountForm(null, '');
    }

    /**
     * ⑬ 把本次搜索结果并进**本实例的**桶（新的在前、按 `resultKeyOf` 去重、截断到 `SEARCH_POOL_KEEP`），
     * 返回合并后的完整列表给表单渲染。
     *
     * 🔴 用户 2026-10-25 口径：「保存逻辑仅搜索完毕不关闭窗口才保存，退出再重新搜索为清除」——
     *   所以这里**只动内存**：`searchPool` 是实例字段，弹窗关掉就没人持有它了。
     *   ⛔ 别再往 `plugin` / vault / data.json 里写：那正是被用户否掉的「跨会话持久化」。
     * ⚠️ 与 `pure/searchAccum.mergeSearchResults` 的分工：合并算法归纯模块（可单测），
     *   本方法只负责「按桶取旧值 → 合并 → 存回桶」这三步簿记。
     */
    private mergeSearchPool(type: EntryType, bookKind: BookKind | undefined, fresh: readonly SearchResult[]): SearchResult[] {
        const bucket = searchBucketKey(type, bookKind);
        const merged = mergeSearchResults(bucketOf(this.searchPool, bucket), fresh, SEARCH_POOL_KEEP);
        this.searchPool = withBucket(this.searchPool, bucket, merged);
        return merged;
    }

    onClose(): void {
        void this.cleanupOrphanedPosters();
        this.form?.$destroy();
        this.form = null;
        // ⑬ 会话内累积池随实例一起退场（用户口径：「退出再重新搜索为清除」）——
        //    显式清一次是为了让「已释放」这件事在读代码时看得见，而不是只靠 GC 丢对象。
        this.searchPool = {};
        // 释放插件侧的弹窗引用（防叠加守卫用；仅当仍是本实例时清除）
        if (this.plugin.entryModal === this) this.plugin.entryModal = null;
    }

    /** 删除条目（编辑模式）：确认与删除统一走 plugin.deleteEntry（Modal 确认，替代 window.confirm 防焦点竞争） */
    private async deleteEntry(): Promise<void> {
        if (!this.entry) return;
        await this.plugin.deleteEntry(this.entry.id);
        this.close();
    }
}
