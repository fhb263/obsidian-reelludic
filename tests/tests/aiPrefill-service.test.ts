import { describe, expect, it } from 'vitest';
import { AiPrefillService, type AiPrefillConfig, type AiPrefillHttpOptions } from 'services/aiPrefill';
import { ZHIPU_CHAT_URL } from 'pure/translate';

type Call = AiPrefillHttpOptions;

function harness(
    cfg: Partial<AiPrefillConfig>,
    reply: { status: number; text: string } | (() => { status: number; text: string }),
) {
    const calls: Call[] = [];
    const notes: string[] = [];
    const svc = new AiPrefillService({
        getConfig: () => ({ provider: 'zhipu', key: 'k-1', ...cfg }),
        notify: (m) => { notes.push(m); },
        http: async (opts) => {
            calls.push(opts);
            return typeof reply === 'function' ? reply() : reply;
        },
    });
    return { svc, calls, notes };
}

const okReply = (content: string) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content } }] }) });

describe('AiPrefillService', () => {
    it('正常：POST 到该服务商端点，带 Bearer；返回字段表（解析走纯模块）', async () => {
        const h = harness({}, okReply('{"year":"2021","cast":"甲 / 乙"}'));
        const r = await h.svc.generate({ type: 'movie', title: '沙丘' });
        expect(r).toEqual({ fields: { year: '2021', cast: '甲 / 乙' }, sources: [] });
        expect(h.calls).toHaveLength(1);
        expect(h.calls[0].url).toBe(ZHIPU_CHAT_URL);
        expect(h.calls[0].method).toBe('POST');
        expect(h.calls[0].headers?.Authorization).toBe('Bearer k-1');
        expect(JSON.parse(h.calls[0].body!)).toMatchObject({ stream: false });
    });

    it('自定义端点地址：走 main 解析好的 url（⛔ 不在这里再判 provider）', async () => {
        const h = harness({ provider: 'custom', url: 'https://relay.example.com/v1/chat/completions' }, okReply('{"year":"2001"}'));
        await h.svc.generate({ type: 'movie', title: 'x' });
        expect(h.calls[0].url).toBe('https://relay.example.com/v1/chat/completions');
    });

    it('配置 issue 非空 ⇒ **不发请求**，直接把它报给用户', async () => {
        const h = harness({ issue: '未配置智谱 API Key，请先到 设置 → AI集成 · 模型服务 填写' }, okReply('{}'));
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r).toBeNull();
        expect(h.calls).toHaveLength(0);
        expect(h.notes[0]).toContain('未配置智谱 API Key');
    });

    it('缺 Key ⇒ 不发请求（配置层没拦到时兜底），文案提到 API Key', async () => {
        const h = harness({ key: '' }, okReply('{}'));
        await h.svc.generate({ type: 'movie', title: 'x' });
        expect(h.calls).toHaveLength(0);
        expect(h.notes[0]).toContain('API Key');
    });

    it('标题为空 ⇒ 请求体为 null ⇒ 不发请求', async () => {
        const h = harness({}, okReply('{}'));
        await h.svc.generate({ type: 'movie', title: '   ' });
        expect(h.calls).toHaveLength(0);
    });

    it('HTTP 401 / 402 / 429 走 aiHttpIssue 的可读文案（不是笼统的「HTTP 4xx」）', async () => {
        for (const [status, word] of [[401, 'API Key 无效'], [402, '余额不足'], [429, '请求过于频繁']] as const) {
            const h = harness({}, { status, text: '' });
            const r = await h.svc.generate({ type: 'movie', title: 'x' });
            expect(r).toBeNull();
            expect(h.notes.some((n) => n.includes(word))).toBe(true);
        }
    });

    it('响应不是 JSON ⇒ 明确说「响应非 JSON」（而不是静默失败）', async () => {
        const h = harness({}, { status: 200, text: '<html>502</html>' });
        expect(await h.svc.generate({ type: 'movie', title: 'x' })).toBeNull();
        expect(h.notes.some((n) => n.includes('响应非 JSON'))).toBe(true);
    });

    it('🔴 推理模型只给思维链 ⇒ 专用文案（提示去换非推理模型），而不是笼统失败', async () => {
        const h = harness({}, { status: 200, text: JSON.stringify({ choices: [{ message: { reasoning_content: '嗯…' } }] }) });
        expect(await h.svc.generate({ type: 'movie', title: 'x' })).toBeNull();
        expect(h.notes.some((n) => n.includes('只返回了思考过程'))).toBe(true);
    });

    it('模型给了 JSON 但一个可用字段都没有 ⇒ 提示换个线索再试（不是「失败」）', async () => {
        const h = harness({}, okReply('{"rating":5,"notes":"x"}'));
        expect(await h.svc.generate({ type: 'movie', title: 'x' })).toBeNull();
        expect(h.notes.some((n) => n.includes('没有给出可用字段'))).toBe(true);
    });

    it('传输层抛错 ⇒ 文案带原因与端点（用户据此判断是网络还是 Key）', async () => {
        const h = harness({}, () => { throw new Error('ENOTFOUND open.bigmodel.cn'); });
        expect(await h.svc.generate({ type: 'movie', title: 'x' })).toBeNull();
        expect(h.notes.some((n) => n.includes('ENOTFOUND') && n.includes(ZHIPU_CHAT_URL))).toBe(true);
    });

    it('传入自定义提示词 / 模型 ⇒ 都进了请求体', async () => {
        const h = harness({ prompt: '我的预填提示词', model: 'my-model' }, okReply('{"year":"2001"}'));
        await h.svc.generate({ type: 'movie', title: 'x' });
        const body = JSON.parse(h.calls[0].body!);
        expect(body.model).toBe('my-model');
        expect(body.messages[0].content).toBe('我的预填提示词');
    });
});

// ──────────── #499D agent 工具回路（实测口径见 pure 侧注释与 `_probe_loop_499e.cjs`）────────────
type Reply = { status: number; text: string } | ((body: unknown) => { status: number; text: string });

function loopHarness(opts: {
    replies: Reply[];
    cfg?: Partial<AiPrefillConfig>;
    runTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
}) {
    const calls: Call[] = [];
    const notes: string[] = [];
    const steps: string[] = [];
    const toolArgs: { name: string; args: Record<string, unknown> }[] = [];
    let i = 0;
    const svc = new AiPrefillService({
        getConfig: () => ({ provider: 'zhipu', key: 'k-1', ...opts.cfg }),
        notify: (m) => { notes.push(m); },
        http: async (o) => {
            calls.push(o);
            const r = opts.replies[Math.min(i++, opts.replies.length - 1)];
            return typeof r === 'function' ? r(JSON.parse(o.body ?? '{}')) : r;
        },
        onStep: (l) => { steps.push(l); },
        ...(opts.runTool
            ? { runTool: async (name: string, args: Record<string, unknown>) => { toolArgs.push({ name, args }); return opts.runTool!(name, args); } }
            : {}),
    });
    return { svc, calls, notes, steps, toolArgs };
}

const toolCall = (name: string, args: Record<string, unknown>, id = 'call_1') => ({
    status: 200,
    text: JSON.stringify({
        choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
    }),
});

describe('AiPrefillService · agent 工具回路', () => {
    it('🔴 模型要工具 ⇒ 本地执行 ⇒ 结果按 `role:tool` 喂回 ⇒ 第 2 轮收尾成字段；来源被记账', async () => {
        const h = loopHarness({
            replies: [toolCall('web_search', { query: '沙丘 导演' }), okReply('{"year":"2021","directorWriters":"丹尼斯·维伦纽瓦"}')],
            runTool: async () => '搜索「沙丘 导演」的前 2 条结果：\n1. 沙丘 - 维基百科 — 2021 年电影',
        });
        const r = await h.svc.generate({ type: 'movie', title: '沙丘' });
        expect(r).toEqual({ fields: { year: '2021', directorWriters: '丹尼斯·维伦纽瓦' }, sources: ['网络搜索'] });
        expect(h.toolArgs[0]).toEqual({ name: 'web_search', args: { query: '沙丘 导演' } });
        expect(h.steps).toEqual(['搜索网络：沙丘 导演']);
        expect(h.calls).toHaveLength(2);
        // 第 2 轮必须**真的**把 assistant(tool_calls) + tool 结果带上（少了任何一条端点都会 400）
        const body2 = JSON.parse(h.calls[1].body!);
        expect(body2.messages.some((m: { role: string; tool_calls?: unknown }) => m.role === 'assistant' && Array.isArray(m.tool_calls))).toBe(true);
        const toolMsg = body2.messages.find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg).toMatchObject({ tool_call_id: 'call_1' });
        expect(toolMsg.content).toContain('维基百科');
    });

    it('模型不需要工具 ⇒ **只发一轮**，sources 空（= 纯凭记忆，界面会如实写出来）', async () => {
        const h = loopHarness({ replies: [okReply('{"year":"2021"}')], runTool: async () => 'x' });
        const r = await h.svc.generate({ type: 'movie', title: '沙丘' });
        expect(r).toEqual({ fields: { year: '2021' }, sources: [] });
        expect(h.calls).toHaveLength(1);
        expect(h.steps).toEqual([]);
    });

    it('🔴 没有工具执行器（宿主没接线 / 移动端）⇒ 请求体里**没有 tools**（#499 单轮形态原样保留）', async () => {
        const h = loopHarness({ replies: [okReply('{"year":"2021"}')] });
        await h.svc.generate({ type: 'movie', title: '沙丘' });
        expect(JSON.parse(h.calls[0].body!).tools).toBeUndefined();
    });

    it('🔴 工具**失败不打断回路**：把原因交回模型，用户仍能拿到字段', async () => {
        const h = loopHarness({
            replies: [toolCall('web_search', { query: 'x' }), okReply('{"year":"2021"}')],
            runTool: async () => { throw new Error('HTTP 429'); },
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r?.fields).toEqual({ year: '2021' });
        const toolMsg = JSON.parse(h.calls[1].body!).messages.find((m: { role: string }) => m.role === 'tool');
        expect(toolMsg.content).toContain('工具执行失败');
        expect(toolMsg.content).toContain('429');
    });

    it('🔴 **能力回落**：端点把 tools 吞了（200 + 散文，既无工具调用也无字段）⇒ 去掉工具重发一次 + 如实提示', async () => {
        const h = loopHarness({
            replies: [
                { status: 200, text: '{"choices":[{"message":{"content":"抱歉，我无法调用 lookup_metadata 工具。"}}]}' },
                okReply('{"year":"2021"}'),
            ],
            runTool: async () => 'x',
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r).toEqual({ fields: { year: '2021' }, sources: [] });
        expect(h.calls).toHaveLength(2);
        expect(JSON.parse(h.calls[0].body!).tools).toHaveLength(2);
        expect(JSON.parse(h.calls[1].body!).tools).toBeUndefined(); // 第二次不再带
        expect(h.notes.some((n) => n.includes('不支持工具调用'))).toBe(true);
    });

    it('🔴 轮数用尽 ⇒ **强制收尾**：再要一次「不带工具、只输出 JSON」（⛔ 别无限查下去）', async () => {
        const h = loopHarness({
            replies: [
                toolCall('web_search', { query: 'a' }, 'c1'),
                toolCall('web_search', { query: 'b' }, 'c2'),
                toolCall('web_search', { query: 'c' }, 'c3'),
                okReply('{"year":"2021"}'),
            ],
            runTool: async () => '结果',
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r?.fields).toEqual({ year: '2021' });
        expect(h.toolArgs.map((t) => (t.args as { query: string }).query)).toEqual(['a', 'b', 'c']);
        expect(h.calls).toHaveLength(4); // 3 轮 + 1 次强制收尾
        const finalBody = JSON.parse(h.calls[3].body!);
        expect(finalBody.tools).toBeUndefined();
        expect(finalBody.messages.at(-1).content).toContain('不要再调用工具');
    });

    it('查了资料却整理不出字段 ⇒ 专用提示（与「模型没给字段」区分开：用户能判断是换个模型还是换关键词）', async () => {
        const h = loopHarness({
            replies: [toolCall('web_search', { query: 'a' }, 'c1'), toolCall('web_search', { query: 'b' }, 'c2'), toolCall('web_search', { query: 'c' }, 'c3'), okReply('我查完了，但没什么可填的。')],
            runTool: async () => '结果',
        });
        expect(await h.svc.generate({ type: 'movie', title: 'x' })).toBeNull();
        expect(h.notes.some((n) => n.includes('没能整理出字段'))).toBe(true);
    });
});

// ──────────── #499E 简介照搬工具原文（用户：「不应该是搜索照搬真正作品的简介吗」）────────────
describe('AiPrefillService · 简介照搬', () => {
    it('🔴 工具结果带「简介原文」⇒ **照搬覆盖**模型自己写的那版（模型爱顺手润色，所以不交给它拿主意）', async () => {
        const h = loopHarness({
            replies: [
                toolCall('lookup_metadata', { title: '沙丘', type: 'movie' }),
                okReply('{"year":"2021","summary":"一部关于厄崔迪家族与沙丘星的科幻电影。"}'),
            ],
            runTool: async () => '命中 1 条：\n1. 沙丘 — 2021 · TMDB · ★8.4\n\n简介原文：保罗·厄崔迪被卷入一场星际争夺，为家族与命运而战。',
        });
        const r = await h.svc.generate({ type: 'movie', title: '沙丘' });
        expect(r!.fields.summary).toBe('保罗·厄崔迪被卷入一场星际争夺，为家族与命运而战。');
        expect(r!.fields.year).toBe('2021'); // 别的字段照旧听模型的
        expect(r!.sources).toEqual(['元数据源']);
    });

    it('工具没查到简介 ⇒ 模型凭记忆写的那份留下（并在依据里如实说「凭模型记忆」）', async () => {
        const h = loopHarness({
            replies: [toolCall('lookup_metadata', { title: '某冷门作', type: 'movie' }), okReply('{"summary":"模型凭记忆写的概述"}')],
            runTool: async () => '命中 1 条：\n1. 某冷门作 — 1999 · 豆瓣',
        });
        const r = await h.svc.generate({ type: 'movie', title: '某冷门作' });
        expect(r!.fields.summary).toBe('模型凭记忆写的概述');
    });

    it('🔴 简介原文**只认首个**：后一轮的搜索结果不能改写已锁定的那份', async () => {
        const h = loopHarness({
            replies: [
                toolCall('lookup_metadata', { title: 'x', type: 'movie' }, 'c1'),
                toolCall('web_search', { query: 'x 简介' }, 'c2'),
                okReply('{}'),
            ],
            runTool: async (name) =>
                name === 'lookup_metadata'
                    ? `命中 1 条：\n1. x\n\n简介原文：**真正的**作品简介`
                    : `搜索「x 简介」的前 2 条结果：\n1. 某百科\n\n简介原文：某个网页上抄来的二手描述`,
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r!.fields.summary).toBe('**真正的**作品简介');
    });

    it('🔴 模型一个字段都没给出、但工具查到了简介 ⇒ 仍然有可填的（简介这一行就能立住）', async () => {
        const h = loopHarness({
            replies: [toolCall('lookup_metadata', { title: 'x', type: 'movie' }), okReply('{}')],
            runTool: async () => `命中 1 条：\n1. x\n\n简介原文：只有简介也值得落下来`,
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r!.fields).toEqual({ summary: '只有简介也值得落下来' });
    });

    it('工具**失败**（没吐简介）⇒ 不误伤模型写的简介', async () => {
        const h = loopHarness({
            replies: [toolCall('lookup_metadata', { title: 'x', type: 'movie' }), okReply('{"summary":"模型写的"}')],
            runTool: async () => { throw new Error('HTTP 429'); },
        });
        const r = await h.svc.generate({ type: 'movie', title: 'x' });
        expect(r!.fields.summary).toBe('模型写的');
    });
});
