// 搜索结果统一展示模型（pure/searchDisplay）单测
import { describe, it, expect } from 'vitest';
import { describeSearchResult, sourceIdOf, coverHue } from 'pure/searchDisplay';
import type { SearchResult } from 'pure/searchDisplay';
import type { TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult } from 'services/resultTypes';
import type { BangumiSearchResult } from 'services/bangumi';

describe('describeSearchResult 影视/剧集（TMDB / 豆瓣兜底）', () => {
    it('主源结果：cover 经 TMDB 图片拼接、source=TMDB、sourceUrl 指向 themoviedb.org', () => {
        const r: TmdbSearchResult = {
            id: 1,
            title: '沙丘',
            originalTitle: 'Dune',
            year: 2021,
            mediaType: 'movie',
            posterPath: '/abc.jpg',
        };
        const d = describeSearchResult(r);
        expect(d.title).toBe('沙丘');
        expect(d.sub).toBe('Dune');
        expect(d.year).toBe(2021);
        expect(d.cover).toContain('image.tmdb.org');
        expect(d.cover).toContain('/abc.jpg');
        expect(d.source).toBe('TMDB');
        expect(d.sourceUrl).toBe('https://www.themoviedb.org/movie/1');
    });

    it('剧集主源：sourceUrl 走 /tv 路径', () => {
        const r: TmdbSearchResult = {
            id: 10,
            title: '葬送的芙莉莲',
            originalTitle: 'Frieren',
            year: 2023,
            mediaType: 'tv',
            posterPath: '/y.jpg',
        };
        expect(describeSearchResult(r).sourceUrl).toBe('https://www.themoviedb.org/tv/10');
    });

    it('豆瓣兜底结果：封面直用完整 URL，source=豆瓣，sourceUrl 指向 movie.douban.com', () => {
        const r: TmdbSearchResult = {
            id: 1292,
            title: '流浪地球',
            originalTitle: '流浪地球',
            year: 2019,
            mediaType: 'movie',
            posterPath: 'https://img.example.com/poster.jpg',
            director: '郭帆',
            source: 'douban',
        };
        const d = describeSearchResult(r);
        expect(d.cover).toBe('https://img.example.com/poster.jpg');
        expect(d.source).toBe('豆瓣');
        expect(d.sub).toBe('郭帆');
        expect(d.meta).toBeUndefined();
        expect(d.sourceUrl).toBe('https://movie.douban.com/subject/1292/');
    });

    it('无原名时 sub 回退导演（作者槽位恒有真实内容），meta 去重不重复导演', () => {
        const d = describeSearchResult({
            id: 3001114,
            title: '流浪地球2',
            originalTitle: '流浪地球2',
            year: 2023,
            mediaType: 'movie',
            posterPath: 'https://img.example.com/2.jpg',
            director: '郭帆',
            country: '中国',
            language: '汉语普通话',
            durationMin: 173,
            source: 'douban',
        } as TmdbSearchResult);
        expect(d.sub).toBe('郭帆');
        expect(d.meta).toBe('中国 · 汉语普通话 · 173 分钟');
    });

    it('无原名且无导演时 sub 保持 undefined（不产生假占位）', () => {
        const d = describeSearchResult({
            id: 2,
            title: 'Y',
            originalTitle: 'Y',
            mediaType: 'movie',
            source: 'douban',
        } as TmdbSearchResult);
        expect(d.sub).toBeUndefined();
    });

    it('豆瓣详情补全字段：meta 拼接 导演 · 国家·语言 · 片长', () => {
        const r: TmdbSearchResult = {
            id: 3001114,
            title: '沙丘',
            originalTitle: 'Dune',
            year: 2021,
            mediaType: 'movie',
            posterPath: 'https://img.example.com/dune.jpg',
            director: '丹尼斯·维伦纽瓦',
            country: '美国',
            language: '英语',
            durationMin: 156,
            source: 'douban',
        };
        const d = describeSearchResult(r);
        expect(d.sub).toBe('Dune');
        expect(d.meta).toBe('丹尼斯·维伦纽瓦 · 美国 · 英语 · 156 分钟');
    });

    it('无导演时 meta 用 国家·语言 兜底，仍为空则无 meta', () => {
        const d = describeSearchResult({
            id: 1,
            title: 'X',
            originalTitle: 'X',
            mediaType: 'movie',
            country: '日本',
            language: '日语',
            source: 'douban',
        } as TmdbSearchResult);
        expect(d.meta).toBe('日本 · 日语');
        const d2 = describeSearchResult({
            id: 2,
            title: 'Y',
            originalTitle: 'Y',
            mediaType: 'movie',
            source: 'douban',
        } as TmdbSearchResult);
        expect(d2.meta).toBeUndefined();
    });
});

describe('describeSearchResult 书籍（Douban 单源）', () => {
    it('作者为 sub、出版社为 meta、source=豆瓣、sourceUrl 指向 book.douban.com', () => {
        const r: BookSearchResult = {
            id: 'douban:1001',
            title: '活着',
            author: '余华',
            publisher: '作家出版社',
            year: 1993,
            ratingCount: 123456,
            source: 'douban',
        };
        const d = describeSearchResult(r);
        expect(d.sub).toBe('余华');
        expect(d.meta).toBe('作家出版社');
        expect(d.ratingCount).toBe(123456);
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://book.douban.com/subject/1001/');
    });
});

describe('describeSearchResult 游戏（Douban 单源）', () => {
    it('开发商为 sub、平台为 meta、source=豆瓣、sourceUrl 指向 www.douban.com/game', () => {
        const r: GameSearchResult = {
            id: 26757460,
            title: '塞尔达传说：旷野之息',
            developer: 'Nintendo EPD',
            platform: 'Switch',
            year: 2017,
            source: 'douban',
        };
        const d = describeSearchResult(r);
        expect(d.sub).toBe('Nintendo EPD');
        expect(d.meta).toBe('Switch');
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://www.douban.com/game/26757460/');
    });

    it("platform 缺失时仍命中游戏分支（'platform' in r 判别）", () => {
        const r: GameSearchResult = {
            id: 26757460,
            title: '塞尔达传说：旷野之息',
            year: 2017,
            platform: undefined,
            source: 'douban',
        };
        expect(describeSearchResult(r).sourceUrl).toBe('https://www.douban.com/game/26757460/');
    });
});

describe('describeSearchResult 动画（Bangumi / 豆瓣兜底）', () => {
    it('Bangumi 主源：中文名为标题、日文原名为 sub、制作公司为 meta、source=Bangumi、sourceUrl 指向 bgm.tv', () => {
        const r: BangumiSearchResult = {
            id: 425619,
            title: '葬送的芙莉莲',
            originalTitle: '葬送のフリーレン',
            year: 2023,
            genres: ['奇幻'],
            studio: 'Madhouse',
            cover: 'https://lain.bgm.tv/cover.jpg',
        };
        const d = describeSearchResult(r);
        expect(d.title).toBe('葬送的芙莉莲');
        expect(d.sub).toBe('葬送のフリーレン');
        expect(d.meta).toBe('Madhouse');
        expect(d.source).toBe('Bangumi');
        expect(d.sourceUrl).toBe('https://bgm.tv/subject/425619');
    });

    it('豆瓣兜底动画：sourceUrl 指向 movie.douban.com（动画用 movie 子域）', () => {
        const r: BangumiSearchResult = {
            id: 35569056,
            title: '葬送的芙莉莲',
            originalTitle: '葬送のフリーレン',
            year: 2023,
            genres: [],
            source: 'douban',
        };
        expect(describeSearchResult(r).sourceUrl).toBe('https://movie.douban.com/subject/35569056/');
    });

    it('无原名时 sub 回退制作公司，避免空行', () => {
        const r: BangumiSearchResult = { id: 2, title: 'X', originalTitle: 'X', genres: [], studio: 'Studio A' };
        const d = describeSearchResult(r);
        expect(d.sub).toBe('Studio A');
    });
});

describe('describeSearchResult 音乐（Douban 单源）', () => {
    it('音乐结果：歌手副行 + 专辑 meta + 豆瓣来源', () => {
        const d = describeSearchResult({ id: 'douban:4899751', title: '不再犹豫', artist: 'BEYOND', album: '犹豫', year: 1991, rating: 9.7, ratingCount: 127431, cover: 'https://img1.doubanio.com/x.jpg', source: 'douban' });
        expect(d.title).toBe('不再犹豫');
        expect(d.sub).toBe('BEYOND');
        expect(d.meta).toBe('犹豫');
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://music.douban.com/subject/4899751/');
    });
});

describe('describeSearchResult 展示层泛化：source 查表直达/封面（新源）', () => {
    it('openLibrary：徽标 OpenLibrary、直达 openlibrary.org{key}、封面 cover_i 拼 M.jpg', () => {
        const r: BookSearchResult & { cover_i?: number } = {
            id: '/works/OL45883W',
            title: 'A Game of Thrones',
            author: 'George R. R. Martin',
            publisher: 'Bantam',
            cover_i: 24198713,
            source: 'openLibrary',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('OpenLibrary');
        expect(d.sourceUrl).toBe('https://openlibrary.org/works/OL45883W');
        expect(d.cover).toBe('https://covers.openlibrary.org/b/id/24198713-M.jpg');
        expect(d.meta).toBe('Bantam');
    });

    it('googleBooks：徽标 Google Books、直达 books?id={id}、封面 thumbnail 原样（缺 authors 不崩、sub 留空）', () => {
        const thumb = 'https://books.google.com/books/content?id=zyTCAlFPjgYC&printsec=frontcover&img=1&zoom=1';
        const r: BookSearchResult = {
            id: 'zyTCAlFPjgYC',
            title: 'The Hobbit',
            thumbnail: thumb,
            source: 'googleBooks',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('Google Books');
        expect(d.sourceUrl).toBe('https://books.google.com/books?id=zyTCAlFPjgYC');
        expect(d.cover).toBe(thumb);
        expect(d.sub).toBeUndefined();
    });

    it('steam：徽标 Steam、直达 store/app/{appid}、封面竖版 library_600x900', () => {
        const r: GameSearchResult = {
            id: 570,
            title: 'Dota 2',
            source: 'steam',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('Steam');
        expect(d.sourceUrl).toBe('https://store.steampowered.com/app/570');
        expect(d.cover).toBe('https://cdn.cloudflare.steamstatic.com/steam/apps/570/library_600x900.jpg');
    });

    it('musicbrainz：徽标 MusicBrainz、直达 release-group/{id}、无封面可探测时 cover 为 undefined', () => {
        const r: MusicSearchResult = {
            id: 'f0a4a9f1-1111-4c3a-8d1c-2a9f1c3f8a6a',
            title: 'Abbey Road',
            artist: 'The Beatles',
            album: 'Abbey Road',
            source: 'musicbrainz',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('MusicBrainz');
        expect(d.sourceUrl).toBe('https://musicbrainz.org/release-group/f0a4a9f1-1111-4c3a-8d1c-2a9f1c3f8a6a');
        expect(d.cover).toBeUndefined();
    });

    it('itunes：徽标 iTunes、直达用结果自带 collectionViewUrl、artworkUrl100 放大 600x600', () => {
        const r: SearchResult = {
            id: 1440783595,
            title: '夜曲',
            artist: '周杰伦',
            album: '十一月的萧邦',
            collectionViewUrl: 'https://music.apple.com/cn/album/1440783595',
            artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ab/12/thumb.jpg/100x100bb.jpg',
            source: 'itunes',
        } as unknown as SearchResult;
        const d = describeSearchResult(r);
        expect(d.source).toBe('iTunes');
        expect(d.sourceUrl).toBe('https://music.apple.com/cn/album/1440783595');
        expect(d.cover).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/ab/12/thumb.jpg/600x600bb.jpg');
    });

    it('omdb：徽标 IMDb、直达 imdb.com/title/{imdbID}、Poster 直用（缺 director 不崩）', () => {
        const d = describeSearchResult({
            id: 'tt0111161',
            imdbID: 'tt0111161',
            title: 'The Shawshank Redemption',
            mediaType: 'movie',
            year: 1994,
            poster: 'https://m.media-amazon.com/images/M/x_V1_SX300.jpg',
            source: 'omdb',
        } as unknown as SearchResult);
        expect(d.source).toBe('IMDb');
        expect(d.sourceUrl).toBe('https://www.imdb.com/title/tt0111161');
        expect(d.cover).toBe('https://m.media-amazon.com/images/M/x_V1_SX300.jpg');
        expect(d.sub).toBeUndefined();
    });

    it('omdb：Poster=N/A 滤除 → cover undefined', () => {
        const d = describeSearchResult({
            id: 'tt999',
            imdbID: 'tt999',
            title: 'Unknown',
            mediaType: 'movie',
            poster: 'N/A',
            source: 'omdb',
        } as unknown as SearchResult);
        expect(d.cover).toBeUndefined();
        expect(d.sourceUrl).toBe('https://www.imdb.com/title/tt999');
    });

    it('anilist：徽标 AniList、直达 anilist.co/anime/{id}、cover 沿用结果字段', () => {
        const r: BangumiSearchResult = {
            id: 16498,
            title: '进击的巨人',
            originalTitle: 'Shingeki no Kyojin',
            genres: [],
            cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx16498-x.jpg',
            studio: 'WIT STUDIO',
            source: 'anilist',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('AniList');
        expect(d.sourceUrl).toBe('https://anilist.co/anime/16498');
        expect(d.cover).toBe('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx16498-x.jpg');
    });

    it('igdb：徽标 IGDB、直达 igdb.com/games/{id}、game 形状 meta 拼平台、评分 10 分制直显', () => {
        const r: GameSearchResult = {
            id: 1942,
            title: 'The Witcher 3',
            platform: 'PC',
            developer: 'CD Projekt Red',
            year: 2015,
            cover: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cov123.jpg',
            rating: 9.5,
            source: 'igdb',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('IGDB');
        expect(d.sourceUrl).toBe('https://www.igdb.com/games/1942');
        expect(d.cover).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/cov123.jpg');
        expect(d.meta).toBe('PC');
    });

    it('sourceIdOf igdb 结果原样返回 igdb（分组键）', () => {
        expect(sourceIdOf({ id: 1, title: 'X', source: 'igdb' } as unknown as SearchResult)).toBe('igdb');
    });
});

describe('describeSearchResult source 查表：显式 source 的旧三源直达', () => {
    it('tmdb 显式 source=tmdb：徽标 TMDB、直达 /tv 路径', () => {
        const r: TmdbSearchResult = {
            id: 10,
            title: 'Frieren',
            originalTitle: 'Frieren',
            year: 2023,
            mediaType: 'tv',
            posterPath: '/y.jpg',
            source: 'tmdb',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('TMDB');
        expect(d.sourceUrl).toBe('https://www.themoviedb.org/tv/10');
    });

    it('bangumi 显式 source=bangumi：徽标 Bangumi、直达 bgm.tv/subject', () => {
        const r: BangumiSearchResult = {
            id: 425619,
            title: '葬送的芙莉莲',
            originalTitle: '葬送のフリーレン',
            genres: ['奇幻'],
            studio: 'Madhouse',
            cover: 'https://lain.bgm.tv/c.jpg',
            source: 'bangumi',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('Bangumi');
        expect(d.sourceUrl).toBe('https://bgm.tv/subject/425619');
    });

    it('douban 显式 source=douban：徽标豆瓣、直达 movie.douban.com/subject（影视形状）', () => {
        const r: TmdbSearchResult = {
            id: 1292,
            title: '霸王别姬',
            originalTitle: '霸王别姬',
            mediaType: 'movie',
            posterPath: 'https://img.doubanio.com/p.jpg',
            source: 'douban',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://movie.douban.com/subject/1292/');
        expect(d.cover).toBe('https://img.doubanio.com/p.jpg');
    });
});

describe('describeSearchResult source 兜底', () => {
    it('旧书数据无 source：兜底豆瓣徽标 + book.douban URL', () => {
        const r: BookSearchResult = {
            id: 'douban:1002',
            title: '三体',
            author: '刘慈欣',
            publisher: '重庆出版社',
        };
        const d = describeSearchResult(r);
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://book.douban.com/subject/1002/');
    });

    it('未知 source：兜底豆瓣徽标 + movie.douban URL + 封面直用完整 URL', () => {
        const d = describeSearchResult({
            id: 1,
            title: 'X',
            originalTitle: 'X',
            mediaType: 'movie',
            posterPath: 'https://img.example.com/x.jpg',
            source: 'unknown-foo',
        } as unknown as SearchResult);
        expect(d.source).toBe('豆瓣');
        expect(d.sourceUrl).toBe('https://movie.douban.com/subject/1/');
        expect(d.cover).toBe('https://img.example.com/x.jpg');
    });
});

describe('coverHue 占位色相', () => {
    it('同一种子稳定同色且在 0-359 范围内', () => {
        const a = coverHue('abc');
        const b = coverHue('abc');
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(360);
    });

    it('不同种子尽量区分（至少不全部相同）', () => {
        const hues = new Set(['dune', '三体', 'gundam', 'elfen', 'halo'].map(coverHue));
        expect(hues.size).toBeGreaterThan(1);
    });
});

describe('sourceIdOf 结果来源 id 解析（分栏分组键）', () => {
    it('显式 source（douban/openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist）原样返回', () => {
        expect(sourceIdOf({ source: 'douban' } as unknown as SearchResult)).toBe('douban');
        expect(sourceIdOf({ source: 'openLibrary' } as unknown as SearchResult)).toBe('openLibrary');
        expect(sourceIdOf({ source: 'googleBooks' } as unknown as SearchResult)).toBe('googleBooks');
        expect(sourceIdOf({ source: 'steam' } as unknown as SearchResult)).toBe('steam');
        expect(sourceIdOf({ source: 'musicbrainz' } as unknown as SearchResult)).toBe('musicbrainz');
        expect(sourceIdOf({ source: 'itunes' } as unknown as SearchResult)).toBe('itunes');
        expect(sourceIdOf({ source: 'omdb' } as unknown as SearchResult)).toBe('omdb');
        expect(sourceIdOf({ source: 'anilist' } as unknown as SearchResult)).toBe('anilist');
    });

    it('原生 TMDB 影视结果无 source → 回退 tmdb（movie 与 tv 同）', () => {
        expect(sourceIdOf({ mediaType: 'movie', title: 'X' } as unknown as SearchResult)).toBe('tmdb');
        expect(sourceIdOf({ mediaType: 'tv', title: 'X' } as unknown as SearchResult)).toBe('tmdb');
    });

    it('原生 Bangumi 动画结果无 source（带 studio）→ 回退 bangumi', () => {
        expect(sourceIdOf({ title: 'X', studio: 'A' } as unknown as SearchResult)).toBe('bangumi');
    });

    it('书籍/游戏/音乐形状无 source（旧数据，有 author/platform/album）→ 回退 douban', () => {
        expect(sourceIdOf({ title: '三体', author: '刘慈欣' } as unknown as SearchResult)).toBe('douban');
        expect(sourceIdOf({ title: 'Dota', platform: 'PC' } as unknown as SearchResult)).toBe('douban');
        expect(sourceIdOf({ title: '夜曲', album: '萧邦', artist: '周杰伦' } as unknown as SearchResult)).toBe('douban');
    });

    it('缺 source 的影视兜底默认 movie → tmdb（与 describeSearchResult 语义一致）', () => {
        expect(sourceIdOf({ title: '老片' } as unknown as SearchResult)).toBe('tmdb');
    });
});
