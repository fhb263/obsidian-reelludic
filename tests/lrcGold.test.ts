// 🔴 m04435 ③：[Gold] 高光句解析（用户逐字：
//   「LRC歌词框支持 `[时间戳][Gold]歌词`，如 `[01:29.58][Gold]分手应该体面`。
//     【`[Gold]` 解析后从渲染歌词正文移除；一行多时间戳时作用于该行全部时间点】」
//
// 四组判据，任何一条塌陷都会让功能静默失效（编译器和旧测试都看不见）：
//  ⑴ 标记被正确**识别**（大小写不敏感）；
//  ⑵ 标记从正文里**剥干净**（否则用户会在屏幕上看到 `[Gold]` 字样）；
//  ⑶ 一行多时间戳 ⇒ 每个时间点都算高光；
//  ⑷ 没标记的行 `gold` 必须**不存在**（不是 `false`）—— 渲染层靠真假判断，别留下半态。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isLrcContent, parseLrc, parseLrcDocument } from 'pure/lrc';

const gold = (content: string) => parseLrcDocument(content).lines;

describe('🔴 m04435 ③ [Gold]：标记识别', () => {
    it('🔴 时间标签之后的 `[Gold]` 被认出来，正文不含标记', () => {
        const lines = gold('[01:29.58][Gold]分手应该体面');
        expect(lines).toHaveLength(1);
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('分手应该体面');
        expect(lines[0].text).not.toContain('Gold');
        expect(lines[0].text).not.toContain('[');
    });

    it('🔴 大小写不敏感：`[gold]` / `[GOLD]` 同样算高光', () => {
        expect(gold('[00:01.00][gold]甲')[0].gold).toBe(true);
        expect(gold('[00:01.00][GOLD]乙')[0].gold).toBe(true);
        expect(gold('[00:01.00][GoLd]丙')[0].gold).toBe(true);
    });

    it('🔴 标签**顺序无关**：先 `[Gold]` 后时间（用户手打时两种都可能）', () => {
        const lines = gold('[Gold][00:05.00]倒过来的写法');
        expect(lines).toHaveLength(1);
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('倒过来的写法');
    });

    it('🔴 没有 `[Gold]` 的行：`gold` 字段**不存在**（不是 false）', () => {
        const line = gold('[00:01.00]普通一句')[0];
        expect(line.gold).toBeUndefined();
        expect('gold' in line).toBe(false);
    });

    it('⚠️ 别的方括号标签照旧是正文（`[Chorus]` 不算高光，也不能被剥掉）', () => {
        const line = gold('[00:01.00][Chorus]副歌唱起来')[0];
        expect(line.gold).toBeUndefined();
        expect(line.text).toBe('[Chorus]副歌唱起来');
    });
});

describe('🔴 m04435 ③ [Gold]：一行多时间戳 ⇒ 每个时间点都是高光', () => {
    it('🔴 两个时间标签 + 一个 `[Gold]` ⇒ 两行、都带 gold、正文一致', () => {
        const lines = gold('[00:10.00][01:20.00][Gold]副歌复用这句');
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.gold === true)).toBe(true);
        expect(lines.every((l) => l.text === '副歌复用这句')).toBe(true);
        // 时间戳真的分开了（不是两行同刻）
        expect(lines[0].timestamp).not.toBe(lines[1].timestamp);
    });

    it('🔴 一条高光、一条普通混排：各归各的（互不污染）', () => {
        const lines = gold(
            ['[00:01.00][Gold]高光的那句', '[00:02.00]普通的那句'].join('\n'),
        );
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('高光的那句');
        expect(lines[1].gold).toBeUndefined();
        expect(lines[1].text).toBe('普通的那句');
    });

    it('⚠️ `[Gold]` 夹在时间标签中间也认（`[t][Gold][t]` 这种乱序手打）', () => {
        const lines = gold('[00:10.00][Gold][01:20.00]中间插标记');
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.gold === true)).toBe(true);
        expect(lines.every((l) => l.text === '中间插标记')).toBe(true);
    });
});

describe('🔴 m04435 ③ [Gold]：⛔ 不破坏既有解析行为', () => {
    it('`[Gold]` 不影响时间戳解析（秒数照旧精确）', () => {
        const line = gold('[01:29.58][Gold]时间要对')[0];
        expect(line.timestamp).toBe(89_580);
        expect(line.timestr).toBe('01:29');
    });

    it('`[Gold]` 行仍会得到逐字词元（高亮靠它，⛔ 别因为金标就跳过）', () => {
        const line = gold('[00:01.00][Gold]一二三')[0];
        expect(line.words?.length).toBeGreaterThan(0);
        expect(line.words?.map((w) => w.text).join('')).toBe('一二三');
    });

    it('`[Gold]` + 双语译文一起用时两者都在（译文另起一行，金标只管原文）', () => {
        const line = gold('[00:01.00][Gold]原文 | 译文')[0];
        expect(line.gold).toBe(true);
        expect(line.text).toBe('原文');
        expect(line.annotation).toBe('译文');
    });

    it('`[offset:]` 与 `[Gold]` 并存时 offset 照旧生效', () => {
        const lines = gold(['[offset:500]', '[00:10.00][Gold]偏移那句'].join('\n'));
        // `+` = 整体提前 ⇒ 10s 的标签落到 9.5s
        expect(lines[0].timestamp).toBe(9_500);
        expect(lines[0].gold).toBe(true);
    });

    it('`isLrcContent` 对只有 `[Gold]` 没有时间的行不误判（⛔ 别把标记行当成歌词）', () => {
        expect(isLrcContent('[Gold]这行没有时间标签')).toBe(false);
        expect(isLrcContent('[00:01.00][Gold]这行是歌词')).toBe(true);
    });

    it('`parseLrc` 便捷别名与主入口口径一致（两处都带 gold）', () => {
        const lines = parseLrc('[00:01.00][Gold]别名也要认');
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('别名也要认');
    });
});

// 🔴🔴 m07623（用户：「LRC `[Gold]`格式下，被逐字滚动效果覆盖成主题色了啊」）
//
// 这一组**不查字符串存不存在**，而是把 `styles.css` 里所有带 `color` 的规则抓出来，
// 按 CSS 层叠规则（特异度 → 出现顺序）算出「金句当前行里那个字**实际**是什么颜色」。
//
// 上一版只有「两条基础规则必须还在」这种存在性判据 ⇒ 金被逐字规则盖掉时它照样全绿。
//   `.is-cur .rl-ap-lyr-w`        = (0,3,0)  ——压过 `.is-gold` (0,2,0)
//   `.is-cur .rl-ap-lyr-w.is-on`  = (0,4,0)  ——压过 `.is-gold.is-cur` (0,3,0)
// 这就是本 bug 的全部成因：行色写对了，字色被 span 抢走。
const ROOT = resolve(__dirname, '..');
const GOLD_LIGHT = '#a8791f';
const GOLD_LIGHT_HOVER = '#c08c22';
const GOLD_DARK = '#c79a35';
const GOLD_BRIGHT = '#f5c451';

interface CssRule { selector: string; decls: string; order: number }

/** 抓 `选择器 { 声明 }`；注释先剥掉（否则注释里的规则串会冒充真规则） */
const CSS_RULES: CssRule[] = (() => {
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const out: CssRule[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    let order = 0;
    while ((m = re.exec(css)) !== null) {
        // `[^{}]+` 可能把上一个块残留的空白/换行卷进来 ⇒ 取最后一行才是选择器本体
        const selector = m[1].trim().split('\n').pop()!.trim();
        if (!selector || selector.startsWith('@')) continue;
        out.push({ selector, decls: m[2], order: order++ });
    }
    return out;
})();

/** 复合选择器 → 类名数组；出现类以外的记号（`:hover` / `::before` / `[attr]`）就返回 null（当作不命中） */
const compoundClasses = (part: string): string[] | null => {
    const stripped = part.replace(/\.[\w-]+/g, '');
    if (stripped !== '') return null;
    return (part.match(/\.[\w-]+/g) ?? []).map((s) => s.slice(1));
};

/**
 * 选择器是否命中目标节点。
 * `chain` = [祖先, …, 自己]（每项是该层节点的类名数组）；只处理后代组合器（本仓这套规则全部如此）。
 */
const selectorMatches = (selector: string, chain: string[][]): boolean => {
    const parts = selector.trim().split(/\s+/);
    if (!parts.length) return false;
    const compounds = parts.map(compoundClasses);
    if (compounds.some((c) => c === null)) return false;
    let limit = chain.length - 1;
    for (let i = compounds.length - 1; i >= 0; i--) {
        const need = compounds[i]!;
        let found = -1;
        for (let j = limit; j >= 0; j--) {
            if (need.every((c) => chain[j].includes(c))) { found = j; break; }
        }
        if (found < 0) return false;
        // 最右的复合选择器必须命中**自己**（否则是「后代命中、自己没命中」的假阳性）
        if (i === compounds.length - 1 && found !== chain.length - 1) return false;
        limit = found - 1;
    }
    return true;
};

/** 按层叠规则算出实际生效的 `color`（只比特异度的类计数 + 出现顺序；本仓这套规则没有 id/元素选择器参与竞争） */
const resolvedColor = (chain: string[][]): { color: string; selector: string } => {
    const hits: { b: number; order: number; color: string; selector: string }[] = [];
    for (const rule of CSS_RULES) {
        if (!selectorMatches(rule.selector, chain)) continue;
        const decl = rule.decls.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
        if (!decl) continue;
        hits.push({
            b: (rule.selector.match(/\./g) ?? []).length,
            order: rule.order,
            color: decl[1].trim(),
            selector: rule.selector,
        });
    }
    if (!hits.length) throw new Error(`没有任何规则命中：${JSON.stringify(chain)}`);
    hits.sort((x, y) => (y.b - x.b) || (y.order - x.order));
    return { color: hits[0].color, selector: hits[0].selector };
};

/** 金句当前行里一个词元 span 的上下文（`on` = 这个字已唱到） */
const goldWordChain = (on: boolean): string[][] => [
    ['rl-ap-lyrics'],
    ['rl-ap-lyr-line', 'is-gold', 'is-cur'],
    ['rl-ap-lyr-w', ...(on ? ['is-on'] : [])],
];

const darkChain = (chain: string[][]): string[][] => [
    ['theme-dark'],
    ...chain,
];

describe('🔴🔴 m07623 [Gold] × 逐字高亮：按层叠算实际颜色（⛔ 不是查字符串存在）', () => {
    it('🔴 金句当前行 · 未唱到的字 = 暗金（不是 --text-faint）', () => {
        const r = resolvedColor(goldWordChain(false));
        expect(r.color).toBe(GOLD_LIGHT);
        expect(r.color).not.toBe('var(--text-faint)');
    });

    it('🔴 金句当前行 · 已唱到的字 = 亮金（不是 --text-accent，用户报的就是这个）', () => {
        const r = resolvedColor(goldWordChain(true));
        expect(r.color).toBe(GOLD_BRIGHT);
        expect(r.color).not.toBe('var(--text-accent)');
    });

    it('🔴 深色主题同样成立：暗金提亮一档、亮金不变', () => {
        expect(resolvedColor(darkChain(goldWordChain(false))).color).toBe(GOLD_DARK);
        expect(resolvedColor(darkChain(goldWordChain(true))).color).toBe(GOLD_BRIGHT);
    });

    it('🔴 金句当前行两种逐字态必须**明暗有别**（否则「逐字」在视觉上消失了）', () => {
        const off = resolvedColor(goldWordChain(false)).color;
        const on = resolvedColor(goldWordChain(true)).color;
        expect(off).not.toBe(on);
        // 唱到的更亮：亮金的相对亮度 > 暗金
        const lum = (hex: string): number => {
            const n = parseInt(hex.slice(1), 16);
            return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
        };
        expect(lum(on)).toBeGreaterThan(lum(off));
    });

    it('⚠️ 非金句的逐字高亮**一个字都不许变**（基础两条规则仍在生效）', () => {
        const plainOff = resolvedColor([
            ['rl-ap-lyrics'],
            ['rl-ap-lyr-line', 'is-cur'],
            ['rl-ap-lyr-w'],
        ]);
        const plainOn = resolvedColor([
            ['rl-ap-lyrics'],
            ['rl-ap-lyr-line', 'is-cur'],
            ['rl-ap-lyr-w', 'is-on'],
        ]);
        expect(plainOff.color).toBe('var(--text-faint)');
        expect(plainOn.color).toBe('var(--text-accent)');
    });

    it('⚠️ 非当前行的金句 = 暗金（金句不一定是当前行，别只顾 `is-cur`）', () => {
        const r = resolvedColor([
            ['rl-ap-lyrics'],
            ['rl-ap-lyr-line', 'is-gold'],
        ]);
        expect(r.color).toBe(GOLD_LIGHT);
        expect(resolvedColor(darkChain([['rl-ap-lyrics'], ['rl-ap-lyr-line', 'is-gold']])).color).toBe(GOLD_DARK);
    });

    it('🔴 金配色**不跟随主题色**：金句任何态解析出的都是固定金值，⛔ 不是 var(--text-accent)', () => {
        for (const chain of [goldWordChain(false), goldWordChain(true), darkChain(goldWordChain(false)), darkChain(goldWordChain(true))]) {
            const color = resolvedColor(chain).color;
            expect(color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(color).not.toContain('var(--text-accent)');
        }
    });
});

