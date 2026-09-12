// Node 桌面端 HTTP 传输层（对齐 obsidian-douban DesktopHttpUtil）
// 为何不用 Obsidian requestUrl：豆瓣反爬对网络栈指纹敏感，Electron 网络栈易被识别为爬虫（403/空响应）。
// obsidian-douban 桌面端改用 Node 原生 https 稳定过反爬；此处用内置 https/http 手动跟随重定向，
// 不引入额外依赖。仅桌面端可用（惰性 require，移动端无 Node 环境，调用方按 Platform.isDesktopApp 分流）。
import { retry } from 'pure/timing';

export interface NodeHttpResponse {
    status: number;
    text: string;
    headers: Record<string, string | string[] | undefined>;
}

export interface NodeHttpBufferResponse {
    status: number;
    buffer: Buffer;
    headers: Record<string, string | string[] | undefined>;
}

const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;
/** GET 幂等重试次数（对齐 obsidian-douban：GET 重试、POST 不重试） */
const GET_RETRY = 2;

/** 过滤 Node 会自动填充、重复设置会报错的头（host/content-length/accept-encoding） */
export function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
        const lower = k.toLowerCase();
        if (v == null || v === '' || lower === 'host' || lower === 'content-length' || lower === 'accept-encoding') continue;
        out[k] = String(v);
    }
    return out;
}

/** 合并 Set-Cookie 到现有 Cookie 串（跨重定向续传，豆瓣 link2 / sec 跳转依赖） */
export function mergeCookies(existing: string, setCookies: string[]): string {
    const map = new Map<string, string>();
    const add = (cookie: string) => {
        const pair = cookie.split(';', 1)[0].trim();
        const idx = pair.indexOf('=');
        if (idx > 0) map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    };
    if (existing) existing.split(';').forEach(add);
    setCookies.forEach(add);
    return Array.from(map.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
}

/** 单次原生请求（惰性 require，仅桌面端 Node 环境可用）；同时返回 text 与 buffer，调用方按需取 */
function rawRequest(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<NodeHttpResponse & { buffer: Buffer }> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? require('https') : require('http');
        const req = mod.request(url, { method, headers }, (res: { statusCode: number; headers: Record<string, string | string[] | undefined>; on: (e: string, cb: (...a: never[]) => void) => void }) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)); size += chunk.length; });
            res.on('error', reject);
            res.on('end', () => {
                const buffer = Buffer.concat(chunks, size);
                resolve({ status: res.statusCode, text: buffer.toString('utf8'), buffer, headers: res.headers });
            });
        });
        req.on('error', reject);
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms: ${url}`)));
        if (body) req.write(body);
        req.end();
    });
}

/** 单次请求 + 手动跟随重定向 + Set-Cookie 续传（3xx 最多 MAX_REDIRECTS 跳） */
async function requestOnce(url: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: string): Promise<NodeHttpResponse & { buffer: Buffer }> {
    let currentUrl = url;
    let currentMethod: 'GET' | 'POST' = method;
    let currentBody = body;
    const currentHeaders = { ...headers };
    // 从原始头提取 Cookie 后统一用大写 Cookie 键管理，避免大小写不一致
    let cookie = '';
    for (const [k, v] of Object.entries(currentHeaders)) {
        if (k.toLowerCase() === 'cookie') { cookie = String(v); delete currentHeaders[k]; break; }
    }
    // 关键：立即把 Cookie 写回大写键，保证第一次请求就携带 Cookie（豆瓣 j/search 直接 200 不重定向，
    // 若只在重定向分支写回会导致首请求无 Cookie 被 403 拒绝）
    if (cookie) currentHeaders.Cookie = cookie;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        const res = await rawRequest(currentUrl, currentMethod, currentHeaders, currentBody);
        const location = res.headers && (res.headers['location'] as string | undefined);
        if (res.status >= 300 && res.status < 400 && location) {
            const setCookie = res.headers && res.headers['set-cookie'];
            if (setCookie) cookie = mergeCookies(cookie, Array.isArray(setCookie) ? setCookie : [setCookie]);
            if (cookie) currentHeaders.Cookie = cookie;
            // 301/302/303：POST → GET（清 body）；307/308 保持 method
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
                currentMethod = 'GET';
                currentBody = undefined;
            }
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }
        return res;
    }
    throw new Error(`Too many redirects: ${url}`);
}

/** 桌面端 GET（幂等，自动重试 GET_RETRY 次） */
export async function nodeHttpGet(url: string, headers?: Record<string, string>): Promise<NodeHttpResponse> {
    const r = await retry(() => requestOnce(url, 'GET', sanitizeHeaders(headers)), GET_RETRY);
    return { status: r.status, text: r.text, headers: r.headers };
}

/** 桌面端 GET 二进制下载（图片等，幂等重试）：返回 Buffer 供 vault.createBinary 写入 */
export async function nodeHttpGetBuffer(url: string, headers?: Record<string, string>): Promise<NodeHttpBufferResponse> {
    const r = await retry(() => requestOnce(url, 'GET', sanitizeHeaders(headers)), GET_RETRY);
    return { status: r.status, buffer: r.buffer, headers: r.headers };
}

/** 桌面端 POST（非幂等，不重试） */
export async function nodeHttpPost(url: string, body: string, headers?: Record<string, string>): Promise<NodeHttpResponse> {
    return requestOnce(url, 'POST', sanitizeHeaders(headers), body);
}
