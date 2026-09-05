import { describe, it, expect } from 'vitest';
import { reconcileBookProgress, pageFromPercent } from 'pure/bookProgress';

describe('bookProgress 百分比→页码换算', () => {
    it('按总页数等比例取整，钳制 0..totalPage', () => {
        expect(pageFromPercent(40, 250)).toBe(100);
        expect(pageFromPercent(0, 250)).toBe(0);
        expect(pageFromPercent(100, 250)).toBe(250);
        expect(pageFromPercent(12.34, 250)).toBe(31); // round(30.85)
        expect(pageFromPercent(40, 0)).toBe(0);
        expect(pageFromPercent(40, -5)).toBe(0);
    });
});

describe('bookProgress PDF 本地基准校正（percent 存在）', () => {
    it('首次关联：无 totalPage → totalPage=numPages，page 由 percent 派生，不迁移 pageCount', () => {
        const r = reconcileBookProgress({ percent: 40 }, { format: 'pdf', numPages: 250 });
        expect(r).toEqual({ readingProgress: { page: 100, totalPage: 250, percent: 40 } });
        expect(r.pageCount).toBeUndefined();
    });

    it('基准不一致（豆瓣 300 vs 本地 250）：totalPage 校正为本地，page 按 percent 重算，旧 totalPage 惰性迁移为 pageCount', () => {
        const r = reconcileBookProgress({ page: 120, totalPage: 300, percent: 40 }, { format: 'pdf', numPages: 250 });
        expect(r.readingProgress).toEqual({ page: 100, totalPage: 250, percent: 40 });
        expect(r.pageCount).toBe(300);
    });

    it('已校正再打开（totalPage=本地页数）：无基准变化，percent 未变 → 返回空（不重复落库）', () => {
        const r = reconcileBookProgress({ page: 100, totalPage: 250, percent: 40, pageCount: 300 }, { format: 'pdf', numPages: 250 });
        expect(r).toEqual({});
    });

    it('percent 更新（40→50）而 page 未跟随：重算 page=125', () => {
        const r = reconcileBookProgress({ page: 100, totalPage: 250, percent: 50, pageCount: 300 }, { format: 'pdf', numPages: 250 });
        expect(r.readingProgress).toEqual({ page: 125, totalPage: 250, percent: 50 });
    });

    it('percent 边界：0 → page 0；100 → page=numPages', () => {
        expect(reconcileBookProgress({ percent: 0, totalPage: 300 }, { format: 'pdf', numPages: 250 }).readingProgress?.page).toBe(0);
        expect(reconcileBookProgress({ percent: 100, totalPage: 300 }, { format: 'pdf', numPages: 250 }).readingProgress?.page).toBe(250);
    });
});

describe('bookProgress PDF 手填场景（无 percent）', () => {
    it('手填 page 超界：钳制到 numPages', () => {
        const r = reconcileBookProgress({ page: 280, totalPage: 300 }, { format: 'pdf', numPages: 250 });
        expect(r.readingProgress).toEqual({ page: 250, totalPage: 250 });
        expect(r.pageCount).toBe(300); // 旧 totalPage 仍惰性迁移
    });

    it('手填 page 未超界：保留原值，仅校正 totalPage', () => {
        const r = reconcileBookProgress({ page: 80, totalPage: 300 }, { format: 'pdf', numPages: 250 });
        expect(r.readingProgress).toEqual({ page: 80, totalPage: 250 });
    });

    it('pageCount 已存在：不再覆盖迁移值', () => {
        const r = reconcileBookProgress({ page: 80, totalPage: 300, pageCount: 320 }, { format: 'pdf', numPages: 250 });
        expect(r.readingProgress).toEqual({ page: 80, totalPage: 250 });
        expect(r.pageCount).toBeUndefined();
    });
});

describe('bookProgress TXT 章节基准校正（按章节解析）', () => {
    it('首次关联：无 totalPage → totalPage=章节数，page 由 percent 派生，不迁移 pageCount', () => {
        const r = reconcileBookProgress({ percent: 40 }, { format: 'txt', totalChapters: 12 });
        expect(r).toEqual({ readingProgress: { page: 5, totalPage: 12, percent: 40 } }); // round(4.8)
        expect(r.pageCount).toBeUndefined();
    });

    it('基准不一致（豆瓣 300 页 vs 本地 12 章）：totalPage 校正为章节数，page 按 percent 重算；TXT 不迁移 pageCount', () => {
        const r = reconcileBookProgress({ page: 8, totalPage: 300, percent: 40 }, { format: 'txt', totalChapters: 12 });
        expect(r.readingProgress).toEqual({ page: 5, totalPage: 12, percent: 40 });
        expect(r.pageCount).toBeUndefined();
    });

    it('已校正再打开（totalPage=章节数）：无基准变化，percent 未变 → 返回空（不重复落库）', () => {
        const r = reconcileBookProgress({ page: 5, totalPage: 12, percent: 40 }, { format: 'txt', totalChapters: 12 });
        expect(r).toEqual({});
    });

    it('percent 边界：0 → page 0；100 → page=章节数', () => {
        expect(reconcileBookProgress({ percent: 0, totalPage: 300 }, { format: 'txt', totalChapters: 12 }).readingProgress?.page).toBe(0);
        expect(reconcileBookProgress({ percent: 100, totalPage: 300 }, { format: 'txt', totalChapters: 12 }).readingProgress?.page).toBe(12);
    });

    it('手填无 percent：超界钳制到章节数，不迁移 pageCount', () => {
        const r = reconcileBookProgress({ page: 20, totalPage: 300 }, { format: 'txt', totalChapters: 12 });
        expect(r.readingProgress).toEqual({ page: 12, totalPage: 12 });
        expect(r.pageCount).toBeUndefined();
    });

    it('手填无 percent 未超界：保留原值，仅校正 totalPage', () => {
        const r = reconcileBookProgress({ page: 3, totalPage: 300 }, { format: 'txt', totalChapters: 12 });
        expect(r.readingProgress).toEqual({ page: 3, totalPage: 12 });
    });

    it('无章节结构（整书单章）：totalChapters=1，percent 100 → page 1', () => {
        const r = reconcileBookProgress({ percent: 100 }, { format: 'txt', totalChapters: 1 });
        expect(r.readingProgress).toEqual({ page: 1, totalPage: 1, percent: 100 });
    });

    it('totalChapters 非法（0 / 负 / NaN / 小数）：不校正', () => {
        expect(reconcileBookProgress({ percent: 40 }, { format: 'txt', totalChapters: 0 })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'txt', totalChapters: -3 })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'txt', totalChapters: Number.NaN })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'txt', totalChapters: 12.5 })).toEqual({});
    });
});

describe('bookProgress 不校正场景', () => {
    it('EPUB：percent 直落，不碰 totalPage（无轻量探针，页/章基准均不适用）', () => {
        expect(reconcileBookProgress({ page: 0, totalPage: 300, percent: 40 }, { format: 'epub' })).toEqual({});
    });

    it('无本地文件（手填/豆瓣兜底）：不校正', () => {
        expect(reconcileBookProgress({ totalPage: 300, percent: 40 }, null)).toEqual({});
    });

    it('numPages 非法（0 / 负 / NaN / 小数）：不校正', () => {
        expect(reconcileBookProgress({ percent: 40 }, { format: 'pdf', numPages: 0 })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'pdf', numPages: -3 })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'pdf', numPages: Number.NaN })).toEqual({});
        expect(reconcileBookProgress({ percent: 40 }, { format: 'pdf', numPages: 12.5 })).toEqual({});
    });

    it('空进度 + 无文件：空', () => {
        expect(reconcileBookProgress({}, null)).toEqual({});
    });
});
