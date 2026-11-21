import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
    WORD_SPAN_MAX,
    estimateWordSpans,
    isCjkChar,
    joinSpansWithSource,
    parseAssKaraokeWords,
    parseVttInlineWords,
    spanTextsWithSource,
    splitTimingUnits,
    timingWeight,
    wordSpansFor,
    type WordSpan,
} from 'pure/wordTiming';
import { parseAssCues, parseCues } from 'pure/subtitleCues';

/** 剥掉 JS 注释（`.ts` 源用；⚠️ Svelte 模板不能用这个，`accept="image/*"` 会被当块注释开头） */
function stripTsComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 浮点比较：时间戳连乘后必然有尾差，别用 toBe */
function near(actual: number, expected: number, tol = 1e-6): void {
    expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

describe('isCjkChar / splitTimingUnits', () => {
    it('CJK 逐字判定，拉丁不是', () => {
        expect(isCjkChar('好')).toBe(true);
        expect(isCjkChar('あ')).toBe(true);
        expect(isCjkChar('한')).toBe(true);
        expect(isCjkChar('a')).toBe(false);
        expect(isCjkChar('1')).toBe(false);
        expect(isCjkChar('')).toBe(false);
    });

    it('CJK 一字一单位、拉丁按空白成词', () => {
        expect(splitTimingUnits('今天天气好')).toEqual(['今', '天', '天', '气', '好']);
        expect(splitTimingUnits('hello world')).toEqual(['hello', 'world']);
        expect(splitTimingUnits('  多  空白  ')).toEqual(['多', '空', '白']);
    });

    it('标点并进前一个单位，不单独占一拍', () => {
        // 「好」后面的句号不该自己分到一份时长
        expect(splitTimingUnits('好。')).toEqual(['好。']);
        expect(splitTimingUnits('word, next')).toEqual(['word,', 'next']);
        // 行首标点（破折号）自成单位，不能丢
        expect(splitTimingUnits('— 开场')).toEqual(['—', '开', '场']);
    });

    it('换行只起分词作用，不进单位', () => {
        expect(splitTimingUnits('第一行\n第二行')).toEqual(['第', '一', '行', '第', '二', '行']);
    });

    it('空输入返回空数组', () => {
        expect(splitTimingUnits('')).toEqual([]);
        expect(splitTimingUnits('   ')).toEqual([]);
        expect(splitTimingUnits(undefined as unknown as string)).toEqual([]);
    });
});

describe('timingWeight', () => {
    it('CJK 每字 1，拉丁每字符 0.5', () => {
        near(timingWeight('好'), 1);
        near(timingWeight('你好'), 2);
        near(timingWeight('hi'), 1);
        near(timingWeight('the'), 1.5);
    });

    it('长词按字符线性增长（20 字母 = 10，是 3 字母的 6.67 倍）', () => {
        expect(timingWeight('internationalization') / timingWeight('the')).toBeCloseTo(20 / 3, 5);
    });

    it('中英混排两种单价相加', () => {
        // 「你好」= 2，「ok」= 1 ⇒ 3
        near(timingWeight('你好ok'), 3);
    });

    it('空串权重 0', () => {
        expect(timingWeight('')).toBe(0);
    });
});

describe('estimateWordSpans', () => {
    it('片段首尾相接、覆盖整段时长', () => {
        const spans = estimateWordSpans('hello world', 10, 12);
        expect(spans.length).toBe(2);
        near(spans[0]?.start ?? NaN, 10);
        near(spans[0]?.end ?? NaN, spans[1]?.start ?? NaN);
        near(spans[1]?.end ?? NaN, 12);
    });

    it('末位精确对齐到行尾，不留浮点尾差', () => {
        const spans = estimateWordSpans('一二三四五六七', 0, 1);
        expect(spans.length).toBe(7);
        // 7 分 1 秒是循环小数，最后一片必须严格等于 1
        expect(spans[spans.length - 1]?.end).toBe(1);
    });

    it('按权重分配而非平均分：长词拿到更长时间', () => {
        const spans = estimateWordSpans('a internationalization', 0, 10);
        const first = spans[0];
        const second = spans[1];
        expect((second?.end ?? 0) - (second?.start ?? 0)).toBeGreaterThan((first?.end ?? 0) - (first?.start ?? 0));
    });

    it('时长无效 / 为零 / 倒挂 ⇒ 空数组（不拆）', () => {
        expect(estimateWordSpans('abc def', 5, 5)).toEqual([]);
        expect(estimateWordSpans('abc def', 5, 3)).toEqual([]);
        expect(estimateWordSpans('abc def', NaN, 3)).toEqual([]);
        expect(estimateWordSpans('abc def', 0, NaN)).toEqual([]);
    });

    it('空文本 ⇒ 空数组', () => {
        expect(estimateWordSpans('', 0, 5)).toEqual([]);
        expect(estimateWordSpans('   ', 0, 5)).toEqual([]);
    });

    it('单位数超过 WORD_SPAN_MAX ⇒ 整行退回不拆', () => {
        const long = '字'.repeat(WORD_SPAN_MAX + 1);
        expect(estimateWordSpans(long, 0, 10)).toEqual([]);
        // 正好等于上限仍可拆
        expect(estimateWordSpans('字'.repeat(WORD_SPAN_MAX), 0, 10).length).toBe(WORD_SPAN_MAX);
    });
});

describe('parseVttInlineWords', () => {
    it('行内戳标出每个词的起点，末段结束 = cue 末尾', () => {
        const raw = '<00:00:01.000>hello <00:00:02.000>world';
        const spans = parseVttInlineWords(raw, 1, 4);
        expect(spans).not.toBeNull();
        expect(spans?.map((s: WordSpan) => s.text)).toEqual(['hello', 'world']);
        near(spans?.[0]?.start ?? NaN, 1);
        near(spans?.[1]?.start ?? NaN, 2);
        near(spans?.[1]?.end ?? NaN, 4);
    });

    it('没有内联戳 ⇒ null（交给估算兜底）', () => {
        expect(parseVttInlineWords('just plain text', 0, 3)).toBeNull();
        // 有尖括号但里面不是时间戳（如 <i>）也返回 null
        expect(parseVttInlineWords('<i>斜体</i>', 0, 3)).toBeNull();
    });

    it('剥掉非时间类标签，只留文字', () => {
        const raw = '<00:00:01.000><i>hello</i> <00:00:02.000><b>world</b>';
        const spans = parseVttInlineWords(raw, 1, 4);
        expect(spans?.map((s) => s.text)).toEqual(['hello', 'world']);
    });

    it('戳之前的文字不单独成片；若戳后面没内容 ⇒ null', () => {
        // 内联戳的语义是「标记它**后面**那段文字的起点」⇒ 戳前的 'hello' 不属于任何片，
        // 这里只剩一个空尾巴 ⇒ 判定拆不出内容，返回 null 交给估算兜底（不会丢字）
        expect(parseVttInlineWords('hello<00:00:02.000>', 1, 4)).toBeNull();
        expect(parseVttInlineWords('<00:00:01.000>', 1, 4)).toBeNull();
    });

    it('片段数超过上限 ⇒ null', () => {
        const many = Array.from({ length: WORD_SPAN_MAX + 2 }, (_, i) => `<00:00:0${(i % 9) + 1}.000>w`).join(' ');
        expect(parseVttInlineWords(many, 0, 10)).toBeNull();
    });
});

describe('parseAssKaraokeWords', () => {
    it('{\\k} 的数字是厘秒，从 cue 起点累加', () => {
        const raw = '{\\k50}你{\\k50}好';
        const spans = parseAssKaraokeWords(raw, 10, 20);
        expect(spans?.map((s) => s.text)).toEqual(['你', '好']);
        near(spans?.[0]?.start ?? NaN, 10);
        near(spans?.[0]?.end ?? NaN, 10.5);
        near(spans?.[1]?.start ?? NaN, 10.5);
        near(spans?.[1]?.end ?? NaN, 11);
    });

    it('没有卡拉 OK 标签 ⇒ null', () => {
        expect(parseAssKaraokeWords('{\\an8}普通字幕', 0, 3)).toBeNull();
        expect(parseAssKaraokeWords('普通字幕', 0, 3)).toBeNull();
    });

    it('`{\\k}` 无数字时退化为估算且不越过 cue 末尾', () => {
        const spans = parseAssKaraokeWords('{\\k}你好', 5, 6);
        expect(spans).not.toBeNull();
        near(spans?.[0]?.start ?? NaN, 5);
        // 估算铺满到 6，不应超出
        expect((spans?.[spans.length - 1]?.end ?? 0) <= 6 + 1e-6).toBe(true);
    });

    it('其他覆盖标签（{\\pos} / {\\c}）不影响卡拉 OK 累加', () => {
        const raw = '{\\pos(1,2)} {\\k100}你好';
        const spans = parseAssKaraokeWords(raw, 0, 5);
        expect(spans?.map((s) => s.text)).toEqual(['你', '好']);
        near(spans?.[1]?.end ?? NaN, 1);
    });
});

describe('wordSpansFor', () => {
    it('有真词级就用真词级，不覆盖', () => {
        const real: WordSpan[] = [{ text: 'x', start: 1, end: 2 }];
        expect(wordSpansFor('whatever text', 0, 10, real)).toEqual(real);
    });

    it('没有真词级 ⇒ 估算', () => {
        const spans = wordSpansFor('hello world', 0, 2);
        expect(spans.length).toBe(2);
    });

    it('真词级为空数组时也回退估算（不是返回空）', () => {
        const spans = wordSpansFor('hello world', 0, 2, []);
        expect(spans.length).toBe(2);
    });

    it('返回新数组（浅拷贝）：增删元素不污染入参数组本身', () => {
        const real: WordSpan[] = [
            { text: 'x', start: 1, end: 2 },
            { text: 'y', start: 2, end: 3 },
        ];
        const got = wordSpansFor('t', 0, 1, real);
        got.push({ text: 'z', start: 3, end: 4 });
        got.shift();
        expect(real.length).toBe(2);
        expect(real[0]?.text).toBe('x');
    });
});

describe('spanTextsWithSource / joinSpansWithSource（🔴 2026-11-21 用户报障：学习模式高亮行空格全消失）', () => {
    // 真因：`splitTimingUnits` 把空白当分词边界**直接丢掉** ⇒ `['hello','world']` 里没有空格，
    // 视图层只塞 `w.text` 就会拼成 `helloworld`。这组用例把「拆完必须能拼回原文」钉死。
    it('英文多词：拼回去与原文逐字一致（不是 helloworld）', () => {
        const text = 'hello world again';
        const spans = estimateWordSpans(text, 0, 3);
        expect(spans.map((s) => s.text)).toEqual(['hello', 'world', 'again']);
        expect(joinSpansWithSource(text, spans)).toBe(text);
        // 空格必须挂在「前一段尾」：首段不带前导空白，末段带着行尾之外的空隙
        expect(spanTextsWithSource(text, spans)).toEqual(['hello ', 'world ', 'again']);
    });

    it('中文混排英文：中文字之间不凭空插空格', () => {
        const text = '今天我们学 hello world 这个词';
        const spans = estimateWordSpans(text, 0, 5);
        expect(joinSpansWithSource(text, spans)).toBe(text);
    });

    it('连续多个空格原样保留', () => {
        const text = 'a   b  c';
        const spans = estimateWordSpans(text, 0, 4);
        expect(joinSpansWithSource(text, spans)).toBe(text);
    });

    it('行尾空格不能丢', () => {
        const text = 'hello world   ';
        const spans = estimateWordSpans(text, 0, 3);
        expect(joinSpansWithSource(text, spans)).toBe(text);
    });

    it('行首缩进并进首个片段，不单独成段', () => {
        const text = '   hello world';
        const spans = estimateWordSpans(text, 0, 3);
        const pieces = spanTextsWithSource(text, spans);
        expect(pieces.join('')).toBe(text);
        expect(pieces.length).toBe(spans.length);
        expect(pieces[0]).toBe('   hello ');
    });

    it('片段与原文对不上（真词级被 trim 过）也不丢原文尾巴', () => {
        // 模拟 ASS 卡拉 OK 里片段文本被规范化过、与 cue.text 不完全对得上的情形
        const text = 'hello world';
        const pieces = spanTextsWithSource(text, [{ text: 'hello' }, { text: 'WORLD' }]);
        expect(pieces.join('')).toBe('hello worldWORLD');
    });

    it('空片段数组 ⇒ 空结果 / join 原样返回', () => {
        expect(spanTextsWithSource('abc', [])).toEqual([]);
        expect(joinSpansWithSource('abc', [])).toBe('abc');
        expect(joinSpansWithSource('', [])).toBe('');
    });

    it('脏输入不抛', () => {
        expect(() => spanTextsWithSource(undefined as unknown as string, [{ text: 'a' }])).not.toThrow();
        expect(() => joinSpansWithSource('x', [undefined as unknown as { text: string }])).not.toThrow();
    });

    it('🔴 反向守卫：view 层不许再只塞 w.text（否则空格又掉）', () => {
        const src = readFileSync('src/views/EpisodePageView.ts', 'utf8');
        const code = stripTsComments(src);
        // 必须用 spanTextsWithSource，且不能出现 `span.textContent = w.text`
        expect(code).toContain('spanTextsWithSource');
        expect(code).not.toMatch(/span\.textContent\s*=\s*w\.text/);
    });
});

describe('解析器接线（Cue.words 只在真词级时出现）', () => {
    it('VTT 带内联戳 ⇒ cue.words 有值', () => {
        const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', '<00:00:01.000>hello <00:00:02.000>world'].join('\n');
        const cues = parseCues(vtt);
        expect(cues.length).toBe(1);
        expect(cues[0]?.words?.map((w) => w.text)).toEqual(['hello', 'world']);
        // text 仍是剥干净的纯文本
        expect(cues[0]?.text).toBe('hello world');
    });

    it('普通 VTT（无内联戳）⇒ cue.words 为 undefined', () => {
        const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:04.000', 'hello world'].join('\n');
        const cues = parseCues(vtt);
        expect(cues[0]?.words).toBeUndefined();
    });

    it('ASS 带 {\\k} ⇒ cue.words 有值，且 text 已剥标签', () => {
        const ass = [
            '[Script Info]',
            'Title: t',
            '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\k50}你{\\k50}好',
        ].join('\n');
        const cues = parseAssCues(ass);
        expect(cues.length).toBe(1);
        expect(cues[0]?.text).toBe('你好');
        expect(cues[0]?.words?.map((w) => w.text)).toEqual(['你', '好']);
    });

    it('普通 ASS（无 {\\k}）⇒ cue.words 为 undefined', () => {
        const ass = [
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}普通字幕',
        ].join('\n');
        const cues = parseAssCues(ass);
        expect(cues[0]?.text).toBe('普通字幕');
        expect(cues[0]?.words).toBeUndefined();
    });
});
