// ⬇️ 2026-09-28 移植自 obsidian-lyricflux/tests/kuwo-music.test.ts（同作者；仅改导入路径为 pure/dl/*）。
import { describe, it, expect } from 'vitest'
import {
    buildKuwoSearchUrl,
    parseKuwoSearchResponse,
    buildKuwoMobiUrl,
    makeKuwoUser,
    parseKuwoMobiResponse,
    KUWO_QUALITIES,
    parseKuwoMInfo,
    buildKuwoRcmPlaylistUrl,
    parseKuwoRcmPlaylist,
    buildKuwoPlaylistDetailUrl,
    parseKuwoPlaylistDetail,
    buildKuwoLyricUrl,
    parseKuwoLyricResponse,
} from 'pure/dl/kuwo'

describe('酷我搜索 URL 构造（buildKuwoSearchUrl）', () => {
    it('带 keyword + ft=music', () => {
        const url = buildKuwoSearchUrl('晴天 周杰伦', 20)
        expect(url).toContain('www.kuwo.cn/search/searchMusicBykeyWord?')
        expect(url).toContain('all=' + encodeURIComponent('晴天 周杰伦'))
        expect(url).toContain('ft=music')
        expect(url).toContain('rn=20')
    })
})

describe('酷我搜索响应解析（parseKuwoSearchResponse）', () => {
    it('解析 legacy 单引号 JSON，去 MUSIC_ 前缀，过滤 bitSwitch=0', () => {
        // 酷我 legacy 接口返回单引号包裹的 JSON（键和字符串值都是单引号）
        const raw = "{'abslist':[{'MUSICRID':'MUSIC_228908','SONGNAME':'晴天','ARTIST':'周杰伦','ALBUM':'叶惠美','bitSwitch':81920},{'MUSICRID':'MUSIC_999','SONGNAME':'坏歌','ARTIST':'x','bitSwitch':0},{'MUSICRID':'MUSIC_888','SONGNAME':'歌','ARTIST':'y','bitSwitch':123}]}"
        const songs = parseKuwoSearchResponse(raw)
        expect(songs).toHaveLength(2)
        expect(songs[0]).toEqual({
            rid: '228908',
            name: '晴天',
            artist: '周杰伦',
            album: '叶惠美',
            bitSwitch: 81920,
        })
        expect(songs[1].rid).toBe('888')
        expect(songs[1].album).toBeUndefined()
    })

    it('缺 rid / 空 SONGNAME 过滤，异常响应返回空', () => {
        expect(parseKuwoSearchResponse('bad json')).toEqual([])
        expect(parseKuwoSearchResponse("{'abslist':[{'MUSICRID':'','SONGNAME':'x'}]}")).toEqual([])
        expect(parseKuwoSearchResponse("{'abslist':[{'MUSICRID':'MUSIC_1','SONGNAME':''}]}")).toEqual([])
    })

    it('MINFO 存在时 format 写入（格式胶囊用）：mp3 128 优先 → mp3；仅 flac → flac', () => {
        const rawMp3 = JSON.stringify({ abslist: [{ MUSICRID: 'MUSIC_1', SONGNAME: '晴天', ARTIST: '周杰伦', bitSwitch: 81920, MINFO: 'level:ff,bitrate:2000,format:flac,size:52.83Mb;level:h,bitrate:128,format:mp3,size:4.12Mb' }] })
        const rawFlac = JSON.stringify({ abslist: [{ MUSICRID: 'MUSIC_2', SONGNAME: '纯flac', ARTIST: 'x', bitSwitch: 81920, MINFO: 'level:ff,bitrate:2000,format:flac,size:52.83Mb' }] })
        const s1 = parseKuwoSearchResponse(rawMp3)[0]
        expect(s1.format).toBe('mp3')
        expect(s1.bitrate).toBe(128)
        const s2 = parseKuwoSearchResponse(rawFlac)[0]
        expect(s2.format).toBe('flac')
        expect(s2.bitrate).toBe(2000)
    })

    it('标准双引号 JSON 含撇号歌名（如 it’s）也能解析——修复酷我消失 bug', () => {
        // 真实响应是标准 JSON，歌曲名/别名可能含撇号 `'`，旧逻辑无条件 replace 会破坏 JSON
        const raw = JSON.stringify({
            abslist: [
                { MUSICRID: 'MUSIC_123', SONGNAME: "It's My Life", ARTIST: 'Bon Jovi', bitSwitch: 81920 },
                { MUSICRID: 'MUSIC_456', SONGNAME: 'Shape of You', ARTIST: 'Ed Sheeran', bitSwitch: 81920 },
            ],
        })
        const songs = parseKuwoSearchResponse(raw)
        expect(songs).toHaveLength(2)
        expect(songs[0].name).toBe("It's My Life")
        expect(songs[1].rid).toBe('456')
    })

    it('legacy 单引号 JSON 仍兼容', () => {
        const raw = "{'abslist':[{'MUSICRID':'MUSIC_1','SONGNAME':'晴天','ARTIST':'周杰伦','bitSwitch':81920}]}"
        const songs = parseKuwoSearchResponse(raw)
        expect(songs).toHaveLength(1)
        expect(songs[0].name).toBe('晴天')
    })

    it('解析 DURATION / MINFO / 封面', () => {
        const raw = "{'abslist':[{'MUSICRID':'MUSIC_1','SONGNAME':'晴天','ARTIST':'周杰伦','DURATION':'269','bitSwitch':81920,'MINFO':'level:ff,bitrate:2000,format:flac,size:52.83Mb;level:h,bitrate:128,format:mp3,size:4.12Mb','hts_MVPIC':'https://img.kuwo.cn/1.jpg'}]}"
        const songs = parseKuwoSearchResponse(raw)
        expect(songs[0].duration).toBe(269)
        // mp3 128 档优先：size=4.12MB
        expect(songs[0].size).toBe(Math.round(4.12 * 1024 * 1024))
        expect(songs[0].bitrate).toBe(128)
        expect(songs[0].coverUrl).toBe('https://img.kuwo.cn/1.jpg')
    })
})

describe('酷我 MINFO 解析（parseKuwoMInfo）', () => {
    it('mp3 128 档优先于 flac', () => {
        const r = parseKuwoMInfo('level:ff,bitrate:2000,format:flac,size:52.83Mb;level:h,bitrate:128,format:mp3,size:4.12Mb')
        expect(r.bitrate).toBe(128)
        expect(r.size).toBe(Math.round(4.12 * 1024 * 1024))
    })

    it('无 mp3 128 时取 mp3 320，再取 flac，最后取最大档', () => {
        expect(parseKuwoMInfo('level:p,bitrate:320,format:mp3,size:10.29Mb').bitrate).toBe(320)
        expect(parseKuwoMInfo('level:ff,bitrate:2000,format:flac,size:52.83Mb').bitrate).toBe(2000)
        const max = parseKuwoMInfo('level:l,bitrate:48,format:aac,size:1.57Mb;level:h,bitrate:128,format:mp3,size:4.12Mb')
        expect(max.size).toBe(Math.round(4.12 * 1024 * 1024))
    })

    it('空/非法 MINFO 返回 0', () => {
        expect(parseKuwoMInfo('')).toEqual({ size: 0, bitrate: 0, format: '' })
        expect(parseKuwoMInfo('garbage')).toEqual({ size: 0, bitrate: 0, format: '' })
    })
})

describe('酷我下载直链（mobi.s）', () => {
    it('buildKuwoMobiUrl 带 rid/br/user + 车载 source', () => {
        const url = buildKuwoMobiUrl('228908', '128kmp3', 'C_APK_guanwang_x')
        expect(url).toContain('mobi.kuwo.cn/mobi.s?')
        expect(url).toContain('type=convert_url_with_sign')
        expect(url).toContain('source=kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk')
        expect(url).toContain('br=128kmp3')
        expect(url).toContain('rid=228908')
        expect(url).toContain('user=C_APK_guanwang_x')
    })

    it('KUWO_QUALITIES 从低到高含 128/320/flac', () => {
        expect(KUWO_QUALITIES).toEqual(['128kmp3', '320kmp3', 'flac'])
    })

    it('makeKuwoUser 生成 C_APK_guanwang_ 前缀随机标识', () => {
        const u1 = makeKuwoUser()
        const u2 = makeKuwoUser()
        expect(u1).toMatch(/^C_APK_guanwang_\d+$/)
        expect(u1).not.toBe(u2)
    })

    it('parseKuwoMobiResponse 提取 data.url；空/非法返回空 url', () => {
        expect(parseKuwoMobiResponse(JSON.stringify({ data: { url: 'http://cdn/a.mp3', bitrate: 128, format: 'mp3' } })))
            .toEqual({ url: 'http://cdn/a.mp3', bitrate: 128, format: 'mp3' })
        expect(parseKuwoMobiResponse(JSON.stringify({ data: { url: '' } }))).toEqual({ url: '' })
        expect(parseKuwoMobiResponse('bad')).toEqual({ url: '' })
    })
})

describe('酷我推荐歌单（v1.4.2 多源推荐）', () => {
    it('buildKuwoRcmPlaylistUrl 构造 wapi getRcmPlayList URL（appUid 固定）', () => {
        const url = buildKuwoRcmPlaylistUrl(1, 30)
        expect(url).toContain('wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList')
        expect(url).toContain('appUid=38668888')
        expect(url).toContain('pn=1')
        expect(url).toContain('rn=30')
        expect(url).toContain('order=new')
    })

    it('parseKuwoRcmPlaylist 提取 id/歌单名/封面/播放数/歌曲数(字符串转数字)/创建者', () => {
        const raw = JSON.stringify({
            code: 200,
            data: {
                data: [
                    { id: 3601256457, name: '俄语小调', img: 'http://img1.kwcdn.kuwo.cn/c.jpg', listencnt: '54655', total: '42', uname: '诗情画意' },
                    { id: 3677488020, name: '爱的故事', listencnt: '3509889', total: '0' },
                    { id: '', name: '无 id 丢弃' },
                ],
            },
        })
        expect(parseKuwoRcmPlaylist(raw)).toEqual([
            { id: '3601256457', name: '俄语小调', coverUrl: 'http://img1.kwcdn.kuwo.cn/c.jpg', playCount: 54655, trackCount: 42, creator: '诗情画意' },
            { id: '3677488020', name: '爱的故事', coverUrl: undefined, playCount: 3509889, trackCount: undefined, creator: undefined },
        ])
    })

    it('parseKuwoRcmPlaylist 非 200/异常/无 data.data 返回空', () => {
        expect(parseKuwoRcmPlaylist(JSON.stringify({ code: 400 }))).toEqual([])
        expect(parseKuwoRcmPlaylist(JSON.stringify({ code: 200, data: {} }))).toEqual([])
        expect(parseKuwoRcmPlaylist('bad')).toEqual([])
    })

    it('buildKuwoPlaylistDetailUrl 构造 nplserver pl.svc URL（rn=500 默认拉全量）', () => {
        const url = buildKuwoPlaylistDetailUrl('910553346')
        expect(url).toContain('nplserver.kuwo.cn/pl.svc')
        expect(url).toContain('op=getlistinfo')
        expect(url).toContain('pid=910553346')
        expect(url).toContain('encode=utf8')
        expect(url).toContain('keyset=pl2012')
        expect(url).toContain('rn=500')
    })

    it('parseKuwoPlaylistDetail 提取 id→rid/歌名/歌手/时长/封面 + MINFO 音质档；无 id 丢弃', () => {
        const raw = JSON.stringify({
            musiclist: [
                { id: '7119332', name: '刚刚好', artist: '薛之谦', duration: '250', album: '初学者', albumpic: 'http://img1.kuwo.cn/albumcover/120/82/10/1.jpg', MINFO: 'level:p,bitrate:320,format:mp3,size:9.55Mb;level:s,bitrate:48,format:aac,size:1.45Mb' },
                { id: '7119333', name: '无封面', artist: '测试' },
                { id: '', name: '无 id 丢弃' },
            ],
        })
        expect(parseKuwoPlaylistDetail(raw)).toEqual([
            // MINFO mp3 320k 档：size≈10MB / bitrate 320 / format=mp3
            { rid: '7119332', name: '刚刚好', artist: '薛之谦', album: '初学者', duration: 250, coverUrl: 'http://img1.kuwo.cn/albumcover/120/82/10/1.jpg', size: Math.round(9.55 * 1024 * 1024), bitrate: 320, format: 'mp3' },
            // 无 MINFO → size/bitrate/format 缺省
            { rid: '7119333', name: '无封面', artist: '测试', album: undefined, duration: undefined, coverUrl: undefined },
        ])
    })

    it('parseKuwoPlaylistDetail 异常/无 musiclist 返回空', () => {
        expect(parseKuwoPlaylistDetail('bad')).toEqual([])
        expect(parseKuwoPlaylistDetail(JSON.stringify({ musiclist: [] }))).toEqual([])
    })
})

describe('酷我歌词（songinfoandlrc）', () => {
    it('buildKuwoLyricUrl 带 musicId + httpsStatus=1', () => {
        const url = buildKuwoLyricUrl('228908')
        expect(url).toContain('m.kuwo.cn/newh5/singles/songinfoandlrc')
        expect(url).toContain('musicId=228908')
        expect(url).toContain('httpsStatus=1')
    })

    it('parseKuwoLyricResponse 拼接 lrclist 为 LRC', () => {
        const raw = JSON.stringify({
            data: { lrclist: [
                { lineLyric: '晴天 - 周杰伦', time: '0.0' },
                { lineLyric: '词：周杰伦', time: '2.25' },
                { lineLyric: '曲：周杰伦', time: '4.5' },
            ] },
        })
        expect(parseKuwoLyricResponse(raw)).toBe('[00:00.00]晴天 - 周杰伦\n[00:02.25]词：周杰伦\n[00:04.50]曲：周杰伦')
    })

    it('parseKuwoLyricResponse 无有效时间戳的行保留原文', () => {
        const raw = JSON.stringify({ data: { lrclist: [{ lineLyric: '无时间戳行', time: '' }] } })
        expect(parseKuwoLyricResponse(raw)).toBe('无时间戳行')
    })

    it('parseKuwoLyricResponse 空 lrclist/异常返回 null', () => {
        expect(parseKuwoLyricResponse('bad')).toBeNull()
        expect(parseKuwoLyricResponse(JSON.stringify({ data: { lrclist: [] } }))).toBeNull()
        expect(parseKuwoLyricResponse(JSON.stringify({ data: {} }))).toBeNull()
    })
})
