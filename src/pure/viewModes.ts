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
export const VIEW_MODES = ['grid', 'list', 'masonry', 'timeline'] as const;

export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * 视图的用户可见名。
 * 🔴 文案口径（用户点名沿用）：`grid` = **海报墙**、`list` = **列表**、`masonry` = **瀑布流**、
 *    `timeline` = **时间线**。⛔ 别把 `grid` 写成「网格」—— 设置页「书架默认视图」与
 *    这里的下拉必须是同一套词（换了就等于同一个东西有两个名字）。
 */
export const VIEW_LABELS: Record<ViewMode, string> = {
    grid: '海报墙',
    list: '列表',
    masonry: '瀑布流',
    timeline: '时间线',
};

/**
 * 视图的图标名（Obsidian 内建 Lucide 集，走 `<Icon icon={…} />` 的 `setIcon`）。
 * 🔴 这几个名**都在当前 Obsidian 的 lucide 集里**（本批逐个核过）—— ⛔ 别顺手改成
 *    自己记得的名字：`setIcon` 找不到会**静默失败**（那个 span 留空，不是报错），
 *    结果是「按钮上少一个图标」，很难在开发时发现。
 */
export const VIEW_ICONS: Record<ViewMode, string> = {
    grid: 'layout-grid',
    list: 'list',
    masonry: 'columns-3',
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
