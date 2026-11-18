// 进度 / 状态文案（pure/mediaProgress）单测 —— 2026-09-30 #444c 建立。
//
// 🔴 为什么这个模块必须有单测：它是**卡片 / 列表 / 系列弹窗三处共用的同一份口径**。
//    #444c 把季列表弹窗改成应用级 Modal 之后，弹窗**不再长在 MediaList 组件里**，
//    那行小字只能在纯模块里共用 —— 一旦口径漂了（卡面说「已读 40%」、弹窗说「存档」），用户一眼就看出来。
import { describe, it, expect } from 'vitest';
import { bookUnitOf, readPercent, listProgress, cardPlaytimeBadge, cardReadBadge, cardListenBadge, seasonRowMeta } from 'pure/mediaProgress';
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

describe('cardPlaytimeBadge · 封面左下角「已玩」角标（#471 从元信息区 `.rl-prog` 行搬来）', () => {
    it('🔴 m04435 ④：单位口径 = `formatBadgeTime`（<60min 写 min、整点省 min）', () => {
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 150 }))).toBe('已玩 2h30min');
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 120 }))).toBe('已玩 2h');
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 61 }))).toBe('已玩 1h1min');
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 59 }))).toBe('已玩 59min');
        // ⚠️ 旧实现 `Math.round(29/60)` 会给出「已玩 0h」—— 把半小时内的游玩抹成 0。新口径保留分钟。
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 29 }))).toBe('已玩 29min');
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

describe('cardReadBadge · 封面左下角「已读」角标（#537，与游戏同一角落）', () => {
    it('🔴 m04435 ④：与「已玩」同一套单位（原本走 `formatPlaytime` 给 0.5h，现已统一）', () => {
        expect(cardReadBadge(e({ type: 'book', readMinutes: 120 }))).toBe('已读 2h');
        expect(cardReadBadge(e({ type: 'book', readMinutes: 150 }))).toBe('已读 2h30min');
        expect(cardReadBadge(e({ type: 'book', readMinutes: 119 }))).toBe('已读 1h59min');
        expect(cardReadBadge(e({ type: 'book', readMinutes: 30 }))).toBe('已读 30min');
    });
    it('🔴 非书籍一律空串（游戏走自己的 `cardPlaytimeBadge`，两者同角互斥）', () => {
        expect(cardReadBadge(e({ type: 'game', readMinutes: 120 }))).toBe('');
        expect(cardReadBadge(e({ type: 'movie', readMinutes: 120 }))).toBe('');
        expect(cardReadBadge(e({ type: 'book' }))).toBe('');
    });
    it('阅读时长 0 / 非法 ⇒ 空串（角标不渲染，封面不留空槽）', () => {
        expect(cardReadBadge(e({ type: 'book', readMinutes: 0 }))).toBe('');
        expect(cardReadBadge(e({ type: 'book', readMinutes: -5 }))).toBe('');
    });
});

describe('cardListenBadge · 封面「已听」角标（🔴 m02288 落位 / m04435 ④ 统一单位）', () => {
    it('🔴 音乐有时长 ⇒ 「已听 X」（与已读/已玩同一套单位，⛔ 别再走 `formatPlaytime` 的小数小时）', () => {
        expect(cardListenBadge(e({ type: 'music', listenMinutes: 120 }))).toBe('已听 2h');
        expect(cardListenBadge(e({ type: 'music', listenMinutes: 150 }))).toBe('已听 2h30min');
        expect(cardListenBadge(e({ type: 'music', listenMinutes: 30 }))).toBe('已听 30min');
        // ⚠️ 旧口径下这里分别是「已玩 0h」「已听 0.4h」—— 25 分钟的游戏时长被抹成 0。m04435 ④ 后两者都保留分钟。
        expect(cardPlaytimeBadge(e({ type: 'game', playtimeMinutes: 25 }))).toBe('已玩 25min');
        expect(cardListenBadge(e({ type: 'music', listenMinutes: 25 }))).toBe('已听 25min');
    });

    it('🔴 非音乐一律空串（三枚角标同角互斥：游戏 / 书籍 / 音乐各管一类）', () => {
        expect(cardListenBadge(e({ type: 'game', listenMinutes: 120 }))).toBe('');
        expect(cardListenBadge(e({ type: 'book', listenMinutes: 120 }))).toBe('');
        expect(cardListenBadge(e({ type: 'movie', listenMinutes: 120 }))).toBe('');
        expect(cardListenBadge(e({ type: 'tv', listenMinutes: 120 }))).toBe('');
    });

    it('音乐没填时长 / 0 / 非法 ⇒ 空串（角标不渲染，封面不留空槽）', () => {
        expect(cardListenBadge(e({ type: 'music' }))).toBe('');
        expect(cardListenBadge(e({ type: 'music', listenMinutes: 0 }))).toBe('');
        expect(cardListenBadge(e({ type: 'music', listenMinutes: -5 }))).toBe('');
    });

    it('🔴 三枚角标互不串味：同一个 `listenMinutes` 只让音乐那张出文字', () => {
        const music = e({ type: 'music', listenMinutes: 90, readMinutes: 90, playtimeMinutes: 90 });
        expect(cardListenBadge(music)).toBe('已听 1h30min');
        expect(cardReadBadge(music)).toBe('');
        expect(cardPlaytimeBadge(music)).toBe('');
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
