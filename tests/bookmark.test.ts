// 阅读器书签纯模型测试（路径构建 / 解析 / 序列化 / 新建）
import { describe, it, expect } from 'vitest';
import {
    bookmarksFilePath,
    parseBookmarks,
    serializeBookmarks,
    newBookmark,
    type ReaderBookmark,
} from 'pure/bookmark';

describe('pure/bookmark bookmarksFilePath 书签文件路径', () => {
    it('无尾斜杠 libraryDir → {libraryDir}/阅读进度/{id}.bookmarks.json', () => {
        expect(bookmarksFilePath('entry-1', 'ReelLudic')).toBe('ReelLudic/阅读进度/entry-1.bookmarks.json');
    });

    it('尾斜杠被去除（不产生 //）', () => {
        expect(bookmarksFilePath('e2', 'MyLib/')).toBe('MyLib/阅读进度/e2.bookmarks.json');
        expect(bookmarksFilePath('e2', 'MyLib//')).toBe('MyLib/阅读进度/e2.bookmarks.json');
    });

    it('空串/纯斜杠回退 ReelLudic（对齐 main.ts libDir 约定）', () => {
        expect(bookmarksFilePath('e3', '')).toBe('ReelLudic/阅读进度/e3.bookmarks.json');
        expect(bookmarksFilePath('e3', '/')).toBe('ReelLudic/阅读进度/e3.bookmarks.json');
    });

    it('entryId 出现在文件名且扩展名为 .bookmarks.json', () => {
        const p = bookmarksFilePath('bm-entry-42', 'Lib');
        expect(p).toContain('阅读进度');
        expect(p).toMatch(/bm-entry-42\.bookmarks\.json$/);
        expect(p.split('/').pop()).toBe('bm-entry-42.bookmarks.json');
    });
});

describe('pure/bookmark parseBookmarks 容错解析', () => {
    it('undefined / 空串 → []', () => {
        expect(parseBookmarks(undefined)).toEqual([]);
        expect(parseBookmarks('')).toEqual([]);
        expect(parseBookmarks('   ')).toEqual([]);
    });

    it('坏 JSON / 非数组顶层 → []', () => {
        expect(parseBookmarks('{not json')).toEqual([]);
        expect(parseBookmarks('{"a":1}')).toEqual([]);
        expect(parseBookmarks('42')).toEqual([]);
        expect(parseBookmarks('null')).toEqual([]);
    });

    it('合法项保留，非法项（缺 chapter / chapter 0 / 非数值 pct / 非对象 / pct NaN）被过滤', () => {
        const raw = JSON.stringify([
            { chapter: 3, pct: 50.5 },
            { pct: 40 },                                     // 缺 chapter
            { chapter: 0, pct: 40 },                         // chapter 0
            { chapter: 2.5, pct: 40 },                       // chapter 非整数
            { chapter: 1, pct: '40' },                       // pct 非数值
            { chapter: 1, pct: null },                       // pct 非数值
            'not-an-object',                                 // 非对象
            { chapter: 1, pct: NaN },                        // pct 非有限数（JSON 实为 null，此处双保险）
            { chapter: 1, pct: Infinity },
            null,
            { chapter: 2, pct: 10 },
        ]);
        const r = parseBookmarks(raw);
        expect(r).toEqual([
            { chapter: 3, pct: 50.5 },
            { chapter: 2, pct: 10 },
        ]);
    });

    it('pct 超出 [0,100] 的项被整体过滤（150 / -5）', () => {
        const raw = JSON.stringify([
            { chapter: 1, pct: 150 },
            { chapter: 1, pct: -5 },
            { chapter: 1, pct: 0 },    // 边界合法
            { chapter: 1, pct: 100 },  // 边界合法
        ]);
        expect(parseBookmarks(raw)).toEqual([
            { chapter: 1, pct: 0 },
            { chapter: 1, pct: 100 },
        ]);
    });

    it('quote 字符串原样保留；空串 quote 省略；note 字符串保留', () => {
        const raw = JSON.stringify([
            { chapter: 1, pct: 1, quote: '  选中文字  ' },
            { chapter: 1, pct: 2, quote: '' },
            { chapter: 1, pct: 3, quote: 42 },
            { chapter: 1, pct: 4, note: '备注' },
            { chapter: 1, pct: 5, note: 7 },
        ]);
        const r = parseBookmarks(raw);
        expect(r).toEqual([
            { chapter: 1, pct: 1, quote: '  选中文字  ' }, // 解析不裁剪，保持 as-is
            { chapter: 1, pct: 2 },                        // 空串 quote 省略
            { chapter: 1, pct: 3 },                        // 非字符串 quote 忽略（条目本身仍合法）
            { chapter: 1, pct: 4, note: '备注' },          // note 仅字符串保留
            { chapter: 1, pct: 5 },                        // 非字符串 note 忽略
        ]);
    });

    it('id / createdAt 字符串/数值时透传，类型不符则忽略', () => {
        const raw = JSON.stringify([
            { chapter: 1, pct: 1, id: 'bm-abc', createdAt: 1234567890 },
            { chapter: 1, pct: 2, id: 42, createdAt: '2026-09-03' },
        ]);
        const r = parseBookmarks(raw);
        expect(r).toEqual([
            { id: 'bm-abc', chapter: 1, pct: 1, createdAt: 1234567890 },
            { chapter: 1, pct: 2 },
        ]);
    });
});

describe('pure/bookmark serializeBookmarks 序列化', () => {
    it('round-trip：serialize → parse 保序保字段（含可选字段）', () => {
        const list: ReaderBookmark[] = [
            { id: 'bm-a', chapter: 1, pct: 12.5, quote: '一段话', createdAt: 111 },
            { id: 'bm-b', chapter: 2, pct: 80, note: '预留批注', createdAt: 222 },
        ];
        expect(parseBookmarks(serializeBookmarks(list))).toEqual(list);
    });

    it('id/createdAt/quote 缺省字段 round-trip 后仍缺省', () => {
        const partial = [{ chapter: 2, pct: 80 }] as ReaderBookmark[];
        expect(parseBookmarks(serializeBookmarks(partial))).toEqual([{ chapter: 2, pct: 80 }]);
    });

    it('空列表 → "[]"', () => {
        expect(serializeBookmarks([])).toBe('[]');
    });
});

describe('pure/bookmark newBookmark 新建书签', () => {
    it('形状：id 以 bm- 开头、chapter/pct/createdAt 就位', () => {
        const b = newBookmark(3, 45.5);
        expect(b.chapter).toBe(3);
        expect(b.pct).toBe(45.5);
        expect(typeof b.createdAt).toBe('number');
        expect(b.id.startsWith('bm-')).toBe(true);
        expect(b.quote).toBeUndefined();
    });

    it('quote 空串/空白 → undefined；非空裁剪首尾空白', () => {
        expect(newBookmark(1, 0, '').quote).toBeUndefined();
        expect(newBookmark(1, 0, '   ').quote).toBeUndefined();
        expect(newBookmark(1, 0, '  高亮  ').quote).toBe('高亮');
    });

    it('pct 超界被夹到 [0,100]：150→100、-5→0', () => {
        expect(newBookmark(1, 150).pct).toBe(100);
        expect(newBookmark(1, -5).pct).toBe(0);
        expect(newBookmark(1, 42).pct).toBe(42); // 界内原样
    });
});
