// 外观偏好（pure/appearance）—— 界面动效 / 卡片风格。
// 🔴 本模块最重要的守卫是「**默认档位不挂任何 body 类**」：挂了就等于升级即换脸。
import { describe, expect, it } from 'vitest';
import {
    APPEARANCE_BODY_CLASSES,
    CARD_STYLE_CLASS,
    CARD_STYLE_LABELS,
    CARD_STYLES,
    MOTION_CLASS,
    MOTION_MODE_LABELS,
    MOTION_MODES,
    normalizeCardStyle,
    normalizeMotionMode,
} from 'pure/appearance';

describe('appearance（#541 界面动效 / 卡片风格）', () => {
    it('动效两档：完整（默认）在最前', () => {
        expect(MOTION_MODES).toEqual(['full', 'reduced']);
        expect(MOTION_MODE_LABELS.full).toBe('完整');
        expect(MOTION_MODE_LABELS.reduced).toBe('精简');
    });

    it('卡片三档：标准（默认）在最前', () => {
        expect(CARD_STYLES).toEqual(['standard', 'soft', 'flat']);
        expect(CARD_STYLE_LABELS.standard).toBe('标准');
    });

    it('🔴 默认档（full / standard）必须映射到空串 —— 升级后 body 上不得多出任何类', () => {
        expect(MOTION_CLASS.full).toBe('');
        expect(CARD_STYLE_CLASS.standard).toBe('');
    });

    it('非默认档各有唯一的 body 类名（且互不重名）', () => {
        const classes = APPEARANCE_BODY_CLASSES;
        expect(classes).toContain('rl-motion-static');
        expect(classes).toContain('rl-card-soft');
        expect(classes).toContain('rl-card-flat');
        expect(new Set(classes).size).toBe(classes.length);
        // 空串是「不挂类」的语义标记，⛔ 不许混进清理名单（removeClass('') 是无意义调用）
        expect(classes).not.toContain('');
    });

    it('归一：只认登记过的档位，其余回默认', () => {
        expect(normalizeMotionMode('reduced')).toBe('reduced');
        expect(normalizeMotionMode(undefined)).toBe('full');
        expect(normalizeMotionMode('none')).toBe('full');
        expect(normalizeMotionMode(1)).toBe('full');

        expect(normalizeCardStyle('soft')).toBe('soft');
        expect(normalizeCardStyle('flat')).toBe('flat');
        expect(normalizeCardStyle(undefined)).toBe('standard');
        expect(normalizeCardStyle('round')).toBe('standard');
        expect(normalizeCardStyle(null)).toBe('standard');
    });
});
