import { describe, it, expect } from 'vitest';
import {
    parseHighlightBlocks,
    renderHighlightBlock,
    normalizeHlStyle,
    normalizeHlColor,
    hlStyleLabel,
    hlColorLabel,
    parseHlStyleLabel,
    parseHlColorLabel,
    findSameExcerpt,
    DEFAULT_HL_STYLE,
    DEFAULT_HL_COLOR,
    HL_COLOR_HEX,
    highlightMarkCss,
    HL_STYLES,
    HL_COLORS,
    HIGHLIGHT_SECTION,
} from 'pure/highlight';

const SECT = HIGHLIGHT_SECTION;

describe('pure/highlight 高亮样式与颜色（3 样式 × 4 色）', () => {
    it('档位表：3 样式 / 5 色，顺序即 UI 顺序（十五轮按参考图扩为五色）', () => {
        expect(HL_STYLES.map((s) => s.id)).toEqual(['hl', 'underline', 'wavy']);
        expect(HL_STYLES.map((s) => s.label)).toEqual(['高亮', '划线', '波浪']);
        expect(HL_COLORS.map((c) => c.id)).toEqual(['red', 'yellow', 'green', 'blue', 'purple']);
        expect(HL_COLORS.map((c) => c.label)).toEqual(['红', '黄', '绿', '蓝', '紫']);
    });

    it('归一：合法直通 / 脏值回退默认（默认＝黄色高亮）', () => {
        expect(normalizeHlStyle('wavy')).toBe('wavy');
        expect(normalizeHlColor('purple')).toBe('purple');
        // 旧档位别名：上一轮的「粉」/pink 一律归一到紫（append-only 兼容）
        expect(normalizeHlColor('pink')).toBe('purple');
        expect(normalizeHlColor('粉')).toBe('purple');
        expect(normalizeHlStyle('WAVY')).toBe(DEFAULT_HL_STYLE);
        expect(normalizeHlStyle(undefined)).toBe(DEFAULT_HL_STYLE);
        expect(normalizeHlStyle(null)).toBe(DEFAULT_HL_STYLE);
        expect(normalizeHlStyle('toString')).toBe(DEFAULT_HL_STYLE);
        expect(normalizeHlColor('')).toBe(DEFAULT_HL_COLOR);
        expect(normalizeHlColor('constructor')).toBe(DEFAULT_HL_COLOR);
        expect(DEFAULT_HL_STYLE).toBe('hl');
        expect(DEFAULT_HL_COLOR).toBe('yellow');
    });

    it('中文标签双向映射（笔记里人类可读）', () => {
        expect(hlStyleLabel('wavy')).toBe('波浪');
        expect(hlColorLabel('green')).toBe('绿');
        expect(parseHlStyleLabel('波浪')).toBe('wavy');
        expect(parseHlColorLabel('绿')).toBe('green');
        expect(parseHlColorLabel('粉')).toBe('purple');
        // 容忍英文 id 与大小写/空白
        expect(parseHlStyleLabel(' underline ')).toBe('underline');
        expect(parseHlColorLabel('BLUE')).toBe('blue');
        expect(parseHlColorLabel('pink')).toBe('purple');
        expect(parseHlStyleLabel('画线')).toBe(DEFAULT_HL_STYLE);
        expect(parseHlColorLabel(undefined)).toBe(DEFAULT_HL_COLOR);
    });

    it('渲染：callout 头行带配色段与样式标签（无源文件 → 块尾补 ^hl 锚点）', () => {
        const md = renderHighlightBlock('引用文字', { chapter: 3, pct: 42 }, 'wavy', 'green');
        expect(md).toContain('> [!quote|green] 第 3 章 · 42% · 波浪');
        expect(md).toContain('> 引用文字');
        expect(md).toMatch(/\^hl[\w-]+$/);
        // 默认档（高亮/黄）：样式段省略、配色段恒在
        const def = renderHighlightBlock('默认档', { chapter: 1, pct: 0 });
        expect(def).toContain('> [!quote|yellow] 第 1 章');
        expect(def).not.toContain('· 高亮');
    });

    it('旧数据兼容：没有样式/颜色行 → 解析为默认黄高亮（append-only）', () => {
        const md = ['## ' + SECT, '', '> 老高亮文字', '', '定位：1:20', '^hlold111'].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(1);
        expect(r[0].style).toBe(DEFAULT_HL_STYLE);
        expect(r[0].color).toBe(DEFAULT_HL_COLOR);
    });

    it('新旧混排：带样式行按行解析、缺行回退默认', () => {
        const md = [
            '## ' + SECT, '',
            '> 新：波浪绿', '', '定位：2:10 · 样式：波浪 · 颜色：绿', '^hlnew111', '',
            '> 旧：无样式', '', '定位：2:30', '^hlold222',
        ].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({ quote: '新：波浪绿', style: 'wavy', color: 'green' });
        expect(r[1]).toMatchObject({ quote: '旧：无样式', style: 'hl', color: 'yellow' });
    });

    it('渲染→解析往返一致（含新增样式/颜色）', () => {
        for (const s of HL_STYLES) {
            for (const c of HL_COLORS) {
                const md = ['## ' + SECT, '', renderHighlightBlock('往返文字', { chapter: 1, pct: 5 }, s.id, c.id)].join('\n');
                const r = parseHighlightBlocks(md);
                expect(r[0]).toMatchObject({ quote: '往返文字', style: s.id, color: c.id });
            }
        }
    });
});

describe('pure/highlight findSameExcerpt（垃圾桶定位摘抄用）', () => {
    const list = [
        { quote: '第一段 摘抄内容', id: 'bk1', loc: { chapter: 1, pct: 10 } },
        { quote: '第二段 摘抄内容', id: 'bk2', loc: { chapter: 3, pct: 20 } },
        { quote: '无定位老摘抄', id: 'bk3' },
    ];

    it('按归一文本命中（忽略空白差异）', () => {
        expect(findSameExcerpt(list, '第一段摘抄内容')?.id).toBe('bk1');
        expect(findSameExcerpt(list, ' 第一段 摘抄内容 ')?.id).toBe('bk1');
    });

    it('给章节时优先同章', () => {
        expect(findSameExcerpt(list, '第二段 摘抄内容', 3)?.id).toBe('bk2');
        expect(findSameExcerpt(list, '第二段 摘抄内容', 1)?.id).toBe('bk2'); // 同章无命中 → 退化为全局
    });

    it('无命中 / 空文本 → null', () => {
        expect(findSameExcerpt(list, '不存在的内容')).toBeNull();
        expect(findSameExcerpt(list, '   ')).toBeNull();
        expect(findSameExcerpt([], '第一段 摘抄内容')).toBeNull();
    });

    it('无定位的老摘抄也能命中', () => {
        expect(findSameExcerpt(list, '无定位老摘抄')?.id).toBe('bk3');
    });
});

// ── 注入式高亮 CSS（2026-09-17 二十二轮补）：EPUB 正文 iframe 是独立文档，收不到插件 styles.css，
//    必须由 buildFrameCss 注入一份等价规则；十四轮漏了这份导致 EPUB 高亮全退化成默认黄底。
describe('pure/highlight highlightMarkCss（注入型上下文用）', () => {
    const css = highlightMarkCss();

    it('五个颜色档位各出一条 --rl-hl-c 规则，色值与 HL_COLOR_HEX 一致', () => {
        for (const c of HL_COLORS) {
            expect(css).toContain(`.rl-hl-persist[data-color="${c.id}"]{--rl-hl-c:${HL_COLOR_HEX[c.id]};}`);
        }
        const count = css.split('.rl-hl-persist[data-color=').length - 1;
        expect(count).toBe(HL_COLORS.length);
    });

    it('底色规则读 --rl-hl-c，缺省回退默认色', () => {
        expect(css).toContain(`var(--rl-hl-c, ${HL_COLOR_HEX[DEFAULT_HL_COLOR]})`);
        expect(css).toContain('.rl-hl-persist{color:inherit;background:color-mix(in srgb,');
    });

    // 2026-09-18 实证：`<mark>` 的 UA 默认色是 MarkText（纯黑），独立文档里没有任何核心规则覆写它 →
    // 深色主题下划线 / 波浪的黑字压在深底上「看不见」。高亮只加底色 / 划线、不改文字色 → 必须显式 inherit。
    it('mark 必须显式声明 color:inherit（防退回 UA 的黑色 MarkText）', () => {
        expect(css).toContain('.rl-hl-persist{color:inherit;');
        // 反向守卫：不得写死任何具体文字色（含三档样式规则），只准 inherit。
        // ⚠️ 别用 `color:\s*(?!inherit)` —— `\s*` 会回溯到零长度，让「冒号 + 空格 + inherit」也被判为不合规（假红）。
        //    改为「取值后比对」：`(?<![\w-])` 排除 `-color:`（text-decoration-color 合法），`color-mix` 无冒号天然不匹配。
        const vals = [...css.matchAll(/(?<![\w-])color:\s*([^;}]*)/g)].map((m) => m[1].trim());
        expect(vals.length).toBeGreaterThan(0);
        expect([...new Set(vals)]).toEqual(['inherit']);
    });

    it('划线／波浪两种非默认样式各有一条规则（默认档沿用底色规则）', () => {
        expect(css).toContain('.rl-hl-persist[data-style="underline"]{background:transparent;border-radius:0;text-decoration-line:underline;');
        expect(css).toContain('.rl-hl-persist[data-style="wavy"]{background:transparent;border-radius:0;text-decoration:underline wavy');
        expect(css).toContain('text-underline-offset:3px;');
    });

    it('mark 规则里不得出现 padding / border（行内盒会参与行内布局 → 高亮后同行后续文字位移 2px）', () => {
        expect(css).not.toContain('padding');
        expect(css).not.toContain('border-bottom');
        expect(css).not.toContain('border:');
    });

    it('色值表覆盖全部档位（类型上有 Record<HlColor> 兜底，这里再钉一次运行时完整性）', () => {
        for (const c of HL_COLORS) expect(/^#[0-9a-f]{6}$/.test(HL_COLOR_HEX[c.id])).toBe(true);
        expect(Object.keys(HL_COLOR_HEX).sort()).toEqual(HL_COLORS.map((c) => c.id).sort());
    });
});
