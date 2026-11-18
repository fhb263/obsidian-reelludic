/**
 * 选集页（B 站风独立页）的**纯逻辑**（#691 之后的新页面，2026-10-27）。
 *
 * 🔴 由来：用户（2026-10-27）「②系列卡播放按钮打开的选集页面改成 b 站风格的选集**新页面**，
 *    加个**内置播放器**」，随后裁定「1 真同屏，每段 **50**，3 不留，4（B 站评分位）在海报墙上同单卡同位」。
 *
 * 🔴 为什么每段 50 而 `EP_PAGE_SIZE` 仍是 100：
 *    `pure/epPages.ts` 的 `EP_PAGE_SIZE = 100` 是**选集弹窗**的口径（#600 用户原话「100 集以上加分页」），
 *    并被产物断言逐字锚死（`assert-symbols.cjs` 两处 `/export const EP_PAGE_SIZE = 100;/`）⇒ ⛔ 不能改它。
 *    新页面比弹窗宽得多（弹窗四列、新页七列），100 集一屏会铺成十几行 ⇒ 用户单独给了「每段 50」。
 *    ⚠️ 所以这里是**两个不同场景的两个常量**，不是一个该改没改的漏项 —— 改任何一个都会砸掉另一边。
 *
 * 🔴 保位口径与 `pure/episodeAssoc.ts:storeEpisodeList` **完全一致**：下标 i 恒 = 第 i+1 集。
 *    空位留洞、不压缩 —— 压缩会让第 2 集之后的本地路径/网络地址/集标题整体前移一格
 *    （2026-10-01 #446 用户报障「编辑第 2 集保存不生效」的根因就是旧代码 `filter(Boolean)` 压了洞）。
 *
 * 纯逻辑无 obsidian / 无 DOM，可单测。
 */

import type { MediaEntry } from 'data/types';
import type { LinkStatus } from './linkStatus';
import { seriesKeyOf, sortSeriesItems } from './seriesGroup';
import { subtitleLangLabel, type SubtitleCandidate } from './subtitle';

/**
 * 选集页**每段几集**（用户 2026-10-27 裁定「每段 50」）。
 * ⚠️ 与 `epPages.EP_PAGE_SIZE`（= 100，选集弹窗口径）**不是同一个东西**，别互相顶替。
 */
export const EPISODE_PAGE_SIZE = 50;

/** 选集页左上角「第 N 集」是 1 基给人看的；`index` 是 0 基下标（与 `episodeFiles` 同一套） */
export interface EpisodeCell {
    /** 0 基集下标（= `episodeFiles` / `episodeUrls` / `episodeTitles` 的数组位） */
    index: number;
    /** 主文字：「第 3 集」/（电影态）「文件 3」 */
    label: string;
    /** 集标题（可空；空则不渲染第二行，⛔ 不留空占位） */
    title: string;
    /** 有资源（本地或网络任一） */
    linked: boolean;
    /** 有本地路径（能进内置播放器；网络链接只能开浏览器） */
    local: boolean;
    /** 网络链接经检测已失效（`LinkStatus = 'dead'`）；`unknown` **不标** —— 把「测不动」显示成「已失效」会误导用户去删好链接 */
    dead: boolean;
    /** 是不是「当前看到的那一集」（宿主传 `progress.episode - 1`） */
    cur: boolean;
}

export interface EpisodeCellsInput {
    /** 本地剧集路径（index 0 = 第 1 集；可稀疏） */
    files?: readonly (string | undefined)[];
    /** 网络剧集地址（与 `files` 同下标） */
    urls?: readonly (string | undefined)[];
    /** 集标题（与 `files` 同下标） */
    titles?: readonly (string | undefined)[];
    /** 网络链接检测结果（与 `files` 同下标） */
    statuses?: readonly (LinkStatus | undefined)[];
    /** 当前看到的那一集（0 基）；非法 ⇒ 没有 `cur` 格 */
    currentIndex?: number;
    /** 声明的总集数（`progress.totalEpisodes`；可能比已关联的更长） */
    total?: number;
    /** 电影/单文件态：文案用「文件 N」而不是「第 N 集」 */
    single?: boolean;
}

/**
 * 这一段该出几格 = `max(声明总集数, 本地数组长, 网络数组长)`。
 *
 * ⚠️ **集标题长度不参与**：只填了标题没有资源的「幽灵集」不该撑出格子 —— 它点不动也播不了。
 * ⚠️ 三个数组都可能**比声明总集数更长**（历史数据里 `totalEpisodes` 没跟着改）⇒ 取 max 而不是取 total。
 */
export function episodeCellCount(input: EpisodeCellsInput): number {
    const n = (a?: readonly unknown[]) => (Array.isArray(a) ? a.length : 0);
    const t = typeof input.total === 'number' && Number.isFinite(input.total) ? Math.max(0, Math.floor(input.total)) : 0;
    return Math.max(t, n(input.files), n(input.urls));
}

/** 从数组里安全读一个位置（稀疏数组 / 短数组都返回 `undefined`；纯空白当没填）。
 *  ⚠️ 名字**不能叫 `at`**：本模块的顶层符号会随 esbuild 打包进 `main.js`，
 *  与 `EntryService.appendNoteSection` 里那个 `const at = final.lastIndexOf(body)` 撞名后
 *  esbuild 会把后者改名成 `at2`，而产物断言逐字锚的是 `const at = final.lastIndexOf(body)`
 *  （`assert-symbols.cjs:4405`）⇒ 一条**与我无关**的断言会凭空变红。 */
function pickAt(list: readonly (string | undefined)[] | undefined, i: number): string {
    if (!Array.isArray(list)) return '';
    const v = list[i];
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * 生成选集格的完整列表（保位，不压缩）。
 *
 * 每格的四条状态互不冲突：`local`（能内置播）/ `linked`（有任一资源）/ `dead`（网络链接失效）/ `cur`（当前集）。
 * 电影态（`single`）文案是「文件 N」，与 `EpisodePickerModal.renderRow` 同一口径。
 */
export function episodeCells(input: EpisodeCellsInput): EpisodeCell[] {
    const total = episodeCellCount(input);
    const curIdx = typeof input.currentIndex === 'number' && Number.isFinite(input.currentIndex)
        ? Math.floor(input.currentIndex)
        : -1;
    const single = input.single === true;
    const out: EpisodeCell[] = [];
    for (let i = 0; i < total; i++) {
        const file = pickAt(input.files, i);
        const url = pickAt(input.urls, i);
        out.push({
            index: i,
            label: single ? `文件 ${i + 1}` : `第 ${i + 1} 集`,
            title: pickAt(input.titles, i),
            linked: !!file || !!url,
            local: !!file,
            dead: !!url && input.statuses?.[i] === 'dead',
            cur: i === curIdx,
        });
    }
    return out;
}

/**
 * 「本系列的其他季」—— 用户 2026-10-27 裁定：「右下**相关推荐**其实为该系列的其他季排列」。
 *
 * 口径：
 *  - 只认同 `type` + 归一化系列名（🔴 分组键就是 `seriesKeyOf`，用户 2026-09-30 裁定「不做跨类型」：
 *    同名的动画与真人电影是两回事）；
 *  - **排除自己**（当前正在看的那一季不进推荐）；
 *  - 排序复用 `sortSeriesItems`（`seriesIndex` 升序 → 无值回落年份 → 标题），⛔ 别在这里另写一套比较；
 *  - 没有系列名的条目 ⇒ 空数组（孤立条目没有「其他季」）。
 *
 * @param current 当前条目的**快照**（只要有 `id` / `type` / `series` 就够）
 * @param all     全库条目（宿主传 catalog 里的全部，不是筛过的当前页）
 */
export function relatedSeasons(
    current: Pick<MediaEntry, 'id' | 'type' | 'series'> | null | undefined,
    all: readonly MediaEntry[],
): MediaEntry[] {
    if (!current) return [];
    const key = seriesKeyOf(current);
    if (!key) return [];
    const others = all.filter((e) => e.id !== current.id && seriesKeyOf(e) === key);
    return sortSeriesItems(others);
}

/**
 * 某一季在推荐列表里的副标题（第几部）。
 *
 * ⚠️ `seriesIndex` 的语义**由用户自定**（阅读序 / 上映序 / 季序都行，见 `data/types.ts` 注释），
 *   所以文案写「第 N 季」是**过度解读** —— 这里用中性说法，与 `SeriesPicker` 的角标口径一致。
 */
export function seasonOrdinalLabel(entry: Pick<MediaEntry, 'seriesIndex'> | null | undefined): string {
    const n = entry?.seriesIndex;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? `第 ${Math.round(n)} 部` : '';
}

/**
 * 右下角「相关推荐」要显示哪几部（用户 2026-11-10）：
 * 「观看进度栏彻底改成如相关推荐只随机显示电影或其他动画上限几部，横封面竖排」。
 *
 * 口径（逐条对应上面那句原话）：
 *  - **电影或其他动画** ⇒ 候选池只有 `movie` / `anime` 两型（⛔ 不混 tv / book / game / music：
 *    用户明确点名这两类，把电视剧塞进「其他动画」是自作主张）；
 *  - **随机** ⇒ 用 Fisher–Yates 洗牌（**不用 `sort(() => Math.random() - 0.5)`**：
 *    那个比较器不满足传递性，V8 下分布明显偏斜、且不同引擎结果不一样）；
 *  - **上限几部** ⇒ `limit` 夹在 `[0, pool]`，默认 6（一屏竖排能放下、又不会长成第二个系列带）；
 *  - **排除自己**：正在看的这部不出现在自己的推荐里（点进去还是这一页，纯噪音）。
 *
 * ⚠️ `seed` 可选：不传就是真随机；传了就走可复现的 LC 伪随机。
 *    **为什么需要它**：单测要钉住「洗牌结果确实是同一批、没有重复、没有丢」，
 *    直接调 `Math.random` 的版本根本没法断言（每次运行结果都不同）。
 *    ⛔ 运行时（视图层）**必须不传 seed** —— 传了就成了「每次刷新同几部」，与「随机」相反。
 *
 * 🔴 2026-11-14 用户补充口径：「相关推荐改为按当前条目题材匹配，同题材不够再放宽」。
 *    ⇒ 在**候选池不变**（仍只有 movie / anime 两型）的前提下分两层：
 *      ⑴ **同题材层**：`genres` 与当前条目有交集的先上（只在当前条目填了题材时才存在）；
 *      ⑵ **放宽层**：本层不够 `limit` 时，余下的位置由池子里**其余**候选按随机补齐。
 *    ⚠️ 两层各自内部仍然洗牌 —— 用户要的是「优先同题材」，不是「永远同几部」。
 *    ⛔ 别把候选池一起放宽成「全类型」：那是另一条口径（用户 2026-11-10 明确点名
 *       只要「电影或其他动画」），混进 tv / book 是自作主张。
 *
 * @param current 当前条目（至少要 `id`；带 `genres` 才能吃到题材优先）
 * @param all     全库条目
 * @param limit   最多几部
 * @param seed    仅测试用；不传 = 真随机
 */
export function pickRecommendations(
    current: Pick<MediaEntry, 'id'> & Partial<Pick<MediaEntry, 'genres'>> | null | undefined,
    all: readonly MediaEntry[],
    limit = 6,
    seed?: number,
): MediaEntry[] {
    const pool = all.filter(
        (e) => (!current || e.id !== current.id) && (e.type === 'movie' || e.type === 'anime'),
    );
    const n = Math.max(0, Math.min(Math.floor(limit), pool.length));
    if (n === 0) return [];

    // 洗牌：只在**可复现**时才用自己的伪随机（见上面对 seed 的说明）
    const rnd = seed === undefined ? Math.random : mulberry32(seed);
    const shuffle = (src: readonly MediaEntry[]): MediaEntry[] => {
        const arr = src.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const t = arr[i];
            arr[i] = arr[j];
            arr[j] = t;
        }
        return arr;
    };

    // 题材命中 = 两边都非空、且至少一个题材串相等（trim 后比，⛔ 不做模糊包含 ——
    // 「科幻」与「科幻片」是两个不同的题材词，模糊匹配会把不相干的条目拉进来）
    const wanted = new Set(
        (current?.genres ?? []).map((g) => String(g).trim()).filter((g) => !!g),
    );
    if (wanted.size === 0) return shuffle(pool).slice(0, n);

    const hit: MediaEntry[] = [];
    const miss: MediaEntry[] = [];
    for (const e of pool) {
        const same = (e.genres ?? []).some((g) => wanted.has(String(g).trim()));
        (same ? hit : miss).push(e);
    }
    // 同题材层在前，放宽层补位（`limit` 大于同题材数量时自然被放宽层填满）
    return [...shuffle(hit), ...shuffle(miss)].slice(0, n);
}

/**
 * 极小的确定性伪随机（mulberry32）。
 *
 * ⚠️ 只服务 `pickRecommendations` 的 `seed` 分支（测试用），⛔ 不要当通用随机源扩散出去。
 *    选它是因为实现只有 4 行、无依赖、序列质量足够「看起来随机」（单测只关心可复现，不关心统计性质）。
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── 选集格的两种「单循环」开关（用户 2026-10-29）────────────────────────────
//
// 🔴 用户原话：「选集面板两个按钮改成列表/网格单循环切换按钮、然后再加个正序/倒序单循环
//    切换按钮，这两个按钮都和如 1-50 51-100 101-10 并列」。
//
// ⇒ 原来是**两个并排的模式按钮**（选中态靠 `is-on`），用户要的是**一颗按钮循环切**
//    （点一下换下一种，按钮图标自己变）。排序同理：一颗按钮在正序/倒序之间循环。
// ⇒ 「并列」= 这两颗按钮与分段条住在**同一行**，⛔ 不再各占一行（旧结构上按钮一行、分段一行，
//    右栏 340px 里白吃一整行高度）。
//
// ⚠️ 循环顺序写在这里、⛔ 不写在视图里：视图只管「点了调它、拿到下一态」，
//    这样单测能直接钉住「点两次回到原点」这条最容易写错的性质。

/** 选集格画法 */
export type CellsMode = 'list' | 'grid';

/** 集序：正序（1→N）/ 倒序（N→1） */
export type CellsOrder = 'asc' | 'desc';

/**
 * 单循环：下一档（末档回到首档）。
 *
 * 🔴 用**常量数组 + 取模**而不是 `m === 'list' ? 'grid' : 'list'`：
 *    将来加第三种画法时只改数组，调用方一个字都不用动（也不会漏掉某个分支）。
 */
const MODE_CYCLE: readonly CellsMode[] = ['list', 'grid'];
const ORDER_CYCLE: readonly CellsOrder[] = ['asc', 'desc'];

export function nextCellsMode(mode: CellsMode): CellsMode {
    const i = MODE_CYCLE.indexOf(mode);
    return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}

export function nextCellsOrder(order: CellsOrder): CellsOrder {
    const i = ORDER_CYCLE.indexOf(order);
    return ORDER_CYCLE[(i + 1) % ORDER_CYCLE.length];
}

/**
 * 按集序排列整份格列表（**先排序再分页**）。
 *
 * 🔴 为什么不是「只把当页反转」：那样第 0 页是 50→1、第 1 页是 52→51，
 *    跨页时集号会突然跳回大数，读起来像乱序。整份反转后每页内部、页与页之间都是单调的。
 * ⚠️ `asc` 必须返回**新数组**（`slice()`）：调用方后面还会 `slice(start,end)` 分页，
 *    直接返回入参会让「排序」看起来生效、实际改到了别处的缓存数组。
 */
export function orderCells(cells: readonly EpisodeCell[], order: CellsOrder): EpisodeCell[] {
    const out = cells.slice();
    return order === 'desc' ? out.reverse() : out;
}

/**
 * 分段条上「这一段是第几集到第几集」的标签。
 *
 * 🔴 旧写法是 `p * size + 1` ~ `min(len, (p+1) * size)` —— 那是**数组位**，只有在正序时才等于集号。
 *    倒序后数组位与集号反向，再按位置算就会写出「1-50」却显示着 52→3 的格子（明着骗人）。
 *    ⇒ 改成读这一页**首尾两格的真实集号**，取 min/max ⇒ 正序得 `1-50`、倒序得 `3-52`，两种都对。
 * ⚠️ 空页返回空串（调用方本来也只画首尾都存在的页）。
 */
export function pageRangeLabel(cells: readonly EpisodeCell[], start: number, end: number): string {
    const lo = cells[start];
    const hi = cells[end - 1];
    if (!lo || !hi) return '';
    const a = lo.index + 1;
    const b = hi.index + 1;
    return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

/**
 * 分段条**要不要画**。
 *
 * 🔴 用户 2026-11-10（m02255）逐字：「播放器选集面板即使不足 50 集也显示 1-20」。
 *    改前视图里写的是 `pages > 1` —— 只有一页时整条分段就不画，用户看不见「当前在 1-20」这种定位。
 *    ⇒ 收口成这条纯函数：**只要有格子就画**（哪怕只有 1 页、只有 1 个格子）。
 * ⚠️ 抽成纯函数是为了让「有人改回 `> 1`」当场变红（视图层内联判断单测摸不到）。
 * ⛔ 别退回 `pages > 1` / `cellCount > EPISODE_PAGE_SIZE`：那正是被用户否掉的口径。
 */
export function rangeBarVisible(cellCount: number): boolean {
    return Number.isFinite(cellCount) && cellCount > 0;
}

/**
 * 选集页空舞台该显示哪种形态。
 *
 * 🔴 用户 2026-11-10（m03035）：「从播放器详情页相关推荐进入的条目播放详情页由于没有任何关联
 *    播放器屏幕一直在转圈 改成显示未关联空态」。
 *    病根不是「慢」，是**判据缺失**：`items` 空数组时基类把占位层点亮，文案恒为「正在加载视频…」
 *    并持续转圈，而这件事永远不会结束（压根没有任何加载在跑）。用户看到的是「一直在转圈」。
 * ⇒ 这条纯函数把两种情形分开：
 *    `unlinked` —— 本地集与网络集**都是空**：真的什么都没有，说「还没有关联视频」，⛔ 不许转圈；
 *    `loading`  —— 有关联数据但落不到可播项（编码不支持 / 解析失败）：那确实还在走流程，保留转圈。
 * ⚠️ 抽成纯函数是为了让「把判据改回恒 loading」当场变红 —— 视图层不进 vitest。
 */
export function emptyStageModeFor(localCount: number, urlCount: number): 'loading' | 'unlinked' {
    const hasLocal = Number.isFinite(localCount) && localCount > 0;
    const hasUrl = Number.isFinite(urlCount) && urlCount > 0;
    return hasLocal || hasUrl ? 'loading' : 'unlinked';
}

/** 字幕列表的一行 */
export interface SubtitleRow {
    /** 同目录文件名（后续读取与「当前选中」判定都用它） */
    fileName: string;
    /** 语种中文说明（识别不到 → 「未知语种」，⛔ 不留空串让界面出现空白行） */
    langLabel: string;
    /** 是不是当前挂上的那条 */
    active: boolean;
}

/**
 * 字幕候选 → 列表行。
 *
 * ⚠️ `active` 由调用方给（播放器里当前挂的那条是**播放器私有状态**，本模块不猜）。
 * ⚠️ 顺序**保持传入顺序**：`pickSubtitleCandidates` 已经按「完全同名 → 中文优先 → 其余」排过，
 *    在这里再排一次就是两套真源（本仓明令禁止）。
 */
export function subtitleRows(
    candidates: readonly SubtitleCandidate[],
    activeFile?: string | null,
): SubtitleRow[] {
    const cur = typeof activeFile === 'string' ? activeFile : '';
    return candidates.map((c) => ({
        fileName: c.fileName,
        langLabel: subtitleLangLabel(c.lang) || '未知语种',
        active: !!cur && c.fileName === cur,
    }));
}

/**
 * 字幕面板「来源键」（换集 / 换字幕 / 手动导入任一变化都必须让这个键变）。
 *
 * 🔴 2026-11-06 用户报障：「怎么每集共用一个集的字幕文件啊」——**网络集也指向同一份**。
 *    根因是视图层用 `currentEpisodeIndex()` 拼键，而那是**组件库 items 里的真实集**；
 *    B 站内嵌态根本不移动 `cur`（网络集没有本地文件、进不了 items）⇒ 所有网络集算出的键
 *    一模一样 ⇒ `syncCueSource()` 开头 `key === cueSrc` 早退 ⇒ 面板永远停在第 1 个网络集上。
 *
 * ⇒ 这条规则现在**只在这里写一次**，视图层调 `activeCellIndex()` 拿真实集号再喂进来。
 *   ⛔ 别在视图层再手拼一套（本仓同文件里 `currentEpisodeLabel` / `netTitleText` /
 *   `activeCellIndex` 三处已经各踩过一遍同样的坑）。
 *
 * ⚠️ 集号可能是 `-1`（一集都没有 / 还在解析）。照样编进键里：`-1` 也是一个**确定**的状态，
 *    给它一个稳定键才能让「从空态切到第 1 集」触发重解析。⛔ 别在这里把它抹成 0
 *    —— 那会让「空态」与「第 0 集」共用一个键。
 * ⚠️ 文件名允许为空串（本地集还没挂字幕）：`base::-1::` 也是合法键。
 */
export function cueSourceKey(input: {
    episodeIndex: number;
    importedFileName?: string | null;
    subtitleFileName?: string | null;
}): string {
    const idx = Number.isFinite(input.episodeIndex) ? Math.trunc(input.episodeIndex) : -1;
    const imported = String(input.importedFileName ?? '').trim();
    if (imported) return `imp::${idx}::${imported}`;
    const file = String(input.subtitleFileName ?? '').trim();
    return `base::${idx}::${file}`;
}
