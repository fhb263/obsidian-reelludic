// 抽 `MediaList.svelte` 的 **scoped 样式** → `_shot/src/_poster.css`（仿真页用）。
//
// 🔴 为什么必须抽：Svelte 组件的 `<style>` 是 **scoped** 的 —— 编译进 `main.js`、带 `.svelte-<hash>` 后缀，
//    **不在 `styles.css`**。仿真页若直接引 `styles.css`，量到的就不是实装样式（本仓在 #434 之前栽过）。
// 口径：找到 `// src/views/components/MediaList.svelte` 之后那段 `append_styles(target, "svelte-<hash>", '…')`，
//    取出字符串**原样**输出（**保留** `.svelte-<hash>` 后缀）。
// 🔴🔴 2026-09-30 #438 同日改版修正：**以前是「把后缀全删掉」—— 那是错的**。
//    后缀参与**特异性**计算：`.rl-watch-btn.svelte-x`（0,2,0）能压过 Obsidian 核心的
//    `button:not(.clickable-icon)`（0,1,1），而删掉后缀变成 `.rl-watch-btn`（0,1,0）就被核心压过。
//    后果：仿真页量出一条**假的实装真相**（曾据此记下「圆钮底色 = --interactive-normal，不是强调色」，
//    其实「不是」正是删后缀造出来的）。正确姿势 = **保留后缀** + 仿真页给带 `rl-` 类名的元素
//    **补上同一个 scope 类**（`addScopeClass()`，见 `_shot/src/sr438.html` 里那段自动探测）。
// ⚠️ 哈希只在 `<style>` 块被改时才变 ⇒ 「零新增 CSS」的批次可以直接沿用上批抽出的那份，不必重抽。
//
// 🔴 2026-09-30 #445 泛化：**第二个参数 = 组件名**（默认 MediaList，保持老调用不变）——
//    量 `EntryForm` 这类组件的仿真页时同样要它那份 scoped 样式（占位符颜色就卡在这上面）。
//    用法：`node tools/extract-poster-css.mjs [组件名]`
//    输出：MediaList → `_shot/src/_poster.css`（老页面在用，⛔ 别改名）；其余 → `_shot/src/_<组件名>.css`
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAIN = path.join(ROOT, 'main.js');
const COMPONENT = process.argv[2] || 'MediaList';
const OUT = path.join(ROOT, '_shot', 'src', COMPONENT === 'MediaList' ? '_poster.css' : `_${COMPONENT}.css`);
const MARKER = `// src/views/components/${COMPONENT}.svelte`;

const raw = fs.readFileSync(MAIN, 'utf8');
const at = raw.indexOf(MARKER);
if (at < 0) throw new Error(`main.js 里找不到组件标记：${MARKER}（产物是不是没重建？）`);

const call = raw.indexOf('append_styles(', at);
// 🔴 #445：Svelte 会**按内容挑引号** —— CSS 里没有单引号时用 `'`（MediaList），
//    含单引号（如 `content: '：'`）就改用 **反引号**（EntryForm 是这种）⇒ 三种引号都要认，
//    ⛔ 别只匹配 `'`（那会让 `EntryForm` 报「找不到 append_styles 形态」）。
const head = raw.slice(call).match(/^append_styles\(target, "(svelte-\w+)", (['"`])/);
if (!head) throw new Error('找不到 append_styles(target, "svelte-<hash>", …) 的形态');

const hash = head[1];
const QUOTE = head[2];
const start = call + head[0].length;
// 字符串字面量：扫到**未转义**的同种引号为止（Svelte 只转义该引号本身与 \\）
let i = start;
let out = '';
while (i < raw.length) {
    const c = raw[i];
    if (c === '\\') {
        out += raw[i + 1];
        i += 2;
        continue;
    }
    if (c === QUOTE) break;
    out += c;
    i++;
}
if (i >= raw.length) throw new Error('样式字符串没有收尾引号');

const css = out;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, css, 'utf8');
console.log(`hash = ${hash}`);
console.log(`写入 ${path.relative(ROOT, OUT)}：${css.length} 字节（**保留** .${hash} 后缀 ${(out.length - out.split(`.${hash}`).join('').length) / (hash.length + 1)} 处）`);
console.log(`👉 仿真页必须把 scope 类 \`${hash}\` 加回带 \`rl-\` 类名的元素上（否则一条规则都不匹配）。`);
