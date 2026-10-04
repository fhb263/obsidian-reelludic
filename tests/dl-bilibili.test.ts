/**
 * `pure/dl/bilibili` 单测（#496）—— B 站搜索面的 URL 构造与响应解析。
 * 夹具取自 **2026-10-03 真请求**的响应（字段与实体化形态逐字保留），⛔ 不是照文档编的。
 */
import { describe, expect, it } from 'vitest';
import {
    biliCheckedRows,
    biliEpisodeQuery,
    biliSelectableRows,
    biliViewError,
    buildBiliFillRows,
    buildBiliPartUrl,
    buildBiliSearchUrl,
    buildBiliViewUrl,
    parseBiliView,
    buildBiliWebUrl,
    decodeBiliText,
    formatBiliPlay,
    normalizeBiliCover,
    parseBiliBuvid3,
    parseBiliDuration,
    parseBiliSearch,
    urlUsedByOtherEp,
} from 'pure/dl/bilibili';

/** 真响应里抽出来的一条（含 `<em class="keyword">` 高亮、`&quot;` 实体、协议相对封面） */
const REAL_ITEM = {
    type: 'video',
    id: 114912554719208,
    author: 'VV音乐局',
    mid: 9666167,
    typename: '音乐综合',
    arcurl: 'http://www.bilibili.com/video/av114912554719208',
    aid: 114912554719208,
    bvid: 'BV1BZbSzZEGT',
    title: '【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《<em class="keyword">晴天</em>》- 周杰伦',
    pic: '//i0.hdslb.com/bfs/archive/b72e06e408b1636bb9ca8df55a171e44d6ba1702.jpg',
    play: 3124656,
    duration: '4:30',
};

function searchBody(result: unknown[], code = 0, message = 'OK'): string {
    return JSON.stringify({ code, message, ttl: 1, data: { seid: '1', page: 1, pagesize: 20, result } });
}

describe('buildBiliSearchUrl', () => {
    it('编码关键词并带 search_type=video、默认第 1 页', () => {
        expect(buildBiliSearchUrl('晴天 周杰伦')).toBe(
            'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%99%B4%E5%A4%A9%20%E5%91%A8%E6%9D%B0%E4%BC%A6&page=1',
        );
    });

    it('非法页码回落到第 1 页（0 / 负数 / NaN）', () => {
        expect(buildBiliSearchUrl('a', 0)).toContain('page=1');
        expect(buildBiliSearchUrl('a', -3)).toContain('page=1');
        expect(buildBiliSearchUrl('a', Number.NaN)).toContain('page=1');
    });

    it('小数页码取整', () => {
        expect(buildBiliSearchUrl('a', 2.9)).toContain('page=2');
    });

    it('关键词去首尾空白后再编码', () => {
        expect(buildBiliSearchUrl('  晴天  ')).toContain('keyword=%E6%99%B4%E5%A4%A9&');
    });
});

describe('buildBiliWebUrl', () => {
    it('拼出视频页地址', () => {
        expect(buildBiliWebUrl('BV1a2ak69ELi')).toBe('https://www.bilibili.com/video/BV1a2ak69ELi');
    });
    it('空 bvid 回空串（⛔ 不出半截链接）', () => {
        expect(buildBiliWebUrl('')).toBe('');
        expect(buildBiliWebUrl('   ')).toBe('');
    });
});

describe('parseBiliBuvid3', () => {
    it('从多枚 set-cookie 里挑出 buvid3（只取第一段）', () => {
        expect(
            parseBiliBuvid3([
                'b_nut=1791000738; Path=/; Domain=.bilibili.com',
                'buvid3=135F6511-394E-223E-FDB2-BB5B4A356A6438833infoc; Path=/; Domain=.bilibili.com; Expires=Tue, 01 Jan 2027 00:00:00 GMT',
            ]),
        ).toBe('135F6511-394E-223E-FDB2-BB5B4A356A6438833infoc');
    });

    it('只有 b_nut 时回空串（实测：buvid3 才是风控认的那个）', () => {
        expect(parseBiliBuvid3(['b_nut=1791000738; Path=/'])).toBe('');
    });

    it('空 / undefined 回空串', () => {
        expect(parseBiliBuvid3([])).toBe('');
        expect(parseBiliBuvid3(undefined)).toBe('');
    });

    it('值里有 = 也完整取出', () => {
        expect(parseBiliBuvid3(['buvid3=aa=bb; Path=/'])).toBe('aa=bb');
    });
});

describe('decodeBiliText', () => {
    it('剥掉 <em> 高亮标签', () => {
        expect(decodeBiliText('《<em class="keyword">晴天</em>》- 周杰伦')).toBe('《晴天》- 周杰伦');
    });

    it('还原 &quot; / &amp; / &#39; 等实体', () => {
        expect(decodeBiliText('&quot;刮风这天&quot; &amp; 你')).toBe('"刮风这天" & 你');
        expect(decodeBiliText('it&#39;s &lt;ok&gt;&nbsp;!')).toBe("it's <ok> !");
    });

    it('折叠连续空白并去首尾', () => {
        expect(decodeBiliText('  a\n\n  b  ')).toBe('a b');
    });

    it('undefined / null 回空串', () => {
        expect(decodeBiliText(undefined)).toBe('');
        expect(decodeBiliText(null)).toBe('');
    });
});

describe('normalizeBiliCover', () => {
    it('协议相对地址补 https:', () => {
        expect(normalizeBiliCover('//i0.hdslb.com/bfs/archive/x.jpg')).toBe(
            'https://i0.hdslb.com/bfs/archive/x.jpg',
        );
    });
    it('http 提到 https', () => {
        expect(normalizeBiliCover('http://i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg');
    });
    it('已是 https / 空值', () => {
        expect(normalizeBiliCover('https://i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg');
        expect(normalizeBiliCover('')).toBe('');
    });
});

describe('parseBiliDuration', () => {
    it('"4:30" → 270 秒（接口给的是字符串，⛔ 不是秒数）', () => {
        expect(parseBiliDuration('4:30')).toBe(270);
    });
    it('"1:02:03" → 3723 秒', () => {
        expect(parseBiliDuration('1:02:03')).toBe(3723);
    });
    it('纯数字字符串按秒（"90" → 90）', () => {
        expect(parseBiliDuration('90')).toBe(90);
    });
    it('数字原样收（上游换字段时的防御）', () => {
        expect(parseBiliDuration(222)).toBe(222);
    });
    it('解析不出 / 空 ⇒ 0', () => {
        expect(parseBiliDuration('abc')).toBe(0);
        expect(parseBiliDuration('4:xx')).toBe(0);
        expect(parseBiliDuration('')).toBe(0);
        expect(parseBiliDuration(undefined)).toBe(0);
        expect(parseBiliDuration(-5)).toBe(0);
    });
});

describe('formatBiliPlay', () => {
    it('过万压成「x.x万」', () => {
        expect(formatBiliPlay(3124656)).toBe('312.5万');
        expect(formatBiliPlay(10000)).toBe('1.0万');
    });
    it('不足一万原样', () => {
        expect(formatBiliPlay(9999)).toBe('9999');
    });
    it('0 / 非法 ⇒ 空串（⛔ 不显示「0播放」）', () => {
        expect(formatBiliPlay(0)).toBe('');
        expect(formatBiliPlay(undefined)).toBe('');
        expect(formatBiliPlay('abc')).toBe('');
    });
});

describe('parseBiliSearch', () => {
    it('真响应 → 一条归一化视频（剥标签 / 解实体 / 补 https / 字符串时长转秒）', () => {
        const out = parseBiliSearch(searchBody([REAL_ITEM]));
        expect(out.code).toBe(0);
        expect(out.videos).toHaveLength(1);
        expect(out.videos[0]).toEqual({
            bvid: 'BV1BZbSzZEGT',
            title: '【𝐇𝐢-𝐑𝐞𝐬无损音质】｜《晴天》- 周杰伦',
            author: 'VV音乐局',
            durationSec: 270,
            coverUrl: 'https://i0.hdslb.com/bfs/archive/b72e06e408b1636bb9ca8df55a171e44d6ba1702.jpg',
            play: 3124656,
            category: '音乐综合',
            webUrl: 'https://www.bilibili.com/video/BV1BZbSzZEGT',
        });
    });

    it('`<em>` 高亮**不得**原样进列表（断言标题里没有尖括号）', () => {
        const out = parseBiliSearch(searchBody([REAL_ITEM]));
        expect(out.videos[0].title).not.toContain('<');
        expect(out.videos[0].title).not.toContain('em class');
    });

    it('code !== 0（风控 / 参数错）⇒ 空列表 + 原样带出 code/message', () => {
        const out = parseBiliSearch(JSON.stringify({ code: -412, message: '请求被拦截' }));
        expect(out.videos).toEqual([]);
        expect(out.code).toBe(-412);
        expect(out.message).toBe('请求被拦截');
    });

    it('非 JSON（412 HTML / 空 body）⇒ code -1 且不抛', () => {
        const out = parseBiliSearch('<html>blocked</html>');
        expect(out.code).toBe(-1);
        expect(out.videos).toEqual([]);
        expect(out.message).toContain('JSON');
    });

    it('code 0 但 result 缺失 / 非数组 ⇒ 空列表（= 真没搜到，与风控不是一回事）', () => {
        expect(parseBiliSearch(JSON.stringify({ code: 0, data: {} })).videos).toEqual([]);
        expect(parseBiliSearch(JSON.stringify({ code: 0, data: { result: null } })).videos).toEqual([]);
    });

    it('过滤非 video 条目与缺 bvid 的条目', () => {
        const out = parseBiliSearch(
            searchBody([
                { type: 'ketang', bvid: 'BV1', title: 'x' },
                { type: 'video', title: '没有 bvid' },
                { type: 'video', bvid: '  ', title: '空 bvid' },
                REAL_ITEM,
            ]),
        );
        expect(out.videos.map((v) => v.bvid)).toEqual(['BV1BZbSzZEGT']);
    });

    it('play 非法 ⇒ 0；typename / pic 缺失 ⇒ 该字段缺省', () => {
        const out = parseBiliSearch(
            searchBody([{ type: 'video', bvid: 'BV9', title: 't', author: 'a', duration: '', play: '--' }]),
        );
        expect(out.videos[0].play).toBe(0);
        expect(out.videos[0].durationSec).toBe(0);
        expect(out.videos[0].coverUrl).toBeUndefined();
        expect(out.videos[0].category).toBeUndefined();
    });
});

// ────────────────────── 分P（#505）──────────────────────
// 🔴 夹具取自 **2026-10-03 真请求**：`view?bvid=BV1NreA6rE2L`（「一口气看完【熊出没之春日对对碰】52集合集」）
//    —— `pages[].duration` 是**秒数**（1001），`part` 里带全角空格，`page` 是分P 号（1 起）。
describe('buildBiliViewUrl', () => {
    it('拼出详情地址并编码 bvid', () => {
        expect(buildBiliViewUrl('BV1NreA6rE2L')).toBe(
            'https://api.bilibili.com/x/web-interface/view?bvid=BV1NreA6rE2L',
        );
    });
    it('去首尾空白', () => {
        expect(buildBiliViewUrl('  BV1x  ')).toContain('bvid=BV1x');
    });
    it('空 bvid ⇒ 尾参为空串（⛔ 不出半截链接）', () => {
        expect(buildBiliViewUrl('')).toBe('https://api.bilibili.com/x/web-interface/view?bvid=');
    });
});

describe('buildBiliPartUrl', () => {
    it('第 1 个分P **不带 `?p=`**（与视频页本体等价，也和用户自己复制的形态逐字一致）', () => {
        expect(buildBiliPartUrl('BV1NreA6rE2L', 1)).toBe('https://www.bilibili.com/video/BV1NreA6rE2L');
    });
    it('第 2 个起带 `?p=N`', () => {
        expect(buildBiliPartUrl('BV1NreA6rE2L', 2)).toBe('https://www.bilibili.com/video/BV1NreA6rE2L?p=2');
        expect(buildBiliPartUrl('BV1NreA6rE2L', 52)).toBe('https://www.bilibili.com/video/BV1NreA6rE2L?p=52');
    });
    it('页码 0 / 负数 / NaN / 小数 ⇒ 落到不带尾参（取整后 < 2 同款）', () => {
        const want = 'https://www.bilibili.com/video/BV1NreA6rE2L';
        expect(buildBiliPartUrl('BV1NreA6rE2L', 0)).toBe(want);
        expect(buildBiliPartUrl('BV1NreA6rE2L', -3)).toBe(want);
        expect(buildBiliPartUrl('BV1NreA6rE2L', NaN)).toBe(want);
        expect(buildBiliPartUrl('BV1NreA6rE2L', 2.9)).toBe(want + '?p=2');
    });
    it('空 bvid ⇒ 空串', () => {
        expect(buildBiliPartUrl('', 3)).toBe('');
    });
});

/** 真响应里那 3 条（逐字保留：全角空格 / 秒数 duration / page 从 1 起） */
const REAL_PAGES = [
    { cid: 1, page: 1, from: 'vupload', part: '01赏花大会', duration: 1001 },
    { cid: 2, page: 2, from: 'vupload', part: '02 树神的反击', duration: 1001 },
    { cid: 3, page: 3, from: 'vupload', part: '第03集\u3000\u3000\u3000\u3000\u3000消失的记忆 上', duration: 781 },
];
function viewBody(pages: unknown, code = 0, message = 'OK', title = '一口气看完【熊出没之春日对对碰】52集合集') {
    return JSON.stringify({ code, message, data: { bvid: 'BV1NreA6rE2L', title, videos: 3, pages } });
}

describe('parseBiliView', () => {
    it('解析分P：page / part（剥标签解实体并折叠空白）/ duration（**秒数**）', () => {
        const out = parseBiliView(viewBody(REAL_PAGES));
        expect(out.code).toBe(0);
        expect(out.title).toBe('一口气看完【熊出没之春日对对碰】52集合集');
        expect(out.parts).toEqual([
            { page: 1, title: '01赏花大会', durationSec: 1001 },
            { page: 2, title: '02 树神的反击', durationSec: 1001 },
            // 全角空格被折叠成一个半角空格（`decodeHtmlText` 的既有口径）
            { page: 3, title: '第03集 消失的记忆 上', durationSec: 781 },
        ]);
    });

    it('非 JSON ⇒ code -1（服务层据此给「被风控」的原因）', () => {
        const out = parseBiliView('<html>412</html>');
        expect(out.code).toBe(-1);
        expect(out.parts).toEqual([]);
        expect(out.message).toContain('JSON');
    });

    it('code ≠ 0 ⇒ 空列表并带出 code / message（不假装成功）', () => {
        const out = parseBiliView(viewBody([], 62002, '稿件不可见'));
        expect(out.code).toBe(62002);
        expect(out.message).toBe('稿件不可见');
        expect(out.parts).toEqual([]);
    });

    it('code 0 但没有 pages / pages 非数组 ⇒ 空列表（按「没有分P」处理）', () => {
        expect(parseBiliView(viewBody(null)).parts).toEqual([]);
        expect(parseBiliView(viewBody(undefined)).parts).toEqual([]);
    });

    it('🔴 跳过 page 缺失 / 0 / 非数字的脏条目（拼 `?p=` 全靠它，脏数据 = 指向错误分P 的链接）', () => {
        const out = parseBiliView(
            viewBody([
                { page: 1, part: 'a', duration: 10 },
                { part: '没有 page', duration: 10 },
                { page: 0, part: '第 0 个', duration: 10 },
                { page: 'x', part: '非数字', duration: 10 },
                { page: 2, part: 'b', duration: '20' },
            ]),
        );
        expect(out.parts.map((p) => p.page)).toEqual([1, 2]);
        expect(out.parts[1].durationSec).toBe(20);
    });
});

describe('biliViewError', () => {
    it('412 给「风控」那句（实测唯一会撞上的码）', () => {
        expect(biliViewError({ code: -412, message: '' })).toContain('412');
    });
    it('62002 给「已不可见」这句人话（⛔ 别只丢个 code）', () => {
        expect(biliViewError({ code: 62002, message: '' })).toContain('不可见');
    });
    it('-404 给「不存在」', () => {
        expect(biliViewError({ code: -404, message: '' })).toContain('不存在');
    });
    it('别的码带上 B 站自己的 message', () => {
        expect(biliViewError({ code: 999, message: 'boom' })).toContain('boom');
        expect(biliViewError({ code: 999, message: 'boom' })).toContain('999');
    });
    it('没有 message 也不能吐空串', () => {
        expect(biliViewError({ code: 7, message: '' })).toContain('7');
    });
});

describe('buildBiliFillRows（勾选表口径）', () => {
    const parts = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ page: i + 1, title: `第 ${i + 1} 集`, durationSec: 100 }));

    it('按位置对齐（**缺省锚 = 0**）：第 i 个分P ↔ 第 i 集（epIndex = i、epNo = i + 1）', () => {
        const rows = buildBiliFillRows(parts(3), [undefined, undefined, undefined]);
        expect(rows.map((r) => [r.epIndex, r.epNo, r.page])).toEqual([
            [0, 1, 1],
            [1, 2, 2],
            [2, 3, 3],
        ]);
    });

    it('🔴 集链接全空 ⇒ **全部默认勾上**（这就是「一次填完 52 集」的主路径）', () => {
        const rows = buildBiliFillRows(parts(52), Array.from({ length: 52 }, () => undefined));
        expect(rows).toHaveLength(52);
        expect(rows.every((r) => r.checked && !r.outOfRange && !r.hasUrl)).toBe(true);
        expect(biliCheckedRows(rows)).toHaveLength(52);
    });

    it('🔴 **已有链接的集默认不勾**（用户裁定「弹勾选让我选」= 既不静默跳过、也不静默覆盖）', () => {
        const rows = buildBiliFillRows(parts(3), ['https://www.bilibili.com/video/BV1?p=1', undefined, 'https://x']);
        expect(rows.map((r) => r.hasUrl)).toEqual([true, false, true]);
        expect(rows.map((r) => r.checked)).toEqual([false, true, false]);
        // 但**可勾**（用户想覆盖就能勾）—— ⛔ 别把它做成 disabled
        expect(biliSelectableRows(rows)).toHaveLength(3);
        expect(biliCheckedRows(rows).map((r) => r.epIndex)).toEqual([1]);
    });

    it('链接是空白串 ⇒ 不算「已有链接」（与集编辑浮层「trim 后才算填过」同口径）', () => {
        const rows = buildBiliFillRows(parts(2), ['   ', undefined]);
        expect(rows[0].hasUrl).toBe(false);
        expect(rows[0].checked).toBe(true);
    });

    it('🔴 分P 比集数多 ⇒ 多出来的行 `outOfRange`（禁用、不勾、不进「填入」）', () => {
        const rows = buildBiliFillRows(parts(5), [undefined, undefined, undefined]);
        expect(rows.map((r) => r.outOfRange)).toEqual([false, false, false, true, true]);
        expect(rows.map((r) => r.checked)).toEqual([true, true, true, false, false]);
        expect(biliSelectableRows(rows)).toHaveLength(3);
        expect(biliCheckedRows(rows)).toHaveLength(3);
    });

    it('分P 比集数少 ⇒ 只填前 N 集，剩下的集不动（按少的截断）', () => {
        const rows = buildBiliFillRows(parts(2), [undefined, undefined, undefined, undefined]);
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => !r.outOfRange)).toBe(true);
    });

    it('集数组为空（还没分集）⇒ 每一行都 outOfRange、一个都不勾', () => {
        const rows = buildBiliFillRows(parts(3), []);
        expect(rows.every((r) => r.outOfRange && !r.checked)).toBe(true);
        expect(biliCheckedRows(rows)).toEqual([]);
        expect(biliSelectableRows(rows)).toEqual([]);
    });

    it('分P 列表为空 ⇒ 空表（调用方据此回落「直接填这一条」）', () => {
        expect(buildBiliFillRows([], [undefined])).toEqual([]);
    });

    it('分P 标题 / 时长缺失也能出表（标题空串、时长 0）', () => {
        const rows = buildBiliFillRows([{ page: 1, title: '', durationSec: 0 }], [undefined]);
        expect(rows[0].part).toBe('');
        expect(rows[0].durationSec).toBe(0);
    });
});

// #517（2026-10-04 用户报障）：「点第2集搜索不映射为第2集，还是这个：熊出没，而且搜索回来的
// 填入后还是第1集已有链接的这个」——检索词要带当前集、单P 直填要认得出重复。
describe('biliEpisodeQuery（#517 检索词初值）', () => {
    it('有集标题 ⇒ 作品标题 + 集标题（**⛔ 不追加集号**，用户三选一挑的口径）', () => {
        expect(biliEpisodeQuery('熊出没', 2, '新邻居')).toBe('熊出没 新邻居');
        expect(biliEpisodeQuery('熊出没', 1, '开始')).toBe('熊出没 开始');
    });

    it('🔴 集标题为空 ⇒ 用「第N集」补位（这就是「映射为第2集」）', () => {
        expect(biliEpisodeQuery('熊出没', 2, '')).toBe('熊出没 第2集');
        expect(biliEpisodeQuery('熊出没', 11, '   ')).toBe('熊出没 第11集');
    });

    it('电影态（epNo = 0）⇒ 不做集号补位（电影没有「第几集」这回事）', () => {
        expect(biliEpisodeQuery('让子弹飞', 0, '')).toBe('让子弹飞');
    });

    it('集标题有值 + epNo 非法 ⇒ 照旧只拼已有字段（⛔ 不编集号）', () => {
        expect(biliEpisodeQuery('熊出没', 0, '新邻居')).toBe('熊出没 新邻居');
        expect(biliEpisodeQuery('熊出没', Number.NaN, '新邻居')).toBe('熊出没 新邻居');
    });

    it('作品标题为空 ⇒ 空串（宿主那侧照样给「先填检索词」的提示，⛔ 别只搜「第2集」）', () => {
        expect(biliEpisodeQuery('', 2, '')).toBe('');
        expect(biliEpisodeQuery('   ', 2, '')).toBe('');
    });

    it('只有集标题（作品标题空）⇒ 就它自己（与旧口径一致）', () => {
        expect(biliEpisodeQuery('', 2, '新邻居')).toBe('新邻居');
    });

    it('两侧多余空白被归一（结果可直接当检索词用）', () => {
        expect(biliEpisodeQuery('  熊出没  ', 2, '  ')).toBe('熊出没 第2集');
    });
});

describe('urlUsedByOtherEp（#517 单P 直填的重复提示）', () => {
    const U1 = 'https://www.bilibili.com/video/BV1';
    const U2 = 'https://www.bilibili.com/video/BV2';

    it('🔴 别的集占着同一条 ⇒ 回那个集的集号（1 起）', () => {
        expect(urlUsedByOtherEp([U1, undefined, undefined], U1, 1)).toBe(1);
        expect(urlUsedByOtherEp([U1, undefined, U2], U2, 1)).toBe(3);
    });

    it('🔴 **跳过自己**（刚填进去的那条不算「别人在用」）', () => {
        expect(urlUsedByOtherEp([U1, U1], U1, 1)).toBe(1); // 第 1 集在用 ⇒ 报 1
        expect(urlUsedByOtherEp([undefined, U1], U1, 1)).toBe(0); // 只有自己在用 ⇒ 不报
    });

    it('没人用 / 链接为空 / 数组不是数组 ⇒ 0', () => {
        expect(urlUsedByOtherEp([U1, undefined], U2, 0)).toBe(0);
        expect(urlUsedByOtherEp([U1], '', 0)).toBe(0);
        expect(urlUsedByOtherEp([U1], '   ', 0)).toBe(0);
        expect(urlUsedByOtherEp(undefined as unknown as string[], U1, 0)).toBe(0);
    });

    it('空白串不算占用（与「trim 后才算填过」同口径）', () => {
        expect(urlUsedByOtherEp(['  ', undefined], U1, 1)).toBe(0);
    });
});

// #518（2026-10-04 用户报障）：「搜索『熊出没 第2集』时……返回的数据被错误地覆盖到了第1集，
// 导致第1集的链接被替换成第2集的链接，而第2集本身却是空的」——锚点必须跟着**当前集**走，
// 且集数必须按**本条目总集数**算（⛔ 不是瘦数组的长度）。
describe('buildBiliFillRows 的锚点与集数（#518 跨集覆盖修复）', () => {
    const parts = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ page: i + 1, title: `第 ${i + 1} 集`, durationSec: 100 }));

    it('🔴 锚在当前集：在第 2 集（anchor = 1）选的视频，P1 落到**第 2 集**', () => {
        const rows = buildBiliFillRows(parts(2), [undefined, undefined, undefined], 1, 3);
        expect(rows.map((r) => [r.epIndex, r.epNo, r.page])).toEqual([
            [1, 2, 1],
            [2, 3, 2],
        ]);
    });

    it('🔴 在第 2 集关联时，⛔ **不许碰第 1 集**（第 1 集已有链接 → 一行都不指向它）', () => {
        const rows = buildBiliFillRows(parts(2), ['https://ep1', undefined, undefined], 1, 3);
        expect(rows.some((r) => r.epIndex === 0)).toBe(false);
        expect(rows.map((r) => r.hasUrl)).toEqual([false, false]);
    });

    it('🔴 anchor = 0 时与旧口径**逐字一致**（第 1 集那条「整季一次填完」主路径不受影响）', () => {
        const rows = buildBiliFillRows(parts(3), [undefined, undefined, undefined]);
        expect(rows.map((r) => [r.epIndex, r.epNo])).toEqual([
            [0, 1],
            [1, 2],
            [2, 3],
        ]);
    });

    it('🔴 集数按**本条目总集数**算，⛔ 不是数组长度：瘦数组（只关联了第 1 集）不再把 P2/P3 判成超出集数',
        () => {
            const rows = buildBiliFillRows(parts(3), ['https://ep1'], 0, 3);
            expect(rows.map((r) => r.outOfRange)).toEqual([false, false, false]);
            expect(rows.map((r) => r.hasUrl)).toEqual([true, false, false]);
            expect(rows.map((r) => r.checked)).toEqual([false, true, true]);
        });

    it('⚠️ 不给集数（旧 2 参调用）仍回落到数组长度（向后兼容）', () => {
        const rows = buildBiliFillRows(parts(3), ['https://ep1']);
        expect(rows.map((r) => r.outOfRange)).toEqual([false, true, true]);
    });

    it('锚点 + 分P 数越过本条目集数 ⇒ 后面的行 outOfRange（禁用、不勾、不进填入）', () => {
        const rows = buildBiliFillRows(parts(4), [undefined, undefined, undefined], 1, 3);
        expect(rows.map((r) => r.epIndex)).toEqual([1, 2, 3, 4]);
        expect(rows.map((r) => r.outOfRange)).toEqual([false, false, true, true]);
        expect(biliCheckedRows(rows)).toHaveLength(2);
        expect(biliSelectableRows(rows)).toHaveLength(2);
    });

    it('锚点非法（负数 / NaN / 非数字）⇒ 归 0（⛔ 不产生负下标）', () => {
        expect(buildBiliFillRows(parts(1), [undefined], -3)[0].epIndex).toBe(0);
        expect(buildBiliFillRows(parts(1), [undefined], Number.NaN)[0].epIndex).toBe(0);
        expect(buildBiliFillRows(parts(1), [undefined], undefined as unknown as number)[0].epIndex).toBe(0);
    });

    it('总集数非法（NaN / 负数）⇒ 回落到数组长度（⛔ 不产生「全禁用」的空表）', () => {
        expect(buildBiliFillRows(parts(1), [undefined], 0, Number.NaN).map((r) => r.outOfRange)).toEqual([false]);
        expect(buildBiliFillRows(parts(1), [undefined], 0, -5).map((r) => r.outOfRange)).toEqual([true]);
    });

    it('🔴 「已填过链接的目标集默认不勾」这条口径**跟着锚点走**（不是只认第 1 集）', () => {
        const rows = buildBiliFillRows(parts(2), ['https://ep1', 'https://ep2', undefined], 1, 3);
        expect(rows[0].hasUrl).toBe(true);
        expect(rows[0].checked).toBe(false);
        expect(rows[1].checked).toBe(true);
    });
});
