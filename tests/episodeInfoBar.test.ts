/**
 * m07813③（2026-11-15 用户逐字）：「给播放器详情页的简介栏优化一下如加评分来源、标签、
 * 简介可通过省略号展开完整」。
 *
 * 本文件守三样东西：
 *  ① 来源行：有 `sourceName` 才画，且三件（来源 / 分 / 人数）都是可选、都有 url 才出 ↗；
 *  ② 标签胶囊：⛔ 不合进题材那个 `chips` 数组（会破坏「首枚恒为类型」的高亮规则），
 *     且用户裁定「只展示，不可点」⇒ 不许挂 click / 不许写 `cursor: pointer`；
 *  ③ 简介展开：`-webkit-line-clamp: 4` 的裁切仍在（省略号），展开靠 `.is-open`，
 *     且**超出才出按钮**（3 行简介挂一颗点了没变化的按钮 = 假功能）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const VIEW = readFileSync(resolve(ROOT, 'src/views/EpisodePageView.ts'), 'utf8');
const CSS = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

/** 剥掉 `/* ... *\/` 与行首 `//` —— 本仓注释里会**逐字**保留用户原话与旧代码，裸匹配必假红 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
}
const VIEW_CODE = stripComments(VIEW);
const CSS_CODE = stripComments(CSS);

/** 按行首锚定取一条规则体（⛔ 不能用 indexOf：同名选择器在 `:global` 等前缀下会先命中别的） */
function ruleBody(src: string, selector: string): string {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^[ \\t]*${esc}([^}]*)\\}`, 'm').exec(src);
    return m ? m[1] : '';
}

/** 取一个方法的体（从签名到同缩进的下一个成员） */
function methodBody(src: string, signature: string): string {
    const a = src.indexOf(signature);
    if (a < 0) return '';
    const rest = src.slice(a + signature.length);
    const end = rest.search(/\n    (?:private |public |protected |\/\*\*|}\n)/);
    return end < 0 ? rest : rest.slice(0, end);
}

describe('m07813③ 简介栏：来源行', () => {
    const body = methodBody(VIEW_CODE, 'private buildSourceLine(');

    it('有来源名才画整行（⛔ 无出处的裸分数）', () => {
        expect(body).not.toBe('');
        expect(body).toMatch(/const name = \(ctx\.entry\.sourceName \?\? ''\)\.trim\(\);/);
        // 早退必须在建盒子之前
        const guard = body.indexOf("if (!name) return null;");
        const create = body.indexOf("cls: 'rl-epp-info-src'");
        expect(guard).toBeGreaterThan(-1);
        expect(create).toBeGreaterThan(guard);
    });

    it('三件都是可选：分 > 0 才画分，人数 > 0 才画人数', () => {
        expect(body).toMatch(/ctx\.entry\.communityScore/);
        expect(body).toMatch(/typeof score === 'number' && Number\.isFinite\(score\) && score > 0/);
        expect(body).toMatch(/const cnt = ctx\.entry\.ratingCount;/);
        expect(body).toMatch(/typeof cnt === 'number' && Number\.isFinite\(cnt\) && cnt > 0/);
        // 人数文案
        expect(body).toMatch(/人评价/);
        // 🔴 反向守卫：⛔ 别用 `rating`（个人评分，半星制 0~5）冒充大众评分
        expect(body).not.toMatch(/ctx\.entry\.rating\b/);
    });

    it('有 http(s) 原页面才出 ↗，且可点 / 可键盘', () => {
        expect(body).toMatch(/if \(\/\^https\?:\\\/\\\/\/i\.test\(url\)\)/);
        expect(body).toMatch(/row\.addClass\('is-link'\)/);
        expect(body).toMatch(/setAttribute\('role', 'link'\)/);
        expect(body).toMatch(/row\.tabIndex = 0;/);
        expect(body).toMatch(/window\.open\(url, '_blank'\)/);
        // Enter 键盘可达（div 当链接用就必须自己接）
        expect(body).toMatch(/if \(ev\.key !== 'Enter'\) return;/);
        // 🔴 提示单一真源：读屏名走 srLabel，⛔ 不许 setAttribute('aria-label')
        expect(body).toMatch(/srLabel\(row, /);
        expect(body).not.toMatch(/setAttribute\('aria-label'/);
    });

    it('CSS：只在 .is-link 时才给手型光标（⛔ 无条件 pointer 会让不可点的行看起来能点）', () => {
        const base = ruleBody(CSS_CODE, '.rl-epp-info-src');
        expect(base).not.toBe('');
        expect(base).not.toMatch(/cursor:\s*pointer/);
        const link = ruleBody(CSS_CODE, '.rl-epp-info-src.is-link');
        expect(link).toMatch(/cursor:\s*pointer/);
        expect(ruleBody(CSS_CODE, '.rl-epp-info-src.is-link:focus-visible')).toMatch(/outline:/);
    });
});

describe('m07813③ 简介栏：标签胶囊', () => {
    const body = methodBody(VIEW_CODE, 'private appendTagChips(');

    it('标签独立成组，⛔ 不合进题材的 chips 数组', () => {
        expect(body).not.toBe('');
        expect(body).toMatch(/cls: 'rl-epp-info-tags'/);
        expect(body).toMatch(/cls: 'rl-epp-info-chip is-tag'/);
        // 反向守卫：chips 数组在 buildInfoCard 里，这个方法的体里不该出现它
        expect(body).not.toMatch(/\bchips\.push\(/);
    });

    it('空标签整组不画（⛔ 空盒子带 margin 会留一条看不见的缝）', () => {
        expect(body).toMatch(/if \(tags\.length === 0\) return;/);
        const guard = body.indexOf('if (tags.length === 0) return;');
        const create = body.indexOf("cls: 'rl-epp-info-tags'");
        expect(create).toBeGreaterThan(guard);
    });

    it('去重（保持录入顺序，⛔ 不是排序）', () => {
        expect(body).toMatch(/const seen = new Set<string>\(\);/);
        expect(body).toMatch(/seen\.add\(t\), true/);
        expect(body).not.toMatch(/\.sort\(/);
    });

    it('用户裁定「只展示，不可点」：⛔ 不许挂 click / 不许 cursor: pointer', () => {
        expect(body).not.toMatch(/addEventListener\('click'/);
        expect(body).not.toMatch(/cursor/);
        const tag = ruleBody(CSS_CODE, '.rl-epp-info-chip.is-tag');
        expect(tag).not.toBe('');
        expect(tag).not.toMatch(/cursor:\s*pointer/);
        // 也⛔ 不许 hover 效果（那暗示可点）
        expect(CSS_CODE).not.toMatch(/\.rl-epp-info-chip\.is-tag:hover/);
    });
});

describe('m07813③ 简介栏：省略号 + 展开全文', () => {
    const body = methodBody(VIEW_CODE, 'private buildDesc(');

    it('裁切仍靠 -webkit-line-clamp（省略号），展开不靠 max-height', () => {
        const base = ruleBody(CSS_CODE, '.rl-epp-info-desc');
        expect(base).toMatch(/-webkit-line-clamp:\s*4/);
        expect(base).toMatch(/-webkit-box-orient:\s*vertical/);
        expect(base).toMatch(/overflow:\s*hidden/);
        // 反向守卫：⛔ 别用 max-height 模拟裁切（会在任意高度切半行）
        expect(base).not.toMatch(/max-height/);
    });

    it('展开态退回 block 并把 clamp 置 unset', () => {
        const open = ruleBody(CSS_CODE, '.rl-epp-info-desc.is-open');
        expect(open).not.toBe('');
        expect(open).toMatch(/display:\s*block/);
        expect(open).toMatch(/-webkit-line-clamp:\s*unset/);
        expect(open).toMatch(/overflow:\s*visible/);
    });

    it('🔴 超出才出按钮（3 行简介挂一颗点了没变化的按钮 = 假功能）', () => {
        expect(body).toMatch(/if \(desc\.scrollHeight <= desc\.clientHeight \+ 2\) return;/);
        // 量之前必须先挂到树上，且下一帧再量
        expect(body).toMatch(/if \(!desc\.isConnected\) return;/);
        expect(body).toMatch(/requestAnimationFrame/);
        const guard = body.indexOf('scrollHeight <= desc.clientHeight');
        const btn = body.indexOf("cls: 'rl-epp-info-desc-toggle'");
        expect(btn).toBeGreaterThan(guard);
    });

    it('展开 / 收起双向，且带 aria-expanded', () => {
        expect(body).toMatch(/const open = !desc\.hasClass\('is-open'\);/);
        expect(body).toMatch(/desc\.toggleClass\('is-open', open\)/);
        expect(body).toMatch(/btn\.setText\(open \? '收起' : '展开全文'\)/);
        expect(body).toMatch(/btn\.setAttribute\('aria-expanded', open \? 'true' : 'false'\)/);
        // 按钮必须在简介之后紧邻插入（⛔ appendChild 会被后面的内容挤到最底）
        expect(body).toMatch(/desc\.insertAdjacentElement\('afterend', btn\)/);
    });

    it('CSS：按钮是文字型小按钮，⛔ 不拉满整宽', () => {
        const btn = ruleBody(CSS_CODE, '.rl-epp-info-txt .rl-epp-info-desc-toggle');
        expect(btn).not.toBe('');
        expect(btn).toMatch(/align-self:\s*flex-start/);
        expect(btn).toMatch(/background:\s*none/);
        expect(btn).toMatch(/border:\s*none/);
        expect(btn).not.toMatch(/width:\s*100%/);
    });

    it('🔴🔴 按钮必须用**两级**选择器（单类压不过核心 button:not(.clickable-icon)）', () => {
        // 真机实测：单类写法下按钮底是主题按钮灰 rgb(230,230,230)，像贴了一块小方块。
        // 与 `.rl-sp-actions .rl-sp-btn` / `.rl-nav-wrap .rl-nav button` 同一条纪律。
        expect(CSS_CODE).toMatch(/^\.rl-epp-info-txt \.rl-epp-info-desc-toggle \{/m);
        // 反向守卫：⛔ 不许出现裸单类规则（`:hover` / `:focus-visible` 的裸形态也一起禁）
        expect(CSS_CODE).not.toMatch(/^\.rl-epp-info-desc-toggle\s*[{:]/m);
    });
});

describe('m07813③ 接线：三样都挂在简介卡里', () => {
    it('buildInfoCard 依次接来源行 → 标签 → 简介', () => {
        const card = methodBody(VIEW_CODE, 'private buildInfoCard(');
        const src = card.indexOf('this.buildSourceLine(ctx)');
        const tags = card.indexOf('this.appendTagChips(txt, ctx.entry)');
        const desc = card.indexOf('this.buildDesc(txt, ctx.overview)');
        expect(src).toBeGreaterThan(-1);
        expect(tags).toBeGreaterThan(src);
        expect(desc).toBeGreaterThan(tags);
    });

    it('来源行空的时候不往 DOM 塞空盒子', () => {
        const card = methodBody(VIEW_CODE, 'private buildInfoCard(');
        // 🔴 m02759：来源行从「正文里独占一行」改成**塞进第一行右侧**（用户要的右上角横排）。
        // 改前断言的是 `if (srcline) txt.appendChild(srcline);` —— 那形态已废弃，
        // 现在必须挂进 `topRow`，否则右上角是空的、横排语义也没了。
        expect(card).toMatch(/const srcline = this\.buildSourceLine\(ctx\);\s*\n\s*if \(srcline\) topRow\.appendChild\(srcline\);/);
        // 反向守卫：⛔ 不许再用 `txt.appendChild(srcline)` 另起一行
        expect(card).not.toMatch(/txt\.appendChild\(srcline\)/);
    });

    it('🔴 老口径（禁评分行）只禁个人评分与裸分数，本轮不复活那两块', () => {
        // `rl-epp-info-score` / `rl-epp-info-rating` 仍不许回到 JS 里
        expect(VIEW_CODE).not.toMatch(/rl-epp-info-score'/);
        expect(VIEW_CODE).not.toMatch(/rl-epp-info-rating'/);
    });
});

// ── 🔴 m02759（2026-11-17 用户逐字）：「还有这封面上的评分角标去掉，把来源评分放到简介栏
//    右上角横排，题材和标签两种只留标签，还有加个大标题在简介栏」
//    ⇒ 四条各自一条守卫 + 反向守卫，⛔ 任一条回退都要红。
describe('m02759 简介栏四项改造', () => {
    const card = (): string => methodBody(VIEW_CODE, 'private buildInfoCard(');

    it('⑴ 封面右上角的评分角标已删除（JS + CSS 双清）', () => {
        // JS：整个 `.rl-epp-cov-score` 块没了；⛔ 别把角标搬回封面
        expect(VIEW_CODE).not.toContain("'rl-epp-cov-score'");
        // CSS：规则本体也删了（只允许出现在注释里说明「已下线」）
        expect(CSS_CODE).not.toMatch(/^\.rl-epp-cov-score\s*\{/m);
        // 角标是那三个符号在本文件唯一的消费者 ⇒ 一起清掉，别留死 import
        expect(VIEW_CODE).not.toMatch(/^import .*scoreTextOf/m);
        expect(VIEW_CODE).not.toMatch(/^import .*scoreIsPercentOf/m);
        expect(VIEW_CODE).not.toMatch(/^import .*entrySourceLabel/m);
    });

    it('⑵ 来源评分在简介栏第一行右侧横排（挂 topRow，不另起一行）', () => {
        const body = card();
        // 第一行是 `.rl-epp-info-top` 容器
        expect(body).toContain("const topRow = txt.createDiv({ cls: 'rl-epp-info-top' });");
        // 大标题与来源行**都**挂在 topRow 里（顺序：标题在前，来源行在后）
        const t = body.indexOf("topRow.createSpan({ cls: 'rl-epp-info-name'");
        const s = body.indexOf('if (srcline) topRow.appendChild(srcline);');
        expect(t).toBeGreaterThan(-1);
        expect(s).toBeGreaterThan(t);
        // CSS：靠右靠 `margin-left: auto`
        const rule = ruleBody(CSS_CODE, '.rl-epp-info-top .rl-epp-info-src');
        expect(rule).toMatch(/margin-left:\s*auto/);
        // 反向守卫：⛔ 不许再给 `.rl-epp-info-src` 本体留 `margin-top`（那是「独占一行」的形态）
        const base = ruleBody(CSS_CODE, '.rl-epp-info-src');
        expect(base).not.toMatch(/margin-top/);
    });

    it('⑶ 类型 + 题材那排整排删除，只留标签', () => {
        const body = card();
        // JS：chips 容器与三个标签映射符号全没了
        expect(body).not.toContain("'rl-epp-info-chips'");
        expect(body).not.toContain('ENTRY_TYPE_LABELS');
        expect(body).not.toContain('BOOK_KIND_LABELS');
        expect(body).not.toContain('normalizeBookKind');
        // 但标签那一排必须还在（用户裁定「只留标签」）
        expect(body).toContain('this.appendTagChips(txt, ctx.entry);');
        // CSS：chips 容器与「首枚高亮」规则一起下线
        expect(CSS_CODE).not.toMatch(/^\.rl-epp-info-chips\s*\{/m);
        expect(CSS_CODE).not.toMatch(/^\.rl-epp-info-chip:first-child\s*\{/m);
        // 标签胶囊骨架保留（`.is-tag` 还在用）
        expect(CSS_CODE).toMatch(/^\.rl-epp-info-chip\s*\{/m);
        expect(CSS_CODE).toMatch(/^\.rl-epp-info-chip\.is-tag\s*\{/m);
    });

    it('⑷ 简介栏有大标题，且它与元信息不同档（17px > 11.5px）', () => {
        const body = card();
        // 无条件画标题（改前是 `if (showName)`，两处调用点都传 false ⇒ 简介栏永远没标题）
        expect(body).not.toContain('showName');
        // 🔴 必须**无条件**执行：⛔ 不许在前面套任何 `if (...)` —— 只断言「这行文字在」会漏掉
        //    `if (false) topRow.createSpan(...)` 这种「代码在但永远不跑」的假绿（突变实测过）。
        const idx = body.indexOf("topRow.createSpan({ cls: 'rl-epp-info-name'");
        expect(idx).toBeGreaterThan(-1);
        const lineStart = body.lastIndexOf('\n', idx) + 1;
        // 该行行首（去掉缩进后）必须**直接**是 `topRow.createSpan`，前面不能有 `if (`
        expect(body.slice(lineStart, idx).trim()).toBe('');
        // 再钉一次：标题行**上一行**不得出现 `if (` 把这条语句包起来
        const prevLineStart = body.lastIndexOf('\n', lineStart - 2) + 1;
        const prevLine = body.slice(prevLineStart, lineStart - 1).trim();
        expect(prevLine).not.toMatch(/^if\s*\(/);
        // 签名与调用点都必须是单参（⛔ 别把 showName 参数加回来）
        expect(VIEW_CODE).toContain('private buildInfoCard(parent: HTMLElement): void {');
        expect(VIEW_CODE).not.toMatch(/buildInfoCard\([^)]*,\s*false\)/);
        // CSS：大标题 17px/700，元信息仍是 11.5px（两档不能撞）
        const name = ruleBody(CSS_CODE, '.rl-epp-info-name');
        expect(name).toMatch(/font-size:\s*17px/);
        expect(name).toMatch(/font-weight:\s*700/);
        const meta = ruleBody(CSS_CODE, '.rl-epp-info-meta');
        expect(meta).toMatch(/font-size:\s*11\.5px/);
    });

    it('⑷ 页头标题保留（用户裁定「简介栏加，页头那个也保留」）', () => {
        // `.rl-epp-title` 是页头那一份，⛔ 别因为简介栏加了大标题就把它删掉
        expect(VIEW_CODE).toContain("cls: 'rl-epp-title'");
        expect(CSS_CODE).toMatch(/^\.rl-epp-title\s*[,{]/m);
    });
});
