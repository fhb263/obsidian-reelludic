/**
 * 网易云「免费通道」搜索 + 下载的**服务层**（2026-09-27 #397，⑤-c）—— 只做「拼 URL + 发请求 + 交给纯模块」。
 *
 * ## 分工
 * - 拼 URL / 解析响应 / 可下载判定 / 字节嗅探 ⇒ `pure/lyricOnline`（搜索解析，**复用 #396 的歌词面实现**）
 *   + `pure/songDownload`（外链直链与音频判据）。
 * - 发请求 / 落盘 ⇒ 本模块，且 **HTTP 与 store 都走注入**（对齐 `services/lyricSearch` 的口径）。
 *
 * ## 🔴 为什么搜索结果**不做过过滤**
 * 免费通道只覆盖 `fee=0` 的曲目（实测 `fee=1/8` 一律 302 到 `/404`，见 `pure/songDownload` 头注释）。
 * 若把不可下载的条目**从列表里删掉**，用户看到的就是「搜不到这首歌」——**错误归因**。
 * ⇒ 一并返回、由 UI 标「需 VIP/付费」并禁用下载按钮，同时用 `vipCount` 给一句总数提示。
 *
 * ⚠️ **仅桌面端可用**（`nodeHttp` 依赖 Node 内置 https / http）⇒ 调用方（`main.ts`）按
 *    `Platform.isDesktopApp` 门控，移动端不给下载入口。
 */
import type { LyricCandidate } from 'pure/lyricOnline';
import { LYRIC_SOURCE_HEADERS, buildLyricQuery, neteaseSearchUrl, parseNeteaseSearch } from 'pure/lyricOnline';
import type { MusicPlaylist, MusicPlaylistDetail, MusicSong } from 'pure/musicDownload';
import {
    RECOMMEND_PLAYLIST_LIMIT,
    neteasePlaylistDetailUrl,
    neteaseRecommendUrl,
    parseNeteasePlaylistDetail,
    parseNeteasePlaylists,
} from 'pure/musicDownload';
import {
    audioBytesIssue,
    isNeteaseDownloadable,
    neteaseOuterUrl,
    neteaseSongPageUrl,
    sniffAudioExt,
    songDownloadFilename,
} from 'pure/songDownload';
// 复用歌词面的「文本 GET」注入类型与请求头真源：同形（`(url, headers) => {status, text}`），
// ⛔ 别再定义第二个 —— 两个同形类型迟早各改一半。
import type { LyricHttpGet } from 'services/lyricSearch';
import { downloadToVault, type DownloadHttpGet, type DownloadOutcome, type DownloadStore } from 'services/downloader';

/** 单次搜索取几条（弹窗列表够选即可；取太多会让面板变成长列表） */
export const SONG_SEARCH_LIMIT = 10;

/**
 * 🔴 类型与解析的**真源在 `pure/musicDownload`**（纯函数、可喂 fixture 单测）；这里 re-export 一次，
 * 让既有调用方（`tests/musicDownload.test.ts` / UI 层）的 import 路径保持不变。
 * ⛔ **别在这里再定义一份 `MusicSong`** —— 两套同形类型迟早各改一半。
 */
export type { MusicSong };

export interface MusicSearchOutcome {
    /** 实际使用的检索词；标题为空 ⇒ `null`（调用方应在此前就禁用按钮） */
    query: string | null;
    /** 全部候选（**含不可下载的**，顺序 = 接口相关度序；排序策略归 UI 层） */
    songs: MusicSong[];
    /** 其中不可下载（VIP / 付费）的条数 —— 弹窗据此如实提示「N 条需 VIP/付费」 */
    vipCount: number;
    /** 请求失败的原因（与「请求成功但 0 条」是两回事 ⇒ 文案不同） */
    error?: string;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function toSong(c: LyricCandidate): MusicSong {
    return {
        id: c.id,
        name: c.name,
        artists: Array.isArray(c.artists) ? c.artists : [],
        durationSec: c.durationSec,
        downloadable: isNeteaseDownloadable(c.fee),
        fee: c.fee,
        // #405：把搜索响应里带的档位透传给下载面（下载界面显示 kbps / 体积）
        bitrate: c.bitrate,
        size: c.size,
        pageUrl: neteaseSongPageUrl(c.id),
    };
}

/**
 * 搜索（检索词与歌词面**同一真源** `buildLyricQuery` ⇒ 用户在表单里看到的词与下载面一致）。
 * 标题为空 ⇒ 不发请求、`query` 返回 `null`。任何请求/解析异常都收敛成 `error`（⛔ 不抛）。
 */
export async function searchSongs(http: LyricHttpGet, title: string, author?: string): Promise<MusicSearchOutcome> {
    const query = buildLyricQuery(title, author);
    if (!query) return { query: null, songs: [], vipCount: 0 };
    let raw: LyricCandidate[];
    try {
        const res = await http(neteaseSearchUrl(query, SONG_SEARCH_LIMIT), LYRIC_SOURCE_HEADERS.netease);
        if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
        raw = parseNeteaseSearch(res.text);
    } catch (e) {
        return { query, songs: [], vipCount: 0, error: errText(e) };
    }
    const songs = raw.map(toSong);
    return { query, songs, vipCount: songs.filter((s) => !s.downloadable).length };
}

export interface MusicDownloadRequest {
    song: Pick<MusicSong, 'id' | 'name' | 'artists'>;
    /** 库内下载根目录（缺省 `下载`） */
    root?: string;
    /** 当前已存在的库内相对路径（重名去重依据） */
    taken?: ReadonlySet<string>;
}

/**
 * 下载一首歌到库内（免费通道；落 `<root>/音乐/…`）。
 * 扩展名**按真实字节嗅探**决定（外链 URL 恒写 `.mp3`，但内容未必是 mp3）；
 * 内容校验交给 `audioBytesIssue`（字节过小 / 魔数不识别 ⇒ 「302 到 /404 的 HTML 页」会被拦在这里）。
 */
export async function downloadSong(
    http: DownloadHttpGet,
    store: DownloadStore,
    req: MusicDownloadRequest,
): Promise<DownloadOutcome> {
    const { song } = req;
    return downloadToVault(http, store, {
        url: neteaseOuterUrl(song.id),
        headers: LYRIC_SOURCE_HEADERS.netease,
        kind: 'music',
        filename: (bytes) => songDownloadFilename(song.artists, song.name, sniffAudioExt(bytes) ?? 'mp3'),
        root: req.root,
        taken: req.taken,
        validate: audioBytesIssue,
    });
}

export interface PlaylistOutcome {
    playlists: MusicPlaylist[];
    /** 请求失败的原因（与「成功但 0 个」是两回事 ⇒ UI 文案不同） */
    error?: string;
}

/**
 * 拉推荐歌单（**公开端点**：免登录 / 免加密，见 `pure/musicDownload` 头注释）。
 * 失败一律收敛成 `error`（⛔ 不抛）—— 首屏加载失败不该让整个弹窗打不开。
 */
export async function fetchRecommendedPlaylists(
    http: LyricHttpGet,
    limit = RECOMMEND_PLAYLIST_LIMIT,
): Promise<PlaylistOutcome> {
    try {
        const res = await http(neteaseRecommendUrl(limit), LYRIC_SOURCE_HEADERS.netease);
        if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
        return { playlists: parseNeteasePlaylists(res.text) };
    } catch (e) {
        return { playlists: [], error: errText(e) };
    }
}

export interface PlaylistDetailOutcome {
    /** `null` = 响应结构不符（接口变更）—— 与「歌单确实是空的」不是一回事 */
    detail: MusicPlaylistDetail | null;
    error?: string;
}

/**
 * 拉歌单全部歌曲。🔴 公开端点**一次返回全部**（实测热歌榜 200 首 / 617 KB），
 * 不必像金标准的 weapi 链路那样先取 trackIds 再分批 `song/detail`。
 */
export async function fetchPlaylistDetail(http: LyricHttpGet, id: string): Promise<PlaylistDetailOutcome> {
    const pid = String(id ?? '').trim();
    if (!pid) return { detail: null };
    try {
        const res = await http(neteasePlaylistDetailUrl(pid), LYRIC_SOURCE_HEADERS.netease);
        if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
        const detail = parseNeteasePlaylistDetail(res.text);
        return detail ? { detail } : { detail: null, error: '响应结构不符（接口可能已变更）' };
    } catch (e) {
        return { detail: null, error: errText(e) };
    }
}
