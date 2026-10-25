// Bases 配套 CSS 片段（虚拟模块）：由 `esbuild.config.mjs` 的 `bases-snippet-inline` 插件
// 把 `docs/ReelLudic Bases 样式.css` 以字符串注入。生成模板时写进 `.obsidian/snippets/`。
// ⚠️ 改模块名要同步改 esbuild.config.mjs 里的 onResolve 过滤器。
declare module 'reelludic:bases-css' {
    const css: string;
    export default css;
}
