import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * m07854 ⑬（2026-11-13）**视图切换下拉左旁那枚「系列卡堆叠 ⇄ 全部单卡平铺」循环按钮**的源码级守卫。
 *
 * 为什么是源码文本断言而不是运行时断言：
 * - `unfoldSeries` 只是组件里一个 `$:` 三元里的条件，`seriesRows` 的两种形态都能过 tsc / svelte-check；
 * - 按钮的位置是「在哪个容器里、第几个」这种**结构**，单测渲染不出来（组件依赖 `obsidian` 运行时）。
 *
 * 🔴 铁律：**先 strip 注释再匹配**（#379 / #730 / #731 三次被自己的注释打穿）。
 *    单次交替正则，让「先遇到谁就由谁消费」；Svelte 的 `<!-- -->` 也必须剥（⑪ 那批的血的教训）。
 */
const ROOT = resolve(__dirname, '..');
function read(rel: string): string {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}
function strip(src: string): string {
    return src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
}

/** 取某个 `<style>` 段（本仓组件样式都在里面，避免误命中模板里的 class 字符串） */
function styleOf(src: string): string {
    const m = /<style>([\s\S]*?)<\/style>/.exec(src);
    return m ? m[1] : '';
}

const settingsSrc = strip(read('src/Settings.ts'));
const mainSrc = strip(read('main.ts'));
const mediaRaw = read('src/views/components/MediaList.svelte');
const mediaSrc = strip(mediaRaw);
const mediaStyle = styleOf(mediaSrc);
const homeRaw = read('src/views/components/HomeView.svelte');
const homeSrc = strip(homeRaw);
const homeTsSrc = strip(read('src/views/HomeView.ts'));

describe('⑬ 系列卡摊平：设置字段与宿主出口', () => {
    it('Settings 里有 append-only 的 unfoldSeries 可选字段', () => {
        expect(settingsSrc).toMatch(/unfoldSeries\?:\s*boolean;/);
    });

    it('main.ts 有唯一落盘出口 setUnfoldSeries（脏值按「堆叠」归一）', () => {
        expect(mainSrc).toMatch(/async setUnfoldSeries\(next: boolean\): Promise<void>/);
        // 归一判据必须是 `=== true`（缺省 / 脏值 ⇒ false = 堆叠），⛔ 不是 `!== false`
        expect(mainSrc).toMatch(/this\.settings\.unfoldSeries = next === true;/);
        // 落盘 + 刷视图，两件都不能漏
        expect(mainSrc).toMatch(/this\.settings\.unfoldSeries = next === true;[\s\S]{0,120}await this\.saveSettings\(\);/);
        expect(mainSrc).toMatch(/this\.settings\.unfoldSeries = next === true;[\s\S]{0,200}await this\.refreshViews\(\);/);
    });

    it('⛔ 摊平开关与「列表展示分组」是两个独立字段，不许合并', () => {
        // 两者各自有类型声明与各自 setter —— 合并后只剩一个
        expect(settingsSrc).toMatch(/listGrouping\?:\s*boolean;/);
        expect(settingsSrc).toMatch(/unfoldSeries\?:\s*boolean;/);
        expect(mainSrc).toMatch(/async setListGrouping\(next: boolean\)/);
        expect(mainSrc).toMatch(/async setUnfoldSeries\(next: boolean\)/);
        // 反向：·setUnfoldSeries· 体内不许碰 listGrouping
        const body = mainSrc.slice(mainSrc.indexOf('async setUnfoldSeries'));
        const chunk = body.slice(0, body.indexOf('\n    }'));
        expect(chunk).not.toMatch(/listGrouping/);
    });
});

describe('⑬ 组件层：props 与派生口径', () => {
    it('MediaList 声明了 unfoldSeries（缺省 false = 堆叠）与回推出口', () => {
        expect(mediaSrc).toMatch(/export let unfoldSeries = false;/);
        expect(mediaSrc).toMatch(/export let onToggleUnfoldSeries: \(\(next: boolean\) => void\) \| null = null;/);
    });

    it('摊平判据收口成一条派生量：searching ∪ unfoldSeries', () => {
        expect(mediaSrc).toMatch(/\$: unfoldRows = searching \|\| unfoldSeries;/);
        expect(mediaSrc).toMatch(/\$: seriesRows = unfoldRows \? listFlatRows\(groupPoolEntries\) : foldSeries\(groupPoolEntries\);/);
    });

    it('⛔ 下游不许各自再判一次（判据只准一份）', () => {
        // 「判据只有一份」的意思是：**决定摊不摊平**这件事只在 `unfoldRows` 里判一次。
        // 展示层读它换图标 / 换 aria-pressed / 换 data-tip 文案是正当的，不在此列 ——
        // 所以这里不禁止裸 `unfoldSeries ?`（那会误伤 `<Icon icon={unfoldSeries ? … }>`）。
        // 真正要禁的是「绕过 unfoldRows 自己去比条件」：
        expect(mediaSrc).not.toMatch(/unfoldSeries\s*\|\|\s*searching/);
        expect(mediaSrc).not.toMatch(/searching\s*\|\|\s*unfoldSeries\s*\?\s*listFlatRows/);
        // `seriesRows` 只许经 `unfoldRows` 分叉，⛔ 不许直接读 unfolding 的两个源
        expect(mediaSrc).toMatch(/\$: seriesRows = unfoldRows \?/);
        // `searching` 仍要单独存在（列表视图那条 `listGrouping && !searching` 走的是它）
        expect(mediaSrc).toMatch(/listGrouping && !searching/);
    });

    it('searching 的语义没被改写（⛔ 别把它变成「搜索或摊平」）', () => {
        expect(mediaSrc).toMatch(/\$: searching = debouncedSearch\.trim\(\)\.length > 0;/);
    });
});

describe('⑬ 按钮位置与形态', () => {
    it('按钮放在 `.rl-vb-view` 容器内部、且排在下拉按钮**之前**（= 左旁）', () => {
        const viewIdx = mediaSrc.indexOf('<span class="rl-vb-view"');
        const btnIdx = mediaSrc.indexOf('class="rl-vb-unfold"');
        const dropdownIdx = mediaSrc.indexOf('class="rl-vb-btn"');
        expect(viewIdx).toBeGreaterThan(-1);
        expect(btnIdx).toBeGreaterThan(viewIdx);
        expect(btnIdx).toBeLessThan(dropdownIdx);
    });

    it('图标用本仓已在用的 layers / layout-grid（⛔ 不猜新名字）', () => {
        expect(mediaSrc).toMatch(/<Icon icon=\{unfoldSeries \? 'layout-grid' : 'layers'\} size=\{14\} \/>/);
        // 反向：strip 后不许出现这两个没在仓库出现过、只在注释里被提到的名字
        // ⚠️ 必须用 strip 后的文本：原文注释里刻意写了「别猜 folder-stack / gallery-vertical」，
        //    拿原文断言会立刻被自己的注释打穿（#379 / #730 / #731 同款）。
        expect(mediaSrc).not.toMatch(/folder-stack|gallery-vertical/);
    });

    it('可访问性：aria-pressed + data-tip，⛔ 不许同时挂 aria-label（#670 双层气泡）', () => {
        const btn = mediaSrc.slice(mediaSrc.indexOf('class="rl-vb-unfold"'));
        const chunk = btn.slice(0, btn.indexOf('</button>'));
        expect(chunk).toMatch(/aria-pressed=\{unfoldSeries\}/);
        expect(chunk).toMatch(/data-tip=\{unfoldSeries/);
        expect(chunk).not.toMatch(/aria-label/);
        // 点击回推的是**取反后的当前值**
        expect(chunk).toMatch(/on:click=\{\(\) => onToggleUnfoldSeries\?\.\(!unfoldSeries\)\}/);
    });

    it('未接线（null）时整枚不渲染 —— 不画点了没反应的按钮', () => {
        const idx = mediaSrc.indexOf('class="rl-vb-unfold"');
        // 往前找最近的 `{#if` 条件必须是 onToggleUnfoldSeries
        const before = mediaSrc.slice(0, idx);
        const lastIf = before.lastIndexOf('{#if ');
        expect(mediaSrc.slice(lastIf, idx)).toMatch(/\{#if onToggleUnfoldSeries\}/);
    });
});

describe('⑬ 样式：无边框透明化 + 高度与下拉对齐', () => {
    it('高度与 `.rl-vb-btn` 同一把尺（var(--input-height)），且无边框 / 无底色', () => {
        const m = /\.rl-vb-view \.rl-vb-unfold \{([\s\S]*?)\}/.exec(mediaStyle);
        expect(m).not.toBeNull();
        const body = m ? m[1] : '';
        expect(body).toMatch(/height:\s*var\(--input-height\);/);
        expect(body).toMatch(/border:\s*0;/);
        expect(body).toMatch(/background:\s*transparent;/);
        expect(body).toMatch(/box-shadow:\s*none;/);
    });

    it('选择器必须是两级（压过宿主 button:not(.clickable-icon) 的灰底）', () => {
        // 单类 `.rl-vb-unfold {` 特异度 0,1,0 压不过宿主 0,1,1 —— 本仓老坑（ReaderPanelBase.ts:1633）
        expect(mediaStyle).toMatch(/\.rl-vb-view \.rl-vb-unfold \{/);
        expect(mediaStyle).not.toMatch(/^\s*\.rl-vb-unfold \{/m);
    });

    it('激活态只改颜色，⛔ 不铺色块（用户要透明化）', () => {
        const m = /\.rl-vb-view \.rl-vb-unfold\.is-on \{([\s\S]*?)\}/.exec(mediaStyle);
        expect(m).not.toBeNull();
        const body = m ? m[1] : '';
        expect(body).toMatch(/color:\s*var\(--interactive-accent\);/);
        expect(body).not.toMatch(/background/);
    });
});

describe('⑬ 宿主透传：初始 props 与增量 $set 两处都要有', () => {
    it('HomeView.svelte 声明并下传两个 prop', () => {
        expect(homeSrc).toMatch(/export let unfoldSeries = false;/);
        expect(homeSrc).toMatch(/export let onToggleUnfoldSeries: \(\(next: boolean\) => void\) \| null = null;/);
        expect(homeSrc).toMatch(/\{unfoldSeries\}/);
        expect(homeSrc).toMatch(/\{onToggleUnfoldSeries\}/);
    });

    it('HomeView.ts 初始 props 有 unfoldSeries（undefined ⇒ false）', () => {
        expect(homeTsSrc).toMatch(/unfoldSeries: this\.plugin\.settings\.unfoldSeries === true,/);
        expect(homeTsSrc).toMatch(/onToggleUnfoldSeries: \(next: boolean\) => void this\.plugin\.setUnfoldSeries\(next\),/);
    });

    it('HomeView.ts 增量 $set 也有（漏了 = 点了要重开视图才生效）', () => {
        const setIdx = homeTsSrc.indexOf('this.component.$set({');
        expect(setIdx).toBeGreaterThan(-1);
        const line = homeTsSrc.slice(setIdx).split('\n')[0];
        expect(line).toMatch(/unfoldSeries: this\.plugin\.settings\.unfoldSeries === true/);
    });
});
