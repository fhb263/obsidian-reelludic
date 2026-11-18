/**
 * ⑦（用户 m07854）弹出窗口的 hover 提示守卫。
 *
 * 🔴 为什么必须是源码文本守卫：这条缺陷 tsc / svelte-check / jsdom 单测**全看不见** ——
 *    按钮的 `data-tip` 一直都在、DOM 结构也没错，坏的是「这份 document 上压根没注册提示器」。
 *    只有真机 CDP 才能量出 `hasTipNode: false`，但单测跑不到真机 ⇒ 用源码断言钉住两条口子。
 *
 * 真机取证（2026-11-13，隔离库）：
 *  · 修复前：主窗口 `hasTipNode: true` / 弹出窗口 `hasTipNode: false`，
 *    而两边 `.rl-epp-cuetool` 都是 6 颗、`data-tip` 文案逐字相同。
 *  · A/B 对照（临时注释掉这两处绑定后重建部署、冷启动）：
 *    两个弹窗 target 全部 `shown.display === 'no-node'`，主窗口仍 `block` ⇒ 归因确证。
 *  · 恢复绑定后：三个 target（含弹窗）全部 `display: 'block'` + 正确文案。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

/** 读源码并剥掉注释 —— 本仓铁律：先 strip 再匹配，否则会被自己写的注释打穿（#379 / #730 / #731）。
 *
 * 🔴 必须用**单次交替扫描**（块注释分支与行注释分支放在同一个正则里交替），⛔ 不能分两步 ——
 *    先块后行、先行后块，两种顺序都有反例：
 *  · `main.ts` 里有一条行注释写的是「下载/音乐」后面跟星号星号，其中的「斜杠星号」会被
 *    纯块注释正则当成块注释起手点，一路找到几 K 字符之后才出现的块注释收尾，
 *    把夹在中间的**真实代码**（`this.bindTooltipToOpenWindows();`）整段吞掉 ⇒ 守卫假红。
 *  · 交替扫描让「先遇到谁就由谁消费」：行注释里出现块注释起手时，在双斜杠处先吃掉整行；
 *    块注释里出现双斜杠时，在起手点先匹配块注释分支、吃到收尾。
 *  · 行注释分支用 `[^\n]*`，⛔ 不用 `^\s*\/\/.*$`（`\s` 含换行，多行模式下会跨行吞代码）。
 *  · ⚠️ 写这条注释本身也要小心：文档注释里出现裸露的块注释收尾符号会**提前终止注释**，
 *    本文件第一版就是这么炸的（esbuild 报 `Expected ";" but found "this"`）。
 */
function readStripped(rel: string): string {
    const raw = readFileSync(resolve(ROOT, rel), 'utf8');
    return raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
}

describe('⑦ 弹出窗口也要有 hover 提示（用户 m07854）', () => {
    const main = readStripped('main.ts');
    const tooltip = readStripped('src/services/globalTooltip.ts');

    it('main.ts 监听了 window-open 并给新窗口的 document 绑提示器', () => {
        expect(main).toMatch(/workspace\.on\(\s*'window-open'/);
        expect(main).toMatch(/bindTooltipDocument\(\s*popoutWin\?\.document/);
        // 必须是 registerEvent（插件卸载时自动解绑），不能裸 app.workspace.on
        expect(main).toMatch(/this\.registerEvent\(this\.app\.workspace\.on\(\s*'window-open'/);
    });

    it('main.ts 启动时兜底扫一遍已存在的窗口（插件加载前就开着的弹窗不会再补发 window-open）', () => {
        expect(main).toMatch(/this\.bindTooltipToOpenWindows\(\);/);
        // 收集方式：iterateAllLeaves 拿每个 leaf 的 ownerDocument（提示器只服务我们的按钮，必然长在 leaf 里）
        expect(main).toMatch(/iterateAllLeaves\(/);
        expect(main).toMatch(/leaf\.view\?\.containerEl\?\.ownerDocument/);
        expect(main).toMatch(/for \(const doc of docs\) bindTooltipDocument\(doc\);/);
    });

    it('bindTooltipDocument 自身按 document 幂等（重复绑不会叠加监听）', () => {
        expect(tooltip).toMatch(/export function bindTooltipDocument\(doc: Document \| null \| undefined\): void \{/);
        expect(tooltip).toMatch(/if \(boundDocs\.has\(doc\)\) return;/);
        expect(tooltip).toMatch(/boundDocs\.set\(doc, inst\);/);
    });

    it('⛔ 别再退回「只绑主窗口」——initGlobalTooltip 只绑一份 document 是既定事实，视图层不许依赖它', () => {
        // 反向守卫：主窗口那一份由 initGlobalTooltip 负责，弹窗必须另有出口。
        // 若有人把 bindTooltipDocument 的 window-open 绑定删掉，这条 + 上面第一条会同时红。
        expect(main).toMatch(/bindTooltipDocument/);
        expect(main).toMatch(/import \{[^}]*bindTooltipDocument[^}]*\} from 'services\/globalTooltip';/);
    });
});
