// 在线曲库 → `music` 条目落库映射（`pure/musicSync`）的单测。
//
// 🔴 本文件刻意锁的**不是**「函数返回了什么」，而是三条容易悄悄坏掉的口径：
//  ⑴ 判重键用**来源 id**，⛔ 不用标题（标题会被用户改）
//  ⑵ 歌曲时长**不落库**（`durationMin` 是片长、`listenMinutes` 是收听时长，都不是歌曲时长）
//  ⑶ 封面只走 `pure/posterSources`（酷我必须用 `albumPicPath` 专辑图，它的 `coverUrl` 是横的 MV 图）
//
// ⚠️ 坑（本仓踩过）：`sanitizeFilename('')` 之类「空值有默认值」的写法会让「空 vs 缺」失去区别，
//    所以这里对每一个「缺失即不写」的字段都显式断言 **键不存在**，而不是断言值为空串。
import { describe, expect, it } from 'vitest';
import type { DownloadSong } from 'services/dl';
import type { MusicSearchResult } from 'services/resultTypes';
import {
    MUSIC_ADOPT_FIELDS,
    MUSIC_PLATFORMS,
    MUSIC_PLATFORM_LABELS,
    adoptableMusicEntryId,
    dedupeMusicSongs,
    indexMusicEntries,
    isMusicPlatform,
    musicEntrySeed,
    musicIdFromUrl,
    musicItemKey,
    musicKeyFromEntry,
    musicPlatformLabel,
    musicSeedFromResult,
} from 'pure/musicSync';

/** 四平台各一条最小可用样本（字段按 `services/dl` 的 `DownloadSong` 真形状） */
function song(over: Partial<DownloadSong> = {}): DownloadSong {
    return {
        source: 'netease',
        id: '347230',
        name: '海阔天空',
        artist: 'BEYOND',
        album: '乐与怒',
        webUrl: 'https://music.163.com/#/song?id=347230',
        ...over,
    } as DownloadSong;
}

describe('musicSync 平台键', () => {
    it('四个平台键都在表里，且都有中文名', () => {
        expect([...MUSIC_PLATFORMS]).toEqual(['netease', 'qq', 'kugou', 'kuwo']);
        for (const p of MUSIC_PLATFORMS) {
            expect(MUSIC_PLATFORM_LABELS[p]).toBeTruthy();
        }
    });

    it('isMusicPlatform 只认那四个；非法值一律 false（不兜底成第一个）', () => {
        expect(isMusicPlatform('netease')).toBe(true);
        expect(isMusicPlatform('kuwo')).toBe(true);
        // ⛔ 元数据源键与平台键是两套枚举 —— 这些都不该被当成音乐平台
        expect(isMusicPlatform('douban')).toBe(false);
        expect(isMusicPlatform('tmdb')).toBe(false);
        expect(isMusicPlatform('songlib')).toBe(false);
        expect(isMusicPlatform('')).toBe(false);
        expect(isMusicPlatform(undefined)).toBe(false);
        expect(isMusicPlatform(123)).toBe(false);
    });

    it('musicPlatformLabel 认不出回空串（角标退化为纯数值，不画 [object Object]）', () => {
        expect(musicPlatformLabel('netease')).toBe('网易云');
        expect(musicPlatformLabel('qq')).toBe('QQ音乐');
        expect(musicPlatformLabel('kugou')).toBe('酷狗');
        expect(musicPlatformLabel('kuwo')).toBe('酷我');
        expect(musicPlatformLabel('__proto__')).toBe('');
        expect(musicPlatformLabel('constructor')).toBe('');
        expect(musicPlatformLabel(null)).toBe('');
    });
});

describe('musicSync 判重键', () => {
    it('musicItemKey 形状 = music:{source}:{id}', () => {
        expect(musicItemKey('netease', '347230')).toBe('music:netease:347230');
        expect(musicItemKey('kuwo', 211513640)).toBe('music:kuwo:211513640');
    });

    it('musicItemKey 缺任一段回空串（⛔ 不拼出 music:: 这种脏键）', () => {
        expect(musicItemKey('', '1')).toBe('');
        expect(musicItemKey('netease', '')).toBe('');
        expect(musicItemKey(undefined, undefined)).toBe('');
        expect(musicItemKey('netease', '   ')).toBe('');
    });

    it('musicIdFromUrl 认四种平台歌曲页（真源 = pure/dl/utils.buildSongWebUrl）', () => {
        expect(musicIdFromUrl('https://music.163.com/#/song?id=347230')).toBe('347230');
        expect(musicIdFromUrl('https://music.163.com/song?id=347230')).toBe('347230');
        expect(musicIdFromUrl('https://y.qq.com/n/ryqq/songDetail/003OUlho2HcRHC')).toBe('003OUlho2HcRHC');
        expect(musicIdFromUrl('https://www.kugou.com/song/#hash=ABCDEF123')).toBe('ABCDEF123');
        expect(musicIdFromUrl('https://www.kuwo.cn/play_detail/211513640')).toBe('211513640');
    });

    it('musicIdFromUrl 不认识的地址回空串（别站链接不被当成本平台曲目）', () => {
        expect(musicIdFromUrl('')).toBe('');
        expect(musicIdFromUrl('https://example.com/song/1')).toBe('');
        expect(musicIdFromUrl('https://music.163.com/#/playlist?id=1')).toBe('');
        expect(musicIdFromUrl(undefined)).toBe('');
    });

    it('🔴 判重键从条目反解：只认「source 是音乐平台 + sourceUrl 能反解」', () => {
        const e = { id: 'a1', source: 'netease', sourceUrl: 'https://music.163.com/#/song?id=347230' };
        expect(musicKeyFromEntry(e)).toBe('music:netease:347230');
    });

    it('🔴 豆瓣/手工条目不算「已入库」（否则会跳过用户自己的条目）', () => {
        // 手动建的歌：sourceUrl 指着平台页，但 source 是豆瓣（或空）
        expect(musicKeyFromEntry({ source: 'douban', sourceUrl: 'https://music.163.com/#/song?id=1' })).toBe('');
        expect(musicKeyFromEntry({ source: undefined, sourceUrl: 'https://music.163.com/#/song?id=1' })).toBe('');
        expect(musicKeyFromEntry(null)).toBe('');
        expect(musicKeyFromEntry({ source: 'netease' })).toBe('');
    });

    it('indexMusicEntries 只收音乐条目，且同键先到先得', () => {
        const byKey = indexMusicEntries([
            { id: 'g1', type: 'game', source: 'steam', sourceUrl: 'https://store.steampowered.com/app/620' },
            { id: 'm1', type: 'music', source: 'kuwo', sourceUrl: 'https://www.kuwo.cn/play_detail/99' },
            { id: 'm2', type: 'music', source: 'kuwo', sourceUrl: 'https://www.kuwo.cn/play_detail/99' },
            { id: 'm3', type: 'music', source: 'netease', sourceUrl: 'https://music.163.com/#/song?id=7' },
        ]);
        expect(byKey.get('music:kuwo:99')).toBe('m1');
        expect(byKey.get('music:netease:7')).toBe('m3');
        expect(byKey.size).toBe(2);
        // ⛔ Steam 那条不该进音乐判重表
        expect(byKey.has('music:steam:620')).toBe(false);
    });
});

describe('musicSync 落库字段（musicEntrySeed）', () => {
    it('基础四件：type / title / source / sourceName / sourceUrl', () => {
        const seed = musicEntrySeed(song());
        expect(seed).not.toBeNull();
        expect(seed!.type).toBe('music');
        expect(seed!.title).toBe('海阔天空');
        expect(seed!.source).toBe('netease');
        // 🔴 sourceName 必须显式写：音乐平台不在 PROVIDERS ⇒ 只写 source 时来源角标会空白
        expect(seed!.sourceName).toBe('网易云');
        expect(seed!.sourceUrl).toBe('https://music.163.com/#/song?id=347230');
    });

    it('author（歌手）/ album 缺失即不写键（⛔ 不落空串，否则表单看着像「填过又删了」）', () => {
        const seed = musicEntrySeed(song({ artist: undefined, album: '   ' }))!;
        // 🔴 2026-11-14：歌手落到 `author`（音乐的「艺术家」= author），⛔ 不是 `artist`（那是漫画画师）
        expect('author' in seed).toBe(false);
        expect('artist' in seed).toBe(false);
        expect('album' in seed).toBe(false);
    });

    it('🔴 歌曲时长不落库（本仓没有这个字段，⛔ 别塞进 durationMin / listenMinutes）', () => {
        const seed = musicEntrySeed(song({ duration: 269 }))!;
        const asRecord = seed as unknown as Record<string, unknown>;
        expect('duration' in asRecord).toBe(false);
        expect('durationMin' in asRecord).toBe(false);
        expect('listenMinutes' in asRecord).toBe(false);
    });

    it('非法平台 / 空歌名 ⇒ null（不建半条脏条目）', () => {
        expect(musicEntrySeed(song({ source: 'douban' as never }))).toBeNull();
        expect(musicEntrySeed(song({ name: '   ' }))).toBeNull();
    });

    it('封面走 platformCoverUrl：网易云原样、QQ 抬到 1500、酷狗删尺寸段', () => {
        expect(musicEntrySeed(song({ coverUrl: 'https://p1.music.126.net/a==/1.jpg' }))!.poster).toBe(
            'https://p1.music.126.net/a==/1.jpg',
        );
        expect(
            musicEntrySeed(song({ source: 'qq', coverUrl: 'https://y.gtimg.cn/T002R300x300M000abc.jpg' }))!.poster,
        ).toBe('https://y.gtimg.cn/T002R1500x1500M000abc.jpg');
        expect(
            musicEntrySeed(song({ source: 'kugou', coverUrl: 'https://imge.kugou.com/stdmusic/480/20230920/a.jpg' }))!
                .poster,
        ).toBe('https://imge.kugou.com/stdmusic/20230920/a.jpg');
    });

    it('🔴 酷我必须用 albumPicPath 专辑图（它的 coverUrl 是横的 MV 图）', () => {
        const seed = musicEntrySeed(
            song({
                source: 'kuwo',
                coverUrl: 'https://img1.kuwo.cn/star/starheads/324/182/mv.jpg',
                albumPicPath: '120/s3s94/93/211513640.jpg',
            }),
        )!;
        expect(seed.poster).toBe('https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg');
    });

    it('酷我没有 albumPicPath（只有 MV 横图）⇒ 不写 poster 键', () => {
        const seed = musicEntrySeed(song({ source: 'kuwo', coverUrl: 'https://img1.kuwo.cn/star/starheads/324/182/mv.jpg' }))!;
        expect('poster' in seed).toBe(false);
    });
});

describe('musicSync 批量去重', () => {
    it('同一平台同一 id 只留第一条', () => {
        const out = dedupeMusicSongs([song(), song(), song({ name: '海阔天空 (Live)' })]);
        expect(out.length).toBe(1);
        expect(out[0].name).toBe('海阔天空');
    });

    it('🔴 跨平台各留一条（酷我和网易云是两个不同来源，⛔ 别按标题合并）', () => {
        const out = dedupeMusicSongs([
            song(),
            song({ source: 'kuwo', id: '99', webUrl: 'https://www.kuwo.cn/play_detail/99' }),
        ]);
        expect(out.length).toBe(2);
    });

    it('非法平台 / 缺 id 的条目被丢掉（不参与去重也不落库）', () => {
        const out = dedupeMusicSongs([song({ id: '' }), song({ source: 'douban' as never })]);
        expect(out).toEqual([]);
    });
});

describe('musicSync 卡片结果落库（musicSeedFromResult）', () => {
    /** 卡片结果的最小形态（`pure/songLibrary.songLibraryResults` 的真产出） */
    function card(over: Partial<MusicSearchResult> = {}): MusicSearchResult {
        return {
            id: 'songlib:netease:347230',
            title: '海阔天空',
            artist: 'BEYOND',
            album: '乐与怒',
            duration: 326,
            cover: 'https://p1.music.126.net/abc==/1.jpg',
            source: 'songlib',
            sourceUrl: 'https://music.163.com/#/song?id=347230',
            ...over,
        };
    }

    it('从 songlib:{source}:{id} 反解平台，字段照搬', () => {
        const seed = musicSeedFromResult(card())!;
        expect(seed.type).toBe('music');
        expect(seed.title).toBe('海阔天空');
        expect(seed.source).toBe('netease');
        expect(seed.sourceName).toBe('网易云');
        // 🔴 2026-11-14：歌手落 `author`（音乐的「艺术家」= author），`artist` 是漫画画师
        expect(seed.author).toBe('BEYOND');
        expect(seed.album).toBe('乐与怒');
        expect(seed.sourceUrl).toBe('https://music.163.com/#/song?id=347230');
    });

    it('🔴 封面直接取 r.cover，**不再**过 platformCoverUrl（否则酷我会被抹成空）', () => {
        // 酷我卡片的 cover 已经是 albumcover/1000 的最终地址；再走一遍改写会拿不到 albumPicPath
        const seed = musicSeedFromResult(
            card({ id: 'songlib:kuwo:211513640', cover: 'https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg' }),
        )!;
        expect(seed.source).toBe('kuwo');
        expect(seed.poster).toBe('https://img1.kuwo.cn/star/albumcover/1000/s3s94/93/211513640.jpg');
    });

    it('🔴 歌曲时长不落库（结果卡片有 duration，条目字段里不该出现）', () => {
        const seed = musicSeedFromResult(card({ duration: 326 }))!;
        const asRecord = seed as unknown as Record<string, unknown>;
        expect('duration' in asRecord).toBe(false);
        expect('durationMin' in asRecord).toBe(false);
        expect('listenMinutes' in asRecord).toBe(false);
    });

    it('缺失即不写键（空作者 / 空 album / 空封面都不落空串）', () => {
        const seed = musicSeedFromResult(card({ artist: undefined, album: '  ', cover: undefined }))!;
        expect('author' in seed).toBe(false);
        expect('artist' in seed).toBe(false);
        expect('album' in seed).toBe(false);
        expect('poster' in seed).toBe(false);
    });

    it('不是 songlib 结果 / 平台键非法 / 空歌名 ⇒ null', () => {
        expect(musicSeedFromResult(card({ id: 'douban:123' }))).toBeNull();
        expect(musicSeedFromResult(card({ id: 'songlib:douban:1' }))).toBeNull();
        expect(musicSeedFromResult(card({ title: '   ' }))).toBeNull();
        expect(musicSeedFromResult(null)).toBeNull();
        expect(musicSeedFromResult(undefined)).toBeNull();
    });

    it('sourceUrl 为空仍然建条目（可播的歌不该因为判不了重就被丢掉）', () => {
        const seed = musicSeedFromResult(card({ sourceUrl: undefined }))!;
        expect(seed.sourceUrl).toBe('');
        expect(seed.title).toBe('海阔天空');
    });
});

// 2026-11-09 阶段 C 真机核对发现的断点：用户库里 17 首音乐有 **16 首来自豆瓣**（`source: 'douban'`、
// `sourceUrl` 指向 `music.douban.com/subject/…`），它们没有 `music:{平台}:{id}` 键 ⇒
// `indexMusicEntries` 一条都认不出来 ⇒ 判重只能落到「同名 ⇒ 跳过」⇒ **整个清单同步对这类用户一首也进不来**。
// 下面这一组锁的就是补洞后的判据：什么时候可以「认领」那条豆瓣条目，什么时候绝不能。
describe('musicSync 认领豆瓣同名条目（adoptableMusicEntryId）', () => {
    /** 豆瓣来的老条目（无平台键）—— 形状对齐 `adoptableMusicEntryId` 的入参，⛔ 别写成 `Record<string, unknown>`（tsc 会拒） */
    interface DoubanEntry {
        id: string;
        type?: string;
        title: string;
        source?: string;
        sourceUrl?: string;
        /** 🔴 歌手在 `author`（音乐的「艺术家」）；`artist` 是漫画画师，老数据才可能有 */
        author?: string;
        artist?: string;
    }
    function doubanEntry(over: Partial<DoubanEntry> = {}): DoubanEntry {
        return {
            id: 'e1',
            type: 'music',
            title: '七里香',
            source: 'douban',
            sourceUrl: 'https://music.douban.com/subject/1401853/',
            author: '周杰伦',
            ...over,
        };
    }

    it('同名 + 豆瓣来源（无平台键）+ 歌手一致 ⇒ 认领', () => {
        expect(adoptableMusicEntryId([doubanEntry()], '七里香', '周杰伦')).toBe('e1');
    });

    it('歌手归一后判同（全角/空格/大小写差异不阻断认领）', () => {
        // 归一用的是 `pure/importConflict.normalizeTitleForMatch`：NFKC + 折叠空白 + 小写 ⇒
        // 全角 `ＢＥＹＯＮＤ` 与半角 `beyond` 判同（NFKC 会把全角字母折成半角）。
        expect(adoptableMusicEntryId([doubanEntry({ author: 'ＢＥＹＯＮＤ' })], '七里香', 'beyond')).toBe('e1');
        // ⚠️ 边界：归一**不做简繁转换** —— `周杰倫` 与 `周杰伦` 是不同汉字，判不同、不认领。
        //    这条是反例夹具，⛔ 别当成 bug 改掉（改了就说明有人在归一里偷偷加了简繁表）。
        expect(adoptableMusicEntryId([doubanEntry({ author: '周杰倫' })], '七里香', '周杰伦')).toBe('');
    });

    it('🔴 2026-11-14：老数据把歌手写在 `artist` 上也要能认（读侧兜底）', () => {
        // `pure/musicArtist.musicArtistOf` 在 `author` 空、且不是书籍时回落 `artist`
        expect(adoptableMusicEntryId([doubanEntry({ author: undefined, artist: '周杰伦' })], '七里香', '周杰伦')).toBe(
            'e1',
        );
    });

    it('🔴 库内那条已经是平台条目 ⇒ ⛔ 不认领（那是另一首歌，同名也不行）', () => {
        const netease = doubanEntry({
            source: 'netease',
            sourceUrl: 'https://music.163.com/#/song?id=1',
        });
        expect(adoptableMusicEntryId([netease], '七里香', '周杰伦')).toBe('');
    });

    it('🔴 同名但歌手不同 ⇒ ⛔ 不认领（《海阔天空》BEYOND / 黄家驹 是两首，认领了就丢一首）', () => {
        expect(adoptableMusicEntryId([doubanEntry({ author: 'BEYOND' })], '海阔天空', '黄家驹')).toBe('');
    });

    it('一方缺歌手时放行（豆瓣条目常缺歌手，卡死等于不认领）', () => {
        expect(adoptableMusicEntryId([doubanEntry({ author: undefined })], '七里香', '周杰伦')).toBe('e1');
        expect(adoptableMusicEntryId([doubanEntry()], '七里香', undefined)).toBe('e1');
    });

    it('标题不同 / 空标题 / 非 music 类型 / 空 id ⇒ 不认领', () => {
        expect(adoptableMusicEntryId([doubanEntry()], '晴天', '周杰伦')).toBe('');
        expect(adoptableMusicEntryId([doubanEntry()], '   ', '周杰伦')).toBe('');
        expect(adoptableMusicEntryId([doubanEntry({ type: 'game' })], '七里香', '周杰伦')).toBe('');
        expect(adoptableMusicEntryId([doubanEntry({ id: '' })], '七里香', '周杰伦')).toBe('');
        expect(adoptableMusicEntryId([], '七里香', '周杰伦')).toBe('');
    });

    it('多条同名豆瓣条目 ⇒ 取第一条（与 indexMusicEntries 同为「先到先得」）', () => {
        const list = [doubanEntry({ id: 'a1' }), doubanEntry({ id: 'a2' })];
        expect(adoptableMusicEntryId(list, '七里香', '周杰伦')).toBe('a1');
    });

    it('🔴 认领白名单只含平台字段 —— 标题 / 歌手 / 专辑 / 评分 ⛔ 不在里面', () => {
        // 为什么这条必须存在：认领只代表「判定为同一首」，不代表允许拿平台侧标题
        // （常带「【MV】」「1080P」）覆盖用户从豆瓣挑的标题。谁把 title 加进白名单，这里就红。
        expect([...MUSIC_ADOPT_FIELDS].sort()).toEqual(['poster', 'source', 'sourceName', 'sourceUrl']);
    });
});
