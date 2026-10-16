import { describe, it, expect } from 'vitest';
import { parseTxtBook, isChapterLine, chapterParagraphs, txtChapterUnits, SPLIT_CHARS_PER_CHAPTER } from 'pure/txtParse';

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

describe('TXT 书籍解析 超大章自动切节（防整书退化成单章 → 一次渲染卡死）', () => {
    /** 造 n 段、每段 len 字的文本 */
    const bulk = (n: number, len: number): string => {
        const unit = '段落内容'.repeat(Math.ceil(len / 4)).slice(0, len);
        return Array.from({ length: n }, () => unit).join('\n');
    };

    it('超过阈值的「无章节标记」长书被切成多节（标题带 · N 后缀）', () => {
        const per = 12;
        const count = Math.ceil((SPLIT_CHARS_PER_CHAPTER * 1.5) / per); // 约 1.5 倍阈值
        const book = parseTxtBook(bulk(count, per));
        expect(book.chapters.length).toBeGreaterThan(1);
        expect(book.chapters[0].title).toBe('全文 · 1');
        expect(book.chapters[1].title).toBe('全文 · 2');
    });

    it('切节不切断段落：各节段落拼接 === 全书段落', () => {
        const book = parseTxtBook(bulk(4000, 12));
        const merged = book.chapters.flatMap((_, i) => chapterParagraphs(book, i));
        expect(merged).toEqual(book.paragraphs);
    });

    it('单节不超过阈值太多（每节字数受控）', () => {
        const book = parseTxtBook(bulk(6000, 12));
        for (let i = 0; i < book.chapters.length; i++) {
            const chars = chapterParagraphs(book, i).reduce((s, p) => s + p.length, 0);
            expect(chars).toBeLessThanOrEqual(SPLIT_CHARS_PER_CHAPTER + 12); // 允许多出一个段落
        }
    });

    it('普通短章不受影响（标题不加后缀）', () => {
        const book = parseTxtBook('第一章 风起\n正文一段\n第二章 雨落\n正文二段');
        expect(book.chapters.map((c) => c.title)).toEqual(['第一章 风起', '第二章 雨落']);
    });

    it('超长单章（有标题但内容超阈值）也切节，标题沿用原名 + · N', () => {
        const text = '第一章 超长章\n' + bulk(5000, 12);
        const book = parseTxtBook(text);
        expect(book.chapters.length).toBeGreaterThan(1);
        expect(book.chapters[0].title).toBe('第一章 超长章 · 1');
        expect(book.chapters[1].title).toBe('第一章 超长章 · 2');
    });
});

describe('txtChapterUnits（#338 目录每章字数 / #345 中英分口径）', () => {
    it('按 startPara 切段累计；纯中文逐字、段内空白不计', () => {
        const paras = ['第一章 起点', '正文 甲', '正文乙', '第二章 转折', '正文丙'];
        const chapters = [
            { title: '第一章 起点', startPara: 0 },
            { title: '第二章 转折', startPara: 3 },
        ];
        // 第一章：5 + 3 + 3 = 11（『正文 甲』的空格不算）；第二章：5 + 3 = 8
        expect(txtChapterUnits(paras, chapters)).toEqual([11, 8]);
    });

    it('🔴 英文按「词」而不是按字母（旧口径会把 hello world 算成 10）', () => {
        const paras = ['hello world', 'the quick brown fox'];
        expect(txtChapterUnits(paras, [{ title: 'ch', startPara: 0 }])).toEqual([6]);
    });

    it('🔴 中英混排 → 字 + 词 相加', () => {
        const paras = ['第 1 章 hello 世界'];
        // 第/章/世/界 = 4 字 + 1/hello = 2 词
        expect(txtChapterUnits(paras, [{ title: 'ch', startPara: 0 }])).toEqual([6]);
    });

    it('末章到段落结尾；空书 → 0；无章节 → 空数组', () => {
        expect(txtChapterUnits(['a', 'b'], [{ title: 'x', startPara: 1 }])).toEqual([1]);
        expect(txtChapterUnits([], [{ title: 'x', startPara: 0 }])).toEqual([0]);
        expect(txtChapterUnits(['a'], [])).toEqual([]);
    });
});
