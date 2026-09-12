// 书籍子分类（图书 / 小说）纯逻辑单测：normalize 兜底 + 匹配 + 计数
// 缺省归「图书」（用户 2026-09-12 裁定）：未指定 bookKind 的存量书籍不丢失
import { describe, it, expect } from 'vitest';
import { BOOK_KINDS, BOOK_KIND_LABELS, normalizeBookKind, matchesBookKind, bookKindCounts } from 'pure/bookKind';

describe('normalizeBookKind 合法值归一（缺省 → 图书）', () => {
    it('合法值原样返回', () => {
        expect(normalizeBookKind('book')).toBe('book');
        expect(normalizeBookKind('novel')).toBe('novel');
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
    const legacyBook = { type: 'book' as const, bookKind: undefined };
    const movie = { type: 'movie' as const, bookKind: undefined };

    it('all 恒命中', () => {
        expect(matchesBookKind(book, 'all')).toBe(true);
        expect(matchesBookKind(movie, 'all')).toBe(true);
    });
    it('book/novel 按 normalize 后匹配（缺省书落图书桶）', () => {
        expect(matchesBookKind(book, 'novel')).toBe(true);
        expect(matchesBookKind(book, 'book')).toBe(false);
        expect(matchesBookKind(legacyBook, 'book')).toBe(true);
        expect(matchesBookKind(legacyBook, 'novel')).toBe(false);
    });
    it('非 book 类型在显式 kind 下不命中（从严：bookKind 只应作用于书籍页签）', () => {
        expect(matchesBookKind(movie, 'book')).toBe(false);
        expect(matchesBookKind(movie, 'novel')).toBe(false);
    });
});

describe('bookKindCounts 三桶计数', () => {
    it('只统计 book 类型条目；缺省归图书桶', () => {
        const entries = [
            { type: 'book' as const, bookKind: undefined },
            { type: 'book' as const, bookKind: 'book' as const },
            { type: 'book' as const, bookKind: 'novel' as const },
            { type: 'movie' as const, bookKind: undefined },
        ];
        expect(bookKindCounts(entries)).toEqual({ all: 3, book: 2, novel: 1 });
    });
    it('空数组全零', () => {
        expect(bookKindCounts([])).toEqual({ all: 0, book: 0, novel: 0 });
    });
});

describe('常量定义', () => {
    it('BOOK_KINDS 与 LABELS 一致', () => {
        expect(BOOK_KINDS).toEqual(['book', 'novel']);
        expect(BOOK_KIND_LABELS).toEqual({ book: '图书', novel: '小说' });
    });
});
