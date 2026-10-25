// 剪贴板读取与粘贴文本清洗测试（#446「粘贴」按钮）
import { describe, it, expect } from 'vitest';
import { cleanPastedText, readClipboardText } from 'services/clipboard';

describe('cleanPastedText 粘贴文本清洗', () => {
    it('去首尾空白；只取第一行（复制地址常带换行）', () => {
        expect(cleanPastedText('  https://a.com/x  ')).toBe('https://a.com/x');
        expect(cleanPastedText('https://a.com/x\n复制自某处')).toBe('https://a.com/x');
        expect(cleanPastedText('https://a.com/x\r\n第二行')).toBe('https://a.com/x');
    });

    it('剥掉成对包裹的引号 / 尖括号（Markdown 链接与地址栏复制）', () => {
        expect(cleanPastedText('<https://a.com/x>')).toBe('https://a.com/x');
        expect(cleanPastedText('"https://a.com/x"')).toBe('https://a.com/x');
        expect(cleanPastedText("'https://a.com/x'")).toBe('https://a.com/x');
        expect(cleanPastedText('（https://a.com/x）')).toBe('https://a.com/x');
        expect(cleanPastedText('(https://a.com/x)')).toBe('https://a.com/x');
    });

    it('不成对 / 太短 / 非法输入一律不乱动', () => {
        expect(cleanPastedText('<https://a.com/x')).toBe('<https://a.com/x');
        expect(cleanPastedText('x')).toBe('x');
        expect(cleanPastedText('')).toBe('');
        expect(cleanPastedText(undefined as unknown as string)).toBe('');
    });
});

// ⚠️ Node 21+ 自带 `navigator`（只有 userAgent、没有 clipboard），且它是**访问器属性** ⇒
//    直接 `globalThis.navigator = …` 在严格模式下会抛（无 setter）⇒ 一律用 defineProperty 换掉再还原。
function withNavigator<T>(nav: unknown, fn: () => Promise<T>): Promise<T> {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    return fn().finally(() => {
        if (desc) Object.defineProperty(globalThis, 'navigator', desc);
        else delete (globalThis as { navigator?: unknown }).navigator;
    });
}

describe('readClipboardText 读剪贴板', () => {
    it('没有 navigator.clipboard（移动端 / 旧运行时）→ undefined（调用方提示手动粘贴）', async () => {
        await withNavigator({ userAgent: 'test' }, async () => {
            expect(await readClipboardText()).toBeUndefined();
        });
    });

    it('readText 抛错（无权限 / 非安全上下文）→ undefined，不把异常抛给调用方', async () => {
        await withNavigator({ clipboard: { readText: () => Promise.reject(new Error('denied')) } }, async () => {
            expect(await readClipboardText()).toBeUndefined();
        });
    });

    it('正常返回字符串 → 原样给出（清洗交给 cleanPastedText）', async () => {
        await withNavigator({ clipboard: { readText: () => Promise.resolve('  https://a.com  ') } }, async () => {
            expect(await readClipboardText()).toBe('  https://a.com  ');
        });
    });

    it('readText 返回非字符串 → undefined', async () => {
        await withNavigator({ clipboard: { readText: () => Promise.resolve(42) } }, async () => {
            expect(await readClipboardText()).toBeUndefined();
        });
    });
});
