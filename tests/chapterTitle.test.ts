// 章节标题展示格式测试：顶栏「第几章：章名」口径。
import { describe, it, expect } from 'vitest';
import { formatChapterTitle } from 'pure/chapterTitle';

describe('pure/chapterTitle formatChapterTitle', () => {
    it('编号 + 章名 → 编号：章名（半角空格分隔）', () => {
        expect(formatChapterTitle('第三章 风起')).toBe('第三章：风起');
        expect(formatChapterTitle('第十二回 大闹天宫')).toBe('第十二回：大闹天宫');
        expect(formatChapterTitle('第 3 章 归途')).toBe('第 3 章：归途');
    });
    it('编号与章名紧贴（无空格）也能拆开', () => {
        expect(formatChapterTitle('第三章风起')).toBe('第三章：风起');
        expect(formatChapterTitle('第3章归途')).toBe('第3章：归途');
    });
    it('原文已有分隔符（：/./、）→ 归一为全角冒号，不重复堆叠', () => {
        expect(formatChapterTitle('第三章：风起')).toBe('第三章：风起');
        expect(formatChapterTitle('第三章. 风起')).toBe('第三章：风起');
        expect(formatChapterTitle('第三章、风起')).toBe('第三章：风起');
        expect(formatChapterTitle('第三章：：风起')).toBe('第三章：风起');
    });
    it('只有编号无章名 → 只显示编号', () => {
        expect(formatChapterTitle('第三章')).toBe('第三章');
        expect(formatChapterTitle('第三章 ')).toBe('第三章');
        expect(formatChapterTitle('第三章：')).toBe('第三章');
    });
    it('非编号型标题原样保留（楔子/序章/番外/纯章名/英文）', () => {
        expect(formatChapterTitle('楔子')).toBe('楔子');
        expect(formatChapterTitle('序章 雪夜')).toBe('序章 雪夜');
        expect(formatChapterTitle('番外篇')).toBe('番外篇');
        expect(formatChapterTitle('终章')).toBe('终章');
        expect(formatChapterTitle('Chapter 1 Arrival')).toBe('Chapter 1 Arrival');
        expect(formatChapterTitle('风起')).toBe('风起');
    });
    it('全角数字编号识别', () => {
        expect(formatChapterTitle('第１２章 起航')).toBe('第１２章：起航');
    });
    it('空/非字符串 → 空串（调用方回退书名）', () => {
        expect(formatChapterTitle('')).toBe('');
        expect(formatChapterTitle('   ')).toBe('');
        expect(formatChapterTitle(undefined)).toBe('');
        expect(formatChapterTitle(null)).toBe('');
        expect(formatChapterTitle(42)).toBe('');
    });
    it('超长章名不截断（交由 CSS ellipsis）', () => {
        const long = '第三章 ' + '风'.repeat(120);
        expect(formatChapterTitle(long)).toBe('第三章：' + '风'.repeat(120));
    });
});
