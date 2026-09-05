// 多源搜索结果合并与相似度排序（纯逻辑，无 obsidian 依赖，可单测）

/** 多源合并去重：按「来源 + 标题归一化（小写 + 去空白）」去重——
 *  同源同名才去重，跨源同名（如 Google「黑客」+ 豆瓣「黑客」）都保留，实现 20+20 并存对比；主源结果在前 */
export function mergeBySource<T extends { title: string; source?: string }>(base: T[], extra: T[]): T[] {
    const seen = new Set<string>();
    const merged: T[] = [];
    for (const r of [...base, ...extra]) {
        const title = r.title.trim().toLowerCase().replace(/\s+/g, '');
        if (!title) continue;
        const k = `${r.source ?? ''}|${title}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(r);
    }
    return merged;
}

/** 按搜索词相似度排序：标题与 query 完全相等 > 前缀 > 包含 > 首字模糊 > 无关；
 *  同分保持原顺序（Array.sort 稳定，主源在前）。query 为空返回原数组 */
export function sortByRelevance<T extends { title: string }>(items: T[], query: string): T[] {
    const q = query.trim().toLowerCase().replace(/\s+/g, '');
    if (!q) return items;
    const score = (title: string): number => {
        const t = title.trim().toLowerCase().replace(/\s+/g, '');
        if (t === q) return 4;
        if (t.startsWith(q)) return 3;
        if (t.includes(q)) return 2;
        if (t.includes(q[0])) return 1;
        return 0;
    };
    return [...items].sort((a, b) => score(b.title) - score(a.title));
}
