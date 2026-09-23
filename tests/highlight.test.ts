// 阅读器高亮纯逻辑测试（无 obsidian 依赖）：笔记「## 高亮」区解析/渲染/章节过滤；
// 追加/删除复用 pure/excerpt（section='高亮'）已在 excerpt.test 覆盖，此处验证 highight 封装与该区行为。
import { describe, it, expect } from 'vitest';
import {
    parseHighlightBlocks,
    chapterHighlights,
    renderHighlightBlock,
    findQuoteSegment,
    findSameHighlight,
    markParagraphHtml,
    decideHighlightToggle,
    normText,
    HIGHLIGHT_SECTION,
    HL_MIRROR_NOTICE,
    renderHighlightMirror,
    hlMarkTargetOf,
    type ReaderHighlight,
} from 'pure/highlight';
import { appendExcerptToNote, extractExcerptSection, removeExcerptBlock } from 'pure/excerpt';

const SECT = HIGHLIGHT_SECTION;

describe('pure/highlight parseHighlightBlocks', () => {
    it('无「## 高亮」区 → 空数组', () => {
        expect(parseHighlightBlocks('## 摘抄\n\n> x\n^bk1')).toEqual([]);
        expect(parseHighlightBlocks('')).toEqual([]);
        expect(parseHighlightBlocks('# 标题\n\n正文')).toEqual([]);
    });

    it('解析「## 高亮」区单条块：quote + loc + id(hl 前缀)', () => {
        const md = ['# 书', '', `## ${SECT}`, '', '> 这是高亮的文字', '', '定位：1:20', '^hl0a1b2c3'].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(1);
        expect(r[0].quote).toBe('这是高亮的文字');
        expect(r[0].loc).toEqual({ chapter: 1, pct: 20 });
        expect(r[0].id).toBe('hl0a1b2c3');
    });

    it('多条块逐条解析（含页码/心得字段的高亮块兼容忽略多余字段）', () => {
        const md = [
            `## ${SECT}`,
            '',
            '> 第一条高亮',
            '',
            '**p.10** · 心得：备注 · 定位：1:50',
            '^hl001',
            '',
            '> 第二条高亮',
            '',
            '定位：3:80',
            '^hl002',
        ].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(2);
        expect(r[0].quote).toBe('第一条高亮');
        expect(r[0].loc).toEqual({ chapter: 1, pct: 50 });
        expect(r[1].quote).toBe('第二条高亮');
        expect(r[1].loc).toEqual({ chapter: 3, pct: 80 });
    });

    it('高亮区与摘抄区互不干扰：只解析「## 高亮」内块', () => {
        const md = [
            `## ${SECT}`,
            '',
            '> hl 块',
            '^hl1',
            '',
            '## 摘抄',
            '',
            '> 摘抄块',
            '^bk1',
        ].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(1);
        expect(r[0].quote).toBe('hl 块');
    });

    it('空块 / 纯空白引用被过滤', () => {
        const md = [`## ${SECT}`, '', '>    ', '^hl1', '', '> 有效', '^hl2'].join('\n');
        const r = parseHighlightBlocks(md);
        expect(r).toHaveLength(1);
        expect(r[0].quote).toBe('有效');
    });
});

describe('pure/highlight chapterHighlights', () => {
    const list = [
        { quote: 'a', id: 'hl1', loc: { chapter: 1, pct: 10 } },
        { quote: 'b', id: 'hl2', loc: { chapter: 2, pct: 20 } },
        { quote: 'c', id: 'hl3', loc: { chapter: 1, pct: 90 } },
    ];
    it('筛出指定章', () => {
        expect(chapterHighlights(list, 1).map((h) => h.quote)).toEqual(['a', 'c']);
        expect(chapterHighlights(list, 2).map((h) => h.quote)).toEqual(['b']);
        expect(chapterHighlights(list, 3)).toEqual([]);
    });
    it('无 loc 的高亮不归入任何章', () => {
        const withNoLoc = [...list, { quote: 'noloc', id: 'hlx' }];
        expect(chapterHighlights(withNoLoc, 1).map((h) => h.quote)).toEqual(['a', 'c']);
    });
});

describe('pure/highlight renderHighlightBlock + 追加/删除到「## 高亮」区', () => {
    it('renderHighlightBlock 生成 callout 头行 + ^hl 块 id（不含 ^ 存 id）', () => {
        const md = renderHighlightBlock('高亮内容', { chapter: 2, pct: 45 }, undefined, undefined, { refLink: '书籍/活着.txt', id: 'hl0a1b2c3' });
        expect(md).toContain('> [!quote|yellow] [[书籍/活着.txt#^hl0a1b2c3|第 2 章 · 45%]]');
        expect(md).toContain('> 高亮内容');
        expect(md).not.toContain('定位：2:45');
        // 无 refLink（库外/无文件）→ 头行只写标签 + 块尾补 ^id 兜底
        const fallback = renderHighlightBlock('兜底', { chapter: 1, pct: 0 }, undefined, undefined, { id: 'hlZZZ' });
        expect(fallback).toContain('> [!quote|yellow] 第 1 章');
        expect(fallback).toMatch(/\n\^hlZZZ$/);
    });
    it('空引用 → 空串（不该追加）', () => {
        expect(renderHighlightBlock('   ', { chapter: 1, pct: 0 })).toBe('');
    });

    it('追加高亮到尚无高亮区的笔记 → 新建「## 高亮」区（不碰摘抄区）', () => {
        const note = '# 书\n\n正文\n\n## 摘抄\n\n> 摘\n^bk1';
        const hlMd = renderHighlightBlock('新高亮', { chapter: 1, pct: 50 }, undefined, undefined, { refLink: '书籍/活着.txt' });
        const final = appendExcerptToNote(note, hlMd, SECT);
        // 高亮区出现、含新块；摘抄区仍在
        const sec = extractExcerptSection(final, SECT);
        expect(sec).toContain('新高亮');
        expect(sec).toContain('第 1 章 · 50%');
        expect(final).toContain('## 摘抄');
        expect(final).toContain('^bk1');
    });

    it('追加到已有高亮区 → 区内追加，原有块保留', () => {
        const note = [`## ${SECT}`, '', '> 旧高亮', '^hl0', '', '## 摘抄', '', '> 摘', '^bk1'].join('\n');
        const final = appendExcerptToNote(note, renderHighlightBlock('新高亮', { chapter: 1, pct: 10 }), SECT);
        const sec = extractExcerptSection(final, SECT)!;
        expect(sec).toContain('新高亮');
        expect(sec).toContain('旧高亮');
        expect(sec).toContain('^hl0');
    });

    it('removeExcerptBlock 按 ^hl id 删除高亮块（同一函数，id 无关区标题）', () => {
        const note = [
            `## ${SECT}`,
            '',
            '> 删我',
            '^hlAAA',
            '',
            '> 留我',
            '^hlBBB',
            '',
            '## 摘抄',
            '',
            '> 摘',
            '^bk1',
        ].join('\n');
        const final = removeExcerptBlock(note, 'hlAAA');
        expect(final).not.toContain('删我');
        expect(final).not.toContain('^hlAAA');
        expect(final).toContain('留我');
        expect(final).toContain('^hlBBB');
        // 摘抄区不受影响
        expect(final).toContain('^bk1');
    });
});

describe('pure/highlight findQuoteSegment', () => {
    it('普通命中：返回原文偏移', () => {
        expect(findQuoteSegment('今天天气真好', '天气')).toEqual({ start: 2, end: 4 });
    });
    it('忽略空白差异（段落含换行/空格，quote 紧凑或反之）', () => {
        expect(findQuoteSegment('第一行\n第二行内容', '第一行第二行')).toEqual({ start: 0, end: 7 });
    });
    it('quote 含多余空格也能命中紧凑文本', () => {
        expect(findQuoteSegment('天地玄黄宇宙洪荒', '玄 黄')).toEqual({ start: 2, end: 4 });
    });
    it('多词命中：取首个命中位置', () => {
        expect(findQuoteSegment('重复重复再重复', '重复')).toEqual({ start: 0, end: 2 });
    });
    it('英文连续词无空格匹配', () => {
        expect(findQuoteSegment('The quick brown fox', 'quick brown')).toEqual({ start: 4, end: 15 });
    });
    it('无命中 → null', () => {
        expect(findQuoteSegment('天地玄黄', '洪荒')).toBeNull();
    });
    it('空 text / 纯空白 quote → null', () => {
        expect(findQuoteSegment('', 'x')).toBeNull();
        expect(findQuoteSegment('正文', '   ')).toBeNull();
    });
});

describe('pure/highlight annotate toggle', () => {
    const base = [
        { quote: '第一段文字内容', id: 'hla', loc: { chapter: 1, pct: 10 } },
        { quote: '第二段', id: 'hlb', loc: { chapter: 2, pct: 5 } },
    ];
    it('normText 去空白', () => {
        expect(normText(' 第一 段\n文字\t内容 ')).toBe('第一段文字内容');
    });
    it('findSameHighlight 同章同 quote 命中', () => {
        const r = findSameHighlight(base, '第一段文字内容', 1);
        expect(r?.id).toBe('hla');
    });
    it('findSameHighlight 忽略空白差异命中', () => {
        expect(findSameHighlight(base, '第一 段文 字内容', 1)?.id).toBe('hla');
    });
    it('findSameHighlight 跨章不算同一段（各章独立）', () => {
        expect(findSameHighlight(base, '第二段', 1)).toBeNull();
        expect(findSameHighlight(base, '第二段', 2)?.id).toBe('hlb');
    });
    it('findSameHighlight 无命中 → null', () => {
        expect(findSameHighlight(base, '别的文字', 1)).toBeNull();
    });
    it('decideHighlightToggle 已高亮 → remove', () => {
        const r = decideHighlightToggle(base, '第一段 文字内容', { chapter: 1, pct: 20 });
        expect(r.action).toBe('remove');
        if (r.action === 'remove') expect(r.id).toBe('hla');
    });
    it('decideHighlightToggle 未高亮 → add', () => {
        const r = decideHighlightToggle(base, '全新段落', { chapter: 1, pct: 30 });
        expect(r.action).toBe('add');
        if (r.action === 'add') expect(r.add.quote).toBe('全新段落');
    });
    it('decideHighlightToggle 命中同文本但缺块 id（老数据/手写笔记）→ blocked，不得退化成重复新增', () => {
        const mdNoId = ['## ' + SECT, '', '> 第一段 文字内容', '', '定位：1:20'].join('\n');
        const list = parseHighlightBlocks(mdNoId);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBeUndefined();
        const r = decideHighlightToggle(list, '第一段 文字内容', { chapter: 1, pct: 20 });
        expect(r.action).toBe('blocked');
    });
});

describe('pure/highlight markParagraphHtml（段落重绘：TXT 与 EPUB 共用）', () => {
    const hl = (quote: string, extra: Partial<ReaderHighlight> = {}): ReaderHighlight => ({ quote, ...extra });
    const para = '他抬头看了看天。天色渐晚，风也凉了下来。';

    it('命中 → 生成带 data-hl-id / 样式 / 颜色的 <mark>，区间外文字原样保留', () => {
        const html = markParagraphHtml(para, [hl('天色渐晚', { id: 'hlA', style: 'wavy', color: 'blue' })], false);
        expect(html).toBe(
            '他抬头看了看天。' +
                '<mark class="rl-hl-persist" data-hl-id="hlA" data-style="wavy" data-color="blue">天色渐晚</mark>' +
                '，风也凉了下来。',
        );
    });

    it('未给样式/颜色 → 落默认档（hl / yellow）；缺 id → 不写 data-hl-id', () => {
        const html = markParagraphHtml(para, [hl('天色渐晚')], false);
        expect(html).toContain('data-style="hl" data-color="yellow"');
        expect(html).not.toContain('data-hl-id');
    });

    it('同段两条命中 → 两个 mark（按原文顺序，不嵌套）', () => {
        const html = markParagraphHtml(para, [hl('风也凉了下来', { id: 'hlB' }), hl('他抬头', { id: 'hlA' })], false)!;
        expect((html.match(/<mark /g) || []).length).toBe(2);
        expect(html.indexOf('hlA')).toBeLessThan(html.indexOf('hlB'));
    });

    it('HTML 特殊字符按文本转义（不把段落里的尖括号当标签）', () => {
        const html = markParagraphHtml('a < b & c > d', [hl('b & c')], false)!;
        expect(html).toBe('a &lt; <mark class="rl-hl-persist" data-style="hl" data-color="yellow">b &amp; c</mark> &gt; d');
    });

    it('无命中 + 段内没有旧 mark → null（调用方不动该段，避免无谓重排）', () => {
        expect(markParagraphHtml(para, [hl('并不存在的一句')], false)).toBe(null);
        expect(markParagraphHtml(para, [], false)).toBe(null);
    });

    it('🔴 无命中 + 段内有旧 mark → 摊平回纯文本（删掉的高亮不得留在屏幕上）', () => {
        expect(markParagraphHtml(para, [hl('并不存在的一句')], true)).toBe(para);
        expect(markParagraphHtml(para, [], true)).toBe(para);
        // 删空本章（hls 为空）与「本段不再命中」必须同口径
        expect(markParagraphHtml(para, [], true)).toBe(markParagraphHtml(para, [], true));
    });

    it('段落已被转义的内容也会被摊平（残留 mark 里含实体时不能越摊越乱）', () => {
        const withMark = 'a &lt; <mark class="rl-hl-persist" data-hl-id="hlZ">b</mark> &gt; c';
        expect(markParagraphHtml('a < b > c', [], true)).toBe('a &lt; b &gt; c');
        expect(withMark).toContain('<mark'); // 调用方据此判 hasStaleMark
    });
});

describe('pure/highlight hlMarkTargetOf（选段是否落在高亮 mark 上 → 动作条垃圾桶显隐）', () => {
    const mkMark = (id: string | null, text = '被高亮的句子') => ({
        getAttribute: (n: string) => (n === 'data-hl-id' ? id : null),
        textContent: text,
    });
    type Host = ReturnType<typeof mkMark>;
    const el = (mk: Host | null) => ({ nodeType: 1, closest: (sel: string) => (sel === 'mark.rl-hl-persist' ? mk : null) });
    const txt = (parent: unknown) => ({ nodeType: 3, parentElement: parent });
    const asNode = (x: unknown) => x as Node;

    it('起点落在 mark 上 → 取到块 id 与引用文本', () => {
        expect(hlMarkTargetOf(asNode(el(mkMark('hlA'))))).toEqual({ id: 'hlA', quote: '被高亮的句子' });
    });

    it('起点不在、终点在 → 仍算命中（选区跨到 mark 里）', () => {
        const t = hlMarkTargetOf(asNode(el(null)), asNode(el(mkMark('hlB'))));
        expect(t).toEqual({ id: 'hlB', quote: '被高亮的句子' });
    });

    it('🔴 两端都不在 mark 上 → null（= 选中的文字没有高亮样式，垃圾桶不得出现）', () => {
        expect(hlMarkTargetOf(asNode(el(null)), asNode(el(null)))).toBe(null);
        expect(hlMarkTargetOf(asNode(txt(el(null))))).toBe(null);
    });

    it('mark 缺 data-hl-id → id 为空串（调用方据 quote 兜底删，不能当成「没样式」）', () => {
        expect(hlMarkTargetOf(asNode(el(mkMark(null))))).toEqual({ id: '', quote: '被高亮的句子' });
    });

    it('文本节点走 parentElement；两端各在一条 mark 上时取先给的（起点侧）', () => {
        expect(hlMarkTargetOf(asNode(txt(el(mkMark('hlTxt')))))).toEqual({ id: 'hlTxt', quote: '被高亮的句子' });
        const both = hlMarkTargetOf(asNode(el(mkMark('hlA'))), asNode(el(mkMark('hlB'))));
        expect(both?.id).toBe('hlA');
    });

    it('null / undefined 入参安全；mark 文本两端空白被去掉', () => {
        expect(hlMarkTargetOf(null, undefined)).toBe(null);
        expect(hlMarkTargetOf(asNode(el(mkMark('hlC', '  句子  '))))?.quote).toBe('句子');
    });
});

describe('renderHighlightMirror 只读镜像（2026-09-18：高亮真源移到 JSON 后，笔记里那份由 JSON 单向生成）', () => {
    it('无高亮 → 空串（调用方据此把整区删掉，不留空标题）', () => {
        expect(renderHighlightMirror([])).toBe('');
        expect(renderHighlightMirror([{ quote: '   ' }])).toBe('');
    });

    it('首行是自动生成提示（%% 注释），其后逐条 callout 块', () => {
        const md = renderHighlightMirror([{ quote: '应无所住而生其心', id: 'hlAAA', loc: { chapter: 1, pct: 3 } }]);
        expect(md.split('\n')[0]).toBe(HL_MIRROR_NOTICE);
        expect(md).toContain('> [!quote|yellow] ');
        expect(md).toContain('应无所住而生其心');
        expect(md.trimEnd().endsWith('^hlAAA') || md.includes('#^hlAAA')).toBe(true);
    });

    it('🔴 镜像 ↔ 解析往返：条数不丢不增（提示行不得被当成一条高亮）', () => {
        const src: ReaderHighlight[] = [
            { quote: '甲', id: 'hlA', loc: { chapter: 1, pct: 10 }, style: 'wavy', color: 'green' },
            { quote: '乙', id: 'hlB', loc: { chapter: 2, pct: 0 } },
        ];
        const md = ['## ' + HIGHLIGHT_SECTION, '', renderHighlightMirror(src)].join('\n');
        const back = parseHighlightBlocks(md);
        expect(back.map((x) => x.id)).toEqual(['hlA', 'hlB']);
        expect(back.map((x) => x.quote)).toEqual(['甲', '乙']);
        expect(back[0].loc).toEqual({ chapter: 1, pct: 10 });
        expect(back[0].style).toBe('wavy');
        expect(back[0].color).toBe('green');
        expect(back[1].style).toBe('hl'); // 缺省档位由解析端补
        expect(back[1].color).toBe('yellow');
    });

    it('手改/脏 JSON 来的无 loc 高亮：标签只写「高亮」，不编造「第 1 章」', () => {
        const md = renderHighlightMirror([{ quote: '没有定位的一句', id: 'hlNoLoc' }]);
        expect(md).toContain('没有定位的一句');
        expect(md).not.toContain('第 1 章');
        expect(md.split('\n')[2]).toBe('> [!quote|yellow] 高亮'); // 无 refLink 时头行只写标签
    });

    it('提示行本身不被迁移解析当成高亮（否则「删 JSON 再迁移」会把它搬进去）', () => {
        expect(parseHighlightBlocks(['## ' + HIGHLIGHT_SECTION, '', HL_MIRROR_NOTICE].join('\n'))).toEqual([]);
    });
});
