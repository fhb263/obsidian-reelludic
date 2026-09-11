import { describe, it, expect } from 'vitest';
import {
    createEmptyProgress,
    normalizeProgress,
    isProgressDeeper,
    estimatePercent,
    sanitizeReaderTitle,
    progressFileName,
    bookmarksFileName,
    readingProgressFilePath,
    matchLegacyProgressFile,
} from 'pure/readingProgress';

describe('阅读进度存储 createEmptyProgress 空进度', () => {
    it('chapterIndex=-1 / scrollRatio=0 / updatedAt 为合法 ISO 时间', () => {
        const p = createEmptyProgress();
        expect(p.chapterIndex).toBe(-1);
        expect(p.scrollRatio).toBe(0);
        expect(new Date(p.updatedAt).getTime()).not.toBeNaN();
    });
});

describe('阅读进度存储 normalizeProgress 容错归一', () => {
    it('null / 非对象回退默认', () => {
        expect(normalizeProgress(null)).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
        expect(normalizeProgress(undefined)).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
        expect(normalizeProgress('oops')).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('空对象回退默认', () => {
        expect(normalizeProgress({})).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('越界值回退：scrollRatio 越界归 0、chapterIndex 非法归 -1、小数 chapterIndex 取整', () => {
        expect(normalizeProgress({ chapterIndex: 3, scrollRatio: 2 }).scrollRatio).toBe(0);
        expect(normalizeProgress({ chapterIndex: -2, scrollRatio: 0 }).chapterIndex).toBe(-1);
        expect(normalizeProgress({ chapterIndex: 1.9, scrollRatio: 0 }).chapterIndex).toBe(1);
        expect(normalizeProgress({ chapterIndex: 'x', scrollRatio: 'y' })).toEqual({ chapterIndex: -1, scrollRatio: 0, updatedAt: expect.any(String) });
    });

    it('非法日期 updatedAt 回退今天（合法 ISO 时间）', () => {
        const p = normalizeProgress({ updatedAt: 'not-a-date' });
        expect(new Date(p.updatedAt).getTime()).not.toBeNaN();
    });
});

describe('阅读进度存储 normalizeProgress 保留合法值', () => {
    it('chapterIndex=3 / scrollRatio=0.5 不变', () => {
        expect(normalizeProgress({ chapterIndex: 3, scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' }))
            .toEqual({ chapterIndex: 3, scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' });
    });
});

describe('阅读进度存储 isProgressDeeper 进度深浅比较', () => {
    const base = { scrollRatio: 0.5, updatedAt: '2026-08-01T00:00:00.000Z' };
    it('chapter 更深 → true', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 1 }, { ...base, chapterIndex: 2 })).toBe(true);
    });

    it('同 chapter scrollRatio 更深 → true', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 2, scrollRatio: 0.3 }, { ...base, chapterIndex: 2, scrollRatio: 0.8 })).toBe(true);
    });

    it('同 chapter scrollRatio 更浅 → false', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 2, scrollRatio: 0.8 }, { ...base, chapterIndex: 2, scrollRatio: 0.3 })).toBe(false);
    });

    it('chapter 更浅 → false（即使 scrollRatio 更大）', () => {
        expect(isProgressDeeper({ ...base, chapterIndex: 3, scrollRatio: 0.1 }, { ...base, chapterIndex: 2, scrollRatio: 0.9 })).toBe(false);
    });
});

describe('阅读进度估算 estimatePercent 按章节大小加权', () => {
    // sizes = 各章段落数/字符数；进度 = (前序章总和 + 当前章×ratio) / 总和
    it('未开始（首章顶部）为 0', () => {
        expect(estimatePercent([10, 20, 30], 0, 0)).toBe(0);
    });

    it('首章读到一半：5/60 ≈ 8%', () => {
        expect(estimatePercent([10, 20, 30], 0, 0.5)).toBe(8);
    });

    it('第二章开头：10/60 ≈ 17%', () => {
        expect(estimatePercent([10, 20, 30], 1, 0)).toBe(17);
    });

    it('第二章读到一半：(10+10)/60 ≈ 33%', () => {
        expect(estimatePercent([10, 20, 30], 1, 0.5)).toBe(33);
    });

    it('最后一章到底为 100', () => {
        expect(estimatePercent([10, 20, 30], 2, 1)).toBe(100);
    });

    it('chapterIndex 越界返回 0', () => {
        expect(estimatePercent([10, 20, 30], -1, 0.5)).toBe(0);
        expect(estimatePercent([10, 20, 30], 3, 0.5)).toBe(0);
    });

    it('空章节列表返回 0', () => {
        expect(estimatePercent([], 0, 0.5)).toBe(0);
    });

    it('scrollRatio 越界钳制到 0-1', () => {
        expect(estimatePercent([10, 20, 30], 0, 1.5)).toBe(estimatePercent([10, 20, 30], 0, 1));
        expect(estimatePercent([10, 20, 30], 1, -0.5)).toBe(estimatePercent([10, 20, 30], 1, 0));
    });

    it('章节大小含 0/负值容错（按 0 计）', () => {
        expect(estimatePercent([0, 10, 0], 1, 1)).toBe(100);
        expect(estimatePercent([-5, 10], 0, 0.5)).toBe(0);
    });

    it('全零大小返回 0', () => {
        expect(estimatePercent([0, 0, 0], 1, 0.5)).toBe(0);
    });

    it('单章书：读到一半 50%', () => {
        expect(estimatePercent([100], 0, 0.5)).toBe(50);
    });

    it('末章读到 ≥95% → 钳 100（拉到底/翻到底因容器余白 ratio 到不了 1.0，防止卡 98/99）', () => {
        expect(estimatePercent([10, 20, 30], 2, 0.95)).toBe(100);
        expect(estimatePercent([10, 20, 30], 2, 0.99)).toBe(100);
        expect(estimatePercent([10, 20, 30], 2, 1)).toBe(100);
    });

    it('末章 <95% 不钳制（保持真实估算）', () => {
        // (10+20+30*0.9)/60 = 57/60 = 95%
        expect(estimatePercent([10, 20, 30], 2, 0.9)).toBe(95);
        // 非末章高比例也不钳（第 2/3 章读到 0.99 不是读完）：(10+20*0.99)/60 ≈ 50%
        expect(estimatePercent([10, 20, 30], 1, 0.99)).toBe(50);
    });
});

describe('阅读进度文件可读命名 sanitizeReaderTitle（标题安全段）', () => {
    it('清理非法文件名字符（/ \\ : * ? " < > | # ^ [ ]）为空格并压缩空白', () => {
        expect(sanitizeReaderTitle('三体/全集:第一卷?')).toBe('三体 全集 第一卷');
        expect(sanitizeReaderTitle('A:B*C?D"E<F>G|H#I^J[K]L')).toBe('A B C D E F G H I J K L');
    });
    it('空/纯空白 → 未命名', () => {
        expect(sanitizeReaderTitle('')).toBe('未命名');
        expect(sanitizeReaderTitle('   ')).toBe('未命名');
    });
    it('常规中文/英文标题原样保留', () => {
        expect(sanitizeReaderTitle('三体')).toBe('三体');
        expect(sanitizeReaderTitle('Boom Beach')).toBe('Boom Beach');
    });
});

describe('progressFileName / bookmarksFileName 可读命名（书名-阅读进度|书签-原ID）', () => {
    it('进度文件：{书名}-阅读进度-{id}.json', () => {
        expect(progressFileName('e_1788181824054_a2ry', '三体')).toBe('三体-阅读进度-e_1788181824054_a2ry.json');
    });
    it('书签文件：{书名}-书签-{id}.json', () => {
        expect(bookmarksFileName('e_1788181824054_a2ry', '三体')).toBe('三体-书签-e_1788181824054_a2ry.json');
    });
    it('同名书不同 id → 文件名不同（原 ID 保证关联与去重）', () => {
        const a = progressFileName('e_1_a1', '活着');
        const b = progressFileName('e_2_b2', '活着');
        expect(a).not.toBe(b);
        expect(a).toContain('e_1_a1');
        expect(b).toContain('e_2_b2');
    });
    it('标题含非法字符先清理再入名（不产生破路径）', () => {
        expect(progressFileName('e_1_a1', '沙丘/第一部')).toBe('沙丘 第一部-阅读进度-e_1_a1.json');
        expect(bookmarksFileName('e_1_a1', '')).toBe('未命名-书签-e_1_a1.json');
    });
});

describe('readingProgressFilePath 进度文件路径', () => {
    it('无尾斜杠 libraryDir → {dir}/阅读进度/{书名}-阅读进度-{id}.json', () => {
        expect(readingProgressFilePath('e_1788181824054_a2ry', '三体', 'ReelLudic'))
            .toBe('ReelLudic/阅读进度/三体-阅读进度-e_1788181824054_a2ry.json');
    });
    it('尾斜杠去除；空/纯斜杠回退 ReelLudic', () => {
        expect(readingProgressFilePath('e1', '书', 'MyLib//')).toBe('MyLib/阅读进度/书-阅读进度-e1.json');
        expect(readingProgressFilePath('e1', '书', '')).toBe('ReelLudic/阅读进度/书-阅读进度-e1.json');
        expect(readingProgressFilePath('e1', '书', '/')).toBe('ReelLudic/阅读进度/书-阅读进度-e1.json');
    });
});

describe('matchLegacyProgressFile 旧格式文件名识别（迁移用）', () => {
    it('旧进度 e_xxx.json → { id, kind: progress }', () => {
        expect(matchLegacyProgressFile('e_1788181824054_a2ry.json')).toEqual({ entryId: 'e_1788181824054_a2ry', kind: 'progress' });
    });
    it('旧书签 e_xxx.bookmarks.json → kind: bookmarks', () => {
        expect(matchLegacyProgressFile('e_1788181824054_a2ry.bookmarks.json')).toEqual({ entryId: 'e_1788181824054_a2ry', kind: 'bookmarks' });
    });
    it('新可读名/无关文件 → null（迁移幂等不误伤）', () => {
        expect(matchLegacyProgressFile('三体-阅读进度-e_1788181824054_a2ry.json')).toBeNull();
        expect(matchLegacyProgressFile('三体-书签-e_1788181824054_a2ry.json')).toBeNull();
        expect(matchLegacyProgressFile('readme.txt')).toBeNull();
        expect(matchLegacyProgressFile('e_1788181824054_a2ry')).toBeNull();
    });
});
