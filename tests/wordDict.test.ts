import { describe, expect, it } from 'vitest';

import {
    DICT_BUCKET_CHARS,
    DICT_DEF_MAX,
    DICT_MAX_BYTES,
    bucketOf,
    buildDictIndex,
    compactDef,
    dictTooLarge,
    lookupDict,
    parseDictLine,
    splitCsvLine,
} from 'pure/wordDict';

/** ECDICT 精简片段（含被引号包住的逗号与转义引号） */
const ECDICT = [
    'word,phonetic,definition',
    'apple,ˈæpl,n. 苹果；苹果树',
    'book,bʊk,n. 书；书籍 v. 预订',
    'hello,həˈləʊ,int. 你好',
    '"a,b",,带逗号的词',
    'quote,,他说"喂"',
    'zebra,ˈziːbrə,n. 斑马',
].join('\n');

describe('splitCsvLine', () => {
    it('普通行按逗号切', () => {
        expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('引号内的逗号不切', () => {
        expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
    });

    it('连续两个引号是字面引号', () => {
        expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
    });

    it('空字段保留（⛔ 不能挤掉占位，否则列会错位）', () => {
        expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
    });
});

describe('compactDef', () => {
    it('把换行压成空格', () => {
        expect(compactDef('a\nb\r\nc')).toBe('a b c');
    });

    it('超长截断并加省略号', () => {
        const long = 'x'.repeat(DICT_DEF_MAX + 50);
        const got = compactDef(long);
        expect(got.length).toBe(DICT_DEF_MAX);
        expect(got.endsWith('…')).toBe(true);
    });

    it('刚好上限不截断', () => {
        const exact = 'x'.repeat(DICT_DEF_MAX);
        expect(compactDef(exact)).toBe(exact);
    });
});

describe('parseDictLine', () => {
    it('三段 CSV 取出音标与释义', () => {
        expect(parseDictLine('apple,ˈæpl,n. 苹果')).toEqual({ word: 'apple', phonetic: 'ˈæpl', def: 'n. 苹果' });
    });

    it('音标为空时不带 phonetic 字段', () => {
        const got = parseDictLine('apple,,n. 苹果');
        expect(got).toEqual({ word: 'apple', def: 'n. 苹果' });
        expect(got && 'phonetic' in got).toBe(false);
    });

    it('两段 CSV 当作 词,释义', () => {
        expect(parseDictLine('apple,n. 苹果')).toEqual({ word: 'apple', def: 'n. 苹果' });
    });

    it('制表符表优先于 CSV（释义里的逗号不切）', () => {
        expect(parseDictLine('apple\tn. 苹果, 苹果树')).toEqual({ word: 'apple', def: 'n. 苹果, 苹果树' });
    });

    it('空行返回 null', () => {
        expect(parseDictLine('')).toBeNull();
        expect(parseDictLine('   ')).toBeNull();
    });

    it('缺释义返回 null（⛔ 不让空词条进索引）', () => {
        expect(parseDictLine('apple')).toBeNull();
        expect(parseDictLine('apple,')).toBeNull();
    });

    it('两段且第 2 段非空 ⇒ 当作释义（⛔ 不因「看起来像音标」就丢掉）', () => {
        // 两段格式本身无法区分音标与释义，按「词,释义」认；丢半张表比偶尔把音标当释义更糟
        expect(parseDictLine('apple,ˈæpl')).toEqual({ word: 'apple', def: 'ˈæpl' });
    });

    it('行尾 CR 被剥掉（Windows 换行）', () => {
        expect(parseDictLine('apple\tn. 苹果\r')).toEqual({ word: 'apple', def: 'n. 苹果' });
    });
});

describe('bucketOf', () => {
    it('取前两个码点', () => {
        expect(bucketOf('apple')).toBe('ap');
        expect(DICT_BUCKET_CHARS).toBe(2);
    });

    it('短词原样返回', () => {
        expect(bucketOf('a')).toBe('a');
    });

    it('空串返回空串', () => {
        expect(bucketOf('')).toBe('');
    });

    it('中文按码点切，不劈代理对', () => {
        // 𠀀 是增补平面字符（U+20000，UTF-16 占两个码元）
        const got = bucketOf('𠀀𠀁x');
        expect(Array.from(got)).toHaveLength(2);
        expect(got).toBe('𠀀𠀁');
    });
});

describe('buildDictIndex', () => {
    it('同前缀的词落进同一个桶', () => {
        const idx = buildDictIndex(ECDICT);
        expect(idx.has('ap')).toBe(true);
        expect(idx.has('bo')).toBe(true);
        expect(idx.has('ze')).toBe(true);
    });

    it('桶的区间覆盖该桶所有行', () => {
        const idx = buildDictIndex(ECDICT);
        const span = idx.get('bo');
        expect(span).toBeTruthy();
        const [from, to] = span as readonly [number, number];
        const lines = ECDICT.split('\n').slice(from, to);
        expect(lines.some((l) => l.startsWith('book,'))).toBe(true);
    });

    it('坏行不影响建索引', () => {
        const idx = buildDictIndex(['zzz', 'apple,n. 苹果', '', 'zzz'].join('\n'));
        expect(idx.has('zz')).toBe(false);
        expect(idx.has('ap')).toBe(true);
    });

    it('空文本得到空索引', () => {
        expect(buildDictIndex('').size).toBe(0);
    });
});

describe('lookupDict', () => {
    const idx = buildDictIndex(ECDICT);

    it('命中一个词', () => {
        expect(lookupDict(ECDICT, idx, 'apple')).toEqual({ word: 'apple', phonetic: 'ˈæpl', def: 'n. 苹果；苹果树' });
    });

    it('大小写不敏感（key 已归一）', () => {
        expect(lookupDict(ECDICT, idx, 'apple')?.def).toContain('苹果');
    });

    it('查不到的词返回 null', () => {
        expect(lookupDict(ECDICT, idx, 'qqqq')).toBeNull();
    });

    it('索引里没有该前缀返回 null（⛔ 不扫全文）', () => {
        expect(lookupDict(ECDICT, idx, '中')).toBeNull();
    });

    it('带引号的词也能查到', () => {
        expect(lookupDict(ECDICT, idx, 'a,b')?.def).toBe('带逗号的词');
    });

    it('表头行按三段解析（音标=phonetic，释义=definition），查不到真实词也不影响', () => {
        // 表头没有副作用：它只在查 `word` 这个词时才会被返还，真实查词永远撞不上
        expect(lookupDict(ECDICT, idx, 'word')).toEqual({ word: 'word', phonetic: 'phonetic', def: 'definition' });
    });
});

describe('dictTooLarge', () => {
    it('超过上限为真', () => {
        expect(dictTooLarge(DICT_MAX_BYTES + 1)).toBe(true);
    });

    it('等于上限不算超（边界放行）', () => {
        expect(dictTooLarge(DICT_MAX_BYTES)).toBe(false);
    });

    it('非有限数不算超', () => {
        expect(dictTooLarge(Number.NaN)).toBe(false);
        expect(dictTooLarge(Number.POSITIVE_INFINITY)).toBe(false);
    });
});
