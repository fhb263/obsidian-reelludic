import { describe, expect, it } from 'vitest';
import { searchPosterImages, type PosterSearchTransport } from 'services/posterSearch';
import { BING_IMAGE_HOST } from 'pure/posterSearch';

const R1 =
    '{&quot;sid&quot;:&quot;&quot;,&quot;cid&quot;:&quot;25SQhm4X&quot;,&quot;purl&quot;:&quot;https://wenhui.whb.cn/a.html&quot;,&quot;murl&quot;:&quot;http://wenhui.whb.cn/u/cms/a.jpg&quot;,&quot;turl&quot;:&quot;https://ts1.mm.bing.net/th?id=OIP.a&amp;pid=15.1&quot;,&quot;t&quot;:&quot;繁花 海报&quot;}';
const card = (m: string) => `<a class="iusc" m="${m}" href="/images/search"></a>`;
const HTML_OK = card(R1);

function harness(
    impl: (url: string, headers?: Record<string, string>) => unknown,
): { t: PosterSearchTransport; calls: { url: string; headers?: Record<string, string> }[] } {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    return {
        calls,
        t: {
            get: async (url, headers) => {
                calls.push({ url, headers });
                return impl(url, headers) as never;
            },
        },
    };
}

describe('searchPosterImages', () => {
    it('正常：打到 cn.bing.com 的 async 端点，带浏览器 UA + Accept-Language（🔴 不需要 Cookie/Referer/Key）', async () => {
        const h = harness(() => ({ status: 200, text: HTML_OK }));
        const r = await searchPosterImages(h.t, '繁花 海报');
        expect(r.error).toBeUndefined();
        expect(r.candidates).toHaveLength(1);
        expect(h.calls[0].url.startsWith(`https://${BING_IMAGE_HOST}/images/async?`)).toBe(true);
        expect(h.calls[0].headers?.['User-Agent']).toContain('Mozilla/5.0');
        expect(h.calls[0].headers?.['Accept-Language']).toContain('zh-CN');
        // ⛔ 不擅自带 Cookie / Referer（实测不需要；带了反而多一处会漂的东西）
        expect(h.calls[0].headers).not.toHaveProperty('Cookie');
        expect(h.calls[0].headers).not.toHaveProperty('Referer');
    });

    it('🔴 空关键词直接给原因，**不白跑一次请求**', async () => {
        const h = harness(() => ({ status: 200, text: HTML_OK }));
        const r = await searchPosterImages(h.t, '   ');
        expect(r.error).toContain('先填搜索词');
        expect(h.calls).toHaveLength(0);
    });

    it('🔴 搜到 0 条 = **成功**（无 error）—— 由界面说「没搜到」，⛔ 别报成失败', async () => {
        const h = harness(() => ({ status: 200, text: '<html>no results</html>' }));
        const r = await searchPosterImages(h.t, 'zzz');
        expect(r.candidates).toEqual([]);
        expect(r.error).toBeUndefined();
    });

    it('非 2xx ⇒ 带状态码的原因（用户据此判断是不是被挡了）', async () => {
        for (const status of [403, 429, 500]) {
            const h = harness(() => ({ status, text: '' }));
            const r = await searchPosterImages(h.t, 'x');
            expect(r.error).toBe(`图片搜索失败（HTTP ${status}）`);
        }
    });

    it('传输层回 null（无内容）与抛错（网络断）各给一句人话', async () => {
        const h1 = harness(() => null);
        expect((await searchPosterImages(h1.t, 'x')).error).toContain('没有返回内容');
        const h2 = harness(() => {
            throw new Error('ENOTFOUND cn.bing.com');
        });
        const r2 = await searchPosterImages(h2.t, 'x');
        expect(r2.error).toContain('图片搜索失败');
        expect(r2.error).toContain('ENOTFOUND');
    });

    it('翻页把 page 传进地址（first=36）', async () => {
        const h = harness(() => ({ status: 200, text: HTML_OK }));
        await searchPosterImages(h.t, 'x', 2);
        expect(h.calls[0].url).toContain('first=36');
    });

    it('真失败时**不返回半个候选列表**（调用方拿不到会误当成成功）', async () => {
        const h = harness(() => ({ status: 503, text: HTML_OK }));
        const r = await searchPosterImages(h.t, 'x');
        expect(r.candidates).toEqual([]);
        expect(r.error).toBeTruthy();
    });

    it('非封面后缀在**服务层**就被过滤掉（列表里不会出现 svg / html 落地页）', async () => {
        const html =
            card('{&quot;murl&quot;:&quot;https://x/logo.svg&quot;,&quot;turl&quot;:&quot;https://ts1.mm.bing.net/th?id=A&pid=15.1&quot;}') +
            card(R1);
        const h = harness(() => ({ status: 200, text: html }));
        const r = await searchPosterImages(h.t, 'x');
        expect(r.candidates.map((c) => c.murl)).toEqual(['http://wenhui.whb.cn/u/cms/a.jpg']);
    });
});
