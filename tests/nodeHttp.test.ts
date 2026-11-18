// Node 桌面端 HTTP 传输层测试（对齐 obsidian-douban DesktopHttpUtil）
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { nodeHttpGet, nodeHttpPost, sanitizeHeaders, mergeCookies } from 'services/nodeHttp';

describe('sanitizeHeaders：过滤 Node 自动填充的头', () => {
    it('过滤 host/content-length/accept-encoding，保留 Cookie/UA', () => {
        const r = sanitizeHeaders({
            'User-Agent': 'Chrome/124',
            Cookie: 'bid=abc123',
            Host: 'www.douban.com',
            'Content-Length': '123',
            'Accept-Encoding': 'gzip',
            Accept: 'text/html',
        });
        expect(r).toEqual({ 'User-Agent': 'Chrome/124', Cookie: 'bid=abc123', Accept: 'text/html' });
    });

    it('空值/undefined 头被丢弃', () => {
        expect(sanitizeHeaders({ A: '', B: undefined as unknown as string, C: 'x' })).toEqual({ C: 'x' });
    });
});

describe('mergeCookies：跨重定向 Set-Cookie 续传', () => {
    it('空 existing + 多条 Set-Cookie → 合并', () => {
        expect(mergeCookies('', ['bid=abc; Path=/', 'dbcl2=xyz; Path=/'])).toBe('bid=abc; dbcl2=xyz');
    });

    it('同名 cookie 后写覆盖前写', () => {
        expect(mergeCookies('bid=old', ['bid=new; Path=/'])).toBe('bid=new');
    });

    it('existing 保留其他键，只覆盖同名', () => {
        expect(mergeCookies('bid=a; ck=b', ['dbcl2=c'])).toBe('bid=a; ck=b; dbcl2=c');
    });
});

describe('nodeHttpGet/nodeHttpPost：重定向跟随 + Set-Cookie 续传', () => {
    let server: Server;
    let base: string;

    beforeAll(async () => {
        server = createServer((req, res) => {
            if (req.url === '/a') {
                res.writeHead(302, { Location: '/b', 'Set-Cookie': ['bid=abc123; Path=/', 'dbcl2=xyz; Path=/'] });
                res.end();
            } else if (req.url === '/b') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ cookie: req.headers.cookie || '' }));
            } else if (req.url === '/fin') {
                // 🔴 #756 关键形态：**200 + Set-Cookie**（B 站 poll 成功轮就是这种）
                //    原先只有 3xx 分支才 mergeCookies ⇒ 这里的凭据会被整段丢掉。
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': ['SESSDATA=sess123; Path=/', 'bili_jct=csrf456; Path=/'],
                });
                res.end(JSON.stringify({ echo: req.headers.cookie || '' }));
            } else if (req.url === '/fin-redirect') {
                // 200 + Set-Cookie 与 302 链混在一起，锁「两种来源都要进 cookies」
                res.writeHead(302, { Location: '/fin', 'Set-Cookie': ['buvid3=buv789; Path=/'] });
                res.end();
            } else if (req.url === '/echo-post') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(req.method + ':' + (req.headers['content-type'] || ''));
            } else {
                res.writeHead(404);
                res.end('not found');
            }
        });
        await new Promise<void>((resolve) => server.listen(0, () => resolve()));
        const addr = server.address();
        base = `http://127.0.0.1:${(addr && typeof addr === 'object' ? addr.port : 0)}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('GET 跟随 302 重定向并携带合并后的 Cookie', async () => {
        const res = await nodeHttpGet(`${base}/a`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.text) as { cookie: string };
        expect(body.cookie).toContain('bid=abc123');
        expect(body.cookie).toContain('dbcl2=xyz');
    });

    it('直接请求（无重定向）也携带 Cookie —— 回归锁定首请求带 Cookie', async () => {
        const res = await nodeHttpGet(`${base}/b`, { Cookie: 'bid=direct123' });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.text) as { cookie: string };
        expect(body.cookie).toContain('bid=direct123');
    });

    it('POST 不重试、直接透传 body 与 Content-Type', async () => {
        const res = await nodeHttpPost(`${base}/echo-post`, 'sol=42', { 'Content-Type': 'application/x-www-form-urlencoded' });
        expect(res.status).toBe(200);
        expect(res.text).toBe('POST:application/x-www-form-urlencoded');
    });

    it('404 返回状态码而非抛错', async () => {
        const res = await nodeHttpGet(`${base}/missing`);
        expect(res.status).toBe(404);
    });

    // 🔴 #756 回归：B 站扫码「测试连接失败」的真根因就在这里 ——
    //    200 响应自带的 Set-Cookie 若被丢，凭据永远是空 ⇒ 用户看到「扫码成功但连不上」。
    it('200 响应的 Set-Cookie 也要回报到 `cookies`（⛔ 不只在 3xx 分支合并）', async () => {
        const res = await nodeHttpGet(`${base}/fin`);
        expect(res.status).toBe(200);
        expect(res.cookies).toContain('SESSDATA=sess123');
        expect(res.cookies).toContain('bili_jct=csrf456');
    });

    it('302 与末跳 200 的 Set-Cookie 串成一条链', async () => {
        const res = await nodeHttpGet(`${base}/fin-redirect`);
        expect(res.status).toBe(200);
        expect(res.cookies).toContain('buvid3=buv789'); // 302 那一跳
        expect(res.cookies).toContain('SESSDATA=sess123'); // 末跳 200
    });
});
