/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/qqMusic.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 * 纯逻辑（搜索 URL / vkey 请求体 / 歌词与歌单解析），**零 obsidian 依赖** ⇒ 直接单测。
 * ⛔ 别把网络调用塞进来 —— HTTP 只在 `services/dl/` 里做（本仓分层：pure 只算不发）。
 */
import { qqSearchUrl } from 'pure/lyricOnline';
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
