// 阅读器翻译——AI 大模型（智谱 GLM-4-Flash / DeepSeek v4 Flash）划词翻译纯逻辑（无 obsidian 依赖，可单测）。
// 责任：构造 chat/completions 请求体、解析响应文本。网络由 main.ts 用 requestUrl + Bearer Key 完成。
import { describe, it, expect } from 'vitest';
import {
    parseTranslateResponse,
    buildTranslateBody,
    buildTranslatePingBody,
    translateChatUrl,
    modelFor,
    normalizeProvider,
    ZHIPU_CHAT_URL,
    DEEPSEEK_CHAT_URL,
    ZHIPU_MODEL,
    DEEPSEEK_MODEL,
    DEFAULT_TRANSLATE_PROVIDER,
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
        expect(translateChatUrl(undefined)).toBe(ZHIPU_CHAT_URL);
    });
    it('modelFor 固定模型（r4 起用户不可配）', () => {
        expect(modelFor('zhipu')).toBe('GLM-4-Flash');
        expect(modelFor('deepseek')).toBe('deepseek-v4-flash');
    });
    it('normalizeProvider 只认 zhipu/deepseek，其余回退 zhipu', () => {
        expect(normalizeProvider('zhipu')).toBe('zhipu');
        expect(normalizeProvider('deepseek')).toBe('deepseek');
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