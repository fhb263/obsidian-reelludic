import { describe, it, expect } from 'vitest';
import { buildSearchUrl, parseItunesResults, toMusicResult, upscaleArtwork, ItunesClient } from 'services/itunes';

// ⚠️ fixture 基于 itunes.apple.com/search 真实响应形态校准（#165 T8：entity=album 限定专辑，
// collection* 字段语义对齐 MusicSearchResult：collectionId/collectionName/artistName/releaseDate/artworkUrl100/collectionViewUrl）
const fullSearchJson = JSON.stringify({
    resultCount: 1,
    results: [
        {
            wrapperType: 'collection',
            collectionType: 'Album',
            artistId: 111051,
            collectionId: 1440847618,
            artistName: 'Lady Gaga',
            collectionName: 'The Fame',
            collectionCensoredName: 'The Fame',
            collectionViewUrl: 'https://music.apple.com/us/album/the-fame/1440847618?uo=4',
            artworkUrl60: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/6ced6f24-1df2-7d5b-4d0f/source/60x60bb.jpg',
            artworkUrl100: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/6ced6f24-1df2-7d5b-4d0f/source/100x100bb.jpg',
            releaseDate: '2008-08-19T07:00:00Z',
            primaryGenreName: 'Pop',
        },
    ],
});

/** 缺 collectionId / 缺 collectionName（应滤除） + 无 artwork + releaseDate 畸形/缺失 + 无 collectionViewUrl 的异常条目组合 */
const abnormalSearchJson = JSON.stringify({
    resultCount: 5,
    results: [
        { collectionId: 1001 }, // 缺 collectionName → 滤除
        { collectionName: '缺少 id 应被过滤' }, // 缺 collectionId → 滤除
        { collectionId: '2002', collectionName: 'collectionId 非 number 应被过滤' }, // 非有限 number → 滤除
        {
            collectionId: 3003,
            collectionName: 'No Artwork No Date',
            artistName: 'Artist C',
            // artworkUrl100 / releaseDate / collectionViewUrl 全缺 → 安全保留（undefined）
        },
        {
            collectionId: 3004,
            collectionName: 'Malformed Date',
            artistName: 'Artist D',
            releaseDate: '发行日期未知', // 非 YYYY 前缀 → year 提取为 undefined
            artworkUrl100: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/ef/source/100x100bb.jpg',
        },
    ],
});

/** 无尺寸 token 的 artwork URL（非 iTunes 正常形态，放大无法进行 → undefined） */
const noTokenJson = JSON.stringify({
    resultCount: 1,
    results: [
        {
            collectionId: 4004,
            collectionName: 'No Size Token',
            artworkUrl100: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/ef/full.jpg',
        },
    ],
});

const emptySearchJson = JSON.stringify({ resultCount: 0, results: [] });

describe('itunes URL 构造', () => {
    it('搜索 URL 指向 search 端点，term URL 编码 + entity=album + limit=20', () => {
        const url = buildSearchUrl('周杰伦');
        expect(url).toBe(
            'https://itunes.apple.com/search?term=' + encodeURIComponent('周杰伦') + '&entity=album&limit=20',
        );
    });

    it('空格/特殊字符查询正确编码', () => {
        const url = buildSearchUrl('The Fame (Deluxe)');
        expect(url).toContain(encodeURIComponent('The Fame (Deluxe)'));
    });
});

describe('parseItunesResults', () => {
    it('results → RawItunesItem（collectionId/collectionName/artistName/releaseDate/artworkUrl100/collectionViewUrl 安全读取）', () => {
        const items = parseItunesResults(fullSearchJson);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            collectionId: 1440847618,
            collectionName: 'The Fame',
            artistName: 'Lady Gaga',
            releaseDate: '2008-08-19T07:00:00Z',
            artworkUrl100: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/6ced6f24-1df2-7d5b-4d0f/source/100x100bb.jpg',
            collectionViewUrl: 'https://music.apple.com/us/album/the-fame/1440847618?uo=4',
        });
    });

    it('异常条目容错：缺 collectionId / 缺 collectionName / collectionId 非 number 滤除；缺 artwork/releaseDate/collectionViewUrl 安全保留（undefined）', () => {
        const items = parseItunesResults(abnormalSearchJson);
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({
            collectionId: 3003,
            collectionName: 'No Artwork No Date',
            artistName: 'Artist C',
            releaseDate: undefined,
            artworkUrl100: undefined,
            collectionViewUrl: undefined,
        });
        expect(items[1].releaseDate).toBe('发行日期未知');
        expect(items[1].artworkUrl100).toContain('100x100bb.jpg');
    });

    it('空结果（results 缺失或空）→ 空数组；顶层非对象结构安全返回空', () => {
        expect(parseItunesResults(emptySearchJson)).toEqual([]);
        expect(parseItunesResults('{}')).toEqual([]);
        expect(parseItunesResults(JSON.stringify({ results: [] }))).toEqual([]);
        expect(parseItunesResults(JSON.stringify([]))).toEqual([]);
    });
});

describe('upscaleArtwork / cover 放大正则', () => {
    it('artworkUrl100 中 100x100bb token 原位替换为 600x600bb（URL 其余路径原样保留）', () => {
        expect(upscaleArtwork('https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/source/100x100bb.jpg')).toBe(
            'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/source/600x600bb.jpg',
        );
    });

    it('无 artwork（undefined）→ undefined；URL 无尺寸 token（非 NNNxNNNbb 形态）→ undefined', () => {
        expect(upscaleArtwork(undefined)).toBeUndefined();
        expect(upscaleArtwork('https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/ef/full.jpg')).toBeUndefined();
    });
});

describe('toMusicResult 字段映射', () => {
    it('完整条目逐字段映射（id=String(collectionId) / title=collectionName / artist=artistName / year=releaseDate 前4位 / album=collectionName / cover=600x600bb 放大 / source=itunes / sourceUrl=collectionViewUrl）', () => {
        const r = toMusicResult(parseItunesResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: '1440847618', // MusicSearchResult.id: string——数字 collectionId 归一为字符串（同 musicbrainz 同型）
            title: 'The Fame',
            artist: 'Lady Gaga',
            album: 'The Fame', // album 存所属专辑名——entity=album 即专辑
            year: 2008, // releaseDate '2008-08-19T07:00:00Z' 前 4 位
            cover: 'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/6c/ed/6f/6ced6f24-1df2-7d5b-4d0f/source/600x600bb.jpg',
            source: 'itunes',
            sourceUrl: 'https://music.apple.com/us/album/the-fame/1440847618?uo=4',
        });
        // summary 决策：MusicSearchResult.summary 语义为文字简介（点选回填条目简介），
        // primaryGenreName 是流派非简介 → 不映射，恒 undefined（本 fixture 含 primaryGenreName: 'Pop'）
        expect(r.summary).toBeUndefined();
    });

    it('无 artwork / 无 releaseDate / 无 collectionViewUrl 条目 → cover/year/sourceUrl undefined（字段安全，不崩）；album 恒 = collectionName', () => {
        const items = parseItunesResults(abnormalSearchJson);
        const r = toMusicResult(items[0]);
        expect(r.cover).toBeUndefined();
        expect(r.year).toBeUndefined();
        expect(r.sourceUrl).toBeUndefined();
        expect(r.artist).toBe('Artist C');
        expect(r.album).toBe('No Artwork No Date');
    });

    it('releaseDate 畸形（非 YYYY 前缀）→ year undefined；artwork 正常 → cover 放大可用', () => {
        const r = toMusicResult(parseItunesResults(abnormalSearchJson)[1]);
        expect(r.year).toBeUndefined();
        expect(r.cover).toBe(
            'https://is2-ssl.mzstatic.com/image/thumb/Music125/v4/ab/cd/ef/source/600x600bb.jpg',
        );
    });

    it('artworkUrl100 无尺寸 token → cover undefined（无法放大，交由 UI 占位）', () => {
        const r = toMusicResult(parseItunesResults(noTokenJson)[0]);
        expect(r.cover).toBeUndefined();
        expect(r.title).toBe('No Size Token');
    });
});

describe('ItunesClient 注入 http', () => {
    it('search 用注入的 http 拉取并返回 toMusicResult 结果（请求 URL 带编码 term + entity=album + limit=20）', async () => {
        const calls: string[] = [];
        const client = new ItunesClient(async (url) => {
            calls.push(url);
            return fullSearchJson;
        });
        const results = await client.search('lady gaga');
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('itunes');
        expect(results[0].title).toBe('The Fame');
        expect(results[0].sourceUrl).toBe('https://music.apple.com/us/album/the-fame/1440847618?uo=4');
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain(encodeURIComponent('lady gaga'));
        expect(calls[0]).toContain('entity=album');
        expect(calls[0]).toContain('limit=20');
    });
});
