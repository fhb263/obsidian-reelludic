// ⬇️ 2026-09-28 移植自 obsidian-lyricflux/tests/netease-crypto.test.ts（同作者；仅改导入路径为 pure/dl/*）。
import { describe, it, expect } from 'vitest'
import {
    aesEncryptCBC,
    aesEncryptECB,
    rsaEncrypt,
    encryptWeApi,
    encryptEApi,
    parseVipAccountResponse,
    buildRecommendedPlaylistsBody,
    parseRecommendedPlaylists,
    buildPlaylistDetailBody,
    parsePlaylistTrackIds,
    buildSongDetailBody,
    parseSongDetailSongs,
} from 'pure/dl/neteaseCrypto'
import { md5hex } from 'pure/dl/kugou'

describe('网易云 weapi 加密', () => {
    it('AES-128-CBC 向量（与 Go/Python 对拍）', () => {
        const out = aesEncryptCBC('{"ids":["186016"],"br":320000}', '0CoJUm6Qyw8W8jud', '0102030405060708')
        expect(out).toBe('/al0xIK9TcXSqA0ugFowGLe7kJYy3DzhrGlSOtCdVJA=')
    })

    it('RSA 模幂输出 256 位 hex（固定 secKey 对拍）', () => {
        const out = rsaEncrypt('aB3dEfGhIjKlMnOp')
        expect(out).toHaveLength(256)
        expect(out).toMatch(/^[0-9a-f]+$/)
        // 与 Python pow(int(rev_hex,16), 0x10001, modulus) 前 24 位一致
        expect(out.slice(0, 24)).toBe('a92f8f74bf53273498a30fa0')
    })

    it('encryptWeApi 返回合法 params/encSecKey', () => {
        const { params, encSecKey } = encryptWeApi('{"csrf_token":""}')
        expect(params).toMatch(/^[A-Za-z0-9+/=]+$/) // base64
        expect(encSecKey).toHaveLength(256)
        expect(encSecKey).toMatch(/^[0-9a-f]+$/)
        // 两次随机调用不同
        const { params: p2 } = encryptWeApi('{}')
        expect(p2).not.toBe(params)
    })
})

describe('网易云 eapi 加密', () => {
    it('EAPI 向量（与 Go/Python 对拍）', () => {
        const path = '/eapi/song/enhance/player/url/v1'
        const payload = '{"ids":[186016],"level":"lossless","encodeType":"flac","header":"{\\"os\\":\\"pc\\"}"}'
        const out = encryptEApi(path, payload)
        // md5 摘要对拍
        const digest = md5hex(`nobody${path.replace('/eapi/', '/api/')}use${payload}md5forencrypt`)
        expect(digest).toBe('13e9dda75927ca1c5f2078a908779d5c')
        // AES-ECB 输出对拍（前 32 位）
        expect(out.slice(0, 32)).toBe('fa90b329e9614f79e79598f37dc2edb4')
        expect(out).toMatch(/^[0-9a-f]+$/)
    })

    it('aesEncryptECB 输出小写 hex', () => {
        const out = aesEncryptECB('test', 'e82ckenh8dichen8')
        expect(out).toMatch(/^[0-9a-f]+$/)
        expect(out.length % 32).toBe(0) // 16 字节块 = 32 hex
    })
})

describe('网易云 VIP 响应解析', () => {
    it('VIP 账号（vipType≠0 + code 200）', () => {
        expect(parseVipAccountResponse(JSON.stringify({ code: 200, profile: { vipType: 11 } })))
            .toEqual({ ok: true, vipType: 11 })
    })

    it('普通账号（登录有效但非会员，ok 仍为 true，vipType 单独标记）/ 未登录 / 异常', () => {
        expect(parseVipAccountResponse(JSON.stringify({ code: 200, profile: { vipType: 0 } })))
            .toEqual({ ok: true, vipType: 0 })
        expect(parseVipAccountResponse(JSON.stringify({ code: 301 })))
            .toEqual({ ok: false, vipType: 0 })
        expect(parseVipAccountResponse('bad')).toEqual({ ok: false, vipType: 0 })
    })
})

describe('网易云推荐歌单（v1.4.2 首屏）', () => {
    it('buildRecommendedPlaylistsBody 构造 limit 请求体', () => {
        expect(JSON.parse(buildRecommendedPlaylistsBody(30)))
            .toEqual({ limit: 30, total: true, n: 1000 })
        expect(JSON.parse(buildRecommendedPlaylistsBody())).toHaveProperty('limit', 30)
    })

    it('parseRecommendedPlaylists 提取 id/name/封面/播放数/歌曲数', () => {
        const raw = JSON.stringify({
            code: 200,
            result: [
                { id: 1001, name: '华语热歌', picUrl: 'https://p.music.163.com/c.jpg', playCount: 1234567, trackCount: 50, copywriter: '编辑精选' },
                { id: 1002, name: '雨天适合听的歌', trackCount: 20 },
                { id: '', name: '无 id 丢弃' },
                { name: '无 id 丢弃2' },
            ],
        })
        expect(parseRecommendedPlaylists(raw)).toEqual([
            { id: '1001', name: '华语热歌', coverUrl: 'https://p.music.163.com/c.jpg', playCount: 1234567, trackCount: 50, copywriter: '编辑精选' },
            { id: '1002', name: '雨天适合听的歌', coverUrl: undefined, playCount: 0, trackCount: 20, copywriter: undefined },
        ])
    })

    it('parseRecommendedPlaylists 异常/非 200 返回空', () => {
        expect(parseRecommendedPlaylists(JSON.stringify({ code: 301 }))).toEqual([])
        expect(parseRecommendedPlaylists(JSON.stringify({ code: 200, result: 'x' }))).toEqual([])
        expect(parseRecommendedPlaylists('bad')).toEqual([])
    })
})

describe('网易云歌单详情 / 歌曲详情（v1.4.2）', () => {
    it('buildPlaylistDetailBody 构造 n=0 详情请求体', () => {
        expect(JSON.parse(buildPlaylistDetailBody('2333')))
            .toEqual({ id: '2333', n: 0, csrf_token: '' })
    })

    it('parsePlaylistTrackIds 提取 trackIds 字符串数组', () => {
        const raw = JSON.stringify({ code: 200, playlist: { trackIds: [{ id: 1 }, { id: 2 }, {}, { id: 0 }] } })
        expect(parsePlaylistTrackIds(raw)).toEqual(['1', '2', '0'])
    })

    it('parsePlaylistTrackIds 异常/非 200 返回空', () => {
        expect(parsePlaylistTrackIds(JSON.stringify({ code: 301 }))).toEqual([])
        expect(parsePlaylistTrackIds(JSON.stringify({ code: 200, playlist: {} }))).toEqual([])
        expect(parsePlaylistTrackIds('bad')).toEqual([])
    })

    it('buildSongDetailBody 构造 c/ids 批量请求体', () => {
        const body = JSON.parse(buildSongDetailBody(['1', '2']))
        expect(body).toEqual({ c: '[{"id":"1"},{"id":"2"}]', ids: '["1","2"]' })
    })

    it('parseSongDetailSongs 提取歌名/艺术家/专辑/时长/fee + h/m/l 音质档', () => {
        const raw = JSON.stringify({
            code: 200,
            songs: [
                {
                    id: 1, name: '晴天', dt: 269000, fee: 1,
                    ar: [{ name: '周杰伦' }, { name: '合唱' }],
                    al: { name: '叶惠美', picUrl: 'https://p.music.163.com/c.jpg' },
                    h: { br: 320000, size: 25106383 },
                    m: { br: 192000, size: 15006383 },
                    l: { br: 128000, size: 10006383 },
                },
                { id: 2, name: '无艺术家', dt: 0, l: { br: 128000, size: 500000 } },
                { id: 3, name: '无音质档', dt: 1000, h: null },
                { id: 0, name: '无 id 丢弃' },
                { name: '无 id 丢弃2' },
            ],
        })
        expect(parseSongDetailSongs(raw)).toEqual([
            // 行内显示实际下载档（l 档 128k），不虚标 h/m
            { id: 1, name: '晴天', artist: '周杰伦/合唱', album: '叶惠美', coverUrl: 'https://p.music.163.com/c.jpg', duration: 269, fee: 1, size: 10006383, bitrate: 128 },
            { id: 2, name: '无艺术家', artist: '', album: undefined, coverUrl: undefined, duration: undefined, fee: undefined, size: 500000, bitrate: 128 },
            // 无有效音质档 → size/bitrate 缺省
            { id: 3, name: '无音质档', artist: '', album: undefined, coverUrl: undefined, duration: 1, fee: undefined },
        ])
    })

    it('parseSongDetailSongs 异常/非 songs 返回空', () => {
        expect(parseSongDetailSongs(JSON.stringify({ code: 301 }))).toEqual([])
        expect(parseSongDetailSongs(JSON.stringify({ code: 200, songs: 'x' }))).toEqual([])
        expect(parseSongDetailSongs('bad')).toEqual([])
    })
})
