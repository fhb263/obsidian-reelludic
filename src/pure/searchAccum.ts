// 搜索「跨次累积」的纯逻辑（用户 2026-10-22 需求 ⑬；2026-10-25 改口径，见下）。
//
// 用户原话（2026-10-22）：「给搜索添加条目返回的如上限20条可再搜索突破，可存储持久化上次搜索已有的」。
// 🔴 用户原话（2026-10-25，**覆盖上一条的「持久化」部分**）：
//    「添加条目窗口保存逻辑仅搜索完毕不关闭窗口才保存，退出再重新搜索为清除」。
//
// 🔴 要解决的第一件事（仍然有效）：
//  ⑴ **上限突破** —— 各源自己的截断（豆瓣 30 / TMDB 30 / Bangumi 30 / IGDB 30 / MangaDex 20 / AniList 20）
//     是**单次请求**的天花板，改不动接口。能突破的是**跨多次搜索的累积**：
//     换个关键词再搜，新结果按 `resultKeyOf` 去重后**并进**已有列表 —— 搜得越多，池子越大。
//     ⛔ 旧行为是 `doSearch()` 一进场就 `results = []`，上一次的结果直接蒸发，用户只能在一个 20 条的池子里打转。
//
// 🔴 已被**作废**的第二件事（⛔ 别再按它加回去）：
//  ⑵ ~~持久化~~ —— 原设计把累积池写进 `{库目录}/search-pool.json`，关弹窗/重启后还在。
//     用户 2026-10-25 明确要「退出再搜索为清除」⇒ **落盘链路已整体拆除**：
//     `main.ts` 不再读/写该文件，`EntryModal` 的 `searchPool` 退化成本实例字段（关窗即随实例释放）。
//     ⇒ 本文件下面那批 `parseSearchPool` / `serializeSearchPool` / `normalizePool` 目前**没有生产调用方**，
//        仅作为「万一哪天要恢复落盘」的现成解析工具 + 单测留存；改坏它们不影响线上行为。
//
// 🔴 为什么按 `type:bookKind` **分桶**：六类结果形状不同（`SearchResult` 是六源联合），
//   混在一个数组里既没法做类型收窄，也会出现「切到书籍页签却看见一堆电影」。
//   桶键与 `main.cachedSearch` 的 key 口径同源（`movie`/`tv`/`book:文学`/`game`/`anime`/`music`），
//   但**别复用那份**：那是 30 分钟的内存缓存，这是落盘的用户资产，生命周期完全不同。
import type { SearchResult } from 'pure/searchDisplay';
import { resultKeyOf } from 'pure/repeatAdd';

/** 池文件名（英文，与 catalog.json / trash.json 同一命名口径：小写、单词、放库根）
 *  ⚠️ 2026-10-25 起**不再被读写**（用户要求「退出再搜索为清除」⇒ 落盘链路整体拆除）。
 *     保留常量是为了 `parseSearchPool`/`serializeSearchPool` 这对工具仍然自洽、单测可跑。 */
export const SEARCH_POOL_FILE_NAME = 'search-pool.json';

export const SEARCH_POOL_VERSION = 1;

/**
 * 单个桶的保留上限。
 *
 * 🔴 为什么要有：这是**内存**里的累积池，但用户会反复换关键词搜同一部片子、能攒出几千条，
 *    界面渲染与每次合并都要遍历 ⇒ 必须有天花板，否则关一次弹窗就白攒、开一次就卡一下。
 *   200 是「足够翻很久、又不至于让合并变慢」的折中（单条约 300 字节 ⇒ 200 × 6 桶 ≈ 360KB 上限）。
 *   ⚠️ 2026-10-25 前它是「落盘文件大小」的约束；现在文件不写了，但上限本身仍然要留。
 */
export const SEARCH_POOL_KEEP = 200;

/** 全部桶：`bucketKey` → 结果列表（新的在前，与界面展示顺序一致） */
export type SearchPool = Record<string, SearchResult[]>;

export interface SearchPoolFile {
    version: number;
    buckets: SearchPool;
}

/**
 * 桶键（`type` + 书籍子分类）。
 *
 * ⚠️ 书籍必须带 `bookKind`：文学 / 网文 / 漫画 是**三条不同的搜索链**（`sourceGroupForBookKind`），
 *    合并会串味 —— 漫画态翻出文学的结果，点进去保存成漫画条目，这就是数据污染。
 * ⛔ 非书籍类型的 `bookKind` 一律忽略（表单里那个字段只在书籍态有意义）。
 */
export function searchBucketKey(type: string, bookKind?: string): string {
    return type === 'book' ? `book:${bookKind ?? ''}` : type;
}

/**
 * 把一批新结果并进已有列表：**新的在前**，按 `resultKeyOf` 去重（同一条只留**新**的那份）。
 *
 * 🔴 为什么保留「新的那份」而不是「旧的」：用户重搜同一个词，源那边可能刚补了评分/封面，
 *   留着旧的等于把新数据丢掉。反过来，用户**上一次已经挑过/标过**的信息不在结果对象里
 *   （「已添加」标记是独立的 `addedHits` 集合，不受这里影响）⇒ 替换整条是安全的。
 *
 * @param prev   已有结果（可为空数组）
 * @param fresh  本次搜索返回的结果
 * @param keep   合并后的保留上限（新的在前，超出截断**最旧**的尾部）
 */
export function mergeSearchResults(prev: readonly SearchResult[], fresh: readonly SearchResult[], keep: number = SEARCH_POOL_KEEP): SearchResult[] {
    // 🔴 上限必须先判：`keep = 0` 时下面「push 完再比」的写法会漏进来一条（单测钉死这条）
    if (!(keep > 0)) return [];
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const r of [...fresh, ...prev]) {
        if (!r || typeof r !== 'object') continue;
        const key = resultKeyOf(r);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
        if (out.length >= keep) break;
    }
    return out;
}

/** 把某个桶替换成给定列表（纯函数，返回新对象；空列表 ⇒ 该桶删除，不占位） */
export function withBucket(pool: SearchPool, bucket: string, items: readonly SearchResult[]): SearchPool {
    const next: SearchPool = { ...pool };
    const clean = items.filter((r) => r && typeof r === 'object');
    if (clean.length === 0) delete next[bucket];
    else next[bucket] = [...clean];
    return next;
}

/** 读某桶（未知桶 → 空数组；⛔ 不返回 undefined，调用方不必到处判空） */
export function bucketOf(pool: SearchPool, bucket: string): SearchResult[] {
    const hit = pool[bucket];
    return Array.isArray(hit) ? hit : [];
}

// ───────────────────────────── 落盘/读盘 ─────────────────────────────

function isResultLike(v: unknown): v is SearchResult {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    // 结果必须有标题 —— 六源都有 `title`，没有的是脏数据（会被渲染成空卡片）
    return typeof o.title === 'string' && o.title.length > 0;
}

/**
 * 归一一个桶：丢掉不像结果的项、按 `resultKeyOf` 去重（保留先出现的 = 新的在前）、截断到 `keep`。
 * ⚠️ 与 `mergeSearchResults` 的区别：那个是「新旧合并」，这个是「读盘时的纯净化」——
 *   盘上那份可能被用户手改过 / 被旧版本写坏，得能自己扛住。
 * ⚠️ 2026-10-25 起没有生产调用方（落盘拆除），随 `parseSearchPool` 一起留作工具。
 */
export function normalizeBucket(raw: unknown, keep: number = SEARCH_POOL_KEEP): SearchResult[] {
    if (!Array.isArray(raw) || !(keep > 0)) return [];
    const out: SearchResult[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!isResultLike(item)) continue;
        const key = resultKeyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= keep) break;
    }
    return out;
}

/** 归一整个池（桶名空/非字符串的丢掉；空桶不保留） */
export function normalizePool(raw: unknown, keep: number = SEARCH_POOL_KEEP): SearchPool {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: SearchPool = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!k || typeof k !== 'string') continue;
        const items = normalizeBucket(v, keep);
        if (items.length > 0) out[k] = items;
    }
    return out;
}

/** 解析池文件：坏 JSON / 非对象 → 空池（⛔ 不抛：一份缓存坏了不该让「添加条目」打不开）
 *  ⚠️ 2026-10-25 起没有生产调用方（`main.ts` 不再读该文件），留作恢复落盘时的现成解析器。 */
export function parseSearchPool(text: string, keep: number = SEARCH_POOL_KEEP): SearchPool {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return {};
    }
    if (typeof raw !== 'object' || raw === null) return {};
    const o = raw as Record<string, unknown>;
    // 兼容「裸池」（直接就是 buckets 对象，没有 version 包裹）—— 手改文件时容易写成那样
    const buckets = 'buckets' in o ? o.buckets : o;
    return normalizePool(buckets, keep);
}

/** 序列化池文件（写盘前顺手归一，保证盘上永远是干净的） */
export function serializeSearchPool(pool: SearchPool, keep: number = SEARCH_POOL_KEEP): string {
    const clean: SearchPoolFile = { version: SEARCH_POOL_VERSION, buckets: normalizePool(pool, keep) };
    return JSON.stringify(clean, null, 2);
}
