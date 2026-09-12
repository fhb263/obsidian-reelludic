// 快捷关联弹窗规整纯逻辑（可单测）：影视集数组 → 落库结果。
// 与编辑表单保存同语义：压缩空位保序（index = 连续已关联序），trim 后空串移除，整段空 → 字段缺省不写；
// totalEpisodes 仅在用户显式改变时产出（movie 恒 1 不产）。
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

function compactTrim(list: (string | undefined)[], n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n && i < list.length; i++) {
        const v = list[i];
        const t = typeof v === 'string' ? v.trim() : '';
        if (t) out.push(t);
    }
    return out;
}

/** 影视集数组规整：压缩空位保序 + trim；totalEpisodes 仅在变化时产出 */
export function buildEpisodeAssocResult(input: QuickAssocEpisodeInput): QuickAssocEpisodeResult {
    const n = Number.isInteger(input.total) && input.total > 0 ? input.total : 0;
    const files = compactTrim(input.files, n);
    const urls = compactTrim(input.urls, n);
    const titles = compactTrim(input.titles, n);
    const out: QuickAssocEpisodeResult = {};
    if (files.length > 0) out.episodeFiles = files;
    if (urls.length > 0) out.episodeUrls = urls;
    if (titles.length > 0) out.episodeTitles = titles;
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
