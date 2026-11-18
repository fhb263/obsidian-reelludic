/**
 * m03052 ⑤：B站音乐下载「后台继续」的服务层守卫。
 *
 * 用户原话（逐字）：「给音乐从B站下载并转录的加个后台下载退出弹窗也能继续下载，
 *                  样式复用下载模型的那个悬浮球和进度框」
 *
 * 这个文件钉的是**服务层承诺**（与 UI 无关）：
 *  ⑴ 关掉弹窗 = 少一个订阅者，任务照跑（订阅摘掉后任务仍会完成）；
 *  ⑵ 同一 bvid 幂等 —— 重复点只复用同一条 promise（⛔ 不许写两份文件）；
 *  ⑶ 结局必须留住（`lastBiliOutcome`），否则「退出弹窗再回来」看不到「下好了/为什么失败」；
 *  ⑷ 进度同时喂给悬浮球与订阅者，且订阅回调抛错不能带崩下载。
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const ballUpdates: { percent?: number | null; label?: string; detail?: string }[] = [];
const ballEvents: string[] = [];
/** 🔴 m09805：多任务行的调用记录（一球多行） */
const taskUpserts: { id: string; title: string; percent: number | null; label?: string; speed?: string }[] = [];
const taskFinishes: { id: string; phase: string; detail?: string }[] = [];
/** 当前“活动卡” —— `currentProgressBall()` 返回它，`startProgressBall` 建新的 */
let activeMockHandle: unknown = null;

vi.mock('services/progressBall', () => ({
    startProgressBall: () => {
        ballEvents.push('start');
        const handle = {
            update: (next: { percent?: number | null; label?: string; detail?: string }) => {
                ballUpdates.push(next);
            },
            done: () => ballEvents.push('done'),
            fail: () => ballEvents.push('fail'),
            dismiss: () => ballEvents.push('dismiss'),
            upsertTask: (row: { id: string; title: string; percent: number | null; label?: string; speed?: string }) => {
                taskUpserts.push(row);
            },
            finishTask: (id: string, phase: string, detail?: string) => {
                taskFinishes.push({ id, phase, detail });
            },
            removeTask: () => undefined,
            tasks: () => [] as never,
            isEnded: () => false,
        };
        activeMockHandle = handle;
        return handle;
    },
    currentProgressBall: () => activeMockHandle,
}));

/**
 * ⚠️ 用 `beforeAll` 里的动态 import，不是文件顶层 `await import(...)` ——
 * 后者会触发 `TS1378: Top-level 'await' expressions are only allowed when ...`
 * （本仓 tsconfig 的 module 不是 esnext 系）。`vi.mock` 是提升的，先于此处生效。
 */
type Svc = typeof import('../src/services/biliDownloadService');
let svc: Svc;

beforeAll(async () => {
    svc = await import('../src/services/biliDownloadService');
});

function video(bvid: string, title = '视频标题') {
    return { bvid, title, author: 'UP', duration: 100, play: 1 } as never;
}

/** 可控的 runner：手动决定何时完成、何时上报进度 */
function deferredRunner() {
    let resolveIt: ((v: { ok: boolean; message: string; relPath?: string }) => void) | null = null;
    let progress: ((pct: number | null, label: string) => void) | null = null;
    const runner = vi.fn((_v, onProgress) => {
        progress = onProgress ?? null;
        return new Promise<{ ok: boolean; message: string; relPath?: string }>((res) => {
            resolveIt = res;
        });
    });
    return {
        runner: runner as never,
        calls: () => runner.mock.calls.length,
        emitProgress: (pct: number | null, label: string) => progress?.(pct, label),
        finish: (r: { ok: boolean; message: string; relPath?: string }) => resolveIt?.(r),
    };
}

describe('m03052 ⑤ · B站后台下载服务层', () => {
    it('同一 bvid 重复调用只起一次任务（幂等，⛔ 不许写两份文件）', async () => {
        const d = deferredRunner();
        const a = svc.startBiliDownload(d.runner, video('BV1dup'), '歌名');
        const b = svc.startBiliDownload(d.runner, video('BV1dup'), '歌名');
        expect(d.calls()).toBe(1);
        // 两次拿到的是同一条 promise（否则会各写一份文件）
        expect(a).toBe(b);
        d.finish({ ok: true, message: '好了' });
        await a;
    });

    it('订阅者全部摘掉后任务照样完成（关弹窗 ≠ 取消下载）', async () => {
        const d = deferredRunner();
        const offProgress = svc.onBiliProgress(() => undefined);
        const offOutcome = svc.onBiliOutcome(() => undefined);
        const p = svc.startBiliDownload(d.runner, video('BV2detach'), '歌名');
        // 模拟「用户关掉弹窗」：组件 onDestroy 里摘订阅
        offProgress();
        offOutcome();
        d.finish({ ok: true, message: '后台下好了', relPath: '下载/音乐/歌名.mp3' });
        const out = await p;
        expect(out.ok).toBe(true);
        expect(out.message).toBe('后台下好了');
        expect(out.relPath).toBe('下载/音乐/歌名.mp3');
    });

    it('结局会留在 lastBiliOutcome（重开弹窗要能回显）', async () => {
        const d = deferredRunner();
        const p = svc.startBiliDownload(d.runner, video('BV3last'), '歌名');
        d.finish({ ok: false, message: 'yt-dlp 抽不出音频' });
        await p;
        const last = svc.lastBiliOutcome();
        expect(last?.bvid).toBe('BV3last');
        expect(last?.ok).toBe(false);
        expect(last?.message).toContain('抽不出音频');
    });

    it('进度同时喂给悬浮球的行与订阅者（两处都要看到）', async () => {
        ballUpdates.length = 0;
        taskUpserts.length = 0;
        const seen: { pct: number | null; label: string }[] = [];
        const off = svc.onBiliProgress((_bvid, pct, label) => seen.push({ pct, label }));
        const d = deferredRunner();
        const p = svc.startBiliDownload(d.runner, video('BV4prog'), '歌名');
        d.emitProgress(42, '12.3 / 45.6 MB');
        expect(seen).toEqual([{ pct: 42, label: '12.3 / 45.6 MB' }]);
        // 🔴 m09805 改判：进度进的是**多任务行**（一球多行），⛔ 不再是整球 update
        expect(taskUpserts.some((u) => u.percent === 42)).toBe(true);
        expect(taskUpserts.some((u) => (u.label ?? '').includes('12.3'))).toBe(true);
        expect(taskUpserts.every((u) => u.id === 'bili:BV4prog')).toBe(true);
        off();
        d.finish({ ok: true, message: 'ok' });
        await p;
    });

    it('🔴 m09805 速度从 label 尾部拆出来，单独进 speed（不污染阶段文案）', async () => {
        taskUpserts.length = 0;
        const d = deferredRunner();
        const p = svc.startBiliDownload(d.runner, video('BV4spd'), '歌名');
        // yt-dlp 的产生端把速度拼在 label 尾部（共享回调只有两参，见 splitLabelSpeed 注释）
        d.emitProgress(42, '正在从 B 站下载音频… · 1.2 MB/s');
        const last = taskUpserts[taskUpserts.length - 1];
        expect(last.speed).toBe('1.2 MB/s');
        expect(last.label).toBe('正在从 B 站下载音频…');
        d.finish({ ok: true, message: 'ok' });
        await p;
    });

    it('🔴 m09805 两首并行下载各自占一行，⛔ 不互相顶掉', async () => {
        taskUpserts.length = 0;
        ballEvents.length = 0;
        const d1 = deferredRunner();
        const d2 = deferredRunner();
        const p1 = svc.startBiliDownload(d1.runner, video('BV4par1', '第一首'), '第一首');
        const p2 = svc.startBiliDownload(d2.runner, video('BV4par2', '第二首'), '第二首');
        // 两首都要在跑（旧实现第二首会把第一首的球顶掉）
        expect(svc.isBiliDownloading('BV4par1')).toBe(true);
        expect(svc.isBiliDownloading('BV4par2')).toBe(true);
        expect(taskUpserts.map((u) => u.id)).toEqual(['bili:BV4par1', 'bili:BV4par2']);
        expect(taskUpserts.map((u) => u.title)).toEqual(['第一首', '第二首']);
        d1.finish({ ok: true, message: 'ok1' });
        d2.finish({ ok: true, message: 'ok2' });
        await Promise.all([p1, p2]);
    });

    it('订阅回调抛错不能带崩下载', async () => {
        const off = svc.onBiliProgress(() => {
            throw new Error('订阅者自己的 bug');
        });
        const d = deferredRunner();
        const p = svc.startBiliDownload(d.runner, video('BV5throw'), '歌名');
        expect(() => d.emitProgress(10, 'x')).not.toThrow();
        d.finish({ ok: true, message: '照常完成' });
        const out = await p;
        expect(out.ok).toBe(true);
        off();
    });

    it('没有 bvid 的结果直接给回执，不启动任务', async () => {
        const d = deferredRunner();
        const out = await svc.startBiliDownload(d.runner, video(''), '歌名');
        expect(out.ok).toBe(false);
        expect(out.message).toContain('bvid');
        expect(d.calls()).toBe(0);
    });

    it('任务跑完就不再算「正在下载」（弹窗重开时不会误显示转圈）', async () => {
        const d = deferredRunner();
        const p = svc.startBiliDownload(d.runner, video('BV7done'), '歌名');
        expect(svc.isBiliDownloading('BV7done')).toBe(true);
        expect(svc.runningBiliDownloads()).toContain('BV7done');
        d.finish({ ok: true, message: 'ok' });
        await p;
        expect(svc.isBiliDownloading('BV7done')).toBe(false);
        expect(svc.runningBiliDownloads()).not.toContain('BV7done');
    });

    it('失败时行标 fail、成功时标 done（用户要看得见结局）', async () => {
        taskFinishes.length = 0;
        const d1 = deferredRunner();
        const p1 = svc.startBiliDownload(d1.runner, video('BV8fail'), '歌名');
        d1.finish({ ok: false, message: '失败' });
        await p1;
        // 🔴 m09805 改判：结局落在**那一行**上，⛔ 不再是整球 fail（多任务下不能整球收尾）
        expect(taskFinishes.some((f) => f.id === 'bili:BV8fail' && f.phase === 'fail')).toBe(true);

        const d2 = deferredRunner();
        const p2 = svc.startBiliDownload(d2.runner, video('BV9ok'), '歌名');
        d2.finish({ ok: true, message: '成功' });
        await p2;
        expect(taskFinishes.some((f) => f.id === 'bili:BV9ok' && f.phase === 'done')).toBe(true);
    });
});
