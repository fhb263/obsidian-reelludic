// 「待补」半成品筛选的纯逻辑（可单测）—— 用户 m07854 ⑮。
//
// 用户原话：「搜索框「添加」按钮旁加一个小**漏斗图标**，悬停显示 `[待补]`（缺少关联 / 缺少个人评分），
//           一键筛出没补全元数据的「半成品」」
//
// 🔴 判据只有两条，各自都有**唯一真源**，⛔ 别在这里重写第二份：
//    1. **缺关联** —— 走 `pure/seriesAssoc.assocFlagsOf(e).linked`。那套判据与
//       `pure/actionLabel.hasActionEntry` 逐字同口径（「trim 后非空」），且已经处理了
//       「影视看逐集数组 + 老字段 links / 书籍看 bookFile+readUrl / 游戏看快捷方式+URL /
//       音乐看 audioPath+audioUrl」四类分叉。这里自己写 switch 必然与它分叉 ——
//       本仓老病（同一件事两份真源）。
//    2. **缺个人评分** —— `normalizeRating(e.rating) <= 0`。`rating` 是 0~5、步长 0.5 的
//       字面量联合类型，脏值/缺失一律按 0 处理（`normalizeRating` 就是干这个的）。
//
// ⚠️ 两条是 **OR**（缺任一条就算「待补」）。用户原话写的是「缺少关联 / 缺少个人评分」，
//    斜杠是并列枚举而不是 AND —— 一部已经关联好、但还没打分的片子同样值得被拎出来补。
// ⛔ 别顺手加第三条（比如「缺海报」「缺年份」）：用户只点了这两条，多加一条会让
//    「点漏斗后条数比预期多」而无法解释，且此后每加一条判据都要改文案。

import type { MediaEntry } from 'data/types';
import { assocFlagsOf } from 'pure/seriesAssoc';
import { normalizeRating } from 'pure/rating';

/** 一条条目是否「待补」（缺关联 或 缺个人评分） */
export function isIncomplete(e: MediaEntry): boolean {
    if (!assocFlagsOf(e).linked) return true;
    return normalizeRating(e.rating) <= 0;
}

/** 缺哪几项（给行内小标签 / 提示语用，顺序固定 ⇒ 文案可预期） */
export interface IncompleteReasons {
    /** 没关联任何本地文件或网络地址 */
    noLink: boolean;
    /** 个人评分还没打（0 或缺失） */
    noRating: boolean;
}

/** 拆开两条判据 —— 只读一次 `assocFlagsOf`，⛔ 别让调用方各判一遍（会读两遍、也可能判出两种结果） */
export function incompleteReasonsOf(e: MediaEntry): IncompleteReasons {
    return { noLink: !assocFlagsOf(e).linked, noRating: normalizeRating(e.rating) <= 0 };
}

/** 计数（漏斗按钮的角标与提示语用） */
export function countIncomplete(entries: readonly MediaEntry[]): number {
    let n = 0;
    for (const e of entries) if (isIncomplete(e)) n++;
    return n;
}

/**
 * 漏斗按钮的 `data-tip` 文案。
 *
 * 用户原话要求「悬停显示 `[待补]`」，所以**开头的方括号 `[待补]` 是逐字要求**（⛔ 别改成「待补：」）。
 * ⚠️ 带上条数：一颗只写「待补」的按钮点下去不知道会剩几条，用户会犹豫；
 *    带上数字是「现在有多少条不完整」的可核查事实。
 * ⚠️ 计数为 0 时也要能说明 —— 否则按钮看着能点、点完一片空白，会被当成坏了。
 */
export function incompleteTip(count: number, active: boolean): string {
    const head = '[待补]';
    if (count <= 0) return `${head} 库里没有缺关联或没打分的条目`;
    if (active) return `${head} 正在只看这 ${count} 条缺关联 / 没打分的（再点一次看全部）`;
    return `${head} 筛出 ${count} 条缺关联 / 没打分的`;
}
