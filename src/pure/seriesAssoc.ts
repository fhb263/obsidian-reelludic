// 系列「批量关联」清单的纯逻辑（可单测）：把条目的关联状态归一成「一行文案 + 一个布尔」。
//
// 🔴 起因（#629，用户：「新增系列卡片右键菜单-批量关联按钮」→ 问答裁定「逐条清单：一个弹窗内批量完成」）：
//    弹窗要把整个系列的条目列出来，逐条显示「这条关联了没有、连到哪里」。
//    关联字段按类型散落（`bookFile`/`readUrl`、`gameLaunchPath`/`gameUrl`、`audioPath`/`audioUrl`、
//    `episodeFiles`/`episodeUrls`/`links`）—— 组件里写 switch 迟早与 `pure/actionLabel.hasActionEntry`
//    那套「左键点了到底会不会有反应」的判定**分叉**（同一件事两份真源 = 本仓老病）。
//
// ⚠️ 判据与 `hasActionEntry` **同口径**：一律「**trim 后非空**」。
//    ⛔ 别用存在性判断（`in` / `!== undefined`）—— 空串与纯空格都会被当成有值（#534/#535 记过这颗雷）。
// ⚠️ 影视那一路**保留 `links` 计数**：`hasActionEntry` 认它（老条目的观看链接可能还留在那儿）
//    ⇒ 这里也必须认，否则会出现「清单说未关联、卡片却给得出 ▶」的自相矛盾。
import type { EntryType, MediaEntry } from 'data/types';

/** 关联状态归一：本地 / 网络两条路各有没有；`linked` = 两条任一（= 左键点了真会有反应） */
export interface AssocFlags {
    local: boolean;
    remote: boolean;
    linked: boolean;
    /** 本地源**条数**：影视 = 填了几集；其余三类只有单条路径 ⇒ 恒 0 / 1 */
    localCount: number;
    /** 网络源**条数**：影视 = 填了几集 ＋ 老字段 `links` 的条数；其余三类恒 0 / 1 */
    remoteCount: number;
}

/** 本地路径的**类型词**（与 `actionLabel.actionReadyHint` 同一套说法，⛔ 别另发明一套） */
export function assocLocalLabel(type: EntryType): string {
    switch (type) {
        case 'book': return '本地文件';
        case 'game': return '快捷方式';
        case 'music': return '本地音频';
        default: return '本地视频';
    }
}

/** 网络地址的**类型词**（同上；影视说「网络地址」而不是「观看链接」—— 弹窗里填的就是它） */
export function assocRemoteLabel(type: EntryType): string {
    switch (type) {
        case 'book': return '在线阅读链接';
        case 'game': return '网络路径';
        default: return '网络地址';
    }
}

/** 数组里「trim 后非空」的字符串条数（`undefined` 洞与空串都不算） */
function countFilled(list: ReadonlyArray<string | undefined> | undefined): number {
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const s of list) if (typeof s === 'string' && s.trim()) n++;
    return n;
}

/** 是否影视（`movie` / `tv` / `anime`）—— 只有它们走「逐集数组」那条路 */
function isVideoType(type: EntryType): boolean {
    return type === 'movie' || type === 'tv' || type === 'anime';
}

/**
 * 关联状态归一。⚠️ 影视的**条数**是真条数；其余三类是 `0/1`（它们只有单条路径）。
 * ⚠️ 影视的 `remoteCount` 把 `links?.length` 也算进去 —— 与 `hasActionEntry` 逐字同口径（见文件头）。
 */
export function assocFlagsOf(e: {
    type: EntryType;
    links?: ReadonlyArray<unknown>;
    episodeFiles?: ReadonlyArray<string | undefined>;
    episodeUrls?: ReadonlyArray<string | undefined>;
    bookFile?: string;
    gameLaunchPath?: string;
    audioPath?: string;
    readUrl?: string;
    gameUrl?: string;
    audioUrl?: string;
}): AssocFlags {
    if (isVideoType(e.type)) {
        const localCount = countFilled(e.episodeFiles);
        const remoteCount = countFilled(e.episodeUrls) + (e.links?.length ?? 0);
        return {
            local: localCount > 0,
            remote: remoteCount > 0,
            linked: localCount > 0 || remoteCount > 0,
            localCount,
            remoteCount,
        };
    }
    let local = false;
    let remote = false;
    switch (e.type) {
        case 'book':
            local = !!e.bookFile?.trim();
            remote = !!e.readUrl?.trim();
            break;
        case 'game':
            local = !!e.gameLaunchPath?.trim();
            remote = !!e.gameUrl?.trim();
            break;
        default: // music
            local = !!e.audioPath?.trim();
            remote = !!e.audioUrl?.trim();
            break;
    }
    return { local, remote, linked: local || remote, localCount: local ? 1 : 0, remoteCount: remote ? 1 : 0 };
}

/**
 * 一行清单里的**关联摘要**（弹窗里那一列）。
 *   · 未关联 → `未关联`；
 *   · 影视 → `已关联 · 本地 3 集 + 网络 15 集`（有几条写几条，⛔ 不出现「本地 0 集」这种噪音）；
 *   · 其余 → `已关联 · 本地文件` / `已关联 · 本地文件 + 在线阅读链接`。
 */
export function assocSummaryOf(e: Parameters<typeof assocFlagsOf>[0]): string {
    const f = assocFlagsOf(e);
    if (!f.linked) return '未关联';
    if (isVideoType(e.type)) {
        const parts: string[] = [];
        if (f.localCount > 0) parts.push(`本地 ${f.localCount} 集`);
        if (f.remoteCount > 0) parts.push(`网络 ${f.remoteCount} 集`);
        return `已关联 · ${parts.join(' + ')}`;
    }
    const parts: string[] = [];
    if (f.local) parts.push(assocLocalLabel(e.type));
    if (f.remote) parts.push(assocRemoteLabel(e.type));
    return `已关联 · ${parts.join(' + ')}`;
}

export interface SeriesAssocStats {
    total: number;
    linked: number;
    unlinked: number;
}

/** 顶部读数：只吃 `linked` 这一个布尔 ⇒ 清单行 / 条目 / 任意投影都能喂进来 */
export function seriesAssocStats(rows: ReadonlyArray<{ linked: boolean }>): SeriesAssocStats {
    const total = rows.length;
    let linked = 0;
    for (const r of rows) if (r.linked) linked++;
    return { total, linked, unlinked: total - linked };
}

/** 顶部读数文案（`共 15 部 · 已关联 3 · 待补 12`） */
export function seriesAssocHeadline(s: SeriesAssocStats): string {
    return `共 ${s.total} 部 · 已关联 ${s.linked} · 待补 ${s.unlinked}`;
}

/** 清单行（宿主投影后喂给 Svelte 组件） */
export interface SeriesAssocRow {
    id: string;
    /** 系列序号（`seriesIndex`；没配过 ⇒ undefined ⇒ 清单里不显示序号） */
    index?: number;
    title: string;
    summary: string;
    linked: boolean;
}

/** 条目 → 清单行（`index` 取原样：⛔ 别拿循环下标冒充 —— 序号是用户自己编的，可以有空档） */
export function seriesAssocRowOf(e: MediaEntry): SeriesAssocRow {
    const f = assocFlagsOf(e);
    return { id: e.id, index: e.seriesIndex, title: e.title, summary: assocSummaryOf(e), linked: f.linked };
}

/** 条目序列 → 清单行序列（顺序照传入的来 —— 排序归 `pure/seriesGroup.sortSeriesItems`） */
export function seriesAssocRows(entries: readonly MediaEntry[]): SeriesAssocRow[] {
    return entries.map(seriesAssocRowOf);
}
