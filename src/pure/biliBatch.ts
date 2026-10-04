/**
 * 「批量搜索未填集」纯逻辑（#519）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * 🔴 由来（用户 2026-10-04）：「给影视动画观看链接标题旁的小图标按钮再加个从b站上批量搜索
 *    当前所有未填集的小图标按钮」。两轮澄清后裁定：
 *    · **搜完出确认表**（不静默自动填）｜· **候选里先标出「这条有几个分P」**（用来区分
 *      「单集投稿 1P」与「整季合集 52P」）｜· **再按当前集挑一条替换**。
 *
 * 🔴 与既有那枚「搜索 B站」的分工：那枚是**单集、交互式**（点候选 → 展开分P 勾选表，入口 C）；
 *    这枚是**批量、表格式**（一次把未填集全搜了，逐行确认）。两者**共用**同一份检索词口径
 *    （`pure/dl/bilibili.biliEpisodeQuery`）与同一套链接形态（`buildBiliPartUrl` 的 P1 = 无 `?p=`），
 *    ⛔ 别在这里另写一份。
 *
 * 🔴 **请求量是硬约束**：B 站风控（412）是实测事实，本仓既有链**没有任何限速**。
 *    ⇒ 本模块给出**唯一**的间隔常量 `BATCH_GAP_MS`，调用方必须**串行 + 每集之间 await `batchSleep()`**；
 *    ⛔ 不许 `Promise.all` 并发（52 集并发的请求量必然撞风控，且撞了之后整批都拿不到数据）。
 *    ⛔ 也不对**每个**候选都取分P 数 —— 只标「当前选中的那条」，其余按需再取（见 `withPartCount`）。
 *
 * 🔴 #526（用户 2026-10-04）：「批量网络检索只能适合单集的，有很多分52p的怎么办」——
 *    「填入」写的是候选的 `webUrl`，**恒定 P1** ⇒ 选中 52P 整季合集时，第 2/4 集都会被写进
 *    **同一条 P1 链接**（= 第 1 集的内容），**静默填错**。落地两条（见 `withPartCount` / `canExpandParts`）：
 *    ⑴ **多P 候选不自动勾**（并标出分P 数）；⑵ 行内给一枚「展开分P」⇒ 走**现成的分P 勾选表**
 *    （`buildBiliFillRows`，锚 `BATCH_PARTS_ANCHOR = 0`）一次把整季填完。⛔ 两处入口共用同一份口径。
 */
import { biliEpisodeQuery, type BiliPart, type BiliVideo } from 'pure/dl/bilibili';

/**
 * 两集之间的请求间隔（ms）—— 两入口共用的**唯一**限速常量。
 * ⚠️ 单位是「集」，不是「请求」：一集最多 2 个请求（`search` + `view`），
 *    而两个服务函数各自还会在失败时**重取 `buvid3` 再试一次** ⇒ 最坏一集 6 个请求。
 */
export const BATCH_GAP_MS = 600;

/**
 * 「换一条」展开时，最多给**前几条**候选标分P 数。
 * 🔴 为什么不全标：B 站搜索一页 20 条，全标 = 每集 +20 个 `view` 请求，
 *    52 集直接 1000+ 请求 —— 必撞风控；而用户实际只要在「前几条里挑」。
 */
export const BATCH_MARK_LIMIT = 3;

/** 一行 = 一个**未填集**的批量搜索结果 */
export interface BatchRow {
    /** 目标集下标（0 起；本仓铁律「数组下标 i = 第 i+1 集」） */
    epIndex: number;
    /** 目标集号（1 起，给人看的那个数） */
    epNo: number;
    /** 这一集的检索词（= `biliEpisodeQuery` 的口径，与单集搜索**同一份真源**） */
    query: string;
    /** 本条目作品名（⛔ 不是每一集的检索词）—— `matched` 的判据靠它，存在行上省得层层传参 */
    workTitle: string;
    /** 搜到的候选（原样来自 `dlBiliSearch`；⛔ 这里不筛不排不裁） */
    videos: BiliVideo[];
    /** 已取到分P 数的候选：`bvid` → 分P 数（⚠️ 只对**问过的那几条**有值，缺省 = 还没问） */
    partCounts: Record<string, number>;
    /** 当前选中的候选下标（-1 = 没有候选可填） */
    picked: number;
    /**
     * 选中那条的标题**是否含作品名**（🔴 #520 用户裁定 = 自动勾选的判据之一）。
     * ⚠️ 作品名为空 ⇒ 恒 `true`（没有判据可用 ⇒ ⛔ 别把所有行都判成「不符合」）。
     */
    matched: boolean;
    /** 本行是否参与「填入」（自动勾 = 有候选 **且** `matched` **且** 不是多P 合集；手动勾/换选一律置真） */
    checked: boolean;
    /**
     * 这一行的勾选**是否由用户手动决定过**（手动勾/取消、或「换一条」换过）。
     * 🔴 #526：自动勾选**只给单条候选** —— 多P（整季合集）候选不自动勾，见 `withPartCount`。
     *    手动过的行**不再被自动判据回退**（否则用户刚勾上、后台标完分P 就把它又取消了）。
     */
    manual: boolean;
    /** 搜索失败原因（空串 = 正常；非空 ⇒ 该行没有候选，`picked = -1`） */
    error: string;
}

/** 一个待搜目标（未填集 + 它的检索词） */
export interface BatchTarget {
    epIndex: number;
    epNo: number;
    query: string;
}

/**
 * 未填集的下标（**升序**）：`urls[i]` 空/空白 且 `i < total`。
 * 🔴 范围一律以**本条目总集数** `total` 为准（⛔ 别拿数组长度当集数 —— #518 的教训）。
 */
export function unfilledEpIndexes(urls: readonly (string | undefined)[] | undefined, total: number): number[] {
    const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        const v = Array.isArray(urls) ? urls[i] : undefined;
        if (!String(v ?? '').trim()) out.push(i);
    }
    return out;
}

/**
 * 未填集 → 待搜目标。检索词 = **作品标题 + 集标题（缺则补「第N集」）**，
 * 与单集搜索走的是同一个 `biliEpisodeQuery`（⛔ 别另写一套拼词）。
 */
export function buildBatchTargets(
    workTitle: string,
    urls: readonly (string | undefined)[] | undefined,
    total: number,
    titles: readonly (string | undefined)[] | undefined = [],
    single = false,
): BatchTarget[] {
    return unfilledEpIndexes(urls, total).map((i) => ({
        epIndex: i,
        epNo: i + 1,
        // ⚠️ 电影态（`single`）传 `epNo = 0` ⇒ **不补「第1集」**（与 `biliEpisodeQuery` 的口径一致）
        query: biliEpisodeQuery(workTitle, single ? 0 : i + 1, (Array.isArray(titles) ? titles[i] : '') ?? ''),
    }));
}

/** 把「待搜目标」列成等待答案的行（还没搜 ⇒ 没有候选、不勾、不选中） */
export function makeBatchRows(targets: readonly BatchTarget[] | undefined, workTitle = ''): BatchRow[] {
    return (targets ?? []).map((t) => ({
        epIndex: Number(t?.epIndex) || 0,
        epNo: Number(t?.epNo) || (Number(t?.epIndex) || 0) + 1,
        query: String(t?.query ?? ''),
        workTitle: String(workTitle ?? ''),
        videos: [],
        partCounts: {},
        picked: -1,
        matched: false,
        checked: false,
        manual: false,
        error: '',
    }));
}

/** 归一化一个字符串用于「含作品名」比较：小写 + **去掉所有空白**（标题里塞空格/全角空格很常见） */
function normText(s: unknown): string {
    return String(s ?? '')
        .toLowerCase()
        .replace(/\s+/g, '');
}

/**
 * 🔴 #520 用户裁定：**自动勾选的判据 = 标题里含作品名**。
 * 用户报障原话：「还有一些标题完全不符合的怎么也勾选上了」——批量搜「某一集」时，
 * B 站常把**整季合集**或**别的子系列**排在前面，那些标题里根本没有本条目作品名，
 * 却因为「有候选就默认勾」被勾上了。⇒ 只有标题里出现作品名才默认勾，其余交给用户手勾。
 *
 * ⚠️ 作品名为空 ⇒ 返回 `true`（没有判据可用 ⇒ ⛔ 别把所有行都判成「不符合」）。
 * ⚠️ 这是**弱判据**（比「标题要含第N集」宽）—— 用户 2026-10-04 在两档里挑的；
 *    「含集号」那档更严，见本文件顶部注释里的备选。⛔ 别顺手改成更严的（那是口径变更，要用户拍板）。
 */
export function titleMatchesWork(title: string, workTitle: string): boolean {
    const w = normText(workTitle);
    if (!w) return true;
    return normText(title).includes(w);
}

/**
 * 把一次的搜索结果写进行（**纯函数，返回新对象**）：有候选 ⇒ 默认选中**第一条**；
 * **默认勾选 = 有候选 且 标题含作品名**（见 `titleMatchesWork`）。⚠️ 多P 合集在分P 数**标出来之后**
 * 会被 `withPartCount` 自动取消勾选（#526）—— 这里还不知道分P 数，所以先按老判据给。
 * ⚠️ 默认取第一条（而不是「优先挑 1P 的」）：那需要把前几条都问一遍 `view`，请求量直接翻几倍
 *    —— 用户裁定的是「把分P 数**标出来**，再由人来挑」，所以默认给第一条、由分P 胶囊 + 「换一条」补足。
 * 🔴 #526：新一轮搜索 = 候选整批换过 ⇒ `manual` 归零（旧的手动选择已经没有意义了）。
 */
export function applyBatchResult(row: BatchRow, out: { videos?: BiliVideo[]; error?: string } | undefined): BatchRow {
    const videos = Array.isArray(out?.videos) ? (out!.videos as BiliVideo[]) : [];
    const error = String(out?.error ?? '');
    const picked = videos.length > 0 ? 0 : -1;
    const matched = picked >= 0 && titleMatchesWork(videos[0].title, row.workTitle);
    return { ...row, videos, error, picked, matched, checked: picked >= 0 && matched, manual: false };
}

// ────────────────────── 集数区间（#520：只搜「第 20–60 集」这种）──────────────────────

/** 集数区间（1 起、**闭区间**，两端都含） */
export interface EpRange {
    from: number;
    to: number;
}

/**
 * 取一端：**没填 / 非法 ⇒ 用该端的默认值**，否则钳进 `[lo, hi]`。
 * ⚠️ `Number('')` 是 **0**（不是 NaN）⇒ ⛔ 不能只靠 `Number.isFinite` 判「没填」，
 *    否则空输入框会被当成 0 再钳成 `lo`（本批实测：`to` 端因此回落到 3 而不是 40）。
 */
function pickEp(v: unknown, dflt: number, lo: number, hi: number): number {
    const raw = typeof v === 'string' ? v.trim() : v;
    if (raw === '' || raw === null || raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * 归一化用户填的集数区间：**钳到 `[minEp, maxEp]`**；两端填反了自动对调；
 * 非法（空 / NaN）⇒ 落回该侧默认（`from` 落 `minEp`、`to` 落 `maxEp`）。
 * ⚠️ `minEp > maxEp`（没有未填集）⇒ 空区间 `{from:0, to:0}`。
 */
export function normalizeEpRange(from: unknown, to: unknown, minEp: number, maxEp: number): EpRange {
    // ⚠️ 边界判在**原始值**上（⛔ 别先 `Math.max(1, …)` 再判 —— 那会把「没有未填集」（0/0）判成 (1,1)）
    const lo0 = Number(minEp);
    const hi0 = Number(maxEp);
    if (!Number.isFinite(lo0) || !Number.isFinite(hi0) || lo0 < 1 || hi0 < lo0) return { from: 0, to: 0 };
    const lo = Math.max(1, Math.floor(lo0));
    const hi = Math.floor(hi0);
    const a = pickEp(from, lo, lo, hi);
    const b = pickEp(to, hi, lo, hi);
    return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** 这批待搜目标天然形成的区间（第一个 ~ 最后一个）；空 ⇒ `{from:0, to:0}` */
export function epRangeOf(targets: readonly BatchTarget[] | undefined): EpRange {
    const list = targets ?? [];
    if (list.length === 0) return { from: 0, to: 0 };
    return { from: list[0].epNo, to: list[list.length - 1].epNo };
}

/** 按区间过滤待搜目标（**闭区间**；区间为空 ⇒ 空列表） */
export function filterTargetsByRange(targets: readonly BatchTarget[] | undefined, range: EpRange): BatchTarget[] {
    const from = Number(range?.from) || 0;
    const to = Number(range?.to) || 0;
    if (from <= 0 || to < from) return [];
    return (targets ?? []).filter((t) => t.epNo >= from && t.epNo <= to);
}

/**
 * 记一条候选的分P 数（**纯函数，返回新对象**）。
 * ⚠️ 非正数 / 非有限数 ⇒ 原样返回（**不写 0**）—— 「没问过」与「问出来是 0 个分P」在 UI 上都表现为
 *    没有胶囊，但保留「没问过」这个状态，后续才有机会补问。
 *
 * 🔴🔴 **#526：一旦知道选中的是「多P（整季合集）」，就把它自动取消勾选。**
 *    由来（用户 2026-10-04，附确认表截图）：「批量网络检索只能适合单集的，有很多分52p的怎么办」——
 *    批量「填入」写的是 `pickedUrl(row)` = 候选的 `webUrl`，而**那个链接恒定是 P1**（`?p=` 一个都不带）。
 *    ⇒ 选中一条 52P 合集时，第 2 集 / 第 4 集都会被写进**同一条 P1 链接**（= 第 1 集的内容）——
 *      **静默填错**，用户看不出来。1P 候选没这个问题，所以「批量只适合单集」。
 *    ⇒ 判据落地为：多P 候选**默认不勾**（改由行内那枚「展开分P」走勾选表一次填多集），
 *      并在胶囊上标出分P 数让用户一眼看出这是合集。
 *    ⚠️ `manual` 为真的行**不动**（用户手动勾过 / 换选过 ⇒ 他的决定优先，后台标分P 不该回退它）。
 *    ⚠️ 只作用于**选中的那一条**（`videos[picked].bvid === bvid`）—— 「换一条」列表里给别的候选补标分P
 *      不该影响本行的勾选状态。
 */
export function withPartCount(row: BatchRow, bvid: string, partCount: number): BatchRow {
    const b = String(bvid ?? '').trim();
    if (!b) return row;
    const n = Number(partCount);
    if (!Number.isFinite(n) || n < 1) return row;
    const next: BatchRow = { ...row, partCounts: { ...row.partCounts, [b]: Math.floor(n) } };
    if (!next.manual && next.picked >= 0 && next.videos?.[next.picked]?.bvid === b) {
        // 多P ⇒ 不自动勾；1P ⇒ 回到「有候选 且 标题含作品名」那条老判据
        const want = next.matched && Math.floor(n) < 2;
        if (next.checked !== want) next.checked = want;
    }
    return next;
}

/** 分P 胶囊文案：`1P` / `52P`；**未知（没问过 / 取不到）⇒ 空串**（⛔ 不显示胶囊，别写 `?P`） */
export function partCountLabel(n: number): string {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 1) return '';
    return `${Math.floor(v)}P`;
}

/** 当前选中的候选（无候选 / 下标越界 ⇒ `undefined`） */
export function pickedCandidate(row: BatchRow | undefined): BiliVideo | undefined {
    if (!row || !Array.isArray(row.videos) || row.picked < 0) return undefined;
    return row.videos[row.picked];
}

/** 要填入的链接（= 选中候选的 `webUrl`，即它的 P1；没有 ⇒ 空串） */
export function pickedUrl(row: BatchRow | undefined): string {
    return String(pickedCandidate(row)?.webUrl ?? '').trim();
}

/**
 * 换选某一行里的候选（下标非法 ⇒ **原样返回**，⛔ 不产生越界选中）。
 * 🔴 换选 = **用户显式挑的** ⇒ 一律置 `checked`（即使那条标题不含作品名 —— 人已经看过了），
 *    并置 `manual`（#526：手动过的行不再被「多P 不自动勾」回退）。
 *    `matched` 仍按新那条重算（只用来显示「标题不含作品名」那枚提示）。
 */
export function withPicked(row: BatchRow, index: number): BatchRow {
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= (row?.videos?.length ?? 0)) return row;
    const idx = Math.floor(i);
    return {
        ...row,
        picked: idx,
        matched: titleMatchesWork(row.videos[idx]?.title ?? '', row.workTitle),
        checked: true,
        manual: true,
    };
}

/** 勾 / 取消勾一行（🔴 手动动作 ⇒ 置 `manual`，见 `withPartCount`） */
export function withChecked(row: BatchRow, checked: boolean): BatchRow {
    const want = !!checked;
    return row.checked === want && row.manual ? row : { ...row, checked: want, manual: true };
}

// ────────────────────── #526 「展开分P」入口（多P 合集专用）──────────────────────

/**
 * 批量卡里那枚「展开分P」把分P 勾选表开在**哪个集**上。
 * 🔴 **锚 = 0（第 1 集）**，不是「当前集」（与单集检索那条 #518 的「一律锚当前集」**有意不同**）：
 *    能被展开的候选是**整季合集** —— 它的 P1 就是**第 1 集**（用户 2026-10-04 在「整季合集口径」下挑的
 *    「展开分P 手选」）。锚在批量行的那一集（比如第 50 集）会把 P1 填到第 50 集，整季全部错位。
 * ⚠️ 已知局限（#505 就记过）：`第41-52集` 这类**不从 1 开始**的合集仍会落到第 1~12 集 ——
 *    缓解 = 勾选表每行都写出**目标集号**，错位一眼可见、取消勾选即可。
 */
export const BATCH_PARTS_ANCHOR = 0;

/** 选中候选**已知**是单P（`partCounts === 1`）；未知 / 没候选 ⇒ false */
export function isSinglePartCandidate(row: BatchRow | undefined): boolean {
    const v = pickedCandidate(row);
    if (!v) return false;
    return row?.partCounts?.[v.bvid] === 1;
}

/**
 * 这一行要不要显示「展开分P」：**有选中的候选、且不是已知的单P**。
 * ⚠️ 「分P 数还不知道」也算要显示 —— 批量跑批只给**选中那条**标分P 数，`view` 失败时就是「未知」，
 *    而那种情况恰恰可能是合集（⛔ 别按「必须是 ≥2」判，那样会漏掉唯一需要展开的那批）。
 * ⛔ 单P 行不给这枚按钮：它没有可勾的分P，「展开」只会弹出一张只有一行的空表。
 */
export function canExpandParts(row: BatchRow | undefined): boolean {
    return !!pickedCandidate(row) && !isSinglePartCandidate(row);
}

/** 勾中且真的有链接可填的行 = 点「填入」时真正要写的那批 */
export function batchCheckedRows(rows: readonly BatchRow[] | undefined): BatchRow[] {
    return (rows ?? []).filter((r) => r.checked && !!pickedUrl(r));
}

/** 至少要有一行能填（「填入」按钮的禁用判据） */
export function canFillBatch(rows: readonly BatchRow[] | undefined): boolean {
    return batchCheckedRows(rows).length > 0;
}

/** 跑动中那句进度：`正在搜索 12/52 · 第 12 集…`（`epNo <= 0` ⇒ 只报进度） */
export function batchProgressText(done: number, total: number, epNo: number): string {
    const t = Math.max(0, Math.floor(Number(total) || 0));
    const d = Math.max(0, Math.min(t, Math.floor(Number(done) || 0)));
    const ep = Math.floor(Number(epNo) || 0);
    return ep > 0 ? `正在搜索 ${d}/${t} · 第 ${ep} 集…` : `正在搜索 ${d}/${t}…`;
}

/** 停下那句（遇错 / 手动停止）：`已搜到第 12 集就停下了：B 站返回 412（风控）…` */
export function batchStopText(doneEpNo: number, reason: string): string {
    const ep = Math.floor(Number(doneEpNo) || 0);
    const r = String(reason ?? '').trim();
    if (ep <= 0) return r ? `刚开始就停下了：${r}` : '已停止';
    return r ? `已搜到第 ${ep} 集就停下了：${r}` : `已搜到第 ${ep} 集，已停止`;
}

/**
 * 限速用（两入口共用；⛔ 别各自写一份 `setTimeout`）。
 * ⚠️ 单测里传 `0` 让它在下一个 tick 就 resolve。
 */
export function batchSleep(ms: number = BATCH_GAP_MS): Promise<void> {
    const n = Number(ms);
    return new Promise((resolve) => setTimeout(resolve, Number.isFinite(n) && n > 0 ? Math.floor(n) : 0));
}

/** 「换一条」展开时要补标分P 数的候选：**前 `limit` 条里还没标过的**（⛔ 不重复问已标的） */
export function candidatesToMark(row: BatchRow | undefined, limit: number = BATCH_MARK_LIMIT): BiliVideo[] {
    const lim = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
    const head = (row?.videos ?? []).slice(0, lim);
    return head.filter((v) => !row?.partCounts?.[v.bvid]);
}

// ────────────────────── 跑批（**唯一**一份循环，两入口共用）──────────────────────
//
// 🔴 为什么把「循环」也放进纯模块：两个入口（集编辑浮层 / 快捷关联弹窗）都要跑同一套
//    「串行 + 限速 + 遇错即停 + 只标第一条分P」的流程。若各写一份，改一处漏一处就是
//    「两个入口行为不一样」——本仓反复栽在这上面（§16.30「两个入口」那条纪律）。
//    IO 全部**注入**（`search` / `parts` / `sleep`），所以这份循环本身可单测。

/** 跑批所需的外部能力（组件注入；单测注入假实现） */
export interface BatchRunHooks {
    /** 搜一集（= `dlBiliSearch`；⛔ 组件别在这里加逻辑） */
    search: (keyword: string) => Promise<{ videos?: BiliVideo[]; error?: string }>;
    /** 取一条视频的分P 列表（= `dlBiliView`；只想数数） */
    parts: (bvid: string) => Promise<{ title?: string; parts?: BiliPart[]; error?: string }>;
    /** 状态一有变就回调（⛔ 组件只照着渲染，不自己维护游标/进度） */
    onUpdate: (rows: BatchRow[], done: number, total: number, epNo: number) => void;
    /** 返回 false ⇒ **立刻停下**（用户点了「停止」/ 卡片已关） */
    shouldContinue: () => boolean;
    /** 限速（缺省 = `batchSleep`；单测传 `() => Promise.resolve()`，不真等） */
    sleep?: (ms: number) => Promise<void>;
}

/** 跑批结果 */
export interface BatchRunResult {
    /** 最新的行（含本次跑出来的候选与分P 数） */
    rows: BatchRow[];
    /** 「继续」时应从哪个下标接着跑（正常跑完 = `rows.length`；遇错停 = 出错那一集，好重试它） */
    nextIndex: number;
    /** 停下来时**已处理到**的集号（0 = 一集都没处理完） */
    lastEpNo: number;
    /** 为什么停（空串 = 正常跑完 / 用户手动停） */
    reason: string;
    /** 是否**正常跑完**（false = 遇错停 / 手动停） */
    done: boolean;
}

/**
 * 串行跑批：逐集搜 → 默认选中第一条 → 给第一条标分P 数 → 报进度 → 限速 → 下一集。
 *
 * 🔴 **遇错即停**：某一集 `error` 非空（含 412 风控）⇒ 立刻结束本轮并**把原因带出去**
 *    （已搜到的照常留在 `rows` 里）。`nextIndex` 落回出错那一集 ⇒ 用户点「继续」是**重试它**，
 *    ⛔ 不是跳过它（风控是偶发的，重来一次常常就通了）。
 * 🔴 **分P 数取不到不算失败**：胶囊留空，链接照常可用（⛔ 别因为标不出分P 就丢掉这条候选）。
 *
 * @param initial 待跑的行（通常来自 `makeBatchRows`）
 * @param startAt 从哪个下标开始（「继续」传上次的 `nextIndex`）
 */
export async function runBatchSearch(
    initial: readonly BatchRow[],
    hooks: BatchRunHooks,
    startAt = 0,
): Promise<BatchRunResult> {
    const rows: BatchRow[] = (initial ?? []).map((r) => ({ ...r }));
    const total = rows.length;
    const sleep = hooks.sleep ?? batchSleep;
    let i = Number.isFinite(startAt) ? Math.max(0, Math.floor(startAt)) : 0;
    let lastEpNo = 0;

    for (; i < total; i++) {
        if (!hooks.shouldContinue()) {
            return { rows, nextIndex: i, lastEpNo, reason: '', done: false };
        }
        const epNo = rows[i].epNo;
        hooks.onUpdate(rows, i, total, epNo);
        let next = rows[i];
        try {
            next = applyBatchResult(rows[i], await hooks.search(rows[i].query));
        } catch (e) {
            next = applyBatchResult(rows[i], { videos: [], error: `搜索出错：${e instanceof Error ? e.message : String(e)}` });
        }
        rows[i] = next;
        const first = pickedCandidate(next);
        if (first) {
            try {
                const v = await hooks.parts(first.bvid);
                const n = Array.isArray(v?.parts) ? v.parts.length : 0;
                if (n > 0) rows[i] = withPartCount(next, first.bvid, n);
            } catch {
                /* 标不出分P 不影响链接可用（⛔ 别把它当失败） */
            }
        }
        lastEpNo = epNo;
        hooks.onUpdate(rows, i + 1, total, 0);
        if (next.error) return { rows, nextIndex: i, lastEpNo, reason: next.error, done: false };
        if (i < total - 1) await sleep(BATCH_GAP_MS);
    }
    return { rows, nextIndex: total, lastEpNo, reason: '', done: true };
}
