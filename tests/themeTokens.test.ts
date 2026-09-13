import { describe, it, expect } from 'vitest';
import { normalizeUiTheme, indicatorTransform, THEME_CLASS } from 'pure/themeTokens';

describe('normalizeUiTheme', () => {
    it('透传合法值', () => {
        expect(normalizeUiTheme('native')).toBe('native');
        expect(normalizeUiTheme('modern')).toBe('modern');
    });
    it('旧用户升级：undefined / null / 空串 回退 native', () => {
        expect(normalizeUiTheme(undefined)).toBe('native');
        expect(normalizeUiTheme(null)).toBe('native');
        expect(normalizeUiTheme('')).toBe('native');
    });
    it('损坏数据（乱码 / 数字 / 对象）回退 native', () => {
        expect(normalizeUiTheme('dark')).toBe('native');
        expect(normalizeUiTheme(3)).toBe('native');
        expect(normalizeUiTheme({})).toBe('native');
        expect(normalizeUiTheme([])).toBe('native');
    });
    it('大写不宽松匹配（避免歧义数据静默生效）', () => {
        expect(normalizeUiTheme('Modern')).toBe('native');
        expect(normalizeUiTheme('MODERN')).toBe('native');
    });
    it('原型链键名不得穿透（in 会沿原型链查找，必须只认自有键）', () => {
        // 回归：曾用 `raw in THEME_CLASS` 实现 → 'toString' in {native,modern} 为 true
        // → normalizeUiTheme('toString') 返回 'toString'，损坏数据反而穿透下去
        expect(normalizeUiTheme('toString')).toBe('native');
        expect(normalizeUiTheme('constructor')).toBe('native');
        expect(normalizeUiTheme('valueOf')).toBe('native');
        expect(normalizeUiTheme('hasOwnProperty')).toBe('native');
        expect(normalizeUiTheme('__proto__')).toBe('native');
        expect(normalizeUiTheme('isPrototypeOf')).toBe('native');
    });
});

describe('indicatorTransform', () => {
    it('返回完整内联样式：必须带 transform: 属性名（回归：曾缺前缀被浏览器静默丢弃 → 指示器不动）', () => {
        expect(indicatorTransform(0, 48, 5)).toBe('transform:translateX(0px);width:48px');
    });
    it('常规项：offset 减 padding 后位移', () => {
        expect(indicatorTransform(60, 56, 5)).toBe('transform:translateX(55px);width:56px');
    });
    it('padding 大于 offset 时不产生负位移（钳到 0）', () => {
        expect(indicatorTransform(3, 40, 5)).toBe('transform:translateX(0px);width:40px');
    });
    it('宽度为 0 的边界：仍返回合法串', () => {
        expect(indicatorTransform(20, 0, 5)).toBe('transform:translateX(15px);width:0px');
    });
    it('小数四舍五入到整数像素（避免亚像素抖动）', () => {
        expect(indicatorTransform(60.4, 55.6, 5)).toBe('transform:translateX(55px);width:56px');
    });
    it('非有限输入退化为 0，不产出 NaNpx', () => {
        expect(indicatorTransform(NaN, 56, 5)).toBe('transform:translateX(0px);width:56px');
        expect(indicatorTransform(Infinity, 56, 5)).toBe('transform:translateX(0px);width:56px');
        expect(indicatorTransform(60, NaN, 5)).toBe('transform:translateX(55px);width:0px');
        // pad 为 NaN → 收口为 0（不减偏移），故 x = 60 而非 55
        expect(indicatorTransform(60, 56, NaN)).toBe('transform:translateX(60px);width:56px');
    });
    it('负数宽度钳到 0（不产出非法 CSS）', () => {
        expect(indicatorTransform(60, -5, 5)).toBe('transform:translateX(55px);width:0px');
    });
    it('pad 为 0（无内边距容器）不减偏移', () => {
        expect(indicatorTransform(60, 56, 0)).toBe('transform:translateX(60px);width:56px');
    });
});

describe('THEME_CLASS', () => {
    it('native 不挂类（保持 1.0.2 观感），modern 挂 rl-theme-modern', () => {
        expect(THEME_CLASS.native).toBe('');
        expect(THEME_CLASS.modern).toBe('rl-theme-modern');
    });
});
