/**
 * 评分看板的「系列卡堆叠 ⟷ 全部单卡平铺」循环切换按钮 —— 源码守卫（用户 m02498，2026-11-14）。
 *
 * 🔴 用户原话：「也给评分看板加个系列卡堆叠和单卡平铺的循环切换图标按钮
 *    同首页的按钮放在评分看板导航栏上」。
 *
 * 为什么用「读源码文本」而不是渲染组件：
 *   · 这条链的本质是**三层透传**（`HomeView → StatsBoard → RatingBoard`），
 *     任何一层漏传，按钮就静默不出现（或出现了点了没反应）—— 而 jsdom 渲染不出 Svelte 组件的
 *     `export let` 漏传（缺省值 `null` 让按钮整枚不渲染，看着「正常」）。
 *   · 净面行为（折叠/平铺的格子数）已经由 `tests/seriesRating.test.ts` 的 `unfold` 组钉住；
 *     这里只钉「有没有接上、按钮长什么样」，两边分工不重叠。
 *
 * ⚠️ 一律先 `stripComments` 再匹配 —— 本仓注释里大量出现 `grid-column: span 2` / `buildBoard(`
 *    这类字样，不先剥注释会让守卫被一段注释骗绿（`tests/episodePageEntryMenu.test.ts` 同款范式）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** 去掉 `//` 行注释与 `/* *\/` 块注释（够用即可；本仓模板里没有字符串含 `//` 的坑） */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(rel: string): string {
    return stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));
}

const ratingBoard = read('src/views/components/RatingBoard.svelte');
const statsBoard = read('src/views/components/StatsBoard.svelte');
const homeView = read('src/views/components/HomeView.svelte');

describe('m02498 评分看板 · 系列卡堆叠 / 单卡平铺切换', () => {
    it('🔴 RatingBoard 声明两个 prop，且都带缺省值（未接线时按钮不出现，⛔ 别崩）', () => {
        expect(ratingBoard).toMatch(/export let unfoldSeries = false;/);
        expect(ratingBoard).toMatch(/export let onToggleUnfoldSeries:\s*\(\(next: boolean\) => void\) \| null = null;/);
    });

    it('🔴 两个投影必须吃**同一个**布尔（画格与「未评分 N / M」的分母不能各走一套）', () => {
        expect(ratingBoard).toMatch(/buildSeriesBoard\(merged, mergedSeries, tab, unfoldSeries\)/);
        expect(ratingBoard).toMatch(/seriesUnratedRatio\(merged, mergedSeries, tab, unfoldSeries\)/);
    });

    it('🔴 按钮模板：`{#if onToggleUnfoldSeries}` 守卫 + is-on + aria-pressed + 图标翻面', () => {
        expect(ratingBoard).toMatch(/\{#if onToggleUnfoldSeries\}/);
        expect(ratingBoard).toMatch(/class="rl-board-unfold"/);
        expect(ratingBoard).toMatch(/class:is-on=\{unfoldSeries\}/);
        expect(ratingBoard).toMatch(/aria-pressed=\{unfoldSeries\}/);
        expect(ratingBoard).toMatch(/on:click=\{\(\) => onToggleUnfoldSeries\?\.\(!unfoldSeries\)\}/);
        // 图标与首页那枚同款翻面：堆叠 = layers、平铺 = layout-grid
        expect(ratingBoard).toMatch(/<Icon icon=\{unfoldSeries \? 'layout-grid' : 'layers'\} size=\{14\} \/>/);
    });

    it('🔴 按钮必须摆在标题栏（`.rl-board-head`）里，行内不得写死 px 尺寸靠 CSS 管', () => {
        const head = ratingBoard.match(/<div class="rl-board-head">[\s\S]*?<\/div>\s*<\/div>/);
        expect(head, 'rl-board-head 那段模板没匹配到').toBeTruthy();
        expect(head![0]).toContain('rl-board-unfold');
        expect(ratingBoard).toMatch(/\.rl-board \.rl-board-unfold \{/);
    });

    it('🔴 StatsBoard 是透传层：两个 prop 都要声明并原样透传给 RatingBoard', () => {
        expect(statsBoard).toMatch(/export let unfoldSeries = false;/);
        expect(statsBoard).toMatch(/export let onToggleUnfoldSeries:\s*\(\(next: boolean\) => void\) \| null = null;/);
        expect(statsBoard).toMatch(/\{unfoldSeries\}\s*\r?\n\s*\{onToggleUnfoldSeries\}/);
    });

    it('🔴 HomeView 必须把两个 prop 喂给 StatsBoard（漏传 = 按钮永远不出现）', () => {
        const line = homeView.match(/<StatsBoard [^>]*\/>/);
        expect(line, 'HomeView 里的 <StatsBoard ... /> 没匹配到').toBeTruthy();
        expect(line![0]).toContain('{unfoldSeries}');
        expect(line![0]).toContain('{onToggleUnfoldSeries}');
    });

    it('反向守卫：⛔ 别给看板另开一个设置字段（必须复用 settings.unfoldSeries）', () => {
        // 顶层设置里只该有 unfoldSeries 这一个系列折叠开关
        const settings = read('src/Settings.ts');
        expect(settings).not.toMatch(/boardUnfold|statsUnfold|ratingUnfold/);
        expect(ratingBoard).not.toMatch(/boardUnfold|statsUnfold|ratingUnfold/);
    });
});
