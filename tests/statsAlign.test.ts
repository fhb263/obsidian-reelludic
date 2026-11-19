// 统计页各模块排序对齐（用户 m07854 ⑩）—— 源码级守卫
//
// 为什么是源码文本守卫：这一项改的全是 `<style>` 里的盒模型与 SVG viewBox，
// tsc 看不见、svelte-check 也不报（它只查类型），只有把「间距变量化 / 刻度不再被压扁 /
// Tab 与卡片同一条左基线 / 标题换行不悬空」这四件事钉成字面量，回归才有护栏。
//
// ⛔ 铁律：先 strip 注释再匹配（#379 / #730 / #731 三次被自己的注释打穿）。
//    这里必须用**单次交替正则**，不能分两步「先块后行」—— 本仓已有反例（见 #760 的 strip 教训）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 单次交替扫描：先遇到 `/*` 就吃到 `*/`，先遇到 `//` 就吃到行尾 —— 两种嵌套顺序都对 */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const board = read('src/views/components/StatsBoard.svelte');
const code = stripComments(board);
/** 取 `<style>` 段（只在这一段里断言 CSS，⛔ 别在全文里 match 同名类） */
const styleBody = (): string => {
    const i = code.indexOf('<style>');
    const j = code.indexOf('</style>');
    if (i < 0 || j < 0) throw new Error('StatsBoard.svelte 里没找到 <style> 段');
    return code.slice(i, j);
};

describe('⑩ 统计页对齐 · 间距只认两个变量（用户 m07854「统一全局卡片横纵间距」）', () => {
    const css = styleBody();

    it('.rl-sb 声明了块间 / 块内两个间距变量', () => {
        expect(css).toMatch(/--rl-sb-gap:\s*12px;/);
        expect(css).toMatch(/--rl-sb-inner-gap:\s*10px;/);
    });

    it('四处布局都改用变量，⛔ 不再各写各的 px', () => {
        // 块间：区块网格
        expect(css).toMatch(/\.rl-sb-blocks\s*\{[^}]*gap:\s*var\(--rl-sb-gap/);
        // 块内：hero 主网格 / 4 个辅指标 / 概览指标格
        expect(css).toMatch(/\.rl-hero\s*\{[^}]*gap:\s*var\(--rl-sb-inner-gap/);
        expect(css).toMatch(/\.rl-hero-side\s*\{[^}]*gap:\s*var\(--rl-sb-inner-gap/);
        expect(css).toMatch(/\.rl-part-metrics\s*\{[^}]*gap:\s*var\(--rl-sb-inner-gap/);
    });

    it('反向守卫：这四处不许再出现写死的 8px / 10px / 12px 间距', () => {
        expect(css).not.toMatch(/\.rl-hero\s*\{[^}]*gap:\s*10px/);
        expect(css).not.toMatch(/\.rl-hero-side\s*\{[^}]*gap:\s*10px/);
        expect(css).not.toMatch(/\.rl-part-metrics\s*\{[^}]*gap:\s*8px/);
        expect(css).not.toMatch(/\.rl-sb-blocks\s*\{[^}]*gap:\s*12px/);
    });
});

describe('⑩ 统计页对齐 · 趋势图刻度不再被横向压扁（用户「图表自适应撑满、刻度与网格对齐」）', () => {
    it('viewBox 宽度是响应式变量 trendW，⛔ 不是写死的 620', () => {
        expect(code).toMatch(/viewBox=\{`0 0 \$\{trendW\} \$\{TREND_H\}`\}/);
        // 反向：模板里不许再出现 `${TREND_W}` 这种写死宽度的插值
        expect(code).not.toMatch(/\$\{TREND_W\}/);
    });

    it('网格线 / 刻度 / 热区全部跟着 trendW 走（同源才不会错位）', () => {
        // 网格线右端：模板里直接引用 trendW，依赖成立
        expect(code).toMatch(/x2=\{trendW - TREND_PAD_X\}/);
        // 热区宽度
        expect(code).toMatch(/width=\{\(trendW - 2 \* TREND_PAD_X\) \/ 11\}/);
    });

    it('🔴 刻度/圆点/折线的宽度必须**传参**，⛔ 不许在函数体里读闭包 trendW', () => {
        // 根因：Svelte 4 的响应式依赖是编译期按标识符收集的，模板写 `trendTickX(i)`
        // 只看得到函数名、看不进函数体 ⇒ trendW 变了它不知道要重算。实测 viewBox 已从
        // 620 改成 470，刻度 x 仍停在旧宽度算出的 594，跑到 viewBox 外被裁掉。
        expect(code).toMatch(/function trendTickX\(i: number, width: number\): number \{\s*return TREND_PAD_X \+ \(i \* \(width - 2 \* TREND_PAD_X\)\) \/ 11;/);
        expect(code).toMatch(/function trendPts\(arr: number\[\], width: number\): string \{/);
        // 反向守卫：这两个函数体里不许再出现闭包 trendW
        expect(code).not.toMatch(/function trendTickX\(i: number, width: number\)[^}]*trendW/);
        expect(code).not.toMatch(/function trendPts\(arr: number\[\], width: number\)[^}]*trendW/);
        // 五个调用点都要把 trendW 显式传进去
        expect(code).toMatch(/points=\{trendPts\(s\.arr, trendW\)\}/);
        expect(code).toMatch(/cx=\{trendTickX\(i, trendW\)\}/);
        expect(code).toMatch(/x=\{trendTickX\(i, trendW\)\} y=\{TREND_H - 1\}/);
        expect(code).toMatch(/x=\{trendTickX\(i, trendW\) - \(trendW - 2 \* TREND_PAD_X\) \/ 22\}/);
        expect(code).toMatch(/\(trendTickX\(hoverM, trendW\) \/ trendW\) \* 100/);
        // 反向：不许留下单参调用（漏传会让那一处静默停在旧宽度）
        expect(code).not.toMatch(/trendTickX\((?:i|hoverM)\)/);
        expect(code).not.toMatch(/trendPts\(s\.arr\)/);
    });

    it('trendW 由 ResizeObserver 实测喂进来（$: 收不到同元素 resize，必须用 action）', () => {
        expect(code).toMatch(/function trendWidth\(el: SVGSVGElement\)/);
        expect(code).toMatch(/new ResizeObserver\(/);
        expect(code).toMatch(/ro\.observe\(el\);/);
        expect(code).toMatch(/return \{ destroy: \(\) => ro\.disconnect\(\) \};/);
        // 模板必须挂上这个 action
        expect(code).toMatch(/<svg class="rl-trend" use:trendWidth/);
        // 下限保护：别让宽度缩到 0（除零后坐标全 NaN）
        expect(code).toMatch(/Math\.max\(240, Math\.round\(w \* 2\) \/ 2\)/);
    });

    it('⛔ 不许删掉 preserveAspectRatio="none"（删了会等比缩放 + 上下留白）', () => {
        expect(code).toMatch(/preserveAspectRatio="none"/);
    });
});

describe('⑩ 统计页对齐 · Tab 与下方卡片的左基线（用户「下右 Tab 及 2x2 卡片左侧基线完全对齐」）', () => {
    it('.rl-part-body 的 3px 色条 + 7px 内距 = tab 的 10px 内距 ⇒ 同一条竖线', () => {
        const css = styleBody();
        const body = /\.rl-part-body\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
        expect(body).toMatch(/border-left:\s*3px solid/);
        expect(body).toMatch(/padding-left:\s*7px;/);
        // tab 自己的左内距也是 10 —— 3 + 7 = 10
        expect(css).toMatch(/\.rl-s-part \.rl-part-tab\s*\{[^}]*padding:\s*6px 10px;/);
    });

    it('反向守卫：内距不许回到 12px（那正是改前差 5px 的原因）', () => {
        expect(styleBody()).not.toMatch(/\.rl-part-body\s*\{[^}]*padding-left:\s*12px/);
    });
});

describe('⑩ 统计页对齐 · 标题行换行后不悬空（用户「右上按钮组换行时左侧对齐且时间控件靠右」）', () => {
    it('右侧组保留 margin-left:auto（单行贴右）且用 flex-end 排内部', () => {
        const css = styleBody();
        const right = /\.rl-s-title-right\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
        expect(right).toMatch(/margin-left:\s*auto;/);
        expect(right).toMatch(/justify-content:\s*flex-end;/);
        expect(right).toMatch(/flex-wrap:\s*wrap;/);
    });

    it('动态面板标题行仍然是 space-between（标题首、组尾）', () => {
        const css = styleBody();
        const today = /\.rl-s-today \.rl-s-panel-title\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
        expect(today).toMatch(/align-items:\s*center;/);
    });

    it('反向守卫：全局 .rl-s-panel-title 不许被加上 justify-content（会把趋势图的 chips 甩到左边）', () => {
        const css = styleBody();
        const base = /\.rl-s-panel-title\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
        expect(base).not.toMatch(/justify-content:\s*space-between/);
    });
});

// ── m14861：统计区块拖动后切页签「回到原来的位置」 ────────────────────────────
//
// 用户原话（m14861）：「为什么我页签统计的模块拖动了然后切换一下页签就返回原来的位置了」。
//
// 真因不是顺序丢了（`settings.statsOrder` 每次拖动都落盘成功、切页签后也读得回来），
// 而是**列宽算错**：`spanOf(k)` 在函数体里读闭包 `boardWidth`，而 Svelte 4 的依赖分析
// 只看模板表达式里出现的标识符、**看不进函数体** ⇒ 模板 `is-span-{spanOf(k)}` 只登记
// `spanOf` 与 `k`，`boardWidth` 变了这段 class 不失效，列宽永远停在初始的 1200。
//
// 真机实测（修复前，.testvault）：容器 258px（窄于 STATS_NARROW_MAX=719，六块全该整行）时
// `board` 仍渲染 `is-span-2`(258px)、其余 `is-span-1`(123px)，全是按 1200 算的；把视口拉到
// 1600/1200/800/500（容器 608/408/208/66）后 `is-span-N` 类**一个都没变**。切页签会销毁重建
// `StatsBoard`（`boardWidth` 从缺省 1200 重新起步），重建后量到真实宽度 ⇒ 排布与拖动前那套
// 宽度算出来的不一致，于是用户看到「回到原位」。
//
// 修复后真机实测（重启实例加载新包）：608px 下六块**全部** `is-span-1`；拖动后切走再切回，
// 每块的 `is-span-N` 与 x/宽度逐字一致（`SAME=true`）。
describe('⑩ 统计页自适应 · 列宽必须把宽度**传参**给 spanOf（用户 m14861 拖动后复位）', () => {
    it('spanOf 收 width 形参，函数体只转发给 statsBlockCols', () => {
        expect(code).toMatch(/function spanOf\(k: StatsBlockKey, width: number\): 1 \| 2 \{/);
        expect(code).toMatch(/function spanOf\(k: StatsBlockKey, width: number\): 1 \| 2 \{\s*return statsBlockCols\(k, width\);/);
    });

    it('🔴 反向守卫：spanOf 函数体里不许再出现闭包 boardWidth', () => {
        // 写成 `spanOf(k)` + 函数体读 `boardWidth` 时这条会红 —— 那正是缺陷形态。
        expect(code).not.toMatch(/function spanOf\(k: StatsBlockKey, width: number\)[^}]*boardWidth/);
    });

    it('模板调用必须显式传 boardWidth（依赖才成立）', () => {
        expect(code).toMatch(/class="rl-sb-block is-span-\{spanOf\(k, boardWidth\)\}"/);
        // 反向：不许留下单参调用（漏传会让列宽静默停在旧宽度）
        expect(code).not.toMatch(/spanOf\(k\)/);
    });

    it('boardWidth 仍由 ResizeObserver 实测喂进来（判据没被顺手改坏）', () => {
        expect(code).toMatch(/new ResizeObserver\(\(es\) => \{/);
        expect(code).toMatch(/boardWidth = e\.contentRect\.width;/);
        expect(code).toMatch(/boardWidth = sbEl\.clientWidth \|\| boardWidth;/);
        // 初始值必须存在（首帧还没量到宽度时不能是 undefined，否则 statsBlockCols 全返回 2）
        expect(code).toMatch(/let boardWidth = 1200;/);
    });

    it('真源 `statsBlockCols` 的窄屏分支没被绕开（宽度 < 719 ⇒ 一律整行）', () => {
        // 这条防的是「有人为了绕开依赖问题，把窄屏判断塞回模板里」——
        // 那样 `statsBlockCols` 的单元测试与真机行为会分叉。
        expect(code).toMatch(/return statsBlockCols\(k, width\);/);
        // 模板里不许出现硬编码的宽度比较
        expect(code).not.toMatch(/is-span-\{boardWidth/);
    });
});
