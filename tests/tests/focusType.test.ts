// 添加按钮初始类型解析（pure/focusType）单测 — 影视聚合页签「添加跟随聚焦」+ #555 系列视图
// 规则表：
//  - 单类型页签（书籍/游戏/音乐等，lockType 非空）→ 恒锁该类型；
//  - 聚合页签（影视，lockType=null）：聚焦「全部」→ undefined（表单兜底默认电影）；
//    聚焦 动画/剧集/电影 任一类型 → 返回该类型（表单默认选中，搜索走对应源）；
//  - 系列视图（#555）：前两级都「没型别」时，回落该系列自身的类型（`seriesType`）。
import { describe, it, expect } from 'vitest';
import { resolveAddType } from 'pure/focusType';

describe('resolveAddType 添加默认类型跟随聚焦', () => {
    it('单类型页签：锁类型优先（无视内层筛选）', () => {
        expect(resolveAddType('book', 'all')).toBe('book');
        expect(resolveAddType('game', 'all')).toBe('game');
        expect(resolveAddType('music', 'all')).toBe('music');
        // 防御：单类型页签 chips 不可见、typeFilter 恒被锁值，即便异常残留其他类型也以锁类型为准
        expect(resolveAddType('movie', 'tv')).toBe('movie');
    });

    it('聚合页签（影视）聚焦「全部」→ undefined（EntryForm 兜底默认电影）', () => {
        expect(resolveAddType(null, 'all')).toBeUndefined();
    });

    it('聚合页签聚焦「动画」→ 动画', () => {
        expect(resolveAddType(null, 'anime')).toBe('anime');
    });

    it('聚合页签聚焦「剧集」→ 剧集', () => {
        expect(resolveAddType(null, 'tv')).toBe('tv');
    });

    it('聚合页签聚焦「电影」→ 电影', () => {
        expect(resolveAddType(null, 'movie')).toBe('movie');
    });

    // 🔴 #555 系列视图：范围已被该系列切干净 ⇒ 默认型别取自 `seriesType`
    it('系列视图（无页签锁、无聚焦）→ 跟随该系列的类型', () => {
        expect(resolveAddType(null, 'all', 'anime')).toBe('anime');
        expect(resolveAddType(null, 'all', 'tv')).toBe('tv');
    });

    it('系列视图仍让位于页签锁与聚焦（前两级优先）', () => {
        expect(resolveAddType('game', 'all', 'anime')).toBe('game');
        expect(resolveAddType(null, 'movie', 'anime')).toBe('movie');
    });

    it('无系列且不聚焦 → undefined（仍回表单默认电影）', () => {
        expect(resolveAddType(null, 'all', null)).toBeUndefined();
        expect(resolveAddType(null, 'all', undefined)).toBeUndefined();
    });
});
