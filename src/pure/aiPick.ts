// #484：模型拣选弹窗的**纯逻辑**（能力筛选 · 置顶 · 分段）。
//
// 立这个文件的原因：弹窗要加「筛选 chip + 置顶段 + 计数」，这些**判定**必须能单测 ——
// ⛔ 别塞进 `AiPickerModal`（渲染层没法测，判据一改就是肉眼回归）。
//
// 🔴 **只写真信息**（#482 定的口径，⛔ 不编参数）：
//    「推理 / 视觉」按**模型 id 与接口真给的字段**判；「长上下文」只认接口真返回的 `contextWindow`。
//    ⇒ 智谱 / 硅基流动的 `/models` 不返回元数据（实测 2026-10-02）时，「长上下文」筛出来会是空的，
//      这不是 bug —— 空了就由弹窗给一句说明，⛔ 不许靠猜 id 补一个「128k」。
import type { AiModelCandidate } from 'pure/translate';

/** 能力筛选档位（`all` = 不过滤） */
export type ModelFilter = 'all' | 'pinned' | 'reasoning' | 'vision' | 'long';

/**
 * 筛选 chip —— 顺序即 UI 顺序。
 * ⚠️ `pinned` 排在 `all` 之后：它是**常用**入口，比能力档更常用；能力档按「看得见的差别」排。
 */
export const MODEL_FILTERS: readonly { value: ModelFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'pinned', label: '★ 置顶' },
    { value: 'reasoning', label: '推理' },
    { value: 'vision', label: '视觉' },
    { value: 'long', label: '长上下文' },
];

/** 「长上下文」的门槛 = 128k（`131072`）—— ⛔ 别写成「越大越好」的模糊口径 */
export const LONG_CONTEXT_MIN = 131072;

/**
 * 这一项是否命中某个筛选档。
 * ⚠️ `pinned` 需要外部把置顶清单传进来（它落在设置里，不是候选自带的属性）。
 */
export function matchModelFilter(
    it: AiModelCandidate,
    filter: ModelFilter,
    pinned: readonly string[],
): boolean {
    switch (filter) {
        case 'all':
            return true;
        case 'pinned':
            return pinned.includes(it.value);
        case 'reasoning':
            return /reason|think|\br1\b/i.test(it.value);
        case 'vision':
            return !!it.imageInput || /vision|\bvl\b|omni/i.test(it.value);
        case 'long':
            return typeof it.contextWindow === 'number' && it.contextWindow >= LONG_CONTEXT_MIN;
        default:
            return true;
    }
}

/** 按档位过滤（顺序保持不变 —— 置顶的归置顶段，其余按原顺序） */
export function filterModels(
    items: readonly AiModelCandidate[],
    filter: ModelFilter,
    pinned: readonly string[],
): AiModelCandidate[] {
    return items.filter((it) => matchModelFilter(it, filter, pinned));
}

/**
 * 分成「置顶 / 其余」两段 —— 置顶段**不随使用漂移**（VS Code 的 Pinned 就是这个意思）。
 * ⚠️ 置顶段的**顺序按置顶清单的顺序**（用户自己排的先后），不是候选顺序。
 */
export function splitPinned(
    items: readonly AiModelCandidate[],
    pinned: readonly string[],
): { top: AiModelCandidate[]; rest: AiModelCandidate[] } {
    const byValue = new Map(items.map((it) => [it.value, it]));
    const top: AiModelCandidate[] = [];
    for (const v of pinned) {
        const hit = byValue.get(v);
        if (!hit) continue; // ⛔ 置顶了一个当前服务商没有的模型 ⇒ 静默跳过（不显示幽灵行）
        top.push(hit);
        byValue.delete(v);
    }
    return { top, rest: items.filter((it) => byValue.has(it.value)) };
}

/** 切换置顶（有则摘、无则追加到末尾）；返回**新数组**（⛔ 不改入参 —— 设置对象要能对比前后） */
export function togglePin(pinned: readonly string[], value: string): string[] {
    if (!value) return [...pinned];
    return pinned.includes(value) ? pinned.filter((v) => v !== value) : [...pinned, value];
}
