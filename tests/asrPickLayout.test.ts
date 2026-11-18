// 「语音转文字」布局的 CSS 守卫（2026-11-10 第 15 轮，第 16 轮随 D 版改写）。
//
// 🔴 由来（用户 m03661 逐字）：「语音转文字怎么拉长空白了出了这么多」。
//    真机量测：整组 4341px，而左侧目录里所有行加起来只有 554px —— 多出来的 3600px 全是空白。
//    根因有两条，都不在 TS 里，编译器一句话都不会说：
//      ① `.rl-asr-confpane` 收起时只写了 `width: 0`，面板内 `.setting-item-name` 带
//         `overflow-wrap: anywhere` ⇒ 文字在 0 宽下**逐字换行**，内容高炸到 4167px；
//      ② `.rl-asr-pick2` 是 flex 行且 `align-items: stretch` ⇒ 整行高度按最高子项算，
//         左侧目录被连带拉齐到 4167px。
//
// 🔴 第 16 轮（用户 m03883 定版 D「分组卡片 + 胶囊档位」）又踩了**同一类**的两次：
//      ③ 横向两栏时右面板固定 280px，800px 宽的 popout 里左栏只剩 156px
//         ⇒ 六枚胶囊竖排、路径全截断，整组回到 777px（真机 `{catW:156, cardW:156, cols:"156px"}`）。
//         改成纵向（配置面板铺在下方、占满整行）后恢复 446px 两列。
//      ④ 网格默认 `align-items: stretch` ⇒ Qwen3（2 枚胶囊）被拉到和 Whisper（6 枚）等高，
//         底部挂 60px 空白（真机 `cardH:[126,126,126]` → 修好后 `[102,54,54]`）。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：
//    要锁的是「隐藏态真的把尺寸归零」「两栏不等高时不许互相拉齐」这两条**接线形状**。
//    行为测试得搭一个能真实排版 flex/grid 的宿主（jsdom 不做布局，`getBoundingClientRect` 恒 0），
//    而这里一旦有人把 `height: 0` 删掉、或把 `flex-start` 改回 `stretch`，
//    单测与 tsc **都不会红**，只有用户下次打开设置页才会看到那几千 px 空白。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const css = stripComments(read('styles.css'));

/**
 * 取「选择器列表里含 `selector` 的那条规则」的花括号体；找不到给空串。
 * ⚠️ 必须支持**并列选择器**：本文件里 `.rl-asr-tier[hidden], .rl-asr-group[hidden] { … }`
 * 是一条规则罩两个类，只认 `selector {` 的写法会误判成「规则不存在」。
 *
 * 🔴 2026-11-11（第 17 轮）修的真 bug：旧实现用「文本里含这个选择器」做包含匹配，
 *    `.rl-asr-row` 会**前缀命中** `.rl-asr-rows .setting-item`（styles.css:2580），
 *    于是 `.rl-asr-row` 的规则体被当成了那条 padding 规则，断言报「display 不是 flex」——
 *    源码其实完全正确，是**测试本身错**。改成按逗号切开选择器列表、逐项**全等**比较。
 */
function ruleBody(selector: string): string {
    const head = new RegExp('(?:^|[}])\\s*([^{}]*?)\\{', 'gm');
    let m: RegExpExecArray | null;
    while ((m = head.exec(css))) {
        const list = m[1].split(',').map((s) => s.trim());
        if (!list.includes(selector)) continue;
        const open = css.indexOf('{', m.index + m[0].length - 1);
        const close = css.indexOf('}', open);
        return close < 0 ? '' : css.slice(open + 1, close);
    }
    return '';
}

/** 规则体里某属性的值（`width: 0;` → `0`）；没有该属性给空串。 */
function prop(body: string, name: string): string {
    const m = new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+)`).exec(body);
    return m ? m[1].trim() : '';
}

describe('语音转文字 · 收起态必须把尺寸归零（⛔ 只写 width 会炸出 3600px 空白）', () => {
    const closed = ruleBody('.rl-asr-pick2.is-conf-closed .rl-asr-confpane');

    it('🔴 收起态把高度归零（纵向布局后是 height + max-height 双保险）', () => {
        expect(closed).not.toBe('');
        // 这条是本次真缺陷的核心：0 宽 + overflow-wrap:anywhere 会让面板内容竖排成一列字，
        // 高度反而暴涨。纵向布局后再补 `max-height: 0` —— 单写 height 时若祖先给了
        // 明确高度，flex 子项仍可能被拉回去。
        expect(prop(closed, 'height')).toBe('0');
        expect(prop(closed, 'max-height')).toBe('0');
    });

    it('🔴 收起态还要藏溢出与可见性', () => {
        expect(prop(closed, 'overflow')).toBe('hidden');
        expect(prop(closed, 'visibility')).toBe('hidden');
        expect(prop(closed, 'opacity')).toBe('0');
    });
});

describe('语音转文字 · 两段天然不等高，不许互相拉齐', () => {
    const pick2 = ruleBody('.rl-asr-pick2');

    it('🔴 align-items 是 flex-start，不是 stretch', () => {
        expect(pick2).not.toBe('');
        expect(prop(pick2, 'align-items')).toBe('flex-start');
    });

    it('⛔ 反向守卫：任何 stretch 都会让矮的那段挂空白', () => {
        expect(prop(pick2, 'align-items')).not.toBe('stretch');
    });

    it('🔴 D 版之后是纵向（配置面板铺在下方占满整行，不再挤成 156px 的窄栏）', () => {
        // 真机量测：横向时 catW 156 / cols "156px"，六枚胶囊竖排、整组 777px。
        expect(prop(pick2, 'flex-direction')).toBe('column');
    });

    it('外框画在 pick2 自己身上（所以两段不等高也不会有「半个框」）', () => {
        expect(prop(pick2, 'border')).toContain('1px solid');
        expect(prop(pick2, 'border-radius')).not.toBe('');
        expect(prop(pick2, 'background')).not.toBe('');
    });
});

describe('D 版卡片网格（用户 m03883 定版）', () => {
    const catalog = ruleBody('.rl-asr-catalog');
    const card = ruleBody('.rl-asr-card');

    it('🔴 网格用 auto-fill + min(190px, 100%)，不许写死两列', () => {
        // ⚠️ `100%` 不能省：只写 `minmax(190px, 1fr)` 时，窄容器仍算出 190px 轨道
        // ⇒ 横向溢出（真机 `scrollWidth 190 > clientWidth 156`）。
        const cols = prop(catalog, 'grid-template-columns');
        expect(cols).toContain('auto-fill');
        expect(cols).toMatch(/min\(\s*190px\s*,\s*100%\s*\)/);
    });

    it('🔴 网格 align-items 必须是 start（默认 stretch 会让短卡挂空白）', () => {
        // 真机：Whisper 6 枚胶囊 126px，Qwen3 只有 2 枚，却被一起拉到 126px，
        // Qwen3 卡底部挂 60px 空白。修好后 `cardH:[102,54,54]`。
        expect(prop(catalog, 'align-items')).toBe('start');
    });

    it('卡头/胶囊的基本形状在（避免整段样式被误删）', () => {
        expect(prop(card, 'display')).toBe('flex');
        expect(prop(card, 'flex-direction')).toBe('column');
    });
});

describe('自绘带 display 的容器必须同步写 [hidden] 规则（本仓已踩四次）', () => {
    // 浏览器默认的 `[hidden] { display: none }` 优先级是 (0,1,0)，与单类名选择器**同级**；
    // 本文件里的规则只要能匹配上、且更晚出现，就会覆盖它 ⇒ 元素明明 hidden="true" 却照旧显示。
    // 真机踩过：`.rl-asr-tier`（档位行）、`.rl-vp-emptystage-spin`（未关联空态还在转圈）、
    // `.rl-asr-more`（whisper 六档全摊后，界面上挂着一个「展开其余 3 档」的死按钮）、
    // `.rl-asr-card`（D 版卡片自带 display:flex ⇒ 家族折叠点了没反应）。
    const cases = [
        { sel: '.rl-asr-tier[hidden]', what: '档位行（旧结构，仅作守卫代表）' },
        { sel: '.rl-asr-more[hidden]', what: '「展开其余 N 档」按钮' },
        { sel: '.rl-vp-emptystage-spin[hidden]', what: '未关联空态的转圈' },
        { sel: '.rl-asr-card[hidden]', what: 'D 版引擎卡片（家族折叠）' },
        { sel: '.rl-bt-adv-body[hidden]', what: '「高级参数」折叠体' },
    ];

    for (const c of cases) {
        it(`🔴 ${c.what}：${c.sel} 显式 display:none`, () => {
            const body = ruleBody(c.sel);
            expect(body, `缺少 ${c.sel} 规则 —— 该元素会 hidden 但照旧显示`).not.toBe('');
            expect(prop(body, 'display')).toBe('none');
        });
    }
});

/**
 * 🔴 第 17 轮：用户 m05717 ① 的「左导航 + 右上档位格 + 右下管家」三块结构。
 *
 * 这一批全是**排版接线**，tsc 与行为测试都摸不到（jsdom 不做布局，`getBoundingClientRect` 恒 0），
 * 出问题只有打开设置页才看得见。真机量测基线（800px popout）：
 * `{pick2:{w:468}, row:{w:446,h:296}, nav:{w:172,h:296}, top:{w:264,h:264}, tg cell:129}`
 * —— nav.h === row.h 就是用户要的「左侧高度跟随右上对齐」。
 */
describe('左导航 + 右上档位格：排版接线（用户 m05717 ①）', () => {
    const row = ruleBody('.rl-asr-row');
    const nav = ruleBody('.rl-asr-nav');

    it('🔴 .rl-asr-row 是两列两行的 Grid：左上导航 / 右上档位 / 右下三模块', () => {
        // 🔴 用户 m06406 ①：「右下栏框没有环境配置，还在模型下方列着③」——
        //    三模块过去挂在 `.rl-asr-pick2` 下面横铺整行，看着就像挂在模型下方。
        //    Grid 让三模块落在 (2,2)，正好在档位格下面。
        expect(prop(row, 'display')).toBe('grid');
        expect(prop(row, 'grid-template-columns')).toBe('172px minmax(0, 1fr)');
        expect(prop(row, 'grid-template-rows')).toBe('auto auto');
    });

    it('🔴 左侧高度跟随右上：靠同一网格行自动等高（⛔ 别再写 max-height 硬凑）', () => {
        // 两条路都试过并推翻：flex stretch 会被三模块一起撑高；JS 量高回填
        // 在「先建 DOM 后挂载」的设置页里量到 0（真机三次失败）。
        // 🔴 2026-11-11 用户报「语音转文字怎么拉长空白了出了这么多」后，左栏改为**竖跨两行**
        //    （`grid-row: 1 / span 2`）：行高只由右上与三模块决定，空白消失、分割线连到底。
        //    第 1 行高因此 = max(nav, top) 不再是唯一约束，但 nav 仍 stretch 到整列。
        const top = ruleBody('.rl-asr-top');
        expect(prop(nav, 'grid-row')).toBe('1 / span 2');
        expect(prop(top, 'grid-row')).toBe('1');
        expect(prop(nav, 'align-self')).toBe('stretch');
        expect(prop(top, 'align-self')).toBe('stretch');
    });

    it('🔴 反向守卫：左导航不许用 contain:size 压行高（会把 7 项压成 3 项可见）', () => {
        // 试过 `contain: size`：行高确实只由右上决定了（724 → 581），
        // 但导航被压成「右上那一行的高」（实测 153px），7 项只剩 3 项、要滚动才看得到
        // X-ASR / Confucius4。正确解是 grid-row: 1 / span 2。
        expect(prop(nav, 'contain')).toBe('');
    });

    it('⛔ 反向守卫：两栏都不许写死 max-height（会和 Grid 行高打架）', () => {
        const top = ruleBody('.rl-asr-top');
        expect(prop(nav, 'max-height')).toBe('');
        expect(prop(top, 'max-height')).toBe('');
    });

    it('🔴 三模块落在 (2,2)：档位格正下方，不横铺到左导航下面', () => {
        const bt = ruleBody('.rl-asr-bt');
        expect(prop(bt, 'grid-column')).toBe('2');
        expect(prop(bt, 'grid-row')).toBe('2');
    });

    it('⛔ 反向守卫：左导航不许写死 height（定死了就不跟右上走）', () => {
        expect(prop(nav, 'height')).toBe('');
    });

    it('🔴 三模块在 264px 窄列里：setting-item 必须单栏（⛔ 否则一行撑到 1581px）', () => {
        // 用户 m06406 ①：三模块移进右列后只有 264px 宽，核心 `.setting-item` 是 `flex row`，
        // 「名称」与「控件」并排 ⇒ 真机一行高 **1581 / 1718px**，路径逐字竖排 + 横向滚动条。
        // 与 `.rl-asr-confbody .setting-item`（styles.css:4447）同一套修法。
        const item = ruleBody('.rl-bt-mod .setting-item');
        const ctrl = ruleBody('.rl-bt-mod .setting-item-control');
        expect(item).not.toBe('');
        expect(prop(item, 'flex-direction')).toBe('column');
        expect(prop(item, 'align-items')).toBe('stretch');
        expect(prop(ctrl, 'width')).toBe('100%');
        expect(prop(ctrl, 'flex-wrap')).toBe('wrap');
    });

    it('🔴 设备按钮要允许换行（核心 button 的 nowrap 会撑宽 255px 溢出）', () => {
        // 真机：`.rl-bt-dev w:180 sw:255`，文案「未检测到，将默认使用 CPU」不换行，
        // 把整个模块撑到 sw:316 / cw:250。
        const dev = ruleBody('.rl-bt-dev');
        expect(prop(dev, 'white-space')).toBe('normal');
        expect(prop(dev, 'max-width')).toBe('100%');
    });

    it('⛔ 反向守卫：左导航不许写死 height（定死了就不跟右上走）', () => {
        // 🔴 2026-11-11（第 18 轮，用户 m06406 ①）判据更新：
        //    旧守卫写的是「height 与 max-height 都必须为空」，前提是 `.rl-asr-row` 用 stretch。
        //    右列改成「右上 + 三模块」两段后，stretch 会把导航拉到两段之和那么高，
        //    所以 row 改回 flex-start，同高改由**两条同值 max-height** 保证。
        //    ⇒ `height` 仍然必须是空（写死就跟不上右上），`max-height` 由下一条断言管。
        expect(prop(nav, 'height')).toBe('');
        expect(prop(nav, 'align-self')).not.toBe('flex-start');
    });

    it('🔴 左导航固定 172px + 自带右分割线（用户要的「明显的分割线」）', () => {
        // Grid 化之后宽度有两个来源：`grid-template-columns: 172px` 定轨道、`width: 172px` 定自身。
        // 两者必须一致，否则导航会在 172px 的轨道里按另一个宽度排。
        expect(prop(nav, 'width')).toBe('172px');
        expect(prop(row, 'grid-template-columns')).toContain('172px');
        expect(prop(nav, 'border-right')).toContain('1px solid');
    });

    it('🔴 档位格网格用 auto-fill + min(104px, 100%)，并 align-items:start', () => {
        const grid = ruleBody('.rl-asr-tiergrid');
        const cols = prop(grid, 'grid-template-columns');
        expect(cols).toContain('auto-fill');
        // `100%` 不能省：只写 minmax(104px, 1fr) 时窄容器仍算出 104px 轨道 ⇒ 横向溢出。
        expect(cols).toMatch(/min\(\s*104px\s*,\s*100%\s*\)/);
        expect(prop(grid, 'align-items')).toBe('start');
    });
});

describe('导航按钮要把核心样式的外观夺回来（⛔ 单类名会被压过）', () => {
    // 核心 `.theme-light button:not(.clickable-icon)` 是 (0,2,1)，会覆盖浅色/上底色/边框/**文字色**。
    // 🔴 真机实测：只写单类名 `.rl-asr-navi { color: #999 }` 时，未选中项算出来仍是
    //    `rgb(15, 15, 15)` —— 用户要的「未选中整体变灰（如 #999）」完全没生效。
    const base = ruleBody('.rl-asr-nav > button.rl-asr-navi');
    const on = ruleBody('.rl-asr-nav > button.rl-asr-navi.is-on');

    it('未选中态：灰字 + 透明底 + 透明竖线', () => {
        expect(base).not.toBe('');
        expect(prop(base, 'color')).toBe('#999');
        expect(prop(base, 'background')).toBe('transparent');
        expect(prop(base, 'box-shadow')).toContain('inset 2px 0 0');
    });

    it('选中态：正常色 + accent 竖线（用户要的「高亮背景或左侧竖线」）', () => {
        expect(on).not.toBe('');
        expect(prop(on, 'color')).toBe('var(--text-normal)');
        expect(prop(on, 'box-shadow')).toContain('var(--interactive-accent)');
    });

    it('🔴 选择器必须是复合形态（单类名压不过核心）', () => {
        // 断言的是**源码里那条选择器真的存在**：`>` + `button` + 类名 = (0,2,1) 以上。
        expect(css).toContain('.rl-asr-nav > button.rl-asr-navi');
    });

    it('云端空壳行不是 button（没有可点入口就不该长得像入口）', () => {
        // 它在 TS 里是 `div.rl-asr-navi.is-cloud.is-todo`。
        expect(ruleBody('.rl-asr-navi.is-todo')).not.toBe('');
    });
});

describe('组宽度对齐上面的「媒体载体」（用户 m08459）', () => {
    // 🔴 由来（用户逐字）：「统一一下宽度，对齐上面的 媒体载体」。
    //    真机量测（改前）：
    //      媒体载体（原生组）     body pl=0    → 行 232→756 / 524px
    //      语音转文字（非原生组） body pl=32px → `.rl-voice-card` 左缘 264 宽 492
    //                                              `.rl-asr-pick2` 再被 `.rl-asr-sec` 的 11px 挤到 244 宽 500
    //    两条独立的「多出来的一圈」：
    //      ① 非原生组的 `.rl-svc-group-body` **不是** `.setting-items`，躲过了 `padding: 0` 那条，
    //         仍吃基础规则的 `calc(--size-4-4 * 2)` = 32px；
    //      ② `.rl-asr-sec` 当年是「卡内分段」，自带 border/底色/`9px 11px` —— 现在外层已有组框、
    //         里面 pick2 又画自己的框，这层再画就是卡中卡，那 11px 把 pick2 挤窄。

    it('🔴 播放阅读页的非原生组 body 必须清零左右内距', () => {
        const body = ruleBody('.rl-set-page[data-page="immersive"] .rl-svc-group-body');
        expect(body).not.toBe('');
        expect(prop(body, 'padding-left')).toBe('0');
        expect(prop(body, 'padding-right')).toBe('0');
    });

    it('🔴 `.rl-asr-sec.is-bare` 必须去掉自绘边框/底色/内距（⛔ 别删整条：flex 与 gap 仍要用）', () => {
        const bare = ruleBody('.rl-asr-sec.is-bare');
        expect(bare).not.toBe('');
        expect(prop(bare, 'padding')).toBe('0');
        expect(prop(bare, 'border')).toBe('none');
        expect(prop(bare, 'background')).toBe('transparent');
        // 反向守卫：基础规则里的纵向排布不能被 `is-bare` 一起抹掉。
        const base = ruleBody('.rl-asr-sec');
        expect(prop(base, 'display')).toBe('flex');
        expect(prop(base, 'flex-direction')).toBe('column');
    });

    it('🔴 组件的 sec1 必须带 is-bare（否则又变成卡中卡 + 挤窄 pick2）', () => {
        const src = read('src/Settings.ts');
        expect(src).toContain("'rl-asr-sec is-bare'");
        // 反向守卫：不许再出现不带 is-bare 的纯 `.rl-asr-sec` 建法。
        expect(src).not.toMatch(/createDiv\(\{\s*cls:\s*'rl-asr-sec'\s*\}\)/);
    });
});

describe('档位格里的「各自下载」入口 + 锁定时高级参数仍可展开（用户 m08573）', () => {
    // 🔴 由来（用户逐字）：「选择模型的各自下载按钮去哪了找不到入口，还有这个右下的高级参数
    //    点击展不开」。两条都不是样式错，是**接线错**，tsc 与行为单测都看不见：
    //      ① 档位格原来是 `<button>`，里面只画一个 `⤓` 符号 —— 点整格只会「选中」，
    //         想装某档得滚到「资产与凭证」找那个笼统的「重新安装 X」；
    //         而且 `<button>` 里不能再嵌 `<button>`（非法 HTML，浏览器会把内层甩出去），
    //         所以格子必须改成 `div[role=button]` + 自己管键盘，未装时才挂真按钮。
    //      ② 环境体检有致命缺失时 `runBody` 无条件拦下所有 click/keydown，
    //         连「高级参数」这颗纯展开按钮也被挡死（真机实测 `advBefore/AfterHidden` 恒 true）。
    //         展开只读不放宽任何运行配置 ⇒ 必须放行；要锁的是设备/语言/线程这些能改行为的控件。

    // 🔴 用剥过注释的源码做匹配：`Settings.ts` 的注释里大段引用着「旧写法为什么不行」
    //    （`advBody.hidden = true` / `展开其余` / `CONF_TILE_LIMIT` 都在注释里出现过），
    //    不剥注释时反向守卫会被自己的文档打穿 —— 本仓铁律 #379 / #730 / #731。
    const src = stripComments(read('src/Settings.ts'));

    it('🔴 档位格必须是 div[role=button]（button 里嵌 button 非法，内层会被浏览器甩出去）', () => {
        expect(src).toContain("const cell = grid.createDiv({ cls: 'rl-asr-tg' });");
        expect(src).toContain("cell.setAttribute('role', 'button');");
        // 反向守卫：不许退回 `<button>` 建格子。
        expect(src).not.toMatch(/grid\.createEl\('button',\s*\{\s*cls:\s*'rl-asr-tg'/);
    });

    it('🔴 未装档位必须挂一颗真的下载按钮，点了开安装弹窗', () => {
        // 真按钮（不是 span）：有 class、有文案、有 aria-label、点了走 openAsrInstall。
        expect(src).toContain("const dl = foot.createEl('button', { cls: 'rl-asr-tg-dl' });");
        expect(src).toContain("dl.setText('⤓ 下载');");
        expect(src).toContain('this.plugin.openAsrInstall(');
        // 点下载不能顺带只「选中」：必须先 stopPropagation，否则整格的 pick 也会跑（重复重绘）。
        expect(src).toMatch(/ev\.stopPropagation\(\);\s*ev\.preventDefault\(\);\s*void this\.switchAsrModel/);
        // 反向守卫：不许退回「只画一个符号」的 span。
        expect(src).not.toMatch(/cls:\s*'rl-asr-tg-dl',\s*text:\s*'⤓'\s*\}/);
    });

    it('🔴 下载按钮的 CSS 必须是复合选择器（单类名压不过核心的 button 规则）', () => {
        const dl = ruleBody('.rl-asr-tg > .rl-asr-tg-foot > button.rl-asr-tg-dl');
        expect(dl).not.toBe('');
        expect(prop(dl, 'background')).toBe('transparent');
        expect(prop(dl, 'box-shadow')).toBe('none');
        expect(prop(dl, 'white-space')).toBe('nowrap');
        // 体积和按钮同处一行
        const foot = ruleBody('.rl-asr-tg-foot');
        expect(foot).not.toBe('');
        expect(prop(foot, 'display')).toBe('flex');
        expect(prop(foot, 'justify-content')).toBe('space-between');
    });

    it('🔴 高级参数必须常驻展开（用户 m08707：「包括高级参数也展开」）', () => {
        // 折叠那套（toggle 按钮 + advBody.hidden）已整体退场。
        expect(src).not.toContain('rl-bt-adv-toggle');
        expect(src).not.toContain("advBody.hidden = true");
        expect(src).not.toContain("advBody.hidden = !open");
        // 常驻形态：一个段落标题 + 直接铺开的 body
        expect(src).toContain("runBody.createDiv({ cls: 'rl-bt-adv-title', text: '高级参数' });");
        expect(src).toContain("const advBody = runBody.createDiv({ cls: 'rl-bt-adv-body' });");
        // 阻断式拦截仍在（致命缺失时不许改参数），且不再有「为某颗按钮开豁免」的分支。
        expect(src).not.toContain('isJustToggle');
    });

    it('🔴 环境清单不许再折「展开其余 N 项」（用户 m08707：全部默认展开）', () => {
        expect(src).not.toContain('CONF_TILE_LIMIT');
        expect(src).not.toContain('applyTileFold');
        expect(src).not.toContain('rl-asr-confmore');
        // 反向守卫：不许出现「展开其余」这句死文案
        expect(src).not.toContain('展开其余');
    });

    it('🔴 左栏只显示名称、图标走各家品牌 SVG（用户 m08707）', () => {
        // 副标题不再画进左栏（挪进 data-tip）
        expect(src).not.toContain("cls: 'rl-asr-navi-sub'");
        // 走品牌标记
        expect(src).toContain('asrBrandSvg(group.engine, 14)');
        expect(src).toContain("asrBrandSvg } from 'pure/asrBrandIcon'");
        // `house` 只允许作为**认不出引擎**时的兜底（否则左栏会缺一个对齐位）
        // ⇒ 它必须出现在 `else` 分支里，不能无条件先画。
        expect(src).toMatch(/if \(markSvg\) ico\.innerHTML = markSvg;\s*else safeSetIcon\(ico, 'house'\);/);
    });

    /**
     * 🔴 用户 m09233（逐字）：「删除掉描述文字『把音视频里的声音识别成字幕，全部在本机完成』
     *    选择模型(小标题分组，这没用排序了删除掉) 左边按大模型分组平铺所有档位…」
     * ⇒ 三段文案 + 那个带序号的小标题**全部退场**。
     * 这些是「反向守卫」：光删没用，得钉住不许回来 —— 否则下一次重构又会顺手补一段说明。
     */
    describe('语音转文字组：三段说明文字与小标题已按 m09233 删除', () => {
        it('🔴 不许再有「1 选择模型」小标题（含序号徽标与「N 个可用 / 共 M 个」）', () => {
            expect(src).not.toContain("secHead(sec1, '1', '选择模型'");
            expect(src).not.toContain('rl-asr-sec-note');
            // 常量整条删掉，⛔ 不留空字符串等着被接回去
            expect(src).not.toContain('ASR_MODEL_PICK_DESC');
        });

        it('🔴 不许再有「左边按大模型分组平铺…」「把音视频里的声音识别成字幕…」两句', () => {
            expect(src).not.toContain('左边按大模型分组平铺所有档位');
            expect(src).not.toContain('把音视频里的声音识别成字幕');
            // 组内说明整块退场（TTS 那句也一并退场）
            expect(src).not.toContain('把文字念出来：选一个声音');
        });

        it('🔴 「几个可用」这个信息没丢：改由左导航每行的 已装/总数 承担', () => {
            // 反向守卫的配套断言 —— 删了标题行，就不能顺手把这份统计也删掉
            expect(src).toContain('rl-asr-navi-count');
            expect(src).toContain('readyInGroup + \'/\' + group.tiers.length');
        });
    });

    /**
     * 🔴 用户 m09233：「把文字转语音的UI也改成语音转文字选择模型那样分本地和云端」。
     * 两栏骨架**复用 STT 那套类名**（`.rl-asr-pick2/.rl-asr-row/.rl-asr-nav/.rl-asr-top/.rl-asr-bt`），
     * ⛔ 不许另起一套 —— 宽度/间距/灰化/键盘可达性都已经在那里调好，抄一份必然漂移。
     */
    describe('文字转语音：与语音转文字同构的两栏（本地 / 云端）', () => {
        it('🔴 TTS 也用 .rl-asr-pick2 + .rl-asr-row + 左导航 + 右上 + 右下', () => {
            const fn = src.slice(src.indexOf('private renderTtsVoiceRows'));
            expect(fn.slice(0, 8000)).toContain("const pick2 = host.createDiv({ cls: 'rl-asr-pick2' });");
            expect(fn.slice(0, 8000)).toContain("const row = pick2.createDiv({ cls: 'rl-asr-row' });");
            expect(fn.slice(0, 8000)).toContain("const nav = row.createDiv({ cls: 'rl-asr-nav' });");
            expect(fn.slice(0, 8000)).toContain("const top = row.createDiv({ cls: 'rl-asr-top' });");
            expect(fn.slice(0, 8000)).toContain("const bt = row.createDiv({ cls: 'rl-asr-bt' });");
        });

        it('🔴 两组标题是「本地语音 / 云端接入」，且都走同一个 mkNavHead', () => {
            const fn = src.slice(src.indexOf('private renderTtsVoiceRows'));
            expect(fn.slice(0, 8000)).toContain("this.mkNavHead(nav, 'house', '本地语音', '不走网络');");
            expect(fn.slice(0, 8000)).toContain("this.mkNavHead(nav, 'cloud', '云端接入', '按次计费', true);");
            // 提成方法的目的是「TTS 与 STT 共用一款标题」，⛔ 别在两处各复制一份实现
            expect(src).toContain('private mkNavHead(nav: HTMLElement, icon: string, title: string, note: string, cloud = false): void {');
            const defs = src.split('private mkNavHead(').length - 1;
            expect(defs).toBe(1);
        });

        it('🔴 音色走档位格 .rl-asr-tg（单选互斥），旧的一行式 .rl-ai-svc 已退场', () => {
            const fn = src.slice(src.indexOf('private renderTtsVoiceRows'));
            expect(fn.slice(0, 8000)).toContain("grid.createDiv({ cls: 'rl-asr-tg' })");
            // 反向守卫：旧的一行式行骨架不许回来
            expect(src).not.toContain("row.settingEl.addClass('rl-ai-svc')");
            expect(src).not.toContain("cls: 'rl-ai-engine-btn'");
        });

        it('切音源 / 切音色都只落库（重画走 redraw，⛔ 不再整页重建）', () => {
            const fn = src.slice(src.indexOf('private renderTtsVoiceRows'));
            expect(fn.slice(0, 8000)).toContain('saveTtsEngine(value);');
            expect(fn.slice(0, 8000)).toContain('saveCloudVoice(o.value)');
            expect(fn.slice(0, 8000)).toContain('saveVoiceUri(o.value)');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 🔴 用户 m09565 第 17 轮：① 准确度/定位/场景　② 点击不重置滚动　③ 云端要显示模型名
    // ─────────────────────────────────────────────────────────────────────────────
    describe('m09565 ①：右上要给出准确度 / 核心定位 / 适用场景', () => {
        it('渲染出 .rl-asr-meta，且三项各自的键都在', () => {
            const s = stripComments(read('src/Settings.ts'));
            expect(s).toContain("const meta = top.createDiv({ cls: 'rl-asr-meta' });");
            expect(s).toContain("acc.createSpan({ cls: 'rl-asr-meta-key', text: '准确度' });");
            expect(s).toContain("tagRow.createSpan({ cls: 'rl-asr-meta-key', text: '核心定位' });");
            expect(s).toContain("sceneRow.createSpan({ cls: 'rl-asr-meta-key', text: '适用场景' });");
        });

        it('🔴 准确度要给中/英两个百分号，缺测的一侧保持 `-`（真机曾渲成「1.95/-%」）', () => {
            const s = stripComments(read('src/Settings.ts'));
            // 正向：两侧各自拼百分号
            expect(s).toContain("const zh = curTierRow.accZh === null ? '-' : `${curTierRow.accZh}%`;");
            expect(s).toContain("const en = curTierRow.accEn === null ? '-' : `${curTierRow.accEn}%`;");
            expect(s).toContain('text: `中文 ${zh} · 英文 ${en}`');
            // 🔴 反向守卫：不许再把 accuracyLabel() 的返回值整个后面挂一个 %
            expect(s).not.toMatch(/词错率 \$\{accuracyLabel\([^)]*\)\}%/);
        });
    });

    describe('m09565 ②：点交互不许把用户甩回设置页顶部', () => {
        it('🔴 滚动容器要靠祖先链现找，不许写死 .rl-set-content（它 overflow 是 visible，永远不滚）', () => {
            const s = stripComments(read('src/Settings.ts'));
            expect(s).toContain('ReelLudicSettingTab.findScrollHost(containerEl)');
            // 反向守卫：旧的 prevContent / .rl-set-content 取法必须退场
            expect(s).not.toContain("const prevContent = containerEl.querySelector('.rl-set-content');");
        });

        it('findScrollHost 的判据 = overflow-y auto|scroll 且 scrollHeight 超出 4px', () => {
            const s = stripComments(read('src/Settings.ts'));
            const fn = s.slice(s.indexOf('private static findScrollHost('));
            expect(fn.slice(0, 1200)).toContain("if (oy !== 'auto' && oy !== 'scroll') continue;");
            expect(fn.slice(0, 1200)).toContain('el.scrollHeight > el.clientHeight + 4');
        });

        it('🔴 恢复滚动位置时**重新找**宿主（旧的那个已经被 empty 掉了）', () => {
            const s = stripComments(read('src/Settings.ts'));
            const block = s.slice(s.indexOf('if (keepScroll > 0) {'));
            expect(block.slice(0, 400)).toContain('const host = ReelLudicSettingTab.findScrollHost(containerEl);');
            expect(block.slice(0, 400)).toContain('if (host) host.scrollTop = keepScroll;');
        });

        it('🔴 TTS 切音源 / 切音色都只重画卡片：不许出现 this.display()', () => {
            const s = stripComments(read('src/Settings.ts'));
            const fn = s.slice(s.indexOf('private renderTtsVoiceRows'));
            const body = fn.slice(0, 12000);
            expect(body).not.toContain('this.display()');
            expect(body).toContain('redraw();');
        });
    });

    describe('m09565 ③：云端音色要显示来自哪个模型', () => {
        it('云端「当前：」走 cloudVoiceFullLabel，且传的是 curVoice 而不是 remembered', () => {
            const s = stripComments(read('src/Settings.ts'));
            expect(s).toContain(
                "const curLabel = kind === 'cloud' ? cloudVoiceFullLabel(curVoice) : ttsVoiceLabel(kind, voices, remembered);",
            );
        });

        it('音色格：云端格子名带模型短名与音色 id，脚注显示模型短名', () => {
            const s = stripComments(read('src/Settings.ts'));
            expect(s).toContain("const cellName = kind === 'cloud' ? cloudVoiceFullLabel(o.value) : o.label;");
            expect(s).toContain("const cellFoot = kind === 'cloud' ? cloudModelShortName() : g.label;");
            expect(s).toContain("cell.createDiv({ cls: 'rl-asr-tg-name', text: cellName });");
            expect(s).toContain("foot.createSpan({ cls: 'rl-asr-tg-size', text: cellFoot });");
        });
    });
});

// 🔴 用户 m07854 ④（2026-11-13）：「将语音与识别组的高度限制一下」。
//    组名实际是「语音转文字」——`SETTING_GROUP_ICONS` 里没有「语音与识别」这个键。
//    高度来源：环境体检 6~7 项 tile + whisper 工具链 2 行 + 资产与凭证 + 运行参数，
//    原先 `.rl-asr-tiles` 完全不限高 ⇒ 真机整组破千像素，把同页后两组挤到折叠线以下。
//    ⇒ 当场问过用户，用户选的档位是「max-height + 内部滚动」。
//    ⚠️ 这覆盖了 m03035「不要滚动条」与 m05717「容器不限高、不内滚」两条旧口径。
describe('语音转文字组限高（用户 m07854 ④）', () => {
    it('🔴 `.rl-asr-tiles` 必须有 max-height + 纵向内滚', () => {
        const body = ruleBody('.rl-asr-tiles');
        expect(body, '.rl-asr-tiles 规则不存在').not.toBe('');
        // 必须是 max-height（不是 height）：只有 1~2 项时不该撑出一片空白
        expect(prop(body, 'max-height')).not.toBe('');
        expect(prop(body, 'height')).toBe('');
        expect(prop(body, 'overflow-y')).toBe('auto');
        // 滚到底不许把整页带着滚（设置页外层也有滚动）
        expect(prop(body, 'overscroll-behavior')).toBe('contain');
    });

    it('max-height 是有限值（写成 none / 百分比等于没限）', () => {
        const v = prop(ruleBody('.rl-asr-tiles'), 'max-height');
        expect(v).not.toBe('none');
        expect(v).not.toContain('%');
        expect(v).toMatch(/^\d+(px|em|rem)$/);
    });

    it('🔴 反向：限高只能纵向，横向不许出现滚动条', () => {
        const body = ruleBody('.rl-asr-tiles');
        expect(prop(body, 'overflow-x')).not.toBe('auto');
        expect(prop(body, 'overflow')).not.toBe('auto');
    });

    it('渲染端注释与 CSS 同口径（写着「不限高、不内滚」就是在骗下一个人）', () => {
        const raw = read('src/Settings.ts');
        expect(raw).toContain('m07854 ④');
        expect(raw).toContain('max-height + 内部滚动');
        // 旧口径的原文不许再作为**现行**说明留着
        expect(raw).not.toContain('容器仍不限高、不内滚，靠整页滚动即可');
    });
});
