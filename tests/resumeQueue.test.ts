/**
 * 「继续观看 / 阅读」队列的纯逻辑守卫（用户 m07854 ⑪ ①）。
 *
 * 钉的三件事：
 *  ① 只收「在看」且真的有可续位置的条目（`videoPositions` 全 0 / 无 `readingProgress` 都不进）
 *  ② 「最近活跃时间」用 `updatedAt` 倒序，同值时按 id 兜底保证顺序稳定
 *  ③ 视频进度条只在知道 `durationMin` 时才算比例，算不出给 0（⛔ 不猜 50%）
 */
import { describe, expect, it } from 'vitest';
import { buildResumeQueue, resumeSpotOf } from 'pure/resumeQueue';
import type { MediaEntry } from 'data/types';

/** 造一条最小可用条目（只写本模块关心的字段，其余用断言绕开） */
function mk(patch: Partial<MediaEntry>): MediaEntry {
    return {
        id: 'x',
        type: 'movie',
        title: 'T',
        status: 'watching',
        rating: 0,
        genres: [],
        cast: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...patch,
    } as MediaEntry;
}

describe('resumeSpotOf · 只认「在看」且有位置', () => {
    it('非「在看」状态一律不进（想看 / 已看 / 存档）', () => {
        for (const status of ['want', 'watched', 'archived'] as const) {
            expect(resumeSpotOf(mk({ status, videoPositions: { '0': 120 } }))).toBeNull();
        }
    });

    it('视频有正数位置 ⇒ kind=video 且文案是「看到 mm:ss」', () => {
        const spot = resumeSpotOf(mk({ videoPositions: { '0': 754 } }));
        expect(spot).not.toBeNull();
        expect(spot?.kind).toBe('video');
        expect(spot?.text).toBe('看到 12:34');
    });

    it('视频位置全是 0 或负数 ⇒ 视为没播过（不进队列）', () => {
        expect(resumeSpotOf(mk({ videoPositions: { '0': 0, '1': 0 } }))).toBeNull();
        expect(resumeSpotOf(mk({ videoPositions: { '0': -5 } }))).toBeNull();
        expect(resumeSpotOf(mk({ videoPositions: {} }))).toBeNull();
    });

    it('多集时取最大秒数当代表（不会把「看到 40 分钟」说成「看到 2 分钟」）', () => {
        const spot = resumeSpotOf(mk({ videoPositions: { '0': 120, '3': 2400, '1': 60 } }));
        expect(spot?.text).toBe('看到 40:00');
    });

    it('书籍 percent 优先', () => {
        const spot = resumeSpotOf(mk({ type: 'book', readingProgress: { percent: 42.6 } }));
        expect(spot?.kind).toBe('read');
        expect(spot?.text).toBe('读至 43%');
        expect(spot?.percent).toBe(43);
    });

    it('书籍没有 percent 但有 page/totalPage ⇒ 换算并显示页码', () => {
        const spot = resumeSpotOf(mk({ type: 'book', readingProgress: { page: 30, totalPage: 120 } }));
        expect(spot?.text).toBe('读至 30/120 页');
        expect(spot?.percent).toBe(25);
    });

    it('书籍什么都没读 ⇒ null', () => {
        expect(resumeSpotOf(mk({ type: 'book', readingProgress: {} }))).toBeNull();
        expect(resumeSpotOf(mk({ type: 'book' }))).toBeNull();
    });

    it('视频进度条只在知道片长时才算比例，算不出给 0', () => {
        const noDuration = resumeSpotOf(mk({ videoPositions: { '0': 600 } }));
        expect(noDuration?.percent).toBe(0);
        // 片长 20 分钟 = 1200 秒，播到第 600 秒 ⇒ 50%
        const withDuration = resumeSpotOf(mk({ videoPositions: { '0': 600 }, durationMin: 20 }));
        expect(withDuration?.percent).toBe(50);
    });

    it('位置超出片长时钳到 100% 而不是超过', () => {
        const spot = resumeSpotOf(mk({ videoPositions: { '0': 9999 }, durationMin: 10 }));
        expect(spot?.percent).toBe(100);
    });
});

describe('buildResumeQueue · 聚合与排序', () => {
    it('只收在看的、有位置的，其余全过滤掉', () => {
        const queue = buildResumeQueue([
            mk({ id: 'a', status: 'watching', videoPositions: { '0': 60 } }),
            mk({ id: 'b', status: 'want', videoPositions: { '0': 60 } }),
            mk({ id: 'c', status: 'watching' }),
            mk({ id: 'd', type: 'book', status: 'watching', readingProgress: { percent: 10 } }),
        ]);
        expect(queue.map((q) => q.entry.id)).toEqual(['a', 'd']);
    });

    it('按 updatedAt 倒序（最近动过的在前）', () => {
        const queue = buildResumeQueue([
            mk({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z', videoPositions: { '0': 10 } }),
            mk({ id: 'new', updatedAt: '2026-06-01T00:00:00.000Z', videoPositions: { '0': 10 } }),
            mk({ id: 'mid', updatedAt: '2026-03-01T00:00:00.000Z', videoPositions: { '0': 10 } }),
        ]);
        expect(queue.map((q) => q.entry.id)).toEqual(['new', 'mid', 'old']);
    });

    it('updatedAt 相同时按 id 兜底 ⇒ 顺序稳定，不会每次重排跳位', () => {
        const same = '2026-05-05T00:00:00.000Z';
        const queue = buildResumeQueue([
            mk({ id: 'c', updatedAt: same, videoPositions: { '0': 10 } }),
            mk({ id: 'a', updatedAt: same, videoPositions: { '0': 10 } }),
            mk({ id: 'b', updatedAt: same, videoPositions: { '0': 10 } }),
        ]);
        expect(queue.map((q) => q.entry.id)).toEqual(['a', 'b', 'c']);
    });

    it('空输入 ⇒ 空队列（不抛）', () => {
        expect(buildResumeQueue([])).toEqual([]);
    });
});
