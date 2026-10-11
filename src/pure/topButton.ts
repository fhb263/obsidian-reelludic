/**
 * 「回到顶部」按钮的**显隐与滚动源解析**（纯逻辑，无 obsidian 依赖，可单测）。
 *
 * 由来（#570，用户 2026-10-08：「回到顶部按钮**滑到底部不显示了**」）：
 *   旧实现只在 `onMount` 里**猜一次**滚动容器（从视图根往上找第一个
 *   `scrollHeight > clientHeight + 1` 的祖先），把 `scroll` 监听挂在它身上。
 *   ⇒ 猜错 / 那会儿内容还短（没得滚）/ 之后布局换了容器，**事件就永远收不到**，
 *     按钮的 `showTop` 卡在 false（表现为「怎么滑都不出现 / 到底部也没有」）。
 *
 * 新口径（本模块给判据，组件只负责挂监听）：
 *   ⑴ **不再猜**：`scroll` 事件（**不冒泡**，但会经过捕获阶段）挂在 `document` 上，
 *      事件的 `target` **就是**真正在滚的那个容器 —— 它是谁就用谁（`wrapsRoot` 兜住「只认本视图的容器」）；
 *   ⑵ 判据只有一条：`scrollTop > 阈值`（阈值 ≈ 页签 + 搜索行 + 筛选行三行的高度）。
 *
 * ⚠️ 本模块**不引用任何 DOM 全局**（`HTMLElement` / `document`）：单测在 node 环境下跑，
 *    引用它们会 ReferenceError。`wrapsRoot` 只用**鸭子类型**（`contains`）判断归属。
 */

/** 触发阈值：页签(≈34) + 搜索/概览行(≈38) + 筛选行(≈40) 的总高，越过即显示 */
export const TOP_SHOW_THRESHOLD = 110;

/** 该不该显示「回到顶部」：`scrollTop` 超过阈值（脏值 / NaN 一律不显示） */
export function shouldShowTop(scrollTop: number, threshold: number = TOP_SHOW_THRESHOLD): boolean {
    return Number.isFinite(scrollTop) && scrollTop > threshold;
}

/**
 * `target` 是不是「包着本视图根节点」的容器（含它自己）。
 * 🔴 为什么要判归属：`document` 上的捕获监听会收到**全页**任何容器的滚动 ——
 *    侧栏、别的面板、甚至同页另一个 scrollable 元素滚了都会触发回调。
 *    只认「本视图自己的容器」才不会把别处的滚动误当成自己的（那会让按钮乱闪）。
 * ⚠️ 认不出时返回 `false`（调用方保持上一次认准的那份，⛔ 不要清空）。
 */
export function wrapsRoot(target: unknown, root: unknown): boolean {
    if (!target || !root) return false;
    if (target === root) return true;
    const t = target as { contains?: (node: unknown) => boolean };
    return typeof t.contains === 'function' && t.contains(root);
}
