/**
 * 网盘文件 → 集勾选表的纯逻辑（无 `obsidian` / 无网络 / 无 DOM，可单测）。
 *
 * 🔴 由来：用户 2026-11 拍板「关联网盘资源 + 可解码直链内置播放」。关联层对标的是
 *    `strm` 指针模式（Alist-Strm / CloudDrive2 / 小雅）：媒体库只存 URL 指针，不落盘。
 *    本仓的指针位就是 `episodeUrls[i]`（下标 i = 第 i+1 集，与 `episodeFiles` 同口径）。
 *
 * 🔴 与 `pure/biliBatch` 的关系（⛔ 别合并）：那个跑的是「搜索 → 挑候选 → 填链接」，
 *    中间有网络与风控；这里跑的是「列目录 → 按文件名排序 → 对号入座」，**零网络**。
 *    两者共用的只是「一集一条 + 只填空位 + 手动优先」这套**填表纪律**，行模型不同。
 *
 * 🔴 **文件名排序是本模块的核心价值**：WebDAV 服务器返回的 href 是按**字节序**排的，
 *    `第10集` 会排在 `第2集` 前面。直接照抄顺序 ⇒ 从第 10 集开始全部错位一位。
 *    ⇒ 一律过 `naturalCompare`（数字段按数值比），排序后再对号。
 */
import type { DavEntry } from 'pure/webdav';
import { isAssociableVideoPath, isEmbeddableVideoPath } from 'pure/mediaExtensions';

/** 一行 = 一个待勾的「文件 → 集」映射 */
export interface DavFillRow {
    /** 目标集下标（0 起） */
    epIndex: number;
    /** 目标集号（1 起，给人看） */
    epNo: number;
    /** 这个文件的可播放绝对地址（= `DavEntry.url`，直接写进 `episodeUrls`） */
    url: string;
    /** 文件名（给人看，也是排序依据） */
    name: string;
    /** 字节数（0 = 服务器没给） */
    size: number;
    /** 这个文件能不能进内置播放器（mp4/webm/mov/ogv）；false 只能交系统播放器/浏览器 */
    playable: boolean;
    /** 这一集**本来就有**网络地址（⚠️ 不覆盖，默认不勾） */
    hasUrl: boolean;
    /** 超出本条目总集数（⚠️ 不参与勾选，⛔ 别让它越界写进数组） */
    outOfRange: boolean;
    /** 是否参与「填入」 */
    checked: boolean;
}

/**
 * 自然序比较（`第2集` 排在 `第10集` 前）。
 *
 * 🔴 为什么不用 `localeCompare(a, b, { numeric: true })`：那个在部分 V8 / ICU 组合下
 *    对**中英混排 + 前导零**（`第01集` / `第1集`）的判定不稳定，且本仓已有
 *    `localeCompare(..., 'zh-Hans-CN')` 用于目录排序 —— 两种口径混用会让「服务器序」
 *    和「我们排的序」在用户眼里都不可解释。这里手写：切出数字段与文本段，数字比值、文本比字典序。
 */
export function naturalCompare(a: string, b: string): number {
    const ax = splitNatural(String(a ?? ''));
    const bx = splitNatural(String(b ?? ''));
    const n = Math.min(ax.length, bx.length);
    for (let i = 0; i < n; i++) {
        const x = ax[i];
        const y = bx[i];
        if (x === y) continue;
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) {
            const d = Number(x) - Number(y);
            if (d !== 0) return d < 0 ? -1 : 1;
            // 🔴 数值相同但前导零不同（`01` vs `1`）⇒ **短的那个在前**，
            //    保证排序是**稳定且全序**的：否则 `a<b` 与 `b<a` 同时为假，多段名字会乱序。
            if (x.length !== y.length) return x.length < y.length ? -1 : 1;
            continue;
        }
        if (xn !== yn) return xn ? -1 : 1; // 数字段排文本段前（`1` vs `a`）
        return x < y ? -1 : 1;
    }
    return ax.length - bx.length;
}

/** 把字符串切成「数字段 / 非数字段」交替的数组（`第01集` → `['第','01','集']`） */
function splitNatural(s: string): string[] {
    const out: string[] = [];
    const re = /\d+|\D+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push(m[0]);
    return out;
}

/**
 * 按文件名自然序排出「该填的顺序」。**只保留视频文件**，目录与其它类型一律丢掉。
 *
 * ⚠️ 丢非视频是有意的：网盘目录里混着 `.nfo` / `.srt` / `.jpg`，若照单位置对号，
 *    每多一个非视频文件就把后面全部挤后一位 —— 那是**静默错位**，用户看不出来。
 */
export function sortDavVideos(entries: readonly DavEntry[] | undefined): DavEntry[] {
    const files = (entries ?? []).filter((e) => e && !e.isDir && !!e.name);
    const videos = files.filter((e) => !!videoNameOf(e.name));
    return videos.sort((a, b) => naturalCompare(a.name, b.name));
}

/** 文件名是不是视频 —— 一律走 `isAssociableVideoPath`（与「这个文件能不能被关联」**同一份判据**，
 *  ⛔ 别在这里另写扩展名正则：两处口径一漂，「列表里看不见的文件」和「保存后播不了的集」就会错位）。 */
function videoNameOf(name: string): string {
    return isAssociableVideoPath(name) ? name : '';
}

/**
 * 把排好序的文件**按序对号**到集上，生成勾选表。
 *
 * @param files       当前目录里**能当剧集**的文件（通常来自 `sortDavVideos`）
 * @param urls        本条目现有的 `episodeUrls`（用来标「已有链接」，⛔ 不覆盖）
 * @param anchor      从第几集开始对号（0 起；= 用户说的「这些文件是第 N 集往后」）
 * @param totalEpisodes 本条目总集数（⚠️ 缺省/非正数 ⇒ 不裁超界行，但仍标 `outOfRange`）
 *
 * 口径（三条，与 `buildBiliFillRows` 保持同一套填表纪律）：
 *  ⑴ **已有链接的集默认不勾**（用户手填的优先）；但仍列出来 ⇒ 他想覆盖可以自己勾上。
 *  ⑵ **超出总集数的行不勾、且不参与全选**（⛔ 别让它写进数组尾巴）。
 *  ⑶ 不超界、本来没链接的集**默认全勾** —— 这是常见情形（整季一次导完），
 *     逐个手点 52 下没有意义。
 */
export function buildDavFillRows(
    files: readonly DavEntry[] | undefined,
    urls: readonly (string | undefined)[] | undefined,
    anchor = 0,
    totalEpisodes?: number,
): DavFillRow[] {
    const list = files ?? [];
    const start = Number.isFinite(anchor) ? Math.max(0, Math.floor(anchor)) : 0;
    const total = Number(totalEpisodes);
    const hasTotal = Number.isFinite(total) && total > 0;
    const rows: DavFillRow[] = [];
    for (let k = 0; k < list.length; k++) {
        const e = list[k];
        const epIndex = start + k;
        const epNo = epIndex + 1;
        const outOfRange = hasTotal ? epIndex >= Math.floor(total) : false;
        const hasUrl = !!String((Array.isArray(urls) ? urls[epIndex] : '') ?? '').trim();
        rows.push({
            epIndex,
            epNo,
            url: String(e?.url ?? ''),
            name: String(e?.name ?? ''),
            size: Number(e?.size) || 0,
            playable: isEmbeddableVideoPath(String(e?.name ?? '')),
            hasUrl,
            outOfRange,
            checked: !outOfRange && !hasUrl,
        });
    }
    return rows;
}

/** 可参与勾选的行（超界的不算 —— 与 `biliSelectableRows` 同口径） */
export function davSelectableRows(rows: readonly DavFillRow[] | undefined): DavFillRow[] {
    return (rows ?? []).filter((r) => !r.outOfRange && !!r.url);
}

/** 勾中且真有地址的行 = 点「填入」时真正要写的那批 */
export function davCheckedRows(rows: readonly DavFillRow[] | undefined): DavFillRow[] {
    return (rows ?? []).filter((r) => r.checked && !r.outOfRange && !!r.url);
}

/** 勾 / 取消勾一行（⚠️ 纯函数返回新对象 —— Svelte 4 不能对数组下标 `bind:`） */
export function withDavChecked(row: DavFillRow, checked: boolean): DavFillRow {
    const want = !!checked;
    return row.checked === want ? row : { ...row, checked: want };
}

/**
 * 勾中的行 → `[集下标, 地址][]`（调用方拿它去改 `episodeUrls`）。
 * ⚠️ 超界的行**在这里再挡一次**（⛔ 不靠调用点记得判）。
 */
export function davFillPairs(rows: readonly DavFillRow[] | undefined): [number, string][] {
    const out: [number, string][] = [];
    for (const r of davCheckedRows(rows)) {
        const url = String(r.url ?? '').trim();
        if (!url) continue;
        out.push([r.epIndex, url]);
    }
    return out;
}
