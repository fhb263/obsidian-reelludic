/**
 * `pure/episodePage` 单测 —— 选集页（B 站风独立页）的纯逻辑。
 *
 * 🔴 这里钉的是**口径**，不是实现细节：
 *   · 每段 **50** 而 `epPages.EP_PAGE_SIZE` 仍 **100**（两个场景两个常量，⛔ 别互相顶替）；
 *   · **保位**：下标 i 恒 = 第 i+1 集，空位留洞不压缩（#446 用户报障的根因就是压缩）；
 *   · 「相关推荐」= 同系列**其他季**，排除自己、不跨类型、排序复用 `sortSeriesItems`；
 *   · `dead` 只在真 `'dead'` 时标，`'unknown'` **不标**（否则用户会去删好链接）；
 *   · 字幕行顺序**保持传入顺序**（`pickSubtitleCandidates` 已排过，再排就是两套真源）。
 */
import { describe, expect, it } from 'vitest';
import type { MediaEntry } from '../src/data/types';
import {
    EPISODE_PAGE_SIZE,
    cueSourceKey,
    emptyStageModeFor,
    episodeCellCount,
    episodeCells,
    nextCellsMode,
    nextCellsOrder,
    orderCells,
    pageRangeLabel,
    pickRecommendations,
    rangeBarVisible,
    relatedSeasons,
    seasonOrdinalLabel,
    subtitleRows,
} from '../src/pure/episodePage';
import { EP_PAGE_SIZE, pageSlice } from '../src/pure/epPages';
import type { SubtitleCandidate } from '../src/pure/subtitle';

function entry(over: Partial<MediaEntry>): MediaEntry {
    return {
        id: over.id ?? 'x',
        type: over.type ?? 'anime',
        title: over.title ?? 't',
        status: over.status ?? 'doing',
        rating: over.rating ?? 0,
        genres: over.genres ?? [],
        cast: over.cast ?? [],
        ...over,
    } as MediaEntry;
}

describe('每段 50 集（用户 2026-10-27 裁定）', () => {
    it('🔴 新页每段 = 50，而弹窗口径 EP_PAGE_SIZE 仍是 100 —— 两个常量各自独立', () => {
        expect(EPISODE_PAGE_SIZE).toBe(50);
        expect(EP_PAGE_SIZE).toBe(100);
        expect(EPISODE_PAGE_SIZE).not.toBe(EP_PAGE_SIZE);
    });

    it('104 集按 50 切：分 3 段，最后一段只 4 集（真实库最大集数就是 104）', () => {
        const pages = [];
        for (let p = 0; p < 3; p++) pages.push(pageSlice(p, 104, EPISODE_PAGE_SIZE));
        expect(pages).toEqual([
            [0, 50],
            [50, 100],
            [100, 104],
        ]);
    });

    it('50 集以内一段装完（边界：正好 50 不分段）', () => {
        expect(pageSlice(0, 50, EPISODE_PAGE_SIZE)).toEqual([0, 50]);
        expect(pageSlice(1, 50, EPISODE_PAGE_SIZE)).toEqual([0, 50]);
    });
});

describe('episodeCellCount（这一段该出几格）', () => {
    it('取 max(声明总集数, 本地数组长, 网络数组长) —— 数组可能比声明的更长', () => {
        expect(episodeCellCount({ total: 10 })).toBe(10);
        expect(episodeCellCount({ total: 10, files: new Array(12).fill('a') })).toBe(12);
        expect(episodeCellCount({ total: 0, urls: ['u1', 'u2'] })).toBe(2);
        expect(episodeCellCount({})).toBe(0);
    });

    it('集标题长度**不参与**（只填标题没资源的幽灵集不该撑出格子）', () => {
        expect(episodeCellCount({ total: 3, titles: new Array(9).fill('t') })).toBe(3);
    });

    it('非法总集数当 0', () => {
        expect(episodeCellCount({ total: Number.NaN })).toBe(0);
        expect(episodeCellCount({ total: -5 })).toBe(0);
        expect(episodeCellCount({ total: 2.9 })).toBe(2);
    });
});

describe('episodeCells（选集格）', () => {
    it('🔴 保位：中间洞不压缩 —— 第 2 集空着，第 3 集仍是第 3 集', () => {
        const cells = episodeCells({ files: ['a.mp4', undefined, 'c.mp4'], urls: ['', 'u2', ''] });
        expect(cells).toHaveLength(3);
        expect(cells[0].label).toBe('第 1 集');
        expect(cells[0].local).toBe(true);
        expect(cells[1].local).toBe(false);
        expect(cells[1].linked).toBe(true); // 只有网络
        expect(cells[2].local).toBe(true);
        expect(cells[2].linked).toBe(true);
    });

    it('稀疏数组 / 纯空白当没填（不会被当成资源）', () => {
        const files: string[] = [];
        files[2] = '   ';
        const cells = episodeCells({ files, total: 3 });
        expect(cells.map((c) => c.local)).toEqual([false, false, false]);
        expect(cells.every((c) => !c.linked)).toBe(true);
    });

    it('dead 只在 statuses[i] === "dead" 时标；unknown 不标（把「测不动」标成失效会误导用户删好链接）', () => {
        const cells = episodeCells({
            urls: ['u1', 'u2', 'u3'],
            statuses: ['dead', 'unknown', 'ok'],
        });
        expect(cells.map((c) => c.dead)).toEqual([true, false, false]);
    });

    it('只有网络链接的集不算 local（开不了内置播放器，只能开浏览器）', () => {
        const cells = episodeCells({ urls: ['https://b23.tv/x'] });
        expect(cells[0].local).toBe(false);
        expect(cells[0].linked).toBe(true);
    });

    it('cur 只落在 currentIndex 那格；越界 / 非法 ⇒ 一个都不标', () => {
        expect(episodeCells({ total: 3, currentIndex: 1 }).filter((c) => c.cur).map((c) => c.index)).toEqual([1]);
        expect(episodeCells({ total: 3, currentIndex: 9 }).some((c) => c.cur)).toBe(false);
        expect(episodeCells({ total: 3, currentIndex: Number.NaN }).some((c) => c.cur)).toBe(false);
    });

    it('电影态文案是「文件 N」，与选集弹窗 renderRow 同口径', () => {
        const cells = episodeCells({ files: ['a.mp4', 'b.mp4'], single: true });
        expect(cells.map((c) => c.label)).toEqual(['文件 1', '文件 2']);
    });

    it('集标题照原样带出，没填就是空串（⛔ 不留 undefined 让界面渲染出 "undefined"）', () => {
        const cells = episodeCells({ total: 2, titles: [' 第一话 ', undefined] });
        expect(cells[0].title).toBe('第一话');
        expect(cells[1].title).toBe('');
    });
});

describe('relatedSeasons（右下「相关推荐」= 本系列其他季）', () => {
    const me = entry({ id: 'a2', type: 'anime', series: '熊出没', seriesIndex: 2 });

    it('🔴 只出同系列**其他季**，排除自己', () => {
        const all = [
            entry({ id: 'a1', type: 'anime', series: '熊出没', seriesIndex: 1 }),
            me,
            entry({ id: 'a3', type: 'anime', series: '熊出没', seriesIndex: 3 }),
        ];
        expect(relatedSeasons(me, all).map((e) => e.id)).toEqual(['a1', 'a3']);
    });

    it('🔴 不跨类型：同名的动画与真人电影是两回事（用户 2026-09-30 裁定）', () => {
        const all = [
            entry({ id: 'm1', type: 'movie', series: '熊出没', seriesIndex: 1 }),
            entry({ id: 'a1', type: 'anime', series: '熊出没', seriesIndex: 1 }),
        ];
        expect(relatedSeasons(me, all).map((e) => e.id)).toEqual(['a1']);
    });

    it('排序复用 sortSeriesItems（seriesIndex 升序），⛔ 不是数组原序', () => {
        const all = [
            entry({ id: 'a9', type: 'anime', series: '熊出没', seriesIndex: 9 }),
            entry({ id: 'a1', type: 'anime', series: '熊出没', seriesIndex: 1 }),
            entry({ id: 'a5', type: 'anime', series: '熊出没', seriesIndex: 5 }),
        ];
        expect(relatedSeasons(me, all).map((e) => e.id)).toEqual(['a1', 'a5', 'a9']);
    });

    it('没有系列名 ⇒ 空数组（孤立条目没有「其他季」）；穿 null 也安全', () => {
        const lone = entry({ id: 'solo', type: 'movie', title: '单片' });
        expect(relatedSeasons(lone, [lone, me])).toEqual([]);
        expect(relatedSeasons(null, [me])).toEqual([]);
    });

    it('系列名归一化后相同即同组（全角空格 / 大小写差异不裂组）', () => {
        const all = [entry({ id: 'b', type: 'anime', series: '  熊出没　', seriesIndex: 1 })];
        expect(relatedSeasons(me, all).map((e) => e.id)).toEqual(['b']);
    });
});

describe('seasonOrdinalLabel（推荐项的「第 N 部」）', () => {
    it('有正整数 seriesIndex ⇒ 「第 N 部」（中性说法，语义由用户自定）', () => {
        expect(seasonOrdinalLabel({ seriesIndex: 3 })).toBe('第 3 部');
        expect(seasonOrdinalLabel({ seriesIndex: 3.4 })).toBe('第 3 部');
    });

    it('无值 / 0 / 负数 / 非法 ⇒ 空串（⛔ 不写「第 0 部」）', () => {
        expect(seasonOrdinalLabel({})).toBe('');
        expect(seasonOrdinalLabel({ seriesIndex: 0 })).toBe('');
        expect(seasonOrdinalLabel({ seriesIndex: -2 })).toBe('');
        expect(seasonOrdinalLabel({ seriesIndex: Number.NaN })).toBe('');
        expect(seasonOrdinalLabel(null)).toBe('');
    });
});

describe('subtitleRows（右上字幕列表）', () => {
    const cands: SubtitleCandidate[] = [
        { fileName: 'ep01.chs.srt', lang: 'chs' },
        { fileName: 'ep01.eng.srt', lang: 'eng' },
        { fileName: 'ep01.xx.srt', lang: 'xx' },
    ];

    it('语种识别成中文说明；识别不到 ⇒「未知语种」（⛔ 不留空串让界面出现空白行）', () => {
        expect(subtitleRows(cands).map((r) => r.langLabel)).toEqual(['简体', '英文', '未知语种']);
    });

    it('🔴 顺序保持传入顺序（pickSubtitleCandidates 已排过，再排就是两套真源）', () => {
        expect(subtitleRows(cands).map((r) => r.fileName)).toEqual([
            'ep01.chs.srt',
            'ep01.eng.srt',
            'ep01.xx.srt',
        ]);
    });

    it('active 只标当前挂上的那条；没给 ⇒ 全 false', () => {
        expect(subtitleRows(cands, 'ep01.eng.srt').map((r) => r.active)).toEqual([false, true, false]);
        expect(subtitleRows(cands).some((r) => r.active)).toBe(false);
        expect(subtitleRows(cands, null).some((r) => r.active)).toBe(false);
    });

    it('空候选 ⇒ 空数组（界面据长度决定要不要画那一块）', () => {
        expect(subtitleRows([])).toEqual([]);
    });
});

// ── 选集的两个单循环开关（用户 2026-10-29）────────────────────────────────

describe('nextCellsMode / nextCellsOrder（单循环开关）', () => {
    it('画法在 list ⇄ grid 之间循环，点两次回到原点', () => {
        expect(nextCellsMode('list')).toBe('grid');
        expect(nextCellsMode('grid')).toBe('list');
        expect(nextCellsMode(nextCellsMode('list'))).toBe('list');
    });

    it('集序在 asc ⇄ desc 之间循环，点两次回到原点', () => {
        expect(nextCellsOrder('asc')).toBe('desc');
        expect(nextCellsOrder('desc')).toBe('asc');
        expect(nextCellsOrder(nextCellsOrder('asc'))).toBe('asc');
    });

    it('循环结果是**全集内的合法值**，不会掉出类型（防将来加第三档时漏写）', () => {
        const modes = new Set<string>();
        let m = nextCellsMode('list' as never) as 'list' | 'grid';
        for (let i = 0; i < 4; i++) {
            modes.add(m);
            m = nextCellsMode(m);
        }
        expect([...modes].sort()).toEqual(['grid', 'list']);
    });
});

describe('orderCells（整份反转，⛔ 不是只转当页）', () => {
    const cells = episodeCells({ total: 5 });

    it('asc 原样返回，desc 反转', () => {
        expect(orderCells(cells, 'asc').map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
        expect(orderCells(cells, 'desc').map((c) => c.index)).toEqual([4, 3, 2, 1, 0]);
    });

    it('🔴 必须返回新数组：改返回值不许动到入参（否则会悄悄反转别处的缓存）', () => {
        const out = orderCells(cells, 'desc');
        expect(out).not.toBe(cells);
        expect(cells.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
    });

    it('倒序后再分页，每页内部也是单调递减（跨页不会跳回大数）', () => {
        const many = episodeCells({ total: 120 });
        const desc = orderCells(many, 'desc');
        const pages = Math.ceil(desc.length / EPISODE_PAGE_SIZE);
        for (let p = 0; p < pages; p++) {
            const [s, e] = pageSlice(p, desc.length, EPISODE_PAGE_SIZE);
            const seg = desc.slice(s, e).map((c) => c.index);
            expect(seg).toEqual([...seg].sort((a, b) => b - a));
        }
    });
});

describe('pageRangeLabel（分段条文案，正序倒序都不能骗人）', () => {
    const cells = episodeCells({ total: 52 });

    it('正序第 0 页 = 1-50', () => {
        const asc = orderCells(cells, 'asc');
        const [s, e] = pageSlice(0, asc.length, EPISODE_PAGE_SIZE);
        expect(pageRangeLabel(asc, s, e)).toBe('1-50');
    });

    it('🔴 倒序第 0 页 = 3-52（旧写法按数组位算会错写成 1-50，而格子显示的是 52→3）', () => {
        const desc = orderCells(cells, 'desc');
        const [s, e] = pageSlice(0, desc.length, EPISODE_PAGE_SIZE);
        expect(pageRangeLabel(desc, s, e)).toBe('3-52');
    });

    it('倒序第 1 页 = 1-2', () => {
        const desc = orderCells(cells, 'desc');
        const [s, e] = pageSlice(1, desc.length, EPISODE_PAGE_SIZE);
        expect(pageRangeLabel(desc, s, e)).toBe('1-2');
    });

    it('空页 ⇒ 空串（不画一个没有内容的「1-0」）', () => {
        expect(pageRangeLabel([], 0, 0)).toBe('');
    });
});

/**
 * 🔴 用户 2026-11-10（m02255）：「播放器选集面板即使不足 50 集也显示 1-20」。
 *    改前视图里写的是 `pages > 1` ⇒ 只有一页时整条分段不画；这条纯函数把门槛钉成「有格子就画」。
 * ⚠️ 判据收口到 pure 层的原因：视图层没进 vitest，内联判断改回去单测是摸不到的（只能靠真机截图）。
 */
describe('rangeBarVisible（分段条要不要画）', () => {
    it('🔴 不足一页也要画（10 集 ⇒ true）', () => {
        expect(rangeBarVisible(10)).toBe(true);
    });

    it('只有 1 集也画', () => {
        expect(rangeBarVisible(1)).toBe(true);
    });

    it('刚好一页（50 集）画', () => {
        expect(rangeBarVisible(EPISODE_PAGE_SIZE)).toBe(true);
    });

    it('多页画', () => {
        expect(rangeBarVisible(52)).toBe(true);
    });

    it('没有格子 ⇒ 不画（避免留一个空壳容器）', () => {
        expect(rangeBarVisible(0)).toBe(false);
    });

    it('非法数字 ⇒ 不画（NaN / Infinity 都不能让容器闪现）', () => {
        expect(rangeBarVisible(Number.NaN)).toBe(false);
        expect(rangeBarVisible(Number.POSITIVE_INFINITY)).toBe(false);
    });

    it('⛔ 不能退回「只有多页才画」的门槛：10 与 52 必须同为 true', () => {
        expect(rangeBarVisible(10)).toBe(rangeBarVisible(52));
    });
});

/**
 * 🔴 用户 2026-11-10（m03035）：「从播放器详情页相关推荐进入的条目播放详情页由于没有任何
 *    关联播放器屏幕一直在转圈 改成显示未关联空态」。
 * ⚠️ 钉这条是为了让「把判据改回恒 loading」当场变红 —— 视图层不进 vitest，只能靠 pure 层守。
 */
describe('emptyStageModeFor（空舞台说哪句话）', () => {
    it('🔴 本地集与网络集都是空 ⇒ 未关联（不转圈）', () => {
        expect(emptyStageModeFor(0, 0)).toBe('unlinked');
    });

    it('只有本地集 ⇒ 加载中', () => {
        expect(emptyStageModeFor(3, 0)).toBe('loading');
    });

    it('只有网络集 ⇒ 加载中', () => {
        expect(emptyStageModeFor(0, 2)).toBe('loading');
    });

    it('两者都有 ⇒ 加载中', () => {
        expect(emptyStageModeFor(3, 2)).toBe('loading');
    });

    it('非法数字按「没有」处理（NaN / 负数不能让页面一直转圈）', () => {
        expect(emptyStageModeFor(Number.NaN, Number.NaN)).toBe('unlinked');
        expect(emptyStageModeFor(-1, -1)).toBe('unlinked');
    });

    it('⛔ 0/0 与 1/0 必须给出不同形态（否则这条判据等于没写）', () => {
        expect(emptyStageModeFor(0, 0)).not.toBe(emptyStageModeFor(1, 0));
    });
});

describe('pickRecommendations（右下相关推荐，用户 2026-11-10）', () => {
    const mk = (id: string, type: MediaEntry['type']): MediaEntry => entry({ id, type, title: id });
    const all: MediaEntry[] = [
        mk('m1', 'movie'),
        mk('m2', 'movie'),
        mk('a1', 'anime'),
        mk('a2', 'anime'),
        mk('a3', 'anime'),
        mk('t1', 'tv'),
        mk('b1', 'book'),
        mk('g1', 'game'),
        mk('mu1', 'music'),
    ];

    it('🔴 候选池只有 movie / anime —— tv、book、game、music 一个都不许混进来', () => {
        const got = pickRecommendations({ id: 'm1' }, all, 99);
        // 5 部合法（m2 / a1 / a2 / a3 + 自己 m1 被排除 ⇒ 实际 3 部，见下一条）
        for (const e of got) {
            expect(['movie', 'anime']).toContain(e.type);
        }
    });

    it('排除自己：正在看的那部不出现在自己的推荐里', () => {
        const got = pickRecommendations({ id: 'a1' }, all, 99);
        expect(got.map((e) => e.id)).not.toContain('a1');
    });

    it('上限生效：池子 5 部（排除自己后）取 2 部就只回 2 部', () => {
        const got = pickRecommendations({ id: 'm1' }, all, 2);
        expect(got.length).toBe(2);
    });

    it('池子比上限小 ⇒ 全部返回，⛔ 不补空位', () => {
        const got = pickRecommendations({ id: 'm1' }, all, 99);
        // movie: m1(自己排除) m2 ⇒ 1；anime: a1 a2 a3 ⇒ 3；合计 4
        expect(got.length).toBe(4);
    });

    it('🔴 洗牌只换顺序、不丢不重（同一个 seed 下逐项相等）', () => {
        const a = pickRecommendations({ id: 'm1' }, all, 99, 42).map((e) => e.id);
        const b = pickRecommendations({ id: 'm1' }, all, 99, 42).map((e) => e.id);
        expect(a).toEqual(b); // 同 seed 可复现
        expect(new Set(a).size).toBe(a.length); // 无重复
        expect(a.slice().sort()).toEqual(['a1', 'a2', 'a3', 'm2'].sort()); // 无丢项
    });

    it('不同 seed 洗出不同顺序（否则等于没洗牌）', () => {
        const a = pickRecommendations({ id: 'm1' }, all, 99, 1).map((e) => e.id);
        const b = pickRecommendations({ id: 'm1' }, all, 99, 999).map((e) => e.id);
        // 4 部只可能有 24 种排列，理论上极小概率相同；取两个相隔很远的 seed 规避
        expect(a).not.toEqual(b);
    });

    it('limit = 0 ⇒ 空数组（不画任何推荐）', () => {
        expect(pickRecommendations({ id: 'm1' }, all, 0)).toEqual([]);
    });

    it('池子为空（库里只有 tv / book）⇒ 空数组，⛔ 不硬塞别的类型', () => {
        const onlyOthers: MediaEntry[] = [mk('t1', 'tv'), mk('b1', 'book')];
        expect(pickRecommendations({ id: 't1' }, onlyOthers, 6)).toEqual([]);
    });

    it('current 为 null 时也能工作（不排除任何条目）', () => {
        const got = pickRecommendations(null, all, 99);
        expect(got.length).toBe(5); // 全部 5 部 movie/anime
    });

    describe('🔴 题材优先（用户 m00983 ①：「按当前条目题材匹配，同题材不够再放宽」）', () => {
        // 三部电影：m1 自己（科幻）、m2（科幻）、m3（喜剧）；外加 anime a1（科幻）
        const byGenre: MediaEntry[] = [
            entry({ id: 'm1', type: 'movie', title: 'm1', genres: ['科幻'] }),
            entry({ id: 'm2', type: 'movie', title: 'm2', genres: ['科幻'] }),
            entry({ id: 'm3', type: 'movie', title: 'm3', genres: ['喜剧'] }),
            entry({ id: 'a1', type: 'anime', title: 'a1', genres: ['科幻'] }),
        ];
        const me = byGenre[0]!;

        it('同题材排在前、不同题材垫后（不是被过滤掉）', () => {
            const got = pickRecommendations(me, byGenre, 99, 7);
            const ids = got.map((e) => e.id);
            // 题材命中：m2、a1；不命中：m3。三段式断言避免依赖两组内部顺序
            expect(ids.slice(0, 2).sort()).toEqual(['a1', 'm2']);
            expect(ids[2]).toBe('m3');
            expect(got.length).toBe(3); // ⛔ 不是只回同题材（「不够再放宽」）
        });

        it('同题材够数时，limit 之内不会有不同题材混进来', () => {
            const got = pickRecommendations(me, byGenre, 2, 7);
            expect(got.map((e) => e.id).sort()).toEqual(['a1', 'm2']);
        });

        it('current 没有题材（或 genres 缺省）⇒ 退化为纯洗牌，全部候选都在', () => {
            const got = pickRecommendations({ id: 'm1' }, byGenre, 99, 7);
            expect(got.map((e) => e.id).sort()).toEqual(['a1', 'm2', 'm3']);
        });

        it('「完全相同」才命中，⛔ 不做模糊包含（科幻 ≠ 科幻片）', () => {
            const fuzzy: MediaEntry[] = [
                entry({ id: 'x1', type: 'movie', title: 'x1', genres: ['科幻'] }),
                entry({ id: 'x2', type: 'movie', title: 'x2', genres: ['科幻片'] }), // 近似但不等
                entry({ id: 'x3', type: 'movie', title: 'x3', genres: ['喜剧'] }),
                entry({ id: 'x4', type: 'movie', title: 'x4', genres: ['科幻'] }), // 唯一真命中
            ];
            const got = pickRecommendations(fuzzy[0]!, fuzzy, 99, 7);
            const ids = got.map((e) => e.id);
            // 真命中只有 x4 ⇒ 必须排第一；近似项 x2 不许抢到它前面
            expect(ids[0]).toBe('x4');
            expect(ids.indexOf('x2')).toBeGreaterThan(0);
            expect(got.length).toBe(3);
        });
    });
});

/**
 * 🔴 2026-11-06 用户报障：「怎么每集共用一个集的字幕文件啊」——**网络集也指向同一份**。
 * 根因是视图层拿 `currentEpisodeIndex()`（组件库 items 的真实集）拼键，而 B 站内嵌态不动 `cur`
 * ⇒ 所有网络集的键完全相同 ⇒ `syncCueSource` 早退 ⇒ 面板永远停在第 1 个网络集上。
 * 这组断言就是那道闸：**不同集号必须得到不同键**。
 */
describe('pure/episodePage cueSourceKey（字幕面板来源键）', () => {
    it('🔴 不同集号必须给出不同的键（这就是「每集共用一个字幕」的回归守卫）', () => {
        const base = { importedFileName: '第1话.zh.srt', subtitleFileName: null };
        const k1 = cueSourceKey({ ...base, episodeIndex: 0 });
        const k2 = cueSourceKey({ ...base, episodeIndex: 1 });
        const k9 = cueSourceKey({ ...base, episodeIndex: 9 });
        expect(k1).not.toBe(k2);
        expect(k2).not.toBe(k9);
        // 三个互不相等（用集合大小再钉一次，防止将来有人把 idx 从格式里删掉）
        expect(new Set([k1, k2, k9]).size).toBe(3);
    });

    it('同名字幕文件在不同集 ≠ 同一个键（网络集共用文件名也不会串）', () => {
        const a = cueSourceKey({ episodeIndex: 3, importedFileName: 'subtitle.vtt' });
        const b = cueSourceKey({ episodeIndex: 4, importedFileName: 'subtitle.vtt' });
        expect(a).not.toBe(b);
    });

    it('手动导入优先于本地字幕（两者同时存在时键走 imp::）', () => {
        const k = cueSourceKey({ episodeIndex: 2, importedFileName: 'a.srt', subtitleFileName: 'b.vtt' });
        expect(k).toBe('imp::2::a.srt');
    });

    it('没有导入时走 base::，本地没字幕时文件名位是空串（仍然合法且稳定）', () => {
        expect(cueSourceKey({ episodeIndex: 0, subtitleFileName: 'c.srt' })).toBe('base::0::c.srt');
        expect(cueSourceKey({ episodeIndex: 0 })).toBe('base::0::');
        expect(cueSourceKey({ episodeIndex: 0, subtitleFileName: null })).toBe(cueSourceKey({ episodeIndex: 0 }));
    });

    it('空 / 纯空白的导入名当作「没有导入」（否则会拼出 imp::0:: 挡住本地字幕）', () => {
        expect(cueSourceKey({ episodeIndex: 0, importedFileName: '   ', subtitleFileName: 'c.srt' })).toBe(
            'base::0::c.srt',
        );
        expect(cueSourceKey({ episodeIndex: 0, importedFileName: '' })).toBe('base::0::');
    });

    it('-1（一集都没有 / 还在解析）也编进键里，⛔ 不抹成 0', () => {
        // 抹成 0 会让「空态」与「第 0 集」共用一个键 ⇒ 从空态切到第 1 集时不会重解析
        expect(cueSourceKey({ episodeIndex: -1 })).toBe('base::-1::');
        expect(cueSourceKey({ episodeIndex: -1 })).not.toBe(cueSourceKey({ episodeIndex: 0 }));
    });

    it('非有限数收敛成 -1（⛔ 不产出 base::NaN:: 这种永不相等的键）', () => {
        expect(cueSourceKey({ episodeIndex: Number.NaN })).toBe('base::-1::');
        expect(cueSourceKey({ episodeIndex: Number.POSITIVE_INFINITY })).toBe('base::-1::');
    });

    it('小数集号取整（防浮点误差把同一集拆成两个键）', () => {
        expect(cueSourceKey({ episodeIndex: 2.0000001 })).toBe(cueSourceKey({ episodeIndex: 2 }));
    });
});
