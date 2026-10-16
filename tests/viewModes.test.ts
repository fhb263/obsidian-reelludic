// 🔴 #598 视图切换的唯一真源 + 时间线分组（pure/viewModes）单测
// 用户：「切换海报墙/列表/瀑布流视图控件还是太丑了，有什么其他方案切换，还有什么视图可新增展示」
// → 裁定：切换控件改「单枚下拉菜单」、新增「时间线」视图。本模块 = 下拉的选项表 + 分桶纯逻辑。
import { describe, it, expect } from 'vitest';
import {
    VIEW_MODES, VIEW_LABELS, VIEW_ICONS, MUSIC_VIEW, TIMELINE_UNKNOWN_LABEL, buildTimeline,
} from 'pure/viewModes';
import type { MediaEntry } from 'data/types';

/** 造一条只带 id / 年份的条目（`buildTimeline` 只看 year） */
function e(id: string, year?: number): MediaEntry {
    return { id, type: 'movie', title: `作品${id}`, year, links: [], progress: {} } as unknown as MediaEntry;
}

describe('pure/viewModes · 视图真源', () => {
    it('通用视图表 = 5 档（卡片网格 / 列表 / 瀑布流 / 海报墙 / 时间线）', () => {
        // 🔴 #624：`wall`（海报墙）新增；`grid` 改名为「卡片网格」—— 阶数从 4 变 5，⛔ 别退回 4
        expect(VIEW_MODES).toEqual(['grid', 'list', 'masonry', 'wall', 'timeline']);
    });

    it('🔴 三张表（VIEW_MODES / VIEW_LABELS / VIEW_ICONS）的键集合**逐项一致** —— 加视图漏一张就红', () => {
        const sorted = [...VIEW_MODES].sort();
        expect(Object.keys(VIEW_LABELS).sort()).toEqual(sorted);
        expect(Object.keys(VIEW_ICONS).sort()).toEqual(sorted);
    });

    it('🔴 用户可见名（#624 改名后口径：`grid` = 卡片网格、`wall` = 海报墙 —— ⛔ 两词别互换）', () => {
        expect(VIEW_LABELS).toEqual({
            grid: '卡片网格', list: '列表', masonry: '瀑布流', wall: '海报墙', timeline: '时间线',
        });
        // 🔴 反向守卫：旧叫法「grid = 海报墙」必须彻底退场 —— 同一个词指两个视图是最难查的混淆
        expect(VIEW_LABELS.grid).not.toBe('海报墙');
        expect(VIEW_LABELS.wall).toBe('海报墙');
    });

    it('🔴 图标名逐项钉住（`setIcon` 找不到是**静默失败** ⇒ 少一枚图标很难在开发时发现）', () => {
        expect(VIEW_ICONS).toEqual({
            grid: 'layout-grid', list: 'list', masonry: 'columns-3', wall: 'gallery-vertical', timeline: 'clock',
        });
    });

    it('音乐专有的「分组歌单」在**通用表之外**（由宿主按 `lockType === "music"` 追加）', () => {
        expect(MUSIC_VIEW.value).toBe('grouped');
        expect(MUSIC_VIEW.label).toBe('分组歌单');
        expect((VIEW_MODES as readonly string[]).includes('grouped')).toBe(false);
    });
});

describe('pure/viewModes · 时间线分桶（#598）', () => {
    it('按年份分桶、年份**降序**（新的在前）', () => {
        const b = buildTimeline([e('a', 2024), e('b', 2026), e('c', 2025), e('d', 2026)]);
        expect(b.map((x) => x.label)).toEqual(['2026', '2025', '2024']);
        expect(b.map((x) => x.year)).toEqual([2026, 2025, 2024]);
    });

    it('🔴 桶内**保持传入顺序**（入口 filterAndSort 已排好，这里只搬运、⛔ 不再排一遍）', () => {
        const b = buildTimeline([e('z', 2026), e('a', 2026), e('m', 2026)]);
        expect(b[0].items.map((i) => i.id)).toEqual(['z', 'a', 'm']);
    });

    it('🔴「年份未知」恒**排在最后**（混进年份序列会出现「2026 → 未知 → 2025」）', () => {
        const b = buildTimeline([e('x'), e('a', 2025), e('y')]);
        expect(b.map((x) => x.label)).toEqual(['2025', TIMELINE_UNKNOWN_LABEL]);
        expect(b[1].year).toBeNull();
        expect(b[1].items.map((i) => i.id)).toEqual(['x', 'y']);
    });

    it('年份判定只认**正整数**：0 / 负数 / 小数 / NaN 一律归「未知」（`year: 0` 是脏数据）', () => {
        const b = buildTimeline([e('a', 0), e('b', -5), e('c', 2020.5), e('d', NaN), e('ok', 2020)]);
        expect(b.map((x) => x.label)).toEqual(['2020', TIMELINE_UNKNOWN_LABEL]);
        expect(b[1].items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('空输入 ⇒ 空数组（不抛，也**不造**一个空的「年份未知」桶）', () => {
        expect(buildTimeline([])).toEqual([]);
    });

    it('全是未知年份 ⇒ 只有一个「年份未知」桶', () => {
        const b = buildTimeline([e('a'), e('b')]);
        expect(b).toHaveLength(1);
        expect(b[0].label).toBe(TIMELINE_UNKNOWN_LABEL);
        expect(b[0].items).toHaveLength(2);
    });

    it('同一年只出一个桶（不会出现两个「2026」）', () => {
        const b = buildTimeline([e('a', 2026), e('b', 2026), e('c', 2025)]);
        expect(b.filter((x) => x.label === '2026')).toHaveLength(1);
        expect(b[0].items).toHaveLength(2);
    });
});
