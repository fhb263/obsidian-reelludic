import { describe, it, expect } from 'vitest';
import {
    buildSegmentArgs,
    buildSenseVoiceArgs,
    clampEntries,
    entriesToSrt,
    mergePunctOnly,
    parseSenseVoiceJson,
    planSegments,
    segmentIndexOf,
    srtStamp,
    svLang,
    tokenWords,
    tokensToEntries,
    SV_GAP_SECONDS,
    SV_MAX_CHARS,
    SV_SEGMENT_SECONDS,
} from 'pure/senseVoice';

/** 真机抓到的形如 sherpa stdout 的那一行（截短，但结构与长度关系保持真实） */
const REAL_LINE =
    '{"lang": "<|en|>", "emotion": "<|HAPPY|>", "event": "<|Speech|>", "text": "good morning this is a test", ' +
    '"timestamps": [0.18, 0.3, 0.42, 1.62, 1.92], "durations": [], "tokens": ["go", "od", " morning", " this", " is"]}';

/** sherpa 把整份 OfflineRecognizerConfig 也打到 stderr —— 那里面全是花括号，但不是结果 */
const CONFIG_ECHO = 'OfflineRecognizerConfig(feat_config=FeatureExtractorConfig({{"feature_dim": 80}}), model_config=..., tokens="x")';

describe('pure/senseVoice 解析 sherpa 输出', () => {
    it('解析真实那一行', () => {
        const got = parseSenseVoiceJson(REAL_LINE);
        expect(got).not.toBeNull();
        expect(got?.tokens).toHaveLength(5);
        expect(got?.timestamps).toHaveLength(5);
        expect(got?.text).toBe('good morning this is a test');
    });

    it('⛔ 不把配置回显当成结果（它含大量花括号但以非 { 开头）', () => {
        expect(parseSenseVoiceJson(CONFIG_ECHO)).toBeNull();
    });

    it('以 { 开头但缺 tokens 键 ⇒ null（那是别的 JSON）', () => {
        expect(parseSenseVoiceJson('{"foo": 1, "bar": 2}')).toBeNull();
    });

    it('坏 JSON / 普通日志行 / 空串 ⇒ null，⛔ 不抛错', () => {
        expect(parseSenseVoiceJson('{ broken')).toBeNull();
        expect(parseSenseVoiceJson('正在准备音频…')).toBeNull();
        expect(parseSenseVoiceJson('')).toBeNull();
    });

    it('timestamps 里混入非数字时被过滤掉（不能让 NaN 流进时间轴）', () => {
        const got = parseSenseVoiceJson('{"tokens": ["a", "b"], "timestamps": [0.5, null], "text": "ab"}');
        expect(got).not.toBeNull();
        expect(got?.timestamps).toEqual([0.5]);
    });

    it('tokens 为空数组 ⇒ null（没识别出东西的段不该被当成有效结果）', () => {
        expect(parseSenseVoiceJson('{"tokens": [], "timestamps": []}')).toBeNull();
    });
});

describe('pure/senseVoice svLang', () => {
    it('留空与 auto 都交回自动判别', () => {
        expect(svLang(undefined)).toBe('auto');
        expect(svLang('')).toBe('auto');
        expect(svLang('auto')).toBe('auto');
    });

    it('长代码按前缀收敛成 sherpa 的短名', () => {
        expect(svLang('zh-CN')).toBe('zh');
        expect(svLang('en-US')).toBe('en');
        expect(svLang('ja')).toBe('ja');
        expect(svLang('ko-KR')).toBe('ko');
        expect(svLang('yue')).toBe('yue');
    });

    it('🔴 认不出的语言回落 auto，⛔ 不原样透传（sherpa 遇未知语言会直接退出）', () => {
        expect(svLang('klingon')).toBe('auto');
        expect(svLang('fr')).toBe('auto');
    });
});

describe('pure/senseVoice buildSenseVoiceArgs', () => {
    const base = { model: 'm.onnx', tokens: 't.txt', wavs: ['a.wav'] };

    it('参数用等号形式（sherpa 的 CLI 只认 --key=value）', () => {
        const args = buildSenseVoiceArgs(base);
        expect(args).toContain('--tokens=t.txt');
        expect(args).toContain('--sense-voice-model=m.onnx');
        expect(args).toContain('--sense-voice-language=auto');
    });

    it('🔴 ITN 必须开（口述数字要变阿拉伯数字，字幕可读性全靠它）', () => {
        expect(buildSenseVoiceArgs(base)).toContain('--sense-voice-use-itn=1');
    });

    it('线程数只在正数时才拼进去', () => {
        expect(buildSenseVoiceArgs({ ...base, threads: 4 })).toContain('--num-threads=4');
        expect(buildSenseVoiceArgs({ ...base, threads: 0 })).not.toContain('--num-threads=0');
        // base 本身 4 个参数 + 1 个 wav = 5（⛔ 不是 4）
        expect(buildSenseVoiceArgs({ ...base, threads: Number.NaN })).toHaveLength(5);
    });

    it('wav 追加在最后、空路径被跳过', () => {
        const args = buildSenseVoiceArgs({ ...base, wavs: ['a.wav', '', 'b.wav'] });
        expect(args.slice(-2)).toEqual(['a.wav', 'b.wav']);
    });
});

describe('pure/senseVoice buildSegmentArgs / segmentIndexOf', () => {
    it('切段参数含 segment 与 %04d 序列占位', () => {
        const args = buildSegmentArgs('in.wav', 'seg_%04d.wav', 120);
        expect(args).toContain('-f');
        expect(args).toContain('segment');
        expect(args[args.indexOf('-segment_time') + 1]).toBe('120');
        expect(args[args.length - 1]).toBe('seg_%04d.wav');
    });

    it('段长非法时回落默认值', () => {
        const args = buildSegmentArgs('in.wav', 'p.wav', 0);
        expect(args[args.indexOf('-segment_time') + 1]).toBe(String(SV_SEGMENT_SECONDS));
    });

    it('🔴 段号从文件名取，⛔ 不能用循环下标（中间漏一段会让整个时间轴错位）', () => {
        expect(segmentIndexOf('seg_0000.wav')).toBe(0);
        expect(segmentIndexOf('seg_0007.wav')).toBe(7);
        expect(segmentIndexOf('seg_1234.WAV')).toBe(1234);
    });

    it('认不出的文件名返 -1（调用方据此丢弃）', () => {
        expect(segmentIndexOf('whatever.wav')).toBe(-1);
        expect(segmentIndexOf('seg_0001.mp3')).toBe(-1);
        expect(segmentIndexOf('')).toBe(-1);
    });
});

describe('pure/senseVoice tokenWords', () => {
    const obj = { text: '', tokens: ['go', 'od', ' morning'], timestamps: [1, 1.2, 1.4] };

    it('按 token 起始秒 + 段偏移算绝对时间', () => {
        const w = tokenWords(obj, 10, 120);
        expect(w.map((x) => x.start)).toEqual([11, 11.2, 11.4]);
    });

    it('中间词的结束时间用下一个词的起点', () => {
        const w = tokenWords(obj, 0, 120);
        expect(w[0].end).toBeCloseTo(1.2, 5);
        expect(w[1].end).toBeCloseTo(1.4, 5);
    });

    it('🔴 末词没有下一个起点 ⇒ 按字数估一个不短于 0.25s 的时长', () => {
        const w = tokenWords(obj, 0, 120);
        expect(w[2].end).toBeGreaterThan(w[2].start);
        expect(w[2].end - w[2].start).toBeGreaterThanOrEqual(0.25);
    });

    it('🔴 tokens 比 timestamps 长时按较短者截断，⛔ 不能产出 NaN', () => {
        const w = tokenWords({ text: '', tokens: ['a', 'b', 'c'], timestamps: [0, 0.5] }, 0, 10);
        expect(w).toHaveLength(2);
        for (const x of w) {
            expect(Number.isFinite(x.start)).toBe(true);
            expect(Number.isFinite(x.end)).toBe(true);
        }
    });

    it('timestamps 更长时同样按较短者截断', () => {
        const w = tokenWords({ text: '', tokens: ['a'], timestamps: [0, 0.5, 1] }, 0, 10);
        expect(w).toHaveLength(1);
    });

    it('结束时间不超过该段总长', () => {
        const w = tokenWords({ text: '', tokens: ['a', 'b'], timestamps: [0, 50] }, 0, 5);
        for (const x of w) expect(x.end).toBeLessThanOrEqual(5);
    });

    it('空 token ⇒ 空数组', () => {
        expect(tokenWords({ text: '', tokens: [], timestamps: [] }, 0, 10)).toEqual([]);
    });
});

describe('pure/senseVoice tokensToEntries 句级聚合', () => {
    const mk = (pairs: [string, number][]) => pairs.map(([text, start], i) => ({ text, start, end: start + 0.2, ...(i < 0 ? {} : {}) }));

    it('句末标点触发断句', () => {
        const words = mk([['Hello.', 0], ['World.', 1]]);
        const e = tokensToEntries(words, 10);
        expect(e).toHaveLength(2);
        expect(e[0].text).toBe('Hello.');
        expect(e[1].text).toBe('World.');
    });

    it('停顿超过阈值触发断句', () => {
        const words = [
            { text: 'a', start: 0, end: 0.2 },
            { text: 'b', start: 0.2 + SV_GAP_SECONDS + 0.5, end: 2 },
        ];
        const e = tokensToEntries(words, 10);
        expect(e).toHaveLength(2);
    });

    it('攒够字数触发断句', () => {
        const words = mk([['x'.repeat(SV_MAX_CHARS), 0], ['y', 3]]);
        const e = tokensToEntries(words, 10);
        expect(e.length).toBeGreaterThanOrEqual(2);
    });

    it('🔴 纯标点 token 不能靠「太长」触发断句（真机：句号自成一屏的根因）', () => {
        const words = mk([
            ['x'.repeat(SV_MAX_CHARS), 0],
            ['.', 1],
            ['more', 1.2],
        ]);
        const e = tokensToEntries(words, 10);
        // 标点不该独立成一条
        expect(e.every((x) => x.text.trim() !== '.')).toBe(true);
    });

    it('空 token 数组 ⇒ 空条目', () => {
        expect(tokensToEntries([], 10)).toEqual([]);
    });

    it('每条的 end 一定大于 start（否则播放器里那条字幕永不消失）', () => {
        const words = mk([['Hi.', 0]]);
        for (const e of tokensToEntries(words, 10)) expect(e.end).toBeGreaterThan(e.start);
    });

    it('结束时间不超过 limit', () => {
        const words = mk([['Hi.', 0], ['there.', 100]]);
        for (const e of tokensToEntries(words, 5)) expect(e.end).toBeLessThanOrEqual(5);
    });
});

describe('pure/senseVoice mergePunctOnly', () => {
    it('🔴 纯标点条目并回上一条（真机：`...correctly` 攒满 60 字先断、句号自成一屏）', () => {
        const out = mergePunctOnly([
            { text: 'we are checking correctly', start: 0, end: 3 },
            { text: '.', start: 3.1, end: 3.3 },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe('we are checking correctly.');
        expect(out[0].start).toBe(0);
        expect(out[0].end).toBeCloseTo(3.3, 5);
    });

    it('第一条就是纯标点时保留（没有上一条可并）', () => {
        const out = mergePunctOnly([{ text: '.', start: 0, end: 0.3 }]);
        expect(out).toHaveLength(1);
    });

    it('正常条目原样保留', () => {
        const out = mergePunctOnly([
            { text: 'a.', start: 0, end: 1 },
            { text: 'b.', start: 1, end: 2 },
        ]);
        expect(out.map((x) => x.text)).toEqual(['a.', 'b.']);
    });

    it('中文标点与顿号也算纯标点', () => {
        const out = mergePunctOnly([
            { text: '一句话', start: 0, end: 1 },
            { text: '，', start: 1, end: 1.1 },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe('一句话，');
    });

    it('不改入参', () => {
        const input = [{ text: 'a', start: 0, end: 1 }];
        mergePunctOnly(input);
        expect(input[0].text).toBe('a');
    });
});

describe('pure/senseVoice clampEntries', () => {
    it('🔴 超出总长的终点被夹住（真机：13.82s 音频被算到 22.079s，末条永不消失）', () => {
        const out = clampEntries([{ text: 'a', start: 6, end: 22.079 }], 13.82);
        expect(out[0].end).toBeCloseTo(13.82, 3);
    });

    it('起点就超出总长的整条丢弃', () => {
        const out = clampEntries([{ text: 'a', start: 20, end: 30 }], 13.82);
        expect(out).toHaveLength(0);
    });

    it('夹完 end <= start 时补 0.3s 兜底', () => {
        const out = clampEntries([{ text: 'a', start: 13.8, end: 30 }], 13.82);
        expect(out).toHaveLength(1);
        expect(out[0].end).toBeGreaterThan(out[0].start);
    });

    it('总长未知（<=0）时原样返回副本', () => {
        const input = [{ text: 'a', start: 0, end: 999 }];
        const out = clampEntries(input, 0);
        expect(out[0].end).toBe(999);
        expect(out).not.toBe(input);
    });
});

describe('pure/senseVoice srtStamp / entriesToSrt', () => {
    it('时间戳是 HH:MM:SS,mmm', () => {
        expect(srtStamp(0)).toBe('00:00:00,000');
        expect(srtStamp(1.5)).toBe('00:00:01,500');
        expect(srtStamp(3661.25)).toBe('01:01:01,250');
    });

    it('负数与 NaN 收敛成 0（⛔ 不能拼出 -00:00:01）', () => {
        expect(srtStamp(-5)).toBe('00:00:00,000');
        expect(srtStamp(Number.NaN)).toBe('00:00:00,000');
    });

    it('SRT 每条三行、序号从 1 开始、末尾留空行', () => {
        const srt = entriesToSrt([
            { text: 'Hello.', start: 0, end: 1.5 },
            { text: 'World.', start: 2, end: 3 },
        ]);
        const lines = srt.split('\n');
        expect(lines[0]).toBe('1');
        expect(lines[1]).toBe('00:00:00,000 --> 00:00:01,500');
        expect(lines[2]).toBe('Hello.');
        expect(srt.endsWith('\n')).toBe(true);
        expect(srt).toContain('2\n00:00:02,000 --> 00:00:03,000\nWorld.');
    });

    it('空条目 ⇒ 空串（调用方据此判「什么都没识别到」）', () => {
        expect(entriesToSrt([])).toBe('');
    });
});

describe('pure/senseVoice planSegments', () => {
    it('按段长切片、末段按总长夹住', () => {
        expect(planSegments(250, 120)).toEqual([
            { start: 0, end: 120 },
            { start: 120, end: 240 },
            { start: 240, end: 250 },
        ]);
    });

    it('总长小于一段 ⇒ 单片', () => {
        expect(planSegments(30, 120)).toEqual([{ start: 0, end: 30 }]);
    });

    it('总长未知 ⇒ 返回一片（让调用方退回整段 wav）', () => {
        expect(planSegments(0, 120)).toEqual([{ start: 0, end: 0 }]);
        expect(planSegments(Number.NaN, 120)).toEqual([{ start: 0, end: 0 }]);
    });

    it('片长非法时回落默认段长', () => {
        expect(planSegments(250, 0)).toHaveLength(3);
    });

    it('切出来的片无缝衔接、不重叠', () => {
        const p = planSegments(500, 120);
        for (let i = 1; i < p.length; i++) expect(p[i].start).toBe(p[i - 1].end);
    });
});
