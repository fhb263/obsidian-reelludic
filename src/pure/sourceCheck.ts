// 「一键体检」的汇总口径（#432 甲 · A3 · 决策 D-35）。
//
// 体检要回答的问题只有一个：**这条源现在还活着吗**。落地形态（D-35 选 b）：
//   对每条源**真发一次搜索请求**（用固定探针词），记「可达 / 时延 / 条数」，失败时给归因。
//
// 🔴 三条口径（⛔ 缺一条都会误导用户）：
//   ① **「搜到 0 条」≠「源坏了」**：探针词不一定命中该站的库（尤其文学源 vs 网文源书库完全不同）
//      ⇒ 请求成功就判**可用**，条数只是**信息位**。⛔ 不许把 0 条标红。
//   ② **时延只分档**（快/正常/慢），⛔ 不排名、不当作「好用程度」——它受网络抖动影响很大。
//   ③ 失败原因**先折人话**（复用 `sourceRule.novelFailText`），原文留给 tooltip。
//
// ⚠️ 探针词是**中性词**（本仓文案规范：⛔ 不出现具体作品名/人名）。换词只改这一个常量。

import type { SourceKind } from 'pure/sourceRule';

/** 体检用的探针词。⚠️ 中性、常见；⛔ 别换成具体作品名（文案规范）。 */
export const SOURCE_HEALTH_KEYWORD = '书';

/** 体检并发上限（⛔ 别把十几个站点同时打满 —— 体检也是在对别人的服务器发请求） */
export const SOURCE_CHECK_CONCURRENCY = 4;

/** 时延分档的界线（毫秒）：≤1200 快 / ≤4000 正常 / 其余慢 */
export const SOURCE_LATENCY_FAST_MS = 1200;
export const SOURCE_LATENCY_OK_MS = 4000;

/**
 * 体检的**并发度**（⛔ 调用方别自己算 —— 阈值只在本模块维护）。
 * ⚠️ 显式写下界 1：0 个 worker 会让整轮体检**静默空转**（一条都不查却报「完成」）。
 */
export function sourceCheckWorkers(count: number): number {
    return Math.max(1, Math.min(SOURCE_CHECK_CONCURRENCY, Math.max(0, Math.floor(Number(count))) || 1));
}

export type SourceLatencyBand = 'fast' | 'normal' | 'slow';

export const SOURCE_LATENCY_LABEL: Readonly<Record<SourceLatencyBand, string>> = {
    fast: '快',
    normal: '正常',
    slow: '慢',
};

export interface SourceCheckResult {
    /** 书源的唯一键（`sourceRule.sourceKey`）—— 写回源行时靠它对齐，⛔ 别用名字（会重名） */
    key: string;
    name: string;
    kind: SourceKind;
    /** 请求层面成功（能拿到并解析出结果结构） */
    ok: boolean;
    /** 耗时（毫秒） */
    ms: number;
    /** 搜到几条（**信息位**：0 条不算失败，见文件头 ①） */
    count: number;
    /** 失败原因（已折人话）；成功时 undefined */
    error?: string;
    /** 失败原文（给 tooltip 用；成功时 undefined） */
    raw?: string;
}

/** 时延分档（纯函数；⛔ 视图层别自己写阈值） */
export function sourceLatencyBand(ms: number): SourceLatencyBand {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= SOURCE_LATENCY_FAST_MS) return 'fast';
    return n <= SOURCE_LATENCY_OK_MS ? 'normal' : 'slow';
}

/**
 * 源行上那行小字（体检结果）。
 * 形状：`可用 · 快 320ms · 12 条` ／ `连不上：…`
 * ⚠️ 0 条时**保留**「0 条」（那是信息，不是错误）。
 */
export function sourceCheckHealthText(r: SourceCheckResult): string {
    if (!r.ok) return r.error ? `不可用 · ${r.error}` : '不可用';
    return `可用 · ${SOURCE_LATENCY_LABEL[sourceLatencyBand(r.ms)]} ${Math.max(0, Math.round(r.ms))}ms · ${Math.max(0, Math.floor(r.count))} 条`;
}

/**
 * 整轮体检的一句话总结。
 * 形状：`体检完成：6 条可用 · 2 条不可用 · 2.4s`
 * ⚠️ 拿不到结果（空数组）⇒ 空串（调用方据此不弹那条总结，⛔ 别显示「体检完成：0 条可用」这种吓人的话）。
 */
export function sourceCheckSummaryText(results: readonly SourceCheckResult[], elapsedMs: number): string {
    if (!results.length) return '';
    const ok = results.filter((r) => r.ok).length;
    const bad = results.length - ok;
    const sec = Math.max(0, Number(elapsedMs)) / 1000;
    const head = bad ? `体检完成：${ok} 条可用 · ${bad} 条不可用` : `体检完成：${results.length} 条全部可用`;
    return `${head} · ${sec.toFixed(1)}s`;
}

/** 只有**不可用**的那些（UI 把那几条单独列出来；⛔ 别让用户在一堆绿字里找红字） */
export function sourceCheckFailures(results: readonly SourceCheckResult[]): SourceCheckResult[] {
    return results.filter((r) => !r.ok);
}
