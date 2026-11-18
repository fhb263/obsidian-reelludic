// 关键词过滤（纯逻辑，可单测）：按当前 Tab 维度（types）筛后再按搜索词筛
// 用于 MediaList 的实时标题/原名模糊匹配（不区分大小写、去首尾空白）
import type { EntryType, MediaEntry, BookKind } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { MEDIA_STATUSES } from 'pure/status';
import { matchesBookKind } from 'pure/bookKind';
import { matchesGenres } from 'pure/genreFilter';
// 🔴 m07854 ⑮「待补」漏斗的判据（缺关联 或 缺个人评分）—— 单一真源在 `pure/incomplete`，
//    ⛔ 别在本文件里内联条件（本仓反复栽过的「同一件事两份真源」）。
import { isIncomplete } from 'pure/incomplete';
// 🔴 #441：系列序号排序档（series-asc / series-desc）的比较逻辑借 `seriesGroup` 那份**单一真源**。
//    ⚠️ 依赖方向是单向的（seriesGroup 不反过来依赖 search），不会成环。
import { compareSeriesIndex, compareSeriesIndexDesc } from 'pure/seriesGroup';
// 🔴 m08754 ②「统计时长」排序档的取值真源（书籍/网文/漫画 readMinutes、游戏 playtimeMinutes、
//    音乐 listenMinutes 的分家映射）—— 在 `pure/mediaProgress`，与「合集代表值」共用同一份。
//    ⛔ 别在本文件里内联三元表达式：`seriesGroup` 也要它，而它不能反向引本文件（会成环）。
import { entryDurationMinutes } from 'pure/mediaProgress';

/** 状态排序基准（想看 0 < 在看 1 < 已看 2 < 存档 3） */
const STATUS_RANK: Record<MediaStatus, number> = Object.fromEntries(MEDIA_STATUSES.map((s, i) => [s, i])) as Record<MediaStatus, number>;

/** 命中判定：标题/原名小写后包含搜索词；书籍/音乐额外匹配作者、游戏额外匹配开发商（与占位文案字段一致）；空搜索词视为不过滤
 *
 *  🔴🔴 #689（用户 2026-10-19）：「列表视图**全局搜索框可按导演筛选**显示条目」。
 *    ⇒ 影视/动画再加两路命中：**导演**（`director`，单个字符串）与**演员**（`cast`，数组）。
 *    为什么不只加导演：用户在搜索框里敲一个演员名却搜不到，同样会以为「这个功能坏了」——
 *    而演员与导演在数据里本就是同一档「主创」信息（豆瓣详情一起回填），只放一半显得莫名其妙。
 *    ⚠️ 判定仍以**整条数据**为范围（跨类型）：搜「张艺谋」时电影/剧集/动画都能命中，
 *      与原先「作者跨书籍/音乐生效」的口径一致（⛔ 别退化成「只有当前页签才生效」）。
 *    ⚠️ 字段可能是 `undefined` / 空数组 ⇒ 一律先兜底再 `toLowerCase`（`cast` 在旧数据里可能缺失）。
 */
export function matchesSearch(e: MediaEntry, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const title = e.title.toLowerCase();
    const orig = (e.originalTitle ?? '').toLowerCase();
    if (title.includes(q) || orig.includes(q)) return true;
    const hit = (s: string | undefined): boolean => !!s && s.toLowerCase().includes(q);
    if (e.type === 'book' || e.type === 'music') return hit(e.author);
    if (e.type === 'game') return hit(e.developer);
    // 🔴 #689：影视 / 动画 —— 导演 + 演员（含编剧：同属「主创」，在详情里也常被当成导演一起搜）
    if (e.type === 'movie' || e.type === 'tv' || e.type === 'anime') {
        if (hit(e.director)) return true;
        if ((e.cast ?? []).some((c) => hit(c))) return true;
        if ((e.screenwriter ?? []).some((c) => hit(c))) return true;
    }
    return false;
}

/** 类型维度（lockType 模式下生效）：类型匹配则保留；否则丢弃 */
export function matchesType(e: MediaEntry, typeFilter: 'all' | EntryType): boolean {
    return typeFilter === 'all' || e.type === typeFilter;
}

/** 状态维度：全部 或 完全匹配 */
export function matchesStatus(e: MediaEntry, statusFilter: MediaStatus | 'all'): boolean {
    return statusFilter === 'all' || e.status === statusFilter;
}

/** 排序方式：
 *  recent=最近更新（新→旧）/ recent-asc=最久未更新（旧→新）/
 *  release-desc=发布日期新→旧 / release-asc=旧→新 /
 *  score-desc=大众评分高→低 / score-asc=低→高 / title-desc=标题 Z-A / title-asc=A-Z /
 *  myrating-desc=个人评分 5★→1★ / myrating-asc=1★→5★ /
 *  status-asc=状态 想看→在看→已看→存档 / status-desc=反之
 *  🔴 #441 追加 series-asc=系列序号 小→大（**没填序号的置后**）/ series-desc=反之 ——
 *     比较逻辑的单一真源是 `pure/seriesGroup.compareSeriesIndex`，⛔ 别在这里另写一份。 */
export type SortBy = 'recent' | 'recent-asc' | 'release-desc' | 'release-asc' | 'score-desc' | 'score-asc' | 'title-desc' | 'title-asc' | 'myrating-desc' | 'myrating-asc' | 'status-asc' | 'status-desc' | 'series-asc' | 'series-desc' | 'duration-desc' | 'duration-asc';


/**
 * 排序（**唯一真源**）：`filterAndSort` 与「合集视图的排序栏」共用这一份。
 *
 * 🔴 2026-11-26（用户 m04553）合集视图要保留排序栏 ⇒ 必须能对一个**已分组**的条目数组排序，
 *    而 `filterAndSort` 是「filter → sort」一体的，分组后再调它会把类型/状态过滤再跑一遍
 *    （分组已把类型拆成行，整段再筛会串味）。把 sort 单独拆出来，是为了让两处**只有一份**排序语义。
 *    ⛔ 别在调用点再写一份 switch —— 加一档排序时必然只改一处，那就是漂移的开始。
 * ⚠️ 内部 `slice()` 复制，调用方传进来的数组不会被 mutate。
 */
export function sortEntries<T extends MediaEntry>(entries: readonly T[], sortBy: SortBy): T[] {
    return entries.slice().sort((a, b) => {
        switch (sortBy) {
            case 'release-desc':
                return (b.year ?? 0) - (a.year ?? 0);
            case 'release-asc':
                return (a.year ?? 0) - (b.year ?? 0);
            case 'score-desc':
                return (b.communityScore ?? 0) - (a.communityScore ?? 0);
            case 'score-asc':
                return (a.communityScore ?? 0) - (b.communityScore ?? 0);
            case 'title-desc':
                return b.title.localeCompare(a.title, 'zh');
            case 'title-asc':
                return a.title.localeCompare(b.title, 'zh');
            case 'myrating-asc':
                return (a.rating || 0) - (b.rating || 0);
            case 'myrating-desc':
                return (b.rating || 0) - (a.rating || 0);
            case 'status-asc':
                return STATUS_RANK[a.status] - STATUS_RANK[b.status];
            case 'status-desc':
                return STATUS_RANK[b.status] - STATUS_RANK[a.status];
            // 🔴 #441 系列序号：比较逻辑走 `pure/seriesGroup.compareSeriesIndex`（**单一真源**），
            //    ⛔ 别在这里复述一遍「序号 → 年份 → 标题、无序号置后」。
            case 'series-asc':
                return compareSeriesIndex(a, b);
            case 'series-desc':
                return compareSeriesIndexDesc(a, b);
            // 🔴 m08754 ②：统计时长排序 —— 取值走 `entryDurationMinutes`（本文件上方，单一真源）。
            //    没有时长的条目（影视全类、以及未记录时长的书籍/游戏/音乐）恒 0：
            //    ↓ 档里它们排在最后（最短时长），↑ 档里排最前 —— 与「从小到大」的字面语义一致，
            //    ⛔ 别额外加「空值一律置后」的特判（那会让「↑」不再是从小到大，读数与顺序自相矛盾）。
            case 'duration-desc':
                return entryDurationMinutes(b) - entryDurationMinutes(a);
            case 'duration-asc':
                return entryDurationMinutes(a) - entryDurationMinutes(b);
            case 'recent':
            default:
                return b.updatedAt.localeCompare(a.updatedAt);
            case 'recent-asc':
                return a.updatedAt.localeCompare(b.updatedAt);
        }
    });
}

/** 综合筛 + 排序：filter → sort；保持原数组不被外部 mutate */
export function filterAndSort(
    entries: MediaEntry[],
    opts: {
        status: MediaStatus | 'all';
        type: 'all' | EntryType;
        query: string;
        sortBy: SortBy;
        /** 书籍子分类（1.0.3）：仅阅读页签传入（'all' = 不过滤）；缺省/undefined 不过滤（聚合页签与旧调用不受影响）。
         *  音乐子分类维度已于 1.0.3.1 下线（用户 2026-09-13 裁定），不再有此过滤项。 */
        bookKind?: 'all' | BookKind;
        /** 题材（视图级题材筛选，用户 2026-09-22）：已选题材值数组（含「未分类」保留键）；缺省/空数组不过滤。
         *  多选内部是 OR；与状态/类型/分类/关键词是 AND。判定见 pure/genreFilter.matchesGenres */
        genres?: readonly string[];
        /**
         * 🔴 m07854 ⑮「待补」漏斗：只留**缺关联 或 缺个人评分**的条目；缺省/`false` 不过滤。
         *
         * ⚠️ 判据的单一真源在 `pure/incomplete.isIncomplete`（它自己又复用
         *    `pure/seriesAssoc.assocFlagsOf` 与 `pure/rating.normalizeRating`）——
         *    ⛔ 别在这里内联一遍条件，那是本仓反复栽过的「同一件事两份真源」。
         */
        incompleteOnly?: boolean;
    },
): MediaEntry[] {
    return sortEntries(
        entries
            .filter((e) => matchesStatus(e, opts.status))
            .filter((e) => matchesType(e, opts.type))
            .filter((e) => matchesBookKind(e, opts.bookKind ?? 'all'))
            .filter((e) => matchesGenres(e, opts.genres ?? []))
            .filter((e) => matchesSearch(e, opts.query))
            .filter((e) => (opts.incompleteOnly ? isIncomplete(e) : true)),
        opts.sortBy,
    );
}
