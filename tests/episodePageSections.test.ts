// 剧集页「下排两节 + 相关推荐条数」的结构守卫。
//
// 🔴 由来（2026-11-08 用户两条指令）：
//   ① 「简介、系列不再可收起，默认展开」⇒ 两节必须走**不可折叠**通道；
//   ② 「相关推荐再加个条目上限为 7」⇒ `RECOMMEND_LIMIT` 必须是 7。
//
// ⚠️ 这两条都**没法**靠纯函数单测锁住：`buildSection` / `buildLow` 是 `EpisodePageView`
//    的私有方法，构造它需要真的 Obsidian `App` + DOM。所以这里用**源码文本守卫** —— 它锁的不是
//    "函数算得对不对"，而是"别有人把折叠箭头和点击监听又加回去"。
//
// ⛔ 写这类守卫的铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：
//    必须**先 strip 注释再匹配**，否则注释里提到 `collapsible = false` 也能让断言变绿。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickRecommendations } from 'pure/episodePage';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 取 `import { A, B } from 'pure/episodePage';` 里真的被 import 进来的名字 */
const code = stripComments(read('src/views/EpisodePageView.ts'));

describe('🔴 2026-11-08 简介 / 系列不可折叠', () => {
    it('buildSection 第 4 参 collapsible 默认 true（右栏「字幕/选集」仍要能折）', () => {
        // 签名具名：`collapsible = true,` 少见过但在 TS 里合法；这里要求显式默认值，
        // 因为一旦默认成 false，右栏两节会静默变成不可折叠 —— 用户没提这个需求。
        expect(code).toMatch(/collapsible\s*=\s*true/);
    });

    it('🔴 「简介」「系列」两节都以 collapsible = false 建出来', () => {
        expect(code).toMatch(/buildSection\(low,\s*'简介',\s*true,\s*false\)/);
        expect(code).toMatch(/buildSection\(low,\s*'系列',\s*true,\s*false\)/);
    });

    it('🔴 右栏「字幕 / 选集」⛔ 没被顺手改成不可折叠（它们该保持可折）', () => {
        // 这两处仍是三参调用 —— 多传一个 false 就是把右栏也锁死。
        expect(code).toMatch(/buildSection\(pair,\s*CUE_PANEL_TITLE,\s*subsHasNow\)/);
        expect(code).toMatch(/this\.buildSection\(pair,\s*this\.isSingle\(\)\s*\?\s*'文件'\s*:\s*'选集',\s*true\)/);
    });

    it('🔴 不可折叠时不能建箭头、不能挂点击监听（否则是点下去没反应的假按钮）', () => {
        // 箭头创建与 addEventListener 必须都在 `if (collapsible)` 块内。
        // 这里做一个结构性断言：把 buildSection 的函数体切出来，确认
        // 'rl-epp-secarrow' 与 'addEventListener' 出现在 `if (collapsible)` 之后。
        const start = code.indexOf('private buildSection(');
        expect(start, '找不到 buildSection —— 方法被改名/搬家了，这条守卫需要同步').toBeGreaterThan(-1);
        const end = code.indexOf('private buildCuePanel(', start);
        const body = end > start ? code.slice(start, end) : code.slice(start, start + 2600);
        const gate = body.indexOf('if (collapsible)');
        expect(gate, 'buildSection 里没有 `if (collapsible)` 门控').toBeGreaterThan(-1);
        expect(body.indexOf('rl-epp-secarrow')).toBeGreaterThan(gate);
        expect(body.indexOf('addEventListener')).toBeGreaterThan(gate);
    });

    it('不可折叠的节恒为展开（data-open 不能算成 0，否则内容永久消失）', () => {
        expect(code).toMatch(/const isOpen = collapsible \? open : true;/);
        expect(code).toMatch(/sec\.setAttribute\('data-open',\s*isOpen\s*\?\s*'1'\s*:\s*'0'\)/);
    });
});

describe('🔴 2026-11-08 相关推荐上限 = 7', () => {
    it('RECOMMEND_LIMIT 常量本身是 7', () => {
        expect(code).toMatch(/const RECOMMEND_LIMIT = 7;/);
    });

    it('buildWidget 用的是这个常量，⛔ 不是散落的字面量', () => {
        expect(code).toMatch(/pickRecommendations\(ctx\.entry,\s*ctx\.allEntries,\s*RECOMMEND_LIMIT\)/);
    });

    it('上限真的生效：池子够大时只回 7 条（防常量改了但没接线）', () => {
        const mk = (id: string) =>
            ({ id, type: 'anime', title: id }) as unknown as Parameters<typeof pickRecommendations>[1][number];
        const pool = Array.from({ length: 30 }, (_, i) => mk(`a${i}`));
        expect(pickRecommendations({ id: 'none' }, pool, 7)).toHaveLength(7);
    });
});
