// VaultIO 目录保障：Obsidian 的 vault.create 不会自动创建父目录，
// 首次写入 ReelLudic/catalog.json 时会抛 ENOENT —— 回归测试锁定修复。
import { describe, it, expect } from 'vitest';
import { createVaultIO } from 'services/vaultIO';
// 直接 import mock 类：与 vitest 的 obsidian alias 指向同一引用，instanceof 一致；
// 且 mock 构造器接受参数，tsc 不会撞上真实 obsidian.d.ts 的私有构造函数。
import { TFile, TFolder } from './mocks/obsidian';

/** 内存 vault 替身：模拟 Obsidian Vault 的文件/文件夹行为 */
function memVault() {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const calls: string[] = [];
    return {
        files,
        folders,
        calls,
        getAbstractFileByPath(p: string) {
            if (files.has(p)) return new TFile(p);
            if (folders.has(p)) return new TFolder(p);
            return null;
        },
        async modify(f: TFile, content: string) {
            calls.push(`modify:${f.path}`);
            files.set(f.path, content);
        },
        async create(p: string, content: string) {
            calls.push(`create:${p}`);
            files.set(p, content);
        },
        async createFolder(p: string) {
            calls.push(`createFolder:${p}`);
            folders.add(p);
        },
        async read(f: TFile) {
            calls.push(`read:${f.path}`);
            return files.get(f.path) ?? '';
        },
        async delete(f: TFile) {
            calls.push(`delete:${f.path}`);
            files.delete(f.path);
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

describe('VaultIO.deleteFile', () => {
    it('文件存在时删除并记录调用', async () => {
        const vault = memVault();
        vault.files.set('ReelLudic/entries/movie/沙丘.md', '# 沙丘');
        const io = createVaultIO({ vault } as any);
        await io.deleteFile('ReelLudic/entries/movie/沙丘.md');
        expect(vault.files.has('ReelLudic/entries/movie/沙丘.md')).toBe(false);
        expect(vault.calls).toContain('delete:ReelLudic/entries/movie/沙丘.md');
    });

    it('文件不存在时静默返回（不抛错、不调用 delete）', async () => {
        const vault = memVault();
        const io = createVaultIO({ vault } as any);
        await expect(io.deleteFile('ReelLudic/entries/movie/不存在.md')).resolves.toBeUndefined();
        expect(vault.calls.filter((c) => c.startsWith('delete:'))).toHaveLength(0);
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
