/**
 * 「隐藏此条目卡片」的判定真源（m19210）。
 *
 * 用户原话（m19210）：「在全部类型条目编辑属性表单-作品基础信息顶部行右边显示一个
 * 『[复选框]隐藏此条目卡片』功能项，勾选中后就把整个封面和信息栏都给我模糊化」。
 * 🔴 m19456 用户改判：「隐藏条目卡片功能项（仅封面蒙板，信息栏信息全用*号替代）」
 *   ⇒ 模糊那一版被推翻，现口径见下方 `maskCardText` 的注释。
 *
 * 🔴 语义边界（⛔ 别扩写）：
 *   · 只影响**卡片外观**（封面盖蒙板 + 信息栏文字打码），**不**参与筛选 / 排序 / 统计 / 进度 / 回收站。
 *     想做「从库里消失」请用 `MediaStatus` 的 `archived`，⛔ 别拿这个字段兼职。
 *   · 字段落库形态由 `data/catalog.normalizeEntry` 收口：只认 `=== true`，其余一律 `undefined`。
 *
 * 本模块是纯函数（零 obsidian / 零 DOM），既给列表渲染用，也便于单测穷举。
 */
import type { MediaEntry } from 'data/types';

/**
 * 🔴 m19456（用户逐字）：「隐藏条目卡片功能项（仅封面蒙板，信息栏信息全用*号替代）」
 *   ⇒ 第一版（m19210）的「封面 + 信息栏一起模糊」被推翻：**封面只盖蒙板**（图案由 CSS 给），
 *     **信息栏的文字换成星号**。理由：模糊会把卡片糊成「坏了」，蒙板 + 打码才像「被遮住了」。
 *
 * ⚠️ 星号是**定长**的（不按原文长度生成）：按长度生成会泄漏原文有多长；
 *    且同一列卡片的行宽恒定，换页签时不会因为「这条藏 / 那条没藏」而抖。
 */
export const CARD_HIDDEN_TEXT = '***';

/**
 * 信息栏取值的打码出口 —— 全仓唯一实现。
 *
 * ⛔ 别在模板里写 `hidden ? '***' : x`（那就是第二个真源，改文案时必漏一处）。
 * ⛔ 也别用 CSS `text-security` / `-webkit-text-security`（Chromium 只对 input 生效，
 *    对普通文本无效；换成别的黑科技会在主题字体下露馅）。
 */
export function maskCardText(hidden: boolean, text: string): string {
    return hidden ? CARD_HIDDEN_TEXT : text;
}

/** 该条目是否被标记为「隐藏卡片」。非对象 / 缺字段 / 非 `true` 一律 false。 */
export function entryCardHidden(entry: unknown): boolean {
    if (!entry || typeof entry !== 'object') return false;
    return (entry as { cardHidden?: unknown }).cardHidden === true;
}

/**
 * 系列折叠卡是否该糊。
 *
 * 🔴 判据 = **组内每一条都勾了隐藏**，而不是「有一条勾了就糊」：
 *   系列卡是「整组一扇门面」，只藏其中一部就把整扇门糊掉，会让用户以为整组都没了；
 *   而组内全勾则意味着用户确实不想看见这组。空组返 false（没有可藏的东西）。
 */
export function seriesCardHidden(items: readonly MediaEntry[] | null | undefined): boolean {
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every((it) => entryCardHidden(it));
}
