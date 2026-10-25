/**
 * 音频播放器音量标度单测（0–200%，每 10% 一档，#393）。
 *
 * 🔴 重点钉住三处：
 *  ⑴ **一律吸附到 10% 的整数档**（读数 / 滑条 / 落库值三者一致，不会出现「读数 65、滑条 70」）；
 *  ⑵ **`elementVolumeFor` / `gainValueFor` 的四种组合**——有增益时元素 `volume` 必须写 **1**
 *     （否则 `volume × gain` 会双重衰减：设 50% 听成 25%）；
 *  ⑶ **上限 200%**、下限 0（= 静音），且 `0` 仍是合法值（⛔ 别把 0 当「未设置」）。
 */
import { describe, expect, it } from 'vitest';
import {
    AUDIO_GAIN_THRESHOLD,
    AUDIO_VOLUME_MAX,
    AUDIO_VOLUME_TINT_MIN_SAT,
    AUDIO_VOLUME_STEP_PCT,
    clampAudioVolume,
    elementVolumeFor,
    formatVolumePercent,
    gainValueFor,
    needsGain,
    volumeFromPercent,
    volumePercent,
    volumeTint,
} from 'pure/audioVolume';

describe('audioVolume · 标度与吸附', () => {
    it('常量口径：上限 200%、每档 10%、增益阈值 100%', () => {
        expect(AUDIO_VOLUME_MAX).toBe(2);
        expect(AUDIO_VOLUME_STEP_PCT).toBe(10);
        expect(AUDIO_GAIN_THRESHOLD).toBe(1);
    });

    it('clamp：夹到 0..2；非有限值 ⇒ 0（与 clampVolume 同口径）', () => {
        expect(clampAudioVolume(1.5)).toBe(1.5);
        expect(clampAudioVolume(-1)).toBe(0);
        expect(clampAudioVolume(9)).toBe(2);
        expect(clampAudioVolume(Number.NaN)).toBe(0);
        expect(clampAudioVolume(Number.POSITIVE_INFINITY)).toBe(0);
        expect(clampAudioVolume(undefined)).toBe(0);
    });

    it('🔴 百分比一律吸附到 10 的倍数（读数/滑条/落库三者一致）', () => {
        expect(volumePercent(1)).toBe(100);
        expect(volumePercent(0)).toBe(0);
        expect(volumePercent(2)).toBe(200);
        expect(volumePercent(0.65)).toBe(70); // 65 四舍五入到最近的十位
        expect(volumePercent(0.64)).toBe(60);
        expect(volumePercent(1.04)).toBe(100);
        expect(volumePercent(1.06)).toBe(110);
    });

    it('volumeFromPercent：整数百分比 → 内部值，脏值先吸附再夹', () => {
        expect(volumeFromPercent(100)).toBe(1);
        expect(volumeFromPercent(200)).toBe(2);
        expect(volumeFromPercent(0)).toBe(0);
        expect(volumeFromPercent(65)).toBe(0.7);
        expect(volumeFromPercent(-30)).toBe(0);
        expect(volumeFromPercent(999)).toBe(2);
        expect(volumeFromPercent(Number.NaN)).toBe(0);
    });

    it('往返一致：percent → value → percent 恒等（21 档全覆盖）', () => {
        for (let pct = 0; pct <= 200; pct += AUDIO_VOLUME_STEP_PCT) {
            expect(volumePercent(volumeFromPercent(pct))).toBe(pct);
        }
    });

    it('needsGain：只有 > 100% 才需要增益（100% 及以下走原生 volume）', () => {
        expect(needsGain(0)).toBe(false);
        expect(needsGain(0.5)).toBe(false);
        expect(needsGain(1)).toBe(false);
        expect(needsGain(1.1)).toBe(true);
        expect(needsGain(2)).toBe(true);
    });
});

describe('audioVolume · 元素音量 / 增益（🔴 别双重衰减）', () => {
    it('无增益路径：元素 volume = min(1, v)，增益恒 1', () => {
        expect(elementVolumeFor(0.5, false)).toBe(0.5);
        expect(elementVolumeFor(1, false)).toBe(1);
        expect(elementVolumeFor(1.5, false)).toBe(1); // 超出那截靠增益，这里只能写 1
        expect(gainValueFor(0.5, false)).toBe(1);
    });

    it('🔴 有增益路径：元素 volume **恒写 1**，实际音量全交给 gain（否则 volume×gain 双重衰减）', () => {
        expect(elementVolumeFor(0.5, true)).toBe(1);
        expect(elementVolumeFor(1.5, true)).toBe(1);
        expect(elementVolumeFor(2, true)).toBe(1);
        expect(gainValueFor(0.5, true)).toBe(0.5);
        expect(gainValueFor(1.5, true)).toBe(1.5);
        expect(gainValueFor(2, true)).toBe(2);
    });

    it('0 ⇒ 两条路径都给出「静音」的组合（元素 0 或 gain 0）', () => {
        expect(elementVolumeFor(0, false)).toBe(0);
        expect(gainValueFor(0, true)).toBe(0);
        expect(elementVolumeFor(0, true)).toBe(1); // 有增益时元素仍是 1，静音靠 gain=0
    });

    it('formatVolumePercent：读数口径只有这一处', () => {
        expect(formatVolumePercent(1)).toBe('100%');
        expect(formatVolumePercent(0)).toBe('0%');
        expect(formatVolumePercent(1.5)).toBe('150%');
        expect(formatVolumePercent(0.65)).toBe('70%');
    });

    it('🔴 反向守卫：`elementVolumeFor` **绝不**超过 1（原生 volume 写了 >1 会被静默忽略/抛错）', () => {
        for (const v of [0, 0.5, 1, 1.5, 2]) {
            expect(elementVolumeFor(v, false)).toBeLessThanOrEqual(1);
            expect(elementVolumeFor(v, true)).toBeLessThanOrEqual(1);
        }
    });
});

describe('audioVolume · 滑条着色参数（颜色随当前值渐变，不是固定位置摆异色）', () => {
    it('0%：填充段长度为 0（靠长度达成「不显示换色」），强调色占比给**下限**而非 0', () => {
        const t = volumeTint(0);
        expect(t.sat).toBe(AUDIO_VOLUME_TINT_MIN_SAT);
        expect(t.warm).toBe(100);
        expect(AUDIO_VOLUME_TINT_MIN_SAT).toBeGreaterThan(0);
    });

    it('🔴 0→100%：强调色占比**单调上升**（拖动时一路加深，不是固定色）', () => {
        const a = volumeTint(0).sat;
        const b = volumeTint(50).sat;
        const c = volumeTint(100).sat;
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
        expect(c).toBe(100);
    });

    it('≤100% 一律**不偏橙**（warm 恒 100）—— 增益色只属于 >100% 那一段', () => {
        for (const p of [0, 10, 50, 90, 100]) expect(volumeTint(p).warm).toBe(100);
    });

    it('100→200%：暖色偏移**单调加重**（100% 全强调色 ⇒ 200% 全增益色）', () => {
        expect(volumeTint(100).warm).toBe(100);
        expect(volumeTint(150).warm).toBe(50);
        expect(volumeTint(200).warm).toBe(0);
        expect(volumeTint(150).warm).toBeLessThan(volumeTint(125).warm);
    });

    it('整数输出（避免 `color-mix` 里出现 66.66666666% 这类字符串）', () => {
        for (const p of [7, 33, 47, 66, 133, 177]) {
            const t = volumeTint(p);
            expect(Number.isInteger(t.sat)).toBe(true);
            expect(Number.isInteger(t.warm)).toBe(true);
        }
    });

    it('脏值先吸附再算（与 `volumePercent` 同口径）；越界夹到 0..200', () => {
        expect(volumeTint(Number.NaN)).toEqual(volumeTint(0));
        expect(volumeTint(-50)).toEqual(volumeTint(0));
        expect(volumeTint(999)).toEqual(volumeTint(200));
        expect(volumeTint(65)).toEqual(volumeTint(70)); // 65 吸附到 70
    });

    it('🔴 反向守卫：任何输入下 sat 都在 `[MIN_SAT, 100]`、warm 都在 `[0, 100]`（CSS 拿到脏数字不会画歪）', () => {
        for (let p = 0; p <= 200; p += 10) {
            const t = volumeTint(p);
            expect(t.sat).toBeGreaterThanOrEqual(AUDIO_VOLUME_TINT_MIN_SAT);
            expect(t.sat).toBeLessThanOrEqual(100);
            expect(t.warm).toBeGreaterThanOrEqual(0);
            expect(t.warm).toBeLessThanOrEqual(100);
        }
    });
});
