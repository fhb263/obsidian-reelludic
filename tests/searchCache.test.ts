// 搜索结果缓存 单测
import { describe, it, expect } from 'vitest';
import { createSearchCache } from 'pure/searchCache';
import { retry, sleep } from 'pure/timing';

describe('createSearchCache 搜索结果缓存', () => {
    it('命中返回条目；未命中返回 undefined', () => {
        const c = createSearchCache<string>({ ttlMs: 60_000, maxSize: 10 });
        expect(c.get('a')).toBeUndefined();
        c.set('a', ['x', 'y']);
        expect(c.get('a')).toEqual(['x', 'y']);
        expect(c.size).toBe(1);
    });

    it('TTL 过期后视为未命中并清理', async () => {
        const c = createSearchCache<string>({ ttlMs: 30, maxSize: 10 });
        c.set('a', ['x']);
        await sleep(40);
        expect(c.get('a')).toBeUndefined();
        expect(c.size).toBe(0);
    });

    it('maxSize 满时全清（简单淘汰）', () => {
        const c = createSearchCache<number>({ ttlMs: 60_000, maxSize: 2 });
        c.set('a', [1]);
        c.set('b', [2]);
        c.set('c', [3]); // 触发清空
        expect(c.size).toBe(1);
        expect(c.get('c')).toEqual([3]);
        expect(c.get('a')).toBeUndefined();
    });

    it('clear 清空全部', () => {
        const c = createSearchCache<string>({ ttlMs: 60_000, maxSize: 10 });
        c.set('a', ['x']);
        c.clear();
        expect(c.size).toBe(0);
        expect(c.get('a')).toBeUndefined();
    });
});

describe('retry 幂等重试', () => {
    it('成功一次即返回，不重试', async () => {
        let calls = 0;
        const r = await retry(async () => {
            calls++;
            return 'ok';
        }, 3);
        expect(r).toBe('ok');
        expect(calls).toBe(1);
    });

    it('前两次失败、第三次成功', async () => {
        let calls = 0;
        const r = await retry(async () => {
            calls++;
            if (calls < 3) throw new Error(`fail ${calls}`);
            return 'ok';
        }, 3, 1);
        expect(r).toBe('ok');
        expect(calls).toBe(3);
    });

    it('全部失败抛最后一次错误', async () => {
        await expect(retry(async () => { throw new Error('boom'); }, 2, 1)).rejects.toThrow('boom');
    });
});
