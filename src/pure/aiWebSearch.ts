// 平台原生联网检索（AI 预填 `web_search` 工具背后的**首选通道**）—— 纯逻辑，可单测。
//
// 🔴🔴 存在的理由（用户 m16766「那AI生成的元数据从哪里来，为什么不能像网页正常AI搜索那样
//   获取权威元数据」）：此前的 `web_search` 走的是**必应 RSS**（`pure/bingSearch`）——
//   每条只有标题 + 两行摘要，且中文多段查询会被逐字拆词。而「网页版 AI 搜索」拿到的
//   是平台侧**深度检索 + 权威性排序 + 正文抓取**。两者不是同一量级，用户体感自然是「你的像在编」。
//
//   实测（2026-11-20 读官方文档）：
//   · DeepSeek：`POST https://api.deepseek.com/v1/tools/search`
//     响应每条带 `rerank_score`(0~3，≥1.5 优质)、`authority`(0~4，≥3 极权威)、
//     `snippet`(100~200 字)、`summary`(**600~800 字**)。计费 5 元/1000 次成功请求。
//     ⚠️ 更大的能力在 Chat Completions 的**服务端工具**（`tools:[{type:'deepseek_web_search'}]`，
//        搜索不计费只计 token，模型自己开网页/页内查找）—— 那条需要 `deepseek-flash` 模型且
//        与「工具回路」的协议不同，本模块只做**裸搜索接口**这一档（可控、有分数、可断言）。
//   · 智谱：`POST https://open.bigmodel.cn/api/paas/v4/web_search`
//     `search_engine` 分档（`search_std` 0.01 / `search_pro` 0.03 / `search_pro_sogou|quark` 0.05 元每次），
//     `content_size: 'high'` 拿更长的正文片段。响应 `search_result[]` 带 `title`/`content`/`link`/`media`/`publish_date`。
//   · 硅基流动：**没有第一方搜索接口**（官方用例是让用户自备 Tavily 的 key）⇒ 返回 null，
//     调用方回落必应 RSS。
//
// ⛔ 这里只做「请求体构造 + 响应解析 + 文本化」三件事；发请求由宿主（`main.ts` 的 `requestUrl`）执行，
//    与 `pure/bingSearch` 同口径 —— 纯逻辑才能被单测钉住。

/** 能提供原生检索的服务商（`custom` 槽位**不算**：用户填的是任意端点，未登记搜索通道） */
export type AiSearchProvider = 'zhipu' | 'deepseek';

/** 单次检索要几条（控 token；两家的上限都是 50） */
export const AI_SEARCH_COUNT = 8;
/** 拼给模型的搜索文本总上限（与 `bingSearch.WEB_SEARCH_TEXT_MAX` 同口径，防整页塞进上下文） */
export const AI_SEARCH_TEXT_MAX = 2600;
/** 只把「够高质量」的条数内联到给模型的文本里（`authority`/`rerank_score` 不设门槛，只排序） */
export const AI_SEARCH_TITLE_MAX = 120;

/**
 * 服务商 ⇒ 是否有原生检索。**唯一真源**（⛔ 别在调用点再写一遍 `provider === 'zhipu' || …`）。
 * `custom` / `custom2` / `siliconflow` ⇒ `null`（回落必应）。
 */
export function aiSearchProviderOf(provider: unknown): AiSearchProvider | null {
    if (provider === 'zhipu') return 'zhipu';
    if (provider === 'deepseek') return 'deepseek';
    return null;
}

/** 一条检索结果（两家的字段归一到同一形态，缺值一律空串/0，⛔ 不让调用方判 undefined） */
export interface AiSearchHit {
    title: string;
    url: string;
    /** 摘要（DeepSeek 的 `summary` 600~800 字 / 智谱的 `content`）；空 ⇒ 空串 */
    snippet: string;
    /** 站点名（`site_name` / `media`）；没有 ⇒ 空串 */
    site: string;
    /** 发布时间（`date` / `publish_date`）；没有 ⇒ 空串 */
    date: string;
    /** 权威性 0~4（DeepSeek `authority`；-1 = 未知；智谱没有该字段 ⇒ -1） */
    authority: number;
    /** 相关性 0~3（DeepSeek `rerank_score`；智谱没有 ⇒ 0） */
    score: number;
}

export interface AiSearchRequest {
    url: string;
    method: 'POST';
    contentType: 'application/json';
    headers: Record<string, string>;
    body: string;
}

/** DeepSeek 裸搜索接口 */
export const AI_SEARCH_DEEPSEEK_URL = 'https://api.deepseek.com/v1/tools/search';
/** 智谱 Web Search API */
export const AI_SEARCH_ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';

/** 取一个字符串字段（非字符串/空白 ⇒ 空串）。⛔ 名字别用通用短名 `str`（esbuild 消歧会连带改名） */
function textField(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/** 取一个数字字段（非有限数 ⇒ fallback） */
function numberField(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 空查询 ⇒ `null`（调用方据此直接回一句「没给搜索词」，⛔ 不白跑一次计费请求）。
 * 两家都不接受纯空白 query。
 */
export function buildAiSearchRequest(
    provider: AiSearchProvider,
    query: string,
    apiKey: string,
): AiSearchRequest | null {
    const q = String(query ?? '').replace(/\s+/g, ' ').trim();
    const key = String(apiKey ?? '').trim();
    if (!q || !key) return null;
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (provider === 'deepseek') {
        // ⚠️ `need_content` 刻意保持 false：正文整页会挤掉字段清单，且价格按次数不按条数，
        //    真正需要正文时模型还有 `fetch_page` 那条路。`ori_question` 不传 —— 这里没有「用户原问题」。
        return {
            url: AI_SEARCH_DEEPSEEK_URL,
            method: 'POST',
            contentType: 'application/json',
            headers,
            body: JSON.stringify({ query: q, count: AI_SEARCH_COUNT, need_content: false }),
        };
    }
    // 智谱：`search_pro` 多引擎协作（文档：「显著降低空结果率」），`content_size: 'high'` 拿长片段。
    // ⚠️ `search_intent: false` —— 这个工具只会在模型已经决定要搜时被调用，再做意图识别等于重复判断
    //    （且判定为「无搜索意图」时会**返回空结果**，白白丢一次调用）。
    return {
        url: AI_SEARCH_ZHIPU_URL,
        method: 'POST',
        contentType: 'application/json',
        headers,
        body: JSON.stringify({
            search_query: q,
            search_engine: 'search_pro',
            search_intent: false,
            count: AI_SEARCH_COUNT,
            content_size: 'high',
        }),
    };
}

/**
 * 解析 DeepSeek `/v1/tools/search` 的响应。
 * 形态：`{ results: [{ rerank_score, title, url, snippet, summary, content, site_name, date, authority }] }`
 * ⚠️ 标题与链接都空的条目直接丢掉（留着只会让模型把空壳当一条结果）。
 */
export function parseDeepseekSearch(raw: unknown): AiSearchHit[] {
    let json: unknown = raw;
    if (typeof raw === 'string') {
        try {
            json = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    const list = (json as { results?: unknown } | null)?.results;
    if (!Array.isArray(list)) return [];
    const out: AiSearchHit[] = [];
    for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const title = textField(o.title);
        const url = textField(o.url);
        if (!title && !url) continue;
        // 优先 `summary`（600~800 字，专供模型读）；没有才退回 `snippet`（100~200 字，供展示）。
        const snippet = textField(o.summary) || textField(o.snippet) || textField(o.content);
        out.push({
            title,
            url,
            snippet,
            site: textField(o.site_name),
            date: textField(o.date),
            authority: numberField(o.authority, -1),
            score: numberField(o.rerank_score, 0),
        });
    }
    return out;
}

/**
 * 解析智谱 `/api/paas/v4/web_search` 的响应。
 * 形态：`{ search_result: [{ title, content, link, media, publish_date, refer, icon }] }`；
 * 失败形态是 `{ error: { code, message } }` ⇒ 空数组（由调用方回落必应）。
 * ⚠️ 智谱**没有** authorrity/rerank_score 字段 ⇒ 统一给 `-1` / `0`（文本化时据此不显示分数）。
 */
export function parseZhipuSearch(raw: unknown): AiSearchHit[] {
    let json: unknown = raw;
    if (typeof raw === 'string') {
        try {
            json = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    const list = (json as { search_result?: unknown } | null)?.search_result;
    if (!Array.isArray(list)) return [];
    const out: AiSearchHit[] = [];
    for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const title = textField(o.title);
        const url = textField(o.link);
        if (!title && !url) continue;
        out.push({
            title,
            url,
            snippet: textField(o.content),
            site: textField(o.media),
            date: textField(o.publish_date),
            authority: -1,
            score: 0,
        });
    }
    return out;
}

/** 按服务商解析（唯一分叉点，⛔ 别在调用点写 if/else） */
export function parseAiSearch(provider: AiSearchProvider, raw: unknown): AiSearchHit[] {
    return provider === 'deepseek' ? parseDeepseekSearch(raw) : parseZhipuSearch(raw);
}

/** 服务商的人话名（写进给模型的文本，让它知道自己拿到了什么档次的检索结果） */
export function aiSearchLabel(provider: AiSearchProvider): string {
    return provider === 'deepseek' ? 'DeepSeek 官方检索' : '智谱 Web Search';
}

/**
 * 结果行的「可读标题」—— 标题为空时逐级降级，⛔ 不要出现 `(无标题)`。
 *
 * 🔴 由来（m17001 真机实测，2026-11-20）：DeepSeek 官方检索对**图书馆 OPAC / 题库**这类页面
 *    经常返回 `title: ""`（例：国防科技大学 `libopac.nudt.edu.cn/opac/book/437042`，
 *    `site_name = "国防科技大学"`、`authority = 4`、`summary` 里反而是完整的书名/作者/ISBN/出版社/页数）。
 *    原实现在这里兜 `(无标题)`，模型一次拿到 8 条里有 5 条写着「(无标题)」，根本判断不出该点哪条
 *    ⇒ 退而求其次去编。降级顺序：`title` → `site_name`（站点名本身就有辨识度）→ 摘要首句 → 链接。
 *
 * ⛔ 别把这里改成返回空串：空标题行会被模型当成「这条没有信息」直接跳过，等于白搜。
 */
function searchHitTitle(it: AiSearchHit): string {
    const title = String(it.title ?? '').trim();
    if (title) return title;
    const site = String(it.site ?? '').trim();
    if (site) return site;
    const lead = String(it.snippet ?? '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0);
    if (lead) return lead;
    return String(it.url ?? '').trim() || '未命名结果';
}

/**
 * 结果 → 喂给模型的文本块。
 *
 * 形态：**每条严格一行** `1. 标题 — 摘要（链接）〔权威 3/4 · 相关 2.4〕`
 * · **权威性/相关性必须显示**：用户要的正是「权威元数据」，模型得知道哪条更可信
 *   （`authority >= 3` 是官方口径的「极权威」，`rerank_score >= 1.5` 是「优质」）。
 * · 摘要按余量截断：`AI_SEARCH_TEXT_MAX` 是总上限，逐条累加，装不下就停（⛔ 别整页塞进去）。
 * · 🔴 **摘要与标题必须先折成单行**（m17001 真机实测）：DeepSeek 的 `summary`/`snippet` 来自网页抓取，
 *   自带 `\n`（图书馆 OPAC 的 `| 三体 / 刘慈欣著 ,\n...\n出版发行:\n | 出版地：…`）。
 *   不折行的话一条结果会被打散成五六行，模型靠行首的 `N. ` 数结果条数就会数错，
 *   也容易把某条的中段当成新的一条 ⇒ ⛔ 别把原始换行直接拼进输出。
 */
export function aiSearchResultsToText(hits: readonly AiSearchHit[]): string {
    const lines: string[] = [];
    let used = 0;
    for (const [i, it] of hits.entries()) {
        const head = `${i + 1}. ${oneLine(searchHitTitle(it)).slice(0, AI_SEARCH_TITLE_MAX)}`;
        const mark: string[] = [];
        if (it.authority >= 0) mark.push(`权威 ${it.authority}/4`);
        if (it.score > 0) mark.push(`相关 ${it.score.toFixed(1)}`);
        if (it.site) mark.push(it.site);
        if (it.date) mark.push(it.date.slice(0, 10));
        const tail = `${mark.length ? `〔${mark.join(' · ')}〕` : ''}${it.url ? `（${it.url}）` : ''}`;
        const body = it.snippet ? ` — ${oneLine(it.snippet)}` : '';
        const line = head + body + tail;
        if (used + line.length > AI_SEARCH_TEXT_MAX) break;
        lines.push(line);
        used += line.length;
    }
    return lines.join('\n');
}

/** 折成单行：所有空白（含 `\r\n`、`\t`、全角空格）压成一个半角空格并去首尾。 */
function oneLine(raw: unknown): string {
    return String(raw ?? '')
        .replace(/[\s\u3000]+/g, ' ')
        .trim();
}

/**
 * 平台检索**失败时的人话原因**（写进工具结果，让模型转述给用户）。
 *
 * 🔴🔴 为什么非要有这个：实测用户那把智谱 Key 调 `/api/paas/v4/web_search` 返回
 *   **HTTP 429 / `{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}`**，
 *   原生检索一次都没成功、全部**静默**落到必应两行摘要 —— 用户完全无从知道「为什么我的 AI 还在编」。
 *   ⇒ 失败原因必须显式带回给模型（它会在答案里说明），静默降级不可接受。
 *
 * ⚠️ 顺序要紧：`429` 在三家都可能表示「频率限制」，但**智谱的 1113 与 DeepSeek 的余额不足**
 *    都会落在 4xx 里，所以先看 body 里的错误码/文案，再退回 HTTP 状态码语义。
 */
export function nativeSearchHttpIssue(status: number, body: unknown): string {
    const raw = typeof body === 'string' ? body : '';
    let msg = '';
    let code = '';
    try {
        const j = JSON.parse(raw) as { error?: { code?: unknown; message?: unknown }; message?: unknown };
        const err = j?.error ?? null;
        if (err && typeof err === 'object') {
            code = String((err as { code?: unknown }).code ?? '');
            msg = textField((err as { message?: unknown }).message);
        }
        if (!msg) msg = textField(j?.message);
    } catch {
        msg = '';
    }
    const bail = /余额|充值|欠费|insufficient|balance|quota|credit/i.test(`${msg} ${raw.slice(0, 400)}`);
    const head = `平台检索失败（HTTP ${status}${code ? ` / code ${code}` : ''}）`;
    if (bail) return `${head}：账户余额不足或没有可用资源包 —— 这次结果回落成必应摘要，可信度会明显下降。请到开放平台充值后再试。`;
    if (status === 401) return `${head}：API Key 无效或已过期 —— 这次结果回落成必应摘要。请到设置页重新粘贴 Key。`;
    if (status === 403) return `${head}：这把 Key 没有该接口的权限 —— 这次结果回落成必应摘要。`;
    if (status === 429) return `${head}：调用太频繁被限流 —— 这次结果回落成必应摘要，隔一会儿再试。`;
    if (status >= 500) return `${head}：平台服务端异常 —— 这次结果回落成必应摘要，稍后再试。`;
    return `${head}${msg ? `：${msg}` : ''} —— 这次结果回落成必应摘要。`;
}

