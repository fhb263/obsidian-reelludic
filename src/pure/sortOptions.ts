// 列表排序项的真源（从 `MediaList` 里搬出来：#547 起「合并视图」的顶端筛选栏也要同一张表）。
//
// 🔴 为什么必须外移：一句「排序下拉里有哪些档、各叫什么」不能有两份 ——
//    #547 的合并视图把排序下拉搬到了顶端筛选栏（`HomeView`），若组件里再留一份，
//    加一档排序时必然只改一处（本仓「同一概念只准一份文案」）。
//
// ⚠️ 这里只管**下拉里出现什么**；真正的比较逻辑在 `pure/search.filterAndSort`（那份是排序语义的真源）。
import type { SortBy } from 'pure/search';

export interface SortOption {
    value: SortBy;
    label: string;
}

/** 排序下拉选项：每项排序成对提供正/反向（标题 A-Z/Z-A；其余 ↓=新/高在前，↑=旧/低在前）
 *  —— 底层 `filterAndSort` 12 向已实现，仅下拉曾砍剩默认方向 */
export const SORT_OPTIONS: readonly SortOption[] = [
    { value: 'recent', label: '最近更新 ↓' },
    { value: 'recent-asc', label: '最近更新 ↑' },
    { value: 'release-desc', label: '发布日期 ↓' },
    { value: 'release-asc', label: '发布日期 ↑' },
    { value: 'title-asc', label: '标题 A-Z' },
    { value: 'title-desc', label: '标题 Z-A' },
    { value: 'score-desc', label: '大众评分 ↓' },
    { value: 'score-asc', label: '大众评分 ↑' },
    { value: 'myrating-desc', label: '个人评分 ↓' },
    { value: 'myrating-asc', label: '个人评分 ↑' },
    // 🔴 #441：系列序号档 —— 进「单系列视图」时**默认切到 `series-asc`**（用户点名
    //    ⛔ 本注释不许写出那个被撤掉的底部入口文案：`<script>` 里的注释会进产物，
    //       而它有一条「不许长回来」的反向守卫 ⇒ 写了就是自撞（本仓栽过四次）。
    //    「系列视图里条目排序默认为系列序号排序优先」）；比较逻辑走 `seriesGroup` 那份单一真源。
    { value: 'series-asc', label: '系列序号 ↑' },
    { value: 'series-desc', label: '系列序号 ↓' },
];

/**
 * 不含「系列序号」两档的子集 —— 只有**单系列视图**才该看到那两档（`pure/seriesGroup` 的语义），
 * 其余任何地方（含 #547 合并视图的顶端筛选栏）都用这一份。
 * ⚠️ 判据是**同一处过滤**：⛔ 别在调用点各写一遍 `filter(o => !o.value.startsWith('series-'))`
 *    （两份就必然漂移 —— 加一档 series-xxx 时只改一处）。
 */
export const SORT_OPTIONS_BASE: readonly SortOption[] = SORT_OPTIONS.filter(
    (o) => !o.value.startsWith('series-'),
);

/**
 * 🔴 m08754 ②：「统计时长」两档 —— 用户点名只在**文学 / 网文 / 音乐 / 游戏**四个页签要。
 *
 * 为什么不并进 {@link SORT_OPTIONS_BASE}：影视三类没有时长字段（`data/types.ts` 只有
 * `readMinutes`/`playtimeMinutes`/`listenMinutes`），若全类型视图也挂这两档，选了之后整屏条目
 * 全是 0 分钟、顺序与「最近更新」一模一样 —— 用户会判定「这个排序坏了」。
 * ⇒ 单独成一份池，由 {@link sortOptionsFor} 按页签下发（⛔ 别在调用点各写一遍 filter）。
 * ⚠️ 位置放在「个人评分」之后、「系列序号」之前：时长是**个人使用量**的延续（评分 → 时长），
 *    而系列序号是**结构**维度，两者不该夹在一起。
 */
export const SORT_OPTIONS_DURATION: readonly SortOption[] = [
    { value: 'duration-desc', label: '统计时长 ↓' },
    { value: 'duration-asc', label: '统计时长 ↑' },
];

/** 把时长两档插进一份池的「系列序号」之前（没那两档就接在末尾） */
function withDuration(pool: readonly SortOption[]): readonly SortOption[] {
    const at = pool.findIndex((o) => o.value.startsWith('series-'));
    if (at < 0) return [...pool, ...SORT_OPTIONS_DURATION];
    return [...pool.slice(0, at), ...SORT_OPTIONS_DURATION, ...pool.slice(at)];
}

/**
 * 按页签给出该用哪一份排序池（**唯一分叉点**）。
 *
 * - `seriesMode`（单系列视图）：给全量（含系列序号两档）
 * - `type` 为 `book`（文学 / 网文 / 漫画共用 `EntryType='book'`）、`music`、`game`：加上「统计时长」
 * - 其余（电影 / 剧集 / 动画 / 全类型 / 合并视图）：`SORT_OPTIONS_BASE`
 *
 * ⚠️ 「文学」与「网文」在本仓是**同一个 `EntryType='book'`**（靠 `BookKind` 区分），
 *    所以两者在这里走同一条分支 —— 这正是用户要的（两个页签都该有时长排序）。
 */
export function sortOptionsFor(type: string | null | undefined, seriesMode: boolean): readonly SortOption[] {
    if (seriesMode) return withDuration(SORT_OPTIONS);
    if (type === 'book' || type === 'music' || type === 'game') return withDuration(SORT_OPTIONS_BASE);
    return SORT_OPTIONS_BASE;
}

/** 归一：只接受本表里真有（且**属于给定子集**）的排序值，其余一律回 `recent`（历史缺省）。 */
export function normalizeSortBy(raw: unknown, pool: readonly SortOption[] = SORT_OPTIONS_BASE): SortBy {
    const v = typeof raw === 'string' ? raw : '';
    return (pool.find((o) => o.value === v)?.value ?? 'recent') as SortBy;
}
