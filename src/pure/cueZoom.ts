/**
 * 字幕面板 **Ctrl/⌘ + 滚轮缩放字号** 的纯逻辑（无 `obsidian` 依赖，可单测）。
 *
 * 用户逐字（m02829）：「字幕面板和字幕面板学习模式都要支持 ctrl 鼠标滚轮缩放」。
 *
 * ## 为什么只改字号、⛔ 不用 transform / zoom
 *  字幕列表是**独立滚动容器**，而整个提词器的所有定位都靠 `getBoundingClientRect` 相减：
 *    `scrollCueTo` 里 `row.getBoundingClientRect().top - list.getBoundingClientRect().top`、
 *    `lockScrollTop(tops, rowH, ...)` 用行高算锁定行位置、`positionWordTip` 用词的视口坐标。
 *  `transform: scale()` / `zoom` 会把几何盒一起放大 / 让 `rect` 读数与 CSS 像素错开 ⇒
 *    上述三处全部失准（歌词区 `pure/lyricZoom.ts` 立过同一条纪律，这次照抄结论）。
 *  ⇒ 只把比例写进 CSS 变量，字号用 `calc(基准px * var(...))` 算，行高按倍数自然跟随，
 *    布局仍是浏览器算的真值 ⇒ 跟随 / 锁定 / 气泡定位一行都不用改。
 *
 * ## 与 `pure/lyricZoom.ts` 的关系
 *  数学是同一套（吸附到步长网格 → 夹到端点 → 上滚放大），但**区间不同**：
 *  歌词区是 0.8–1.8，字幕要能放到「一屏一句」的提词器档，上限给到 2.6。
 *  ⇒ 各自一套常量，⛔ 不要为了「复用」把两边硬绑成一个模块 —— 调字幕的上限就会动到歌词。
 */

/** 缩放下限（相对基准字号的倍数）。⚠️ 必须在 `CUE_SCALE_STEP` 网格上，理由见 `clampCueScale` doc */
export const CUE_SCALE_MIN = 0.8;
/** 缩放上限（2.6 = 26×0.1，天然在网格上）。学习模式基准 16px × 2.6 ≈ 42px，足够「一屏一句」 */
export const CUE_SCALE_MAX = 2.6;
/** 每档步长（Ctrl+滚轮一格 = 一档） */
export const CUE_SCALE_STEP = 0.1;
/** 缺省比例（= 原字号，务必是 1；改了会让所有老用户升级后字号突变） */
export const CUE_SCALE_DEFAULT = 1;
/** localStorage 键（与 `rl-ap-lyric-scale` 同风格：`rl-` 前缀 + 语义名） */
export const CUE_SCALE_KEY = 'rl-epp-cue-scale';
/** 写进字幕面板根节点的 CSS 变量名 */
export const CUE_SCALE_VAR = '--rl-epp-cue-scale';

/**
 * 把任意输入夹到合法档位（非法值 ⇒ 缺省 1）。
 *
 * 🔴 **幂等契约**：`clampCueScale(clampCueScale(x)) === clampCueScale(x)`。
 *    歌词区真机踩过的反例（`pure/lyricZoom.ts` 里记着）：端点不在步长网格上时，
 *    「先吸附后夹」会让下限永远取不到 —— 用户按住 Ctrl 一直下滚，界面停住不动，
 *    更糟的是内部状态与渲染结果分叉。⇒ 两端都先按步长取整再夹。
 */
export function clampCueScale(scale: number): number {
    if (!Number.isFinite(scale)) return CUE_SCALE_DEFAULT;
    const snapped = Math.round(scale / CUE_SCALE_STEP) * CUE_SCALE_STEP;
    // 浮点乘法会留 `1.2000000000000002` 这类尾巴 ⇒ 统一到两位小数后再夹
    const clean = Math.round(snapped * 100) / 100;
    const lo = Math.round(CUE_SCALE_MIN / CUE_SCALE_STEP) * CUE_SCALE_STEP;
    const hi = Math.round(CUE_SCALE_MAX / CUE_SCALE_STEP) * CUE_SCALE_STEP;
    const out = Math.max(lo, Math.min(hi, clean));
    return Math.round(out * 100) / 100;
}

/**
 * 滚一格之后的新比例。`deltaY < 0`（**上滚**）= 放大 —— 与 `lyricScaleAfterWheel` /
 * `comicScroll.zoomAfterWheel` 同一方向约定，⛔ 别在这里反过来。
 * `deltaY === 0` 时原样返回（别白改一次触发整列表重排 + 重算滚动）。
 */
export function cueScaleAfterWheel(scale: number, deltaY: number): number {
    const cur = clampCueScale(scale);
    if (!Number.isFinite(deltaY) || deltaY === 0) return cur;
    const dir = deltaY < 0 ? 1 : -1;
    return clampCueScale(cur + dir * CUE_SCALE_STEP);
}

/** 百分比文案（`120%`），给无障碍标签 / 提示用 */
export function cueScaleLabel(scale: number): string {
    return `${Math.round(clampCueScale(scale) * 100)}%`;
}

/** 读记忆比例（localStorage 不可用 / 未存 ⇒ `null`，调用方回退缺省） */
export function loadCueScale(): number | null {
    try {
        const raw = localStorage.getItem(CUE_SCALE_KEY);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? clampCueScale(n) : null;
    } catch {
        return null;
    }
}

/** 写记忆比例（写不进就不记 —— ⛔ 别为了记住一个字号把播放视图拖崩） */
export function saveCueScale(scale: number): void {
    try {
        localStorage.setItem(CUE_SCALE_KEY, String(clampCueScale(scale)));
    } catch {
        /* 写不进就不记 */
    }
}

/**
 * 把比例落到字幕面板根节点上。
 *
 * ⚠️ 只写 CSS 变量，⛔ 不写 `style.fontSize`：普通档 13px / 学习档 16px 是**两条**规则，
 *    直接改内联字号会把学习档整条盖掉（切学习模式时字号不动，看起来像功能坏了）。
 */
export function applyCueScale(boxEl: HTMLElement, scale: number): void {
    boxEl.style.setProperty(CUE_SCALE_VAR, String(clampCueScale(scale)));
}
