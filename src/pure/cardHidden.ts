/**
 * 「隐藏此条目卡片」的判定真源（m19210）。
 *
 * 用户原话：「在全部类型条目编辑属性表单-作品基础信息顶部行右边显示一个『[复选框]隐藏此条目卡片』
 * 功能项，勾选中后就把整个封面和信息栏都给我模糊化」。
 *
 * 🔴 语义边界（⛔ 别扩写）：
 *   · 只影响**卡片外观**（封面 + 信息栏整体糊掉），**不**参与筛选 / 排序 / 统计 / 进度 / 回收站。
 *     想做「从库里消失」请用 `MediaStatus` 的 `archived`，⛔ 别拿这个字段兼职。
 *   · 字段落库形态由 `data/catalog.normalizeEntry` 收口：只认 `=== true`，其余一律 `undefined`。
 *
 * 本模块是纯函数（零 obsidian / 零 DOM），既给列表渲染用，也便于单测穷举。
 */
import type { MediaEntry } from 'data/types';

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
