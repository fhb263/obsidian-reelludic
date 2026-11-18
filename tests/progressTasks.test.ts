/**
 * 🔴 m09805（用户逐字）：「音乐条目从B站下载音频能不能多线程，右下角悬浮球进度框如加个待下载3个
 * （列出三个下载进度条，要区分每个下载的是什么标题，再加个如1MB/s等展示速度）」
 *
 * 本文件钉的是**多任务进度卡的纯逻辑口径**，与 DOM 无关：
 *  ⑴ 汇总百分比：任一在跑任务无百分比 ⇒ 汇总 null（⛔ 不许“跳过 null 只平均有的”）；
 *  ⑵ 标题：单任务用标题，多任务用「N 个任务正在下载」；
 *  ⑶ 速度：拆 / 合 / 归一化；
 *  ⑷ 行增删：upsert 不重复、收尾保留、移除到空才该关卡。
 */

import { describe, expect, it } from 'vitest';
import {
    finishTaskRow,
    formatSpeedBytes,
    isSpeedToken,
    parseSpeedBytes,
    removeTaskRow,
    speedSummary,
    splitLabelSpeed,
    taskBarPercent,
    taskRowTip,
    tasksAlive,
    tasksDetail,
    tasksPercent,
    tasksTitle,
    upsertTaskRow,
    type ProgressTaskRow,
} from 'pure/progressTasks';

function row(over: Partial<ProgressTaskRow> = {}): ProgressTaskRow {
    return { id: 'a', title: '七里香', percent: null, phase: 'running', ...over };
}

describe('m09805 · 汇总百分比', () => {
    it('两首各 50% ⇒ 50%', () => {
        expect(tasksPercent([row({ id: 'a', percent: 50 }), row({ id: 'b', percent: 50 })])).toBe(50);
    });

    it('🔴 任一在跑任务没有百分比 ⇒ null（⛔ 不许跳过 null 只平均有的）', () => {
        // 这一条就是防「3 个任务里 2 个不知道进度、1 个 100%」被算成 100% 的假象
        const rows = [row({ id: 'a', percent: 100 }), row({ id: 'b', percent: null })];
        expect(tasksPercent(rows)).toBeNull();
    });

    it('全部收尾且无失败 ⇒ 100；有失败 ⇒ null（⛔ 别画满环掩盖失败）', () => {
        expect(tasksPercent([row({ id: 'a', percent: 100, phase: 'done' })])).toBe(100);
        expect(tasksPercent([row({ id: 'a', percent: 100, phase: 'fail' })])).toBeNull();
    });

    it('空列表 ⇒ null', () => {
        expect(tasksPercent([])).toBeNull();
    });
});

describe('m09805 · 卡片标题与细节', () => {
    it('单任务用标题本身（与旧单任务卡文案一致，⛔ 别变「1 个任务：…」）', () => {
        expect(tasksTitle([row({ title: '七里香' })])).toBe('七里香');
    });

    it('多任务显示「N 个任务正在下载」', () => {
        expect(tasksTitle([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])).toBe('3 个任务正在下载');
    });

    it('全成功 ⇒ 「N 个任务已完成」；有失败 ⇒ 带失败数', () => {
        expect(tasksTitle([row({ id: 'a', phase: 'done' }), row({ id: 'b', phase: 'done' })])).toBe('2 个任务已完成');
        expect(tasksTitle([row({ id: 'a', phase: 'done' }), row({ id: 'b', phase: 'fail' })])).toBe('2 个任务结束（1 个失败）');
        expect(tasksTitle([row({ id: 'a', phase: 'fail' })])).toBe('1 个任务失败');
    });

    it('空列表回落到兜底文案（⛔ 不给空串，卡头会塌）', () => {
        expect(tasksTitle([], '进行中')).toBe('进行中');
    });

    it('单任务细节 = 细节 · 速度', () => {
        expect(tasksDetail([row({ detail: '12.3 / 45.6 MB', speed: '1.2 MB/s' })])).toBe('12.3 / 45.6 MB · 1.2 MB/s');
    });

    it('多任务细节 = 完成数 + 在跑任务的速度合计（⛔ 不算已完成的历史速度）', () => {
        const rows = [
            row({ id: 'a', percent: 100, phase: 'done', speed: '' }),
            row({ id: 'b', percent: 50, speed: '1 MB/s' }),
            row({ id: 'c', percent: 50, speed: '800 KB/s' }),
        ];
        // 1 MB/s + 800 KB/s = 1.8 MB/s
        expect(tasksDetail(rows)).toBe('已完成 1 / 3 · 1.8 MB/s');
    });
});

describe('m09805 · 速度解析与归一', () => {
    it('认 `<数字> <单位>/s`', () => {
        expect(isSpeedToken('1.2 MB/s')).toBe(true);
        expect(isSpeedToken('800 KB/s')).toBe(true);
        expect(isSpeedToken('12 B/s')).toBe(true);
        expect(isSpeedToken('1.2 MiB/s')).toBe(true);
        expect(isSpeedToken('正在下载')).toBe(false);
        expect(isSpeedToken('50%')).toBe(false);
    });

    it('字节换算：KB→1024、MiB 也当 MiB 算', () => {
        expect(parseSpeedBytes('1 KB/s')).toBe(1024);
        expect(parseSpeedBytes('1.5 MB/s')).toBe(Math.round(1.5 * 1024 ** 2));
        expect(parseSpeedBytes('1 MiB/s')).toBe(1024 ** 2);
        expect(parseSpeedBytes('乱写')).toBeNull();
    });

    it('格式化：B/s 取整、其余一位小数、过大取整', () => {
        expect(formatSpeedBytes(512)).toBe('512 B/s');
        // 1024 B = 1 KB（⛔ 别把 1280 字节当 MB 写）
        expect(formatSpeedBytes(1024 * 1.25)).toBe('1.3 KB/s');
        expect(formatSpeedBytes(1024 ** 2 * 1.25)).toBe('1.3 MB/s');
        expect(formatSpeedBytes(1024 * 2.0)).toBe('2.0 KB/s');
        expect(formatSpeedBytes(0)).toBe('');
        expect(formatSpeedBytes(Number.NaN)).toBe('');
    });

    it('speedSummary 只算在跑行；都认不出 ⇒ 空串（⛔ 不编一个假数）', () => {
        expect(speedSummary([row({ speed: '1 MB/s' })])).toBe('1.0 MB/s');
        expect(speedSummary([row({ speed: '乱写' })])).toBe('');
        expect(speedSummary([row({ speed: '1 MB/s', phase: 'done' })])).toBe('');
    });

    it('🔴 splitLabelSpeed：只拆末段的速度，阶段文案里的 · 不动', () => {
        expect(splitLabelSpeed('正在从 B 站下载音频… · 1.2 MB/s')).toEqual({
            label: '正在从 B 站下载音频…',
            speed: '1.2 MB/s',
        });
        // 不含速度 ⇒ 原样返回
        expect(splitLabelSpeed('正在转为 mp3…')).toEqual({ label: '正在转为 mp3…', speed: '' });
        // 末段不是速度 ⇒ 不拆（⛔ 别把「已完成 2 / 3」当成速度）
        expect(splitLabelSpeed('已完成 2 / 3 · 还在跑')).toEqual({ label: '已完成 2 / 3 · 还在跑', speed: '' });
        expect(splitLabelSpeed('')).toEqual({ label: '', speed: '' });
    });
});

describe('m09805 · 行的增删', () => {
    it('同 id 复用原位置（⛔ 不追加第二行）', () => {
        const rows = [row({ id: 'a' }), row({ id: 'b' })];
        const next = upsertTaskRow(rows, row({ id: 'b', percent: 30 }));
        expect(next.map((r) => r.id)).toEqual(['a', 'b']);
        expect(next[1].percent).toBe(30);
        expect(next).toHaveLength(2);
    });

    it('新 id 追加到末尾（⛔ 不重排 —— 行跳来跳去比顺序不完美更糟）', () => {
        const rows = [row({ id: 'a', percent: 80 })];
        const next = upsertTaskRow(rows, row({ id: 'b', percent: 10 }));
        expect(next.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('收尾：成功进 100%，失败保留原百分比（⛔ 归零像白下一趟）', () => {
        const done = finishTaskRow([row({ percent: 42 })], 'a', 'done');
        expect(done[0].percent).toBe(100);
        expect(done[0].speed).toBe('');
        const fail = finishTaskRow([row({ percent: 42 })], 'a', 'fail');
        expect(fail[0].percent).toBe(42);
        expect(fail[0].label).toBe('失败');
    });

    it('收尾不存在的 id ⇒ 原样（不抛）', () => {
        const rows = [row({ id: 'a' })];
        expect(finishTaskRow(rows, 'zzz', 'done')).toEqual(rows);
    });

    it('摘行：摘到空 ⇒ 该关卡；摘不存在 ⇒ 原样', () => {
        const rows = [row({ id: 'a' }), row({ id: 'b' })];
        expect(removeTaskRow(rows, 'a').map((r) => r.id)).toEqual(['b']);
        expect(tasksAlive(removeTaskRow([row({ id: 'a' })], 'a'))).toBe(false);
        expect(removeTaskRow(rows, 'zzz')).toEqual(rows);
        expect(tasksAlive(rows)).toBe(true);
    });

    it('行的提示文案：在跑带百分比、收尾不带（⛔ 别残留 87%）', () => {
        expect(taskRowTip(row({ percent: 42, label: '下载中', speed: '1 MB/s' }))).toBe('七里香 · 下载中 · 42% · 1 MB/s');
        expect(taskRowTip(row({ phase: 'done', percent: 100 }))).toBe('七里香 · ✓ 已完成');
    });

    it('taskBarPercent：夹 0..100 取整，非有限数 ⇒ null（⛔ 不返 0）', () => {
        expect(taskBarPercent(42.6)).toBe(43);
        expect(taskBarPercent(-5)).toBe(0);
        expect(taskBarPercent(999)).toBe(100);
        expect(taskBarPercent(null)).toBeNull();
        expect(taskBarPercent(Number.NaN)).toBeNull();
    });
});
