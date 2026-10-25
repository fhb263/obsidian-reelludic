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
    /**
     * 🔴 2026-10-21（用户「字段字典按表重置」）：**按类型换显示名**。
     *
     * 同一个 frontmatter 键在不同类型下是不同语义，用户表里就写成**不同的字段名**：
     *   · `author` → 书籍「作者」/ 音乐「艺术家」（音乐侧表单的 creator 取的就是 `author`）；
     *   · `developer` → 游戏「开发商」/ 动画「制作公司」（动画正文那行「制作公司」取的就是它）；
     *   · `duration_min` → 电影「片长（分钟）」/ 剧集·动画「单集片长」。
     *
     * ⛔ **不新开同义键**（那会让同一语义两处可填：`year` 与 `release_date` 各写一半），
     *    只换显示名。`label` 仍是缺省名，`labelOf(key, type)` 是唯一读取入口。
     */
    labelFor?: Partial<Record<EntryType, string>>;
    /** 补充说明（设置页；缺省不显示） */
    note?: string;
}

/**
 * 全部字段。
 *
 * 🔴🔴 2026-10-21（用户「字段字典按表重置各媒体类型的属性字段及横向排序」）：
 * **本数组的顺序 = 用户那张表的横向顺序**，分四段：全局 → 影视 → 游戏 → 书籍 → 音乐。
 * 因为 `defaultOrderFor` / `GLOBAL_FIELD_KEYS` / `exclusiveFieldsFor` 全都按**登记序**取序，
 * 所以「排好这一张表」就等于排好了：笔记 frontmatter 写出序、设置页「笔记属性顺序」每一页、
 * 九列对比预览的每一列。⛔ 别在别处再手抄一份顺序（那样两处迟早漂）。
 *
 * ⚠️ 段的先后是**被约束出来的**，不是随手排的：单张登记序要同时当 8 组字段集的**子序列**，
 *    所以 `developer` 必须排在 `cast` 之后、`country` 之前（动画的「制作公司」在大类里紧跟主演），
 *    `progress_percent` 必须排在 `producer` / `playtime_minutes` 之后（剧集与游戏都把它放末尾）。
 *    改编排前先把 `tests/fieldOrder.test.ts` 的「每类型专属集 = 表」用例看一遍。
 *
 * 🔴 用户表里还有 **13 个字段位本仓没有任何数据通道**（⛔ 加进来就是给用户看空行）：
 *    出版年、首发平台、连载状态、字数、已读字数、卷数、上映日期、首播年份、单集片长、
 *    发售日期、发行日期、流派、介质、曲目数 —— 其中「单集片长」已用 `duration_min` 的
 *    按类型显示名顶上；其余 12 个要新增 frontmatter 键 ⇒ 写侧 `noteGenerator` + 读侧
 *    `noteEditable` handlers + `MediaEntry` 字段 + `EntryForm` 输入框 + 单测五处同改，
 *    属第二批（键一旦写进用户笔记就**永久存在**，append-only，⛔ 不许先占坑后补实现）。
 */
export const META_FIELDS: readonly MetaField[] = [
    // ───────────────────────── 全局（六类通用） ─────────────────────────
    { key: 'id', label: '条目 ID', kind: 'string', writable: true, readable: false, note: '改名不影响 catalog 同步' },
    { key: 'type', label: '类型', kind: 'enum', writable: true, readable: false, note: '改名不影响 tags 里的类型键' },
    { key: 'title', label: '标题', kind: 'string', writable: true, readable: false, note: '改名不影响笔记文件名' },
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
    { key: 'series', label: '系列', kind: 'string', writable: true, readable: true },
    { key: 'series_index', label: '系列序号', kind: 'number', writable: true, readable: true },
    { key: 'status', label: '状态', kind: 'enum', writable: true, readable: true },
    { key: 'rating', label: '个人评分', kind: 'number', writable: true, readable: true, dataviewAligned: true },
    { key: 'tags', label: '标签', kind: 'list', writable: true, readable: false, dataviewAligned: true },
    { key: 'aliases', label: '又名', kind: 'list', writable: true, readable: true },
    { key: 'planned_date', label: '计划日期', kind: 'date', writable: true, readable: true },
    // 用户表口径：影视看、书籍读、玩游戏都是同一个「看过/读过/玩过的那天」⇒ 一个键、一个名字。
    { key: 'watched_date', label: '观看/阅读/游玩日期', kind: 'date', writable: true, readable: true },
    { key: 'created', label: '创建日期', kind: 'date', writable: true, readable: false, dataviewAligned: true },
    { key: 'updated', label: '更新日期', kind: 'date', writable: true, readable: false, dataviewAligned: true },

    // ───────────────────── 影视（电影 / 剧集 / 动画） ─────────────────────
    { key: 'director', label: '导演', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'screenwriter', label: '编剧', kind: 'list', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'cast', label: '主演', kind: 'list', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    // 🔴 动画的「制作公司」**复用这个键**：正文里那行 `['制作公司', e.developer]` 取的就是 `developer`
    //    （`noteGenerator.ts` 正文表），⛔ 别为一个显示名新开 `studio` 键 —— 那会让同一部动画
    //    在「开发商」和「制作公司」两处各填一半。
    { key: 'developer', label: '开发商', kind: 'string', writable: true, readable: true, appliesTo: ['game', 'anime'], labelFor: { anime: '制作公司' }, note: '动画侧显示为「制作公司」（与正文那行同源）' },
    { key: 'country', label: '制片国家', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'language', label: '语言', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'] },
    { key: 'progress_season', label: '季', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    { key: 'progress_total_episodes', label: '总集数', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    { key: 'progress_episode', label: '已看集数', kind: 'number', writable: true, readable: true, types: ['tv', 'anime'], appliesTo: ['tv', 'anime'] },
    // 电影是「片长」，剧集/动画是「单集片长」—— 同一个键，按类型换名（见 labelFor 的注释）。
    { key: 'duration_min', label: '片长（分钟）', kind: 'number', writable: true, readable: true, appliesTo: ['movie', 'tv', 'anime'], labelFor: { tv: '单集片长', anime: '单集片长' } },
    // 用户表：电影/剧集/游戏有「出品方」，**动画那一列没有**（动画只有「制作公司」）。
    { key: 'producer', label: '出品方', kind: 'string', writable: true, readable: true, appliesTo: ['movie', 'tv', 'game'] },

    // ───────────────────────────── 游戏 ─────────────────────────────
    { key: 'platform', label: '平台', kind: 'string', writable: true, readable: true, appliesTo: ['game'] },
    { key: 'playtime_minutes', label: '游戏时长', kind: 'number', writable: true, readable: true, types: ['game'], appliesTo: ['game'] },
    // ⚠️ 用户表里游戏有「进度百分比」，但 `noteGenerator.progressPercentOf` **对 game 返回 undefined**
    //    ⇒ 游戏这一格永远空。保留登记（表里有），如实标注，⛔ 别当它已实现。
    { key: 'progress_percent', label: '进度百分比', kind: 'number', writable: true, readable: false, appliesTo: ['tv', 'anime', 'game'], note: '派生值，由进度字段算出；游戏侧目前算不出（progressPercentOf 对 game 返回 undefined）' },

    // ───────────────────────────── 书籍 ─────────────────────────────
    // 用户表口径：书籍的「作者」与音乐的「艺术家」是同一个键（音乐表单的 creator 取 `author`），
    // `artist` 那个键是**画师**（只有漫画有，见 BOOK_KIND_EXCLUDED_FIELDS）。
    { key: 'author', label: '作者', kind: 'string', writable: true, readable: true, appliesTo: ['book', 'music'], labelFor: { music: '艺术家' }, note: '音乐侧显示为「艺术家」（与表单 creator 同源）' },
    // ⚠️ 现状登记：写侧有、**读侧没有**（`handlers` 缺 artist）⇒ 笔记里手改画师不会被读回。
    //   本批（1.3.1 ①）**不修**（用户只要求做字段映射，改动面越小越好），如实记录在 readable 上。
    // 🔴 分类归属（2026-10-19 用户裁定）：`appliesTo: ['book']` 是**大类**口径（book 这条类型
    //    写出侧才认画师），**子类**里只有「漫画」有画师 —— 文学 / 网文没有。
    //    子类差异⛔ 不在这张表表达（改 appliesTo 会把「类型门控」和「子类字段集」搅成一处），
    //    真源是 `pure/fieldOrder.BOOK_KIND_EXCLUDED_FIELDS`。
    { key: 'artist', label: '画师', kind: 'string', writable: true, readable: false, appliesTo: ['book'], note: '读侧尚未解析（既有缺口，非本批引入）' },
    { key: 'translator', label: '译者', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'publisher', label: '出版社', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    // 🔴 分类归属（同上，2026-10-19 裁定）：ISBN 是**已出版实体书**的编号 ⇒ 文学 / 漫画有，
    //    **网文没有**（网络连载走上架年 / 元数据章数那一套）。同样只记大类 `['book']`。
    { key: 'isbn', label: 'ISBN', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'binding', label: '装帧', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'price', label: '定价', kind: 'string', writable: true, readable: true, appliesTo: ['book'] },
    { key: 'reading_total_page', label: '总页数', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'reading_page', label: '已读页数', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    { key: 'read_minutes', label: '阅读时长', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'] },
    // ⚠️ `page_count` 与 `reading_total_page` 不是一回事：前者是**阅读器算出来的**版心页数
    //    （EPUB/TXT 打开后才有），后者是用户填的「这本书一共多少页」。用户表只列「总页数」，
    //    但这一列是真有数据的自有字段 ⇒ 排在书籍段末尾（⛔ 别删，阅读进度条在用）。
    { key: 'page_count', label: '页数（阅读器）', kind: 'number', writable: true, readable: true, types: ['book'], appliesTo: ['book'], note: '阅读器算出的版心页数，与「总页数」不同源' },

    // ───────────────────────────── 音乐 ─────────────────────────────
    { key: 'album', label: '专辑', kind: 'string', writable: true, readable: true, types: ['music'], appliesTo: ['music'] },
];

/** 全部键名（写侧 + 读侧的并集，顺序同上） */
export const META_FIELD_KEYS: readonly string[] = META_FIELDS.map((f) => f.key);

/** 按 key 查字段；未登记返回 `undefined`（调用方自行决定是忽略还是报错） */
export function findMetaField(key: string): MetaField | undefined {
    return META_FIELDS.find((f) => f.key === key);
}

/**
 * 键 → **该类型下**的中文名（`labelFor` 优先，退回 `label`；未登记键原样返回）。
 *
 * 🔴 2026-10-21：`author` / `developer` / `duration_min` 这三个键在不同类型下是**不同字段名**
 * （作者↔艺术家、开发商↔制作公司、片长↔单集片长）。⛔ 显示层别再直接读 `f.label` ——
 *    那样音乐页会显示「作者」、动画页会显示「开发商」、剧集页会显示「片长」。
 * @param type 不给（或该类型没有覆盖名）⇒ 用缺省 `label`
 */
export function labelOf(key: string, type?: EntryType): string {
    const f = findMetaField(key);
    if (!f) return key;
    if (type) {
        const alt = f.labelFor?.[type];
        if (alt) return alt;
    }
    return f.label;
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
