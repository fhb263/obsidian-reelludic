import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PREFILL_PROMPT,
    MAX_PREFILL_ROUNDS,
    PREFILL_SYNOPSIS_PREFIX,
    PREFILL_TOOL_METADATA,
    PREFILL_TOOL_WEB_SEARCH,
    buildPrefillRequest,
    buildPrefillRows,
    extractToolSynopsis,
    parseAiPrefillResult,
    parsePrefillToolCalls,
    prefillAssistantTurn,
    prefillFieldsFor,
    prefillMessages,
    prefillSourceLabel,
    prefillToolLabel,
    prefillToolMessage,
    prefillTools,
    preferToolSynopsis,
} from 'pure/aiPrefill';
import { ZHIPU_MODEL } from 'pure/translate';


/** 便捷封装（原 `buildAiPrefillBody` 的等价物：标题空 ⇒ null；带 tools ⇒ 请求体也带） */
function prefillBody(
    input: Parameters<typeof prefillMessages>[0],
    provider?: Parameters<typeof buildPrefillRequest>[1],
    prompt?: string,
    model?: string,
    tools?: Parameters<typeof buildPrefillRequest>[3],
) {
    const msgs = prefillMessages(input, prompt, !!(tools && tools.length));
    return msgs ? buildPrefillRequest(msgs, provider, model, tools) : null;
}

const KEYS = (type: Parameters<typeof prefillFieldsFor>[0], kind?: Parameters<typeof prefillFieldsFor>[1]) =>
    prefillFieldsFor(type, kind).map((d) => d.key);

describe('prefillFieldsFor（字段目录 = 真源）', () => {
    it('六类型各有自己的字段组，且**都含简介**（唯一跨类型共用的事实字段）', () => {
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as const) {
            expect(KEYS(t).length).toBeGreaterThan(0);
            expect(KEYS(t)).toContain('summary');
        }
    });

    it('书籍按 bookKind 三分：文学 / 网文 / 漫画 字段组互不相同', () => {
        expect(KEYS('book', 'book')).toContain('isbn');
        expect(KEYS('book', 'book')).toContain('publisher');
        expect(KEYS('book', 'novel')).not.toContain('isbn');
        expect(KEYS('book', 'novel')).not.toContain('publisher');
        expect(KEYS('book', 'novel')).toContain('toc'); // 网文也有「目录」框（表单按 bookKind !== 'comic' 渲染）
        expect(KEYS('book', 'comic')).toContain('artist');
        expect(KEYS('book', 'comic')).not.toContain('isbn');
        expect(KEYS('book', 'comic')).not.toContain('toc'); // 漫画没有目录框
        // 三类互不相同（任两组都不相等）
        const [a, b, c] = [KEYS('book', 'book'), KEYS('book', 'novel'), KEYS('book', 'comic')];
        expect(a.join()).not.toBe(b.join());
        expect(b.join()).not.toBe(c.join());
        expect(a.join()).not.toBe(c.join());
    });

    it('影视三类：电影**没有**总集数；剧 / 番有', () => {
        expect(KEYS('movie')).not.toContain('totalEpisodes');
        expect(KEYS('tv')).toContain('totalEpisodes');
        expect(KEYS('anime')).toContain('totalEpisodes');
    });

    it('🔴 反向守卫：⛔ 绝不收「表单里没有输入口」的字段（country / originalTitle / language …）'
        + '—— 预填它们 = 预览里看得见、字段区找不到、下次编辑也改不了（暗写）', () => {
        const all = new Set<string>();
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as const) {
            for (const k of KEYS(t)) all.add(k);
            for (const k of KEYS(t, 'novel')) all.add(k);
            for (const k of KEYS(t, 'comic')) all.add(k);
        }
        for (const banned of ['country', 'originalTitle', 'language', 'durationMin', 'aliases', 'series', 'seriesIndex']) {
            expect(all.has(banned)).toBe(false);
        }
    });

    it('🔴 反向守卫：⛔ 不收个人字段（状态 / 评分 / 笔记 / 进度 / 播放关联）—— 模型无从得知，问它只会得到编造', () => {
        const all = new Set<string>();
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as const) for (const k of KEYS(t)) all.add(k);
        for (const banned of ['status', 'rating', 'notes', 'progress', 'audioPath', 'episodeFiles', 'playtime']) {
            expect(all.has(banned)).toBe(false);
        }
    });

    it('字段键在**同一个类型内**不重复，且都带 label 与 hint', () => {
        for (const t of ['movie', 'tv', 'anime', 'game', 'music'] as const) {
            const defs = prefillFieldsFor(t);
            expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
            for (const d of defs) {
                expect(d.label.length).toBeGreaterThan(0);
                expect(d.hint.length).toBeGreaterThan(0);
            }
        }
    });
});

describe('prefillBody（请求体）', () => {
    it('标题为空 / 纯空白 ⇒ null（信息量为零，不该发请求 —— 与总结摘要同口径）', () => {
        expect(prefillBody({ type: 'movie', title: '' })).toBeNull();
        expect(prefillBody({ type: 'movie', title: '   ' })).toBeNull();
    });

    it('system = 默认提示词（可被覆盖）；user 里带类型 / 标题 / 本次字段清单', () => {
        const body = prefillBody({ type: 'movie', title: ' 盗梦空间 ' })!;
        expect(body.model).toBe(ZHIPU_MODEL);
        expect(body.messages[0].content).toBe(DEFAULT_PREFILL_PROMPT);
        const user = body.messages[1].content;
        expect(user).toContain('标题：盗梦空间');
        expect(user).toContain('类型：电影');
        for (const k of KEYS('movie')) expect(user).toContain(`${k} ——`);
        // ⛔ 别把别的类型的字段混进来
        expect(user).not.toContain('totalEpisodes ——');
    });

    it('自定义提示词生效（只换 system；字段清单仍由目录现生成，⛔ 不受提示词影响）', () => {
        const body = prefillBody({ type: 'game', title: '空洞骑士' }, 'deepseek', '我的提示词', 'my-model')!;
        expect(body.messages[0].content).toBe('我的提示词');
        expect(body.model).toBe('my-model');
        const user = body.messages[1].content;
        expect(user).toContain('platform ——');
        expect(user).toContain('developer ——');
    });

    it('线索（年份 / 题材）写进 user：帮模型区分同名作品；空线索不占行', () => {
        const withHints = prefillBody({ type: 'movie', title: '沙丘', year: 2021, genres: ['科幻', '  '] })!;
        expect(withHints.messages[1].content).toContain('年份线索：2021');
        expect(withHints.messages[1].content).toContain('题材线索：科幻');
        const noHints = prefillBody({ type: 'movie', title: '沙丘' })!;
        expect(noHints.messages[1].content).not.toContain('线索');
    });

    it('书籍把子分类写进类型行（网文 / 漫画 / 文学）—— 模型据此换一套字段语义', () => {
        expect(prefillBody({ type: 'book', bookKind: 'novel', title: 'x' })!.messages[1].content).toContain('（网文）');
        expect(prefillBody({ type: 'book', bookKind: 'comic', title: 'x' })!.messages[1].content).toContain('（漫画）');
        expect(prefillBody({ type: 'book', bookKind: 'book', title: 'x' })!.messages[1].content).toContain('（文学）');
    });
});

describe('parseAiPrefillResult', () => {
    const defs = prefillFieldsFor('tv');

    it('剥 ``` 围栏 + 容忍前后解释文字（模型爱加）', () => {
        const r = parseAiPrefillResult('好的，这是结果：\n```json\n{"year":"2024","cast":"张三 / 李四"}\n```\n希望有帮助', defs)!;
        expect(r.year).toBe('2024');
        expect(r.cast).toBe('张三 / 李四');
    });

    it('🔴 白名单过滤：目录外的键（含个人字段）一律丢弃', () => {
        const r = parseAiPrefillResult(
            '{"title":"x","rating":9,"notes":"我很喜欢","status":"watched","year":"2020"}',
            defs,
        )!;
        expect(Object.keys(r)).toEqual(['year']);
    });

    it('数组值：多值字段用「 / 」连；**目录**用换行连（多行框，别拼成一行）', () => {
        const r = parseAiPrefillResult('{"cast":["甲","乙"],"genres":["科幻","悬疑"]}', defs)!;
        expect(r.cast).toBe('甲 / 乙');
        expect(r.genres).toBe('科幻 / 悬疑');
        const bookDefs = prefillFieldsFor('book', 'book');
        const b = parseAiPrefillResult('{"toc":["第一章","第二章"]}', bookDefs)!;
        expect(b.toc).toBe('第一章\n第二章');
    });

    it('数字字段净化：年份取首个 4 位数字；页数 / 集数 / ISBN 去千分位与连字符；非数字 ⇒ 丢弃', () => {
        expect(parseAiPrefillResult('{"year":"2024年"}', defs)!.year).toBe('2024');
        expect(parseAiPrefillResult('{"year":"很久以前"}', defs)).toBeNull();
        expect(parseAiPrefillResult('{"totalEpisodes":"1,200"}', defs)!.totalEpisodes).toBe('1200');
        expect(parseAiPrefillResult('{"totalEpisodes":"约十二集"}', defs)).toBeNull();
        const bookDefs = prefillFieldsFor('book', 'book');
        expect(parseAiPrefillResult('{"isbn":"978-7-5366-9293-0"}', bookDefs)!.isbn).toBe('9787536692930');
    });

    it('空串 / 空数组 / 纯空白 / 非字符串（数字 / 对象）的处理', () => {
        expect(parseAiPrefillResult('{"year":"","cast":[],"summary":"   "}', defs)).toBeNull();
        // 数字给 year：按字符串接受（模型有时给 number）
        expect(parseAiPrefillResult('{"year":2024}', defs)!.year).toBe('2024');
        // 对象值（模型偶发嵌套）⇒ 丢弃该字段
        expect(parseAiPrefillResult('{"summary":{"a":1},"year":"2001"}', defs)!.summary).toBeUndefined();
    });

    it('无法解析 / 一个可用字段都没有 ⇒ null（上层提示「没拿到可用字段」，⛔ 别弹一块空预览）', () => {
        expect(parseAiPrefillResult('模型啥也没说', defs)).toBeNull();
        expect(parseAiPrefillResult('{"rating":5}', defs)).toBeNull();
        expect(parseAiPrefillResult('', defs)).toBeNull();
        expect(parseAiPrefillResult(null, defs)).toBeNull();
        expect(parseAiPrefillResult('{ 坏 JSON', defs)).toBeNull();
    });

    it('超长值按上限截断（防病态输出把整篇塞进一个框）', () => {
        // ⚠️ #499E：`summary` 的上限由 400 提到 800（简介要照搬数据源的**原文**，400 会拦腰截断）——
        //    这里只断言「确实被截了 + 带省略号」，⛔ 不钉死那个数字（免得改上限就红一条无关断言）
        const long = '甲'.repeat(900);
        const r = parseAiPrefillResult(JSON.stringify({ summary: long }), defs)!;
        expect(r.summary!.length).toBeLessThan(900);
        expect(r.summary!.endsWith('…')).toBe(true);
    });
});

describe('buildPrefillRows（预览行）', () => {
    const defs = prefillFieldsFor('movie');

    it('只列**模型给出了值**的字段，顺序沿用字段目录（= 表单顺序）', () => {
        const rows = buildPrefillRows({ cast: '甲 / 乙', year: '2021' }, {}, defs);
        expect(rows.map((r) => r.key)).toEqual(['year', 'cast']);
        expect(rows.map((r) => r.label)).toEqual(['上映年', '主演']);
    });

    it('旧值随表单当前值带出（空 ⇒ 空串，界面显示「（空）」）；next 是 AI 值', () => {
        const rows = buildPrefillRows({ year: '2021' }, { year: '1999' }, defs);
        expect(rows[0]).toEqual({ key: 'year', label: '上映年', old: '1999', next: '2021' });
        const rows2 = buildPrefillRows({ year: '2021' }, {}, defs);
        expect(rows2[0].old).toBe('');
    });

    it('结果为空 ⇒ 空数组（上层据此提示「没有可用字段」）', () => {
        expect(buildPrefillRows({}, { year: '1999' }, defs)).toEqual([]);
    });
});

// ──────────── #499D agent 工具回路（用户：「能不能做 agent 调用 tools 或者 skills 搜索」）────────────
describe('工具定义与回路裁决', () => {
    it('工具清单就两款，名字与常量一致（⛔ 宿主执行器认的就是这两个名字）', () => {
        const names = prefillTools().map((t) => t.function.name);
        expect(names).toEqual([PREFILL_TOOL_METADATA, PREFILL_TOOL_WEB_SEARCH]);
        for (const t of prefillTools()) {
            expect(t.type).toBe('function');
            expect(t.function.description.length).toBeGreaterThan(10);
            expect(t.function.parameters.type).toBe('object');
        }
    });

    it('🔴 必须是「function」型工具 —— ⛔ 别用厂商内置的 web_search（实测 DeepSeek 直接 422）', () => {
        for (const t of prefillTools()) expect(t.type).toBe('function');
        expect(JSON.stringify(prefillTools())).not.toContain('"web_search":{"enable"');
    });

    it('带工具时 user 末尾补一句「可以先调工具」——**这句由代码拥有**，⛔ 不放可改写的提示词里', () => {
        const withTools = prefillMessages({ type: 'movie', title: '沙丘' }, '我的提示词', true)!;
        expect(withTools[1].content).toContain('可以先调用工具查一查');
        const noTools = prefillMessages({ type: 'movie', title: '沙丘' }, '我的提示词', false)!;
        expect(noTools[1].content).not.toContain('可以先调用工具查一查');
        // 提示词仍照旧生效
        expect(withTools[0].content).toBe('我的提示词');
        expect(noTools[0].content).toBe('我的提示词');
    });

    it('buildAiPrefillBody 带 tools ⇒ 请求体里有 tools；不带 ⇒ 一个字段都不多（与 #499 完全一致）', () => {
        const withT = prefillBody({ type: 'movie', title: 'x' }, undefined, undefined, undefined, prefillTools())!;
        expect(withT.tools).toHaveLength(2);
        const withoutT = prefillBody({ type: 'movie', title: 'x' })!;
        expect(withoutT.tools).toBeUndefined();
        expect(Object.keys(withoutT).sort()).toEqual(['messages', 'model', 'stream']);
    });

    it('parsePrefillToolCalls：取 `choices[0].message.tool_calls`，`arguments` 是**字符串化 JSON**', () => {
        const raw = {
            choices: [
                {
                    message: {
                        content: '',
                        tool_calls: [
                            { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"沙丘 导演"}' } },
                        ],
                    },
                },
            ],
        };
        expect(parsePrefillToolCalls(raw)).toEqual([{ id: 'call_1', name: 'web_search', args: { query: '沙丘 导演' } }]);
    });

    it('坏参数 / 缺名字：**降级成空参或跳过，⛔ 不让整轮失败**', () => {
        const raw = {
            choices: [
                {
                    message: {
                        tool_calls: [
                            { id: 'a', function: { name: 'web_search', arguments: '{坏 JSON' } },
                            { id: 'b', function: {} },
                            { id: 'c', function: { name: 'lookup_metadata', arguments: '[1,2]' } },
                        ],
                    },
                },
            ],
        };
        const calls = parsePrefillToolCalls(raw);
        expect(calls.map((c) => c.id)).toEqual(['a', 'c']); // 没名字的 b 被丢掉
        expect(calls[0].args).toEqual({});
        expect(calls[1].args).toEqual({}); // 数组也不是合法参数对象
    });

    it('没有 tool_calls / 响应是脏数据 ⇒ 空数组（不抛）', () => {
        expect(parsePrefillToolCalls(null)).toEqual([]);
        expect(parsePrefillToolCalls({})).toEqual([]);
        expect(parsePrefillToolCalls({ choices: [{ message: { content: 'hi' } }] })).toEqual([]);
    });

    it('🔴 prefillAssistantTurn：只留 content + tool_calls，**丢掉 reasoning_content**（回传会被端点挑刺）', () => {
        const raw = {
            choices: [
                {
                    message: {
                        content: '',
                        reasoning_content: '我在想…',
                        tool_calls: [{ id: 'c1', function: { name: 'web_search', arguments: '{}' } }],
                    },
                },
            ],
        };
        const turn = prefillAssistantTurn(raw)!;
        expect(Object.keys(turn).sort()).toEqual(['content', 'role', 'tool_calls']);
        expect(turn.role).toBe('assistant');
        expect(turn.content).toBe('');
        // 没有工具调用的普通回复 ⇒ null（那种轮到上层直接收尾，不该再掺一条 assistant 消息）
        expect(prefillAssistantTurn({ choices: [{ message: { content: '{}' } }] })).toBeNull();
    });

    it('prefillToolMessage：role 为 tool、且 tool_call_id 必须对得上（这是回路的第二条腿）', () => {
        const msg = prefillToolMessage({ id: 'call_x', name: 'web_search', args: {} }, '结果正文');
        expect(msg).toEqual({ role: 'tool', tool_call_id: 'call_x', content: '结果正文' });
    });

    it('进度文案与来源名：给用户看的是**短句**，不是原始参数', () => {
        expect(prefillToolLabel({ id: '1', name: PREFILL_TOOL_WEB_SEARCH, args: { query: '沙丘 导演' } })).toBe('搜索网络：沙丘 导演');
        expect(prefillToolLabel({ id: '1', name: PREFILL_TOOL_METADATA, args: { title: '沙丘' } })).toBe('查元数据源：沙丘');
        expect(prefillSourceLabel(PREFILL_TOOL_WEB_SEARCH)).toBe('网络搜索');
        expect(prefillSourceLabel(PREFILL_TOOL_METADATA)).toBe('元数据源');
    });

    it('轮数上限是 3（含首轮）—— 每次工具调用都是一个完整请求，⛔ 别放开', () => {
        expect(MAX_PREFILL_ROUNDS).toBe(3);
    });
});

// ──────────── #499E 简介「照搬工具原文」（用户：「不应该是搜索照搬真正作品的简介吗」）────────────
describe('简介照搬：标记 / 提取 / 覆盖裁决', () => {
    it('🔴 默认提示词把「照抄工具原文」写成硬要求，并点明「不要改写成自己的话」', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('照抄');
        expect(DEFAULT_PREFILL_PROMPT).toContain('简介原文');
        expect(DEFAULT_PREFILL_PROMPT).toContain('不要润色');
        // ⛔ 旧口径（一句「客观陈述」包打天下）不许回潮
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('简介写中文，2~4 句客观陈述');
    });

    it('🔴 字段说明（`summary` 的 hint）也带照抄口径 —— 它是每次现生成字段清单的那一份', () => {
        for (const [type, kind] of [['movie'], ['book', 'novel'], ['book', 'comic'], ['book', 'literature'], ['game'], ['music'], ['tv'], ['anime']] as const) {
            const def = prefillFieldsFor(type, kind as never).find((d) => d.key === 'summary')!;
            expect(def.hint).toContain('照抄');
        }
    });

    it('🔴 工具的说明里必须写清「末尾会附简介原文」—— 否则模型不知道那段是要照抄的', () => {
        const meta = prefillTools().find((t) => t.function.name === PREFILL_TOOL_METADATA)!;
        expect(meta.function.description).toContain(PREFILL_SYNOPSIS_PREFIX);
        expect(meta.function.description).toContain('照抄');
    });

    it('extractToolSynopsis：带标记 ⇒ 取标记之后的全文（折成一行）', () => {
        const out = `命中 2 条：\n1. 沙丘 — 2021 · TMDB · ★8.4\n2. 沙丘 2\n\n${PREFILL_SYNOPSIS_PREFIX}保罗·厄崔迪被卷入\n一场星际争夺。`;
        expect(extractToolSynopsis(out)).toBe('保罗·厄崔迪被卷入 一场星际争夺。');
    });

    it('extractToolSynopsis：没有标记 / 空 / 非字符串 ⇒ null（⛔ 不吐空串 —— 空串会被当成「查到了一份空简介」）', () => {
        expect(extractToolSynopsis('命中 1 条：沙丘')).toBeNull();
        expect(extractToolSynopsis(`${PREFILL_SYNOPSIS_PREFIX}   `)).toBeNull();
        expect(extractToolSynopsis(null)).toBeNull();
        expect(extractToolSynopsis(undefined)).toBeNull();
    });

    it('🔴 preferToolSynopsis：**无条件覆盖**模型写的那版简介（⛔ 不比较、不择优）', () => {
        const defs = prefillFieldsFor('movie');
        const fields = { year: '2021', summary: '模型自己写的客观概述' };
        expect(preferToolSynopsis(fields, '数据源里的真简介原文', defs)).toEqual({
            year: '2021',
            summary: '数据源里的真简介原文',
        });
    });

    it('preferToolSynopsis：没查到原文 ⇒ 原样返回（模型凭记忆写的那份留下）', () => {
        const defs = prefillFieldsFor('movie');
        const fields = { summary: '模型凭记忆写的' };
        expect(preferToolSynopsis(fields, null, defs)).toBe(fields);
        expect(preferToolSynopsis(fields, '   ', defs)).toBe(fields);
    });

    it('preferToolSynopsis：该类型不问简介 ⇒ 不塞（`defs` 是白名单，⛔ 别凭空加字段）', () => {
        const fields = { year: '2021' };
        expect(preferToolSynopsis(fields, '原文', [])).toBe(fields);
        expect(preferToolSynopsis(fields, '原文', [{ key: 'year', label: '上映年', hint: 'x' }])).toBe(fields);
    });

    it('preferToolSynopsis：原文**比旧上限长**也留得住（#499E 把 summary 上限提到 800）', () => {
        const defs = prefillFieldsFor('movie');
        const long = '甲'.repeat(600);
        expect(preferToolSynopsis({}, long, defs).summary).toBe(long);
        // 病态长度照旧截断（带省略号）
        const over = preferToolSynopsis({}, '乙'.repeat(900), defs).summary!;
        expect(over.length).toBeLessThan(900);
        expect(over.endsWith('…')).toBe(true);
    });
});

// ── #508：预填要**连带作者一起搜填**（用户：「AI预填功能除了搜标题还要能一同并搜填在作者框的名称」）──
describe('#508 作者（歌手 / 导演 / 开发商）也要一并填', () => {
    it('表单里已填的作者当**线索**发过去（与年份 / 题材线索同级）', () => {
        const withAuthor = prefillBody({ type: 'music', title: '晴天', author: '周杰伦' })!;
        expect(withAuthor.messages[1].content).toContain('作者线索：周杰伦');
        // 只填空格 ⇒ 不算线索（⛔ 别把空白当作者）
        const blank = prefillBody({ type: 'music', title: '晴天', author: '   ' })!;
        expect(blank.messages[1].content).not.toContain('作者线索');
    });

    it('🔴 带工具时**点名**人名字段，并给出该用什么样的搜索词（这是本条的关键：模型爱把「人名」整条省掉）', () => {
        const m = prefillMessages({ type: 'movie', title: '沙丘' }, undefined, true)!;
        const user = m[1].content;
        expect(user).toContain('人的名字');
        expect(user).toContain('导演');
        expect(user).toContain('作品名 + 导演'); // 搜索词示例里必须点出「作品名 + 人名」
        expect(user).toContain('别因为');
    });

    it('音乐点的是「作者」、游戏点的是「开发商」—— 各类型点自己的那个人名字段（⛔ 不写死一类）', () => {
        const music = prefillMessages({ type: 'music', title: '晴天' }, undefined, true)![1].content;
        expect(music).toContain('（作者）');
        const game = prefillMessages({ type: 'game', title: '空洞骑士' }, undefined, true)![1].content;
        expect(game).toContain('（开发商）');
    });

    it('⛔ 没带工具时不加这句（单轮形态下它只会白占 token、还让模型编名字）', () => {
        const m = prefillMessages({ type: 'movie', title: '沙丘' }, undefined, false)!;
        expect(m[1].content).not.toContain('人的名字');
    });

    it('只点名「主创」那类字段（作者 / 歌手 / 导演 / 开发商）—— ⛔ 不点名 `cast`'
        + '（主演是一长串演员表，工具那轮本来就会带回来；点名反而挤占它的注意力）', () => {
        const tv = prefillMessages({ type: 'tv', title: '示例剧' }, undefined, true)![1].content;
        expect(tv).toContain('（导演）');
        expect(tv).not.toContain('（导演 / 主演）');
    });
});
