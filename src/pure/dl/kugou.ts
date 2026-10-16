/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/kugouMusic.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 * 纯逻辑（搜索 / getSongInfo / trackercdn 签名 / 歌词），含本文件自带的 `md5hex`（网易云加密模块也复用它）。
 * ⛔ 别把网络调用塞进来 —— HTTP 只在 `services/dl/` 里做。
 */
/**
 * 酷狗音乐接入（v1.4.2）。
 * 搜索免登录（song_search_v2 PC 网页搜索）；下载免费通道 `m.kugou.com/app/i/getSongInfo.php?cmd=playInfo`
 * （无需 Cookie，128k 标准音质），VIP 歌曲（privilege=10）返回空 url 需提示；
 * trackercdn v2 带 `key=MD5(hash+"kgcloudv2")` 签名做兜底。
 * 纯逻辑（URL/请求体构造、响应解析、MD5 签名）抽出以便单测。
 */

/** 酷狗搜索候选 */
export interface KugouSong {
    /** 主 hash（FileHash），下载用 */
    hash: string
    name: string
    artist: string
    album?: string
    /** 无损 hash（sq_hash），VIP 才可能有直链 */
    sqHash?: string
    /** 320k hash（hq_hash） */
    hqHash?: string
    /** 10=VIP 受限；0/8=免费可下 */
    privilege?: number
    coverUrl?: string
    /** 时长（秒，Duration） */
    duration?: number
    /** 文件大小（字节，FileSize） */
    size?: number
    /** 码率（kbps，由 size×8/duration 估算） */
    bitrate?: number
}

/** 酷狗下载解析结果 */
export interface KugouDownloadInfo {
    url: string
    ext?: string
    bitrate?: number
}

/** 酷狗推荐歌单项 */
export interface KugouPlaylist {
    /** specialid（歌单 id） */
    id: string
    name: string
    coverUrl?: string
    /** 播放次数（playcount） */
    playCount: number
    /** 歌曲数（songcount） */
    trackCount?: number
}

/** 构造酷狗歌曲搜索 URL（PC 网页 song_search_v2，免登录） */
export function buildKugouSearchUrl(keyword: string, limit = 20): string {
    const params: Record<string, string> = {
        keyword,
        platform: 'WebFilter',
        format: 'json',
        page: '1',
        pagesize: String(limit),
        userid: '-1',
        clientver: '',
        tag: 'em',
        filter: '2',
        iscorrection: '1',
        privilege_filter: '0',
        '_': String(Date.now()),
    }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `http://songsearch.kugou.com/song_search_v2?${qs}`
}

/** 解析 song_search_v2 响应（JSON `data.lists[]`），清理 `<em>` 高亮标签 */
export function parseKugouSearchResponse(raw: string): KugouSong[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    const lists = data?.data?.lists
    if (!Array.isArray(lists)) return []
    const out: KugouSong[] = []
    for (const it of lists) {
        const hash: string = it?.FileHash ?? ''
        if (!hash) continue
        const sq: string = it?.SQFileHash ?? ''
        const hq: string = it?.HQFileHash ?? ''
        const name = cleanKugouText(it?.SongName)
        if (!name) continue
        const coverRaw: string = it?.Image ?? ''
        const duration = Number(it?.Duration) > 0 ? Number(it.Duration) : undefined
        const size = Number(it?.FileSize) > 0 ? Number(it.FileSize) : undefined
        // bitrate = size×8 / duration(秒) / 1000
        const bitrate = size && duration ? Math.round((size * 8) / 1000 / duration) : undefined
        out.push({
            hash,
            name,
            artist: cleanKugouText(it?.SingerName),
            album: cleanKugouText(it?.AlbumName) || undefined,
            sqHash: sq || undefined,
            hqHash: hq || undefined,
            privilege: typeof it?.Privilege === 'number' ? it.Privilege : Number(it?.Privilege ?? 0),
            coverUrl: coverRaw ? coverRaw.replace('{size}', '240') : undefined,
            duration,
            size,
            bitrate,
        })
    }
    return out
}

/** 清理酷狗搜索结果里的 `<em>…</em>` 高亮标签 */
export function cleanKugouText(s: unknown): string {
    return String(s ?? '').replace(/<\/?em>/g, '').trim()
}

/** 构造免费下载直链接口 URL（移动端 getSongInfo.php，无需 Cookie） */
export function buildKugouSongInfoUrl(hash: string): string {
    return `http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${encodeURIComponent(hash)}`
}

/** 解析 getSongInfo.php 响应；VIP 歌曲 url 为空/errcode 非 0 视为不可下载 */
export function parseKugouSongInfoResponse(raw: string): KugouDownloadInfo {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return { url: '' }
    }
    const url: string = data?.url ?? ''
    if (!url) return { url: '' }
    return {
        url,
        ext: data?.extName || undefined,
        bitrate: typeof data?.bitRate === 'number' ? data.bitRate : undefined,
    }
}

/** 构造 trackercdn v2 兜底 URL（带 `key=MD5(hash+"kgcloudv2")` 签名，免登录） */
export function buildKugouTrackercdnUrl(hash: string): string {
    const key = md5hex(hash + 'kgcloudv2')
    return `https://trackercdn.kugou.com/i/v2/?cdnBackup=1&behavior=download&pid=1&cmd=21&appid=1001&hash=${encodeURIComponent(hash)}&key=${key}`
}

/** 解析 trackercdn v2 响应：url/backup_url 可能是字符串或数组，逐个取第一个有效直链 */
export function parseKugouTrackercdnResponse(raw: string): KugouDownloadInfo {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return { url: '' }
    }
    const url = pickFirstUrl(data?.url) || pickFirstUrl(data?.backup_url)
    if (!url) return { url: '' }
    return { url, ext: data?.extName || undefined, bitrate: data?.bitRate }
}

/** 酷狗响应里的 url 字段可能是字符串或数组，取第一个非空直链 */
function pickFirstUrl(v: unknown): string {
    if (typeof v === 'string' && v) return v
    if (Array.isArray(v)) {
        for (const item of v) {
            if (typeof item === 'string' && item) return item
        }
    }
    return ''
}

/** 酷狗直链探测/下载用的移动端 UA + Referer */
export const KUGOU_MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
export const KUGOU_MOBILE_REFERER = 'http://m.kugou.com'
export const KUGOU_PC_REFERER = 'https://www.kugou.com/'

// --- 在线歌词（v1.4.1）：lyrics.kugou.com search + download（免登录） ---

/** 酷狗歌词候选（search 接口返回） */
export interface KugouLyricCandidate {
    id: string
    accesskey: string
    song: string
    singer: string
    duration?: number
}

/** 构造酷狗歌词搜索 URL（keyword 建议「歌名-歌手」，PC 网页免登录） */
export function buildKugouLyricSearchUrl(keyword: string): string {
    const params: Record<string, string> = { ver: '1', man: 'yes', client: 'pc', keyword, duration: '', hash: '' }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `https://lyrics.kugou.com/search?${qs}`
}

/** 解析歌词搜索响应：`data.candidates[]` 含 id/accesskey/song/singer */
export function parseKugouLyricSearch(raw: string): KugouLyricCandidate[] {
    try {
        const data = JSON.parse(raw)
        const list = data?.data?.candidates
        if (!Array.isArray(list)) return []
        return list
            .map((it: any): KugouLyricCandidate | null => {
                const id: string = it?.id ?? ''
                const accesskey: string = it?.accesskey ?? ''
                if (!id || !accesskey) return null
                return {
                    id,
                    accesskey,
                    song: it?.song ?? '',
                    singer: it?.singer ?? '',
                    // 🔴 #405：**不取 `duration`** —— 实测同一首歌的候选里它是混单位的脏值
                    //    （同一 query 下同时出现 `260`（≈秒）与 `299000`（≈毫秒），还有 `23875` 这种
                    //    既不是秒也不是毫秒的数）⇒ 标出来必然误导，还会污染按匹配度的排序。
                    //    ⛔ 宁可不显示时长，也不给假值（仓里既定口径）。
                }
            })
            .filter((x: KugouLyricCandidate | null): x is KugouLyricCandidate => x !== null)
    } catch {
        return []
    }
}

/** 构造酷狗歌词下载 URL（search 拿到的 id/accesskey，fmt=lrc 明文或 base64） */
export function buildKugouLyricDownloadUrl(id: string, accesskey: string): string {
    const params: Record<string, string> = { ver: '1', client: 'pc', id, accesskey, fmt: 'lrc', charset: 'utf8' }
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    return `https://lyrics.kugou.com/download?${qs}`
}

/** 解析歌词下载响应：`content` 可能是 base64 编码的 LRC 明文（解码 UTF-8）；无法解析返回 null */
export function parseKugouLyricDownload(raw: string): string | null {
    try {
        const data = JSON.parse(raw)
        const content: unknown = data?.content
        if (typeof content !== 'string' || !content) return null
        // content 是 base64（常以 LF 结尾），解码为 UTF-8；解码失败（非合法 base64）则按明文处理
        try {
            const buf = Buffer.from(content.replace(/\s+/g, ''), 'base64')
            const dec = buf.toString('utf8')
            if (dec && dec.includes('[')) return dec
        } catch { /* 非 base64，回落明文 */ }
        return content
    } catch {
        return null
    }
}

// --- 推荐歌单（v1.4.2）：m.kugou.com 移动端 plist 歌单（免登录） ---

/** 构造酷狗推荐歌单 URL（m.kugou.com/plist/index，免登录；返回 `plist.list.info[]`） */
export function buildKugouSpecialListUrl(page = 1, pagesize = 30): string {
    return `http://m.kugou.com/plist/index?json=true&page=${page}&pagesize=${pagesize}`
}

/** 解析 plist/index 响应：`plist.list.info[]`：specialid/specialname/imgurl/playcount/songcount；封面 `{size}` 替换为 150 */
export function parseKugouSpecialList(raw: string): KugouPlaylist[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    const info = data?.plist?.list?.info
    if (!Array.isArray(info)) return []
    const out: KugouPlaylist[] = []
    for (const it of info) {
        const id = String(it?.specialid ?? '')
        const name = cleanKugouText(it?.specialname)
        if (!id || !name) continue
        const coverRaw: string = it?.imgurl ?? ''
        const playCount = Number(it?.playcount ?? 0)
        const trackCount = Number(it?.songcount ?? 0)
        out.push({
            id,
            name,
            coverUrl: coverRaw ? coverRaw.replace('{size}', '150') : undefined,
            playCount: playCount > 0 ? playCount : 0,
            trackCount: trackCount > 0 ? trackCount : undefined,
        })
    }
    return out
}

/** 构造酷狗歌单歌曲 URL（m.kugou.com/plist/list/{id}，接口会 301 重定向，HTTP 层需跟随） */
export function buildKugouSpecialDetailUrl(specialid: string, page = 1, pagesize = 100): string {
    return `http://m.kugou.com/plist/list/${encodeURIComponent(specialid)}?json=true&page=${page}&pagesize=${pagesize}`
}

/** 解析 plist/list 响应：`list.list.info[]`：hash/filename("歌名 - 歌手")/duration/privilege + filesize/320filesize/sqfilesize 音质档；filename 拆 name/artist */
export function parseKugouSpecialDetail(raw: string): KugouSong[] {
    let data: any
    try {
        data = JSON.parse(raw)
    } catch {
        return []
    }
    const info = data?.list?.list?.info
    if (!Array.isArray(info)) return []
    const out: KugouSong[] = []
    for (const it of info) {
        const hash: string = it?.hash ?? ''
        const filename: string = it?.filename ?? ''
        if (!hash || !filename) continue
        // filename 形如 "歌名 - 歌手"（最后一个 " - " 分隔）；无分隔则整体当歌名
        const idx = filename.lastIndexOf(' - ')
        const name = idx > 0 ? filename.slice(0, idx).trim() : filename.trim()
        const artist = idx > 0 ? filename.slice(idx + 3).trim() : ''
        const privilege = typeof it?.privilege === 'number' ? it.privilege : Number(it?.privilege ?? 0)
        // 行内显示实际下载档位（免费通道标准 128k），不虚标最高档（sq/320）
        const sz128 = Number(it?.filesize ?? 0)
        const size = sz128 > 0 ? sz128 : undefined
        const bitrate = size !== undefined ? 128 : undefined
        out.push({
            hash,
            name,
            artist,
            privilege,
            duration: Number(it?.duration) > 0 ? Number(it.duration) : undefined,
            size,
            bitrate,
        })
    }
    return out
}

/** 酷狗 VIP 信息接口（用于「测试连接」验证 Cookie 有效性） */
export const KUGOU_VIP_ROLEINFO_URL = 'https://vip.kugou.com/recharge/roleinfo'

/** 解析 roleinfo 响应：errno===0 表示 Cookie 有效（无 Cookie 返回 errno=105 / error_code=20017） */
export function parseKugouRoleinfo(raw: string): { ok: boolean; errno: number; errorCode: number } {
    try {
        const data = JSON.parse(raw)
        const errno = Number(data?.errno ?? -1)
        const errorCode = Number(data?.error_code ?? -1)
        return { ok: errno === 0, errno, errorCode }
    } catch {
        return { ok: false, errno: -1, errorCode: -1 }
    }
}

/**
 * 纯 TS MD5（用于 trackercdn 签名 key=MD5(hash+"kgcloudv2")）。
 * 标准实现，无外部依赖，可在 Node / Obsidian 环境运行。
 */
export function md5hex(input: string): string {
    const utf8 = unescape(encodeURIComponent(input))
    const bytes: number[] = []
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i))
    // 填充：0x80 + 零填充到 56 字节，再补 8 字节 64 位小端长度（共 64 字节块）
    const bitLen = bytes.length * 8
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) bytes.push(0)
    bytes.push(
        (bitLen >>> 0) & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff,
        (bitLen / 0x100000000) & 0xff, ((bitLen / 0x100000000) >>> 8) & 0xff,
        ((bitLen / 0x100000000) >>> 16) & 0xff, ((bitLen / 0x100000000) >>> 24) & 0xff,
    )

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
    const K = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ]
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]

    const m: number[] = []
    for (let i = 0; i < bytes.length; i += 4) {
        m.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0)
    }

    const rotl = (x: number, c: number): number => ((x << c) | (x >>> (32 - c))) >>> 0

    for (let i = 0; i < m.length; i += 16) {
        const chunk = m.slice(i, i + 16)
        let a = a0, b = b0, c = c0, d = d0
        for (let j = 0; j < 64; j++) {
            let f: number, g: number
            if (j < 16) { f = (b & c) | (~b & d); g = j }
            else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16 }
            else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16 }
            else { f = c ^ (b | ~d); g = (7 * j) % 16 }
            const tmp = d
            d = c
            c = b
            b = (b + rotl(a + f + K[j] + chunk[g], S[j])) >>> 0
            a = tmp
        }
        a0 = (a0 + a) >>> 0
        b0 = (b0 + b) >>> 0
        c0 = (c0 + c) >>> 0
        d0 = (d0 + d) >>> 0
    }

    const toHex = (n: number): string => {
        let s = (n >>> 0).toString(16)
        while (s.length < 8) s = '0' + s
        return s
    }
    // 小端序输出
    const le = (n: number): string => toHex(((n & 0xff) << 24) | (((n >>> 8) & 0xff) << 16) | (((n >>> 16) & 0xff) << 8) | ((n >>> 24) & 0xff))
    return le(a0) + le(b0) + le(c0) + le(d0)
}
