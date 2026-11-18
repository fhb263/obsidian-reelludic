/**
 * m07364 导航外观改版的源码级守卫（横向页签 = iOS 分段控制器 / 纵向页签 = 幽灵风）。
 *
 * 用户逐字（m07364）：
 *   「基本设置导航布局的顶部胶囊、文字菜单、合并视图名称改成"横向页签、纵向页签、聚合下拉"视图…
 *    针对横向页签样式的改造为改造方案：采用"iOS 分段控制器 (Segmented)"风格 去边框：把内部所有
 *    小按钮的边框（border）全删掉。做底槽：给最外层的大容器加一个极浅的灰色背景（例如 #F1F3F5），
 *    圆角调大（如 8px 或 10px），去掉大外框的边框线。选中态重构：选中的"电影"，背景色变成纯白色。
 *    文字和图标保持蓝色，加粗。未选中态：背景透明，文字变深灰色（不要用纯黑，用 #4B5563 之类的灰），
 *    图标也跟着变灰。间距：减少按钮之间的间距（仅留 2-4px），让它们看起来是一个整体控件。
 *    …针对纵向页签的改造采用"幽灵风 (Ghost)"…选中项左边出现一条 3px 宽的蓝色竖条，背景变浅灰。」
 *
 * 🔴 这一组守的是**真机才看得见、tsc 与常规单测都不报**的那几处耦合：
 *   ① 指示器的 `top/left/height` 必须与容器 `padding` 同步 —— 它们不是同一个值就能对上的，
 *      `TAB_PAD` 常量还参与位移计算，三者任一不同值 ⇒ 滑块整体偏移或高度不居中。
 *   ② 底槽色必须走 `--background-secondary` 变量（⛔ 不许写死 #F1F3F5）—— 写死会让深色主题失真。
 *   ③ 深色主题下纯白滑块会刺眼 ⇒ 必须有 `body.theme-dark` 覆盖，且浅色保持纯白不变。
 *   ④ 纵向页签选中态的竖条必须用 `border-left-color` 换色（而不是新增元素 / 改 padding），
 *      否则选中项文字会突然右移 3px。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释：本仓注释里大量逐字引用旧写法（含「⛔ 别写 X」这种反例），不剥会把自己的文档打穿反向守卫。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = stripComments(read('src/views/components/HomeView.svelte'));
const NAV = stripComments(read('src/views/components/NavMenu.svelte'));

/**
 * 取某条选择器的规则体（选择器文本 → 花括号内内容）。找不到返回 null。
 *
 * 🔴 必须**按行首锚定**、⛔ 不能用裸 `indexOf(selector)`：
 *   `:global(body.theme-dark) .rl-tabs.rl-tabs-modern .tab-ind {` 里含有
 *   `.rl-tabs.rl-tabs-modern .tab-ind {` 这整段子串，且那条规则在本仓源码里**排在基础规则之前**
 *   ⇒ 裸 indexOf 会取到深色覆盖、把「浅色底必须是纯白」判成失败（本轮实测踩到）。
 */
function ruleBody(src: string, selector: string): string | null {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^[ \\t]*${esc}([^}]*)\\}`, 'm');
    const hit = src.match(re);
    return hit ? hit[1] : null;
}

describe('横向页签 = iOS 分段控制器（m07364）', () => {
    const CONTAINER = '.rl-tabs.rl-tabs-modern {';

    it('🔴 大外框的边框线全删（用户「去掉大外框的边框线」），底槽只靠底色与圆角成形', () => {
        const body = ruleBody(HOME, CONTAINER);
        expect(body).not.toBeNull();
        expect(body).toMatch(/border:\s*none;/);
        // 反向：正边框 / 下边框任何一条回来都算回潮
        expect(body).not.toMatch(/border:\s*1px solid/);
        expect(body).not.toMatch(/border-bottom:\s*1px solid/);
    });

    it('🔴 底槽色走变量 ⛔ 不写死 #F1F3F5（写死会让深色主题失真）', () => {
        const body = ruleBody(HOME, CONTAINER);
        expect(body).toMatch(/background:\s*var\(--background-secondary\)/);
        // 反向：用户举例的色值只许出现在注释里（已剥），代码里出现即是硬编码
        expect(body).not.toMatch(/#F1F3F5/i);
        expect(body).not.toMatch(/#f1f3f5/i);
    });

    it('🔴 圆角比按钮大一档（容器 lg / 按钮 md）—— iOS 分段控制器的层次感', () => {
        const container = ruleBody(HOME, CONTAINER);
        const btn = ruleBody(HOME, '.rl-tabs.rl-tabs-modern button {');
        // 容器用 lg(8px)，比按钮的 md(6px) 大一档；⛔ 别为了「同值」改回 md
        expect(container).toMatch(/border-radius:\s*var\(--rl-t-radius-lg,\s*8px\)/);
        expect(btn).toMatch(/border-radius:\s*var\(--rl-t-radius-md,\s*6px\)/);
        expect(container).not.toMatch(/border-radius:\s*var\(--rl-t-radius-md/);
    });

    it('🔴 按钮间距 2-4px（用户「仅留 2-4px，让它们看起来是一个整体控件」）', () => {
        const body = ruleBody(HOME, CONTAINER);
        const gap = body?.match(/gap:\s*(\d+)px/);
        expect(gap).not.toBeNull();
        const px = Number(gap![1]);
        expect(px).toBeGreaterThanOrEqual(2);
        expect(px).toBeLessThanOrEqual(4);
        // 反向：老版的 `gap: 0`（连成一片）不许回来
        expect(body).not.toMatch(/gap:\s*0;/);
    });

    it('🔴🔴 指示器 inset 必须与容器 padding 同步（三处不同值 ⇒ 滑块偏移 + 高度不居中）', () => {
        const container = ruleBody(HOME, CONTAINER);
        const ind = ruleBody(HOME, '.rl-tabs.rl-tabs-modern .tab-ind {');
        expect(container).not.toBeNull();
        expect(ind).not.toBeNull();

        const pad = container!.match(/padding:\s*(\d+)px/);
        expect(pad).not.toBeNull();
        const padPx = Number(pad![1]);

        // ① top / left 与 padding 同值
        expect(ind).toMatch(new RegExp(`top:\\s*${padPx}px;`));
        expect(ind).toMatch(new RegExp(`left:\\s*${padPx}px;`));
        // ② 高度 = 100% - 2×padding
        expect(ind).toMatch(new RegExp(`height:\\s*calc\\(100% - ${padPx * 2}px\\)`));

        // ③ JS 侧常量 TAB_PAD 必须同值 —— 它参与 `offsetLeft - TAB_PAD` 位移计算
        const tabPad = HOME.match(/const TAB_PAD\s*=\s*(\d+);/);
        expect(tabPad).not.toBeNull();
        expect(Number(tabPad![1])).toBe(padPx);
    });

    it('🔴 选中滑块 = 纯白底 + 零描边（用户「背景色变成纯白色」「边框全删掉」）', () => {
        const ind = ruleBody(HOME, '.rl-tabs.rl-tabs-modern .tab-ind {');
        expect(ind).toMatch(/background:\s*#ffffff;/);
        expect(ind).toMatch(/border:\s*none;/);
        // 反向：上一版矩形风的强调色描边不许回来
        expect(ind).not.toMatch(/border:\s*1\.5px solid var\(--interactive-accent\)/);
    });

    it('🔴 深色主题下滑块不能是纯白（刺眼）⇒ 必须有 body.theme-dark 覆盖，且浅色保持纯白', () => {
        // 深色覆盖存在，且带同族前缀（与底槽那条口径一致）
        const dark = HOME.match(
            /:global\(body\.theme-dark\)\s*\.rl-tabs\.rl-tabs-modern\s*\.tab-ind\s*\{([^}]*)\}/
        );
        expect(dark).not.toBeNull();
        expect(dark![1]).toMatch(/background:\s*color-mix\(/);
        // 浅色那条必须仍是纯白（⛔ 被深色覆盖反噬成全主题丢白）
        const ind = ruleBody(HOME, '.rl-tabs.rl-tabs-modern .tab-ind {');
        expect(ind).toMatch(/background:\s*#ffffff;/);
    });

    it('🔴 未选中态文字变深灰、图标跟着变灰（用户「不要用纯黑，用 #4B5563 之类的灰」）', () => {
        const btn = ruleBody(HOME, '.rl-tabs.rl-tabs-modern button {');
        // 用 --text-muted 这一档灰：浅色≈#4B5563 量级、深色自动翻成浅灰
        expect(btn).toMatch(/color:\s*var\(--text-muted\)/);
        // 反向：⛔ 写死 #4B5563 / 纯黑 —— 主题一换就失真
        expect(btn).not.toMatch(/#4B5563/i);
        expect(btn).not.toMatch(/color:\s*#000000/i);
    });

    it('🔴 选中态保持主题色 + 加粗（用户「文字和图标保持蓝色，加粗」）', () => {
        const on = ruleBody(HOME, '.rl-tabs.rl-tabs-modern button.on {');
        expect(on).not.toBeNull();
        expect(on).toMatch(/color:\s*var\(--interactive-accent\)/);
        expect(on).toMatch(/font-weight:\s*600/);
    });

    it('🔴🔴 页签按钮必须同时剥掉 border 与 box-shadow —— 那圈方框是「内阴影冒充的描边」', () => {
        /* 2026-11-15 真机实测踩到的坑（用户 m07364「把内部所有小按钮的边框全删掉」）：
           只写 `border-bottom: none` 时，屏幕上看仍然每格一个方框，但
           `getComputedStyle(btn).border` 明明是 `none 0px` —— 真凶是核心给 `button` 的
           `box-shadow: var(--input-shadow)`，计算值
           `rgba(0,0,0,.12) 0 0 0 1px inset, rgba(0,0,0,.067) 0 1px 2px 0, …`，
           第一段 1px 内阴影就是那圈「边框」。
           ⇒ 守卫必须两条都钉：少了 box-shadow 那条，删掉修复也照样绿（假绿）。 */
        const btn = ruleBody(HOME, '.rl-tabs.rl-tabs-modern button {');
        expect(btn).not.toBeNull();
        expect(btn).toMatch(/border:\s*none;/);
        expect(btn).toMatch(/box-shadow:\s*none;/);
        // 反向：⛔ 别退回只杀底边（上/左/右三边会由核心 button 规则补回来）
        expect(btn).not.toMatch(/border-bottom:\s*none/);
        // 反向：⛔ 别把 box-shadow 又交给核心令牌
        expect(btn).not.toMatch(/box-shadow:\s*var\(--input-shadow/);
    });
});

describe('纵向页签 = 幽灵风 Ghost（m07364）', () => {
    const PANEL = '.rl-nav {';

    it('🔴 面板去掉外框（用户「完全抛弃那个灰色大圆角容器」），只靠极淡底 + 阴影分层', () => {
        const body = ruleBody(NAV, PANEL);
        expect(body).not.toBeNull();
        expect(body).toMatch(/border:\s*none;/);
        // 反向：旧的实体边框不许回来
        expect(body).not.toMatch(/border:\s*1px solid var\(--background-modifier-border\)/);
        // 去边框后必须仍靠阴影把浮层与内容分开
        expect(body).toMatch(/box-shadow:\s*var\(--rl-t-shadow-menu/);
    });

    it('🔴 面板底色不是原来的重底色（--background-secondary），而是极淡面', () => {
        const body = ruleBody(NAV, PANEL);
        expect(body).not.toMatch(/background:\s*var\(--background-secondary\)/);
        // 极淡面：页面色混入少量正文色 ⇒ 浅色下即 #F1F3F5 量级
        expect(body).toMatch(/background:\s*color-mix\(/);
    });

    it('🔴 列表项零边框 + 大内距（用户「透明背景，无边框」「padding: 10px 16px」）', () => {
        const btn = ruleBody(NAV, '.rl-nav-wrap .rl-nav button {');
        expect(btn).not.toBeNull();
        expect(btn).toMatch(/background:\s*transparent;/);
        expect(btn).toMatch(/padding:\s*10px 16px/);
        // 反向：旧的固定行高 `height: 36px` 与「大内距」互相打架，不许回来
        expect(btn).not.toMatch(/height:\s*36px/);
    });

    it('🔴🔴 选中竖条用 border-left-color 换色（⛔ 不新增元素 / 不改 padding）', () => {
        const btn = ruleBody(NAV, '.rl-nav-wrap .rl-nav button {');
        const on = ruleBody(NAV, '.rl-nav-wrap .rl-nav button.on {');

        // ① 常态留一条 3px 透明竖条占位 —— 盒模型恒定，选中时文字不会右移
        expect(btn).toMatch(/border-left:\s*3px solid transparent;/);
        // ② 选中只换颜色
        expect(on).toMatch(/border-left-color:\s*var\(--interactive-accent\)/);
        // ③ 反向：⛔ 用 padding-left 在选中态制造竖条（会让文字跳动）
        expect(on).not.toMatch(/padding-left/);
    });

    it('🔴 选中态 = 浅灰底 + 主题色文字（用户裁定「两者合并」）', () => {
        const on = ruleBody(NAV, '.rl-nav-wrap .rl-nav button.on {');
        expect(on).toMatch(/background:\s*var\(--background-modifier-hover\)/);
        expect(on).toMatch(/color:\s*var\(--interactive-accent\)/);
    });

    it('🔴 悬停**仍只变色**、⛔ 不铺底 —— 否则「悬停」与「我在这一页」互相冒充', () => {
        const hover = ruleBody(NAV, '.rl-nav-wrap .rl-nav button:hover {');
        expect(hover).not.toBeNull();
        expect(hover).toMatch(/color:\s*var\(--text-normal\)/);
        expect(hover).not.toMatch(/background/);
    });
});
