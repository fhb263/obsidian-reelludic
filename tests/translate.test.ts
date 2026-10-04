// 阅读器翻译——AI 大模型（智谱 GLM-4-Flash / DeepSeek v4 Flash）划词翻译纯逻辑（无 obsidian 依赖，可单测）。
// 责任：构造 chat/completions 请求体、解析响应文本。网络由 main.ts 用 requestUrl + Bearer Key 完成。
import { describe, it, expect } from 'vitest';
import {
    parseTranslateResponse,
    parseAiReply,
    buildTranslateBody,
    buildTranslatePingBody,
    PING_MAX_TOKENS,
    pickPingModel,
    DEFAULT_TRANSLATE_PROMPT,
    translateChatUrl,
    modelFor,
    resolveModel,
    providerLabel,
    normalizeProvider,
    normalizeAiChoice,
    normalizeAiBaseUrl,
    customChatUrl,
    aiBaseUrlIssue,
    aiHttpIssue,
    modelsUrl,
    parseModelList,
    mergeModelCandidates,
    contextWindowText,
    modelNote,
    modelTags,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_OFF,
    PROVIDER_MODELS,
    DEFAULT_MODELS,
    MODEL_CUSTOM,
    ZHIPU_CHAT_URL,
    DEEPSEEK_CHAT_URL,
    SILICONFLOW_CHAT_URL,
    SILICONFLOW_MODEL_ID,
    aiChoiceLabel,
    aiPickText,
    isAiOff,
    ZHIPU_MODEL,
    DEEPSEEK_MODEL,
    DEFAULT_TRANSLATE_PROVIDER,
    type TranslateProvider,
} from 'pure/translate';

describe('provider / 端点 / 固定模型', () => {
    it('常量正确', () => {
        expect(ZHIPU_CHAT_URL).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
        expect(DEEPSEEK_CHAT_URL).toBe('https://api.deepseek.com/chat/completions');
        expect(ZHIPU_MODEL).toBe('GLM-4-Flash');
        expect(DEEPSEEK_MODEL).toBe('deepseek-v4-flash');
        expect(DEFAULT_TRANSLATE_PROVIDER).toBe('zhipu');
    });
    it('translateChatUrl 按 provider 分派', () => {
        expect(translateChatUrl('zhipu')).toBe(ZHIPU_CHAT_URL);
        expect(translateChatUrl('deepseek')).toBe(DEEPSEEK_CHAT_URL);
        // #480：硅基流动有自己固定的 chat 端点（不再走 `else → 智谱` 的兜底）
        expect(translateChatUrl('siliconflow')).toBe(SILICONFLOW_CHAT_URL);
        expect(translateChatUrl(undefined)).toBe(ZHIPU_CHAT_URL);
    });
    it('modelFor 固定模型（r4 起用户不可配）', () => {
        expect(modelFor('zhipu')).toBe('GLM-4-Flash');
        expect(modelFor('deepseek')).toBe('deepseek-v4-flash');
    });
    it('normalizeProvider 只认 zhipu/deepseek，其余回退 zhipu', () => {
        expect(normalizeProvider('zhipu')).toBe('zhipu');
        expect(normalizeProvider('deepseek')).toBe('deepseek');
        expect(normalizeProvider('siliconflow')).toBe('siliconflow');
        expect(normalizeProvider(undefined)).toBe('zhipu');
        expect(normalizeProvider('openai' as never)).toBe('zhipu');
    });
});

describe('buildTranslateBody', () => {
    it('构造 OpenAI 兼容 chat 请求体：model（按 provider 固定）+ system/user 双消息', () => {
        const body = buildTranslateBody('今天天气很好', 'zhipu')!;
        expect(body.model).toBe('GLM-4-Flash');
        expect(body.stream).toBe(false);
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[1].role).toBe('user');
        expect(body.messages[1].content).toBe('今天天气很好');
    });
    it('DeepSeek provider 用 deepseek-v4-flash 模型', () => {
        const body = buildTranslateBody('hi', 'deepseek')!;
        expect(body.model).toBe('deepseek-v4-flash');
    });
    it('system 提示要求中英自动互译、只输出译文', () => {
        const body = buildTranslateBody('hi', 'zhipu')!;
        const sys = body.messages[0].content;
        expect(sys).toMatch(/Chinese/);
        expect(sys).toMatch(/English/);
        expect(sys).toMatch(/only the translation/i);
    });
    it('空文本返回 null（不该发请求）', () => {
        expect(buildTranslateBody('', 'zhipu')).toBeNull();
        expect(buildTranslateBody('   ', 'zhipu')).toBeNull();
    });
    it('provider 缺省 → 默认 zhipu + GLM-4-Flash', () => {
        const body = buildTranslateBody('hi', undefined)!;
        expect(body.model).toBe('GLM-4-Flash');
    });
    it('user 原文去首尾空白', () => {
        const body = buildTranslateBody('  hi there  ', 'zhipu')!;
        expect(body.messages[1].content).toBe('hi there');
    });
});

describe('buildTranslatePingBody', () => {
    it('测试连接用 ping 请求体：极短 user + 固定模型', () => {
        const body = buildTranslatePingBody('zhipu');
        expect(body.model).toBe('GLM-4-Flash');
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].role).toBe('user');
        expect(body.messages[0].content.length).toBeLessThan(10);
        expect(body.stream).toBe(false);
    });
    it('provider 缺省回退 zhipu', () => {
        expect(buildTranslatePingBody(undefined).model).toBe('GLM-4-Flash');
        expect(buildTranslatePingBody('deepseek').model).toBe('deepseek-v4-flash');
    });
});

describe('parseTranslateResponse', () => {
    it('OpenAI 兼容标准响应提取 choices[0].message.content 译文', () => {
        const r = parseTranslateResponse({
            choices: [{ index: 0, message: { role: 'assistant', content: 'The weather is very nice today' } }],
        });
        expect(r).toBe('The weather is very nice today');
    });
    it('choices 为空 / 缺失 → null', () => {
        expect(parseTranslateResponse({ choices: [] })).toBeNull();
        expect(parseTranslateResponse({})).toBeNull();
    });
    it('message.content 缺失但 choice.text 存在（部分兼容端点）→ 用 text', () => {
        const r = parseTranslateResponse({ choices: [{ index: 0, text: 'bonjour' }] });
        expect(r).toBe('bonjour');
    });
    it('content 非字符串 / 纯空白 → null', () => {
        expect(parseTranslateResponse({ choices: [{ message: { content: '' } }] })).toBeNull();
        expect(parseTranslateResponse({ choices: [{ message: { content: 123 } }] })).toBeNull();
        expect(parseTranslateResponse({ choices: [{ message: { content: '   ' } }] })).toBeNull();
    });
    it('非对象 / null / 数组首项非对象 → null', () => {
        expect(parseTranslateResponse(undefined)).toBeNull();
        expect(parseTranslateResponse(null)).toBeNull();
        expect(parseTranslateResponse('not-an-object' as never)).toBeNull();
        expect(parseTranslateResponse({ choices: [null] })).toBeNull();
    });
    it('content 保留首尾空白裁剪', () => {
        const r = parseTranslateResponse({ choices: [{ message: { content: '  hello  ' } }] });
        expect(r).toBe('hello');
    });
});
describe('buildTranslateBody 自定义服务提示词（设置页可改）', () => {
    it('传自定义 prompt → 作为 system；空白/缺省 → 默认英文翻译提示词', () => {
        expect(buildTranslateBody('你好', 'zhipu', '只翻译成日语')!.messages[0].content).toBe('只翻译成日语');
        expect(buildTranslateBody('你好', 'zhipu', '  ')!.messages[0].content).toBe(DEFAULT_TRANSLATE_PROMPT);
        expect(buildTranslateBody('你好', 'zhipu')!.messages[0].content).toBe(DEFAULT_TRANSLATE_PROMPT);
    });
});

describe('normalizeAiChoice（服务商 or 不启用）', () => {
    it("'zhipu' / 'deepseek' / 'off' 直通（off 不能被吃掉成 zhipu）", () => {
        expect(normalizeAiChoice('zhipu')).toBe('zhipu');
        expect(normalizeAiChoice('deepseek')).toBe('deepseek');
        expect(normalizeAiChoice('off')).toBe('off');
        expect(AI_PROVIDER_OFF).toBe('off');
    });
    it('脏数据 / 空 / 原型链键名一律回退 zhipu', () => {
        expect(normalizeAiChoice(undefined)).toBe('zhipu');
        expect(normalizeAiChoice('')).toBe('zhipu');
        expect(normalizeAiChoice('disabled')).toBe('zhipu');
        expect(normalizeAiChoice('toString')).toBe('zhipu');
        expect(normalizeAiChoice('constructor')).toBe('zhipu');
        expect(normalizeAiChoice(0)).toBe('zhipu');
    });
    it('下拉选项四项（#478 加「自定义」）且「不启用」在最后（防误选）', () => {
        // #480：硅基流动升为一等 chat 提供商
        expect(AI_PROVIDER_OPTIONS.map((o) => o.value)).toEqual(['zhipu', 'deepseek', 'siliconflow', 'custom', 'off']);
        expect(AI_PROVIDER_OPTIONS[AI_PROVIDER_OPTIONS.length - 1].label).toBe('不启用');
    });
});

// ── #478：模型可选 + 自定义 OpenAI 兼容端点 + 推理模型 + 错误可读化 ──
describe('#478 模型可选 / 自定义端点', () => {
    it('resolveModel：没选 ⇒ 该家默认；选了 ⇒ 用它；哨兵「自定义…」⇒ 回默认', () => {
        expect(resolveModel('zhipu')).toBe(ZHIPU_MODEL);
        expect(resolveModel('deepseek')).toBe(DEEPSEEK_MODEL);
        expect(resolveModel('zhipu', '')).toBe(ZHIPU_MODEL);
        expect(resolveModel('zhipu', '   ')).toBe(ZHIPU_MODEL);
        expect(resolveModel('zhipu', MODEL_CUSTOM)).toBe(ZHIPU_MODEL);
        expect(resolveModel('zhipu', 'glm-4.7-flash')).toBe('glm-4.7-flash');
        // 未知 / undefined provider 一律按 zhipu 兜底
        expect(resolveModel(undefined, 'x')).toBe('x');
        expect(resolveModel('nope' as TranslateProvider, '')).toBe(ZHIPU_MODEL);
    });
    it('🔴 自定义端点没有默认模型（空 ⇒ 空串，调用方必须先拦，别发空模型名）', () => {
        expect(DEFAULT_MODELS.custom).toBe('');
        expect(resolveModel('custom')).toBe('');
        expect(resolveModel('custom', MODEL_CUSTOM)).toBe('');
        expect(resolveModel('custom', ' gpt-4o-mini ')).toBe('gpt-4o-mini');
    });
    it('预置模型清单：内置两家非空且都含各自默认值；custom 无预置（模型名由用户填）', () => {
        expect(PROVIDER_MODELS.zhipu.length).toBeGreaterThan(0);
        expect(PROVIDER_MODELS.deepseek.length).toBeGreaterThan(0);
        expect(PROVIDER_MODELS.custom).toEqual([]);
        expect(PROVIDER_MODELS.zhipu.some((o) => o.value === ZHIPU_MODEL)).toBe(true);
        expect(PROVIDER_MODELS.deepseek.some((o) => o.value === DEEPSEEK_MODEL)).toBe(true);
    });
    it('normalizeAiBaseUrl：补 scheme、去尾斜杠；空/非字符串 ⇒ 空串', () => {
        expect(normalizeAiBaseUrl('api.example.com/v1/')).toBe('https://api.example.com/v1');
        expect(normalizeAiBaseUrl('  https://x.cn/v1/  ')).toBe('https://x.cn/v1');
        expect(normalizeAiBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
        expect(normalizeAiBaseUrl('')).toBe('');
        expect(normalizeAiBaseUrl(undefined)).toBe('');
        expect(normalizeAiBaseUrl(42)).toBe('');
    });
    it('customChatUrl：base 补 /chat/completions；已含端点不重复拼（重复拼会 404）', () => {
        expect(customChatUrl('https://x.cn/v1')).toBe('https://x.cn/v1/chat/completions');
        expect(customChatUrl('https://x.cn/v1/')).toBe('https://x.cn/v1/chat/completions');
        expect(customChatUrl('https://x.cn/v1/chat/completions')).toBe('https://x.cn/v1/chat/completions');
        expect(customChatUrl('')).toBe('');
    });
    it('aiBaseUrlIssue：空 / 非 http(s) scheme / 格式错 / 合法', () => {
        expect(aiBaseUrlIssue('')).not.toBeNull();
        expect(aiBaseUrlIssue('   ')).not.toBeNull();
        // 🔴 写单测时抓到的假通过：`ftp://x` 曾被「缺 scheme 就补 https」掩盖成 https://ftp://x
        expect(aiBaseUrlIssue('ftp://x.cn')).not.toBeNull();
        expect(aiBaseUrlIssue('https://')).not.toBeNull();
        expect(aiBaseUrlIssue('api.example.com/v1')).toBeNull();
        expect(aiBaseUrlIssue('https://api.example.com/v1')).toBeNull();
        expect(aiBaseUrlIssue('http://localhost:11434/v1')).toBeNull();
    });
    it('translateChatUrl：custom 走用户自填（没填 ⇒ 空串）；内置两家仍是固定端点', () => {
        expect(translateChatUrl('custom', 'https://x.cn/v1')).toBe('https://x.cn/v1/chat/completions');
        expect(translateChatUrl('custom', '')).toBe('');
        expect(translateChatUrl('custom')).toBe('');
        expect(translateChatUrl('deepseek')).toBe(DEEPSEEK_CHAT_URL);
        expect(translateChatUrl('zhipu')).toBe(ZHIPU_CHAT_URL);
    });
    it('providerLabel 三家（错误文案的唯一真源）', () => {
        expect(providerLabel('zhipu')).toBe('智谱');
        expect(providerLabel('deepseek')).toBe('DeepSeek');
        expect(providerLabel('custom')).toBe('自定义端点');
        expect(providerLabel('nope' as TranslateProvider)).toBe('智谱');
    });
    it('normalizeProvider / normalizeAiChoice 都认 custom（normalizeAiChoice 仍保住 off）', () => {
        expect(normalizeProvider('custom')).toBe('custom');
        expect(normalizeAiChoice('custom')).toBe('custom');
        expect(normalizeAiChoice(AI_PROVIDER_OFF)).toBe('off');
        expect(normalizeAiChoice('java')).toBe('zhipu');
    });
    it('请求体带上选中的模型（翻译 / ping 两处）', () => {
        expect(buildTranslateBody('hi', 'zhipu', undefined, 'glm-4.7-flash')?.model).toBe('glm-4.7-flash');
        expect(buildTranslateBody('hi', 'zhipu')?.model).toBe(ZHIPU_MODEL);
        expect(buildTranslatePingBody('deepseek', 'deepseek-chat').model).toBe('deepseek-chat');
        expect(buildTranslatePingBody('custom', 'gpt-4o-mini').model).toBe('gpt-4o-mini');
    });
    it('modelFor 与 resolveModel 一致（旧调用点行为不变）', () => {
        expect(modelFor('zhipu')).toBe(resolveModel('zhipu'));
        expect(modelFor('deepseek')).toBe(resolveModel('deepseek'));
    });
});

describe('#478 推理模型兼容 + 错误可读化', () => {
    it('parseAiReply：content 优先；顶层 text 兜底', () => {
        expect(parseAiReply({ choices: [{ message: { content: ' 译文 ' } }] })).toEqual({ ok: true, text: '译文' });
        expect(parseAiReply({ choices: [{ text: '译文' }] })).toEqual({ ok: true, text: '译文' });
    });
    it('parseAiReply：形状不对 ⇒ shape；空内容 ⇒ empty', () => {
        expect(parseAiReply(null)).toEqual({ ok: false, reason: 'shape' });
        expect(parseAiReply({})).toEqual({ ok: false, reason: 'shape' });
        expect(parseAiReply({ choices: [] })).toEqual({ ok: false, reason: 'shape' });
        expect(parseAiReply({ choices: [{ message: { content: '   ' } }] })).toEqual({ ok: false, reason: 'empty' });
    });
    it('🔴 推理模型只吐思维链 ⇒ reasoning-only（⛔ 绝不把思维链当答案返回）', () => {
        expect(parseAiReply({
            choices: [{ message: { content: '', reasoning_content: '先想一想…' } }],
        })).toEqual({ ok: false, reason: 'reasoning-only' });
        // 有 content 时仍以 content 为准（reasoning_content 只是附带）
        expect(parseAiReply({
            choices: [{ message: { content: '答案', reasoning_content: '思考' } }],
        })).toEqual({ ok: true, text: '答案' });
    });
    it('parseTranslateResponse 兼容旧签名（推理模型同样返回 null）', () => {
        expect(parseTranslateResponse({ choices: [{ message: { content: 'x' } }] })).toBe('x');
        expect(parseTranslateResponse({ choices: [{ message: { content: '', reasoning_content: 'r' } }] })).toBeNull();
    });
    it('aiHttpIssue：401/402/403/404/429 各说各的；其余（含 200/500）⇒ null 交给调用方兜底', () => {
        expect(aiHttpIssue(401, '智谱')).toContain('API Key 无效');
        // 🔴 立这条的由来：402 原来会落到笼统的「失败（HTTP 402）」，用户看不出是账户没钱
        expect(aiHttpIssue(402, '智谱')).toContain('余额不足');
        expect(aiHttpIssue(403, '智谱')).toContain('无权访问');
        expect(aiHttpIssue(404, '智谱')).toContain('模型不存在');
        expect(aiHttpIssue(429, '智谱')).toContain('频繁');
        expect(aiHttpIssue(200, '智谱')).toBeNull();
        expect(aiHttpIssue(500, '智谱')).toBeNull();
        expect(aiHttpIssue(401, '自定义端点')).toContain('自定义端点');
    });
});

// ── #479：模型「可获取」—— /models 端点派生 + 响应解析 + 候选合并 ──────────────────
describe('AI 模型列表（#479）', () => {
    it('modelsUrl 由 chat 端点派生（单一真源，别为每家另抄字面量）', () => {
        expect(modelsUrl('zhipu')).toBe('https://open.bigmodel.cn/api/paas/v4/models');
        expect(modelsUrl('deepseek')).toBe('https://api.deepseek.com/models');
        // 派生而非硬编码：chat 端点的域名/版本段变了，这里跟着变
        expect(modelsUrl('zhipu')).toBe(ZHIPU_CHAT_URL.replace('/chat/completions', '/models'));
        expect(modelsUrl('deepseek')).toBe(DEEPSEEK_CHAT_URL.replace('/chat/completions', '/models'));
    });

    it('modelsUrl 对自定义端点：补 /models；没填 base ⇒ 空串（调用方须先判）', () => {
        expect(modelsUrl('custom', 'https://api.example.com/v1')).toBe('https://api.example.com/v1/models');
        // 有人习惯把整条 chat 端点贴进来 —— 不能拼成 …/chat/completions/models
        expect(modelsUrl('custom', 'https://api.example.com/v1/chat/completions')).toBe(
            'https://api.example.com/v1/models',
        );
        expect(modelsUrl('custom')).toBe('');
        expect(modelsUrl('custom', 'https://')).toBe('');
    });

    it('parseModelList：认 data[].id / models[].name / 纯字符串，去重且按字典序', () => {
        // #482 起返回**带元数据的对象** ⇒ 判据改按 value 比对（ids）
        const ids = (raw: unknown) => parseModelList(raw).map((m) => m.value);
        expect(ids({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual(['a', 'b']);
        expect(ids({ models: [{ name: 'z' }, { id: 'y' }] })).toEqual(['y', 'z']);
        expect(ids({ data: ['m2', 'm1'] })).toEqual(['m1', 'm2']);
        // 真实响应里的噪声项要跳过，不能把 id 写成 undefined
        expect(ids({ data: [{ id: 'ok' }, {}, null, { id: '   ' }] })).toEqual(['ok']);
    });

    it('🔴 #482：解析**只带真有的**元数据（DeepSeek 给 name/上下文/模态，智谱与硅基只给 id）', () => {
        // 实测形态（DeepSeek）：id + name + context_window + input_modalities
        const ds = parseModelList({
            data: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1048576, input_modalities: ['text', 'image'] }],
        });
        expect(ds).toEqual([
            { value: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576, imageInput: true },
        ]);
        // 实测形态（智谱 / 硅基流动）：只有 id、object、created、owned_by ⇒ 元数据**一个都不许编**
        const zp = parseModelList({ data: [{ id: 'glm-4.5', object: 'model', created: 1753632000, owned_by: 'z-ai' }] });
        expect(zp).toEqual([{ value: 'glm-4.5' }]);
        // name 与 id 相同时不重复带（否则小字会写成「同名 · 同名」）
        expect(parseModelList({ data: [{ id: 'same', name: 'same' }] })).toEqual([{ value: 'same' }]);
        // 脏数据：context_window 为 0 / 负数 / 非数字 ⇒ 一律不带
        expect(parseModelList({ data: [{ id: 'x', context_window: 0 }] })).toEqual([{ value: 'x' }]);
        expect(parseModelList({ data: [{ id: 'x', context_window: '4096' }] })).toEqual([{ value: 'x' }]);
    });

    it('parseModelList：非预期结构 ⇒ 空数组（上层据此说「没取到」，不是崩）', () => {
        expect(parseModelList(null)).toEqual([]);
        expect(parseModelList('nope')).toEqual([]);
        expect(parseModelList({})).toEqual([]);
        expect(parseModelList({ error: { message: 'x' } })).toEqual([]);
    });

    it('mergeModelCandidates：真实列表在前、去重、预置补后（且预置带注解 label）', () => {
        const zhipu = mergeModelCandidates('zhipu', ['glm-5', 'GLM-4-Flash']);
        expect(zhipu[0]).toEqual({ value: 'glm-5', label: 'glm-5', fromApi: true, isDefault: false });
        // 已获取里已有 GLM-4-Flash ⇒ 预置那条不再重复出现
        expect(zhipu.filter((o) => o.value === 'GLM-4-Flash')).toHaveLength(1);
        expect(zhipu[0].fromApi).toBe(true);
        // 预置里只有它有的项仍在（带注解），排在真实列表之后
        expect(zhipu.some((o) => o.value === 'glm-4.7-flash' && o.label.includes('推理'))).toBe(true);
        expect(zhipu.findIndex((o) => o.value === 'glm-4.7-flash')).toBeGreaterThan(1);
    });

    it('mergeModelCandidates：自定义端点无预置 ⇒ 只返回已获取的', () => {
        expect(mergeModelCandidates('custom', [])).toEqual([]);
        expect(mergeModelCandidates('custom', ['qwen-max'])).toEqual([
            { value: 'qwen-max', label: 'qwen-max', fromApi: true, isDefault: false },
        ]);
    });

    // ── #482：卡片式列表项（名字 + 小字 + 小签）—— 小字只写真信息 ──
    it('contextWindowText：1048576 ⇒ 1M、128000 ⇒ 128k；没有/零/负数 ⇒ 空串（⛔ 不许显示成 0）', () => {
        expect(contextWindowText(1048576)).toBe('1M');
        expect(contextWindowText(128000)).toBe('128k');
        expect(contextWindowText(65536)).toBe('66k');
        expect(contextWindowText(512)).toBe('512');
        expect(contextWindowText(undefined)).toBe('');
        expect(contextWindowText(0)).toBe('');
        expect(contextWindowText(-1)).toBe('');
    });

    it('🔴 #482：小字**优先写真元数据**；没有 ⇒ 写来源（被删的蓝色 API 签的信息不能跟着丢）', () => {
        expect(modelNote({ label: 'deepseek-flash', fromApi: true, name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576, imageInput: true }))
            .toBe('DeepSeek-V4.1-Flash · 上下文 1M · 支持图片输入');
        // 智谱 / 硅基流动只有 id ⇒ 只能写来源
        expect(modelNote({ label: 'glm-4.5', fromApi: true })).toBe('来自服务商 · 该 Key 当下可用');
        expect(modelNote({ label: 'GLM-4-Flash', fromApi: false })).toBe('插件内置候选（可能过期）');
        // 预置的括号注解就是它唯一「真有」的说明 ⇒ 拿来当小字
        expect(modelNote({ label: 'GLM-4.7-Flash（推理，较慢）', fromApi: false })).toBe('推理，较慢');
    });

    it('🔴 #482：小签只按 id / 真字段判定，且**不与小字重复**', () => {
        expect(modelTags('deepseek-reasoner', {})).toEqual(['推理']);
        expect(modelTags('glm-4.7-flash', {})).toEqual([]); // id 里没有推理关键词 ⇒ ⛔ 不猜
        expect(modelTags('qwen-vl-max', {})).toEqual(['多模态']);
        expect(modelTags('deepseek-flash', { imageInput: true })).toEqual(['多模态']);
        expect(modelTags('glm-5', { isDefault: true })).toEqual(['推荐']);
        // 小字里已经写了「推理，较慢」⇒ 小签不再重复一个「推理」
        expect(modelTags('glm-4.7-flash', {}, '推理，较慢')).toEqual([]);
    });

    it('🔴 #482：合并候选带上 isDefault / 真元数据（「推荐」小签的判据，⛔ 不在渲染层另判一次）', () => {
        const all = mergeModelCandidates('deepseek', [
            { value: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576 },
        ]);
        expect(all[0]).toEqual({
            value: 'deepseek-flash', label: 'deepseek-flash', fromApi: true,
            isDefault: false, name: 'DeepSeek-V4.1-Flash', contextWindow: 1048576,
        });
        // 默认模型 ⇒ isDefault（DEEPSEEK_MODEL）
        expect(all.find((o) => o.value === 'deepseek-v4-flash')?.isDefault).toBe(true);
        // 混合输入（字符串 / 对象）都认
        expect(mergeModelCandidates('custom', ['a'])[0].value).toBe('a');
    });
});

// ── #480：合并控件文案（`智谱 GLM · glm-5-turbo`）+ 硅基流动升为一等 chat 提供商 ──────
describe('AI 服务商合并控件与硅基流动（#480）', () => {
    it('🔴 硅基流动是一等 chat 提供商：有端点 / 默认模型 / 预置候选，显示名真源也认它', () => {
        expect(SILICONFLOW_CHAT_URL).toBe('https://api.siliconflow.cn/v1/chat/completions');
        expect(providerLabel('siliconflow')).toBe('硅基流动');
        expect(DEFAULT_MODELS.siliconflow).toBe(SILICONFLOW_MODEL_ID);
        expect(PROVIDER_MODELS.siliconflow.length).toBeGreaterThan(0);
        // 默认模型必须在预置候选里（否则合并控件一打开就是「非预置」观感）
        expect(PROVIDER_MODELS.siliconflow.some((o) => o.value === SILICONFLOW_MODEL_ID)).toBe(true);
        // 归一：它不能再被吃成 zhipu（那样「选了硅基流动却打智谱」）
        expect(normalizeProvider('siliconflow')).toBe('siliconflow');
        expect(normalizeAiChoice('siliconflow')).toBe('siliconflow');
        expect(modelsUrl('siliconflow')).toBe('https://api.siliconflow.cn/v1/models');
    });

    it('aiChoiceLabel：显示名与下拉选项**同源**（⛔ 别在视图层另抄一份）', () => {
        expect(aiChoiceLabel('zhipu')).toBe('智谱 GLM');
        expect(aiChoiceLabel('siliconflow')).toBe('硅基流动');
        expect(aiChoiceLabel('off')).toBe('不启用');
    });

    it('aiPickText：`服务商 · 模型`；🔴「不启用」**不带模型段**（#480 ①：别再亮着一个模型名）', () => {
        expect(aiPickText('zhipu', 'glm-5-turbo')).toBe('智谱 GLM · glm-5-turbo');
        expect(aiPickText('siliconflow', 'deepseek-ai/DeepSeek-V4-Flash')).toBe('硅基流动 · deepseek-ai/DeepSeek-V4-Flash');
        // 选了「不启用」，即便字段里还留着旧模型名，也**不许**显示
        expect(aiPickText('off', 'GLM-4-Flash')).toBe('不启用');
        // 模型空（custom 没填）⇒ 只显示服务商名，不出现孤零零的分隔点
        expect(aiPickText('custom', '')).toBe('自定义（OpenAI 兼容）');
        expect(aiPickText('custom', '   ')).toBe('自定义（OpenAI 兼容）');
    });

    it('isAiOff：只有「不启用」为真（用归一口径，脏数据不会误判成 off）', () => {
        expect(isAiOff('off')).toBe(true);
        expect(isAiOff('zhipu')).toBe(false);
        expect(isAiOff(undefined)).toBe(false);
        expect(isAiOff('OFF')).toBe(false);
    });
});

describe('#486 ping：限制输出长度 + 「测哪家就用哪家的模型」', () => {
    it('🔴 ping 必须带 `max_tokens`（= `PING_MAX_TOKENS`）—— 实测智谱不限制要 8~12s，会撞上 10s 超时线', () => {
        const body = buildTranslatePingBody('zhipu');
        expect(body.max_tokens).toBe(PING_MAX_TOKENS);
        expect(PING_MAX_TOKENS).toBe(16);
        // ⛔ 正式翻译的请求体**不许**带它（会把译文截断）
        const real = buildTranslateBody('hello', 'zhipu');
        expect(real?.max_tokens).toBeUndefined();
    });

    it('🔴 自定义端点：ping 该用**这条端点自己的**模型，⛔ 不是「翻译服务」那家的', () => {
        // 实测 91hub：361 个里第一个是视频模型 ⇒ 必须跳过
        expect(pickPingModel(['MiniMax-Hailuo-2.3', 'gpt-5.6', 'qwen-vl-max-latest'])).toBe('gpt-5.6');
        // 按 id 排除：image / video / tts / embedding / bge / rerank / whisper …
        expect(pickPingModel(['text-embedding-v3', 'BAAI/bge-large', 'glm-4'])).toBe('glm-4');
        expect(pickPingModel(['qwen-image-edit', 'tts-1', 'speech-01', 'deepseek-chat'])).toBe('deepseek-chat');
        expect(pickPingModel(['sora-2', 'kling-v1', 'flux-dev', 'grok-3'])).toBe('grok-3');
    });

    it('pickPingModel 的兜底：全是非文本 ⇒ 退回第一个；空列表 ⇒ 用 fallback', () => {
        // 全是非文本模型时不能再返回 ''（那会让 ping 直接失败且说不清原因）⇒ 退回第一个，让端点自己报
        expect(pickPingModel(['video-01', 'image-02'])).toBe('video-01');
        expect(pickPingModel([], 'glm-4')).toBe('glm-4');
        expect(pickPingModel(['', '  ', 'gpt-4'])).toBe('gpt-4');
    });
});
