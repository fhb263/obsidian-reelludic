// 添加/编辑条目弹窗（Douban/TMDB/Bangumi 搜索回填 + 手动覆盖）
import { App, Modal, Notice, TFile, normalizePath } from 'obsidian';
import EntryForm from 'views/components/EntryForm.svelte';
import type ReelLudicPlugin from '../../main';
import type { TmdbSearchResult } from 'services/tmdb';
import type { EntryType, MediaEntry } from 'data/types';
import { SOURCE_VIEW } from 'pure/searchDisplay';
import { extractEditableFromNote, extractFrontmatterFromNote } from 'pure/noteEditable';
import { orphanedDownloadedPosters } from 'pure/posterFile';
import { NoteConflictModal } from 'modals/NoteConflictModal';
import type { SearchProgressCb } from 'pure/searchProgress';

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
        if (this.entry?.notePath) {
            try {
                const f = this.app.vault.getAbstractFileByPath(this.entry.notePath);
                if (f instanceof TFile) {
                    const text = await this.app.vault.read(f);
                    const ext = extractEditableFromNote(text);
                    const fm = extractFrontmatterFromNote(text);
                    if (ext.notes !== undefined || ext.links || ext.summary !== undefined || ext.authorIntro !== undefined || ext.toc !== undefined || ext.sourceUrl !== undefined || Object.keys(fm).length > 0) {
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
                canSearch: !!this.plugin.settings.tmdbApiKey,
                canSearchBook: true,
                canSearchGame: true, // 游戏仅 Douban 源，始终可搜
                /** 结果栏数变化 → 动态宽度（仅三栏加宽） */
                onResultCols: (cols: number) => this.applyResultCols(cols),
                /** 该类型本次搜索实际会发起的源集合（固定占栏用） */
                onSourcesForType: (type: EntryType) => this.plugin.sourcesForType(type),
                onSearch: (q: string, t: 'movie' | 'tv', onProgress?: SearchProgressCb) => this.plugin.searchWithFallback(q, t, onProgress),
                onSearchBook: (q: string, onProgress?: SearchProgressCb) => this.plugin.searchBook(q, onProgress),
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
                onSubmit: async (input: Record<string, unknown>) => {
                    // 数据保存成功才关弹窗；笔记生成失败不阻断（条目已落库，仍刷新视图）
                    let saved = false;
                    try {
                        if (this.entry) {
                            const updated = await this.plugin.service.update(this.entry.id, input);
                            // 封面本地化开关开启且封面是 URL → 下载到 covers/ 并更新引用（失败静默，不影响保存）
                            if (this.plugin.settings.localizePosters && updated.poster && /^https?:\/\//.test(updated.poster)) {
                                await this.plugin.localizeEntryPoster(updated.id);
                            }
                            try {
                                // G 双写冲突：笔记被外部修改（手动编辑过）→ 弹窗二选一；「保留」跳过重写（catalog 已保存）
                                if (await this.plugin.service.noteWasExternallyModified(updated.id)) {
                                    const choice = await new NoteConflictModal(this.app, updated.title).open();
                                    if (choice === 'overwrite') await this.plugin.service.writeNote(updated.id);
                                } else {
                                    await this.plugin.service.writeNote(updated.id);
                                }
                                new Notice(`已更新：${updated.title}`);
                            } catch (e) {
                                new Notice(`已更新，但笔记生成失败：${e instanceof Error ? e.message : String(e)}`);
                            }
                        } else {
                            const entry = await this.plugin.service.create(input);
                            if (this.plugin.settings.localizePosters && entry.poster && /^https?:\/\//.test(entry.poster)) {
                                await this.plugin.localizeEntryPoster(entry.id);
                            }
                            try {
                                await this.plugin.service.writeNote(entry.id);
                                new Notice(`已添加：${entry.title}`);
                            } catch (e) {
                                new Notice(`已添加，但笔记生成失败：${e instanceof Error ? e.message : String(e)}`);
                            }
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
                /** 编辑表单游戏「启动快捷方式」：系统文件选择器选 .lnk，返回 vault 相对路径（库外绝对路径） */
                onPickGameLaunch: () => this.plugin.pickGameLaunchPath(),
                /** 编辑表单书籍「浏览…」：系统文件选择器选 TXT/EPUB，返回 vault 相对路径 */
                onPickBookFile: () => this.plugin.pickBookFilePath(),
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
