// LRC 双语歌词生成服务（#507）
// 🔴 复用**阅读翻译**那条 AI 服务的服务商与 Key（同一套配置与端点，不为歌词单开一套凭据）——
//    与 `services/aiSummary` 完全同一条纪律；提示词走 `pure/lrcBilingual` 的**内置**那份
//    （⛔ 不接设置页可改的「服务提示词」：逐行对齐是格式契约，被改成自由发挥就整批作废）。
// 网络与依赖注入，便于单测。拆行 / 拼请求体 / 解析 / 合并全在纯模块里。
import { aiHttpIssue, parseAiReply, providerLabel, translateChatUrl } from 'pure/translate';
import type { TranslateProvider } from 'pure/translate';
import {
    buildLrcBilingualBatch,
    buildLrcBilingualBody,
    collectLrcTranslatable,
    mergeBilingualLrc,
    parseLrcBilingualReply,
    LRC_BILINGUAL_BATCH,
    type LrcBilingualMerge,
} from 'pure/lrcBilingual';

/** 歌词比摘要长得多 ⇒ 超时给宽一点（一批最多 60 行） */
export const LRC_BILINGUAL_TIMEOUT_MS = 40000;

export interface LrcBilingualConfig {
    provider: TranslateProvider;
    key: string;
    /** #478：设置页选的模型（空/缺省 ⇒ 该家默认模型） */
    model?: string;
    /** 请求端点（自定义端点由 main 解析好传进来；缺省 ⇒ 按 provider 取内置端点） */
    url?: string;
    /** main 侧 `resolveAiAccess` 的校验结果（缺 Key / 缺端点 / 缺模型）；非空 ⇒ 不发请求 */
    issue?: string;
}

export interface LrcBilingualHttpOptions {
    url: string;
    method: string;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
}
export interface LrcBilingualHttpResponse {
    status: number;
    text: string;
}
export type LrcBilingualHttp = (opts: LrcBilingualHttpOptions) => Promise<LrcBilingualHttpResponse>;

export interface LrcBilingualDeps {
    /** 当前服务商与 Key（读 settings；未配置时 key 为空串） */
    getConfig(): LrcBilingualConfig;
    /** 用户可见提示（Notice） */
    notify(msg: string, ms?: number): void;
    http: LrcBilingualHttp;
    /** 超时包装（main 传 withTimeout）；缺省则不加超时 */
    withTimeout?: <T>(p: Promise<T>, ms: number) => Promise<T>;
}

/**
 * 生成双语歌词：逐批请模型给译文 → 由**纯函数**把译文按 ` | ` 接回原文。
 * 任何失败路径返回 `null`（内部已给用户提示，调用方只需静默处理）—— 与 `AiSummaryService.generate` 同款。
 * ⚠️ 部分批次成功也**照样返回**：`merge` 会如实给出 `applied / missing`，
 *    ⛔ 别因为一批失败就把前面几批的成果一起丢掉（那才是最气人的失败形态）。
 */
export class LrcBilingualService {
    constructor(private deps: LrcBilingualDeps) {}

    async generate(
        lrc: string,
        meta?: { title?: string; artist?: string },
    ): Promise<LrcBilingualMerge | null> {
        const { provider, key, model, url, issue } = this.deps.getConfig();
        if (issue) {
            this.deps.notify(issue, 5000);
            return null;
        }
        const todo = collectLrcTranslatable(lrc);
        if (todo.length === 0) {
            this.deps.notify('这份歌词里没有需要翻译的行（可能已经是双语了）', 4000);
            return null;
        }
        const label = providerLabel(provider);
        if (!key) {
            this.deps.notify(`未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写（歌词与翻译共用 Key）`, 5000);
            return null;
        }
        const endpoint = url || translateChatUrl(provider);

        // 逐批译：tally 按「待译行的总顺序」累积，⛔ 别按批各自 merge（那样行号对不上原文）
        const translations: string[] = [];
        let failedBatch = 0;
        for (let from = 0; from < todo.length; from += LRC_BILINGUAL_BATCH) {
            const batch = buildLrcBilingualBatch(todo.slice(from, from + LRC_BILINGUAL_BATCH));
            const body = buildLrcBilingualBody(batch, provider, model, meta);
            try {
                const req = this.deps.http({
                    url: endpoint,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body),
                });
                const res = this.deps.withTimeout
                    ? await this.deps.withTimeout(req, LRC_BILINGUAL_TIMEOUT_MS)
                    : await req;
                const httpIssue = aiHttpIssue(res.status, label);
                if (httpIssue) {
                    this.deps.notify(`双语歌词失败：${httpIssue}`, 5000);
                    return null;
                }
                if (res.status !== 200) {
                    this.deps.notify(`双语歌词失败（HTTP ${res.status}）`, 4000);
                    return null;
                }
                let json: unknown;
                try {
                    json = JSON.parse(res.text);
                } catch {
                    this.deps.notify('双语歌词失败：响应不是 JSON（多半是端点或代理问题）', 5000);
                    return null;
                }
                const reply = parseAiReply(json);
                if (!reply.ok) {
                    // 🔴 推理模型只给思维链时**别把思维链当译文**（本仓既有铁律）
                    this.deps.notify(
                        reply.reason === 'reasoning-only'
                            ? '双语歌词失败：这个模型只回了思维链，请换一个非推理模型'
                            : '双语歌词失败：模型没有返回内容',
                        5000,
                    );
                    return null;
                }
                const got = parseLrcBilingualReply(reply.text);
                if (got.length === 0) failedBatch += 1;
                // ⚠️ 按**这一批应有的行数**对齐补齐（模型漏行时后面不整体错位 —— 缺失的行原样保留）
                for (let k = 0; k < batch.indexes.length; k++) translations.push(got[k] ?? '');
            } catch (e) {
                this.deps.notify(`双语歌词出错：${e instanceof Error ? e.message : String(e)}`, 5000);
                return null;
            }
        }

        const merged = mergeBilingualLrc(lrc, translations);
        if (merged.applied === 0) {
            this.deps.notify('双语歌词失败：模型返回的行对不上（没有可用的译文）', 5000);
            return null;
        }
        if (failedBatch > 0 || merged.missing > 0) {
            this.deps.notify(
                `已生成双语歌词：${merged.applied} 行（${merged.missing} 行没拿到译文，已按原样保留）`,
                6000,
            );
        }
        return merged;
    }
}
