import { describe, it, expect } from 'vitest';
import { EntryService } from 'services/EntryService';
import type { VaultIO } from 'data/catalog';
import { ACTIVITY_LOG_LIMIT } from 'data/types';
import { countExcerpts } from 'pure/excerpt';
import { parseHighlightBlocks, HL_MIRROR_NOTICE } from 'pure/highlight';

function memIO(): VaultIO & { files: Record<string, string> } {
    const files: Record<string, string> = {};
    return {
        files,
        async readText(path: string) {
            if (!(path in files)) throw new Error(`ENOENT: ${path}`);
            return files[path];
        },
        async writeText(path: string, content: string) {
            files[path] = content;
        },
        async deleteFile(path: string) {
            delete files[path];
        },
    };
}

describe('EntryService 增删改查', () => {
    it('create 追加条目并落库', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'tv', title: '葬送的芙莉莲', status: 'watching', rating: 5 });
        expect(e.id).toBeTruthy();
        expect(e.createdAt).toBeTruthy();
        const list = await svc.list();
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe('葬送的芙莉莲');
        expect(io.files['ReelLudic/catalog.json']).toContain('葬送的芙莉莲');
    });

    it('get 按 id 查询，不存在返回 undefined', async () => {
        const svc = new EntryService(memIO());
        expect(await svc.get('nope')).toBeUndefined();
    });

    it('update 合并字段并刷新 updatedAt', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        const updated = await svc.update(e.id, { rating: 4, year: 2021 });
        expect(updated.rating).toBe(4);
        expect(updated.year).toBe(2021);
        expect(updated.title).toBe('沙丘');
    });

    it('remove 删除条目', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.remove(e.id);
        expect(await svc.list()).toHaveLength(0);
    });
});

describe('EntryService 删除条目+笔记（removeWithNote）', () => {
    it('连带删除已生成的笔记文件', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'tv', title: '葬送的芙莉莲' });
        const path = await svc.writeNote(e.id);
        expect(io.files[path]).toBeDefined();
        await svc.removeWithNote(e.id);
        expect(await svc.list()).toHaveLength(0);
        expect(io.files[path]).toBeUndefined();
    });

    it('无笔记时仅删除条目，不抛错', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.removeWithNote(e.id);
        expect(await svc.list()).toHaveLength(0);
    });

    it('笔记删除失败不阻断条目删除', async () => {
        const io = memIO();
        io.deleteFile = async () => {
            throw new Error('vault 删除被拒');
        };
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.writeNote(e.id);
        await expect(svc.removeWithNote(e.id)).resolves.toBeUndefined();
        expect(await svc.list()).toHaveLength(0);
    });

    it('不存在的条目抛错', async () => {
        const svc = new EntryService(memIO());
        await expect(svc.removeWithNote('nope')).rejects.toThrow('not found');
    });
});

describe('EntryService 状态流转', () => {
    it('合法流转生效', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'tv', title: 'X' });
        await svc.setStatus(e.id, 'watching');
        await svc.setStatus(e.id, 'watched');
        expect((await svc.get(e.id))!.status).toBe('watched');
    });

    it('非法流转（回退）抛错且不落库', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'tv', title: 'X', status: 'watched' });
        await expect(svc.setStatus(e.id, 'want')).rejects.toThrow('illegal');
        expect((await svc.get(e.id))!.status).toBe('watched');
    });
});

describe('EntryService 书籍标记已读进度归 100', () => {
    it('book → watched：readingProgress.percent 强制 100（已读=读完，海报墙进度条不再停在 98%）', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({
            type: 'book', title: '活着', status: 'watching',
            readingProgress: { page: 98, totalPage: 100, percent: 98 },
        });
        const done = await svc.setStatus(e.id, 'watched');
        expect(done.status).toBe('watched');
        expect(done.readingProgress!.percent).toBe(100);
        // page/totalPage 保留（percent 是书架真源，页数仅展示口径）
        expect(done.readingProgress!.page).toBe(98);
        expect(done.readingProgress!.totalPage).toBe(100);
    });

    it('book → 非 watched（watching）不动 percent', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({
            type: 'book', title: 'X', status: 'want',
            readingProgress: { percent: 30 },
        });
        const watching = await svc.setStatus(e.id, 'watching');
        expect(watching.readingProgress!.percent).toBe(30);
    });

    it('非 book（movie）→ watched 不影响 readingProgress（无该字段）', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        const done = await svc.setStatus(e.id, 'watched');
        expect(done.status).toBe('watched');
        expect(done.readingProgress).toBeUndefined();
    });
});

describe('EntryService 追更标记', () => {
    it('markUpdated 推进集数并记录历史', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({
            type: 'tv', title: 'X',
            progress: { season: 1, episode: 23, history: [] },
        });
        const updated = await svc.markUpdated(e.id, { now: '2026-08-25' });
        expect(updated.progress!.episode).toBe(24);
        expect(updated.progress!.history).toHaveLength(1);
        expect(updated.progress!.history[0]).toEqual({ season: 1, episode: 24, date: '2026-08-25' });
        expect(updated.progress!.lastWatchedDate).toBe('2026-08-25');
    });

    it('无进度时初始化并从 0 → 1', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'tv', title: 'X' });
        const updated = await svc.markUpdated(e.id, { now: '2026-08-25' });
        expect(updated.progress!.season).toBe(1);
        expect(updated.progress!.episode).toBe(1);
    });

    it('电影不支持追更标记', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await expect(svc.markUpdated(e.id)).rejects.toThrow('tv');
    });
});

describe('EntryService 笔记生成', () => {
    it('writeNote 生成 .md 并回填 notePath', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'tv', title: '葬送的芙莉莲', status: 'watching', rating: 5 });
        const path = await svc.writeNote(e.id);
        expect(path).toBe('ReelLudic/笔记/teleplay/葬送的芙莉莲.md');
        expect(io.files[path]).toContain('> [!bookinfo]+ **《葬送的芙莉莲》**');
        expect(io.files[path]).toContain('status: watching');
        expect((await svc.get(e.id))!.notePath).toBe(path);
    });

    it('writeNote 对不存在的条目抛错', async () => {
        const svc = new EntryService(memIO());
        await expect(svc.writeNote('nope')).rejects.toThrow('not found');
    });
});

describe('EntryService 自定义数据目录（libraryDir 接入）', () => {
    it('catalog 与笔记均写入自定义目录', async () => {
        const io = memIO();
        const svc = new EntryService(io, 'MyLib/catalog.json', 'MyLib/entries');
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        expect(io.files['MyLib/catalog.json']).toContain('沙丘');
        const path = await svc.writeNote(e.id);
        expect(path).toBe('MyLib/entries/movie/沙丘.md');
        expect(io.files['MyLib/entries/movie/沙丘.md']).toContain('> [!bookinfo]+ **《沙丘》**');
    });

    it('空目录回退默认 ReelLudic（不产生 /catalog.json 根路径）', async () => {
        const io = memIO();
        const dir = '';
        const safe = dir.trim() || 'ReelLudic';
        const svc = new EntryService(io, `${safe}/catalog.json`, `${safe}/entries`);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        expect(io.files['ReelLudic/catalog.json']).toContain('沙丘');
    });
});

describe('EntryService advanceReading 阅读进度推进', () => {
    it('仅书籍可用，非 book 抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await expect(svc.advanceReading(e.id, { page: 10 })).rejects.toThrow('only for book');
    });

    it('页码推进：写入 page 与 totalPage', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        const r = await svc.advanceReading(e.id, { page: 128, totalPage: 340 });
        expect(r.readingProgress?.page).toBe(128);
        expect(r.readingProgress?.totalPage).toBe(340);
    });

    it('percent + totalPage 自动换算页码（50% × 340 → 170）', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        const r = await svc.advanceReading(e.id, { percent: 50, totalPage: 340 });
        expect(r.readingProgress?.page).toBe(170);
        expect(r.readingProgress?.totalPage).toBe(340);
    });

    it('只推进页码保留已有 totalPage', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内', readingProgress: { page: 10, totalPage: 340 } });
        const r = await svc.advanceReading(e.id, { page: 200 });
        expect(r.readingProgress?.page).toBe(200);
        expect(r.readingProgress?.totalPage).toBe(340);
    });

    it('page 超过 totalPage 抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await expect(svc.advanceReading(e.id, { page: 999, totalPage: 340 })).rejects.toThrow('exceeds');
    });

    it('percent 越界（<0 或 >100）抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await expect(svc.advanceReading(e.id, { percent: -1, totalPage: 340 })).rejects.toThrow('out of range');
        await expect(svc.advanceReading(e.id, { percent: 101, totalPage: 340 })).rejects.toThrow('out of range');
    });

    it('percent 无 totalPage 抛错（无法换算）', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await expect(svc.advanceReading(e.id, { percent: 50 })).rejects.toThrow('totalPage');
    });

    it('不存在的条目抛 not found', async () => {
        const svc = new EntryService(memIO());
        await expect(svc.advanceReading('nope', { page: 1 })).rejects.toThrow('entry not found');
    });
});

describe('EntryService writeNote 合并写入策略 C', () => {
    it('已有笔记含摘抄区 → 重写模板后摘抄区保留', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await svc.writeNote(e.id);
        const p1 = await svc.get(e.id);
        // 模拟用户在笔记里添加了摘抄区
        const note = io.files[p1!.notePath!];
        const withExcerpt = note.replace(
            '## 相关链接',
            '## 摘抄\n\n> 所谓「比较优势」\n\n**p.128** · 心得：x\n^bk001a\n\n## 相关链接',
        );
        io.files[p1!.notePath!] = withExcerpt;
        // 更新条目触发重写
        await svc.update(e.id, { rating: 5 });
        await svc.writeNote(e.id);
        const final = io.files[p1!.notePath!];
        expect(final).toContain('## 摘抄');
        expect(final).toContain('> 所谓「比较优势」');
        expect(final).toContain('^bk001a');
        expect(final).toContain('rating: 5');
        expect(final.indexOf('## 摘抄')).toBeLessThan(final.indexOf('## 相关链接'));
    });

    it('已有笔记无摘抄区 → 重写后不产生摘抄区', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '乡土中国' });
        await svc.writeNote(e.id);
        const p = await svc.get(e.id);
        await svc.writeNote(e.id);
        expect(io.files[p!.notePath!]).not.toContain('## 摘抄');
    });

    it('首次写入（无旧笔记）→ 正常生成无摘抄区', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '债务危机' });
        const path = await svc.writeNote(e.id);
        expect(io.files[path]).toContain('> [!bookinfo]+ **《债务危机》**');
        expect(io.files[path]).not.toContain('## 摘抄');
    });
});

describe('EntryService addExcerpt 摘抄追加', () => {
    it('仅书籍可用，非 book 抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await expect(svc.addExcerpt(e.id, { quote: 'x' })).rejects.toThrow('only for book');
    });

    it('无笔记时先生成笔记再追加摘抄', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '置身事内' });
        const r = await svc.addExcerpt(e.id, { quote: '引用一', page: 128, note: '心得x' });
        expect(r.count).toBe(1);
        const cur = await svc.get(e.id);
        const note = io.files[cur!.notePath!];
        // 有心得 → 原文仅加粗（用户 2026-09-19）
        expect(note).toContain('> **引用一**');
        expect(note).toContain('> [!quote] 第 128 页');
        expect(note).toContain('> ***');
        expect(note).toContain('> 心得x');
        expect(note).toContain('^bk');
        expect(note).toContain('## 摘抄');
        // 头行尾追加「回到原文」深链（同日方案 A）：entryId 由 addExcerpt 注入，block 与块内 id **同源**
        // ⚠️ 提取正则跟着 D-3 的文案走（`[↩ 回到原文]`）—— 只写 `[↩]` 会匹配不到
        const deepBlock = /\[↩[^\]]*\]\([^)]*block=([\w-]+)\)/.exec(note)?.[1] ?? '';
        expect(deepBlock.startsWith('bk')).toBe(true);
        expect(note).toContain(`[↩ 回到原文](obsidian://reelludic?action=jump&book=${e.id}&block=${deepBlock})`);
        // 本条无 bookFile → 无 wikilink，块 id 落在块尾 `^bk…`；断言深链里的 id 与它是同一个
        expect(new RegExp(`\\n\\^${deepBlock}\\b`).test(note)).toBe(true);
    });

    // #326：视频侧写入（时间戳 / 截图）走**泛型区段追加** —— 与摘抄共用建区段机制，但不维护摘抄计数
    it('appendNoteSection：无区段则创建、有则追加；两个区段互不干扰', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });

        await svc.appendNoteSection(e.id, '![[沙丘 0-03.png]]\n[0:03](沙丘.mp4#t=3)', '截图');
        const p = (await svc.get(e.id))!.notePath!;
        let note = io.files[p];
        expect(note).toContain('## 截图');
        expect(note).toContain('![[沙丘 0-03.png]]');
        expect(note).toContain('[0:03](沙丘.mp4#t=3)');

        // 再追加一条 → 仍只有一个「## 截图」标题，两条内容都在
        await svc.appendNoteSection(e.id, '![[沙丘 1-20.png]]', '截图');
        note = io.files[p];
        expect(note.match(/^## 截图$/gm)?.length).toBe(1);
        expect(note).toContain('![[沙丘 0-03.png]]');
        expect(note).toContain('![[沙丘 1-20.png]]');

        // 另一个区段独立存在，且不动截图区；同时**返回起始行号**（供宿主把视图滚到插入处）
        const { line } = await svc.appendNoteSection(e.id, '[1:00](沙丘.mp4#t=60)', '时间戳');
        note = io.files[p];
        expect(note.match(/^## 时间戳$/gm)?.length).toBe(1);
        expect(note).toContain('[1:00](沙丘.mp4#t=60)');
        expect(note.match(/^## 截图$/gm)?.length).toBe(1);
        expect(note.split('\n')[line]).toContain('[1:00](沙丘.mp4#t=60)');
    });

    it('appendNoteSection：空内容直接返回（不建区段、不写盘）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        const before = Object.keys(io.files).length;
        await svc.appendNoteSection(e.id, '   ', '截图');
        expect(Object.keys(io.files).length).toBe(before);
    });

    it('再次追加保留原有摘抄（id 唯一性）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await svc.addExcerpt(e.id, { quote: '引用一' });
        const r2 = await svc.addExcerpt(e.id, { quote: '引用二', page: 203 });
        expect(r2.count).toBe(2);
        const cur = await svc.get(e.id);
        const note = io.files[cur!.notePath!];
        expect(note).toContain('> 引用一');
        expect(note).toContain('> 引用二');
        expect(note.indexOf('> 引用一')).toBeLessThan(note.indexOf('> 引用二'));
    });

    it('不存在的条目抛 not found', async () => {
        const svc = new EntryService(memIO());
        await expect(svc.addExcerpt('nope', { quote: 'x' })).rejects.toThrow('entry not found');
    });
});

describe('EntryService addPlaySession/removePlaySession 游玩记录', () => {
    it('仅游戏可用，非 game 抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await expect(svc.addPlaySession(e.id, { date: '2026-08-01', minutes: 30 })).rejects.toThrow('only for game');
    });

    it('追加游玩记录：明细入账 + 笔记「游玩记录」章节同步更新；playtimeMinutes（手动总时长）不受影响', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'game', title: '黑神话悟空', playtimeMinutes: 120 });
        const r = await svc.addPlaySession(e.id, { date: '2026-08-01', minutes: 45, note: '刚打过虎先锋' });
        expect(r.playSessions).toHaveLength(1);
        expect(r.playSessions![0]).toMatchObject({ date: '2026-08-01', minutes: 45, note: '刚打过虎先锋' });
        // 总时长手动填写，记录不自动累计
        expect(r.playtimeMinutes).toBe(120);
        // 笔记已生成且包含新记录
        const note = io.files['ReelLudic/笔记/game/黑神话悟空.md'];
        expect(note).toBeTruthy();
        expect(note).toContain('## 游玩记录');
        expect(note).toContain('**2026-08-01** · 0.8h · 刚打过虎先锋');
    });

    it('多次追加按序入账，playtimeMinutes 不变', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'game', title: '塞尔达', playtimeMinutes: 300 });
        await svc.addPlaySession(e.id, { date: '2026-08-01', minutes: 30 });
        const r = await svc.addPlaySession(e.id, { date: '2026-08-02', minutes: 90 });
        expect(r.playSessions).toHaveLength(2);
        expect(r.playtimeMinutes).toBe(300);
    });

    it('无 playtimeMinutes 时保持 undefined（不自动派生）', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'game', title: '星露谷' });
        const r = await svc.addPlaySession(e.id, { date: '2026-08-03', minutes: 60 });
        expect(r.playtimeMinutes).toBeUndefined();
    });

    it('删除指定游玩记录并同步重写笔记；playtimeMinutes 不受影响', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'game', title: '艾尔登法环', playtimeMinutes: 200 });
        await svc.addPlaySession(e.id, { date: '2026-08-01', minutes: 30 });
        await svc.addPlaySession(e.id, { date: '2026-08-02', minutes: 90 });
        const r = await svc.removePlaySession(e.id, 0);
        expect(r.playSessions).toHaveLength(1);
        expect(r.playSessions![0].date).toBe('2026-08-02');
        expect(r.playtimeMinutes).toBe(200);
    });

    it('index 越界抛错', async () => {
        const svc = new EntryService(memIO());
        const e = await svc.create({ type: 'game', title: '双人成行' });
        await expect(svc.removePlaySession(e.id, 0)).rejects.toThrow('session index');
    });

    it('不存在的条目抛 not found', async () => {
        const svc = new EntryService(memIO());
        await expect(svc.addPlaySession('nope', { date: '2026-08-01', minutes: 30 })).rejects.toThrow('entry not found');
    });
});

describe('EntryService 活动日志（今日记录数据源）', () => {
    const readCatalog = (io: { files: Record<string, string> }) =>
        JSON.parse(io.files['ReelLudic/catalog.json']) as { activityLog?: { at: string; id: string; status: string }[] };

    it('setStatus 追加一条状态记录（含时间戳与目标状态）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' }); // want
        await svc.setStatus(e.id, 'watching');
        const log = readCatalog(io).activityLog ?? [];
        expect(log).toHaveLength(1);
        expect(log[0].id).toBe(e.id);
        expect(log[0].status).toBe('watching');
        expect(new Date(log[0].at).getTime()).toBeGreaterThan(0);
    });

    it('update 改了状态才记；只改其他字段不记（防表单保存刷日志）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.update(e.id, { rating: 5 }); // 状态未变 → 不记
        await svc.update(e.id, { status: 'watched' }); // 状态变 → 记
        expect((readCatalog(io).activityLog ?? []).map((x) => x.status)).toEqual(['watched']);
    });

    it('连续变更按时间顺序累积', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.setStatus(e.id, 'watching');
        await svc.setStatus(e.id, 'watched');
        expect((readCatalog(io).activityLog ?? []).map((x) => x.status)).toEqual(['watching', 'watched']);
    });

    it('超出上限截断最旧（保留最近 500 条，新的在末尾）', async () => {
        const io = memIO();
        const old = Array.from({ length: ACTIVITY_LOG_LIMIT }, (_, i) => ({
            at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
            id: 'e_seed',
            status: 'want',
        }));
        io.files['ReelLudic/catalog.json'] = JSON.stringify({
            version: 1,
            entries: [{ id: 'e_seed', type: 'movie', title: '沙丘', status: 'want' }],
            activityLog: old,
        });
        const svc = new EntryService(io);
        await svc.setStatus('e_seed', 'watching');
        const log = readCatalog(io).activityLog ?? [];
        expect(log).toHaveLength(ACTIVITY_LOG_LIMIT);
        expect(log[0].at).toBe(old[1].at); // 最旧一条被挤掉
        expect(log[log.length - 1].status).toBe('watching');
    });
});

describe('笔记重写保留标注区（2026-09-18 修：此前只搬摘抄 → 「## 高亮」整区被吞）', () => {
    it('writeNote 后高亮镜像与摘抄块都在（块 id 不变）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '金刚经' });
        await svc.writeNote(e.id); // 2026-09-18 起高亮不再顺带造笔记：本用例先显式建笔记
        await svc.syncHighlightMirror(e.id, [{ quote: '应无所住而生其心', id: 'hlAAA', loc: { chapter: 1, pct: 3 } }]);
        await svc.addExcerpt(e.id, { quote: '凡所有相，皆是虚妄', note: '想法', loc: { chapter: 1, pct: 4 } });
        const notePath = (await svc.get(e.id))!.notePath!;
        await svc.writeNote(e.id);
        const after = io.files[notePath];
        expect(after).toContain('hlAAA');
        expect(parseHighlightBlocks(after).map((x) => x.id)).toEqual(['hlAAA']);
        expect(countExcerpts(after)).toBe(1);
        expect(after).toContain('## 高亮');
        expect(after).toContain('## 摘抄');
    });

    it('writeNote 幂等：连写两次仍各只有一份', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '心经' });
        await svc.writeNote(e.id);
        await svc.syncHighlightMirror(e.id, [{ quote: '照见五蕴皆空', id: 'hlBBB', loc: { chapter: 2, pct: 8 } }]);
        const notePath = (await svc.get(e.id))!.notePath!;
        await svc.writeNote(e.id);
        await svc.writeNote(e.id);
        expect(parseHighlightBlocks(io.files[notePath])).toHaveLength(1);
        expect(io.files[notePath].match(/^## 高亮$/gm)).toHaveLength(1);
    });
});

describe('syncHighlightMirror 只读镜像（2026-09-18 存储重构：高亮真源移到 JSON，笔记那份由 JSON 单向生成）', () => {
    it('🔴 无笔记 → 跳过且**不凭空生成笔记**（旧 addHighlight 会顺手 writeNote 造一本）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '坛经' });
        expect((await svc.get(e.id))!.notePath).toBeUndefined();
        const r = await svc.syncHighlightMirror(e.id, [{ quote: '菩提本无树', id: 'hlCCC' }]);
        expect(r.count).toBe(1); // 真源（JSON）里就是 1 条
        expect((await svc.get(e.id))!.notePath).toBeUndefined(); // 笔记仍然没有
        expect(Object.keys(io.files).some((p) => p.includes('笔记'))).toBe(false);
    });

    it('首次同步：写入「## 高亮」区（含提示行与块 id）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '六祖坛经' });
        await svc.writeNote(e.id);
        await svc.syncHighlightMirror(e.id, [{ quote: '本来无一物', id: 'hlDDD', loc: { chapter: 3, pct: 12 } }], {
            refLink: '书籍/坛经.txt',
        });
        const notePath = (await svc.get(e.id))!.notePath!;
        expect(io.files[notePath]).toContain('## 高亮');
        expect(io.files[notePath]).toContain(HL_MIRROR_NOTICE);
        expect(io.files[notePath]).toContain('[[书籍/坛经.txt#^hlDDD|');
        // 高亮镜像**不写**「回到原文」深链（用户 2026-09-19 裁定「只新块」）
        expect(io.files[notePath]).not.toContain('[↩');
    });

    it('高亮清空 → 整区删除（不留空标题）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '楞严经' });
        await svc.writeNote(e.id);
        await svc.syncHighlightMirror(e.id, [{ quote: '一切众生从无始来', id: 'hlEEE' }]);
        await svc.syncHighlightMirror(e.id, []);
        const notePath = (await svc.get(e.id))!.notePath!;
        expect(io.files[notePath]).not.toContain('## 高亮');
        expect(io.files[notePath]).not.toContain('hlEEE');
        expect(io.files[notePath]).toContain('> [!bookinfo]+ **《楞严经》**'); // 模板其余部分不动
        expect(io.files[notePath]).toContain('## 相关链接');
    });

    it('内容无变化 → 不写盘、指纹不刷新（幂等：不是每次打开都改笔记）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '圆觉经' });
        await svc.writeNote(e.id);
        const list = [{ quote: '知幻即离', id: 'hlFFF', loc: { chapter: 1, pct: 2 } }];
        await svc.syncHighlightMirror(e.id, list);
        const notePath = (await svc.get(e.id))!.notePath!;
        const fp1 = (await svc.get(e.id))!.noteFingerprint;
        // 只数**笔记文件**的写入（`update()` 刷指纹时会顺带写 catalog + 备份，与镜像无关）
        let noteWrites = 0;
        const orig = io.writeText.bind(io);
        io.writeText = async (p: string, c: string) => {
            if (p === notePath) noteWrites++;
            await orig(p, c);
        };
        await svc.syncHighlightMirror(e.id, list);
        expect(noteWrites).toBe(0);
        expect((await svc.get(e.id))!.noteFingerprint).toBe(fp1);
        // 变更后确实会写（反证：上面的 0 不是「永远不写」）
        await svc.syncHighlightMirror(e.id, [...list, { quote: '第二条', id: 'hlGGG' }]);
        expect(noteWrites).toBe(1);
        expect((await svc.get(e.id))!.noteFingerprint).not.toBe(fp1); // 指纹跟着刷新（防误报外部修改）
    });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 用户 2026-09-21 报：「为什么总会有笔记已被外部修改的提示」
//    真因：**插件自己**的三条写笔记路径（加摘抄 / 追加区段 / 删摘抄）只写了文件、**没刷新指纹**
//    ⇒ 下次保存该条目必然被 `noteWasExternallyModified()` 判成「外部修改」并弹二选一框
//    （与 `syncHighlightMirror` 注释里早已写明的「同类 bug」一模一样）。
//    这一组同时守住**反方向**：真·外部手改仍必须检出（⛔ 不能为了消警报把保护削掉）。
// ══════════════════════════════════════════════════════════════════════════
describe('写笔记后指纹必须同步刷新（防「笔记已被外部修改」误报）', () => {
    /** 造一本已写笔记的书，返回 [io, svc, id] */
    async function setup() {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'book', title: '指纹基线' });
        await svc.writeNote(e.id);
        return { io, svc, id: e.id };
    }

    it('🔴 addExcerpt（加摘抄）之后不得判为外部修改', async () => {
        const { svc, id } = await setup();
        await svc.addExcerpt(id, { quote: '一切有为法', note: '心得' });
        expect(await svc.noteWasExternallyModified(id)).toBe(false);
    });

    it('🔴 appendNoteSection（视频时间戳/截图）之后不得判为外部修改', async () => {
        const { svc, id } = await setup();
        await svc.appendNoteSection(id, '[0:03](x.mp4#t=3)', '时间戳');
        expect(await svc.noteWasExternallyModified(id)).toBe(false);
    });

    it('🔴 deleteExcerpt（删摘抄）之后不得判为外部修改', async () => {
        const { io, svc, id } = await setup();
        await svc.addExcerpt(id, { quote: '引用一' });
        const notePath = (await svc.get(id))!.notePath!;
        const blockId = /\^bk([\w-]+)/.exec(io.files[notePath])?.[0].slice(1) ?? '';
        expect(blockId).not.toBe('');
        await svc.deleteExcerpt(id, blockId);
        expect(await svc.noteWasExternallyModified(id)).toBe(false);
    });

    it('🔴 保护没有削弱：真·外部手改仍要检出', async () => {
        const { io, svc, id } = await setup();
        const notePath = (await svc.get(id))!.notePath!;
        io.files[notePath] += '\n\n我手动加的一行\n';
        expect(await svc.noteWasExternallyModified(id)).toBe(true);
    });

    it('🔴 采纳当前笔记为基线（用户选「保留笔记改动」）后不再重复提示，且基线跟着手改内容走', async () => {
        const { io, svc, id } = await setup();
        const notePath = (await svc.get(id))!.notePath!;
        io.files[notePath] += '\n\n我手动加的一行\n';
        expect(await svc.noteWasExternallyModified(id)).toBe(true);
        await svc.adoptNoteAsBaseline(id); // ← 用户选「保留」时调用
        expect(await svc.noteWasExternallyModified(id)).toBe(false);
        // 再手改一次 → 仍要能检出（不是把保护关掉，而是「每次外改只问一次」）
        io.files[notePath] += '\n再来一行\n';
        expect(await svc.noteWasExternallyModified(id)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 块内歌词（#396）：` ```lrc ` 块里的歌词正文归用户所有（表单填写 / 在线获取）。
// 🔴 本组最重要的一条是「模板重写不得吞掉歌词」—— 它是**静默丢数据**，用户只有在打开播放器
//    发现歌词没了、或再打开表单看到框空了的时候才会察觉。
// ─────────────────────────────────────────────────────────────────────────────
describe('EntryService 块内歌词（readNoteLrc / setNoteLrc / 模板重写保留区）', () => {
    /** 造一个带 audioPath 的音乐条目并写出笔记；额外返回写盘计数器 */
    async function music() {
        const base = memIO();
        let writes = 0;
        const io: VaultIO & { files: Record<string, string> } = {
            ...base,
            files: base.files,
            async readText(p: string) {
                return base.readText(p);
            },
            async writeText(p: string, c: string) {
                writes++;
                return base.writeText(p, c);
            },
            async deleteFile(p: string) {
                return base.deleteFile(p);
            },
        };
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'music', title: '夜曲', audioPath: 'ReelLudic/music/夜曲.mp3' });
        await svc.writeNote(e.id);
        const notePath = (await svc.get(e.id))!.notePath!;
        return { io, svc, id: e.id, notePath, writes: () => writes };
    }

    const LRC = '[00:01.00]一群嗜血的蚂蚁\n[00:05.00]被腐肉所吸引';

    it('生成的笔记含 ```lrc 块与 source 指令行（模板侧不变）', async () => {
        const { io, notePath } = await music();
        expect(io.files[notePath]).toContain('```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n```');
    });

    it('无笔记 / 无歌词 / 只有指令行 ⇒ readNoteLrc 返回空串（不是 null）', async () => {
        const { svc, id } = await music();
        expect(await svc.readNoteLrc(id)).toBe('');
        expect(await svc.readNoteLrc('nope')).toBe('');
    });

    it('setNoteLrc 写进笔记并能原样读回；返回 true', async () => {
        const { io, svc, id, notePath } = await music();
        expect(await svc.setNoteLrc(id, LRC)).toBe(true);
        expect(io.files[notePath]).toContain(LRC);
        expect(await svc.readNoteLrc(id)).toBe(LRC);
    });

    it('🔴 写歌词后**指纹必须同步刷新**（否则下次编辑条目会误报「笔记被外部修改」）', async () => {
        const { svc, id } = await music();
        await svc.setNoteLrc(id, LRC);
        expect(await svc.noteWasExternallyModified(id)).toBe(false);
    });

    it('🔴 内容无变化 ⇒ 不写盘（返回 false；逐字比对，别每次保存都白写一遍）', async () => {
        const { svc, id, writes } = await music();
        await svc.setNoteLrc(id, LRC);
        const before = writes();
        expect(await svc.setNoteLrc(id, LRC)).toBe(false);
        expect(await svc.setNoteLrc(id, `  ${LRC}  `)).toBe(false); // 首尾空白视作同一份
        expect(writes()).toBe(before);
    });

    it('🔴 笔记里的块是**手写形态**（指令行后多留空行）且歌词内容一致 ⇒ 仍不写盘'
        + '（判据是「歌词一样」，⛔ 不是「重建后的整篇字符串一样」—— 否则每次保存都会顺手把用户的排版规整一遍）', async () => {
        const { io, svc, id, notePath, writes } = await music();
        io.files[notePath] = io.files[notePath].replace(
            '```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n```',
            '```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n\n\n[00:01.00]一群嗜血的蚂蚁\n[00:05.00]被腐肉所吸引\n\n```',
        );
        expect(await svc.readNoteLrc(id)).toBe(LRC); // 手写形态读出来仍是同一份歌词
        const before = writes();
        expect(await svc.setNoteLrc(id, LRC)).toBe(false);
        expect(writes()).toBe(before);
        expect(io.files[notePath]).toContain('夜曲.mp3]]\n\n\n[00:01.00]'); // 排版一字未动
    });

    it('传空串 ⇒ 清空歌词并写盘（「清了框还能生效」的实现）', async () => {
        const { io, svc, id, notePath } = await music();
        await svc.setNoteLrc(id, LRC);
        expect(await svc.setNoteLrc(id, '')).toBe(true);
        expect(await svc.readNoteLrc(id)).toBe('');
        expect(io.files[notePath]).toContain('```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n```');
    });

    it('无笔记条目的条目 ⇒ false（不凭空造笔记：歌词是笔记里的一段）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'music', title: '夜曲' }); // 未 writeNote ⇒ 无 notePath
        expect(await svc.setNoteLrc(e.id, LRC)).toBe(false);
    });

    it('🔴🔴 模板重写**不得吞掉歌词**（writeNote 的第三处保留区）', async () => {
        const { io, svc, id, notePath } = await music();
        await svc.setNoteLrc(id, LRC);
        await svc.update(id, { rating: 5 });
        await svc.writeNote(id); // ← 整篇模板重写
        const final = io.files[notePath];
        expect(final).toContain('[00:01.00]一群嗜血的蚂蚁');
        expect(final).toContain('[00:05.00]被腐肉所吸引');
        expect(final).toContain('rating: 5');
        // 指令行仍由模板按 audioPath 决定（歌词正文不会把指令行顶掉）
        expect(final).toContain('source [[ReelLudic/music/夜曲.mp3]]');
        expect(await svc.readNoteLrc(id)).toBe(LRC);
    });

    it('🔴 `audioPath` 改了 ⇒ 指令行跟着改，歌词正文照旧保留（分工不混）', async () => {
        const { io, svc, id, notePath } = await music();
        await svc.setNoteLrc(id, LRC);
        await svc.update(id, { audioPath: 'ReelLudic/music/新路径.mp3' });
        await svc.writeNote(id);
        expect(io.files[notePath]).toContain('source [[ReelLudic/music/新路径.mp3]]');
        expect(io.files[notePath]).not.toContain('source [[ReelLudic/music/夜曲.mp3]]');
        expect(io.files[notePath]).toContain('[00:01.00]一群嗜血的蚂蚁');
    });

    it('🔴 歌词与摘抄区互不干扰（两处保留区同一次重写里都搬回）', async () => {
        const base = memIO();
        const svc = new EntryService(base);
        const e = await svc.create({ type: 'book', title: '置身事内' });
        await svc.writeNote(e.id);
        const p = (await svc.get(e.id))!.notePath!;
        base.files[p] = base.files[p].replace('## 相关链接', '## 摘抄\n\n> 所谓「比较优势」\n\n**p.128** · 心得：x\n^bk001a\n\n## 相关链接');
        await svc.update(e.id, { rating: 4 });
        await svc.writeNote(e.id);
        const final = base.files[p];
        expect(final).toContain('^bk001a');
        expect(final).toContain('## 摘抄');
        expect(final).not.toContain('```lrc'); // 非音乐条目：不会被歌词逻辑塞进一个块
    });

    it('非音乐条目：`writeNote` 不会因为歌词逻辑而改动笔记（无 lrc 块 ⇒ 两个纯函数都原样返回）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        const path = await svc.writeNote(e.id);
        const first = io.files[path];
        await svc.writeNote(e.id);
        // 两次重写结果逐字相同 ⇒ 保留区没有引入任何多余改动
        expect(io.files[path]).toBe(first);
    });
});
