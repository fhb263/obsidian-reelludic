// 表格视图的列（pure/tableColumns，#621）
//
// 用户口径：「列表视图改表格式」（仿 Obsidian Bases / Excel，看官方交互规格后对齐）＋「列的字段可自定义」。
//
// 🔴 **与本仓「海报墙卡片信息栏」的分工（⛔ 别把两者的池子合并）**：
//    · 信息栏（`pure/cardMeta`）= **卡片上的 3~5 行**，池子是**精选 16 项**、上限 5 条；
//    · 表格列（本模块）= **全量属性的浏览与编辑面**，池子 = 该类型**全部「可写 + 可读」字段**。
//    合并的后果：卡片那边会冒出 40 个候选，用户根本选不过来（#615 的「精选」口径就废了）。
//
// 🔴 **为什么池子必须同时要求 `writable` 与 `readable`**（#621 新加的 `readable` 这一道）：
//    一格改动要**写回笔记**、再**读回 catalog** 才算闭环。只写不读的字段（`artist` / `tags` /
//    `created` / `updated`）在格子里改完，写完的下一刻就被下一次读覆盖成空 —— 用户看到的是
//    「填了没反应」，而**没有任何报错**。宁可这一列压根不出现（⛔ 别为了「池子更大」而放进来）。
//    ⚠️ 读侧缺口是既有事实（`pure/metaFields` 里如实登记着：`artist` 写侧有、读侧没有）；
//      哪天读侧补上 handler，这一列会**自动**出现在池子里 —— 那条守卫锚的是「池子里的键都可读」这条规则，
//      不是「artist 不许在池子里」这个当前事实。
//
// 🔴 **列序由用户决定，归一必须保留用户顺序** —— 这一点与信息栏**故意相反**：
//    信息栏那边（`normalizeCardFieldsForType`）是「选哪些行」，**顺序恒由池子定**；
//    表格这边用户能拖列序（表头横拖，见 `MediaList`），若也按池子重排，拖了等于白拖。
import { ENTRY_TYPES, type EntryType } from 'data/types';
import { META_FIELDS, fieldAppliesTo, labelOf, type MetaFieldKind } from 'pure/metaFields';
import { seriesGenres, seriesStatus, seriesYearSpan, type SeriesGroup } from 'pure/seriesGroup';

/**
 * 表格里**不许**当列的键：
 *   · `title` —— 首列固定就是「笔记名」，重复列一次没有意义；
 *   · `id` / `type` —— 内部标识，摆出来只会让人误改；
 *   · `banner` —— 是图片链接，在格子里显示一串 URL 毫无用处（封面另有展示位）；
 *   · `progress_percent` —— **派生值**（由进度字段算出，`readable: false`），写回去也不会被读回。
 *   ⚠️ `artist` / `tags` / `created` / `updated` **不在这里** —— 它们是被上面那条 `readable` 规则挡掉的，
 *      机制不同（一个是「语义上不该当列」，一个是「读不回」）。⛔ 别把它们塞进来当成「永远排除」。
 */
export const TABLE_COLUMN_EXCLUDED: readonly string[] = ['id', 'type', 'title', 'banner', 'progress_percent'];

/** 表格列的形态：元数据字段的形态，或 `readonly`（虚拟列 / 派生值，只读展示） */
export type TableColumnKind = MetaFieldKind | 'readonly';

/** 一列的完整描述（表头取 `label`、渲染与编辑按 `kind` / `editable` 分叉） */
export interface TableColumnDef {
    /** 列键：元数据键，或虚拟列的 `__` 前缀键 */
    key: string;
    label: string;
    kind: TableColumnKind;
    /** 格子可编辑？虚拟列 / 派生值 = false */
    editable: boolean;
    /** 适用类型（缺省 = 全部类型） */
    types?: readonly EntryType[];
}

/**
 * **虚拟列**：不是 frontmatter 字段、写不回笔记，但**原列表视图本来就有、且信息量真实**的展示列。
 * 🔴 键一律以 `__` 开头 —— 元数据键不可能长这样，于是「是不是虚拟列」看键就能判（⛔ 别改这个前缀约定）。
 * ⚠️ 它们与元数据列一起进池子、一起能被勾选/隐藏/拖序，只是**格子里不可编辑**。
 */
export const TABLE_VIRTUAL_COLUMNS: readonly TableColumnDef[] = [
    { key: '__community', label: '大众评分', kind: 'readonly', editable: false },
    { key: '__progress', label: '进度', kind: 'readonly', editable: false },
];

/** 某类型可选的列（= 该类型「可写 + 可读」的字段，顺序取 `META_FIELDS` 的登记顺序；虚拟列落在末尾） */
export function tableColumnPoolFor(type: EntryType): TableColumnDef[] {
    const meta: TableColumnDef[] = META_FIELDS
        .filter(
            (f) => f.writable
                && f.readable
                && !TABLE_COLUMN_EXCLUDED.includes(f.key)
                // 🔴🔴 #668 修「文学类表头里冒出『导演』」：
                //    这里原来判的是 `(!f.types || f.types.includes(type))`，而 `types` 是**写出侧门控**
                //    ——`director` / `cast` / `isbn` / `author` 这类在写出侧是「有值就写」，`types` 是**空**，
                //    于是「空 ⇒ 六类全给」⇒ 每个类型的列池里都有导演、文学里也有片长。
                //    ⛔ 判据必须换成 `fieldAppliesTo`（= 语义归属 `appliesTo`，`pure/metaFields` 里唯一真源；
                //       #640f 就是为了这个问题把 `appliesTo` 单独列出来的）。
                //    ⚠️ 别把 `types` 也一起要求上：那样 `appliesTo` 有值、`types` 为空的字段会全被排除。
                && fieldAppliesTo(f.key, type),
        )
        .map((f) => ({
            key: f.key,
            // 🔴 2026-10-21：列名按**该类型**取（音乐列表头是「艺术家」、动画是「制作公司」、
            //    剧集/动画是「单集片长」）—— 见 `metaFields.labelFor`。⛔ 别退回 `f.label`。
            label: labelOf(f.key, type),
            kind: f.kind,
            editable: true,
            // `types` 仍是「写出侧门控」，原样带上（下游渲染/判定要用）；没有就不带
            ...(f.types ? { types: f.types } : {}),
        }));
    return [...meta, ...TABLE_VIRTUAL_COLUMNS.map((c) => ({ ...c }))];
}

/**
 * 各类型的**缺省列**（用户没配过时显示哪几列；顺序 = 展示顺序）。
 *
 * 🔴 取「原列表视图那四列（年份 / 状态 / 大众评分 / 个人评分）」+ **一列该类型的专属**：
 *    表格是**升级**既有列表视图，⛔ 别让用户一打开就发现「我原来能看见的列没了」。
 * ⚠️ 后面那列刻意**按类型给**（#618 之后的口径）：书籍给作者、游戏给平台、音乐给专辑……
 *    一排「译者」摆在游戏表里同样说不通。
 * ⚠️ 「笔记名」与「操作」是**固定首尾列**，不在这个数组里（⛔ 别把 `title` 写进来，它在排除名单里）。
 */
export const TABLE_COLUMN_DEFAULTS_BY_TYPE: Record<EntryType, readonly string[]> = {
    movie: ['year', 'status', '__community', 'rating', 'duration_min'],
    tv: ['year', 'status', '__community', 'rating', '__progress'],
    anime: ['year', 'status', '__community', 'rating', '__progress'],
    book: ['year', 'status', '__community', 'rating', '__progress', 'author'],
    game: ['year', 'status', '__community', 'rating', 'platform'],
    music: ['year', 'status', '__community', 'rating', 'album'],
};

/**
 * 列数上限。
 * ⚠️ 与信息栏的 `CARD_FIELD_LIMIT = 5` 不是一回事：那是「卡片下方放 6 行会很难看」，
 *    这里是「列多了要横向滚动」。给 12 是**防手改配置把表撑到没法用**，设置页里到顶给提示、⛔ 不置灰
 *    （表格多几列仍可用，与卡片的硬约束不同）。
 */
export const TABLE_COLUMN_LIMIT = 12;

/** 某类型 `key` 这一列是不是合法列（虚拟列恒适用；元数据键要落在**该类型**的池子里） */
export function columnAppliesTo(key: string, type: EntryType): boolean {
    return tableColumnPoolFor(type).some((c) => c.key === key);
}

/**
 * 归一化**某类型**的列配置：丢掉「不认识 / 不该当列 / 重复」的键，**保留用户给的顺序**，截断到上限。
 *
 * 🔴 顺序保留是本函数的**核心语义**（见文件头）。⚠️ 因此**不能**照抄 `normalizeCardFieldsForType`
 *    那种「按池子重排」的写法 —— 那边顺序恒由池子定，这边顺序是用户拖出来的。
 * ⚠️ 判据是 `Array.isArray`（非数组 = 没配过 ⇒ 用该类型缺省）；`[]` 是「用户刻意一列都不要」的**合法值**
 *    （那时候表里只剩「笔记名 + 操作」两列，仍能用）。
 */
export function normalizeTableColumnsForType(type: EntryType, v: unknown): string[] {
    const known = new Set(tableColumnPoolFor(type).map((c) => c.key));
    const raw: unknown[] = Array.isArray(v) ? v : [...TABLE_COLUMN_DEFAULTS_BY_TYPE[type]];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of raw) {
        if (typeof x !== 'string' || !known.has(x) || seen.has(x)) continue;
        seen.add(x);
        out.push(x);
    }
    return out.length > TABLE_COLUMN_LIMIT ? out.slice(0, TABLE_COLUMN_LIMIT) : out;
}

/**
 * 🔴 #668（用户：「我要的是列表视图切换各类型**不要出现不是该类型的表头列**」）：
 * **混类型表默认只显示「所有类型都适用」的公共列**，而不是六类并集。
 *
 * 为什么要改：并集口径下「全部」页签会出现 `作者 / 平台 / 片长` 三列同时在场的情况，
 * 电影行里的「作者」「平台」全是 `—` —— 用户看到的是「这条电影怎么有作者列」。
 * ⇒ 默认 = 交集（年份 / 状态 / 评分 / 进度这类人人都有的），各类型专属列**不进混排表**。
 *
 * ⚠️ 交集为空时**回落到并集**：配置全是专属列（用户把公共列全取消了）时，交集为 `[]`
 *    会让表退化成只剩「标题 + 操作」—— 那比多几列更难用。空交集按并集截断兜底。
 * ⚠️ 顺序取**第一个类型**的顺序（交集内的键）：同一批类型恒定得同一套列序，⛔ 不随内容抖动。
 */
export function commonColumnsForTypes(types: readonly EntryType[], resolved: Record<EntryType, string[]>): string[] {
    const lists = types.map((t) => resolved[t] ?? []);
    if (lists.length === 0) return [];
    const common = lists[0].filter((k) => lists.every((l) => l.includes(k)));
    const out = common.length > 0 ? common : tableColumnsForTypes(types, resolved);
    return out.length > TABLE_COLUMN_LIMIT ? out.slice(0, TABLE_COLUMN_LIMIT) : out;
}

/** 缺省的「按类型」列配置（六键齐全，供 Svelte 的缺省 prop 用） */
export const DEFAULT_TABLE_COLUMNS_BY_TYPE: Record<EntryType, string[]> = (() => {
    const out = {} as Record<EntryType, string[]>;
    for (const t of ENTRY_TYPES) out[t] = normalizeTableColumnsForType(t, undefined);
    return out;
})();

/**
 * 把设置里那份「按类型」的原始值解析成**六键齐全**的映射（缺哪一类走**该类型自己的缺省**）。
 * 🔴 与 `resolveCardFieldsByType` 是同一个形状（模式照抄，便于两边一起读）；
 *    ⛔ 但**别把两个函数合并** —— 一个吃 `CardFieldKey`、一个吃任意元数据键，合并只会让类型变糊。
 * ⚠️ 空数组是合法值（「这个类型一列自定义列都不要」），判据 `=== undefined` 而非假值。
 */
export function resolveTableColumnsByType(byType: unknown): Record<EntryType, string[]> {
    const src = byType && typeof byType === 'object' ? (byType as Record<string, unknown>) : {};
    const out = {} as Record<EntryType, string[]>;
    for (const t of ENTRY_TYPES) {
        const v = src[t];
        out[t] = v === undefined
            ? [...TABLE_COLUMN_DEFAULTS_BY_TYPE[t]]
            : normalizeTableColumnsForType(t, v);
    }
    return out;
}

/**
 * **混类型表**（合并视图 / 全部页签的列表）的列：六类各自的配置**求并集**。
 *
 * 🔴 为什么是并集而不是「取第一类的」：一张表只有一套列，而「全部」页签里电影与书籍同屏。
 *    取电影的列 ⇒ 书籍行的作者永远看不见；取第一行的列 ⇒ 表头会**随筛选结果抖动**（同一个视图
 *    滚动一下表头就变了，比少一列难用得多）。并集是唯一**与内容无关**的确定解。
 * ⚠️ 顺序 = 按传入 `types` 的先后依次追加（首次出现的键定位置）⇒ 同一批类型恒定得同一套列序。
 * ⚠️ 某列对某行**不适用**时那一格显示 `—` 且不可编辑（判定走 `columnAppliesTo`）——
 *    ⛔ 别按行删列：那会让同一张表里各行列数不一致。
 * ⚠️ 结果同样截断到 `TABLE_COLUMN_LIMIT`：六类各自的配置**并起来**很容易超（每类各 12 条就是 70 条），
 *    裁在**这里**而不是调用点 —— 调用点各裁一次就是「同一件事两处实现」。
 */
export function tableColumnsForTypes(types: readonly EntryType[], resolved: Record<EntryType, string[]>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of types) {
        for (const k of resolved[t] ?? []) {
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(k);
        }
    }
    return out.length > TABLE_COLUMN_LIMIT ? out.slice(0, TABLE_COLUMN_LIMIT) : out;
}

/**
 * 把一串列键解析成**列描述**（表头要 `label`、渲染要 `kind` / `editable`）。
 * 🔴 键可能在**任一**相关类型的池子里（混类型表的并集）⇒ 逐个类型找第一个命中的，⛔ 别只看第一个类型。
 * ⚠️ 全都没命中（手改过的脏键）⇒ 兜一个只读列（显示键名），**不丢列** —— 少一列会让表头与各行的
 *    `colspan` 对不上，那比显示一个陌生的键名难查得多。
 */
export function tableColumnDefsFor(keys: readonly string[], types: readonly EntryType[]): TableColumnDef[] {
    const pools = types.map((t) => tableColumnPoolFor(t));
    return keys.map((key) => {
        for (const pool of pools) {
            const hit = pool.find((c) => c.key === key);
            if (hit) return hit;
        }
        const virt = TABLE_VIRTUAL_COLUMNS.find((c) => c.key === key);
        if (virt) return virt;
        return { key, label: key, kind: 'readonly' as TableColumnKind, editable: false };
    });
}

/**
 * **系列折叠行**在某列上显示的文本（父级行不承载单条数据，只能给「整组的摘要」）。
 * 🔴 只认能真聚合的几列，其余一律空串（由调用方渲染 `—`）——
 *    ⛔ 别拿「组里第一部」的值冒充整组（用户看到组行写着某一部的年份会以为那就是组的年份）。
 * ⚠️ 抽成纯函数是为了能单测：它躲在 Svelte 的 `{#if row.kind === 'group'}` 分支里，
 *    断言只能锚「函数在不在」，锚不住「哪个键聚合哪个值」。
 */
export function seriesCellText(g: SeriesGroup, key: string): string {
    switch (key) {
        case 'year':
            return seriesYearSpan(g.items);
        case 'genres':
            // ⚠️ `seriesGenres` 返回的是**已拼好**的字符串（不是数组）—— 直接透传，⛔ 别再加 `.join`
            return seriesGenres(g.items);
        case 'status':
            return seriesStatus(g.items) ?? '';
        default:
            return '';
    }
}
