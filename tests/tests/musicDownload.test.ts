import { describe, it, expect } from 'vitest';
import {
    SONG_SEARCH_LIMIT,
    downloadSong,
    fetchPlaylistDetail,
    fetchRecommendedPlaylists,
    searchSongs,
} from 'services/musicDownload';
import {
    downloadableCount,
    formatPlayCount,
    formatPlaylistMeta,
    formatSongMeta,
    neteaseCoverUrl,
    neteasePlaylistDetailUrl,
    neteaseRecommendUrl,
    parseNeteasePlaylistDetail,
    parseNeteasePlaylists,
} from 'pure/musicDownload';
import { MIN_AUDIO_BYTES } from 'pure/songDownload';
import type { LyricHttpGet } from 'services/lyricSearch';
import type { DownloadHttpGet, DownloadStore } from 'services/downloader';

const SEARCH_JSON = JSON.stringify({
    result: {
        songs: [
            { id: 1, name: '免费歌', ar: [{ name: 'A' }], dt: 200000, fee: 0 },
            { id: 2, name: '付费歌', ar: [{ name: 'B' }], dt: 180000, fee: 1 },
            { id: 3, name: '未知 fee 歌', ar: [{ name: 'C' }], dt: 190000 },
        ],
    },
});

function textHttp(res: { status: number; text: string } | Error, onCall?: (url: string, headers?: Record<string, string>) => void): LyricHttpGet {
    return async (url, headers) => {
        onCall?.(url, headers);
        if (res instanceof Error) throw res;
        return res;
    };
}

/** 够大、魔数为 MP3 的字节 */
function mp3(size = MIN_AUDIO_BYTES + 1): Uint8Array {
    const b = new Uint8Array(size);
    b[0] = 0x49;
    b[1] = 0x44;
    b[2] = 0x33;
    return b;
}

function fakeStore() {
    const written: { relPath: string; size: number }[] = [];
    const store: DownloadStore = {
        async write(relPath, data) {
            written.push({ relPath, size: data.byteLength });
        },
    };
    return { store, written };
}

function binaryHttp(buffer: Uint8Array, onCall?: (url: string, headers?: Record<string, string>) => void): DownloadHttpGet {
    return async (url, headers) => {
        onCall?.(url, headers);
        return { status: 200, buffer };
    };
}

describe('searchSongs', () => {
    it('解析候选并标注可下载性：fee≠0 与 fee 缺失的处置**必须不同**', async () => {
        const r = await searchSongs(textHttp({ status: 200, text: SEARCH_JSON }), '歌名', '歌手');
        expect(r.query).toBe('歌名 歌手');
        expect(r.error).toBeUndefined();
        expect(r.songs.map((s) => s.downloadable)).toEqual([true, false, true]);
        expect(r.vipCount).toBe(1);
    });

    it('🔴 不可下载的条目**照样出现在列表里**（静默过滤会让用户以为「搜不到」）', async () => {
        const r = await searchSongs(textHttp({ status: 200, text: SEARCH_JSON }), '歌名');
        expect(r.songs).toHaveLength(3);
        expect(r.songs.map((s) => s.name)).toContain('付费歌');
    });

    it('条目字段齐备：id / 歌手 / 时长 / fee / 歌曲页地址', async () => {
        const r = await searchSongs(textHttp({ status: 200, text: SEARCH_JSON }), '歌名');
        expect(r.songs[0]).toEqual({
            id: '1',
            name: '免费歌',
            artists: ['A'],
            durationSec: 200,
            downloadable: true,
            fee: 0,
            pageUrl: 'https://music.163.com/#/song?id=1',
        });
    });

    it('请求：走网易云搜索端点 + 带 limit 与 Referer', async () => {
        let url = '';
        let headers: Record<string, string> | undefined;
        await searchSongs(textHttp({ status: 200, text: SEARCH_JSON }, (u, h) => ((url = u), (headers = h))), '歌 名');
        expect(url).toContain('music.163.com/api/cloudsearch/pc');
        expect(url).toContain(`limit=${SONG_SEARCH_LIMIT}`);
        expect(url).toContain('type=1');
        expect(url).toContain(encodeURIComponent('歌 名'));
        expect(headers?.Referer).toBe('https://music.163.com');
    });

    it('标题为空 ⇒ 不发任何请求，query 为 null', async () => {
        let calls = 0;
        const r = await searchSongs(textHttp({ status: 200, text: SEARCH_JSON }, () => (calls += 1)), '   ');
        expect(r.query).toBeNull();
        expect(r.songs).toEqual([]);
        expect(calls).toBe(0);
    });

    it('非 2xx / 抛错 ⇒ 收敛成 error（与「搜到 0 条」是两回事）', async () => {
        const bad = await searchSongs(textHttp({ status: 500, text: '' }), '歌名');
        expect(bad.error).toContain('500');
        expect(bad.songs).toEqual([]);

        const boom = await searchSongs(textHttp(new Error('timed out')), '歌名');
        expect(boom.error).toContain('timed out');
    });

    it('响应不是 JSON ⇒ 0 条但**不算错误**（接口改形态时不该报「请求失败」）', async () => {
        const r = await searchSongs(textHttp({ status: 200, text: 'not json' }), '歌名');
        expect(r.songs).toEqual([]);
        expect(r.error).toBeUndefined();
    });
});

describe('downloadSong', () => {
    it('走免密外链 + Referer，落到 `<root>/音乐/歌手 - 歌名.mp3`', async () => {
        const { store, written } = fakeStore();
        let url = '';
        let headers: Record<string, string> | undefined;
        const r = await downloadSong(binaryHttp(mp3(), (u, h) => ((url = u), (headers = h))), store, {
            song: { id: '347230', name: '歌名', artists: ['甲', '乙'] },
        });
        expect(url).toBe('https://music.163.com/song/media/outer/url?id=347230.mp3');
        expect(headers?.Referer).toBe('https://music.163.com');
        expect(r.relPath).toBe('下载/音乐/甲、乙 - 歌名.mp3');
        expect(written).toHaveLength(1);
    });

    it('🔴 302 落地成 HTML 错误页 ⇒ 失败（魔数不识别），⛔ 绝不把错误页当音频写盘', async () => {
        const { store, written } = fakeStore();
        const html = new Uint8Array(MIN_AUDIO_BYTES + 10);
        html.set(new TextEncoder().encode('<!DOCTYPE html>'));
        const r = await downloadSong(binaryHttp(html), store, {
            song: { id: '1', name: 'x', artists: ['A'] },
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('不是音频');
        expect(written).toHaveLength(0);
    });

    it('内容过小 ⇒ 失败（受限 / 接口变更）', async () => {
        const { store } = fakeStore();
        const r = await downloadSong(binaryHttp(mp3(MIN_AUDIO_BYTES - 1)), store, {
            song: { id: '1', name: 'x', artists: ['A'] },
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('过小');
    });

    it('自定义目录生效（#459：root = 音频文件目录本身，⛔ 不再套一层「音乐」）', async () => {
        const { store } = fakeStore();
        const r = await downloadSong(binaryHttp(mp3()), store, {
            song: { id: '1', name: 'x', artists: ['A'] },
            root: '我的库/下载',
        });
        expect(r.relPath).toBe('我的库/下载/A - x.mp3');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// `pure/musicDownload`（歌单与解析）—— 与 `pure/songDownload` 分开：那边管「能不能下」，
// 这边管「歌单/歌曲长什么样」。⚠️ 两个网易云端点的**曲目字段名不同**是本段最容易踩的坑。
// ══════════════════════════════════════════════════════════════════════════════

const RECOMMEND_JSON = JSON.stringify({
    code: 200,
    result: [
        { id: 3102431204, name: '打游戏必备歌曲 | 超燃', picUrl: 'https://p2.music.126.net/a.jpg', playCount: 22974974.0, trackCount: 506 },
        { id: 2, name: '只有 trackNumber 的歌单', picUrl: 'https://p2.music.126.net/b.jpg', playCount: 0, trackNumber: 16 },
        { name: '缺 id 的' },
    ],
});

const DETAIL_JSON = JSON.stringify({
    result: {
        name: '热歌榜',
        coverImgUrl: 'https://p1.music.126.net/cover.jpg',
        tracks: [
            {
                id: 1973665667,
                name: '海屿你',
                artists: [{ name: '某某' }, { name: '另一人' }],
                album: { name: '专辑名', picUrl: 'https://p1.music.126.net/alb.jpg' },
                duration: 245000,
                fee: 8,
            },
            { id: 2, name: '免费曲', artists: [{ name: '甲' }], duration: 180000, fee: 0 },
            { name: '缺 id' },
        ],
    },
});

describe('pure/musicDownload · 推荐歌单解析', () => {
    it('解析 `result[]`；缺 id / 缺名的跳过', () => {
        const list = parseNeteasePlaylists(RECOMMEND_JSON);
        expect(list).toHaveLength(2);
        expect(list[0]).toEqual({
            id: '3102431204',
            name: '打游戏必备歌曲 | 超燃',
            coverUrl: 'https://p2.music.126.net/a.jpg',
            trackCount: 506,
            playCount: 22974974,
        });
    });

    it('🔴 `trackCount` 与 `trackNumber` **两个都试**（实测前者常为 null，只读一个会让「N 首」永远消失）', () => {
        expect(parseNeteasePlaylists(RECOMMEND_JSON)[1].trackCount).toBe(16);
    });

    it('非 JSON / 结构不符 ⇒ 空数组（⛔ 不抛）', () => {
        expect(parseNeteasePlaylists('not json')).toEqual([]);
        expect(parseNeteasePlaylists('{}')).toEqual([]);
        expect(parseNeteasePlaylists('{"result":{}}')).toEqual([]);
    });
});

describe('pure/musicDownload · 歌单详情解析', () => {
    it('🔴 用 `artists` / `duration`（**不是** cloudsearch 的 `ar` / `dt`）', () => {
        const d = parseNeteasePlaylistDetail(DETAIL_JSON);
        expect(d?.name).toBe('热歌榜');
        expect(d?.coverUrl).toBe('https://p1.music.126.net/cover.jpg');
        expect(d?.songs).toHaveLength(2);
        expect(d?.songs[0]).toEqual({
            id: '1973665667',
            name: '海屿你',
            artists: ['某某', '另一人'],
            album: '专辑名',
            durationSec: 245,
            coverUrl: 'https://p1.music.126.net/alb.jpg',
            fee: 8,
            downloadable: false,
            pageUrl: 'https://music.163.com/#/song?id=1973665667',
        });
    });

    it('每首都带可下载性（歌单里 fee≠0 是常态 ⇒ UI 必须逐首标）', () => {
        const songs = parseNeteasePlaylistDetail(DETAIL_JSON)!.songs;
        expect(songs.map((s) => s.downloadable)).toEqual([false, true]);
        expect(downloadableCount(songs)).toBe(1);
    });

    it('结构不符 ⇒ null（与「歌单为空」区分开）', () => {
        expect(parseNeteasePlaylistDetail('not json')).toBeNull();
        expect(parseNeteasePlaylistDetail('{}')).toBeNull();
    });

    it('兼容 `playlist` 键（老形态）', () => {
        const raw = JSON.stringify({ result: { name: 'x', playlist: [{ id: 9, name: 'y', artists: [], fee: 0 }] } });
        expect(parseNeteasePlaylistDetail(raw)?.songs).toHaveLength(1);
    });
});

describe('pure/musicDownload · URL 与文案', () => {
    it('两条 URL 都指向**公开 `/api/` 端点**（⛔ 不得出现 weapi / params / encSecKey —— 那是 AGPL 链路）', () => {
        const a = neteaseRecommendUrl(6);
        const b = neteasePlaylistDetailUrl('123');
        expect(a).toContain('music.163.com/api/personalized/playlist');
        expect(a).toContain('limit=6');
        expect(b).toContain('music.163.com/api/playlist/detail');
        expect(b).toContain('id=123');
        for (const u of [a, b]) {
            expect(u.includes('weapi')).toBe(false);
            expect(u.includes('params=')).toBe(false);
            expect(u.includes('encSecKey')).toBe(false);
        }
    });

    it('封面缩略图参数：无查询串用 `?`、已有用 `&`；空 URL 返回空串', () => {
        expect(neteaseCoverUrl('https://x/a.jpg')).toBe('https://x/a.jpg?param=120y120');
        expect(neteaseCoverUrl('https://x/a.jpg?k=1')).toBe('https://x/a.jpg?k=1&param=120y120');
        expect(neteaseCoverUrl('')).toBe('');
    });

    it('播放量按截图口径缩写（亿 / 万 / 原数；0 与非有限值不显示）', () => {
        expect(formatPlayCount(22974974)).toBe('2297.5万');
        expect(formatPlayCount(200000000)).toBe('2.0亿');
        expect(formatPlayCount(13694000)).toBe('1369.4万');
        expect(formatPlayCount(1234)).toBe('1234');
        expect(formatPlayCount(0)).toBe('');
        expect(formatPlayCount(undefined)).toBe('');
    });

    it('歌单副行：「N 首 · X 次播放」，缺项自动省略', () => {
        expect(formatPlaylistMeta({ id: '1', name: 'x', coverUrl: '', trackCount: 506, playCount: 2e8 })).toBe('506 首 · 2.0亿 次播放');
        expect(formatPlaylistMeta({ id: '1', name: 'x', coverUrl: '', trackCount: 16 })).toBe('16 首');
        expect(formatPlaylistMeta({ id: '1', name: 'x', coverUrl: '' })).toBe('');
    });

    it('歌曲副行：「歌手 / 歌手 · 4:59」', () => {
        const base = { id: '1', name: 'x', downloadable: true, pageUrl: '' };
        expect(formatSongMeta({ ...base, artists: ['甲', '乙'], durationSec: 299 })).toBe('甲 / 乙 · 4:59');
        expect(formatSongMeta({ ...base, artists: ['甲'], durationSec: 65 })).toBe('甲 · 1:05');
        expect(formatSongMeta({ ...base, artists: [] })).toBe('');
    });
});

describe('services/musicDownload · 歌单拉取', () => {
    it('推荐歌单：走公开端点 + 带 Referer，成功返回列表', async () => {
        let url = '';
        let headers: Record<string, string> | undefined;
        const r = await fetchRecommendedPlaylists(
            textHttp({ status: 200, text: RECOMMEND_JSON }, (u, h) => ((url = u), (headers = h))),
            6,
        );
        expect(url).toBe('https://music.163.com/api/personalized/playlist?limit=6');
        expect(headers?.Referer).toBe('https://music.163.com');
        expect(r.playlists).toHaveLength(2);
        expect(r.error).toBeUndefined();
    });

    it('推荐歌单：非 2xx / 抛错 ⇒ error（⛔ 不抛出去，首屏失败不该让弹窗打不开）', async () => {
        const bad = await fetchRecommendedPlaylists(textHttp({ status: 500, text: '' }));
        expect(bad.playlists).toEqual([]);
        expect(bad.error).toContain('500');
        const boom = await fetchRecommendedPlaylists(textHttp(new Error('timed out')));
        expect(boom.error).toContain('timed out');
    });

    it('歌单详情：一次请求拿全（公开端点无需分批）', async () => {
        let calls = 0;
        const r = await fetchPlaylistDetail(textHttp({ status: 200, text: DETAIL_JSON }, () => (calls += 1)), '3778678');
        expect(calls).toBe(1);
        expect(r.detail?.songs).toHaveLength(2);
    });

    it('歌单详情：空 id ⇒ 一个请求都不发', async () => {
        let calls = 0;
        const r = await fetchPlaylistDetail(textHttp({ status: 200, text: DETAIL_JSON }, () => (calls += 1)), '   ');
        expect(calls).toBe(0);
        expect(r.detail).toBeNull();
    });

    it('歌单详情：结构不符 ⇒ 明确报「接口可能已变更」（与「歌单为空」区分）', async () => {
        const r = await fetchPlaylistDetail(textHttp({ status: 200, text: '{}' }), '1');
        expect(r.detail).toBeNull();
        expect(r.error).toContain('接口可能已变更');
    });
});
