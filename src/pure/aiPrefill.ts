// AI 预填 —— 新增条目「手动填写」界面的字段自动补全（纯逻辑，无 obsidian 依赖，可单测）。
//
// 责任：① 定义「每个条目类型要问 AI 哪些字段」（**字段目录 = 真源**，同时供设置提示词与预览行使用）；
//      ② 构造 chat/completions 请求体（prompt 设计在此，用户可在设置页改写 system 段）；
//      ③ 解析模型返回的 JSON（按字段目录白名单过滤 + 数字字段校验）；
//      ④ 把「AI 结果 + 表单当前值」合成**预览行**（旧值 / 新值各自一份）。
// 网络请求与 Key 注入由 services/aiPrefill.ts 完成。
//
// 🔴 设计口径（用户 2026-10-03 三问裁定）：
//   · 入口 = 标题行右侧 ✨（与「总结摘要 ✨」同款同位）；
//   · **先出预览、二次确认才回填** —— 预览逐行给「字段 · 旧值（删除线）· AI 值（灰字）」，
//     确认后**用 AI 值覆盖**它给出了值的字段（陈旧值被替掉的那一行最值得被看见）；
//   · 个人字段（状态 / 评分 / 笔记 / 阅读进度 / 本地音频 / 剧集关联）**一律不问、不填** ——
//     那些是用户的私人记录，模型无从得知，问它只会得到编造。
//
// ⚠️ 模型是「凭记忆回答」，不是检索：**必须允许它什么都不给**（默认 prompt 里那条「不确定就省略」
//    是这段逻辑的安全带）—— 少填一个字段，用户补一下就行；错填一个字段，用户得先发现它是错的。

import type { BookKind, EntryType } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
// 书籍子类显示名走真源（⛔ 别在这里写第二份「文学/网文/漫画」—— 同一概念只准一份文案）
import { BOOK_KIND_LABELS } from 'pure/bookKind';
import { resolveModel, type AiChatMessage, type AiToolDef, type TranslateProvider, type TranslateRequestBody } from 'pure/translate';
import { parseAiJsonObject } from 'pure/aiJson';

/**
 * 可预填字段的键（= 组件里那个表单变量的语义名，⛔ 不是变量名 —— 映射在组件侧一处收敛）。
 * ⚠️ 只收**表单里真有可见输入框**的字段：`country` / `originalTitle` / `language` / `durationMin` /
 *    `aliases` 这几个虽然也在条目里，但**表单里没有输入口**（只有搜索回填能写）——
 *    预填它们 = 预览里看得见、字段区里找不到、下次编辑也改不了，是纯粹的暗写。
 */
export type PrefillFieldKey =
    | 'year'
    | 'genres'
    | 'tags'
    | 'author'
    | 'artist'
    | 'publisher'
    | 'pageCount'
    | 'isbn'
    | 'authorIntro'
    | 'toc'
    | 'summary'
    | 'directorWriters'
    | 'cast'
    | 'totalEpisodes'
    | 'platform'
    | 'developer'
    | 'album';

export interface PrefillFieldDef {
    key: PrefillFieldKey;
    /** 预览行里的字段名（= 表单标签） */
    label: string;
    /** 喂给模型的字段说明（写进 user message 的字段清单） */
    hint: string;
}

/** 数字类字段：解析时按数字校验（模型爱把「2024年」连单位一起写） */
const NUMERIC_KEYS: ReadonlySet<PrefillFieldKey> = new Set(['year', 'pageCount', 'totalEpisodes', 'isbn']);

/** 各字段的落库长度硬上限（防病态输出把整篇塞进一个框；非「建议值」，是解析侧的安全阀） */
const MAX_CHARS: Readonly<Record<PrefillFieldKey, number>> = {
    year: 4,
    genres: 60,
    tags: 120,
    author: 80,
    artist: 80,
    publisher: 80,
    pageCount: 8,
    isbn: 20,
    authorIntro: 300,
    toc: 800,
    summary: 800,
    directorWriters: 120,
    cast: 120,
    totalEpisodes: 8,
    platform: 60,
    developer: 80,
    album: 80,
};

/**
 * 🔴 #499E 简介的字段口径（用户 2026-10-03：「预填的不是简介怎么是客观概述，**不应该是搜索照搬
 * 真正作品的简介吗**」）—— 从「模型自己写 2~4 句」改成「**工具查到原文就照抄**，查不到才凭记忆写」。
 * 照抄那一步在服务侧由 `preferToolSynopsis` **强制**执行（⛔ 不指望模型自觉 —— 实测它会顺手润色）。
 */
const SUMMARY_DEF: PrefillFieldDef = {
    key: 'summary',
    label: '简介',
    hint: '作品简介原文：工具结果里给了「简介原文」就照抄（一字不改）；⛔ 没给就**留空**，不要自己写',
};

/**
 * 🔴 m09330（用户 2026-11-18：「增加每个类型条目编辑属性表单AI预填可填的框」，点名要「标签」）：
 * 六类型通用的「标签」字段。
 *
 * ⚠️ 分隔符口径**必须与表单一致**：`src/pure/formFields.ts` 里 `tags` 的 `sep` 是 `'comma'`
 *    （note 逐字「⚠️ 只认逗号（斜杠会被当成标签名的一部分）」）。所以这里的 hint 说「用逗号分隔」，
 *    ⛔ 别跟着题材 / 主演写成「用 / 分隔」—— 那样填出来的标签会连斜杠一起变成标签名。
 */
const TAGS_DEF: PrefillFieldDef = {
    key: 'tags',
    label: '标签',
    hint: '给这条内容打的个人标签，多个**用逗号分隔**（如 周末, 睡前）',
};

/** 影视（电影 / 电视剧 / 动画）三类的字段几乎同构，只有「总集数」和「主演」的标签不同 */
function screenDefs(type: EntryType): PrefillFieldDef[] {
    const defs: PrefillFieldDef[] = [
        { key: 'genres', label: '题材', hint: '作品题材，多个用 / 分隔' },
        TAGS_DEF,
        { key: 'year', label: type === 'movie' ? '上映年' : '首播年', hint: '首映年份，只写 4 位数字' },
        { key: 'directorWriters', label: '导演', hint: '导演，多个用 / 分隔（如确信也可附上编剧）' },
        { key: 'cast', label: type === 'anime' ? '主演（声优）' : '主演', hint: '主要演员，多个用 / 分隔' },
    ];
    if (type !== 'movie') defs.push({ key: 'totalEpisodes', label: '总集数', hint: '总集数，只写数字' });
    defs.push(SUMMARY_DEF);
    return defs;
}

/**
 * 该类型（书籍再按 `bookKind` 细分）要问 AI 的字段清单 —— **顺序与表单里的排布一致**（预览行跟着表单走）。
 * 🔴 这是「哪些字段可预填」的**唯一真源**：设置页的提示词说明、请求体里的字段清单、解析白名单、
 *    预览行，四处都从这里取，⛔ 别在别处再列一遍。
 */
export function prefillFieldsFor(type: EntryType, bookKind?: BookKind): PrefillFieldDef[] {
    if (type === 'book') {
        if (bookKind === 'novel') {
            return [
                { key: 'year', label: '上架年', hint: '开始连载 / 上架的年份，只写 4 位数字' },
                { key: 'author', label: '作者', hint: '作者名，多个用 / 分隔' },
                { key: 'genres', label: '题材', hint: '作品题材，多个用 / 分隔' },
                TAGS_DEF,
                { key: 'pageCount', label: '元数据章数', hint: '总章节数，只写数字' },
                SUMMARY_DEF,
                { key: 'authorIntro', label: '作者简介', hint: '作者介绍，中文 1~3 句' },
                { key: 'toc', label: '目录', hint: '主要章节名，每行一项（不确定就别给）' },
            ];
        }
        if (bookKind === 'comic') {
            return [
                { key: 'year', label: '出版年', hint: '出版年份，只写 4 位数字' },
                { key: 'publisher', label: '出版社', hint: '出版社名' },
                { key: 'author', label: '作者', hint: '原作 / 编剧，多个用 / 分隔' },
                { key: 'genres', label: '题材', hint: '作品题材，多个用 / 分隔' },
                TAGS_DEF,
                { key: 'artist', label: '画师', hint: '作画，多个用 / 分隔' },
                { key: 'pageCount', label: '总话数', hint: '总话数，只写数字' },
                SUMMARY_DEF,
            ];
        }
        return [
            { key: 'year', label: '出版年', hint: '出版年份，只写 4 位数字' },
            { key: 'publisher', label: '出版社', hint: '出版社名' },
            { key: 'author', label: '作者', hint: '作者名，多个用 / 分隔' },
            { key: 'genres', label: '题材', hint: '作品题材，多个用 / 分隔' },
            TAGS_DEF,
            { key: 'isbn', label: 'ISBN', hint: 'ISBN 号，只写数字（如 9787536692930）' },
            { key: 'pageCount', label: '元数据页数', hint: '总页数，只写数字' },
            SUMMARY_DEF,
            { key: 'authorIntro', label: '作者简介', hint: '作者介绍，中文 1~3 句' },
            { key: 'toc', label: '目录', hint: '主要章节名，每行一项（不确定就别给）' },
        ];
    }
    if (type === 'movie' || type === 'tv' || type === 'anime') return screenDefs(type);
    if (type === 'game') {
        return [
            { key: 'genres', label: '题材', hint: '游戏题材 / 类型，多个用 / 分隔' },
            TAGS_DEF,
            { key: 'year', label: '发行年', hint: '发行年份，只写 4 位数字' },
            { key: 'platform', label: '平台', hint: '支持平台，如 PC / Switch / PS5' },
            { key: 'developer', label: '开发商', hint: '开发 / 制作公司' },
            SUMMARY_DEF,
        ];
    }
    // music
    return [
        { key: 'author', label: '作者', hint: '歌手 / 艺术家' },
        { key: 'album', label: '专辑', hint: '所属专辑名' },
        { key: 'genres', label: '题材', hint: '音乐风格，多个用 / 分隔' },
        TAGS_DEF,
        { key: 'year', label: '发行年', hint: '发行年份，只写 4 位数字' },
        SUMMARY_DEF,
    ];
}

/**
 * 🔴 m15796 工具结果里**题材原文**的行首标记（生产端 = 宿主 `runPrefillTool`，消费端 = 服务层共用）。
 *
 * 为什么要有它（用户 2026-11-19：「这个也要搜索能该条目的题材、标签」）：
 * 各数据源其实都带题材（豆瓣 `类型`/`流派`、Google Books `categories`、OpenLibrary `subject`、
 * Steam / IGDB / Bangumi / AniList / TMDB 的 `genres`），但 `lookup_metadata` 交给模型的文本
 * 原先只拼 标题/年份/来源/评分/副标题 ⇒ **模型在文本里根本看不见题材**，只能凭印象写。
 *
 * 形态：独占一行，值是 ` / ` 连接的题材串（与表单「题材」框的分隔符一致）。
 * ⛔ 与 `PREFILL_SYNOPSIS_PREFIX` 一样，两端必须共用一个常量 —— 各写一份就会静默失联。
 *
 * ⚠️ 声明位置必须在 `DEFAULT_PREFILL_PROMPT` **之前**：提示词里直接引用了它
 *    （`const` 有 TDZ，写在后面会报 `TS2448: used before its declaration`）。
 */
export const PREFILL_GENRES_PREFIX = '题材原文：';

/**
 * 默认 system 提示词（设置页「AI集成 › 用途 · 预填服务」可改写；留空/改回默认即用本串）。
 * 设计要点：**允许省略**（⛔ 不许编造）、统一分隔符、只输出 JSON —— 三条都是为了解析侧稳定。
 */
export const DEFAULT_PREFILL_PROMPT =
    '你在为个人影音书游收藏库补全条目资料。根据用户给出的作品信息，填写他列出的字段。\n' +
    '· 只填写你确有把握的内容；**不确定的字段直接省略**（不要给空串，不要猜，不要编造人名与数字）。\n' +
    '· 年份只写 4 位数字；页数 / 章数 / 集数 / ISBN 只写数字；其余均为字符串。\n' +
    '· 多个同类值之间用「 / 」分隔（题材、主演、导演等）；**标签用逗号分隔**（标签名里的斜杠要保留）。\n' +
    // 🔴🔴 m15532（用户 2026-11-19：「AI预填的GLM4-flash模型搜索怎么只依据元数据源搜索的，
    //    要依据网络权威搜索啊」）——根因是**提示词压根没提网络搜索**：下面那段只点了
    //    `lookup_metadata`（本地配置的元数据源）与 `fetch_page`，模型自然先去查本地元数据源，
    //    而本地源的搜索级记录常常只有标题与年份（简介/题材常年缺失）⇒ 看起来就是「只依据元数据源」。
    //    ⇒ 现在把**联网检索放到第一位**，并写清三级顺序与各自职责：⛔ 别把这条顺序改回去。
    '· 🔴 **先联网查权威来源，别只查本地元数据源**：\n' +
    // 🔴 m15532 第二层真因（2026-11-19 实测）：搜索引擎对「含空格的中文多段查询」会**逐字拆词**
    //    （`七里香 周杰伦 简介` ⇒ 返回「七（汉语汉字）」），只有**单段作品名**才拿到正确条目页。
    //    ⇒ 提示词必须直接教「就用作品名搜一段」，⛔ 别写成「作品名 + 修饰词」那种会被拆掉的形式。
    '  ① `web_search` —— **查询词只写作品名本身**（如「七里香」「名侦探柯南」「艾尔登法环」），' +
    '⛔ 别拼「作品名 + 简介/豆瓣/年份」这种多段词——搜索引擎会把中文多段查询拆成单个字，' +
    '拿回来全是字典页；拿到结果后从**链接**里挑权威条目页（豆瓣 / Bangumi / Wikipedia / IMDb / 官网 / 出版社页 / Steam 等）；\n' +
    '  ② `fetch_page` —— 把①里最权威的**条目页**抓下来读正文（记得带上 `title` 参数，工具会核对页面是不是这部作品）；\n' +
    '  ③ `lookup_metadata` —— 本地元数据源只当**交叉核对**（年份 / 原名 / 集数 / ISBN 这类硬事实），' +
    '⛔ 别把它当成唯一来源，也别因为本地源没有就停止查证。\n' +
    '  一轮没查到就**换个说法再搜**（换外文原名、换别名、换出版社/开发商名），别空手收工。\n' +
    '· 🔴 简介：**只照抄**工具结果里给出的「简介原文」（一字不改地搬过来，跨行的折成一行），' +
    '⛔ 不要缩写、不要润色、不要改写成自己的话。\n' +
    // 🔴 m15796（用户 2026-11-19：「这个也要搜索能该条目的题材、标签」）：
    //    题材原先在提示词里**一个字都没提** ⇒ 模型只能凭印象写（常把「小说」「电影」这种载体当题材）。
    //    现在明确三条来源与优先级，并写明「工具给了「题材原文：」就照抄」，⛔ 别退回「凭印象」。
    '· 🔴 题材：工具结果里给了以「' +
    PREFILL_GENRES_PREFIX +
    '」开头的行就**照抄那一行**（`/` 分隔，一字不改）；' +
    '没给就看 `lookup_metadata` 回报行里的「题材：…」，再没有才凭条目本身写；' +
    '⛔ 不要把「小说 / 电影 / 游戏」这种**载体**当题材，也不要写「其他」「未知」。\n' +
    '· 🔴🔴 **没有拿到「简介原文」就【绝不写简介】**：这个字段留空、直接从 JSON 里省掉。' +
    '⛔ 严禁凭记忆、凭印象、凭常识编一段——用户要的是作品原本的简介，编的等于错。' +
    '需要简介就先 `web_search` 找权威条目页、再 `fetch_page` 抓它的原文，' +
    '查到为止；实在查不到，就让这个字段空着。\n' +
    '· 只输出一个 JSON 对象（键就是用户列出的字段名），不要代码块标记，不要任何解释。';

export interface AiPrefillInput {
    type: EntryType;
    /** 书籍子分类（决定问哪一组字段；非书籍可不传） */
    bookKind?: BookKind;
    title: string;
    /** 已知线索（可选）：手填的年份 / 题材，帮模型定位同名的其它作品 */
    year?: number;
    genres?: string[];
    /**
     * 已知线索（可选）：手填的**作者 / 歌手 / 艺术家**（表单那个「作者」框）。
     * 🔴 #508（用户：「AI预填功能除了搜标题还要能一同并搜填在作者框的名称」）：
     *    带着它去搜能**把同名同姓的作品区分开**（这也是「作者框」这次要能一并填上」的前提之一）；
     *    留空也不影响 —— 那种情况下靠工具搜出来的作者填进去。
     */
    author?: string;
}

/** 请求体里字段清单的行格式：`字段名 —— 说明（几个字）`，让模型知道每个键该放什么 */
function fieldLines(defs: PrefillFieldDef[]): string {
    return defs.map((d) => `${d.key} —— ${d.label}：${d.hint}`).join('\n');
}

/**
 * 构造 AI 预填请求体；**标题为空 ⇒ null**（信息量为零，不该发请求 —— 与总结摘要同口径）。
 * system 段 = 用户提示词（可空，回落默认）；user 段 = 作品信息 + 本次要填的字段清单。
 * ⚠️ 字段清单**每次由目录现生成**，⛔ 不写死在提示词里 —— 用户改了提示词也不该把 schema 改坏。
 */
/**
 * 首轮消息：[system（用户可改写的提示词）, user（作品信息 + 字段清单）]。
 * 标题为空 / 字段目录为空 ⇒ null（信息量为零，不该发请求）。
 * ⚠️ 字段清单**每次由目录现生成**，⛔ 不写死在提示词里 —— 用户改了提示词也不该把 schema 改坏。
 * ⚠️ `withTools` 时在末尾补一句「可以调工具查资料」：**这句是代码拥有的**（不放进可改写的提示词里），
 *    否则用户改一次提示词就把工具用法丢了。
 */
export function prefillMessages(
    input: AiPrefillInput,
    prompt?: string,
    withTools = false,
): AiChatMessage[] | null {
    const title = input.title?.trim();
    if (!title) return null;

    const defs = prefillFieldsFor(input.type, input.bookKind);
    if (!defs.length) return null;

    // 书籍把子分类并进类型行（模型据此换一套字段语义）—— 显示名取真源 `BOOK_KIND_LABELS`
    const kindText = input.type === 'book' && input.bookKind ? `（${BOOK_KIND_LABELS[input.bookKind]}）` : '';
    const lines: string[] = [
        `类型：${ENTRY_TYPE_LABELS[input.type] ?? input.type}${kindText}`,
        `标题：${title}`,
    ];
    if (input.year) lines.push(`年份线索：${input.year}`);
    const genres = (input.genres ?? []).map((s) => s.trim()).filter(Boolean);
    if (genres.length) lines.push(`题材线索：${genres.join(' / ')}`);
    const clueAuthor = String(input.author ?? '').trim();
    if (clueAuthor) lines.push(`作者线索：${clueAuthor}`);
    lines.push('', '请填写下列字段（能确定几个就填几个）：', fieldLines(defs));
    if (withTools) {
        lines.push(
            '',
            '如果下面的字段你没有把握，可以先调用工具查一查（优先查证事实，别凭印象填）。',
            '🔴🔴 **「简介」这一格只认工具给的原文**：先 `lookup_metadata` 查元数据源；' +
                '那里没有原文，就用 `web_search` 搜到权威条目页（豆瓣 / Bangumi / 维基 / 官网），' +
                '再用 `fetch_page` 把页面正文抓回来照抄。' +
                '⛔ 查不到就把「简介」留空（从 JSON 里省掉），**绝对不许自己编一段**——' +
                '用户要的是作品原本的简介，编出来的等于错。',
        );
        // 🔴 #508（用户：「AI预填功能除了搜标题还要能一同并搜填在作者框的名称」）：
        //    这句是**代码拥有的**（⛔ 不放进设置页那条可改写的提示词里）——
        //    「默认提示词说『不确定就省略』」+「工具指令说『可以先查』」合起来，模型很容易
        //    跳过**人名字段**（作者 / 歌手 / 导演 / 开发商）：它觉得不确定就整条省了。
        //    ⇒ 这里明确点名：**人名也是要填的字段之一**，并且给出该用什么样的搜索词去找。
        const personKeys = defs
            .filter((d) => ['author', 'artist', 'developer', 'directorWriters'].includes(d.key))
            .map((d) => d.label);
        if (personKeys.length) {
            lines.push(
                `🔴 特别注意：本次要填的字段里有**人的名字**（${personKeys.join(' / ')}）—— `
                    + '这是本次的重点之一。请**先搜一次**再判断：搜索词用「作品名 + '
                    + personKeys.join('/') + '」（例如「沙丘 导演」「晴天 歌手」），'
                    + '查到就以工具结果为准填上；⛔ 别因为「一时想不起来」就把这一格留空。',
            );
        }
    }

    return [
        { role: 'system', content: prompt?.trim() || DEFAULT_PREFILL_PROMPT },
        { role: 'user', content: lines.join('\n') },
    ];
}

/** 任意一轮的请求体（工具回路从第 2 轮起直接复用消息数组） */
export function buildPrefillRequest(
    messages: AiChatMessage[],
    provider?: TranslateProvider,
    model?: string,
    tools?: AiToolDef[],
): TranslateRequestBody {
    return {
        model: resolveModel(provider, model),
        messages,
        stream: false,
        ...(tools && tools.length ? { tools } : {}),
    };
}

// ──────────── #499D agent 工具回路（用户：「能不能做 agent 调用 tools 或者 skills 搜索」）────────────
//
// 🔴 实测（2026-10-03）：`tools:[{type:'function'}]` ⇒ 智谱 `GLM-4-Flash` 与 DeepSeek 都**真的吐 `tool_calls`**，
//    回传 `assistant(tool_calls)` + `role:'tool'` 后第 2 轮能**干净收尾成 JSON**（`_probe_loop_499e.cjs`）；
//    但**自定义端点不保证**（那条 91hub 把 tools 吞了、直接裸答）⇒ 调用方必须有回落。

/** 工具名：查本库的元数据源（宿主已实现，复用现成客户端） */
export const PREFILL_TOOL_METADATA = 'lookup_metadata';
/** 工具名：联网搜索（必应 RSS，免费无需 Key） */
export const PREFILL_TOOL_WEB_SEARCH = 'web_search';
/**
 * 工具名：抓取一个**权威页面**的正文（🔴 m09330 新增）。
 *
 * 为什么必须有它：`web_search` 走必应 RSS，每条结果**只有标题 + 两行摘要**
 * （`pure/bingSearch` 的 `parseBingRss`），里面从来没有作品简介；而 `lookup_metadata`
 * 的搜索级记录也常常不带简介（Open Library 的简介只在 works.json 详情里）。
 * 两条路都拿不到原文 ⇒ 模型只能编。这个工具让模型**顺着搜索结果点进去抓原文**。
 */
export const PREFILL_TOOL_FETCH_PAGE = 'fetch_page';
/** 工具回路**最多几轮**（含首轮）—— 防止模型来回查个没完（每次都是一个完整请求） */
export const MAX_PREFILL_ROUNDS = 3;

/**
 * 🔴 #499E 工具结果里**简介原文**的行首标记（**生产端 = 宿主 `runPrefillTool`，消费端 = 服务层**共用一个常量）。
 *
 * ⛔ 两端各写一份字符串的话，改一处就静默失联（症状：模型照抄了、用户却拿到模型自己写的那版）。
 * 形态上这条标记**必须独占一行行首**，且**放在整段工具结果的最后**（提取器取到串尾）。
 */
export const PREFILL_SYNOPSIS_PREFIX = '简介原文：';

/**
 * 从一段工具结果里抠出简介原文（没有标记 ⇒ `null`）。
 * ⚠️ 只取**首个**标记：一次工具结果里只会有一段简介（它是 `lookup_metadata` 为**最佳命中**附上的）。
 */
export function extractToolSynopsis(text: unknown): string | null {
    const s = String(text ?? '');
    const i = s.indexOf(PREFILL_SYNOPSIS_PREFIX);
    if (i < 0) return null;
    const body = s.slice(i + PREFILL_SYNOPSIS_PREFIX.length).replace(/\s+/g, ' ').trim();
    return body || null;
}

/**
 * 从一段工具结果里抠出题材（没有标记 ⇒ `null`；标记后为空也判 `null`）。
 * ⚠️ 与 `extractToolSynopsis` 同口径：只取**首个**标记。
 */
export function extractToolGenres(text: unknown): string[] | null {
    const s = String(text ?? '');
    const i = s.indexOf(PREFILL_GENRES_PREFIX);
    if (i < 0) return null;
    const line = s.slice(i + PREFILL_GENRES_PREFIX.length).split(/\r?\n/)[0] ?? '';
    const out: string[] = [];
    for (const part of line.split('/')) {
        const g = part.replace(/\s+/g, ' ').trim();
        if (g && !out.includes(g)) out.push(g);
    }
    return out.length ? out : null;
}

/**
 * 🔴 #499E **简介照搬裁决**（用户 2026-10-03：「不应该是搜索照搬真正作品的简介吗」）：
 * 工具查到了原文 ⇒ **无条件覆盖**模型给出的 `summary`（⛔ 不比较、不择优 —— 实测模型会顺手润色，
 * 让它自己拿主意就回到了「客观概述」那条老路）。
 *
 * 🔴🔴 m09330（用户 2026-11-18：「怎么AI搜索出来每个条目简介都是编的，我要的是原生原味的简介」）
 * **改判**：没查到原文 ⇒ **把 `summary` 整个删掉**（⛔ 不再「原样返回、留着模型写的那份」）。
 *
 * 为什么必须删：旧口径下「查不到就凭记忆写 2~4 句」，而实测绝大多数情况下工具确实查不到原文
 * （必应 RSS 没有简介、元数据源搜索级常不带简介）⇒ 用户看到的**永远**是编的那份。
 * 现在简介只有两个合法来源：工具给的原文，或者**空着**。
 *
 * 三道保险：该类型不问简介 / 空白串 ⇒ 原样返回（连「删 summary」都不做，因为本就没这个字段语义）。
 */
export function preferToolSynopsis(
    fields: Partial<Record<PrefillFieldKey, string>>,
    synopsis: unknown,
    defs: PrefillFieldDef[],
): Partial<Record<PrefillFieldKey, string>> {
    if (!defs.some((d) => d.key === 'summary')) return fields;
    const s = String(synopsis ?? '').replace(/\s+/g, ' ').trim();
    if (!s) {
        // 没原文 ⇒ 不许留模型编的那版（用户点名要「原生原味」）
        if (!('summary' in fields)) return fields;
        const next = { ...fields };
        delete next.summary;
        return next;
    }
    return { ...fields, summary: clip(s, MAX_CHARS.summary) };
}

/**
 * 🔴 m15796 **题材照搬裁决**（用户 2026-11-19：「这个也要搜索能该条目的题材、标签」）。
 *
 * 与 `preferToolSynopsis` 同族但**方向相反**：
 *  - 简介是「查不到就不许有」（宁可空着也不许编）；
 *  - 题材是多值列表，工具查到就**照搬覆盖**模型写的那份（模型常把「小说」这种载体当成题材，
 *    或把标签混进题材里）；查不到时**保留模型写的那份**（题材不像简介那么容易被编错，
 *    而且各源缺失率极高，一律清空会让「题材」永远填不上）。
 *
 * @param fields   模型给出的字段
 * @param genres   工具结果里抠出的题材（`extractToolGenres`；`null`/空 ⇒ 不动）
 * @param defs     本轮字段清单（没有 `genres` 字段的类型直接原样返回）
 */
export function preferToolGenres(
    fields: Partial<Record<PrefillFieldKey, string>>,
    genres: unknown,
    defs: PrefillFieldDef[],
): Partial<Record<PrefillFieldKey, string>> {
    if (!defs.some((d) => d.key === 'genres')) return fields;
    const list = Array.isArray(genres)
        ? genres.map((g) => String(g ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)
        : [];
    if (!list.length) return fields;
    // 去重（各源经常重复给「剧情 / 剧情」），再用表单口径的「 / 」拼
    const uniq: string[] = [];
    for (const g of list) if (!uniq.includes(g)) uniq.push(g);
    return { ...fields, genres: clip(uniq.join(' / '), MAX_CHARS.genres) };
}

/** 当前轮该发给模型的工具清单（⛔ 与宿主执行器 `runTool` 认的名字必须一致） */
export function prefillTools(): AiToolDef[] {
    return [
        {
            type: 'function',
            function: {
                name: PREFILL_TOOL_METADATA,
                description:
                    '按标题查询本机收藏库配置的元数据源（TMDB / Bangumi / 豆瓣 / Open Library / OMDb 等），' +
                    '返回命中条目的标题、年份、评分、**题材**；命中时**末尾还会附上该作品的官方简介原文' +
                    `（以「${PREFILL_SYNOPSIS_PREFIX}」开头）` +
                    `与题材原文（以「${PREFILL_GENRES_PREFIX}」开头）` +
                    '——填「简介」字段时**照抄那一段，不要改写**；「题材」也以那行为准。适合先确认这是哪一部作品。',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: '要查的作品标题（可含作者/年份帮助区分同名作品）' },
                        type: {
                            type: 'string',
                            enum: ['movie', 'tv', 'anime', 'book', 'game', 'music'],
                            description: '条目类型',
                        },
                    },
                    required: ['title', 'type'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: PREFILL_TOOL_WEB_SEARCH,
                description:
                    '联网搜索网页（适合冷门作品、或者想确认年份/主创/平台这类需要查证的事实）。' +
                    '返回若干条搜索结果的标题、摘要与**链接**。一次没找到可以换个关键词再搜一次；' +
                    '要读某个结果的正文（尤其是**作品简介**），把它的链接交给 `' + PREFILL_TOOL_FETCH_PAGE + '`。',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: '搜索词，例如「作品名 导演」「作品名 开发商」' },
                    },
                    required: ['query'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: PREFILL_TOOL_FETCH_PAGE,
                description:
                    '抓取一个网页的正文（🔴 拿**作品简介原文**的主要途径）。传一个权威页面地址' +
                    '（豆瓣 / Bangumi / Wikipedia / 官网 / IGDB 等条目页），返回该页可读正文；' +
                    '若页面里能识别出简介段落，**末尾会以「' + PREFILL_SYNOPSIS_PREFIX + '」开头附上原文**；' +
                    '页面上有结构化题材（JSON-LD genre / v:genre）时会以「' + PREFILL_GENRES_PREFIX + '」附一行 ——' +
                    '填「简介」字段时照抄那一段，⛔ 不要改写；「题材」也以那行为准。' +
                    '⚠️ 请把**要查的作品标题**一并填进 `title`：工具会核对页面里是否真的出现了这个标题，' +
                    '对不上就**不会附简介**（避免把搜索结果页/导航页的正文当成作品简介）。',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: '要抓取的网页地址（http/https 开头）' },
                        title: {
                            type: 'string',
                            description: '要查的作品标题（用于核对这个页面是不是它的条目页；强烈建议填）',
                        },
                    },
                    required: ['url'],
                },
            },
        },
    ];
}

/** 模型请求的一次工具调用 */
export interface PrefillToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

/**
 * 从**原始响应对象**里取 `choices[0].message.tool_calls`。
 * ⚠️ 传的是**整个响应**而不是 `reply.text` —— 工具调用那轮 `content` 常常是空的
 *    （`parseAiReply` 会判 `empty`），只盯文本会把「模型要调工具」误判成「失败」。
 * ⚠️ `arguments` 是**字符串化的 JSON**，坏参一律降级成空参（工具侧自己兜底，⛔ 别整轮失败）。
 */
export function parsePrefillToolCalls(raw: unknown): PrefillToolCall[] {
    const o = raw as { choices?: { message?: { tool_calls?: unknown } }[] } | null;
    const list = o?.choices?.[0]?.message?.tool_calls;
    if (!Array.isArray(list)) return [];
    const out: PrefillToolCall[] = [];
    for (const c of list) {
        const fn = (c as { function?: { name?: unknown; arguments?: unknown } } | null)?.function;
        const name = typeof fn?.name === 'string' ? fn.name.trim() : '';
        if (!name) continue;
        let args: Record<string, unknown> = {};
        if (typeof fn?.arguments === 'string') {
            try {
                const p = JSON.parse(fn.arguments) as unknown;
                if (p && typeof p === 'object' && !Array.isArray(p)) args = p as Record<string, unknown>;
            } catch {
                /* 坏参 ⇒ 空参 */
            }
        }
        out.push({ id: String((c as { id?: unknown })?.id ?? ''), name, args });
    }
    return out;
}

/**
 * 把响应里的 assistant 消息整理成**可回传**的一条（只留 `content` 与 `tool_calls`）。
 * ⚠️ ⛔ 别把整条 message 原样丢回去：里面可能带 `reasoning_content`（推理模型），回传会被端点挑刺。
 */
export function prefillAssistantTurn(raw: unknown): AiChatMessage | null {
    const msg = (raw as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] } | null)
        ?.choices?.[0]?.message;
    if (!msg) return null;
    const calls = msg.tool_calls;
    if (!Array.isArray(calls) || !calls.length) return null;
    return {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : '',
        tool_calls: calls,
    };
}

/** 一次工具调用的**结果**消息（OpenAI 兼容：`role:'tool'` + `tool_call_id` 必须对得上） */
export function prefillToolMessage(call: PrefillToolCall, content: string): AiChatMessage {
    return { role: 'tool', tool_call_id: call.id, content };
}

/** 工具调用 → 给用户看的一行（进度提示用；⛔ 别把参数原样倒给用户，太长） */
export function prefillToolLabel(call: PrefillToolCall): string {
    const pick = (k: string) => {
        const v = call.args[k];
        return typeof v === 'string' ? v.trim().slice(0, 30) : '';
    };
    if (call.name === PREFILL_TOOL_WEB_SEARCH) return `搜索网络：${pick('query') || '…'}`;
    if (call.name === PREFILL_TOOL_METADATA) return `查元数据源：${pick('title') || '…'}`;
    if (call.name === PREFILL_TOOL_FETCH_PAGE) return `读页面：${pick('url') || '…'}`;
    return `调用工具：${call.name}`;
}

/** 工具名 → **依据**里的来源名（预览面板脚注用） */
export function prefillSourceLabel(name: string): string {
    if (name === PREFILL_TOOL_WEB_SEARCH) return '网络搜索';
    if (name === PREFILL_TOOL_METADATA) return '元数据源';
    if (name === PREFILL_TOOL_FETCH_PAGE) return '页面原文';
    return name;
}

/**
 * 值 → 字符串：数组按分隔符连接（模型有时把题材 / 主演给成数组）。
 * ⚠️ `toc` 是**多行框**，数组要按换行连（用「 / 」连会把目录拼成一行）；
 *    其余多值字段（题材 / 主演 / 导演）用「 / 」，与表单占位符口径一致。
 */
function valueToText(key: PrefillFieldKey, v: unknown): string {
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (Array.isArray(v)) {
        const parts = v
            .map((x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : ''))
            .filter(Boolean);
        return parts.join(key === 'toc' ? '\n' : ' / ');
    }
    return '';
}

/** 数字字段的净化：年份取首个 4 位数字；其余只接受纯数字串（模型爱加单位 / 千分位 / ISBN 连字符） */
function cleanNumeric(key: PrefillFieldKey, text: string): string {
    if (key === 'year') {
        const m = /(\d{4})/.exec(text);
        return m ? m[1] : '';
    }
    // 千分位（1,200）与 ISBN 连字符（978-7-5366-9293-0）先去掉再判纯数字；其余非数字字符一律判不合格
    const n = text.replace(/[,\s-]/g, '');
    return /^\d+$/.test(n) ? n : '';
}

/** 按字符上限截断（超出补省略号） */
function clip(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * 解析模型输出 → 预填结果表（只留**字段目录里那一组键**，其余一律丢弃）。
 * 无法解析 / 一个可用字段都没有 ⇒ null（上层提示「没拿到可用字段」，而不是弹一块空预览）。
 *
 * ⚠️ 白名单过滤是**必需**的：模型偶尔会顺手塞进 `status` / `notes` / `rating` 这类**个人字段** ——
 *    那些不在目录里，必须在这里就丢掉（组件侧只认目录里的键，这里是第一道闸）。
 */
export function parseAiPrefillResult(
    text: string | null | undefined,
    defs: PrefillFieldDef[],
): Partial<Record<PrefillFieldKey, string>> | null {
    const obj = parseAiJsonObject(text);
    if (!obj) return null;
    const out: Partial<Record<PrefillFieldKey, string>> = {};
    for (const d of defs) {
        const raw = valueToText(d.key, obj[d.key]);
        if (!raw) continue;
        const cleaned = NUMERIC_KEYS.has(d.key) ? cleanNumeric(d.key, raw) : raw;
        if (!cleaned) continue;
        out[d.key] = clip(cleaned, MAX_CHARS[d.key]);
    }
    return Object.keys(out).length ? out : null;
}

/**
 * 预填结果 = 字段键 → 文本（只含模型真的给出了值的字段）+ 本次真的用到的**工具来源**。
 * ⚠️ 类型放**纯模块**：组件只认 `pure/*`（⛔ 不 import `services/*`），服务层回头引用它。
 */
export interface AiPrefillOutcome {
    fields: Partial<Record<PrefillFieldKey, string>>;
    /** 去重保序的来源名（如 `['元数据源','网络搜索']`）；空数组 = 纯凭记忆作答 */
    sources: string[];
}

/** 预览行：一行 = 一个**模型给出了值**的字段 */
export interface PrefillRow {
    key: PrefillFieldKey;
    label: string;
    /** 表单里的当前值（空 = 这一栏原本是空的）；非空时界面上打删除线 —— 表示**将被替换** */
    old: string;
    /** AI 给的值（界面上以灰色显示，二次确认后才落） */
    next: string;
}

/**
 * 合成预览行：**只列模型给出了值的字段**（用户 2026-10-03 裁定），顺序沿用字段目录（= 表单顺序）。
 * ⚠️ old 只是「展示用」的快照，**不是**合并策略 —— 确认后一律用 next 覆盖（见文件头口径）。
 */
export function buildPrefillRows(
    result: Partial<Record<PrefillFieldKey, string>>,
    current: Partial<Record<PrefillFieldKey, string>>,
    defs: PrefillFieldDef[],
): PrefillRow[] {
    const rows: PrefillRow[] = [];
    for (const d of defs) {
        const next = (result[d.key] ?? '').trim();
        if (!next) continue;
        rows.push({ key: d.key, label: d.label, old: (current[d.key] ?? '').trim(), next });
    }
    return rows;
}
