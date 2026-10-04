/**
 * `pure/biliBatch` 单测（#519）—— 「批量搜索未填集」的全部纯逻辑。
 * 🔴 这里钉的是**约束**，不是实现细节：范围只认总集数、已填集绝不进列表、
 *    默认取第一条、分P 胶囊「未知 ⇒ 不显示」、勾选与禁用口径。
 */
import { describe, expect, it } from 'vitest';
import {
    BATCH_GAP_MS,
    BATCH_PARTS_ANCHOR,
    applyBatchResult,
    batchCheckedRows,
    batchProgressText,
    batchSleep,
    batchStopText,
    buildBatchTargets,
    canExpandParts,
    canFillBatch,
    candidatesToMark,
    epRangeOf,
    filterTargetsByRange,
    isSinglePartCandidate,
    makeBatchRows,
    normalizeEpRange,
    partCountLabel,
    pickedCandidate,
    pickedUrl,
    runBatchSearch,
    titleMatchesWork,
    unfilledEpIndexes,
    withChecked,
    withPartCount,
    withPicked,
    type BatchRow,
} from 'pure/biliBatch';
import type { BiliVideo } from 'pure/dl/bilibili';

function vid(bvid: string, title = `视频 ${bvid}`): BiliVideo {
    return {
        bvid,
        title,
        author: 'UP',
        durationSec: 100,
        coverUrl: undefined,
        play: 1,
        category: undefined,
        webUrl: `https://www.bilibili.com/video/${bvid}`,
    };
}

function row(patch: Partial<BatchRow> = {}): BatchRow {
    return {
        epIndex: 1,
        epNo: 2,
        query: '熊出没 第2集',
        workTitle: '',
        videos: [],
        partCounts: {},
        picked: -1,
        matched: false,
        checked: false,
        manual: false,
        error: '',
        ...patch,
    };
}

describe('unfilledEpIndexes（范围只认总集数）', () => {
    it('全空 ⇒ 0..total-1', () => {
        expect(unfilledEpIndexes([], 3)).toEqual([0, 1, 2]);
    });

    it('🔴 已填的集一律不进列表（用户裁定：不得跨集覆盖）', () => {
        expect(unfilledEpIndexes(['https://a', undefined, 'https://c', undefined], 4)).toEqual([1, 3]);
    });

    it('空白串算未填（与「trim 后才算填过」同口径）', () => {
        expect(unfilledEpIndexes(['   ', '\t'], 2)).toEqual([0, 1]);
    });

    it('🔴 范围以**总集数**为准，⛔ 不是数组长度：数组比 total 短 ⇒ 照样补足', () => {
        expect(unfilledEpIndexes(['https://a'], 4)).toEqual([1, 2, 3]);
    });

    it('数组比 total 长 ⇒ 按 total 截断（后面的集不算本条目范围）', () => {
        expect(unfilledEpIndexes([undefined, undefined, undefined], 2)).toEqual([0, 1]);
    });

    it('total 非法（NaN / 0 / 负数）⇒ 空列表（⛔ 不产生越界集号）', () => {
        expect(unfilledEpIndexes([], Number.NaN)).toEqual([]);
        expect(unfilledEpIndexes([undefined], 0)).toEqual([]);
        expect(unfilledEpIndexes([undefined], -5)).toEqual([]);
    });

    it('urls 不是数组 ⇒ 全部未填（防御）', () => {
        expect(unfilledEpIndexes(undefined, 2)).toEqual([0, 1]);
    });

    it('稀疏洞（中间某集空着）⇒ 那个集号照样进列表', () => {
        const urls: (string | undefined)[] = ['https://a'];
        urls[2] = 'https://c';
        expect(unfilledEpIndexes(urls, 3)).toEqual([1]);
    });
});

describe('buildBatchTargets（检索词与单集搜索同一份真源）', () => {
    it('集标题为空 ⇒ 用「第N集」补位（与单集搜索同一份 `biliEpisodeQuery`）', () => {
        const t = buildBatchTargets('熊出没', [undefined, undefined], 2, ['', '']);
        expect(t).toEqual([
            { epIndex: 0, epNo: 1, query: '熊出没 第1集' },
            { epIndex: 1, epNo: 2, query: '熊出没 第2集' },
        ]);
    });

    it('有集标题 ⇒ 作品标题 + 集标题（⛔ 不追加集号）', () => {
        const t = buildBatchTargets('熊出没', [undefined], 1, ['新邻居']);
        expect(t).toEqual([{ epIndex: 0, epNo: 1, query: '熊出没 新邻居' }]);
    });

    it('⛔ 只列**未填**的集（已填的不搜、不动）', () => {
        const t = buildBatchTargets('熊出没', ['https://a', undefined], 2, ['开始', '新邻居']);
        expect(t.map((x) => x.epNo)).toEqual([2]);
    });

    it('titles 不给（缺省空数组）⇒ 照样按集号补位', () => {
        expect(buildBatchTargets('熊出没', [undefined], 1)[0].query).toBe('熊出没 第1集');
    });
});

describe('makeBatchRows / applyBatchResult（行模型）', () => {
    it('初始行：没有候选、不勾、不选中（还没搜过）', () => {
        const rows = makeBatchRows([{ epIndex: 1, epNo: 2, query: 'q' }]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ epIndex: 1, epNo: 2, query: 'q', picked: -1, checked: false, error: '' });
        expect(rows[0].videos).toEqual([]);
    });

    it('🔴 搜到候选 ⇒ 默认选中**第一条** + 默认勾上（纯函数，返回新对象）', () => {
        const before = row();
        const after = applyBatchResult(before, { videos: [vid('BV1'), vid('BV2')] });
        expect(after).not.toBe(before);
        expect(after.picked).toBe(0);
        expect(after.checked).toBe(true);
        expect(before.picked).toBe(-1); // ⛔ 不改原对象
    });

    it('没搜到（空列表 / videos 缺失）⇒ 不选中、不勾', () => {
        expect(applyBatchResult(row(), { videos: [] })).toMatchObject({ picked: -1, checked: false });
        expect(applyBatchResult(row(), {})).toMatchObject({ picked: -1, checked: false });
        expect(applyBatchResult(row(), undefined)).toMatchObject({ picked: -1, checked: false });
    });

    it('失败原因原样带出（⛔ 不吞）', () => {
        const after = applyBatchResult(row(), { videos: [], error: 'B 站返回 412（风控）' });
        expect(after.error).toBe('B 站返回 412（风控）');
        expect(after.picked).toBe(-1);
    });
});

// #520（2026-10-04 用户报障）：「还有一些标题完全不符合的怎么也勾选上了」——
// 批量搜「某一集」时 B 站常把整季合集 / 别的子系列排前面，那些标题里没有本条目作品名却被默认勾上。
// 用户在两档里挑了 **「标题要含作品名」**。另加：**集数区间**（只搜第 20–60 集这种）。
describe('#520 自动勾选判据：标题含作品名', () => {
    it('🔴 标题含作品名 ⇒ 默认勾；不含 ⇒ **不勾**（但仍选中第一条，供手勾）', () => {
        const hit = { videos: [vid('BV1', '【熊出没之春日对对碰】第2集')] };
        const ok = applyBatchResult(row({ workTitle: '熊出没之春日对对碰' }), hit);
        expect(ok.matched).toBe(true);
        expect(ok.checked).toBe(true);
        expect(ok.picked).toBe(0);

        const bad = applyBatchResult(row({ workTitle: '熊出没之春日对对碰' }), { videos: [vid('BV2', '【熊出没之探险日记】01')] });
        expect(bad.matched).toBe(false);
        expect(bad.checked).toBe(false);
        expect(bad.picked).toBe(0); // ⚠️ 仍然选中第一条 —— 只是不替用户勾上
    });

    it('归一：大小写 + 所有空白都不影响判定（标题里塞空格很常见）', () => {
        // 真实形态：作品名在标题里是**连着**的（外面可能套着 `【】`/`[4k]` 之类装饰）
        expect(titleMatchesWork('【4K】【熊出没之春日对对碰】第02集', ' 熊出没之春日对对碰 ')).toBe(true);
        expect(titleMatchesWork('BLEACH 千年血战篇  第2集', 'bleach千年血战篇')).toBe(true);
        expect(titleMatchesWork('【熊出没之探险日记】01', '熊出没之春日对对碰')).toBe(false);
    });

    it('⚠️ 作品名为空 ⇒ **恒真**（没有判据可用时别把所有行都判成「不符合」）', () => {
        expect(titleMatchesWork('随便什么标题', '')).toBe(true);
        expect(titleMatchesWork('随便什么标题', '   ')).toBe(true);
        const r = applyBatchResult(row({ workTitle: '' }), { videos: [vid('BV1', '随便')] });
        expect(r.matched).toBe(true);
        expect(r.checked).toBe(true);
    });

    it('🔴 手动「换一条」= 人看过了 ⇒ **一律勾上**，但 `matched` 仍按新那条重算（只用于显示提示）', () => {
        const r = row({ workTitle: '熊出没', videos: [vid('BV1', '熊出没 第2集'), vid('BV2', '无关视频')], picked: 0 });
        const after = withPicked(r, 1);
        expect(after.checked).toBe(true);
        expect(after.matched).toBe(false);
        expect(withPicked(r, 0).matched).toBe(true);
    });

    it('没搜到 / 失败 ⇒ `matched` 恒假、不勾', () => {
        expect(applyBatchResult(row({ workTitle: '熊出没' }), { videos: [] })).toMatchObject({ matched: false, checked: false });
        expect(applyBatchResult(row({ workTitle: '熊出没' }), { videos: [], error: '风控' })).toMatchObject({ matched: false, checked: false });
    });

    it('`makeBatchRows` 把作品名带到每一行上（判据靠它）', () => {
        const rows = makeBatchRows([{ epIndex: 0, epNo: 1, query: 'q' }], '熊出没');
        expect(rows[0].workTitle).toBe('熊出没');
        expect(rows[0].matched).toBe(false);
    });
});

describe('#520 集数区间', () => {
    it('归一：非法值落回该侧默认；两端填反自动对调', () => {
        expect(normalizeEpRange(20, 60, 1, 100)).toEqual({ from: 20, to: 60 });
        expect(normalizeEpRange(60, 20, 1, 100)).toEqual({ from: 20, to: 60 });
        expect(normalizeEpRange('', '', 3, 40)).toEqual({ from: 3, to: 40 });
        expect(normalizeEpRange(Number.NaN, 5, 3, 40)).toEqual({ from: 3, to: 5 });
    });

    it('🔴 一律**钳**在本条目（未填集的）边界内，⛔ 不产生越界区间', () => {
        expect(normalizeEpRange(0, 999, 5, 52)).toEqual({ from: 5, to: 52 });
        expect(normalizeEpRange(-8, 0, 5, 52)).toEqual({ from: 5, to: 5 });
    });

    it('没有未填集（min>max / 边界为 0）⇒ 空区间', () => {
        expect(normalizeEpRange(1, 5, 0, 0)).toEqual({ from: 0, to: 0 });
        expect(normalizeEpRange(1, 5, 7, 3)).toEqual({ from: 0, to: 0 });
    });

    it('`epRangeOf` = 这批目标的第一个 ~ 最后一个集号；空 ⇒ 空区间', () => {
        const t = (n: number) => ({ epIndex: n - 1, epNo: n, query: 'q' });
        expect(epRangeOf([t(20), t(21), t(60)])).toEqual({ from: 20, to: 60 });
        expect(epRangeOf([])).toEqual({ from: 0, to: 0 });
    });

    it('🔴 过滤是**闭区间**（第 20 与第 60 都算在内）', () => {
        const t = (n: number) => ({ epIndex: n - 1, epNo: n, query: 'q' });
        const all = [t(19), t(20), t(21), t(60), t(61)];
        expect(filterTargetsByRange(all, { from: 20, to: 60 }).map((x) => x.epNo)).toEqual([20, 21, 60]);
    });

    it('空区间 ⇒ 空列表（⛔ 不会退化成「全选」）', () => {
        const t = (n: number) => ({ epIndex: n - 1, epNo: n, query: 'q' });
        expect(filterTargetsByRange([t(1), t(2)], { from: 0, to: 0 })).toEqual([]);
        expect(filterTargetsByRange([t(1), t(2)], { from: 5, to: 3 })).toEqual([]);
    });
});

describe('分P 标记（区分「单集投稿」与「整季合集」）', () => {
    it('🔴 胶囊文案：1 ⇒ `1P`、52 ⇒ `52P`', () => {
        expect(partCountLabel(1)).toBe('1P');
        expect(partCountLabel(52)).toBe('52P');
    });

    it('⚠️ 未知（没问过 / 取不到）⇒ **空串**（⛔ 不显示 `?P`、不显示 `0P`）', () => {
        expect(partCountLabel(0)).toBe('');
        expect(partCountLabel(-1)).toBe('');
        expect(partCountLabel(Number.NaN)).toBe('');
    });

    it('记分P 数：写进 `partCounts[bvid]`（纯函数，返回新对象）', () => {
        const before = row({ videos: [vid('BV1')], picked: 0, checked: true });
        const after = withPartCount(before, 'BV1', 52);
        expect(after.partCounts).toEqual({ BV1: 52 });
        expect(before.partCounts).toEqual({}); // ⛔ 不改原对象
    });

    it('⛔ 非法值（0 / 负数 / NaN / 空 bvid）⇒ **原样返回**（别把「没问过」写成「问出来是 0」）', () => {
        const r = row({ videos: [vid('BV1')] });
        expect(withPartCount(r, 'BV1', 0)).toBe(r);
        expect(withPartCount(r, 'BV1', Number.NaN)).toBe(r);
        expect(withPartCount(r, '', 5)).toBe(r);
    });

    it('多条候选各记各的（不互相覆盖）', () => {
        const a = withPartCount(row(), 'BV1', 1);
        const b = withPartCount(a, 'BV2', 52);
        expect(b.partCounts).toEqual({ BV1: 1, BV2: 52 });
    });
});

describe('选中与勾选', () => {
    it('`pickedCandidate` / `pickedUrl`：跟选中走；无候选 ⇒ undefined / 空串', () => {
        const r = row({ videos: [vid('BV1'), vid('BV2')], picked: 1 });
        expect(pickedCandidate(r)?.bvid).toBe('BV2');
        expect(pickedUrl(r)).toBe('https://www.bilibili.com/video/BV2');
        expect(pickedCandidate(row())).toBeUndefined();
        expect(pickedUrl(row())).toBe('');
        expect(pickedUrl(undefined)).toBe('');
    });

    it('「换一条」：换选即视作要填这一行（自动勾上）', () => {
        const r = row({ videos: [vid('BV1'), vid('BV2')], picked: 0, checked: false });
        const after = withPicked(r, 1);
        expect(after.picked).toBe(1);
        expect(after.checked).toBe(true);
    });

    it('🔴 越界 / 非法下标 ⇒ **原样返回**（⛔ 不产生越界选中）', () => {
        const r = row({ videos: [vid('BV1')], picked: 0 });
        expect(withPicked(r, 5)).toBe(r);
        expect(withPicked(r, -1)).toBe(r);
        expect(withPicked(r, Number.NaN)).toBe(r);
    });

    it('`withChecked` 幂等（同值**且已手动过** ⇒ 不换新对象）'
        + '｜🔴 #526：首次手动勾/取消要**换新对象**（`manual` 得记下来，否则后台标分P 会把用户的选择回退掉）', () => {
        const r = row();
        const once = withChecked(r, false);
        expect(once).not.toBe(r);       // 首次 ⇒ 换新（写下 manual）
        expect(once.manual).toBe(true); // ⚠️ 取消勾**也算**手动决定
        expect(withChecked(once, false)).toBe(once); // 同值 + 已手动 ⇒ 幂等
        expect(withChecked(r, true).checked).toBe(true);
        expect(withChecked(r, true).manual).toBe(true);
    });

    it('🔴 `batchCheckedRows`：勾了但**没有链接**的行不算（⛔ 不写空链接）', () => {
        const ok = row({ epIndex: 0, videos: [vid('BV1')], picked: 0, checked: true });
        const noVideo = row({ epIndex: 1, videos: [], picked: -1, checked: true });
        const unchecked = row({ epIndex: 2, videos: [vid('BV2')], picked: 0, checked: false });
        expect(batchCheckedRows([ok, noVideo, unchecked]).map((r) => r.epIndex)).toEqual([0]);
        expect(canFillBatch([ok, noVideo, unchecked])).toBe(true);
        expect(canFillBatch([noVideo, unchecked])).toBe(false);
        expect(canFillBatch([])).toBe(false);
        expect(canFillBatch(undefined)).toBe(false);
    });
});

describe('进度与停下文案（两入口共用一份）', () => {
    it('跑动中：带上已处理集数与当前集号', () => {
        expect(batchProgressText(11, 52, 12)).toBe('正在搜索 11/52 · 第 12 集…');
    });

    it('没有当前集号 ⇒ 只报进度；越界值被钳制', () => {
        expect(batchProgressText(0, 52, 0)).toBe('正在搜索 0/52…');
        expect(batchProgressText(99, 52, 0)).toBe('正在搜索 52/52…');
    });

    it('🔴 遇错停下：把「停在第几集」和原因一起说出来', () => {
        expect(batchStopText(12, 'B 站返回 412（风控）')).toBe('已搜到第 12 集就停下了：B 站返回 412（风控）');
        expect(batchStopText(12, '')).toBe('已搜到第 12 集，已停止');
        expect(batchStopText(0, '网络错误')).toBe('刚开始就停下了：网络错误');
        expect(batchStopText(0, '')).toBe('已停止');
    });
});

describe('限速', () => {
    it('`BATCH_GAP_MS` 是个正经的正数（两入口共用这一份）', () => {
        expect(BATCH_GAP_MS).toBeGreaterThan(0);
    });

    it('`batchSleep(0)` 在下一个 tick resolve（单测不真等 600ms）', async () => {
        await expect(batchSleep(0)).resolves.toBeUndefined();
    });
});

describe('candidatesToMark（换一条时才补标）', () => {
    it('🔴 只取**前 N 条**里还没标过的（⛔ 不重复问、⛔ 不问第 4 条之后）', () => {
        const videos = [vid('BV1'), vid('BV2'), vid('BV3'), vid('BV4')];
        const r = withPartCount(row({ videos }), 'BV1', 1);
        expect(candidatesToMark(r, 3).map((v) => v.bvid)).toEqual(['BV2', 'BV3']);
    });

    it('都标过了 ⇒ 空数组（不白跑请求）', () => {
        let r = row({ videos: [vid('BV1'), vid('BV2')] });
        r = withPartCount(withPartCount(r, 'BV1', 1), 'BV2', 52);
        expect(candidatesToMark(r, 3)).toEqual([]);
    });

    it('没有候选 / limit 非法 ⇒ 空数组', () => {
        expect(candidatesToMark(row(), 3)).toEqual([]);
        expect(candidatesToMark(undefined, 3)).toEqual([]);
        expect(candidatesToMark(row({ videos: [vid('BV1')] }), 0)).toEqual([]);
    });
});

describe('runBatchSearch（唯一一份跑批循环）', () => {
    const targets = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ epIndex: i, epNo: i + 1, query: `熊出没 第${i + 1}集` }));

    /** 假 IO：search 每集给两条候选，parts 给**单P**（#526 起「多P 会取消自动勾」，夹具取最常见的单集投稿） */
    function hooks(over: Record<string, unknown> = {}) {
        const calls: string[] = [];
        const updates: string[] = [];
        const h = {
            calls,
            updates,
            search: async (kw: string) => {
                calls.push(`search:${kw}`);
                return { videos: [vid(`BV-${kw}-1`), vid(`BV-${kw}-2`)] };
            },
            parts: async (bvid: string) => {
                calls.push(`parts:${bvid}`);
                return { parts: [{ page: 1, title: '', durationSec: 1 }] };
            },
            onUpdate: (rows: BatchRow[], done: number, total: number, epNo: number) =>
                updates.push(`${done}/${total}/${epNo}`),
            shouldContinue: () => true,
            sleep: async () => {},
            ...over,
        };
        return h;
    }

    it('🔴 串行跑完：逐集搜索 + 只给**第一条**标分P 数；`nextIndex` 落在末尾、`done = true`', async () => {
        const h = hooks();
        const out = await runBatchSearch(makeBatchRows(targets(3)), h);
        expect(out.done).toBe(true);
        expect(out.reason).toBe('');
        expect(out.nextIndex).toBe(3);
        expect(out.lastEpNo).toBe(3);
        // 每集恰好 search 一次 + parts 一次（⛔ 不问第二条）
        expect(h.calls.filter((c) => c.startsWith('search:'))).toHaveLength(3);
        expect(h.calls.filter((c) => c.startsWith('parts:'))).toHaveLength(3);
        expect(h.calls[1]).toBe('parts:BV-熊出没 第1集-1');
        // 行：默认选中第一条 + 勾上 + 分P 数已标（单P ⇒ 不触发 #526 的「多P 取消自动勾」）
        expect(out.rows.every((r) => r.picked === 0 && r.checked)).toBe(true);
        expect(out.rows.every((r) => r.partCounts[r.videos[0].bvid] === 1)).toBe(true);
    });

    it('🔴 #526 跑批里标出**多P** ⇒ 该行自动勾选被取消（静默填 P1 会指向第 1 集）', async () => {
        const h = hooks({
            parts: async (bvid: string) => {
                h.calls.push(`parts:${bvid}`);
                return { parts: Array.from({ length: 52 }, (_, i) => ({ page: i + 1, title: '', durationSec: 1 })) };
            },
        });
        const out = await runBatchSearch(makeBatchRows(targets(2)), h);
        expect(out.done).toBe(true);
        expect(out.rows.every((r) => r.partCounts[r.videos[0].bvid] === 52)).toBe(true);
        expect(out.rows.every((r) => r.checked)).toBe(false);
        // 行仍然**有候选**（链接可用、可手勾、可「展开分P」），⛔ 不是被丢掉
        expect(out.rows.every((r) => r.picked === 0)).toBe(true);
    });

    it('🔴 全程**串行**（不是并发）：calls 必定是「search, parts, search, parts…」交替', async () => {
        const h = hooks();
        await runBatchSearch(makeBatchRows(targets(2)), h);
        expect(h.calls).toEqual([
            'search:熊出没 第1集',
            'parts:BV-熊出没 第1集-1',
            'search:熊出没 第2集',
            'parts:BV-熊出没 第2集-1',
        ]);
    });

    it('限速：N 集之间 sleep **N-1** 次（⛔ 最后一集后面不再等）', async () => {
        let sleeps = 0;
        const h = hooks({ sleep: async () => { sleeps += 1; } });
        await runBatchSearch(makeBatchRows(targets(4)), h);
        expect(sleeps).toBe(3);
    });

    it('🔴 **遇错即停**：第 2 集失败 ⇒ 立刻结束、`nextIndex` 落回**出错那一集**（好重试）、后面的集一次没搜', async () => {
        const h = hooks({
            search: async (kw: string) => {
                h.calls.push(`search:${kw}`);
                if (kw.includes('第2集')) return { videos: [], error: 'B 站返回 412（风控）' };
                return { videos: [vid('BV1')] };
            },
        });
        const out = await runBatchSearch(makeBatchRows(targets(3)), h);
        expect(out.done).toBe(false);
        expect(out.reason).toBe('B 站返回 412（风控）');
        expect(out.nextIndex).toBe(1);
        expect(out.lastEpNo).toBe(2);
        expect(h.calls.filter((c) => c.startsWith('search:'))).toHaveLength(2);
        expect(out.rows[0].checked).toBe(true);
        expect(out.rows[1].error).toContain('412');
        expect(out.rows[2].videos).toEqual([]); // 后面的集没搜
    });

    it('「继续」从 `nextIndex` 接着跑（重试出错那一集，不是跳过它）', async () => {
        let fail = true;
        const h = hooks({
            search: async (kw: string) => {
                h.calls.push(`search:${kw}`);
                if (kw.includes('第2集') && fail) return { videos: [], error: '风控' };
                return { videos: [vid('BV1')] };
            },
        });
        const first = await runBatchSearch(makeBatchRows(targets(3)), h);
        fail = false;
        const second = await runBatchSearch(first.rows, h, first.nextIndex);
        expect(second.done).toBe(true);
        expect(second.rows[1].error).toBe('');
        expect(second.rows[1].checked).toBe(true);
    });

    it('⚠️ 分P 数**取不到不算失败**：链接照常可用、胶囊留空、继续往下跑', async () => {
        const h = hooks({ parts: async () => ({ parts: [], error: '读取分P失败' }) });
        const out = await runBatchSearch(makeBatchRows(targets(2)), h);
        expect(out.done).toBe(true);
        expect(out.rows.every((r) => r.checked)).toBe(true);
        expect(out.rows.every((r) => Object.keys(r.partCounts).length === 0)).toBe(true);
    });

    it('🔴 用户点「停止」⇒ 立刻结束，`nextIndex` 落在**还没跑**的那一集', async () => {
        let n = 0;
        const h = hooks({ shouldContinue: () => n++ < 2 });
        const out = await runBatchSearch(makeBatchRows(targets(5)), h);
        expect(out.done).toBe(false);
        expect(out.reason).toBe('');
        expect(out.nextIndex).toBe(2);
        expect(out.lastEpNo).toBe(2);
    });

    it('进度回调按「处理完一集」推进（done 递增到 total）', async () => {
        const h = hooks();
        await runBatchSearch(makeBatchRows(targets(2)), h);
        expect(h.updates.filter((u) => u.endsWith('/0'))).toEqual(['1/2/0', '2/2/0']);
    });

    it('空行列表 ⇒ 直接完成（不 panic、不请求）', async () => {
        const h = hooks();
        const out = await runBatchSearch([], h);
        expect(out.done).toBe(true);
        expect(out.nextIndex).toBe(0);
        expect(h.calls).toEqual([]);
    });
});

// ────────────────────── #526 多P（整季合集）候选：不自动勾 + 可展开分P ──────────────────────
//
//  由来（用户 2026-10-04）：「批量网络检索只能适合单集的，有很多分52p的怎么办」——
//  「填入」写的是候选的 `webUrl`（**恒定 P1**），选中 52P 合集时第 2/4 集都会被写进同一条 P1 链接
//  （= 第 1 集的内容）⇒ **静默填错**。落地：多P 默认不勾 + 行内「展开分P」。

describe('#526 多P 候选不自动勾', () => {
    /** 一行：选中第一条候选、标题含作品名、已按老判据自动勾上 */
    function autoCheckedRow(workTitle = '熊出没'): BatchRow {
        return applyBatchResult(
            row({ workTitle, videos: [vid('BV1', '熊出没之怪兽计划 全52集'), vid('BV2', '熊出没 第2集')] }),
            { videos: [vid('BV1', '熊出没之怪兽计划 全52集'), vid('BV2', '熊出没 第2集')] },
        );
    }

    it('前提：搜完先按老判据自动勾上（这时还不知道分P 数）', () => {
        expect(autoCheckedRow().checked).toBe(true);
    });

    it('🔴 标出分P 数 = 52（整季合集）⇒ **自动取消勾选**（静默填 P1 会指向第 1 集）', () => {
        const r = withPartCount(autoCheckedRow(), 'BV1', 52);
        expect(r.checked).toBe(false);
        expect(r.partCounts.BV1).toBe(52);
    });

    it('1P（单集投稿）⇒ 勾选保持不变（老判据照旧）', () => {
        expect(withPartCount(autoCheckedRow(), 'BV1', 1).checked).toBe(true);
    });

    it('标题不含作品名 ⇒ 本来就没勾；标完分P 仍是没勾（不会反而变勾）', () => {
        const r0 = applyBatchResult(row({ workTitle: '熊出没' }), { videos: [vid('BV1', '别的视频')] });
        expect(r0.checked).toBe(false);
        expect(withPartCount(r0, 'BV1', 52).checked).toBe(false);
        expect(withPartCount(r0, 'BV1', 1).checked).toBe(false);
    });

    it('🔴 用户**手动勾过**的行，标分P 时不许回退（他的决定优先）', () => {
        const manual = withChecked(autoCheckedRow(), true);
        expect(manual.manual).toBe(true);
        expect(withPartCount(manual, 'BV1', 52).checked).toBe(true);
    });

    it('🔴 「换一条」也是手动 ⇒ 换到的那条即使是 52P 合集也保持勾上', () => {
        const r = withPicked(autoCheckedRow(), 1);
        expect(r.manual).toBe(true);
        expect(r.checked).toBe(true);
        expect(withPartCount(r, 'BV1', 52).checked).toBe(true);
    });

    it('⚠️ 只作用于**选中的那条**：给「换一条」列表里别的候选补标分P 不影响本行勾选', () => {
        const r = autoCheckedRow();
        // 选中 BV1（下标 0），这条是 1P ⇒ 保持勾上；顺手标别的候选（BV2 = 52P）不该动它
        expect(withPartCount(r, 'BV2', 52).checked).toBe(true);
    });

    it('🔴 新一轮搜索把 `manual` 归零（候选整批换过，旧的手动选择已无意义）', () => {
        const manual = withChecked(autoCheckedRow(), true);
        const fresh = applyBatchResult(manual, { videos: [vid('BV1', '熊出没 第2集')] });
        expect(fresh.manual).toBe(false);
        expect(withPartCount(fresh, 'BV1', 52).checked).toBe(false);
    });
});

describe('#526 展开分P 的入口条件与锚点', () => {
    it('锚 = 0（第 1 集）—— 整季合集的 P1 就是第 1 集，⛔ 不是「当前集」', () => {
        expect(BATCH_PARTS_ANCHOR).toBe(0);
    });

    it('已知 52P ⇒ 显示「展开分P」；已知 1P ⇒ 不显示（它没有可勾的分P）', () => {
        const base = applyBatchResult(row(), { videos: [vid('BV1'), vid('BV2')] });
        expect(canExpandParts(base)).toBe(true); // 还没标分P ⇒ 也算要显示
        expect(canExpandParts(withPartCount(base, 'BV1', 52))).toBe(true);
        expect(canExpandParts(withPartCount(base, 'BV1', 1))).toBe(false);
    });

    it('没有候选（搜索失败 / 空结果）⇒ 不显示「展开分P」', () => {
        expect(canExpandParts(applyBatchResult(row(), { videos: [], error: '412' }))).toBe(false);
        expect(canExpandParts(row())).toBe(false);
        expect(canExpandParts(undefined)).toBe(false);
    });

    it('单P 判据只认**选中那条**的分P 数（别的候选是 52P 也不算）', () => {
        const r = withPartCount(applyBatchResult(row(), { videos: [vid('BV1'), vid('BV2')] }), 'BV2', 52);
        expect(isSinglePartCandidate(r)).toBe(false); // BV1 还没标 ⇒ 未知 ⇒ 不是单P
        expect(isSinglePartCandidate(withPartCount(r, 'BV1', 1))).toBe(true);
    });

    it('🔴 一致性：展开入口的可见条件与「不自动勾」同源（多P ⇒ 既能展开、也没被自动勾）', () => {
        const r = withPartCount(applyBatchResult(row({ workTitle: '熊出没' }), { videos: [vid('BV1', '熊出没 全52集')] }), 'BV1', 52);
        expect(canExpandParts(r)).toBe(true);
        expect(r.checked).toBe(false);
    });
});
