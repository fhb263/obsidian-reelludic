// #669 漫画阅读器·连续滚动的纯逻辑单测：视口当前页 / 缩略图同步 / 进度滑块 / 占位尺寸 / 滚轮 / 缩放 / 还原。
// 口径来源见 `src/pure/comicScroll.ts` 的注释（每条判据都对应一个真实踩过的坑）。
import { describe, it, expect } from 'vitest';
import {
    pageAtViewport,
    thumbScrollTarget,
    ratioToScrollTop,
    scrollTopToRatio,
    cellStride,
    cellRect,
    pageBox,
    sortByDistance,
    wheelDeltaOf,
    zoomAfterWheel,
    restoreScrollTop,
    PAGE_RATIO_FALLBACK,
    type PageRect,
} from 'pure/comicScroll';

/** 造一列等高页（首尾相接，不留缝——漫画页在连续模式里就是这个排布） */
function stack(heights: number[], start = 0): PageRect[] {
    let top = start;
    return heights.map((h) => {
        const r = { top, height: h };
        top += h;
        return r;
    });
}

describe('pageAtViewport：连续滚动里「读者正在看哪一页」', () => {
    const pages = stack([1000, 1000, 1000]);

    it('🔴 判据是**覆盖视口中线**，不是「页顶已滚过」（后者会把高亮停在上一个已离屏的页）', () => {
        // 视口 800：scrollTop=0 时中线 400 落在第 0 页
        expect(pageAtViewport(pages, 0, 800)).toBe(0);
        // 第 1 页顶 = 1000。要让中线进第 1 页，需要 scrollTop + 400 >= 1000 ⇒ 600
        expect(pageAtViewport(pages, 599, 800)).toBe(0);
        expect(pageAtViewport(pages, 600, 800)).toBe(1);
        // 对照：此时第 0 页的底（1000）早已在视口顶（600）之上 —— 「页顶滚过」那套会提前报成第 1 页吗？
        // 不会，它要 scrollTop >= 1000 —— 两种口径在这一段给出的答案不同，中线口径更贴合「眼睛在哪」。
        expect(pageAtViewport(pages, 1000, 800)).toBe(1);
        expect(pageAtViewport(pages, 1600, 800)).toBe(2);
    });

    it('空页表 → 0（没有页，不产出 -1 这种非法页号）', () => {
        expect(pageAtViewport([], 0, 800)).toBe(0);
        expect(pageAtViewport([], 5000, 0)).toBe(0);
    });

    it('🔴 滚到底时末尾那几页比视口矮 ⇒ 归到**最后一页**（中线够不着它们，但读者确实看完了）', () => {
        const short = stack([1000, 1000, 200]); // 总高 2200，视口 800 ⇒ 可用行程 1400
        // 中线 1800 落在第 1 页（1000..2000）—— 光靠中线判据会停在第 1 页，⛔ 与「读完了」不符
        expect(pageAtViewport(short, 1400, 800)).toBe(2);
        expect(pageAtViewport(short, 1e6, 800)).toBe(2);
        // ⚠️ 补偿判据是「**容差内**才算贴底」（`st + v >= 总高 - 1`）：1399 时底边 2199、总高 2200，
        //    正好落在容差里 ⇒ 也算贴底。真·没贴底要差 2px 以上：
        expect(pageAtViewport(short, 1398, 800)).toBe(1);
        expect(pageAtViewport(short, 0, 800)).toBe(0);
    });

    it('🔴 反向对照：最后一页本身很高、只是滚动量被夹住 ⇒ **不许**补偿（否则滚到底会跳到末页）', () => {
        const tall = stack([1000, 3000]);
        expect(pageAtViewport(tall, 3200, 800)).toBe(1); // 中线 3600 在第 1 页里，本来就对
    });

    it('视口为 0（容器还没排版）⇒ 按 scrollTop 落点算，不崩溃、不返回负值', () => {
        expect(pageAtViewport(pages, 0, 0)).toBe(0);
        expect(pageAtViewport(pages, 1000, 0)).toBe(1);
    });

    it('页高全为 0（还没量出来）⇒ 不塌到 0、结果仍在合法区间', () => {
        const flat = stack([0, 0, 0]);
        const v = pageAtViewport(flat, 0, 800);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(2);
    });

    it('非法入参（NaN）⇒ 按 0 处理（不产出 NaN / 负数）', () => {
        expect(pageAtViewport(pages, NaN, 800)).toBe(0);
        expect(pageAtViewport(pages, -500, 800)).toBe(0);
        // 视口高脏值 ⇒ 当 0 高处理。⚠️ 与 scrollTop=600 / 视口 0 同义 ⇒ 挡在「中线未过首屏」那一步，
        //    返回 0；合法性要求只有一条：**落在 [0, n-1] 内且不是 NaN**（⛔ 不返回 -1 / 越界）。
        const v = pageAtViewport(pages, 600, NaN);
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(2);
    });
});

describe('thumbScrollTarget：缩略图栏跟着正文滚', () => {
    const geo = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };
    const stride = 100;
    const cell = (i: number) => cellRect(i, stride, 94);

    it('🔴 已在可视区内 ⇒ **一动不动**（每次滚都微调会让整栏抖成一团）', () => {
        expect(thumbScrollTarget(geo, cell(1))).toBe(0);
        expect(thumbScrollTarget({ ...geo, scrollTop: 100 }, cell(3))).toBe(100);
    });

    it('在下方 ⇒ 让该格落到可视区**中位**（上下都留出前后页预览）', () => {
        // 第 10 格 top=1000；clientHeight 500、格高 94 ⇒ want = 1000 - (500-94)/2 = 797
        expect(thumbScrollTarget(geo, cell(10))).toBe(797);
    });

    it('在上方 ⇒ 同样居中对齐（不是贴顶）', () => {
        // 栏已滚到 900，读的是第 1 格（top = 100+96 = 196）⇒ 目标 196 - 203 = -7 ⇒ 钳到 0
        expect(thumbScrollTarget({ ...geo, scrollTop: 900 }, cell(1))).toBe(0);
        // 栏滚得更远时，居中对齐的负值不被钳（说明是「居中」而不是「贴顶」）
        const far = { ...geo, scrollTop: 1400 };
        expect(thumbScrollTarget(far, cell(12))).toBe(1200 - 203);
        expect(thumbScrollTarget(far, cell(12))).toBeLessThan(1400);
    });

    it('结果钳到 [0, scrollHeight-clientHeight]（⛔ 不产出越界值）', () => {
        expect(thumbScrollTarget(geo, cell(0))).toBeGreaterThanOrEqual(0);
        expect(thumbScrollTarget(geo, cell(99))).toBe(1500); // max = 2000-500
        const tiny = { scrollTop: 0, scrollHeight: 300, clientHeight: 500 };
        expect(thumbScrollTarget(tiny, cell(5))).toBe(0); // 内容比视口还矮 ⇒ 只能 0
    });

    it('可视高为 0（栏还没排版）⇒ 维持原值', () => {
        expect(thumbScrollTarget({ ...geo, clientHeight: 0 }, cell(9))).toBe(0);
    });

    it('1 格高 + gap 恰好等于可视高 ⇒ 正好在视野里', () => {
        // 94 + 6 = 100 ⇒ 5 格正好铺满 500 高，底边压在可视区底沿
        const g = { scrollTop: 0, scrollHeight: 500, clientHeight: 500 };
        expect(thumbScrollTarget(g, { top: 400, height: 100 })).toBe(0);
        // 1px 亚像素容差：底边超 1px 仍算在视野里
        expect(thumbScrollTarget(g, { top: 401, height: 100 })).toBe(0);
        // 超 2px ⇒ 越过容差，开始跟随
        expect(thumbScrollTarget({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 }, { top: 402, height: 100 })).toBeGreaterThan(0);
    });
});

describe('进度滑块：比例 ⇄ 滚动位置', () => {
    it('🔴 分母是**可用行程**（scrollHeight-clientHeight），不是 scrollHeight', () => {
        // 用 scrollHeight 当分母：ratio=1 → 2000，但最大只能滚到 1400 ⇒ 滑块永远差一截到不了底
        expect(ratioToScrollTop(1, 2000, 600)).toBe(1400);
        expect(ratioToScrollTop(0.5, 2000, 600)).toBe(700);
        expect(ratioToScrollTop(0, 2000, 600)).toBe(0);
    });

    it('逆运算自洽（来回换一轮不掉值）', () => {
        for (const r of [0, 0.13, 0.5, 0.87, 1]) {
            const st = ratioToScrollTop(r, 3000, 700);
            expect(scrollTopToRatio(st, 3000, 700)).toBeCloseTo(r, 6);
        }
    });

    it('内容比视口还矮 ⇒ 比例恒 0（没有可滚行程）', () => {
        expect(scrollTopToRatio(0, 400, 800)).toBe(0);
        expect(scrollTopToRatio(999, 400, 800)).toBe(0);
        expect(ratioToScrollTop(0.7, 400, 800)).toBe(0);
    });

    it('非法入参：ratio NaN ⇒ 0；scrollTop NaN ⇒ 0', () => {
        expect(ratioToScrollTop(NaN, 2000, 600)).toBe(0);
        expect(scrollTopToRatio(NaN, 2000, 600)).toBe(0);
        expect(ratioToScrollTop(1.8, 2000, 600)).toBe(1400); // 越界钳到 1
    });
});

describe('cellStride / cellRect：格子几何', () => {
    it('量到就用量到的（格高 + 间距），量不到退常量；⛔ 永不为 0', () => {
        expect(cellStride(90, 6)).toBe(96);
        expect(cellStride(0, 6)).toBe(96);
        expect(cellStride(NaN, 6)).toBe(96);
        expect(cellStride(0, 0, 0)).toBe(1);
    });

    it('第 i 格的位置 = 内距 + i × 步长', () => {
        expect(cellRect(0, 96, 90, 8)).toEqual({ top: 8, height: 90 });
        expect(cellRect(3, 96, 90, 8)).toEqual({ top: 296, height: 90 });
        expect(cellRect(-2, 96, 90, 8).top).toBe(8); // 负下标钳到 0
    });
});

describe('pageBox：连续滚动页的占位尺寸（消除「加载完才撑开」的跳动）', () => {
    it('1× = 适屏 contain（宽高双约束取小者，纵横比恒定）', () => {
        // 竖版页 800×1200，可用 1000×700 ⇒ 高度先到顶：700/1200*800 = 466.67 宽
        const b = pageBox(800, 1200, 1000, 700, 1);
        expect(b.width).toBe(467);
        expect(b.height).toBe(Math.round(467 * 1.5));
        expect(b.height / b.width).toBeCloseTo(1.5, 2);
    });

    it('窄容器时由宽度约束（不溢出横向）', () => {
        const b = pageBox(800, 1200, 400, 2000, 1);
        expect(b.width).toBe(400);
    });

    it('🔴 高度**永远不为 0**（0 高的块在 IntersectionObserver 里永不命中 = 懒加载自锁）', () => {
        const b = pageBox(0, 0, 0, 0, 1);
        expect(b.width).toBeGreaterThan(0);
        expect(b.height).toBeGreaterThan(0);
        // 量不到容器时宽按 1px 兜底，高度按回退纵横比算 ⇒ 至少 1px，⛔ 不是 NaN / 0
        expect(b).toEqual({ width: 1, height: 1 });
    });

    it('缩放 > 1 允许溢出（连续模式里靠容器横向滚动平移）', () => {
        const at1 = pageBox(800, 1200, 500, 2000, 1);
        const at2 = pageBox(800, 1200, 500, 2000, 2);
        expect(at2.width).toBe(at1.width * 2);
        expect(at2.height).toBe(Math.round(at1.width * 2 * 1.5));
    });

    it('缩放非法（0 / NaN）⇒ 按 1× 算', () => {
        expect(pageBox(800, 1200, 1000, 700, 0)).toEqual(pageBox(800, 1200, 1000, 700, 1));
        expect(pageBox(800, 1200, 1000, 700, NaN)).toEqual(pageBox(800, 1200, 1000, 700, 1));
    });
});

describe('sortByDistance：补图优先级', () => {
    it('🔴 离当前页最近的先取（上一版按页序取 ⇒ 当前页最后才到）', () => {
        expect(sortByDistance([40, 41, 42, 43, 44], 44)).toEqual([44, 43, 42, 41, 40]);
    });

    it('两侧等距时页序小者先（顺着阅读方向）', () => {
        expect(sortByDistance([48, 50, 49, 51], 49)).toEqual([49, 48, 50, 51]);
    });

    it('不改入参（纯函数）', () => {
        const src = [3, 1, 2];
        sortByDistance(src, 2);
        expect(src).toEqual([3, 1, 2]);
    });
});

describe('wheelDeltaOf：滚轮位移换算', () => {
    it('像素模式原样返回', () => {
        expect(wheelDeltaOf({ deltaY: 120 })).toEqual({ dx: 0, dy: 120 });
    });

    it('🔴 deltaMode=1（按行）必须换算成 px —— 否则一次只滚 3px，等于没滚', () => {
        expect(wheelDeltaOf({ deltaY: 3, deltaMode: 1 }, 36, 600)).toEqual({ dx: 0, dy: 108 });
    });

    it('deltaMode=2（按页）按视口高换算', () => {
        expect(wheelDeltaOf({ deltaY: 1, deltaMode: 2 }, 36, 600)).toEqual({ dx: 0, dy: 600 });
    });

    it('shift + 滚轮 = 横向（容器横向溢出时用）', () => {
        expect(wheelDeltaOf({ deltaY: 100, shiftKey: true })).toEqual({ dx: 100, dy: 0 });
    });

    it('非法值按 0（不往容器里写 NaN —— 那会让 scrollTop 变成 0 并弹回顶部）', () => {
        expect(wheelDeltaOf({ deltaY: NaN })).toEqual({ dx: 0, dy: 0 });
    });
});

describe('zoomAfterWheel：Ctrl + 滚轮缩放', () => {
    it('上滚放大、下滚缩小，按档位吸附', () => {
        expect(zoomAfterWheel(1, -1, 0.5, 4, 0.25)).toBe(1.25);
        expect(zoomAfterWheel(1, 1, 0.5, 4, 0.25)).toBe(0.75);
    });

    it('钳在 [min, max]，⛔ 不越界', () => {
        expect(zoomAfterWheel(4, -100, 0.5, 4, 0.25)).toBe(4);
        expect(zoomAfterWheel(0.5, 100, 0.5, 4, 0.25)).toBe(0.5);
    });

    it('deltaY = 0（横向滚动）不改变缩放', () => {
        expect(zoomAfterWheel(1.5, 0, 0.5, 4, 0.25)).toBe(1.5);
    });

    it('残值吸附到档位（1.1 → 1.0，保证滑条对得上）', () => {
        expect(zoomAfterWheel(1.1, -1, 0.5, 4, 0.25)).toBe(1.25);
    });
});

describe('restoreScrollTop：恢复上次读到哪儿', () => {
    it('ratio = 0 ⇒ 停在该页**顶部**', () => {
        expect(restoreScrollTop(3000, 1200, 800, 0)).toBe(3000);
    });

    it('🔴 ratio > 0 ⇒ 停在该页**中线**（用户上次正看着页中段）', () => {
        // 页顶 3000、页高 1200、视口 800 ⇒ 3000 + 0.5*1200 - 400 = 3200
        expect(restoreScrollTop(3000, 1200, 800, 0.5)).toBe(3200);
    });

    it('ratio = 1 ⇒ 页底部对齐视口底', () => {
        expect(restoreScrollTop(3000, 1200, 800, 1)).toBe(3000 + 1200 - 400);
    });

    it('不产出负数（第一页 + 大视口）', () => {
        expect(restoreScrollTop(0, 1200, 800, 0)).toBe(0);
        expect(restoreScrollTop(0, 100, 800, 1)).toBe(0);
    });

    it('脏值按 0 处理（页顶脏值当作第一页，ratio 脏值当作页顶）', () => {
        expect(restoreScrollTop(1000, 1200, 800, NaN)).toBe(1000);
        expect(restoreScrollTop(NaN, 1200, 800, 0.5)).toBe(200);
    });
});
