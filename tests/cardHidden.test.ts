// 🔴 m19210：编辑属性表单「隐藏此条目卡片」复选框 + 卡片模糊化
//   用户原话：「在全部类型条目编辑属性表单-作品基础信息顶部行右边显示一个
//   『[复选框]隐藏此条目卡片』功能项，勾选中后就把整个封面和信息栏都给我模糊化」。
//
// 判据分四层：① 纯函数语义 ② 数据层落库白名单 ③ 表单装配 ④ 卡片渲染与 CSS 边界。
// ⚠️ 反向守卫一律跑 `stripComments` 后的源码 —— 本仓注释里大量逐字引用反面教材，
//    直接扫原文会假红（这坑在 baiduSearch / tagFilter 两批上都踩过）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_HIDDEN_TEXT, entryCardHidden, maskCardText, seriesCardHidden } from 'pure/cardHidden';
import type { MediaEntry } from 'data/types';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * 造最小条目替身：`seriesCardHidden` 的形参类型是 `readonly MediaEntry[]`，
 * 但这两个纯函数**只读 `cardHidden`**（见 `src/pure/cardHidden.ts`）。
 * ⛔ 别为了测试去放宽产品签名（那会让真调用点失去类型保护）。
 */
const card = (cardHidden?: unknown): MediaEntry => ({ cardHidden }) as MediaEntry;

/** 剥掉注释：`<!-- -->`（svelte 模板）/ `/* *​/`（css、ts 块注释）/ `//`（ts 行注释，避开 `https://`） */
function stripComments(src: string): string {
    return src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

const form = read('src/views/components/EntryForm.svelte');
const formCode = stripComments(form);
const list = read('src/views/components/MediaList.svelte');
const listCode = stripComments(list);
const types = read('src/data/types.ts');
const catalog = read('src/data/catalog.ts');
const catalogCode = stripComments(catalog);

describe('① entryCardHidden 语义', () => {
    it('只有严格 === true 才算隐藏', () => {
        expect(entryCardHidden({ cardHidden: true })).toBe(true);
        expect(entryCardHidden({ cardHidden: false })).toBe(false);
        expect(entryCardHidden({ cardHidden: 'true' })).toBe(false);
        expect(entryCardHidden({ cardHidden: 1 })).toBe(false);
        expect(entryCardHidden({})).toBe(false);
    });

    it('脏输入一律 false（不抛）', () => {
        expect(entryCardHidden(null)).toBe(false);
        expect(entryCardHidden(undefined)).toBe(false);
        expect(entryCardHidden('x')).toBe(false);
        expect(entryCardHidden(42)).toBe(false);
    });
});

describe('② seriesCardHidden 语义（组内全部勾选才糊）', () => {
    it('全部勾了才糊', () => {
        expect(seriesCardHidden([card(true), card(true)])).toBe(true);
    });

    it('🔴 只勾一部分不糊（否则一部就把整扇门面糊掉，用户会以为整组没了）', () => {
        expect(seriesCardHidden([card(true), card()])).toBe(false);
        expect(seriesCardHidden([card(true), card(false)])).toBe(false);
    });

    it('空组 / 非数组一律 false', () => {
        expect(seriesCardHidden([])).toBe(false);
        expect(seriesCardHidden(null)).toBe(false);
        expect(seriesCardHidden(undefined)).toBe(false);
    });
});

describe('③ 数据层：字段声明与白名单', () => {
    it('types.ts 声明 cardHidden?: boolean 并注明语义边界', () => {
        expect(types).toContain('cardHidden?: boolean;');
        // 语义边界写在**声明上方的 JSDoc** 里（「别拿它当 archived 用」）⇒ 要往前后两边找，
        // 只看声明之后会漏掉（第一版就是这么假红的）。
        const at = types.indexOf('cardHidden?: boolean;');
        const around = types.slice(Math.max(0, at - 700), at + 200);
        expect(around).toContain('archived');
        expect(around).toContain('normalizeEntry');
    });

    it('🔴 normalizeEntry 白名单里有它（漏了就保存即静默丢弃）', () => {
        expect(catalogCode).toContain('cardHidden: raw.cardHidden === true ? true : undefined,');
    });

    it('🔴 只认 === true（取消勾选必须落 undefined，不能留一个恒假字段）', () => {
        expect(catalogCode).not.toMatch(/cardHidden:\s*raw\.cardHidden\s*(,|\?)/);
        expect(catalogCode).not.toMatch(/cardHidden:\s*Boolean\(/);
    });
});

describe('④ 表单装配', () => {
    it('状态从 entry 读入、并注明它不是 archived', () => {
        expect(formCode).toContain('let cardHidden = entry?.cardHidden === true;');
    });

    it('复选框在「作品基础信息」这一条标题行里（不是别处）', () => {
        const at = formCode.indexOf('<span class="rl-section-txt">作品基础信息</span>');
        expect(at).toBeGreaterThan(-1);
        const near = formCode.slice(at, at + 400);
        expect(near).toContain('type="checkbox"');
        expect(near).toContain('bind:checked={cardHidden}');
        expect(near).toContain('隐藏此条目卡片');
    });

    it('🔴 标签文字与用户原话一致', () => {
        expect(formCode).toContain('隐藏此条目卡片');
    });

    it('提交对象里恒写（勾上 true、取消 undefined）', () => {
        expect(formCode).toContain('input.cardHidden = cardHidden ? true : undefined;');
    });

    it('🔴 分区标题行只在「作品基础信息」这一条变成 flex（⛔ 别改 .rl-section 本体）', () => {
        expect(formCode).toContain('.rl-section-row { display: flex; align-items: center; gap: 8px; }');
        expect(formCode).toMatch(/\.rl-cardhidden \{[\s\S]{0,200}?margin-left: auto;/);
        // 反向守卫：`.rl-section {` 本体不得出现 display: flex
        expect(formCode).not.toMatch(/\.rl-section \{[^}]*display:\s*flex/);
    });
});

describe('⑤ 卡片渲染与 CSS 边界', () => {
    it('普通卡按条目判定，系列卡按组判定', () => {
        expect(listCode).toContain('class:is-card-hidden={entryCardHidden(e)}');
        expect(listCode).toContain('class:is-card-hidden={seriesCardHidden(g.items)}');
    });

    it('🔴 封面用**模糊**（m20436 推翻 m19456 的斜纹蒙板）', () => {
        // 🔴 m20436 用户逐字：「隐藏该条目笔记的封面蒙板怎么这么清晰改成原来模糊的效果」。
        //    m19456 那版斜纹蒙板（`::after` + 重复斜向渐变）虽然盖住了，但图案边缘极清晰 ——
        //    用户要的是「糊掉」而不是「盖住」⇒ 回到 m19210 的 blur。⛔ 这条不是放宽，是口径翻面。
        const rule = /\.rl-card\.is-card-hidden \.rl-cov-wrap\s*\{[\s\S]{0,400}?\}/.exec(listCode)?.[0] ?? '';
        expect(rule).toContain('filter: blur(6px) saturate(0.55)');
        expect(rule).toContain('opacity: 0.6');
        // 过渡只列两个属性（写 all 会让 hover 的 box-shadow / transform 也拖帧）
        expect(rule).toContain('transition: filter 140ms ease, opacity 140ms ease');
        // 反向守卫：斜纹蒙板那一整套必须彻底退场（两层叠起来更脏）
        expect(listCode).not.toContain('repeating-linear-gradient');
        expect(listCode).not.toMatch(/\.rl-card\.is-card-hidden \.rl-cov-wrap::after/);
    });

    it('🔴 信息栏文字走 `maskCardText`，但**状态徽标除外**（m20436）', () => {
        // 标题 / 元信息行 —— 打码。
        expect(listCode).toContain('{maskCardText(ch, e.title)}');
        expect(listCode).toContain('{maskCardText(ch, cardFieldValue(e, row.f))}');
        // 系列卡同款
        expect(listCode).toContain('{maskCardText(gch, g.title)}');
        expect(listCode).toContain('{maskCardText(gch, seriesCardFieldValue(g, row.f))}');
        // 🔴 m20436 用户逐字：「信息栏的状态就不要隐藏了」⇒ 状态**必须**直出明文，两种卡都一样。
        expect(listCode).toContain('{statusIcon(e.status)} {statusLabel(e.type, e.status)}');
        expect(listCode).toContain('{statusIcon(gStatus)} {statusLabel(g.type, gStatus)}');
        // 反向守卫：⛔ 别把状态再包回 maskCardText（藏了状态就没法判断这张卡要不要点开）
        expect(listCode).not.toMatch(/maskCardText\([^)]*statusLabel/);
        // 反向守卫：⛔ 别在模板里内联第二份打码逻辑（改文案时必漏一处）
        expect(listCode).not.toMatch(/\?\s*'\*\*\*'/);
    });

    it('🔴 状态徽标不压暗（m20436）—— 只有星还被压暗', () => {
        // 用户：「信息栏的状态就不要隐藏了」⇒ `.rl-badge` 不许出现在 is-card-hidden 的压暗规则里。
        expect(listCode).not.toMatch(/is-card-hidden[^{]*\.rl-badge[^{]*\{[^}]*opacity/);
        // 星仍然压暗（星已被打码成 ***，压暗只是让这一行更弱化）
        expect(listCode).toContain('.rl-card.is-card-hidden .rl-card-meta .rl-my-inline { opacity: .55; }');
    });

    it('🔴 星级：隐藏时连星带读屏名一起换掉（星星个数本身也是信息）', () => {
        expect(listCode).toContain('<span class="rl-masked-text">***</span>');
        expect(listCode).toContain('<span class="rl-sr">个人评分已隐藏</span>');
        expect(listCode).toContain('<span class="rl-sr">合集评分已隐藏</span>');
    });

    it('🔴 不引入 pointer-events: none 到卡片本体（否则用户点不进去取消勾选）', () => {
        // 只允许**蒙板那一层**穿透（`.rl-cov-wrap::after`）；`.rl-card` 本体与信息栏必须照常可点。
        // ⚠️ 判据要**排除 ::after** —— 否则会把蒙板合法的 `pointer-events: none` 当违规（第一版就这么假红了）。
        expect(listCode).not.toMatch(/\.rl-card\.is-card-hidden\s*\{[^}]*pointer-events:\s*none/);
        expect(listCode).not.toMatch(/\.rl-card\.is-card-hidden\s+\.rl-card-meta\s*\{[^}]*pointer-events:\s*none/);
        expect(listCode).not.toMatch(/\.rl-card\.is-card-hidden\s+\.rl-cov-wrap\s*\{[^}]*pointer-events:\s*none/);
    });

    it('判据来自 pure 模块，模板里不内联第二个真源', () => {
        expect(listCode).toContain(
            "import { entryCardHidden, seriesCardHidden, maskCardText } from 'pure/cardHidden';",
        );
        expect(listCode).not.toMatch(/class:is-card-hidden=\{[^}]*cardHidden === true/);
    });
});

describe('⑥ `maskCardText` 打码出口（m19456）', () => {
    it('隐藏时返定长星号，未隐藏时原样返回', () => {
        expect(maskCardText(true, '三体')).toBe('***');
        expect(maskCardText(false, '三体')).toBe('三体');
    });

    it('🔴 星号是定长的（⛔ 不按原文长度生成 —— 那会泄漏原文多长）', () => {
        expect(maskCardText(true, 'a')).toBe(maskCardText(true, 'a'.repeat(40)));
        expect(CARD_HIDDEN_TEXT).toBe('***');
    });

    it('空串 / 占位符也照常打码（藏的是「这一格有内容」这件事本身）', () => {
        expect(maskCardText(true, '—')).toBe('***');
        expect(maskCardText(true, '')).toBe('***');
    });
});
