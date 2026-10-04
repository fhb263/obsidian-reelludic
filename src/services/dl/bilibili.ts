/**
 * B 站搜索服务层（#496，2026-10-03）—— 只做「发请求 + 拼装」，形态全在 `pure/dl/bilibili`（可单测）。
 *
 * 🔴 **两步请求，顺序不能反**：
 *   ⑴ `GET https://www.bilibili.com/` 拿 `Set-Cookie: buvid3=…`；
 *   ⑵ 拿它去 `GET …/search/type?search_type=video&keyword=…`。
 *   **直接打第 2 步 = `HTTP 412`（风控）** —— 2026-10-03 实测，不带 Cookie 一定 412。
 *
 * 🔴 `buvid3` **进程内缓存**（模块级）：它是长效 Cookie，每次搜索都去首页取一遍纯属浪费一个来回。
 *   ⚠️ 但**不能只靠缓存**：接口偶尔会在 Cookie 还有效时也风控 ⇒ 第一次失败时**强制重取一次**再试，
 *     仍失败才把原因报给用户（见 `dlBiliSearch`）。⛔ 别把重试删成「一次不成就报错」，
 *     那会让偶发风控表现成「点了没反应 / 搜不到」。
 */
import {
    BILI_COOKIE_NAME,
    BILI_HOME_URL,
    BILI_REFERER,
    BILI_UA,
    biliSearchError,
    biliViewError,
    buildBiliSearchUrl,
    buildBiliViewUrl,
    parseBiliBuvid3,
    parseBiliSearch,
    parseBiliView,
    type BiliPart,
    type BiliSearchParse,
    type BiliVideo,
    type BiliViewParse,
} from 'pure/dl/bilibili';
import type { DlTransport } from 'services/dl';

/**
 * 会话内的 `buvid3` 缓存。
 * ⚠️ 测试要能复位它 ⇒ 只暴露一个 `resetBiliCookieCache()`（⛔ 别直接把变量导出去让外部随便改）。
 */
let cachedBuvid3 = '';

/** 清空 `buvid3` 缓存（单测用；运行时没有调用点 —— 重试路径走 `ensureBiliCookie(t, true)`） */
export function resetBiliCookieCache(): void {
    cachedBuvid3 = '';
}

/** 取 `buvid3`（`force` = 丢掉缓存重新去首页取一次；拿不到就回空串，调用方照常发请求） */
export async function ensureBiliCookie(t: DlTransport, force = false): Promise<string> {
    if (cachedBuvid3 && !force) return cachedBuvid3;
    try {
        const res = await t.get(BILI_HOME_URL, { 'User-Agent': BILI_UA });
        const raw = res?.headers?.['set-cookie'];
        const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
        cachedBuvid3 = parseBiliBuvid3(list);
    } catch {
        cachedBuvid3 = '';
    }
    return cachedBuvid3;
}

/** 打一次搜索接口。HTTP 层失败 ⇒ `code = -HTTP`（`parseBiliSearch` 只认业务码） */
async function biliSearchOnce(t: DlTransport, keyword: string, refreshCookie: boolean): Promise<BiliSearchParse> {
    const cookie = await ensureBiliCookie(t, refreshCookie);
    const headers: Record<string, string> = { 'User-Agent': BILI_UA, Referer: BILI_REFERER };
    if (cookie) headers.Cookie = `${BILI_COOKIE_NAME}=${cookie}`;
    const res = await t.get(buildBiliSearchUrl(keyword), headers);
    if (!res || res.status < 200 || res.status >= 300) {
        return { code: -(res?.status || 0), message: '', videos: [] };
    }
    return parseBiliSearch(res.text);
}

/** 请求成功（哪怕空列表）就算数 ⇒ 不必重试；否则看是不是「HTTP 层失败」 */
function isRetryable(parse: BiliSearchParse): boolean {
    return parse.code !== 0;
}

/**
 * 搜 B 站视频。
 * - 空关键词 ⇒ 直接给原因（⛔ 不白跑一次请求）；
 * - `code === 0` ⇒ 原样返回（**空列表也是成功**，与风控不是一回事）；
 * - 失败 ⇒ **强制重取 `buvid3` 重试一次**，仍失败才带出原因。
 */
export async function dlBiliSearch(
    t: DlTransport,
    keyword: string,
): Promise<{ videos: BiliVideo[]; error?: string }> {
    const kw = String(keyword ?? '').trim();
    if (!kw) return { videos: [], error: 'B 站搜索需要关键词：先在搜索框里输入，再点「B站」' };
    try {
        const first = await biliSearchOnce(t, kw, false);
        if (!isRetryable(first)) return { videos: first.videos };
        const second = await biliSearchOnce(t, kw, true);
        if (!isRetryable(second)) return { videos: second.videos };
        // HTTP 层失败（code < 0）与服务层无关的文案分开写：前者要用户看状态码，后者看 B 站自己的 message
        if (second.code < 0) return { videos: [], error: `B 站搜索请求失败（HTTP ${-second.code || '未知'}）` };
        return { videos: [], error: biliSearchError(second) };
    } catch (e) {
        return { videos: [], error: `B 站搜索出错：${e instanceof Error ? e.message : String(e)}` };
    }
}

// ────────────────────── 分P（#505）──────────────────────

/** 打一次视频详情接口（与 `biliSearchOnce` 同款：共用 `buvid3` 缓存与重取开关） */
async function biliViewOnce(t: DlTransport, bvid: string, refreshCookie: boolean): Promise<BiliViewParse> {
    const cookie = await ensureBiliCookie(t, refreshCookie);
    const headers: Record<string, string> = { 'User-Agent': BILI_UA, Referer: BILI_REFERER };
    if (cookie) headers.Cookie = `${BILI_COOKIE_NAME}=${cookie}`;
    const res = await t.get(buildBiliViewUrl(bvid), headers);
    if (!res || res.status < 200 || res.status >= 300) {
        return { code: -(res?.status || 0), message: '', title: '', parts: [] };
    }
    return parseBiliView(res.text);
}

/**
 * 取一条视频的**分P 列表**（#505：长篇一次填完的前提）。
 * 🔴 与搜索**同一条纪律**：失败时**强制重取 `buvid3` 重试一次**再报原因 ——
 *    `view` 同样吃风控（实测不带 Cookie 会 412），重试能救掉偶发那一次。
 * ⚠️ 空 `parts` **不是错误**（单P 视频只有 1 条、也可能真没有 `pages`）——
 *    调用方据此走「直接填这一条」的老路（能力回落，⛔ 别把能用的路堵死）。
 */
export async function dlBiliView(
    t: DlTransport,
    bvid: string,
): Promise<{ title: string; parts: BiliPart[]; error?: string }> {
    const b = String(bvid ?? '').trim();
    if (!b) return { title: '', parts: [], error: '缺少 bvid' };
    try {
        const first = await biliViewOnce(t, b, false);
        if (first.code === 0) return { title: first.title, parts: first.parts };
        const second = await biliViewOnce(t, b, true);
        if (second.code === 0) return { title: second.title, parts: second.parts };
        if (second.code < 0) return { title: '', parts: [], error: `读取分P请求失败（HTTP ${-second.code || '未知'}）` };
        return { title: '', parts: [], error: biliViewError(second) };
    } catch (e) {
        return { title: '', parts: [], error: `读取分P出错：${e instanceof Error ? e.message : String(e)}` };
    }
}
