/**
 * 网盘（WebDAV）资源关联 —— **纯逻辑**，无 obsidian / Node 依赖，可单测。
 *
 * 🔴 为什么选 WebDAV 而不做各家私有 API（用户在本次会话拍板）：
 *    OpenList/AList、群晖 DSM、坚果云、Nextcloud、Infuse 同一套协议，
 *    一套实现覆盖全部网盘；做阿里云盘/百度网盘的私有 API 等于每接一家写一遍，
 *    而且要跟着人家的风控一直改。金标准就是 WebDAV（见 OpenList 文档
 *    `doc.oplist.org/guide/drivers/common#webdav-policy`）。
 *
 * 分三层（与 strm 指针模式同构）：
 *   ① 关联层：`/api` 无关，就一条 PROPFIND 列目录，把选中的文件地址写进
 *      `entry.episodeUrls[i]` —— 只存 URL 指针、不搬文件，与 Alist-Strm / 小雅同一思路；
 *   ② 打开层：地址交给系统浏览器（浏览器会自己弹 Basic Auth 登录框）；
 *   ③ 内置层：只有 Chromium 能解的容器（mp4/webm/mov/ogv）才灌给 `<video>`。
 *
 * ⚠️ 与 2026-11-24「网络集移出插件播放器」那条裁定的关系：那条裁掉的是
 *    **自取流**（DASH / MSE / yt-dlp 合流那半套），因为它要维护解析器、跟着站点改、
 *    还会把 mkv/HEVC 播成黑屏。本模块做的是「一个 http(s) 直链灌进现成 `<video>`」，
 *    没有任何取流逻辑；且用户在本次会话重新拍板选了「可解码的直链内置」这一档
 *    （不可解码 / 需鉴权的一律转浏览器，永不黑屏）。⛔ 别把取流那半套接回来。
 */

import { isAssociableVideoPath, isEmbeddableVideoPath } from 'pure/mediaExtensions';

/**
 * 网盘关联功能总开关 —— **唯一的放开闸门**。
 *
 * 🔴 当前 false（用户 2026-11 裁定：「把关联网盘方式及入口隐藏掉，先等我发布 1.5.0
 *    再下个版本放开」）。1.5.0 里的网盘那半套是**完整写完并验证过的**（纯逻辑 / 列目录 /
 *    选片弹窗 / 设置组 / 直链内置播放全在），只是入口不露出来 —— 下个版本把这一行改成
 *    `true` 就整体放开，⛔ 不需要去各处补代码。
 *
 * 为什么用常量而不是删代码 / 用设置项：
 *   ① 删代码再抄回来必然漂（这一整套 1000+ 行、跨 10 个文件）；
 *   ② 做成设置项等于**当场可见**，与「先别露出来」的诉求相反。
 *
 * ⚠️ 本开关只挡**入口**，不挡已存的 `davUrl` / `davUser` / `davPass` 设置字段 ——
 *    字段留着，放开那天用户直接有值可用，不必重填。
 * ⚠️ 关掉时被门控的三个点（全部经由 `main.webdavReady()`）：
 *    ① 设置页「网盘关联」组不建；② 条目表单「从网盘导入」按钮不出现；
 *    ③ `openWebdavPicker` 早退。
 */
export const WEBDAV_ENABLED = false;

/** PROPFIND 列目录得到的一条记录。 */
export interface DavEntry {
    /** 服务器返回的 href 解码后的路径（用于调试与去重，⛔ 别直接灌给 `<video>`） */
    href: string;
    /** 显示名（末段；目录不带尾斜杠） */
    name: string;
    /** 可直接写进 `episodeUrls` 的**绝对地址** */
    url: string;
    isDir: boolean;
    /** 字节数；服务器没给就是 0 */
    size: number;
    /** MIME；服务器没给就是空串 */
    mime: string;
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * UTF-8 字符串 → Base64。
 *
 * 🔴 为什么不 `btoa(str)`：`btoa` 只吃 Latin-1，网盘用户名/密码里有中文会直接抛
 *    `InvalidCharacterError`（群晖、坚果云的中文账号很常见）。
 *    这里自己按 UTF-8 编字节，浏览器与 Node 两边结果完全一致，也便于单测钉死。
 */
function base64OfUtf8(input: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
        let cp = input.charCodeAt(i);
        // 代理对（emoji 之类）要合成一个码点，否则会编出两个非法字节序列
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
            const lo = input.charCodeAt(i + 1);
            if (lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                i++;
            }
        }
        if (cp < 0x80) bytes.push(cp);
        else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
        out += B64_CHARS[b0 >> 2];
        out += B64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
        out += b1 === undefined ? '=' : B64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
        out += b2 === undefined ? '=' : B64_CHARS[b2 & 0x3f];
    }
    return out;
}

/**
 * 规范化 WebDAV 入口地址。
 *
 * 容错口径（用户手填的东西，⛔ 不许因为少个斜杠就报错）：
 *  - 只写 `host:5244` ⇒ 补 `https://`（OpenList 默认 HTTPS；不行用户会改）；
 *  - 结尾没 `/` ⇒ 补上（`new URL(href, base)` 少了它就是「替换最后一段」，路径会错位）；
 *  - 带 query / hash ⇒ 砍掉（WebDAV 入口不该有）；
 *  - 非 http(s) 或解析不了 ⇒ 空串（调用方按「没配」处理，⛔ 别抛）。
 */
export function normalizeDavBase(raw: unknown): string {
    let s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        if (/^\/\//.test(s)) s = `https:${s}`;
        else s = `https://${s.replace(/^\/+/, '')}`;
    }
    if (!/^https?:\/\//i.test(s)) return '';
    let u: URL;
    try {
        u = new URL(s);
    } catch {
        return '';
    }
    if (!u.hostname) return '';
    u.search = '';
    u.hash = '';
    // 路径必须以 `/` 结尾 —— 这是 `new URL(relative, base)` 的语义前提
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
}

/**
 * 由账号密码拼 `Authorization` 头；两个都空 ⇒ 空串（= 匿名访问）。
 *
 * ⚠️ 为什么不在 `<video src>` 里塞 `http://user:pass@host`：
 *    Chrome 自 M59 起**屏蔽子资源 URL 内嵌凭据**，那样写出来的地址会被静默拒载
 *    （表现为「黑屏 / 点了没反应」）。带鉴权的网盘只能走浏览器（它会弹登录框）。
 */
export function davAuthHeader(user: unknown, pass: unknown): string {
    const u = typeof user === 'string' ? user : '';
    const p = typeof pass === 'string' ? pass : '';
    if (!u && !p) return '';
    return `Basic ${base64OfUtf8(`${u}:${p}`)}`;
}

/** 解 XML 里最常见的五个实体 + 数字实体（WebDAV 的 href 常带 `&amp;`） */
export function decodeXmlEntities(s: string): string {
    if (!s) return '';
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** href 是百分号编码的路径；解不开就原样返回（有的服务器会把 `%` 当普通字符） */
function decodeHrefPath(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/** 取路径末段（去尾斜杠）；根目录 ⇒ 空串 */
function lastName(path: string): string {
    const t = path.replace(/\/+$/, '');
    const i = t.lastIndexOf('/');
    return i >= 0 ? t.slice(i + 1) : t;
}

/**
 * 把 URL 或路径规整成「可比较的路径」：只留 pathname、解百分号编码、去掉尾部斜杠。
 *
 * 🔴 为什么不能拿 URL 整串比：同一个目录，服务器可能回 `%E5%8A%A8%E7%94%BB/`、
 *    也可能回中文原文，尾斜杠还时有时无 —— 整串比较会把「自己」当成一条新目录列出来。
 */
function comparablePath(urlOrPath: string): string {
    if (!urlOrPath) return '';
    let p = urlOrPath;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) {
        try {
            p = new URL(urlOrPath).pathname;
        } catch {
            p = urlOrPath;
        }
    }
    return decodeHrefPath(p).replace(/\/+$/, '');
}

/**
 * 只保留 `propstat` 里**状态成功**的那几段。
 *
 * 🔴 RFC 4918 §9.1 允许服务器把「不支持的属性」单独回一条
 *    `<propstat><status>HTTP/1.1 404 Not Found</status>...`，
 *    而那条里常带 `<getcontentlength>0</getcontentlength>` 这类占位值。
 *    整块直接正则匹配就会把它读成真实大小 —— 文件在界面上显示 0 字节、mime 变成垃圾。
 *
 * ⚠️ 完全没写 `<status>` 的按成功处理（个别老服务器省了这个字段），
 *    ⛔ 不要掉进「缺字段就整段丢弃」的反向坑 —— 那会让老服务器一条都列不出来。
 */
function keepOkPropstat(block: string): string {
    const parts = block.split(/<(?:[\w-]+:)?propstat\b/i);
    if (parts.length <= 1) return block;
    const kept: string[] = [parts[0]];
    for (let i = 1; i < parts.length; i++) {
        const st = parts[i].match(/<(?:[\w-]+:)?status\b[^>]*>\s*HTTP\/[\d.]+\s+(\d{3})/i);
        if (!st) {
            kept.push(parts[i]);
            continue;
        }
        const code = parseInt(st[1], 10);
        if (code >= 200 && code < 300) kept.push(parts[i]);
    }
    return kept.join('');
}

/**
 * 解析 PROPFIND 的 `207 Multi-Status` 响应体。
 *
 * 🔴 为什么手写正则而不是 DOMParser / 第三方 XML 库：
 *    本仓立过一条纪律「⛔ 不引第三方库，也不用 DOMParser」（见 `pure/doubanSync.ts:196`），
 *    而 WebDAV 的响应结构极稳定（`<response>` → `<href>` + `<propstat>`/`<prop>`），
 *    正则足够且没有 XXE / 命名空间前缀（`D:` / `d:` / 无前缀）这些坑。
 *
 * ⚠️ 必须**容忍任意命名空间前缀**：群晖发 `D:`、Nextcloud 发 `d:`、有的发 `<response>` 裸标签。
 *    所以所有标签都按「可选的 `前缀:`」匹配，⛔ 别写死某一家。
 *
 * @param xml     PROPFIND 响应正文
 * @param baseUrl 已规范化的 WebDAV 入口（用于把服务器给的 href 拼成绝对地址）
 */
export function parseDavList(xml: unknown, baseUrl: unknown): DavEntry[] {
    const text = typeof xml === 'string' ? xml : '';
    const base = typeof baseUrl === 'string' ? baseUrl : '';
    if (!text.trim() || !base) return [];
    let baseNorm = '';
    try {
        baseNorm = new URL(base).toString();
    } catch {
        return [];
    }
    const out: DavEntry[] = [];
    const basePath = comparablePath(base);
    // 按 <response> 切块；split 后第 0 块是根元素的头，从 1 开始才是真记录
    const blocks = text.split(/<(?:[\w-]+:)?response\b/i);
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const hrefM = block.match(/<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href\s*>/i);
        if (!hrefM) continue;
        const rawHref = decodeXmlEntities(hrefM[1].trim());
        if (!rawHref) continue;
        const hrefPath = decodeHrefPath(rawHref);
        // 🔴 只看 `propstat` 里 200 的那几段。
        //    RFC 4918 允许服务器把「不支持的属性」单独回一条 `<propstat><status>404</status>`，
        //    而那条里常带 `<getcontentlength>0</getcontentlength>` 之类的占位值 ——
        //    整块直接 match 就会把它当成真实大小/类型读进来（文件显示 0 字节、mime 变成垃圾）。
        const okPart = keepOkPropstat(block);
        // `<collection/>` 才是目录（`<D:resourcetype><D:collection/></D:resourcetype>`）
        const isDir = /<(?:[\w-]+:)?collection\b/i.test(okPart);
        const sizeM = okPart.match(/<(?:[\w-]+:)?getcontentlength\b[^>]*>\s*(\d+)\s*<\//i);
        const mimeM = okPart.match(/<(?:[\w-]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\//i);
        const mime = mimeM ? decodeXmlEntities(mimeM[1].trim()) : '';
        // 🔴 displayname 优先：群晖 / Nextcloud 的 href 可能是内部 UUID 或编码后的名字，
        //    只有 displayname 才是用户在文件管理器里看到的那个。取不到再退回 href 末段。
        const dispM = okPart.match(/<(?:[\w-]+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?displayname\s*>/i);
        const displayName = dispM ? decodeXmlEntities(dispM[1].trim()) : '';
        let absolute = '';
        try {
            absolute = new URL(rawHref, baseNorm).toString();
        } catch {
            continue;
        }
        const name = displayName || lastName(hrefPath) || lastName(new URL(absolute).pathname);
        // 服务器的列表里**包含它自己**（base 那一行）—— 丢掉，否则界面上会多一条同名目录。
        // 🔴 按「解码后的路径」比对而不是整串 URL：同一个目录可能被服务器写成
        //    `%E5%8A%A8%E7%94%BB/` 或直接中文，尾斜杠也时有时无，整串比较会漏判。
        if (isDir && comparablePath(absolute) === basePath) continue;
        out.push({
            href: hrefPath,
            name,
            url: absolute,
            isDir,
            size: sizeM ? parseInt(sizeM[1], 10) || 0 : 0,
            mime,
        });
    }
    // 目录在前、同类按名字排：与系统文件管理器一致，用户扫一眼就能找到
    out.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return out;
}

/** 这条记录值得关联进剧集吗（视频文件，mkv/avi 也算 —— 它们能交系统播放器） */
export function isDavVideoEntry(e: DavEntry | null | undefined): boolean {
    return !!e && !e.isDir && isAssociableVideoPath(e.name);
}

/**
 * 这条记录能不能**在插件里直接播**。
 *
 * 判据只有「Chromium 能不能解这个容器」，与「服务器要不要鉴权」无关 ——
 * 后者是靠 `<video>` 的 error 事件兜到浏览器去。⚠️ 单看扩展名只是必要条件：
 * HEVC 编码的 mp4 同样会黑屏，所以 error 兜底那条路**必须留着**。
 */
export function isDavPlayableEntry(e: DavEntry | null | undefined): boolean {
    return !!e && !e.isDir && isEmbeddableVideoPath(e.name);
}

/**
 * 这个 URL 是不是「可直链内置播放的视频」（`episodeUrls` 里的地址一律过这一关）。
 *
 * 只认 http(s) + Chromium 可解容器；`app://` 之类的本地资源由本地文件那条路负责，
 * ⛔ 别在这里放行。
 */
export function isDirectPlayableVideoUrl(url: unknown): boolean {
    const s = typeof url === 'string' ? url.trim() : '';
    if (!s || !/^https?:\/\//i.test(s)) return false;
    let pathname = '';
    try {
        pathname = new URL(s).pathname;
    } catch {
        return false;
    }
    return isEmbeddableVideoPath(pathname);
}

/** 人话的字节数（`1.2 GB`）；给选片弹窗显示用 */
export function formatDavSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}
