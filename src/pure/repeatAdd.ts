/**
 * 连续添加（#632）的纯逻辑。
 *
 * 用户原话：「批量添加按钮入口从首页上移除，干脆改成新增一个条目后搜索源出来的窗口不消失可继续添加」。
 * 于是 #631 那套独立弹窗（含 `pure/batchAdd`）整体退场，收口改到**新建条目表单自己**：
 * 保存成功后不关窗，直接回到候选列表接着挑下一条。
 *
 * 本模块只放**一行判据都不许含糊**的那几件（其余在 `EntryModal` / `EntryForm` 里）：
 *   · `resultKeyOf`  —— 候选的去重 / 「已添加」标记键（⛔ 全仓只准一份，组件与宿主同用）
 *   · `nextSeriesIndexLabel` —— 序号跨次继承时「自动 +1」的**唯一**算法
 *   · `repeatHint` / `submitLabel` —— 两处界面文案（新建态与编辑态**必须不同**）
 */
import type { SearchResult } from 'pure/searchDisplay';

/** 一次「保存并继续」要带走的会话状态（`EntryForm` 交回宿主，宿主重建组件时再注回去） */
export interface RepeatAddState {
    /** 上一次的候选列表（原样保留 —— 用户要的就是「窗口不消失」，⛔ 别顺手清空） */
    results: SearchResult[];
    /** 搜索框里的关键词（同样保留：接着搜下一个通常还要用它） */
    query: string;
    /** 刚保存的是哪一条候选的键（`resultKeyOf`）；`null` = 本次不是从候选里挑的（手填 / AI 预填） */
    addedKey: string | null;
    /** 表单里当前的系列名（跨次继承） */
    series: string;
    /** 表单里当前的系列序号（原样带出，由宿主 +1；⛔ 别在这里改） */
    seriesIndex: string;
}

/**
 * 候选的唯一键。
 * 🔴 与 `EntryForm` 里原有的 `resultKey` **同一口径**（本函数就是它搬出来的）——
 *    ⛔ 别在组件里再写一份：两处一旦漂移，「已添加」标记会标错行或整片标不上。
 */
export function resultKeyOf(r: SearchResult): string {
    // ⚠️ 写成 `'id' in r ? String(r.id) : r.title` 会让 tsc 把 else 分支收窄成 `never`
    //    （六类结果**都**有 `id` 键）⇒ 这里用显式键检测，行为与原实现逐字一致。
    const m = r as { id?: string | number; title?: string };
    const hasId = 'id' in m && m.id !== undefined && m.id !== null;
    const head = hasId ? String(m.id) : (m.title ?? '');
    return head + '|' + (m.title ?? '');
}

/** 序号上界：超过这个位数就不加（`Number` 精度会失真 ⇒ 宁可不猜） */
const MAX_INDEX_DIGITS = 9;

/**
 * 连续添加时「系列序号自动 +1」。
 *
 * 判据（都写进单测）：
 *   · 纯数字（允许两侧空白）⇒ +1，如 `'2'` → `'3'`、`' 3 '` → `'4'`、`'0'` → `'1'`
 *   · 空串 / 纯空白 / 非数字（`'abc'`、`'2.5'`、`'-1'`）⇒ **原样返回**（⛔ 不猜用户意图）
 *   · 位数超过 9 位 ⇒ 原样返回（浮点精度会悄悄改数）
 */
export function nextSeriesIndexLabel(cur: string): string {
    const t = (cur ?? '').trim();
    if (!/^\d+$/.test(t)) return cur;
    if (t.length > MAX_INDEX_DIGITS) return cur;
    return String(Number(t) + 1);
}

/** 候选列表头部那行提示：新建态承诺「保存后回到这里」，编辑态没有这回事 */
export function repeatHint(isNew: boolean): string {
    return isNew
        ? '点击卡片回填 · 保存后回到这里继续挑 · 点击空白关闭'
        : '点击卡片回填 · 点击空白取消 · 徽标直达来源';
}

/** 表单右下那枚提交钮：新建态说「继续」（保存后真的不关窗），编辑态照旧「更新笔记」 */
export function submitLabel(isNew: boolean): string {
    return isNew ? '保存并继续' : '更新笔记';
}
