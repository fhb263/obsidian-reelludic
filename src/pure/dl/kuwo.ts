/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/kuwoMusic.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 * 纯逻辑（搜索 / mobi 取流与签名 / 歌词 / 歌单）。
 * ⛔ 别把网络调用塞进来 —— HTTP 只在 `services/dl/` 里做。
 */
import { kuwoSearchUrl } from 'pure/lyricOnline';
/**
 * 酷我音乐接入（v1.4.2）。
 * 搜索免登录（www.kuwo.cn/search/searchMusicBykeyWord legacy 接口，`ft=music`）；
 * 下载免登录（mobi.kuwo.cn/mobi.s 车载 App 来源伪装，`convert_url_with_sign`，按 br 逐级降级 128→320→flac）。
 * 纯逻辑（URL/请求体构造、响应解析）抽出以便单测。
 */

/** 酷我搜索候选 */
export interface KuwoSong {
    /** rid（纯数字，已去掉 MUSIC_ 前缀） */
    rid: string
    name: string
    artist: string
    album?: string
    /** bitSwitch=0 表示不可播，需过滤 */
    bitSwitch?: number
    /** 时长（秒，DURATION 字符串） */
    duration?: number
    /** 文件大小（字节，MINFO 里 128k mp3 档） */
    size?: number
    /** 码率（kbps，MINFO 解析） */
    bitrate?: number
    /** 封面 URL（hts_MVPIC）—— ⚠️ 这是**MV 横图**（实测 324×182），⛔ 不是方封面 */
    coverUrl?: string
    /**
     * #509：**专辑图**路径片段（`web_albumpic_short`，形如 `120/s3s94/93/211513640.jpg`）。
     * 🔴 与 `coverUrl` **不是同一张**：那个是 MV 横图，这个才是方封面（拼法见
     *    `pure/posterSources.kuwoAlbumCoverUrl`，实测可换到 1000×1000）。append-only 字段。
     */
    albumPicPath?: string
    /** 音频格式（v1.4.2 结果行格式胶囊）：MINFO 首选档位 mp3/flac/aac */
    format?: string
}

/** 酷我下载解析结果 */
export interface KuwoDownloadInfo {
    url: string
    bitrate?: number
    format?: string
}

/** 酷我推荐歌单项 */
export interface KuwoPlaylist {
    /** 歌单 id（pid） */
    id: string
    name: string
    coverUrl?: string
    /** 播放次数（listencnt） */
    playCount: number
    /** 歌曲数（total，原为字符串） */
    trackCount?: number
    /** 创建者（uname） */
    creator?: string
}

/** 构造酷我歌曲搜索 URL（legacy searchMusicBykeyWord，免登录） */
export function buildKuwoSearchUrl(keyword: string, limit = 20): string {
    // 🔴 模板只能有一处（同 qq）：复用 `pure/lyricOnline.kuwoSearchUrl`。
    return kuwoSearchUrl(keyword, limit)
}

/**
 * 解析 searchMusicBykeyWord 响应。
 * 该 legacy 接口历史上用单引号包裹键/值（需 replace 转合法 JSON）；但现在返回标准双引号 JSON，
 * 且歌曲名/别名可能含撇号（如 `it's`）。因此**先直接解析标准 JSON**，失败（旧版单引号格式）再降级单引号替换，
 * 避免把合法双引号 JSON 里字符串内的 `'` 误替换成 `"` 导致整体解析失败。
 */
export function parseKuwoSearchResponse(raw: string): KuwoSong[] {
    let data: any = tryParseKuwoJson(raw)
    if (data === undefined) data = tryParseKuwoJson(raw.replace(/'/g, '"'))
    if (data === undefined) return []
    const abslist = data?.abslist
    if (!Array.isArray(abslist)) return []
    const out: KuwoSong[] = []
    for (const it of abslist) {
        const rid = String(it?.MUSICRID ?? '').replace(/^MUSIC_/, '')
        const name: string = it?.SONGNAME ?? ''
        if (!rid || !name) continue
        if (Number(it?.bitSwitch ?? 0) === 0) continue // bitSwitch=0 不可播
        const minfo = it?.MINFO ?? ''
        const { size, bitrate, format } = parseKuwoMInfo(minfo)
        out.push({
            rid,
            name,
            artist: it?.ARTIST ?? '',
            album: it?.ALBUM || undefined,
            bitSwitch: Number(it?.bitSwitch ?? 0),
            duration: Number(it?.DURATION) > 0 ? Number(it.DURATION) : undefined,
            size: size > 0 ? size : undefined,
            bitrate: bitrate > 0 ? bitrate : undefined,
            coverUrl: it?.hts_MVPIC || undefined,
            // #509：专辑图（方封面）另存一份 —— `coverUrl` 那张是 MV 横图，拿它当封面会压扁
            albumPicPath: typeof it?.web_albumpic_short === 'string' ? it.web_albumpic_short : undefined,
            format: format || undefined,
        })
    }
    return out
}

/** 尝试解析 JSON：成功返回对象，失败返回 undefined（供标准 JSON 优先、单引号降级两段式解析） */
function tryParseKuwoJson(raw: string): any {
    try {
        return JSON.parse(raw)
    } catch {
        return undefined
    }
}

/**
 * 解析酷我 MINFO（多档格式 `level:ff,bitrate:2000,format:flac,size:52.83Mb;...`）。
 * 返回 {size, bitrate, format}：按 mp3 128 → mp3 320 → flac 优先取 size（与 go-music-dl 同序），
 * 找不到则取所有档的最大 size；bitrate/format 取对应档。
 */
export function parseKuwoMInfo(minfo: string): { size: number; bitrate: number; format: string } {
    if (!minfo) return { size: 0, bitrate: 0, format: '' }
    const formats: Array<{ format: string; bitrate: number; size: number }> = []
    for (const part of minfo.split(';')) {
        const kv: Record<string, string> = {}
        for (const attr of part.split(',')) {
            const idx = attr.indexOf(':')
            if (idx > 0) kv[attr.slice(0, idx).trim()] = attr.slice(idx + 1).trim()
        }
        const sizeStr = (kv.size ?? '').toLowerCase()
        if (!sizeStr) continue
        const sizeMb = parseFloat(sizeStr.replace(/mb$/, ''))
        if (!Number.isFinite(sizeMb) || sizeMb <= 0) continue
        formats.push({
            format: kv.format ?? '',
            bitrate: Number(kv.bitrate) || 0,
            size: Math.round(sizeMb * 1024 * 1024),
        })
    }
    if (formats.length === 0) return { size: 0, bitrate: 0, format: '' }
    for (const f of formats) if (f.format === 'mp3' && f.bitrate === 128) return { size: f.size, bitrate: f.bitrate, format: f.format }
    for (const f of formats) if (f.format === 'mp3' && f.bitrate === 320) return { size: f.size, bitrate: f.bitrate, format: f.format }
    for (const f of formats) if (f.format === 'flac') return { size: f.size, bitrate: f.bitrate, format: f.format }
    const max = formats.reduce((a, b) => (b.size > a.size ? b : a), formats[0])
    return { size: max.size, bitrate: max.bitrate, format: max.format }
}

/**
 * 构造酷我下载直链接口 URL（mobi.kuwo.cn 车载 App 来源伪装，免登录）。
 * br 依次尝试：128kmp3 → 320kmp3 → flac（更高音质可能版权受限返回空 url，逐级降级）。
 */
export function buildKuwoMobiUrl(rid: string, br: string, user: string): string {
    const params: Record<string, string> = {
        f: 'web',
        source: 'kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk',
        from: 'PC',
        type: 'convert_url_with_sign',
        br,
        rid,
        user,
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `https://mobi.kuwo.cn/mobi.s?${qs}`
}

/** 酷我下载候选音质档位（从高到低降级） */
export const KUWO_QUALITIES = ['128kmp3', '320kmp3', 'flac'] as const

/** 生成酷我播放请求的随机 user 标识（`C_APK_guanwang_时间戳随机数`） */
export function makeKuwoUser(): string {
    return `C_APK_guanwang_${Date.now()}${Math.floor(Math.random() * 1000000)}`
}

/** 构造酷我歌词 URL（m.kuwo.cn/newh5/singles/songinfoandlrc；需 `httpsStatus=1`，否则返回 301 音乐查询失败） */
export function buildKuwoLyricUrl(rid: string): string {
    return `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(rid)}&httpsStatus=1`
}

/** 解析酷我歌词响应：`data.lrclist[]` 含 lineLyric + time（秒），拼接为 LRC `[mm:ss.xx]` 文本；无歌词返回 null */
export function parseKuwoLyricResponse(raw: string): string | null {
    try {
        const data = JSON.parse(raw)
        const lrclist = data?.data?.lrclist
        if (!Array.isArray(lrclist) || lrclist.length === 0) return null
        const lines: string[] = []
        for (const it of lrclist) {
            const lineLyric: string = it?.lineLyric ?? ''
            if (!lineLyric) continue
            const timeStr: string = it?.time ?? ''
            if (timeStr === '' || timeStr === null || timeStr === undefined) {
                lines.push(lineLyric) // 无时间戳的行（如标题/元数据）原样保留
                continue
            }
            const time = Number(timeStr)
            if (!Number.isFinite(time) || time < 0) {
                lines.push(lineLyric) // 无效时间戳的行原样保留
                continue
            }
            const totalMs = Math.round(time * 1000)
            const mm = Math.floor(totalMs / 60000)
            const ss = Math.floor((totalMs % 60000) / 1000)
            const xx = Math.floor((totalMs % 1000) / 10)
            const stamp = `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xx).padStart(2, '0')}]`
            lines.push(`${stamp}${lineLyric}`)
        }
        return lines.length > 0 ? lines.join('\n') : null
    } catch {
        return null
    }
}

/** 解析 mobi.s 响应：`{data:{url,bitrate,format}}`；url 空 = 该音质不可用 */
export function parseKuwoMobiResponse(raw: string): KuwoDownloadInfo {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return { url: '' }
    }
    const url: string = data?.data?.url ?? ''
    if (!url) return { url: '' }
    return {
        url,
        bitrate: typeof data?.data?.bitrate === 'number' ? data.data.bitrate : undefined,
        format: data?.data?.format || undefined,
    }
}

/** 酷我请求/下载用的桌面 UA */
export const KUWO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'

// --- 推荐歌单（v1.4.2）：wapi/nplserver 老接口（免 token，避开 www.kuwo.cn 需 csrf+Secret 的新 API） ---

/** 构造酷我推荐歌单 URL（wapi.kuwo.cn getRcmPlayList，PC 老接口免登录；返回 `data.data[]`） */
export function buildKuwoRcmPlaylistUrl(pn = 1, rn = 30): string {
    const params: Record<string, string> = {
        loginUid: '0',
        loginSid: '0',
        appUid: '38668888',
        pn: String(pn),
        rn: String(rn),
        order: 'new',
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?${qs}`
}

/** 解析 getRcmPlayList 响应：`data.data[]`：id/name/img/listencnt/total/uname（total 是字符串转数字） */
export function parseKuwoRcmPlaylist(raw: string): KuwoPlaylist[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    if (Number(data?.code ?? 0) !== 200) return []
    const list = data?.data?.data
    if (!Array.isArray(list)) return []
    const out: KuwoPlaylist[] = []
    for (const it of list) {
        const id = String(it?.id ?? '')
        const name: string = it?.name ?? ''
        if (!id || !name) continue
        const total = Number(it?.total ?? 0)
        const playCount = Number(it?.listencnt ?? 0)
        out.push({
            id,
            name,
            coverUrl: it?.img || undefined,
            playCount: playCount > 0 ? playCount : 0,
            trackCount: total > 0 ? total : undefined,
            creator: it?.uname || undefined,
        })
    }
    return out
}

/** 构造酷我歌单歌曲 URL（nplserver pl.svc getlistinfo，免登录；返回 `musiclist[]`）。
 *  rn=500：实测 rn=300 对 232 首歌单可返回全部歌曲（接口无固定上限，此前 100 只是参数偏小） */
export function buildKuwoPlaylistDetailUrl(pid: string, pn = 0, rn = 500): string {
    const params: Record<string, string> = {
        op: 'getlistinfo',
        pid,
        pn: String(pn),
        rn: String(rn),
        encode: 'utf8',
        keyset: 'pl2012',
        vipver: 'MUSIC_9.1.1.2_BCS2',
        newver: '1',
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
    return `http://nplserver.kuwo.cn/pl.svc?${qs}`
}

/** 解析 pl.svc 响应：`musiclist[]`：id(=rid)/name/artist/duration/album/albumpic + MINFO 音质档（复用 parseKuwoMInfo） */
export function parseKuwoPlaylistDetail(raw: string): KuwoSong[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    const list = data?.musiclist
    if (!Array.isArray(list)) return []
    const out: KuwoSong[] = []
    for (const it of list) {
        const rid = String(it?.id ?? '')
        const name: string = it?.name ?? ''
        if (!rid || !name) continue
        const { size, bitrate, format } = parseKuwoMInfo(it?.MINFO ?? '')
        out.push({
            rid,
            name,
            artist: it?.artist ?? '',
            album: it?.album || undefined,
            duration: Number(it?.duration) > 0 ? Number(it.duration) : undefined,
            coverUrl: it?.albumpic || undefined,
            size: size > 0 ? size : undefined,
            bitrate: bitrate > 0 ? bitrate : undefined,
            format: format || undefined,
        })
    }
    return out
}
