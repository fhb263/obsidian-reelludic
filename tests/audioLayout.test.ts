// 音频播放器三档自适应（2026-09-27 ④-4）测试。
//
// 为什么值得单测：档位判定与「当前歌词行居中」这两件事**错了都不报错**——
//   · 档位错 ⇒ 侧栏里画成宽档（封面 200px 挤爆侧栏）或标签页里画成窄档（白白不用宽度）；
//   · 居中偏移算错 ⇒ 当前行被推到视口外，用户以为「高亮丢了」。
// 档位阈值是样式侧 `[data-tier="…"]` 的**唯一真源**，改这里就等于改三档布局的分界。
import { describe, it, expect } from 'vitest';
import {
    AUDIO_LAYOUT_MEDIUM_MIN,
    AUDIO_LAYOUT_TIERS,
    AUDIO_LAYOUT_WIDE_MIN,
    lyricCenterDelta,
    resolveAudioLayout,
} from 'pure/audioLayout';

describe('resolveAudioLayout —— 容器宽度 → 三档', () => {
    it('阈值常量本身：720 / 420（样式侧与视图层都从它们读，⛔ 别各写一份）', () => {
        expect(AUDIO_LAYOUT_WIDE_MIN).toBe(720);
        expect(AUDIO_LAYOUT_MEDIUM_MIN).toBe(420);
        expect(AUDIO_LAYOUT_TIERS).toEqual(['wide', 'medium', 'compact']);
    });

    it('宽档 ≥ 720（含边界 720 本身）', () => {
        expect(resolveAudioLayout(1200)).toBe('wide');
        expect(resolveAudioLayout(721)).toBe('wide');
        // 🔴 边界取「含」：仿真实测 978 → wide、720 恰好是提案里的分界
        expect(resolveAudioLayout(720)).toBe('wide');
    });

    it('中档 420–719（含两端）', () => {
        expect(resolveAudioLayout(719)).toBe('medium');
        expect(resolveAudioLayout(618)).toBe('medium');
        expect(resolveAudioLayout(464)).toBe('medium');
        expect(resolveAudioLayout(420)).toBe('medium');
    });

    it('紧档 < 420（含 419；典型 = 右侧边栏）', () => {
        expect(resolveAudioLayout(419)).toBe('compact');
        expect(resolveAudioLayout(358)).toBe('compact');
        expect(resolveAudioLayout(1)).toBe('compact');
    });

    it('🔴 宽度不可用 ⇒ null（未布局不提交），⛔ 别回落 compact', () => {
        // 0 = 视图刚挂载 / 后台 leaf 重新可见；回落 compact 会先闪一帧窄档再跳回宽档
        expect(resolveAudioLayout(0)).toBeNull();
        expect(resolveAudioLayout(-1)).toBeNull();
        expect(resolveAudioLayout(NaN)).toBeNull();
        expect(resolveAudioLayout(Infinity)).toBeNull();
        expect(resolveAudioLayout(-Infinity)).toBeNull();
    });

    it('🔴 分档**全覆盖且单调**（不留「两头都能落进去」或「落不进去」的缝）', () => {
        // 若实现写成 `w > 720 ? wide : w > 420 ? medium : 'compact'`，两侧边界都会挪一格 —— 上面两条会红。
        // 若实现漏掉 compact 分支（恒 medium），窄档全部会红。
        const seen = new Set<string | null>();
        for (let w = 1; w <= 1400; w++) seen.add(resolveAudioLayout(w));
        expect([...seen].sort()).toEqual(['compact', 'medium', 'wide'].sort());
        // 单调不回头：一旦升到 wide 就不会再掉档
        let prev = 0;
        for (let w = 1; w <= 1400; w++) {
            const rank = { compact: 1, medium: 2, wide: 3 }[resolveAudioLayout(w) as string] ?? 0;
            expect(rank).toBeGreaterThanOrEqual(prev);
            prev = rank;
        }
    });
});

describe('lyricCenterDelta —— 当前行垂直居中所需的滚动增量', () => {
    it('行已在正中 ⇒ 0', () => {
        expect(lyricCenterDelta({ top: 200, height: 20 }, { top: 100, height: 220 })).toBe(0);
    });

    it('行在中心下方 ⇒ 正值（要往下滚）', () => {
        // 行中心 510、列表中心 250 ⇒ 260
        expect(lyricCenterDelta({ top: 500, height: 20 }, { top: 100, height: 300 })).toBe(260);
    });

    it('行在中心上方 ⇒ 负值（要往上滚）', () => {
        expect(lyricCenterDelta({ top: 120, height: 20 }, { top: 100, height: 300 })).toBe(-120);
    });

    it('🔴 取的是「两条 rect 的差值」，⛔ 不是 offsetTop 式差值（行有 position:relative）', () => {
        // 这一组输入专门挑「两种实现会分道扬镳」的位置：若实现退化成 `cur.top - list.top`（= 400）
        // 或 `cur.top + cur.height/2 - list.height/2`（= 360），本条即红。
        expect(lyricCenterDelta({ top: 500, height: 20 }, { top: 100, height: 300 })).toBe(260);
        expect(lyricCenterDelta({ top: 500, height: 20 }, { top: 100, height: 300 })).not.toBe(400);
    });

    it('行高参与计算（行越高，同一 top 下要滚得越多）', () => {
        const thin = lyricCenterDelta({ top: 500, height: 10 }, { top: 100, height: 300 });
        const thick = lyricCenterDelta({ top: 500, height: 50 }, { top: 100, height: 300 });
        expect(thick - thin).toBe(20);
    });

    it('脏 rect（非有限值）⇒ 0（不动比乱动好：乱动会把用户的滚动位置顶飞）', () => {
        expect(lyricCenterDelta({ top: NaN, height: 20 }, { top: 100, height: 300 })).toBe(0);
        expect(lyricCenterDelta({ top: 500, height: 20 }, { top: 100, height: Infinity })).toBe(0);
    });
});
