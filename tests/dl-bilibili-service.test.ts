/**
 * `services/dl/bilibili` 单测（#496）—— 两步请求（首页取 `buvid3` → 搜索）、缓存与失败重试。
 * 传输层注入假实现（与 `tests/dl-service.test.ts` 同款），⛔ 不打真网络。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dlBiliSearch, dlBiliView, ensureBiliCookie, resetBiliCookieCache } from 'services/dl/bilibili';
import type { DlTextResponse, DlTransport } from 'services/dl';

interface Call {
    url: string;
    headers: Record<string, string> | undefined;
}

/** 造一个假传输层：按 URL 关键字给响应；`home` = 首页（出 Set-Cookie），`search` = 搜索 */
function makeTransport(opts: {
    homeStatus?: number;
    homeCookies?: string[];
    search?: (call: Call, nth: number) => DlTextResponse;
    /** #505 分P：详情接口（`/x/web-interface/view`）—— ⚠️ 它既不含 `www.bilibili.com/` 也不含 `/search/`，
     *  所以**必须有自己一条分支**，否则会被当成搜索（本批实测：忘了加就一直是「搜索」的响应）。 */
    view?: (call: Call, nth: number) => DlTextResponse;
    throwOn?: 'home' | 'search' | 'view';
}): { t: DlTransport; calls: Call[]; searchCalls: () => number; viewCalls: () => number } {
    const calls: Call[] = [];
    let nth = 0;
    let vnth = 0;
    const t: DlTransport = {
        get: async (url, headers) => {
            calls.push({ url, headers });
            if (url.includes('www.bilibili.com/') && !url.includes('/search/')) {
                if (opts.throwOn === 'home') throw new Error('home down');
                return {
                    status: opts.homeStatus ?? 200,
                    text: '<html></html>',
                    headers: { 'set-cookie': opts.homeCookies ?? ['buvid3=TEST-BUVID3; Path=/; Domain=.bilibili.com'] },
                } as DlTextResponse;
            }
            if (url.includes('/x/web-interface/view')) {
                if (opts.throwOn === 'view') throw new Error('view down');
                vnth += 1;
                return opts.view ? opts.view({ url, headers }, vnth) : okView();
            }
            if (opts.throwOn === 'search') throw new Error('search down');
            nth += 1;
            return opts.search ? opts.search({ url, headers }, nth) : okSearch();
        },
        post: async () => ({ status: 200, text: '' }),
        getBuffer: async () => ({ status: 200, buffer: new Uint8Array() }),
    };
    return { t, calls, searchCalls: () => nth, viewCalls: () => vnth };
}

/** #505：详情接口的成功响应（分P 列表） */
function okView(pages: unknown[] = [{ page: 1, part: '第 1 集', duration: 100 }]): DlTextResponse {
    return {
        status: 200,
        text: JSON.stringify({ code: 0, message: 'OK', data: { title: '示例合集', pages } }),
    };
}

function okSearch(result: unknown[] = [{ type: 'video', bvid: 'BV1', title: 't', author: 'a', duration: '1:00' }]): DlTextResponse {
    return {
        status: 200,
        text: JSON.stringify({ code: 0, message: 'OK', data: { result } }),
    };
}

afterEach(() => resetBiliCookieCache());

describe('ensureBiliCookie', () => {
    it('第一次去首页取 buvid3，第二次走缓存（⛔ 不再多打一次首页）', async () => {
        const { t, calls } = makeTransport({});
        expect(await ensureBiliCookie(t)).toBe('TEST-BUVID3');
        expect(await ensureBiliCookie(t)).toBe('TEST-BUVID3');
        expect(calls.filter((c) => c.url.includes('www.bilibili.com/') && !c.url.includes('/search/'))).toHaveLength(1);
    });

    it('force=true 丢掉缓存重新取', async () => {
        const { t, calls } = makeTransport({});
        await ensureBiliCookie(t);
        await ensureBiliCookie(t, true);
        expect(calls.filter((c) => !c.url.includes('/search/'))).toHaveLength(2);
    });

    it('首页挂了 ⇒ 回空串且不抛（调用方照常发请求）', async () => {
        const { t } = makeTransport({ throwOn: 'home' });
        expect(await ensureBiliCookie(t)).toBe('');
    });

    it('首页没给 buvid3 ⇒ 空串', async () => {
        const { t } = makeTransport({ homeCookies: ['b_nut=1; Path=/'] });
        expect(await ensureBiliCookie(t)).toBe('');
    });
});

describe('dlBiliSearch', () => {
    it('空关键词 ⇒ 直接给原因，且**一次请求都不发**', async () => {
        const { t, calls } = makeTransport({});
        const out = await dlBiliSearch(t, '   ');
        expect(out.videos).toEqual([]);
        expect(out.error).toContain('先在搜索框里输入');
        expect(calls).toHaveLength(0);
    });

    it('成功：打两次（首页 + 搜索），搜索请求带上 buvid3 与 Referer', async () => {
        const { t, calls } = makeTransport({});
        const out = await dlBiliSearch(t, '晴天');
        expect(out.videos.map((v) => v.bvid)).toEqual(['BV1']);
        expect(calls).toHaveLength(2);
        const search = calls[1];
        expect(search.url).toContain('search_type=video');
        expect(search.url).toContain('keyword=%E6%99%B4%E5%A4%A9');
        expect(search.headers?.Cookie).toBe('buvid3=TEST-BUVID3');
        expect(search.headers?.Referer).toBe('https://www.bilibili.com/');
        expect(search.headers?.['User-Agent']).toContain('Mozilla/5.0');
    });

    it('第一次被风控、重取 Cookie 后第二次成功 ⇒ 返回结果且**不报错**（偶发风控不该表现成「搜不到」）', async () => {
        const { t, calls, searchCalls } = makeTransport({
            search: (_c, n) => (n === 1 ? { status: 200, text: '<html>412</html>' } : okSearch()),
        });
        const out = await dlBiliSearch(t, '晴天');
        expect(out.error).toBeUndefined();
        expect(out.videos).toHaveLength(1);
        expect(searchCalls()).toBe(2);
        // 首页被打了两次：第一次取 Cookie、重试前强制作废重取
        expect(calls.filter((c) => !c.url.includes('/search/'))).toHaveLength(2);
    });

    it('两次都被风控 ⇒ 报 412 文案（⛔ 不是光秃秃一句「失败」）', async () => {
        const { t } = makeTransport({
            search: () => ({ status: 200, text: JSON.stringify({ code: -412, message: '请求被拦截' }) }),
        });
        const out = await dlBiliSearch(t, '晴天');
        expect(out.videos).toEqual([]);
        expect(out.error).toContain('412');
    });

    it('HTTP 层失败（500）⇒ 带出状态码，且**不再重试第三次**', async () => {
        const { t, searchCalls } = makeTransport({ search: () => ({ status: 500, text: '' }) });
        const out = await dlBiliSearch(t, '晴天');
        expect(out.error).toContain('HTTP 500');
        expect(searchCalls()).toBe(2);
    });

    it('code 0 但空列表 = 真没搜到 ⇒ **不报错**', async () => {
        const { t } = makeTransport({ search: () => okSearch([]) });
        const out = await dlBiliSearch(t, '不存在的关键词');
        expect(out.videos).toEqual([]);
        expect(out.error).toBeUndefined();
    });

    it('传输层抛错 ⇒ 包成可读文案，不把异常漏给 UI', async () => {
        const { t } = makeTransport({ throwOn: 'search' });
        const out = await dlBiliSearch(t, '晴天');
        expect(out.error).toContain('search down');
        expect(out.error).toContain('B 站搜索出错');
    });
});

// ────────────────────── 分P（#505）──────────────────────
describe('dlBiliView', () => {
    it('成功后带回标题与分P 列表（52 个分P 一个不少）', async () => {
        const pages = Array.from({ length: 52 }, (_, i) => ({ page: i + 1, part: `第 ${i + 1} 集`, duration: 1001 }));
        const { t } = makeTransport({ view: () => okView(pages) });
        const out = await dlBiliView(t, 'BV1NreA6rE2L');
        expect(out.error).toBeUndefined();
        expect(out.title).toBe('示例合集');
        expect(out.parts).toHaveLength(52);
        expect(out.parts[51].page).toBe(52);
    });

    it('🔴 空 bvid ⇒ 直接给原因，**不白跑请求**', async () => {
        const { t, viewCalls } = makeTransport({});
        const out = await dlBiliView(t, '   ');
        expect(out.error).toContain('bvid');
        expect(viewCalls()).toBe(0);
    });

    it('🔴 与搜索同一条纪律：失败时**强制重取 buvid3 重试一次**', async () => {
        let n = 0;
        const { t, viewCalls } = makeTransport({
            view: (_c, nth) => {
                n += 1;
                return nth === 1 ? { status: 200, text: JSON.stringify({ code: -412, message: '风控' }) } : okView();
            },
        });
        const out = await dlBiliView(t, 'BV1');
        expect(out.error).toBeUndefined();
        expect(viewCalls()).toBe(2);
        expect(n).toBe(2);
    });

    it('两次都 412 ⇒ 带出「风控」那句人话（⛔ 不是裸 code）', async () => {
        const { t, viewCalls } = makeTransport({
            view: () => ({ status: 200, text: JSON.stringify({ code: -412, message: '' }) }),
        });
        const out = await dlBiliView(t, 'BV1');
        expect(out.parts).toEqual([]);
        expect(out.error).toContain('412');
        expect(viewCalls()).toBe(2);
    });

    it('稿件不可见（62002）⇒ 给「已不可见」这句（搜索缓存里翻到已下架稿件是真会遇到的）', async () => {
        const { t } = makeTransport({
            view: () => ({ status: 200, text: JSON.stringify({ code: 62002, message: '稿件不可见' }) }),
        });
        const out = await dlBiliView(t, 'BV1');
        expect(out.error).toContain('不可见');
    });

    it('HTTP 层失败（500）⇒ 带出状态码，且**不再重试第三次**', async () => {
        const { t, viewCalls } = makeTransport({ view: () => ({ status: 500, text: '' }) });
        const out = await dlBiliView(t, 'BV1');
        expect(out.error).toContain('HTTP 500');
        expect(viewCalls()).toBe(2);
    });

    it('🔴 code 0 但**没有分P**（单P 或真没 pages）= **不算错误** ⇒ 调用方据此回落「直接填这一条」', async () => {
        const { t } = makeTransport({ view: () => okView([]) });
        const out = await dlBiliView(t, 'BV1');
        expect(out.error).toBeUndefined();
        expect(out.parts).toEqual([]);
    });

    it('传输层抛错 ⇒ 包成可读文案，不把异常漏给 UI', async () => {
        const { t } = makeTransport({ throwOn: 'view' });
        const out = await dlBiliView(t, 'BV1');
        expect(out.error).toContain('view down');
        expect(out.error).toContain('读取分P出错');
    });

    it('请求带上 buvid3（与搜索共用同一枚缓存 Cookie）', async () => {
        const { t, calls } = makeTransport({});
        await dlBiliView(t, 'BV1');
        const hit = calls.filter((c) => c.url.includes('/x/web-interface/view'));
        expect(hit).toHaveLength(1);
        expect(hit[0].headers?.Cookie).toContain('buvid3=TEST-BUVID3');
    });
});
