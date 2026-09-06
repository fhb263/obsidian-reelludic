// 快捷关联弹窗纯逻辑测试：影视集数组规整（压缩保序/totalEpisodes 变更判定）+ 至少一集源校验
import { describe, it, expect } from 'vitest';
import { buildEpisodeAssocResult, hasAnyEpisodeSource } from 'pure/quickAssociate';

describe('buildEpisodeAssocResult（影视集数组规整：压缩空位保序 + trim + totalEpisodes 变更判定）', () => {
    it('连续集源原样保留，空位压缩保序', () => {
        const r = buildEpisodeAssocResult({
            files: ['a.mp4', undefined, 'c.mp4'],
            urls: [undefined, 'https://b', 'https://c'],
            titles: [],
            total: 3,
            origTotal: 3,
            allowTotalChange: true,
        });
        expect(r).toEqual({
            episodeFiles: ['a.mp4', 'c.mp4'],
            episodeUrls: ['https://b', 'https://c'],
        });
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
