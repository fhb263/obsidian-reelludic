import { describe, it, expect } from 'vitest';
import {
    isEmbeddableVideoPath,
    isAssociableVideoPath,
    videoExt,
    VIDEO_ASSOCIABLE_EXTENSIONS,
    CHROMIUM_VIDEO_EXTENSIONS,
} from 'pure/mediaExtensions';

describe('pure/mediaExtensions Chromium 内嵌可播判定', () => {
    it('白名单：mp4/webm/mov/ogv 判为可内嵌', () => {
        expect(isEmbeddableVideoPath('D:\\Movies\\电影.mp4')).toBe(true);
        expect(isEmbeddableVideoPath('D:/Movies/a.webm')).toBe(true);
        expect(isEmbeddableVideoPath('C:/x.mov')).toBe(true);
        expect(isEmbeddableVideoPath('/v/ee.ogv')).toBe(true);
    });

    it('扩展名大小写不敏感', () => {
        expect(isEmbeddableVideoPath('D:/a.MP4')).toBe(true);
        expect(isEmbeddableVideoPath('D:/a.WebM')).toBe(true);
    });

    it('黑名单：mkv/avi/flv/wmv/ts/m4v 判为不可内嵌（需转系统播放器）', () => {
        expect(isEmbeddableVideoPath('D:/Movie.mkv')).toBe(false);
        expect(isEmbeddableVideoPath('D:/Movie.avi')).toBe(false);
        expect(isEmbeddableVideoPath('D:/a.flv')).toBe(false);
        expect(isEmbeddableVideoPath('D:/a.wmv')).toBe(false);
        expect(isEmbeddableVideoPath('D:/a.ts')).toBe(false);
        expect(isEmbeddableVideoPath('D:/a.m4v')).toBe(false);
    });

    it('非视频/无扩展名/空 判为不可内嵌', () => {
        expect(isEmbeddableVideoPath('D:/a.mp3')).toBe(false);
        expect(isEmbeddableVideoPath('D:/noext')).toBe(false);
        expect(isEmbeddableVideoPath('')).toBe(false);
        expect(isEmbeddableVideoPath('D:/dir/')).toBe(false);
    });

    it('可内嵌集合恒为可关联集合的子集（防止两表日后脱节）', () => {
        for (const e of CHROMIUM_VIDEO_EXTENSIONS) {
            expect(VIDEO_ASSOCIABLE_EXTENSIONS).toContain(e);
        }
    });
});

describe('pure/mediaExtensions 可关联视频容器（文件选择器用）', () => {
    it('可内嵌的必然可关联', () => {
        for (const e of CHROMIUM_VIDEO_EXTENSIONS) {
            expect(isAssociableVideoPath(`D:/x.${e}`)).toBe(true);
        }
    });

    it('外部播放器容器（mkv/avi 等）可关联但不可内嵌', () => {
        expect(isAssociableVideoPath('D:/a.mkv')).toBe(true);
        expect(isEmbeddableVideoPath('D:/a.mkv')).toBe(false);
        expect(isAssociableVideoPath('D:/a.avi')).toBe(true);
        expect(isAssociableVideoPath('D:/a.flv')).toBe(true);
        expect(isAssociableVideoPath('D:/a.wmv')).toBe(true);
        expect(isAssociableVideoPath('D:/a.ts')).toBe(true);
        expect(isAssociableVideoPath('D:/a.m4v')).toBe(true);
    });

    it('非视频不可关联', () => {
        expect(isAssociableVideoPath('D:/a.mp3')).toBe(false);
        expect(isAssociableVideoPath('D:/a.txt')).toBe(false);
        expect(isAssociableVideoPath('')).toBe(false);
    });

    it('videoExt 取扩展名：大小写归一、路径分隔符、去参数', () => {
        expect(videoExt('D:/A/B/x.MP4')).toBe('mp4');
        expect(videoExt('D:\\A\\x.mkv')).toBe('mkv');
        expect(videoExt('a.mp4#t=1')).toBe('mp4');
        expect(videoExt('a.mp4?x=1')).toBe('mp4');
        expect(videoExt('noext')).toBe('');
        expect(videoExt('D:/dir/')).toBe('');
        expect(videoExt('')).toBe('');
    });
});
