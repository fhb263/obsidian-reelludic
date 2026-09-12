import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseMusicBrainzResults,
    toMusicResult,
    MusicBrainzClient,
    USER_AGENT,
} from 'services/musicbrainz';

// ⚠️ fixture 基于 musicbrainz.org/ws/2/release-group/ 真实响应快照校准（2026-09-02 实测：HTTP 200，带 UA）
// 检索词形态 = 直接 query={q}（Lucene 默认多字段检索，title/artist 均可命中）；limit=20&fmt=json
// 实测响应无 cover-art-archive 字段（需额外 inc 参数）→ 封面 URL 一律纯拼接 coverartarchive，不依赖响应字段
const fullSearchJson = JSON.stringify({
    created: '2026-09-02T00:00:00.000Z',
    count: 6429,
    offset: 0,
    'release-groups': [
        {
            id: '4ce5341e-f625-3a63-9ccb-c56e2cbee02b',
            score: 100,
            count: 1,
            title: 'The Fame',
            'first-release-date': '2008-08-19',
            'primary-type': 'Album',
            'artist-credit': [
                {
                    name: 'Lady Gaga',
                    joinphrase: ' feat. ',
                    artist: { id: '6ae4e609-0a3f-4d5c-8c6e-6e9f2c9f9a09', name: 'Lady Gaga', 'sort-name': 'Gaga, Lady' },
                },
                {
                    name: "Colby O'Donis",
                    artist: { id: '3b6f0c9a-1a2b-4c3d-8e4f-5a6b7c8d9e0f', name: "Colby O'Donis", 'sort-name': "O'Donis, Colby" },
                },
            ],
        },
    ],
});

/** 无 first-release-date / 缺 id / 缺 title / artist-credit 非数组 → parse 容错；缺 title 与 id 条目过滤 */
const abnormalSearchJson = JSON.stringify({
    count: 4,
    offset: 0,
    'release-groups': [
        {
            id: 'a1111111-0000-4000-8000-000000000001',
            title: 'Undated Release',
            'primary-type': 'Album',
        },
        {
            id: 'a1111111-0000-4000-8000-000000000002',
            title: 'No Credit Field',
            'first-release-date': '1999',
            artist: { name: '顶层 artist 字段是干扰（release-group 实际无此字段，应安全忽略）' },
        },
        { title: '缺少 id 应被过滤' },
        { id: 'a1111111-0000-4000-8000-000000000003' }, // 缺少 title 应被过滤
    ],
});

/** 多作者 & joinphrase 极端条目：`A & B`（joinphrase 挂前项后）+ 空结果组合 */
const multiArtistJson = JSON.stringify({
    count: 2,
    offset: 0,
    'release-groups': [
        {
            id: 'b2222222-0000-4000-8000-000000000001',
            title: 'Collaboration Album',
            'first-release-date': '2015-11-06',
            'primary-type': 'Album',
            'artist-credit': [
                { name: 'Artist A', joinphrase: ' & ', artist: { id: 'x1', name: 'Artist A' } },
                { name: 'Artist B', artist: { id: 'x2', name: 'Artist B' } },
            ],
        },
        { id: 'c3333333-0000-4000-8000-000000000001', title: 'No First Date' },
    ],
});

const emptySearchJson = JSON.stringify({ created: '...', count: 0, offset: 0, 'release-groups': [] });

describe('musicbrainz URL 构造', () => {
    it('搜索 URL 指向 release-group 端点，query URL 编码 + fmt=json + limit=20', () => {
        const url = buildSearchUrl('周杰伦');
        expect(url).toBe(
            'https://musicbrainz.org/ws/2/release-group/?query=' + encodeURIComponent('周杰伦') + '&fmt=json&limit=20',
        );
    });

    it('空格/特殊字符查询正确编码', () => {
        const url = buildSearchUrl('The Fame (Deluxe)');
        expect(url).toContain(encodeURIComponent('The Fame (Deluxe)'));
    });
});

describe('parseMusicBrainzResults', () => {
    it('release-groups → RawMusicBrainzItem（id/title/firstReleaseDate/primaryType/artistCredit 安全读取）', () => {
        const items = parseMusicBrainzResults(fullSearchJson);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual({
            id: '4ce5341e-f625-3a63-9ccb-c56e2cbee02b',
            title: 'The Fame',
            firstReleaseDate: '2008-08-19',
            primaryType: 'Album',
            artistCredit: [
                { name: 'Lady Gaga', joinphrase: ' feat. ' },
                { name: "Colby O'Donis", joinphrase: undefined },
            ],
        });
    });

    it('异常条目容错：缺 id / 缺 title 过滤；缺 first-release-date / 缺 artist-credit 安全保留（undefined）', () => {
        const items = parseMusicBrainzResults(abnormalSearchJson);
        expect(items).toHaveLength(2);
        expect(items[0].firstReleaseDate).toBeUndefined();
        expect(items[0].artistCredit).toBeUndefined();
        expect(items[1].title).toBe('No Credit Field');
    });

    it('空结果（release-groups 缺失或空）→ 空数组；非 JSON 结构顶层对象安全返回空', () => {
        expect(parseMusicBrainzResults(emptySearchJson)).toEqual([]);
        expect(parseMusicBrainzResults('{}')).toEqual([]);
        expect(parseMusicBrainzResults(JSON.stringify({ 'release-groups': [] }))).toEqual([]);
        expect(parseMusicBrainzResults(JSON.stringify([]))).toEqual([]);
    });

    it('多作者 & joinphrase 条目完整保留（joinphrase 挂前项后）', () => {
        const items = parseMusicBrainzResults(multiArtistJson);
        expect(items).toHaveLength(2);
        expect(items[0].artistCredit).toEqual([
            { name: 'Artist A', joinphrase: ' & ' },
            { name: 'Artist B', joinphrase: undefined },
        ]);
    });
});

describe('toMusicResult 字段映射', () => {
    it('完整条目逐字段映射（id=release-group id / title / artist=多作者 joinphrase 拼合 / year=日期前4位 / album=title / cover=coverartarchive / source=musicbrainz / sourceUrl）', () => {
        const r = toMusicResult(parseMusicBrainzResults(fullSearchJson)[0]);
        expect(r).toEqual({
            id: '4ce5341e-f625-3a63-9ccb-c56e2cbee02b', // string UUID（对齐 MusicSearchResult.id）
            title: 'The Fame',
            artist: "Lady Gaga feat. Colby O'Donis", // artist-credit name + joinphrase 顺序拼合
            album: 'The Fame', // album 存所属专辑名——release-group 即专辑
            year: 2008, // first-release-date 前 4 位
            cover: 'https://coverartarchive.org/release-group/4ce5341e-f625-3a63-9ccb-c56e2cbee02b/front',
            source: 'musicbrainz',
            sourceUrl: 'https://musicbrainz.org/release-group/4ce5341e-f625-3a63-9ccb-c56e2cbee02b',
        });
    });

    it('多作者 joinphrase 为 " & " → artist = A & B（joinphrase 挂首项后顺序拼合）', () => {
        const r = toMusicResult(parseMusicBrainzResults(multiArtistJson)[0]);
        expect(r.artist).toBe('Artist A & Artist B');
    });

    it('无 first-release-date → year undefined；缺 artist-credit → artist undefined（字段安全，不崩）', () => {
        const items = parseMusicBrainzResults(abnormalSearchJson);
        const r = toMusicResult(items[0]);
        expect(r.year).toBeUndefined();
        expect(r.artist).toBeUndefined();
        expect(r.album).toBe('Undated Release'); // album 恒 = title（release-group 语义）
        const r2 = toMusicResult(items[1]);
        expect(r2.artist).toBeUndefined();
        expect(r2.year).toBe(1999); // 年份仍从 first-release-date 提取
    });

    it('cover 为纯 URL 拼接（不依赖响应中的任何 cover-art-archive 字段——实测响应无该字段）', () => {
        const r = toMusicResult(parseMusicBrainzResults(multiArtistJson)[1]); // first-release-date 缺失条目
        expect(r.cover).toBe('https://coverartarchive.org/release-group/c3333333-0000-4000-8000-000000000001/front');
        expect(r.year).toBeUndefined();
    });
});

describe('MusicBrainzClient 注入 http', () => {
    it('search 用注入的 http 拉取，请求带 MusicBrainz 政策要求的 User-Agent，返回 toMusicResult 结果', async () => {
        const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
        const client = new MusicBrainzClient(async (url, headers) => {
            calls.push({ url, headers });
            return fullSearchJson;
        });
        const results = await client.search('lady gaga');
        expect(results).toHaveLength(1);
        expect(results[0].source).toBe('musicbrainz');
        expect(results[0].sourceUrl).toBe('https://musicbrainz.org/release-group/4ce5341e-f625-3a63-9ccb-c56e2cbee02b');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain(encodeURIComponent('lady gaga'));
        expect(calls[0].headers?.['User-Agent']).toBe(USER_AGENT); // MusicBrainz 政策：请求须标识 UA
        expect(calls[0].headers?.['User-Agent']).toContain('ReelLudic');
    });
});
