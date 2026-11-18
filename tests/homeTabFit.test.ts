/**
 * 首页顶部页签「窄屏收窄」的源码级守卫（用户 m09565 ①-5）。
 *
 * 这一组全是**真机实测抓出来、tsc 与常规单测都看不见**的坑，四条各自对应一次真实翻车：
 *   1. 判据错基准：`.rl-tabs` 是 `width: fit-content`，拿它自己的 `clientWidth` 比 ⇒ 恒判溢出。
 *   2. 量到 0 当「没溢出」：首帧 `scrollWidth` 是 0，`0 <= avail + 1` 恒真 ⇒ 永不收窄。
 *   3. RO 盯自身 ⇒ 收窄改宽度又触发 RO ⇒ 每 ~12ms 抖一次，永不收敛。
 *   4. 量测撞上 CSS 过渡 ⇒ 摘类后文字宽度还在动画中途，量到的自然宽是假的。
 *
 * ⇒ 直接读 `HomeView.svelte` 源码钉住这四处的写法；行为本身已由真机（800 / 900 / 1100 / 1400 四档
 *   视口）双向验过：`avail 461 vs 自然宽 478` ⇒ 收窄；`avail ≥ 561` ⇒ 退回未收窄。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释：本仓注释里大量引用旧写法（含反例），不剥会被自己的文档打穿反向守卫。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = stripComments(read('src/views/components/HomeView.svelte'));

/** 取 `syncTabFit` 函数体（从签名到下一个顶格 `}` 之后若干字符） */
function fitBody(): string {
    const at = SRC.indexOf('async function syncTabFit(');
    expect(at).toBeGreaterThan(-1);
    return SRC.slice(at, at + 2600);
}

describe('首页页签窄屏收窄（m09565 ①-5）', () => {
    it('判据必须比父级可用宽度，⛔ 不能用页签容器自己的 clientWidth', () => {
        const body = fitBody();
        // 正向：从父级取可用宽（扣掉左右内距）
        expect(body).toContain('host.clientWidth');
        expect(body).toContain('paddingLeft');
        expect(body).toContain('paddingRight');
        expect(body).toMatch(/const avail\s*=\s*host\.clientWidth\s*-\s*padX;/);
        // 反向：⛔ 拿自己或自己 scrollWidth 的 clientWidth 比 —— 那是恒判溢出的老写法
        expect(body).not.toMatch(/scrollWidth\s*<=\s*(tabsEl|box|live)\.clientWidth/);
    });

    it('量到 0 必须重试，⛔ 不许当成「放得下」', () => {
        const body = fitBody();
        expect(body).toMatch(/if \(avail <= 0 \|\| natural <= 0\)/);
        expect(body).toContain('requestAnimationFrame(() => void syncTabFit());');
        // 重试上限来自常量，⛔ 不许写死次数
        expect(body).toContain('IND_RETRY_MAX');
    });

    it('ResizeObserver 必须盯父级，⛔ 盯页签容器自身（收窄会改它宽度 ⇒ 死循环）', () => {
        expect(SRC).toContain('const fitHost = tabsEl?.parentElement ?? null;');
        expect(SRC).toMatch(/if \(ro && fitHost\) ro\.observe\(fitHost\);/);
        // 反向：⛔ 不许回到 observe(tabsEl)
        expect(SRC).not.toMatch(/ro\.observe\(tabsEl\)/);
    });

    it('幂等闸门要含页签数量（6 枚 ⇄ 10 枚时父宽与激活页签可能都不变）', () => {
        const body = fitBody();
        expect(body).toMatch(/const sig = `\$\{avail\}\|\$\{navTabs\.length\}\|\$\{activeTab\}`;/);
        expect(body).toContain('if (sig === fitSig && tabFit !== \'none\') return;');
        // 换轴时 activeTab 可以是同一枚（「游戏」两轴同名）⇒ 必须对数量显式建依赖
        expect(SRC).toContain('void navTabs.length;');
    });

    it('量测期必须掐掉过渡，否则量到的是动画中途的文字宽度', () => {
        const body = fitBody();
        expect(body).toContain('fitMeasuring = true;');
        expect(body).toContain('fitMeasuring = false;');
        // 模板里要有这个类（Svelte 4 样式裁剪只认模板出现过的类名）
        expect(SRC).toContain('class:is-measuring={fitMeasuring}');
        // 并且样式块里真的有掐过渡的规则
        expect(SRC).toMatch(/\.rl-tabs\.is-measuring \.rl-tab-txt[\s\S]{0,120}transition:\s*none\s*!important/);
    });

    it('收窄态必须走 class: 指令（⛔ classList.add，否则 Svelte 判成 Unused CSS selector）', () => {
        expect(SRC).toContain("class:is-narrow={tabFit === 'narrow'}");
        expect(SRC).toContain("class:is-tight={tabFit === 'tight'}");
        // 反向：⛔ 不许用 JS 直接加这两个类
        expect(SRC).not.toMatch(/classList\.add\('is-(narrow|tight)'\)/);
        // 藏字用宽度/透明度，⛔ 不用 display:none（会让 scrollWidth 口径横跳）
        expect(SRC).toMatch(/\.rl-tabs\.rl-tabs-modern\.is-narrow button:not\(\.on\) \.rl-tab-txt[\s\S]{0,160}max-width:\s*0/);
        expect(SRC).not.toMatch(/is-narrow[\s\S]{0,200}display:\s*none/);
    });

    it('激活项要一直带文字（只收窄未激活项）', () => {
        // 只藏 `button:not(.on)` 的文字；is-tight 才全藏
        expect(SRC).toContain('.rl-tabs.rl-tabs-modern.is-narrow button:not(.on) .rl-tab-txt');
        expect(SRC).toContain('.rl-tabs.rl-tabs-modern.is-tight button .rl-tab-txt');
    });
});

describe('分组卡信息栏不留空行（m09565 ①-6）', () => {
    const list = stripComments(read('src/views/components/MediaList.svelte'));

    it('组卡的 .rl-card-meta 要解除 74px 最小高', () => {
        // 74px 是给普通卡的（要留 状态徽标/星/进度 几行，否则同行卡片高矮不齐）
        expect(list).toMatch(/\.rl-gcard \.rl-card-meta \{\s*min-height:\s*0;/);
    });

    it('⛔ 不许改基础 .rl-card-meta 的 min-height（普通卡靠它对齐）', () => {
        // 基础规则仍要是 74px
        expect(list).toMatch(/\.rl-card-meta \{[\s\S]{0,400}?min-height:\s*74px/);
    });

    it('⛔ 不许用「—」之类占位去填那行（会伪装成真实字段）', () => {
        const at = list.indexOf('it.kind === \'grp\'');
        expect(at).toBeGreaterThan(-1);
        const block = list.slice(at, at + 3000);
        expect(block).not.toMatch(/text:\s*'—'/);
    });
});
