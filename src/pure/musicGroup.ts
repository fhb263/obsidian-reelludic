import type { MediaEntry } from 'data/types';

/** 音乐分组：歌手名 + 组内条目 */
export interface MusicGroup {
    artist: string;
    entries: MediaEntry[];
}

/** 未填歌手的条目归入此组（置底） */
export const UNCATEGORIZED_ARTIST = '未分类';

/** 组内排序：专辑 → 年份 → 标题（中文本地化比较） */
function sortSongs(list: MediaEntry[]): MediaEntry[] {
    return [...list].sort((a, b) => {
        const ab = (a.album ?? '').localeCompare(b.album ?? '', 'zh');
        if (ab !== 0) return ab;
        if ((a.year ?? 0) !== (b.year ?? 0)) return (a.year ?? 0) - (b.year ?? 0);
        return (a.title ?? '').localeCompare(b.title ?? '', 'zh');
    });
}

/**
 * 音乐条目按歌手分组（音乐页签歌单）：
 * - 有 author 的按歌手名分组（修剪空白后比较），组名按中文本地化排序；
 * - 无 author / 空白 author 归「未分类」组置底；
 * - 组内按专辑 → 年份 → 标题排序。
 */
export function groupMusicByArtist(entries: MediaEntry[]): MusicGroup[] {
    if (entries.length === 0) return [];
    const byArtist = new Map<string, MediaEntry[]>();
    for (const e of entries) {
        const artist = e.author?.trim() || UNCATEGORIZED_ARTIST;
        const list = byArtist.get(artist);
        if (list) list.push(e);
        else byArtist.set(artist, [e]);
    }
    const named = [...byArtist.entries()]
        .filter(([artist]) => artist !== UNCATEGORIZED_ARTIST)
        .sort((a, b) => a[0].localeCompare(b[0], 'zh'))
        .map(([artist, list]) => ({ artist, entries: sortSongs(list) }));
    const uncategorized = byArtist.get(UNCATEGORIZED_ARTIST);
    if (uncategorized) named.push({ artist: UNCATEGORIZED_ARTIST, entries: sortSongs(uncategorized) });
    return named;
}
