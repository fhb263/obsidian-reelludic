// 阅读主题档位纯逻辑测试：档位表顺序、归一兜底（含原型链污染）、CSS 类名映射。
import { describe, it, expect } from 'vitest';
import {
    READER_THEMES,
    DEFAULT_READER_THEME,
    normalizeReaderTheme,
    readerThemeClass,
} from 'pure/readerTheme';

describe('pure/readerTheme 档位表', () => {
    it('六档：跟随 + 五种阅读主题，跟随恒在首位', () => {
        expect(READER_THEMES.map((t) => t.id)).toEqual(['follow', 'light', 'dark', 'green', 'gray', 'sepia']);
        expect(READER_THEMES.map((t) => t.label)).toEqual(['跟随主题', '经典白', '夜间黑', '护眼绿', '深灰', '羊皮纸']);
    });
    it('缺省档 = follow（不改变现有观感）', () => {
        expect(DEFAULT_READER_THEME).toBe('follow');
    });
});

describe('pure/readerTheme normalizeReaderTheme', () => {
    it('合法档位直通', () => {
        for (const t of READER_THEMES) expect(normalizeReaderTheme(t.id)).toBe(t.id);
    });
    it('脏数据/undefined/null/数字 → follow', () => {
        expect(normalizeReaderTheme(undefined)).toBe('follow');
        expect(normalizeReaderTheme(null)).toBe('follow');
        expect(normalizeReaderTheme('')).toBe('follow');
        expect(normalizeReaderTheme('violet')).toBe('follow');
        expect(normalizeReaderTheme(3)).toBe('follow');
        expect(normalizeReaderTheme({})).toBe('follow');
    });
    it('原型链上的自有键名不得穿透（toString/constructor 等）', () => {
        expect(normalizeReaderTheme('toString')).toBe('follow');
        expect(normalizeReaderTheme('constructor')).toBe('follow');
        expect(normalizeReaderTheme('hasOwnProperty')).toBe('follow');
    });
});

describe('pure/readerTheme readerThemeClass', () => {
    it('各档位 → 容器类名；follow 不挂类（继承 Obsidian 主题）', () => {
        expect(readerThemeClass('follow')).toBe('');
        expect(readerThemeClass('light')).toBe('rl-rt-light');
        expect(readerThemeClass('dark')).toBe('rl-rt-dark');
        expect(readerThemeClass('green')).toBe('rl-rt-green');
        expect(readerThemeClass('gray')).toBe('rl-rt-gray');
        expect(readerThemeClass('sepia')).toBe('rl-rt-sepia');
    });
    it('非法输入 → 空串（按 follow 处理）', () => {
        expect(readerThemeClass('nope' as never)).toBe('');
        expect(readerThemeClass(undefined as never)).toBe('');
    });
    it('全部非 follow 档都有类名（防新增档位漏 CSS 钩子）', () => {
        for (const t of READER_THEMES) {
            if (t.id === 'follow') continue;
            expect(readerThemeClass(t.id)).not.toBe('');
        }
    });
});
