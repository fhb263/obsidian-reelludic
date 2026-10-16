// 网文笔记目录迁移单测（1.0.3.1）：存量网文笔记 笔记/book/ → 笔记/novel/
// 用内存假 vault（结构性接口）覆盖：正常搬迁 / 幂等 / 源缺目标在补引用 / 双方都缺不动 /
// 目标冲突不覆盖 / 非网文不动 / 解析失败静默 / 目录自动创建 / catalog 其余内容不丢
import { describe, it, expect } from 'vitest';
import { migrateNovelNotes, type NovelMigrateVault } from 'services/novelMigration';

const NOTES = '媒体库/笔记';
const CATALOG = '媒体库/catalog.json';

/** 内存假 vault：files 路径 → 内容；folders 由种子路径自动派生 + 可显式创建 */
function fakeVault(seed: Record<string, string>): { vault: NovelMigrateVault; files: Map<string, string>; folders: Set<string> } {
    const files = new Map<string, string>(Object.entries(seed));
    const folders = new Set<string>();
    for (const p of files.keys()) {
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    const vault: NovelMigrateVault = {
        exists: (p) => files.has(p) || folders.has(p),
        isFile: (p) => files.has(p),
        read: async (p) => {
            const c = files.get(p);
            if (c === undefined) throw new Error('ENOENT: ' + p);
            return c;
        },
        write: async (p, c) => {
            files.set(p, c);
        },
        createFolder: async (p) => {
            folders.add(p);
        },
        move: async (from, to) => {
            const c = files.get(from);
            if (c === undefined) throw new Error('ENOENT: ' + from);
            files.delete(from);
            files.set(to, c);
        },
    };
    return { vault, files, folders };
}

/** 造一份 catalog：entries 原样注入，附录其它键（验证写回不丢内容） */
function catalogWith(entries: object[], extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ version: 1, entries, activityLog: [{ at: '2026-09-13T00:00:00.000Z', id: 'e_1', status: 'watched' }], ...extra }, null, 2);
}

const novelEntry = (notePath: string) => ({ id: 'e_n', type: 'book', title: '斗罗大陆1', bookKind: 'novel', notePath });

describe('migrateNovelNotes — 存量网文笔记迁入 novel 目录', () => {
    it('网文笔记从 book/ 搬到 novel/，并回写 notePath（含目录自动创建）', async () => {
        const { vault, files, folders } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]),
            [`${NOTES}/book/斗罗大陆1.md`]: '# 斗罗大陆1',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 1, relinked: 0 });
        expect(files.has(`${NOTES}/novel/斗罗大陆1.md`)).toBe(true);
        expect(files.has(`${NOTES}/book/斗罗大陆1.md`)).toBe(false);
        expect(files.get(`${NOTES}/novel/斗罗大陆1.md`)).toBe('# 斗罗大陆1'); // 内容原样
        expect(folders.has(`${NOTES}/novel`)).toBe(true); // 目标目录被创建
        expect(JSON.parse(files.get(CATALOG) as string).entries[0].notePath).toBe(`${NOTES}/novel/斗罗大陆1.md`);
    });

    it('幂等：第二次执行零改动（不动文件、不重写 catalog）', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]),
            [`${NOTES}/book/斗罗大陆1.md`]: 'x',
        });
        await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        const before = files.get(CATALOG);
        const r2 = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r2).toEqual({ moved: 0, relinked: 0 });
        expect(files.get(CATALOG)).toBe(before); // 未重写
    });

    it('源缺失但目标已在 novel/ → 只补引用（不搬文件）', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]),
            [`${NOTES}/novel/斗罗大陆1.md`]: 'y',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 0, relinked: 1 });
        expect(JSON.parse(files.get(CATALOG) as string).entries[0].notePath).toBe(`${NOTES}/novel/斗罗大陆1.md`);
    });

    it('源与目标都不存在 → 完全不动（笔记被外部删除，不凭空改引用）', async () => {
        const { vault, files } = fakeVault({ [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]) });
        const before = files.get(CATALOG);
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 0, relinked: 0 });
        expect(files.get(CATALOG)).toBe(before);
    });

    it('目标已存在（同名冲突）→ 不搬不覆盖（宁可不迁也不丢用户文件）', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]),
            [`${NOTES}/book/斗罗大陆1.md`]: '旧',
            [`${NOTES}/novel/斗罗大陆1.md`]: '已有内容',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 0, relinked: 0 });
        expect(files.get(`${NOTES}/book/斗罗大陆1.md`)).toBe('旧');
        expect(files.get(`${NOTES}/novel/斗罗大陆1.md`)).toBe('已有内容');
    });

    it('只挑 type=book 且 bookKind=novel 的条目：文学 / 漫画存量值 / 非书籍类型 / 无 notePath 一律不动', async () => {
        const moved = [`${NOTES}/book/A.md`, `${NOTES}/book/B.md`, `${NOTES}/book/C.md`, `${NOTES}/book/D.md`];
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([
                { id: 'a', type: 'book', title: '文学', notePath: moved[0] },                    // bookKind 缺省 = 文学
                { id: 'b', type: 'book', title: '漫画', bookKind: 'comic', notePath: moved[1] },  // 已下线值
                { id: 'c', type: 'movie', title: '电影', bookKind: 'novel', notePath: moved[2] }, // 非书籍类型
                { id: 'd', type: 'book', title: '无路径', bookKind: 'novel' },                   // 无 notePath
            ]),
            [`${NOTES}/book/A.md`]: 'a', [`${NOTES}/book/B.md`]: 'b', [`${NOTES}/book/C.md`]: 'c', [`${NOTES}/book/D.md`]: 'd',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 0, relinked: 0 });
        for (const p of moved) expect(files.has(p)).toBe(true);
        expect(files.has(`${NOTES}/novel/A.md`)).toBe(false);
    });

    it('notePath 已不在 book/ 下（已是 novel/ 或自定义库路径）→ 不动', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([
                novelEntry(`${NOTES}/novel/斗罗大陆1.md`),
                novelEntry('/别的库/笔记/book/斗罗大陆1.md'),
            ]),
            [`${NOTES}/novel/斗罗大陆1.md`]: 'x',
            ['/别的库/笔记/book/斗罗大陆1.md']: 'y',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 0, relinked: 0 });
        expect(files.get('/别的库/笔记/book/斗罗大陆1.md')).toBe('y');
    });

    it('catalog 不存在 / 解析失败 → 静默返回零改动，不抛错', async () => {
        const missing = fakeVault({});
        await expect(migrateNovelNotes(missing.vault, { notesDir: NOTES, catalogPath: CATALOG })).resolves.toEqual({ moved: 0, relinked: 0 });
        const broken = fakeVault({ [CATALOG]: '{ 不是 JSON' });
        await expect(migrateNovelNotes(broken.vault, { notesDir: NOTES, catalogPath: CATALOG })).resolves.toEqual({ moved: 0, relinked: 0 });
    });

    it('写回保留 catalog 其余内容（version / activityLog 不丢）', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/斗罗大陆1.md`)]),
            [`${NOTES}/book/斗罗大陆1.md`]: 'x',
        });
        await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        const after = JSON.parse(files.get(CATALOG) as string);
        expect(after.version).toBe(1);
        expect(after.activityLog).toHaveLength(1);
    });

    it('多条网文各自搬迁，计数正确', async () => {
        const { vault, files } = fakeVault({
            [CATALOG]: catalogWith([novelEntry(`${NOTES}/book/A.md`), novelEntry(`${NOTES}/book/B.md`)]),
            [`${NOTES}/book/A.md`]: 'a', [`${NOTES}/book/B.md`]: 'b',
        });
        const r = await migrateNovelNotes(vault, { notesDir: NOTES, catalogPath: CATALOG });
        expect(r).toEqual({ moved: 2, relinked: 0 });
        expect(files.has(`${NOTES}/novel/A.md`)).toBe(true);
        expect(files.has(`${NOTES}/novel/B.md`)).toBe(true);
    });
});
