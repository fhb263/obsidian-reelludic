// 进度 / 状态文案（pure/mediaProgress）单测 —— 2026-09-30 #444c 建立。
//
// 🔴 为什么这个模块必须有单测：它是**卡片 / 列表 / 系列弹窗三处共用的同一份口径**。
//    #444c 把季列表弹窗改成应用级 Modal 之后，弹窗**不再长在 MediaList 组件里**，
//    那行小字只能在纯模块里共用 —— 一旦口径漂了（卡面说「已读 40%」、弹窗说「存档」），用户一眼就看出来。
import { describe, it, expect } from 'vitest';
import { bookUnitOf, readPercent, listProgress, cardPlaytimeBadge, seasonRowMeta } from 'pure/mediaProgress';
import type { MediaEntry } from 'data/types';

function e(o: Record<string, unknown>): MediaEntry {
    return { id: 'x', type: 'movie', title: '作品x', status: 'want', rating: 0, genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '', ...o } as unknown as MediaEntry;
}

describe('bookUnitOf · 书籍进度单位（TXT 按章、其余按页）', () => {
    it('关联 .txt（大小写都认）⇒ 章', () => {
        expect(bookUnitOf({ bookFile: 'a/b.txt' })).toBe('章');
        expect(bookUnitOf({ bookFile: 'a/b.TXT' })).toBe('章');
    });
    it('PDF / 无关联 / 空值 ⇒ 页', () => {
        expect(bookUnitOf({ bookFile: 'a/b.pdf' })).toBe('页');
        expect(bookUnitOf({})).toBe('页');
        expect(bookUnitOf(null)).toBe('页');
        expect(bookUnitOf(undefined)).toBe('页');
    });
});

describe('readPercent · 阅读进度百分比', () => {
    it('阅读器 percent 优先（四舍五入、钳在 0~100）', () => {
        expect(readPercent(e({ type: 'book', readingProgress: { percent: 42.6 } }))).toBe(43);
        expect(readPercent(e({ type: 'book', readingProgress: { percent: 130 } }))).toBe(100);
        expect(readPercent(e({ type: 'book', readingProgress: { percent: -5 } }))).toBe(0);
    });
    it('percent 缺席时回退手填页码（page / totalPage）', () => {
        expect(readPercent(e({ type: 'book', readingProgress: { page: 50, totalPage: 200 } }))).toBe(25);
        expect(readPercent(e({ type: 'book', readingProgress: { totalPage: 200 } }))).toBe(0);
    });
    it('🔴 未开始（无 totalPage 也无 percent）⇒ undefined（不渲染灰线）', () => {
        expect(readPercent(e({ type: 'book', readingProgress: {} }))).toBeUndefined();
        expect(readPercent(e({ type: 'book' }))).toBeUndefined();
    });
    it('非书籍一律 undefined', () => {
        expect(readPercent(e({ type: 'tv', readingProgress: { percent: 50 } }))).toBeUndefined();
    });
});

describe('listProgress · 列表进度列', () => {
    it('书籍：有 totalPage ⇒ 「页/总 单位」+ pct；只知 percent ⇒ 「已读 N%」', () => {
        expect(listProgress(e({ type: 'book', bookFile: 'x.txt', readingProgress: { page: 3, totalPage: 10 } })))
            .toEqual({ text: '3/10 章', pct: 30 });
        expect(listProgress(e({ type: 'book', readingProgress: { percent: 66 } })))
            .toEqual({ text: '已读 66%', pct: 66 });
        expect(listProgress(e({ type: 'book', readingProgress: {} }))).toEqual({ text: '' });
    });
    it('🔴 剧集 / 动画**只在「在看」时**给 S/E（想看 / 已看 / 存档 都不给）', () => {
        const base = { type: 'anime' as const, progress: { season: 1, episode: 5, totalEpisodes: 10 } };
        expect(listProgress(e({ ...base, status: 'watching' })).text).toBe('S1E5');
        expect(listProgress(e({ ...base, status: 'watching' })).pct).toBe(50);
        expect(listProgress(e({ ...base, status: 'watching', progress: { season: 1, episode: 5 } })).text).toBe('S1E5');
        expect(listProgress(e({ ...base, status: 'want' })).text).toBe('');
        expect(listProgress(e({ ...base, status: 'watched' })).text).toBe('');
        expect(listProgress(e({ ...base, status: 'archived' })).text).toBe('');
    });
    it('游戏：有游玩时长 ⇒ 「已玩 Nh」；其余 ⇒ 空', () => {
        expect(listProgress(e({ type: 'game', playtimeMinutes: 90 }))).toEqual({ text: '已玩 2h' });
        expect(listProgress(e({ type: 'game' }))).toEqual({ text: '' });
        expect(listProgress(e({ type: 'music' }))).toEqual({ text: '' });
    });
});

describe('cardPlaytimeBadge · 封面左下角「已玩 Nh」角标（#471 从元信息区 `.rl-prog` 行搬来）', () => {
    it('游戏有时长 ⇒ 「已玩 Nh」（落库是分钟，这里按小时四舍五入）', () => {
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 150 }))).toBe('已玩 3h');
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 90 }))).toBe('已玩 2h');
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 29 }))).toBe('已玩 0h');
    });
    it('🔴 非游戏一律空串 —— 书籍页码那档**随 #471 整体退场**（书籍进度走卡片自己的 `.rl-readrow`：百分比 + 条 + N/M 页）', () => {
        expect(cardPlaytimeBadge(e({ type: 'book', bookFile: 'x.txt', readingProgress: { page: 3, totalPage: 10 } }))).toBe('');
        expect(cardPlaytimeBadge(e({ type: 'book', readingProgress: { percent: 66 } }))).toBe('');
        expect(cardPlaytimeBadge(e({ type: 'movie' }))).toBe('');
        expect(cardPlaytimeBadge(e({ type: 'music' }))).toBe('');
    });
    it('游戏没填时长 ⇒ 空串（角标**不渲染**；封面不是元信息区，⛔ 不留「-」空槽）', () => {
        expect(cardPlaytimeBadge(e({ type: 'game' }))).toBe('');
    });
});

describe('seasonRowMeta · 系列弹窗格子的小字（= 卡片那份口径）', () => {
    it('状态在前，进度在后，` · ` 连接', () => {
        expect(seasonRowMeta(e({ type: 'anime', status: 'watching', progress: { season: 1, episode: 5, totalEpisodes: 10 } })))
            .toMatch(/^.+ · S1E5$/);
    });
    it('🔴 剧集 / 动画**没在追**时不给 S/E，但**仍给出「共 N 集」**（挑季时这个数字有用）', () => {
        expect(seasonRowMeta(e({ type: 'anime', status: 'archived', progress: { season: 1, episode: 0, totalEpisodes: 52 } })))
            .toMatch(/ · 共 52 集$/);
        // 没有 totalEpisodes ⇒ 只剩状态，不带尾巴
        const only = seasonRowMeta(e({ type: 'anime', status: 'archived' }));
        expect(only).not.toContain('共');
        expect(only).not.toContain('·');
    });
    it('非影视类型不带「共 N 集」这个回退', () => {
        const s = seasonRowMeta(e({ type: 'movie', status: 'want' }));
        expect(s).not.toContain('共');
    });
});
