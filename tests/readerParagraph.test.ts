import { describe, it, expect } from 'vitest';
import { normalizeParagraphText, paraPct, PARA_QUOTE_MAX } from 'pure/readerParagraph';

// #347：单击书签不再只存「章节 + 百分比」，而是**记录当前段落**（文本 + 段落起点的百分比）。
describe('书签的「当前段落」口径（#347）', () => {
    describe('normalizeParagraphText（段落文本 → 书签引用）', () => {
        it('折叠所有空白为单个空格并去首尾（OCR/排版里的换行、连续空格不该进引用）', () => {
            expect(normalizeParagraphText('  老爷爷，\n\n我并  没有说错。\t')).toBe('老爷爷， 我并 没有说错。');
        });

        it('空串 / 纯空白 → 空串（调用方据此回退成纯位置书签）', () => {
            expect(normalizeParagraphText('')).toBe('');
            expect(normalizeParagraphText('   \n\t ')).toBe('');
        });

        it('超长段落按上限截断并补省略号', () => {
            const out = normalizeParagraphText('甲'.repeat(PARA_QUOTE_MAX + 20));
            expect(out.length).toBe(PARA_QUOTE_MAX + 1); // 上限 + 省略号
            expect(out.endsWith('…')).toBe(true);
        });

        it('正好等于上限时不截断（边界不多加省略号）', () => {
            const exact = '乙'.repeat(PARA_QUOTE_MAX);
            expect(normalizeParagraphText(exact)).toBe(exact);
        });

        it('可传自定义上限', () => {
            expect(normalizeParagraphText('abcdef', 3)).toBe('abc…');
        });
    });

    describe('paraPct（段落起点偏移 → 章节内百分比）', () => {
        it('常规换算取整', () => {
            expect(paraPct(250, 1000)).toBe(25);
        });

        it('顶部 → 0', () => {
            expect(paraPct(0, 1000)).toBe(0);
        });

        it('负数偏移（外框抖动）夹到 0，⛔ 不产出负百分比', () => {
            expect(paraPct(-30, 1000)).toBe(0);
        });

        it('超过内容高度（末段 + 浮点误差）夹到 100', () => {
            expect(paraPct(1200, 1000)).toBe(100);
        });

        it('未布局（scrollHeight ≤ 0）或非法值 → 0，退回章首（⛔ 不产出 NaN）', () => {
            expect(paraPct(100, 0)).toBe(0);
            expect(paraPct(100, -5)).toBe(0);
            expect(paraPct(Number.NaN, 1000)).toBe(0);
            expect(paraPct(100, Number.NaN)).toBe(0);
        });
    });
});
