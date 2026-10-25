// 卡片元信息文本（pure/cardMeta）
// 海报墙 grid 卡片同列依赖 subtitle / creator 两行高度一致，
// 数据缺失时返回「—」占位以保持行占位，杜绝同列卡片错位。
import { ENTRY_TYPES, type BookKind, type EntryType, type MediaEntry } from 'data/types';
import { seriesGenres, seriesYearSpan, type SeriesGroup } from 'pure/seriesGroup';

/** 缺失字段占位符：与同列卡片保持行对齐 */
const PLACEHOLDER = '—';

/** 卡片副行（年份 / 专辑·年份槽）：
 *  - 音乐：「专辑 · 年份」（歌手由 creator 行展示，避免双标题）
 *  - 其他：仅年份
 *  - 无值：「—」占位（避免同行卡片错位） */
export function cardSubtitle(e: MediaEntry): string {
    if (e.type === 'music') {
        const parts = [e.album, e.year ? String(e.year) : undefined].filter(
            (x): x is string => !!x,
        );
        return parts.length > 0 ? parts.join(' · ') : PLACEHOLDER;
    }
    return e.year ? String(e.year) : PLACEHOLDER;
}

/** 副行是否为真实内容（用于决定 title tooltip 是否设置，避免显示「—」提示） */
export function hasCardSubtitle(e: MediaEntry): boolean {
    if (e.type === 'music') return !!(e.album || e.year);
    return !!e.year;
}

/**
 * 音频播放器副行（④-4）：「作者 · 专辑 · 年份」，缺项自动跳过（全缺 → 空串 ⇒ 视图不渲染这一行）。
 *
 * ⚠️ 与 `cardSubtitle` **故意不同**：卡片副行只有「专辑 · 年份」（作者由 `cardCreator` 单独占一行），
 *    而播放器标题下只有一行位置 ⇒ 作者并进来。
 * ⛔ 别为「统一」把两者合成一个函数：合并后要么卡片丢掉作者行、要么播放器多出一行。
 */
export function audioSubtitle(e: MediaEntry): string {
    return [e.author, e.album, e.year ? String(e.year) : '']
        .filter((x): x is string => !!x)
        .join(' · ');
}

/** 卡片创作者行（导演 / 作者 / 开发商槽）：
 *  - 优先级：导演 → 作者 → 开发商
 *  - 全无：「—」占位（海报墙防错位核心场景） */
export function cardCreator(e: MediaEntry): string {
    if (e.director) return e.director;
    if (e.author) return e.author;
    if (e.developer) return e.developer;
    return PLACEHOLDER;
}

/** 创作者行是否为真实内容 */
export function hasCardCreator(e: MediaEntry): boolean {
    return !!(e.director || e.author || e.developer);
}

/** 卡片题材行（genres 前 2 个，「 · 」连接）：
 *  - 空 → 「—」占位（与 subtitle/creator 同款占位，行占位恒定防错位） */
export function cardGenres(e: MediaEntry): string {
    return e.genres.length > 0 ? e.genres.slice(0, 2).join(' · ') : PLACEHOLDER;
}

/** 题材行是否为真实内容（用于决定 title tooltip 是否设置，避免显示「—」提示） */
export function hasCardGenres(e: MediaEntry): boolean {
    return e.genres.length > 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1.3.1 ①：海报墙卡片「显示哪些属性」（高级设置 › 海报墙卡片）
//
// 用户口径：
//   · 参考 DataCards「高度可定制，决定每张卡片上显示哪些属性」；
//   · **#615 扩展**：「信息栏也可**自由选择字段**展示，**可选至多 5 条**」
//     ⇒ 由 #612 的「3 个固定开关」升级为「从一个字段池里自由挑，上限 5 条」。
//
// 🔴 两条口径别记错：
//   ⑴ **只做「显不显示」，不做排序** —— 行的先后恒由 `CARD_FIELD_OPTIONS` 的顺序决定，
//      设置页落盘时按这个顺序重排（⛔ 不让「点开关的先后」决定渲染顺序）。
//   ⑵ **上限 5** 是产品约束（卡片下方放 6 行以上会把海报墙撑得很难看），
//      在 `normalizeCardFields` 里**硬截断**（防手改 data.json 超限），设置页再配「到上限就置灰」。
// ══════════════════════════════════════════════════════════════════════════════

/** 三个**影视**类型（`制片国家` / `语言` / `片长` 只适用它们） */
const FILM_TYPES: readonly EntryType[] = ['movie', 'tv', 'anime'];

/**
 * 卡片可显示的字段（顺序 = 池子顺序 = 设置页 chip 顺序 = 渲染顺序；⛔ 别插队）。
 *
 * 🔴 `types` = **该字段适用的条目类型**（#617 追加件）：设置页的候选池按**当前类型**过滤
 *    （`cardFieldOptionsFor`），归一也据此丢掉「这类型用不到」的字段。
 *    用户原话：「5 个类型的字段选择怎么都是一样名称的」—— 一部电影的信息栏里列出「译者」本就说不通。
 * ⚠️ 池子是**精选**的（不是 `META_FIELDS` 全量 42 个）：`id` / `type` / `tags` / `banner` /
 *    `progress_*` 这类字段放在海报墙卡片上没有展示意义，列进去只会误导用户去选。
 * ⚠️ `year` / `creator` / `genres` / `series` / `aliases` **六类通用**：
 *    `creator` 是个**聚合槽**（导演 → 作者 → 开发商，按 `cardCreator` 的优先级取），
 *    所以书籍 / 游戏不必再单独放开它 —— 它自己会落到该类型该显的那个人。
 */
export const CARD_FIELD_OPTIONS = [
    { key: 'year', label: '年份', desc: '音乐显示「专辑 · 年份」', types: ENTRY_TYPES },
    { key: 'creator', label: '创作者', desc: '导演 / 作者 / 开发商', types: ENTRY_TYPES },
    // 🔴 #617 追加件：书籍组排在「题材」**之前** —— 归一按**池子顺序**重排，所以池子顺序 = 该类型
    //    最终的行序。排在这里，书籍的预填「年份 / 作者 / 题材」才能原样导出成行序。
    //    ⚠️ 对影视无影响（它们的池子里没有书籍字段 ⇒ 仍是「年份 / 创作者 / 题材」）。
    { key: 'author', label: '作者', desc: '书籍字段', types: ['book'] },
    { key: 'artist', label: '画师', desc: '漫画的作画者', types: ['book'] },
    { key: 'translator', label: '译者', desc: '书籍字段', types: ['book'] },
    { key: 'publisher', label: '出版社', desc: '书籍字段', types: ['book'] },
    { key: 'producer', label: '出品方', desc: '书籍字段', types: ['book'] },
    { key: 'genres', label: '题材', desc: '最多取前 2 个', types: ENTRY_TYPES },
    { key: 'country', label: '制片国家', desc: '影视条目常见', types: FILM_TYPES },
    { key: 'language', label: '语言', desc: '影视条目常见', types: FILM_TYPES },
    { key: 'duration', label: '片长', desc: '以分钟显示', types: FILM_TYPES },
    // 同理：`developer` 排在 `platform` 之前，游戏的预填「年份 / 开发商 / 平台」才能原样成行
    { key: 'developer', label: '开发商', desc: '游戏字段', types: ['game'] },
    { key: 'platform', label: '平台', desc: '游戏字段', types: ['game'] },
    { key: 'album', label: '专辑', desc: '音乐字段', types: ['music'] },
    { key: 'series', label: '系列', desc: '全部类型通用', types: ENTRY_TYPES },
    { key: 'aliases', label: '又名', desc: '最多取前 2 个', types: ENTRY_TYPES },
] as const;

export type CardFieldKey = (typeof CARD_FIELD_OPTIONS)[number]['key'];

/** 池子里的一项（`types` 见上方说明） */
export type CardFieldOption = (typeof CARD_FIELD_OPTIONS)[number];

/** 卡片信息栏的**行数上限**（用户点名「可选至多 5 条」） */
export const CARD_FIELD_LIMIT = 5;

/**
 * 取某类型**可用的候选字段**（顺序 = 池子顺序；设置页 chip 与归一的过滤点都走这里，
 * ⛔ 别在设置页另写一份过滤）。
 */
export function cardFieldOptionsFor(type: EntryType): CardFieldOption[] {
    return CARD_FIELD_OPTIONS.filter((o) => (o.types as readonly EntryType[]).includes(type));
}

/**
 * 各类型的**预填**（#617 追加件，用户裁定「让位给按类型预填」）。
 *
 * 🔴 语义：**没配过该类型时**信息栏显示哪几行。刻意**按类型给**（不再六类共用一组）——
 *    用户原话：「原来五个类型条目的怎么不预填上去」。
 * ⚠️ 影视三条保持 `年份 / 创作者 / 题材` ⇒ 与 1.3.1 之前的观感**逐像素一致**（存量用户零感知）；
 *    另外三类换成**像那个类型**的字段（书籍给作者、游戏给开发商 / 平台、音乐给专辑）。
 */
export const CARD_FIELD_DEFAULTS_BY_TYPE: Record<EntryType, readonly CardFieldKey[]> = {
    movie: ['year', 'creator', 'genres'],
    tv: ['year', 'creator', 'genres'],
    anime: ['year', 'creator', 'genres'],
    book: ['year', 'author', 'genres'],
    game: ['year', 'developer', 'platform'],
    music: ['year', 'creator', 'album'],
};

/** 缺省的「按类型」配置（六键齐全，每键是**该类型预填**的拷贝，⛔ 别共用同一个数组） */
export const DEFAULT_CARD_FIELDS_BY_TYPE: Record<EntryType, CardFieldKey[]> = (() => {
    const out = {} as Record<EntryType, CardFieldKey[]>;
    for (const t of ENTRY_TYPES) out[t] = [...CARD_FIELD_DEFAULTS_BY_TYPE[t]];
    return out;
})();

/**
 * 归一化**某类型**的设置值：丢掉不认识的键、丢掉**该类型用不到**的字段，
 * **保留用户拖出来的先后顺序**，并**截断到 `CARD_FIELD_LIMIT`**。
 *
 * 🔴 为什么必须按类型过滤：过滤只发生在「设置页候选池」是不够的 —— 手改 `data.json`、
 *    或者**跨类型复用了同一份值**，都会让「平台」这种字段落到电影上。那种字段在设置页**看不见**
 *    （不在候选池里）却在卡片上**照样渲染** ⇒ 「看不见但生效」是最难排查的一类状态。
 * ⚠️ 判据是 `Array.isArray` **而非**假值判断：非数组（没配过）⇒ 用**该类型自己的预填**
 *    （`CARD_FIELD_DEFAULTS_BY_TYPE`，不再是六类共用一组）；而 `[]`（刻意全关）是**合法值**，
 *    与「没配过」必须分开 —— 写 `!v` 会把这个状态踩掉。
 * 🔴 本函数是**唯一**的归一入口（#617 追加件：无类型的那个同名函数已删 ——
 *    所有调用场景都带类型，留一份「不知道类型」的版本就是死代码，esbuild 摇树时也验证了这点）。
 *
 * 🔴🔴 **#640（1.4.0）翻面：不再「按池子顺序重排」，改为保留用户顺序**。
 *    原先这一行是 `pool.filter(o => picked.has(o.key))` —— 那等于**每次读都把用户拖出来的顺序
 *    按池子默认序重排回去**。在 #640 之前这是无害的（数组顺序本就只由点选产生，没有用户序），
 *    但 #640 给已选标签加了**拖拽排序并持久化** ⇒ 再按池子重排会让「拖完存下来、重开就还原」，
 *    表现为**拖拽功能整个失效且无任何报错**（正是本仓最忌讳的「静默无效」）。
 *    ⇒ 改成：**先按用户数组的先后取**（用 `pool` 的键集做合法性判定，过滤掉不适用该类型的），
 *      丢掉重复项，最后截断到上限。池子顺序从此只用于「没配过时的预填」。
 *    ⚠️ 过滤点仍**只有这一个**（`allowed`）：⛔ 别再加第二道过滤做同一件事 ——
 *      两道过滤时突变只能咬住一道，另一道被改坏也不会红（#617 实测踩过：M33 一开始就是 GREEN）。
 */
export function normalizeCardFieldsForType(type: EntryType, v: unknown): CardFieldKey[] {
    const pool = cardFieldOptionsFor(type);
    const raw: unknown[] = Array.isArray(v) ? v : [...CARD_FIELD_DEFAULTS_BY_TYPE[type]];
    // `allowed` 只用来判「这个键适不适用于本类型」，⛔ 不参与排序
    const allowed = new Set<string>(pool.map((o) => o.key));
    const out: CardFieldKey[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
        if (typeof x !== 'string' || !allowed.has(x) || seen.has(x)) continue;
        seen.add(x);
        out.push(x as CardFieldKey);
    }
    return out.length > CARD_FIELD_LIMIT ? out.slice(0, CARD_FIELD_LIMIT) : out;
}

/**
 * 把设置里那份「按类型」的原始值解析成**六键齐全**的映射（缺哪一类都不留 `undefined`）。
 *
 * 🔴 只读新键；缺哪一类 ⇒ 用**该类型自己的预填**（`CARD_FIELD_DEFAULTS_BY_TYPE`）。
 *    ⚠️ **老键 `cardFields` 自 #617 追加件起不再参与**（用户裁定「让位给按类型预填」：
 *    它一视同仁地对六类生效，正是「五个类型看起来一样」的根源）。键本身**保留**只为不丢数据。
 * ⚠️ 空数组是「用户刻意全关」的**合法值**，与「没配过」必须分开 —— 所以判据是 `=== undefined`
 *    而不是假值判断（`[]` 是 truthy，但写 `!v` 的那种写法会踩空）。
 */
export function resolveCardFieldsByType(byType: unknown): Record<EntryType, CardFieldKey[]> {
    const src = byType && typeof byType === 'object' ? (byType as Record<string, unknown>) : {};
    const out = {} as Record<EntryType, CardFieldKey[]>;
    for (const t of ENTRY_TYPES) {
        const v = src[t];
        out[t] = v === undefined ? [...CARD_FIELD_DEFAULTS_BY_TYPE[t]] : normalizeCardFieldsForType(t, v);
    }
    return out;
}

/**
 * 🔴🔴 #653：**书籍按子分类**（文学 / 网文 / 漫画）各自的卡片信息栏。
 *
 * 用户点名的类型顺序把「书籍」拆成了三格 ⇒ 三格各存一份：`settings.cardFieldsByKind[kind]`。
 * 🔴 **零迁移的回落链**：`cardFieldsByKind[kind]` → **`cardFieldsByType.book`** → 书籍预填。
 *    中间那一跳是保命的 —— 老用户只配过「书籍」那一份，三个子类必须一起继承它，
 *    ⛔ 而不是各自回到预填（否则升级后用户配好的书籍信息栏在网文卡片上会「消失」）。
 *    （与 `pure/fieldOrder.orderForBookKind` 同一条口径。）
 * ⚠️ 三键齐全，⛔ 不留 `undefined`：调用方一律按 `kind` 直接取，不必再判空。
 */
export function resolveCardFieldsByKind(byType: unknown, byKind: unknown): Record<BookKind, CardFieldKey[]> {
    const base = resolveCardFieldsByType(byType);
    const src = byKind && typeof byKind === 'object' ? (byKind as Record<string, unknown>) : {};
    return {
        book: src.book === undefined ? base.book : normalizeCardFieldsForType('book', src.book),
        novel: src.novel === undefined ? base.book : normalizeCardFieldsForType('book', src.novel),
        comic: src.comic === undefined ? base.book : normalizeCardFieldsForType('book', src.comic),
    };
}

/**
 * 某条条目（或某张系列卡）该用哪一份卡片信息栏 —— **唯一取值出口**。
 * 🔴 书籍看 `bookKind`（缺省按「文学」，与 `pure/bookKind` 的缺省口径一致），其余按 `type`。
 */
export function cardFieldsFor(
    type: EntryType,
    kind: BookKind | undefined,
    byType: Record<EntryType, CardFieldKey[]>,
    byKind: Record<BookKind, CardFieldKey[]>,
): CardFieldKey[] {
    if (type === 'book') return byKind[kind === 'novel' || kind === 'comic' ? kind : 'book'] ?? byType.book;
    return byType[type] ?? [];
}

// ══════════════════════════════════════════════════════════════════════════════
// #617：按**条目类型**各配一套信息栏（六套）
//
// 用户口径：「为不同类型条目卡片海报墙信息栏都加个（配置）」⇒ 把 #616 的「一份全局配置」拆成
//   **六个类型各一份**（电影 / 剧集 / 动画 / 书籍 / 游戏 / 音乐）。
// 为什么应该按类型拆：16 个候选字段里大半是**类型专属**的（译者 / 出版社 / 出品方 → 书籍，
//   平台 / 开发商 → 游戏，专辑 → 音乐）—— 一部电影的信息栏里摆一行「译者」本就说不通。
//
// 🔴 **迁移口径：零写入**。新键 `cardFieldsByType` 缺省不存在 ⇒ 六类**一律回落到老键
//    `cardFields`**（存量用户升上来观感零变化）。用户只在**动了某个类型**时才写那一个键，
//    其余五类继续走回落 —— 所以「改一个类型」不会把另外五个类型冻结成当时的值。
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 演示条目的**共用字段**（每份都**填满** 16 个候选字段 —— 见下方守卫说明）。
 * ⚠️ 只有 `type` / `title` / `id` 按类型区分，字段值本身刻意共用：
 *    「点哪个字段都能立刻看到它长什么样」这条承诺（#616）要求**每个候选字段都有值**，
 *    所以不能只填「该类型常有的那几个」。
 */
function previewEntry(type: EntryType, title: string): MediaEntry {
    return {
        id: `__card_preview_${type}__`,
        type,
        title,
        status: 'want',
        rating: 0,
        // 通用
        year: 2024,
        genres: ['科幻', '灾难'],
        country: '中国大陆',
        language: '汉语普通话',
        durationMin: 125,
        aliases: ['示例别名 A', '示例别名 B'],
        // 类型专属字段也一律给值（值本身不重要，**有值**才重要）
        director: '导演示例',
        author: '作者示例',
        artist: '画师示例',
        translator: '译者示例',
        publisher: '出版社示例',
        producer: '出品方示例',
        platform: 'PC',
        developer: '开发商示例',
        album: '专辑示例',
        series: '系列示例',
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
    };
}

/**
 * 设置页预览卡的演示条目，**每个类型一份**（#617 起；#616 只有单独一份电影）。
 * 🔴 **每份的 16 个候选字段必须全部有值** —— 这是「点哪个字段都能立刻看到它长什么样」这个
 *    承诺的实现基础，`tests/cardMeta.test.ts` 有一条守卫**逐份逐键**钉住
 *    （⛔ 删任何一个值，对应的 chip 就变成哑的，而界面上看不出来）。
 * ⚠️ 文案**刻意中性**（「示例电影」+ 各字段的典型样例），⛔ 别蹭真实作品名。
 * 💡 类型差异体现在**取值形态**上（如音乐那行是「专辑 · 年份」），这正是切类型预览的意义。
 */
export const CARD_PREVIEW_ENTRIES: Record<EntryType, MediaEntry> = {
    movie: previewEntry('movie', '示例电影'),
    tv: previewEntry('tv', '示例剧集'),
    anime: previewEntry('anime', '示例动画'),
    book: previewEntry('book', '示例书籍'),
    game: previewEntry('game', '示例游戏'),
    music: previewEntry('music', '示例音乐'),
};

/**
 * 取某字段在卡片上要显示的**一行文本**。
 * 🔴 缺值一律返回「—」占位（与 `cardSubtitle` / `cardCreator` / `cardGenres` 同款）——
 *    同列卡片行数恒定靠的就是「行在、值可能是占位符」，⛔ 不是「没值就整行消失」。
 */
export function cardFieldValue(e: MediaEntry, key: CardFieldKey): string {
    switch (key) {
        case 'year':
            return cardSubtitle(e);
        case 'creator':
            return cardCreator(e);
        case 'genres':
            return cardGenres(e);
        case 'country':
            return e.country || PLACEHOLDER;
        case 'language':
            return e.language || PLACEHOLDER;
        case 'duration':
            return e.durationMin ? `${e.durationMin} 分钟` : PLACEHOLDER;
        case 'author':
            return e.author || PLACEHOLDER;
        case 'artist':
            return e.artist || PLACEHOLDER;
        case 'translator':
            return e.translator || PLACEHOLDER;
        case 'publisher':
            return e.publisher || PLACEHOLDER;
        case 'producer':
            return e.producer || PLACEHOLDER;
        case 'platform':
            return e.platform || PLACEHOLDER;
        case 'developer':
            return e.developer || PLACEHOLDER;
        case 'album':
            return e.album || PLACEHOLDER;
        case 'series':
            return e.series || PLACEHOLDER;
        case 'aliases':
            return e.aliases?.length ? e.aliases.slice(0, 2).join(' / ') : PLACEHOLDER;
        default:
            return PLACEHOLDER;
    }
}

/**
 * 折叠卡（系列卡）在某个**卡片字段**上显示的那一行文本 —— 与 `cardFieldValue` **逐档对应**。
 *
 * 🔴🔴 它存在的理由：折叠卡的元信息行**必须与普通卡同源、同数**。
 *    同一面墙上两种卡混排，行数一旦不一致 ⇒ **卡片高度不一致** ⇒ 矮的那些被网格拉高、
 *    正文下面留一大块空白（用户 2026-10-13 报障：「系列卡不一致，视图里也空了一大块」）。
 *    ⛔ 所以不许再像 #434 时期那样写死「年份段 / N 部 / 题材」三行 ——
 *    那套是从「信息栏是一份全局固定配置」的年代留下来的，**#617 把信息栏改成「按类型各配一份」之后就彻底对不上了**：
 *    普通卡跟着设置走（0~5 行），折叠卡却恒 3 行，两边永远差着数。
 *
 * 🔴 取值口径：
 *    · 能真聚合的用**组级聚合** —— 年份 → 跨度（`seriesYearSpan`）、题材 → 并集（`seriesGenres`）；
 *    · 其余字段取**组内首条**的值。同一系列的这些属性本就共享（译者 / 出版社 / 平台 / 开发商 / 专辑…），
 *      「取哪一条都一样」胜过「恒显示一个破折号」；
 *    · 缺值仍走 `cardFieldValue` 的 `—` 占位，⛔ **绝不返回空串** ——
 *      空串会让那一行塌成 0 高，行数就又对不上了（有单测逐个候选字段钉住这条）。
 *
 * ⚠️ 「N 部」那行**不再占信息栏位置**：部数由封面右上角的 `×N` 角标表达（同一件事不说两遍）。
 */
export function seriesCardFieldValue(g: SeriesGroup, key: CardFieldKey): string {
    if (g.items.length === 0) return PLACEHOLDER;
    switch (key) {
        case 'year':
            return seriesYearSpan(g.items);
        case 'genres':
            return seriesGenres(g.items);
        default:
            return cardFieldValue(g.items[0], key);
    }
}