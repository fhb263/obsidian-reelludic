// 时间戳侧边栏（#579）的**纯逻辑** —— 分档 / 条数 / 当前项 / 空状态文案，⛔ 不碰 DOM。
//
// 用户（2026-10-09「四、播放器与时间戳侧边栏 / 2. 时间戳侧边栏」）：
//   ·「**Tab分类**：分成两个 Tab，避免列表过长」；
//     🔴 #587（同日后续裁定）：第二栏显示名改用 **「时间戳笔记」**（与「截图笔记」成对；旧的叫法已退场）。
//   ·「**跳转联动**：点击列表项精准跳转对应时间戳」；
//   ·「**双向联动**：视频播放时，侧边栏对应时间戳条目自动高亮并滚动到可视区」；
//   ·「**兜底与性能**：做好空状态引导；列表项做懒加载」。
//
// 🔴 **「时间戳笔记」那一栏的口径 = 不带截图的纯时间戳标记**（`kind === 'stamp'`）。
//    数据里本来就只有这两类（`pure/videoMarks`：`shot` 来自笔记「## 截图时间戳」区、
//    `stamp` 来自「## 单时间戳」区），用户要的是「分两栏免得列表太长」而不是一个新概念
//    ⇒ 本批**不新增字段、不动笔记结构**。
//    ⚠️ 以后若要把这一栏改成「用户手动加星的标记」，只需改 `markTabOf` 一处 + 补一个字段。
import { type VideoMark } from 'pure/videoMarks';

/** 抽屉的两个 Tab */
export type MarkTab = 'shot' | 'scene';

/** Tab 顺序 = 用户给的顺序（截图笔记 → 时间戳笔记）。⛔ 别在视图里另写一份顺序。 */
export const MARK_TABS: readonly MarkTab[] = ['shot', 'scene'] as const;

/**
 * Tab 显示名（Tab 按钮、空状态引导与列表行兜底文字**共用这一份**，⛔ 手抄第二份就是 bug）。
 *
 * 🔴 #587（2026-10-09 用户裁定）：第二栏显示名改用 **「时间戳笔记」**（与「截图笔记」成对，
 *    说的就是「这一栏里是没有截图的那些时间戳」；旧叫法已整体退场）。
 * ⚠️ **内部 id 仍是历史值 `scene`**：它出现在 `markTabOf` 的返回值与 `Record<MarkTab, …>` 的键上，
 *    改 id 要动类型 + 视图 + 断言三处而**界面一个字都不会变** ⇒ 本批**只改显示名**，
 *    ⛔ 别把 id 当显示名用、也别在视图里硬编码中文标签（一律读这张表）。
 */
export const MARK_TAB_LABELS: Record<MarkTab, string> = {
    shot: '截图笔记',
    scene: '时间戳笔记',
};

/** 一个标记归哪个 Tab：**带截图的 ⇒ 截图笔记；纯时间戳的 ⇒ 时间戳笔记** */
export function markTabOf(mark: Pick<VideoMark, 'kind'> | undefined | null): MarkTab {
    return mark?.kind === 'shot' ? 'shot' : 'scene';
}

/** 按 Tab 过滤（保持传入顺序；未定义 ⇒ 空数组，⛔ 不返回 undefined） */
export function marksOfTab(marks: readonly VideoMark[] | undefined, tab: MarkTab): VideoMark[] {
    return (marks ?? []).filter((m) => markTabOf(m) === tab);
}

/** 两个 Tab 各自的条数（Tab 上的数字与「有没有内容」都读它，⛔ 别各处再滤一遍） */
export function markTabCounts(marks: readonly VideoMark[] | undefined): Record<MarkTab, number> {
    const out: Record<MarkTab, number> = { shot: 0, scene: 0 };
    for (const m of marks ?? []) out[markTabOf(m)] += 1;
    return out;
}

/**
 * 按**时间升序**排一份新数组（相等则保持原相对顺序 ⇒ **稳定**）。
 * 🔴 抽屉列表按时间排，而**笔记里的先后顺序不变**：双向联动要按时间走，否则播放时高亮会在列表里乱跳；
 *    进度条圆点与「在笔记中打开」仍按笔记原序（`line` 字段不受影响）。
 */
export function sortMarksByTime(marks: readonly VideoMark[] | undefined): VideoMark[] {
    return (marks ?? [])
        .map((m, i) => ({ m, i }))
        .sort((a, b) => (a.m.seconds - b.m.seconds) || (a.i - b.i))
        .map((x) => x.m);
}

/** 当前播放位置对应的列表项下标：**秒数不超过 `seconds + tol` 的那些里最大的一个**；没有 ⇒ `-1`。
 *
 *  - 与输入顺序**无关**（取最大值而不是「最后一个满足的」）⇒ 笔记里顺序乱也不会指错行；
 *  - 光标停在第一个标记之前 ⇒ `-1`（不高亮任何一条，这是正确行为：还没到第一个点）；
 *  - `tol` 默认 `0.6s`：`timeupdate` 的粒度与浮点误差下，正好落在标记那一刻也能点亮。
 */
export function activeMarkIndex(list: readonly VideoMark[], seconds: number, tol = 0.6): number {
    const cur = Number(seconds);
    if (!Number.isFinite(cur) || list.length === 0) return -1;
    let best = -1;
    let bestSec = -Infinity;
    for (let i = 0; i < list.length; i++) {
        const s = Number(list[i]?.seconds);
        if (!Number.isFinite(s) || s > cur + tol) continue;
        if (s > bestSec) {
            bestSec = s;
            best = i;
        }
    }
    return best;
}

/** 空状态引导（分 Tab 两句：截图那栏说「怎么截」，时间戳那栏说「怎么记」） */
export function markEmptyHint(tab: MarkTab): string {
    return tab === 'shot'
        ? '还没有截图笔记 — 播放时按 S（或顶栏相机图标）截取当前帧，截图会写进本条目笔记'
        : '还没有时间戳笔记 — 播放时按 T（或顶栏时钟图标）插入时间戳，记下值得回看的时刻';
}
