// TXT 书籍解析（纯逻辑，可单测）：文本 → 章节拆分 + 章节内段落

import { countReadingUnits, makeWordSegmenter, type WordSegmenter } from 'pure/readingUnits';

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

/** 单章软上限（字）：超过则按段落边界自动切节。
 *
 * 为什么需要：中文 TXT 若编码识别失败（乱码）或本身没有「第X章」标记，`parseTxtBook` 会退化成
 * 「整书单章」—— 渲染层是一次性渲染整章的，于是一本 300 万字的书会生成几十万个 DOM 节点，
 * 主线程直接卡死（2026-09-17 用户实测）。切节后每章恒定可控，这一档风险被结构性消除。 */
export const SPLIT_CHARS_PER_CHAPTER = 30000;

/** 按字数把超大章切成多节（段落边界，不切断段落）；超出一节时标题加「 · N」后缀 */
function splitOversizeChapters(paragraphs: string[], raw: TxtChapter[]): TxtChapter[] {
    // 先算每章各节的起始段落索引
    const cutsPerChapter: number[][] = [];
    for (let i = 0; i < raw.length; i++) {
        const start = raw[i].startPara;
        const end = i + 1 < raw.length ? raw[i + 1].startPara : paragraphs.length;
        const cuts: number[] = [start];
        let acc = 0;
        for (let p = start; p < end; p++) {
            acc += paragraphs[p]?.length ?? 0;
            if (acc >= SPLIT_CHARS_PER_CHAPTER && p + 1 < end) {
                cuts.push(p + 1);
                acc = 0;
            }
        }
        cutsPerChapter.push(cuts);
    }
    // 再统一命名：切成多节才加后缀，保持普通书标题原样
    const out: TxtChapter[] = [];
    for (let i = 0; i < raw.length; i++) {
        const cuts = cutsPerChapter[i];
        const multi = cuts.length > 1;
        cuts.forEach((startPara, k) => {
            out.push({ title: multi ? `${raw[i].title} · ${k + 1}` : raw[i].title, startPara });
        });
    }
    return out;
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
    return { paragraphs, chapters: splitOversizeChapters(paragraphs, chapters) };
}

/** 取章节段落范围（闭区间），chapterIndex 越界返回空数组 */
export function chapterParagraphs(book: TxtBook, chapterIndex: number): string[] {
    if (chapterIndex < 0 || chapterIndex >= book.chapters.length) return [];
    const start = book.chapters[chapterIndex].startPara;
    const end = chapterIndex + 1 < book.chapters.length ? book.chapters[chapterIndex + 1].startPara : book.paragraphs.length;
    return book.paragraphs.slice(start, end);
}

/**
 * 每章字数（#338 目录显示 / #345 换中英口径）：第 i 章 = 段落 `[startPara[i], startPara[i+1])` 的
 * **阅读量单位**累计（中文按字 + 英文按词，见 `pure/readingUnits`），末章到段落结尾。
 * 越界下标按 0 处理；无章节 → 空数组。
 * ⚠️ 与阅读进度无关：TXT 的进度按段落比例算，不经过本函数。
 */
export function txtChapterUnits(
    paragraphs: string[],
    chapters: { startPara: number; title?: string }[],
    seg: WordSegmenter | null = makeWordSegmenter(),
): number[] {
    const out: number[] = [];
    for (let i = 0; i < chapters.length; i++) {
        const from = Math.max(0, chapters[i].startPara);
        const to = i + 1 < chapters.length ? chapters[i + 1].startPara : paragraphs.length;
        let n = 0;
        for (let p = from; p < Math.min(to, paragraphs.length); p++) n += countReadingUnits(paragraphs[p] ?? '', seg);
        out.push(n);
    }
    return out;
}
