// 孤儿资产判定（#349）：把「清理孤儿封面」扩成「附件清理」。
//
// 背景（用户报障）：「删除笔记条目」只删条目记录 + 笔记，**封面**与**阅读存档 JSON** 会留在库里；
// 封面原本只能去设置页点「清理孤儿封面」，而阅读存档**没有任何入口**（这就是「清理盲区」）。
//
// 🔴 本模块只做**判定**（纯逻辑，可单测），扫描与删除由 main.ts / 弹窗负责。
// 🔴 两条红线：⑴ **认不出的文件一律不算孤儿**（宁可留着，也不误删用户文件）；
//             ⑵ 封面口径**沿用** `pure/posterFile.orphanCoverFiles`（未被任何条目引用），⛔ 不放宽。
import { orphanCoverFiles } from 'pure/posterFile';
import { bookmarksFilePath } from 'pure/bookmark';
import { readerStoreFilePath } from 'pure/readerStore';

export type OrphanAssetKind = 'cover' | 'store';

export interface OrphanAsset {
    kind: OrphanAssetKind;
    /** 库内相对路径（封面 `封面/x.jpg` / 存档 `阅读进度/{name}`），与 poster 存储格式一致 */
    path: string;
    /** 展示用文件名（path 的末段） */
    name: string;
}

/** 「阅读进度」目录里文件名与条目 id 的分隔标记（按**最长**优先匹配，避免 `-阅读-` 吃掉 `-阅读进度-`） */
const ID_MARKERS = ['-阅读进度-', '-阅读-', '-书签-'];
/** 最早期的纯 id 名：e_{时间戳}_{4 位}（可带 .bookmarks 变体） */
const LEGACY_RE = /^(e_\d+_[a-z0-9]{4})(?:\.bookmarks)?\.json$/;

/**
 * 从「阅读进度」目录的文件名解析条目 id。
 * 认不出（无标记 / 末段为空 / 非 .json）→ `undefined` —— 调用方据此**不判孤儿**。
 */
export function entryIdFromStoreFile(fileName: string): string | undefined {
    if (!fileName) return undefined;
    const legacy = LEGACY_RE.exec(fileName);
    if (legacy) return legacy[1];
    if (!/\.json$/.test(fileName)) return undefined;
    const stem = fileName.slice(0, -'.json'.length);
    let at = -1;
    let len = 0;
    for (const m of ID_MARKERS) {
        const i = stem.lastIndexOf(m);
        if (i > at || (i === at && m.length > len)) {
            at = i;
            len = m.length;
        }
    }
    if (at < 0) return undefined;
    const id = stem.slice(at + len);
    return id.length > 0 ? id : undefined;
}

/** 孤儿阅读存档：文件名能解析出 id、且该 id **不在** `liveIds` 里 → 孤儿。
 *  ⚠️ 解析不出的文件**不返回**（⛔ 不误删）。 */
export function orphanStoreFiles(fileNames: string[], liveIds: string[]): string[] {
    const live = new Set(liveIds);
    return fileNames.filter((n) => {
        const id = entryIdFromStoreFile(n);
        return id !== undefined && !live.has(id);
    });
}

/**
 * 汇总扫描结果（供清理弹窗逐项勾选）：**封面在前、阅读存档在后**（顺序稳定，便于断言与阅读）。
 * `coverFiles` / `storeFiles` 传**库内相对路径**（含目录前缀，如 `封面/x.jpg`）。
 */
export function buildOrphanAssets(input: {
    coverFiles: string[];
    referencedPosters: string[];
    storeFiles: string[];
    liveIds: string[];
}): OrphanAsset[] {
    const covers = orphanCoverFiles(input.coverFiles, input.referencedPosters).map((p) => ({
        kind: 'cover' as const,
        path: p,
        name: p.split('/').pop() ?? p,
    }));
    const stores = orphanStoreFiles(input.storeFiles, input.liveIds).map((p) => ({
        kind: 'store' as const,
        path: p,
        name: p.split('/').pop() ?? p,
    }));
    return [...covers, ...stores];
}

// ─────────────────────────── 删除条目的资产计划（#350 · 方案文档 M3/M4） ───────────────────────────

export type EntryAssetKind = 'note' | 'cover' | 'store' | 'bookmark' | 'media';

/** 弹窗里的类型徽章文案（与 orphan 那套分开：这里还含笔记与媒体） */
export const ENTRY_ASSET_LABEL: Record<EntryAssetKind, string> = {
    note: '笔记',
    cover: '封面',
    store: '阅读存档',
    bookmark: '书签文件',
    media: '媒体文件',
};

export interface EntryAsset {
    kind: EntryAssetKind;
    /** vault 全路径（库外媒体为原始绝对路径，仅用于展示与提示） */
    path: string;
    /** 展示用文件名 */
    name: string;
    /** safe = 本插件生成 / 可再生成（**默认勾选**）；risky = 用户自己的文件（**默认不勾**） */
    risk: 'safe' | 'risky';
    /** false = 只展示、不提供删除（库外媒体：删它要动 OS 回收站，交给用户自己处理） */
    deletable: boolean;
    /** 附加提示（目前只有库外媒体用） */
    hint?: string;
}

/** 条目里与「有哪些本地文件」有关的字段（只取需要的部分，便于单测构造） */
export interface EntryAssetInput {
    id: string;
    title: string;
    notePath?: string;
    poster?: string;
    bookFile?: string;
    /** 🔴 #403：音乐条目的「本地音频」（下载来的歌也在这里）—— 用户：「删除条目时，支持关联删除对应的附件音频文件」 */
    audioPath?: string;
    episodeFiles?: string[];
}

const baseName = (p: string): string => p.split('/').pop() ?? p;
/** 绝对路径（库外）：盘符（`D:/…` / `D:\…`）或 POSIX 根 */
const isAbsolute = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/');
const trimDir = (d: string): string => d.replace(/\/+$/, '') || 'ReelLudic';

/**
 * 产出「删除这个条目」要按的资产计划（顺序固定，便于弹窗展示与断言）：
 * **笔记 → 封面 → 阅读存档 → 书签文件 → 媒体文件**。
 *
 * 🔴 三条口径：
 *  ⑴ **只有真实存在的文件才进清单**（`exists` 由宿主注入 vault 查询，本模块保持纯逻辑可测）；
 *  ⑵ 封面是**网络 URL** 时不算本地文件（⛔ 不把 URL 当路径去删）；
 *  ⑶ 媒体文件（书 / 影片 / **音乐条目的本地音频**）标 `risky` + 默认**不勾**；**库外**的再标 `deletable: false`
 *     （删它需要动 OS 回收站、且本插件不碰库外文件）。
 */
export function entryAssetPlan(input: { entry: EntryAssetInput; libraryDir: string; exists: (vaultPath: string) => boolean }): EntryAsset[] {
    const { entry, exists } = input;
    const lib = trimDir(input.libraryDir);
    const out: EntryAsset[] = [];
    const push = (a: EntryAsset): void => {
        out.push(a);
    };

    if (entry.notePath && exists(entry.notePath)) {
        push({ kind: 'note', path: entry.notePath, name: baseName(entry.notePath), risk: 'safe', deletable: true });
    }
    if (entry.poster && !/^https?:\/\//.test(entry.poster)) {
        const p = `${lib}/${entry.poster}`;
        if (exists(p)) push({ kind: 'cover', path: p, name: baseName(p), risk: 'safe', deletable: true });
    }
    const store = readerStoreFilePath(entry.id, entry.title, lib);
    if (exists(store)) push({ kind: 'store', path: store, name: baseName(store), risk: 'safe', deletable: true });
    const bm = bookmarksFilePath(entry.id, entry.title, lib);
    if (exists(bm)) push({ kind: 'bookmark', path: bm, name: baseName(bm), risk: 'safe', deletable: true });

    // 🔴 #403 起音频也进这一队（顺序 = 书 → 音频 → 剧集）：三类都是「用户自己的媒体文件」，
    //    共用 `media` 这个 kind 与徽章，⛔ 不为音频单开一种 kind（弹窗里看到的就是文件名，一眼能认）。
    const media = [entry.bookFile, entry.audioPath, ...(entry.episodeFiles ?? [])].filter((p): p is string => !!p);
    for (const m of media) {
        if (isAbsolute(m)) {
            push({
                kind: 'media',
                path: m,
                name: baseName(m.replace(/\\/g, '/')),
                risk: 'risky',
                deletable: false,
                hint: '库外文件，请在文件管理器中自行删除',
            });
        } else if (exists(m)) {
            push({ kind: 'media', path: m, name: baseName(m), risk: 'risky', deletable: true });
        }
    }
    return out;
}
