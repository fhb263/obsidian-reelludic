/**
 * AI 预填的**相关性闸口**（纯函数，无 obsidian、无 DOM，可单测）。
 *
 * ## 为什么需要它
 *
 * 🔴 m14816（用户 2026-11-19 原话）：「这个AI预填搜索的简介完全不相干都填进来了」。
 *
 * 真因不是「搜不到」，而是**搜到了别人的简介就照搬**：
 * `main.ts` 的 `runPrefillTool`（`lookup_metadata` 分支）此前是
 *
 * ```ts
 * const withSynopsis = hits.find((h) => (synopsisOf(h) ?? '').trim().length > 0);
 * ```
 *
 * ——「按相关性顺序里第一个**带简介**的命中」，**完全不校验它与用户要查的作品是否同名**。
 * 各元数据源的搜索级结果经常把同系列 / 同演员 / 同名不同作 / 甚至只有关键词相近的条目
 * 排进前三，只要其中一条挂 `summary`，那段文字就被当成「作品简介原文」照搬进了简介框
 * （`preferToolSynopsis` 拿到原文是**无条件覆盖**的，见 `pure/aiPrefill`）。
 *
 * `fetch_page` 分支同病：模型给什么链接就抓什么，抓回来 `extractPageSynopsis` 的③兜底
 * （「最长的一段 `<p>`」）在有导航残渣的页面上会抽出一段与作品无关的正文。
 *
 * ## 判据
 *
 * 1. **标题为主**：归一后「全等」最可信；「一方包含另一方」次之（`七里香` ⊂ `七里香 (Live)`、
 *    `柯南` ⊂ `名侦探柯南`）。两条都不满足 ⇒ 该命中**不许提供简介**。
 * 2. **年份只用来择优**，不用来否决：同名翻拍 / 再版很常见，年份差 1 年内的判为更优，
 *    但**绝不因为年份不同就丢弃** —— 那会把「豆瓣年份缺失」的命中全判死。
 * 3. **作者只用来择优**：同名不同作靠作者/歌手区分（`sub` 行常是导演 / 作者 / 歌手）。
 *
 * ⚠️ 归一必须**去标点与空白**：实测同一部作品在不同源里写成 `七里香` / `七里香(2004)` /
 *    `七里香 · 周杰伦`，带括号后缀是最常见的形态。
 * ⚠️ 极短标题（归一后 1 个字）不做包含判断：`火` 会被任何标题包含住。
 */

import { describeSearchResult, synopsisOf } from 'pure/searchDisplay';

/** 只认这几种结果形状（`describeSearchResult` 能吃任意对象，这里只取判据需要的两个字段） */
interface HitShape {
    title: string;
    year?: number;
    sub?: string;
}

/**
 * 归一化：用于**判同**，⛔ 不用于展示（展示永远用原文）。
 *
 * 顺序固定：`NFKC`（全角折半角）→ 小写 → 去掉所有空白与常见标点。
 * 去标点是必需的：`七里香 (Live)` 与 `七里香`、`SPY×FAMILY` 与 `SPY FAMILY` 都要能判同。
 */
export function normalizeForMatch(raw: unknown): string {
    return String(raw ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        // ⚠️ `×`（全角乘号）必须去掉：`SPY×FAMILY` 与 `SPY FAMILY` 是同一部作品，
        //    留着它 `titleTierOf` 会判成「不同名」⇒ 明明搜到了却拿不到简介。
        .replace(/[·・:：\-—_/\\|,，.。、;；!！?？'"“”‘’()（）[\]×✕✖]/g, '');
}

/** 标题匹配档位：`3` 全等 / `2` 一方包含另一方 / `0` 不同名（⛔ 别把 0 也当成「勉强相关」） */
export type TitleTier = 3 | 2 | 0;

/**
 * 判断「命中标题」与「要查的标题」的匹配档位。
 *
 * @param hitTitle  命中结果的中文名/主标题（原文）
 * @param queryTitle 用户要查的标题（原文）
 */
export function titleTierOf(hitTitle: unknown, queryTitle: unknown): TitleTier {
    const a = normalizeForMatch(hitTitle);
    const b = normalizeForMatch(queryTitle);
    if (!a || !b) return 0;
    if (a === b) return 3;
    // 极短标题不做包含判断（`火` / `1` 会被任何标题包含住 ⇒ 假阳性）
    if (a.length < 2 || b.length < 2) return 0;
    if (a.includes(b) || b.includes(a)) return 2;
    return 0;
}

/** 文本里是否出现该标题（归一后包含即可）—— 给 `fetch_page` 判断「抓到的页面是不是这部作品」 */
export function textMentionsTitle(text: unknown, title: unknown): boolean {
    const t = normalizeForMatch(text);
    const q = normalizeForMatch(title);
    if (!t || !q) return false;
    // 标题归一后 1 个字时按包含判断会假阳性 ⇒ 要求至少 2 字才认
    if (q.length < 2) return false;
    return t.includes(q);
}

/**
 * 从任意结果对象里取出判据字段（`describeSearchResult` 对各源形状都兜得住）。
 *
 * ⚠️ `describeSearchResult` 只接受**对象** —— 传 `null`/数字/字符串会直接抛
 *    （`Cannot read properties of null (reading 'source')`）。工具结果理论上都是对象，
 *    但闸口是**最后一道关**，它自己崩掉等于把整轮预填炸掉 ⇒ 这里先挡一层。
 */
function shapeOf(hit: unknown): HitShape {
    if (!hit || typeof hit !== 'object') return { title: '', year: undefined, sub: undefined };
    const d = describeSearchResult(hit as never);
    return { title: String(d.title ?? ''), year: d.year, sub: d.sub };
}

/** 一个可用的简介候选（已通过相关性闸口） */
export interface SynopsisPick {
    /** 命中标题（原文，给文案用） */
    title: string;
    /** 命中年份（有才带） */
    year?: number;
    /** 简介原文 */
    synopsis: string;
}

/** `pickSynopsisHit` 的完整裁决结果（文案要能说清「为什么留空」） */
export interface SynopsisDecision {
    /** 通过闸口的简介（没有 ⇒ `null`） */
    pick: SynopsisPick | null;
    /** 本次命中里标题对得上的条数（`tier > 0`） */
    sameName: number;
    /** 标题对得上、但都没带简介 */
    sameNameNoSynopsis: number;
    /** 总命中数 */
    total: number;
}

/**
 * 从搜索结果里挑出**可以作为简介原文**的那一条。
 *
 * 裁决顺序（⛔ 别改成「取第一个带简介的」——那就是 m14816 的缺陷本体）：
 *   1. 只保留 `titleTierOf(...) > 0` 的命中；
 *   2. 其中必须带非空简介（`synopsisOf`）；
 *   3. 同档里按「年份距离小」→「作者/歌手出现在副标题里」→「原顺序靠前」择优。
 *
 * @param hits  搜索结果（任意源形状）
 * @param query 用户要查的标题 + 可选年份/作者线索
 */
export function decideSynopsis(
    hits: readonly unknown[],
    query: { title: string; year?: number; author?: string },
): SynopsisDecision {
    const qTitle = String(query.title ?? '').trim();
    const qYear = typeof query.year === 'number' && Number.isFinite(query.year) ? query.year : undefined;
    const qAuthor = normalizeForMatch(query.author);
    const list = Array.isArray(hits) ? hits : [];

    let sameName = 0;
    let sameNameNoSynopsis = 0;
    interface Candidate {
        pick: SynopsisPick;
        tier: number;
        yearDist: number;
        authorHit: number;
        index: number;
    }
    let best: Candidate | null = null;
    // ⚠️ 用 `for` 而不是 `forEach`：TS 不追踪回调里的赋值 ⇒ `forEach` 之后再读 `best`
    //    会被窄化成「一定是 null」，`best.pick` 直接报 TS2339（`never` 上取属性）。
    for (let index = 0; index < list.length; index++) {
        const hit = list[index];
        const shape = shapeOf(hit);
        const tier = titleTierOf(shape.title, qTitle);
        if (tier === 0) continue;
        sameName++;
        const syn = (synopsisOf(hit) ?? '').trim();
        if (!syn) {
            sameNameNoSynopsis++;
            continue;
        }
        const yearDist =
            qYear !== undefined && typeof shape.year === 'number' && Number.isFinite(shape.year)
                ? Math.abs(shape.year - qYear)
                : Number.POSITIVE_INFINITY;
        const authorHit = qAuthor && normalizeForMatch(shape.sub).includes(qAuthor) ? 1 : 0;
        const cand: Candidate = {
            pick: { title: shape.title, year: shape.year, synopsis: syn },
            tier,
            yearDist,
            authorHit,
            index,
        };
        if (!best || betterThan(cand, best)) best = cand;
    }

    return {
        pick: best ? best.pick : null,
        sameName,
        sameNameNoSynopsis,
        total: list.length,
    };
}

/** 择优：档位高优先 → 年份近 → 作者命中 → 原顺序靠前（全序，保证同输入同输出） */
function betterThan(
    a: { tier: number; yearDist: number; authorHit: number; index: number },
    b: { tier: number; yearDist: number; authorHit: number; index: number },
): boolean {
    if (a.tier !== b.tier) return a.tier > b.tier;
    if (a.yearDist !== b.yearDist) return a.yearDist < b.yearDist;
    if (a.authorHit !== b.authorHit) return a.authorHit > b.authorHit;
    return a.index < b.index;
}
