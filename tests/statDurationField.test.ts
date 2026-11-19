// 🔴 m11594 ① 五类型「统计时长（小时）」框的接线守卫。
//
// 用户逐字：「文学 / 网文 / 漫画 / 音乐 / 游戏编辑条目属性表单要显示统计时长框（统一重排到启动路径上方），
//   可手动填写（以小时为单位，只能填数字,如填0.5代表30min），播放器再播放的要累计上去」
//
// 本仓没有 Svelte 编译器依赖 ⇒ 与 `tests/totalEpisodesSwitch.test.ts` 同款：读源码文本做形态断言。
// ⛔ 这些判据是「防回退」，不是「防重构」—— 改形态可以，但必须同时确认语义没丢。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const form = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/** 剥注释（判断「代码里是否还有 X」时，注释里的反例不算命中 —— 本仓老坑） */
function stripComments(src: string): string {
    return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 取某个 `{#if ...}` 之后到 `{/if}` 之间的一段（只用于取「该类型块」） */
function ifBlock(src: string, condition: string, startAt = 0): string {
    const from = src.indexOf(condition, startAt);
    expect(from, `找不到 ${condition}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let i = from;
    while (i < src.length) {
        const open = src.indexOf('{#if ', i + 1);
        const close = src.indexOf('{/if}', i + 1);
        if (close < 0) break;
        if (open >= 0 && open < close) {
            depth += 1;
            i = open;
            continue;
        }
        if (depth === 0) return src.slice(from, close);
        depth -= 1;
        i = close;
    }
    throw new Error(`${condition} 的 {/if} 没配对`);
}

/**
 * 找到「含目标文案的那个类型块」。
 * ⚠️ `{#if type === 'book'}` 在表单里出现多次（书名/标题那行也是），
 *    直接取第一处会拿到标题标签块 —— 必须逐个往后找到真正含目标文案的那个。
 */
function blockContaining(condition: string, needle: string): string {
    let at = 0;
    for (let guard = 0; guard < 40; guard += 1) {
        const idx = form.indexOf(condition, at);
        if (idx < 0) break;
        const block = ifBlock(form, condition, idx);
        if (block.includes(needle)) return block;
        at = idx + condition.length;
    }
    throw new Error(`没有任何 ${condition} 块包含「${needle}」`);
}

describe('🔴 m11594 ① 五类型「统计时长（小时）」框', () => {
    it('三个类型块都有该框，且文案逐字是「统计时长（小时）」', () => {
        for (const cond of ["{#if type === 'book'}", "{#if type === 'game'}", "{#if type === 'music'}"]) {
            const block = blockContaining(cond, '统计时长（小时）');
            expect(block, `${cond} 里没有「统计时长（小时）」`).toBeTruthy();
        }
    });

    it('⛔ 旧的三套文案一个都不许留（用户裁定统一叫「统计时长」）', () => {
        const body = stripComments(form);
        expect(body).not.toContain('阅读时长（小时）');
        expect(body).not.toContain('游玩时长（小时）');
        expect(body).not.toContain('收听时长（小时）');
    });

    it('三个框的 id 各不相同（同 id 会让 label 指错输入框）', () => {
        const ids = [...form.matchAll(/<input id="(rl-f-(?:readhours|playtime|listenhours))"/g)].map((m) => m[1]);
        expect(ids.sort()).toEqual(['rl-f-listenhours', 'rl-f-playtime', 'rl-f-readhours']);
    });

    it('每颗 input 都绑了对应的 state（readHours / playtimeHours / listenHours）', () => {
        expect(form).toMatch(/id="rl-f-readhours"[\s\S]{0,160}?bind:value=\{readHours\}/);
        expect(form).toMatch(/id="rl-f-playtime"[\s\S]{0,160}?bind:value=\{playtimeHours\}/);
        expect(form).toMatch(/id="rl-f-listenhours"[\s\S]{0,160}?bind:value=\{listenHours\}/);
    });

    it('三个框都只收数字（type="number" + min="0" + step="0.1" ⇒ 支持 0.5 = 30min）', () => {
        for (const id of ['rl-f-readhours', 'rl-f-playtime', 'rl-f-listenhours']) {
            const at = form.indexOf(`id="${id}"`);
            const tag = form.slice(at, form.indexOf('>', at));
            expect(tag, `${id} 缺 type=number`).toContain('type="number"');
            expect(tag, `${id} 缺 min=0`).toContain('min="0"');
            expect(tag, `${id} 缺 step=0.1（不然填不了 0.5 小时）`).toContain('step="0.1"');
        }
    });

    it('🔴 三个框都用 1 位小数回显（`Math.round(... * 10) / 10`）—— 整小时取整会让「玩了 1 分钟」显示成 0', () => {
        expect(form).toMatch(/let playtimeHours = entry\?\.playtimeMinutes \? String\(Math\.round\(\(entry\.playtimeMinutes \/ 60\) \* 10\) \/ 10\) : '';/);
        expect(form).toMatch(/let readHours = entry\?\.readMinutes \? String\(Math\.round\(\(entry\.readMinutes \/ 60\) \* 10\) \/ 10\) : '';/);
        expect(form).toMatch(/let listenHours = entry\?\.listenMinutes \? String\(Math\.round\(\(entry\.listenMinutes \/ 60\) \* 10\) \/ 10\) : '';/);
        // 反向守卫：`playtimeHours` 不许再用整小时取整
        expect(stripComments(form)).not.toMatch(/playtimeHours = entry\?\.playtimeMinutes \? String\(Math\.round\(entry\.playtimeMinutes \/ 60\)\)/);
    });

    it('🔴 音乐这次新接的落库口：`input.listenMinutes`（之前根本没有这个框，也就没有这一行）', () => {
        expect(form).toContain('input.listenMinutes = listenHours ? Math.round(Number(listenHours) * 60) || undefined : undefined;');
        // 三处映射口径必须一致（都走 Math.round(hours * 60)）
        expect(form).toContain('input.readMinutes = readHours ? Math.round(Number(readHours) * 60) || undefined : undefined;');
        expect(form).toContain('input.playtimeMinutes = playtimeHours ? Math.round(Number(playtimeHours) * 60) || undefined : undefined;');
    });

    it('🔴 脏检测两处都登记了 listenHours（漏一处 ⇒ 只改这一栏切条目不会弹确认、改动直接丢）', () => {
        // `DIRTY_KEYS` 是带引号的数组，`dirtyNow()` 是对象字面量（不带引号）⇒ 两处形态不同，分开数。
        const body = stripComments(form);
        expect(body.match(/'readHours', 'playtimeHours', 'listenHours'/g)?.length, 'DIRTY_KEYS 那条数组要登记').toBe(1);
        expect(body.match(/readHours, playtimeHours, listenHours,/g)?.length, 'dirtyNow() 那个对象也要登记').toBe(1);
    });

    it('⛔ 不许把 listenHours 接到 `durationMin`（那是单曲片长，与收听时长两个语义）', () => {
        const body = stripComments(form);
        expect(body).not.toMatch(/durationMin\s*=\s*listenHours/);
        expect(body).not.toMatch(/listenMinutes\s*=\s*durationMin/);
    });

    it('⛔ 不许做成 $: 响应式（逐键输入会被反复覆盖，用户打「12」只会剩「2」）', () => {
        expect(form).not.toMatch(/^\s*\$:\s*(readHours|playtimeHours|listenHours)\s*=/m);
    });
});
