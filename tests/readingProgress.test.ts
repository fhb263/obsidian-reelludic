import { describe, it, expect } from 'vitest';
import { createEmptyProgress, normalizeProgress, isProgressDeeper, estimatePercent } from 'pure/readingProgress';

describe('阅读进度存储 createEmptyProgress 空进度', () => {
    it('chapterIndex=-1 / scrollRatio=0 / updatedAt 为合法 ISO 时间', () => {
        const p = createEmptyProgress();
        expect(p.chapterIndex).toBe(-1);
        expect(p.scrollRatio).toBe(0);
        expect(new Date(p.updatedAt).getTime()).not.toBeNaN();
    });
});

describe('阅读进度存储 normalizeProgress 容错归一', () => {
    it('null / 非对象回退默认', () => {
        expect(normalizeProgress(null)).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
        expect(normalizeProgress(undefined)).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
        expect(normalizeProgress('oops')).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('空对象回退默认', () => {
        expect(normalizeProgress({})).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('越界值回退：scrollRatio 越界归 0、chapterIndex 非法归 -1、小数 chapterIndex 取整', () => {
        expect(normalizeProgress({ chapterIndex: 3, scrollRatio: 2 }).scrollRatio).toBe(0);
        expect(normalizeProgress({ chapterIndex: -2, scrollRatio: 0 }).chapterIndex).toBe(-1);
        expect(normalizeProgress({ chapterIndex: 1.9, scrollRatio: 0 }).chapterIndex).toBe(1);
        expect(normalizeProgress({ chapterIndex: 'x', scrollRatio: 'y' })).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('非法日期 updatedAt 回退今天（合法 ISO 时间）', () => {
        const p = normalizeProgress({ updatedAt: 'not-a-date' });
        expect(new Date(p.updatedAt).getTime()).not.toBeNaN();
    });
});

describe('阅读进度存储 normalizeProgress 保留合法值', () => {
    it('chapterIndex=3 / scrollRatio=0.5 不变', () => {
        expect(normalizeProgress({ chapterIndex: 3, scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' }))
            .toEqual({ chapterIndex: 3, scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' });
    });
});

describe('阅读进度存储 isProgressDeeper 进度深浅比较', () => {
    const base = { scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' };
    it('chapter 更深 → true', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 1 }, { ...base, chapterIndex: 2 })).toBe(true);
    });

    it('同 chapter scrollRatio 更深 → true', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 2, scrollRatio: 0.3 }, { ...base, chapterIndex: 2, scrollRatio: 0.8 })).toBe(true);
    });

    it('同 chapter scrollRatio 更浅 → false', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 2, scrollRatio: 0.8 }, { ...base, chapterIndex: 2, scrollRatio: 0.3 })).toBe(false);
    });

    it('chapter 更浅 → false（即使 scrollRatio 更大）', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 3, scrollRatio: 0.1 }, { ...base, chapterIndex: 2, scrollRatio: 0.9 })).toBe(false);
    });
});

describe('阅读进度估算 estimatePercent 按章节大小加权', () => {
    // sizes = 各章段落数/字符数；进度 = (前序章总和 + 当前章×ratio) / 总和
    it('未开始（首章顶部）为 0', () => {
        expect(estimatePercent([10, 20, 30], 0, 0)).toBe(0);
    });

    it('首章读到一半：5/60 ≈ 8%', () => {
        expect(estimatePercent([10, 20, 30], 0, 0.5)).toBe(8);
    });

    it('第二章开头：10/60 ≈ 17%', () => {
        expect(estimatePercent([10, 20, 30], 1, 0)).toBe(17);
    });

    it('第二章读到一半：(10+10)/60 ≈ 33%', () => {
        expect(estimatePercent([10, 20, 30], 1, 0.5)).toBe(33);
    });

    it('最后一章到底为 100', () => {
        expect(estimatePercent([10, 20, 30], 2, 1)).toBe(100);
    });

    it('chapterIndex 越界返回 0', () => {
        expect(estimatePercent([10, 20, 30], -1, 0.5)).toBe(0);
        expect(estimatePercent([10, 20, 30], 3, 0.5)).toBe(0);
    });

    it('空章节列表返回 0', () => {
        expect(estimatePercent([], 0, 0.5)).toBe(0);
    });

    it('scrollRatio 越界钳制到 0-1', () => {
        expect(estimatePercent([10, 20, 30], 0, 1.5)).toBe(estimatePercent([10, 20, 30], 0, 1));
        expect(estimatePercent([10, 20, 30], 1, -0.5)).toBe(estimatePercent([10, 20, 30], 1, 0));
    });

    it('章节大小含 0/负值容错（按 0 计）', () => {
        expect(estimatePercent([0, 10, 0], 1, 1)).toBe(100);
        expect(estimatePercent([-5, 10], 0, 0.5)).toBe(0);
    });

    it('全零大小返回 0', () => {
        expect(estimatePercent([0, 0, 0], 1, 0.5)).toBe(0);
    });

    it('单章书：读到一半 50%', () => {
        expect(estimatePercent([100], 0, 0.5)).toBe(50);
    });
});
