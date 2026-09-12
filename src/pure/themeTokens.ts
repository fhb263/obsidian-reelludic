// 界面主题（原生 / 现代）纯逻辑：合法性归一 + 页签指示器定位。
// 主题效果本身靠 CSS 变量层（--rl-t-*），本模块只管可测的算术与兜底。
import type { UiTheme } from 'data/types';

/** 主题 → body 类名。native 不挂类（默认观感与 1.0.2 一致） */
export const THEME_CLASS: Record<UiTheme, string> = {
    native: '',
    modern: 'rl-theme-modern',
};

/**
 * 合法主题集合（以 THEME_CLASS 的**自有键**为准，避免两处定义漂移）。
 *
 * ⚠️ 为什么用 `Object.keys` + `includes` 而不是 `raw in THEME_CLASS`：
 * `in` 会**沿原型链查找**，故 `'toString' in THEME_CLASS` 为 `true`（继承自 Object.prototype），
 * 于是 `normalizeUiTheme('toString')` 会返回 `'toString'` 这个非法主题值 —— 损坏数据不仅没被
 * 兜底，反而穿透下去。`Object.keys` 只取自有键，从根上排除该类污染。
 */
const VALID_THEMES = Object.keys(THEME_CLASS) as UiTheme[];

/** 主题字段归一：旧数据/损坏数据一律回退 native（保证升级不炸） */
export function normalizeUiTheme(raw: unknown): UiTheme {
    return typeof raw === 'string' && (VALID_THEMES as string[]).includes(raw) ? (raw as UiTheme) : 'native';
}

/**
 * 页签滑动指示器的 transform/width 串。
 * @param offsetLeft 选中按钮相对容器的 offsetLeft
 * @param width      选中按钮宽度
 * @param pad        容器内边距（指示器 inset 与之一致）
 * @param scrollLeft 容器横向滚动量（窄栏溢出时非 0）
 *
 * 注意：`offsetLeft` 已含 padding 起点，故要减去 pad 才与 `inset: pad` 的指示器对齐；
 * 钳到 0 是为了 padding 大于 offset 的极端缩放下不产生负位移。滚动量同理要减（指示器在滚动容器内）。
 * 非有限输入（NaN/Infinity，DOM 布局未完成时 offsetLeft / scrollLeft 可能异常）退化为 0，
 * 宽度同样钳到 0 —— 否则会产出 `translateX(NaNpx)` / `width:-5px` 这类非法 CSS，
 * 浏览器会静默丢弃整条 transform 声明，表现为「指示器偶尔不滑动」且不报错。
 */
export function indicatorTransform(offsetLeft: number, width: number, pad: number, scrollLeft = 0): string {
    const num = (v: number): number => (Number.isFinite(v) ? v : 0);
    const x = Math.max(0, Math.round(num(offsetLeft) - num(pad) - num(scrollLeft)));
    return `translateX(${x}px);width:${Math.max(0, Math.round(num(width)))}px`;
}
