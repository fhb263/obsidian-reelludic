/**
 * 仿真页生成器的**常驻工具**：清掉 `page` 模板字面量**内部**的反引号。
 *
 * 🔴 为什么需要它：本仓的仿真页生成器都把整页 HTML 塞进一个模板字面量里（`const page = \`…\``），
 *    而页面正文里只要出现**一个**反引号（`<code>` 包代码时最常犯）⇒ **整个脚本 SyntaxError**，
 *    报错位置还在几十行之外的 `wrapSafe`，很难一眼看出。本批（#507）之前已经踩过 4 次。
 * ⚠️ 必须用**文件**跑：bash 内联会把反引号当命令替换（这也是本仓踩过的坑）。
 *
 * 用法：node tools/strip-backticks.cjs _gen_ef507_sim.cjs
 *   只清 `const page = \`` … `\n\`;\n` 之间的部分，⛔ 不动首尾两个分隔符，⛔ 不动别的字面量。
 */
const fs = require('fs');
const BT = String.fromCharCode(96);

const file = process.argv[2];
if (!file) {
    console.error('用法：node tools/strip-backticks.cjs <生成器文件>');
    process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = crlf ? raw.split('\r\n').join('\n') : raw;

const START = 'const page = ' + BT;
const a = s.indexOf(START);
if (a < 0) {
    console.log(file + '：没有 `const page = \`` ⇒ 不用清');
    process.exit(0);
}
const bodyFrom = a + START.length;
const endMark = '\n' + BT + ';\n';
const b = s.indexOf(endMark, bodyFrom);
if (b < 0) throw new Error('找不到 page 字面量终点（`\\n`;`）');

const region = s.slice(bodyFrom, b);
const before = (region.match(new RegExp(BT, 'g')) || []).length;
if (before === 0) {
    console.log(file + '：page 段内本来就没有反引号 ✅');
    process.exit(0);
}
const out = s.slice(0, bodyFrom) + region.split(BT).join('') + s.slice(b);
fs.writeFileSync(file, crlf ? out.split('\n').join('\r\n') : out);
console.log(file + '：page 段内反引号 ' + before + ' → 0');
