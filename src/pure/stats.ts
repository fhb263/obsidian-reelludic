// 跨库统计纯逻辑（无 obsidian 依赖，可单测）：口径见 14-跨库统计需求澄清
// 本年「看完」= watchedDate 落在年内（三库通用）；本年「活跃」= 任一动态时间戳落在年内
import type { EntryType, MediaEntry } from 'data/types';
import { ENTRY_TYPES } from 'data/types';
import { MEDIA_STATUSES, type MediaStatus } from 'pure/status';

/** 年份前缀匹配：'YYYY-MM-DD' 是否属于某年 */
function inYear(date: string | undefined, year: number): boolean {
    return !!date && date.slice(0, 4) === String(year);
}

/** 本年「看完/读完」：watchedDate 落在年内 */
export function finishedInYear(e: MediaEntry, year: number): boolean {
    return inYear(e.watchedDate, year);
}

/** 本年「活跃」：任一动态时间戳（观看/计划/追更/游玩）落在年内 */
export function activeInYear(e: MediaEntry, year: number): boolean {
    if (inYear(e.watchedDate, year) || inYear(e.plannedDate, year)) return true;
    for (const h of e.progress?.history ?? []) if (inYear(h.date, year)) return true;
    for (const s of e.playSessions ?? []) if (inYear(s.date, year)) return true;
    return false;
}

function zeroTypeCount(): Record<EntryType, number> {
    const out = Object.create(null) as Record<EntryType, number>;
    for (const t of ENTRY_TYPES) out[t] = 0;
    return out;
}

/** 本年看完条目数（按类型分组） */
export function finishedByType(entries: MediaEntry[], year: number): Record<EntryType, number> {
    const out = zeroTypeCount();
    for (const e of entries) if (finishedInYear(e, year)) out[e.type]++;
    return out;
}

/** 本年活跃条目数（按类型分组） */
export function activeByType(entries: MediaEntry[], year: number): Record<EntryType, number> {
    const out = zeroTypeCount();
    for (const e of entries) if (activeInYear(e, year)) out[e.type]++;
    return out;
}

/** 状态×类型交叉矩阵（全库） */
export type StatusTypeMatrix = Record<EntryType, Record<MediaStatus, number>>;
export function statusTypeMatrix(entries: MediaEntry[]): StatusTypeMatrix {
    const out = Object.create(null) as StatusTypeMatrix;
    for (const t of ENTRY_TYPES) {
        const row = Object.create(null) as Record<MediaStatus, number>;
        for (const s of MEDIA_STATUSES) row[s] = 0;
        out[t] = row;
    }
    for (const e of entries) out[e.type][e.status]++;
    return out;
}

/** 时长聚合：跨库「消耗量」 */
export interface DurationStats {
    /** 影视片长总和（分钟，movie/tv/anime durationMin） */
    movieMinutes: number;
    /** 剧集/动画已追集数（progress.history 长度） */
    episodes: number;
    /** 书籍总页数（元数据 pageCount 优先，旧数据回退进度基准 totalPage） */
    bookPages: number;
    /** 游戏游玩总时长（分钟，playtimeMinutes 求和） */
    playMinutes: number;
    /** 游玩记录条数 */
    playSessions: number;
}
export function durationStats(entries: MediaEntry[]): DurationStats {
    let movieMinutes = 0;
    let episodes = 0;
    let bookPages = 0;
    let playMinutes = 0;
    let playSessions = 0;
    for (const e of entries) {
        if (e.type === 'book') {
            bookPages += e.pageCount ?? e.readingProgress?.totalPage ?? 0;
        } else if (e.type === 'game') {
            playMinutes += e.playtimeMinutes ?? 0;
            playSessions += (e.playSessions ?? []).length;
        } else {
            movieMinutes += e.durationMin ?? 0;
            episodes += (e.progress?.history ?? []).length;
        }
    }
    return { movieMinutes, episodes, bookPages, playMinutes, playSessions };
}

/** 月度「看完」趋势（1-12 月计数，watchedDate 口径） */
export function monthlyFinished(entries: MediaEntry[], year: number): number[] {
    const out = new Array<number>(12).fill(0);
    for (const e of entries) {
        const d = e.watchedDate;
        if (inYear(d, year)) {
            const m = Number(d!.slice(5, 7));
            if (m >= 1 && m <= 12) out[m - 1]++;
        }
    }
    return out;
}

/** 月度「活跃」趋势（1-12 月计数，任一动态时间戳口径） */
export function monthlyActive(entries: MediaEntry[], year: number): number[] {
    const out = new Array<number>(12).fill(0);
    const bump = (d: string | undefined) => {
        if (inYear(d, year)) {
            const m = Number(d!.slice(5, 7));
            if (m >= 1 && m <= 12) out[m - 1]++;
        }
    };
    for (const e of entries) {
        bump(e.watchedDate);
        bump(e.plannedDate);
        for (const h of e.progress?.history ?? []) bump(h.date);
        for (const s of e.playSessions ?? []) bump(s.date);
    }
    return out;
}

/** 某年内看完的个人高分榜（rating > 0，降序，limit 条） */
export function topRatedInYear(entries: MediaEntry[], year: number, limit = 5): MediaEntry[] {
    return entries
        .filter((e) => finishedInYear(e, year) && e.rating > 0)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, limit);
}
