// 统计页「评分看板」的**纯逻辑**（#635 ④，用户 2026-10-15）。
//
// 责任：把「条目集合」投影成「11 个评分行 + 每行的作品」，以及「分类页签与计数」「拖放落点判定」
// —— 全部无 DOM / 无 obsidian 依赖，可单测。视图（`RatingBoard.svelte`）只做渲染与拖拽接线。
//
// 🔴 用户规格（原话要点）：
//   · 卡片式主体容器；严格表格对齐，分「评分标签区 / 分数区 / 作品展示区」三大横向模块；
//   · 顶部**内容分类 Tabs**（所有 / 文学 / 网文 / 漫画 / 动画 / 剧集 / 电影 / 游戏 / 音乐），
//     选中项高亮 + **实时统计数字 Badge**；
//   · **10 行**（5 星 → 0.5 星），每行高度统一；左侧**星级锚点**占约 15%，大字号主星数 + 小字号半星数；
//   · 右侧主体 = 拖放落点：未分配时显示浅灰「暂无作品」，已分配时显示封面（自适应裁剪）；
//   · **六色阶**：顶级(5.0–4.5) 黄 / 高质(4.0–3.5) 红 / 普通(3.0–2.5) 紫 / 及格(2.0–1.5) 蓝 /
//     低分(1.0–0.5) 绿 / **灰色留给空数据或未评分**。
//
// 🔴 #635 追问四项裁定：
//   ⑴ **加一行「未评分」**（rating === 0 的作品落这里；拖进这一行 = **清除评分**）；
//   ⑵ 拖放来源 = **看板自己列出的未评分池**（最低行就是池子，往上拖到某行即打分）；
//   ⑶ 拖入**立即落库**（不设二次确认，与本仓「就地保存」口径一致）；
//   ⑷ 同一行多张**横排 + 自动换行**（行高随内容自适应）。
import type { MediaEntry, EntryType, BookKind } from 'data/types';
import { RATING_STEPS, normalizeRating, type Rating } from 'pure/rating';

/** 一行 = 一个评分档（含「未评分」那一档，用 `rating === 0` 表示） */
export interface RatingRow {
    /** 该行的评分值（0 = 「未评分」行） */
    rating: Rating;
    /** 行左侧主星数（整数部分，如 4） */
    whole: number;
    /** 行左侧半星数（0 或 5 ⇒ 拼成 `.5`；`null` = 不显示，如「未评分」行） */
    half: number | null;
    /** 该行「未评分」专用的标记（行标题显示「未」而不是 0） */
    unrated: boolean;
    /** 颜色阶：六色阶 + 灰（供 CSS 类名用，⛔ 不在视图里再判一次阈值） */
    tone: BoardTone;
    /** 这一行里的作品（已排序；空数组 = 显示「暂无作品」） */
    items: MediaEntry[];
}

/**
 * 色阶档（六色阶 + 灰）。
 * 🔴 判据与用户给的分档**逐字对应**（顶级 5.0–4.5 / 高质 4.0–3.5 / 普通 3.0–2.5 / 及格 2.0–1.5 / 低分 1.0–0.5），
 *    ⛔ 别在视图层再写一遍阈值判断（两份必然漂）。
 */
export type BoardTone = 'gold' | 'red' | 'purple' | 'blue' | 'green' | 'gray';

/** 评分 → 色阶（用户六色阶口径） */
export function toneOf(rating: Rating): BoardTone {
    if (rating >= 4.5) return 'gold';
    if (rating >= 3.5) return 'red';
    if (rating >= 2.5) return 'purple';
    if (rating >= 1.5) return 'blue';
    if (rating >= 0.5) return 'green';
    return 'gray';
}

/**
 * 看板的**分类页签**（用户规格里的九项，顺序即 UI 顺序）。
 * 🔴 它与 `EntryType` **不是**一一对应：文学 / 网文 / 漫画三者都是 `type === 'book'`，
 *    靠 `bookKind` 区分（`pure/catalog` 的归一保证 bookKind 合法）。
 *    ⛔ 别用 `sourceGroupForType` 那套（那是**检索源**分组，含 comic 但不含 novel，用途不同）。
 */
export type BoardTab = 'all' | 'book' | 'novel' | 'comic' | 'anime' | 'tv' | 'movie' | 'game' | 'music';

export const BOARD_TABS: readonly BoardTab[] = [
    'all', 'book', 'novel', 'comic', 'anime', 'tv', 'movie', 'game', 'music',
];

export const BOARD_TAB_LABELS: Readonly<Record<BoardTab, string>> = {
    all: '所有',
    book: '文学',
    novel: '网文',
    comic: '漫画',
    anime: '动画',
    tv: '剧集',
    movie: '电影',
    game: '游戏',
    music: '音乐',
};

/**
 * 条目是否属于该页签。
 * 🔴 文学 / 网文 / 漫画三分支只看 `bookKind`；**缺 `bookKind` 的书籍按「文学」算**
 *    —— 与 `normalizeEntry` 的缺省口径一致（老书籍条目没有该键 = 文学），
 *    ⛔ 别让它们从三个页签里**同时漏掉**（那会让「所有」比三个子页签之和大，看着像丢数据）。
 */
export function entryInTab(e: MediaEntry, tab: BoardTab): boolean {
    if (tab === 'all') return true;
    if (tab === 'book' || tab === 'novel' || tab === 'comic') {
        if (e.type !== 'book') return false;
        const kind: BookKind = e.bookKind ?? 'book';
        return kind === (tab === 'book' ? 'book' : tab === 'novel' ? 'novel' : 'comic');
    }
    // anime / tv / movie / game / music 与 EntryType 同名（`tv` 对 `EntryType.tv`）
    return e.type === (tab as EntryType);
}

/** 分类页签的计数（「所有」= 全部；其余按上面的判据） */
export function tabCounts(entries: readonly MediaEntry[]): Record<BoardTab, number> {
    const out = { all: entries.length } as Record<BoardTab, number>;
    for (const t of BOARD_TABS) {
        if (t === 'all') continue;
        out[t] = entries.filter((e) => entryInTab(e, t)).length;
    }
    return out;
}

/**
 * 看板的行序（**从高到低**）：5 → 4.5 → … → 0.5，**最后**是「未评分」行。
 * 🔴 「未评分」放**最低行**（用户裁定「未评分在最低行显示，拖拽」）—— 它就是**待分配池**：
 *    往上看清自己有哪些还没打分，直接往上拖即可。
 */
export function boardRows(): RatingRow[] {
    const rows: RatingRow[] = [];
    // `RATING_STEPS` = [0, 0.5, …, 5]（低→高）⇒ 反向遍历并**跳过 0**（0 单独做「未评分」行）
    for (let i = RATING_STEPS.length - 1; i >= 0; i--) {
        const r = RATING_STEPS[i];
        if (r === 0) continue;
        const whole = Math.floor(r);
        const half = r - whole >= 0.5 ? 5 : null;
        rows.push({ rating: r, whole, half, unrated: false, tone: toneOf(r), items: [] });
    }
    rows.push({ rating: 0, whole: 0, half: null, unrated: true, tone: toneOf(0), items: [] });
    return rows;
}

/** 条目的行序键：评分归一后落哪一行（0 ⇒ 未评分行） */
export function rowKeyOf(e: MediaEntry): Rating {
    return normalizeRating(e.rating);
}

/** 行内作品的排序：同分时按标题（`localeCompare('zh')`，与音乐分组同口径），稳定可测 */
function byTitle(a: MediaEntry, b: MediaEntry): number {
    return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh');
}

/**
 * 把条目集合投影成 11 行（10 个评分档 + 未评分）。
 * @param tab 当前页签（`'all'` = 不过滤）
 */
export function buildBoard(entries: readonly MediaEntry[], tab: BoardTab = 'all'): RatingRow[] {
    const rows = boardRows();
    const bucket = new Map<number, MediaEntry[]>();
    for (const r of rows) bucket.set(r.rating, []);
    for (const e of entries) {
        if (!entryInTab(e, tab)) continue;
        const k = rowKeyOf(e);
        bucket.get(k)?.push(e);
    }
    for (const r of rows) {
        const list = bucket.get(r.rating) ?? [];
        list.sort(byTitle);
        r.items = list;
    }
    return rows;
}

/**
 * 拖放落点判定：拖到**这一行**上，意味着把评分改成什么？
 * 🔴 「未评分」行 ⇒ **清除评分**（0）—— 用户裁定「拖进去 = 清除评分」；
 *    ⛔ 别返回 `undefined`（那会让视图侧再判一次「是不是未评分行」，两份口径必然漂）。
 */
export function ratingForRow(row: RatingRow): Rating {
    return row.unrated ? 0 : row.rating;
}

/**
 * 拖拽中的那句提示（用户规格：「松开即评 3 星」）。
 * ⚠️ 「未评分」行说的是**清除**，不是「评 0 星」—— 后者读起来像给了一个很低的分数。
 */
export function dropHint(row: RatingRow, title?: string): string {
    const who = title ? `《${title}》` : '';
    if (row.unrated) return `松开即清除评分${who ? ` · ${who}` : ''}`;
    const stars = row.half !== null ? `${row.whole}.5` : String(row.whole);
    return `松开即评 ${stars} 星${who ? ` · ${who}` : ''}`;
}

/** 未评分计数（用户规格「未评分计数 0/0 需实时联动刷新」）—— 返回 `[未评分数, 总数]` */
export function unratedRatio(entries: readonly MediaEntry[], tab: BoardTab = 'all'): [number, number] {
    const scoped = entries.filter((e) => entryInTab(e, tab));
    const unrated = scoped.filter((e) => rowKeyOf(e) === 0).length;
    return [unrated, scoped.length];
}
