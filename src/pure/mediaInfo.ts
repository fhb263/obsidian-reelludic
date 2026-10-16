/**
 * 本地媒体（音频）的「时长 / 体积」展示口径（**纯逻辑**，2026-10-01 #462）—— 无 obsidian / 无 DOM，可单测。
 *
 * 用途：音乐条目编辑表单里那颗「播放」按钮的悬停提示 —— 用户原话：
 *   「给音乐类型关联到的音频文件鼠标hover提示音频文件时长：如04:25,和体积大小3MB」。
 *
 * 🔴 两条口径：
 *  ⑴ **拿不到就不显示那一段**（⛔ 绝不编造 / 不写「未知」）：时长要解码才知道（Chromium `<audio>`），
 *     体积要读文件（桌面端 `fs.statSync`）；任一失败就只显示另一项，两项都没有 ⇒ 整行空串（调用方别拼）。
 *  ⑵ **单位用 KiB 口径（1024 进制）**，与系统文件管理器/其它工具一致；整数不留 `.0`（`3 MB` 而不是 `3.0 MB`）。
 */

/** 一次音频探测的结果（宿主 `main.probeAudioInfo` 产出；两项都可缺 —— 拿不到就不显示那一段） */
export interface MediaInfo {
    /** 文件体积（字节） */
    size?: number;
    /** 时长（秒） */
    duration?: number;
}

/**
 * 秒 → `mm:ss`（≥1 小时 → `h:mm:ss`；分钟在小时制里不补零：`1:02:03`）。
 * 非有限值 / 负数 / 0 ⇒ `''`（0 秒 = 没探到，按「拿不到」处理）。
 * @param seconds 秒（小数四舍五入到整秒）
 */
export function formatDuration(seconds: number | undefined): string {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return '';
    const total = Math.round(n);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${String(m).padStart(2, '0')}:${ss}`;
}

/**
 * 字节 → 可读体积（`3 MB` / `3.2 MB` / `812 KB` / `1.4 GB`）。
 * 非有限值 / 负数 ⇒ `''`；`0` ⇒ `0 B`（真的是空文件，如实说）。
 * 规则：1024 进制；<1024 显示 `N B`（整数）；其余保留 1 位小数（整数不留 `.0`）。
 */
export function formatFileSize(bytes: number | undefined): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${Math.round(n)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    const rounded = Math.round(v * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded} ${units[i]}`;
}

/**
 * 「时长 · 体积」一行（如 `04:25 · 3.2 MB`）。
 * 拿不到的那项**省略**（⛔ 不留 `·`、不写占位）；两项都没有 ⇒ `''`（调用方据此整行不加）。
 */
export function mediaInfoLine(size: number | undefined, duration: number | undefined): string {
    const parts = [formatDuration(duration), formatFileSize(size)].filter((s) => !!s);
    return parts.join(' · ');
}
