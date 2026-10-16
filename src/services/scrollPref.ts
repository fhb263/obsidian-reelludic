// 滚动条偏好（#630）—— **插件内所有非阅读器容器**隐藏滚动条的唯一入口。
//
// 🔴 用户口径（2026-10-14）：「只要设置页开启的隐藏滚动条效果，**除阅读器外**其他滚动条都要隐藏」。
//    ⇒ 两档：
//      · `applyScrollPref(el)`  **跟随设置开关**（`settings.hideScrollbars`）—— 绝大多数容器走它；
//      · `forceHideScroll(el)` **恒隐藏**（不看开关）—— 只给用户此前逐一点名的那三处
//        （选集 / 快捷关联 / 批量关联）：它们是「弹窗自己的滚动条」，与插件页面级设置无关。
//
// ⚠️ 为什么不直接在各处写 `addClass('rl-hide-scroll')`：那会让「哪一档、跟不跟开关」散落到 20 多个文件里，
//    改口径要全仓找一遍（本仓「同一概念只准一份真源」）。真正的 CSS 规则仍只有 styles.css 那一份。
// ⚠️ **阅读器**（TXT / EPUB / PDF / 漫画：正文 + 目录侧栏 + 书签 / 摘抄面板）**一律不调用本模块** ——
//    用户明确把它们排除在外；它们另有自己的一套（目录侧栏 `scrollbar-width: none`、正文 `thin`）。
// ⚠️ 开关值走**模块级状态**（由 main 在加载与每次保存设置后同步）：这样连「只收 app、拿不到 plugin 实例」的
//    弹窗也能一行接入，⛔ 不必为它改构造签名。

/** 全仓统一「隐藏滚动条」类（真源：styles.css 里 `.rl-hide-scroll` 那组规则） */
export const HIDE_SCROLL_CLASS = 'rl-hide-scroll';

/**
 * 🔴 #634：**「滚动只在内部」类** —— 给「自己带内层自滚列表」的弹窗加它，消灭**双滚动条嵌套**。
 *
 * 由来（用户报障）：「搜索窗口的最外层容器的原生滚动条需要做隐藏处理，同时保留内部内容的**自定义滚动**。
 *    同时相关有些窗口也出现了**双滚动条嵌套**的问题。」
 * 判据与实测见 `styles.css` 里 `.rl-scroll-inside` 那段注释（8 个场景实测 4 处命中）。
 *
 * ⚠️ **只加给「确有内层自滚列表」的弹窗**（判据 = `_probe_634_nestscroll.cjs` 那一跑）：
 *    本类会把外层 `.modal-content` 的滚动**彻底去掉**（`overflow: hidden`）——
 *    对**没有**内层滚动的弹窗加它，高内容会被直接裁掉（内容看不到，比两条滚动条严重得多）。
 * ⛔ 与 `applyScrollPref` 是**两个正交的维度**：那个管「滚动条画不画」（跟随用户开关），
 *    这个管「滚动发生在哪一层」（结构性，与开关无关）。两者可同时存在。
 */
export const SCROLL_INSIDE_CLASS = 'rl-scroll-inside';

/** 给「内层自滚」的弹窗标记结构（#634）—— 与用户开关无关，恒加 */
export function markScrollInside(el: HTMLElement | null | undefined): void {
    if (!el || typeof el.addClass !== 'function') return;
    el.addClass(SCROLL_INSIDE_CLASS);
}

/** 当前偏好（模块级；由 {@link syncScrollPref} 写入） */
let hideAll = false;

/** 从设置里同步偏好 —— main 在 `onload`（设置已读入之后）与每次保存设置后各调一次 */
export function syncScrollPref(settings: { hideScrollbars?: boolean } | undefined): void {
    hideAll = settings?.hideScrollbars === true;
}

/** 跟随设置开关给容器挂上（或摘掉）「隐藏滚动条」；`el` 缺失时安全跳过 */
export function applyScrollPref(el: HTMLElement | null | undefined): void {
    if (!el || typeof el.toggleClass !== 'function') return;
    el.toggleClass(HIDE_SCROLL_CLASS, hideAll);
}

/** 恒隐藏（用户点名的那三处） */
export function forceHideScroll(el: HTMLElement | null | undefined): void {
    if (!el || typeof el.addClass !== 'function') return;
    el.addClass(HIDE_SCROLL_CLASS);
}
