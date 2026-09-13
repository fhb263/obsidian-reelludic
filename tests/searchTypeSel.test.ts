// 搜索框类型下拉展示值派生（pure/searchTypeSel）单测
// 「网文」下拉选项 = 书籍类目子类（bookKind novel）的快捷态：搜索框下拉是书籍分类的唯一入口
// （表单内「书籍分类」chips 已移除）：
//  - toSearchTypeSel：真实 (type, bookKind) → 下拉展示值（书籍态显示子类本名，非书籍恒类型本名）；
//  - applySearchTypeSel：下拉选择 → 真实 (type, bookKind)——选「书籍」无条件复位文学（下拉即分类，切换即明确意图）。
// 1.0.3.1：原「漫画」（bookKind comic）快捷态随漫画子视图下线（用户 2026-09-13 裁定）。
import { describe, it, expect } from 'vitest';
import { toSearchTypeSel, applySearchTypeSel } from 'pure/searchTypeSel';

describe('toSearchTypeSel — 真实类型 → 下拉展示值', () => {
    it('书籍 + 网文分类 → 「网文」', () => {
        expect(toSearchTypeSel('book', 'novel')).toBe('novel');
    });
    it('书籍 + 文学分类 → 「书籍」', () => {
        expect(toSearchTypeSel('book', 'book')).toBe('book');
    });
    it('非书籍类型恒原样（分类残留不影响展示）', () => {
        expect(toSearchTypeSel('movie', 'novel')).toBe('movie');
        expect(toSearchTypeSel('game', 'book')).toBe('game');
    });
});

describe('applySearchTypeSel — 下拉选择 → 真实类型派生', () => {
    it('选「网文」→ 书籍 + 网文分类（走 book 链豆瓣主源）', () => {
        expect(applySearchTypeSel('novel', 'book')).toEqual({ type: 'book', bookKind: 'novel' });
        expect(applySearchTypeSel('novel', 'novel')).toEqual({ type: 'book', bookKind: 'novel' });
    });
    it('选「书籍」→ 无条件复位文学（下拉是分类唯一入口，切换即明确意图；添加/编辑一致）', () => {
        expect(applySearchTypeSel('book', 'novel')).toEqual({ type: 'book', bookKind: 'book' });
        expect(applySearchTypeSel('book', 'book')).toEqual({ type: 'book', bookKind: 'book' });
    });
    it('切到非书籍类型 → bookKind 原样保留（非书籍态不显示不落库，切回书籍时选「书籍」复位）', () => {
        expect(applySearchTypeSel('game', 'novel')).toEqual({ type: 'game', bookKind: 'novel' });
        expect(applySearchTypeSel('movie', 'book')).toEqual({ type: 'movie', bookKind: 'book' });
    });
});
