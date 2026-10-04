// 系列 / 合集分组 —— 海报墙「系列折叠卡」的纯逻辑（#434；无 obsidian、无 DOM，可单测）。
//
// 需求（用户 2026-09-30）：同一 IP 下多部作品「既想全部收集又难以归类」——
// 书籍《基地》系列几部、电影《熊出没》十几部、动画《海绵宝宝》17 季……
// 海报墙上一屏十几张**同质海报**，既看不出「我收齐了没」，也不知道「还有没有下一部」。
//
// 🔴 **分组键 = `type` + 归一化系列名**（用户 2026-09-30 裁定「不做跨类型：
//    电影一个海绵宝宝系列折叠卡，动画一个海绵宝宝系列折叠卡，其他的不管」）。
//    ⇒ 同名不同类**永不合并**；类型=全部 的影视页签下会**并排两张卡**，那是预期行为、不是 bug。
//    ⚠️ 这条与「`series` 字段放开到全部 6 类型」并不矛盾：**字段全类型可用，但分组限同类型**。
//       只要把 `type` 拼进分组键，两条自动同时满足（本文件第 2 条单测钉的就是它）。
//
// 🔴 **组名 = `${系列名} ${类型}系列`**（用户 2026-09-30 追加：「组名称再区分开来，如海绵宝宝 电影系列、
//    海绵宝宝 动画系列」）⇒ 折叠卡标题与展开态组头**必须同源**（都调 `seriesTitleOf`），
//    ⛔ 别在两处各拼一次 —— 两处必然漂移（本仓「多个入口各写一套」栽过多次）。
import type { EntryType, MediaEntry } from 'data/types';
// ⚠️ `MediaStatus` 的真源是 `pure/status`（`data/types` 只是**内部**引用它、不对外导出）
import type { MediaStatus } from './status';
// 🔴 #472：组级进度**必须复用单卡那份取值口径**（`percent` 优先、无则按 `page/totalPage`）——
//   卡面那行 `.rl-readrow` 用的是什么，这里就得是什么，⛔ 别在本文件里另写一套百分比判定。
import { readPercent } from './mediaProgress';
import { ENTRY_TYPE_LABELS } from 'data/types';

/** 分组键里分隔「类型」与「系列名」的字符（不可打印 ⇒ 真实系列名不可能含它；与 pageKey 同款惯例） */
const KEY_SEP = '\u0001';

/**
 * 系列名**归一化**（只用于**比较/分组**，⛔ 不改显示名）。
 *
 * 口径：trim → 内部空白折成单空格 → 小写。
 * ⚠️ `\s` 在 JS 里**包含全角空格 U+3000** ⇒ 中日文输入法下的全角空格自动折平，不必另写规则。
 * ⚠️ **标点差异仍会裂成两组**（`基地（Foundation）` ≠ `基地(Foundation)`）—— 这是**有意不做的归一**
 *   （Calibre 同样是这个口径）：过度归一（如把括号全去掉）会误合并真正不同的系列。
 *   缓解手段是**输入建议**（表单侧复用已有系列名），不是在这里猜。
 */
export function normalizeSeriesName(raw: string | undefined | null): string {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/** 条目的系列显示名（trim 后原样；没填 / 全空白 ⇒ 空串，表示「不参与分组」） */
export function seriesNameOf(e: { series?: string } | null | undefined): string {
    return String(e?.series ?? '').trim();
}

/** 条目的**分组键**；没填系列名 ⇒ `null`（⛔ 返回空串不行：空串会被当成一个合法的「空系列」把所有无系列条目聚成一组） */
export function seriesKeyOf(e: { type: EntryType; series?: string } | null | undefined): string | null {
    if (!e) return null;
    const name = normalizeSeriesName(e.series);
    if (!name) return null;
    return `${e.type}${KEY_SEP}${name}`;
}

/** 折叠卡标题 / 组头文字（**单一真源**）：`海绵宝宝` + `动画` ⇒ `海绵宝宝 动画系列` */
export function seriesTitleOf(name: string, type: EntryType): string {
    const n = String(name ?? '').trim();
    // 类型名取 ENTRY_TYPE_LABELS（单一真源），⛔ 别在视图层自造词（「动画」被写成「番剧」这类漂移必然发生）
    return `${n} ${ENTRY_TYPE_LABELS[type] ?? ''}系列`.trim();
}

/**
 * 系列序号 → **整数**（#443 起锁定）。
 *
 * 🔴 为什么锁成整数：真库里出现过 `3.5` / `8.5` 这样的序号（当年照 Calibre 口径允许小数），
 *    结果**第七季 8.5 排在第八季 8 后面** —— 序号一旦允许小数，「排序」就不再等于用户心里的
 *    「第几部 / 第几季」。用户 2026-09-30 裁定：**只能填整数，不能填小数**。
 * ⚠️ 这里（读取侧）也取整：存量数据里的 `8.5` **不用等用户重新保存**就已经按 9 参与排序与笔记；
 *    ⛔ 但这只是**读时归一**，⛔ 不回写 catalog（本仓不静默改写用户数据）。
 */
export function seriesIndexValue(e: { seriesIndex?: number } | null | undefined): number | undefined {
    const v = e?.seriesIndex;
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

/**
 * 解析**表单里那个序号框**的值 → `number | undefined`。
 *
 * 🔴🔴 存在的唯一理由：`<input type="number" bind:value={x}>` 里，Svelte 的 `bind:value` 走的是
 * `to_number` —— **用户一敲键盘，`x` 就从字符串变成 `number`（清空则 `null`）**，
 * 于是任何 `x.trim()` 都会在**运行时**抛 `TypeError: x.trim is not a function`。
 * ⚠️ 这类错误 **tsc 查不出来**（初值 `String(...) : ''` 让它被推断成 `string`），而且
 * 崩在 `on:click` 里 = **静默死按钮**（无提示、不关窗）—— `#434` 就是这么埋进去的，
 * 用户报「填写了系列名称和系列序号……怎么点都没反应，也没提示」。
 * ⇒ 凡是「数字框喂给纯逻辑」的地方，一律走这里，⛔ 别在视图层裸写 `.trim()` / `Number()`。
 *
 * 口径：字符串先 trim（空 ⇒ undefined）；数字直接用；`null` / `undefined` / 非数 / `NaN` / `Infinity` ⇒ undefined。
 * （非有限数落 `undefined` 而不是拦保存：改个标题不该被一个手滑的 `2.5.5` 卡住，⛔ 但绝不把 NaN 写进 catalog。）
 * 🔴 #443：**只出整数** —— 小数一律**四舍五入**（与读取侧 `seriesIndexValue` 同一口径）。
 *    ⚠️ 仍然**不拦保存**（填 8.5 ⇒ 存 9），⛔ 别改成抛错：那会把用户卡在「保存不了」的状态里。
 */
export function parseSeriesIndexInput(raw: unknown): number | undefined {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim() === '' ? NaN : raw.trim()) : NaN;
    return Number.isFinite(n) ? Math.round(n) : undefined;
}

/**
 * 系列操作面板里「该继续哪一部」—— 供面板给那一行标「继续」（#438）。
 *
 * 规则（顺序 = 优先级）：
 *  ① **在看**里最靠前的那部（用户已经在追它，最可能想接着看）；
 *  ② 否则**想看**里最靠前的（还没开始的那部）；
 *  ③ 否则第一部（全看完 / 全存档时也要有个默认，⛔ 不返回 `undefined`）。
 * ⚠️ 「已看」**不**优先 —— 已看完的再推一次是噪音；存档同理（归档 = 用户主动收起来）。
 * ⚠️ 传进来的顺序就是显示顺序（`foldSeries` 已按 `sortSeriesItems` 排好）⇒ 本函数**只挑、不改顺序**。
 */
export function nextSeriesEntry<T extends { status?: MediaStatus }>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items.find((i) => i.status === 'watching') ?? items.find((i) => i.status === 'want') ?? items[0];
}

/**
 * 折叠卡的**状态徽标**该显示什么（#438 次日·用户「系列折叠卡怎么没有标签状态显示的如想看存档之类的」）。
 *
 * 一个组里的 N 条可以有 N 种状态，而卡面只放得下一枚徽标 ⇒ 口径 = **「建议接着看的那一条」的状态**
 * （在看 > 想看 > 第一条），也就是面板里标「继续」的那一格 —— **同一个纯函数、同一个优先级**，
 * ⛔ 别在视图层另写一套判定（两套必然漂移：卡面写「在看」、点开却把「想看」标成继续）。
 *
 * ⚠️ **先滤掉「已看 / 存档」** 再挑（与面板的「继续」完全一致）：全都看完的系列不该显示「在看」；
 *    滤空之后退回**首条**的状态 —— 组总得有个状态能显示，返回 `undefined` 会让整行消失、卡面又缺一块。
 */
export function seriesStatus<T extends { status?: MediaStatus }>(items: readonly T[]): MediaStatus | undefined {
    if (items.length === 0) return undefined;
    const live = items.filter((i) => i.status !== 'watched' && i.status !== 'archived');
    return (nextSeriesEntry(live) ?? items[0]).status;
}

/**
 * 组内排序（D-42）：`seriesIndex` 升序 → **无序号的一律排在有序号之后** → 年份升序（无年份亦置后）→ 标题（zh）。
 *
 * ⚠️ 为什么不沿用海报墙当前的 `sortBy`：折叠卡的**存在意义**就是「把这个系列按顺序摊开看」——
 *    用户点开它想看的是「第 1 部 → 第 N 部」，而不是「最近更新的排前面」。
 * ⚠️ 无 index 的条目排到最后而不是最前：手填了序号的显然是主力作品，没填的多是外传/衍生。
 */
/**
 * 组内 / 系列序号排序的**比较器**（#441）：序号升序 → 无序号的**置后** → 年份 → 标题。
 *
 * 🔴 它是**单一真源**：`sortSeriesItems`（组内）与 `pure/search` 的「系列序号」排序档共用同一份比较逻辑
 *    （⛔ 别在视图层或搜索层再写一遍 —— 两处各写一套必然漂移，本仓栽过多次）。
 * ⚠️ **无序号的置后**而不是置前：没填序号的作品是「还没归类」，让它压在排好序的那些前面会打乱观感。
 */
export function compareSeriesIndex<T extends { title?: string; year?: number; seriesIndex?: number }>(a: T, b: T): number {
    const ia = seriesIndexValue(a);
    const ib = seriesIndexValue(b);
    if (ia !== ib) {
        if (ia === undefined) return 1;
        if (ib === undefined) return -1;
        return ia - ib;
    }
    const ya = typeof a.year === 'number' ? a.year : Number.POSITIVE_INFINITY;
    const yb = typeof b.year === 'number' ? b.year : Number.POSITIVE_INFINITY;
    if (ya !== yb) return ya - yb;
    return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'zh');
}

export function sortSeriesItems<T extends { title?: string; year?: number; seriesIndex?: number }>(items: readonly T[]): T[] {
    return [...items].sort(compareSeriesIndex);
}

/**
 * 同一份口径的**反向**（序列号的降序档）。
 * ⚠️ 与「直接对整个比较器取反」不同：**没填序号的仍然置后**（两个方向都一样）——
 *    它们是「还没归类」，不该因为倒序就翻到最前面。
 */
export function compareSeriesIndexDesc<T extends { title?: string; year?: number; seriesIndex?: number }>(a: T, b: T): number {
    const ia = seriesIndexValue(a);
    const ib = seriesIndexValue(b);
    if (ia === undefined || ib === undefined) {
        if (ia === ib) return -compareSeriesIndex(a, b); // 都没填 ⇒ 年份/标题也跟着倒过来
        return ia === undefined ? 1 : -1; // 无序号恒置后
    }
    if (ia !== ib) return ib - ia;
    return -compareSeriesIndex(a, b); // 序号相同 ⇒ 年份/标题倒序（与正序严格相反）
}

/** 一个系列组（≥2 条才成组，见 foldSeries） */
export interface SeriesGroup {
    /** 分组键（`type` + `\u0001` + 归一化名） */
    key: string;
    type: EntryType;
    /** 显示名（取组内**首个成员**的原名 trim 后 —— 同名不同写法时以先出现的为准） */
    name: string;
    /** 折叠卡标题 = `seriesTitleOf(name, type)` */
    title: string;
    /** 组内条目（已按 sortSeriesItems 排好） */
    items: MediaEntry[];
}

/** 折叠后的一行：散卡 or 一张系列折叠卡 */
export type SeriesRow = { kind: 'single'; entry: MediaEntry } | { kind: 'series'; group: SeriesGroup };

/**
 * 把（已筛选 + 已排序的）条目流折成「行」。
 *
 * 🔴 三条口径：
 *  1. **只折 ≥2 条的组** —— 只有一条时折起来反而多一次点击、还看不出「这是个系列」；
 *  2. **折叠卡占「组内首个成员在原流里的位置」** —— 保住海报墙当前的排序观感
 *     （⛔ 别把折叠卡统一挪到最前/最后，那会让「最近更新」这类排序失去意义）；
 *  3. **组内成员按 `sortSeriesItems` 排**（不是按原流顺序）—— 见该函数注释。
 */
export function foldSeries(entries: readonly MediaEntry[]): SeriesRow[] {
    const order: string[] = [];
    const buckets = new Map<string, MediaEntry[]>();
    for (const e of entries) {
        const key = seriesKeyOf(e);
        if (!key) continue; // 无系列名：走散卡
        const list = buckets.get(key);
        if (list) list.push(e);
        else {
            buckets.set(key, [e]);
            order.push(key); // 首次出现的位置 = 折叠卡落点
        }
    }
    const foldable = new Set(order.filter((k) => (buckets.get(k)?.length ?? 0) >= 2));

    const rows: SeriesRow[] = [];
    const emitted = new Set<string>();
    for (const e of entries) {
        const key = seriesKeyOf(e);
        if (!key || !foldable.has(key)) {
            rows.push({ kind: 'single', entry: e });
            continue;
        }
        if (emitted.has(key)) continue; // 组成员不单独出卡（它们进了折叠卡）
        emitted.add(key);
        const items = buckets.get(key) ?? [];
        rows.push({
            kind: 'series',
            group: {
                key,
                type: e.type,
                name: seriesNameOf(e),
                title: seriesTitleOf(seriesNameOf(e), e.type),
                items: sortSeriesItems(items),
            },
        });
    }
    return rows;
}

/** 卡片缺失字段占位（与 `pure/cardMeta` 同款 —— 同列卡片行占位恒定才不会错位） */
const PLACEHOLDER = '—';

/**
 * 折叠卡的「年份跨度」行（占用普通卡的**创作者行**那一格）：
 * 0 个年份 → `—`；1 个 → `2014`；≥2 个 → `2014–2019`（**en dash**，与卡面其它区间写法一致）。
 * ⚠️ 只取**极值**而不是把每个年份都列出来 —— 十几部作品列全了会把这行撑爆（卡面是单行省略）。
 */
export function seriesYearSpan(items: ReadonlyArray<{ year?: number }>): string {
    const years = items
        .map((i) => i.year)
        .filter((y): y is number => typeof y === 'number' && Number.isFinite(y))
        .sort((a, b) => a - b);
    if (years.length === 0) return PLACEHOLDER;
    if (years[0] === years[years.length - 1]) return String(years[0]);
    return `${years[0]}–${years[years.length - 1]}`;
}

/**
 * 折叠卡的题材行：组内题材取并集（**首个出现的顺序**，稳定不随输入漂移），只取前 2 个用 ` · ` 连接。
 * 取 2 个的理由与 `pure/cardMeta.cardGenres` 一致：卡面那一行宽度固定，多了会被省略号吃掉。
 */
export function seriesGenres(items: ReadonlyArray<{ genres?: string[] }>): string {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
        for (const g of it.genres ?? []) {
            if (typeof g !== 'string') continue;
            const v = g.trim();
            if (!v || seen.has(v)) continue;
            seen.add(v);
            out.push(v);
            if (out.length === 2) return out.join(' · ');
        }
    }
    return out.length > 0 ? out.join(' · ') : PLACEHOLDER;
}

/**
 * 折叠卡的**组级阅读进度**（#472，用户报障：「书籍类型下系列折叠卡没有进度条样式不一致」）。
 *
 * 口径 = **按部平均**（用户 2026-10-01 裁定）：组内每部取单卡那份 `readPercent`，
 * **没开始读的部按 0 计入分母**，再平均、四舍五入、钳 0–100。
 *
 * · 为什么**按部平均**而不是按页加权：折叠卡回答的是「这个系列我还剩几部没读」——
 *   部与部**等权**才贴合这个直觉（1 部 1000 页读一半、1 部 100 页读一半，都算「读掉半部」）。
 * · ⚠️ 每部的取值**必须走 `readPercent`**（单卡同一份口径）—— 视图层那条 `.rl-readrow` 用的就是它；
 *   ⛔ 别在本文件里另写一套百分比判定（两处必然漂移：卡面 40%、折叠卡 45%）。
 * · ⚠️ **没进度的部不能 skip**：3 部里 1 部读完、2 部没开 ⇒ 应是 **33%**；
 *   skip 掉没进度的会算成 100%（看着像「这个系列读完了」，与封面折叠卡上的状态徽标直接打架）。
 * · **全都没进度 ⇒ `undefined`**（整条进度行不渲染）—— 与单卡「未开始不渲染灰线」同一口径，
 *   ⛔ 别返回 0（那会在还没开读的系列上画一条空槽，像坏掉的进度条）。
 */
export function seriesReadPercent(items: ReadonlyArray<MediaEntry>): number | undefined {
    if (items.length === 0) return undefined;
    let sum = 0;
    let any = false;
    for (const it of items) {
        const p = readPercent(it);
        if (p !== undefined) any = true;
        sum += p ?? 0;
    }
    return any ? Math.max(0, Math.min(100, Math.round(sum / items.length))) : undefined;
}

/**
 * 组内**已读完的部数**（折叠卡进度条右侧那行小字「已读完 k/N 部」）。
 *
 * ⚠️ 「读完」的判定同样走 `readPercent(it) === 100` —— 与 {@link seriesReadPercent} **同口径**
 * （`percent: 100` 与 `page === totalPage` 都算读完）；⛔ 两处判定不一致必然漂移。
 */
export function seriesReadDone(items: ReadonlyArray<MediaEntry>): number {
    return items.filter((it) => readPercent(it) === 100).length;
}

// ──────────── #435 的两件「已退场」能力（⛔ 别再加回来）────────────
//
// 本文件在 #435 里一度还导出过两件东西，**用户上手当天/次日全部推翻**，现均已拆除：
//
// ① **系列筛选池**（`SeriesOption` / `buildSeriesOptions` / `matchesSeries`）—— 供海报墙工具栏那枚
//    「系列」下拉用。用户原话：「**删除这个筛选系列框**，海报墙有且**默认折叠**起来」
//    ⇒ 系列的取舍回到**只有折叠卡**这一条路（折叠卡本来就默认是叠起来的，见 `foldSeries`）。
//    数据侧同样是负担：筛选把「页签 → 类型 → 状态 → 排序 → 题材」这条已经很长的漏斗又加了一层。
//
// ② **已有系列名建议清单**（`seriesNamePool` + 表单 `<datalist>`）—— 理由见本文件顶部那段。
//
// ⇒ 现在这个模块只服务**折叠卡**一件事：归一化 / 分组键 / 组名 / 组内排序 / 组内两行占位。

// ──────────── 系列选择弹窗的版面算式（#438 建立 / 同日两次改版：封面网格 → 居中弹窗）────────────
//
// 弹窗 = 「一格一部/一季」的封面网格。**一格 110px、间距 10px**，列数 = 组内部数钳在 1~**视口档位上限**，
// 宽度再 `clamp(320, …, 1092)` —— 见 `seriesPanelWidth`。
// 🔴 为什么算式要放在纯模块里（而不是视图里 `$:` 一行）：它是**「每行恰好 N 格」这条性质的唯一真源**，
//    而 jsdom 没有布局、组件探针量不到换行 ⇒ 只能在这一层用单测钉住（本仓「纯逻辑下沉」红线）。
// ⚠️ 格子宽度被用户点名改过三次（120 → 150「继续做宽大点」→ 110「封面太大了」）——
//    改它要**三处同步**：本常量 / `.rl-series-act-tile` 的 `width` / `SERIES_PANEL_MAX_W` 与单测档位。
export const SERIES_TILE_W = 110;
export const SERIES_TILE_GAP = 10;
/** `.rl-series-act-tiles` 的左右内距各 10px */
export const SERIES_TILE_PAD = 10;
/**
 * 🔴🔴 `.rl-series-act` 左右边框各 1px，**这两像素不能省**（2026-09-30 仿真页量出来的）。
 *
 * 宿主核心有全局 `*{box-sizing:border-box}`（已在 Obsidian 的 `app.css` 里核实）⇒ 面板的 `width`
 * **包含左右边框**，格子容器真正拿到的可用宽 = `width − 2`。少算这 2px 的后果不是「差一点点」而是
 * **每少一格都换行**（实证：2 部 ⇒ 1+1、3 册 ⇒ 2+1、4 列 ⇒ 3+2）。⛔ 别退回 `+ 20`。
 */
export const SERIES_ACT_BORDER = 2;
/**
 * **默认档**一屏最多几列（再多就换行）。
 * 🔴 #442（2026-09-30 用户点名）：**默认一行 6**（原来 4）—— 8 部折成 2 行、十几季折成 5 行，
 *    弹窗被顶得**显示不全**。⛔ 别退回 4（单测与断言两头都钉着）。
 * 🔴 #444（同日再点名）：6 只是**中窗那一档**；上限随视口宽分档，见 `seriesColsCap`。
 *    ⚠️ 它仍只是**上限** —— 部数不够时列数照旧跟着部数走（3 部永远不会因为窗宽就摊成 9 格）。
 */
export const SERIES_COLS_MAX = 6;
/**
 * 🔴 #444：**宽窗**档上限（用户：「窗口拉宽后改为 9 个」）。
 * 9 列那档的面板宽 = `9×110 + 8×10 + 2×10 + 2 = 1092` ⇒ 视口可用宽够 1092 才启用。
 */
export const SERIES_COLS_MAX_WIDE = 9;
/** 🔴 #444：**窄窗**档上限（用户：「拉窄后改为 4 或 3 个」—— 这是 4 那一档） */
export const SERIES_COLS_MAX_NARROW = 4;
/**
 * 🔴 #444：**极窄**档上限（同上 —— 这是 3 那一档）。
 * ⚠️ 底下就只剩 1~2 列了（再窄本来也放不下第二格封面）。
 */
export const SERIES_COLS_MAX_TIGHT = 3;
/**
 * 视口太窄时按它**自适应**收列 —— 面板左右各留这么多像素（不贴着屏幕边缘）。
 *
 * 🔴🔴 **它必须等于遮罩 `.rl-series-scrim` 的 `padding`（现在两边都是 24）** ——
 *    这是**同一个数字的两份拷贝**（纯模块算式 / 组件 CSS），而算式的产出是**行内 `width`**，
 *    弹窗又写着 `max-width: 100%`：可用宽少算 1px，算出来的宽度就会被截窄一点，
 *    **那一档的最后一格立刻换行**（症状与「少算 2px 边框」一模一样，只是这次差的是遮罩内距）。
 *    ⚠️ #444 修的就是这个：原来是 **16**（比遮罩的 24 少 8）⇒ 视口落在档位边界附近时
 *    （`innerWidth ∈ [1124, 1140)` 那 16px 带）会算出 1092 却只有 `< 1092` 可用 ⇒ 9 列排成 8+1。
 *    ⛔ 改其中一个必须同时改另一个 —— 产物断言里有一条**等式守卫**钉着这对数字。
 * 只用于「把视口宽换算成可用宽」这一步，⛔ 别拿它当面板的内距（那是 `SERIES_TILE_PAD`）。
 */
export const SERIES_PANEL_EDGE_GAP = 24;
/**
 * 弹窗**最小宽度**（#438 次日改「居中弹窗」后新增）。
 * 为什么要它：弹窗现在居中显示，太窄的话标题行（组名 + N 部 + 关闭钮）自己就挤不下了。
 * ⇒ 1~2 部时宽度不再跟着格子走，直接用这个下限（内容是居中排的，左右留白是对称的，不难看）。
 */
export const SERIES_PANEL_MIN_W = 320;
/**
 * 弹窗**最大宽度**（同上）。⛔ 必须 ≥ **满列那档**的算式值，否则算出来的宽度会被 CSS 截窄、格子又换行。
 *
 * 🔴 #444（2026-09-30）：随着宽窗档提到 **9 列**，这个上限从 732 一并放到 **1092**
 *    （= `9×110 + 8×10 + 2×10 + 2`）。⚠️ 它**恒等于** `seriesPanelFitWidth(SERIES_COLS_MAX_WIDE)` ——
 *    单测里有一条等式钉着，⛔ 别手改其中一个。
 */
export const SERIES_PANEL_MAX_W = 1092;

/**
 * 让 `cols` 列**恰好排进一行**所需的面板宽（含左右内距与那 2px 边框）。
 *
 * 🔴 它是「档位阈值」与「面板宽度」的**同一个算式** —— ⛔ 别在别处再写一遍 `n*110+…`
 *    （两处各写一套必然漂移，本仓栽过多次）。
 */
export function seriesPanelFitWidth(cols: number): number {
    const n = Math.max(1, Math.trunc(Number.isFinite(cols) ? cols : 1));
    return n * SERIES_TILE_W + (n - 1) * SERIES_TILE_GAP + 2 * SERIES_TILE_PAD + SERIES_ACT_BORDER;
}

/**
 * 视口可用宽 → **列数上限档位**（🔴 #444 用户点名：「一排默认显示 6 个，窗口拉宽后改为 9 个，
 * 拉窄后改为 4 或 3 个」）。
 *
 * 档位（阈值一律由 `seriesPanelFitWidth` 导出，⛔ 不写死 px）：
 *   宽窗（够 9 列）→ 9 ｜ 中窗（够 6 列）→ **6 = 默认** ｜ 窄窗（够 4 列）→ 4 ｜ 再窄 → 3
 * ⚠️ 不传 / 传 0 / 传非有限数 ⇒ **默认档 6**（老调用与既有单测不受影响）。
 * ⚠️ 这是**上限**不是结果：真正列数还要再按部数钳一次（见 `seriesPanelCols`）。
 */
export function seriesColsCap(availW?: number): number {
    if (!Number.isFinite(availW) || (availW as number) <= 0) return SERIES_COLS_MAX;
    const w = availW as number;
    if (w >= seriesPanelFitWidth(SERIES_COLS_MAX_WIDE)) return SERIES_COLS_MAX_WIDE;
    if (w >= seriesPanelFitWidth(SERIES_COLS_MAX)) return SERIES_COLS_MAX;
    if (w >= seriesPanelFitWidth(SERIES_COLS_MAX_NARROW)) return SERIES_COLS_MAX_NARROW;
    return SERIES_COLS_MAX_TIGHT;
}

/**
 * 列数 = 部数钳在 1~**视口档位上限**；0 / 负数 / 非数一律当 1 列；小数向下取整。
 *
 * 🔴 #442 新增**可选第二参 `availW`（可见视口可用宽）**：装不下就**少放几列**（自适应）。
 *    不传 / 传 0 / 传非有限数 ⇒ 退化为「只看部数」（老调用与单测不受影响）。
 * 🔴 #444：上限不再恒等于 6，而是 `seriesColsCap(availW)` 给的档位（9 / **6** / 4 / 3）。
 *    ⚠️ 两道钳制**顺序不能反**：先按档位封顶（`byCount`），再按「这一档实际装得下几格」（`fit`）收
 *    —— 反过来的话，宽窗档（cap 9）算出来的 `fit` 可能大到 9，而部数只有 8 时就会多排一格空白。
 */
export function seriesPanelCols(count: number, availW?: number): number {
    const n = Number.isFinite(count) ? Math.trunc(count) : 1;
    const byCount = Math.min(Math.max(n, 1), seriesColsCap(availW));
    if (!Number.isFinite(availW) || (availW as number) <= 0) return byCount;
    const w = availW as number;
    const fit = Math.floor((w - 2 * SERIES_TILE_PAD - SERIES_ACT_BORDER + SERIES_TILE_GAP) / (SERIES_TILE_W + SERIES_TILE_GAP));
    return Math.min(byCount, Math.max(fit, 1));
}

/**
 * 弹窗宽度（内联给 `.rl-series-act`，单位 px）。
 * = `clamp(320, 列数×格宽 + 间距 + 左右内距 + 边框, min(1092, 可用宽))` —— 「按部数 + 视口分档自适应的居中弹窗」。
 * ⚠️ 上限取 `min(MAX_W, availW)`：窄视口下宁可少几列，⛔ 别让弹窗比视口还宽（那样会被 CSS 截窄、
 *    格子又换行，等于白算）。
 */
export function seriesPanelWidth(count: number, availW?: number): number {
    const cols = seriesPanelCols(count, availW);
    // 🔴 #444：算式收敛到 `seriesPanelFitWidth`（档位阈值与宽度**同一个真源**）
    const fitted = seriesPanelFitWidth(cols);
    const upper =
        Number.isFinite(availW) && (availW as number) > 0
            ? Math.min(SERIES_PANEL_MAX_W, availW as number)
            : SERIES_PANEL_MAX_W;
    return Math.min(Math.max(fitted, SERIES_PANEL_MIN_W), upper);
}

/** 这一档宽度分给格子的**可用宽**（面板宽 − 边框 − 左右内距）—— 单测用它钉「一行恰好 cols 格」 */
export function seriesPanelTileSpace(count: number, availW?: number): number {
    return seriesPanelWidth(count, availW) - SERIES_ACT_BORDER - 2 * SERIES_TILE_PAD;
}
