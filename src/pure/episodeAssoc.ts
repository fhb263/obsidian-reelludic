// 影视「集关联」共用真源（纯逻辑，可单测）：集数组落库规整 + 集按钮悬停文案。
// 三处入口（编辑表单 / 快捷关联弹窗 / catalog 落库关口）都走这里，⛔ 别各写一套。

/**
 * 集数组落库规整：**保位**（index i 恒 = 第 i+1 集）+ trim + 去尾部空位；整段空 → undefined。
 *
 * 🔴 2026-10-01 #446：**「保位」是修出来的口径，不是优化**。旧口径 = 「压缩空位保序」
 *    （`arr.filter(Boolean)` / `compactTrim`），而**读侧全是按下标读**的：
 *    `main.openWatchLinkPicker` 用 `Array.from({length:n},(_,i)=>eps[i])` 重建选集弹窗、
 *    `EpisodePickerModal` 按 `episodeFiles.forEach((p,i)=>episodeUrls[i])` 配对、
 *    `EntryForm` 的集按钮第 i 个 = 第 i+1 集 —— 只要**有一集空着**，它后面所有集的
 *    本地路径 / 网络地址 / **集标题**就整体前移一格：用户在「编辑第 2 集」里填的标题，
 *    保存后落在第 1 集上，看起来就是**保存不生效**（2026-10-01 用户报障原话）。
 *    ⇒ 空位留洞（不压缩）、尾部空位去掉（不写一长串 null）。⛔ 别再退回 filter 那套。
 *
 * @param list   任意长度的原数组（元素非法/空串/纯空白 → 该位视为未关联）
 * @param maxLen 落库长度上限（按当前总集数截取）；不传 = 全量
 */
export function storeEpisodeList(list: unknown, maxLen?: number): string[] | undefined {
    if (!Array.isArray(list)) return undefined;
    const n = typeof maxLen === 'number' && Number.isFinite(maxLen) ? Math.max(0, Math.floor(maxLen)) : list.length;
    const out: string[] = [];
    let last = -1;
    for (let i = 0; i < n && i < list.length; i++) {
        const v = list[i];
        const t = typeof v === 'string' ? v.trim() : '';
        if (t) {
            out[i] = t; // 稀疏赋值：中间的洞保留（该集未关联）
            last = i;
        }
    }
    if (last < 0) return undefined; // 整段空 → 字段缺省不写（与历史口径一致）
    out.length = last + 1; // 去尾部空位
    return out;
}

/** 集按钮（编辑表单 / 快捷关联弹窗）与选集弹窗的悬停文案（纯展示）：
 *  剧集 = 「第 N 集 集标题」（未填标题只「第 N 集」）；电影 / 单文件（single）= 标题本身（未填 → 空串）。 */
export function episodeHintLabel(index: number, title: string | undefined, single: boolean): string {
    const t = typeof title === 'string' ? title.trim() : '';
    if (single) return t;
    return t ? `第 ${index + 1} 集 ${t}` : `第 ${index + 1} 集`;
}
