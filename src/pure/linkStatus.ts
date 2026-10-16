/**
 * 剧集网络链接「失效」判定（纯逻辑，#527；无 obsidian 依赖，可单测）。
 *
 * 🔴 用户原话：「新增支持检测剧集网络链接失效的项，呈现为红色」。
 * 判定口径（**尽力而为，不是权威**）：
 *   · **B 站链接** —— 从 URL 取 `BV…` 号，打 `x/web-interface/view?bvid=` 看返回 `code`
 *     （`0` = 正常；`-404` 稿件不存在 / `62002` 稿件不可见 / `62004` … ⇒ **失效**）。这是最准的一条。
 *   · **其它 http(s)** —— 直接 GET 看状态码（`2xx/3xx` 正常；`404/410` 失效；`403`/`5xx`/超时
 *     ⇒ **无法确认**，很多站点对非浏览器请求一律 403，不能当成失效）。
 *   · **本地路径 / 非 http** —— **不参与检测**（结果位留 `undefined`）。
 *
 * 🔴 三态而不是两态：`unknown` 必须与 `dead` 分开 —— 把「测不动」显示成「已失效」会误导用户
 *    （他会去删掉其实好好的链接）。
 */

/** 链接状态：正常 / 失效 / 无法确认 */
export type LinkStatus = 'ok' | 'dead' | 'unknown';

/** B 站视频号：`BV` + 10 位 base58 */
const BVID_RE = /BV[0-9A-Za-z]{10}/;
/** B 站「看视频是否存在」的公开接口（免签名，实测可用） */
export const BILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
/** 探测请求用的桌面 UA */
export const LINK_CHECK_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** http/https 链接判定（本地路径 / 空 → false） */
export function isHttpUrl(url: unknown): boolean {
    return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/**
 * 从链接里取 B 站视频号（`bvid`）；非 B 站域名 / 取不到 → `undefined`。
 * ⚠️ 限定域名是刻意的：别的站点 URL 里也可能恰好出现 `BV…` 串，误判会把普通链接打去 B 站接口。
 */
export function bvidOf(url: unknown): string | undefined {
    if (typeof url !== 'string') return undefined;
    if (!/(^|\/\/|\.)bilibili\.com|(^|\/\/|\.)b23\.tv/i.test(url)) return undefined;
    const m = BVID_RE.exec(url);
    return m ? m[0] : undefined;
}

/** B 站探测地址（`view?bvid=`） */
export function buildBiliCheckUrl(bvid: string): string {
    return `${BILI_VIEW_API}?bvid=${bvid}`;
}

/** `view` 接口的业务 `code` → 状态：0 正常；-404 / -403 / 62002 / 62004 ⇒ 失效；其余 ⇒ 无法确认 */
export function statusFromBiliCode(code: unknown): LinkStatus {
    if (code === 0) return 'ok';
    if (code === -404 || code === -403 || code === 62002 || code === 62004) return 'dead';
    return 'unknown';
}

/** 从 `view` 响应文本取 `code`（非 JSON / 无 code / 类型不对 → `undefined`） */
export function parseBiliCode(text: unknown): number | undefined {
    if (typeof text !== 'string' || !text) return undefined;
    try {
        const j = JSON.parse(text) as unknown;
        if (j && typeof j === 'object' && typeof (j as { code?: unknown }).code === 'number') {
            return (j as { code: number }).code;
        }
    } catch {
        /* 非 JSON（拦截页 / 风控页）→ 无法确认 */
    }
    return undefined;
}

/** 普通 HTTP 状态码 → 状态：2xx/3xx 正常；404/410 失效；其余（403 / 5xx / 拿不到）无法确认 */
export function statusFromHttpStatus(status: unknown): LinkStatus {
    if (typeof status !== 'number' || !Number.isFinite(status)) return 'unknown';
    if (status >= 200 && status < 400) return 'ok';
    if (status === 404 || status === 410) return 'dead';
    return 'unknown';
}

/** 是否「失效」（只认 `dead`；`unknown` 不算） */
export function isDead(s: LinkStatus | undefined): boolean {
    return s === 'dead';
}

/** 结果汇总（给提示文案用；`checked` = 真被探测过的位数） */
export function summarizeLinkStatus(list: (LinkStatus | undefined)[]): {
    ok: number;
    dead: number;
    unknown: number;
    checked: number;
} {
    let ok = 0;
    let dead = 0;
    let unknown = 0;
    for (const s of list) {
        if (s === 'ok') ok++;
        else if (s === 'dead') dead++;
        else if (s === 'unknown') unknown++;
    }
    return { ok, dead, unknown, checked: ok + dead + unknown };
}

/** 全库扫描的一个目标：某条目的网络地址数组（**下标与 `episodeUrls` 对齐**） */
export interface LinkScanTarget {
    entryId: string;
    urls: (string | undefined)[];
}

/**
 * #531 从条目列表里收集**全库待检目标**（设置页那枚「检测失效链接」用）。
 * 🔴 只收**含 http(s) 网络地址**的条目（本地路径不参与）⇒ 没填网络地址的条目一个请求都不发；
 *    `urls` 原样保留（含空位）—— 下标必须与 `episodeUrls` 对齐，否则标红会错集。
 */
export function collectLinkScanTargets(
    entries: ReadonlyArray<{ id: string; episodeUrls?: (string | undefined)[] }>,
): LinkScanTarget[] {
    const out: LinkScanTarget[] = [];
    for (const e of entries) {
        const urls = Array.isArray(e.episodeUrls) ? e.episodeUrls : [];
        if (!urls.some((u) => isHttpUrl(u))) continue;
        out.push({ entryId: e.id, urls: [...urls] });
    }
    return out;
}
