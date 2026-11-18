/**
 * Confucius4（llama.cpp `llama-mtmd-cli`）的输出解析与时间轴反推。
 *
 * 样例是真机原样抄下来的：
 *   stdout 只有一行：`language English<asr_text>Good morning. This is a test …`
 *   ⚠️ 退出码不可信（实测成功也返回非 0），判据只能是「有没有 `<asr_text>`」。
 */
import { describe, expect, it } from 'vitest';

import {
    LLAMA_ASR_PROMPT,
    LLAMA_MAX_TOKENS,
    buildLlamaArgs,
    llamaLangCode,
    parseLlamaAsrOutput,
    textToSegments,
} from 'pure/llamaAsr';

describe('parseLlamaAsrOutput', () => {
    it('认出真机那一行', () => {
        const stdout =
            'language English<asr_text>Good morning. This is a test of the local speech recognition. Thank you for your patience.';
        expect(parseLlamaAsrOutput(stdout)).toEqual({
            lang: 'English',
            text: 'Good morning. This is a test of the local speech recognition. Thank you for your patience.',
        });
    });

    it('中文输出同样按标记切', () => {
        const out = parseLlamaAsrOutput('language Chinese<asr_text>早上好，这是一个测试。');
        expect(out).toEqual({ lang: 'Chinese', text: '早上好，这是一个测试。' });
    });

    it('正文里的换行/多余空白被合并成单空格', () => {
        const out = parseLlamaAsrOutput('language English<asr_text>  a\n\nb   c ');
        expect(out?.text).toBe('a b c');
    });

    it('⛔ 没有标记就返回 null（别拿退出码当判据）', () => {
        expect(parseLlamaAsrOutput('loading model …')).toBeNull();
        expect(parseLlamaAsrOutput('')).toBeNull();
        expect(parseLlamaAsrOutput('   ')).toBeNull();
        expect(parseLlamaAsrOutput(null as unknown as string)).toBeNull();
    });

    it('⛔ 标记后正文为空也返回 null', () => {
        expect(parseLlamaAsrOutput('language English<asr_text>   ')).toBeNull();
    });

    it('标记前没有 language 行时 lang 回空串（不瞎猜）', () => {
        expect(parseLlamaAsrOutput('<asr_text>hello')).toEqual({ lang: '', text: 'hello' });
    });

    it('标记前混有日志行也能扫到（容错而非只看第一行）', () => {
        const out = parseLlamaAsrOutput('llama_model_loader: ok\nlanguage English<asr_text>hi');
        expect(out).toEqual({ lang: 'English', text: 'hi' });
    });
});

describe('llamaLangCode', () => {
    it('英文各种写法都归 en（只认 engl* 与精确 en，`Eng` 这种缩写故意不认）', () => {
        for (const v of ['English', 'english', 'ENGLISH', 'en']) expect(llamaLangCode(v)).toBe('en');
        expect(llamaLangCode('Eng')).toBe('');
    });

    it('中文各种写法都归 zh', () => {
        for (const v of ['Chinese', 'chinese', 'Mandarin', 'zh', 'Chin']) expect(llamaLangCode(v)).toBe('zh');
    });

    it('日语 / 韩语 / 粤语', () => {
        expect(llamaLangCode('Japanese')).toBe('ja');
        expect(llamaLangCode('ja')).toBe('ja');
        expect(llamaLangCode('Korean')).toBe('ko');
        expect(llamaLangCode('Cantonese')).toBe('yue');
        expect(llamaLangCode('yue')).toBe('yue');
    });

    it('⛔ 认不出回空串，不是 auto（空串=模型没说，调用方保留用户原选择）', () => {
        expect(llamaLangCode('Klingon')).toBe('');
        expect(llamaLangCode('')).toBe('');
        expect(llamaLangCode(null as unknown as string)).toBe('');
    });
});

describe('buildLlamaArgs', () => {
    const base = { model: 'C:/m/Q4.gguf', mmproj: 'C:/m/mmproj.gguf', wav: 'C:/a.wav' };

    it('默认参数顺序与真机一致（-m/--mmproj 都必填）', () => {
        expect(buildLlamaArgs(base)).toEqual([
            '-m',
            'C:/m/Q4.gguf',
            '--mmproj',
            'C:/m/mmproj.gguf',
            '--audio',
            'C:/a.wav',
            '-p',
            LLAMA_ASR_PROMPT,
            '-n',
            String(LLAMA_MAX_TOKENS),
            '--no-mmproj-offload',
            '--no-warmup',
        ]);
    });

    it('⛔ --no-mmproj-offload 与 --no-warmup 必须始终在（CPU 版不给会走报错路径）', () => {
        const args = buildLlamaArgs(base);
        expect(args).toContain('--no-mmproj-offload');
        expect(args).toContain('--no-warmup');
    });

    it('⛔ -n 给不足会截断（实测 32/64 只出一句半），下限 64', () => {
        expect(buildLlamaArgs({ ...base, maxTokens: 32 })).toContain('64');
        expect(buildLlamaArgs({ ...base, maxTokens: 0 })).toContain('64');
        expect(buildLlamaArgs({ ...base, maxTokens: 256 })).toContain('256');
    });

    it('threads > 0 才追加 -t', () => {
        expect(buildLlamaArgs({ ...base, threads: 4 })).toContain('-t');
        expect(buildLlamaArgs({ ...base, threads: 0 })).not.toContain('-t');
        expect(buildLlamaArgs({ ...base, threads: NaN })).not.toContain('-t');
    });

    it('自定义提示词会覆盖默认值', () => {
        const args = buildLlamaArgs({ ...base, prompt: '请转录' });
        expect(args).toContain('请转录');
        expect(args).not.toContain(LLAMA_ASR_PROMPT);
    });

    it('路径两端空白被裁掉', () => {
        const args = buildLlamaArgs({ model: ' m.gguf ', mmproj: ' p.gguf ', wav: ' a.wav ' });
        expect(args).toContain('m.gguf');
        expect(args).toContain('p.gguf');
        expect(args).toContain('a.wav');
    });
});

describe('textToSegments', () => {
    it('短文本一条，时间从 0 开始到总时长', () => {
        const out = textToSegments('Hello.', 5);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ start: 0, end: 5, text: 'Hello.' });
    });

    it('多句按加权长度分时间，末条吃掉舍入误差收在总时长上', () => {
        // maxChars 压到 12 才能切出多条：默认 56 会让这两句并成一条（并成一条也是对的）
        const out = textToSegments('One two. Three four five six seven.', 10, 12);
        expect(out.length).toBeGreaterThan(1);
        expect(out[0].start).toBe(0);
        expect(out[out.length - 1].end).toBeCloseTo(10, 5);
        for (let i = 1; i < out.length; i++) expect(out[i].start).toBeCloseTo(out[i - 1].end, 5);
    });

    it('默认上限 56 下短句并成一条（不是每句一条）', () => {
        const out = textToSegments('One two. Three four five six seven.', 10);
        expect(out).toHaveLength(1);
    });

    it('⛔ 中文按 2 计权：中英混排时长比例不能被 .length 带偏', () => {
        // 5 个汉字（权重 10） vs 10 个字母（权重 10）⇒ 时间应大致对半
        const out = textToSegments('你好世界啊。 abcdefghij.', 10, 12);
        expect(out.length).toBeGreaterThanOrEqual(2);
        const zh = out.find((s) => s.text.includes('你好'));
        expect(zh).toBeDefined();
        const zhSpan = (zh as { end: number; start: number }).end - (zh as { end: number; start: number }).start;
        expect(zhSpan).toBeGreaterThan(2);
    });

    it('⛔ totalSec 无效时全部挂 0（调用方据此判「时间轴不可用」）', () => {
        for (const total of [0, -1, NaN, null]) {
            const out = textToSegments('Hello. World.', total as number | null);
            expect(out.length).toBeGreaterThan(0);
            for (const s of out) expect([s.start, s.end]).toEqual([0, 0]);
        }
    });

    it('空文本返回空数组', () => {
        expect(textToSegments('', 10)).toEqual([]);
        expect(textToSegments('   ', 10)).toEqual([]);
        expect(textToSegments(null as unknown as string, 10)).toEqual([]);
    });

    it('极短总时长也不会产出倒挂段（最短 0.6 秒兜底）', () => {
        const out = textToSegments('A. B. C.', 0.5);
        for (const s of out) expect(s.end).toBeGreaterThanOrEqual(s.start);
    });

    it('单句超长时按词切，⛔ 不把英文单词拦腰截断', () => {
        const out = textToSegments('aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll', 10, 12);
        expect(out.length).toBeGreaterThan(1);
        for (const s of out) {
            for (const w of s.text.split(/\s+/)) {
                expect(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh', 'iii', 'jjj', 'kkk', 'lll']).toContain(w);
            }
        }
    });

    it('纯中文长句（无空格）也能切，不会返回一条超长', () => {
        const long = '这是一个没有空格的中文长句子用来测试切分逻辑是否正常工作不会一条塞满'.repeat(2);
        const out = textToSegments(long, 10, 12);
        expect(out.length).toBeGreaterThan(1);
    });
});
