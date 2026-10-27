// 系列（合集）评分 —— 纯逻辑，无 DOM / 无 obsidian，可单测。
//
// 🔴 由来（用户 2026-10-27）：「评分看板默认所有系列单计季分开展示太多了怎么办，
//    如果是合集展示是否加评分」⇒ 合集要**能自己带一个分**。
//
// 🔴 为什么是**独立字段**而不是「组内各条实时求平均」：
//   · 真实数据里组内分歧极大 —— `movie|周星驰` 18 部是「9 部 5 分 + 9 部未评分」，
//     `anime|海绵宝宝` 17 部只有首季 5 分、其余全未评分。**平均**会被未评分条目稀释成
//     一个谁也认不出的数（周星驰 18 部算出来 2.5，而用户想说的是「这个系列值 5」）。
//   · 「整个系列值几分」与「我看了其中几部、各打几分」是**两个概念**。
//     本仓「同一概念只准一份真源」的反面同样成立：**两个概念就得两个字段**，⛔ 别互相推算。
//   · 拖拽语义也随之清晰：拖**合集卡**只改合集分，⛔ **不**重置组内 N 条的评分
//     （那是不可逆操作 —— 用户手上一堆单条分数会被一次拖拽抹掉）。
//
// 🔴 存储位置：`Catalog.seriesRatings`，键 = **系列分组键**（`pure/seriesGroup.seriesKeyOf`
//    产出的 `type\u0001归一化名`）。⛔ 别换成「组内首条 id」当键 —— 首条一删分就丢了，
//    而分组键由「类型 + 系列名」决定，与哪一条当门面无关。
import type { MediaEntry } from 'data/types';
import { normalizeRating, type Rating } from 'pure/rating';
import { entryInTab, boardRows, toneOf, type BoardTab, type BoardTone } from 'pure/ratingBoard';
import { seriesKeyOf, foldSeries, type SeriesGroup } from 'pure/seriesGroup';

/** 合集分表：分组键 → 分数（0 不落库，见 `writeSeriesRating`）。
 *  ⚠️ 值的**存储类型**是 `number` 而不是 `Rating`：盘上的数据是外部可改的 JSON，
 *     不能假定它一定合法；归一化在**读写两端**（`readSeriesRating` / `normalizeSeriesRatings`）做，
 *     ⛔ 别指望类型系统守住一个文本文件。 */
export type SeriesRatingMap = Record<string, number>;

/** 读某组的合集分；没打过 / 脏值 ⇒ 0（= 未评分，与单条 `rating` 的 0 语义一致） */
export function readSeriesRating(map: SeriesRatingMap | undefined, key: string): Rating {
    const v = map?.[key];
    return normalizeRating(v);
}

/**
 * 写某组的合集分，返回**新表**（不改入参 —— 与 `pure/tableCell` 同一条「纯函数不就地改」的纪律）。
 *
 * 🔴 `rating === 0` ⇒ **删键**而不是存 0：`Catalog` 是逐字节写盘的 JSON，
 *    给每个被打过又清掉的分组留一个 `"…": 0` 是纯噪音（本仓「不静默留垃圾」）。
 */
export function writeSeriesRating(
    map: SeriesRatingMap | undefined,
    key: string,
    rating: unknown,
): SeriesRatingMap {
    const next: SeriesRatingMap = { ...(map ?? {}) };
    const r = normalizeRating(rating);
    if (r === 0) delete next[key];
    else next[key] = r;
    return next;
}

/**
 * 脏数据归一（`parseCatalog` 用）：只留「键非空 + 值能归一到合法档位且 > 0」的项。
 * ⚠️ 与 `writeSeriesRating` 同一口径（0 不存）⇒ 老文件里若真有 `: 0` 也在这里清掉。
 */
export function normalizeSeriesRatings(raw: unknown): SeriesRatingMap {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: SeriesRatingMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k !== 'string' || !k) continue;
        const r = normalizeRating(v);
        if (r > 0) out[k] = r;
    }
    return out;
}

/**
 * 组内**已评分**条目的平均分（只算 `> 0` 的，未评分不参与分母）。
 * 返回值**不四舍五入到半档** —— 它是展示用的统计量（如「组内均 4.2」），不是可编辑的评分。
 * 全都没打分 ⇒ `null`（⛔ 不是 0：0 会被读成「这一组全打了 0 分」，那是另一件事）。
 */
export function seriesMeanOf(items: ReadonlyArray<{ rating?: Rating }>): number | null {
    let sum = 0;
    let n = 0;
    for (const it of items) {
        const r = normalizeRating(it.rating);
        if (r > 0) {
            sum += r;
            n += 1;
        }
    }
    if (n === 0) return null;
    return Math.round((sum / n) * 10) / 10;
}

/** 组内已评分数 / 总数（「合集分 · 3/18 部已评」用） */
export function seriesRatedRatio(items: ReadonlyArray<{ rating?: Rating }>): [number, number] {
    let n = 0;
    for (const it of items) if (normalizeRating(it.rating) > 0) n += 1;
    return [n, items.length];
}

/**
 * 看板/墙上的一格：散条目 or 一张系列合集卡。
 * 🔴 两者的 `rating` 来源**刻意不同**（单条读 `entry.rating`、合集读独立字段）——
 *    这正是「两个概念两个字段」的落点，⛔ 别为了图省事让合集回落到组内平均。
 */
export interface SeriesBoardItem {
    kind: 'single' | 'series';
    /** 稳定 key：散卡 = `entry.id`；合集 = 分组键 */
    key: string;
    /** 落哪一行的评分（散卡 = 个人评分；合集 = 独立合集分） */
    rating: Rating;
    /** `kind === 'single'` 时有值 */
    entry?: MediaEntry;
    /** `kind === 'series'` 时有值 */
    group?: SeriesGroup;
    /** 合集卡展示用：标题（合集 = 组标题、散卡 = 条目标题） */
    title: string;
}

/** 把条目流折成看板格：合集的**组内成员不再各自出格**，只出一张合集卡。 */
export function seriesBoardItems(
    entries: readonly MediaEntry[],
    map: SeriesRatingMap | undefined,
    tab: BoardTab = 'all',
): SeriesBoardItem[] {
    const scoped = entries.filter((e) => entryInTab(e, tab));
    const out: SeriesBoardItem[] = [];
    for (const row of foldSeries(scoped)) {
        if (row.kind === 'single') {
            const e = row.entry;
            out.push({ kind: 'single', key: e.id, rating: normalizeRating(e.rating), entry: e, title: String(e.title ?? '') });
        } else {
            const g = row.group;
            out.push({ kind: 'series', key: g.key, rating: readSeriesRating(map, g.key), group: g, title: g.title });
        }
    }
    return out;
}

/** 看板的一行：与 `RatingRow` 同形，但 `items` 换成可含合集卡的格子 */
export interface SeriesBoardRow {
    rating: Rating;
    whole: number;
    half: number | null;
    unrated: boolean;
    tone: BoardTone;
    items: SeriesBoardItem[];
}

/** 同分排序：合集与散卡混排时按标题（`localeCompare('zh')`，与 `buildBoard` 同口径），稳定可测 */
function byTitle(a: SeriesBoardItem, b: SeriesBoardItem): number {
    return a.title.localeCompare(b.title, 'zh');
}

/**
 * 把（可含合集的）格子投影成 11 行 —— 行序/配色/「未评分在最低行」全部复用
 * `ratingBoard.boardRows()` 的单一真源，⛔ 别在这里另起一套档位表。
 */
export function buildSeriesBoard(
    entries: readonly MediaEntry[],
    map: SeriesRatingMap | undefined,
    tab: BoardTab = 'all',
): SeriesBoardRow[] {
    const rows: SeriesBoardRow[] = boardRows().map((r) => ({
        rating: r.rating,
        whole: r.whole,
        half: r.half,
        unrated: r.unrated,
        tone: toneOf(r.rating),
        items: [],
    }));
    const bucket = new Map<number, SeriesBoardItem[]>();
    for (const r of rows) bucket.set(r.rating, []);
    for (const it of seriesBoardItems(entries, map, tab)) {
        bucket.get(it.rating)?.push(it);
    }
    for (const r of rows) {
        const list = bucket.get(r.rating) ?? [];
        list.sort(byTitle);
        r.items = list;
    }
    return rows;
}

/** 合集/散卡的**总格数**与**未评价格数**（页签计数条用；`[未评分, 总数]`） */
export function seriesUnratedRatio(
    entries: readonly MediaEntry[],
    map: SeriesRatingMap | undefined,
    tab: BoardTab = 'all',
): [number, number] {
    const items = seriesBoardItems(entries, map, tab);
    let unrated = 0;
    for (const it of items) if (it.rating === 0) unrated += 1;
    return [unrated, items.length];
}
