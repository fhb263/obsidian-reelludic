// 条目服务层：增删改查 + 状态流转 + 追更标记 + 笔记生成编排
// 纯逻辑：文件 IO 通过注入的 VaultIO 完成（obsidian 适配器在插件侧提供）
import type { Catalog, MediaEntry } from 'data/types';
import { CatalogStore, normalizeEntry, type VaultIO } from 'data/catalog';
import { canTransition, type MediaStatus } from 'pure/status';
import { entryFrontmatter, entryNotePath, generateNoteMarkdown, hashNoteContent } from 'data/noteGenerator';
import {
    appendExcerptToNote,
    countExcerpts,
    extractExcerptSection,
    generateBlockId,
    mergeExcerptSection,
    removeExcerptBlock,
    renderExcerptBlock,
    type ParsedExcerpt,
} from 'pure/excerpt';
import { HIGHLIGHT_SECTION } from 'pure/highlight';

function notFound(id: string): Error {
    return new Error('entry not found: ' + id);
}

export class EntryService {
    private store: CatalogStore;

    constructor(
        private io: VaultIO,
        private catalogPath: string = 'ReelLudic/catalog.json',
        private entriesDir: string = 'ReelLudic/笔记',
    ) {
        this.store = new CatalogStore(io, catalogPath);
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

    async list(): Promise<MediaEntry[]> {
        return (await this.load()).entries;
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
        const merged = normalizeEntry({ ...c.entries[idx], ...patch, updatedAt: this.now() });
        c.entries[idx] = merged;
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
        const merged = normalizeEntry({ ...cur, status: to, updatedAt: this.now() });
        c.entries[idx] = merged;
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
     *  合并写入策略 C：模板重写时按「## 摘抄」标记行提取旧笔记摘抄区，原样回填（防覆写清空用户摘抄）。 */
    async writeNote(id: string): Promise<string> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        const path = entryNotePath(e, this.entriesDir);
        // 库目录（去掉 /笔记 后缀）：供 banner 拼接本地封面路径
        const libraryDir = this.entriesDir.replace(/\/+$/, '').replace(/\/笔记$/, '') || 'ReelLudic';
        const md = entryFrontmatter(e, libraryDir) + '\n\n' + generateNoteMarkdown(e, libraryDir);
        let final = md;
        if (e.notePath) {
            try {
                const old = await this.io.readText(e.notePath);
                const sec = extractExcerptSection(old);
                if (sec) final = mergeExcerptSection(md, sec);
            } catch {
                // 旧笔记不存在/不可读：跳过合并（首次写入或文件被外部移除）
            }
        }
        await this.io.writeText(path, final);
        // 记录笔记内容指纹（G 双写冲突）：下次写前比对，检测外部手动修改
        await this.update(id, { notePath: path, noteFingerprint: hashNoteContent(final) });
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

    /** 向书目笔记追加一条摘抄（仅书籍）：无笔记时先生成；返回更新后的摘抄数。 */
    async addExcerpt(id: string, excerpt: ParsedExcerpt): Promise<{ count: number }> {
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
        const final = appendExcerptToNote(old, renderExcerptBlock(excerpt));
        await this.io.writeText(notePath, final);
        // 刷新 updatedAt + 落库摘抄数（P1 性能缓存：书架徽标/年度总结读 catalog 不读笔记）
        const count = countExcerpts(final);
        await this.update(id, { excerptCount: count });
        return { count };
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
        await this.io.writeText(e.notePath, final);
        const count = countExcerpts(final);
        await this.update(id, { excerptCount: count });
        return { count };
    }

    /** 添加一条高亮（仅书籍）：复用摘抄块格式写入笔记「## 高亮」区（^hl 前缀块 id），返回新块 id + 区内块数。
     *  高亮不落 catalog 计数缓存（阅读器打开/保存后实时读笔记解析），故仅返回 count 供即时提示。 */
    async addHighlight(id: string, quote: string, loc: { chapter: number; pct: number }): Promise<{ id: string; count: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (e.type !== 'book') throw new Error('highlight only for book');
        let notePath = e.notePath;
        if (!notePath) {
            await this.writeNote(id);
            const updated = await this.get(id);
            notePath = updated?.notePath;
            if (!notePath) throw new Error('note path missing');
        }
        const blockId = generateBlockId('hl');
        const blockMd = renderExcerptBlock({ quote: quote.trim(), loc, id: blockId });
        const old = await this.io.readText(notePath);
        const final = appendExcerptToNote(old, blockMd, HIGHLIGHT_SECTION);
        await this.io.writeText(notePath, final);
        const count = countExcerpts(final, HIGHLIGHT_SECTION);
        return { id: blockId, count };
    }

    /** 删除一条高亮（仅书籍）：按块 id 从笔记「## 高亮」区移除该块；块不存在抛错；返回区内剩余块数 */
    async deleteHighlight(id: string, blockId: string): Promise<{ count: number }> {
        const e = await this.get(id);
        if (!e) throw notFound(id);
        if (e.type !== 'book') throw new Error('highlight only for book');
        if (!e.notePath) throw new Error('note not found');
        const old = await this.io.readText(e.notePath);
        const final = removeExcerptBlock(old, blockId);
        if (final === old) throw new Error('高亮不存在或已删除');
        await this.io.writeText(e.notePath, final);
        const count = countExcerpts(final, HIGHLIGHT_SECTION);
        return { count };
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
