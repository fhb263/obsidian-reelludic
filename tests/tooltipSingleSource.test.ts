import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 🔴 2026-11-12（用户 m00353 ①-9）：「部分按钮 hover 双提示重叠覆盖」。
 *
 * 成因：同一元素既挂 `data-tip`（本插件自绘气泡）又挂 `aria-label`（Obsidian 会给带
 * `aria-label` 的 hover 目标**自己**再画一个官方气泡）⇒ 悬停叠出两层。
 * 同一个「又挂 `title` 又挂 `data-tip`」也一样会闪两次。
 *
 * 用户原话还要求「下次加轻提示要检查是否存在双提示嵌套覆盖」⇒ 这条检查不能靠人记，
 * 落成常驻守卫：以后谁再这么写，这里直接红。
 *
 * 约定的单一真源（`src/ui/components.ts`）：
 * - 悬停提示 → `setTip(el, text)`，只写 `data-tip`，并顺手抹掉残留的 `aria-label` / `title`；
 * - 读屏名   → `srLabel(el, text)`，写 `<span class="rl-sr">` 隐藏文本。
 *
 * ⚠️ `aria-expanded` / `aria-pressed` / `aria-hidden` **不受限制** —— 它们只报状态/装饰，
 *    不会触气泡。这里只盯 `aria-label` 与 `title` 这两个会画气泡的属性。
 */

const ROOT = join(__dirname, '..', 'src');
/** 会画气泡的属性 —— 与 `data-tip` 互斥 */
const BUBBLE_ATTRS = ['aria-label', 'title'] as const;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|svelte)$/.test(name)) out.push(p);
    }
    return out;
}

/** 注释行不算 —— 源码里大量「⛔ 别写 aria-label」的说明本身就带着这个词 */
function isComment(line: string): boolean {
    const t = line.trim();
    return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

describe('①-9 悬停提示单一真源：⛔ 同一元素不许既挂 data-tip 又挂 aria-label / title', () => {
    const files = walk(ROOT);

    it('扫描器本身要摸得到源码（防止路径写错导致永远绿）', () => {
        expect(files.length).toBeGreaterThan(100);
        // ⚠️ 用 `join` 拼而不是写死 `'ui/components.ts'` —— Windows 上分隔符是反斜杠，
        //    写死正斜杠会让这条自检永远假红（tsc 绿、测试红这种半天找不到原因的假故障）。
        expect(files.some((f) => f.endsWith(join('ui', 'components.ts')))).toBe(true);
    });

    it('命令式 DOM（.ts）：同一变量上 setAttribute 的双挂为零', () => {
        const bad: string[] = [];
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            if (!text.includes('data-tip')) continue;
            /** key = 接收者表达式（如 `btn` / `this.minBtn`） */
            const seen = new Map<string, Map<string, number>>();
            text.split(/\r?\n/).forEach((line, i) => {
                if (isComment(line)) return;
                // 只管「某表达式 .setAttribute('x')」
                for (const m of line.matchAll(/([A-Za-z_$][\w.$]*)\s*\.\s*setAttribute\(\s*'([a-z-]+)'/g)) {
                    const [, el, attr] = m;
                    if (!seen.has(el)) seen.set(el, new Map());
                    // 记录行号，报错时能指到具体位置
                    seen.get(el)!.set(attr, i + 1);
                }
                // `setTip(el, …)` 等价于「挂了 data-tip」
                for (const m of line.matchAll(/setTip\(\s*([A-Za-z_$][\w.$]*)/g)) {
                    const el = m[1];
                    if (!seen.has(el)) seen.set(el, new Map());
                    seen.get(el)!.set('**tip**', i + 1);
                }
            });
            for (const [el, attrs] of seen) {
                const tipLine = attrs.get('data-tip') ?? attrs.get('**tip**');
                if (!tipLine) continue;
                for (const attr of BUBBLE_ATTRS) {
                    const line = attrs.get(attr);
                    if (line) {
                        bad.push(`${relative(ROOT, file)}: ${el} 双挂 ${attr}(L${line}) + data-tip(L${tipLine})`);
                    }
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it('Svelte 模板：同一个开始标签上不许出现两种气泡属性', () => {
        const bad: string[] = [];
        for (const file of files) {
            if (!file.endsWith('.svelte')) continue;
            const text = readFileSync(file, 'utf8');
            if (!text.includes('data-tip')) continue;
            const tagRe = /<([A-Za-z][\w.]*)((?:[^<>"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>/g;
            for (const m of text.matchAll(tagRe)) {
                const attrs = m[2];
                if (!/(^|\s)data-tip\b/.test(attrs)) continue;
                const line = text.slice(0, m.index).split(/\r?\n/).length;
                for (const attr of BUBBLE_ATTRS) {
                    if (new RegExp(`(^|\\s)${attr}\\s*[=}]`).test(attrs)) {
                        bad.push(`${relative(ROOT, file)}:${line} <${m[1]}> data-tip + ${attr}`);
                    }
                }
            }
        }
        expect(bad).toEqual([]);
    });
});
