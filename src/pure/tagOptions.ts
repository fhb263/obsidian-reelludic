/**
 * 视图级**标签**筛选的池构建（用户 m19924 ①）。
 *
 * 需求原话：「再在首页视图筛选栏题材旁边加个筛选的"标签"（样式和交互逻辑和题材筛选一样）」。
 *
 * 🔴 与 `pure/genreFilter` 的**分工**（⛔ 别把两者合并）：
 *   · 题材 = frontmatter 的 `genres` 字段，是一组**受控词表**（豆瓣/Steam 回填）；
 *   · 标签 = frontmatter 的 `tags` 字段，是用户**手填的自由词**。
 *   两者在条目里是**两个不同字段**，池也必须是两个独立的池 —— 合并会让「题材：科幻」和
 *   「标签：科幻」在同一个下拉里出现两行同名选项，用户点了不知道筛的是哪一个。
 *
 * 🔴 与 `pure/tagFilter` 的**分工**：
 *   · `tagFilter` 是 m18442 那条「统计页词云点一下 → 会话内临时筛一个标签」的单值通道；
 *   · 本模块是多选池（与题材筛选同交互）。
 *   **比较口径必须共用** `tagFilter.normalizeTagFilter`（大小写 + 空白归一，不 NFKC、不去标点）
 *   —— 否则「词云上明明有这个标签，工具栏里点了却筛出 0 条」。⛔ 别在这里重写一遍归一规则。
 */
import { normalizeTagFilter } from 'pure/tagFilter';

/**
 * 「无标签」桶的保留键：含 NUL ⇒ 真实标签不可能等于它（用户输入里不会有）。
 * 与 `GENRE_NONE_KEY` 同一手法，⛔ 别换成空串（空串是「没选」的哨兵）。
 */
export const TAG_NONE_KEY = '\u0000__tag_none__';
export const TAG_NONE_LABEL = '无标签';

export interface TagOption {
    /** 已选集合里存的值（真实标签**保持用户原始写法**；无标签是保留键） */
    key: string;
    label: string;
    /** 在本视图池里的条目数 */
    count: number;
}

/** 条目标签值集合：类型容错 → trim → 去空 → 按比较键去重（保留首次出现的原始写法） */
export function tagValuesOf(e: { tags?: string[] | null } | null | undefined): string[] {
    const raw = e?.tags;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of raw) {
        if (typeof t !== 'string') continue;
        const v = t.replace(/[\s\u3000]+/g, ' ').trim();
        if (!v) continue;
        // 字面「无标签」不作为真实标签值：否则面板里会出现两行同名（合成桶 + 同名字面值）
        if (v === TAG_NONE_LABEL) continue;
        const key = normalizeTagFilter(v);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(v);
    }
    return out;
}

/**
 * 构建标签池：频次降序 → 名称拼音序（并列时，保证结果不随输入顺序漂移）；
 * 无标签条目单独算「无标签」，**恒置末位**（没有这类条目时该行不出现）。
 *
 * ⚠️ 频次按**比较键**归并（`C++` 与 `c++ ` 算同一个标签，计数合并），
 *   但 `label` 取首次出现的原始写法（用户看到的是他自己敲的那个大小写）。
 */
export function buildTagOptions(entries: ReadonlyArray<{ tags?: string[] | null }>): TagOption[] {
    const counts = new Map<string, { label: string; count: number }>();
    let none = 0;
    for (const e of entries) {
        const vals = tagValuesOf(e);
        if (vals.length === 0) {
            none++;
            continue;
        }
        for (const v of vals) {
            const key = normalizeTagFilter(v);
            const cur = counts.get(key);
            if (cur) cur.count += 1;
            else counts.set(key, { label: v, count: 1 });
        }
    }
    const opts: TagOption[] = [...counts.entries()]
        .map(([key, v]) => ({ key, label: v.label, count: v.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
    if (none > 0) opts.push({ key: TAG_NONE_KEY, label: TAG_NONE_LABEL, count: none });
    return opts;
}

/**
 * 命中判定：空选 = 这一维不存在（恒真）；多选 = OR；选了「无标签」则无标签条目也算命中。
 *
 * ⚠️ `selected` 约定存**比较键**（`buildTagOptions` 的 `key`），但这里仍会对它再归一一次：
 *    调用方若误传了显示名（`C++` 而不是 `c++`），归一后照样命中 —— 少一处「点了没反应」的哑坑。
 *    代价只是一次 `toLowerCase`，而错配的代价是用户以为筛选坏了。
 */
export function matchesTags(e: { tags?: string[] | null }, selected: readonly string[]): boolean {
    if (!selected || selected.length === 0) return true;
    const sel = new Set(selected.map((s) => normalizeTagFilter(s)));
    const vals = tagValuesOf(e);
    if (vals.length === 0) return sel.has(normalizeTagFilter(TAG_NONE_KEY));
    return vals.some((v) => sel.has(normalizeTagFilter(v)));
}

/**
 * 胶囊文案：未选 → 「全部」；1 项 → 该标签名；≥2 项 → 「池序第一个 + N-1」。
 * 池序（频次降序）而非勾选先后 —— 同一组已选无论怎么点，显示都一致（与题材筛选 D-6 同口径）。
 */
export function tagPillLabel(options: readonly TagOption[], selected: readonly string[]): string {
    const total = selected?.length ?? 0;
    if (total === 0) return '全部';
    const inPool = options.filter((o) => selected.includes(o.key));
    const first = inPool[0]?.label ?? selected[0];
    return total === 1 ? first : `${first}+${total - 1}`;
}
