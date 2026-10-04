/**
 * 在线歌词检索纯逻辑单测（2026-09-27 #396）。
 *
 * 为什么值得写这么多：中文音乐站的响应全是**历史包袱**（酷我的单引号 JSON、QQ 的 JSONP 包裹、
 * 网易云的毫秒时长、酷我的秒时长 + 要自己拼时间戳）—— 这些坑**只有单测能钉住**，
 * 线上跑的时候你看不出「猜错的字段名」，只会看到「未找到歌词」。
 * ⚠️ 夹具都是**按真实响应形状手搓的字符串**（不依赖网络）。
 */
import { describe, expect, it } from 'vitest';
import {
    LYRIC_CANDIDATES_PER_SOURCE,
    LYRIC_SOURCE_HEADERS,
    LYRIC_SOURCE_LABELS,
    buildLyricQuery,
    joinKugouLyricId,
    parseKugouLyricCandidates,
    splitKugouLyricId,
    formatCandidateLabel,
    kuwoLyricUrl,
    kuwoSearchUrl,
    kugouLyricQuery,
    neteaseLyricUrl,
    neteaseSearchUrl,
    parseKuwoLyric,
    parseKuwoSearch,
    parseNeteaseLyric,
    parseNeteaseSearch,
    parseQqLyric,
    parseQqSearch,
    qqLyricUrl,
    qqSearchUrl,
    rankCandidates,
    unwrapJsonp,
} from 'pure/lyricOnline';

describe('lyricOnline · 检索词与请求头', () => {
    it('检索词 = 「标题 作者」；标题为空 ⇒ null（调用方据此禁用按钮）', () => {
        expect(buildLyricQuery('七里香', '周杰伦')).toBe('七里香 周杰伦');
        expect(buildLyricQuery('七里香', '')).toBe('七里香');
        expect(buildLyricQuery('七里香')).toBe('七里香');
        expect(buildLyricQuery('  ', '周杰伦')).toBeNull();
        expect(buildLyricQuery('')).toBeNull();
    });

    it('折叠连续空白（标题里的多余空格会明显降低命中率）', () => {
        expect(buildLyricQuery('  七 里 香 ', ' 周 杰 伦 ')).toBe('七 里 香 周 杰 伦');
    });

    it('三个源都带 Referer（⛔ 缺了会被站点拒绝或返回空）', () => {
        for (const id of ['netease', 'kuwo', 'qq'] as const) {
            expect(LYRIC_SOURCE_HEADERS[id].Referer).toBeTruthy();
            expect(LYRIC_SOURCE_HEADERS[id]['User-Agent']).toContain('Mozilla');
            expect(LYRIC_SOURCE_LABELS[id]).toBeTruthy();
        }
    });
});

describe('lyricOnline · URL 构造（字段名与参数照抄金标准）', () => {
    it('网易云搜索 / 歌词', () => {
        // 🔴 #475：搜索池由 20 放宽到 **50**（实测网易云/酷我 limit=50 就真给 50 条）
        expect(neteaseSearchUrl('七里香 周杰伦')).toBe(
            'https://music.163.com/api/cloudsearch/pc?s=%E4%B8%83%E9%87%8C%E9%A6%99%20%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=50',
        );
        expect(neteaseLyricUrl('186016')).toBe('https://music.163.com/api/song/lyric?id=186016&lv=1&kv=1&tv=-1');
    });

    it('网易云歌词 URL 带 `tv=-1`（不要翻译行 —— 译行会混进 LRC 正文）', () => {
        expect(neteaseLyricUrl('1')).toContain('tv=-1');
    });

    it('酷我搜索带 `rformat=json&encoding=utf8`（决定返回 JSON + UTF-8）', () => {
        const u = kuwoSearchUrl('七里香');
        expect(u.startsWith('http://www.kuwo.cn/search/searchMusicBykeyWord?')).toBe(true);
        expect(u).toContain('rformat=json');
        expect(u).toContain('encoding=utf8');
        expect(u).toContain(`all=${encodeURIComponent('七里香')}`);
    });

    it('🔴 酷我歌词 URL 必须带 `httpsStatus=1`（少了会 301 音乐查询失败）', () => {
        expect(kuwoLyricUrl('123')).toBe('https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=123&httpsStatus=1');
    });

    it('🔴 QQ 歌词 URL 带 `nobase64=1`（否则 lyric 是 base64，要另行解码）', () => {
        const u = qqLyricUrl('0039MnYb0qxYhV');
        expect(u.startsWith('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?')).toBe(true);
        expect(u).toContain('nobase64=1');
        expect(u).toContain('songmid=0039MnYb0qxYhV');
    });

    it('QQ 搜索带 `format=json`', () => {
        expect(qqSearchUrl('七里香')).toContain('format=json');
        expect(qqSearchUrl('七里香')).toContain('c.y.qq.com/soso/fcgi-bin/client_search_cp');
    });
});

describe('lyricOnline · JSONP 去包裹', () => {
    it('`cb({…});` / 前置块注释 都能剥掉；纯 JSON 原样返回', () => {
        expect(unwrapJsonp('callback({"a":1});')).toBe('{"a":1}');
        expect(unwrapJsonp('/*x*/MusicJsonCallback({"a":1})')).toBe('{"a":1}');
        expect(unwrapJsonp('{"a":1}')).toBe('{"a":1}');
    });
});

describe('lyricOnline · 网易云解析', () => {
    const SEARCH = JSON.stringify({
        result: {
            songs: [
                { id: 186016, name: '七里香', ar: [{ name: '周杰伦' }], dt: 299000, fee: 0 },
                { id: 999, name: '七里香 (翻唱)', ar: [{ name: '某某' }, { name: '另一人' }], dt: 0, fee: 8 },
                { name: '缺 id', ar: [] },
            ],
        },
    });

    it('搜索：`result.songs[]` ⇒ 候选（id 转字符串、dt 毫秒转秒、多歌手全收、fee 原样透传）', () => {
        const c = parseNeteaseSearch(SEARCH);
        expect(c).toHaveLength(2); // 第三项缺 id 被跳过
        expect(c[0]).toEqual({ id: '186016', name: '七里香', artists: ['周杰伦'], durationSec: 299, fee: 0 });
        expect(c[1].artists).toEqual(['某某', '另一人']);
        expect(c[1].durationSec).toBeUndefined(); // dt=0 ⇒ 不给时长（⛔ 别当 0 秒）
        expect(c[1].fee).toBe(8);
    });

    it('🔴 `fee` 缺失 ⇒ undefined（⛔ 别补 0 —— 0 的含义是「确认免费」，缺字段是「不知道」）', () => {
        const raw = JSON.stringify({ result: { songs: [{ id: 1, name: 'x', ar: [] }] } });
        const c = parseNeteaseSearch(raw);
        expect(c).toHaveLength(1);
        expect(c[0].fee).toBeUndefined();
    });

    it('搜索：非 JSON / 结构不符 ⇒ 空数组（⛔ 不抛）', () => {
        expect(parseNeteaseSearch('not json')).toEqual([]);
        expect(parseNeteaseSearch('{}')).toEqual([]);
        expect(parseNeteaseSearch('{"result":{}}')).toEqual([]);
    });

    it('歌词：`lrc.lyric`；空白 / 缺失 ⇒ null', () => {
        expect(parseNeteaseLyric(JSON.stringify({ lrc: { lyric: '[00:01.00]窗外的麻雀' } }))).toBe('[00:01.00]窗外的麻雀');
        expect(parseNeteaseLyric(JSON.stringify({ lrc: { lyric: '   ' } }))).toBeNull();
        expect(parseNeteaseLyric(JSON.stringify({ lrc: {} }))).toBeNull();
        expect(parseNeteaseLyric('boom')).toBeNull();
    });
});

describe('lyricOnline · 酷我解析', () => {
    const SEARCH = JSON.stringify({
        abslist: [
            { MUSICRID: 'MUSIC_123456', SONGNAME: '七里香', ARTIST: '周杰伦', DURATION: '299' },
            { MUSICRID: '', SONGNAME: '缺 rid' },
            { MUSICRID: 'MUSIC_2', SONGNAME: '合唱曲', ARTIST: 'A& B / C、D', DURATION: 'abc' },
        ],
    });

    it('搜索：`MUSICRID` 去掉 `MUSIC_` 前缀；歌手按 `&/、,` 拆开；时长非法 ⇒ undefined', () => {
        const c = parseKuwoSearch(SEARCH);
        expect(c).toHaveLength(2);
        expect(c[0]).toEqual({ id: '123456', name: '七里香', artists: ['周杰伦'], durationSec: 299 });
        expect(c[1].artists).toEqual(['A', 'B', 'C', 'D']);
        expect(c[1].durationSec).toBeUndefined();
    });

    it('🔴 旧版**单引号 JSON** 能降级解析出来', () => {
        const legacy = "{'abslist':[{'MUSICRID':'MUSIC_9','SONGNAME':'旧格式','ARTIST':'甲','DURATION':'100'}]}";
        expect(parseKuwoSearch(legacy)).toEqual([{ id: '9', name: '旧格式', artists: ['甲'], durationSec: 100 }]);
    });

    it('🔴 标准 JSON 里含撇号时**不得**被单引号降级破坏（两段式解析的意义）', () => {
        const std = JSON.stringify({ abslist: [{ MUSICRID: 'MUSIC_7', SONGNAME: "it's ok", ARTIST: "O'Neil" }] });
        const c = parseKuwoSearch(std);
        expect(c).toHaveLength(1);
        expect(c[0].name).toBe("it's ok");
        expect(c[0].artists).toEqual(["O'Neil"]);
    });

    it('歌词：`lrclist[]` 的**秒**拼成 `[mm:ss.xx]`', () => {
        const raw = JSON.stringify({
            data: {
                lrclist: [
                    { time: 0, lineLyric: '作词 : 黄俊郎' },
                    { time: 19.5, lineLyric: '窗外的麻雀' },
                    { time: 605.07, lineLyric: '十分钟后的行' },
                ],
            },
        });
        expect(parseKuwoLyric(raw)).toBe('[00:00.00]作词 : 黄俊郎\n[00:19.50]窗外的麻雀\n[10:05.07]十分钟后的行');
    });

    it('歌词：无时间戳 / 时间戳非法的行**原样保留**（多为标题行；播放器会跳过渲染）', () => {
        const raw = JSON.stringify({
            data: { lrclist: [{ time: '', lineLyric: '七里香' }, { time: 'x', lineLyric: '词：甲' }, { lineLyric: '曲：乙' }] },
        });
        expect(parseKuwoLyric(raw)).toBe('七里香\n词：甲\n曲：乙');
    });

    it('歌词：空列表 / 非 JSON ⇒ null', () => {
        expect(parseKuwoLyric(JSON.stringify({ data: { lrclist: [] } }))).toBeNull();
        expect(parseKuwoLyric('nope')).toBeNull();
    });
});

describe('lyricOnline · QQ 解析', () => {
    it('搜索：JSONP 包裹 + `data.song.list[]`（interval 秒）', () => {
        const raw =
            'MusicJsonCallback(' +
            JSON.stringify({
                code: 0,
                data: { song: { list: [{ songmid: '0039MnYb0qxYhV', songname: '七里香', singer: [{ name: '周杰伦' }], interval: 299 }] } },
            }) +
            ');';
        const c = parseQqSearch(raw);
        expect(c).toEqual([{ id: '0039MnYb0qxYhV', name: '七里香', artists: ['周杰伦'], durationSec: 299 }]);
    });

    it('搜索：缺 songmid / 非 JSONP 但结构对 ⇒ 都能处理', () => {
        expect(parseQqSearch(JSON.stringify({ data: { song: { list: [{ songname: '无 mid' }] } } }))).toEqual([]);
        expect(
            parseQqSearch(JSON.stringify({ data: { song: { list: [{ songmid: 'm1', songname: 'n', singer: [{ name: 'a' }] }] } } })),
        ).toHaveLength(1);
    });

    it('歌词：`retcode: 0` + 明文 lyric；retcode 非 0 ⇒ null', () => {
        expect(parseQqLyric(JSON.stringify({ retcode: 0, lyric: '[00:01.00]窗外的麻雀' }))).toBe('[00:01.00]窗外的麻雀');
        expect(parseQqLyric(JSON.stringify({ retcode: -1, lyric: 'x' }))).toBeNull();
        expect(parseQqLyric(JSON.stringify({ code: 0, lyric: '  ' }))).toBeNull();
        expect(parseQqLyric('boom')).toBeNull();
    });

    it('歌词：JSONP 包裹 + 前置块注释都能剥掉', () => {
        const raw = '/*x*/MusicJsonCallback(' + JSON.stringify({ retcode: 0, lyric: 'abc' }) + ');';
        expect(parseQqLyric(raw)).toBe('abc');
    });
});

describe('lyricOnline · 候选排序（照搬 LyricFlux 评分口径；首条 = 自动命中项）', () => {
    const c = (name: string, artists: string[]): { id: string; name: string; artists: string[] } => ({ id: name, name, artists });
    const names = (list: { name: string }[]): string[] => list.map((x) => x.name);

    it('标题全等（+10）排在标题包含（+5）之前', () => {
        const list = [c('七里香 (Live)', ['周杰伦']), c('七里香', ['周杰伦'])];
        expect(names(rankCandidates(list, '七里香', '周杰伦'))).toEqual(['七里香', '七里香 (Live)']);
    });

    it('歌手全等（+5）排在歌手包含（+2）之前', () => {
        const list = [c('七里香', ['周杰伦与朋友']), c('七里香', ['周杰伦'])];
        expect(rankCandidates(list, '七里香', '周杰伦')[0].artists).toEqual(['周杰伦']);
    });

    it('🔴 尾部标点噪声要清掉（翻唱源常写 `周杰伦-` / `周杰伦·`）', () => {
        const list = [c('七里香', ['周杰伦 -']), c('七里香', ['别人'])];
        expect(rankCandidates(list, '七里香', '周杰伦')[0].artists).toEqual(['周杰伦 -']);
    });

    it('标题对但歌手都不对 ⇒ 仍按标题排序（宁可选错也别给空）', () => {
        const list = [c('别的歌', ['周杰伦']), c('七里香', ['某某'])];
        expect(rankCandidates(list, '七里香', '周杰伦')[0].name).toBe('七里香');
    });

    it('🔴 同分**保持各源自己的相关度排序**（稳定排序，⛔ 别把候选顺序打乱）', () => {
        const list = [c('七里香', ['甲']), c('七里香', ['乙'])];
        expect(rankCandidates(list, '七里香')[0].artists).toEqual(['甲']);
        expect(rankCandidates(list, '七里香', undefined, 2)[1].artists).toEqual(['乙']);
    });

    it('🔴 去重键 = 歌名 + 歌手（源内同名同歌手的重复行只留一条）', () => {
        const list = [c('七里香', ['周杰伦']), c('七里香', ['周杰伦']), c('七里香', ['周杰伦', '甲'])];
        expect(rankCandidates(list, '七里香', '周杰伦')).toHaveLength(2);
    });

    it('🔴 按 `limit` 截断，默认每源 **20** 条（#400 由 3 → 10；#475 再放宽到 20 —— 面板可滚动，不为「防顶爆」牺牲候选数）', () => {
        const list = [1, 2, 3, 4, 5].map((n) => c(`七里香 ${n}`, ['周杰伦']));
        expect(LYRIC_CANDIDATES_PER_SOURCE).toBe(20);
        expect(rankCandidates(list, '七里香', '周杰伦')).toHaveLength(5);
        expect(rankCandidates(list, '七里香', '周杰伦', 2)).toHaveLength(2);
    });

    it('limit 传 0 / 负数也不返回空（至少给一条，否则弹窗点了等于没反应）', () => {
        const list = [c('七里香', ['周杰伦'])];
        expect(rankCandidates(list, '七里香', '周杰伦', 0)).toHaveLength(1);
        expect(rankCandidates(list, '七里香', '周杰伦', -5)).toHaveLength(1);
    });

    it('空候选 ⇒ 空数组（调用方据此报「该源未找到」）', () => {
        expect(rankCandidates([], '七里香')).toEqual([]);
    });

    it('大小写不敏感（英文歌名）', () => {
        const list = [c('Love Story (Taylor\'s Version)', ['Taylor Swift']), c('love story', ['Taylor Swift'])];
        expect(rankCandidates(list, 'love story', 'taylor swift')[0].name).toBe('love story');
    });
});

describe('lyricOnline · 酷狗（#400 第四源）', () => {
    it('🔴 URL 常量只留一处：酷狗的搜索/取歌词由 `pure/dl/kugou` 提供（本模块只做候选归一）', () => {
        // #404：显示名一律**简称**（用户：「LRC歌词获取界面前缀网易云音乐等改成『网易云』」）
        expect(LYRIC_SOURCE_LABELS.kugou).toBe('酷狗');
        expect(LYRIC_SOURCE_HEADERS.kugou.Referer).toBe('https://www.kugou.com/');
    });

    it('🔴 候选 id = `{hash}{accesskey}`（取歌词两个参数都要），拆回来一模一样', () => {
        const id = joinKugouLyricId('H1', 'AK');
        expect(id).toBe('H1AK');
        expect(splitKugouLyricId(id)).toEqual({ id: 'H1', accesskey: 'AK' });
    });

    it('非本模块拼的 id ⇒ accesskey 为空串（调用方据此提前报错，而不是发一个半截请求）', () => {
        expect(splitKugouLyricId('H1')).toEqual({ id: 'H1', accesskey: '' });
        expect(splitKugouLyricId('')).toEqual({ id: '', accesskey: '' });
    });

    it('归一：`song/singer` → `name/artists[1]`（缺 accesskey 的候选直接丢掉；🔴 #405 起**不取 duration**）', () => {
        const raw = JSON.stringify({
            data: {
                candidates: [
                    { id: 'h1', accesskey: 'ak1', song: '七里香', singer: '周杰伦', duration: 299000 },
                    { id: 'h2', accesskey: '', song: '坏候选', singer: 'x' },
                ],
            },
        });
        expect(parseKugouLyricCandidates(raw)).toEqual([
            // `duration` 实测是混单位的脏值（同一 query 下 260 / 299000 / 23875 都出现过）⇒ 整块丢掉
            { id: joinKugouLyricId('h1', 'ak1'), name: '七里香', artists: ['周杰伦'] },
        ]);
    });

    it('非 JSON / 缺 data.candidates ⇒ 空数组（不抛）', () => {
        expect(parseKugouLyricCandidates('not json')).toEqual([]);
        expect(parseKugouLyricCandidates('{"data":{}}')).toEqual([]);
    });
});

describe('lyricOnline · 候选行文案', () => {
    it('`歌名 - 歌手 · 4:59`；无歌手/无时长时自动省略', () => {
        expect(formatCandidateLabel({ id: '1', name: '七里香', artists: ['周杰伦'], durationSec: 299 })).toBe('七里香 - 周杰伦 · 4:59');
        expect(formatCandidateLabel({ id: '1', name: '七里香', artists: [] })).toBe('七里香');
        expect(formatCandidateLabel({ id: '1', name: '七里香', artists: ['甲', '乙'], durationSec: 65 })).toBe('七里香 - 甲 / 乙 · 1:05');
        expect(formatCandidateLabel({ id: '1', name: 'x', artists: [], durationSec: 0 })).toBe('x');
    });
});

// ── #405：网易云搜索结果里的**音频档位**（下载界面那行的 kbps / 体积）、以及酷狗的检索词形态 ──
describe('parseNeteaseSearch · 音频档位（#405）', () => {
    const withTiers = (tiers: Record<string, unknown>) =>
        JSON.stringify({ result: { songs: [{ id: 1, name: '晴天', ar: [{ name: '周杰伦' }], dt: 269000, fee: 0, ...tiers }] } });

    it('取 `l`（128k，免密外链实际拿到的档）的 br/size', () => {
        const c = parseNeteaseSearch(withTiers({ l: { br: 128000, size: 4300000 }, h: { br: 320000, size: 10700000 } }));
        expect(c[0]).toMatchObject({ bitrate: 128, size: 4300000 });
    });

    it('缺 `l` 时按 `m` → `h` 兜底', () => {
        expect(parseNeteaseSearch(withTiers({ m: { br: 192000, size: 7000000 } }))[0]).toMatchObject({ bitrate: 192, size: 7000000 });
        expect(parseNeteaseSearch(withTiers({ h: { br: 320000, size: 10700000 } }))[0]).toMatchObject({ bitrate: 320, size: 10700000 });
    });

    it('🔴 `sq` / `hr`（无损 / Hi-Res）**不取** —— 免费通道下不到，标出来就是给用户一个下不到的期望', () => {
        const c = parseNeteaseSearch(withTiers({ sq: { br: 922746, size: 36600676 }, hr: { br: 1544000, size: 61000000 } }));
        expect(c[0].bitrate).toBeUndefined();
        expect(c[0].size).toBeUndefined();
    });

    it('档位字段是脏值（br 为字符串 / size 为 0 / 整个对象缺失）⇒ undefined（⛔ 不补假值、不猜）', () => {
        const bad = parseNeteaseSearch(withTiers({ l: { br: '128000', size: 0 } }));
        expect(bad[0].bitrate).toBeUndefined();
        expect(bad[0].size).toBeUndefined();
        const none = parseNeteaseSearch(withTiers({}));
        expect(none[0].bitrate).toBeUndefined();
        expect(none[0].size).toBeUndefined();
    });
});

describe('kugouLyricQuery（#405）', () => {
    it('🔴 形态 = **歌手-歌名**（实测：空格形态在酷狗恒 0 条，短横线才有；且歌手的词序不能反）', () => {
        expect(kugouLyricQuery('七里香', '周杰伦')).toBe('周杰伦-七里香');
        expect(kugouLyricQuery('Yesterday Once More', 'Carpenters')).toBe('Carpenters-Yesterday Once More');
    });

    it('作者为空 ⇒ 只传歌名；两侧 trim（脏空白会让命中率掉）', () => {
        expect(kugouLyricQuery('七里香', '')).toBe('七里香');
        expect(kugouLyricQuery('七里香', undefined)).toBe('七里香');
        expect(kugouLyricQuery('  七里香 ', '  周杰伦  ')).toBe('周杰伦-七里香');
    });
});
