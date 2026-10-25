// 条目回收站（「条目还原」）：记住**最近删除的 N 条条目**，供设置页一键还原。
//
// 背景（用户 2026-10-06 需求，设置页 › 封面与清理 › 「条目还原」）：
//   删除条目时笔记 / 封面 / 阅读存档 / 书签都进了回收站，但**条目记录本身**是从 catalog.json 里
//   直接抹掉的，谁也找不回来 —— 误删一个看了半年的条目，重建它 = 重填表单 + 重写笔记。
//
// 🔴 设计口径（为什么是一个**独立文件** `{lib}/trash.json`，而不是塞进 catalog.json）：
//  ⑴ catalog.json 是**用户数据的唯一真源**，也是 Bases / Dataview 面向的库：往里塞「已删除的条目」
//     会让外部查询看到幽灵行；⑵ 全量重写它的代价本来就大，回收站是低频小文件，分开写更稳；
//  ⑶ 现有删除链路 `service.remove(id)` 走的正是 catalog 的 save ⇒ 回收站记录必须**先写、再删**，
//     写回收站失败就不该继续删（宁可不删，也不能删了找不回）。
//
// 🔴 别名用**相对**路径（`封面/x.jpg` / `笔记/书籍/文学/x.md`），与 MediaEntry.poster 同一口径，
//    **前缀 `{libraryDir}/` 再拼回**。⛔ 绝对路径（库外媒体）**不进别名表**：本插件不碰库外文件，
//    也绝不替用户往库外写回任何东西。
//
// 🔴 还原时的冲突处理：原 id 空闲 → 原样复活（阅读存档 / 书签文件名都带 id，原 id 复活才能对上，
//    笔记也仍在原地）；原 id 已被新条目占用 → 换新 id 复活 + 笔记另存新名，**⛔ 不覆盖任何现存文件**。
import { createEntryId, type MediaEntry } from 'data/types';

/** 保留最近多少条可还原记录（用户点名「5 个」） */
export const TRASH_KEEP = 5;

/**
 * 回收站文件名（**英文**，用户 2026-10-22 需求：中文文件名 `条目回收站.json` → 英文）。
 * 与 `catalog.json` 同一命名口径：小写、单词、放库根。
 */
export const TRASH_FILE_NAME = 'trash.json';

/** 旧版文件名：仅在 `migrateTrashFileName` 里读一次，迁完即失效（⛔ 别再写这个名） */
export const TRASH_FILE_NAME_LEGACY = '条目回收站.json';

/** 一条已删除条目的快照 */
export interface TrashRecord {
    /** 删除时间（ISO） */
    deletedAt: string;
    /** 删除当时的条目记录（原样快照，还原时按 id 写回 catalog） */
    entry: MediaEntry;
    /**
     * 连带进回收站的文件：**库内相对**路径（相对 `{libraryDir}/`）。
     * 文件本身由 Obsidian 回收站保管（`trashFile`），本表只用来提示「哪些文件可以一起找回」。
     */
    files?: string[];
}

export interface TrashFile {
    version: number;
    records: TrashRecord[];
}

export const TRASH_VERSION = 1;

export const EMPTY_TRASH: TrashFile = { version: TRASH_VERSION, records: [] };

/** 绝对路径（盘符或 POSIX 根）：库外文件，不进回收站清单 */
const isAbsolutePath = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');

/** 库内路径归一成**相对库目录**的样子（`{libraryDir}/x` → `x`；已是相对原样返回）。
 *  ⚠️ 回收站记录**不再用这个**（记录与 `EntryAsset.path` 统一为 vault 全路径，见 `collectTrashFiles`）；
 *  保留导出是给「相对/全路径互转」这一族的老调用方与单测。 */
export function toLibraryRelative(path: string | undefined, libraryDir: string): string | undefined {
    if (!path) return undefined;
    const p = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p || isAbsolutePath(path)) return undefined;
    const lib = (libraryDir || 'ReelLudic').replace(/\/+$/, '').replace(/^\/+/, '');
    if (lib && (p === lib || p.startsWith(`${lib}/`))) {
        const rel = p === lib ? '' : p.slice(lib.length + 1);
        return rel || undefined;
    }
    return p;
}

/** 相对库目录的路径 → 存储口径（`{libraryDir}/x`）。⚠️ 封面字段存的就是相对库目录，⛔ 别重复加前缀。 */
export function fromLibraryRelative(rel: string, libraryDir: string): string {
    const lib = (libraryDir || 'ReelLudic').replace(/\/+$/, '');
    return lib ? `${lib}/${rel}` : rel;
}

/** 库内路径 → **vault 全路径**（绝对路径 / 空串 → `undefined`，调用方据此跳过：库外文件不记）。
 *  🔴 回收站记录 `files` 与附件管理用的是这个坐标系（`{libraryDir}/…`），与 `EntryAsset.path` 一致。 */
export function toVaultPath(path: string | undefined, libraryDir: string): string | undefined {
    if (!path || isAbsolutePath(path)) return undefined;
    const q = path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!q) return undefined;
    const lib = (libraryDir || 'ReelLudic').replace(/\/+$/, '').replace(/^\/+/, '');
    return lib && !q.startsWith(`${lib}/`) ? `${lib}/${q}` : q;
}

/** 推入一条删除记录：**新的在前**，超出 `keep` 截断最旧（⛔ 调用方只经此函数改 records 顺序） */
export function pushTrashRecord(file: TrashFile, record: TrashRecord, keep: number = TRASH_KEEP): TrashFile {
    const records = [record, ...normalizeTrashRecords(file.records)].slice(0, Math.max(0, keep));
    return { version: TRASH_VERSION, records };
}

function isIso(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0 && !Number.isNaN(new Date(v).getTime());
}

function isEntryLike(v: unknown): v is MediaEntry {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    return typeof o.id === 'string' && o.id.length > 0 && typeof o.title === 'string';
}

/** 记录逐条校验（脏数据丢弃，不抛）；顺序保持（新→旧），顺手去重同 id 同时间的重复项 */
export function normalizeTrashRecords(raw: unknown): TrashRecord[] {
    if (!Array.isArray(raw)) return [];
    const out: TrashRecord[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const o = item as Record<string, unknown>;
        if (!isIso(o.deletedAt) || !isEntryLike(o.entry)) continue;
        const entry = o.entry as MediaEntry;
        const key = `${entry.id}@${o.deletedAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const files = Array.isArray(o.files)
            ? o.files.filter((f): f is string => typeof f === 'string' && f.length > 0)
            : undefined;
        out.push({ deletedAt: o.deletedAt, entry, files: files?.length ? files : undefined });
    }
    return out;
}

/** 解析回收站文件文本：坏 JSON / 非对象 → 空表（⛔ 不抛：坏文件不该阻断设置页） */
export function parseTrashFile(text: string): TrashFile {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { version: TRASH_VERSION, records: [] };
    }
    if (typeof raw !== 'object' || raw === null) return { version: TRASH_VERSION, records: [] };
    const o = raw as Record<string, unknown>;
    return { version: typeof o.version === 'number' ? o.version : TRASH_VERSION, records: normalizeTrashRecords(o.records) };
}

export function serializeTrashFile(file: TrashFile): string {
    const records = normalizeTrashRecords(file.records);
    const clean: TrashFile = { version: TRASH_VERSION, records };
    return JSON.stringify(clean, null, 2);
}

/** 该记录「能不能原样复活」（原 id 仍空闲） */
export function canRestoreWithSameId(record: TrashRecord, liveIds: readonly string[]): boolean {
    return !liveIds.includes(record.entry.id);
}

/** 从条目记录里收集**库内**的连带文件（封面 / 阅读存档 / 书签 / 库内媒体）。纯逻辑，供 main 落记录用。
 *  ⚠️ 笔记走 `entry.notePath`（本就是 vault 全路径），**单独处理**，语义与其余不同：其他字段存的是相对库目录。
 *
 *  🔴 路径口径 = **vault 全路径**（与 `entryAssetPlan` 的 `EntryAsset.path` 同一个坐标系）：
 *    删除时能直接拿去 `getAbstractFileByPath`，附件管理也能拿 `exists` 判存活。
 *    ⛔ 别再退回「相对库目录」—— 那会让同一个文件在两处是两种写法（`main.recordTrash` 当初就踩过）。 */
export function collectTrashFiles(entry: MediaEntry, libraryDir: string, storePaths: readonly string[] = []): string[] {
    const out: string[] = [];
    const lib = (libraryDir || 'ReelLudic').replace(/\/+$/, '');
    const push = (p: string | undefined): void => {
        if (!p || isAbsolutePath(p)) return; // 库外绝对路径的媒体不记（与 entryAssetPlan 的 deletable:false 同口径）
        // 字段值有两派口径：封面是「相对库目录」，媒体是「已含库目录」——统一成 vault 全路径（幂等，不重复加前缀）
        const q = p.replace(/\\/g, '/').replace(/^\/+/, '');
        const full = lib && !q.startsWith(`${lib}/`) ? `${lib}/${q}` : q;
        if (full && !out.includes(full)) out.push(full);
    };
    if (entry.poster && !/^https?:\/\//.test(entry.poster)) push(entry.poster);
    for (const s of storePaths) push(s);
    for (const m of [entry.bookFile, entry.audioPath, ...(entry.episodeFiles ?? [])]) push(m);
    return out;
}

/**
 * 还原用的条目：原 id 空闲 → 原样；被占用 → 换新 id。
 * `notePath` 一并改名（追加 `-{新id}`），**保留 `.md` 与目录** —— 只因笔记文件名是「按标题」
 * 生成的，两条同标题条目会撞同一个 {标题}.md（见 `data/noteGenerator.entryNotePath`）。
 * ⚠️ 换名只是让两条笔记不撞名，真正的写盘端还会再查一次占用（见 main.restoreEntry）。
 */
export function restoreEntryFor(record: TrashRecord, liveIds: readonly string[], now: Date = new Date()): { entry: MediaEntry; sameId: boolean } {
    const sameId = canRestoreWithSameId(record, liveIds);
    const stamp = now.toISOString();
    if (sameId) {
        return { entry: { ...record.entry, updatedAt: stamp }, sameId };
    }
    const rid = createEntryId(now.getTime());
    const note = record.entry.notePath;
    let notePath = note;
    if (note) {
        const slash = note.lastIndexOf('/');
        const dir = slash >= 0 ? note.slice(0, slash + 1) : '';
        const base = slash >= 0 ? note.slice(slash + 1) : note;
        notePath = `${dir}${base.replace(/\.md$/i, '')}-${rid}.md`;
    }
    return {
        entry: { ...record.entry, id: rid, notePath, noteFingerprint: undefined, updatedAt: stamp },
        sameId: false,
    };
}
