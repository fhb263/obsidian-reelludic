/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/neteaseCrypto.ts`（v1.4.4，同作者）。
 * 🔴 **许可血统如实标注**（用户 2026-09-28 确认两仓均为其本人作品、同意合并）：
 *    本文件算法移植自 **AGPL-3.0** 的 `go-music-dl` 的 `netease/crypto.go`；本仓整体为 GPL-3.0-only。
 *    改动本文件时请保留这段说明（照抄正本的做法：来源可追溯）。
 */
/**
 * 网易云 weapi / eapi 加密（v1.4.2 VIP 下载用）。
 * 移植自 go-music-dl 的 `netease/crypto.go`（unlock-music 系算法）：
 * - weapi：AES-128-CBC 二次（nonce + 随机 secKey）+ RSA 大数模幂（指数 0x10001、256 字节模数，NoPadding）
 * - eapi：MD5 摘要 + AES-128-ECB（密钥 e82ckenh8dichen8），输出小写 hex
 * Node 内置 crypto（Obsidian `window.require('crypto')` / Node require）负责 AES；RSA 模幂用 BigInt。
 * 纯逻辑可单测（加密向量来自 Go 实现推导）。
 */
import { md5hex } from './kugou'

/** 获取 Node crypto 模块：Obsidian 渲染进程走 window.require（绕过 CSP），Node/vitest 走模块作用域 require */
function getNodeCrypto(): any {
    try {
        const w = typeof window !== 'undefined' ? (window as any) : undefined
        if (w && typeof w.require === 'function') {
            const c = w.require('crypto')
            if (c && typeof c.createCipheriv === 'function') return c
        }
    } catch { /* 回退 */ }
    // Node 环境（vitest / esbuild CJS bundle）：模块作用域 require（typeof 对未声明变量安全，不抛 ReferenceError）
    try {
        const req = typeof require !== 'undefined' ? require : undefined
        if (typeof req === 'function') {
            const c = (req as (m: string) => any)('crypto')
            if (c && typeof c.createCipheriv === 'function') return c
        }
    } catch { /* 回退 */ }
    throw new Error('Node crypto 不可用')
}

// --- weapi 常量（Go crypto.go 原样） ---
const WEAPI_NONCE = '0CoJUm6Qyw8W8jud'
const WEAPI_IV = '0102030405060708'
const WEAPI_PUB_MODULUS =
    '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
const WEAPI_PUB_KEY = '010001'

/** eapi 密钥（Go 原样） */
const EAPI_KEY = 'e82ckenh8dichen8'
const EAPI_MID = '36cd479b6b5'

/** 生成随机 16 位 secKey（字母+数字） */
export function randomString(size = 16): string {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let out = ''
    for (let i = 0; i < size; i++) out += letters[Math.floor(Math.random() * letters.length)]
    return out
}

/** AES-128-CBC 加密（PKCS7 填充），返回 base64 */
export function aesEncryptCBC(text: string, key: string, iv: string): string {
    const crypto = getNodeCrypto()
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from(iv, 'utf8'))
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return enc.toString('base64')
}

/** AES-128-ECB 加密（PKCS7 填充），返回小写 hex（eapi 用） */
export function aesEncryptECB(text: string, key: string): string {
    const crypto = getNodeCrypto()
    const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null)
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return enc.toString('hex')
}

/** RSA NoPadding 加密：reverse → hex → `pow(text^pubKey % modulus)` → 补 256 位 hex */
export function rsaEncrypt(text: string, pubKey = WEAPI_PUB_KEY, modulus = WEAPI_PUB_MODULUS): string {
    // 反转字符串（Go reverseString）
    const reversed = Array.from(text).reverse().join('')
    const hexText = Buffer.from(reversed, 'utf8').toString('hex')
    const base = BigInt('0x' + hexText)
    const exp = BigInt('0x' + pubKey)
    const mod = BigInt('0x' + modulus)
    // BigInt 模幂（指数 0x10001 很小，直接幂模）
    let result = BigInt(1)
    let b = base
    let e = exp
    const one = BigInt(1)
    while (e > BigInt(0)) {
        if ((e & one) === one) result = (result * b) % mod
        b = (b * b) % mod
        e >>= one
    }
    return result.toString(16).padStart(256, '0')
}

/**
 * weapi 加密（对应 Go EncryptWeApi）：返回 `{params, encSecKey}` 供 POST 表单。
 * 随机 16 位 secKey → 第一次 AES(nonce) → 第二次 AES(secKey) → RSA 加密 secKey。
 */
export function encryptWeApi(text: string): { params: string; encSecKey: string } {
    const secKey = randomString(16)
    const encText = aesEncryptCBC(text, WEAPI_NONCE, WEAPI_IV)
    const params = aesEncryptCBC(encText, secKey, WEAPI_IV)
    const encSecKey = rsaEncrypt(secKey)
    return { params, encSecKey }
}

/**
 * eapi 加密（对应 Go EncryptEApi）：`md5("nobody"+path+"use"+payload+"md5forencrypt")`
 * → `path-36cd479b6b5-payload-36cd479b6b5-digest` → AES-128-ECB → 小写 hex。
 * urlPath 的 `/eapi/` 先替换成 `/api/`。
 */
export function encryptEApi(urlPath: string, payload: string): string {
    const path = urlPath.replace('/eapi/', '/api/')
    const digest = md5hex(`nobody${path}use${payload}md5forencrypt`)
    const data = `${path}-${EAPI_MID}-${payload}-${EAPI_MID}-${digest}`
    return aesEncryptECB(data, EAPI_KEY)
}

/**
 * 网易云账号响应解析：ok 仅表示登录有效（code===200），vipType 单独返回（0=普通账号，非 0=会员）。
 * 调用方按需用 vipType 判断是否走 VIP 下载链路。
 *
 * 🔴 2026-11-09 第 15 轮阶段 C 追加 `userId`：`weapi/user/playlist` 与 `song/like/get`
 * 都以它为必填 `uid`。**这个字段只能从这里拿** —— ⛔ 别从 Cookie（`MUSIC_U`）里猜，
 * 那是加密串；也别写死在设置里让用户手填，多一步配置就多一处过期源。
 * 未登录 / 解析失败 ⇒ 空串（调用方据此判「拿不到 uid」而不是当成 uid='0'）。
 */
export function parseVipAccountResponse(raw: string): { ok: boolean; vipType: number; userId: string } {
    try {
        const data = JSON.parse(raw)
        const code = Number(data?.code ?? -1)
        const vipType = Number(data?.profile?.vipType ?? 0)
        const uid = Number(data?.profile?.userId ?? 0)
        return { ok: code === 200, vipType, userId: uid > 0 ? String(uid) : '' }
    } catch {
        return { ok: false, vipType: 0, userId: '' }
    }
}

/** 网易云推荐歌单项 */
export interface NeteasePlaylist {
    id: string
    name: string
    coverUrl?: string
    playCount: number
    trackCount: number
    copywriter?: string
}

/** 构造推荐歌单请求体（weapi，免登录）：limit 条个性化推荐 */
export function buildRecommendedPlaylistsBody(limit = 30): string {
    return JSON.stringify({ limit, total: true, n: 1000 })
}

/** 解析推荐歌单响应：`result[]` 含 id/name/picUrl/playCount/trackCount/copywriter */
export function parseRecommendedPlaylists(raw: string): NeteasePlaylist[] {
    try {
        const data = JSON.parse(raw)
        if (Number(data?.code ?? 0) !== 200) return []
        const list = data?.result
        if (!Array.isArray(list)) return []
        return list
            .map((it: any): NeteasePlaylist | null => {
                const id = String(it?.id ?? '')
                const name: string = it?.name ?? ''
                if (!id || !name) return null
                return {
                    id,
                    name,
                    coverUrl: it?.picUrl || undefined,
                    playCount: Number(it?.playCount ?? 0),
                    trackCount: Number(it?.trackCount ?? 0),
                    copywriter: it?.copywriter || undefined,
                }
            })
            .filter((x: NeteasePlaylist | null): x is NeteasePlaylist => x !== null)
    } catch {
        return []
    }
}

/** 构造歌单详情请求体（weapi）：n=0 只拿 trackIds 列表 */
export function buildPlaylistDetailBody(playlistId: string): string {
    return JSON.stringify({ id: playlistId, n: 0, csrf_token: '' })
}

/** 解析歌单详情响应，提取 trackIds（数字 id 数组）；失败返回空 */
export function parsePlaylistTrackIds(raw: string): string[] {
    try {
        const data = JSON.parse(raw)
        if (Number(data?.code ?? 0) !== 200) return []
        const ids = data?.playlist?.trackIds
        if (!Array.isArray(ids)) return []
        return ids.map((t: any) => String(t?.id ?? '')).filter(Boolean)
    } catch {
        return []
    }
}

/** 构造批量歌曲详情请求体（weapi/v3/song/detail）：c 是 `[{id},...]` 字符串，ids 是 id 数组字符串 */
export function buildSongDetailBody(ids: string[]): string {
    const c = JSON.stringify(ids.map((id) => ({ id })))
    return JSON.stringify({ c, ids: JSON.stringify(ids) })
}

// ───────────────────────── 阶段 C1：我的清单（需 Cookie 登录态）─────────────────────────
//
// 🔴 2026-11-09 第 15 轮阶段 C。两个端点都是**网页私有接口**（无官方保证），
//    用户已裁定接受，但要求「每家独立降级」—— 解析失败一律回空 + code，⛔ 不抛错。
// ⚠️ uid 从 `weapi/nuser/account/get` 取（本仓 `services/dl/index.ts` 的
//    `NETEASE_ACCOUNT_API` 已在用它做 VIP 校验），⛔ 别从 Cookie 里猜。

/** 构造「用户歌单列表」请求体（weapi/user/playlist） */
export function buildUserPlaylistBody(uid: string, limit = 1000, offset = 0): string {
    return JSON.stringify({ uid, limit, offset, includeVideo: true })
}

/** 用户歌单一项 */
export interface NeteaseUserPlaylist {
    id: string
    name: string
    coverUrl?: string
    /** 曲目数（平台没给 ⇒ undefined，⛔ 不写 0） */
    trackCount?: number
    /** 是否「我喜欢的音乐」这种收藏型清单（`specialType === 5`，或名字就是它） */
    liked: boolean
}

/**
 * 解析「用户歌单列表」响应：`playlist[]` 含 id / name / coverImgUrl / trackCount。
 *
 * ⛔ 返回 `{ code, playlists }` 而不是裸数组：调用方要能分辨「没登录（code 301）」
 *    与「真的没有歌单（code 200 + 空数组）」，这两种情况的文案完全不同。
 */
export function parseUserPlaylists(raw: string): { code: number; playlists: NeteaseUserPlaylist[] } {
    try {
        const data = JSON.parse(raw)
        const code = Number(data?.code ?? 0)
        if (code !== 200) return { code, playlists: [] }
        const list = data?.playlist
        if (!Array.isArray(list)) return { code, playlists: [] }
        const playlists = list
            .map((it: any): NeteaseUserPlaylist | null => {
                const id = String(it?.id ?? '')
                const name = String(it?.name ?? '')
                if (!id || !name) return null
                const trackCount = Number(it?.trackCount)
                return {
                    id,
                    name,
                    coverUrl: it?.coverImgUrl || undefined,
                    // ⚠️ `Number(undefined)` 是 NaN ⇒ 必须显式判有限正数，⛔ 不能 `?? 0`
                    trackCount: Number.isFinite(trackCount) && trackCount >= 0 ? trackCount : undefined,
                    liked: Number(it?.specialType) === 5 || name === '我喜欢的音乐',
                }
            })
            .filter((x: NeteaseUserPlaylist | null): x is NeteaseUserPlaylist => x !== null)
        return { code, playlists }
    } catch {
        return { code: 0, playlists: [] }
    }
}

/** 解析批量歌曲详情响应：songs[] 含 id/name/ar[].name/al.name+picUrl/dt + h/m/l 音质档（size/br），映射为可下载歌曲 */
export function parseSongDetailSongs(raw: string): Array<{ id: number; name: string; artist: string; album?: string; coverUrl?: string; duration?: number; fee?: number; size?: number; bitrate?: number }> {
    try {
        const data = JSON.parse(raw)
        const list = data?.songs
        if (!Array.isArray(list)) return []
        type Song = { id: number; name: string; artist: string; album?: string; coverUrl?: string; duration?: number; fee?: number; size?: number; bitrate?: number }
        const map = (s: any): Song | null => {
            const id = Number(s?.id ?? 0)
            const name: string = s?.name ?? ''
            if (!id || !name) return null
            const artist = Array.isArray(s?.ar)
                ? (s.ar as Array<{ name?: string }>).map((a) => a?.name ?? '').filter(Boolean).join('/')
                : ''
            // 行内显示实际下载档位：无 Cookie 外链为标准 128k（l 档），不虚标最高码率（h/m）
            const lObj = s?.l
            const lSize = Number(lObj?.size ?? 0)
            const size = lSize > 0 ? lSize : undefined
            const lBr = Number(lObj?.br ?? 0)
            const bitrate = lSize > 0 && lBr > 0 ? Math.round(lBr / 1000) : undefined
            return {
                id,
                name,
                artist,
                album: s?.al?.name || undefined,
                coverUrl: s?.al?.picUrl || undefined,
                duration: Number(s?.dt) > 0 ? Math.round(Number(s.dt) / 1000) : undefined,
                fee: typeof s?.fee === 'number' ? s.fee : undefined,
                size,
                bitrate,
            }
        }
        return list.map(map).filter((x): x is Song => x !== null)
    } catch {
        return []
    }
}
