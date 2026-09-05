// 通用 JSON 防御工具纯逻辑测试：asRecord（任意值安全转对象）+ parseYear（日期字符串提取年份）
import { describe, it, expect } from 'vitest';
import { asRecord, parseYear } from 'pure/record';

describe('asRecord（任意值安全转对象）', () => {
    it('对象原样返回', () => {
        const o = { a: 1 };
        expect(asRecord(o)).toBe(o);
    });

    it('null / undefined → 空对象', () => {
        expect(asRecord(null)).toEqual({});
        expect(asRecord(undefined)).toEqual({});
    });

    it('原始值（number/string/boolean）→ 空对象', () => {
        expect(asRecord(42)).toEqual({});
        expect(asRecord('str')).toEqual({});
        expect(asRecord(true)).toEqual({});
    });

    it('数组保持原引用（行为与旧定义一致：typeof [] === object 直接 cast）', () => {
        const arr = [1, 2];
        expect(asRecord(arr)).toBe(arr);
    });
});

describe('parseYear（日期字符串提取年份）', () => {
    it('标准日期取 YYYY 前缀', () => {
        expect(parseYear('2024-05-01')).toBe(2024);
        expect(parseYear('2024')).toBe(2024);
    });

    it('YYYY 前缀后跟任意内容仍取前缀（与旧正则 /^(\\d{4})/ 一致）', () => {
        expect(parseYear('2024abc')).toBe(2024);
    });

    it('非字符串（number/null/undefined/对象）→ undefined', () => {
        expect(parseYear(2024)).toBeUndefined();
        expect(parseYear(null)).toBeUndefined();
        expect(parseYear(undefined)).toBeUndefined();
        expect(parseYear({ year: 2024 })).toBeUndefined();
    });

    it('无 YYYY 前缀或空串 → undefined', () => {
        expect(parseYear('abc')).toBeUndefined();
        expect(parseYear('')).toBeUndefined();
        expect(parseYear('95-01-01')).toBeUndefined();
    });
});
