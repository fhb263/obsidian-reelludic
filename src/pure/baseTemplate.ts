// Obsidian Bases（.base）模板生成（纯逻辑，无 obsidian 依赖，可单测）
//
// 用途：让用户在 Obsidian 里用**原生 Bases** 直接查自己的收藏库，而不是只能在本插件的视图里看。
//
// 🔴 数据真源是**笔记的 frontmatter**，不是 `catalog.json`：
//    Bases 只索引 vault 里的 markdown 文件，看不到插件自己的 JSON 索引文件。因此本模块写的每一个属性名
//    都必须与 `data/noteGenerator.entryFrontmatter` 实际写出的键**逐字一致** ——
//    键名写错时 Bases **不报错、只是整列为空**，是本功能唯一真正的失败模式。
//
// 🔴 且**不能**引用 catalog.json 里有、但 frontmatter 没写的字段（如 `bookKind` / `musicKind` /
//    `summary`）：那些列会恒空。要加这类列，先让 `entryFrontmatter` 写出来。
//
// ⚠️ 本模块**不写文件**（IO 在 main.ts），也不读写 catalog.json —— 它只把一份 YAML 文本交出去。

import { ENTRY_TYPE_DIRS, ENTRY_TYPE_LABELS, ENTRY_TYPES, type EntryType } from 'data/types';
import { BOOK_KIND_DIRS } from 'pure/dirs';
import { POSTER_CARD_MIN_WIDTHS, normalizePosterDensity, normalizePosterColumns, type PosterDensity } from 'pure/posterGrid';
import { MEDIA_STATUSES, STATUS_LABELS } from 'pure/status';

/** 生成模板时用到的上下文（全部来自插件设置，本模块不兜底真实路径） */
export interface BaseTemplateContext {
    /** 媒体库目录（vault 相对，无前导/尾部斜杠）—— 笔记目录 = `${libraryDir}/笔记` */
    libraryDir: string;
    /** 插件版本（写进文件头注释，便于对照是哪一版生成的） */
    pluginVersion: string;
    /**
     * 当前「海报密度」（设置 › 外观 › 海报密度）—— 用来算海报墙的封面列宽。
     * 🔴 不传 = 按「标准」档（180px），与插件默认值一致。
     */
    posterDensity?: PosterDensity | string;
    /** 当前卡片网格自定义列数（仅 `posterDensity === 'custom'` 时生效） */
    posterColumns?: number;
    /**
     * 库里条目笔记是否真的带 `communityScore` 这个 frontmatter 键（由 main.ts 扫描后传入）。
     * 🔴 不传 = 当作「没有」⇒ 不生成「大众评分」两档排序。
     *    原因见文件末尾 `COMMUNITY_SCORE_PROP` 的注释：`noteGenerator` 目前**不写**这个键，
     *    生成一个恒空的排序档对用户是纯噪音。
     */
    hasCommunityScore?: boolean;
}

/** JSON 字符串字面量（.base 的 `views[].options` 是**内联 JSON**，不是 YAML） */
function jsonStr(s: string): string {
    return JSON.stringify(s);
}


/**
 * 笔记目录（vault 相对路径）。
 * 🔴 与 `main.ts` 组装 `EntryService` 的口径必须一致：`${libDir}/${DIR_NOTES}`，
 *    其中 `libDir = normalizePath(libraryDir || 'ReelLudic')` 去尾部斜杠。
 */
export function baseNotesFolder(libraryDir: string): string {
    const dir = (libraryDir || 'ReelLudic')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
    return `${dir || 'ReelLudic'}/笔记`;
}

/** YAML 双引号标量（路径含中文/空格时必须引，裸写会被 YAML 解析成别的类型） */
function yamlStr(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Bases 表达式里的字符串字面量（表达式语言用双引号） */
function exprStr(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** YAML 单引号标量（filter 表达式用；表达式里都是双引号，用单引号包最稳） */
function yamlExpr(s: string): string {
    return `'${s.replace(/'/g, "''")}'`;
}

/** 一个视图的规格 */
interface ViewSpec {
    type: 'table' | 'cards' | 'list' | 'kanban';
    name: string;
    /**
     * 视图自己的过滤条件（Bases 的「This view」区，与顶层「All views」区 **AND** 组合）。
     * 元素是表达式字符串，或用 `{ or: [...] }` / `{ and: [...] }` / `{ not: [...] }` 嵌套的组合节点
     * （见 `FilterNode`）。⚠️ 文件目录范围**不写**在这里 —— 那是顶层 `filters` 的职责。
     */
    filters: FilterNode[];
    /**
     * 展示的列 —— 🔴 table 视图写进 Bases 的 **`order`** 键（⛔ 不是 `columns`）。
     * Obsidian 自建的 `.base` 里属性列就写在 `order:` 下（`file.name` / `file.folder` …），
     * 写 `columns:` 会被静默忽略 ⇒ 属性模式里一列都不显示。别改回去。
     * ⚠️ cards 视图**不用**这个字段（卡片属性走 `properties` → `cardProperties`），
     *    但字段本身仍填（渲染函数对 table 才输出），这样两种视图共用一套 TS 类型。
     */
    columns: string[];
    /**
     * 排序链（Bases 的 `sort:` 键；不是 order 里的字符串）。
     * 🔴 **是数组，多个条件从主到次** —— 与 Obsidian 原生「排序依据」面板里
     *    「+ 添加排序」加出来的多行**逐项对应**（第一项是主序，后面是并列时的兜底键）。
     *    用 `sortChain()` 组装，别手写 `[{ … }]`：单条排序在主序相同时会回落到文件名，
     *    用户看到的是「排好的顺序里插了几条乱的」。
     */
    sort?: BaseSortKey[];
    /**
     * 分组依据（Bases 的 `groupBy:`）—— 用户 #690：「新出的分组依据可以添加什么」。
     * 🔴 **必须是对象**（`{ property, direction? }`），写成裸字符串 `groupBy: type` 会让
     *    Obsidian 直接报「groupBy 必须是 object 类型」并把**整个 .base 判为无法解析**（用户实测）。
     * 🔴 只用 frontmatter 里**真实存在**的键（见 data/noteGenerator.entryFrontmatter）：
     *    type / status / rating / year / genres / author 系 / created / updated …
     *    ⛔ 别写 `bookKind`/`musicKind`（frontmatter 里没有 ⇒ 整组空）。
     */
    groupBy?: { property: string; direction?: 'ASC' | 'DESC' };

    /** 卡片大小微调 —— 只在「跟随插件海报密度」这一档留空（让 Obsidian 用默认观感） */
    cardSize?: number;
    /**
     * cards 视图的图片设置。
     * 🔴 `aspectRatio` 是 **高/宽**（官方文档原文：「The height of the cover image is determined by
     *    its aspect ratio. The default aspect ratio is 1:1」，默认 1 = 正方形）。
     *    ⇒ 2:3 竖版海报必须写 **1.5**。⛔ 别写 0.6667 —— 那是宽/高，会得到一张扁的 3:2 封面。
     */
    image?: { key: string; fit: 'cover' | 'contain'; aspectRatio: number };
    /** 卡片上除封面外**显式**显示的属性（Bases 的 `cardProperties`；不写则用 Obsidian 默认那几列） */
    properties?: string[];
}

/**
 * 视图要直接把自己那一段藏起来：本模块不写 `views[].options`（Obsidian 用它存列宽等状态），
 * 所以 `options` 只能在渲染后按需追加 —— 用一个可选的额外行组承接。
 */
interface ViewSpecWithOptions extends ViewSpec {
    /** `options:` 之后的行（已含缩进），`undefined` = 不输出该键 */
    optionsLines?: string[];
}
/**
 * Bases 的过滤器对象：**恰好**包含 and / or / not 中的一个键（官方语法：「Filter objects may contain one of
 * `and`, `or`, or `not`」）。数组元素是表达式字符串，或是嵌套的同类对象。
 */
export type FilterNode = string | { and?: FilterNode[]; or?: FilterNode[]; not?: FilterNode[] };

/**
 * 🔴🔴 #690 用户实测的核心教训之一：
 *    早先我把「文件在哪个子目录」这条范围条件**逐字抄进了每一个视图的 `filters`**，
 *    一个 8 目录的 or 展开成 10 多行 ⇒ 视图块比内容还长，用户第一反应是「视图非常长」。
 *    正确做法是**分层**：
 *      · 文件目录范围  → 顶层 `filters`（Bases 的 **All views** 区，对所有视图生效）
 *      · 每视图的差异  → 视图自己的 `filters`（**This view** 区），通常只剩一行
 *    官方语法原文：这两处「when evaluating for a view they will be concatenated with an `AND`」。
 *    ⇒ 顶层管「查哪些文件」，视图管「再筛什么」，**别在两个地方写同一个条件**。
 *
 * @internal 仅供本模块与测试使用
 */
export function combineFilters(parts: readonly FilterNode[]): { and: FilterNode[] } | undefined {
    const list = parts.filter((f) => f !== undefined && f !== null && f !== '');
    if (!list.length) return undefined;
    return { and: list as FilterNode[] };
}

/** Bases `sort:` 数组的一项（`property` + `direction`） */
export type BaseSortKey = { property: string; direction: 'ASC' | 'DESC' };

/**
 * 组装一个视图的排序链：**主序在前，兜底在后**，同名属性只留第一次出现的那条。
 *
 * 🔴 Bases 的 `sort` 是**数组**，不是单个键 —— 原生「排序依据」面板里那行
 *    `updated` + `从新到旧`，底下「+ 添加排序」加进来的每一条，就是数组里多一项：
 *
 *        sort:
 *          - property: updated
 *            direction: DESC
 *          - property: title      # ← 同时间戳时按标题兜底
 *            direction: ASC
 *
 * ⛔ 别改回「一个视图一条排序」：主序相同时 Bases 会回落到**文件名**，
 *    用户看到的就是「明明按更新排的，这几条怎么乱插」—— 兜底键才是让顺序稳定的那一项。
 */
export function sortChain(...keys: BaseSortKey[]): BaseSortKey[] {
    const seen = new Set<string>();
    const out: BaseSortKey[] = [];
    for (const k of keys) {
        if (seen.has(k.property)) continue;
        seen.add(k.property);
        out.push(k);
    }
    return out;
}

/** 标题兜底键 —— 几乎每条排序链的最后一项（同名作品极少，届时不至于随机） */
const TITLE_ASC: BaseSortKey = { property: 'title', direction: 'ASC' };

/** 最近更新：主序 `updated` 倒序，同一时间戳的按标题 A-Z */
export const SORT_RECENT: BaseSortKey[] = sortChain({ property: 'updated', direction: 'DESC' }, TITLE_ASC);

/** 最近添加：主序 `created` 倒序，同一天建的按标题 A-Z */
export const SORT_CREATED: BaseSortKey[] = sortChain({ property: 'created', direction: 'DESC' }, TITLE_ASC);

/**
 * 评分优先：高分在前 → 同分里**最近更新**的在前 → 再按标题。
 * 只用一档 `rating DESC` 时，同分的几条谁先谁后由文件名决定 —— 换个库顺序就变，观感是乱的。
 */
export const SORT_RATING: BaseSortKey[] = sortChain(
    { property: 'rating', direction: 'DESC' },
    { property: 'updated', direction: 'DESC' },
    TITLE_ASC,
);

/** 字母序（分组视图，组内 A-Z）：同名作品的再按评分高的排前 */
export const SORT_ALPHA: BaseSortKey[] = sortChain(TITLE_ASC, { property: 'rating', direction: 'DESC' });

/**
 * 大众评分优先的排序链 —— 只在库里真有 `communityScore` 时才会被用到（见 `COMMUNITY_SCORE_PROP`）。
 * 主序是社区分，同分再按自己的评分、标题。
 * ⚠️ 写成函数而不是常量：`COMMUNITY_SCORE_PROP` 在本文件末尾才声明，模块级常量读它会踩 TDZ。
 */
export function sortCommunity(): BaseSortKey[] {
    return sortChain(
        { property: COMMUNITY_SCORE_PROP, direction: 'DESC' },
        { property: 'rating', direction: 'DESC' },
        TITLE_ASC,
    );
}

/**
 * 渲染一个视图块（缩进 2/4 空格，挂在 `views:` 下）。
 *
 * 🔴 渲染顺序即文件里的可读顺序：**先身份（type/name）→ 再筛选 → 再展示（列/卡片）→ 最后排序分组**。
 *    排序、分组都是**每个视图自己的**键，Bases 会显示在视图标签菜单里；⛔ 不要为了「能点排序」再给
 *    它们各开一个视图 —— 那是把 N×M 种组合铺成一排，文件会变得没法读（用户 #690 的原话就是
 *    「这个排序依据和分组依据不能内置到属性、筛选的吗，现在的是视图非常长了」）。
 */
function renderView(v: ViewSpecWithOptions): string {
    const out: string[] = [];
    out.push(`  - type: ${v.type}`);
    out.push(`    name: ${yamlStr(v.name)}`);
    // 视图自己的筛选（This view 区）—— 文件目录范围已经由顶层 filters 兜住，⛔ 别在这里重复一遍
    const f = combineFilters(v.filters);
    if (f) {
        // 🔴 只把**缩进**传进去，键名由调用方自己写一行。
        //    早先写的是 renderFilterNode('    filters:', f) —— 把「带冒号的前缀」当缩进，
        //    函数内部又拼一层 `- `，产出 `filters:and:` 这种非法 YAML，整个 .base 打不开。
        //    这里用 renderFilterMap（映射值形态）：`filters:` 的下一层是映射，不是列表项。
        out.push('    filters:');
        out.push(...renderFilterMap('      ', f));
    }
    // 🔴 `order` 只对 table / list 生效；cards 的卡片属性走 `cardProperties`（见下）。
    //    ⚠️ 曾经无条件下写 order，cards 里就多出一段被 Bases 静默忽略的死配置 ——
    //    用户照着文件改 order 会「怎么改都没反应」，所以这里必须按视图类型分流。
    if (v.type !== 'cards') {
        out.push('    order:');
        for (const c of v.columns) out.push(`      - ${c}`);
    }
    if (v.type === 'cards') {
        if (v.image) {
            // 🔴 封面取 `banner`：`entryFrontmatter` 里 URL 直用、本地封面拼 `{libraryDir}/…`。
            out.push(`    image: ${v.image.key}`);
            out.push(`    imageFit: ${v.image.fit}`);
            out.push(`    imageAspectRatio: ${v.image.aspectRatio}`);
        }
        if (typeof v.cardSize === 'number') out.push(`    cardSize: ${v.cardSize}`);
        if (v.properties?.length) {
            // 🔴 这是 **cards** 的卡片属性列表（官方语法里 `cardProperties`）。
            //    ⛔ 别改成 `order:` —— order 是 table/list 的列；cards 用它会被静默忽略（＝卡片上啥都不显示）。
            out.push('    cardProperties:');
            for (const c of v.properties) out.push(`      - ${c}`);
        }
    }
    if (v.sort?.length) {
        out.push('    sort:');
        for (const s of v.sort) {
            out.push(`      - property: ${s.property}`);
            out.push(`        direction: ${s.direction}`);
        }
    }
    if (v.groupBy) {
        // 🔴🔴 #690 用户实测报错：「视图"分组 · 按类型"中的"groupBy"必须是 object 类型」。
        //    我上一版写的是 `groupBy: type`（裸字符串）—— **错**。Bases 要的是对象：
        //      groupBy:
        //        property: type
        //        direction: ASC   （可选）
        //    ⛔ 别退回字符串写法：整个 .base 会解析失败，所有视图一起废掉。
        out.push('    groupBy:');
        out.push(`      property: ${v.groupBy.property}`);
        if (v.groupBy.direction) out.push(`      direction: ${v.groupBy.direction}`);
    }
    if (v.optionsLines?.length) {
        out.push('    options:');
        out.push(...v.optionsLines);
    }
    return out.join('\n');
}

/**
 * 取过滤器对象的逻辑键（and / or / not 三选一）。
 * ⚠️ 用 Array.isArray 判存在，别用真值判断 —— `{ and: [] }` 在 JS 里是真值，但语义上是「没有条件」。
 */
function logicKeyOf(node: Exclude<FilterNode, string>): 'and' | 'or' | 'not' | null {
    return Array.isArray(node.and) ? 'and' : Array.isArray(node.or) ? 'or' : Array.isArray(node.not) ? 'not' : null;
}

/**
 * 把一个过滤器渲染成**列表项**（行首带 `- `，缩进由 indent 决定）。
 *
 * 🔴🔴 用户实测报错原文学到的：`A block sequence may not be used as an implicit map key at line 44`。
 *    顶层 `filters → and` 的数组里，元素本身可以是 `{ or: [...] }` 这种**嵌套过滤器对象**。
 *    这种对象作为数组元素时，**必须**写成 `- or:`（把键放到 `- ` 后面那一段），
 *    而**不能**写成裸的 `or:` —— 裸 `or:` 会被 YAML 当成上一层的**映射键**，
 *    紧跟着的兄弟元素 `- 'note.type'` 就变成了「序列充当隐式映射键」，整个文件解析失败
 *    （Obsidian 报「无法解析数据库文件」，于是所有视图一起打不开）。
 *    ⇒ 缩进规则：`- key:` 这一行里 `key` 在第 indent+2 列；它的子项要再缩进 2 列（即 indent+4）。
 */
function renderFilterItem(indent: string, node: FilterNode): string[] {
    if (typeof node === 'string') return [`${indent}- ${yamlExpr(node)}`];
    const key = logicKeyOf(node);
    if (!key) return [];
    const out = [`${indent}- ${key}:`];
    for (const child of node[key]!) out.push(...renderFilterItem(`${indent}    `, child));
    return out;
}

/**
 * 把顶层过滤器对象渲染成**映射值**（行首不带 `- `，`filters:` 下面的那一层用它）。
 * 它的子项一定是列表项，交给 renderFilterItem。
 */
function renderFilterMap(indent: string, node: FilterNode): string[] {
    if (typeof node === 'string') return [`${indent}- ${yamlExpr(node)}`];
    const key = logicKeyOf(node);
    if (!key) return [];
    const out = [`${indent}${key}:`];
    for (const child of node[key]!) out.push(...renderFilterItem(`${indent}  `, child));
    return out;
}

/**
 * 笔记类型子目录名（`笔记/` 下那一层）：6 个类型目录 + 书籍三分类目录（book/novel/comic）。
 * 🔴 真源是 `ENTRY_TYPE_DIRS` / `BOOK_KIND_DIRS`，⛔ 别在这里硬编码字面量 ——
 *    目录改名时这里必须跟着动，否则过滤器指着一个不存在的目录、视图直接空表。
 */
function noteSubDirs(): string[] {
    const dirs = new Set<string>([...Object.values(ENTRY_TYPE_DIRS), ...Object.values(BOOK_KIND_DIRS)]);
    return [...dirs];
}

/**
 * 海报封面设置 —— 与插件海报墙同一套观感（`pure/posterGrid` 是该观感的唯一真源）。
 *
 * 🔴 `imageAspectRatio` 取 **1.5 = 高/宽**（Bases 的口径是「高度由宽高比决定」，默认 1 = 正方形）：
 *    插件 `.rl-cov` / `.rl-cov-wrap` 都是 `aspect-ratio: 2 / 3`（宽/高 = 0.6667）⇒ 高/宽 = **1.5**。
 *
 * ⛔ 历史坑（已修）：这里早先写的是 `0.6667`，把它当成「宽/高」用了 —— 于是 Bases 按高/宽解释，
 *    得到一张 **扁的 3:2 封面**，和插件的竖版海报完全对不上。官方文档
 *    <https://help.obsidian.md/bases/views/cards> 原文：「The height of the cover image is determined
 *    by its aspect ratio. The default aspect ratio is 1:1 meaning all your images will be square.」
 *    改这个值时请一并改 `tests/baseTemplate.test.ts` 里锁死 1.5 的那条断言。
 */
export const IMAGE_ASPECT_RATIO = 1.5;

function posterImage(): Pick<ViewSpec, 'image'> {
    // 🔴 封面取 `banner`：`entryFrontmatter` 里 URL 直用、本地封面拼 `{libraryDir}/…`。
    return { image: { key: 'banner', fit: 'cover', aspectRatio: IMAGE_ASPECT_RATIO } };
}

/**
 * 卡片上要显示的属性 —— 用户点名要的六项：标题、年份、作者、题材、状态、个人评分。
 *
 * 🔴 「作者」**不能只列 `author`**：`entryFrontmatter` 里 `author` 只对书籍/音乐/漫画有值，
 *    电影/剧集/动画里是 `director`、游戏里是 `developer`（插件自己的「创作者」口径就是
 *    `noteGenerator.creatorOf`：book→author、game→developer、其余→director）。
 *    ⇒ 卡片上用一条 note 属性链 `author || artist || director || developer` 兜住，六列在所有类型都不空。
 *    ⚠️ 链的**顺序即优先级**，与 `creatorOf` 对齐（book 在前，游戏在后）。
 *
 * 🔴 「题材」= `genres`（frontmatter 里的数组键），⚠️ 不是 `genre`、也不是 `tags`。
 */
export const CARD_PROPERTIES: readonly string[] = [
    'title',
    'year',
    'note.author || note.artist || note.director || note.developer',
    'genres',
    'status',
    'rating',
];

/**
 * 卡片大小 —— 取**插件当前海报密度**那一档的观感宽度。
 *
 * 🔴 为什么是 `cardSize` 而不是自己算列数：
 *    Bases 的 cards 视图按容器宽度自动排，列数由 `cardSize`（px）+ 容器宽共同决定。
 *    要让「同一个库、同样的窗口宽，Bases 与插件看到的密度一致」，能对上的唯一量就是这档 px。
 *
 * 🔴 `custom`（自定义列数）档**也要写**：
 *    用户在插件里选「自定义 N 列」，意味着他就是想要 N 列那么大的卡片。
 *    Bases 拿不到容器宽 ⇒ 用 `posterCardSizeForColumns` 按一个常见面板宽度反算每张卡的宽度。
 *    ⚠️ 早先这档是「不写 cardSize」，实测会直接放弃用户的档位选择（用户密度正是 custom）——
 *    「对不上就退回默认」等于没做这个功能。
 */
function cardSizePick(density: PosterDensity | string | undefined, columns: unknown): Pick<ViewSpec, 'cardSize'> {
    const d = normalizePosterDensity(density);
    if (d === 'custom') {
        const n = normalizePosterColumns(columns);
        return { cardSize: posterCardSizeForColumns(n) };
    }
    return { cardSize: POSTER_CARD_MIN_WIDTHS[d] };
}

/**
 * Bases 面板的**估算**内容宽度（px）。
 * ⚠️ 这是本模块唯一一处「猜」的数字：Bases 的 cards 视图不暴露容器宽给 `.base` 文件，
 *    只能按常见窗口宽度（约 1200px）减去侧栏/内边距估一个。它的作用只是把「N 列」换算成
 *    「一张卡约多宽」，让观感落在同一量级 —— ⛔ 别指望它像素级相等。
 */
export const BASES_PANEL_WIDTH_ESTIMATE = 1080;

/** Bases cards 视图的估算列间距（px，取 Obsidian 默认观感） */
export const BASES_CARD_GAP_ESTIMATE = 12;

/**
 * 「自定义 N 列」→ Bases 的 cardSize（px）。
 *
 * 与插件 `posterGridTemplate` 的自定义档**同一个公式**：
 *   轨道宽 = (100% − (N−1)×gap) / N
 * 只是把 100% 换成估算的面板宽度。返回值钳到合理区间，避免极端列数给出 0 或巨大值。
 */
export function posterCardSizeForColumns(columns: number): number {
    const n = normalizePosterColumns(columns);
    const gap = BASES_CARD_GAP_ESTIMATE;
    const usable = BASES_PANEL_WIDTH_ESTIMATE - (n - 1) * gap;
    const px = Math.round(usable / n);
    // 钳制：再密也不小于 80px（插件缩放上限 12 列就是这个量级），再疏不超过整幅面板宽
    return Math.max(80, Math.min(BASES_PANEL_WIDTH_ESTIMATE, px));
}

/**
 * 文件头里那句「卡片密度跟随插件」的说明 —— 必须与 `cardSizePick` 的实际输出一致，
 * 否则用户会照着注释去找一个没写进文件的 cardSize。
 */
function densityNote(ctx: BaseTemplateContext): string {
    const d = normalizePosterDensity(ctx.posterDensity);
    if (d === 'custom') {
        const n = normalizePosterColumns(ctx.posterColumns);
        return `自定义列数 ${n} 列（约 ${posterCardSizeForColumns(n)}px/张，按面板宽 ${BASES_PANEL_WIDTH_ESTIMATE}px 估算）`;
    }
    return `${d}（${POSTER_CARD_MIN_WIDTHS[d]}px/张）`;
}

/**
 * 生成一份 `.base` 文件内容（YAML 文本，以换行结尾）。
 *
 * 🔴 **文件目录范围只写进顶层 `filters`（All views 区），视图里不再重复** ——
 *    见 `combineFilters` 的注释：用户 #690 抱怨「视图非常长」，根因就是这条范围条件被抄了 N 遍。
 *
 * 🔴 **为什么按子目录逐个 inFolder、而不是一条 `file.inFolder("笔记")`**：
 *    Bases 的 `file.inFolder` 与 dataview 的 `from` 不同 —— 它**只匹配直接子文件**，不递归。
 *    而本插件的笔记都落在 `笔记/<类型>/`（书籍还分 book/novel/comic 三种），
 *    只写父目录会**一条都匹配不到**（实测：用户库里全部条目都在子目录里）。
 *    这里按真实子目录逐个列举，用 `or` 节点（⛔ 不是塞进一条字符串里 `||`）。
 *
 * ⚠️ `note.type` 是第二道闸，用来挡掉用户自己丢进这些目录、但没有 frontmatter 的普通笔记。
 *
 * @param ctx 库目录 / 版本 / 海报密度
 * @returns YAML 文本
 */
export function buildBaseTemplate(ctx: BaseTemplateContext): string {
    const folder = baseNotesFolder(ctx.libraryDir);
    const subFolders = noteSubDirs().map((d) => `${folder}/${d}`);
    /** 本库所有条目：在笔记的任一类型子目录内 + 有 type（用户手动笔记没有 type） */
    const scopeNode: FilterNode = { or: subFolders.map((d) => `file.inFolder(${exprStr(d)})`) };
    const baseFilters: FilterNode[] = [scopeNode, 'note.type'];
    const ofType = (t: EntryType): FilterNode[] => {
        // 单一类型的笔记只会落在**一个**子目录里（书籍三分类都算 book 类型）⇒ 这里只取该类型的目录，
        // 让视图的「This view」区短一些；书籍则把三个分类目录都列上。
        const dirs = t === 'book'
            ? [ENTRY_TYPE_DIRS.book, ...Object.values(BOOK_KIND_DIRS)]
            : [ENTRY_TYPE_DIRS[t]];
        const uniq = [...new Set(dirs)];
        const scope: FilterNode = uniq.length === 1
            ? `file.inFolder(${exprStr(`${folder}/${uniq[0]}`)})`
            : { or: uniq.map((d) => `file.inFolder(${exprStr(`${folder}/${d}`)})`) };
        return [scope, `note.type == ${exprStr(t)}`];
    };

    const views: ViewSpec[] = [];
    const cardSizeFor = (): Pick<ViewSpec, 'cardSize'> => cardSizePick(ctx.posterDensity, ctx.posterColumns);
    /** cards 视图的三个固定件：封面（2:3 竖版）+ 密度 + 卡片属性（标题/年份/作者/题材/状态/评分） */
    const cardChrome = () => ({ ...posterImage(), ...cardSizeFor(), properties: [...CARD_PROPERTIES] });
    /**
     * 只带「类型」范围、不带 `note.type ==` 的筛选 —— 给分组视图用：
     * 它们本来就是按 type 分组，再写一条同样的判据是纯冗余。
     */
    const ofTypeScope = (t: EntryType): FilterNode[] => ofType(t).slice(0, 1);
    /** 全部条目的「本视图」筛选 = 空（范围由顶层兜住）。显式写出来是为了让人一眼看到「这里没有重复」。 */
    const all: FilterNode[] = [];

    // ── 1. 海报墙：封面优先 ────────────────────────────────────────────────────────
    //    🔴 2026-10-22 用户裁定（原话：「Bases 视图模板的优化一下，目前视图太多了，
    //       缩进每个类型海报墙的排序行」）：**6 个类型海报墙合并成 1 个按类型分组的卡片视图**。
    //    理由：这 6 张和「全部海报墙」只差一条 `note.type ==` 判据，Bases 一个 cards 视图
    //    加 `groupBy: type` 就能按类型分段显示，观感等价而标签栏少 6 个（原来 30 个已顶到可用上限）。
    views.push(
        {
            type: 'cards',
            name: '全部海报墙',
            filters: all,
            columns: ['title', 'type', 'status', 'rating'],
            sort: SORT_RECENT,
            ...cardChrome(),
        },
        {
            type: 'cards',
            name: '海报墙 · 按类型分段',
            filters: all,
            columns: ['title', 'status', 'rating'],
            sort: SORT_RECENT,
            groupBy: { property: 'type', direction: 'ASC' },
            ...cardChrome(),
        },
    );

    // ── 2. 全部收藏总表 ────────────────────────────────────────────────────────────
    views.push({
        type: 'table',
        name: '全部收藏',
        filters: all,
        columns: ['title', 'type', 'status', 'rating', 'year', 'created', 'updated'],
        sort: SORT_RECENT,
    });

    // ── 3. 各类型表格 ──────────────────────────────────────────────────────────────
    //    🔴 同上的裁定：6 张「全部XX」表合并成 1 张按类型分组的表（用户选了最激进的方案）。
    //    每个类型的列本来就不同（book 要作者/ISBN、game 要平台…），合并后取**并集里最通用**的几列，
    //    想看某类型的专属列，切到该分组后按「⋯ › 属性」临时加即可 —— 列是视图内设置，不用占视图。
    views.push({
        type: 'table',
        name: '全部收藏 · 按类型分段',
        filters: all,
        columns: ['title', 'type', 'status', 'rating', 'year', 'author', 'updated'],
        sort: SORT_RECENT,
        groupBy: { property: 'type', direction: 'ASC' },
    });

    // ── 4. 按状态筛选 ──────────────────────────────────────────────────────────────
    for (const s of MEDIA_STATUSES) {
        const stateCols = s === 'watching'
            ? ['title', 'type', 'progress_percent', 'progress_season', 'progress_episode', 'updated']
            : ['title', 'type', 'rating', 'year', 'updated'];
        views.push({
            type: 'table',
            name: `状态 · ${STATUS_LABELS[s]}`,
            filters: [`note.status == ${exprStr(s)}`],
            columns: stateCols,
            sort: SORT_RECENT,
        });
    }

    // ── 5. 通用筛选：高分 / 最近添加 ────────────────────────────────────────────────
    views.push(
        {
            type: 'table',
            name: '高分 · 4 星及以上',
            filters: ['note.rating >= 4'],
            columns: ['title', 'type', 'rating', 'year', 'status'],
            sort: SORT_RATING,
        },
        {
            type: 'table',
            name: '高分 · 满分 5 星',
            filters: ['note.rating >= 5'],
            columns: ['title', 'type', 'rating', 'year', 'status'],
            sort: SORT_RATING,
        },
        {
            type: 'table',
            name: '最近添加',
            filters: all,
            columns: ['title', 'type', 'status', 'rating', 'created'],
            sort: SORT_CREATED,
        },
    );

    // ── 6. 分组视图：排序列 / 排序方向 / 分组 都在视图自己的标签菜单里改 ───────────────
    //    🔴 这三样**不需要**各开一个视图 —— Bases 的视图菜单本身就能切排序与分组。
    //       早先我把 8 档排序 + 5 档分组铺成 13 个视图，用户 #690 直接说「视图非常长了」，已改正。
    //    🔴 只按 frontmatter 里真实存在的键（⛔ 别写 bookKind/musicKind —— 笔记里没有这两个键）。
    //    ⚠️ genres 是**列表**：同一作品会出现在多组，正常。
    views.push(
        {
            type: 'table',
            name: '分组 · 按类型',
            filters: all,
            columns: ['title', 'status', 'rating', 'year'],
            sort: SORT_ALPHA,
            groupBy: { property: 'type', direction: 'ASC' },
        },
        {
            type: 'table',
            name: '分组 · 按题材',
            filters: ['note.genres'],
            columns: ['title', 'type', 'rating', 'year'],
            sort: SORT_ALPHA,
            groupBy: { property: 'genres', direction: 'ASC' },
        },
    );

    // ── 7. 大众评分（探测到才加）──────────────────────────────────────────────────
    //    🔴 `noteGenerator.entryFrontmatter` 目前**不写** communityScore ⇒ `note.communityScore` 恒空。
    //    生成一个切开全是空行的视图，比没有更糟（用户会以为「同步没进来」）。
    //    ⇒ 只有库里真的存在这个键（ctx.hasCommunityScore）才生成。
    if (ctx.hasCommunityScore) {
        views.push({
            type: 'table',
            name: '大众评分',
            filters: [`note.${COMMUNITY_SCORE_PROP}`],
            columns: ['title', 'type', COMMUNITY_SCORE_PROP, 'rating', 'year'],
            sort: sortCommunity(),
        });
    }

    // ── 8. 类型 · 状态十字表（每个类型一张，按状态分组）──────────────────────────────
    //    🔴 这是「分组的另一维」：上面「分组 · 按类型与状态」是**一次只按一个键**分组，
    //       想要「电影里再按状态分」，就得每个类型各一张 —— 但只加 6 张，不随状态数翻倍。
    views.push(
        ...ENTRY_TYPES.map((t) => ({
            type: 'table' as const,
            name: `${ENTRY_TYPE_LABELS[t]} · 按状态`,
            filters: ofTypeScope(t),
            columns: ['title', 'status', 'rating', 'year'],
            sort: SORT_ALPHA,
            groupBy: { property: 'status', direction: 'ASC' as const },
        })),
    );

    // 今年看的（卡片）：单独 push，避免打乱「先表格后分组」的阅读顺序。
    views.push({
        type: 'cards',
        name: '今年看的',
        filters: [`note.status == ${exprStr('watched')}`],
        columns: ['title', 'type', 'rating'],
        sort: SORT_RECENT,
        ...cardChrome(),
    });

    const head = [
        '# ReelLudic 收藏库 —— Obsidian Bases 视图模板（由插件生成，可自由修改）',
        '#',
        `# 生成来源：ReelLudic v${ctx.pluginVersion}  ›  设置 › 数据与工具 › 生成 Bases 视图模板`,
        `# 数据范围：${folder}/<类型> 下 frontmatter 带 type 的笔记（即本插件生成的条目笔记）`,
        `#   子目录：${noteSubDirs().join(' / ')}`,
        `#   ⚠️ 这条范围只写在下面的 filters:（Bases 的「All views」区）里，**每个视图里不再重复**。`,
        '#',
        '# 属性名与笔记 frontmatter 逐字一致（见 data/noteGenerator.entryFrontmatter）。',
        `# 类型取值：${ENTRY_TYPES.map((t) => `${t}（${ENTRY_TYPE_LABELS[t]}）`).join('、')}`,
        `# 状态取值：${Object.entries(STATUS_LABELS).map(([k, v]) => `${k}（${v}）`).join('、')}`,
        '#',
        '# 排序与分组：都是**各个视图自己的设置**（视图标签右侧的「⋯」菜单里能直接改），',
        '#   所以没有为每档排序/分组各开一个视图。想按标题、按年份、按评分排，切到任意视图改一下即可。',
        '#   现有几组「分组 · …」是常用的默认档，直接照着改成别的也行。',
        '#',
        '# 🔴 排序是**一组**，不是一个：sort: 下面可以写多项，从主序到次序逐条生效 ——',
        '#   正是视图菜单「排序依据 › + 添加排序」加出来的那几行（前一项相同才比后一项）。',
        '#   本模板给每个视图都配了兜底键：(最近更新 → 标题 A-Z)、(评分 → 最近更新 → 标题)。',
        '#   少配的话主序一打平，Bases 就回落到文件名 —— 看着像「明明按更新排的，这几条怎么乱插」。',
        '#   想只留一条，把多余的 `- property:` + `direction:` 两行删掉即可。',
        '#',
        '# 海报墙：封面取 banner，**2:3 竖版**（imageAspectRatio: 1.5 —— Bases 这个值是「高/宽」），与插件海报墙同一比例。',
        '# 卡片属性：标题 / 年份 / 作者 / 题材 / 状态 / 个人评分。',
        '#   「作者」是一条兜底链 author || artist || director || developer —— 电影剧集动画只有 director、游戏只有 developer，',
        '#   只写 author 那些卡片会空着。',
        `# 卡片密度：跟随插件「海报密度」设置 —— ${densityNote(ctx)}`,
        '# 想更密/更疏：在每个 cards 视图下改 cardSize（px 越大卡片越大、每行越少）。',
        '#',
        '# 本文件是纯文本 YAML，随便改：加列（表格写进 order、卡片写进 cardProperties）、改滤镜、加视图都行。',
        '# 改这里**不影响**笔记本身 —— Bases 只读 frontmatter。',
        '#',
        '# 样式：想连观感一起统一，去 设置 › 外观 › CSS 代码片段 启用 `ReelLudic Bases 样式.css`',
        '#   （用「生成 Bases 视图模板」时插件会一并写入 .obsidian/snippets/）。',
        '#   它只作用于卡片观感，不依赖任何插件私有类名。',
        '#',
        '# ⚠️ 若你在「高级设置 › 字段映射」里改过属性名，笔记里的键名已变，请把下面对应的键换成映射后的名字，',
        '#    否则那一列会恒空（Bases 不报错，只是查不到）。',
    ];

    // 🔴 顶层 filters = Bases 的「All views」区：**文件范围只写这一次**，所有视图共享。
    //    各视图内那份 = 「This view」区，只放该视图真正多出来的条件。两份不是冗余，别合并。
    const body = ['', 'filters:', ...renderFilterMap('  ', combineFilters(baseFilters)!), '', 'views:'];
    const viewText = views.map(renderView).join('\n');
    return [...head, ...body, viewText, ''].join('\n');
}

export function baseTemplateFile(libraryDir: string): string {
    const dir = normalizeLibDir(libraryDir);
    const leaf = dir.slice(dir.lastIndexOf('/') + 1) || dir;
    return `${leaf}.base`;
}

/** 媒体库目录归一化（反斜杠→斜杠、去首尾斜杠、空值回落 `ReelLudic`）—— 三处调用点共用，⛔ 别各写一份 */
function normalizeLibDir(libraryDir: string): string {
    const dir = (libraryDir || 'ReelLudic')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
    return dir || 'ReelLudic';
}

/**
 * **旧版**固定文件名（#690 之前写死的那个）。
 * ⚠️ 只用于「需要提醒用户删旧文件」的判断，⛔ 不要拿它当新模板的写入目标。
 */
export const BASE_TEMPLATE_FILE_LEGACY = 'ReelLudic.base';

/**
 * 配套 CSS 片段的**源文件**（随插件一起分发，由 esbuild 注册成虚拟模块 `reelludic:bases-css`）。
 * 🔴 源文件放 `docs/` 而不是拿字符串拼接：这样它在编辑器里是真正的 CSS（有高亮、有校验），
 *    也不会被 Svelte 的样式处理卷进去。⚠️ 改文件名要同步 `esbuild.config.mjs` 的插件注册。
 */
export const BASE_SNIPPET_FILE = 'ReelLudic Bases 样式.css';

/** CSS 片段在 vault 里的路径（`.obsidian/snippets/<名字>`） */
export function baseSnippetPath(): string {
    return `.obsidian/snippets/${BASE_SNIPPET_FILE}`;
}

/** 模板文件的 vault 路径（`{libraryDir}/{媒体库目录名}.base`） */
export function baseTemplatePath(libraryDir: string): string {
    return `${normalizeLibDir(libraryDir)}/${baseTemplateFile(libraryDir)}`;
}

/**
 * 「大众评分」这一档排序要不要生成 —— #690（用户把「大众评分↓↑」列进了要加的排序里）。
 *
 * 🔴 事实：`noteGenerator.entryFrontmatter` **不写** `communityScore`（它只出现在正文的
 *    「大众评分」那一行表格里，见 src/data/noteGenerator.ts:286）。所以 `note.communityScore`
 *    在 Bases 里恒空 —— 直接生成那两档就是「点开一片空白」，比不生成更糟。
 * ⇒ 这里**探测**：只有当库里的条目笔记真的带了这个键时才生成。
 *    ⚠️ 探测结果来自 vault 扫描（见 main.ts 的 hasFrontmatterKey），不是这里自己读文件 ——
 *    本模块是纯逻辑，不碰 IO。
 */
export const COMMUNITY_SCORE_PROP = 'communityScore';