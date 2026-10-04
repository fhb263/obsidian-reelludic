// LRC 歌词解析与时间轴测试（2026-09-27 ④-1）。
//
// 为什么值得单测：④「并入 LyricFlux 音频播放器」里，歌词是**唯一跨源**的输入
// （笔记 ` ```lrc ` 块 / 同名 `.lrc` 文件 / 音频内嵌标签），格式在野外极不统一。
// 解析错的表现是「歌词整段错位 / 少几句」——肉眼很难判断是解析错还是歌词本身少，
// 所以口径必须钉死在纯函数上（视图层只负责画）。
//
// 本模块相对 LyricFlux 原实现（`renderers/lrc.ts`）的**两处修正**（都有专门用例）：
//  ① 多时间标签同一句（`[00:10.00][00:50.00]副歌`）原实现会**丢掉第二段**
//     （`chunk(s, 7)` 末块不足 7 个元素 ⇒ `parts[6].trim()` 抛错 ⇒ 整行被吞）；
//  ② 输出**按时间戳升序**（原实现按文件顺序 append）—— 二分定位当前行要求有序。
import { describe, it, expect } from 'vitest';
import {
    parseClock,
    formatClock,
    isLrcContent,
    parseLrcDocument,
    parseLrc,
    lrcIndexAt,
    wordIndexAt,
    LRC_OFFSET_LIMIT,
} from 'pure/lrc';

describe('parseClock（时间标签 → 秒）', () => {
    it('mm:ss 与 mm:ss.xx 都认', () => {
        expect(parseClock('00:00')).toBe(0);
        expect(parseClock('01:23')).toBe(83);
        expect(parseClock('01:23.45')).toBeCloseTo(83.45, 6);
        expect(parseClock('10:00')).toBe(600);
    });

    it('hh:mm:ss 与 hh:mm:ss.xx 也认（长音频 / 演唱会）', () => {
        expect(parseClock('01:02:03')).toBe(3723);
        expect(parseClock('01:02:03.5')).toBeCloseTo(3723.5, 6);
    });

    it('🔴 非法输入一律 NaN（⛔ 不返回 0 —— 0 会被当成「第 0 秒」，把整句歌词顶到开头）', () => {
        expect(Number.isNaN(parseClock(''))).toBe(true);
        expect(Number.isNaN(parseClock('abc'))).toBe(true);
        expect(Number.isNaN(parseClock('1'))).toBe(true);
        expect(Number.isNaN(parseClock('1:2:3:4'))).toBe(true);
    });
});

describe('formatClock（秒 → mm:ss，写回 / 时间戳笔记用）', () => {
    it('补零到两位，且**向下取整**（与显示口径一致：`[00:10.99]` 显示 `00:10`）', () => {
        expect(formatClock(0)).toBe('00:00');
        expect(formatClock(83)).toBe('01:23');
        expect(formatClock(83.45)).toBe('01:23');
        expect(formatClock(83.99)).toBe('01:23');
        expect(formatClock(600)).toBe('10:00');
    });

    it('超过一小时进位到 hh:mm:ss；非法值回落 00:00', () => {
        expect(formatClock(3723)).toBe('01:02:03');
        expect(formatClock(NaN)).toBe('00:00');
        expect(formatClock(-5)).toBe('00:00');
    });
});

describe('isLrcContent（判断「这串文本是不是 LRC」）', () => {
    it('含至少一个时间标签 → true', () => {
        expect(isLrcContent('[00:01.00]abc')).toBe(true);
        expect(isLrcContent('随便一句\n[12:34]\n又一句')).toBe(true);
    });

    it('🔴 纯文本 / 空串 → false（同名 `.lrc` 文件也可能是空文件或误存的一整篇 TXT）', () => {
        expect(isLrcContent('')).toBe(false);
        expect(isLrcContent('就是一句普通的话')).toBe(false);
        expect(isLrcContent('[不是时间]')).toBe(false);
    });
});

describe('parseLrcDocument（解析主入口）', () => {
    it('最基本形态：时间戳落成**毫秒**，`timestr` 归一成 `mm:ss`', () => {
        const { lines } = parseLrcDocument('[00:01.50]第一句\n[00:12.00]第二句\n');
        expect(lines.length).toBe(2);
        expect(lines[0].timestamp).toBe(1500);
        expect(lines[0].timestr).toBe('00:01');
        expect(lines[0].text).toBe('第一句');
        expect(lines[1].timestamp).toBe(12000);
        expect(lines[1].text).toBe('第二句');
    });

    it('CRLF 与首尾空白不干扰解析', () => {
        const { lines } = parseLrcDocument('\r\n[00:03.00]  有前后空格  \r\n\r\n');
        expect(lines.length).toBe(1);
        expect(lines[0].text).toBe('有前后空格');
    });

    it('元信息标签（ti/ar/al/by/offset）进 `meta`，**不**变成歌词行', () => {
        const doc = parseLrcDocument('[ti:曲名]\n[ar:歌手]\n[al:专辑]\n[by:制作者]\n[00:01.00]一句\n');
        expect(doc.meta.ti).toBe('曲名');
        expect(doc.meta.ar).toBe('歌手');
        expect(doc.meta.al).toBe('专辑');
        expect(doc.meta.by).toBe('制作者');
        expect(doc.lines.length).toBe(1);
        expect(doc.lines[0].text).toBe('一句');
    });

    it('🔴 前端标签大小写不敏感（`[TI:]` / `[Ar:]` 都要认）', () => {
        const doc = parseLrcDocument('[TI:曲名]\n[Ar:歌手]\n[00:01.00]一句\n');
        expect(doc.meta.ti).toBe('曲名');
        expect(doc.meta.ar).toBe('歌手');
    });

    it('🔴 行内非标签方括号必须**原样留在文本里**（`[Chorus]` 不是标签，是歌词的一部分）', () => {
        const { lines } = parseLrcDocument('[00:05.00][Chorus] 副歌开始\n');
        expect(lines[0].text).toBe('[Chorus] 副歌开始');
    });

    it('🔴 `[offset:±ms]` 作用到**全部**时间戳（正数=歌词提前）', () => {
        const plus = parseLrcDocument('[offset:+500]\n[00:10.00]一句\n');
        expect(plus.meta.offset).toBe(500);
        expect(plus.lines[0].timestamp).toBe(9500);
        const minus = parseLrcDocument('[offset:-300]\n[00:10.00]一句\n');
        expect(minus.meta.offset).toBe(-300);
        expect(minus.lines[0].timestamp).toBe(10300);
    });

    it('🔴 `[offset:]` 越界或非数字 ⇒ 忽略（⛔ 不把整首歌词推到负数时间）', () => {
        const bad = parseLrcDocument(`[offset:999999999]\n[00:10.00]一句\n`);
        expect(bad.meta.offset).toBeUndefined();
        expect(bad.lines[0].timestamp).toBe(10000);
        const nan = parseLrcDocument('[offset:abc]\n[00:10.00]一句\n');
        expect(nan.meta.offset).toBeUndefined();
        expect(nan.lines[0].timestamp).toBe(10000);
        expect(Number.isFinite(LRC_OFFSET_LIMIT)).toBe(true);
    });

    it('🔴 修正①：一行多时间标签（副歌复用）**每一段都要成行**', () => {
        const { lines } = parseLrcDocument('[00:10.00][00:50.00]同一句副歌\n[01:00.00]别的\n');
        expect(lines.map((l) => l.text)).toEqual(['同一句副歌', '同一句副歌', '别的']);
        expect(lines.map((l) => l.timestamp)).toEqual([10000, 50000, 60000]);
    });

    it('🔴 修正②：输出**按时间戳升序**（文件里乱序也要排好 —— 二分定位当前行的前提）', () => {
        const { lines } = parseLrcDocument('[00:30.00]第三\n[00:10.00]第一\n[00:20.00]第二\n');
        expect(lines.map((l) => l.text)).toEqual(['第一', '第二', '第三']);
    });

    it('中文行内出现 `|` 才算双语；竖线取**最后一个**、且两侧都要非空', () => {
        const { lines } = parseLrcDocument(
            '[00:01.00]原文 | 译文\n[00:02.00]只有一边 |\n[00:03.00]| 只有另一边\n[00:04.00]a | b | c\n',
        );
        expect(lines[0].text).toBe('原文');
        expect(lines[0].annotation).toBe('译文');
        expect(lines[1].annotation).toBeUndefined();
        expect(lines[1].text).toBe('只有一边 |');
        expect(lines[2].annotation).toBeUndefined();
        expect(lines[3].text).toBe('a | b');
        expect(lines[3].annotation).toBe('c');
    });

    it('空文本行被丢弃（⛔ 不留占位行 —— 会让「当前行」高亮停在一个空白上）', () => {
        const { lines } = parseLrcDocument('[00:01.00]\n[00:02.00]有词\n[00:03.00]   \n');
        expect(lines.length).toBe(1);
        expect(lines[0].text).toBe('有词');
    });

    it('没有时间标签的文本 ⇒ 0 行（不抛错）', () => {
        expect(parseLrcDocument('').lines).toEqual([]);
        expect(parseLrcDocument('普通文本\n第二行').lines).toEqual([]);
    });

    it('`parseLrc` 是 `parseLrcDocument().lines` 的便捷别名', () => {
        const doc = parseLrcDocument('[ti:曲名]\n[00:01.00]一句\n');
        expect(parseLrc('[ti:曲名]\n[00:01.00]一句\n')).toEqual(doc.lines);
    });
});

describe('parseLrcDocument：逐字时间戳（卡拉 OK）', () => {
    it('🔴 `<mm:ss.xx>` 绝对时间：逐字时间戳落成毫秒，**显示文本里不残留尖括号**', () => {
        const { lines } = parseLrcDocument('[00:10.00]<00:10.00>一<00:10.50>二<00:11.00>三\n');
        const w = lines[0].words;
        expect(lines[0].text).toBe('一二三');
        expect(w?.map((x) => x.text)).toEqual(['一', '二', '三']);
        expect(w?.map((x) => x.timestamp)).toEqual([10000, 10500, 11000]);
    });

    it('🔴 无逐字标记时按「到下一行」均分（最后一行的兜底间距 = 3000ms）', () => {
        const { lines } = parseLrcDocument('[00:00.00]ab cd\n[00:04.00]收尾\n');
        const w = lines[0].words;
        expect(w).toBeTruthy();
        // `ab cd` → ['ab', ' ', 'cd'] 三个 token，跨 4000ms 均分
        expect(w?.map((x) => x.text)).toEqual(['ab', ' ', 'cd']);
        expect(w?.map((x) => x.timestamp)).toEqual([0, 1333, 2667]);
        // 最后一行：无下一行 ⇒ +3000ms 摊分（2 个 token ⇒ 各 1500ms）
        const last = lines[1].words;
        expect(last?.map((x) => x.timestamp)).toEqual([4000, 5500]);
    });

    it('🔴 中日韩按**单字**拆、拉丁按**整词**拆；拼回去必须等于原文（不丢字符、不丢标点）', () => {
        const { lines } = parseLrcDocument('[00:00.00]你好世界 hello world! 再见\n[00:05.00]下一行\n');
        const joined = lines[0].words?.map((x) => x.text).join('') ?? '';
        expect(joined).toBe('你好世界 hello world! 再见');
        const tokens = (lines[0].words ?? []).map((x) => x.text).filter((s) => s.trim());
        expect(tokens).toEqual(['你', '好', '世', '界', 'hello', 'world', '!', '再', '见']);
    });
});

describe('lrcIndexAt（二分定位当前行）', () => {
    const lines = parseLrc('[00:05.00]一\n[00:10.00]二\n[00:20.00]三\n');

    it('第一句之前返回 -1（= 还没唱到任何一句）', () => {
        expect(lrcIndexAt(lines, 0)).toBe(-1);
        expect(lrcIndexAt(lines, 4999)).toBe(-1);
    });

    it('恰好落在时间戳上算「就是这一句」', () => {
        expect(lrcIndexAt(lines, 5000)).toBe(0);
        expect(lrcIndexAt(lines, 10000)).toBe(1);
    });

    it('落在两句之间算前一句', () => {
        expect(lrcIndexAt(lines, 9999)).toBe(0);
        expect(lrcIndexAt(lines, 19999)).toBe(1);
    });

    it('超过最后一句 ⇒ 停在最后一句（⛔ 不返回 -1，否则播放到尾部会「一句都不高亮」）', () => {
        expect(lrcIndexAt(lines, 20000)).toBe(2);
        expect(lrcIndexAt(lines, 999999)).toBe(2);
    });

    it('空数组 / 非有限时间 ⇒ -1', () => {
        expect(lrcIndexAt([], 1000)).toBe(-1);
        expect(lrcIndexAt(lines, NaN)).toBe(-1);
        expect(lrcIndexAt(lines, Infinity)).toBe(-1);
    });

    it('🔴 时间戳重复时取**最后**一个（副歌复用同一句 ⇒ 高亮停在最后一个同刻行，不会来回跳）', () => {
        const dup = parseLrc('[00:10.00]甲\n[00:10.00]乙\n[00:10.00]丙\n[00:20.00]丁\n');
        expect(lrcIndexAt(dup, 10000)).toBe(2);
        expect(lrcIndexAt(dup, 15000)).toBe(2);
        expect(lrcIndexAt(dup, 20000)).toBe(3);
    });
});

// ── #406：逐字高亮（「唱到第几个词元」的二分定位）──
//  用户：「歌词滚动效果需支持逐字高亮（按时间均分）方式，请在设置页-外观与体验中新增该效果的开关项」。
describe('wordIndexAt（#406 逐字高亮定位）', () => {
    const words = [
        { text: '七', timestamp: 1000 },
        { text: '里', timestamp: 1200 },
        { text: '香', timestamp: 1400 },
    ];

    it('落在词元之间 ⇒ 取**最后一个已开始**的词元下标', () => {
        expect(wordIndexAt(words, 1000)).toBe(0);
        expect(wordIndexAt(words, 1199)).toBe(0);
        expect(wordIndexAt(words, 1200)).toBe(1);
        expect(wordIndexAt(words, 1399)).toBe(1);
        expect(wordIndexAt(words, 1400)).toBe(2);
    });

    it('🔴 与 `lrcIndexAt` 的语义差异：第一个词元**之前** ⇒ -1（该行已高亮但一个字都没点亮）', () => {
        expect(wordIndexAt(words, 999)).toBe(-1);
        expect(wordIndexAt(words, 0)).toBe(-1);
    });

    it('超过最后一个词元 ⇒ **停在最后一个**（唱完 = 整句点亮，⛔ 不回 -1）', () => {
        expect(wordIndexAt(words, 99999)).toBe(2);
    });

    it('无词元 / 非有限时间 ⇒ -1（调用方据此不画逐字效果）', () => {
        expect(wordIndexAt(undefined, 5000)).toBe(-1);
        expect(wordIndexAt([], 5000)).toBe(-1);
        expect(wordIndexAt(words, NaN)).toBe(-1);
    });

    it('单个词元 / 时间戳重复（`<mm:ss.xx>` 同刻）⇒ 稳定取最后一个', () => {
        expect(wordIndexAt([{ text: 'a', timestamp: 0 }], 5000)).toBe(0);
        const dup = [
            { text: 'a', timestamp: 1000 },
            { text: 'b', timestamp: 1000 },
        ];
        expect(wordIndexAt(dup, 1000)).toBe(1);
    });
});
