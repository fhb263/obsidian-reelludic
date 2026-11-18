// 主视图（HomeView）一级页签的**唯一真源**（#541）。
//
// 🔴 为什么单独抽出来：这批起页签不止「顶部胶囊」一种排法 —— 设置页的「起始页」下拉要拿
//    同一份顺序与同一份文案，`HomeView.svelte` 的「文字菜单」分支也要用它。以前这三样
//    （顺序常量 / `tabLabel` / `tabIcon`）都埋在组件里，第二处要用就只能手抄一份 ⇒ 违反
//    「同一概念只准一份文案」。
//
// ⚠️ `HomeTab` 类型定义在**本模块**，`views/tab.ts` 改为**再导出**（保持全仓既有 import 路径不变）。
//
// 🔴🔴 2026-11-08（用户 m03712 逐字）：「用户自定义视图在设置里选择的类型在导航布局为顶部胶囊时
//    页签要把所有类型摊开而不是集中在阅读和影视里面」
//    追问后的裁定（同一轮）：
//      · 顺序 = 「计划、文学、网文、漫画、电影、剧集、动画、游戏、音乐、统计（自定义视图勾选哪个就显示哪个）」
//      · **不保留「影视」聚合页签**，只摊开单类型。
//    ⇒ 页签轴从「6 枚（含两个聚合）」变成「10 枚（全单类型，其中 3 枚是书籍子分类）」。
//
//    ⚠️ 关键难点：文学 / 网文 / 漫画 **不是** `EntryType`，它们是 `BookKind`
//      （见 `pure/bookKind`：`book` / `novel` / `comic`，展示名文学 / 网文 / 漫画）。
//      而且 `BookKind` 里那个 `'book'` **与 `EntryType` 的 `'book'` 撞名** ——
//      若直接用 `'book' | 'novel' | 'comic'` 当页签 id，「文学」页签和旧的「书籍」类型页签
//      会是同一个值、语义却是「书籍整类」vs「文学子类」两回事。
//      ⇒ 子分类页签一律带 `kind:` 前缀（`'kind:book'` / `'kind:novel'` / `'kind:comic'`），
//        在类型层就不可能混淆。
import { ENTRY_TYPE_LABELS, type BookKind, type EntryType } from 'data/types';
import { BOOK_KIND_LABELS, BOOK_KINDS } from 'pure/bookKind';

/** 书籍子分类页签的 id（`kind:` 前缀是刻意的，用来和 `EntryType` 的 `'book'` 区分，理由见文件头） */
export type BookKindTab = `kind:${BookKind}`;

/**
 * 主视图一级页签。
 *
 * ⚠️ `'media'` **仍留在联合类型里**但**已不在 `HOME_TAB_ORDER`**：它是历史缺省值
 *    （`plugin.homeTab` 的初值、老库 data.json 里存过），`normalizeStartTab` 要能认出来并升级。
 *    ⛔ 别因为「不在顺序表里」就把它从类型里删掉 —— 那样老数据读进来会变成无名值。
 */
export type HomeTab = 'tracking' | 'stats' | 'media' | EntryType | BookKindTab;

/** 判断某个页签是不是书籍子分类页签 */
export function isBookKindTab(t: HomeTab): t is BookKindTab {
    return typeof t === 'string' && t.startsWith('kind:');
}

/** 子分类页签 → 它对应的 `BookKind`（非子分类页签返回 `null`） */
export function bookKindOfTab(t: HomeTab): BookKind | null {
    if (!isBookKindTab(t)) return null;
    const kind = t.slice('kind:'.length);
    return (BOOK_KINDS as string[]).includes(kind) ? (kind as BookKind) : null;
}

/**
 * 页签**排列顺序**（用户给定，⛔ 别改）：
 *   计划 → 文学 → 网文 → 漫画 → 电影 → 剧集 → 动画 → 游戏 → 音乐 → 统计
 * ⚠️ 顶部胶囊与文字菜单**共用这一份顺序** —— 两种布局应当只是「换个排法」，不该换顺序。
 * ⚠️ 2026-11-08 起**不再有「阅读」「影视」两个聚合页签**：它们被摊成各自的单类型。
 *    历史值 `'book'` / `'media'` 由 `normalizeStartTab` 映射到新页签（见那边注释）。
 */
export const HOME_TAB_ORDER: readonly HomeTab[] = [
    'tracking',
    'kind:book',
    'kind:novel',
    'kind:comic',
    'movie',
    'tv',
    'anime',
    'game',
    'music',
    'stats',
];

/**
 * 「影视」聚合页签包含的具体类型。
 * ⚠️ 2026-11-08 起页签**不再**用它聚合显示（已摊成三枚单类型页签），但**它本身仍是真源**：
 *    `HomeView` 的合并视图与 `pure/mediaViews` 的类型池判断都还在用「影视 = 这三种」这个口径。
 *    ⛔ 别删 —— 删了「哪些类型算影视」就没有唯一答案了。
 */
export const MEDIA_TYPES: EntryType[] = ['anime', 'tv', 'movie'];

/**
 * 页签**分类轴**（用户 m09565 ①-4）。
 *
 * 用户逐字：「设置页基本设置加个启用顶部胶囊/文字菜单则按全类型分页签，关闭则按
 * 计划、阅读、影视、音乐、游戏、统计分页签（**两种模式的导航状态（当前选中项）要独立保存**，
 * 切换开关时不要丢失各自的位置）」
 *
 * · `expanded`（开 / 缺省）= 全类型摊开十枚：计划 / 文学 / 网文 / 漫画 / 电影 / 剧集 / 动画 /
 *   游戏 / 音乐 / 统计 —— 这是 2026-11-08 起的行为，**缺省必须是它**（升级不变脸）。
 * · `classic`（关）= 回到聚合六枚：计划 / 阅读 / 影视 / 音乐 / 游戏 / 统计。
 *
 * 🔴 为什么 `'book'` / `'media'` 这两个聚合值能直接当页签用、不必新造 id：
 *    它们本来就在 `HomeTab` 联合里（历史值），且 `tabLockType` / `tabMatchesEntry` /
 *    `homeTabLabel` / `TAB_ICONS` 四处的分支**至今都还在**（当年摊开页签时只把它们从
 *    `HOME_TAB_ORDER` 里摘掉，没删语义）。所以这里只是「换一份顺序表」，⛔ 不用再写一套映射。
 *    ⚠️ 反过来说：`isNavTab()` 仍以 `HOME_TAB_ORDER` 为准 ⇒ 它会**拒绝** `'book'` / `'media'`。
 *       凡是「用户给的 id 是不是合法页签」要按**当前分类轴**判，走 `isNavTabIn(axis, raw)`。
 */
export type TabAxis = 'expanded' | 'classic';

/** 合法分类轴（顺序 = 设置页下拉/开关的展示顺序；缺省项在最前） */
export const TAB_AXES: readonly TabAxis[] = ['expanded', 'classic'];

/** 分类轴文案（用户可见；与设置项 desc 同一条「准确·简洁」口径） */
export const TAB_AXIS_LABELS: Record<TabAxis, string> = {
    expanded: '按全类型',
    classic: '按聚合类型',
};

/**
 * 聚合模式（`classic`）的页签顺序 —— 用户逐字给的顺序，⛔ 别按字母/按类型表重排：
 *   计划 → 阅读 → 影视 → 音乐 → 游戏 → 统计
 */
export const CLASSIC_TAB_ORDER: readonly HomeTab[] = [
    'tracking',
    'book',
    'media',
    'music',
    'game',
    'stats',
];

/**
 * 分类轴归一：未知值回 **`expanded`**（= 2026-11-08 起的当前形态）——
 * 缺省必须让升级后的观感不变，⛔ 不能回退成聚合六枚（那是「升级即换脸」）。
 */
export function normalizeTabAxis(raw: unknown): TabAxis {
    return raw === 'classic' ? 'classic' : 'expanded';
}

/** 某分类轴下的页签顺序表（渲染 / 键盘导航 / 过滤共用这一份） */
export function tabOrderFor(axis: TabAxis): readonly HomeTab[] {
    return axis === 'classic' ? CLASSIC_TAB_ORDER : HOME_TAB_ORDER;
}

/**
 * 换个分类轴后，某个页签「最接近的对应项」。
 *
 * 🔴 为什么必需：两种轴**不是子集关系**（`classic` 有聚合的 `book`/`media`，`expanded` 有
 *    三种书籍子分类与三种影视类型）⇒ 切换轴时原来的 `activeTab` 很可能在新轴里根本不存在。
 *    若直接落到 `tabs[0]`（= 计划），用户从「电影」切过去会**莫名跳到追更表**，那不是「保持位置」。
 *    ⇒ 按语义就近折叠 / 展开：
 *      · → classic：电影/剧集/动画/影视 ⇒ 影视；文学/网文/漫画/阅读 ⇒ 阅读
 *      · → expanded：影视 ⇒ 电影（与 `normalizeStartTab` 的升级映射同口径）；
 *                    阅读 ⇒ 文学（`normalizeBookKind` 对缺省/脏值一归 `book`，见那边注释）
 *      · 计划 / 统计 / 音乐 / 游戏 两轴同名，原样返回。
 *
 * ⚠️ 认不出的值（脏数据 / 未来的新页签）回**该轴第一枚**，⛔ 不返回 `null` ——
 *    调用方拿 `null` 会写出「没有选中态」的中间态，那正是本函数要消灭的东西。
 */
export function equivalentTabFor(axis: TabAxis, tab: HomeTab): HomeTab {
    const order = tabOrderFor(axis);
    if ((order as readonly string[]).includes(tab)) return tab;
    if (axis === 'classic') {
        if (tab === 'book' || isBookKindTab(tab)) return 'book';
        if (tab === 'media' || (MEDIA_TYPES as readonly string[]).includes(tab)) return 'media';
        return order[0];
    }
    if (tab === 'media') return 'movie';
    if (tab === 'book') return 'kind:book';
    return order[0];
}

/**
 * 「起始页」按**分类轴**归一。
 *
 * 用户可能把起始页设成「电影」，然后把分类轴切到聚合模式 —— 那时「电影」这枚页签不存在。
 * 这里先走一遍 `normalizeStartTab`（认历史值 / 兜底），再用 `equivalentTabFor` 折到该轴里。
 * ⚠️ 两步顺序不能反：先折再归一的话，`'media'` 这种历史值在 expanded 轴会被当成脏值兜底成
 *    `movie`，虽然结果一样，但 classic 轴下会把合法的 `'media'` 折成 `'media'`（碰巧对）——
 *    逻辑上正确的是「先认值，再折轴」。
 */
export function normalizeStartTabFor(axis: TabAxis, raw: unknown): HomeTab {
    return equivalentTabFor(axis, normalizeStartTab(raw));
}


/**
 * 页签图标（Obsidian 内建 Lucide）。⛔ 每个值都已在 `obsidian.asar` 内建表里验证存在
 * （图标名写错时 `setIcon` 静默失败 ⇒ 界面上只剩空白 span，不会报错）。
 */
const TAB_ICONS: Record<string, string> = {
    tracking: 'calendar-check',
    'kind:book': 'book-open',
    'kind:novel': 'book-text',
    'kind:comic': 'book-image',
    movie: 'film',
    tv: 'tv',
    anime: 'clapperboard',
    game: 'gamepad-2',
    music: 'music',
    stats: 'trending-up',
    // 历史值（不在顺序表里，但可能作为 `activeTab` 短暂存在，归一前要能取到图标）
    media: 'film',
    book: 'book-open',
};

/**
 * 页签图标名。未登记的（理论上只可能是非导航用的 EntryType）回退占位图标，
 * ⛔ 不返回空串 —— `setIcon` 遇空/未知名会**静默失败**，界面上只剩一个空白 span。
 */
export function homeTabIcon(t: HomeTab): string {
    return TAB_ICONS[t] ?? 'layout-grid';
}

/**
 * 页签显示名。**只有这里是页签文案的真源**（顶部胶囊 / 文字菜单 / 起始页下拉三处共用）。
 * 🔴 2026-11-08 起：
 *    · 书籍子分类 → 文学 / 网文 / 漫画（真源 `BOOK_KIND_LABELS`，⛔ 别手抄）；
 *    · 影视三型 → 电影 / 剧集 / 动画（走 `ENTRY_TYPE_LABELS`，本项目本来就叫这三个名字）；
 *    · 历史值 `'book'` → **阅读**、`'media'` → **影视**（老库里还存着它们，下拉里要能显示成人话）。
 */
export function homeTabLabel(t: HomeTab): string {
    if (t === 'tracking') return '计划';
    if (t === 'stats') return '统计';
    const kind = bookKindOfTab(t);
    if (kind) return BOOK_KIND_LABELS[kind];    if (t === 'media') return '影视';
    if (t === 'book') return '阅读';
    return ENTRY_TYPE_LABELS[t as EntryType] ?? String(t);
}

/**
 * 「起始页」设置归一。
 *
 * 🔴 2026-11-08 的两条**升级映射**（页签轴换过，老库里的值必须继续能落到一个真页签上）：
 *    · `'media'`（历史缺省）→ `'movie'`：原来「影视」聚合页 → 现在摊开后的第一枚影视类型。
 *      ⚠️ 必须是 `movie` 而不是「影视里的某种」，这样老用户升级后打开还在电影那一屏，
 *        而不是被弹回别的页签。
 *    · `'book'`（原「阅读」聚合）→ `'kind:book'`（文学）：文学是书籍的缺省子分类
 *      （`normalizeBookKind` 对缺省/脏值一律归 `book`）⇒ 映射过去看到的就是原来那批「未细分」的书。
 *
 * 其余（缺省 / 脏数据 / 已经合法的值）按原位处理；**兜底仍是 `movie`**：
 * 它是历史缺省 `'media'` 的映射结果，回退到别处会让老用户「打开就换了一页」。
 */
export function normalizeStartTab(raw: unknown): HomeTab {
    if (typeof raw === 'string' && (HOME_TAB_ORDER as readonly string[]).includes(raw)) return raw as HomeTab;
    if (raw === 'media') return 'movie';
    if (raw === 'book') return 'kind:book';
    return 'movie';
}

/**
 * 该 id 是不是一级导航页签。
 * ⚠️ 判据必须是 `HOME_TAB_ORDER`（**当前**真页签）而不是类型联合 ——
 *    否则 `'media'` / `'book'` 这两个历史值会被当成合法页签塞回去，页签栏里冒出一枚没人要的聚合项。
 */
export function isNavTab(raw: unknown): raw is HomeTab {
    return typeof raw === 'string' && (HOME_TAB_ORDER as readonly string[]).includes(raw);
}

/**
 * 页签 → 它需要的条目类型。
 * `null` = **不依赖类型**（计划 / 统计这类非条目页签 ⇒ 恒显示）。
 * ⚠️ 书籍子分类页签（文学/网文/漫画）**都要** `book`：条目主类型是 `book`，
 *    子分类是它的第二维（`entry.bookKind`），能不能显示由 `visibleTabs` 的 `bookKindPool` 决定。
 *
 * 🔴 2026-11-12 修真实缺陷（m09565 ①-4 发现）：历史聚合页签 `'media'` 原先走
 *    `return [t as EntryType]` ⇒ 返回 `['media']`，而**条目主类型里根本没有 `'media'`**
 *    （`EntryType` 是 movie / tv / anime / book / game / music）。于是只要视图配了类型白名单，
 *    `visibleTabs` 里 `need.some((ty) => pool.includes(ty))` 恒为假 ⇒ 「影视」页签被静默藏掉。
 *    在此之前它没暴露，是因为 `'media'` 已不在 `HOME_TAB_ORDER` 里、根本走不到这里；
 *    ①-4 把聚合模式加回来后它立刻就成真 bug ⇒ 这里必须摊成影视三型。
 *    ⚠️ `'book'`（聚合）不需要特判：它**就是**一个合法的 `EntryType`。
 */
export function tabRequiresTypes(t: HomeTab): readonly EntryType[] | null {
    if (t === 'tracking' || t === 'stats') return null;
    if (t === 'media') return MEDIA_TYPES;
    if (isBookKindTab(t)) return ['book'];
    return [t as EntryType];
}

/**
 * 某页签在**指定分类轴**下算不算合法页签。
 *
 * ⚠️ `isNavTab()` 只认 `HOME_TAB_ORDER`（全类型十枚）⇒ 聚合模式下那六枚会被它全判非法，
 *    连「计划」都过不了（`tracking` 恰好在两边都有，是唯一例外）。凡是「用户/存档给的 id
 *    在当前轴下是否可用」都必须走这个函数，⛔ 别直接调 `isNavTab`。
 */
export function isNavTabIn(axis: TabAxis, raw: unknown): raw is HomeTab {
    return typeof raw === 'string' && (tabOrderFor(axis) as readonly string[]).includes(raw);
}

/**
 * 「当前视图的类型白名单」→ 顶部胶囊该显示哪几枚页签（#727，2026-11-08 改为摊开口径）。
 *
 * 规则：
 *  · `pool == null`（视图没配类型 / 默认视图）⇒ **原样返回全部十枚** —— 这才是「不限制」，
 *    ⛔ 别把它当成「空的池」从而把页签全灭掉（那会让默认视图的顶部栏整排消失）。
 *  · 非类型页签（计划 / 统计）**常驻**：它们跟条目类型无关，藏起来只会让人找不到追更表与统计。
 *  · 类型页签只有「该类型在池里」时才出现。
 *  · 书籍子分类页签（文学/网文/漫画）还要过 `bookKindPool` 这一关：
 *      - `bookKindPool == null`（视图没限定子分类）⇒ 三枚**全显示**（等价于「书籍整类」展开）；
 *      - 有值时只显示被勾中的那几枚。
 *    ⚠️ 池里没有 `book` 时，即便 `bookKindPool` 非空也不该出现书籍页签 —— 类型那一关先拦住了。
 *  · 顺序恒为 `HOME_TAB_ORDER`，⛔ 不重排 —— 过滤只该做减法。
 *
 * ⚠️ 返回的数组可能只剩计划/统计两枚，但**不会为空**（那两枚常驻）。
 */
export function visibleTabs(
    pool: readonly EntryType[] | null | undefined,
    bookKindPool: readonly BookKind[] | null | undefined = null,
    axis: TabAxis = 'expanded'
): HomeTab[] {
    // 归一成集合，避免每枚页签都扫一遍数组（十枚 × N 类型，虽然小但没必要）
    const kinds = !pool || !bookKindPool ? null : new Set(bookKindPool);
    return tabOrderFor(axis).filter((t) => {
        const need = tabRequiresTypes(t);
        if (!need) return true;
        if (pool && !need.some((ty) => pool.includes(ty))) return false;
        // 类型那一关过了，再看书籍子分类那一维
        const kind = bookKindOfTab(t);
        if (kind && kinds) return kinds.has(kind);
        return true;
    });
}

/**
 * 当前页签若被过滤掉了，该落到哪一枚。
 *  · 仍可见 ⇒ 原样返回（绝大多数情况，零副作用）；
 *  · 不可见 ⇒ 落到**可见页签里的第一枚**（计划在首位 ⇒ 实际落到「计划」）。
 * ⚠️ `visibleTabs` 恒定非空，所以这里的兜底不会返回 `undefined`。
 */
export function resolveVisibleTab(tabs: readonly HomeTab[], current: HomeTab): HomeTab {
    return tabs.includes(current) ? current : tabs[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 页签 → 承载组件参数 / 条目过滤（2026-11-08 摊开页签时新增）
//
// 🔴 为什么放在本模块而不是写进 `HomeView.svelte` 的模板表达式里：
//    那段翻译要判三种页签（普通类型 / 书籍子分类 / 非条目），在组件里写成一串嵌套三元时，
//    TS 对箭头函数闭包**不做窄化传递** —— `tabKind ? entries.filter(e => matchesBookKind(e, tabKind))`
//    里 `tabKind` 在闭包内又变回 `BookKind | null`，svelte-check 直接报
//    「Argument of type 'BookKind | null' is not assignable to parameter of type 'BookKind | "all"'」。
//    把这层搬进纯模块后：入参判一次、返回值类型写死，调用方零窄化负担，而且**能被单测直接锁**。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 页签 → 承载组件（`MediaList`）该锁定的**条目主类型**。
 *
 * · 普通类型页签 ⇒ 它自己（movie / tv / anime / game / music）
 * · 书籍子分类页签（文学 / 网文 / 漫画）⇒ 一律 `'book'`（子分类是它的第二维，见 `tabBookKind`）
 * · 历史聚合页签 `'media'` ⇒ `null`（影视整类；它已不在页签顺序里，但老库仍可能选中它）
 * · 非条目页签 `'tracking'` / `'stats'` ⇒ `null`（那两页根本不渲染 `MediaList`）
 *
 * ⚠️ 返回 `null` 的语义是「不锁类型」，⛔ 不是「锁成空」。
 */
export function tabLockType(t: HomeTab): EntryType | null {
    if (t === 'tracking' || t === 'stats') return null;
    if (t === 'media') return null;
    if (isBookKindTab(t)) return 'book';
    return t as EntryType;
}

/**
 * 页签 → 承载组件该锁定的**书籍子分类**（`null` = 不锁）。
 *
 * 只有文学 / 网文 / 漫画三枚页签有值；其余一律 `null`。
 * ⚠️ 判据走 `bookKindOfTab`（已校验取值 ∈ `BOOK_KINDS`），⛔ 别在这里手写 `startsWith('kind:')`
 *    —— 那会把将来可能出现的、拼错的 `kind:xxx` 当成合法子分类放过去。
 */
export function tabBookKind(t: HomeTab): BookKind | null {
    return bookKindOfTab(t);
}

/**
 * 某条目**是否属于当前页签**。
 *
 * 语义刻意与「页签 → 参数」分开：这里的判据是**最终结果**（条目在不在这一屏），
 * 而 `tabLockType` / `tabBookKind` 是**交给子组件的搜索条件**。两者必须一致，
 * 但实现上子组件还会再叠状态 / 题材 / 搜索等维度，所以⛔ 别试图用一个函数同时覆盖两者。
 *
 * · 非条目页签（计划 / 统计）⇒ **恒 false**：它们不由列表承载，调用方本就不该问；
 *   返回 false 而不是 true，是为了让「误把非条目页签喂进来」立刻表现为空列表而不是全量透出。
 *    ⚠️ 若将来真要让它们承载列表，改这里即可，不必改调用方。
 * · 书籍子分类页签 ⇒ 只收 `type === 'book'` **且** 子分类命中的条目
 *   （`matchesBookKind` 对未标注 `bookKind` 的存量书按「文学」处理，见 `pure/bookKind`）。
 * · `'media'`（历史聚合）⇒ 影视三型之一。
 * · 其余 ⇒ 类型相等。
 *
 * @param t 当前页签
 * @param e 只读这两维（`type` / `bookKind`），让调用方传整条 `MediaEntry` 也不必做适配
 */
export function tabMatchesEntry(t: HomeTab, e: { type: EntryType; bookKind?: BookKind }): boolean {
    if (t === 'tracking' || t === 'stats') return false;
    const kind = bookKindOfTab(t);
    if (kind) return e.type === 'book' && matchesBookKindOfEntry(e, kind);
    if (t === 'media') return (MEDIA_TYPES as EntryType[]).includes(e.type);
    return e.type === t;
}

/**
 * 与 `pure/bookKind.matchesBookKind` 同口径，但**自带类型收窄**（入参只要 `{type, bookKind}`）。
 *
 * ⚠️ 为什么不直接调 `matchesBookKind`：它要求入参是完整 `MediaEntry`（要用到更多字段），
 *    而这里只需要这两维。为了让 `tabMatchesEntry` 的签名对调用方最宽松（传子集即可），
 *    在本模块内做一次窄化判断 —— ⛔ 口径必须与 `pure/bookKind` 一致：
 *    未标注 `bookKind` 的存量书籍按**文学**（`book`）算。
 */
function matchesBookKindOfEntry(e: { type: EntryType; bookKind?: BookKind }, kind: BookKind): boolean {
    if (e.type !== 'book') return false;
    const actual = e.bookKind ?? 'book';
    return actual === kind;
}

