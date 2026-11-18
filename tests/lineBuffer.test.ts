import { describe, it, expect } from 'vitest';
import { createLineSplitter } from '../src/pure/lineBuffer';

/**
 * 🔴 这一组测试的存在理由（用户 m12618「极速版 SenseVoice每隔2分钟出句还是错的」）：
 *
 * 旧的 `feed` 实现是「每个 stream chunk 各自 split('\n')」。外部程序把一条 5～10KB 的
 * JSON 打在 stderr 上，chunk 边界和换行毫无关系 —— 行被切成两半时两个片段都解析失败，
 * **整个结果静默丢失**。真机表现就是「每隔 120 秒才出一句」（丢的正是被切开的那几段）。
 *
 * 这些用例专门把输入从最恶心的位置切开，⛔ 不要为了好写而按行边界喂。
 */
describe('pure/lineBuffer 跨块行缓冲', () => {
    it('一行被切成两半，仍能凑回完整一行', () => {
        const sp = createLineSplitter();
        expect(sp.push(Buffer.from('hello wor'))).toEqual([]);
        expect(sp.push(Buffer.from('ld\n'))).toEqual(['hello world']);
    });

    it('一次喂多行，末尾半行留到下一次', () => {
        const sp = createLineSplitter();
        expect(sp.push(Buffer.from('a\nb\nc'))).toEqual(['a', 'b']);
        expect(sp.push(Buffer.from('d\n'))).toEqual(['cd']);
    });

    it('🔴 JSON 从对象中间被切开仍能拼回并解析', () => {
        const json = JSON.stringify({
            lang: '<|zh|>',
            text: '今天天气很好，我们一起去公园散步吧。',
            tokens: ['今', '天', '天', '气'],
            timestamps: [0.1, 0.4, 0.7, 1.0],
        });
        const cut = Math.floor(json.length / 2);
        const sp = createLineSplitter();
        const got: string[] = [];
        got.push(...sp.push(Buffer.from(json.slice(0, cut))));
        got.push(...sp.push(Buffer.from(json.slice(cut) + '\n')));
        expect(got).toHaveLength(1);
        expect(JSON.parse(got[0])).toMatchObject({ text: '今天天气很好，我们一起去公园散步吧。' });
    });

    it('🔴 中文多字节字符被腰斩时不产生乱码', () => {
        const line = '湖面上有几只鸭子在慢慢地游。';
        const buf = Buffer.from(line + '\n', 'utf8');
        // 故意在第一个汉字（3 字节）的第 2 个字节处切开
        const cut = 2;
        const sp = createLineSplitter();
        const a = sp.push(buf.subarray(0, cut));
        const b = sp.push(buf.subarray(cut));
        expect(a).toEqual([]);
        expect(b).toEqual([line]);
        // 关键：不能出现替换字符
        expect(b.join('')).not.toContain('\uFFFD');
    });

    it('flush 吐出没有换行结尾的残留半行', () => {
        const sp = createLineSplitter();
        expect(sp.push(Buffer.from('last line'))).toEqual([]);
        expect(sp.flush()).toEqual(['last line']);
        // flush 幂等：再调一次不会重复吐
        expect(sp.flush()).toEqual([]);
    });

    it('空行与纯空白行被丢弃，\\r\\n 被正确剥离', () => {
        const sp = createLineSplitter();
        expect(sp.push(Buffer.from('a\r\n\r\n   \r\nb\r\n'))).toEqual(['a', 'b']);
    });

    it('零长度块不影响缓冲', () => {
        const sp = createLineSplitter();
        expect(sp.push(Buffer.alloc(0))).toEqual([]);
        expect(sp.push(Buffer.from('x\n'))).toEqual(['x']);
    });

    it('接受字符串与 Uint8Array', () => {
        const sp = createLineSplitter();
        expect(sp.push('str\n')).toEqual(['str']);
        expect(sp.push(new Uint8Array(Buffer.from('arr\n')))).toEqual(['arr']);
    });

    it('onText 收到的是完整行文本（可用于累积原始输出）', () => {
        const seen: string[] = [];
        const sp = createLineSplitter((t) => seen.push(t));
        sp.push(Buffer.from('one\ntwo\n'));
        expect(seen.join('')).toBe('one\ntwo\n');
    });

    it('🔴 模拟真实 sherpa 分块：一条 JSON 随机切 5 刀仍只产出一行', () => {
        const json = JSON.stringify({ text: '测试', tokens: new Array(200).fill('词'), timestamps: new Array(200).fill(1) });
        const buf = Buffer.from(json + '\n', 'utf8');
        const cuts = [7, 91, 300, 999, 1500].filter((c) => c < buf.length);
        const sp = createLineSplitter();
        const got: string[] = [];
        let prev = 0;
        for (const c of cuts) {
            got.push(...sp.push(buf.subarray(prev, c)));
            prev = c;
        }
        got.push(...sp.push(buf.subarray(prev)));
        got.push(...sp.flush());
        expect(got).toHaveLength(1);
        expect(JSON.parse(got[0])).toMatchObject({ text: '测试' });
    });
});
