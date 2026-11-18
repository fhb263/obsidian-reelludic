// 设置页「自定义视图」的两处行为守卫（2026-11-08 第 14 轮）。
//
// 🔴 由来（用户 m05024 逐字）：「这个用户自定义视图我在设置里勾选了漫画、电影，
//    怎么在首页视图上还显示其他类型的分类（即使没有条目…」
//
// ⚠️ 这条**不是页签过滤的 bug**：`pure/homeTabs.visibleTabs` 早就按视图的 types / bookKinds
//    过滤，2026-11-08 23:37 用真实 `catalog.json` 跑过探针，算出来正好是「计划 / 漫画 / 动画 / 统计」
//    —— 动画页签出现是因为库里 `types` 真的含 `anime`。
//
// 真根因在**写侧**：`Settings.ts` 的 `commit()` 原来收的是「整数组快照」，每个行内控件的闭包
// 握着自己渲染那一刻的 `views`；而 `setMediaViews` 是异步写盘、写完才 `rerender()`。
// 用户连点两枚类型 chip（间隔 < 一次写盘）时，第二下拿的还是旧数组 ⇒ 把第一下刚勾的项整条覆盖。
// 真实库证据：`catalog.json` 里 `types` 只剩 `["anime","book"]`，用户点的 movie 丢了。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：
//    要锁的是「写回时读的是**最新**视图，不是渲染快照」这条接线形状。行为测试得搭一个能
//    真实跑 `service.views()` / `setMediaViews()` 的宿主，而这里一旦有人把 `commit` 改回传
//    整数组、或把 chip 改回吃 `picked` 快照，编译器**一句话都不会说**（两者类型都合法）。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const settings = stripComments(read('src/Settings.ts'));
const notes = stripComments(read('src/modals/ReleaseNotesModal.ts'));
const css = stripComments(read('styles.css'));

/** 从 `needle` 开始截一段代码（够覆盖一个事件回调体），找不到给空串。 */
function sliceFrom(src: string, needle: string, len = 700): string {
    const at = src.indexOf(needle);
    return at < 0 ? '' : src.slice(at, at + len);
}

describe('设置页自定义视图 · 写回必须读最新视图（⛔ 不许吃渲染快照）', () => {
    it('🔴 commit 的入参是补丁函数，不是整数组快照', () => {
        expect(settings).toContain('function commit(patch: (cur: MediaView[]) => MediaView[]): void');
    });

    it('🔴 落盘前现读 service.views()（read-modify-write）', () => {
        const body = sliceFrom(settings, 'function commit(patch:', 700);
        expect(body).toContain('await thisPlugin.service.views()');
        expect(body).toContain('thisPlugin.setMediaViews(patch(cur))');
    });

    it('🔴 没有任何行内控件再传整数组（五处调用点全是补丁）', () => {
        // 这两条就是原来的形态：`commit(views.map(...))` / `commit(views.filter(...))`
        expect(settings).not.toContain('commit(views.map(');
        expect(settings).not.toContain('commit(views.filter(');
    });

    it('🔴 类型 chip 点击时现算勾选态，⛔ 不用渲染时冻结的 picked/on 写回', () => {
        const body = sliceFrom(settings, "chip.addEventListener('click'", 600);
        expect(body).not.toBe('');
        // 现算的判据：从**当前视图** x 重新求一次勾选集合
        expect(body).toContain('viewSelectionOf(x)');
        // 反向守卫：旧写法第一句就是 `const next = new Set(picked);`
        expect(body).not.toContain('new Set(picked)');
    });
});

describe('更新日志 · 一键展开/收起是标题旁的小图标（⛔ 不是正文上方的文字按钮）', () => {
    it('🔴 按钮建在 titleEl 上（用户 m05024：放在更新日志标题的旁边）', () => {
        expect(notes).toContain("titleEl.createEl('button', { cls: 'rl-notes-toggle'");
    });

    it('🔴 正文上方那枚文字按钮的容器已退场', () => {
        expect(notes).not.toContain("'rl-notes-actions'");
        expect(css).not.toContain('.rl-notes-actions');
    });

    it('🔴 用图标表达状态：展开 = chevrons-up-down / 收起 = chevrons-down-up', () => {
        expect(notes).toContain("setIcon(el, allOpen ? 'chevrons-down-up' : 'chevrons-up-down')");
    });

    it('🔴 图标按钮必须有悬停提示，且提示要跟图标同源', () => {
        const body = sliceFrom(notes, 'private syncToggleLabel()', 900);
        // 🔴 2026-11-12（用户 m00353 ①-9）：原来这里断言 `data-tip` + `aria-label` **两条都写**，
        //    那正是「hover 双提示重叠覆盖」的成因 —— 绑 document 只让 data-tip 生效，
        //    aria-label 照样触发 Obsidian 官方气泡。现在只允许 `setTip`（单一 data-tip），
        //    读屏名走 `srLabel`（`.rl-sr` 隐藏文本），⛔ 别再断言 aria-label 存在。
        expect(body).toContain('setTip(el, label)');
        expect(body).toContain('srLabel(el, label)');
        expect(body).not.toContain("setAttribute('aria-label'");
        expect(body).not.toContain("setAttribute('data-tip'");
        // 同一个 `label` 变量喂两处，⛔ 别各写一串字面量（写岔了就是箭头和气泡互相打脸）
        expect(body).toContain("const label = allOpen ? '全部收起' : '全部展开';");
    });

    it('🔴 弹窗内的 data-tip 要自己绑 document（Modal 不在 initGlobalTooltip 那条链上）', () => {
        expect(notes).toContain('bindTooltipDocument(this.modalEl.ownerDocument)');
    });

    it('🔴 CSS：透明无边框 + inline-flex（块级 flex 会把图标甩到标题行之外）', () => {
        const at = css.indexOf('.rl-notes-toggle {');
        expect(at).toBeGreaterThan(-1);
        const block = css.slice(at, css.indexOf('}', at) + 1);
        expect(block).toContain('background: transparent');
        expect(block).toContain('border: 0');
        expect(block).toContain('box-shadow: none');
        expect(block).toContain('display: inline-flex');
    });
});
