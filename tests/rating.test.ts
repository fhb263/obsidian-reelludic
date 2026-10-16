import { describe, it, expect } from 'vitest';
import { normalizeRating, starString, starClass, RATING_STEPS, ratingToTenths, tenthsToRating, stepRating, isHalfStarClick } from 'pure/rating';

describe('pure/rating 评分', () => {
    it('normalizeRating 钳制到 0~5，非法归 0', () => {
        expect(normalizeRating(4)).toBe(4);
        expect(normalizeRating(0)).toBe(0);
        expect(normalizeRating(5)).toBe(5);
        expect(normalizeRating(-3)).toBe(0);
        expect(normalizeRating(9)).toBe(5);
        expect(normalizeRating('x' as unknown)).toBe(0);
        expect(normalizeRating(undefined)).toBe(0);
    });

    // ══════════════════════════════════════════════════════════════════════════
    // 🔴 #619 半星：由「0~5 整数」拓宽为「0~5 步长 0.5」
    // ══════════════════════════════════════════════════════════════════════════
    it('🔴 #619 小数**四舍五入到最近的 0.5 档**（⛔ 不再是四舍五入到整数）', () => {
        expect(normalizeRating(3.6)).toBe(3.5);
        expect(normalizeRating(3.4)).toBe(3.5);
        expect(normalizeRating(3.2)).toBe(3);
        expect(normalizeRating(3.3)).toBe(3.5);
        expect(normalizeRating(4.25)).toBe(4.5);
        expect(normalizeRating(4.2)).toBe(4);
    });

    it('🔴 #619 半星本身与边界原样保留', () => {
        for (const r of RATING_STEPS) expect(normalizeRating(r), String(r)).toBe(r);
        expect(normalizeRating(5.4)).toBe(5); // 越界仍钳到 5
        expect(normalizeRating(-0.5)).toBe(0);
    });

    it('🔴 #619 字符串数字仍归 0（口径与 #612 之前一致，⛔ 别放宽）', () => {
        // `''` 若走 `Number('')` 会变成 0 而"看起来合法" —— 那会让手改坏的 YAML 静默通过
        expect(normalizeRating('' as unknown)).toBe(0);
        expect(normalizeRating('4.5' as unknown)).toBe(0);
    });

    it('starString 生成星级字符串（满星 / 空星）', () => {
        expect(starString(0)).toBe('☆☆☆☆☆');
        expect(starString(3)).toBe('★★★☆☆');
        expect(starString(5)).toBe('★★★★★');
    });

    it('🔴 #619 starString 半星用 `½`（⛔ 不是 `⯨` —— 实测在海报墙上渲染成残缺星形，用户截图报障）', () => {
        expect(starString(0.5)).toBe('½☆☆☆☆');
        expect(starString(3.5)).toBe('★★★½☆');
        expect(starString(4.5)).toBe('★★★★½');
        // 总宽度恒为 5 个字符位
        for (const r of RATING_STEPS) expect([...starString(r)].length, String(r)).toBe(5);
        // 🔴 反向守卫：整个模块里⛔ 不许再出现 U+2BEA（字体覆盖不稳的那个半星字符）
        for (const r of RATING_STEPS) expect(starString(r).includes('\u2BEA'), String(r)).toBe(false);
    });

    it('starClass 评分热度分档：≥4 金 / >0 灰 / =0 未评分淡灰', () => {
        expect(starClass(5)).toBe('rl-stars-hot');
        expect(starClass(4)).toBe('rl-stars-hot');
        expect(starClass(3.5)).toBe('rl-stars-mid');
        expect(starClass(3)).toBe('rl-stars-mid');
        expect(starClass(1)).toBe('rl-stars-mid');
        expect(starClass(0)).toBe('rl-stars-none');
    });

    it('🔴 #619 0.5 星也是「已评分」⇒ 不许掉进未评分档（判据由 `>=1` 放宽成 `>0`）', () => {
        expect(starClass(0.5)).toBe('rl-stars-mid');
        expect(starClass(0.5)).not.toBe('rl-stars-none');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #619 半星 ⇄ 10 分制的显示层换算（用户：「0.5 星代表 1 分，4.5 星代表 9 分」）
// 这些只在**显示与输入**两端用，存储恒为 0~5 步长 0.5
// ══════════════════════════════════════════════════════════════════════════════
describe('#619 半星 ⇄ 10 分制换算', () => {
    it('ratingToTenths / tenthsToRating 是 ×2 / ÷2 的一对', () => {
        expect(ratingToTenths(0.5)).toBe(1);
        expect(ratingToTenths(4.5)).toBe(9);
        expect(ratingToTenths(5)).toBe(10);
        expect(ratingToTenths(0)).toBe(0);
        expect(tenthsToRating(9)).toBe(4.5);
        expect(tenthsToRating(10)).toBe(5);
        expect(tenthsToRating(1)).toBe(0.5);
    });

    it('🔴 往返恒等：11 档逐个跑一遍（⛔ 别只在个别值上验）', () => {
        for (const r of RATING_STEPS) expect(tenthsToRating(ratingToTenths(r)), String(r)).toBe(r);
    });

    it('🔴 stepRating：档位步进并钳制两端（滚轮数值器用）', () => {
        expect(stepRating(0, -1)).toBe(0); // 已在下界
        expect(stepRating(0, 1)).toBe(0.5);
        expect(stepRating(4.5, 1)).toBe(5);
        expect(stepRating(5, 1)).toBe(5); // 已在上界
        expect(stepRating(3, -1)).toBe(2.5);
        expect(stepRating(0.5, -1)).toBe(0);
    });

    it('RATING_STEPS 是 11 档、升序、且每档都过归一（真源自洽）', () => {
        expect(RATING_STEPS).toHaveLength(11);
        expect([...RATING_STEPS]).toEqual([...RATING_STEPS].sort((a, b) => a - b));
        for (const r of RATING_STEPS) expect(normalizeRating(r)).toBe(r);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #619 星控件「点半边」判定
// 🔴 抽成纯函数就是为了这段能存在 —— 它原本是组件里的一句 `ev.offsetX * 2 < el.offsetWidth`，
//    躲在 Svelte 内部 ⇒ 突变改成「恒整星」也测不出来。半星是这个功能的全部价值，必须钉得住。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #619 isHalfStarClick（点的是左半边还是右半边）', () => {
    it('左半边 ⇒ 半星；右半边 ⇒ 整星（含中线归属：正中间算整星）', () => {
        expect(isHalfStarClick(0, 20)).toBe(true);
        expect(isHalfStarClick(9, 20)).toBe(true);
        expect(isHalfStarClick(10, 20)).toBe(false); // 正中间 ⇒ 整星
        expect(isHalfStarClick(11, 20)).toBe(false);
        expect(isHalfStarClick(20, 20)).toBe(false);
    });

    it('🔴 宽度不可信（0 / 负数 / NaN）一律按**整星** ⇒ ⛔ 不猜半星（离屏或未布局时会写出用户没要的 0.5）', () => {
        expect(isHalfStarClick(0, 0)).toBe(false);
        expect(isHalfStarClick(5, 0)).toBe(false);
        expect(isHalfStarClick(5, -3)).toBe(false);
        expect(isHalfStarClick(5, NaN)).toBe(false);
    });
});
