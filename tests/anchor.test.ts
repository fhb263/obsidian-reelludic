// 阅读器定位锚纯逻辑测试（pure/anchor）：
// 目标 = 用 quote 文本锚回原文位置，命中位置不再依赖 pct（换字号/窗宽会让 pct 漂）。
import { describe, it, expect } from 'vitest';
import { compactText, locateQuoteSpan } from 'pure/anchor';

describe('pure/anchor compactText', () => {
    it('去空白并保留每个保留字符的原文偏移', () => {
        const r = compactText('a b\n\tc');
        expect(r.text).toBe('abc');
        expect(r.map).toEqual([0, 2, 5]);
    });

    it('全角空格与不换行空格同样视作空白', () => {
        expect(compactText('甲\u3000乙\u00a0丙').text).toBe('甲乙丙');
    });

    it('空串 / 全空白 → 空文本与空映射', () => {
        expect(compactText('').text).toBe('');
        expect(compactText('').map).toEqual([]);
        expect(compactText('  \n\t ').text).toBe('');
    });

    it('脏数据（非字符串）容错为空', () => {
        expect(compactText(undefined as unknown as string).text).toBe('');
        expect(compactText(undefined as unknown as string).map).toEqual([]);
    });
});

describe('pure/anchor locateQuoteSpan', () => {
    const chunks = ['第一段：风起了。', '第二段：风停了。'];

    it('单块命中：返回块序号与块内原文区间', () => {
        const hit = locateQuoteSpan(chunks, '风起了');
        expect(hit?.ranges).toEqual([{ index: 0, start: 4, end: 7 }]);
    });

    it('第二块命中', () => {
        const hit = locateQuoteSpan(chunks, '风停了');
        expect(hit?.ranges).toEqual([{ index: 1, start: 4, end: 7 }]);
    });

    it('quote 与原文空白差异不影响命中（区间含内部空白）', () => {
        const hit = locateQuoteSpan(['风　起了'], '风 起 了');
        expect(hit?.ranges).toEqual([{ index: 0, start: 0, end: 4 }]);
    });

    it('跨块命中：每块各出一个区间（这正是旧「前 24 字包含」做不到的）', () => {
        const hit = locateQuoteSpan(['前半段没有', '句号也没有'], '没有句号');
        expect(hit?.ranges).toEqual([
            { index: 0, start: 3, end: 5 },
            { index: 1, start: 0, end: 2 },
        ]);
    });

    it('命中末尾字符时区间闭合在串尾（end 独占）', () => {
        expect(locateQuoteSpan(['ab'], 'b')?.ranges).toEqual([{ index: 0, start: 1, end: 2 }]);
    });

    it('同文本多处命中：给提示比例时选最接近的那一处', () => {
        const rep = ['重复句子', '中间', '重复句子'];
        expect(locateQuoteSpan(rep, '重复句子', 0.1)?.ranges).toEqual([{ index: 0, start: 0, end: 4 }]);
        expect(locateQuoteSpan(rep, '重复句子', 0.9)?.ranges).toEqual([{ index: 2, start: 0, end: 4 }]);
    });

    it('同文本多处命中：不给提示时取首个', () => {
        const rep = ['重复句子', '中间', '重复句子'];
        expect(locateQuoteSpan(rep, '重复句子')?.ranges).toEqual([{ index: 0, start: 0, end: 4 }]);
    });

    it('提示比例越界（<0 / >1 / 非有限数）不炸，退化为取首个', () => {
        const rep = ['重复句子', '中间', '重复句子'];
        expect(locateQuoteSpan(rep, '重复句子', -5)?.ranges).toEqual([{ index: 0, start: 0, end: 4 }]);
        expect(locateQuoteSpan(rep, '重复句子', 5)?.ranges).toEqual([{ index: 2, start: 0, end: 4 }]);
        expect(locateQuoteSpan(rep, '重复句子', Number.NaN)?.ranges).toEqual([{ index: 0, start: 0, end: 4 }]);
    });

    it('命中不到 / 空 quote / 空文本块 → null', () => {
        expect(locateQuoteSpan(chunks, '不存在的句子')).toBeNull();
        expect(locateQuoteSpan(chunks, '   ')).toBeNull();
        expect(locateQuoteSpan([], '风起了')).toBeNull();
        expect(locateQuoteSpan([''], '风起了')).toBeNull();
        expect(locateQuoteSpan(chunks, '文本比正文还长的一整句话')).toBeNull();
    });

    it('脏数据（chunks 非数组）容错为 null', () => {
        expect(locateQuoteSpan(undefined as unknown as string[], '风起了')).toBeNull();
    });
});
