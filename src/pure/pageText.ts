/**
 * 网页正文 / 简介 / 题材**提取**（纯函数，无 obsidian、无 DOM，可单测）。
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
 *    例外：豆瓣的 meta description 是模板串「图书三体 介绍、书评、论坛及推荐」——
 *    见 `SITE_BOILERPLATE`，那种**必须跳过**，否则用户拿到的「简介」是站点导航文案。
 * 2. 正文里**带「简介 / 剧情简介 / 内容简介 / 故事简介」小标题**的那一块。
 *    🔴 必须**按小节边界切**（见 `sectionHtmlByHeading`）：豆瓣图书页的小节顺序是
 *    `内容简介 → XXX的创作者 → 作者简介 → 目录`，不切的话「简介」会把作者简介整段吃进来。
 * 3. 退化成「正文里最长的一段 `<p>`」—— 只在前两条都没有时才用（命中率低，但好过没有）。
 *
 * ⚠️ **永远返回纯文本**：剥标签 → 还原实体 → 折空白。返回的串可能仍带一点导航残渣，
 *    但绝不会是 HTML —— 落进笔记的必须是用户能直接读的字。
 */

/** 一个页面最多读多少字符（防病态页面把整本网站塞进 token 预算） */
export const PAGE_TEXT_MAX = 6000;

/** 抽出来的简介最多留多少字符（与 `aiPrefill` 的 `MAX_CHARS.summary` 对齐，取 800） */
export const PAGE_SYNOPSIS_MAX = 800;

/** 抽出来的题材最多留几项（与各数据源 `genres.slice(0, 3)` 的截断口径对齐） */
export const PAGE_GENRES_MAX = 6;

/**
 * 简介小标题：中英文都认。
 * ⚠️ 只用 `exec` 找**位置**，不拿它当分隔符切全文 —— 标题后面紧跟的那段才是简介。
 */
const SYNOPSIS_HEADING = /(?:剧情简介|内容简介|故事简介|作品简介|动漫简介|游戏简介|书籍简介|图书简介|专辑简介|简介|plot\s*summary|synopsis|storyline|description)/i;

/**
 * 🔴 m15796 **不能算「作品简介」的小标题**（用户 2026-11-19：「AI预填的根据搜索书名给出该书的简介，
 * 而不是什么作者的简介啊」）。
 *
 * `作者简介` 里含「简介」二字，扁平文本里 `SYNOPSIS_HEADING.exec()` 会命中它里面的那两个字，
 * 于是「简介」框里填进的是作者生平。这里把它（以及同族的「创作者 / 目录 / 丛书」）列成**硬排除项**。
 */
const NOT_SYNOPSIS_HEADING = /(?:作者简介|作者介绍|关于作者|作者小传|绘者简介|译者简介|编剧简介|剧情简介子|创作者|目录|丛书信息|丛书|原文摘录|摘录|短评|影评|书评|论坛|讨论区|相关推荐|相似作品|豆瓣成员常用的标签|喜欢读|喜欢看|以下书单|谁读这本书|谁看过|其他版本|当前版本有售|在哪儿借|二手市场)/i;

/**
 * 简介小节的**终止标题**：抓到这些标题就意味着「作品简介这一节结束了」。
 * 不认它的话，`内容简介` 后面紧跟的 `作者简介` / `目录` / `丛书信息` 会整段被吞进简介框
 * —— 这正是用户 m15796 报的那个 bug。
 */
const SECTION_STOP = /(?:作者简介|作者介绍|关于作者|作者小传|绘者简介|译者简介|编剧简介|目录|丛书信息|丛书|原文摘录|摘录|短评|影评|书评|论坛|讨论区|相关推荐|相似作品|豆瓣成员常用的标签|标签|喜欢读|喜欢看|以下书单|谁读这本书|谁看过|其他版本|当前版本有售|在哪儿借|二手市场|内容简介|剧情简介|故事简介|作品简介|动漫简介|游戏简介|书籍简介|图书简介|专辑简介|plot\s*summary|synopsis|storyline|references|external\s+links|see\s+also|reception|adaptations)/i;

/**
 * 站点模板文案：这几串是**站点导航/SEO 套话**，不是作品简介。
 * 实测豆瓣图书页的 `<meta name="description">` 恒为「图书《书名》 介绍、书评、论坛及推荐」。
 */
const SITE_BOILERPLATE = /(?:介绍[、,，]\s*书评[、,，]\s*论坛|介绍[、,，]\s*影评[、,，]\s*论坛|介绍[、,，]\s*游戏[、,，]\s*论坛|的网页|的官方网站|豆瓣读书|豆瓣电影)/i;

/** 不参与正文的块（脚本 / 样式 / 导航 / 页脚 / 分享栏）—— 剥掉再取文本 */
const NOISE_BLOCK = /<(script|style|noscript|nav|header|footer|aside|form|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 块级标签：当空格处理（两个 `<p>` 之间不该粘成一个词） */
const BLOCK_TAG = /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|td|section|article|blockquote|dd|dt)>/gi;

/** 任意标签（最后统一剥掉） */
const ANY_TAG = /<[^>]+>/g;

/**
 * 实体表（⛔ `&amp;` 必须最后换 —— 见 `pure/htmlText` 文件头那条铁律）。
 *
 * 🔴 m15796 补 `&middot;` / `&#183;` 一族：豆瓣每个小节标题后面都挂一串
 * `<span>内容简介</span> &nbsp;&middot;×6`，不还原就成了简介开头的字面量 `&middot; &middot; …`
 * （用户拿到的简介第一行是一串乱码点）。
 */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
    [/&quot;/g, '"'],
    [/&#34;/g, '"'],
    [/&ldquo;/g, '“'],
    [/&rdquo;/g, '”'],
    [/&apos;/g, "'"],
    [/&#39;/g, "'"],
    [/&lsquo;/g, '‘'],
    [/&rsquo;/g, '’'],
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&nbsp;/g, ' '],
    [/&mdash;/g, '—'],
    [/&#8212;/g, '—'],
    [/&ndash;/g, '–'],
    [/&hellip;/g, '…'],
    [/&#8230;/g, '…'],
    [/&middot;/g, '·'],
    [/&#183;/g, '·'],
    [/&bull;/g, '•'],
    [/&#8226;/g, '•'],
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

/** 去掉一段文本首尾那些纯装饰的 `·` / `•` / 冒号（豆瓣小节标题后面的点阵） */
function trimDecoration(s: string): string {
    return s.replace(/^[\s·•\-—:：、,，.]+/, '').replace(/[\s·•]+$/, '');
}

/**
 * 🔴 m15796 **按小节切 HTML**：在页面里找到「简介」类小标题，把它到**下一个标题**之间的 HTML 交出来。
 *
 * 为什么不能继续用「扁平文本里 exec 一次、把后面 800 字全端走」：豆瓣图书页的小节顺序是
 * `内容简介 → XXX的创作者 → 作者简介 → 目录 → 丛书信息`。扁平截断会把
 * 「三体的创作者 / 刘慈欣 作者 / 作者简介 / 刘慈欣，祖籍河南…」一起塞进「简介」框
 * —— 用户 m15796 报的「书的简介变成作者简介」就是这么来的。
 *
 * @param html   页面源码
 * @param accept 接受的小标题（默认见 `SYNOPSIS_HEADING`）
 * @param reject 必须排除的小标题（默认见 `NOT_SYNOPSIS_HEADING`）
 * @returns 该小节内部的 HTML 片段；页面里没有这种小标题时返回 `null`
 */
export function sectionHtmlByHeading(
    html: unknown,
    accept: RegExp = SYNOPSIS_HEADING,
    reject: RegExp = NOT_SYNOPSIS_HEADING,
): string | null {
    const raw = String(html ?? '');
    if (!raw) return null;
    // 先剥噪声块：`<style>` 里的 `.intro p{...}` 会被当成正文，且会让小节边界错位
    const body = raw.replace(NOISE_BLOCK, ' ');
    const HEAD = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    const heads: { start: number; end: number; text: string }[] = [];
    for (let m = HEAD.exec(body); m; m = HEAD.exec(body)) {
        heads.push({
            start: m.index,
            end: m.index + m[0].length,
            text: trimDecoration(decodePageEntities(m[2].replace(ANY_TAG, ' ')).replace(/\s+/g, ' ').trim()),
        });
    }
    const at = heads.findIndex((h) => h.text && accept.test(h.text) && !reject.test(h.text));
    if (at < 0) return null;
    const stop = heads[at + 1];
    // 没有下一个标题 ⇒ 取到页尾（再用 `SECTION_STOP` 在文本层兜一次）
    return body.slice(heads[at].end, stop ? stop.start : body.length);
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
    //    🔴 m15796：豆瓣的 meta 是模板串「图书三体 介绍、书评、论坛及推荐」⇒ 必须跳过。
    for (const key of ['og:description', 'description', 'twitter:description']) {
        const t = trimDecoration(
            decodePageEntities(metaContent(raw, key))
                .replace(ANY_TAG, ' ')
                .replace(/\s+/g, ' ')
                .trim(),
        );
        if (t.length >= 20 && !SITE_BOILERPLATE.test(t)) return t.slice(0, PAGE_SYNOPSIS_MAX);
    }

    // ② 页面正文里「简介」小标题之后的那一节（🔴 按小节边界切，别整段端走）
    const section = sectionHtmlByHeading(raw);
    if (section) {
        const t = cutAtSectionStop(pageReadableText(section, PAGE_TEXT_MAX));
        if (t.length >= 20) return trimDecoration(t).slice(0, PAGE_SYNOPSIS_MAX);
    }

    // ②b 没有 h 标题结构的站点（部分维基镜像 / 百科）⇒ 退回扁平文本，但仍按终止标题切
    const flat = pageReadableText(raw);
    const m = SYNOPSIS_HEADING.exec(flat);
    if (m) {
        const before = flat.slice(Math.max(0, m.index - 2), m.index);
        const after = cutAtSectionStop(flat.slice(m.index + m[0].length));
        // ⚠️ 命中的若是「作者简介」里的那两个字（前一个字是「者」）⇒ 这不是作品简介
        if (!/者/.test(before) && after.length >= 20) {
            return trimDecoration(after).slice(0, PAGE_SYNOPSIS_MAX);
        }
    }

    // ③ 最后兜底：正文里最长的一段 <p>
    let best = '';
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    for (let hit = pRe.exec(raw); hit; hit = pRe.exec(raw)) {
        const t = pageReadableText(hit[1], PAGE_SYNOPSIS_MAX);
        if (t.length > best.length) best = t;
    }
    if (best.length >= 40) return trimDecoration(best).slice(0, PAGE_SYNOPSIS_MAX);
    return null;
}

/**
 * 在一段**已摊平的正文**里，把第一个「小节终止标题」之后的内容切掉。
 * ⚠️ 只管终止，不管起始（起始由 `sectionHtmlByHeading` / `SYNOPSIS_HEADING.exec` 负责）。
 */
function cutAtSectionStop(text: string): string {
    const m = SECTION_STOP.exec(text);
    return m && m.index > 0 ? text.slice(0, m.index) : text;
}

/**
 * 🔴 m15796 从页面 HTML 里抽**题材 / 类型**（用户 2026-11-19：「这个也要搜索能该条目的题材、标签」）。
 *
 * 数据源搜索级常没有题材（豆瓣图书 `#info` 只有作者/出版社/ISBN/页数，页面上**已无标签区块**），
 * 所以只能从权威页面里再捞一遍。三种真实存在的写法都认：
 *  · `<script type="application/ld+json">` 里的 `"genre": "科幻"` / `["科幻","小说"]`（Schema.org 标准）
 *  · `<span property="v:genre">剧情</span>`（豆瓣影视 / 游戏的微数据）
 *  · `<a ... itemprop="genre">科幻</a>`（部分百科镜像）
 *
 * @returns 去重后的题材数组；抽不到返回 `[]`（⛔ 不返回 `undefined` —— 调用方直接判 `length`）
 */
export function extractPageGenres(html: unknown): string[] {
    const raw = String(html ?? '');
    if (!raw) return [];
    const out: string[] = [];
    const push = (v: unknown): void => {
        const s = decodePageEntities(String(v ?? ''))
            .replace(ANY_TAG, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s || s.length > 24) return;
        if (!out.includes(s)) out.push(s);
    };

    // ① JSON-LD 的 genre（字符串或字符串数组）
    const ld = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (let m = ld.exec(raw); m; m = ld.exec(raw)) {
        let d: unknown;
        try {
            d = JSON.parse(m[1]);
        } catch {
            continue;
        }
        for (const node of Array.isArray(d) ? d : [d]) {
            const g = (node as { genre?: unknown } | null)?.genre;
            if (typeof g === 'string') push(g);
            else if (Array.isArray(g)) for (const x of g) push(x);
        }
    }

    // ② 微数据 property="v:genre"
    const vg = /property=["']v:genre["'][^>]*>([\s\S]*?)</gi;
    for (let m = vg.exec(raw); m; m = vg.exec(raw)) push(m[1]);

    // ③ itemprop="genre"（含其后的文本）
    const ig = /itemprop=["']genre["'][^>]*>([\s\S]*?)</gi;
    for (let m = ig.exec(raw); m; m = ig.exec(raw)) push(m[1]);

    return out.slice(0, PAGE_GENRES_MAX);
}
