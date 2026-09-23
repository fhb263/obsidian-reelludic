// 阅读器划词搜索 —— 纯逻辑（无 obsidian / 无 DOM，可单测）。
// 两条通道（用户 2026-09-18 拆分定稿，各自有独立入口，不再是「二选一」两跳）：
//   ① 网络搜索（「引擎浮层 → 系统浏览器」）：本模块只负责「选引擎 + 拼查询 URL」，
//      跳转由宿主 `openExternalUrl` 完成 —— 零 API Key、零维护，且不受引擎 X-Frame-Options 限制。
//   ② AI 搜索：复用翻译通道的 OpenAI 兼容 chat/completions（`pure/translate` 的端点/模型/解析），
//      服务商与 system 提示词在设置页「AI集成 → AI服务 → 搜索服务 / 搜索提示词」可调。
//
// 注：网络搜索不抓取结果列表（Bing Search API 已于 2025 停服、Google CSE 收费、
// DuckDuckGo 无官方 API），「卡内出网页结果」需自备 Key，故本版不做（见 UI-GUIDE）。

import { modelFor, normalizeProvider, type TranslateProvider, type TranslateRequestBody } from 'pure/translate';

/** 引擎 id（25 个内置引擎；脏数据一律回退首个） */
export type SearchEngineId =
    | 'baidu' | 'bing' | 'google' | 'sogou' | 'quark'
    | 'weibo' | 'xiaohongshu' | 'zhihu' | 'bilibili' | 'douyin'
    | 'pan' | 'ebook' | 'music' | 'video' | 'steam'
    | 'jd' | 'taobao' | 'pdd' | 'manmanbuy' | 'smzdm'
    | 'wanfang' | 'pubscholar' | 'cnki' | 'baiduxueshu' | 'bingxueshu';

/** 引擎分组 id（顺序即浮层分组顺序） */
export type SearchEngineGroupId = 'general' | 'vertical' | 'feature' | 'shopping' | 'academic';

export interface SearchEngine {
    id: SearchEngineId;
    /** chip 文案（浮层已改纯图标 → 这里只作 `data-tip` 悬停提示 / `.rl-sr` 读屏名，不再直接显示） */
    label: string;
    /**
     * 查询 URL 模板；`{q}` 会被替换为 URL 编码后的查询词（抖音是路径段形态，同一套替换即可）。
     *
     * ⚠️ 图标**不在本表**，在 `pure/searchIcons.ts`（`SEARCH_ENGINE_ICONS`，以引擎 id 为键）——
     * 那里装着 15 个品牌 logo（simple-icons，CC0）的 24×24 单路径与官方色，另 9 个无 logo 的回退内置图标。
     * 拆开是因为图标数据的体积（约 17KB 路径）与「引擎表」的关注点不同，且能被单独单测。
     * 用户 2026-09-19 裁定：浮层 chip 由「主题色加粗文字」改回**纯图标 + 悬停提示 + 品牌官方色**。
     */
    urlTemplate: string;
}

export interface SearchEngineGroup {
    id: SearchEngineGroupId;
    /** 浮层分组标题 */
    label: string;
    engines: readonly SearchEngine[];
}

/**
 * 内置引擎表（**5 组 × 每组 5 个 = 25**；组序即浮层顺序，组内顺序即 chip 顺序）。
 * 用户 2026-09-19 定：**每组统一 5 个** —— 竖排浮层五列等高，观感整齐（此前是 3/9/4/3/5 的参差）。
 * 全部取 https 且为「页面可直开」的查询入口（宿主 openExternalUrl 只放行 http/https）。
 * 🔴 模板形态**已用 curl 逐个核过**（见 docs/superpowers/plans/2026-09-18-reader-search-split-design.md §4；
 *    2026-09-19 扩充时又实测了一轮候选：天猫已重定向到淘宝、苏宁 404、慢慢买旧形态会把查询词弄坏 → 三个都弃掉）。
 *    本机不可达的 Google 取标准形态（本环境 google.com 亦不可达，属网络限制而非站点问题）。改模板前先实测，别凭印象改。
 * 🔴 引擎选择**不落库**（浮层直接读本表、点选只拼 URL）→ 增删引擎零迁移风险。
 */
export const SEARCH_ENGINE_GROUPS: readonly SearchEngineGroup[] = [
    {
        id: 'general',
        label: '通用搜索',
        engines: [
            { id: 'baidu', label: '百度', urlTemplate: 'https://www.baidu.com/s?wd={q}' },
            { id: 'bing', label: 'Bing', urlTemplate: 'https://cn.bing.com/search?q={q}' },
            { id: 'google', label: 'Google', urlTemplate: 'https://www.google.com/search?q={q}' },
            { id: 'sogou', label: '搜狗', urlTemplate: 'https://www.sogou.com/web?query={q}' },
            { id: 'quark', label: '夸克', urlTemplate: 'https://quark.sm.cn/s?q={q}' },
        ],
    },
    {
        id: 'vertical',
        label: '垂直领域',
        engines: [
            { id: 'weibo', label: '微博', urlTemplate: 'https://s.weibo.com/weibo?q={q}' },
            { id: 'xiaohongshu', label: '小红书', urlTemplate: 'https://www.xiaohongshu.com/search_result?keyword={q}' },
            { id: 'zhihu', label: '知乎', urlTemplate: 'https://www.zhihu.com/search?type=content&q={q}' },
            { id: 'bilibili', label: 'B站', urlTemplate: 'https://search.bilibili.com/all?keyword={q}' },
            { id: 'douyin', label: '抖音', urlTemplate: 'https://www.douyin.com/search/{q}' },
        ],
    },
    {
        id: 'feature',
        label: '特色场景',
        engines: [
            { id: 'pan', label: '网盘', urlTemplate: 'https://www.alipan.com/search?keyword={q}' },
            { id: 'ebook', label: '电子书', urlTemplate: 'https://www.jiumodiary.com/search?keyword={q}' },
            { id: 'music', label: '音乐', urlTemplate: 'https://music.163.com/#/search/m/?s={q}' },
            { id: 'video', label: '影视', urlTemplate: 'https://search.douban.com/movie/subject_search?search_text={q}' },
            { id: 'steam', label: 'Steam', urlTemplate: 'https://store.steampowered.com/search/?term={q}' },
        ],
    },
    {
        id: 'shopping',
        label: '购物比价',
        engines: [
            { id: 'jd', label: '京东', urlTemplate: 'https://search.jd.com/Search?keyword={q}' },
            { id: 'taobao', label: '淘宝', urlTemplate: 'https://s.taobao.com/search?q={q}' },
            { id: 'pdd', label: '拼多多', urlTemplate: 'https://mobile.yangkeduo.com/search_result.html?search_key={q}' },
            { id: 'manmanbuy', label: '慢慢买', urlTemplate: 'https://s.manmanbuy.com/pc/search/result?keyword={q}' },
            { id: 'smzdm', label: '什么值得买', urlTemplate: 'https://search.smzdm.com/?c=home&s={q}' },
        ],
    },
    {
        id: 'academic',
        label: '学术搜索',
        engines: [
            { id: 'wanfang', label: '万方', urlTemplate: 'https://s.wanfangdata.com.cn/paper?q={q}' },
            { id: 'pubscholar', label: 'PubScholar', urlTemplate: 'https://pubscholar.cn/search?q={q}' },
            { id: 'cnki', label: 'CNKI', urlTemplate: 'https://kns.cnki.net/kns8s/defaultresult/index?kw={q}' },
            { id: 'baiduxueshu', label: '百度学术', urlTemplate: 'https://xueshu.baidu.com/s?wd={q}' },
            { id: 'bingxueshu', label: 'Bing学术', urlTemplate: 'https://cn.bing.com/academic/search?q={q}' },
        ],
    },
];

/** 扁平引擎表（由分组派生：分组是唯一真源，禁止另抄一份） */
export const SEARCH_ENGINES: readonly SearchEngine[] = SEARCH_ENGINE_GROUPS.flatMap((g) => g.engines);

const FALLBACK_ENGINE: SearchEngineId = 'baidu';

/**
 * 归一化引擎 id：仅内置表内的 id 有效；其余（undefined / 未知 / 原型链键名 / 非字符串）
 * 一律回退首个 —— 与 `normalizeProvider` 同款防护，避免脏设置把 chip 全点亮不了。
 */
export function normalizeSearchEngine(id: unknown): SearchEngineId {
    return SEARCH_ENGINES.some((e) => e.id === id) ? (id as SearchEngineId) : FALLBACK_ENGINE;
}

/**
 * 拼查询 URL：空/纯空白查询 → null（不发无效跳转）；未知引擎回退首个。
 * 查询词一律 `encodeURIComponent`（中文、空格、`&`、`#` 都必须编码，否则 URL 被截断）。
 */
export function searchEngineUrl(id: SearchEngineId | unknown, query: string): string | null {
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) return null;
    const engine = SEARCH_ENGINES.find((e) => e.id === normalizeSearchEngine(id)) ?? SEARCH_ENGINES[0];
    return engine.urlTemplate.replace('{q}', encodeURIComponent(q));
}

/**
 * AI 搜索默认 system 提示词（「解读选段」态用；用户裁定「提示词可在设置页改写」，留空即用本默认）。
 * 口径：先结论 → 再要点 → 不确定单独标注（防编造）；不复述原文、不输出 JSON/代码块。
 */
export const DEFAULT_SEARCH_PROMPT =
    '你在为读者解答一段书中选段。根据这段文字判断它在讲什么，然后：\n' +
    '1. 先用一句话给出结论 —— 读者最想知道的那个答案；\n' +
    '2. 再列 2-4 条要点，补充背景、出处或相关概念，每条不超过两行；\n' +
    '3. 如果涉及事实、数据或人名而你不确定，单独用一行「不确定：…」说明，绝不要编造。\n' +
    '不要复述原文，不要输出 JSON 或代码块，不要自称 AI，不要加「以下是」这类开场白。';

/**
 * 「自定义提问」态的 system 提示词（用户 2026-09-18 裁定：**不调用设置页提示词**）。
 * 与「解读选段」的关键差异：不要求概括选段，只回答读者问的那件事。
 */
export const DEFAULT_SEARCH_QUESTION_PROMPT =
    '读者正在读一段书，并针对这段内容提出了一个问题。请直接回答读者的问题：\n' +
    '1. 先用一句话给出答案；\n' +
    '2. 再列 2-4 条要点作为支撑或补充，每条不超过两行；\n' +
    '3. 涉及事实、数据或人名而不确定时，单独用一行「不确定：…」说明，绝不要编造。\n' +
    '只回答读者问的这件事，不要复述选段，不要输出 JSON 或代码块，不要自称 AI，不要加「以下是」这类开场白。';

/**
 * 构造 AI 搜索请求体（OpenAI 兼容，与翻译同形）。空/纯空白文本 → null（不该发请求）。
 * prompt 传空/纯空白 → 用 DEFAULT_SEARCH_PROMPT（设置页提示词框留空即默认）。
 */
export function buildSearchBody(text: string, provider?: TranslateProvider, prompt?: string): TranslateRequestBody | null {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return null;
    return {
        model: modelFor(normalizeProvider(provider)),
        messages: [
            { role: 'system', content: prompt?.trim() || DEFAULT_SEARCH_PROMPT },
            { role: 'user', content: trimmed },
        ],
        stream: false,
    };
}

/**
 * 构造「自定义提问」请求体：选段 + 问题一起发，system 固定用 DEFAULT_SEARCH_QUESTION_PROMPT
 * （**不走设置页提示词** —— 那条提示词是给「解读选段」用的）。
 * 问题为空/纯空白 → null（没问题就不该发）；选段为空 → 退化为「只问问题」。
 */
export function buildSearchQuestionBody(
    text: string,
    question: string,
    provider?: TranslateProvider,
): TranslateRequestBody | null {
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) return null;
    const t = typeof text === 'string' ? text.trim() : '';
    return {
        model: modelFor(normalizeProvider(provider)),
        messages: [
            { role: 'system', content: DEFAULT_SEARCH_QUESTION_PROMPT },
            { role: 'user', content: t ? `【选段】\n${t}\n\n【问题】\n${q}` : q },
        ],
        stream: false,
    };
}
