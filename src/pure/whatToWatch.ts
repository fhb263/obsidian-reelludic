// 「今天看什么」随机抽卡（纯逻辑，无 obsidian / DOM 依赖）
//
// 🔴 m07854 ⑭（用户 2026-11-13 原话）：
//    「搜索框内部加「今天看什么」随机抽卡的**骰子 🎲 图标**（无边框透明化），点击从所有「想看」且
//     评分较高的条目中随机全屏弹出一张卡片，带「换一个 / 就它了」按钮，「就它了」为主按钮。
//     **交互：不用搜索框时显示，输入文字搜索时隐藏**」
//
// 这个模块只做两件事：**筛候选**、**挑一条并记住刚抽过谁**。
// ⛔ 不碰 DOM、不碰随机数以外的副作用 —— 这样「抽到重复」这类逻辑才能单测钉住
//    （在组件里写就会和上一批的 `isHalfStarClick` 一样，只能锚「函数在不在」而锚不住行为）。

import type { MediaEntry } from '../data/types';
import { hasActionEntry } from './actionLabel';

/**
 * 评分门槛 —— **🔴 m04435 ② 起已不再参与筛选**。
 *
 * 用户原话（m04435）：「单类型候选为**全状态、评分不限**的全部可观看条目（未关联入口条目不为候选）；
 * 等概率抽取一部，候选为空时提示」。
 * ⇒ 旧的「想看 + 评分 ≥ 4」双门槛整条退场：想看/在看/已看/存档都在池里，0 分与没评分的也在。
 * ⚠️ 常量**保留导出**只为一件事：让「这条门槛已经不在 `isWatchCandidate` 里」这件事在代码里有据可查，
 *    ⛔ 别再把它接回去（接回去 = 把「已看过的片子」永久踢出随机池，与用户这轮的口径相反）。
 */
export const WATCH_PICK_MIN_RATING = 4;

/** 一批最多给多少个候选（避免每次都要遍历全库几十万条；顺序由调用方决定，不在这里洗牌） */
export const WATCH_PICK_POOL_MAX = 240;

/**
 * 是否够格进「今天看什么」的候选池。
 *
 * 🔴 m04435 ② 的口径（**本批反转了 m07854 ⑭ 的两条门槛**）：
 * 1. **全状态** —— `want` / `watching` / `watched` / `archived` 都算。
 *    ⛔ 别再退回 `status === 'want'`：用户这轮明说「全状态」，而且「已看过还想再抽一次」是真实需求。
 * 2. **评分不限** —— 0 分、没评分、脏值都可进。⛔ 别再拿 `normalizeRating` 当门控。
 * 3. **必须已关联入口** —— 抽出来点「就它了」要真能打开。判据直接复用
 *    `pure/actionLabel.hasActionEntry`（影视链接 / 书籍文件或在线阅读 / 游戏 swf 或 launcher / 音乐音频），
 *    ⛔ 别在这里另写一套「有没有链接」的判断 —— 那必然与右键菜单「能不能点」分叉。
 * 4. 要有条目 id —— 空 id 的脏数据剔除。
 */
export function isWatchCandidate(e: MediaEntry): boolean {
    if (!e || typeof e.id !== 'string' || e.id.length === 0) return false;
    return hasActionEntry(e);
}

/**
 * 从候选池里挑一条，**尽量避开** `excludeId`（= 上一次抽到的那条）。
 *
 * 行为约定（都是可测的硬口径）：
 * - 池空 ⇒ `null`（调用方据此提示「没有足够候选」，⛔ 不要造一条假的）
 * - 池只有 1 条且就是 `excludeId` ⇒ **返回它**（否则用户点「换一个」会永远拿到 null，看起来像坏了）
 * - 池 ≥ 2 条 ⇒ 一定换掉 `excludeId`（这是「换一个」这个词的全部意义）
 * - `rand` 可注入，便于单测；缺省 `Math.random`
 *
 * ⚠️ 不做「洗牌后按序取」：那需要跨调用保存游标，而游标一旦与列表刷新不同步就会漏抽。
 *    这里只保证「不连续重复」，取舍明确、状态最少。
 */
export function pickWatchCandidate(
    pool: readonly MediaEntry[],
    excludeId?: string | null,
    rand: () => number = Math.random,
): MediaEntry | null {
    if (!pool || pool.length === 0) return null;
    const candidates = excludeId ? pool.filter((e) => e.id !== excludeId) : pool.slice();
    // 池里只有「刚抽过的那一条」⇒ 只能给它（见上面第 2 条约定）
    const usable = candidates.length > 0 ? candidates : pool.slice();
    const idx = Math.floor(rand() * usable.length);
    // `rand()` 理论上落在 [0,1)；万一外部注入了 1 或负数，钳到合法下标而不是返回 undefined
    const safe = Math.min(usable.length - 1, Math.max(0, Number.isFinite(idx) ? idx : 0));
    return usable[safe] ?? null;
}

/**
 * 筛选 + 截断候选池。
 *
 * 🔴 2026-11-13 用户口径（**本批反转了原注释**）：候选池要跟**当前页签**走 ——
 *    用户原话：「在对应的页签下的随机看一部应该是当前类型的随机出来而不是全部类型混在一起
 *    （只有当导航布局为合并视图时随机看一部才是全库中挑）」。
 *    ⇒ 调用方传进来的应当是**该页签筛过的条目**（不是 `service.list()` 全库）；
 *      合并视图那一支由宿主传 `null` 让它回退全库，⛔ 别在这里判导航布局（纯层不知道 settings）。
 *    仍保留 `WATCH_PICK_POOL_MAX` 截断（撑住超大库的每帧重算）。
 */
export function buildWatchPool(entries: readonly MediaEntry[]): MediaEntry[] {
    const out: MediaEntry[] = [];
    for (const e of entries ?? []) {
        if (isWatchCandidate(e)) {
            out.push(e);
            if (out.length >= WATCH_PICK_POOL_MAX) break;
        }
    }
    return out;
}

/**
 * 骰子按钮该不该露出来。
 *
 * 用户原话：「**不用搜索框时显示，输入文字搜索时隐藏**」。
 * ⚠️ 判据收成纯函数是为了让「输入一个空格算不算在用搜索框」这种边界有唯一答案 ——
 *    这里按**trim 后非空**算「在用」，与 `MediaList` 的 `searching` 同口径（那个也是 `trim()`）。
 * ⛔ 别改成 `searchText.length > 0`：只敲一个空格就把骰子藏起来会觉得是 bug。
 */
export function shouldShowWatchDice(searchText: string): boolean {
    return String(searchText ?? '').trim().length === 0;
}
