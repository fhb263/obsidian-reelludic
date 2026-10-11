import { describe, it, expect } from 'vitest';
import {
    normalizeSeriesName,
    seriesNameOf,
    seriesKeyOf,
    seriesTitleOf,
    seriesIndexValue,
    sortSeriesItems,
    foldSeries,
    listTreeRows,
    listDisplayRows,
    compareSeriesGroups,
    seriesYearSpan,
    seriesGenres,
    parseSeriesIndexInput,
    planSeriesReindex,
    planSeriesReindexAll,
    moveItem,
    nextSeriesEntry,
    seriesStatus,
    seriesPanelCols,
    seriesPanelWidth,
    seriesPanelTileSpace,
    SERIES_TILE_W,
    SERIES_TILE_GAP,
    SERIES_TILE_PAD,
    SERIES_ACT_BORDER,
    SERIES_PANEL_MIN_W,
    SERIES_PANEL_MAX_W,
    SERIES_COLS_MAX,
    SERIES_COLS_MAX_WIDE,
    SERIES_COLS_MAX_NARROW,
    SERIES_COLS_MAX_TIGHT,
    seriesPanelFitWidth,
    seriesColsCap,
    seriesReadPercent,
    seriesReadDone,
    type SeriesRow,
} from 'pure/seriesGroup';
import type { EntryType, MediaEntry } from 'data/types';

function e(id: string, type: EntryType, series?: string, seriesIndex?: number, year?: number, title = `作品${id}`): MediaEntry {
    return { id, type, title, series, seriesIndex, year, links: [], progress: {} } as unknown as MediaEntry;
}

/** 行 → 可读签名（便于断言「折叠卡落在哪个位置、组内有几条」） */
function sig(rows: SeriesRow[]): string[] {
    return rows.map((r) => (r.kind === 'single' ? `s:${r.entry.id}` : `S:${r.group.title}(${r.group.items.map((i) => i.id).join(',')})`));
}

describe('pure/seriesGroup 归一化与键', () => {
    it('系列名归一：trim + 内部空白折单空格 + 小写（含全角空格 U+3000）', () => {
        expect(normalizeSeriesName('  熊出没  ')).toBe('熊出没');
        expect(normalizeSeriesName('Sponge   Bob')).toBe('sponge bob');
        expect(normalizeSeriesName('熊出没\u3000系列')).toBe('熊出没 系列'); // \s 含全角空格
        expect(normalizeSeriesName(undefined)).toBe('');
        expect(normalizeSeriesName('   ')).toBe('');
    });

    it('显示名只 trim，不改大小写/内部空白（归一化只服务于比较，⛔ 不影响用户看到的字）', () => {
        expect(seriesNameOf({ series: '  Foundation  ' })).toBe('Foundation');
        expect(seriesNameOf({})).toBe('');
        expect(seriesNameOf(null)).toBe('');
    });

    it('分组键 = type + 分隔符 + 归一化名；没填系列名 ⇒ null（⛔ 不是空串）', () => {
        expect(seriesKeyOf(e('1', 'movie', '熊出没'))).toBe('movie\u0001熊出没');
        expect(seriesKeyOf(e('1', 'movie', '  熊出没 '))).toBe('movie\u0001熊出没');
        expect(seriesKeyOf(e('1', 'book', ''))).toBeNull();
        expect(seriesKeyOf(e('1', 'book', '   '))).toBeNull();
        expect(seriesKeyOf(undefined)).toBeNull();
    });

    it('🔴 同名不同 type ⇒ 键不同（D-45(b)「不做跨类型」的根）', () => {
        expect(seriesKeyOf(e('1', 'movie', '海绵宝宝'))).not.toBe(seriesKeyOf(e('2', 'anime', '海绵宝宝')));
    });

    // 🔴 #443：序号锁定整数（用户裁定「只能填整数不能填小数」）—— 真库里 8.5 排在 8 后面就是小数闹的
    it('序号只认有限数、且**锁成整数**（小数四舍五入；NaN/Infinity/字符串一律 undefined）', () => {
        expect(seriesIndexValue({ seriesIndex: 2 })).toBe(2);
        expect(seriesIndexValue({ seriesIndex: 2.5 })).toBe(3);   // 🔴 读时归一（⛔ 不回写 catalog）
        expect(seriesIndexValue({ seriesIndex: 8.5 })).toBe(9);
        expect(seriesIndexValue({ seriesIndex: 0 })).toBe(0);
        expect(seriesIndexValue({ seriesIndex: -1 })).toBe(-1);
        expect(seriesIndexValue({ seriesIndex: NaN })).toBeUndefined();
        expect(seriesIndexValue({ seriesIndex: Infinity })).toBeUndefined();
        expect(seriesIndexValue({ seriesIndex: '3' as unknown as number })).toBeUndefined();
        expect(seriesIndexValue({})).toBeUndefined();
    });
});

describe('pure/seriesGroup 组名（§4.2 单一真源）', () => {
    it('组名 = `${系列名} ${类型}系列`，类型名取 ENTRY_TYPE_LABELS', () => {
        expect(seriesTitleOf('海绵宝宝', 'movie')).toBe('海绵宝宝 电影系列');
        expect(seriesTitleOf('海绵宝宝', 'anime')).toBe('海绵宝宝 动画系列');
        expect(seriesTitleOf('熊出没', 'tv')).toBe('熊出没 剧集系列');
        expect(seriesTitleOf('基地', 'book')).toBe('基地 书籍系列');
        expect(seriesTitleOf('原神', 'game')).toBe('原神 游戏系列');
        expect(seriesTitleOf('某专辑', 'music')).toBe('某专辑 音乐系列');
    });

    it('🔴 同名不同类 ⇒ 组名互不相同（否则两张并排的卡分不出来）', () => {
        const a = seriesTitleOf('海绵宝宝', 'movie');
        const b = seriesTitleOf('海绵宝宝', 'anime');
        expect(a).not.toBe(b);
        expect(a.includes('系列')).toBe(true);
        expect(b.includes('系列')).toBe(true);
    });

    it('名字两端空白被吃掉（组名不留双空格）', () => {
        expect(seriesTitleOf('  熊出没  ', 'movie')).toBe('熊出没 电影系列');
    });
});

describe('pure/seriesGroup 组内排序（D-42）', () => {
    it('序号升序 → 无序号排在有序号之后 → 年份 → 标题', () => {
        const out = sortSeriesItems([
            e('d', 'movie', 'S', undefined, 2019, '无序号-后年份'),
            e('b', 'movie', 'S', 2, 2016),
            e('a', 'movie', 'S', 1, 2018),
            e('c', 'movie', 'S', undefined, 2014, '无序号-前年份'),
            e('x', 'movie', 'S', 3, 2015),
        ]);
        expect(out.map((i) => i.id)).toEqual(['a', 'b', 'x', 'c', 'd']);
    });

    it('序号相同（含都无序号）时按年份升序，年份也相同按标题 zh', () => {
        const out = sortSeriesItems([
            e('2', 'movie', 'S', undefined, 2020, 'B'),
            e('1', 'movie', 'S', undefined, 2020, 'A'),
            e('3', 'movie', 'S', undefined, 2010, 'C'),
            e('4', 'movie', 'S', undefined, undefined, 'D'),
        ]);
        expect(out.map((i) => i.id)).toEqual(['3', '1', '2', '4']); // 年份缺失置末
    });

    it('不改动入参数组（返回新数组）', () => {
        const src = [e('b', 'movie', 'S', 2), e('a', 'movie', 'S', 1)];
        const out = sortSeriesItems(src);
        expect(src.map((i) => i.id)).toEqual(['b', 'a']);
        expect(out).not.toBe(src);
    });
});

describe('pure/seriesGroup 折叠卡的两行占位（防同列错位，与 pure/cardMeta 同款「—」）', () => {
    it('年份跨度：0 个年份 → —；1 个 → 单年；≥2 个 → 极值 en dash；只取极值不列全', () => {
        expect(seriesYearSpan([])).toBe('—');
        expect(seriesYearSpan([{ year: 2014 }])).toBe('2014');
        expect(seriesYearSpan([{ year: 2019 }, { year: 2014 }, { year: 2026 }])).toBe('2014–2026');
        expect(seriesYearSpan([{ year: 2014 }, { year: 2019 }])).not.toContain('2016');
        expect(seriesYearSpan([{ year: 2014 }, {}])).toBe('2014'); // 缺年份的成员不参与
        expect(seriesYearSpan([{}, { year: undefined }])).toBe('—');
    });

    it('题材：取并集、按**首个出现的顺序**、只取前 2 个、` · ` 连接；空 → —', () => {
        expect(seriesGenres([])).toBe('—');
        expect(seriesGenres([{ genres: [] }])).toBe('—');
        expect(seriesGenres([{ genres: ['喜剧', '冒险'] }, { genres: ['亲子'] }])).toBe('喜剧 · 冒险');
        // 顺序稳定：不因后出现的组员而漂移
        expect(seriesGenres([{ genres: ['亲子'] }, { genres: ['喜剧', '冒险'] }])).toBe('亲子 · 喜剧');
        // 跨组员去重
        expect(seriesGenres([{ genres: ['喜剧'] }, { genres: ['喜剧', '冒险'] }])).toBe('喜剧 · 冒险');
        expect(seriesGenres([{ genres: ['  '] }])).toBe('—'); // 空白值不算题材
    });
});

describe('pure/seriesGroup 折叠（foldSeries）', () => {
    it('无系列名 ⇒ 全是散卡', () => {
        expect(sig(foldSeries([e('1', 'movie'), e('2', 'movie')]))).toEqual(['s:1', 's:2']);
    });

    it('🔴 只有 1 条的组**不折叠**（折起来反而多一次点击，还看不出是系列）', () => {
        expect(sig(foldSeries([e('1', 'movie', '熊出没'), e('2', 'movie')]))).toEqual(['s:1', 's:2']);
    });

    it('≥2 条成组；折叠卡占**组内首个成员的原位置**，其余成员不再单独出卡', () => {
        const rows = foldSeries([
            e('a', 'movie', '熊出没', 1),
            e('z', 'movie'), // 无关散卡
            e('b', 'movie', '熊出没', 2),
        ]);
        expect(sig(rows)).toEqual(['S:熊出没 电影系列(a,b)', 's:z']);
    });

    it('组内按序号重排（不是按原流顺序）', () => {
        const rows = foldSeries([
            e('later', 'movie', '熊出没', 9),
            e('first', 'movie', '熊出没', 1),
        ]);
        expect(sig(rows)).toEqual(['S:熊出没 电影系列(first,later)']);
    });

    it('🔴 同名不同 type ⇒ 两个独立的折叠卡（D-45(b) 核心；⛔ 单测别只测同类型）', () => {
        const rows = foldSeries([
            e('m1', 'movie', '海绵宝宝', 1),
            e('a1', 'anime', '海绵宝宝', 1),
            e('m2', 'movie', '海绵宝宝', 2),
            e('a2', 'anime', '海绵宝宝', 2),
        ]);
        expect(sig(rows)).toEqual([
            'S:海绵宝宝 电影系列(m1,m2)',
            'S:海绵宝宝 动画系列(a1,a2)',
        ]);
    });

    it('类型相同但系列名不同 ⇒ 两组', () => {
        const rows = foldSeries([
            e('1', 'book', '基地', 1),
            e('2', 'book', '基地', 2),
            e('3', 'book', '沙丘', 1),
            e('4', 'book', '沙丘', 2),
        ]);
        expect(sig(rows)).toEqual(['S:基地 书籍系列(1,2)', 'S:沙丘 书籍系列(3,4)']);
    });

    it('空输入 ⇒ 空行', () => {
        expect(foldSeries([])).toEqual([]);
    });

    it('组名用组内首个成员的写法（同名不同大小写/空白时以先出现者为准）', () => {
        const rows = foldSeries([e('1', 'movie', '  SpongeBob '), e('2', 'movie', 'spongebob')]);
        expect(rows).toHaveLength(1);
        expect(rows[0].kind === 'series' && rows[0].group.name).toBe('SpongeBob');
    });

    it('🔴 折叠**不丢条目**（行数会变少，但条目总数守恒 —— 分页「共 N 条」按条目数算）', () => {
        const src = [e('a', 'movie', 'S', 1), e('b', 'movie', 'S', 2), e('c', 'movie'), e('d', 'anime', 'S', 1), e('e', 'anime', 'S', 2)];
        const rows = foldSeries(src);
        const total = rows.reduce((n, r) => n + (r.kind === 'single' ? 1 : r.group.items.length), 0);
        expect(rows).toHaveLength(3); // 2 张折叠卡 + 1 张散卡
        expect(total).toBe(src.length);
    });
});

// ⚠️ #435 的「系列筛选池」（`buildSeriesOptions` / `matchesSeries`）与「建议清单」（`seriesNamePool`）
//    两件事**都已被用户推翻**（「删除这个筛选系列框」「下拉选择毛用没有改成手动填写」）⇒ 函数与用例一并退场。
//    「⛔ 不许长回来」的反向守卫落在产物断言脚本里（本仓守卫统一在那一处，⛔ 别两处各写一套）。

// ── 🔴🔴 #436：表单那个数字框的「三态收口」─────────────────────────────
// 起因：`<input type="number" bind:value={x}>` 里 Svelte 的 `bind:value` 走 `to_number` ——
//   **初值是字符串、用户一敲键盘就变 number（清空变 null）**，而 TS 只看见初值 ⇒ 整条被推断成 `string`
//   ⇒ 任何 `.trim()` 都**编译期合法、运行期炸**，崩在 `on:click` 里就是**静默死按钮**。
//   用户原话：「我填写了海绵宝宝系列，也填写了系列序号，怎么点都没反应，也没提示」。
describe('pure/seriesGroup.parseSeriesIndexInput（数字框三态收口）', () => {
    it('字符串（未敲键盘时的初值态）：trim 后转数，🔴 #443 **小数四舍五入成整数**', () => {
        expect(parseSeriesIndexInput('1')).toBe(1);
        expect(parseSeriesIndexInput('1.5')).toBe(2);
        expect(parseSeriesIndexInput('  2 ')).toBe(2);
        expect(parseSeriesIndexInput('-3')).toBe(-3);
    });

    it('🔴 数字（用户敲过键盘后 `bind:value` 给的就是 number）：🔴 #443 **小数照样取整**', () => {
        expect(parseSeriesIndexInput(1)).toBe(1);
        expect(parseSeriesIndexInput(2.5)).toBe(3);
        expect(parseSeriesIndexInput(8.5)).toBe(9);
        expect(parseSeriesIndexInput(0)).toBe(0);
    });

    it('🔴 null（把输入框清空 ⇒ Svelte `to_number` 给 null）：undefined，⛔ 不抛', () => {
        expect(parseSeriesIndexInput(null)).toBeUndefined();
    });

    it('空串 / 全空白 ⇒ undefined', () => {
        expect(parseSeriesIndexInput('')).toBeUndefined();
        expect(parseSeriesIndexInput('   ')).toBeUndefined();
    });

    it('非数（`2.5.5` / `abc`）⇒ undefined（⛔ 绝不落 NaN）', () => {
        expect(parseSeriesIndexInput('2.5.5')).toBeUndefined();
        expect(parseSeriesIndexInput('abc')).toBeUndefined();
    });

    it('NaN / Infinity ⇒ undefined', () => {
        expect(parseSeriesIndexInput(NaN)).toBeUndefined();
        expect(parseSeriesIndexInput(Infinity)).toBeUndefined();
        expect(parseSeriesIndexInput('Infinity')).toBeUndefined();
    });

    it('🔴 undefined / 对象 / 数组 / 布尔 ⇒ undefined 而**不是抛错**（这正是 #434 静默死按钮的根因）', () => {
        expect(parseSeriesIndexInput(undefined)).toBeUndefined();
        expect(parseSeriesIndexInput({})).toBeUndefined();
        expect(parseSeriesIndexInput([])).toBeUndefined();
        expect(parseSeriesIndexInput(true)).toBeUndefined();
        expect(() => parseSeriesIndexInput({} as unknown)).not.toThrow();
    });
});

// ── #573：按「选中集合」依次编号（#608 起入口只剩折叠卡右键，见下方第二个 describe）──
// 用户原话：「给系列合集卡视图内添加个批量重排序号的功能」。
describe('pure/seriesGroup.planSeriesReindex（批量重排序号的计划）', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const pick = (...ks: string[]) => new Set(ks);

    it('按**传进来的顺序**依次编号（1 起步；顺序就是当前视图的显示顺序）', () => {
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'))).toEqual([
            { id: 'a', seriesIndex: 1 },
            { id: 'b', seriesIndex: 2 },
            { id: 'c', seriesIndex: 3 },
        ]);
    });

    it('🔴 只编选中项、未选中的**跳过且不占号**（勾 b 与 e ⇒ 它们拿 1 / 2，中间没跳号）', () => {
        expect(planSeriesReindex(ids, pick('b', 'e'))).toEqual([
            { id: 'b', seriesIndex: 1 },
            { id: 'e', seriesIndex: 2 },
        ]);
    });

    it('起始值可选：从 10 开始依次 10 / 11 / 12', () => {
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'), 10)).toEqual([
            { id: 'a', seriesIndex: 10 },
            { id: 'b', seriesIndex: 11 },
            { id: 'c', seriesIndex: 12 },
        ]);
    });

    it('步长可选：起始 1、步长 2 ⇒ 1 / 3 / 5', () => {
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'), 1, 2).map((p) => p.seriesIndex)).toEqual([1, 3, 5]);
    });

    it('🔴 起始值缺失 / 非法 ⇒ 兜底 1（⛔ 不落 NaN、不落 0）', () => {
        for (const bad of [undefined, null, '', 'abc', NaN, Infinity]) {
            expect(planSeriesReindex(ids, pick('a'), bad)[0]?.seriesIndex).toBe(1);
        }
    });

    it('🔴 步长 < 1 一律按 1（步长 0 会让整组同号 ⇒ 序号立刻失去「第几部」的含义）', () => {
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'), 1, 0).map((p) => p.seriesIndex)).toEqual([1, 2, 3]);
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'), 1, -5).map((p) => p.seriesIndex)).toEqual([1, 2, 3]);
        expect(planSeriesReindex(ids, pick('a', 'b', 'c'), 1, 'x').map((p) => p.seriesIndex)).toEqual([1, 2, 3]);
    });

    it('小数走同一口径（起始 / 步长都取整，⛔ 别出 1.5 这种序号）', () => {
        expect(planSeriesReindex(ids, pick('a', 'b'), '1.4', '2.6').map((p) => p.seriesIndex)).toEqual([1, 4]);
    });

    it('空选中 / 空顺序 ⇒ 空计划（调用点据此早退，⛔ 不产生空写库）', () => {
        expect(planSeriesReindex(ids, pick())).toEqual([]);
        expect(planSeriesReindex([], pick('a'))).toEqual([]);
    });

    it('🔴 顺序完全由入参决定：同一批选中项，入参倒序 ⇒ 编号跟着倒过来（⛔ 本函数不自己排序）', () => {
        expect(planSeriesReindex(['c', 'b', 'a'], pick('a', 'b', 'c'))).toEqual([
            { id: 'c', seriesIndex: 1 },
            { id: 'b', seriesIndex: 2 },
            { id: 'a', seriesIndex: 3 },
        ]);
    });
});

// ── #608：海报墙「系列折叠卡」右键 → 「排序号」（整组重排）──────────────────────
// 用户原话：「系列合集卡支持批量重排序号，右键菜单排序号」→ 三处裁定：入口挂**折叠卡右键**、
// 编号口径 = **整组全部按当前顺序 1..N**、**批量条那组整体删除**（只留右键这一条入口）。
describe('pure/seriesGroup.planSeriesReindexAll（折叠卡「排序号」· 整组重排）', () => {
    it('🔴 整组全部成员依次编号：1 / 2 / 3 / 4 / 5（没有「跳过不占号」这一说）', () => {
        expect(planSeriesReindexAll(['a', 'b', 'c', 'd', 'e'])).toEqual([
            { id: 'a', seriesIndex: 1 },
            { id: 'b', seriesIndex: 2 },
            { id: 'c', seriesIndex: 3 },
            { id: 'd', seriesIndex: 4 },
            { id: 'e', seriesIndex: 5 },
        ]);
    });

    it('🔴 起始恒 1、步长恒 1（折叠卡上没有那两个输入框 ⇒ 口径写死）', () => {
        expect(planSeriesReindexAll(['x', 'y', 'z']).map((p) => p.seriesIndex)).toEqual([1, 2, 3]);
    });

    it('🔴 把「带空洞的序号」压回 1..N：传进来什么顺序就照什么顺序编（本函数不排序）', () => {
        // 例：某系列的序号是 3 / 7 / 9（历史遗留），按当前显示顺序重排 ⇒ 1 / 2 / 3
        expect(planSeriesReindexAll(['c', 'a', 'b'])).toEqual([
            { id: 'c', seriesIndex: 1 },
            { id: 'a', seriesIndex: 2 },
            { id: 'b', seriesIndex: 3 },
        ]);
    });

    it('空组 ⇒ 空计划（调用点据此早退，⛔ 不产生空写库）', () => {
        expect(planSeriesReindexAll([])).toEqual([]);
    });
});

// ── #609：排序号弹窗「拖拽排序」────────────────────────────────────────────
// 🔴 #609 是对 #608 的**翻面**：那版「右键 → 点一下自动整组重排」，用户裁定改成
//    「右键 → 弹窗里**拖拽手动排**」。编号规则仍走 `planSeriesReindexAll`（未变），
//    新增的只有 `moveItem`（把拖的那条搬到落点）—— 排序算法必须纯、可单测，
//    ⛔ 别把「搬数组」写进 Svelte 组件（组件里写就测不到，且两处必然漂）。
describe('pure/seriesGroup.moveItem（#609 拖拽排序 · 纯搬移）', () => {
    it('🔴 往后拖：把第 1 条搬到下标 3 ⇒ 其余整体前移一格，条数不变', () => {
        expect(moveItem(['a', 'b', 'c', 'd', 'e'], 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e']);
    });

    it('🔴 往前拖：把末条搬到下标 0 ⇒ 其余整体后移一格', () => {
        expect(moveItem(['a', 'b', 'c', 'd', 'e'], 4, 0)).toEqual(['e', 'a', 'b', 'c', 'd']);
    });

    it('🔴 不修改入参（返回**新数组**）—— 组件靠「整体换新数组」触发响应式', () => {
        const src = ['a', 'b', 'c'];
        const out = moveItem(src, 0, 2);
        expect(src).toEqual(['a', 'b', 'c']);
        expect(out).not.toBe(src);
    });

    it('🔴 越界 / 非整数 / 原地 ⇒ **原样副本**（弹窗里拿不到「拖出界」这种下标，但键盘 ↑↓ 会撞到边界）', () => {
        const src = ['a', 'b', 'c'];
        expect(moveItem(src, -1, 1)).toEqual(src);
        expect(moveItem(src, 3, 1)).toEqual(src);
        expect(moveItem(src, 0, 3)).toEqual(src);
        expect(moveItem(src, 1, 1)).toEqual(src);
        expect(moveItem(src, 1.5, 0)).toEqual(src);
        expect(moveItem(src, 0, Number.NaN)).toEqual(src);
    });

    it('单元素 / 空数组都不会炸（弹窗不会出现，但纯函数不该假设调用方）', () => {
        expect(moveItem(['a'], 0, 0)).toEqual(['a']);
        expect(moveItem([], 0, 0)).toEqual([]);
    });
});


// ── #438：系列操作面板「该继续哪一部」───────────────────────────────────
// 规则：在看 > 想看 > 第一条；「已看 / 存档」不优先（看完的再推一次是噪音）。
describe('pure/seriesGroup.nextSeriesEntry（面板里标「继续」的那一行）', () => {
    const s = (id: string, status: 'want' | 'watching' | 'watched' | 'archived') => ({ id, status });

    it('🔴 有「在看」⇒ 取最靠前的那个在看（用户已经在追它）', () => {
        expect(nextSeriesEntry([s('a', 'watched'), s('b', 'watching'), s('c', 'watching')])?.id).toBe('b');
    });

    it('没有在看 ⇒ 取最靠前的「想看」', () => {
        expect(nextSeriesEntry([s('a', 'watched'), s('b', 'want'), s('c', 'want')])?.id).toBe('b');
    });

    it('在看优先于想看（即使想看的排更前面）', () => {
        expect(nextSeriesEntry([s('a', 'want'), s('b', 'watching')])?.id).toBe('b');
    });

    it('🔴 全已看 / 全存档 ⇒ 退回第一条（⛔ 不返回 undefined）', () => {
        expect(nextSeriesEntry([s('a', 'watched'), s('b', 'watched')])?.id).toBe('a');
        expect(nextSeriesEntry([s('a', 'archived'), s('b', 'archived')])?.id).toBe('a');
    });

    it('「已看 / 存档」都不算候选（插在中间也不会被选中）', () => {
        expect(nextSeriesEntry([s('a', 'archived'), s('b', 'watched'), s('c', 'watching')])?.id).toBe('c');
    });

    it('空列表 ⇒ undefined（面板对空组不渲染，这里只保证不抛）', () => {
        expect(nextSeriesEntry([])).toBeUndefined();
    });

    it('只挑不改顺序：返回的是**同一个对象引用**（面板据此判等打标）', () => {
        const want = { id: 'w', status: 'want' as const };
        const arr = [{ id: 'a', status: 'watched' as const }, want];
        expect(nextSeriesEntry(arr)).toBe(want);
    });
});

// ──────────── 系列操作面板的版面算式（#438 次日改版：封面网格）────────────
//
// 🔴 这一组钉的是**一条 jsdom 量不到的性质**：「一行恰好放得下 cols 格」。
//    组件探针（jsdom）没有布局、`getBoundingClientRect` 恒为 0 ⇒ 换行与否只能在纯算式这一层钉住。
//    实证（2026-09-30 仿真页，真 Chrome）：少算 2px 边框 ⇒ 2 部就排成 1+1、3 册 2+1、4 列 3+2。
describe('系列面板版面算式（seriesPanel*）', () => {
    // 🔴 #442：默认一行 **6**（用户点名；原来 4 ⇒ 8 部折成 2 行、十几季折成 5 行，弹窗显示不全）
    it('列数 = 部数钳在 1~6（**默认一行 6**）', () => {
        expect(seriesPanelCols(1)).toBe(1);
        expect(seriesPanelCols(3)).toBe(3);
        expect(seriesPanelCols(6)).toBe(6);
        expect(seriesPanelCols(7)).toBe(6);
        expect(seriesPanelCols(8)).toBe(6);
        expect(seriesPanelCols(99)).toBe(6);
    });

    it('🔴 #442 自适应：给了「可用宽」就按它收列（装不下 6 列就少放几列）', () => {
        // 6 列需要 732；给 500 ⇒ 能放 floor((500-20-2+10)/120) = 4 列
        expect(seriesPanelCols(8, 500)).toBe(4);
        expect(seriesPanelCols(8, 900)).toBe(6);
        // 极窄也要保 1 列（⛔ 别出 0 列 / 负列）
        expect(seriesPanelCols(8, 60)).toBe(1);
    });

    it('不传 / 传 0 / 传非法 ⇒ 退化为「只看部数」（老调用不受影响）', () => {
        expect(seriesPanelCols(8)).toBe(6);
        expect(seriesPanelCols(8, 0)).toBe(6);
        expect(seriesPanelCols(8, Number.NaN)).toBe(6);
    });

    it('0 / 负数 / 非有限数一律当 1 列（不给零宽面板）', () => {
        expect(seriesPanelCols(0)).toBe(1);
        expect(seriesPanelCols(-3)).toBe(1);
        expect(seriesPanelCols(NaN)).toBe(1);
        expect(seriesPanelCols(Infinity)).toBe(1);
    });

    it('小数向下取整（部数本来就是整数，这里只保证不出现 2.5 列这种）', () => {
        expect(seriesPanelCols(2.9)).toBe(2);
        expect(seriesPanelCols(0.4)).toBe(1);
    });

    it('宽度 = clamp(320, 列数×110 + 间距 + 左右内距 + **边框 2px**, 732)', () => {
        expect(seriesPanelWidth(1)).toBe(320);   // 132 → 撞下限（弹窗太窄连标题都放不下）
        expect(seriesPanelWidth(2)).toBe(320);   // 252 → 撞下限
        expect(seriesPanelWidth(3)).toBe(372);   // 330 + 20 + 20 + 2
        expect(seriesPanelWidth(4)).toBe(492);   // 440 + 30 + 20 + 2
        expect(seriesPanelWidth(6)).toBe(732);   // 660 + 50 + 20 + 2（#442：满列那档）
    });

    it('超过 6 部不再长（封顶后换行）', () => {
        expect(seriesPanelWidth(7)).toBe(732);
        expect(seriesPanelWidth(12)).toBe(732);
        expect(seriesPanelWidth(7)).toBe(seriesPanelWidth(SERIES_COLS_MAX));
    });

    it('🔴 #442 视口窄 ⇒ 宽度跟着收（⛔ 别让弹窗比视口还宽，那会被 CSS 截窄、格子又换行）', () => {
        expect(seriesPanelWidth(8, 500)).toBe(492);   // 收成 4 列
        expect(seriesPanelWidth(8, 400)).toBe(372);   // 收成 3 列
        expect(seriesPanelWidth(8, 900)).toBe(732);   // 视口够宽 ⇒ 满列 6
        // 极窄：宽度也不会为负（CSS 的 max-width:100% 兜着，这里只保证算式不吐负数）
        expect(seriesPanelWidth(8, 40)).toBeGreaterThan(0);
    });

    it('宽度恒在 [MIN, MAX] 里（这是「居中弹窗」的下限与上限，见常量注释）', () => {
        for (let n = 1; n <= 20; n++) {
            expect(seriesPanelWidth(n)).toBeGreaterThanOrEqual(SERIES_PANEL_MIN_W);
            expect(seriesPanelWidth(n)).toBeLessThanOrEqual(SERIES_PANEL_MAX_W);
        }
        // 🔴 #442：MAX 必须装得下**满列**那档的算式值，否则被 CSS 截窄 ⇒ 又回到「每少一格都换行」
        expect(SERIES_PANEL_MAX_W).toBeGreaterThanOrEqual(seriesPanelFitWidth(SERIES_COLS_MAX));
        // 🔴 #444：MAX 现在由**宽窗档（9 列）**说了算 —— 而且是**等式**（⛔ 别手改其中一个）
        expect(SERIES_PANEL_MAX_W).toBe(seriesPanelFitWidth(SERIES_COLS_MAX_WIDE));
        expect(SERIES_PANEL_MAX_W).toBe(9 * SERIES_TILE_W + 8 * SERIES_TILE_GAP + 2 * SERIES_TILE_PAD + SERIES_ACT_BORDER);
        // 顺带钉住「默认一行 6」本身（用户点名；退回 4 会让 8 部折成 2 行、弹窗显示不全）
        expect(SERIES_COLS_MAX).toBe(6);
        // MIN 要够放下标题行（组名 + N 部 + 关闭钮）
        expect(SERIES_PANEL_MIN_W).toBeGreaterThanOrEqual(300);
    });

    it('🔴🔴 「一行恰好 cols 格」：可用宽必须 ≥ 这一行格子的总宽（含间距）—— 这条就是那 2px 边框的守卫', () => {
        for (let n = 1; n <= 12; n++) {
            const cols = seriesPanelCols(n);
            const need = cols * SERIES_TILE_W + (cols - 1) * SERIES_TILE_GAP;
            expect(seriesPanelTileSpace(n)).toBeGreaterThanOrEqual(need);
        }
    });

    it('🔴 反向守卫：⛔ 别退回「不算边框」的旧算式（少那 2px 的档位会排不进一行）', () => {
        expect(SERIES_ACT_BORDER).toBe(2);
        // ⚠️ 1~2 部撞了下限（窗宽由 MIN 说了算，与边框无关）、3 部正好还差得起那 2px
        //    ⇒ **只有 4 列那档是紧的**，它就是这条守卫的靶子（少算边框 ⇒ 468 < 470 ⇒ 第 4 格换行）。
        const cols = SERIES_COLS_MAX;
        const need = cols * SERIES_TILE_W + (cols - 1) * SERIES_TILE_GAP;
        // 「忘了边框」的算式值 —— 但 CSS 里那 2px 照样在扣 ⇒ 真正可用的比它再少 2px。
        const forgotBorder = cols * SERIES_TILE_W + (cols - 1) * SERIES_TILE_GAP + 2 * SERIES_TILE_PAD;
        expect(forgotBorder - SERIES_ACT_BORDER - 2 * SERIES_TILE_PAD).toBeLessThan(need); // 少了边框就不够
        expect(seriesPanelTileSpace(cols)).toBeGreaterThanOrEqual(need);                   // 带上边框刚好够
        // 而且是**恰好**顶满（等式而非不等式）—— 一旦有人动了格宽/内距/边框，这里立刻红
        expect(seriesPanelTileSpace(cols)).toBe(need);
    });
});

// ──────────── 折叠卡的**组状态徽标**（#438 次日：用户「系列折叠卡怎么没有标签状态显示的如想看存档之类的」）────────────
//
// 🔴 一个组里 N 条可以有 N 种状态，而卡面只放得下一枚徽标 ⇒ 口径 = **「建议接着看的那一条」的状态**
//    （= 面板里标「继续」的那一格，同一个纯函数、同一个优先级）。⛔ 视图层别另写判定。
describe('组状态徽标（seriesStatus）', () => {
    const st = (id: string, status: 'want' | 'watching' | 'watched' | 'archived') => ({ id, status });
    it('有「在看」⇒ 显示「在看」（它就是接着要看的）', () => {
        expect(seriesStatus([st('a', 'want'), st('b', 'watching')])).toBe('watching');
        expect(seriesStatus([st('a', 'watched'), st('b', 'watching')])).toBe('watching');
    });

    it('没有在看、有想看 ⇒ 显示「想看」', () => {
        expect(seriesStatus([st('a', 'archived'), st('b', 'want')])).toBe('want');
    });

    it('🔴 全部看完 / 全部存档 ⇒ 退回**首条**的状态（⛔ 不返回 undefined —— 那会让整行消失）', () => {
        expect(seriesStatus([st('a', 'watched'), st('b', 'watched')])).toBe('watched');
        expect(seriesStatus([st('a', 'archived'), st('b', 'archived')])).toBe('archived');
        expect(seriesStatus([st('a', 'watched'), st('b', 'archived')])).toBe('watched');   // 首条说了算
    });

    it('空组 ⇒ undefined（面板对空组不渲染，这里只保证不抛）', () => {
        expect(seriesStatus([])).toBeUndefined();
    });

    it('🔴🔴 与面板里标「继续」的那一格**同一条规则**（同一组数据两处结论必须一致 —— 两套判定必然漂移）', () => {
        const cases: Array<Array<'want' | 'watching' | 'watched' | 'archived'>> = [
            ['want', 'watching'],
            ['watched', 'want'],
            ['archived', 'watched'],
            ['want', 'archived'],
        ];
        for (const st of cases) {
            const items = st.map((x, i) => ({ id: String(i), status: x }));
            const live = items.filter((x) => x.status !== 'watched' && x.status !== 'archived');
            expect(seriesStatus(items)).toBe((nextSeriesEntry(live) ?? items[0]).status);
        }
    });
});

// ──────────── 面板加宽（#438 次日：用户「这个弹出效果不太好，给我继续做宽大点」）────────────
describe('封面尺寸三轮收敛（120 → 150 → **110**）', () => {
    it('🔴 定格 **110px**（封面 110×165）—— 用户「封面太大了」', () => {
        expect(SERIES_TILE_W).toBe(110);
    });

    it('🔴 反向守卫：⛔ 别退回 150（那是用户嫌「太大」的那一档）', () => {
        expect(SERIES_TILE_W).toBeLessThan(150);
    });

    it('🔴 也别再缩回「小到看不清」的一档（≥ 96 是封面能认出是哪一季的下限）', () => {
        expect(SERIES_TILE_W).toBeGreaterThanOrEqual(96);
    });
});

// ──────────── #444：列数上限**随视口分档**（用户 2026-09-30：
//   「一排默认显示 6 个，窗口拉宽后改为 9 个，拉窄后改为 4 或 3 个」）────────────
//
// 🔴 这一组钉的是**档位边界**：阈值不是拍脑袋的数字，而是由格宽算式导出（`seriesPanelFitWidth`）——
//    格宽 / 间距 / 内距 / 边框任何一个变了，边界自动跟着走（⛔ 别在别处再写一遍 `9×110+…`）。
// ──────────── 折叠卡的组级阅读进度（#472：用户「书籍类型下系列折叠卡没有进度条样式不一致」）────────────
describe('组级阅读进度（seriesReadPercent · 按部平均）', () => {
    const mk = (rp: { page?: number; totalPage?: number; percent?: number } | undefined, id = 'b') =>
        ({ ...e(id, 'book'), readingProgress: rp }) as MediaEntry;
    const pct = (p: number, id = 'b') => mk({ percent: p }, id);
    const pages = (page: number, totalPage: number, id = 'b') => mk({ page, totalPage }, id);
    const none = (id = 'b') => mk(undefined, id);

    it('3 部里 1 部读到 50%、另 2 部没读 ⇒ **17%**（没开始的部**按 0 计**，⛔ 不是只对有进度的求平均）', () => {
        expect(seriesReadPercent([pct(50, 'a'), none('b'), none('c')])).toBe(17);
    });

    it('全部读完 ⇒ 100%；**全都没进度 ⇒ undefined**（进度条不渲染 —— 与单卡「未开始不渲染灰线」同一口径）', () => {
        expect(seriesReadPercent([pct(100, 'a'), pct(100, 'b')])).toBe(100);
        expect(seriesReadPercent([none('a'), none('b')])).toBeUndefined();
        expect(seriesReadPercent([])).toBeUndefined();
    });

    it('🔴 每部的取值走**单卡同一口径** `readPercent`（percent 优先，无 percent 才按 page/totalPage）', () => {
        expect(seriesReadPercent([pages(3, 10, 'a'), pct(100, 'b')])).toBe(65);   // 30% + 100% ⇒ 65%
        expect(seriesReadPercent([pages(0, 200, 'a'), pct(100, 'b')])).toBe(50);  // 0% + 100%（有 totalPage 就算已开始）
    });

    it('四舍五入 + 钳在 0–100（单部超界也拉不爆整条）', () => {
        expect(seriesReadPercent([pct(130, 'a'), none('b')])).toBe(50);            // 100 + 0 ⇒ 50
        expect(seriesReadPercent([pct(1, 'a'), pct(1, 'b'), pct(2, 'c')])).toBe(1); // 1.33 ⇒ 1
    });

    it('非书籍条目（理论上进不了书籍组）按 0 计且不抛 —— `readPercent` 对非书恒 undefined', () => {
        expect(seriesReadPercent([e('m', 'movie') as MediaEntry, pct(100, 'b')])).toBe(50);
    });
});

describe('组内已读完的部数（seriesReadDone · 进度条右侧小字）', () => {
    const mk = (rp: { page?: number; totalPage?: number; percent?: number } | undefined, id = 'b') =>
        ({ ...e(id, 'book'), readingProgress: rp }) as MediaEntry;

    it('percent=100 与 page=totalPage **都算读完**；99% / 没进度不算', () => {
        expect(seriesReadDone([
            mk({ percent: 100 }, 'a'),
            mk({ page: 10, totalPage: 10 }, 'b'),
            mk({ percent: 99 }, 'c'),
            mk(undefined, 'd'),
        ])).toBe(2);
    });

    it('空组 ⇒ 0', () => {
        expect(seriesReadDone([])).toBe(0);
    });

    it('🔴 与 `seriesReadPercent` **同口径**：判定读完用的也是 `readPercent`（两处不一致必然漂移）', () => {
        const one = mk({ percent: 100 }, 'a');
        expect(seriesReadPercent([one])).toBe(100);
        expect(seriesReadDone([one])).toBe(1);
    });
});

describe('#444 弹窗列数随视口分档（6 / 9 / 4 / 3）', () => {
    it('档位常量：默认 6 · 宽 9 · 窄 4 · 极窄 3', () => {
        expect(SERIES_COLS_MAX).toBe(6);
        expect(SERIES_COLS_MAX_WIDE).toBe(9);
        expect(SERIES_COLS_MAX_NARROW).toBe(4);
        expect(SERIES_COLS_MAX_TIGHT).toBe(3);
    });

    it('seriesPanelFitWidth = 列数×110 + (列数-1)×10 + 左右内距 20 + 边框 2（与宽度算式**同一个真源**）', () => {
        expect(seriesPanelFitWidth(3)).toBe(372);
        expect(seriesPanelFitWidth(4)).toBe(492);
        expect(seriesPanelFitWidth(6)).toBe(732);
        expect(seriesPanelFitWidth(9)).toBe(1092);
        // 退化输入：0 / 负数 / 非数一律当 1 列（⛔ 不出 0 宽）
        expect(seriesPanelFitWidth(0)).toBe(seriesPanelFitWidth(1));
        expect(seriesPanelFitWidth(-3)).toBe(seriesPanelFitWidth(1));
        expect(seriesPanelFitWidth(Number.NaN)).toBe(seriesPanelFitWidth(1));
    });

    it('🔴 分档：够 9 列给 9；够 6 给 6；够 4 给 4；再窄给 3', () => {
        expect(seriesColsCap(1092)).toBe(9); // 恰好够 9 列那档
        expect(seriesColsCap(1200)).toBe(9);
        expect(seriesColsCap(1091)).toBe(6); // 差 1px 就掉回默认档
        expect(seriesColsCap(732)).toBe(6);
        expect(seriesColsCap(731)).toBe(4);
        expect(seriesColsCap(492)).toBe(4);
        expect(seriesColsCap(491)).toBe(3);
        expect(seriesColsCap(100)).toBe(3);
        expect(seriesColsCap(1)).toBe(3);
    });

    it('不传 / 0 / 非有限数 ⇒ 默认档 6（老调用与既有单测不受影响）', () => {
        expect(seriesColsCap()).toBe(6);
        expect(seriesColsCap(0)).toBe(6);
        expect(seriesColsCap(Number.NaN)).toBe(6);
        expect(seriesColsCap(Number.POSITIVE_INFINITY)).toBe(6);
    });

    it('🔴 上限只是**上限**：部数不够时列数照旧跟着部数走（3 部不会因为窗宽就摊成 9 格）', () => {
        expect(seriesPanelCols(3, 1400)).toBe(3);
        expect(seriesPanelCols(8, 1400)).toBe(8);
        expect(seriesPanelCols(12, 1400)).toBe(9); // 超过宽窗档才封顶
    });

    it('🔴 宽窗档下宽度能真的长到 1092（否则被 CSS 截窄 ⇒ 又回到「每少一格都换行」）', () => {
        expect(seriesPanelCols(9, 1400)).toBe(9);
        expect(seriesPanelWidth(9, 1400)).toBe(1092);
        expect(seriesPanelTileSpace(9, 1400)).toBe(9 * SERIES_TILE_W + 8 * SERIES_TILE_GAP);
    });

    it('🔴 窄窗档（4 / 3）宽度也跟着收', () => {
        expect(seriesPanelCols(8, 700)).toBe(4); // 700 落在 [492, 732) ⇒ 4 档
        expect(seriesPanelWidth(8, 700)).toBe(492);
        expect(seriesPanelCols(8, 400)).toBe(3); // 400 落在 [0, 492) ⇒ 3 档
        expect(seriesPanelWidth(8, 400)).toBe(372);
    });

    it('🔴🔴 「一行恰好 cols 格」在各档位下都成立（含 9 列那档 —— 少算 2px 边框就会换行）', () => {
        for (const availW of [1400, 1200, 1092, 900, 700, 492, 400, 300]) {
            const cols = seriesPanelCols(20, availW);
            const need = cols * SERIES_TILE_W + (cols - 1) * SERIES_TILE_GAP;
            expect(seriesPanelTileSpace(20, availW)).toBeGreaterThanOrEqual(need);
        }
    });

    it('🔴 9 列那档是**恰好顶满**（等式而非不等式）—— 格宽 / 内距 / 边框任一被动就会红', () => {
        expect(seriesPanelTileSpace(SERIES_COLS_MAX_WIDE, 1400)).toBe(
            SERIES_COLS_MAX_WIDE * SERIES_TILE_W + (SERIES_COLS_MAX_WIDE - 1) * SERIES_TILE_GAP,
        );
    });
});

describe('pure/seriesGroup 列表视图树形行序（#592：合集整体置顶 + 组间按代表值）', () => {
    /** 造一条带「更新时间 / 评分 / 个人分 / 年份」的条目（`listTreeRows` 的代表值全靠它们） */
    function rich(id: string, series: string | undefined, opt: {
        updatedAt?: string; communityScore?: number; rating?: number; year?: number; type?: EntryType;
    } = {}): MediaEntry {
        return {
            id,
            type: opt.type ?? 'movie',
            title: `作品${id}`,
            series,
            updatedAt: opt.updatedAt ?? '2026-01-01T00:00:00.000Z',
            communityScore: opt.communityScore,
            rating: opt.rating ?? 0,
            year: opt.year,
            links: [],
            progress: {},
        } as unknown as MediaEntry;
    }

    it('🔴🔴 合集恒在单集之前（不论单集的排序多么「新」—— 用户点名「绝不混排」）', () => {
        const rows = listTreeRows(
            [
                rich('a1', undefined, { updatedAt: '2026-10-09T00:00:00.000Z' }), // 单集，最新
                rich('s1', '熊出没', { updatedAt: '2020-01-01T00:00:00.000Z' }),
                rich('s2', '熊出没', { updatedAt: '2020-02-01T00:00:00.000Z' }),
            ],
            'recent',
        );
        expect(rows.map((r) => (r.kind === 'series' ? 'S' : 's'))).toEqual(['S', 's']);
        expect(rows[0].kind === 'series' && rows[0].group.items.map((i) => i.id)).toEqual(['s1', 's2']);
    });

    it('只有 1 条的组**不成合集**（与 foldSeries 同口径）—— 它并进单集、按原序留在后面', () => {
        const rows = listTreeRows([rich('a1', '独苗'), rich('b1', undefined)], 'recent');
        expect(rows.every((r) => r.kind === 'single')).toBe(true);
        expect(rows.map((r) => (r.kind === 'single' ? r.entry.id : ''))).toEqual(['a1', 'b1']);
    });

    it('🔴 单集**保持传入顺序**（入口 filterAndSort 已排好，这里只搬运、不再排一遍）', () => {
        const rows = listTreeRows([rich('x', undefined), rich('y', undefined), rich('z', undefined)], 'recent');
        expect(rows.map((r) => (r.kind === 'single' ? r.entry.id : ''))).toEqual(['x', 'y', 'z']);
    });

    it('🔴 组间代表值 · 最近更新：↓ 取组内**最新**、↑ 取组内**最旧**', () => {
        const old = [rich('o1', 'A', { updatedAt: '2020-01-01T00:00:00.000Z' }), rich('o2', 'A', { updatedAt: '2020-06-01T00:00:00.000Z' })];
        const neu = [rich('n1', 'B', { updatedAt: '2026-01-01T00:00:00.000Z' }), rich('n2', 'B', { updatedAt: '2026-02-01T00:00:00.000Z' })];
        const order = (sortBy: 'recent' | 'recent-asc') =>
            listTreeRows([...old, ...neu], sortBy).map((r) => (r.kind === 'series' ? r.group.name : ''));
        expect(order('recent')).toEqual(['B', 'A']);
        expect(order('recent-asc')).toEqual(['A', 'B']);
    });

    it('🔴 组间代表值 · 评分 = 组内**按部平均**，且缺值的部**按 0 计入分母**（⛔ 不 skip）', () => {
        // A：1 部 9 分 + 1 部没分 ⇒ 平均 4.5；B：2 部都 5 分 ⇒ 平均 5 ⇒ B 在前
        const gA = [rich('a1', 'A', { communityScore: 9 }), rich('a2', 'A', {})];
        const gB = [rich('b1', 'B', { communityScore: 5 }), rich('b2', 'B', { communityScore: 5 })];
        const order = (sortBy: 'score-desc' | 'score-asc') =>
            listTreeRows([...gA, ...gB], sortBy).map((r) => (r.kind === 'series' ? r.group.name : ''));
        expect(order('score-desc')).toEqual(['B', 'A']);
        expect(order('score-asc')).toEqual(['A', 'B']);
    });

    it('🔴 组间代表值 · 标题：按**组名** zh 排序（组名走 seriesTitleOf 单一真源）', () => {
        const gA = [rich('a1', '阿凡达'), rich('a2', '阿凡达')];
        const gB = [rich('b1', '熊出没'), rich('b2', '熊出没')];
        const names = listTreeRows([...gB, ...gA], 'title-asc').map((r) => (r.kind === 'series' ? r.group.name : ''));
        expect(names).toEqual(['阿凡达', '熊出没']);
    });

    it('🔴 组间代表值 · 发布日期 = 组内**最大**年份（与 filterAndSort 的 `year ?? 0` 同口径）', () => {
        const gA = [rich('a1', 'A', { year: 2019 }), rich('a2', 'A', { year: 2015 })];
        const gB = [rich('b1', 'B', { year: 2021 }), rich('b2', 'B', { year: 2016 })];
        const order = (sortBy: 'release-desc' | 'release-asc') =>
            listTreeRows([...gA, ...gB], sortBy).map((r) => (r.kind === 'series' ? r.group.name : ''));
        expect(order('release-desc')).toEqual(['B', 'A']);
        expect(order('release-asc')).toEqual(['A', 'B']);
    });

    it('主判据相等 ⇒ 按分组键兜底（同一份数据两次渲染**不会换位**）', () => {
        const gA = [rich('a1', 'A', { year: 2020 }), rich('a2', 'A', { year: 2020 })];
        const gB = [rich('b1', 'B', { year: 2020 }), rich('b2', 'B', { year: 2020 })];
        const once = listTreeRows([...gA, ...gB], 'release-desc').map((r) => (r.kind === 'series' ? r.group.name : ''));
        const twice = listTreeRows([...gB, ...gA], 'release-desc').map((r) => (r.kind === 'series' ? r.group.name : ''));
        expect(once).toEqual(twice);
    });

    it('海报墙用的 foldSeries **一字未改**（仍把折叠卡落在组内首个成员的位置）', () => {
        const rows = foldSeries([rich('a1', undefined), rich('s1', '熊出没'), rich('s2', '熊出没')]);
        expect(rows.map((r) => (r.kind === 'series' ? 'S' : 's'))).toEqual(['s', 'S']);
    });
    it('🔴 显示行：折叠的合集只出父级行；展开后才把它那批成员**插在父级之后**（子行带 child 标记）', () => {
        const rows = listTreeRows([rich('s1', '熊出没'), rich('s2', '熊出没'), rich('a1', undefined)], 'recent');
        const key = rows.find((r) => r.kind === 'series');
        expect(key).toBeTruthy();
        const k = key && key.kind === 'series' ? key.group.key : '';

        const collapsed = listDisplayRows(rows, []);
        expect(collapsed.map((r) => (r.kind === 'group' ? 'G' : r.child ? 'c:' + r.entry.id : 'e:' + r.entry.id)))
            .toEqual(['G', 'e:a1']);

        const open = listDisplayRows(rows, [k]);
        expect(open.map((r) => (r.kind === 'group' ? 'G' : r.child ? 'c:' + r.entry.id : 'e:' + r.entry.id)))
            .toEqual(['G', 'c:s1', 'c:s2', 'e:a1']);
    });

    it('🔴 单集行与子行共用同一段行 markup ⇒ 单集的 child 恒为 false（⛔ 别把它也缩进）', () => {
        const rows = listTreeRows([rich('s1', '熊出没'), rich('s2', '熊出没'), rich('a1', undefined)], 'recent');
        const open = listDisplayRows(rows, rows[0].kind === 'series' ? [rows[0].group.key] : []);
        const singles = open.filter((r) => r.kind === 'entry' && !r.child);
        expect(singles.map((r) => (r.kind === 'entry' ? r.entry.id : ''))).toEqual(['a1']);
    });

    it('展开键里混入**已不成组**的旧键 ⇒ 静默忽略（不抛错、不多出行）', () => {
        const rows = listTreeRows([rich('a1', undefined)], 'recent');
        expect(listDisplayRows(rows, ['movie\u0001不存在的系列'])).toHaveLength(1);
    });
});

