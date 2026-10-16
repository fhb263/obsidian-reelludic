// 章节标题展示格式（纯逻辑，可单测）：顶栏「第几章：章名」口径。
//
// 阅读器顶栏居中标题显示当前章而非书名（用户 2026-09-16 裁定），章标题原文形如
// 「第三章 风起」「第十二回、大闹天宫」「第三章：归途」，统一归一为「<编号>：<章名>」；
// 非编号型标题（楔子 / 序章 / 番外 / 英文 Chapter / 纯章名）一律原样保留，不做臆测编号。

/** 章节编号前缀：第X章/节/卷/回/话/部/集/篇（允许「第 3 章」中间夹空格、全角数字） */
const CHAPTER_PREFIX_RE = /^第\s*[一二三四五六七八九十百千万零〇两0-9０-９]+\s*[章节卷回话部集篇]/;

/** 编号与章名之间的分隔符（含中英文标点与空白；连续多个一并剥掉，防「第三章：：风起」堆叠） */
const SEPARATOR_RE = /^[\s：:．.、,，\-—－]+/;

/**
 * 章标题 → 顶栏展示文本。
 * - 「第三章 风起」/「第三章风起」/「第三章：风起」→「第三章：风起」
 * - 「第三章」→「第三章」（无章名不补冒号）
 * - 「楔子」/「序章 雪夜」/「Chapter 1 Arrival」→ 原样
 * - 空 / 非字符串 → 空串（由调用方回退书名）
 */
export function formatChapterTitle(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const title = raw.trim();
    if (!title) return '';
    const m = CHAPTER_PREFIX_RE.exec(title);
    if (!m) return title;
    const prefix = m[0];
    const rest = title.slice(prefix.length).replace(SEPARATOR_RE, '').trim();
    return rest ? `${prefix}：${rest}` : prefix;
}
