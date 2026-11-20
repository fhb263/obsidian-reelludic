// 视图级标签筛选的池构建（pure/tagOptions）单测 —— m19924 ①
//
// 用户原话：「再在首页视图筛选栏题材旁边加个筛选的"标签"（样式和交互逻辑和题材筛选一样）」。
// 这组用例钉三件事：
//  ⑴ 池 = 频次降序 + 名称拼音序；「无标签」单独成桶且恒置末位；
//  ⑵ 比较口径与 `pure/tagFilter` **共用**（大小写/空白归一，⛔ 不 NFKC、不去标点）；
//  ⑶ 命中判定：空选恒真、多选 OR、「无标签」桶能命中没有标签的条目。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    TAG_NONE_KEY,
    TAG_NONE_LABEL,
    buildTagOptions,
    matchesTags,
    tagPillLabel,
    tagValuesOf,
} from 'pure/tagOptions';
import { filterAndSort } from 'pure/search';
import type { MediaEntry } from 'data/types';

const ROOT = join(__dirname, '..');
const MEDIA_LIST = readFileSync(join(ROOT, 'src/views/components/MediaList.svelte'), 'utf8');

function entry(over: Partial<MediaEntry> & { id: string }): MediaEntry {
    return {
        type: 'movie',
        title: over.id,
        status: 'watched',
        // ⚠️ `sortBy` 无论如何都会读 `updatedAt`（默认档 `recent`），不填就是 `undefined.localeCompare` 崩
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...over,
    } as MediaEntry;
}

describe('tagValuesOf：类型容错与归一', () => {
    it('非数组 / 缺字段 ⇒ 空数组（⛔ 不抛）', () => {
        expect(tagValuesOf(null)).toEqual([]);
        expect(tagValuesOf(undefined)).toEqual([]);
        expect(tagValuesOf({})).toEqual([]);
        expect(tagValuesOf({ tags: '不是数组' as never })).toEqual([]);
    });

    it('去空、折空白、非字符串元素跳过', () => {
        expect(tagValuesOf({ tags: ['  治愈  ', '', '   ', 42 as never, '日常'] })).toEqual(['治愈', '日常']);
        expect(tagValuesOf({ tags: ['多个\u3000空格'] })).toEqual(['多个 空格']);
    });

    it('🔴 大小写 / 空白差异算同一个标签，只保留**首次出现的原始写法**', () => {
        expect(tagValuesOf({ tags: ['C++', 'c++ ', 'C++'] })).toEqual(['C++']);
    });

    it('字面「无标签」不作为真实标签值（否则面板里会出现两行同名）', () => {
        expect(tagValuesOf({ tags: [TAG_NONE_LABEL, '治愈'] })).toEqual(['治愈']);
    });
});

describe('buildTagOptions：排序与「无标签」桶', () => {
    it('频次降序；同频按名称拼音序（结果不随输入顺序漂移）', () => {
        const pool = [
            { tags: ['日常'] },
            { tags: ['治愈'] },
            { tags: ['日常'] },
            { tags: ['科幻'] },
        ];
        const opts = buildTagOptions(pool);
        expect(opts.map((o) => o.label)).toEqual(['日常', '科幻', '治愈']);
        expect(opts.map((o) => o.count)).toEqual([2, 1, 1]);
    });

    it('频次按**比较键**归并（`C++` 与 `c++` 计数合并），label 取首次写法', () => {
        const opts = buildTagOptions([{ tags: ['C++'] }, { tags: ['c++'] }]);
        expect(opts).toHaveLength(1);
        expect(opts[0]).toMatchObject({ label: 'C++', count: 2 });
    });

    it('🔴 「无标签」恒置末位（频次再高也不许排到前面）', () => {
        const pool = [{ tags: [] }, { tags: [] }, { tags: [] }, { tags: ['治愈'] }];
        const opts = buildTagOptions(pool);
        expect(opts[opts.length - 1]).toMatchObject({ key: TAG_NONE_KEY, label: TAG_NONE_LABEL, count: 3 });
        expect(opts[0].label).toBe('治愈');
    });

    it('全部有条目都带标签 ⇒ 不产出「无标签」行（没有这类条目就别占一行）', () => {
        const opts = buildTagOptions([{ tags: ['治愈'] }]);
        expect(opts.some((o) => o.key === TAG_NONE_KEY)).toBe(false);
    });

    it('空池 ⇒ 空数组', () => {
        expect(buildTagOptions([])).toEqual([]);
    });
});

describe('matchesTags：命中判定', () => {
    it('空选 ⇒ 恒真（这一维不存在）', () => {
        expect(matchesTags({ tags: [] }, [])).toBe(true);
        expect(matchesTags({}, [])).toBe(true);
    });

    it('多选是 OR', () => {
        expect(matchesTags({ tags: ['治愈'] }, ['治愈', '日常'])).toBe(true);
        expect(matchesTags({ tags: ['科幻'] }, ['治愈', '日常'])).toBe(false);
    });

    it('🔴 比较按归一键：选 `c++` 能命中标签 `C++`', () => {
        expect(matchesTags({ tags: ['C++'] }, ['c++'])).toBe(true);
        expect(matchesTags({ tags: ['c++ '] }, ['C++'])).toBe(true);
    });

    it('⛔ 不 NFKC、不去标点：`C++` 与 `C#` 必须不同（与 tagFilter 同一口径）', () => {
        expect(matchesTags({ tags: ['C#'] }, ['C++'])).toBe(false);
        expect(matchesTags({ tags: ['C++'] }, ['C#'])).toBe(false);
    });

    it('选了「无标签」⇒ 无标签条目命中；没选 ⇒ 不命中', () => {
        expect(matchesTags({ tags: [] }, [TAG_NONE_KEY])).toBe(true);
        expect(matchesTags({ tags: [] }, ['治愈'])).toBe(false);
    });

    it('同时选了「无标签」和真实标签 ⇒ 两类都命中', () => {
        const sel = [TAG_NONE_KEY, '治愈'];
        expect(matchesTags({ tags: [] }, sel)).toBe(true);
        expect(matchesTags({ tags: ['治愈'] }, sel)).toBe(true);
        expect(matchesTags({ tags: ['科幻'] }, sel)).toBe(false);
    });
});

describe('tagPillLabel：胶囊文案', () => {
    const opts = buildTagOptions([{ tags: ['治愈'] }, { tags: ['治愈'] }, { tags: ['日常'] }]);

    it('未选 ⇒ 「全部」', () => {
        expect(tagPillLabel(opts, [])).toBe('全部');
    });

    it('选 1 项 ⇒ 该标签名', () => {
        expect(tagPillLabel(opts, ['日常'])).toBe('日常');
    });

    it('选 ≥2 项 ⇒ 池序第一个 + N-1（⛔ 不是勾选先后）', () => {
        // 池序是「治愈(2) → 日常(1)」，先勾日常再勾治愈，显示仍应是「治愈+1」
        const sel = ['日常', '治愈'];
        expect(tagPillLabel(opts, sel)).toBe('治愈+1');
    });
});

describe('filterAndSort 接线：标签是独立维度', () => {
    const items = [
        entry({ id: 'a', tags: ['治愈'] }),
        entry({ id: 'b', tags: ['科幻'] }),
        entry({ id: 'c', tags: [] }),
    ];
    // ⚠️ `sortBy` 只能是 `SortBy` 的成员（见 `pure/search.ts`）—— `added-desc` 不存在，
    //    写它 tsc 直接 TS2345；用 `recent`（默认档）即可，本组只关心标签这一维。
    const base = { status: 'all' as const, type: 'all' as const, query: '', sortBy: 'recent' as const };

    it('空 tags ⇒ 不过滤（与不传等价）', () => {
        expect(filterAndSort(items, { ...base, tags: [] }).length).toBe(3);
        expect(filterAndSort(items, base).length).toBe(3);
    });

    it('单选 / 多选 OR', () => {
        expect(filterAndSort(items, { ...base, tags: ['治愈'] }).map((e) => e.id)).toEqual(['a']);
        expect(filterAndSort(items, { ...base, tags: ['治愈', '科幻'] }).map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('「无标签」桶命中 tags 缺失的条目', () => {
        expect(filterAndSort(items, { ...base, tags: [TAG_NONE_KEY] }).map((e) => e.id)).toEqual(['c']);
    });

    it('与题材 / 关键词是 AND（两个维度同时收窄）', () => {
        const mixed = [
            entry({ id: 'x', tags: ['治愈'], genres: ['动画'] }),
            entry({ id: 'y', tags: ['治愈'], genres: ['剧情'] }),
        ];
        const out = filterAndSort(mixed, { ...base, tags: ['治愈'], genres: ['动画'] });
        expect(out.map((e) => e.id)).toEqual(['x']);
    });
});

describe('装配守卫：MediaList 真的把标签接进了筛选链', () => {
    it('状态与池都建了（`tagSel` / `tagOptions` / `tagPill` / `allTagsSelected`）', () => {
        expect(MEDIA_LIST).toMatch(/let tagSel: string\[\] = \[\];/);
        expect(MEDIA_LIST).toMatch(/\$: tagOptions = buildTagOptions\(genrePool\);/);
        expect(MEDIA_LIST).toMatch(/\$: tagPill = tagPillLabel\(tagOptions, tagSel\);/);
        expect(MEDIA_LIST).toMatch(/\$: allTagsSelected = tagOptions\.length > 0/);
    });

    it('🔴 主筛选 **与** 待补计数两处 filterAndSort 都带 `tags: tagSel`（漏一处数字就对不上）', () => {
        const hits = MEDIA_LIST.match(/tags: tagSel,/g) ?? [];
        expect(hits.length).toBe(2);
    });

    it('🔴 视图作用域切换时**与题材一起清空**（否则文学页签选的标签会漏进网文页签）', () => {
        expect(MEDIA_LIST).toMatch(/tagSel = \[\];\s*\n\s*closeTag\(\);/);
        // 两条清空必须在**同一个**作用域切换分支里，顺序是「题材 → 标签」。
        // ⚠️ 中间夹着注释行 ⇒ 不能写死「隔一行」，但要限定 400 字符内，避免跨到别处另一段清空。
        expect(MEDIA_LIST).toMatch(/genreSel = \[\];\s*closeGenre\(\);[\s\S]{0,400}?tagSel = \[\];\s*closeTag\(\);/);
    });

    it('清除筛选也会清空标签（否则空态按钮形同虚设）', () => {
        const at = MEDIA_LIST.indexOf('function clearFilters()');
        expect(at).toBeGreaterThan(0);
        const body = MEDIA_LIST.slice(at, at + 1200);
        expect(body).toMatch(/tagSel = \[\];/);
    });

    it('空态回显带上「标签：」（与题材并列）', () => {
        expect(MEDIA_LIST).toMatch(/tagLabel: tagSel\.length > 0 \? tagPill : undefined,/);
        const empty = readFileSync(join(ROOT, 'src/pure/emptyState.ts'), 'utf8');
        expect(empty).toMatch(/if \(input\.tagLabel\) parts\.push\(`标签：\$\{input\.tagLabel\}`\);/);
    });

    it('🔴 面板类名是**独立的 `rl-tagf-*`**（复用 `rl-genre-*` 会让产物断言的题材锚被标签面板满足）', () => {
        for (const cls of ['rl-tagf-wrap', 'rl-tagf-btn', 'rl-tagf-panel', 'rl-tagf-head', 'rl-tagf-body', 'rl-tagf-opt', 'rl-tagf-cnt']) {
            expect(MEDIA_LIST).toContain(cls);
        }
        // 反向守卫：标签那一块内不许出现 rl-genre-* 与之混用（两套必须能各自被钉）
        const at = MEDIA_LIST.indexOf('rl-vb-select rl-tagf-wrap');
        const block = MEDIA_LIST.slice(at, at + 2400);
        expect(block).not.toMatch(/rl-genre-/);
    });

    it('样式与题材同款（两级前缀 + `--input-height` + `--input-shadow` + 勾选框变量覆盖）', () => {
        expect(MEDIA_LIST).toMatch(/\.rl-tagf-wrap \{ position: relative; \}/);
        expect(MEDIA_LIST).toMatch(/\.rl-tagf-wrap \.rl-tagf-btn \{[\s\S]*?height: var\(--input-height\);/);
        expect(MEDIA_LIST).toMatch(/\.rl-tagf-wrap \.rl-tagf-btn \{[\s\S]*?box-shadow: var\(--input-shadow\);/);
        expect(MEDIA_LIST).toMatch(/\.rl-tagf-opt input\[type="checkbox"\] \{[^}]*--checkbox-size: 13px; --checkbox-radius: 3px;/);
        // 反向守卫：胶囊 ⛔ 不许写成单类（核心 `button:not(.clickable-icon)`(0,1,1) 会压出灰底）
        expect(MEDIA_LIST).not.toMatch(/(?<![ .\w-])\.rl-tagf-btn\s*\{/);
    });

    it('互斥广播与 Esc / 外点关闭（与题材逐条同构）', () => {
        expect(MEDIA_LIST).toMatch(/broadcastClosePeers\('rl-toolbar-filters'\)/);
        expect(MEDIA_LIST).toMatch(/closest\('\.rl-tagf-panel'\)/);
        expect(MEDIA_LIST).toMatch(/closest\('\.rl-tagf-btn'\)/);
        expect(MEDIA_LIST).toMatch(/ev\.key === 'Escape'\) closeTag\(\)/);
        expect(MEDIA_LIST).toMatch(/onDestroy\(unbindTagWindow\)/);
    });
});
