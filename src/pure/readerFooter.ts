// 阅读器底栏读数（纯逻辑，可单测）：TXT / EPUB / PDF 三阅读器共用同一口径。
// 口径（用户 2026-09-17 裁定）：数字恒为「已读 全书%」、进度条填充取**全书**进度；
// 页码与章内% 只走悬停提示 —— 章内% 当底数翻章会归零，与「已读」二字语义自相矛盾。
// 翻页分支曾自行显示页码 + 章内% 填充 → 同一阅读位置在两种模式下读数对不上（本次修正）。

export interface FooterReadoutInput {
    /** 是否翻页模式（仅决定悬停提示是否前置页码） */
    paged: boolean;
    /** 当前页 index（0 基；翻页模式） */
    page: number;
    /** 总页数（翻页模式；≤ 0 视为 1） */
    totalPages: number;
    /** 章内百分比（0-100） */
    chapPct: number;
    /** 全书百分比（0-100） */
    overallPct: number;
}

export interface FooterReadout {
    /** 分页器数字位文本（恒为「已读 X%」） */
    text: string;
    /** 悬停提示（翻页模式带「第 N/M 页」前缀） */
    tip: string;
    /** 进度条填充宽度（%），= 全书进度 */
    fillPct: number;
}

/** 百分比归一：四舍五入 + 钳制 [0,100]，非法值按 0 */
function normalizePct(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, Math.round(v)));
}

/** 页码文案「第 N/M 页」：总页数 ≤ 0 视为 1，页码钳制到 [1, M] */
function pageLabel(page: number, totalPages: number): string {
    const total = Math.max(1, Math.floor(Number.isFinite(totalPages) ? totalPages : 1));
    const raw = Number.isFinite(page) ? Math.floor(page) : 0;
    const p = Math.max(0, Math.min(total - 1, raw));
    return `第 ${p + 1}/${total} 页`;
}

/** 底栏读数三件套（数字 / 悬停 / 填充）：两模式数字与填充同口径，仅悬停提示不同 */
export function footerReadout(input: FooterReadoutInput): FooterReadout {
    const overall = normalizePct(input.overallPct);
    const chap = normalizePct(input.chapPct);
    const tip = input.paged
        ? `${pageLabel(input.page, input.totalPages)} · 章内 ${chap}% · 全书 ${overall}%`
        : `章内 ${chap}% · 全书 ${overall}%`;
    return { text: `已读 ${overall}%`, tip, fillPct: overall };
}
