// 合集卡「总时长」角标（pure/mediaProgress.totalDurationMinutes / seriesPlaytimeBadge）单测 —— 2026-11-19 m14228 ② 建立。
//
// 用户逐字：「系列卡上要统计总共时长并显示」。当场问清并裁定两条口径：
//   ⑴ 口径 = **统计时长之和**（已读/已玩/已听累计相加），⛔ 不是 durationMin 片长之和；
//   ⑵ 位置 = **封面底部悬浮区**（与单卡那三枚「已玩/已读/已听」角标同一角落）。
//
// 🔴 为什么这组必须钉死：
//   · 「统计时长之和」在仓里有**两个消费者** —— 排序档 `duration-asc`/`duration-desc` 的合集代表值
//     （`pure/seriesGroup.groupDuration`）与卡面角标（`seriesPlaytimeBadge`）。两者一旦各写一份求和，
//     「按总时长排序」的顺序就会和卡上写的数字**互相矛盾**，而且没有任何报错 —— 只能靠肉眼发现。
//     ⇒ 用例 ⑴ 直接钉「groupDuration 委托给 totalDurationMinutes」，而不只是钉数字。
//   · 合计为 0 必须返空串（封面不留空槽，与三枚单卡角标同一条纪律）—— 返 '0min' 会被读成
//     「我确实只看了 0 分钟」，那是假信息。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { totalDurationMinutes, seriesPlaytimeBadge } from 'pure/mediaProgress';
import type { MediaEntry } from 'data/types';

function e(o: Record<string, unknown>): MediaEntry {
    return {
        id: 'x', type: 'movie', title: '样例', status: 'want', rating: 0,
        genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '',
        ...o,
    } as unknown as MediaEntry;
}

describe('totalDurationMinutes · 合集统计时长求和', () => {
    it('按类型各取各的时长字段（书 readMinutes / 游戏 playtimeMinutes / 音乐 listenMinutes）', () => {
        expect(totalDurationMinutes([e({ type: 'book', readMinutes: 30 }), e({ type: 'book', readMinutes: 45 })])).toBe(75);
        expect(totalDurationMinutes([e({ type: 'game', playtimeMinutes: 100 }), e({ type: 'game', playtimeMinutes: 20 })])).toBe(120);
        expect(totalDurationMinutes([e({ type: 'music', listenMinutes: 1 }), e({ type: 'music', listenMinutes: 2 })])).toBe(3);
    });

    it('影视三类没有时长字段 ⇒ 恒 0（这是选定口径，不是 bug）', () => {
        expect(totalDurationMinutes([e({ type: 'movie', durationMin: 120 }), e({ type: 'tv', durationMin: 45 })])).toBe(0);
    });

    it('脏值 / 缺失 / 负数一律按 0 计入，⛔ 不返 NaN、不抛', () => {
        const dirty = [
            e({ type: 'book', readMinutes: Number.NaN }),
            e({ type: 'book', readMinutes: -5 }),
            e({ type: 'book' }),
            e({ type: 'book', readMinutes: '30' }),
        ];
        expect(totalDurationMinutes(dirty)).toBe(0);
    });

    it('空组 ⇒ 0', () => {
        expect(totalDurationMinutes([])).toBe(0);
    });

    it('🔴 求和只有一份实现：seriesGroup 的排序代表值必须委托给本函数（⛔ 不许第二份循环）', () => {
        const src = readFileSync('src/pure/seriesGroup.ts', 'utf8');
        expect(src).toContain("import { readPercent, totalDurationMinutes } from './mediaProgress';");
        expect(src).toContain('return totalDurationMinutes(items);');
        // 反向守卫：groupDuration 体内不许再出现求和循环（`sum +=` / `entryDurationMinutes(`）
        const at = src.indexOf('function groupDuration');
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, src.indexOf('}', src.indexOf('return totalDurationMinutes(items);')));
        expect(body).not.toContain('sum +=');
        expect(body).not.toContain('entryDurationMinutes(');
    });
});

describe('seriesPlaytimeBadge · 合集卡角标文本', () => {
    it('各类型动词与单卡三枚角标同族（影视「已看」/ 书籍「已读」/ 游戏「已玩」/ 音乐「已听」）', () => {
        expect(seriesPlaytimeBadge([e({ type: 'movie' })], 'movie')).toBe('');
        expect(seriesPlaytimeBadge([e({ type: 'book', readMinutes: 60 })], 'book')).toBe('已读 1h');
        expect(seriesPlaytimeBadge([e({ type: 'game', playtimeMinutes: 30 })], 'game')).toBe('已玩 30min');
        expect(seriesPlaytimeBadge([e({ type: 'music', listenMinutes: 119 })], 'music')).toBe('已听 1h59min');
    });

    it('🔴 合计为 0 ⇒ 空串（封面不留空槽，⛔ 不渲染「0min」）', () => {
        expect(seriesPlaytimeBadge([], 'book')).toBe('');
        expect(seriesPlaytimeBadge([e({ type: 'book' })], 'book')).toBe('');
        expect(seriesPlaytimeBadge([e({ type: 'book', readMinutes: 0.4 })], 'book')).toBe('');
    });

    it('格式化与单卡角标同源（走 formatBadgeTime：向下取整、整点省略 min）', () => {
        expect(seriesPlaytimeBadge([e({ type: 'book', readMinutes: 119.9 })], 'book')).toBe('已读 1h59min');
        expect(seriesPlaytimeBadge([e({ type: 'book', readMinutes: 120 })], 'book')).toBe('已读 2h');
    });

    it('跨条累加后再格式化（不是一个一个显示）', () => {
        const items = [e({ type: 'book', readMinutes: 90 }), e({ type: 'book', readMinutes: 45 })];
        expect(seriesPlaytimeBadge(items, 'book')).toBe('已读 2h15min');
    });
});

describe('MediaList 装配 · 合集卡角标落在封面底部悬浮区', () => {
    const src = readFileSync('src/views/components/MediaList.svelte', 'utf8');

    it('引入了 seriesPlaytimeBadge（⛔ 别在视图层自己拼字符串）', () => {
        expect(src).toContain('seriesPlaytimeBadge');
        expect(src).toContain('data-tip="系列总时长（各条统计时长累计）"');
    });

    it('🔴 与书籍进度共用**同一块** `.rl-cov-foot`（两块绝对定位容器会互相压住）', () => {
        // 合集卡那一段里 `.rl-cov-foot` 只出现一次（class 定义处的选择器不算）
        const at = src.indexOf('function openGroupCtx');
        expect(at).toBeGreaterThan(-1);
        const cardStart = src.indexOf('class="rl-card rl-series-card"');
        expect(cardStart).toBeGreaterThan(-1);
        const cardEnd = src.indexOf('class="rl-card-meta"', cardStart);
        expect(cardEnd).toBeGreaterThan(cardStart);
        const block = src.slice(cardStart, cardEnd);
        const feet = block.match(/class="rl-cov-foot"/g) || [];
        expect(feet.length).toBe(1);
        // 两块内容都在这一块里
        expect(block).toContain('seriesPlaytimeBadge(g.items, g.type)');
        expect(block).toContain('seriesReadPercent(g.items)');
    });

    it('海报墙上不渲染（与单卡同一道 `!wallView` 门控）', () => {
        const cardStart = src.indexOf('class="rl-card rl-series-card"');
        const cardEnd = src.indexOf('class="rl-card-meta"', cardStart);
        const block = src.slice(cardStart, cardEnd);
        // 外层 `{#if !wallView && (...)}` 那一行（模板里时长判据在 `||` 左侧）
        const line = block.split('\n').find((l) => l.includes('!wallView') && l.includes('seriesPlaytimeBadge'));
        expect(line).toBeTruthy();
        expect(line).toContain('seriesReadPercent(g.items)');
    });
});
