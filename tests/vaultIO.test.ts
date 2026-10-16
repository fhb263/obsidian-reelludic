// VaultIO 目录保障：Obsidian 的 vault.create 不会自动创建父目录，
// 首次写入 ReelLudic/catalog.json 时会抛 ENOENT —— 回归测试锁定修复。
// 另锁定隐藏路径（点开头目录，如 `.backups/`）行为：Obsidian vault **不索引**这类目录
// （getAbstractFileByPath / getFiles 恒不可见），必须走低层 adapter —— 1.0.4 单文件备份的
// 旧档一次性导入曾因此扫不到旧文件，此文件防止回归。
import { describe, it, expect } from 'vitest';
import { createVaultIO } from 'services/vaultIO';
import type { VaultIO } from 'data/catalog';
// 直接 import mock 类：与 vitest 的 obsidian alias 指向同一引用，instanceof 一致；
// 且 mock 构造器接受参数，tsc 不会撞上真实 obsidian.d.ts 的私有构造函数。
import { TFile, TFolder } from './mocks/obsidian';

/**
 * `listFiles` 在 VaultIO 接口里是**可选**能力（适配器未实现时只追加不做轮转），
 * 类型上可能 undefined —— 本文件的实现必须提供它，缺了就是缺陷，直接抛错而非静默跳过。
 */
function listFiles(io: VaultIO, folder: string): Promise<string[]> {
    if (!io.listFiles) throw new Error('listFiles 未实现（适配器缺失）');
    return io.listFiles(folder);
}

/**
 * 内存 vault 替身：模拟 Obsidian Vault 的文件/文件夹行为。
 * 「索引」与「真实磁盘」分开模拟：
 * - `files` / `folders` = vault 索引（getAbstractFileByPath 只看得到这里）；
 * - `raw` = 磁盘真实内容（adapter 读写直达；隐藏文件只存在这里，索引不可见）。
 */
function memVault() {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const raw = new Map<string, string>();
    const rawFolders = new Set<string>();
    const calls: string[] = [];
    return {
        files,
        folders,
        raw,
        rawFolders,
        calls,
        getAbstractFileByPath(p: string) {
            if (files.has(p)) return new TFile(p);
            if (folders.has(p)) return new TFolder(p);
            return null;
        },
        async modify(f: TFile, content: string) {
            calls.push(`modify:${f.path}`);
            files.set(f.path, content);
            raw.set(f.path, content);
        },
        async create(p: string, content: string) {
            calls.push(`create:${p}`);
            files.set(p, content);
            raw.set(p, content);
        },
        async createFolder(p: string) {
            calls.push(`createFolder:${p}`);
            folders.add(p);
            rawFolders.add(p);
        },
        async read(f: TFile) {
            calls.push(`read:${f.path}`);
            return files.get(f.path) ?? '';
        },
        async delete(f: TFile) {
            calls.push(`delete:${f.path}`);
            files.delete(f.path);
            raw.delete(f.path);
        },
        // 🔴 #349（方案 D-7）：删除**必须走 fileManager.trashFile**（尊重用户「删除文件」偏好，可还原），
        //    ⛔ 不再用上面的 `vault.delete`（永久删除）—— 替身把两条路都记下来，便于断言「走的是哪条」。
        fileManager: {
            async trashFile(f: TFile) {
                calls.push(`trash:${f.path}`);
                files.delete(f.path);
                raw.delete(f.path);
            },
        },
        // ---- 低层 DataAdapter（真实 Obsidian：无视索引、直达磁盘；点开头目录只能走这里） ----
        adapter: {
            async mkdir(p: string) {
                calls.push(`adapter.mkdir:${p}`);
                if (rawFolders.has(p)) throw new Error('EEXIST: ' + p);
                rawFolders.add(p);
            },
            async write(p: string, content: string) {
                calls.push(`adapter.write:${p}`);
                raw.set(p, content);
            },
            async read(p: string) {
                calls.push(`adapter.read:${p}`);
                const v = raw.get(p) ?? files.get(p);
                if (v === undefined) throw new Error('ENOENT: ' + p);
                return v;
            },
            async remove(p: string) {
                calls.push(`adapter.remove:${p}`);
                if (!raw.has(p) && !rawFolders.has(p)) throw new Error('ENOENT: ' + p);
                raw.delete(p);
                rawFolders.delete(p);
            },
            async list(dir: string) {
                calls.push(`adapter.list:${dir}`);
                const prefix = dir.endsWith('/') ? dir : `${dir}/`;
                const files2 = [...raw.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
                return { files: files2, folders: [...rawFolders].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) };
            },
        },
    };
}

describe('VaultIO.writeText 目录保障', () => {
    it('父目录不存在时先创建目录再写文件（catalog.json 场景）', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('ReelLudic/catalog.json', '{}');
        expect(vault.folders.has('ReelLudic')).toBe(true);
        expect(vault.files.get('ReelLudic/catalog.json')).toBe('{}');
        expect(vault.calls).toContain('createFolder:ReelLudic');
        expect(vault.calls).toContain('create:ReelLudic/catalog.json');
    });

    it('多层父目录逐层创建（entries/xxx.md 场景）', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('ReelLudic/entries/葬送的芙莉莲.md', '# x');
        expect(vault.folders.has('ReelLudic')).toBe(true);
        expect(vault.folders.has('ReelLudic/entries')).toBe(true);
        expect(vault.files.has('ReelLudic/entries/葬送的芙莉莲.md')).toBe(true);
    });

    it('文件已存在时走 modify，不重复建目录', async () => {
        const vault = memVault();
        vault.folders.add('ReelLudic');
        vault.files.set('ReelLudic/catalog.json', '{"old":1}');
        const io = createVaultIO({ vault } as any);
        await io.writeText('ReelLudic/catalog.json', '{"new":1}');
        expect(vault.files.get('ReelLudic/catalog.json')).toBe('{"new":1}');
        expect(vault.calls).toContain('modify:ReelLudic/catalog.json');
        expect(vault.calls.filter((c) => c.startsWith('createFolder'))).toHaveLength(0);
    });

    it('目录已存在时只写文件不重复创建', async () => {
        const vault = memVault();
        vault.folders.add('ReelLudic');
        const io = createVaultIO({ vault } as any);
        await io.writeText('ReelLudic/catalog.json', '{}');
        expect(vault.calls.filter((c) => c.startsWith('createFolder'))).toHaveLength(0);
        expect(vault.files.has('ReelLudic/catalog.json')).toBe(true);
    });
});

describe('VaultIO 隐藏路径（点开头目录走 adapter）', () => {
    it('writeText：逐层 mkdir（含已存在忽略）+ adapter 直写，且不进 vault 索引', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('媒体库/.backups/catalog-20260914-211046.json', '{"v":1}');
        expect(vault.calls).toContain('adapter.mkdir:媒体库/.backups');
        expect(vault.calls).toContain('adapter.write:媒体库/.backups/catalog-20260914-211046.json');
        // 隐藏路径不进索引：getAbstractFileByPath 恒 null（真实 Obsidian 行为）
        expect(vault.getAbstractFileByPath('媒体库/.backups/catalog-20260914-211046.json')).toBeNull();
        expect(vault.raw.get('媒体库/.backups/catalog-20260914-211046.json')).toBe('{"v":1}');
    });

    it('writeText：隐藏路径二次写入不因目录已存在而失败', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('媒体库/.backups/a.json', '1');
        await io.writeText('媒体库/.backups/a.json', '2');
        expect(vault.raw.get('媒体库/.backups/a.json')).toBe('2');
    });

    it('readText：隐藏文件经 adapter.read 兜底可读', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('媒体库/.backups/a.json', 'hello');
        await expect(io.readText('媒体库/.backups/a.json')).resolves.toBe('hello');
        expect(vault.calls).toContain('adapter.read:媒体库/.backups/a.json');
    });

    it('listFiles：点开头目录也能列出（adapter.list，返回文件名）', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('媒体库/.backups/b.json', '{}');
        await io.writeText('媒体库/.backups/a.json', '{}');
        // 子目录内容不应混入
        await io.writeText('媒体库/.backups/sub/c.json', '{}');
        const names = await listFiles(io, '媒体库/.backups');
        expect([...names].sort()).toEqual(['a.json', 'b.json']);
    });

    it('listFiles：目录不存在返回空数组', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await expect(listFiles(io, '媒体库/不存在目录')).resolves.toEqual([]);
    });

    it('deleteFile：隐藏文件经 adapter.remove 删除；不存在时静默', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('媒体库/.backups/a.json', 'x');
        await io.deleteFile('媒体库/.backups/a.json');
        expect(vault.raw.has('媒体库/.backups/a.json')).toBe(false);
        await expect(io.deleteFile('媒体库/.backups/不存在.json')).resolves.toBeUndefined();
    });
});

describe('VaultIO.deleteFile', () => {
    it('🔴 文件存在时走 fileManager.trashFile（进回收站，可还原），⛔ 不再永久删除', async () => {
        const vault = memVault();
        vault.files.set('ReelLudic/entries/movie/沙丘.md', '# 沙丘');
        const io = createVaultIO({ vault, fileManager: vault.fileManager } as any);
        await io.deleteFile('ReelLudic/entries/movie/沙丘.md');
        expect(vault.files.has('ReelLudic/entries/movie/沙丘.md')).toBe(false);
        expect(vault.calls).toContain('trash:ReelLudic/entries/movie/沙丘.md');
        // 反向守卫：⛔ 不得退回 vault.delete（永久删除，误删无法挽回）
        expect(vault.calls.some((c) => c.startsWith('delete:'))).toBe(false);
    });

    it('文件不存在时静默返回（不抛错）', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault, fileManager: vault.fileManager } as any);
        await expect(io.deleteFile('ReelLudic/entries/movie/不存在.md')).resolves.toBeUndefined();
    });
});

describe('VaultIO.readText 写后必读最新（防缓存滞后）', () => {
    it('写入后立即 readText 返回最新内容，不用 cachedRead', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await io.writeText('ReelLudic/catalog.json', '{"v":1,"old":true}');
        const text = await io.readText('ReelLudic/catalog.json');
        expect(text).toBe('{"v":1,"old":true}');
        // 第二次写入模拟「状态变更」后 readText 必须拿到新值
        await io.writeText('ReelLudic/catalog.json', '{"v":1,"new":true}');
        const text2 = await io.readText('ReelLudic/catalog.json');
        expect(text2).toBe('{"v":1,"new":true}');
        expect(vault.calls.filter((c) => c.startsWith('read:')).length).toBeGreaterThanOrEqual(2);
    });

    it('文件不存在抛 ENOENT', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await expect(io.readText('ReelLudic/不存在.json')).rejects.toThrow('ENOENT');
    });
});
