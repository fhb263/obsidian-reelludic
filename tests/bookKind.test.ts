// 书籍子分类（文学 / 网文 / 漫画）纯逻辑单测：normalize 兜底 + 匹配 + 计数 + 量词
// 🔴 2026-09-30「漫画」**加回**（用户裁定）：comic 是**合法值**（1.0.3.1 曾下线，2026-09-13 裁定）——
//    本文件按「三值同构」锁：归一只认合法三值、计数四桶、量词三键、匹配各自成桶。
// 缺省归「book」（展示为「文学」；用户 2026-09-12 裁定改名，原「出版」）：未指定 bookKind 的存量书籍不丢失
import { describe, it, expect } from 'vitest';
import { BOOK_KINDS, BOOK_KIND_LABELS, BOOK_KIND_TOP_UNITS, normalizeBookKind, matchesBookKind, bookKindCounts } from 'pure/bookKind';

describe('normalizeBookKind 合法值归一（缺省 → 文学）', () => {
    it('合法三值原样返回（含 comic —— 2026-09-30 加回）', () => {
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
        // ⚠️ 只认**精确值**：comic 是合法的，但 'comics' / '漫画' 不是（别写成前缀/包含匹配）
        expect(normalizeBookKind('comics')).toBe('book');
        expect(normalizeBookKind('漫画')).toBe('book');
    });
    it('原型链键名不合法（用 Object.keys 校验，非 in）', () => {
        expect(normalizeBookKind('toString')).toBe('book');
        expect(normalizeBookKind('constructor')).toBe('book');
    });
});

describe('matchesBookKind 分类匹配', () => {
    const novel = { type: 'book' as const, bookKind: 'novel' as const };
    const comic = { type: 'book' as const, bookKind: 'comic' as const };
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
    it('comic 只命中漫画桶（⛔ 不再并进文学桶 —— 2026-09-30 加回后它有自己的桶与自己的源组）', () => {
        expect(matchesBookKind(comic, 'comic')).toBe(true);
        expect(matchesBookKind(comic, 'book')).toBe(false);
        expect(matchesBookKind(comic, 'novel')).toBe(false);
    });
    it('非 book 类型在显式 kind 下不命中（从严：bookKind 只应作用于阅读页签）', () => {
        expect(matchesBookKind(movie, 'book')).toBe(false);
        expect(matchesBookKind(movie, 'novel')).toBe(false);
        expect(matchesBookKind(movie, 'comic')).toBe(false);
    });
});

describe('bookKindCounts 四桶计数', () => {
    it('只统计 book 类型条目；缺省落文学桶，comic 单独成桶', () => {
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
    it('空数组全零（四桶键齐 —— 少了 comic 键会导致 chips 数字渲染成 undefined）', () => {
        expect(bookKindCounts([])).toEqual({ all: 0, book: 0, novel: 0, comic: 0 });
    });
});

describe('常量定义', () => {
    it('BOOK_KINDS 与 LABELS 一致（chips 顺序依据：全部/文学/网文/漫画 —— comic 追加在末尾）', () => {
        expect(BOOK_KINDS).toEqual(['book', 'novel', 'comic']);
        expect(BOOK_KIND_LABELS).toEqual({ book: '文学', novel: '网文', comic: '漫画' });
    });
    it('BOOK_KIND_TOP_UNITS 顶部量词（子分类 chip 选中时：5 本书 / 5 本网文 / 5 本漫画）', () => {
        expect(BOOK_KIND_TOP_UNITS).toEqual({ book: '本书', novel: '本网文', comic: '本漫画' });
    });
});
