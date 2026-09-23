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

/**
 * 自定义列数的「最小卡片宽度保护」值。
 * 🔴 用户 2026-09-22 裁定（D-3）：**取当前密度档的值** —— 即复用上面档位表里的值，不另造数字；
 * 自定义档以「标准」档为基准（标准既是默认档、也是历史行为）。
 */
export const POSTER_CUSTOM_MIN_WIDTH: number = POSTER_CARD_MIN_WIDTHS.standard;

/** 卡片间距（px）：必须与 MediaList `.rl-grid` 的 gap 一致 —— 自定义列数按它反算列宽 */
export const POSTER_GRID_GAP = 12;

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
 * 归一自定义列数：数值 → 四舍五入后钳制到 [1, 12]；
 * **空值 / 非数字 → 缺省 6**（输入框被清空或用户乱打时，不该掉到「1 列」这种极端值）。
 * ⚠️ 只认 number 与「非空数字串」两种形态：`true` / `[]` 这类会被 `Number()` 悄悄转成 0 或 1 的值
 * 一律走缺省 —— 否则脏数据会被当成合法的「1 列」显示。
 */
export function normalizePosterColumns(raw: unknown): number {
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
    return Math.min(POSTER_COLUMNS_MAX, Math.max(POSTER_COLUMNS_MIN, i));
}

/**
 * 档位 → `grid-template-columns` 值（视图层直接内联到 `.rl-grid` 的 style）。
 * ⚠️ 返回值是**对外契约**：单测与产物断言按字面比对，改形态必须同步两处。
 */
export function posterGridTemplate(density: PosterDensity, columns: number): string {
    const d = normalizePosterDensity(density);
    if (d === 'custom') {
        const n = normalizePosterColumns(columns);
        // 间距总量：(N-1) × gap —— 必须真的按 gap 扣掉，否则 N 列时会因间距挤成 N-1 列
        const gapTotal = (n - 1) * POSTER_GRID_GAP;
        const track = `min(max(${POSTER_CUSTOM_MIN_WIDTH}px, calc((100% - ${gapTotal}px) / ${n})), 100%)`;
        return `repeat(auto-fill, minmax(${track}, 1fr))`;
    }
    const minW = POSTER_CARD_MIN_WIDTHS[d];
    return `repeat(auto-fill, minmax(min(${minW}px, 100%), 1fr))`;
}

/**
 * CSS 兜底值（写死在 MediaList 的 `.rl-grid` 规则里）：与「标准」档产物完全一致 ——
 * 内联 style 因任何原因缺席时，海报墙退回历史观感，而不是塌成单列。
 */
export const FALLBACK_POSTER_GRID_TEMPLATE: string = posterGridTemplate(DEFAULT_DENSITY, POSTER_COLUMNS_DEFAULT);
