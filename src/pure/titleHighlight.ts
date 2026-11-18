/**
 * 搜索结果关键词高亮（用户 m07854 ⑪ ③：「搜索结果里高亮搜索词（卡片标题匹配关键词做**黄色高亮**）」）。
 *
 * 🔴 为什么不直接 `{@html}` 拼 `<mark>`：标题来自用户输入（条目名可以叫 `<img onerror=…>`），
 *    拼进 HTML 就是一处注入面。这里只做**切片**，返回 `{ text, hit }[]`，由模板用 `{#each}`
 *    渲染成文本节点 + `<mark>` 元素 —— 全程不经过 HTML 解析，天然安全。
 *
 * 🔴 为什么判定要与 `pure/search.matchesSearch` 同口径：搜索能命中、标题却没高亮，
 *    或者反过来「高亮了但没有这条结果」，都是明显的自相矛盾。但**只高亮标题**（用户原话
 *    「卡片标题匹配关键词」）—— `matchesSearch` 还会命中导演/演员/类型等字段，那些命中
 *    在这条标题里当然找不到词，此时整条标题原样返回（`hit` 恒 false），不是 bug。
 *
 * ⚠️ 大小写不敏感、**多次命中全部标注**（标题里出现三次就标三处），但**不递归**：
 *    切完之后不再对片段重新匹配（否则 needle 为空串会死循环）。
 */

/** 高亮片段：一段纯文本 + 它是否命中搜索词 */
export interface TitleSegment {
    text: string;
    hit: boolean;
}

/**
 * 把标题按搜索词切成「命中 / 未命中」片段。
 *
 * @param title 原始标题（原样输出，⛔ 不 trim、不折叠空白 —— 卡片上要显示的就是它）
 * @param query 用户输入（内部才 trim；空串 ⇒ 原样一段、`hit: false`）
 *
 * 边界：
 *  · `query` 为空 / 全空白 ⇒ 返回 `[{ text: title, hit: false }]`（含 title 为空串的情形）
 *  · 标题里一处都没命中 ⇒ 同样返回单段 `hit: false`（不返回空数组，调用方不必判空）
 *  · 命中多次 ⇒ 逐段切开，命中段 `hit: true`
 */
export function splitTitleByQuery(title: string, query: string): TitleSegment[] {
    const raw = title ?? '';
    const needle = (query ?? '').trim();
    if (!needle || !raw) return [{ text: raw, hit: false }];

    // 小写化后逐个定位；用 `raw` 的**原始大小写**切片，保证显示与库里一模一样
    const haystack = raw.toLowerCase();
    const lowered = needle.toLowerCase();

    const out: TitleSegment[] = [];
    let from = 0;
    for (;;) {
        const at = haystack.indexOf(lowered, from);
        if (at < 0) break;
        if (at > from) out.push({ text: raw.slice(from, at), hit: false });
        out.push({ text: raw.slice(at, at + lowered.length), hit: true });
        from = at + lowered.length;
        // 防御：needle 非空 ⇒ lowered 必非空 ⇒ 每轮至少前进 1，不会死循环；
        // 仍显式挡住 from 不前进的情形（未来若改成允许空 needle 也不会卡住）。
        if (lowered.length === 0) break;
    }
    if (from < raw.length) out.push({ text: raw.slice(from), hit: false });
    return out.length > 0 ? out : [{ text: raw, hit: false }];
}

/**
 * 这段标题是否**真的**含搜索词（供调用方决定是否走切片渲染）。
 * 与 `splitTitleByQuery` 同口径：空 query 恒 false。
 */
export function titleHasQuery(title: string, query: string): boolean {
    const raw = title ?? '';
    const needle = (query ?? '').trim();
    if (!needle || !raw) return false;
    return raw.toLowerCase().includes(needle.toLowerCase());
}
