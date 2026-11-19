// 在线曲库结果映射（pure/songLibrary）单测 —— #464
import { describe, it, expect } from 'vitest';
import { songLibraryResults, SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
import { scoreIsPercentOf, scoreTextOf } from 'pure/scoreDisplay';
import { POSTER_SOURCE_LABELS } from 'pure/posterSources';
import type { DownloadSong } from 'services/dl';

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

describe('🔴 m10134 ② 平台热度 → 评分框（reviewPercent）', () => {
    // 用户裁定（m10369）原话：「填「热度」到评分框，并补拉网易云评论数当「评价人数」」。
    // 背景：实测四平台**搜索级都没有大众评分**，只有网易云的 `pop`（0~100）与 QQ 新端点的 `hotness`。
    it('网易云带 pop ⇒ 写成 reviewPercent（百分制，不是 10 分制 rating）', () => {
        const [r] = songLibraryResults([song({ pop: 100 })]);
        expect(r.reviewPercent).toBe(100);
        // ⛔ 别顺手也写 rating —— 那会让 scoreTextOf 之外的路把它当豆瓣星分
        expect(r.rating).toBeUndefined();
    });

    it('pop=0 是**真实结论**（零热度）⇒ 仍要写 0，⛔ 别当成「没有」', () => {
        const [r] = songLibraryResults([song({ pop: 0 })]);
        expect(r.reviewPercent).toBe(0);
        expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(true);
    });

    it('平台没给 pop ⇒ **不写该键**（「不知道」与「0 分」必须能分开）', () => {
        for (const s of [{ source: 'kugou' as const, pop: undefined }, { source: 'kuwo' as const, pop: undefined }]) {
            const [r] = songLibraryResults([song({ source: s.source, id: `p-${s.source}`, pop: s.pop })]);
            expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(false);
        }
    });

    it('脏值（越界 / NaN）一律不写 —— 它会被渲染成 `100%`，编不出来就别显示', () => {
        for (const bad of [101, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            const [r] = songLibraryResults([song({ id: `bad-${bad}`, pop: bad })]);
            expect(Object.prototype.hasOwnProperty.call(r, 'reviewPercent')).toBe(false);
        }
    });

    it('小数热度取整（`pop: 87.6` ⇒ 88）', () => {
        const [r] = songLibraryResults([song({ pop: 87.6 })]);
        expect(r.reviewPercent).toBe(88);
    });

    it('热度经 `scoreTextOf` 渲染成 `100%` 且**不画星号**（`scoreIsPercentOf` 为真）', () => {
        const [r] = songLibraryResults([song({ pop: 100 })]);
        const entry = { communityScore: undefined, reviewPercent: r.reviewPercent };
        expect(scoreTextOf(entry)).toBe('100%');
        expect(scoreIsPercentOf(entry)).toBe(true);
    });
});

