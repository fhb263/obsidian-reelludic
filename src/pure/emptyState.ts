// 空状态判定（纯逻辑：区分「库为空」与「筛选无结果」；无 obsidian、无 DOM）
//
// 为什么必须分开：此前两种情况共用一句「书架还是空的 — 点「＋ 添加」录入第一本书」——
// 用户明明是**筛选 / 搜索**把结果筛空了，却被告知「库是空的、去添加」，指错了方向。
// 本模块只回答「该显示哪一种空态、文案与建议动作是什么」，渲染由视图层完成。

export type EmptyKind = 'no-data' | 'no-match';

export interface EmptyStateInput {
    /** 筛选前的池子大小（= 当前类型 / 分类下的条目数）。为 0 才是真的「库为空」 */
    poolCount: number;
    /** 筛选 + 搜索后剩下的条数 */
    filteredCount: number;
    /** 锁定类型（阅读 / 游戏 / 音乐页签）→ 决定「库为空」的措辞；聚合页签与单类型页签传 null / undefined */
    lockType?: string | null;
    /** 生效中的条件显示名（'全部' / 未设置 → 不传） */
    typeLabel?: string;
    kindLabel?: string;
    /** 已选题材的显示名（如「推理+1」；未选任何题材 → 不传） */
    genreLabel?: string;
    statusLabel?: string;
    /** 搜索关键词原文 */
    query?: string;
}

export interface EmptyState {
    kind: EmptyKind;
    title: string;
    /** 次级说明（no-match 时回显生效条件） */
    hint?: string;
    /** 建议动作：add = 引导去添加；clear = 引导清除筛选 */
    action: 'add' | 'clear';
}

const NO_DATA_TITLE: Record<string, string> = {
    book: '书架还是空的 — 点「＋ 添加」录入第一本书',
    game: '游戏库还是空的 — 点「＋ 添加」录入第一款游戏',
    music: '歌单还是空的 — 点「＋ 添加」录入第一首歌',
};
const NO_DATA_FALLBACK = '库还是空的 — 点「＋ 添加」录入第一条条目';

/** 生效筛选条件回显（`类型：电影 · 状态：在看 · 关键词：沙丘`）；一条都没有 → undefined */
export function describeFilters(input: EmptyStateInput): string | undefined {
    const parts: string[] = [];
    if (input.typeLabel) parts.push(`类型：${input.typeLabel}`);
    if (input.kindLabel) parts.push(`分类：${input.kindLabel}`);
    // 题材紧挨分类（同属「分类维度」的收窄项）：只回显已选，未选不占位
    if (input.genreLabel) parts.push(`题材：${input.genreLabel}`);
    if (input.statusLabel) parts.push(`状态：${input.statusLabel}`);
    const q = input.query?.trim();
    if (q) parts.push(`关键词：${q}`);
    return parts.length ? parts.join(' · ') : undefined;
}

/**
 * 解析当前该显示哪一种空态；**有结果时返回 null**（调用方据此不渲染任何空态）。
 *
 * 判定顺序：先看有没有结果 → 再看池子是否为空 → 否则是「筛选没命中」。
 * 注意池子口径：poolCount 应传「类型 / 分类筛选之后、状态与关键词筛选之前」的数量，
 * 否则「切换类型后为空」会被误判成「库是空的」。
 */
export function resolveEmptyState(input: EmptyStateInput): EmptyState | null {
    const filtered = Math.max(0, Math.floor(input.filteredCount) || 0);
    if (filtered > 0) return null;

    const pool = Math.max(0, Math.floor(input.poolCount) || 0);
    if (pool === 0) {
        return {
            kind: 'no-data',
            title: NO_DATA_TITLE[input.lockType ?? ''] ?? NO_DATA_FALLBACK,
            action: 'add',
        };
    }

    return {
        kind: 'no-match',
        title: '没有匹配的条目',
        hint: describeFilters(input),
        action: 'clear',
    };
}
