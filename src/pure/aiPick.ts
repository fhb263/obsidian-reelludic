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

// ───────────── 2026-10-23 用户：「插件内置候选模型列出来给我决定删除哪个」 ─────────────
//
// 口径（⚠️ 三条都别改）：
//   ① **只能删本仓预置的**（`fromApi === false`）—— `/models` 拉回来的真实清单删了没意义：
//      下次「重新获取」它又回来了，用户会以为删不掉。
//   ② **默认模型不可删**（`isDefault`）—— `resolveModel` 没选值时回落到 `DEFAULT_MODELS`，
//      删掉它 = 回落到一个在列表里看不见的名字（设置页显示空白，用户无法理解）。
//   ③ 隐藏名单**按服务商分键**（模型 id 可能跨家重名，如硅基流动上的 `deepseek-chat`）。

/** 隐藏键的分隔符（`\u0000` 不可能出现在模型 id 里，⇒ 拼接无歧义） */
const HIDDEN_SEP = '\u0000';

/** 隐藏名单里这一项的键（服务商 + 模型 id） */
export function hiddenKey(provider: string, value: string): string {
    return `${provider}${HIDDEN_SEP}${value}`;
}

export function isHidden(hidden: readonly string[], provider: string, value: string): boolean {
    return hidden.includes(hiddenKey(provider, value));
}

/** 切换隐藏（有则摘、无则追加）；返回**新数组**。空模型名 / 空服务商 ⇒ 原样复制 */
export function toggleHidden(hidden: readonly string[], provider: string, value: string): string[] {
    if (!value || !provider) return [...hidden];
    const k = hiddenKey(provider, value);
    return hidden.includes(k) ? hidden.filter((v) => v !== k) : [...hidden, k];
}

/**
 * 这一行能不能删。
 * ⚠️ `keep` 为**当前在用的模型**：永远返回 false（用户不能把自己正在用的那个删掉）。
 */
export function canHideModel(it: AiModelCandidate, keep?: string): boolean {
    if (it.fromApi || it.isDefault) return false;
    return !keep || it.value !== keep;
}

/**
 * 去掉被隐藏的候选。
 * `keep` = 当前在用的模型 ⇒ **即使被隐藏也照样显示**（否则用户上次选了一个、后来删了它，
 * 打开弹窗就找不到自己正在用的那一项，以为设置丢了）。
 */
export function visibleModels(
    items: readonly AiModelCandidate[],
    hidden: readonly string[],
    provider: string,
    keep?: string,
): AiModelCandidate[] {
    if (!hidden.length) return [...items];
    return items.filter((it) => !isHidden(hidden, provider, it.value) || (!!keep && it.value === keep));
}

/** 该服务商下被隐藏的项数（给「已隐藏 N 个 · 全部恢复」用） */
export function hiddenCount(hidden: readonly string[], provider: string): number {
    const prefix = `${provider}${HIDDEN_SEP}`;
    return hidden.filter((k) => k.startsWith(prefix)).length;
}

/** 只摘掉**该服务商**的隐藏项（「全部恢复」用）；返回新数组 */
export function clearHiddenFor(hidden: readonly string[], provider: string): string[] {
    const prefix = `${provider}${HIDDEN_SEP}`;
    return hidden.filter((k) => !k.startsWith(prefix));
}
