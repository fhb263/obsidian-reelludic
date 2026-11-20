/**
 * 标签筛选（m18442 ①）—— 统计页词云点击一个标签后，回库列表并只显示带该标签的条目。
 *
 * 🔴 为什么要有这个模块：
 *   首页的「按标签筛」原本**只有一条路** —— 切到一个 `kind === 'custom'` 的自定义视图
 *   （见 `pure/mediaViews.entryMatchesTags`）。那条路是**持久**配置：点一次词云就往用户
 *   设置里塞一个新视图，既脏又不可撤销。词云点击是**临时**动作（看完就清），
 *   所以必须另开一路「会话内标签筛选」，与视图筛选**叠加**，不落盘、不进 settings。
 *
 * ⚠️ 与 `pure/wordCloud.normalizeTag` 的关系：词云聚合与这里的比较**必须同口径**，
 *   否则「词云上明明有这个标签，点了却筛出 0 条」。归一规则见 `normalizeTagFilter`。
 */

/** 匹配时折叠的空白（含全角空格）—— 与 `wordCloud.normalizeTag` 同口径 */
const TAG_SPACE = /[\s\u3000]+/g;

/**
 * 标签的**比较键**：去首尾空白、折内部空白、转小写。
 *
 * 🔴 只做「大小写 + 空白」这一层归一，**不做** `NFKC` / 去标点：
 *   标签是用户手填的自由词，`C++` 与 `C#` 必须仍是两个不同标签；
 *   而 `日常` 与 `日常 ` 是同一个。过强的归一会把用户认为不同的标签并成一个。
 */
export function normalizeTagFilter(raw: unknown): string {
    return String(raw ?? '').replace(TAG_SPACE, ' ').trim().toLowerCase();
}

/** 把「逗号 / 斜杠 / 顿号」分隔的标签串切成数组（与条目表单提交侧同口径） */
export function splitTagText(raw: unknown): string[] {
    return String(raw ?? '')
        .split(/[\/、,，;；]+/)
        .map((s) => s.replace(TAG_SPACE, ' ').trim())
        .filter((s) => s.length > 0);
}

/** 这条条目是否带某个标签（大小写 / 空白不敏感；空标签恒 false） */
export function entryHasTag(entry: { tags?: string[] | null } | null | undefined, tag: string): boolean {
    const want = normalizeTagFilter(tag);
    if (!want) return false;
    const tags = entry?.tags;
    if (!Array.isArray(tags)) return false;
    for (const t of tags) if (normalizeTagFilter(t) === want) return true;
    return false;
}

/**
 * 按标签过滤条目（`tag` 为空 ⇒ **原样返回同一个数组引用**）。
 *
 * 🔴 空标签返回 `entries` 本身、不返回新数组：调用方多把它接在 `$:` 里，
 *   每帧造一个新数组会让下游 `{#each}` 全量重渲染（封面白闪）。
 *
 * ⚠️ 形参与返回都必须是**可变** `T[]`（不是 `readonly T[]`）：调用方 `HomeView` 直接把结果
 *   喂给 `MediaList` 的 `entries`，那个 prop 的类型是 `MediaEntry[]`，传 `readonly` 数组
 *   会在 svelte-check 报 `The type 'readonly MediaEntry[]' is 'readonly' and cannot be
 *   assigned to the mutable type 'MediaEntry[]'`。保持同一引用与保持可变类型两者都要。
 */
export function filterEntriesByTag<T extends { tags?: string[] | null }>(entries: T[], tag: string): T[] {
    if (!normalizeTagFilter(tag)) return entries;
    return entries.filter((e) => entryHasTag(e, tag));
}

/** 一个标签能筛出的条目数（词云悬停提示用；也给测试当断言锚） */
export function tagHitCount(entries: readonly { tags?: string[] | null }[], tag: string): number {
    if (!normalizeTagFilter(tag)) return 0;
    let n = 0;
    for (const e of entries) if (entryHasTag(e, tag)) n += 1;
    return n;
}

/** 顶部那枚「标签筛选：X ✕」的文案（清空按钮的 aria/tip 也用它） */
export function tagFilterLabel(tag: string): string {
    const t = String(tag ?? '').replace(TAG_SPACE, ' ').trim();
    return t ? `标签筛选：${t}` : '';
}

/** 切换：点同一个标签再点一次 = 取消（幂等，便于词云连点） */
export function toggleTagFilter(current: string, next: string): string {
    const a = String(current ?? '').trim();
    const b = String(next ?? '').trim();
    if (!b) return '';
    return normalizeTagFilter(a) === normalizeTagFilter(b) ? '' : b;
}
