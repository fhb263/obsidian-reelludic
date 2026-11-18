// 剧集页「单集评价面板」的反失活守卫（③ 的回归网）。
//
// 🔴 由来（用户 m01474 逐字）：
//   「单集评价已看后就出现{单集评价·第0集·已评1}啥也不能点击修改了，
//     还有这个选择标签太丑，改成现代化统一的【单集面板不要出现什么第0集等已评数，
//     只在整季表单才显示总评价数】」
//
// 上一轮我把面板交付出去时，这三个 bug 全在：
//   ① 标题拼 `第 ${idx + 1} 集`，而 `activeCellIndex()` 在**纯网络条目**上恒为 -1
//      （`items` 空 ⇒ `items[cur]?.index ?? -1`）⇒ 显示「第 0 集」；
//   ② `commitReview` 第一行 `if (idx < 0) return;` ⇒ 静默 return，
//      chip 画得出来、点了没反应、也没有任何提示 = 「啥也不能点击修改了」；
//   ③ 标题里还拼了 `已评 N`，而用户要求那个数只出现在整季表单里。
//
// ⚠️ 这套守卫**没法**靠纯函数单测锁住：`syncReviewPanel` / `commitReview` 是
//    `EpisodePageView` 的私有方法，构造它要真的 Obsidian `App` + 完整 DOM + 工作区 leaf。
//    所以走源码文本守卫 —— 它锁的不是「算得对不对」，而是「别把失活与集号拼回去」。
//
// ⛔ 写这类守卫的铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：
//    必须**先 strip 注释再匹配**，否则注释里提到 `第 0 集` / `已评` 也能让断言变绿或变红。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
/**
 * 剥注释（Svelte / TS 通用）。
 *
 * 🔴 这里**不能**用朴素的「块注释全贪」那一版（本仓多数测试文件抄的就是它）：
 *    `EntryForm.svelte` 里有 `<input type="file" accept="image/*" ...>`，
 *    那个 `image` 后面的斜杠星号会被当块注释起点，一路吞到**下一个**星号斜杠
 *    （十几万字符之后），把中间的模板与脚本整段删掉 —— 本文件第一版就是
 *    这么把自己断言的那句「单集评价：已评 …」删没的，断言直接假红。
 *
 * 所以分三档、都**不跨行**（跨行只认「整行就是块注释」那种）：
 *    ⑴ 单独成行的块注释（含多行）/ ⑵ 行内单行块注释 / ⑶ 整行行注释。
 */
const stripComments = (s: string) =>
    s
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');

const PAGE = stripComments(read('src/views/EpisodePageView.ts'));
const FORM = stripComments(read('src/views/components/EntryForm.svelte'));
const CSS = read('styles.css');

/** 取某个方法的方法体（按大括号深度配对；找不到返回空串，让断言直接红） */
function methodBody(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) return '';
    const open = src.indexOf('{', at);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(open + 1, i);
        }
    }
    return '';
}

const SYNC = methodBody(PAGE, 'private syncReviewPanel(): void {');
const REVIEW_INDEX = methodBody(PAGE, 'private reviewIndex(): number {');
const COMMIT = methodBody(PAGE, 'private commitReview(');

describe('🔴 用户 m01474 ①：不许再出现「第 0 集」', () => {
    it('reviewIndex 存在且是两级回退（activeCellIndex → pageCtx.currentIndex）', () => {
        // 一级：换集/翻页/高亮的唯一口径；二级：宿主按 `progress.episode - 1` 算的快照。
        // ⛔ 不能只有一级 —— 纯网络条目的 `items` 是空的，一级恒为 -1。
        expect(REVIEW_INDEX).toContain('this.activeCellIndex()');
        expect(REVIEW_INDEX).toContain('this.pageCtx?.currentIndex');
        expect(REVIEW_INDEX).toContain('return -1;');
    });

    it('🔴 评价支路⛔ 不许直接用 activeCellIndex（那正是 -1 的来源）', () => {
        // `syncReviewPanel` 与 `commitReview` 的调用点都必须走 `reviewIndex()`。
        expect(SYNC).toContain('this.reviewIndex()');
        expect(SYNC).not.toContain('this.activeCellIndex()');
    });

    it('标题只留面板名：不带集号、不带已评数', () => {
        // 用户逐字：「单集面板不要出现什么第0集等已评数」
        expect(SYNC).toContain('setText(REVIEW_PANEL_TITLE)');
        // 反向守卫：任何「第 ${...} 集」的拼接都会把 -1 渲染成「第 0 集」。
        expect(SYNC).not.toMatch(/第\s*\$\{/);
        expect(SYNC).not.toContain('已评');
    });

    it('① 的反面证据：`第 ${idx + 1} 集` 这种写法全文不该再出现在本方法', () => {
        expect(SYNC).not.toMatch(/idx\s*\+\s*1/);
    });
});

describe('🔴 用户 m01474 ②：定位不到就真禁用，⛔ 不许哑巴失活', () => {
    it('syncReviewPanel 有 locked 判据', () => {
        expect(SYNC).toMatch(/const\s+locked\s*=\s*idx\s*<\s*0;/);
    });

    it('🔴 四处可交互元素（状态/标签/心情/短评）在 locked 时都置 disabled', () => {
        // 少一处就是「某一排点了没反应」，用户只会觉得整块面板坏了。
        const disabledCount = (SYNC.match(/if \(locked\) \w+\.disabled = true;/g) || []).length;
        expect(disabledCount).toBe(4);
        // 短评框单独再钉一次（它是 textarea，不是 chip）
        expect(SYNC).toMatch(/if \(locked\) ta\.disabled = true;/);
    });

    it('locked 时必须给一行说明（不能只把控件灰掉就完事）', () => {
        expect(SYNC).toContain("cls: 'rl-epp-rv-warn'");
        expect(SYNC).toContain('还没定位到当前集');
        // 说明行必须在 `if (locked)` 里，否则永远显示。
        expect(SYNC).toMatch(/if \(locked\) \{[\s\S]*?rl-epp-rv-warn/);
    });

    it('commitReview 的 -1 早退仍在（它是落库前的最后一道闸，⛔ 不能删）', () => {
        expect(COMMIT).toContain('idx < 0');
    });
});

describe('🔴 用户 m01474 ③：已评 N 迁到整季表单', () => {
    it('表单侧有 reviewedEpisodeCount()，且只读 entry 快照', () => {
        expect(FORM).toContain('function reviewedEpisodeCount(): number {');
        expect(FORM).toContain('reviewedCount(entry?.episodeReviews)');
        expect(FORM).toContain("import { reviewedCount } from 'pure/episodeReview';");
    });

    it('🔴 已评数只在表单里出现，且带动「逐集修改去哪」的指路', () => {
        expect(FORM).toContain('单集评价：已评 {reviewedEpisodeCount()} 集');
        expect(FORM).toContain('播放器详情页');
        // ⛔ 表单不提交这个字段：进了提交对象就会用旧快照覆盖播放器那边的改动。
        expect(FORM).not.toContain('input.episodeReviews');
    });

    it('视图侧⛔ 不许再 import reviewedCount（那个数归表单管）', () => {
        const importBlock = PAGE.slice(PAGE.indexOf("from 'pure/episodeReview'") - 400, PAGE.indexOf("from 'pure/episodeReview'"));
        expect(importBlock).not.toContain('reviewedCount');
    });
});

describe('🔴 用户 m01474：chip 视觉统一（「太丑，改成现代化统一」）', () => {
    it('chip 是同一套胶囊：透明底 + 细描边，只有选中才上色', () => {
        expect(CSS).toMatch(/\.rl-epp-rv-chip \{[^}]*background: transparent;/);
        expect(CSS).toMatch(/\.rl-epp-rv-chip \{[^}]*border-radius: 999px;/);
        expect(CSS).toMatch(/\.rl-epp-rv-chip\.is-on \{[^}]*background: color-mix/);
    });

    it('三档标签各有选中色（高光=绿 / 槽点=橙），平庸走默认 accent', () => {
        expect(CSS).toMatch(/\.rl-epp-rv-chip\.is-highlight\.is-on \{[^}]*--color-green/);
        expect(CSS).toMatch(/\.rl-epp-rv-chip\.is-flaw\.is-on \{[^}]*--color-orange/);
        // 平庸**不该**有专属色 —— 「中规中矩」比另外两档抢眼是反的。
        expect(CSS).not.toContain('.rl-epp-rv-chip.is-plain.is-on');
    });

    it('禁用态有样式（灰化 + not-allowed），否则 disabled 只是「点了没反应」', () => {
        expect(CSS).toMatch(/\.rl-epp-rv-chip:disabled[\s\S]{0,200}cursor: not-allowed/);
        expect(CSS).toContain('.rl-epp-rv-note:disabled');
    });

    it('新增的 .rl-epp-rv-warn 有样式', () => {
        expect(CSS).toMatch(/\.rl-epp-rv-warn \{/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 用户 m01782 逐字：「②要把将『单集评价』做成一个悬浮快捷条，放在播放器正下方，
//    标签状态选择胶囊UI重做，还有标签不能三个都选中」
//
// 这一轮把评价从**右栏折叠节**搬到**播放器正下方的独立一行**，并改了两处语义：
//   ⑴ 标签从多选改**互斥单选**（用户明确否掉「三个都选中」）；
//   ⑵ 四组控件压成一行（面板时代是一组一行，放到舞台上会把人挤走）。
// ⚠️ 与上面那组一样走源码文本守卫：这些是 `EpisodePageView` 的私有方法，
//    构造真视图要完整 Obsidian App + leaf，单测起不来。
// ─────────────────────────────────────────────────────────────────────────────
const MOUNT = methodBody(PAGE, 'private mountReviewBar(isMovie: boolean): void {');

describe('🔴 用户 m01782 ⑷：评价条搬到播放器正下方（⛔ 不在右栏折叠节）', () => {
    it('播放器骨架里在舞台之后建 .rl-epp-rvbar，且挂在 mainEl 这一列', () => {
        // 与舞台同属 `.rl-epp-main` ⇒ width 自动等于播放器宽，⛔ 不用 JS 量宽。
        expect(PAGE).toContain("this.reviewBarEl = this.mainEl.createDiv({ cls: 'rl-epp-rvbar' });");
        const iStage = PAGE.indexOf("cls: 'rl-epp-stage'");
        const iBar = PAGE.indexOf("cls: 'rl-epp-rvbar'");
        expect(iStage).toBeGreaterThan(0);
        expect(iBar).toBeGreaterThan(iStage);
    });

    it('🔴 右栏里⛔ 不许再建评价折叠节（那是被否掉的旧位置）', () => {
        // 旧写法：`const rvSec = isMovie ? null : this.buildSection(pair, REVIEW_PANEL_TITLE, true);`
        expect(PAGE).not.toContain('this.buildSection(pair, REVIEW_PANEL_TITLE');
        // `buildSide()` 只负责决定要不要有这条，本体由 mountReviewBar 建。
        expect(PAGE).toContain('this.mountReviewBar(isMovie);');
    });

    it('mountReviewBar：电影整条隐藏，非电影建标题 + body 并立刻画一次', () => {
        expect(MOUNT).toContain('const bar = this.reviewBarEl;');
        expect(MOUNT).toContain('if (!bar) return;');
        expect(MOUNT).toContain("bar.toggleClass('is-empty', true);");
        expect(MOUNT).toContain("bar.toggleClass('is-empty', false);");
        expect(MOUNT).toContain("cls: 'rl-epp-rvbar-title'");
        expect(MOUNT).toContain("this.reviewBoxEl = bar.createDiv({ cls: 'rl-epp-rvbar-body' });");
        expect(MOUNT).toContain('this.syncReviewPanel();');
        // 电影页必须在 return 之前把 reviewVisible 关掉，否则 syncReviewPanel 会往 null body 里画。
        expect(MOUNT).toMatch(/if \(isMovie\) \{[\s\S]*?this\.reviewVisible = false;[\s\S]*?return;/);
    });

    it('标题引用指向自建节点，⛔ 不再从 .rl-epp-sectitle 抓', () => {
        // 旧写法 `rvSec.head.querySelector('.rl-epp-sectitle')` 已随折叠节一起删掉。
        expect(MOUNT).not.toContain(".rl-epp-sectitle");
        expect(MOUNT).toContain('this.reviewTitleEl = head.createEl(');
    });
});

describe('🔴 用户 m01782 ⑹：标签互斥单选（⛔ 不能三个都选中）', () => {
    it('选中即替换：draft.tags = [t]，不是把旧标签拼进去', () => {
        // 旧写法（被否）：`const next = on ? tags.filter((x) => x !== t) : [...tags, t];`
        expect(SYNC).not.toContain('[...tags, t]');
        expect(MOUNT + SYNC).toContain('draft.tags = [t];');
    });

    it('再点已选那档 = 取消（标签可以没有，⛔ 不是必填）', () => {
        expect(SYNC).toMatch(/if \(on\) delete draft\.tags;/);
    });

    it('三档标签仍然是「高光 / 平庸 / 槽点」全都在（互斥≠删档）', () => {
        expect(SYNC).toContain('for (const t of EPISODE_TAGS)');
        expect(SYNC).toContain('EPISODE_TAG_LABELS[t]');
    });
});

describe('🔴 用户 m01782 ⑸：胶囊 UI 重做（四组压成一行）', () => {
    it('syncReviewPanel 用一行容器 + 分组，⛔ 不再一组占一整行', () => {
        expect(SYNC).toContain("cls: 'rl-epp-rvbar-inner'");
        expect(SYNC).toContain("cls: 'rl-epp-rv-group'");
        // 旧的行式容器已废（CSS 里也一并删了，见下一条）。
        expect(SYNC).not.toContain("'rl-epp-rv-row'");
    });

    it('旧类名 .rl-epp-rv-row 在样式表里也不该残留（否则是两套版式并存）', () => {
        expect(CSS).not.toContain('.rl-epp-rv-row');
    });

    it('快捷条有一行版式的样式：同宽、悬浮底、行内横排、电影隐藏', () => {
        expect(CSS).toMatch(/\.rl-epp-rvbar \{[^}]*width: 100%;/);
        // ⚠️ 必须是 primary：外层 `.rl-epp-main` 自己就是 secondary 底，
        //    同色会融合成一块，看不出「悬浮」。
        expect(CSS).toMatch(/\.rl-epp-rvbar \{[^}]*background: var\(--background-primary\);/);
        expect(CSS).toMatch(/\.rl-epp-rvbar\.is-empty \{[^}]*display: none;/);
        expect(CSS).toMatch(/\.rl-epp-rvbar-inner \{[^}]*display: flex;/);
        expect(CSS).toMatch(/\.rl-epp-rv-group\.is-note \{[^}]*flex:/);
    });
});
