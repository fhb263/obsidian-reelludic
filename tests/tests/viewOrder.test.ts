// #668 「切换视图」自由排序 + 时间线缩放档：纯函数行为一律走单元级。
import { describe, it, expect } from 'vitest';
import {
    ALL_VIEW_VALUES,
    MUSIC_VIEW,
    TL_ZOOM_DEFAULT,
    TL_ZOOM_MAX,
    TL_ZOOM_MIN,
    TL_WIDTH_BY_ZOOM,
    VIEW_LABELS,
    VIEW_MODES,
    buildViewChoices,
    moveViewValue,
    normalizeTimelineZoom,
    normalizeViewOrder,
    timelineItemWidth,
    timelineZoomStep,
} from 'pure/viewModes';

describe('normalizeViewOrder —— 视图顺序归一', () => {
    it('没配过（undefined / null / 非数组）⇒ 默认顺序', () => {
        const def = normalizeViewOrder(undefined);
        expect(def).toEqual([...ALL_VIEW_VALUES]);
        expect(normalizeViewOrder(null)).toEqual(def);
        expect(normalizeViewOrder('grid')).toEqual(def);
        expect(normalizeViewOrder({})).toEqual(def);
    });

    it('空数组 ⇒ 默认顺序（等于没配过）', () => {
        expect(normalizeViewOrder([])).toEqual([...ALL_VIEW_VALUES]);
    });

    it('保留用户顺序（⛔ 不按默认顺序重排 —— 否则拖了白拖）', () => {
        const user = ['list', 'grid', 'wall', 'masonry', 'timeline', 'grouped'];
        expect(normalizeViewOrder(user)).toEqual(user);
    });

    it('丢未知值、去重，缺失的档补在**末尾**', () => {
        const out = normalizeViewOrder(['timeline', 'nope', 'timeline', 'grid', 42]);
        expect(out[0]).toBe('timeline');
        expect(out[1]).toBe('grid');
        // 其余按默认顺序补齐，且**一个不少**
        expect(out).toHaveLength(ALL_VIEW_VALUES.length);
        expect(new Set(out).size).toBe(ALL_VIEW_VALUES.length);
    });

    it('🔴 新增视图（老配置里没有它）会自动补进来 —— 否则老用户永远看不到新视图', () => {
        const oldCfg = ['list', 'grid']; // 模拟「新增视图之前」存下的配置
        const out = normalizeViewOrder(oldCfg);
        expect(out.slice(0, 2)).toEqual(['list', 'grid']);
        for (const v of ALL_VIEW_VALUES) expect(out).toContain(v);
    });

    it('归一幂等', () => {
        const once = normalizeViewOrder(['wall', 'list']);
        expect(normalizeViewOrder(once)).toEqual(once);
    });
});

describe('buildViewChoices —— 按顺序建选项表', () => {
    it('缺省顺序 ⇒ 五档（音乐专有那档只在音乐页签出现）', () => {
        const out = buildViewChoices(undefined, 'movie');
        expect(out.map((c) => c.value)).toEqual([...VIEW_MODES]);
        expect(out.every((c) => c.label === VIEW_LABELS[c.value as keyof typeof VIEW_LABELS])).toBe(true);
    });

    it('音乐页签 ⇒ 多出「分组歌单」，且位置跟随用户顺序', () => {
        const order = ['grouped', 'list', 'grid', 'masonry', 'wall', 'timeline'];
        const out = buildViewChoices(order, 'music');
        expect(out[0].value).toBe('grouped');
        expect(out[0].label).toBe(MUSIC_VIEW.label);
        expect(out).toHaveLength(6);
    });

    it('非音乐页签 ⇒ 「分组歌单」即使排在前面也不出现', () => {
        const order = ['grouped', 'list', 'grid', 'masonry', 'wall', 'timeline'];
        expect(buildViewChoices(order, 'book').map((c) => c.value)).not.toContain('grouped');
    });

    it('图标与名字都取自本模块（⛔ 组件里不手写第二份）', () => {
        for (const c of buildViewChoices(undefined, null)) {
            expect(c.icon).toBeTruthy();
            expect(c.label).toBeTruthy();
        }
    });
});

describe('moveViewValue —— 拖排一格', () => {
    it('把某一档移到另一档的位置（其余相对顺序不变）', () => {
        const base = ['grid', 'list', 'masonry', 'wall', 'timeline', 'grouped'];
        const out = moveViewValue(base, 'timeline', 'grid');
        expect(out[0]).toBe('timeline');
        expect(out.indexOf('grid')).toBe(1);
        // 其余相对顺序没乱
        expect(out.filter((v) => v !== 'timeline').every((v, i) => v === base.filter((x) => x !== 'timeline')[i])).toBe(true);
    });

    it('向后移也对', () => {
        const base = [...ALL_VIEW_VALUES];
        const out = moveViewValue(base, 'grid', 'wall');
        expect(out.indexOf('grid')).toBe(base.indexOf('wall'));
        expect(out).toHaveLength(base.length);
    });

    it('不认识的值 / 同一个值 ⇒ 原样（归一后）', () => {
        const base = [...ALL_VIEW_VALUES];
        expect(moveViewValue(base, 'nope', 'grid')).toEqual(normalizeViewOrder(base));
        expect(moveViewValue(base, 'grid', 'nope')).toEqual(normalizeViewOrder(base));
        expect(moveViewValue(base, 'grid', 'grid')).toEqual(normalizeViewOrder(base));
    });

    it('不修改入参', () => {
        const base = [...ALL_VIEW_VALUES];
        const copy = [...base];
        moveViewValue(base, 'wall', 'grid');
        expect(base).toEqual(copy);
    });
});

describe('时间线缩放档', () => {
    it('归一：非法 / 越界 ⇒ 夹回区间；完全认不出 ⇒ 缺省档', () => {
        expect(normalizeTimelineZoom(undefined)).toBe(TL_ZOOM_DEFAULT);
        expect(normalizeTimelineZoom('3')).toBe(TL_ZOOM_DEFAULT);
        expect(normalizeTimelineZoom(NaN)).toBe(TL_ZOOM_DEFAULT);
        expect(normalizeTimelineZoom(0)).toBe(TL_ZOOM_MIN);
        expect(normalizeTimelineZoom(-5)).toBe(TL_ZOOM_MIN);
        expect(normalizeTimelineZoom(99)).toBe(TL_ZOOM_MAX);
        expect(normalizeTimelineZoom(2.6)).toBe(3); // 四舍五入
    });

    it('宽度表：档越大越窄（单调递减）且都为正', () => {
        let prev = Infinity;
        for (let z = TL_ZOOM_MIN; z <= TL_ZOOM_MAX; z++) {
            const w = timelineItemWidth(z);
            expect(w).toBeGreaterThan(0);
            expect(w).toBeLessThan(prev);
            prev = w;
        }
    });

    it('宽度函数对非法档回落缺省档的宽度', () => {
        expect(timelineItemWidth(NaN)).toBe(TL_WIDTH_BY_ZOOM[TL_ZOOM_DEFAULT]);
        expect(timelineItemWidth(99)).toBe(TL_WIDTH_BY_ZOOM[TL_ZOOM_MAX]);
    });

    it('上滚放大（档 -1）、下滚缩小（档 +1），到边界就不动', () => {
        expect(timelineZoomStep(3, 'in')).toBe(2);
        expect(timelineZoomStep(3, 'out')).toBe(4);
        expect(timelineZoomStep(TL_ZOOM_MIN, 'in')).toBe(TL_ZOOM_MIN);
        expect(timelineZoomStep(TL_ZOOM_MAX, 'out')).toBe(TL_ZOOM_MAX);
    });

    it('边界上「不动」是可判的（调用方据此跳过落盘）', () => {
        const atMin = timelineZoomStep(TL_ZOOM_MIN, 'in');
        expect(atMin).toBe(normalizeTimelineZoom(TL_ZOOM_MIN));
    });
});
