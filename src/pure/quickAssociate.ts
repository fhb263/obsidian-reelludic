// 快捷关联弹窗规整纯逻辑（可单测）：影视集数组 → 落库结果。
// 与编辑表单保存同语义：**保位**（index i 恒 = 第 i+1 集，空位留洞、尾部空位去掉、整段空 → 字段缺省不写）——
// 规整函数本体在 `pure/episodeAssoc.storeEpisodeList`（三处入口共用一份，⛔ 别在这里再写一套）：
// 🔴 2026-10-01 #446 之前这里是「压缩空位保序」，与读侧的按下标配对（选集弹窗 / 集按钮）矛盾 ⇒ 集标题会前移一格。
// totalEpisodes 仅在用户显式改变时产出（movie 恒 1 不产）。
import { storeEpisodeList } from 'pure/episodeAssoc';

export interface QuickAssocEpisodeInput {
    /** 本地路径集（index 0 = 第 1 集；undefined/空串 = 未关联） */
    files: (string | undefined)[];
    /** 网络地址集（同上标语义） */
    urls: (string | undefined)[];
    /** 集标题集（同上） */
    titles: (string | undefined)[];
    /** 当前总集数（截取到该长度） */
    total: number;
    /** 条目原有总集数（tv/anime；movie 传 undefined） */
    origTotal?: number;
    /** 是否允许产出 totalEpisodes（movie=false） */
    allowTotalChange: boolean;
}

export interface QuickAssocEpisodeResult {
    episodeFiles?: string[];
    episodeUrls?: string[];
    episodeTitles?: string[];
    totalEpisodes?: number;
}

/** 影视集数组规整：保位 + trim；totalEpisodes 仅在变化时产出 */
export function buildEpisodeAssocResult(input: QuickAssocEpisodeInput): QuickAssocEpisodeResult {
    const n = Number.isInteger(input.total) && input.total > 0 ? input.total : 0;
    const files = storeEpisodeList(input.files, n);
    const urls = storeEpisodeList(input.urls, n);
    const titles = storeEpisodeList(input.titles, n);
    const out: QuickAssocEpisodeResult = {};
    if (files) out.episodeFiles = files;
    if (urls) out.episodeUrls = urls;
    if (titles) out.episodeTitles = titles;
    if (input.allowTotalChange && n > 0 && n !== (input.origTotal ?? 0)) {
        out.totalEpisodes = n;
    }
    return out;
}

/** 当前截取范围内是否至少填了一集源（网络或本地）——保存校验用 */
export function hasAnyEpisodeSource(files: (string | undefined)[], urls: (string | undefined)[], total: number): boolean {
    const n = Number.isInteger(total) && total > 0 ? total : 0;
    for (let i = 0; i < n; i++) {
        if (i < files.length && files[i]?.trim()) return true;
        if (i < urls.length && urls[i]?.trim()) return true;
    }
    return false;
}
