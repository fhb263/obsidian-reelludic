// 豆瓣兜底抓取（反爬不稳定，需 Cookie）
// 获取方式参考 obsidian-douban（wanxp/obsidian-douban）：
//   - 搜索：GET https://www.douban.com/j/search?q={q}&cat={类型}（JSON，items 为 HTML 片段）
//   - 详情：{类型子域}.douban.com/subject/{id}/ 页面 → 解析 <script type="application/ld+json">（Schema.org JSON-LD）
//   - 安全验证：sec.douban.com proof-of-work（SHA-512 PoW，参考 obsidian-douban DoubanChallengeUtil）
// 支持类型：movie/tv/anime（cat=1002, movie.douban.com）、book（cat=1001, book.douban.com）、game（cat=3114, game.douban.com）
// 纯逻辑：HTTP 注入可 mock
import type { TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult } from 'services/resultTypes';
import type { BangumiSearchResult } from 'services/bangumi';
import type { EntryType } from 'data/types';
import { asRecord } from 'pure/record';

export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>;
export type HttpPost = (url: string, body: string, headers?: Record<string, string>) => Promise<string>;

const SEARCH_URL = 'https://www.douban.com/j/search';
const CHALLENGE_VERIFY_URL = 'https://sec.douban.com/c';

/** 豆瓣各类型的搜索 cat 与详情子域 */
export const DOUBAN_CAT: Record<EntryType, number> = { movie: 1002, tv: 1002, anime: 1002, book: 1001, game: 3114, music: 1003 };
export const DOUBAN_DOMAIN: Record<EntryType, string> = {
    movie: 'movie.douban.com',
    tv: 'movie.douban.com',
    anime: 'movie.douban.com',
    book: 'book.douban.com',
    game: 'game.douban.com',
    music: 'music.douban.com',
};

/** 浏览器 UA：豆瓣反爬对 UA/Referer 敏感 */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 浏览器特征头（参考 obsidian-douban DEFAULT_DOUBAN_HEADERS）：缺这些即使有 Cookie 也可能被拦 */
function browserHeaders(): Record<string, string> {
    return {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
        Referer: 'https://www.douban.com/',
    };
}

/** 豆瓣条目通用结构（搜索字段 + 详情页 JSON-LD / #info 区补全字段）
 *  字段对齐豆瓣详情模板：电影/电视剧（导演/编剧/主演/国家/语言/片长/又名/集数）、
 *  书籍（作者/译者/出版社/出品方/ISBN/页数/装帧/定价/丛书/作者简介/目录）、游戏（开发商/发行商/平台） */
export interface DoubanSubject {
    id: string;
    title: string;
    originalTitle?: string;
    year?: number;
    rating?: number;
    /** 豆瓣评价人数（搜索 items (N人评价) / 详情 JSON-LD ratingCount） */
    ratingCount?: number;
    cover?: string;
    summary?: string;
    director?: string;
    /** 编剧（影视） */
    screenwriter?: string[];
    cast: string[];
    author?: string;
    /** 所属专辑（音乐，JSON-LD inAlbum/album 或 #info 专辑） */
    album?: string;
    /** 译者（书籍） */
    translator?: string;
    /** 书籍出版社 / 游戏发行商（详情 #info 发行商 → publisher） */
    publisher?: string;
    /** 出品方（书籍） */
    producer?: string;
    isbn?: string;
    /** 装帧（书籍） */
    binding?: string;
    /** 定价（书籍） */
    price?: string;
    /** 丛书（书籍） */
    series?: string;
    /** 页数（书籍） */
    pageCount?: number;
    /** 作者简介（书籍详情页 related_info） */
    authorIntro?: string;
    /** 目录（书籍详情页 related_info） */
    toc?: string;
    /** 制片国家/地区 */
    country?: string;
    /** 语言 */
    language?: string;
    /** 片长（分钟） */
    durationMin?: number;
    /** 又名 */
    aliases?: string[];
    /** 集数（电视剧） */
    episodeCount?: number;
    platform?: string;
    developer?: string;
    genres: string[];
}

/** 提取 og:image 内容（fetchDetail 封面兜底：JSON-LD 无 image、且 og meta 缺 title/id 门槛时也能拿到详情页大图） */
function ogImageOf(html: string): string | undefined {
    const a = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/.exec(html);
    const b = /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["']/.exec(html);
    return a?.[1] ?? b?.[1];
}

/** 过滤对象中值为 undefined 的字段（详情合并用：JSON-LD/og 的缺字段不覆盖搜索级已有值） */
function definedFields<T extends Record<string, unknown>>(o: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
        if (v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
}

/**
 * 豆瓣图床封面 URL 高清化（2026-09-09 用户反馈：游戏封面模糊——搜索列表 <img src> 给的是
 * doubanio 缩略档（spic ≈ 70×94 / s_ratio_poster ≈ 100×140），原样下载落库即糊）。
 * 豆瓣图片同 ID 可按档位取图：spic/mpic → lpic（老式图床）、s_ratio_poster/m → l / l_ratio_poster（view/photo 图床）。
 * 规则：仅对 doubanio.com 图床 URL 做档位提升（缩略段 → 高清段），幂等（已是高清段/非豆瓣图床原样返回）。
 */
export function upscaleDoubanCover(u: string | undefined): string | undefined {
    if (!u || !/doubanio\.com/.test(u)) return u;
    return u
        // 老式图床：/spic/ 或 /mpic/ → /lpic/
        .replace(/\/spic\//, '/lpic/')
        .replace(/\/mpic\//, '/lpic/')
        // view/photo 图床：s_ratio_poster → l_ratio_poster（竖版海报大图）
        .replace(/\/s_ratio_poster\//, '/l_ratio_poster/')
        // view/photo 图床：/m/ → /l/（同目录下大图）
        .replace(/\/view\/photo\/m\//, '/view/photo/l/')
        // view/photo 图床：/s/ → /l/（同目录下大图）
        .replace(/\/view\/photo\/s\//, '/view/photo/l/');
}

/** 豆瓣评分提取（多结构兜底）：v:average 元素（<strong property="v:average">7.9</strong>）、
 *  meta property="v:average" content、rating_num 类（<span class="rating_num">7.5</span>） */
function extractRating(html: string): number | undefined {
    const vAvg = /v:average[^>]*>([\d.]+)/.exec(html)
        || /<meta[^>]*property=["']v:average["'][^>]*content=["']([\d.]+)["']/.exec(html)
        || /<meta[^>]*content=["']([\d.]+)["'][^>]*property=["']v:average["']/.exec(html);
    if (vAvg) return Number(vAvg[1]);
    const ratingNum = /rating_num[^>]*>([\d.]+)/.exec(html);
    return ratingNum ? Number(ratingNum[1]) : undefined;
}

// ── 豆瓣反爬防护（参考 obsidian-douban DoubanPageGuard + LoginUtil）──
export type DoubanPageProblem = 'access-denied' | 'login-required' | null;

/** Cookie 失效/风控专用错误（v0.5）：登录跳转/禁止访问/安全验证失败/接口异常均属 Cookie 问题，
 *  main 层据此向用户明确提示「Cookie 已失效」而非笼统「豆瓣不可用」。 */
export class DoubanCookieError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DoubanCookieError';
    }
}

/** 检测豆瓣返回 HTTP 200 但并非目标内容的拦截页，避免被解析成空结果/空笔记：
 *  - access-denied：<title>禁止访问</title> 或「你要的东西不在这, 到别处看看吧。」
 *  - login-required：<title>豆瓣 - 登录跳转页</title> 或 accounts.douban.com/passport/login 跳转链接 */
export function detectDoubanPageProblem(html: string): DoubanPageProblem {
    const page = String(html || '');
    if (!page) return null;
    if (/<title[^>]*>\s*禁止访问\s*<\/title>/i.test(page)) return 'access-denied';
    if (/<title[^>]*>\s*豆瓣\s*-\s*登录跳转页\s*<\/title>/i.test(page)) return 'login-required';
    if (/accounts\.douban\.com\/passport\/login[^"'<>\s]*redir=/i.test(page)) return 'login-required';
    if (page.indexOf('你要的东西不在这') >= 0) return 'access-denied';
    return null;
}

// ── 豆瓣安全验证（proof-of-work，参考 obsidian-douban DoubanChallengeUtil）──
export interface DoubanChallenge {
    token: string;
    challenge: string;
    redirectUrl: string;
    difficulty: number;
}

/** 解析 sec.douban.com 的验证表单（form#sec[action="/c"]：tok/cha/red + difficulty） */
export function parseChallenge(html: string): DoubanChallenge | null {
    if (!html || html.indexOf('name="cha"') < 0 || html.indexOf('name="sol"') < 0) return null;
    const formM = /<form[^>]*id="sec"[^>]*action="\/c"[^>]*>([\s\S]*?)<\/form>/.exec(html);
    if (!formM) return null;
    const tok = /name="tok"[^>]*value="([^"]*)"/.exec(formM[1]);
    const cha = /name="cha"[^>]*value="([^"]*)"/.exec(formM[1]);
    const red = /name="red"[^>]*value="([^"]*)"/.exec(formM[1]);
    if (!tok || !cha || !red) return null;
    const diffM = /difficulty\s*=\s*(\d+)/.exec(html);
    const diff = diffM ? Number(diffM[1]) : 4;
    return {
        token: tok[1],
        challenge: cha[1],
        redirectUrl: red[1],
        difficulty: Number.isInteger(diff) && diff > 0 && diff <= 6 ? diff : 4,
    };
}

async function sha512Hex(value: string): Promise<string> {
    // Node 桌面端优先用内置 crypto（同步、快 10~100 倍，参考 obsidian-douban DoubanChallengeUtil.sha512）；
    // 移动端无 Node 环境，require 抛错后回退 Web Crypto（异步、慢，但可用）
    try {
        const nodeCrypto = require('crypto') as { createHash(alg: string): { update(s: string): { digest(enc: 'hex'): string } } };
        return nodeCrypto.createHash('sha512').update(value).digest('hex');
    } catch {
        const bytes = new TextEncoder().encode(value);
        const digest = await crypto.subtle.digest('SHA-512', bytes);
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
}

/** PoW：找 nonce 使 sha512(challenge+nonce) 以 difficulty 个 0 开头 */
export async function solveChallenge(c: DoubanChallenge): Promise<number> {
    const prefix = '0'.repeat(c.difficulty);
    for (let nonce = 1; nonce <= 5_000_000; nonce++) {
        if ((await sha512Hex(c.challenge + nonce)).startsWith(prefix)) return nonce;
    }
    throw new Error('豆瓣安全验证求解超时');
}

/** 构造验证 POST body（x-www-form-urlencoded） */
export function buildChallengeBody(c: DoubanChallenge, solution: number): string {
    const p = new URLSearchParams();
    p.set('tok', c.token);
    p.set('cha', c.challenge);
    p.set('sol', String(solution));
    p.set('red', c.redirectUrl);
    return p.toString();
}

/** 解析 j/search items 中的单个 li HTML 片段：id/标题（去 from span）/年份/封面/评分 */
export function parseDoubanItem(html: string): DoubanSubject | null {
    // id 提取：真实响应 href 为 link2 编码跳转（不含明文路径），明文 id 在 onclick 的 sid 字段；
    // 兼容旧式明文链接（subject/{id}/ 影视书籍动画、game/{id}/ 游戏）
    const sidM = /sid:\s*(\d+)/.exec(html);
    const pathM = /(?:subject|game)\/(\d+)\//.exec(html);
    const id = sidM ? sidM[1] : pathM?.[1];
    if (!id) return null;
    // 标题：取 h3 块内第一个 <a> 的文本；真实结构 h3 内带 <span>[电影]/[游戏]</span>&nbsp; 前缀
    const h3M = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(html);
    let title = '';
    if (h3M) {
        const aM = /<a[^>]*>([\s\S]*?)<\/a>/.exec(h3M[1]);
        const raw = aM ? aM[1] : h3M[1];
        title = raw
            .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/<[^>]+>/g, '')
            .trim();
    }
    if (!title) return null;
    // 类型前缀（h3 内 [电影]/[电视剧]/[动画]/[图书]/[音乐]/[游戏] 等）：from span 首段创作者归属 author（书籍/音乐）或 developer（游戏）
    const typeM = /<h3[^>]*>\s*<span>\[([^\]]+)\]<\/span>/.exec(html);
    // 附加信息行：`作者 / 出版社 / 年份`（书籍）、`歌手 / 年份`（音乐）、`开发商 / 年份`（游戏）、`年份 / 地区 / 类型`（影视）
    const fromM = /class="from">([^<]*)<\/span>/.exec(html);
    const fromStr = fromM?.[1]?.trim() ?? '';
    const yearM = /\d{4}/.exec(fromStr);
    // 首段（/ 分隔，空格不断段；去 [国籍] 前缀；· 是作者名一部分不可作分隔符）：非纯年份、非「流派：」类键值 → 创作者（书籍/音乐作者、游戏开发商）
    const head = fromStr.split('/')[0].replace(/^\[[^\]]*\]\s*/, '').trim();
    const creator = head && !/^\d{4}$/.test(head) && !/[:：]/.test(head) ? head : undefined;
    const imgM = /<img[^>]*src="([^"]+)"/.exec(html);
    // 豆瓣搜索结果 img src 形态多样：完整 URL `https://img2.doubanio.com/...`、协议相对 `//img2.doubanio.com/...`、站内相对 `/s/pics/...`
    // 统一拼接为 https 绝对 URL，保证 Obsidian Electron 下能正确加载（断链图占位问题根因）
    const normalizeDoubanCover = (u: string | undefined): string | undefined => {
        if (!u) return u;
        if (u.startsWith('//')) return 'https:' + u;
        if (u.startsWith('/')) return 'https://img9.doubanio.com' + u;
        if (u.startsWith('http://')) return 'https://' + u.slice(7);
        return u;
    };
    const ratingM = /rating_nums">([\d.]+)/.exec(html);
    // 评价人数：真实结构评分后带 <span>(2935822人评价)</span>（含千分位逗号）
    const ratingPeopleM = /\(([\d,]+)\s*人评价\)/.exec(html);
    // 内容简介：rating-info 之后的 <p> 描述片段（图书/影视/游戏搜索 items 均带，前 3 条详情补全前即可回填表单与笔记）
    const descM = /rating-info[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
    const out: DoubanSubject = {
        id,
        title,
        year: yearM?.[0] ? Number(yearM[0]) : undefined,
        rating: ratingM?.[1] ? Number(ratingM[1]) : undefined,
        ratingCount: ratingPeopleM?.[1] ? Number(ratingPeopleM[1].replace(/,/g, '')) : undefined,
        cover: upscaleDoubanCover(normalizeDoubanCover(imgM?.[1])),
        summary: descM?.[1]?.replace(/<[^>]+>/g, '').trim(),
        cast: [],
        genres: [],
    };
    if (creator) {
        if (typeM?.[1] === '游戏') out.developer = creator;
        else out.author = creator;
    }
    return out;
}

/** 解析 j/search 响应 JSON：items 数组（HTML 片段）→ DoubanSubject[]（截断 30 与其他源对齐） */
export function parseDoubanSearchItems(text: string): DoubanSubject[] {
    const data = asRecord(JSON.parse(text));
    const items = Array.isArray(data.items) ? data.items.filter((i): i is string => typeof i === 'string') : [];
    return items.slice(0, 30).map(parseDoubanItem).filter((r): r is DoubanSubject => r !== null);
}

/** 提取详情页 <script type="application/ld+json"> 并解析 */
export function extractJsonLd(html: string): Record<string, unknown> | null {
    const m = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    try {
        const obj = JSON.parse(m[1].trim().replace(/[\r\n\t]+/g, ' '));
        return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function personNames(v: unknown): string[] {
    if (Array.isArray(v)) {
        return v.map(asRecord).filter((p) => typeof p.name === 'string').map((p) => p.name as string);
    }
    const o = asRecord(v);
    return typeof o.name === 'string' ? [o.name] : [];
}

function organizationName(v: unknown): string | undefined {
    const o = asRecord(v);
    return typeof o.name === 'string' ? o.name : undefined;
}

/** 解析 ISO8601 时长（PT2H36M → 156 分钟）；无法解析返回 undefined */
export function isoDurationToMin(s: string): number | undefined {
    const h = /(\d+)H/.exec(s);
    const m = /(\d+)M/.exec(s);
    if (!h && !m) return undefined;
    return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

/** 提取详情页按标题定位的小节内容（作者简介/目录等）：先删 style 块，取标题后第一个
 *  <div class="indent"> 容器文本（剥标签、去空白、去「展开全部」尾巴）；无标题/无容器返回 undefined */
export function extractDoubanSection(html: string, heading: string): string | undefined {
    const idx = html.indexOf(heading);
    if (idx < 0) return undefined;
    const tail = html.slice(idx).replace(/<style[\s\S]*?<\/style>/g, '');
    const indent = /<div class="indent"[^>]*>([\s\S]*?)<\/div>/.exec(tail);
    if (!indent) return undefined;
    const text = indent[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .replace(/展开\s*全部|收起/g, '')
        .trim();
    return text || undefined;
}

/** 从 JSON-LD 按类型提取详情字段（标题/评分/简介 + 类型化字段：影视导演编剧主演、书籍作者出版社、游戏开发商平台） */
export function parseDoubanJsonLd(html: string, type: EntryType): Partial<DoubanSubject> | null {
    const d = extractJsonLd(html);
    if (!d || typeof d.name !== 'string') return null;
    const nameParts = d.name.split('/').map((s) => s.trim()).filter(Boolean);
    const rating = asRecord(d.aggregateRating);
    const ratingValue = typeof rating.ratingValue === 'string' ? Number(rating.ratingValue) : undefined;
    // 评价人数：aggregateRating.ratingCount / reviewCount（字符串数字）
    const ratingRaw = typeof rating.ratingCount === 'string' ? rating.ratingCount : (typeof rating.reviewCount === 'string' ? rating.reviewCount : undefined);
    const ratingCount = ratingRaw ? Number(ratingRaw.replace(/,/g, '')) : undefined;
    const published = typeof d.datePublished === 'string' ? d.datePublished : undefined;
    const duration = typeof d.duration === 'string' ? isoDurationToMin(d.duration) : undefined;
    const out: Partial<DoubanSubject> = {
        title: nameParts[0] ?? d.name,
        originalTitle: nameParts[1],
        rating: ratingValue && !Number.isNaN(ratingValue) ? ratingValue : undefined,
        ratingCount: ratingCount && !Number.isNaN(ratingCount) ? ratingCount : undefined,
        summary: typeof d.description === 'string' ? d.description.replace(/<[^>]+>/g, '').trim() : undefined,
        durationMin: duration,
        // 上映日期（datePublished）无年份时兜底取出版年份
        year: published ? (/\d{4}/.exec(published)?.[0] ? Number(/\d{4}/.exec(published)![0]) : undefined) : undefined,
    };
    if (type === 'book') {
        // 书籍 JSON-LD：author=作者、isbn、publisher
        const author = organizationName(d.author) ?? personNames(d.author)[0];
        if (author) out.author = author;
        const pub = organizationName(d.publisher);
        if (pub) out.publisher = pub;
        if (typeof d.isbn === 'string') out.isbn = d.isbn;
    } else if (type === 'game') {
        const dev = organizationName(d.publisher);
        if (dev) out.developer = dev;
        if (Array.isArray(d.genre)) out.genres = d.genre.filter((g): g is string => typeof g === 'string');
    } else if (type === 'music') {
        // 音乐 JSON-LD（MusicAlbum/MusicRecording）：byArtist=歌手、inAlbum/album=专辑
        const artist = personNames(d.byArtist)[0] ?? organizationName(d.byArtist);
        if (artist) out.author = artist;
        const album = organizationName(d.inAlbum) ?? organizationName(d.album);
        if (album) out.album = album;
    } else {
        // 影视/动画：导演 + 编剧（JSON-LD author=编剧）+ 主演
        const director = personNames(d.director)[0];
        if (director) out.director = director;
        const writers = personNames(d.author);
        if (writers.length) out.screenwriter = writers;
        const cast = personNames(d.actor);
        if (cast.length) out.cast = cast;
    }
    return out;
}

/** og meta 兜底（反爬页/JSON-LD 缺失时）：og:title/image/url/description + v:average 评分。
 *  参考 obsidian-douban DoubanMovieLoadHandler 的 JSON-LD 失败回退路径。 */
export function parseDoubanOgMeta(html: string): Partial<DoubanSubject> | null {
    const pickMeta = (prop: string): string | undefined => {
        const a = new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']*)["']`).exec(html);
        const b = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${prop}["']`).exec(html);
        return (a || b)?.[1];
    };
    const title = pickMeta('og:title');
    const urlMeta = pickMeta('og:url');
    const image = pickMeta('og:image');
    const desc = pickMeta('og:description');
    const id = urlMeta ? /\d{5,10}/.exec(urlMeta)?.[0] : undefined;
    if (!title && !id) return null;
    const scoreM = extractRating(html);
    return {
        id: id ?? '',
        title: title ?? '',
        cover: upscaleDoubanCover(image),
        summary: desc,
        rating: scoreM,
    };
}

/** 提取详情页 #info 区，返回「标签 → 值」映射（键为豆瓣页面原文标签，如 导演/编剧/出版社/ISBN） */
export function parseDoubanInfo(html: string): Record<string, string> {
    const m = /<div id="info"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    const block = m ? m[1] : '';
    const out: Record<string, string> = {};
    // 每个字段形如 <span class="pl">标签</span>: 值（值到 <br/> 或块尾结束）。
    // ⚠️ 值内部可能含 <span property="v:genre">剧情</span>（类型字段每个类型一个 span）：
    //    不能用 </span> 作终止符（会截断成第一个类型），只以 <br> 或块尾终止，再统一剥标签。
    const re = /<span[^>]*class="pl"[^>]*>([\s\S]*?)<\/span>\s*:?\s*([\s\S]*?)(?=<br\s*\/?>|$)/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(block)) !== null) {
        // 标签可能带前导空格（" 作者"）或尾冒号（"出版社:"，冒号在 span 内）——统一清理
        let label = mm[1]
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/:$/, '');
        // ⚠️ 兼容「标签: 值」混排：真实音乐页把值也塞进 span 内（<span class="pl">表演者: <a>beyond</a></span>），
        //    按第一个冒号拆分——冒号后内容并入值（如「表演者: beyond」→ label=表演者, inlineVal=beyond）
        let inlineVal = '';
        const ci = label.indexOf(':');
        if (ci > 0) {
            inlineVal = label.slice(ci + 1).trim();
            label = label.slice(0, ci).trim();
        }
        if (!label) continue;
        const raw = ((inlineVal ? inlineVal + ' ' : '') + mm[2])
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
        if (raw) out[label] = raw;
    }
    return out;
}

/** 名单字段按 / 分隔（导演/编剧/主演/类型/又名），日期/语言等字段保持原样 */
function splitList(s: string): string[] {
    return s.split('/').map((x) => x.trim()).filter(Boolean);
}

/** 解析 <dl class="thing-attr"> 的 dt/dd 键值对（游戏详情页专用） */
function parseThingAttr(html: string): Record<string, string> {
    const m = /<dl[^>]*class="thing-attr"[^>]*>([\s\S]*?)<\/dl>/.exec(html);
    const block = m ? m[1] : '';
    const out: Record<string, string> = {};
    // 每个字段形如 <dt>标签</dt><dd>值</dd>，值到下一个 <dt> 或 </dl> 结束
    const re = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)(?=<dt[^>]*>|<\/dl>|$)/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(block)) !== null) {
        const label = mm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
        const raw = mm[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        if (label && raw) out[label] = raw;
    }
    return out;
}

/** 游戏详情页解析（豆瓣游戏页无 JSON-LD，参考 obsidian-douban DoubanGameLoadHandler）：
 *  #content > h1 标题 + meta[name=mobile-agent] 取 id + dl.thing-attr 取 平台/类型/别名/开发商/发行商/发行日期 */
export function parseDoubanGameDetail(html: string): Partial<DoubanSubject> | null {
    const mobile = /<meta[^>]*name=["']mobile-agent["'][^>]*content=["']([^"']*)["']/.exec(html)
        || /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']mobile-agent["']/.exec(html);
    const id = mobile ? /\d{5,10}/.exec(mobile[1])?.[0] : undefined;
    const titleM = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : undefined;
    if (!id && !title) return null;
    const info = parseThingAttr(html);
    const scoreM = extractRating(html);
    // 封面：仅取 .item-subject-info 容器内的图片（真实页面全页第一个 <img> 是站内导航 new_menu.gif，
    // 直接全页正则会误取 74B 占位图标，导致封面下载成菜单 GIF）——限定容器范围，取不到则留空由 fetchDetail 保留搜索级封面
    const coverM = /class="item-subject-info"[\s\S]*?<img[^>]*src="([^"]+)"/.exec(html);
    const descM = /id="link-report"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(html);
    const pubYear = info['发行日期'] ? /\d{4}/.exec(info['发行日期'])?.[0] : undefined;
    return {
        id: id ?? '',
        title: title ?? '',
        platform: info['平台'],
        developer: info['开发商'],
        publisher: info['发行商'],
        genres: info['类型'] ? splitList(info['类型']) : [],
        aliases: info['别名'] ? splitList(info['别名']) : [],
        year: pubYear ? Number(pubYear) : undefined,
        cover: upscaleDoubanCover(coverM?.[1]),
        summary: descM?.[1]?.replace(/<[^>]+>/g, '').trim(),
        rating: scoreM,
    };
}

/** 按类型把 #info 映射到 DoubanSubject（集数→episodeCount，页数→pageCount，片长→durationMin，出版年→year） */
export function applyDoubanInfo(s: DoubanSubject, type: EntryType, info: Record<string, string>): DoubanSubject {
    if (Object.keys(info).length === 0) return s;
    const pick = (label: string): string | undefined => info[label];
    const pickList = (label: string): string[] | undefined => {
        const v = info[label];
        return v ? splitList(v) : undefined;
    };
    const out: Partial<DoubanSubject> = {};
    if (type === 'book') {
        // 书籍：#info 是主要来源（JSON-LD 只有作者/ISBN）
        if (pick('作者')) out.author = pick('作者');
        if (pick('译者')) out.translator = pick('译者');
        if (pick('出版社')) out.publisher = pick('出版社');
        if (pick('出品方')) out.producer = pick('出品方');
        if (pick('ISBN')) out.isbn = pick('ISBN');
        if (pick('装帧')) out.binding = pick('装帧');
        if (pick('定价')) out.price = pick('定价');
        if (pick('丛书')) out.series = pick('丛书');
        const pages = pick('页数');
        if (pages && /^\d+$/.test(pages)) out.pageCount = Number(pages);
        const pubYear = pick('出版年');
        if (pubYear && !s.year) {
            const y = /\d{4}/.exec(pubYear);
            if (y) out.year = Number(y[0]);
        }
    } else if (type === 'game') {
        // 游戏：#info 可能不存在（SPA 页面），尽力提取
        if (pick('开发商')) out.developer = pick('开发商');
        if (pick('平台')) out.platform = pick('平台');
    } else if (type === 'music') {
        // 音乐：#info 表演者 → author（JSON-LD 缺失时兜底）
        if (pick('表演者')) out.author = pick('表演者');
        if (pick('专辑')) out.album = pick('专辑');
        // 发行时间（如 1993-05-14 / 1993-05 / 1993）→ year；JSON-LD datePublished 已给时不覆盖
        const rel = pick('发行时间');
        if (rel && !s.year) {
            const y = /\d{4}/.exec(rel);
            if (y) out.year = Number(y[0]);
        }
        // 流派 → genres（表单题材手动填写兜底 + 海报墙题材行）
        const genres = pickList('流派');
        if (genres?.length) out.genres = genres;
    } else {
        // 影视/动画
        if (pick('导演')) out.director = pick('导演');
        const writers = pickList('编剧');
        if (writers?.length) out.screenwriter = writers;
        const cast = pickList('主演');
        if (cast?.length) out.cast = cast;
        const genres = pickList('类型');
        if (genres?.length) out.genres = genres;
        if (pick('制片国家/地区')) out.country = pick('制片国家/地区');
        if (pick('语言')) out.language = pick('语言');
        const dur = pick('片长');
        if (dur) {
            const dm = /(\d+)\s*分钟/.exec(dur);
            if (dm) out.durationMin = Number(dm[1]);
        }
        const aliases = pickList('又名');
        if (aliases?.length) out.aliases = aliases;
        const ep = pick('集数');
        if (ep && /^\d+$/.test(ep)) out.episodeCount = Number(ep);
    }
    return { ...s, ...out };
}

/** 类型化结果转换（保持与主数据源一致，EntryForm 无需感知豆瓣） */
export function toTmdbResult(s: DoubanSubject): TmdbSearchResult {
    return {
        id: Number(s.id) || 0,
        title: s.title,
        originalTitle: s.originalTitle ?? s.title,
        year: s.year,
        mediaType: 'movie',
        posterPath: s.cover,
        overview: s.summary,
        director: s.director,
        screenwriter: s.screenwriter,
        cast: s.cast,
        genres: s.genres,
        country: s.country,
        language: s.language,
        durationMin: s.durationMin,
        aliases: s.aliases,
        episodeCount: s.episodeCount,
        rating: s.rating,
        ratingCount: s.ratingCount,
        source: 'douban',
    };
}

export function toBookResult(s: DoubanSubject): BookSearchResult {
    return {
        id: `douban:${s.id}`,
        title: s.title,
        author: s.author,
        translator: s.translator,
        publisher: s.publisher,
        producer: s.producer,
        isbn: s.isbn,
        binding: s.binding,
        price: s.price,
        series: s.series,
        pageCount: s.pageCount,
        year: s.year,
        thumbnail: s.cover,
        description: s.summary,
        rating: s.rating,
        ratingCount: s.ratingCount,
        authorIntro: s.authorIntro,
        toc: s.toc,
        genres: s.genres,
        source: 'douban',
    };
}

export function toGameResult(s: DoubanSubject): GameSearchResult {
    return {
        id: Number(s.id) || 0,
        title: s.title,
        platform: s.platform,
        developer: s.developer,
        publisher: s.publisher,
        year: s.year,
        cover: s.cover,
        summary: s.summary,
        genres: s.genres,
        rating: s.rating,
        ratingCount: s.ratingCount,
        source: 'douban',
    };
}

export function toBangumiResult(s: DoubanSubject): BangumiSearchResult {
    return {
        id: Number(s.id) || 0,
        title: s.title,
        originalTitle: s.originalTitle ?? s.title,
        year: s.year,
        genres: s.genres,
        studio: s.developer,
        cover: s.cover,
        summary: s.summary,
        rating: s.rating,
        ratingCount: s.ratingCount,
        source: 'douban',
    };
}

export function toMusicResult(s: DoubanSubject): MusicSearchResult {
    return {
        id: `douban:${s.id}`,
        title: s.title,
        artist: s.author,
        album: s.album,
        year: s.year,
        cover: s.cover,
        summary: s.summary,
        rating: s.rating,
        ratingCount: s.ratingCount,
        source: 'douban',
        sourceUrl: `https://music.douban.com/subject/${s.id}/`,
    };
}

/** 豆瓣详情 → 表单回填字段投影（main.fetchDoubanDetailForEntry 用）。
 *  字段白名单必须覆盖表单可回填的全部字段——漏列会导致对应字段选中结果时无法回填
 *  （回归：游戏 platform/developer 曾漏透传，游戏条目豆瓣回填全空）。 */
export function toEntryDetailFields(s: DoubanSubject): Record<string, unknown> {
    return {
        director: s.director,
        screenwriter: s.screenwriter,
        cast: s.cast,
        genres: s.genres,
        country: s.country,
        language: s.language,
        durationMin: s.durationMin,
        aliases: s.aliases,
        episodeCount: s.episodeCount,
        author: s.author,
        album: s.album,
        translator: s.translator,
        publisher: s.publisher,
        producer: s.producer,
        isbn: s.isbn,
        binding: s.binding,
        price: s.price,
        series: s.series,
        pageCount: s.pageCount,
        year: s.year,
        summary: s.summary,
        ratingCount: s.ratingCount,
        authorIntro: s.authorIntro,
        toc: s.toc,
        cover: s.cover,
        platform: s.platform,
        developer: s.developer,
    };
}

export class DoubanClient {
    readonly name = 'douban';

    constructor(
        private http: HttpGet,
        private httpPost: HttpPost,
        private cookie: string = '',
    ) {}

    /** 构造反爬头：完整浏览器特征 + （可选）用户 Cookie */
    private headers(): Record<string, string> {
        const h = browserHeaders();
        if (this.cookie) h.Cookie = this.cookie;
        return h;
    }

    /** 发起 GET 并自动处理豆瓣安全验证：检测 PoW 挑战 → 求解 → POST 验证 → 验证响应即结果。
     *  非挑战页时检测反爬拦截页（禁止访问/登录跳转），精确报错而非误判为「无结果」。 */
    private async request(url: string): Promise<string> {
        const text = await this.http(url, this.headers());
        const challenge = parseChallenge(text);
        if (!challenge) {
            const problem = detectDoubanPageProblem(text);
            if (problem === 'access-denied') throw new DoubanCookieError('Douban 拒绝访问（禁止访问页，Cookie 可能已失效或被风控，请重新登录获取）');
            if (problem === 'login-required') throw new DoubanCookieError('Douban 需要登录（登录跳转页，请配置含 dbcl2 的登录态 Cookie）');
            return text;
        }
        const solution = await solveChallenge(challenge);
        const verified = await this.httpPost(CHALLENGE_VERIFY_URL, buildChallengeBody(challenge, solution), {
            ...this.headers(),
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://sec.douban.com',
            Referer: 'https://sec.douban.com/',
        });
        if (parseChallenge(verified)) {
            throw new DoubanCookieError('Douban 安全验证未能完成（Cookie 可能已过期，请重新登录获取）');
        }
        return verified;
    }

    /** 严格解析搜索响应：必须为 JSON 且 items 为数组（403/挑战页/异常结构一律抛错，避免误判） */
    private parseSearch(text: string): DoubanSubject[] {
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Douban 返回非 JSON（可能被反爬拦截或触发安全验证）');
        }
        const obj = asRecord(data);
        if (!Array.isArray(obj.items)) {
            throw new DoubanCookieError('Douban 接口不可用（响应异常，Cookie 可能无效或过期）');
        }
        return (obj.items as unknown[])
            .filter((i): i is string => typeof i === 'string')
            .map(parseDoubanItem)
            .filter((r): r is DoubanSubject => r !== null);
    }

    /** 按类型搜索（cat 映射）；被反爬拦截/验证失败时抛错，由兜底层区分「拦截」与「无结果」 */
    async search(query: string, type: EntryType): Promise<DoubanSubject[]> {
        const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&cat=${DOUBAN_CAT[type]}`;
        return this.parseSearch(await this.request(url));
    }

    /** 抓详情页（同样自动过验证）并合并字段（任何失败都回退到搜索级字段，不向上抛） */
    async fetchDetail(subject: DoubanSubject, type: EntryType): Promise<DoubanSubject> {
        try {
            // 游戏详情路径为 www.douban.com/game/{id}/（game.douban.com/subject 已不可用）；其余为 {域}/subject/{id}/
            const url = type === 'game'
                ? `https://www.douban.com/game/${subject.id}/`
                : `https://${DOUBAN_DOMAIN[type]}/subject/${subject.id}/`;
            const html = await this.request(url);
            let merged = subject;
            if (type === 'game') {
                // 豆瓣游戏页无 JSON-LD，走 dl.thing-attr 专用解析
                const gameDetail = parseDoubanGameDetail(html);
                if (gameDetail) {
                    // 详情封面保护：仅当取到真实封面（非 /pics/ 站内导航/占位资源）时覆盖搜索级封面；
                    // 否则保留搜索级封面（搜索 items 的 spic 封面可信且可下载，避免占位图下载成空图）
                    const detailCover = gameDetail.cover && !/\/pics\//.test(gameDetail.cover) ? gameDetail.cover : undefined;
                    // 有值覆盖（definedFields）：详情页缺评分/评价人数时 undefined 不覆盖搜索级已有值
                    merged = {
                        ...merged,
                        ...definedFields(gameDetail),
                        cover: detailCover ?? merged.cover,
                        cast: merged.cast,
                        genres: gameDetail.genres?.length ? gameDetail.genres : merged.genres,
                    };
                }
            } else {
                // JSON-LD 为主，失败回退 og meta（反爬页/JSON-LD 缺失时仍有标题/封面/简介/评分）；
                // JSON-LD 成功但缺封面时单取 og:image 兜底（og:image 多为原图级高清，详情无 image 字段——旧条目回源高清化依赖它）
                const ld = parseDoubanJsonLd(html, type);
                const og = parseDoubanOgMeta(html);
                const detail = ld ? { ...ld, cover: upscaleDoubanCover(ld.cover ?? ogImageOf(html)) } : og;
                if (detail) {
                    // 详情合并：仅覆盖「有值」字段（definedFields）——JSON-LD 缺评分/评价人数时，
                    // undefined 不覆盖搜索级已有值（否则详情页无 aggregateRating 的书籍会丢评分与评价人数）
                    merged = {
                        ...merged,
                        ...definedFields(detail),
                        cast: detail.cast?.length ? detail.cast : merged.cast,
                        genres: detail.genres?.length ? detail.genres : merged.genres,
                    };
                }
                // #info 区补全（JSON-LD 没有的国家/语言/片长/译者/ISBN/装帧/定价等）
                merged = applyDoubanInfo(merged, type, parseDoubanInfo(html));
            }
            // 书籍作者简介/目录（related_info 小节；仅图书详情页存在，其他类型无标题不命中）
            const authorIntro = extractDoubanSection(html, '作者简介');
            if (authorIntro) merged.authorIntro = authorIntro;
            const toc = extractDoubanSection(html, '目录');
            if (toc) merged.toc = toc;
            return merged;
        } catch {
            return subject;
        }
    }

    /** 测试连接：严格校验（必须 JSON 且 items 数组，非此即判定不可用） */
    async testConnection(): Promise<void> {
        const text = await this.request(`${SEARCH_URL}?q=test&cat=1002`);
        this.parseSearch(text);
    }
}
