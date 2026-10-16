// 主视图（HomeView）一级页签的**唯一真源**（#541）。
//
// 🔴 为什么单独抽出来：这批起页签不止「顶部胶囊」一种排法 —— 设置页的「起始页」下拉要拿
//    同一份顺序与同一份文案，`HomeView.svelte` 的「文字菜单」分支也要用它。以前这三样
//    （顺序常量 / `tabLabel` / `tabIcon`）都埋在组件里，第二处要用就只能手抄一份 ⇒ 违反
//    「同一概念只准一份文案」。
//
// ⚠️ `HomeTab` 类型定义在**本模块**，`views/tab.ts` 改为**再导出**（保持全仓既有 import 路径不变）。
import { ENTRY_TYPE_LABELS, type EntryType } from 'data/types';

/** 主视图一级页签（'media' 为聚合页签：内部再按 动画/剧集/电影 筛选） */
export type HomeTab = 'tracking' | 'stats' | 'media' | EntryType;

/**
 * 页签**排列顺序**（用户给定，⛔ 别改）：
 *   计划（追更表/月历） → 阅读 → 影视（聚合） → 游戏 → 音乐 → 统计
 * ⚠️ 顶部胶囊与文字菜单**共用这一份顺序** —— 两种布局应当只是「换个排法」，不该换顺序。
 */
export const HOME_TAB_ORDER: readonly HomeTab[] = ['tracking', 'book', 'media', 'game', 'music', 'stats'];

/** 页签图标（Obsidian 内建 Lucide）：计划/阅读/影视/游戏/音乐/统计 */
const TAB_ICONS: Record<string, string> = {
    tracking: 'calendar-check',
    book: 'book-open',
    media: 'film',
    game: 'gamepad-2',
    music: 'music',
    stats: 'trending-up',
};

/**
 * 页签图标名。未登记的（理论上只可能是非导航用的 EntryType）回退占位图标，
 * ⛔ 不返回空串 —— `setIcon` 遇空/未知名会**静默失败**，界面上只剩一个空白 span。
 */
export function homeTabIcon(t: HomeTab): string {
    return TAB_ICONS[t] ?? 'layout-grid';
}

/**
 * 页签显示名。**只有这里是页签文案的真源**（顶部胶囊 / 文字菜单 / 起始页下拉三处共用）。
 * 🔴 两处「页签专用名」的用户裁定（1.0.3）：
 *    ⑴ 书籍 → **阅读**（仅页签生效，其余场景仍走 `ENTRY_TYPE_LABELS`）；
 *    ⑵ 音乐 → **音乐**（1.0.3.1 起回归类型本名，原「收听」）。
 */
export function homeTabLabel(t: HomeTab): string {
    if (t === 'tracking') return '计划';
    if (t === 'media') return '影视';
    if (t === 'stats') return '统计';
    if (t === 'book') return '阅读';
    return ENTRY_TYPE_LABELS[t] ?? String(t);
}

/**
 * 「起始页」设置归一：只接受**一级导航里真有的**那 6 个 id，其余（缺省 / 脏数据 / 旧值）一律回 `media`。
 * ⚠️ 兜底必须是 `media` 而非 `tracking`：`media` 是历史缺省（`plugin.homeTab` 初值），
 *    回退到别的页会让老用户升级后「打开就换了一页」。
 */
export function normalizeStartTab(raw: unknown): HomeTab {
    return typeof raw === 'string' && (HOME_TAB_ORDER as readonly string[]).includes(raw) ? (raw as HomeTab) : 'media';
}

/** 该 id 是不是一级导航页签（`requestedTab` 只在导航页签之间切，⛔ 不接受聚合内部的 'anime'/'tv'/'movie'） */
export function isNavTab(raw: unknown): raw is HomeTab {
    return typeof raw === 'string' && (HOME_TAB_ORDER as readonly string[]).includes(raw);
}
