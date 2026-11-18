// 多源搜索的「逐源早到 + 骨架占位」（2026-11-12 第 20 轮，m00353 ①-12）。
//
// 🔴 由来（用户逐字）：「多源搜索其中一源超时不返回时，要显示骨架屏展示另一个已返回的源
//    （否则等待太长）」。
//
// 病灶：原来结果区只有一条数据源 —— `results`，而它要等 `doSearch` 里 `await Promise.all(...)`
//   全部源回来、`onMergeSearchPool` 之后才赋值。于是：
//     · 一个源卡 5s（`AUX_SEARCH_TIMEOUT`），整片结果区就空 5s；
//     · 先回来的源明明已经有数据，屏幕上却什么都没有；
//     · 外层上屏条件又是 `{#if results.length > 0 && !picked}` ⇒ 首轮搜索时**整块根本不渲染**，
//       骨架屏就算写好了也看不见。
//   修法 = 双通道：`onSearchProgress` 的 `source.items` 实时喂 `earlyBySource`（谁先回来谁先出卡片）
//   + 没回来的源在自己的栏位里出骨架（`pending`），并放宽外层上屏条件（`showResults`）。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：本仓没有 Svelte 组件级测试基建，
//   而这四个点的失效形态全是**静默降级**（骨架不出现 / 空态和骨架同时出现 /
//   上一轮卡片串到这一轮 / 写死颜色），tsc 与 svelte-check 都不会说话。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配 ——
//   下面这些注释里大量出现被断言的字符串本身。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
const src = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('多源搜索骨架屏（①-12）', () => {
    it('🔴 外层上屏条件放宽成 `showResults`，⛔ 不再只看 `results.length`', () => {
        // 只看 results.length 时首轮搜索整块不渲染（results 还没合并），骨架屏无从显示。
        expect(src).toContain('{#if showResults && !picked}');
        expect(src).not.toContain('{#if results.length > 0 && !picked}');
    });

    it('🔴 `showResults` 必须把「正在搜 + 有参与源」也算进去', () => {
        // 少了 `searching && sourcePlan.length > 0` 这半句，搜索期间仍然不上屏。
        expect(src).toMatch(/\$:\s*showResults\s*=\s*results\.length\s*>\s*0\s*\|\|\s*\(searching\s*&&\s*sourcePlan\.length\s*>\s*0\)/);
    });

    it('🔴 标题条数按已渲染的栏求和（池子没合并时说「共 0 条」是错的）', () => {
        expect(src).toContain('{shownCount}');
        expect(src).toMatch(/\$:\s*shownCount\s*=\s*resultColumns\.reduce\(/);
    });

    it('🔴 `onSearchProgress` 收到 `items` 要存进 `earlyBySource`（谁先回来谁先出卡片）', () => {
        expect(src).toContain('earlyBySource = { ...earlyBySource, [p.source.id]: p.source.items as SearchResult[] };');
        // 只在有 items 时写：failed/timeout/blocked 没 items，写空数组会盖掉池里该源的旧结果。
        expect(src).toMatch(/if\s*\(p\.source\.items\)\s*\{/);
    });

    it('🔴 重新搜索要清空 `earlyBySource`（⛔ 否则上一轮卡片串到这一轮）', () => {
        expect(src).toContain('earlyBySource = {};');
        // 清空必须与 `srcLive = {}` 同一处（都在 doSearch 开头），别只在某个分支里清。
        expect(src).toMatch(/srcLive\s*=\s*\{\};\s*\/\/[^\n]*\n\s*earlyBySource\s*=\s*\{\};/);
    });

    it('🔴 分栏同时持有 `empty` 与 `pending`，且两者互斥', () => {
        // 接口里两个字段都得在：`empty`=源答了但空、`pending`=源还没答。
        expect(src).toMatch(/empty:\s*boolean;/);
        expect(src).toMatch(/pending:\s*boolean;/);
        // empty 必须带 `&& !pending` —— 否则骨架屏和「暂无匹配结果」会同时出现在一栏里。
        expect(src).toMatch(/empty:\s*items\.length\s*===\s*0\s*&&\s*!pending/);
    });

    it('🔴 骨架只在 `col.pending` 时渲染，且整块 `aria-hidden`', () => {
        expect(src).toMatch(/\{#if col\.pending\}/);
        expect(src).toContain('class="rl-res-col-skel" aria-hidden="true"');
        // 纯装饰：读屏只念一句「该源正在搜索」，⛔ 别让它念三行空 span。
        expect(src).toContain('该源正在搜索');
    });

    it('🔴 骨架样式只用原生变量，⛔ 不写死颜色；且尊重「减少动效」', () => {
        const at = src.indexOf('.rl-res-col-skel {');
        expect(at).toBeGreaterThan(-1);
        const css = src.slice(at, at + 1400);
        expect(css).toContain('var(--background-modifier-border)');
        expect(css).toContain('var(--background-primary)');
        expect(css).toContain('var(--rl-t-radius-lg');
        // 颜色类属性里不许出现 hex / rgb() —— 主题切换会翻车。
        expect(css).not.toMatch(/(?<![\w-])(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/);
        expect(css).toContain('prefers-reduced-motion');
    });
});
