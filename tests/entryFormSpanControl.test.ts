// 条目属性的「宽度」控件形态（2026-11-12 第 20 轮 ③-5，m00353）。
//
// 🔴 由来（用户逐字）：「去掉每个输入框下面那排紫色胶囊按钮，改为输入框右上角一个极小图标
//    （如 `layout-template`），点击才弹出下拉选 1/1、1/2、1/3」。
//
// 病灶：`renderEntryFormPanel` 里每个属性块底部都常驻一行
//    `[整行|1⁄2|1⁄3] [✕]`（`.rl-ef-seg` / `.rl-ef-segbtn`，三枚按钮 + 一枚隐藏按钮）。
//    11 块 = 33 枚按钮常驻，且「1⁄3 宽块只有约 120px」时那行还会自己换行撑高 ——
//    这正是用户说的「视觉层级混乱、页面很碎」。
//
// 修法 = 把「三枚常驻按钮」换成一枚**右上角小图标**（`ghostIconButton`），点开走
//    Obsidian 原生 `Menu`（用户 ③-5 硬约束「强制使用原生 API，不要手搓」）。
//
// ⚠️ 为什么是源码文本守卫：本仓没有设置页的组件级测试基建，而这些失效形态全是
//    **静默降级** —— 退回手搓按钮、块内动作冒泡到块（块自己是 `role="button"` + 可拖）、
//    菜单点当前档却真的重写一遍、CSS 退回写死像素。tsc / svelte-check 都不会说话。
//
// ⛔ 铁律：先 strip 注释再匹配（本仓已被自己的注释打穿三次：#379 / #730 / #731）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'src/Settings.ts'), 'utf8');
const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** 取出某个方法的源码（从 `private <name>(` 到下一个 `\n    private ` 之间） */
function methodBody(source: string, name: string): string {
    const start = source.indexOf(`private ${name}(`);
    expect(start, `找不到方法 ${name}`).toBeGreaterThan(-1);
    const rest = source.slice(start);
    const end = rest.indexOf('\n    private ', 10);
    return end < 0 ? rest : rest.slice(0, end);
}

describe('条目属性 · 宽度控件收成图标 + 原生菜单（③-5）', () => {
    const panel = methodBody(src, 'renderEntryFormPanel');

    it('🔴 宽度控件走 `ghostIconButton` + `layout-template`，⛔ 不再手搓三枚分段按钮', () => {
        expect(panel).toContain('ghostIconButton(');
        expect(panel).toContain("'layout-template'");
        // 反向守卫：旧的三枚常驻按钮形态不许回潮
        expect(panel).not.toContain('rl-ef-segbtn');
        expect(panel).not.toContain("cls: 'rl-ef-seg'");
    });

    it('🔴 展开走 Obsidian 原生 `Menu`，且菜单浮在按钮下方（不是自绘下拉）', () => {
        // 用户 ③-5 硬约束：强制原生 API。自绘下拉会丢键盘导航 / 焦点陷阱 / 边缘翻转。
        expect(panel).toContain('new Menu()');
        expect(panel).toContain('menu.showAtPosition(');
        expect(panel).toContain('aria-haspopup');
        // `setIsLabel` 那一条是「当前宽度」的只读标题行，没有它用户点开菜单看不出当前档
        expect(panel).toContain('setIsLabel(true)');
    });

    it('🔴 菜单里的项覆盖全部三档，且当前档禁用（点当前档不该白写一次盘）', () => {
        expect(panel).toContain('for (const preset of ENTRY_FORM_SPAN_PRESETS)');
        expect(panel).toContain('setDisabled(true)');
    });

    it('🔴 块内动作必须掐断冒泡（块自己是 `role="button"` 且可拖）', () => {
        // 少了 stopPropagation，点宽度图标会同时触发块的「选中 / 开始拖动」。
        const spanIdx = panel.indexOf('spanBtn.addEventListener(');
        expect(spanIdx, '找不到宽度图标的点击处理').toBeGreaterThan(-1);
        const seg = panel.slice(spanIdx, spanIdx + 700);
        expect(seg).toContain('ev.stopPropagation()');
    });

    it('🔴 CSS：工具行绝对定位到块右上角、默认不抢视线，触屏常显', () => {
        // 默认 `opacity: 0` 而不是 `display: none` —— 后者会让键盘 Tab 永远到不了。
        expect(css).toContain('.rl-ef-tools {');
        expect(css).toMatch(/\.rl-ef-tools\s*\{[\s\S]{0,400}?position:\s*absolute/);
        expect(css).toMatch(/\.rl-ef-tools\s*\{[\s\S]{0,400}?opacity:\s*0;/);
        expect(css).toContain('.rl-ef-blk:hover .rl-ef-tools');
        expect(css).toContain('.rl-ef-blk:focus-within .rl-ef-tools');
        // 触屏没有 hover，不常显就永远改不了宽度
        expect(css).toMatch(/@media\s*\(hover:\s*none\)/);
        // 绝对定位必须有定位祖先
        expect(css).toMatch(/\.rl-ef-blk\s*\{[\s\S]{0,600}?position:\s*relative/);
    });

    it('🔴 CSS：旧的分段器样式已删干净（没有 DOM 会产生它们了）', () => {
        expect(css).not.toContain('.rl-ef-segbtn');
        expect(css).not.toMatch(/\.rl-ef-seg\s*\{/);
    });

    it('🔴 2026-11-14 用户 m03626 ③：布局编辑区是「一整个无缝的网格」', () => {
        // 用户原话：「去掉所有多余的边框，让它们看起来像一整个无缝的网格」。
        // 判据：块的样式块里 ⛔ 不许有 border / border-radius，背景必须是 transparent
        // （11 张各自描边的小卡 = 不是网格）。
        const blk = /\.rl-ef-blk\s*\{([\s\S]*?)\}/.exec(css);
        expect(blk, '找不到 .rl-ef-blk 样式块').not.toBeNull();
        const body = blk![1];
        expect(body).toContain('background: transparent');
        expect(body).toMatch(/border:\s*none/);
        expect(body).toMatch(/border-radius:\s*0/);
        // ⚠️ 不许出现 `border: 1px solid`（那正是被判「多余边框」的东西）
        expect(body).not.toMatch(/border:\s*1px/);
        // 悬停只提亮底色，⛔ 不改边框（改边框会让块宽 +1px、整行错位）
        const hover = /\.rl-ef-blk:hover\s*\{([\s\S]*?)\}/.exec(css);
        expect(hover).not.toBeNull();
        expect(hover![1]).toContain('background: var(--background-modifier-hover)');
        expect(hover![1]).not.toContain('border');
        // 画布外框由虚线改实线（虚线是「占位示意」的语义，成品排版不该虚）
        const canvas = /\.rl-ef-canvas\s*\{([\s\S]*?)\}/.exec(css);
        expect(canvas).not.toBeNull();
        expect(canvas![1]).toMatch(/border:\s*1px solid/);
        expect(canvas![1]).not.toContain('dashed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 2026-11-15 用户 m07047（逐字）：「高级设置-条目属性排序**不要显示第一行了**，
//    如标题、年份、评分来源都不要显示，都是固定的不能改换顺序」
//
// 口径翻面史（⛔ 别只记最后一条，否则很容易把灰块又加回去）：
//   ① 2026-11-14：`meta` 转固定，面板**整体剔除**（不画）；
//   ② m06462：「固定的不可改变也要显示预览变灰（不可拖动）按各自调序占位」⇒ 画成灰块；
//   ③ m07047（现行）：**灰块方案整体退场**，固定项一个都不画 —— 用户认为「既然改不了顺序，
//      画出来只会让人以为能拖」。固定键扩到五个年份键 + `meta`。
//
// 病灶（现行实现若退化）：`allDefs` 若不再过滤固定键，画布上会重新冒出灰块；
//   固定键若被塞回 `cur`，拖动/↑↓ 的下标全部错位，用户能把「固定」的东西拖走。
//
// ⚠️ 同样是源码文本守卫：这些都是**静默降级** —— 有人顺手把过滤去掉，屏幕上不会有任何报错，
//    只是用户又开始看见一堆动了也没用的块。
describe('条目属性 · 固定项一律不画（m07047）', () => {
    const panel = methodBody(src, 'renderEntryFormPanel');

    it('🔴 固定键必须在 allDefs 上就被滤掉（面板里一个固定块都不许画）', () => {
        // 正向：allDefs 的赋值里必须有一道 entryFormFieldIsFixed 过滤
        const assign = /const allDefs\s*=([^;]+);/.exec(panel);
        expect(assign, '找不到 allDefs 赋值').not.toBeNull();
        expect(assign![1]).toContain('entryFormFieldIsFixed');
        // 反向：⛔ 别把 m06462 的「固定项也画出来」那套加回来
        expect(panel).not.toContain("kind: 'fixed'");
        expect(panel).not.toContain('isFixed');
        expect(panel).not.toContain('is-fixed');
        expect(panel).not.toContain('data-fixed');
        expect(panel).not.toContain('buildEntryFormPlan(');
    });

    it('🔴 画布只遍历可管理项：cur.forEach 且下标 i 与 cur 一致', () => {
        // 拖动 / ↑↓ / 删除全按下标取值 ⇒ 渲染序列必须**就是** cur，⛔ 不能再拼一份 renderList
        expect(panel).toContain('cur.forEach((entry, i) =>');
        expect(panel).not.toContain('renderList');
        expect(panel).not.toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*rankOf/);
    });

    it('🔴 工具行与拖拽/键盘无条件挂载（既然只剩可管理项，就不该再有守卫分支）', () => {
        expect(panel).toContain("row.createDiv({ cls: 'rl-ef-tools' })");
        expect(panel).toContain("ghostIconButton('rl-ef-span'");
        expect(panel).toContain("cls: 'rl-ef-x'");
        expect(panel).toContain("row.addEventListener('dragstart'");
        expect(panel).toContain("row.addEventListener('keydown'");
        // 把手同样无条件
        expect(panel).toMatch(/const grip = row\.createSpan\(\{ cls: 'rl-cf-grip' \}\)/);
        // ⛔ 守卫分支已退场
        expect(panel).not.toContain('if (!isFixed)');
    });

    it('🔴 计数分母与隐藏池都只看可管理项（固定键不参与）', () => {
        // allDefs 已滤过固定键 ⇒ 分母直接 allDefs.length；`cur` 也要现滤一遍防旧配置夹带
        expect(panel).toMatch(/counter\.setText\(`显示 \$\{cur\.length\} \/ \$\{allDefs\.length\}`\)/);
        expect(panel).toMatch(/const cur = this\.currentEntryFormFields\(\)\.filter\(\(e\) => !entryFormFieldIsFixed\(e\.key\)\)/);
        expect(panel).toMatch(/allDefs\.map\(\(d\) => d\.key\)\.filter\(\(k\) => !shownKeys\.includes\(k\)\)/);
    });

    it('🔴 CSS 里不许再有 .is-fixed 残留（无 DOM 会产生它，留着就是死代码）', () => {
        expect(css).not.toContain('.rl-ef-blk.is-fixed');
        // 主块仍是 cursor: grab（暗示能拖）—— 这条与上面的结论配套，别一起删了
        expect(css).toMatch(/\.rl-ef-blk\s*\{[\s\S]{0,600}?cursor:\s*grab/);
    });
});
