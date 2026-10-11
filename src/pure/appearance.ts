// 「外观与体验」两项纯展示偏好（#541）：界面动效 / 卡片风格。
//
// 🔴 实现方式 = **挂 body 类 + 覆写 `--rl-t-*` 形态令牌**（与 `uiTheme` 的 `rl-theme-modern` 同一条路），
//    ⛔ 不在组件里散写分支 —— 令牌层是「形态」的唯一入口（UI-GUIDE §6.1）。
//    ⚠️ 覆写类必须写在 styles.css 里 `.rl-theme-modern` **之后**（同特异性靠书写顺序决胜）。

/** 界面动效档位：full 完整（默认，与旧版一致）/ reduced 精简（关掉过渡与悬停位移） */
export type MotionMode = 'full' | 'reduced';

export const MOTION_MODES: readonly MotionMode[] = ['full', 'reduced'];

export const MOTION_MODE_LABELS: Record<MotionMode, string> = {
    full: '完整',
    reduced: '精简',
};

/** 档位 → body 类名（`full` 不挂类：缺省观感即 1.2.0） */
export const MOTION_CLASS: Record<MotionMode, string> = {
    full: '',
    reduced: 'rl-motion-static',
};

export function normalizeMotionMode(raw: unknown): MotionMode {
    return raw === 'reduced' ? 'reduced' : 'full';
}

/** 卡片风格：standard 标准（默认）/ soft 圆润（大圆角 + 轻阴影）/ flat 扁平（小圆角 + 无阴影） */
export type CardStyle = 'standard' | 'soft' | 'flat';

export const CARD_STYLES: readonly CardStyle[] = ['standard', 'soft', 'flat'];

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
    standard: '标准',
    soft: '圆润',
    flat: '扁平',
};

export const CARD_STYLE_CLASS: Record<CardStyle, string> = {
    standard: '',
    soft: 'rl-card-soft',
    flat: 'rl-card-flat',
};

export function normalizeCardStyle(raw: unknown): CardStyle {
    return raw === 'soft' || raw === 'flat' ? raw : 'standard';
}

/**
 * 需挂在 `document.body` 上的全部外观类（**清理点的唯一真源**）。
 * 🔴 与 `themeTokens.THEME_CLASS` 同款用法：卸载 / 换档时按这张表逐个 `removeClass`，
 *    增删档位只改这里，⛔ 别在清理循环里手写类名字面量（漏一处就会残留上一次的形态）。
 */
export const APPEARANCE_BODY_CLASSES: readonly string[] = [
    ...Object.values(MOTION_CLASS),
    ...Object.values(CARD_STYLE_CLASS),
].filter((cls) => cls !== '');
