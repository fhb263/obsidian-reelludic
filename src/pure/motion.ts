/**
 * 动效偏好（系统级「减少动态效果」）。
 *
 * 🔴 用户 2026-11-08：「音乐播放器和字幕面板的滚动改要有动效而不是瞬间切换」
 *    ⇒ 这两处滚动从「瞬时赋值」改成平滑滚动。但平滑滚动对**开了 reduced-motion**
 *      的用户是折磨（前庭功能障碍者会眩晕），所以必须能被系统设置关掉。
 *
 * ⚠️ 全仓此前**没有任何** JS 侧 `matchMedia` 调用：动效偏好一律靠 CSS
 *    `@media (prefers-reduced-motion: reduce)`（styles.css 里已有 8 处）。
 *    那条路对「CSS 动画」够用，但**对 JS 的 `scrollTo({ behavior })` 无效** ——
 *    浏览器不会替你降级，所以这里必须读一次媒体查询。
 *
 * ⚠️ 不缓存结果：用户可能在设置里中途改，缓存会让它「改了没反应」。
 *    调用点都在滚动高频路径上吗？本函数只做一次 `matchMedia().matches`，
 *    没有 DOM 树插入、没有布局读取，实测成本可忽略（对比它旁边那堆
 *    `getBoundingClientRect` 完全不值一提）。
 */
export function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        // 非浏览器环境 / 老宿主没有 matchMedia ⇒ 当作「不减少动效」（保持原行为）
        return false;
    }
}

/**
 * 给 `scrollTo` 用的行为值：开了 reduced-motion 就瞬时跳，否则平滑滑。
 * 抽出来是为了两处（字幕列表 / 歌词列表）口径一致 —— ⛔ 别在一处写 `'smooth'`、
 * 另一处靠 CSS `scroll-behavior` 兜，两种降级路径会给出不一样的观感。
 */
export function scrollBehavior(): ScrollBehavior {
    return prefersReducedMotion() ? 'auto' : 'smooth';
}
