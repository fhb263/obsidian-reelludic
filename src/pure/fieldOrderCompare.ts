/**
 * 属性顺序**对比视图**的纯逻辑（#653 立；2026-10-19 起 **9 列**）。
 *
 * ## 用户口径
 * 「笔记属性顺序编辑视图，再加个对比视图，如一整个表格滑动并览」——
 * 左主右从那个编辑视图一次只看一组；要**并排对比九个分组**（全局 + 六个类型 + 书籍三子类）
 * 就得给一整个表格，横向滑动一次览尽。
 *
 * ## 🔴 关键抽象：**它的行不是「字段」，是「位次」**
 * 九个分组的字段集**不一样**（全局十来项；电影有导演/主演/片长；文学有 ISBN/装帧；网文既无画师也无 ISBN），
 * ⇒ 按字段取并集会有 30+ 行、绝大多数格子是空的（矩阵稀疏、根本没法「对比」）。
 * 用户真正想比的是「**第 3 位是谁**」⇒ 行 = 位次 `1..maxLen`，格 = 「该组第 N 位是哪个字段」。
 * 这样任意两列都能逐行对齐着读；位次超出该组长度时留白，⛔ 不拿别的字段填。
 *
 * ## 🔴 列的沿革（⛔ 别把书籍那三列合回去）
 * #653 首版是**七列** = 全局 + 六类型，且**刻意不拆书籍**：当时文学 / 网文 / 漫画的字段集
 * **完全相同**（`defaultOrderForBookKind` 原样返回 `defaultOrderFor('book')`，差异只在「顺序存哪一份」），
 * 并排三列等于把同一批字段抄三遍 —— 那正是 #640 用户报过的「视觉浪费」。
 *
 * 🔴 **2026-10-19 用户裁定：字段集真的分叉了**（真源见 `pure/fieldOrder.BOOK_KIND_EXCLUDED_FIELDS`）：
 *    文学无画师、网文无画师无 ISBN、漫画无 ISBN ⇒ 三列**不再相同**，拆开才有信息量
 *    （合回一列反而会让「网文列里居然有 ISBN」看着像 bug）。
 *    ⇒ 九列 = `['全局','电影','剧集','动画','文学','网文','漫画','游戏','音乐']`，
 *      顺序由用户当批**点名冻结**，⛔ 别按 `FIELD_ORDER_TYPES` 之类的遍历顺序重新推导。
 *    ⛔ 若将来又想让它们合回一列，先问用户：这是产品判断，不是实现细节。
 *
 * ## 落点（⛔ 别在这里做）
 * 本模块**不读设置、不写设置**：只把「九组 × 位次」这个形状算出来。
 * 每列的数组由调用方传进来（设置页取 `resolveAllOrders` / `exclusiveFieldsFor(BookKind)` 的产物），
 * **本模块不再按 `EntryType` 内部推导「该取哪一份」** —— 一个列键配一份数组。
 */
import { BOOK_KIND_LABELS } from 'pure/bookKind';
import { ENTRY_TYPE_LABELS, type BookKind, type EntryType } from 'data/types';
import {
    BOOK_KIND_EXCLUDED_FIELDS,
    defaultOrderFor,
    defaultOrderForBookKind,
    GLOBAL_FIELD_KEYS,
} from 'pure/fieldOrder';
import { fieldAppliesTo, labelOf } from 'pure/metaFields';

/**
 * 列键的字面形状：`'__global'` / `` `t:${EntryType}` `` / `` `k:${BookKind}` ``。
 * ⚠️ 有意写成 `string` 而不是模板字面量联合：调用方（设置页）按对象键传数组，
 *    收紧成联合会在 `Record<string, string[]>` 的构造处反复断言，收益不抵成本。
 */
export type CompareColumnKey = string;

/** 对比表的一列（一个「分组」） */
export interface FieldOrderCompareColumn {
    /** 列键：`__global` / `t:<EntryType>` / `k:<BookKind>` */
    key: CompareColumnKey;
    /** 列头展示名（「全局」/「电影」/「文学」…） */
    label: string;
    /** 该列属于哪一类分组（缺省时按 `key` 前缀兜底，见 `columnTarget`） */
    kind?: 'global' | 'type' | 'bookKind';
    /** `kind: 'type'` 时的条目类型 */
    type?: EntryType;
    /** `kind: 'bookKind'` 时的书籍子分类 */
    bookKind?: BookKind;
}

/**
 * **九列，顺序 = 用户 2026-10-19 点名冻结的顺序**：
 * `['全局','电影','剧集','动画','文学','网文','漫画','游戏','音乐']`。
 *
 * 🔴 书籍三列夹在「动画」与「游戏」之间（文学 / 网文 / 漫画），⛔ 别挪到末尾：
 *    用户的阅读顺序是「影视三兄弟 → 书三兄弟 → 游戏 → 音乐」。
 * ⚠️ `book` 这个类型本身展示名是「书籍」（`ENTRY_TYPE_LABELS`），**列头必须取子类名**
 *    「文学」（`BOOK_KIND_LABELS`）—— 两套标签不能混用（混了就成了「书籍 / 网文 / 漫画」不对称）。
 */
export const FIELD_ORDER_COMPARE_COLUMNS: readonly FieldOrderCompareColumn[] = [
    { key: '__global', label: '全局', kind: 'global' },
    { key: 't:movie', label: ENTRY_TYPE_LABELS.movie, kind: 'type', type: 'movie' },
    { key: 't:tv', label: ENTRY_TYPE_LABELS.tv, kind: 'type', type: 'tv' },
    { key: 't:anime', label: ENTRY_TYPE_LABELS.anime, kind: 'type', type: 'anime' },
    { key: 'k:book', label: BOOK_KIND_LABELS.book, kind: 'bookKind', bookKind: 'book' },
    { key: 'k:novel', label: BOOK_KIND_LABELS.novel, kind: 'bookKind', bookKind: 'novel' },
    { key: 'k:comic', label: BOOK_KIND_LABELS.comic, kind: 'bookKind', bookKind: 'comic' },
    { key: 't:game', label: ENTRY_TYPE_LABELS.game, kind: 'type', type: 'game' },
    { key: 't:music', label: ENTRY_TYPE_LABELS.music, kind: 'type', type: 'music' },
];

/** 矩阵的一行 = 一个位次 */
export interface FieldOrderCompareRow {
    /** 1 基位次（行号显示用） */
    rank: number;
    /** 每个列键 → 该组在这一位是哪个字段（缺位为 `null`） */
    cells: Record<string, string | null>;
}

/** 一页对比数据：列 + 行 + 每列实际字段数 */
export interface FieldOrderCompare {
    columns: readonly FieldOrderCompareColumn[];
    rows: FieldOrderCompareRow[];
    /** 每列的长度（表头里标「N 项」） */
    sizes: Record<string, number>;
}

/** 一列指向的分组（`kind` 缺省时按列键前缀兜底 —— 契约里 `kind` 是可选字段） */
type ColumnTarget =
    | { kind: 'global' }
    | { kind: 'type'; type: EntryType }
    | { kind: 'bookKind'; bookKind: BookKind };

function columnTarget(c: FieldOrderCompareColumn): ColumnTarget {
    if (c.kind === 'type' || (!c.kind && c.key.startsWith('t:'))) {
        return { kind: 'type', type: c.type ?? (c.key.slice(2) as EntryType) };
    }
    if (c.kind === 'bookKind' || (!c.kind && c.key.startsWith('k:'))) {
        return { kind: 'bookKind', bookKind: c.bookKind ?? (c.key.slice(2) as BookKind) };
    }
    return { kind: 'global' };
}

/** 该列的**缺省**顺序（调用方没给这一列时回落它，⛔ 不让列变空） */
function defaultOrderOf(t: ColumnTarget): string[] {
    switch (t.kind) {
        case 'global': return [...GLOBAL_FIELD_KEYS];
        case 'type': return defaultOrderFor(t.type);
        case 'bookKind': return defaultOrderForBookKind(t.bookKind);
    }
}

/**
 * 该键**属不属于**这一列（= 该组在笔记里真会写出这个字段）：
 *   · 全局：恒真 —— 全局次序由调用方裁决，⛔ 不在这里二次否决
 *     （与 `fieldAppliesTo` 对未登记键**保守放行**同一口径：这里说「不」会让调用方配的东西凭空消失）；
 *   · 类型：`fieldAppliesTo(k, type)`（唯一真源：这个字段会不会出现在该类型里）；
 *   · 书籍子类：`fieldAppliesTo(k, 'book')` **再减掉子类排除键**
 *     （`appliesTo` 是**大类**口径，子类差异只在排除表里，见 `BOOK_KIND_EXCLUDED_FIELDS`）。
 */
function belongsToColumn(t: ColumnTarget, key: string): boolean {
    switch (t.kind) {
        case 'global': return true;
        case 'type': return fieldAppliesTo(key, t.type);
        case 'bookKind':
            return fieldAppliesTo(key, 'book') && !BOOK_KIND_EXCLUDED_FIELDS[t.bookKind].includes(key);
    }
}

/** 取一列最终要渲染的字段数组：调用方那份 → 按该列允许集收窄（缺列 ⇒ 缺省顺序） */
function columnList(c: FieldOrderCompareColumn, orders: Readonly<Record<string, string[]>>): string[] {
    const t = columnTarget(c);
    const provided = orders[c.key];
    const full = Array.isArray(provided) && provided.length ? provided : defaultOrderOf(t);
    // 保留**生效顺序里的相对次序**，只把不属于该列的键滤掉
    return full.filter((k) => belongsToColumn(t, k));
}

/**
 * 算出「九组 × 位次」的对比矩阵。
 *
 * @param orders 每个**列键** → 该组当前的字段顺序（设置页算好的九份）。
 *   🔴 键就是 {@link FIELD_ORDER_COMPARE_COLUMNS} 的 `key`（`__global` / `t:*` / `k:*`）——
 *   本模块**不再按 `EntryType` 从里面挑数组**（旧版用 `orders[t]`，9 列时代会挑不出子类那份）。
 *   缺某一列 / 该列为空 ⇒ 回落该列缺省，⛔ 不会变成空列。
 * @param globalOrder 可选的「全局顺序」覆盖值（兼容旧调用点）：优先于 `orders.__global`，
 *   都不给则用 `GLOBAL_FIELD_KEYS` 的登记序。
 *   ⚠️ 设置页会传用户配过的全局次序（六个类型同步写，取电影那一份作代表）——
 *   这样对比表里看到的就是**笔记里实际写出的次序**，而不是缺省序。
 *
 * 🔴🔴 **每列只留「这个分组真会写出的字段」**（#653 实测纠正，9 列时代依然要守）：
 *    第一版直接用了 `orderForType`，而**那是 42 个键的全量表**（`defaultOrderFor` 只按 `types` 门控，
 *    绝大多数 `MetaField` 没有 `types`）⇒ 各列全是同样 30+ 行、每格几乎一样，
 *    对比表退化成把同一列抄九遍（第一版截图 `_shot/fo653-light.png` 一眼就能看出来）。
 *    ⛔ 别自己再写一份「哪个类型有哪些字段」的表 —— 判据统一走 {@link belongsToColumn}。
 */
export function buildFieldOrderCompare(
    orders: Readonly<Record<string, string[]>>,
    globalOrder?: readonly string[],
): FieldOrderCompare {
    const lists: Record<string, string[]> = {};
    for (const c of FIELD_ORDER_COMPARE_COLUMNS) {
        const t = columnTarget(c);
        if (t.kind === 'global' && globalOrder && globalOrder.length) {
            // 显式传入的全局次序 = 调用方的**覆盖**（旧签名就这一个入口，行为保持不变）
            lists[c.key] = [...globalOrder];
            continue;
        }
        lists[c.key] = columnList(c, orders);
    }
    const sizes: Record<string, number> = {};
    for (const c of FIELD_ORDER_COMPARE_COLUMNS) sizes[c.key] = lists[c.key]?.length ?? 0;
    const maxLen = Math.max(0, ...Object.values(sizes));
    const rows: FieldOrderCompareRow[] = [];
    for (let i = 0; i < maxLen; i++) {
        const cells: Record<string, string | null> = {};
        for (const c of FIELD_ORDER_COMPARE_COLUMNS) cells[c.key] = lists[c.key]?.[i] ?? null;
        rows.push({ rank: i + 1, cells });
    }
    return { columns: FIELD_ORDER_COMPARE_COLUMNS, rows, sizes };
}

/**
 * 键 → 中文名（格子里只显示中文名，键名进 `data-tip`）；空位返回空串。
 *
 * 🔴 2026-10-21：给了 `type` 就按**该列的类型**取名（`author` 在音乐列显示「艺术家」、
 *    `developer` 在动画列显示「制作公司」、`duration_min` 在剧集列显示「单集片长」）。
 *    ⛔ 显示层别再直接读 `META_FIELDS[].label`。
 */
export function fieldLabelOf(key: string | null, type?: EntryType): string {
    if (!key) return '';
    return labelOf(key, type);
}
