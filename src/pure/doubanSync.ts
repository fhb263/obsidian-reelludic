/**
 * 豆瓣「我的收藏」同步（#662）。
 *
 * ## 用户口径
 * 「元数据源凭据-豆瓣凭据入口再添加个同步导入按钮的功能」→「能不能导入曾标记想读在读等的条目」。
 *
 * ## 数据来源（参考 `Wanxp/obsidian-douban` 的金标准做法）
 * 豆瓣没有公开的「我的收藏」JSON 接口，只能抓**收藏列表页**（需 Cookie 登录态）：
 *
 *     https://{movie,book,music,game}.douban.com/people/{用户ID}/{doType}?start={N}&sort=time&rating=all&filter=all&mode=list
 *
 * `doType`（= 收藏状态）：
 *   · 影视 / 书籍 / 音乐：`wish`（想看/想读/想听）、`do`（在看/在读/在听）、`collect`（看过/读过/听过）
 *   · 游戏：`games?action=wish|do|collect`
 * 🔴 同一套页面的 HTML 结构由豆瓣维护、**没有版本保证** ⇒ 解析必须**容错**：
 *    认出多少算多少，认不出的行**跳过但不报错**（否则一次改版整个同步就废了）。
 *
 * ## 落点（⛔ 别在这里做）
 * 本模块**只做纯解析**：HTML → 行对象。网络请求在 `main`，落库走 `EntryService`，
 * 弹窗在 `DoubanSyncModal`。没用到 obsidian API ⇒ 可单测。
 */

/** 同步范围（豆瓣的四类媒体 —— 日记/广播不在本插件的能力面内，⛔ 不假装支持） */
export type DoubanSyncKind = 'movie' | 'book' | 'music' | 'game';

/** 收藏状态（豆瓣的三种标记，跨类型通用） */
export type DoubanCollectionState = 'wish' | 'do' | 'collect';

/** 列表页的一行 */
export interface DoubanCollectionItem {
    /** 豆瓣条目 id（从链接里抓的 5~10 位数字） */
    id: string;
    /** 条目网址（详情页） */
    url: string;
    /** 标题 */
    title: string;
    /** 打分（1~5；0 = 没打分） */
    rating: number;
    /** 标记时间（`YYYY-MM-DD`；解析不出为 `null`） */
    markedAt: string | null;
    /** 短评（列表页通常没有，`mode=list` 才偶有；缺省 `null`） */
    comment: string | null;
}

/** 一页的结果 */
export interface DoubanCollectionPage {
    items: DoubanCollectionItem[];
    /** 该类型收藏总数（页面上的「1/234」里的 234；抓不到 = 0） */
    total: number;
}

/** 站点域名（影视与书籍用不同子域 —— 抓错子域会 404） */
export const DOUBAN_KIND_DOMAIN: Readonly<Record<DoubanSyncKind, string>> = {
    movie: 'movie',
    book: 'book',
    music: 'music',
    game: 'www',
};

/** 展示名 */
export const DOUBAN_KIND_LABELS: Readonly<Record<DoubanSyncKind, string>> = {
    movie: '影视',
    book: '书籍',
    music: '音乐',
    game: '游戏',
};

/** 状态展示名（按类型微调：书籍是「想读」而不是「想看」） */
export function doubanStateLabel(kind: DoubanSyncKind, state: DoubanCollectionState): string {
    const noun = { movie: '想', book: '想', music: '想', game: '想' }[kind];
    void noun;
    if (state === 'wish') return kind === 'book' ? '想读' : kind === 'music' ? '想听' : kind === 'game' ? '想玩' : '想看';
    if (state === 'do') return kind === 'book' ? '在读' : kind === 'music' ? '在听' : kind === 'game' ? '在玩' : '在看';
    return kind === 'book' ? '读过' : kind === 'music' ? '听过' : kind === 'game' ? '玩过' : '看过';
}

/** 收藏列表页地址（每页 15 条） */
export function doubanCollectionUrl(kind: DoubanSyncKind, userId: string, state: DoubanCollectionState, start: number): string {
    const domain = DOUBAN_KIND_DOMAIN[kind];
    const base = `https://${domain}.douban.com/people/${encodeURIComponent(userId.trim())}`;
    if (kind === 'game') {
        // 游戏的「想玩/在玩/玩过」走 action 参数（与影视书籍的路径式 doType 不同）
        return `${base}/games?start=${start}&sort=time&rating=all&filter=all&mode=list&action=${state}`;
    }
    return `${base}/${state}?start=${start}&sort=time&rating=all&filter=all&mode=list`;
}

/** 每页条数（豆瓣列表固定 15；用返回值判断"是否还有下一页"） */
export const DOUBAN_PAGE_SIZE = 15;

/** 四种类型 × 三种状态 = 「全部」要拉的 12 个组合（⛔ 顺序固定：弹窗与进度文案都按它） */
export const DOUBAN_ALL_KINDS: readonly DoubanSyncKind[] = ['movie', 'book', 'music', 'game'];
export const DOUBAN_ALL_STATES: readonly DoubanCollectionState[] = ['wish', 'do', 'collect'];

/** 「全部读取」的任务清单（12 项；带类型与状态的展示名，便于逐项报进度） */
export function doubanSyncJobs(): Array<{ kind: DoubanSyncKind; state: DoubanCollectionState; label: string }> {
    const out: Array<{ kind: DoubanSyncKind; state: DoubanCollectionState; label: string }> = [];
    for (const kind of DOUBAN_ALL_KINDS) {
        for (const state of DOUBAN_ALL_STATES) {
            out.push({ kind, state, label: `${DOUBAN_KIND_LABELS[kind]} · ${doubanStateLabel(kind, state)}` });
        }
    }
    return out;
}

/**
 * 🔴 #663（用户：「不能一键读取所有导入吗。还要我选」）：给每条带一个**稳定合成 id**。
 *
 * 为什么需要：一键读取会把四类都拉回来，而**不同类可能有相同的豆瓣数字 id**
 * （豆瓣各站点的 subject 编号独立）⇒ 只按 id 去重会把「同号的电影」和「同号的书」误合并。
 * ⇒ 去重键与落库的 `sourceUrl` 都带类型前缀（`movie:1292052`）。
 */
export function doubanItemKey(kind: DoubanSyncKind, id: string): string {
    return `${kind}:${id}`;
}

/**
 * 解析收藏列表页。
 *
 * 🔴 结构（`mode=list` 的经典形态，参考项目同款选择器）：
 *     `<div class="item-show">` 一行
 *       ├─ `<div class="title"><a href="https://movie.douban.com/subject/1234/">标题</a></div>`
 *       ├─ `<div class="date">2024-01-02</div>`
 *       └─ 打分：`<span class="rating5-t"></span>` 之类（class 里带 `ratingN-t`）
 *     `<span class="subject-num">1/234</span>` 总数
 * ⚠️ ⛔ 不引 cheerio（本仓零新依赖）：用**正则**按行切 `.item-show` 块再逐块抓。
 *    抗改版的取舍：认不出就返回空 —— 调用方据此提示「页面结构变了」，⛔ 不静默当"没有收藏"。
 */
export function parseDoubanCollectionPage(html: string): DoubanCollectionPage {
    // 总数：「1/234」或「1 / 234」
    let total = 0;
    const numM = html.match(/class="subject-num"[^>]*>([\s\S]*?)</);
    if (numM) {
        const per = numM[1].match(/\/\s*(\d+)/);
        if (per) total = parseInt(per[1], 10) || 0;
    }

    const items: DoubanCollectionItem[] = [];
    // 按 `.item-show` 切块：先找所有起点，每块到下一个起点（或结尾）
    const starts: number[] = [];
    const re = /class="item-show"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) starts.push(m.index);
    for (let i = 0; i < starts.length; i++) {
        const block = html.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : html.length);
        const item = parseDoubanCollectionItem(block);
        if (item) items.push(item);
    }
    return { items, total };
}

/** 单块解析；认不出（没有链接 / 没有 id / 没有标题）⇒ `null`（由外层跳过） */
export function parseDoubanCollectionItem(block: string): DoubanCollectionItem | null {
    // 标题链接：`<div class="title"><a href="...">标题</a>`
    // 🔴 用「无尖括号」的宽松形态 `[^>]*` 抓标题，⛔ 别用 `[\s\S]*?` 配 `<\/a>`：
    //    实体里的 `&#39;` 含有分号与 `#`，回溯会让惰性匹配**吃掉整块**导致认不出（单测当场抓到）。
    //    ⚠️ 标题里若真有嵌套标签（豆瓣偶尔包 `<em>`），先剥标签再解码 —— 两步顺序不能反。
    const linkM = block.match(/class="title"[^>]*>[\s\S]{0,80}?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkM) {
        // 兜底：只要抓得到 href，标题取 href 之后到 `</a>` 之间的纯文本
        const looseM = block.match(/<a[^>]+href="([^"]*\/subject\/\d{5,10}\/?[^"]*)"[^>]*>([^<]{1,300})/);
        if (!looseM) return null;
        return finishItem(block, looseM[1].trim(), decodeEntities(looseM[2]).trim());
    }
    return finishItem(block, linkM[1].trim(), decodeEntities(linkM[2].replace(/<[^>]+>/g, '')).trim());
}

/** 链接与标题已就绪，补齐其余字段 */
function finishItem(block: string, url: string, title: string): DoubanCollectionItem | null {
    // id：链接里 5~10 位连续数字（`/subject/1234567/`）
    const idM = url.match(/(\d{5,10})/);
    if (!idM || !title) return null;
    // 打分：class 里带 `ratingN-t`（老页面）；新页面偶有 `allstarN0 rating` 形态
    let rating = 0;
    const ratingM = block.match(/rating(\d)-t/) || block.match(/allstar(\d)0\s*rating/);
    if (ratingM) rating = Math.max(0, Math.min(5, parseInt(ratingM[1], 10)));
    // 标记时间：`<div class="date">2024-01-02</div>`（也有 `2024-01-02 12:34:56`）
    const dateM = block.match(/class="date"[^>]*>([\s\S]*?)</);
    const markedAt = dateM ? normalizeDate(decodeEntities(dateM[1])) : null;
    // 短评：`<span class="comment">…</span>`
    const cmtM = block.match(/class="comment"[^>]*>([\s\S]*?)<\/span>/);
    const comment = cmtM ? decodeEntities(cmtM[1].replace(/<[^>]+>/g, '')).trim() || null : null;
    return { id: idM[1], url, title, rating, markedAt, comment };
}

/** 只留 `YYYY-MM-DD`（其余形态原样返回 `null`，⛔ 不猜） */
export function normalizeDate(raw: string): string | null {
    const m = raw.trim().match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!m) return null;
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
}

/**
 * HTML 实体解码（只处理名字与数字实体 —— ⛔ 不引第三方库，也不用 DOMParser）。
 * ⚠️ 豆瓣标题里常见 `&amp;` / `&#39;` / `&quot;` / `&lt;` / `&gt;` / `&nbsp;`。
 */
export function decodeEntities(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_m, d: string) => safeFromCodePoint(parseInt(d, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

function safeFromCodePoint(cp: number): string {
    try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    } catch {
        return '';
    }
}

/**
 * 从 Cookie 里认「豆瓣用户 ID」。
 * 🔴 为什么要它：收藏列表页的地址是 `/people/{用户ID}/...`，而 Cookie 里恰好带着 `dbcl2="123456789:xxxx"`，
 *    那段数字就是用户 ID ⇒ **用户不用额外再填一遍**（少一个必填项，少一处出错机会）。
 * ⚠️ 认不出 ⇒ 返回 `null`（调用方转去提示用户手动填）。
 */
export function doubanUserIdFromCookie(cookie: string): string | null {
    // Cookie 里 `dbcl2="<uid>:<hash>"`，引号可有可无
    const m = cookie.match(/dbcl2="?(\d{3,12})[:\"]/);
    return m ? m[1] : null;
}

/** 豆瓣评分（1~5）→ 本插件的 5 星制（本来就是 1~5 ⇒ 原样，0 表示未评） */
export function doubanRatingToEntryRating(r: number): number {
    if (!Number.isFinite(r)) return 0;
    return Math.max(0, Math.min(5, Math.round(r)));
}

/** 条目详情页网址（也用作**判重键** —— `sourceUrl` 里带 `/subject/<id>/`） */
export function doubanSubjectUrl(kind: DoubanSyncKind, id: string): string {
    return `https://${DOUBAN_KIND_DOMAIN[kind]}.douban.com/subject/${id}/`;
}

/**
 * 豆瓣收藏状态 → 本插件的条目状态。
 *
 * 🔴 三态一一对应：`wish` → 想看/想读/想听（`want`）；`do` → 在看/在读（`watching`）；`collect` → 看过/读过（`watched`）。
 * ⚠️ 音乐「在听」也映射到 `watching`：本插件只有四态（want / watching / watched / archived），
 *    音乐没有独立状态，归入"进行中"最贴近用户心智（⛔ 别硬造第五态 —— 那是 schema 变更）。
 * ⛔ 不用 `archived`：那是用户主动"归档"，不是豆瓣的语义。
 */
export function doubanStateToStatus(
    _kind: DoubanSyncKind,
    state: DoubanCollectionState,
): 'want' | 'watching' | 'watched' {
    if (state === 'wish') return 'want';
    if (state === 'do') return 'watching';
    return 'watched';
}
