import { describe, it, expect } from 'vitest';
import {
    finishedInYear,
    activeInYear,
    finishedByType,
    activeByType,
    statusTypeMatrix,
    durationStats,
    monthlyFinished,
    monthlyActive,
    topRatedInYear,
    recentActivity,
} from 'pure/stats';
import type { MediaEntry } from 'data/types';

const year = 2026;

function e(partial: Partial<MediaEntry> & Pick<MediaEntry, 'id' | 'type' | 'title'>): MediaEntry {
    return {
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    };
}

describe('pure/stats finishedInYear / activeInYear 口径', () => {
    it('watchedDate 落在年内才算「看完」', () => {
        expect(finishedInYear(e({ id: 'a', type: 'movie', title: 'x', watchedDate: '2026-05-10' }), year)).toBe(true);
        expect(finishedInYear(e({ id: 'b', type: 'movie', title: 'y', watchedDate: '2025-12-31' }), year)).toBe(false);
        expect(finishedInYear(e({ id: 'c', type: 'movie', title: 'z' }), year)).toBe(false);
    });

    it('「活跃」= 任一动态时间戳（观看/计划/追更/游玩）', () => {
        expect(activeInYear(e({ id: 'a', type: 'game', title: 'g', playSessions: [{ date: '2026-03-01', minutes: 30 }] }), year)).toBe(true);
        expect(activeInYear(e({ id: 'b', type: 'tv', title: 't', progress: { season: 1, episode: 2, history: [{ date: '2026-02-01', season: 1, episode: 1 }] } }), year)).toBe(true);
        expect(activeInYear(e({ id: 'c', type: 'book', title: 'b', plannedDate: '2026-04-01' }), year)).toBe(true);
        expect(activeInYear(e({ id: 'd', type: 'movie', title: 'm', watchedDate: '2025-06-01', plannedDate: '2025-01-01' }), year)).toBe(false);
    });

    it('finishedByType / activeByType 分组计数', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: 'm1', watchedDate: '2026-01-01' }),
            e({ id: 'b', type: 'movie', title: 'm2', watchedDate: '2026-02-01' }),
            e({ id: 'c', type: 'book', title: 'b1', watchedDate: '2026-03-01' }),
            e({ id: 'd', type: 'game', title: 'g1' }),
        ];
        const fb = finishedByType(list, year);
        expect(fb.movie).toBe(2);
        expect(fb.book).toBe(1);
        expect(fb.game).toBe(0);
        const ab = activeByType(list, year);
        expect(ab.game).toBe(0); // 无动态时间戳
    });
});

describe('pure/stats statusTypeMatrix 交叉矩阵', () => {
    it('按类型×状态计数', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: 'm1', status: 'watched' }),
            e({ id: 'b', type: 'movie', title: 'm2', status: 'watching' }),
            e({ id: 'c', type: 'book', title: 'b1', status: 'watched' }),
        ];
        const m = statusTypeMatrix(list);
        expect(m.movie.watched).toBe(1);
        expect(m.movie.watching).toBe(1);
        expect(m.movie.want).toBe(0);
        expect(m.book.watched).toBe(1);
        expect(m.game.want).toBe(0);
    });
});

describe('pure/stats durationStats 时长聚合', () => {
    it('分类型聚合：片长/集数/页数/游玩时长与记录', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: 'm', durationMin: 120 }),
            e({ id: 'b', type: 'tv', title: 't', progress: { season: 1, episode: 2, history: [{ date: '2026-01-01', season: 1, episode: 1 }, { date: '2026-01-02', season: 1, episode: 2 }] } }),
            e({ id: 'c', type: 'book', title: 'b', readingProgress: { page: 100, totalPage: 320 } }),
            e({ id: 'd', type: 'game', title: 'g', playtimeMinutes: 240, playSessions: [{ date: '2026-01-01', minutes: 90 }, { date: '2026-01-02', minutes: 150 }] }),
        ];
        const s = durationStats(list);
        expect(s.movieMinutes).toBe(120);
        expect(s.episodes).toBe(2);
        expect(s.bookPages).toBe(320);
        expect(s.playMinutes).toBe(240);
        expect(s.playSessions).toBe(2);
    });
});

describe('pure/stats 月度趋势', () => {
    it('monthlyFinished 按 watchedDate 月份计数', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: 'm1', watchedDate: '2026-01-15' }),
            e({ id: 'b', type: 'movie', title: 'm2', watchedDate: '2026-01-20' }),
            e({ id: 'c', type: 'book', title: 'b1', watchedDate: '2026-05-01' }),
            e({ id: 'd', type: 'movie', title: 'm3', watchedDate: '2025-12-31' }),
        ];
        const mf = monthlyFinished(list, year);
        expect(mf[0]).toBe(2); // 1 月
        expect(mf[4]).toBe(1); // 5 月
        expect(mf[11]).toBe(0); // 12 月无 2026
    });

    it('monthlyActive 含游玩/追更/计划', () => {
        const list = [
            e({ id: 'a', type: 'game', title: 'g', playSessions: [{ date: '2026-03-01', minutes: 30 }] }),
            e({ id: 'b', type: 'tv', title: 't', progress: { season: 1, episode: 1, history: [{ date: '2026-03-10', season: 1, episode: 1 }] } }),
        ];
        const ma = monthlyActive(list, year);
        expect(ma[2]).toBe(2); // 3 月两条动态
    });
});

describe('pure/stats topRatedInYear 高分榜', () => {
    it('仅年内看完且 rating>0，按评分降序', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: '低分', watchedDate: '2026-01-01', rating: 2 }),
            e({ id: 'b', type: 'movie', title: '高分', watchedDate: '2026-02-01', rating: 5 }),
            e({ id: 'c', type: 'movie', title: '未评分', watchedDate: '2026-03-01', rating: 0 }),
            e({ id: 'd', type: 'movie', title: '去年看完', watchedDate: '2025-12-01', rating: 5 }),
        ];
        const top = topRatedInYear(list, year, 2);
        expect(top.map((x) => x.title)).toEqual(['高分', '低分']);
    });
});

describe('pure/stats recentActivity 最近动态（限年内）', () => {
    it('观看/追更进度/计划三类动态入列，往年时间戳不计', () => {
        const list = [
            e({ id: 'a', type: 'movie', title: '新片', watchedDate: '2026-03-10' }),
            e({ id: 'b', type: 'movie', title: '旧片', watchedDate: '2025-12-31' }),
            e({ id: 'c', type: 'tv', title: '追剧', progress: { season: 1, episode: 2, history: [{ date: '2026-04-01', season: 1, episode: 2 }] } }),
            e({ id: 'd', type: 'book', title: '书单', plannedDate: '2026-05-20' }),
            e({ id: 'x', type: 'book', title: '去年计划', plannedDate: '2025-11-01' }),
        ];
        const acts = recentActivity(list, year);
        const texts = acts.map((a) => a.text);
        expect(texts).toContain('观看了《新片》');
        expect(texts).not.toContain('观看了《旧片》');
        expect(texts).toContain('更新了《追剧》进度 S1E2');
        expect(texts).toContain('计划观看《书单》');
        expect(texts).not.toContain('去年计划');
        // 今年 3 条，去年全部剔除
        expect(acts).toHaveLength(3);
    });

    it('按日期倒序取前 limit 条', () => {
        const list = [1, 2, 3, 4, 5].map((i) =>
            e({ id: `m${i}`, type: 'movie', title: `片${i}`, watchedDate: `2026-01-0${i}` }),
        );
        const acts = recentActivity(list, year, 3);
        expect(acts.map((a) => a.date)).toEqual(['2026-01-05', '2026-01-04', '2026-01-03']);
        expect(acts.map((a) => a.text)).toEqual(['观看了《片5》', '观看了《片4》', '观看了《片3》']);
    });

    it('同条目多渠道动态各计一条（观看 + 计划）', () => {
        const one = e({ id: 'a', type: 'game', title: '游戏', watchedDate: '2026-02-01', plannedDate: '2026-02-02' });
        const acts = recentActivity([one], year, 8);
        expect(acts.map((a) => a.text)).toEqual(['计划观看《游戏》', '观看了《游戏》']);
    });
});
