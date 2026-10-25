import type { MediaEntry } from 'data/types';

/**
 * 🔴 #598 视图切换的**唯一真源**。
 *
 * 用户 2026-10-10：「切换海报墙/列表/瀑布流视图控件还是太丑了，有什么其他方案切换，还有什么视图可新增展示」
 * → 经 `AskUserQuestion` 裁定：**切换控件 = 单枚下拉菜单**、**新增「时间线」视图**。
 *
 * 本模块只管两件事：**有哪些视图**、**每个视图的用户可见名与图标名**。
 * ⛔ 别在 `MediaList` 里手写第二份 label / icon（本仓「同一概念只准一份」）。
 *
 * ⚠️ **音乐那第 5 档（`grouped` = 分组歌单）不在这里** —— 它只在 `lockType === 'music'` 时由宿主
 *    临时追加（`MUSIC_VIEW`），这样「通用视图表」不会被一个专有档污染。
 */

/** 所有**通用**视图（音乐专有的「分组歌单」另见 `MUSIC_VIEW`） */
export const VIEW_MODES = ['grid', 'list', 'masonry', 'wall', 'timeline'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * 视图的用户可见名。
 *
 * 🔴 文案口径（**#624 用户 2026-10-13 裁定**，在此之前的叫法见下方「改名沿革」）：
 *    `grid` = **卡片网格**、`list` = **列表**、`masonry` = **瀑布流**、`wall` = **海报墙**、
 *    `timeline` = **时间线**。
 *
 * ⚠️ **改名沿革（别改回去）**：`grid` 原来叫「海报墙」，但它的卡片带着标题行与整个信息栏，
 *    本质是**卡片网格**（用户原话：「海报墙视图改名为'卡片网格'视图(更明确)」）；
 *    而真正「整面墙都是海报、以封面为主」的那一档，本批新增为 `wall`（用户：「新增正确的海报墙视图」）。
 *    ⇒ **同一个词只能指一个视图**：看到「海报墙」就是 `wall`，看到「卡片网格」就是 `grid`。
 * ⛔ 别把 `grid` 写成「网格」之类的简写 —— 设置页「书架默认视图」与这里的下拉必须是同一套词。
 */
export const VIEW_LABELS: Record<ViewMode, string> = {
    grid: '卡片网格',
    list: '列表',
    masonry: '瀑布流',
    wall: '海报墙',
    timeline: '时间线',
};

/**
 * 视图的图标名（Obsidian 内建 Lucide 集，走 `<Icon icon={…} />` 的 `setIcon`）。
 * 🔴 这几个名**都在当前 Obsidian 的 lucide 集里**（逐个用 `_probe_lucide.cjs` 在本机 asar 核过）——
 *    ⛔ 别顺手改成自己记得的名字：`setIcon` 找不到会**静默失败**（那个 span 留空，不是报错），
 *    结果是「按钮上少一个图标」，很难在开发时发现。
 */
export const VIEW_ICONS: Record<ViewMode, string> = {
    grid: 'layout-grid',
    list: 'list',
    masonry: 'columns-3',
    // 竖版画廊：密集封面墙的意象（与 `grid` 的 `layout-grid` 区分开）
    wall: 'gallery-vertical',
    timeline: 'clock',
};

/** 音乐专有的第 5 档：分组歌单视图（`lockType === 'music'` 时追加到选项表末尾） */
export const MUSIC_VIEW: { value: string; label: string; icon: string } = {
    value: 'grouped',
    label: '分组歌单',
    icon: 'library',
};

/**
 * 「年份未知」那一桶的显示名（`pure/timeline.buildTimeline` 用）。
 * 🔴 恒**排在最后** —— 把它混进年份序列会让「2026 → 未知 → 2025」这种顺序出现。
 */
export const TIMELINE_UNKNOWN_LABEL = '年份未知';

// ─────────── #668 视图切换按钮的**自由排序**（持久化在设置里）───────────

/** 「切换视图」选项表里可能出现的一档（含音乐专有的 `grouped`） */
export interface ViewChoice {
    value: string;
    label: string;
    icon: string;
}

/** 全部可排序的值（默认顺序 = 通用五档 + 音乐专有那一档） */
export const ALL_VIEW_VALUES: readonly string[] = [...VIEW_MODES, MUSIC_VIEW.value];

/**
 * 归一化用户拖出来的视图顺序（**设置里存的原始值 → 一份可用的完整顺序**）。
 *
 * 口径（与 `pure/tableColumns.normalizeTableColumnsForType` 同一套思路）：
 *  · **保留用户顺序**（⛔ 别按 `ALL_VIEW_VALUES` 重排 —— 那就等于拖了白拖）；
 *  · 丢掉不认识的值、去重；
 *  · **缺失的档补在末尾**（🔑 关键：以后新增视图时，老用户存的顺序里没有它 ——
 *    不补就**永远看不到那一档**，而用户根本不知道自己少了东西）；
 *  · 非数组 / 空数组 ⇒ 回落到默认顺序（等于「没配过」）。
 *
 * ⚠️ 返回**完整的**值列表（长度恒 = `ALL_VIEW_VALUES.length`），调用方直接按它渲染。
 */
export function normalizeViewOrder(raw: unknown): string[] {
    const known = new Set(ALL_VIEW_VALUES);
    const src: unknown[] = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of src) {
        if (typeof x !== 'string' || !known.has(x) || seen.has(x)) continue;
        seen.add(x);
        out.push(x);
    }
    for (const v of ALL_VIEW_VALUES) {
        if (!seen.has(v)) out.push(v);
    }
    return out;
}

/**
 * 按给定顺序排出一份**选项表**（图标 / 名字一律取自本模块的三张表，⛔ 别在组件里手写第二份）。
 * @param order 用户顺序（已归一；缺省用默认顺序）
 * @param lockType 当前页签锁定的类型 —— 音乐专有的「分组歌单」只在这一档出现
 */
export function buildViewChoices(order: readonly string[] | undefined, lockType?: string | null): ViewChoice[] {
    const seq = order && order.length ? order : ALL_VIEW_VALUES;
    const out: ViewChoice[] = [];
    for (const v of seq) {
        if (v === MUSIC_VIEW.value) {
            if (lockType === 'music') out.push({ ...MUSIC_VIEW });
            continue;
        }
        if (!(VIEW_MODES as readonly string[]).includes(v)) continue;
        const m = v as ViewMode;
        out.push({ value: m, label: VIEW_LABELS[m], icon: VIEW_ICONS[m] });
    }
    return out;
}

/**
 * 把 `from` 这一档移到 `to` 这一档的位置，返回**新的完整顺序**（不改入参）。
 * 判据全在值上（⛔ 不依赖 DOM 下标）：两者任一不认识 ⇒ 原样返回归一份。
 */
export function moveViewValue(order: readonly string[], from: string, to: string): string[] {
    const cur = normalizeViewOrder(order);
    const i = cur.indexOf(from);
    const j = cur.indexOf(to);
    if (i < 0 || j < 0 || i === j) return cur;
    const out = [...cur];
    out.splice(i, 1);
    out.splice(j, 0, from);
    return out;
}

// ─────────── #668 时间线视图的缩放（Ctrl + 滚轮）───────────

/** 时间线条目宽度档：1 = 最宽（大封面），越大越窄。 */
export const TL_ZOOM_MIN = 1;
export const TL_ZOOM_MAX = 6;
export const TL_ZOOM_DEFAULT = 3;

/** 每一档对应的条目宽度（px）。**单调递减** ⇒ 档位越大条目越小。
 *  ⚠️ 与 `rl-tl-item` 的 `width` 绑同一个变量，⛔ 别再在样式里写死像素。 */
export const TL_WIDTH_BY_ZOOM: Record<number, number> = {
    1: 128,
    2: 104,
    3: 84,
    4: 68,
    5: 56,
    6: 46,
};

/** 归一时间线缩放档：非有限数 / 越界 ⇒ 夹到合法区间；完全无法识别 ⇒ 缺省档。 */
export function normalizeTimelineZoom(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return TL_ZOOM_DEFAULT;
    const n = Math.round(raw);
    return Math.min(TL_ZOOM_MAX, Math.max(TL_ZOOM_MIN, n));
}

/** 该档对应的条目宽度（px）。 */
export function timelineItemWidth(zoom: number): number {
    return TL_WIDTH_BY_ZOOM[normalizeTimelineZoom(zoom)] ?? TL_WIDTH_BY_ZOOM[TL_ZOOM_DEFAULT];
}

/**
 * Ctrl+滚轮一步：`dir='in'`（向上滚，放大）= 档位 **-1**（条目变大），与浏览器「上滚放大」一致。
 * 已在边界 ⇒ 原样返回（调用方据此判「no-op、不落盘」）。
 */
export function timelineZoomStep(zoom: number, dir: 'in' | 'out'): number {
    const cur = normalizeTimelineZoom(zoom);
    return dir === 'in' ? Math.max(TL_ZOOM_MIN, cur - 1) : Math.min(TL_ZOOM_MAX, cur + 1);
}

/** 时间线视图的一桶 = 同一年（或「年份未知」）的条目 */
export interface TimelineBucket {
    /** 桶的显示名（年份串，或 `TIMELINE_UNKNOWN_LABEL`）—— 同时用作 `{#each}` 的 key */
    label: string;
    /** 年份；「年份未知」桶 = null */
    year: number | null;
    items: MediaEntry[];
}

/**
 * 🔴 #598 时间线分组：把条目按**年份**分桶，年份**降序**（新的在前），「年份未知」恒在最后。
 *
 * 🔴 组内**保持传入顺序** —— 入口 `filterAndSort` 已按当前排序档排好，这里只做「分桶搬运」，
 *    ⛔ 不重新排一遍（同 `pure/seriesGroup.listTreeRows` 的纪律）。
 * ⚠️ 年份判定只认**正整数**：`undefined` / `null` / `0` / 负数 / NaN / 小数都算「未知」
 *    （`year: 0` 是脏数据而不是「公元 0 年」；`2026.5` 这种半成品也归未知，别让它在轴上多出一格）。
 */
export function buildTimeline(entries: readonly MediaEntry[]): TimelineBucket[] {
    const known = new Map<number, MediaEntry[]>();
    const unknown: MediaEntry[] = [];
    for (const e of entries) {
        const y = e.year;
        if (typeof y === 'number' && Number.isInteger(y) && y > 0) {
            const arr = known.get(y);
            if (arr) arr.push(e);
            else known.set(y, [e]);
        } else {
            unknown.push(e);
        }
    }
    const out: TimelineBucket[] = [...known.keys()]
        .sort((a, b) => b - a)
        .map((y) => ({ label: String(y), year: y, items: known.get(y) as MediaEntry[] }));
    if (unknown.length > 0) out.push({ label: TIMELINE_UNKNOWN_LABEL, year: null, items: unknown });
    return out;
}
