// 分类视图（pure/mediaViews）—— 守用户 2026-11-23 裁定的四条口径：
//   ⑴ 视图存进 Catalog（归一必须**幂等**：读盘 → 写盘 → 再读盘不许漂）
//   ⑵ 默认视图 = 物理库本身：恒存在、恒在第 1 位、不可删 / 不可改名 / 不可换种类
//   ⑶ 合集视图 = 先按 IP 聚合再进一层（**不是** seriesGroup 的 ≥2 折叠）
//   ⑷ 自定义视图只按标签筛（空标签 ⇒ 谁也不命中，⛔ 不是「全部」）
import { describe, expect, it } from 'vitest';
import {
    COLLECTION_VIEW_ID,
    COLLECTION_VIEW_NAME,
    DEFAULT_VIEW_ID,
    DEFAULT_VIEW_NAME,
    MAX_VIEWS,
    VIEW_KIND_LABELS,
    VIEW_TYPE_CHOICES,
    buildCollectionGroups,
    collectionSubtitleOf,
    createView,
    customViewTagPool,
    entryMatchesTags,
    filterForView,
    ipKeyOf,
    isBuiltinView,
    nextViewId,
    normalizeMediaView,
    normalizeViewBookKinds,
    normalizeViewTags,
    normalizeViewTypes,
    normalizeViews,
    viewBookKindPool,
    viewIconOf,
    viewIsVisible,
    viewSelectionOf,
    viewSelectionPatch,
    viewTypePool,
    viewTypesOf,
    viewsForStorage,
    visibleViews,
    type MediaView,
} from 'pure/mediaViews';
import type { MediaEntry } from 'data/types';

/** 造一条最小可用条目（只填被测逻辑用得到的字段） */
function entry(partial: Partial<MediaEntry> & { id: string }): MediaEntry {
    return {
        type: 'movie',
        title: partial.id,
        status: 'watched',
        rating: 0,
        genres: [],
        tags: [],
        cast: [],
        links: [],
        notes: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    } as MediaEntry;
}

describe('normalizeViews（🔴 默认视图 + 内置合集视图恒存在）', () => {
    it('空 / 脏输入 ⇒ 内置两颗（默认 + 合集），⛔ 不返回空表', () => {
        for (const raw of [undefined, null, 5, 'x', {}, []]) {
            const views = normalizeViews(raw);
            expect(views).toHaveLength(2);
            expect(views[0].id).toBe(DEFAULT_VIEW_ID);
            expect(views[0].name).toBe(DEFAULT_VIEW_NAME);
            expect(views[0].kind).toBe('default');
            // 🔴 2026-11-24 用户报障「后默认视图没合集视图啊」⇒ 合集视图出厂就在
            expect(views[1].id).toBe(COLLECTION_VIEW_ID);
            expect(views[1].name).toBe(COLLECTION_VIEW_NAME);
            expect(views[1].kind).toBe('collection');
        }
    });

    it('🔴 输入里出现 default / collection 这两个 id ⇒ 整条丢弃（内置视图只能由归一器构造）', () => {
        const views = normalizeViews([
            { id: 'default', name: '被篡改', kind: 'custom', tags: ['工作'] },
            { id: 'collection', name: '也被篡改', kind: 'custom', tags: ['日常'] },
            { id: 'v_1', name: '工作', kind: 'custom', tags: ['工作'] },
        ]);
        expect(views).toHaveLength(3);
        expect(views[0].name).toBe(DEFAULT_VIEW_NAME);
        expect(views[0].kind).toBe('default');
        expect(views[1].name).toBe(COLLECTION_VIEW_NAME);
        expect(views[1].kind).toBe('collection');
        expect(views[2].name).toBe('工作');
    });

    it('id 重复 ⇒ 保留先出现的，后面的整条丢弃', () => {
        const views = normalizeViews([
            { id: 'v_1', name: '工作', kind: 'custom', tags: ['工作'] },
            { id: 'v_1', name: '日常', kind: 'custom', tags: ['日常'] },
        ]);
        expect(views.map((v) => v.name)).toEqual([DEFAULT_VIEW_NAME, COLLECTION_VIEW_NAME, '工作']);
    });

    it('没名字的视图被丢弃（切换条上会是一片空白）', () => {
        const views = normalizeViews([{ id: 'v_1', kind: 'custom' }, { id: 'v_2', name: '   ', kind: 'custom' }]);
        expect(views).toHaveLength(2);
    });

    it(`最多 ${MAX_VIEWS} 条（含默认视图），超出的丢最旧`, () => {
        const raw = Array.from({ length: MAX_VIEWS + 5 }, (_, i) => ({ id: `v_${i}`, name: `视图${i}`, kind: 'custom' }));
        expect(normalizeViews(raw)).toHaveLength(MAX_VIEWS);
    });

    it('🔴 幂等：归一结果再归一一次完全不变（否则读盘→写盘→读盘会漂）', () => {
        const raw = [
            { id: 'v_2', name: '合集', kind: 'collection', types: ['game', 'movie', 'movie'] },
            { id: 'v_1', name: '工作', kind: 'custom', tags: [' 工作 ', 'Work', 'work', ''] },
            { name: '没 id 的' },
            { id: 'v_9' },
        ];
        const once = normalizeViews(raw);
        const twice = normalizeViews(JSON.parse(JSON.stringify(once)));
        expect(twice).toEqual(once);
    });

    /**
     * 🔴 2026-11-08（m04478 / m04712）：自建视图的 kind 一律 custom，**但内置两枚的种类不能被连带抹平**。
     * ⚠️ 这两件事只差一行代码（内置视图用常量构造、不走 `normalizeMediaView`），写错就会
     *    「合集视图」在首页退化成普通列表 —— 本条把两侧同时钉住。
     */
    it('🔴 自建视图归 custom，内置视图仍守 default / collection', () => {
        const views = normalizeViews([
            { id: 'v_1', name: '老合集', kind: 'collection', types: ['game'] },
            { id: 'default', name: 'x', kind: 'custom' },
            { id: 'collection', name: 'y', kind: 'custom' },
        ]);
        expect(views.map((v) => [v.id, v.kind])).toEqual([
            [DEFAULT_VIEW_ID, 'default'],
            [COLLECTION_VIEW_ID, 'collection'],
            ['v_1', 'custom'],
        ]);
    });
});

describe('normalizeViewTags / normalizeViewTypes', () => {
    it('标签：trim、丢空、大小写去重但保留首次写法', () => {
        expect(normalizeViewTags([' 工作 ', 'Work', 'work', '', '  ', 5, null])).toEqual(['工作', 'Work']);
    });

    it('非数组 ⇒ 空数组', () => {
        expect(normalizeViewTags(undefined)).toEqual([]);
        expect(normalizeViewTags('工作')).toEqual([]);
        expect(normalizeViewTags({ 0: '工作' })).toEqual([]);
    });

    it('二级分类：只留合法 EntryType，并按 ENTRY_TYPES 固定序（⛔ 不按点选顺序）', () => {
        expect(normalizeViewTypes(['game', 'movie', 'bogus', 'anime', 'movie'])).toEqual(['movie', 'anime', 'game']);
        expect(normalizeViewTypes(undefined)).toEqual([]);
    });
});

describe('normalizeMediaView', () => {
    it('name 是唯一硬要求：没有名字 ⇒ undefined', () => {
        expect(normalizeMediaView({ id: 'v_1', kind: 'custom' }, 0)).toBeUndefined();
        expect(normalizeMediaView(null)).toBeUndefined();
        expect(normalizeMediaView('x')).toBeUndefined();
    });

    it('没 id ⇒ 用下标给个稳定兜底（⛔ 不用随机数，否则每次读盘选中态都漂）', () => {
        expect(normalizeMediaView({ name: '工作' }, 3)?.id).toBe('v_3');
    });

    it('非法 kind ⇒ 归 custom（最保守：不会凭空变成整个库或按 IP 聚合）', () => {
        expect(normalizeMediaView({ name: 'x', kind: 'nope' })?.kind).toBe('custom');
        expect(normalizeMediaView({ name: 'x' })?.kind).toBe('custom');
    });

    /**
     * 🔴 2026-11-08 用户 m04478 + m04712 裁定：设置页删掉「视图种类」下拉，自建视图一律归「自定义视图」。
     * ⚠️ 老库里存着 `kind: 'collection'` 的自建视图（早期允许选）—— 读回来必须**当场变 custom**。
     *    这正是这条断言存在的理由：归一器若退回 `normalizeViewKind(o.kind)`，它会静默保留 collection，
     *    表现为「设置页已经没有那个下拉了，这个视图却还是看板形态、且标签过滤失效」，用户无从修。
     */
    it('🔴 自建视图的 kind 写死 custom —— 库里残留 collection / default 也要被抹平', () => {
        expect(normalizeMediaView({ name: 'x', kind: 'collection' })?.kind).toBe('custom');
        expect(normalizeMediaView({ name: 'x', kind: 'default' })?.kind).toBe('custom');
        expect(normalizeMediaView({ name: 'x', kind: 'custom' })?.kind).toBe('custom');
    });

    it('icon 只在非空时落字段（空串不占位）', () => {
        expect(normalizeMediaView({ name: 'x', icon: '  ' })?.icon).toBeUndefined();
        expect(normalizeMediaView({ name: 'x', icon: ' package ' })?.icon).toBe('package');
    });
});

describe('createView / nextViewId', () => {
    it('createView：名字留空 ⇒ 用种类默认名', () => {
        expect(createView('custom', '   ', 'v_1').name).toBe(VIEW_KIND_LABELS.custom);
        expect(createView('custom', '工作', 'v_1').name).toBe('工作');
    });

    it('nextViewId 跳过已占用的 id', () => {
        expect(nextViewId([])).toBe('v_1');
        expect(nextViewId(['v_1', 'v_2'])).toBe('v_3');
        expect(nextViewId(['v_1', 'v_3'])).toBe('v_2');
    });
});

describe('viewIconOf（⚠️ 写错名字 setIcon 会静默失败）', () => {
    it('用户填的图标优先；否则按种类兜底；永不返回空串', () => {
        expect(viewIconOf({ id: 'a', name: 'a', kind: 'collection', types: [], tags: [], icon: 'package' })).toBe('package');
        expect(viewIconOf({ id: 'a', name: 'a', kind: 'collection', types: [], tags: [] })).toBe('library');
        expect(viewIconOf({ id: 'a', name: 'a', kind: 'custom', types: [], tags: [] })).toBe('folder-tree');
        expect(viewIconOf({ id: 'a', name: 'a', kind: 'default', types: [], tags: [] })).toBe('layout-grid');
        expect(viewIconOf(null)).toBeTruthy();
    });
});

describe('viewTypesOf / viewTypePool', () => {
    it('空二级分类 ⇒ 全部类型（按 ENTRY_TYPES 固定序）', () => {
        expect(viewTypesOf({ id: 'a', name: 'a', kind: 'custom', types: [], tags: [] })).toEqual([
            'movie',
            'tv',
            'anime',
            'book',
            'game',
            'music',
        ]);
        expect(viewTypePool({ id: 'a', name: 'a', kind: 'custom', types: [], tags: [] })).toBeNull();
    });

    it('配了二级分类 ⇒ 只给那几种（MediaList 的 typePool 用）', () => {
        expect(viewTypePool({ id: 'a', name: 'a', kind: 'custom', types: ['movie', 'anime'], tags: [] })).toEqual([
            'movie',
            'anime',
        ]);
    });
});

describe('entryMatchesTags / filterForView', () => {
    it('🔴 白名单为空 ⇒ 谁也不命中（⛔ 不是「全部」）', () => {
        expect(entryMatchesTags(entry({ id: 'e1', tags: ['工作'] }), [])).toBe(false);
    });

    it('命中任一即可，且大小写 / 首尾空格不敏感', () => {
        const e = entry({ id: 'e1', tags: [' Work ', '日常'] });
        expect(entryMatchesTags(e, ['work'])).toBe(true);
        expect(entryMatchesTags(e, ['日常'])).toBe(true);
        expect(entryMatchesTags(e, ['工作'])).toBe(false);
        expect(entryMatchesTags(null, ['工作'])).toBe(false);
    });

    it('自定义视图：类型与标签都要过', () => {
        const view = { id: 'v_1', name: '工作', kind: 'custom' as const, types: ['movie' as const], tags: ['工作'] };
        const hit = entry({ id: 'e1', type: 'movie', tags: ['工作'] });
        const wrongType = entry({ id: 'e2', type: 'anime', tags: ['工作'] });
        const wrongTag = entry({ id: 'e3', type: 'movie', tags: ['日常'] });
        expect(filterForView([hit, wrongType, wrongTag], view).map((e) => e.id)).toEqual(['e1']);
    });

    it('默认视图 ⇒ 全过（它就是整个物理库）', () => {
        const view = { id: DEFAULT_VIEW_ID, name: DEFAULT_VIEW_NAME, kind: 'default' as const, types: [], tags: [] };
        const list = [entry({ id: 'e1' }), entry({ id: 'e2', type: 'music' })];
        expect(filterForView(list, view).map((e) => e.id)).toEqual(['e1', 'e2']);
    });

    it('过滤保留上游顺序（⛔ 这里不重排）', () => {
        const view = { id: 'v_1', name: 'x', kind: 'default' as const, types: ['movie' as const], tags: [] };
        const list = [entry({ id: 'c' }), entry({ id: 'a' }), entry({ id: 'b' })];
        expect(filterForView(list, view).map((e) => e.id)).toEqual(['c', 'a', 'b']);
    });
});

describe('customViewTagPool（给词云做排除集合，用户 2026-11-16 裁定）', () => {
    it('只收自定义视图的标签（内置视图 tags 恒空，也不该被当成来源）', () => {
        const views: MediaView[] = [
            { id: DEFAULT_VIEW_ID, name: DEFAULT_VIEW_NAME, kind: 'default', types: [], tags: [] },
            { id: COLLECTION_VIEW_ID, name: COLLECTION_VIEW_NAME, kind: 'collection', types: [], tags: [] },
            { id: 'v_1', name: '工作', kind: 'custom', types: [], tags: ['工作'] },
            { id: 'v_2', name: '日常', kind: 'custom', types: [], tags: ['日常', '生活'] },
        ];
        expect(customViewTagPool(views)).toEqual(['工作', '日常', '生活']);
    });

    it('🔴 内置视图即使被塞了标签也不收（判据是 kind，不是 tags 非空）', () => {
        const views = [
            { id: DEFAULT_VIEW_ID, name: DEFAULT_VIEW_NAME, kind: 'default' as const, types: [], tags: ['不该收'] },
        ];
        expect(customViewTagPool(views)).toEqual([]);
    });

    it('跨视图按小写去重，保留首次出现的写法', () => {
        const views: MediaView[] = [
            { id: 'v_1', name: 'A', kind: 'custom', types: [], tags: ['Work'] },
            { id: 'v_2', name: 'B', kind: 'custom', types: [], tags: ['work', ' 工作 '] },
        ];
        // 只留一个 Work（首见写法），空格被 trim
        expect(customViewTagPool(views)).toEqual(['Work', '工作']);
    });

    it('空输入 / 脏数据 ⇒ 空数组（不抛）', () => {
        expect(customViewTagPool([])).toEqual([]);
        expect(customViewTagPool(null as unknown as MediaView[])).toEqual([]);
        const dirty = [{ id: 'v_1', name: 'x', kind: 'custom', types: [], tags: ['', '  ', 'ok'] }] as MediaView[];
        expect(customViewTagPool(dirty)).toEqual(['ok']);
    });

    it('与 entryMatchesTags 的口径一致：`Work` 视图标签能命中 `work` 条目', () => {
        const views: MediaView[] = [{ id: 'v_1', name: 'A', kind: 'custom', types: [], tags: ['Work'] }];
        const pool = customViewTagPool(views);
        const e = entry({ id: 'e1', tags: ['work'] });
        expect(entryMatchesTags(e, views[0].tags)).toBe(true);
        // 词云那边用 `text.toLowerCase()` 与 pool 的小写键比 ⇒ 同样命中
        expect(pool.map((t) => t.toLowerCase())).toContain('work');
    });
});

describe('buildCollectionGroups（🔴 先按「归属合集」聚合，再按类型分行）', () => {
    it('跨类型同 IP 并到同一张卡（熊出没：电影 + 动画 + 游戏 = 三行一卡）', () => {
        const groups = buildCollectionGroups([
            entry({ id: 'm1', type: 'movie', collection: '熊出没', title: '熊出没之夺宝熊兵' }),
            entry({ id: 'a1', type: 'anime', collection: '熊出没', title: '熊出没之探险日记' }),
            entry({ id: 'g1', type: 'game', collection: '熊出没', title: '熊出没游戏' }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].name).toBe('熊出没');
        expect(groups[0].isSeries).toBe(true);
        expect(groups[0].count).toBe(3);
        expect(groups[0].rows.map((r) => r.type)).toEqual(['movie', 'anime', 'game']);
        // 🔴 2026-11-26 用户逐字：「小标题做如动画系列、电影系列、游戏系列」⇒ 行标题**不带合集名前缀**
        expect(groups[0].rows.map((r) => r.title)).toEqual(['电影系列', '动画系列', '游戏系列']);
    });

    it('🔴 只认「归属合集」：只填了 series 的条目不进合集视图（用户 2026-11-24 裁定）', () => {
        // series = 海报墙折叠分组名，collection = 人工声明的合集归属 —— 两者不许混用，
        // 否则存量 86 条带 series 的条目会无差别涌进合集视图。
        const groups = buildCollectionGroups([
            entry({ id: 'm1', series: '熊出没', title: '只有 series' }),
            entry({ id: 'm2', collection: '熊出没', title: '有 collection' }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].count).toBe(1);
        expect(groups[0].rows[0].items.map((e) => e.id)).toEqual(['m2']);
    });

    it('🔴 行顺序 = ENTRY_TYPES 固定序（与入库顺序无关）', () => {
        const groups = buildCollectionGroups([
            entry({ id: 'g1', type: 'game', collection: 'IP' }),
            entry({ id: 'b1', type: 'book', collection: 'IP' }),
            entry({ id: 'm1', type: 'movie', collection: 'IP' }),
        ]);
        expect(groups[0].rows.map((r) => r.type)).toEqual(['movie', 'book', 'game']);
    });

    it('🔴 卡片顺序 = 该 IP 首次出现的位置（⛔ 不再按字典序重排）', () => {
        const groups = buildCollectionGroups([
            entry({ id: 'z1', collection: 'Zeta' }),
            entry({ id: 'a1', collection: 'Alpha' }),
            entry({ id: 'z2', collection: 'Zeta' }),
        ]);
        expect(groups.map((g) => g.name)).toEqual(['Zeta', 'Alpha']);
        expect(groups[0].count).toBe(2);
    });

    it('合集名归一：大小写 / 首尾空格 / 连续空白视为同一 IP', () => {
        const groups = buildCollectionGroups([
            entry({ id: 's1', collection: 'Bear  Story' }),
            entry({ id: 's2', collection: ' bear story ' }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].count).toBe(2);
    });

    it('🔴 没填「归属合集」的条目直接跳过（⛔ 不再降级成单条卡）', () => {
        // 旧口径会把每个条目都变成一张「合集」卡 ⇒ 整个库变卡片墙，用户否掉了。
        const groups = buildCollectionGroups([entry({ id: 'solo1', title: '奥本海默' })]);
        expect(groups).toEqual([]);
    });

    it('没填合集的条目与填了的混在一起时，只出填了的那些', () => {
        const groups = buildCollectionGroups([
            entry({ id: 'x1', title: '同名' }),
            entry({ id: 'x2', title: '同名' }),
            entry({ id: 'c1', collection: 'IP' }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].name).toBe('IP');
    });

    it('行内条目按系列序号排（与系列折叠卡同一口径）', () => {
        const groups = buildCollectionGroups([
            entry({ id: 'e3', collection: 'S', seriesIndex: 3, title: '三' }),
            entry({ id: 'e1', collection: 'S', seriesIndex: 1, title: '一' }),
            entry({ id: 'e2', collection: 'S', seriesIndex: 2, title: '二' }),
        ]);
        expect(groups[0].rows[0].items.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    });

    it('空输入 ⇒ 空数组', () => {
        expect(buildCollectionGroups([])).toEqual([]);
    });

    it('ipKeyOf：只有真填了「归属合集」才给键', () => {
        expect(ipKeyOf({ collection: ' 熊出没 ' })).toBe('熊出没');
        expect(ipKeyOf({ collection: '   ' })).toBeNull();
        expect(ipKeyOf({})).toBeNull();
        expect(ipKeyOf(null)).toBeNull();
        // 只有 series 不给键 —— 口径由用户 2026-11-24 裁定
        expect(ipKeyOf({ collection: undefined })).toBeNull();
    });

    it('collectionSubtitleOf：单类型只说部数，多类型补「N 种类型」', () => {
        const one = buildCollectionGroups([entry({ id: 'a', collection: 'IP' })]);
        expect(collectionSubtitleOf(one[0])).toBe('1 部');
        const multi = buildCollectionGroups([
            entry({ id: 'a', collection: 'IP' }),
            entry({ id: 'b', collection: 'IP', type: 'anime' }),
        ]);
        expect(collectionSubtitleOf(multi[0])).toBe('2 部 · 2 种类型');
    });
});

// 2026-11-25 用户：「（可勾选隐藏）**默认视图** `[系统内置]`…（可勾选隐藏）**合集视图** `[系统内置]`」
// ⇒ 「隐藏」与「删除」是两件事：内置视图不许删，但可以藏；藏起来的意图必须落盘并能读回来。
describe('MediaView.hidden（隐藏 ≠ 删除，内置视图也能藏）', () => {
    // 🔴 2026-11-14 用户逐字：「分类视图，用户初始**仅勾选默认视图**，不再勾选合集视图」
    //    ⇒ 出厂态：默认视图可见、合集视图隐藏。老 catalog 没这个字段时也必须落到**这个**出厂态。
    it('出厂态：默认视图可见、合集视图隐藏（老 catalog 没有这个字段也照样）', () => {
        const views = normalizeViews([{ id: 'v_1', name: '工作', kind: 'custom', tags: ['工作'] }]);
        expect(viewIsVisible(views.find((v) => v.id === DEFAULT_VIEW_ID))).toBe(true);
        expect(viewIsVisible(views.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(false);
        // 自定义视图不欠谁一个 hidden，缺省照旧可见
        expect(viewIsVisible(views.find((v) => v.id === 'v_1'))).toBe(true);
        expect(visibleViews(views).map((v) => v.id)).toEqual([DEFAULT_VIEW_ID, 'v_1']);
    });

    it('用户把合集视图勾回来 ⇒ 显式 hidden:false 落盘，读回来仍是勾上的', () => {
        const raw = [{ id: COLLECTION_VIEW_ID, hidden: false }];
        const once = normalizeViews(raw);
        expect(viewIsVisible(once.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(true);
        const stored = viewsForStorage(raw);
        expect(stored?.find((v) => v.id === COLLECTION_VIEW_ID)?.hidden).toBe(false);
        const again = normalizeViews(stored);
        expect(viewIsVisible(again.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(true);
    });

    it('🔴 勾回的偏好要能活过「再存一次」：normalizeViews 必须保留显式 hidden:false', () => {
        // 现场 bug（2026-11-14 实测）：`normalizeViews` 读到 `hidden: false` 时把它 `delete` 掉，
        // 于是「用户勾回来」与「从来没人动过」在内存里长得一模一样 ⇒ 下一次保存
        // `viewsForStorage` 判「与出厂相同」⇒ 静默丢掉这条偏好 ⇒ 重开插件又变回不勾。
        const once = normalizeViews([{ id: COLLECTION_VIEW_ID, hidden: false }]);
        const coll = once.find((v) => v.id === COLLECTION_VIEW_ID);
        expect(coll?.hidden).toBe(false); // ← 必须是显式 false，不是 undefined
        // 第二轮：把归一结果再喂给落盘（模拟「load 之后又 save」）
        const stored2 = viewsForStorage(once);
        expect(stored2?.find((v) => v.id === COLLECTION_VIEW_ID)?.hidden).toBe(false);
        // 第三轮：再读再存仍然保得住（幂等，⛔ 只撑过一轮不算）
        const third = viewsForStorage(normalizeViews(stored2));
        expect(third?.find((v) => v.id === COLLECTION_VIEW_ID)?.hidden).toBe(false);
    });

    it('🔴 默认视图显式 hidden:false 与出厂态相同 ⇒ 照样不落盘（不给存量库添键）', () => {
        expect(viewsForStorage([{ id: DEFAULT_VIEW_ID, hidden: false }])).toBeUndefined();
        expect(viewsForStorage(normalizeViews([{ id: DEFAULT_VIEW_ID, hidden: false }]))).toBeUndefined();
    });

    it('内置默认视图：name/kind 按常量重造，但 hidden 必须从输入读回来', () => {
        const views = normalizeViews([{ id: DEFAULT_VIEW_ID, name: '被我改坏了', kind: 'custom', hidden: true }]);
        const def = views[0];
        expect(def.id).toBe(DEFAULT_VIEW_ID);
        expect(def.name).toBe(DEFAULT_VIEW_NAME); // 名字忽略输入
        expect(def.kind).toBe('default'); // 种类忽略输入
        expect(def.hidden).toBe(true); // ← 只有这一项听用户的
        expect(viewIsVisible(def)).toBe(false);
        expect(visibleViews(views).some((v) => v.id === DEFAULT_VIEW_ID)).toBe(false);
    });

    it('内置合集视图：同样只搬 hidden，types/tags 一律忽略', () => {
        const views = normalizeViews([
            { id: COLLECTION_VIEW_ID, name: '冒充', kind: 'custom', types: ['movie'], tags: ['工作'], hidden: true },
        ]);
        const coll = views.find((v) => v.id === COLLECTION_VIEW_ID);
        expect(coll).toBeTruthy();
        expect(coll!.name).toBe(COLLECTION_VIEW_NAME);
        expect(coll!.kind).toBe('collection');
        expect(coll!.types).toEqual([]);
        expect(coll!.tags).toEqual([]);
        expect(coll!.hidden).toBe(true);
    });

    it('只有明确的 true 才算隐藏：字符串 "false" / 1 / null 都是脏值 ⇒ 可见', () => {
        for (const bad of ['false', 'true', 1, 0, null, undefined, {}]) {
            const v = normalizeMediaView({ id: 'v_1', name: '工作', hidden: bad });
            expect(v).toBeTruthy();
            expect(viewIsVisible(v!)).toBe(true);
        }
    });

    it('自定义视图的 hidden 也照样落盘、读回不漂（幂等）', () => {
        const raw = [{ id: 'v_1', name: '工作', kind: 'custom', tags: ['工作'], hidden: true }];
        const once = normalizeViews(raw);
        const stored = viewsForStorage(raw);
        expect(stored?.find((v) => v.id === 'v_1')?.hidden).toBe(true);
        const again = normalizeViews(stored);
        expect(again.find((v) => v.id === 'v_1')?.hidden).toBe(true);
        expect(again.map((v) => v.id)).toEqual(once.map((v) => v.id));
    });

    it('内置视图没藏 + 没有自定义视图 ⇒ 仍然不写 views 键（不污染存量 catalog）', () => {
        expect(viewsForStorage(undefined)).toBeUndefined();
        expect(viewsForStorage([])).toBeUndefined();
        expect(viewsForStorage([{ id: DEFAULT_VIEW_ID, name: DEFAULT_VIEW_NAME, kind: 'default' }])).toBeUndefined();
    });

    it('藏了内置视图 ⇒ 只为「被藏的那条」写存根，且读回来仍是隐藏', () => {
        // 🔴 2026-11-14：合集视图**出厂就隐藏**，所以「藏它」= 出厂态 = 不值一条存根；
        //    真正需要落盘的是「默认视图被藏」和「合集视图被勾回来」，两条都验。
        const stored = viewsForStorage([{ id: DEFAULT_VIEW_ID, hidden: true }]);
        expect(stored).toHaveLength(1);
        expect(stored![0].id).toBe(DEFAULT_VIEW_ID);
        expect(stored![0].hidden).toBe(true);
        // 读回来：默认视图仍隐藏，合集视图保持出厂隐藏
        const back = normalizeViews(stored);
        expect(back.find((v) => v.id === DEFAULT_VIEW_ID)?.hidden).toBe(true);
        expect(viewIsVisible(back.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(false);
    });

    it('合集视图保持出厂隐藏 ⇒ 不写存根（⛔ 别给存量 catalog 凭空添一条）', () => {
        expect(viewsForStorage([{ id: COLLECTION_VIEW_ID, hidden: true }])).toBeUndefined();
    });

    it('全被藏起来 ⇒ visibleViews 返回空数组（首页切换栏自动不渲染），不做「至少留一条」兜底', () => {
        const views = normalizeViews([
            { id: DEFAULT_VIEW_ID, hidden: true },
            { id: COLLECTION_VIEW_ID, hidden: true },
        ]);
        expect(views).toHaveLength(2);
        expect(visibleViews(views)).toEqual([]);
    });});

// 2026-11-26（m05012）用户：「用户自定义视图可选择现有的文学网文漫画动画剧集电影游戏音乐可选展示」
// ⇒ 文学/网文/漫画 是书籍的**子分类**（BookKind），不是主类型 ⇒ 视图多出一维 `bookKinds`。
describe('VIEW_TYPE_CHOICES（八项选择器：文学/网文/漫画 + 五个主类型）', () => {
    it('顺序就是用户点名的顺序，⛔ 不动字母序 / ENTRY_TYPES 序', () => {
        expect(VIEW_TYPE_CHOICES.map((c) => c.label)).toEqual([
            '文学',
            '网文',
            '漫画',
            '动画',
            '剧集',
            '电影',
            '游戏',
            '音乐',
        ]);
    });

    it('书籍三项 key 带 book: 前缀，其余等于主类型名（⛔ 别用裸 bookKind 当 key）', () => {
        expect(VIEW_TYPE_CHOICES.map((c) => c.key)).toEqual([
            'book:book',
            'book:novel',
            'book:comic',
            'anime',
            'tv',
            'movie',
            'game',
            'music',
        ]);
    });

    it('书籍三项共享同一个主类型 book，只有它们带 bookKind', () => {
        for (const c of VIEW_TYPE_CHOICES) {
            if (c.key.startsWith('book:')) {
                expect(c.type).toBe('book');
                expect(c.bookKind).toBeTruthy();
            } else {
                expect(c.bookKind).toBeUndefined();
            }
        }
    });
});

describe('viewSelectionOf / viewSelectionPatch（勾选态 ↔ types+bookKinds 逆运算）', () => {
    const view = (raw: Partial<MediaView>): MediaView => ({
        id: 'v_1',
        name: '工作',
        kind: 'custom',
        types: [],
        tags: ['工作'],
        ...raw,
    });

    it('空 types（不限）⇒ 一项都不勾（不是「全勾」）', () => {
        expect(viewSelectionOf(view({ types: [] }))).toEqual([]);
    });

    it('book 在 types 里但没有 bookKinds ⇒ **三个子分类全勾**（老视图不能因新维度上线悄悄缩水）', () => {
        expect(viewSelectionOf(view({ types: ['book'] }))).toEqual(['book:book', 'book:novel', 'book:comic']);
    });

    it('book 不在 types 里 ⇒ 三个子分类都不勾，即使残留 bookKinds', () => {
        expect(viewSelectionOf(view({ types: ['movie'], bookKinds: ['novel'] }))).toEqual(['movie']);
    });

    it('明确限定子分类 ⇒ 只勾选中的那几项', () => {
        expect(viewSelectionOf(view({ types: ['book'], bookKinds: ['novel'] }))).toEqual(['book:novel']);
        expect(viewSelectionOf(view({ types: ['book'], bookKinds: ['book', 'comic'] }))).toEqual(['book:book', 'book:comic']);
    });

    it('三个子分类全选 ⇒ bookKinds 存空（= 不限子分类，将来新增子分类自动收录）', () => {
        const patch = viewSelectionPatch(['book:book', 'book:novel', 'book:comic']);
        expect(patch.types).toEqual(['book']);
        expect(patch.bookKinds).toEqual([]);
    });

    it('只选一个子分类 ⇒ types 含 book 且 bookKinds 只有它', () => {
        expect(viewSelectionPatch(['book:comic'])).toEqual({ types: ['book'], bookKinds: ['comic'] });
    });

    it('一个书籍项都没选 ⇒ types 不含 book 且 bookKinds 清空', () => {
        expect(viewSelectionPatch(['movie', 'anime'])).toEqual({ types: ['movie', 'anime'], bookKinds: [] });
        expect(viewSelectionPatch([])).toEqual({ types: [], bookKinds: [] });
    });

    it('逆运算闭环：patch → of 回到同一组键（幂等，读盘/写盘不漂）', () => {
        for (const keys of [
            [],
            ['movie'],
            ['book:book'],
            ['book:novel', 'book:comic'],
            ['book:book', 'book:novel', 'book:comic'],
            ['book:book', 'book:novel', 'book:comic', 'game', 'music'],
        ]) {
            const patch = viewSelectionPatch(keys);
            expect(viewSelectionOf(view(patch))).toEqual(keys);
        }
    });

    it('非法键被丢掉（过归一器，不报错）', () => {
        expect(viewSelectionPatch(['movie', 'book:drama', 'nope'])).toEqual({ types: ['movie'], bookKinds: [] });
    });
});

describe('normalizeViewBookKinds / 落盘往返', () => {
    it('只认合法 BookKind，去重后按 BOOK_KINDS 固定序排', () => {
        expect(normalizeViewBookKinds(['comic', 'book', 'comic'])).toEqual(['book', 'comic']);
        expect(normalizeViewBookKinds(['drama', 1, null])).toEqual([]);
        expect(normalizeViewBookKinds(undefined)).toEqual([]);
    });

    it('types 不含 book ⇒ bookKinds 不落键（防「再勾上书籍时继承老配置」）', () => {
        const v = normalizeMediaView({ id: 'v_1', name: '工作', types: ['movie'], bookKinds: ['novel'] });
        expect(v?.bookKinds).toBeUndefined();
    });

    it('types 含 book + 有限定 ⇒ 落键；空数组不落键（= 不限）', () => {
        expect(normalizeMediaView({ id: 'v_1', name: '工作', types: ['book'], bookKinds: ['novel'] })?.bookKinds).toEqual([
            'novel',
        ]);
        expect(normalizeMediaView({ id: 'v_1', name: '工作', types: ['book'], bookKinds: [] })?.bookKinds).toBeUndefined();
    });

    it('落盘再读回不漂（幂等）', () => {
        const raw = [{ id: 'v_1', name: '网文库', kind: 'custom', types: ['book'], bookKinds: ['novel'], tags: ['网文'] }];
        const once = normalizeViews(raw);
        const again = normalizeViews(viewsForStorage(raw));
        expect(again.find((v) => v.id === 'v_1')?.bookKinds).toEqual(['novel']);
        expect(again.find((v) => v.id === 'v_1')?.types).toEqual(once.find((v) => v.id === 'v_1')?.types);
    });
});

describe('viewMatchesEntry 的书籍子分类那一维', () => {
    // ⚠️ 这些夹具刻意用 `kind: 'default'`（只按类型判）：`custom` 还要过标签白名单，
    //    空标签 ⇒ 谁也不命中 —— 那会掩盖掉本该被测的 bookKinds 那一维。
    it('限定了 novel ⇒ 文学/漫画不进，网文进（缺省 bookKind 视为 book）', () => {
        const v = { id: 'v_1', name: '网文', kind: 'default' as const, types: ['book' as const], bookKinds: ['novel' as const], tags: [] };
        expect(filterForView([entry({ id: 'a', type: 'book', bookKind: 'novel' })], v)).toHaveLength(1);
        expect(filterForView([entry({ id: 'b', type: 'book', bookKind: 'comic' })], v)).toHaveLength(0);
        // 缺省 bookKind 归一成 'book' ⇒ 不是网文
        expect(filterForView([entry({ id: 'c', type: 'book' })], v)).toHaveLength(0);
    });

    it('bookKinds 为空/缺省 ⇒ 三种书籍全收（老视图行为一字未变）', () => {
        const v = { id: 'v_1', name: '书', kind: 'default' as const, types: ['book' as const], tags: [] };
        const all = [
            entry({ id: 'a', type: 'book', bookKind: 'book' }),
            entry({ id: 'b', type: 'book', bookKind: 'novel' }),
            entry({ id: 'c', type: 'book', bookKind: 'comic' }),
            entry({ id: 'd', type: 'book' }),
        ];
        expect(filterForView(all, v)).toHaveLength(4);
    });

    it('非书籍条目不受 bookKinds 影响', () => {
        const v = { id: 'v_1', name: '混', kind: 'default' as const, types: [], bookKinds: ['novel' as const], tags: [] };
        expect(filterForView([entry({ id: 'm', type: 'movie' })], v)).toHaveLength(1);
    });
});

describe('viewBookKindPool（给 MediaList.kindFilter 用）', () => {
    it('不收书籍的视图 ⇒ null（不该顺手锁死书籍子分类下拉）', () => {
        expect(viewBookKindPool({ id: 'v_1', name: 'x', kind: 'custom', types: ['movie'], tags: [] })).toBeNull();
    });

    it('收书籍但没限子分类 ⇒ null（= 不限）', () => {
        expect(viewBookKindPool({ id: 'v_1', name: 'x', kind: 'custom', types: ['book'], tags: [] })).toBeNull();
    });

    it('限定了 ⇒ 返回副本（调用方改了不污染视图对象）', () => {
        const src = { id: 'v_1', name: 'x', kind: 'custom' as const, types: ['book' as const], bookKinds: ['novel' as const], tags: [] };
        const pool = viewBookKindPool(src);
        expect(pool).toEqual(['novel']);
        pool!.push('comic');
        expect(src.bookKinds).toEqual(['novel']);
    });
});
