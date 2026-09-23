// 条目服务层：增删改查 + 状态流转 + 追更标记 + 笔记生成编排
// 纯逻辑：文件 IO 通过注入的 VaultIO 完成（obsidian 适配器在插件侧提供）
import type { ActivityEvent, Catalog, MediaEntry } from 'data/types';
import { CatalogStore, normalizeEntry, type VaultIO } from 'data/catalog';
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
import { parseNoteMarks, type VideoMark } from 'pure/videoMarks';
import { HIGHLIGHT_SECTION, renderHighlightMirror, type ReaderHighlight } from 'pure/highlight';
import { DIR_NOTES } from 'pure/dirs';

function notFound(id: string): Error {
    return new Error('entry not found: ' + id);
}

export class EntryService {
    private store: CatalogStore;

    constructor(
        private io: VaultIO,
        private catalogPath: string = 'ReelLudic/catalog.json',
        private entriesDir: string = 'ReelLudic/笔记',
        /** 笔记是否渲染属性表格（设置页「笔记表格」开关；缺省 true = 保持历史行为）。
         *  由 main.rebuildService() 每次 saveSettings 时按设置重建服务传入，故改开关即时生效。 */
        private noteTable: boolean = true,
    ) {
        this.store = new CatalogStore(io, catalogPath);
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
        const merged = normalizeEntry({ ...prev, ...patch, updatedAt: this.now() });
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
     *  合并写入策略 C：模板重写时按「## 高亮」「## 摘抄」标记行提取旧笔记**两个标注区**，原样回填
     *  （防覆写清空用户标注）。⚠️ 只搬「摘抄」会把「## 高亮」整区吞掉 —— 2026-09-18 实测：重写后
     *  高亮块全丢，正文里还显示着却删不掉、双向溯源断链；两区按旧笔记里的先后顺序搬回。
     *  （2026-09-18 存储重构后「## 高亮」是 JSON 单向生成的只读镜像，**仍然必须搬回** ——
     *   吞掉它 = 用户在 Obsidian 里看到的高亮整片消失，直到下一次高亮变更才重新生成。） */
    async writeNote(id: string): Promise<string> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        const path = entryNotePath(e, this.entriesDir);
        // 库目录（去掉末尾笔记目录名）：供 banner 拼接本地封面路径
        const libraryDir = this.entriesDir.replace(/\/+$/, '').replace(new RegExp(`/${DIR_NOTES}$`), '') || 'ReelLudic';
        const md = entryFrontmatter(e, libraryDir) + '\n\n' + generateNoteMarkdown(e, libraryDir, { table: this.noteTable });
        let final = md;
        if (e.notePath) {
            try {
                const old = await this.io.readText(e.notePath);
                for (const sec of extractAnnotationSections(old)) {
                    final = mergeExcerptSection(final, sec.body, sec.section);
                }
            } catch {
                // 旧笔记不存在/不可读：跳过合并（首次写入或文件被外部移除）
            }
        }
        // 记录笔记路径 + 内容指纹（G 双写冲突）：下次写前比对，检测外部手动修改
        await this.writeNoteRaw(id, path, final, { notePath: path });
        return path;
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
     * 同步笔记「## 高亮」区为**只读镜像**（2026-09-18 存储重构，D-3②）。
     *
     * 🔴 真源是每本书的阅读数据 JSON（`pure/readerStore`，进度+书签+高亮三合一）；笔记里这一区
     *    **由 JSON 单向生成**，只为保住 Obsidian 侧的搜索/导出/反链与块锚点双向溯源，改笔记不会回写 JSON。
     * 🔴 本方法必须留在 EntryService：笔记文件与 `noteFingerprint` 的唯一拥有者在这里 —— 镜像写入也是
     *    「插件自己的写入」，不刷新指纹的话，用户下次编辑该条目会被 `noteWasExternallyModified()`
     *    误判成「笔记被外部修改」并弹二选一冲突框（既有 bug 的同类，别再绕开这里直接写笔记）。
     *
     * 无笔记 → **跳过且不生成笔记**（高亮是阅读数据，不该有「必须先有一本笔记」的前置条件；
     * 旧实现 `addHighlight` 会顺手 `writeNote()` 凭空造一本）；高亮清空 → 整区删掉而不是留空标题；
     * 内容无变化 → 不写盘（幂等）。
     */
    async syncHighlightMirror(
        id: string,
        highlights: ReaderHighlight[],
        opts: { refLink?: string } = {},
    ): Promise<{ count: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (!e.notePath) return { count: highlights.length }; // 无笔记：直接跳过（不建笔记）
        try {
            const old = await this.io.readText(e.notePath);
            const next = replaceAnnotationSection(old, HIGHLIGHT_SECTION, renderHighlightMirror(highlights, opts));
            if (next !== old) await this.writeNoteRaw(id, e.notePath, next);
        } catch {
            // 笔记不可读/不可写：镜像失败不影响真源（JSON 已落盘），静默跳过
        }
        return { count: highlights.length };
    }

    /** 追加游玩记录（仅游戏）：明细追加 + 同步重写笔记「游玩记录」章节（记录立即可见）。
     *  playtimeMinutes 为手动填写的总时长，与明细解耦——记录不自动累计。 */
    async addPlaySession(id: string, session: { date: string; minutes: number; note?: string }): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'game') throw new Error('addPlaySession only for game');
        const sessions = [...(cur.playSessions ?? []), { date: session.date, minutes: session.minutes, note: session.note }];
        const merged = normalizeEntry({
            ...cur,
            playSessions: sessions,
            updatedAt: this.now(),
        });
        c.entries[idx] = merged;
        await this.save(c);
        // 同步重写笔记：游玩记录章节由模板生成（含摘抄区合并回填），记录后立即出现在笔记
        await this.writeNote(merged.id);
        return merged;
    }

    /** 删除指定游玩记录（仅游戏）：删明细 + 同步重写笔记。playtimeMinutes（手动总时长）不受影响 */
    async removePlaySession(id: string, index: number): Promise<MediaEntry> {
        const c = await this.load();
        const idx = c.entries.findIndex((e) => e.id === id);
        if (idx < 0) throw notFound(id);
        const cur = c.entries[idx];
        if (cur.type !== 'game') throw new Error('removePlaySession only for game');
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
}
