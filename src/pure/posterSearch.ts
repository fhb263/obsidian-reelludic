/**
 * 「从网络上搜封面图」的**纯逻辑**（#498，2026-10-03）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * 用户原话：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」。
 *
 * ## 🔴 实测口径（2026-10-03，**真请求跑出来的**，⛔ 不是照文档猜的）
 *
 * | 事实 | 实测值 |
 * |---|---|
 * | 必应图片搜索 | `GET https://cn.bing.com/images/async?q=<关键词>&first=1&count=35&mmasync=1` ⇒ **200**，一次 **35** 条 |
 * | 登录 / Cookie / Key | **都不需要**（只带浏览器 UA + `Accept-Language: zh-CN` 即可） |
 * | `www.bing.com` | 本机 302 → **`cn.bing.com`**（所以地址里直接写 `cn.bing.com`，少一跳） |
 * | 每条结果 | 藏在 `m="{…}"` 属性里，**整个 JSON 被 HTML 实体化**（`&quot;` / `&amp;`）⇒ 必须先还原再 `JSON.parse` |
 * | 字段 | `murl`（原图）/ `turl`（缩略图）/ `t`（标题）/ `purl`（来源页）/ `mid`/`md5` —— **没有宽高字段** |
 * | 缩略图主机 | `ts1~ts4.mm.bing.net`；实测 **`ts1` 不通、`tse1.mm.bing.net` 同一张图 200 / 93KB** ⇒ 见 `posterThumbChain` |
 * | 百度图片 | `image.baidu.com/search/acjson` 直接回 **`Forbid spider access`**（风控，本批实测） ⇒ ⛔ 别接 |
 * | Google / DuckDuckGo | 本机**完全不可达**（代理拦掉）⇒ ⛔ 别接 |
 *
 * ⚠️ 由此得到一条**产品口径**：候选列表里的缩略图是**别人家的 CDN**，它可能因为各种原因挂掉
 *    ⇒ 掉图必须能**逐级回退**、最后退到占位块，⛔ 不能让它变成一排破图标。
 */
import type { BookKind, EntryType } from 'data/types';
import { decodeHtmlEntities } from 'pure/htmlText';

/** 每页条数（= 必应 `count` 的实测值；分页靠 `first` 递增，见 `buildBingImageUrl`） */
export const BING_PAGE_SIZE = 35;

/** 必应图片搜索主机（`www.bing.com` 在本机会 302 过来，直接写它少一跳） */
export const BING_IMAGE_HOST = 'cn.bing.com';

/**
 * 各类型的**搜索词后缀**（用户裁定「标题 + 类型词」）。
 * ⚠️ 游戏的 `cover` 用英文：中文「封面」在必应上会把「封面设计 / 封面图」这类无关结果也拉进来。
 * ⚠️ 书籍按 `bookKind` 再细分（漫画 / 网文），见 `buildPosterQuery`。
 */
export const POSTER_QUERY_SUFFIX: Record<EntryType, string> = {
    movie: ' 海报',
    tv: ' 海报',
    anime: ' 海报',
    book: ' 封面',
    game: ' cover',
    music: ' 专辑封面',
};

/** 书籍子分类的后缀覆盖（未列出的 `book` 用表里的默认值） */
const BOOK_QUERY_SUFFIX: Partial<Record<BookKind, string>> = {
    comic: ' 漫画封面',
    novel: ' 小说封面',
};

/**
 * 把标题拼成搜索词（用户裁定：**标题 + 类型词**）。
 * 🔴 **刻意不缀作者/歌手**：实测「书名 + 作者」会把**作者照片**一起搜出来（尤其人物传记），
 *    而「作者在不在词里」这件事用户随时可以在候选弹窗的关键词框里自己加 —— 默认值该是**最不容易跑偏**的那个。
 * 标题为空 ⇒ 返回 `''`（调用方据此提示「先填标题」，⛔ 别拿类型词单独去搜）。
 */
export function buildPosterQuery(title: string, type: EntryType, bookKind?: BookKind): string {
    const t = String(title ?? '').trim();
    if (!t) return '';
    const suffix = (type === 'book' && bookKind ? BOOK_QUERY_SUFFIX[bookKind] : undefined) ?? POSTER_QUERY_SUFFIX[type] ?? '';
    return `${t}${suffix}`.trim();
}

/**
 * 必应图片搜索地址。分页：`first = (page-1) * 35 + 1`（实测口径；⛔ 别自己发明 `offset`）。
 * ⚠️ 关键词走 `encodeURIComponent`（中文/空格/`&` 都得编码，否则 `&` 会把后面那段变成新参数）。
 */
export function buildBingImageUrl(query: string, page: number = 1): string {
    const q = encodeURIComponent(String(query ?? '').trim());
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const first = (p - 1) * BING_PAGE_SIZE + 1;
    return `https://${BING_IMAGE_HOST}/images/async?q=${q}&first=${first}&count=${BING_PAGE_SIZE}&mmasync=1`;
}

/** 一条候选封面图 */
export interface PosterCandidate {
    /** **原图**地址（下载时用它；不是缩略图） */
    murl: string;
    /** 缩略图（列表里显示；掉图时按 `posterThumbChain` 逐级回退） */
    turl: string;
    /** 图片标题（来源页标题，帮用户判断这张是不是他要的） */
    title: string;
    /** 来源页地址（下载时作 `Referer` —— 不少图站按 Referer 防盗链） */
    page: string;
    /** 来源域名（列表里显示；判断可信度用） */
    domain: string;
}

/** 取 URL 的主机名（解析失败 / 非法 ⇒ `''`） */
function hostOf(url: string): string {
    const s = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try {
        return new URL(s).hostname;
    } catch {
        return '';
    }
}

/**
 * 解析必应图片搜索的 HTML（`async` 端点返回的就是一堆 `iusc` 卡片）。
 *
 * 🔴 解析口径三条：
 *  ⑴ 病灶是 **`m` 属性**：`m="{&quot;murl&quot;:&quot;…&quot;}"` ——
 *     ⚠️ 属性值里**不含裸双引号**（都被实体化了）⇒ 用 `[^"]*` 卡住**自己这一段**，
 *     ⛔ 别用 `[\s\S]*?` 之类的宽松量词：某条畸形数据会一路吞掉后面几十条。
 *  ⑵ **先还原实体再 `JSON.parse`**（`&amp;` 最后换，见 `pure/htmlText`）。
 *     ⚠️ 逐条 `try/catch`：一条坏数据不该让整页结果都拿不到。
 *  ⑶ **按 `murl` 去重**（必应同一张图会重复出现），保序（先出现的赢）。
 */
export function parseBingImages(html: string): PosterCandidate[] {
    const src = String(html ?? '');
    const out: PosterCandidate[] = [];
    const seen = new Set<string>();
    const re = /m="(\{[^"]*\})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        let raw: Record<string, unknown>;
        try {
            raw = JSON.parse(decodeHtmlEntities(m[1])) as Record<string, unknown>;
        } catch {
            continue; // 单条坏数据：跳过，不影响其余
        }
        const murl = String(raw.murl ?? '').trim();
        if (!/^https?:\/\//i.test(murl)) continue;
        const key = murl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const page = String(raw.purl ?? '').trim();
        const turl = String(raw.turl ?? '').trim();
        out.push({
            murl,
            turl,
            title: String(raw.t ?? '').trim(),
            page,
            domain: hostOf(page) || hostOf(murl),
        });
    }
    return out;
}

/**
 * 缩略图的**逐级回退链**（列表里 `<img>` 的 `on:error` 依次换下一个，全用完 ⇒ 占位块）。
 *
 * 🔴 实测（2026-10-03）：同一张 `OIP.25SQhm4X…` ——
 *    `ts1.mm.bing.net` **连不上**（curl 35 / 000），`tse1.mm.bing.net` **200 / 93KB**。
 *    主机名前缀 `ts1~ts4` 是必应的分片，本机到某个分片不通时整页缩略图会**集体变灰**，
 *    而页面**一个错都不会报**（本仓 #496 的 B站防盗链同族）。
 * ⚠️ 只做**同源换主机**这一种回退：⛔ 别去拼 `th.bing.com/th/id/…` ——
 *    那个地址是 301 跳转，`<img>` 能不能跟、跳完还认不认 `pid` 都没实测过，凭空多一条没验证的路径。
 */
export function posterThumbChain(turl: string): string[] {
    const s = String(turl ?? '').trim();
    if (!s) return [];
    const m = s.match(/^(https?:\/\/)ts\d*\.mm\.bing\.net(\/.*)$/i);
    if (!m) return [s];
    return [s, `${m[1]}tse1.mm.bing.net${m[2]}`];
}

/**
 * 下载原图时该带的 `Referer`（来源页的 origin）。空 / 解析失败 ⇒ `''`（调用方就不带这个头）。
 * 🔴 为什么带**来源站自己**的 referer：很多图片站按 Referer 防盗链，
 *    带**自己站**的 referer 才是「看起来像正常浏览」的那种请求；⛔ 别带 bing 的（对方会认出来）。
 */
export function posterReferer(page: string): string {
    const host = hostOf(page);
    return host ? `https://${host}/` : '';
}

/** 候选列表的展示用域名（拿不到就写「未知来源」，⛔ 别留空 —— 空着看起来像渲染坏了） */
export function posterDomainLabel(c: Pick<PosterCandidate, 'domain'>): string {
    return String(c?.domain ?? '').trim() || '未知来源';
}

/**
 * 候选图适合当封面吗 —— 只拦**明显不是封面**的那些（透明底 PNG 也算合格：很多海报就是 PNG）。
 * 🔴 刻意**不按尺寸/比例筛**：这条链路拿不到宽高（实测 `m` 里没有 `mw`/`mh`），
 *    而为了「筛一下」去把 35 张图逐张下载探测，代价与等待都比收益大得多。
 * ⛔ 所以本函数只做一件事：把**非图片后缀**（`.svg` 图标、被当成图片索引的 `.html`）挡掉。
 */
export function isLikelyPosterImage(c: Pick<PosterCandidate, 'murl'>): boolean {
    const path = String(c?.murl ?? '').split(/[?#]/)[0].toLowerCase();
    return !/\.(svg|gif|html?|php|js)$/.test(path);
}

/** 过滤出可用候选（去重已在 `parseBingImages` 做过，这里只挡明显非封面的） */
export function usablePosterCandidates(list: readonly PosterCandidate[]): PosterCandidate[] {
    return (list ?? []).filter(isLikelyPosterImage);
}
