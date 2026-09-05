import { describe, it, expect } from 'vitest';
import { parseTxtBook, isChapterLine, chapterParagraphs } from 'pure/txtParse';

describe('TXT 书籍解析 标准文本：章节与段落范围', () => {
    it('有「第一章/第二章」→ chapters 2 个，title/startPara 正确，chapterParagraphs 范围正确', () => {
        const text = [
            '三体',
            '',
            '第一章 科学边界',
            '汪淼感到自己正在被凝视。',
            '',
            '第二章 台球',
            '丁仪把球杆放到桌上。',
            '第三个段落',
        ].join('\n');
        const book = parseTxtBook(text);
        // 空行剔除，标题行保留为段落（渲染层跳过标题首段）
        expect(book.paragraphs).toEqual([
            '三体',
            '第一章 科学边界',
            '汪淼感到自己正在被凝视。',
            '第二章 台球',
            '丁仪把球杆放到桌上。',
            '第三个段落',
        ]);
        expect(book.chapters).toEqual([
            { title: '第一章 科学边界', startPara: 1 },
            { title: '第二章 台球', startPara: 3 },
        ]);
        expect(chapterParagraphs(book, 0)).toEqual(['第一章 科学边界', '汪淼感到自己正在被凝视。']);
        expect(chapterParagraphs(book, 1)).toEqual(['第二章 台球', '丁仪把球杆放到桌上。', '第三个段落']);
    });

    it('带冒号标题「第一章：xxx」也能识别', () => {
        expect(isChapterLine('第一章：科学边界')).toBe(true);
        expect(isChapterLine('第1章 台球')).toBe(true);
    });

    it('chapterParagraphs 越界返回空数组', () => {
        const book = parseTxtBook('第一章\n正文');
        expect(chapterParagraphs(book, -1)).toEqual([]);
        expect(chapterParagraphs(book, 99)).toEqual([]);
    });
});

describe('TXT 书籍解析 无章节标题', () => {
    it('整书单章「全文」', () => {
        const book = parseTxtBook('第一行\n第二行\n');
        expect(book.chapters).toEqual([{ title: '全文', startPara: 0 }]);
        expect(chapterParagraphs(book, 0)).toEqual(['第一行', '第二行']);
    });
});

describe('TXT 书籍解析 章节行不误判', () => {
    it('正文长句（>40 字符）即使以「第X章」开头也不算章节行', () => {
        const long = '第3章 是线索' + '的伏笔'.repeat(30); // 明显 >40 字符
        expect(long.length).toBeGreaterThan(40);
        expect(isChapterLine(long)).toBe(false);
    });

    it('非独立行格式（标题前有其他文本）不算章节行', () => {
        expect(isChapterLine('他提到第一章 科学边界是伏笔')).toBe(false);
        expect(isChapterLine('这是前言，第二章开始')).toBe(false);
    });

    it('过短/空行不算章节行', () => {
        expect(isChapterLine('')).toBe(false);
        expect(isChapterLine('一')).toBe(false);
        expect(isChapterLine('第')).toBe(false);
    });
});

describe('TXT 书籍解析 全角数字章节', () => {
    it('「第十二章」匹配并在书中正确成章', () => {
        expect(isChapterLine('第十二章 大撕裂')).toBe(true);
        const book = parseTxtBook('第十二章 大撕裂\n正文内容\n第十三章 结局\n最后一段');
        expect(book.chapters).toEqual([
            { title: '第十二章 大撕裂', startPara: 0 },
            { title: '第十三章 结局', startPara: 2 },
        ]);
    });

    it('「第１２章」全角阿拉伯数字匹配', () => {
        expect(isChapterLine('第１２章 试探')).toBe(true);
    });
});

describe('TXT 书籍解析 特殊标题（楔子/序章/终章/番外等）', () => {
    it('常见章节形态均匹配', () => {
        for (const t of ['楔子', '序章', '序言', '前言', '引子', '终章', '尾声', '后记', '番外', '番外篇', '番外章']) {
            expect(isChapterLine(t)).toBe(true);
        }
    });
});

describe('TXT 书籍解析 空文本', () => {
    it('paragraphs 空 + 单章「全文」', () => {
        const book = parseTxtBook('');
        expect(book.paragraphs).toEqual([]);
        expect(book.chapters).toEqual([{ title: '全文', startPara: 0 }]);
    });

    it('纯空行/换行文本同样处理', () => {
        const book = parseTxtBook('\r\n\n  \r\n');
        expect(book.paragraphs).toEqual([]);
        expect(book.chapters).toEqual([{ title: '全文', startPara: 0 }]);
    });
});
