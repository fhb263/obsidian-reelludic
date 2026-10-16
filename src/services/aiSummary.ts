// AI 摘要生成服务（一句话总结 + 核心看点）
// 复用「阅读器翻译」的 AI 服务商与 Key（同一套配置与端点，不为摘要单开一套凭据）；
// 网络与提示均注入，便于单测。prompt 构造与响应解析在 pure/aiSummary.ts（纯函数）。
import { parseAiReply, aiHttpIssue, providerLabel, translateChatUrl } from 'pure/translate';
import type { TranslateProvider } from 'pure/translate';
import { buildAiSummaryBody, parseAiSummaryResult } from 'pure/aiSummary';
import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';

/** 摘要比划词翻译输出长，超时给宽一点 */
export const AI_SUMMARY_TIMEOUT_MS = 20000;

export interface AiSummaryConfig {
    provider: TranslateProvider;
    key: string;
    /** 自定义服务提示词（设置页「AI 翻译 / 总结 / 搜索 → 服务提示词」）；空/缺省 → 用默认提示词 */
    prompt?: string;
    /** #478：设置页选的模型（空/缺省 ⇒ 该家默认模型） */
    model?: string;
    /** #478：请求端点（自定义端点由 main 解析好传进来；缺省 ⇒ 按 provider 取内置端点） */
    url?: string;
    /** #478：main 侧的配置校验结果（缺 Key / 缺端点 / 缺模型）；非空 ⇒ 不发请求 */
    issue?: string;
}

export interface AiSummaryHttpOptions {
    url: string;
    method: string;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
}
export interface AiSummaryHttpResponse {
    status: number;
    text: string;
}
export type AiSummaryHttp = (opts: AiSummaryHttpOptions) => Promise<AiSummaryHttpResponse>;

export interface AiSummaryDeps {
    /** 当前服务商与 Key（读 settings；未配置时 key 为空串） */
    getConfig(): AiSummaryConfig;
    /** 用户可见提示（Notice） */
    notify(msg: string, ms?: number): void;
    http: AiSummaryHttp;
    /** 超时包装（main 传 withTimeout）；缺省则不加超时 */
    withTimeout?: <T>(p: Promise<T>, ms: number) => Promise<T>;
}

export class AiSummaryService {
    constructor(private deps: AiSummaryDeps) {}

    /** 生成摘要；任何失败路径都返回 null（内部已给用户提示，调用方只需静默处理） */
    async generate(input: AiSummaryInput): Promise<AiSummaryResult | null> {
        // #478：config 由 main 的 `resolveAiAccess` 产出（含自定义端点的 url / 校验 issue / 模型名），
        //   本服务只负责发请求与报错 —— ⛔ 别在这里再判一次 provider（两处真源必漂）
        const { provider, key, prompt, model, url, issue } = this.deps.getConfig();
        if (issue) {
            this.deps.notify(issue, 5000);
            return null;
        }
        const body = buildAiSummaryBody(input, provider, prompt, model);
        if (!body) return null; // 无标题：信息量为零，调用方已拦
        const label = providerLabel(provider);
        if (!key) {
            this.deps.notify(`未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写（总结与翻译共用 Key）`, 5000);
            return null;
        }
        const endpoint = url || translateChatUrl(provider);
        try {
            const req = this.deps.http({
                url: endpoint,
                method: 'POST',
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${key}` },
                body: JSON.stringify(body),
            });
            const res = this.deps.withTimeout ? await this.deps.withTimeout(req, AI_SUMMARY_TIMEOUT_MS) : await req;
            // #478：401/402/403/404/429 统一可读（原来只特判 401/429）
            const httpIssue = aiHttpIssue(res.status, label);
            if (httpIssue) {
                this.deps.notify(`AI 摘要失败：${httpIssue}`, 5000);
                return null;
            }
            if (res.status !== 200) {
                this.deps.notify(`AI 摘要失败（HTTP ${res.status}）`, 4000);
                return null;
            }
            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                this.deps.notify('AI 摘要失败（响应非 JSON）', 4000);
                return null;
            }
            const reply = parseAiReply(json);
            const parsed = reply.ok ? parseAiSummaryResult(reply.text) : null;
            if (!parsed) {
                this.deps.notify(
                    !reply.ok && reply.reason === 'reasoning-only'
                        ? 'AI 摘要失败：该模型只返回了思考过程、没给答案\n请在 设置 → AI集成 · 用途 换一个非推理模型'
                        : 'AI 摘要失败（模型未返回可用结果）',
                    !reply.ok && reply.reason === 'reasoning-only' ? 6000 : 4000,
                );
                return null;
            }
            return parsed;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.deps.notify(`AI 摘要失败：${msg || `无法连接 ${label}`}\n请检查网络或 API Key（${endpoint}）`, 5000);
            return null;
        }
    }
}
