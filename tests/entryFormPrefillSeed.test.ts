// 搜索结果区：**不摆任何 ✨ / 入库按钮**；AI 预填只留在单卡编辑属性表单。
//
// 🔴 三轮口径演化（都记着，防止后来人按旧的一版改回去）：
//    m10798：「把预填小图标按钮也放在元数据搜索出来的窗口UI下」→ 挂在结果区**表头**。
//    m02288：「AI预填图标按钮不是放在搜索表单列表上啊，移动到每个搜索条目结果页面信息标题旁
//             （**不是标题框旁**）」→ 表头那颗挪到**每条结果标题右侧**。
//    m04435 ②（**现行**）：「添加条目展开的结果列表：**不显示"入库"和"AI 预填"按钮**。
//             【"AI 预填"仅在**单卡编辑属性表单窗口**显示】」
//            ⇒ 结果列表里那颗 ✨ 与曲库「入库」**一起退场**；`runAiPrefillForResult` 连根删除。
//            ⇒ AI 预填的唯一入口 = `.rl-title-col > .rl-lbl-row` 里那颗（条件 `{#if entry || manualFill}`）。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：
//   这条链路的失效形态是「**静默降级**」——功能看着在、点了没反应，编译器与 svelte-check 都不说话。
//   本文件锁的正是那几处不写就会被下一个人改坏的地方（见每个 it 的注释）。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
// ⚠️ 但 strip 不能用 `/\/\*[\s\S]*?\*\//` 一把梭 —— 本文件模板里有 `<input type="file" accept="image/*">`，
//    那个 `/*` 会被当成块注释起点，一路吞到十几万字符之后的下一个 `*/`（#804 真踩过）。
//    正确写法是三档且都**不跨行**：整行块注释 → 行内块注释 → 整行 `//`。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
const src = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/\/\*[^*\n]*\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** 取一段模板片段：从 `open` 起、到其后第一个 `close` 之前（找不到就抛，⛔ 不许静默变空） */
function sliceBetween(text: string, open: string, close: string, label: string): string {
    const at = text.indexOf(open);
    if (at < 0) throw new Error(`找不到起点：${label}（${open}）`);
    const end = text.indexOf(close, at + open.length);
    if (end < 0) throw new Error(`找不到终点：${label}（${close}）`);
    return text.slice(at, end);
}

describe('🔴 m04435 ② 结果列表：⛔ 不显示「AI 预填」按钮', () => {
    it('🔴 结果区**整块**都没有 `.rl-ai-btn` / `.rl-res-aibtn`（表头 + 每一条结果）', () => {
        // 结果区起点 = 结果列表容器；终点 = 它的收尾（后面接字段区的 `{#if picked}`）。
        // ⚠️ 用「结果区整体」而不是只看某一行：用户说的是「结果列表**不显示**」，
        //    只守「每条结果旁没有」的话，有人把按钮挪回表头或挪到栏标题旁都能漏过去。
        const resAt = src.indexOf('<div class="rl-res-head">');
        expect(resAt).toBeGreaterThan(-1);
        const fieldsAt = src.indexOf('class="rl-fields-col"');
        expect(fieldsAt).toBeGreaterThan(resAt);
        const resZone = src.slice(resAt, fieldsAt);
        expect(resZone).not.toContain('rl-ai-btn');
        expect(resZone).not.toContain('rl-res-aibtn');
        // 也不许以任何读屏名/提示文案的形式残留（防止「按钮删了、data-tip 还挂着」）
        expect(resZone).not.toContain('AI 预填这一条');
    });

    it('🔴 表头只剩计数与提示（`.rl-res-head` 内一格按钮都没有）', () => {
        const head = sliceBetween(src, '<div class="rl-res-head">', '</div>', '结果区表头');
        expect(head).toContain('rl-res-head-cnt');
        expect(head).not.toContain('rl-ai-btn');
    });

    it('🔴 `runAiPrefillForResult` 已**连根删除**（死函数等于「按钮随时能被挂回来」）', () => {
        expect(src).not.toContain('runAiPrefillForResult');
        // 更早那版（表头那颗用的）也不许回来
        expect(src).not.toContain('runAiPrefillFromResults');
        expect(src).not.toContain('prefillSeedTitle');
    });
});

describe('🔴 m04435 ② 结果列表：⛔ 不显示「入库」按钮', () => {
    it('🔴 `.rl-res-save` 与「入库」文案都不在模板里了', () => {
        expect(src).not.toContain('rl-res-save');
        expect(src).not.toContain('入库中');
        // 只认「入库」这两个字的**按钮文案**形态：`'入库'` / `>入库<` / `}入库{`
        // （注释已在 strip 阶段被剥掉，所以这里命中的一定是真的渲染文本）
        expect(src).not.toMatch(/['">}]\s*入库\s*['"<{]/);
    });

    it('🔴 配套死代码一并清掉（`noUnusedLocals` 之外没人会发现）', () => {
        expect(src).not.toContain('function isSongLibResult');
        expect(src).not.toContain('function saveMusicResult');
        expect(src).not.toContain('saveMusicResultOnKey');
        expect(src).not.toContain('savingKey');
        expect(src).not.toContain('savedHits');
        // prop 也要删：留着一条「有注入、没人用」的死线，下次就会被人顺手挂回按钮
        expect(src).not.toContain('export let onSaveMusic');
    });

    it('🔴 但「已添加」标记**保留**（用户当场裁定：按钮删掉、标记留下）', () => {
        expect(src).toContain('{#if added}<span class="rl-res-added">已添加</span>{/if}');
        // 判据仍是宿主注入的 `addedHits`（跨重建保持），不依赖被删掉的 `savedHits`
        expect(src).toContain('export let addedHits: Set<string> = new Set();');
        expect(src).toContain('{@const added = addedHits.has(resultKey(r))');
    });
});

describe('🔴 AI 预填的唯一入口：单卡编辑属性表单的书名标签右侧', () => {
    it('🔴 ✨ 在 `.rl-lbl-row` 里、且在 `.rl-title-row` **之前**（不是输入框右侧）', () => {
        const lblRowAt = src.indexOf('<div class="rl-title-col">');
        expect(lblRowAt).toBeGreaterThan(-1);
        const titleCol = sliceBetween(src, '<div class="rl-title-col">', '<div class="rl-title-row">', '标题列');
        expect(titleCol).toContain('class="rl-lbl-row"');
        expect(titleCol).toContain('class="rl-ai-btn"');
        expect(titleCol).toContain('{#if entry || manualFill}');
        expect(titleCol).toContain('AI 预填字段');
    });

    it('🔴 条件 `entry || manualFill`：编辑态与手动填写都给，⛔ 点选结果的中间态不给', () => {
        const titleCol = sliceBetween(src, '<div class="rl-title-col">', '<div class="rl-title-row">', '标题列');
        // 编辑态：entry 非空
        expect(titleCol).toContain('{#if entry || manualFill}');
        // 反向守卫：不许退回只看 manualFill
        expect(titleCol).not.toContain('{#if manualFill}');
    });

    it('🔴 点它走的是 `runAiPrefill()`（字段目录与预览面板只此一套）', () => {
        const titleCol = sliceBetween(src, '<div class="rl-title-col">', '<div class="rl-title-row">', '标题列');
        expect(titleCol).toContain('on:click={() => void runAiPrefill()}');
        expect(titleCol).toContain('disabled={prefillBusy}');
    });

    it('⚠️ 旧结果区那条「回车填字段区」的收尾函数仍在（它服务主按钮，与本轮删除无关）', () => {
        const at = src.indexOf('function applyPrefillFromResults');
        expect(at).toBeGreaterThan(-1);
        const body = src.slice(at, at + 500);
        expect(body).toContain('applyPrefill();');
        expect(body).toContain('picked = true;');
        expect(body).toContain('manualFill = true;');
    });
});
