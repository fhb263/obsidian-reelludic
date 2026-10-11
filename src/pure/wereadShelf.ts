/**
 * 微信读书「书架同步」解析与投影（纯逻辑，无 obsidian 依赖，可单测）。
 *
 * 🔴 端点（与 #580「测试连接」**同一个、同一份 Cookie**）：
 *    `GET https://weread.qq.com/web/shelf/sync?synckey=0&lectureSynckey=0`
 *    未登录时回 **HTTP 200** + body `errCode`（2026-10-09 实测 `-2010`）⇒ 与测试连接同一条
 *    「真伪只看 body」口径；成功/失败的**文案判定共用** `pure/weread.wereadErrMessage`（⛔ 不在这里另写一份）。
 *
 * 🔴 字段口径来源（⛔ 不凭记忆）：腾讯自家 `Tencent/WeChatReading` 仓库的 `skills/shelf.md`
 *    （官方 Agent Skill 的接口说明）；另有一份独立整理页与之逐字段一致。
 *      · `books[]`   —— bookId / deepLink / title / author / cover / category /
 *                        readUpdateTime(unix 秒) / finishReading(1=读完) / updateTime / isTop / secret
 *      · `albums[]`  —— 有声专辑（与 books **完全独立**）
 *      · `mp`        —— 「文章收藏」目录入口（非空 = 书架里多 1 个条目，**不含内容**）
 *      · `archive[]` —— 书单分组（name / bookIds[]）
 *      · `bookCount` —— 可枚举电子书数量
 *
 * 🔴 导入范围**只到电子书**（用户 2026-10-09 裁定）：`albums`（有声专辑）与 `mp`（文章收藏）**不导入** ——
 *    本插件没有「有声书」类型，硬塞进音乐会得到语义错误的条目，文章收藏也不是书。它们**只用于如实报数**
 *    （见 `shelfExtraNote`，弹窗里写一句说明，⛔ 不静默忽略）。
 *
 * 🔴 官方文档明确：**书架同步不含阅读进度**（进度要逐本调 `/book/getprogress`）⇒ 本批**不回填进度**，
 *    只用 `finishReading` 决定导入时的状态（读完 = 已读，其余 = 在读）。
 */
import { readerHashFromDeepLink, upgradeWereadCover, wereadErrMessage, wereadReaderUrl, type WereadBookInfo } from 'pure/weread';
import type { MediaStatus } from 'pure/status';

/** 一条书架电子书（只保留导入用得上的字段；缺的一律**不落键**） */
export interface WereadShelfBook {
    /** 书籍唯一标识（源字段 `bookId`）。⚠️ 本批只用于去重与展示，⛔ **不用它拼阅读链接** —— 实测 404（#529） */
    bookId: string;
    title: string;
    /** 作者（缺 → 空串，与 `WereadCandidate` 同口径；写条目时再由 `shelfBookEntryFields` 转 `undefined`） */
    author: string;
    /** 封面（源字段 `cover`，实测是 http(s) 绝对地址；**非 http 一律丢弃** ⇒ 不把相对路径写进条目） */
    coverUrl?: string;
    /** 网页版阅读链接（由 `deepLink` 的 `v=<hash>` 拼；取不到则不落键 —— 条目照导，只是没有网络地址） */
    readUrl?: string;
    /** 是否读完（`finishReading === 1`） */
    finished: boolean;
    /** 最近阅读时间（unix **秒**；缺失/非正数不落键。官方规范：展示时须转成 YYYY-MM-DD） */
    readUpdateTime?: number;
    /** 源分类（`category`，如「文学-外国文学」；只作展示参考，⛔ **不据此推断 `bookKind`**） */
    category?: string;
    /** 归属书单名（由 `archive[].bookIds` 反查，可能多个） */
    archives?: string[];
}

/** 书架计数（口径 = 官方文档给定的那张表，⛔ 别自己发明公式） */
export interface WereadShelfStats {
    /** 电子书条目数（= 解析后的 `books.length`） */
    books: number;
    /** 有声专辑数（`albums.length`） */
    albums: number;
    /** 是否有「文章收藏」入口（`mp` 非空） */
    hasMp: boolean;
    /** 书架可见条目数 = `books + albums + (mp 非空 ? 1 : 0)` */
    total: number;
}

/** 解析结果：成功带列表与计数，失败带**给用户看的**一句话 */
export type WereadShelfParse =
    | { ok: true; books: WereadShelfBook[]; stats: WereadShelfStats }
    | { ok: false; message: string };

function asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

function asNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** `cover` 只在是 http(s) 绝对地址时才算数（相对路径写进条目 = 一张破图） */
function asCover(v: unknown): string | undefined {
    const s = asString(v);
    return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
}

/**
 * `mp` 是否「非空」（官方口径：非空 = 书架里多 1 个「文章收藏」条目）。
 * 🔴 ⛔ 不能只判 `!= null` —— 上游在「没有文章收藏」时可能给 `{}` / `[]` / `""` 这类**空壳**；
 *    判「有没有内容」才对得上官方那句「非空」（否则书架总数会平白 +1）。
 */
function mpPresent(v: unknown): boolean {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'object') return Object.keys(v as object).length > 0;
    return true;
}

/** `archive[]` → `bookId → 书单名[]`（官方：`bookIds` 是归属关系的**权威来源**，`books` 条目里没有 archiveId） */
function archiveIndex(raw: unknown): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!Array.isArray(raw)) return map;
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const a = item as Record<string, unknown>;
        const name = asString(a.name);
        if (!name) continue;
        const ids = Array.isArray(a.bookIds) ? a.bookIds : [];
        for (const id of ids) {
            const k = asString(id);
            if (!k) continue;
            const cur = map.get(k);
            if (cur) {
                if (!cur.includes(name)) cur.push(name);
            } else {
                map.set(k, [name]);
            }
        }
    }
    return map;
}

/** 逐条容错：读不出一条「有 bookId 又有书名」的条目就跳过它（不要往库里塞空白条目） */
function toShelfBook(item: unknown): WereadShelfBook | null {
    if (typeof item !== 'object' || item === null) return null;
    const b = item as Record<string, unknown>;
    const bookId = asString(b.bookId);
    const title = asString(b.title);
    if (!bookId || !title) return null;
    const out: WereadShelfBook = {
        bookId,
        title,
        author: asString(b.author),
        finished: asNumber(b.finishReading) === 1,
    };
    const cover = asCover(b.cover);
    if (cover) out.coverUrl = cover;
    const hash = readerHashFromDeepLink(b.deepLink);
    if (hash) out.readUrl = wereadReaderUrl(hash);
    const rt = asNumber(b.readUpdateTime);
    if (rt !== undefined && rt > 0) out.readUpdateTime = rt;
    const cat = asString(b.category);
    if (cat) out.category = cat;
    return out;
}

/**
 * 解析 `/web/shelf/sync` 响应。
 *
 * 🔴 逐条容错 + 按 `bookId` **去重（保序）**；`books` **不是数组** ⇒ 如实说「返回里没有书架数据」
 *    （⛔ 不静默回空列表 —— 那会把「接口变了」说成「你书架是空的」，用户排不出来）。
 */
export function parseWereadShelf(raw: unknown): WereadShelfParse {
    if (typeof raw !== 'object' || raw === null) return { ok: false, message: '返回结构无法识别' };
    const root = raw as Record<string, unknown>;
    const err = wereadErrMessage(root);
    if (err) return { ok: false, message: err };
    if (!Array.isArray(root.books)) {
        return { ok: false, message: '返回里没有书架数据（books 不是数组）—— 接口可能已变更' };
    }
    const arch = archiveIndex(root.archive);
    const books: WereadShelfBook[] = [];
    const seen = new Set<string>();
    for (const item of root.books) {
        const b = toShelfBook(item);
        if (!b || seen.has(b.bookId)) continue;
        seen.add(b.bookId);
        const names = arch.get(b.bookId);
        if (names && names.length) b.archives = names;
        books.push(b);
    }
    const albums = Array.isArray(root.albums) ? root.albums.length : 0;
    const hasMp = mpPresent(root.mp);
    return {
        ok: true,
        books,
        stats: { books: books.length, albums, hasMp, total: books.length + albums + (hasMp ? 1 : 0) },
    };
}

/** 按书名判重后的两支 */
export interface WereadShelfPartitioned {
    /** 库里没有的（弹窗里**默认勾选**） */
    fresh: WereadShelfBook[];
    /** 库里已有同名的（弹窗里展示，但**禁用 + 标原因**，⛔ 不参与导入） */
    dup: WereadShelfBook[];
}

/**
 * 把书架分成「未导入 / 已在库里」两支（用户 2026-10-09 裁定：**库里已有的跳过、不动它**）。
 *
 * 🔴 判重口径 = **书名**（trim 后全等，与 `main.importBangumiCollections` 的既有口径同族）；
 *    ⛔ 不按 `bookId` / `readUrl` 判 —— 微信读书的 id 属另一套命名空间，同一个书名在库里可能是从豆瓣进来的
 *    （`sourceUrl` 完全不同），按 id 判会把它们当成两本。
 */
export function partitionShelfBooks(
    books: WereadShelfBook[],
    isImported: (title: string) => boolean,
): WereadShelfPartitioned {
    const fresh: WereadShelfBook[] = [];
    const dup: WereadShelfBook[] = [];
    for (const b of books) (isImported(b.title) ? dup : fresh).push(b);
    return { fresh, dup };
}

/**
 * 书架条目 → `service.create` 的字段（**单一真源**：宿主的导入循环只做「调它 + 落库」）。
 *
 * 🔴 状态：`finishReading === 1` ⇒ **已读**（`watched`），其余 ⇒ **在读**（`watching`）——
 *    这是书架本身**唯一**能拿到的「读到哪了」信息（进度要逐本再调接口，本批不做）。
 * 🔴 `readUrl` 与 `sourceUrl` **同值**（都是那本书的在线阅读页）：前者是书籍表单「网络地址」的口径（#529 建立），
 *    后者是来源官方页（与 `toWereadBookResult` 一致）。
 * 🔴🔴 **#582：封面一律升级成大图**（`upgradeWereadCover`）—— 书架/搜索给的 `cover` 都是 70×100 的缩略
 *    （不带参数时 CDN 只回缩略图），直接写进条目就是一张糊图。
 * 🔴🔴 **#582：`info`（逐本拉来的详情）非空时合并进来** —— 书架同步**不含**评分与简介，
 *    用户点名「导入的书没有评分/简介」⇒ 宿主逐本调 `/web/book/info` 后从这里并进条目。
 *    ⚠️ 合并优先级：**详情 > 书架**（详情的书名/作者/封面更准）；详情缺的字段回落书架级值，⛔ 不留空键。
 */
export type WereadShelfEntryFields = {
    type: 'book';
    title: string;
    author?: string;
    status: MediaStatus;
    poster?: string;
    readUrl?: string;
    source: 'weread';
    sourceUrl?: string;
    /** #582 详情：内容简介（源 `intro`，已去 HTML 标签） */
    summary?: string;
    publisher?: string;
    isbn?: string;
    year?: number;
    /** 分类（源 `category`，如「文学-外国文学」）—— 表单「题材」是一位字符串，这里给单元素数组 */
    genres?: string[];
    /** 大众评分 0–10（源 `newRating` ÷100） */
    communityScore?: number;
    ratingCount?: number;
};

export function shelfBookEntryFields(
    b: WereadShelfBook,
    info?: WereadBookInfo | null,
): WereadShelfEntryFields {
    const author = info?.author || b.author;
    return {
        type: 'book',
        title: info?.title || b.title,
        author: author || undefined,
        status: b.finished ? 'watched' : 'watching',
        poster: info?.coverUrl ?? upgradeWereadCover(b.coverUrl),
        readUrl: b.readUrl,
        source: 'weread',
        sourceUrl: b.readUrl,
        // ── #582 逐本补来的详情（缺 ⇒ undefined ⇒ `normalizeEntry` 不落键）──
        summary: info?.intro || undefined,
        publisher: info?.publisher || undefined,
        isbn: info?.isbn || undefined,
        year: info?.year,
        genres: info?.category ? [info.category] : undefined,
        communityScore: info?.rating,
        ratingCount: info?.ratingCount,
    };
}

/**
 * 「最近阅读」展示文案（官方规范：所有 Unix 时间戳**必须**转成 `YYYY-MM-DD`，
 * ⛔ 不许把原始数字露给用户）。无时间戳 → `''`（调用方整段不显示）。
 * ⚠️ 用**本地时区**换算（用户看到的应当是自己那天读的日期，不是 UTC 那天）。
 */
export function shelfLastReadLabel(b: WereadShelfBook): string {
    if (!b.readUpdateTime) return '';
    const d = new Date(b.readUpdateTime * 1000);
    if (!Number.isFinite(d.getTime())) return '';
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 「本插件只导入电子书」那句说明（`null` = 没有需要说明的额外条目）。
 * 🔴 必须**说出来**：用户数了书架 30 条、只进来 28 条，⛔ 不能让他自己猜（本仓「不静默丢」的口径）。
 */
export function shelfExtraNote(stats: WereadShelfStats): string | null {
    const parts: string[] = [];
    if (stats.albums > 0) parts.push(`${stats.albums} 个有声专辑`);
    if (stats.hasMp) parts.push('文章收藏');
    if (!parts.length) return null;
    return `书架里另有 ${parts.join(' 与 ')} —— 本插件只导入电子书，这些未计入。`;
}
