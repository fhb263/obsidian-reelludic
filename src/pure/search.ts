// 关键词过滤（纯逻辑，可单测）：按当前 Tab 维度（types）筛后再按搜索词筛
// 用于 MediaList 的实时标题/原名模糊匹配（不区分大小写、去首尾空白）
import type { EntryType, MediaEntry } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { MEDIA_STATUSES } from 'pure/status';

/** 状态排序基准（想看 0 < 在看 1 < 已看 2 < 存档 3） */
const STATUS_RANK: Record<MediaStatus, number> = Object.fromEntries(MEDIA_STATUSES.map((s, i) => [s, i])) as Record<MediaStatus, number>;

/** 命中判定：标题/原名小写后包含搜索词；书籍/音乐额外匹配作者、游戏额外匹配开发商（与占位文案字段一致）；空搜索词视为不过滤 */
export function matchesSearch(e: MediaEntry, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const title = e.title.toLowerCase();
    const orig = (e.originalTitle ?? '').toLowerCase();
    if (title.includes(q) || orig.includes(q)) return true;
    if (e.type === 'book' || e.type === 'music') return (e.author ?? '').toLowerCase().includes(q);
    if (e.type === 'game') return (e.developer ?? '').toLowerCase().includes(q);
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
 *  status-asc=状态 想看→在看→已看→存档 / status-desc=反之 */
export type SortBy = 'recent' | 'recent-asc' | 'release-desc' | 'release-asc' | 'score-desc' | 'score-asc' | 'title-desc' | 'title-asc' | 'myrating-desc' | 'myrating-asc' | 'status-asc' | 'status-desc';

/** 综合筛 + 排序：filter → sort；保持原数组不被外部 mutate */
export function filterAndSort(
    entries: MediaEntry[],
    opts: {
        status: MediaStatus | 'all';
        type: 'all' | EntryType;
        query: string;
        sortBy: SortBy;
    },
): MediaEntry[] {
    return entries
        .filter((e) => matchesStatus(e, opts.status))
        .filter((e) => matchesType(e, opts.type))
        .filter((e) => matchesSearch(e, opts.query))
        .slice()
        .sort((a, b) => {
            switch (opts.sortBy) {
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
                case 'recent':
                default:
                    return b.updatedAt.localeCompare(a.updatedAt);
                case 'recent-asc':
                    return a.updatedAt.localeCompare(b.updatedAt);
            }
        });
}
