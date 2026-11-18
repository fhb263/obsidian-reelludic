// 主视图一级页签真源（pure/homeTabs）—— 守四件「两处不许各写一份」的事：
//   ① **顺序**：顶部胶囊与左侧侧边栏共用同一份（换布局不该换顺序）
//   ② **文案**：页签显示名只有一份（文学/网文/漫画 来自 `BOOK_KIND_LABELS`，其余走 `ENTRY_TYPE_LABELS`）
//   ③ **图标**：写错名字 `setIcon` 会**静默失败**（空白图标、无任何报错）
//   ④ **翻译**：页签 → 承载组件参数（`tabLockType` / `tabBookKind`）/ 条目过滤（`tabMatchesEntry`）
// 外加「起始页」设置的归一与**升级映射**。
//
// 🔴🔴 2026-11-08（用户 m03712）**整套口径换过**，本文件随之重写：
//    原口径 = 6 枚页签（计划 / 阅读 / 影视 / 游戏 / 音乐 / 统计），其中「阅读」「影视」是**聚合**
//    新口径 = 10 枚页签，**全部单类型**，且文学 / 网文 / 漫画 是书籍子分类（`kind:` 前缀）：
//      计划 → 文学 → 网文 → 漫画 → 电影 → 剧集 → 动画 → 游戏 → 音乐 → 统计
//    ⛔ 别再按老口径断言「只勾电影+剧集 ⇒ 计划 / 影视 / 统计」——「影视」聚合页签已被用户明确否掉。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CLASSIC_TAB_ORDER,
    HOME_TAB_ORDER,
    MEDIA_TYPES,
    TAB_AXES,
    TAB_AXIS_LABELS,
    bookKindOfTab,
    equivalentTabFor,
    homeTabIcon,
    homeTabLabel,
    isBookKindTab,
    isNavTab,
    isNavTabIn,
    normalizeStartTab,
    normalizeStartTabFor,
    normalizeTabAxis,
    resolveVisibleTab,
    tabBookKind,
    tabLockType,
    tabMatchesEntry,
    tabOrderFor,
    tabRequiresTypes,
    visibleTabs,
} from 'pure/homeTabs';

describe('homeTabs（#541 主视图页签真源）', () => {
    it('🔴 顺序固定：计划 → 文学 → 网文 → 漫画 → 电影 → 剧集 → 动画 → 游戏 → 音乐 → 统计（两种布局共用）', () => {
        expect(HOME_TAB_ORDER).toEqual([
            'tracking',
            'kind:book',
            'kind:novel',
            'kind:comic',
            'movie',
            'tv',
            'anime',
            'game',
            'music',
            'stats',
        ]);
    });

    it('🔴 已无「影视」「阅读」两个聚合页签（用户 2026-11-08 明确否掉聚合、要求摊开）', () => {
        expect(HOME_TAB_ORDER).not.toContain('media');
        expect(HOME_TAB_ORDER).not.toContain('book');
    });

    it('🔴 显示名 = 用户点名的 10 项', () => {
        expect(HOME_TAB_ORDER.map((t) => homeTabLabel(t))).toEqual([
            '计划',
            '文学',
            '网文',
            '漫画',
            '电影',
            '剧集',
            '动画',
            '游戏',
            '音乐',
            '统计',
        ]);
    });

    it('历史值仍能显示成人话（老库 data.json 里还存着它们）', () => {
        expect(homeTabLabel('media')).toBe('影视');
        expect(homeTabLabel('book')).toBe('阅读');
    });

    it('非导航类型仍走 ENTRY_TYPE_LABELS（页签专用名不得外溢）', () => {
        expect(homeTabLabel('anime')).toBe('动画');
        expect(homeTabLabel('tv')).toBe('剧集');
        expect(homeTabLabel('movie')).toBe('电影');
    });

    it('每个导航页签都有非空图标名，且 10 枚互不相同', () => {
        const icons = HOME_TAB_ORDER.map((t) => homeTabIcon(t));
        expect(icons.every((i) => i.length > 0)).toBe(true);
        expect(new Set(icons).size).toBe(icons.length);
    });

    it('未知页签的图标兜底非空（⛔ 不许返回空串 —— setIcon 会静默失败）', () => {
        expect(homeTabIcon('kind:zzz' as never).length).toBeGreaterThan(0);
    });

    it('🔴 起始页归一：只认导航里真有的 id', () => {
        for (const t of HOME_TAB_ORDER) expect(normalizeStartTab(t)).toBe(t);
    });

    it('🔴 升级映射：历史 media → movie、历史 book → kind:book（老用户升级后不该被弹到别的页）', () => {
        expect(normalizeStartTab('media')).toBe('movie');
        expect(normalizeStartTab('book')).toBe('kind:book');
    });

    it('🔴 起始页兜底 = movie（历史缺省 media 的映射结果）：脏数据 / 缺省一律回它', () => {
        expect(normalizeStartTab('nope')).toBe('movie');
        expect(normalizeStartTab('')).toBe('movie');
        expect(normalizeStartTab(undefined)).toBe('movie');
        expect(normalizeStartTab(null)).toBe('movie');
        expect(normalizeStartTab(3)).toBe('movie');
        expect(normalizeStartTab({ tab: 'book' })).toBe('movie');
        // ⚠️ 大小写不同即视为脏数据（不做 toLowerCase 容错 —— 那会把 'BOOK' 也放进来）
        expect(normalizeStartTab('Book')).toBe('movie');
    });

    it('isNavTab：只有 10 个当前导航 id 为真；历史聚合值不算', () => {
        expect(isNavTab('stats')).toBe(true);
        expect(isNavTab('kind:novel')).toBe(true);
        expect(isNavTab('anime')).toBe(true);
        expect(isNavTab('media')).toBe(false);
        expect(isNavTab('book')).toBe(false);
        expect(isNavTab('kind:zzz')).toBe(false);
        expect(isNavTab(undefined)).toBe(false);
        expect(isNavTab('')).toBe(false);
    });

    // ── 子分类页签的解析 ────────────────────────────────────────────────────────
    describe('书籍子分类页签（kind: 前缀）', () => {
        it('isBookKindTab 只认 kind: 前缀', () => {
            expect(isBookKindTab('kind:book')).toBe(true);
            expect(isBookKindTab('kind:novel')).toBe(true);
            expect(isBookKindTab('kind:comic')).toBe(true);
            expect(isBookKindTab('book')).toBe(false);
            expect(isBookKindTab('movie')).toBe(false);
        });

        it('bookKindOfTab 解析出 BookKind；非法子分类返回 null（⛔ 不把 kind:zzz 当合法）', () => {
            expect(bookKindOfTab('kind:book')).toBe('book');
            expect(bookKindOfTab('kind:novel')).toBe('novel');
            expect(bookKindOfTab('kind:comic')).toBe('comic');
            expect(bookKindOfTab('kind:zzz' as never)).toBeNull();
            expect(bookKindOfTab('movie')).toBeNull();
            expect(bookKindOfTab('tracking')).toBeNull();
        });

        it('🔴 kind:book 与旧的书籍整类页签 book 不是同一个值（防语义混淆）', () => {
            expect('kind:book' === ('book' as string)).toBe(false);
            expect(bookKindOfTab('kind:book')).toBe('book');
            expect(bookKindOfTab('book' as never)).toBeNull();
        });
    });

    // ── 页签 → 承载组件参数 ─────────────────────────────────────────────────────
    describe('tabLockType / tabBookKind（页签 → MediaList 受控参数）', () => {
        it('普通类型页签 ⇒ 锁自己，且不锁子分类', () => {
            expect(tabLockType('movie')).toBe('movie');
            expect(tabLockType('tv')).toBe('tv');
            expect(tabLockType('anime')).toBe('anime');
            expect(tabLockType('game')).toBe('game');
            expect(tabLockType('music')).toBe('music');
            expect(tabBookKind('movie')).toBeNull();
            expect(tabBookKind('game')).toBeNull();
        });

        it('🔴 三枚书籍子分类页签 ⇒ 一律锁 book，子分类走第二条通道', () => {
            expect(tabLockType('kind:book')).toBe('book');
            expect(tabLockType('kind:novel')).toBe('book');
            expect(tabLockType('kind:comic')).toBe('book');
            expect(tabBookKind('kind:book')).toBe('book');
            expect(tabBookKind('kind:novel')).toBe('novel');
            expect(tabBookKind('kind:comic')).toBe('comic');
        });

        it('🔴 子分类页签的 lockType ⛔ 不许漏出 kind:* 值（MediaList.lockType 只认 EntryType）', () => {
            for (const t of HOME_TAB_ORDER) {
                const lt = tabLockType(t);
                expect(lt === null || !String(lt).startsWith('kind:')).toBe(true);
            }
        });

        it('非条目页签（计划 / 统计）⇒ 两个通道都不锁', () => {
            expect(tabLockType('tracking')).toBeNull();
            expect(tabLockType('stats')).toBeNull();
            expect(tabBookKind('tracking')).toBeNull();
            expect(tabBookKind('stats')).toBeNull();
        });

        it('历史聚合页签 media ⇒ 不锁类型（影视整类）', () => {
            expect(tabLockType('media')).toBeNull();
            expect(tabBookKind('media')).toBeNull();
        });
    });

    // ── 页签 → 条目是否属于这一屏 ───────────────────────────────────────────────
    describe('tabMatchesEntry（页签 → 条目归属）', () => {
        it('类型页签按 type 相等', () => {
            expect(tabMatchesEntry('movie', { type: 'movie' })).toBe(true);
            expect(tabMatchesEntry('movie', { type: 'tv' })).toBe(false);
            expect(tabMatchesEntry('game', { type: 'game' })).toBe(true);
        });

        it('🔴 子分类页签只收该子分类的书（未标注 bookKind 的存量书按文学算）', () => {
            expect(tabMatchesEntry('kind:book', { type: 'book' })).toBe(true);
            expect(tabMatchesEntry('kind:book', { type: 'book', bookKind: 'book' })).toBe(true);
            expect(tabMatchesEntry('kind:book', { type: 'book', bookKind: 'novel' })).toBe(false);
            expect(tabMatchesEntry('kind:novel', { type: 'book', bookKind: 'novel' })).toBe(true);
            expect(tabMatchesEntry('kind:novel', { type: 'book' })).toBe(false);
            expect(tabMatchesEntry('kind:comic', { type: 'book', bookKind: 'comic' })).toBe(true);
        });

        it('🔴 子分类页签⛔ 不许把非书籍条目收进来（type 先判）', () => {
            expect(tabMatchesEntry('kind:novel', { type: 'movie', bookKind: 'novel' })).toBe(false);
            expect(tabMatchesEntry('kind:book', { type: 'music' })).toBe(false);
        });

        it('历史聚合页签 media ⇒ 影视三型', () => {
            expect(tabMatchesEntry('media', { type: 'movie' })).toBe(true);
            expect(tabMatchesEntry('media', { type: 'tv' })).toBe(true);
            expect(tabMatchesEntry('media', { type: 'anime' })).toBe(true);
            expect(tabMatchesEntry('media', { type: 'game' })).toBe(false);
        });

        it('计划 / 统计不由列表承载 ⇒ 恒 false（误喂进来时表现为空列表，而不是全量透出）', () => {
            expect(tabMatchesEntry('tracking', { type: 'movie' })).toBe(false);
            expect(tabMatchesEntry('stats', { type: 'book' })).toBe(false);
        });
    });

    // ── #727 页签按视图勾选的类型过滤 ───────────────────────────────────────────
    describe('visibleTabs（视图池 → 可见页签）', () => {
        it('🔴 视图池为 null（默认视图 / 没配类型）⇒ 十枚原样全显示', () => {
            expect(visibleTabs(null)).toEqual([...HOME_TAB_ORDER]);
            expect(visibleTabs(undefined)).toEqual([...HOME_TAB_ORDER]);
        });

        it('🔴 只勾电影+剧集 ⇒ 计划 / 电影 / 剧集 / 统计（⛔ 不再有「影视」聚合页）', () => {
            expect(visibleTabs(['movie', 'tv'])).toEqual(['tracking', 'movie', 'tv', 'stats']);
        });

        it('只勾电影 / 只勾剧集 / 只勾动画 ⇒ 各自单枚（摊开后不再互相带出）', () => {
            expect(visibleTabs(['movie'])).toEqual(['tracking', 'movie', 'stats']);
            expect(visibleTabs(['tv'])).toEqual(['tracking', 'tv', 'stats']);
            expect(visibleTabs(['anime'])).toEqual(['tracking', 'anime', 'stats']);
        });

        it('🔴 只勾书籍且未限定子分类 ⇒ 计划 / 文学 / 网文 / 漫画 / 统计（三枚全摊开）', () => {
            expect(visibleTabs(['book'])).toEqual(['tracking', 'kind:book', 'kind:novel', 'kind:comic', 'stats']);
        });

        it('🔴 只勾书籍且只勾「网文」子分类 ⇒ 只摊出网文那一枚', () => {
            expect(visibleTabs(['book'], ['novel'])).toEqual(['tracking', 'kind:novel', 'stats']);
            expect(visibleTabs(['book'], ['book', 'comic'])).toEqual(['tracking', 'kind:book', 'kind:comic', 'stats']);
        });

        it('🔴 池里没有 book 时，即便 bookKindPool 非空也不出现书籍页签（类型那关先拦）', () => {
            expect(visibleTabs(['movie'], ['novel'])).toEqual(['tracking', 'movie', 'stats']);
        });

        it('子分类过滤只管子分类页签，不影响其它页签', () => {
            expect(visibleTabs(['movie', 'book'], ['comic'])).toEqual(['tracking', 'kind:comic', 'movie', 'stats']);
        });

        it('十种全勾（三个子分类全选）⇒ 与全量一致（过滤只做减法，不重排）', () => {
            expect(visibleTabs(['anime', 'tv', 'movie', 'book', 'game', 'music'], ['book', 'novel', 'comic'])).toEqual([
                ...HOME_TAB_ORDER,
            ]);
        });

        it('🔴 计划 / 统计恒常驻：池里全是不相关的类型也不会把它们藏掉', () => {
            const got = visibleTabs(['music']);
            expect(got).toContain('tracking');
            expect(got).toContain('stats');
            expect(got).toEqual(['tracking', 'music', 'stats']);
        });

        it('🔴 永远不为空（计划/统计常驻）—— 否则顶部导航整排消失', () => {
            expect(visibleTabs([]).length).toBeGreaterThan(0);
            expect(visibleTabs([], []).length).toBeGreaterThan(0);
        });

        it('顺序恒为 HOME_TAB_ORDER 的子序列（只删不换位）', () => {
            const got = visibleTabs(['game', 'book'], ['comic', 'book']);
            const idx = got.map((t) => HOME_TAB_ORDER.indexOf(t));
            expect(idx).toEqual([...idx].sort((a, b) => a - b));
        });

        it('MEDIA_TYPES 真源 = 动画/剧集/电影（views/tab 只是再导出；页签不再用它聚合，但它仍是「影视」口径）', () => {
            expect(MEDIA_TYPES).toEqual(['anime', 'tv', 'movie']);
        });
    });

    describe('resolveVisibleTab（当前页签被过滤掉的兜底）', () => {
        it('仍可见 ⇒ 原样返回（不打断正常切页）', () => {
            const tabs = visibleTabs(['movie', 'tv']);
            expect(resolveVisibleTab(tabs, 'movie')).toBe('movie');
            expect(resolveVisibleTab(tabs, 'tracking')).toBe('tracking');
        });

        it('🔴 不可见 ⇒ 落到第一枚可见页签（典型：停在「游戏」但视图只收影视）', () => {
            const tabs = visibleTabs(['movie', 'tv']);
            expect(tabs).toEqual(['tracking', 'movie', 'tv', 'stats']);
            expect(resolveVisibleTab(tabs, 'game')).toBe('tracking');
            expect(resolveVisibleTab(tabs, 'music')).toBe('tracking');
        });

        it('🔴 停在「网文」但视图只勾了「漫画」子分类 ⇒ 落到第一枚（其自身不可见）', () => {
            const tabs = visibleTabs(['book'], ['comic']);
            expect(tabs).toEqual(['tracking', 'kind:comic', 'stats']);
            expect(resolveVisibleTab(tabs, 'kind:novel')).toBe('tracking');
        });

        it('全量时任何页签都原样返回', () => {
            const tabs = visibleTabs(null);
            for (const t of HOME_TAB_ORDER) expect(resolveVisibleTab(tabs, t)).toBe(t);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 用户 m09565 ①-4：页签分类轴（全类型十枚 ↔ 聚合六枚）
//
// 用户逐字：「设置页基本设置加个启用顶部胶囊/文字菜单则按全类型分页签，关闭则按
// 计划、阅读、影视、音乐、游戏、统计分页签（**两种模式的导航状态（当前选中项）要独立保存**，
// 切换开关时不要丢失各自的位置）」
//
// 本文件只锁**纯函数层**：轴归一、两套顺序、换轴时页签怎么折、起始页怎么归、可见性怎么算。
// 「两条轴各自记到哪」是 `main.ts` 的 `homeTabByAxis`，那属于状态机，不在这一层测。
// ─────────────────────────────────────────────────────────────────────────────
describe('homeTabs · 分类轴（m09565 ①-4）', () => {
    describe('normalizeTabAxis（脏值不许换脸）', () => {
        it('只认 classic，其余一律 expanded', () => {
            expect(normalizeTabAxis('classic')).toBe('classic');
            expect(normalizeTabAxis('expanded')).toBe('expanded');
            // ⛔ 缺省必须是 expanded：升级后观感不许变（回退成六枚 = 升级即换脸）
            expect(normalizeTabAxis(undefined)).toBe('expanded');
            expect(normalizeTabAxis(null)).toBe('expanded');
            expect(normalizeTabAxis('')).toBe('expanded');
            expect(normalizeTabAxis('CLASSIC')).toBe('expanded');
            expect(normalizeTabAxis(1)).toBe('expanded');
            expect(normalizeTabAxis({})).toBe('expanded');
        });

        it('TAB_AXES 的每一项都能被归一原样认回（常量与归一函数不许漂）', () => {
            for (const a of TAB_AXES) expect(normalizeTabAxis(a)).toBe(a);
            expect(TAB_AXES).toEqual(['expanded', 'classic']);
        });

        it('两条轴都有文案，且两句话不同（否则开关上分不清哪头是哪头）', () => {
            expect(TAB_AXIS_LABELS.expanded).toBeTruthy();
            expect(TAB_AXIS_LABELS.classic).toBeTruthy();
            expect(TAB_AXIS_LABELS.expanded).not.toBe(TAB_AXIS_LABELS.classic);
        });
    });

    describe('tabOrderFor / CLASSIC_TAB_ORDER（顺序 = 用户逐字给的）', () => {
        it('🔴 聚合六枚顺序：计划 → 阅读 → 影视 → 音乐 → 游戏 → 统计', () => {
            expect(CLASSIC_TAB_ORDER).toEqual(['tracking', 'book', 'media', 'music', 'game', 'stats']);
        });

        it('expanded 走 HOME_TAB_ORDER，classic 走 CLASSIC_TAB_ORDER', () => {
            expect(tabOrderFor('expanded')).toBe(HOME_TAB_ORDER);
            expect(tabOrderFor('classic')).toBe(CLASSIC_TAB_ORDER);
        });

        it('⛔ 聚合轴不许出现书籍子分类与影视三型（那正是「摊开」与「聚合」的分界）', () => {
            for (const t of ['kind:book', 'kind:novel', 'kind:comic', 'movie', 'tv', 'anime'] as const) {
                expect(CLASSIC_TAB_ORDER as readonly string[]).not.toContain(t);
            }
            // 反向：摊开轴不许出现两个聚合值（否则「按类型分」就成了自相矛盾）
            for (const t of ['book', 'media'] as const) {
                expect(HOME_TAB_ORDER as readonly string[]).not.toContain(t);
            }
        });

        it('两套表都不重复，且都以「计划」打头、「统计」收尾', () => {
            for (const order of [HOME_TAB_ORDER, CLASSIC_TAB_ORDER]) {
                expect(new Set(order).size).toBe(order.length);
                expect(order[0]).toBe('tracking');
                expect(order[order.length - 1]).toBe('stats');
            }
        });
    });

    describe('equivalentTabFor（换轴时按语义就近折算，⛔ 不许落到 tabs[0]）', () => {
        it('→ classic：电影/剧集/动画 都折成「影视」', () => {
            for (const t of ['movie', 'tv', 'anime'] as const) {
                expect(equivalentTabFor('classic', t)).toBe('media');
            }
        });

        it('→ classic：文学/网文/漫画 都折成「阅读」', () => {
            for (const t of ['kind:book', 'kind:novel', 'kind:comic'] as const) {
                expect(equivalentTabFor('classic', t)).toBe('book');
            }
        });

        it('→ expanded：影视折成「电影」、阅读折成「文学」（与 normalizeStartTab 升级映射同口径）', () => {
            expect(equivalentTabFor('expanded', 'media')).toBe('movie');
            expect(equivalentTabFor('expanded', 'book')).toBe('kind:book');
        });

        it('🔴 计划/统计/音乐/游戏 两轴同名 ⇒ 原样返回（别把用户当前位置折走）', () => {
            for (const t of ['tracking', 'stats', 'music', 'game'] as const) {
                expect(equivalentTabFor('classic', t)).toBe(t);
                expect(equivalentTabFor('expanded', t)).toBe(t);
            }
        });

        it('本轴已合法的页签恒原样返回（幂等）', () => {
            for (const t of HOME_TAB_ORDER) expect(equivalentTabFor('expanded', t)).toBe(t);
            for (const t of CLASSIC_TAB_ORDER) expect(equivalentTabFor('classic', t)).toBe(t);
        });

        it('折算结果恒落在目标轴的顺序表里（⛔ 不许折出表外的值）', () => {
            for (const t of [...HOME_TAB_ORDER, ...CLASSIC_TAB_ORDER, 'media', 'book'] as const) {
                expect(tabOrderFor('classic') as readonly string[]).toContain(equivalentTabFor('classic', t));
                expect(tabOrderFor('expanded') as readonly string[]).toContain(equivalentTabFor('expanded', t));
            }
        });

        it('折算两次不动（折到本轴后再折一次还是它）', () => {
            for (const t of [...HOME_TAB_ORDER, ...CLASSIC_TAB_ORDER] as const) {
                for (const axis of TAB_AXES) {
                    const once = equivalentTabFor(axis, t);
                    expect(equivalentTabFor(axis, once)).toBe(once);
                }
            }
        });
    });

    describe('normalizeStartTabFor（先认值，再折轴）', () => {
        it('把历史值 media 认出来后，expanded 轴折成电影、classic 轴留在影视', () => {
            expect(normalizeStartTabFor('expanded', 'media')).toBe('movie');
            expect(normalizeStartTabFor('classic', 'media')).toBe('media');
        });

        it('把历史值 book 认出来后，expanded 轴折成文学、classic 轴留在阅读', () => {
            expect(normalizeStartTabFor('expanded', 'book')).toBe('kind:book');
            expect(normalizeStartTabFor('classic', 'book')).toBe('book');
        });

        it('脏值先兜底成电影，再按轴折（expanded 仍是电影）', () => {
            expect(normalizeStartTabFor('expanded', 'nonsense')).toBe('movie');
            expect(normalizeStartTabFor('classic', 'nonsense')).toBe('media');
        });

        it('结果恒是合法页签（能过 isNavTabIn）', () => {
            for (const raw of [undefined, null, '', 'movie', 'media', 'book', 'kind:comic', 'game', 'zzz']) {
                for (const axis of TAB_AXES) {
                    const got = normalizeStartTabFor(axis, raw);
                    expect(isNavTabIn(axis, got)).toBe(true);
                }
            }
        });
    });

    describe('isNavTabIn（按轴判合法性；⛔ 别用只认摊开轴的 isNavTab）', () => {
        it('聚合轴下那六枚全合法 —— 而旧 isNavTab 会把「影视」「阅读」判死', () => {
            for (const t of CLASSIC_TAB_ORDER) {
                expect(isNavTabIn('classic', t)).toBe(true);
                // 这就是「为什么必须新开一个判据」的现场证据
                if (t === 'book' || t === 'media') expect(isNavTab(t)).toBe(false);
            }
        });

        it('聚合轴下书籍子分类与影视三型不合法（它们在摊开轴才存在）', () => {
            for (const t of ['kind:book', 'kind:novel', 'kind:comic', 'movie', 'tv', 'anime'] as const) {
                expect(isNavTabIn('classic', t)).toBe(false);
                expect(isNavTabIn('expanded', t)).toBe(true);
            }
        });

        it('非字符串 / 空 / 未知名一律 false', () => {
            for (const raw of [undefined, null, 1, {}, [], '', 'media:1', 'kind:']) {
                expect(isNavTabIn('classic', raw)).toBe(false);
                expect(isNavTabIn('expanded', raw)).toBe(false);
            }
        });
    });

    describe('visibleTabs 第三参（按轴过滤）', () => {
        it('池为 null ⇒ 原样返回该轴全部页签', () => {
            expect(visibleTabs(null, null, 'expanded')).toEqual(HOME_TAB_ORDER);
            expect(visibleTabs(null, null, 'classic')).toEqual(CLASSIC_TAB_ORDER);
        });

        it('缺第三参时按 expanded 走（向后兼容，老调用点不炸）', () => {
            expect(visibleTabs(null)).toEqual(HOME_TAB_ORDER);
        });

        it('🔴 聚合轴只勾电影 ⇒ 「影视」必须留着（这条钉的是 tabRequiresTypes("media") 真缺陷）', () => {
            const tabs = visibleTabs(['movie'], null, 'classic');
            expect(tabs).toEqual(['tracking', 'media', 'stats']);
            expect(tabs).toContain('media');
        });

        it('聚合轴只勾文学 ⇒ 「阅读」必须留着', () => {
            const tabs = visibleTabs(['book'], null, 'classic');
            expect(tabs).toEqual(['tracking', 'book', 'stats']);
        });

        it('聚合轴只勾游戏 ⇒ 影视与阅读都被减掉', () => {
            expect(visibleTabs(['game'], null, 'classic')).toEqual(['tracking', 'game', 'stats']);
        });

        it('聚合轴 + 子分类池也只做减法（聚合页签不吃 bookKind 那一维）', () => {
            expect(visibleTabs(['book'], ['comic'], 'classic')).toEqual(['tracking', 'book', 'stats']);
        });

        it('摊开轴下同样只勾电影 ⇒ 只有电影，没有聚合「影视」', () => {
            expect(visibleTabs(['movie'], null, 'expanded')).toEqual(['tracking', 'movie', 'stats']);
        });
    });

    describe('tabRequiresTypes（仅聚合 media 需要特判）', () => {
        it('media 摊成影视三型 —— ⛔ 别退回 [t as EntryType]（那会造出 "media" 这个不存在的类型）', () => {
            expect(tabRequiresTypes('media')).toEqual(MEDIA_TYPES);
            expect(tabRequiresTypes('media')).toEqual(['anime', 'tv', 'movie']);
        });

        it('book 是合法 EntryType，不需要特判也摊得对', () => {
            expect(tabRequiresTypes('book')).toEqual(['book']);
        });

        it('计划 / 统计不吃类型维度（返回 null = 常驻）', () => {
            expect(tabRequiresTypes('tracking')).toBeNull();
            expect(tabRequiresTypes('stats')).toBeNull();
        });

        it('书籍子分类按 book 一类算', () => {
            for (const t of ['kind:book', 'kind:novel', 'kind:comic'] as const) {
                expect(tabRequiresTypes(t)).toEqual(['book']);
            }
        });
    });

    /**
     * 🔴🔴 m09565 ①-4 真机实测抓到的**第二个**缺陷（源码级守卫）：
     * 换轴的「就近折算」是**纯展示动作**，绝不许回写轴记忆 —— 否则用户在某条轴上的位置被折算结果覆盖。
     * 现场：classic 停在「游戏」→ 切回 expanded（视图显示「电影」）→ 再切回 classic，视图变「影视」、
     *      `homeTabByAxis.classic` 从 `'game'` 被改写成 `'media'`。
     * 根因：折算块原先调 `switchTab(folded)`，那条路会走 `onTabChange` → `plugin.homeTab = t`。
     * ⇒ 守卫直接读 `HomeView.svelte` 源码：折算块里只能出现 `activeTab = folded`。
     */
    describe('换轴折算不许写回轴记忆（m09565 ①-4 真机缺陷守卫）', () => {
        const src = readFileSync(resolve(__dirname, '..', 'src/views/components/HomeView.svelte'), 'utf8');

        it('折算块只改本地 activeTab，⛔ 不许调 switchTab', () => {
            const at = src.indexOf('const folded = equivalentTabFor(tabAxis, activeTab);');
            expect(at).toBeGreaterThan(-1);
            const block = src.slice(at, at + 900);
            expect(block).toContain('activeTab = folded;');
            // `switchTab(folded)` 一旦回来，就会把折算结果写进当前轴那一格
            expect(block).not.toContain('switchTab(folded)');
        });

        it('宿主推 requestedTab 那条路仍要折算（否则聚合轴下 book/media 被静默丢弃）', () => {
            const at = src.indexOf('const folded = equivalentTabFor(tabAxis, want);');
            expect(at).toBeGreaterThan(-1);
            const block = src.slice(at, at + 400);
            expect(block).toContain('tabOrderFor(tabAxis)');
            expect(block).toContain('switchTab(folded)');
        });
    });
});
