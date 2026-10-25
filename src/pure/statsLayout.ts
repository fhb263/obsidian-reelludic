/**
 * 统计页版式：**区块的显示顺序 + 网格版式**（#657）。
 *
 * ## 用户口径
 * 「统计页的所有元素支持自由排序，自适应」——两块要求：
 *   ① **顺序自选**：五个区块（核心指标 / 动态 / 趋势 / 分类概览 / 评分看板）可自由拖动排序并记忆；
 *   ② **自适应**：窄屏自动退单列、宽屏按内容宽自动排布（⛔ 不再写死「趋势 50% + 概览 50%」）。
 *
 * ## 🔴 设计取舍（重要，改动前先读）
 * 原来的骨架是「三层倒金字塔」：核心指标独占一行、趋势与概览**并排**（hard-code 在同一行）、
 * 看板压底。一旦允许自由排序，「并排」就不再成立 —— 排到后面的区块要被塞进别人旁边的空档里，
 * 顺序就不再是用户拖出来的顺序。
 * ⇒ **扁平化**：五个区块按顺序**自上而下**排（单列），顺序 = 用户拖的顺序，**没有二义性**。
 *    自适应落在「**单列内的响应式网格**」上（`grid-template-columns: repeat(auto-fit, minmax(…))`），
 *    而不是"把两个区块拼在同一行"。
 * ⚠️ 这推翻了 #640 定的默认版式（趋势 + 概览并排）—— 用户这次点名「所有元素自由排序」，以最新为准；
 *    **默认顺序沿用原来的视觉顺序**（指标 → 动态 → 趋势 → 概览 → 看板），所以不改设置的用户观感基本不变。
 *
 * ## 落盘口径
 * 与默认逐位一致 ⇒ **删掉该键**（⛔ 不存一份缺省副本），这样以后新增区块能自动落在缺省位置。
 * 未知键丢弃、缺失键按缺省**补到末尾** —— 与 `pure/fieldOrder` 同一条口径。
 */

/** 统计页的五个区块（键 = 持久化用的稳定 id，⛔ 别改这些字符串） */
export type StatsBlockKey = 'hero' | 'feed' | 'trend' | 'overview' | 'board';

/** 缺省顺序 = 原来的视觉顺序（三层倒金字塔自上而下） */
export const STATS_BLOCK_DEFAULTS: readonly StatsBlockKey[] = ['hero', 'feed', 'trend', 'overview', 'board'];

/** 展示名（拖动把手 / 无障碍标签用） */
export const STATS_BLOCK_LABELS: Readonly<Record<StatsBlockKey, string>> = {
    hero: '核心指标',
    feed: '动态',
    trend: '月度趋势',
    overview: '分类概览',
    board: '评分看板',
};

const ALL = new Set<string>(STATS_BLOCK_DEFAULTS);

/** 窄屏阈值：低于这个宽度一律单列（与 `min-basis` 的最宽档对齐，避免"刚好塞不下"的抖动） */
export const STATS_NARROW_MAX = 719;

/**
 * 归一化顺序。`undefined` / 非法值 ⇒ 缺省；未知键丢弃；缺失键按缺省追加到末尾。
 * ⚠️ 追加而不是丢弃：以后新增一个区块时，老用户的顺序表里没有它 —— 补到末尾才**看得见**。
 */
export function normalizeStatsOrder(v: unknown): StatsBlockKey[] {
    const out: StatsBlockKey[] = [];
    const seen = new Set<string>();
    if (Array.isArray(v)) {
        for (const k of v) {
            if (typeof k !== 'string' || !ALL.has(k) || seen.has(k)) continue;
            seen.add(k);
            out.push(k as StatsBlockKey);
        }
    }
    for (const k of STATS_BLOCK_DEFAULTS) if (!seen.has(k)) out.push(k);
    return out;
}

/** 是否就是缺省顺序（是 ⇒ 不必落盘，将来新增区块能自动落在缺省位置） */
export function isDefaultStatsOrder(order: readonly string[]): boolean {
    return order.length === STATS_BLOCK_DEFAULTS.length
        && STATS_BLOCK_DEFAULTS.every((k, i) => order[i] === k);
}

/**
 * 两列模式：拖动时的**落点描述**。
 * 返回值给设置页 / 视图用来决定"插到 target 的前面还是后面"：
 *   · `'before'` —— 指针在目标区块的**上半**（或左半）⇒ 插到它前面
 *   · `'after'`  —— 在**下半**（或右半）⇒ 插到它后面
 * ⚠️ 单列排列下用**纵向中线**判断；以后若改回多列，再补横向判断（`axis: 'x'`），
 *    所以这里留一个 `axis` 参数而不是写死。
 */
export function dropSide(rect: { top: number; bottom: number; left: number; right: number }, x: number, y: number, axis: 'y' | 'x' = 'y'): 'before' | 'after' {
    const mid = axis === 'x' ? rect.left + (rect.right - rect.left) / 2 : rect.top + (rect.bottom - rect.top) / 2;
    return (axis === 'x' ? x : y) < mid ? 'before' : 'after';
}

/**
 * 🔴🔴 #658（用户：「怎么没设计自由左右布局啊？」）：**两列模式下的落点**。
 *
 * 与 `dropSide` 的区别：
 *   · 纵向仍按**上 / 下**判断（插到目标前 / 后）；
 *   · 横向给出**左 / 右半栏**（`col: 0 | 1`），视图据此把被拖的区块放到目标那一侧的半栏里。
 * 具体 `before/after` 与 `col` 的组合语义（由 `moveStatsBlockTwoCols` 落实）：
 *   · 拖到目标**右半** ⇒ 落在目标那一行的**右侧**（并排）；
 *   · 拖到目标**左半** ⇒ 落在目标那一行的**左侧**（并排，靠前）；
 *   · 拖到目标的**上缘 / 下缘**（纵向进入 20% 以内）⇒ 整行插入到它前面 / 后面（不并排）。
 *     ⚠️ 这条「边缘带」是必须的 —— 否则任何位置都会被判成"并排"，用户没法插到两行之间。
 */
export type StatsDropSide = 'before' | 'after';

export interface StatsDropTarget {
    key: StatsBlockKey;
    side: StatsDropSide;
    /** 0 = 左半栏，1 = 右半栏（只对"并排"有意义） */
    col: 0 | 1;
    /** 边缘带：true ⇒ 整行插入（不并排） */
    fullRow: boolean;
}

/** 边缘带占高度的比例（上下各占这么多 ⇒ 判"整行插入"） */
export const STATS_EDGE_BAND = 0.2;

export function dropTargetOf(
    rect: { top: number; bottom: number; left: number; right: number },
    x: number,
    y: number,
): Pick<StatsDropTarget, 'side' | 'col' | 'fullRow'> {
    const h = rect.bottom - rect.top;
    const band = h * STATS_EDGE_BAND;
    // 上缘 / 下缘 ⇒ 整行插入
    if (y < rect.top + band) return { side: 'before', col: 0, fullRow: true };
    if (y > rect.bottom - band) return { side: 'after', col: 0, fullRow: true };
    // 中间 ⇒ 按左右半栏并排
    const midX = rect.left + (rect.right - rect.left) / 2;
    return { side: x < midX ? 'before' : 'after', col: x < midX ? 0 : 1, fullRow: false };
}

/**
 * 两列 + 并排时的**顺序计算**。
 *
 * 🔴 形状：`items` 是 `{ key, col }` 的序列（`col` 只影响显示，不影响顺序语义）。
 *    `fullRow` 的插入 = 直接插到目标的前 / 后；`并排` 的插入 = 插到目标的前 / 后**紧邻**那一格
 *    （视图中靠 CSS grid 的 `grid-column` 让它们排在同一行）。
 * ⚠️ 真实行号由 CSS grid 自动排布决定（`grid-auto-flow: row dense`），
 *    这里只保证"数组顺序"= 用户期望的阅读次序。
 */
export function moveStatsBlockTwoCols(
    order: readonly StatsBlockKey[],
    from: StatsBlockKey,
    target: StatsDropTarget,
): StatsBlockKey[] {
    if (from === target.key) return [...order];
    if (!order.includes(from) || !order.includes(target.key)) return [...order];
    const without = order.filter((k) => k !== from);
    const at = without.indexOf(target.key);
    if (at < 0) return [...order];
    // 目标那一行靠左时，并排到右边 = 插到它后面；靠右时并排到左边 = 插到它前面
    let side = target.side;
    if (!target.fullRow) side = target.col === 1 ? 'after' : 'before';
    without.splice(side === 'before' ? at : at + 1, 0, from);
    return without;
}

/**
 * 把 `from` 挪到 `to` 的某一侧，返回**新数组**（⛔ 不改入参 —— 调用方拿它直接落盘）。
 * 找不到键时原样返回（拖动数据脏了也不炸）。
 */
export function moveStatsBlock(
    order: readonly StatsBlockKey[],
    from: StatsBlockKey,
    to: StatsBlockKey,
    side: 'before' | 'after',
): StatsBlockKey[] {
    if (from === to) return [...order];
    // 🔴 两个键都必须**本来就在表里**：只查目标不查来源的话，一个脏的 `from`（拼错 / 旧版本残留）
    //    会被**插进**结果里变成第六个区块（单测当场抓到）。拖动数据脏了宁可不动，⛔ 也别污染顺序表。
    if (!order.includes(from) || !order.includes(to)) return [...order];
    const without = order.filter((k) => k !== from);
    const at = without.indexOf(to);
    if (at < 0) return [...order];
    without.splice(side === 'before' ? at : at + 1, 0, from);
    return without;
}

/**
 * 🔴 **自适应**：给出当前宽度下每个区块该占几列。
 *
 * 规则（⛔ 别在组件里再写一遍阈值）：
 *   · 宽度 < `STATS_NARROW_MAX` ⇒ 一律 **1 列**（窄屏单列，顺序照旧）；
 *   · 否则按区块**内容宽度需求**给档：核心指标 / 趋势 / 概览 = 2 列（并排两块），
 *     动态 / 评分看板 = 1 列（占满整行 —— 它们内部本来就是横向列表，切一半只会挤成一团）。
 * ⚠️ 2 列在窄屏下会被 CSS 的 `auto-fit` 自动折成 1 列，所以这里给的是**上限**，不是硬约束。
 */
export function statsBlockSpan(key: StatsBlockKey, width: number): 1 | 2 {
    if (width < STATS_NARROW_MAX) return 1;
    return key === 'feed' || key === 'board' ? 1 : 2;
}

/**
 * 🔴🔴 #661（用户：「月度看完趋势和分类概览怎么不能自适应一整行，而且动态、核心指标我希望也能半行显示」）
 * **列宽分配 —— 改成"内容优先，放不下才整行"**。
 *
 * 上一版是**硬编码名单**（hero / feed / board 永远整行，其余永远半行）⇒ 用户实测两头都不对：
 *   趋势与概览明明能撑满一行却只给半行（右半边空着）；而核心指标、动态明明可以半行却永远占满。
 *
 * 现在的规则（全部按**内容的最小可用宽度**判断，⛔ 不再有"某个区块天生整行"的名单）：
 *   · 宽度 < `STATS_NARROW_MAX` ⇒ 一律 1 列（窄屏单列）；
 *   · 半栏宽度 = `(width - gap) / 2`；若它 < 该区块的 `minHalf` ⇒ 该块**占满整行**（放不下就别硬塞）；
 *   · 否则给半行 —— 由用户拖拽决定它和谁并排。
 *
 * `minHalf`（半栏最小可用宽度，实测自各块的内部结构）：
 *   · 核心指标 `hero` 520 —— 「1 主 + 2×2 辅」在窄于 520px 时会挤成一条细长条；
 *   · 动态 `feed` 420 —— 行内是「时间 · 类型 · 标题 · 附注」四段；
 *   · 趋势 `trend` 380 —— 12 个月 × 柱位；
 *   · 概览 `overview` 360 —— Tab 栏 + 指标格。
 * ⚠️ 这些数字是**下限**不是目标值：只用于"能不能放下"，⛔ 别拿来当固定列宽。
 */
export const STATS_BLOCK_MIN_HALF: Readonly<Record<StatsBlockKey, number>> = {
    hero: 520,
    feed: 420,
    trend: 380,
    overview: 360,
    board: 620, // 评分看板每行是「评分列 + 封面流」，半栏会把封面流挤成一列
};

/** 两列网格的列间距（与 CSS 的 `gap` 同值；断言钉着） */
export const STATS_GRID_GAP = 12;

/** 半栏的可用宽度（两列网格里每一格的实际宽度） */
export function statsHalfWidth(width: number): number {
    return (width - STATS_GRID_GAP) / 2;
}

export function statsBlockCols(key: StatsBlockKey, width: number): 1 | 2 {
    if (width < STATS_NARROW_MAX) return 1;
    // 🔴 内容优先：半栏放得下就给半行（可以和邻居并排），放不下才整行
    return statsHalfWidth(width) >= STATS_BLOCK_MIN_HALF[key] ? 1 : 2;
}
