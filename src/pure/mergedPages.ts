// 「合并视图」（#547 的第三档主导航布局）的三个页面真源（#550 起由一枚「更多」菜单承载）。
//
// 用户 2026-10-07：「取消顶部的分类页签……而追更页和统计页变成一个图标按钮」；
// #550 收口成「两枚图标按钮收成一枚『更多』＝ 媒体库 · 追更 · 统计」⇒ 本模块就是那枚菜单的取值空间。
//
// 🔴 为什么抽纯模块：页面的 id / 文案 / 图标在 `HomeView` 里**有两个挂载点** ——
//    库列表页经 `MediaList` 的视图栏插槽落在筛选行右端；追更 / 统计页由本组件自己渲染一行。
//    两处必须一字不差，否则就是「同一概念两份实现」。同类先例见 `pure/homeTabs`
//    （页签的 id / 文案 / 图标单一真源，同样服务两个挂载点）。
//
// ⚠️ `library` 的含义 = **库列表**（合并视图下的默认页），⛔ 不是「书架 / 阅读」——
//    合并视图里书架已拆成 文学 / 网文 / 漫画 三个媒体类型（见 `pure/mergedScope`）。
// ⚠️ 下面的顺序 = 菜单里的展示顺序（媒体库在最上），⛔ 别按字母表 / 类型表顺序重排。

/** 合并视图的三个页面 */
export type MergedPage = 'library' | 'tracking' | 'stats';

/** 菜单里的展示顺序 */
export const MERGED_PAGES: readonly MergedPage[] = ['library', 'tracking', 'stats'];

/**
 * 页面显示名。**只有这里是这三个词的文案真源**（菜单标签与读屏名共用）。
 * 🔴 `library` 的「媒体库」与合并视图那块的 `aria-label` **同词同源** —— 改一处要一起改。
 *
 * 🔴 #567（用户 2026-10-08，**这一条被点名第四次**）：菜单里的「追更 / 统计」改成
 *    「**追更表 / 统计页**」。⚠️ 这句在 **#555 的批次需求原文里就已经写着**
 *    （那份批次注释记的是「媒体库/追更表/统计页」），但当时只落了同一条消息里的
 *    「固定图标列 + 文字左对齐」，**文案一字未改** ⇒ 所以用户反复提。
 *    ⇒ 教训：一条消息里的**多项**要逐项对照落码，别只落最显眼的那一项。
 *    ⚠️ 展示名与**页面自己的名字**同口径：追更那一页的表叫「追更表」（`TrackingBoard`）、
 *    统计那一页是三层「统计页」（`StatsBoard`）—— 菜单是**去那一页的入口**，用页名最省心。
 */
const PAGE_LABELS: Record<MergedPage, string> = {
    library: '媒体库',
    tracking: '追更表',
    stats: '统计页',
};

/**
 * 页面图标（Obsidian 内建 Lucide）。
 * ⚠️ 追更 / 统计两枚与 #547 顶端栏里那两枚**同款**（`calendar-check` / `trending-up`）——
 *    换别的名字会让「同一个页面」在两版里长得不一样。
 */
const PAGE_ICONS: Record<MergedPage, string> = {
    library: 'layout-grid',
    tracking: 'calendar-check',
    stats: 'trending-up',
};

/** 页面显示名（未登记的 id 回 `library` 那一份） */
export function mergedPageLabel(p: MergedPage): string {
    return PAGE_LABELS[p] ?? PAGE_LABELS.library;
}

/** 页面图标名（未登记的 id 回 `library` 那一份） */
export function mergedPageIcon(p: MergedPage): string {
    return PAGE_ICONS[p] ?? PAGE_ICONS.library;
}
