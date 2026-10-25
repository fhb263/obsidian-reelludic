// 资源链接平台识别（pure/linkGuess）单测
import { describe, it, expect } from 'vitest';
import { guessPlatformLabel } from 'pure/linkGuess';

describe('guessPlatformLabel 域名精确/后缀匹配', () => {
    it('B站：www 子域 + 视频路径', () => {
        expect(guessPlatformLabel('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('B站');
    });
    it('B站：短链 b23.tv', () => {
        expect(guessPlatformLabel('https://b23.tv/AbCdEf')).toBe('B站');
    });
    it('B站：无协议输入', () => {
        expect(guessPlatformLabel('www.bilibili.com/video/xxx')).toBe('B站');
    });
    it('B站：大写 URL', () => {
        expect(guessPlatformLabel('HTTPS://WWW.BILIBILI.COM/VIDEO/XXX')).toBe('B站');
    });
    it('爱奇艺：iqiyi.com', () => {
        expect(guessPlatformLabel('https://www.iqiyi.com/v_19rrx7q5vs.html')).toBe('爱奇艺');
    });
    it('腾讯视频：v.qq.com', () => {
        expect(guessPlatformLabel('https://v.qq.com/x/cover/mzc00200abc.html')).toBe('腾讯视频');
    });
    it('Netflix：title 页', () => {
        expect(guessPlatformLabel('https://www.netflix.com/title/80192098')).toBe('Netflix');
    });
    it('豆瓣：movie 子域', () => {
        expect(guessPlatformLabel('https://movie.douban.com/subject/1292052/')).toBe('豆瓣');
    });
    it('优酷：v.youku.com', () => {
        expect(guessPlatformLabel('https://v.youku.com/v_show/id_XNTkzNDY2OTQ0.html')).toBe('优酷');
    });
    it('芒果TV：mgtv.com', () => {
        expect(guessPlatformLabel('https://www.mgtv.com/b/335424/7168658.html')).toBe('芒果TV');
    });
    it('YouTube：watch 页', () => {
        expect(guessPlatformLabel('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('YouTube');
    });
    it('YouTube：短链 youtu.be', () => {
        expect(guessPlatformLabel('https://youtu.be/dQw4w9WgXcQ')).toBe('YouTube');
    });
    it('端口号不影响识别', () => {
        expect(guessPlatformLabel('https://bilibili.com:8080/video/xxx')).toBe('B站');
    });
});

describe('guessPlatformLabel 识别失败回退', () => {
    it('未知域名返回空串', () => {
        expect(guessPlatformLabel('https://example.com/video/123')).toBe('');
    });
    it('空输入返回空串', () => {
        expect(guessPlatformLabel('')).toBe('');
        expect(guessPlatformLabel('   ')).toBe('');
    });
    it('无效 URL 返回空串', () => {
        expect(guessPlatformLabel('not a url')).toBe('');
    });
    it('纯协议无域名返回空串', () => {
        expect(guessPlatformLabel('https://')).toBe('');
    });
    it('子域不可误匹配：notbilibili.com 不算 B站', () => {
        expect(guessPlatformLabel('https://notbilibili.com/video/1')).toBe('');
    });
});
