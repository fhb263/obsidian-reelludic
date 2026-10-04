// MangaDex（api.mangadex.org）漫画元数据抓取（v5 REST；纯逻辑：HTTP 注入可 mock）。
//
// 🔴 2026-09-30 用户裁定：「设置里漫画源接豆瓣、Bangumi、MangaDex 三个源」——本文件是 MangaDex 那一路。
//
// 🔴 接入前的**实测**（2026-09-30，别凭空假设）：
//    · `GET /manga?title=…` 通：HTTP 200 / 1.07s ⇒ **本机网络可达**（这点和 Bangumi 不一样，见下）；
//    · **中文关键词能命中** —— 它把中文别名索引进检索了：搜「海贼王」→ One Piece、「火影忍者」→ Naruto、
//      「进击的巨人」→ Attack on Titan（⚠️ 但「进击的巨人」首条是 Shingeki no **Eroko**-san 这种噪声，
//      所以合并排序仍走本仓的相似度重排，⛔ 别原样透传服务端顺序）；
//    · ⚠️ `attributes.title` 常常**只有日文罗马音**（实测 One Piece 的 title = `{'ja-ro': 'One Piece'}`，
//      **没有 en 键**）⇒ 展示标题必须多语言回退（`pickTitle`），只取 en 会得到空字符串。
//
// 🔴 官方 Acceptable Usage Policy（摘与本仓有关的三条，⛔ 别越线）：
//    · **必须带可标识的 User-Agent**（`MANGADEX_UA`）——不带给 403 / 被限流；
//    · **不得在带广告或付费的产品里用** —— 本插件是本地个人工具，符合；
//    · 若分发章节内容须署名 MangaDex 与汉化组 —— 本仓**只取元数据（标题/作者/年份/简介/封面）**，
//      ⛔ 不做章节图片（at-home）那一路，所以只承担「提及来源」这一项（设置页 hint 里已写明）。
//
// ⚠️ 限流：全局约 **5 req/s**（响应带 X-RateLimit-*）。本仓每轮搜索只打 1 次；点选补详情 1 次 —— 远低于上限。
import { asRecord } from 'pure/record';
import type { BookSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>;

const API_BASE = 'https://api.mangadex.org';
const COVER_BASE = 'https://uploads.mangadex.org';
const SITE_BASE = 'https://mangadex.org';

export const MANGADEX_SEARCH_LIMIT = 20;

/**
 * MangaDex 要求可标识的调用方 UA（官方 policy）——⛔ 别传空串、也别伪装浏览器。
 * ⚠️ 与豆瓣那条 `BROWSER_UA`（**必须**伪装成浏览器才给货）正好相反：这里是「如实标识」。
 */
// 🔴 版本段必须跟着 `package.json` 的 version 走（断言侧已改为「与 package.json 比对」，⛔ 不再写死一个版本）——
//    发版时**一起改**，别让 UA 停在旧版（官方 policy 要的是「可标识调用方」，陈旧版本号反而误导。
export const MANGADEX_UA = 'ReelLudic/1.2.0 (Obsidian plugin; metadata-only)';

/** 封面尺寸档（官方支持 `.256.jpg` / `.512.jpg` / `.original.jpg`）——取 512：海报墙够用，又不像 original 那样几 MB。 */
const COVER_SIZE = '512';

/**
 * 搜索 URL：标题匹配 + 带封面/作者/画师关系 + 内容分级过滤。
 * - `includes[]` 决定 relationships 里**带不带 attributes**（不带的话作者名/封面文件名都拿不到）⇒ 三个都要带；
 * - `contentRating[]` 只要 safe + suggestive：⛔ **不含 erotica / pornographic**（本仓是通用媒体库，不做成人过滤开关）；
 * - 服务端返回顺序按 relevance，但本仓合并后仍会按标题相似度重排（见 main.mergeGroupResults）。
 */
export function buildSearchUrl(query: string, limit: number = MANGADEX_SEARCH_LIMIT): string {
    const p = new URLSearchParams();
    p.set('title', query);
    p.set('limit', String(limit));
    p.append('includes[]', 'cover_art');
    p.append('includes[]', 'author');
    p.append('includes[]', 'artist');
    p.append('contentRating[]', 'safe');
    p.append('contentRating[]', 'suggestive');
    p.set('order[relevance]', 'desc');
    return `${API_BASE}/manga?${p.toString()}`;
}

/** relationships 里的一条（`type` + 可选 attributes；带 attributes 的前提是请求里 includes 了它） */
export interface MangaDexRelationship {
    type?: string;
    id?: string;
    attributes?: Record<string, unknown>;
}

export interface RawMangaDexItem {
    id: string;
    attributes: Record<string, unknown>;
    relationships: MangaDexRelationship[];
}

/** 解析搜索响应：只认 `data[]` 里 id 是非空字符串的项（坏数据静默丢弃，⛔ 不抛）。 */
export function parseMangaDexResults(text: string): RawMangaDexItem[] {
    let root: unknown;
    try {
        root = JSON.parse(text);
    } catch {
        return [];
    }
    const data = asRecord(root)?.data;
    if (!Array.isArray(data)) return [];
    const out: RawMangaDexItem[] = [];
    for (const raw of data) {
        const rec = asRecord(raw);
        const id = rec?.id;
        if (typeof id !== 'string' || !id) continue;
        const rels = Array.isArray(rec?.relationships) ? (rec.relationships as MangaDexRelationship[]) : [];
        out.push({ id, attributes: (asRecord(rec?.attributes) ?? {}) as Record<string, unknown>, relationships: rels });
    }
    return out;
}

/**
 * 展示标题：多语言回退 **zh → zh-hk → en → ja-ro → ja → 第一个非空值**。
 * ⚠️ 不能只读 `en`：实测大量作品只有 `ja-ro`（罗马音），只认 en 会得到空标题；
 * 🔴 中文排第一 —— 本仓是中文库，MangaDex 带 zh 标题时应优先用它（与豆瓣/Bangumi 的结果观感一致）。
 */
export function pickTitle(title: unknown): string {
    const t = asRecord(title) ?? {};
    for (const lang of ['zh', 'zh-hk', 'en', 'ja-ro', 'ja']) {
        const v = t[lang];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    for (const v of Object.values(t)) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
}

/** 简介：同样多语言回退（zh → en → 第一个非空）。 */
export function pickDescription(desc: unknown): string | undefined {
    const d = asRecord(desc) ?? {};
    for (const lang of ['zh', 'zh-hk', 'en']) {
        const v = d[lang];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    for (const v of Object.values(d)) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
}

/**
 * 🔴 #445 总话数：把 MangaDex 的 `attributes.lastChapter`（字符串或数字）解析成非负整数，
 *    否则 `undefined`。⛔ 空串 / 非数字字符串 / 负数 / NaN 一律不给 —— 给 0 会覆盖用户手填值，
 *    还凭空造出一行「话数 0」。
 */
export function parseChapterCount(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

/** 取某类关系里的某个 attributes 字段（如 cover_art 的 fileName）；缺失回 undefined。 */
function relAttr(item: RawMangaDexItem, relType: string, key: string): string | undefined {
    for (const r of item.relationships) {
        if (r.type !== relType) continue;
        const v = r.attributes?.[key];
        if (typeof v === 'string' && v) return v;
    }
    return undefined;
}

/** 取某类关系的展示名（author / artist 的 attributes.name）；缺失回 undefined。 */
function relName(item: RawMangaDexItem, relType: string): string | undefined {
    for (const r of item.relationships) {
        if (r.type !== relType) continue;
        const n = r.attributes?.name;
        if (typeof n === 'string' && n.trim()) return n.trim();
    }
    return undefined;
}

/**
 * 封面直链：`{uploads}/covers/{mangaId}/{fileName}.512.jpg` —— ⚠️ **保留 fileName 自带的扩展名**再拼尺寸档。
 * 🔴 实测对比（2026-09-30，同一张封面）：
 *      `…/2f4aca53-….png.512.jpg`（保留 .png）→ **HTTP 200，182KB 真图** ✓
 *      `…/2f4aca53-….512.jpg`（去掉 .png）  → **HTTP 404** ✗
 *    ⛔ 别"顺手"把原扩展名去掉（那样看着更干净，但这是该接口的硬规则）。
 * 两者缺一即 undefined ⇒ UI 走占位封面（⛔ 不产出半截 URL）。
 */
export function coverUrl(mangaId: string, fileName: string | undefined): string | undefined {
    if (!mangaId || !fileName) return undefined;
    return `${COVER_BASE}/covers/${mangaId}/${fileName}.${COVER_SIZE}.jpg`;
}

/** 标签名（tag.attributes.name.en；实测有的只有其它语言 ⇒ 回退第一个非空值）。 */
export function tagNames(tags: unknown): string[] {
    if (!Array.isArray(tags)) return [];
    const out: string[] = [];
    for (const raw of tags) {
        const name = asRecord(asRecord(raw)?.attributes)?.name;
        const n = pickTitle(name);
        if (n) out.push(n);
    }
    return out;
}

/** 一条 MangaDex 结果 → 本仓统一的 BookSearchResult（漫画条目也是 type=book，走同一套表单字段）。 */
export function toBookResult(item: RawMangaDexItem): BookSearchResult {
    const a = item.attributes;
    return {
        id: item.id,
        title: pickTitle(a.title),
        // 🔴 #444g：作者 / 画师**分开取** —— 原来是 `author ?? artist` 兜底（画师会被当成作者、另一人丢掉）。
        // ⚠️ 实测 One Piece 的 author 与 artist 是**同一个人**（`Oda Eiichirou (尾田栄一郎)`）——
        //    「原作 = 作画」在漫画里是常态 ⇒ **两人相同时 artist 留空**，⛔ 不让表单里出现两格一模一样的值
        //    （用户要的是「能补上另一个人的位置」，不是「每部都重复一遍」）。
        author: relName(item, 'author') ?? relName(item, 'artist'),
        artist: (() => {
            const a = relName(item, 'author');
            const b = relName(item, 'artist');
            return b && b !== a ? b : undefined;
        })(),
        year: typeof a.year === 'number' ? a.year : undefined,
        // 🔴 #445 总话数：`attributes.lastChapter`（已完结作有值，实测 火影 700 / 进击的巨人 139 / 钢炼 108；
        //    连载中为空串 `''`，缺失时 `undefined`）。**只收可解析的非负整数** —— 空串/非数一律不给
        //    （⛔ 别给 0，否则「0 话」会覆盖掉用户手填的值，还能凭空造出一行「话数 0」）。
        pageCount: parseChapterCount(a.lastChapter),
        description: pickDescription(a.description),
        genres: tagNames(a.tags).slice(0, 3),
        thumbnail: coverUrl(item.id, relAttr(item, 'cover_art', 'fileName')),
        source: 'mangadex',
        sourceUrl: `${SITE_BASE}/title/${item.id}`,
    };
}

export class MangaDexClient {
    readonly name = 'mangadex';

    constructor(private http: HttpGet) {}

    /** 搜索 → BookSearchResult[]（搜索级字段；标题为空的结果丢弃 —— 那种条目在结果栏里没法认） */
    async search(query: string): Promise<BookSearchResult[]> {
        const text = await this.http(buildSearchUrl(query), { 'User-Agent': MANGADEX_UA });
        return parseMangaDexResults(text)
            .map(toBookResult)
            .filter((r) => r.title.length > 0);
    }
}
