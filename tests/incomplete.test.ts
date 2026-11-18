// 「待补」漏斗的守卫（用户 m07854 ⑮）。
//
// 🔴 为什么是源码级守卫 + 纯函数单测两层：
//    判据能单测（`isIncomplete` / `incompleteReasonsOf` / `countIncomplete` / `incompleteTip`），
//    但「两个视图都真挂了那枚按钮、且用两级选择器压过宿主灰底、且带 aria-pressed」
//    这些是 Svelte 模板与 scoped 样式里的事实 —— tsc 与 svelte-check **都不会报**。
//
// ⚠️ strip 用**单次交替**正则，且必须连 Svelte 的 HTML 注释一起剥：
//    本仓反复栽过的坑（#379 / #730 / #731 / ⑪ / ⑫ / ⑬ / ⑭），凡反向断言直接匹配原文，
//    只要注释里提了那个词就必然假红。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EntryType, MediaEntry } from 'data/types';
import { countIncomplete, incompleteReasonsOf, incompleteTip, isIncomplete } from 'pure/incomplete';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释：Svelte HTML 注释 / 块注释 / 行注释，**一次交替扫描**（分两步会互相吞） */
const strip = (src: string): string => src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

/**
 * 取某个标记所在**元素自身的开标签**（从标记起、到最近的 `>` 为止）。
 * ⚠️ 为什么不截固定长度窗口：相邻元素（如紧挨着的「＋ 添加 mod-cta」）会被一起圈进来，
 *    导致「这颗按钮没带 mod-cta」这种断言假红。只认开标签才真的只在说这一颗。
 */
function openTagOf(src: string, marker: string): string {
    const at = src.indexOf(marker);
    if (at < 0) return '';
    const end = src.indexOf('>', at);
    return end < 0 ? src.slice(at) : src.slice(at, end + 1);
}

/**
 * 漏斗是否真的住在「搜索框容器 → 工具槽」这两层之内（m12298 ① 用户原话：「放在首页搜索框内」）。
 *
 * 🔴 为什么不用「固定窗口切片」：早先用 400 字符窗口圈相邻元素翻过车（见 {@link openTagOf} 的注释）。
 *    这里靠**三处闭合位置**判定，全部是 `indexOf` 的位置比较，不猜长度：
 *      · `.rl-search-wrap` 的收尾 `</div>` 必须在漏斗**之后** ⇒ 漏斗没被关在外面；
 *      · 工具槽 `<span class="rl-search-tools">` 的收尾 `</span>` 也必须在漏斗之后 ⇒ 在槽内；
 *      · 槽起点在 wrap 之后、且在漏斗之前 ⇒ 槽本身在 wrap 内。
 */
function funnelInsideSearchTools(src: string): boolean {
    const wrapAt = src.indexOf('class="rl-search-wrap"');
    const slotAt = src.indexOf('class="rl-search-tools"');
    const funnelAt = src.indexOf('class="rl-incomplete"');
    if (wrapAt < 0 || slotAt < 0 || funnelAt < 0) return false;
    if (!(wrapAt < slotAt && slotAt < funnelAt)) return false;
    // wrap 的收尾 </div> 必须在漏斗之后（否则漏斗在 wrap 外面）
    const wrapCloseAt = src.indexOf('</div>', wrapAt);
    if (wrapCloseAt >= 0 && wrapCloseAt < funnelAt) return false;
    // 槽的收尾 </span> 必须在漏斗之后（否则漏斗在槽外面）
    const slotCloseAt = src.indexOf('</span>', slotAt);
    if (slotCloseAt >= 0 && slotCloseAt < funnelAt) return false;
    return true;
}

/** 造条目：只填判据关心的字段，其余留缺省 */
function mk(over: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e1',
        type: 'movie' as EntryType,
        title: '某片',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...over,
    } as MediaEntry;
}

describe('#768 ⑮ 待补判据：缺关联 ∪ 缺个人评分', () => {
    it('两条都缺 ⇒ 待补', () => {
        expect(isIncomplete(mk({ episodeFiles: [], episodeUrls: [] }))).toBe(true);
    });

    it('有本地集但没打分 ⇒ 仍待补（缺评分那一条就够了）', () => {
        expect(isIncomplete(mk({ episodeFiles: ['a.mp4'], rating: 0 }))).toBe(true);
    });

    it('打了分但完全没关联 ⇒ 仍待补（缺关联那一条就够了）', () => {
        expect(isIncomplete(mk({ rating: 5, episodeFiles: [], episodeUrls: [] }))).toBe(true);
    });

    it('既关联了又打了分 ⇒ 不算待补', () => {
        expect(isIncomplete(mk({ rating: 4.5, episodeFiles: ['a.mp4'] }))).toBe(false);
    });

    it('🔴 关联判据复用 assocFlagsOf：老字段 links 也算关联（与 hasActionEntry 同口径）', () => {
        // 只有 links、没有逐集数组 —— 老条目的观看链接可能还留在这儿。
        // ⚠️ `links` 是 `WatchLink[]`（`{ label, url }`），⛔ 不是字符串数组（写 string 会 TS2322）。
        expect(isIncomplete(mk({ links: [{ label: 'B 站', url: 'https://x' }], rating: 5 }))).toBe(false);
    });

    it('🔴 「trim 后非空」才算关联：纯空格不算', () => {
        expect(isIncomplete(mk({ episodeFiles: ['   '], rating: 5 }))).toBe(true);
    });

    it('书籍走 bookFile/readUrl，不看 episodeFiles', () => {
        const book = mk({ type: 'book' as EntryType, rating: 5, bookFile: '/a.epub' });
        expect(isIncomplete(book)).toBe(false);
        const bookNoFile = mk({ type: 'book' as EntryType, rating: 5 });
        expect(isIncomplete(bookNoFile)).toBe(true);
    });

    it('游戏看快捷方式 / 网络路径', () => {
        const g = mk({ type: 'game' as EntryType, rating: 5, gameUrl: 'steam://rungameid/1' });
        expect(isIncomplete(g)).toBe(false);
    });

    it('音乐看本地音频 / 音频地址', () => {
        const m = mk({ type: 'music' as EntryType, rating: 5, audioPath: '/a.mp3' });
        expect(isIncomplete(m)).toBe(false);
    });

    it('🔴 子项拆解与总判据自洽（noLink ∪ noRating === isIncomplete）', () => {
        const cases: MediaEntry[] = [
            mk({ episodeFiles: [], rating: 0 }),
            mk({ episodeFiles: ['a'], rating: 0 }),
            mk({ episodeFiles: [], rating: 4 }),
            mk({ episodeFiles: ['a'], rating: 4 }),
        ];
        for (const e of cases) {
            const r = incompleteReasonsOf(e);
            expect(r.noLink || r.noRating).toBe(isIncomplete(e));
        }
    });
});

describe('#768 ⑮ 计数与提示文案', () => {
    it('countIncomplete 只数待补的', () => {
        expect(
            countIncomplete([
                mk({ id: 'a', episodeFiles: [], rating: 0 }),
                mk({ id: 'b', episodeFiles: ['x'], rating: 4 }),
                mk({ id: 'c', episodeFiles: ['x'], rating: 0 }),
            ]),
        ).toBe(2);
    });

    it('空库计数为 0，不抛', () => {
        expect(countIncomplete([])).toBe(0);
    });

    it('🔴 提示语必须以 [待补] 逐字开头（用户原话要求）', () => {
        expect(incompleteTip(3, false).startsWith('[待补]')).toBe(true);
        expect(incompleteTip(0, false).startsWith('[待补]')).toBe(true);
        expect(incompleteTip(3, true).startsWith('[待补]')).toBe(true);
    });

    it('计数为 0 时要说清「没有」，不能只说「筛出 0 条」', () => {
        expect(incompleteTip(0, false)).toContain('没有');
    });

    it('未激活时说「筛出 N 条」，激活时说「正在只看这 N 条」', () => {
        expect(incompleteTip(12, false)).toContain('筛出 12 条');
        expect(incompleteTip(12, true)).toContain('正在只看这 12 条');
    });
});

describe('#768 ⑮ 接线：两个视图都挂漏斗，判据不内联', () => {
    const media = strip(read('src/views/components/MediaList.svelte'));
    const coll = strip(read('src/views/components/CollectionBoard.svelte'));
    const search = strip(read('src/pure/search.ts'));

    it('🔴 pure/incomplete 是唯一判据：两个视图都只调 isIncomplete / incompleteTip', () => {
        expect(coll).toContain('isIncomplete(e)');
        expect(coll).toContain('incompleteTip(incompleteCount, incompleteOnly)');
        // 反向：视图里不许自己拼「缺关联」的条件（那就是第二份真源）
        expect(coll).not.toMatch(/assocFlagsOf|normalizeRating/);
        expect(media).not.toMatch(/assocFlagsOf|normalizeRating/);
    });

    it('🔴 filterAndSort 的待补维度走 isIncomplete，不内联条件', () => {
        expect(search).toContain('isIncomplete(e)');
        expect(search).toContain('incompleteOnly?: boolean');
        expect(search).not.toMatch(/assocFlagsOf|normalizeRating/);
    });

    it('两个视图都有那枚按钮，且结构与主视图逐字同款', () => {
        for (const src of [media, coll]) {
            expect(src).toContain('class="rl-incomplete"');
            expect(src).toContain('aria-pressed={incompleteOnly}');
            expect(src).toContain('<Icon icon="filter" size={14} />');
            expect(src).toMatch(/on:click=\{\(\) => \(incompleteOnly = !incompleteOnly\)\}/);
        }
    });

    it('🔴 漏斗样式必须两级选择器（压过宿主 button:not(.clickable-icon) 的 (0,1,1)）', () => {
        for (const src of [media, coll]) {
            expect(src).toContain('.rl-incomplete {');
            // 反向：不许存在单类 .rl-incomplete { ... }（会被宿主灰底压掉）
            expect(src).not.toMatch(/^\s*\.rl-incomplete\s*\{/m);
            expect(src).toMatch(/\.rl-incomplete\.is-on\s*\{[^}]*color:\s*var\(--interactive-accent\)/);
        }
    });

    it('🔴 漏斗是透明无边框（用户要「小图标」，不是第二枚按钮）', () => {
        for (const src of [media, coll]) {
            // 取基础规则体：从 `.rl-incomplete {` 到它自己的收尾 `}`
            const start = src.indexOf('.rl-incomplete {');
            expect(start).toBeGreaterThan(-1);
            const rule = src.slice(start, src.indexOf('}', start));
            expect(rule).toContain('background: transparent');
            expect(rule).toContain('border: 0');
            expect(rule).toContain('box-shadow: none');
            // 🔴 m12298 ①（用户：「这个待补图标放在首页搜索框内」）：漏斗从工具栏同级
            //    **搬进**搜索框右端的工具槽 ⇒ 它不再是独立 flex 项，尺寸改成与骰子同款的
            //    22×22 方钮。旧断言 `height: var(--input-height)` 守的是「作为工具栏按钮时
            //    与『＋ 添加』同一把尺」——那条口径随搬家**整体失效**，⛔ 不是把断言放宽。
            //    新口径守两件事：① 仍是透明方钮；② 与骰子**同尺寸**（同槽并排 → 两枚必须
            //    一样高，否则一高一低）。骰子的 22×22 是 `description`（⑭）立下的尺子。
            expect(rule).toContain('width: 22px');
            expect(rule).toContain('height: 22px');
            expect(rule).not.toContain('var(--input-height)');
        }
    });

    it('🔴 ① 漏斗搬到搜索框内的**工具槽**里（与骰子同槽，⛔ 不再是工具栏独立一枚）', () => {
        for (const src of [media, coll]) {
            // 槽容器存在
            expect(src).toContain('class="rl-search-tools"');
            // 漏斗在槽内、槽在搜索框内（位置比较，⛔ 不切固定窗口）
            expect(funnelInsideSearchTools(src)).toBe(true);
        }
    });

    it('🔴 漏斗不是 CTA：不许带 mod-cta（#632 明令工具栏只有一枚主按钮）', () => {
        for (const src of [media, coll]) {
            // ⚠️ 只取该按钮**自身的开标签**（到最近的 `>` 为止）。
            //    早先用固定 400 字符窗口会连带把紧邻的「＋ 添加 mod-cta」吃进来 ⇒ 假红。
            const near = openTagOf(src, 'class="rl-incomplete"');
            expect(near).not.toBe('');
            expect(near).not.toContain('mod-cta');
        }
    });

    it('🔴 不置灰（计数为 0 也可点）：只有搜索态才让它让位', () => {
        // 🔴 m13127 ②（用户逐字）：「首页搜索框的待补按钮在输入文字搜索时要隐藏，没有文字时显示」
        //    这条**推翻了** ⑮ 立下的「始终渲染、不许条件隐藏」口径 —— 用户的理由是「输入文字搜索时
        //    搜索框右端要干净」。⛔ 不是把断言放宽：新口径守得更死，要求显隐判据必须是**纯函数**
        //    且与骰子同源（否则两枚图标会出现「一枚藏了、另一枚还占着位置」）。
        for (const src of [media, coll]) {
            const near = openTagOf(src, 'class="rl-incomplete"');
            expect(near).not.toBe('');
            // 置灰仍然禁止 —— 用户要的是「能不能点」，不是「点了没反应」
            expect(near).not.toContain('disabled');
            // 显隐判据必须包在 `{#if shouldShowWatchDice(searchText)}` 里
            const at = src.indexOf('class="rl-incomplete"');
            const before = src.slice(Math.max(0, at - 260), at);
            expect(before).toMatch(/\{#if shouldShowWatchDice\(searchText\)\}/);
            // 反向：⛔ 别另写一套判据（两枚图标同槽，判据分叉就会错位）
            expect(before).not.toMatch(/searchText\.length\s*===\s*0/);
        }
    });

    it('🔴 搜索态下输入框右内距必须收回去（否则留一块没有图标的空白）', () => {
        // 单靠 `{#if}` 藏按钮是不够的：`.rl-search` 的 `padding-right: 30px`（单枚口径）还在，
        // 长关键词能用的宽度被白吃。⇒ 两个视图都要有一条 `.tools-hidden` 的收窄规则。
        for (const src of [media, coll]) {
            expect(src).toMatch(/\.rl-search-wrap\.tools-hidden \.rl-search\s*\{[^}]*padding-right:\s*12px/);
        }
        // 模板侧：`.rl-search-wrap` 上要挂 `class:tools-hidden`
        for (const src of [media, coll]) {
            expect(src).toMatch(/class:tools-hidden=\{!shouldShowWatchDice\(searchText\)\}/);
        }
    });

    it('🔴 待补是临时视图态：不落盘、不进 Settings', () => {
        const settings = strip(read('src/Settings.ts'));
        expect(settings).not.toContain('incompleteOnly');
        // 两个视图里都该是普通 let，不是 $: 派生自 plugin.settings
        for (const src of [media, coll]) {
            expect(src).toMatch(/let incompleteOnly = false;/);
            expect(src).not.toMatch(/settings\.incompleteOnly/);
        }
    });
});
