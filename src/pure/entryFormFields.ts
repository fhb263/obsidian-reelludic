/**
 * 编辑窗口（EntryForm）的**属性框布局**配置。
 *
 * 与既有几套配置的分工（键空间各不相同，⛔ 别互相套用）：
 * - `pure/fieldOrder`    — frontmatter 键的**写出顺序**，不驱动渲染；
 * - `pure/cardMeta`      — 海报墙**卡片信息栏**，最多 5 行；
 * - `pure/tableColumns`  — 表格视图**列**；
 * - 本模块               — **编辑窗口里的属性框**：显示/隐藏、先后顺序、每框占几栅格。
 *
 * 本模块的键是**表单字段 id**（`genres` / `comic-artist` / `book-progress`…），
 * ⛔ 不是 frontmatter 键名，别拿 `META_FIELDS` 的 key 来对。
 *
 * 口径（用户 2026-11-27 第二轮裁定，推翻了第一轮的「按块」口径）：
 * ⑴ **每个属性框独立参与布局**，可以自由组合成「独占一行 / 两个并排 / 三个并排」；
 * ⑵ 布局用 **6 栅格**表达：每个框占 span ∈ {1..6}，6 = 独占一行、3 = 两个并排、2 = 三个并排，
 *    混着来也能自由流动（2 + 4、3 + 3、6）。⛔ 不做像素级自由画布 ——
 *    那会同时破键盘可达性与窄窗口布局，而本仓 a11y 是硬门禁。
 * ⑶ **只动布局、不动数据**：所有表单状态在声明处从 `entry` 取初值、`submit()` 无条件读，
 *    所以隐藏一个框既不丢值也不清值。⛔ 别在提交时把隐藏框置空 —— 那是静默清数据。
 * ⑷ 缺省 = **全部显示 + 模板原顺序 + 模板原宽度**；`undefined` 表示「没配过」，
 *    这时面板一个 class 都不加，编辑窗口与改版前逐像素一致。
 *
 * 归一器**只过滤、不补回**（与 `pure/cardMeta.normalizeCardFieldsForType` 同口径）：
 * 数组里没出现的键 = 用户刻意收起。⛔ 别「贴心地」把缺失项补回缺省位置 ——
 * 那会把「删除」语义彻底抹平（第一版就是这么静默失效的）。
 * 代价：以后表单新增字段，配过该类型的用户不会自动看到它，需要显式迁移。
 */

import type { BookKind, EntryType } from 'data/types';
import { BOOK_KINDS } from 'pure/bookKind';

/** 布局栅格总数。所有 span 都以它为分母。 */
export const ENTRY_FORM_MAX_SPAN = 6;

/** 面板上提供的宽度档位（文案 → span）。6 = 独占一行、3 = 两个并排、2 = 三个并排、1 = 六个并排。 */
export const ENTRY_FORM_SPAN_PRESETS: ReadonlyArray<{ span: number; label: string; hint: string }> = [
    { span: 6, label: '整行', hint: '独占一行' },
    { span: 3, label: '1/2', hint: '一行两个并排' },
    { span: 2, label: '1/3', hint: '一行三个并排' },
    // 🔴 m06404：新增 1/6 一档 —— 年份块要压成「最短的那一个」，给右侧的只读评分簇腾出位置。
    //   在此之前 `clampEntryFormSpan` 已经允许 1（见其测试「1/4 不属预设但仍在栅格内」），
    //   只是面板不给选；现在年份的缺省 span 就是 1，必须能在面板里被看懂/改回来。
    { span: 1, label: '1/6', hint: '一行六个并排' },
];

/** 面板的八个类型格。书籍三子类原地展开，与 `Settings.CARD_TYPE_SLOTS` 同构。 */
export const ENTRY_FORM_SLOTS: ReadonlyArray<{ key: string; type: EntryType; kind?: BookKind }> = [
    { key: 'f:movie', type: 'movie' },
    { key: 'f:tv', type: 'tv' },
    { key: 'f:anime', type: 'anime' },
    ...BOOK_KINDS.map((k) => ({ key: 'k:' + k, type: 'book' as EntryType, kind: k })),
    { key: 'f:game', type: 'game' },
    { key: 'f:music', type: 'music' },
];

export interface EntryFormFieldDef {
    /** 表单字段 id（也是 `data-fld` 的值）。 */
    key: string;
    /** 面板上显示的名字。 */
    label: string;
    /** 缺省占几栅格（模板原宽度）。 */
    span: number;
    /** 适用类型；不写 = 全类型。 */
    types?: readonly EntryType[];
    /** 适用书籍子类；不写 = 该类型下全子类。只在 `type === 'book'` 时有意义。 */
    kinds?: readonly BookKind[];
    /** 反向排除的书籍子类。用于「书与非书都渲染、但漫画不要」这种表达。 */
    excludeKinds?: readonly BookKind[];
}

/** 一个字段的布局落位（顺序 + 宽度）。 */
export interface EntryFormFieldLayout {
    key: string;
    span: number;
}

/** 落盘形态。`string` 是第一版（只有顺序、无宽度）的旧格式，必须继续认。 */
export type EntryFormFieldEntry = string | EntryFormFieldLayout;

/**
 * ⛔ 不出现在面板里、永远显示的字段。用户逐项确认（2026-11-27）：
 * 标题、状态 / 个人评分 / 个人评语、封面海报区、启动路径。
 * 理由不是"重要"，而是**藏了会真坏**：
 * - `title`：保存按钮 `disabled={!title.trim()}` 依赖它；
 * - `poster`：左侧 100px 固定轨道，`.rl-section-left` 的 `margin-left:-112px` 靠它对齐，
 *   且 `fileInput.click()` 只从这里进；
 * - `rating`：隐藏后数字输入框的 `focus()/select()` 静默失效；
 * - `launch`：四类型同名不同变量（游戏 / 音乐 / 书籍 / 影视各一份），是唯一入口。
 */
export const ENTRY_FORM_LOCKED_KEYS: readonly string[] = ['title', 'poster', 'status', 'rating', 'notes', 'launch'];

/**
 * 🔴 **固定键**：永远显示、⛔ 用户既看不到也不可收起/拖动。
 *
 * 口径演进（两张用户原话，⛔ 别只记最后一条）：
 *   1. 2026-11-14：「把『来源/评分/评价人数/平台链接』**不再显示**（转为固定不可修改）」⇒ 只有 `meta`。
 *   2. 🔴 2026-11-15 m07047（逐字）：「高级设置-条目属性排序**不要显示第一行了**，
 *      如标题、年份、评分来源都不要显示，都是固定的不能改换顺序」
 *      ⇒ 第一行整组都固定：标题（属锁定键，本来就不在注册表里）+ **五个年份键** + **`meta`**。
 *
 * 与 `ENTRY_FORM_LOCKED_KEYS` 的区别（⛔ 别合并成一张表）：
 *   - 锁定键：**根本不在** `ENTRY_FORM_FIELDS` 里 —— 它们连「属性块」概念都不算（标题/封面/状态/评分/备注/启动按钮）；
 *   - 固定键：**在** `ENTRY_FORM_FIELDS` 里（需要登记以确定它在编辑窗里的位次与宽度），
 *     但设置面板**一个都不画**（连灰块都没有 —— m06462 那版灰块占位已被 m07047 推翻）。
 * ⚠️ 所以这里不能改成 `ENTRY_FORM_FIELDS` 里没有的键 —— `buildEntryFormPlan` 靠注册表给它算位次。
 */
export const ENTRY_FORM_FIXED_KEYS: readonly string[] = [
    'year',
    'novel-year',
    'comic-year',
    'book-year',
    'music-year',
    'meta',
];

/** 该字段是否固定（永远显示、不可配置）。 */
export function entryFormFieldIsFixed(key: string): boolean {
    return ENTRY_FORM_FIXED_KEYS.includes(key);
}

/**
 * 全部可配置字段。**登记顺序 = 缺省顺序 = 模板书写顺序**（改模板必须同步改这里，
 * `tests/entryFormFields.test.ts` 的 `TEMPLATE_ORDER` 会逐类型对账）。
 *
 * 一个 `.rl-2col` 里的两格**各自独立成项**：那层两列外壳已整体拆除，两格直接是
 * `.rl-fields-col`（6 列栅格）的子元素，各自带自己的 `grid-column: span N`。
 */
export const ENTRY_FORM_FIELDS: readonly EntryFormFieldDef[] = [
    /*
     * 🔴🔴 2026-11-15 用户 m05562（逐字）：
     *   「表单的标题框太长了，把上映年（首播年、发行年）和标题并排在中【顺序为：标题、上映年、
     *     评分来源等】、上映年原来位置由标签替代【顺序为：题材、标签】，然后把系列和系列序号框
     *     合并为一个宽度行不行，然后和合集并排【顺序为：系列&系列序号、合集】」
     *
     * ⇒ 本数组前三位因此变成 **年份 → meta → 题材 → 标签**（原先是 meta → 题材 → 年份）。
     *    · 年份提到第一位、且 span 3：标题外壳（模板里那圈 `.rl-title-col`）自己占 3 栅格，
     *      年份紧随其后占 3 栅格 ⇒ 两者落在同一行，正好是用户要的「标题、上映年」并排。
     *      ⚠️ 年份必须是**第一个受管块**才排得上——`meta` 是固定键，`buildEntryFormPlan` 会把它
     *      插到「模板里排在它后面的第一个非固定键」之前；年份若排在 meta 之后就会被整行的
     *      meta（span 6）挤到下一行。⛔ 别把年份挪回 meta 后面。
     *    · `tags` 提到题材组末尾、紧跟各组题材：用户要的「上映年原来位置由标签替代」。
     *      五个题材键（genres / novel-genres / comic-genres / book-genres / music-genres）
     *      各自 3 栅格，标签 3 栅格 ⇒ 同一时刻只生效一组，于是永远「题材、标签」并排。
     *    ⚠️ 改这里必须同步改 `views/components/EntryForm.svelte` 的模板书写顺序：首屏由模板决定，
     *      `applyFieldOrder` 只在 `afterUpdate` 之后才把 DOM 重排到本数组顺序，两边不一致会
     *      看到「首屏一个样、眨眼变另一个样」（同 music-genres 那条老注释的口径）。
     */

    // ── 年份：紧贴标题右侧（m05562，全部类型都上移） ──
    //   🔴 2026-11-15 m06404（用户：「这还是来源评分占中间啊不是绝对定位放在最右边啊」）：
    //      年份从 **2 栅格压到 1 栅格**，标题壳从 4 栅格收到 3 栅格，右侧空出的 2 栅格
    //      留给**绝对定位**的只读评分簇（`entry && !metaEditing` 时那颗「★ 8 · N人评价 + 来源按钮」）。
    //      为什么必须动栅格而不能只改 CSS：`4 + 2 = 6` 正好占满整行、零余量，实测 552px 下
    //      标题壳 364 + 年份 177 = 541，而评分簇本身就要 **202px**（星评 112 + 来源按钮 84 + gap 6）
    //      ⇒ 它只能被挤在标题框和年份框中间，右缘距整行右界整整差 187px，这就是「占中间」。
    //   ⚠️ 1 栅格在 552px 的表单里 ≈ 84px，「2024」这种四位年份放得下；再窄就会被截断。
    //   ⚠️ 改这里必须同步 `EntryForm.svelte` 里 `.rl-title-col` 的 `grid-column: 1 / span 3`，
    //      两边加起来必须是 6（4+1 或 3+1 都会留出右侧空白给评分簇，但 4+1=5 会让簇压到年份上）。
    { key: 'year', label: '年份（上映 / 发行 / 首播）', span: 1, types: ['movie', 'tv', 'anime', 'game'] },
    { key: 'novel-year', label: '上架年', span: 1, types: ['book'], kinds: ['novel'] },
    { key: 'comic-year', label: '出版年', span: 1, types: ['book'], kinds: ['comic'] },
    { key: 'book-year', label: '出版年', span: 1, types: ['book'], kinds: ['book'] },
    { key: 'music-year', label: '发行年', span: 1, types: ['music'] },

    // ── 来源 / 大众评分 / 评价人数 / 平台链接：用户裁定保持四输入整体（一行四格） ──
    { key: 'meta', label: '来源 / 评分 / 评价人数 / 平台链接', span: 6 },

    // ── 题材 + 标签（m05562：标签顶替年份原位置，紧跟题材） ──
    { key: 'genres', label: '题材', span: 3, types: ['movie', 'tv', 'anime', 'game'] },
    { key: 'novel-genres', label: '题材', span: 3, types: ['book'], kinds: ['novel'] },
    { key: 'comic-genres', label: '题材', span: 3, types: ['book'], kinds: ['comic'] },
    { key: 'book-genres', label: '题材', span: 3, types: ['book'], kinds: ['book'] },
    { key: 'music-genres', label: '题材', span: 3, types: ['music'] },
    { key: 'tags', label: '标签', span: 3 },

    // ── 网文（模板里是 `bookKind === 'novel'` 分支，与文学 / 漫画互斥） ──
    { key: 'novel-author', label: '作者', span: 3, types: ['book'], kinds: ['novel'] },
    { key: 'novel-chapters', label: '元数据章数', span: 3, types: ['book'], kinds: ['novel'] },

    // ── 漫画（`bookKind === 'comic'` 分支，互斥） ──
    { key: 'comic-publisher', label: '出版社', span: 3, types: ['book'], kinds: ['comic'] },
    { key: 'comic-author', label: '作者', span: 3, types: ['book'], kinds: ['comic'] },
    { key: 'comic-artist', label: '画师', span: 3, types: ['book'], kinds: ['comic'] },
    { key: 'comic-chapters', label: '总话数', span: 3, types: ['book'], kinds: ['comic'] },

    // ── 文学（`{:else}` 分支，互斥） ──
    { key: 'book-publisher', label: '出版社', span: 3, types: ['book'], kinds: ['book'] },
    { key: 'book-author', label: '作者', span: 3, types: ['book'], kinds: ['book'] },

    // ── 音乐 ──
    // 🔴 2026-11-09（第 16 轮，用户「这个专辑默认给我和题材调换一下（编辑属性框顺序）」）：
    //    `music-genres` 提到 `music-album` 之前。**注册顺序 = 缺省布局顺序**
    //    （`defaultEntryFormFieldsFor` 直接按本数组 map），所以这里的先后就是用户在编辑属性框里看到的先后。
    //    ⚠️ 改这里必须同时改 `views/components/EntryForm.svelte` 模板里对应两个 `div` 的书写顺序 ——
    //    首屏那一笔由模板决定，`applyFieldOrder` 只在 `afterUpdate` 之后才把 DOM 重排到本数组的顺序，
    //    两边不一致会看到「首屏一个样、眨眼变另一个样」。
    //    ⚠️ m05562 之后：`music-year` 已上移、`music-genres` 已上移到题材组，这里只剩作者与专辑。
    { key: 'music-author', label: '作者', span: 3, types: ['music'] },
    { key: 'music-album', label: '专辑', span: 3, types: ['music'] },

    // ── 影视：导演 / 主演 ──
    { key: 'director', label: '导演', span: 3, types: ['movie', 'tv', 'anime'] },
    { key: 'cast', label: '主演（声优）', span: 3, types: ['movie', 'tv', 'anime'] },

    // ── 游戏：平台 / 开发商 ──
    { key: 'game-platform', label: '平台', span: 3, types: ['game'] },
    { key: 'game-developer', label: '开发商', span: 3, types: ['game'] },

    // ── tv / anime：总集数 + 当前进度 ──
    { key: 'total-episodes', label: '总集数', span: 3, types: ['tv', 'anime'] },
    { key: 'episode', label: '当前进度', span: 3, types: ['tv', 'anime'] },

    // ── 文学：ISBN / 元数据页数 ──
    { key: 'isbn', label: 'ISBN', span: 3, types: ['book'], kinds: ['book'] },
    { key: 'pages', label: '元数据页数', span: 3, types: ['book'], kinds: ['book'] },

    // ── 全类型：系列 / 合集 / 标签 ──
    // 🔴 2026-11-15（用户 m04255「表单只有标签，没有标签能被词云统计啊」→ m04293 裁定）：
    //    `合集` → `合集`、`标签` → `标签`。原因不是审美，是**同一件东西两个名字会把人卡住**：
    //    · 统计页词云空态写的是「在条目编辑表单的『标签』里填几个词」，表单里却叫「标签」；
    //    · `pure/metaFields.ts:140` 早把 `tags` 叫「标签」，`pure/wordCloud.ts` 也叫标签词云 ——
    //      全仓只有这个表单加「归属」前缀，它才是少数派。
    //    ⛔ 别再改回「归属XX」：`key` 保持 `collection` / `tags` 不变（落盘字段名不动），
    //       这里只是**显示名**。改 key 会连带 frontmatter 迁移，属另一件事。
    //    ⚠️ m05562 之后：`tags` 已上移到题材组末尾（用户要「题材、标签」并排），这里只剩两项。
    //    🔴🔴 `series-index` **已从本表退场**（m05562 用户：「把系列和系列序号框合并为一个宽度
    //       行不行，然后和合集并排【顺序为：系列&系列序号、合集】」）：两框现在并进**同一个**
    //       `data-fld="series"` 受管块（模板里 `.rl-series-pair` 内部 2:1 分宽），它不再是独立块。
    //       ⚠️ 留着它会立刻口径分裂 —— 设置页能单独收起「系列序号」、表单里却收不掉（它在 series
    //          块内部，没有自己的 `data-fld`）。⛔ 别再加回来；`pure/formFields.ts` 的
    //          `FORM_FIELD_SPECS` 仍保留 `series-index` 的占位文案规格（那是输入格式真源，两码事）。
    { key: 'series', label: '系列 / 系列序号', span: 3 },
    { key: 'collection', label: '合集', span: 3 },

    // ── 长文本 / 整块：独占一行 ──
    { key: 'read-hours', label: '阅读时长', span: 6, types: ['book'] },
    { key: 'summary', label: '简介', span: 6 },
    { key: 'lrc', label: 'LRC 歌词', span: 6, types: ['music'] },
    { key: 'author-intro', label: '作者简介', span: 6, types: ['book'], kinds: ['book', 'novel'] },
    { key: 'toc', label: '目录', span: 6, types: ['book'], kinds: ['book', 'novel'] },
    // 书与非书两处 markup 互斥、共用这一把键；漫画不渲染它。
    { key: 'ai-summary', label: '总结摘要', span: 6, excludeKinds: ['comic'] },
    { key: 'playtime', label: '游玩时长', span: 6, types: ['game'] },
    { key: 'book-progress', label: '阅读进度', span: 6, types: ['book'] },
];

const FIELD_BY_KEY: ReadonlyMap<string, EntryFormFieldDef> = new Map(ENTRY_FORM_FIELDS.map((d) => [d.key, d]));

export function entryFormFieldByKey(key: string): EntryFormFieldDef | undefined {
    return FIELD_BY_KEY.get(key);
}

/** 该字段在给定类型 / 子类下是否渲染。 */
export function entryFormFieldAppliesTo(def: EntryFormFieldDef, type: EntryType, kind?: BookKind): boolean {
    if (def.types && !def.types.includes(type)) return false;
    if (def.excludeKinds) {
        if (type === 'book' && kind && def.excludeKinds.includes(kind)) return false;
    }
    if (def.kinds) {
        if (type !== 'book') return false;
        // 未指定子类 ⇒ 该类型下全子类都算适用（调用方拿不到子类时保守放行）。
        if (kind && !def.kinds.includes(kind)) return false;
    }
    return true;
}

/** 该类型（该子类）下可配置的字段，按缺省顺序。 */
export function entryFormFieldsFor(type: EntryType, kind?: BookKind): EntryFormFieldDef[] {
    return ENTRY_FORM_FIELDS.filter((d) => entryFormFieldAppliesTo(d, type, kind));
}

/** 该类型（该子类）的缺省布局：全显示、模板顺序、模板宽度。 */
export function defaultEntryFormFieldsFor(type: EntryType, kind?: BookKind): EntryFormFieldLayout[] {
    return entryFormFieldsFor(type, kind).map((d) => ({ key: d.key, span: d.span }));
}

/** 把任意脏值收敛成合法的 span。 */
export function clampEntryFormSpan(span: unknown, fallback = ENTRY_FORM_MAX_SPAN): number {
    const n = typeof span === 'number' && Number.isFinite(span) ? Math.round(span) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(ENTRY_FORM_MAX_SPAN, Math.max(1, n));
}

/**
 * 归一配置。**只过滤、不补回**：
 * - 非数组 ⇒ 视为没配过，返回全量缺省；
 * - 空数组 ⇒ 用户刻意全收起，**合法**（⛔ 别用长度/假值判断，`[]` 在这里是真值语义）；
 * - 数组里没出现的键 ⇒ 收起；丢脏键、去重（先到先得）、按 `ENTRY_FORM_FIELDS` 的缺省位置**排序**。
 */
export function normalizeEntryFormFields(raw: unknown, type: EntryType, kind?: BookKind): EntryFormFieldLayout[] {
    const allowed = entryFormFieldsFor(type, kind);
    if (!Array.isArray(raw)) return allowed.map((d) => ({ key: d.key, span: d.span }));

    const spanOf = new Map(allowed.map((d) => [d.key, d.span]));
    const seen = new Set<string>();
    const out: EntryFormFieldLayout[] = [];
    for (const item of raw as EntryFormFieldEntry[]) {
        const key = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as EntryFormFieldLayout).key : '';
        if (typeof key !== 'string' || !spanOf.has(key) || seen.has(key)) continue;
        seen.add(key);
        const fallback = spanOf.get(key) as number;
        const want = typeof item === 'string' ? fallback : clampEntryFormSpan((item as EntryFormFieldLayout).span, fallback);
        out.push({ key, span: want });
    }
    // 配置里的先后顺序就是渲染顺序；这里只保证 span 合法，不动顺序。
    return out;
}

/** 是否等于缺省（顺序与宽度都要一致）。 */
export function isDefaultEntryFormFields(entries: readonly EntryFormFieldLayout[], type: EntryType, kind?: BookKind): boolean {
    const def = defaultEntryFormFieldsFor(type, kind);
    if (entries.length !== def.length) return false;
    return entries.every((e, i) => e.key === def[i].key && e.span === def[i].span);
}

/**
 * 把设置面板交上来的「可管理键」补回固定键，得到**落库形态**。
 *
 * 🔴 为什么必须补：设置面板把固定键从可管理集合里剔了（用户看不到也拖不动），
 *   但落库的那份配置要和 `defaultEntryFormFieldsFor` 对齐 ——
 *   `isDefaultEntryFormFields` 是**整份比对**（长度 + 逐项 key/span），少一个键就恒判「非缺省」，
 *   于是用户什么都没改也会被写一份自定义配置进 JSON，破坏了「没改就不写」的口径。
 *
 * ⚠️ 插入位置只是**落库形态**，屏幕上谁在前由 `buildEntryFormPlan` 按模板位次决定
 *   （它会强制把固定键排到模板位置上），所以这里按模板顺序就近插入即可。
 */
export function withFixedEntryFormFields(entries: readonly EntryFormFieldLayout[], type: EntryType, kind?: BookKind): EntryFormFieldLayout[] {
    const allowed = entryFormFieldsFor(type, kind);
    const out = entries.filter((e) => !entryFormFieldIsFixed(e.key));
    for (const d of allowed) {
        if (!entryFormFieldIsFixed(d.key)) continue;
        const myIdx = allowed.indexOf(d);
        let at = out.length;
        for (let i = 0; i < out.length; i++) {
            const otherIdx = allowed.findIndex((x) => x.key === out[i].key);
            if (otherIdx > myIdx) {
                at = i;
                break;
            }
        }
        out.splice(at, 0, { key: d.key, span: d.span });
    }
    return out;
}

export interface EntryFormPlan {
    /** 字段 → 位次（渲染顺序用，越小越靠前）。 */
    order: ReadonlyMap<string, number>;
    /** 该类型下被收起的字段。 */
    hidden: ReadonlySet<string>;
    /** 字段 → 占几栅格。 */
    span: ReadonlyMap<string, number>;
}

/**
 * 由配置算出渲染计划。`entries` 已归一过（或直接传 `undefined` 表示没配过）。
 *
 * 🔴 固定键（`ENTRY_FORM_FIXED_KEYS`）在这里被**强制补位**，理由是历史配置：
 *   用户可能存过一份「不含 meta」的旧配置（当时 meta 还能被收起）⇒ 若只按 `visible` 排 order，
 *   `sortEntryFormKeys` 会把没登记的 meta 垫到最后（rank = MAX），编辑窗口那一行四格就跑到最底下，
 *   与「meta 固定在第一行」的产品承诺相反。⇒ 缺位时按**模板登记顺序**把它插回去。
 */
export function buildEntryFormPlan(
    entries: readonly EntryFormFieldLayout[] | undefined,
    type: EntryType,
    kind?: BookKind,
): EntryFormPlan {
    const all = entryFormFieldAppliesTo;
    const visible = entries ?? defaultEntryFormFieldsFor(type, kind);
    const span = new Map<string, number>();
    const layout = new Map<string, EntryFormFieldLayout>();
    for (const e of visible) {
        if (!layout.has(e.key)) {
            layout.set(e.key, e);
            span.set(e.key, e.span);
        }
    }
    // 固定键缺位 ⇒ 按模板登记顺序插回去（宽度用模板缺省）
    for (const d of ENTRY_FORM_FIELDS) {
        if (!entryFormFieldIsFixed(d.key)) continue;
        if (!all(d, type, kind)) continue;
        if (layout.has(d.key)) continue;
        layout.set(d.key, { key: d.key, span: d.span });
        span.set(d.key, d.span);
    }
    // 排序：固定键按模板位次落位，其余保持用户配置的先后
    const ordered: string[] = [];
    const templateIndex = new Map<string, number>();
    ENTRY_FORM_FIELDS.forEach((d, i) => templateIndex.set(d.key, i));
    for (const key of layout.keys()) {
        if (!entryFormFieldIsFixed(key)) ordered.push(key);
    }
    for (const d of ENTRY_FORM_FIELDS) {
        if (!entryFormFieldIsFixed(d.key)) continue;
        if (!layout.has(d.key)) continue;
        // 插到「模板里排在它后面的第一个非固定键」之前；找不到就垫后
        const want = templateIndex.get(d.key) ?? Number.MAX_SAFE_INTEGER;
        let at = ordered.length;
        for (let i = 0; i < ordered.length; i++) {
            const other = templateIndex.get(ordered[i]) ?? Number.MAX_SAFE_INTEGER;
            if (other > want) {
                at = i;
                break;
            }
        }
        ordered.splice(at, 0, d.key);
    }
    const order = new Map<string, number>();
    ordered.forEach((k, i) => order.set(k, i));
    const hidden = new Set<string>();
    for (const d of ENTRY_FORM_FIELDS) {
        if (!all(d, type, kind)) continue;
        if (entryFormFieldIsFixed(d.key)) continue; // 🔴 固定键永不收起
        if (!order.has(d.key)) hidden.add(d.key);
    }
    return { order, hidden, span };
}

/** 该字段在计划里是否被收起。计划为 null ⇒ 一律不收起。 */
export function entryFormFieldHidden(plan: EntryFormPlan | null, key: string): boolean {
    return plan ? plan.hidden.has(key) : false;
}

/** 该字段在计划里占几栅格；没登记过就退回模板缺省，再不行退整行。 */
export function entryFormFieldSpan(plan: EntryFormPlan | null, key: string): number {
    const fromPlan = plan?.span.get(key);
    if (typeof fromPlan === 'number') return fromPlan;
    return FIELD_BY_KEY.get(key)?.span ?? ENTRY_FORM_MAX_SPAN;
}

/** 按计划给键排序（未登记的键垫后，且保持相对顺序）。不改入参。 */
export function sortEntryFormKeys(keys: readonly string[], plan: EntryFormPlan | null): string[] {
    if (!plan) return keys.slice();
    const MAX = Number.MAX_SAFE_INTEGER;
    return keys
        .map((k, i) => ({ k, i, rank: plan.order.get(k) ?? MAX }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map((e) => e.k);
}
