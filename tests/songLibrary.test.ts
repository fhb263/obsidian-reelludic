// 在线曲库结果映射（pure/songLibrary）单测 —— #464
import { describe, it, expect } from 'vitest';
import { songLibraryResults, SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
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
