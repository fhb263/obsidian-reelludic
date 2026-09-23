// 摘抄就地卡片纯逻辑（无 obsidian / 无 DOM，可单测）——阅读器内划词后就地写摘抄用。
// 设计口径（用户 2026-09-17 裁定 C 方案）：划词即弹**就地小卡**（不打断阅读），
// 卡片含「添加摘抄」标题 + 摘自《书名》· 第 N 章 · P% 信息行 + 引用（默认收起）+ 想法（3 行）+ 保存。

/** 引用块默认收起阈值：超过此字数才显示「展开」（收起态由 CSS 限高，这里只决定按钮是否出现） */
export const QUOTE_EXPAND_THRESHOLD = 80;

/** 引用是否需要「展开」按钮（按去空白后的字数判定：选区常带换行与缩进） */
export function needsQuoteExpand(quote: string, threshold: number = QUOTE_EXPAND_THRESHOLD): boolean {
    return quote.trim().length > threshold;
}

/** 卡片内键盘动作：Ctrl/⌘+Enter 提交，其余（含单独 Enter、Shift+Enter）留给换行 */
export type ExcerptCardKey = 'submit' | 'ignore';

/**
 * 键盘分派（纯函数，便于锁定输入法边界）。
 * 口径（用户 2026-09-17 二次裁定）：**Ctrl / ⌘ + Enter 保存**，单独 Enter 与 Shift+Enter 都换行
 * —— 想法多为多行，Enter 必须留给换行；保存靠组合键。
 * 🔴 组合态必须忽略：中文输入法选词的 Enter（`isComposing` 或 keyCode 229）不是任何命令。
 */
export function excerptCardKeyAction(ev: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    composing?: boolean;
}): ExcerptCardKey {
    if (ev.composing) return 'ignore';
    if (ev.key !== 'Enter') return 'ignore';
    return ev.ctrlKey || ev.metaKey ? 'submit' : 'ignore';
}

/** 信息行文案：「摘自《书名》· 第 N 章 · P%」（无定位/无百分比时逐级省略，不留分隔符残渣） */
export function excerptCardLocLabel(title: string, loc?: { chapter: number; pct: number }): string {
    const name = title.trim() || '作品名称';
    const book = `摘自《${name}》`;
    if (!loc || !Number.isFinite(loc.chapter) || loc.chapter <= 0) return book;
    const pct = Number.isFinite(loc.pct) && loc.pct > 0 ? ` · ${Math.round(loc.pct)}%` : '';
    return `${book} · 第 ${Math.floor(loc.chapter)} 章${pct}`;
}

/** 就地浮层落位：水平居中于锚点、优先贴其上方，放不下转下方，四周钳制不出容器（宿主局部坐标） */
export function placeCard(input: {
    /** 锚点（容器局部坐标，通常为鼠标位置） */
    anchorX: number;
    anchorY: number;
    /** 卡片尺寸 */
    cardW: number;
    cardH: number;
    /** 容器尺寸 */
    boxW: number;
    boxH: number;
    /** 锚点与卡片间距（缺省 8） */
    gap?: number;
    /** 容器内边距（缺省 4） */
    margin?: number;
}): { left: number; top: number } {
    const gap = input.gap ?? 8;
    const m = input.margin ?? 4;
    // 左钳优先：卡片比容器还宽时留在左边（避免负数或右钳互相打架）
    const maxLeft = Math.max(m, input.boxW - input.cardW - m);
    const left = Math.min(Math.max(input.anchorX - input.cardW / 2, m), maxLeft);
    let top = input.anchorY - input.cardH - gap;
    if (top < m) top = input.anchorY + gap;
    return { left: Math.round(left), top: Math.round(Math.max(m, top)) };
}
