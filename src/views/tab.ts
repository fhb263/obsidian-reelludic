// 统一视图页签类型：计划(月历) + 统计 + 阅读/影视聚合/游戏条目页签
// 'media' 为聚合页签：内部按动画/剧集/电影三类筛选（MediaList typePool 机制）
// 🔴 #541：`HomeTab` 的**定义已搬到 `pure/homeTabs`** —— 那里同时是页签
//    「顺序 / 文案 / 图标」的唯一真源（设置页「起始页」下拉 + 主视图侧边栏都要用同一个 id 集合）。
//    本文件只做**再导出**：全仓既有 `import type { HomeTab } from 'views/tab'` 一律不动。
export type { HomeTab } from 'pure/homeTabs';

/**
 * 影视聚合页签包含的具体类型（筛选 chips 与计数共用）。
 * 🔴 #727 起**真源已搬到 `pure/homeTabs`**（那里的 `visibleTabs()` 要用它判断「影视」聚合了哪几种），
 *    本文件改为再导出 —— 全仓既有 `import { MEDIA_TYPES } from 'views/tab'` 一律不动。
 *    ⛔ 别在这里重新定义一份：两份常量迟早漂移，而漂移的表现是「页签还在、筛选栏却空了」。
 */
export { MEDIA_TYPES } from 'pure/homeTabs';
