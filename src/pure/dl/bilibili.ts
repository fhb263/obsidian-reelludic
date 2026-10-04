/**
 * B 站（bilibili）搜索面**纯逻辑**（#496，2026-10-03）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * 🔴 为什么单独一层：搜索接口的全部形态都在这里，服务层（`services/dl/bilibili`）只做
 *    「发请求 + 拼装」⇒「不带 Cookie 会 412」「标题里带高亮标签」「时长是 `4:30` 字符串」
 *    这三件**实测踩到**的事才能被单测钉住，而不是散在服务层里靠运气。
 *
 * 🔴 实测口径（2026-10-03，真请求跑出来的，⛔ 不是照文档猜的）：
 *   · `api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=…`
 *     **不带** `buvid3` Cookie ⇒ `HTTP 412`（风控；body 不是 JSON）；
 *     先 GET 一次 `https://www.bilibili.com/`、把响应的 `Set-Cookie: buvid3=…` 带上 ⇒ `200` + `code:0` + 20 条。
 *     ⚠️ **只要 `buvid3` 一个就够**（实测 `b_nut` 不带也通）⇒ 这里刻意只认它，行数越少越好。
 *   · `data.result[].title` 含 `<em class="keyword">…</em>` 高亮标签，引号等被**实体化**成 `&quot;`
 *     ⇒ 必须**剥标签 + 解实体**，否则列表里原样显示 `<em …>`（实测第一条就是这形态）。
 *   · `duration` 是 **`"4:30"` 字符串**（不是秒数）；`play` 是数字但**不保证**（缺省 / `--` 都可能）。
 *   · `pic` 是**协议相对**地址（`//i0.hdslb.com/…`）⇒ 补 `https:` 才能被 `<img>` 加载。
 *   · 接口**固定 20 条/页**（`pagesize: 20`），本仓只取第 1 页（列表式检索，不做翻页）。
 */

/** B 站首页 —— **只用来取 `buvid3`**（⛔ 不是给用户看的入口） */
export const BILI_HOME_URL = 'https://www.bilibili.com/';
/** 视频搜索接口（公开、免登录） */
export const BILI_SEARCH_API = 'https://api.bilibili.com/x/web-interface/search/type';
/** 视频详情接口（公开、免登录）—— **分P 列表唯一来源**（#505） */
export const BILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';
export const BILI_REFERER = 'https://www.bilibili.com/';
/** ⚠️ 与四平台 `services/dl` 里那份 UA 同源形态；B 站不带 UA 同样吃风控 */
export const BILI_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** 风控要求的那个 Cookie 名（实测只要它就够） */
export const BILI_COOKIE_NAME = 'buvid3';

/** 🔴 B站 标题的实体还原与「剥标签」走**全仓唯一真源** `pure/htmlText`（#498 抽出来共用）：
 *  ⛔ 别在这里再抄一份实体表 —— 另一条链路（必应图片搜索）也要还原实体，
 *  两份一旦分叉，就会出现「某条链路的标题里带字面量 `&quot;`」这种偶然现形的错。 */
import { decodeHtmlText } from 'pure/htmlText';

/** 一条 B 站视频（搜索结果归一化后的形状；列表与下载都只认这几个字段） */
export interface BiliVideo {
    bvid: string;
    title: string;
    author: string;
    /** 时长（秒）；解析不出来时 0（⇒ UI 不显示时长胶囊） */
    durationSec: number;
    coverUrl?: string;
    /** 播放数；拿不到时 0 */
    play: number;
    /** 分区名（`typename`，如「音乐综合」）；拿不到时缺省 */
    category?: string;
    /** 视频页地址（下载时就是把它交给 yt-dlp 的） */
    webUrl: string;
}

/** 搜索响应的解析结果 —— `code/message` 一并带出，服务层据此区分「没搜到」与「被风控」 */
export interface BiliSearchParse {
    code: number;
    message: string;
    videos: BiliVideo[];
}

/** 视频页地址（下载链路传给 yt-dlp 的就是它） */
export function buildBiliWebUrl(bvid: string): string {
    const b = String(bvid ?? '').trim();
    return b ? `https://www.bilibili.com/video/${encodeURIComponent(b)}` : '';
}

/** 搜索接口地址（`keyword` 走 `encodeURIComponent`；`page` 从 1 起，本仓只用第 1 页） */
export function buildBiliSearchUrl(keyword: string, page = 1): string {
    const kw = encodeURIComponent(String(keyword ?? '').trim());
    const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
    return `${BILI_SEARCH_API}?search_type=video&keyword=${kw}&page=${p}`;
}

/**
 * 从首页响应的 `Set-Cookie` 里挑出 `buvid3` 的值。
 * ⚠️ `set-cookie` 头在 Node 里是**数组**（多枚），每枚形如 `buvid3=xxx; Path=/; …` ⇒ 只取第一段。
 * 拿不到 ⇒ 空串（调用方仍可发一次请求 —— 有时不带也能通，通了就是通了）。
 */
export function parseBiliBuvid3(setCookies: readonly string[] | undefined): string {
    for (const raw of setCookies ?? []) {
        const first = String(raw).split(';', 1)[0].trim();
        const idx = first.indexOf('=');
        if (idx <= 0) continue;
        if (first.slice(0, idx).trim() !== BILI_COOKIE_NAME) continue;
        const value = first.slice(idx + 1).trim();
        if (value) return value;
    }
    return '';
}

/**
 * 剥掉搜索结果标题里的标签 + 还原实体。
 * 🔴 `&amp;` **必须最后**替换 —— 先换它会把 `&amp;lt;` 这种「实体化的实体」提前还原成 `<`，
 *    虽然是极端情况，但顺序写反就是静默错值，不如一次写对。
 */
export function decodeBiliText(raw: unknown): string {
    return decodeHtmlText(raw);
}

/** 封面地址归一：协议相对（`//i0.hdslb.com/…`）补 `https:`；`http:` 提到 `https:` */
export function normalizeBiliCover(raw: unknown): string {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    if (s.startsWith('//')) return `https:${s}`;
    if (/^http:\/\//i.test(s)) return `https://${s.slice(7)}`;
    return s;
}

/**
 * 时长解析：搜索接口给的是 **`"4:30"` / `"1:02:03"`** 这种字符串（⛔ 不是秒数）。
 * 已是数字则原样收（防御：上游换字段时不至于把秒数当字符串丢掉）；解析不出 ⇒ 0。
 */
export function parseBiliDuration(raw: unknown): number {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
    const s = String(raw ?? '').trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return Number(s);
    const parts = s.split(':');
    if (parts.length < 2 || parts.length > 3) return 0;
    let total = 0;
    for (const p of parts) {
        if (!/^\d+$/.test(p.trim())) return 0;
        total = total * 60 + Number(p.trim());
    }
    return total;
}

/** 播放数压缩：`3124656` → `312.5万`；`9999` → `9999`（⛔ 不足一万不加单位） */
export function formatBiliPlay(n: unknown): string {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v < 10000) return String(Math.round(v));
    return `${(v / 10000).toFixed(1)}万`;
}

/**
 * 解析搜索响应。
 * - 非 JSON / `code !== 0` ⇒ `{ code, message, videos: [] }`（服务层据此给「被风控」这类具体原因）；
 * - `code === 0` 但 `result` 为空 ⇒ 空列表（= 真没搜到，与风控不是一回事）；
 * - 只收 `type === 'video'` 且有 `bvid` 的条目（`search_type=video` 下通常都是，
 *   但仍**显式过滤** —— 这个接口历史上混进过专题/课堂条目）。
 */
export function parseBiliSearch(text: string): BiliSearchParse {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { code: -1, message: '响应不是 JSON（多半被风控或接口变更）', videos: [] };
    }
    const root = (data ?? {}) as { code?: unknown; message?: unknown; data?: { result?: unknown } };
    const code = Number(root.code ?? -1);
    const message = String(root.message ?? '');
    if (code !== 0) return { code: Number.isFinite(code) ? code : -1, message, videos: [] };
    const result = root.data?.result;
    if (!Array.isArray(result)) return { code, message, videos: [] };
    const videos: BiliVideo[] = [];
    for (const item of result) {
        const v = (item ?? {}) as Record<string, unknown>;
        if (v.type !== 'video') continue;
        const bvid = String(v.bvid ?? '').trim();
        if (!bvid) continue;
        const coverUrl = normalizeBiliCover(v.pic);
        videos.push({
            bvid,
            title: decodeBiliText(v.title),
            author: decodeBiliText(v.author),
            durationSec: parseBiliDuration(v.duration),
            coverUrl: coverUrl || undefined,
            play: Number(v.play) > 0 ? Math.round(Number(v.play)) : 0,
            category: decodeBiliText(v.typename) || undefined,
            webUrl: buildBiliWebUrl(bvid),
        });
    }
    return { code, message, videos };
}

/**
 * 解析结果 → 面向用户的一句失败原因（**只在真失败时用**：`code === 0` 就没搜到不算失败）。
 * 🔴 只认 412 这一个具体码 —— 它是实测唯一会撞上的（风控），别的都并进「搜索失败」，
 *    ⛔ 别去编 B 站内部错误码表（编出来的码迟早对不上真实响应，反而误导）。
 * ⚠️ `HTTP 层面的失败`（4xx/5xx / 请求抛错）不归这里 —— 那是服务层的事，见 `services/dl/bilibili`。
 */
export function biliSearchError(parse: { code: number; message: string }): string {
    const code = Number(parse?.code ?? -1);
    if (code === -412) return 'B 站返回 412（风控）：稍等一会儿再试，或检查网络代理';
    if (code === -1) return 'B 站搜索响应无法解析（多半被风控或接口变更）';
    const msg = String(parse?.message ?? '').trim();
    if (msg) return `B 站搜索失败：${msg}（code ${code}）`;
    return `B 站搜索失败（code ${code}）`;
}

// ────────────────────── 分P（#505：把「一个 52 集的长篇」一次填完）──────────────────────
//
// 🔴 为什么需要它：搜索接口**不返回分P 数**（实测：20 条里没有任何字段能一眼认出 52 集）
//    ⇒ 「点一条候选就知道它是单P 还是 52P」这件事**只能靠 `view` 接口**（实测免签名可用）。
//    实测「熊出没」前 10 条里 6 条是多P（3 条正是 52P）⇒ 这条路是真用得上的，不是理论上的。
//
// 🔴 `view` 与 `search` 的字段口径**不一样**，⛔ 别互相套用：
//    · `pages[].duration` 是**秒数**（数字，实测 1001）；
//      而搜索结果的 `duration` 是 **`"4:30"` 字符串**（见上面的 `parseBiliDuration`，它两种都收）。
//    · `pages[].page` 是**分P 号**（1 起，实测 1/2/3…52），⛔ 不是「第几页结果」。
//    · `pages[].part` 是分P 标题，同样可能带高亮标签 / 实体 ⇒ 走 `decodeBiliText`。

/** 一个分P（`pages[]` 归一化后的形状） */
export interface BiliPart {
    /** 分P 号（1 起）—— 拼 `?p=` 用的就是它 */
    page: number;
    /** 分P 标题（已剥标签解实体）；接口没给时为空串 */
    title: string;
    /** 时长（秒）；解析不出 ⇒ 0 */
    durationSec: number;
}

/** `view` 响应的解析结果（`title` = 视频标题，给勾选表当上下文） */
export interface BiliViewParse {
    code: number;
    message: string;
    title: string;
    parts: BiliPart[];
}

/** 视频详情地址（`bvid` 走 `encodeURIComponent`） */
export function buildBiliViewUrl(bvid: string): string {
    return `${BILI_VIEW_API}?bvid=${encodeURIComponent(String(bvid ?? '').trim())}`;
}

/**
 * 某分P 的播放地址（就是要填进条目「网络地址」的那个链接）。
 * ⚠️ **第 1 个分P 不带 `?p=`** —— `?p=1` 与视频页本体等价，省掉尾巴更干净，
 *    也让「单P 视频」的链接与用户自己复制的形态**逐字一致**（本仓既有行为，⛔ 别改）。
 * 空 `bvid` ⇒ 空串（⛔ 不出半截链接）。
 */
export function buildBiliPartUrl(bvid: string, page: number): string {
    const base = buildBiliWebUrl(bvid);
    if (!base) return '';
    const p = Number(page);
    if (!Number.isFinite(p) || Math.floor(p) < 2) return base;
    return `${base}?p=${Math.floor(p)}`;
}

/**
 * 解析 `view` 响应。
 * - 非 JSON / `code !== 0` ⇒ `{ code, message, parts: [] }`（服务层据此给具体原因）；
 * - `code === 0` 但没有 `pages` ⇒ 空列表（极少见，按「没有分P」处理）。
 * ⚠️ 只收 `page >= 1` 的条目（`page` 缺失 / 0 / 非数字一律跳过）—— 拼 `?p=` 全靠它，
 *    留一条脏数据就会生成一个指向错误分P 的链接。
 */
export function parseBiliView(text: string): BiliViewParse {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return { code: -1, message: '响应不是 JSON（多半被风控或接口变更）', title: '', parts: [] };
    }
    const root = (data ?? {}) as { code?: unknown; message?: unknown; data?: { title?: unknown; pages?: unknown } };
    const code = Number(root.code ?? -1);
    const message = String(root.message ?? '');
    if (code !== 0) return { code: Number.isFinite(code) ? code : -1, message, title: '', parts: [] };
    const title = decodeBiliText(root.data?.title);
    const raw = root.data?.pages;
    if (!Array.isArray(raw)) return { code, message, title, parts: [] };
    const parts: BiliPart[] = [];
    for (const item of raw) {
        const p = (item ?? {}) as Record<string, unknown>;
        const page = Number(p.page);
        if (!Number.isFinite(page) || page < 1) continue;
        parts.push({
            page: Math.floor(page),
            title: decodeBiliText(p.part),
            durationSec: parseBiliDuration(p.duration),
        });
    }
    return { code, message, title, parts };
}

/**
 * `view` 失败原因（与 `biliSearchError` 分开：文案主语不同，⛔ 别硬套「搜索失败」）。
 * 🔴 只认实测会撞上的那几个码；`-404` / `62002`（稿件不可见）是**真实且常见**的
 *    （搜索缓存里翻到已下架的稿件），给一句人话比 `code 62002` 有用得多。
 */
export function biliViewError(parse: { code: number; message: string }): string {
    const code = Number(parse?.code ?? -1);
    if (code === -412) return 'B 站返回 412（风控）：稍等一会儿再试，或检查网络代理';
    if (code === -1) return 'B 站响应无法解析（多半被风控或接口变更）';
    if (code === -404) return '这条视频不存在（可能已删除）';
    if (code === 62002) return '这条视频已不可见（可能被删除或设为私密）';
    const msg = String(parse?.message ?? '').trim();
    if (msg) return `读取分P失败：${msg}（code ${code}）`;
    return `读取分P失败（code ${code}）`;
}

/**
 * 勾选表的一行（**给模板直接渲染**：这一行要不要勾、能不能勾，全在这里算好）。
 */
export interface BiliFillRow {
    /** 分P 号（1 起） */
    page: number;
    /** 分P 标题 */
    part: string;
    durationSec: number;
    /** 目标集下标（**= 分P 在列表里的位置**；本仓铁律「数组下标 i = 第 i+1 集」） */
    epIndex: number;
    /** 目标集号（1 起，给人看的那个数） */
    epNo: number;
    /** 目标集**不存在**（分P 比集数多）⇒ 该行禁用、不参与填入 */
    outOfRange: boolean;
    /** 目标集**已经有链接**了 */
    hasUrl: boolean;
    /** 默认勾选态 = 可填 且 目标集还没链接 */
    checked: boolean;
}

/**
 * 分P 列表 + 当前条目的集链接数组 → 勾选表。
 *
 * 🔴 **对齐口径 = 按位置**（第 i 个分P ↔ 第 i 集），⛔ 不做「从分P 标题里抠集号」那种启发式：
 *    标题格式各家不同（`01赏花大会` / `第01集　　消失的记忆 上` / `03 植树英雄`），抠错了会
 *    **静默填错集**且用户难以发现；按位置至少和「合集从头开始」这个主流用法一致，且表里
 *    每行都标了目标集号，错位一眼可见（⚠️ 已知局限：`第41-52集` 这种「不从 1 开始」的分P
 *    会落到第 1~12 集 —— 用户可在表里逐行取消，见 UI-GUIDE §16.30）。
 *
 * 🔴 **已填过链接的集默认不勾**（用户 2026-10-03 裁定：「弹勾选让我选」）——
 *    ⇒ 既不静默跳过、也不静默覆盖，把决定权交给用户；勾上 = 覆盖。
 */
export function buildBiliFillRows(
    parts: readonly BiliPart[],
    episodeUrls: readonly (string | undefined)[],
): BiliFillRow[] {
    const total = Array.isArray(episodeUrls) ? episodeUrls.length : 0;
    return (parts ?? []).map((p, i) => {
        const epIndex = i;
        const outOfRange = i >= total;
        const hasUrl = !outOfRange && !!String(episodeUrls[i] ?? '').trim();
        return {
            page: Number(p?.page) || i + 1,
            part: String(p?.title ?? ''),
            durationSec: Number(p?.durationSec) > 0 ? Math.round(Number(p.durationSec)) : 0,
            epIndex,
            epNo: i + 1,
            outOfRange,
            hasUrl,
            checked: !outOfRange && !hasUrl,
        };
    });
}

/** 勾选表里「可勾」的行（`outOfRange` 的永远不算；给「全选」与计数用） */
export function biliSelectableRows(rows: readonly BiliFillRow[]): BiliFillRow[] {
    return (rows ?? []).filter((r) => !r.outOfRange);
}

/** 勾选表里当前**已勾中**的行（= 点「填入」时真正要写的那批） */
export function biliCheckedRows(rows: readonly BiliFillRow[]): BiliFillRow[] {
    return (rows ?? []).filter((r) => r.checked && !r.outOfRange);
}
