// PDF 阅读器纯逻辑测试：等权页进度估算 + outline 目录规整
import { describe, it, expect } from 'vitest';
import { estimatePdfPercent, normalizePdfOutline, type PdfOutlineItem } from 'pure/pdfProgress';

describe('estimatePdfPercent（PDF 页等权进度估算）', () => {
    it('首页顶部 = 0%，末页底部 = 100%', () => {
        expect(estimatePdfPercent(100, 0, 0)).toBe(0);
        expect(estimatePdfPercent(100, 99, 1)).toBe(100);
    });

    it('整页等权：第 51 页顶部 = 50%', () => {
        expect(estimatePdfPercent(100, 50, 0)).toBe(50);
    });

    it('页内滚动比例并入：第 50 页底部 = 50%（(49+1)/100）', () => {
        expect(estimatePdfPercent(100, 49, 1)).toBe(50);
    });

    it('页内比例钳制 0-1：越界按边界计', () => {
        expect(estimatePdfPercent(10, 0, -0.5)).toBe(0);
        expect(estimatePdfPercent(10, 0, 1.5)).toBe(10); // (0+1)/10
    });

    it('非法页码/总页数 → 0', () => {
        expect(estimatePdfPercent(0, 0, 0)).toBe(0);
        expect(estimatePdfPercent(-1, 0, 0)).toBe(0);
        expect(estimatePdfPercent(10, -1, 0)).toBe(0);
        expect(estimatePdfPercent(10, 10, 0)).toBe(0); // 越界（0 基，最大 9）
        expect(estimatePdfPercent(10, 1.5, 0)).toBe(0); // 非整数页
    });

    it('四舍五入：3 页第 2 页中段 ≈ 50%', () => {
        expect(estimatePdfPercent(3, 1, 0.5)).toBe(50); // (1.5/3)=50%
    });
});

describe('normalizePdfOutline（outline 防御性规整）', () => {
    it('空/非数组 → []', () => {
        expect(normalizePdfOutline(null)).toEqual([]);
        expect(normalizePdfOutline('x')).toEqual([]);
        expect(normalizePdfOutline([])).toEqual([]);
    });

    it('单层条目：label 保留、无 pageIndex → -1、children 空', () => {
        const r = normalizePdfOutline([{ title: '第一章' }] as unknown[]);
        expect(r).toHaveLength(1);
        expect(r[0].label).toBe('第一章');
        expect(r[0].pageIndex).toBe(-1);
        expect(r[0].children).toEqual([]);
    });

    it('带 pageIndex 条目透传', () => {
        const r = normalizePdfOutline([{ title: '封面', pageIndex: 0 }] as unknown[]);
        expect(r[0]).toEqual({ label: '封面', pageIndex: 0, children: [] });
    });

    it('嵌套条目递归规整（children 展开）', () => {
        const raw = [
            { title: '目录', pageIndex: 1, items: [{ title: '3.1 引言', pageIndex: 3 }] },
        ] as unknown[];
        const r: PdfOutlineItem[] = normalizePdfOutline(raw);
        expect(r).toHaveLength(1);
        expect(r[0].label).toBe('目录');
        expect(r[0].children).toHaveLength(1);
        expect(r[0].children[0]).toEqual({ label: '3.1 引言', pageIndex: 3, children: [] });
    });

    it('非法节点容错：无 title 无 pageIndex 的条目过滤', () => {
        const r = normalizePdfOutline([{ title: '' }, { title: '有效', pageIndex: 2 }] as unknown[]);
        expect(r).toHaveLength(1);
        expect(r[0].label).toBe('有效');
    });

    it('dest 透传保留（点击时延迟解析页码）', () => {
        const r = normalizePdfOutline([{ title: '第一章', dest: [13, { name: 'XYZ' }, 0] }] as unknown[]);
        expect(r[0].dest).toEqual([13, { name: 'XYZ' }, 0]);
        expect(r[0].pageIndex).toBe(-1);
    });
});
