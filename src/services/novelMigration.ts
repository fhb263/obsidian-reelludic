// 网文笔记目录迁移（1.0.3.1）：书籍按子分类分目录后，把存量网文笔记从 笔记/book/ 搬进 笔记/novel/
// 设计取舍：
//  - vault 以「结构性最小接口」注入（exists / isFile / read / write / createFolder / move），
//    便于用内存假 vault 单测；main.ts 侧只做 Obsidian Vault API 的薄适配。
//  - 幂等：源在目标不在才搬；源缺而目标在只补引用；两者都缺或目标冲突一律不动——宁可不迁也不误伤用户文件。
//  - 失败静默：catalog 解析/搬迁异常一律吞掉（新条目本来就按新路径写），不阻断插件 onload。
import { BOOK_KIND_DIRS } from 'pure/dirs';

/** 迁移所需的最小 vault 能力（Obsidian Vault API 子集，便于测试替身） */
export interface NovelMigrateVault {
    /** 路径是否存在（文件或目录均可） */
    exists(path: string): boolean;
    /** 是否文件（不存在 → false） */
    isFile(path: string): boolean;
    /** 读文件文本（不存在 → 抛错） */
    read(path: string): Promise<string>;
    /** 覆写文件 */
    write(path: string, content: string): Promise<void>;
    /** 创建目录（父目录须已存在） */
    createFolder(path: string): Promise<void>;
    /** 移动文件（源不存在 → 抛错） */
    move(from: string, to: string): Promise<void>;
}

export interface NovelMigrationResult {
    /** 实际搬迁的笔记数 */
    moved: number;
    /** 仅补写引用（文件已在 novel/）的条数 */
    relinked: number;
}

/** catalog 中参与判定所需的最小子集 */
interface RawEntry {
    type?: string;
    bookKind?: string;
    notePath?: string;
}

/**
 * 迁移存量网文笔记：catalog 中 `type='book'` 且 `bookKind='novel'` 且 notePath 仍指向 `{notesDir}/book/`
 * 的条目 → 搬到 `{notesDir}/novel/` 并回写 notePath。
 * @param opts.notesDir     笔记根目录（vault 相对路径，如 `媒体库/笔记`）
 * @param opts.catalogPath  catalog.json 路径（vault 相对路径）
 */
export async function migrateNovelNotes(
    vault: NovelMigrateVault,
    opts: { notesDir: string; catalogPath: string },
): Promise<NovelMigrationResult> {
    const out: NovelMigrationResult = { moved: 0, relinked: 0 };
    let raw: { entries?: RawEntry[] };
    try {
        raw = JSON.parse(await vault.read(opts.catalogPath)) as { entries?: RawEntry[] };
    } catch {
        return out; // catalog 不存在/解析失败：跳过（新条目写新路径），下次加载重试
    }
    const legacyPrefix = `${opts.notesDir}/${BOOK_KIND_DIRS.book}/`;
    const novelDir = `${opts.notesDir}/${BOOK_KIND_DIRS.novel}`;
    let changed = false;
    try {
        for (const e of raw.entries ?? []) {
            if (e.type !== 'book' || e.bookKind !== 'novel' || typeof e.notePath !== 'string') continue;
            if (!e.notePath.startsWith(legacyPrefix)) continue;
            const target = `${novelDir}/${e.notePath.slice(legacyPrefix.length)}`;
            if (vault.isFile(e.notePath) && !vault.exists(target)) {
                if (!vault.exists(novelDir)) await vault.createFolder(novelDir);
                await vault.move(e.notePath, target);
                e.notePath = target;
                out.moved++;
                changed = true;
            } else if (!vault.exists(e.notePath) && vault.isFile(target)) {
                e.notePath = target; // 文件已在 novel/（上次迁移未落盘引用）：只补引用
                out.relinked++;
                changed = true;
            }
            // 其余情形（源与目标都缺 / 目标冲突）一律不动
        }
        if (changed) await vault.write(opts.catalogPath, JSON.stringify(raw, null, 2));
    } catch {
        // 搬迁/落盘失败：引用保持原样，下次加载重试
    }
    return out;
}
