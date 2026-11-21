/**
 * 微信读书搜索服务层（#529）—— 只做「发请求 + 解析」，形态全在 `pure/weread`（可单测）。
 *
 * 🔴 免登录可搜（2026-10-05 实测）；只桌面端（走 Node 传输层 `DlTransport`，移动端没有）。
 * ⛔ 不下载、不解析正文 —— 我们只要「书名 / 作者 / 封面 / 简介 / 阅读链接」这几项回填用。
 * 失败一律**不抛**：返回 `{ books: [], error }`，由调用方提示（对齐 `services/dl/bilibili` 的口径）。
 */
import {
    buildWereadBookInfoUrl,
    buildWereadSearchUrl,
    buildWereadShelfUrl,
    normalizeWereadCookie,
    parseWereadBookInfo,
    parseWereadSearch,
    parseWereadShelfAuth,
    toWereadBookResult,
    WEREAD_ACCEPT,
    WEREAD_REFERER,
    WEREAD_UA,
    type WereadAuthProbe,
    type WereadBookInfo,
    type WereadCandidate,
} from 'pure/weread';
import { parseWereadShelf, type WereadShelfParse } from 'pure/wereadShelf';
import {
    buildWereadBookmarkUrl,
    buildWereadGatewayBody,
    buildWereadReviewUrl,
    mergeWereadNotes,
    parseWereadApiKey,
    parseWereadBookmarks,
    parseWereadReviews,
    WEREAD_APIKEY_URL,
    WEREAD_GATEWAY_BOOKMARKS,
    WEREAD_GATEWAY_URL,
    type WereadNote,
    type WereadNotesParse,
} from 'pure/wereadNotes';
import type { BookSearchResult } from 'services/resultTypes';
import type { DlTransport } from 'services/dl';

export interface WereadSearchOutcome {
    /** 候选（保序、已去重；只含拼得出阅读链接的条目） */
    books: WereadCandidate[];
    /** 失败原因（成功时不带） */
    error?: string;
    /** 实际使用的检索词（成功时带） */
    query?: string;
}

/** ②-4 拉划线的结果（`ok: false` 时 `notes` 恒为空，⛔ 别拿空数组当「没有笔记」）。 */
export interface WereadNotesOutcome {
    ok: boolean;
    notes: WereadNote[];
    /** 硬失败原因：没 Cookie / 划线端点失败 / 登录态失效 */
    error?: string;
    /** 软失败：划线拿到了、想法没拿到（决定要不要提示用户） */
    warning?: string;
}

/** 搜索微信读书（`keyword` 为空 → 空结果 + error）。 */
export async function searchWeread(t: DlTransport, keyword: string): Promise<WereadSearchOutcome> {
    const kw = (keyword ?? '').trim();
    if (!kw) return { books: [], error: '检索词为空' };
    let res: { status: number; text: string } | undefined;
    try {
        res = await t.get(buildWereadSearchUrl(kw), {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
        });
    } catch {
        return { books: [], error: '网络请求失败' };
    }
    if (!res || res.status < 200 || res.status >= 300) {
        return { books: [], error: `微信读书返回 ${res?.status ?? '错误'}` };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(res.text);
    } catch {
        return { books: [], error: '返回内容无法解析' };
    }
    return { books: parseWereadSearch(raw), query: kw };
}

/**
 * #580「测试连接」：带用户的 Cookie 打一次**书架**接口，验它是不是真登录态。
 *
 * 🔴 三条口径：
 *   ⑴ **不能只看状态码** —— 未登录时该端点回 HTTP 200（实测），真相在 body 的 `errCode` 里
 *      ⇒ 判定全交给纯函数 `parseWereadShelfAuth`；
 *   ⑵ 空 Cookie **不发请求**（省一次必然失败的往返，也避免把「没填」误报成「网络失败」）；
 *   ⑶ 本函数**不抛**（与 `searchWeread` 同款）：失败折进 `{ ok: false, message }`，
 *      由宿主 `runTest` 统一测耗时并落到设置页那行小字上。
 */
export async function testWereadAuth(
    t: DlTransport,
    cookie: unknown,
): Promise<Pick<WereadAuthProbe, 'ok' | 'message'>> {
    const ck = normalizeWereadCookie(cookie);
    if (!ck) return { ok: false, message: '未填写 Cookie' };
    let res: { status: number; text: string } | undefined;
    try {
        res = await t.get(buildWereadShelfUrl(), {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
            Cookie: ck,
        });
    } catch {
        return { ok: false, message: '网络请求失败' };
    }
    if (!res || res.status < 200 || res.status >= 300) {
        return { ok: false, message: `微信读书返回 ${res?.status ?? '错误'}` };
    }
    return parseWereadShelfAuth(res.text);
}

/**
 * #581 读**书架**（同步弹窗的数据源）—— 与 `testWereadAuth` **同一个端点、同一份 Cookie**，
 * 只是这一次要的是**数据**而不是「能不能连上」。
 *
 * 🔴 三条口径：
 *   ⑴ 空 Cookie **不发请求**（与 `testWereadAuth` 同款）；
 *   ⑵ **不抛**：失败折进 `{ ok: false, message }` —— 弹窗把 message 直接显示给用户
 *      （⛔ 不让异常穿过 UI 层变成「未捕获的 Promise 拒绝」）；
 *   ⑶ 形态判定全交给纯函数 `parseWereadShelf`（含 `errCode` 文案，与测试连接**共用一份真源**）。
 * ⚠️ 只桌面端：底层走 Node 传输层（移动端由宿主那边判平台）。
 */
export async function fetchWereadShelf(t: DlTransport, cookie: unknown): Promise<WereadShelfParse> {
    const ck = normalizeWereadCookie(cookie);
    if (!ck) return { ok: false, message: '未填写微信读书 Cookie' };
    let res: { status: number; text: string } | undefined;
    try {
        res = await t.get(buildWereadShelfUrl(), {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
            Cookie: ck,
        });
    } catch {
        return { ok: false, message: '网络请求失败' };
    }
    if (!res || res.status < 200 || res.status >= 300) {
        return { ok: false, message: `微信读书返回 ${res?.status ?? '错误'}` };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(res.text);
    } catch {
        return { ok: false, message: '返回内容无法解析（多半被风控或接口变更）' };
    }
    return parseWereadShelf(raw);
}

/**
 * #582 拉**一本书的详情**（逐本补评分 / 简介 / 出版社 / ISBN / 分类 / 出版年）。
 *
 * 🔴 失败一律 **`null`**（不抛）：导入流程靠它**静默降级**回书架级字段 ——
 *    ⛔ 别让「某本书详情没拉到」把整次导入打断。
 * ⚠️ 只桌面端（Node 传输层）；调用方负责**串行 + 间隔**（`WEREAD_INFO_GAP_MS`），本函数不管节流。
 */
export async function fetchWereadBookInfo(
    t: DlTransport,
    cookie: unknown,
    bookId: string,
): Promise<WereadBookInfo | null> {
    const ck = normalizeWereadCookie(cookie);
    const id = String(bookId ?? '').trim();
    if (!ck || !id) return null;
    let res: { status: number; text: string } | undefined;
    try {
        res = await t.get(buildWereadBookInfoUrl(id), {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
            Cookie: ck,
        });
    } catch {
        return null;
    }
    if (!res || res.status < 200 || res.status >= 300) return null;
    try {
        return parseWereadBookInfo(JSON.parse(res.text));
    } catch {
        return null;
    }
}

/** ②-4 拉一本书的划线 + 想法（同步到笔记 `### 同步划线与高亮` 用）。
 *
 * 🔴 口径与上面几个拉取函数一致，另有两条是 ②-4 专有的：
 *   ⑴ **两个端点分开报错**：划线（`bookmarklist`）与想法（`review/list`）是两条独立接口，
 *      一个空 / 一个挂掉时不能整体判死 —— 划线成功、想法失败时照样把划线写进笔记，
 *      失败原因折进 `warning`（宿主据此提示，⛔ 不静默当「这本书没有笔记」）；
 *   ⑵ 划线这一步失败就**不再打想法**：登录态失效（-2010 / -2012）对两个端点同时成立，
 *      多打一次只会让用户多等一个往返。
 * ⚠️ 只桌面端（Node 传输层）；调用方负责串行 + 间隔，本函数不管节流。
 */
export async function fetchWereadNotes(
    t: DlTransport,
    cookie: unknown,
    bookId: string,
): Promise<WereadNotesOutcome> {
    const ck = normalizeWereadCookie(cookie);
    const id = String(bookId ?? '').trim();
    if (!ck) return { ok: false, notes: [], error: '未填写微信读书 Cookie' };
    if (!id) return { ok: false, notes: [], error: '缺少书籍 id' };
    const headers = {
        'User-Agent': WEREAD_UA,
        Referer: WEREAD_REFERER,
        Accept: WEREAD_ACCEPT,
        Cookie: ck,
    };

    const pull = async (url: string): Promise<{ raw?: unknown; error?: string }> => {
        let res: { status: number; text: string } | undefined;
        try {
            res = await t.get(url, headers);
        } catch {
            return { error: '网络请求失败' };
        }
        if (!res || res.status < 200 || res.status >= 300) {
            return { error: `微信读书返回 ${res?.status ?? '错误'}` };
        }
        try {
            return { raw: JSON.parse(res.text) };
        } catch {
            return { error: '返回内容无法解析（多半被风控或接口变更）' };
        }
    };

    // ① 先用 API Key 换 Gateway 通道（划线数据在那边；老 REST 对任何 bookId 恒回 `{}`）
    const hp = await pullBookmarksViaGateway(t, ck, id, pull);
    if (hp.error) return { ok: false, notes: [], error: hp.error };

    const rv = await pull(buildWereadReviewUrl(id));
    if (rv.error) {
        return { ok: true, notes: mergeWereadNotes(hp.notes, []), warning: `想法拉取失败：${rv.error}` };
    }
    const rp = parseWereadReviews(rv.raw);
    if (rp.error) {
        return { ok: true, notes: mergeWereadNotes(hp.notes, []), warning: `想法拉取失败：${rp.error}` };
    }
    return { ok: true, notes: mergeWereadNotes(hp.notes, rp.notes) };
}

/**
 * 走 Agent Gateway 拉划线（2026-11-21 新增，这是**唯一**能拿到划线的通道）。
 *
 * 流程：`apikeyGet`（带 Cookie）换 Key → `POST gateway` 带 `Authorization: Bearer`。
 * 失败时**逐层降级**，并且每层都留下可读原因（⛔ 不许把失败折成「这本书没划线」）：
 *   ⑴ 换不到 Key ⇒ 回 `error`（连带说明老接口已废弃，别让用户以为是自己没划线）；
 *   ⑵ Gateway 401 / `errcode: -2013` ⇒ 回 `error`（Key 失效，提示去重连）；
 *   ⑶ Gateway 通了但 `{}`/无 `updated` ⇒ 由 `parseWereadBookmarks` 报「接口变更」；
 *   ⑷ 全都没成时**再试一次老 REST**：万一是微信读书对少数账号回退了老接口，白捡。
 * 🔴 不抛：全部折进 `{ notes, error }`，与 `fetchWereadNotes` 其余分支同款。
 */
async function pullBookmarksViaGateway(
    t: DlTransport,
    cookie: string,
    bookId: string,
    pull: (url: string) => Promise<{ raw?: unknown; error?: string }>,
): Promise<WereadNotesParse> {
    const legacy = async (): Promise<WereadNotesParse> => {
        const hb = await pull(buildWereadBookmarkUrl(bookId));
        if (hb.error) return { notes: [], error: hb.error };
        return parseWereadBookmarks(hb.raw);
    };

    // ① 换 Key
    let keyRes: { raw?: unknown; error?: string };
    try {
        const r = await t.get(WEREAD_APIKEY_URL, {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
            Cookie: cookie,
        });
        if (!r || r.status < 200 || r.status >= 300) {
            keyRes = { error: `换取 API Key 失败（HTTP ${r?.status ?? '错误'}）` };
        } else {
            try {
                keyRes = { raw: JSON.parse(r.text) };
            } catch {
                keyRes = { error: 'API Key 响应无法解析' };
            }
        }
    } catch {
        keyRes = { error: '换取 API Key 时网络失败' };
    }
    const apiKey = keyRes.error ? '' : parseWereadApiKey(keyRes.raw);
    if (!apiKey) {
        // Key 拿不到还有一线希望：老接口也许对这台账号仍旧可用，先试它，再决定报什么
        const lg = await legacy();
        if (!lg.error) return lg;
        return {
            notes: [],
            error: `${keyRes.error || '未能取得微信读书 API Key'}（划线已迁到新版接口，老接口不再返回数据）`,
        };
    }

    // ② 打 Gateway
    let gw: { status: number; text: string } | undefined;
    try {
        gw = await t.post(WEREAD_GATEWAY_URL, buildWereadGatewayBody(WEREAD_GATEWAY_BOOKMARKS, { bookId }), {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        });
    } catch {
        const lg = await legacy();
        if (!lg.error) return lg;
        return { notes: [], error: '调用微信读书新版接口时网络失败' };
    }
    if (!gw || gw.status < 200 || gw.status >= 300) {
        const lg = await legacy();
        if (!lg.error) return lg;
        if (gw && gw.status === 401) {
            return { notes: [], error: '微信读书 API Key 鉴权失败（-2013），请到设置页重新「测试连接」' };
        }
        return { notes: [], error: `微信读书新版接口返回 ${gw?.status ?? '错误'}` };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(gw.text);
    } catch {
        return { notes: [], error: '新版接口返回内容无法解析' };
    }
    return parseWereadBookmarks(raw);
}

/**
 * #580 元数据检索：与书籍表单那枚「检索在线书籍阅读」**同一个搜索接口、同一份解析**
 * （`searchWeread` ⇒ 满足「同一概念只准一份实现」），只把候选**投影成书籍搜索结果**。
 *
 * 🔴 失败**抛**（不像 `searchWeread` 那样折进返回值）：这一路是源链里的 aux runner，
 *    宿主 `runAuxSource` 靠「抛 / 不抛」分辨 failed 与 empty（本仓既定编排口径）。
 * ⚠️ 只桌面端：底层走 Node 传输层（移动端没有），由宿主那侧的 runner 判平台。
 */
export async function searchWereadMeta(t: DlTransport, keyword: string): Promise<BookSearchResult[]> {
    const out = await searchWeread(t, keyword);
    if (out.error) throw new Error(out.error);
    return out.books.map(toWereadBookResult);
}
