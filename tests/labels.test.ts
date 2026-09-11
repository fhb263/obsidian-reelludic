// 状态文案按类型映射（书/游戏专属语义，内部仍四态）
import { describe, it, expect } from 'vitest';
import { statusLabel, statusVerb, reviewLabel, isTrackingType, overviewUnitLabel } from 'pure/labels';
import { ENTRY_TYPES } from 'data/types';


describe('statusLabel 按类型映射', () => {
    it('影视/动画用影视文案', () => {
        expect(statusLabel('movie', 'want')).toBe('想看');
        expect(statusLabel('movie', 'watching')).toBe('在看');
        expect(statusLabel('movie', 'watched')).toBe('已看');
        expect(statusLabel('tv', 'watched')).toBe('已看');
        expect(statusLabel('anime', 'watched')).toBe('已看');
    });

    it('书籍用阅读文案', () => {
        expect(statusLabel('book', 'want')).toBe('想读');
        expect(statusLabel('book', 'watching')).toBe('在读');
        expect(statusLabel('book', 'watched')).toBe('已读');
    });

    it('游戏用游玩文案', () => {
        expect(statusLabel('game', 'want')).toBe('想玩');
        expect(statusLabel('game', 'watching')).toBe('在玩');
        expect(statusLabel('game', 'watched')).toBe('通关');
    });

    it('音乐状态文案：想听/在听/已听/存档', () => {
        expect(statusLabel('music', 'want')).toBe('想听');
        expect(statusLabel('music', 'watching')).toBe('在听');
        expect(statusLabel('music', 'watched')).toBe('已听');
        expect(statusLabel('music', 'archived')).toBe('存档');
    });

    it('存档全类型统一文案（归档语义，无类型区分）', () => {
        expect(statusLabel('movie', 'archived')).toBe('存档');
        expect(statusLabel('anime', 'archived')).toBe('存档');
        expect(statusLabel('book', 'archived')).toBe('存档');
        expect(statusLabel('game', 'archived')).toBe('存档');
    });
});

describe('statusVerb 状态区动词按类型映射', () => {
    it('影视/动画用「观看」', () => {
        expect(statusVerb('movie')).toBe('观看');
        expect(statusVerb('tv')).toBe('观看');
        expect(statusVerb('anime')).toBe('观看');
    });

    it('书籍用「阅读」', () => {
        expect(statusVerb('book')).toBe('阅读');
    });

    it('游戏用「游玩」', () => {
        expect(statusVerb('game')).toBe('游玩');
    });

    it('音乐用「收听」', () => {
        expect(statusVerb('music')).toBe('收听');
    });
});

describe('reviewLabel 评语 placeholder 按类型映射', () => {
    it('影视/动画用「观后感」', () => {
        expect(reviewLabel('movie')).toBe('观后感');
        expect(reviewLabel('tv')).toBe('观后感');
        expect(reviewLabel('anime')).toBe('观后感');
    });

    it('书籍用「读后感」', () => {
        expect(reviewLabel('book')).toBe('读后感');
    });

    it('游戏用「游玩体验」', () => {
        expect(reviewLabel('game')).toBe('游玩体验');
    });

    it('音乐用「收听感受」', () => {
        expect(reviewLabel('music')).toBe('收听感受');
    });
});

describe('isTrackingType 追更范围', () => {
    it('仅剧集与动画可追更', () => {
        expect(isTrackingType('tv')).toBe(true);
        expect(isTrackingType('anime')).toBe(true);
        expect(isTrackingType('movie')).toBe(false);
        expect(isTrackingType('book')).toBe(false);
        expect(isTrackingType('game')).toBe(false);
    });
});

describe('overviewUnitLabel 概览量词（顶部「N X」的单位）', () => {
    it('各类型给专属量词', () => {
        expect(overviewUnitLabel('book')).toBe('本书');
        expect(overviewUnitLabel('game')).toBe('款游戏');
        expect(overviewUnitLabel('movie')).toBe('部电影');
        expect(overviewUnitLabel('tv')).toBe('部电视剧');
        expect(overviewUnitLabel('anime')).toBe('部动画');
        // 回归锁定：音乐页签曾因漏映射落到兜底，顶部显示成「8 项媒体」而非「8 首音乐」
        expect(overviewUnitLabel('music')).toBe('首音乐');
    });

    it('无类型（总库/聚合）回落「项媒体」', () => {
        expect(overviewUnitLabel(null)).toBe('项媒体');
    });

    it('穷举 ENTRY_TYPES：每个类型都必须有专属量词，不得落兜底', () => {
        // 这条锁的价值在于「将来新增类型却忘了配量词」会直接测试失败，
        // 而不是上线后才发现顶部写成「N 项媒体」
        for (const t of ENTRY_TYPES) {
            expect(overviewUnitLabel(t), `类型 ${t} 缺少专属量词`).not.toBe('项媒体');
        }
    });
});
