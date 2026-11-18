/**
 * sherpa-onnx VAD 版两个 exe 的输出解析。
 *
 * 这里所有样例都是**真机原样抄下来的**（不是编的）：
 *   · offline 版（Paraformer / SenseVoice）：
 *         `0.134 -- 0.940:  good morning`
 *   · online 版（X-ASR）：
 *         `vad segment(1:0.134-0.940) results:  Good morning .`
 *   末尾两个 exe 都会打 `Elapsed seconds` / `Real time factor`。
 */
import { describe, expect, it } from 'vitest';

import {
    VadOnlineCollector,
    buildVadOfflineArgs,
    buildVadOnlineArgs,
    parseVadOfflineLine,
    parseVadOnlineHead,
    splitLongSegments,
    tidySegmentText,
    vadSegmentsToEntries,
} from 'pure/sherpaVad';

describe('parseVadOfflineLine', () => {
    it('认出真机那一行（冒号后是两个空格）', () => {
        expect(parseVadOfflineLine('0.134 -- 0.940:  good morning')).toEqual({
            start: 0.134,
            end: 0.94,
            text: 'good morning',
        });
    });

    it('带前导空白与 CRLF 也能认', () => {
        expect(parseVadOfflineLine('   1.766 -- 4.876: this is a test\r')).toEqual({
            start: 1.766,
            end: 4.876,
            text: 'this is a test',
        });
    });

    it('整数秒、负数、多位整数都按数字解析', () => {
        expect(parseVadOfflineLine('100 -- 120: ok')).toEqual({ start: 100, end: 120, text: 'ok' });
        expect(parseVadOfflineLine('-1.5 -- 0.5: lead')).toEqual({ start: -1.5, end: 0.5, text: 'lead' });
    });

    it('⛔ 收尾日志不是段（Elapsed / RTF）', () => {
        expect(parseVadOfflineLine('Elapsed seconds: 1.161 s')).toBeNull();
        expect(parseVadOfflineLine('Real time factor (RTF): 1.161 / 13.816 = 0.084')).toBeNull();
    });

    it('⛔ 冒号后面是空的段要丢掉（纯噪声触发过）', () => {
        expect(parseVadOfflineLine('0.134 -- 0.940:')).toBeNull();
        expect(parseVadOfflineLine('0.134 -- 0.940:    ')).toBeNull();
    });

    it('⛔ 时间倒挂或零长度要丢掉', () => {
        expect(parseVadOfflineLine('0.940 -- 0.940: same')).toBeNull();
        expect(parseVadOfflineLine('2.0 -- 1.0: reversed')).toBeNull();
    });

    it('⛔ online 版的段头不能被 offline 解析器误吃', () => {
        expect(parseVadOfflineLine('vad segment(1:0.134-0.940) results:  Good morning .')).toBeNull();
    });

    it('空串 / null 不炸', () => {
        expect(parseVadOfflineLine('')).toBeNull();
        expect(parseVadOfflineLine(null as unknown as string)).toBeNull();
    });
});

describe('parseVadOnlineHead', () => {
    it('认出真机段头', () => {
        expect(parseVadOnlineHead('vad segment(1:0.134-0.940) results:  Good morning .')).toEqual({
            start: 0.134,
            end: 0.94,
        });
    });

    it('序号是多位也认', () => {
        expect(parseVadOnlineHead('vad segment(12:5.702-10.796) results: we are')).toEqual({
            start: 5.702,
            end: 10.796,
        });
    });

    it('results 后面为空也算合法段头（正文在后续行）', () => {
        expect(parseVadOnlineHead('vad segment(2:1.766-4.876) results:')).toEqual({ start: 1.766, end: 4.876 });
    });

    it('⛔ offline 版的行不能当段头', () => {
        expect(parseVadOnlineHead('0.134 -- 0.940:  good morning')).toBeNull();
    });

    it('⛔ 时间倒挂的段头丢掉', () => {
        expect(parseVadOnlineHead('vad segment(1:2.0-1.0) results: x')).toBeNull();
    });
});

describe('VadOnlineCollector', () => {
    /** 真机完整输出（13.816 秒音频，四段） */
    const REAL = [
        'vad segment(1:0.134-0.940) results:  Good morning .',
        'vad segment(2:1.766-4.876) results:  This is a test of the local speech recognition',
        'vad segment(3:5.702-10.796) results:  We are checking whether the transcript and the timestamps line up correctly',
        'vad segment(4:11.494-13.100) results:  Thank you for your patience',
        'Elapsed seconds: 2.245 s',
        'Real time factor (RTF): 2.245 / 13.816 = 0.162',
    ];

    it('逐行喂完能拿到四段完整正文', () => {
        const c = new VadOnlineCollector();
        for (const line of REAL) c.push(line);
        const out = c.finish();
        expect(out).toHaveLength(4);
        expect(out[0]).toEqual({ start: 0.134, end: 0.94, text: 'Good morning .' });
        expect(out[3].text).toBe('Thank you for your patience');
    });

    it('push 在遇到新段头时把上一段交出来（执行层靠它做实时进度）', () => {
        const c = new VadOnlineCollector();
        expect(c.push(REAL[0])).toBeNull();
        const closed = c.push(REAL[1]);
        expect(closed).toEqual({ start: 0.134, end: 0.94, text: 'Good morning .' });
    });

    it('⛔ 正文跨多行时必须攒起来，不能一行一条', () => {
        const c = new VadOnlineCollector();
        c.push('vad segment(1:0.0-2.0) results:');
        c.push('Hello');
        c.push('world');
        const out = c.finish();
        expect(out).toEqual([{ start: 0, end: 2, text: 'Hello world' }]);
    });

    it('⛔ Elapsed / RTF 不能混进最后一段的正文', () => {
        const c = new VadOnlineCollector();
        c.push('vad segment(1:0.0-2.0) results: hi');
        c.push('Elapsed seconds: 1.0 s');
        c.push('Real time factor (RTF): 1.0 / 2.0 = 0.5');
        expect(c.finish()[0].text).toBe('hi');
    });

    it('finish 幂等：调用两次不会重复产出', () => {
        const c = new VadOnlineCollector();
        c.push('vad segment(1:0.0-2.0) results: hi');
        expect(c.finish()).toHaveLength(1);
        expect(c.finish()).toHaveLength(1);
    });

    it('空正文的段不入结果，但紧随其后的段正常', () => {
        const c = new VadOnlineCollector();
        c.push('vad segment(1:0.0-1.0) results:');
        c.push('vad segment(2:1.0-2.0) results: second');
        const out = c.finish();
        expect(out).toEqual([{ start: 1, end: 2, text: 'second' }]);
    });

    it('段头时间倒挂时不开新段，也不把后续文字塞进上一段', () => {
        const c = new VadOnlineCollector();
        c.push('vad segment(1:0.0-1.0) results: first');
        c.push('vad segment(2:3.0-2.0) results: bad');
        c.push('stray');
        const out = c.finish();
        expect(out).toEqual([{ start: 0, end: 1, text: 'first' }]);
    });

    it('段头之前出现的杂行被忽略', () => {
        const c = new VadOnlineCollector();
        c.push('loading model …');
        c.push('vad segment(1:0.0-1.0) results: ok');
        expect(c.finish()).toEqual([{ start: 0, end: 1, text: 'ok' }]);
    });
});

describe('tidySegmentText', () => {
    it('压掉半角标点前的空格（X-ASR 实测 `Good morning .`）', () => {
        expect(tidySegmentText(' Good morning .')).toBe('Good morning.');
        expect(tidySegmentText('a , b ; c !')).toBe('a, b; c!');
    });

    it('合并多余空白', () => {
        expect(tidySegmentText('  a   b  ')).toBe('a b');
    });

    it('⛔ 不动中文标点（中文正文里的空格有意义）', () => {
        expect(tidySegmentText('你好 。')).toBe('你好 。');
        expect(tidySegmentText('你 好')).toBe('你 好');
    });
});

describe('vadSegmentsToEntries', () => {
    it('清理文案 + 丢掉空段与倒挂段', () => {
        const out = vadSegmentsToEntries([
            { start: 0, end: 1, text: '  hello . ' },
            { start: 1, end: 2, text: '   ' },
            { start: 3, end: 2, text: 'reversed' },
        ]);
        expect(out).toEqual([{ start: 0, end: 1, text: 'hello.' }]);
    });

    it('按 start 排序（上游将来改并行解码也不会乱序）', () => {
        const out = vadSegmentsToEntries([
            { start: 5, end: 6, text: 'b' },
            { start: 1, end: 2, text: 'a' },
        ]);
        expect(out.map((s) => s.text)).toEqual(['a', 'b']);
    });

    it('非有限时间丢掉', () => {
        const out = vadSegmentsToEntries([{ start: NaN, end: 1, text: 'x' }]);
        expect(out).toEqual([]);
    });
});

describe('splitLongSegments', () => {
    it('短段原样保留', () => {
        const out = splitLongSegments([{ start: 0, end: 1, text: 'hi' }], 20);
        expect(out).toEqual([{ start: 0, end: 1, text: 'hi' }]);
    });

    it('长段按标点切，时间按字符数比例分', () => {
        const text = 'one two three. four five six.';
        const out = splitLongSegments([{ start: 0, end: 10, text }], 20);
        expect(out.length).toBeGreaterThan(1);
        // 首段从原段起点开始
        expect(out[0].start).toBe(0);
        // 时间必须单调不回退
        for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].end - 0.001);
        // 总时长近似守恒
        expect(out[out.length - 1].end).toBeLessThanOrEqual(10);
    });

    it('⛔ maxChars 有下限 8（传 1 也不会切出单字）', () => {
        const out = splitLongSegments([{ start: 0, end: 4, text: 'abcdefghijklmnop' }], 1);
        expect(out.length).toBe(2);
        expect(out[0].text).toHaveLength(8);
    });

    it('单句超长时硬切，保证每块不超过上限', () => {
        const out = splitLongSegments([{ start: 0, end: 4, text: 'abcdefghijklmnopqrstuvwxyz' }], 10);
        for (const s of out) expect(s.text.length).toBeLessThanOrEqual(10);
    });
});

describe('buildVadOfflineArgs', () => {
    it('Paraformer 必须用等号形式 + 必须带 silero vad', () => {
        const args = buildVadOfflineArgs({
            tokens: 'C:/m/tokens.txt',
            paraformer: 'C:/m/model.int8.onnx',
            vadModel: 'C:/m/silero_vad.onnx',
            wav: 'C:/a.wav',
        });
        expect(args).toEqual([
            '--tokens=C:/m/tokens.txt',
            '--paraformer=C:/m/model.int8.onnx',
            '--silero-vad-model=C:/m/silero_vad.onnx',
            'C:/a.wav',
        ]);
    });

    it('threads > 0 才拼进去，且取整', () => {
        const base = { tokens: 't', paraformer: 'p', vadModel: 'v', wav: 'a.wav' };
        expect(buildVadOfflineArgs({ ...base, threads: 4 })).toContain('--num-threads=4');
        expect(buildVadOfflineArgs({ ...base, threads: 3.9 })).toContain('--num-threads=3');
        expect(buildVadOfflineArgs({ ...base, threads: 0 })).toHaveLength(4);
        expect(buildVadOfflineArgs({ ...base, threads: -1 })).toHaveLength(4);
    });

    it('wav 为空时不追加裸参数', () => {
        const args = buildVadOfflineArgs({ tokens: 't', paraformer: 'p', vadModel: 'v', wav: '  ' });
        expect(args).toHaveLength(3);
    });
});

describe('buildVadOnlineArgs', () => {
    it('X-ASR 三个 ONNX 缺一不可', () => {
        const args = buildVadOnlineArgs({
            tokens: 'C:/x/tokens.txt',
            encoder: 'C:/x/encoder-1920ms.onnx',
            decoder: 'C:/x/decoder-1920ms.onnx',
            joiner: 'C:/x/joiner-1920ms.onnx',
            vadModel: 'C:/x/silero_vad.onnx',
            wav: 'C:/a.wav',
        });
        expect(args).toEqual([
            '--tokens=C:/x/tokens.txt',
            '--encoder=C:/x/encoder-1920ms.onnx',
            '--decoder=C:/x/decoder-1920ms.onnx',
            '--joiner=C:/x/joiner-1920ms.onnx',
            '--silero-vad-model=C:/x/silero_vad.onnx',
            'C:/a.wav',
        ]);
    });

    it('⛔ 绝不能出现 --paraformer（online 版实测报 Invalid option）', () => {
        const args = buildVadOnlineArgs({
            tokens: 't',
            encoder: 'e',
            decoder: 'd',
            joiner: 'j',
            vadModel: 'v',
            wav: 'a.wav',
        });
        expect(args.some((a) => a.startsWith('--paraformer'))).toBe(false);
    });

    it('threads 只在 > 0 时拼', () => {
        const base = { tokens: 't', encoder: 'e', decoder: 'd', joiner: 'j', vadModel: 'v', wav: 'a.wav' };
        expect(buildVadOnlineArgs({ ...base, threads: 2 })).toContain('--num-threads=2');
        expect(buildVadOnlineArgs(base)).toHaveLength(6);
    });
});
