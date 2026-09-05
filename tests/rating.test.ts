import { describe, it, expect } from 'vitest';
import { normalizeRating, starString, starClass } from 'pure/rating';

describe('pure/rating 评分', () => {
    it('normalizeRating 钳制到 1~5，非法归 0', () => {
        expect(normalizeRating(4)).toBe(4);
        expect(normalizeRating(0)).toBe(0);
        expect(normalizeRating(5)).toBe(5);
        expect(normalizeRating(-3)).toBe(0);
        expect(normalizeRating(9)).toBe(5);
        expect(normalizeRating(3.6)).toBe(4);
        expect(normalizeRating('x' as unknown)).toBe(0);
        expect(normalizeRating(undefined)).toBe(0);
    });

    it('starString 生成星级字符串', () => {
        expect(starString(0)).toBe('☆☆☆☆☆');
        expect(starString(3)).toBe('★★★☆☆');
        expect(starString(5)).toBe('★★★★★');
    });

    it('starClass 评分热度分档：≥4 金 / 1~3 灰 / 0 未评分淡灰', () => {
        expect(starClass(5)).toBe('rl-stars-hot');
        expect(starClass(4)).toBe('rl-stars-hot');
        expect(starClass(3)).toBe('rl-stars-mid');
        expect(starClass(1)).toBe('rl-stars-mid');
        expect(starClass(0)).toBe('rl-stars-none');
    });
});
