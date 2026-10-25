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

// ─────────── 2026-10-23 用户：「填 1000 集会一次性铺开 1000 行，滚动困难」⇒ 分区 ───────────
//
// 原文：「需要将该区域按**每 10 行**进行分区展示……每个分区需显示分区标题如：第1-130集，
//       分区标题需吸顶或随滚动可见」。
// 🔴 「10 行」= **10 行按钮**，不是 10 个按钮：网格是 flex-wrap 的 36px 按钮，一行能放几个
//    取决于容器宽度（用户示例的 130 = 13 列 × 10 行，正是他那栏的宽度）。
//    ⇒ 每区集数 = 列数 × 10，**按真实宽度算**（见 `episodeSectionSize`），⛔ 不写死 130。

/** 集按钮与间距的默认几何（与 EntryForm 的 `.rl-ep-btn` 36px / `.rl-ep-grid` gap 6px 对齐） */
export const EP_BTN_W = 36;
export const EP_BTN_GAP = 6;
/** 一个分区 = 几行按钮（用户原话「每 10 行」） */
export const EP_SECTION_ROWS = 10;

/**
 * 每区集数：列数 × 10。
 * @param width 网格可用宽度（px，含 padding 后的内容宽度）
 * ⚠️ 宽度不明（≤0 / NaN）时回落到 **13 列**（= 用户示例 130 的来历），⛔ 不回落到 0。
 */
export function episodeSectionSize(width: number, rows: number = EP_SECTION_ROWS): number {
    const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0;
    const step = EP_BTN_W + EP_BTN_GAP;
    const cols = w > 0 ? Math.max(1, Math.floor((w + EP_BTN_GAP) / step)) : 13;
    return Math.max(1, cols * (rows > 0 ? Math.floor(rows) : EP_SECTION_ROWS));
}

/** 一个分区：`start`/`end` 都是 **1 基集号且闭区间**，`label` 直接上屏（「第 1-130 集」） */
export interface EpisodeSection {
    start: number;
    end: number;
    label: string;
}

/**
 * 把 1..total 切成每段 `per` 个的分区。
 * - total ≤ 0 ⇒ 空数组（调用方本来就不渲染网格）
 * - 只有一段时**照样给 label**（「第 1-12 集」）—— 标题一致性比省一行更重要：
 *   用户看到「有的有标题有的没有」会以为分区坏了。
 * - 单集分区（per=1）文案退化「第 3 集」而不是「第 3-3 集」
 */
export function episodeSections(total: number, per: number): EpisodeSection[] {
    const n = typeof total === 'number' && Number.isFinite(total) ? Math.floor(total) : 0;
    const step = typeof per === 'number' && Number.isFinite(per) ? Math.max(1, Math.floor(per)) : 1;
    const out: EpisodeSection[] = [];
    for (let start = 1; start <= n; start += step) {
        const end = Math.min(n, start + step - 1);
        out.push({ start, end, label: end > start ? `第 ${start}-${end} 集` : `第 ${start} 集` });
    }
    return out;
}

// ─────────── 2026-10-25 用户：「分区应该按选项卡切换而不是平铺」⇒ 分区下标 ───────────
//
// 原文：「编辑属性窗口的总选集如 1000 集，分区应该按选项卡切换而不是平铺」。
// 为什么这两个小函数要放纯模块（而不是留在 EntryForm 里）：
//   · 它们是**下标算术**，错一格就是「点了选项卡显示别的区」或「越界渲染空白」；
//   · Svelte 里的内联函数无法单测，仿真页也只能照抄一遍 —— 一旦照抄，测的就不是实装逻辑了。
//   ⇒ ⛔ 别为了「只有两行」把它们再抄回组件里。

/**
 * 把分区下标钳到合法区间（**0 基**）。
 * @param n   期望下标
 * @param len 分区总数
 * - `len ≤ 0`（总集数 0 / 电影态）⇒ 0（调用方本就少渲染一格，返回 0 不会出界）
 * - 非有限值 ⇒ 0
 */
export function clampTabIndex(n: number, len: number): number {
    const size = typeof len === 'number' && Number.isFinite(len) ? Math.floor(len) : 0;
    if (size <= 0) return 0;
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
    return Math.min(Math.max(0, Math.floor(n)), size - 1);
}

/**
 * 「已看到第 `ep` 集」落在第几个分区（**0 基**）。
 * - 无进度 / 非法集号 / 空分区 ⇒ 0（改第 500 集的人不该被丢回第 1 区，但没有进度时就该落第一区）
 * - 集号超出总集数 ⇒ **最后一个分区**（钳制，⛔ 不要返回 -1）
 */
export function tabIndexOfEpisode(ep: number, secs: EpisodeSection[]): number {
    const list = Array.isArray(secs) ? secs : [];
    if (list.length === 0) return 0;
    if (typeof ep !== 'number' || !Number.isFinite(ep) || ep < 1) return 0;
    const i = list.findIndex((s) => ep >= s.start && ep <= s.end);
    if (i >= 0) return i;
    // 超出末区 ⇒ 末区；落在所有区之前（理论不可达）⇒ 首区
    return ep > list[list.length - 1].end ? list.length - 1 : 0;
}

