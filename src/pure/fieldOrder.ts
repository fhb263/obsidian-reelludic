/**
 * 笔记属性（frontmatter 键）的**写出顺序**配置（1.3.1 ① 第 3 件，2026-10-12）。
 *
 * ## 它解决什么
 * 上一批（#612/#613）的**字段映射**控的是「这个属性**叫什么名字**」，本模块控的是
 * 「它**排在第几位**」—— 两者互补，都是让插件生成的笔记 frontmatter 更贴近用户自己的习惯。
 *
 * ## 口径（🔴 三条都别记错）
 * ⑴ **按类型分开配**（用户点名「各类型」）—— 影视的 `director/cast` 与书籍的 `author/publisher`
 *    关心的顺序并不一样，所以 `EntryType` 六个类型各有一份有序表。
 * ⑵ **只排序、不增删**：可排的字段集 = 该类型**适用的字段**（`META_FIELDS.types` 过滤后的结果），
 *    ⛔ 用户不能在这里决定「写不写某个字段」（那是「有值才写」的既有规则，见 `entryFrontmatter`）。
 * ⑶ **缺省 = 现有写出顺序**（`META_FIELDS` 的顺序）⇒ 没配过的用户观感零变化；配过但字段集之后新增了
 *    字段的，新字段按缺省位置**追加**（见 `normalizeFieldOrder`），⛔ 绝不丢。
 *
 * ## 施加点
 * `data/noteGenerator.entryFrontmatter` 的**第二道文本层**处理（第一道是字段映射改名）。
 * 🔴 顺序是**先排序、后改名** —— `order` 数组里存的是**原始键名**；反过来做的话，
 *    映射表也得跟着换一套键名，白白多一层耦合。
 *
 * ⚠️ 与 `pure/seriesGroup.moveItem` 的关系：那个「搬走 + 插入、其余保序」的纯函数是**通用件**，
 *    本模块的拖拽列表直接复用它（⛔ 不另写第二份搬数组的实现）。
 */
import type { BookKind, EntryType } from 'data/types';
import { BOOK_KINDS } from 'pure/bookKind';
import { META_FIELDS, fieldAppliesTo } from 'pure/metaFields';

/** 六个条目类型（顺序 = 设置页里折叠项的排列顺序） */
export const FIELD_ORDER_TYPES: readonly EntryType[] = ['movie', 'tv', 'anime', 'book', 'game', 'music'];

/** 各类型的顺序配置（`Partial` ⇒ **只存被用户改过的类型**，没改的走缺省） */
export type FieldOrderConfig = Partial<Record<EntryType, string[]>>;

/**
 * 某类型的**缺省**顺序 = 该类型适用的字段（按 `META_FIELDS` 的登记顺序，那正是现在的写出顺序）。
 * ⚠️ 只登记了「代码里真的按类型门控」的字段（见 `MetaField.types` 的说明）—— 通用字段全类型都在。
 * 🔴🔴 **注意这个函数的语义边界**（#640 的教训）：它回答的是「**写出侧会不会考虑这个字段**」，
 *    ⛔ **不是**「这个字段对这个类型有没有意义」。因为 `MetaField.types` 只标记「有 `e.type ===` 门控」
 *    的字段，`director`/`author`/`isbn`/`developer` 这些「有值就写」的字段**六类都会返回**
 *    ⇒ 拿它做「六个类型全都有」的交集，会把导演/作者这类**类型专属**字段误判成公共字段。
 *    要判「公共字段」请用 {@link GLOBAL_FIELD_KEYS}。
 */
export function defaultOrderFor(type: EntryType): string[] {
    return META_FIELDS.filter((f) => !f.types || f.types.includes(type)).map((f) => f.key);
}

/**
 * 🔴🔴 #640：「全局属性」—— 六个条目类型**都会写**的那批键（设置页主从视图「全局」那一页显示的就是它）。
 *
 * ## 口径纠正（#640f，用户：「什么鬼，不是所有条目不都有这些字段吗，给我好好查啊」）
 * 第一版我手写了 8 个键（id/type/title/…/updated）就交差，把 **封面 / 年份 / 题材 / 又名 /
 * 观看日期 / 计划日期 / 系列 / 系列序号** 全漏在外面 —— 用户一眼看出来「这些字段不是每条都有吗」。
 * **用户是对的**：写出侧 `entryFrontmatter` 里这些字段全是 `if (e.<field>)`（**零类型门控**），
 * 任何类型的条目只要有值就会写进去。
 *
 * ## 现在的定义 = **「类型专属」的补集**（⛔ 不再是手抄清单）
 * 「类型专属」的真源 = `MetaField.appliesTo`（只登记**只可能出现在某几个类型**的字段，
 * 判据是写出侧的代码事实，见该字段的注释）。于是：
 *
 *     全局 = 所有已登记字段 − 专属字段
 *
 * ⇒ **自动跟着字段表走**：以后加一个通用字段，它自动进全局页；加一个专属字段（带 `appliesTo`），
 *   它自动进对应类型页。⛔ 不必（也不该）再维护第二份手抄名单 —— 那正是本批这个 bug 的来源。
 *
 * ⚠️ 顺序沿用 `META_FIELDS` 的登记序（= `entryFrontmatter` 的写出序），保证「全局」页与
 *    笔记里的初始顺序一致；⛔ 不按字典序重排。
 */
export const GLOBAL_FIELD_KEYS: readonly string[] = META_FIELDS.filter((f) => !f.appliesTo).map((f) => f.key);

/** 某键是否属于「全局属性」（六个类型共用）—— 设置页主从视图的唯一判据 */
export function isGlobalFieldKey(key: string): boolean {
    return GLOBAL_FIELD_KEYS.includes(key);
}

/**
 * 某类型的**专属字段**（= 该类型适用、且不属于 {@link GLOBAL_FIELD_KEYS} 的那批键）。
 * 🔴 设置页「某类型」那一页显示的就是它；顺序沿用 `defaultOrderFor`（= `META_FIELDS` 的登记序）。
 *
 * 🔴🔴 #640 起**还按专属类型过滤**（`MetaField.appliesTo`）：只除掉公共字段是不够的 ——
 *    `defaultOrderFor` 是按「写出侧有没有类型门控」算的，`director`/`isbn` 这类「有值就写」的字段
 *    会对**六个类型**都返回 ⇒ 不过滤的话「书籍」页会列出导演/主演、「音乐」页会列出 ISBN/出版社
 *    （用户报障的另一半：「我要的是6个类型相同的笔记属性才显示」）。
 *    ⇒ 两道过滤缺一不可：**除掉公共字段**（进全局页）+ **只留属于该类型的**（`appliesTo`）。
 * ⚠️ 两道过滤**用的是同一个判据**（`appliesTo` 的两个方向）⇒ 两者天然互补、不会漏字段也不会重叠：
 *    `!isGlobalFieldKey(k)` ⇔ `fieldAppliesTo(k, type)` 对**专属字段**恒等价；
 *    公共字段则 `isGlobalFieldKey` 为真而被滤掉。
 */
export function exclusiveFieldsFor(type: EntryType): string[] {
    return defaultOrderFor(type).filter(
        (k) => !isGlobalFieldKey(k) && fieldAppliesTo(k, type),
    );
}

/**
 * 归一化某类型的配置数组：
 *   · 丢掉**不认识的键**（拼错 / 旧版本残留 / 手改 data.json）；
 *   · 丢掉**该类型不适用的键**（比如把 `isbn` 排进「电影」）；
 *   · 去重；
 *   · 缺省里有、配置里没有的（**之后新增的字段**、或用户配置不全）⇒ 按缺省顺序**追加到末尾**。
 *     🔴 这一步是保命的：少了它，新增字段会从「没配过顺序」直接变成「写不出来」。
 */
export function normalizeFieldOrder(type: EntryType, v: unknown): string[] {
    return narrowOrder(v, defaultOrderFor(type));
}

/**
 * 把「任意顺序数组」按 `allowed`（= 该分组的**允许字段集**，其顺序即缺省序）**收窄 + 补齐**：
 *   · 非数组 ⇒ 直接给允许集（缺省）；
 *   · 丢掉不在允许集里的键（拼错 / 旧版本残留 / 手改 data.json / **被子类排除表剔掉的键**）；
 *   · 去重；
 *   · 允许集里有、配置里没有的 ⇒ 按允许集顺序**追加到末尾**（同上，保命的那一步）。
 *
 * 🔴 类型（`normalizeFieldOrder`）与书籍子类（`normalizeFieldOrderForKind`）**共用这一份实现**，
 *    ⛔ 别复制第二份：两处口径一旦漂移，类型页与子类页的归一行为就不一致，而单测只钉得住其中一份。
 * 🔴 它同时也是 `orderForBookKind` **回落链**的收窄器（把 `fieldOrder.book` 掐成该子类的字段集），
 *    所以这里的 `allowed` 是参数而非「某类型」—— 调用方决定口径。
 */
function narrowOrder(v: unknown, allowed: readonly string[]): string[] {
    if (!Array.isArray(v)) return [...allowed];
    const allowedSet = new Set(allowed);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of v) {
        if (typeof k !== 'string' || !allowedSet.has(k) || seen.has(k)) continue;
        seen.add(k);
        out.push(k);
    }
    for (const k of allowed) if (!seen.has(k)) out.push(k);
    return out;
}

/** 该顺序是否就是缺省（一致 ⇒ 不必落盘，将来新增字段能自动落在缺省位置） */
export function isDefaultOrder(type: EntryType, order: readonly string[]): boolean {
    const d = defaultOrderFor(type);
    return d.length === order.length && d.every((k, i) => k === order[i]);
}

/** 取某类型**当前生效**的顺序（未配置 / 无效 ⇒ 缺省） */
export function orderForType(cfg: unknown, type: EntryType): string[] {
    const rec = (cfg ?? {}) as Record<string, unknown>;
    return normalizeFieldOrder(type, rec[type]);
}

// ══════════════════════════════════════════════════════════════════════════════
// 🔴🔴 #640e：书籍的**子分类维度**（文学 / 网文 / 漫画）
//
// 用户（2026-10-16）：「高级设置-属性分组再新增**文学网文**更明确的分组，新增归类对应属性」
//   → 追问裁定「拆成 **文学 / 网文 / 漫画** 三页」。
//
// 为什么要多一个维度：文学与网文的属性集**真不一样**（网文有「上架年 / 元数据章数」，
//   文学有「译者 / 出版社 / ISBN / 装帧 / 定价」）—— #440 起写出侧就是这么分叉的。
//   而 `fieldOrder` 原来**只按 `EntryType` 六类存**，书籍三者共用同一份顺序
//   ⇒ 「文学/网文各排各的」在数据模型上根本表达不出来。
//
// 🔴 存储口径（**零迁移**）：新增一个**并行的可选键** `fieldOrderByKind`（`{ book|novel|comic: string[] }`），
//    `fieldOrder` **原样保留**（继续服务六类型，也是书籍三子类的**回落**）。
//    ⇒ 没配过的用户：`fieldOrderByKind` 缺席 ⇒ 回落 `fieldOrder.book`，**再按子类排除表收窄**
//      （见下面的 `BOOK_KIND_EXCLUDED_FIELDS`）⇒ 用户配好的顺序照旧生效，
//      只是该子类真不写的字段（如网文的 ISBN）被剔掉。
//    ⛔ 别把书籍那一份从 `fieldOrder` 里删掉（老用户的数据在它里面）。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 🔴🔴 书籍三子类的**字段集分叉**（用户 2026-10-19 裁定，本轮新增）。
 *
 * 用户原话：「文学」「网文」分类下**不该出现画师**（画师只属漫画）；
 *          「网文」分类下**不该出现 ISBN**（ISBN 是出版实体书特有 ⇒ 文学 / 漫画留，网文去）。
 *
 * ## 两个字段的语义归属（注释即口径，⛔ 别按别的理解改这张表）
 * · `artist`（画师）—— **漫画**单行本的作画者。文学 / 网文是纯文字作品，没有「画师」这一栏。
 * · `isbn` —— **已出版实体书**的国际标准书号。网文是网络连载（上架年 / 元数据章数那一套），
 *   没有 ISBN；文学（出版书）与漫画（单行本）都有。
 *
 * ## 为什么是「排除表」而不是「三个子类各写一份允许表」
 * `artist` / `isbn` 在 `MetaField.appliesTo` 里仍然是 `['book']` —— 它们是 **book 这一个大类**
 * 的专属字段（判据是写出侧的类型门控，与子类无关），五类之外本来就没有。
 * 三个子类的差异**只在 `fieldOrder` 这一层**表达：
 *
 *     子类字段集 = 大类字段集 − 该子类的排除键
 *
 * ⇒ 以后给书籍加字段，三个子类自动继承，⛔ 不用（也不该）维护三份清单。
 * ⛔ 别去改 `MetaField.appliesTo` 的既有语义来硬套子分类 —— 那会把「类型门控」和
 *   「子类字段集」两个问题搅成一处，`fieldAppliesTo` 的所有调用方都会跟着变味。
 */
export const BOOK_KIND_EXCLUDED_FIELDS: Readonly<Record<BookKind, readonly string[]>> = {
    book: ['artist'],
    // 🔴 2026-10-21（用户「字段字典按表重置」）网文那一列只留：作者 / 首发平台 / 连载状态 / 字数 /
    //    已读字数 / 阅读时长 ⇒ 出版物那一套（ISBN、出版社、译者、装帧、定价）与**按页计**的进度
    //    （总页数 / 已读页数）都不是网络连载的计量口径（网文按字数），⛔ 别因为「代码能写」就留着 ——
    //    网文笔记里出现「出版社」「装帧」「定价」三行，正是用户这次点名要修的「冗余/错配」。
    novel: ['artist', 'isbn', 'translator', 'publisher', 'binding', 'price', 'reading_total_page', 'reading_page', 'page_count'],
    comic: ['isbn'],
};

/**
 * 某书籍子类的**专属字段** = `exclusiveFieldsFor('book')` **减掉**该子类的排除键。
 * 顺序沿用 `META_FIELDS` 的登记序（`exclusiveFieldsFor` 已保证，这里只做过滤、不重排）。
 * 🔴 设置页「文学 / 网文 / 漫画」那三页显示的就是它 —— 与类型页的 `exclusiveFieldsFor(t)` **对称**。
 */
export function exclusiveFieldsForBookKind(kind: BookKind): string[] {
    const excluded = BOOK_KIND_EXCLUDED_FIELDS[kind];
    return exclusiveFieldsFor('book').filter((k) => !excluded.includes(k));
}

/** 书籍子分类的顺序配置（`Partial` ⇒ 只存被改过的子类） */
export type FieldOrderByKindConfig = Partial<Record<BookKind, string[]>>;

/**
 * 某书籍子分类的**缺省**顺序 = `defaultOrderFor('book')` 减掉该子类的排除键
 * （见 {@link BOOK_KIND_EXCLUDED_FIELDS}）。
 *
 * ⚠️ 沿革（⛔ 别留旧说法的影子）：本函数此前是「`defaultOrderFor('book')` 原样返回，
 *    子类暂不换字段集」—— #640e 当时只拆了「各排各的顺序」。**2026-10-19 用户裁定字段集真的分叉**：
 *    文学无画师 / 网文无画师无 ISBN / 漫画无 ISBN ⇒ 三份缺省**不再同一份**，
 *    ⛔ 别再按「三个子类字段集相同」的假设写调用方（对比视图那三列也是因此才拆开的）。
 */
export function defaultOrderForBookKind(kind: BookKind): string[] {
    const excluded = BOOK_KIND_EXCLUDED_FIELDS[kind];
    return defaultOrderFor('book').filter((k) => !excluded.includes(k));
}

/** 归一化某书籍子分类的顺序数组（口径与 `normalizeFieldOrder` 逐条相同，只是字段集取该子类那份） */
export function normalizeFieldOrderForKind(kind: BookKind, v: unknown): string[] {
    return narrowOrder(v, defaultOrderForBookKind(kind));
}

/** 该子分类顺序是否就是缺省 */
export function isDefaultKindOrder(kind: BookKind, order: readonly string[]): boolean {
    const d = defaultOrderForBookKind(kind);
    return d.length === order.length && d.every((k, i) => k === order[i]);
}

/**
 * 取某书籍子分类**当前生效**的顺序。
 * 🔴 回落链：`fieldOrderByKind[kind]` → **`fieldOrder.book`** → 缺省。
 *    中间那一跳是**零迁移的关键**：老用户只配过「书籍」那一份，文学/网文/漫画要一起继承它，
 *    ⛔ 而不是各自回到缺省（否则升级后用户配好的书籍顺序在网文笔记里会「消失」）。
 *
 * 🔴🔴 回落那一跳**必须再按子类收窄**（⛔ 不能直接 `return orderForType(cfg, 'book')`）：
 *    `fieldOrder.book` 是**完整的书籍顺序**，里面通常就带着 `artist` / `isbn`（缺省序里本来就有）
 *    ⇒ 原样带回网文 = 排除表对「没配过子类」的用户**完全失效**，而那恰恰是**绝大多数用户**
 *    （2026-10-19 之前根本不存在 `fieldOrderByKind`）。旧数据里被人排进网文的 `isbn`/`artist`
 *    也会在这一步被自然清掉 —— 与 `normalizeFieldOrderForKind` 共用同一个收窄器，不另写一份。
 */
export function orderForBookKind(cfg: unknown, kindCfg: unknown, kind: BookKind): string[] {
    const kRec = (kindCfg ?? {}) as Record<string, unknown>;
    if (Array.isArray(kRec[kind])) return normalizeFieldOrderForKind(kind, kRec[kind]);
    return narrowOrder(orderForType(cfg, 'book'), defaultOrderForBookKind(kind));
}

/** 一次算出三个书籍子分类的生效顺序 */
export function resolveAllKindOrders(cfg: unknown, kindCfg: unknown): Record<BookKind, string[]> {
    const out = {} as Record<BookKind, string[]>;
    for (const k of BOOK_KINDS) out[k] = orderForBookKind(cfg, kindCfg, k);
    return out;
}

/** 一次算出六个类型的生效顺序（宿主构造时算一次，别在每次写笔记时重算） */
export function resolveAllOrders(cfg: unknown): Record<EntryType, string[]> {
    const out = {} as Record<EntryType, string[]>;
    for (const t of FIELD_ORDER_TYPES) out[t] = orderForType(cfg, t);
    return out;
}

/**
 * 把生成好的 YAML 里的**键行**按 `order` 重排。
 *
 * 🔴 为什么在**文本层**做（与字段映射同一层）：`entryFrontmatter` 是按固定顺序「有值才 push」的，
 *    要在生成侧排序就得先把 42 个条件分支拆成「先收集再排」，那会把那段读起来很顺的代码毁掉；
 *    文本层只认「行首到第一个冒号」，与生成逻辑完全解耦。
 *
 * ⚠️ `order` 里没有的键（正常不会有，除非代码新增字段而配置没跟上）⇒ **保持原相对位置、统一落到末尾**，
 *    ⛔ 绝不清掉那一行。
 * ⚠️ 值里含冒号（如 `title: "沙丘2: Part Two"`）不受影响 —— 键永远在行首，取的是**第一个**冒号。
 */
export function applyFieldOrder(fm: string, order: readonly string[]): string {
    if (!order.length) return fm;
    const lines = fm.split('\n');
    if (lines[0] !== '---') return fm;
    const endIdx = lines.indexOf('---', 1);
    if (endIdx < 0) return fm;

    const rank = new Map(order.map((k, i) => [k, i]));
    const keyOf = (line: string): string => {
        const i = line.indexOf(':');
        return i > 0 ? line.slice(0, i) : '';
    };
    const body = lines
        .slice(1, endIdx)
        .map((line, i) => ({ line, i, r: rank.get(keyOf(line)) ?? Number.MAX_SAFE_INTEGER }));
    // ⚠️ 用原下标做二级比较 ⇒ 同秩（都未登记）的项保持原有先后（显式稳定，别赌引擎实现）
    body.sort((a, b) => a.r - b.r || a.i - b.i);

    return [lines[0], ...body.map((x) => x.line), '---', ...lines.slice(endIdx + 1)].join('\n');
}
