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
});
