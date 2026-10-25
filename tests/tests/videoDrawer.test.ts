import { describe, expect, it } from 'vitest';
import {
    activeMarkIndex,
    MARK_TABS,
    MARK_TAB_LABELS,
    markEmptyHint,
    markTabCounts,
    markTabOf,
    marksOfTab,
    sortMarksByTime,
} from 'pure/videoDrawer';
import type { VideoMark } from 'pure/videoMarks';

function mk(patch: Partial<VideoMark>): VideoMark {
    return { seconds: 0, kind: 'stamp', line: 0, text: '', dest: '视频/a.mp4', ...patch };
}

const SHOT = mk({ seconds: 30, kind: 'shot', line: 3, text: '00:30 ![[图/a.png]]', image: '图/a.png' });
const STAMP = mk({ seconds: 10, kind: 'stamp', line: 1, text: '00:10 开场' });
const SHOT2 = mk({ seconds: 5, kind: 'shot', line: 7, text: '00:05 ![[图/b.png]]', image: '图/b.png' });
const ALL = [SHOT, STAMP, SHOT2];

describe('#579 markTabOf（截图笔记 / 时间戳笔记 的分档口径）', () => {
    it('🔴 带截图的归「截图笔记」，纯时间戳的归「时间戳笔记」—— 口径来自数据本身，本批不新增字段', () => {
        expect(markTabOf({ kind: 'shot' })).toBe('shot');
        expect(markTabOf({ kind: 'stamp' })).toBe('scene');
    });

    it('⛔ 脏输入不崩：`kind` 缺失 / undefined / null ⇒ 归「时间戳笔记」（未知不当成截图）', () => {
        expect(markTabOf({} as Pick<VideoMark, 'kind'>)).toBe('scene');
        expect(markTabOf(undefined)).toBe('scene');
        expect(markTabOf(null)).toBe('scene');
    });

    it('两个 Tab 的名字是 `截图笔记` / `时间戳笔记`（#587 定稿），顺序是用户给的顺序', () => {
        expect([...MARK_TABS]).toEqual(['shot', 'scene']);
        expect(MARK_TAB_LABELS.shot).toBe('截图笔记');
        expect(MARK_TAB_LABELS.scene).toBe('时间戳笔记');
    });
});

describe('#579 marksOfTab / markTabCounts', () => {
    it('过滤各归各的、**保持传入顺序**（笔记里的原序）', () => {
        expect(marksOfTab(ALL, 'shot')).toEqual([SHOT, SHOT2]);
        expect(marksOfTab(ALL, 'scene')).toEqual([STAMP]);
    });

    it('🔴 计数与过滤**同一份口径**（Tab 上的数字不会和列表长度打架）', () => {
        const c = markTabCounts(ALL);
        expect(c).toEqual({ shot: 2, scene: 1 });
        expect(c.shot).toBe(marksOfTab(ALL, 'shot').length);
        expect(c.scene).toBe(marksOfTab(ALL, 'scene').length);
    });

    it('空 / undefined ⇒ 空数组与全 0（⛔ 不返回 undefined）', () => {
        expect(marksOfTab(undefined, 'shot')).toEqual([]);
        expect(marksOfTab([], 'scene')).toEqual([]);
        expect(markTabCounts(undefined)).toEqual({ shot: 0, scene: 0 });
    });
});

describe('#579 sortMarksByTime（列表按时间升序，且稳定）', () => {
    it('升序；⛔ 不改动传入数组（新建一份）', () => {
        const input = [SHOT, STAMP, SHOT2];
        const out = sortMarksByTime(input);
        expect(out.map((m) => m.seconds)).toEqual([5, 10, 30]);
        expect(input.map((m) => m.seconds)).toEqual([30, 10, 5]);
        expect(out).not.toBe(input);
    });

    it('🔴 秒数相同 ⇒ **保持传入的相对顺序**（稳定排序：同秒的两条不该来回换位）', () => {
        const a = mk({ seconds: 8, line: 1 });
        const b = mk({ seconds: 8, line: 2 });
        const c = mk({ seconds: 8, line: 3 });
        // 传入顺序 3,1,2 ⇒ 出来还是 3,1,2（`Array.prototype.sort` 在本环境已是稳定排序，本函数不额外打乱）
        expect(sortMarksByTime([c, a, b]).map((m) => m.line)).toEqual([3, 1, 2]);
        // 同秒混着别的秒数：同秒组内仍保序
        expect(sortMarksByTime([b, mk({ seconds: 1, line: 9 }), a]).map((m) => m.line)).toEqual([9, 2, 1]);
    });

    it('空 / undefined ⇒ 空数组', () => {
        expect(sortMarksByTime(undefined)).toEqual([]);
        expect(sortMarksByTime([])).toEqual([]);
    });
});

describe('#579 activeMarkIndex（双向联动：当前播放位置对应哪一条）', () => {
    const list = sortMarksByTime(ALL); // 5 / 10 / 30

    it('🔴 取「不超过当前秒数」里**最大的那个** —— 与输入顺序无关（乱序笔记也指得对）', () => {
        expect(activeMarkIndex(list, 12)).toBe(1); // 10s 那条
        expect(activeMarkIndex(list, 40)).toBe(2); // 30s 那条
        // 乱序传入仍指向同一条（按秒数取最大，⛔ 不是「最后一个满足的」）
        expect(activeMarkIndex([ALL[0], ALL[1], ALL[2]], 8)).toBe(2); // 5s 那条（下标 2）
    });

    it('🔴 光标还在**第一个标记之前** ⇒ -1（不高亮任何一条）', () => {
        expect(activeMarkIndex(list, 0)).toBe(-1);
        expect(activeMarkIndex(list, 4)).toBe(-1);
    });

    it('容差 0.6s：正好落在标记那一刻 / 差一点点都点亮', () => {
        expect(activeMarkIndex(list, 5)).toBe(0);
        expect(activeMarkIndex(list, 4.5)).toBe(0); // 5 - 0.5 ≤ 5 + 0.6
        expect(activeMarkIndex(list, 3.9)).toBe(-1); // 差 1.1s，够不着
    });

    it('空列表 / 非法秒数 ⇒ -1（不崩、不误指）', () => {
        expect(activeMarkIndex([], 100)).toBe(-1);
        expect(activeMarkIndex(list, NaN)).toBe(-1);
        expect(activeMarkIndex(list, Infinity)).toBe(-1);
    });

    it('脏条目（seconds 非数字）跳过，不影响其余命中', () => {
        const dirty = [mk({ seconds: NaN as unknown as number }), mk({ seconds: 20 })];
        expect(activeMarkIndex(dirty, 25)).toBe(1);
    });
});

describe('#579 markEmptyHint（空状态引导）', () => {
    it('两个 Tab 各有一句，且都点明了「怎么产生」—— 空列表不是死胡同', () => {
        expect(markEmptyHint('shot')).toContain('还没有截图笔记');
        expect(markEmptyHint('shot')).toContain('S');
        expect(markEmptyHint('scene')).toContain('还没有时间戳笔记');
        expect(markEmptyHint('scene')).toContain('T');
        expect(markEmptyHint('shot')).not.toBe(markEmptyHint('scene'));
    });
});
