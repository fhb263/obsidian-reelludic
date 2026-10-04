// 添加/编辑条目弹窗（Douban/TMDB/Bangumi 搜索回填 + 手动覆盖）
import { App, Modal, Notice, Platform, TFile, normalizePath } from 'obsidian';
import EntryForm from 'views/components/EntryForm.svelte';
import type ReelLudicPlugin from '../../main';
import type { TmdbSearchResult } from 'services/tmdb';
import type { EntryType, MediaEntry } from 'data/types';
import { SOURCE_VIEW } from 'pure/searchDisplay';
import { extractEditableFromNote, extractFrontmatterFromNote } from 'pure/noteEditable';
import { lrcBlockLyrics } from 'pure/lrcSource';
import { orphanedDownloadedPosters } from 'pure/posterFile';
import { NoteConflictModal } from 'modals/NoteConflictModal';
import { PosterSearchModal } from 'modals/PosterSearchModal';
import type { PosterCandidate } from 'pure/posterSearch';
import type { PosterSource } from 'pure/posterSources';
import type { SearchProgressCb } from 'pure/searchProgress';
import type { BookKind } from 'data/types';
import type { AiSummaryInput } from 'pure/aiSummary';
import type { AiPrefillInput } from 'pure/aiPrefill';
import type { LyricSourceId } from 'pure/lyricOnline';
import type { SourceKind } from 'pure/sourceRule';
import { BOOK_DOWNLOAD_ENABLED } from 'pure/featureGate';

export class EntryModal extends Modal {
    private form: EntryForm | null = null;
    /** 本次会话 douban 封面下载的本地相对路径集合（保存失败/取消时清理孤儿文件，防止 封面/ 残留垃圾） */
    private downloadedPosters = new Set<string>();
    /** 保存是否成功（onClose 时决定：清理全部 vs 仅保留被条目引用的那张） */
    private saved = false;
    /** 保存成功时条目实际引用的封面相对路径（未保存/封面被清空时为 undefined） */
    private savedPoster?: string;

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
        // 设置「隐藏插件内滚动条」开启时，编辑弹窗内部滚动条一并隐藏（rl-hide-scroll 作用于自身及后代）
        if (this.plugin.settings.hideScrollbars) this.modalEl.addClass('rl-hide-scroll');
        // 编辑模式：catalog 是结构化数据源，但用户可能直接在笔记里手动编辑过
        // 「个人评语/观看·相关链接/简介/作者简介/目录」与顶部 frontmatter（评分/状态/年份/进度等）——
        // 打开表单时读笔记覆盖 catalog 值，避免内容"消失"（全类型通用）
        let effective = this.entry;
        /** 打开音乐条目时从笔记 ` ```lrc ` 块读回的歌词正文（#396；表单 LRC 框初值） */
        let initialLrc = '';
        if (this.entry?.notePath) {
            try {
                const f = this.app.vault.getAbstractFileByPath(this.entry.notePath);
                if (f instanceof TFile) {
                    const text = await this.app.vault.read(f);
                    initialLrc = lrcBlockLyrics(text);
                    const ext = extractEditableFromNote(text);
                    const fm = extractFrontmatterFromNote(text);
                    if (ext.notes !== undefined || ext.links || ext.summary !== undefined || ext.authorIntro !== undefined || ext.toc !== undefined || ext.aiSummary !== undefined || ext.aiHighlights !== undefined || ext.sourceUrl !== undefined || Object.keys(fm).length > 0) {
                        // banner（frontmatter 为库内完整路径，如 媒体库/封面/xx.jpg）→ poster（相对路径 封面/xx.jpg）
                        let poster = fm.poster;
                        if (poster && !/^https?:\/\//.test(poster)) {
                            const dir = (this.plugin.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
                            if (poster.startsWith(dir + '/')) poster = poster.slice(dir.length + 1);
                        }
                        effective = {
                            ...this.entry,
                            notes: ext.notes ?? this.entry.notes,
                            links: ext.links ?? this.entry.links,
                            summary: ext.summary ?? this.entry.summary,
                            authorIntro: ext.authorIntro ?? this.entry.authorIntro,
                            toc: ext.toc ?? this.entry.toc,
                            aiSummary: ext.aiSummary ?? this.entry.aiSummary,
                            aiHighlights: ext.aiHighlights ?? this.entry.aiHighlights,
                            source: ext.source ?? this.entry.source,
                            sourceUrl: ext.sourceUrl ?? this.entry.sourceUrl,
                            ...fm,
                            // frontmatter 无 history 字段：进度合并保留条目既有追更历史，避免保存时清空
                            progress: fm.progress
                                ? { ...(this.entry.progress ?? { season: 1, episode: 0, history: [] }), ...fm.progress, history: this.entry?.progress?.history ?? [] }
                                : this.entry.progress,
                            poster: poster ?? this.entry.poster,
                        };
                    }
                }
            } catch {
                // 笔记不可读：忽略，沿用 catalog 值
            }
        }
        this.form = new EntryForm({
            target: this.contentEl,
            props: {
                entry: effective,
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
                onFetchDetail: (r: TmdbSearchResult) => this.plugin.fetchTmdbDetail(r),
                // 豆瓣兜底结果：点击时按需拉详情补全表单字段（搜索仅前 3 条预补全）
                onFetchDoubanDetail: (id: string, type: EntryType) => this.plugin.fetchDoubanDetailForEntry(id, type),
                // Bangumi 选中结果按需补全（persons+subjects API → 导演/评分/主演）
                onFetchBangumiDetail: (id: number) => this.plugin.fetchBangumiDetailForEntry(id),
                // Open Library 书籍选中结果按需补全（works.json → 简介/页数/出版社；失败 null 静默）
                onFetchOpenLibraryDetail: (key: string) => this.plugin.fetchOpenLibraryDetailForEntry(key),
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
                        if (saved) this.close();
                        await this.plugin.refreshViews();
                    }
                },
                onDelete: () => this.deleteEntry(),
                onCancel: () => this.close(),
                /** 书籍编辑表单「添加摘抄」：固定挂载当前条目打开摘抄弹窗 */
                onAddExcerpt: () => {
                    if (this.entry) this.plugin.openExcerptModal(this.entry);
                },
                /** 游戏编辑表单「记录游玩」：固定挂载当前游戏打开游玩记录弹窗 */
                onRecordPlaySession: () => {
                    if (this.entry) this.plugin.openGameSessionModal(this.entry);
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
                /** 编辑表单书籍「浏览」：系统文件选择器选 TXT/EPUB，返回 vault 相对路径 */
                onPickBookFile: () => this.plugin.pickBookFilePath(),
                onPickVideoDir: () => this.plugin.pickVideoDirPath(),
                onScanEpisodeDir: (dir: string) => this.plugin.scanEpisodeDir(dir),
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
                onOpenDownloader: (t: string, a: string, onPicked: (relPath: string) => void) =>
                    this.plugin.openMusicDownloader(t, a, onPicked),
                /**
                 * 🔴 #414 书籍下载：门控**只有桌面端**（书籍面没有对应的功能开关；与音乐那枚不同，
                 *    ⛔ 别把 `audioInlinePlayer` 套过来，那是音乐面的开关）。
                 * 🔴 #468 封禁：门控真源上移到 `pure/featureGate.BOOK_DOWNLOAD_ENABLED`（用户 2026-10-01
                 *    「把下载网文和文学类的入口都封禁掉…规划到未来再解禁」）⇒ 表单那枚
                 *    「下载网文 / 下载文学」按钮不再渲染。解禁 = 翻那一个布尔值，⛔ 别在这里另写条件。
                 *    ⚠️ 桌面端判据**保留在右侧**（两件同时成立才给按钮）。
                 */
                canDownloadBook: BOOK_DOWNLOAD_ENABLED && Platform.isDesktopApp,
                /** #422：`kind` 由表单按当前 `bookKind` 给出（文学 / 网文），决定弹窗优先用哪一类书源
                 *  ⛔ #422 续四：`title` / `author` 两个参数已随「粘贴直链」删除（那只为直链预填文件名） */
                onOpenBookDownloader: (onPicked: (relPath: string, tocText?: string) => void, kind: SourceKind) =>
                    this.plugin.openBookDownloader(onPicked, kind),
                /**
                 * 🔴 #414 下载后**自动关联到条目**（与上面 `onApplyAudio` 同一口径）：
                 *    编辑态写回 catalog 的 `bookFile`（按字段合并，不会冲掉表单里未提交的改动）；
                 *    新增态还没有条目 ⇒ 静默返回（仍走「保存」提交，表单框已由 `onPicked` 填好）。
                 *    ⚠️ 笔记被外部改过时**不重写**（与 `onSubmit` 的冲突口径一致）。
                 * 🔴 P1-C 追加 `tocText`：章节名清单 —— **只在文学条目**给得到（网文按 09-13 裁定不带
                 *    出版目录，表单连框都不渲染、保存时还会清空）。⚠️ 没给就**不碰这个字段**：
                 *    `update` 是按字段合并，写 `undefined` 等于把存量 `toc` 清掉。
                 */
                onApplyBook: async (relPath: string, tocText?: string) => {
                    const target = this.entry;
                    if (!target) return;
                    try {
                        await this.plugin.service.update(
                            target.id,
                            tocText ? { bookFile: relPath, toc: tocText } : { bookFile: relPath },
                        );
                        target.bookFile = relPath;
                        if (tocText) target.toc = tocText;
                        if (target.notePath && !(await this.plugin.service.noteWasExternallyModified(target.id))) {
                            await this.plugin.service.writeNote(target.id);
                        }
                        await this.plugin.refreshViews();
                        new Notice(`已关联到「书籍文件」：${relPath}`, 4000);
                    } catch (e) {
                        new Notice(`书籍已下载，但写回条目失败：${e instanceof Error ? e.message : String(e)}`, 5000);
                    }
                },
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
                 * #417：**库内书籍文件**清单（书籍「书籍文件」浮层那枚 🔍 用）。
                 * 🔴 与上面那枚同族同位、同一套形态：宿主给清单、组件只拿去和条目书名比对。
                 * ⚠️ 扫全库（不像音频那样限定目录）—— 用户可能把书放在自己建的文件夹里。
                 */
                onListLibraryBooks: () => this.plugin.listLibraryBookFiles(),
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
    }

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

    onClose(): void {
        void this.cleanupOrphanedPosters();
        this.form?.$destroy();
        this.form = null;
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
