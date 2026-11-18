// 笔记条目卡 · 两栏版式（`styles.css` 的 `.rl-notecard-*` 段）—— CSS 侧守卫
//
// 🔴 2026-11-16 用户 m01057：「笔记条目卡能不能分两栏就不会太长」。
//    纯层/渲染层的结构由 `tests/noteCardMount.test.ts` 钉（head 通栏 + body 与 head 平级）；
//    本文件钉的是**另一个真源**——`styles.css` 里的栏数、断点、`break-inside`。
//
// ⚠️ 为什么要两份守卫（复现页 `_shot/src/notecard-two-col.html` 量过：
//    626px 宽下 `column-count:2` 时剧集卡单栏总高 620 → 两栏 324，省 48%；栏高差 4px）：
//    只钉 TS 的结构、不钉 CSS 的话，`column-count` 被改回 1 时**所有结构断言照样全绿**，
//    而用户看到的正是「又变回一条长卡」—— 那正是这次要修的毛病。
//    ⇒ 断言写成「结构 + CSS 两侧各取一次值」的等式/不等式，不是「出现过某个字符串」。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** 剥注释（⛔ 本仓多次踩到「注释里逐字写实现形态污染断言」）。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CSS = stripComments(read('styles.css'));
const MOUNT = stripComments(read('src/views/noteCardMount.ts'));

/** 取某条选择器的规则体（取第一个匹配块；本段内每个选择器只出现一次）。 */
function ruleBody(selector: string): string {
    const at = CSS.indexOf(selector);
    if (at < 0) return '';
    const open = CSS.indexOf('{', at);
    const close = CSS.indexOf('}', open);
    if (open < 0 || close < 0) return '';
    return CSS.slice(open + 1, close);
}

/** 取 `@media (max-width: 560px)` 段内某选择器的规则体。
 *
 * ⚠️ 这个断点在 styles.css 里出现**多次**（各功能段各写一条），所以必须：
 *    ① 先按大括号配对切出每个 `@media (max-width: 560px) { … }` 的**整段文本**；
 *    ② 只在段内 `indexOf(选择器)`。
 * ⛔ 别用「indexOf 选择器 → 往前找最近的 @media」—— 那条路在主规则（非媒体块内）上会命中主规则本身。
 */
function narrowBody(selector: string): string {
    const MARK = '@media (max-width: 560px)';
    let i = CSS.indexOf(MARK);
    while (i >= 0) {
        const open = CSS.indexOf('{', i);
        if (open < 0) return '';
        // 按大括号配对找出本媒体块的结束位置
        let depth = 0;
        let end = -1;
        for (let p = open; p < CSS.length; p++) {
            if (CSS[p] === '{') depth++;
            else if (CSS[p] === '}') {
                depth--;
                if (depth === 0) { end = p; break; }
            }
        }
        if (end < 0) return '';
        const block = CSS.slice(open + 1, end);
        const at = block.indexOf(selector);
        if (at >= 0) {
            const bo = block.indexOf('{', at);
            const bc = block.indexOf('}', bo);
            if (bo >= 0 && bc >= 0) return block.slice(bo + 1, bc);
        }
        i = CSS.indexOf(MARK, end);
    }
    return '';
}

describe('笔记条目卡 · 两栏版式（用户 m01057）', () => {
    it('详情区是 2 栏（CSS 多栏），⛔ 别退回单列长卡', () => {
        const body = ruleBody('.rl-notecard-body {');
        expect(body, '`.rl-notecard-body` 规则不见了').not.toBe('');
        // 取「真源」两次再比：TS 侧期望 2 栏，CSS 侧必须也声明 2
        const wantCols = 2;
        const m = /column-count:\s*(\d+)/.exec(body);
        expect(m, '`.rl-notecard-body` 缺 `column-count`').not.toBeNull();
        expect(Number(m![1])).toBe(wantCols);
        // ⛔ 旧的单列 flex 排布不许回潮（那正是「太长」的成因）
        expect(body).not.toMatch(/flex-direction:\s*column/);
    });

    it('分组不跨栏腰斩（`break-inside: avoid`）', () => {
        const group = ruleBody('.rl-notecard-group {');
        expect(group).not.toBe('');
        expect(group).toMatch(/break-inside:\s*avoid/);
        // Safari/老 WebKit 只认这个前缀写法，保留它不代表冗余
        expect(group).toMatch(/page-break-inside:\s*avoid/);
    });

    it('head 通栏：`.rl-notecard-head` 存在且是横向排（封面 + 标题行）', () => {
        const head = ruleBody('.rl-notecard-head {');
        expect(head, '`.rl-notecard-head` 规则不见了').not.toBe('');
        expect(head).toMatch(/display:\s*flex/);
        // 通栏的前提：head 不能被压成半栏
        expect(head).toMatch(/align-items:\s*flex-start/);
        // ⛔ 旧版把详情塞在「右栏 main」里，那个类不该再出现在样式表
        expect(CSS).not.toMatch(/\.rl-notecard-main\b/);
    });

    it('split 是纵向两段（head 在上、body 在下），⛔ 不是「封面一栏 / 详情一栏」', () => {
        const split = ruleBody('.rl-notecard-split {');
        expect(split).not.toBe('');
        expect(split).toMatch(/flex-direction:\s*column/);
    });

    it('标题行有 `flex: 1 1 auto` + `min-width: 0`（否则标题撑破整卡、ellipsis 失效）', () => {
        const row = ruleBody('.rl-notecard-titlerow {');
        expect(row).not.toBe('');
        expect(row).toMatch(/flex:\s*1 1 auto/);
        expect(row).toMatch(/min-width:\s*0/);
    });

    it('窄屏（≤560px）回落单栏，且断点复用已有的 560px 档（⛔ 不新增阈值）', () => {
        const narrow = narrowBody('.rl-notecard-body {');
        expect(narrow, '窄屏回落规则不见了 —— 手机上两栏会把「键：值」挤成逐字换行').not.toBe('');
        expect(narrow).toMatch(/column-count:\s*1/);
        // 封面窄屏限宽（⛔ 不许占满整宽 —— 那是旧版「大海报」的毛病）
        const cover = narrowBody('.rl-notecard-cover {');
        expect(cover).toMatch(/width:\s*96px/);
    });

    it('渲染层建的是 head + body 两个平级节点（与 CSS 两侧对齐）', () => {
        // 结构真源在 TS 侧；此处只做「两边说的是同一件事」的交叉核对
        expect(MOUNT).toMatch(/cls: 'rl-notecard-head'/);
        expect(MOUNT).toMatch(/cls: 'rl-notecard-body'/);
        expect(MOUNT).not.toMatch(/rl-notecard-main/);
    });
});
