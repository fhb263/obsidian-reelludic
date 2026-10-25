// 阅读器翻页纯换算测试：页 index ↔ scrollRatio 互转、步进、边界。
import { describe, it, expect } from 'vitest';
import { clampRatio, clampPage, pageToRatio, ratioToPage, pageStep, isLastPage, isFirstPage, normalizeScrollMode } from 'pure/paged';

describe('pure/paged normalizeScrollMode', () => {
    it('paged/continuous 直通，脏数据/undefined → continuous', () => {
        expect(normalizeScrollMode('paged')).toBe('paged');
        expect(normalizeScrollMode('continuous')).toBe('continuous');
        expect(normalizeScrollMode(undefined)).toBe('continuous');
        expect(normalizeScrollMode('x')).toBe('continuous');
        expect(normalizeScrollMode(null)).toBe('continuous');
    });
});

describe('pure/paged clampRatio / clampPage', () => {
    it('clampRatio 钳到 [0,1]，NaN/Infinity → 0', () => {
        expect(clampRatio(-1)).toBe(0);
        expect(clampRatio(0)).toBe(0);
        expect(clampRatio(0.5)).toBe(0.5);
        expect(clampRatio(1)).toBe(1);
        expect(clampRatio(2)).toBe(1);
        expect(clampRatio(Number.NaN)).toBe(0);
        expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
    });
    it('clampPage 钳到 [0,total−1]，负数/越界归位', () => {
        expect(clampPage(-1, 5)).toBe(0);
        expect(clampPage(0, 5)).toBe(0);
        expect(clampPage(4, 5)).toBe(4);
        expect(clampPage(9, 5)).toBe(4);
        expect(clampPage(3, 1)).toBe(0);
        expect(clampPage(1.9, 5)).toBe(1); // floor
    });
});

describe('pure/paged pageToRatio / ratioToPage', () => {
    it('单页（totalPages≤1）→ ratio 恒 0、页恒 0', () => {
        expect(pageToRatio(0, 1)).toBe(0);
        expect(pageToRatio(0, 0)).toBe(0);
        expect(ratioToPage(1, 1)).toBe(0);
        expect(ratioToPage(0.5, 1)).toBe(0);
    });
    it('首尾映射：第 0 页→0，末页(total−1)→1', () => {
        expect(pageToRatio(0, 10)).toBe(0);
        expect(pageToRatio(9, 10)).toBe(1);
    });
    it('中页等分：页 i → i/(total−1)', () => {
        expect(pageToRatio(2, 10)).toBeCloseTo(2 / 9);
        expect(pageToRatio(5, 6)).toBeCloseTo(1); // 末页
    });
    it('ratio→页最近取整：0.5 → 中页', () => {
        expect(ratioToPage(0, 10)).toBe(0);
        expect(ratioToPage(1, 10)).toBe(9);
        expect(ratioToPage(0.5, 10)).toBe(5); // round(0.5*9)=round(4.5)=5
        expect(ratioToPage(0.3, 10)).toBe(3); // round(0.3*9)=round(2.7)=3
    });
    it('越界比例钳制', () => {
        expect(ratioToPage(2, 10)).toBe(9);
        expect(ratioToPage(-1, 10)).toBe(0);
    });
    it('round-trip：page→ratio→page 自洽', () => {
        for (let i = 0; i < 12; i++) expect(ratioToPage(pageToRatio(i, 12), 12)).toBe(i);
    });
});

describe('pure/paged pageStep / isFirstPage / isLastPage', () => {
    it('步进越界钳到首/末', () => {
        expect(pageStep(0, 10, -1)).toBe(0);
        expect(pageStep(9, 10, 1)).toBe(9);
        expect(pageStep(3, 10, 2)).toBe(5);
        expect(pageStep(3, 10, -5)).toBe(0);
    });
    it('单页步进恒 0', () => {
        expect(pageStep(0, 1, 1)).toBe(0);
    });
    it('首/末页判定', () => {
        expect(isFirstPage(0)).toBe(true);
        expect(isFirstPage(1)).toBe(false);
        expect(isFirstPage(-1)).toBe(true);
        expect(isLastPage(9, 10)).toBe(true);
        expect(isLastPage(8, 10)).toBe(false);
        expect(isLastPage(0, 1)).toBe(true);
    });
});
