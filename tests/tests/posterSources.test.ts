/**
 * `pure/posterSources` 单测（#509）—— 封面来源清单 / 搜索词 / **大图改写规则** / 候选映射。
 * 🔴 重点是**实测出来的那几条 URL 改写规则**（改了它们等于把「拿大图」的能力改没）：
 *    QQ `T002R…1500`、酷狗删 `/stdmusic/<size>/`、网易云原样、酷我用专辑图字段。
 */
import { describe, expect, it } from 'vitest';
import {
    buildPlatformCoverQuery,
    kuwoAlbumCoverUrl,
    platformCandidates,
    platformCoverUrl,
    posterSourcesFor,
    POSTER_SOURCE_LABELS,
    POSTER_SOURCES,
    upgradeCoverUrl,
} from 'pure/posterSources';

describe('来源清单', () => {
    it('🔴 只有音乐开四大平台；其它类型只给「网络搜索」（⛔ 列出来只会让用户白点一次）', () => {
        expect(posterSourcesFor('music')).toEqual(['bing', 'netease', 'qq', 'kugou', 'kuwo']);
        for (const t of ['movie', 'tv', 'anime', 'book', 'game'] as const) {
            expect(posterSourcesFor(t)).toEqual(['bing']);
        }
    });

    it('顺序以「网络搜索」打头（它是所有类型都有的那条），四个平台都在', () => {
        expect(POSTER_SOURCES[0]).toBe('bing');
        expect(POSTER_SOURCES).toHaveLength(5);
        expect(POSTER_SOURCE_LABELS.kuwo).toBe('酷我');
    });
});

describe('buildPlatformCoverQuery', () => {
    it('标题 + 歌手（有歌手就带）；⛔ 不缀「专辑封面」（那是图片搜索的词）', () => {
        expect(buildPlatformCoverQuery('晴天', '周杰伦')).toBe('晴天 周杰伦');
        expect(buildPlatformCoverQuery('晴天', '   ')).toBe('晴天');
        expect(buildPlatformCoverQuery('晴天  ', '周杰伦')).toBe('晴天 周杰伦');
        expect(buildPlatformCoverQuery('晴天', '周杰伦')).not.toContain('专辑封面');
    });

    it('标题为空 ⇒ 空串（调用方据此提示「先填标题」，⛔ 别只拿歌手去搜）', () => {
        expect(buildPlatformCoverQuery('', '周杰伦')).toBe('');
        expect(buildPlatformCoverQuery('   ', '周杰伦')).toBe('');
    });
});

describe('upgradeCoverUrl（🔴 全是实测口径）', () => {
    it('QQ：尺寸段换成 1500（实测 1477×1477；⛔ 1000 反而 404）', () => {
        const u = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg';
        expect(upgradeCoverUrl('qq', u)).toBe('https://y.gtimg.cn/music/photo_new/T002R1500x1500M000000MkMni19ClKG.jpg');
        expect(upgradeCoverUrl('qq', u)).not.toContain('T002R1000x1000');
    });

    it('酷狗：**删掉** `/stdmusic/<size>/` 的尺寸段（实测 1477×1477）', () => {
        const u = 'http://imge.kugou.com/stdmusic/240/20230920/20230920142503632013.jpg';
        expect(upgradeCoverUrl('kugou', u)).toBe('http://imge.kugou.com/stdmusic/20230920/20230920142503632013.jpg');
    });

    it('酷狗：路径形态不认识 ⇒ **原样返回**（⛔ 别通用替换数字段 —— 路径里还有 `20230920` 这种日期段，改坏就 404）', () => {
        const weird = 'http://imge.kugou.com/other/999/x.jpg';
        expect(upgradeCoverUrl('kugou', weird)).toBe(weird);
        // 对照：认得的形态才会被改写（判据不是「返回了东西」，而是「尺寸段真的被动过」）
        expect(upgradeCoverUrl('kugou', 'http://imge.kugou.com/stdmusic/240/20230920/a.jpg')).toBe(
            'http://imge.kugou.com/stdmusic/20230920/a.jpg',
        );
    });

    it('🔴 网易云：**一个字都不动**（原始就是 1500×1500；加 `?param=` 只会把它变小）', () => {
        const u = 'https://p1.music.126.net/F0fTkmBTVykCa2o7Vgu1rQ==/109951173569626660.jpg';
        expect(upgradeCoverUrl('netease', u)).toBe(u);
    });

    it('空串 / 不认识的来源 ⇒ 原样（⛔ 别返回空把图弄丢）', () => {
        expect(upgradeCoverUrl('qq', '')).toBe('');
        expect(upgradeCoverUrl('bing', 'https://x/y.jpg')).toBe('https://x/y.jpg');
    });
});

describe('kuwoAlbumCoverUrl', () => {
    it('把「带前导尺寸段的路径片段」拼成 CDN 地址（尺寸段必须留：不带会 404）', () => {
        expect(kuwoAlbumCoverUrl('120/s3s94/93/211513640.jpg')).toBe(
            'https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg',
        );
        expect(kuwoAlbumCoverUrl('120/s3s94/93/211513640.jpg', 300)).toContain('/albumcover/300/');
    });

    it('空片段 ⇒ 空串（⛔ 不拼出一个只有域名和尺寸的坏地址）', () => {
        expect(kuwoAlbumCoverUrl('')).toBe('');
        expect(kuwoAlbumCoverUrl('   ')).toBe('');
    });
});

describe('platformCoverUrl（各平台取哪张图）', () => {
    it('🔴 酷我：用**专辑图字段**（`albumPicPath`），⛔ 不用 `coverUrl`（那是横的 MV 图）', () => {
        const song = { coverUrl: 'https://img1.kuwo.cn/wmvpic/324/s4s75/52/1458871193.jpg', albumPicPath: '120/s3s94/93/211513640.jpg' };
        const got = platformCoverUrl('kuwo', song);
        expect(got).toBe('https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg');
        expect(got).not.toContain('wmvpic');
    });

    it('酷我：没有专辑图字段 ⇒ 空（⛔ 别退回那张横图）', () => {
        expect(platformCoverUrl('kuwo', { coverUrl: 'https://img1.kuwo.cn/wmvpic/324/x.jpg' })).toBe('');
    });

    it('其余三家用 `coverUrl`（并按各自规则升级）', () => {
        expect(platformCoverUrl('qq', { coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000AAA.jpg' })).toContain('T002R1500x1500');
        expect(platformCoverUrl('kugou', { coverUrl: 'http://imge.kugou.com/stdmusic/240/a/b.jpg' })).toBe('http://imge.kugou.com/stdmusic/a/b.jpg');
        expect(platformCoverUrl('netease', { coverUrl: 'https://p1.music.126.net/a.jpg' })).toBe('https://p1.music.126.net/a.jpg');
        expect(platformCoverUrl('netease', {})).toBe('');
    });
});

describe('platformCandidates', () => {
    const songs = [
        { name: '晴天', artist: '周杰伦', album: '叶惠美', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000AAA.jpg', pageUrl: 'https://y.qq.com/n/ryqq/songDetail/AAA' },
        { name: '晴天', artist: '周杰伦', album: '叶惠美', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000AAA.jpg' },
        { name: '没有封面', artist: 'x' },
    ];

    it('murl = **大图**、turl = **平台小图**（列表不能加载 35 张 1477px 原图）', () => {
        const [c] = platformCandidates('qq', songs);
        expect(c.murl).toContain('T002R1500x1500');
        expect(c.turl).toContain('T002R300x300');
        expect(c.murl).not.toBe(c.turl);
    });

    it('标题 = `歌名 — 歌手 · 专辑`（几张相似封面里能认出来）；来源 = 平台名', () => {
        const [c] = platformCandidates('qq', songs);
        expect(c.title).toBe('晴天 — 周杰伦 · 叶惠美');
        expect(c.domain).toBe('QQ音乐');
        expect(c.page).toBe('https://y.qq.com/n/ryqq/songDetail/AAA');
    });

    it('没有歌曲页时用平台域名根当 Referer（下载防盗链兜底）', () => {
        // ⚠️ 必须给**不同的封面 URL**：同封面的第二条会被去重丢掉（取不到 [1]）
        const noPage = [
            { name: '晴天', artist: '周杰伦', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000AAA.jpg' },
            { name: '七里香', artist: '周杰伦', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000BBB.jpg' },
        ];
        const [, c] = platformCandidates('qq', noPage);
        expect(c.page).toBe('https://y.qq.com/');
    });

    it('🔴 去重（同一封面 multi 条只留一张）+ 丢掉拿不到图的（空图别占一格）', () => {
        expect(platformCandidates('qq', songs)).toHaveLength(1);
    });

    it('`limit` 生效（一次别塞太多；弹窗一屏也就看几张）', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({
            name: 'n' + i,
            artist: 'a',
            coverUrl: `https://y.gtimg.cn/music/photo_new/T002R300x300M000N${i}.jpg`,
        }));
        expect(platformCandidates('qq', many, 5)).toHaveLength(5);
    });

    it('空入参 ⇒ 空数组（⛔ 不抛）', () => {
        expect(platformCandidates('qq', [])).toEqual([]);
        expect(platformCandidates('qq', undefined as never)).toEqual([]);
    });

    it('酷我：缩略图也用专辑图（小尺寸），⛔ 不用那张横的 MV 图', () => {
        const [c] = platformCandidates('kuwo', [{ name: '晴天', albumPicPath: '120/s3s94/93/211513640.jpg', coverUrl: 'https://img1.kuwo.cn/wmvpic/324/x.jpg' }]);
        expect(c.murl).toContain('/albumcover/1000/');
        expect(c.turl).toContain('/albumcover/300/');
        expect(c.turl).not.toContain('wmvpic');
        expect(c.domain).toBe('酷我');
    });
});
