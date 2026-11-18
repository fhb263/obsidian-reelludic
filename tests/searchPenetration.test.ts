/**
 * m07854 ⑫ 智能搜索穿透 —— 搜索时强制忽略三种「藏条目的壳」。
 *
 * 用户原话：「首页搜索加**智能搜索穿透**（搜「熊出没」不要只显示并组的系列，而要摊开：
 * 强制忽略系列分组，把系列里命中的单部电影直接展示）」。
 *
 * 为什么必须是**源码级**守卫：`searching` 是 Svelte 组件里的 `$:` 派生量，`seriesRows` /
 * `groupCards` / `rowSource` 全是响应式表达式 —— tsc 与 svelte-check 都不会因为它们
 * 「漏了一个 && !searching」而报错，只有真机点一次才看得见。这类回归一旦漏，表现是
 * 「搜到了但看不见」（命中项被折进组卡里），属于最难自查的一类。
 *
 * ⛔ 铁律：先 strip 注释再匹配（#379 / #730 / #731 三次被自己的注释打穿）。
 *    Svelte 的 HTML 注释 `<!-- -->` 也必须剥 —— 否则我们在注释里写的「⛔ 别漏 !searching」
 *    会反过来让反向守卫假红。单次交替扫描（⛔ 别分两步先块后行：行注释里出现块注释起手符时
 *    会把后面整段真实代码吞掉，见 #760 的教训）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

function strip(src: string): string {
    return src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
}

const mediaSrc = strip(read('src/views/components/MediaList.svelte'));

describe('m07854 ⑫ 智能搜索穿透', () => {
    it('搜索判定来自防抖后的搜索词，且与 filtered 同源', () => {
        // 必须用 debouncedSearch —— 用 searchText 会让「已按新词筛完、却还在折叠」的那一帧错位。
        expect(mediaSrc).toMatch(/\$: searching = debouncedSearch\.trim\(\)\.length > 0;/);
        expect(mediaSrc).not.toMatch(/\$: searching = searchText/);
    });

    it('维度分组桶在搜索时退化为整池（不按桶取样）', () => {
        expect(mediaSrc).toMatch(
            /\$: groupPoolEntries = groupDim !== 'none' && activeGroupKey && !searching \? entriesInBucket\(filtered, groupDim, activeGroupKey\) : filtered;/,
        );
    });

    it('维度组卡在搜索时不再产出（否则命中项被桶卡重新藏起来）', () => {
        expect(mediaSrc).toMatch(
            /\$: groupCards = groupDim !== 'none' && !activeGroupKey && !searching \? buildGroupCards\(groupEntriesBy\(filtered, groupDim\)\) : \[\];/,
        );
    });

    it('海报墙 / 卡片网格的系列折叠在搜索时摊平为逐条目', () => {
        // searching ⇒ listFlatRows（每条独立一行）；否则维持原来的 foldSeries。
        // 🔴 m07854 ⑬ 翻面（2026-11-13）：判据从裸 `searching` 提成 `unfoldRows`（= searching ∪ 用户主动摊平），
        //    但**本条的语义不变**：搜索态下 `seriesRows` 必须走 `listFlatRows`。
        //    ⛔ 别把断言改回裸 `searching ?`（那是 ⑬ 之前的形态），也别放宽成「只要有 listFlatRows 就算过」。
        expect(mediaSrc).toMatch(/\$: unfoldRows = searching \|\| unfoldSeries;/);
        expect(mediaSrc).toMatch(/\$: seriesRows = unfoldRows \? listFlatRows\(groupPoolEntries\) : foldSeries\(groupPoolEntries\);/);
        // 反向守卫：⛔ 不许把 listFlatRows 又换回 foldSeries 的单一路径
        expect(mediaSrc).not.toMatch(/\$: seriesRows = foldSeries\(groupPoolEntries\);/);
        // 反向守卫：⛔ 不许绕过 unfoldRows 直接写裸 searching（那会让 ⑬ 的开关对它失效）
        expect(mediaSrc).not.toMatch(/\$: seriesRows = searching \?/);
    });

    it('列表视图的合集树形父子行在搜索时也让位给摊平', () => {
        expect(mediaSrc).toMatch(/listGrouping && !searching\s*\n\s*\? listTreeRows\(groupPoolEntries, sortBy\)/);
        expect(mediaSrc).not.toMatch(/listGrouping\s*\n\s*\? listTreeRows\(groupPoolEntries, sortBy\)/);
    });

    it('进组顶栏的桶信息同样跟随穿透（搜索时不显示组名条）', () => {
        expect(mediaSrc).toMatch(/groupDim !== 'none' && activeGroupKey && !searching\s*\n\s*\? groupEntriesBy\(filtered, groupDim\)/);
    });

    it('⛔ 搜索不清用户的浏览位置（清空后要能原地回到刚才进的组）', () => {
        // 判据：searching 那条派生语句本身不许赋值 activeSeriesKey / activeGroupKey。
        const line = mediaSrc.match(/\$: searching = [^\n]*/)?.[0] ?? '';
        expect(line).not.toMatch(/activeSeriesKey|activeGroupKey/);
        // 也不许在搜索相关的响应块里调 closeSeries / closeBucket
        expect(mediaSrc).not.toMatch(/\$: if \(searching\)[^\n]*close(Series|Bucket)\(/);
    });

    it('摊平用的就是既有的「不并组展示」纯逻辑（⛔ 别在视图层另写一份）', () => {
        expect(mediaSrc).toMatch(/import \{[^}]*listFlatRows[^}]*\} from 'pure\/seriesGroup';/);
        // 反向守卫：不许在组件里自己 map 出单条行来顶替 listFlatRows 的语义
        expect(mediaSrc).not.toMatch(/searching \? groupPoolEntries\.map\(/);
    });
});
