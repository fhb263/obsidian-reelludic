// catalog.json 写前备份（纯逻辑：快照封装 / 解析 / 追加与截断；无 obsidian、无 IO）
//
// 背景：catalog.json 是**全量重写**（每次 save 把整库 serialize 后整份落盘），
// 一次异常的写入就能覆盖掉整个库；而此前唯一的备份手段是设置页「手动导出 JSON」。
//
// 形态沿革（2026-09-14 用户裁定）：
//   旧 = 一版一个文件，放 `<媒体库目录>/.backups/catalog-YYYYMMDD-HHmmss.json`（保 5 份 → 5 个文件）
//   新 = **单文件** `<媒体库目录>/catalog-backups.json`，内含最近 N 版快照（新的在前）
//   用户原话：「catalog 就没有单文件的备份方案了吗，太多文件我管理不过来」
//   —— 语义完全不变（仍是"覆盖前留旧内容、最多留 N 版"），只是把 N 个文件收成 1 个。
//
// 为什么快照存**原文文本**而不是解析后的对象：备份要能原样还原（哪怕内容是手工改坏的半成品），
// 解析成对象再序列化会丢掉原始形态与格式差异。
//
// 目录约定：备份文件与 catalog.json 同级（`<媒体库目录>/catalog-backups.json`），
// 不在 main.ts 的 vault 监听范围内（监听只认 `catalog.json` 与 `笔记/`），因此写备份不会自激刷新。

/** 备份文件名（与 catalog.json 同级） */
export const BACKUP_FILE = 'catalog-backups.json';

/** 旧的多文件备份目录：**只读一次用于导入**，导入并校验通过后旧文件被清理，此后不再写入 */
export const LEGACY_BACKUP_DIR = '.backups';

/** 备份文件结构版本（与 catalog 的 version 无关；本文件自身格式若变更，靠它区分） */
export const BACKUP_SCHEMA = 1;

/** 保留的快照版数（含最新一版） */
export const BACKUP_KEEP = 5;

/** 写在备份文件里的自说明（用户打开文件就知道怎么还原） */
export const BACKUP_HINT =
    'catalog.json 的滚动备份（单文件，保留最近若干版，新的在前）。' +
    '还原某一版：把该版 snapshots[i].text 的字符串内容（即 catalog JSON 原文）写回 catalog.json 即可。';

export interface BackupSnapshot {
    /** 生成该快照的本地时间（人类可读，便于按时间认档） */
    at: string;
    /** 该版条目数（仅展示用，不参与逻辑；解析不出为 -1） */
    entries: number;
    /** 该版 catalog.json 的**原文** */
    text: string;
}

export interface BackupFile {
    schema: number;
    hint: string;
    snapshots: BackupSnapshot[];
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * 快照时间戳：`YYYY-MM-DD HH:mm:ss`（本地时间、秒精度）。
 * 为何不用 toISOString：那是 UTC，用户按时间认档会差 8 小时。
 */
export function backupStamp(d: Date): string {
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    return `${date} ${time}`;
}

export function emptyBackupFile(): BackupFile {
    return { schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: [] };
}

/** 统计 catalog 原文的条目数；解析不出返回 -1（仅用于展示，绝不影响逻辑） */
export function countEntries(text: string): number {
    try {
        const raw = JSON.parse(text) as { entries?: unknown };
        return Array.isArray(raw?.entries) ? raw.entries.length : -1;
    } catch {
        return -1;
    }
}

/**
 * 解析备份文件文本。
 * 文件缺失（null/undefined/空串）/ JSON 损坏 / 结构不符 → 返回**空备份**，绝不抛错：
 * 备份文件本身坏掉不该反过来阻断 catalog 的写入与加载。
 * 逐个快照做形状校验，丢掉坏的、留下好的（不因一条脏记录丢掉整份备份）。
 */
export function parseBackupFile(text: string | null | undefined): BackupFile {
    if (!text || !text.trim()) return emptyBackupFile();
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return emptyBackupFile();
    }
    const snaps = (raw as { snapshots?: unknown })?.snapshots;
    if (!Array.isArray(snaps)) return emptyBackupFile();
    const out: BackupSnapshot[] = [];
    for (const s of snaps) {
        const o = s as Partial<BackupSnapshot> | null;
        if (!o || typeof o.text !== 'string') continue;
        out.push({
            at: typeof o.at === 'string' ? o.at : '',
            entries: typeof o.entries === 'number' && Number.isFinite(o.entries) ? o.entries : -1,
            text: o.text,
        });
    }
    return { schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: out };
}

export function serializeBackupFile(bf: BackupFile): string {
    return JSON.stringify({ schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: bf.snapshots }, null, 2);
}

/**
 * 追加一版快照（**新的在前**）并截断到 keep 版。
 *
 * - 与最新一版**内容完全相同** → 原样返回入参（引用相等，调用方可据此跳过写盘）——
 *   否则光是反复切换状态就会刷出一堆同内容快照。
 * - keep ≤ 0 视为 1：至少要留住最新那版，避免「轮转把备份清空」这种自毁。
 * - 不修改入参（返回新对象）。
 */
export function pushSnapshot(bf: BackupFile, snap: BackupSnapshot, keep: number = BACKUP_KEEP): BackupFile {
    const k = Math.max(1, Math.floor(keep) || 1);
    if (bf.snapshots[0]?.text === snap.text) return bf;
    const next = [snap, ...bf.snapshots].slice(0, k);
    return { schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: next };
}

// ── 旧多文件备份的兼容（一次性导入用） ──

/** 旧命名：catalog-YYYYMMDD-HHmmss.json */
const LEGACY_NAME_RE = /^catalog-(\d{8})-(\d{6})\.json$/;

/**
 * 旧备份文件名 → 可排序时间戳（`YYYYMMDDHHmmss`）；
 * 不符命名规范 → null（非本插件产物：不导入、也不删）。
 */
export function legacyBackupStamp(name: string): string | null {
    const m = LEGACY_NAME_RE.exec(name);
    return m ? m[1] + m[2] : null;
}

/** 旧文件名 → 人类可读时间（`YYYY-MM-DD HH:mm:ss`），用于导入后的快照 `at`；不符规范返回 '' */
export function legacyStampToAt(name: string): string {
    const s = legacyBackupStamp(name);
    if (!s) return '';
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
}

/** 旧备份文件名按时间升序（旧 → 新），非规范名一律排在最后并保持原相对顺序 */
export function sortLegacyBackupNames(names: string[]): string[] {
    return [...names].sort((a, b) => {
        const sa = legacyBackupStamp(a);
        const sb = legacyBackupStamp(b);
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1;
        if (sb === null) return -1;
        return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}
