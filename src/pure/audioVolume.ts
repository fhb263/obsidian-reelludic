/**
 * 音频播放器的**音量标度**（0–200%，每 10% 一档）—— 纯逻辑，无 `obsidian` / DOM 依赖，可单测。
 *
 * ## 为什么要单开一个模块（而不是继续用 `pure/player.clampVolume`）
 *
 * `clampVolume`（`pure/player.ts`）是**视频播放器**的标度：`0..1`，因为原生 `<audio>/<video>`
 * 的 `volume` 上限就是 1。用户 2026-09-27 明确要求音频这边**可为 0%–200%、每 10% 递增一档**
 * （与 LyricFlux 一致）⇒ 超过 100% 的那一段**只能靠增益**（`GainNode`），标度也就不是同一个了。
 * ⚠️ 两者**都保留**：视频侧照旧 `clampVolume`，⛔ 别把视频也改成 0..2（那会悄悄改变视频音量语义）。
 *
 * ## 两条口径
 *
 * 1. **一律吸附到 10% 的整数档**（读数 / 滑条 / 落库值三者永远一致）——
 *    否则会出现「读数写 65%、滑条停在 70%」这种自相矛盾；老设置里的 `0.65` 会在首次保存时归一成 `0.7`。
 * 2. **非有限值 ⇒ 0**（与 `clampVolume` 同口径）。⚠️ 调用方要先 `?? 1` 兜住「字段缺失」，
 *    别让「没配过」变成「静音」。
 */

/** 音量上限 = 200%（超过 100% 需要增益） */
export const AUDIO_VOLUME_MAX = 2;
/** 每档 10% */
export const AUDIO_VOLUME_STEP_PCT = 10;
/** 超过这个值就必须走增益（原生 `volume` 封顶 1） */
export const AUDIO_GAIN_THRESHOLD = 1;

/** 夹到 `0..2`；非有限值 ⇒ `0`（与 `pure/player.clampVolume` 同口径） */
export function clampAudioVolume(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(AUDIO_VOLUME_MAX, n));
}

/**
 * 内部值（0..2）→ **整数百分比**（`0..200`），并**吸附到 10 的倍数**。
 * 例：`0.65 → 70`（65 四舍五入到最近的十位）、`1 → 100`、`2 → 200`。
 */
export function volumePercent(v: unknown): number {
    const pct = clampAudioVolume(v) * 100;
    const snapped = Math.round(pct / AUDIO_VOLUME_STEP_PCT) * AUDIO_VOLUME_STEP_PCT;
    return Math.max(0, Math.min(AUDIO_VOLUME_MAX * 100, snapped));
}

/** 整数百分比（`0..200`）→ 内部值（`0..2`）；脏值先吸附再夹（不会出现 65.7% 这种中间态） */
export function volumeFromPercent(pct: unknown): number {
    const raw = typeof pct === 'number' ? pct : Number(pct);
    if (!Number.isFinite(raw)) return 0;
    const snapped = Math.round(raw / AUDIO_VOLUME_STEP_PCT) * AUDIO_VOLUME_STEP_PCT;
    return clampAudioVolume(snapped / 100);
}

/** 是否需要增益（> 100%）。`false` 时走原生 `volume`（质量更好、无 WebAudio 依赖） */
export function needsGain(v: unknown): boolean {
    return clampAudioVolume(v) > AUDIO_GAIN_THRESHOLD;
}

/**
 * **无增益**路径下写进元素的 `volume`（原生上限 1，故 150% 只能写 1 —— 少了的那截由增益补）。
 * ⚠️ 有增益时元素 `volume` 固定写 `1`（不写实际值）：`volume` 与 `gain` 会**相乘**，
 *    两个都压会导致「设 50% 听成 25%」（LyricFlux 的注释也点了这一条）。
 */
export function elementVolumeFor(v: unknown, gainActive: boolean): number {
    const vol = clampAudioVolume(v);
    if (gainActive) return 1;
    return Math.min(1, vol);
}

/** **有增益**路径下写进 `GainNode.gain` 的值（0..2）；无增益时固定 1（⛔ 别写实际值，见上） */
export function gainValueFor(v: unknown, gainActive: boolean): number {
    return gainActive ? clampAudioVolume(v) : 1;
}

/** 音量读数（`0%` / `100%` / `150%`）—— UI 只认这一处口径 */
export function formatVolumePercent(v: unknown): string {
    return `${volumePercent(v)}%`;
}

/**
 * 音量滑条的**着色参数**（用户 2026-09-27 第二轮改判）——
 * 「0% 时不显示段换色，**从 0 到 100% 过程逐渐变色**，不是一开始就固定色在那」。
 *
 * ⇒ 颜色是**当前值的函数**（拖动时一路变），不是「在固定位置摆一段异色」。两段：
 * - **0 → 100%**：强调色占比从 `AUDIO_VOLUME_TINT_MIN_SAT` 线性升到 **100%**（低音量淡、越推越实）；
 * - **100 → 200%**：在此基础上再把颜色按比例**偏向增益色**（`warm` 从 100% 降到 0%）。
 *
 * 🔴 为什么 0% 不给 0：滑块（thumb）与轨道用同一个当前色 ⇒ 占比真给 0 会让滑块与轨道**同色而「消失」**。
 *    0% 时本来就没有填充段，所以「0% 不显示换色」是靠**长度为 0** 达成的，⛔ 不靠把颜色变没。
 */
export const AUDIO_VOLUME_TINT_MIN_SAT = 30;

export interface VolumeTint {
    /** 强调色占比（%）：`AUDIO_VOLUME_TINT_MIN_SAT..100` —— 与 `--background-primary` 混合得到「淡 → 实」 */
    sat: number;
    /** 保持「基数色」的占比（%）：`100..0` —— 与增益色混合得到「强调色 → 橙」；**≤100% 时恒 100（不偏橙）** */
    warm: number;
}

/** 由音量百分比（0–200）算出滑条着色参数（纯函数，供 CSS 的 `color-mix` 两个变量用） */
export function volumeTint(pct: unknown): VolumeTint {
    const p = volumePercent(volumeFromPercent(pct));
    if (p <= 100) {
        const sat = AUDIO_VOLUME_TINT_MIN_SAT + (p / 100) * (100 - AUDIO_VOLUME_TINT_MIN_SAT);
        return { sat: Math.round(sat), warm: 100 };
    }
    return { sat: 100, warm: Math.round(100 - (p - 100)) };
}
