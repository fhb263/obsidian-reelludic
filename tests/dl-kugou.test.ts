// ⬇️ 2026-09-28 移植自 obsidian-lyricflux/tests/kugou-music.test.ts（同作者；仅改导入路径为 pure/dl/*）。
import { describe, it, expect } from 'vitest'
import {
    buildKugouSearchUrl,
    parseKugouSearchResponse,
    cleanKugouText,
    buildKugouSongInfoUrl,
    parseKugouSongInfoResponse,
    buildKugouTrackercdnUrl,
    parseKugouTrackercdnResponse,
    md5hex,
    parseKugouRoleinfo,
    KUGOU_VIP_ROLEINFO_URL,
    buildKugouSpecialListUrl,
    parseKugouSpecialList,
    buildKugouSpecialDetailUrl,
    parseKugouSpecialDetail,
    buildKugouLyricSearchUrl,
    parseKugouLyricSearch,
    buildKugouLyricDownloadUrl,
    parseKugouLyricDownload,
} from 'pure/dl/kugou'

describe('酷狗搜索 URL 构造（buildKugouSearchUrl）', () => {
    it('带 keyword + pagesize', () => {
        const url = buildKugouSearchUrl('晴天 周杰伦', 20)
        expect(url).toContain('songsearch.kugou.com/song_search_v2?')
        expect(url).toContain('keyword=' + encodeURIComponent('晴天 周杰伦'))
        expect(url).toContain('pagesize=20')
        expect(url).toContain('platform=WebFilter')
    })
})

describe('酷狗搜索响应解析（parseKugouSearchResponse）', () => {
    it('解析正常列表并清理 <em> 标签', () => {
        const raw = JSON.stringify({
            data: {
                lists: [
                    {
                        FileHash: 'AAAA',
                        SongName: '<em>晴天</em>',
                        SingerName: '<em>周杰伦</em>',
                        AlbumName: '叶惠美',
                        Image: 'http://x/{size}.jpg',
                        Privilege: 10,
                    },
                    {
                        FileHash: 'BBBB',
                        SongName: '素颜',
                        SingerName: '许嵩',
                        AlbumName: '',
                        Privilege: 0,
                    },
                ],
            },
        })
        const songs = parseKugouSearchResponse(raw)
        expect(songs).toHaveLength(2)
        expect(songs[0]).toEqual({
            hash: 'AAAA',
            name: '晴天',
            artist: '周杰伦',
            album: '叶惠美',
            coverUrl: 'http://x/240.jpg',
            privilege: 10,
            sqHash: undefined,
            hqHash: undefined,
        })
        expect(songs[1].album).toBeUndefined()
        expect(songs[1].privilege).toBe(0)
    })

    it('缺 FileHash / 空 SongName 过滤，异常响应返回空', () => {
        expect(parseKugouSearchResponse('not json')).toEqual([])
        expect(parseKugouSearchResponse(JSON.stringify({ data: {} }))).toEqual([])
        expect(
            parseKugouSearchResponse(JSON.stringify({ data: { lists: [{ SongName: 'x' }] } })),
        ).toEqual([])
        expect(
            parseKugouSearchResponse(JSON.stringify({ data: { lists: [{ FileHash: 'H', SongName: '' }] } })),
        ).toEqual([])
    })

    it('sqHash/hqHash 有值时填入', () => {
        const raw = JSON.stringify({
            data: {
                lists: [{ FileHash: 'F', SongName: 'S', SQFileHash: 'SQ', HQFileHash: 'HQ', Privilege: 8 }],
            },
        })
        const songs = parseKugouSearchResponse(raw)
        expect(songs[0].sqHash).toBe('SQ')
        expect(songs[0].hqHash).toBe('HQ')
    })
})

describe('酷狗下载直链（getSongInfo.php + trackercdn）', () => {
    it('buildKugouSongInfoUrl 带 hash', () => {
        expect(buildKugouSongInfoUrl('ABC123')).toBe(
            'http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=ABC123',
        )
    })

    it('parseKugouSongInfoResponse 提取 url；空/非法返回空 url', () => {
        expect(parseKugouSongInfoResponse(JSON.stringify({ url: 'https://cdn/a.mp3', extName: 'mp3', bitRate: 128 })))
            .toEqual({ url: 'https://cdn/a.mp3', ext: 'mp3', bitrate: 128 })
        expect(parseKugouSongInfoResponse(JSON.stringify({ url: '' }))).toEqual({ url: '' })
        expect(parseKugouSongInfoResponse('bad')).toEqual({ url: '' })
    })

    it('buildKugouTrackercdnUrl 带 MD5 key 签名', () => {
        const hash = 'ABC123'
        const url = buildKugouTrackercdnUrl(hash)
        expect(url).toContain('trackercdn.kugou.com/i/v2/')
        expect(url).toContain('hash=ABC123')
        expect(url).toContain(`key=${md5hex(hash + 'kgcloudv2')}`)
    })

    it('parseKugouTrackercdnResponse 支持字符串与数组 url、backup_url 兜底', () => {
        expect(parseKugouTrackercdnResponse(JSON.stringify({ url: 'http://a.mp3' }))).toEqual({ url: 'http://a.mp3' })
        expect(parseKugouTrackercdnResponse(JSON.stringify({ url: ['http://a.mp3', 'http://b.mp3'] }))).toEqual({ url: 'http://a.mp3' })
        expect(parseKugouTrackercdnResponse(JSON.stringify({ backup_url: ['', 'http://b.mp3'] }))).toEqual({ url: 'http://b.mp3' })
        expect(parseKugouTrackercdnResponse('bad')).toEqual({ url: '' })
        expect(parseKugouTrackercdnResponse(JSON.stringify({ url: '' }))).toEqual({ url: '' })
    })
})

describe('酷狗 MD5 签名（md5hex）', () => {
    it('已知向量', () => {
        expect(md5hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
        expect(md5hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
        expect(md5hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    })

    it('与 trackercdn 实际 key 规则一致（hash + kgcloudv2）', () => {
        // 用真实搜到的 hash 验证签名长度与十六进制格式
        const key = md5hex('B3A52A7A958BF0AED0EBFBA2E9A818B7' + 'kgcloudv2')
        expect(key).toMatch(/^[0-9a-f]{32}$/)
    })
})

describe('cleanKugouText', () => {
    it('去 em 标签并 trim', () => {
        expect(cleanKugouText('<em>晴天</em>')).toBe('晴天')
        expect(cleanKugouText('  周杰伦  ')).toBe('周杰伦')
        expect(cleanKugouText(null)).toBe('')
    })
})

describe('酷狗搜索元数据（Duration/FileSize/Image）', () => {
    it('解析时长/大小/码率/封面', () => {
        const raw = JSON.stringify({
            data: {
                lists: [
                    { FileHash: 'K1', SongName: '晴天', SingerName: '周杰伦', Duration: 269, FileSize: 4317292, Image: 'http://imge.kugou.com/stdmusic/{size}/x.jpg' },
                ],
            },
        })
        const songs = parseKugouSearchResponse(raw)
        expect(songs[0].duration).toBe(269)
        expect(songs[0].size).toBe(4317292)
        // 4317292×8 / 1000 / 269 ≈ 128
        expect(songs[0].bitrate).toBe(128)
        expect(songs[0].coverUrl).toBe('http://imge.kugou.com/stdmusic/240/x.jpg')
    })

    it('无 Duration/FileSize 时字段为空', () => {
        const raw = JSON.stringify({ data: { lists: [{ FileHash: 'K2', SongName: '歌' }] } })
        const songs = parseKugouSearchResponse(raw)
        expect(songs[0].duration).toBeUndefined()
        expect(songs[0].size).toBeUndefined()
        expect(songs[0].bitrate).toBeUndefined()
    })
})

describe('酷狗 VIP 过滤（privilege=10）', () => {
    it('parseKugouSearchResponse 保留 privilege 供下载层过滤', () => {
        const raw = JSON.stringify({
            data: {
                lists: [
                    { FileHash: 'VIPHASH', SongName: 'VIP歌', SingerName: 'x', Privilege: 10 },
                    { FileHash: 'FREEHASH', SongName: '免费歌', SingerName: 'y', Privilege: 0 },
                ],
            },
        })
        const songs = parseKugouSearchResponse(raw)
        expect(songs).toHaveLength(2)
        expect(songs[0].privilege).toBe(10)
        expect(songs[1].privilege).toBe(0)
    })
})

describe('酷狗测试连接（roleinfo）', () => {
    it('KUGOU_VIP_ROLEINFO_URL 指向 VIP 信息接口', () => {
        expect(KUGOU_VIP_ROLEINFO_URL).toBe('https://vip.kugou.com/recharge/roleinfo')
    })

    it('parseKugouRoleinfo 有效/无效/异常', () => {
        expect(parseKugouRoleinfo(JSON.stringify({ errno: 0, error_code: 0 }))).toEqual({ ok: true, errno: 0, errorCode: 0 })
        expect(parseKugouRoleinfo(JSON.stringify({ errno: 105, error_code: 20017 }))).toEqual({ ok: false, errno: 105, errorCode: 20017 })
        expect(parseKugouRoleinfo('bad')).toEqual({ ok: false, errno: -1, errorCode: -1 })
        expect(parseKugouRoleinfo(JSON.stringify({}))).toEqual({ ok: false, errno: -1, errorCode: -1 })
    })
})

describe('酷狗推荐歌单（v1.4.2 多源推荐）', () => {
    it('buildKugouSpecialListUrl 构造 plist/index URL', () => {
        const url = buildKugouSpecialListUrl(1, 30)
        expect(url).toContain('m.kugou.com/plist/index')
        expect(url).toContain('json=true')
        expect(url).toContain('page=1')
        expect(url).toContain('pagesize=30')
    })

    it('parseKugouSpecialList 提取 specialid/歌单名/封面{size}/播放数/歌曲数', () => {
        const raw = JSON.stringify({
            plist: {
                list: {
                    info: [
                        { specialid: 8700677, specialname: '银河快递歌单', imgurl: 'https://imgessl.kugou.com/soft/collection/{size}/20250703/1.jpg', playcount: 3416769, songcount: 145 },
                        { specialid: 8700678, specialname: '无封面歌单', playcount: 100, songcount: 0 },
                        { specialid: '', specialname: '无 id 丢弃' },
                    ],
                },
            },
        })
        expect(parseKugouSpecialList(raw)).toEqual([
            { id: '8700677', name: '银河快递歌单', coverUrl: 'https://imgessl.kugou.com/soft/collection/150/20250703/1.jpg', playCount: 3416769, trackCount: 145 },
            { id: '8700678', name: '无封面歌单', coverUrl: undefined, playCount: 100, trackCount: undefined },
        ])
    })

    it('parseKugouSpecialList 异常/无 info 返回空', () => {
        expect(parseKugouSpecialList('bad')).toEqual([])
        expect(parseKugouSpecialList(JSON.stringify({ plist: {} }))).toEqual([])
    })

    it('buildKugouSpecialDetailUrl 构造 plist/list URL', () => {
        const url = buildKugouSpecialDetailUrl('8700677', 1, 100)
        expect(url).toContain('m.kugou.com/plist/list/8700677')
        expect(url).toContain('json=true')
        expect(url).toContain('pagesize=100')
    })

    it('parseKugouSpecialDetail 从 filename 拆歌名/歌手 + hash/时长/privilege + 实际下载档 128k', () => {
        const raw = JSON.stringify({
            list: {
                list: {
                    info: [
                        { hash: 'HASH1', filename: '银河快递 (Galaxy Express) - 夏婉', duration: 213, privilege: 0, sqfilesize: 26817668, '320filesize': 8548658, filesize: 3419672 },
                        { hash: 'HASH2', filename: '纯歌名无分隔', duration: 180, privilege: 10, filesize: 3419672 },
                        { hash: '', filename: '无 hash 丢弃' },
                    ],
                },
            },
        })
        const out = parseKugouSpecialDetail(raw)
        expect(out).toHaveLength(2)
        // 行内显示实际下载档（免费通道 128k），不虚标 sq/320
        expect(out[0]).toEqual({ hash: 'HASH1', name: '银河快递 (Galaxy Express)', artist: '夏婉', privilege: 0, duration: 213, size: 3419672, bitrate: 128 })
        expect(out[1]).toEqual({ hash: 'HASH2', name: '纯歌名无分隔', artist: '', privilege: 10, duration: 180, size: 3419672, bitrate: 128 })
    })

    it('parseKugouSpecialDetail 异常/无 info 返回空', () => {
        expect(parseKugouSpecialDetail('bad')).toEqual([])
        expect(parseKugouSpecialDetail(JSON.stringify({ list: { list: {} } }))).toEqual([])
    })
})

describe('酷狗歌词（lyrics.kugou.com search + download）', () => {
    it('buildKugouLyricSearchUrl 带 keyword', () => {
        const url = buildKugouLyricSearchUrl('晴天-周杰伦')
        expect(url).toContain('lyrics.kugou.com/search')
        expect(url).toContain('keyword=%E6%99%B4%E5%A4%A9-%E5%91%A8%E6%9D%B0%E4%BC%A6')
        expect(url).toContain('client=pc')
    })

    it('parseKugouLyricSearch 解析候选 id/accesskey/song/singer（🔴 #405 起**不取 duration**）', () => {
        const raw = JSON.stringify({
            status: 200,
            data: { candidates: [
                { id: '55016179', accesskey: '6570C2C4', song: '周杰伦', singer: '晴天', duration: 314 },
                { id: '', accesskey: 'bad' },
                { id: '222', accesskey: '' },
            ] },
        })
        // ⚠️ `duration` 实测是**混单位的脏值**（同一 query 里 260 / 299000 / 23875 都出现过）
        //    ⇒ 整块丢掉：标出来必然误导，还会污染按匹配度的排序（宁缺勿假的既定口径）。
        expect(parseKugouLyricSearch(raw)).toEqual([
            { id: '55016179', accesskey: '6570C2C4', song: '周杰伦', singer: '晴天' },
        ])
    })

    it('parseKugouLyricSearch 异常/无 candidates 返回空', () => {
        expect(parseKugouLyricSearch('bad')).toEqual([])
        expect(parseKugouLyricSearch(JSON.stringify({ data: {} }))).toEqual([])
    })

    it('buildKugouLyricDownloadUrl 带 id/accesskey/fmt=lrc', () => {
        const url = buildKugouLyricDownloadUrl('55016179', '6570C2C4')
        expect(url).toContain('lyrics.kugou.com/download')
        expect(url).toContain('id=55016179')
        expect(url).toContain('accesskey=6570C2C4')
        expect(url).toContain('fmt=lrc')
    })

    it('parseKugouLyricDownload 解码 base64 content 为 LRC', () => {
        const lrc = '[00:01.00]晴天'
        const b64 = Buffer.from(lrc).toString('base64')
        const raw = JSON.stringify({ content: b64 })
        expect(parseKugouLyricDownload(raw)).toBe(lrc)
    })

    it('parseKugouLyricDownload 明文 content 直接返回（非 base64）', () => {
        const raw = JSON.stringify({ content: '[00:01.00]晴天（明文）' })
        expect(parseKugouLyricDownload(raw)).toBe('[00:01.00]晴天（明文）')
    })

    it('parseKugouLyricDownload 空/异常返回 null', () => {
        expect(parseKugouLyricDownload('bad')).toBeNull()
        expect(parseKugouLyricDownload(JSON.stringify({ content: '' }))).toBeNull()
        expect(parseKugouLyricDownload(JSON.stringify({}))).toBeNull()
    })
})
