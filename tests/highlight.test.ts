// 阅读器高亮纯逻辑测试（无 obsidian 依赖）：笔记「## 高亮」区解析/渲染/章节过滤；
// 追加/删除复用 pure/excerpt（section='高亮'）已在 excerpt.test 覆盖，此处验证 highight 封装与该区行为。
import { describe, it, expect } from 'vitest';
import {
    parseHighlightBlocks,
    chapterHighlights,
    renderHighlightBlock,
    findQuoteSegment,
    findSameHighlight,
    decideHighlightToggle,
    normText,
    HIGHLIGHT_SECTION,
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
    it('renderHighlightBlock 生成 blockquote + 定位 + ^hl 块 id（不含 ^ 存 id）', () => {
        const md = renderHighlightBlock('高亮内容', { chapter: 2, pct: 45 });
        expect(md).toContain('> 高亮内容');
        expect(md).toContain('定位：2:45');
        expect(md).toMatch(/\^hl[a-z0-9]+$/);
        expect(md).toMatch(/\^hl[a-z0-9]+$/);
    });
    it('空引用 → 空串（不该追加）', () => {
        expect(renderHighlightBlock('   ', { chapter: 1, pct: 0 })).toBe('');
    });

    it('追加高亮到尚无高亮区的笔记 → 新建「## 高亮」区（不碰摘抄区）', () => {
        const note = '# 书\n\n正文\n\n## 摘抄\n\n> 摘\n^bk1';
        const hlMd = renderHighlightBlock('新高亮', { chapter: 1, pct: 50 });
        const final = appendExcerptToNote(note, hlMd, SECT);
        // 高亮区出现、含新块；摘抄区仍在
        const sec = extractExcerptSection(final, SECT);
        expect(sec).toContain('新高亮');
        expect(sec).toContain('定位：1:50');
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
});
