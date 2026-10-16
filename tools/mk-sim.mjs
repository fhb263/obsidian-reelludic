/**
 * 仿真页构建：把 `_shot/src/*.html` 里的 `<!--@@INCLUDE 路径@@-->` 占位替换成**内联 <style>**，
 * 输出到 `_shot/*.html`。
 *
 * 🔴 为什么必须内联（而不是 `<link href="../styles.css">`）：
 *    仿真页会被丢进 IDE 内置预览面板（走 http 静态路由），兄弟文件不在那条路由里 ⇒
 *    页面变成一张**没有样式的裸 HTML**；而 `file://` 打开时相对路径是通的，**本地截图完全看不出来**。
 *    ⇒ 自检：产物里 `<link` 出现次数必须为 0。
 *
 * 用法：`node tools/mk-sim.mjs`（在仓库根目录跑）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join("_shot", "src");
const OUT = join("_shot");
const MARK = /<!--@@INCLUDE (.+?)@@-->/g;

if (!existsSync(SRC)) {
    mkdirSync(SRC, { recursive: true });
    console.log("已创建 " + SRC + "（放源文件后重跑）");
    process.exit(0);
}

let n = 0;
for (const name of readdirSync(SRC)) {
    if (!name.endsWith(".html")) continue;
    const out = readFileSync(join(SRC, name), "utf8").replace(MARK, (_m, p) => {
        const f = String(p).trim();
        if (!existsSync(f)) return `<!-- 缺失：${f} -->`;
        // 函数式替换，免 $& / $1 转义坑。.js 包 <script>，其余包 <style>（共享 partial 两种都要）。
        const body = readFileSync(f, "utf8");
        return f.endsWith(".js") ? `<script>\n${body}\n</script>` : `<style>\n${body}\n</style>`;
    });
    const dest = join(OUT, name);
    writeFileSync(dest, out, "utf8");
    const links = (out.match(/<link\b/g) || []).length;
    const miss = (out.match(/<!-- 缺失：/g) || []).length;
    const leftover = (out.match(/<!--@@INCLUDE /g) || []).length;
    console.log(
        `${dest}  ${Buffer.byteLength(out, "utf8")}B  link标签=${links}  缺失=${miss}  残留占位=${leftover}`,
    );
    n++;
}
console.log(`完成 ${n} 个文件`);
