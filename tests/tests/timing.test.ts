// 接口耗时测量与超时控制 单测
import { describe, it, expect } from 'vitest';
import { measure, withTimeout, timingLevel, TimedError, NORMAL_MS, SLOW_MS, TIMEOUT_MS } from 'pure/timing';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('measure 耗时测量', () => {
    /**
     * 🔴 计时断言的容差：Node 的 `setTimeout` 允许**提前不到 1ms** 触发，而 `measure` 用
     * `Math.round(performance.now() - start)` 取整 ⇒ 睡眠 20ms 会偶尔量到 19ms
     * （全量并行跑、机器繁忙时更明显，2026-09-27 实测一次）。
     * ⛔ 别把下界写死成睡眠时长本身 —— 那会让「全量 0 失败」这个门禁**偶发变红**。
     */
    const SLACK_MS = 1;

    it('成功路径：返回结果与 elapsedMs', async () => {
        const { elapsedMs, result } = await measure(async () => {
            await sleep(20);
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(elapsedMs).toBeGreaterThanOrEqual(20 - SLACK_MS);
        expect(elapsedMs).toBeLessThan(2000);
    });

    it('失败路径：抛 TimedError 且附带耗时', async () => {
        const t = async () => {
            await sleep(15);
            throw new Error('boom');
        };
        try {
            await measure(t);
            expect.unreachable();
        } catch (e) {
            expect(e).toBeInstanceOf(TimedError);
            expect((e as TimedError).elapsedMs).toBeGreaterThanOrEqual(15 - SLACK_MS);
            expect((e as TimedError).message).toBe('boom');
        }
    });
});

describe('withTimeout 超时控制', () => {
    it('按时完成则 resolve 且清定时器', async () => {
        await expect(withTimeout(sleep(5).then(() => 'ok'), 500)).resolves.toBe('ok');
    });

    it('超时则 reject 且消息含阈值', async () => {
        const t = async () => withTimeout(sleep(200), 20, 'TMDB 连接');
        await expect(t()).rejects.toThrow('TMDB 连接超时（>20ms）');
    });
});

describe('timingLevel 分档', () => {
    it('阈值边界正确', () => {
        expect(timingLevel(0)).toBe('normal');
        expect(timingLevel(NORMAL_MS)).toBe('normal');
        expect(timingLevel(NORMAL_MS + 1)).toBe('slow');
        expect(timingLevel(SLOW_MS)).toBe('slow');
        expect(timingLevel(SLOW_MS + 1)).toBe('fail');
        expect(timingLevel(TIMEOUT_MS)).toBe('fail');
    });
});
