import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    formatCharCount,
    clampTocWidth,
    tocWidthValue,
    TOC_WIDTH_VAR,
    TOC_WIDTH_MIN,
    TOC_WIDTH_MAX,
    overflowFlags,
    tocWidthKey,
    loadTocWidth,
    TOC_WIDTH_KEY,
} from 'pure/readerToc';

describe('formatCharCount（目录字数展示，#338）', () => {
    it('小于一万 → 原样数字', () => {
        expect(formatCharCount(0)).toBe('0');
        expect(formatCharCount(320)).toBe('320');
        expect(formatCharCount(9999)).toBe('9999');
    });

    it('一万以上 → 「x.x万」（整数万不带 .0）', () => {
        expect(formatCharCount(10000)).toBe('1万');
        expect(formatCharCount(12300)).toBe('1.2万');
        expect(formatCharCount(345600)).toBe('34.6万');
        expect(formatCharCount(1000000)).toBe('100万');
    });

    it('非法值 → 空串（不显示）', () => {
        expect(formatCharCount(NaN)).toBe('');
        expect(formatCharCount(-5)).toBe('');
    });
});

describe('clampTocWidth（目录侧栏拖宽的夹取，#338）', () => {
    it('夹在最小/最大之间', () => {
        expect(clampTocWidth(100)).toBe(TOC_WIDTH_MIN);
        expect(clampTocWidth(300)).toBe(300);
        expect(clampTocWidth(9999)).toBe(TOC_WIDTH_MAX);
    });

    it('非法值回退缺省 220（与原定宽一致）', () => {
        expect(clampTocWidth(NaN)).toBe(220);
    });
});

describe('tocWidthValue（#339：宽度走 CSS 变量，行内绝不写 style.width）', () => {
    it('产出裸长度值（配合 setProperty(`--rl-toc-w`, …)），且已夹取', () => {
        expect(TOC_WIDTH_VAR).toBe('--rl-toc-w');
        expect(tocWidthValue(260)).toBe('260px');
        expect(tocWidthValue(100)).toBe(`${TOC_WIDTH_MIN}px`);
        expect(tocWidthValue(9999)).toBe(`${TOC_WIDTH_MAX}px`);
    });

    it('🔴 必须是**裸长度值**而不是一条 `width` 声明（行内 width 会顶死 `.collapsed { width: 0 }` ⇒ 侧栏收不起来）', () => {
        expect(tocWidthValue(260)).toMatch(/^\d+px$/);
        expect(tocWidthValue(NaN)).toBe('220px');
    });
});

describe('tocWidthKey / loadTocWidth（🔴 2026-10-24 用户：四个阅读器的侧栏各自独立、互不同步）', () => {
    // 测试环境是 node（没有 localStorage），这里塞一个内存替身；用完必删，免得污染其它用例
    const stub = (): Map<string, string> => {
        const mem = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
            setItem: (k: string, v: string) => void mem.set(k, v),
        });
        return mem;
    };
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('四个阅读器拿到四个互不相同的键，且都带统一前缀', () => {
        const keys = (['txt', 'epub', 'pdf', 'comic'] as const).map(tocWidthKey);
        expect(new Set(keys).size).toBe(4);
        for (const k of keys) expect(k.startsWith(`${TOC_WIDTH_KEY}:`)).toBe(true);
        expect(tocWidthKey('comic')).not.toBe(tocWidthKey('txt'));
    });

    it('🔴 在漫画里存的宽度，TXT 读不出来（这正是"不同步"的可测口径）', () => {
        const mem = stub();
        mem.set(tocWidthKey('comic'), '300');
        expect(loadTocWidth('comic')).toBe(300);
        expect(loadTocWidth('txt')).toBeNull();
        expect(loadTocWidth('pdf')).toBeNull();
        expect(loadTocWidth('epub')).toBeNull();
    });

    it('本阅读器没存过 → 回退读旧版全局键（升级用户不丢已调好的宽度）', () => {
        const mem = stub();
        mem.set(TOC_WIDTH_KEY, '260');
        expect(loadTocWidth('txt')).toBe(260);
        expect(loadTocWidth('comic')).toBe(260);
    });

    it('本阅读器自己存过 → 优先自己的，旧全局键不再干扰', () => {
        const mem = stub();
        mem.set(TOC_WIDTH_KEY, '260');
        mem.set(tocWidthKey('pdf'), '180');
        expect(loadTocWidth('pdf')).toBe(180);
        expect(loadTocWidth('txt')).toBe(260);
    });

    it('存进来的越界值仍按 clampTocWidth 夹取（老数据不让侧栏撑爆）', () => {
        const mem = stub();
        mem.set(tocWidthKey('epub'), '9999');
        expect(loadTocWidth('epub')).toBe(TOC_WIDTH_MAX);
        mem.set(tocWidthKey('txt'), '10');
        expect(loadTocWidth('txt')).toBe(TOC_WIDTH_MIN);
    });

    it('localStorage 不可用 → 返回 null（由调用方回退 CSS 定宽），不抛错', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => undefined,
        });
        expect(loadTocWidth('txt')).toBeNull();
    });
});

describe('overflowFlags（侧栏门控溢出渐隐的判据，书签「显示不全」）', () => {
    it('内容不溢出（scrollHeight == clientHeight）→ 两端都不挂，一条遮罩都不给', () => {
        expect(overflowFlags(0, 766, 766)).toEqual({ start: false, end: false });
    });

    it('溢出且在顶部 → 只有下端挂（提示"下面还有"）', () => {
        expect(overflowFlags(0, 766, 908)).toEqual({ start: false, end: true });
    });

    it('滚到中段 → 两端都挂（四停渐变）', () => {
        expect(overflowFlags(71, 766, 908)).toEqual({ start: true, end: true });
    });

    it('🔴 滚到底 → 下端必须撤掉，否则会在最后一行上方撒谎', () => {
        expect(overflowFlags(142, 766, 908)).toEqual({ start: true, end: false });
    });

    it('亚像素容差：只溢出 1px 或离端点 1px 内都不算（避免边缘闪烁）', () => {
        expect(overflowFlags(0, 766, 767)).toEqual({ start: false, end: false });
        expect(overflowFlags(141, 766, 908)).toEqual({ start: true, end: false });
        expect(overflowFlags(1, 766, 908)).toEqual({ start: false, end: true });
    });
});
