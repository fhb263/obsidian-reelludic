import { describe, it, expect } from 'vitest';
import {
    countCjkChars,
    countLatinWords,
    countReadingUnits,
    chaptersReadingUnits,
    createReadingUnitCounter,
    makeWordSegmenter,
} from 'pure/readingUnits';

/**
 * #345：目录边栏字数统计口径 —— 中文按「字」、英文按「单词」。
 * 总口径 = CJK 字符数 + 拉丁词数（混排相加）。
 */
describe('countReadingUnits（中文按字 / 英文按词）', () => {
    it('纯中文 → 逐字计数（空格与中文标点不计）', () => {
        expect(countReadingUnits('你好世界')).toBe(4);
        expect(countReadingUnits('第一章 开端')).toBe(5);
        expect(countReadingUnits('你好，世界。')).toBe(4);
        expect(countReadingUnits('「引号」也算标点')).toBe(6);
    });

    it('纯英文 → 逐词计数（标点不计、撇号属词内、连字符断开）', () => {
        expect(countReadingUnits('Hello world')).toBe(2);
        expect(countReadingUnits('The quick brown fox')).toBe(4);
        expect(countReadingUnits('Hello, world!')).toBe(2);
        expect(countReadingUnits("Don't stop")).toBe(2);
        expect(countReadingUnits('over-think it')).toBe(3);
        expect(countReadingUnits('Chapter 12')).toBe(2);
    });

    it('中英混排 → 「字」与「词」相加', () => {
        expect(countReadingUnits('第 1 章 hello 世界')).toBe(6);
        expect(countReadingUnits('他说 hello world 了')).toBe(5);
        expect(countReadingUnits('中文word混排')).toBe(5);
    });

    it('🔴 中文必须按「字」而不是 Segmenter 的字典切词', () => {
        // 「图书馆」若交给 Intl.Segmenter 的 word 粒度，可能被切成 1 个词（字典驱动）→ 少算。
        expect(countReadingUnits('图书馆')).toBe(3);
        expect(countCjkChars('图书馆')).toBe(3);
    });

    it('日文假名 / 韩文谚文同按「字」计', () => {
        expect(countReadingUnits('こんにちは')).toBe(5);
        expect(countReadingUnits('안녕하세요')).toBe(5);
    });

    it('边界：空串 / 纯空白 / 纯标点 / emoji 一律 0', () => {
        expect(countReadingUnits('')).toBe(0);
        expect(countReadingUnits('   ')).toBe(0);
        expect(countReadingUnits('\u3000')).toBe(0);
        expect(countReadingUnits('--- ... !!')).toBe(0);
        expect(countReadingUnits('🙂🙂')).toBe(0);
    });
});

describe('countLatinWords（CJK 必须先剥掉再分词）', () => {
    it('剥掉汉字/假名后再数词，否则同一段会被重复计入', () => {
        expect(countLatinWords('第 1 章 hello 世界')).toBe(2);
        expect(countLatinWords('中文word混排')).toBe(1);
        expect(countLatinWords('こんにちは hello')).toBe(1);
    });

    it('纯中文 → 0 词（全部由 countCjkChars 承担）', () => {
        expect(countLatinWords('你好世界')).toBe(0);
    });
});

describe('回退分支（环境无 Intl.Segmenter 时走正则）', () => {
    it('Node 环境应具备 Intl.Segmenter（缺了会让下面的对比测试变成假绿）', () => {
        expect(makeWordSegmenter(), '缺少 Intl.Segmenter：无法验证两条分支一致').not.toBeNull();
    });

    it('🔴 两条分支对同一样本结果必须一致（否则不同环境显示的字数会漂）', () => {
        const samples = [
            'Hello world',
            "Don't stop",
            'over-think it',
            'Chapter 12',
            '第 1 章 hello 世界',
            'a-b c',
            'The quick brown fox jumps over the lazy dog',
        ];
        const seg = makeWordSegmenter();
        for (const s of samples) {
            expect(countReadingUnits(s, null), `样本：${s}`).toBe(countReadingUnits(s, seg));
        }
    });
});

describe('chaptersReadingUnits / createReadingUnitCounter', () => {
    it('按序返回每段单位数', () => {
        expect(chaptersReadingUnits(['你好', 'hello world', ''])).toEqual([2, 2, 0]);
    });

    it('大文档只累加计数（不把 segmenter 迭代器 spread 成数组）', () => {
        const big = Array.from({ length: 5000 }, () => 'word').join(' ');
        expect(countReadingUnits(big)).toBe(5000);
    });

    it('createReadingUnitCounter 复用同一个 segmenter，可重复调用', () => {
        const count = createReadingUnitCounter();
        expect(count('你好')).toBe(2);
        expect(count('hello world')).toBe(2);
        expect(count('')).toBe(0);
    });
});
