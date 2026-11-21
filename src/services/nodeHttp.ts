// Node 桌面端 HTTP 传输层（对齐 obsidian-douban DesktopHttpUtil）
// 为何不用 Obsidian requestUrl：豆瓣反爬对网络栈指纹敏感，Electron 网络栈易被识别为爬虫（403/空响应）。
// obsidian-douban 桌面端改用 Node 原生 https 稳定过反爬；此处用内置 https/http 手动跟随重定向，
// 不引入额外依赖。仅桌面端可用（惰性 require，移动端无 Node 环境，调用方按 Platform.isDesktopApp 分流）。
import { retry } from 'pure/timing';

export interface NodeHttpResponse {
    status: number;
    text: string;
    headers: Record<string, string | string[] | undefined>;
    /**
     * **跟随重定向之后**的最终地址（#420 追加，append-only 可选字段）。
     * 🔴 为什么要它：书源的「搜索命中唯一结果时站点直接跳到书籍页」这一场景里，
     *    我们发的是 `/search?key=x`，而真正的书籍地址是**跳到之后**那一页 ⇒ 不拿最终 URL 就没法记账。
     */
    finalUrl?: string;
    /**
     * **整条重定向链上累积下来的 Cookie**（`name=value; name=value`，append-only 可选字段）。
     *
     * 🔴 由来（#756，用户 m06077「B 站扫码能获取但测试连接失败」）：
     *    B 站扫码成功后 `data.url` 已不再是老的
     *    `passport.biligame.com/crossDomain?DedeUserID=…&SESSDATA=…` 形态，而是**票据地址**
     *    `…/web/crossDomain?ticket=…&gourl=…&first_domain=…` —— 里面**没有**任何登录凭据，
     *    真正的 `SESSDATA` / `bili_jct` / `DedeUserID` 由该地址 **302 响应的 `Set-Cookie`** 下发。
     *    而 `requestOnce` 本来就为「跨重定向续传 Cookie」累积过这份数据，只是在返回时丢掉了。
     * ⇒ 把它透出来，让扫码那一路能「拿票据换真凭据」，⛔ 别再让调用方去 URL 里抠 query。
     * ⚠️ 只在**跟过至少一跳**时才有意义；单跳 200 的响应这份多半是空串。
     */
    cookies?: string;
}

export interface NodeHttpBufferResponse {
    status: number;
    buffer: Buffer;
    headers: Record<string, string | string[] | undefined>;
    /** 同 `NodeHttpResponse.finalUrl` */
    finalUrl?: string;
}

/**
 * `nodeHttpGetBuffer` 的选项（append-only）。
 *
 * 🔴 为什么要能自定义超时（2026-11-16 真机实测）：Flash 运行时那个 GitHub release 包
 *    10,527,427 字节，本机走直连**实测 278 秒**；而默认 `TIMEOUT_MS = 30_000` 会在
 *    第 30 秒把连接掐断 ⇒ 包永远装不上，界面只显示「运行时安装失败」，真因完全看不见。
 *    ⛔ 别为了这个把全局 `TIMEOUT_MS` 调大：那会让所有「测试连接」类请求一起变迟钝。
 */
export interface NodeHttpGetBufferOptions {
    /** 单跳请求超时（毫秒）；缺省用 `TIMEOUT_MS`（30s） */
    timeoutMs?: number;
    /**
     * 下载进度回调（append-only 可选字段；用户 m02844「做进度表」）。
     *
     * 🔴 由来：Flash 运行时那个包 10,527,427 字节、实测 278 秒，界面原先只有一个静止的
     *    「正在下载 Flash 运行时」—— 用户分不清是卡死还是在下。这里按**已收字节**报，调用方
     *    自己算百分比与 MB。
     *
     * ⚠️ `total` 是**当前这一跳**的 `content-length`：GitHub release 先 302 到
     *    `release-assets.githubusercontent.com`，第一跳没有 body ⇒ `total` 可能是 0。
     *    调用方在 `total <= 0` 时只显示已下载量，⛔ 别除以 0。
     */
    onProgress?: (received: number, total: number) => void;
}

/**
 * 流式 POST 的选项。
 *
 * 🔴 为什么单开一个函数而不是给 `nodeHttpPost` 加回调：
 *    非流式那条路会被 `retry()` 包着（GET 重试）与 `Buffer.concat` 整块收口，
 *    把「逐块回调」塞进去会让两条语义互相污染 —— 流式一旦收到半截就不该重试
 *    （重试会从头再吐一遍，界面上变成重复文字）。
 */
export interface NodeHttpStreamOptions {
    /**
     * 每收到一块**已按 UTF-8 解码**的文本就调一次。
     * ⚠️ 这里用 `StringDecoder` 而不是 `buf.toString()`：多字节中文常被 TCP 切在
     *    半个字上，直接 `toString` 会吐 `�`（本仓在 llama 那一路踩过同样的坑）。
     */
    onText?: (text: string) => void;
    /** 收到响应头时回调（可据此提前判断 4xx 并中止） */
    onResponse?: (status: number, headers: Record<string, string | string[] | undefined>) => void;
    /**
     * 返回 true ⇒ 主动断开（用来在收到 `[DONE]` 后立刻收尾，不必等服务端关连接）。
     * ⚠️ 在 `onText` 之后被问一次。
     */
    shouldStop?: () => boolean;
    /** 整段流的总超时（毫秒）。流式比非流式更需要它：服务端可能一直挂着不关 */
    timeoutMs?: number;
    /** 代理（与 `nodeHttpPost` 同口径：墙外目标必须传） */
    proxy?: string;
    signal?: { aborted: boolean };
}

/** 流式 POST 的结果：状态码 + **累积的整段文本**（流式过程中已逐块回调过） */
export interface NodeHttpStreamResult {
    status: number;
    /** 整段文本（与逐块回调内容按序拼接一致）；用来走原有的非流式解析器 */
    text: string;
    /** 是否被 `shouldStop` / 超时 / 外部信号提前中断 */
    stopped: boolean;
    /** 中断原因（`stopped` 为真时才有） */
    stopReason?: 'done' | 'timeout' | 'abort' | 'error';
    error?: string;
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

/**
 * 🔴🔴 2026-11-10 真机事故：**字幕正文一直没走代理**，所以症状是「元数据拿到了、正文却超时」。
 *
 *    `fetchYtInfo` 能通是因为它 `spawn` **yt-dlp 子进程**（带着代理跑）；
 *    而字幕正文走的是本层**直连** ⇒ `https://www.youtube.com/api/timedtext?...`
 *    被墙黑洞到 `Request timed out after 30000ms`（node 直连重放同一 URL 报
 *    `connect ETIMEDOUT 104.244.42.197:443`，同一件事的两种说法）。
 *    ⇒ 只要目标站在墙外，`proxy` 就不是可选项。**⛔ 别把这个参数删掉，也别改回「默认直连」。**
 *
 * 只给 **https 目标** 建 CONNECT 隧道（http 目标走原路，国内站不需要）。
 */
async function openTunnel(target: URL, proxy: string): Promise<unknown> {
    const p = new URL(proxy);
    const http = require('http');
    const host = target.hostname;
    const port = target.port || (target.protocol === 'https:' ? 443 : 80);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: p.hostname,
            port: p.port || (p.protocol === 'https:' ? 443 : 80),
            method: 'CONNECT',
            path: `${host}:${port}`,
            headers: { Host: `${host}:${port}` },
        });
        req.once('connect', (res: { statusCode: number }, socket: unknown) => {
            if (res.statusCode !== 200) {
                socket && (socket as { destroy?: () => void }).destroy?.();
                reject(new Error(`代理 CONNECT 被拒 ${res.statusCode}: ${proxy}`));
                return;
            }
            resolve(socket);
        });
        req.once('error', reject);
        req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`代理 CONNECT 超时: ${proxy}`)));
        req.end();
    });
}

/** 单次原生请求（惰性 require，仅桌面端 Node 环境可用）；同时返回 text 与 buffer，调用方按需取 */
async function rawRequest(url: string, method: 'GET' | 'POST' | 'PROPFIND', headers: Record<string, string>, body?: string, proxy?: string, timeoutMs: number = TIMEOUT_MS, onProgress?: (received: number, total: number) => void): Promise<NodeHttpResponse & { buffer: Buffer }> {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const extra: Record<string, unknown> = {};
    if (proxy && url.startsWith('https')) {
        const target = new URL(url);
        const tls = require('tls');
        const socket = await openTunnel(target, proxy);
        const secure = tls.connect({ socket, servername: target.hostname });
        await new Promise((res, rej) => { secure.once('secureConnect', res); secure.once('error', rej); });
        /**
         * 🔴⛔ **不能只写 `agent: false` + `options.createConnection`**：
         *    Node 的 http 客户端只要走 Agent 就**忽略 `options.createConnection`**
         *    （`agent:false` 只等于「新建一个默认 Agent」，不等于不用 Agent）。
         *    实测症状极坑：隧道看着建好了、实际仍然直连 —— B 站照样 200（直连本来就通），
         *    YouTube 却报 `connect ETIMEDOUT 31.13.92.37:443`（DNS 污染出来的假 IP）。
         *    ⇒ 必须把 `createConnection` 挂到 **Agent 实例**上。
         */
        const agent = new mod.Agent({ keepAlive: false });
        agent.createConnection = () => secure;
        extra.agent = agent;
    }
    return new Promise((resolve, reject) => {
        /**
         * 🔴🔴 #424：POST **必须显式给 `Content-Type` 与 `Content-Length`**。
         *
         * 实测教训（用户报「10 个源都没能连上」的根因之一）：只调 `req.write(body)` 再 `req.end()`
         * 而没有 `Content-Length` 时，Node 会用 **`Transfer-Encoding: chunked`** 发出去 ——
         * 而大量老书源站（PHP）**不认 chunked 的表单体**，于是回一个 `200` + 一个「没搜到」的页面：
         *   · 悠久小说网 `searchbooks.php`：chunked ⇒ **5,502 字节**；带 `Content-Length` ⇒ **32,693 字节**。
         * ⇒ 表面上「连上了」，实际每条源的搜索都是空的。
         *
         * 对齐参考实现 so-novel 的 OkHttp `FormBody`（它同时给 Content-Type 与 Content-Length）。
         * ⚠️ 这里是**复制一份再补**：`requestOnce` 的 `currentHeaders` 在重定向间复用，
         *    直接改它会把这俩头带到重定向后的 GET 上（GET 带 Content-Length 会让部分服务端直接 400）。
         */
        const h = { ...headers };
        const hasHeader = (name: string): boolean => Object.keys(h).some((k) => k.toLowerCase() === name);
        // 🔴 WebDAV 的 PROPFIND 也要带 body（`<propfind>` XML），漏了 Content-Length
        //    同样会退回 chunked —— 群晖那类服务器对 chunked 的 PROPFIND 直接 400。
        //    ⇒ 判据从「是不是 POST」放宽成「是不是有 body 的方法」，⛔ 别只加一个 `|| method === 'PROPFIND'`
        //    （下一个要带 body 的 verb 还得再改一次）。
        if (method !== 'GET') {
            if (!hasHeader('content-type')) {
                h['Content-Type'] = method === 'PROPFIND' ? 'application/xml; charset=utf-8' : 'application/x-www-form-urlencoded';
            }
            h['Content-Length'] = String(Buffer.byteLength(body ?? '', 'utf8'));
        }
        const req = mod.request(url, { method, headers: h, ...extra }, (res: { statusCode: number; headers: Record<string, string | string[] | undefined>; on: (e: string, cb: (...a: never[]) => void) => void }) => {
            const chunks: Buffer[] = [];
            let size = 0;
            // 进度上报（只在给了回调时才建这层）：⚠️ 用 `content-length` 判总量，
            //   跳转到 release-assets 那一跳才有；第一跳 302 无 body ⇒ total 为 0。
            const total = Number.parseInt(String((res.headers['content-length'] ?? '') as string), 10) || 0;
            // ⚠️ 重定向跳的响应体（302 的 HTML / 空体）不报进度 —— 只报真正落盘那一跳，
            //    否则调用方会先看到 1KB 再归零重来。
            const reportable = onProgress && res.statusCode >= 200 && res.statusCode < 300;
            res.on('data', (chunk: Buffer) => {
                chunks.push(Buffer.from(chunk));
                size += chunk.length;
                if (reportable) {
                    try {
                        onProgress(size, total);
                    } catch {
                        /* 回调炸了不影响下载 */
                    }
                }
            });
            res.on('error', reject);
            res.on('end', () => {
                const buffer = Buffer.concat(chunks, size);
                resolve({ status: res.statusCode, text: buffer.toString('utf8'), buffer, headers: res.headers });
            });
        });
        req.on('error', reject);
        // ⚠️ `setTimeout` 在这里是**空闲超时**（socket 上多久没数据），不是整段总时长：
        //    大文件连续有数据就不会被掐，只有彻底停住才触发 —— 278 秒的下载靠它兜底。
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms: ${url}`)));
        // ⚠️ 用 `end(body)` **一次写完**（不是 write + end）：配合上面的 Content-Length 才是固定长度发；
        //    漏了它会退回 chunked、前面那些头也白设。
        //    🔴 判据同上面那条：GET 不带 body，其余带（POST / PROPFIND）。
        req.end(method === 'GET' ? undefined : (body ?? ''));
    });
}

/** 单次请求 + 手动跟随重定向 + Set-Cookie 续传（3xx 最多 MAX_REDIRECTS 跳） */
async function requestOnce(url: string, method: 'GET' | 'POST' | 'PROPFIND', headers: Record<string, string>, body?: string, proxy?: string, timeoutMs: number = TIMEOUT_MS, onProgress?: (received: number, total: number) => void): Promise<NodeHttpResponse & { buffer: Buffer }> {
    let currentUrl = url;
    let currentMethod: 'GET' | 'POST' | 'PROPFIND' = method;
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
        const res = await rawRequest(currentUrl, currentMethod, currentHeaders, currentBody, proxy, timeoutMs, onProgress);
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
        // 🔴 `currentUrl` 到这里已经是**最后一次跳转之后**的地址 ⇒ 一并回报（调用方按需使用）
        // 🔴 `cookies` 是整条链上累积的（含每一跳 302 的 `Set-Cookie`）—— B 站「票据换凭据」靠它，
        //    见 `NodeHttpResponse.cookies` 的注释；⛔ 别改成只回最后一跳的头。
        // 🔴🔴 #756 补漏：**末跳 200 自己带的 `Set-Cookie` 也必须并进来**。
        //    原先只有「3xx 且有 location」那条分支才 `mergeCookies`，于是
        //    「200 + Set-Cookie」这种最正常的下发方式被整段丢掉 —— B 站 poll 成功那轮正是这种形态，
        //    结果就是「扫码成功、refresh_token 拿到了，但凭据永远是空的」。
        const tailSetCookie = res.headers && res.headers['set-cookie'];
        if (tailSetCookie) {
            cookie = mergeCookies(cookie, Array.isArray(tailSetCookie) ? tailSetCookie : [tailSetCookie]);
        }
        return { ...res, finalUrl: currentUrl, cookies: cookie };
    }
    throw new Error(`Too many redirects: ${url}`);
}

/** 桌面端 GET（幂等，自动重试 GET_RETRY 次）。`proxy` 为空则直连；墙外目标（YouTube 等）必须传 */
export async function nodeHttpGet(url: string, headers?: Record<string, string>, proxy?: string): Promise<NodeHttpResponse> {
    const r = await retry(() => requestOnce(url, 'GET', sanitizeHeaders(headers), undefined, proxy), GET_RETRY);
    return { status: r.status, text: r.text, headers: r.headers, finalUrl: r.finalUrl, cookies: r.cookies };
}

/** 桌面端 GET 二进制下载（图片等，幂等重试）：返回 Buffer 供 vault.createBinary 写入 */
export async function nodeHttpGetBuffer(
    url: string,
    headers?: Record<string, string>,
    proxy?: string,
    opts: NodeHttpGetBufferOptions = {},
): Promise<NodeHttpBufferResponse> {
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : TIMEOUT_MS;
    const r = await retry(
        () => requestOnce(url, 'GET', sanitizeHeaders(headers), undefined, proxy, timeoutMs, opts.onProgress),
        GET_RETRY,
    );
    return { status: r.status, buffer: r.buffer, headers: r.headers, finalUrl: r.finalUrl };
}

/** 桌面端 POST（非幂等，不重试） */
export async function nodeHttpPost(url: string, body: string, headers?: Record<string, string>, proxy?: string): Promise<NodeHttpResponse> {
    return requestOnce(url, 'POST', sanitizeHeaders(headers), body, proxy);
}

/**
 * WebDAV 的 `PROPFIND`（列目录 / 取单文件属性）。
 *
 * 🔴 为什么不复用 `nodeHttpPost` 改个字符串：`PROPFIND` 在 HTTP 语义里是**幂等**的
 *    （只读、不改服务器状态），跟 `POST` 的安全假设正好相反 —— 这里保留重试才安全。
 *    但 `PROPFIND` 的 `Depth` 头决定「只列这一层」还是「递归整棵树」，与 body 一样是语义的一部分，
 *    所以单开一个函数把三样都摆明。
 *
 * ⚠️ 鉴权走 `Authorization: Basic`（见 `pure/webdav.davAuthHeader`）；`headers` 里已给就不覆盖。
 * ⚠️ 服务器返回 `207 Multi-Status` 是**正常**的；`401` 是账号密码错；`404` 是路径不对。
 *    这三种都原样交回给调用方判断，⛔ 不在这里翻译成人话 —— 文案归 UI 层。
 *
 * @param url     已规范化的 WebDAV 绝对地址（**目录要以 `/` 结尾**）
 * @param depth   `'0'` 只取自己；`'1'` 列这一层（默认）；`'infinity'` 递归（很多服务器不支持）
 * @param headers 额外请求头（`Authorization` / `Depth` 由本函数补，已给则保留调用方的）
 */
export async function nodeHttpPropfind(
    url: string,
    depth: '0' | '1' | 'infinity' = '1',
    headers?: Record<string, string>,
    proxy?: string,
): Promise<NodeHttpResponse> {
    // 🔴 为什么点名四个属性而不是 `<d:allprop/>`：
    //    ① 群晖 / 老版 AList 对 `allprop` 要么直接 400，要么把整棵树的全属性吐回来（几百 KB + 明显变慢）；
    //    ② `displayname` **不在** DAV 的 allprop 默认集合里，不点名就永远拿不到 ——
    //       而群晖和 Nextcloud 的 href 常是内部 UUID / 转义名，只有 displayname 才是真实文件名；
    //    ③ 按 RFC 4918 §9.1，服务器不支持的属性只会回一条 404 的 propstat，请求本身照样成功，
    //       所以点名比 allprop **更**兼容，不是更不兼容。
    const body =
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<d:propfind xmlns:d="DAV:"><d:prop>' +
        '<d:resourcetype/><d:getcontentlength/><d:getcontenttype/><d:displayname/>' +
        '</d:prop></d:propfind>';
    const h = sanitizeHeaders(headers);
    const has = (name: string): boolean => Object.keys(h).some((k) => k.toLowerCase() === name);
    if (!has('depth')) h.Depth = depth;
    // PROPFIND 幂等 ⇒ 可以重试（与 GET 同档）
    const r = await retry(() => requestOnce(url, 'PROPFIND', h, body, proxy), GET_RETRY);
    return { status: r.status, text: r.text, headers: r.headers, finalUrl: r.finalUrl, cookies: r.cookies };
}

/**
 * 桌面端**流式** POST（SSE / `stream: true` 用）。
 *
 * 🔴 由来（用户 m09565 ①-8）：字幕 AI 总结要「收到片段就追加」。
 *    非流式那条路要等模型把整段吐完（实测 8~15 秒），界面上只能先转圈再一次性出字。
 *
 * ⚠️ **不做重定向跟随**：AI 端点都是固定 URL、不会 3xx；而那套跟随逻辑在
 *    `requestOnce` 里与「整块收口」耦合在一起，搬过来只会让两条语义互相污染。
 *    真遇到 3xx 就按失败报给调用方（会带上 Location，便于排查）。
 *
 * ⚠️ **不用 `retry()`**：流式一旦开始吐字，重试会让界面上的文字从头再来一遍。
 *
 * @returns 状态码 + 累积全文（`text` 与逐块 `onText` 的内容按序拼接一致）
 */
export async function nodeHttpPostStream(
    url: string,
    body: string,
    headers?: Record<string, string>,
    opts: NodeHttpStreamOptions = {},
): Promise<NodeHttpStreamResult> {
    const mod = url.startsWith('https:') ? require('https') : require('http');
    const h = sanitizeHeaders(headers);
    // ⚠️ 与 `rawRequest` 同一条纪律：POST 必须显式给这两个头，
    //    否则 Node 用 chunked 发出去，不少 AI 网关会直接 400。
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['Content-Type'] = 'application/json';
    h['Content-Length'] = String(Buffer.byteLength(body ?? '', 'utf8'));
    // SSE 必须显式声明，否则某些网关会做缓冲、把流攒成一次性响应（那就白流式了）
    if (!Object.keys(h).some((k) => k.toLowerCase() === 'accept')) h.Accept = 'text/event-stream';

    const extra: Record<string, unknown> = {};
    if (opts.proxy && url.startsWith('https:')) {
        const target = new URL(url);
        const tls = require('tls');
        const socket = await openTunnel(target, opts.proxy);
        const secure = tls.connect({ socket, servername: target.hostname });
        await new Promise((res, rej) => {
            secure.once('secureConnect', res);
            secure.once('error', rej);
        });
        const agent = new mod.Agent({ keepAlive: false });
        agent.createConnection = () => secure;
        extra.agent = agent;
    }

    const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    const { StringDecoder } = require('string_decoder');

    return new Promise<NodeHttpStreamResult>((resolve) => {
        let status = 0;
        let all = '';
        let stopped = false;
        let stopReason: NodeHttpStreamResult['stopReason'];
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = (error?: string): void => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({ status, text: all, stopped, stopReason, error });
        };

        const req = mod.request(url, { method: 'POST', headers: h, ...extra }, (res: {
            statusCode: number;
            headers: Record<string, string | string[] | undefined>;
            on: (e: string, cb: (...a: never[]) => void) => void;
            destroy: (e?: Error) => void;
            setEncoding?: (enc: string) => void;
        }) => {
            status = res.statusCode;
            opts.onResponse?.(res.statusCode, res.headers);
            const decoder = new StringDecoder('utf8');
            res.on('data', (chunk: Buffer) => {
                if (settled) return;
                // ⚠️ 用 StringDecoder 兜住「多字节字符被 TCP 切半」
                const text = decoder.write(Buffer.from(chunk));
                if (!text) return;
                all += text;
                opts.onText?.(text);
                if (opts.shouldStop?.()) {
                    stopped = true;
                    stopReason = 'done';
                    // ⚠️ 先 destroy 再 finish：不 destroy 的话连接会挂到服务端超时，
                    //    在 Electron 里表现为「页面关了但请求还在」
                    try {
                        res.destroy();
                    } catch {
                        /* 已断开 */
                    }
                    finish();
                }
            });
            res.on('error', (e: Error) => {
                if (stopped) return;
                finish(e?.message || '流式响应中断');
            });
            res.on('end', () => {
                // 收尾时把解码器里可能残留的半个字符吐出来
                const tail = decoder.end();
                if (tail) {
                    all += tail;
                    opts.onText?.(tail);
                }
                finish();
            });
        });

        req.on('error', (e: Error) => {
            if (stopped) return;
            finish(e?.message || '流式请求失败');
        });
        timer = setTimeout(() => {
            stopped = true;
            stopReason = 'timeout';
            try {
                req.destroy();
            } catch {
                /* 已断开 */
            }
            finish(`流式请求超时（${timeoutMs}ms）`);
        }, timeoutMs);

        // 外部取消（关面板 / 换集）
        if (opts.signal) {
            const tick = setInterval(() => {
                if (settled || !opts.signal?.aborted) return;
                clearInterval(tick);
                stopped = true;
                stopReason = 'abort';
                try {
                    req.destroy();
                } catch {
                    /* 已断开 */
                }
                finish();
            }, 120);
            req.once('close', () => clearInterval(tick));
        }

        // ⚠️ 用 `end(body)` 一次写完（配合上面的 Content-Length 才是定长发送）
        req.end(body ?? '');
    });
}

