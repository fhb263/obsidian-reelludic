/**
 * `pure/youtube.ts` 的单测。
 *
 * 🔴 为什么这几条必须有测试（都是真机上会崩的口径，不是形式主义）：
 *  ① **编码排序** —— YouTube 同画质给 av01/vp9/avc1 三条。挑错一条，老 Chromium
 *     的 `SourceBuffer.appendBuffer` 直接抛 `NotSupportedError`，整条 MSE 管线报废。
 *  ② **字幕语言优先序** —— YouTube 的 key 顺序不稳定，`Object.keys()[0]` 常是
 *     `en-orig` 这种自动轨。挑错就变成「中文用户看英文机翻」。
 *  ③ **VTT 内联时间戳** —— YouTube 自动字幕带 `<00:00:01.234><c>词</c>`，
 *     不剥掉用户会看到满屏尖括号。
 *  ④ **yt-dlp 报错翻译** —— 「要登录」和「插件 bug」必须分开，否则用户没法自救。
 */
import { describe, expect, it } from 'vitest';

import {
    isYouTubeUrl,
    parseVttToCues,
    parseYtSearch,
    pickYtCaption,
    pickYtMedia,
    ytErrorMessage,
    ytQualityLabel,
    ytThumbUrl,
    ytWatchUrl,
    youTubeIdOf,
    type YtInfo,
} from 'pure/youtube';

/**
 * 造一条 yt-dlp format（只填我们关心的字段）。
 *
 * ⚠️ `url` 必须给：`pickYtMedia` 只收 `protocol === 'https'` **且有直链**的轨
 *    （HLS 分片的 `m3u8_native` 要排除在外）。漏了 url ⇒ 全部被过滤、返回 null。
 */
const fmt = (o: Partial<Record<string, unknown>>) =>
    ({
        protocol: 'https',
        url: `https://example.test/${String(o.format_id ?? 'x')}.mp4`,
        ...o,
    }) as never;

/** 一部「典型」YouTube 视频：同画质三编码 + 两条音频 */
const makeInfo = (): YtInfo =>
    ({
        id: 'dQw4w9WgXcQ',
        title: '示例视频',
        duration: 213,
        formats: [
            // 视频轨：1080p 三编码
            fmt({ format_id: '399', ext: 'mp4', vcodec: 'av01.0.08M.08', acodec: 'none', height: 1080, tbr: 1800 }),
            fmt({ format_id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, tbr: 1700 }),
            fmt({ format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, tbr: 1600 }),
            // 720p / 480p
            fmt({ format_id: '398', ext: 'mp4', vcodec: 'av01.0.05M.08', acodec: 'none', height: 720 }),
            fmt({ format_id: '136', ext: 'mp4', vcodec: 'avc1.4D401F', acodec: 'none', height: 720 }),
            fmt({ format_id: '135', ext: 'mp4', vcodec: 'avc1.4D401E', acodec: 'none', height: 480 }),
            // 音频轨
            fmt({ format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 128 }),
            fmt({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129 }),
            // HLS 分片轨（本模块不管，必须被过滤掉）
            fmt({ format_id: '270', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, protocol: 'm3u8_native' }),
            // 渐进式（音视频合一）—— YouTube 现在不给，造一条确认它不会被当成视频轨
            fmt({ format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a.40.2', height: 360 }),
        ],
    }) as YtInfo;

describe('isYouTubeUrl', () => {
    it('认标准几种分享形态', () => {
        expect(isYouTubeUrl('https://www.youtube.com/watch?v=abc123')).toBe(true);
        expect(isYouTubeUrl('https://youtu.be/abc123')).toBe(true);
        expect(isYouTubeUrl('https://m.youtube.com/watch?v=abc123')).toBe(true);
        expect(isYouTubeUrl('https://www.youtube.com/embed/abc123')).toBe(true);
        expect(isYouTubeUrl('https://www.youtube.com/shorts/abc123')).toBe(true);
    });

    it('不误伤其它站点', () => {
        // 🔴 模糊匹配会把这两个吃掉，必须靠「精确域名」判据挡住
        expect(isYouTubeUrl('https://notyoutube.com/watch?v=abc')).toBe(false);
        expect(isYouTubeUrl('https://youtube-dl.org/')).toBe(false);
        expect(isYouTubeUrl('https://www.bilibili.com/video/BV1xx')).toBe(false);
        expect(isYouTubeUrl('这不是链接')).toBe(false);
    });
});

describe('youTubeIdOf', () => {
    it('从各形态里抠出 id', () => {
        expect(youTubeIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youTubeIdOf('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ');
        expect(youTubeIdOf('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youTubeIdOf('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
        expect(youTubeIdOf('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('非 YouTube / 无 id ⇒ null', () => {
        expect(youTubeIdOf('https://www.bilibili.com/video/BV1xx')).toBeNull();
        expect(youTubeIdOf('https://www.youtube.com/feed/subscriptions')).toBeNull();
        expect(youTubeIdOf('')).toBeNull();
    });
});

describe('pickYtMedia —— 编码与轨挑选', () => {
    it('视频轨优先 H.264（avc1），⛔ 不挑 AV1', () => {
        const p = pickYtMedia(makeInfo());
        expect(p).not.toBeNull();
        // 三条 1080p 里必须选 137（avc1.640028），不是 399（av01）/ 248（vp9）
        expect(p!.video.id).toBe('137');
        expect(p!.video.codecs).toBe('avc1.640028');
        expect(p!.video.height).toBe(1080);
    });

    it('音频轨优先 m4a，⛔ 不挑 webm/Opus', () => {
        const p = pickYtMedia(makeInfo());
        expect(p!.audio?.id).toBe('140');
        expect(p!.audio?.codecs).toBe('mp4a.40.2');
    });

    it('HLS 分片轨与渐进式轨都不进结果', () => {
        const p = pickYtMedia(makeInfo());
        // 270 是 m3u8_native（被过滤）；18 是音视频合一（isVideoOnly 为 false ⇒ 也不是视频轨）
        expect(p!.video.id).not.toBe('270');
        expect(p!.video.id).not.toBe('18');
    });

    it('画质列表降序去重（同一高度只留一个）', () => {
        const p = pickYtMedia(makeInfo());
        expect(p!.heights).toEqual([1080, 720, 480]);
    });

    it('指定低画质时退到该档，且不跨编码（仍留 avc1）', () => {
        const p = pickYtMedia(makeInfo(), 720);
        expect(p!.video.id).toBe('136');
        expect(p!.video.height).toBe(720);
        expect(p!.video.codecs).toBe('avc1.4D401F');
    });

    it('指定的高度比最低档还低 ⇒ 退到最低档，不返回 null', () => {
        const p = pickYtMedia(makeInfo(), 144);
        expect(p!.video.id).toBe('135');
        expect(p!.video.height).toBe(480);
    });

    it('片名 / 时长透传', () => {
        const p = pickYtMedia(makeInfo());
        expect(p!.title).toBe('示例视频');
        expect(p!.duration).toBe(213);
    });

    it('没有可用视频轨 ⇒ null', () => {
        expect(pickYtMedia(null)).toBeNull();
        expect(pickYtMedia({ formats: [] } as YtInfo)).toBeNull();
        // 只有音频 ⇒ 没有视频轨
        expect(
            pickYtMedia({
                formats: [fmt({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2' })],
            } as YtInfo),
        ).toBeNull();
    });
});

describe('ytQualityLabel', () => {
    it('按高度出标签', () => {
        expect(ytQualityLabel(2160)).toBe('4K');
        expect(ytQualityLabel(1440)).toBe('2K');
        expect(ytQualityLabel(1080)).toBe('1080P');
        expect(ytQualityLabel(720)).toBe('720P');
        expect(ytQualityLabel(0)).toBe('未知');
    });
});

describe('pickYtCaption —— 语言优先序', () => {
    const vtt = (u: string) => [{ ext: 'vtt', url: u }];

    it('人工中文 > 自动中文 > 人工英文 > 自动英文', () => {
        const manualZh = pickYtCaption({
            subtitles: { 'zh-Hans': vtt('https://x/manual-zh.vtt') },
            automatic_captions: {
                'zh-Hans': vtt('https://x/auto-zh.vtt'),
                en: vtt('https://x/auto-en.vtt'),
            },
        } as YtInfo);
        expect(manualZh).toEqual({ url: 'https://x/manual-zh.vtt', lang: 'zh-Hans', isAuto: false });

        const autoZh = pickYtCaption({
            automatic_captions: {
                en: vtt('https://x/auto-en.vtt'),
                'zh-Hans': vtt('https://x/auto-zh.vtt'),
            },
        } as YtInfo);
        expect(autoZh).toEqual({ url: 'https://x/auto-zh.vtt', lang: 'zh-Hans', isAuto: true });

        const manualEn = pickYtCaption({
            subtitles: { en: vtt('https://x/manual-en.vtt') },
            automatic_captions: { 'zh-Hans': vtt('https://x/auto-zh.vtt') },
        } as YtInfo);
        // 🔴 自动中文**优先于**人工英文：用户是中文使用者，机翻中文比原文英文有用得多。
        //    这与「人工 > 自动」的直觉相反，是刻意的 —— 语言优先级高于来源质量。
        expect(manualEn).toEqual({ url: 'https://x/auto-zh.vtt', lang: 'zh-Hans', isAuto: true });
    });

    it('没有中文时，人工英文优先于自动英文', () => {
        const enOnly = pickYtCaption({
            subtitles: { en: vtt('https://x/manual-en.vtt') },
            automatic_captions: { en: vtt('https://x/auto-en.vtt') },
        } as YtInfo);
        expect(enOnly).toEqual({ url: 'https://x/manual-en.vtt', lang: 'en', isAuto: false });
    });

    it('简体中文 key 变体都认（zh-CN / zh / zh-Hans）', () => {
        expect(pickYtCaption({ subtitles: { 'zh-CN': vtt('https://x/a.vtt') } } as YtInfo)?.lang).toBe('zh-CN');
        expect(pickYtCaption({ subtitles: { zh: vtt('https://x/b.vtt') } } as YtInfo)?.lang).toBe('zh');
        expect(pickYtCaption({ subtitles: { 'zh-Hans': vtt('https://x/c.vtt') } } as YtInfo)?.lang).toBe('zh-Hans');
    });

    it('优先 vtt，⛔ 不挑 json3', () => {
        const p = pickYtCaption({
            subtitles: { zh: [{ ext: 'json3', url: 'https://x/a.json3' }, { ext: 'vtt', url: 'https://x/a.vtt' }] },
        } as YtInfo);
        expect(p!.url).toBe('https://x/a.vtt');
    });

    it('没有任何字幕 ⇒ null', () => {
        expect(pickYtCaption(null)).toBeNull();
        expect(pickYtCaption({} as YtInfo)).toBeNull();
    });
});

describe('parseVttToCues', () => {
    it('剥掉内联时间戳与 <c> 标签（YouTube 自动字幕的真实形态）', () => {
        const vtt = [
            'WEBVTT',
            '',
            '00:00:01.000 --> 00:00:03.500',
            '<00:00:01.000><c>这个地方</c><00:00:02.000><c>很美</c>',
            '',
            '00:00:03.500 --> 00:00:06.000',
            '是的',
        ].join('\n');
        const cues = parseVttToCues(vtt);
        expect(cues).toHaveLength(2);
        expect(cues[0].at).toBe(1);
        expect(cues[0].text).toBe('这个地方很美');
        expect(cues[1].at).toBe(3.5);
        expect(cues[1].text).toBe('是的');
    });

    it('带 id 行 / 设置串的块也能解析', () => {
        const vtt = ['00:01:02.500 --> 00:01:04.000 align:start position:0%', '你好世界'].join('\n');
        const cues = parseVttToCues(vtt);
        expect(cues).toHaveLength(1);
        expect(cues[0].at).toBe(62.5);
        expect(cues[0].text).toBe('你好世界');
    });

    it('按时间升序输出（VTT 偶有乱序块）', () => {
        const vtt = ['00:00:10.000 --> 00:00:12.000', '后', '', '00:00:01.000 --> 00:00:02.000', '前'].join('\n');
        const cues = parseVttToCues(vtt);
        expect(cues.map((c) => c.text)).toEqual(['前', '后']);
    });

    it('空串 / 无箭头 ⇒ 空数组，⛔ 不抛', () => {
        expect(parseVttToCues('')).toEqual([]);
        expect(parseVttToCues('WEBVTT\n\n随便一段没有时间轴的文字')).toEqual([]);
    });
});

describe('ytErrorMessage —— 报错要能让用户自救', () => {
    it('机器人验证 ⇒ 提示填 Cookie / 换出口', () => {
        const s = ytErrorMessage("ERROR: [youtube] xx: Sign in to confirm you're not a bot.");
        expect(s).toContain('Cookie');
    });

    it('超时 ⇒ 指向代理设置', () => {
        expect(ytErrorMessage('ERROR: Unable to download: ETIMEDOUT')).toContain('代理');
    });

    it('视频不可用 ⇒ 说清楚原因', () => {
        expect(ytErrorMessage('ERROR: Video unavailable')).toContain('不可用');
    });

    it('未知报错也要有兜底文案（⛔ 不给空串）', () => {
        const s = ytErrorMessage('some weird thing happened');
        expect(s.length).toBeGreaterThan(0);
    });
});

/**
 * 搜索结果解析（「网络集可搜索 YouTube」这条功能的纯逻辑）。
 *
 * 🔴 为什么必须有测试：yt-dlp 的 flat-playlist JSON **形状在版本间变过**
 *    （`entries` 在顶层 / 裸数组 / `url` 是 id 还是完整 URL），
 *    而这些分支真机很难穷举。⛔ 靠碰运气解析会变成「有时搜得到、有时空白」。
 */
describe('parseYtSearch —— 搜索结果解析要容错', () => {
    it('标准形态：顶层 entries，id/title/channel/duration 齐全', () => {
        const out = parseYtSearch({
            _type: 'playlist',
            entries: [
                { id: 'dQw4w9WgXcQ', title: 'A', channel: 'CH', duration: 213 },
                { id: 'aaaaaaaaaaa', title: 'B', uploader: 'UP', duration: 60 },
            ],
        });
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({
            id: 'dQw4w9WgXcQ',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            title: 'A',
            channel: 'CH',
            duration: 213,
            thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
        });
        // `uploader` 是 channel 的旧字段名，必须也认
        expect(out[1].channel).toBe('UP');
    });

    it('裸数组形态也认（老版本直接把 entries 当根）', () => {
        const out = parseYtSearch([{ id: 'abc12345678', title: 'X' }]);
        expect(out).toHaveLength(1);
        expect(out[0].title).toBe('X');
    });

    it('没有 id 但有 url：裸 id 与完整 URL 两种都要能抠出来', () => {
        const bare = parseYtSearch({ entries: [{ url: 'dQw4w9WgXcQ', title: '裸id' }] });
        expect(bare[0].id).toBe('dQw4w9WgXcQ');
        const full = parseYtSearch({ entries: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: '整链' }] });
        expect(full[0].id).toBe('dQw4w9WgXcQ');
    });

    it('缺 id 的条目直接丢（拼不出链接就没有意义）', () => {
        const out = parseYtSearch({ entries: [{ title: '没有 id' }, { id: 'ok123456789' }] });
        expect(out).toHaveLength(1);
        expect(out[0].id).toBe('ok123456789');
    });

    it('同一条重复出现只留一条（搜索偶尔会重复）', () => {
        const out = parseYtSearch({ entries: [{ id: 'dup12345678' }, { id: 'dup12345678' }] });
        expect(out).toHaveLength(1);
    });

    it('title 缺失 ⇒ 回落成 id，⛔ 不给空标题', () => {
        const out = parseYtSearch({ entries: [{ id: 'noTitle1234' }] });
        expect(out[0].title).toBe('noTitle1234');
    });

    it('duration 缺失 / 负数 / 非数字 ⇒ 0（= 未知），⛔ 不 NaN', () => {
        const out = parseYtSearch({
            entries: [{ id: 'a1234567890' }, { id: 'b1234567890', duration: -5 }, { id: 'c1234567890', duration: 'x' }],
        });
        expect(out.map((v) => v.duration)).toEqual([0, 0, 0]);
    });

    it('脏输入一律空数组，⛔ 不抛', () => {
        expect(parseYtSearch(null)).toEqual([]);
        expect(parseYtSearch(undefined)).toEqual([]);
        expect(parseYtSearch(42)).toEqual([]);
        expect(parseYtSearch({})).toEqual([]);
        expect(parseYtSearch({ entries: 'not-array' })).toEqual([]);
        expect(parseYtSearch({ entries: [null, 1, 'x'] })).toEqual([]);
    });
});

describe('ytWatchUrl / ytThumbUrl', () => {
    it('统一收敛到 watch?v= 形态', () => {
        expect(ytWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        // ⚠️ 拼出来的地址必须能被自己的 isYouTubeUrl / youTubeIdOf 认回来
        expect(isYouTubeUrl(ytWatchUrl('dQw4w9WgXcQ'))).toBe(true);
        expect(youTubeIdOf(ytWatchUrl('dQw4w9WgXcQ'))).toBe('dQw4w9WgXcQ');
    });

    it('封面用 mqdefault（老视频 maxresdefault 常 404）', () => {
        expect(ytThumbUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    });
});
