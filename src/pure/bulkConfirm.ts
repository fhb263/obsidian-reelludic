// 批量应用前置确认文案（纯逻辑，无 obsidian 依赖，可单测）
//
// 背景：批量改状态 / 评分 / 标签是一次性作用于多条的操作，且会连带重写这些条目的详情笔记。
// 用户决定不为批量操作做撤销栈（要重建笔记与目录项，冲突风险高），改为**应用前确认**——
// 把关口前移到「动手之前」，比事后回滚更可靠。本模块只负责把「将要对多少项、改什么」
// 说清楚，不碰 UI、不碰弹窗。

export interface BulkApplyInput {
    /** 选中条目数 */
    count: number;
    /** 目标状态的中文标签（如「已看」「想看」）；空白视为不改状态 */
    statusLabel?: string;
    /**
     * 目标评分：
     *  - `undefined` / `0` → 不改评分（0 是下拉的「未选择」占位）
     *  - `null` → 清除评分
     *  - `1`~`5` → 设为该星级
     */
    rating?: number | null;
    /** 要追加的标签（调用前可含空白/重复项，本函数负责清洗） */
    tags?: string[];
}

/** 清洗标签：去首尾空白 → 丢弃空串 → 去重保序 */
function cleanTags(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
        const t = (raw ?? '').trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

/**
 * 生成批量应用的确认文案；无可应用项（或没有选中条目）→ null，调用方不应弹窗。
 *
 * 文案为**单行**：ConfirmModal 的描述区是居中的纯文本节点，不解析换行，长句由 CSS 自然折行。
 */
export function describeBulkApply(input: BulkApplyInput): string | null {
    const count = Math.max(0, Math.floor(input.count) || 0);
    if (count === 0) return null;

    const statusLabel = (input.statusLabel ?? '').trim();
    const tags = cleanTags(input.tags ?? []);
    const rating = input.rating;

    const lines: string[] = [];
    if (statusLabel) lines.push(`状态改为「${statusLabel}」`);
    if (rating === null) lines.push('清除个人评分');
    else if (typeof rating === 'number' && rating > 0) lines.push(`个人评分改为 ${rating}★`);
    if (tags.length > 0) lines.push(`追加标签：${tags.join('、')}`);
    if (lines.length === 0) return null;

    return `将对 ${count} 项执行：${lines.join('；')}。会一并更新这些条目的详情笔记，且不可一键撤销。`;
}
