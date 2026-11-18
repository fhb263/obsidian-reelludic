/**
 * 表单输入框的**填写格式真源**（2026-11-15 用户 m04642 ②）。
 *
 * ## 用户口径（逐字）
 * 「还有这个所有输入框的占位字符应该引导用户填单个或多个的格式不然用户不知道填什么
 *   列个表格出来对比一下」
 *
 * ## 为什么要有这个模块（⛔ 别把格式说明写回各个 placeholder 字符串）
 * 改前的问题不是"缺占位符"，而是**占位符与实际解析口径对不上**：
 *   · `tags` 提交时 `split(/[,，]/)` —— **只认逗号**；
 *   · `genres` / `cast` / `aliases` / `directorWriters` 提交时 `split(/[\/、,，]/)` —— 斜杠、顿号、逗号全认。
 *   于是「多个用逗号分隔」和「多个用 / 分隔」这两句话**同时存在**，用户按错那句填就静默丢数据。
 *   · 更糟的是 `platform`（单值）的占位符写成 `PC / Switch / PS5`，看着像可以填三个，
 *     实际 `platform.trim()` 整串存成**一个**平台名。
 *
 * ⇒ 这里把「单值 / 多值 / 分隔符 / 示例 / 是否可留空」定义成数据，
 *   占位符文案由 `placeholderOf()` **生成**，保证提示语和解析口径永远同源。
 *   ⚠️ 单测会反向核对各输入框的 `split(...)` 是否与本表一致（`tests/formPlaceholders.test.ts`）——
 *      以后谁改了提交侧的切分规则却没改这张表，会红。
 */

/** 输入框的取值形态 */
export type FieldArity = 'single' | 'multi';

/** 多值字段的分隔符口径 */
export type FieldSeparator = 'slash' | 'comma';

export interface FormFieldSpec {
    /** 字段键（与 `entryFormFields.ts` 的 key / `data-fld` 对齐，便于反查） */
    key: string;
    /** 中文标签（表格里展示用；真源仍是 `entryFormFields.ts`） */
    label: string;
    arity: FieldArity;
    /** 仅多值字段有意义 */
    sep?: FieldSeparator;
    /** 一句人话示例（表格的「示例」列） */
    example: string;
    /** 能否留空 */
    optional?: boolean;
    /** 特别容易被误填时的额外说明（表格的「注意」列） */
    note?: string;
    /**
     * 整句覆盖占位符（用于文案已被用户裁定锁死、不能按模板重写的字段）。
     *
     * ⚠️ 只有「这句话本身就是裁定结论」时才用 —— 例如「系列」框那句
     *    `同一系列的名称（留空不成组）`、「系列序号」框那句 `可留空，填整数（第几部 / 季）`，
     *    它们被 `assert-symbols.cjs` 逐字钉着，改成通用模板会破产物断言。
     * ⛔ 普通的「单值 / 多值」字段**一律走自动生成**，不要偷懒全写成覆盖。
     */
    placeholder?: string;
}

/**
 * 全部需要引导格式的输入框。
 *
 * ⚠️ 顺序 = 编辑表单里的视觉顺序（类型专属字段在前、通用字段在后），
 *    ⛔ 别按字母序重排 —— 这张表也是「表单长什么样」的文字版。
 */
export const FORM_FIELD_SPECS: readonly FormFieldSpec[] = [
    // ── 标题与来源 ──
    { key: 'title', label: '标题', arity: 'single', example: '流浪地球2', note: '必填' },
    { key: 'originalTitle', label: '原名', arity: 'single', example: 'The Wandering Earth II', optional: true },
    { key: 'sourceName', label: '来源', arity: 'single', example: '豆瓣', optional: true, note: '只填平台名，不要填网址' },
    { key: 'communityScore', label: '大众评分', arity: 'single', example: '7.9', optional: true, note: '支持「7 | 500」一口气写评分和人数' },
    { key: 'ratingCount', label: '评价人数', arity: 'single', example: '500', optional: true, note: '纯数字' },

    // ── 影视专属 ──
    {
        key: 'genres',
        label: '题材',
        arity: 'multi',
        sep: 'slash',
        example: '科幻 / 冒险 / 灾难',
        optional: true,
        note: '斜杠、顿号、逗号都能分隔',
    },
    { key: 'year', label: '年份', arity: 'single', example: '2023', optional: true, note: '四位数字' },
    {
        key: 'director',
        label: '导演 / 编剧',
        arity: 'multi',
        sep: 'slash',
        example: '郭帆 / 龚格尔',
        optional: true,
        note: '第一个当导演，其余都当编剧',
    },
    {
        key: 'cast',
        label: '主演',
        arity: 'multi',
        sep: 'slash',
        example: '吴京 / 刘德华 / 李雪健',
        optional: true,
        note: '斜杠、顿号、逗号都能分隔',
    },

    // ── 书籍三子类 ──
    // ⚠️ 同一个 `author` 字段在三种书籍子类下**示例完全不同**（出版物是作者、网文是作者、漫画是原作），
    //    所以拆成三个 key —— 共用 key 会让音乐条目的「作者」提示出现「如 刘慈欣」。
    { key: 'author', label: '作者', arity: 'single', example: '刘慈欣', optional: true },
    { key: 'book-author', label: '作者（出版书）', arity: 'single', example: '刘慈欣', optional: true },
    { key: 'novel-author', label: '作者（网文）', arity: 'single', example: '唐家三少', optional: true },
    { key: 'comic-author', label: '原作（漫画）', arity: 'single', example: '原作名', optional: true, note: '⛔ 只能填一个（斜杠会被当成名字的一部分）' },
    { key: 'comic-artist', label: '画师', arity: 'single', example: '作画者名', optional: true, note: '⛔ 只能填一个' },
    { key: 'publisher', label: '出版社', arity: 'single', example: '重庆出版社', optional: true },
    { key: 'isbn', label: 'ISBN', arity: 'single', example: '9787536692930', optional: true, note: '13 位数字' },
    { key: 'pageCount', label: '页数 / 章数 / 话数', arity: 'single', example: '320', optional: true, note: '纯数字，单位随书籍子类变' },

    // ── 游戏 ──
    {
        key: 'platform',
        label: '平台',
        arity: 'single',
        example: 'PC',
        optional: true,
        note: '⛔ 只能填一个平台；要写多个请分条或在简介里说明',
    },
    { key: 'developer', label: '开发商', arity: 'single', example: 'Mojang', optional: true },

    // ── 音乐 ──
    { key: 'music-author', label: '歌手 / 艺术家', arity: 'single', example: '周杰伦', optional: true },
    { key: 'album', label: '专辑', arity: 'single', example: '七里香', optional: true },

    // ── 通用分组字段 ──
    {
        key: 'series',
        label: '系列',
        arity: 'single',
        example: '三体',
        optional: true,
        note: '同名才会折叠成系列卡',
        // ⚠️ 这句被 `assert-symbols.cjs:10245` 正向逐字钉着（并附带「不许挂 list=/datalist」的反向守卫），
        //    ⇒ 保留原文案。语义上它已经把「单个 + 可留空 + 留空不成组」说全了。
        placeholder: '同一系列的名称（留空不成组）',
    },
    {
        key: 'series-index',
        label: '系列序号',
        arity: 'single',
        example: '2',
        optional: true,
        note: '整数，第几部 / 第几季',
        // ⚠️ 被 `assert-symbols.cjs:10755` 钉着 ——「填整数」是用户 2026-09-30 的裁定口径
        //    （「只能填整数不能填小数」），⛔ 别改回「支持小数」。
        placeholder: '可留空，填整数（第几部/季）',
    },
    { key: 'collection', label: '合集', arity: 'single', example: '马孔多宇宙', optional: true, note: '填了才会进合集视图' },
    {
        key: 'tags',
        label: '标签',
        arity: 'multi',
        sep: 'comma',
        example: '工作, 日常',
        optional: true,
        note: '⚠️ 只认逗号（斜杠会被当成标签名的一部分），决定词云与自定义视图',
    },
    { key: 'aliases', label: '又名', arity: 'multi', sep: 'slash', example: '流浪地球2 / 小破球2', optional: true },

    // ── 长文本 ──
    { key: 'summary', label: '简介', arity: 'single', example: '填写作品剧情简介…', optional: true, note: '多行文本' },
    { key: 'notes', label: '个人评语', arity: 'single', example: '一句话概括你的核心感受', optional: true, note: '多行文本' },
];

const SPEC_BY_KEY = new Map<string, FormFieldSpec>(FORM_FIELD_SPECS.map((s) => [s.key, s]));

/** 按 key 取规格（找不到返回 undefined，调用方可回退到自己的文案） */
export function formFieldSpec(key: string): FormFieldSpec | undefined {
    return SPEC_BY_KEY.get(key);
}

/** 分隔符的中文人话 */
export function separatorWord(sep: FieldSeparator | undefined): string {
    return sep === 'comma' ? '逗号' : '斜杠';
}

/** 多值字段的分隔符示例串 */
export function separatorSample(sep: FieldSeparator | undefined): string {
    return sep === 'comma' ? '，' : ' / ';
}

/**
 * 生成占位符文案。
 *
 * 口径：**先说是单个还是多个，再给例子** —— 用户看占位符只有 1 秒，
 * 第一眼必须能判断"我这栏该填一个还是几个"。
 *
 * ⚠️ 单值字段⛔ 不要在示例里塞分隔符（`PC / Switch / PS5` 就是这么把人骗了的）。
 */
export function placeholderOf(key: string, fallback = ''): string {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) return fallback;
    // 整句覆盖优先（见 `FormFieldSpec.placeholder` 的说明：只给被断言逐字钉死的那几个用）
    if (spec.placeholder) return spec.placeholder;
    if (spec.arity === 'multi') {
        const word = separatorWord(spec.sep);
        return `多个用${word}分隔，如 ${spec.example}`;
    }
    return spec.optional === false ? `如 ${spec.example}` : `如 ${spec.example}（单个）`;
}

/**
 * 生成「填法说明」长文案（表单里字段旁的小字提示 / 设置页文档用）。
 * 与 `placeholderOf` 分开：占位符要短，说明可以带约束。
 */
export function hintOf(key: string): string {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) return '';
    const parts: string[] = [];
    parts.push(spec.arity === 'multi' ? `可填多个，用${separatorWord(spec.sep)}分隔` : '只能填一个');
    parts.push(`如 ${spec.example}`);
    if (spec.optional) parts.push('可留空');
    if (spec.note) parts.push(spec.note);
    return parts.join(' · ');
}
