// 「合并视图」作用域（pure/mergedScope）—— 守三件事：
//   ⑴ 9 项清单与**顺序**就是用户点名的那份；⑵ `'book'` 在本模块里是**文学**（不是「书籍」）；
//   ⑶ 归一兜底是「全部」（⛔ 不是某个类型 —— 那等于用户没点过就被筛掉一大半）。
import { describe, expect, it } from 'vitest';
import {
    MERGED_SCOPES,
    mergedBookKind,
    mergedLockType,
    mergedScopeLabel,
    normalizeMergedScope,
} from 'pure/mergedScope';

describe('mergedScope · 合并视图的媒体类型作用域（#547）', () => {
    it('清单与顺序 = 用户给定：全部 → 文学 → 网文 → 漫画 → 动画 → 剧集 → 电影 → 游戏 → 音乐', () => {
        expect(MERGED_SCOPES).toEqual([
            'all', 'book', 'novel', 'comic', 'anime', 'tv', 'movie', 'game', 'music',
        ]);
    });

    it('🔴 歧义锁：`book` 在本模块里是**文学**（BOOK_KIND_LABELS），⛔ 不是「书籍」那个 EntryType', () => {
        // 这条是整个模块最容易踩的地方：MergedScope 的 id 空间是 BookKind ∪ 非书籍 EntryType 的并集，
        // 而两边的 `book` 含义不同（书籍子分类 vs 书籍类型）。改文案前先跑这条。
        expect(mergedScopeLabel('book')).toBe('文学');
        expect(mergedScopeLabel('novel')).toBe('网文');
        expect(mergedScopeLabel('comic')).toBe('漫画');
        expect(mergedScopeLabel('all')).toBe('全部');
    });

    it('其余五种取类型本名（⛔ 不在本模块手写第二份中文）', () => {
        expect(mergedScopeLabel('anime')).toBe('动画');
        expect(mergedScopeLabel('tv')).toBe('剧集');
        expect(mergedScopeLabel('movie')).toBe('电影');
        expect(mergedScopeLabel('game')).toBe('游戏');
        expect(mergedScopeLabel('music')).toBe('音乐');
    });

    it('归一：只认清单里的 id，其余（含脏数据）一律回「全部」', () => {
        for (const s of MERGED_SCOPES) expect(normalizeMergedScope(s)).toBe(s);
        expect(normalizeMergedScope(undefined)).toBe('all');
        expect(normalizeMergedScope(null)).toBe('all');
        expect(normalizeMergedScope('')).toBe('all');
        expect(normalizeMergedScope('ALL')).toBe('all');
        expect(normalizeMergedScope(1)).toBe('all');
        expect(normalizeMergedScope({ scope: 'movie' })).toBe('all');
    });

    it('作用域 → lockType：all ⇒ null（全库）；书籍子分类 ⇒ 锁 book；其余 ⇒ 类型本身', () => {
        expect(mergedLockType('all')).toBe(null);
        expect(mergedLockType('book')).toBe('book');
        expect(mergedLockType('novel')).toBe('book');
        expect(mergedLockType('comic')).toBe('book');
        expect(mergedLockType('anime')).toBe('anime');
        expect(mergedLockType('music')).toBe('music');
    });

    it('作用域 → kindFilter：只有书籍子分类有值，其余一律 all（⛔ 别把非书籍类型塞进子分类那一维）', () => {
        expect(mergedBookKind('book')).toBe('book');
        expect(mergedBookKind('novel')).toBe('novel');
        expect(mergedBookKind('comic')).toBe('comic');
        expect(mergedBookKind('all')).toBe('all');
        expect(mergedBookKind('movie')).toBe('all');
        expect(mergedBookKind('game')).toBe('all');
    });
});
