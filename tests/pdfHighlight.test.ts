import { describe, expect, it } from 'vitest';
import {
    highlightLabel,
    horizontallyAdjacent,
    mergeLineRects,
    normalizeRects,
    normalizeRelRects,
    pageChunks,
    rectsOverlap,
    relRectStyle,
    sameLine,
    type RectLike,
} from 'pure/pdfHighlight';

/** 构造一个 RectLike（少写点字） */
function r(left: number, top: number, right: number, bottom: number): RectLike {
    return { left, top, right, bottom };
}

describe('pdfHighlight 几何：同行 / 相邻判定', () => {
    it('sameLine：垂直重叠超过较矮者一半才算同行', () => {
        // 高度均为 10，重叠 6 > 5 → 同行
        expect(sameLine(r(0, 0, 10, 10), r(20, 4, 30, 14))).toBe(true);
        // 重叠 2 < 5 → 不同行
        expect(sameLine(r(0, 0, 10, 10), r(20, 8, 30, 18))).toBe(false);
        // 完全不重叠
        expect(sameLine(r(0, 0, 10, 10), r(20, 40, 30, 50))).toBe(false);
    });

    it('sameLine：退化矩形（零高）不判同行', () => {
        expect(sameLine(r(0, 5, 10, 5), r(20, 5, 30, 5))).toBe(false);
    });

    it('horizontallyAdjacent：间隙 ≤ 较窄者宽度 20% 才算相邻', () => {
        // 宽 10，间隙 1 ≤ 2 → 相邻
        expect(horizontallyAdjacent(r(0, 0, 10, 10), r(11, 0, 21, 10))).toBe(true);
        // 间隙 5 > 2 → 不并（分栏场景）
        expect(horizontallyAdjacent(r(0, 0, 10, 10), r(15, 0, 25, 10))).toBe(false);
        // 水平有重叠 → 直接视为相邻
        expect(horizontallyAdjacent(r(0, 0, 10, 10), r(5, 0, 15, 10))).toBe(true);
    });
});

describe('pdfHighlight.mergeLineRects：把一行里的碎框并成一条', () => {
    it('同一行的两段（间隙很小）并成一个框', () => {
        const out = mergeLineRects([r(0, 0, 10, 10), r(11, 0, 25, 10)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ left: 0, top: 0, right: 25, bottom: 10 });
    });

    it('不同行的框保持独立', () => {
        const out = mergeLineRects([r(0, 0, 10, 10), r(0, 20, 10, 30)]);
        expect(out).toHaveLength(2);
    });

    it('同一行但间隙过大（分栏）不合并', () => {
        const out = mergeLineRects([r(0, 0, 10, 10), r(60, 0, 70, 10)]);
        expect(out).toHaveLength(2);
    });

    it('过滤掉退化框（宽或高为 0）', () => {
        expect(mergeLineRects([r(0, 5, 10, 5), r(20, 0, 20, 10)])).toHaveLength(0);
    });

    it('乱序输入按 top 排序后仍正确合并', () => {
        const out = mergeLineRects([r(11, 0, 25, 10), r(0, 0, 10, 10)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ left: 0, top: 0, right: 25, bottom: 10 });
    });

    it('不改动入参', () => {
        const input = [r(0, 0, 10, 10), r(11, 0, 25, 10)];
        mergeLineRects(input);
        expect(input[0]).toEqual({ left: 0, top: 0, right: 10, bottom: 10 });
        expect(input[1]).toEqual({ left: 11, top: 0, right: 25, bottom: 10 });
    });
});

describe('pdfHighlight.normalizeRects：视口像素 → 归一化百分比', () => {
    it('先减原点再除页宽页高（与缩放无关）', () => {
        // 页容器左上角在 (100,200)，页 200×400；框 (150,250)-(250,350)
        const out = normalizeRects([r(150, 250, 250, 350)], { left: 100, top: 200 }, 200, 400);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ x: 0.25, y: 0.125, w: 0.5, h: 0.25 });
    });

    it('越界夹取到 0-1（跨页选区的溢出部分）', () => {
        const out = normalizeRects([r(0, 0, 400, 800)], { left: 100, top: 200 }, 200, 400);
        expect(out[0]!.x).toBe(0);
        expect(out[0]!.y).toBe(0);
        expect(out[0]!.w).toBe(1);
        expect(out[0]!.h).toBe(1);
    });

    it('页尺寸为 0 → 返回空数组（防除零）', () => {
        expect(normalizeRects([r(0, 0, 10, 10)], { left: 0, top: 0 }, 0, 400)).toEqual([]);
        expect(normalizeRects([r(0, 0, 10, 10)], { left: 0, top: 0 }, 200, 0)).toEqual([]);
    });

    it('亚像素碎片被丢弃', () => {
        const out = normalizeRects([r(0, 0, 0.01, 0.01)], { left: 0, top: 0 }, 2000, 2000);
        expect(out).toEqual([]);
    });

    it('输出按阅读顺序（先上后左）排序', () => {
        const out = normalizeRects(
            [r(0, 300, 50, 320), r(60, 0, 100, 20)],
            { left: 0, top: 0 },
            200,
            400,
        );
        expect(out).toHaveLength(2);
        expect(out[0]!.y).toBeLessThan(out[1]!.y);
    });

    it('小数位稳定在 4 位（JSON 可读、单测可比）', () => {
        const out = normalizeRects([r(0, 0, 1, 1)], { left: 0, top: 0 }, 3, 3);
        expect(out[0]).toEqual({ x: 0, y: 0, w: 0.3333, h: 0.3333 });
    });
});

describe('pdfHighlight.relRectStyle：归一化 → 百分比内联样式', () => {
    it('全部换算成百分比字符串', () => {
        expect(relRectStyle({ x: 0.25, y: 0.125, w: 0.5, h: 0.25 })).toEqual({
            left: '25%',
            top: '12.5%',
            width: '50%',
            height: '25%',
        });
    });

    it('0 也输出 0%（不能输出 undefined）', () => {
        const st = relRectStyle({ x: 0, y: 0, w: 1, h: 1 });
        expect(st).toEqual({ left: '0%', top: '0%', width: '100%', height: '100%' });
    });
});

describe('pdfHighlight.rectsOverlap：几何判定「选区压在某条高亮上」', () => {
    const base = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };

    it('交集超过较窄者一半 → 重叠', () => {
        expect(rectsOverlap([base], [{ x: 0.15, y: 0.1, w: 0.2, h: 0.05 }])).toBe(true);
    });

    it('只擦到边（交集过小）→ 不算重叠', () => {
        expect(rectsOverlap([base], [{ x: 0.29, y: 0.1, w: 0.2, h: 0.05 }])).toBe(false);
    });

    it('完全不沾边 → false；空数组 → false', () => {
        expect(rectsOverlap([base], [{ x: 0.9, y: 0.9, w: 0.05, h: 0.05 }])).toBe(false);
        expect(rectsOverlap([], [base])).toBe(false);
        expect(rectsOverlap([base], [])).toBe(false);
    });
});

describe('pdfHighlight.normalizeRelRects：存档白名单入口', () => {
    it('非数组一律 undefined（不是 []：要能区分「没有几何数据」）', () => {
        expect(normalizeRelRects(undefined)).toBeUndefined();
        expect(normalizeRelRects(null)).toBeUndefined();
        expect(normalizeRelRects('x')).toBeUndefined();
        expect(normalizeRelRects({})).toBeUndefined();
    });

    it('合法矩形保留并按阅读顺序排序', () => {
        const out = normalizeRelRects([
            { x: 0.1, y: 0.5, w: 0.2, h: 0.05 },
            { x: 0.1, y: 0.1, w: 0.2, h: 0.05 },
        ]);
        expect(out).toHaveLength(2);
        expect(out![0]!.y).toBe(0.1);
    });

    it('越界夹取、并按剩余空间收缩宽高', () => {
        const out = normalizeRelRects([{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]);
        expect(out![0]).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
    });

    it('缺字段 / 非有限数 / 亚像素 → 丢弃；全丢光 → undefined', () => {
        expect(normalizeRelRects([{ x: 0.1, y: 0.1, w: 0.2 }])).toBeUndefined();
        expect(normalizeRelRects([{ x: NaN, y: 0.1, w: 0.2, h: 0.05 }])).toBeUndefined();
        expect(normalizeRelRects([{ x: 0.1, y: 0.1, w: 0, h: 0.05 }])).toBeUndefined();
        expect(normalizeRelRects([{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }])).toHaveLength(1);
    });
});

describe('pdfHighlight 文本工具', () => {
    it('pageChunks：非数组兜底为空数组', () => {
        expect(pageChunks(['a', 'b'])).toEqual(['a', 'b']);
        expect(pageChunks(undefined as unknown as string[])).toEqual([]);
    });

    it('highlightLabel：压空白 + 超长省略', () => {
        expect(highlightLabel('  a   b  ')).toBe('a b');
        expect(highlightLabel('x'.repeat(50), 10)).toBe('xxxxxxxxxx…');
        expect(highlightLabel('short')).toBe('short');
        expect(highlightLabel(undefined as unknown as string)).toBe('');
    });
});
