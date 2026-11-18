/**
 * 六家 ASR 引擎的品牌标记（自绘 SVG 内联图形）。
 *
 * 🔴 2026-11-11 用户：「图标要用各自的品牌图标而不是一个房子图标」。
 *    实测 Obsidian 的 asar 图标库里**没有任何一家 ASR 厂商的品牌图标** ——
 *    `openai` / `chatgpt` / `qwen` / `tongyi` / `alibaba` / `whisper` / `llama` /
 *    `sherpa` / `funasr` / `huggingface` 全部搜不到（用户选择了「我画 6 个品牌 SVG 内联进去」）。
 *    ⇒ 这些不是「官方 logo」的复刻，而是**按各家技术特征画的极简标记**，用 `currentColor`
 *      随主题变色，14px 下仍可辨认。⛔ 别声称它们是官方品牌资源。
 *
 * 为什么单独成纯函数模块（而不是塞进 Settings.ts）：
 *   · 图形数据可被单测直接摸到（六家齐全、无重复、路径非空）；
 *   · Settings 侧只负责 `safeSetIcon` 之外的这一条分支，不必把字面量混进巨型 UI 文件。
 */

/** 一个标记 = 一个 viewBox + 若干条 path 的 `d`（统一 fill=none / stroke=currentColor）。 */
export interface AsrBrandMark {
    readonly viewBox: string;
    readonly d: readonly string[];
    /** 圆点等无法用 path 表达的补丁（`cx,cy,r`），可省略。 */
    readonly dots?: readonly { cx: number; cy: number; r: number }[];
}

const VB = '0 0 24 24';

/**
 * 各家标记的设计意图（每家的「技术性格」而不是商标本体）：
 * - whisper：向外扩散的三道声波弧 —— 「耳语」，也贴合它逐段解码的波形特征。
 * - qwen3：正六边形 + 中心点 —— 通义的几何感，也对应 MoE 的「多路汇聚」。
 * - sensevoice：五根等高音频柱 —— 语音信号的时域柱状图。
 * - paraformer：两条并行线收束成一条 —— 「并行（para）」转成「一条转写结果」。
 * - xasr：交叉双斜线 + 上下两道短流 —— X + 流式（streaming）切片。
 * - confucius4：摊开的书页 + 中缝 —— 这一家走「语言模型」，书卷最直白。
 */
const MARKS: Record<string, AsrBrandMark> = {
    whisper: {
        viewBox: VB,
        d: ['M6 8.5a7 7 0 0 1 0 7', 'M10 6.5a11 11 0 0 1 0 11', 'M14 4.5a15 15 0 0 1 0 15'],
    },
    qwen3: {
        viewBox: VB,
        d: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z'],
        dots: [{ cx: 12, cy: 12, r: 2 }],
    },
    sensevoice: {
        viewBox: VB,
        d: ['M4 10v4', 'M8 7v10', 'M12 4v16', 'M16 7v10', 'M20 10v4'],
    },
    paraformer: {
        viewBox: VB,
        d: ['M4 8h7l4 4h5', 'M4 16h7l4-4'],
    },
    xasr: {
        viewBox: VB,
        d: ['M7 6l10 12', 'M17 6L7 18', 'M3 12h2.5', 'M18.5 12H21'],
    },
    confucius: {
        viewBox: VB,
        d: ['M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z', 'M12 3v15'],
    },
};

/** 引擎短名（`confucius4` 也认）→ 规范化后的键；认不出给 `null`。 */
export function asrBrandKey(engine: string): string | null {
    const raw = String(engine ?? '').trim().toLowerCase();
    if (!raw) return null;
    // `confucius4` / `confucius4-r2t2` 都归到 confucius
    if (raw.startsWith('confucius')) return 'confucius';
    return Object.prototype.hasOwnProperty.call(MARKS, raw) ? raw : null;
}

/** 取某家的标记；认不出返回 `null`（调用方应退回通用图标）。 */
export function asrBrandMark(engine: string): AsrBrandMark | null {
    const key = asrBrandKey(engine);
    return key ? MARKS[key] : null;
}

/**
 * 渲染成可直接塞进 `innerHTML` 的一小段 `<svg>`。
 * ⚠️ 一律 `aria-hidden="true"` + `focusable="false"`：左侧导航项本身已有 `aria-pressed`
 *    与可读名称，图形是**装饰**，被读屏念一遍反而吵。
 */
export function asrBrandSvg(engine: string, size = 14): string {
    const m = asrBrandMark(engine);
    if (!m) return '';
    const paths = m.d.map((d) => `<path d="${d}"/>`).join('');
    const dots = (m.dots ?? []).map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`).join('');
    return (
        `<svg viewBox="${m.viewBox}" width="${size}" height="${size}" fill="none" ` +
        `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
        `aria-hidden="true" focusable="false">${paths}${dots}</svg>`
    );
}

/** 六家的键（单测用来钉「一个都不能少」）。 */
export const ASR_BRAND_KEYS: readonly string[] = ['whisper', 'qwen3', 'sensevoice', 'paraformer', 'xasr', 'confucius'];
