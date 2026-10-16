import { describe, it, expect } from 'vitest';
import { formatCharCount, clampTocWidth, tocWidthValue, TOC_WIDTH_VAR, TOC_WIDTH_MIN, TOC_WIDTH_MAX } from 'pure/readerToc';

describe('formatCharCount（目录字数展示，#338）', () => {
    it('小于一万 → 原样数字', () => {
        expect(formatCharCount(0)).toBe('0');
        expect(formatCharCount(320)).toBe('320');
        expect(formatCharCount(9999)).toBe('9999');
    });

    it('一万以上 → 「x.x万」（整数万不带 .0）', () => {
        expect(formatCharCount(10000)).toBe('1万');
        expect(formatCharCount(12300)).toBe('1.2万');
        expect(formatCharCount(345600)).toBe('34.6万');
        expect(formatCharCount(1000000)).toBe('100万');
    });

    it('非法值 → 空串（不显示）', () => {
        expect(formatCharCount(NaN)).toBe('');
        expect(formatCharCount(-5)).toBe('');
    });
});

describe('clampTocWidth（目录侧栏拖宽的夹取，#338）', () => {
    it('夹在最小/最大之间', () => {
        expect(clampTocWidth(100)).toBe(TOC_WIDTH_MIN);
        expect(clampTocWidth(300)).toBe(300);
        expect(clampTocWidth(9999)).toBe(TOC_WIDTH_MAX);
    });

    it('非法值回退缺省 220（与原定宽一致）', () => {
        expect(clampTocWidth(NaN)).toBe(220);
    });
});

describe('tocWidthValue（#339：宽度走 CSS 变量，行内绝不写 style.width）', () => {
    it('产出裸长度值（配合 setProperty(`--rl-toc-w`, …)），且已夹取', () => {
        expect(TOC_WIDTH_VAR).toBe('--rl-toc-w');
        expect(tocWidthValue(260)).toBe('260px');
        expect(tocWidthValue(100)).toBe(`${TOC_WIDTH_MIN}px`);
        expect(tocWidthValue(9999)).toBe(`${TOC_WIDTH_MAX}px`);
    });

    it('🔴 必须是**裸长度值**而不是一条 `width` 声明（行内 width 会顶死 `.collapsed { width: 0 }` ⇒ 侧栏收不起来）', () => {
        expect(tocWidthValue(260)).toMatch(/^\d+px$/);
        expect(tocWidthValue(NaN)).toBe('220px');
    });
});
