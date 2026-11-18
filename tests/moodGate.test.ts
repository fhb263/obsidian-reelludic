/**
 * 「心情只在『已看』时出现」的守卫（2026-11-17 用户 m00002 第 ③ 条前半）。
 *
 * 用户原话：「所有类型条目编辑属性表单里『个人心情』只在观看状态为『已看』时出现」。
 *
 * ## 为什么是源码级断言而不是组件级
 * `tests/` 下 347 个测试文件**没有一个**编译 Svelte 组件（无 `svelte/compiler` 依赖），
 * 装一套编译链只为这一条守卫不划算。这里改钉**模板结构事实**，与
 * `tests/formPlaceholders.test.ts` 同一套路数。
 *
 * ## 钉的四件事（少一件就等于没钉）
 *  ⑴ 守卫判据恰是 `status === 'watched'` —— 写成 `!== 'want'` 也能让「已看」看见，
 *     但会把「在看」也放出去，用户要的是**只有**已看；
 *  ⑵ 心情块**在守卫内部**（不是把守卫挂在别的地方自我安慰）；
 *  ⑶ 心情块**只有一处** —— 有第二份无条件渲染等于守卫白加；
 *  ⑷ `mood` state 与提交**照旧无条件保留** —— 这是最容易写错的半件事：
 *     顺手把提交也包进 `{#if}`，用户从「已看」改回「在看」再存，已存心情就被清空了。
 *     守卫只该藏 UI，⛔ 不该动数据。
 *
 * ⚠️ 不能在原文件上跑 `stripComments`：这个 9000+ 行的文件里块注释正则会从前面某个
 *    `/*` 一路吃到模板，把整段模板删平（`formPlaceholders.test.ts` 记过这个坑）。
 *    所以一律在**原文**上按精确形态 `indexOf`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { MOODS, MOOD_IDS } from '../src/pure/mood';

const ROOT = resolve(__dirname, '..');
const FORM = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/** 守卫起始标记（唯一一处）；后续断言都相对它定位 */
const GUARD = "{#if status === 'watched'}";

const occurrenceCount = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe('EntryForm · 心情只在「已看」时出现（③）', () => {
    it('守卫判据恰是 `status === "watched"`，且只出现一次', () => {
        expect(occurrenceCount(FORM, GUARD)).toBe(1);
        // 反向守卫：这些写法都能让「已看」看见心情，但会把别的状态也放出来
        expect(FORM).not.toContain("{#if status === 'watching'}");
        expect(FORM).not.toContain("{#if status !== 'want'}");
        expect(FORM).not.toContain("{#if status === 'watched' ||");
    });

    it('心情块 (`rl-mood-row`) 真的在守卫内部', () => {
        const iGuard = FORM.indexOf(GUARD);
        const iRow = FORM.indexOf('class="rl-mood-row"');
        const iEnd = FORM.indexOf('{/if}', iGuard);
        expect(iGuard).toBeGreaterThan(-1);
        expect(iRow).toBeGreaterThan(-1);
        expect(iEnd).toBeGreaterThan(-1);
        // 顺序契约：守卫起点 → 心情行 → 闭合。缺一环就说明守卫包错了地方。
        expect(iRow).toBeGreaterThan(iGuard);
        expect(iEnd).toBeGreaterThan(iRow);
    });

    it('心情块只有一处：不存在第二份无条件渲染', () => {
        // `rl-mood-row` 在整份文件里只有模板 1 处 + 样式 1 处（`.rl-mood-row {`）
        expect(occurrenceCount(FORM, 'class="rl-mood-row"')).toBe(1);
        expect(occurrenceCount(FORM, '.rl-mood-row {')).toBe(1);
    });

    it('六档 chip 的渲染在守卫内（`{#each MOODS}` 被包住）', () => {
        const iGuard = FORM.indexOf(GUARD);
        const iEnd = FORM.indexOf('{/if}', iGuard);
        const block = FORM.slice(iGuard, iEnd);
        expect(block).toContain('{#each MOODS as m}');
        expect(block).toContain('class="rl-mood-chip"');
        // 六档的定义来自纯模块，这里只确认它确实还是六档（文案/emoji 由 mood.ts 负责）
        expect(MOOD_IDS).toHaveLength(6);
        expect(MOODS.map((m) => m.id)).toEqual([...MOOD_IDS]);
    });

    it('只是藏 UI，不是清变量：state 与提交照旧无条件保留', () => {
        // 初值仍从条目读（没有因为「只在已看出现」就改成 entry?.status === 'watched' ? ... : ''）
        expect(FORM).toContain("let mood: MoodId | '' = entry?.mood ?? '';");
        // 提交仍在 script 里、带分号（注释里那句不带分号），说明它没被模板守卫吞掉
        expect(FORM).toContain('input.mood = normalizeMood(mood);');
        // 定位契约：提交语句（script 段）出现在守卫（模板段）之前 ——
        // 若有人把提交搬进模板的 {#if} 里，这里立刻会红
        const iSubmit = FORM.indexOf('input.mood = normalizeMood(mood);');
        expect(iSubmit).toBeGreaterThan(-1);
        expect(iSubmit).toBeLessThan(FORM.indexOf(GUARD));
        // 点已选 = 取消这条交互纪律还在
        expect(FORM).toContain('function toggleMood(id: MoodId): void {');
    });

    it('「个人评语」没有被误包进心情守卫（它任何状态都该能写）', () => {
        const iGuard = FORM.indexOf(GUARD);
        const iEnd = FORM.indexOf('{/if}', iGuard);
        const iNotes = FORM.indexOf('<label class="rl-lbl">个人评语</label>');
        expect(iNotes).toBeGreaterThan(-1);
        expect(iNotes).toBeGreaterThan(iEnd);
    });
});
