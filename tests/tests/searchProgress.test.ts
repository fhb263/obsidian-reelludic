// 搜索进度上报器（pure/searchProgress）单测
import { describe, it, expect } from 'vitest';
import { createSearchProgress } from 'pure/searchProgress';

describe('createSearchProgress 步骤上报器', () => {
    it('next() 递增 done 并带 label；total 未设定时保持 0 且无 ETA', () => {
        const seen: unknown[] = [];
        const prog = createSearchProgress((p) => seen.push(p));
        prog.next('豆瓣搜索');
        expect(seen[0]).toMatchObject({ done: 1, total: 0, label: '豆瓣搜索' });
        expect((seen[0] as { etaSec?: number }).etaSec).toBeUndefined();
    });

    it('addRemaining(n) 动态设定 total = 当前 done + 剩余步数（详情步数搜索后才知道）', () => {
        const seen: unknown[] = [];
        const prog = createSearchProgress((p) => seen.push(p));
        prog.next('豆瓣搜索'); // done=1
        prog.addRemaining(3); // 还剩 3 步详情 → total=4
        prog.next('豆瓣详情补全 1/3');
        expect((seen[1] as { total: number }).total).toBe(4);
        prog.next('豆瓣详情补全 2/3');
        prog.next('豆瓣详情补全 3/3');
        expect((seen[3] as { done: number }).done).toBe(4);
        expect((seen[3] as { etaSec?: number }).etaSec).toBe(0); // 全部完成
    });

    it('ETA：有剩余步数时给出 ≥1 的预计秒数（线性外推），完成时为 0', () => {
        const seen: unknown[] = [];
        const prog = createSearchProgress((p) => seen.push(p));
        prog.next('搜索'); // done=1, total=0 → 无 ETA
        prog.addRemaining(2); // total=3
        prog.next('详情 1/2');
        const p = seen[1] as { etaSec?: number };
        expect(p.etaSec).toBeGreaterThanOrEqual(1);
        prog.next('详情 2/2');
        expect((seen[2] as { etaSec: number }).etaSec).toBe(0);
    });

    it('无回调时静默可用', () => {
        const prog = createSearchProgress(undefined);
        prog.next('搜索');
        prog.addRemaining(1);
        prog.next('详情');
    });
});

describe('createSearchProgress source 逐源事件', () => {
    it('source() 不推进 done，追加 source 字段（快源先亮不干扰步骤计数）', () => {
        const seen: unknown[] = [];
        const prog = createSearchProgress((p) => seen.push(p));
        prog.source({ id: 'tmdb', state: 'ok', count: 8 });
        const p = seen[0] as { done: number; source?: { id: string; state: string; count?: number } };
        expect(p.done).toBe(0); // 不推进步骤
        expect(p.source).toMatchObject({ id: 'tmdb', state: 'ok', count: 8 });
        prog.next('Douban 搜索');
        expect((seen[1] as { done: number }).done).toBe(1);
    });

    it('source() 与 next() 交错时保持各自语义（done 只随步骤增长）', () => {
        const seen: unknown[] = [];
        const prog = createSearchProgress((p) => seen.push(p));
        prog.next('Douban 搜索'); // done=1
        prog.source({ id: 'steam', state: 'timeout' });
        prog.source({ id: 'igdb', state: 'empty', count: 0 });
        const last = seen[seen.length - 1] as { done: number; source?: { id: string; state: string } };
        expect(last.done).toBe(1);
        expect(last.source?.id).toBe('igdb');
        prog.next('详情补全');
        expect((seen[seen.length - 1] as { done: number }).done).toBe(2);
    });
});
