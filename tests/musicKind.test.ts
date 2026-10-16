// 音乐子分类纯逻辑单测：1.0.3.1 起音乐不再分子类（用户 2026-09-13 裁定删除「其他」）
// 合法值仅 music；存量 other / 损坏值一律归一为 music（条目不丢，只并入音乐）——本文件锁这条归一
import { describe, it, expect } from 'vitest';
import { MUSIC_KINDS, normalizeMusicKind } from 'pure/musicKind';

describe('normalizeMusicKind 合法值归一（缺省 → 音乐）', () => {
    it('合法值原样返回', () => {
        expect(normalizeMusicKind('music')).toBe('music');
    });
    it('已下线的 other 归「music」（其他子分类删除后存量数据并入音乐）', () => {
        expect(normalizeMusicKind('other')).toBe('music');
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

describe('常量定义', () => {
    it('MUSIC_KINDS 单一合法值（页签子分类行已下线，不再有 chips 顺序概念）', () => {
        expect(MUSIC_KINDS).toEqual(['music']);
    });
});
