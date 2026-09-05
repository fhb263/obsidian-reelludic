// TXT 书籍解析（纯逻辑，可单测）：文本 → 章节拆分 + 章节内段落

export interface TxtChapter {
    /** 章节标题（无标题章返回「第 N 章」占位） */
    title: string;
    /** 章节起始段落索引（text 段数组切片用） */
    startPara: number;
}

/** 章节标题正则：第X章/第X节/第X卷/第X回/第X话/第X部/楔子/序章/终章/番外 等（支持全角数字） */
const CHAPTER_RE = /^\s*(第[一二三四五六七八九十百千万零〇0-9０-９]+[章节卷回话部集篇]|楔子|序章|序言|前言|引子|终章|尾声|后记|番外(?:篇|章)?)\s*[：:．.、]?\s*.*$/;

/** 章节行判定：独立成行且匹配章节正则（不把正文里「第X章」句子误判） */
export function isChapterLine(line: string): boolean {
    const t = line.trim();
    return t.length >= 2 && t.length <= 40 && CHAPTER_RE.test(t);
}

/** 解析 TXT：按行拆段 → 找章节行 → 生成章节列表与段落数组（段落=非空行 trim） */
export interface TxtBook {
    /** 全部段落（trim 后，空行保留为分隔由渲染层处理——本结构只存非空段） */
    paragraphs: string[];
    chapters: TxtChapter[];
}

export function parseTxtBook(text: string): TxtBook {
    const paragraphs: string[] = [];
    const chapters: TxtChapter[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const t = raw.trim();
        if (!t) continue;
        if (isChapterLine(t)) {
            chapters.push({ title: t, startPara: paragraphs.length });
        }
        paragraphs.push(t);
    }
    // 无章节标题：整书单章
    if (chapters.length === 0) chapters.push({ title: '全文', startPara: 0 });
    return { paragraphs, chapters };
}

/** 取章节段落范围（闭区间），chapterIndex 越界返回空数组 */
export function chapterParagraphs(book: TxtBook, chapterIndex: number): string[] {
    if (chapterIndex < 0 || chapterIndex >= book.chapters.length) return [];
    const start = book.chapters[chapterIndex].startPara;
    const end = chapterIndex + 1 < book.chapters.length ? book.chapters[chapterIndex + 1].startPara : book.paragraphs.length;
    return book.paragraphs.slice(start, end);
}
