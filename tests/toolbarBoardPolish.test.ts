// 用户 m12719 三条观感修正 —— 源码级守卫
//
//   ① 首页视图切换下拉项旁边的「视图」文字标签删掉；
//   ② 统计页各模块（除评分看板外）高度对齐；
//   ③ 统计看板系列卡名称超长要出省略号。
//
// 为什么是源码文本守卫：三条全是纯 CSS / 模板层改动 —— tsc 与 svelte-check 都看不见
// 「白卡片底边差一截」「省略号落在看不见的位置」这类问题，只有把口径钉成字面量才有护栏。
//
// ⛔ 铁律：先 strip 注释再匹配（本仓已被自己的注释打穿三次：#379 / #730 / #731）。
//    这里用**单次交替正则**；且注意本文件里的注释本身就写了 `.rl-sel-label` 这些类名，
//    所以每条断言都必须跑在 `stripComments` 之后的文本上。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 单次交替扫描：先遇到 `/*` 就吃到 `*/`，先遇到 `//` 就吃到行尾 */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const viewChips = stripComments(read('src/views/components/ViewChips.svelte'));
const statsBoard = stripComments(read('src/views/components/StatsBoard.svelte'));
const ratingBoard = stripComments(read('src/views/components/RatingBoard.svelte'));

/** 取 `<style>` 段（只在这一段里断言 CSS，⛔ 别在全文里 match 同名类） */
function styleBody(code: string, file: string): string {
    const i = code.indexOf('<style>');
    const j = code.indexOf('</style>');
    if (i < 0 || j < 0) throw new Error(`${file} 里没找到 <style> 段`);
    return code.slice(i, j);
}

/** 取「模板」段（`<script>` 之后、`<style>` 之前），别让 CSS 里的同名类干扰模板断言 */
function templateBody(code: string): string {
    const s = code.indexOf('</script>');
    const i = code.indexOf('<style>');
    if (i < 0) throw new Error('没找到 <style> 段');
    return code.slice(s < 0 ? 0 : s, i);
}

/** 取某个选择器的**全部** CSS 规则体（`{` 到 `}` 之间）；同一个类在文件里可能被拆成两条规则 */
function rulesOf(css: string, selector: string): string[] {
    const out: string[] = [];
    const needle = selector + ' {';
    let from = 0;
    for (;;) {
        const at = css.indexOf(needle, from);
        if (at < 0) break;
        const open = css.indexOf('{', at);
        const close = css.indexOf('}', open);
        if (open < 0 || close < 0) break;
        out.push(css.slice(open + 1, close));
        from = close + 1;
    }
    return out;
}
/** 同上，但把同名规则的规则体拼成一段（⛔ 只取第一条会漏掉后来补的那条） */
function ruleOf(css: string, selector: string): string {
    return rulesOf(css, selector).join('\n');
}

describe('m12719 ① 「视图」标签退场（用户：「首页视图切换下拉项旁边的"视图"删除掉」）', () => {
    const tpl = templateBody(viewChips);
    const css = styleBody(viewChips, 'ViewChips.svelte');

    it('模板两个分支都不再有 `视图` 文字标签', () => {
        expect(tpl).not.toContain('视图</span>');
        expect(tpl).not.toContain('rl-sel-label');
    });

    it('🔴 两处分支都还在（只删标签，⛔ 别把兜底分支一起删了）', () => {
        // 正常分支：MiniSelect 还在
        expect(tpl).toContain('<MiniSelect');
        expect(tpl).toContain('ariaLabel="分类视图"');
        // 脏数据兜底分支：`.rl-viewpick-none` 还在
        expect(tpl).toContain('rl-viewpick-none');
        expect(tpl).toContain('{fallback}');
    });

    it('🔴 `.rl-sel-label` 规则整条删除（留着就是 Unused CSS selector，顶破 89 基线）', () => {
        expect(css).not.toContain('.rl-sel-label');
    });

    it('`.rl-viewpick` 不再留 `gap`（只剩一个子元素，间距没有间距可言）', () => {
        const rule = ruleOf(css, '.rl-viewpick');
        expect(rule).not.toBe('');
        expect(rule).not.toMatch(/gap\s*:/);
        // 但盒模型本身不能丢：仍是 inline-flex + 不参与拉伸
        expect(rule).toMatch(/display:\s*inline-flex/);
        expect(rule).toMatch(/align-items:\s*center/);
        expect(rule).toMatch(/flex:\s*none/);
    });

    it('反向守卫：⛔ 别顺手把「状态 / 排序」的标签也删了（用户只点了「视图」这一枚）', () => {
        // 那两枚在 MediaList 里，本组件范围内不该出现它们，但要保证本文件没被改成"全删标签"
        expect(css).not.toContain('rl-sel-label');
        // 「状态 / 排序」的标签口径仍在 MediaList —— 见 tests/collectionToolbarParity.test.ts 的逐字守卫
        expect(viewChips).toContain('VIEW_KIND_LABELS.default');
    });
});

describe('m12719 ② 统计页模块高度对齐（用户：「各个模块（除评分看板外的）要高度对齐」）', () => {
    const css = styleBody(statsBoard, 'StatsBoard.svelte');

    it('🔴 真因口径：`.rl-sb-block` 必须是纵向 flex（只靠 grid stretch 拉不高内层卡片）', () => {
        const rule = ruleOf(css, '.rl-sb-block');
        expect(rule).not.toBe('');
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/flex-direction:\s*column/);
    });

    it('🔴 区块内容吃掉剩余高度：`.rl-s-panel` / `.rl-hero` / `.rl-s-block` 三支都要 `flex: 1 1 auto`', () => {
        // 三支写在**同一个选择器列表**里（只跟一个 `{`），所以不能逐个按 `类名 + {` 去找。
        // 这里直接抓「以 `.rl-sb-block > .rl-s-panel` 开头、到下一个 `}` 为止」的那一整组。
        const group = /\.rl-sb-block > \.rl-s-panel[\s\S]*?\}/.exec(css)?.[0] ?? '';
        expect(group).not.toBe('');
        // 三支都在同一组（⛔ 分三条各写一遍，很容易漏掉后来新增的块类型）
        expect(group).toContain('.rl-sb-block > .rl-hero');
        expect(group).toContain('.rl-sb-block > .rl-s-block');
        expect(group).toMatch(/flex:\s*1 1 auto/);
        // `min-height: 0` 是配套的：块内若有滚动区（今日动态列表），不给它会撑破整块
        expect(group).toMatch(/min-height:\s*0/);
    });

    it('🔴 选择器必须是**子选择器** `>`，⛔ 别改成后代选择器（`.rl-s-panel` 在别处也有嵌套用法）', () => {
        expect(css).toMatch(/\.rl-sb-block > \.rl-s-panel/);
        expect(css).toMatch(/\.rl-sb-block > \.rl-hero/);
        expect(css).toMatch(/\.rl-sb-block > \.rl-s-block/);
        // 反向：不许出现不带 `>` 的宽泛写法
        expect(css).not.toMatch(/\n\s*\.rl-sb-block \.rl-s-panel \{/);
    });

    it('🔴 hero 是 grid：两列子项也要吃满（否则半栏下又露出下半截空白）', () => {
        expect(css).toMatch(/\.rl-sb-block > \.rl-hero > \.rl-hero-main[\s\S]{0,200}?height:\s*100%/);
        expect(css).toMatch(/\.rl-sb-block > \.rl-hero > \.rl-hero-side[\s\S]{0,200}?height:\s*100%/);
    });

    it('反向守卫：⛔ 不许新增 `container-type`（assert 钉着「只许两处」）', () => {
        const hits = css.match(/container-type\s*:/g) ?? [];
        expect(hits).toHaveLength(1); // 本文件里只有 `.rl-sb-block` 那一处
        expect(css).toMatch(/\.rl-sb-block \{[^}]*container-type:\s*inline-size/);
    });

    it('反向守卫：`.rl-sb-blocks` 的 `gap` 变量仍在（statsAlign 守卫依赖这行）', () => {
        expect(css).toMatch(/\.rl-sb-blocks\s*\{[^}]*gap:\s*var\(--rl-sb-gap/);
        expect(css).toMatch(/\.rl-sb-blocks\s*\{[^}]*align-items:\s*stretch/);
    });

    it('反向守卫：⛔ 不许用 `position: absolute` 之类把面板拉满（会破坏拖拽落点指示）', () => {
        const rule = ruleOf(css, '.rl-sb-block');
        expect(rule).not.toMatch(/position:\s*absolute/);
        expect(rule).not.toMatch(/height:\s*100%/); // 高度由 grid stretch 给，⛔ 不写死
    });
});

describe('m12719 ③ 评分看板系列卡名称省略号（用户：「系列卡展示的名称要加截断的要加省略号」）', () => {
    const css = styleBody(ratingBoard, 'RatingBoard.svelte');

    it('🔴 合集标题走整宽（竖排口径）：不再需要 `width: auto` 那枚横排补丁', () => {
        // 🔴 m13127 ① 把合集卡从「横排（封面在左 + 标题在右）」改回「竖排（标题在封面下面）」之后，
        //    `width: auto` 这枚补丁的前提（`flex: 1 1 auto` 的横排子项）已经不存在 ⇒ 补丁一并退场。
        //    ⚠️ 这不是放宽断言：真正要守的是「标题盒宽度 = 卡片宽度」，竖排下由 `width: 100%` 给。
        const rule = ruleOf(css, '.rl-board-title-coll');
        expect(rule).not.toBe('');
        expect(rule).toMatch(/width:\s*100%/);
        expect(rule).not.toMatch(/width:\s*auto/);
    });

    it('🔴 基类 `width: 100%` 与 `white-space: nowrap` 必须保留（竖排单条卡靠它撑满封面宽）', () => {
        const base = ruleOf(css, '.rl-board-title');
        expect(base).not.toBe('');
        expect(base).toMatch(/width:\s*100%/);
        expect(base).toMatch(/white-space:\s*nowrap/);
        expect(base).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('合集标题仍保留 2 行钳制链（缺一环省略号就不出现）', () => {
        const rule = ruleOf(css, '.rl-board-title-coll');
        expect(rule).toMatch(/display:\s*-webkit-box/);
        expect(rule).toMatch(/-webkit-line-clamp:\s*2/);
        expect(rule).toMatch(/-webkit-box-orient:\s*vertical/);
        expect(rule).toMatch(/line-clamp:\s*2/); // 标准属性，svelte-check 会提示兼容性
        expect(rule).toMatch(/overflow:\s*hidden/);
        // 文字盒不肯缩的话 ellipsis 永远不出现
        expect(rule).toMatch(/min-width:\s*0/);
    });

    it('🔴🔴 合集标题的宽度上限必须与封面**同一口径**（否则名称横跨两格）', () => {
        // 用户（2026-11-14）：「评分看板的系列卡显示名称还是占了两个格子修复它」。
        // 真机量测（1440×900）旧值：单条卡 61px / 合集卡 130px / 合集封面 64px / 合集标题 **130px、max-width: none**。
        // 根因 = 合集卡 `grid-column: span 2` 占两格（有意为之），封面已被上限收在一格，
        //        但标题只有 `width: 100%`（= 两格）⇒ 文字盒横跨两格居中。
        // ⇒ 标题必须与封面复用**同一个** CSS 变量上限，⛔ 别另写一个写死的 px（那样缩放手感会脱节）。
        const title = ruleOf(css, '.rl-board-title-coll');
        const cover = ruleOf(css, '.rl-board-card-coll .rl-board-cov-coll');
        expect(title).toMatch(/max-width:\s*var\(--rl-board-card-max/);
        expect(cover).toMatch(/max-width:\s*var\(--rl-board-card-max/);
        // ⛔ 反向守卫：不许写死 px（换缩放档位时会与封面脱节）
        expect(title).not.toMatch(/max-width:\s*\d+px/);
    });

    it('反向守卫：⛔ 不许用 `!important` 压基类（会把后续所有覆盖都堵死）', () => {
        const rule = ruleOf(css, '.rl-board-title-coll');
        expect(rule).not.toContain('!important');
    });

    it('反向守卫：合集标题的 `white-space` 必须是 normal（nowrap 会让行钳制变成 1 行裁切）', () => {
        const rule = ruleOf(css, '.rl-board-title-coll');
        expect(rule).toMatch(/white-space:\s*normal/);
        expect(rule).not.toMatch(/white-space:\s*nowrap/);
    });
});

describe('m13127 ① 评分看板系列卡名称必须落在封面**下面**（用户：「名称移到第二张卡片的位置上了修复它」）', () => {
    const css = styleBody(ratingBoard, 'RatingBoard.svelte');

    it('🔴 合集卡是竖排（column），⛔ 不是横排（row）', () => {
        // 真机量测过的报障：横排 + `span 2` ⇒ 标题作为第二个 flex 子项落在**第二格的横向位置**
        // （`box.x=438 w=130` 而标题 `x=506 w=62`）。用户把这种几何描述成「移到第二张卡片的位置」。
        const card = ruleOf(css, '.rl-board-card-coll');
        expect(card).not.toBe('');
        expect(card).toMatch(/flex-direction:\s*column/);
        expect(card).not.toMatch(/flex-direction:\s*row/);
        // 横排时代的 `align-items: stretch` 会把封面拉成整行高，一并退场
        expect(card).not.toMatch(/align-items:\s*stretch/);
    });

    it('🔴 合集封面按**一格宽**居中（占两格后整卡宽会把 `2/3` 撑成 195px 高）', () => {
        const cov = ruleOf(css, '.rl-board-card-coll .rl-board-cov-coll');
        expect(cov).not.toBe('');
        expect(cov).toMatch(/width:\s*100%/);
        // 上限复用单条卡的变量，随手感缩放一起长，⛔ 不要另立一个写死的 px
        expect(cov).toMatch(/max-width:\s*var\(--rl-board-card-max/);
        // ⛔ 不要再钉回横排时代那个 62px
        expect(cov).not.toMatch(/flex:\s*0 0 62px/);
    });

    it('反向守卫：合集卡不许再出现「右栏文字」式几何（62px 封面 + 横向 gap 6px）', () => {
        const card = ruleOf(css, '.rl-board-card-coll');
        expect(card).not.toMatch(/gap:\s*6px/);
    });
});

describe('m02377 评分看板合集卡必须与单条卡**占一样大的格**（用户：「还是系列卡显示大一点，导致不对齐的问题」）', () => {
    const css = styleBody(ratingBoard, 'RatingBoard.svelte');

    it('🔴🔴 合集卡不许再 `grid-column: span 2`（它比同行单条卡宽一倍、右半边空着，整行参差）', () => {
        // 沿革：2026-10-27 为了「合集卡比单条卡显眼」加了 `span 2`；先后两次被打回 ——
        //   m13127 ①「封面下面名称移到第二张卡片的位置上」（横排时标题串到邻格）；
        //   m01627 ①「系列卡显示名称还是占了两个格子」（标题宽度也跨两格）；
        //   m02377「还是系列卡显示大一点，导致不对齐」⇒ 用户最终裁定方案 A：**占位与单条卡一致**。
        // ⚠️ 显眼不再靠「更宽」，靠的是**右下角叠角部数** + 打开后是整组。
        const card = ruleOf(css, '.rl-board-card-coll');
        expect(card).not.toBe('');
        expect(card).not.toMatch(/grid-column:\s*span\s*2/);
        expect(card).not.toMatch(/grid-column/); // 占一格 = 不写这条，别写 span 1 绕过去
    });

    it('🔴 随之必须去掉 `max-width: none`（那是给占两格用的解禁；占一格后稀疏行会被拉成巨图）', () => {
        // 基类 `.rl-board-card` 的 `max-width: var(--rl-board-card-max, 104px)` 是「整行只 1 件
        // 被拉成 1184px 巨图」的唯一护栏（#687/#689 实测踩过）⇒ 合集卡不许把它解禁掉。
        const card = ruleOf(css, '.rl-board-card-coll');
        expect(card).not.toMatch(/max-width:\s*none/);
        // 正向：基类那条护栏仍在（合集卡复用同一条规则，不额外覆盖）
        const base = ruleOf(css, '.rl-board-card');
        expect(base).toMatch(/max-width:\s*var\(--rl-board-card-max/);
    });

    it('合集卡仍是竖排 + 封面整卡宽（摊平的只是占位大小，⛔ 不是把卡片摊平）', () => {
        const card = ruleOf(css, '.rl-board-card-coll');
        expect(card).toMatch(/flex-direction:\s*column/);
        const cov = ruleOf(css, '.rl-board-card-coll .rl-board-cov-coll');
        expect(cov).toMatch(/width:\s*100%/);
        // 与单条卡同一条上限变量（随手感缩放一起长）
        expect(cov).toMatch(/max-width:\s*var\(--rl-board-card-max/);
    });

    it('反向守卫：⛔ 别把合集卡整个删掉（用户明确否掉了「彻底不折叠」那一版）', () => {
        // 用户 2026-10-27 裁定「加合集分」，方案 B（改用 `buildBoard`、看板上不再出现系列卡）
        // 会让合集分在看板上**再也看不到也拖不了** —— 用户 m02377 已明确选 A 否 B。
        expect(ratingBoard).toMatch(/buildSeriesBoard/);
        expect(ratingBoard).not.toMatch(/buildBoard\(/);
        expect(ratingBoard).toMatch(/rl-board-coll-n/); // 叠角部数：一眼看出这一格代表几部
    });

    it('🔴🔴 标题区必须有「两行下限」（同排合集卡折两行、单条卡一行 ⇒ 底部差 13px 参差不齐）', () => {
        // 🔴 这条是**真机量测**才发现的：占位摊平后（m02377 方案 A）宽度一致了，
        //   但合集名普遍 5~20 字会被钳到两行（h≈27px），单条卡标题一行（h≈14px），
        //   同一行两种卡**底边差 13px**（实测单条卡 h=103 / 合集卡 h=116）。
        //   解法是给基类 `.rl-board-title` 一条 `min-height`，把单条卡的下沿压到同一基线。
        // ⚠️ 用 `em` 不用 `px` —— 字号随主题 / 用户字号缩放变，写死 px 在大字号下会反过来截断。
        // ⚠️ 数值 = 2 × `line-height: 1.3` ⇒ **改 line-height 必须同步改这里**（反向守卫盯着配对）。
        const title = ruleOf(css, '.rl-board-title');
        expect(title).toMatch(/min-height:\s*2\.6em/);
        // 反向守卫：min-height 必须与行钳制行数配得上（= 2 行）
        expect(title).toMatch(/line-height:\s*1\.3/);
        // ⛔ 不许写成 px（会与字号缩放脱节）
        expect(title).not.toMatch(/min-height:\s*\d+px/);
    });
});
