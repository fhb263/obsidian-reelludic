// pure/readerStore 单测：三合一阅读数据（进度 + 书签 + 高亮）的 schema、容错归一、路径与分段更新。
import { describe, it, expect } from 'vitest';
import {
    READER_STORE_VERSION,
    emptyStore,
    normalizeStore,
    serializeStore,
    readerStoreFileName,
    readerStoreFilePath,
    readerStoreDir,
    withProgress,
    withBookmarks,
    withHighlights,
    mergeLegacyStore,
} from 'pure/readerStore';

describe('emptyStore 空档', () => {
    it('version 与三段默认齐备', () => {
        const s = emptyStore();
        expect(s.version).toBe(READER_STORE_VERSION);
        expect(s.progress).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
        expect(s.bookmarks).toEqual([]);
        expect(s.highlights).toEqual([]);
        expect(typeof s.updatedAt).toBe('string');
    });
});

describe('normalizeStore 容错归一', () => {
    it('非对象 / null / 字符串 → 空档（不是抛错）', () => {
        // 不整对象比对 emptyStore()：两次取时钟可能跨毫秒（时间戳会不同）→ 假红。
        // 逐字段断言形状，既确定又更明确「回退到的是什么」。
        for (const bad of [null, undefined, 'oops', 42, []]) {
            const s = normalizeStore(bad);
            expect(s.version).toBe(READER_STORE_VERSION);
            expect(s.progress.chapterIndex).toBe(-1);
            expect(s.progress.scrollRatio).toBe(0);
            expect(typeof s.progress.updatedAt).toBe('string');
            expect(s.bookmarks).toEqual([]);
            expect(s.highlights).toEqual([]);
            expect(typeof s.updatedAt).toBe('string');
        }
    });

    it('缺段各自回退默认（坏一段不连累另两段）', () => {
        const s = normalizeStore({ progress: { chapterIndex: 3, scrollRatio: 0.5 } });
        expect(s.progress.chapterIndex).toBe(3);
        expect(s.progress.scrollRatio).toBe(0.5);
        expect(s.bookmarks).toEqual([]);
        expect(s.highlights).toEqual([]);
    });

    it('version 非合法值 → 回退当前版本；合法值透传', () => {
        expect(normalizeStore({ version: 'x' }).version).toBe(READER_STORE_VERSION);
        expect(normalizeStore({ version: 7 }).version).toBe(7);
    });

    it('书签逐项校验：chapter/pct 非法项跳过，合法项保留', () => {
        const s = normalizeStore({
            bookmarks: [
                { id: 'bm-1', chapter: 2, pct: 30, quote: '甲', createdAt: 5 },
                { chapter: 0, pct: 30 },          // chapter < 1 → 跳过
                { chapter: 2, pct: 200 },          // pct 超界 → 跳过
                { chapter: 2.5, pct: 10 },         // 非整数 → 跳过
                { chapter: 4, pct: 0 },            // 合法（纯位置书签）
            ],
        });
        expect(s.bookmarks).toEqual([
            { id: 'bm-1', chapter: 2, pct: 30, quote: '甲', createdAt: 5 },
            { chapter: 4, pct: 0 },
        ]);
    });

    it('高亮逐项校验：quote 空 / loc 非法项跳过；样式颜色归一', () => {
        const s = normalizeStore({
            highlights: [
                { id: 'hl-1', quote: '甲', loc: { chapter: 1, pct: 10 }, style: 'wavy', color: 'green' },
                { quote: '' },                                  // 空引用 → 跳过
                { quote: '乙' },                                 // 无 loc → 保留（跨章跳转才需要 loc）
                { quote: '丙', loc: { chapter: 0, pct: 10 } },    // chapter < 1 → 丢 loc，保留 quote
                { quote: '丁', style: 'bogus', color: 'bogus' }, // 非法档位 → 回退默认
            ],
        });
        expect(s.highlights[0]).toEqual({ id: 'hl-1', quote: '甲', loc: { chapter: 1, pct: 10 }, style: 'wavy', color: 'green' });
        expect(s.highlights.length).toBe(4);
        expect(s.highlights[1]).toEqual({ quote: '乙' });
        expect(s.highlights[2]).toEqual({ quote: '丙' });
        expect(s.highlights[3]).toEqual({ quote: '丁', style: 'hl', color: 'yellow' });
    });

    it('高亮不是数组 → []（不把单对象当一条）', () => {
        expect(normalizeStore({ highlights: { quote: '甲' } }).highlights).toEqual([]);
    });

    it('未知字段不保留（白名单式，防脏数据悄悄进内存）', () => {
        const s = normalizeStore({ progress: { chapterIndex: 1, scrollRatio: 0, junk: 1 }, junk: 2, version: 1 });
        expect('junk' in s).toBe(false);
        expect('junk' in s.progress).toBe(false);
    });
});

describe('serializeStore 往返', () => {
    it('序列化后能被归一还原（三段与 version 不丢）', () => {
        const s = emptyStore();
        s.progress = { chapterIndex: 3, scrollRatio: 0.42, updatedAt: '2026-09-18T00:00:00.000Z' };
        s.bookmarks = [{ id: 'bm-1', chapter: 3, pct: 42, createdAt: 1 }];
        s.highlights = [{ id: 'hl-1', quote: '甲', loc: { chapter: 3, pct: 42 }, style: 'hl', color: 'yellow' }];
        expect(normalizeStore(JSON.parse(serializeStore(s)))).toEqual(s);
    });

    it('坏 JSON 文本由调用方兜底（本模块只管序列化）', () => {
        expect(serializeStore(emptyStore()).startsWith('{')).toBe(true);
    });
});

describe('readerStore 文件名与路径', () => {
    it('可读名 + 尾段保留条目 id', () => {
        expect(readerStoreFileName('e_1788181824054_a2ry', '三体')).toBe('三体-阅读-e_1788181824054_a2ry.json');
    });
    it('文件名非法字符被清理（与进度/书签同一套 sanitize）', () => {
        expect(readerStoreFileName('e1', '沙丘/第一部: 下')).toBe('沙丘 第一部 下-阅读-e1.json');
        expect(readerStoreFileName('e1', '   ')).toBe('未命名-阅读-e1.json');
    });
    it('路径拼接：libraryDir 去尾斜杠，空/纯斜杠回退 ReelLudic', () => {
        expect(readerStoreFilePath('e1', '书', 'ReelLudic')).toBe('ReelLudic/阅读进度/书-阅读-e1.json');
        expect(readerStoreFilePath('e1', '书', 'MyLib//')).toBe('MyLib/阅读进度/书-阅读-e1.json');
        expect(readerStoreFilePath('e1', '书', '')).toBe('ReelLudic/阅读进度/书-阅读-e1.json');
        expect(readerStoreFilePath('e1', '书', '/')).toBe('ReelLudic/阅读进度/书-阅读-e1.json');
    });
    it('目录函数与路径前缀同源（建目录与拼路径不会漂移）', () => {
        expect(readerStoreDir('ReelLudic')).toBe('ReelLudic/阅读进度');
        expect(readerStoreDir('MyLib//')).toBe('MyLib/阅读进度');
        expect(readerStoreDir('')).toBe('ReelLudic/阅读进度');
        expect(readerStoreFilePath('e1', '书', 'MyLib')).toBe(`${readerStoreDir('MyLib')}/书-阅读-e1.json`);
    });
});

describe('分段更新（只动一段，另两段原样）', () => {
    const base = (): ReturnType<typeof emptyStore> => {
        const s = emptyStore();
        s.progress = { chapterIndex: 2, scrollRatio: 0.1, updatedAt: '2026-09-18T00:00:00.000Z' };
        s.bookmarks = [{ id: 'bm-1', chapter: 2, pct: 10, createdAt: 1 }];
        s.highlights = [{ id: 'hl-1', quote: '甲', loc: { chapter: 2, pct: 10 } }];
        return s;
    };

    it('withProgress 只换进度，书签/高亮不动', () => {
        const next = withProgress(base(), { chapterIndex: 5, scrollRatio: 0.9 });
        expect(next.progress.chapterIndex).toBe(5);
        expect(next.progress.scrollRatio).toBe(0.9);
        expect(next.bookmarks).toEqual(base().bookmarks);
        expect(next.highlights).toEqual(base().highlights);
        expect(next.version).toBe(READER_STORE_VERSION);
    });

    it('withBookmarks / withHighlights 同理（不互相污染）', () => {
        const bm = withBookmarks(base(), [{ chapter: 9, pct: 90 }]);
        expect(bm.bookmarks).toEqual([{ chapter: 9, pct: 90 }]);
        expect(bm.highlights).toEqual(base().highlights);
        const hl = withHighlights(base(), [{ quote: '乙' }]);
        expect(hl.highlights).toEqual([{ quote: '乙' }]);
        expect(hl.bookmarks).toEqual(base().bookmarks);
    });

    it('每次更新刷新 updatedAt，且不改动传进来的原对象（纯函数）', () => {
        const s = base();
        const before = s.updatedAt;
        const next = withProgress(s, { chapterIndex: 5, scrollRatio: 0 });
        expect(s.progress.chapterIndex).toBe(2);
        expect(s.updatedAt).toBe(before);
        expect(typeof next.updatedAt).toBe('string');
    });
});

describe('mergeLegacyStore 旧数据三源合并（迁移用）', () => {
    it('进度 + 书签 + 笔记高亮三源齐备', () => {
        const s = mergeLegacyStore({
            progress: { chapterIndex: 4, scrollRatio: 0.3 },
            bookmarks: [{ chapter: 4, pct: 30 }],
            highlights: [{ id: 'hl-9', quote: '甲', loc: { chapter: 4, pct: 30 }, style: 'underline', color: 'blue' }],
        });
        expect(s.version).toBe(READER_STORE_VERSION);
        expect(s.progress.chapterIndex).toBe(4);
        expect(s.progress.scrollRatio).toBe(0.3);
        expect(s.bookmarks).toEqual([{ chapter: 4, pct: 30 }]);
        expect(s.highlights).toEqual([
            { id: 'hl-9', quote: '甲', loc: { chapter: 4, pct: 30 }, style: 'underline', color: 'blue' },
        ]);
    });

    it('缺源按默认（只有高亮也能建档）', () => {
        const s = mergeLegacyStore({ highlights: [{ quote: '甲' }] });
        expect(s.progress.chapterIndex).toBe(-1);
        expect(s.bookmarks).toEqual([]);
        expect(s.highlights).toEqual([{ quote: '甲' }]);
    });

    it('旧数据里的脏值一并过滤（复用归一逻辑，不另写一套）', () => {
        const s = mergeLegacyStore({ bookmarks: [{ chapter: 0, pct: 1 }, { chapter: 1, pct: 1 }] as never });
        expect(s.bookmarks).toEqual([{ chapter: 1, pct: 1 }]);
    });
});
