// 字幕 AI 总结服务（整条字幕 → 一句话概括 + 剧情要点）
// 🔴 与 `services/aiSummary` 完全同一条纪律：网络、配置、提示全注入，便于单测；
//    prompt 构造与响应解析在 `pure/cueSummary.ts`（纯函数），⛔ 本文件不设计 prompt。
//
// 🔴 用户 2026-11-11 裁定：「在设置页为字幕总结单独开一组服务商/模型」
//    ⇒ 配置读的是 `readerCueSummaryProvider` / `readerCueSummaryModel` / `readerCueSummaryPrompt`
//      （与翻译 / 总结 / 搜索 / 预填各自独立），但**共用同一组 Key**——
//      服务商只决定「用哪家跑」，凭据不重复配置（本仓既有口径）。
//
// 🔴 用户 2026-11-11（第二轮）：「给字幕面板的AI改现代化点，如透明化去边框，给加个提问框」
//    ⇒ 本服务新增 `ask()`：对**当前这一集字幕**提问。它与 `generate()` 共用同一条
//      配置与 HTTP 通路（同一家服务商、同一把 Key、同一个超时口径），
//      差别只在 prompt 与解析（`buildCueSummaryBody` vs `buildCueAskBody`）。
//      ⚠️ 提问是**多轮**的：每轮都要重新带字幕原文，所以两者请求体一样大、一样慢 ——
//      这是设计如此（HTTP 无状态，省掉原文模型就会脱离字幕瞎编）。
import { parseAiReply, aiHttpIssue, providerLabel, translateChatUrl } from 'pure/translate';
import type { TranslateProvider, TranslateRequestBody } from 'pure/translate';
import { buildCueSummaryBody, parseCueSummaryResult, buildCueAskBody, parseCueAskResult } from 'pure/cueSummary';
import type { CueSummaryInput, CueSummaryResult, CueAskTurn } from 'pure/cueSummary';
// 🔴 流式解析（用户 m09565 ①-8）：从半截 JSON 抠 summary / 拆 SSE 帧 / 取增量文本
import { extractStreamingSummary, SseCollector, chunkDeltaText, isStreamDone } from 'pure/cueStream';

/**
 * 字幕比条目元数据长得多（动辄十几万字符原文字），超时必须比 `AI_SUMMARY_TIMEOUT_MS`(20s) 宽。
 * ⚠️ 45s 是「一集 40 分钟番剧的字幕 + 中档模型」的实测舒适区；
 *    ⛔ 别省这点时间往下调 —— 长输入下模型本来就要久，提前掐断只会稳定失败。
 */
export const CUE_SUMMARY_TIMEOUT_MS = 45000;

export interface CueSummaryConfig {
    provider: TranslateProvider;
    key: string;
    /** 自定义服务提示词（设置页「AI集成 · 用途 → 字幕总结服务 → 提示词」）；空/缺省 → 用默认提示词 */
    prompt?: string;
    /** 设置页选的模型（空/缺省 ⇒ 该家默认模型） */
    model?: string;
    /** 请求端点（自定义端点由 main 解析好传进来；缺省 ⇒ 按 provider 取内置端点） */
    url?: string;
    /** main 侧的配置校验结果（缺 Key / 缺端点 / 缺模型）；非空 ⇒ 不发请求 */
    issue?: string;
    /**
     * 提问专用的提示词（设置页「字幕提问」那一格）。
     * 缺省 ⇒ 用 `DEFAULT_CUE_ASK_PROMPT`；**刻意与总结的 prompt 分开**：
     * 总结要 JSON、要分点，提问要自然语言、要克制，两套规矩硬塞进一个 prompt 会互相打架。
     */
    askPrompt?: string;
}

export interface CueSummaryHttpOptions {
    url: string;
    method: string;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
}
export interface CueSummaryHttpResponse {
    status: number;
    text: string;
}
export type CueSummaryHttp = (opts: CueSummaryHttpOptions) => Promise<CueSummaryHttpResponse>;

export interface CueSummaryDeps {
    getConfig(): CueSummaryConfig;
    notify(msg: string, ms?: number): void;
    http: CueSummaryHttp;
    withTimeout?: <T>(p: Promise<T>, ms: number) => Promise<T>;
    /**
     * **流式** HTTP（可选）。缺省 ⇒ 流式接口自动退回非流式（一次性出结果），
     * 保证「桌面端没接流式」时功能不消失、只是没有打字机效果。
     * 🔴 为什么做成可选注入而不是直接 require Node：
     *    本文件要能在单测里跑（jsdom 无 Node 网络栈），且移动端根本没有这条通路。
     */
    httpStream?: (opts: CueSummaryHttpOptions, handlers: CueStreamHandlers) => Promise<CueStreamHttpResult>;
}

/** 流式过程的回调：只有 `onText` 必需，其余按需 */
export interface CueStreamHandlers {
    onText(text: string): void;
    /** 收到响应头（可据此提前判 4xx） */
    onStatus?(status: number): void;
    /** 返回 true ⇒ 立刻断开（收到 `[DONE]` 后不必等服务端关连接） */
    shouldStop?(): boolean;
    /** 流式总超时（毫秒）；缺省用 `CUE_SUMMARY_TIMEOUT_MS` */
    timeoutMs?: number;
    signal?: { aborted: boolean };
}

/** 流式 HTTP 的返回（与 `services/nodeHttp.nodeHttpPostStream` 同形，但只取本层要用的字段） */
export interface CueStreamHttpResult {
    status: number;
    text: string;
    stopped?: boolean;
    stopReason?: 'done' | 'timeout' | 'abort' | 'error';
    error?: string;
}

/** 请求失败的分类：调用方据此决定浮层显什么，⛔ 不各自重复判断 */
type ChatFailure = { ok: false; reason: 'config' | 'empty' | 'http' | 'reply'; message: string };
type ChatResult = { ok: true; text: string } | ChatFailure;

export class CueSummaryService {
    constructor(private deps: CueSummaryDeps) {}

    /**
     * 唯一发请求的地方（总结与提问共用）。
     * @param tag 用户可见的动作名（「字幕总结」/「字幕提问」），拼进提示文案
     * @param body 已构造好的请求体；null ⇒ 视为输入为空
     */
    private async chat(body: TranslateRequestBody | null, tag: string): Promise<ChatResult> {
        const { provider, key, url, issue } = this.deps.getConfig();
        if (issue) return { ok: false, reason: 'config', message: issue };
        if (!body) return { ok: false, reason: 'empty', message: `${tag}内容为空` };

        const label = providerLabel(provider);
        if (!key) {
            return {
                ok: false,
                reason: 'config',
                message: `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写（字幕总结/提问与翻译共用 Key）`,
            };
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
            const res = this.deps.withTimeout
                ? await this.deps.withTimeout(req, CUE_SUMMARY_TIMEOUT_MS)
                : await req;

            const httpIssue = aiHttpIssue(res.status, label);
            if (httpIssue) return { ok: false, reason: 'http', message: `${tag}失败：${httpIssue}` };
            if (res.status !== 200) return { ok: false, reason: 'http', message: `${tag}失败（HTTP ${res.status}）` };

            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                return { ok: false, reason: 'http', message: `${tag}失败（响应非 JSON）` };
            }
            const reply = parseAiReply(json);
            if (!reply.ok) {
                return {
                    ok: false,
                    reason: 'reply',
                    message:
                        reply.reason === 'reasoning-only'
                            ? `${tag}失败：该模型只返回了思考过程、没给答案\n请在 设置 → AI集成 · 用途 换一个非推理模型`
                            : `${tag}失败（模型未返回可用结果）`,
                };
            }
            return { ok: true, text: reply.text };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                ok: false,
                reason: 'http',
                message: `${tag}失败：${msg || `无法连接 ${label}`}\n请检查网络或 API Key（${endpoint}）`,
            };
        }
    }

    /** 生成字幕总结；任何失败路径都返回 null（内部已给用户提示，调用方只需静默处理） */
    async generate(input: CueSummaryInput): Promise<CueSummaryResult | null> {
        const { provider, prompt, model } = this.deps.getConfig();
        const body = buildCueSummaryBody(input, provider, prompt, model);
        const got = await this.chat(body, '字幕总结');
        if (!got.ok) {
            // 「空」在面板上就是空态，文案要能对上（没标题 / 没可用字幕原文两种来源）
            this.deps.notify(got.reason === 'empty' ? '字幕内容为空，无法总结' : got.message, got.reason === 'reply' ? 6000 : 5000);
            return null;
        }
        const parsed = parseCueSummaryResult(got.text);
        if (!parsed) {
            this.deps.notify('字幕总结失败（模型未返回可用结果）', 4000);
            return null;
        }
        return parsed;
    }

    /**
     * 就当前这一集的字幕提问。
     *
     * @param history 之前的问答（正序）；只保留最近几条进 prompt
     * @returns 模型回答的纯文本；失败 ⇒ null（已提示）
     *
     * ⚠️ 与 `generate()` 的关键差别：这里**不解析 JSON**。问答应是自然语言，
     *    硬要 JSON 只会在模型「答不出」时逼它编空壳，把「字幕里没提到」吞掉。
     */
    async ask(
        input: CueSummaryInput,
        question: string,
        history: readonly CueAskTurn[] = [],
    ): Promise<string | null> {
        const { provider, model, askPrompt } = this.deps.getConfig();
        const body = buildCueAskBody(input, question, history, provider, askPrompt, model);
        const got = await this.chat(body, '字幕提问');
        if (!got.ok) {
            this.deps.notify(
                got.reason === 'empty' ? '字幕内容为空，无法回答' : got.message,
                got.reason === 'reply' ? 6000 : 5000,
            );
            return null;
        }
        const text = parseCueAskResult(got.text);
        if (!text) {
            this.deps.notify('字幕提问失败（模型未返回可用结果）', 4000);
            return null;
        }
        return text;
    }

    /**
     * **流式**生成字幕总结（用户 m09565 ①-8）。
     *
     * 行为契约：
     * - 边收边把「已收到的 `summary` 前缀」通过 `onPartial` 推给界面（打字机效果）；
     * - `onPartial` 可能被调用很多次，**每次都传累积全文**（⛔ 不是增量片段）——
     *   界面只要「把当前这段设成文本」即可，不必自己累加，避免重复/丢字；
     * - 全部收完后仍走**既有的** `parseCueSummaryResult` 解析（`points` 这时才出），
     *   ⇒ 成功时返回值与非流式 `generate()` 完全同构，调用方无缝；
     * - 失败返回 null（提示已发），与 `generate()` 同口径。
     *
     * ⚠️ 兜底：`deps.httpStream` 没注入（单测环境 / 移动端）⇒ 退回非流式 `generate()`，
     *    此时 `onPartial` 只被调用一次（拿到完整 summary 后）。功能不消失，只是没有打字机。
     *
     * 🔴 为什么提示词不改：仍要求模型输出 JSON。流式解决的只是**传输不阻塞**，
     *    解析侧靠 `pure/cueStream.extractStreamingSummary` 从半截 JSON 里抠 summary。
     *    改成纯文本能全量流式，但要同时改提示词 + 解析器 + 既有单测，且模型未必守格式。
     */
    async generateStream(
        input: CueSummaryInput,
        onPartial: (summary: string, done: boolean) => void,
    ): Promise<CueSummaryResult | null> {
        const { provider, key, url, issue, prompt, model } = this.deps.getConfig();

        // 兜底一：没有流式通道 ⇒ 老老实实走老路（功能不降级，只少了打字机）
        if (!this.deps.httpStream) {
            const got = await this.generate(input);
            if (got?.summary) onPartial(got.summary, true);
            return got;
        }

        const body = buildCueSummaryBody(input, provider, prompt, model, true);
        const label = providerLabel(provider);
        if (issue) {
            this.deps.notify(issue, 5000);
            return null;
        }
        if (!body) {
            this.deps.notify('字幕内容为空，无法总结', 5000);
            return null;
        }
        if (!key) {
            this.deps.notify(
                `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写（字幕总结/提问与翻译共用 Key）`,
                5000,
            );
            return null;
        }

        const endpoint = url || translateChatUrl(provider);
        const collector = new SseCollector();
        /**
         * 🔴 一旦界面开始有文字，后面即使失败也不能静默清空
         *    （用户会看到字打完然后突然消失，比直接失败更吓人）⇒ 保留已展示内容，只补提示。
         */
        let emitted = false;
        let lastLen = 0;

        const onRaw = (chunk: string): void => {
            for (const payload of collector.feed(chunk)) {
                if (isStreamDone(payload)) break;
                if (!chunkDeltaText(payload)) continue;
                const partial = extractStreamingSummary(collector.raw);
                if (!partial.summary || partial.summary.length === lastLen) continue;
                lastLen = partial.summary.length;
                emitted = true;
                onPartial(partial.summary, partial.done);
            }
        };

        let res: CueStreamHttpResult;
        try {
            res = await this.deps.httpStream(
                {
                    url: endpoint,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream' },
                    body: JSON.stringify(body),
                },
                {
                    onText: onRaw,
                    timeoutMs: CUE_SUMMARY_TIMEOUT_MS,
                    // 收到 `[DONE]` 就断开，不必等网关关连接（实测能省 1~3 秒）
                    shouldStop: () => collector.sawDone,
                },
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!emitted) this.deps.notify(`字幕总结失败：${msg || `无法连接 ${label}`}`, 5000);
            return null;
        }

        const issueText = res.status === 200 ? '' : aiHttpIssue(res.status, label) || `HTTP ${res.status}`;
        if (issueText) {
            if (!emitted) this.deps.notify(`字幕总结失败：${issueText}`, 5000);
            return null;
        }
        if (res.error && !emitted) {
            this.deps.notify(`字幕总结失败：${res.error}`, 5000);
            return null;
        }

        // 收尾：把缓冲里最后一帧吐完（服务端可能没给结尾换行），再过一次解析
        onRaw('\n');
        collector.flush();

        /**
         * 🔴 解析的必须是**模型正文**，不是 HTTP 响应体。
         *    流式返回的 `res.text` 是原始 SSE 字节（`data: {"choices":…}` 一帧一帧），
         *    直接喂给 `parseCueSummaryResult` 会因为它不是 JSON 而稳定失败。
         *    ⇒ 优先用 `collector.raw`（已按 SSE 规则剥掉帧结构、只留 delta 正文）。
         *
         * ⚠️ 兜底：个别网关无视 `stream:true`、直接回一整段普通 JSON（没有 `data:` 前缀）。
         *    这时 `collector.raw` 是空的，但 `res.text` 恰好就是模型正文 ⇒ 直接用。
         */
        const looksLikeSse = /^\s*(data|event|:)\s*[:：]/m.test(res.text);
        const modelText = collector.raw || (looksLikeSse ? '' : res.text);

        const parsed = parseCueSummaryResult(modelText);
        if (!parsed) {
            // 已被中断（超时/用户取消）且界面已有字 ⇒ 不算「模型无结果」，别误报
            if (!(emitted && res.stopped)) {
                this.deps.notify('字幕总结失败（模型未返回可用结果）', 4000);
            }
            return null;
        }
        // 对齐最终文本：模型的 summary 可能带多余空白，解析器会 trim ⇒ 以解析结果为准
        if (parsed.summary && parsed.summary.length !== lastLen) onPartial(parsed.summary, true);
        return parsed;
    }
}
