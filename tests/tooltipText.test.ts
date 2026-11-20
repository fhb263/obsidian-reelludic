// 悬停气泡「不超过一行」的守护测试（用户 m18062）。
//
// 🔴 用户原话：「优化精简所有鼠标hover 交互悬停文案，不要超过1行」。
//    这里守两层，因为单靠任何一层都不够：
//      ⑴ **渲染层兜底**（`pure/tooltipText.fitTipText`）：今天改完的文案明天可能又被改回多行，
//         靠「记得别写 \n」是不可持续的 ⇒ 在气泡渲染入口统一压平。
//      ⑵ **文案本身**（全仓 `data-tip` 扫描）：渲染层截断是最后一道保险，但被截掉半句话的
//         悬停提示本身就是坏体验 ⇒ 源头上也不许写超长/多行。
//    ⚠️ 第二层扫的是**字面量**；含变量的动态文案由 ⑴ 兜底（宽度取决于运行时值，静态判不了）。
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import {
    TIP_ASCII_PX,
    TIP_CJK_PX,
    TIP_ELLIPSIS,
    TIP_MAX_WIDTH_PX,
    charWidthPx,
    fitTipText,
    textWidthPx,
} from 'pure/tooltipText';

const ROOT = resolve(__dirname, '..');

describe('charWidthPx / textWidthPx（按显示宽度，不是字符数）', () => {
    it('汉字按全角计宽', () => {
        expect(charWidthPx('中')).toBe(TIP_CJK_PX);
    });

    it('ASCII 按半角计宽', () => {
        expect(charWidthPx('a')).toBe(TIP_ASCII_PX);
        expect(charWidthPx('1')).toBe(TIP_ASCII_PX);
    });

    it('全角标点也算全角', () => {
        expect(charWidthPx('，')).toBe(TIP_CJK_PX);
        expect(charWidthPx('。')).toBe(TIP_CJK_PX);
    });

    it('🔴 同样字符数，全角比半角宽一倍左右（这就是不能按字数截断的理由）', () => {
        const cjk = textWidthPx('一二三四五六七八九十');
        const ascii = textWidthPx('abcdefghij');
        expect(cjk).toBeGreaterThan(ascii * 1.8);
    });

    it('空串宽度为 0', () => {
        expect(textWidthPx('')).toBe(0);
    });
});

describe('fitTipText（压成一行）', () => {
    it('🔴 换行折成空格（CSS 是 pre-line，不折就真的换行）', () => {
        expect(fitTipText('第一句\n第二句')).toBe('第一句 第二句');
        expect(fitTipText('甲\r\n乙')).toBe('甲 乙');
    });

    it('🔴 多行文案折完后不含任何换行符', () => {
        const out = fitTipText('a\nb\nc\n\nd');
        expect(out).not.toContain('\n');
        expect(out).not.toContain('\r');
    });

    it('连续空白与全角空格折成单个半角空格', () => {
        expect(fitTipText('a   b')).toBe('a b');
        expect(fitTipText('a\u3000\u3000b')).toBe('a b');
    });

    it('首尾空白去掉', () => {
        expect(fitTipText('  内容  ')).toBe('内容');
    });

    it('空 / 纯空白 ⇒ 空串（调用方据此不显示气泡）', () => {
        expect(fitTipText('')).toBe('');
        expect(fitTipText('   ')).toBe('');
        expect(fitTipText(null)).toBe('');
        expect(fitTipText(undefined)).toBe('');
    });

    it('不超预算的文案原样返回（不截断、不加省略号）', () => {
        expect(fitTipText('拖动调整缩放')).toBe('拖动调整缩放');
    });

    it('🔴 超预算的按宽度截断并加省略号，且截断后不再超预算', () => {
        const long = '这是一段特别特别长的悬停说明文字用来验证按显示宽度截断而不是按字符数截断的行为';
        const out = fitTipText(long);
        expect(out.endsWith(TIP_ELLIPSIS)).toBe(true);
        expect(textWidthPx(out)).toBeLessThanOrEqual(TIP_MAX_WIDTH_PX);
        expect(out.length).toBeLessThan(long.length);
    });

    it('🔴 截断点落在空格上时不出现「文字 …」这种空心眼', () => {
        const out = fitTipText('a'.repeat(20) + ' ' + 'b'.repeat(60));
        expect(out).not.toContain(' ' + TIP_ELLIPSIS);
        expect(textWidthPx(out)).toBeLessThanOrEqual(TIP_MAX_WIDTH_PX);
    });

    it('纯半角长文案截得比纯全角多（宽度预算一致、字宽不同）', () => {
        const cjk = fitTipText('中'.repeat(200));
        const ascii = fitTipText('a'.repeat(200));
        expect(ascii.length).toBeGreaterThan(cjk.length);
    });

    it('幂等：对已压平的文案再压一次结果不变', () => {
        const once = fitTipText('第一句\n第二句');
        expect(fitTipText(once)).toBe(once);
    });
});

// ── 第二层：全仓 data-tip 字面量审计 ─────────────────────────────────────────
//
// 🔴 这条是「用户看到的原文」的机械判据。渲染层会截断，但被截掉半句话本身就是坏体验，
//    所以源头上也不许出现超长或多行文案。
// ⚠️ 只审**字面量**；`data-tip={someVar}` 这类动态值由 `fitTipText` 兜底（静态判不了宽度）。
function walkSrc(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (['node_modules', '.git'].includes(name)) continue;
            walkSrc(p, out);
        } else if (/\.(ts|svelte)$/.test(name)) out.push(p);
    }
    return out;
}

/** 从一行源码里抠出所有字面量 data-tip（四种写法） */
function literalTipsOf(line: string): string[] {
    const out: string[] = [];
    const unescape = (s: string): string => s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');

    // data-tip: '...' / "data-tip": "..." / setAttribute('data-tip', '...')
    const reQ = /data-tip['"]?\s*[,:]\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
    let m: RegExpExecArray | null;
    while ((m = reQ.exec(line)) !== null) out.push(unescape(m[1] ?? m[2] ?? ''));

    // data-tip: `...`（无变量的模板串）
    const reT = /data-tip['"]?\s*[,:]\s*`([^`$]*)`/g;
    while ((m = reT.exec(line)) !== null) out.push(unescape(m[1]));

    // svelte: data-tip={'...'} / data-tip={"..."} / data-tip={`...`}
    const reB = /data-tip=\{([^}]*)\}/g;
    while ((m = reB.exec(line)) !== null) {
        const t = m[1].trim();
        const q = /^'((?:[^'\\]|\\.)*)'$/.exec(t) ?? /^"((?:[^"\\]|\\.)*)"$/.exec(t);
        if (q) out.push(unescape(q[1]));
        else if (/^`([^`$]*)`$/.test(t)) out.push(unescape(/^`([^`$]*)`$/.exec(t)![1]));
    }
    return out;
}

describe('全仓 data-tip 字面量必须在一行之内（m18062）', () => {
    const files = [...walkSrc(join(ROOT, 'src')), join(ROOT, 'main.ts')];

    it('扫描覆盖面正常（至少 100 条字面量，防正则失效导致本组静默通过）', () => {
        let n = 0;
        for (const f of files) {
            for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
                n += literalTipsOf(line).length;
            }
        }
        expect(n).toBeGreaterThan(100);
    });

    it('🔴 没有一条字面量含换行，也没有一条超过一行宽度预算', () => {
        const bad: string[] = [];
        for (const f of files) {
            const rel = relative(ROOT, f).replace(/\\/g, '/');
            readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
                for (const tip of literalTipsOf(line)) {
                    if (!tip) continue;
                    if (tip.includes('\n')) bad.push(`${rel}:${i + 1} 含换行：${tip.replace(/\n/g, ' ⏎ ')}`);
                    else if (textWidthPx(tip) > TIP_MAX_WIDTH_PX) {
                        bad.push(`${rel}:${i + 1} 超宽 ${Math.round(textWidthPx(tip))}px：${tip}`);
                    }
                }
            });
        }
        expect(bad).toEqual([]);
    });
});
