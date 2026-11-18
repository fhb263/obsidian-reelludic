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
