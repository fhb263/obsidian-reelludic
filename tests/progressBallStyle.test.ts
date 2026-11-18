/**
 * ②-2（用户 m00353）—— 右下角悬浮球 / 进度卡片"视觉降噪"的守卫。
 *
 * 背景：`.rl-pball*` 这套样式是 2026-08「36px 圆环改卡片」那轮留下的，
 * 它自己是**唯一没接进 `--rl-t-*` 令牌体系**的浮层：
 *   - 卡片阴影写死 `0 4px 16px rgba(0,0,0,.28)`（比全站任何卡片都重）
 *   - 小球阴影写死 `0 2px 10px rgba(0,0,0,.22)`（暗色主题下糊成一坨黑边）
 *   - 字号 10px/11px、间距 6/7/8/9/10px 全是手写值
 * 结果就是明暗主题 / 原生·现代主题切换时，它跟全站观感对不上，用户看到的是"东拼西凑"。
 *
 * ⚠️ 这些断言全部**只查 CSS 文本**，不跑浏览器：本仓没有 jsdom 的 getComputedStyle
 *    级联能力（`environment: 'node'`），且令牌是运行时由 Obsidian 注入的，
 *    真要算最终值只能上 CDP 真机（见 `_shot/` 下既有产物）。所以这里守的是
 *    **"有没有接令牌"这个可静态判定的事实**，不是"渲染出来好不好看"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释再做匹配：本仓 #379 / #730 / #731 三次被自己的解释性注释打穿守卫。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const CSS = stripComments(read('styles.css'));

/** 取某个选择器的声明块（第一个 `{` 到配对的 `}`），找不到返回空串 */
function block(selector: string): string {
    const at = CSS.indexOf(selector);
    if (at < 0) return '';
    const open = CSS.indexOf('{', at);
    const close = CSS.indexOf('}', open);
    if (open < 0 || close < 0) return '';
    return CSS.slice(open, close);
}

describe('🔴 2026-11-12 悬浮球 / 进度卡片接令牌（用户 m00353 ②-2）', () => {
    it('卡片阴影走 --rl-t-shadow-menu 令牌，不再写死 rgba', () => {
        const decl = block('.rl-pball-card {');
        expect(decl).toContain('box-shadow: var(--rl-t-shadow-menu');
        // 写死的 0.28 黑是最重的那档，必须彻底消失
        expect(decl).not.toContain('0 4px 16px');
        expect(decl).not.toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.28\s*\)/);
    });

    it('小球阴影走 --rl-t-shadow-card 令牌，不再写死 rgba', () => {
        const decl = block('.rl-pball-ring {');
        expect(decl).toContain('box-shadow: var(--rl-t-shadow-card');
        expect(decl).not.toMatch(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.22\s*\)/);
    });

    it('两个浮层的字号都接 --font-ui-smaller，⛔ 不再出现 10px / 11px 裸字号', () => {
        for (const sel of ['.rl-pball-detail {', '.rl-pball-pct {', '.rl-pball-lbl {']) {
            const decl = block(sel);
            expect(decl, `${sel} 没找到`).not.toBe('');
            expect(decl, `${sel} 字号没接令牌`).toContain('font-size: var(--font-ui-smaller)');
        }
        // 按钮那处上一轮已改；整套 .rl-pball 里不应再有 `font-size: 10px|11px`
        const pballRegion = CSS.slice(CSS.indexOf('.rl-pball {'), CSS.indexOf('.rl-epp-cueai-points'));
        expect(pballRegion).not.toMatch(/font-size:\s*(10|11)px/);
    });

    it('卡片内外边距 / 头部间距 / 进度条间距都接 --size-4-*，⛔ 不再手写三段值', () => {
        const card = block('.rl-pball-card {');
        expect(card).toContain('padding: var(--size-4-2');
        expect(card).toContain('var(--size-4-3');
        // 原 `padding: 8px 10px 9px` 的三段手写必须消失
        expect(card).not.toContain('8px 10px 9px');

        expect(block('.rl-pball-head {')).toContain('gap: var(--size-4-1');
        const bar = block('.rl-pball-bar {');
        expect(bar).toContain('margin: var(--size-4-1');
        // 原 `margin: 7px 0 6px` 上下不等距，视觉上条会偏下
        expect(bar).not.toContain('7px 0 6px');
    });

    it('卡片宽度用 min() 自适应，⛔ 不再定死 236px（窄分栏会顶出去）', () => {
        const card = block('.rl-pball-card {');
        expect(card).toContain('width: min(236px');
        expect(card).not.toMatch(/width:\s*236px\s*;/);
        // 420px 断点里那个 `width: 200px` 也一并退场（min() 已经覆盖）
        const media = CSS.slice(CSS.indexOf('@media (max-width: 420px)'));
        expect(media.slice(0, 400)).not.toMatch(/\.rl-pball-card\s*\{\s*width:\s*200px/);
    });

    it('圆角走令牌档位：卡片 lg / 进度条 pill / 按钮 sm', () => {
        expect(block('.rl-pball-card {')).toContain('border-radius: var(--rl-t-radius-lg');
        expect(block('.rl-pball-bar {')).toContain('border-radius: var(--rl-t-radius-pill');
        expect(block('.rl-pball .rl-pball-btn {')).toContain('border-radius: var(--rl-t-radius-sm');
    });

    it('可点的两处都有悬停回执（能点却没反馈 = 用户以为坏了）', () => {
        expect(CSS).toContain('.rl-pball-card:hover {');
        expect(CSS).toContain('.rl-pball-pill:hover .rl-pball-ring {');
    });

    it('新增的悬停过渡在 prefers-reduced-motion 下被关掉', () => {
        // ⚠️ 必须从 `.rl-pball {` 之后开始找：`styles.css` 里有多处
        //    `@media (prefers-reduced-motion: reduce)`（ASR 卡片等），
        //    用 `CSS.indexOf('@media (prefers-reduced-motion')` 会命中**第一处**，
        //    那根本不是 pball 的那一块 —— 本仓已多次栽在"守卫没划清作用域"上。
        const pballRegion = CSS.slice(CSS.indexOf('.rl-pball {'), CSS.indexOf('.rl-epp-cueai-points'));
        const at = pballRegion.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(at, '找不到 pball 自己的 reduced-motion 块').toBeGreaterThan(-1);
        const decl = pballRegion.slice(at);
        expect(decl).toContain('.rl-pball-card { transition: none; }');
        expect(decl).toContain('.rl-pball-ring { transition: none; }');
    });

    it('颜色一律走 Obsidian 变量，⛔ 这套样式里没有裸 hex', () => {
        const pballRegion = CSS.slice(CSS.indexOf('.rl-pball {'), CSS.indexOf('.rl-epp-cueai-points'));
        expect(pballRegion).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
});

describe('🔴 ②-2 的令牌必须真实存在于 Obsidian 内核（防写出一个不存在的变量）', () => {
    /**
     * 真源 = 从 `obsidian.asar` 抽出来的 `app.css`（`.workbuddy/tmp/asar/app.css`）。
     * 这一步不是形式主义：写出一个不存在的 Obsidian 令牌，CSS 会**静默失效**，
     * 单测全绿、真机全崩 —— 本仓已被这类问题坑过（见 `tests/sourceIcons.test.ts` 的图标名白名单）。
     * ⚠️ 该文件是从本地安装包抽的，换机器可能没有 ⇒ 缺失时跳过，不让门禁红。
     */
    const ASAR_CSS = resolve(ROOT, '.workbuddy/tmp/asar/app.css');
    let kernel = '';
    try {
        kernel = readFileSync(ASAR_CSS, 'utf8');
    } catch {
        kernel = '';
    }
    const has = (token: string): boolean => new RegExp(`${token}\\s*:`).test(kernel);

    it.skipIf(kernel === '')('--size-4-* / --font-ui-smaller / --icon-l 都在内核里定义过', () => {
        for (const t of ['--size-2-1', '--size-4-1', '--size-4-2', '--size-4-3', '--size-4-5', '--size-4-10']) {
            expect(has(t), `${t} 在 Obsidian 内核里不存在`).toBe(true);
        }
        expect(has('--font-ui-smaller')).toBe(true);
        expect(has('--icon-l')).toBe(true);
        expect(has('--background-modifier-border-hover')).toBe(true);
    });

    it('本仓自定义的 --rl-t-* 令牌在 styles.css 的 :root 里有定义', () => {
        for (const t of ['--rl-t-shadow-card', '--rl-t-shadow-menu', '--rl-t-radius-sm', '--rl-t-radius-lg', '--rl-t-radius-pill', '--rl-t-dur', '--rl-t-ease']) {
            expect(CSS, `${t} 没定义`).toMatch(new RegExp(`${t}\\s*:`));
        }
    });
});
