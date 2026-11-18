import { describe, expect, it } from 'vitest';
import {
    AB_MIN_GAP_SEC,
    LOOP_LEAD_SEC,
    SHADOW_GAP_CHOICES,
    SHADOW_GAP_DEFAULT,
    abFromCues,
    isLookupable,
    lookupKey,
    loopRangeOf,
    loopSeekTarget,
    makeAbPoints,
    normalizeShadowGap,
    shadowCountdownText,
    shadowLeftMs,
    shadowProgress,
    shadowShouldPause,
} from 'pure/learnMode';

/** 造一句话的区间 */
function cue(start: number, end: number): { start: number; end: number } {
    return { start, end };
}

describe('normalizeShadowGap', () => {
    it('三档原样返回', () => {
        for (const v of SHADOW_GAP_CHOICES) expect(normalizeShadowGap(v)).toBe(v);
    });

    it('字符串数字也能认（设置从 JSON 读回来可能是字符串）', () => {
        expect(normalizeShadowGap('5')).toBe(5);
        expect(normalizeShadowGap('2')).toBe(2);
    });

    it('非法输入回落到默认 3s，⛔ 不降级到最快档', () => {
        for (const bad of [undefined, null, '', NaN, Infinity, -Infinity, 'abc', {}, []]) {
            expect(normalizeShadowGap(bad)).toBe(SHADOW_GAP_DEFAULT);
        }
    });

    it('两档之间取最近的一档', () => {
        // 1 与 2 的中点 1.5 ⇒ 距离相等时不应抖动；这里只要落在合法档位即可
        expect(SHADOW_GAP_CHOICES).toContain(normalizeShadowGap(2.4));
        expect(normalizeShadowGap(2.4)).toBe(2);
        expect(normalizeShadowGap(4.6)).toBe(5);
        expect(normalizeShadowGap(0.2)).toBe(1);
    });

    it('超出范围的极大极小值取端点档', () => {
        expect(normalizeShadowGap(-99)).toBe(1);
        expect(normalizeShadowGap(999)).toBe(5);
    });
});

describe('makeAbPoints', () => {
    it('正常两点原样（已排序）', () => {
        expect(makeAbPoints(12, 45)).toEqual({ a: 12, b: 45 });
    });

    it('先点 B 再点 A 也能成区间（不报错，自己排序）', () => {
        expect(makeAbPoints(45, 12)).toEqual({ a: 12, b: 45 });
    });

    it('负数端点夹到 0', () => {
        expect(makeAbPoints(-5, 10)).toEqual({ a: 0, b: 10 });
    });

    it('间隔不足 AB_MIN_GAP_SEC 判无效', () => {
        expect(makeAbPoints(10, 10)).toBeNull();
        expect(makeAbPoints(10, 10.2)).toBeNull();
        expect(makeAbPoints(10, 10 + AB_MIN_GAP_SEC - 0.01)).toBeNull();
    });

    it('刚好等于下限时有效（边界不吞）', () => {
        expect(makeAbPoints(10, 10 + AB_MIN_GAP_SEC)).toEqual({ a: 10, b: 10 + AB_MIN_GAP_SEC });
    });

    it('非有限数 / 空值判无效（⛔ Number(null)=0 不能当成点）', () => {
        for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x', '', '  ', [], false]) {
            expect(makeAbPoints(bad, 10)).toBeNull();
            expect(makeAbPoints(10, bad)).toBeNull();
        }
    });

    it('像数字的字符串照收（JSON 读回来可能是字符串）', () => {
        expect(makeAbPoints('12', '45')).toEqual({ a: 12, b: 45 });
        expect(makeAbPoints(' -3 ', 30)).toEqual({ a: 0, b: 30 });
    });

    it("'3s' / '0x10' / '1e2' 这类非数字字面量不认", () => {
        expect(makeAbPoints('3s', 10)).toBeNull();
        expect(makeAbPoints('0x10', 30)).toBeNull();
        expect(makeAbPoints('1e2', 300)).toBeNull();
    });
});

describe('abFromCues', () => {
    const cues = [cue(0, 2), cue(2, 5), cue(5, 9), cue(9, 12)];

    it('取 A 句开头到 B 句结尾（⛔ 不是 B 句开头）', () => {
        expect(abFromCues(cues, 1, 2)).toEqual({ a: 2, b: 9 });
    });

    it('反向选点同样成立（i > j）', () => {
        expect(abFromCues(cues, 2, 1)).toEqual({ a: 2, b: 9 });
    });

    it('同一句设 A 和 B ⇒ 就是这句的单句循环（区间=该句首尾）', () => {
        // ⚠️ 这**不是**错误用法：用户在只想反复听一句时，右键同一句设 A 再设 B 最自然。
        //    区间取「该句 start → 该句 end」，与 `cue` 档等价。
        expect(abFromCues(cues, 1, 1)).toEqual({ a: 2, b: 5 });
    });

    it('字幕行时长为 0（坏字幕）⇒ 间隔不足判无效', () => {
        const bad = [cue(0, 2), cue(5, 5)];
        expect(abFromCues(bad, 1, 1)).toBeNull();
    });

    it('越界 / 非整数下标判无效', () => {
        expect(abFromCues(cues, -1, 2)).toBeNull();
        expect(abFromCues(cues, 0, 99)).toBeNull();
        expect(abFromCues(cues, 0.5, 2)).toBeNull();
    });
});

describe('loopRangeOf', () => {
    const line = cue(3, 6);
    const ab = { a: 10, b: 20 };

    it('off 档一律 null（哪怕传了区间）', () => {
        expect(loopRangeOf('off', line, ab)).toBeNull();
    });

    it('cue 档取当前句', () => {
        expect(loopRangeOf('cue', line, null)).toEqual({ start: 3, end: 6 });
    });

    it('cue 档没有当前句 ⇒ null', () => {
        expect(loopRangeOf('cue', null, ab)).toBeNull();
    });

    it('cue 档区间退化成零长 ⇒ null（否则原地死循环）', () => {
        expect(loopRangeOf('cue', cue(3, 3), null)).toBeNull();
        expect(loopRangeOf('cue', cue(3, 2), null)).toBeNull();
    });

    it('ab 档取 AB 端点', () => {
        expect(loopRangeOf('ab', null, ab)).toEqual({ start: 10, end: 20 });
    });

    it('ab 档没有端点 ⇒ null', () => {
        expect(loopRangeOf('ab', line, null)).toBeNull();
    });
});

describe('loopSeekTarget', () => {
    const line = cue(3, 6);
    const ab = { a: 10, b: 20 };

    it('off 档永不回跳', () => {
        expect(loopSeekTarget('off', 999, line, ab)).toBeNull();
    });

    it('区间内不跳', () => {
        expect(loopSeekTarget('cue', 4, line, null)).toBeNull();
        // ⚠️ 第 3 参是「当前句区间」，第 4 参才是 AB 端点 —— 别把 `ab` 塞进 cue 位
        expect(loopSeekTarget('ab', 15, null, ab)).toBeNull();
    });

    it('越过终点 ⇒ 跳回起点', () => {
        expect(loopSeekTarget('cue', 6.5, line, null)).toBe(3);
        expect(loopSeekTarget('ab', 21, null, ab)).toBe(10);
    });

    it('提前 LOOP_LEAD_SEC 收（避免下一句露头）', () => {
        const justBefore = 6 - LOOP_LEAD_SEC / 2;
        expect(loopSeekTarget('cue', justBefore, line, null)).toBe(3);
    });

    it('刚好差一点没到提前量 ⇒ 不跳', () => {
        const tooEarly = 6 - LOOP_LEAD_SEC - 0.01;
        expect(loopSeekTarget('cue', tooEarly, line, null)).toBeNull();
    });

    it('播放头在起点之前（跳转后未落地）⇒ 不重复 seek', () => {
        expect(loopSeekTarget('cue', 1, line, null)).toBeNull();
    });

    it('非有限数一律不判', () => {
        for (const bad of [NaN, Infinity, -Infinity]) {
            expect(loopSeekTarget('cue', bad, line, null)).toBeNull();
        }
    });

    it('区间非法时即便越过也不跳', () => {
        expect(loopSeekTarget('cue', 99, cue(3, 3), null)).toBeNull();
    });

    it('leadSec 传坏值时回落默认容差', () => {
        expect(loopSeekTarget('cue', 6, line, null, NaN)).toBe(3);
        expect(loopSeekTarget('cue', 6, line, null, -1)).toBe(3);
    });
});

describe('shadowShouldPause', () => {
    const line = cue(3, 6);

    it('未开启 ⇒ 永不暂停', () => {
        expect(shadowShouldPause(false, 99, line)).toBe(false);
    });

    it('到达句尾 ⇒ 该暂停', () => {
        expect(shadowShouldPause(true, 6, line)).toBe(true);
        expect(shadowShouldPause(true, 99, line)).toBe(true);
    });

    it('提前量内也算到（与循环同一容差）', () => {
        expect(shadowShouldPause(true, 6 - LOOP_LEAD_SEC / 2, line)).toBe(true);
    });

    it('还没进这一句 ⇒ 不暂停（刚 seek 过来不该立刻停）', () => {
        expect(shadowShouldPause(true, 1, line)).toBe(false);
    });

    it('行内播放中 ⇒ 不暂停', () => {
        expect(shadowShouldPause(true, 4, line)).toBe(false);
    });

    it('没有当前句 / 区间非法 / 坏时间 ⇒ 不暂停', () => {
        expect(shadowShouldPause(true, 6, null)).toBe(false);
        expect(shadowShouldPause(true, 6, cue(6, 6))).toBe(false);
        expect(shadowShouldPause(true, NaN, line)).toBe(false);
    });
});

describe('shadowLeftMs / shadowProgress / shadowCountdownText', () => {
    it('剩余毫秒夹到 0', () => {
        expect(shadowLeftMs(5000, 4000)).toBe(1000);
        expect(shadowLeftMs(5000, 6000)).toBe(0);
    });

    it('非有限数剩余 0', () => {
        expect(shadowLeftMs(NaN, 0)).toBe(0);
        expect(shadowLeftMs(1000, NaN)).toBe(0);
    });

    it('进度 0..1，到期为 1', () => {
        expect(shadowProgress(3000, 0, 3000)).toBe(0);
        expect(shadowProgress(3000, 1500, 3000)).toBeCloseTo(0.5, 5);
        expect(shadowProgress(3000, 4000, 3000)).toBe(1);
    });

    it('总时长为 0 / 非法 ⇒ 直接算到期（⛔ 不除以 0 得 NaN）', () => {
        expect(shadowProgress(1000, 0, 0)).toBe(1);
        expect(shadowProgress(1000, 0, NaN)).toBe(1);
    });

    it('读数向上取整（3 秒档依次 3/2/1）', () => {
        expect(shadowCountdownText(3000)).toBe('3');
        expect(shadowCountdownText(2900)).toBe('3');
        expect(shadowCountdownText(2001)).toBe('3');
        expect(shadowCountdownText(2000)).toBe('2');
        expect(shadowCountdownText(1)).toBe('1');
    });

    it('到期显示 0，坏值也显示 0（⛔ 不出现 NaN）', () => {
        expect(shadowCountdownText(0)).toBe('0');
        expect(shadowCountdownText(-500)).toBe('0');
        expect(shadowCountdownText(NaN)).toBe('0');
    });
});

describe('lookupKey', () => {
    it('小写化', () => {
        expect(lookupKey('Apple')).toBe('apple');
    });

    it('剥掉首尾标点', () => {
        expect(lookupKey('  "hello,"  ')).toBe('hello');
        expect(lookupKey('（你好）')).toBe('你好');
        expect(lookupKey("don't")).toBe("don't");
    });

    it('中间标点保留（don\'t / well-known 是一个词）', () => {
        expect(lookupKey('well-known')).toBe('well-known');
        expect(lookupKey("it's")).toBe("it's");
    });

    it('全是标点 ⇒ 空串', () => {
        expect(lookupKey('...')).toBe('');
        expect(lookupKey('—')).toBe('');
    });

    it('空 / 非字符串 ⇒ 空串', () => {
        expect(lookupKey('')).toBe('');
        expect(lookupKey('   ')).toBe('');
        expect(lookupKey(undefined as unknown as string)).toBe('');
        expect(lookupKey(42 as unknown as string)).toBe('');
    });
});

describe('isLookupable', () => {
    it('普通英文词可查', () => {
        expect(isLookupable('apple')).toBe(true);
        expect(isLookupable("don't")).toBe(true);
    });

    it('中文可查（交给词典层决定有没有）', () => {
        expect(isLookupable('你好')).toBe(true);
    });

    it('单字母不查（命中率太低只会挡字幕）', () => {
        expect(isLookupable('a')).toBe(false);
        expect(isLookupable('i')).toBe(false);
    });

    it('纯数字不查（时间码 / 集数）', () => {
        expect(isLookupable('123')).toBe(false);
        expect(isLookupable('00')).toBe(false);
    });

    it('超长串不查（连写 / URL 残片）', () => {
        expect(isLookupable('a'.repeat(49))).toBe(false);
        expect(isLookupable('a'.repeat(48))).toBe(true);
    });

    it('空串不查', () => {
        expect(isLookupable('')).toBe(false);
    });

    it('带数字但含字母可查（mp3 / 4k）', () => {
        expect(isLookupable('mp3')).toBe(true);
        expect(isLookupable('4k')).toBe(true);
    });
});
