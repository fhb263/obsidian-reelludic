import { describe, expect, it } from 'vitest';
import {
    activeCueIndex,
    appendTranscribeLine,
    CUE_EMPTY_HINT,
    CUE_LOADING_HINT,
    cueLangOptions,
    formatStamp,
    LOCK_LINE_INDEX,
    lockLineFor,
    lockScrollTop,
    panelStateOf,
    parseAssCues,
    parseCues,
    parseSubtitleText,
    TRANSCRIBE_MAX_LINES,
    transcribeHeadline,
    type Cue,
    type TranscribeLine,
} from 'pure/subtitleCues';

const VTT = `WEBVTT

NOTE 注释块不算 cue

1
00:00:01.000 --> 00:00:03.500
第一句

00:00:04.000 --> 00:00:06.000 align:start position:10%
第二句
换行保留

00:00:07.000 --> 00:00:09.000
<i>第三句</i> &amp; 实体
`;

const SRT = `1
00:00:01,000 --> 00:00:03,500
第一句

2
00:01:04,250 --> 00:01:06,000
带小时第二句
`;

const ASS = `[Script Info]
Title: t

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}第一句
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,第二句\\N换行
Dialogue: 0,0:01:04.25,0:01:06.00,Default,,0,0,0,,带小时第三句
`;

function cue(start: number, text: string): Cue {
    return { start, end: start + 1, text };
}

describe('formatStamp（行首时间戳）', () => {
    it('不足一小时省掉小时位，分钟/秒补两位', () => {
        expect(formatStamp(0)).toBe('00:00');
        expect(formatStamp(5)).toBe('00:05');
        expect(formatStamp(65)).toBe('01:05');
        expect(formatStamp(599)).toBe('09:59');
    });

    it('超过一小时带上小时位（不丢进位）', () => {
        expect(formatStamp(3600)).toBe('1:00:00');
        expect(formatStamp(3661)).toBe('1:01:01');
    });

    it('🔴 脏输入不崩：负数 / NaN / 小数一律向下取整并夹到 0', () => {
        expect(formatStamp(-5)).toBe('00:00');
        expect(formatStamp(Number.NaN)).toBe('00:00');
        expect(formatStamp(Number.POSITIVE_INFINITY)).toBe('00:00');
        expect(formatStamp(9.99)).toBe('00:09');
    });
});

describe('parseCues（VTT / SRT 同一入口）', () => {
    it('VTT：跳过 NOTE / 序号行 / 空块，按起始时间升序', () => {
        const cues = parseCues(VTT);
        expect(cues.map((c) => c.text)).toEqual(['第一句', '第二句\n换行保留', '第三句 & 实体']);
        expect(cues.map((c) => c.start)).toEqual([1, 4, 7]);
        expect(cues.map((c) => c.end)).toEqual([3.5, 6, 9]);
    });

    it('SRT（逗号毫秒 / 序号行）也能解，且与 VTT 口径一致', () => {
        const cues = parseCues(SRT);
        expect(cues.map((c) => c.text)).toEqual(['第一句', '带小时第二句']);
        expect(cues[1].start).toBeCloseTo(64.25, 5);
    });

    it('🔴 cue 设置（`align:start position:10%`）不污染结束时间', () => {
        expect(parseCues(VTT)[1].end).toBe(6);
    });

    it('空输入 / 只有头 ⇒ 空数组（⛔ 不返回 undefined）', () => {
        expect(parseCues('')).toEqual([]);
        expect(parseCues('WEBVTT\n\n')).toEqual([]);
        expect(parseCues(undefined as unknown as string)).toEqual([]);
    });

    it('乱序块按 start 重排（笔记/工具导出的顺序不可信）', () => {
        const cues = parseCues('WEBVTT\n\n00:00:09.000 --> 00:00:10.000\n后\n\n00:00:01.000 --> 00:00:02.000\n前\n');
        expect(cues.map((c) => c.text)).toEqual(['前', '后']);
    });
});

describe('parseAssCues（导入 .ass 只取纯文本）', () => {
    it('剥掉样式覆盖标签，\\N 还原成换行', () => {
        const cues = parseAssCues(ASS);
        expect(cues.map((c) => c.text)).toEqual(['第一句', '第二句\n换行', '带小时第三句']);
        expect(cues.map((c) => c.start)).toEqual([1, 4, 64.25]);
    });

    it('🔴 列序跟随 `Format:` 行，不假设固定位置', () => {
        const swapped = `[Events]
Format: Start, End, Text, Style
Dialogue: 0:00:02.00,0:00:04.00,内容,Default
`;
        const cues = parseAssCues(swapped);
        expect(cues).toHaveLength(1);
        expect(cues[0].start).toBe(2);
        expect(cues[0].text).toBe('内容');
    });

    it('文本列含逗号时整体保留（只按前 n-1 列切）', () => {
        const withComma = `[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,你好，世界
`;
        expect(parseAssCues(withComma)[0].text).toBe('你好，世界');
    });

    it('非 [Events] 段 / 空输入 ⇒ 空数组', () => {
        expect(parseAssCues('[Script Info]\nTitle: x\n')).toEqual([]);
        expect(parseAssCues('')).toEqual([]);
    });
});

describe('parseSubtitleText（按扩展名分派）', () => {
    it('.ass / .ssa 走 ASS 解析器，其余走 VTT/SRT', () => {
        expect(parseSubtitleText(ASS, 'a.chs.ass')).toHaveLength(3);
        expect(parseSubtitleText(ASS, 'a.chs.SSA')).toHaveLength(3);
        expect(parseSubtitleText(VTT, 'a.chs.vtt')).toHaveLength(3);
        expect(parseSubtitleText(SRT, 'a.srt')).toHaveLength(2);
    });
});

describe('activeCueIndex（当前播放行）', () => {
    const cues = [cue(0, 'a'), cue(5, 'b'), cue(10, 'c')];

    it('取 start 不超过当前位置里最大的那条', () => {
        expect(activeCueIndex(cues, 0)).toBe(0);
        expect(activeCueIndex(cues, 4.5)).toBe(0);
        expect(activeCueIndex(cues, 5)).toBe(1);
        expect(activeCueIndex(cues, 12)).toBe(2);
    });

    it('🔴 容差口径与 `videoDrawer.activeMarkIndex` 一致：快到位时提前点亮，避免「慢半拍」', () => {
        // tol=0.35 ⇒ 4.9 已经在 5.0 那条的提前量内，应当切到下一条
        expect(activeCueIndex(cues, 4.9)).toBe(1);
        expect(activeCueIndex(cues, 4.6)).toBe(0);
    });

    it('第一条字幕之前 ⇒ -1（还没进字幕，不该高亮任何行）', () => {
        expect(activeCueIndex(cues, -1)).toBe(-1);
    });

    it('🔴 与输入顺序无关（取最大 start，不是「最后一个满足的」）', () => {
        const shuffled = [cue(10, 'c'), cue(0, 'a'), cue(5, 'b')];
        expect(activeCueIndex(shuffled, 12)).toBe(0);
        expect(activeCueIndex(shuffled, 6)).toBe(2);
    });

    it('空列表 / 非数字 ⇒ -1', () => {
        expect(activeCueIndex([], 5)).toBe(-1);
        expect(activeCueIndex(cues, Number.NaN)).toBe(-1);
    });

    it('tol 让「正好落在起始时刻」也能点亮（timeupdate 粒度）', () => {
        expect(activeCueIndex(cues, 4.8, 0.35)).toBe(1);
        expect(activeCueIndex(cues, 4.8, 0)).toBe(0);
    });
});

describe('lockScrollTop（锁定提词器滚动量）', () => {
    // 行高 20，5 行，容器可视高 60 ⇒ maxScroll = 100 - 60 = 40
    const tops = [0, 20, 40, 60, 80];
    const maxScroll = 40;

    it('🔴 锁定位置默认第二行，当前行落在该位置', () => {
        expect(LOCK_LINE_INDEX).toBe(1);
        expect(lockScrollTop(tops, 20, 2, LOCK_LINE_INDEX, maxScroll)).toBe(40 - 20);
        expect(lockScrollTop(tops, 20, 3, LOCK_LINE_INDEX, maxScroll)).toBe(60 - 20);
    });

    it('夹在 [0, maxScroll]：顶部行不产生负滚动、底部行不越界', () => {
        expect(lockScrollTop(tops, 20, 0, LOCK_LINE_INDEX, maxScroll)).toBe(0);
        expect(lockScrollTop(tops, 20, 4, LOCK_LINE_INDEX, maxScroll)).toBe(maxScroll);
    });

    it('idx 越界 / 量不到高度 ⇒ 0（⛔ 不把列表拽飞）', () => {
        expect(lockScrollTop(tops, 20, -1, 1, maxScroll)).toBe(0);
        expect(lockScrollTop(tops, 20, 9, 1, maxScroll)).toBe(0);
        expect(lockScrollTop(tops, 0, 1, 1, maxScroll)).toBe(0);
        expect(lockScrollTop([], 20, 0, 1, maxScroll)).toBe(0);
    });
});

describe('lockLineFor（锁定位置 = 可视区中位行）', () => {
    // 用户 2026-11-09：「锁定时间轴应该在一屏显示中位固定，而不是在第二行」
    it('可视 200 / 行高 20 ⇒ 第 4 行（0 基）', () => {
        // 中位行 = floor((viewH/2 - rowH/2) / rowH) = floor((100 - 10) / 20) = floor(4.5) = 4
        expect(lockLineFor(200, 20)).toBe(4);
    });

    it('可视 60 / 行高 20 ⇒ 第 1 行（与旧的固定第二行巧合一致）', () => {
        expect(lockLineFor(60, 20)).toBe(1);
    });

    it('可视 400 / 行高 20 ⇒ 第 9 行，越矮越靠上', () => {
        expect(lockLineFor(400, 20)).toBe(9);
        expect(lockLineFor(400, 20)).toBeGreaterThan(lockLineFor(200, 20));
    });

    it('量不到尺寸 ⇒ 退回 LOCK_LINE_INDEX（⛔ 不硬算）', () => {
        expect(lockLineFor(0, 20)).toBe(LOCK_LINE_INDEX);
        expect(lockLineFor(200, 0)).toBe(LOCK_LINE_INDEX);
        expect(lockLineFor(NaN, 20)).toBe(LOCK_LINE_INDEX);
        expect(lockLineFor(200, NaN)).toBe(LOCK_LINE_INDEX);
    });

    it('永不返回负数（容器比一行还矮）', () => {
        expect(lockLineFor(10, 20)).toBe(0);
    });
});

describe('panelStateOf / cueLangOptions / 文案', () => {
    it('显示态：解析中优先 loading，其次看有没有 cue', () => {
        expect(panelStateOf(true, 0)).toBe('loading');
        expect(panelStateOf(true, 3)).toBe('loading');
        expect(panelStateOf(false, 0)).toBe('empty');
        expect(panelStateOf(false, 2)).toBe('ready');
    });

    it('语言项：标注选中，label 缺失时退回文件名', () => {
        const opts = cueLangOptions(
            [
                { fileName: 'a.chs.srt', label: '简体' },
                { fileName: 'a.eng.srt', label: '' },
            ],
            'a.chs.srt',
        );
        expect(opts.map((o) => o.active)).toEqual([true, false]);
        expect(opts[1].label).toBe('a.eng.srt');
    });

    it('没有挂载项时谁都不选中', () => {
        expect(cueLangOptions([{ fileName: 'a.srt', label: '中文' }], null)[0].active).toBe(false);
    });

    it('两句文案都在（空态要给导入指引，加载态要轻量反馈）', () => {
        expect(CUE_EMPTY_HINT).toContain('导入');
        expect(CUE_LOADING_HINT).toContain('时间轴');
    });
});

/**
 * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
 *
 * 这一组钉的是「转写中」这一态的存在性与优先级 —— 它是空态与成片列表之间的
 * 第三条路，任何一条断言松掉，用户看到的就会退回「还没有字幕」。
 */
describe('panelStateOf · 转写中（m11612）', () => {
    it('转写中压过 loading，也与 empty 无关', () => {
        expect(panelStateOf(false, 0, true)).toBe('transcribing');
        expect(panelStateOf(true, 0, true)).toBe('transcribing');
        // 已经解析出字的字幕在转写期间仍显示成 phrase？⛔ 不是：转写态就是要看草稿
        expect(panelStateOf(false, 5, true)).toBe('transcribing');
    });

    it('不转写时行为与旧版完全一致（向后兼容）', () => {
        expect(panelStateOf(false, 0, false)).toBe('empty');
        expect(panelStateOf(true, 0, false)).toBe('loading');
        expect(panelStateOf(false, 1, false)).toBe('ready');
        // 第三参缺省 = 不转写
        expect(panelStateOf(false, 0)).toBe('empty');
        expect(panelStateOf(false, 1)).toBe('ready');
    });
});

describe('appendTranscribeLine（实时流追加规则）', () => {
    const line = (start: number, end: number, text: string): TranscribeLine => ({ start, end, text });

    it('按开始时间稳定排序（引擎按段回调，段内句子仍可能乱序）', () => {
        let acc: TranscribeLine[] = [];
        acc = appendTranscribeLine(acc, line(6, 9, 'C'));
        acc = appendTranscribeLine(acc, line(0, 3, 'A'));
        acc = appendTranscribeLine(acc, line(3, 6, 'B'));
        expect(acc.map((l) => l.text)).toEqual(['A', 'B', 'C']);
    });

    it('同一时间轴重复上报只留最新那条（引擎改句子 / 重发）', () => {
        let acc: TranscribeLine[] = [];
        acc = appendTranscribeLine(acc, line(0, 3, '旧'));
        acc = appendTranscribeLine(acc, line(0, 3, '新'));
        expect(acc).toHaveLength(1);
        expect(acc[0].text).toBe('新');
    });

    it('丢掉空正文与非法时间轴（⛔ 别把半成品画到界面上）', () => {
        let acc: TranscribeLine[] = [];
        acc = appendTranscribeLine(acc, line(0, 3, '   '));
        acc = appendTranscribeLine(acc, line(3, 3, '零长'));
        acc = appendTranscribeLine(acc, line(5, 4, '倒挂'));
        acc = appendTranscribeLine(acc, line(Number.NaN, 4, 'NaN'));
        expect(acc).toEqual([]);
    });

    it('超过上限只留最后若干句（一小时片子能出上千句）', () => {
        let acc: TranscribeLine[] = [];
        for (let i = 0; i < TRANSCRIBE_MAX_LINES + 20; i += 1) {
            acc = appendTranscribeLine(acc, line(i, i + 1, `s${i}`));
        }
        expect(acc).toHaveLength(TRANSCRIBE_MAX_LINES);
        // 截的是头部，留下的是最新那批
        expect(acc[acc.length - 1].text).toBe(`s${TRANSCRIBE_MAX_LINES + 19}`);
        expect(acc[0].text).toBe('s20');
    });

    it('不改入参（视图层靠引用判重，原地改会静默失效）', () => {
        const before: TranscribeLine[] = [line(0, 3, 'A')];
        const snapshot = before.slice();
        const after = appendTranscribeLine(before, line(3, 6, 'B'));
        expect(before).toEqual(snapshot);
        expect(after).not.toBe(before);
    });
});

describe('transcribeHeadline（进度标题）', () => {
    it('没出第一句时给「马上出」而不是「已识别 0 句」', () => {
        expect(transcribeHeadline(0)).toContain('马上');
        expect(transcribeHeadline(0)).not.toContain('0 句');
    });

    it('有了句子就把数字写出来（数字在变 = 它在动）', () => {
        expect(transcribeHeadline(1)).toContain('1 句');
        expect(transcribeHeadline(37)).toContain('37 句');
    });
});
