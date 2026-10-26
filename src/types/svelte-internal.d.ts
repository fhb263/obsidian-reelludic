// `svelte/internal` 的最小类型声明（#635 引入 —— 本仓只用它的 `bind()`）。
//
// 为什么要自己声明：svelte 4.2 的 `./internal` 子路径导出**没有配 types**（exports map 里只有 default），
// 而宿主 Obsidian 运行时提供的就是这个模块（esbuild external 名单里也有它，红线 5）。
// ⚠️ 只声明用到的那一个函数，⛔ 别把整个内部 API 抄一遍 —— 抄漏了以后写错名字反而查不出。
declare module 'svelte/internal' {
    /**
     * 等价于模板里的 `<Component bind:this={…} />`。
     * @param component 组件实例（`new X({ target, props })` 的返回值）
     * @param name 组件里 `export function` / `export let` 的名字
     * @param callback 会**立即**以当前值回调一次
     */
    export function bind(component: Record<string, unknown>, name: string, callback: (value: unknown) => void): void;
}
