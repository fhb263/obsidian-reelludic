// 全局组件库 `splitTable()` 与「字段映射」组的接线守卫（2026-11-14 用户 m03626 ②）。
//
// 🔴 由来（用户 m03626 逐字）：「建立一个全局 UI 组件库 (src/ui/components.ts)，并据此重构我的
//    设置页代码……彻底消灭视觉上的东拼西凑。」
//    实测证据：同一个设置页里两张表走了两条完全不同的建法 ——
//      · 凭据表 → `statusTable()`（grid + role=table）
//      · 字段映射表 → 本方法里手写 `createDiv('rl-fieldmap-headwrap')` + `createEl('table')`
//        + `innerHTML = '<colgroup>…'` + 再手写一遍表体那一份
//    后者那套「表头在外 / 表体滚动 / 两张表共用 colgroup」的结构本身是对的（#640 修出来的），
//    但它只存在于这一个方法里，第二个需要同样结构的表就得再抄一遍 —— 那就是「东拼西凑」。
//
// 🔴 为什么是源码文本守卫而不是行为测试：
//    要锁的是「建表只走组件库这一个入口」这条接线形状。行为测试得搭一个真 DOM 宿主，
//    而这里一旦有人把 `splitTable()` 改回手写 `colgroup`，**编译器一句话都不会说**
//    （两种写法都合法，DOM 结构逐字相同）⇒ 只有文本守卫能咬住。
//
// ⚠️ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitTable } from '../src/ui/components';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const lib = stripComments(read('src/ui/components.ts'));
const settings = stripComments(read('src/Settings.ts'));

/** 从 `needle` 开始截一段代码（够覆盖一个方法体），找不到给空串。 */
function sliceFrom(src: string, needle: string, len = 4000): string {
    const at = src.indexOf(needle);
    return at < 0 ? '' : src.slice(at, at + len);
}

describe('全局组件库 · splitTable()（2026-11-14 用户 m03626 ②）', () => {
    it('🔴 组件库导出 splitTable，且返回表头表 / 表头行 / 表体容器 / 表体表', () => {
        expect(lib).toContain('export function splitTable(');
        expect(lib).toContain('export interface SplitTableHandle');
        expect(lib).toContain('export interface SplitTableOptions');
        expect(lib).toContain('headRow: HTMLTableRowElement;');
        expect(lib).toContain('return { headWrap, headTable, headRow, wrap, bodyTable };');
    });

    it('🔴 两张表共用同一份 colgroup（列宽真源只有 opts.widths 一处）', () => {
        const body = sliceFrom(lib, 'export function splitTable(');
        expect(body).toContain("const colgroupHtml = opts.widths.map((w) => `<col style=\"width:${w}\">`).join('');");
        // 表头与表体各写一次，内容同源
        expect(body).toContain('headTable.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;');
        expect(body).toContain('bodyTable.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;');
    });

    it('🔴 建出来的是真 <table>，⛔ 不是 grid 冒充（与 statusTable 的分工不能混）', () => {
        const body = sliceFrom(lib, 'export function splitTable(');
        expect(body).toContain("parent.createDiv({ cls: opts.headWrapCls })");
        expect(body).toContain("headWrap.createEl('table'");
        expect(body).toContain("wrap.createEl('table'");
        // 反向：不许把 role=table 的 div 塞进来顶替
        expect(body).not.toContain("attr: { role: 'table' }");
    });
});

describe('「字段映射」组必须走组件库，⛔ 不许手写 colgroup（2026-11-14 用户 m03626 ②）', () => {
    const fieldMapBody = sliceFrom(settings, 'private renderFieldMapRows(', 6000);

    it('🔴 本方法确实被截到了（否则下面几条会静默假绿）', () => {
        expect(fieldMapBody).toContain('const COL_WIDTHS');
    });

    it('🔴 调 splitTable() 并把七个类名/列宽传进去', () => {
        expect(fieldMapBody).toContain('splitTable(body, {');
        expect(fieldMapBody).toContain('widths: COL_WIDTHS,');
        expect(fieldMapBody).toContain("headWrapCls: 'rl-fieldmap-headwrap',");
        expect(fieldMapBody).toContain("wrapCls: 'rl-fieldmap-wrap',");
        expect(fieldMapBody).toContain("tableCls: 'rl-fieldmap-table',");
        expect(fieldMapBody).toContain("headCls: 'rl-fieldmap-head',");
        expect(fieldMapBody).toContain("bodyCls: 'rl-fieldmap-body',");
    });

    it('🔴 本方法内部⛔ 不再出现手写的 colgroup / 表头外层 / 表体表', () => {
        expect(fieldMapBody).not.toContain('<colgroup>');
        expect(fieldMapBody).not.toContain('colgroupHtml');
        expect(fieldMapBody).not.toContain("createDiv({ cls: 'rl-fieldmap-headwrap' })");
        expect(fieldMapBody).not.toContain("createEl('table'");
    });

    it('🔴 列宽真源仍在方法体内（既有 #652 断言逐字锚着这一行，⛔ 别挪去别处）', () => {
        expect(fieldMapBody).toContain("const COL_WIDTHS = ['30%', '24%', '46%'];");
    });

    it('🔴 Settings.ts 的 import 里有 splitTable', () => {
        expect(settings).toMatch(/import \{[^}]*\bsplitTable\b[^}]*\} from 'ui\/components';/);
    });
});
