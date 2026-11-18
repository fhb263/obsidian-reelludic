/**
 * 🔴 m08028：LRC 整体时间戳偏移的单测。
 *
 * 用户逐字：「出一个对LRC歌词整体所有时间戳向后加N秒的功能以对齐歌曲与LRC歌词不对齐的功能」。
 * 这里钉住三类不可回退的口径：
 *  ⑴ **只动行首时间标签**，其余字节一个不改（`[ti:]` / `[offset:]` / `[Gold]` / 双语竖线 / 逐字 `<mm:ss.xx>`）；
 *  ② **小数位数保留**（`[00:12.50]` 加 1s 得 `[00:15.50]`，⛔ 不许被抹成整秒）；
 *  ③ **偏移记忆按条目隔离**，归零删键。
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import {
    clampLyricOffset,
    loadLyricOffset,
    lyricOffsetLabel,
    LYRIC_OFFSET_COARSE,
    LYRIC_OFFSET_KEY_PREFIX,
    LYRIC_OFFSET_LIMIT,
    LYRIC_OFFSET_STEP,
    saveLyricOffset,
    shiftClockTag,
    shiftLrcLines,
    shiftLrcText,
} from 'pure/lrcShift';
import { parseLrc } from 'pure/lrc';

describe('🔴 m08028 shiftClockTag：单个标签加 N 毫秒', () => {
    it('整秒标签加 1s ⇒ 整秒，不吐小数', () => {
        expect(shiftClockTag('00:12', 1000)).toBe('00:13');
        expect(shiftClockTag('01:59', 1000)).toBe('02:00'); // 跨分钟进位
    });

    it('两位小数标签 ⇒ 小数位原样保留（⛔ 不许抹成整秒）', () => {
        expect(shiftClockTag('00:12.50', 1000)).toBe('00:13.50');
        expect(shiftClockTag('00:12.00', 2500)).toBe('00:14.50');
        expect(shiftClockTag('00:59.99', 10)).toBe('01:00.00'); // 跨分钟且进位
    });

    it('三位小数（毫秒档）也按原位数还原', () => {
        expect(shiftClockTag('00:01.250', 500)).toBe('00:01.750');
    });

    it('负数夹到 00:00（LRC 没有负时间轴）', () => {
        expect(shiftClockTag('00:02', -5000)).toBe('00:00');
        expect(shiftClockTag('00:02.50', -5000)).toBe('00:00.00');
    });

    it('跨小时进 hh:mm:ss', () => {
        expect(shiftClockTag('59:50', 20_000)).toBe('01:00:10');
    });

    it('非法时间标签原样返回（⛔ 别清成 00:00 造一个「合法但错」的值）', () => {
        expect(shiftClockTag('99:99', 1000)).toBe('99:99');
        expect(shiftClockTag('abc', 1000)).toBe('abc');
    });
});

describe('🔴 m08028 shiftLrcText：整篇重写，非时间内容零改动', () => {
    it('每个行首时间标签都平移，正文一字不动', () => {
        const src = ['[00:01.00]第一句', '[00:12.50]第二句'].join('\n');
        expect(shiftLrcText(src, 1000)).toBe(['[00:02.00]第一句', '[00:13.50]第二句'].join('\n'));
    });

    it('一行多个时间标签逐个平移（副歌复用同句是常态）', () => {
        const src = '[00:10.00][01:10.00]副歌';
        expect(shiftLrcText(src, 500)).toBe('[00:10.50][01:10.50]副歌');
    });

    it('kv 头与 [Gold] 标记原样保留，只有时间标签变', () => {
        const src = ['[ti:孤勇者]', '[ar:陈奕迅]', '[offset:-500]', '[00:05.00][Gold]金句'].join('\n');
        const out = shiftLrcText(src, 1000);
        expect(out).toContain('[ti:孤勇者]');
        expect(out).toContain('[ar:陈奕迅]');
        expect(out).toContain('[offset:-500]');
        expect(out).toContain('[00:06.00][Gold]金句');
    });

    it('双语竖线与逐字 <mm:ss.xx> 一个字符都不动', () => {
        const src = '[00:05.00]<00:05.00>Hel<00:05.50>lo | 你好';
        expect(shiftLrcText(src, 1000)).toBe('[00:06.00]<00:05.00>Hel<00:05.50>lo | 你好');
    });

    it('非行首的方括号（如正文里的 [Chorus]）不被当标签', () => {
        const src = '前面文字 [Chorus] 后面';
        expect(shiftLrcText(src, 1000)).toBe(src);
    });

    it('保留原始 CRLF 换行风格（⛔ 别把 Windows 手改过的文件整体换行）', () => {
        const src = '[00:01.00]甲\r\n[00:02.00]乙';
        const out = shiftLrcText(src, 1000);
        expect(out).toContain('\r\n');
        expect(out.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    });

    it('deltaMs 为 0 / NaN ⇒ 原样返回（⛔ 别当 0 去重写一遍）', () => {
        const src = '[00:01.00]甲';
        expect(shiftLrcText(src, 0)).toBe(src);
        expect(shiftLrcText(src, Number.NaN)).toBe(src);
    });

    it('写回后能被 parseLrc 读回，行数与文本不变', () => {
        const src = ['[00:01.00]第一句', '[00:12.50]第二句', '[00:30.00][Gold]第三句'].join('\n');
        const back = parseLrc(shiftLrcText(src, 2000));
        expect(back).toHaveLength(3);
        expect(back.map((l) => l.text)).toEqual(['第一句', '第二句', '第三句']);
        expect(back[0].timestamp).toBe(3000);
        expect(back[1].timestamp).toBe(14_500);
        expect(back[2].gold).toBe(true);
        expect(back[2].timestamp).toBe(32_000);
    });
});

describe('🔴 m08028 shiftLrcLines：渲染侧平移', () => {
    it('时间戳与 timestr 同步平移', () => {
        const lines = parseLrc('[00:01.00]甲\n[00:02.00]乙');
        const out = shiftLrcLines(lines, 1000);
        expect(out.map((l) => l.timestamp)).toEqual([2000, 3000]);
        expect(out.map((l) => l.timestr)).toEqual(['00:02', '00:03']);
    });

    it('逐字时间一起平移（卡拉 OK 不能和行错开）', () => {
        const lines = parseLrc('[00:10.00]<00:10.00>你<00:11.00>好');
        const out = shiftLrcLines(lines, 500);
        expect(out[0].words?.map((w) => w.timestamp)).toEqual([10_500, 11_500]);
    });

    it('不原地改原数组（偏移要能调回 0）', () => {
        const lines = parseLrc('[00:01.00]甲');
        shiftLrcLines(lines, 5000);
        expect(lines[0].timestamp).toBe(1000);
    });

    it('负数平移把时间夹到 0，不出负时间', () => {
        const out = shiftLrcLines(parseLrc('[00:00.50]甲'), -5000);
        expect(out[0].timestamp).toBe(0);
    });
});

describe('🔴 m08028 / m08754 ① 偏移量夹取与文案', () => {
    it('夹到 ±30s 并对齐 0.1s 网格', () => {
        expect(clampLyricOffset(1000)).toBe(1000);
        // 🔴 m08754 ①：网格从 0.5s 改 0.1s（细档步长就是 0.1s）⇒ 1200 不再被吸成 1000。
        //    ⛔ 别把这条改回「吸附到 0.5s 网格」：那会让 `<`/`>` 按了不生效（落不到细档上）。
        expect(clampLyricOffset(1200)).toBe(1200);
        expect(clampLyricOffset(1260)).toBe(1300); // 仍会吸到最近的 0.1s
        expect(clampLyricOffset(99_000)).toBe(LYRIC_OFFSET_LIMIT);
        expect(clampLyricOffset(-99_000)).toBe(-LYRIC_OFFSET_LIMIT);
    });

    it('幂等：clamp(clamp(x)) === clamp(x)', () => {
        for (const x of [0, 250, 1200, 1260, -7700, 99_000, Number.NaN]) {
            const once = clampLyricOffset(x);
            expect(clampLyricOffset(once)).toBe(once);
        }
    });

    it('非法输入回落 0，且 -0 归一成 0（否则文案会出「-0s」）', () => {
        expect(clampLyricOffset(Number.NaN)).toBe(0);
        expect(Object.is(clampLyricOffset(-0), 0)).toBe(true);
        expect(lyricOffsetLabel(-0)).toBe('0s');
    });

    it('文案：整秒不带小数、非整秒保留一位、正数带 +', () => {
        expect(lyricOffsetLabel(0)).toBe('0s');
        expect(lyricOffsetLabel(2000)).toBe('+2s');
        expect(lyricOffsetLabel(-1500)).toBe('-1.5s');
        // 🔴 m08754 ①：细档变成 0.1s ⇒ 文案必须是 `+0.1s`（一位小数够用，刻度只到 0.1）
        expect(lyricOffsetLabel(LYRIC_OFFSET_STEP)).toBe('+0.1s');
        expect(lyricOffsetLabel(-LYRIC_OFFSET_STEP)).toBe('-0.1s');
        // 粗档整秒仍不带小数
        expect(lyricOffsetLabel(LYRIC_OFFSET_COARSE)).toBe('+1s');
    });
});

describe('🔴 m08028 偏移记忆：按条目隔离', () => {
    // 测试环境是 node（没有 localStorage）⇒ 塞一个内存替身，用完必删，免得污染其它用例。
    // （与 `tests/readerToc.test.ts` 的 stub 同款：本仓唯一的 localStorage 假件写法）
    const stub = (): Map<string, string> => {
        const mem = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
            setItem: (k: string, v: string) => void mem.set(k, v),
            removeItem: (k: string) => void mem.delete(k),
        });
        return mem;
    };
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('未存 ⇒ 0', () => {
        stub();
        expect(loadLyricOffset('entry-a')).toBe(0);
    });

    it('两个条目互不影响（用户要的「每条目各自记住」）', () => {
        stub();
        saveLyricOffset('entry-a', 1500);
        saveLyricOffset('entry-b', -2000);
        expect(loadLyricOffset('entry-a')).toBe(1500);
        expect(loadLyricOffset('entry-b')).toBe(-2000);
    });

    it('归零删键（⛔ 别在 localStorage 里留一堆 key="0"）', () => {
        const mem = stub();
        saveLyricOffset('entry-a', 1000);
        expect(mem.get(LYRIC_OFFSET_KEY_PREFIX + 'entry-a')).toBe('1000');
        saveLyricOffset('entry-a', 0);
        expect(mem.has(LYRIC_OFFSET_KEY_PREFIX + 'entry-a')).toBe(false);
    });

    it('空 entryId 不读不写', () => {
        const mem = stub();
        saveLyricOffset('', 1000);
        expect(loadLyricOffset('')).toBe(0);
        expect(mem.size).toBe(0);
    });

    it('localStorage 不可用 ⇒ 静默兜底 0（⛔ 别为了记住一个偏移把播放器拖崩）', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('denied');
            },
            setItem: () => {
                throw new Error('denied');
            },
            removeItem: () => {
                throw new Error('denied');
            },
        });
        expect(loadLyricOffset('entry-a')).toBe(0);
        expect(() => saveLyricOffset('entry-a', 1000)).not.toThrow();
    });

    it('存进来的越界值仍按 clampLyricOffset 夹取（老数据不撑爆）', () => {
        const mem = stub();
        mem.set(LYRIC_OFFSET_KEY_PREFIX + 'entry-a', '999999');
        expect(loadLyricOffset('entry-a')).toBe(LYRIC_OFFSET_LIMIT);
    });
});
