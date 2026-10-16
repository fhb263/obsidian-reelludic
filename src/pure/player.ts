/**
 * 内置播放器纯逻辑层（无 obsidian 依赖，可单测）：时间格式化 / 进度换算 / 倍速档位 / 音量 / 快捷键映射 / 续播判定
 *
 * 为什么单独抽出来：自绘播放器里最容易出错、又最不需要 DOM 的部分就是这些换算与判定
 * （拖动进度条的越界、倍速循环、快捷键映射、续播不该一开就播完）——放进 pure 层用单测钉住，
 * UI 层只做「读 DOM → 调纯函数 → 写 DOM」。
 */

/** 方向键单步秒数（←/→） */
export const SEEK_STEP = 5;
/** 方向键大步秒数（Shift + ←/→） */
export const SEEK_STEP_LARGE = 30;
/** 倍速档位（循环切换，含 1× 基准） */
export const SPEED_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** 快捷键语义（UI 层按此分派，键盘细节不外泄） */
export type PlayerKeyAction =
    | 'toggle'
    | 'seek:-5'
    | 'seek:5'
    | 'seek:-30'
    | 'seek:30'
    | 'volume:up'
    | 'volume:down'
    | 'mute'
    | 'fullscreen'
    /** 插入时间戳链接（#326；裸 `t` —— 与 m/f 同款「无修饰键」风格，零热键冲突） */
    | 'stamp'
    /** 截取当前帧（#326；裸 `s`） */
    | 'shot';

/** 秒 → `m:ss`（满 1 小时 `h:mm:ss`）；非法/负值/NaN → `0:00` */
export function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 目标时间夹进 0..duration（duration 未知/0 时只保下界，避免 seek(0) 把播放掐回开头） */
export function clampSeek(seconds: number, duration: number): number {
    const s = Number.isFinite(seconds) ? seconds : 0;
    if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, s);
    return Math.max(0, Math.min(duration, s));
}

/** 进度比例 → 秒（未知时长返回 0，绝不产生 NaN） */
export function ratioToSeconds(ratio: number, duration: number): number {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const r = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    return r * duration;
}

/** 秒 → 进度比例（未知时长返回 0） */
export function secondsToRatio(seconds: number, duration: number): number {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    return Math.max(0, Math.min(1, s / duration));
}

/** 倍速文案（1 → `1×`、1.25 → `1.25×`；非法归 1×） */
export function formatSpeed(v: number): string {
    const s = Number.isFinite(v) ? Math.round(v * 100) / 100 : 1;
    return `${s}×`;
}

/** 音量夹进 0..1（NaN → 0，用于「静音」判定基准） */
export function clampVolume(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

/** 键盘事件 → 语义动作；未映射（含 Esc / Enter）返回 null 交回宿主（Esc 由 Modal 关闭） */
export function resolveKeyAction(key: string, shift: boolean): PlayerKeyAction | null {
    switch (key) {
        case ' ':
        case 'Space':
            return 'toggle';
        case 'ArrowLeft':
            return shift ? 'seek:-30' : 'seek:-5';
        case 'ArrowRight':
            return shift ? 'seek:30' : 'seek:5';
        case 'ArrowUp':
            return 'volume:up';
        case 'ArrowDown':
            return 'volume:down';
        case 'm':
        case 'M':
            return 'mute';
        case 'f':
        case 'F':
            return 'fullscreen';
        case 't':
        case 'T':
            return 'stamp';
        case 's':
        case 'S':
            return 'shot';
        default:
            return null;
    }
}

/**
 * 是否续播上次位置：太靠前（<5s，多半只是点开看了眼）不续；
 * 距结尾 <10s 也不续（否则一开就播完，用户还以为播放器坏了）。时长未知时不续。
 */
export function shouldResume(seconds: number, duration: number): boolean {
    if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return false;
    if (seconds < 5) return false;
    return duration - seconds > 10;
}

/** 连播倒计时文案（0/负 → 即将播放） */
export function nextEpisodeText(countdown: number): string {
    const n = Math.floor(Number.isFinite(countdown) ? countdown : 0);
    return n > 0 ? `${n} 秒后播放下一集` : '即将播放下一集';
}

/** 进度条悬停预览文案：`落点 / 总长`（用户 2026-09-18：只给落点看不出还剩多久） */
export function hoverTipText(hoverSec: number, durationSec: number): string {
    return `${formatTime(hoverSec)} / ${formatTime(durationSec)}`;
}

/**
 * 集标签（纯展示）：剧集 = 「第 N 集 · 集标题」（无集标题则只有「第 N 集」）；电影 / 单文件 = 集标题本身。
 * 2026-09-18 从 VideoPlayerView 下沉：顶栏标题与「选集」浮层**共用同一份** ——
 * 两处各写一遍必然漂，而「第 N 集」正是产物断言的锚点。
 */
export function episodeLabel(item: { index: number; title?: string }, single: boolean): string {
    if (single) return item.title ?? '';
    return `第 ${item.index + 1} 集${item.title ? ` · ${item.title}` : ''}`;
}
