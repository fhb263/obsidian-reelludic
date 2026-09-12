// 评分校验（纯逻辑，无 obsidian 依赖）

export type Rating = 0 | 1 | 2 | 3 | 4 | 5;

/** 非法/越界值归 0，小数四舍五入，钳制到 0~5 */
export function normalizeRating(v: unknown): Rating {
    const n = typeof v === 'number' ? Math.round(v) : NaN;
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n)) as Rating;
}

/** 生成「★★★★☆」形式的星级字符串 */
export function starString(r: Rating): string {
    const filled = Math.max(0, Math.min(5, r));
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/** 星级热度分档：≥4 高（金色）、1~3 中（灰色）、0 未评分（淡灰），卡片着色用 */
export function starClass(r: Rating): 'rl-stars-hot' | 'rl-stars-mid' | 'rl-stars-none' {
    if (r >= 4) return 'rl-stars-hot';
    if (r >= 1) return 'rl-stars-mid';
    return 'rl-stars-none';
}
