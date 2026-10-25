import { describe, expect, it } from 'vitest';
import {
    emptySameNameReport,
    findTitleConflict,
    indexByTitleKey,
    normalizeTitleForMatch,
    titleKeyOf,
} from '../src/pure/importConflict';

/**
 * 2026-10-21 需求 4（导入同名冲突提示）的纯函数层。
 * 真因：笔记落盘路径按标题派生（`noteGenerator.entryNotePath()`）+ `vaultIO.writeText()` 遇已存在
 * `TFile` 直接 `modify` ⇒ 同名标题 = 同一个 .md 被原地覆盖、零提示。
 */
describe('normalizeTitleForMatch', () => {
    it('NFKC：全角字母/数字/百分号折成半角（豆瓣标题常见）', () => {
        expect(normalizeTitleForMatch('１００％')).toBe('100%');
        expect(normalizeTitleForMatch('ＯＮＥ')).toBe('one');
    });

    it('空白：连续空白（含全角空格 \\u3000、制表、换行）折成一个半角空格再 trim', () => {
        expect(normalizeTitleForMatch('  One\u3000\u3000Piece  ')).toBe('one piece');
        expect(normalizeTitleForMatch('沙丘\n\t第二部')).toBe('沙丘 第二部');
    });

    it('小写化：英文大小写不区分', () => {
        expect(normalizeTitleForMatch('One Piece')).toBe(normalizeTitleForMatch('one piece'));
    });

    it('中文标题原样（不做繁简/标点归一等激进处理）', () => {
        expect(normalizeTitleForMatch('流浪地球2')).toBe('流浪地球2');
        expect(normalizeTitleForMatch('活着')).toBe('活着');
    });
});

describe('titleKeyOf', () => {
    it('键 = 类型 + NUL + 归一标题（用 NUL 分隔，标题里不可能出现）', () => {
        expect(titleKeyOf('movie', 'One  Piece')).toBe('movie\u0000one piece');
    });

    it('同类型同标题（仅写法差异）→ 同键；不同类型 → 不同键', () => {
        expect(titleKeyOf('movie', '沙丘')).toBe(titleKeyOf('movie', ' 沙丘 '));
        expect(titleKeyOf('movie', '沙丘')).not.toBe(titleKeyOf('tv', '沙丘'));
    });
});

describe('indexByTitleKey / findTitleConflict', () => {
    const entries = [
        { id: 'e1', type: 'movie', title: '沙丘' },
        { id: 'e2', type: 'book', title: '活着' },
        { id: 'e3', type: 'book', title: 'One   Piece' },
    ];

    it('命中：写法差异也能查到（全角/多余空格/大小写）', () => {
        const idx = indexByTitleKey(entries);
        expect(findTitleConflict(idx, 'book', 'one piece')?.id).toBe('e3');
        expect(findTitleConflict(idx, 'book', 'ＯＮＥ ＰＩＥＣＥ')?.id).toBe('e3');
        expect(findTitleConflict(idx, 'movie', ' 沙丘 ')?.id).toBe('e1');
    });

    it('不命中：不同类型同名不算冲突（媒体类型各自独立）', () => {
        const idx = indexByTitleKey(entries);
        expect(findTitleConflict(idx, 'tv', '沙丘')).toBeNull();
        expect(findTitleConflict(idx, 'anime', '活着')).toBeNull();
    });

    it('不命中：库里没有这个标题', () => {
        const idx = indexByTitleKey(entries);
        expect(findTitleConflict(idx, 'book', '不存在的书名')).toBeNull();
    });

    it('库内同名多条 → 先到先得（只需要"有没有"，不关心是哪条）', () => {
        const idx = indexByTitleKey([
            { id: 'a', type: 'book', title: '活着' },
            { id: 'b', type: 'book', title: '活着' },
        ]);
        expect(findTitleConflict(idx, 'book', '活着')?.id).toBe('a');
    });

    it('空库 → 索引为空，任何标题都不冲突', () => {
        const idx = indexByTitleKey([]);
        expect(idx.size).toBe(0);
        expect(findTitleConflict(idx, 'movie', '沙丘')).toBeNull();
    });

    it('⛔ 只读索引：调用不改原数组、不依赖 Map 迭代顺序', () => {
        const copy = [...entries];
        const idx = indexByTitleKey(copy);
        findTitleConflict(idx, 'book', '活着');
        expect(copy).toEqual(entries);
        expect(idx.size).toBe(3);
    });
});

describe('emptySameNameReport', () => {
    it('返回 0 / 空数组（⛔ 不能是 undefined：调用方靠 res.sameName 的真假决定要不要出文案）', () => {
        const r = emptySameNameReport();
        expect(r.sameName).toBe(0);
        expect(r.sameNames).toEqual([]);
        // 每次都是新对象，别共享同一个引用
        expect(emptySameNameReport()).not.toBe(r);
    });
});
