// 评分校验（纯逻辑，无 obsidian 依赖）
//
// 🔴 #619 半星（用户 2026-10-13 裁定）：由「0~5 整数」拓宽为「**0~5、步长 0.5**」（11 档）。
//    为什么取 0.5 步长而不是「0~10 整数」：写进 frontmatter 的就是 `4.5`，
//    用户既有的 `rating >= 4` 这类 Dataview 查询、筛选、排序**口径一字不变**（仍是数值比较）；
//    换成 0~10 整数则旧笔记里的 `4` 会突然变成「4 分（满分 10）」= 语义静默漂移。
//    界面上仍按 10 分制呈现（`9/10` ⟷ `4.5 星`）—— 那只是**显示层**的换算，见 `ratingToTenths`。

/** 个人评分：0 ~ 5，**步长 0.5**（含 0 与 5 共 11 档） */
export type Rating = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;

/** 全部合法档位（从低到高；表单滚轮与设置页的档位表与它同源，⛔ 别另写一份） */
export const RATING_STEPS: readonly Rating[] = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** 非法/越界值归 0，**小数四舍五入到最近的 0.5 档**，钳制到 0~5 */
export function normalizeRating(v: unknown): Rating {
    // ⚠️ 只认 `typeof v === 'number'`：字符串数字（老笔记 / 手改 YAML）不算数 —— 与 #612 之前的
    //    口径一致（那时也是只认 number），⛔ 别放宽成 `Number(v)`（`''` 会变成 0 而"看起来像合法"）
    const n = typeof v === 'number' ? Math.round(v * 2) / 2 : NaN;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n)) as Rating;
}

/**
 * 星级文本：满星 `★` / 半星 `½` / 空星 `☆`（4.5 → `★★★★½`）。
 *
 * 🔴 半星用 **`½`（U+00BD）而不是 U+2BE8** —— 后者字体覆盖极差：实测在 Obsidian 里
 *    渲染成一个**残缺的星形碎块**（用户 2026-10-13 截图报障）。`½` 是拉丁补充区的常用字符，
 *    任何字体都有，且「四星半」这个读法本来就通顺。
 * ⚠️ 这仍**只给纯文本场景用**（笔记 frontmatter / 周报 markdown）；**卡片与列表里的星走 CSS 按比例裁切**
 *    （`background-clip: text`，见 `MediaList` 的 `.rl-my-inline` / `.rl-stars`），那里没有字符宽度问题。
 */
export function starString(r: Rating): string {
    const filled = Math.floor(r);
    const half = r - filled >= 0.5 ? 1 : 0;
    return '★'.repeat(filled) + (half ? '½' : '') + '☆'.repeat(5 - filled - half);
}

/** 星级热度分档：≥4 高（金色）、>0 中（灰色）、=0 未评分（淡灰），卡片着色用 */
export function starClass(r: Rating): 'rl-stars-hot' | 'rl-stars-mid' | 'rl-stars-none' {
    if (r >= 4) return 'rl-stars-hot';
    // 🔴 #619：0.5 星也是「已评分」⇒ 判据由 `>= 1` 放宽成 `> 0`
    //    （否则半星的卡片会掉进「未评分」的淡灰档）
    if (r > 0) return 'rl-stars-mid';
    return 'rl-stars-none';
}

// ══════════════════════════════════════════════════════════════════════════════
// #619 半星 ⇄ 10 分制的**显示层**换算
//
// 用户口径：「支持半星映射，如 0.5 星代表 1 分，4.5 星代表 9 分」「点击数值可切换为输入框如 9/10」。
// 🔴 换算只发生在**显示与输入**两端；**存储恒为 0~5 步长 0.5**（见文件头）：
//    半星 ⟷ 10 分制是 **×2 / ÷2**，⛔ 别在这里引入第三套刻度。
// ══════════════════════════════════════════════════════════════════════════════

/** 半星 → 10 分制整数（4.5 → 9）；「9/10」这类显示与输入框用 */
export function ratingToTenths(r: Rating): number {
    return Math.round(r * 2);
}

/** 10 分制整数 → 半星（9 → 4.5）；输入框落回存储时用 */
export function tenthsToRating(v: unknown): Rating {
    return normalizeRating(typeof v === 'number' ? v / 2 : NaN);
}

/** 档位步进（滚轮数值器用）：`dir` > 0 进一档、否则退一档，返回**钳制后**的相邻档 */
export function stepRating(r: Rating, dir: number): Rating {
    const i = RATING_STEPS.indexOf(r);
    const next = (i < 0 ? 0 : i) + (dir > 0 ? 1 : -1);
    return RATING_STEPS[Math.max(0, Math.min(RATING_STEPS.length - 1, next))];
}

/**
 * 星控件：这一下点的是**左半边**（⇒ 半星）还是右半边（⇒ 整星）。
 *
 * 🔴 判据抽成纯函数是为了**能单测** —— 它原来是写在 `EntryForm` 的 `onStarClick` 里的一句
 *    `ev.offsetX * 2 < el.offsetWidth`，躲在 Svelte 组件内部 ⇒ 突变改成「恒整星」也**测不出来**
 *    （断言只能锚「函数在不在」，锚不住行为）。半星是这个功能的**全部价值**，必须钉得住。
 * ⚠️ `width <= 0`（元素还没布局，如离屏渲染 / `display:none` 刚恢复）按**整星**处理：
 *    此时 `offsetX` 不可信，猜半星会写出用户没想要的 0.5。
 */
export function isHalfStarClick(offsetX: number, width: number): boolean {
    if (!(width > 0)) return false;
    return offsetX * 2 < width;
}
