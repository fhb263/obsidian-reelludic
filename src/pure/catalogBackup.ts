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
// 体积（2026-11-12 用户 m00353 ②-1：「catalog-backups.json 体积过大」）：
//   实测 5 版 × 24.3 万字 = 1,647,199 B ——但相邻两版真正只差 101~158 字节
//   （catalog 是全量重写，可内容高度重合）。⇒ schema 2 改**链式增量**：
//   链首存全文，其后每版只存「相对上面那一版的公共前缀 p / 公共后缀 s / 中间差异 mid」。
//   同一份库预期 1.65 MB → ~244 KB。⛔ 不用 gzip：那会把文件变成二进制、
//   破坏「打开文件就能复制回 catalog.json」这条手工还原路径，且移动端没有 node zlib
//   （`manifest.json` 是 `isDesktopOnly: false`）。纯字符串运算，全平台一致。
//
// 目录约定：备份文件与 catalog.json 同级（`<媒体库目录>/catalog-backups.json`），
// 不在 main.ts 的 vault 监听范围内（监听只认 `catalog.json` 与 `笔记/`），因此写备份不会自激刷新。

/** 备份文件名（与 catalog.json 同级） */
export const BACKUP_FILE = 'catalog-backups.json';

/** 旧的多文件备份目录：**只读一次用于导入**，导入并校验通过后旧文件被清理，此后不再写入 */
export const LEGACY_BACKUP_DIR = '.backups';

/**
 * 备份文件结构版本（与 catalog 的 version 无关；本文件自身格式若变更，靠它区分）
 *
 * 1 = 每版都快照全文（体积 = 版数 × 全文，实测 5 版 243K 字 → 1.65 MB）
 * 2 = **链式增量**：链首（最新一版）存全文，其后每版只存「相对上一版（较新那版）的差异」。
 *     实测相邻两版差异仅 101~158 字节 ⇒ 5 版整体从 1.65 MB 降到 ~244 KB。
 *     解析时还原成全文，内存里 `snapshots[i].text` 语义与 v1 完全一致
 *     ⇒ 去重比对 / 还原提示 / 展示条目数这些消费方无需改动。
 */
export const BACKUP_SCHEMA = 2;

/** v2 里 `delta.mid` 的额外体积上限：超过全文的这个比例就不做增量，直接存全文（防"完全不同"时反而变大） */
const DELTA_MAX_RATIO = 0.9;

/** 保留的快照版数（含最新一版） */
export const BACKUP_KEEP = 5;

/** 写在备份文件里的自说明（用户打开文件就知道怎么还原） */
export const BACKUP_HINT =
    'catalog.json 的滚动备份（单文件，保留最近若干版，新的在前）。' +
    '还原某一版：把该版的 catalog JSON 原文写回 catalog.json 即可。' +
    '注意：只有最新一版（snapshots[0]）的 `text` 是全文，直接复制即可；' +
    '更早的版本存成相对上一版的差异（`delta.p` / `delta.s` / `delta.mid`），' +
    '按「base 的前 p 个字符 + mid + base 的后 s 个字符」拼回（base = 数组里它**上面那一版**的全文）。' +
    '这样存是为了避免同一份近 25 万字的库被重复存 5 遍。';

/**
 * 一版相对「上一版（较新那版）」的差异：`base.slice(0,p) + mid + base.slice(len-s)`。
 * 相邻两版实测只差 100~160 字节（catalog 是全量重写但内容高度重合），
 * 存差异比存全文小两个数量级。
 */
export interface BackupDelta {
    /** 与较新那版共享的前缀字符数 */
    p: number;
    /** 与较新那版共享的后缀字符数 */
    s: number;
    /** 中间那段真正变化的文本 */
    mid: string;
}

export interface BackupSnapshot {
    /** 生成该快照的本地时间（人类可读，便于按时间认档） */
    at: string;
    /** 该版条目数（仅展示用，不参与逻辑；解析不出为 -1） */
    entries: number;
    /** 该版 catalog.json 的**原文**（内存里恒为全文，磁盘上可能存成 delta） */
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
 * 求「target 相对 base」的差异：公共前缀 p + 公共后缀 s（两者不重叠），中间段即 mid。
 * 还原恒等式：`base.slice(0, p) + mid + base.slice(base.length - s) === target`。
 *
 * ⚠️ p 与 s 的扫描**必须保证 p + s ≤ min(len)**，否则两段会重叠、还原出重复文本。
 */
export function computeDelta(base: string, target: string): BackupDelta {
    const max = Math.min(base.length, target.length);
    let p = 0;
    while (p < max && base.charCodeAt(p) === target.charCodeAt(p)) p++;
    let s = 0;
    while (s < max - p && base.charCodeAt(base.length - 1 - s) === target.charCodeAt(target.length - 1 - s)) s++;
    return { p, s, mid: target.slice(p, target.length - s) };
}

/** 按 `computeDelta` 的恒等式把差异还原成全文（对 base 无信任假设，越界即夹紧） */
export function applyDelta(base: string, d: BackupDelta): string {
    const p = Math.max(0, Math.min(Math.floor(d.p) || 0, base.length));
    const s = Math.max(0, Math.min(Math.floor(d.s) || 0, base.length - p));
    return base.slice(0, p) + d.mid + base.slice(base.length - s);
}

/** 磁盘上的快照形态：要么带全文 `text`，要么带相对上一版的 `delta`（两者必有其一） */
interface StoredSnapshot {
    at: string;
    entries: number;
    text?: string;
    delta?: BackupDelta;
}

function isDelta(o: unknown): o is BackupDelta {
    const d = o as Partial<BackupDelta> | null;
    return (
        !!d &&
        typeof d.p === 'number' &&
        Number.isFinite(d.p) &&
        typeof d.s === 'number' &&
        Number.isFinite(d.s) &&
        typeof d.mid === 'string'
    );
}

/**
 * 解析备份文件文本。
 * 文件缺失（null/undefined/空串）/ JSON 损坏 / 结构不符 → 返回**空备份**，绝不抛错：
 * 备份文件本身坏掉不该反过来阻断 catalog 的写入与加载。
 * 逐个快照做形状校验，丢掉坏的、留下好的（不因一条脏记录丢掉整份备份）。
 *
 * 兼容三种形态：
 *   · v1（`schema: 1`，每版都带全文 `text`）—— 照旧读
 *   · v2（链首 `text`，其后 `delta`）—— 顺着 base 链还原成全文
 *   · 混合（中途某版退化成全文，例如差异过大）—— 各自处理，链不断
 * 还原后内存里 `snapshots[i].text` **恒为全文**，下游（去重比对 / 还原提示 / 条目数）无需感知存储形态。
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
        const o = s as Partial<StoredSnapshot> | null;
        if (!o) continue;
        const at = typeof o.at === 'string' ? o.at : '';
        const entries = typeof o.entries === 'number' && Number.isFinite(o.entries) ? o.entries : -1;
        let full: string | null = null;
        if (typeof o.text === 'string') {
            full = o.text;
        } else if (isDelta(o.delta) && out.length > 0) {
            // 链上的 base = 数组里**上面那一版**（更新的一版）的全文
            full = applyDelta(out[out.length - 1].text, o.delta);
        }
        // 既没全文、又没可用的 base → 这一版无法还原，丢掉它（保留其余版本）
        if (full === null) continue;
        out.push({ at, entries, text: full });
    }
    return { schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: out };
}

/**
 * 序列化：链首存全文，其后每版存「相对上一版的差异」。
 *
 * 为何差异太大时退回存全文：若两版内容几乎不重合，mid 会接近全文长度，
 * 那时存 delta 反而更占空间（还要多存 p/s 两个数）⇒ 超过 `DELTA_MAX_RATIO` 就走全文，
 * 保证「增量」在任何输入下都不会比原文更大。
 */
export function serializeBackupFile(bf: BackupFile): string {
    const stored: StoredSnapshot[] = bf.snapshots.map((s, i) => {
        const base = i === 0 ? null : bf.snapshots[i - 1].text;
        if (base === null) return { at: s.at, entries: s.entries, text: s.text };
        const delta = computeDelta(base, s.text);
        const worthIt = delta.mid.length <= s.text.length * DELTA_MAX_RATIO;
        return worthIt ? { at: s.at, entries: s.entries, delta } : { at: s.at, entries: s.entries, text: s.text };
    });
    return JSON.stringify({ schema: BACKUP_SCHEMA, hint: BACKUP_HINT, snapshots: stored }, null, 2);
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
