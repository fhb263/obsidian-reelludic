// 「基本设置 › 外观与体验」组的**行序**守卫（用户 m07854 ③）
//
// 🔴 用户 m07854 逐字：「把『基本设置-外观与体验』的按全类型分页签开关项移动到**海报密度**项下面」。
//
// 为什么要单独钉行序：这一组有 9 行，全是 `new Setting(parent).setName(...)` 顺序渲染。
// 行序在类型系统里**完全不可见** —— 谁把它挪回「导航布局」之后，`tsc` 一句话都不会说、
// 单测也全绿，用户只能靠肉眼发现。history：#596 就是用户点名重排过一次的组。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
//    这文件自己的注释里就写着「导航布局 → 起始页 → …」，不 strip 会把注释当代码命中。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const settingsSrc = stripComments(readFileSync(resolve(ROOT, 'src/Settings.ts'), 'utf8'));

/** 取某个方法体（锚 `private <name>(` 起，到下一个 4 空格缩进的方法/注释边界止）。 */
function methodBody(src: string, name: string): string {
    const at = src.indexOf(`private ${name}(`);
    expect(at, `源码里找不到方法定义 private ${name}(`).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n {4}(?:private |\/\*\*|\})/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

/** 按出现顺序取出一组 `setName('...')` 的名字。 */
function nameOrder(src: string): string[] {
    const out: string[] = [];
    const re = /\.setName\('([^']+)'\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
    return out;
}

describe('外观与体验 · 行序（用户 m07854 ③）', () => {
    const body = methodBody(settingsSrc, 'renderAppearanceRows');
    const order = nameOrder(body);

    it('「按全类型分页签」的相邻位置：紧跟在「海报密度」之后', () => {
        // 用户原话是「移动到海报密度项下面」⇒ 约束的是**相邻关系**，不是绝对下标
        // （这一组以后还会加行，写死下标会让无关改动把测试打红）。
        expect(order).toContain('海报密度');
        expect(order).toContain('按全类型分页签');
        const densityAt = order.indexOf('海报密度');
        const axisAt = order.indexOf('按全类型分页签');
        expect(
            axisAt,
            `「按全类型分页签」应紧跟「海报密度」，实际行序：${order.join(' → ')}`,
        ).toBe(densityAt + 1);
    });

    it('🔴 反向：它不许再回到「导航布局」后面（即旧位置）', () => {
        const navAt = order.indexOf('导航布局');
        const axisAt = order.indexOf('按全类型分页签');
        expect(navAt).toBeGreaterThan(-1);
        expect(axisAt).not.toBe(navAt + 1);
    });

    it('整组行序按 #596 + m07854 ③ 的快照钉住（漏删/漏加都会红）', () => {
        // 前 9 行是本组全部设置行（后面那些 `启用内置阅读器` 等属于相邻折叠分组，方法体边界已切掉）。
        expect(order.slice(0, 9)).toEqual([
            '导航布局',
            '起始页',
            '卡片风格',
            '界面动效',
            '海报密度',
            '按全类型分页签',
            'Ctrl + 滚轮缩放',
            '隐藏插件内滚动条',
            '笔记表格',
        ]);
    });

    it('方法上方的行序注释与代码同序（注释骗人比没注释更坏）', () => {
        // 注释已 strip ⇒ 改读原始文本里那段「子项顺序」说明，确认它也跟着改了。
        const raw = readFileSync(resolve(ROOT, 'src/Settings.ts'), 'utf8');
        const at = raw.indexOf('**子项顺序（#596 用户点名重排');
        expect(at).toBeGreaterThan(-1);
        const line = raw.slice(at, raw.indexOf('\n', raw.indexOf('\n', at) + 1));
        expect(line).toContain('海报密度 → **按全类型分页签**');
    });
});
