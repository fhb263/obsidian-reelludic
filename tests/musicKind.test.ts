// 音乐子分类（音乐 / 其他）纯逻辑单测：normalize 兜底 + 匹配 + 计数 + 量词
// 缺省归「music」（展示为「音乐」；用户 2026-09-12 需求）：未指定 musicKind 的存量音乐不丢失
import { describe, it, expect } from 'vitest';
import type { MusicKind } from 'data/types';
import { MUSIC_KINDS, MUSIC_KIND_LABELS, MUSIC_KIND_UNITS, normalizeMusicKind, matchesMusicKind, musicKindCounts } from 'pure/musicKind';

describe('normalizeMusicKind 合法值归一（缺省 → 音乐）', () => {
    it('合法值原样返回', () => {
        expect(normalizeMusicKind('music')).toBe('music');
        expect(normalizeMusicKind('other')).toBe('other');
    });
    it('缺省 / 空值 / 损坏数据一律归 music', () => {
        expect(normalizeMusicKind(undefined)).toBe('music');
        expect(normalizeMusicKind(null)).toBe('music');
        expect(normalizeMusicKind('')).toBe('music');
        expect(normalizeMusicKind('podcast')).toBe('music');
        expect(normalizeMusicKind(123)).toBe('music');
    });
    it('原型链属性名不误判合法（toString / constructor）', () => {
        expect(normalizeMusicKind('toString')).toBe('music');
        expect(normalizeMusicKind('constructor')).toBe('music');
    });
});

describe('matchesMusicKind 分类匹配', () => {
    // 工厂返回放宽为宽类型（bogus 损坏值用例需要传任意 string，再整体断言成目标形状）
    const e = (over: Partial<{ type: string; musicKind: string }> = {}) =>
        ({ type: 'music', ...over } as { type: string; musicKind?: MusicKind });
    it("'all' 恒命中（含非 music 类型）", () => {
        expect(matchesMusicKind(e(), 'all')).toBe(true);
        expect(matchesMusicKind({ type: 'book' }, 'all')).toBe(true);
    });
    it('显式 kind 时非 music 类型不命中（防语义漏出）', () => {
        expect(matchesMusicKind({ type: 'book' }, 'other')).toBe(false);
        expect(matchesMusicKind({ type: 'movie' }, 'music')).toBe(false);
    });
    it('缺省条目落音乐桶，显式 other 落其他桶', () => {
        expect(matchesMusicKind(e(), 'music')).toBe(true);
        expect(matchesMusicKind(e({ musicKind: 'other' }), 'other')).toBe(true);
        expect(matchesMusicKind(e({ musicKind: 'other' }), 'music')).toBe(false);
    });
    it('损坏 musicKind 归一后按音乐桶匹配', () => {
        expect(matchesMusicKind(e({ musicKind: 'bogus' }), 'music')).toBe(true);
        expect(matchesMusicKind(e({ musicKind: 'bogus' }), 'other')).toBe(false);
    });
});

describe('musicKindCounts 三桶计数（只统计 music 类型）', () => {
    it('混合条目计数：缺省归音乐桶，all = music 总数', () => {
        const entries = [
            { type: 'music' },                            // 缺省 → 音乐
            { type: 'music', musicKind: 'music' },        // 显式音乐
            { type: 'music', musicKind: 'other' },        // 其他
            { type: 'music', musicKind: 'other' },        // 其他
            { type: 'music', musicKind: 'bogus' },        // 损坏 → 音乐
            { type: 'book' },                             // 非音乐不参与
            { type: 'movie' },                            // 非音乐不参与
        ] as ReadonlyArray<{ type: string; musicKind?: MusicKind }>;
        expect(musicKindCounts(entries)).toEqual({ all: 5, music: 3, other: 2 });
    });
    it('空数组全零', () => {
        expect(musicKindCounts([])).toEqual({ all: 0, music: 0, other: 0 });
    });
});

describe('常量与量词', () => {
    it('MUSIC_KINDS 顺序稳定（chips 顺序依据）', () => {
        expect(MUSIC_KINDS).toEqual(['music', 'other']);
    });
    it('MUSIC_KIND_LABELS 展示名', () => {
        expect(MUSIC_KIND_LABELS).toEqual({ music: '音乐', other: '其他' });
    });
    it('MUSIC_KIND_UNITS 量词（5 首音乐 / 5 项其他 / 全部用项）', () => {
        expect(MUSIC_KIND_UNITS).toEqual({ all: '项', music: '首', other: '项' });
    });
});
