// 条目服务层：增删改查 + 状态流转 + 追更标记 + 笔记生成编排
// 纯逻辑：文件 IO 通过注入的 VaultIO 完成（obsidian 适配器在插件侧提供）
import type { ActivityEvent, BookKind, Catalog, EntryType, MediaEntry } from 'data/types';
import { CatalogStore, normalizeEntry, type VaultIO } from 'data/catalog';
import { writeSeriesRating, type SeriesRatingMap } from 'pure/seriesRating';
import { writeSeriesHidden, type SeriesHiddenMap } from 'pure/seriesHidden';
import { normalizeViews, type MediaView } from 'pure/mediaViews';
import { canTransition, type MediaStatus } from 'pure/status';
import { entryFrontmatter, entryNotePath, generateNoteMarkdown, hashNoteContent } from 'data/noteGenerator';
import {
    appendExcerptToNote,
    countExcerpts,
    extractAnnotationSections,
    mergeExcerptSection,
    removeExcerptBlock,
    replaceAnnotationSection,
    renderExcerptBlock,
    type ParsedExcerpt,
} from 'pure/excerpt';
import { dropsReadingProgress } from 'pure/bookProgress';
import { parseNoteMarks, type VideoMark } from 'pure/videoMarks';
import { HIGHLIGHT_SECTION } from 'pure/highlight';
import { WEREAD_NOTES_SECTION } from 'pure/wereadNotes';
import { RELATED_SECTION, extractRelatedSectionBody } from 'pure/noteEditable';
import { lrcBlockLyrics, withLrcLyrics } from 'pure/lrcSource';
import { DIR_NOTES } from 'pure/dirs';
// 1.3.1 ① 字段映射：写笔记时按用户配置改名（缺省恒等）
import { EMPTY_FIELD_MAP, compileFieldMapText, type CompiledFieldMap } from 'pure/fieldMap';
// 1.3.1 ① 第 3 件：各类型笔记属性顺序（按 `e.type` 取值后传给 entryFrontmatter）
import { resolveAllKindOrders, resolveAllOrders, resolveAllHidden } from 'pure/fieldOrder';
import { normalizeBookKind } from 'pure/bookKind';
// 短评缺省日期 = 本地今天（与「今日记录」同一口径：⛔ 别用 toISOString 的 UTC 日期）
import { todayLocal } from 'pure/dailyLog';

function notFound(id: string): Error {
    return new Error('entry not found: ' + id);
}

/**
 * 🔴 #635 笔记「## 关联」区的**重写保留**（`writeNote` 的保留区之一）。
 *
 * 三种情形（**顺序不能换**）：
 *  ⑴ 目录侧**没有**关联（模板写的是提示行）而旧笔记该区**有内容** ⇒ 把旧内容**搬回**
 *    （用户手改的关联是真数据；不搬 = 保存一次就没了）。
 *  ⑵ 目录侧**有**关联 ⇒ 以目录为准（模板已经写好），⛔ 不搬回旧内容 ——
 *    否则「在表单里加了一条关联 → 保存」会被旧笔记的关联区原样盖回去。
 *  ⑶ 旧笔记**没有**该区 ⇒ 什么都不做（模板自带）。
 *
 * 🔴 为什么判据是「目录侧有没有」而不是「两边是否不同」：目录是**结构化真源**，
 *    它能表达「没有关联」；笔记侧只有文本，判不出「用户删了这区」与「老笔记本来就没有这区」。
 */
function preserveRelatedSection(template: string, oldNote: string): string {
    const oldBody = extractRelatedSectionBody(oldNote);
    // 情形 ⑶ / 旧区为空：不动模板
    if (oldBody === null || oldBody === '') return template;
    // 情形 ⑵：模板该区已经有内容 ⇒ 目录说了算
    const templBody = extractRelatedSectionBody(template);
    if (templBody !== null && templBody !== '') return template;
    // 情形 ⑴：搬回
    return replaceAnnotationSection(template, RELATED_SECTION, oldBody);
}

export class EntryService {
    private store: CatalogStore;
    /** 1.3.1 ①：编译好的字段映射（构造时算一次）。设置一变 `main.rebuildService()` 就重建实例 ⇒ 不会过期。 */
    private fieldMap: CompiledFieldMap = EMPTY_FIELD_MAP;
    /** 1.3.1 ① 第 3 件：六个类型各自的属性写出顺序（同样构造时算一次）。 */
    private fieldOrders: Record<EntryType, string[]>;
    /**
     * 🔴🔴 #640e：**书籍三个子分类各自的顺序**（文学 / 网文 / 漫画）。
     * 书籍条目按自己的 `bookKind` 取；非书籍条目**用不到它**（走 `fieldOrders`）。
     * ⚠️ 回落链（`kind → fieldOrder.book → 缺省`）在 `pure/fieldOrder.orderForBookKind` 里，
     *    这里只负责**按 e 取用**。
     */
    private kindOrders: Record<BookKind, string[]>;
    /**
     * 🔴 #721：**各目标不写出的属性键**（设置页「笔记属性顺序」里删掉的那些）。
     * 目标键与设置页分页同口径：`'__global'` / `EntryType` / `'k:<BookKind>'`。
     * ⚠️ 与 `fieldOrders` / `kindOrders` 正交：那两份管先后，这份管写不写。
     */
    private fieldHidden: Record<string, string[]> = {};

    constructor(
        private io: VaultIO,
        private catalogPath: string = 'ReelLudic/catalog.json',
        private entriesDir: string = 'ReelLudic/笔记',
        /** 笔记是否渲染属性表格（设置页「笔记表格」开关）。
         *  🔴🔴 #596 **翻面**：缺省由 `true` 改成 **`false`** —— 用户点名「默认全部关闭」；
         *  由 `main.rebuildService()` 每次 saveSettings 时按设置重建服务传入，故改开关即时生效。 */
        private noteTable: boolean = false,
        /** 1.3.1 ① 字段映射**原文**（每行一条 `[原] -> [新]`）；空 / 缺省 = 恒等映射。
         *  ⚠️ 传原文而不是编译结果：设置页里存的就是这段文本，编译只在这里做一次。 */
        fieldMapText: string = '',
        /** 1.3.1 ① 第 3 件：**各类型笔记属性顺序**（`settings.fieldOrder` 原文；缺省 = 全部走缺省顺序）。 */
        fieldOrderCfg: unknown = {},
        /** 🔴 #640e：**书籍子分类各自的顺序**（`settings.fieldOrderByKind` 原文；缺省 = 回落 `fieldOrder.book`）。 */
        fieldOrderKindCfg: unknown = {},
        /** 🔴 #721：**不写出的属性键**（`settings.fieldOrderHidden` 原文；缺省 = 什么都不隐藏）。 */
        fieldOrderHiddenCfg: unknown = {},
    ) {
        this.store = new CatalogStore(io, catalogPath);
        this.fieldMap = compileFieldMapText(fieldMapText);
        this.fieldOrders = resolveAllOrders(fieldOrderCfg);
        this.kindOrders = resolveAllKindOrders(fieldOrderCfg, fieldOrderKindCfg);
        // 🔴 #721：隐藏集与顺序**各自独立**算（收窄口径不同：隐藏不补缺省）
        this.fieldHidden = resolveAllHidden(fieldOrderHiddenCfg);
    }

    /**
     * 🔴 #640e：取某条目该用的**属性写出顺序**。
     * **书籍**按自己的 `bookKind`（文学/网文/漫画各一份）；**其余类型**按 `type`。
     * ⚠️ 书籍的 `bookKind` 缺省归 `book`（文学）—— 与 `normalizeEntry` 同一口径
     *    （用 `normalizeBookKind`，⛔ 别自己写 `?? 'book'`：脏值归一只有那一个真源）。
     */
    private orderForEntry(e: MediaEntry): string[] {
        if (e.type === 'book') return this.kindOrders[normalizeBookKind(e.bookKind)];
        return this.fieldOrders[e.type];
    }

    /**
     * 🔴 #721：取某条目**不写出**的属性键。
     *
     * 三段**取并集**（三处各管一段，用户在哪一页删的就只影响那一页的字段集）：
     *   ⑴ `'__global'` —— 全局页删的（对所有类型生效）；
     *   ⑵ 该条目**类型**那一档 —— `movie` / `tv` / … / 书籍是 `book`（书籍的专属字段在子类页，
     *      但 `book` 这一档也可能被写过 —— 兼容与「类型页」口径一致）；
     *   ⑶ 书籍再加 `'k:<bookKind>'` 那一档（文学 / 网文 / 漫画各一份）。
     *
     * ⚠️ 为什么全局要用并集、而不是「全局页删了就把那一行从所有类型表里删掉」：
     *    `fieldOrder` 的全局页是靠「六个类型各自那份里全局字段的相对次序」表达的
     *    （见 `renderFieldOrderPane.readOrder`），删字段没法这么表达 —— 所以隐藏走独立一份，
     *    全局一档天然对全部类型生效，不需要写六遍。
     */
    private hiddenForEntry(e: MediaEntry): string[] {
        const out = new Set<string>(this.fieldHidden['__global'] ?? []);
        for (const k of this.fieldHidden[e.type] ?? []) out.add(k);
        if (e.type === 'book') {
            for (const k of this.fieldHidden['k:' + normalizeBookKind(e.bookKind)] ?? []) out.add(k);
        }
        return [...out];
    }

    /**
     * 🔴 写笔记的**唯一出口**：写盘 + 同步刷新 `noteFingerprint`（两件事必须成对）。
     *
     * 为什么必须成对：`noteWasExternallyModified()` 的判据只是「文件内容 hash ≠ 落库指纹」，
     * 对**是谁**改的一无所知 ⇒ 插件自己的写入若不同步刷指纹，下次保存该条目必然被判成
     * 「笔记被外部修改」并弹二选一框（用户 2026-09-21 实测报障：「为什么总会有……提示」）。
     * 历史上 `addExcerpt`／`deleteExcerpt`／`appendNoteSection` 三条正是「各自 `io.writeText` +
     * 只刷自己那份缓存」的写法 ⇒ 三条全是误报源。⛔ 新增写笔记功能一律走这里。
     *
     * @param patch 除指纹外还要一起落库的字段（如 `notePath` / `excerptCount`）；
     *              只想刷 `updatedAt` 时传空对象即可（`update()` 自己会写时间）。
     */
    private async writeNoteRaw(
        id: string,
        notePath: string,
        content: string,
        patch: Partial<MediaEntry> = {},
    ): Promise<void> {
        await this.io.writeText(notePath, content);
        await this.update(id, { ...patch, noteFingerprint: hashNoteContent(content) });
    }

    private async load(): Promise<Catalog> {
        return this.store.load();
    }

    private async save(c: Catalog): Promise<void> {
        await this.store.save(c);
    }

    private now(): string {
        return new Date().toISOString();
    }

    /** 追加一条状态翻转记录（今日记录/日记打卡数据源）。
     *  只记「状态真的变了」的调用——表单保存时 patch 恒带 status，未变即跳过，防日志被无效保存刷满。
     *  上限由 serializeCatalog 侧截断最旧（ACTIVITY_LOG_LIMIT）。 */
    private pushActivity(c: Catalog, id: string, status: MediaStatus): void {
        c.activityLog = [...(c.activityLog ?? []), { at: this.now(), id, status }];
    }

    async list(): Promise<MediaEntry[]> {
        return (await this.load()).entries;
    }

    /** 活动日志（状态翻转记录）：「今日记录」/ 日记打卡的数据源，按时间升序 */
    async activityLog(): Promise<ActivityEvent[]> {
        return (await this.load()).activityLog ?? [];
    }

    /** 系列（合集）评分表：`分组键 → 0~5`（用户 2026-10-27 裁定「加合集分」）。
     *  缺省 / 老 catalog ⇒ 空表（视图据此显示「全部未评分」）。 */
    async seriesRatings(): Promise<SeriesRatingMap> {
        return (await this.load()).seriesRatings ?? {};
    }

    /**
     * 分类视图表（用户 2026-11-23 裁定「视图存进媒体库」）。
     *
     * 🔴 **恒返回至少一条默认视图**（`pure/mediaViews.normalizeViews` 保证）——
     *    ⛔ 调用方别自己再判空：首页切换条永远需要「默认视图」那一档。
     * 缺省 / 老 catalog（没有 `views` 键）⇒ 只有默认视图。
     */
    async views(): Promise<MediaView[]> {
        return normalizeViews((await this.load()).views);
    }

    /**
     * 落盘整张视图表（**只有这一条出口** —— 视图不碰磁盘，与 `setSeriesRating` 同架构）。
     *
     * 🔴 归一 + 「只剩默认视图就不写键」全部委托给 `pure/mediaViews`，
     *    ⛔ 别在这里再判一次（两份口径必然漂）。
     * 🔴 默认视图不可删/改名/换种类由 `normalizeViews` 强制保证，本方法只管存。
     * @returns 归一后的视图表（调用方拿它刷新 UI，别用自己传进去的原始值）
     */
    async setViews(raw: unknown): Promise<MediaView[]> {
        const c = await this.load();
        const next = normalizeViews(raw);
        c.views = next;
        await this.save(c);
        return next;
    }

    /**
     * 写某系列的合集分（**只有这一条出口** —— 视图不碰磁盘，与 `commitTableCell` 同架构）。
     *
     * 🔴 归一 + 「0 删键」全部委托给 `pure/seriesRating.writeSeriesRating`，
     *    ⛔ 别在这里再判一次（两份口径必然漂）。
     * 🔴 合集分**不是**条目的字段 ⇒ 走 `catalog.seriesRatings`，⛔ 别去改组内任何一条的 `rating`
     *    （那会真的把用户手打的单条分数抹掉，且不可逆）。
     */
    async setSeriesRating(key: string, rating: unknown): Promise<SeriesRatingMap> {
        const c = await this.load();
        const next = writeSeriesRating(c.seriesRatings, key, rating);
        c.seriesRatings = next;
        await this.save(c);
        return next;
    }

    /**
     * 系列卡隐藏表：`分组键 → true`（用户 2026-11-21「隐藏此系列卡片」）。
     * 缺省 / 老 catalog ⇒ 空表（视图据此判「没有系列被隐藏」）。
     */
    async seriesHidden(): Promise<SeriesHiddenMap> {
        return (await this.load()).seriesHidden ?? {};
    }

    /**
     * 写某系列的隐藏标记（**只有这一条出口** —— 视图不碰磁盘，与 `setSeriesRating` 同架构）。
     *
     * 🔴 归一 + 「取消隐藏即删键」全部委托给 `pure/seriesHidden.writeSeriesHidden`，
     *    ⛔ 别在这里再判一次（两份口径必然漂）。
     * 🔴 只写 catalog 顶层 `seriesHidden`，⛔ **别去动组内任何一条的 `cardHidden`** ——
     *    用户明确要求「里面的系列条目不受影响」，改了就变成把整个系列打码。
     * 🔴 值没变化时不落盘（`writeSeriesHidden` 返回同一引用即为「无变化」信号）——
     *    拖一下复选框就全量重写几百 KB 的 catalog 不值得。
     */
    async setSeriesHidden(key: string, hidden: unknown): Promise<SeriesHiddenMap> {
        const c = await this.load();
        const prev = c.seriesHidden ?? {};
        const next = writeSeriesHidden(prev, key, hidden);
        if (next === prev && c.seriesHidden) return next;
        c.seriesHidden = next;
        await this.save(c);
        return next;
    }

    async get(id: string): Promise<MediaEntry | undefined> {
        return (await this.list()).find((e) => e.id === id);
    }

    async create(input: Partial<MediaEntry>): Promise<MediaEntry> {
        const c = await this.load();
        const entry = normalizeEntry(input);
        c.entries.push(entry);
        await this.save(c);
        return entry;
    }
    async update(id: string, patch: Partial<MediaEntry>): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const prev = c.entries[idx];
        // 🔴 #609：本次**清空本地书籍文件**（解除关联）⇒ 阅读进度失去载体，一并清掉（用户裁定「直接清数据」）。
        //    ⚠️ **单点收口**：右键「关联入口」、编辑表单、书籍浮层三条清空路径都经 `update` ⇒ ⛔ 别在别处再判一次。
        const effective: Partial<MediaEntry> = dropsReadingProgress(patch)
            ? { ...patch, readingProgress: undefined }
            : patch;
        const merged = normalizeEntry({ ...prev, ...effective, updatedAt: this.now() });
        c.entries[idx] = merged;
        if (merged.status !== prev.status) this.pushActivity(c, id, merged.status); // 编辑表单改状态也要进日志
        await this.save(c);
        return merged;
    }

    async remove(id: string): Promise<void> {
        const c = await this.load();
        c.entries = c.entries.filter((e) => e.id !== id);
        await this.save(c);
    }

    /** 删除条目并连带删除已生成的笔记文件（笔记删除失败不阻断条目删除） */
    async removeWithNote(id: string): Promise<void> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        await this.remove(id);
        if (e.notePath) {
            try {
                await this.io.deleteFile(e.notePath);
            } catch {
                // 笔记文件已被外部移除或删除失败：忽略，不影响条目删除
            }
        }
    }

    async setStatus(id: string, to: MediaStatus): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (!canTransition(cur.status, to)) {
            throw new Error(`illegal status transition: ${cur.status} -> ${to}`);
        }
        // 书籍标记「已读」（watched）= 读完语义：readingProgress.percent 强制 100（保留 page/totalPage 展示口径），
        // 防海报墙出现「✓已读 + 98%」矛盾（percent 是书架进度条唯一真源，阅读器落库同口径）
        let readingProgress = cur.readingProgress;
        if (to === 'watched' && cur.type === 'book' && readingProgress) {
            readingProgress = { ...readingProgress, percent: 100 };
        }
        const merged = normalizeEntry({ ...cur, status: to, readingProgress, updatedAt: this.now() });
        c.entries[idx] = merged;
        this.pushActivity(c, id, to);
        await this.save(c);
        return merged;
    }

    /** 追更标记：仅剧集；推进集数（默认当前 +1）并追加历史记录 */
    async markUpdated(id: string, opts: { now?: string; episode?: number } = {}): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'tv') throw new Error('markUpdated only for tv');
        const date = opts.now ?? this.now().slice(0, 10);
        const progress = cur.progress ?? { season: 1, episode: 0, history: [] };
        const nextEpisode = opts.episode ?? progress.episode + 1;
        const newProgress = {
            season: progress.season,
            episode: nextEpisode,
            lastWatchedDate: date,
            history: [...(progress.history ?? []), { season: progress.season, episode: nextEpisode, date }],
        };
        const merged = normalizeEntry({ ...cur, progress: newProgress, updatedAt: this.now() });
        c.entries[idx] = merged;
        await this.save(c);
        return merged;
    }

    /** 阅读进度推进：仅书籍；page 或 percent 二选一（percent 需 totalPage 换算页码）。
     *  读完不自动改状态（由调用方决定是否 setStatus）。 */
    async advanceReading(id: string, opts: { page?: number; percent?: number; totalPage?: number } = {}): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'book') throw new Error('advanceReading only for book');
        const progress = cur.readingProgress ?? {};
        const totalPage = opts.totalPage ?? progress.totalPage;
        let page = opts.page;
        if (opts.percent !== undefined) {
            if (opts.percent < 0 || opts.percent > 100) throw new Error(`percent out of range: ${opts.percent}`);
            if (totalPage === undefined) throw new Error('percent requires totalPage');
            page = Math.round((opts.percent / 100) * totalPage);
        }
        if (page !== undefined && totalPage !== undefined && page > totalPage) {
            throw new Error(`page ${page} exceeds totalPage ${totalPage}`);
        }
        const merged = normalizeEntry({
            ...cur,
            readingProgress: { page: page ?? progress.page, totalPage },
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        return merged;
    }

    /** 生成/覆写条目详情笔记，回填 notePath。
     *  合并写入策略 C：模板重写时按「## 摘抄」「## 时间戳」「## 截图」等标记行提取旧笔记**用户标注区**，
     *  原样回填（防覆写清空用户标注）。⚠️ 只搬「摘抄」会把其它区整段吞掉 —— 2026-09-18 实测：
     *  重写后块全丢，正文里还显示着却删不掉；各区按旧笔记里的先后顺序搬回。
     *  🔴🔴 #528（2026-10-05）：「## 高亮」**已移出**搬回名单（`ANNOTATION_SECTIONS` 不含它）——
     *  高亮真源只在阅读数据 JSON，笔记里那份镜像不再生成；模板重写会把旧笔记里的高亮区**顺手覆盖掉**
     *  （这正是存量清理的惰性路径）。
     *  🔴 2026-09-27 增第三处：**` ```lrc ` 块内的歌词正文**（非指令行）。模板只按 `audioPath` 写出
     *  `source` 指令行 ⇒ 不搬回就等于「用户填过 / 在线获取的歌词，保存一次全没了」（静默丢数据）。
     *  指令行仍由模板决定（`formatLrcSourceDirective`），歌词正文归用户 —— 两者分工不能混。 */
    async writeNote(id: string): Promise<string> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        const path = entryNotePath(e, this.entriesDir);
        // 库目录（去掉末尾笔记目录名）：供 banner 拼接本地封面路径
        const libraryDir = this.entriesDir.replace(/\/+$/, '').replace(new RegExp(`/${DIR_NOTES}$`), '') || 'ReelLudic';
        // 🔴 #640e：顺序按条目取 —— **书籍走 `bookKind` 那一份**（文学/网文/漫画各存各的），
        //    其余类型走 `type`。⛔ 别退回 `this.fieldOrders[e.type]`（那会让书籍三者共用一份，
        //    用户拆出来的三个子类分组当场失效）。
        const md = entryFrontmatter(e, libraryDir, this.fieldMap, this.orderForEntry(e), this.hiddenForEntry(e)) + '\n\n' + generateNoteMarkdown(e, libraryDir, { table: this.noteTable, allEntries: await this.list() });
        let final = md;
        if (e.notePath) {
            try {
                const old = await this.io.readText(e.notePath);
                for (const sec of extractAnnotationSections(old)) {
                    final = mergeExcerptSection(final, sec.body, sec.section);
                }
                // 歌词正文：整段搬回（`withLrcLyrics` 自己处理「无块 / 无歌词 / 无变化」三种情况）
                final = withLrcLyrics(final, lrcBlockLyrics(old));
                // 🔴 #635 关联区：**必须是保留区** —— 否则用户手动改过的关联行会在下一次保存时被模板覆盖掉
                //    （本仓在 #396 的 LRC 上踩过同款）。⚠️ 与上面几个标注区不同：catalog 里**有** `related`
                //    时以数据为准（模板已写），只有用户在笔记里手改**且**目录侧没有关联时才搬回，
                //    否则「笔记手改 → 保存」会随手改把新加的关联冲掉。
                final = preserveRelatedSection(final, old);
            } catch {
                // 旧笔记不存在/不可读：跳过合并（首次写入或文件被外部移除）
            }
        }
        // 记录笔记路径 + 内容指纹（G 双写冲突）：下次写前比对，检测外部手动修改
        await this.writeNoteRaw(id, path, final, { notePath: path });
        // 🔴 改名孤儿清理（必须在 writeNoteRaw **之后**、且已确认旧内容搬进 final 之后）：
        //    `entryNotePath` 按**标题**生成路径 ⇒ 用户改过标题后，新路径 ≠ 旧 `notePath`，
        //    旧文件从此没人引用，成为「笔记文件还在、条目却指向别处」的孤儿
        //    （`main.ts:420` 的注释自己承认了这一点）。此前只有「附件清理」管封面/阅读存档，
        //    **笔记孤儿完全没人管** ⇒ 只能靠这里在切换引用时顺手清掉，否则尸体会一直堆积。
        //    ⚠️ 顺序不能挪到前面：前面的 `extractAnnotationSections(old)` 正是从旧文件搬用户标注，
        //      先删就等于把用户手写的摘抄/时间戳/截图全丢了。
        await this.dropStaleNote(e, path);
        return path;
    }

    /**
     * 条目改名后遗留的旧笔记文件清理（`writeNote` 专用，其它路径别调用）。
     *
     * 判据三连，**缺一不可**：
     *  ⑴ 旧 `notePath` 存在，且与新路径不同（同路径 = 没改名，无事可做）；
     *  ⑵ 旧路径**没有**其它活条目引用 —— 历史上有两条同标题条目共用一个 `notePath` 的脏数据
     *     （`restoreEntryFor` 的注释里写了这个坑），删了就等于删别人的笔记；
     *  ⑶ 新文件已确实写好（本方法在 `writeNoteRaw` 之后调用）—— 否则等于在没有新笔记时删掉旧笔记。
     *
     * 🔴 走 `io.deleteFile`（obsidian 侧实现是 `fileManager.trashFile`）⇒ 进回收站可还原，
     *    **不是**硬删除。删失败静默：孤儿尸体留着比误删活笔记安全得多。
     */
    private async dropStaleNote(prev: MediaEntry, nextPath: string): Promise<void> {
        const oldPath = prev.notePath;
        if (!oldPath || oldPath === nextPath) return;
        // ⑵ 还有别的条目指着它？那就不是孤儿，绝不能删
        const shared = (await this.list()).some((e) => e.id !== prev.id && e.notePath === oldPath);
        if (shared) return;
        try {
            await this.io.deleteFile(oldPath);
        } catch {
            // 文件已不存在 / 被外部移除 / 回收站不可用：忽略（孤儿留下不阻断保存）
        }
    }

    /** 检测笔记是否被外部修改（G 双写冲突）：读现有笔记 hash 与落库指纹比对。
     *  无笔记/无指纹 → false（首次写入或旧数据，无冲突概念）；文件不可读 → false（无可冲突内容）。 */
    async noteWasExternallyModified(id: string): Promise<boolean> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (!e.notePath || !e.noteFingerprint) return false;
        try {
            const content = await this.io.readText(e.notePath);
            return hashNoteContent(content) !== e.noteFingerprint;
        } catch {
            return false;
        }
    }

    /**
     * 采纳**当前笔记内容**为新的指纹基线（用户 2026-09-21 报「总会有外部修改提示」的后半）。
     *
     * 场景：冲突弹窗里用户选「保留笔记改动」⇒ 笔记不重写、库数据也不动，但**指纹必须跟上**。
     * 旧实现选「保留」时什么都不做 ⇒ 指纹永远停在冲突前那一版 ⇒ 该条目**每次保存都会再问一遍**
     * （用户实感就是「总会有这个提示」）。
     *
     * 语义：认可「文件现在这个内容」为基线 ⇒ 之后只有**再发生变化**才会重新提示 ——
     * 这不是把保护关掉（`noteWasExternallyModified()` 照旧比对），而是「一次外改只问一次」。
     * 无笔记 → `false`（无基线可采纳）；读不到 → `false`（不抛：确认框已关，失败不该打断保存流程）。
     */
    async adoptNoteAsBaseline(id: string): Promise<boolean> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (!e.notePath) return false;
        try {
            const content = await this.io.readText(e.notePath);
            await this.update(id, { noteFingerprint: hashNoteContent(content) });
            return true;
        } catch {
            return false;
        }
    }

    /** 向书目笔记追加一条摘抄（仅书籍）：无笔记时先生成；返回更新后的摘抄数。 */
    async addExcerpt(id: string, excerpt: ParsedExcerpt, opts: { refLink?: string } = {}): Promise<{ count: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (e.type !== 'book') throw new Error('excerpt only for book');
        let notePath = e.notePath;
        if (!notePath) {
            await this.writeNote(id);
            const updated = await this.get(id);
            notePath = updated?.notePath;
            if (!notePath) throw new Error('note path missing');
        }
        const old = await this.io.readText(notePath);
        // entryId 进渲染 → 头行追加「回到原文」深链（用户 2026-09-19；库外书也能点回）
        const final = appendExcerptToNote(old, renderExcerptBlock(excerpt, { callout: true, refLink: opts.refLink, entryId: id }));
        // 刷新 updatedAt + **指纹** + 落库摘抄数（P1 性能缓存：书架徽标/年度总结读 catalog 不读笔记）
        const count = countExcerpts(final);
        await this.writeNoteRaw(id, notePath, final, { excerptCount: count });
        return { count };
    }

    /**
     * 读条目笔记**正文**（④-4 音频播放器取歌词用）。
     * **无笔记 / 读不到 → `null`**（不是错误：还没写过笔记的条目就是没有笔记）。
     * 🔴 笔记只经 `EntryService` 读写（`io.readText` 走红线 11 的二进制 + 编码嗅探）⇒
     *    消费方（播放器）⛔ 不要自己去 `vault.read`，否则「笔记被外部修改」的指纹判断会被绕过。
     */
    async readNoteText(id: string): Promise<string | null> {
        const e = await this.get(id);
        if (!e?.notePath) return null;
        try {
            return await this.io.readText(e.notePath);
        } catch {
            return null;
        }
    }

    /**
     * 读条目笔记 ` ```lrc ` 块里的**歌词正文**（#396：条目表单的 LRC 框用它回填）。
     * **无笔记 / 无块 / 只有指令行 → `''`**（不是错误：没歌词就是没歌词，框里就该是空的）。
     * 🔴 与播放器侧的读取**同源**：都走 `pure/lrcSource.lrcBlockLyrics` ⇒ 表单里看到的就是播放器唱的那份。
     */
    async readNoteLrc(id: string): Promise<string> {
        return lrcBlockLyrics((await this.readNoteText(id)) ?? '');
    }

    /**
     * 写条目笔记 ` ```lrc ` 块的歌词正文（#396）。返回**是否真的写了盘**。
     *
     * 🔴 必须经 `writeNoteRaw`（笔记 + 指纹的唯一出口）：否则下次编辑条目会被
     *    `noteWasExternallyModified()` 判成「笔记被外部修改」，用户又要面对一次冲突弹窗。
     * 🔴 语义是**整段替换**：传空串就是清空歌词（这是「清了框还能生效」的实现，
     *    与 `writeNote` 的保留区配合才有意义 —— 保留区搬回的是**旧**歌词，本方法负责把它换成新的）。
     * 无笔记 → `false`（不凭空造笔记：歌词是笔记里的一段，没有笔记就没有可写的块）。
     * 内容无变化 → `false` 且**不写盘**（逐字比对，避免每次保存都白写一遍并刷指纹）。
     */
    async setNoteLrc(id: string, lyrics: string): Promise<boolean> {
        const e = await this.get(id);
        if (!e?.notePath) return false;
        let old: string;
        try {
            old = await this.io.readText(e.notePath);
        } catch {
            return false;
        }
        const text = String(lyrics ?? '').trim();
        if (lrcBlockLyrics(old) === text) return false;
        const final = withLrcLyrics(old, text);
        if (final === old) return false;
        await this.writeNoteRaw(id, e.notePath, final);
        return true;
    }

    /**
     * 读条目笔记 → 进度条标记（#333）。
     * **无笔记 / 读不到 → 空数组**（不是错误：还没写过笔记的视频就是没有点）。
     * ⚠️ 笔记只经 `EntryService` 读写 ⇒ 解析入口也放这里（视图不碰 vault）。
     * 解析本身在纯模块 `pure/videoMarks`（只扫 `## 时间戳` / `## 截图` 两区、认链接目标不认文字）。
     */
    async readNoteMarks(id: string): Promise<VideoMark[]> {
        const e = await this.get(id);
        if (!e?.notePath) return [];
        try {
            return parseNoteMarks(await this.io.readText(e.notePath));
        } catch {
            return [];
        }
    }

    /**
     * 向条目笔记追加一段 markdown 到指定区段（`## <section>`；区段不存在则创建）。
     * 复用 `appendExcerptToNote` 的**泛型 section** 机制（建区段 / 追加到区段末尾 / 保序 / 不动别的区段）。
     *
     * **返回追加内容的起始行号（0 基）** —— 调用方据此把笔记视图滚到插入处
     * （用户 2026-09-19：「插入后应定位到时间戳的位置显示，而不是又从笔记开头显示」）。
     *
     * 🔴 笔记只能从这里写（笔记文件与 `noteFingerprint` 的唯一拥有者是 EntryService）——
     * 调用方直接 `vault.modify` 会让指纹过期、下次误报「笔记被外部修改」。
     * 与 `addExcerpt` 的分工：摘抄要维护**摘抄计数缓存**（书架徽标/年度总结读它）故单独一条；
     * 视频时间戳 / 截图这类「只写不数」的走这里。
     */
    async appendNoteSection(id: string, markdown: string, section: string): Promise<{ line: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        const body = (markdown ?? '').trim();
        if (!body) return { line: 0 };
        let notePath = e.notePath;
        if (!notePath) {
            await this.writeNote(id);
            notePath = (await this.get(id))?.notePath;
            if (!notePath) throw new Error('note path missing');
        }
        const old = await this.io.readText(notePath);
        const final = appendExcerptToNote(old, body, section);
        // 🔴 指纹必须跟着刷：否则下次保存该条目必然误报「笔记被外部修改」（用户 2026-09-21 报障）。
        //    顺带刷 updatedAt（与摘抄一致：笔记改了，条目时间跟着走）。
        await this.writeNoteRaw(id, notePath, final);
        // 起始行 = 该文本最后一次出现之前有多少个换行（用 lastIndexOf：笔记里可能早就有同样的文本）
        const at = final.lastIndexOf(body);
        return { line: at < 0 ? 0 : final.slice(0, at).split('\n').length - 1 };
    }

    /** 删除一条摘抄（仅书籍）：按块 id 从笔记摘抄区移除该块；块不存在抛错；更新摘抄数缓存 */
    async deleteExcerpt(id: string, blockId: string): Promise<{ count: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (e.type !== 'book') throw new Error('excerpt only for book');
        if (!e.notePath) throw new Error('note not found');
        const old = await this.io.readText(e.notePath);
        const final = removeExcerptBlock(old, blockId);
        if (final === old) throw new Error('摘抄不存在或已删除');
        const count = countExcerpts(final);
        await this.writeNoteRaw(id, e.notePath, final, { excerptCount: count });
        return { count };
    }

    /**
     * 删除笔记里的「## 高亮」区（#528 清理历史镜像用；幂等）。
     *
     * 🔴 2026-10-05 用户裁定「高亮数据仅保存在阅读进度文件里」⇒ 笔记里那份「## 高亮」区
     *    **不再生成**（原「镜像同步」方法已删）。本方法只为**清掉存量笔记里的残留**：
     *    真源是高亮 JSON（`pure/readerStore`），笔记区只是历史镜像，删掉不丢任何数据。
     * 🔴 必须经 `writeNoteRaw`（笔记 + 指纹的唯一出口）：否则下次编辑该条目会被
     *    `noteWasExternallyModified()` 误判成「笔记被外部修改」并弹二选一冲突框。
     * 无笔记 / 无该区 / 删后无变化 → 返回 `false`（不写盘）。
     */
    async removeHighlightSection(id: string): Promise<boolean> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (!e.notePath) return false;
        try {
            const old = await this.io.readText(e.notePath);
            const next = replaceAnnotationSection(old, HIGHLIGHT_SECTION, '');
            if (next === old) return false;
            await this.writeNoteRaw(id, e.notePath, next);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * ②-4 把微信读书的划线与想法**整区重写**到条目笔记的 `## 同步划线与高亮`。
     *
     * 🔴 为什么是「整区重写」而不是 `appendNoteSection` 追加：同步是**镜像**语义 ——
     *    用户在微信读书里删了一条划线、再同步一次，追加式会把删掉的那条永远留在笔记里。
     *    `replaceAnnotationSection` 每次全量替换，空 body 则整区删除（幂等）。
     * 🔴 必须经 `writeNoteRaw`（笔记 + 指纹的唯一出口），否则下次编辑该条目会被
     *    `noteWasExternallyModified()` 误判成「笔记被外部修改」并弹冲突框。
     * 🔴 区名必须同时列在 `pure/excerpt.ts` 的 `ANNOTATION_SECTIONS` 里，
     *    否则用户下一次保存条目（`writeNote` 模板重写）会把整区吞掉。
     * 内容逐字相同 → 返回 `false` 且**不写盘**（避免「打开即写」把笔记图章的 mtime 刷掉）。
     */
    async syncWereadNotes(id: string, markdown: string): Promise<boolean> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        let notePath = e.notePath;
        if (!notePath) {
            await this.writeNote(id);
            notePath = (await this.get(id))?.notePath;
            if (!notePath) throw new Error('note path missing');
        }
        const old = await this.io.readText(notePath);
        const next = replaceAnnotationSection(old, WEREAD_NOTES_SECTION, markdown ?? '');
        if (next === old) return false;
        await this.writeNoteRaw(id, notePath, next);
        return true;
    }

    // ── #685 时长明细 / 重温 / 周目 / 攻略 / 短评 ──────────────────────────────────
    // 🔴 这一族方法的共同约定：**落库后立刻重写笔记**（`writeNote`）—— 用户录完在笔记里就能看到，
    //    不靠"下次打开笔记才刷新"。章节名与渲染在 noteGenerator 里（⛔ 别在两处各写一份）。

    /** 追加一条**时长明细**（#685 泛化：游戏游玩 / 书籍阅读 / 音乐收听共用一套结构）。
     *  - **游戏**：明细与 `playtimeMinutes` **解耦**（总时长手填或 Steam 同步 ⇒ 记录不自动累计，沿用旧口径）
     *  - **书籍**：累加到 `readMinutes`（与内置阅读器自动累计同一字段 ⇒ 手动补记 = 再加一次）
     *  - **音乐**：累加到 `listenMinutes`（同上：手动补记累加）
     *  ⚠️ 书籍/音乐的总时长**删除明细时不回退**（明细与总数解耦，和游戏同口径 —— 读者累加的部分无法区分）。 */
    async addTimeSession(id: string, session: { date: string; minutes: number; note?: string }): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'game' && cur.type !== 'book' && cur.type !== 'music') {
            throw new Error('addTimeSession only for book/music/game');
        }
        const sessions = [...(cur.playSessions ?? []), { date: session.date, minutes: session.minutes, note: session.note }];
        const patch: Partial<MediaEntry> = { playSessions: sessions, updatedAt: this.now() };
        if (cur.type === 'book') patch.readMinutes = (cur.readMinutes ?? 0) + session.minutes;
        if (cur.type === 'music') patch.listenMinutes = (cur.listenMinutes ?? 0) + session.minutes;
        const merged = normalizeEntry({ ...cur, ...patch });
        c.entries[idx] = merged;
        await this.save(c);
        // 同步重写笔记：时长明细章节由模板生成（含摘抄区合并回填），记录后立即出现在笔记
        await this.writeNote(merged.id);
        return merged;
    }

    /**
     * 🔴 m02288：**只把分钟加到总时长上，不产生明细**（音乐播放器自动累计专用）。
     *
     * 为什么不能复用 `addTimeSession`：那个方法会往 `playSessions` 里**追加一条明细**，
     * 播放器每满一分钟就调一次 ⇒ 用户的时长明细会变成「听了一分钟 × 47 条」的垃圾堆，
     * 而且每次都重写整份笔记。自动累计是**背景行为**，⛔ 不该在明细列表里留痕。
     *
     * 与手动的分工（写死，别再混）：
     *  · 播放器自动累计 → 本方法（只动 `listenMinutes`）；
     *  · 用户「记录时长」补记 → `addTimeSession`（明细 + 总数一起动）。
     *
     * ⚠️ 只对 `music` 生效（当前唯一有自动累计的场景）；类型不对直接返回 `null`，⛔ 不抛 ——
     *    调用方是播放器回调，那里抛错会打断播放链路。
     */
    async bumpListenMinutes(id: string, minutes: number): Promise<MediaEntry | null> {
        if (!Number.isFinite(minutes) || minutes <= 0) return null;
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) return null;
        const cur = c.entries[idx];
        if (cur.type !== 'music') return null;
        // `listenMinutes` 是整数分钟（`data/catalog` 用 Math.round 兜底），这里只加整数
        const add = Math.max(1, Math.floor(minutes));
        const merged = normalizeEntry({
            ...cur,
            listenMinutes: (cur.listenMinutes ?? 0) + add,
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        // 与 `addTimeSession` 同口径：落库后立刻重写笔记（`listen_minutes` 由 noteGenerator 写进 yaml），
        // 否则用户下次打开笔记看到的还是旧总时长
        await this.writeNote(merged.id);
        return merged;
    }

    /** 删除一条**时长明细**（#685）。⚠️ 总时长（readMinutes / listenMinutes / playtimeMinutes）**不受影响** —— 与游戏旧口径一致 */
    async removeTimeSession(id: string, index: number): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'game' && cur.type !== 'book' && cur.type !== 'music') {
            throw new Error('removeTimeSession only for book/music/game');
        }
        const sessions = cur.playSessions ?? [];
        if (index < 0 || index >= sessions.length) throw new Error(`session index out of range: ${index}`);
        const next = sessions.filter((_, i) => i !== index);
        const merged = normalizeEntry({
            ...cur,
            playSessions: next.length ? next : undefined,
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        await this.writeNote(merged.id);
        return merged;
    }

    /** 追加一条**重温 / 周目**记录（#685）：影视「重刷次数 + 感想」、游戏「周目序号 + 感想」—— 感想落笔记内 */
    async addRoundLog(id: string, log: { kind: 'rewatch' | 'playthrough'; date: string; round: number; note?: string }): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        // 🔴 类型闸门：重温 = 影视（movie/tv/anime）；周目 = 游戏。错类型直接拒，不静默改 kind
        if (log.kind === 'rewatch' && cur.type !== 'movie' && cur.type !== 'tv' && cur.type !== 'anime') {
            throw new Error('rewatch only for movie/tv/anime');
        }
        if (log.kind === 'playthrough' && cur.type !== 'game') throw new Error('playthrough only for game');
        const logs = [
            ...(cur.roundLogs ?? []),
            { kind: log.kind, date: log.date, round: Math.max(1, Math.round(log.round)), note: log.note },
        ];
        const merged = normalizeEntry({ ...cur, roundLogs: logs, updatedAt: this.now() });
        c.entries[idx] = merged;
        await this.save(c);
        await this.writeNote(merged.id);
        return merged;
    }

    /** 删除一条**重温 / 周目**记录（#685）：按 roundLogs 下标删，笔记同步重写 */
    async removeRoundLog(id: string, index: number): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        const logs = cur.roundLogs ?? [];
        if (index < 0 || index >= logs.length) throw new Error(`round log index out of range: ${index}`);
        const next = logs.filter((_, i) => i !== index);
        const merged = normalizeEntry({
            ...cur,
            roundLogs: next.length ? next : undefined,
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        await this.writeNote(merged.id);
        return merged;
    }

    /** 写入**短评**（#685）：落 `commentLog`（笔记独立的「短评」章节），保存后立刻重写笔记
     *  🔴 **追加**语义（⛔ 别改成覆盖）：右键「添加短评」是「再加一句」——
     *     覆盖会把用户之前的短评吃掉。
     *  🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」——
     *     ⇒ 存到 `commentLog` 数组，由 `noteGenerator` 渲染成 `## 短评` 章节（日期倒序）。
     *     ⛔ **别再往 `notes`（个人评语）里拼**：那会和用户手写的整段评语混成一段，
     *        既分不清哪句是评语哪句是流水，也把评语正文越拖越长。
     *  `date` 缺省 = 本地今天（老调用方 / 单测不必都传）。 */
    async setEntryComment(id: string, text: string, date?: string): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        const body = text.trim();
        if (!body) throw new Error('comment text is empty');
        const logs = cur.commentLog ?? [];
        const merged = normalizeEntry({
            ...cur,
            commentLog: [...logs, { date: date?.trim() || todayLocal(), text: body }],
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        await this.writeNote(merged.id);
        return merged;
    }

    /** 写入**攻略**（#685，游戏）：落 `guide`（笔记「攻略」章节），保存后立刻重写笔记 */
    async setEntryGuide(id: string, text: string): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'game') throw new Error('guide only for game');
        const merged = normalizeEntry({ ...cur, guide: text.trim(), updatedAt: this.now() });
        c.entries[idx] = merged;
        await this.save(c);
        await this.writeNote(merged.id);
        return merged;
    }
}
