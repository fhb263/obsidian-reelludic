// 「编辑属性表单 → 百度搜索」的纯逻辑：查询词拼接 + 搜索地址构造（无 obsidian 依赖，可单测）。
//
// 🔴 用户 m17219（逐字）：「在所有类型编辑属性表单中标题旁就是AI预填图标按钮左旁边加个
//    百度搜索的按钮，点击即可内弹窗百度搜索改条目名称」。
//    用户裁定（提问后逐字回答）：「标题、作者、实际就是仿AI预填的网络搜索版」
//    ⇒ 查询词 = **标题 + 作者**，与 AI 预填联网搜索那套同源口径；弹窗**纯展示、不回填**
//      （用户明确选了「纯内嵌百度网页，不回填」，⛔ 不要自作主张加回填按钮）。
//
// 🔴 为什么查询词要「标题 + 作者」而不是只有标题：
//    实测（m17001 的四组对照）单段作品名在语义检索上经常撞到同名异物 ——
//    「七里香」首条是植物「千里香」、「活着」首条是阳泉市图书馆。补上作者/导演这类限定词
//    能显著抬高命中率。百度是语义搜索（不是必应 RSS 那种按空格拆字的退化实现），
//    ⇒ ⛔ 这里**不要**复用 `compactBingQuery` 的「只取第一段」逻辑（那是给必应兜底的）。
//
// ⚠️ 边界：作者可能为空（新条目还没填）⇒ 只搜标题；标题也空 ⇒ 返回空串，
//    调用方据此直接打开百度首页（而不是搜一个空关键词）。本模块 ⛔ 不自己抛错。

/** 百度搜索入口（PC 版；`wd` 是它认的关键词参数，⛔ 别写成 `word`——那是移动版） */
const BAIDU_SEARCH_BASE = 'https://www.baidu.com/s?wd=';

/** 查询词上限：百度对超长 `wd` 会截断，且塞满整段简介进去只会搜出垃圾结果 */
const BAIDU_QUERY_MAX = 60;

/**
 * 拼查询词：标题 + 作者，空段跳过，去重（标题里已经写了作者名就不要再补一遍）。
 *
 * ⚠️ 返回**未编码**的原文（便于单测逐字断言）；编码交给 `baiduSearchUrl`。
 * ⚠️ 超过 `BAIDU_QUERY_MAX` 截断 —— 只截尾部，保证标题一定完整（标题是主关键词）。
 */
export function baiduSearchQuery(title: string | undefined | null, author: string | undefined | null): string {
    const t = String(title ?? '').replace(/[\s\u3000]+/g, ' ').trim();
    const a = String(author ?? '').replace(/[\s\u3000]+/g, ' ').trim();
    if (!t && !a) return '';
    if (!a) return t.slice(0, BAIDU_QUERY_MAX);
    if (!t) return a.slice(0, BAIDU_QUERY_MAX);
    // 作者名已经出现在标题里（如标题本身是「周杰伦 - 七里香」）⇒ 不重复拼
    if (t.includes(a)) return t.slice(0, BAIDU_QUERY_MAX);
    const joined = `${t} ${a}`;
    return joined.slice(0, BAIDU_QUERY_MAX);
}

/**
 * 构造百度搜索地址。
 *
 * 空查询词 ⇒ 返回百度首页（用户点开还能自己输，⛔ 不要返回 `?wd=` 这种空搜索页，
 * 那会直接落到百度的「没有找到相关结果」页，看起来像功能坏了）。
 */
export function baiduSearchUrl(query: string | undefined | null): string {
    const q = String(query ?? '').trim();
    if (!q) return 'https://www.baidu.com/';
    return `${BAIDU_SEARCH_BASE}${encodeURIComponent(q)}`;
}

/**
 * 一步到位：标题 + 作者 ⇒ 可直接灌给内嵌容器的地址。
 *
 * 弹窗与调用方都用它，⛔ 别再各自拼一遍（拼法一散，回填/搜索词就会出现两套口径）。
 */
export function baiduSearchUrlFor(title: string | undefined | null, author: string | undefined | null): string {
    return baiduSearchUrl(baiduSearchQuery(title, author));
}

/** 查询词是否为空（调用方据此决定提示文案：「已按标题 + 作者搜索」/「没填标题，自己搜」） */
export function baiduQueryIsEmpty(query: string): boolean {
    return String(query ?? '').trim().length === 0;
}

/**
 * 从「导演 / 编剧」这种多值框里取**第一个**导演名。
 *
 * 🔴 用户 m17819：「电影百度搜索要和标题+导演（取第 1 个）搜索」。
 *    表单里导演与编剧合并在一个输入框（`directorWriters`），按 `/` 拼成
 *    「丹尼斯·维伦纽瓦 / 埃里克·罗斯」——直接拿去搜会把编剧也算进关键词里，
 *    而百度对多段长词的召回会明显变差。所以只取第一个。
 *
 * ⚠️ 分隔符与全仓多值字段口径一致（`formFields.ts` 的 `split(/[\/、,，]/)`）——
 *    用户手填时可能写「、」或「,」，⛔ 只按 `/` 切会漏。
 */
export function firstPersonName(value: string | undefined | null): string {
    const raw = String(value ?? '');
    for (const part of raw.split(/[\/、,，;；]+/)) {
        const s = part.replace(/[\s\u3000]+/g, ' ').trim();
        if (s) return s;
    }
    return '';
}
