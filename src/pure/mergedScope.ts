// 「合并视图」（#547 的第三档主导航布局）的**媒体类型作用域**真源。
//
// 用户 2026-10-07：「页签导航布局再增加一种布局，**取消顶部的分类页签**，所有合并比如：
// 全部/文学/网文/漫画/动画/剧集/电影/游戏/音乐，显示为 [媒体类型: 影视] + [状态: …] + [排序: …] 下拉项」。
// ⇒ 本模块就是那个「媒体类型」下拉的取值空间：**一级平铺 9 项**（书籍不单独出现，只以三个子分类出现）。
//
// 🔴 为什么是独立纯模块：同一个作用域被三处消费 —— 顶端筛选栏（渲染选项）、`HomeView`（推给 MediaList）、
//    `MediaList`（受控同步到 `typeFilter` / `kindFilter`）。id 拼错一处就是「选了没反应」。
//
// 🔴🔴 **id 空间是两种既有 id 的并集，⛔ 不是新造的类型**（这是本模块最容易踩的地方）：
//       · `book` / `novel` / `comic` = `BookKind`（书籍**子分类**：文学 / 网文 / 漫画）
//       · `anime` / `tv` / `movie` / `game` / `music` = `EntryType` 里的五种**非书籍**类型
//    ⚠️⚠️ 因此 **`'book'` 在本模块里一律指「文学」**（`BOOK_KIND_LABELS.book`），
//       ⛔ **不是**「书籍」那个 EntryType！用户点名的那份清单里就是「文学」，没有「书籍」。
//       这条歧义由单测钉住（`mergedScopeLabel('book') === '文学'`）—— 改文案时**先跑那条**。
//
// ⚠️ 作用域「全部」在 MediaList 侧等价于「不锁类型」（lockType = null），
//    于是书籍的「书籍」这个整体项确实不存在 —— 要一次看全部书籍，走「全部」再按需筛选，
//    或直接用下边的三个子分类。这是用户裁定的 9 项形态，⛔ 别自作主张加第 10 项。
import { ENTRY_TYPE_LABELS, type BookKind, type EntryType } from 'data/types';
import { BOOK_KINDS, BOOK_KIND_LABELS } from 'pure/bookKind';

/** 合并视图的媒体类型作用域：`'all'` ＋ 书籍三子分类 ＋ 五种非书籍类型 */
export type MergedScope = 'all' | BookKind | Exclude<EntryType, 'book'>;

/**
 * 媒体那一截的**展示顺序**（用户给定：动画 → 剧集 → 电影 → 游戏 → 音乐）。
 * ⚠️ 与 `ENTRY_TYPES` 的顺序**不同**（那份是数据层顺序，电影在前）—— 这里只为下拉观感负责，
 *    ⛔ 别拿它去推导任何数据层语义。
 */
const MERGED_MEDIA_ORDER = ['anime', 'tv', 'movie', 'game', 'music'] as const;

/**
 * 下拉里的**全部**选项（含「全部」带首），顺序 = 用户给的那份清单：
 * 全部 → 文学 → 网文 → 漫画 → 动画 → 剧集 → 电影 → 游戏 → 音乐。
 */
export const MERGED_SCOPES: readonly MergedScope[] = [
    'all',
    ...BOOK_KINDS,
    ...MERGED_MEDIA_ORDER,
] as readonly MergedScope[];

/** 该作用域是不是书籍**子分类**（文学 / 网文 / 漫画） */
export function isMergedBookKind(scope: MergedScope): scope is BookKind {
    return (BOOK_KINDS as readonly string[]).includes(scope);
}

/**
 * 下拉显示名。**文案一律取自既有真源**（`BOOK_KIND_LABELS` / `ENTRY_TYPE_LABELS`），
 * ⛔ 本模块不手写第二份中文。
 * ⚠️ `'all'` 的「全部」是**本下拉专用的容器词**（与类型 / 状态里的「全部」同款），不是类型名。
 */
export function mergedScopeLabel(scope: MergedScope): string {
    if (scope === 'all') return '全部';
    if (isMergedBookKind(scope)) return BOOK_KIND_LABELS[scope];
    return ENTRY_TYPE_LABELS[scope] ?? scope;
}

/**
 * 归一：只认本表里真有的 id，其余（缺省 / 脏数据 / 旧值）一律回 **`'all'`**。
 * ⚠️ 兜底是「全部」而非某一个类型：合并视图本来就是「先看全库、再收窄」，回退到某个类型
 *    等于用户没点过就被筛掉一大半（与「升级不变脸」同一条纪律）。
 */
export function normalizeMergedScope(raw: unknown): MergedScope {
    return typeof raw === 'string' && (MERGED_SCOPES as readonly string[]).includes(raw)
        ? (raw as MergedScope)
        : 'all';
}

/**
 * 作用域 → `MediaList` 的 **`lockType`**：
 *   · `'all'` ⇒ `null`（不锁类型 ⇒ 全库）
 *   · 书籍子分类 ⇒ `'book'`（锁书籍类型，再由 `mergedBookKind` 收窄到子分类）
 *   · 其它 ⇒ 该类型本身
 */
export function mergedLockType(scope: MergedScope): EntryType | null {
    if (scope === 'all') return null;
    if (isMergedBookKind(scope)) return 'book';
    return scope;
}

/**
 * 作用域 → `MediaList` 的 **`kindFilter`**（`'all'` = 不限子分类）。
 * ⚠️ 只有书籍子分类才有值；其余一律 `'all'`（⛔ 别把非书籍类型塞进子分类过滤，那是另一维）。
 */
export function mergedBookKind(scope: MergedScope): 'all' | BookKind {
    return isMergedBookKind(scope) ? scope : 'all';
}
