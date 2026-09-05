import { describe, it, expect } from 'vitest';
import { EntryService } from 'services/EntryService';
import type { VaultIO } from 'data/catalog';

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
        expect(path).toBe('ReelLudic/笔记/电视剧/葬送的芙莉莲.md');
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
        expect(path).toBe('MyLib/entries/电影/沙丘.md');
        expect(io.files['MyLib/entries/电影/沙丘.md']).toContain('> [!bookinfo]+ **《沙丘》**');
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
        expect(note).toContain('> 引用一');
        expect(note).toContain('**p.128**');
        expect(note).toContain('^bk');
        expect(note).toContain('## 摘抄');
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
        const note = io.files['ReelLudic/笔记/游戏/黑神话悟空.md'];
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
