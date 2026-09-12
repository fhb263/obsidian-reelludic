// 书籍子分类（文学 / 网文 / 漫画）纯逻辑单测：normalize 兜底 + 匹配 + 计数 + 量词
// 缺省归「book」（展示为「文学」；用户 2026-09-12 裁定改名，原「出版」）：未指定 bookKind 的存量书籍不丢失
import { describe, it, expect } from 'vitest';
import { BOOK_KINDS, BOOK_KIND_LABELS, BOOK_KIND_TOP_UNITS, normalizeBookKind, matchesBookKind, bookKindCounts } from 'pure/bookKind';

describe('normalizeBookKind 合法值归一（缺省 → 文学）', () => {
    it('合法值原样返回', () => {
        expect(normalizeBookKind('book')).toBe('book');
        expect(normalizeBookKind('novel')).toBe('novel');
        expect(normalizeBookKind('comic')).toBe('comic');
    });
    it('缺省/空值/损坏值一律归「book」（存量书不丢失）', () => {
        expect(normalizeBookKind(undefined)).toBe('book');
        expect(normalizeBookKind(null)).toBe('book');
        expect(normalizeBookKind('')).toBe('book');
        expect(normalizeBookKind('novel ')).toBe('book');
        expect(normalizeBookKind(123)).toBe('book');
    });
    it('原型链键名不合法（用 Object.keys 校验，非 in）', () => {
        expect(normalizeBookKind('toString')).toBe('book');
        expect(normalizeBookKind('constructor')).toBe('book');
    });
});

describe('matchesBookKind 分类匹配', () => {
    const book = { type: 'book' as const, bookKind: 'novel' as const };
    const comic = { type: 'book' as const, bookKind: 'comic' as const };
    const legacyBook = { type: 'book' as const, bookKind: undefined };
    const movie = { type: 'movie' as const, bookKind: undefined };

    it('all 恒命中', () => {
        expect(matchesBookKind(book, 'all')).toBe(true);
        expect(matchesBookKind(movie, 'all')).toBe(true);
    });
    it('book/novel/comic 按 normalize 后匹配（缺省书落文学桶）', () => {
        expect(matchesBookKind(book, 'novel')).toBe(true);
        expect(matchesBookKind(book, 'book')).toBe(false);
        expect(matchesBookKind(comic, 'comic')).toBe(true);
        expect(matchesBookKind(comic, 'novel')).toBe(false);
        expect(matchesBookKind(legacyBook, 'book')).toBe(true); // 缺省书落文学桶
        expect(matchesBookKind(legacyBook, 'novel')).toBe(false);
        expect(matchesBookKind(legacyBook, 'comic')).toBe(false);
    });
    it('非 book 类型在显式 kind 下不命中（从严：bookKind 只应作用于阅读页签）', () => {
        expect(matchesBookKind(movie, 'book')).toBe(false);
        expect(matchesBookKind(movie, 'novel')).toBe(false);
        expect(matchesBookKind(movie, 'comic')).toBe(false);
    });
});

describe('bookKindCounts 四桶计数', () => {
    it('只统计 book 类型条目；缺省归文学桶，comic 独立成桶', () => {
        const entries = [
            { type: 'book' as const, bookKind: undefined },
            { type: 'book' as const, bookKind: 'book' as const },
            { type: 'book' as const, bookKind: 'novel' as const },
            { type: 'book' as const, bookKind: 'comic' as const },
            { type: 'book' as const, bookKind: 'comic' as const },
            { type: 'movie' as const, bookKind: undefined },
        ];
        expect(bookKindCounts(entries)).toEqual({ all: 5, book: 2, novel: 1, comic: 2 });
    });
    it('空数组全零', () => {
        expect(bookKindCounts([])).toEqual({ all: 0, book: 0, novel: 0, comic: 0 });
    });
});

describe('常量定义', () => {
    it('BOOK_KINDS 与 LABELS 一致（chips 顺序依据）', () => {
        expect(BOOK_KINDS).toEqual(['book', 'novel', 'comic']);
        expect(BOOK_KIND_LABELS).toEqual({ book: '文学', novel: '网文', comic: '漫画' });
    });
    it('BOOK_KIND_TOP_UNITS 顶部量词（子分类 chip 选中时：5 本书 / 5 本网文 / 5 本漫画）', () => {
        expect(BOOK_KIND_TOP_UNITS).toEqual({ book: '本书', novel: '本网文', comic: '本漫画' });
    });
});
