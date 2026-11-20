/**
 * 系列折叠卡**入场动画只播一次**的跨实例缓存（m18442 ② 第二层）。
 *
 * 🔴 用户逐字：「优化加载缓存封面刷新，不想每次换页签然后就要重新刷新封面展示」。
 *
 * 真机实测（`probe-anim2.cjs`，CDP 打标记 + 切页签后 60ms 采样）：
 *   · 给 12 张 `.rl-cov-stack-extra` 打 `data-probe` → 切到「统计」再切回「影视」⇒ `probeKept = 0`
 *     （标记全丢 = 节点全新创建，DOM 被整体重建，不是同一批节点重绘）；
 *   · 同一帧 `animRunning = 12`、动画名全是 `svelte-co2s25-rl-stk-in`
 *     ⇒ 12 张折叠卡的**入场动画全部重放**。
 *   · ⚠️ 采样必须落在切回后 ~60ms 内：动画只有 0.34s，且每层再错开 45ms，
 *     晚一点采样会看到 `animRunning = 0` 而误判「没重放」。
 *
 * ⇒ 封面本身的字节早已在进程内位图缓存里（实测请求 1~4ms，不是网络问题），
 *   而「重新刷新」的**视觉来源就是这条入场动画每轮重播**（封面像一张张重新抽出来）。
 *
 * ⇒ 修法：把「这个系列卡已经播过入场动画」提到**模块级**，与组件生命周期解绑。
 *   组件实例挂载时做一次快照，命中就给卡片根节点加 `.is-animated`
 *   ⇒ CSS 里 `animation: none` ⇒ 第一帧就是终态，不再补播。
 *
 * ⚠️ 为什么在 `animationend` 时才记、而不是渲染时就记：
 *   渲染时就记会让 `.is-animated` 在**同一帧**就生效 ⇒ 第一次的入场动画被当场掐掉（动画等于没有）。
 * ⚠️ 只增不减：删掉的系列残留几个死 key，代价是一次 `has()` 查表（与 `pure/coverLoaded` 同一取舍）。
 */

/** 已经播过入场动画的系列 key（模块级单例） */
const animated = new Set<string>();

/** 实例挂载时的初始快照（新 `Set`，⛔ 不要把模块级那个直接交给组件改） */
export function stackAnimatedSnapshot(): Set<string> {
    return new Set(animated);
}

/** 记一笔（`on:animationend` 时调用；同一 key 重复调用是幂等的） */
export function rememberStackAnimated(key: string): void {
    const k = String(key ?? '');
    if (k) animated.add(k);
}

/** 清空（只给测试用；⛔ 产品代码别调，否则等于把这条修剪关掉） */
export function resetStackAnimatedForTest(): void {
    animated.clear();
}
