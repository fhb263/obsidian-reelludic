// 阶段 1 追更/排期纯逻辑测试：串行限流执行器、排期到期列表、更新提示去重决策
import { describe, it, expect, vi } from 'vitest';
import { runSerialWithDelay, duePlannedEntries, decideUpdateDisplay } from 'pure/tracking';

describe('runSerialWithDelay 串行限流', () => {
    it('按顺序逐条执行（不并发）', async () => {
        const order: number[] = [];
        await runSerialWithDelay([1, 2, 3], async (n) => {
            order.push(n);
        }, 0);
        expect(order).toEqual([1, 2, 3]);
    });

    it('每条之间有间隔（delayMs > 0 生效）', async () => {
        vi.useFakeTimers();
        try {
            const calls: string[] = [];
            const p = runSerialWithDelay(['a', 'b', 'c'], async (s) => {
                calls.push(s);
            }, 100);
            // 第一次调用立即发生（advanceTimersByTime 前）
            expect(calls).toEqual(['a']);
            await vi.advanceTimersByTimeAsync(100);
            expect(calls).toEqual(['a', 'b']);
            await vi.advanceTimersByTimeAsync(100);
            expect(calls).toEqual(['a', 'b', 'c']);
            await p;
        } finally {
            vi.useRealTimers();
        }
    });

    it('空列表直接完成', async () => {
        const fn = vi.fn();
        await runSerialWithDelay([], fn, 100);
        expect(fn).not.toHaveBeenCalled();
    });

    it('fn 抛错时中止后续执行', async () => {
        const calls: string[] = [];
        await expect(
            runSerialWithDelay(['a', 'b', 'c'], async (s) => {
                calls.push(s);
                if (s === 'b') throw new Error('boom');
            }, 0),
        ).rejects.toThrow('boom');
        expect(calls).toEqual(['a', 'b']);
    });
});

describe('duePlannedEntries 排期到期列表', () => {
    const mk = (id: string, status: string, plannedDate?: string) => ({ id, status, plannedDate });

    it('今天到期（plannedDate == today）且想看 → 命中', () => {
        expect(duePlannedEntries([mk('a', 'want', '2026-08-29')], '2026-08-29').map((e) => e.id)).toEqual(['a']);
    });

    it('已过期（plannedDate < today）且想看 → 命中', () => {
        expect(duePlannedEntries([mk('a', 'want', '2026-08-28')], '2026-08-29').map((e) => e.id)).toEqual(['a']);
    });

    it('未来排期不命中', () => {
        expect(duePlannedEntries([mk('a', 'want', '2026-08-30')], '2026-08-29')).toEqual([]);
    });

    it('非想看状态（在看/已看/存档）不命中', () => {
        const entries = [
            mk('a', 'watching', '2026-08-29'),
            mk('b', 'watched', '2026-08-29'),
            mk('c', 'archived', '2026-08-29'),
        ];
        expect(duePlannedEntries(entries, '2026-08-29')).toEqual([]);
    });

    it('无 plannedDate 不命中', () => {
        expect(duePlannedEntries([mk('a', 'want')], '2026-08-29')).toEqual([]);
    });

    it('混合场景只返回到期且想看', () => {
        const entries = [
            mk('a', 'want', '2026-08-29'),
            mk('b', 'want', '2026-08-30'),
            mk('c', 'want', '2026-08-28'),
            mk('d', 'watching', '2026-08-29'),
            mk('e', 'want'),
        ];
        expect(duePlannedEntries(entries, '2026-08-29').map((e) => e.id).sort()).toEqual(['a', 'c']);
    });
});

describe('decideUpdateDisplay 更新提示去重决策', () => {
    it('首次检测（无已知最新）且有落后 → new', () => {
        expect(decideUpdateDisplay(5, undefined, 3)).toBe('new');
    });

    it('最新 > 已知最新 → new（新更新，写回落库）', () => {
        expect(decideUpdateDisplay(5, 3, 3)).toBe('new');
    });

    it('最新 <= 已知最新（已提示过）→ known 不重复标新', () => {
        expect(decideUpdateDisplay(5, 5, 3)).toBe('known');
        expect(decideUpdateDisplay(5, 8, 3)).toBe('known');
    });

    it('已看到最新（最新 <= 已看）→ synced', () => {
        expect(decideUpdateDisplay(5, undefined, 5)).toBe('synced');
        expect(decideUpdateDisplay(5, undefined, 8)).toBe('synced');
        expect(decideUpdateDisplay(5, 5, 5)).toBe('synced');
    });

    it('最新为 0（无信息）→ synced 兜底', () => {
        expect(decideUpdateDisplay(0, undefined, 3)).toBe('synced');
    });
});
