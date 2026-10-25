// 连续添加（#632）纯逻辑单测。
//
// 这批判据的要害有两条：
//   ① 「序号自动 +1」是**唯一**算法 —— 猜错了会静默给用户的系列编错号（比不编还可恶）；
//   ② 「候选键」与组件里那份**同源** —— 一旦各写各的，「已添加」标记就会标错行。
import { describe, it, expect } from 'vitest';
import { nextSeriesIndexLabel, repeatHint, resultKeyOf, submitLabel } from 'pure/repeatAdd';
import type { SearchResult } from 'pure/searchDisplay';

/** 最小候选：只要 `id` / `title` 参与键的构造 */
const cand = (o: Record<string, unknown>) => o as unknown as SearchResult;

describe('resultKeyOf —— 候选去重 / 「已添加」标记键', () => {
    it('有 id 的（影视 / 书 / 游 / 音 / 动画）用 `id|title`', () => {
        expect(resultKeyOf(cand({ id: 42, title: '熊出没·重返地球' }))).toBe('42|熊出没·重返地球');
        expect(resultKeyOf(cand({ id: 'douban:123', title: '活着' }))).toBe('douban:123|活着');
    });

    it('没有 id 的退回标题（两段都要在：同名不同 id 不能撞成一个键）', () => {
        expect(resultKeyOf(cand({ title: '无名' }))).toBe('无名|无名');
        expect(resultKeyOf(cand({ id: 1, title: '同名' }))).toBe('1|同名');
        expect(resultKeyOf(cand({ id: 2, title: '同名' }))).not.toBe(resultKeyOf(cand({ id: 1, title: '同名' })));
    });

    it('同一条候选连续两次求值稳定（否则「已添加」会自己掉）', () => {
        const r = cand({ id: 7, title: 'X' });
        expect(resultKeyOf(r)).toBe(resultKeyOf(r));
    });
});

describe('nextSeriesIndexLabel —— 序号自动 +1（唯一算法）', () => {
    it('纯数字 +1（含两侧空白）', () => {
        expect(nextSeriesIndexLabel('1')).toBe('2');
        expect(nextSeriesIndexLabel('12')).toBe('13');
        expect(nextSeriesIndexLabel(' 3 ')).toBe('4');
        expect(nextSeriesIndexLabel('0')).toBe('1');
    });

    it('空 / 空白 ⇒ **原样**（没填序号就不自动编 —— 用户没打算编号）', () => {
        expect(nextSeriesIndexLabel('')).toBe('');
        expect(nextSeriesIndexLabel('   ')).toBe('   ');
        expect(nextSeriesIndexLabel(undefined as unknown as string)).toBe(undefined);
    });

    it('非纯数字 ⇒ 原样（⛔ 不猜：「2.5」「-1」「第3部」「abc」都不是序号）', () => {
        expect(nextSeriesIndexLabel('abc')).toBe('abc');
        expect(nextSeriesIndexLabel('2.5')).toBe('2.5');
        expect(nextSeriesIndexLabel('-1')).toBe('-1');
        expect(nextSeriesIndexLabel('第3部')).toBe('第3部');
        expect(nextSeriesIndexLabel('1a')).toBe('1a');
    });

    it('🔴 超长数字 ⇒ 原样（`Number` 精度会悄悄改数：10 位以上宁可不加）', () => {
        expect(nextSeriesIndexLabel('999999999999999999999')).toBe('999999999999999999999');
        expect(nextSeriesIndexLabel('1234567890')).toBe('1234567890');
        expect(nextSeriesIndexLabel('123456789')).toBe('123456790'); // 9 位仍精确
    });
});

describe('两处文案 —— 新建态与编辑态必须不同', () => {
    it('提交钮：新建说「保存并继续」，编辑照旧「更新笔记」', () => {
        expect(submitLabel(true)).toBe('保存并继续');
        expect(submitLabel(false)).toBe('更新笔记');
    });

    it('候选列表头部提示：新建承诺「保存后回到这里」，编辑仍是原句', () => {
        expect(repeatHint(true)).toContain('保存后回到这里');
        expect(repeatHint(false)).toBe('点击卡片回填 · 点击空白取消 · 徽标直达来源');
        expect(repeatHint(true)).not.toBe(repeatHint(false));
    });
});
