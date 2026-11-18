/**
 * 字幕总结 · 流式增量解析（纯逻辑，无 obsidian / 无网络依赖，可单测）
 *
 * 🔴 用户 m09565 ①-8 逐字：「字幕面板-AI总结输出动效改成流式打字机（在接收到流式文本片段时，
 *    **以固定节奏逐段追加到 DOM**，而不是等全部完成再一次性渲染。）」
 *
 * 🔴 为什么这个文件值得单独存在：模型吐的是 **JSON**（`{"summary":"…","points":[…]}`），
 *    流式时第一块收到的可能是 `{"summ` 这种半截 —— 直接扔进 `JSON.parse` 必然抛错，
 *    等收完再解析又变成「不是流式」。所以必须能**边收边从半截 JSON 里把 summary 抠出来**。
 *
 * 三条口径：
 *  ⑴ **只抠 summary 这一个字段**。用户裁定（m09565 方案 A）：概括实时流式显示，
 *     要点等 JSON 收完再整块渲染 —— 要点是数组，半截状态下拿不到可用内容。
 *  ⑵ **转义必须边解边拼**。模型会吐 `\"` / `\\` / `\n` / `\uXXXX`；
 *     不处理就会在界面上看到 `\n` 两个字符，或者被 `\"` 提前截断。
 *  ⑶ **半截转义不吞字符**：`\u30` 这种还没吐完的，本轮先不产出，
 *     等下一块补齐再出 —— ⛔ 别把 `\u30` 当普通字符显示出来。
 */

/** 流式抽 summary 的中间态：`summary` 是已解转义的部分，`done` 表示该字段的收尾引号已到 */
export interface SummaryPartial {
    /** 已经可以显示的那段概括（已解转义） */
    summary: string;
    /** `summary` 字段是否已经闭合（闭合后不会再变长） */
    done: boolean;
}

const EMPTY_PARTIAL: SummaryPartial = { summary: '', done: false };

/** `"summary"` 字段名的几种常见变体：模型偶尔写成 `概括` / `摘要`（中文键） */
const SUMMARY_KEYS = ['summary', '摘要', '概括'];

/**
 * 从一个**可能不完整**的 JSON 文本里，抠出 `summary` 字段当前已收到的内容。
 *
 * ⚠️ 这个函数是幂等的：把「累积到现在的全文」传进来，就返回「现在能显示的全部」；
 *    ⛔ 不要传增量片段（它自己不做拼接，调用方累积）。
 *
 * 返回 `done: true` 只表示**这个字符串字段**闭合了，不代表整个 JSON 收完
 * （`points` 还在后面）。
 */
export function extractStreamingSummary(raw: string): SummaryPartial {
    if (typeof raw !== 'string' || !raw) return EMPTY_PARTIAL;

    const start = findSummaryValueStart(raw);
    if (start < 0) return EMPTY_PARTIAL;

    const out: string[] = [];
    let i = start;
    while (i < raw.length) {
        const ch = raw[i];
        if (ch === '"') {
            // 未转义的收尾引号 ⇒ 该字段闭合
            return { summary: out.join(''), done: true };
        }
        if (ch !== '\\') {
            out.push(ch);
            i += 1;
            continue;
        }
        // —— 转义序列 ——
        const next = raw[i + 1];
        if (next === undefined) break; // 反斜杠是最后一块的尾巴，等下一块
        switch (next) {
            case '"':
                out.push('"');
                i += 2;
                break;
            case '\\':
                out.push('\\');
                i += 2;
                break;
            case '/':
                out.push('/');
                i += 2;
                break;
            case 'b':
                out.push('\b');
                i += 2;
                break;
            case 'f':
                out.push('\f');
                i += 2;
                break;
            case 'n':
                out.push('\n');
                i += 2;
                break;
            case 'r':
                out.push('\r');
                i += 2;
                break;
            case 't':
                out.push('\t');
                i += 2;
                break;
            case 'u': {
                const hex = raw.slice(i + 2, i + 6);
                // 半截的 \uXXXX：本轮不产出，等下一块补齐（⛔ 别把 \u30 当正文显示）
                if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return { summary: out.join(''), done: false };
                out.push(String.fromCharCode(parseInt(hex, 16)));
                i += 6;
                break;
            }
            default:
                // 未知转义：按字面保留反斜杠与字符，别丢信息
                out.push(next);
                i += 2;
                break;
        }
    }
    // 扫到末尾还没见到收尾引号 ⇒ 字段仍在增长
    return { summary: out.join(''), done: false };
}

/**
 * 定位 `"summary":"` 里**值的第一个字符**的下标；找不到返回 -1。
 *
 * ⚠️ 必须过 `findJsonStringEnd` 那种「跳过字符串内部」的扫描吗？这里不需要：
 *    summary 是模型输出里第一个出现的字段（默认提示词的 JSON 顺序就是 summary 在前、
 *    points 在后），而且我们只找**键名 + 冒号 + 引号**这一串。
 *    但为了不被前面的 `"points":["…里含 summary 字样…"]` 骗到，仍要求键名前是
 *    `{` 或 `,`（JSON 里键名的合法前缀）。
 */
function findSummaryValueStart(raw: string): number {
    for (const key of SUMMARY_KEYS) {
        const needle = `"${key}"`;
        let from = 0;
        for (;;) {
            const idx = raw.indexOf(needle, from);
            if (idx < 0) break;
            // 键名必须是对象里的键：前面（跳过空白）是 `{` 或 `,`
            let p = idx - 1;
            while (p >= 0 && /\s/.test(raw[p])) p -= 1;
            const okay = p < 0 || raw[p] === '{' || raw[p] === ',';
            if (okay) {
                // 冒号 + 可空白 + 双引号
                let q = idx + needle.length;
                while (q < raw.length && /\s/.test(raw[q])) q += 1;
                if (raw[q] !== ':') {
                    from = idx + 1;
                    continue;
                }
                q += 1;
                while (q < raw.length && /\s/.test(raw[q])) q += 1;
                if (raw[q] !== '"') {
                    from = idx + 1;
                    continue;
                }
                return q + 1;
            }
            from = idx + 1;
        }
    }
    return -1;
}

/**
 * SSE 增量收集器：把一块块原始字节拼成「一条条 `data:` 负载」。
 *
 * 🔴 为什么需要它：TCP 分块**不按行对齐** —— 一块可能在 `data: {"id":` 中间断开。
 *    在 `services` 层直接 `buf.toString().split('\n')` 会切坏 JSON，而且多字节中文
 *    被腰斩时会变成乱码（本仓在 llama 那一路踩过同样的坑）。
 *
 * 用法：`feed(chunk)` 拿回「本轮能完整解析的事件数组」，末尾调 `flush()` 处理**最后一帧没有换行**的情况。
 *
 * 🔴 顺带累积模型正文（`raw`）与结束标记（`sawDone`）：
 *    服务层每收到一段就要拿「累积到现在的模型输出全文」去抠 summary，
 *    自己再拼一遍容易与这里的过滤口径（跳过心跳/event 行）脱节 ⇒ 只留一份。
 */
export class SseCollector {
    private buffer = '';
    /** 累积的模型正文（只含 `choices[0].delta.content`，不含 SSE 帧结构） */
    private text = '';
    /** 是否已经见过 `[DONE]`（见过就该主动断开，不必等服务端关连接） */
    private done = false;

    /** 累积到现在的模型输出全文（⛔ 只读；要清空用 `reset()`） */
    get raw(): string {
        return this.text;
    }

    /** 是否已收到 `[DONE]` 结束标记 */
    get sawDone(): boolean {
        return this.done;
    }

    /** 喂一块新数据，返回本次凑齐的 `data:` 负载（已剥离前缀，未 JSON 解析） */
    feed(chunk: string): string[] {
        if (!chunk) return [];
        this.buffer += chunk;
        const out: string[] = [];
        // SSE 事件以空行分隔；这里按行处理，`data:` 连续多行的按规范用 \n 连接
        for (;;) {
            const nl = this.buffer.indexOf('\n');
            if (nl < 0) break;
            const line = this.buffer.slice(0, nl).replace(/\r$/, '');
            this.buffer = this.buffer.slice(nl + 1);
            const payload = sseDataPayload(line);
            if (payload !== null) {
                this.absorb(payload);
                out.push(payload);
            }
        }
        return out;
    }

    /** 收口：把缓冲里剩下的一行（服务器最后没补换行）也当成事件 */
    flush(): string[] {
        const rest = this.buffer.replace(/\r$/, '');
        this.buffer = '';
        if (!rest) return [];
        const payload = sseDataPayload(rest);
        if (payload === null) return [];
        this.absorb(payload);
        return [payload];
    }

    /** 清空（取消 / 重来时用） */
    reset(): void {
        this.buffer = '';
        this.text = '';
        this.done = false;
    }

    /** 把一条负载里的正文并进 `text`，并记下结束标记 */
    private absorb(payload: string): void {
        if (isStreamDone(payload)) {
            this.done = true;
            return;
        }
        const delta = chunkDeltaText(payload);
        if (delta) this.text += delta;
    }
}

/** 从一行 SSE 取 `data:` 后面的负载；非 data 行（`event:` / `:ping` / 空行）返回 null */
function sseDataPayload(line: string): string | null {
    if (!line) return null;
    if (line.startsWith(':')) return null; // 注释/心跳
    const m = /^data\s*:\s?(.*)$/.exec(line);
    return m ? m[1] : null;
}

/** OpenAI 兼容流式 chunk 的形态（只声明我们要用的那两条腿） */
interface ChatChunk {
    choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
}

/**
 * 从一条 `data:` 负载里取增量文本；取不到返回空串。
 *
 * ⚠️ `data: [DONE]` 是正常结束标记（OpenAI 规范），返回空串即可，⛔ 别当错误。
 * ⚠️ 部分厂商在流末尾塞一条 `{"error":{...}}`，这里只取 `choices[0].delta.content`，
 *    那条自然取不到 —— 错误由服务层按 HTTP 状态 / 整段文本兜底判断。
 */
export function chunkDeltaText(payload: string): string {
    const t = payload.trim();
    if (!t || t === '[DONE]') return '';
    try {
        const obj = JSON.parse(t) as ChatChunk;
        const c = obj?.choices?.[0]?.delta?.content;
        return typeof c === 'string' ? c : '';
    } catch {
        return '';
    }
}

/**
 * 判断一条流式负载是否为结束标记。
 * ⚠️ 用来让服务层提前收尾，不必等 TCP 关闭（有些厂商不主动断连接）。
 */
export function isStreamDone(payload: string): boolean {
    const t = payload.trim();
    return t === '[DONE]';
}
