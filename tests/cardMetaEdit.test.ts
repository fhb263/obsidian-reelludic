/**
 * m07854 ⑯：**仅卡片网格视图**下，点信息栏 = 原地进「编辑属性」。
 *
 * 用户原话：「仅在**卡片网格**视图下，点击信息栏即可**原地编辑**（直接进入编辑属性窗口）」
 *
 * 为什么是源码文本守卫：`cardGridView` 是组件内 `$:` 派生量、`role`/`tabindex` 是模板上的
 * 条件属性、`stopPropagation()` 在事件处理器里 —— tsc 与 svelte-check 都只保证语法与类型，
 * 不会替我们钉住「只有 grid 能点」「键盘也能进」「别把点击冒泡到卡片根节点」这三条语义。
 *
 * ⛔ 铁律：先 strip 再匹配（#379 / #730 / #731 三次被自己的注释打穿）。
 * 本仓正确写法是**单次交替**正则，且 Svelte 组件的 HTML 注释也要剥 —— 否则注释里解释
 * 「⛔ 别写 !wallView」的那句话会立刻把反向守卫打成假红。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (src: string): string =>
    src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const mediaRaw = read('src/views/components/MediaList.svelte');
const media = strip(mediaRaw);

/** 取某个标记所在**元素自身**的开标签片段（从标记前面最近的 `<` 到其后第一个 `>`）。 */
function tagAround(src: string, marker: string): string {
    const at = src.indexOf(marker);
    if (at < 0) return '';
    const open = src.lastIndexOf('<', at);
    const close = src.indexOf('>', at);
    if (open < 0 || close < 0) return '';
    return src.slice(open, close + 1);
}

/**
 * 信息栏那颗 div 的**唯一**锚。
 * ⚠️ 别用 `class="rl-card-meta"` —— 组卡（`.rl-gcard`）也有一颗同名 class，
 *    `indexOf` 会先撞上它（首跑就这么假红了 5 条）。
 *    只有条目卡的信息栏带 `class:rl-meta-edit={cardGridView}` 这个条件类。
 */
const META_ANCHOR = 'class:rl-meta-edit={cardGridView}';
const metaTag = (): string => tagAround(media, META_ANCHOR);
/** 从锚点起的整段块（含两个事件处理器）。断言处理器内容用它，别用 `metaTag`。 */
const metaBlock = (): string => media.slice(media.indexOf(META_ANCHOR), media.indexOf(META_ANCHOR) + 1400);

describe('#769 ⑯ 判据：只有卡片网格能点', () => {
    it('派生量是 `viewMode === \'grid\'` 严格相等', () => {
        expect(media).toMatch(/\$: cardGridView = viewMode === 'grid';/);
    });

    it('⛔ 不许写成 `!wallView` / `viewMode !== \'wall\'`（会把分组视图一起打开）', () => {
        // 分组视图（`grouped`）与卡片网格共用 `.rl-grid` 容器，但组卡的信息栏是组名、
        // 没有可编辑的条目；写 `!wallView` 就等于给一张没有对象的卡片开编辑。
        expect(media).not.toMatch(/\$: cardGridView = !wallView;/);
        expect(media).not.toMatch(/\$: cardGridView = viewMode !== 'wall';/);
        expect(media).not.toMatch(/role=\{!wallView \? 'button'/);
    });

    it('海报墙不渲染信息栏这条既存口径没被顺手改掉', () => {
        // #624：`{#if !wallView}` 门控着整块 `.rl-card-meta`。
        expect(media).toMatch(/\{#if !wallView\}/);
    });
});

describe('#769 ⑯ 交互：鼠标与键盘都要能进', () => {
    it('click / keydown 都挂在同一元素上', () => {
        // ⚠️ 不能用 `tagAround`：开标签里的第一个 `>` 会落在 `on:click` 的箭头函数 `=>` 上，
        //    窗口一截断，后面的 `on:keydown` 就跑到范围外了（首跑这么假红的）。
        //    改用块切片，够覆盖整颗 div 的属性区与两个处理器。
        const tag = metaBlock();
        expect(tag).toMatch(/on:click=\{/);
        expect(tag).toMatch(/on:keydown=\{/);
    });

    it('click 里先 stopPropagation 再开编辑（否则一次点击会既开笔记又开弹窗）', () => {
        const at = media.indexOf(META_ANCHOR);
        const block = media.slice(at, at + 1400);
        const stopAt = block.indexOf('ev.stopPropagation();');
        const editAt = block.indexOf('onEditEntry(e.id);');
        expect(stopAt).toBeGreaterThan(-1);
        expect(editAt).toBeGreaterThan(-1);
        expect(stopAt).toBeLessThan(editAt);
    });

    it('Enter 与 Space 都认，且 Space 要 preventDefault', () => {
        const at = media.indexOf(META_ANCHOR);
        const block = media.slice(at, at + 1400);
        expect(block).toMatch(/ev\.key !== 'Enter'/);
        expect(block).toMatch(/ev\.key !== ' '/);
        expect(block).toMatch(/ev\.preventDefault\(\);/);
    });

    it('role / tabindex 跟着 cardGridView 一起条件化（⛔ 无条件给 role）', () => {
        const tag = metaTag();
        expect(tag).toMatch(/role=\{cardGridView \? 'button' : undefined\}/);
        expect(tag).toMatch(/tabindex=\{cardGridView \? 0 : undefined\}/);
        // 反向：不许无条件 `role="button"`（非网格视图下它不可点，标成按钮会误导读屏）。
        expect(tag).not.toMatch(/role="button"/);
    });

    it('a11y 基线：动态 role 那条静态分析局限已就地 svelte-ignore', () => {
        // svelte-check 看不出 `role` 与 `tabindex` 由同一个 `cardGridView` 支配，
        // 会把 `tabindex={0}` 判成「非交互元素带非负 tabindex」。
        // ⛔ 不许用删 tabindex 的方式消警告（键盘就进不去了）。
        // ⚠️ 这一条必须读**原文**：`svelte-ignore` 本身是 `<!-- -->` 注释，
        //    strip 之后它就没了（首跑就这么假红了一条）。
        expect(mediaRaw).toMatch(/a11y-no-noninteractive-tabindex/);
        expect(media).toMatch(/tabindex=\{cardGridView \? 0 : undefined\}/);
    });
});

describe('#769 ⑯ 可点态只在网格下出现', () => {
    it('cursor 与 hover 底色挂在 `rl-meta-edit` 条件类上，⛔ 不挂在 `.rl-card-meta` 本体', () => {
        // `.rl-card-meta` 本体在海报墙 / 分组视图下也在（虽然前者不渲染、后者是组名），
        // 给它加 `cursor: pointer` 等于对不可点的地方撒谎。
        const styleAt = media.indexOf('.rl-card-meta {');
        const editAt = media.indexOf('.rl-card-meta.rl-meta-edit {');
        expect(styleAt).toBeGreaterThan(-1);
        expect(editAt).toBeGreaterThan(-1);
        const baseRule = media.slice(styleAt, media.indexOf('}', styleAt) + 1);
        expect(baseRule).not.toMatch(/cursor:\s*pointer/);
        const editRule = media.slice(editAt, media.indexOf('}', editAt) + 1);
        expect(editRule).toMatch(/cursor:\s*pointer;/);
    });

    it('hover 底色走主题变量，⛔ 无 hex', () => {
        const at = media.indexOf('.rl-card-meta.rl-meta-edit:hover');
        expect(at).toBeGreaterThan(-1);
        const rule = media.slice(at, media.indexOf('}', at) + 1);
        expect(rule).toMatch(/background:\s*var\(--background-modifier-hover\)/);
        expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
