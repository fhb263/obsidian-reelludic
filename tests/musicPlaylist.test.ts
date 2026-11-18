// 音乐平台「我的清单」纯逻辑（pure/musicPlaylist）单测 —— 阶段 C1
//
// 🔴 用户 2026-11-09 第 15 轮阶段 C 的三条裁定（全部选推荐项），本文件逐条锁住：
//    ⑴ 清单**只落单曲**，歌单名写进标签（不建歌单条目、不扩 schema）；
//    ⑵ Cookie 过期 ⇒ **明确报错并提示重贴，不重试**；
//    ⑶ 三家私有接口接受，但**每家独立降级**（一家挂不连坐）。
import { describe, it, expect } from 'vitest';
import {
    MUSIC_SYNC_LIMIT,
    musicCookieExpired,
    musicCookieExpiredMessage,
    musicCandidatesFromSongs,
    musicSyncPartialMessage,
    musicSyncSummary,
    playlistTag,
    splitSyncCandidates,
} from 'pure/musicPlaylist';
import type { DownloadSong } from 'services/dl';

function song(over: Partial<DownloadSong> = {}): DownloadSong {
    return {
        source: 'netease',
        id: '347230',
        name: '海阔天空',
        artist: 'BEYOND',
        album: '乐与怒',
        coverUrl: 'https://p1.music.126.net/abc==/1.jpg',
        webUrl: 'https://music.163.com/#/song?id=347230',
        ...over,
    };
}

describe('musicPlaylist 判 Cookie 失效', () => {
    it('🔴 302 / 301 / 401 / 403 都算失效（302 到登录页是三家最常见的形态）', () => {
        for (const status of [301, 302, 401, 403]) {
            expect(musicCookieExpired({ status })).toBe(true);
        }
    });

    it('🔴 业务码也要认（网易云 301、QQ -1000 —— 各平台各写各的，判据必须统一）', () => {
        for (const code of [301, 401, '-1000', -1000]) {
            expect(musicCookieExpired({ code })).toBe(true);
        }
    });

    it('`redirected: true` 单独就能判（有的传输层不暴露 status）', () => {
        expect(musicCookieExpired({ redirected: true })).toBe(true);
    });

    it('🔴 普通 200 / 正常业务码 ⇒ 不是失效（⛔ 别把「空列表」也判成没登录）', () => {
        expect(musicCookieExpired({ status: 200, code: 200 })).toBe(false);
        expect(musicCookieExpired({})).toBe(false);
        // 用户真的可能一个歌单都没有 —— 那不该被说成登录失效
        expect(musicCookieExpired({ status: 200, code: -447 })).toBe(false);
    });

    it('文案必须同时说清「哪家 / 怎么了 / 去哪儿改」（本仓对失败文案的硬要求）', () => {
        const msg = musicCookieExpiredMessage('网易云');
        expect(msg).toContain('网易云');
        expect(msg).toContain('失效');
        expect(msg).toContain('重新粘贴 Cookie');
        // 🔴 用户裁定「不重试」⇒ 文案里要明说已停止，别让用户干等
        expect(msg).toContain('已停止');
    });
});

describe('musicPlaylist 单平台降级', () => {
    it('🔴 一家失败不连坐：成功的照报，失败的单独点名', () => {
        const msg = musicSyncPartialMessage(['QQ音乐', '酷狗'], [{ platform: '网易云', reason: '登录态失效' }]);
        expect(msg).toContain('QQ音乐、酷狗 已同步');
        expect(msg).toContain('网易云 失败');
        expect(msg).toContain('登录态失效');
    });

    it('全成功 ⇒ 空串（⛔ 不画一条「全部成功」的废话）', () => {
        expect(musicSyncPartialMessage(['网易云'], [])).toBe('');
    });

    it('全失败 ⇒ 只报失败，不出现「已同步；」这种悬空前缀', () => {
        const msg = musicSyncPartialMessage([], [{ platform: '酷狗', reason: '接口 404' }]);
        expect(msg.startsWith('酷狗 失败')).toBe(true);
    });
});

describe('musicPlaylist 候选构造', () => {
    it('基础字段齐全，键是 `music:{source}:{id}`（与阶段 B 同一把尺子）', () => {
        const [c] = musicCandidatesFromSongs([song()], { source: 'netease', playlistName: '我喜欢的音乐' });
        expect(c.key).toBe('music:netease:347230');
        expect(c.title).toBe('海阔天空');
        expect(c.artist).toBe('BEYOND');
        expect(c.album).toBe('乐与怒');
        expect(c.poster).toBe('https://p1.music.126.net/abc==/1.jpg');
        expect(c.webUrl).toBe('https://music.163.com/#/song?id=347230');
        expect(c.playlistName).toBe('我喜欢的音乐');
    });

    it('🔴 缺 id 或缺歌名 ⇒ 丢弃（没 id 算不出判重键，下次同步会重复落库）', () => {
        const out = musicCandidatesFromSongs([song({ id: '' }), song({ name: '' }), song({ id: 'ok', name: 'x' })], {
            source: 'netease',
            playlistName: 'p',
        });
        expect(out).toHaveLength(1);
        expect(out[0].songId).toBe('ok');
    });

    it('🔴 同一首重复出现只留一条（歌单里同一首歌挂两个歌单时会重复）', () => {
        const out = musicCandidatesFromSongs([song(), song(), song({ id: '2', name: 'y' })], {
            source: 'netease',
            playlistName: 'p',
        });
        expect(out.map((c) => c.songId)).toEqual(['347230', '2']);
    });

    it('🔴 VIP 只标注不阻止（用户裁定：同步只管元数据，不承诺可下载）', () => {
        const [c] = musicCandidatesFromSongs([song({ vip: true })], { source: 'netease', playlistName: 'p' });
        expect(c.vip).toBe(true);
        const [normal] = musicCandidatesFromSongs([song({ vip: false })], { source: 'netease', playlistName: 'p' });
        // 非 VIP 不写这个键（「确定不是 VIP」和「不知道」不该都写成 false）
        expect('vip' in normal).toBe(false);
    });

    it(`上限默认 ${MUSIC_SYNC_LIMIT}，超出即截断（照 STEAM_SYNC_LIMIT 口径，巨量清单不能拖死主线程）`, () => {
        expect(MUSIC_SYNC_LIMIT).toBe(2000);
        const many = Array.from({ length: 2005 }, (_, i) => song({ id: String(i), name: `s${String(i)}` }));
        const out = musicCandidatesFromSongs(many, { source: 'netease', playlistName: 'p' });
        expect(out).toHaveLength(MUSIC_SYNC_LIMIT);
    });

    it('显式 limit 生效', () => {
        const many = Array.from({ length: 10 }, (_, i) => song({ id: String(i), name: `s${String(i)}` }));
        expect(musicCandidatesFromSongs(many, { source: 'netease', playlistName: 'p', limit: 3 })).toHaveLength(3);
    });

    it('空 / undefined 防御', () => {
        expect(musicCandidatesFromSongs([], { source: 'netease', playlistName: 'p' })).toEqual([]);
        expect(musicCandidatesFromSongs(undefined as unknown as DownloadSong[], { source: 'netease', playlistName: 'p' })).toEqual([]);
    });
});

describe('musicPlaylist 标签与拆分', () => {
    it('🔴 歌单名进标签：只折叠空白，⛔ 不加前缀（加了就筛不出来）', () => {
        expect(playlistTag('  我  喜欢  ')).toBe('我 喜欢');
        expect(playlistTag('我喜欢的音乐')).toBe('我喜欢的音乐');
    });

    it('超长截到 24 字（标签栏放不下）', () => {
        const long = 'a'.repeat(50);
        expect(playlistTag(long)).toHaveLength(24);
    });

    it('空名 ⇒ 空串（调用方据此不写标签）', () => {
        expect(playlistTag('')).toBe('');
        expect(playlistTag('   ')).toBe('');
    });

    it('库里已有的与新歌分开（弹窗默认勾新的）', () => {
        const cs = musicCandidatesFromSongs([song(), song({ id: '2', name: 'y' })], { source: 'netease', playlistName: 'p' });
        const { fresh, known } = splitSyncCandidates(cs, new Set(['music:netease:347230']));
        expect(known.map((c) => c.songId)).toEqual(['347230']);
        expect(fresh.map((c) => c.songId)).toEqual(['2']);
    });

    it('汇总文案：清单数 + 新增/更新/跳过，失败段只在有失败时出现', () => {
        expect(musicSyncSummary({ playlists: 2, added: 5, skipped: 1, overridden: 0, failed: 0 })).toBe('2 个清单；新增 5 · 更新 0 · 跳过 1');
        expect(musicSyncSummary({ playlists: 0, added: 1, skipped: 0, overridden: 2, failed: 1 })).toBe('新增 1 · 更新 2 · 跳过 0 · 失败 1');
    });
});
