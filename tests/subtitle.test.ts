import { describe, it, expect } from 'vitest';
import { subtitleExt, isSubtitlePath, srtToVtt, subtitleLangTag, subtitleLangLabel, pickSubtitleCandidates, dirOfPath, fileNameOfPath } from 'pure/subtitle';

describe('dirOfPath / fileNameOfPath', () => {
    it('取目录（两种分隔符都归一）', () => {
        expect(dirOfPath('C:/a/b/movie.mp4')).toBe('C:/a/b');
        expect(dirOfPath('C:\\a\\b\\movie.mp4')).toBe('C:/a/b');
    });
    it('无目录 / 空串返回空目录', () => {
        expect(dirOfPath('movie.mp4')).toBe('');
        expect(dirOfPath('')).toBe('');
    });
    it('取文件名', () => {
        expect(fileNameOfPath('C:/a/b/movie.mp4')).toBe('movie.mp4');
        expect(fileNameOfPath('C:\\a\\b\\Ep01.chs.srt')).toBe('Ep01.chs.srt');
        expect(fileNameOfPath('movie.mp4')).toBe('movie.mp4');
    });
});

describe('subtitleExt / isSubtitlePath', () => {
    it('认出 srt / vtt，忽略大小写与查询串', () => {
        expect(subtitleExt('a.srt')).toBe('srt');
        expect(subtitleExt('a.SRT')).toBe('srt');
        expect(subtitleExt('a.vtt')).toBe('vtt');
        expect(subtitleExt('C:\\dir\\a.Srt')).toBe('srt');
        expect(subtitleExt('a.mp4')).toBe('');
        expect(subtitleExt('noext')).toBe('');
        expect(subtitleExt('')).toBe('');
    });
    it('isSubtitlePath 只认 srt/vtt（ass/ssa 不在内）', () => {
        expect(isSubtitlePath('a.srt')).toBe(true);
        expect(isSubtitlePath('a.vtt')).toBe(true);
        expect(isSubtitlePath('a.ass')).toBe(false);
        expect(isSubtitlePath('a.ssa')).toBe(false);
    });
});

describe('srtToVtt', () => {
    it('加 WEBVTT 头并把时间轴逗号改点', () => {
        const srt = '1\n00:00:01,000 --> 00:00:04,000\n你好\n';
        const vtt = srtToVtt(srt);
        expect(vtt.startsWith('WEBVTT')).toBe(true);
        expect(vtt).toContain('00:00:01.000 --> 00:00:04.000');
        expect(vtt).toContain('你好');
        expect(vtt).not.toContain(',000');
    });
    it('无小时的时间轴补全为 00:00:01.000', () => {
        const srt = '1\n00:01,500 --> 00:03,000\n嗨\n';
        expect(srtToVtt(srt)).toContain('00:00:01.500 --> 00:00:03.000');
    });
    it('已是 VTT 则原样透传（不重复加头）', () => {
        const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n喵\n';
        const out = srtToVtt(vtt);
        expect(out.match(/WEBVTT/g)?.length).toBe(1);
        expect(out).toContain('喵');
    });
    it('去 BOM / 归一 CRLF / 空输入给空字幕', () => {
        const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n';
        const out = srtToVtt(srt);
        expect(out.includes('\r')).toBe(false);
        expect(out.startsWith('WEBVTT')).toBe(true);
        expect(srtToVtt('')).toBe('WEBVTT\n\n');
        expect(srtToVtt('   \n  ')).toBe('WEBVTT\n\n');
    });
});

describe('subtitleLangTag / subtitleLangLabel', () => {
    it('识别常见语言标签', () => {
        expect(subtitleLangTag('a.chs.srt')).toBe('chs');
        expect(subtitleLangTag('a.zh-CN.srt')).toBe('zh-cn');
        expect(subtitleLangTag('a.cht.vtt')).toBe('cht');
        expect(subtitleLangTag('a.eng.srt')).toBe('eng');
        expect(subtitleLangTag('a.srt')).toBe('');
    });
    it('标签给中文说明', () => {
        expect(subtitleLangLabel('chs')).toBe('简体');
        expect(subtitleLangLabel('sc')).toBe('简体');
        expect(subtitleLangLabel('cht')).toBe('繁体');
        expect(subtitleLangLabel('zh')).toBe('中文');
        expect(subtitleLangLabel('eng')).toBe('英文');
        expect(subtitleLangLabel('jpn')).toBe('日文');
        expect(subtitleLangLabel('')).toBe('');
    });
});

describe('pickSubtitleCandidates', () => {
    const files = [
        'Ep01.mp4',
        'Ep01.srt',
        'Ep01.chs.srt',
        'Ep01.eng.vtt',
        'Ep01.zh-CN.ass',
        'Ep02.srt',
        'readme.txt',
        'Ep01.封面.jpg',
    ];
    it('只收同名或「同名.语言」的字幕', () => {
        const got = pickSubtitleCandidates('Ep01.mp4', files).map((c) => c.fileName);
        expect(got).toEqual(['Ep01.srt', 'Ep01.chs.srt', 'Ep01.eng.vtt']);
    });
    it('完全同名排最前，其次中文，最后其它语言', () => {
        const got = pickSubtitleCandidates('Ep01.mp4', files);
        expect(got[0].fileName).toBe('Ep01.srt');
        expect(got[0].lang).toBe('');
        expect(got[1].fileName).toBe('Ep01.chs.srt');
        expect(got[1].lang).toBe('chs');
        expect(got[2].fileName).toBe('Ep01.eng.vtt');
    });
    it('辅助文件（非 srt/vtt）与别的集数不入选', () => {
        const got = pickSubtitleCandidates('Ep01.mp4', files).map((c) => c.fileName);
        expect(got).not.toContain('Ep02.srt');
        expect(got).not.toContain('readme.txt');
        expect(got).not.toContain('Ep01.封面.jpg');
    });
    it('无匹配返回空数组', () => {
        expect(pickSubtitleCandidates('Other.mkv', files)).toEqual([]);
    });
});
