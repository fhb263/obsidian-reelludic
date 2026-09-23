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
 * 页签滑动指示器的内联样式串——完整的「属性名: 值」声明列表，直接喂给 style 属性。
 * @param offsetLeft 选中按钮相对容器的 offsetLeft
 * @param width      选中按钮宽度
 * @param pad        容器内边距（指示器 inset 与之一致）
 *
 * ⚠️ 必须带 `transform:` 属性名（1.0.3 回归教训）：曾返回 `translateX(Xpx);width:Wpx`
 * —— 内联样式按声明列表解析，首段无属性名被浏览器**静默丢弃**（不报错），只有 width 生效，
 * 指示器钉死原位、切换页签毫无动画。字符串级断言（含纯函数单测）测不出这类运行时行为。
 *
 * 坐标系：offsetLeft 相对 offsetParent（.rl-tabs，即滚动容器）的内容系；指示器 absolute
 * 定位的包含块同为该容器 → 随内容一起滚动，与按钮坐标系天然一致，**不减 scrollLeft**
 * （曾误减：窄栏横向滚动页签条后指示器向左漂移 scrollLeft 像素、脱离选中页签）。
 * 钳到 0：padding 大于 offset 的极端缩放下不产生负位移。
 * 非有限输入（NaN/Infinity，DOM 布局未完成时 offsetLeft 可能异常）退化为 0，
 * 宽度同样钳到 0 —— 否则会产出 `translateX(NaNpx)` / `width:-5px` 这类非法 CSS，
 * 浏览器会静默丢弃整条声明且不报错。
 */
export function indicatorTransform(offsetLeft: number, width: number, pad: number): string {
    const num = (v: number): number => (Number.isFinite(v) ? v : 0);
    const x = Math.max(0, Math.round(num(offsetLeft) - num(pad)));
    return `transform:translateX(${x}px);width:${Math.max(0, Math.round(num(width)))}px`;
}

/**
 * 指示器样式（视图层**唯一入口**）—— 在 indicatorTransform 之上加一道「测量就绪」门。
 *
 * 🔴 为什么必须有这道门（2026-09-23 用户报障，截图实证）：
 *   Obsidian 的后台 leaf / 首帧里，页签容器与按钮的 `offsetWidth` 会读到 **0**（视图不可见 ⇒ 无布局）。
 *   视图层若把这个 0 直接交给 indicatorTransform，得到 `width:0px` 的“药丸”——
 *   它仍画着左右两条 1.5px 描边 ⇒ 渲染成**一条竖线**（实测 x=29..32、高 30px），
 *   且 `translateX(0)` 把它钉在容器最左；同时选中项失去描边（描边本来就由指示器承担），
 *   用户看到的就是「只剩文字变蓝 + 一条竖线钉在最左」。
 *   ⚠️ 且它**不会自愈**：重算时机只有 window resize 与 activeTab 变化，
 *   而用户点「已经选中的那一项」时 `activeTab = t` 赋同值、Svelte 不标记脏 ⇒ 重算不触发。
 *   ⇒ 判定“未就绪”时返回空串，由视图层**跳过本次提交**并安排重测（可见性变化另有 ResizeObserver 兜住）。
 *
 * @returns 合法样式串；**测量未就绪（宽度非有限值或 ≤ 0）时返回 ''**。
 */
export function indicatorStyle(offsetLeft: number, width: number, pad: number): string {
    // ⚠️ 两个条件缺一不可：`NaN <= 0` 为 false，只判 `<= 0` 会让 NaN 溜过去产出 `width:0px`。
    if (!Number.isFinite(width) || width <= 0) return '';
    return indicatorTransform(offsetLeft, width, pad);
}
