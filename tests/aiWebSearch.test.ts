// 平台原生联网检索（`pure/aiWebSearch`）的纯逻辑测试 + 宿主分流装配守卫。
// 背景（用户 m16766「AI生成的元数据从哪里来，为什么不能像网页正常AI搜索那样获取权威元数据」）：
// 预填的 `web_search` 原先只有必应 RSS 一条路（标题 + 两行摘要、中文多段还被逐字拆词），
// 现在**先走平台原生检索**，拿不到才回落。这两段都必须被钉住，否则很容易悄悄退回单通道。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    AI_SEARCH_COUNT,
    AI_SEARCH_DEEPSEEK_URL,
    AI_SEARCH_TEXT_MAX,
    AI_SEARCH_TITLE_MAX,
    AI_SEARCH_ZHIPU_URL,
    aiSearchLabel,
    aiSearchProviderOf,
    aiSearchResultsToText,
    buildAiSearchRequest,
    nativeSearchHttpIssue,
    parseAiSearch,
    parseDeepseekSearch,
    parseZhipuSearch,
} from 'pure/aiWebSearch';

const ROOT = resolve(__dirname, '..');

describe('aiSearchProviderOf —— 哪家有第一方检索', () => {
    it('智谱 / DeepSeek 有', () => {
        expect(aiSearchProviderOf('zhipu')).toBe('zhipu');
        expect(aiSearchProviderOf('deepseek')).toBe('deepseek');
    });

    it('🔴 硅基流动没有第一方搜索接口 ⇒ null（官方用例是自备 Tavily 的 key）', () => {
        expect(aiSearchProviderOf('siliconflow')).toBeNull();
    });

    it('自定义槽位 / 关闭 / 脏值 ⇒ null', () => {
        expect(aiSearchProviderOf('custom')).toBeNull();
        expect(aiSearchProviderOf('custom2')).toBeNull();
        expect(aiSearchProviderOf('off')).toBeNull();
        expect(aiSearchProviderOf(undefined)).toBeNull();
        expect(aiSearchProviderOf(null)).toBeNull();
        expect(aiSearchProviderOf(42)).toBeNull();
    });
});

describe('buildAiSearchRequest', () => {
    it('DeepSeek：POST /v1/tools/search，带 count 与 need_content:false', () => {
        const r = buildAiSearchRequest('deepseek', '三体', 'sk-abc')!;
        expect(r.url).toBe(AI_SEARCH_DEEPSEEK_URL);
        expect(r.method).toBe('POST');
        expect(r.contentType).toBe('application/json');
        expect(r.headers.Authorization).toBe('Bearer sk-abc');
        const body = JSON.parse(r.body);
        expect(body.query).toBe('三体');
        expect(body.count).toBe(AI_SEARCH_COUNT);
        // ⚠️ need_content 会返回整页正文，既挤掉字段清单、又和「按次计费」无关 —— 必须保持 false
        expect(body.need_content).toBe(false);
        // 这条回路没有「用户原问题」，⛔ 别传 ori_question
        expect(body).not.toHaveProperty('ori_question');
    });

    it('智谱：POST /web_search，search_pro 引擎 + content_size high + search_intent:false', () => {
        const r = buildAiSearchRequest('zhipu', '三体', 'key.abc')!;
        expect(r.url).toBe(AI_SEARCH_ZHIPU_URL);
        const body = JSON.parse(r.body);
        expect(body.search_query).toBe('三体');
        expect(body.search_engine).toBe('search_pro');
        // 🔴 工具只在模型已决定要搜时才被调 ⇒ 再做意图识别等于重复判断，
        //    且被判「无搜索意图」时会返回空结果、白丢一次计费调用
        expect(body.search_intent).toBe(false);
        expect(body.content_size).toBe('high');
        expect(body.count).toBe(AI_SEARCH_COUNT);
    });

    it('空查询 / 全空白 ⇒ null（⛔ 不白跑一次计费请求）', () => {
        expect(buildAiSearchRequest('deepseek', '', 'sk')).toBeNull();
        expect(buildAiSearchRequest('deepseek', '   ', 'sk')).toBeNull();
        expect(buildAiSearchRequest('zhipu', '  \n\t ', 'k')).toBeNull();
    });

    it('空 Key ⇒ null（没填凭据就别发请求）', () => {
        expect(buildAiSearchRequest('deepseek', '三体', '')).toBeNull();
        expect(buildAiSearchRequest('zhipu', '三体', '   ')).toBeNull();
    });

    it('查询词内部多空白被折叠成单空格', () => {
        const r = buildAiSearchRequest('deepseek', '  三体   刘慈欣  ', 'sk')!;
        expect(JSON.parse(r.body).query).toBe('三体 刘慈欣');
    });
});

describe('parseDeepseekSearch', () => {
    const sample = {
        results: [
            {
                rerank_score: 2.4,
                title: '三体 - 维基百科',
                url: 'https://zh.wikipedia.org/wiki/三体',
                snippet: '三体是刘慈欣的长篇科幻小说…',
                summary: '《三体》是刘慈欣创作的长篇科幻小说系列第一部，2008 年由重庆出版社出版…',
                site_name: '维基百科',
                date: '2026-10-01T00:00:00Z',
                authority: 3,
            },
            { title: '豆瓣读书：三体', url: 'https://book.douban.com/subject/2567698/', snippet: '评分 9.3', authority: 2 },
            { title: '', url: '' },
            null,
        ],
    };

    it('字段归一：snippet 优先取 summary（600~800 字那份）', () => {
        const hits = parseDeepseekSearch(sample);
        expect(hits).toHaveLength(2);
        expect(hits[0].title).toBe('三体 - 维基百科');
        expect(hits[0].snippet).toContain('长篇科幻小说系列第一部');
        expect(hits[0].site).toBe('维基百科');
        expect(hits[0].authority).toBe(3);
        expect(hits[0].score).toBe(2.4);
        expect(hits[0].date).toBe('2026-10-01T00:00:00Z');
    });

    it('缺 summary ⇒ 退回 snippet；缺 authority / rerank_score ⇒ -1 / 0', () => {
        const hits = parseDeepseekSearch(sample);
        expect(hits[1].snippet).toBe('评分 9.3');
        expect(hits[1].authority).toBe(2);
        expect(hits[1].score).toBe(0);
        expect(hits[1].site).toBe('');
        expect(hits[1].date).toBe('');
    });

    it('标题与链接都空的条目被丢弃（⛔ 不留空壳）', () => {
        expect(parseDeepseekSearch(sample)).toHaveLength(2);
    });

    it('坏 JSON / 非数组 / 缺 results ⇒ 空数组，不抛', () => {
        expect(parseDeepseekSearch('{not json')).toEqual([]);
        expect(parseDeepseekSearch('{}')).toEqual([]);
        expect(parseDeepseekSearch({ results: 'nope' })).toEqual([]);
        expect(parseDeepseekSearch(null)).toEqual([]);
    });
});

describe('parseZhipuSearch', () => {
    const sample = {
        search_result: [
            {
                title: '三体（刘慈欣著科幻小说）_百度百科',
                link: 'https://baike.baidu.com/item/三体',
                content: '《三体》是刘慈欣创作的系列长篇科幻小说…',
                media: '百度百科',
                publish_date: '2026-09-20',
            },
            { title: '无链接条目' },
        ],
    };

    it('字段归一：link→url / content→snippet / media→site / publish_date→date', () => {
        const hits = parseZhipuSearch(sample);
        expect(hits).toHaveLength(2);
        expect(hits[0].url).toBe('https://baike.baidu.com/item/三体');
        expect(hits[0].snippet).toContain('系列长篇科幻小说');
        expect(hits[0].site).toBe('百度百科');
        expect(hits[0].date).toBe('2026-09-20');
    });

    it('智谱没有权威性/相关性字段 ⇒ authority -1 / score 0（文本化时不显示分数）', () => {
        const hits = parseZhipuSearch(sample);
        expect(hits[0].authority).toBe(-1);
        expect(hits[0].score).toBe(0);
    });

    it('失败形态 { error: { code, message } } ⇒ 空数组（调用方回落必应）', () => {
        expect(parseZhipuSearch({ error: { code: 1001, message: '参数错误' } })).toEqual([]);
    });

    it('坏 JSON / 缺 search_result ⇒ 空数组，不抛', () => {
        expect(parseZhipuSearch('<html>502</html>')).toEqual([]);
        expect(parseZhipuSearch({})).toEqual([]);
    });
});

describe('parseAiSearch —— 唯一分叉点', () => {
    it('按服务商分派到各自的解析器', () => {
        expect(parseAiSearch('deepseek', { results: [{ title: 'A', url: 'u1' }] })[0].title).toBe('A');
        expect(parseAiSearch('zhipu', { search_result: [{ title: 'B', link: 'u2' }] })[0].title).toBe('B');
    });
});

describe('aiSearchLabel', () => {
    it('两家各有人话名（写进给模型的文本）', () => {
        expect(aiSearchLabel('deepseek')).toBe('DeepSeek 官方检索');
        expect(aiSearchLabel('zhipu')).toBe('智谱 Web Search');
    });
});

describe('aiSearchResultsToText', () => {
    it('显示权威性 / 相关性 / 站点 / 链接 —— 用户要的正是「哪条更可信」', () => {
        const text = aiSearchResultsToText([
            {
                title: '三体 - 维基百科',
                url: 'https://zh.wikipedia.org/wiki/三体',
                snippet: '《三体》是刘慈欣创作的长篇小说。',
                site: '维基百科',
                date: '2026-10-01T00:00:00Z',
                authority: 3,
                score: 2.4,
            },
        ]);
        expect(text).toContain('1. 三体 - 维基百科');
        expect(text).toContain('《三体》是刘慈欣创作的长篇小说。');
        expect(text).toContain('权威 3/4');
        expect(text).toContain('相关 2.4');
        expect(text).toContain('维基百科');
        expect(text).toContain('2026-10-01');
        expect(text).toContain('https://zh.wikipedia.org/wiki/三体');
    });

    it('authority 为 -1 / score 为 0（智谱）⇒ 不显示不该有的分数', () => {
        const text = aiSearchResultsToText([
            { title: 'A', url: 'u', snippet: '', site: '百科', date: '', authority: -1, score: 0 },
        ]);
        expect(text).not.toContain('权威');
        expect(text).not.toContain('相关');
        expect(text).toContain('百科');
    });

    // 🔴 m17001（真机实测）：DeepSeek 对图书馆 OPAC / 题库这类页面常返回 `title: ""`，
    //    原实现兜 `(无标题)` ⇒ 一次 8 条里 5 条写着「(无标题)」，模型判断不出该点哪条，只能去编。
    //    ⇒ 改判成**逐级降级**：站点名 → 摘要首句 → 链接。⛔ 不许再出现 `(无标题)`。
    it('🔴 无标题时退到站点名（⛔ 不再出现「(无标题)」）', () => {
        const text = aiSearchResultsToText([
            { title: '', url: 'u', snippet: '', site: '国防科技大学', date: '', authority: 4, score: 1.8 },
        ]);
        expect(text.startsWith('1. 国防科技大学')).toBe(true);
        expect(text).not.toContain('(无标题)');
    });

    it('🔴 无标题且无站点名 ⇒ 退到摘要首句', () => {
        const text = aiSearchResultsToText([
            { title: '', url: 'u', snippet: '\n  三体 / 刘慈欣著\n出版社：重庆出版社', site: '', date: '', authority: 4, score: 1.8 },
        ]);
        expect(text.startsWith('1. 三体 / 刘慈欣著')).toBe(true);
        expect(text).not.toContain('(无标题)');
    });

    it('🔴 全空 ⇒ 退到链接（仍然不出现「(无标题)」）', () => {
        const text = aiSearchResultsToText([
            { title: '', url: 'https://libopac.nudt.edu.cn/opac/book/437042', snippet: '', site: '', date: '', authority: 4, score: 1.8 },
        ]);
        expect(text).toContain('libopac.nudt.edu.cn/opac/book/437042');
        expect(text).not.toContain('(无标题)');
    });

    it('🔴 反向守卫：源码里不许再出现「(无标题)」这个占位', () => {
        const src = require('node:fs').readFileSync(
            require('node:path').resolve(__dirname, '../src/pure/aiWebSearch.ts'),
            'utf8',
        );
        expect(src).not.toContain("'(无标题)'");
    });

    // 🔴 m17001 真机实测：DeepSeek 的 summary/snippet 是网页抓取来的，自带换行
    //    （图书馆 OPAC：`| 三体 / 刘慈欣著 ,\n...\n出版发行:\n | 出版地：…`）。
    //    不折行的话一条结果被打散成五六行，模型靠行首 `N. ` 数条数就会数错 ⇒ 必须严格一条一行。
    it('🔴 摘要里的换行必须折成单行（否则一条结果被打散、模型数错条数）', () => {
        const text = aiSearchResultsToText([
            {
                title: '国防科技大学',
                url: 'https://libopac.nudt.edu.cn/opac/book/437042',
                snippet: '| 三体 / 刘慈欣著 ,\n...\n出版发行:\n | 出版地： 重庆 出版社： 重庆出版社',
                site: '国防科技大学',
                date: '',
                authority: 4,
                score: 1.9,
            },
            { title: '第二条', url: 'u2', snippet: 'a\r\nb\tc\u3000d', site: '', date: '', authority: 3, score: 1.5 },
        ]);
        const lines = text.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => /^\d+\. /.test(l))).toBe(true);
        expect(text).not.toMatch(/\r/);
        expect(text).not.toMatch(/\u3000/);
        expect(lines[0]).toContain('三体 / 刘慈欣著');
        expect(lines[1]).toContain('a b c d');
    });

    it(`总长不超过 AI_SEARCH_TEXT_MAX=${AI_SEARCH_TEXT_MAX}（装不下就停）`, () => {
        const big = Array.from({ length: 40 }, (_, i) => ({
            title: `结果${i}`,
            url: `https://example.com/${i}`,
            snippet: '很长的摘要'.repeat(60),
            site: '示例',
            date: '',
            authority: 2,
            score: 1.5,
        }));
        const text = aiSearchResultsToText(big);
        expect(text.length).toBeLessThanOrEqual(AI_SEARCH_TEXT_MAX);
        // 装不下就**停**（不是截断某一行留半句）
        expect(text.split('\n').every((l) => /^\d+\. /.test(l))).toBe(true);
    });

    it('空结果 ⇒ 空串', () => {
        expect(aiSearchResultsToText([])).toBe('');
    });

    it(`超长标题被截到 AI_SEARCH_TITLE_MAX=${AI_SEARCH_TITLE_MAX}`, () => {
        const text = aiSearchResultsToText([
            { title: 'X'.repeat(400), url: '', snippet: '', site: '', date: '', authority: -1, score: 0 },
        ]);
        expect(text).toContain('X'.repeat(AI_SEARCH_TITLE_MAX));
        expect(text).not.toContain('X'.repeat(AI_SEARCH_TITLE_MAX + 1));
    });
});

describe('nativeSearchHttpIssue —— 降级原因必须是人话（静默降级不可接受）', () => {
    it('🔴 实测那条：智谱 429 + code 1113「余额不足」⇒ 直说余额不足并提示回落', () => {
        const issue = nativeSearchHttpIssue(429, '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}');
        expect(issue).toContain('HTTP 429');
        expect(issue).toContain('1113');
        expect(issue).toContain('余额不足');
        expect(issue).toContain('回落成必应摘要');
        expect(issue).toContain('充值');
    });

    it('只有 429 没有余额线索 ⇒ 按限流解释（⛔ 别一律说没钱）', () => {
        const issue = nativeSearchHttpIssue(429, '');
        expect(issue).toContain('限流');
        expect(issue).not.toContain('余额不足');
    });

    it('401 ⇒ Key 无效或过期', () => {
        expect(nativeSearchHttpIssue(401, '')).toContain('API Key 无效或已过期');
    });

    it('403 ⇒ 没权限', () => {
        expect(nativeSearchHttpIssue(403, '')).toContain('权限');
    });

    it('5xx ⇒ 平台服务端异常', () => {
        expect(nativeSearchHttpIssue(503, '')).toContain('服务端异常');
    });

    it('其它状态码 ⇒ 带上原文消息', () => {
        const issue = nativeSearchHttpIssue(400, '{"error":{"code":"1001","message":"search_engine 参数错误"}}');
        expect(issue).toContain('HTTP 400');
        expect(issue).toContain('search_engine 参数错误');
    });

    it('坏 JSON 不抛（照样给一句人话）', () => {
        expect(nativeSearchHttpIssue(500, '<html>502 Bad Gateway</html>')).toContain('HTTP 500');
    });

    it('DeepSeek 的 insufficient balance 文案也判成余额问题', () => {
        expect(nativeSearchHttpIssue(402, '{"error":{"message":"Insufficient Balance"}}')).toContain('余额不足');
    });
});

describe('宿主装配（main.ts）—— 分流与回落必须同时存在', () => {
    const src = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');

    it('🔴 有平台原生检索这一路（⛔ 不许只剩必应一条路）', () => {
        expect(src).toContain("from 'pure/aiWebSearch'");
        expect(src).toContain('private nativeWebSearchProvider(');
        expect(src).toContain('private async runNativeWebSearch(');
        expect(src).toContain('const native = this.nativeWebSearchProvider();');
        expect(src).toContain('const nativeRes = await this.runNativeWebSearch(native, query);');
    });

    it('🔴 原生检索拿不到就必须回落必应（两处调用共存、回落必须在之后）', () => {
        expect(src).toContain('const url = buildBingRssUrl(query);');
        expect(src).toContain('parseBingRss(res.text)');
        const i = src.indexOf('const native = this.nativeWebSearchProvider();');
        const j = src.indexOf('const url = buildBingRssUrl(query);');
        expect(i).toBeGreaterThan(0);
        expect(j).toBeGreaterThan(i);
    });

    it('🔴🔴 回落**不许静默**：失败原因必须进结果文本（实测用户 Key 一直 429/余额不足）', () => {
        // 反向守卫：⛔ 不许退回「拿不到就啥也不说」
        expect(src).not.toContain('const nativeText = await this.runNativeWebSearch(native, query);');
        expect(src).toContain("if ('text' in nativeRes) return nativeRes.text;");
        expect(src).toContain('nativeIssue = nativeRes.issue;');
        expect(src).toContain('平台原生检索没成功');
        expect(src).toContain('可信度明显低一档');
        // 🔴 光有 `warn` 变量不够 —— 必须**真的拼进 return 的模板里**，
        //    否则「定义了个变量没人用」照样是静默降级（变异测试抓过一次这个空转）。
        expect(src).toContain('${warn}${bingResultsToText(items)}');
        expect(src).not.toContain('条结果：\\n${bingResultsToText(items)}');
    });

    it('原生请求带 throw:false（HTTP 4xx/5xx 要能被我们自己判掉，⛔ 不抛到回路外）', () => {
        const start = src.indexOf('private async runNativeWebSearch(');
        const body = src.slice(start, start + 2600);
        expect(body).toContain('throw: false');
        expect(body).toContain('if (res.status !== 200) return { issue: nativeSearchHttpIssue(res.status, res.text) };');
    });

    it('Key 与聊天共用同一把（aiKeyField），⛔ 不新开字段', () => {
        const start = src.indexOf('private nativeWebSearchProvider(');
        const body = src.slice(start, start + 900);
        expect(body).toContain('aiKeyField(provider)');
        expect(body).toContain("typeof key === 'string' && key.trim()");
    });

    // 🔴 m17001：提示词按「原生 / 必应回落」两条通道分流查询词口径 ⇒ 模型必须能**从结果文本里认出通道**。
    //    两个标记都是契约（`pure/aiPrefill.ts` 的提示词逐字引用），⛔ 别改名、别只留一个。
    it('🔴 给模型的文本要标出检索通道（原生 / 必应回落两条都必须有）', () => {
        expect(src).toContain('${aiSearchLabel(provider)} · 平台原生检索');
        expect(src).toContain('（来源：必应 RSS · 回落通道）');
        // ⛔ 反向守卫：不许退回到「只报服务商名、不说是哪条通道」
        expect(src).not.toContain('（来源：${aiSearchLabel(provider)}）的前');
    });
});

describe('工具描述（pure/aiPrefill）—— 要告诉模型这条路值得优先用', () => {
    const src = readFileSync(resolve(ROOT, 'src/pure/aiPrefill.ts'), 'utf8');

    it('web_search 的 description 提到权威性评分', () => {
        const i = src.indexOf('name: PREFILL_TOOL_WEB_SEARCH');
        const body = src.slice(i, i + 1600);
        expect(body).toContain('权威');
        expect(body).toContain('相关');
        expect(body).toContain('首选这条路找权威来源');
    });

    it('🔴 反向守卫：⛔ 不许把描述退回「只有链接与摘要」的老口径', () => {
        expect(src).not.toContain('返回若干条搜索结果的标题、摘要与**链接**。一次没找到可以换个关键词再搜一次');
    });
});
