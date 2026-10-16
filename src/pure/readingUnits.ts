// #345 目录边栏的「阅读量单位」口径：**中文按字、英文按词**。
// 纯逻辑（计数函数）在此单测；DOM 接线在各阅读器 modal。
//
// 🔴 与阅读进度口径**互不相干**：`epubParse.chapterTextLength`（按字符长度加权）同时喂
//    `estimatePercent` 与 TOC 重建阈值，改它会让全书进度百分比漂移 ⇒ 本模块只服务展示层，
//    ⛔ 不要去动那个函数。

/** CJK 字符（按「字」计）：汉字 + 日文假名 + 谚文 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** 拉丁词回退正则（环境无 Intl.Segmenter 时用）：撇号属词内、连字符断开（对齐 Unicode UAX#29） */
const WORD_RE = /[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu;

/** 词粒度分段器的最小接口（只用到 isWordLike；便于测试注入替身、也避开 lib 无 ES2022 的类型缺口） */
export interface WordSegmenter {
    segment(input: string): Iterable<{ isWordLike?: boolean }>;
}

/** 取运行时的 Intl 命名空间（插件宿主是 window，单测环境是 Node 的 global） */
function intlNamespace(): { Segmenter?: new (locale: string, opts: { granularity: string }) => WordSegmenter } | undefined {
    const g: any = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : undefined;
    return g && g.Intl ? (g.Intl as any) : undefined;
}

/** 造词粒度分段器；环境不支持 → null（调用方自动走正则回退，不抛错、不刷屏） */
export function makeWordSegmenter(): WordSegmenter | null {
    const S = intlNamespace()?.Segmenter;
    if (typeof S !== 'function') return null;
    try {
        return new S('en', { granularity: 'word' });
    } catch {
        return null;
    }
}

/** CJK 字符数（每个汉字 / 假名 / 谚文记 1「字」；中文标点与空白不计） */
export function countCjkChars(text: string): number {
    if (!text) return 0;
    const m = text.match(CJK_RE);
    return m ? m.length : 0;
}

/**
 * 拉丁「词」数。
 * 🔴 必须先把 CJK 剥成空格再分词：`Intl.Segmenter` 对中文是**字典切词**（「图书馆」可能只算 1 个 word），
 *    与「中文按字」的口径相冲 —— 不剥会把中文按词少算；剥掉后还顺带解决「中文word」粘连成一 token 的问题。
 */
export function countLatinWords(text: string, seg: WordSegmenter | null = makeWordSegmenter()): number {
    if (!text) return 0;
    const latin = text.replace(CJK_RE, ' ');
    if (seg) {
        let n = 0;
        // 逐段累加，⛔ 不 spread 成数组：每个 segment 都持有 input 引用，长文档会吃几百 MB
        for (const s of seg.segment(latin)) if (s.isWordLike) n += 1;
        return n;
    }
    const m = latin.match(WORD_RE);
    return m ? m.length : 0;
}

/** 阅读量单位 = CJK 字数 + 拉丁词数（中英混排相加） */
export function countReadingUnits(text: string, seg: WordSegmenter | null = makeWordSegmenter()): number {
    if (!text) return 0;
    return countCjkChars(text) + countLatinWords(text, seg);
}

/** 逐段 / 逐章累计（复用同一个 segmenter，避免每段重建） */
export function chaptersReadingUnits(texts: string[], seg: WordSegmenter | null = makeWordSegmenter()): number[] {
    return texts.map((t) => countReadingUnits(t, seg));
}

/** 产出一个可复用的计数器（EPUB 目录逐条计数时只建一次 segmenter） */
export function createReadingUnitCounter(): (text: string) => number {
    const seg = makeWordSegmenter();
    return (text: string) => countReadingUnits(text, seg);
}
