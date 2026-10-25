// ⬇️ 2026-09-28 移植自 obsidian-lyricflux/tests/download-utils.test.ts（同作者；仅改导入路径为 pure/dl/*）。
import { describe, it, expect } from 'vitest'
import {
    sanitizeFilename, buildSongFilename, songSimilarityScore, isNeteaseDownloadable, formatDuration,
    buildSongWebUrl, buildSourceSearchUrl, buildPlaylistWebUrl, buildOpenaiModelsUrl, parseOpenaiModelsResponse,
} from 'pure/dl/utils'

describe('下载文件名校验（downloadUtils）', () => {
    it('sanitizeFilename 替换 Windows 非法字符、空串兜底', () => {
        expect(sanitizeFilename('a/b:c*?"<>|')).toBe('a_b_c______')
        expect(sanitizeFilename('   ')).toBe('Unknown')
        expect(sanitizeFilename('周杰伦')).toBe('周杰伦')
    })

    it('buildSongFilename：艺术家 - 标题.mp3，缺项用 Unknown 兜底', () => {
        expect(buildSongFilename('周杰伦', '七里香')).toBe('周杰伦 - 七里香.mp3')
        expect(buildSongFilename('', '七里香')).toBe('Unknown - 七里香.mp3')
        expect(buildSongFilename('Beyond', '')).toBe('Beyond - Unknown.mp3')
    })
})

describe('搜索相似度打分（songSimilarityScore）', () => {
    const score = songSimilarityScore

    it('标题+艺术家都命中关键词最高分（晴天 周杰伦）', () => {
        const exact = score('晴天 周杰伦', '晴天', '周杰伦')
        const live = score('晴天 周杰伦', '晴天 (Live)', '周杰伦')
        const cover = score('晴天 周杰伦', '晴天', 'A-LINK')
        expect(exact).toBeGreaterThan(live)
        expect(exact).toBeGreaterThan(cover)
    })

    it('标题精确匹配高于包含匹配', () => {
        const exact = score('晴天', '晴天', '周杰伦')
        const contains = score('晴天', '晴天娃娃', '范晓萱')
        expect(exact).toBeGreaterThan(contains)
    })

    it('多 token 关键词：标题命中 + 艺术家命中累积', () => {
        const both = score('晴天 周杰伦', '晴天', '周杰伦')
        const titleOnly = score('晴天 周杰伦', '晴天', '')
        expect(both).toBeGreaterThan(titleOnly)
    })

    it('空标题返回 -1', () => {
        expect(score('晴天', '', '周杰伦')).toBe(-1)
    })
})

describe('网易云 VIP 过滤（isNeteaseDownloadable）', () => {
    it('fee 缺省 / 0 可下载', () => {
        expect(isNeteaseDownloadable(undefined)).toBe(true)
        expect(isNeteaseDownloadable(0)).toBe(true)
    })

    it('fee>0（VIP=1/付费=4/试听=8）不可下载', () => {
        expect(isNeteaseDownloadable(1)).toBe(false)
        expect(isNeteaseDownloadable(4)).toBe(false)
        expect(isNeteaseDownloadable(8)).toBe(false)
    })
})

describe('时长格式化（formatDuration）', () => {
    it('秒 → MM:SS，补零', () => {
        expect(formatDuration(269)).toBe('4:29')
        expect(formatDuration(65)).toBe('1:05')
        expect(formatDuration(0)).toBe('0:00')
        expect(formatDuration(9)).toBe('0:09')
    })

    it('≥1 小时 → H:MM:SS', () => {
        expect(formatDuration(3661)).toBe('1:01:01')
        expect(formatDuration(7200)).toBe('2:00:00')
    })

    it('非法输入返回空串', () => {
        expect(formatDuration(undefined)).toBe('')
        expect(formatDuration(-5)).toBe('')
        expect(formatDuration(Number.NaN)).toBe('')
    })
})

describe('搜索结果歌曲网页地址（buildSongWebUrl）', () => {
    it('生成网易云歌曲页', () => {
        expect(buildSongWebUrl({ source: 'netease', id: '123' }))
            .toBe('https://music.163.com/#/song?id=123')
    })

    it('生成 QQ 音乐歌曲页', () => {
        expect(buildSongWebUrl({ source: 'qq', id: 'abc', songmid: 'abc' }))
            .toBe('https://y.qq.com/n/ryqq/songDetail/abc')
    })

    it('生成酷狗歌曲页', () => {
        expect(buildSongWebUrl({ source: 'kugou', id: 'HASH' }))
            .toBe('https://www.kugou.com/song/#hash=HASH')
    })

    it('生成酷我歌曲页', () => {
        expect(buildSongWebUrl({ source: 'kuwo', id: '456', kuwoRid: '456' }))
            .toBe('https://www.kuwo.cn/play_detail/456')
    })

    it('缺少必要 ID 时不生成链接', () => {
        expect(buildSongWebUrl({ source: 'qq', id: '', songmid: '' })).toBeNull()
        expect(buildSongWebUrl({ source: 'kuwo', id: '', kuwoRid: '' })).toBeNull()
        expect(buildSongWebUrl({ source: 'netease', id: '' })).toBeNull()
        expect(buildSongWebUrl({ source: 'kugou', id: '' })).toBeNull()
    })
})

describe('百科来源搜索 URL（buildSourceSearchUrl）', () => {
    it('百度百科词条直达', () => {
        expect(buildSourceSearchUrl('baike', '晴天'))
            .toBe('https://baike.baidu.com/item/%E6%99%B4%E5%A4%A9')
    })

    it('维基百科搜索', () => {
        expect(buildSourceSearchUrl('wikipedia', '晴天 周杰伦'))
            .toBe('https://zh.wikipedia.org/w/index.php?search=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6')
    })

    it('豆瓣音乐搜索', () => {
        expect(buildSourceSearchUrl('douban', '周杰伦'))
            .toBe('https://search.douban.com/music/subject_search?search_text=%E5%91%A8%E6%9D%B0%E4%BC%A6')
    })

    it('空关键词编码后仍可构造、空白裁剪', () => {
        expect(buildSourceSearchUrl('baike', '  ')).toBe('https://baike.baidu.com/item/')
        expect(buildSourceSearchUrl('wikipedia', 'a b')).toBe('https://zh.wikipedia.org/w/index.php?search=a%20b')
    })
})

describe('歌单网页 URL（buildPlaylistWebUrl）', () => {
    it('网易云歌单', () => {
        expect(buildPlaylistWebUrl('netease', '3778678'))
            .toBe('https://music.163.com/#/playlist?id=3778678')
    })
    it('QQ 歌单（登录后可见）', () => {
        expect(buildPlaylistWebUrl('qq', '123456'))
            .toBe('https://y.qq.com/n/ryqq/playlist/123456')
    })
    it('酷狗歌单网页反爬 Access Denied：不生成链接', () => {
        expect(buildPlaylistWebUrl('kugou', '888')).toBe('')
    })
    it('酷我歌单', () => {
        expect(buildPlaylistWebUrl('kuwo', '999'))
            .toBe('https://www.kuwo.cn/playlist_detail/999')
    })
    it('id 为空返回空串', () => {
        expect(buildPlaylistWebUrl('netease', '')).toBe('')
    })
})

describe('自定义 OpenAI 模型列表（buildOpenaiModelsUrl / parseOpenaiModelsResponse）', () => {
    it('buildOpenaiModelsUrl 拼接 /models（去尾斜杠）', () => {
        expect(buildOpenaiModelsUrl('https://api.siliconflow.cn/v1')).toBe('https://api.siliconflow.cn/v1/models')
        expect(buildOpenaiModelsUrl('https://api.siliconflow.cn/v1/')).toBe('https://api.siliconflow.cn/v1/models')
    })
    it('buildOpenaiModelsUrl 已是 /chat/completions 时先去掉再拼 /models、空值返回空串', () => {
        expect(buildOpenaiModelsUrl('https://api.siliconflow.cn/v1/chat/completions')).toBe('https://api.siliconflow.cn/v1/models')
        expect(buildOpenaiModelsUrl('  ')).toBe('')
    })
    it('parseOpenaiModelsResponse 提取 data[].id', () => {
        const text = '{"data":[{"id":"Qwen/Qwen2.5-7B-Instruct"},{"id":"glm-4-flash"},{"object":"list"}]}'
        expect(parseOpenaiModelsResponse(text)).toEqual(['Qwen/Qwen2.5-7B-Instruct', 'glm-4-flash'])
    })
    it('parseOpenaiModelsResponse 非法/空数据返回空数组', () => {
        expect(parseOpenaiModelsResponse('not-json')).toEqual([])
        expect(parseOpenaiModelsResponse('{"data":[]}')).toEqual([])
        expect(parseOpenaiModelsResponse('{}')).toEqual([])
    })
})
