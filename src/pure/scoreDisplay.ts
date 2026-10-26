// 大众评分的**展示口径唯一天源**（纯逻辑，零 obsidian / DOM）。
//
// 🔴 为什么要有这个文件：2026-10-25 用户裁定「Steam 的评分要显示为 % 专属」。
//    全仓原来有 4 处各自拼分数文本（列表角标 / 表格列 / 表单标题行 / 笔记「大众评分」行），
//    每处都是 `e.communityScore` 直出 —— 加了「百分比优先」这条规则后，
//    如果四处各写一遍 `e.reviewPercent ?? e.communityScore`，迟早有一处漏掉，
//    表现就是「列表显示 97%、笔记里还是 9.6」这种自相矛盾（本仓反复踩过「同一件事两处做」）。
//    ⇒ 全部收敛到本文件，⛔ 别在组件里再手搓一份。

import type { MediaEntry } from 'data/types';

/**
 * 大众评分的展示文本（**不含** `★` 等装饰前缀，由调用方决定要不要加）。
 *
 * 规则：
 * ① 有 `reviewPercent` ⇒ `97%`（好评率百分比优先，Steam 专属口径）；
 * ② 否则有 `communityScore` ⇒ 整数直出（`8`）、非整数保留一位（`8.4`）——
 *    与历史实现逐字一致，⛔ 不要顺手改成 `toFixed(1)`（那会把豆瓣的 `8` 变成 `8.0`，全仓快照都会变）；
 * ③ 都没有 ⇒ 空串（调用方据此判空隐藏，⛔ 不要返回 `'—'` 之类的占位：那会让「无评分」看起来像有值）。
 *
 * ⚠️ `reviewPercent` 允许为 `0`：那是「有人评、但一个好评都没有」的**真实结论**
 *    （上游 `parseReviewHistogram` 对「全差评」给 0，对「无人评过」给 undefined —— 两者在源头已分开）
 *    ⇒ 用 `!= null` 而不是真值判断，否则 0% 会被当成「没有评分」而整行消失。
 */
export function scoreTextOf(e: Pick<MediaEntry, 'communityScore' | 'reviewPercent'>): string {
    const pct = e.reviewPercent;
    if (pct != null && Number.isFinite(pct)) return `${Math.round(pct)}%`;
    const n = e.communityScore;
    if (n == null) return '';
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/**
 * 这个条目**有没有**可展示的大众评分（= `scoreTextOf` 非空）。
 * ⚠️ 单独开一个函数，是因为调用方经常只需要布尔判断（决定要不要渲染那一行/那一段），
 *    用 `scoreTextOf(e) !== ''` 也行，但语义不如本函数直白。
 */
export function hasScoreOf(e: Pick<MediaEntry, 'communityScore' | 'reviewPercent'>): boolean {
    return scoreTextOf(e) !== '';
}

/**
 * 这个条目的评分是不是**百分比口径**（Steam 好评率）。
 *
 * 🔴 用途：UI 上的 `★` 星号是 10 分制/5 分制的符号，配 `97%` 会变成荒谬的「97%★」。
 *    ⇒ 调用方据此决定要不要加 `★`。⛔ 别在模板里各写一遍 `e.reviewPercent != null` ——
 *    那样哪天口径调整（比如支持别的百分比来源）就得满仓找。
 */
export function scoreIsPercentOf(e: Pick<MediaEntry, 'communityScore' | 'reviewPercent'>): boolean {
    return e.reviewPercent != null && Number.isFinite(e.reviewPercent);
}
