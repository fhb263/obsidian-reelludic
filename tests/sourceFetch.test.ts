// 源拉取服务（#432 甲 · A2）与体检汇总（A3）的单测。
//
// 为什么值得单测：这两块是「对**别人的服务器**发请求」的闸门，判错的后果不是崩溃而是**静默失当**：
//   ① 批量拉取用「push 完成结果」⇒ 返回顺序随网络抖动变化 ⇒ 调用方再也对不上输入；
//   ② 把「搜到 0 条」当失败 ⇒ 用户以为源坏了，其实只是探针词没命中该书库；
//   ③ 取消被吞成普通失败 ⇒ 用户点了取消却看到一片红字（本仓 #428 已定：取消走中性提示）。
import { describe, expect, it } from 'vitest';
import { CancelledError, createCancelToken } from 'pure/cancel';
import { SOURCE_CHECK_CONCURRENCY, sourceCheckFailures, sourceCheckHealthText, sourceCheckSummaryText, sourceLatencyBand, type SourceCheckResult } from 'pure/sourceCheck';
import {
    SOURCE_FETCH_CONCURRENCY,
    SOURCE_FETCH_MAX_BYTES,
    fetchSourceText,
    fetchSourceTexts,
    type SourceFetchRequest,
} from 'services/sourceFetch';

const ok = (text: string): { status: number; text: string } => ({ status: 200, text });

describe('sourceFetch · 单次拉取', () => {
    it('正常返回文本（带上跟随重定向后的最终地址）', async () => {
        const r = await fetchSourceText('https://a.example.com/x.json', {
            request: async () => ({ status: 200, text: '[]', finalUrl: 'https://a.example.com/real' }),
        });
        expect(r).toEqual({ ok: true, text: '[]', finalUrl: 'https://a.example.com/real' });
    });

    it('🔴 非 2xx ⇒ **不抛**，折成一句人话（订阅/体检是「一批里坏几个很正常」的场景）', async () => {
        const r = await fetchSourceText('https://a.example.com/x.json', { request: async () => ({ status: 404, text: '' }) });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/HTTP 404/);
    });

    it('⛔ 非 http(s) 直接拒（连请求都不发 —— `file://` / 相对路径在桌面端拉不到）', async () => {
        let called = 0;
        const r = await fetchSourceText('file:///C:/x.json', { request: async () => (called++, ok('')) });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/不是 http\(s\) 开头/);
        expect(called).toBe(0);
    });

    it('🔴 **大小上限**：超过上限 ⇒ 拒绝解析（不进 JSON.parse），并把上限写进原因', async () => {
        const big = 'x'.repeat(SOURCE_FETCH_MAX_BYTES + 1);
        const r = await fetchSourceText('https://a.example.com/x.json', { request: async () => ok(big), maxBytes: SOURCE_FETCH_MAX_BYTES });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/内容过大/);
        expect(r.text).toBe('');
    });

    it('🔴🔴 取消**原样抛哨兵**（⛔ 不许吞成 `{ok:false}` —— 上层靠 `instanceof CancelledError` 走中性提示）', async () => {
        const token = createCancelToken();
        const p = fetchSourceText('https://a.example.com/x.json', {
            request: () => new Promise<never>(() => {}), // 永远不回来
            cancel: token,
        });
        token.stop();
        await expect(p).rejects.toBeInstanceOf(CancelledError);
    });
});

describe('sourceFetch · 批量拉取', () => {
    it('🔴 按**下标保序**返回（与输入一一对应）—— ⛔ 别用「push 完成结果」，并发下顺序会随网络抖动变', async () => {
        const order: string[] = [];
        const req: SourceFetchRequest = async (u) => {
            order.push(u);
            // 故意让**先发的慢**：若实现按完成先后收集，顺序必然反了
            const n = Number(/(\d+)\.json$/.exec(u)?.[1] ?? 0);
            await new Promise((r) => setTimeout(r, (6 - n) * 3));
            return ok(`第${n}个`);
        };
        const urls = [1, 2, 3, 4, 5].map((n) => `https://a.example.com/${n}.json`);
        const out = await fetchSourceTexts(urls, { request: req, concurrency: 3 });
        expect(out.map((r) => r.text)).toEqual(['第1个', '第2个', '第3个', '第4个', '第5个']);
        expect(out.length).toBe(5);
    });

    it('单条失败**不影响**其余（各归各位）', async () => {
        const out = await fetchSourceTexts(['https://a.example.com/1.json', 'https://a.example.com/2.json'], {
            request: async (u) => (u.endsWith('1.json') ? { status: 500, text: '' } : ok('好的')),
        });
        expect(out[0].ok).toBe(false);
        expect(out[1]).toEqual({ ok: true, text: '好的', finalUrl: undefined });
    });

    it('🔴 并发**有上限**（同一时刻在飞的不超过 `concurrency`）', async () => {
        let live = 0;
        let peak = 0;
        const req: SourceFetchRequest = async () => {
            live++;
            peak = Math.max(peak, live);
            await new Promise((r) => setTimeout(r, 2));
            live--;
            return ok('x');
        };
        await fetchSourceTexts([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `https://a.example.com/${n}.json`), { request: req, concurrency: 3 });
        expect(peak).toBe(3);
        expect(SOURCE_FETCH_CONCURRENCY).toBe(4); // 默认值的口径也钉住
    });

    it('已取消的令牌 ⇒ 一个新请求都不发；`onOne` 每条完成就回调（渐进显示）', async () => {
        const token = createCancelToken();
        token.stop();
        let called = 0;
        const out = await fetchSourceTexts(['https://a.example.com/1.json'], { cancel: token, request: async () => (called++, ok('x')) });
        expect(called).toBe(0);
        expect(out.length).toBe(1);

        const seen: number[] = [];
        await fetchSourceTexts(['https://a.example.com/1.json', 'https://a.example.com/2.json'], { onOne: (i) => seen.push(i), request: async () => ok('x') });
        expect(seen.sort()).toEqual([0, 1]);
    });

    it('空输入 ⇒ 空结果（⛔ 不发请求、不抛）', async () => {
        expect(await fetchSourceTexts([])).toEqual([]);
    });
});

describe('sourceCheck · 汇总口径（#432 甲 · A3 · D-35）', () => {
    const mk = (over: Partial<SourceCheckResult>): SourceCheckResult => ({
        key: 'k', name: '示例源', kind: 'novel', ok: true, ms: 300, count: 12, ...over,
    });

    it('🔴🔴 **「搜到 0 条」判可用**（探针词不一定命中该书库 —— 判红就是误导）', () => {
        const r = mk({ count: 0 });
        expect(sourceCheckHealthText(r)).toMatch(/^可用/);
        expect(sourceCheckHealthText(r)).toMatch(/0 条/);
    });

    it('可用那一行 = 「可用 · 档位 时延 · N 条」；不可用那一行带原因', () => {
        expect(sourceCheckHealthText(mk({ ms: 300 }))).toBe('可用 · 快 300ms · 12 条');
        expect(sourceCheckHealthText(mk({ ms: 2000 }))).toBe('可用 · 正常 2000ms · 12 条');
        expect(sourceCheckHealthText(mk({ ms: 9000 }))).toBe('可用 · 慢 9000ms · 12 条');
        expect(sourceCheckHealthText(mk({ ok: false, error: '连不上该站点' }))).toBe('不可用 · 连不上该站点');
        expect(sourceCheckHealthText(mk({ ok: false }))).toBe('不可用');
    });

    it('时延分档的界值（⛔ 视图层别自己写阈值）', () => {
        expect(sourceLatencyBand(0)).toBe('fast');
        expect(sourceLatencyBand(1200)).toBe('fast');
        expect(sourceLatencyBand(1201)).toBe('normal');
        expect(sourceLatencyBand(4000)).toBe('normal');
        expect(sourceLatencyBand(4001)).toBe('slow');
        expect(sourceLatencyBand(Number.NaN)).toBe('fast');
    });

    it('整轮总结：全绿 / 有红两种说法；空结果 ⇒ **空串**（⛔ 别显示「0 条可用」这种吓人的话）', () => {
        expect(sourceCheckSummaryText([mk({}), mk({})], 2400)).toBe('体检完成：2 条全部可用 · 2.4s');
        expect(sourceCheckSummaryText([mk({}), mk({ ok: false, error: 'x' })], 1000)).toBe('体检完成：1 条可用 · 1 条不可用 · 1.0s');
        expect(sourceCheckSummaryText([], 1000)).toBe('');
    });

    it('失败项单独挑得出来（UI 把红字单独列，⛔ 别让用户在绿字堆里找）', () => {
        const list = [mk({}), mk({ ok: false, error: 'x' }), mk({})];
        expect(sourceCheckFailures(list).length).toBe(1);
        expect(SOURCE_CHECK_CONCURRENCY).toBe(4);
    });
});
