// #636 ⑤ 漫画阅读器增强的纯逻辑测试：缩略图窗口/卸载 / 连续滚动的当前页 / 原文件名 / 模式归一。
import { describe, it, expect } from 'vitest';
import {
    COMIC_VIEW_MODES,
    COMIC_VIEW_MODE_LABELS,
    normalizeComicViewMode,
    thumbWindow,
    inThumbWindow,
    pruneThumbs,
    pageAtScroll,
    pagesToUnload,
    baseNameOf,
    thumbsVisible,
    comicViewModeOptions,
} from 'pure/comicViewer';
import { SCROLL_OPTIONS } from 'pure/readerTypography';

describe('#676 阅读模式文案 = 书籍阅读器同款「翻页 / 滚动」', () => {
    it('两档标签与书籍阅读器同一套用词（⛔ 别再用「单页 / 连续滚动」长名）', () => {
        // 🔴 2026-10-24：顺序改成 **滚动 → 翻页**，与 `SCROLL_OPTIONS`（书籍阅读器真源）逐项一致。
        //    此前是 ['single','scroll']（翻页在前）—— 漫画与另三个阅读器顺序相反，是「设置菜单不统一」的五处之一。
        expect(COMIC_VIEW_MODES).toEqual(['scroll', 'single']);
        expect(COMIC_VIEW_MODE_LABELS.single).toBe('翻页');
        expect(COMIC_VIEW_MODE_LABELS.scroll).toBe('滚动');
        expect(comicViewModeOptions()).toEqual([
            { value: 'scroll', label: '滚动' },
            { value: 'single', label: '翻页' },
        ]);
    });

    it('🔴 菜单顺序必须与书籍阅读器的 `SCROLL_OPTIONS` 逐项同序（防再次写反）', () => {
        const comic = comicViewModeOptions().map((o) => o.label);
        const book = SCROLL_OPTIONS.map((o) => o.label);
        expect(comic).toEqual(book);
    });

    it('🔴 只改文案、值不变：存储字段 `comicViewMode` 与 normalize 的行为一字不动', () => {
        // 老用户 data.json 里存的是 'single' / 'scroll' ⇒ 改文案绝不能让已有偏好失效
        expect(normalizeComicViewMode('scroll')).toBe('scroll');
        expect(normalizeComicViewMode('single')).toBe('single');
    });

    it('🔴 归一：未知 / 脏值一律回 **single**（那是 #537 起的既有行为 —— ⛔ 别默认成连续）', () => {
        expect(normalizeComicViewMode('scroll')).toBe('scroll');
        expect(normalizeComicViewMode('single')).toBe('single');
        expect(normalizeComicViewMode(undefined)).toBe('single');
        expect(normalizeComicViewMode(null)).toBe('single');
        expect(normalizeComicViewMode('')).toBe('single');
        expect(normalizeComicViewMode('SCROLL')).toBe('single');
        expect(normalizeComicViewMode(123)).toBe('single');
        expect(normalizeComicViewMode('constructor')).toBe('single');
    });
});

describe('#636 缩略图窗口（惰性生成 —— 200 页一次性解压会卡死）', () => {
    it('窗口 = 当前页前后各 radius 页', () => {
        expect(thumbWindow(50, 200, 6)).toEqual({ start: 44, end: 56 });
        expect(thumbWindow(0, 200, 6)).toEqual({ start: 0, end: 6 });
    });

    it('🔴 窗口按**总页数截断**（⛔ 不环绕：环状窗口在列表里看着像跳页）', () => {
        expect(thumbWindow(2, 100, 6)).toEqual({ start: 0, end: 8 });      // 头部不越界
        expect(thumbWindow(98, 100, 6)).toEqual({ start: 92, end: 99 });   // 尾部不越界
        expect(thumbWindow(-5, 100, 6)).toEqual({ start: 0, end: 6 });     // 脏值钳制
        expect(thumbWindow(999, 100, 6)).toEqual({ start: 93, end: 99 });
    });

    it('空库（total 0）⇒ 空窗口（end < start，视图据此不渲染任何格子）', () => {
        expect(thumbWindow(0, 0, 6)).toEqual({ start: 0, end: -1 });
        expect(inThumbWindow(0, 0, 0, 6)).toBe(false);
    });

    it('`inThumbWindow`：窗口内 true、窗口外 false（含边界）', () => {
        expect(inThumbWindow(50, 50, 200, 6)).toBe(true);
        expect(inThumbWindow(44, 50, 200, 6)).toBe(true);   // 左边界
        expect(inThumbWindow(56, 50, 200, 6)).toBe(true);   // 右边界
        expect(inThumbWindow(43, 50, 200, 6)).toBe(false);
        expect(inThumbWindow(57, 50, 200, 6)).toBe(false);
    });

    it('🔴 `pruneThumbs` 的保留窗口**必须比生成窗口大**（否则来回滚两下就反复重建 = 抖动）', () => {
        const cached = Array.from({ length: 200 }, (_, i) => i);
        // 默认 keepRadius=30 > radius=6：保留窗口更宽
        const kept = pruneThumbs(cached, 100, 200);
        expect(kept).toEqual(Array.from({ length: 61 }, (_, i) => i + 70)); // 70..130
        expect(kept.length).toBeGreaterThan(thumbWindow(100, 200, 6).end - thumbWindow(100, 200, 6).start + 1);
    });

    it('`pruneThumbs` 只保留视野附近的、丢远的；空缓存 ⇒ 空', () => {
        expect(pruneThumbs([], 50, 200)).toEqual([]);
        expect(pruneThumbs([0, 5, 50, 51, 199], 50, 200, 10)).toEqual([50, 51]);
        // 头部/尾部各不越界
        expect(pruneThumbs([0, 1, 2, 199], 0, 200, 10)).toEqual([0, 1, 2]);
    });
});

describe('#636 连续滚动：从滚动位置反推当前页', () => {
    // 四页，各页顶部偏移（第 1 页从 0 开始）
    const tops = [0, 300, 620, 900];

    it('🔴 判据 =「本页顶部已滚过」（⛔ 不是中心点命中 —— 两页交界处会跳）', () => {
        expect(pageAtScroll(tops, 0)).toBe(0);
        expect(pageAtScroll(tops, 299)).toBe(0);
        expect(pageAtScroll(tops, 300)).toBe(1);
        expect(pageAtScroll(tops, 619)).toBe(1);
        expect(pageAtScroll(tops, 620)).toBe(2);
        expect(pageAtScroll(tops, 900)).toBe(3);
        expect(pageAtScroll(tops, 5000)).toBe(3); // 滚过头 ⇒ 停在最后一页
    });

    it('退化安全：空数组 ⇒ 0；负值 / NaN ⇒ 归于第 0 页（⛔ 别抛也别返回 NaN）', () => {
        expect(pageAtScroll([], 100)).toBe(0);
        expect(pageAtScroll(tops, -10)).toBe(0);
        expect(pageAtScroll(tops, NaN)).toBe(0);
        expect(Number.isInteger(pageAtScroll(tops, NaN))).toBe(true);
    });

    it('**首尾**：正处在两页交界的**上边界**（恰好等于某页顶部）⇒ 就是那一页', () => {
        for (let i = 0; i < tops.length; i++) expect(pageAtScroll(tops, tops[i])).toBe(i);
    });
});

describe('#636 连续滚动：视野外的页要卸载（不卸 = 大漫画吃光内存）', () => {
    it('离当前页超过 keep 页的 ⇒ 该卸', () => {
        const unload = pagesToUnload(50, 200, 3);
        expect(unload(50)).toBe(false);
        expect(unload(47)).toBe(false); // 边界内
        expect(unload(53)).toBe(false);
        expect(unload(46)).toBe(true);  // 边界外
        expect(unload(54)).toBe(true);
        expect(unload(0)).toBe(true);
        expect(unload(199)).toBe(true);
    });

    it('头部/尾部钳制：脏 current 不越界', () => {
        expect(pagesToUnload(-5, 10, 3)(0)).toBe(false);
        expect(pagesToUnload(999, 10, 3)(9)).toBe(false);
        expect(pagesToUnload(0, 0, 3)(0)).toBe(true); // 空库：什么都不该留
    });

    it('保留的是**连续区间**（前后各 keep），不是零散几个', () => {
        const keep: number[] = [];
        const unload = pagesToUnload(5, 20, 2);
        for (let i = 0; i < 20; i++) if (!unload(i)) keep.push(i);
        expect(keep).toEqual([3, 4, 5, 6, 7]);
    });
});

describe('#636 右键菜单：原文件名', () => {
    it('只取**末段**（压缩包内是 dir/sub/page.jpg 这种路径）', () => {
        expect(baseNameOf('a/b/page-001.jpg')).toBe('page-001.jpg');
        expect(baseNameOf('dir\\sub\\page-002.png')).toBe('page-002.png');
        expect(baseNameOf('page.jpg')).toBe('page.jpg');
        expect(baseNameOf('')).toBe('');
    });

    it('🔴 超长**截断但保留扩展名**（扩展名被截掉就认不出是什么文件）', () => {
        const long = 'a'.repeat(60) + '.jpg';
        const out = baseNameOf(long, 20);
        expect(out.length).toBeLessThanOrEqual(20);
        expect(out.endsWith('.jpg')).toBe(true);
        expect(out).toContain('…');
    });

    it('扩展名自己就超长 ⇒ 硬截（⛔ 别拼出比上限还长的串）', () => {
        const weird = 'x.' + 'y'.repeat(50);
        const out = baseNameOf(weird, 20);
        expect(out.length).toBeLessThanOrEqual(20);
    });

    it('没扩展名的长名 ⇒ 直接截断', () => {
        const out = baseNameOf('z'.repeat(50), 10);
        expect(out.length).toBeLessThanOrEqual(10);
        expect(out.endsWith('…')).toBe(true);
    });
});

describe('#669 缩略图栏默认显示（用户 2026-10-19 裁定，取代 #636 的「默认关」）', () => {
    it('🔴 只有**显式 false** 才关 —— 缺省 / 脏值一律开（老用户 data.json 没有这个键 ⇒ 升级后可见）', () => {
        expect(thumbsVisible(false)).toBe(false);
        expect(thumbsVisible(undefined)).toBe(true);
        expect(thumbsVisible(null)).toBe(true);
        expect(thumbsVisible(true)).toBe(true);
        expect(thumbsVisible('false')).toBe(true); // 字符串不算关闭（手改 data.json 的常见形态）
        expect(thumbsVisible(0)).toBe(true);
    });
});

