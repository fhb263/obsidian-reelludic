/**
 * 书源的**编排层**（#419）—— 搜索 → 目录 → 抓章，只做「取数据 + 组装」，落盘交给调用方。
 *
 * ## 三条与音乐/书籍面一致的口径（⛔ 别在这里另立法则）
 *  ⑴ **各源独立成败**：单源请求 / 解析失败 ⇒ 只把那一源标 `error`，其余源照常（`error` 与「成功但 0 条」
 *     是两回事 ⇒ UI 文案不同）；
 *  ② **不静默**：选择器坏 / 规则是脚本 / 节点没命中，全部带**明确原因**回报，⛔ 绝不回一个空数组
 *     冒充「这个源没有内容」；
 *  ③ 单章失败**重试上限内**再试（上限取自书源 `crawl.maxAttempts`，见 `pure/sourceRule.sourcePacing`）；
 *     抓章走**并发池**（`NOVEL_CHAPTER_CONCURRENCY`）—— ⚠️ #428 推翻了 #419 的「串行 + 每章硬等 2~3 秒」，
 *     理由与完整口径见该常量。
 *
 * 🔴 网络与 DOM 都靠注入（`NovelFetch`）与 `services/htmlQuery`（运行时 `DOMParser`）——
 *    本模块本身**不 require** http / 不碰 vault，便于单测注入假数据。
 */
import { CancelledError, raceCancel, type CancelToken } from 'pure/cancel';
import { applyResume, type ResumeChapter } from 'pure/chapterPlan';
import type { ChapterTask } from 'pure/novelPack';
import { chapterHeading, cleanChapterText } from 'pure/novelText';
import { compileRule, fillSearchParams, fillSearchUrl, ruleUnsupportedText, type CompiledRule } from 'pure/ruleExpr';
import { bookIdFromUrl, pacingDelayMs, sourceKey, sourcePacing, type NovelSource } from 'pure/sourceRule';
import { BROWSER_UA } from 'services/douban';
import { applyRuleOne, extractChapterText, parseHtml, queryAll, resolveUrl } from 'services/htmlQuery';

// ────────────────────────── 注入点 ──────────────────────────

export interface NovelRequest {
    url: string;
    method: 'GET' | 'POST';
    /** POST 时的表单体（`application/x-www-form-urlencoded`） */
    body?: string;
    /** 额外请求头（当前只用于书源声明的 Cookie；真源由调用方与基础 UA 头合并） */
    headers?: Record<string, string>;
}

export interface NovelResponse {
    status: number;
    text: string;
    /**
     * **跟随重定向之后**的最终地址（#420 追加，可选）。
     * 🔴 只为一件事：有些站点在搜索命中唯一结果时**直接跳到书籍页**（`result` 选择器 0 命中），
     *    真正的书籍地址是**跳转后**那一页 ⇒ 拿不到最终 URL 就只能报「源失效」。见 `searchNovelSource` 的 G1 分支。
     * ⚠️ 真源（`nodeHttpGet` / `nodeHttpPost`）**已带上**；注入的假实现可以不给，此时退回请求 URL。
     */
    finalUrl?: string;
}

/**
 * 把书源声明的 `search.cookies` 叠到**该源的所有请求**上。
 * 🔴 那是**用户自己填在书源文件里的凭据**（与音乐面「用户自备 Cookie」同一口径），
 *    ⛔ 不是我们去绕谁的登录 —— 本插件不破解、不代登录、不绕付费。
 * ⚠️ 站点通常整站都要过同一道反爬，故不只加在搜索那一个请求上。
 */
function withSourceHeaders(fetch: NovelFetch, src: NovelSource): NovelFetch {
    const cookie = String(src?.search?.cookies ?? '').trim();
    if (!cookie) return fetch;
    return (req) => fetch({ ...req, headers: { ...(req.headers ?? {}), Cookie: cookie } });
}

/** 注入式取网页（真源 = `main` 的 `nodeHttpGet` / `nodeHttpPost`；与其它下载面同一形状） */
export type NovelFetch = (req: NovelRequest) => Promise<NovelResponse>;

/** 单次请求的超时上限：源站被墙 / 抽风时不能让整次搜索挂在那里 */
export const NOVEL_TIMEOUT_MS = 15_000;

/** 取源站页面的请求头。
 *  🔴 用**浏览器 UA**（源站常按 UA 拦掉非浏览器请求）—— 复用 `services/douban` 那份，⛔ 别写第二份字面量。
 *  ⛔ **不带 `Referer` / `Cookie`**：那属于「绕访问控制」，红线 D-24(a) 不做。
 *  ⚠️ 书源自己声明了 `search.cookies` 时，由调用方**按书源**带上 —— 那是用户自己填的凭据，不是我们绕出来的。 */
export const NOVEL_SOURCE_HEADERS: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
/** 一次搜索里**同时**发起的源数（每个源只发 1 个请求 ⇒ 对单个站而言仍是串行） */
export const NOVEL_SEARCH_CONCURRENCY = 3;
/**
 * 抓章**同时**在飞的请求数（#428）。
 *
 * 🔴 用户 2026-09-29 的裁定：「优化下载速度 50 并发」。**它推翻了 #419 的 D-20(a) 口径**
 *    （当年：串行 + 每章之间等 `crawl.minInterval/maxInterval`）—— 那两个值在书源模板里
 *    实测被归一成 **2~3 秒**，2277 章要跑一个半小时，用户实机卡在「2 / 5 章」不动。
 *    ⇒ 现在速率只由**并发度**这一个旋钮决定，章间不再等待。
 * ⚠️ 书源自己 `crawl.concurrency` **依旧不采信**（那是各家模板里的脏值；并发度只认这里 / `opts.concurrency`）。
 * ⚠️ 这不是「越打越凶就越好」的默认值 —— 单个站被限流时应当**调小这个数**（它是唯一的总闸）。
 */
export const NOVEL_CHAPTER_CONCURRENCY = 50;
/** 搜索最多翻多少页（#420 G4，与参考实现一致的 3 页；按 URL 去重防死循环） */
export const SEARCH_MAX_PAGES = 3;
/** 目录页最多翻多少页（防「下一页」规则把链接指回自己时死循环） */
export const TOC_MAX_PAGES = 60;
/** 单章最多翻多少页（正文被拆成多页的源） */
export const CHAPTER_MAX_PAGES = 20;

/** 带超时的 Promise（⚠️ 超时**不会真的掐断**底层请求，只是不再等它 —— nodeHttp 不支持 abort） */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what}超时（${Math.round(ms / 1000)} 秒）`)), ms);
    });
    // 落败的那一边可能随后才 reject ⇒ 先吞掉，免得变成 unhandled rejection
    void p.catch(() => {});
    return Promise.race([p, guard]).finally(() => {
        if (timer) clearTimeout(timer);
    }) as Promise<T>;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/** 取一个页面（非 2xx 一律当失败 —— 正文多半是错误页，交给解析只会静默得到 0 条） */
async function fetchPage(
    fetch: NovelFetch,
    req: NovelRequest,
    timeoutMs: number,
    /**
     * 🔴 #428 取消令牌。**只有抓章那一路传**（搜索 / 目录是有界的几步，取消没有意义，也不该改变它们的时序）。
     * ⚠️ 给了令牌 ⇒ 取消的瞬间这次等待**立刻**抛出去（`raceCancel`）—— Node 那层没有 abort，
     *    我们做不到掐断 socket，但能做到**不再等它**。这正是「点了取消没反应」的解法。
     */
    cancel?: CancelToken,
): Promise<{ text: string; finalUrl: string }> {
    const res = await raceCancel(withTimeout(fetch(req), timeoutMs, '请求'), cancel);
    if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
    return { text: String(res.text ?? ''), finalUrl: String(res.finalUrl ?? req.url) };
}

/** 编译一条规则，不支持就抛（带用途名 ⇒ 用户知道是哪一项坏） */
function needRule(raw: string | undefined, what: string): CompiledRule {
    const c = compileRule(String(raw ?? ''));
    if (!c.selector) throw new Error(`${what}的规则是空的`);
    if (c.unsupported) throw new Error(ruleUnsupportedText(c, what));
    return c;
}

/**
 * 编译一条**链接规则**（`toc.url` / `toc.nextPage` / `chapter.nextPage`）。
 *
 * 🔴 书源里这些规则写的是**锚点的选择器**（真实写法：`#pagelink > a:not(.pgroup):not(.ngroup)`），
 *    要的是它的 **`href`**，⛔ 不是它的文字 —— 按「取文本」解会解析出「下一页」三个字当 URL，
 *    然后请求一个根本不存在的地址（实测踩过：#419 单测里 404 就是这么来的）。
 * ⚠️ 若书源自己写了 `@href` 之类后缀，以它为准（别覆盖用户的写法）。
 */
function linkRuleOf(raw: string | undefined, what: string): CompiledRule | undefined {
    const s = String(raw ?? '').trim();
    if (!s) return undefined;
    const c = compileRule(s);
    if (c.unsupported) throw new Error(ruleUnsupportedText(c, what));
    if (!c.selector) return undefined;
    return c.take === 'text' ? { ...c, take: 'attr', attr: 'href' } : c;
}

function isPost(method: string | undefined): boolean {
    return String(method ?? '').trim().toLowerCase() === 'post';
}

// ────────────────────────── 搜索 ──────────────────────────

export interface NovelSearchHit {
    sourceName: string;
    /** 该源的**站点键**（= `pure/sourceRule.sourceKey`）—— UI 回传时靠它精确定位到哪一条源，
     *  ⛔ 别用 `sourceName` 匹配（两个源同名时就会下错源的书）。 */
    sourceUrl: string;
    title: string;
    author: string;
    category: string;
    latestChapter: string;
    /** 书籍详情页（= 目录页）的绝对地址；**空串 ⇒ 这条结果用不了**（已在组装时丢掉） */
    bookUrl: string;
}

export interface NovelSourceSearchResult {
    sourceName: string;
    hits: NovelSearchHit[];
    /** 请求 / 解析失败的原因（成功但 0 条时为空） */
    error?: string;
    /** 该源没参与搜索的原因（搜索被禁用等）—— 与 `error` 分开，UI 文案不同 */
    note?: string;
}

/**
 * 从一行搜索结果里取「书籍页地址」。
 *
 * 🔴 SoNovel 书源**没有**独立的 `bookUrl` 字段 ⇒ 本插件按两条口径取（先严后宽）：
 *  ⑴ `bookName` 选择器命中的元素上的 `href`（真实书源里这一项几乎都是 `… > a`，锚点自带链接）；
 *  ② 取不到时退回**该行第一个 `<a href>`**（有些源把书名写成 `span.name`，链接在旁边的 `<a>` 上）。
 * ⚠️ 两条都取不到 ⇒ 这条结果丢弃（`title` 与 `bookUrl` 都没有的行对用户没有意义）。
 */
function rowBookUrl(row: Element, nameRule: CompiledRule, pageUrl: string): string {
    const q = queryAll(row, nameRule.selector);
    if (q.invalid) return '';
    for (const el of q.els) {
        const href = el.getAttribute('href');
        if (href && href.trim() && !href.trim().startsWith('#')) return resolveUrl(pageUrl, href);
    }
    const first = queryAll(row, 'a[href]').els[0];
    const href = first?.getAttribute('href');
    return href && href.trim() ? resolveUrl(pageUrl, href) : '';
}

/** 一行搜索结果 → 一条命中（`bookName` 元素上的 `href` 即书籍页地址；取不到则丢弃该行） */
function rowHit(row: Element, nameRule: CompiledRule, pageUrl: string, src: NovelSource, rules: {
    author: CompiledRule;
    category: CompiledRule;
    latest: CompiledRule;
}): NovelSearchHit | null {
    const title = applyRuleOne(row, nameRule, pageUrl);
    const bookUrl = rowBookUrl(row, nameRule, pageUrl);
    if (!title || !bookUrl) return null;
    return {
        sourceName: String(src?.name ?? '').trim() || '未命名书源',
        sourceUrl: sourceKey(src),
        title,
        author: rules.author.selector ? applyRuleOne(row, rules.author, pageUrl) : '',
        category: rules.category.selector ? applyRuleOne(row, rules.category, pageUrl) : '',
        latestChapter: rules.latest.selector ? applyRuleOne(row, rules.latest, pageUrl) : '',
        bookUrl,
    };
}

/**
 * 🔴 **G1（#420 按参考实现 `go-novel/internal/core/search.go` 补）**：
 * 不少站点在**搜索命中唯一结果时直接跳转到书籍页**（于是 `search.result` 选择器 0 命中，
 * 页面其实是详情页）。参考实现的做法：此时改用**请求的最终 URL** 当书籍地址，书名/作者/最新章节
 * 从**详情页规则**（`book.*`）取。
 *
 * ⚠️ 没有这一条，这类源会被我们误判成「**没匹配到任何结果（该源可能已改版或失效）**」——
 *    把「能用」说成「源失效」，是比缺失更糟的一类错误（用户会去换源）。
 * ⚠️ 判据与参考实现一致：**必须先能取出书名**（`book.bookName` 有效且命中），否则不认。
 */
function detailJumpHit(
    src: NovelSource,
    html: string,
    finalUrl: string,
): NovelSearchHit | null {
    const b = src?.book;
    const nameRule = compileRule(String(b?.bookName ?? ''));
    if (!nameRule.selector || nameRule.unsupported) return null;
    const doc = parseHtml(html);
    const title = applyRuleOne(doc, nameRule, finalUrl);
    if (!title) return null;
    const pick = (raw: string | undefined): string => {
        const r = compileRule(String(raw ?? ''));
        return r.selector && !r.unsupported ? applyRuleOne(doc, r, finalUrl) : '';
    };
    return {
        sourceName: String(src?.name ?? '').trim() || '未命名书源',
        sourceUrl: sourceKey(src),
        title,
        author: pick(b?.author),
        category: pick(b?.category),
        latestChapter: pick(b?.latestChapter),
        bookUrl: finalUrl,
    };
}

/** 搜一个源。**只翻第一页**（网上书源第一页通常就有目标书名）；分页见 `searchNovelSources` 的多源聚合 */
export async function searchNovelSource(
    fetch: NovelFetch,
    src: NovelSource,
    keyword: string,
    opts: { timeoutMs?: number } = {},
): Promise<NovelSourceSearchResult> {
    const name = String(src?.name ?? '').trim() || '未命名书源';
    const s = src?.search;
    if (!s || s.disabled) return { sourceName: name, hits: [], note: '该源没提供搜索（或已停用）' };
    const f = withSourceHeaders(fetch, src);
    const timeoutMs = opts.timeoutMs ?? NOVEL_TIMEOUT_MS;
    try {
        const resultRule = needRule(s.result, '搜索结果列表');
        const nameRule = needRule(s.bookName, '书名');
        const rules = {
            author: compileRule(String(s.author ?? '')),
            category: compileRule(String(s.category ?? '')),
            latest: compileRule(String(s.latestChapter ?? '')),
        };
        // 🔴 **G4**：`search.nextPage` 也是**链接规则**（要 `href`，见 `linkRuleOf`）
        const nextRule = linkRuleOf(s.nextPage, '搜索下一页');

        const url = fillSearchUrl(s.url, keyword);
        const req: NovelRequest = isPost(s.method)
            ? { url, method: 'POST', body: new URLSearchParams(fillSearchParams(String(s.data ?? ''), keyword)).toString() }
            : { url, method: 'GET' };
        const page = await fetchPage(f, req, timeoutMs);

        const first = parseHtml(page.text);
        const rows = queryAll(first, resultRule.selector);
        if (rows.invalid) return { sourceName: name, hits: [], error: rows.invalid };

        const hits: NovelSearchHit[] = [];
        const seen = new Set<string>();
        const push = (h: NovelSearchHit | null) => {
            if (!h || seen.has(h.bookUrl)) return;
            seen.add(h.bookUrl);
            hits.push(h);
        };
        for (const row of rows.els) push(rowHit(row, nameRule, page.finalUrl, src, rules));

        // 🔴 G1：一行都没解析出来 ⇒ 也许是「站点直接跳到了详情页」
        if (!hits.length) {
            const jumped = detailJumpHit(src, page.text, page.finalUrl);
            if (jumped) return { sourceName: name, hits: [jumped] };
        }

        // 🔴 G4：翻页（上限 `SEARCH_MAX_PAGES` 页；按 URL 去重，防「下一页」指回自己）
        if (nextRule && nextRule.selector) {
            const visited = new Set<string>([page.finalUrl]);
            let curHtml = page.text;
            let curUrl = page.finalUrl;
            for (let i = 1; i < SEARCH_MAX_PAGES; i++) {
                const nextHref = applyRuleOne(parseHtml(curHtml), nextRule, curUrl);
                const nextUrl = nextHref ? resolveUrl(curUrl, nextHref) : '';
                if (!nextUrl || visited.has(nextUrl)) break;
                visited.add(nextUrl);
                const np = await fetchPage(f, { url: nextUrl, method: 'GET' }, timeoutMs);
                for (const row of queryAll(parseHtml(np.text), resultRule.selector).els) {
                    push(rowHit(row, nameRule, np.finalUrl, src, rules));
                }
                curHtml = np.text;
                curUrl = np.finalUrl;
            }
        }

        if (!hits.length) {
            return { sourceName: name, hits: [], error: `「${resultRule.raw}」没匹配到任何结果（该源可能已改版或失效）` };
        }
        return { sourceName: name, hits };
    } catch (e) {
        return { sourceName: name, hits: [], error: errText(e) };
    }
}

/**
 * 多源并行搜索（并发 `NOVEL_SEARCH_CONCURRENCY`），**渐进上报**：任一源先回来就先给 UI。
 * 🔴 只搜 `src.disabled !== true` 的源。返回顺序与 `sources` 一致（UI 不想跳行）。
 */
export async function searchNovelSources(
    fetch: NovelFetch,
    sources: readonly NovelSource[],
    keyword: string,
    opts: { timeoutMs?: number; onPartial?: (results: NovelSourceSearchResult[]) => void } = {},
): Promise<NovelSourceSearchResult[]> {
    const active = sources.filter((s) => s && s.disabled !== true);
    const out: NovelSourceSearchResult[] = new Array(active.length);
    let next = 0;
    const worker = async () => {
        for (;;) {
            const i = next++;
            if (i >= active.length) return;
            out[i] = await searchNovelSource(fetch, active[i], keyword, opts);
            if (opts.onPartial) opts.onPartial(out.filter((r) => r));
        }
    };
    await Promise.all(Array.from({ length: Math.min(NOVEL_SEARCH_CONCURRENCY, active.length) }, worker));
    return out;
}

// ────────────────────────── 目录 ──────────────────────────

export interface NovelTocItem {
    no: number;
    title: string;
    url: string;
}

export interface NovelTocResult {
    items: NovelTocItem[];
    error?: string;
    /**
     * 🔴 #457：目录**没解析出来** ⇒ 已回退成「**整页一章**」（文学/公版源常是「整本书一个页面」）。
     * ⚠️ 回退**不静默** —— `note` = 原来的失败原因，UI 必须原样说给用户听
     *    （「这本书没解析出目录（原因：…），将按整页下载成一章」）。⛔ 别悄悄回退。
     */
    wholePage?: boolean;
    note?: string;
}

/** 沿 `nextPage` 规则一路翻页取节点（**按 URL 去重 + 页数上限**，防「下一页」指回自己时死循环） */
async function collectPaged(
    fetch: NovelFetch,
    firstUrl: string,
    pageHtml: string,
    itemRule: CompiledRule,
    nextRule: CompiledRule | undefined,
    timeoutMs: number,
    maxPages: number,
): Promise<{ values: { el: Element; pageUrl: string }[]; invalid?: string; pages: number }> {
    const values: { el: Element; pageUrl: string }[] = [];
    const seen = new Set<string>();
    let url = firstUrl;
    let html = pageHtml;
    let pages = 0;
    while (url && !seen.has(url) && pages < maxPages) {
        seen.add(url);
        pages++;
        const doc = parseHtml(html);
        const q = queryAll(doc, itemRule.selector);
        if (q.invalid) return { values, invalid: q.invalid, pages };
        for (const el of q.els) values.push({ el, pageUrl: url });
        if (!nextRule || !nextRule.selector) break;
        const nextHref = applyRuleOne(doc, nextRule, url);
        url = nextHref ? resolveUrl(url, nextHref) : '';
        if (!url) break;
        html = (await fetchPage(fetch, { url, method: 'GET' }, timeoutMs)).text;
    }
    return { values, pages };
}

/**
 * 取目录。
 * 🔴 目录页地址的算法（#424 按参考实现 so-novel 的 `TocParser` 修正）：
 *    · **缺省 = 书籍页**（真实书源里多数如此）；
 *    · 书源写了 `toc.url` 时 —— 那是 **URL 模板**（`%s` ← 书籍 ID，ID 由 `book.url` 正则从书籍页地址取），
 *      ⛔ **不是**「详情页上的目录链接选择器」（本仓 #424 之前的错误口径，害 6 条源全废）。
 *    拿不到 ID ⇒ **报明确原因**（连 `book.url` 规则原文一起给出来，用户好对照改源）。
 */
export async function fetchNovelToc(
    fetch: NovelFetch,
    src: NovelSource,
    bookUrl: string,
    opts: { timeoutMs?: number } = {},
): Promise<NovelTocResult> {
    const timeoutMs = opts.timeoutMs ?? NOVEL_TIMEOUT_MS;
    const f = withSourceHeaders(fetch, src);
    try {
        const itemRule = needRule(src?.toc?.item, '目录条目');
        const nextRule = linkRuleOf(src?.toc?.nextPage, '目录下一页');
        const bookHtml = (await fetchPage(f, { url: bookUrl, method: 'GET' }, timeoutMs)).text;

        let tocUrl = bookUrl;
        let tocHtml = bookHtml;
        /**
         * 🔴 #424：`toc.url` 是 **URL 模板**，⛔ **不是**「详情页上的目录链接选择器」——
         *    对齐参考实现 so-novel 的 `TocParser`：`toc.url` 里的 `%s` ← **书籍 ID**，
         *    而 ID 由 `book.url`（**带捕获组的正则**）从**书籍页地址**里取（`bookIdFromUrl`）。
         *    ⛔ 以前按选择器解 ⇒ 真实书源里 6 条带 `toc.url` 的**全废**：用户上手实测「唯一能连上的
         *    那个源，点开书就报『没找到链接（本插件暂不支持那种写法）』」，正是这里。
         */
        const tocTpl = String(src?.toc?.url ?? '').trim();
        if (tocTpl) {
            if (tocTpl.includes('%s')) {
                const id = bookIdFromUrl(src, bookUrl);
                if (!id) {
                    const rule = String(src?.book?.url ?? '').trim();
                    return {
                        items: [],
                        error: `该源的目录页地址是个模板（${tocTpl}），但没能从书籍页地址里取出书籍 ID —— 它的 book.url 规则是「${rule || '（没写）'}」`,
                    };
                }
                tocUrl = resolveUrl(bookUrl, tocTpl.replace(/%s/g, id));
            } else {
                // 没有占位符 ⇒ 它本身就是目录页地址（so-novel 的 `String.format` 对无占位符的串原样返回）
                tocUrl = resolveUrl(bookUrl, tocTpl);
            }
            tocHtml = tocUrl === bookUrl ? bookHtml : (await fetchPage(f, { url: tocUrl, method: 'GET' }, timeoutMs)).text;
        }

        const got = await collectPaged(f, tocUrl, tocHtml, itemRule, nextRule, timeoutMs, TOC_MAX_PAGES);
        if (got.invalid) return { items: [], error: got.invalid };

        const seen = new Set<string>();
        const items: NovelTocItem[] = [];
        for (const { el, pageUrl } of got.values) {
            const href = el.getAttribute('href') ?? '';
            const url = resolveUrl(pageUrl, href);
            const title = String(el.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!url || !title || seen.has(url)) continue;
            seen.add(url);
            items.push({ no: 0, title, url });
        }
        if (!items.length) return { items: [], error: `「${itemRule.raw}」没匹配到任何章节（该源可能已改版或失效）` };
        // 书源注明目录是倒序（新章在前）⇒ 翻回阅读顺序再编号
        if (src?.toc?.isDesc) items.reverse();
        items.forEach((it, i) => (it.no = i + 1));
        return { items };
    } catch (e) {
        return { items: [], error: errText(e) };
    }
}

/**
 * 🔴 #457 **文学源适配**：目录拿不到时的**回退目录项** —— 整本书当作**一章**
 * （标题 = 书名、地址 = 书籍页）。
 *
 * 由来：网文源一定有目录（一章一页），而**文学 / 公版源常见的形态是「整本书一个页面」**
 * —— 既没有目录也没有章节，于是 `fetchNovelToc` 一律报「没匹配到任何章节」，这一类源根本没法用。
 * 按一章抓 = 把书页正文**整页**落盘，正好对上那种形态。
 *
 * ⛔ 别在调用方再拼一份这个结构（两份必然漂）。
 */
export function wholeBookTocItems(hit: NovelSearchHit): NovelTocItem[] {
    return [{ no: 1, title: String(hit?.title ?? '').trim() || '（整本）', url: String(hit?.bookUrl ?? '') }];
}

/**
 * 取目录；**目录拿不到 ⇒ 回退成「整页一章」**（#457）。
 *
 * ⚠️ 回退时把原来的失败原因装进 `note` ⇒ 调用方要说清「没解析出目录、按整页下」，⛔ **不静默**。
 * ⚠️ 连书籍页都没有 ⇒ 无从回退，如实把错误抛回去。
 * 🔴 **只在这一个地方回退**（取目录与下载两侧都走它），⛔ 别在两处各写一遍判断。
 */
export async function fetchNovelTocOrWhole(
    fetch: NovelFetch,
    src: NovelSource,
    hit: NovelSearchHit,
    opts: { timeoutMs?: number } = {},
): Promise<NovelTocResult> {
    const r = await fetchNovelToc(fetch, src, hit.bookUrl, opts);
    if (r.items.length || !r.error) return r;
    if (!String(hit?.bookUrl ?? '').trim()) return r;
    return { items: wholeBookTocItems(hit), wholePage: true, note: r.error };
}

// ────────────────────────── 抓章 ──────────────────────────

export interface FetchChaptersOpts {
    timeoutMs?: number;
    /** 注入式等待（单测传 `async () => {}` ⇒ 不真等）—— ⚠️ 现在只剩「重试退避」在用 */
    sleep?: (ms: number) => Promise<void>;
    /** 注入式随机数（`pacingDelayMs` 的 pick ∈ [0,1)） */
    random?: () => number;
    /** 抓完一章就报一次（UI 画进度） */
    onProgress?: (done: number, total: number, failed: number) => void;
    /** 并发度（默认 `NOVEL_CHAPTER_CONCURRENCY`；单测注入小值来验「同时最多几个在飞」） */
    concurrency?: number;
    /**
     * 🔴 **#428 取消令牌** —— 取代旧的 `shouldStop?: () => boolean`。
     *    旧形态只能「在下一章开头问一句」⇒ 用户在飞的请求上点取消**几十秒没反应**（实测就是这条）。
     *    令牌多了 `wait()`：在飞的等待由 `raceCancel` 立刻唤醒，取消**当帧**就能收尾。
     * ⚠️ 取消 ⇒ 本函数**抛 `CancelledError`**（⛔ 不是「把剩下的章标 `failed: 已取消` 然后照常返回」，
     *    那正是用户实测的「点了取消却还能保存」）。剩余章一律**留在 `pending`**。
     */
    cancel?: CancelToken;
    /**
     * **断点续传**（P1-C）：上一次没抓完的存档章（`pure/chapterPlan.parseResume` 的产物）。
     * 🔴 命中的章**不再发请求、也不占并发位**（那才是续传的意义）；未命中的照常抓。
     * ⚠️ 传 `undefined` / 空数组 = 从头抓（旧行为，一字不动）。
     */
    resume?: readonly ResumeChapter[];
    /** 续传生效时先报一次「复用了几章」——宿主拿它写回执，⛔ 别让用户以为又从第 1 章开始抓了 */
    onResume?: (reused: number) => void;
    /**
     * 每**新抓到**一章回调一次（宿主据此往存档 append 一行）。
     * ⚠️ 只在成功时调 —— 失败的章要留着下次续传重试，落进存档反而会被当成「已完成」。
     */
    onCheckpoint?: (tasks: readonly ChapterTask[]) => void;
}

/**
 * **并发池**抓章（#428 起；在此之前是「串行 + 间隔」）。
 *
 * 🔴 并发度 = `NOVEL_CHAPTER_CONCURRENCY`（50，用户 2026-09-29 裁定）。与旧口径的两处差别：
 *  ⑴ **章间不再等待**：那个 sleep 在串行时代是唯一的节流阀，进了并发池**节不住任何东西**
 *     （50 个 worker 各自睡觉只让每个 worker 变慢，整体速率由并发度决定）⇒ 直接去掉。
 *     ⚠️ 但**重试之后的退避仍然保留** —— 那是对「刚失败的请求」的礼貌，不是节流。
 *  ② **取消变成真取消**：见 `opts.cancel`（抛 `CancelledError`，剩余章留在 `pending`）。
 * ⚠️ 顺带保住两条旧口径：**章序** = `tasks` 的位序（worker 抢的是下标，谁先回来都不影响顺序）；
 *    单章失败**不中断整本**（标 `failed` + 原因继续）。
 * ⚠️ 正文被拆成多页的源（`chapter.nextPage`）会一路拼到没有下一页为止（上限 `CHAPTER_MAX_PAGES`）。
 * 🔴 **源级**规则不可用（`chapter.title` / `chapter.content` 是空的或是 `@js:`）时**直接抛** ——
 *    那是「这个源整体用不了」，让调用方报一次就够，⛔ 别给 1500 章各报一遍同样的话。
 * 🔴 **P1-C 断点续传**（`opts.resume` / `opts.onCheckpoint`）：上次抓到的章直接复用、不重发请求；
 *    每新抓到一章回调一次，宿主据此往存档 append —— 长书（1600 章）中断后可接着下，⛔ 不必从头再来。
 */
export async function fetchNovelChapters(
    fetch: NovelFetch,
    src: NovelSource,
    items: readonly NovelTocItem[],
    opts: FetchChaptersOpts = {},
): Promise<ChapterTask[]> {
    const timeoutMs = opts.timeoutMs ?? NOVEL_TIMEOUT_MS;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = opts.random ?? Math.random;
    const cancel = opts.cancel;
    const pacing = sourcePacing(src);
    const titleRule = needRule(src?.chapter?.title, '章节标题');
    const contentRule = needRule(src?.chapter?.content, '章节正文');
    const nextRule = linkRuleOf(src?.chapter?.nextPage, '章节下一页');
    const f = withSourceHeaders(fetch, src);

    const built: ChapterTask[] = items.map((it) => ({ no: it.no, title: chapterHeading(it.no, it.title), url: it.url, state: 'pending' }));
    // 🔴 断点续传：已抓到的章直接标 `done`（正文一并带回）—— 它们**既不发请求、也不占并发位**
    const merged = applyResume(built, opts.resume ?? []);
    const tasks = merged.tasks;
    let done = tasks.filter((t) => t.state === 'done').length;
    let failed = 0;
    if (merged.reused > 0) {
        opts.onResume?.(merged.reused);
        // 一进来就把「已续传 N 章」推给 UI —— 否则进度停在 0/total，用户会以为白续了
        opts.onProgress?.(done, tasks.length, failed);
    }

    // 待抓队列 = 还没 done 的下标（复用命中的章不进队）。worker 抢的是**下标** ⇒ 章序与 `tasks` 位序一致，
    // 谁先回来都不影响成品的章序（⛔ 别改成「push 完成结果」，那会让 50 并发把章节顺序打乱）。
    const queue: number[] = [];
    for (let i = 0; i < tasks.length; i++) if (tasks[i].state !== 'done') queue.push(i);
    let cursor = 0;
    const workers = Math.max(1, Math.min(Math.floor(opts.concurrency ?? NOVEL_CHAPTER_CONCURRENCY) || 1, queue.length || 1));

    /** 一个 worker 的一生：抢一章 → 抓（含重试）→ 记账 → 再抢。取消 ⇒ 立刻收工（不再抢新的） */
    const worker = async (): Promise<void> => {
        for (;;) {
            if (cancel?.stopped) return;
            const i = cursor < queue.length ? queue[cursor++] : -1;
            if (i < 0) return;
            const t = tasks[i];
            let lastErr = '';
            try {
                for (let attempt = 1; attempt <= pacing.maxAttempts; attempt++) {
                    try {
                        const got = await fetchOneChapter(f, t.url, titleRule, contentRule, nextRule, src, timeoutMs, cancel);
                        t.text = got.text;
                        // 章节页上的标题比目录里那份更权威（目录常只写「第十二章」，页面才有章节名）
                        if (got.pageTitle) t.title = chapterHeading(t.no, got.pageTitle);
                        t.state = 'done';
                        lastErr = '';
                        break;
                    } catch (e) {
                        // 🔴 取消**不是**「这一章失败」⇒ ⛔ 别标 failed、⛔ 更别拿它当重试的理由
                        if (e instanceof CancelledError) throw e;
                        lastErr = errText(e);
                        t.state = 'failed';
                        t.error = lastErr;
                        if (attempt < pacing.maxAttempts) await raceCancel(sleep(pacingDelayMs(pacing, random())), cancel);
                    }
                }
            } catch (e) {
                if (!(e instanceof CancelledError)) throw e;
                // 退回 `pending`：它没失败，只是这一轮没抓到 ⇒ 下次续传接着抓（⛔ 别留个 `failed: 已取消` 的假账）
                t.state = 'pending';
                t.error = undefined;
                return;
            }
            if (t.state === 'done') {
                done++;
                // 抓到一章就落一次档（宿主往续传存档 append 一行）—— 崩在这一刻最多丢这一章
                opts.onCheckpoint?.(tasks);
            } else {
                failed++;
                // 重试过的章把「试了几次」也交代掉，免得用户以为只试了一次
                if (pacing.maxAttempts > 1) t.error = `${lastErr}（已试 ${pacing.maxAttempts} 次）`;
            }
            opts.onProgress?.(done, tasks.length, failed);
        }
    };
    // ⚠️ 每个 worker 把取消**吞在自己这一层**（return 而不是抛）——否则 `Promise.all` 会在第一个 worker
    //    抛出时就返回，剩下几十个还在飞的请求仍在写 `tasks` / 落存档，收尾时序与存档内容都会乱。
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (cancel?.stopped) throw new CancelledError();
    return tasks;
}

/** 抓一章（含 `nextPage` 拼接 + 净化）；返回正文与该页上的章节标题 */
async function fetchOneChapter(
    fetch: NovelFetch,
    firstUrl: string,
    titleRule: CompiledRule,
    contentRule: CompiledRule,
    nextRule: CompiledRule | undefined,
    src: NovelSource,
    timeoutMs: number,
    /** 🔴 #428：取消令牌（每一页的等待都可中断 —— 多页源的拼接循环里也能当帧收工） */
    cancel?: CancelToken,
): Promise<{ text: string; pageTitle: string }> {
    const chunks: string[] = [];
    const seen = new Set<string>();
    let url = firstUrl;
    let pageTitle = '';
    let pages = 0;
    while (url && !seen.has(url) && pages < CHAPTER_MAX_PAGES) {
        seen.add(url);
        pages++;
        const html = (await fetchPage(fetch, { url, method: 'GET' }, timeoutMs, cancel)).text;
        const doc = parseHtml(html);
        if (!pageTitle) pageTitle = applyRuleOne(doc, titleRule, url);
        const q = queryAll(doc, contentRule.selector);
        if (q.invalid) throw new Error(q.invalid);
        if (!q.els.length) throw new Error(`「${contentRule.raw}」在章节页上没命中`);
        chunks.push(
            extractChapterText(q.els[0], {
                paragraphTagClosed: src?.chapter?.paragraphTagClosed,
                paragraphTag: src?.chapter?.paragraphTag,
                filterTag: src?.chapter?.filterTag,
                baseUrl: url,
            }),
        );
        if (!nextRule || !nextRule.selector) break;
        const nextHref = applyRuleOne(doc, nextRule, url);
        url = nextHref ? resolveUrl(url, nextHref) : '';
    }
    const text = cleanChapterText(chunks.join('\n'), { filterTxt: src?.chapter?.filterTxt }).text;
    if (!text.trim()) throw new Error('取到的正文是空的（该源可能已失效或正文被脚本规则挡住）');
    return { text, pageTitle };
}
