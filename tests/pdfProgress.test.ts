// PDF 阅读器纯逻辑测试：等权页进度估算 + outline 目录规整
import { describe, it, expect } from 'vitest';
import { estimatePdfPercent, normalizePdfOutline, flattenPdfOutline, chooseActivePdfIndex, resolveFlushPos, type PdfOutlineItem } from 'pure/pdfProgress';

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

describe('resolveFlushPos（关闭落盘位置兜底：DOM 拆解归零时用最后已知位置）', () => {
    it('关闭时 DOM 归零但会话读过深处 → 用最后已知位置', () => {
        const r = resolveFlushPos(
            { chapterIndex: 0, scrollRatio: 0 }, // 关闭瞬间读到的（Modal 拆解 scrollTop 已归零）
            { chapterIndex: 26, scrollRatio: 0.12 }, // 滚动中最后保存
        );
        expect(r).toEqual({ chapterIndex: 26, scrollRatio: 0.12 });
    });

    it('确在开头关闭（无阅读）→ 保持实时值 0/0', () => {
        const r = resolveFlushPos({ chapterIndex: 0, scrollRatio: 0 }, { chapterIndex: 0, scrollRatio: 0 });
        expect(r).toEqual({ chapterIndex: 0, scrollRatio: 0 });
    });

    it('关闭瞬间仍在正文中（DOM 有效）→ 用实时值', () => {
        const r = resolveFlushPos({ chapterIndex: 33, scrollRatio: 0.5 }, { chapterIndex: 26, scrollRatio: 0.12 });
        expect(r).toEqual({ chapterIndex: 33, scrollRatio: 0.5 });
    });

    it('读到页 1 中部即关闭（chapter 0 但 ratio>0）→ 实时值不算归零，优先实时', () => {
        const r = resolveFlushPos({ chapterIndex: 0, scrollRatio: 0.4 }, { chapterIndex: 0, scrollRatio: 0 });
        expect(r).toEqual({ chapterIndex: 0, scrollRatio: 0.4 });
    });
});

describe('flattenPdfOutline（目录 DFS 扁平化，顺序对齐侧栏 DOM 行）', () => {
    it('嵌套目录按 DFS 展开并带深度', () => {
        const items: PdfOutlineItem[] = [
            { label: '第 1 章', pageIndex: 0, children: [{ label: '1.1', pageIndex: 1, children: [] }] },
            { label: '第 2 章', pageIndex: 5, children: [] },
        ];
        expect(flattenPdfOutline(items).map((f) => `${f.label}@${f.depth}`)).toEqual(['第 1 章@0', '1.1@1', '第 2 章@0']);
    });

    it('未解析页码（-1）条目保留在列中', () => {
        const items: PdfOutlineItem[] = [{ label: 'X', pageIndex: -1, children: [] }];
        const f = flattenPdfOutline(items);
        expect(f).toHaveLength(1);
        expect(f[0].pageIndex).toBe(-1);
    });
});

describe('chooseActivePdfIndex（当前页对应目录高亮行：取最接近且未超当前页的条目）', () => {
    const flat = flattenPdfOutline([
        { label: '第 1 章', pageIndex: 0, children: [] },
        { label: '第 2 章', pageIndex: 10, children: [] },
        { label: '第 3 章', pageIndex: 25, children: [] },
    ]);

    it('第 5 章区间（page 30）→ 高亮第 3 章行（索引 2）', () => {
        expect(chooseActivePdfIndex(flat, 30)).toBe(2);
    });

    it('第 2 章内（page 12）→ 索引 1；开篇（page 3）→ 索引 0', () => {
        expect(chooseActivePdfIndex(flat, 12)).toBe(1);
        expect(chooseActivePdfIndex(flat, 3)).toBe(0);
    });

    it('目录前的扉页（page 前于第 1 章且无 -1 占位匹配）→ -1 不高亮', () => {
        expect(chooseActivePdfIndex(flat, -1)).toBe(-1);
        expect(chooseActivePdfIndex([], 5)).toBe(-1);
    });

    it('同页多条目（章与子节同页）→ 取更深的后一条', () => {
        const f2 = flattenPdfOutline([
            { label: '章', pageIndex: 7, children: [{ label: '子', pageIndex: 7, children: [] }] },
        ]);
        expect(chooseActivePdfIndex(f2, 7)).toBe(1);
    });

    it('pageIndex 未解析（-1）的条目不参与高亮', () => {
        const f3 = flattenPdfOutline([
            { label: 'A', pageIndex: -1, children: [] },
            { label: 'B', pageIndex: 3, children: [] },
        ]);
        expect(chooseActivePdfIndex(f3, 2)).toBe(-1);
        expect(chooseActivePdfIndex(f3, 4)).toBe(1);
    });
});
