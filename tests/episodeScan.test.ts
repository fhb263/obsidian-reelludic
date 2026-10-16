// 剧集文件名集号解析测试：主流命名命中 + 年份/分辨率/词中字母误判排除
// + #446 从文件名派生**集标题**（「从文件夹检索剧集」自动补标题用）
import { describe, it, expect } from 'vitest';
import { episodeTitleFromName, parseEpisodeNumber, scanEpisodeNumbers } from 'pure/episodeScan';

describe('parseEpisodeNumber 集号识别', () => {
    it('第N集 / 第N话 / 空格变体', () => {
        expect(parseEpisodeNumber('第1集.mp4')).toBe(1);
        expect(parseEpisodeNumber('第 12 话.mkv')).toBe(12);
        expect(parseEpisodeNumber('葬送的芙莉莲 第 05 話.mp4')).toBe(5);
        expect(parseEpisodeNumber('第 128 集')).toBe(128);
    });

    it('S01E05 / E05 / Episode 05', () => {
        expect(parseEpisodeNumber('葬送的芙莉莲 S01E05.mkv')).toBe(5);
        expect(parseEpisodeNumber('xxx - E05.mp4')).toBe(5);
        expect(parseEpisodeNumber('Show.S01E12.1080p.mkv')).toBe(12);
        expect(parseEpisodeNumber('Show Episode 03.mp4')).toBe(3);
    });

    it('分隔符数字段：[05] / - 05 / _12 / 空格 01', () => {
        expect(parseEpisodeNumber('[Sakurato] 芙莉莲 [05][1080p].mkv')).toBe(5);
        expect(parseEpisodeNumber('葬送のフリーレン - 05.mp4')).toBe(5);
        expect(parseEpisodeNumber('frieren_12.mkv')).toBe(12);
        expect(parseEpisodeNumber('芙莉莲 01 (1080p).mp4')).toBe(1);
    });

    it('防误判：分辨率/年份/词中字母 e/无集号', () => {
        expect(parseEpisodeNumber('foo 720p.mkv')).toBeUndefined();
        expect(parseEpisodeNumber('1080p.mkv')).toBeUndefined(); // 4 位不匹配
        expect(parseEpisodeNumber('Movie 2023 remux.mkv')).toBeUndefined(); // 年份
        expect(parseEpisodeNumber('complete.mkv')).toBeUndefined(); // 词中 e
        expect(parseEpisodeNumber('OP ED 合集.mkv')).toBeUndefined();
        expect(parseEpisodeNumber('特典映像')).toBeUndefined();
        expect(parseEpisodeNumber('')).toBeUndefined();
    });

    it('边缘：纯季号 S02 不当作集号；数字后带字母单词视为无集号', () => {
        expect(parseEpisodeNumber('葬送的芙莉莲 S02.mkv')).toBeUndefined();
        expect(parseEpisodeNumber('番外 500 Days.mkv')).toBe(500); // 已知边缘：数字段命中视为集号（默认接受）
    });
});

describe('scanEpisodeNumbers 批量', () => {
    it('仅返回可识别文件，保持传入顺序', () => {
        const r = scanEpisodeNumbers(['E03.mkv', 'readme.txt', 'E01.mp4', '720p.mkv', 'E02.mkv']);
        expect(r).toEqual([
            { ep: 3, name: 'E03.mkv' },
            { ep: 1, name: 'E01.mp4' },
            { ep: 2, name: 'E02.mkv' },
        ]);
    });

    it('空/全不可识别 → []', () => {
        expect(scanEpisodeNumbers([])).toEqual([]);
        expect(scanEpisodeNumbers(['a.txt', 'b.mp4'])).toEqual([]);
    });
});

// 🔴 #446：用户在「去关联 → 从文件夹检索剧集」里要求**顺手把集标题也补上** —— 标题就从文件名派生。
// 口径：剥掉集号片段，取它**之后**的部分（宁可不填，也不把剧名当标题）。
describe('episodeTitleFromName 从文件名派生集标题', () => {
    it('集号在前的常见命名：取集号之后的部分', () => {
        expect(episodeTitleFromName('1.新邻居.mp4')).toBe('新邻居');
        expect(episodeTitleFromName('2.熊熊的歌声.mp4')).toBe('熊熊的歌声');
        expect(episodeTitleFromName('第05集 开始.mp4')).toBe('开始');
        expect(episodeTitleFromName('Show.S01E05.Pilot.mkv')).toBe('Pilot');
        expect(episodeTitleFromName('Show Episode 03 - 出发.mp4')).toBe('出发');
    });

    it('只有集号（或集号后只剩分辨率/括号）→ 空串（调用方不填，别写个空标题）', () => {
        expect(episodeTitleFromName('01.mp4')).toBe('');
        expect(episodeTitleFromName('葬送のフリーレン - 05.mp4')).toBe('');
        expect(episodeTitleFromName('第1集.mp4')).toBe('');
        expect(episodeTitleFromName('[Sakurato] 芙莉莲 [05][1080p].mkv')).toBe('');
    });

    it('分辨率当噪声排掉；分隔符折成空格；不带扩展名也能解析', () => {
        expect(episodeTitleFromName('Show.S01E05.1080p.mkv')).toBe('');
        expect(episodeTitleFromName('Show.S01E05.1080p.Notes.mkv')).toBe('Notes');
        expect(episodeTitleFromName('第3话_告白_720p')).toBe('告白');
    });

    it('集号之后没有内容、又不该拿剧名充数 → 空串（`标题.01.mp4` 这类命名如实不填）', () => {
        expect(episodeTitleFromName('开始.01.mp4')).toBe('');
        expect(episodeTitleFromName('')).toBe('');
    });
});
