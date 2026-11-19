// 下载速度采样（🔴 用户 m10754：「语音转文字的下载模型的进度浮球有没有同样的逻辑，如标 1MB/s 速度」）
//
// 为什么单独一个纯模块，而不是各家下载器里各算一遍：
//   · 三条链路给的东西不一样 ——
//       `services/asrModelDownload` 直接给 `(percent, received, total)` 字节数；
//       `services/whisperRuntime` 只给 `(percent, label)`；
//       `services/asrBundleInstall` 给的是**整包加权**百分比。
//     只有把它降级成「统一喂 (已下载字节, 时间戳)」才可能口径一致 ——
//     否则同一张清单上「程序 1.2MB/s、模型 12.1MB/s」两行读数会来自两套不同算法。
//   · 速度是**导数**，必须带时间。放在纯模块里就能用假时钟单测，
//     ⛔ 不要在 UI 层 `Date.now()` 到处取（那种代码没法测、也没法解释为什么跳）。
//
// 🔴 三条硬口径（都是实测踩出来的，别改）：
//   ⑴ **首个样本不出速度**（`null`）：只有一个点算不出斜率，返回 0 会让界面先亮一个假的「0 B/s」。
//   ⑵ **窗口太短不出速度**：不到 `SPEED_MIN_WINDOW_MS` 的两次采样波动极大（一块 64KB 的包
//      摊到 30ms 上就是 2MB/s，下一个包没来立刻掉成 0）⇒ 短窗口只更新基线、不报数。
//   ⑶ **指数平滑**：真实网速本来就抖，直接报瞬时值会让读数每秒跳三次。
//      但平滑**不能盖住「停了」**—— 见 ⑷。
//   ⑷ **长时间没有新字节 ⇒ 速度归 0**：`SPEED_STALE_MS` 内没有样本时 `sample()` 返回 0，
//      否则卡住的下载会一直显示上一次的 1.2 MB/s，用户以为还在动。

import { formatSpeedBytes } from 'pure/progressTasks';

/** 两次采样间隔小于这个值就不出速度（只更新基线） */
export const SPEED_MIN_WINDOW_MS = 400;

/** 超过这个时长没有新样本 ⇒ 判定「停了」，速度归 0 */
export const SPEED_STALE_MS = 4000;

/** 指数平滑系数（新样本占的权重）。0.35 ≈ 三四拍就跟上，又不会一惊一乍 */
export const SPEED_SMOOTHING = 0.35;

/** 速度读数的最小值：低于 1 B/s 一律当 0（浮点残渣会让界面闪 `0.0 B/s`） */
const SPEED_EPSILON = 1;

export interface SpeedMeter {
    /**
     * 喂一个累计进度样本，返回**平滑后的字节/秒**。
     *
     * @param doneBytes 累计已下载字节（⛔ 不是增量）
     * @param at        采样时刻（毫秒）；默认用模块内时钟
     * @returns `null` = 还没有足够信息（首个样本 / 窗口太短）；`0` = 确实停了；`>0` = 速度
     */
    sample(doneBytes: number, at?: number): number | null;
    /** 当前平滑值（不喂新样本，用于「刷新一下界面」时读上次结果） */
    rate(): number | null;
    /** 清零（换源、续传重开、换文件时都该调 —— 否则会把上一个文件的斜率接过来） */
    reset(): void;
}

interface MeterState {
    lastBytes: number;
    lastAt: number;
    smoothed: number | null;
    lastEmitAt: number;
    hasSample: boolean;
}

/**
 * 造一个速率计。`now` 可注入（单测用假时钟）。
 *
 * ⚠️ 每个**文件**一个实例，⛔ 不要全局共用一个：清单里第 1 项刚下完 5MB、
 *    第 2 项从 0 开始，共用一个实例会算出「负速度」再被夹成 0，白丢一拍。
 */
export function createSpeedMeter(now: () => number = () => Date.now()): SpeedMeter {
    const state: MeterState = {
        lastBytes: 0,
        lastAt: 0,
        smoothed: null,
        lastEmitAt: 0,
        hasSample: false,
    };

    return {
        sample(doneBytes: number, at?: number): number | null {
            const t = Number.isFinite(at) ? Number(at) : now();
            const bytes = Number.isFinite(doneBytes) ? Math.max(0, doneBytes) : 0;

            // ⑴ 首个样本：只立基线
            if (!state.hasSample) {
                state.hasSample = true;
                state.lastBytes = bytes;
                state.lastAt = t;
                state.lastEmitAt = t;
                return null;
            }

            const dt = t - state.lastAt;
            const db = bytes - state.lastBytes;

            // ⑷ 长时间没动静 ⇒ 归 0（不能留着上次的读数骗人）
            if (dt > SPEED_STALE_MS) {
                state.lastBytes = bytes;
                state.lastAt = t;
                state.lastEmitAt = t;
                state.smoothed = 0;
                return 0;
            }

            // ⑵ 窗口太短：只更新基线，不报数
            if (dt < SPEED_MIN_WINDOW_MS) {
                // 字节没涨就原地等（保持基线，让下一个足够长的窗口能算对）
                if (db > 0) {
                    state.lastBytes = bytes;
                    state.lastAt = t;
                }
                return state.smoothed;
            }

            // 进度回退（换源重下 / 分片重算）⇒ 当重来，不产生负速度
            if (db < 0) {
                state.lastBytes = bytes;
                state.lastAt = t;
                state.smoothed = null;
                return null;
            }

            const instant = (db / dt) * 1000;
            state.lastBytes = bytes;
            state.lastAt = t;
            state.lastEmitAt = t;
            // ⑶ 指数平滑；首个有效值直接采用（否则要好几拍才爬到真值）
            state.smoothed =
                state.smoothed === null || state.smoothed <= 0
                    ? instant
                    : state.smoothed + (instant - state.smoothed) * SPEED_SMOOTHING;
            return state.smoothed < SPEED_EPSILON ? 0 : state.smoothed;
        },

        rate(): number | null {
            if (!state.hasSample) return null;
            // ⑷ 读的时候也判一次「停了」：界面定时重画也能看出卡住
            if (now() - state.lastEmitAt > SPEED_STALE_MS) return 0;
            return state.smoothed;
        },

        reset(): void {
            state.lastBytes = 0;
            state.lastAt = 0;
            state.smoothed = null;
            state.lastEmitAt = 0;
            state.hasSample = false;
        },
    };
}

/**
 * 把「体积文案」解析成字节数（`74 MB` / `1.5 GB` / `465MB` / `5.3MB` 都认）。
 *
 * 与 `modals/AsrInstallModal.ts` 里那个私有 `bytesOf` 是**同一套口径**，但那个只服务于
 * 「合计多少」这一行；本函数给速率换算用，所以放在纯模块里让两边都能引。
 * 解析不出来返回 `null`（⛔ 不返回 0 —— 「不知道多大」与「0 字节」必须能分开）。
 */
export function parseSizeLabel(text: string | undefined): number | null {
    if (typeof text !== 'string') return null;
    const m = /([\d.]+)\s*(GB|MB|KB|B)\b/i.exec(text);
    if (!m) return null;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    const unit = m[2].toUpperCase();
    const mul = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : unit === 'KB' ? 1024 : 1;
    return Math.round(n * mul);
}

/**
 * 百分比 → 已下载字节。总字节未知时返回 `null`（调用方据此不显示速度）。
 *
 * ⚠️ `percent` 允许 `null`（下载器在拿不到 `content-length` 时会这么报）⇒ 原样 `null`。
 */
export function percentToBytes(percent: number | null | undefined, totalBytes: number | null | undefined): number | null {
    if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
    if (totalBytes === null || totalBytes === undefined || !Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const pct = Math.max(0, Math.min(100, percent));
    return Math.round((pct / 100) * totalBytes);
}

/**
 * 一组文本 → 「 · 1.2 MB/s」后缀。取 0 / null 时返回空串（⛔ 不返回 ` · 0 B/s`）。
 *
 * 存在理由：三条链路的进度回调签名都不能改（`DownloadProgressCallback` /
 * `InstallProgress` / `InstallProgressCallback` 各有十几处消费方），
 * 所以速度只能拼在 `label` 尾段 —— 消费端用 `splitLabelSpeed()` 拆回来。
 */
export function speedSuffix(bytesPerSec: number | null | undefined): string {
    if (bytesPerSec === null || bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
        return '';
    }
    const text = formatSpeedBytes(bytesPerSec);
    return text ? ` · ${text}` : '';
}
