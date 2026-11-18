/**
 * 笔记内**插件专属条目卡**的纯逻辑层（🔴 2026-11-14 用户 m04138 指令）。
 *
 * ## 为什么要有这一层
 * 用户原话：「在笔记规划渲染出插件专属组件，因为笔记属性和表单两个可视化不对等的」。
 * 现状是两种**纯文本**：`data/noteGenerator.entryFrontmatter` 的 YAML + 一张手写的
 * `| 属性 | 内容 |` Markdown 表格；而表单侧 `views/components/EntryForm.svelte` 是约 40 个
 * 字段的真 GUI（可改、有控件、有分组）。两边信息量差一个数量级 —— 这就是「不对等」。
 *
 * ## 用户拍板的三条口径（2026-11-14 询问后确认，⛔ 别再自作主张）
 * ⑴ **挂载方式 = 代码块显式挂载**（```` ```reelludic ````），不做事后处理器自动识别 ——
 *    自动识别会改到用户已经习惯的存量笔记外观，且误伤面不可控。
 * ⑵ **形态 = 可交互**：点字段就地编辑并回写（不只是只读展示）。
 * ⑶ **与现有属性表格的关系 = 替换掉那张 Markdown 表格**。
 *
 * ## 本模块的边界
 * 纯函数、零 obsidian 依赖（`tests/noteCard.test.ts` 会钉住这一点）：
 * · `noteCardFenceOf` / `parseNoteCardSource` —— 代码块那一行 source 的编解码；
 * · `buildNoteCardGroups` —— 条目 → 分组 → 行的**只读投影**（渲染层照着画）；
 * · `applyNoteCardEdit` —— 行上的原始输入 → `Partial<MediaEntry>`（编辑层照这个回写）。
 *
 * ⚠️ 读投影（`buildNoteCardGroups`）与写映射（`applyNoteCardEdit`）**必须成对**：
 *    只加一边会出现「改完刷新变回原值」或「显示的与存下的不是同一个字段」。
 * ⚠️ 键名真源仍是 `pure/metaFields.META_FIELDS`（⛔ 别在这里另立一份键表）：
 *    本模块只负责「**取哪个值 / 写成什么**」，不负责定义有哪些键。
 */
import type { EntryType, MediaEntry } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { fieldAppliesTo, labelOf } from 'pure/metaFields';
import type { MediaStatus } from 'pure/status';
import { MEDIA_STATUSES, STATUS_LABELS, isMediaStatus } from 'pure/status';
import type { Rating } from 'pure/rating';
import { normalizeRating } from 'pure/rating';
import { MOODS, isMoodId, normalizeMood } from 'pure/mood';
import { musicArtistOf } from 'pure/musicArtist';
import { normalizeBookKind } from 'pure/bookKind';

/** 代码块语言名。⚠️ ⛔ 别用 `lrc` —— 那个已被内置播放器占用（`main.ts` 的 `registerLrcBlockProcessor`）。 */
export const NOTE_CARD_LANG = 'reelludic';

/**
 * 行控件形态（渲染层据此挑 Obsidian 原生控件）：
 * · `text` 单行文本 · `number` 数字 · `list` 逗号分隔列表 · `date` 日期文本
 * · `enum` 固定选项（`options` 必填）· `rating` 0–5 整数 · `readonly` 只读（派生值 / 结构性字段）
 */
export type NoteCardKind = 'text' | 'number' | 'list' | 'date' | 'enum' | 'rating' | 'readonly';

export interface NoteCardOption {
    value: string;
    label: string;
}

/** 一行 = 一个字段 */
export interface NoteCardRow {
    /** frontmatter 键名（= `META_FIELDS` 的 key） */
    key: string;
    /** 该类型下的中文名（走 `labelOf(key, type)`，音乐侧 `author` 会显示成「艺术家」） */
    label: string;
    kind: NoteCardKind;
    /** 当前的**展示值**（已格式化；`readonly` 行也照常给文本） */
    value: string;
    /** `kind === 'enum'` 时的选项 */
    options?: readonly NoteCardOption[];
    /** 悬停补充说明（`MetaField.note`；多行用 `\n`） */
    note?: string;
}

export interface NoteCardGroup {
    /** 分组键（稳定，⛔ 别用 label 当键 —— 文案会改） */
    key: string;
    label: string;
    rows: NoteCardRow[];
}

/**
 * 跨类型字段的**归组覆盖**：同一个 key 在不同类型下该落在哪个组。
 *
 * 🔴 用户 m01782 报障：「音乐类型笔记怎么渲染卡里有书籍的字段的？」
 *    根因不是漏筛 —— `author` 的 `appliesTo` 是 `['book', 'music']`（音乐侧
 *    经 `labelFor` 显示成「艺术家」），它被静态写在 `GROUP_DEFS` 的 **book 组**里。
 *    于是音乐卡渲染出一整块标题写着「书籍」、内容却是「艺术家」的区块。
 *    ⛔ 别用「把 author 从 book 组删掉」来修 —— 那会让**书籍卡也丢掉作者**。
 *    ⇒ 正确修法是按类型挪组：音乐侧 `author` 归音乐组，book 组在音乐上自然空掉、整组不渲染。
 *
 * ⚠️ 只登记**真的会跨类型**的键。新增时先问：这个 key 的 `appliesTo` 是不是多于一个类型？
 */
const TYPE_GROUP_MOVE: Partial<Record<EntryType, Readonly<Record<string, string>>>> = {
    music: { author: 'music' },
};

/**
 * 分组标题的**按类型覆盖**。
 *
 * `GROUP_DEFS` 的 label 是为「默认类型」写的（media 组叫「演职与规格」偏影视）。
 * 当某组在某个类型下承载的是另一套语义时，标题必须跟着类型变，否则用户看到的就是
 * 「音乐卡里长出『书籍』标题」那类错位。留空 = 用 `GROUP_DEFS` 的原文案。
 */
const TYPE_GROUP_LABEL: Partial<Record<EntryType, Readonly<Record<string, string>>>> = {
    // 目前没有语义漂移的组需要改名：`author` 挪进音乐组后，组名「音乐」已经正确。
    // 这里保留结构是为了下次出现「组名与内容不符」时有**唯一**的登记口。
};

/**
 * 分组定义。**顺序即渲染顺序**，`rows` 里没被 `fieldAppliesTo` 放行的字段自动消失，
 * 整组无行时整组不渲染（空标题比没有标题更丑）。
 *
 * ⚠️ 分组只是**版面**，不是数据约束：同一个键最多出现在一个组里（`tests/noteCard.test.ts` 会钉）。
 * ⚠️ 这里写的是**默认归组**；跨类型字段的实际归属见 `TYPE_GROUP_MOVE`（音乐侧 `author`）。
 */
const GROUP_DEFS: ReadonlyArray<{ key: string; label: string; keys: readonly string[] }> = [
    {
        key: 'basic',
        label: '基本信息',
        keys: ['type', 'year', 'status', 'rating', 'mood', 'tags', 'series', 'series_index', 'aliases'],
    },
    { key: 'dates', label: '日期', keys: ['planned_date', 'watched_date', 'created', 'updated'] },
    {
        key: 'media',
        label: '演职与规格',
        keys: ['director', 'screenwriter', 'cast', 'country', 'language', 'duration_min', 'producer', 'developer'],
    },
    /**
     * 进度
     * ⚠️ `progress_percent` 必须留在这里，⛔ 不能塞进「游戏」组 ——
     *    它的 `appliesTo` 是 `['tv', 'anime', 'game']`，放游戏组会让**影视条目也长出一个游戏组**，
     *    整卡凭空多一块只写着「进度百分比」的空标题（2026-11-14 写守卫时被自己的断言抓到的真 bug）。
     */
    {
        key: 'progress',
        label: '进度',
        keys: ['progress_season', 'progress_episode', 'progress_total_episodes', 'progress_percent'],
    },
    { key: 'game', label: '游戏', keys: ['platform', 'playtime_minutes'] },
    {
        key: 'book',
        label: '书籍',
        keys: [
            'author', 'artist', 'translator', 'publisher', 'isbn', 'binding', 'price',
            'reading_total_page', 'reading_page', 'read_minutes', 'page_count',
        ],
    },
    { key: 'music', label: '音乐', keys: ['album'] },
];

/**
 * 状态侧固定的四档（顺序 = `MEDIA_STATUSES` 的口径）。
 * ⚠️ 用 `MEDIA_STATUSES` 而不是 `Object.keys(STATUS_LABELS)`：后者的类型是 `string`，
 *    在 `Record<MediaStatus, …>` 上取索引会退化成 any（tsc 会报 TS7053）。
 */
const STATUS_OPTIONS: readonly NoteCardOption[] = MEDIA_STATUSES.map((s) => ({
    value: s,
    label: STATUS_LABELS[s],
}));

const MOOD_OPTIONS: readonly NoteCardOption[] = MOODS.map((m) => ({ value: m.id, label: `${m.emoji} ${m.label}` }));

/** 分隔符：列表类字段在行里用「、」拼接展示（与笔记属性表的历史口径一致，⛔ 别改成英文逗号） */
const LIST_SEP = '、';

/**
 * 列表 → 展示文本（**不截断**）。
 *
 * ⚠️ 与 `listClampText` 的分工见它下面的注释：`tags` / `genres` / `aliases` 这些
 *    **用户自己填的短列表**必须原样显示 —— 截掉就是「我填的东西不见了」。
 *    只有外部元数据灌进来的长名单（演职员）才走 `listClampText`。
 */
function listText(v: readonly string[] | undefined): string {
    return (v ?? []).filter((x) => !!x).join(LIST_SEP);
}

/**
 * 长列表字段在**卡片里**最多展开几项（🔴 2026-11-14 用户：「详情不要太多，演员等长字段要收紧」）。
 *
 * 病根：`cast` / `screenwriter` 这类字段在真实条目里动辄十几二十项（豆瓣「主演」就是全名单），
 * 原样铺开会让一张卡片里光是演员就吃掉七八行 —— 用户看的是「这条是什么」，不是演职员总表。
 *
 * 口径：前 `N` 项 + 「等 M 人」。⛔ **不是丢弃数据** —— 这只是展示投影，
 *  `applyNoteCardEdit` 回写时仍按整串（`splitList`）处理，源数据一个都不少。
 * ⚠️ `N` 取 6：竖排两栏后右侧详情宽度约 2/3 卡宽，6 个名字通常正好一到两行。
 */
const LIST_CLAMP = 6;

/**
 * 列表 → 展示文本：超过 `LIST_CLAMP` 就截断 + 尾注。
 *
 * ⚠️ 与 `listText` 分开而不是改它：`tags` / `aliases` 这类**短**列表不该被截断
 *    （用户自己填的几个标签，截掉就是「我填的东西不见了」）。
 *    只有演职员这类**外部元数据自动灌进来的长名单**才收紧。
 */
function listClampText(v: readonly string[] | undefined): string {
    const items = (v ?? []).filter((x) => !!x);
    if (items.length <= LIST_CLAMP) return items.join(LIST_SEP);
    return `${items.slice(0, LIST_CLAMP).join(LIST_SEP)} 等 ${items.length} 人`;
}

function numText(v: number | undefined, suffix = ''): string {
    return v === undefined || v === null ? '' : `${v}${suffix}`;
}

/**
 * 该键在当前类型下的行形态（**不含** `readonly` 判定 —— 那是 `isReadonlyKey` 的活，
 * 这里只管「用哪种控件画」）。
 */
function kindOf(key: string): NoteCardKind {
    switch (key) {
        case 'status':
        case 'mood':
            return 'enum';
        case 'rating':
            return 'rating';
        case 'genres':
        case 'tags':
        case 'aliases':
        case 'cast':
        case 'screenwriter':
            return 'list';
        case 'year':
        case 'series_index':
        case 'duration_min':
        case 'progress_season':
        case 'progress_episode':
        case 'progress_total_episodes':
        case 'playtime_minutes':
        case 'reading_total_page':
        case 'reading_page':
        case 'read_minutes':
        case 'page_count':
            return 'number';
        case 'planned_date':
        case 'watched_date':
            return 'date';
        default:
            return 'text';
    }
}

/**
 * 该键是否**只读**（渲染层画成纯文本，⛔ 不给输入框）。
 *
 * 🔴 判据必须与 `applyNoteCardEdit` 返回 `null` 的那批键**逐一对齐** ——
 *    否则会出现「给你一个可编辑的框、敲完告诉你不能改」，或者更糟：
 *    「读得出来、控件也给你了，但写不回去」（2026-11-14 成对性守卫抓到的 `created` 就是这个）。
 *    结构性/派生/自动维护的键在**投影阶段**就该标成只读，不能等到回写才拒绝。
 */
function isReadonlyKey(key: string): boolean {
    switch (key) {
        case 'type': // 条目类型不可在这儿改（换类型要走表单，会牵涉一堆字段迁移）
        case 'progress_percent': // 派生值，由 progress_* 算出
        case 'created': // 以下两个由 EntryService 自动维护（update 会刷 updatedAt）
        case 'updated':
            return true;
        default:
            return false;
    }
}

/**
 * 键 → 展示值。**只读投影的一半**，与 `applyNoteCardEdit` 严格成对。
 * 未登记的键返回空串（调用方决定是否整行丢弃）。
 */
function valueOf(entry: MediaEntry, key: string): string {
    switch (key) {
        case 'type':
            return ENTRY_TYPE_LABELS[entry.type] ?? entry.type;
        case 'year':
            return numText(entry.year);
        case 'status':
            return STATUS_LABELS[entry.status] ?? entry.status;
        case 'rating':
            return entry.rating ? String(entry.rating) : '';
        case 'mood':
            return entry.mood ?? '';
        case 'tags':
            return listText(entry.tags);
        case 'genres':
            return listText(entry.genres);
        case 'aliases':
            return listText(entry.aliases);
        case 'series':
            return entry.series ?? '';
        case 'series_index':
            return numText(entry.seriesIndex);
        case 'planned_date':
            return entry.plannedDate ?? '';
        case 'watched_date':
            return entry.watchedDate ?? '';
        case 'created':
            return entry.createdAt ?? '';
        case 'updated':
            return entry.updatedAt ?? '';
        case 'director':
            return entry.director ?? '';
        case 'screenwriter':
            // 🔴 收紧长名单（见 `LIST_CLAMP`）：编剧同样可能是长串，与主演一个口径
            return listClampText(entry.screenwriter);
        case 'cast':
            // 🔴 收紧长名单（见 `LIST_CLAMP`）：真实条目里主演动辄十几项
            return listClampText(entry.cast);
        case 'country':
            return entry.country ?? '';
        case 'language':
            return entry.language ?? '';
        case 'duration_min':
            return numText(entry.durationMin);
        case 'producer':
            return entry.producer ?? '';
        case 'developer':
            return entry.developer ?? '';
        case 'progress_season':
            return numText(entry.progress?.season);
        case 'progress_episode':
            return numText(entry.progress?.episode);
        case 'progress_total_episodes':
            return numText(entry.progress?.totalEpisodes);
        case 'progress_percent':
            return '';
        case 'platform':
            return entry.platform ?? '';
        case 'playtime_minutes':
            return numText(entry.playtimeMinutes);
        // 🔴 音乐歌手在 `author`（艺术家），`artist` 是**漫画画师** ——
        //    判据走 `pure/musicArtist.musicArtistOf` 唯一真源，⛔ 别直接读 `entry.artist`（2026-11-14 bug 的根因）。
        case 'author':
            return entry.type === 'music' ? musicArtistOf(entry) : (entry.author ?? '');
        case 'artist':
            return entry.artist ?? '';
        case 'translator':
            return entry.translator ?? '';
        case 'publisher':
            return entry.publisher ?? '';
        case 'isbn':
            return entry.isbn ?? '';
        case 'binding':
            return entry.binding ?? '';
        case 'price':
            return entry.price ?? '';
        case 'reading_total_page':
            return numText(entry.readingProgress?.totalPage);
        case 'reading_page':
            return numText(entry.readingProgress?.page);
        case 'read_minutes':
            return numText(entry.readMinutes);
        case 'page_count':
            return numText(entry.pageCount);
        case 'album':
            return entry.album ?? '';
        default:
            return '';
    }
}

/**
 * 书籍子分类（文学 / 网文 / 漫画）的**标签对等**，与表单 `EntryForm.svelte` 逐字一致。
 *
 * 🔴🔴 2026-11-14 用户 m04138 的病根就在这儿：用户说「笔记属性和表单两个可视化不对等的」——
 *    表单侧同一个字段按 `bookKind` 换名，旧属性表也换（`上架年` / `章数` / `话数` / `丛书`），
 *    但卡片如果只走 `labelOf(key, type)`（它只认 `type`，`book` 一个口径），
 *    网文的 `year` 就会显示成「年份」、`pageCount` 显示成「页数」、漫画显示成「页数」——
 *    **比旧表格更不对等**。所以这里按 `bookKind` 再让一层，⛔ 别删这几条去「简化」。
 *
 * 与表单的对应关系（`src/views/components/EntryForm.svelte`）：
 *   · `novel-year`「上架年」/ `novel-chapters`「元数据章数」—— 网文专用框
 *   · `comic-chapters`「总话数」—— 漫画专用框
 *   · `book` 的 `series` 在文学侧叫「丛书」（#434 已记这是**已知不对称**，本批不翻面）
 */
function bookKindLabelOf(key: string, entry: MediaEntry): string | undefined {
    if (entry.type !== 'book') return undefined;
    const kind = normalizeBookKind(entry.bookKind);
    if (key === 'year') return kind === 'novel' ? '上架年' : '年份';
    if (key === 'page_count') {
        if (kind === 'comic') return '话数';
        if (kind === 'novel') return '章数';
        return '页数';
    }
    if (key === 'series') return kind === 'novel' ? '系列' : '丛书';
    return undefined;
}

/**
 * 🔴 **某类型在该卡上要额外摘掉的键**（1.5.0 期 ④，用户 2026-11-17 指令）。
 *
 * 用户原话：「编辑渲染条目卡删除影视下的『出品方』字段（搜索添加的条目都没有该字段回填）」。
 *
 * ## 为什么必须在这里再摘一道，而不是改 `metaFields.ts` 的 `appliesTo`
 * · 根因：编辑表单里**根本没有出品方的输入框** —— `EntryForm.svelte` 只有
 *   `let producer = entry?.producer ?? ''`（1240）与提交 `input.producer = producer.trim() || undefined`（4179），
 *   模板里没有任何 `bind:value={producer}` 的框。唯一能写它的入口是豆瓣**书籍**回填
 *   （`services/douban.ts:568` 的 `pick('出品方')`）。所以影视条目的这一行**永远只显示「—」**。
 * · `metaFields.ts:175` 的 `appliesTo: ['movie','tv','game']` 被 5 处共用
 *   （`pure/tableColumns.ts:75` 表格列 / `pure/fieldOrder.ts:133` 字段排序 /
 *   `pure/fieldOrderCompare.ts:136` / `Settings.ts:5606` 设置页 / `pure/noteCard.ts:360`）。
 *   改那张表会连带把**表格列**和**字段排序设置**里的出品方一起删掉 —— 面太大，⛔ 别动。
 *   ⇒ 只在**这张卡**上摘，副作用面锁死在本模块。
 *
 * ⚠️ `game` 不摘：游戏侧那条是真实存在的（`appliesTo` 里本来就有 game），用户只说「影视下的」。
 * ⚠️ `anime` 不摘：`appliesTo` 本来就没有 anime（动画那列只有「制作公司」，见 `metaFields.ts:174` 的注释）。
 * ⚠️ 摘的只是**投影**：`valueOf` / `applyNoteCardEdit` 里 `producer` 那一支**照旧保留** ——
 *    游戏与书籍仍走同一条读写路径，⛔ 别顺手把它们也删了（那会让游戏条目也丢字段）。
 */
const TYPE_EXCLUDED_KEYS: Partial<Record<EntryType, readonly string[]>> = {
    movie: ['producer'],
    tv: ['producer'],
};

/**
 * 条目 → 分组行（只读投影）。空值行**照样出**（编辑态要能点进去填空，
 * 只读态由渲染层把空值压暗 —— ⛔ 别在这里提前过滤，那会让「想填就填不到」）。
 */
export function buildNoteCardGroups(entry: MediaEntry): NoteCardGroup[] {
    const excluded = TYPE_EXCLUDED_KEYS[entry.type];
    const move = TYPE_GROUP_MOVE[entry.type];
    const labelOverride = TYPE_GROUP_LABEL[entry.type];
    const out: NoteCardGroup[] = [];
    for (const g of GROUP_DEFS) {
        const rows: NoteCardRow[] = [];
        // 🔴 **移入侧**：被 `TYPE_GROUP_MOVE` 指到本组的键要真的出现在这里。
        //    只在源组做 `continue` 过滤是不够的 —— 那等于把字段从卡上删掉，
        //    用户会看到「艺术家」凭空消失（比「书籍」标题错位更糟）。
        //    ⚠️ 不能把键直接写进 `GROUP_DEFS` 的两组里：那会撞
        //    `tests/noteCard.test.ts` 的「同一个键最多出现在一个组」守卫。
        const incoming = move
            ? Object.keys(move).filter((k) => move[k] === g.key && !g.keys.includes(k))
            : [];
        for (const key of [...g.keys, ...incoming]) {
            // `fieldAppliesTo` 缺省放行；只有登记了 `appliesTo` 的键才按类型过滤
            if (!fieldAppliesTo(key, entry.type)) continue;
            // 类型级额外摘除（见 `TYPE_EXCLUDED_KEYS` 的注释：影视不出品方）
            if (excluded?.includes(key)) continue;
            // 🔴 跨类型字段按类型挪组（见 `TYPE_GROUP_MOVE`）：音乐侧的 `author`
            //    该出现在「音乐」组里，⛔ 不能留在「书籍」组 —— 那就是用户 m01782
            //    报的「音乐卡里有书籍字段」。挪走后 book 组在音乐上自然空掉、整组不渲染。
            if (move?.[key] !== undefined && move[key] !== g.key) continue;
            // 🔴 先按书籍子分类换名（上架年/章数/话数/丛书），再回落 `labelOf`（音乐 author → 艺术家等）
            const label = bookKindLabelOf(key, entry) ?? labelOf(key, entry.type);
            // 只读键在投影阶段就定死（⛔ 不给输入框），与 `applyNoteCardEdit` 的 null 口径成对
            const kind: NoteCardKind = isReadonlyKey(key) ? 'readonly' : kindOf(key);
            const row: NoteCardRow = { key, label, kind, value: valueOf(entry, key) };
            if (kind === 'enum') {
                row.options = key === 'status' ? STATUS_OPTIONS : key === 'mood' ? MOOD_OPTIONS : [];
            }
            const mdNote = metaNoteOf(key);
            if (mdNote) row.note = mdNote;
            rows.push(row);
        }
        // 组标题按类型覆盖（见 `TYPE_GROUP_LABEL`）：某组在某类型下换了语义时，
        // ⛔ 不能让用户看见「音乐卡里长出书籍标题」那类错位。
        if (rows.length) out.push({ key: g.key, label: labelOverride?.[g.key] ?? g.label, rows });
    }
    return out;
}

/** `MetaField.note` 的取值（延迟 import 会破坏纯层可测性，直接静态取一遍更简单） */
function metaNoteOf(key: string): string | undefined {
    // 只挑真正需要提示的那几条（把 249 行整表搬过来没必要）
    switch (key) {
        case 'mood':
            return '六档：🤩 震撼 / 🥰 治愈 / 🤔 烧脑 / 😭 致郁 / 😴 无聊 / 🤬 受罪';
        case 'artist':
            return '画师（漫画的作画）；音乐歌手在「艺术家」那一行';
        case 'author':
            return undefined;
        case 'progress_percent':
            return '派生值，由进度字段算出';
        case 'series_index':
            return '只在填了「系列」时生效';
        default:
            return undefined;
    }
}

function splitList(raw: string): string[] {
    return raw
        .split(/[、,，]/)
        .map((s) => s.trim())
        .filter((s) => !!s);
}

function parseNum(raw: string): number | undefined {
    const t = raw.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * 行上的原始输入 → `Partial<MediaEntry>`（**写映射**，与 `valueOf` 严格成对）。
 *
 * 返回 `null` = 这个键**不可写**（结构性 / 派生值），调用方直接拒绝并提示。
 *
 * 🔴 清空语义：文本 / 列表 / 日期类清空 ⇒ 写 `undefined`（真的删掉），
 *    与 `pure/noteEditable` 的既有口径一致（「删掉序号」必须能在笔记里删掉）。
 */
export function applyNoteCardEdit(entry: MediaEntry, key: string, raw: string): Partial<MediaEntry> | null {
    const v = raw.trim();
    const opt = (s: string): string | undefined => (s ? s : undefined);
    switch (key) {
        case 'title':
            // 标题不在分组行里（它在卡片头部），但仍然是「点一下就能改」的字段
            return v ? { title: v } : null;
        case 'notes':
            return { notes: v };
        case 'type':
        case 'progress_percent':
            return null;
        case 'year': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { year: n };
        }
        case 'status': {
            // 🔴 回显是中文标签（「在看」），回写必须同时认 id（`watching`）与标签 ——
            //    否则「读得出来却写不回去」，用户一改状态就被拒绝（2026-11-14 成对性守卫抓到的真 bug）。
            const byId = isMediaStatus(v) ? v : undefined;
            const byLabel = byId ?? MEDIA_STATUSES.find((s) => STATUS_LABELS[s] === v || s === v);
            return byLabel ? { status: byLabel } : null;
        }
        case 'rating': {
            // 合法档位是 0 / 0.5 / … / 5（`Rating` 是 11 个字面量的联合类型）。
            // 🔴 走 `normalizeRating`（四舍五入到最近 0.5 档），⛔ 别 `Math.round` —— 那会把 3.5 变成 4。
            if (!v) return { rating: 0 as Rating };
            const n = parseNum(v);
            if (n === undefined || n < 0 || n > 5) return null;
            return { rating: normalizeRating(n) };
        }
        case 'mood': {
            const m = normalizeMood(v);
            return m ? { mood: m } : { mood: undefined };
        }
        case 'tags':
            return { tags: splitList(v) };
        case 'genres':
            return { genres: splitList(v) };
        case 'aliases':
            return { aliases: splitList(v).length ? splitList(v) : undefined };
        case 'series':
            return { series: opt(v) };
        case 'series_index': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { seriesIndex: n };
        }
        case 'planned_date':
            return { plannedDate: opt(v) };
        case 'watched_date':
            return { watchedDate: opt(v) };
        case 'created':
        case 'updated':
            // 这两键由 `EntryService` 自己维护（update 会自动刷 updatedAt），⛔ 不在这儿手改
            return null;
        case 'director':
            return { director: opt(v) };
        case 'screenwriter':
            return { screenwriter: splitList(v).length ? splitList(v) : undefined };
        case 'cast':
            return { cast: splitList(v) };
        case 'country':
            return { country: opt(v) };
        case 'language':
            return { language: opt(v) };
        case 'duration_min': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { durationMin: n };
        }
        case 'producer':
            return { producer: opt(v) };
        case 'developer':
            return { developer: opt(v) };
        case 'progress_season':
        case 'progress_episode':
        case 'progress_total_episodes': {
            const n = parseNum(v);
            // 进度三键合成同一个 `Progress` 对象；`history` 必须原样带上，⛔ 否则追更历史会被清空
            const base = entry.progress ?? { season: 1, episode: 0, history: [] };
            const next = { ...base };
            if (key === 'progress_season') next.season = n ?? 1;
            else if (key === 'progress_episode') next.episode = n ?? 0;
            else next.totalEpisodes = n;
            return { progress: next };
        }
        case 'platform':
            return { platform: opt(v) };
        case 'playtime_minutes': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { playtimeMinutes: n };
        }
        case 'author':
            // 🔴 音乐侧写 `author`（= 艺术家），⛔ 绝不写 `artist`（那是画师）
            return { author: opt(v) };
        case 'artist':
            return { artist: opt(v) };
        case 'translator':
            return { translator: opt(v) };
        case 'publisher':
            return { publisher: opt(v) };
        case 'isbn':
            return { isbn: opt(v) };
        case 'binding':
            return { binding: opt(v) };
        case 'price':
            return { price: opt(v) };
        case 'reading_total_page':
        case 'reading_page': {
            const n = parseNum(v);
            const base = entry.readingProgress ?? {};
            const next = { ...base };
            if (key === 'reading_page') next.page = n ?? 0;
            else next.totalPage = n ?? 0;
            // 百分比随之重算（阅读器与书架进度条都读它，⛔ 别留旧值）。
            // ⚠️ 三键都是可选的（`{ page?; totalPage?; percent? }`），判零前必须先取默认值。
            const page = next.page ?? 0;
            const totalPage = next.totalPage ?? 0;
            next.percent = totalPage > 0 ? Math.round((page / totalPage) * 100) : 0;
            return { readingProgress: next };
        }
        case 'read_minutes': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { readMinutes: n };
        }
        case 'page_count': {
            const n = parseNum(v);
            if (v && n === undefined) return null;
            return { pageCount: n };
        }
        case 'album':
            return { album: opt(v) };
        default:
            return null;
    }
}

/**
 * 代码块 source：**只有一行 id**（最小信息面）。
 * ⚠️ 不把整份 frontmatter 抄进 source —— 那会和 YAML 形成两份真源，谁先改谁赢，
 *    正是本仓反复踩的「双写脏数据」。id 是稳定主键，属性一律从 catalog 现取。
 */
export function noteCardSourceOf(id: string): string {
    return id.trim();
}

/** 从代码块 source 里取条目 id；解析不出来返回 `null`（渲染层据此画空态，⛔ 别静默当空条目） */
export function parseNoteCardSource(source: string): string | null {
    for (const raw of source.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // 兼容手写的 `id: xxx` 形态（用户可能照着别处的写法改）
        const kv = /^id\s*[:=]\s*(.+)$/i.exec(line);
        const val = (kv ? kv[1] : line).trim().replace(/^["']|["']$/g, '');
        if (val) return val;
    }
    return null;
}

/**
 * 完整围栏（含 ``` 行）。`noteGenerator` 用它替换掉旧的那张 Markdown 属性表。
 * @param id 条目 id
 */
export function noteCardFenceOf(id: string): string {
    return ['```' + NOTE_CARD_LANG, noteCardSourceOf(id), '```'].join('\n');
}

/**
 * 是否「这个类型有值得进卡片的东西」—— 决定 `noteGenerator` 要不要写这一块。
 * 目前六类都有（`basic` 组的 `type/status/rating` 恒命中），留着是为了将来收窄时
 * 有个明确落点，而不是在 `noteGenerator` 里散着判。
 */
export function hasNoteCard(entry: MediaEntry): boolean {
    return buildNoteCardGroups(entry).length > 0;
}

/** 该行的值是否为空（渲染层据此压暗占位，⛔ 不影响可编辑性） */
export function isNoteCardRowEmpty(row: NoteCardRow): boolean {
    return row.value.trim() === '';
}

/** 条目类型的展示名（渲染层标题行用） */
export function noteCardTypeLabel(type: EntryType): string {
    return ENTRY_TYPE_LABELS[type] ?? type;
}

/** 心情 id → 选项（渲染层回显当前选中项；非法值给空串） */
export function moodOptionValue(mood: string | undefined): string {
    return isMoodId(mood) ? mood : '';
}
