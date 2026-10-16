// 构建标识（#334）：由 esbuild 的 `define` 在打包时注入（见 `esbuild.config.mjs`）——
// 值 = 打包时刻的 ISO 字符串。启动时打印，用来判断「Obsidian 里跑的到底是不是磁盘上这份构建」。
// 单元测试（vitest 走 esbuild 转换，不带本 define）一般不碰这个符号；若要断言，mock 掉即可。
declare const __REEL_BUILD__: string;
