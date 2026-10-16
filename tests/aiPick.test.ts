// #484：模型拣选弹窗的纯逻辑（能力筛选 · 置顶 · 分段）
import { describe, it, expect } from 'vitest';
import {
    MODEL_FILTERS,
    LONG_CONTEXT_MIN,
    matchModelFilter,
    filterModels,
    splitPinned,
    togglePin,
    type ModelFilter,
} from 'pure/aiPick';
import type { AiModelCandidate } from 'pure/translate';

const mk = (value: string, extra: Partial<AiModelCandidate> = {}): AiModelCandidate => ({
    value,
    label: value,
    fromApi: true,
    ...extra,
});

const ITEMS: AiModelCandidate[] = [
    mk('glm-5'),
    mk('deepseek-reasoner'),
    mk('Qwen/Qwen2.5-VL-72B'),
    mk('deepseek-chat', { contextWindow: 1048576, imageInput: true }),
    mk('glm-4.5v', { imageInput: true }),
];

describe('模型筛选与置顶（#484）', () => {
    it('筛选档位齐备且「全部」在首位（置顶是常用入口，排第二）', () => {
        expect(MODEL_FILTERS.map((f) => f.value)).toEqual(['all', 'pinned', 'reasoning', 'vision', 'long']);
        expect(LONG_CONTEXT_MIN).toBe(131072);
    });

    it('🔴 「推理 / 视觉」按 **id 与真字段**判，⛔ 不写主观词', () => {
        expect(filterModels(ITEMS, 'reasoning', []).map((i) => i.value)).toEqual(['deepseek-reasoner']);
        // 视觉 = 接口真给的 imageInput，或 id 里带 vision/vl/omni
        expect(filterModels(ITEMS, 'vision', []).map((i) => i.value)).toEqual([
            'Qwen/Qwen2.5-VL-72B',
            'deepseek-chat',
            'glm-4.5v',
        ]);
    });

    it('🔴 「长上下文」只认接口真返回的 contextWindow —— 没有元数据的那几家**不该被猜出来**', () => {
        // 只有 deepseek-chat 带 contextWindow（=1M）；其余几家接口不给 ⇒ 不能被算作长上下文
        expect(filterModels(ITEMS, 'long', []).map((i) => i.value)).toEqual(['deepseek-chat']);
        // 边界：正好 128k 算长，差 1 不算
        expect(matchModelFilter(mk('a', { contextWindow: LONG_CONTEXT_MIN }), 'long', [])).toBe(true);
        expect(matchModelFilter(mk('b', { contextWindow: LONG_CONTEXT_MIN - 1 }), 'long', [])).toBe(false);
        expect(matchModelFilter(mk('c'), 'long', [])).toBe(false);
    });

    it('置顶段：顺序按**置顶清单**排（用户自己排的先后），不是候选顺序', () => {
        const pinned = ['glm-5', 'deepseek-reasoner'];
        expect(filterModels(ITEMS, 'pinned', pinned).map((i) => i.value)).toEqual(pinned);
        // ⚠️ 过滤**只筛不排**：置顶清单倒过来，filter 出来的仍是候选原顺序（glm-5 在前）
        const rev = ['deepseek-reasoner', 'glm-5'];
        expect(filterModels(ITEMS, 'pinned', rev).map((i) => i.value)).toEqual(pinned);
    });

    it('splitPinned：置顶的进 top、其余进 rest，两段不重不漏', () => {
        const { top, rest } = splitPinned(ITEMS, ['glm-5', 'deepseek-reasoner']);
        expect(top.map((i) => i.value)).toEqual(['glm-5', 'deepseek-reasoner']);
        // 置顶清单倒过来 ⇒ 置顶段跟着倒（顺序是用户排的，不是候选顺序）
        expect(splitPinned(ITEMS, ['deepseek-reasoner', 'glm-5']).top.map((i) => i.value)).toEqual([
            'deepseek-reasoner',
            'glm-5',
        ]);
        expect(rest.map((i) => i.value)).toEqual(['Qwen/Qwen2.5-VL-72B', 'deepseek-chat', 'glm-4.5v']);
        expect(top.length + rest.length).toBe(ITEMS.length);
    });

    it('🔴 置顶了一个**当前服务商没有**的模型 ⇒ 静默跳过（⛔ 不许显示幽灵行）', () => {
        const { top, rest } = splitPinned(ITEMS, ['glm-5', 'not-in-list']);
        expect(top.map((i) => i.value)).toEqual(['glm-5']);
        expect(rest).toHaveLength(ITEMS.length - 1);
    });

    it('togglePin：有则摘、无则**追加到末尾**；返回新数组（⛔ 不改入参）', () => {
        const init = ['a', 'b'];
        expect(togglePin(init, 'c')).toEqual(['a', 'b', 'c']);
        expect(togglePin(init, 'a')).toEqual(['b']);
        expect(init).toEqual(['a', 'b']); // 入参未被改
        expect(togglePin(init, '')).toEqual(init); // 空值不写入
    });

    it('全部档位 = 不过滤（顺序保持原样）', () => {
        const all: ModelFilter[] = ['all'];
        expect(filterModels(ITEMS, all[0], [])).toHaveLength(ITEMS.length);
    });
});
