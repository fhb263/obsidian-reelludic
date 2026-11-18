/**
 * 统计页「标签词云」纯逻辑（②-3，2026-11-12 用户 m00353 裁定：词源用**条目标签 tags**）。
 *
 * ## 用户口径
 * 用户 m00353 ②-3 原话要求「增强统计页（如词云，各模块排序分组要对齐）」。
 * 问词源时用户选定「条目标签 tags（推荐先做这个）」⇒
 *   · 词 = `MediaEntry.tags` 里用户自己打的标签，**不解析笔记正文、不做中文分词**；
 *   · 好处：零 IO、不卡首屏、不需要新增缓存层；
 *   · 代价：只有手动打过标签的条目才进词云（没标签时给空态，⛔ 不拿标题凑数充数）。
 *
 * ## 为什么单独成模块（⛔ 别把这些逻辑写进 .svelte）
 *   ① 字号映射、截断、排序都是纯函数，可单测钉住口径；
 *   ② 「各模块排序分组要对齐」是用户原话 —— 排序口径必须和统计页其它区块一致，
 *      统一在这里定义一次，组件只管把 `{text, weight, level}` 渲染出来。
 *
 * ## 排序口径（与统计页其它区块对齐）
 *   频次降序 → 同频次按**首次出现顺序**（⛔ 不再按字典序：字典序会让用户看不出"哪类标签我更常用"，
 *   而 ASCII 与中文混排时字典序还接近随机）。
 */

import type { MediaEntry } from 'data/types';

/** 一个词云条目（组件只读这三个字段，⛔ 别在组件里重算字号） */
export interface WordCloudItem {
    /** 标签原文（已 trim，保留用户写法的大小写） */
    text: string;
    /** 频次 = 打过这个标签的条目数（同一条目的重复标签只算一次） */
    weight: number;
    /** 字号档位 1..5（1 最小、5 最大）。由 `cloudLevels` 按频次分档，⛔ 组件别自己算 */
    level: number;
}

/** 词云最多显示多少个词（超出按排序口径截断；太多会挤成一团反而读不出重点） */
export const WORD_CLOUD_MAX = 40;

/** 字号档位数量（与 CSS 里的 5 档一一对应） */
export const WORD_CLOUD_LEVELS = 5;

/**
 * 标签归一化：trim + 折叠内部连续空白。
 *
 * 🔴 **大小写不合并**：`RPG` 和 `rpg` 在用户心里是同一个东西，但合并会**改写用户写的字** ——
 * 词云显示 `rpg` 时用户会以为插件把他的标签改小了。所以这里只做空白归一，
 * 大小写差异靠"频次自然合并到显示更频繁的那个写法"解决不了，但至少不改写原文。
 * ⚠️ 如果你以后要合并大小写，必须先想清楚显示哪个写法（首见写法？最大频次写法？）——
 *    这是个产品决定，⛔ 别在纯函数里悄悄决定。
 */
export function normalizeTag(raw: string): string {
    return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 聚合词频。
 *
 * @param entries 条目列表（`tags` 缺失/非数组按空处理 —— 老数据零迁移）
 * @param max 最多返回多少词
 * @param exclude 要**整体排除**的标签（大小写与空白按 `normalizeTag` 口径归一后比较）
 * @returns 已排序、已截断、已分档的词云条目；无标签时返回空数组（认空态，⛔ 不造占位词）
 *
 * 🔴 2026-11-16 用户原话：「如果按标签归属自定义视图（如日常、工作），那标签词云统计的
 *    如工作、日常标签怎么办这些不是正常的标签」。裁定是**从词云里排除**。
 *
 * 为什么必须在纯层排除、⛔ 不能在 `StatsBoard` 里过滤结果：
 *   ① 排除如果发生在截断之后，被排除的词已经占掉了 `max` 名额 —— 用户会看到
 *      「说好 40 个词，实际只剩 22 个」，且名额被一堆本来不该出现的归属标签吃掉；
 *   ② `level` 是按**排名百分位**算的（见 `cloudLevels`）—— 带着归属标签排名再删掉，
 *      字号档位就被这些词"垫高"过，剩下的词会比应有的大一号；
 *   ③ 口径只有一个真源，任何新消费方拿到手就是对的。
 * ⚠️ 归一化后比较（而非拿原文比）：手填 `工作` 与 ` 工作 ` 是同一个归属标签，
 *    `normalizeTag` 之后才对齐；⛔ 别在这里顺手合并大小写（见 `normalizeTag` 的注释）。
 */
export function buildWordCloud(
    entries: readonly MediaEntry[],
    max: number = WORD_CLOUD_MAX,
    exclude: readonly string[] = [],
): WordCloudItem[] {
    const list = Array.isArray(entries) ? entries : [];
    const counts = new Map<string, number>();
    const firstSeen = new Map<string, number>();
    let seq = 0;

    // 排除集合先归一化进 Set（O(1) 命中；归属标签通常只有几个，构造成本可忽略）
    // ⚠️ 用**小写**做键、`text.toLowerCase()` 命中：排除口径必须与
    //    `pure/mediaViews.entryMatchesTags`（`mediaViews.ts:464` 拿 `toLowerCase()` 比）一致，
    //    否则用户把视图标签写成 `Work`、条目里打的是 `work` —— 视图能筛出条目、词云却排不掉这个词。
    //    ⛔ 这不等于「词云合并大小写」：这里只影响**要不要丢掉**，显示出来的永远是用户原文。
    const banned = new Set<string>();
    for (const raw of Array.isArray(exclude) ? exclude : []) {
        const t = normalizeTag(raw).toLowerCase();
        if (t) banned.add(t);
    }

    for (const e of list) {
        const tags = Array.isArray(e?.tags) ? e.tags : [];
        /** 同一条目里重复写同一个标签只算一次（`['科幻','科幻']` 是手误，不是两次兴趣） */
        const seenHere = new Set<string>();
        for (const raw of tags) {
            const text = normalizeTag(raw);
            if (!text || seenHere.has(text)) continue;
            if (banned.has(text.toLowerCase())) continue;
            seenHere.add(text);
            counts.set(text, (counts.get(text) ?? 0) + 1);
            if (!firstSeen.has(text)) firstSeen.set(text, seq++);
        }
    }

    const all: WordCloudItem[] = [];
    for (const [text, weight] of counts) {
        all.push({ text, weight, level: 1 });
    }

    // 频次降序 → 首见顺序升序（稳定且可解释，见模块头）
    all.sort((a, b) => (b.weight - a.weight) || ((firstSeen.get(a.text) ?? 0) - (firstSeen.get(b.text) ?? 0)));

    const cap = Math.max(1, Math.floor(Number(max) || WORD_CLOUD_MAX));
    const top = all.slice(0, cap);
    const levels = cloudLevels(top.map((w) => w.weight));
    for (let i = 0; i < top.length; i++) top[i].level = levels[i];
    return top;
}

/**
 * 词云可用的色相数量（与 `StatsBoard.svelte` 里的 `.rl-cloud-w.hue-N` 一一对应）。
 *
 * 🔴 2026-11-15 用户 m05266：「标签词云加更多的颜色」。
 *    改前五档颜色全是灰阶（`--text-faint` / `--text-muted` / `--text-normal`），
 *    只有明暗差别，一眼看过去还是一坨灰。现在按**词本身**分配色相，档位只管字号与浓淡。
 */
export const CLOUD_HUE_COUNT = 8;

/**
 * 词 → 色相下标（0..`CLOUD_HUE_COUNT - 1`）。
 *
 * 口径（⛔ 别改成按数组下标取色）：
 *   · **同一文本永远同一个颜色**：重新排序、新增标签、切页签都不会让已有的词换色，
 *     否则用户每次看词云都像换了一张图，色相就失去「这是我熟悉的那个标签」的记忆价值；
 *   · 用 FNV-1a 直接哈希字符码点，不依赖 `Math.random`、不依赖出现顺序 ⇒ 结果可复现、可单测；
 *   · 相邻色相会有碰撞（8 个桶装 40 个词，必有同色）—— 这是可接受的：
 *     颜色只是辅助区分，字号（档位）才是频次的真信号。
 */
export function cloudHueIndexOf(text: string): number {
    const s = String(text ?? '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619); // FNV-1a 32 位
    }
    return Math.abs(h) % CLOUD_HUE_COUNT;
}

/**
 * 把频次映射成 1..`WORD_CLOUD_LEVELS` 的档位。
 *
 * 口径（⛔ 别改成"线性归一"）：
 *   · 最高频 = 最高档，最低频 = 最低档 —— 保证词云一定有视觉对比；
 *   · 全部同频 ⇒ **全部给中档**（3 档），⛔ 不要给 1 档：那会让"只有 3 个标签都用了 1 次"的
 *     用户看到一堆最小号灰字，像坏了；中档至少可读。
 *   · 用**排名百分位**而不是 `weight / max`：长尾标签（1 次）与次高频（2 次）之间
 *     用比例算会都落到最低档，词云就塌成"两三个大词 + 一堆一样小的词"。
 */
export function cloudLevels(weights: readonly number[], levelCount: number = WORD_CLOUD_LEVELS): number[] {
    const n = Array.isArray(weights) ? weights.length : 0;
    const lv = Math.max(1, Math.floor(Number(levelCount) || WORD_CLOUD_LEVELS));
    if (n === 0) return [];
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    if (min === max) return weights.map(() => Math.ceil(lv / 2)); // 全同频 ⇒ 中档
    // ⚠️ 单个词必然 `min === max`，上面那行已经把它送进中档分支了 —— ⛔ 别再补 `n === 1` 的特判，
    //    那是死代码（永远走不到），而且「只有一个词」时给中档本来就对：没有对比对象，大小无意义。
    // 🔴🔴 2026-11-15 修：这里原先是 `(w - min) / (max - min)` —— 那就是**线性归一**，
    //    正是上面注释明令禁止的口径，只是当年没被数据打出来。
    //    用户真实库（153 条 / 52 个题材）一灌进去就塌了：Top1 喜剧 57、Top2 动画 55 双双 5 档，
    //    第 3 名奇幻 21 到第 40 名经济 1 **全挤在 2 档** —— 词云变成「两个字巨大 + 三十八个一样小」，
    //    正是注释里说的「塌成两三个大词 + 一堆一样小的词」。
    //    根因：一条 57 的极值把 [min,max] 拉得极宽，中间 20 与 1 的差距被压成 0.34 → 四舍五入后同档。
    //    改成注释承诺的**排名百分位**：看「比我高的有几个」而不是「我离最大值多远」。
    //    ⚠️ 并列频次必须拿同一档（按值取首次出现的排名），否则同频词会因数组顺序不同而字号不一。
    const sorted = [...weights].sort((a, b) => b - a);
    const out: number[] = [];
    for (const w of weights) {
        const rank = sorted.indexOf(w); // 严格大于我的个数 = 我在降序里的首个位置
        const p = 1 - rank / (n - 1); // 1 = 最高频，0 = 最低频
        out.push(Math.min(lv, Math.max(1, Math.round(1 + p * (lv - 1)))));
    }
    return out;
}
