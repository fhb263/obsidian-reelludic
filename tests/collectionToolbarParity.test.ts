// 合集视图工具栏与默认视图（主视图）口径统一（用户 m07854 ⑥）。
//
// 🔴 用户逐字：「合集视图的搜索栏和默认视图的筛选工具栏 UI 不统一 ⇒ 统一
//    （状态下拉项统一为「全部」而不是「全部状态」；排序下拉不要倒三角标）」
//
// ⚠️ 为什么是源码文本守卫而不是渲染测试：
//    两视图各自是一份 `.svelte` 单文件组件，`statusOptions` 是组件内的 `$:` 响应式赋值，
//    排序那枚 `MiniSelect` 的 `chevron` 是模板属性 —— 这些**都在编译期就被 svelte 收走**，
//    单测里拿不到实例。而一旦有人把「全部」改回「全部状态」、或把 `chevron={false}` 删掉，
//    tsc 与 svelte-check **一句话都不会说**（都是合法字符串 / 合法布尔缺省）。
//    ⇒ 只有锁住这两处文本口径，才能防回归。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：先 strip 注释再匹配。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const collection = stripComments(read('src/views/components/CollectionBoard.svelte'));
const mediaList = stripComments(read('src/views/components/MediaList.svelte'));

/** 从 `needle` 开始截一段（够覆盖一个选项表 / 一个组件标签）。 */
function sliceFrom(src: string, needle: string, len = 600): string {
    const at = src.indexOf(needle);
    return at < 0 ? '' : src.slice(at, at + len);
}

describe('#760 合集视图状态项文案与主视图统一为「全部」（用户 m07854 ⑥）', () => {
    it('🔴 合集视图 statusOptions 首项是「全部」', () => {
        const body = sliceFrom(collection, '$: statusOptions =', 400);
        expect(body).not.toBe('');
        expect(body).toContain("{ value: 'all', label: '全部' }");
    });

    it('🔴 反向守卫：`全部状态` 不许再出现（⛔ 别改回去）', () => {
        expect(collection).not.toContain('全部状态');
    });

    it('🔴 主视图同口径写的是「全部」（两处必须同一枚叫法）', () => {
        const body = sliceFrom(mediaList, '$: statusOptions =', 400);
        expect(body).not.toBe('');
        expect(body).toContain("s === 'all' ? '全部' :");
        // 两视图对同一枚下拉的首项都必须叫「全部」
        expect(collection).toContain("{ value: 'all', label: '全部' }");
    });
});

describe('#760 两视图的排序下拉都不画倒三角（用户 m07854 ⑥）', () => {
    it('🔴 合集视图排序 MiniSelect 传了 chevron={false}', () => {
        const body = sliceFrom(collection, 'ariaLabel="排序方式"', 260);
        expect(body).not.toBe('');
        expect(body).toMatch(/chevron=\{false\}/);
    });

    it('🔴 主视图排序 MiniSelect 也传了 chevron={false}（#572 同一条口径）', () => {
        const body = sliceFrom(mediaList, 'ariaLabel="排序方式"', 260);
        expect(body).not.toBe('');
        expect(body).toMatch(/chevron=\{false\}/);
    });

    it('🔴 状态下拉**必须保留**箭头（值里没有方向字符，删了就不知道能展开）', () => {
        const colStatus = sliceFrom(collection, 'ariaLabel="状态筛选"', 260);
        const mlStatus = sliceFrom(mediaList, 'ariaLabel="状态筛选"', 260);
        expect(colStatus).not.toBe('');
        expect(mlStatus).not.toBe('');
        expect(colStatus).not.toMatch(/chevron=\{false\}/);
        expect(mlStatus).not.toMatch(/chevron=\{false\}/);
    });
});

describe('#760 两视图工具栏盒模型逐字对齐（⛔ 改一处就要改另一处）', () => {
    it('🔴 搜索框外框三档宽度逐字相同', () => {
        // 🔴 m07854 ⑪ ②（2026-11-13）改口径：原来 `flex: none` + `min-width: 240px`
        //    在窄窗口下完全不让位，把工具栏挤出横向滚动条。现在是「可收缩 280px，下限 160px」。
        //    ⚠️ 本守卫的职责没变 —— 仍是钉「两视图逐字一致」，⛔ 不是钉具体数值。
        const needle = 'flex: 0 1 280px; width: 280px; max-width: 320px; min-width: 160px;';
        expect(collection).toContain(needle);
        expect(mediaList).toContain(needle);
    });

    it('🔴 搜索输入框内距与圆角逐字相同', () => {
        // 🔴 m07854 ⑭ 改口径：右侧内距从 10px 放宽到 **30px**，给「今天看什么」骰子留位
        //    （骰子绝对定位在右端 4px 处、宽 22px ⇒ 需要 26px 以上才不压字）。
        //    ⚠️ 本守卫职责没变 —— 仍钉「两视图逐字一致」，⛔ 不是钉具体数值。
        const needle = 'padding: 5px 30px 5px 27px;';
        expect(collection).toContain(needle);
        expect(mediaList).toContain(needle);
        expect(collection).toContain('border-radius: var(--rl-t-radius-md, 6px);');
        expect(mediaList).toContain('border-radius: var(--rl-t-radius-md, 6px);');
    });

    it('🔴 m07854 ⑭ 两视图搜索框**都有**骰子按钮（⛔ 只给一边加会让切视图时右端多/少一枚）', () => {
        for (const src of [collection, mediaList]) {
            expect(src).toMatch(/class="rl-search-dice"/);
            expect(src).toMatch(/onOpenWhatToWatch && shouldShowWatchDice\(searchText\)/);
            expect(src).toMatch(/data-tip="今天看什么？（从「想看」且评分 ≥ 4 的条目里随机抽一部）"/);
        }
        // 样式也必须两边都在、且都写两级选择器（单类压不过宿主 button 的 (0,1,1) 灰底）
        for (const src of [collection, mediaList]) {
            expect(src).toContain('.rl-toolbar .rl-search-dice {');
            expect(src).toMatch(/\.rl-toolbar \.rl-search-dice:hover/);
        }
    });

    it('🔴 筛选栏与工具栏的横排间距口径相同', () => {
        expect(collection).toContain('.rl-viewbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap;');
        expect(mediaList).toContain('.rl-viewbar {');
        expect(mediaList).toContain('gap: 6px; flex-wrap: wrap;');
    });
});
