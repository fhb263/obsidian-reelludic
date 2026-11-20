/**
 * m07854 ⑪ 三子项的守卫（源码级）。
 *
 * ① 计划页必须有「继续观看 / 阅读」第三档，并接上 `ResumeBoard`
 * ② 搜索框宽度必须随窗口收缩（两视图逐字一致，⛔ 不许回到 `flex: none` + 240px）
 * ③ 搜索结果标题关键词高亮（走 pure 切片 + `<mark>`，⛔ 不许 `{@html}`）
 *
 * ⚠️ 铁律：**先 strip 注释再匹配**（#379 / #730 / #731 三次被自己的注释打穿），
 *    且必须用**单次交替**正则 `\/\*[\s\S]*?\*\/|\/\/[^\n]*` —— 分两步（先块后行）会被
 *    注释里的 `/*` 起手点吞掉后面大段真实代码（`main.ts` 的「下载/音乐/**」就踩过）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
/**
 * 🔴 必须**三种**注释一起剥：块注释 `/* *\/`、行注释 `//`、**Svelte 的 HTML 注释** `<!-- -->`。
 *   漏掉最后一种的代价本批实测过：`ResumeBoard.svelte` 头部注释里写了「别在这里再写一遍
 *   `videoPositions` / `readingProgress` 的判定」，只剥前两种时那句注释仍留在"源码"里，
 *   反向守卫 `not.toMatch(/videoPositions/)` 立刻假红 —— 被自己的注释打穿（#379 同款）。
 * ⚠️ 仍必须**单次交替**：分两步（先块后行）会被注释里的 `/\*` 起手点吞掉后面大段真实代码。
 */
const stripComments = (src: string): string =>
    src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
const read = (rel: string): string => stripComments(readFileSync(resolve(ROOT, rel), 'utf8'));

const homeSrc = read('src/views/components/HomeView.svelte');
const mediaSrc = read('src/views/components/MediaList.svelte');
const collSrc = read('src/views/components/CollectionBoard.svelte');
const resumeSrc = read('src/views/components/ResumeBoard.svelte');
const highlightSrc = read('src/pure/titleHighlight.ts');

describe('⑪ ① 计划页「继续观看 / 阅读」第三档', () => {
    it('trackingMode 联合类型里有 resume', () => {
        expect(homeSrc).toMatch(/'board'\s*\|\s*'calendar'\s*\|\s*'resume'/);
    });

    it('切换器里有第三颗按钮，且挂 resume 档', () => {
        const switchBody = homeSrc.slice(
            homeSrc.indexOf('class="rl-tracking-switch"'),
            homeSrc.indexOf('class="rl-tracking-switch"') + 1600,
        );
        expect(switchBody).toMatch(/trackingMode === 'resume'/);
        expect(switchBody).toMatch(/trackingMode = 'resume'/);
    });

    it('resume 档渲染 ResumeBoard（不是复用 TrackingBoard）', () => {
        // ⚠️ 真实形态是 `{:else if …}`（三档串联），不是 `{#if …}`，
        //    所以正则必须锚 `\{:else if` —— 第一版写成 `trackingMode === 'resume'\}>` 直接假红。
        expect(homeSrc).toMatch(/\{:else if trackingMode === 'resume'\}[\s\S]{0,120}<ResumeBoard/);
        expect(homeSrc).toMatch(/import ResumeBoard from '\.\/ResumeBoard\.svelte'/);
    });

    it('ResumeBoard 只收它真需要的四个 prop（契约清楚，不多传）', () => {
        const at = homeSrc.indexOf('<ResumeBoard');
        const block = homeSrc.slice(at, at + 300);
        expect(block).toMatch(/\{entries\}/);
        expect(block).toMatch(/\{posterUrl\}/);
        expect(block).toMatch(/\{onOpenEntry\}/);
        expect(block).toMatch(/\{onEditEntry\}/);
        // 更新检测 / 导入那一套与续播无关，⛔ 别顺手带进来
        expect(block).not.toMatch(/onCheckUpdate/);
        expect(block).not.toMatch(/onImportBangumi/);
    });

    it('ResumeBoard 提供卡片 / 列表两种视图并可切换', () => {
        expect(resumeSrc).toMatch(/viewMode:\s*'card'\s*\|\s*'list'/);
        expect(resumeSrc).toMatch(/viewMode = 'card'/);
        expect(resumeSrc).toMatch(/viewMode = 'list'/);
        // 两种视图各自的分支必须都在（否则按了没反应）
        expect(resumeSrc).toMatch(/viewMode === 'card'/);
        expect(resumeSrc).toMatch(/\{:else\}/);
    });

    it('ResumeBoard 的数据判定走 pure，不在组件里重写字段口径', () => {
        expect(resumeSrc).toMatch(/import \{ buildResumeQueue \} from 'pure\/resumeQueue'/);
        // ⛔ 组件不许自己读 videoPositions / readingProgress（那是第二份真源）
        expect(resumeSrc).not.toMatch(/videoPositions/);
        expect(resumeSrc).not.toMatch(/readingProgress/);
    });
});

describe('⑪ ② 搜索框宽度随窗口收缩（两视图逐字一致）', () => {
    it('主视图允许收缩，min-width 不再是 240px', () => {
        const rule = mediaSrc.slice(
            mediaSrc.indexOf('.rl-toolbar .rl-search-wrap'),
            mediaSrc.indexOf('.rl-toolbar .rl-search-wrap') + 200,
        );
        expect(rule).toMatch(/flex:\s*0 1 280px;/);
        expect(rule).toMatch(/min-width:\s*160px;/);
        // ⛔ 反向：`flex: none` + 240px 是「窗口再窄也不让位」的旧口径
        expect(rule).not.toMatch(/flex:\s*none;/);
        expect(rule).not.toMatch(/min-width:\s*240px;/);
    });

    it('合集视图逐字同款（只改一边会让切视图时输入框跳宽度）', () => {
        const rule = collSrc.slice(collSrc.indexOf('.rl-search-wrap {'), collSrc.indexOf('.rl-search-wrap {') + 200);
        expect(rule).toMatch(/flex:\s*0 1 280px;/);
        expect(rule).toMatch(/min-width:\s*160px;/);
        expect(rule).not.toMatch(/flex:\s*none;/);
        expect(rule).not.toMatch(/min-width:\s*240px;/);
    });

    it('两边的三档宽度数值逐字一致', () => {
        const a = mediaSrc.match(/\.rl-toolbar \.rl-search-wrap \{[^}]*\}/)?.[0] ?? '';
        const b = collSrc.match(/\.rl-search-wrap \{[^}]*\}/)?.[0] ?? '';
        for (const frag of ['width: 280px;', 'max-width: 320px;', 'min-width: 160px;']) {
            expect(a).toContain(frag);
            expect(b).toContain(frag);
        }
    });
});

describe('⑪ ③ 搜索结果标题关键词高亮', () => {
    it('切片与判定都来自 pure/titleHighlight（⛔ 别在模板里写第二份 indexOf）', () => {
        expect(mediaSrc).toMatch(/import \{ splitTitleByQuery, titleHasQuery \} from 'pure\/titleHighlight'/);
        expect(mediaSrc).toMatch(/titleHasQuery\(e\.title, debouncedSearch\)/);
        expect(mediaSrc).toMatch(/splitTitleByQuery\(e\.title, debouncedSearch\)/);
    });

    it('高亮走 <mark class="rl-hl">，⛔ 不许 {@html}（标题是用户输入，拼 HTML 就是注入面）', () => {
        expect(mediaSrc).toMatch(/<mark class="rl-hl">\{seg\.text\}<\/mark>/);
        const at = mediaSrc.indexOf('splitTitleByQuery(e.title, debouncedSearch)');
        const block = mediaSrc.slice(at - 200, at + 400);
        expect(block).not.toMatch(/\{@html/);
    });

    it('未命中时走单段分支（不为每张卡多套一层循环）', () => {
        // 🔴 m19456 ① 起：单段分支的标题要走 `maskCardText`（隐藏卡片时打码成 `***`），
        //    不再是裸 `{e.title}` ⇒ 本轮按新形态改判。
        //    ⛔ 判据意图不变：**未命中走单段分支**（不套 `{#each}`），这条仍然钉死。
        expect(mediaSrc).toMatch(/\{:else\}\s*<div class="rl-ttl">\{maskCardText\(ch, e\.title\)\}<\/div>/);
    });

    it('.rl-hl 用主题高亮底色，⛔ 不写死黄色 hex', () => {
        const rule = mediaSrc.slice(mediaSrc.indexOf('.rl-ttl .rl-hl'), mediaSrc.indexOf('.rl-ttl .rl-hl') + 300);
        expect(rule).toMatch(/background:\s*var\(--text-highlight-bg\)/);
        expect(rule).toMatch(/color:\s*inherit;/);
        expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('pure 切片函数是大小写不敏感、且空 query 原样返回单段', () => {
        expect(highlightSrc).toMatch(/raw\.toLowerCase\(\)/);
        expect(highlightSrc).toMatch(/needle\.toLowerCase\(\)/);
        expect(highlightSrc).toMatch(/if \(!needle \|\| !raw\) return \[\{ text: raw, hit: false \}\]/);
    });
});
