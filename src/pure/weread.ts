/**
 * 微信读书「在线阅读」检索（纯逻辑，无 obsidian 依赖，可单测）。
 *
 * 🔴 2026-10-05 实测（探针 `_probe_weread*.cjs`，本机两轮）：
 *   ⑴ 搜索接口 `GET https://weread.qq.com/web/search/global?keyword=…` **免登录 200**，
 *      返回 JSON `{ books: [{ bookInfo: {…}, … }], totalCount, hasMore }`；
 *   ⑵ 每条的 `bookInfo.deepLink` 形如 `https://weread.qq.com/book-detail?type=1&v=<hash>`，
 *      其中的 `<hash>` 拼成 `https://weread.qq.com/web/reader/<hash>` = **网页版在线阅读页**
 *      （实测 200，页面标题就是「书名 - 作者 - 微信读书」）。
 *   ⛔ **不能用 `bookId` 直拼阅读链接** —— `web/reader/<bookId>` 实测 404（bookId ≠ hash）。
 *
 * 🔴 能力边界（如实告知，别在 UI 里吹成「都能看」）：微信读书**多数书的全文要登录 / 会员**，
 *    我们拿到并回填的是**这本书在微信读书的阅读入口**（链接有效、可分享），能否读全文取决于该书。
 * ⛔ 本模块只做「检索 + 拼链接」，**不下载、不解析正文**（红线上不碰内容源）。
 */
import type { BookSearchResult } from 'services/resultTypes';

/** 搜索接口（免登录） */
export const WEREAD_SEARCH_URL = 'https://weread.qq.com/web/search/global';
/**
 * 书架 / 鉴权接口（**要登录**）。
 *
 * 🔴 #580 本机实测（探针 `_probe_weread580.cjs`）：**不带 Cookie** 时它回 **HTTP 200** +
 *    `{"errCode":-2010,"errMsg":"用户不存在","errLog":"…","info":""}` —— 也就是「未登录」在
 *    HTTP 层是**成功**的，只有 body 里的 `errCode` 说真话。
 *    ⛔ 所以「测试连接」**绝不能只看状态码**（那是本仓 403/超时「不标红」那条纪律的镜像场景：
 *       这里恰好相反 —— 200 也可能是失败）。
 * ⚠️ `errCode === 0` 时同一份响应里带 `books`（书架）/ `bookProgress` / `archive`（分组）等 ——
 *    「测试连接」与「书架同步」**共用这一个端点**，⛔ 别为书架另找一个接口。
 */
export const WEREAD_SHELF_URL = 'https://weread.qq.com/web/shelf/sync';
/** 首页 / 请求 Referer（站点要求同源 Referer，缺失时可能被拒） */
export const WEREAD_REFERER = 'https://weread.qq.com/';
/** 网页版阅读器前缀（后面接 hash） */
export const WEREAD_READER_PREFIX = 'https://weread.qq.com/web/reader/';
/** 书籍详情端点（#582：逐本补评分 / 简介 / 出版社 / ISBN / 分类；**要登录**） */
export const WEREAD_BOOK_INFO_URL = 'https://weread.qq.com/web/book/info';
/** 桌面浏览器 UA（探针实测用这条就通） */
export const WEREAD_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** 搜索响应是 JSON */
export const WEREAD_ACCEPT = 'application/json, text/plain, */*';

/** 一条微信读书候选（只保留拼得出阅读链接的条目） */
export interface WereadCandidate {
    /** 书名 */
    title: string;
    /** 作者（缺 → 空串） */
    author: string;
    /** 网页版在线阅读链接（`web/reader/<hash>`；回填目标） */
    readUrl: string;
    /**
     * 🔴 #609：**数字 bookId**（搜索接口 `bookInfo.bookId`，实测 `囚徒健身` = `750578`）。
     * 只有它能喂 `/web/book/info`（逐本补详情的唯一入口）；`readUrl` 里的 hash **不是** bookId（#529 实测 404）。
     * ⛔ 别拿它拼阅读链接（那条仍只认 hash）。
     */
    bookId?: string;
    /** 封面图（cdn URL，可缺）—— 🔴 #609 起**已在解析层升级成大图**（见 `upgradeWereadCover`） */
    coverUrl?: string;
    /** 简介（**全文**，可缺）—— #609 翻面：原先在这里就截成 120 字 ⇒ 回填进条目的简介天生不全 */
    intro?: string;
    /** 出版方（辅助辨认，可缺） */
    publisher?: string;
    /** 评分（0–10，一位小数；源字段 `newRating` 是 0–1000，除以 100） */
    rating?: number;
    /** 评价人数 */
    ratingCount?: number;
}

/** 检索词：书名（可选拼上作者，提高命中精度） */
export function buildWereadQuery(title: string, author?: string): string {
    const t = (title ?? '').trim();
    const a = (author ?? '').trim();
    if (!t) return a;
    return a ? `${t} ${a}` : t;
}

/** 搜索 URL（`fragment=100` = 让接口多回一点简介正文） */
export function buildWereadSearchUrl(keyword: string, maxIdx = 0, count = 20): string {
    const params = new URLSearchParams();
    params.set('keyword', keyword);
    params.set('maxIdx', String(maxIdx));
    params.set('frenum', String(count));
    params.set('fragment', '100');
    return `${WEREAD_SEARCH_URL}?${params.toString()}`;
}

/** 从 `deepLink`（`…/book-detail?type=1&v=<hash>`）取阅读器 hash；取不到 → `undefined` */
export function readerHashFromDeepLink(deepLink: unknown): string | undefined {
    if (typeof deepLink !== 'string') return undefined;
    const m = /[?&]v=([A-Za-z0-9]+)/.exec(deepLink);
    return m ? m[1] : undefined;
}

/** hash → 网页版在线阅读链接 */
export function wereadReaderUrl(hash: string): string {
    return `${WEREAD_READER_PREFIX}${hash}`;
}

/**
 * 🔴 #582 封面**大图**参数 —— 搜索接口给的 `cover` 是 `…/s_<name>.jpg`，**不带任何参数时只回 70×100**
 *    （2026-10-09 探针实测，见 `_probe_weread_cover582b/c/d.cjs`）。
 *
 * 🔴 实测结论（两台 CDN 都吃这一条，⛔ 别换写法）：
 *    · `cdn.weread.qq.com/…`（腾讯云 COS + 数据万象）：原样 **70×100** → 加 `?imageMogr2/thumbnail/600x`
 *      **600×857**（100KB）；
 *    · `wfqqreader-1252317822.image.myqcloud.com/cover/<n>/<id>/`：同一串同样有效（70×100 → 600×857）；
 *      该台另有**改前缀字母**的老路（`s_`→`o_` = 600×800），但**不必**用 —— 查询串两边通吃，一条规则更省。
 *    · ⚠️ **源对象本身就是高分辨率**：`s_` 那张带参数出的是 100KB/600×857，而把真·小图 `m_`（84×120）
 *      放大到同尺寸只有 68KB ⇒ 字节差说明细节不同，不是插值放大。
 *    · ⛔ 阿里云写法 `?x-oss-process=…` **无效**（原样 70×100）；⛔ 重复拼两个 `?…?…` 也无效（只认第一段）。
 *    · 下载本地时**不受影响**：`downloadPosterToLocal` 固定写 `.jpg`（不看 URL 后缀）。
 */
export const WEREAD_COVER_QUERY = 'imageMogr2/thumbnail/600x';

/**
 * 把微信读书封面 URL 换成**大图**（幂等；非 http(s) 原样返回 / 空值 → `undefined`）。
 * 🔴 只对**微信读书**来源的封面调用 —— 别的站点的图床不认这条查询串（虽然多半会忽略，但没必要试）。
 */
export function upgradeWereadCover(url: unknown): string | undefined {
    const s = asString(url);
    if (!s) return undefined;
    if (!/^https?:\/\//i.test(s)) return s;
    if (/imageMogr2/i.test(s)) return s; // 幂等：已经是处理过的地址就别叠第二遍
    return `${s}${s.includes('?') ? '&' : '?'}${WEREAD_COVER_QUERY}`;
}

/**
 * #582 书籍**详情**端点（逐本补元数据：评分 / 简介 / 出版社 / ISBN / 分类 / 出版时间）。
 *
 * 🔴 为什么必须逐本补：**书架同步（`/web/shelf/sync`）只给书名/作者/封面/分类/读完标记**，
 *    ⛔ 没有评分与简介（官方 `skills/shelf.md` 的字段表里就没有）；搜索接口**有** `newRating` / `intro`，
 *    但它只按关键词返回有限几条 —— 用它补书架是靠不住的（同名/缺项）。⇒ 唯一可靠的来源是这个端点。
 * ⚠️ 字段形态取自参考实现 `zhaohongxuan/obsidian-weread-plugin` 的 `BookDetailResponse`（真实抓包整理）。
 */
export function buildWereadBookInfoUrl(bookId: string): string {
    return `${WEREAD_BOOK_INFO_URL}?bookId=${encodeURIComponent(bookId)}`;
}

/**
 * 逐本补详情时的**串行间隔**（ms）。
 * 🔴 一次导入可能几十本 ⇒ 必须**一条一条来**（并发吃风控，同 #577 封面那条闸门的口径）。
 */
export const WEREAD_INFO_GAP_MS = 220;

// 🔴 #609 删除 `INTRO_MAX`（原 120 字截断）：简介在**解析层**被截 ⇒ 回填进条目的简介天生不全
//    （用户报障「搜索源的元信息和书架导入不一致」的一半）。候选卡本身**不渲染简介**（只画书名/作者/评分），
//    所以放宽成全文不会撑破列表；真需要截断时应当由**显示层**做，⛔ 别在解析层丢信息。

function asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

function asNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 解析搜索响应 → 候选列表（形状不对 / `books` 非数组 → `[]`）。
 * 逐条容错：`bookInfo` 缺失、无 `deepLink`（拼不出阅读链接，如公众号 / 文章）→ **跳过该条**。
 * 保序、按 `readUrl` 去重。
 */
export function parseWereadSearch(raw: unknown): WereadCandidate[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const books = (raw as Record<string, unknown>).books;
    if (!Array.isArray(books)) return [];
    const out: WereadCandidate[] = [];
    const seen = new Set<string>();
    for (const item of books) {
        if (typeof item !== 'object' || item === null) continue;
        const info = (item as Record<string, unknown>).bookInfo;
        if (typeof info !== 'object' || info === null) continue;
        const b = info as Record<string, unknown>;
        const hash = readerHashFromDeepLink(b.deepLink);
        if (!hash) continue;
        const title = asString(b.title);
        if (!title) continue;
        const readUrl = wereadReaderUrl(hash);
        if (seen.has(readUrl)) continue;
        seen.add(readUrl);
        const c: WereadCandidate = { title, author: asString(b.author), readUrl };
        // 🔴 #609：`bookId` 是「逐本补详情」的钥匙（表单选中后按需拉 `/web/book/info`），必须原样带上
        const bookId = asString(b.bookId);
        if (bookId) c.bookId = bookId;
        // 🔴🔴 #609：封面**在本层就升级**（原先只在 `toWereadBookResult` 升级 ⇒
        //    「检索在线书籍阅读」那个候选浮层直接渲染 `c.coverUrl`，拿到的是 **70×100 原图**，必然糊）。
        //    升级函数是幂等的，故 `toWereadBookResult` 那处保留不变。
        const cover = upgradeWereadCover(b.cover);
        if (cover) c.coverUrl = cover;
        // 🔴 #609：简介**保留全文**（截断只该发生在显示层，见上面那条注释）
        const intro = asString(b.intro);
        if (intro) c.intro = intro;
        const publisher = asString(b.publisher);
        if (publisher) c.publisher = publisher;
        // `newRating` 是 0–1000（实测「三体全集」= 930 ⇒ 页面显示 9.3），/100 且保留一位小数
        const raw1000 = asNumber(b.newRating);
        if (raw1000 !== undefined && raw1000 > 0) c.rating = Math.round(raw1000 / 10) / 10;
        const count = asNumber(b.newRatingCount);
        if (count !== undefined && count > 0) c.ratingCount = count;
        out.push(c);
    }
    return out;
}

// ────────────────────────── #580 授权（Cookie）与书架 ──────────────────────────

/** 书架 / 鉴权接口地址（`synckey` / `lectureSynckey` 是**增量同步游标**，首次同步传 0） */
export function buildWereadShelfUrl(synckey = 0, lectureSynckey = 0): string {
    const p = new URLSearchParams();
    p.set('synckey', String(synckey));
    p.set('lectureSynckey', String(lectureSynckey));
    return `${WEREAD_SHELF_URL}?${p.toString()}`;
}

/**
 * 把用户粘贴的那一坨**归一成一条 Cookie 请求头值**。
 *
 * 🔴 为什么要洗（用户在真机上会这么干，三种都见过）：
 *   ⑴ 从 DevTools「Copy value」拿到的可能带 `Cookie: ` 前缀（那是**请求头名字**，不是值的一部分）；
 *   ⑵ 从 F12 的 Request Headers 整段复制会**带换行**（HTTP 头里换行是分隔符 ⇒ 必须折成 `; `）；
 *   ⑶ 行尾/行首空白、以及重复分隔符 `;;`。
 * ⛔ 本轮**不校验**里面的键名（微信读书的 Cookie 键随登录方式变化，写死白名单 = 用户换个登录方式就失效）；
 *    真伪只由「测试连接」打一次真实请求来回答（`parseWereadShelfAuth`）。
 */
export function normalizeWereadCookie(raw: unknown): string {
    let s = typeof raw === 'string' ? raw : '';
    if (!s) return '';
    // 行首的 `Cookie:` / `cookie:`（整段粘贴形态）
    s = s.replace(/^\s*cookie\s*:\s*/i, '');
    // 🔴 换行（含 CRLF / 单 CR）折成 **`; `**（Cookie 以 `; ` 分隔，⛔ 不能折成空格 ——
    //    否则多行粘贴出来的 `a=1\nb=2` 会被服务端当成**一个** cookie `a`、`b` 整条丢失）；
    //    随后把 `;` 两侧空白收干净、把连续分隔折成一个 `; `。
    s = s.replace(/[\r\n]+/g, '; ');
    s = s.replace(/\s*;\s*/g, '; ');
    s = s.replace(/(?:;\s*)+/g, '; ');
    s = s.replace(/\s{2,}/g, ' ').trim();
    // 收尾的 `; ` 去掉（有些工具会在末尾补一个）
    s = s.replace(/[;\s]+$/, '').trim();
    return s;
}

/** 是否填了授权（只看「有没有」，不判真伪 —— 判真伪要打网，那是 `testWereadAuth` 的活） */
export function hasWereadAuth(cookie: unknown): boolean {
    return normalizeWereadCookie(cookie).length > 0;
}

/** 「测试连接」的结论（`ok` = Cookie 有效且书架可读；失败时 `message` 直接给用户看） */
export interface WereadAuthProbe {
    ok: boolean;
    message: string;
}

/**
 * `errCode` → **失败文案**；`null` = 不算错误（`errCode === 0`，或**根本没有 `errCode` 字段**）。
 *
 * 🔴 **单一真源**：`parseWereadShelfAuth`（测试连接）与 `parseWereadShelf`（#581 书架同步）**共用这一份** ——
 *    ⛔ 别在别处再抄一遍这几句（本仓「同一概念只准一份文案」，手抄第二份就是 bug）。
 * 🔴 `-2010` 单独给「无效或已过期（未登录）」：这是本端点**实测的未登录码**（注意 HTTP 层仍是 200）
 *    —— 用户读到这句就知道该去重填 Cookie，而不是「网络不好」。
 */
export function wereadErrMessage(root: Record<string, unknown>): string | null {
    const code = asNumber(root.errCode);
    if (code === undefined || code === 0) return null;
    if (code === -2010) return 'Cookie 无效或已过期（未登录）';
    return asString(root.errMsg) || `微信读书返回错误码 ${code}`;
}

/**
 * 解析书架 / 鉴权响应 → 「测试连接」结论。
 *
 * 🔴 判据链（顺序不许换）：
 *   ⑴ 非 JSON ⇒ 失败（多半被风控或接口变更）；
 *   ⑵ `errCode === 0` ⇒ **成功**（`errCode` 是本端点实测的**唯一**成功标志）；
 *   ⑶ `errCode` 有值但非 0 ⇒ 失败，文案交给 `wereadErrMessage`（实测未登录 = `-2010` / 「用户不存在」）；
 *   ⑷ **没有 `errCode` 字段**（上游换字段名）⇒ 退而看有没有 `books` 数组 ——
 *      有则算成功，没有则如实说「返回结构无法识别」。⛔ 别把这种情况默认判成功（那会让失效 Cookie 显示 ✓）。
 */
export function parseWereadShelfAuth(text: string): WereadAuthProbe {
    let raw: unknown;
    try {
        raw = JSON.parse(String(text ?? ''));
    } catch {
        return { ok: false, message: '返回内容无法解析（多半被风控或接口变更）' };
    }
    if (typeof raw !== 'object' || raw === null) return { ok: false, message: '返回结构无法识别' };
    const root = raw as Record<string, unknown>;
    const code = asNumber(root.errCode);
    if (code === 0) return { ok: true, message: 'Cookie 有效，已读到书架' };
    if (code !== undefined) {
        // code 非 0 且非 undefined ⇒ `wereadErrMessage` 必回字符串（`??` 只为把类型收窄）
        return { ok: false, message: wereadErrMessage(root) ?? `微信读书返回错误码 ${code}` };
    }
    if (Array.isArray(root.books)) return { ok: true, message: 'Cookie 有效，已读到书架' };
    return { ok: false, message: '返回结构无法识别（接口可能已变更）' };
}

/**
 * 一条候选 → **书籍搜索结果**（#580：微信读书作为书籍组元数据源，与豆瓣并列）。
 *
 * 🔴 映射口径：
 *    · `source: 'weread'` ⇒ 来源名/角标经 `sourceLabel` 自动取注册表 `label`（「微信读书」），
 *      ⛔ 别在这里写一份展示名（本仓「同一概念只准一份文案」）；
 *    · `sourceUrl` = 该书的**在线阅读页**（`web/reader/<hash>`）—— 这既是本书的「官方页」，
 *      也正是书籍表单「网络地址」要的那个 `readUrl` 口径（#529 建立）；
 *    · 空字段一律**不落键**（`|| undefined`）：`author: ''` 会在详情里画出一行空白的「作者」。
 *    · 🔴🔴 **#589 翻面 #582 的「两层口径」**：封面**在本层就升级成大图**（`upgradeWereadCover`）。
 *      #582 当时把升级只放在「采纳写入条目」那一步，结果**搜索结果列表里那张仍是 70×100 的原图**
 *      （用户 2026-10-10 报障：「封面还是模糊」）⇒ 升级必须在**结果投影**这一层做，列表与采纳共用同一个地址。
 *      ⚠️ 它是**幂等**的（已带 `imageMogr2` 就原样返回）⇒ 再被升级一次也无害。
 */
export function toWereadBookResult(c: WereadCandidate): BookSearchResult {
    return {
        id: `weread:${c.readUrl}`,
        title: c.title,
        author: c.author || undefined,
        publisher: c.publisher,
        // ⚠️ 候选侧 #609 起已是升级过的地址；这里再升一次是**幂等**兜底（手搓候选的单测直接调本函数）
        thumbnail: upgradeWereadCover(c.coverUrl),
        description: c.intro,
        rating: c.rating,
        ratingCount: c.ratingCount,
        source: 'weread',
        sourceUrl: c.readUrl,
        // 🔴 #609：把 `bookId` 带进结果 —— 表单选中后要拿它去拉一次 `/web/book/info`
        //    （补出版年 / 出版社 / ISBN / 分类 / 完整简介 / 大图封面），口径与「书架导入」逐本补详情**完全一致**。
        bookId: c.bookId,
    };
}

// ────────────────────── #582 书籍详情（逐本补元数据）──────────────────────

/** 一本书的详情（只留表单/条目用得上的字段；缺的一律**不落键**） */
export interface WereadBookInfo {
    title?: string;
    author?: string;
    /** 封面（**已升级成大图**，见 `upgradeWereadCover`） */
    coverUrl?: string;
    /** 内容简介（源字段 `intro`，可能带 HTML 标签 → 这里只做去标签 + 收空白） */
    intro?: string;
    publisher?: string;
    isbn?: string;
    /** 分类（源字段 `category`，如「文学-外国文学」） */
    category?: string;
    /** 出版年份（源字段 `publishTime` 是字符串，从中取 4 位年） */
    year?: number;
    /** 评分 0–10（源 `newRating` 是 0–1000，÷100；与 #580 搜索那条同口径） */
    rating?: number;
    /** 评价人数（源 `newRatingCount`） */
    ratingCount?: number;
}

/** 去掉简介里的 HTML 标签（源站简介常带 `<p>` / `&nbsp;`），并收掉多余空白 */
function stripHtml(v: unknown): string {
    const s = asString(v);
    if (!s) return '';
    return s
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 从 `publishTime`（字符串，可能是 `2019-01-01` / `2019年1月`）里取 4 位年 */
function yearOf(v: unknown): number | undefined {
    const m = /(19|20)\d{2}/.exec(asString(v));
    if (!m) return undefined;
    const y = Number(m[0]);
    return Number.isFinite(y) ? y : undefined;
}

/**
 * 解析 `/web/book/info` 响应 → 详情（失败一律 `null`，调用方**静默降级**回书架级字段）。
 *
 * 🔴 判据链与别处同口径：`errCode` 非 0（未登录 = `-2010`）⇒ `null`（文案真源仍是 `wereadErrMessage`，
 *    ⛔ 这里不再抄一份）；没有 `bookId`/`title` ⇒ `null`（结构不对，别拿它去污染条目）。
 */
export function parseWereadBookInfo(raw: unknown): WereadBookInfo | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const root = raw as Record<string, unknown>;
    if (wereadErrMessage(root)) return null;
    const title = asString(root.title);
    if (!asString(root.bookId) && !title) return null;
    const out: WereadBookInfo = {};
    if (title) out.title = title;
    const author = asString(root.author);
    if (author) out.author = author;
    const cover = upgradeWereadCover(root.cover);
    if (cover) out.coverUrl = cover;
    const intro = stripHtml(root.intro);
    if (intro) out.intro = intro;
    const publisher = asString(root.publisher);
    if (publisher) out.publisher = publisher;
    const isbn = asString(root.isbn);
    if (isbn) out.isbn = isbn;
    const category = asString(root.category);
    if (category) out.category = category;
    const year = yearOf(root.publishTime);
    if (year !== undefined) out.year = year;
    const raw1000 = asNumber(root.newRating);
    if (raw1000 !== undefined && raw1000 > 0) out.rating = Math.round(raw1000 / 10) / 10;
    const count = asNumber(root.newRatingCount);
    if (count !== undefined && count > 0) out.ratingCount = count;
    return out;
}
