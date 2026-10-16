/**
 * `services/lrcBilingual` 单测（#507）—— 分批、部分成功、失败路径与「别把思维链当译文」。
 * 传输层注入假实现（⛔ 不打真网络），与 `tests/aiSummary-service.test.ts` 同款骨架。
 */
import { describe, expect, it } from 'vitest';
import { LrcBilingualService, type LrcBilingualHttpOptions } from 'services/lrcBilingual';
import { LRC_BILINGUAL_BATCH } from 'pure/lrcBilingual';

const SRC = ['[ar:x]', '[00:01.00]a', '[00:02.00]b', '[00:03.00]c'].join('\n');

/** 假 http：按调用序号给响应；`reply` 决定模型正文 */
function mk(reply: (nth: number, body: unknown) => { status: number; text: string } | Error) {
    const calls: LrcBilingualHttpOptions[] = [];
    const svc = new LrcBilingualService({
        getConfig: () => ({ provider: 'zhipu', key: 'TEST-KEY', model: 'glm-4-flash' }),
        notify: () => {},
        http: async (opts) => {
            calls.push(opts);
            const r = reply(calls.length, JSON.parse(String(opts.body)));
            if (r instanceof Error) throw r;
            return r;
        },
    });
    return { svc, calls };
}
const ok = (lines: string[]) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines }) } }] }) });

describe('LrcBilingualService.generate', () => {
    it('成功：把译文按 ` | ` 接回原文，时间标签不动', async () => {
        const { svc, calls } = mk(() => ok(['甲', '乙', '丙']));
        const out = await svc.generate(SRC, { title: 't', artist: 'a' });
        expect(out?.applied).toBe(3);
        expect(out?.missing).toBe(0);
        expect(out?.text.split('\n')[1]).toBe('[00:01.00]a | 甲');
        expect(calls).toHaveLength(1);
        expect(calls[0].headers?.Authorization).toBe('Bearer TEST-KEY');
    });

    it('🔴 模型漏行 ⇒ **如实报 missing**、缺的行原样保留（⛔ 不错位、⛔ 不谎报全成）', async () => {
        const { svc } = mk(() => ok(['甲']));
        const out = await svc.generate(SRC);
        expect(out?.applied).toBe(1);
        expect(out?.missing).toBe(2);
        expect(out?.text).toContain('[00:02.00]b');
        expect(out?.text.includes('[00:02.00]b |')).toBe(false);
    });

    it('🔴 超长歌词**分批**：一批 60 行，两批译文都按**全局顺序**拼回（⛔ 别按批各自 merge）', async () => {
        const total = LRC_BILINGUAL_BATCH + 3;
        const many = Array.from({ length: total }, (_, i) => `[00:00.00]w${i}`).join('\n');
        // 按**该批请求里实际有几行**返回几条译文（模拟模型照做）
        const { svc, calls } = mk((_nth, body) => {
            const user = String((body as { messages: { content: string }[] }).messages[1].content);
            const n = user.split('\n').filter((l) => /^\d+\. /.test(l)).length;
            return ok(Array.from({ length: n }, (_, i) => `t${i}`));
        });
        const out = await svc.generate(many);
        expect(calls).toHaveLength(2);
        expect(out?.applied).toBe(total); // 一批 60 + 一批 3，**全拼回去了** ⇒ 顺序没错位、没丢批
        expect(out?.missing).toBe(0);
    });

    it('HTTP 401 ⇒ 可读原因 + 返回 null（⛔ 不半途写回）', async () => {
        const { svc } = mk(() => ({ status: 401, text: '{}' }));
        expect(await svc.generate(SRC)).toBeNull();
    });

    it('响应不是 JSON ⇒ null（不抛给 UI）', async () => {
        const { svc } = mk(() => ({ status: 200, text: '<html>' }));
        expect(await svc.generate(SRC)).toBeNull();
    });

    it('🔴 推理模型只回思维链 ⇒ 拒收（⛔ 绝不把思维链当译文写进歌词）', async () => {
        const { svc } = mk(() => ({
            status: 200,
            text: JSON.stringify({ choices: [{ message: { reasoning_content: '让我想想…' } }] }),
        }));
        expect(await svc.generate(SRC)).toBeNull();
    });

    it('传输层抛错 ⇒ 包成 null（不把异常漏给 UI）', async () => {
        const { svc } = mk(() => new Error('net down'));
        expect(await svc.generate(SRC)).toBeNull();
    });

    it('没有可译行 ⇒ 不发请求就返回 null', async () => {
        const { svc, calls } = mk(() => ok(['x']));
        expect(await svc.generate('[00:01.00]a | 甲')).toBeNull();
        expect(calls).toHaveLength(0);
    });

    it('未配置 Key ⇒ 不发请求（`issue` 优先于一切）', async () => {
        const calls: unknown[] = [];
        const svc = new LrcBilingualService({
            getConfig: () => ({ provider: 'zhipu', key: '', issue: '未配置 zhipu API Key' }),
            notify: () => {},
            http: async (o) => {
                calls.push(o);
                return { status: 200, text: '{}' };
            },
        });
        expect(await svc.generate(SRC)).toBeNull();
        expect(calls).toHaveLength(0);
    });

    it('模型返回纯文本（不是 JSON）也能用 —— 兜底路径', async () => {
        const { svc } = mk(() => ({
            status: 200,
            text: JSON.stringify({ choices: [{ message: { content: '甲\n乙\n丙' } }] }),
        }));
        const out = await svc.generate(SRC);
        expect(out?.applied).toBe(3);
    });
});
