import { describe, it, expect } from 'vitest';
import { scoreTextOf, hasScoreOf, scoreIsPercentOf } from 'pure/scoreDisplay';

// 🔴 2026-10-25 用户裁定「Steam 的评分要显示为 % 专属」⇒ 新增 `reviewPercent` 并让四处展示收敛到本模块。
// 这里的用例守的是**口径本身**（谁优先、要不要加星、空值怎么判），不是某个组件的渲染细节：
// 组件快照会随样式变，口径不能变 —— 口径一变，用户看到的数就是两个数。

describe('scoreTextOf · 百分比优先', () => {
    it('有 reviewPercent ⇒ 只显示百分比，⛔ 不显示 communityScore', () => {
        expect(scoreTextOf({ reviewPercent: 97, communityScore: 9.6 })).toBe('97%');
    });

    it('百分比取整（上游已 Math.round，这里再收一次口防脏数据）', () => {
        expect(scoreTextOf({ reviewPercent: 96.6 })).toBe('97%');
        expect(scoreTextOf({ reviewPercent: 96.4 })).toBe('96%');
    });

    it('reviewPercent = 0 是真实结论（全差评），必须显示 0% 而不是当作「没有评分」', () => {
        expect(scoreTextOf({ reviewPercent: 0, communityScore: 9 })).toBe('0%');
        expect(hasScoreOf({ reviewPercent: 0 })).toBe(true);
        expect(scoreIsPercentOf({ reviewPercent: 0 })).toBe(true);
    });

    it('reviewPercent 非有限数（NaN/Infinity）⇒ 退回 communityScore，别渲染 "NaN%"', () => {
        expect(scoreTextOf({ reviewPercent: Number.NaN, communityScore: 8.4 })).toBe('8.4');
        expect(scoreTextOf({ reviewPercent: Number.POSITIVE_INFINITY, communityScore: 8 })).toBe('8');
        expect(scoreIsPercentOf({ reviewPercent: Number.NaN })).toBe(false);
    });
});

describe('scoreTextOf · 10 分制退回（历史口径逐字不变）', () => {
    it('整数直出，⛔ 不补 .0', () => {
        expect(scoreTextOf({ communityScore: 8 })).toBe('8');
        expect(scoreTextOf({ communityScore: 10 })).toBe('10');
    });

    it('非整数保留一位（豆瓣 8.45 这类）', () => {
        expect(scoreTextOf({ communityScore: 8.4 })).toBe('8.4');
        expect(scoreTextOf({ communityScore: 8.46 })).toBe('8.5');
    });

    it('恰好 .x5 的十进制数按 JS 浮点实际值取整（8.45 → "8.4"，⛔ 不是缺陷）', () => {
        // `8.45` 的二进制表示是 8.449999999999999289…，`toFixed(1)` 因此向下取。
        // 这条**刻意写进测试**：以后有人觉得「8.45 该显示 8.5」而去改 `toFixed`，
        // 会同时把 8.4 显示成 8.4（不变）却让全仓历史快照变动 —— 那是口径变更，得走用户裁定，不能顺手改。
        expect((8.45).toFixed(1)).toBe('8.4');
        expect(scoreTextOf({ communityScore: 8.45 })).toBe('8.4');
    });

    it('字符串形态的数字也要认（老库里存过字符串）', () => {
        expect(scoreTextOf({ communityScore: '9.1' as unknown as number })).toBe('9.1');
        expect(scoreTextOf({ communityScore: '7' as unknown as number })).toBe('7');
    });

    it('communityScore = 0 显示 0（与百分比同理：0 分是有效值）', () => {
        expect(scoreTextOf({ communityScore: 0 })).toBe('0');
        expect(hasScoreOf({ communityScore: 0 })).toBe(true);
    });
});

describe('scoreTextOf · 无评分', () => {
    it('两个都没有 ⇒ 空串（调用方据此隐藏整行）', () => {
        expect(scoreTextOf({})).toBe('');
        expect(hasScoreOf({})).toBe(false);
    });

    it('communityScore 是脏值（非数字）⇒ 空串，⛔ 不渲染 "NaN"', () => {
        expect(scoreTextOf({ communityScore: 'abc' as unknown as number })).toBe('');
        expect(scoreTextOf({ communityScore: Number.NaN })).toBe('');
    });

    it('percent 与 score 都为 undefined 时 scoreIsPercentOf 为 false（否则模板会给空格加星）', () => {
        expect(scoreIsPercentOf({})).toBe(false);
        expect(scoreIsPercentOf({ communityScore: 8 })).toBe(false);
    });
});

describe('🔴 双源同时存在时的一致性（防止两处各读一个字段）', () => {
    it('hasScoreOf / scoreIsPercentOf / scoreTextOf 三者对同一对象的判断必须自洽', () => {
        const rows = [
            {},
            { communityScore: 8 },
            { reviewPercent: 0 },
            { reviewPercent: 88 },
            { reviewPercent: 88, communityScore: 9 },
            { communityScore: 0 },
        ];
        for (const e of rows) {
            const text = scoreTextOf(e);
            expect(hasScoreOf(e)).toBe(text !== '');
            // 有百分比 ⇒ 文本必须带 %；没百分比 ⇒ 文本必然不带 %
            expect(scoreIsPercentOf(e)).toBe(text.endsWith('%'));
        }
    });
});
