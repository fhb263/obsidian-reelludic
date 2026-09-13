// 书籍子分类（文学 / 网文）纯逻辑单测：normalize 兜底 + 匹配 + 计数 + 量词
// 1.0.3.1 起「漫画」子视图下线（用户 2026-09-13 裁定）：BookKind 收为 book/novel，存量 comic 归「文学」——本文件锁这条归一
// 缺省归「book」（展示为「文学」；用户 2026-09-12 裁定改名，原「出版」）：未指定 bookKind 的存量书籍不丢失
import { describe, it, expect } from 'vitest';
import { BOOK_KINDS, BOOK_KIND_LABELS, BOOK_KIND_TOP_UNITS, normalizeBookKind, matchesBookKind, bookKindCounts } from 'pure/bookKind';

describe('normalizeBookKind 合法值归一（缺省 → 文学）', () => {
    it('合法值原样返回', () => {
        expect(normalizeBookKind('book')).toBe('book');
        expect(normalizeBookKind('novel')).toBe('novel');
    });
    it('已下线的 comic 归「book」（漫画子视图删除后存量数据并入文学，条目不丢）', () => {
        expect(normalizeBookKind('comic')).toBe('book');
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
    const novel = { type: 'book' as const, bookKind: 'novel' as const };
    const legacyComic = { type: 'book' as const, bookKind: 'comic' as never }; // 存量漫画值（已下线）
    const legacyBook = { type: 'book' as const, bookKind: undefined };
    const movie = { type: 'movie' as const, bookKind: undefined };

    it('all 恒命中', () => {
        expect(matchesBookKind(novel, 'all')).toBe(true);
        expect(matchesBookKind(movie, 'all')).toBe(true);
    });
    it('book/novel 按 normalize 后匹配（缺省书落文学桶）', () => {
        expect(matchesBookKind(novel, 'novel')).toBe(true);
        expect(matchesBookKind(novel, 'book')).toBe(false);
        expect(matchesBookKind(legacyBook, 'book')).toBe(true); // 缺省书落文学桶
        expect(matchesBookKind(legacyBook, 'novel')).toBe(false);
    });
    it('存量 comic 值归文学桶（删除漫画子视图后的读取路径）', () => {
        expect(matchesBookKind(legacyComic, 'book')).toBe(true);
        expect(matchesBookKind(legacyComic, 'novel')).toBe(false);
    });
    it('非 book 类型在显式 kind 下不命中（从严：bookKind 只应作用于阅读页签）', () => {
        expect(matchesBookKind(movie, 'book')).toBe(false);
        expect(matchesBookKind(movie, 'novel')).toBe(false);
    });
});

describe('bookKindCounts 三桶计数', () => {
    it('只统计 book 类型条目；缺省与存量 comic 归文学桶', () => {
        const entries = [
            { type: 'book' as const, bookKind: undefined },
            { type: 'book' as const, bookKind: 'book' as const },
            { type: 'book' as const, bookKind: 'novel' as const },
            { type: 'book' as const, bookKind: 'comic' as never },
            { type: 'book' as const, bookKind: 'comic' as never },
            { type: 'movie' as const, bookKind: undefined },
        ];
        expect(bookKindCounts(entries)).toEqual({ all: 5, book: 4, novel: 1 });
    });
    it('空数组全零', () => {
        expect(bookKindCounts([])).toEqual({ all: 0, book: 0, novel: 0 });
    });
});

describe('常量定义', () => {
    it('BOOK_KINDS 与 LABELS 一致（chips 顺序依据；漫画已下线）', () => {
        expect(BOOK_KINDS).toEqual(['book', 'novel']);
        expect(BOOK_KIND_LABELS).toEqual({ book: '文学', novel: '网文' });
    });
    it('BOOK_KIND_TOP_UNITS 顶部量词（子分类 chip 选中时：5 本书 / 5 本网文）', () => {
        expect(BOOK_KIND_TOP_UNITS).toEqual({ book: '本书', novel: '本网文' });
    });
});
