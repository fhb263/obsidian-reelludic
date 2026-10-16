/**
 * 四平台下载面服务层（网易云 / QQ / 酷狗 / 酷我）——
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/downloadManager.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 *
 * 🔴 **本仓明确不做**（用户 2026-09-28：「音频下载后不要回填标签那套、和编辑歌曲文件标签那个功能，因为有风险不搞这套」）：
 *    · `enrichDownloadTags` / `embedTagsIntoBytes`（写完音频后再往里塞 ID3 / MP4 / Vorbis 标签）
 *    · `TagEditorModal` / `TagViewerModal`（编辑歌曲文件标签）
 *    ⇒ 下载只做「取字节 → 判型 → 落盘」，**不碰用户拿到的音频字节**（除了原样写入）。
 *
 * 🔴 分层：本文件只做「发请求 + 组装」，URL/请求体/解析全在 `pure/dl/*`（可单测）；
 *    落盘经注入的 `DlWriteTarget`（本仓 `main.writeBinaryFile` 负责补父目录 / `byteOffset` 切片）。
 *
 * ⚠️ 与正本的差异（移植时按本仓口径收敛，不是遗漏）：
 *    ⑴ 进度：正本按响应字节数上报百分比；本仓传输层（`services/nodeHttp`）暂无流式进度钩子
 *       ⇒ 先只上报**阶段文本**（`onProgress(null, '正在下载…')`），百分比留给后续增强。
 *    ⑵ 路径：正本自带 `resolveDownloadTargetUnique`；本仓统一走 `pure/downloadPlan.downloadRelPath`
 *       （净化 / 重名 `(2)(3)` / 扩展名白名单已是既有真源）。
 *    ⑶ 网易云的搜索与歌单**复用本仓既有服务**（`services/musicDownload`，@396 起就在用）⇒ 不搬第二份。
 */
import { downloadRelPath } from 'pure/downloadPlan';
import { neteaseOuterUrl } from 'pure/songDownload';
import {
    fetchPlaylistDetail as neteasePlaylistDetail,
    fetchRecommendedPlaylists as neteaseRecommendedPlaylists,
    searchSongs as neteaseSearchSongs,
    type MusicSearchOutcome,
} from 'services/musicDownload';
import type { MusicSong } from 'pure/musicDownload';
import {
    buildQqDissCountsBody,
    buildQqDissDetailUrl,
    buildQqDissDetailV2Body,
    buildQqDissListUrl,
    buildQqSearchUrl,
    buildQqUserInfoUrl,
    buildQqVkeyBody,
    buildQqVkeyUrl,
    extractQqUin,
    makeGuid,
    parseQqDissCounts,
    parseQqDissDetail,
    parseQqDissDetailV2,
    parseQqDissList,
    parseQqPurl,
    parseQqSearchResponse,
    parseQqUserInfo,
    QQ_MUSICU_URL,
} from 'pure/dl/qq';
import {
    buildKugouSearchUrl,
    buildKugouSongInfoUrl,
    buildKugouSpecialDetailUrl,
    buildKugouSpecialListUrl,
    buildKugouTrackercdnUrl,
    KUGOU_MOBILE_REFERER,
    KUGOU_MOBILE_UA,
    KUGOU_PC_REFERER,
    KUGOU_VIP_ROLEINFO_URL,
    parseKugouRoleinfo,
    parseKugouSearchResponse,
    parseKugouSongInfoResponse,
    parseKugouSpecialDetail,
    parseKugouSpecialList,
    parseKugouTrackercdnResponse,
} from 'pure/dl/kugou';
import {
    buildKuwoMobiUrl,
    buildKuwoPlaylistDetailUrl,
    buildKuwoRcmPlaylistUrl,
    buildKuwoSearchUrl,
    KUWO_QUALITIES,
    KUWO_UA,
    makeKuwoUser,
    parseKuwoMobiResponse,
    parseKuwoPlaylistDetail,
    parseKuwoRcmPlaylist,
    parseKuwoSearchResponse,
} from 'pure/dl/kuwo';
import { buildSongDetailBody, encryptEApi, encryptWeApi, parseSongDetailSongs, parseVipAccountResponse } from 'pure/dl/neteaseCrypto';
import { buildSongFilename, buildSongWebUrl, songSimilarityScore } from 'pure/dl/utils';

// ────────────────────────────── 常量 ──────────────────────────────

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://music.163.com';
const QQ_REFERER = 'https://y.qq.com/';
const KUWO_REFERER = 'http://www.kuwo.cn/';
/** 网易云会员校验（weapi） */
const NETEASE_ACCOUNT_API = 'https://music.163.com/weapi/nuser/account/get';
/**
 * #509 网易云**按 songid 取歌曲详情**（weapi/v3/song/detail）—— 只为拿**封面**（`al.picUrl`）。
 * 🔴 为什么要它：网易云的**搜索响应里一条封面都没有**（实测 10 条 / 0 带封面）⇒ 想按网易云出封面，
 *    必须再补这一次详情请求。实测**免 Cookie 也能用**（200 + 5 条 5 个封面）。
 */
const NETEASE_SONG_DETAIL_API = 'https://music.163.com/weapi/v3/song/detail';
/** 网易云 VIP 直链：eapi（无损/高解析）与 weapi（320k） */
const NETEASE_EAPI_URL = 'https://interface3.music.163.com/eapi/song/enhance/player/url/v1';
const NETEASE_WEAPI_URL = 'https://music.163.com/weapi/song/enhance/player/url';
/** 音频字节门槛（正本口径）：CDN 的 `content-type` 常是 `application/octet-stream` ⇒ 只信字节数 + 魔数 */
const MIN_AUDIO_BYTES = 64 * 1024;
/** 正本 `SEARCH_PLATFORM_ALL`：搜索/歌单按这个固定顺序展示 */
export const DL_PLATFORMS = ['netease', 'qq', 'kugou', 'kuwo'] as const;

/**
 * 搜索**结果的平台优先顺序**（#405 用户：「把歌曲搜索返回结果排序改成酷我优先返回」）。
 *
 * 🔴 与 `DL_PLATFORMS` **刻意分开**，别合并：
 *    · `DL_PLATFORMS` = 「平台清单」的口径 —— 弹窗平台胶囊的顺序、设置页四平台行的顺序都用它；
 *    · 本常量 = 「同一首歌在哪个平台的结果排在前面」—— 只作用于 `dlSearch` 的排序主键。
 *    用户只要求改**搜索结果的先后**（酷我免费可下载的命中率最高），⛔ 别顺手把胶囊/设置页顺序也改了。
 */
export const DL_SEARCH_ORDER: readonly PlaylistSource[] = ['kuwo', 'netease', 'qq', 'kugou'];

// ────────────────────────────── 类型 ──────────────────────────────

export type PlaylistSource = (typeof DL_PLATFORMS)[number];

/** 进度回调：`percent` 为 null 表示「只有阶段、没有百分比」 */
export type DownloadProgressCallback = (percent: number | null, label: string) => void;

/** 统一的多源下载候选（移植自正本 `DownloadSong`） */
export interface DownloadSong {
    source: PlaylistSource;
    /** 平台内 id：netease=数字 songid 字符串，qq=songmid，kugou=hash，kuwo=rid */
    id: string;
    name: string;
    artist: string;
    album?: string;
    coverUrl?: string;
    /** 时长（秒），结果行展示 03:25 */
    duration?: number;
    /** 文件大小（字节），结果行展示 2.08MB（各平台能给的才给） */
    size?: number;
    /** 码率（kbps），结果行展示 128kbps */
    bitrate?: number;
    /** netease 专用：数字 songid */
    neteaseId?: number;
    /** qq 专用：songmid */
    songmid?: string;
    /** VIP 受限标记：网易云 fee>0 / QQ payplay=1 / 酷狗 privilege=10，仅标注不屏蔽 */
    vip?: boolean;
    /** kuwo 专用：纯数字 rid */
    kuwoRid?: string;
    /** 该来源下载是否需要登录 Cookie */
    needsCookie?: boolean;
    /** 音频格式（结果行格式胶囊）：按该平台搜索档位推断 mp3/m4a/flac */
    ext?: 'mp3' | 'm4a' | 'flac';
    /** 平台歌曲网页地址；缺少必要 ID 时缺省 */
    webUrl?: string;
    /**
     * #509：**专辑图**（方封面）路径片段 —— 目前只有酷我给（`web_albumpic_short`）。
     * 🔴 与 `coverUrl` **不是同一张**：酷我那个是 **MV 横图**；拼成可下载地址见
     *    `pure/posterSources.kuwoAlbumCoverUrl`（实测 1000×1000）。append-only 字段。
     */
    albumPicPath?: string;
}

/** 统一的推荐歌单项（各平台解析后归一化） */
export interface RecommendedPlaylist {
    source: PlaylistSource;
    /** 平台内歌单 id：netease=数字、qq=dissid、kugou=specialid、kuwo=pid */
    id: string;
    name: string;
    coverUrl?: string;
    playCount: number;
    /** 歌曲数（QQ 推荐歌单接口无该字段，缺省不显示） */
    trackCount?: number;
    creator?: string;
}

export interface DlTextResponse {
    status: number;
    text: string;
    headers?: Record<string, string | string[] | undefined>;
}

export interface DlBufferResponse {
    status: number;
    buffer: Uint8Array;
    headers?: Record<string, string | string[] | undefined>;
}

/** 传输层（真源 `services/nodeHttp`；单测注入假实现） */
export interface DlTransport {
    get: (url: string, headers?: Record<string, string>) => Promise<DlTextResponse>;
    post: (url: string, body: string, headers?: Record<string, string>) => Promise<DlTextResponse>;
    getBuffer: (url: string, headers?: Record<string, string>) => Promise<DlBufferResponse>;
}

/** 落盘目标（本仓唯一写盘出口注入；`taken` = 库内现有路径，用于重名去重） */
export interface DlWriteTarget {
    root?: string;
    taken?: ReadonlySet<string>;
    write: (relPath: string, data: Uint8Array) => Promise<void>;
}

export interface DlSearchResult {
    songs: DownloadSong[];
    /** 真正「请求/解析失败」的来源（空结果但请求成功的不算） */
    failedSources: PlaylistSource[];
}

// ────────────────────────────── 小工具 ──────────────────────────────

const okText = (r: DlTextResponse | null | undefined): string =>
    r && r.status >= 200 && r.status < 300 ? r.text : '';

const isOff = (enabled: Record<string, boolean> | undefined, k: string): boolean =>
    !!enabled && enabled[k] === false;

/** MP3 判别：ID3 头 或 MPEG 帧同步 */
function looksLikeMp3(b: Uint8Array): boolean {
    if (b.length < 2) return false;
    if (b[0] === 0x49 && b[1] === 0x44) return true; // 'ID'
    return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}
/** m4a 判别：`ftyp` box */
function looksLikeM4a(b: Uint8Array): boolean {
    return b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
}
/** flac 判别：`fLaC` 魔数（VIP 无损） */
function looksLikeFlac(b: Uint8Array): boolean {
    return b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43;
}
/** 按真实字节定扩展名（⛔ 不信 URL 后缀 / content-type） */
function extOfAudio(b: Uint8Array): 'mp3' | 'm4a' | 'flac' {
    return looksLikeFlac(b) ? 'flac' : looksLikeM4a(b) ? 'm4a' : 'mp3';
}
function formatBytes(n: number): string {
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)}MB`;
    if (n >= 1024) return `${Math.round(n / 1024)}KB`;
    return `${n}B`;
}

// ────────────────────────────── 搜索 ──────────────────────────────

function mapNeteaseSongs(out: MusicSearchOutcome): DownloadSong[] {
    return out.songs
        .filter((s) => s.id && s.name)
        .map((s) => ({
            source: 'netease' as const,
            id: s.id,
            neteaseId: Number(s.id) || undefined,
            name: s.name,
            artist: s.artists.join('/'),
            album: s.album,
            coverUrl: s.coverUrl,
            duration: s.durationSec,
            // 🔴 #405：档位由 `parseNeteaseSearch` 从搜索响应的 `l`/`m`/`h` 取（免费档）
            //    —— 缺了这两项，网易云行就没有 kbps / 体积两个胶囊（同页其它三源都有）。
            size: s.size,
            bitrate: s.bitrate,
            // 可下载性口径由 `pure/songDownload.isNeteaseDownloadable` 在解析层定（`fee` 非 0 ⇒ VIP）
            vip: !s.downloadable,
            ext: 'mp3' as const,
            webUrl: s.pageUrl || undefined,
        }));
}

function mapQqSongs(text: string): DownloadSong[] {
    return parseQqSearchResponse(text).map((s) => ({
        source: 'qq' as const,
        id: s.songmid,
        songmid: s.songmid,
        name: s.name,
        artist: s.artist,
        album: s.album,
        needsCookie: true,
        duration: s.duration,
        size: s.size,
        bitrate: s.bitrate,
        coverUrl: s.coverUrl,
        vip: s.vipOnly,
        ext: s.ext,
        webUrl: buildSongWebUrl({ source: 'qq', id: s.songmid, songmid: s.songmid }) ?? undefined,
    }));
}

function mapKugouSongs(text: string): DownloadSong[] {
    return parseKugouSearchResponse(text).map((s) => ({
        source: 'kugou' as const,
        id: s.hash,
        name: s.name,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        duration: s.duration,
        size: s.size,
        bitrate: s.bitrate,
        vip: s.privilege === 10,
        ext: 'mp3' as const,
        webUrl: buildSongWebUrl({ source: 'kugou', id: s.hash }) ?? undefined,
    }));
}

function mapKuwoSongs(text: string): DownloadSong[] {
    return parseKuwoSearchResponse(text).map((s) => ({
        source: 'kuwo' as const,
        id: s.rid,
        kuwoRid: s.rid,
        name: s.name,
        artist: s.artist,
        album: s.album,
        duration: s.duration,
        size: s.size,
        bitrate: s.bitrate,
        coverUrl: s.coverUrl,
        albumPicPath: s.albumPicPath,
        ext: s.format === 'flac' ? ('flac' as const) : s.format === 'aac' ? ('m4a' as const) : ('mp3' as const),
        webUrl: buildSongWebUrl({ source: 'kuwo', id: s.rid, kuwoRid: s.rid }) ?? undefined,
    }));
}

/**
 * 多源搜索（四平台全部免登录），合并结果。
 * 🔴 三条与正本一致的口径：
 *  ⑴ **各平台独立成败**：请求层失败才算「网络错误」，成功但空结果不算（据此区分「没有这首歌」与「网断了」）；
 *  ⑵ **渐进上报** `onPartial`：任一平台先回来就先给 UI，不等最慢的；
 *  ⑶ **VIP 只标注不屏蔽**（网易云 fee>0 / QQ payplay=1 / 酷狗 privilege=10）。
 */
/**
 * #509：网易云**按 songid 批量取封面**（`al.picUrl`）。
 *
 * 🔴 存在理由：网易云的**搜索响应不带封面**（实测 10 条 / 0 带封面）⇒ 要按网易云出封面只能补这一跳。
 * 🔴 **免 Cookie 实测可用**（2026-10-04：HTTP 200 / 5 条 5 个封面）⇒ ⛔ 别把用户没配 Cookie 当成失败。
 * ⚠️ 失败一律返回**空 Map**（封面搜索是锦上添花，⛔ 不该因为这一跳失败就让整个弹窗报错）。
 * ⚠️ 复用既有 `buildSongDetailBody` / `parseSongDetailSongs` / `encryptWeApi`，⛔ 不另写一份。
 */
export async function neteaseCoversByIds(
    t: DlTransport,
    ids: readonly (number | undefined)[],
): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const list = [...new Set((ids ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 20);
    if (!list.length) return out;
    try {
        const { params, encSecKey } = encryptWeApi(buildSongDetailBody(list.map(String)));
        const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
        const res = await t.post(NETEASE_SONG_DETAIL_API, body, {
            'User-Agent': UA,
            Referer: REFERER,
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        if (!res || res.status < 200 || res.status >= 300) return out;
        for (const s of parseSongDetailSongs(res.text)) {
            if (s.coverUrl) out.set(Number(s.id), s.coverUrl);
        }
    } catch {
        /* 取不到就当没有：封面搜索不该被这一跳拖垮 */
    }
    return out;
}

export async function dlSearch(    t: DlTransport,
    keyword: string,
    opts: {
        enabled?: Record<string, boolean>;
        onPartial?: (songs: DownloadSong[]) => void;
        onEmpty?: (networkError: boolean) => void;
        order?: string[];
    } = {},
): Promise<DlSearchResult> {
    const { enabled, onPartial, onEmpty, order } = opts;
    type One = { songs: DownloadSong[]; failed: boolean };
    const ok = (songs: DownloadSong[]): One => ({ songs, failed: false });
    const fail = (): One => ({ songs: [], failed: true });

    const tasks: Array<Promise<One>> = [
        isOff(enabled, 'netease')
            ? Promise.resolve({ songs: [], failed: false })
            : neteaseSearchSongs(t.get, keyword)
                .then((out) => (out.error ? fail() : ok(mapNeteaseSongs(out))))
                .catch(fail),
        isOff(enabled, 'qq')
            ? Promise.resolve({ songs: [], failed: false })
            : t.get(buildQqSearchUrl(keyword), { Referer: QQ_REFERER })
                .then((r) => (r && r.status >= 200 && r.status < 300 ? ok(mapQqSongs(r.text)) : fail()))
                .catch(fail),
        isOff(enabled, 'kugou')
            ? Promise.resolve({ songs: [], failed: false })
            : t.get(buildKugouSearchUrl(keyword), { 'User-Agent': KUGOU_MOBILE_UA, Referer: KUGOU_MOBILE_REFERER })
                .then((r) => (r && r.status >= 200 && r.status < 300 ? ok(mapKugouSongs(r.text)) : fail()))
                .catch(fail),
        isOff(enabled, 'kuwo')
            ? Promise.resolve({ songs: [], failed: false })
            : t.get(buildKuwoSearchUrl(keyword), { Referer: KUWO_REFERER })
                .then((r) => (r && r.status >= 200 && r.status < 300 ? ok(mapKuwoSongs(r.text)) : fail()))
                .catch(fail),
    ];
    for (const task of tasks) {
        void task.then((r) => {
            if (r.songs.length > 0) onPartial?.(r.songs);
        });
    }
    const all = await Promise.all(tasks);
    const out = all.flatMap((r) => r.songs);
    const failedSources = DL_PLATFORMS.filter((k, i) => !isOff(enabled, k) && all[i].failed);
    if (out.length === 0 && onEmpty) {
        const enabledCount = DL_PLATFORMS.filter((k) => !isOff(enabled, k)).length;
        onEmpty(enabledCount > 0 && failedSources.length === enabledCount);
    }
    // 排序：平台优先级（设置页顺序）为主键 → 同平台内按相似度 → 标题短 → 字典序
    const rank = new Map<string, number>();
    if (order) order.forEach((src, i) => rank.set(src, i));
    out.sort((a, b) => {
        const ra = rank.has(a.source) ? rank.get(a.source)! : (order?.length ?? 0);
        const rb = rank.has(b.source) ? rank.get(b.source)! : (order?.length ?? 0);
        if (ra !== rb) return ra - rb;
        const sa = songSimilarityScore(keyword, a.name, a.artist);
        const sb = songSimilarityScore(keyword, b.name, b.artist);
        if (sb !== sa) return sb - sa;
        if (a.name.length !== b.name.length) return a.name.length - b.name.length;
        return a.name.localeCompare(b.name);
    });
    return { songs: out, failedSources };
}

// ────────────────────────────── 推荐歌单 ──────────────────────────────

/** 拉取推荐歌单（四平台全免登录）；未知源 / 失败返回 `{ playlists: [], error? }` */
export async function dlRecommendedPlaylists(
    t: DlTransport,
    source: PlaylistSource,
    limit = 30,
): Promise<{ playlists: RecommendedPlaylist[]; error?: string }> {
    try {
        if (source === 'netease') {
            // 复用本仓既有实现（公开 `/api/` 端点，免密）
            const out = await neteaseRecommendedPlaylists(t.get, Math.min(limit, 150));
            return {
                playlists: out.playlists.map((p) => ({
                    source: 'netease' as const,
                    id: p.id,
                    name: p.name,
                    coverUrl: p.coverUrl,
                    playCount: p.playCount ?? 0,
                    trackCount: p.trackCount,
                })),
                error: out.error,
            };
        }
        if (source === 'qq') {
            const list = parseQqDissList(okText(await t.get(buildQqDissListUrl(0, Math.max(0, limit - 1)), { Referer: QQ_REFERER })));
            const out: RecommendedPlaylist[] = list.map((p) => ({ source: 'qq' as const, ...p }));
            // 批量补歌曲数：musicu.fcg 单请求 req 数有硬上限（实测 >30 全被拒）⇒ 每批 30，某批失败不影响其他批
            if (out.length > 0) {
                const ids = out.map((p) => p.id);
                const counts: Record<string, number> = {};
                const BATCH = 30;
                for (let i = 0; i < ids.length; i += BATCH) {
                    const chunk = ids.slice(i, i + BATCH);
                    const res = await t.post(QQ_MUSICU_URL, buildQqDissCountsBody(chunk), {
                        'Content-Type': 'application/json',
                        Origin: 'https://y.qq.com',
                        Referer: 'https://y.qq.com/n/yqq/playsquare/',
                    });
                    Object.assign(counts, parseQqDissCounts(okText(res), chunk));
                }
                if (Object.keys(counts).length > 0) {
                    for (const p of out) {
                        const n = counts[p.id];
                        if (typeof n === 'number') p.trackCount = n;
                    }
                }
            }
            return { playlists: out };
        }
        if (source === 'kugou') {
            const text = okText(
                await t.get(buildKugouSpecialListUrl(1, limit), {
                    'User-Agent': KUGOU_MOBILE_UA,
                    Referer: KUGOU_MOBILE_REFERER,
                }),
            );
            return { playlists: parseKugouSpecialList(text).map((p) => ({ source: 'kugou' as const, ...p })) };
        }
        if (source === 'kuwo') {
            const text = okText(await t.get(buildKuwoRcmPlaylistUrl(1, limit), { Referer: KUWO_REFERER }));
            return { playlists: parseKuwoRcmPlaylist(text).map((p) => ({ source: 'kuwo' as const, ...p })) };
        }
        return { playlists: [], error: `未知平台：${source}` };
    } catch (e) {
        return { playlists: [], error: e instanceof Error ? e.message : String(e) };
    }
}

// ────────────────────────────── 歌单曲目 ──────────────────────────────

/** 拉取某平台某歌单的全部曲目（四平台全免登录），映射为统一 `DownloadSong` */
export async function dlPlaylistSongs(
    t: DlTransport,
    source: PlaylistSource,
    playlistId: string,
): Promise<{ songs: DownloadSong[]; error?: string }> {
    try {
        if (source === 'netease') {
            const out = await neteasePlaylistDetail(t.get, playlistId);
            if (!out.detail) return { songs: [], error: out.error };
            return {
                songs: out.detail.songs.map((s) => ({
                    source: 'netease' as const,
                    id: s.id,
                    neteaseId: Number(s.id) || undefined,
                    name: s.name,
                    artist: s.artists.join('/'),
                    album: s.album,
                    coverUrl: s.coverUrl,
                    duration: s.durationSec,
                    vip: !s.downloadable,
                    ext: 'mp3' as const,
                    webUrl: s.pageUrl || undefined,
                })),
            };
        }
        if (source === 'qq') {
            // 优先官方歌单接口；部分用户歌单返回空 cdlist ⇒ 回退 musicu.fcg uniform_get_Dissinfo
            let songs = parseQqDissDetail(okText(await t.get(buildQqDissDetailUrl(playlistId), { Referer: QQ_REFERER })));
            if (songs.length === 0) {
                const v2 = await t.post(QQ_MUSICU_URL, buildQqDissDetailV2Body(playlistId), {
                    'Content-Type': 'application/json',
                    Origin: 'https://y.qq.com',
                    Referer: `https://y.qq.com/n/yqq/playsquare/${playlistId}.html`,
                });
                songs = parseQqDissDetailV2(okText(v2));
            }
            return {
                songs: songs.map((s) => ({
                    source: 'qq' as const,
                    id: s.songmid,
                    songmid: s.songmid,
                    name: s.name,
                    artist: s.artist,
                    album: s.album,
                    coverUrl: s.coverUrl,
                    duration: s.duration,
                    size: s.size,
                    bitrate: s.bitrate,
                    needsCookie: true,
                    vip: s.vipOnly,
                    ext: s.ext,
                    webUrl: buildSongWebUrl({ source: 'qq', id: s.songmid, songmid: s.songmid }) ?? undefined,
                })),
            };
        }
        if (source === 'kugou') {
            const text = okText(
                await t.get(buildKugouSpecialDetailUrl(playlistId, 1, 100), {
                    'User-Agent': KUGOU_MOBILE_UA,
                    Referer: KUGOU_MOBILE_REFERER,
                }),
            );
            return {
                songs: parseKugouSpecialDetail(text).map((s) => ({
                    source: 'kugou' as const,
                    id: s.hash,
                    name: s.name,
                    artist: s.artist,
                    duration: s.duration,
                    size: s.size,
                    bitrate: s.bitrate,
                    vip: s.privilege === 10,
                    ext: 'mp3' as const,
                    webUrl: buildSongWebUrl({ source: 'kugou', id: s.hash }) ?? undefined,
                })),
            };
        }
        if (source === 'kuwo') {
            const text = okText(await t.get(buildKuwoPlaylistDetailUrl(playlistId), { Referer: KUWO_REFERER }));
            return {
                songs: parseKuwoPlaylistDetail(text).map((s) => ({
                    source: 'kuwo' as const,
                    id: s.rid,
                    kuwoRid: s.rid,
                    name: s.name,
                    artist: s.artist,
                    album: s.album,
                    coverUrl: s.coverUrl,
                    duration: s.duration,
                    size: s.size,
                    bitrate: s.bitrate,
                    ext: s.format === 'flac' ? ('flac' as const) : s.format === 'aac' ? ('m4a' as const) : ('mp3' as const),
                    webUrl: buildSongWebUrl({ source: 'kuwo', id: s.rid, kuwoRid: s.rid }) ?? undefined,
                })),
            };
        }
        return { songs: [], error: `未知平台：${source}` };
    } catch (e) {
        return { songs: [], error: e instanceof Error ? e.message : String(e) };
    }
}

// ────────────────────────────── 平台连通性 ──────────────────────────────

/** 「测试连接」：按平台校验 Cookie（正本同款文案，四态：未填 / 无效 / 有效 / 会员） */
export async function dlTestConnection(
    t: DlTransport,
    source: PlaylistSource | string,
    cookie: string,
): Promise<{ ok: boolean; message: string }> {
    const c = (cookie ?? '').trim();
    try {
        if (source === 'netease') {
            if (!c) return { ok: false, message: '未粘贴网易云 Cookie' };
            const { params, encSecKey } = encryptWeApi(JSON.stringify({ csrf_token: '' }));
            const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
            const res = await t.post(NETEASE_ACCOUNT_API, body, { Cookie: c });
            if (!res || res.status < 200 || res.status >= 300) return { ok: false, message: '请求失败（网络或接口变更）' };
            const info = parseVipAccountResponse(res.text);
            if (!info.ok) return { ok: false, message: '网易云 Cookie 无效或已过期，请重新登录复制' };
            return { ok: true, message: info.vipType !== 0 ? '网易云 Cookie 有效（会员）' : '网易云 Cookie 有效（普通账号）' };
        }
        if (source === 'qq') {
            if (!c) return { ok: false, message: '未粘贴 QQ Cookie' };
            const res = await t.get(buildQqUserInfoUrl(extractQqUin(c)), { Referer: QQ_REFERER, Cookie: c });
            if (!res || res.status < 200 || res.status >= 300) return { ok: false, message: '请求失败（网络或接口变更）' };
            const info = parseQqUserInfo(res.text);
            return info.ok
                ? { ok: true, message: 'QQ Cookie 有效' }
                : { ok: false, message: `QQ Cookie 无效或已过期（code=${info.code}），请重新登录复制` };
        }
        if (source === 'kugou') {
            if (!c) return { ok: false, message: '未粘贴酷狗 Cookie' };
            const res = await t.get(KUGOU_VIP_ROLEINFO_URL, {
                'User-Agent': UA,
                Accept: '*/*',
                Cookie: c,
            });
            if (!res || res.status < 200 || res.status >= 300) return { ok: false, message: '请求失败（网络或接口变更）' };
            const info = parseKugouRoleinfo(res.text);
            return info.ok
                ? { ok: true, message: '酷狗 Cookie 有效' }
                : { ok: false, message: `酷狗 Cookie 无效或已过期（errno=${info.errno}），请重新登录复制` };
        }
        if (source === 'kuwo') return { ok: true, message: '酷我免登录即可下载，Cookie 非必需' };
        return { ok: false, message: `未知平台：${source}` };
    } catch (e) {
        return { ok: false, message: `请求失败：${e instanceof Error ? e.message : String(e)}` };
    }
}

// ────────────────────────────── 下载 ──────────────────────────────

export interface DlDownloadResult {
    ok: boolean;
    message: string;
    /** 成功时的库内相对路径（供表单回填「本地音频」） */
    relPath?: string;
}

interface DlDownloadOpts {
    /** 各平台 Cookie（缺省 = 全免登录链路） */
    cookies?: Record<string, string>;
    /** 落盘目标 */
    target: DlWriteTarget;
}

/** 网易云播放地址响应：`data[0].url` 空串 / `code≠200` ⇒ 无权限 */
function parseNeteasePlayUrl(raw: string): string {
    try {
        const data = JSON.parse(raw);
        if (Number(data?.code ?? 0) !== 200) return '';
        const url: string = data?.data?.[0]?.url ?? '';
        return /^https?:\/\//i.test(url) ? url : '';
    } catch {
        return '';
    }
}

/** 取音频字节（带 Referer/Cookie）；低于门槛一律当失败（挡「302 到 /404 的 HTML 页」） */
async function fetchAudio(
    t: DlTransport,
    url: string,
    headers?: Record<string, string>,
): Promise<Uint8Array | null> {
    const res = await t.getBuffer(url, headers);
    if (!res || res.status < 200 || res.status >= 300) return null;
    const bytes = res.buffer instanceof Uint8Array ? res.buffer : new Uint8Array(res.buffer as ArrayBuffer);
    if (bytes.byteLength < MIN_AUDIO_BYTES) return null;
    return bytes;
}

/**
 * 网易云 VIP 链路：weapi 校验会员 → eapi（lossless→hires→exhigh）→ weapi 320k 逐级降级。
 * 返回音频字节；无 Cookie / 非会员 / 接口失败一律返回 `null`（调用方回退免密外链）。
 */
async function neteaseVipBytes(t: DlTransport, songId: number, cookie: string): Promise<Uint8Array | null> {
    const { params, encSecKey } = encryptWeApi(JSON.stringify({ csrf_token: '' }));
    const accountBody = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
    const account = await t.post(NETEASE_ACCOUNT_API, accountBody, { Cookie: cookie });
    if (!account || account.status < 200 || account.status >= 300) return null;
    const vip = parseVipAccountResponse(account.text);
    if (!vip.ok || vip.vipType === 0) return null;

    const eapiPayload = (level: string) =>
        JSON.stringify({
            ids: [songId],
            level,
            encodeType: 'flac',
            header: JSON.stringify({
                os: 'pc',
                appver: '',
                osver: '',
                deviceId: 'pyncm!',
                requestId: String(Date.now()),
            }),
        });
    for (const level of ['lossless', 'hires', 'exhigh']) {
        const eapiParams = encryptEApi('/eapi/song/enhance/player/url/v1', eapiPayload(level));
        const res = await t.post(NETEASE_EAPI_URL, `params=${encodeURIComponent(eapiParams)}`, { Cookie: cookie });
        if (!res || res.status < 200 || res.status >= 300) continue;
        const url = parseNeteasePlayUrl(res.text);
        if (!url) continue;
        const audio = await fetchAudio(t, url, { Referer: REFERER, Cookie: cookie });
        if (audio) return audio;
    }
    const weapi = encryptWeApi(JSON.stringify({ ids: [String(songId)], br: 320000 }));
    const weapiBody = `params=${encodeURIComponent(weapi.params)}&encSecKey=${encodeURIComponent(weapi.encSecKey)}`;
    const weapiRes = await t.post(NETEASE_WEAPI_URL, weapiBody, { Cookie: cookie });
    if (!weapiRes || weapiRes.status < 200 || weapiRes.status >= 300) return null;
    const url = parseNeteasePlayUrl(weapiRes.text);
    if (!url) return null;
    return fetchAudio(t, url, { Referer: REFERER, Cookie: cookie });
}

/** 落盘：文件名走 `pure/dl/utils.buildSongFilename`，路径（净化 / 去重 / **音频文件目录**）走 `pure/downloadPlan` */
async function writeAudio(
    target: DlWriteTarget,
    song: DownloadSong,
    bytes: Uint8Array,
    ext: string,
): Promise<string> {
    const relPath = downloadRelPath({
        kind: 'music',
        filename: buildSongFilename(song.artist, song.name, ext),
        // #459：`root` 就是**音频文件目录本身**（缺省 `下载/音乐` 由 `downloadDir` 兜），⛔ 这里别再拼子目录
        root: target.root,
        taken: target.taken,
    });
    await target.write(relPath, bytes);
    return relPath;
}

/** 取到的一条音频字节 + 它来自哪条链路（成功文案里拼出来，便于用户判断「拿到的到底是什么档」） */
interface ResolvedAudio {
    bytes: Uint8Array;
    /** 平台显示名 */
    label: string;
    /** 链路 / 音质备注（**不带括号**，如 `VIP 高音质` / `128k`；没有就空串） */
    note: string;
}

/**
 * 取某曲目的音频字节（按来源分发，**不写盘**）；失败给一句面向用户的原因。
 *
 * 🔴 下载与**试听**共用这一处链路顺序（含「有 Cookie 走 VIP → 否则免密回退」的降级）
 *    —— ⛔ 别在别处再写一份，否则迟早出现「能试听不能下载」（或反之）这种鬼故事。
 * `verb` 只影响阶段文案（`正在下载…` / `正在试听…`）。
 */
async function resolveAudio(
    t: DlTransport,
    song: DownloadSong,
    cookies: Record<string, string> | undefined,
    onProgress: DownloadProgressCallback | undefined,
    verb: string,
): Promise<ResolvedAudio | { error: string }> {
    // ── 网易云：有 Cookie 先走 VIP 链路，失败 / 非会员回退免密外链（128k）──
    if (song.source === 'netease') {
        const id = song.neteaseId ?? (Number(song.id) || 0);
        if (!id) return { error: '缺少网易云歌曲 id' };
        const cookie = (cookies?.netease ?? '').trim();
        let bytes: Uint8Array | null = null;
        let note = '';
        if (cookie) {
            onProgress?.(null, '正在校验会员身份…');
            bytes = await neteaseVipBytes(t, id, cookie);
            if (bytes) note = 'VIP 高音质';
        }
        if (!bytes) {
            onProgress?.(null, `正在${verb}网易云音频…`);
            bytes = await fetchAudio(t, neteaseOuterUrl(id), { Referer: REFERER });
        }
        if (!bytes) return { error: `${verb}失败（可能 VIP 受限、区域限制或接口变更）` };
        return { bytes, label: '网易云', note };
    }

    // ── QQ：vkey 取直链（**必需 Cookie**）──
    if (song.source === 'qq') {
        const cookie = (cookies?.qq ?? '').trim();
        if (!cookie) {
            return { error: `QQ 需先在 设置 → 元数据源配置 › 音乐源凭据 粘贴登录 Cookie` };
        }
        const mid = song.songmid ?? song.id;
        if (!mid) return { error: '缺少 QQ 歌曲 songmid' };
        onProgress?.(null, '正在获取 QQ 播放地址…');
        const vkeyUrl = buildQqVkeyUrl(buildQqVkeyBody(mid, makeGuid(), extractQqUin(cookie)));
        const res = await t.get(vkeyUrl, { Referer: QQ_REFERER, Cookie: cookie });
        const purl = res && res.status >= 200 && res.status < 300 ? parseQqPurl(res.text) : '';
        if (!purl) return { error: 'QQ Cookie 无效或已过期，请到 y.qq.com 重新登录复制' };
        const audioUrl = /^https?:\/\//i.test(purl) ? purl : `https://dl.stream.qqmusic.qq.com/${purl}`;
        onProgress?.(null, `正在${verb}QQ 音频…`);
        const bytes = await fetchAudio(t, audioUrl, { Referer: QQ_REFERER, Cookie: cookie });
        if (!bytes) return { error: `${verb}失败（可能付费受限或 Cookie 权限不足）` };
        return { bytes, label: 'QQ', note: '' };
    }

    // ── 酷狗：getSongInfo.php 优先，trackercdn v2（带 MD5 签名）兜底；VIP 曲目直接拒绝 ──
    if (song.source === 'kugou') {
        if (song.vip) return { error: '该酷狗歌曲为 VIP 付费曲目，无法免费获取' };
        const hash = song.id || '';
        if (!hash) return { error: '缺少酷狗歌曲 hash' };
        onProgress?.(null, '正在获取酷狗播放地址…');
        let url = '';
        const infoRes = await t.get(buildKugouSongInfoUrl(hash), {
            'User-Agent': KUGOU_MOBILE_UA,
            Referer: KUGOU_MOBILE_REFERER,
        });
        if (infoRes && infoRes.status >= 200 && infoRes.status < 300) {
            url = parseKugouSongInfoResponse(infoRes.text).url;
        }
        if (!url) {
            const trRes = await t.get(buildKugouTrackercdnUrl(hash), { 'User-Agent': UA, Referer: KUGOU_PC_REFERER });
            if (trRes && trRes.status >= 200 && trRes.status < 300) url = parseKugouTrackercdnResponse(trRes.text).url;
        }
        if (!url) return { error: '获取酷狗播放地址失败（可能 VIP 受限或接口变更）' };
        onProgress?.(null, `正在${verb}酷狗音频…`);
        const bytes = await fetchAudio(t, url, { 'User-Agent': UA, Referer: KUGOU_PC_REFERER });
        if (!bytes) return { error: `${verb}失败（可能受限或接口变更）` };
        return { bytes, label: '酷狗', note: '' };
    }

    // ── 酷我：mobi 车载通道 128→320→flac 逐级降级取首个可用直链（免登录）──
    if (song.source === 'kuwo') {
        const rid = song.kuwoRid ?? song.id ?? '';
        if (!rid) return { error: '缺少酷我歌曲 rid' };
        onProgress?.(null, '正在获取酷我播放地址…');
        let audioUrl = '';
        let quality = '';
        for (const br of KUWO_QUALITIES) {
            const res = await t.get(buildKuwoMobiUrl(rid, br, makeKuwoUser()), { 'User-Agent': KUWO_UA });
            if (!res || res.status < 200 || res.status >= 300) continue;
            const info = parseKuwoMobiResponse(res.text);
            if (info.url) {
                audioUrl = info.url;
                quality = br;
                break;
            }
        }
        if (!audioUrl) return { error: '获取酷我播放地址失败（可能版权受限）' };
        onProgress?.(null, `正在${verb}酷我音频…`);
        const bytes = await fetchAudio(t, audioUrl, { 'User-Agent': KUWO_UA });
        if (!bytes) return { error: `${verb}失败（可能版权受限）` };
        return { bytes, label: '酷我', note: quality };
    }

    return { error: `不支持的来源：${song.source}` };
}

/**
 * 下载一首歌（按来源分发；失败自动重试一次 —— 网络抖动友好，且本仓写盘是「先写后返回」无副作用）。
 * 🔴 不内嵌任何标签（用户 2026-09-28 明确不做）。
 */
export async function dlDownloadSong(
    t: DlTransport,
    song: DownloadSong,
    opts: DlDownloadOpts,
    onProgress?: DownloadProgressCallback,
): Promise<DlDownloadResult> {
    const once = async (): Promise<DlDownloadResult> => {
        const r = await resolveAudio(t, song, opts.cookies, onProgress, '下载');
        if ('error' in r) return { ok: false, message: r.error };
        const ext = extOfAudio(r.bytes);
        onProgress?.(null, '正在写入…');
        const relPath = await writeAudio(opts.target, song, r.bytes, ext);
        const detail = [r.label, r.note, ext].filter(Boolean).join(' · ');
        return {
            ok: true,
            message: `已下载 ${formatBytes(r.bytes.byteLength)}：${relPath}（${detail}）`,
            relPath,
        };
    };
    const first = await once();
    if (first.ok) return first;
    onProgress?.(null, '重试中…');
    return once();
}

// ────────────────────────────── 试听（2026-09-28 #400）──────────────────────────────

export interface DlPreviewResult {
    ok: boolean;
    /** 失败原因，或「已从缓存播放」这类提示（成功且非缓存时为空串） */
    message: string;
    /** 音频字节（**不写盘**，由 UI 转 Blob 播放） */
    data?: Uint8Array;
    /** 标准档扩展名（按魔数判断，⛔ 不信 CDN 的 content-type） */
    ext?: 'mp3' | 'm4a' | 'flac';
    /** 本次是否命中会话缓存（true = 没重新拉取） */
    fromCache?: boolean;
}

/**
 * 试听缓存（**仅本会话有效**，模块级 Map，Obsidian 重启即清空）。
 *
 * 🔴 用户 2026-09-28 明确：「仅本会话有效不做设置页试听缓存删除」
 *    ⇒ ⛔ **不要**为它加设置项 / 「释放缓存」按钮 / 磁盘缓存。这里刻意只留一个进程内 Map。
 *    缓存键 = `{source}:{id}`（同一平台同一首歌，搜出来几次都是同一份字节）。
 */
const previewCache = new Map<string, { data: Uint8Array; ext: 'mp3' | 'm4a' | 'flac' }>();

/** 当前试听缓存条目数（只给单测 / 诊断用，⛔ 别接到设置页上） */
export function dlPreviewCacheSize(): number {
    return previewCache.size;
}

/**
 * 试听：按来源取**标准档**音频字节（不写盘、不返回路径），供弹窗「试听」按钮转 Blob 播放。
 * 链路与下载完全一致（见 `resolveAudio`），只是不落盘；命中会话缓存直接返回，不重新拉取。
 */
export async function dlPreviewAudio(
    t: DlTransport,
    song: DownloadSong,
    opts: { cookies?: Record<string, string> },
    onProgress?: DownloadProgressCallback,
): Promise<DlPreviewResult> {
    const key = `${song.source}:${song.id}`;
    const hit = previewCache.get(key);
    if (hit) return { ok: true, message: '已从缓存播放', data: hit.data, ext: hit.ext, fromCache: true };
    const r = await resolveAudio(t, song, opts.cookies, onProgress, '试听');
    if ('error' in r) return { ok: false, message: r.error };
    const ext = extOfAudio(r.bytes);
    previewCache.set(key, { data: r.bytes, ext });
    return { ok: true, message: '', data: r.bytes, ext };
}
