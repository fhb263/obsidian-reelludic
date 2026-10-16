/**
 * 元数据字段真源（1.3.1 ①，2026-10-12 建立；#613 改「逐行可填表格」）。
 *
 * ## 为什么要有这份表
 * 条目笔记的 frontmatter 键名散落在**两个真源**里：
 *   ① 写侧 `data/noteGenerator.entryFrontmatter`（YAML 输出）
 *   ② 读侧 `pure/noteEditable.extractFrontmatterFromNote`（handlers 解析回 catalog）
 * 两边各自手写了一份键名清单 ⇒ 谁新增一个字段都可能只改了一边（本仓已有一例：
 * `artist` 写侧有、读侧没有）。本表把两份清单**收敛成一处可枚举真源**，供三个消费者共用：
 *   · 「高级设置 › 字段映射」的**逐字段输入表格**（一行一个字段 ⇒ 这张表就是那个表格的行源）
 *   · 同页的字段清单信息（中文名 / 原属性名 / 形态 / 适用类型）
 *   · 单测（断言两侧的键集合与 `writable` / `readable` 标记一致）
 *
 * 🔴 **本表是描述性的，不是驱动性的** —— 它**不**负责真正生成 YAML 或解析（那两处不动）。
 *    新增字段时先改 `entryFrontmatter` / `handlers`，再回来登记；单测会钉住三者一致。
 *
 * ## #613 翻面：**所有字段都可映射**
 * 1.3.1 ① 首版把 `tags` / `created` / `updated` / `rating` 钉成「不可映射」，理由是它们是
 * **Dataview 对齐键**（用户既有的 `TABLE rating FROM #movie WHERE rating >= 4` 全靠这几个键，
 * 改名会让那些查询**静默返回空**）。
 * ⛔ #613 用户裁定「所有映射字段改成表格**全部可填**」⇒ 那个**硬拦截撤销**：
 *    - 原 `mappable: boolean` 字段**整体删除**（全 true 的布尔没有信息量）；
 *    - 改为 `dataviewAligned?: true` —— 只作**提示标记**（设置页在那几行挂一枚 `Dataview` 小徽标，
 *      悬停说明「改名会让既有查询失效」），**不再拦**；
 *    - `isMappableKey()` 的语义收窄成「**是否在本表登记过**」—— ⛔ 未登记的键仍然拒绝
 *      （拒绝改名一个不存在的字段，比放行安全：拼错了会静默写出一堆谁也不认的键）。
 */
import type { EntryType } from 'data/types';

/** frontmatter 值的形态（决定设置页表格里的「形态」列） */
export type MetaFieldKind = 'string' | 'number' | 'list' | 'date' | 'enum';

/** 一个元数据字段的完整描述 */
export interface MetaField {
    /** YAML 键名（= `entryFrontmatter` 写出的键） */
    key: string;
    /** 中文名（设置页表格第一列） */
    label: string;
    kind: MetaFieldKind;
    /** 写侧 `entryFrontmatter` 是否输出（部分字段只在有值时输出，这里指「可能输出」） */
    writable: boolean;
    /** 读侧 `extractFrontmatterFromNote` 是否解析回 catalog */
    readable: boolean;
    /**
     * **Dataview 对齐键**（`tags` / `created` / `updated` / `rating`）—— 仅作设置页的提示标记。
     * ⚠️ 不再是「不许改」：改名会让用户既有的 Dataview 查询**静默返回空**（不会报错），故给个提醒。
     */
    dataviewAligned?: true;
    /**
     * 适用类型（空 / 缺省 = 全类型）。⚠️ 只登记**代码里真的按类型门控**的字段
     * （如 `album` 只在 `type === 'music'` 时输出）—— 其余字段虽然语义上偏某类型，
     * 但代码不门控，登记成门控会与真源不符。
     */
    types?: readonly EntryType[];
    /**
     * 🔴🔴 #640：**专属类型** —— 这个字段**只属于哪几个类型**（设置页「类型专属属性」那一页据此过滤）。
     * **缺省 / 不放 = 六类通用**（进「全局属性」那一页）。
     *
     * ## ⚠️ 口径纠正（#640f，用户：「什么鬼，不是所有条目不都有这些字段吗，给我好好查啊」）
     * 第一版我把它当成「这个字段**语义上是哪种作品的标志物**」（导演→影视 / ISBN→书籍），
     * 于是「年份 / 题材 / 观看日期 / 计划日期 / 系列」也被算成了某几类专属 —— **那是错的**。
     * 🔴 **唯一正确的判据 = 写出侧 `entryFrontmatter` 会不会按类型门控它**（代码事实）：
     *    · 那里面真正带 `e.type === …` 的只有 —— `album`(music)、`progress_*`(tv/anime)、
     *      `reading_*` / `page_count` / `read_minutes`(book)、`playtime_minutes`(game)；
     *    · **其余一律 `if (e.<field>)`**（零门控）⇒ 电影有条目就有年份、书籍也有出版年、
     *      游戏也有发行年；题材 / 封面 / 又名 / 观看日期 / 计划日期 / 系列 更是六类通吃。
     * ⇒ 所以本字段**只登记「只可能出现在某几个类型」的那些**（导演/ISBN/平台…），
     *   凡是六类都会写的**一律不登记**（= 通用 ⇒ 全局页）。
     *
     * ## 与 `types` 的关系（⛔ 别合并、别互相推导）
     * `types` = 写出侧**门控**（`e.type === …`）；`appliesTo` = **该类型会出现这个字段**。
     * 前者是后者的**子集**（有门控的一定是专属），但反过来不成立：
     * `director` **不门控**（有值就写）却**只属于影视** —— 这就是两者分叉的样本。
     */
    appliesTo?: readonly EntryType[];
    /** 补充说明（设置页；缺省不显示） */
    note?: string;
}

/**
 * 全部字段，顺序 = `entryFrontmatter` 的输出顺序（读到哪一行就登记到哪一行，便于对照）。
 */
export const META_FIELDS: readonly MetaField[] = [
    { key: 'id', label: '条目 ID', kind: 'string', writable: true, readable: false, note: '改名不影响 catalog 同步' },
    { key: 'type', label: '类型', kind: 'enum', writable: true, readable: false, note: '改名不影响 tags 里的类型键' },
    { key: 'title', label: '标题', kind: 'string', writable: true, readable: false, note: '改名不影响笔记文件名' },
    { key: 'status', label: '状态', kind: 'enum', writable: true, readable: true },
    { key: 'rating', label: '个人评分', kind: 'number', writable: true, readable: true, dataviewAligned: true },
    { key: 'tags', label: '标签', kind: 'list', writable: true, readable: false, dataviewAligned: true },
    { key: 'created', label: '创建日期', kind: 'date', writable: true, readable: false, dataviewAligned: true },
    { key: 'updated', label: '更新日期', kind: 'date', writable: true, readable: false, dataviewAligned: true },
    { key: 'banner', label: '封面', kind: 'string', writable: true, readable: true, note: '读侧映射到 poster' },
    // 🔴🔴 #640f **`appliesTo` 口径纠正**（用户：「什么鬼，不是所有条目不都有这些字段吗」）——
    //
    // 上一版我把 `appliesTo` 当成了「这个字段**语义上属于**哪种作品」（导演→影视、ISBN→书籍），
    // 于是「年份」「题材」「观看日期」这些被算成某几类专属。**那是错的**：
    // 写出侧 `entryFrontmatter` 里这些字段**一律是 `if (e.<field>)`（零类型门控）** ——
    // 电影有条目就有年份、书籍也有出版年、游戏也有发行年；题材/封面/又名更是六类通吃。
    // 用户要的口径是「**这个字段会不会出现在该类型的条目里**」，不是「它是不是那种作品的标志物」。
    // ⇒ 因此 `appliesTo` **只登记真正会被某类型独有的字段**（下面那批），其余一律**不放**
    //   （= 六类通用 ⇒ 进「全局」页）。判据以 `noteGenerator.entryFrontmatter` 的**代码事实**为准：
    //   该文件里真正带 `e.type === …` 门控的只有 `album` / `progress_*` / `reading_*` /
    //   `page_count` / `read_minutes` / `playtime_minutes` 这几处。
    { key: 'year', label: '年份', kind: 'number', writable: true, readable: true },
    { key: 'genres', label: '题材', kind: 'list', writable: true, readable: true },
    { key: 'director', label: '导演', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'cast', label: '主演', kind: 'list', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'screenwriter', label: '编剧', kind: 'list', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'country', label: '制片国家', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'language', label: '语言', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'duration_min', label: '片长（分钟）', kind: 'number', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'aliases', label: '又名', kind: 'list', writable: true, readable: true },
    { key: 'author', label: '作者', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    // ⚠️ 现状登记：写侧有、**读侧没有**（`handlers` 缺 artist）⇒ 笔记里手改画师不会被读回。
    //   本批（1.3.1 ①）**不修**（用户只要求做字段映射，改动面越小越好），如实记录在 readable 上。
    { key: 'artist', label: '画师', kind: 'string', writable: true, readable: false, appliesTo: ['book'], note: '读侧尚未解析（既有缺口，非本批引入）' },
    { key: 'translator', label: '译者', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'publisher', label: '出版社', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'producer', label: '出品方', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime', 'game'] },
    { key: 'isbn', label: 'ISBN', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'binding', label: '装帧', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'price', label: '定价', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'series', label: '系列', kind: 'string', writable: true, readable: true },
    { key: 'series_index', label: '系列序号', kind: 'number', writable: true, readable: true },
    { key: 'platform', label: '平台', kind: 'string', writable: true, readable: true, appliesTo: ['game'] },
    { key: 'album', label: '专辑', kind: 'string', writable: true, readable: true, types: ['music'], appliesTo: ['music'] },
    { key: 'developer', label: '开发商', kind: 'string', writable: true, readable: true, appliesTo: ['game'] },
    { key: 'progress_season', label: '季', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    { key: 'progress_episode', label: '集', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    { key: 'progress_total_episodes', label: '总集数', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    { key: 'watched_date', label: '观看日期', kind: 'date', writable: true, readable: true },
    { key: 'planned_date', label: '计划日期', kind: 'date', writable: true, readable: true },
    { key: 'reading_page', label: '已读页数', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'reading_total_page', label: '总页数', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'page_count', label: '页数', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'read_minutes', label: '阅读时长', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'playtime_minutes', label: '游戏时长', kind: 'number', writable: true, readable: true, types: ['game'], appliesTo: ['game'] },
    { key: 'progress_percent', label: '进度百分比', kind: 'number', writable: true, readable: false, appliesTo: ['tv', 'anime', 'book', 'game'], note: '派生值，由进度字段算出' },
];

/** 全部键名（写侧 + 读侧的并集，顺序同上） */
export const META_FIELD_KEYS: readonly string[] = META_FIELDS.map((f) => f.key);

/** 按 key 查字段；未登记返回 `undefined`（调用方自行决定是忽略还是报错） */
export function findMetaField(key: string): MetaField | undefined {
    return META_FIELDS.find((f) => f.key === key);
}

/**
 * 该键是否可映射（#613 起 = **是否登记在本表内**）。
 * ⛔ 未登记的键一律**拒绝** —— 拒绝改名一个不存在的字段，比放行安全：
 *    拼错一个键名会静默写出一堆谁也不认的 frontmatter 键。
 */
export function isMappableKey(key: string): boolean {
    return findMetaField(key) !== undefined;
}

/**
 * 🔴🔴 #640：该字段**语义上适不适用于**这个类型（`appliesTo` 缺省 = 六类通用）。
 *
 * ⚠️ 与 `MetaField.types`（写出侧门控）**是两个问题**，⛔ 别互相推导 —— 见 `appliesTo` 的注释。
 * ⚠️ 未登记的键返回 `true`（保守放行）：本函数用于**过滤设置页列表**，
 *    对一个不认识的键说「不适用」会让它从界面上凭空消失（用户找不到 → 更糟）。
 */
export function fieldAppliesTo(key: string, type: EntryType): boolean {
    const f = findMetaField(key);
    if (!f || !f.appliesTo) return true;
    return f.appliesTo.includes(type);
}
