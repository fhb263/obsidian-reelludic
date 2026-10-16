// 本地媒体扩展名真源测试（2026-09-27 ④-2 补：音频侧首份单测；视频侧一并立回归网）。
//
// 为什么值得单测：这些名单是「文件选择器能选什么」与「播放器敢不敢内嵌」**共用的唯一真源**，
// 分叉的表现是「选得出、播不了」或「明明能播却选不了」——用户无法自查。
import { describe, it, expect } from 'vitest';
import {
    VIDEO_ASSOCIABLE_EXTENSIONS,
    CHROMIUM_VIDEO_EXTENSIONS,
    AUDIO_ASSOCIABLE_EXTENSIONS,
    videoExt,
    isAssociableVideoPath,
    isAssociableAudioPath,
} from 'pure/mediaExtensions';

describe('videoExt（取扩展名）', () => {
    it('大小写归一、去 `#?` 参数', () => {
        expect(videoExt('a/b.MP3')).toBe('mp3');
        expect(videoExt('a/b.mp3?x=1')).toBe('mp3');
        expect(videoExt('a/b.mp3#t')).toBe('mp3');
    });

    it('反斜杠路径同样认（Windows 绝对路径）', () => {
        expect(videoExt('C:\\Music\\夜曲.FLAC')).toBe('flac');
    });

    it('无扩展名 / 空 / 以分隔符结尾 ⇒ 空串', () => {
        expect(videoExt('')).toBe('');
        expect(videoExt('a/b')).toBe('');
        expect(videoExt('a/b.')).toBe('');
    });
});

describe('可关联名单（视频 / 音频）', () => {
    it('🔴 音频六种全在、且与文件选择器口径一致（④ 之前散在 `main.pickLocalAudioPath` 里硬编码）', () => {
        expect([...AUDIO_ASSOCIABLE_EXTENSIONS]).toEqual(['mp3', 'flac', 'm4a', 'ogg', 'wav', 'aac']);
    });

    it('🔴 视频「可内嵌」子集必须**恒为**「可关联」的子集（否则会出现「可内嵌但选不了」的死角）', () => {
        for (const ext of CHROMIUM_VIDEO_EXTENSIONS) {
            expect(VIDEO_ASSOCIABLE_EXTENSIONS).toContain(ext);
        }
    });

    it('音频判定：认常见容器与大小写，不认视频容器、不认无关扩展名', () => {
        expect(isAssociableAudioPath('m/夜曲.mp3')).toBe(true);
        expect(isAssociableAudioPath('m/夜曲.M4A')).toBe(true);
        expect(isAssociableAudioPath('m/夜曲.flac?x=1')).toBe(true);
        expect(isAssociableAudioPath('m/影片.mp4')).toBe(false);
        expect(isAssociableAudioPath('m/歌词.lrc')).toBe(false);
        expect(isAssociableAudioPath('m/夜曲')).toBe(false);
    });

    it('🔴 目录名里的点不能冒充扩展名（`m/1.0/夜曲` 不是 `.0` 扩展名）', () => {
        expect(isAssociableAudioPath('m/1.0/夜曲')).toBe(false);
        expect(isAssociableVideoPath('m/1.0/影片')).toBe(false);
    });

    it('视频判定保持既有行为（回归网）', () => {
        expect(isAssociableVideoPath('m/影片.mkv')).toBe(true);
        expect(isAssociableVideoPath('m/影片.ogv')).toBe(true);
        expect(isAssociableVideoPath('m/夜曲.mp3')).toBe(false);
    });
});
