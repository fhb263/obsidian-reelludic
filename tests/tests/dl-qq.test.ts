// ⬇️ 2026-09-28 移植自 obsidian-lyricflux/tests/qq-music.test.ts（同作者；仅改导入路径为 pure/dl/*）。
import { describe, it, expect } from 'vitest'
import {
    buildQqSearchUrl,
    parseQqSearchResponse,
    makeGuid,
    buildQqVkeyBody,
    buildQqVkeyUrl,
    parseQqPurl,
    extractQqUin,
    buildQqUserInfoBody,
    buildQqUserInfoUrl,
    parseQqUserInfo,
    buildQqDissListUrl,
    parseQqDissList,
    buildQqDissDetailUrl,
    parseQqDissDetail,
    QQ_MUSICU_URL,
    buildQqDissDetailV2Body,
    parseQqDissDetailV2,
    buildQqDissCountsBody,
    parseQqDissCounts,
    buildQqLyricUrl,
    parseQqLyricResponse,
} from 'pure/dl/qq'

describe('QQ 搜索响应解析（parseQqSearchResponse）', () => {
    it('解析纯 JSON', () => {
        const raw = JSON.stringify({
            data: {
                song: {
                    list: [
                        { songmid: 'AAA', songname: '晴天', singer: [{ name: '周杰伦' }], albumname: '叶惠美' },
                        { songmid: 'BBB', songname: '晴天 (Live)', singer: [{ name: '周杰伦' }] },
                    ],
                },
            },
        })
        const songs = parseQqSearchResponse(raw)
        expect(songs).toHaveLength(2)
        expect(songs[0]).toEqual({ songmid: 'AAA', name: '晴天', artist: '周杰伦', album: '叶惠美', vipOnly: false })
        expect(songs[1].album).toBeUndefined()
        expect(songs[1].vipOnly).toBe(false)
    })

    it('解析 JSONP 包裹（MusicJsonCallback({...})）', () => {
        const inner = JSON.stringify({ data: { song: { list: [{ songmid: 'C', songname: '稻香', singer: [] }] } } })
        const songs = parseQqSearchResponse(`MusicJsonCallback(${inner});`)
        expect(songs).toHaveLength(1)
        expect(songs[0].songmid).toBe('C')
        expect(songs[0].artist).toBe('')
    })

    it('缺 songmid/name 的行过滤，异常响应返回空', () => {
        expect(parseQqSearchResponse('not json')).toEqual([])
        expect(parseQqSearchResponse(JSON.stringify({ data: {} }))).toEqual([])
        expect(
            parseQqSearchResponse(JSON.stringify({ data: { song: { list: [{ songname: 'x' }] } } })),
        ).toEqual([])
    })

    it('pay.dowload=1 标为 vipOnly（下载受限）、100 也标（付费单曲）、可免费下载为 false', () => {
        const raw = JSON.stringify({
            data: {
                song: {
                    list: [
                        { songmid: 'V', songname: 'VIP歌', pay: { dowload: 1 } },
                        { songmid: 'P', songname: '付费单曲', pay: { dowload: 100 } },
                        { songmid: 'F', songname: '可免费下', pay: { dowload: 0 } },
                        { songmid: 'N', songname: '无pay字段' },
                    ],
                },
            },
        })
        const songs = parseQqSearchResponse(raw)
        expect(songs).toHaveLength(4)
        expect(songs[0].vipOnly).toBe(true)
        expect(songs[1].vipOnly).toBe(true)
        expect(songs[2].vipOnly).toBe(false)
        expect(songs[3].vipOnly).toBe(false)
    })

    it('解析 interval / size / bitrate / 封面（显示实际下载档 128k，不虚标最高档）', () => {
        const raw = JSON.stringify({
            data: {
                song: {
                    list: [
                        { songmid: 'Q1', songname: '晴天', interval: 269, size128: 4317292, size320: 10792943, sizeflac: 55397039, albummid: '000MkMni19ClKG' },
                        { songmid: 'Q2', songname: '只到128', interval: 180, size128: 2880000, size320: 0, sizeflac: 0, albummid: '' },
                    ],
                },
            },
        })
        const songs = parseQqSearchResponse(raw)
        expect(songs[0].duration).toBe(269)
        expect(songs[0].size).toBe(4317292)
        expect(songs[0].bitrate).toBe(128)
        expect(songs[0].coverUrl).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg')
        expect(songs[1].size).toBe(2880000)
        expect(songs[1].bitrate).toBe(128)
        expect(songs[1].coverUrl).toBeUndefined()
    })

    it('ext 格式胶囊推断：有 mp3 档 → mp3；否则 flac → flac；否则 aac/m4a → m4a；均无 undefined', () => {
        const raw = JSON.stringify({
            data: {
                song: {
                    list: [
                        { songmid: 'A', songname: '有128', size128: 100, size320: 200, sizeflac: 300 },
                        { songmid: 'B', songname: '仅flac', size128: 0, size320: 0, sizeflac: 500 },
                        { songmid: 'C', songname: '仅m4a', size128: 0, size320: 0, sizeflac: 0, sizeaac: 400 },
                        { songmid: 'D', songname: '无档位' },
                    ],
                },
            },
        })
        const songs = parseQqSearchResponse(raw)
        expect(songs[0].ext).toBe('mp3')
        expect(songs[1].ext).toBe('flac')
        expect(songs[2].ext).toBe('m4a')
        expect(songs[3].ext).toBeUndefined()
    })
})

describe('QQ 下载请求构造', () => {
    it('buildQqSearchUrl 带 keyword', () => {
        expect(buildQqSearchUrl('晴天 周杰伦')).toBe(
            'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6&format=json&n=20&p=1',
        )
    })

    it('makeGuid 生成 32 位十六进制', () => {
        expect(makeGuid()).toMatch(/^[0-9a-f]{32}$/)
        expect(makeGuid()).not.toBe(makeGuid())
    })

    it('buildQqVkeyBody 含 songmid/guid/uin', () => {
        const body = buildQqVkeyBody('AAA', '0123456789abcdef0123456789abcdef', '12345')
        expect(body).toContain('"songmid":["AAA"]')
        expect(body).toContain('"guid":"0123456789abcdef0123456789abcdef"')
        expect(body).toContain('"uin":"12345"')
        expect(() => JSON.parse(body)).not.toThrow()
    })

    it('buildQqVkeyUrl 编码 data', () => {
        const url = buildQqVkeyUrl('{"a":1}')
        expect(url).toContain('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=')
        expect(decodeURIComponent(url.split('data=')[1])).toBe('{"a":1}')
    })

    it('parseQqPurl 提取 purl，空权限返回空串', () => {
        const ok = JSON.stringify({ req_0: { data: { midurlinfo: [{ purl: '/xxx.mp3' }] } } })
        expect(parseQqPurl(ok)).toBe('/xxx.mp3')
        expect(parseQqPurl('{"req_0":{"data":{"midurlinfo":[{"purl":""}]}}}')).toBe('')
        expect(parseQqPurl('bad')).toBe('')
    })

    it('extractQqUin 从 Cookie 提取 uin（含 o 前缀）', () => {
        expect(extractQqUin('uin=o123456; qqmusic_key=abc')).toBe('123456')
        expect(extractQqUin('foo=1; uin=987')).toBe('987')
        expect(extractQqUin('no uin here')).toBe('')
    })
})

describe('QQ 测试连接（GetUserInfo）', () => {
    it('buildQqUserInfoBody 含 GetUserInfo 模块', () => {
        const body = buildQqUserInfoBody('12345')
        expect(body).toContain('"module":"music.homepage.FcgiGetUserInfo"')
        expect(body).toContain('"method":"GetUserInfo"')
        expect(body).toContain('"uin":"12345"')
        expect(() => JSON.parse(body)).not.toThrow()
    })

    it('buildQqUserInfoUrl 编码 data', () => {
        const url = buildQqUserInfoUrl('12345')
        expect(url).toContain('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=')
        expect(decodeURIComponent(url.split('data=')[1])).toContain('GetUserInfo')
    })

    it('parseQqUserInfo 有效/无效/异常', () => {
        expect(parseQqUserInfo(JSON.stringify({ req_1: { code: 0 } }))).toEqual({ ok: true, code: 0 })
        expect(parseQqUserInfo(JSON.stringify({ req_1: { code: 500003 } }))).toEqual({ ok: false, code: 500003 })
        expect(parseQqUserInfo(JSON.stringify({ req_1: { code: 0, data: { uin: '1' } } }))).toEqual({ ok: true, code: 0 })
        expect(parseQqUserInfo('bad')).toEqual({ ok: false, code: -1 })
        expect(parseQqUserInfo(JSON.stringify({}))).toEqual({ ok: false, code: -1 })
    })
})

describe('QQ 推荐歌单（v1.4.2 多源推荐）', () => {
    it('buildQqDissListUrl 构造 fcg_get_diss_by_tag URL（免登录，categoryId/sortId/sin/ein）', () => {
        const url = buildQqDissListUrl(0, 29)
        expect(url).toContain('fcg_get_diss_by_tag.fcg')
        expect(url).toContain('categoryId=10000000')
        expect(url).toContain('sortId=5')
        expect(url).toContain('sin=0')
        expect(url).toContain('ein=29')
        expect(url).toContain('g_tk=5381')
    })

    it('parseQqDissList 提取 dissid/name/封面/播放数；无 dissid 丢弃', () => {
        const raw = JSON.stringify({
            code: 0,
            data: {
                list: [
                    { dissid: '7707261125', dissname: '甜度爆表', imgurl: 'http://qpic.y.qq.com/c.jpg', listennum: 8544497 },
                    { dissid: '7578943835', dissname: '丧系Rap', listennum: 1812477 },
                    { dissid: '', dissname: '无 id 丢弃' },
                    { dissname: '无 id 丢弃2' },
                ],
            },
        })
        expect(parseQqDissList(raw)).toEqual([
            { id: '7707261125', name: '甜度爆表', coverUrl: 'http://qpic.y.qq.com/c.jpg', playCount: 8544497 },
            { id: '7578943835', name: '丧系Rap', coverUrl: undefined, playCount: 1812477 },
        ])
    })

    it('parseQqDissList 兼容 JSONP / 非 code 0 / 异常', () => {
        const raw = JSON.stringify({ code: 0, data: { list: [{ dissid: '1', dissname: 'a' }] } })
        expect(parseQqDissList(`MusicJsonCallback(${raw})`)).toHaveLength(1)
        expect(parseQqDissList(JSON.stringify({ code: -1 }))).toEqual([])
        expect(parseQqDissList(JSON.stringify({ code: 0, data: {} }))).toEqual([])
        expect(parseQqDissList('bad')).toEqual([])
    })

    it('buildQqDissDetailUrl 构造歌单歌曲 URL（onlysong=1）', () => {
        const url = buildQqDissDetailUrl('7707261125')
        expect(url).toContain('fcg_ucc_getcdinfo_byids_cp.fcg')
        expect(url).toContain('onlysong=1')
        expect(url).toContain('disstid=7707261125')
    })

    it('parseQqDissDetail 映射 songmid/歌手/时长/大小/封面/VIP；无 songmid 丢弃', () => {
        const raw = JSON.stringify({
            code: 0,
            cdlist: [{
                songlist: [
                    {
                        songmid: '001tjXes2c6Uog', songname: '自渡', interval: 142,
                        singer: [{ name: '烟嗓船长' }, { name: '合唱' }],
                        albummid: '000Qna5A49InKV', albumname: '自渡（烟嗓版）',
                        size128: 2276407, size320: 5690716, sizeflac: 0,
                        pay: { dowload: 0 },
                    },
                    {
                        songmid: '000b3wiQ3z0VbG', songname: 'VIP 歌', interval: 200,
                        singer: [{ name: '测试' }], size128: 100, pay: { dowload: 1 },
                    },
                    { songmid: '', songname: '无 mid 丢弃' },
                ],
            }],
        })
        const out = parseQqDissDetail(raw)
        expect(out).toHaveLength(2)
        expect(out[0]).toMatchObject({
            songmid: '001tjXes2c6Uog',
            name: '自渡',
            artist: '烟嗓船长/合唱',
            album: '自渡（烟嗓版）',
            duration: 142,
            size: 2276407,
            bitrate: 128,
            vipOnly: false,
        })
        expect(out[0].coverUrl).toContain('000Qna5A49InKV')
        expect(out[1].vipOnly).toBe(true)
    })

    it('parseQqDissDetail 异常/无 cdlist 返回空', () => {
        expect(parseQqDissDetail('bad')).toEqual([])
        expect(parseQqDissDetail(JSON.stringify({ code: 0, cdlist: [] }))).toEqual([])
    })
})

describe('QQ 歌单歌曲 V2 回退（uniform_get_Dissinfo，fcg_ucc_getcdinfo 对用户歌单返回空时用）', () => {
    it('QQ_MUSICU_URL 指向 musicu.fcg', () => {
        expect(QQ_MUSICU_URL).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg')
    })

    it('buildQqDissDetailV2Body 构造 uniform_get_Dissinfo 请求体', () => {
        const body = JSON.parse(buildQqDissDetailV2Body('7707261125', 100))
        expect(body.req_1.module).toBe('music.srfDissInfo.aiDissInfo')
        expect(body.req_1.method).toBe('uniform_get_Dissinfo')
        expect(body.req_1.param).toMatchObject({ disstid: 7707261125, song_begin: 0, song_num: 100, onlysonglist: 0 })
        expect(body.comm).toMatchObject({ uin: 0, platform: 'yqq.json' })
    })

    it('parseQqDissDetailV2 解析 mid/name/singer/album.mid/file.size_*mp3/pay.down', () => {
        const raw = JSON.stringify({
            code: 0,
            req_1: {
                code: 0,
                data: {
                    songlist: [
                        {
                            mid: '002AkhKv0YDLIl', name: '测试歌', interval: 163,
                            singer: [{ name: '歌手A' }, { name: '歌手B' }],
                            album: { mid: '0023VbHy1oT80v', name: '测试专辑' },
                            file: { size_128mp3: 2616620, size_320mp3: 6541257, size_flac: 19372952 },
                            pay: { down: 0 },
                        },
                        {
                            mid: '002B', name: 'VIP歌', interval: 200,
                            singer: [], file: { size_128mp3: 100 }, pay: { down: 1 },
                        },
                        { mid: '', name: '无 mid 丢弃' },
                    ],
                },
            },
        })
        const out = parseQqDissDetailV2(raw)
        expect(out).toHaveLength(2)
        expect(out[0]).toMatchObject({
            songmid: '002AkhKv0YDLIl',
            name: '测试歌',
            artist: '歌手A/歌手B',
            album: '测试专辑',
            duration: 163,
            size: 2616620,
            bitrate: 128,
            vipOnly: false,
        })
        expect(out[0].coverUrl).toContain('0023VbHy1oT80v')
        expect(out[1].vipOnly).toBe(true)
    })

    it('parseQqDissDetailV2 非 req_1.code 0 / 异常 / 无 songlist 返回空', () => {
        expect(parseQqDissDetailV2(JSON.stringify({ code: 0, req_1: { code: 500003 } }))).toEqual([])
        expect(parseQqDissDetailV2(JSON.stringify({ code: 0, req_1: { code: 0, data: {} } }))).toEqual([])
        expect(parseQqDissDetailV2('bad')).toEqual([])
    })
})

describe('QQ 批量歌单歌曲数（v1.4.1 卡片一览显示「N 首」）', () => {
    it('buildQqDissCountsBody 构造多 req 请求体（song_num=1 + onlysonglist=1 最小响应）', () => {
        const body = JSON.parse(buildQqDissCountsBody(['7707261125', '7578943835', '7729596131']))
        expect(body.comm).toMatchObject({ uin: 0, platform: 'yqq.json' })
        expect(Object.keys(body).filter((k) => k.startsWith('req_'))).toHaveLength(3)
        expect(body.req_1.module).toBe('music.srfDissInfo.aiDissInfo')
        expect(body.req_1.method).toBe('uniform_get_Dissinfo')
        expect(body.req_1.param).toMatchObject({ disstid: 7707261125, song_num: 1, onlysonglist: 1 })
        expect(body.req_3.param.disstid).toBe(7729596131)
    })

    it('parseQqDissCounts 提取 total_song_num 与 ids 对应；失败/为 0 跳过', () => {
        const raw = JSON.stringify({
            req_1: { code: 0, data: { total_song_num: 66 } },
            req_2: { code: 0, data: { total_song_num: 28 } },
            req_3: { code: 500003 },
            req_4: { code: 0, data: { total_song_num: 0 } },
        })
        expect(parseQqDissCounts(raw, ['a', 'b', 'c', 'd']))
            .toEqual({ a: 66, b: 28 })
    })

    it('parseQqDissCounts 异常返回空对象', () => {
        expect(parseQqDissCounts('bad', ['a'])).toEqual({})
        expect(parseQqDissCounts(JSON.stringify({}), ['a'])).toEqual({})
    })
})

describe('QQ 歌词（fcg_query_lyric_new）', () => {
    it('buildQqLyricUrl 带 songmid + nobase64', () => {
        const url = buildQqLyricUrl('0039MnYb0qxYhV')
        expect(url).toContain('fcg_query_lyric_new.fcg')
        expect(url).toContain('songmid=0039MnYb0qxYhV')
        expect(url).toContain('nobase64=1')
        expect(url).toContain('format=json')
    })

    it('parseQqLyricResponse 返回明文 LRC', () => {
        const raw = JSON.stringify({ retcode: 0, code: 0, subcode: 0, lyric: '[00:01.00]晴天\n[00:02.00]故事的小黄花' })
        expect(parseQqLyricResponse(raw)).toBe('[00:01.00]晴天\n[00:02.00]故事的小黄花')
    })

    it('parseQqLyricResponse 处理 JSONP 包裹', () => {
        const raw = `MusicJsonCallback(${JSON.stringify({ retcode: 0, code: 0, lyric: '[00:01.00]晴天' })})`
        expect(parseQqLyricResponse(raw)).toBe('[00:01.00]晴天')
    })

    it('parseQqLyricResponse 无歌词/异常返回 null', () => {
        expect(parseQqLyricResponse(JSON.stringify({ retcode: 0, code: 0, lyric: '' }))).toBeNull()
        expect(parseQqLyricResponse(JSON.stringify({ retcode: 0, code: 0 }))).toBeNull()
        expect(parseQqLyricResponse('bad')).toBeNull()
    })
})
