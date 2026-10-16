/**
 * 音乐下载面（⑤-c）的**纯逻辑**（2026-09-27 #398）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * ## 分工
 * - 拼 URL / 解析响应 / 归一候选 / 格式化文案 ⇒ **本模块**（纯函数，喂 fixture 单测）。
 * - 发请求 / 落盘 ⇒ `services/musicDownload`（HTTP 注入）。
 *
 * ## 为什么「推荐歌单 / 歌单歌曲」也能免密做
 * 金标准 LyricFlux 走的是 `weapi/*`（要 `encryptWeApi`，而 `neteaseCrypto` 源自 **AGPL** 的
 * `go-music-dl` ⇒ 用户裁定 **D-13(a)** 明令不碰）。但网易云的**公开 `/api/` 端点同样可用**
 * （2026-09-27 本机 curl 实测）：
 *   - `api/personalized/playlist?limit=N` → `200`，返回推荐歌单；
 *   - `api/playlist/detail?id=X`        → `200`，**一次返回全部歌曲**（不必像 weapi 那样分批 `song/detail`）。
 * ⇒ 走公开端点即可，加密一行都不需要。
 *
 * ⚠️ **两条硬约束（实测得出，⛔ 别当成 bug 去「修」）**：
 *   ⑴ **歌单里的歌绝大多数下不了**：热歌榜 200 首的 `fee` 分布实测是 `{8: 72, 1: 127, 0: 1}`
 *      ⇒ 只有 **1 首**能走免费通道。所以歌单视图**必须逐首标可下载性**，
 *      ⛔ 绝不能提供一个「下载全部」按钮（那等于造一个必然失败的批量操作）。
 *   ⑵ **两个端点的曲目字段名不同**：`cloudsearch` 用 `ar` / `dt`（毫秒），`playlist/detail` 用
 *      `artists` / `duration`（毫秒）⇒ 各写各的解析，⛔ 别指望一个函数同时吃两种形态。
 */
import { isNeteaseDownloadable, neteaseSongPageUrl } from 'pure/songDownload';

/** 归一后的歌曲条目（搜索结果 / 歌单歌曲共用同一形态，UI 只认这一种） */
export interface MusicSong {
    id: string;
    name: string;
    artists: string[];
    album?: string;
    durationSec?: number;
    coverUrl?: string;
    /** 可经免费通道下载吗（`fee=0` 或字段缺失） */
    downloadable: boolean;
    fee?: number;
    /**
     * 音频档位（#405：下载界面那一行的 `128kbps` / `3.85MB` 两个胶囊）。
     * 来源 = 搜索响应自带的档位（网易云 `l`/`m`/`h`，见 `pure/lyricOnline.parseNeteaseSearch`）。
     * 缺值 ⇒ 界面不显示对应胶囊（⛔ 不补假值）。
     */
    bitrate?: number;
    size?: number;
    /** 歌曲网页地址（弹窗「打开歌曲页」用；空串 = 不可用） */
    pageUrl: string;
}

/** 推荐歌单卡片 */
export interface MusicPlaylist {
    id: string;
    name: string;
    coverUrl: string;
    /** 播放量（接口给浮点数，用于「2.0亿 次播放」） */
    playCount?: number;
    /** 曲目数 */
    trackCount?: number;
}

/** 歌单详情（含全部歌曲） */
export interface MusicPlaylistDetail {
    name: string;
    coverUrl: string;
    songs: MusicSong[];
}

/** 一次拉几个推荐歌单（截图里一屏约 4 个，取 6 留点滚动余量） */
export const RECOMMEND_PLAYLIST_LIMIT = 6;

/** 封面缩略图边长（网易云图片服务支持 `?param=NxN`，省一半以上流量） */
export const COVER_THUMB_SIZE = 120;

// ────────────────────────────── URL 构造 ──────────────────────────────

export function neteaseRecommendUrl(limit = RECOMMEND_PLAYLIST_LIMIT): string {
    return `https://music.163.com/api/personalized/playlist?limit=${limit}`;
}

export function neteasePlaylistDetailUrl(id: string): string {
    return `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(String(id ?? '').trim())}`;
}

/**
 * 加缩略图参数（`?param=NxN`）。已带查询串时用 `&` 追加；
 * ⛔ 不给空 URL 拼出 `?param=` 这种无意义串（调用方会拿到空串，直接展示占位图）。
 */
export function neteaseCoverUrl(url: string, size = COVER_THUMB_SIZE): string {
    const u = String(url ?? '').trim();
    if (!u) return '';
    const sep = u.includes('?') ? '&' : '?';
    return `${u}${sep}param=${size}y${size}`;
}

// ────────────────────────────── 响应解析 ──────────────────────────────

function safeJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function names(list: unknown): string[] {
    return Array.isArray(list)
        ? (list as { name?: unknown }[]).map((x) => (typeof x?.name === 'string' ? x.name : '')).filter(Boolean)
        : [];
}

/**
 * 推荐歌单响应：`result[]` ⇒ `{ id, name, picUrl, playCount, trackCount }`。
 * ⚠️ 实测 `trackNumber` 常为 `null`（只有 `trackCount` 有值）⇒ **两个都试**，
 *  ⛔ 别只读一个字段（那会让「N 首」这一行永远消失）。
 */
export function parseNeteasePlaylists(raw: string): MusicPlaylist[] {
    const data = safeJson(raw) as { result?: unknown } | undefined;
    const list = data?.result;
    if (!Array.isArray(list)) return [];
    const out: MusicPlaylist[] = [];
    for (const it of list) {
        const row = it as { id?: unknown; name?: unknown; picUrl?: unknown; playCount?: unknown; trackCount?: unknown; trackNumber?: unknown };
        const id = String(row.id ?? '').trim();
        const name = typeof row.name === 'string' ? row.name : '';
        if (!id || !name) continue;
        const trackCount = Number(row.trackCount ?? row.trackNumber);
        const playCount = Number(row.playCount);
        out.push({
            id,
            name,
            coverUrl: typeof row.picUrl === 'string' ? row.picUrl : '',
            trackCount: Number.isFinite(trackCount) && trackCount > 0 ? trackCount : undefined,
            playCount: Number.isFinite(playCount) && playCount > 0 ? playCount : undefined,
        });
    }
    return out;
}

/**
 * 歌单详情响应：`result.tracks[]` ⇒ `MusicSong[]`。
 * 🔴 这个端点的曲目用 **`artists` / `duration`**（不是 `cloudsearch` 的 `ar` / `dt`）——
 *  见模块头注释的约束 ⑵。`coverUrl` 取 `album.picUrl`（曲目自身没有封面字段）。
 */
export function parseNeteasePlaylistDetail(raw: string): MusicPlaylistDetail | null {
    const data = safeJson(raw) as { result?: unknown } | undefined;
    const r = data?.result as
        | { name?: unknown; coverImgUrl?: unknown; tracks?: unknown; playlist?: unknown }
        | undefined;
    if (!r || typeof r !== 'object') return null;
    const tracks = Array.isArray(r.tracks) ? r.tracks : Array.isArray(r.playlist) ? r.playlist : [];
    const songs: MusicSong[] = [];
    for (const it of tracks as unknown[]) {
        const row = it as {
            id?: unknown;
            name?: unknown;
            artists?: unknown;
            album?: { name?: unknown; picUrl?: unknown };
            duration?: unknown;
            fee?: unknown;
        };
        const id = String(row.id ?? '').trim();
        const name = typeof row.name === 'string' ? row.name : '';
        if (!id || !name) continue;
        const dur = Number(row.duration);
        const fee = Number(row.fee);
        songs.push({
            id,
            name,
            artists: names(row.artists),
            album: typeof row.album?.name === 'string' ? row.album.name : undefined,
            durationSec: Number.isFinite(dur) && dur > 0 ? Math.round(dur / 1000) : undefined,
            coverUrl: typeof row.album?.picUrl === 'string' ? row.album.picUrl : undefined,
            fee: Number.isFinite(fee) ? fee : undefined,
            downloadable: isNeteaseDownloadable(Number.isFinite(fee) ? fee : undefined),
            pageUrl: neteaseSongPageUrl(id),
        });
    }
    return {
        name: typeof r.name === 'string' ? r.name : '',
        coverUrl: typeof r.coverImgUrl === 'string' ? r.coverImgUrl : '',
        songs,
    };
}

// ────────────────────────────── 文案格式化 ──────────────────────────────

/**
 * 播放量文案（截图口径：「2.0亿」「1369.4万」）：
 * `≥1e8` → 亿（一位小数）；`≥1e4` → 万（一位小数）；其余原样取整。
 * 非有限值 / 0 / 负数一律 `''`（⛔ 不显示「0 次播放」）。
 */
export function formatPlayCount(n: number | undefined): string {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
    return String(Math.round(v));
}

/** 歌单副行：「506 首 · 2.0亿 次播放」（缺项自动省略；两项都缺 ⇒ `''`） */
export function formatPlaylistMeta(p: MusicPlaylist): string {
    const parts: string[] = [];
    if (p.trackCount && p.trackCount > 0) parts.push(`${p.trackCount} 首`);
    const pc = formatPlayCount(p.playCount);
    if (pc) parts.push(`${pc} 次播放`);
    return parts.join(' · ');
}

/** 歌曲副行：「甲 / 乙 · 4:59」（缺歌手只留时长，反之亦然） */
export function formatSongMeta(song: MusicSong): string {
    const head = (song.artists ?? []).filter(Boolean).join(' / ');
    const dur = Number(song.durationSec);
    const tail = Number.isFinite(dur) && dur > 0 ? `${Math.floor(dur / 60)}:${String(Math.round(dur) % 60).padStart(2, '0')}` : '';
    return [head, tail].filter(Boolean).join(' · ');
}

/** 歌单里可下载的曲目数（UI 用它提示「本歌单 N 首中 M 首可下载」） */
export function downloadableCount(songs: MusicSong[]): number {
    return (songs ?? []).filter((s) => s.downloadable).length;
}
