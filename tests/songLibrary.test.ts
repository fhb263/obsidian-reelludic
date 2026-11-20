// 在线曲库结果映射（pure/songLibrary）单测 —— #464
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { songLibraryResults, SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
import { scoreIsPercentOf, scoreTextOf } from 'pure/scoreDisplay';
import { POSTER_SOURCE_LABELS } from 'pure/posterSources';
import type { DownloadSong } from 'services/dl';

/** 仓库根（`vitest.config.ts` 里 `root` 就是它；这里按 test 文件位置回退两级） */
const ROOT = join(__dirname, '..');

/** 造一条四平台歌曲（默认：网易云《海阔天空》/ BEYOND） */
function song(over: Partial<DownloadSong> = {}): DownloadSong {
    return { source: 'netease', id: '347230', name: '海阔天空', artist: 'BEYOND', webUrl: 'https://music.163.com/#/song?id=347230', ...over };
}

describe('songLibraryResults 字段映射', () => {
    it('歌名 → title、歌手 → artist、专辑 → album、source 恒为曲库 id、直达取平台歌曲页', () => {
        const [r] = songLibraryResults([song({ album: '乐与怒' })]);
        expect(r.title).toBe('海阔天空');
        expect(r.artist).toBe('BEYOND');
        expect(r.album).toBe('乐与怒');
        expect(r.source).toBe(SONG_LIB_ID);
        expect(r.sourceUrl).toBe('https://music.163.com/#/song?id=347230');
        expect(SONG_LIB_LABEL).toBe('在线曲库');
    });

    it('id 带 `曲库:平台:平台内 id` 前缀（同 id 撞车时仍唯一，且不会被当成豆瓣 id）', () => {
        const [a] = songLibraryResults([song({ source: 'kuwo', id: '99' })]);
        const [b] = songLibraryResults([song({ source: 'qq', id: '99' })]);
        expect(a.id).toBe(`${SONG_LIB_ID}:kuwo:99`);
        expect(b.id).toBe(`${SONG_LIB_ID}:qq:99`);
        expect(a.id).not.toBe(b.id);
    });

    it('🔴 `album` 键**必须存在**（哪怕值 undefined）—— 表单 `pick()` 用 `\'album\' in r` 判「音乐形状」，缺键会走进影视分支', () => {
        const [noAlbum] = songLibraryResults([song()]);
        expect('album' in noAlbum).toBe(true);
        expect(noAlbum.album).toBeUndefined();
    });

    it('缺 webUrl ⇒ sourceUrl 为空（徽标不显示直达），其余字段照旧', () => {
        const [r] = songLibraryResults([song({ webUrl: undefined })]);
        expect(r.sourceUrl).toBeUndefined();
        expect(r.title).toBe('海阔天空');
    });

    it('空歌名条目直接丢（平台偶有解析出空名）', () => {
        expect(songLibraryResults([song({ id: 'x', name: '' }), song({ id: 'x', name: '   ' })])).toEqual([]);
    });

    it('空数组 / undefined 输入 ⇒ 空结果（防御，不抛）', () => {
        expect(songLibraryResults([])).toEqual([]);
        expect(songLibraryResults(undefined as unknown as DownloadSong[])).toEqual([]);
    });
});

describe('songLibraryResults 去重', () => {
    it('🔴 同一首歌四平台各来一份 ⇒ 只留**平台顺序里的第一条**（本栏不显示平台名，重复卡片纯噪音）', () => {
        const out = songLibraryResults([
            song({ source: 'kuwo', id: 'k1', name: '冷雨夜', artist: 'BEYOND' }),
            song({ source: 'netease', id: 'n1', name: '冷雨夜', artist: 'BEYOND' }),
            song({ source: 'qq', id: 'q1', name: '冷雨夜', artist: 'BEYOND' }),
        ]);
        expect(out.length).toBe(1);
        expect(out[0].id).toBe(`${SONG_LIB_ID}:kuwo:k1`);
    });

    it('归一后相等即同一条（大小写 / 空格 / 分隔符 / 括号都不算差异）', () => {
        const out = songLibraryResults([
            song({ id: 'a', name: 'Bohemian Rhapsody', artist: 'Queen' }),
            song({ id: 'b', name: 'bohemian  rhapsody', artist: 'QUEEN' }),
        ]);
        expect(out.length).toBe(1);
    });

    it('歌名相同但**歌手不同** ⇒ 两条都留（那是两首歌，别按歌名单独判重）', () => {
        const out = songLibraryResults([
            song({ id: 'a', name: '天空', artist: '王菲' }),
            song({ id: 'b', name: '天空', artist: '蔡依林' }),
        ]);
        expect(out.map((r) => r.artist)).toEqual(['王菲', '蔡依林']);
    });

    it('同平台同歌名同歌手的重复条目也去重（网易云结果里出现过一模一样的重复行）', () => {
        const out = songLibraryResults([
            song({ id: 'a', name: '不再犹豫', artist: 'BEYOND' }),
            song({ id: 'b', name: '不再犹豫', artist: 'BEYOND' }),
        ]);
        expect(out.length).toBe(1);
    });
});

// ───────────────────────── 第 15 轮：搜索元数据（封面 + 时长） ─────────────────────────
// 用户原话：「给三大音乐平台加搜索元数据的功能」。
// 🔴 这批用例锁的是**「映射层不再丢字段」**，不是「封面长什么样」——
//    尺寸改写规则各自有归属（`tests/posterSources.test.ts` 在测），这里只断言「值被传下去了、且来源正确」。
describe('songLibraryResults 搜索元数据：封面', () => {
    it('网易云：`coverUrl` 原样传下（一个字都不改写 —— 原始就是 1500×1500）', () => {
        const url = 'https://p1.music.126.net/abc==/109951163406532811.jpg';
        const [r] = songLibraryResults([song({ source: 'netease', coverUrl: url })]);
        expect(r.cover).toBe(url);
    });

    it('QQ：尺寸段被抬到 1500（实测 1000 反而 404）—— 证明走的是 `platformCoverUrl` 而不是原样传', () => {
        const [r] = songLibraryResults([
            song({ source: 'qq', id: 'q1', coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg' }),
        ]);
        expect(r.cover).toBe('https://y.gtimg.cn/music/photo_new/T002R1500x1500M000abc.jpg');
    });

    it('酷狗：删掉 `/stdmusic/<尺寸>/` 段（删得掉就是 1477×1477）', () => {
        const [r] = songLibraryResults([
            song({ source: 'kugou', id: 'k1', coverUrl: 'https://imge.kugou.com/stdmusic/480/20230920/abc.jpg' }),
        ]);
        expect(r.cover).toBe('https://imge.kugou.com/stdmusic/20230920/abc.jpg');
    });

    it('🔴 酷我：必须用 `albumPicPath` 拼**专辑图**，⛔ 不能用 `coverUrl`（那是横的 MV 图）', () => {
        const [withAlbum] = songLibraryResults([
            song({ source: 'kuwo', id: 'w1', coverUrl: 'https://img.kuwo.cn/mv/324x182.jpg', albumPicPath: '120/s3s94/93/211513640.jpg' }),
        ]);
        expect(withAlbum.cover).toBe('https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg');
        // 只有 MV 图、没有专辑图 ⇒ 宁可不显示封面，也不把横图方着贴上去
        const [mvOnly] = songLibraryResults([song({ source: 'kuwo', id: 'w2', coverUrl: 'https://img.kuwo.cn/mv/324x182.jpg' })]);
        expect(mvOnly.cover).toBeUndefined();
    });

    it('平台没给封面 ⇒ `cover` 为 undefined（卡片画占位图），⛔ 不编造也不留空串', () => {
        const [r] = songLibraryResults([song({ source: 'qq', coverUrl: undefined })]);
        expect(r.cover).toBeUndefined();
    });

    it('🔴 网易云补拉：自身没封面时用 `covers` 里的图（它的搜索响应一条封面都不带）', () => {
        const [r] = songLibraryResults([song({ source: 'netease', neteaseId: 347230, coverUrl: undefined })], new Map([[347230, 'https://p1.music.126.net/looked-up.jpg']]));
        expect(r.cover).toBe('https://p1.music.126.net/looked-up.jpg');
    });

    it('平台自己给了封面就以平台为准（补拉那张不一定是它选的那张）', () => {
        const [r] = songLibraryResults(
            [song({ source: 'netease', neteaseId: 347230, coverUrl: 'https://p1.music.126.net/own.jpg' })],
            new Map([[347230, 'https://p1.music.126.net/looked-up.jpg']]),
        );
        expect(r.cover).toBe('https://p1.music.126.net/own.jpg');
    });

    it('补拉表只对**网易云**生效（其它平台的 id 空间不相干，别串台）', () => {
        const [r] = songLibraryResults([song({ source: 'qq', id: '347230', coverUrl: undefined })], new Map([[347230, 'https://p1.music.126.net/looked-up.jpg']]));
        expect(r.cover).toBeUndefined();
    });
});

describe('songLibraryResults 搜索元数据：时长', () => {
    it('`duration`（秒）原样透传，**不在这里格式化**（卡片那边用 mediaInfo.formatDuration 统一处理）', () => {
        const [r] = songLibraryResults([song({ duration: 269 })]);
        expect(r.duration).toBe(269);
    });

    it('0 / 负数 / NaN ⇒ undefined（卡片据此整段不画，⛔ 不写「未知」也不写 `0:00`）', () => {
        for (const bad of [0, -1, Number.NaN]) {
            const [r] = songLibraryResults([song({ id: `b${String(bad)}`, duration: bad })]);
            expect(r.duration).toBeUndefined();
        }
    });

    it('平台没给时长 ⇒ undefined', () => {
        const [r] = songLibraryResults([song({ duration: undefined })]);
        expect(r.duration).toBeUndefined();
    });
});

describe('songLibraryResults 来源平台名', () => {
    // 🔴 用户 2026-11-09 原话：「在线曲库也要显示来源平台名」。
    //    曲库栏把四平台压成了一栏，卡片只写「在线曲库」时分不清这首是哪家的。
    it('四平台各带自己的平台名（网易云 / QQ音乐 / 酷狗 / 酷我）', () => {
        const cases: [DownloadSong['source'], string][] = [
            ['netease', '网易云'],
            ['qq', 'QQ音乐'],
            ['kugou', '酷狗'],
            ['kuwo', '酷我'],
        ];
        for (const [src, label] of cases) {
            const [r] = songLibraryResults([song({ source: src, id: `x-${src}` })]);
            expect(r.platformLabel).toBe(label);
        }
    });

    it('🔴 `source` 仍是 `songlib`（栏位归属），平台名单开一个键 —— ⛔ 别拿平台名顶替 source', () => {
        const [r] = songLibraryResults([song()]);
        expect(r.source).toBe(SONG_LIB_ID);
        expect(r.platformLabel).toBe('网易云');
    });

    it('平台认不出 ⇒ 不写 platformLabel 键（卡片回落到「在线曲库」，⛔ 不画空串也不画 undefined）', () => {
        const [r] = songLibraryResults([song({ source: 'douban' as never })]);
        // ⚠️ 用 hasOwnProperty 而不是 `.platformLabel === undefined`：
        //    后者在「键存在但值是 undefined」时也会过，那正是本仓踩过的「空 vs 缺」分辨不了的坑
        expect(Object.prototype.hasOwnProperty.call(r, 'platformLabel')).toBe(false);
    });

    it('平台名与下载窗口的平台档位同名（两处文案漂移会让用户以为换了家）', () => {
        const [r] = songLibraryResults([song({ source: 'qq', id: 'qq-1' })]);
        expect(r.platformLabel).toBe(POSTER_SOURCE_LABELS.qq);
    });
});

describe('🔴 m19924 ② 平台热度**不再写进评分框**（推翻 m10134 那条裁定）', () => {
    // m10134（用户原话）：「填「热度」到评分框，并补拉网易云评论数当「评价人数」」。
    // m19924（用户原话，**本轮推翻上一轮**）：「网易云那个热度值毫无用处，不要展示了删除掉」。
    // 背景：`pop` 是播放热度不是大众评分，渲染成 `100%` 会被当成「好评率 100%」——用户看穿了。
    // 🔴 这组用例守的是**删除**：任何一条回潮（哪怕只对网易云）都会让它变红。
    it('网易云带 pop ⇒ **不写** reviewPercent（热度不是评分，已按用户要求删除展示）', () => {
        const [r] = songLibraryResults([song({ pop: 100 })]);
        expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(false);
        // ⛔ 也不许改成写 rating —— 那是豆瓣 10 分制星分，热度不是评分
        expect(r.rating).toBeUndefined();
    });

    it('pop=0 同样不写（整条链路删掉，不因值为 0 而漏出）', () => {
        const [r] = songLibraryResults([song({ pop: 0 })]);
        expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(false);
    });

    it('小数 / 越界 / NaN 一律不写（删除后不存在任何数值路径）', () => {
        for (const bad of [87.6, 101, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const [r] = songLibraryResults([song({ id: `bad-${bad}`, pop: bad })]);
            expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(false);
        }
    });

    it('🔴 反向守卫：源码里不许再有 `pop` → `reviewPercent` 的赋值（⛔ 别为了「好看」加回来）', () => {
        const src = readFileSync(join(ROOT, 'src/pure/songLibrary.ts'), 'utf8');
        // 判「赋值形态」而不是「出现字段名」—— 注释里说明「已删除 reviewPercent」是合法的，
        // 真正要守的是「又把它写进结果对象」（`item.reviewPercent = …`）。
        expect(src).not.toMatch(/\.\s*reviewPercent\s*=/);
        // 连读数也不许：只要还在摸 `pop`，就说明这条链路又活过来了
        expect(src).not.toMatch(/s\?\.pop\b/);
        expect(src).not.toMatch(/\bpop\s*:/);
    });

    it('🔴 守卫：`reviewPercent` 字段本身**必须保留**（Steam 好评率还在用它）', () => {
        const types = readFileSync(join(ROOT, 'src/data/types.ts'), 'utf8');
        expect(types).toMatch(/reviewPercent\?: number;/);
    });
});

/**
 * 🔴 m12958（用户：「从三大平台搜索或同步得到的条目没有发行年、题材、简介」）：
 * 曲库结果必须把**发行年**与**专辑键**带出来 —— 前者搜索级就有、后者用于后续补拉题材与简介。
 */
describe('songLibraryResults · 发行年与专辑键（m12958）', () => {
    it('搜索级 `publishDate` → `year`（4 位数字，⛔ 不是日期原文）', () => {
        const [r] = songLibraryResults([song({ source: 'qq', id: 'q1', publishDate: '2004-08-03' })]);
        expect(r.year).toBe(2004);
    });

    it('🔴 `albumKey` 原样透传（QQ albummid / 酷狗 AlbumID），供 `albumMetaFor` 补拉题材与简介', () => {
        const [r] = songLibraryResults([song({ source: 'qq', id: 'q1', albumKey: '0042pB7D2rGE4a' })]);
        expect(r.albumKey).toBe('0042pB7D2rGE4a');
    });

    it('🔴 没有 `albumKey` ⇒ **不写该键**（表单用 `\'albumKey\' in r` 判断，写 undefined 会骗过它）', () => {
        const [r] = songLibraryResults([song({ source: 'netease', id: 'n1' })]);
        expect(Object.prototype.hasOwnProperty.call(r, 'albumKey')).toBe(false);
        expect('albumKey' in r).toBe(false);
    });

    it('没有 `publishDate` / 脏值 ⇒ 不写 `year`（「不知道」与「1900 年」必须能分开）', () => {
        for (const bad of [undefined, '', 'not-a-date', 0]) {
            const [r] = songLibraryResults([song({ id: `y-${String(bad)}`, publishDate: bad as unknown as string })]);
            expect(Object.prototype.hasOwnProperty.call(r, 'year'), String(bad)).toBe(false);
        }
    });

    it('空白 `albumKey` 视为没有（trim 后为空就不写键）', () => {
        const [r] = songLibraryResults([song({ id: 'blank', albumKey: '   ' })]);
        expect('albumKey' in r).toBe(false);
    });
});

