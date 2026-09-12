// 多源搜索合并与相似度排序测试
import { describe, it, expect } from 'vitest';
import { mergeBySource, sortByRelevance } from 'pure/searchMerge';

interface Item { title: string; source?: string; id?: number }

describe('mergeBySource 多源合并去重', () => {
    it('同源同名去重（主源优先），跨源同名都保留（20+20 并存）', () => {
        const google = { title: '黑客', source: undefined };
        const douban = { title: '黑客', source: 'douban' };
        const r = mergeBySource<Item>([google, { title: '黑客', source: undefined }], [douban]);
        // 主源两条「黑客」去重为 1 条 + 豆瓣「黑客」1 条
        expect(r).toHaveLength(2);
        expect(r[0].source).toBeUndefined();
        expect(r[1].source).toBe('douban');
    });

    it('标题大小写/空白归一化后同源同名去重', () => {
        const r = mergeBySource<Item>([{ title: 'The Matrix' }], [{ title: '  the  matrix ' }]);
        expect(r).toHaveLength(1);
    });

    it('空标题剔除', () => {
        const r = mergeBySource<Item>([{ title: '   ' }, { title: '有效' }], []);
        expect(r).toHaveLength(1);
        expect(r[0].title).toBe('有效');
    });

    it('主源结果在前，追加源在后', () => {
        const r = mergeBySource<Item>([{ title: 'A', source: 'tmdb' }], [{ title: 'B', source: 'douban' }]);
        expect(r.map((x) => x.title)).toEqual(['A', 'B']);
    });
});

describe('sortByRelevance 相似度排序', () => {
    it('完全相等 > 前缀 > 包含 > 首字模糊 > 无关', () => {
        const items = [
            { title: '黑客帝国动画版' },
            { title: '黑客' },
            { title: '黑客与画家' },
            { title: '完全无关' },
            { title: '黑镜' },
        ];
        const r = sortByRelevance(items, '黑客');
        expect(r.map((x) => x.title)).toEqual([
            '黑客',        // 完全相等 4
            '黑客帝国动画版', // 前缀 3
            '黑客与画家',   // 包含 2
            '黑镜',        // 首字模糊 1
            '完全无关',     // 无关 0
        ]);
    });

    it('同分保持原顺序（稳定排序）', () => {
        const items = [{ title: '黑客帝国' }, { title: '黑客帝国2' }];
        const r = sortByRelevance(items, '黑客');
        expect(r.map((x) => x.title)).toEqual(['黑客帝国', '黑客帝国2']);
    });

    it('query 为空返回原数组（不排序）', () => {
        const items = [{ title: 'B' }, { title: 'A' }];
        expect(sortByRelevance(items, '  ')).toEqual(items);
    });
});
