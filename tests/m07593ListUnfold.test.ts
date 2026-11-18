import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 m07593 ④⑤ 防回归守卫（2026-11-14）
 *
 * 这两条改过一次就被断言 `assert-symbols.cjs` #547 打回（我给 `<span class="rl-vb-view" …>`
 * 加 `class:rl-vb-masonry` 导致 `/class:is-open=\{viewOpen\}>/` 失配）。所以这里把两件事钉死：
 *
 *   ④ 列表视图下「单卡平铺」要生效 —— `rowSource` 的列表分支必须**读到 `unfoldSeries`**，
 *      且 `listGrouping && !searching` → `listTreeRows(` 的逐字形态（`searchPenetration.test.ts` 钉的）不许被改坏；
 *   ⑤ 瀑布流下隐藏「切换循环」按钮 —— **状态挂按钮自身**（`class:rl-vb-masonry`），
 *      ⛔ 别挪到外层 `.rl-vb-view`（断言 #547 逐字钉着那行开标签）；
 *      隐藏走 **CSS**（`display: none`），⛔ 别改 `{#if onToggleUnfoldSeries}` 结构
 *      （`unfoldSeries.test.ts` 钉着最近的 `{#if ` 必须是 `{#if onToggleUnfoldSeries}`）。
 *
 * ⚠️ 本仓被自己的注释打穿过三次（#379/#730/#731）—— 源码里那些注释也会写 `class:rl-vb-masonry`、
 *    `display: none` 之类字样，直接正则匹配源码会假绿 ⇒ 一律先剥注释再匹配（`strip`）。
 */

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

/** 剥掉 `//` 行注释与 `/* *​/` 块注释，避免被自己写的说明文字打穿。 */
function strip(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('m07593 ④⑤ 列表摊平 / 瀑布流隐藏（防回归）', () => {
    const raw = read('src/views/components/MediaList.svelte');
    const src = strip(raw);

    it('⑤ 瀑布流隐藏态挂在**按钮自身**（class:rl-vb-masonry），⛔ 不许挪到外层 .rl-vb-view', () => {
        // 按钮本体带 masonry 类
        expect(src).toMatch(/class="rl-vb-unfold"[\s\S]{0,200}?class:rl-vb-masonry=\{viewMode === 'masonry'\}/);
        // 外层 span 必须保持断言 #547 钉的逐字形态（`>` 紧跟 `{viewOpen}`，中间不许插别的 class）
        expect(raw).toMatch(/<span class="rl-vb-view" role="group" class:is-open=\{viewOpen\}>/);
        expect(raw).not.toMatch(/<span class="rl-vb-view"[^>]*rl-vb-masonry/);
    });

    it('⑤ 隐藏走 CSS（display: none），⛔ 不许改 {#if onToggleUnfoldSeries} 结构', () => {
        // CSS 规则存在且只作用于「按钮自身带 masonry 类」的形态
        expect(src).toMatch(/\.rl-vb-view \.rl-vb-unfold\.rl-vb-masonry\s*\{\s*display:\s*none/);
        // 按钮仍由 `{#if onToggleUnfoldSeries}` 包着（未被改成视图条件）
        expect(src).toMatch(/\{#if onToggleUnfoldSeries\}[\s\S]{0,400}?class="rl-vb-unfold"/);
    });

    it('④ 列表分支读到 unfoldSeries（单卡平铺在列表视图生效）', () => {
        // rowSource 列表那一支里 unfoldSeries 决定 listFlatRows
        expect(src).toMatch(/unfoldSeries\s*\n?\s*\? listFlatRows\(groupPoolEntries\)/);
    });

    it('④ listGrouping && !searching → listTreeRows 的两个字面锚都在（⛔ 别用换行敏感正则）', () => {
        // ⚠️ 本仓源文件是 CRLF（`\r\n`），任何 `\n\s*\?` 之类跨行正则都会假红 ⇒ 用 `toContain` 字面锚。
        // 这两个锚与 tests/searchPenetration.test.ts 一致，改坏任一个都会在那里红。
        expect(raw).toContain('listGrouping && !searching');
        expect(raw).toContain('? listTreeRows(groupPoolEntries, sortBy)');
    });

    it('④ unfoldSeries 与 listGrouping 仍是两个独立字段（⛔ 不许合并）', () => {
        // 两个字段各自独立存在（合并会让 unfoldSeries 语义混进 listGrouping）；
        // 独立性细则由 tests/unfoldSeries.test.ts 的 `setUnfoldSeries` 体内不许出现 `listGrouping` 钉着。
        expect(raw).toMatch(/export let unfoldSeries\b/);
        expect(raw).toContain('listGrouping');
        // 两处在源里都出现、且不是同一个声明（一个 let 绑定 + 一处使用/判据）
        expect((raw.match(/listGrouping/g) ?? []).length).toBeGreaterThan(1);
    });
});
