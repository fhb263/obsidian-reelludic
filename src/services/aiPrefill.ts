// AI 预填服务（新增条目「手动填写」界面 · 标题行 ✨）
// 复用「AI集成」的服务商与 Key（同一套凭据，不为预填单开一套）；网络与提示均注入，便于单测。
// prompt 构造、工具定义与响应解析在 pure/aiPrefill.ts（纯函数）—— 本文件负责「发请求 / 走工具回路 / 报错」。
//
// 🔴 #499D agent 工具回路（用户：「能不能做 agent 调用 tools 或者 skills 搜索」）：
//    首轮带 `tools` ⇒ 模型可能吐 `tool_calls` ⇒ 宿主 `runTool` 本地执行（查元数据源 / 联网搜索）
//    ⇒ 把结果按 `role:'tool'` 喂回 ⇒ 直到模型不再要工具、直接给 JSON。**最多 `MAX_PREFILL_ROUNDS` 轮**。
//    实测（2026-10-03，`_probe_loop_499e.cjs`）：智谱 `GLM-4-Flash` 与 DeepSeek 两轮都能干净收尾成 JSON。
//    ⚠️ 但**自定义端点不保证**（91hub 实测把 tools 吞了、直接裸答）⇒ 见下面的「能力回落」。
import { parseAiReply, aiHttpIssue, providerLabel, translateChatUrl } from 'pure/translate';
import type { TranslateProvider } from 'pure/translate';
import {
    MAX_PREFILL_ROUNDS,
    buildPrefillRequest,
    extractToolSynopsis,
    parseAiPrefillResult,
    parsePrefillToolCalls,
    preferToolSynopsis,
    prefillAssistantTurn,
    prefillFieldsFor,
    prefillMessages,
    prefillSourceLabel,
    prefillToolLabel,
    prefillToolMessage,
    prefillTools,
} from 'pure/aiPrefill';
// ⚠️ `AiPrefillOutcome` 定义在**纯模块**里（组件只认 `pure/*`）：这里只做转发引用
import type { AiPrefillInput, AiPrefillOutcome, PrefillToolCall } from 'pure/aiPrefill';
export type { AiPrefillOutcome };

/** 预填要模型一次给出七八个字段（还要走工具回路），比摘要长，超时给宽一点 */
export const AI_PREFILL_TIMEOUT_MS = 45000;

export interface AiPrefillConfig {
    provider: TranslateProvider;
    key: string;
    /** 自定义服务提示词（设置页「AI集成 › 用途 · 预填服务」）；空/缺省 → 用 DEFAULT_PREFILL_PROMPT */
    prompt?: string;
    /** 设置页选的模型（空/缺省 ⇒ 该家默认模型） */
    model?: string;
    /** 请求端点（自定义端点由 main 解析好传进来；缺省 ⇒ 按 provider 取内置端点） */
    url?: string;
    /** main 侧的配置校验结果（缺 Key / 缺端点 / 缺模型）；非空 ⇒ 不发请求 */
    issue?: string;
}

export interface AiPrefillHttpOptions {
    url: string;
    method: string;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
}
export interface AiPrefillHttpResponse {
    status: number;
    text: string;
}
export type AiPrefillHttp = (opts: AiPrefillHttpOptions) => Promise<AiPrefillHttpResponse>;

export interface AiPrefillDeps {
    /** 当前服务商与 Key（读 settings；未配置时 key 为空串） */
    getConfig(): AiPrefillConfig;
    /** 用户可见提示（Notice） */
    notify(msg: string, ms?: number): void;
    http: AiPrefillHttp;
    /** 超时包装（main 传 withTimeout）；缺省则不加超时 */
    withTimeout?: <T>(p: Promise<T>, ms: number) => Promise<T>;
    /**
     * 🔴 #499D 工具执行器（宿主注入）。**缺省 ⇒ 整条回路关闭**，退化成 #499 的单轮模式
     * （移动端 / 未接线时就是这个形态）。
     */
    runTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
    /** 工具调用的即时进度（宿主拿去显示一行小字，如「搜索网络：周处除三害 导演」） */
    onStep?: (label: string) => void;
}

interface CallResult {
    status: number;
    text: string;
    json: unknown;
    /** 已面向用户的原因（非空 ⇒ 直接 Reporting 后返回 null） */
    error?: string;
}

export class AiPrefillService {
    constructor(private deps: AiPrefillDeps) {}

    /** 生成预填字段；任何失败路径都返回 null（内部已给用户提示，调用方只需静默处理） */
    async generate(input: AiPrefillInput): Promise<AiPrefillOutcome | null> {
        // config 由 main 的 `resolveAiAccess` 产出（含自定义端点的 url / 校验 issue / 模型名），
        // 本服务只负责发请求与报错 —— ⛔ 别在这里再判一次 provider（两处真源必漂）
        const { provider, key, prompt, model, url, issue } = this.deps.getConfig();
        if (issue) {
            this.deps.notify(issue, 5000);
            return null;
        }
        const defs = prefillFieldsFor(input.type, input.bookKind);
        if (!defs.length) return null; // 字段目录为空：没什么可问的
        const label = providerLabel(provider);
        if (!key) {
            this.deps.notify(`未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写（各项 AI 服务共用 Key）`, 5000);
            return null;
        }

        const endpoint = url || translateChatUrl(provider);
        // 没有工具执行器 ⇒ 不带 tools（与 #499 的单轮形态完全一致）
        let tools = this.deps.runTool ? prefillTools() : [];
        let messages = prefillMessages(input, prompt, tools.length > 0);
        if (!messages) return null; // 无标题：信息量为零，调用方已拦

        const sources: string[] = [];
        /**
         * 🔴 #499E 工具查到的**简介原文**（首个命中即锁定，之后不再被别的搜索结果改写）——
         * 收尾时由 `preferToolSynopsis` **照搬**进 `summary`：用户点名「简介要搜索照搬真正作品的简介」。
         */
        let toolSynopsis: string | null = null;
        /** 「端点不收 tools」的回落只做一次（⛔ 别在每轮都试） */
        let toolFallbackDone = false;

        for (let round = 0; round < MAX_PREFILL_ROUNDS; round++) {
            const call = await this.callAi(endpoint, key, label, provider, model, messages, tools);
            if (call.error) {
                this.deps.notify(call.error, 5000);
                return null;
            }

            // ① 模型要调工具 ⇒ 本地执行 ⇒ 结果喂回 ⇒ 下一轮
            const calls = parsePrefillToolCalls(call.json);
            if (calls.length) {
                const turn = prefillAssistantTurn(call.json);
                if (!turn) return null; // 理论上到不了（有 calls 必有 message）
                messages.push(turn);
                for (const c of calls) {
                    this.deps.onStep?.(prefillToolLabel(c));
                    const text = await this.runToolSafely(c);
                    const src = prefillSourceLabel(c.name);
                    if (!sources.includes(src)) sources.push(src);
                    // 🔴 #499E：工具结果里带简介原文就收下（照搬用）—— ⛔ 只认首个，别被后一轮的覆盖
                    if (!toolSynopsis) toolSynopsis = extractToolSynopsis(text);
                    messages.push(prefillToolMessage(c, text));
                }
                continue;
            }

            // ② 没有工具调用 ⇒ 试着收尾
            const fields = parseAiPrefillResult(replyTextOf(call), defs);
            // 🔴 #499E：工具查到了简介原文时，**即使模型一个字段都没给出**也让「简介」这一行立住 ——
            //    「照搬」的语义就是「查到了就该看得见」；⛔ 别因为模型偷懒（返回 `{}`）把它一起丢掉。
            //    ⚠️ 这一条也顺带说明「工具确实跑过」⇒ 不再走下面那条「端点把 tools 吞了」的回落。
            if (fields || toolSynopsis) {
                return { fields: preferToolSynopsis(fields ?? {}, toolSynopsis, defs), sources };
            }

            // ③ 收不了尾：首轮又带着 tools ⇒ 很可能是**端点把 tools 吞了**（实测自定义端点会裸答）
            //    ⇒ 去掉工具重发一次，并如实告诉用户（⛔ 不静默 —— 否则用户以为「这家也能搜」）
            if (round === 0 && tools.length && !toolFallbackDone) {
                toolFallbackDone = true;
                tools = [];
                messages = prefillMessages(input, prompt, false) ?? messages;
                this.deps.notify(`这家服务商不支持工具调用，已退回凭记忆作答（${label}）`, 5000);
                continue;
            }
            this.deps.notify(
                'AI 预填失败：模型没有给出可用字段\n（同名作品多时可先在标题栏补上「年份 / 题材」再试）',
                5000,
            );
            return null;
        }

        // 轮数用尽 ⇒ 强制收尾：**不带工具**再要一次纯 JSON
        const last = await this.callAi(endpoint, key, label, provider, model, [
            ...messages,
            { role: 'user', content: '请现在只输出那个 JSON 对象（不要再调用工具）。' },
        ], []);
        if (last.error) {
            this.deps.notify(last.error, 5000);
            return null;
        }
        const fields = parseAiPrefillResult(replyTextOf(last), defs);
        // 🔴 #499E：同上 —— 收尾轮模型没整理出字段，但工具查到过简介原文，那就只带这一行走
        if (!fields && !toolSynopsis) {
            this.deps.notify('AI 预填失败：查了资料但没能整理出字段，请再试或换个模型', 5000);
            return null;
        }
        return { fields: preferToolSynopsis(fields ?? {}, toolSynopsis, defs), sources };
    }

    /** 发一次请求并解析外层（HTTP / JSON / 推理模型三态都收敛成一句人话） */
    private async callAi(
        endpoint: string,
        key: string,
        label: string,
        provider: TranslateProvider,
        model: string | undefined,
        messages: Parameters<typeof buildPrefillRequest>[0],
        tools: Parameters<typeof buildPrefillRequest>[3],
    ): Promise<CallResult> {
        const body = buildPrefillRequest(messages, provider, model, tools);
        try {
            const req = this.deps.http({
                url: endpoint,
                method: 'POST',
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${key}` },
                body: JSON.stringify(body),
            });
            const res = this.deps.withTimeout ? await this.deps.withTimeout(req, AI_PREFILL_TIMEOUT_MS) : await req;
            const httpIssue = aiHttpIssue(res.status, label);
            if (httpIssue) return { status: res.status, text: '', json: null, error: `AI 预填失败：${httpIssue}` };
            if (res.status !== 200) return { status: res.status, text: '', json: null, error: `AI 预填失败（HTTP ${res.status}）` };
            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                return { status: res.status, text: '', json: null, error: 'AI 预填失败（响应非 JSON）' };
            }
            const reply = parseAiReply(json);
            // ⚠️ 工具调用那轮 `content` 常常是空的（`parseAiReply` 判 `empty`）——
            //    这里**不当失败**，交给上层先看 `tool_calls`。
            const hasCalls = parsePrefillToolCalls(json).length > 0;
            if (!reply.ok && !hasCalls) {
                return {
                    status: res.status,
                    text: '',
                    json,
                    error:
                        reply.reason === 'reasoning-only'
                            ? 'AI 预填失败：该模型只返回了思考过程、没给答案\n请在 设置 → AI集成 · 用途 换一个非推理模型'
                            : 'AI 预填失败（模型未返回可用结果）',
                };
            }
            return { status: res.status, text: reply.ok ? reply.text : '', json };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                status: -1,
                text: '',
                json: null,
                error: `AI 预填失败：${msg || `无法连接 ${label}`}\n请检查网络或 API Key（${endpoint}）`,
            };
        }
    }

    /**
     * 跑一次工具：**工具失败不该中断整条回路** —— 把失败原因原样交给模型（它可以选择换关键词再搜，
     * 或者干脆凭记忆作答）。⛔ 别在这里 Notice：用户看的是「最后有没有填出字段」，不是中间某次搜索失败。
     */
    private async runToolSafely(call: PrefillToolCall): Promise<string> {
        if (!this.deps.runTool) return '（本机未启用工具）';
        try {
            const text = await this.deps.runTool(call.name, call.args);
            return text?.trim() ? text : '（没有查到结果）';
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return `（工具执行失败：${msg || '未知错误'}）`;
        }
    }
}

/** 收尾用的正文：`reply.text` 拿不到时退回「原始 message 的 content」（工具回路里常见） */
function replyTextOf(call: CallResult): string {
    if (call.text) return call.text;
    const msg = (call.json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message;
    return typeof msg?.content === 'string' ? msg.content : '';
}
