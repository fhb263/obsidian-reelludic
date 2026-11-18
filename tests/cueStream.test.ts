// 字幕总结流式解析（m09565 ①-8）
// ⚠️ 全部是对 `pure/cueStream` 的纯函数断言，不碰 DOM / 不碰网络。
import { describe, it, expect } from 'vitest';
import {
    extractStreamingSummary,
    SseCollector,
    chunkDeltaText,
    isStreamDone,
} from 'pure/cueStream';

describe('extractStreamingSummary — 半截 JSON 里抠概括（m09565 ①-8）', () => {
    it('还没吐到 summary 键 ⇒ 空', () => {
        expect(extractStreamingSummary('')).toEqual({ summary: '', done: false });
        expect(extractStreamingSummary('{"poi')).toEqual({ summary: '', done: false });
    });

    it('键名到了但值的引号还没到 ⇒ 空', () => {
        expect(extractStreamingSummary('{"summary"')).toEqual({ summary: '', done: false });
        expect(extractStreamingSummary('{"summary":')).toEqual({ summary: '', done: false });
    });

    it('值吐了一半 ⇒ 只给已收到的部分，done=false', () => {
        expect(extractStreamingSummary('{"summary":"这一集讲了')).toEqual({ summary: '这一集讲了', done: false });
    });

    it('收尾引号到了 ⇒ done=true', () => {
        expect(extractStreamingSummary('{"summary":"讲完了","points":[]}')).toEqual({ summary: '讲完了', done: true });
    });

    it('后半段 points 里出现 summary 字样也不会被骗', () => {
        const raw = '{"summary":"真的概括","points":["这里提到 summary 这个词","另一条"]}';
        expect(extractStreamingSummary(raw).summary).toBe('真的概括');
    });

    it('解转义：\\n / \\" / \\\\ 都还原成真字符', () => {
        const raw = '{"summary":"第一行\\n第二行 \\"带引号\\" 和 \\\\ 反斜杠"}';
        expect(extractStreamingSummary(raw).summary).toBe('第一行\n第二行 "带引号" 和 \\ 反斜杠');
    });

    it('半截 \\uXXXX 不产出，等下一块补齐', () => {
        // \u4e2d 是「中」；只给 \u4e 时不该吐出半个字
        const half = extractStreamingSummary('{"summary":"a\\u4e');
        expect(half.summary).toBe('a');
        expect(half.done).toBe(false);
        const full = extractStreamingSummary('{"summary":"a\\u4e2db"}');
        expect(full.summary).toBe('a中b');
    });

    it('反斜杠在块尾（转义还没接上）⇒ 不吞字符', () => {
        const r = extractStreamingSummary('{"summary":"abc\\');
        expect(r.summary).toBe('abc');
        expect(r.done).toBe(false);
        // 下一块补上 n ⇒ 变成换行
        expect(extractStreamingSummary('{"summary":"abc\\n').summary).toBe('abc\n');
    });

    it('中文键名（摘要 / 概括）也认', () => {
        expect(extractStreamingSummary('{"摘要":"中文键"}').summary).toBe('中文键');
        expect(extractStreamingSummary('{"概括":"另一种"}').summary).toBe('另一种');
    });

    it('⛔ 幂等：同一份全文多次调用结果一致', () => {
        const raw = '{"summary":"稳定输出","points":[]}';
        expect(extractStreamingSummary(raw)).toEqual(extractStreamingSummary(raw));
    });

    it('⛔ 空 / 非字符串不抛错', () => {
        expect(extractStreamingSummary('')).toEqual({ summary: '', done: false });
        // @ts-expect-error 故意传错类型
        expect(extractStreamingSummary(null)).toEqual({ summary: '', done: false });
    });
});

describe('SseCollector — 跨块的 data: 行（m09565 ①-8）', () => {
    it('一块里多条 data 逐条取出', () => {
        const c = new SseCollector();
        const got = c.feed('data: {"a":1}\ndata: {"a":2}\n');
        expect(got).toEqual(['{"a":1}', '{"a":2}']);
    });

    it('🔴 一行被切在两块中间 ⇒ 拼好才产出（TCP 不按行对齐）', () => {
        const c = new SseCollector();
        expect(c.feed('data: {"id":')).toEqual([]);
        expect(c.feed('123}\n')).toEqual(['{"id":123}']);
    });

    it('🔴 多字节中文被腰斩也不会乱码（上游已按 utf8 解码）', () => {
        const c = new SseCollector();
        expect(c.feed('data: {"summary":"中')).toEqual([]);
        expect(c.feed('文"}\n')).toEqual(['{"summary":"中文"}']);
    });

    it('注释行 / event 行 / 空行都跳过', () => {
        const c = new SseCollector();
        const got = c.feed(': ping\nevent: message\n\ndata: {"x":1}\n');
        expect(got).toEqual(['{"x":1}']);
    });

    it('CRLF 也能切（\\r 被剥掉）', () => {
        const c = new SseCollector();
        expect(c.feed('data: {"x":1}\r\ndata: {"x":2}\r\n')).toEqual(['{"x":1}', '{"x":2}']);
    });

    it('末尾缺换行的最后一帧靠 flush 收口', () => {
        const c = new SseCollector();
        expect(c.feed('data: {"x":1}\ndata: {"x":2}')).toEqual(['{"x":1}']);
        expect(c.flush()).toEqual(['{"x":2}']);
        expect(c.flush()).toEqual([]); // 幂等
    });

    it('reset 清空缓冲', () => {
        const c = new SseCollector();
        c.feed('data: {"partial"');
        c.reset();
        expect(c.feed('\n')).toEqual([]);
    });

    it('⛔ 空块不抛错', () => {
        const c = new SseCollector();
        expect(c.feed('')).toEqual([]);
    });
});

describe('chunkDeltaText / isStreamDone（m09565 ①-8）', () => {
    it('取 choices[0].delta.content', () => {
        expect(chunkDeltaText('{"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好');
    });

    it('[DONE] 是正常结束，不算文本', () => {
        expect(chunkDeltaText('data: [DONE]')).toBe('');
        expect(chunkDeltaText('[DONE]')).toBe('');
        expect(isStreamDone('[DONE]')).toBe(true);
        expect(isStreamDone(' {"x":1} ')).toBe(false);
    });

    it('坏 JSON / 空串 / 无 content 都回空串，不抛错', () => {
        expect(chunkDeltaText('{oops')).toBe('');
        expect(chunkDeltaText('')).toBe('');
        expect(chunkDeltaText('{"choices":[{"delta":{}}]}')).toBe('');
        expect(chunkDeltaText('{"choices":[]}')).toBe('');
    });

    it('content 不是字符串（null / 数字）也回空串', () => {
        expect(chunkDeltaText('{"choices":[{"delta":{"content":null}}]}')).toBe('');
        expect(chunkDeltaText('{"choices":[{"delta":{"content":42}}]}')).toBe('');
    });
});
