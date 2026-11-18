/**
 * `services/linkCheck` 的**硬截止**与**停止信号**（2026-11-17 用户报障 ⑥-A）。
 *
 * 用户原话：「『失效性链接检测』按钮按一下后误退出仍显示『检测中』、最终无结果弹窗」。
 *
 * 根因（不是文案）：`nodeHttpGet` 的 `TIMEOUT_MS` 是 **socket 空闲超时**、不是整条请求的截止时间，
 * 且全库成百条地址串行跑 ⇒ 整趟可能几分钟不落定；期间没有任何中途出口，
 * 用户只能按 ✕ 关窗，而关窗后 `finishScan()` 静默 no-op ⇒ 结果彻底丢失。
 *
 * 这组用例盯的就是那两条结构性质：
 *   ⑴ 单条 `t.get` 永不 resolve ⇒ `checkOne` 仍必须在 `timeoutMs` 后落定（记 `unknown`，⛔ 不是 dead）；
 *   ⑵ `signal.stopped = true` ⇒ 不再发新请求，但**已经探到的结果必须照常返回**。
 *
 * ⚠️ 这里用假 transport（对象字面量）而不是真 `DlTransport`：被测判据是调度与截止，
 *    与真实 HTTP 无关；`DlTransport` 是 `import type`，运行时没有依赖。
 */
import { describe, expect, it } from 'vitest';
import { checkEpisodeLinks, LINK_CHECK_TIMEOUT_MS } from 'services/linkCheck';
import type { DlTransport } from 'services/dl';

/** 永不落定的 `get`：模拟「握手成功但服务器不回包」——正是拖死整趟扫描的那类地址 */
const hangingGet = (): Promise<never> => new Promise<never>(() => { /* 刻意不 resolve */ });

function transportWith(get: (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>): DlTransport {
    return {
        get,
        post: get,
        getBuffer: async () => ({ status: 200, buffer: Buffer.from(''), headers: {}, finalUrl: '' }),
    } as unknown as DlTransport;
}

describe('linkCheck · 单条硬截止', () => {
    it('`get` 永不落定也不许拖死整趟：到点记 unknown（⛔ 不是 dead）', async () => {
        const t = transportWith(() => hangingGet());
        const started = Date.now();
        const out = await checkEpisodeLinks(t, ['https://example.com/a'], undefined, { timeoutMs: 40 });
        const elapsed = Date.now() - started;
        expect(out).toEqual(['unknown']);
        // 真被截止住了（留足余量，CI 上计时会抖；关键是「远小于 30s」而不是精确毫秒）
        expect(elapsed).toBeLessThan(2000);
    });

    it('超时记 unknown 而不是 dead：否则会诱导用户把好链接一键清掉', async () => {
        const t = transportWith(() => hangingGet());
        const out = await checkEpisodeLinks(t, ['https://example.com/a'], undefined, { timeoutMs: 20 });
        expect(out[0]).toBe('unknown');
        expect(out[0]).not.toBe('dead');
    });

    it('缺省 timeoutMs 用 `LINK_CHECK_TIMEOUT_MS`（导出的常量是可核对的契约值）', () => {
        // 只钉「有值且是有限正数」：具体数值属于调参，不该被测试锁死到毫秒
        expect(Number.isFinite(LINK_CHECK_TIMEOUT_MS)).toBe(true);
        expect(LINK_CHECK_TIMEOUT_MS).toBeGreaterThan(0);
        expect(LINK_CHECK_TIMEOUT_MS).toBeLessThan(60_000);
    });
});

describe('linkCheck · 停止信号', () => {
    it('已探到的结果照常返回，未探到的位保持 undefined（不是清空、也不是全 unknown）', async () => {
        // 第 2 条一进来就把信号置停：worker 在下一轮取任务前收手
        const signal = { stopped: false };
        const seen: string[] = [];
        const t = transportWith(async (url) => {
            seen.push(url);
            signal.stopped = true;
            return { status: 200, text: '' };
        });
        const urls = ['https://example.com/1', 'https://example.com/2', 'https://example.com/3'];
        const out = await checkEpisodeLinks(t, urls, undefined, { signal, timeoutMs: 500 });
        // 第一条探到了 ⇒ 必须留下（用户按停止是「别扫了，把已看到的给我」）
        expect(out[0]).toBe('ok');
        // 后面两条没发请求 ⇒ undefined（⛔ 不能是 unknown，那会让「没查」冒充「查不出」）
        expect(out[1]).toBeUndefined();
        expect(out[2]).toBeUndefined();
        // 真的没再发请求（并发 6，三条会同时起飞是正常的 —— 所以只断言「首条被记下」）
        expect(seen.length).toBeGreaterThanOrEqual(1);
    });

    it('一开始就是 stopped ⇒ 一个请求都不发，全员 undefined', async () => {
        let calls = 0;
        const t = transportWith(async () => {
            calls++;
            return { status: 200, text: '' };
        });
        const out = await checkEpisodeLinks(
            t,
            ['https://example.com/1', 'https://example.com/2'],
            undefined,
            { signal: { stopped: true }, timeoutMs: 500 },
        );
        expect(calls).toBe(0);
        expect(out).toEqual([undefined, undefined]);
    });

    it('非 http(s) 位原样留空，不计入 targets（与旧行为一致）', async () => {
        const t = transportWith(async () => ({ status: 200, text: '' }));
        const out = await checkEpisodeLinks(
            t,
            ['', 'ftp://example.com/x', 'https://example.com/ok'],
            undefined,
            { timeoutMs: 500 },
        );
        expect(out[0]).toBeUndefined();
        expect(out[1]).toBeUndefined();
        expect(out[2]).toBe('ok');
    });
});
