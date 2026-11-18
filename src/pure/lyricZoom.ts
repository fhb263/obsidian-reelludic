/**
 * 🔴 m04435 ③：音乐播放器**歌词区 Ctrl+滚轮缩放**的纯逻辑（无 `obsidian` 依赖，可单测）。
 *
 * 用户逐字：「歌词区域内 **Ctrl+鼠标滚轮**缩放歌词字号/比例：
 *   - 阻止页面默认缩放/滚动；仅作用于歌词容器，不影响其他 UI；不影响歌词正常播放滚动」
 *
 * ## 为什么只做「字号比例」而不是容器 zoom
 *  - `transform: scale()` / `zoom` 会把歌词行的**几何盒**一起放大 ⇒ `centerCurLine` 用来
 *    「把当前行推到垂直正中」的 `getBoundingClientRect` 全部偏移，滚动会越缩越歪；
 *  - 只改 `font-size` 比例（写进 CSS 变量 `--rl-ap-lyric-scale`）时，行高按 `em` 自然跟随，
 *    布局仍是浏览器算的真值 ⇒ 自动滚动逻辑一行都不用动。用户要的是「缩放歌词字号/比例」，
 *    这条口径正好落在字面上。
 *
 * ## 两条边界（都是本仓踩过的坑）
 *  ⑴ **不跨档吸附**：直接按 step 取整，`1.1/1.15` 这类残值会让「上滚一次再下滚一次」回不到原点；
 *  ⑵ **夹在区间内**：没有上限时一路放大会把一行歌词撑成整屏、把当前行推走。
 */

/**
 * 缩放下限（相对基准字号的倍数）。
 *
 * 🔴 真机实测（m04435 技术债）：这里**必须落在 `LYRIC_SCALE_STEP` 的网格上**。
 *    原先写 0.75（不在 0.1 网格上）⇒ `clampLyricScale` 先按步长吸附把 0.75 吸成 0.8，
 *    再去夹 ⇒ **下限永远到不了**：用户按住 Ctrl 一直下滚，界面停在 0.8 纹丝不动。
 *    更隐蔽的是「内部状态 0.75、渲染却被吸回 0.8」⇒ 状态与画面分叉（`applyLyricScale` 也会再夹一次）。
 *    ⇒ 取网格上最近的合法档 0.8，并让 `clampLyricScale` 在边界上**幂等**（见其 doc + 单测）。
 */
export const LYRIC_SCALE_MIN = 0.8;
/** 缩放上限（同样必须在步长网格上，理由同上；1.8 天然是 18×0.1） */
export const LYRIC_SCALE_MAX = 1.8;
/** 每档步长（Ctrl+滚轮一格 = 一档） */
export const LYRIC_SCALE_STEP = 0.1;
/** 缺省比例（= 原字号，务必是 1） */
export const LYRIC_SCALE_DEFAULT = 1;
/** localStorage 键（与 `readerToc` 的 `rl-reader-toc-width` 同风格：`rl-` 前缀 + 语义名） */
export const LYRIC_SCALE_KEY = 'rl-ap-lyric-scale';
/** 写进容器的 CSS 变量名 */
export const LYRIC_SCALE_VAR = '--rl-ap-lyric-scale';

/**
 * 把任意输入夹到合法档位（非法值 ⇒ 缺省 1）。⚠️ 也会按 step 吸附，别拿它保留手工残值。
 *
 * 🔴 **幂等契约**：任何 `clampLyricScale(clampLyricScale(x)) === clampLyricScale(x)`。
 *    真机踩过反例：当 `LYRIC_SCALE_MIN` 不在 step 网格上时，「吸附 → 夹」的顺序会让
 *    下限永远取不到（用户按 Ctrl 一直下滚，停在 0.8 不动），且内部状态与渲染结果分叉。
 *    ⇒ 现在先吸附、再把**吸附后**的值夹到区间；区间端点自身必须在网格上（见上面常量 doc），
 *    单测 `tests/lyricZoom.test.ts` 用「连续下滚 40 次停在 MIN」+「clamp 幂等」钉住。
 */
export function clampLyricScale(scale: number): number {
    if (!Number.isFinite(scale)) return LYRIC_SCALE_DEFAULT;
    const snapped = Math.round(scale / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP;
    // 浮点乘法会留 `1.2000000000000002` 这类尾巴 ⇒ 统一到两位小数后再夹
    const clean = Math.round(snapped * 100) / 100;
    // 两端都先在网格上取整，避免「夹到网格外的端点 ⇒ 下次吸附又跑掉」
    const lo = Math.round(LYRIC_SCALE_MIN / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP;
    const hi = Math.round(LYRIC_SCALE_MAX / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP;
    const out = Math.max(lo, Math.min(hi, clean));
    return Math.round(out * 100) / 100;
}

/**
 * 滚一格之后的新比例。`deltaY < 0`（**上滚**）= 放大 —— 与 `pure/comicScroll.zoomAfterWheel`
 * 同一方向约定，⛔ 别在这里反过来（同一手势在漫画里放大、在歌词里缩小会让人怀疑人生）。
 * `deltaY === 0` 时原样返回（别白改一次触发重排）。
 */
export function lyricScaleAfterWheel(scale: number, deltaY: number): number {
    const cur = clampLyricScale(scale);
    if (!Number.isFinite(deltaY) || deltaY === 0) return cur;
    const dir = deltaY < 0 ? 1 : -1;
    return clampLyricScale(cur + dir * LYRIC_SCALE_STEP);
}

/** 百分比文案（`120%`），给提示 / 无障碍标签用 */
export function lyricScaleLabel(scale: number): string {
    return `${Math.round(clampLyricScale(scale) * 100)}%`;
}

/** 读记忆比例（localStorage 不可用 / 未存 ⇒ `null`，调用方回退缺省） */
export function loadLyricScale(): number | null {
    try {
        const raw = localStorage.getItem(LYRIC_SCALE_KEY);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? clampLyricScale(n) : null;
    } catch {
        return null;
    }
}

/** 写记忆比例（写不进就不记 —— ⛔ 别为了记住一个字号把播放器拖崩） */
export function saveLyricScale(scale: number): void {
    try {
        localStorage.setItem(LYRIC_SCALE_KEY, String(clampLyricScale(scale)));
    } catch {
        /* 写不进就不记 */
    }
}

/** 把比例落到容器上（只动 CSS 变量，⛔ 不写 `style.fontSize` —— 那会盖掉档位样式表里的字号） */
export function applyLyricScale(lyricsEl: HTMLElement, scale: number): void {
    lyricsEl.style.setProperty(LYRIC_SCALE_VAR, String(clampLyricScale(scale)));
}
