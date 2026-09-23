import { describe, it, expect } from 'vitest';
import {
    FONT_FAMILY_OPTIONS,
    FONT_WEIGHT_OPTIONS,
    INDENT_OPTIONS,
    LETTER_DEFAULT,
    LETTER_MAX,
    LETTER_MIN,
    LETTER_STEP,
    SCROLL_OPTIONS,
    WIDTH_OPTIONS,
    fontFamilyCss,
    fontWeightCss,
    formatLetterSpacing,
    normalizeFontFamily,
    normalizeFontWeight,
    normalizeLetterSpacing,
} from 'pure/readerTypography';

// #351：设置面板重排 —— 分段控制器的**选项词表**与归一化都收敛在这里（两个阅读器共用，⛔ 不各写一份）。
describe('阅读排版词表（#351）', () => {
    describe('归一化（坏值/旧数据 → 默认值，⛔ 不产出越界值）', () => {
        it('字体：认四档，未知 → default', () => {
            expect(normalizeFontFamily('serif')).toBe('serif');
            expect(normalizeFontFamily('mono')).toBe('mono');
            expect(normalizeFontFamily('comic-sans')).toBe('default');
            expect(normalizeFontFamily(undefined)).toBe('default');
            expect(normalizeFontFamily(42)).toBe('default');
        });

        it('字重：只认两档（#351b 删「中等」）；未知 —— 含旧数据里的 medium —— 一律 → normal', () => {
            expect(normalizeFontWeight('bold')).toBe('bold');
            expect(normalizeFontWeight('medium')).toBe('normal'); // 旧存档退场：删选项不靠迁移，靠「不在词表就兜回」
            expect(normalizeFontWeight('900')).toBe('normal');
            expect(normalizeFontWeight(null)).toBe('normal');
        });

        it('字距：夹取到 [min,max] 并按步长取整；非法 → 默认 0', () => {
            expect(normalizeLetterSpacing(0.05)).toBeCloseTo(0.05, 5);
            expect(normalizeLetterSpacing(9)).toBe(LETTER_MAX);
            expect(normalizeLetterSpacing(-9)).toBe(LETTER_MIN);
            expect(normalizeLetterSpacing(Number.NaN)).toBe(LETTER_DEFAULT);
            expect(normalizeLetterSpacing('0.03')).toBe(LETTER_DEFAULT); // 字符串不认（防旧数据里混着 "0.03em"）
            expect(normalizeLetterSpacing(0.037)).toBeCloseTo(0.04, 5); // 按 0.01 步长取整
        });
    });

    describe('CSS 值产出', () => {
        it('字体族：default → 空串（继承宿主），其余给出真实字族栈', () => {
            expect(fontFamilyCss('default')).toBe('');
            expect(fontFamilyCss('serif')).toContain('serif');
            expect(fontFamilyCss('sans')).toContain('sans-serif');
            expect(fontFamilyCss('mono')).toContain('monospace');
        });

        it('字重：两档 → 数值（常规 400 / 粗体 700）', () => {
            expect(fontWeightCss('normal')).toBe(400);
            expect(fontWeightCss('bold')).toBe(700);
        });

        it('字距显示：0 → `0em`，其余保留两位小数（0.5 → 0.5em 不带尾零）', () => {
            expect(formatLetterSpacing(0)).toBe('0em');
            expect(formatLetterSpacing(0.05)).toBe('0.05em');
            expect(formatLetterSpacing(0.1)).toBe('0.1em');
            expect(formatLetterSpacing(-0.02)).toBe('-0.02em');
        });
    });

    describe('分段控制器的选项表（标签/取值唯一，顺序即界面顺序）', () => {
        const tables = { FONT_FAMILY_OPTIONS, FONT_WEIGHT_OPTIONS, SCROLL_OPTIONS, WIDTH_OPTIONS, INDENT_OPTIONS };
        it('每张表的标签与取值都不重复（同排两个同名/同值段无法区分）', () => {
            for (const [name, table] of Object.entries(tables)) {
                const labels = table.map((o) => o.label);
                const values = table.map((o) => String(o.value));
                expect(new Set(labels).size, name).toBe(labels.length);
                expect(new Set(values).size, name).toBe(values.length);
            }
        });

        it('顺序是契约：字体「默认｜无衬线｜衬线｜等宽」、字重「常规｜粗体」、阅读「滚动｜翻页」、行宽「适中｜全宽」、缩进「首行｜齐头」', () => {
            // #351e 用户口径：字体改纯字变色切换，首项标签由「系统默认」收成「默认」（四项要在一行排下）
            expect(FONT_FAMILY_OPTIONS.map((o) => o.label)).toEqual(['默认', '无衬线', '衬线', '等宽']);
            expect(FONT_WEIGHT_OPTIONS.map((o) => o.label)).toEqual(['常规', '粗体']); // #351b 用户：删除「中等」
            expect(SCROLL_OPTIONS.map((o) => o.label)).toEqual(['滚动', '翻页']);
            expect(WIDTH_OPTIONS.map((o) => o.label)).toEqual(['适中', '全宽']);
            expect(INDENT_OPTIONS.map((o) => o.label)).toEqual(['首行', '齐头']);
        });

        it('缩进表的值是真布尔（true=首行缩进 / false=齐头）', () => {
            expect(INDENT_OPTIONS.map((o) => o.value)).toEqual([true, false]);
        });

        it('字距滑条区间合法（min < 默认 < max，步长 > 0）', () => {
            expect(LETTER_MIN).toBeLessThan(LETTER_DEFAULT);
            expect(LETTER_DEFAULT).toBeLessThan(LETTER_MAX);
            expect(LETTER_STEP).toBeGreaterThan(0);
        });
    });
});
