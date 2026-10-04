// 阅读器翻译——AI 大模型划词翻译纯逻辑（纯函数，无 obsidian 依赖，可单测）。
// 责任：构造 OpenAI 兼容 chat/completions 请求体、解析响应文本；
// 网络请求由 main.ts 用 requestUrl 完成（Bearer API Key 在 header 注入）。
// 与 bookmark.ts / readingProgress.ts 同风格：解析容错、常量集中、无副作用。

/**
 * 支持的 AI 服务商。
 * 🔴 #478 加 `'custom'` —— 用户自填的 **OpenAI 兼容端点**（base URL + Key + 模型名全手填）。
 * 为什么走"自定义端点"而不是继续堆厂商预置：**模型 ID 时效性极强**（实测 2026-10-02：智谱免费档
 * 已从 `GLM-4-Flash` 扩到 `GLM-4.7-Flash`，而 `GLM-4.5-Flash` 官方标注「即将下线」）——
 * 一条自定义通道能接 通义千问 / Kimi / 豆包 / OpenRouter / 本地 Ollama 等**所有**兼容服务，
 * 且**不会随官方变更而过期**。
 * 🔴 #480 加 `'siliconflow'` —— 用户 2026-10-02「硅基流动也要参与到全部 AI 服务中」：
 *    它从「只服务朗读云合成」**升为一等 chat 提供商**（同时仍是朗读的云音源）。
 *    ⚠️ 这与 #478 那条「不作 chat 提供商」是**同一条事实的两个处置**：当时实测该账号 chat 402
 *    （余额不足）⇒ 保守起见只留云合成；现在用户明确要求接进来 ⇒ 端点照接，**失败时如实报 402**。
 */
export type TranslateProvider = 'zhipu' | 'deepseek' | 'siliconflow' | 'custom';

/** 智谱 GLM chat/completions 端点（open.bigmodel.cn v4，OpenAI 兼容；用户 cform 现用端点） */
export const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
/** DeepSeek chat/completions 端点（OpenAI 兼容；官方 base https://api.deepseek.com） */
export const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';
/**
 * 硅基流动 chat/completions 端点（OpenAI 兼容）。
 * ⚠️ 实测（2026-10-02，`_probe_sf_chat.cjs`）：`GET /v1/models` **200 / 97 个**（Key 有效），
 *    但 `POST /chat/completions` 仍是 **402「账户余额不足」**（`code:30001`）——
 *    接得上、但**这个账号得先充值**才跑得动；失败由 `aiHttpIssue` 明说原因，不会含糊。
 * ⚠️ 与「朗读云合成」**共用同一把 Key**（`readerSiliconflowKey`）—— 同一账号，不另开凭据。
 */
export const SILICONFLOW_CHAT_URL = 'https://api.siliconflow.cn/v1/chat/completions';

/**
 * 服务商显示名 —— **唯一真源**（错误文案 / 提示 / 设置页一律取它）。
 * ⛔ 别再散落 `provider === 'zhipu' ? '智谱' : 'DeepSeek'` 这种二元三元式：加了第三家之后，
 *    每漏一处就会把「自定义端点」显示成「DeepSeek」（本批实测过 4 处）。
 */
export const PROVIDER_LABEL: Readonly<Record<TranslateProvider, string>> = {
    zhipu: '智谱',
    deepseek: 'DeepSeek',
    siliconflow: '硅基流动',
    custom: '自定义端点',
};

/** 服务商显示名（含未知名兜底） */
export function providerLabel(provider: TranslateProvider | undefined): string {
    return PROVIDER_LABEL[normalizeProvider(provider)];
}

/**
 * 🔴 服务商 → **凭据字段名**（唯一真源；#479 立、`main.aiKeyField` 曾用一份私有副本，
 * **#484 下沉到这里** —— 设置页也要判断「这家填没填 Key」，再抄一份就是第二真源）。
 * ⚠️ 硅基流动与「朗读云合成」**共用同一把 Key**（#480 定的，同一账号 ⇒ 不新开字段）。
 */
export function aiKeyField(provider: TranslateProvider): string {
    if (provider === 'custom') return 'readerCustomKey';
    if (provider === 'deepseek') return 'readerDeepseekKey';
    if (provider === 'siliconflow') return 'readerSiliconflowKey';
    return 'readerZhipuKey';
}

/** 智谱默认模型（GLM-4-Flash 免费） */
export const ZHIPU_MODEL = 'GLM-4-Flash';
/** DeepSeek 默认模型（deepseek-v4-flash） */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
/** 硅基流动默认模型（#480；取该站当前列表里最便宜的 flash 档，实测 2026-10-02 在册） */
export const SILICONFLOW_MODEL_ID = 'deepseek-ai/DeepSeek-V4-Flash';

/** 默认服务商（用户 cform 已在用智谱 GLM-4-Flash 免费 key） */
export const DEFAULT_TRANSLATE_PROVIDER: TranslateProvider = 'zhipu';

/**
 * 各家**预置模型**（仅供设置页下拉做候选）。
 * 🔴🔴 **这不是穷举**：官方会改 ID、会让模型下线（见 `TranslateProvider` 注释里的实测）。
 *    ⇒ 设置页**必须**同时给「自定义…」手填项；⛔ 别把本表当成"可用模型全集"。
 * ⚠️ 标「推理」的模型（`glm-4.7-flash` / `deepseek-reasoner`）会先输出思维链（`reasoning_content`），
 *    翻译/总结这类短任务上更慢、更贵 —— 列出来但**不做默认**（见 `DEFAULT_MODELS`）。
 */
export const PROVIDER_MODELS: Readonly<Record<TranslateProvider, readonly { value: string; label: string }[]>> = {
    zhipu: [
        { value: 'GLM-4-Flash', label: 'GLM-4-Flash' },
        { value: 'glm-4-flash-250414', label: 'GLM-4-Flash-250414' },
        { value: 'glm-4.7-flash', label: 'GLM-4.7-Flash（推理，较慢）' },
    ],
    deepseek: [
        { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
        { value: 'deepseek-chat', label: 'deepseek-chat' },
        { value: 'deepseek-reasoner', label: 'deepseek-reasoner（推理）' },
    ],
    /**
     * #480 硅基流动：同样只是**候选**（该站实测 97 个模型，靠「获取模型列表」拉全量）。
     * 挑的都是 2026-10-02 实测在册的文本 chat 档；⛔ 别当穷举清单。
     */
    siliconflow: [
        { value: 'deepseek-ai/DeepSeek-V4-Flash', label: 'deepseek-ai/DeepSeek-V4-Flash' },
        { value: 'zai-org/GLM-5.3', label: 'zai-org/GLM-5.3' },
        { value: 'Qwen/Qwen3.5-35B-A3B', label: 'Qwen/Qwen3.5-35B-A3B' },
        { value: 'moonshotai/Kimi-K2.7-Code', label: 'moonshotai/Kimi-K2.7-Code' },
    ],
    /** 自定义端点没有预置（模型名由用户填） */
    custom: [],
};

/** 各家**默认模型**（用户没选 / 选了自定义但没填 ⇒ 回落到它）。⚠️ `custom` 无默认 —— 必须用户填 */
export const DEFAULT_MODELS: Readonly<Record<TranslateProvider, string>> = {
    zhipu: ZHIPU_MODEL,
    deepseek: DEEPSEEK_MODEL,
    siliconflow: SILICONFLOW_MODEL_ID,
    custom: '',
};

/** 设置页模型下拉里「自定义…」那一项的哨兵值（选中 ⇒ 显示手填输入框） */
export const MODEL_CUSTOM = '__custom__';

/**
 * 解析实际使用的模型名：手填非空 ⇒ 用它；否则回落到该家默认（`custom` 无默认 ⇒ 空串，
 * 调用方**必须先拦**空模型，别把空串发给端点）。
 */
export function resolveModel(provider: TranslateProvider | undefined, picked?: string): string {
    const p = normalizeProvider(provider);
    const v = typeof picked === 'string' ? picked.trim() : '';
    return v && v !== MODEL_CUSTOM ? v : DEFAULT_MODELS[p];
}

/**
 * 归一自定义端点地址：去首尾空白、去尾部斜杠；缺 scheme 时补 `https://`（用户常只填域名）。
 * 空/非字符串 ⇒ 空串（调用方据此判「没填」）。
 */
export function normalizeAiBaseUrl(raw: unknown): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const noSlash = s.replace(/\/+$/, '');
    // ⚠️ 只有 scheme（`https://` / `http://`）不是地址 —— 去尾斜杠后若正好剩 `https:`，视为没填
    //    （否则会补成 `https://https:` 这种怪物并一路验成通过）
    if (/^https?:$/i.test(noSlash)) return '';
    return /^https?:\/\//i.test(noSlash) ? noSlash : `https://${noSlash}`;
}

/**
 * 自定义端点 → chat/completions 完整 URL。
 * ⚠️ 已含 `/chat/completions` 的原样返回（有人习惯把整条端点贴进来 —— 再拼一次会 404）；
 *    只填 base（如 `https://api.deepseek.com/v1`）则由本函数补齐。
 */
export function customChatUrl(raw: unknown): string {
    const base = normalizeAiBaseUrl(raw);
    if (!base) return '';
    return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

/** 自定义端点的即时校验：合法 ⇒ null；否则给一句面向用户的原因（设置页边打边提示用）。 */
export function aiBaseUrlIssue(raw: unknown): string | null {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '请填写端点地址（OpenAI 兼容的 base URL）';
    // ⚠️ 先拦「有 scheme 但不是 http(s)」—— 否则 `ftp://x.cn` 会被下面的"缺 scheme 就补 https"掩盖成
    //    `https://ftp://x.cn` 并一路验成**通过**（写单测时实测到的假通过）
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return '只支持 http / https 地址';
    const n = normalizeAiBaseUrl(s);
    if (!n) return '地址格式不对（形如 https://api.example.com/v1）';
    // ⚠️ 再验**主机段**：`https://`（只有 scheme）与 `https://https:` 这种都要拦下
    const host = n.replace(/^https?:\/\//i, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?(\/|$)/.test(host)) {
        return '地址格式不对（形如 https://api.example.com/v1）';
    }
    return null;
}

/**
 * 按服务商取 chat/completions 端点。
 * `'custom'` ⇒ 走用户自填的 `customBase`（没填返回空串，调用方须先判）。
 */
export function translateChatUrl(provider: TranslateProvider | undefined, customBase?: unknown): string {
    const p = normalizeProvider(provider);
    if (p === 'custom') return customChatUrl(customBase);
    if (p === 'deepseek') return DEEPSEEK_CHAT_URL;
    if (p === 'siliconflow') return SILICONFLOW_CHAT_URL;
    return ZHIPU_CHAT_URL;
}

/**
 * 按服务商取**默认**模型（r4 起模型曾写死；#478 起可在设置页选，本函数只返回该家默认值）。
 * ⚠️ 新的调用点请用 `resolveModel(provider, picked)` —— 它才会把用户在设置页选的模型算进去。
 */
export function modelFor(provider: TranslateProvider | undefined): string {
    return resolveModel(provider);
}

/**
 * 归一化服务商：仅 'deepseek' / 'zhipu' / 'siliconflow' / 'custom' 有效；其余（含 undefined/未知）回退默认 zhipu。
 */
export function normalizeProvider(provider: unknown): TranslateProvider {
    return provider === 'deepseek' || provider === 'zhipu' || provider === 'siliconflow' || provider === 'custom'
        ? provider
        : DEFAULT_TRANSLATE_PROVIDER;
}

/**
 * AI 服务开关值（用户 2026-09-18）：三处服务下拉各可单独选「不启用」。
 * `'off'` 只作设置页取值 —— 归一后由 main 侧守卫拦在发请求之前（翻译 / 总结 / 搜索 各自独立）。
 */
export const AI_PROVIDER_OFF = 'off';

/** 服务商或「不启用」 */
export type AiProviderChoice = TranslateProvider | typeof AI_PROVIDER_OFF;

/**
 * 归一「服务商 or 不启用」：仅 'zhipu' / 'deepseek' / 'siliconflow' / 'custom' / 'off' 直通，
 * 其余（含脏数据 / 原型链键名）回退 zhipu。
 * ⚠️ 不能拿 `normalizeProvider` 顶替 —— 它会把 'off' 静默吃掉变回 zhipu（「关了又自己开了」）。
 */
export function normalizeAiChoice(v: unknown): AiProviderChoice {
    return v === AI_PROVIDER_OFF || v === 'deepseek' || v === 'zhipu' || v === 'siliconflow' || v === 'custom'
        ? v
        : DEFAULT_TRANSLATE_PROVIDER;
}

/** 设置页下拉选项（顺序即 UI 顺序；「不启用」放最后，避免误选） */
export const AI_PROVIDER_OPTIONS: { value: AiProviderChoice; label: string }[] = [
    { value: 'zhipu', label: '智谱 GLM' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'siliconflow', label: '硅基流动' },
    { value: 'custom', label: '自定义（OpenAI 兼容）' },
    { value: AI_PROVIDER_OFF, label: '不启用' },
];

/** 哪些服务商**不需要**用户手填 base URL（用于设置页文案与提示分支） */
export function isBuiltinProvider(provider: TranslateProvider | undefined): boolean {
    return normalizeProvider(provider) !== 'custom';
}

/**
 * 服务商选项的显示名 —— **唯一真源 = `AI_PROVIDER_OPTIONS`**（⛔ 别在视图层再抄一份文案）。
 * 未知值（脏数据）回退到该家显示名，不抛错。
 */
export function aiChoiceLabel(v: AiProviderChoice): string {
    return AI_PROVIDER_OPTIONS.find((o) => o.value === v)?.label ?? providerLabel(normalizeProvider(v));
}

/** 该服务是否「不启用」（#480 ①：不启用时模型区要**置灰且点不动**，别再亮着一个模型名） */
export function isAiOff(v: unknown): boolean {
    return normalizeAiChoice(v) === AI_PROVIDER_OFF;
}

/**
 * #480「服务商 + 模型」**合并控件**上的那行字：`智谱 GLM · glm-5-turbo`。
 * 🔴 「不启用」**不带模型段** —— 那正是 #480 ① 要消除的视觉冲突（「选了不启用，右边还亮着 GLM-4-Flash」）。
 * ⚠️ 模型为空（如 `custom` 还没填）⇒ 只显示服务商名，由调用方决定要不要补「选择模型…」占位。
 */
export function aiPickText(v: AiProviderChoice, model?: string): string {
    const name = aiChoiceLabel(v);
    if (v === AI_PROVIDER_OFF) return name;
    const m = typeof model === 'string' ? model.trim() : '';
    return m ? `${name} · ${m}` : name;
}

/**
 * 🔴 #499D：OpenAI 兼容的**工具定义**（函数调用）。
 * ⚠️ 目前只有「AI 预填」用（agent 回路：模型自己决定要不要查资料）；翻译 / 总结 / 搜索不传。
 * ⚠️ 实测（2026-10-03，`_probe_agent_499c.cjs`）：智谱 `GLM-4-Flash` 与 DeepSeek 都真的会吐
 *    `tool_calls`；但**自定义端点不保证**（那条 91hub 把 tools 吞了、直接裸答）⇒ 调用方必须
 *    有「不吐 tool_calls / 端点不收 tools」的回落（见 `services/aiPrefill`）。
 * ⛔ 别用 `type: 'web_search'` 这种**厂商内置**工具名 —— 实测 DeepSeek 直接 422
 *    （`unknown variant 'web_search', expected 'function'`），而智谱收下却不调用。
 */
export interface AiToolDef {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** 一轮对话里的任一条消息（`assistant` 带 `tool_calls`、`tool` 带 `tool_call_id` 是工具回路的两条腿） */
export interface AiChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** 仅 assistant：它请求调用的工具（原样回传，⛔ 别自己重排字段） */
    tool_calls?: unknown[];
    /** 仅 tool：回应的是哪一次调用 */
    tool_call_id?: string;
}

/** OpenAI 兼容 chat/completions 请求体结构（智谱 GLM / DeepSeek 通用） */
export interface TranslateRequestBody {
    model: string;
    messages: AiChatMessage[];
    /** 关闭流式，一次返回完整译文 */
    stream?: false;
    /** 🔴 #486：只给 ping 用 —— 限制输出长度，避免「测一下连通性」花十几秒（实测见下） */
    max_tokens?: number;
    /** 🔴 #499D：工具清单（只预填传；不带 ⇒ 与以前完全一致） */
    tools?: AiToolDef[];
}

/**
 * 🔴 #486：ping（「测试连接」）的**输出上限**。
 * 由来（实测 2026-10-02，`_probe_fix486.cjs`）：智谱 `GLM-4-Flash` 打一次 ping ——
 *   不限制输出 = **8159 / 11561 ms**（会越过 `TIMEOUT_MS = 10000` ⇒ 用户看到「连接失败」）；
 *   `max_tokens: 16` = **1834 ms**；`max_tokens: 1` = **418 ms**。
 * ⇒ ping 只验证「端点可达 + 凭据有效」，不需要模型真的把话说完 ⇒ 给它一个很小的额度即可。
 * ⚠️ 只作用于 ping，⛔ 别加到正式翻译 / 总结 / 搜索的请求里（那会把译文截断）。
 */
export const PING_MAX_TOKENS = 16;

/**
 * 🔴 #486：从**某家自己**的模型列表里挑一个「像文本对话」的，用于 ping。
 *
 * 为什么要它：自定义端点（中转站）的列表里常常混着视频 / 语音 / 向量模型
 * （实测 91hub：361 个里第一个是 `MiniMax-Hailuo-2.3`，是视频生成模型，打 chat 直接 500）。
 * ⛔ 更不能用「翻译服务」那家的模型去测自定义端点 —— 实测就是这么 503 的
 * （`No available channel for model GLM-4-Flash`，而该端点确实没有这个模型）。
 *
 * ⚠️ 判定按 **id 关键词**（与 `modelTags` 同一口径）；⛔ 不声称自己知道模型能力。
 *    全部都不像文本对话 ⇒ 退回第一个（由调用方把失败原因原样报给用户）。
 */
const NOT_CHAT_MODEL =
    /(image|video|tts|speech|voice|audio|embed|bge|rerank|whisper|dall|flux|sora|kling|hailuo|wan[-_]|seedream|omnigen)/i;

export function pickPingModel(ids: readonly string[], fallback = ''): string {
    const list = ids.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    return list.find((id) => !NOT_CHAT_MODEL.test(id)) ?? list[0] ?? fallback;
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
 * `model` = 设置页选的模型名（#478）；空/缺省 ⇒ 该服务商的默认模型。
 */
export function buildTranslateBody(
    text: string,
    provider?: TranslateProvider,
    prompt?: string,
    model?: string,
): TranslateRequestBody | null {
    const trimmed = text?.trim();
    if (!trimmed) return null;
    return {
        model: resolveModel(provider, model),
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
 * ⚠️ **必须带真实的模型名**：端点会先校验模型是否存在（404）⇒ 拿默认模型也会暴露「模型名写错」。
 */
export function buildTranslatePingBody(provider?: TranslateProvider, model?: string): TranslateRequestBody {
    return {
        model: resolveModel(provider, model),
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        // 🔴 #486：限制输出长度 —— 否则「测一下连通性」要等 8~12 秒，会撞上 10s 超时线显示失败
        max_tokens: PING_MAX_TOKENS,
    };
}

/** 解析失败的原因（#478：把「没拿到文本」分成三类，好让上层说人话） */
export type AiReplyReason = 'shape' | 'empty' | 'reasoning-only';

/** 解析结果：拿到文本，或说明为什么没拿到 */
export type AiReply = { ok: true; text: string } | { ok: false; reason: AiReplyReason };

/**
 * 解析 OpenAI 兼容 chat 响应对象 → 文本。
 * 🔴 #478 **推理模型**（`glm-4.7-flash` / `deepseek-reasoner` 这类）：正常响应里
 *    `message.content` = 最终答案、`message.reasoning_content` = 思维链（可能同时返回）。
 *    若 `content` 为空而 `reasoning_content` 非空 ⇒ 输出**停在思考阶段**（被截断 / 该模型不支持短任务）
 *    ⇒ 返回 `reasoning-only` 让上层提示「换个非推理模型」，⛔🔴 **绝不把思维链当答案返回**（那是错的译文）。
 * ⚠️ 兼容 `choices[0].message.content` 与 `choices[0].text`（个别兼容端点差异）。
 */
export function parseAiReply(raw: unknown): AiReply {
    if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'shape' };
    const o = raw as Record<string, unknown>;
    if (!Array.isArray(o.choices) || o.choices.length === 0) return { ok: false, reason: 'shape' };
    const first = o.choices[0];
    if (typeof first !== 'object' || first === null) return { ok: false, reason: 'shape' };
    const choice = first as Record<string, unknown>;
    const msg = choice.message as Record<string, unknown> | undefined;
    const content = typeof msg?.content === 'string' ? msg.content : choice.text;
    if (typeof content === 'string' && content.trim()) return { ok: true, text: content.trim() };
    const reasoning = typeof msg?.reasoning_content === 'string' ? msg.reasoning_content.trim() : '';
    return { ok: false, reason: reasoning ? 'reasoning-only' : 'empty' };
}

/**
 * 解析 OpenAI 兼容响应对象 → 译文文本；失败/非预期 → null（上层报错误文案）。
 * 成功形如 { choices: [{ message: { content: '译文' } }] }；content 缺/空/非字符串/纯空白 → null。
 * ⚠️ 需要**区分失败原因**（尤其推理模型）请改用 `parseAiReply` —— 本函数是它的取文本封装。
 */
export function parseTranslateResponse(raw: unknown): string | null {
    const r = parseAiReply(raw);
    return r.ok ? r.text : null;
}

/**
 * 按服务商取**模型列表**端点（`GET`，OpenAI 兼容 `/models`）—— 设置页「获取模型」用。
 * 🔴 **由 chat 端点派生**（把结尾的 `/chat/completions` 换成 `/models`）：单一真源，
 *    ⛔ 别为每家再抄一份字面量（日后加第四家必漏一处）。
 * ⚠️ `custom` 没填 base ⇒ 空串（调用方须先判）。
 * 实测（2026-10-02，活动库真实 Key）：智谱 `/api/paas/v4/models` **200 / 11 个**、
 * 硅基流动 `/v1/models` **200 / 97 个**、DeepSeek `/models` 端点存在（本机 Key 为空 ⇒ 401）。
 */
export function modelsUrl(provider: TranslateProvider | undefined, customBase?: unknown): string {
    const chat = translateChatUrl(provider, customBase);
    return chat ? chat.replace(/\/chat\/completions$/i, '/models') : '';
}

/**
 * 解析 OpenAI 兼容 `/models` 响应 → 模型名列表（**去重 + 按字典序**，顺序稳定才能单测）。
 * 兼容两种形态：`{ data: [{ id }] }`（OpenAI / 智谱 / 硅基流动实测都是它）与
 * `{ models: [{ name | id }] }`（个别兼容端点）；元素本身是字符串也认。
 * 非预期结构 ⇒ **空数组**（调用方据此说「没取到模型」而不是崩）。
 */
/**
 * `/models` 解析出来的一条。
 * 🔴 #482：除了 id，把**真有**的元数据一并带上 —— 但只带接口**真的返回**的那几项。
 *    实测（2026-10-02 `_probe_model_meta.cjs`）：DeepSeek 给 `name` / `context_window` /
 *    `input_modalities`；**智谱与硅基流动只给 `id, object, created, owned_by`**，什么都描述不了。
 *    ⇒ ⛔ 别在这里「补」上下文长度之类 —— 那就是编参数（用户要的「128k 上下文」只有 DeepSeek 能真给）。
 */
export interface ModelFetched {
    value: string;
    /** 服务商给的官方显示名（与 id 不同时才带） */
    name?: string;
    /** 上下文窗口（token） */
    contextWindow?: number;
    /** 是否支持图片输入（`input_modalities` 含 image） */
    imageInput?: boolean;
}

export function parseModelList(raw: unknown): ModelFetched[] {
    if (typeof raw !== 'object' || raw === null) return [];
    const box = raw as Record<string, unknown>;
    const src = Array.isArray(box.data) ? box.data : Array.isArray(box.models) ? box.models : null;
    if (!src) return [];
    const map = new Map<string, ModelFetched>();
    for (const it of src) {
        // 有些兼容端点直接给字符串数组
        if (typeof it === 'string') {
            const s = it.trim();
            if (s && !map.has(s)) map.set(s, { value: s });
            continue;
        }
        if (typeof it !== 'object' || it === null) continue;
        const r = it as Record<string, unknown>;
        const v = typeof r.id === 'string' ? r.id : typeof r.name === 'string' ? r.name : '';
        const s = v.trim();
        if (!s || map.has(s)) continue;
        const one: ModelFetched = { value: s };
        const nm = typeof r.name === 'string' ? r.name.trim() : '';
        if (nm && nm !== s) one.name = nm;
        const cw = typeof r.context_window === 'number' && r.context_window > 0 ? r.context_window : 0;
        if (cw) one.contextWindow = cw;
        if (Array.isArray(r.input_modalities) && r.input_modalities.includes('image')) one.imageInput = true;
        map.set(s, one);
    }
    return [...map.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/** 上下文窗口的人话（`1048576` → `1M`、`128000` → `128k`）；没有 ⇒ 空串 */
export function contextWindowText(n: number | undefined): string {
    if (typeof n !== 'number' || !(n > 0)) return '';
    if (n >= 1_000_000) return `${Math.round((n / 1_000_000) * 10) / 10}M`;
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
}

/** 预置 label 里的括号注解（`GLM-4.7-Flash（推理，较慢）` ⇒ `推理，较慢`）；没有 ⇒ 空串 */
function labelAnnotation(label: string): string {
    const m = /[（(]([^）)]+)[）)]\s*$/.exec(label);
    return m ? m[1].trim() : '';
}

/**
 * 🔴 #482：模型行下面那行**小字**——只写**真有**的信息，⛔ 一个参数都不编。
 * 取值优先级：① 接口真给的元数据（官方名 / 上下文 / 图片输入）② 预置 label 的括号注解
 * ③ 都没有 ⇒ 写**来源**（这正是被删掉的那个蓝色「API」签在表达的事，信息不能跟着一起丢）。
 */
export function modelNote(c: {
    label: string;
    fromApi: boolean;
    name?: string;
    contextWindow?: number;
    imageInput?: boolean;
}): string {
    const bits: string[] = [];
    if (c.name) bits.push(c.name);
    const cw = contextWindowText(c.contextWindow);
    if (cw) bits.push(`上下文 ${cw}`);
    if (c.imageInput) bits.push('支持图片输入');
    if (bits.length) return bits.join(' · ');
    const ann = labelAnnotation(c.label);
    if (ann) return ann;
    return c.fromApi ? '来自服务商 · 该 Key 当下可用' : '插件内置候选（可能过期）';
}

/**
 * 🔴 #482：模型行右侧的**灰色小签**——只按 **id 与真字段**判定。
 * ⛔ 不写「快 / 便宜 / 好用」这类无从核实的主观词（要写请放进 `PROVIDER_MODELS` 的注解或另立描述表）。
 * `note` 里已经出现过的签不再重复（预置的括号注解常常就是「推理」）。
 */
export function modelTags(
    value: string,
    c: { imageInput?: boolean; isDefault?: boolean },
    note = '',
): string[] {
    const v = value.toLowerCase();
    const out: string[] = [];
    if (c.isDefault) out.push('推荐');
    if (c.imageInput || /vision|\bvl\b|omni|-image|image-/.test(v)) out.push('多模态');
    if (/reason|think|\br1\b/.test(v)) out.push('推理');
    return out.filter((t) => !!t && !note.includes(t));
}

/**
 * 合并模型候选（「获取模型」弹窗用）：**已获取的真实列表在前**（那是该 Key 当下确实能用的），
 * 再接该家预置（含「（推理，较慢）」这类注解），按 value 去重。
 * ⚠️ 预置只是候选，且会过期 —— 所以真实列表优先，且两者都不排斥手填（见 `MODEL_CUSTOM`）。
 */
/** 弹窗里一行的完整素材（#482：卡片式列表项要「名字 + 小字 + 小签」三件） */
export interface AiModelCandidate {
    value: string;
    label: string;
    /** 来自服务商 `/models`（该 Key 当下确实可用）还是本仓预置（可能过期） */
    fromApi: boolean;
    /** 是否该服务商的默认模型 ⇒ 小签「推荐」 */
    isDefault?: boolean;
    name?: string;
    contextWindow?: number;
    imageInput?: boolean;
}

export function mergeModelCandidates(
    provider: TranslateProvider | undefined,
    fetched: readonly (string | ModelFetched)[],
): AiModelCandidate[] {
    const p = normalizeProvider(provider);
    const out: AiModelCandidate[] = [];
    const seen = new Set<string>();
    const def = DEFAULT_MODELS[p];
    for (const it of fetched) {
        const one: ModelFetched = typeof it === 'string' ? { value: it } : it;
        const s = typeof one.value === 'string' ? one.value.trim() : '';
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push({ value: s, label: s, fromApi: true, isDefault: s === def, ...metaOf(one) });
    }
    for (const o of PROVIDER_MODELS[p]) {
        if (seen.has(o.value)) continue;
        seen.add(o.value);
        out.push({ value: o.value, label: o.label, fromApi: false, isDefault: o.value === def });
    }
    return out;
}

/** 只挑**真有**的元数据（⛔ 别把 undefined 也塞进去 —— 那会让「有没有」变得分不清） */
function metaOf(one: ModelFetched): Pick<AiModelCandidate, 'name' | 'contextWindow' | 'imageInput'> {
    const out: Pick<AiModelCandidate, 'name' | 'contextWindow' | 'imageInput'> = {};
    if (one.name) out.name = one.name;
    if (one.contextWindow) out.contextWindow = one.contextWindow;
    if (one.imageInput) out.imageInput = true;
    return out;
}

/**
 * 🔴 #478：HTTP 状态 → 面向用户的可读原因（`null` = 无需特判，由调用方兜底）。
 * 立这条的由来：原来只有 401 / 429 被特判，**402（余额不足）会落到「失败（HTTP 402）」**——
 * 用户看不出是账户没钱（实测：硅基流动、智谱都可能返回 402）。
 */
export function aiHttpIssue(status: number, label: string): string | null {
    switch (status) {
        case 401:
            return `${label} API Key 无效（HTTP 401），请检查设置`;
        case 402:
            return `${label} 账户余额不足（HTTP 402），请充值或换用其它提供商`;
        case 403:
            return `${label} 无权访问（HTTP 403）—— Key 可能受限，或该模型未开通`;
        case 404:
            return `${label} 模型不存在（HTTP 404）—— 检查模型名是否写对`;
        case 429:
            return `${label} 请求过于频繁或额度不足（HTTP 429）`;
        default:
            return null;
    }
}