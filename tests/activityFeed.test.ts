// 统计页「动态」时间轴测试：日历范围（日/周/月/年）、多源归并去重、排序、行首时间文案。
import { describe, it, expect } from 'vitest';
import { createEmptyEntry, type ActivityEvent, type MediaEntry } from 'data/types';
import {
    collectFeed,
    feedSectionLabel,
    feedSpan,
    formatFeedTime,
    groupFeed,
    isoWeekOf,
    renderPeriodBlock,
    type FeedItem,
} from 'pure/activityFeed';

/** 本地时区构造 ISO（测试不受运行环境 TZ 影响） */
const iso = (y: number, m: number, d: number, hh = 0, mm = 0): string =>
    new Date(y, m - 1, d, hh, mm).toISOString();

// createEmptyEntry 默认把 createdAt 设为「现在」→ 会让每个夹具都多出一条「新增」事件，
// 故这里默认把 createdAt 挪到范围外，只在本用例显式覆盖时才参与归集
const OUT_OF_RANGE = '2020-01-01T00:00:00.000Z';
const entry = (partial: Partial<MediaEntry>): MediaEntry =>
    createEmptyEntry({ createdAt: OUT_OF_RANGE, updatedAt: OUT_OF_RANGE, ...partial });

describe('pure/activityFeed feedSpan 日历范围', () => {
    it('日 = 当天', () => {
        expect(feedSpan('day', new Date(2026, 8, 10, 15, 0))).toEqual({ start: '2026-09-10', end: '2026-09-10', label: '9月10日' });
    });
    it('周 = 本周（周一起算），含跨月', () => {
        // 2026-09-10 是周四 → 本周 09-07(一) ~ 09-13(日)
        expect(feedSpan('week', new Date(2026, 8, 10))).toEqual({ start: '2026-09-07', end: '2026-09-13', label: '第 37 周（9月7日–9月13日）' });
        // 周日属当周（不是下周）：2026-09-13 是周日
        expect(feedSpan('week', new Date(2026, 8, 13)).start).toBe('2026-09-07');
        // 跨月：2026-10-01 是周四 → 09-28 ~ 10-04
        expect(feedSpan('week', new Date(2026, 9, 1))).toEqual({ start: '2026-09-28', end: '2026-10-04', label: '第 40 周（9月28日–10月4日）' });
        // 跨年：2026-01-01 是周四 → 2025-12-29 ~ 2026-01-04
        expect(feedSpan('week', new Date(2026, 0, 1)).start).toBe('2025-12-29');
    });
    it('月 = 当月（月末天数正确，含闰年 2 月）', () => {
        expect(feedSpan('month', new Date(2026, 8, 10))).toEqual({ start: '2026-09-01', end: '2026-09-30', label: '2026年9月' });
        expect(feedSpan('month', new Date(2026, 1, 5)).end).toBe('2026-02-28');
        expect(feedSpan('month', new Date(2028, 1, 5)).end).toBe('2028-02-29'); // 闰年
        expect(feedSpan('month', new Date(2026, 3, 5)).end).toBe('2026-04-30');
    });
    it('年 = 当年', () => {
        expect(feedSpan('year', new Date(2026, 8, 10))).toEqual({ start: '2026-01-01', end: '2026-12-31', label: '2026年' });
    });
});

describe('pure/activityFeed isoWeekOf（ISO-8601 周号）', () => {
    it('常规与跨年边界（ISO 周四定归属）', () => {
        expect(isoWeekOf(new Date(2026, 8, 10))).toBe(37); // 2026-09-10 周四
        expect(isoWeekOf(new Date(2026, 0, 1))).toBe(1);
        expect(isoWeekOf(new Date(2025, 11, 29))).toBe(1); // 2025-12-29 属 2026 年第 1 周
        expect(isoWeekOf(new Date(2028, 1, 29))).toBe(9);
    });
});

describe('pure/activityFeed collectFeed 归并与去重', () => {
    const span = feedSpan('day', new Date(2026, 8, 10));

    it('范围过滤：范围外的事件一律不出现', () => {
        const e = entry({ id: 'a', type: 'movie', title: '沙丘', status: 'watched', createdAt: iso(2026, 9, 9, 8, 0), watchedDate: '2026-09-09' });
        const log: ActivityEvent[] = [{ at: iso(2026, 9, 9, 20, 0), id: 'a', status: 'watched' }];
        expect(collectFeed([e], log, span)).toEqual([]);
    });

    it('状态变更 + 新增：带精确时刻，文案为类型化状态标签', () => {
        const e = entry({ id: 'a', type: 'book', title: '百年孤独', status: 'watched', createdAt: iso(2026, 9, 10, 9, 5) });
        const log: ActivityEvent[] = [{ at: iso(2026, 9, 10, 20, 36), id: 'a', status: 'watched' }];
        const feed = collectFeed([e], log, span);
        expect(feed.map((f) => `${f.kind}|${f.time}|${f.text}`)).toEqual(['status|20:36|已读', 'created|09:05|新增']);
        expect(feed[0].title).toBe('百年孤独');
        expect(feed[0].status).toBe('watched');
    });

    it('同「条目 + 日期」已有状态变更 → 不再补计划 / 完成日期（避免一行变两行）', () => {
        const e = entry({ id: 'a', type: 'movie', title: '沙丘', status: 'watched', plannedDate: '2026-09-10', watchedDate: '2026-09-10' });
        const log: ActivityEvent[] = [{ at: iso(2026, 9, 10, 14, 32), id: 'a', status: 'watched' }];
        const feed = collectFeed([e], log, span);
        expect(feed).toHaveLength(1);
        expect(feed[0].kind).toBe('status');
    });

    it('旧数据无日志 → 由完成日期 / 计划日期兜底（无时刻）', () => {
        const e = entry({ id: 'a', type: 'book', title: '熊出没', status: 'watched', watchedDate: '2026-09-10' });
        const feed = collectFeed([e], undefined, span);
        expect(feed).toHaveLength(1);
        expect(feed[0]).toMatchObject({ kind: 'watch', date: '2026-09-10', text: '已读' });
        expect(feed[0].time).toBeUndefined();
    });

    it('追更历史与游玩记录按日期归集；游玩文案用小时', () => {
        const tv = entry({ id: 't', type: 'tv', title: '剧', status: 'watching', progress: { season: 1, episode: 2, history: [{ season: 1, episode: 2, date: '2026-09-10' }] } });
        const game = entry({ id: 'g', type: 'game', title: '游戏', status: 'watching', playSessions: [{ date: '2026-09-10', minutes: 90 }] });
        const feed = collectFeed([tv, game], undefined, span);
        expect(feed.map((f) => `${f.text}:${f.detail}`).sort()).toEqual(['游玩:1.5h', '追更:S1E2']);
    });

    it('已删除条目的状态记录跳过；空标题回退「未命名」', () => {
        const log: ActivityEvent[] = [{ at: iso(2026, 9, 10, 10, 0), id: 'gone', status: 'watched' }];
        expect(collectFeed([], log, span)).toEqual([]);
        const blank = entry({ id: 'b', type: 'movie', title: '   ', watchedDate: '2026-09-10' });
        expect(collectFeed([blank], undefined, span)[0].title).toBe('未命名');
    });

    it('倒序：日期 desc；同日有时刻的按时刻倒序，仅日期的排当天最后', () => {
        const a = entry({ id: 'a', type: 'movie', title: 'A', status: 'want' });
        const b = entry({ id: 'b', type: 'movie', title: 'B', status: 'want', plannedDate: '2026-09-10' }); // 当天无状态变更 → 计划事件保留
        const log: ActivityEvent[] = [
            { at: iso(2026, 9, 10, 9, 0), id: 'a', status: 'want' },
            { at: iso(2026, 9, 10, 21, 30), id: 'a', status: 'watched' },
        ];
        const feed = collectFeed([a, b], log, span);
        expect(feed.map((f) => f.time ?? '—')).toEqual(['21:30', '09:00', '—']); // 同日仅日期的计划排最后
        expect(feed[2]).toMatchObject({ kind: 'plan', id: 'b' });
    });

    it('跨日倒序：新日期在前', () => {
        const a = entry({ id: 'a', type: 'book', title: 'A', status: 'watched', watchedDate: '2026-09-08' });
        const b = entry({ id: 'b', type: 'book', title: 'B', status: 'watched', watchedDate: '2026-09-10' });
        const feed = collectFeed([a, b], undefined, feedSpan('week', new Date(2026, 8, 10)));
        expect(feed.map((f) => f.date)).toEqual(['2026-09-10', '2026-09-08']);
    });

    it('周/月范围能带出跨日期的历史事件', () => {
        const e = entry({ id: 'a', type: 'movie', title: 'A', status: 'watched', watchedDate: '2026-09-08' });
        expect(collectFeed([e], undefined, feedSpan('day', new Date(2026, 8, 10)))).toHaveLength(0);
        expect(collectFeed([e], undefined, feedSpan('week', new Date(2026, 8, 10)))).toHaveLength(1);
        expect(collectFeed([e], undefined, feedSpan('month', new Date(2026, 8, 10)))).toHaveLength(1);
        expect(collectFeed([e], undefined, feedSpan('year', new Date(2026, 8, 10)))).toHaveLength(1);
    });
});

describe('pure/activityFeed groupFeed 周期汇总（周/月/年）', () => {
    const week = feedSpan('week', new Date(2026, 8, 10));
    /** 2026-09-07 ~ 09-13 期间的几条动态 */
    const items = collectFeed(
        [
            entry({ id: 'b1', type: 'book', title: '百年孤独', status: 'watched', watchedDate: '2026-09-08' }),
            entry({ id: 'b2', type: 'book', title: '活着', status: 'watched', watchedDate: '2026-09-09' }),
            entry({ id: 'm1', type: 'movie', title: '咒', status: 'watched', watchedDate: '2026-09-10' }),
            entry({ id: 'm2', type: 'movie', title: '沙丘', status: 'watching' }), // 「在看」行由状态日志产生
            entry({ id: 't1', type: 'tv', title: '剧名', status: 'watching', progress: { season: 1, episode: 2, history: [{ season: 1, episode: 2, date: '2026-09-10' }] } }),
        ],
        [{ at: iso(2026, 9, 10, 20, 0), id: 'm2', status: 'watching' }],
        week,
    );

    it('周视图按「日」分块（每天一块，块内归并行）', () => {
        const groups = groupFeed(items, 'week');
        expect(groups.map((g) => g.label)).toEqual(['9月10日', '9月9日', '9月8日']); // 只有有动态的日期
        expect(groups.map((g) => g.total)).toEqual([3, 1, 1]);
        expect(groups[0].rows.map((r) => `${r.label}(${r.items.map((i) => i.title).join(',')})`)).toEqual([
            '在看(沙丘)', // 状态类在前
            '已看(咒)',
            '追更(剧名)',
        ]);
        expect(groups[2].rows[0].items[0].title).toBe('百年孤独');
    });

    it('月视图按「周」分块（周标题 + 周区间）', () => {
        const groups = groupFeed(items, 'month');
        expect(groups.map((g) => g.label)).toEqual(['第 37 周']);
        expect(groups[0].range).toBe('9月7日–9月13日');
        expect(groups[0].total).toBe(5);
        expect(groups[0].rows.map((r) => `${r.label}(${r.items.map((i) => i.title).join(',')})`)).toEqual([
            '在看(沙丘)',
            '已读(活着,百年孤独)',
            '已看(咒)',
            '追更(剧名)',
        ]);
    });

    it('同一行内按条目去重（同一作品列一次）', () => {
        const dup = collectFeed(
            [
                entry({ id: 'x', type: 'book', title: '重复书', status: 'watched', watchedDate: '2026-09-08' }),
                { ...entry({ id: 'x', type: 'book', title: '重复书', status: 'watched' }), title: '重复书' } as never,
            ].filter((v, i) => i === 0),
            undefined,
            week,
        );
        const rows = groupFeed([...dup, ...dup], 'week')[0].rows;
        expect(rows[0].items).toHaveLength(1);
    });

    it('年视图按月分组（最新月在前，组标题 M月）', () => {
        const yearItems = collectFeed(
            [
                entry({ id: 'a', type: 'book', title: '八月书', status: 'watched', watchedDate: '2026-08-29' }),
                entry({ id: 'b', type: 'book', title: '九月书', status: 'watched', watchedDate: '2026-09-10' }),
            ],
            undefined,
            feedSpan('year', new Date(2026, 8, 10)),
        );
        const groups = groupFeed(yearItems, 'year');
        expect(groups.map((g) => g.label)).toEqual(['9月', '8月']);
        expect(groups[0].range).toBeUndefined();
        expect(groups[0].rows[0].items[0].title).toBe('九月书');
        expect(groups[0].total).toBe(1);
    });

    it('追更细节保留在 detail（行内拼在标题后）', () => {
        const rows = groupFeed(items, 'month')[0].rows;
        const track = rows.find((r) => r.label === '追更')!;
        expect(track.items[0].detail).toBe('S1E2');
    });
});

describe('pure/activityFeed formatFeedTime 行首时间文案', () => {
    const base: FeedItem = { id: 'a', title: 'A', type: 'movie', kind: 'status', date: '2026-09-08', time: '20:36', text: '已看' };
    it('日视图：只给 HH:mm；仅日期事件给空串', () => {
        expect(formatFeedTime(base, 'day')).toBe('20:36');
        expect(formatFeedTime({ ...base, time: undefined }, 'day')).toBe('');
    });
    it('周/月/年：M月D日 [HH:mm]', () => {
        expect(formatFeedTime(base, 'week')).toBe('9月8日 20:36');
        expect(formatFeedTime({ ...base, time: undefined }, 'month')).toBe('9月8日');
        expect(formatFeedTime(base, 'year')).toBe('9月8日 20:36');
    });
});

describe('pure/activityFeed 周期打卡区块（记录到日记跟随范围）', () => {
    const weekSpan = feedSpan('week', new Date(2026, 8, 10));

    it('区块标识：日=日期 / 周=第N周（起–止）/ 月=YYYY-MM / 年=YYYY', () => {
        expect(feedSectionLabel('day', feedSpan('day', new Date(2026, 8, 10)))).toBe('2026-09-10');
        expect(feedSectionLabel('week', weekSpan)).toBe('第 37 周（2026-09-07–09-13）');
        expect(feedSectionLabel('month', feedSpan('month', new Date(2026, 8, 10)))).toBe('2026-09');
        expect(feedSectionLabel('year', feedSpan('year', new Date(2026, 8, 10)))).toBe('2026');
    });

    it('周块按日分块渲染，含归并行与追更细节；空周期 → null', () => {
        const items = collectFeed(
            [
                entry({ id: 'b1', type: 'book', title: '百年孤独', status: 'watched', watchedDate: '2026-09-08' }),
                entry({ id: 'm1', type: 'movie', title: '咒', status: 'watched', watchedDate: '2026-09-10' }),
                entry({ id: 't1', type: 'tv', title: '剧名', status: 'watching', progress: { season: 1, episode: 2, history: [{ season: 1, episode: 2, date: '2026-09-10' }] } }),
            ],
            undefined,
            weekSpan,
        );
        const block = renderPeriodBlock('week', weekSpan, groupFeed(items, 'week'))!;
        expect(block.split('\n')).toEqual([
            '## ReelLudic 打卡 · 第 37 周（2026-09-07–09-13）',
            '> [!reelludic] 本周 3 条动态',
            '> **9月10日**（2 条）',
            '> - 已看《咒》',
            '> - 追更《剧名》 S1E2',
            '> **9月8日**（1 条）',
            '> - 已读《百年孤独》',
        ]);
        expect(renderPeriodBlock('week', weekSpan, [])).toBeNull();
    });

    it('月块按周分块渲染（周标题带区间）', () => {
        const items = collectFeed(
            [entry({ id: 'm1', type: 'movie', title: '咒', status: 'watched', watchedDate: '2026-09-10' })],
            undefined,
            feedSpan('month', new Date(2026, 8, 10)),
        );
        const block = renderPeriodBlock('month', feedSpan('month', new Date(2026, 8, 10)), groupFeed(items, 'month'))!;
        expect(block.split('\n')[2]).toBe('> **第 37 周**（9月7日–9月13日）（1 条）');
        expect(block.split('\n')[3]).toBe('> - 已看《咒》');
    });
});
