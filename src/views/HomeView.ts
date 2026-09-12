// 统一视图（书架 + 追番表页签）：单 ItemView 承载 HomeView.svelte，页签切换由组件内部完成
import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import HomeViewSvelte from 'views/components/HomeView.svelte';
import { CalendarDayModal } from 'modals/CalendarDayModal';
import { ConfirmModal } from 'modals/ConfirmModal';
import { ImportBangumiModal } from 'modals/ImportBangumiModal';
import type ReelLudicPlugin from '../../main';
import type { MediaStatus } from 'pure/status';
import type { ActivityEvent, EntryType, MediaEntry } from 'data/types';
import type { HomeTab } from './tab';
import type { FeedRange } from 'pure/activityFeed';

export const HOME_VIEW_TYPE = 'reelludic-home';

export class HomeView extends ItemView {
    private component: HomeViewSvelte | null = null;
    /** 条目数据源（render 加载后维护，乐观更新也用此引用） */
    private entries: MediaEntry[] = [];

    constructor(leaf: WorkspaceLeaf, private plugin: ReelLudicPlugin) {
        super(leaf);
    }

    getViewType(): string {
        return HOME_VIEW_TYPE;
    }

    getDisplayText(): string {
        // 顶部名称动态跟随「媒体库目录」设置（v0.4 持续优化）；空值回退默认名
        return this.plugin.settings.libraryDir?.trim() || 'ReelLudic';
    }

    getIcon(): string {
        return 'library';
    }

    async onOpen(): Promise<void> {
        await this.render();
    }

    async onClose(): Promise<void> {
        this.component?.$destroy();
        this.component = null;
    }

    async refresh(): Promise<void> {
        await this.render();
    }

    private async render(): Promise<void> {
        const [entries, excerptCounts, yearReports, activityLog] = await Promise.all([
            this.plugin.service.list(),
            this.plugin.excerptCounts(),
            this.plugin.listYearReports(),
            this.plugin.listActivity(),
        ]);
        this.entries = entries;
        // 隐藏插件内滚动条（外观设置）：类挂容器，CSS 隐藏内部滚动条
        this.contentEl.toggleClass('rl-hide-scroll', this.plugin.settings.hideScrollbars);
        if (this.component) {
            // 增量更新：保留组件实例与本地状态（当前 Tab/视图模式/筛选），仅刷新数据，立即生效
            this.component.$set({ entries, colorTheme: this.plugin.settings.colorTheme, defaultViewMode: this.plugin.settings.defaultViewMode, excerptCounts, yearReports, activityLog });
            return;
        }
        this.contentEl.empty();
        this.component = new HomeViewSvelte({
            target: this.contentEl,
            props: {
                entries,
                excerptCounts,
                yearReports,
                activityLog,
                initialTab: this.plugin.homeTab,
                colorTheme: this.plugin.settings.colorTheme,
                defaultViewMode: this.plugin.settings.defaultViewMode,
                onTabChange: (tab: HomeTab) => {
                    this.plugin.homeTab = tab;
                },
                posterUrl: (e: MediaEntry) => this.plugin.resolvePoster(e),
                onAdd: (t?: EntryType) => this.plugin.openAddModal(t),
                onSelectDay: (dateStr: string) => new CalendarDayModal(this.app, this.plugin, dateStr, this.entries).open(),
                /** 月历拖拽排期：待排卡片拖到日期格 → 设置计划观看日期 */
                onPlanDate: (id: string, dateStr: string) => this.plugin.planEntry(id, dateStr),
                onEditEntry: (id: string) => void this.plugin.openEditModal(id),
                onOpenEntry: (id: string) => this.plugin.openEntryNote(id),
                onOpenLink: (url: string) => this.plugin.openExternalUrl(url),
                /** 海报墙「观看/播放/启动」按钮：书籍 → 阅读器；游戏 → 启动 .lnk；音乐 → 播放音频；影视 → 单链接直接打开/多链接弹窗选择播放源 */
                onWatch: (e: MediaEntry) => {
                    if (e.type === 'book') void this.plugin.openBookReader(e);
                    else if (e.type === 'game') void this.plugin.launchGame(e);
                    else if (e.type === 'music') void this.plugin.playAudioEntry(e);
                    else void this.plugin.openWatchLinkPicker(e);
                },
                /** 右键「动词 · 去关联」直达：无入口 → 快捷关联弹窗（书/游戏/音乐路径；影视选集网络/本地源） */
                onQuickAssociate: (e: MediaEntry) => this.plugin.quickAssociateEntry(e),
                onDeleteEntry: (id: string) => this.plugin.deleteEntry(id),
                /** 批量删除（多选）：一次 Modal 确认后逐条删（plugin.deleteEntries） */
                onBulkDelete: (ids: string[]) => this.plugin.deleteEntries(ids),
                /** 书籍卡片右键「添加摘抄」：固定挂载该书打开摘抄弹窗 */
                onAddExcerpt: (book: MediaEntry) => this.plugin.openExcerptModal(book),
                /** 游戏卡片右键「记录游玩」：固定挂载该游戏打开游玩记录弹窗 */
                onOpenGameSessionModal: (game: MediaEntry) => this.plugin.openGameSessionModal(game),
                /** 批量评分 / 批量追加标签 */
                onBulkRating: (ids: string[], rating: number) => this.plugin.bulkSetRating(ids, rating),
                onBulkTags: (ids: string[], tags: string[]) => this.plugin.bulkAddTags(ids, tags),
                /** 批量应用前置确认（批B）：文案由 pure/bulkConfirm 生成，这里只负责弹窗取用户意图 */
                onConfirmBulk: (message: string) => new ConfirmModal(this.app, message, '继续').open(),
                onSetStatus: async (id: string, s: MediaStatus) => {
                    // 乐观更新：先本地 $set（一帧内 ~10ms 反映新状态），再后台落盘；
                    // 成功后用落盘结果（含最新 updatedAt）对齐本地 entries——排序/计数即刻精确，
                    // 不依赖 500ms vault 监听兜底；失败回滚并提示
                    this.applyLocalStatus(id, s);
                    try {
                        const merged = await this.plugin.service.setStatus(id, s);
                        this.applyMergedEntry(merged);
                    } catch (e) {
                        new Notice('状态保存失败：' + (e instanceof Error ? e.message : String(e)));
                        await this.plugin.refreshViews();
                    }
                },
                onMarkUpdated: async (id: string) => {
                    await this.plugin.service.markUpdated(id);
                    await this.plugin.refreshViews();
                },
                /** 网站更新检测：抓观看网址 HTML 提取最新集数（结果 10min 缓存；force=true 跳过缓存供「重新检测」） */
                onCheckUpdate: (url: string, watched: number, force?: boolean) => this.plugin.checkUpdateFor(url, watched, force),
                /** A2 落库：检测到新最新集写回条目（仅落库不重写笔记；失败静默——不影响追更表展示） */
                onSaveLatestKnown: async (id: string, latestEpisode: number) => {
                    try {
                        await this.plugin.service.update(id, { latestKnownEpisode: latestEpisode });
                    } catch {
                        // 落库失败静默：去重基线不持久化，下次进视图重新检测即可
                    }
                },
                /** 追番表「从 Bangumi 导入」：打开导入弹窗（用户 ID 可选，勾选列表逐项导入） */
                onImportBangumi: () => {
                    new ImportBangumiModal(
                        this.app,
                        (userId, types, onProgress) => this.plugin.importBangumiCollections(userId, types, onProgress),
                    ).open();
                },
                /** 排期到期横幅「开始观看」：want→watching（复用状态流转，排期日期保留） */
                onStartWatching: async (id: string) => {
                    try {
                        await this.plugin.service.setStatus(id, 'watching');
                        await this.plugin.refreshViews();
                    } catch (e) {
                        new Notice('状态保存失败：' + (e instanceof Error ? e.message : String(e)));
                    }
                },
                /** 生成年度总结（统计页快捷入口） */
                onGenerateReport: () => this.plugin.generateReport(),
                /** 一键把动态写进当天日记：范围跟随统计页「动态」面板的 日/周/月/年 切换 */
                onRecordJournal: (range: FeedRange) => this.plugin.recordTodayJournal(range),
                /** 打开某份年度报告（统计页「往年报告」入口） */
                onOpenReport: (path: string) => void this.plugin.openReport(path),
            },
        });
    }

    /** 乐观更新：直接修改本地 entries 并 $set 触发 Svelte 重渲染，用于状态徽标即时变色 */
    private applyLocalStatus(id: string, status: MediaStatus): void {
        if (!this.component) return;
        this.entries = this.entries.map((e) => (e.id === id ? { ...e, status } : e));
        this.component.$set({ entries: this.entries });
    }

    /** 落盘结果对齐：用服务端返回的 merged（含最新 updatedAt/status）替换本地对应条目，保证排序与计数精确同步 */
    private applyMergedEntry(merged: MediaEntry): void {
        if (!this.component) return;
        const idx = this.entries.findIndex((e) => e.id === merged.id);
        if (idx < 0) {
            this.entries = [...this.entries, merged];
        } else {
            this.entries = this.entries.map((e) => (e.id === merged.id ? merged : e));
        }
        this.component.$set({ entries: this.entries });
    }
}
