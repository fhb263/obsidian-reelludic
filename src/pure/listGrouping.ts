/**
 * 列表「按属性归类」——一级分组的纯数据层。
 *
 * 🔴 用户 2026-11-11 的需求与裁定（m06406 ③ / m07115 / m07257）：
 *   原话「视图展示：全类型同个条目属性归类如按时间跨度、按类型分类及多种分类怎么分显示」，
 *   追问后补「按分组筛选组合笔记，如在系列也再分开的二级嵌套」。
 *   形态三选一里用户选了 **G1：网格里只有一张张「组卡」，点卡进组看组内**（手势与点系列折叠卡完全一致），
 *   ⛔ 否掉了「组卡当章首 + 条目同屏」与「顶部横滑标签条」两版。
 *
 * 分工（⛔ 别把这段逻辑写进 MediaList.svelte）：
 *   · 本文件 = 纯函数：怎么分桶、桶怎么排序、桶上的汇总（年份跨度 / 系列数 / 代表封面）。
 *   · 视图 = 只负责画。这样「分桶口径」能被单测摸到，也不会和 Svelte 的响应式搅在一起。
 *
 * 二级结构不在这里：进组之后组内**仍然走既有的 `foldSeries`**（系列折叠卡照旧），
 * 用户要的「二级嵌套」= 一级组卡 + 组内系列卡，两级各用各的现成机制，⛔ 不新造一套嵌套树。
 */
import { ENTRY_TYPE_LABELS, type MediaEntry } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { seriesKeyOf, seriesReadPercent, seriesStatus, seriesYearSpan } from 'pure/seriesGroup';

/**
 * 一级分组维度。
 * `none` = 不分（现有平铺 / 系列折叠行为，缺省档）。
 * ⚠️ 没有 `series` 档：系列折叠是**正交**的另一件事（`foldSeries`），把它塞进这张表会让
 *   「按类型分组 + 组内再按系列折叠」这种组合无处安放 ⇒ 系列永远只作为**二级**存在。
 */
export type GroupDim = 'none' | 'type' | 'decade' | 'status' | 'genre';

/** 工具栏下拉的选项（顺序 = 下拉里的顺序；`none` 排头 = 缺省） */
export const GROUP_DIM_OPTIONS: ReadonlyArray<{ value: GroupDim; label: string }> = [
    { value: 'none', label: '不分组' },
    { value: 'type', label: '按类型' },
    { value: 'decade', label: '按年代' },
    { value: 'status', label: '按状态' },
    { value: 'genre', label: '按题材' },
];

/**
 * 某个页签下**实际可用**的分组维度。
 *
 * 🔴 用户 2026-11-11（m08970 ②）原话：「在导航页签为顶部胶囊/文字菜单视图，分组不显示按类型分
 *    因为已经全是该类型了没意义」。
 *    页签本身已经把条目锁死成一类（`lockType` 非空，比如「电影」页签里全是电影）⇒
 *    「按类型」必然只分出一组，那一屏就退化成一个写着「电影」的孤零零组卡，纯浪费一次点击。
 * ⚠️ 判据看的是 `lockType`（页签锁定的类型），⛔ 不看当前筛选后剩几种类型 —— 后者会随
 *    用户勾状态而变化，下拉选项跟着跳来跳去更难受。
 * ⚠️ `none` 永远留着：那是「不分」，不是某个维度。
 */
export function groupDimOptionsFor(lockType: string | null | undefined): ReadonlyArray<{ value: GroupDim; label: string }> {
    if (!lockType) return GROUP_DIM_OPTIONS;
    return GROUP_DIM_OPTIONS.filter((o) => o.value !== 'type');
}

/**
 * 页签锁定类型后，若当前停在「按类型」就退回 `'none'`（否则下拉会显示一个已不在选项里的值）。
 * ⚠️ 返回**归一后的合法维度**：不在该页签可用选项里的一律回 `'none'`。
 */
export function normalizeGroupDimFor(raw: unknown, lockType: string | null | undefined): GroupDim {
    const dim = normalizeGroupDim(raw);
    if (!lockType) return dim;
    return groupDimOptionsFor(lockType).some((o) => o.value === dim) ? dim : 'none';
}

const DIM_LABELS: Record<GroupDim, string> = {
    none: '不分组',
    type: '类型',
    decade: '年代',
    status: '状态',
    genre: '题材',
};

export function groupDimLabel(dim: GroupDim): string {
    return DIM_LABELS[dim];
}

/** 分隔键 → 维度：只在白名单里认，认不出一律回 `none`（⛔ 别把脏值当成某个真实维度） */
export function normalizeGroupDim(raw: unknown): GroupDim {
    for (const o of GROUP_DIM_OPTIONS) if (o.value === raw) return o.value;
    return 'none';
}

/** 一个一级桶（= 网格里的一张组卡） */
export interface ListGroupBucket {
    /** 分组键，同时用作「进组」的标识（⛔ 跨维度会撞键，所以前缀都带维度名） */
    key: string;
    /** 组卡标题（如「电影」「1990–1999」「在看」「喜剧」） */
    label: string;
    /** 组内条目（保持传进来的顺序 —— 排序已在 `filtered` 那一步做完，这里⛔ 不再排一遍） */
    items: MediaEntry[];
}

/**
 * 年代桶的键与名。**按十年取整**（`1994` → `1990–1999`），不是按「近 N 年」那种浮动区间——
 * 浮动区间会让同一批数据在跨年后重新分桶，用户存的「上次看的组」下次就对不上了。
 * 无年份（缺字段 / 脏值）单独归「无年份」桶，⛔ 不要塞进「更早」（那是在编数据）。
 */
export function decadeBucket(year: unknown): { key: string; label: string } {
    const y = typeof year === 'number' && Number.isFinite(year) ? Math.trunc(year) : NaN;
    if (!Number.isFinite(y) || y <= 0) return { key: 'decade:none', label: '无年份' };
    const start = Math.floor(y / 10) * 10;
    return { key: `decade:${start}`, label: `${start}–${start + 9}` };
}

/** 状态桶的固定顺序（与工具栏「状态」下拉同序，⛔ 别按数量重排 —— 状态是有语义次序的） */
const STATUS_ORDER: readonly MediaStatus[] = ['watching', 'want', 'watched', 'archived'];

const STATUS_LABELS: Record<MediaStatus, string> = {
    watching: '在看',
    want: '想看',
    watched: '看过',
    archived: '归档',
};

/** 题材不足两条时不成组（见 `groupEntriesBy` 末尾的兜底） */
const GENRE_MIN = 2;

/**
 * 把（已筛选 + 已排序的）条目按维度分桶。
 *
 * 口径：
 *  · **桶内保持传入顺序** —— 用户在下拉里选的排序必须一路生效到组内，⛔ 这里再排一次会把它顶掉。
 *  · **桶序**：类型 / 题材 → 条目多的在前（同数量按名比较，保证结果恒定）；
 *            年代 → 时间正序（无年份桶恒在最后）；状态 → `STATUS_ORDER` 固定序。
 *  · **题材**：一条可以属于多个题材 ⇒ 会在多个桶里重复出现（这是「按题材看」的应有语义，
 *            ⚠️ 所以**各桶条目数之和 ≠ 总条目数**，界面上的计数必须用桶自己的 `items.length`）。
 *  · 空桶不产出；条目为空 ⇒ 空数组（视图据此显示空态）。
 */
export function groupEntriesBy(entries: readonly MediaEntry[], dim: GroupDim): ListGroupBucket[] {
    if (dim === 'none' || entries.length === 0) return [];
    const buckets = new Map<string, ListGroupBucket>();
    const push = (key: string, label: string, e: MediaEntry): void => {
        const hit = buckets.get(key);
        if (hit) hit.items.push(e);
        else buckets.set(key, { key, label, items: [e] });
    };

    for (const e of entries) {
        switch (dim) {
            case 'type':
                push(`type:${e.type}`, '', e);
                break;
            case 'decade': {
                const b = decadeBucket(e.year);
                push(b.key, b.label, e);
                break;
            }
            case 'status':
                push(`status:${e.status}`, STATUS_LABELS[e.status] ?? String(e.status), e);
                break;
            case 'genre': {
                const seen = new Set<string>();
                for (const g of e.genres ?? []) {
                    const name = typeof g === 'string' ? g.trim() : '';
                    if (!name || seen.has(name)) continue; // 同一条里重复的题材只算一次
                    seen.add(name);
                    push(`genre:${name}`, name, e);
                }
                break;
            }
            default:
                break;
        }
    }

    let out = [...buckets.values()];
    // 类型桶的标题在收完后补（`ENTRY_TYPE_LABELS` 反过来查比逐条写更省）
    if (dim === 'type') {
        for (const b of out) b.label = typeBucketLabel(b.key);
    }
    // 题材：只有 1 条的题材不成组（和系列折叠「≥2 才折」同一条心思），
    // 否则会冒出一堆只有一部的组卡，点进去还是那一条。
    if (dim === 'genre') out = out.filter((b) => b.items.length >= GENRE_MIN);

    return sortBuckets(out, dim);
}

/**
 * 类型桶标题。走 `data/types` 的 `ENTRY_TYPE_LABELS` 单一真源（⛔ 别在这里再写一份中文表），
 * 认不出时回落裸键（宁可难看也不静默丢桶）。
 */
function typeBucketLabel(key: string): string {
    const id = key.slice('type:'.length);
    return ENTRY_TYPE_LABELS[id as keyof typeof ENTRY_TYPE_LABELS] ?? id;
}

function sortBuckets(list: ListGroupBucket[], dim: GroupDim): ListGroupBucket[] {
    const byCount = (a: ListGroupBucket, b: ListGroupBucket): number =>
        b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh');
    switch (dim) {
        case 'decade':
            // 时间正序；「无年份」恒在最后（它是「不知道」，不是「最早」）
            return list.sort((a, b) => {
                const an = a.key === 'decade:none';
                const bn = b.key === 'decade:none';
                if (an !== bn) return an ? 1 : -1;
                if (an && bn) return 0;
                return Number(a.key.slice('decade:'.length)) - Number(b.key.slice('decade:'.length));
            });
        case 'status':
            return list.sort(
                (a, b) =>
                    STATUS_ORDER.indexOf(a.key.slice('status:'.length) as MediaStatus) -
                    STATUS_ORDER.indexOf(b.key.slice('status:'.length) as MediaStatus),
            );
        case 'type':
        case 'genre':
        default:
            return list.sort(byCount);
    }
}

// ──────────────────────────── 组卡上的汇总 ────────────────────────────

/** 一张组卡要显示的东西（视图只消费这个，不再自己算） */
export interface ListGroupCard {
    key: string;
    label: string;
    /** 组内条目数（题材桶里各桶之和 ≠ 总数，见 `groupEntriesBy`） */
    count: number;
    /** 年份跨度（如「1990–2026」，单年只写一个）；跨度为 0 条或都无年份 ⇒ 空串 */
    yearSpan: string;
    /** 组内成系列（≥2 部）的系列条数 —— 用来在组卡上写「N 个系列」 */
    seriesCount: number;
    /** 代表封面用的条目（至多 3 条，主封面在最前；视图按 `--si` 倒序铺叠图） */
    covers: MediaEntry[];
    /** 组内状态（取「下一部要看」那条的状态，与系列卡同口径 `seriesStatus`） */
    status: MediaStatus | undefined;
    /** 阅读/观看进度（0–100，无进度语义的类型 ⇒ undefined） */
    readPercent: number | undefined;
}

/** 组卡叠图最多铺几张（再多也看不出来，白费解码） */
export const GROUP_COVER_MAX = 3;

/**
 * 桶 → 组卡。`buildGroupCards` 是视图唯一入口。
 *
 * ⚠️ `covers` 取**组内前 N 条**（顺序 = 用户当前的排序）——
 *   ⛔ 别改成「按评分挑最好看的」：那样组卡封面与点进去看到的第一屏对不上，用户会以为点错了。
 */
export function buildGroupCards(buckets: readonly ListGroupBucket[]): ListGroupCard[] {
    return buckets.map((b) => {
        const seriesKeys = new Set<string>();
        for (const e of b.items) {
            const k = seriesKeyOf(e);
            if (k) seriesKeys.add(k);
        }
        // 只有 1 部的系列不算「系列」（用户裁定：加「系」角标但仍平铺 ⇒ 组卡上也不该计入系列数）
        let realSeries = 0;
        for (const k of seriesKeys) {
            const n = b.items.filter((e) => seriesKeyOf(e) === k).length;
            if (n >= 2) realSeries += 1;
        }
        return {
            key: b.key,
            label: b.label,
            count: b.items.length,
            yearSpan: seriesYearSpan(b.items),
            seriesCount: realSeries,
            covers: b.items.slice(0, GROUP_COVER_MAX),
            status: seriesStatus(b.items),
            readPercent: seriesReadPercent(b.items),
        };
    });
}

/**
 * 组卡上的第二行小字（「1990–2026 · 2 个系列」这类）。
 * 空的部分自动不出现 —— ⛔ 别输出「· 」这种孤零零的分隔符。
 */
export function groupCardSub(card: ListGroupCard): string {
    const parts: string[] = [];
    if (card.yearSpan) parts.push(card.yearSpan);
    if (card.seriesCount > 0) parts.push(`${card.seriesCount} 个系列`);
    return parts.join(' · ');
}

/**
 * 某个桶里的成员（进组后用它把条目范围收窄）。
 *
 * 🔴 为什么要从**原始条目**重算、而不是读 `groupEntriesBy` 的结果：
 *   进组后视图会拿「桶成员」再走一遍 `filterAndSort`，而 `groupEntriesBy` 的输入正是它的**输出** ——
 *   直接复用会形成 `桶 → 筛选 → 桶` 的响应式环（Svelte 4 会报 Cyclical dependency）。
 *   从 `entries` 重算就没有环：进组只**收窄输入**，分桶本身不参与。
 *
 * ⚠️ 与 `groupEntriesBy` 的判据必须**逐字一致**（尤其题材的「同一条里重复只算一次」），
 *   否则会出现「组卡上写 3 部、点进去只剩 2 部」。两处的判据都收在 `bucketKeyOf` / `matchesBucket`。
 */
export function entriesInBucket(entries: readonly MediaEntry[], dim: GroupDim, key: string): MediaEntry[] {
    if (dim === 'none' || !key) return [];
    return entries.filter((e) => matchesBucket(e, dim, key));
}

/** 一条条目是否属于 `key` 这个桶（判据与 `groupEntriesBy` 同源，见上） */
function matchesBucket(e: MediaEntry, dim: GroupDim, key: string): boolean {
    switch (dim) {
        case 'type':
            return `type:${e.type}` === key;
        case 'decade':
            return decadeBucket(e.year).key === key;
        case 'status':
            return `status:${e.status}` === key;
        case 'genre': {
            const name = key.slice('genre:'.length);
            return (e.genres ?? []).some((g) => (typeof g === 'string' ? g.trim() : '') === name);
        }
        default:
            return false;
    }
}

