// 海报密度（pure/posterGrid）
//
// 需求（用户 2026-09-22）：海报墙**默认按容器宽度自适应列数**；设置页提供「海报密度」档位
// （紧凑 / 标准 / 宽松 / 自定义列数，默认标准）；自定义列数必须有**最小卡片宽度保护**，
// 避免小屏挤压；**不提供自由拖拽列宽**。
//
// 实现口径：不测量容器、不用 ResizeObserver —— 只把设置翻译成一条 `grid-template-columns` 字符串，
// 由浏览器 layout 自己决定实际列数（拖分隔条 / 窄侧栏 / 分屏全部自动成立）。
// 这就是 CSS-Tricks《An Auto-Filling CSS Grid With Max Columns of a Minimum Size》（Drupal 10 core）
// 的写法，纯 CSS 表达「列数上限 + 最小宽度」：
//
//   档位：  repeat(auto-fill, minmax(min(<卡宽>px, 100%), 1fr))
//   自定义：repeat(auto-fill, minmax(min(max(<卡宽>px, calc((100% - 间距总量) / N)), 100%), 1fr))
//
// 两条公式各自解决一件事：
//   ⑴ `max(卡宽, 按列数反算的列宽)` —— 容器够宽时反算值 ≥ 卡宽，轨道数**恰好等于 N**（宽 N 列）；
//      容器变窄使反算值 < 卡宽时，轨道数自动减少（这就是「最小卡片宽度保护」）。
//   ⑵ 外层 `min(…, 100%)` —— 容器比「一张卡片的最小宽」还窄时不再硬撑，避免横向溢出
//      （原 `.rl-grid` 只有 minmax(180px, 1fr)，窄侧栏会溢出，本轮一并补上）。

/** 密度档位（schema：设置项 append-only，只增不改） */
export type PosterDensity = 'compact' | 'standard' | 'cozy' | 'custom';

/** 档位顺序 = 设置页下拉顺序（紧凑最密 → 自定义） */
export const POSTER_DENSITIES: readonly PosterDensity[] = ['compact', 'standard', 'cozy', 'custom'];

export const POSTER_DENSITY_LABELS: Record<PosterDensity, string> = {
    compact: '紧凑',
    standard: '标准',
    cozy: '宽松',
    custom: '自定义列数',
};

/** 取「最小卡片宽度」的两个档（自定义档不在此表——它换成了列数维度） */
export type PosterMinWidthDensity = 'compact' | 'standard' | 'cozy';

/**
 * 各档最小卡片宽度（px）。**「标准」= 180 是历史值**（原 `.rl-grid` 硬编码 180px），
 * 改它等于一次性改掉所有老用户的海报墙观感，非必要不动。
 */
export const POSTER_CARD_MIN_WIDTHS: Record<PosterMinWidthDensity, number> = {
    compact: 150,
    standard: 180,
    cozy: 220,
};

/** 卡片间距（px）：必须与 MediaList `.rl-grid` 的 gap 一致 —— 自定义列数按它反算列宽 */
export const POSTER_GRID_GAP = 12;

/**
 * 🔴 #626 **海报墙（`wall`）自己的间距**（px），必须与 MediaList `.rl-wall` 的 gap 一致。
 *
 * 背景：#624 给海报墙单独写了 `.rl-wall { gap: 10px }`（墙上刻意更紧一档），而本模块的列数反算
 * 一直用的是写死的 `POSTER_GRID_GAP`（12）—— 那条「间距必须与视图一致」的不变量当场失效
 * （注释还写着「必须一致」）。⇒ #626 把间距改成**入参**：两个视图各传各的，代码里不再有第二份真源。
 */
export const POSTER_WALL_GAP = 10;

/** 自定义列数：默认 / 上下界（设置页数字框同源） */
export const POSTER_COLUMNS_DEFAULT = 6;
export const POSTER_COLUMNS_MIN = 1;
export const POSTER_COLUMNS_MAX = 12;

const DEFAULT_DENSITY: PosterDensity = 'standard';

// 合法值集合以「标签表的自有键」为准（禁用 `in` —— 会沿原型链把 toString/__proto__ 判为合法，
// 同 pure/themeTokens.normalizeUiTheme 的教训，有回归测试守）。
const VALID_DENSITIES = Object.keys(POSTER_DENSITY_LABELS) as PosterDensity[];

/**
 * 归一海报密度：trim + 小写后精确匹配枚举值；其余（缺省 / 空值 / 脏数据 / 原型链键）一律回落「标准」。
 * 读取端（Settings 回显、MediaList 落样式）必须先过它，避免磁盘上的脏值直接拼进 CSS。
 */
export function normalizePosterDensity(raw: unknown): PosterDensity {
    if (typeof raw !== 'string') return DEFAULT_DENSITY;
    const v = raw.trim().toLowerCase();
    return VALID_DENSITIES.includes(v as PosterDensity) ? (v as PosterDensity) : DEFAULT_DENSITY;
}

/**
 * 归一自定义列数：数值 → 四舍五入后钳制到 `[1, max]`（`max` 缺省 `POSTER_COLUMNS_MAX` = 12）。
 * **空值 / 非数字 → 缺省 6**（输入框被清空或用户乱打时，不该掉到「1 列」这种极端值）。
 * ⚠️ 只认 number 与「非空数字串」两种形态：`true` / `[]` 这类会被 `Number()` 悄悄转成 0 或 1 的值
 * 一律走缺省 —— 否则脏数据会被当成合法的「1 列」显示。
 * 🔴 用户 2026-10-20：「设置页里的海报墙列数项删除掉」 ⇒ 海报墙不再有自己的一档列数，
 *    跟随共享的「海报密度」；`max` 参数保留只为「墙 = 纯封面，可以更密」这条历史口径在
 *    缩放路径（`posterZoomColumns` 的 `max`）上复用，⛔ 不再是设置项的入口。
 */
export function normalizePosterColumns(raw: unknown, max: number = POSTER_COLUMNS_MAX): number {
    let n: number;
    if (typeof raw === 'number') {
        n = raw;
    } else if (typeof raw === 'string' && raw.trim() !== '') {
        n = Number(raw.trim());
    } else {
        return POSTER_COLUMNS_DEFAULT;
    }
    if (!Number.isFinite(n)) return POSTER_COLUMNS_DEFAULT;
    const i = Math.round(n);
    return Math.min(max, Math.max(POSTER_COLUMNS_MIN, i));
}

/**
 * 档位 → `grid-template-columns` 值（视图层直接内联到 `.rl-grid` 的 style）。
 * ⚠️ 返回值是**对外契约**：单测与产物断言按字面比对，改形态必须同步两处。
 *
 * 🔴 #626 `gap` 改成**第 3 个入参**（缺省 `POSTER_GRID_GAP`）：海报墙的间距比卡片网格紧一档
 * （`.rl-wall { gap: 10px }` ⇒ 传 `POSTER_WALL_GAP`）。在此之前这里是写死的 12，
 * 而墙上实际是 10 ⇒ 「间距总量」按错的数扣，列宽与真实排布对不上（源码注释却写着「必须一致」）。
 * ⚠️ 缺省值保住**既有调用点的字面输出**（卡片网格与产物断言一字不变）。
 */
export function posterGridTemplate(density: PosterDensity, columns: number, gap: number = POSTER_GRID_GAP): string {
    const d = normalizePosterDensity(density);
    if (d === 'custom') {
        const n = normalizePosterColumns(columns);
        // 间距总量：(N-1) × gap —— 必须真的按 gap 扣掉，否则 N 列时会因间距挤成 N-1 列
        const gapTotal = (n - 1) * gap;
        // 🔴🔴 #597 **翻面**：轨道只取**目标宽**，⛔ 不再给它套「卡宽下限 px 地板」（见下两行）。
        //    旧写法（#591）给轨道套了一层「卡宽下限 px 地板」的 max()，**宽容器**下会「n 变了、渲染列数没变」：
        //    1080px 下 n=12…5 **全都渲染成 5 列**
        //    ⇒ Ctrl + 滚轮放大**好几格都是零反应**（用户报障：「怎么不能放大海报墙视图的卡片」）。
        //    现在 track = (100% - gapTotal)/n ⇒ 按构造**恰好渲染 n 列**（`auto-fill` 的取整是恒等式），
        //    每一步滚轮都看得见变化：**放大**一路到 `POSTER_COLUMNS_MIN`（1 列 = 满宽那张）、
        //    **缩小**一路到 `POSTER_COLUMNS_MAX`（12 列最密）。
        //    ⚠️ 这里**没有任何 px 地板** —— 上下界全由列数常量（1 / 12）表达，⛔ 别再往轨道里塞 px。
        const track = `min(calc((100% - ${gapTotal}px) / ${n}), 100%)`;
        return `repeat(auto-fill, minmax(${track}, 1fr))`;
    }
    const minW = POSTER_CARD_MIN_WIDTHS[d];
    return `repeat(auto-fill, minmax(min(${minW}px, 100%), 1fr))`;
}

/**
 * 海报墙（`wall`）的列模板 —— 只是「换成墙的间距」的那一层。
 *
 * 🔴 用户 2026-10-20：「设置页里的海报墙列数项删除掉」——`wallColumns` 设置键**整条下线**
 *    （设置页没有入口了，再留一个「脚本还记得、界面看不见」的键就是鬼开关）。
 *    现在墙与卡片网格**共用**「海报密度」这一档，唯一差别是间距（墙的 gap 更紧一档）。
 * ⚠️ 这里**不再收 `wallColumns` 形参**：老 data.json 里可能还躺着这个键，但它已经没有任何读取方
 *    （Settings 也不再把字段传给视图），留着形参反而像个「传了就有效」的开关。
 * ⚠️ 间距照旧传 `POSTER_WALL_GAP`（墙的间距与卡片网格不同）。
 */
export function posterGridTemplateForWall(
    density: PosterDensity,
    columns: number,
): string {
    return posterGridTemplate(density, columns, POSTER_WALL_GAP);
}

/**
 * CSS 兜底值（写死在 MediaList 的 `.rl-grid` 规则里）：与「标准」档产物完全一致 ——
 * 内联 style 因任何原因缺席时，海报墙退回历史观感，而不是塌成单列。
 */
export const FALLBACK_POSTER_GRID_TEMPLATE: string = posterGridTemplate(DEFAULT_DENSITY, POSTER_COLUMNS_DEFAULT);

/** 🔴 #591 Ctrl+滚轮缩放：一次步进的列数增量（列数越少 = 卡片越大）。 */
export const POSTER_ZOOM_STEP = 1;

/**
 * 🔴 #591 Ctrl+滚轮缩放：把当前列数按方向步进一档，并钳制在 `[POSTER_COLUMNS_MIN, POSTER_COLUMNS_MAX]`。
 *
 * 方向语义 = **跟浏览器一致**：向上滚（`in`）= 放大 = 卡片变大 = **列数减少**；向下滚（`out`）= 列数增加。
 * ⚠️ `current` 允许传「从 DOM 量来的实际列数」（`grid-template-columns` 的轨道数）⇒ 先过
 *    `normalizePosterColumns` 兜住脏值 / 空值；返回值恒为合法列数（⛔ 别在这里判「变没变」，
 *    调用方拿返回值与原值比 —— 已在边界上时两者相等，等于天然的 no-op）。
 */
export function posterZoomColumns(current: unknown, dir: 'in' | 'out', max: number = POSTER_COLUMNS_MAX): number {
    const n = normalizePosterColumns(current, max);
    const next = dir === 'in' ? n - POSTER_ZOOM_STEP : n + POSTER_ZOOM_STEP;
    // 🔴🔴 #598 **翻面**：上下界回到**列数常量**（1 / 12），⛔ 不再按容器宽度夹一个「卡片不小于 180px」的上限。
    //    用户 2026-10-10：「是 ctrl+滚轮**缩小**失灵，怎么不能缩小到展示更多卡片」——
    //    #597 那套「按宽度算列数上限」实测把缩小的路堵死了：1080px 宽时上限只有 **5 列**，
    //    从 5 列再往下滚**恒 no-op**（用户眼前完全没反应，正是他报的那条）。
    //    ⇒ 现在缩小一路到 `POSTER_COLUMNS_MAX`（12 列，卡片约 80px）。
    // 🔴 #626：上界改走 `max` 入参（海报墙曾经传更宽的一档）。
    //    用户 2026-10-20 删除「海报墙列数」设置项后，墙与卡片网格共用 12 列上限 ——
    //    参数保留，因为「缩到几列」的上界是**调用方**的事，本函数不替它做主。
    //    ⚠️ 下界两个视图共用 `POSTER_COLUMNS_MIN`（1 列 = 满宽那张），不参数化。
    return Math.min(max, Math.max(POSTER_COLUMNS_MIN, next));
}
