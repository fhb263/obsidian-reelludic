/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/qqMusic.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 * 纯逻辑（搜索 URL / vkey 请求体 / 歌词与歌单解析），**零 obsidian 依赖** ⇒ 直接单测。
 * ⛔ 别把网络调用塞进来 —— HTTP 只在 `services/dl/` 里做（本仓分层：pure 只算不发）。
 */
import { qqSearchUrl } from 'pure/lyricOnline'
import { normalizePublishDate } from 'pure/dl/utils';
/**
 * QQ 音乐接入（v1.4.1 多平台 Cookie 方案）。
 * 搜索免登录（client_search_cp）；下载需登录 Cookie（musicu.fcg vkey）。
 * 纯逻辑（URL/请求体构造、响应解析）抽出以便单测。
 */

export interface QqSong {
    songmid: string
    name: string
    artist: string
    album?: string
    /** 下载是否需付费/VIP（pay.dowload）：1 或 100=仅 VIP/付费可下载，免费通道拿不到 purl */
    vipOnly?: boolean
    /** 时长（秒，interval） */
    duration?: number
    /** 文件大小（字节，优先 320 档） */
    size?: number
    /** 码率（kbps） */
    bitrate?: number
    /** 封面 URL（albummid → gtimg 图床） */
    coverUrl?: string
    /** 音频格式（v1.4.2 结果行格式胶囊）：按搜索档位推断 mp3/m4a/flac；无档位信息为 undefined */
    ext?: 'mp3' | 'm4a' | 'flac'
    /**
     * 发行日期（归一后的 `YYYY-MM-DD`）。QQ 搜索级给的是 `pubtime`（**秒**时间戳），
     * 多数条目有值。⛔ 别直接把这串塞进表单 —— 表单「发行年」只要 4 位，走 `publishYearOf`。
     */
    publishDate?: string
    /**
     * 专辑定位键（`albummid`）—— 补拉题材/简介要用它打 `GetAlbumDetail`。
     * ⛔ 别和 `album`（专辑**名**）混：名字不能当查询键用。
     */
    albumMid?: string
}

/** 构造 QQ 搜索 URL（免登录） */
export function buildQqSearchUrl(keyword: string, limit = 20): string {
    // 🔴 模板只能有一处：QQ 搜索端点的唯一真源在 `pure/lyricOnline.qqSearchUrl`（歌词面先用它）
    //    ⇒ 这里**复用**它，⛔ 别把这串 URL 再抄一遍（全仓有一条「模板字面量恰 1 处」的断言钉着）。
    return qqSearchUrl(keyword, limit)
}

/** 解析 client_search_cp 响应（可能是 JSONP 包裹 `callback({...})`），返回歌曲列表 */
export function parseQqSearchResponse(raw: string): QqSong[] {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    let data: any
    try {
        data = JSON.parse(json)
    } catch {
        return []
    }
    const list = data?.data?.song?.list
    if (!Array.isArray(list)) return []
    return list
        .map((s: any): QqSong => {
            // 行内显示实际下载档位（QQ 免费下载多为 128k MP3），不再取最高 flac/320 虚标
            const size128 = Number(s?.size128 ?? 0)
            const hasSize = size128 > 0
            const size = hasSize ? size128 : undefined
            const bitrate = hasSize ? 128 : undefined
            const albummid: string = s?.albummid ?? ''
            // 格式胶囊推断：有 mp3 档（128/320）→ mp3；否则有无损 flac → flac；否则有 aac/m4a → m4a；均无则 undefined
            const hasMp3 = (Number(s?.size128 ?? 0) > 0) || (Number(s?.size320 ?? 0) > 0)
            const hasFlac = Number(s?.sizeflac ?? 0) > 0
            const hasAac = (Number(s?.sizeaac ?? 0) > 0) || (Number(s?.sizem4a ?? 0) > 0)
            const ext = hasMp3 ? ('mp3' as const) : hasFlac ? ('flac' as const) : hasAac ? ('m4a' as const) : undefined
            return {
                songmid: s?.songmid ?? '',
                name: s?.songname ?? '',
                artist: Array.isArray(s?.singer)
                    ? s.singer.map((x: any) => x?.name ?? '').filter(Boolean).join('/')
                    : '',
                album: s?.albumname || undefined,
                // 下载付费字段 pay.dowload（1=仅 VIP、100=付费单曲/试听），播放付费 payplay 不适用
                vipOnly: s?.pay?.dowload === 1 || s?.pay?.dowload === 100,
                duration: Number(s?.interval) > 0 ? Number(s.interval) : undefined,
                size: hasSize ? size : undefined,
                bitrate: hasSize ? bitrate : undefined,
                coverUrl: albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg` : undefined,
                ext,
                publishDate: normalizePublishDate(s?.pubtime),
                albumMid: albummid || undefined,
            }
        })
        .filter((s: QqSong) => s.songmid && s.name)
}

/** 生成 32 位十六进制随机 guid（QQ 播放请求需要） */
export function makeGuid(): string {
    const chars = '0123456789abcdef'
    let s = ''
    for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * 16)]
    return s
}

/** 构造 musicu.fcg vkey 请求体 JSON（登录 Cookie 提供 uin 时取真 uin，否则 0） */
export function buildQqVkeyBody(songmid: string, guid: string, uin: string): string {
    const data = {
        req_0: {
            module: 'vkey.GetVkeyServer',
            method: 'CgiGetVkey',
            param: {
                guid,
                songmid: [songmid],
                songtype: [0],
                uin: uin || '0',
                loginflag: 1,
                platform: '20',
            },
        },
    }
    return JSON.stringify(data)
}

/** 构造 musicu.fcg vkey 请求 URL */
export function buildQqVkeyUrl(body: string): string {
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(body)}`
}

/** 从 musicu.fcg 响应解析 purl（空串 = 无权限/需登录/Cookie 过期） */
export function parseQqPurl(raw: string): string {
    try {
        const data = JSON.parse(raw)
        return data?.req_0?.data?.midurlinfo?.[0]?.purl ?? ''
    } catch {
        return ''
    }
}

/** 从登录 Cookie 里提取 uin（形如 `uin=o123456` / `uin=123456`），没有返回空 */
export function extractQqUin(cookie: string): string {
    const m = cookie.match(/(?:^|;\s*)uin=o?(\d+)/)
    return m ? m[1] : ''
}

/** 构造 musicu.fcg 用户信息请求体（GetUserInfo，用于「测试连接」验证 Cookie 有效性） */
export function buildQqUserInfoBody(uin: string): string {
    const data = {
        comm: {
            cv: 0,
            ct: 24,
            format: 'json',
            inCharset: 'utf-8',
            outCharset: 'utf-8',
            notice: 0,
            platform: 'yqq.json',
            needNewCode: 1,
            uin: uin || '0',
        },
        req_1: {
            module: 'music.homepage.FcgiGetUserInfo',
            method: 'GetUserInfo',
            param: {},
        },
    }
    return JSON.stringify(data)
}

/** 构造 musicu.fcg 用户信息请求 URL（GET + data 方式，与 vkey 一致） */
export function buildQqUserInfoUrl(uin: string): string {
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(buildQqUserInfoBody(uin))}`
}

/** 解析 GetUserInfo 响应：req_1.code===0 表示 Cookie 有效（未登录/无效为 500003 等非 0） */
export function parseQqUserInfo(raw: string): { ok: boolean; code: number } {
    try {
        const data = JSON.parse(raw)
        const code = Number(data?.req_1?.code ?? -1)
        return { ok: code === 0, code }
    } catch {
        return { ok: false, code: -1 }
    }
}

/**
 * 🔴 2026-11-19 QQ「测试连接」改判为 Cookie 结构检查（用户 m12958 报障）。
 *
 * 用户报的是：「qq音乐获取的cookie在测试连接时为什么连接错误，我刚刚从浏览器F12复制过来的」。
 * 实测根因**不在 Cookie，在端点**：QQ 已关闭所有公开的登录态校验接口 ——
 *   · 六个 `musicu.fcg` 用户模块（`music.homepage.FcgiGetUserInfo.GetUserInfo`、
 *     `music.UserInfo.userInfo.GetLoginUserInfo`、`music.UserInfo.userInfo.GetUserInfo`、
 *     `music.musicasset.UserInfoRead.GetUserInfo`、`music.vipinfo.VipInfo.GetVipInfo`、
 *     `music.playlist.PlaylistInfoServer.GetPlaylist`）在**免登录 / 假 Cookie / 真实 Cookie**
 *     三种情况下**全部**返回 `req_1.code = 500003 / subcode 860100001`；
 *   · `fav/fcgi-bin/fcg_get_profile_order_asset.fcg` 两者都 `{code:4000,msg:"privacy"}`；
 *   · `rsc/fcgi-bin/fcg_user_created_diss` 两者都 `{code:2000,message:"hostuin para invalid!"}`；
 *   · `splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg` 两者都 `{code:0,data:{uin:0}}`（本就是免登录推荐歌单）。
 * `vkey` 也只能证「拿不到」（免登录 5 首不同 songmid 全空 purl），⛔ 不能证「有效」。
 *
 * ⇒ 「这个 Cookie 有效吗」客观上**不可在线判定**。继续用 `parseQqUserInfo` 判 `code===0` 的结果是：
 *    **任何真实 Cookie 都被判成「连接失败」**，比不校验更糟。
 * ⇒ 改问一个能答的问题：「Cookie 结构完整吗」。缺什么、去哪补，直接说清楚。
 *
 * ⛔ 别为了「让它显示通过」而把判据放宽成 `code !== 500003` —— 那是自欺，用户下次还是撞墙。
 */
export interface QqCookieShape {
    /** 结构齐（uin + 票据）。⛔ 不等于「服务端认可」，见 message */
    ok: boolean
    uin: string
    /** 有没有 `qm_keyst` / `qqmusic_key` / `p_skey` 三者之一（真正的登录态票据） */
    hasTicket: boolean
    message: string
}

/** QQ 登录态票据的三个键名（不同年代的浏览器给不同的那个，实测三种都存在过） */
const QQ_TICKET_RE = /(?:^|;\s*)(?:qm_keyst|qqmusic_key|p_skey)=[^;\s]+/

export function checkQqCookieShape(cookie: string): QqCookieShape {
    const c = String(cookie ?? '').trim()
    if (!c) {
        return { ok: false, uin: '', hasTicket: false, message: 'QQ 需先粘贴登录 Cookie（浏览器 F12 → 网络 → 任一 y.qq.com 请求 → 复制 Cookie）' }
    }
    const uin = extractQqUin(c)
    const hasTicket = QQ_TICKET_RE.test(c)
    if (!uin) {
        return {
            ok: false,
            uin: '',
            hasTicket,
            message: 'Cookie 里没有 uin —— 请在 y.qq.com 任意页面按 F12 复制**完整** Cookie（多半只复制了单个字段）',
        }
    }
    if (!hasTicket) {
        return {
            ok: false,
            uin,
            hasTicket,
            message: 'Cookie 里没有登录票据（qm_keyst / qqmusic_key / p_skey）—— 说明是未登录状态下复制的，请先在浏览器登录 y.qq.com 再复制',
        }
    }
    return {
        ok: true,
        uin,
        hasTicket,
        message:
            `Cookie 结构完整（uin=${uin}，含登录票据）。⚠️ QQ 已关闭公开的登录态校验接口，` +
            '**无法在线确认**这枚 Cookie 是否仍然有效 —— 若下载时提示 500003 或拿不到直链，多半是已过期，重新复制一次即可。',
    }
}

/** 构造专辑详情请求体（GetAlbumDetail：发行日期 / 简介 / 题材） */
export function buildQqAlbumDetailBody(albumMid: string): string {
    const data = {
        comm: { ct: 24, cv: 0, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', platform: 'yqq.json', needNewCode: 0 },
        req_1: {
            module: 'music.musichallAlbum.AlbumInfoServer',
            method: 'GetAlbumDetail',
            param: { albumMid },
        },
    }
    return JSON.stringify(data)
}

/** 构造专辑详情 URL（免登录可用，实测 2004 年专辑也能拿到 2862 字简介） */
export function buildQqAlbumDetailUrl(albumMid: string): string {
    return `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(buildQqAlbumDetailBody(albumMid))}`
}

/** 专辑详情（只取表单能用的三样） */
export interface QqAlbumDetail {
    /** `YYYY-MM-DD`（`basicInfo.publishDate`） */
    publishDate?: string
    /** 简介正文（`basicInfo.desc`，实测 2862 字） */
    description: string
    /** 题材（`basicInfo.genreNew`，如 `"Pop"`） */
    genre: string
    /** 专辑名 */
    name: string
}

/**
 * 解析专辑详情：`req_1.code !== 0` 返 `null`（多数单曲专辑返 104400，属正常情况）。
 *
 * 🔴 题材只认 `genreNew` —— 实测 `basicInfo.genre` 恒为空串，`genres[]` 数组里只有空 name
 *    和一个 `qqmusic://` 协议链接（是跳转协议不是词），⛔ 别用那两个。`genreNew` 也常缺，
 *    缺就留空（表单「题材」可手填），⛔ 不许拿语言/专辑类型冒充题材。
 */
export function parseQqAlbumDetail(raw: string): QqAlbumDetail | null {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    const req = data?.req_1
    if (!req || Number(req.code) !== 0) return null
    const b = req?.data?.basicInfo
    if (!b) return null
    const str = (v: unknown): string => String(v ?? '').trim()
    return {
        publishDate: normalizePublishDate(b.publishDate ?? b.publishTime),
        description: str(b.desc ?? b.description),
        genre: str(b.genreNew) || str(b.genre),
        name: str(b.albumName ?? b.name ?? b.title),
    }
}


// --- 推荐歌单（v1.4.2）：fcg_get_diss_by_tag 歌单广场（免登录）+ 歌单歌曲 ---

/** QQ 推荐歌单项 */
export interface QqPlaylist {
    /** dissid（歌单 id） */
    id: string
    name: string
    coverUrl?: string
    /** 播放次数（listennum） */
    playCount: number
}

/** 构造 QQ 推荐歌单 URL（fcg_get_diss_by_tag，免登录；categoryId=10000000 全部、sortId=5 推荐排序） */
export function buildQqDissListUrl(sin = 0, ein = 29): string {
    const params: Record<string, string> = {
        g_tk: '5381', loginUin: '0', hostUin: '0',
        format: 'json', inCharset: 'GB2312', outCharset: 'utf-8',
        notice: '0', platform: 'yqq', needNewCode: '0',
        categoryId: '10000000', sortId: '5',
        sin: String(sin), ein: String(ein),
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?${qs}`
}

/** 构造 QQ 歌词 URL（fcg_query_lyric_new，nobase64=1 直接返回明文 LRC，需 y.qq.com Referer） */
export function buildQqLyricUrl(songmid: string): string {
    const params: Record<string, string> = {
        songmid, format: 'json', nobase64: '1',
        g_tk: '5381', loginUin: '0', hostUin: '0',
        inCharset: 'utf8', outCharset: 'utf-8',
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${qs}`
}

/** 解析 QQ 歌词响应：`lyric` 字段为明文 LRC 文本；无歌词/解析失败返回 null */
export function parseQqLyricResponse(raw: string): string | null {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    try {
        const data = JSON.parse(json)
        if (Number(data?.retcode ?? -1) !== 0 && Number(data?.code ?? -1) !== 0) return null
        const lyric: unknown = data?.lyric
        return typeof lyric === 'string' && lyric.trim() ? lyric : null
    } catch {
        return null
    }
}

/** 解析 fcg_get_diss_by_tag 响应（可能 JSONP 包裹；`data.list[]`：dissid/dissname/imgurl/listennum） */
export function parseQqDissList(raw: string): QqPlaylist[] {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    let data: any
    try {
        data = JSON.parse(json)
    } catch {
        return []
    }
    if (Number(data?.code ?? 0) !== 0) return []
    const list = data?.data?.list
    if (!Array.isArray(list)) return []
    return list
        .map((it: any): QqPlaylist | null => {
            const id = String(it?.dissid ?? '')
            const name: string = it?.dissname ?? ''
            if (!id || !name) return null
            return {
                id,
                name,
                coverUrl: it?.imgurl || undefined,
                playCount: Number(it?.listennum ?? 0),
            }
        })
        .filter((x: QqPlaylist | null): x is QqPlaylist => x !== null)
}

/** 构造 QQ 歌单歌曲 URL（fcg_ucc_getcdinfo_byids_cp，onlysong=1 返回完整歌曲列表，免登录） */
export function buildQqDissDetailUrl(dissid: string): string {
    const params: Record<string, string> = {
        type: '1', json: '1', utf8: '1', onlysong: '1',
        disstid: dissid, format: 'json',
        g_tk: '5381', loginUin: '0', hostUin: '0',
        inCharset: 'GB2312', outCharset: 'utf-8',
        notice: '0', platform: 'yqq', needNewCode: '0',
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${qs}`
}

/** 将 QQ 歌曲原始项映射为 QqSong（与搜索解析同规则：行内显示实际下载档位 size128/128k，不虚标最高档） */
function mapQqSong(s: any): QqSong | null {
    const songmid: string = s?.songmid ?? ''
    const name: string = s?.songname ?? ''
    if (!songmid || !name) return null
    const size128 = Number(s?.size128 ?? 0)
    const hasSize = size128 > 0
    const size = hasSize ? size128 : undefined
    const bitrate = hasSize ? 128 : undefined
    const albummid: string = s?.albummid ?? ''
    // 格式胶囊推断：有 mp3 档（128/320）→ mp3；否则有无损 flac → flac；否则有 aac/m4a → m4a；均无则 undefined
    const hasMp3 = (Number(s?.size128 ?? 0) > 0) || (Number(s?.size320 ?? 0) > 0)
    const hasFlac = Number(s?.sizeflac ?? 0) > 0
    const hasAac = (Number(s?.sizeaac ?? 0) > 0) || (Number(s?.sizem4a ?? 0) > 0)
    const ext = hasMp3 ? ('mp3' as const) : hasFlac ? ('flac' as const) : hasAac ? ('m4a' as const) : undefined
    return {
        songmid,
        name,
        artist: Array.isArray(s?.singer)
            ? s.singer.map((x: any) => x?.name ?? '').filter(Boolean).join('/')
            : '',
        album: s?.albumname || undefined,
        // 下载付费字段 pay.dowload（1=仅 VIP、100=付费单曲/试听），播放付费 payplay 不适用
        vipOnly: s?.pay?.dowload === 1 || s?.pay?.dowload === 100,
        duration: Number(s?.interval) > 0 ? Number(s.interval) : undefined,
        size: hasSize ? size : undefined,
        bitrate: hasSize ? bitrate : undefined,
        coverUrl: albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg` : undefined,
        ext,
    }
}

/** 解析 fcg_ucc_getcdinfo_byids_cp 响应（`cdlist[0].songlist[]`），复用搜索解析规则 */
export function parseQqDissDetail(raw: string): QqSong[] {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    let data: any
    try {
        data = JSON.parse(json)
    } catch {
        return []
    }
    const list = data?.cdlist?.[0]?.songlist
    if (!Array.isArray(list)) return []
    return list
        .map((s: any) => mapQqSong(s))
        .filter((x): x is QqSong => x !== null)
}

/** musicu.fcg 端点（uniform_get_Dissinfo 歌单歌曲回退用） */
export const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

/** 构造歌单歌曲 V2 请求体（musicu.fcg uniform_get_Dissinfo）：`fcg_ucc_getcdinfo_byids_cp` 对部分用户歌单返回空 cdlist 时的回退通道 */
export function buildQqDissDetailV2Body(dissid: string, songNum = 100): string {
    return JSON.stringify({
        comm: {
            cv: 4747474, ct: 24, format: 'json',
            inCharset: 'utf-8', outCharset: 'utf-8',
            platform: 'yqq.json', needNewCode: 1, uin: 0,
        },
        req_1: {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
                disstid: parseInt(dissid, 10) || 0,
                userinfo: 1,
                tag: 1,
                orderlist: 1,
                song_begin: 0,
                song_num: songNum,
                onlysonglist: 0,
                enc_host_uin: '',
            },
        },
    })
}

/** 构造批量歌单歌曲数请求体（musicu.fcg 多 req）：每个歌单一个 req（`song_num=1`+`onlysonglist=1` 最小响应），`data.total_song_num` 即歌曲数 */
export function buildQqDissCountsBody(ids: string[]): string {
    const reqs: Record<string, unknown> = {}
    ids.forEach((id, i) => {
        reqs[`req_${i + 1}`] = {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
                disstid: parseInt(id, 10) || 0,
                userinfo: 0,
                tag: 0,
                orderlist: 0,
                song_begin: 0,
                song_num: 1,
                onlysonglist: 1,
                enc_host_uin: '',
            },
        }
    })
    return JSON.stringify({
        comm: {
            cv: 4747474, ct: 24, format: 'json',
            inCharset: 'utf-8', outCharset: 'utf-8',
            platform: 'yqq.json', needNewCode: 1, uin: 0,
        },
        ...reqs,
    })
}

/** 解析批量歌单歌曲数：`req_{i+1}.data.total_song_num` 与入参 ids 一一对应；解析失败/为 0 的跳过 */
export function parseQqDissCounts(raw: string, ids: string[]): Record<string, number> {
    const out: Record<string, number> = {}
    try {
        const data = JSON.parse(raw)
        ids.forEach((id, i) => {
            const req = data?.[`req_${i + 1}`]
            if (req && Number(req?.code ?? 0) === 0) {
                const n = Number(req?.data?.total_song_num)
                if (n > 0) out[id] = n
            }
        })
    } catch { /* 解析失败忽略 */ }
    return out
}

/** 解析 uniform_get_Dissinfo 响应（`req_1.data.songlist[]`）：mid=songmid/name/singer[].name/album.mid/file.size_*mp3/pay.pay_play/interval */
export function parseQqDissDetailV2(raw: string): QqSong[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    const req1 = data?.req_1
    if (!req1 || Number(req1?.code ?? 0) !== 0) return []
    const list = req1?.data?.songlist
    if (!Array.isArray(list)) return []
    const out: QqSong[] = []
    for (const it of list) {
        const songmid: string = it?.mid ?? ''
        const name: string = it?.name ?? ''
        if (!songmid || !name) continue
        // 音质档字段名为 size_128mp3 / size_320mp3 / size_flac（与旧接口 size128 等不同）；行内显示实际下载档位 128k，不虚标最高档
        const size128 = Number(it?.file?.size_128mp3 ?? 0)
        const hasSize = size128 > 0
        const size = hasSize ? size128 : undefined
        const bitrate = hasSize ? 128 : undefined
        const albummid: string = it?.album?.mid ?? ''
        out.push({
            songmid,
            name,
            artist: Array.isArray(it?.singer)
                ? it.singer.map((x: any) => x?.name ?? '').filter(Boolean).join('/')
                : '',
            album: it?.album?.name || undefined,
            // uniform_get_Dissinfo 的下载付费字段为 pay.down（1=仅 VIP、100=付费单曲/试听），播放付费 pay_play 不适用
            vipOnly: it?.pay?.down === 1 || it?.pay?.down === 100,
            duration: Number(it?.interval) > 0 ? Number(it.interval) : undefined,
            size: hasSize ? size : undefined,
            bitrate: hasSize ? bitrate : undefined,
            coverUrl: albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg` : undefined,
        })
    }
    return out
}

// ───────────────────────── 阶段 C1：我的清单（需 Cookie 登录态）─────────────────────────
//
// 🔴 2026-11-09 第 15 轮阶段 C。两个端点都是**网页私有接口**（无官方保证），
//    用户已裁定接受，但要求「每家独立降级」—— 解析失败一律回空 + code，⛔ 不抛错。
//
// 端点选型（对着参考实现 NodeJS 版 QQMusicApi 的 routes/user.js 与 routes/songlist.js 核过）：
//  · 自建歌单：`c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss`（hostuin=QQ号）
//  · 我喜欢  ：`c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav`（dirid=201）
//  ⛔ 不用 `/user/detail`（fcg_get_profile_homepage）：那份响应里「我喜欢」的 id 字段叫 `id`、
//     自建歌单叫 `dissid`，两套字段名混在一个数组里，是这套接口最容易写错的地方；
//     `fcg_user_created_diss` 的 `disslist[]` 统一用 `dirid`，好写也不会混。

/** QQ 用户清单一项 */
export interface QqUserPlaylist {
    /** 歌单 id（`dirid`；「我喜欢」固定为 201） */
    id: string
    name: string
    coverUrl?: string
    /** 曲目数（平台没给 ⇒ undefined，⛔ 不写 0） */
    trackCount?: number
    /** 是否「我喜欢」 */
    liked: boolean
}

/** 「我喜欢」的固定 dirid —— QQ 一直用这个魔数，没有别名 */
export const QQ_LIKED_DIRID = '201'

/** 构造「用户自建歌单」URL（fcg_user_created_diss） */
export function buildQqOwnedPlaylistsUrl(uin: string): string {
    const params: Record<string, string> = {
        hostUin: '0', hostuin: uin, sin: '0', size: '200',
        g_tk: '5381', loginUin: '0', format: 'json',
        inCharset: 'utf8', outCharset: 'utf-8',
        notice: '0', platform: 'yqq.json', needNewCode: '0',
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?${qs}`
}

/**
 * 解析「用户自建歌单」响应：`data.disslist[]` 含 dirid / diss_name / diss_cover / song_cnt。
 *
 * ⛔ 返回 `{ code, playlists }` 而不是裸数组 —— 调用方要能分辨：
 *  · `code === 1000` ⇒ Cookie 过期 / 没登录（要提示重贴）
 *  · `code === 4000` ⇒ 该用户主页不公开歌单（不是登录问题，别喊重新登录）
 *  · `code === 0`    ⇒ 正常
 */
export function parseQqOwnedPlaylists(raw: string): { code: number; playlists: QqUserPlaylist[] } {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    let data: any
    try {
        data = JSON.parse(json)
    } catch {
        return { code: 0, playlists: [] }
    }
    const code = Number(data?.code ?? 0)
    if (code !== 0) return { code, playlists: [] }
    const list = data?.data?.disslist
    if (!Array.isArray(list)) return { code, playlists: [] }
    const playlists = list
        .map((it: any): QqUserPlaylist | null => {
            const id = String(it?.dirid ?? '')
            const name = String(it?.diss_name ?? '')
            if (!id || !name) return null
            const cnt = Number(it?.song_cnt)
            return {
                id,
                name,
                coverUrl: it?.diss_cover || undefined,
                // ⚠️ `Number(undefined)` 是 NaN ⇒ 必须显式判有限非负，⛔ 不能 `?? 0`
                trackCount: Number.isFinite(cnt) && cnt >= 0 ? cnt : undefined,
                liked: id === QQ_LIKED_DIRID,
            }
        })
        .filter((x: QqUserPlaylist | null): x is QqUserPlaylist => x !== null)
    return { code, playlists }
}

/**
 * 构造「我喜欢」歌曲 id/mid 表 URL（fcg_musiclist_getmyfav，dirid=201）。
 * ⚠️ 这个端点只返回 `{ map: [歌曲 id], mapmid: [songmid] }` 两个平行数组，
 *    **不含歌名/歌手/封面** —— 必须再走一次歌单详情（`buildQqDissDetailV2Body`）
 *    或逐条补，⛔ 别指望它自带元数据。
 */
export function buildQqFavoritesUrl(dirid = QQ_LIKED_DIRID): string {
    const params: Record<string, string> = { dirid, dirinfo: '1', g_tk: '5381', format: 'json' }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `https://c.y.qq.com/splcloud/fcgi-bin/fcg_musiclist_getmyfav.fcg?${qs}`
}

/** 解析「我喜欢」响应：`mapmid` 是 songmid 平行数组（空 ⇒ 没登录或真的没收藏） */
export function parseQqFavorites(raw: string): { code: number; songmids: string[] } {
    let json = raw.trim().replace(/^\/\*[\s\S]*?\*\//, '')
    const m = json.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/)
    if (m) json = m[1]
    let data: any
    try {
        data = JSON.parse(json)
    } catch {
        return { code: 0, songmids: [] }
    }
    const code = Number(data?.code ?? 0)
    if (code !== 0) return { code, songmids: [] }
    // 优先 songmid：详情/下载都按 songmid 走，`map` 里的数字 id 在本仓三处都用不到
    const mids = Array.isArray(data?.mapmid) ? data.mapmid : []
    const songmids = mids
        .map((x: any) => String(x ?? '').trim())
        .filter((x: string) => !!x)
    return { code, songmids }
}

