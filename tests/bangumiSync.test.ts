// Bangumi 详情投影纯模块（`src/pure/bangumiSync.ts`）的单测。
//
// 背景：这个模块是为了消灭「同一个映射在 main.ts 里手写三遍」而抽出来的
// （① searchAnimeFresh ② importBangumiCollections ③ importBangumiRows）。
// 所以这里既要测**归一正确性**，也要测**三处语义差异被保住**（搜索结果只覆盖非空、导入走 ?? 兜底）。
import { describe, expect, it } from 'vitest';
import {
    bangumiDetailData,
    bangumiEntryFields,
    bangumiSearchEnrich,
} from 'pure/bangumiSync';

describe('bangumiSync · bangumiDetailData（subjects + persons 归一）', () => {
    it('rating / ratingCount / studio / director / cast 正常透传', () => {
        const d = bangumiDetailData(
            { rating: 8.6, ratingCount: 12345, studio: '京都动画' },
            { director: '石原立也', cast: ['丰崎爱生', '日笠阳子'], studio: '公司B' },
        );
        expect(d).toEqual({
            rating: 8.6,
            ratingCount: 12345,
            studio: '京都动画', // subjects 的「动画制作」优先，persons 的公司只是兜底
            director: '石原立也',
            cast: ['丰崎爱生', '日笠阳子'],
        });
    });

    it('subjects 没有 studio 时才用 persons 的公司（兜底链方向不能反）', () => {
        expect(bangumiDetailData({ rating: 7 }, { studio: '公司B' }).studio).toBe('公司B');
    });

    it('🔴 rating 只采信 0 < v <= 10；0 / 11 / NaN / 字符串 全部丢弃', () => {
        // 0 是「没人评过」而不是「0 分」，落 0 会让界面显示「0 分」这种假结论
        expect('rating' in bangumiDetailData({ rating: 0 }, {})).toBe(false);
        expect('rating' in bangumiDetailData({ rating: 11 }, {})).toBe(false);
        expect('rating' in bangumiDetailData({ rating: Number.NaN }, {})).toBe(false);
        expect('rating' in bangumiDetailData({ rating: '8.6' }, {})).toBe(false);
        expect(bangumiDetailData({ rating: 10 }, {}).rating).toBe(10);
    });

    it('ratingCount 取整；0 / 负数丢弃', () => {
        expect(bangumiDetailData({ ratingCount: 12.7 }, {}).ratingCount).toBe(13);
        expect('ratingCount' in bangumiDetailData({ ratingCount: 0 }, {})).toBe(false);
        expect('ratingCount' in bangumiDetailData({ ratingCount: -3 }, {})).toBe(false);
    });

    it('空串 / 纯空白的文本字段不算数（⛔ 别把 "" 当导演）', () => {
        expect('studio' in bangumiDetailData({ studio: '   ' }, {})).toBe(false);
        expect('director' in bangumiDetailData({}, { director: '' })).toBe(false);
    });

    it('cast 过滤非字符串后为空 ⇒ 不写键；全空输入 ⇒ 空对象', () => {
        expect('cast' in bangumiDetailData({}, { cast: ['', '  '] })).toBe(false);
        expect(bangumiDetailData({}, {}).cast).toBeUndefined();
        expect(bangumiDetailData({}, { cast: ['声优A', '', 42 as unknown as string] }).cast).toEqual(['声优A']);
    });

    it('🔴 入参脏形态（null / 数组 / 字符串）⇒ 不抛，当空处理', () => {
        expect(bangumiDetailData(null, null)).toEqual({});
        expect(bangumiDetailData(undefined, undefined)).toEqual({});
        expect(bangumiDetailData([1, 2], 'x')).toEqual({});
    });
});

describe('bangumiSync · bangumiEntryFields（导入落库投影）', () => {
    const row = { rating: 7.5, ratingCount: 900, studio: '列表公司', director: '列表导演', cast: ['列表声优'] };

    it('详情优先、列表值兜底（?? 链）', () => {
        const f = bangumiEntryFields(row, { rating: 8.9, ratingCount: 5000, studio: '详情公司' });
        expect(f.communityScore).toBe(8.9);
        expect(f.ratingCount).toBe(5000);
        expect(f.developer).toBe('详情公司');
        // 详情没给的字段回落列表
        expect(f.director).toBe('列表导演');
        expect(f.cast).toEqual(['列表声优']);
    });

    it('🔴 详情全空（详情接口超时 catch 后传 {}）⇒ 列表级字段全部保住', () => {
        // 这是旧代码 `try { detail = ... } catch { /* 静默 */ }` 那条路径：失败不该让评分消失
        const f = bangumiEntryFields(row, {});
        expect(f).toEqual({
            communityScore: 7.5,
            ratingCount: 900,
            developer: '列表公司',
            director: '列表导演',
            cast: ['列表声优'],
        });
    });

    it('两边都没有 ⇒ 不写键（⛔ 不编 0 分 / 空数组）', () => {
        expect(bangumiEntryFields({}, {})).toEqual({});
        expect('communityScore' in bangumiEntryFields({}, {})).toBe(false);
        expect('cast' in bangumiEntryFields({}, {})).toBe(false);
    });

    it('🔴 落库键名映射：条目的 rating 叫 communityScore，studio 叫 developer', () => {
        const f = bangumiEntryFields({ rating: 8 }, { studio: 'X' });
        expect(f.communityScore).toBe(8); // ⛔ 不是 f.rating
        expect(f.developer).toBe('X'); // ⛔ 不是 f.studio
        expect('rating' in f).toBe(false);
        expect('studio' in f).toBe(false);
    });
});

describe('bangumiSync · bangumiSearchEnrich（搜索结果补全）', () => {
    const r = {
        id: 1,
        title: '某番',
        originalTitle: '某番',
        genres: [],
        rating: 6.6,
        studio: '列表公司',
    };

    it('详情值覆盖列表值', () => {
        const out = bangumiSearchEnrich(r, { rating: 9.1, ratingCount: 777, studio: '详情公司', director: 'D', cast: ['C'] });
        expect(out).toMatchObject({ rating: 9.1, ratingCount: 777, studio: '详情公司', director: 'D', cast: ['C'] });
    });

    it('🔴 详情缺字段时**保留列表已有值**（⛔ 别用 ?? 把 list 值清成 undefined）', () => {
        // 这是与 bangumiEntryFields 的区别：搜索结果是「补全」，不是「重算」
        const out = bangumiSearchEnrich(r, {});
        expect(out.rating).toBe(6.6);
        expect(out.studio).toBe('列表公司');
        expect(out.id).toBe(1);
        expect(out.title).toBe('某番');
    });

    it('空 cast 不覆盖（保留列表 undefined）', () => {
        const out = bangumiSearchEnrich(r, { cast: [] });
        expect('cast' in out).toBe(false);
    });
});
