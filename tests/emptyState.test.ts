import { describe, it, expect } from 'vitest';
import { resolveEmptyState, describeFilters, type EmptyStateInput } from 'pure/emptyState';

const base: EmptyStateInput = { poolCount: 10, filteredCount: 0 };

/**
 * 取非空结果：空态用例都要先断言「确实有结果」，再读字段。
 * 注意 vitest 不做类型检查（用 esbuild 转译），这类 null 访问只在 `npm run build` 的 tsc 阶段暴露 ——
 * 所以这里显式收窄，不靠 `!` 断言糊过去。
 */
function must(input: EmptyStateInput): NonNullable<ReturnType<typeof resolveEmptyState>> {
    const r = resolveEmptyState(input);
    if (!r) throw new Error('期望拿到空态结果，实际为 null');
    return r;
}

describe('resolveEmptyState · 有结果时不出空态', () => {
    it('filteredCount > 0 → null', () => {
        expect(resolveEmptyState({ poolCount: 10, filteredCount: 3 })).toBeNull();
        expect(resolveEmptyState({ poolCount: 0, filteredCount: 1 })).toBeNull(); // 池子口径异常但确有结果 → 仍不出空态
    });
});

describe('resolveEmptyState · 库为空（no-data）', () => {
    it('池子为 0 → 按锁定类型给措辞 + 引导添加', () => {
        expect(resolveEmptyState({ poolCount: 0, filteredCount: 0, lockType: 'book' })).toMatchObject({ kind: 'no-data', action: 'add' });
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book' }).title).toContain('书架还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'game' }).title).toContain('游戏库还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'music' }).title).toContain('歌单还是空的');
    });

    it('聚合页签（lockType 为空）与未知类型 → 通用「库还是空的」', () => {
        for (const lockType of [null, undefined, 'movie', 'tv', 'anime'] as const) {
            expect(resolveEmptyState({ poolCount: 0, filteredCount: 0, lockType })).toMatchObject({ kind: 'no-data', action: 'add' });
            expect(must({ poolCount: 0, filteredCount: 0, lockType }).title).toBe('库还是空的 — 点「＋ 添加」录入第一条条目');
        }
    });

    it('库为空时不带筛选提示（提示只在筛选没命中时才有意义）', () => {
        expect(must({ poolCount: 0, filteredCount: 0, query: '沙丘' }).hint).toBeUndefined();
    });
});

describe('resolveEmptyState · 筛选没命中（no-match）', () => {
    it('池子非空但筛完为 0 → 引导清除筛选', () => {
        expect(resolveEmptyState(base)).toMatchObject({ kind: 'no-match', title: '没有匹配的条目', action: 'clear' });
    });

    it('回显生效条件（类型 / 状态 / 关键词）', () => {
        expect(must({ ...base, typeLabel: '电影', statusLabel: '在看', query: '沙丘' }).hint).toBe('类型：电影 · 状态：在看 · 关键词：沙丘');
    });

    it('条件含分类时按固定顺序拼接', () => {
        expect(must({ ...base, typeLabel: '电影', kindLabel: '文学', statusLabel: '已读', query: 'x' }).hint).toBe('类型：电影 · 分类：文学 · 状态：已读 · 关键词：x');
    });

    it('无任何可见条件时 hint 为 undefined（纯逻辑不编条件）', () => {
        expect(must(base).hint).toBeUndefined();
    });
});

describe('describeFilters', () => {
    it('空串 / 纯空白关键词不算条件', () => {
        expect(describeFilters({ poolCount: 1, filteredCount: 0, query: '' })).toBeUndefined();
        expect(describeFilters({ poolCount: 1, filteredCount: 0, query: '   ' })).toBeUndefined();
    });

    it('关键词首尾空白被去掉', () => {
        expect(describeFilters({ poolCount: 1, filteredCount: 0, query: '  沙丘  ' })).toBe('关键词：沙丘');
    });

    it('全部条件缺失 → undefined', () => {
        expect(describeFilters({ poolCount: 1, filteredCount: 0 })).toBeUndefined();
    });
});

describe('resolveEmptyState · 脏输入容错', () => {
    it('负数 / NaN / 小数不产生异常结果', () => {
        expect(must({ poolCount: -5, filteredCount: -1 }).kind).toBe('no-data');
        expect(must({ poolCount: NaN, filteredCount: NaN }).kind).toBe('no-data');
        expect(must({ poolCount: 2.7, filteredCount: 0 }).kind).toBe('no-match');
        expect(resolveEmptyState({ poolCount: 0, filteredCount: 2.9 })).toBeNull();
    });
});

// 题材维度（视图级题材筛选，用户 2026-09-22）：题材把结果筛空时，提示必须点名题材，
// 否则用户看到「类型：文学」会以为分类选错了。
describe('describeFilters · 题材回显', () => {
    it('题材排在分类之后、状态之前', () => {
        expect(
            describeFilters({ poolCount: 1, filteredCount: 0, typeLabel: '电影', kindLabel: '文学', genreLabel: '推理+1', statusLabel: '已读', query: 'x' }),
        ).toBe('类型：电影 · 分类：文学 · 题材：推理+1 · 状态：已读 · 关键词：x');
    });

    it('只有题材时也能单独回显', () => {
        expect(describeFilters({ poolCount: 1, filteredCount: 0, genreLabel: '全部' })).toBe('题材：全部');
    });

    it('未传题材 → 与原行为逐字一致（老调用零影响）', () => {
        expect(describeFilters({ poolCount: 1, filteredCount: 0, typeLabel: '电影', statusLabel: '在看' })).toBe('类型：电影 · 状态：在看');
    });
});

// ⚠️ #435 的「系列筛选」已整块退场（用户：「删除这个筛选系列框」）⇒ 空态不再有 `seriesLabel` 这一维，
//    对应用例一并删除；「⛔ 不许长回来」的守卫在产物断言脚本里。

describe('resolveEmptyState · 视图池措辞（#444f poolKey）', () => {
    it('阅读子分类为空 ⇒ 各有各的措辞（⛔ 不再落到「书架还是空的」）', () => {
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book', poolKey: 'book:book' }).title).toContain('文学书架还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book', poolKey: 'book:novel' }).title).toContain('网文架还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book', poolKey: 'book:comic' }).title).toContain('漫画架还是空的');
    });

    it('🔴 漫画子分类为空 ⇒ **no-data + action=add**（用户报的那条：原来会走 no-match「没有匹配的条目 + 清除筛选」）', () => {
        const r = must({ poolCount: 0, filteredCount: 0, lockType: 'book', poolKey: 'book:comic', kindLabel: '漫画' });
        expect(r.kind).toBe('no-data');
        expect(r.action).toBe('add');
        expect(r.hint).toBeUndefined(); // no-data 不回显条件（回显只在筛选没命中时才有意义）
    });

    it('影视聚合页签：空的类型各有专属措辞（⛔ 不再说「库还是空的」—— 库里可能有别的类型）', () => {
        expect(must({ poolCount: 0, filteredCount: 0, lockType: null, poolKey: 'movieTv' }).title).toContain('影视库还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: null, poolKey: 'movieTv:movie' }).title).toContain('还没有电影');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: null, poolKey: 'movieTv:tv' }).title).toContain('还没有电视剧');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: null, poolKey: 'movieTv:anime' }).title).toContain('还没有动画');
    });

    it('poolKey 与 lockType 同时给出 ⇒ **poolKey 优先**', () => {
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book', poolKey: 'book:comic' }).title).toContain('漫画架还是空的');
    });

    it('⛔ 缺 poolKey 时回退按 lockType 查（老调用逐字不变）', () => {
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'book' }).title).toContain('书架还是空的');
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'music' }).title).toContain('歌单还是空的');
    });

    it('两个键都认不出 → 通用兜底（真·未知视图）', () => {
        expect(must({ poolCount: 0, filteredCount: 0, lockType: 'weird', poolKey: 'weird:x' }).title)
            .toBe('库还是空的 — 点「＋ 添加」录入第一条条目');
    });

    it('池子非空时 poolKey **不参与**（no-match 走的是筛选回显那条路）', () => {
        const r = must({ poolCount: 5, filteredCount: 0, lockType: 'book', poolKey: 'book:comic', kindLabel: '漫画' });
        expect(r.kind).toBe('no-match');
        expect(r.action).toBe('clear');
        expect(r.hint).toBe('分类：漫画');
    });
});
