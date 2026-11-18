import { describe, expect, it } from 'vitest';
import {
    BILI_PLAYER_HOST,
    NET_BAR_EXIT,
    NET_BAR_OPEN,
    NET_BAR_TITLE,
    NET_BAR_TITLE_FRAME,
    NET_LOAD_FAIL,
    biliEmbedUrl,
    biliIdsOf,
    canEmbedBili,
    isBiliShortUrl,
} from 'pure/biliEmbed';

describe('biliEmbedUrl — BV 号视频', () => {
    it('普通视频页转成内嵌地址，带 bvid 与 page=1', () => {
        const out = biliEmbedUrl('https://www.bilibili.com/video/BV1xx411c7mD');
        expect(out).toBeTypeOf('string');
        const u = new URL(out as string);
        expect(u.host).toBe(BILI_PLAYER_HOST);
        expect(u.pathname).toBe('/player.html');
        expect(u.searchParams.get('bvid')).toBe('BV1xx411c7mD');
        expect(u.searchParams.get('page')).toBe('1');
    });

    it('?p=2 映射成 page=2（真机实测跳到第 2 P）', () => {
        const out = biliEmbedUrl('https://www.bilibili.com/video/BV1NsrkBaEC9?p=2');
        const u = new URL(out as string);
        expect(u.searchParams.get('bvid')).toBe('BV1NsrkBaEC9');
        expect(u.searchParams.get('page')).toBe('2');
    });

    it('移动端域名同号同地址', () => {
        const a = biliEmbedUrl('https://m.bilibili.com/video/BV1xx411c7mD?p=3');
        const u = new URL(a as string);
        expect(u.searchParams.get('bvid')).toBe('BV1xx411c7mD');
        expect(u.searchParams.get('page')).toBe('3');
    });

    it('脏 page 参数回落 1（不是 NaN，也不抛错）', () => {
        for (const bad of ['?p=', '?p=abc', '?p=0', '?p=-2']) {
            const out = biliEmbedUrl(`https://www.bilibili.com/video/BV1xx411c7mD${bad}`);
            expect(new URL(out as string).searchParams.get('page')).toBe('1');
        }
    });

    // 🔴 2026-11-10 真机 A/B 更正：原来这条断言的是 `0`，理由记的是「Electron 里自动播放会被拦，
    //    留着只会闪一下黑屏」—— 实测不成立（`tools/probe-ab-autoplay.mjs`：autoplay=1 时
    //    `media-started-playing` 立刻触发、`isCurrentlyAudible()` 6/6 采样全 true；autoplay=0 则一次不播）。
    //    ⚠️ 这是**按实测改断言**，不是为了过测试放宽标准：用户原话「点击不是立即播放的，
    //    还要再点屏幕播放器才能播放」就是要 autoplay=1。
    it('autoplay 一律 1（与 YouTube 内嵌同口径：点开就播）', () => {
        const out = biliEmbedUrl('https://www.bilibili.com/video/BV1xx411c7mD?autoplay=1');
        expect(new URL(out as string).searchParams.get('autoplay')).toBe('1');
    });

    it('链接里带一堆无关查询参数也不影响取号', () => {
        const out = biliEmbedUrl(
            'https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999&vd_source=abcdef&t=12',
        );
        const u = new URL(out as string);
        expect(u.searchParams.get('bvid')).toBe('BV1xx411c7mD');
        expect(u.searchParams.get('vd_source')).toBeNull();
    });
});

describe('biliEmbedUrl — 番剧', () => {
    it('ep 号转成 ep_id', () => {
        const out = biliEmbedUrl('https://www.bilibili.com/bangumi/play/ep123456');
        const u = new URL(out as string);
        expect(u.searchParams.get('ep_id')).toBe('123456');
        expect(u.searchParams.get('bvid')).toBeNull();
    });

    it('ss 号转成 season_id', () => {
        const out = biliEmbedUrl('https://www.bilibili.com/bangumi/play/ss12345');
        const u = new URL(out as string);
        expect(u.searchParams.get('season_id')).toBe('12345');
    });
});

describe('biliEmbedUrl — 已经是内嵌地址', () => {
    it('原样放行并规范化 autoplay', () => {
        const out = biliEmbedUrl('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=4&autoplay=1');
        const u = new URL(out as string);
        expect(u.searchParams.get('bvid')).toBe('BV1xx411c7mD');
        expect(u.searchParams.get('page')).toBe('4');
        expect(u.searchParams.get('autoplay')).toBe('1');
    });

    it('内嵌域名但没有片号的（如首页）返回 null', () => {
        expect(biliEmbedUrl('https://player.bilibili.com/player.html')).toBeNull();
    });
});

describe('biliEmbedUrl — 不能内嵌的都返回 null（调用方退回开浏览器）', () => {
    it('非字符串 / 空 / 非 http(s)', () => {
        for (const bad of [undefined, null, 42, {}, '', '   ', 'D:/video/a.mp4', 'a.mp4', '1']) {
            expect(biliEmbedUrl(bad)).toBeNull();
        }
    });

    it('库里真实存在的脏数据 "1" 挡掉（熊出没之丛林总动员 episodeUrls[0]）', () => {
        expect(biliEmbedUrl('1')).toBeNull();
        expect(canEmbedBili('1')).toBe(false);
    });

    it('短链 b23.tv 静态解析不出来 ⇒ null（交给浏览器跳转）', () => {
        expect(biliEmbedUrl('https://b23.tv/abcdEF')).toBeNull();
    });

    it('B 站但取不到片号的页面 ⇒ null（专栏 / 直播 / 空间）', () => {
        for (const u of [
            'https://www.bilibili.com/read/cv123456',
            'https://live.bilibili.com/12345',
            'https://space.bilibili.com/12345',
            'https://www.bilibili.com/',
        ]) {
            expect(biliEmbedUrl(u)).toBeNull();
        }
    });

    it('别的站点即便带 BV 串也不碰（域名限定是刻意的）', () => {
        expect(biliEmbedUrl('https://example.com/video/BV1xx411c7mD')).toBeNull();
        expect(biliEmbedUrl('https://www.youtube.com/embed/abc123')).toBeNull();
    });
});

describe('canEmbedBili', () => {
    it('能内嵌的为 true', () => {
        expect(canEmbedBili('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    });
    it('不能内嵌的为 false', () => {
        expect(canEmbedBili(null)).toBe(false);
        expect(canEmbedBili('https://example.com/x')).toBe(false);
    });
});

describe('biliIdsOf — 拆取流标识（短链口径）', () => {
    it('普通视频页 / 移动端：给出 bvid 与页码', () => {
        expect(biliIdsOf('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({ bvid: 'BV1xx411c7mD', page: 1 });
        expect(biliIdsOf('https://m.bilibili.com/video/BV1xx411c7mD?p=3')).toEqual({ bvid: 'BV1xx411c7mD', page: 3 });
    });

    it('🔴 短域名但**带片号**的形态照样能就地解析（⛔ 别一见 b23.tv 就整段拒）', () => {
        expect(biliIdsOf('https://b23.tv/BV1bE421g76i')).toEqual({ bvid: 'BV1bE421g76i', page: 1 });
    });

    it('不含片号的短码 ⇒ null（要联网跳一次才知道落地，静态给不出）', () => {
        expect(biliIdsOf('https://b23.tv/AbCd123')).toBeNull();
    });

    it('🔴 av 形态给 aid（b23.tv 官方文档列的第 2 种短链格式）', () => {
        // 真机实测：b23.tv/av80433022 ⇒ 302 ⇒ bilibili.com/video/av80433022/ —— 落地页只带 aid
        expect(biliIdsOf('https://b23.tv/av80433022')).toEqual({ aid: 80433022, page: 1 });
        expect(biliIdsOf('https://www.bilibili.com/video/av80433022')).toEqual({ aid: 80433022, page: 1 });
        expect(biliIdsOf('https://www.bilibili.com/video/av80433022?p=2')).toEqual({ aid: 80433022, page: 2 });
    });

    it('av 只认 `av` + 数字（⛔ 别放宽成 /a\\d+，会误伤 /anime/ 之类路径）', () => {
        expect(biliIdsOf('https://www.bilibili.com/anime/123')).toBeNull();
        expect(biliIdsOf('https://www.bilibili.com/video/av')).toBeNull();
        expect(biliIdsOf('https://www.bilibili.com/video/BV1xx411c7mD')).toEqual({ bvid: 'BV1xx411c7mD', page: 1 });
    });

    it('番剧 ep / ss 与内嵌页地址', () => {
        expect(biliIdsOf('https://www.bilibili.com/bangumi/play/ep123456')).toEqual({ epId: 123456, page: 1 });
        expect(biliIdsOf('https://www.bilibili.com/bangumi/play/ss33378')).toEqual({ ssId: 33378, page: 1 });
        expect(biliIdsOf('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=2')).toEqual({
            bvid: 'BV1xx411c7mD',
            epId: undefined,
            ssId: undefined,
            page: 2,
        });
    });

    it('非 B 站 / 脏数据 ⇒ null', () => {
        for (const bad of [undefined, null, 42, {}, '', '   ', 'D:/video/a.mp4', '1']) {
            expect(biliIdsOf(bad)).toBeNull();
        }
        expect(biliIdsOf('https://example.com/video/BV1xx411c7mD')).toBeNull();
        expect(biliIdsOf('https://www.bilibili.com/read/cv123456')).toBeNull();
    });
});

describe('isBiliShortUrl — 只有短链才值得联网跳一次', () => {
    it('b23.tv 命中（含大写域名）', () => {
        expect(isBiliShortUrl('https://b23.tv/AbCd123')).toBe(true);
        expect(isBiliShortUrl('https://B23.TV/AbCd123')).toBe(true);
        expect(isBiliShortUrl('https://b23.tv/BV1bE421g76i')).toBe(true);
    });

    it('普通 B 站页 / 别的站点 / 非字符串 ⇒ false（一次请求都不发）', () => {
        for (const s of ['https://www.bilibili.com/video/BV1xx411c7mD', 'https://example.com/x', '', undefined, null, 42]) {
            expect(isBiliShortUrl(s)).toBe(false);
        }
    });
});

describe('文案常量', () => {
    it('都不为空且无多余空白', () => {
        for (const s of [NET_BAR_TITLE, NET_BAR_TITLE_FRAME, NET_BAR_OPEN, NET_BAR_EXIT, NET_LOAD_FAIL]) {
            expect(s.length).toBeGreaterThan(0);
            expect(s).toBe(s.trim());
        }
    });

    // 🔴 用户 2026-11-03：「我要的是网络链接用覆盖插件播放，不是 B 站内嵌框」。
    //    当时的病根就是工具条写着「B 站内嵌播放」，明明在放直链却把用户往 iframe 上引。
    //    这两条断言把口径钉住：**自有播放器那条不许出现「内嵌」**，且两套文案必须不同。
    it('自有播放器的标题不许出现「内嵌」二字', () => {
        expect(NET_BAR_TITLE).not.toContain('内嵌');
        expect(NET_BAR_TITLE).not.toContain('iframe');
    });

    it('自有播放器与 iframe 兜底是两套不同文案，且兜底那条必须点明「内嵌」', () => {
        expect(NET_BAR_TITLE_FRAME).not.toBe(NET_BAR_TITLE);
        expect(NET_BAR_TITLE_FRAME).toContain('内嵌');
        expect(NET_BAR_TITLE_FRAME).toContain('兜底');
    });

    // 🔴 2026-11-10 删除「帧兜底提示必须说清『回退内嵌』」那条断言 ——
    //    它守着的 `NET_CUE_HINT` 常量已随文案平台化一并删除（见 `pure/biliEmbed.ts` 的删除说明）。
    //    ⛔ 这不是「为过测试放宽」：常量本身不存在了，断言自然无处可守；
    //       现在的空态文案由 `EpisodePageView.buildCueNetUnavailable` 按 B 站 / YouTube 就地生成。
});
