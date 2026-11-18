/**
 * 「我的清单」服务层（第 15 轮阶段 C）—— 拉用户自己的歌单与「我喜欢」，映射成统一 `DownloadSong`。
 *
 * ## 分工（与本仓既有口径一致）
 * - 拼 URL / 请求体 / 解析 ⇒ `pure/dl/*`（可单测，本文件⛔ 不写正则与字段映射）
 * - 发请求 ⇒ 本文件，HTTP 走注入的 `DlTransport`
 * - 候选与去重 ⇒ `pure/musicPlaylist`
 *
 * ## 🔴 三条已裁定的口径（用户 2026-11-09）
 * ⑴ **歌单只落单曲**：不建「歌单条目」，歌单名写进条目标签（`pure/musicPlaylist.playlistTag`）。
 * ⑵ **Cookie 过期就停**：明确报错 + 提示重贴，⛔ 不静默重试、⛔ 不降级成匿名拉公开数据。
 * ⑶ **每家独立降级**：一家接口变了不该连累另外两家 ⇒ 每个平台各自 try/catch，
 *    结果里带 `platform` 与 `reason`，由 `pure/musicPlaylist.musicSyncPartialMessage` 拼文案。
 *
 * ## ⚠️ 酷狗为什么没有实现
 * 酷狗「我的歌单」走的是 `cloudlist.service.kugou.com/v7/get_all_list`，
 * 需要 **android 网关签名**（参数按 key 排序拼串 + 盐值 MD5 + `x-router` 头 + `appid`/`clientver`）。
 * 本仓现有酷狗链路（搜索 / 公开歌单 / 下载）全是**明文接口**，没有这套签名器；
 * 硬写一个未经真机验证的签名器比「明确不支持」更容易让用户以为能同步却拿不到数据。
 * ⇒ 按裁定⑶ 独立降级：返回一条明确原因，其余两家照常。⛔ 别在这里猜签名算法。
 */
import type { DlTransport } from 'services/dl';
import type { DownloadSong } from 'services/dl';
import {
    buildSongWebUrl,
} from 'pure/dl/utils';
import {
    buildUserPlaylistBody,
    encryptWeApi,
    parseUserPlaylists,
    parseVipAccountResponse,
} from 'pure/dl/neteaseCrypto';
import {
    buildQqDissDetailUrl,
    buildQqFavoritesUrl,
    buildQqOwnedPlaylistsUrl,
    extractQqUin,
    parseQqDissDetail,
    parseQqFavorites,
    parseQqOwnedPlaylists,
    QQ_LIKED_DIRID,
} from 'pure/dl/qq';
import type { MusicSyncPlaylist } from 'pure/musicPlaylist';
import { neteasePlaylistDetailUrl, parseNeteasePlaylistDetail } from 'pure/musicDownload';

/** 网易云账号接口（取 uid；与 `dlTestConnection` 同一个端点） */
const NETEASE_ACCOUNT_API = 'https://music.163.com/weapi/nuser/account/get';
/** 网易云「用户歌单列表」 */
const NETEASE_USER_PLAYLIST_API = 'https://music.163.com/weapi/user/playlist';
const QQ_REFERER = 'https://y.qq.com/';

/** 单个平台的拉取结果：失败原因与「成功但 0 条」必须能分辨 */
export interface MyListOutcome<T> {
    items: T[];
    /** 该平台整体失败的原因（Cookie 过期 / 接口变更 / 不支持的平台） */
    reason?: string;
    /** `true` = 登录态失效（调用方要提示重贴 Cookie，而不是「没有歌单」） */
    expired?: boolean;
}

const okText = (r: { status: number; text: string } | null | undefined): string =>
    r && r.status >= 200 && r.status < 300 ? r.text : '';

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * 网易云：取当前登录用户的 uid。
 * 🔴 uid 只能从 `weapi/nuser/account/get` 的 `profile.userId` 拿（见 `parseVipAccountResponse`），
 * ⛔ 不从 Cookie 猜、也不让用户手填。
 */
async function neteaseUid(t: DlTransport, cookie: string): Promise<{ uid: string; expired: boolean }> {
    const { params, encSecKey } = encryptWeApi(JSON.stringify({ csrf_token: '' }));
    const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
    const res = await t.post(NETEASE_ACCOUNT_API, body, { Cookie: cookie });
    const info = parseVipAccountResponse(okText(res));
    return { uid: info.userId, expired: !info.ok };
}

/**
 * 网易云：我的歌单（含「我喜欢的音乐」，由 `specialType === 5` 标出）。
 *
 * ⚠️ 这里**故意返回「我喜欢」这个歌单本身**，而不是单独拉一份喜欢列表：
 * 它本身就是用户歌单列表里的一项（`specialType=5`），详情可以走本仓已在线上跑着的
 * `/api/playlist/detail`（`services/musicDownload.fetchPlaylistDetail`），
 * 不必引入 `song/like/get` 那条未验证链路。
 */
export async function neteaseMyPlaylists(t: DlTransport, cookie: string): Promise<MyListOutcome<MusicSyncPlaylist>> {
    const c = (cookie ?? '').trim();
    if (!c) return { items: [], reason: '未粘贴网易云 Cookie' };
    try {
        const { uid, expired } = await neteaseUid(t, c);
        if (expired) return { items: [], reason: '网易云 Cookie 无效或已过期，请重新登录复制', expired: true };
        if (!uid) return { items: [], reason: '拿不到网易云账号 uid（账号接口返回里没有 profile.userId）' };
        const { params, encSecKey } = encryptWeApi(buildUserPlaylistBody(uid, 1000, 0));
        const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
        const res = await t.post(NETEASE_USER_PLAYLIST_API, body, { Cookie: c, Referer: 'https://music.163.com/' });
        const parsed = parseUserPlaylists(okText(res));
        if (parsed.code !== 200) {
            return {
                items: [],
                reason: `网易云歌单接口返回 code=${parsed.code}，Cookie 可能已过期`,
                expired: parsed.code === 301 || parsed.code === 401,
            };
        }
        const items: MusicSyncPlaylist[] = parsed.playlists.map((p) => {
            const out: MusicSyncPlaylist = { id: p.id, name: p.name };
            if (p.coverUrl) out.cover = p.coverUrl;
            if (p.trackCount !== undefined) out.trackCount = p.trackCount;
            if (p.liked) out.liked = true;
            return out;
        });
        return { items };
    } catch (e) {
        return { items: [], reason: errText(e) };
    }
}

/**
 * 网易云：某歌单（含「我喜欢」）的全部曲目。
 *
 * 🔴 为什么不复用 `services/musicDownload.fetchPlaylistDetail`：那个函数把请求头写死成
 * `LYRIC_SOURCE_HEADERS.netease`（**不带 Cookie**），只够读公开歌单。
 * 「我喜欢的音乐」是私有歌单，必须带用户 Cookie 才有 `tracks`。
 * ⇒ 这里用同一批纯函数（`neteasePlaylistDetailUrl` + `parseNeteasePlaylistDetail`）自己发一次，
 * 解析口径与那条公开链路**完全一致**，⛔ 别在这里另写字段映射。
 */
export async function neteasePlaylistTracks(
    t: DlTransport,
    playlistId: string,
    cookie: string,
): Promise<MyListOutcome<DownloadSong>> {
    const pid = String(playlistId ?? '').trim();
    if (!pid) return { items: [] };
    const c = (cookie ?? '').trim();
    try {
        const res = await t.get(neteasePlaylistDetailUrl(pid), {
            ...(c ? { Cookie: c } : {}),
            Referer: 'https://music.163.com/',
        });
        const text = okText(res);
        if (!text) return { items: [], reason: `HTTP ${res?.status ?? '?'}` };
        const detail = parseNeteasePlaylistDetail(text);
        if (!detail) return { items: [], reason: '响应结构不符（接口可能已变更，或该歌单需要登录才能读）' };
        return {
            items: detail.songs.map((s) => ({
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
    } catch (e) {
        return { items: [], reason: errText(e) };
    }
}

/**
 * QQ：我的自建歌单 + 「我喜欢」（`dirid=201`）。
 * 🔴 端点选型见 `pure/dl/qq.buildQqOwnedPlaylistsUrl` 的注释（`fcg_user_created_diss` 统一用 `dirid`，
 * 避开 `/user/detail` 里 `id` 与 `dissid` 两套字段名混排的坑）。
 */
export async function qqMyPlaylists(t: DlTransport, cookie: string): Promise<MyListOutcome<MusicSyncPlaylist>> {
    const c = (cookie ?? '').trim();
    if (!c) return { items: [], reason: '未粘贴 QQ Cookie' };
    const uin = extractQqUin(c);
    if (!uin) return { items: [], reason: 'QQ Cookie 里没有 uin，请重新复制完整 Cookie' };
    try {
        const res = await t.get(buildQqOwnedPlaylistsUrl(uin), { Referer: QQ_REFERER, Cookie: c });
        const parsed = parseQqOwnedPlaylists(okText(res));
        // code 1000 = 没登录/Cookie 过期；4000 = 主页不公开歌单（不是登录问题，⛔ 别喊重新登录）
        if (parsed.code === 1000) {
            return { items: [], reason: 'QQ Cookie 无效或已过期，请重新登录复制', expired: true };
        }
        if (parsed.code === 4000) {
            return { items: [], reason: 'QQ 该账号未公开歌单（在网页版设为公开后重试）' };
        }
        if (parsed.code !== 0) {
            return { items: [], reason: `QQ 歌单接口返回 code=${parsed.code}` };
        }
        const items: MusicSyncPlaylist[] = parsed.playlists.map((p) => {
            const out: MusicSyncPlaylist = { id: p.id, name: p.name };
            if (p.coverUrl) out.cover = p.coverUrl;
            if (p.trackCount !== undefined) out.trackCount = p.trackCount;
            if (p.liked) out.liked = true;
            return out;
        });
        return { items };
    } catch (e) {
        return { items: [], reason: errText(e) };
    }
}

/**
 * QQ：某歌单的曲目。
 *
 * ⚠️ 「我喜欢」（`dirid=201`）比自建歌单多一跳：`fcg_musiclist_getmyfav` 只给 songmid 表，
 * 详情接口 `fcg_ucc_getcdinfo_byids_cp` 对 201 未必返回全量。所以这一跳**不是多余的**——
 * 它用来把三种状态分开（用户 2026-11-09 裁定⑵「明确报错」要求别把其中任意两种混成一句）：
 *   ⑴ 收藏表读不到 ⇒ 登录态失效（重贴 Cookie）
 *   ⑵ 收藏表为空   ⇒ 用户真的没有喜欢的歌（不是错误）
 *   ⑶ 收藏表有 N 首但详情空 ⇒ 接口不给（如实说明，⛔ 不假装「你没有喜欢的歌」）
 */
export async function qqPlaylistTracks(
    t: DlTransport,
    playlistId: string,
    cookie: string,
): Promise<MyListOutcome<DownloadSong>> {
    const c = (cookie ?? '').trim();
    const liked = playlistId === QQ_LIKED_DIRID;
    try {
        let favCount = 0;
        if (liked) {
            const favRes = await t.get(buildQqFavoritesUrl(QQ_LIKED_DIRID), { Referer: QQ_REFERER, Cookie: c });
            const fav = parseQqFavorites(okText(favRes));
            if (fav.code === 1000) {
                return { items: [], reason: 'QQ Cookie 无效或已过期，请重新登录复制', expired: true };
            }
            favCount = fav.songmids.length;
            if (fav.code === 0 && favCount === 0) return { items: [] };
        }
        const songs = parseQqDissDetail(okText(await t.get(buildQqDissDetailUrl(playlistId), { Referer: QQ_REFERER })));
        if (songs.length === 0) {
            return {
                items: [],
                reason: liked
                    ? `读到 ${favCount} 首「我喜欢」的 mid，但详情接口没有返回曲目信息（QQ 该路数据需私有接口补全）`
                    : '歌单详情为空（可能是私密歌单或接口已变更）',
            };
        }
        return {
            items: songs.map((s) => ({
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
    } catch (e) {
        return { items: [], reason: errText(e) };
    }
}

/** 酷狗明确不支持（原因见文件头） */
export const KUGOU_SYNC_UNSUPPORTED =
    '酷狗暂不支持同步清单：它的「我的歌单」走 android 网关签名接口，本插件还没有这套签名器';
