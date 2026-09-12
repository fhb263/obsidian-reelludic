// 「今日记录 / 日记打卡」纯逻辑测试：本地时间口径、当日动态归集、打卡区块渲染与幂等写入。
import { describe, it, expect } from 'vitest';
import { createEmptyEntry, type ActivityEvent, type MediaEntry } from 'data/types';
import {
    JOURNAL_HEADING_PREFIX,
    collectDayActivity,
    localDateOf,
    localTimeOf,
    renderJournalBlock,
    todayLocal,
    upsertJournalSection,
} from 'pure/dailyLog';

/** 按本地时区构造 ISO（测试不受运行环境 TZ 影响） */
const iso = (y: number, m: number, d: number, hh = 0, mm = 0): string =>
    new Date(y, m - 1, d, hh, mm).toISOString();

function entry(partial: Partial<MediaEntry>): MediaEntry {
    return createEmptyEntry(partial);
}

describe('pure/dailyLog 本地时间口径', () => {
    it('localDateOf / localTimeOf 按本地时区取值（非 UTC 切片）', () => {
        expect(localDateOf(iso(2026, 9, 10, 14, 32))).toBe('2026-09-10');
        expect(localTimeOf(iso(2026, 9, 10, 14, 32))).toBe('14:32');
        expect(localTimeOf(iso(2026, 9, 10, 9, 2))).toBe('09:02'); // 补零
        expect(localTimeOf(iso(2026, 9, 10, 0, 0))).toBe('00:00');
    });
    it('非法输入 → 空串（不抛错、不产出 NaN）', () => {
        expect(localDateOf('')).toBe('');
        expect(localDateOf('not-a-date')).toBe('');
        expect(localTimeOf(undefined as unknown as string)).toBe('');
    });
    it('todayLocal 按本地时区给 YYYY-MM-DD', () => {
        expect(todayLocal(new Date(2026, 8, 10, 23, 59))).toBe('2026-09-10');
        expect(todayLocal(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    });
});

describe('pure/dailyLog collectDayActivity', () => {
    const dateStr = '2026-09-10';
    const entries: MediaEntry[] = [
        entry({ id: 'a', type: 'movie', title: '奥本海默', status: 'watched', createdAt: iso(2026, 9, 10, 9, 2) }),
        entry({ id: 'b', type: 'book', title: '沙丘', status: 'watching', createdAt: iso(2026, 9, 9, 8, 0) }),
        entry({ id: 'c', type: 'game', title: '', status: 'archived', createdAt: iso(2026, 9, 10, 18, 5) }),
    ];
    const log: ActivityEvent[] = [
        { at: iso(2026, 9, 10, 20, 15), id: 'b', status: 'watching' },
        { at: iso(2026, 9, 10, 9, 2), id: 'a', status: 'want' },
        { at: iso(2026, 9, 9, 21, 0), id: 'a', status: 'watched' }, // 非当日 → 不计
        { at: iso(2026, 9, 10, 11, 40), id: 'gone', status: 'archived' }, // 条目已删 → 跳过
    ];

    it('新增条目按 createdAt 本地日期归集，空标题回退「未命名」', () => {
        const act = collectDayActivity(entries, log, dateStr);
        expect(act.created.map((x) => x.id)).toEqual(['a', 'c']);
        expect(act.created[0].time).toBe('09:02');
        expect(act.created[1].title).toBe('未命名');
    });
    it('状态变更按当日过滤 + 时间升序，已删条目跳过', () => {
        const act = collectDayActivity(entries, log, dateStr);
        expect(act.statuses.map((x) => `${x.time}:${x.id}:${x.status}`)).toEqual([
            '09:02:a:want',
            '20:15:b:watching',
        ]);
        expect(act.statuses[0].type).toBe('movie');
        expect(act.statuses[1].title).toBe('沙丘');
    });
    it('total = 新增 + 状态变更；日志缺失/脏数据不炸', () => {
        expect(collectDayActivity(entries, log, dateStr).total).toBe(4);
        expect(collectDayActivity(entries, undefined, dateStr).statuses).toEqual([]);
        expect(collectDayActivity([], [{ at: 'x', id: 'a', status: 'want' }], dateStr).total).toBe(0);
    });
});

describe('pure/dailyLog renderJournalBlock', () => {
    const dateStr = '2026-09-10';
    const entries: MediaEntry[] = [
        entry({ id: 'a', type: 'movie', title: '三体', status: 'watched', createdAt: iso(2026, 9, 10, 7, 0) }),
        entry({ id: 'b', type: 'book', title: '沙丘', status: 'watching', createdAt: iso(2026, 9, 9, 7, 0) }),
    ];
    const log: ActivityEvent[] = [
        { at: iso(2026, 9, 10, 14, 32), id: 'a', status: 'watched' },
        { at: iso(2026, 9, 10, 20, 15), id: 'b', status: 'watching' },
    ];

    it('无动态 → null（调用方据此提示、不写文件）', () => {
        expect(renderJournalBlock(dateStr, collectDayActivity(entries, log, '2026-01-01'))).toBeNull();
    });
    it('区块格式：标题 + callout 头 + 状态行（按类型换文案）+ 新增行', () => {
        const block = renderJournalBlock(dateStr, collectDayActivity(entries, log, dateStr));
        expect(block).toBe(
            [
                `${JOURNAL_HEADING_PREFIX}${dateStr}`,
                '> [!reelludic] 今日 3 条动态',
                '> - 14:32 已看《三体》',
                '> - 20:15 在读《沙丘》',
                '> 新增条目 1：三体',
            ].join('\n'),
        );
    });
    it('只有新增（无状态变更）时不渲染状态行', () => {
        const block = renderJournalBlock(dateStr, collectDayActivity(entries, undefined, dateStr));
        expect(block).toBe(
            [`${JOURNAL_HEADING_PREFIX}${dateStr}`, '> [!reelludic] 今日 1 条动态', '> 新增条目 1：三体'].join('\n'),
        );
    });
});

describe('pure/dailyLog upsertJournalSection', () => {
    const dateStr = '2026-09-10';
    const block = [`${JOURNAL_HEADING_PREFIX}${dateStr}`, '> [!reelludic] 今日 1 条动态', '> - 09:02 想看《甲》'].join('\n');

    it('无同名区块 → 追加到文末（空笔记/有内容都成立）', () => {
        expect(upsertJournalSection('', dateStr, block)).toBe(block + '\n');
        expect(upsertJournalSection('今天天气不错。\n', dateStr, block)).toBe(`今天天气不错。\n\n${block}\n`);
    });
    it('已有同名区块 → 整体替换，不重复追加（幂等）', () => {
        const old = [`${JOURNAL_HEADING_PREFIX}${dateStr}`, '> [!reelludic] 今日 1 条动态', '> - 08:00 想看《乙》'].join('\n');
        const once = upsertJournalSection(`# 2026-09-10\n\n${old}\n`, dateStr, block);
        expect(once).toBe(`# 2026-09-10\n\n${block}\n`);
        expect(upsertJournalSection(once, dateStr, block)).toBe(once); // 再执行不变
    });
    it('只替换本区块，后面的章节原样保留', () => {
        const note = `${block}\n\n## 其他段落\n正文\n`;
        const next = upsertJournalSection(note, dateStr, block.replace('今日 1 条动态', '今日 2 条动态'));
        expect(next).toBe(`${block.replace('今日 1 条动态', '今日 2 条动态')}\n\n## 其他段落\n正文\n`);
    });
    it('不误伤相邻日期的区块', () => {
        const other = [`${JOURNAL_HEADING_PREFIX}2026-09-09`, '> [!reelludic] 今日 1 条动态'].join('\n');
        const next = upsertJournalSection(`${other}\n\n${block}\n`, dateStr, block.replace('1 条', '3 条'));
        expect(next).toContain(other); // 09-09 原样保留
        expect(next).toContain('今日 3 条动态'); // 09-10 已更新
        expect(next.indexOf('2026-09-09')).toBeLessThan(next.indexOf('2026-09-10'));
    });
});
