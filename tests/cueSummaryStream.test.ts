// 字幕总结服务 · 流式生成（用户 m09565 ①-8）
// ⚠️ 这里只测 `generateStream` 的编排契约：谁在什么时候被调用、失败如何收口。
//    真正的 SSE 拆帧 / 半截 JSON 抠字段在 tests/cueStream.test.ts。
import { describe, it, expect, vi } from 'vitest';
import { CueSummaryService } from 'services/cueSummary';
import type { CueStreamHttpResult } from 'services/cueSummary';
import type { CueSummaryInput } from 'pure/cueSummary';

const INPUT: CueSummaryInput = {
    title: '测试作品',
    episode: '第 1 话',
    lang: '中文',
    cues: [
        { start: 0, end: 1.5, text: '主角登场' },
        { start: 1.5, end: 3, text: '他走进房间' },
    ],
};

/** 把若干段模型正文包成 SSE 帧（模拟网关真实吐法：一条 data 一个 chunk） */
function sse(...deltas: string[]): string {
    return deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`).join('');
}

function makeService(over: {
    httpStream?: (
        opts: { body?: string; headers?: Record<string, string>; url: string },
        h: { onText(t: string): void; shouldStop?(): boolean },
    ) => Promise<CueStreamHttpResult>;
    key?: string;
    issue?: string;
}) {
    const notify = vi.fn();
    const svc = new CueSummaryService({
        getConfig: () => ({
            provider: 'zhipu',
            key: over.key ?? 'sk-test',
            model: 'GLM-4-Flash',
            issue: over.issue,
        }),
        notify,
        // 非流式通道给一个「不该被调用」的实现：流式路径必须自己走 httpStream
        http: async () => {
            throw new Error('流式路径不该走非流式通道');
        },
        httpStream: over.httpStream,
    });
    return { svc, notify };
}

describe('generateStream — 边收边吐（m09565 ①-8）', () => {
    it('🔴 分批到达时 onPartial 被多次调用，且每次都是「累积全文」', async () => {
        const seen: string[] = [];
        const { svc } = makeService({
            httpStream: async (_o, h) => {
                // 模拟模型把 JSON 一个字一个字吐出来
                for (const piece of ['{"summ', 'ary":"讲', '了主角', '进场",', '"points":["第一点"]}']) {
                    h.onText(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
                }
                return { status: 200, text: '{"summary":"讲了主角进场","points":["第一点"]}' };
            },
        });
        const got = await svc.generateStream(INPUT, (s) => seen.push(s));

        // 至少吐过两次（不是等全部完成才一次性渲染）
        expect(seen.length).toBeGreaterThan(1);
        // 每次传入的都是前缀关系（累积全文，⛔ 不是增量拼接）
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i].startsWith(seen[i - 1])).toBe(true);
        }
        expect(seen[seen.length - 1]).toBe('讲了主角进场');
        // 返回值与非流式同构
        expect(got).toEqual({ summary: '讲了主角进场', points: ['第一点'] });
    });

    it('请求体带 stream:true 且 Accept: text/event-stream', async () => {
        let body: string | undefined;
        let headers: Record<string, string> | undefined;
        const { svc } = makeService({
            httpStream: async (o) => {
                body = o.body;
                headers = o.headers;
                return { status: 200, text: '{"summary":"x","points":[]}' };
            },
        });
        await svc.generateStream(INPUT, () => {});
        expect(JSON.parse(body!).stream).toBe(true);
        expect(headers?.Accept).toBe('text/event-stream');
        expect(headers?.Authorization).toBe('Bearer sk-test');
    });

    it('没有流式通道 ⇒ 退回非流式，onPartial 只调一次（功能不消失）', async () => {
        const notify = vi.fn();
        const svc = new CueSummaryService({
            getConfig: () => ({ provider: 'zhipu', key: 'sk-test', model: 'GLM-4-Flash' }),
            notify,
            // 非流式通道回的是 OpenAI 信封（chat() 会先解析信封再取正文）
            http: async () => ({
                status: 200,
                text: JSON.stringify({ choices: [{ message: { content: '{"summary":"老路","points":[]}' } }] }),
            }),
        });
        const seen: string[] = [];
        const got = await svc.generateStream(INPUT, (s) => seen.push(s));
        expect(got).toEqual({ summary: '老路', points: [] });
        expect(seen).toEqual(['老路']);
    });

    it('缺 Key ⇒ 提示且不发请求', async () => {
        const streamer = vi.fn();
        const notify = vi.fn();
        const svc = new CueSummaryService({
            getConfig: () => ({ provider: 'zhipu', key: '', model: 'GLM-4-Flash' }),
            notify,
            http: async () => ({ status: 200, text: '' }),
            httpStream: streamer,
        });
        const got = await svc.generateStream(INPUT, () => {});
        expect(got).toBeNull();
        expect(streamer).not.toHaveBeenCalled();
        expect(notify.mock.calls[0][0]).toContain('未配置');
    });

    it('没字幕 ⇒ 提示「字幕内容为空」且不发请求', async () => {
        const streamer = vi.fn();
        const notify = vi.fn();
        const svc = new CueSummaryService({
            getConfig: () => ({ provider: 'zhipu', key: 'sk-test', model: 'GLM-4-Flash' }),
            notify,
            http: async () => ({ status: 200, text: '' }),
            httpStream: streamer,
        });
        const got = await svc.generateStream({ title: '只有标题', cues: [] }, () => {});
        expect(got).toBeNull();
        expect(streamer).not.toHaveBeenCalled();
        expect(notify.mock.calls[0][0]).toContain('字幕内容为空');
    });

    it('HTTP 4xx 且还没吐字 ⇒ 提示失败', async () => {
        const notify = vi.fn();
        const svc = new CueSummaryService({
            getConfig: () => ({ provider: 'zhipu', key: 'sk-test', model: 'GLM-4-Flash' }),
            notify,
            http: async () => ({ status: 200, text: '' }),
            httpStream: async () => ({ status: 401, text: '' }),
        });
        expect(await svc.generateStream(INPUT, () => {})).toBeNull();
        expect(notify).toHaveBeenCalled();
    });

    it('🔴 已经吐过字之后失败 ⇒ 不清空、不再弹「模型未返回可用结果」', async () => {
        const notify = vi.fn();
        const svc = new CueSummaryService({
            getConfig: () => ({ provider: 'zhipu', key: 'sk-test', model: 'GLM-4-Flash' }),
            notify,
            http: async () => ({ status: 200, text: '' }),
            httpStream: async (_o, h) => {
                h.onText(sse('{"summary":"讲了一半'));
                // 半截 JSON ⇒ 解析不出，但界面已经有字
                return { status: 200, text: '{"summary":"讲了一半', stopped: true, stopReason: 'timeout' };
            },
        });
        expect(await svc.generateStream(INPUT, () => {})).toBeNull();
        // 有字时不误报「模型未返回可用结果」
        const msgs = notify.mock.calls.map((c) => String(c[0]));
        expect(msgs.some((m) => m.includes('模型未返回可用结果'))).toBe(false);
    });

    it('收到 [DONE] ⇒ shouldStop 返回 true（提前收尾）', async () => {
        let stopped = false;
        const { svc } = makeService({
            httpStream: async (_o, h) => {
                h.onText(
                    sse('{"summary":"完') +
                        `data: ${JSON.stringify({ choices: [{ delta: { content: '结"}' } }] })}\n\n`,
                );
                // 模拟真实网关：先问一次 shouldStop（此时还没 [DONE]）
                expect(h.shouldStop?.()).toBe(false);
                h.onText('data: [DONE]\n\n');
                stopped = h.shouldStop?.() ?? false;
                return { status: 200, text: '{"summary":"完结","points":[]}' };
            },
        });
        await svc.generateStream(INPUT, () => {});
        expect(stopped).toBe(true);
    });

    it('半截 \\uXXXX 不会把半个字显示到界面上', async () => {
        const seen: string[] = [];
        const { svc } = makeService({
            httpStream: async (_o, h) => {
                // `\u4e2d` = 「中」。故意把它切成 `\u4e` + `2d` 两块，
                // 模拟 TCP 正好断在转义序列中间
                h.onText(sse('{"summary":"\\u4e'));
                h.onText(sse('2d文"}'));
                return { status: 200, text: '' };
            },
        });
        await svc.generateStream(INPUT, (s) => seen.push(s));
        // 中间任何一次都不该出现单独的反斜杠或 u4e 字面量
        for (const s of seen) {
            expect(s).not.toContain('\\u');
            expect(s).not.toContain('u4e');
        }
        expect(seen[seen.length - 1]).toBe('中文');
    });

    it('⛔ 空串/无 summary 的块不会触发 onPartial（避免界面闪空）', async () => {
        const seen: string[] = [];
        const { svc } = makeService({
            httpStream: async (_o, h) => {
                h.onText(sse('{"poi', 'nts":['));
                return { status: 200, text: '{"summary":"","points":[]}' };
            },
        });
        await svc.generateStream(INPUT, (s) => seen.push(s));
        expect(seen).toEqual([]);
    });
});
