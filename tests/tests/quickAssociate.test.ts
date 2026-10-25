// 快捷关联弹窗纯逻辑测试：影视集数组规整（**保位**/totalEpisodes 变更判定）+ 至少一集源校验
// 🔴 #446（2026-10-01）：规整口径从「压缩空位保序」翻面成「**保位**」—— 读侧（选集弹窗 / 集按钮）
//    全程按下标配对，压缩会让后面的集整体前移一格（用户报障：第 2 集填的标题跑到第 1 集）。
import { describe, it, expect } from 'vitest';
import { buildEpisodeAssocResult, hasAnyEpisodeSource } from 'pure/quickAssociate';

describe('buildEpisodeAssocResult（影视集数组规整：保位 + trim + totalEpisodes 变更判定）', () => {
    it('空位**留洞**、位置即集号：本地与网络各按自己的集号落位（下标 1 的两条就是同一集）', () => {
        const r = buildEpisodeAssocResult({
            files: ['a.mp4', undefined, 'c.mp4'],
            urls: [undefined, 'https://b', 'https://c'],
            titles: [],
            total: 3,
            origTotal: 3,
            allowTotalChange: true,
        });
        expect(r.episodeFiles?.length).toBe(3);
        expect(r.episodeFiles?.[0]).toBe('a.mp4');
        expect(r.episodeFiles?.[1]).toBeUndefined();
        expect(r.episodeFiles?.[2]).toBe('c.mp4');
        expect(r.episodeUrls?.length).toBe(3);
        expect(r.episodeUrls?.[0]).toBeUndefined();
        expect(r.episodeUrls?.[1]).toBe('https://b'); // 第 2 集的网址就该在 1 号位
        expect(r.episodeUrls?.[2]).toBe('https://c');
    });

    it('🔴 用户场景：只给第 2 集填标题 ⇒ 标题必须留在 1 号位（旧口径会前移到第 1 集）', () => {
        const r = buildEpisodeAssocResult({
            files: [],
            urls: [],
            titles: [undefined, '标题'],
            total: 104,
            origTotal: 104,
            allowTotalChange: true,
        });
        expect(r.episodeTitles?.length).toBe(2); // 尾部空位去掉
        expect(r.episodeTitles?.[0]).toBeUndefined();
        expect(r.episodeTitles?.[1]).toBe('标题');
        expect(r.episodeFiles).toBeUndefined(); // 整段空 → 字段缺省
    });

    it('trim：首尾空白清除；纯空白视同未填', () => {
        const r = buildEpisodeAssocResult({
            files: ['  a.mp4  ', '   '],
            urls: [],
            titles: [' 第一集 '],
            total: 2,
            origTotal: 2,
            allowTotalChange: true,
        });
        expect(r.episodeFiles).toEqual(['a.mp4']);
        expect(r.episodeTitles).toEqual(['第一集']);
    });

    it('整段空 → 字段缺省不写（undefined）', () => {
        const r = buildEpisodeAssocResult({
            files: [undefined, ''],
            urls: [],
            titles: [],
            total: 2,
            origTotal: 2,
            allowTotalChange: true,
        });
        expect(r.episodeFiles).toBeUndefined();
        expect(r.episodeUrls).toBeUndefined();
        expect(r.totalEpisodes).toBeUndefined();
    });

    it('totalEpisodes：仅变化时产出（增多/减少）；未变或 movie(allowTotalChange=false) 不产', () => {
        const base = { files: ['a.mp4'], urls: [], titles: [], total: 5, origTotal: 3, allowTotalChange: true };
        expect(buildEpisodeAssocResult(base).totalEpisodes).toBe(5);
        expect(buildEpisodeAssocResult({ ...base, total: 3 }).totalEpisodes).toBeUndefined();
        expect(buildEpisodeAssocResult({ ...base, allowTotalChange: false }).totalEpisodes).toBeUndefined();
    });

    it('截取到 total：超出部分不入结果；total 非法按 0', () => {
        const r = buildEpisodeAssocResult({
            files: ['1.mp4', '2.mp4', '3.mp4'],
            urls: [],
            titles: [],
            total: 2,
            origTotal: 5,
            allowTotalChange: true,
        });
        expect(r.episodeFiles).toEqual(['1.mp4', '2.mp4']);
        expect(r.totalEpisodes).toBe(2);
        const bad = buildEpisodeAssocResult({ files: ['1.mp4'], urls: [], titles: [], total: -1, origTotal: 1, allowTotalChange: true });
        expect(bad.episodeFiles).toBeUndefined();
    });
});

describe('hasAnyEpisodeSource（至少一集有源校验）', () => {
    it('任一集有本地或网络 → true', () => {
        expect(hasAnyEpisodeSource(['a.mp4'], [], 1)).toBe(true);
        expect(hasAnyEpisodeSource([], ['https://x'], 1)).toBe(true);
        expect(hasAnyEpisodeSource([undefined, 'b.mp4'], [], 3)).toBe(true);
        expect(hasAnyEpisodeSource(['  '], ['  '], 1)).toBe(false);
    });

    it('全空/无源 → false；total 内越界不误判', () => {
        expect(hasAnyEpisodeSource([], [], 2)).toBe(false);
        expect(hasAnyEpisodeSource(['a.mp4'], [], 0)).toBe(false);
    });
});
