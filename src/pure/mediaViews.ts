// 分类视图（views）：把「物本位」的物理库切成用户自己定义的分类维度（事本位）。
//
// 🔴 用户 2026-11-23 裁定（四条，⛔ 别改口径）：
//   ⑴ **视图定义存进媒体库 Catalog**（跟库走：换设备 / 同步后分类结构一致）；
//   ⑵ 首页在**现有分类胶囊栏上方**加一条视图切换 ——「默认视图」= 现在这套胶囊栏原样不动；
//   ⑶ **「合集视图」是新建的一种视图类型**：先出 IP 卡片，点进去才展开子系列行
//      （带 border-left 引导线 + 旋转箭头）—— ⛔ **不复用 `seriesGroup` 的折叠**：
//      那是「平铺里把 ≥2 条的系列折成一张卡」，不是「先按 IP 聚合、再进一层」；
//   ⑷ 自定义视图**只按标签筛**（条目 `tags` 命中即属于该视图）。
//
// ⚠️ 物理目录结构一律不动：视图只是**同一份 entries 上的过滤器**，不搬文件、不改 schema 主键。
// ⚠️ 「合集视图」的 IP 就是 `series`（用户心里的「熊出没」= 一个 series 名），
//    ⛔ 别自作主张用 genres / 标题前缀猜 IP。
import { ENTRY_TYPE_LABELS, ENTRY_TYPES, type BookKind, type EntryType, type MediaEntry } from 'data/types';
import { BOOK_KIND_LABELS, BOOK_KINDS, normalizeBookKind } from 'pure/bookKind';
import { normalizeSeriesName, sortSeriesItems } from 'pure/seriesGroup';

/**
 * 视图「类型选择」的**唯一真源**（设置页与任何类型选择器都从这里取，⛔ 别手抄）。
 *
 * 🔴 2026-11-26（m05012）用户点名：「高级设置的选择类型扩充到九类」并逐字列出
 *    「文学网文漫画动画剧集电影游戏音乐」—— 注意这**不是**九个 `EntryType`：
 *    文学/网文/漫画是书籍的**子分类**（`BookKind`），其余五个才是主类型。
 *    ⇒ 选择器以这份「八项」为单位，选出的结果再拆成 `types` + `bookKinds` 两维落库
 *      （见 `viewSelectionOf` / `viewSelectionPatch`）。⛔ 别为此去扩 `ENTRY_TYPES`：
 *      那是 schema 主类型的真源，动了会连带目录名 / 识别色 / 量词一串映射表。
 */
export interface ViewTypeChoice {
    /** 稳定键（设置页 `aria-pressed` 与勾选态判据；`book:*` 三项必须带前缀，⛔ 别用裸 bookKind 值） */
    key: string;
    /** 界面显示名 */
    label: string;
    /** 这一项归到哪个主类型 */
    type: EntryType;
    /** 仅书籍三项有：对应子分类。其余缺省 */
    bookKind?: BookKind;
}

/** 类型选择器的八项（顺序 = 用户点名顺序，⛔ 别改成字母序 / ENTRY_TYPES 序） */
export const VIEW_TYPE_CHOICES: readonly ViewTypeChoice[] = [
    { key: 'book:book', label: BOOK_KIND_LABELS.book, type: 'book', bookKind: 'book' },
    { key: 'book:novel', label: BOOK_KIND_LABELS.novel, type: 'book', bookKind: 'novel' },
    { key: 'book:comic', label: BOOK_KIND_LABELS.comic, type: 'book', bookKind: 'comic' },
    { key: 'anime', label: ENTRY_TYPE_LABELS.anime, type: 'anime' },
    { key: 'tv', label: ENTRY_TYPE_LABELS.tv, type: 'tv' },
    { key: 'movie', label: ENTRY_TYPE_LABELS.movie, type: 'movie' },
    { key: 'game', label: ENTRY_TYPE_LABELS.game, type: 'game' },
    { key: 'music', label: ENTRY_TYPE_LABELS.music, type: 'music' },
];

/**
 * 把一条视图的 `types` + `bookKinds` 翻译成选择器上的**勾选键**。
 *
 * 规则（⚠️ 这条是让「老数据不丢」的关键）：
 *   · `book` 主类型在 `types` 里、但 `bookKinds` 为空 ⇒ 视为**三个子分类全勾**
 *     （老视图只知道「书籍」，不能因为新维度上线就把它悄悄缩成「只有文学」）；
 *   · `book` 不在 `types` 里 ⇒ 三个子分类键都不勾。
 */
export function viewSelectionOf(view: MediaView | null | undefined): string[] {
    if (!view) return [];
    const out: string[] = [];
    const bookOn = view.types.includes('book');
    const kinds = view.bookKinds ?? [];
    for (const c of VIEW_TYPE_CHOICES) {
        if (c.type === 'book') {
            if (!bookOn) continue;
            if (kinds.length === 0 || (c.bookKind && kinds.includes(c.bookKind))) out.push(c.key);
            continue;
        }
        if (view.types.includes(c.type)) out.push(c.key);
    }
    return out;
}

/**
 * 勾选键集合 ⇒ 落库补丁 `{ types, bookKinds }`（两维**必须一起算**，⛔ 别分别提交）。
 *
 * 🔴 拆维规则（与 `viewSelectionOf` 互为逆运算）：
 *   · 任选一个 `book:*` ⇒ `types` 含 `book`；`bookKinds` 记选中的那几项；
 *   · 三个 `book:*` 全选 ⇒ `bookKinds` 存**空**（= 不限子分类，这样将来新增子分类也自动收录）；
 *   · 一个 `book:*` 都没选 ⇒ `types` 不含 `book`、`bookKinds` 清空。
 * ⚠️ 结果仍过 `normalizeViewTypes` / `normalizeViewBookKinds`，非法键自然被丢掉。
 */
export function viewSelectionPatch(keys: readonly string[]): { types: EntryType[]; bookKinds: BookKind[] } {
    const set = new Set(keys);
    const types: EntryType[] = [];
    const bookKinds: BookKind[] = [];
    for (const c of VIEW_TYPE_CHOICES) {
        if (!set.has(c.key)) continue;
        if (!types.includes(c.type)) types.push(c.type);
        if (c.type === 'book' && c.bookKind) bookKinds.push(c.bookKind);
    }
    const bookAll = bookKinds.length === BOOK_KINDS.length;
    return {
        types: normalizeViewTypes(types),
        bookKinds: types.includes('book') && !bookAll ? normalizeViewBookKinds(bookKinds) : [],
    };
}


/** 视图种类：默认（物本位）/ 合集（IP 聚合）/ 自定义（事本位，标签筛） */
export type MediaViewKind = 'default' | 'collection' | 'custom';

/** 视图种类显示名（**单一真源**，设置页与首页切换条共用 —— ⛔ 别在组件里手抄） */
export const VIEW_KIND_LABELS: Record<MediaViewKind, string> = {
    default: '默认视图',
    collection: '合集视图',
    custom: '自定义视图',
};

/** 视图种类的下拉/说明文案（设置页「新建视图」用） */
export const VIEW_KIND_HINTS: Record<MediaViewKind, string> = {
    default: '整个媒体库，按媒体类型分栏（不可删除、不可改名）',
    collection: '先按 IP（系列名）出合集卡，点开才展开电影 / 动画 / 游戏等子系列',
    custom: '只显示带指定标签的条目（事本位：工作 / 日常 这类场景）',
};

/**
 * 每种视图**在设置页那行下面**的一句说明（单一真源 —— ⛔ 别在 Settings 里手抄）。
 *
 * 🔴 2026-11-25 用户逐字给的模板就长这样：
 *    「（可勾选隐藏）**默认视图** `[系统内置]`
 *      物理归档库，收录所有媒体笔记。
 *      （可勾选隐藏）**合集视图** `[系统内置]`
 *      按系列/IP 聚合你的媒体。」
 *    ⇒ 前两句是用户的原话，⛔ 别改写（改了就是「我比用户懂」）。`custom` 那条用户没给，
 *      沿用 `VIEW_KIND_HINTS.custom` 的口径压成一句陈述句。
 */
export const VIEW_KIND_DESCS: Record<MediaViewKind, string> = {
    default: '物理归档库，收录所有媒体笔记。',
    collection: '按系列/IP 聚合你的媒体。',
    custom: '只显示带指定标签的条目。',
};

/** 默认视图固定 id —— 🔴 它是**物理库本身**，不是逻辑分组：⛔ 不可删、不可改名、不可换种类 */
export const DEFAULT_VIEW_ID = 'default';

/** 默认视图显示名（用户原话「默认视图」） */
export const DEFAULT_VIEW_NAME = '默认视图';

/**
 * 内置合集视图的固定 id。
 *
 * 🔴 2026-11-24 用户报障「后默认视图没合集视图啊」⇒ 合集视图不再是「用户自己建才有」的可选挡位，
 *    而是和默认视图一样**出厂就在**的第二颗胶囊。
 * ⚠️ id 刻意避开 `v_` 前缀（`nextViewId` 的产物形态），用户自建的视图永远不会撞上它。
 */
export const COLLECTION_VIEW_ID = 'collection';

/** 内置合集视图显示名（用户原话「合集视图」） */
export const COLLECTION_VIEW_NAME = '合集视图';

/** 判断一条视图是不是**构造出来的内置视图**（默认 / 合集）——内置的不进 JSON、不可删改 */
export function isBuiltinView(view: MediaView | null | undefined): boolean {
    if (!view) return false;
    return view.id === DEFAULT_VIEW_ID || view.id === COLLECTION_VIEW_ID;
}

/** 视图条数上限（防「视图切换条」被撑成第二排页签；超出的在设置页裁掉最旧） */
export const MAX_VIEWS = 20;

/** 一个分类视图 */
export interface MediaView {
    id: string;
    name: string;
    kind: MediaViewKind;
    /**
     * 二级分类（**该视图显示哪几种媒体类型**）；空数组 / 缺省 = 全部类型。
     * 🔴 用户原话「里面可以随便加二级分类，比如只放电影 / 动画 / 文学」—— 这就是它。
     */
    types: EntryType[];
    /**
     * 书籍**子分类**白名单（只对 `types` 含 `book` 的视图有意义）。
     *
     * 🔴 2026-11-26（m05012）用户逐字：「用户自定义视图可选择现有的文学网文漫画动画剧集电影游戏音乐可选展示」
     *    ⇒ 文学 / 网文 / 漫画 是 `book` 的子分类，不是主类型，因此单独占一维。
     * ⚠️ **空数组 / 缺省 = 不限子分类**（三种书籍全收），这既是老视图的语义，
     *    也是「三项全勾」的落库形态（见 `viewSelectionPatch`）；⛔ 别把空数组当「什么都不收」。
     */
    bookKinds?: BookKind[];
    /**
     * 自定义视图的标签白名单（条目 `tags` 命中**任一**即属于该视图）。
     * ⚠️ 空数组 = **什么都不匹配**（⛔ 不是「全部」）：用户还没配标签时列表空着，
     *    自己就能看出「没配」，比静默显示整个库更像可配置的结构。
     */
    tags: string[];
    /** 图标（Lucide id，如 'package' / 'briefcase'）；缺省由 `viewIconOf` 兜底 */
    icon?: string;
    /**
     * 首页切换条上**隐藏**这一颗胶囊（设置页勾选框控制）。
     *
     * 🔴 2026-11-25 用户逐字：「（可勾选隐藏）**默认视图** `[系统内置]`…」
     *    ⇒ 「隐藏」与「删除」是两件事：内置视图（默认 / 合集）**不许删**（删了就没有
     *      「整个库」这一档了，那是产品底线），但**允许隐藏**（有人只想看自己那几个视图）。
     *    ⚠️ 藏在用户自建视图上也允许 —— 藏了随时能勾回来，比逼他删了再重建更轻。
     *    ⛔ 隐藏只影响**切换条渲染**，不影响数据：条目该进哪个视图还是进哪个视图。
     */
    hidden?: boolean;
}

/**
 * 🔴 内置视图的**出厂缺省可见性**：默认视图可见、合集视图隐藏。
 *
 * 2026-11-14 用户逐字：「高级设置-分类视图，用户初始**仅勾选默认视图**，不再勾选合集视图；
 *   首页**只在勾选 ≥2 个视图时才显示**默认视图切换下拉框」。
 * ⇒ 出厂态 = 只有默认视图一颗胶囊 ⇒ `visibleViews()` 长度 1 ⇒
 *   `ViewChips.svelte` 的 `{#if views.length > 1}` 自然退化成静态名字（下拉框不出现），
 *   **不需要改任何 .svelte**。用户去设置页勾上合集视图（或建自定义视图）后长度 > 1 ⇒ 下拉框出现。
 *
 * ⚠️ 这张表是「出厂态」，⛔ 不是「当前态」：当前态看 `view.hidden`。
 * ⛔ 别把合集视图从 `normalizeViews` 里删掉 —— 它仍然恒存在，只是出厂不勾选。
 */
const BUILTIN_VIEW_HIDDEN_BY_DEFAULT: Record<string, boolean> = {
    [DEFAULT_VIEW_ID]: false,
    [COLLECTION_VIEW_ID]: true,
};

/**
 * 这条内置视图**出厂**是否隐藏（默认视图 false / 合集视图 true / 非内置 false）。
 * 唯一用途：`viewsForStorage` 判断「用户是否改过可见性」，改过才值得落盘。
 */
export function builtinViewHiddenByDefault(view: MediaView | null | undefined): boolean {
    if (!view) return false;
    return BUILTIN_VIEW_HIDDEN_BY_DEFAULT[view.id] === true;
}

/**
 * 判断一条视图当前是否在首页切换条上可见。
 *
 * ⚠️ 缺省（`undefined`）视为**可见** —— 用户自建视图 / 老 catalog 里没有这个字段，不能凭空把它们全藏了。
 *    （内置视图的出厂隐藏不是靠「缺省」实现的，而是 `normalizeViews` 显式写 `hidden: true`，见那张出厂表。）
 * ⚠️ 显式 `false` **也是可见**（用户把出厂隐藏的合集视图勾回来，内存对象上带着 `hidden: false`）。
 */
export function viewIsVisible(view: MediaView | null | undefined): boolean {
    if (!view) return false;
    return view.hidden !== true;
}

/**
 * 首页切换条要吃的那几条（可见的那些）。
 *
 * 🔴 这里是**唯一**的「哪些视图上首页」判断：组件里 ⛔ 不许自己写 `views.filter(...)`，
 *    否则「隐藏」就会在首页和别处表现不一致（本仓踩过标签/排序口径漂移的坑）。
 * ⚠️ 全被藏起来时返回空数组 ⇒ 首页那条切换栏整个不渲染（`views.length > 0` 自动为假），
 *    但仍可以从设置页勾回来，⛔ 别在这里塞「至少留一条」的兜底。
 */
export function visibleViews(views: readonly MediaView[]): MediaView[] {
    return views.filter((v) => viewIsVisible(v));
}

function isEntryType(v: unknown): v is EntryType {
    return typeof v === 'string' && (ENTRY_TYPES as readonly string[]).includes(v);
}

/**
 * 标签归一：trim → 丢空 → 按**小写**去重（保留首次出现的写法）。
 *
 * 🔴 为什么小写比较：同一个标签用户十有八九会打成 `工作` / `工作 `（尾空格）、`Work` / `work`；
 *    标签是筛选取值而不是主键，宽容归一比让视图莫名漏条目更合理。
 * ⚠️ 只做「比较归一」：写回 catalog 的仍是用户打的原文，⛔ 不静默改用户数据。
 */
export function normalizeViewTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
        if (typeof v !== 'string') continue;
        const t = v.trim();
        if (!t) continue;
        const k = t.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
    }
    return out;
}

/** 二级分类归一：只接受合法 EntryType，去重后**按 ENTRY_TYPES 的固定顺序**排（⛔ 不按用户点选顺序） */
export function normalizeViewTypes(raw: unknown): EntryType[] {
    if (!Array.isArray(raw)) return [];
    const set = new Set(raw.filter(isEntryType));
    return ENTRY_TYPES.filter((t) => set.has(t));
}

/**
 * 书籍子分类归一（视图的 `bookKinds` 维度）：只接受合法 `BookKind`，
 * 去重后按 `BOOK_KINDS` 固定序排（与 `normalizeViewTypes` 同一套纪律）。
 * ⚠️ 返回**空数组**是合法且有意义的值：表示「书籍不限子分类」（见 `viewSelectionPatch`）。
 */
export function normalizeViewBookKinds(raw: unknown): BookKind[] {
    if (!Array.isArray(raw)) return [];
    const set = new Set(raw.filter((v): v is BookKind => typeof v === 'string' && (BOOK_KINDS as readonly string[]).includes(v)));
    return BOOK_KINDS.filter((k) => set.has(k));
}

/** 视图 id 归一：非空字符串原样；否则给个稳定兜底（⛔ 别用随机数 —— 每次读盘都换 id 会让选中态漂） */
function normalizeViewId(raw: unknown, index: number): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    return s || `v_${index}`;
}

/**
 * 单条视图归一（脏数据丢弃 ⇒ 返回 undefined）。
 *
 * ⚠️ `name` 是唯一硬要求：没名字的视图在切换条上是一片空白，用户点不出意义来。
 */
export function normalizeMediaView(raw: unknown, index = 0): MediaView | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) return undefined;
    /**
     * 视图种类：**自建视图一律是「自定义视图」**，⛔ 不再从 raw 里读。
     *
     * 🔴 2026-11-08 用户 m04478 逐字：「自定义视图项怎么有个切换合集视图和该自定义视图的下拉框删除掉这没用」
     *    ⇒ 设置页那枚「视图种类」下拉已删（`src/Settings.ts` 的 `renderOneViewRow`）。用户 m04712 进一步裁定
     *      「删下拉，并把自建视图的 kind 一律归为自定义视图」—— 所以这里写死，⛔ 不是 `normalizeViewKind(o.kind)`。
     *    ⚠️ 老库里存着 `kind: 'collection'` 的自建视图（建库早期允许选），读回来会当场变 custom：
     *      它随即走 `viewMatchesEntry` 的标签过滤分支，这是本次裁定的预期结果，不是回归。
     *    ⚠️ 内置的默认视图 / 合集视图**不走这个函数** —— `normalizeViews` 用常量直接构造它们（见下方 `out` 初始值），
     *      所以它们的 `'default'` / `'collection'` 种类不受影响。
     *    ⛔ 别把 `MediaViewKind` 从数据模型里删掉：`viewIconOf` / `viewMatchesEntry` / `viewIsUnconfigured`
     *      仍按 kind 分派，内置两枚仍是各自的种类。
     */
    const view: MediaView = {
        id: normalizeViewId(o.id, index),
        name,
        kind: 'custom',
        types: normalizeViewTypes(o.types),
        tags: normalizeViewTags(o.tags),
    };
    if (typeof o.icon === 'string' && o.icon.trim()) view.icon = o.icon.trim();
    // ⚠️ 只有明确的 `true` 才算隐藏：缺省 / 脏值一律当「可见」，⛔ 别用 `Boolean(o.hidden)`（'false' 会变真）
    if (o.hidden === true) view.hidden = true;
    /**
     * 书籍子分类：**只有 `types` 真的含 `book` 才落这一维**。
     * 理由：一个不含 book 的视图留着 bookKinds 是死数据，将来用户再勾上「书籍」时
     * 会突然继承一份老配置（表现为「我明明只勾了书籍，网文却进不来」）。
     * ⚠️ 空数组不落键（= 不限子分类），与 `viewSelectionPatch` 的「三项全勾」形态一致。
     */
    if (view.types.includes('book')) {
        const kinds = normalizeViewBookKinds(o.bookKinds);
        if (kinds.length > 0) view.bookKinds = kinds;
    }
    return view;
}

/** 新建一个空视图（设置页「＋ 新建视图」的初值；调用方负责保证 id 唯一） */
export function createView(kind: MediaViewKind, name: string, id: string): MediaView {
    return {
        id,
        name: name.trim() || VIEW_KIND_LABELS[kind],
        kind,
        types: [],
        tags: [],
    };
}

/** 生成一个不与 `used` 冲突的视图 id（纯函数：同样的输入永远给同样的输出） */
export function nextViewId(used: readonly string[]): string {
    const set = new Set(used);
    for (let i = 1; i < 10000; i++) {
        const id = `v_${i}`;
        if (!set.has(id)) return id;
    }
    return `v_${Date.now()}`;
}

/**
 * 视图表归一（读取侧唯一收口点）。
 *
 * 🔴 三条硬保证：
 *   ⑴ **默认视图恒存在且恒在第 1 位**，`id` / `name` / `kind` 被强制钉成常量 ——
 *      用户手里的 catalog 哪怕被人手工改坏了，首页也不会失去「整个库」这一档；
 *   ⑵ id 去重（重复的整条丢弃，保留先出现的）；
 *   ⑶ 最多 `MAX_VIEWS` 条（默认视图也算在内），超出的丢掉最旧。
 * ⚠️ 空数组 / 脏数据 ⇒ 返回**只有默认视图**的一张表，⛔ 不返回空表（那样首页一条切换都没有）。
 */
export function normalizeViews(raw: unknown): MediaView[] {
    const list = Array.isArray(raw) ? raw : [];
    // 🔴 2026-11-24 用户报障「默认视图没合集视图啊」⇒ 内置合集视图作为**第二颗**默认存在。
    //    原口径只造默认视图一颗 ⇒ 用户不主动去设置页新建，首页就永远只有「默认视图」，
    //    「合集视图」这个产品承诺等于没交付。现在它与默认视图一样是**构造出来的**：
    //    ⛔ 不占 JSON（见 `viewsForStorage`）、不可删、不可改名、不可换种类。
    //    ⚠️ 用户手里已有 catalog 里若自己建过 collection 视图，下面那条 id 去重会保留用户的、
    //      丢掉这条内置的（`collision` 判据是 id）—— 所以内置 id 用保留前缀，避开 `v_*`。
    const out: MediaView[] = [
        { id: DEFAULT_VIEW_ID, name: DEFAULT_VIEW_NAME, kind: 'default', types: [], tags: [] },
        {
            id: COLLECTION_VIEW_ID,
            name: COLLECTION_VIEW_NAME,
            kind: 'collection',
            types: [],
            tags: [],
            // 🔴 出厂缺省：合集视图**不勾选**（只有默认视图勾选）。见 `BUILTIN_VIEW_HIDDEN_BY_DEFAULT`。
            //    ⚠️ 它仍然恒存在（不可删），只是首页切换条上默认不出现。
            hidden: true,
        },
    ];
    const used = new Set<string>([DEFAULT_VIEW_ID, COLLECTION_VIEW_ID]);
    for (let i = 0; i < list.length; i++) {
        const rawItem = list[i];
        /**
         * 🔴 内置视图的 `hidden` 要在 `normalizeMediaView` **之前**单独读。
         *
         * 理由：`normalizeMediaView` 把 `name` 当成唯一硬要求（没名字的视图在切换条上是空白）。
         * 但内置视图的 `name` / `kind` / `types` / `tags` **永远由常量重造**，`name` 对它们毫无意义 ——
         * 若还要靠 `name` 才能读回 `hidden`，那么一份最小存根（只有 id + hidden）就会被当成脏数据丢掉，
         * 表现正是「勾了隐藏，重开又回来了」。⇒ 按 id 先认人，再决定搬什么。
         * ⚠️ 用户自建视图仍走下面那条严格路径（没名字就是脏数据），**别**为了这条放宽它。
         */
        const rawObj = typeof rawItem === 'object' && rawItem !== null ? (rawItem as Record<string, unknown>) : null;
        const rawId = typeof rawObj?.id === 'string' ? rawObj.id.trim() : '';
        if (rawId === DEFAULT_VIEW_ID || rawId === COLLECTION_VIEW_ID) {
            const builtin = out.find((b) => b.id === rawId);
            /**
             * ⚠️ 只有明确的布尔值才算「用户显式选过」：`'false'` / 1 / null 一律当没配（保持出厂态）。
             * 🔴 `false` 必须**原样留在对象上**（`builtin.hidden = false`），⛔ 别写成 `delete builtin.hidden`：
             *   `viewsForStorage` 判的是「与出厂缺省是否不同」——出厂隐藏的合集视图被勾回来时，
             *   内存里这条**必须**带着显式 `false` 才判得出「用户改过」。若在这里删掉字段，
             *   它就和「从来没人动过」长得一模一样 ⇒ 下一次保存会静默丢掉这条偏好，
             *   用户再重开插件又变回不勾（2026-11-14 实测踩到）。
             * ⚠️ 默认视图出厂可见，显式 `false` 与出厂态相同 ⇒ 照样不落盘（见 `viewsForStorage`）。
             */
            if (builtin) {
                if (rawObj?.hidden === true) builtin.hidden = true;
                else if (rawObj?.hidden === false) builtin.hidden = false;
            }
            continue;
        }
        const v = normalizeMediaView(rawItem, i);
        if (!v) continue;
        if (used.has(v.id)) continue;
        used.add(v.id);
        out.push(v);
        if (out.length >= MAX_VIEWS) break;
    }
    return out;
}

/** 视图图标（Lucide id）：用户填的就用用户的，否则按种类兜底 —— ⛔ 别返回空串（`setIcon` 会静默失败） */
export function viewIconOf(view: MediaView | null | undefined): string {
    if (!view) return 'layout-grid';
    if (view.icon) return view.icon;
    if (view.kind === 'collection') return 'library';
    if (view.kind === 'custom') return 'folder-tree';
    return 'layout-grid';
}

/** 该视图显示哪几种媒体类型（空 ⇒ 全部；顺序按 ENTRY_TYPES 固定序） */
export function viewTypesOf(view: MediaView | null | undefined): EntryType[] {
    if (!view || view.types.length === 0) return [...ENTRY_TYPES];
    return view.types;
}

/** 该视图的媒体类型池（给 `MediaList.typePool` 用；返回 `null` = 不限制） */
export function viewTypePool(view: MediaView | null | undefined): EntryType[] | null {
    return !view || view.types.length === 0 ? null : [...view.types];
}

/** 条目是否命中视图的标签白名单（命中任一即可；白名单为空 ⇒ 谁也不命中，见 `MediaView.tags` 注释） */
export function entryMatchesTags(entry: Pick<MediaEntry, 'tags'> | null | undefined, tags: readonly string[]): boolean {
    if (!entry) return false;
    const want = new Set(tags.map((t) => t.toLowerCase()));
    if (want.size === 0) return false;
    for (const t of entry.tags ?? []) {
        if (want.has(String(t).trim().toLowerCase())) return true;
    }
    return false;
}

/**
 * 该视图限定的书籍子分类（给 `MediaList.kindFilter` 用；返回 `null` = 不限子分类）。
 *
 * ⚠️ 只有 `types` 含 `book` 才可能返回限定值：一个不收书籍的视图不该顺手把
 *    书籍类型下拉也锁死（那个下拉在 `lockType === 'book'` 时才有意义）。
 */
export function viewBookKindPool(view: MediaView | null | undefined): BookKind[] | null {
    if (!view || !view.types.includes('book')) return null;
    const kinds = view.bookKinds ?? [];
    return kinds.length === 0 ? null : [...kinds];
}

/**
 * 条目是否属于该视图。
 *
 * - 默认视图 / 合集视图：只按类型判（合集视图的 IP 聚合在 `buildCollectionGroups` 里做）；
 * - 自定义视图：类型 **且** 标签都要过。
 * - 任何视图：若限定了书籍子分类（`bookKinds` 非空），书籍条目还要命中其中之一。
 */
export function viewMatchesEntry(view: MediaView | null | undefined, entry: MediaEntry | null | undefined): boolean {
    if (!entry) return false;
    if (!view) return true;
    if (view.types.length > 0 && !view.types.includes(entry.type)) return false;
    const kinds = view.bookKinds ?? [];
    if (entry.type === 'book' && kinds.length > 0 && !kinds.includes(normalizeBookKind(entry.bookKind))) return false;
    if (view.kind === 'custom') return entryMatchesTags(entry, view.tags);
    return true;
}

/** 按视图过滤条目（保留原顺序 —— 排序是上游 `filterAndSort` 的事，⛔ 这里不重排） */
export function filterForView(entries: readonly MediaEntry[], view: MediaView | null | undefined): MediaEntry[] {
    if (!view) return [...entries];
    return entries.filter((e) => viewMatchesEntry(view, e));
}

/** 视图里没配任何二级分类时（设置页提示用） */
export function viewIsUnconfigured(view: MediaView): boolean {
    return view.kind === 'custom' && view.tags.length === 0;
}

/**
 * 所有**自定义视图**用到的标签并集（给统计页词云做排除集合）。
 *
 * 🔴 2026-11-16 用户逐字：「如果按标签归属自定义视图（如日常、工作），那标签词云统计的
 *    如工作、日常标签怎么办这些不是正常的标签」。裁定：**从词云里排除**。
 *
 * 判据（⛔ 别扩成「所有视图」）：只有 `kind === 'custom'` 的视图才带标签白名单 ——
 *   内置的默认 / 合集视图 `tags` 恒为空（见 `createView`），把它们算进来虽无副作用，
 *   但语义上会误导下一个改这里的人以为内置视图也能按标签筛。
 * ⚠️ 内置视图**不排除**它自己的名字（那不是标签，词云根本看不见）。
 * ⚠️ 返回值保留用户原文顺序、按小写去重（与 `normalizeViewTags` 口径一致）；
 *    比较时由调用方按小写比 —— 词云那边就是这么用的（见 `buildWordCloud` 的 `exclude`）。
 */
export function customViewTagPool(views: readonly MediaView[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of Array.isArray(views) ? views : []) {
        if (!v || v.kind !== 'custom') continue;
        for (const t of v.tags ?? []) {
            const s = String(t ?? '').trim();
            if (!s) continue;
            const k = s.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(s);
        }
    }
    return out;
}

/**
 * 落盘前的视图表：**只存用户自建的**，内置视图（默认 / 合集）不占 JSON。
 *
 * 🔴 与 `seriesRatings` 同一套口径：⛔ 别给每个存量 catalog 凭空添一个 `"views": [...]` ——
 *    默认视图和合集视图都是**构造出来的**（见 `normalizeViews`），不需要占 JSON 行。
 *    一个从没建过自定义视图的库 ⇒ 返回 `undefined` ⇒ 连 `views` 键都不写。
 * ⚠️ 存的是**归一后**的条目，⛔ 不是调用方传进来的原始值（防脏数据落盘）。
 */
export function viewsForStorage(raw: unknown): MediaView[] | undefined {
    const all = normalizeViews(raw);
    const out: MediaView[] = [];
    for (const v of all) {
        if (isBuiltinView(v)) {
            /**
             * 🔴 内置视图默认**不占 JSON** —— 唯一例外是「用户改过它的可见性」。
             *
             * 2026-11-25 用户要「（可勾选隐藏）默认视图 / 合集视图」⇒ 用户意图必须落盘
             * （否则下次读盘又被重造成出厂态）。
             * 🔴 2026-11-14 新增「出厂缺省可见性」：默认视图=可见、合集视图=隐藏
             *    ⇒ 判据从「`hidden === true` 就写」改成「**与出厂缺省不同才写**」：
             *      - 默认视图被藏（`hidden: true`）           ⇒ 写 `{hidden: true}`
             *      - 合集视图被勾回（出厂隐藏，现在可见）      ⇒ 写 `{hidden: false}`
             *      - 两者都保持出厂态                          ⇒ **不写**，`views` 键照旧不存在
             *    理由：合集视图现在出厂就 hidden，若沿用老判据，**每个存量 catalog 都会凭空多出一条**
             *    `{id:'collection',hidden:true}` —— 直接违背「⛔ 别给存量库里添 views」的承诺，
             *    而且那条存根不带任何用户意图（它就是出厂态）。
             * ⚠️ 写进去的 `name` / `kind` / `types` / `tags` 是类型要求占位，**读回来时一律忽略**
             *    （`normalizeViews` 只从内置存根里搬 `hidden`，其余按常量重造）—— ⛔ 别指望改这里能改内置视图。
             * ⚠️ 全都没改、也没有自定义视图 ⇒ 返回 `undefined` ⇒ 连 `views` 键都不写（与 `seriesRatings` 同口径）。
             */
            const nowHidden = v.hidden === true;
            const factoryHidden = builtinViewHiddenByDefault(v);
            if (nowHidden !== factoryHidden) {
                out.push({ id: v.id, name: v.name, kind: v.kind, types: [], tags: [], hidden: nowHidden });
            }
            continue;
        }
        out.push(v);
    }
    return out.length > 0 ? out : undefined;
}

// ── 合集视图：IP 聚合 ──────────────────────────────────────────────────────

/** 合集里的一行 = 某一种媒体类型下的全部条目（行标题形如「电影系列」） */
export interface CollectionRow {
    type: EntryType;
    /**
     * 行标题 = 纯「{类型}系列」，**不带合集名前缀**（如「电影系列」而不是「熊出没 电影系列」）。
     * 🔴 2026-11-26 用户逐字：「合集卡片内打开显示为小标题做如动画系列、电影系列、游戏系列」
     *    ⇒ 小标题只描述**下面是哪种类型的卡片网格**；合集名已经在二级返回栏里写着了，
     *      每行再拼一遍前缀纯属重复。⛔ 别把前缀加回来（`tests/mediaViews.test.ts` 有断言锁着）。
     */
    title: string;
    items: MediaEntry[];
}

/** 一张 IP 合集卡 */
export interface CollectionGroup {
    /**
     * 分组键：有 series 名的用归一化名（跨类型同 IP 会并到一张卡上）；
     * 没填 series 的条目各自成一张「单条合集」，键带 `\u0002` 前缀 + 条目 id。
     */
    key: string;
    /** 显示名（有 series 用 series 原名；无 series 用条目标题） */
    name: string;
    /** 是否真的是一条 series（false = 该条目没填系列名，自己单占一张卡） */
    isSeries: boolean;
    /** 按类型分的行（只保留真有条目的类型，顺序按 ENTRY_TYPES 固定序） */
    rows: CollectionRow[];
    /** 组内条目总数（卡片角标） */
    count: number;
}

/**
 * 条目所属的合集键：**只看 `collection` 字段**（2026-11-24 用户裁定「只有写了才能进合集视图」）。
 *
 * 🔴🔴 历史口径变更（别再改回去）：这里**原来读的是 `series`**。用户上手后判定不行：
 *    「在所有类型条目属性窗口上加个归属合集，只有写了才能进合集视图」
 *    —— 即 `series`（海报墙折叠分组名）与「归属合集」是**两件事**：
 *    · `series` = 「同一 IP 下的多部作品」，海报墙靠它把 ≥2 条折成一张卡；
 *    · `collection` = 「我要把它归到这个合集视图里」，**纯人工声明**。
 *    混用的后果：存量 86 条带 series 的条目会无差别涌进合集视图，用户没法只挑一部分。
 * ⚠️ 归一化**不含类型**（与 `seriesKeyOf` 的关键差异）：合集视图要把
 *    「熊出没电影 / 动画 / 游戏」聚合到**同一张**熊出没卡片下。
 * ⚠️ 没填 `collection` ⇒ 一律 `null` ⇒ **不进**合集视图（⛔ 别兜底回落 series，那正是被否掉的口径）。
 */
export function ipKeyOf(entry: Pick<MediaEntry, 'collection'> | null | undefined): string | null {
    const name = normalizeSeriesName(entry?.collection);
    return name || null;
}

/** 合集卡显示名：取自 `collection` 原名 trim（调用方已保证 ipKey 非空） */
function collectionNameOf(entry: MediaEntry, ipKey: string | null): string {
    if (ipKey) return String(entry.collection ?? '').trim();
    return String(entry.title ?? '').trim();
}

/**
 * 把条目聚成 IP 合集（合集视图的数据源）。
 *
 * 🔴 顺序规则（用户没另外裁定，取最不意外的一种）：
 *   - **卡片顺序 = 该 IP 首次出现的位置**（上游已按用户选的排序排好，
 *     这里再按字典序重排会与「其它视图的排序」打架）；
 *   - **卡片内行顺序 = ENTRY_TYPES 固定序**（电影 → 剧集 → 动画 → 书籍 → 游戏 → 音乐，稳定且可预期）；
 *   - **行内条目 = `sortSeriesItems`**（系列序号优先，与系列折叠卡同一口径）。
 * ⚠️ 不做「≥2 条才成合集」的门槛：合集视图就是「按 IP 看库」，
 *    单条 IP 也应显示成一张卡（⛔ 别学 `foldSeries` 的 ≥2 折叠规则）。
 */
export function buildCollectionGroups(entries: readonly MediaEntry[]): CollectionGroup[] {
    const order: string[] = [];
    const map = new Map<string, { name: string; isSeries: boolean; byType: Map<EntryType, MediaEntry[]> }>();
    for (const e of entries) {
        if (!e) continue;
        const ip = ipKeyOf(e);
        // 🔴 2026-11-24 用户裁定「只有写了才能进合集视图」⇒ 没填 `collection` 的条目**直接跳过**。
        //    ⚠️ 旧行为是「没 series ⇒ 降级成一张单条合集卡」（`SOLO_PREFIX`），那会让整个媒体库
        //    所有条目都变成卡片墙，合集视图就失去意义了 —— ⛔ 别恢复那个兜底。
        if (!ip) continue;
        const key = `s${ip}`;
        let g = map.get(key);
        if (!g) {
            g = { name: collectionNameOf(e, ip), isSeries: true, byType: new Map() };
            map.set(key, g);
            order.push(key);
        }
        const arr = g.byType.get(e.type);
        if (arr) arr.push(e);
        else g.byType.set(e.type, [e]);
    }
    const out: CollectionGroup[] = [];
    for (const key of order) {
        const g = map.get(key);
        if (!g) continue;
        const rows: CollectionRow[] = [];
        let count = 0;
        for (const type of ENTRY_TYPES) {
            const items = g.byType.get(type);
            if (!items || items.length === 0) continue;
            count += items.length;
            rows.push({
                type,
                // 🔴 2026-11-26 用户逐字：「小标题做如动画系列、电影系列、游戏系列」⇒ 只有类型系列，无合集名前缀
                title: `${ENTRY_TYPE_LABELS[type] ?? ''}系列`,
                items: sortSeriesItems(items),
            });
        }
        out.push({ key, name: g.name, isSeries: g.isSeries, rows, count });
    }
    return out;
}

/** 合集卡上的「N 部作品 · 涉及 M 种类型」副标题（空组 ⇒ 空串，卡片不渲染这行） */
export function collectionSubtitleOf(group: CollectionGroup): string {
    if (!group || group.count === 0) return '';
    const kinds = group.rows.length;
    return kinds > 1 ? `${group.count} 部 · ${kinds} 种类型` : `${group.count} 部`;
}
