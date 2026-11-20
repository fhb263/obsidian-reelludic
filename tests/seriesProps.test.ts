// 系列卡「编辑系列属性」窗口（m07813② / m08506）—— 源码守卫
//
// 用户 2026-11-15 第一轮逐字：「给系列卡也做一个编辑属性窗口（同时右键菜单的改系列名、批量填合集、
//   批量填标签收进编辑系列属性页面内。同单击单卡卡片网格信息栏逻辑一样，单击系列卡信息栏也打开
//   编辑属性窗口）」
//
// 🔴 用户 2026-11-15 第二轮逐字（**推翻第一轮的「右键保留」口径**）：「还是将改系列名、排序号、
//   批量填合集、批量填标签放进编辑系列属性页面窗口里较好，删除右键菜单和其单独改的入口和页面」
//   ⇒ 那四条**只在这个窗口里**；`openSeriesRenamePrompt` / `openGroupCollectionPrompt` /
//     `openGroupTagsPrompt` 三个 Prompt 与 `SeriesReorderModal` 已整体删除（排序就地做）。
//
// 同轮 ask_user_question 两条裁定（用户已选）：
//   · 批量关联（逐条清单，不是批量写）→ 「右键菜单保留」
//   · 悬停那颗 ⋯ → 「保留条目菜单」（它打开的就是同一张右键菜单）
//
// 🔴🔴 2026-11-16 用户第三次裁定（逐字）：「系列卡右键条目菜单应该保持有【编辑属性、批量关联】两项，
//   且编辑属性 UI 应该和单卡编辑属性 UI 风格一致，还有系列的评分不能实时即点即变化」
//   ⇒ ⑴ 右键菜单从「只剩一条」回到**两项**（编辑属性 + 批量关联）；
//     ⑵ 那四条批量写操作**仍在窗口里**，⛔ 一条都不许单独回菜单；
//     ⑶ 评分必须点完立刻变色（根因曾在本文件对应的壳里：`doRate` 只写私有字段、从不 `$set` 回组件）。
//
// 🔴 本文件守的是**口径**，不是实现细节：
//   · 组件绝不自己碰 catalog / service（只回传「用户想改成什么」，落库全在宿主 Modal 里）
//   · 那四个独立入口**不许回潮**（删了再接线回来 = 用户明确否掉的形态）
//   · 排序就地做：拖拽状态在组件、编号在纯模块、落库走 `bulkSetSeriesIndex`
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** 剥掉 /* … *\/ 块注释与 `//` 行注释（⛔ 本仓多次踩到「注释里逐字写实现形态污染断言」）。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const COMP = stripComments(read('src/views/components/SeriesProps.svelte'));
const MODAL = stripComments(read('src/modals/SeriesPropsModal.ts'));
const LIST = stripComments(read('src/views/components/MediaList.svelte'));
const HOME_SVELTE = stripComments(read('src/views/components/HomeView.svelte'));
const HOME_TS = stripComments(read('src/views/HomeView.ts'));
const MAIN = stripComments(read('main.ts'));

describe('SeriesProps 组件（窗口本体）', () => {
    it('窗口各段都在：系列名 / 合集评分 / 归属合集 / 追加标签 / 成员清单 + 排序', () => {
        expect(COMP).toMatch(/id="rl-sp-name"/);
        expect(COMP).toMatch(/class="rl-sp-stars"/);
        expect(COMP).toMatch(/id="rl-sp-coll"/);
        expect(COMP).toMatch(/id="rl-sp-tags"/);
        expect(COMP).toMatch(/class="rl-sp-list"/);
        // 🔴 m08506 起「排序号」不再跳弹窗，而是在这一屏里拖 + 存
        expect(COMP).toMatch(/保存排序/);
    });

    it('🔴 组件**不落库**：⛔ 不许 import service / catalog / main，也不许出现 setSeriesRating', () => {
        expect(COMP).not.toMatch(/from 'services\//);
        expect(COMP).not.toMatch(/from 'data\//);
        expect(COMP).not.toMatch(/setSeriesRating/);
        expect(COMP).not.toMatch(/\bcatalog\./);
    });

    it('🔴 成员行是可拖排序行，但⛔ 不许长出输入控件（用户要的是「拖动 / ↑↓」，不是就地编辑标题）', () => {
        const a = COMP.indexOf('class="rl-sp-list"');
        expect(a).toBeGreaterThan(0);
        const end = COMP.indexOf('</div>', COMP.indexOf('{#each rows', a));
        expect(end).toBeGreaterThan(a);
        const seg = COMP.slice(a, end);
        expect(seg).toContain('{#each rows');
        expect(seg).not.toMatch(/<input/);
        expect(seg).not.toMatch(/<textarea/);
        expect(seg).not.toMatch(/contenteditable/);
    });

    it('🔴 拖动 + 键盘 + 保存三件套（拖拽是纯指针操作，读屏用户否则够不着）', () => {
        expect(COMP).toMatch(/draggable="true"/);
        expect(COMP).toMatch(/role="option"\s*\n\s*aria-selected="false"/);
        // 🔴 必锚**真实标记**而不是裸 `role="listbox"` —— 那个词在上面的 HTML 注释里先出现过
        //    （`⛔ 别用 role="list"` 那条说明），裸匹配会让「真属性被改掉」照样绿（本轮突变实测踩到）。
        expect(COMP).toMatch(/<div class="rl-sp-list" role="listbox" aria-label=/);
        expect(COMP).not.toMatch(/<div class="rl-sp-list" role="list"/);
        expect(COMP).toMatch(/function onDragStart\(/);
        expect(COMP).toMatch(/function onDrop\(/);
        expect(COMP).toMatch(/function onKeydown\(ev: KeyboardEvent, id: string\): void \{/);
        expect(COMP).toMatch(/ArrowUp/);
        expect(COMP).toMatch(/ArrowDown/);
        expect(COMP).toMatch(/function saveOrder\(\): void \{/);
        // 🔴 搬移算法必须在**纯模块**（组件只取下标 → 调它 → 换 order）
        expect(COMP).toMatch(/import \{ moveItem \} from 'pure\/seriesGroup';/);
        expect(COMP).toMatch(/moveItem\(order, order\.indexOf\(dragId\), order\.indexOf\(targetId\)\)/);
    });

    it('🔴 按钮必须用**两级选择器**（单类 (0,1,0) 压不过核心 button:not(.clickable-icon) 的 (0,1,1)）', () => {
        expect(COMP).toMatch(/\.rl-sp-row \.rl-sp-btn,/);
        expect(COMP).toMatch(/\.rl-sp-actions \.rl-sp-btn \{/);
        // 反向守卫：⛔ 不许出现裸 `.rl-sp-btn {` 单类规则
        expect(COMP).not.toMatch(/^\s*\.rl-sp-btn\s*\{/m);
    });

    it('六条回调都对外暴露（改名 / 评分 / 合集 / 标签 / 排序 / 批量关联）', () => {
        for (const cb of ['onRename', 'onRate', 'onSetCollection', 'onAddTags', 'onReorder', 'onAssociate']) {
            expect(COMP).toMatch(new RegExp(`export let ${cb}\\b`));
        }
        // 🔴 排序回传的是**新顺序的 id 列表**（⛔ 不是「请你打开排序弹窗」那种无参回调）
        expect(COMP).toMatch(/export let onReorder: \(ids: string\[\]\) => void/);
    });
});

describe('SeriesPropsModal（壳）', () => {
    it('🔴 四条批量操作**在窗口里自己落库**（那四个独立入口已删，⛔ 不许回潮）', () => {
        expect(MODAL).toMatch(/private async doRename\(/);
        expect(MODAL).toMatch(/private async doSetCollection\(/);
        expect(MODAL).toMatch(/private async doAddTags\(/);
        expect(MODAL).toMatch(/private async doReorder\(/);
        expect(MODAL).toMatch(/setSeriesRating\(/);
        // 落库原语：改名走 service.update、排序走 bulkSetSeriesIndex、合集/标签走两个 bulk
        expect(MODAL).toMatch(/this\.plugin\.service\.update\(id, \{ series: trimmed \}\)/);
        expect(MODAL).toMatch(/planSeriesReindexAll\(orderedIds\)/);
        expect(MODAL).toMatch(/this\.plugin\.bulkSetSeriesIndex\(pairs\)/);
        expect(MODAL).toMatch(/this\.plugin\.bulkSetCollection\(ids, next\)/);
        expect(MODAL).toMatch(/this\.plugin\.bulkAddTags\(ids, tags\)/);
        // 🔴 反向守卫：四个独立入口一个都不许接回来
        expect(MODAL).not.toMatch(/openSeriesRenamePrompt|openGroupCollectionPrompt|openGroupTagsPrompt|openSeriesReorder/);
    });

    it('🔴 合集是**覆盖**语义 ⇒ 必须带确认；标签是**追加** ⇒ 不弹确认（两者口径相反，⛔ 别写成一 套）', () => {
        expect(MODAL).toMatch(/ConfirmModal/);
        expect(MODAL).toMatch(/原有值会被覆盖/);
        // 标签那条不带 ConfirmModal：取 doAddTags 那一段，确认它里面没有 ConfirmModal
        const a = MODAL.indexOf('private async doAddTags(');
        expect(a).toBeGreaterThan(0);
        const end = MODAL.indexOf('private async doReorder(', a);
        expect(end).toBeGreaterThan(a);
        expect(MODAL.slice(a, end)).not.toMatch(/ConfirmModal/);
    });

    it('🔴 排序编号在纯模块算（只编号不排序）：`planSeriesReindexAll` + 回执 Notice', () => {
        expect(MODAL).toMatch(/import \{[^}]*planSeriesReindexAll[^}]*\} from 'pure\/seriesGroup';/);
        expect(MODAL).toMatch(/new Notice\(`已按顺序重排/);
    });

    it('读分期间用户关窗 ⇒ ⛔ 不许再挂载（防悬挂写入）', () => {
        expect(MODAL).toMatch(/if \(!this\.contentEl\.isConnected\) return;/);
    });

    it('🔴🔴 打分必须**回推已挂载的组件**（否则点星纹丝不动 —— 2026-11-16 用户报障）', () => {
        const a = MODAL.indexOf('private async doRate(');
        expect(a).toBeGreaterThan(0);
        const end = MODAL.indexOf('private async doSetCollection(', a);
        expect(end).toBeGreaterThan(a);
        const seg = MODAL.slice(a, end);
        // 正向：必须 $set 把新分推回实例，且推在落库之前（先响应用户，再落库）
        expect(seg).toMatch(/this\.instance\?\.\$set\(\{ rating: next \}\)/);
        const setAt = seg.indexOf('$set({ rating: next })');
        const saveAt = seg.indexOf('setSeriesRating(');
        expect(setAt).toBeGreaterThan(0);
        expect(saveAt).toBeGreaterThan(setAt);
        // 反向守卫：⛔ 只写私有字段就假装完事（正是本次的 bug 形态）
        expect(seg).not.toMatch(/^\s*this\.curRating = next;\s*\n\s*await this\.plugin\.service\.setSeriesRating/m);
        // 落库失手必须把界面退回去，⛔ 别让界面显示一个没存进库的分
        expect(seg).toMatch(/this\.instance\?\.\$set\(\{ rating: prev \}\)/);
    });

    it('三件套壳约定：清空宿主标题 / 保存实例并在 onClose 销毁 / 指定宽度', () => {
        expect(MODAL).toMatch(/this\.titleEl\.setText\(''\)/);
        expect(MODAL).toMatch(/this\.instance\?\.\$destroy\(\)/);
        expect(MODAL).toMatch(/this\.instance = null/);
        expect(MODAL).toMatch(/min\(560px, 92vw\)/);
    });
});

describe('两个入口（单击信息栏 / 悬停 ⋯ 菜单）', () => {
    it('🔴 系列卡信息栏照抄单卡那套三件套（同 `cardGridView` 门控 + 键盘回车/空格 + 焦点交还）', () => {
        // 找出系列卡那一处（`{g.title}` 之前最近的 `.rl-card-meta`）。
        // 🔴 m19456 ① 起标题走 `maskCardText(gch, g.title)`（隐藏卡片时打码），不再是裸 `{g.title}`
        //    ⇒ 锚点跟着换形态。⛔ 判据意图不变：仍然定位**系列卡**那一个信息栏，三件套一条不少。
        const ttl = LIST.indexOf('<div class="rl-ttl">{maskCardText(gch, g.title)}</div>');
        expect(ttl).toBeGreaterThan(0);
        const a = LIST.lastIndexOf('class="rl-card-meta"', ttl);
        expect(a).toBeGreaterThan(0);
        const seg = LIST.slice(a - 600, ttl);
        expect(seg).toMatch(/class:rl-meta-edit=\{cardGridView\}/);
        expect(seg).toMatch(/role=\{cardGridView \? 'button' : undefined\}/);
        expect(seg).toMatch(/tabindex=\{cardGridView \? 0 : undefined\}/);
        expect(seg).toMatch(/data-tip=\{cardGridView \? '点击编辑系列属性' : undefined\}/);
        expect(seg).toMatch(/releaseCardFocus\(ev\)/);
        expect(seg).toMatch(/onOpenSeriesProps\(g\)/);
        // 键盘：Enter 与空格都要认
        expect(seg).toMatch(/ev\.key !== 'Enter' && ev\.key !== ' '/);
    });

    it('🔴 右键菜单**两项**：编辑属性 + 批量关联（2026-11-16 用户第三次裁定推翻「只剩一条」）', () => {
        const a = LIST.indexOf('{#if ctxGroupKey}');
        const end = LIST.indexOf('{/if}', a);
        expect(a).toBeGreaterThan(0);
        const seg = LIST.slice(a, end);
        // 恰好两枚按钮，且顺序就是用户写的字面顺序：先「编辑属性」后「批量关联」
        expect((seg.match(/<button/g) || []).length).toBe(2);
        expect(seg).toContain('>编辑属性<');
        expect(seg).toContain('>批量关联<');
        expect(seg.indexOf('>编辑属性<')).toBeLessThan(seg.indexOf('>批量关联<'));
        // 「编辑属性」必须打开**系列**窗口那一族（onOpenSeriesProps），与单击信息栏同一落点
        expect(seg).toMatch(/onOpenSeriesProps\(ctxGroup\)/);
        expect(seg).toMatch(/onOpenSeriesAssociate\(ctxGroup\)/);
        // 🔴 反向守卫：那四条**批量写操作**⛔ 一条都不许单独回到菜单（它们只在窗口里）
        for (const gone of ['改系列名', '排序号', '批量填合集', '批量填标签']) {
            expect(seg).not.toContain(`>${gone}<`);
        }
        expect(seg).not.toMatch(/onRenameSeries|onOpenSeriesReorder|onSetGroupCollection|onAddGroupTags/);
    });

    it('🔴 悬停 ⋯ 复用同一个菜单 ⇒ ⛔ 别在浮层里加第二枚按钮', () => {
        // 整篇有三处 `.rl-cov-hover`（分组头一处、普通卡一处、系列卡一处），三处共用的 `openGroupCtx`
        // 还在卡片根节点的 `on:contextmenu` 上出现过 ⇒ **位置锚点一律不可靠**。
        // 正解：逐个遍历浮层，挑出「内部含 openGroupCtx 的那一处」。
        // ⚠️ 每处浮层切片掐到它自己的收尾 `</div>`（按钮不另开 div ⇒ 第一个 `</div>` 就是浮层边界）；
        //    后面紧跟的 `rl-series-play` 是浮层**外**的右下角按钮，算进来会误判成「浮层里多了一枚」。
        const overlays: string[] = [];
        let from = 0;
        for (;;) {
            const a = LIST.indexOf('<div class="rl-cov-hover">', from);
            if (a < 0) break;
            const end = LIST.indexOf('</div>', a);
            overlays.push(LIST.slice(a, end));
            from = a + 1;
        }
        expect(overlays.length).toBe(3);
        const seriesOverlay = overlays.find((s) => s.includes('openGroupCtx(g, ev)'));
        expect(seriesOverlay, '没找到含 openGroupCtx 的浮层').toBeTruthy();
        const seg = seriesOverlay as string;
        expect((seg.match(/<button/g) || []).length).toBe(2);
        // 反向守卫：⛔ 别为「悬停入口」在浮层里再加一枚（它复用的就是右键那个菜单）
        expect(seg).not.toMatch(/onOpenSeriesProps/);
    });
});

describe('接线链路（HomeView → MediaList → 宿主）', () => {
    it('prop 一路透传：HomeView.svelte 声明 + 传给 MediaList', () => {
        expect(HOME_SVELTE).toMatch(/export let onOpenSeriesProps:/);
        expect(HOME_SVELTE).toMatch(/\{onOpenSeriesProps\}/);
    });

    it('MediaList 声明了新 prop 且给了空函数默认值（⛔ 别写成必填）', () => {
        expect(LIST).toMatch(/export let onOpenSeriesProps: \(g: SeriesGroup\) => void = \(\) => \{\};/);
    });

    it('宿主链：HomeView.ts → plugin.openSeriesProps → new SeriesPropsModal', () => {
        expect(HOME_TS).toMatch(/onOpenSeriesProps: \(g: SeriesGroup\) => this\.plugin\.openSeriesProps\(g\)/);
        expect(MAIN).toMatch(/openSeriesProps\(group: SeriesGroup\): void \{/);
        expect(MAIN).toMatch(/new SeriesPropsModal\(this\.app, this, group\)\.open\(\)/);
        expect(MAIN).toMatch(/import \{ SeriesPropsModal \} from 'modals\/SeriesPropsModal';/);
    });

    it('🔴 四个旧入口在**整条链路上**都 0 处（宿主方法 / 接线 / 组件 prop 一起退场）', () => {
        for (const gone of [
            'openSeriesRenamePrompt',
            'openGroupCollectionPrompt',
            'openGroupTagsPrompt',
            'openSeriesReorder',
            'onRenameSeries',
            'onOpenSeriesReorder',
            'onSetGroupCollection',
            'onAddGroupTags',
        ]) {
            expect(MAIN).not.toContain(gone);
            expect(HOME_TS).not.toContain(gone);
            expect(HOME_SVELTE).not.toContain(gone);
            expect(LIST).not.toContain(gone);
        }
        // ⛔ 那两个文件已整体删除（排序就地做在窗口里）
        expect(() => read('src/modals/SeriesReorderModal.ts')).toThrow();
        expect(() => read('src/views/components/SeriesReorder.svelte')).toThrow();
    });
});
