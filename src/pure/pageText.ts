/**
 * 网页正文 / 简介**提取**（纯函数，无 obsidian、无 DOM，可单测）。
 *
 * ## 为什么需要它
 *
 * 🔴 m09330（用户 2026-11-18：「怎么AI搜索出来每个条目简介都是编的，我要的是原生原味的简介」）：
 * 原先 AI 预填只有 `lookup_metadata`（本库元数据源）与 `web_search`（必应 RSS）两个工具。
 * 必应 RSS 的每条结果**只有标题 + 两行摘要**（`pure/bingSearch` 的 `parseBingRss`），
 * 里面**从来不含有作品的官方简介**；而各元数据源的搜索级记录也常常没有简介
 * （Open Library 的简介只在 works.json 详情里、豆瓣/Bangumi 搜索级有的有有的没有）。
 * 于是模型永远拿不到「简介原文」，只能按提示词退化成「凭记忆写 2~4 句」——
 * 用户看到的「编的简介」就是这么来的。
 *
 * 这个模块补上中间那一环：拿到一个**权威页面**（豆瓣条目页 / Bangumi subject / 维基百科 /
 * IGDB 页面 …）的 HTML 后，把它的**简介正文**抽出来，交给服务层按「照抄」口径落库。
 *
 * ## 抽取优先级（⛔ 别改成「随便取最长一段」）
 *
 * 1. `<meta property="og:description">` / `<meta name="description">` —— 站点自己写好的作品简介，
 *    最接近「官方文案」，且**已经是纯文本**，不用猜正文在哪。
 * 2. 正文里**带「简介 / 剧情简介 / 内容简介 / 故事简介」小标题**的那一块（豆瓣、Bangumi 的条目页都长这样）。
 * 3. 退化成「正文里最长的一段 `<p>`」—— 只在前两条都没有时才用（命中率低，但好过没有）。
 *
 * ⚠️ **永远返回纯文本**：剥标签 → 还原实体 → 折空白。返回的串可能仍带一点导航残渣，
 *    但绝不会是 HTML —— 落进笔记的必须是用户能直接读的字。
 */

/** 一个页面最多读多少字符（防病态页面把整本网站塞进 token 预算） */
export const PAGE_TEXT_MAX = 6000;

/** 抽出来的简介最多留多少字符（与 `aiPrefill` 的 `MAX_CHARS.summary` 对齐，取 800） */
export const PAGE_SYNOPSIS_MAX = 800;

/**
 * 简介小标题：中英文都认。
 * ⚠️ 只用 `exec` 找**位置**，不拿它当分隔符切全文 —— 标题后面紧跟的那段才是简介。
 */
const SYNOPSIS_HEADING = /(?:剧情简介|内容简介|故事简介|作品简介|动漫简介|游戏简介|书籍简介|简介|plot\s*summary|synopsis|storyline|description|about)/i;

/** 不参与正文的块（脚本 / 样式 / 导航 / 页脚 / 分享栏）—— 剥掉再取文本 */
const NOISE_BLOCK = /<(script|style|noscript|nav|header|footer|aside|form|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 块级标签：当空格处理（两个 `<p>` 之间不该粘成一个词） */
const BLOCK_TAG = /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|td|section|article|blockquote|dd|dt)>/gi;

/** 任意标签（最后统一剥掉） */
const ANY_TAG = /<[^>]+>/g;

/** 实体表（⛔ `&amp;` 必须最后换 —— 见 `pure/htmlText` 文件头那条铁律） */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
    [/&quot;/g, '"'],
    [/&#34;/g, '"'],
    [/&apos;/g, "'"],
    [/&#39;/g, "'"],
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&nbsp;/g, ' '],
    [/&mdash;/g, '—'],
    [/&ndash;/g, '–'],
    [/&hellip;/g, '…'],
    [/&amp;/g, '&'],
];

/** 还原 HTML 实体（顺序敏感，`&amp;` 最后） */
export function decodePageEntities(raw: unknown): string {
    let s = String(raw ?? '');
    if (!s) return '';
    for (const [re, to] of ENTITIES) s = s.replace(re, to);
    return s;
}

/** 取一个 `<meta>` 的 content（属性顺序两种写法都认） */
function metaContent(html: string, key: string): string {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
    if (a) return a[1];
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html);
    return b ? b[1] : '';
}

/**
 * HTML → 可读纯文本（剥噪声块 → 块级标签当空格 → 剥标签 → 还原实体 → 折空白）。
 * ⚠️ 折空白是**必需**的：页面源码里到处是缩进换行，不折的话「照抄」下来全是空洞。
 */
export function pageReadableText(html: unknown, maxChars: number = PAGE_TEXT_MAX): string {
    let s = String(html ?? '');
    if (!s) return '';
    s = s.replace(NOISE_BLOCK, ' ');
    s = s.replace(BLOCK_TAG, ' ');
    s = s.replace(ANY_TAG, ' ');
    s = decodePageEntities(s);
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > maxChars ? s.slice(0, maxChars) : s;
}

/**
 * 从页面 HTML 里抽**简介原文**（抽不到 ⇒ `null`，⛔ 不返回空串 —— 空串会被当成「查到了一段空简介」）。
 *
 * @param html 页面源码
 */
export function extractPageSynopsis(html: unknown): string | null {
    const raw = String(html ?? '');
    if (!raw) return null;

    // ① meta：站点自己写的作品简介（最像「官方原文」，且已是纯文本）
    //    ⚠️ 仍然要剥一次标签：站点在 meta 里夹 `<b>` / `<em>` 的情况真实存在，
    //       而这段文字会**原样落进笔记**，带标签就是看得见的脏数据。
    for (const key of ['og:description', 'description', 'twitter:description']) {
        const t = decodePageEntities(metaContent(raw, key))
            .replace(ANY_TAG, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (t.length >= 20) return t.slice(0, PAGE_SYNOPSIS_MAX);
    }

    // ② 页面正文里「简介」小标题之后的那一块
    const text = pageReadableText(raw);
    const m = SYNOPSIS_HEADING.exec(text);
    if (m) {
        const after = text.slice(m.index + m[0].length).replace(/^\s*[:：]?\s*/, '');
        if (after.length >= 20) return after.slice(0, PAGE_SYNOPSIS_MAX);
    }

    // ③ 最后兜底：正文里最长的一段 <p>
    let best = '';
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    for (let hit = pRe.exec(raw); hit; hit = pRe.exec(raw)) {
        const t = pageReadableText(hit[1], PAGE_SYNOPSIS_MAX);
        if (t.length > best.length) best = t;
    }
    if (best.length >= 40) return best.slice(0, PAGE_SYNOPSIS_MAX);
    return null;
}
