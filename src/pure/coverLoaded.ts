/**
 * 已加载封面的**跨实例**缓存（m18442 ②）。
 *
 * 🔴 用户逐字：「优化加载缓存封面刷新，不想每次换页签然后就要重新刷新封面展示」。
 *
 * 真因（真机 CDP 实测，⛔ 别再按「网络重拉」去查）：
 *   · `MediaList` 的 `loadedCovers` 是**组件实例内**的 `Set`；
 *   · `HomeView.svelte` 的内容区是三档 `{#if}`（`tracking` / `stats` / 库列表），
 *     进出统计页时 `<MediaList>` 被**整体卸载再挂载** ⇒ 那个 `Set` 随之清空；
 *   · 于是每张封面又回到「2:3 占位 → 解码 → 交回固有比例」的过程，系列卡入场动画
 *     （`.rl-stk-in`）也每轮重播 —— 这就是用户看到的「重新刷新」。
 *   · 实测请求本身只花 1~4ms（进程内位图缓存命中），**不是网络问题**，
 *     所以在网络层加缓存治不了这个症状。
 *
 * ⇒ 修法：把「哪些封面已经显示过」这件事提到**模块级**，与组件生命周期解绑。
 *   组件挂载时用它做初始快照，于是已加载过的封面**第一帧就是 `is-loaded`**，
 *   既没有占位闪烁，也不会因为 `load` 再次触发而重排。
 *
 * ⚠️ 只增不减：条目被删/改名后残留几个死 id，代价是一次 `has()` 查表，
 *   不值得为它写清理（与组件内原注释同一条取舍）。
 * ⚠️ 这个缓存只影响「排版是否已经按固有比例排」这一件事，**不参与任何图片 URL 解析** ——
 *   封面地址仍由宿主 `posterUrl(e)` 决定，缓存失效时最坏表现是「少一次过渡」，不会显示旧图。
 */

/** 已经加载过（或已经决定按固有比例排）的封面 id 集合（模块级单例） */
const loaded = new Set<string>();

/** 这个封面是否已经显示过（组件挂载时用来初始化实例快照） */
export function coverAlreadyLoaded(id: string): boolean {
    return loaded.has(String(id ?? ''));
}

/** 记一笔（`on:load` 时调用；同一 id 重复调用是幂等的） */
export function rememberCoverLoaded(id: string): void {
    const key = String(id ?? '');
    if (key) loaded.add(key);
}

/** 实例挂载时的初始快照（新 `Set`，⛔ 不要把模块级那个直接交给组件改） */
export function coverLoadedSnapshot(): Set<string> {
    return new Set(loaded);
}

/** 清空（只给测试用；⛔ 产品代码别调，否则等于把缓存关掉） */
export function resetCoverLoadedForTest(): void {
    loaded.clear();
}
