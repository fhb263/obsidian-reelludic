import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 🔴 m05415 技术债（真机实测抓到）：`applyUiTheme()` 在**插件加载期**会崩掉整个插件。
 *
 * 真机日志（`Runtime.consoleAPICalled`）：
 *   `Plugin failure: obsidian-reelludic TypeError: i.view.setUiTheme is not a function
 *    at dS.applyUiTheme (plugin:obsidian-reelludic:659:8686)
 *    at dS.onload (plugin:obsidian-reelludic:659:5013)`
 *
 * 根因：`applyUiTheme` 只遍历 `HOME_VIEW_TYPE` 的 leaf，然后 `(leaf.view as HomeView).setUiTheme(theme)`。
 *   `as HomeView` 是**编译期断言**，擦除后不设防 —— 而插件重载 / 视图正在卸载时，
 *   leaf 上挂的是**上一个插件实例**的 view 或还没 onload 完的空壳。
 *   抛错点在 `onload` 里 ⇒ Obsidian 判定「Plugin failure」⇒ **整个插件加载失败**（不是某个功能坏掉）。
 *
 * ⇒ 修法：运行时判型 + 方法存在。本文件钉住这个判型，⛔ 别退回裸 `as HomeView` 直调。
 *   ⚠️ 为什么不能用行为测试：这个错误的触发条件是「插件重载时序」，
 *      在单测环境里无法真实复现（拿不到那种半死 leaf），只能靠源码形态守卫。
 */
/**
 * 剥掉注释再断言。
 *
 * 🔴 真机修复的注释里**逐字复述了崩溃形态**（`(leaf.view as HomeView).setUiTheme(...)`），
 *    那是给人看的证据链，不是代码。不剥注释的话反向守卫会自己把自己判红（本仓踩过多次）。
 * ⚠️ 用三档不跨行版：跨行那条会被模板串里的括号星号序列吞掉。
 */
const stripComments = (src: string): string =>
    src
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');

const MAIN = stripComments(readFileSync(resolve(__dirname, '..', 'main.ts'), 'utf8'));

const methodBody = (src: string, sig: string): string => {
    const at = src.indexOf(sig);
    if (at < 0) throw new Error(`找不到方法：${sig}`);
    const braceAt = src.indexOf('{', at + sig.length);
    if (braceAt < 0) throw new Error(`方法体没有左大括号：${sig}`);
    let depth = 0;
    for (let i = braceAt; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(braceAt, i + 1);
        }
    }
    throw new Error(`方法体没有闭合：${sig}`);
};

describe('🔴 m05415 技术债：applyUiTheme 不许在插件加载期崩掉整个插件', () => {
    it('🔴 调 setUiTheme 之前必须运行时判型（typeof === function）', () => {
        const body = methodBody(MAIN, 'applyUiTheme(): void ');
        // 必须是「判型 + 调用」的组合，而不是裸调
        expect(body).toMatch(/typeof\s+\w+\.setUiTheme\s*===\s*'function'/);
        // 行为守卫：判型出现在调用之前
        const guardAt = body.search(/typeof\s+\w+\.setUiTheme\s*===\s*'function'/);
        const callAt = body.search(/\w+\.setUiTheme\s*\(\s*theme\s*\)/);
        expect(guardAt).toBeGreaterThan(-1);
        expect(callAt).toBeGreaterThan(guardAt);
    });

    it('🔴 反向守卫：不许退回裸 `as HomeView` 直调（真机崩溃形态）', () => {
        const body = methodBody(MAIN, 'applyUiTheme(): void ');
        expect(body).not.toMatch(/\(\s*leaf\.view as HomeView\s*\)\s*\.setUiTheme/);
        // 也不许用非空断言绕过
        expect(body).not.toMatch(/leaf\.view!\.setUiTheme/);
    });

    it('🔴 判型必须防 null/undefined（重载时 leaf.view 可能还没挂）', () => {
        const body = methodBody(MAIN, 'applyUiTheme(): void ');
        // view 变量先判存在再判方法：`view && typeof view.setUiTheme === 'function'`
        expect(body).toMatch(/\bview\s*&&\s*typeof\s+view\.setUiTheme\s*===\s*'function'/);
    });

    it('🔴 其余同类遍历也要有判型（别只修这一处，回头再崩一次）', () => {
        // `applyAppearance` 只动 body 的类，不碰 view ⇒ 不在范围内。
        // 但如果有人以后在别的遍历里调 view 方法，至少要保证 `setUiTheme` 这处有判型。
        const allSetUiTheme = MAIN.match(/\.setUiTheme\s*\(/g) ?? [];
        // 目前只应有 applyUiTheme 里那一处调用（+ 类型声明不算）
        expect(allSetUiTheme.length).toBeLessThanOrEqual(1);
    });
});
