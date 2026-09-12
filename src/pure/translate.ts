// 阅读器翻译——AI 大模型划词翻译纯逻辑（纯函数，无 obsidian 依赖，可单测）。
// 责任：构造 OpenAI 兼容 chat/completions 请求体、解析响应文本；
// 网络请求由 main.ts 用 requestUrl 完成（Bearer API Key 在 header 注入）。
// 与 bookmark.ts / readingProgress.ts 同风格：解析容错、常量集中、无副作用。

/** 支持的翻译服务商 */
export type TranslateProvider = 'zhipu' | 'deepseek';

/** 智谱 GLM chat/completions 端点（open.bigmodel.cn v4，OpenAI 兼容；用户 cform 现用端点） */
export const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
/** DeepSeek chat/completions 端点（OpenAI 兼容；官方 base https://api.deepseek.com） */
export const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

/** 智谱默认模型（GLM-4-Flash 免费；其他 GLM 模型需付费）——批3 r4 固定 */
export const ZHIPU_MODEL = 'GLM-4-Flash';
/** DeepSeek 默认模型（deepseek-v4-flash 免费 v4 Flash）——批3 r4 固定 */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';

/** 默认服务商（用户 cform 已在用智谱 GLM-4-Flash 免费 key） */
export const DEFAULT_TRANSLATE_PROVIDER: TranslateProvider = 'zhipu';

/**
 * 按服务商取 chat/completions 端点。
 */
export function translateChatUrl(provider: TranslateProvider | undefined): string {
    return provider === 'deepseek' ? DEEPSEEK_CHAT_URL : ZHIPU_CHAT_URL;
}

/**
 * 按服务商取固定模型（r4 起模型不再可配：智谱 GLM-4-Flash / DeepSeek deepseek-v4-flash 免费）。
 */
export function modelFor(provider: TranslateProvider | undefined): string {
    return provider === 'deepseek' ? DEEPSEEK_MODEL : ZHIPU_MODEL;
}

/**
 * 归一化服务商：仅 'deepseek' / 'zhipu' 有效；其余（含 undefined/未知）回退默认 zhipu。
 */
export function normalizeProvider(provider: unknown): TranslateProvider {
    return provider === 'deepseek' || provider === 'zhipu' ? provider : DEFAULT_TRANSLATE_PROVIDER;
}

/** OpenAI 兼容 chat/completions 请求体结构（智谱 GLM / DeepSeek 通用） */
export interface TranslateRequestBody {
    model: string;
    messages: { role: 'system' | 'user'; content: string }[];
    /** 关闭流式，一次返回完整译文 */
    stream?: false;
}

/** 翻译默认 system 提示词（中英自动互译，只输出译文）；设置页「服务提示词」以它为默认值、可被覆盖 */
export const DEFAULT_TRANSLATE_PROMPT =
    'Academic standard Chinese-English translation. ' +
    'If the user text is Chinese, translate it into English; ' +
    'if it is English, translate it into Chinese. ' +
    'Output ONLY the translation: no original text, no back-translation, no note that this is a translation.';

/**
 * 构造翻译 chat/completions 请求体。空/纯空白文本 → null（不该发请求）。
 * prompt 传空/纯空白 → 用 DEFAULT_TRANSLATE_PROMPT（设置页提示词框留空即默认）。
 */
export function buildTranslateBody(text: string, provider?: TranslateProvider, prompt?: string): TranslateRequestBody | null {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    return {
        model: modelFor(normalizeProvider(provider)),
        messages: [
            { role: 'system', content: prompt?.trim() || DEFAULT_TRANSLATE_PROMPT },
            { role: 'user', content: trimmed },
        ],
        stream: false,
    };
}

/**
 * 构造最小测试用请求体（不调翻译模型，仅鉴权验证；用一字节短问快速 ping）。
 * 用于设置页"测试连接"按钮：发 ping 看 Key 是否有效（401=无效，200=通过）。
 */
export function buildTranslatePingBody(provider?: TranslateProvider): TranslateRequestBody {
    return {
        model: modelFor(normalizeProvider(provider)),
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
    };
}

/**
 * 解析 OpenAI 兼容响应对象 → 译文文本；失败/非预期 → null（上层报错误文案）。
 * 成功形如 { choices: [{ message: { content: '译文' } }] }；content 缺/空/非字符串/纯空白 → null。
 * 兼容 choices[0].message.content 或 choices[0].text（个别兼容端点差异）。
 */
export function parseTranslateResponse(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.choices) || o.choices.length === 0) return null;
    const first = o.choices[0];
    if (typeof first !== 'object' || first === null) return null;
    const choice = first as Record<string, unknown>;
    // 主路径：message.content；个别 OpenAI 兼容返回顶层 text
    const msg = choice.message as Record<string, unknown> | undefined;
    const content = typeof msg?.content === 'string' ? msg.content : choice.text;
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
}