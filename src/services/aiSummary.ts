// AI 摘要生成服务（一句话总结 + 核心看点）
// 复用「阅读器翻译」的 AI 服务商与 Key（同一套配置与端点，不为摘要单开一套凭据）；
// 网络与提示均注入，便于单测。prompt 构造与响应解析在 pure/aiSummary.ts（纯函数）。
import { parseTranslateResponse, translateChatUrl } from 'pure/translate';
import type { TranslateProvider } from 'pure/translate';
import { buildAiSummaryBody, parseAiSummaryResult } from 'pure/aiSummary';
import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';

/** 摘要比划词翻译输出长，超时给宽一点 */
export const AI_SUMMARY_TIMEOUT_MS = 20000;

export interface AiSummaryConfig {
    provider: TranslateProvider;
    key: string;
    /** 自定义服务提示词（设置页「AI 翻译与总结 → 服务提示词」）；空/缺省 → 用默认提示词 */
    prompt?: string;
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
        const { provider, key, prompt } = this.deps.getConfig();
        const body = buildAiSummaryBody(input, provider, prompt);
        if (!body) return null; // 无标题：信息量为零，调用方已拦
        const label = provider === 'zhipu' ? '智谱' : 'DeepSeek';
        if (!key) {
            this.deps.notify(`未配置 ${label} API Key，请先到 设置 → 服务集成 → AI 翻译与总结 填写（总结与翻译共用 Key）`, 5000);
            return null;
        }
        const url = translateChatUrl(provider);
        try {
            const req = this.deps.http({
                url,
                method: 'POST',
                contentType: 'application/json',
                headers: { Authorization: `Bearer ${key}` },
                body: JSON.stringify(body),
            });
            const res = this.deps.withTimeout ? await this.deps.withTimeout(req, AI_SUMMARY_TIMEOUT_MS) : await req;
            if (res.status === 401) {
                this.deps.notify(`AI 摘要失败：${label} API Key 无效（HTTP 401），请检查设置`, 5000);
                return null;
            }
            if (res.status === 429) {
                this.deps.notify('AI 摘要失败：请求过于频繁或额度不足（HTTP 429）', 5000);
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
            const parsed = parseAiSummaryResult(parseTranslateResponse(json));
            if (!parsed) {
                this.deps.notify('AI 摘要失败（模型未返回可用结果）', 4000);
                return null;
            }
            return parsed;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.deps.notify(`AI 摘要失败：${msg || `无法连接 ${label}`}\n请检查网络或 API Key（${url}）`, 5000);
            return null;
        }
    }
}
