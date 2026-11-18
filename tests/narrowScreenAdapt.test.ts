// 手机 / 平板窄屏适配（2026-11-14 第 51 轮，用户 m05195 提需求、m05299 拍板）。
//
// 🔴 用户逐字（m05195）：「全面规划移动端手机平板UI适配仅展示、功能上适配的成本
//    （是否可用 Platform.isDesktopApp 隔离掉桌面专属的重型功能）」；
//    拍板（m05299）：「是，要在做手机平板窄屏设置和首页上的适配展示」
//    ⇒ 范围锁定 **设置页 + 首页的展示层适配**，不搬桌面重型功能。
//
// 为什么要这些守卫：窄屏适配全是**静默失效** —— 媒体查询写错阈值、选择器拼错、
// 被后面的等高特异度规则盖掉，浏览器一句话都不说，tsc / svelte-check 也不会说话
// （CSS 里的类名根本不参与类型检查）。所以这里钉三件事：
//   ⑴ 断点只准用既有档位，⛔ 不许新增一次性阈值（每多一个阈值就多一处漂移）；
//   ⑵ 每个窄屏块必须真的落在对应文件、且带注释说明「为什么是这个阈值」；
//   ⑶ 规则里 ⛔ 不许把窄屏刚放开的固定宽度又写回去。
//
// ⛔ 铁律：先 strip 注释再匹配（本仓已被自己的注释打穿三次：#379 / #730 / #731）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** 剥掉注释，但**保留 CSS 媒体查询的声明内容**（只剥 `/* … *\/` 与整行 `//`） */
function strip(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const css = read('styles.css');
const cssBare = strip(css);
/**
 * 窄屏适配段的**源码**（从总注释块的起点到文件末尾）。
 *
 * 🔴 两个坑都是我自己踩的，都记在这里：
 *   ① 锚点文字 `手机 / 平板窄屏适配` 只存在于**注释里**，所以必须先取 `css`（未剥注释）
 *      再 strip；直接在 `cssBare` 里 indexOf 恒得 -1，`slice(-1)` 只拿到换行符。
 *   ② 光取锚点文字还不够 —— 锚点**位于注释正文中间**，从它切会把开头的 `/*` 切掉，
 *      于是这段注释不再被识别为注释，`strip()` 原样留下里面的 `min-width: 280px` 等
 *      字面量，反向断言（「不许出现 280px」）当场假红。
 *      ⇒ 必须 `lastIndexOf('/*', 锚点)` 回到注释起点再切。
 */
const NARROW_MARK = '手机 / 平板窄屏适配';
const markAt = css.indexOf(NARROW_MARK);
const narrowStart = markAt < 0 ? -1 : css.lastIndexOf('/*', markAt);
const narrowRaw = narrowStart < 0 ? '' : css.slice(narrowStart);
const narrow = strip(narrowRaw);
const home = read('src/views/components/HomeView.svelte');
const stats = read('src/views/components/StatsBoard.svelte');
const calendar = read('src/views/components/CalendarBoard.svelte');

/** 本仓允许的断点档位（新增档位必须先进这个白名单，并说明理由） */
const ALLOWED_BREAKPOINTS = [900, 760, 719, 700, 560, 420];

describe('窄屏断点只准用既有档位（⛔ 不许一次性阈值）', () => {
    it('styles.css 里的 max-width 全部在白名单内', () => {
        const found = [...cssBare.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
        expect(found.length).toBeGreaterThanOrEqual(8);
        const bad = [...new Set(found)].filter((n) => !ALLOWED_BREAKPOINTS.includes(n));
        expect(bad, `styles.css 出现了白名单外的断点：${bad.join(' / ')}`).toEqual([]);
    });

    it('三个组件里的 max-width 也全部在白名单内', () => {
        for (const [name, src] of [['HomeView.svelte', home], ['StatsBoard.svelte', stats], ['CalendarBoard.svelte', calendar]] as const) {
            const found = [...strip(src).matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
            const bad = found.filter((n) => !ALLOWED_BREAKPOINTS.includes(n));
            expect(bad, `${name} 出现了白名单外的断点：${bad.join(' / ')}`).toEqual([]);
        }
    });
});

describe('设置页 · 窄屏（字段映射表 / 属性面板 / 卡片面板）', () => {
    it('字段映射表在窄屏下放开长属性名，并收窄格内距', () => {
        expect(narrow.length, '找不到窄屏适配段（注释锚点必须在原始 css 里找）').toBeGreaterThan(200);
        const block = narrow.slice(narrow.indexOf('@media (max-width: 719px)'));
        expect(block.slice(0, 900)).toMatch(/\.rl-fieldmap-table td[\s\S]{0,80}padding-inline:\s*var\(--size-4-1\)/);
        expect(block.slice(0, 900)).toMatch(/\.rl-fieldmap-table \.rl-fm-key code[\s\S]{0,200}word-break:\s*break-all/);
    });

    it('条目属性面板在 560px 下两块各占满一行（放开 280px / 340px 固定宽）', () => {
        expect(narrow).toMatch(/\.rl-ef-preview[^}]*flex:\s*1 1 100%/);
        expect(narrow).toMatch(/\.rl-ef-preview[^}]*min-width:\s*0/);
        expect(narrow).toMatch(/\.rl-ef-picker[^}]*max-width:\s*none/);
    });

    it('卡片字段面板放开 260px 最小宽（否则 320px 手机横向溢出）', () => {
        expect(narrow).toMatch(/\.rl-cf-picker[^}]*min-width:\s*0/);
    });
});

describe('统计看板 · 窄屏（月度趋势 + 分类概览退单列）', () => {
    it('900px 块里把 .rl-s-mid 从 1fr/1fr 退成单列', () => {
        const bare = strip(stats);
        const at = bare.indexOf('@media (max-width: 900px)');
        expect(at).toBeGreaterThan(-1);
        const block = bare.slice(at, at + 1200);
        expect(block).toMatch(/\.rl-s-mid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    it('⛔ 没有为它单独再开一个断点（复用 900 那一档）', () => {
        const found = [...strip(stats).matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
        expect(found).toEqual([900]);
    });
});

describe('月历 · 窄屏（侧栏下移 + 周视图改单列）', () => {
    const bare = strip(calendar);

    it('719px 块存在，并把主区从左右并排改成上下堆叠', () => {
        const at = bare.indexOf('@media (max-width: 719px)');
        expect(at, '月历缺 719px 窄屏块').toBeGreaterThan(-1);
        const block = bare.slice(at, at + 1600);
        expect(block).toMatch(/\.rl-cal-main\s*\{\s*flex-direction:\s*column/);
        expect(block).toMatch(/\.rl-cal-main\s*\{[^}]*height:\s*auto/);
    });

    it('侧栏从「210px 竖栏」变成「限高一条」', () => {
        const block = bare.slice(bare.indexOf('@media (max-width: 719px)'));
        expect(block).toMatch(/\.rl-cal-side\s*\{[^}]*width:\s*auto/);
        expect(block).toMatch(/\.rl-cal-side\s*\{[^}]*max-height:\s*40vh/);
    });

    it('周视图 7 等分列在窄屏退成单列堆叠（否则每列约 45px）', () => {
        const block = bare.slice(bare.indexOf('@media (max-width: 719px)'));
        expect(block).toMatch(/\.rl-cal-week\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    it('月历格子压矮但仍有最小高度（⛔ 别压成 0）', () => {
        const block = bare.slice(bare.indexOf('@media (max-width: 719px)'));
        const m = /\.rl-cal-cell\s*\{[^}]*min-height:\s*(\d+)px/.exec(block);
        expect(m, '窄屏下 .rl-cal-cell 丢了 min-height').not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(48);
    });
});

describe('首页 · 窄屏（外框留白与页签内距）', () => {
    const bare = strip(home);

    it('560px 块存在，收 .rl-home 内距与页签内距', () => {
        const at = bare.indexOf('@media (max-width: 560px)');
        expect(at, '首页缺 560px 窄屏块').toBeGreaterThan(-1);
        const block = bare.slice(at, at + 900);
        expect(block).toMatch(/\.rl-home\s*\{\s*padding:\s*6px/);
        expect(block).toMatch(/\.rl-tabs[\s\S]{0,120}padding-left:\s*8px/);
    });

    it('两行入口栏允许换行（否则窄屏与内容抢宽度）', () => {
        const block = bare.slice(bare.indexOf('@media (max-width: 560px)'));
        expect(block).toMatch(/\.rl-navbar[\s\S]{0,80}flex-wrap:\s*wrap/);
        expect(block).toMatch(/\.rl-more-bar[\s\S]{0,120}flex-wrap:\s*wrap/);
    });
});

describe('窄屏规则 ⛔ 不把刚放开的固定宽度写回去', () => {
    it('窄屏块里不再出现 min-width: 260px / 280px / max-width: 340px', () => {
        expect(narrow.length).toBeGreaterThan(200);
        expect(narrow).not.toMatch(/min-width:\s*(260|280)px/);
        expect(narrow).not.toMatch(/max-width:\s*340px/);
    });
});
