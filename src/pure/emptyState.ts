// 空状态判定（纯逻辑：区分「库为空」与「筛选无结果」；无 obsidian、无 DOM）
//
// 为什么必须分开：此前两种情况共用一句「书架还是空的 — 点「＋ 添加」录入第一本书」——
// 用户明明是**筛选 / 搜索**把结果筛空了，却被告知「库是空的、去添加」，指错了方向。
// 本模块只回答「该显示哪一种空态、文案与建议动作是什么」，渲染由视图层完成。

export type EmptyKind = 'no-data' | 'no-match';

export interface EmptyStateInput {
    /** 筛选前的池子大小（= 当前**视图池**的条目数）。为 0 才是真的「这一类还没有条目」 */
    poolCount: number;
    /** 筛选 + 搜索后剩下的条数 */
    filteredCount: number;
    /** 锁定类型（阅读 / 游戏 / 音乐页签）→ 决定「库为空」的措辞；聚合页签与单类型页签传 null / undefined */
    lockType?: string | null;
    /**
     * 🔴 #444f 新增：**视图池标识** —— 「我现在在看哪一类」，决定 no-data 时选哪句措辞。
     *
     * 取值形态（MediaList 侧拼好）：`book` / `book:comic` / `movieTv:movie` / `game` / `music` …
     * ⚠️ 它与 `typeLabel` / `kindLabel` **不是一回事**：那两个是 no-match 时「回显生效条件」的**显示名**，
     *    而本字段是 no-data 时「选措辞」的**键**。同一分类在当前视图里为空，是「这一类还没有条目」，
     *    不是「筛选没命中」—— 这是两句话。
     */
    poolKey?: string;
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

/**
 * 「这一类还没有条目」的措辞（key = 视图池标识，见 `poolKey`；回退用 `lockType` 查同一张表）。
 *
 * 🔴 #444f（2026-09-30 用户报「漫画视图下空状态怎么不跟随其他视图」）：原来只有 book/game/music 三条
 *    + 一句泛化兜底，于是有两处说着**错话**：
 *    ⑴ 阅读页签切到**空的子分类**（漫画 0 本）⇒ 池子取的是「书」这一层（非 0）⇒ 判成 **no-match**，
 *       显示「没有匹配的条目 / 分类：漫画 / [清除筛选]」—— 可子分类是**视图**不是筛选，清筛选也只是回到全部；
 *    ⑵ 影视页签切到**空的类型**（电影 0 部）⇒ 池子为 0 ⇒ 落到泛化兜底「库还是空的」，而**库里明明有电视剧**。
 *    ⇒ 现在按「视图池」逐类给措辞，泛化兜底只留给真·未知视图。
 */
const NO_DATA_TITLE: Record<string, string> = {
    // ── 阅读页签（含子分类）──
    book: '书架还是空的 — 点「＋ 添加」录入第一本书',
    'book:book': '文学书架还是空的 — 点「＋ 添加」录入第一本文学书',
    'book:novel': '网文架还是空的 — 点「＋ 添加」录入第一本网文',
    'book:comic': '漫画架还是空的 — 点「＋ 添加」录入第一本漫画',
    // ── 影视聚合页签（含类型 chips）──
    movieTv: '影视库还是空的 — 点「＋ 添加」录入第一部影视作品',
    'movieTv:movie': '还没有电影 — 点「＋ 添加」录入第一部电影',
    'movieTv:tv': '还没有电视剧 — 点「＋ 添加」录入第一部电视剧',
    'movieTv:anime': '还没有动画 — 点「＋ 添加」录入第一部动画',
    // ── 单类型页签 ──
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
 * 注意池子口径：`poolCount` 应传「**视图池**」—— 页签 + 子分类 / 类型 chips，**不含**状态 / 题材 / 关键词。
 * 否则「切到空的子分类 / 空类型」会被误判成「筛选没命中」（提示去清筛选），
 * 或反过来被误判成「整个库是空的」（提示去添加，可库里明明有别的类型）。
 */
export function resolveEmptyState(input: EmptyStateInput): EmptyState | null {
    const filtered = Math.max(0, Math.floor(input.filteredCount) || 0);
    if (filtered > 0) return null;

    const pool = Math.max(0, Math.floor(input.poolCount) || 0);
    if (pool === 0) {
        return {
            kind: 'no-data',
            // 先按「视图池」查，再回退按页签查（兼容只传 lockType 的老调用），最后才是通用兜底
            title: NO_DATA_TITLE[input.poolKey ?? ''] ?? NO_DATA_TITLE[input.lockType ?? ''] ?? NO_DATA_FALLBACK,
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
