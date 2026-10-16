// 阅读器键位（#351）：空格 / ↑↓ 的解析与「正在打字就别抢键」的守卫。
//
// 为什么单独成模块：TXT / EPUB 两个阅读器各挂一份 keydown，判定若各写一遍必然漂移
// （项目里「模式 / 行宽」两行已经吃过这个亏）；这里收敛成一份纯函数，两个阅读器只负责调用。
import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveReaderHotkey } from 'pure/readerHotkeys';

describe('resolveReaderHotkey —— 空格', () => {
    it('朗读中 → 暂停 / 播放朗读（朗读优先于自动：两个都在跑时先管发声）', () => {
        expect(resolveReaderHotkey(' ', { ttsOn: true, autoOn: true })).toBe('tts-toggle');
        expect(resolveReaderHotkey(' ', { ttsOn: true, autoOn: false })).toBe('tts-toggle');
    });

    it('自动中（且没在朗读）→ 暂停 / 继续自动', () => {
        expect(resolveReaderHotkey(' ', { ttsOn: false, autoOn: true })).toBe('auto-toggle');
    });

    it('🔴 两者都没开 → 什么都不做（不能凭空开始朗读，空格也不该在阅读器里乱翻页）', () => {
        expect(resolveReaderHotkey(' ', { ttsOn: false, autoOn: false })).toBeNull();
    });

    it('兼容旧 WebKit 的 Spacebar 键名', () => {
        expect(resolveReaderHotkey('Spacebar', { ttsOn: true, autoOn: false })).toBe('tts-toggle');
    });
});

describe('resolveReaderHotkey —— ↑↓ 调速', () => {
    it('↑ 加速 / ↓ 减速（仅在自动运行时接管；不开自动时方向键交回宿主滚动）', () => {
        expect(resolveReaderHotkey('ArrowUp', { ttsOn: false, autoOn: true })).toBe('auto-faster');
        expect(resolveReaderHotkey('ArrowDown', { ttsOn: false, autoOn: true })).toBe('auto-slower');
    });

    it('🔴 没开自动 → 不接管（阅读器里 ↑↓ 另有卷动语义，别抢）', () => {
        expect(resolveReaderHotkey('ArrowUp', { ttsOn: false, autoOn: false })).toBeNull();
        expect(resolveReaderHotkey('ArrowDown', { ttsOn: false, autoOn: false })).toBeNull();
    });

    it('🔴 朗读中也不接管 ↑↓（语速改走弹窗；避免「一个键两个意思」）', () => {
        expect(resolveReaderHotkey('ArrowUp', { ttsOn: true, autoOn: true })).toBeNull();
        expect(resolveReaderHotkey('ArrowDown', { ttsOn: true, autoOn: true })).toBeNull();
    });
});

describe('resolveReaderHotkey —— 修饰键与无关键', () => {
    it('🔴 带 Ctrl / Meta / Alt 一律不接管（那是宿主与系统的快捷键）', () => {
        const ctx = { ttsOn: true, autoOn: true };
        expect(resolveReaderHotkey(' ', ctx, { ctrl: true })).toBeNull();
        expect(resolveReaderHotkey(' ', ctx, { meta: true })).toBeNull();
        expect(resolveReaderHotkey(' ', ctx, { alt: true })).toBeNull();
        expect(resolveReaderHotkey('ArrowUp', ctx, { ctrl: true })).toBeNull();
    });

    it('普通字母键不接管（阅读器不抢宿主按键）', () => {
        expect(resolveReaderHotkey('m', { ttsOn: true, autoOn: true })).toBeNull();
        expect(resolveReaderHotkey('Escape', { ttsOn: true, autoOn: true })).toBeNull();
    });
});

describe('isTypingTarget —— 正在输入就不抢键', () => {
    it('输入框 / 文本域 / 可编辑区 → true', () => {
        expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
        expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
        expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    });

    it('普通容器 / 空值 → false（null 也要能扛住：事件里 target 可能为空）', () => {
        expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
        expect(isTypingTarget(null)).toBe(false);
        expect(isTypingTarget(undefined)).toBe(false);
    });

    it('🔴 大小写不敏感（tagName 视文档类型可能是小写）', () => {
        expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    });
});
