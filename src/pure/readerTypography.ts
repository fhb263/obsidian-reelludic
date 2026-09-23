// 阅读排版词表（#351）：**分段控制器的选项真源** + 字体 / 字重 / 字距 的归一化与 CSS 值产出。
//
// 为什么独立成模块：设置面板在 TXT / EPUB 两个阅读器各建一遍，选项文案与取值若各写一份必然漂移
// （历史上「模式 / 行宽」两行就是这么两份）；这里收敛成一份，两个阅读器只负责渲染。
//
// ⚠️ 取值（`value`）是**持久化契约**（写进插件 settings 的 data.json）：
//    ⛔ 不要改已有取值（旧数据读不回），只允许**新增**；标签（`label`）可以随用户口径调整。

import type { HlColor, HlStyle } from 'pure/highlight';

export type ReaderFontFamily = 'default' | 'serif' | 'sans' | 'mono';
export type ReaderFontWeight = 'normal' | 'bold';

/**
 * 阅读器 → 宿主的**排版设置载荷**（#351）：两个阅读器与 `main.ts` 共用这一份形状。
 * 🔴 为什么收敛：以前 `settings` / `onSettingsChange` 的字段在 TXT、EPUB、main.ts 各写一遍，
 *    每加一个排版项就要改三处 —— 漏一处就是「调了没记住」这种最难查的静默 bug。
 * ⚠️ 除 `fontSize` / `lineHeight` 外全部可选：**缺省 = 本次不动这一项**
 *    （字号滑条拖动不该顺手把字距写回旧值）。高亮两项是历史字段（同一回调顺带带回写）。
 */
export interface ReaderTypoPayload {
    fontSize: number;
    lineHeight: number;
    indent?: boolean;
    fontFamily?: ReaderFontFamily;
    fontWeight?: ReaderFontWeight;
    letterSpacing?: number;
    hlStyle?: HlStyle;
    hlColor?: HlColor;
}

/** 分段控制器的一段：`value` 落库、`label` 上屏、`tip` 悬停提示 */
export interface SegOption<T> {
    value: T;
    label: string;
    tip?: string;
}

/** 字体（#351 新增设置）：`default` = 跟随宿主/主题，不写 font-family */
export const FONT_FAMILY_OPTIONS: readonly SegOption<ReaderFontFamily>[] = [
    // #351e 用户口径：标签由「系统默认」收成「默认」（这一行改成纯字变色切换后，四项要能在一行里排下）
    { value: 'default', label: '默认', tip: '跟随 Obsidian 当前字体' },
    { value: 'sans', label: '无衬线', tip: '黑体类，屏幕阅读更利落' },
    { value: 'serif', label: '衬线', tip: '宋体/Georgia 类，长文更省力' },
    { value: 'mono', label: '等宽', tip: '等宽字体，对齐感强' },
];

/**
 * 字重（#351 新增设置；#351b 按用户口径**删除「中等」**）：常规 400 / 粗体 700。
 * ⚠️ 删除选项**不需要迁移** —— 旧数据里存的 `'medium'` 会被 `normalizeFontWeight` 兜回 `'normal'`
 *    （判定用的是「在不在词表里」，不是「是不是已知字符串」）；`fontWeightCss` 的 600 分支一并退场。
 */
export const FONT_WEIGHT_OPTIONS: readonly SegOption<ReaderFontWeight>[] = [
    { value: 'normal', label: '常规', tip: '正文字重 400' },
    { value: 'bold', label: '粗体', tip: '正文字重 700' },
];

/** 阅读模式（既有设置）：滚动 / 翻页 */
export const SCROLL_OPTIONS: readonly SegOption<string>[] = [
    { value: 'continuous', label: '滚动', tip: '上下滚动阅读' },
    { value: 'paged', label: '翻页', tip: '按屏翻页（每页一屏宽）' },
];

/** 行宽（既有设置）：`strict` 的**标签**按用户口径改为「适中」（取值不动，旧数据照旧读） */
export const WIDTH_OPTIONS: readonly SegOption<string>[] = [
    { value: 'strict', label: '适中', tip: '固定版心（阅读更聚焦）' },
    { value: 'full', label: '全宽', tip: '正文铺满可用宽度' },
];

/** 段落缩进（既有设置 `indent`）；用户口径顺序 = 首行｜齐头 */
export const INDENT_OPTIONS: readonly SegOption<boolean>[] = [
    { value: true, label: '首行', tip: '每段首行缩进 2 字' },
    { value: false, label: '齐头', tip: '段首不缩进' },
];

// ── 字距（#351 新增设置）──
export const LETTER_MIN = -0.02;
export const LETTER_MAX = 0.12;
export const LETTER_STEP = 0.01;
export const LETTER_DEFAULT = 0;

export function normalizeFontFamily(v: unknown): ReaderFontFamily {
    return FONT_FAMILY_OPTIONS.some((o) => o.value === v) ? (v as ReaderFontFamily) : 'default';
}

export function normalizeFontWeight(v: unknown): ReaderFontWeight {
    return FONT_WEIGHT_OPTIONS.some((o) => o.value === v) ? (v as ReaderFontWeight) : 'normal';
}

/** 字距归一：非有限数（含字符串 "0.03em" 这种旧数据）→ 默认；越界夹取；按步长取整 */
export function normalizeLetterSpacing(v: unknown): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return LETTER_DEFAULT;
    const clamped = Math.min(LETTER_MAX, Math.max(LETTER_MIN, v));
    return Math.round(clamped / LETTER_STEP) * LETTER_STEP;
}

/** 字体族 CSS 值：`default` → 空串（**清掉**内联 font-family，交回宿主/主题） */
export function fontFamilyCss(v: ReaderFontFamily): string {
    switch (v) {
        case 'serif':
            return "Georgia, 'Songti SC', 'Noto Serif SC', serif";
        case 'sans':
            return "-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
        case 'mono':
            return "'JetBrains Mono', Consolas, 'Courier New', monospace";
        default:
            return '';
    }
}

export function fontWeightCss(v: ReaderFontWeight): number {
    return v === 'bold' ? 700 : 400;
}

/** 字距显示：0 → `0em`，否则保留两位小数（0.1 → `0.1em`，不带尾零） */
export function formatLetterSpacing(v: number): string {
    const n = normalizeLetterSpacing(v);
    if (n === 0) return '0em';
    return `${Number(n.toFixed(2))}em`;
}
