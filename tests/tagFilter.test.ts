/**
 * m18442 ① —— 标签筛选（词云点击 → 回库列表并按标签筛）与 ② 封面「已加载」跨实例缓存。
 *
 * 判据分三层：
 *  ⑴ 纯逻辑：`pure/tagFilter` 的归一 / 过滤 / 切换、`pure/coverLoaded` 的单例语义；
 *  ⑵ 装配：词云按钮化 + `onPickTag` 出口 + HomeView 的三层筛选链与取消入口；
 *  ⑶ 反向守卫：⛔ 别退回「纯 span 不可点」、⛔ 别把标签筛选实现成新建 custom 视图、
 *     ⛔ 别把封面缓存退回组件内的实例 `Set`。
 *
 * 🔴 为什么装配层用源码判据而不是渲染：这两个改动跨 4 个文件、又都依赖宿主注入的
 *    回调，纯逻辑单测覆盖不到「prop 名写错 / 出口没接」这类静默失效（Svelte 4 对多传的
 *    prop 静默忽略，本仓栽过 #659）。源码判据是唯一能在单测里抓住它的手段。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    entryHasTag,
    filterEntriesByTag,
    normalizeTagFilter,
    splitTagText,
    tagFilterLabel,
    tagHitCount,
    toggleTagFilter,
} from 'pure/tagFilter';
import {
    coverAlreadyLoaded,
    coverLoadedSnapshot,
    rememberCoverLoaded,
    resetCoverLoadedForTest,
} from 'pure/coverLoaded';
import {
    rememberStackAnimated,
    resetStackAnimatedForTest,
    stackAnimatedSnapshot,
} from 'pure/stackAnimated';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * 剥注释（`//` 与 `/* *\/` 与 Svelte 的 `<!-- -->`）。
 * ⚠️ 反向守卫必须扫剥注释后的代码：本仓注释里大量逐字引用反面教材
 *    （「⛔ 别改回 new Set<string>()」这类），扫原文会全部假红。本仓已踩过 3 次。
 * ⚠️ `//` 的正则要避开 `https://` 那种协议头 —— 否则会把 URL 后面的代码全吃掉。
 */
function stripComments(src: string): string {
    return src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

describe('m18442 ① tagFilter · 归一', () => {
    it('折叠空白（含全角空格）、去首尾、转小写', () => {
        expect(normalizeTagFilter('  科幻\u3000 冒险  ')).toBe('科幻 冒险');
        expect(normalizeTagFilter('SciFi')).toBe('scifi');
    });

    it('🔴 只做大小写 + 空白归一：C++ 与 C# 必须仍是两个标签', () => {
        const cpp = normalizeTagFilter('C++');
        const cs = normalizeTagFilter('C#');
        expect(cpp).not.toBe(cs);
        // 也不做 NFKC：全角字母不合并到半角
        expect(normalizeTagFilter('ＡＢＣ')).not.toBe(normalizeTagFilter('abc'));
    });

    it('空值一律归一成空串', () => {
        expect(normalizeTagFilter('')).toBe('');
        expect(normalizeTagFilter('   ')).toBe('');
        expect(normalizeTagFilter(null)).toBe('');
        expect(normalizeTagFilter(undefined)).toBe('');
    });
});

describe('m18442 ① tagFilter · 切分与命中', () => {
    it('标签串按 斜杠 / 顿号 / 逗号 / 分号 切（与表单提交侧同口径）', () => {
        expect(splitTagText('科幻/冒险、日常,治愈；热血')).toEqual(['科幻', '冒险', '日常', '治愈', '热血']);
    });

    it('切分后丢弃空段与纯空白段', () => {
        expect(splitTagText('科幻 // 、 /')).toEqual(['科幻']);
        expect(splitTagText('')).toEqual([]);
    });

    it('大小写 / 空白不敏感命中', () => {
        const e = { tags: ['Sci Fi', '经典'] };
        expect(entryHasTag(e, 'sci  fi')).toBe(true);
        expect(entryHasTag(e, '经典')).toBe(true);
        expect(entryHasTag(e, '无关')).toBe(false);
    });

    it('空标签恒不命中；没有 tags 字段也不炸', () => {
        expect(entryHasTag({ tags: ['科幻'] }, '')).toBe(false);
        expect(entryHasTag({}, '科幻')).toBe(false);
        expect(entryHasTag(null, '科幻')).toBe(false);
        expect(entryHasTag({ tags: null }, '科幻')).toBe(false);
    });

    it('🔴 空标签时 filterEntriesByTag 返回**同一个数组引用**（否则下游每帧全量重渲染）', () => {
        const list = [{ tags: ['科幻'] }, { tags: ['日常'] }];
        expect(filterEntriesByTag(list, '')).toBe(list);
        expect(filterEntriesByTag(list, '   ')).toBe(list);
        expect(filterEntriesByTag(list, '科幻')).not.toBe(list);
        expect(filterEntriesByTag(list, '科幻')).toEqual([{ tags: ['科幻'] }]);
    });

    it('tagHitCount 计算命中条数（空标签 0）', () => {
        const list = [{ tags: ['科幻'] }, { tags: ['科幻', '日常'] }, { tags: [] }];
        expect(tagHitCount(list, '科幻')).toBe(2);
        expect(tagHitCount(list, '')).toBe(0);
    });
});

describe('m18442 ① tagFilter · 文案与切换', () => {
    it('提示条文案', () => {
        expect(tagFilterLabel('科幻')).toBe('标签筛选：科幻');
        expect(tagFilterLabel('')).toBe('');
        expect(tagFilterLabel('  ')).toBe('');
    });

    it('点同一标签再点一次 = 取消（大小写 / 空白不敏感）', () => {
        expect(toggleTagFilter('', '科幻')).toBe('科幻');
        expect(toggleTagFilter('科幻', '科幻')).toBe('');
        expect(toggleTagFilter('科幻', ' 科幻 ')).toBe('');
        expect(toggleTagFilter('SCIFI', 'scifi')).toBe('');
    });

    it('点另一个标签 = 换过去；空标签 = 清空', () => {
        expect(toggleTagFilter('科幻', '日常')).toBe('日常');
        expect(toggleTagFilter('科幻', '')).toBe('');
        expect(toggleTagFilter('科幻', '  ')).toBe('');
    });
});

describe('m18442 ② coverLoaded · 跨实例缓存', () => {
    it('记一笔之后，任何新实例都能查到（这就是「换页签不再重排」的全部机制）', () => {
        resetCoverLoadedForTest();
        expect(coverAlreadyLoaded('a')).toBe(false);
        rememberCoverLoaded('a');
        expect(coverAlreadyLoaded('a')).toBe(true);
        expect(coverLoadedSnapshot().has('a')).toBe(true);
    });

    it('快照是新 Set，改它不会污染模块级缓存', () => {
        resetCoverLoadedForTest();
        rememberCoverLoaded('x');
        const snap = coverLoadedSnapshot();
        snap.delete('x');
        expect(coverAlreadyLoaded('x')).toBe(true);
        expect(coverLoadedSnapshot().has('x')).toBe(true);
    });

    it('重复记同一条是幂等的', () => {
        resetCoverLoadedForTest();
        rememberCoverLoaded('dup');
        rememberCoverLoaded('dup');
        expect(coverLoadedSnapshot().size).toBe(1);
    });

    it('空 id 不入缓存', () => {
        resetCoverLoadedForTest();
        rememberCoverLoaded('');
        rememberCoverLoaded(null as never);
        expect(coverLoadedSnapshot().size).toBe(0);
        expect(coverAlreadyLoaded('')).toBe(false);
    });
});

describe('m18442 ① 装配 · 词云可点 + 出口接到 HomeView', () => {
    const stats = read('src/views/components/StatsBoard.svelte');
    const statsCode = stripComments(stats);
    const home = read('src/views/components/HomeView.svelte');
    const homeCode = stripComments(home);

    it('StatsBoard 暴露 onPickTag（回调型 prop，不是 null + 可选链）', () => {
        expect(stats).toContain("export let onPickTag: (tag: string) => void = () => {};");
    });

    it('词云两个分支都渲染成可点的 button 并上报标签', () => {
        expect((statsCode.match(/class="rl-cloud-w is-abs lv-\{w\.level\}/g) ?? []).length).toBe(1);
        expect((statsCode.match(/class="rl-cloud-w lv-\{w\.level\}/g) ?? []).length).toBe(1);
        // 两处都要有 on:click 上报
        expect((statsCode.match(/on:click=\{\(\) => onPickTag\(w\.text\)\}/g) ?? []).length).toBe(2);
        expect((statsCode.match(/<button type="button" class="rl-cloud-w/g) ?? []).length).toBe(2);
    });

    it('🔴 反向守卫：⛔ 别退回「纯 span 不可点」的旧形态', () => {
        expect(statsCode).not.toMatch(/<span class="rl-cloud-w/);
        // 旧的反向裁定注释必须已被改写（新裁定里要写明「别改回纯 span」）
        expect(stats).toContain('改回纯 span');
    });

    it('按钮外观被抹平（主题不会给它灰方块）且可点', () => {
        const i = stats.indexOf('.rl-cloud-w {');
        expect(i).toBeGreaterThan(-1);
        const block = stats.slice(i, i + 700);
        expect(block).toContain('cursor: pointer');
        expect(block).toContain('appearance: none');
        expect(block).toContain('background: none');
        expect(block).toContain('border: none');
    });

    it('HomeView 把 pickTag 传给 StatsBoard，且新 prop 追加在 {ctrlWheelZoom} 之后', () => {
        expect(home).toContain('onPickTag={pickTag}');
        const tagLine = home.split('\n').find((l) => l.includes('<StatsBoard')) ?? '';
        const iCtrl = tagLine.indexOf('{ctrlWheelZoom}');
        const iPick = tagLine.indexOf('onPickTag={pickTag}');
        expect(iCtrl).toBeGreaterThan(-1);
        expect(iPick).toBeGreaterThan(iCtrl);
        // #635 ③ 的三者连续字面相邻不许被破坏
        expect(tagLine).toContain('coverUrlOf={posterUrl} {onSetRating} {ctrlWheelZoom}');
    });

    it('三层筛选链顺序：视图 → 标签 → 页签', () => {
        expect(homeCode).toContain('$: viewEntries = activeView ? filterForView(entries, activeView) : entries;');
        expect(homeCode).toContain('$: taggedEntries = filterEntriesByTag(viewEntries, tagFilter);');
        expect(homeCode).toContain(
            '$: listEntries = mergedOn ? taggedEntries : taggedEntries.filter((e) => tabMatchesEntry(activeTab, e));',
        );
        const iView = homeCode.indexOf('$: viewEntries =');
        const iTag = homeCode.indexOf('$: taggedEntries =');
        const iList = homeCode.indexOf('$: listEntries =');
        expect(iView).toBeGreaterThan(-1);
        expect(iTag).toBeGreaterThan(iView);
        expect(iList).toBeGreaterThan(iTag);
    });

    it('点标签时会切回库列表（统计页没有列表可看）', () => {
        expect(homeCode).toContain(
            'if (activeTab === \'stats\' || activeTab === \'tracking\') switchTab(tabWithTaggedEntries(next));',
        );
        // mainListTab 不许用 `as never` 糊类型（第一版踩过）
        expect(homeCode).not.toContain('tabLockType(t) as never');
        expect(homeCode).toContain('return lock !== null && pool.includes(lock);');
    });

    it('🔴 落脚页签必须真有该标签的条目（真机踩过：点「喜剧」落到阅读页签 = 0 张卡）', () => {
        // 新函数存在且读的是「按标签筛过的集合」
        expect(homeCode).toContain('function tabWithTaggedEntries(tag: string): HomeTab {');
        expect(homeCode).toContain('const hitPool = filterEntriesByTag(viewEntries, tag);');
        expect(homeCode).toContain(
            'const hit = navTabs.find((t) => t !== \'stats\' && t !== \'tracking\' && hitPool.some((e) => tabMatchesEntry(t, e)));',
        );
        expect(homeCode).toContain('return hit ?? mainListTab();');
        // 🔴 反向守卫：⛔ 别退回「只按当前视图第一个类型页签」的旧落脚点
        expect(homeCode).not.toContain("if (activeTab === 'stats' || activeTab === 'tracking') switchTab(mainListTab());");
    });

    it('有显式的取消入口（✕），且只在库列表页显示提示条', () => {
        expect(homeCode).toContain('function clearTagFilter(): void {');
        expect(homeCode).toContain('on:click={clearTagFilter}');
        expect(homeCode).toContain("{#if tagFilterText && effPage === 'library'}");
        // 取消按钮必须是真 button（键盘可达）+ aria-label
        expect(homeCode).toMatch(/<button type="button" class="rl-tag-filter-x" aria-label="取消标签筛选"/);
    });

    it('🔴 反向守卫：标签筛选不许实现成「新建 custom 视图」（那会污染用户设置）', () => {
        expect(homeCode).not.toMatch(/tags:\s*\[\s*tag\s*\]/);
        expect(homeCode).not.toMatch(/views\s*=\s*\[\.\.\.views/);
        expect(homeCode).not.toMatch(/saveViews|onViewsChange/);
    });
});

describe('m18442 ② 装配 · 封面缓存与组件生命周期解绑', () => {
    const list = read('src/views/components/MediaList.svelte');
    const listCode = stripComments(list);

    it('已加载集合从模块级缓存取初始快照，并写回模块级', () => {
        expect(listCode).toContain('let loadedCovers = coverLoadedSnapshot();');
        expect(listCode).toContain('rememberCoverLoaded(id);');
        expect(listCode).toContain("import { coverLoadedSnapshot, rememberCoverLoaded } from 'pure/coverLoaded';");
    });

    it('🔴 反向守卫：⛔ 别把已加载集合改回组件内的空 Set（症状会立刻复发）', () => {
        expect(listCode).not.toContain('let loadedCovers = new Set<string>();');
    });

    it('仍保留实例 Set 用于触发 Svelte 重渲染（模块级 Set 的变更 Svelte 看不见）', () => {
        expect(listCode).toContain('loadedCovers = new Set(loadedCovers).add(id);');
        expect(listCode).toContain('if (loadedCovers.has(id)) return;');
    });

    it('瀑布流的 is-loaded 判据仍读实例集合', () => {
        expect(listCode).toContain('class:is-loaded={loadedCovers.has(e.id)}');
    });
});

/**
 * m18442 ② 第二层 —— 系列折叠卡的**入场动画只播一次**。
 *
 * 真机实测（`probe-anim2.cjs`）：切走再切回时 `probeKept = 0`（DOM 整体重建）
 * 且同帧 `animRunning = 12`（12 张折叠卡全部重放 `rl-stk-in`）⇒ 这才是「封面重新刷新」的
 * 视觉来源（封面字节本来就在进程内位图缓存里，实测 1~4ms，不是网络问题）。
 */
describe('m18442 ② 装配 · 系列卡入场动画只播一次', () => {
    const list = read('src/views/components/MediaList.svelte');
    const listCode = stripComments(list);

    it('已播集合从模块级缓存取初始快照 + 写回模块级', () => {
        expect(listCode).toContain('let stackAnimated = stackAnimatedSnapshot();');
        expect(listCode).toContain('rememberStackAnimated(key);');
        expect(listCode).toContain(
            "import { stackAnimatedSnapshot, rememberStackAnimated } from 'pure/stackAnimated';",
        );
    });

    it('卡片根节点按快照打 is-animated，且 animationend 才记账', () => {
        expect(listCode).toContain('class:is-animated={stackAnimated.has(g.key)}');
        // 🔴 必须是 animationend（渲染时记账会把第一次的动画当场掐掉）
        expect(listCode).toContain('on:animationend={(ev) => onStackAnimationEnd(ev, g.key)}');
        expect(listCode).toContain("target.classList.contains('rl-cov-stack-extra')");
        expect(listCode).toContain('markStackAnimated(key);');
    });

    it('🔴 on:animationend 必须排在 on:contextmenu 之前（后者与 use:stackGate 的紧邻是 #512/#608 的守卫）', () => {
        const iAnim = listCode.indexOf('on:animationend={(ev) => onStackAnimationEnd(ev, g.key)}');
        const iCtx = listCode.indexOf('on:contextmenu={(ev) => openGroupCtx(g, ev)}');
        const iGate = listCode.indexOf('use:stackGate={g.key}>');
        expect(iAnim).toBeGreaterThan(-1);
        expect(iCtx).toBeGreaterThan(iAnim);
        expect(iGate).toBeGreaterThan(iCtx);
        // 产物断言钉的逐字形态（⛔ 不许自己在 src 里造一条假的相邻）
        expect(listCode).toMatch(/on:contextmenu=\{\(ev\) => openGroupCtx\(g, ev\)\}\r?\n\s*use:stackGate=\{g\.key\}>/);
    });

    it('🔴 模板表达式里不许出现 TS 类型断言（Svelte 4 按纯 JS 解析，会 Unexpected token）', () => {
        // 实测过：模板里写 `as HTMLElement` ⇒ svelte-check 从 0 errors 变 5 errors
        for (const line of list.split('\n')) {
            if (!/<[a-zA-Z]/.test(line)) continue;
            expect(line).not.toMatch(/on:\w+=\{[^}]*\bas\s+[A-Z]/);
        }
    });

    it('🔴 反向守卫：⛔ 别在渲染时记账（那样第一次的入场动画等于被删掉）', () => {
        expect(listCode).not.toMatch(/class:is-animated=\{stackAnimated\.has\(g\.key\)\}\s*markStackAnimated/);
        // 组装里不许出现「渲染即写入」的调用形态
        expect(listCode).not.toContain('rememberStackAnimated(g.key);\n            }\n');
    });

    it('CSS 里 is-animated 掐掉动画，且特异性高于基础规则', () => {
        expect(listCode).toContain('.rl-series-card.is-animated .rl-cov-stack-extra { animation: none; }');
        // 基础规则必须仍在（否则无从谈「掐掉」）
        expect(listCode).toContain('animation: rl-stk-in .34s cubic-bezier(.2, .7, .3, 1) backwards;');
        const iBase = listCode.indexOf('animation: rl-stk-in .34s');
        const iKill = listCode.indexOf('.rl-series-card.is-animated .rl-cov-stack-extra { animation: none; }');
        expect(iBase).toBeGreaterThan(-1);
        expect(iKill).toBeGreaterThan(iBase);
    });

    it('仍保留 prefers-reduced-motion 兜底（⛔ 别被新规则替掉）', () => {
        expect(listCode).toContain('@media (prefers-reduced-motion: reduce)');
        expect(listCode).toContain('.rl-series-card .rl-cov-stack-extra { animation: none; }');
    });
});

describe('m18442 ② stackAnimated · 单例语义', () => {
    it('快照是副本：改快照不影响模块级（反之亦然）', () => {
        resetStackAnimatedForTest();
        rememberStackAnimated('k1');
        const snap = stackAnimatedSnapshot();
        snap.add('k2');
        expect(stackAnimatedSnapshot().has('k2')).toBe(false);
        expect(stackAnimatedSnapshot().has('k1')).toBe(true);
    });

    it('同一 key 重复记账幂等', () => {
        resetStackAnimatedForTest();
        rememberStackAnimated('dup');
        rememberStackAnimated('dup');
        expect(stackAnimatedSnapshot().size).toBe(1);
    });

    it('空 key 不入缓存', () => {
        resetStackAnimatedForTest();
        rememberStackAnimated('');
        rememberStackAnimated(null as never);
        expect(stackAnimatedSnapshot().size).toBe(0);
    });
});
