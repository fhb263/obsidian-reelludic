// 搜索框类型下拉展示值派生（pure/searchTypeSel）单测
// 「漫画」下拉选项 = 书籍类目 comic 子类的快捷态（type=book + bookKind=comic，搜索走漫画源链 Bangumi+豆瓣）：
//  - toSearchTypeSel：真实 (type, bookKind) → 下拉展示值（初始化 / chips 反向同步）；
//  - applySearchTypeSel：下拉选择值 → 真实 (type, bookKind)（添加模式从漫画切书籍复位出版；编辑模式永不复位防静默改写分类）。
import { describe, it, expect } from 'vitest';
import { toSearchTypeSel, applySearchTypeSel } from 'pure/searchTypeSel';

describe('toSearchTypeSel — 真实类型 → 下拉展示值', () => {
    it('书籍 + 漫画分类 → 「漫画」', () => {
        expect(toSearchTypeSel('book', 'comic')).toBe('comic');
    });
    it('书籍 + 出版分类 → 「书籍」', () => {
        expect(toSearchTypeSel('book', 'book')).toBe('book');
    });
    it('书籍 + 网文分类 → 「书籍」', () => {
        expect(toSearchTypeSel('book', 'novel')).toBe('book');
    });
    it('非书籍类型恒原样（分类残留不影响展示）', () => {
        expect(toSearchTypeSel('movie', 'comic')).toBe('movie');
        expect(toSearchTypeSel('game', 'comic')).toBe('game');
    });
});

describe('applySearchTypeSel — 下拉选择 → 真实类型派生', () => {
    it('选「漫画」→ 书籍 + 漫画分类（添加模式）', () => {
        expect(applySearchTypeSel('comic', 'movie', 'book', true)).toEqual({ type: 'book', bookKind: 'comic' });
    });
    it('选「漫画」→ 书籍 + 漫画分类（编辑模式同样成立：用户明确选漫画=主动改分类）', () => {
        expect(applySearchTypeSel('comic', 'book', 'book', false)).toEqual({ type: 'book', bookKind: 'comic' });
    });
    it('添加模式：从「漫画」切回「书籍」→ 分类复位出版（下拉「书籍」直观语义 = 出版书）', () => {
        expect(applySearchTypeSel('book', 'book', 'comic', true)).toEqual({ type: 'book', bookKind: 'book' });
    });
    it('添加模式：书籍非漫画分类切「书籍」→ 分类保留（网文不被复位）', () => {
        expect(applySearchTypeSel('book', 'book', 'novel', true)).toEqual({ type: 'book', bookKind: 'novel' });
    });
    it('编辑模式：漫画条目下拉切「书籍」→ 分类保持 comic（仅切下拉不得静默改写既有分类，改分类走 chips）', () => {
        expect(applySearchTypeSel('book', 'book', 'comic', false)).toEqual({ type: 'book', bookKind: 'comic' });
    });
    it('切到非书籍类型 → bookKind 原样保留（非书籍态分类不显示不落库，切回书籍再按规则处理）', () => {
        expect(applySearchTypeSel('game', 'book', 'comic', true)).toEqual({ type: 'game', bookKind: 'comic' });
        expect(applySearchTypeSel('movie', 'book', 'novel', false)).toEqual({ type: 'movie', bookKind: 'novel' });
    });
});
