/**
 * `pure/cancel`（#428）—— 取消令牌 + 「立刻醒过来」的 race。
 *
 * 🔴 这一层要钉住两件事（都是用户实测故障的直接成因）：
 *  ① 取消的**感知延迟为零** —— 不是等下一次轮询、更不是等网络自己超时；
 *  ② 取消是**可分辨的哨兵**（`CancelledError`），调用方据此「什么都不落盘」。
 */
import { describe, expect, it } from 'vitest';
import { CancelledError, createCancelToken, raceCancel } from 'pure/cancel';

/** 一个永不 settle 的 promise（模拟「在飞、且 Node 层没有 abort」的请求） */
function never<T>(): Promise<T> {
    return new Promise<T>(() => {});
}

describe('pure/cancel · 令牌', () => {
    it('初始未取消；`stop()` 后 `stopped` 为真', () => {
        const t = createCancelToken();
        expect(t.stopped).toBe(false);
        t.stop();
        expect(t.stopped).toBe(true);
    });

    it('`stop()` 幂等：连调多次不抛、状态一致，`wait()` 也只被唤醒一次', async () => {
        const t = createCancelToken();
        let woke = 0;
        void t.wait().then(() => {
            woke++;
        });
        t.stop();
        t.stop();
        t.stop();
        await Promise.resolve();
        expect(woke).toBe(1);
        expect(t.stopped).toBe(true);
    });

    it('`wait()` 多次调用拿到**同一个** promise（同一个微任务里一起醒）', () => {
        const t = createCancelToken();
        expect(t.wait()).toBe(t.wait());
    });

    it('`wait()` **永不 reject** —— 取消是正常流程，不是异常', async () => {
        const t = createCancelToken();
        const p = t.wait();
        t.stop();
        await expect(p).resolves.toBeUndefined();
    });
});

describe('pure/cancel · raceCancel', () => {
    it('没传令牌 ⇒ 原样透传（搜索 / 取目录那两条路保持旧行为）', async () => {
        await expect(raceCancel(Promise.resolve(7))).resolves.toBe(7);
    });

    it('未取消时透传原值（在飞的东西照常回来）', async () => {
        const t = createCancelToken();
        await expect(raceCancel(Promise.resolve('正文'), t)).resolves.toBe('正文');
    });

    it('🔴 **在飞的等待上取消 ⇒ 立刻抛哨兵**（这就是「点了没反应」的解法：不等它超时）', async () => {
        const t = createCancelToken();
        const p = raceCancel(never<string>(), t);
        t.stop();
        await expect(p).rejects.toBeInstanceOf(CancelledError);
    });

    it('🔴 取消发生在**开始等之前** ⇒ 连 race 都不进，直接抛', async () => {
        const t = createCancelToken();
        t.stop();
        await expect(raceCancel(Promise.resolve('不该拿到'), t)).rejects.toBeInstanceOf(CancelledError);
    });

    it('取消哨兵的 `name` 固定（便于上层按名字识别，不靠文案）', async () => {
        const t = createCancelToken();
        const p = raceCancel(never<string>(), t);
        t.stop();
        await expect(p).rejects.toHaveProperty('name', 'ReelLudicCancelled');
    });

    it('原 promise 随后才 reject ⇒ **不会**变成 unhandled rejection（race 已挂处理函数）', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (e: unknown): void => {
            unhandled.push(e);
        };
        process.on('unhandledRejection', onUnhandled);
        try {
            const t = createCancelToken();
            let boom: (e: Error) => void = () => {};
            const late = new Promise<string>((_, rej) => {
                boom = rej;
            });
            const p = raceCancel(late, t);
            t.stop();
            await expect(p).rejects.toBeInstanceOf(CancelledError);
            boom(new Error('网络晚到一步才失败'));
            // 多让出几个微任务，给 unhandledRejection 机会冒出来
            await Promise.resolve();
            await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
        expect(unhandled).toEqual([]);
    });
});
