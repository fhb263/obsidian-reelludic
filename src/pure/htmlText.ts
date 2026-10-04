/**
 * HTML 文本还原的**唯一真源**（#498 建立）—— 无 `obsidian` / 无 DOM，可单测。
 *
 * ## 为什么单独一层
 *
 * 本仓有两条链路要从**别人家的 HTML** 里抠用户可见文本：
 *  · B站 搜索的 `title`（含 `<em class="keyword">` 高亮 + `&quot;` 实体）—— `pure/dl/bilibili`
 *  · 必应图片搜索的 `m="{…}"` 属性（整个 JSON 被实体化过）—— `pure/posterSearch`
 *
 * ⛔ 各写一份的后果不是「重复几行」，而是**两边迟早不一样**：其中一处忘了 `&amp;` 要**最后**换，
 *    标题里就会出现字面量 `&quot;` —— 这种错只在那条链路的某个数据上偶然现形，极难自查。
 *
 * 🔴 **`&amp;` 必须最后一个换**（两条链路共用同一条铁律）：先换它的话，
 *    原本写作 `&amp;quot;` 的文本会在第一步变成 `&quot;`，第二步再被当成实体换成 `"` ——
 *    用户看到的就是「本该显示 `&quot;` 的地方变成了引号」。
 */

/** 实体表（顺序即**替换顺序**：`&amp;` 必须在最后 —— 见文件头说明） */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
    [/&quot;/g, '"'],
    [/&#34;/g, '"'],
    [/&apos;/g, "'"],
    [/&#39;/g, "'"],
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&nbsp;/g, ' '],
    [/&amp;/g, '&'],
];

/**
 * 把 HTML 实体还原成字符。⚠️ **不剥标签**（那是 `stripHtmlTags` 的活，且两者的**先后顺序**有意义：
 * 先剥标签再还原，才能让「本想显示 `<em>` 而写成 `&lt;em&gt;` 的文本」保持原样）。
 */
export function decodeHtmlEntities(raw: unknown): string {
    let s = String(raw ?? '');
    for (const [re, ch] of ENTITIES) s = s.replace(re, ch);
    return s;
}

/** 剥掉 HTML 标签（`<em class="keyword">晴</em>` → `晴`）。⛔ 不做实体还原，两件事分开用 */
export function stripHtmlTags(raw: unknown): string {
    return String(raw ?? '').replace(/<[^>]*>/g, '');
}

/** 还原成「一行纯文本」：**剥标签 → 还原实体 → 折叠空白 → trim**（B站 标题这类短文本的口径） */
export function decodeHtmlText(raw: unknown): string {
    return decodeHtmlEntities(stripHtmlTags(raw)).replace(/\s+/g, ' ').trim();
}

/** 块级标签的**换行语义**（`<br>` / `</p>` / `</li>` …）—— 还原成一行时它们该变成一个空格 */
const BLOCK_BOUNDARY = /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr|td|section|article|blockquote)>/gi;

/**
 * 正文级 HTML → 一行文本：**先把块级标签换成空格**，再走 `decodeHtmlText`。
 *
 * 🔴 与 `decodeHtmlText` 只差这一步，但那一步决定成败：直接「剥标签」会把相邻段落**首尾粘成一个词**
 *    （`<p>end.</p><p>Next</p>` → `end.Next`；中文因为句末有标点看着还行，英文直接糊在一起）。
 * 用途：作品简介这类**多段正文**（Google Books 的描述整段 `<p>`、豆瓣带 `<br>`）。
 * ⛔ 短标题不要用它（标题不跨段，多这一步只是白跑；且那里已有 `decodeHtmlText` 的既有口径）。
 */
export function decodeHtmlBlockText(raw: unknown): string {
    return decodeHtmlText(String(raw ?? '').replace(BLOCK_BOUNDARY, ' '));
}
