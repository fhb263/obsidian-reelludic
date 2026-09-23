import { describe, it, expect } from 'vitest';
import {
    generateBlockId,
    parseExcerptBlock,
    parseExcerptBlocks,
    extractExcerptSection,
    countExcerpts,
    renderExcerptBlock,
    mergeExcerptSection,
    appendExcerptToNote,
    removeExcerptBlock,
    extractAnnotationSections,
    replaceAnnotationSection,
    type ParsedExcerpt,
} from 'pure/excerpt';

describe('pure/excerpt generateBlockId', () => {
    it('生成格式为 bk + 字母数字', () => {
        expect(generateBlockId()).toMatch(/^bk[a-z0-9]+$/);
    });

    it('两次生成不同（唯一性）', () => {
        expect(generateBlockId()).not.toBe(generateBlockId());
    });

    it('长度足够且稳定（>10 位）', () => {
        const id = generateBlockId();
        expect(id.length).toBeGreaterThan(10);
        expect(generateBlockId('ex')).toMatch(/^ex[a-z0-9]+$/);
    });
});

describe('pure/excerpt parseExcerptBlock', () => {
    it('完整块：引用/页码/心得/块 id 全部提取', () => {
        const md = [
            '> 所谓「比较优势」，不是说你比所有人都强。',
            '',
            '**p.128** · 心得：地方政府的激励结构',
            '^bk001a',
        ].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.quote).toBe('所谓「比较优势」，不是说你比所有人都强。');
        expect(r.page).toBe(128);
        expect(r.note).toBe('地方政府的激励结构');
        expect(r.id).toBe('bk001a');
    });

    it('多行引用合并为一行文本', () => {
        const md = ['> 第一行', '> 第二行', '', '**p.55**', '^bk001b'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.quote).toBe('第一行\n第二行');
        expect(r.page).toBe(55);
    });

    it('无页码时 page 为 undefined', () => {
        const md = ['> 引用文本', '', '心得：没有页码', '^bk001c'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.quote).toBe('引用文本');
        expect(r.page).toBeUndefined();
        expect(r.note).toBe('没有页码');
    });

    it('无心得时 note 为 undefined', () => {
        const md = ['> 引用文本', '', '**p.10**', '^bk001d'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.note).toBeUndefined();
        expect(r.page).toBe(10);
    });

    it('无块 id 时 id 为 undefined', () => {
        const md = ['> 引用文本', '', '**p.10**'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.id).toBeUndefined();
    });

    it('页码变体「第128页」也解析', () => {
        const r = parseExcerptBlock('> 引用\n\n**第128页** · 心得：x\n^bk1');
        expect(r.page).toBe(128);
    });

    it('空输入返回空对象', () => {
        const r = parseExcerptBlock('');
        expect(r.quote).toBe('');
        expect(r.page).toBeUndefined();
        expect(r.note).toBeUndefined();
        expect(r.id).toBeUndefined();
    });

    it('带定位「定位：1:42」提取 loc', () => {
        const md = ['> 引用文本', '', '**p.128** · 心得：x · 定位：1:42', '^bk001e'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.loc).toEqual({ chapter: 1, pct: 42 });
    });

    it('仅定位无页码/心得：meta 行只含定位', () => {
        const r = parseExcerptBlock(['> 引用', '', '定位：3:10', '^bk001f'].join('\n'));
        expect(r.loc).toEqual({ chapter: 3, pct: 10 });
        expect(r.page).toBeUndefined();
        expect(r.note).toBeUndefined();
    });

    it('旧块无定位 → loc undefined', () => {
        const r = parseExcerptBlock(['> 引用', '', '**p.10** · 心得：x', '^bk001g'].join('\n'));
        expect(r.loc).toBeUndefined();
    });

    it('定位 pct 越界钳制 0-100、chapter 最小 1', () => {
        expect(parseExcerptBlock('> 引用\n\n定位：2:150\n^bk1').loc).toEqual({ chapter: 2, pct: 100 });
        expect(parseExcerptBlock('> 引用\n\n定位：0:50\n^bk1').loc).toEqual({ chapter: 1, pct: 50 });
    });

    // 原文「仅加粗」（有评语时的渲染形态）→ 解析必须剥掉外层星号，
    // 否则阅读器侧栏列表会把 `**` 原样显示出来（用的是 truncateQuote(ex.quote) 纯文本）。
    it('原文行的外层加粗被剥掉（有评语的摘抄）', () => {
        const b = parseExcerptBlock(['> [!quote|yellow] 第 1 章', '> **原文一行**', '> ---', '> 评语'].join('\n'));
        expect(b.quote).toBe('原文一行');
        expect(b.note).toBe('评语');
    });

    it('只剥一层外层加粗：原文内部自带的加粗保留', () => {
        const b = parseExcerptBlock(['> [!quote|yellow] 第 1 章', '> **他说**很重要**吗**', '> ---', '> x'].join('\n'));
        expect(b.quote).toBe('他说**很重要**吗');
    });

    it('无评语（原文不加粗）与旧块照常解析', () => {
        expect(parseExcerptBlock(['> [!quote|yellow] 第 1 章', '> 原文', ''].join('\n')).quote).toBe('原文');
        expect(parseExcerptBlock(['> 引用', '', '**p.10** · 心得：x', '^bk001g'].join('\n')).quote).toBe('引用');
    });

    // 「回到原文」深链（2026-09-19）—— 解析端必须把它从头行剥掉，
    // 否则「头行无 wikilink」时会走 `label = title`，把 `[↩](obsidian://…)` 整段吃进标签。
    it('头行尾部的 ↩ 深链被剥掉、不进标签（无 wikilink 时尤其重要）', () => {
        const b = parseExcerptBlock('> [!quote|yellow] 第 2 章 [↩](obsidian://reelludic?action=jump&book=e_123&block=bk001a)\n> 原文');
        expect(b.label).toBe('第 2 章');
        expect(b.quote).toBe('原文');
    });

    it('有 wikilink 时 ↩ 也不影响 refLink / 标签 / 样式尾段', () => {
        const b = parseExcerptBlock(
            '> [!quote|green] [[书.epub#^hl1|第 3 章 · 10% · 划线]] [↩](obsidian://reelludic?action=jump&book=e_1&block=hl1)\n> 引用',
        );
        expect(b.refLink).toBe('书.epub');
        expect(b.label).toBe('第 3 章 · 10% · 划线');
        expect(b.style).toBe('划线');
    });

    it('🔴 只剥本插件的深链：头行里的普通 markdown 链接保持原样', () => {
        const c = parseExcerptBlock('> [!quote|yellow] 第 9 章 [链接](https://example.com)\n> 原文');
        expect(c.label).toBe('第 9 章 [链接](https://example.com)');
        // 别的 obsidian 动作同样不动
        const d = parseExcerptBlock('> [!quote|yellow] 第 9 章 [开笔记](obsidian://open?vault=v&file=x)\n> 原文');
        expect(d.label).toBe('第 9 章 [开笔记](obsidian://open?vault=v&file=x)');
    });

    it('往返：渲染 → 解析 后 label/refLink/quote 都不受 ↩ 影响', () => {
        const md = renderExcerptBlock({ quote: '原文', note: '想法', loc: { chapter: 6, pct: 4 }, id: 'bk001a' }, { callout: true, refLink: '书.epub', entryId: 'e_123' });
        const b = parseExcerptBlock(md);
        expect(b.label).toBe('第 6 章 · 4%');
        expect(b.refLink).toBe('书.epub');
        expect(b.quote).toBe('原文');
        expect(b.note).toBe('想法');
        expect(b.id).toBe('bk001a');
    });
});

describe('pure/excerpt extractExcerptSection', () => {
    const note = [
        '---',
        'type: book',
        '---',
        '',
        '# 《置身事内》',
        '',
        '> [!bookinfo]+ **《置身事内》**',
        '',
        '## 个人评语',
        '',
        '土地财政……',
        '',
        '## 摘抄',
        '',
        '> 引用一',
        '',
        '**p.128** · 心得：x',
        '^bk001a',
        '',
        '> 引用二',
        '',
        '**p.203**',
        '^bk001b',
        '',
        '## 相关链接',
        '',
        '- [豆瓣](https://)',
    ].join('\n');

    it('有摘抄区时返回标题后内容（不含后续章节）', () => {
        const sec = extractExcerptSection(note);
        expect(sec).toContain('> 引用一');
        expect(sec).toContain('^bk001b');
        expect(sec).not.toContain('## 相关链接');
        expect(sec).not.toContain('土地财政');
    });

    it('无摘抄区返回 undefined', () => {
        const plain = '# 标题\n\n正文\n';
        expect(extractExcerptSection(plain)).toBeUndefined();
    });

    it('摘抄区在文件末尾（后面无章节）也能提取', () => {
        const tail = note.replace('\n## 相关链接\n\n- [豆瓣](https://)', '');
        const sec = extractExcerptSection(tail);
        expect(sec).toContain('^bk001b');
    });

    it('空文件返回 undefined', () => {
        expect(extractExcerptSection('')).toBeUndefined();
    });
});

describe('pure/excerpt countExcerpts', () => {
    it('统计摘抄区块 id 数量', () => {
        const md = [
            '## 摘抄',
            '',
            '> 引用一',
            '^bk001a',
            '',
            '> 引用二',
            '^bk001b',
        ].join('\n');
        expect(countExcerpts(md)).toBe(2);
    });

    it('无摘抄区返回 0', () => {
        expect(countExcerpts('# 标题\n正文')).toBe(0);
    });

    it('摘抄区外部的 ^id 不计入', () => {
        const md = [
            '## 个人评语',
            '',
            '^xx001',
            '',
            '## 摘抄',
            '',
            '> 引用',
            '^bk001a',
        ].join('\n');
        expect(countExcerpts(md)).toBe(1);
    });
});

describe('pure/excerpt renderExcerptBlock', () => {
    it('完整渲染（引用/页码/心得/id）', () => {
        const block: ParsedExcerpt = { quote: '引用文本', page: 128, note: '心得x', id: 'bk001a' };
        const md = renderExcerptBlock(block);
        expect(md).toContain('> 引用文本');
        expect(md).toContain('**p.128**');
        expect(md).toContain('心得：心得x');
        expect(md).toContain('^bk001a');
    });

    it('无页码/心得时省略对应行', () => {
        const md = renderExcerptBlock({ quote: '仅引用', id: 'bk001b' });
        expect(md).toContain('> 仅引用');
        expect(md).toContain('^bk001b');
        expect(md).not.toContain('p.');
        expect(md).not.toContain('心得');
    });

    it('缺 id 时由 generateBlockId 补全', () => {
        const md = renderExcerptBlock({ quote: '引用' });
        expect(md).toMatch(/\^bk[a-z0-9]+/);
    });

    it('带 loc 渲染「· 定位：N:N」到 meta 行', () => {
        const md = renderExcerptBlock({ quote: '引用', page: 128, note: 'x', loc: { chapter: 1, pct: 42 }, id: 'bk001a' });
        expect(md).toContain('定位：1:42');
    });

    it('仅 loc 无 page/note 时 meta 行只含定位', () => {
        const md = renderExcerptBlock({ quote: '引用', loc: { chapter: 3, pct: 10 }, id: 'bk001b' });
        expect(md).toContain('定位：3:10');
        expect(md).not.toContain('p.');
        expect(md).not.toContain('心得');
    });

    it('无 loc 不渲染定位', () => {
        const md = renderExcerptBlock({ quote: '引用', id: 'bk001c' });
        expect(md).not.toContain('定位');
    });
});

describe('pure/excerpt mergeExcerptSection 合并写入', () => {
    const template = [
        '> [!bookinfo]+ **《置身事内》**',
        '',
        '| 属性 | 内容 |',
        '|:-----|:-----|',
        '| 类型 | 书籍 |',
        '',
        '## 个人评语',
        '',
        '土地财政……',
        '',
        '## 相关链接',
        '',
        '- [豆瓣](https://)',
        '',
    ].join('\n');
    const excerpt = ['> 引用一', '', '**p.128** · 心得：x', '^bk001a'].join('\n');

    it('插到「相关链接」章节之前', () => {
        const md = mergeExcerptSection(template, excerpt);
        expect(md).toContain('## 摘抄');
        expect(md.indexOf('## 摘抄')).toBeLessThan(md.indexOf('## 相关链接'));
        expect(md).toContain('^bk001a');
        expect(md.indexOf('^bk001a')).toBeLessThan(md.indexOf('## 相关链接'));
        expect(md).toContain('## 个人评语');
    });

    it('「观看链接」变体同样插前', () => {
        const t = template.replace('## 相关链接', '## 观看链接');
        const md = mergeExcerptSection(t, excerpt);
        expect(md.indexOf('## 摘抄')).toBeLessThan(md.indexOf('## 观看链接'));
    });

    it('模板无链接章节时追加到末尾', () => {
        const t = template.replace('\n## 相关链接\n\n- [豆瓣](https://)', '');
        const md = mergeExcerptSection(t, excerpt);
        expect(md.trimEnd().endsWith('## 摘抄\n\n> 引用一\n\n**p.128** · 心得：x\n^bk001a')).toBe(true);
    });

    it('空摘抄区返回模板原样', () => {
        expect(mergeExcerptSection(template, '')).toBe(template);
        expect(mergeExcerptSection(template, '   ')).toBe(template);
    });
});

describe('pure/excerpt appendExcerptToNote 追加摘抄', () => {
    const noteBase = [
        '> [!bookinfo]+ **《置身事内》**',
        '',
        '| 属性 | 内容 |',
        '',
        '## 个人评语',
        '',
        '土地财政……',
        '',
        '## 相关链接',
        '',
        '- [豆瓣](https://)',
        '',
    ].join('\n');
    const block1 = '> 引用一\n\n**p.128** · 心得：x\n^bk001a';
    const block2 = '> 引用二\n\n**p.203**\n^bk001b';

    it('无摘抄区时插入到链接章节之前', () => {
        const md = appendExcerptToNote(noteBase, block1);
        expect(md.indexOf('## 摘抄')).toBeGreaterThan(md.indexOf('## 个人评语'));
        expect(md.indexOf('## 摘抄')).toBeLessThan(md.indexOf('## 相关链接'));
        expect(md).toContain('^bk001a');
        expect(countExcerpts(md)).toBe(1);
    });

    it('已有摘抄区时追加到区内（原块保留）', () => {
        const withOne = appendExcerptToNote(noteBase, block1);
        const md = appendExcerptToNote(withOne, block2);
        expect(md).toContain('^bk001a');
        expect(md).toContain('^bk001b');
        expect(countExcerpts(md)).toBe(2);
        expect(md.indexOf('^bk001a')).toBeLessThan(md.indexOf('^bk001b'));
    });

    it('摘抄区在文件末尾（无链接章节）也能追加', () => {
        const tail = noteBase.replace('\n## 相关链接\n\n- [豆瓣](https://)', '');
        const md = appendExcerptToNote(tail, block1);
        expect(md).toContain('^bk001a');
        expect(countExcerpts(md)).toBe(1);
    });

    it('空摘抄内容返回原笔记', () => {
        expect(appendExcerptToNote(noteBase, '   ')).toBe(noteBase);
    });
});

describe('pure/excerpt removeExcerptBlock 删除单个摘抄块', () => {
    const note = [
        '## 个人评语',
        '',
        '土地财政……',
        '',
        '## 摘抄',
        '',
        '> 引用一',
        '',
        '**p.128** · 心得：x',
        '^bk001a',
        '',
        '> 引用二',
        '',
        '**p.203**',
        '^bk001b',
        '',
        '> 引用三',
        '',
        '**p.55** · 定位：1:42',
        '^bk001c',
        '',
        '## 相关链接',
        '',
        '- [豆瓣](https://)',
    ].join('\n');

    it('删除中间块：只移除目标块，其余块与章节保留', () => {
        const md = removeExcerptBlock(note, 'bk001b');
        expect(md).toContain('^bk001a');
        expect(md).not.toContain('^bk001b');
        expect(md).toContain('^bk001c');
        expect(md).toContain('## 相关链接');
        expect(md).toContain('## 个人评语');
        expect(countExcerpts(md)).toBe(2);
    });

    it('带 ^ 前缀的 id 同样匹配', () => {
        const md = removeExcerptBlock(note, '^bk001a');
        expect(md).not.toContain('^bk001a');
        expect(md).toContain('^bk001b');
        expect(countExcerpts(md)).toBe(2);
    });

    it('删除末尾块', () => {
        const md = removeExcerptBlock(note, 'bk001c');
        expect(md).toContain('^bk001b');
        expect(md).not.toContain('^bk001c');
        expect(countExcerpts(md)).toBe(2);
    });

    it('块不存在返回原样', () => {
        expect(removeExcerptBlock(note, 'bk999')).toBe(note);
    });

    it('空 id / 空笔记返回原样', () => {
        expect(removeExcerptBlock(note, '')).toBe(note);
        expect(removeExcerptBlock('', 'bk001a')).toBe('');
    });

    it('删除唯一摘抄后 count 为 0', () => {
        const single = ['## 摘抄', '', '> 引用', '', '^bk001a'].join('\n');
        const md = removeExcerptBlock(single, 'bk001a');
        expect(countExcerpts(md)).toBe(0);
    });
});

// ── callout 摘抄格式（2026-09-17 用户指定的新格式；类型固定内置 quote、分隔用真水平线）──
describe('pure/excerpt callout 摘抄块（renderExcerptBlock callout:true）', () => {
    it('完整渲染：头行链接（内置类型/源文件/块锚点/标签）+ 摘录 + 水平线 + 想法', () => {
        const md = renderExcerptBlock(
            { quote: '但实际上，这些样子', note: '111', loc: { chapter: 6, pct: 11 }, id: 'bkmu5c05' },
            { callout: true, refLink: '书籍/活着.txt' },
        );
        expect(md).toBe(
            [
                '> [!quote] [[书籍/活着.txt#^bkmu5c05|第 6 章 · 11%]]',
                // 有想法 → 原文仅加粗（用户 2026-09-19）
                '> **但实际上，这些样子**',
                // 🔴 分隔符是 `***` 不是 `---`：`---` 紧跟在文字行后会触发 setext 二级标题（用户 2026-09-19 截图抓出的 bug）
                '> ***',
                '> 111',
            ].join('\n'),
        );
    });

    it('无想法时不出分隔行与想法行', () => {
        const md = renderExcerptBlock({ quote: '只摘不评', loc: { chapter: 2, pct: 0 }, id: 'bk001a' }, { callout: true, refLink: '书.epub' });
        expect(md).toBe(['> [!quote] [[书.epub#^bk001a|第 2 章]]', '> 只摘不评'].join('\n'));
        expect(md).not.toContain('***');
    });

    it('pct 为 0 时标签不带百分比', () => {
        const md = renderExcerptBlock({ quote: 'q', loc: { chapter: 3, pct: 0 }, id: 'bk001a' }, { callout: true, refLink: 'a.txt' });
        expect(md).toContain('[[a.txt#^bk001a|第 3 章]]');
    });

    it('多行摘录与多行想法逐行加引用前缀', () => {
        const md = renderExcerptBlock(
            { quote: '第一行\n第二行', note: '想法一\n想法二', loc: { chapter: 1, pct: 5 }, id: 'bk001a' },
            { callout: true },
        );
        expect(md).toContain('> **第一行**\n> **第二行**\n> ***\n> 想法一\n> 想法二');
    });

    // ── 分隔符必须是 `***`（用户 2026-09-19 裁定 D-1 Ⓐ）──
    // 起因：`> ---` 紧跟在文字行后面会触发 CommonMark 的 **setext 规则** → 原文整段被渲染成 <h2>
    //       （变大变粗、显主题标题色），而 `---` 作为标题下划线被吃掉 → **分隔线根本不出现**。
    //       `***` 是 thematic break，不会触发 setext。用户截图实测抓出，旧块保持原样不迁移（D-2）。
    it('🔴 分隔符写 `***`、不再写 `---`（`---` 会把原文变成大标题）', () => {
        const md = renderExcerptBlock({ quote: '原文', note: '想法', loc: { chapter: 1, pct: 5 }, id: 'bk001a' }, { callout: true });
        expect(md).toContain('\n> ***\n');
        expect(md).not.toContain('\n> ---\n');
    });

    it('历史 `---` 分隔符仍能解析（旧块不迁移，照旧读得出想法）', () => {
        const r = parseExcerptBlock(['> [!quote|yellow] 第 1 章', '> 原文', '> ---', '> 想法'].join('\n'));
        expect(r.quote).toBe('原文');
        expect(r.note).toBe('想法');
    });

    // ── 配色段：摘抄不带（跟随主题，用户裁定 D-4）；高亮块必须带（「按色渲染」靠它）──
    it('摘抄不写配色段（`[!quote]` 随主题）；显式给色名才写 —— 高亮块不受影响', () => {
        const plain = renderExcerptBlock({ quote: 'q', id: 'bk001a' }, { callout: true });
        expect(plain.startsWith('> [!quote] ')).toBe(true);
        const colored = renderExcerptBlock({ quote: 'q', id: 'hl001a' }, { callout: true, calloutColor: 'green' });
        expect(colored.startsWith('> [!quote|green] ')).toBe(true);
    });

    // ── 有评语的摘抄：原文「仅加粗」（用户 2026-09-19 裁定方案 1）──
    // 目的：原文与评语一眼分得开（此前两者都是普通段落，看不出哪行是书里的、哪行是自己写的）。
    it('有想法时原文逐行加粗；无想法时原文保持原样（不加任何标记）', () => {
        const withIdea = renderExcerptBlock({ quote: '原文', note: '评语', loc: { chapter: 2, pct: 0 }, id: 'bk001a' }, { callout: true });
        expect(withIdea).toContain('> **原文**');
        const noIdea = renderExcerptBlock({ quote: '原文', loc: { chapter: 2, pct: 0 }, id: 'bk001a' }, { callout: true });
        expect(noIdea).toContain('> 原文');
        expect(noIdea).not.toContain('**');
    });

    it('只动原文那一侧：评语里自带的加粗原样保留', () => {
        const md = renderExcerptBlock({ quote: '原文', note: '**重点**', loc: { chapter: 1, pct: 0 }, id: 'bk001a' }, { callout: true, refLink: 'a.txt' });
        expect(md).toContain('> **原文**');
        expect(md.endsWith('> **重点**')).toBe(true);
    });

    it('原文已是整行加粗时不叠加星号（幂等，防出 `****`）', () => {
        const md = renderExcerptBlock({ quote: '**原文**', note: '评语', loc: { chapter: 1, pct: 0 }, id: 'bk001a' }, { callout: true });
        expect(md).toContain('> **原文**');
        expect(md).not.toContain('****');
    });

    it('空行不包成 `> ****`（多行原文里的空行原样留 `>`）', () => {
        const md = renderExcerptBlock({ quote: '上\n\n下', note: '评语', loc: { chapter: 1, pct: 0 }, id: 'bk001a' }, { callout: true });
        expect(md).not.toContain('****');
        expect(md).toContain('> **上**');
        expect(md).toContain('> **下**');
    });

    it('往返：渲染 → 解析 得到同一份原文与评语（原文的外层加粗被剥掉）', () => {
        const src = { quote: '第一行\n第二行', note: '我的想法', loc: { chapter: 3, pct: 12 }, id: 'bk001a' };
        const b = parseExcerptBlock(renderExcerptBlock(src, { callout: true }));
        expect(b.quote).toBe('第一行\n第二行');
        expect(b.note).toBe('我的想法');
    });

    // ── 「回到原文」深链（用户 2026-09-19 裁定方案 A：双轨 —— wikilink 保留 + 追加 ↩）──
    const DL = 'obsidian://reelludic?action=jump&book=e_123&block=bk001a';

    it('给了 entryId → 头行尾追加 ↩ 深链（wikilink 一并保留）', () => {
        const md = renderExcerptBlock(
            { quote: 'q', note: 'n', loc: { chapter: 6, pct: 4 }, id: 'bk001a' },
            { callout: true, refLink: '书.epub', entryId: 'e_123' },
        );
        expect(md.split('\n')[0]).toBe(`> [!quote] [[书.epub#^bk001a|第 6 章 · 4%]] [↩ 回到原文](${DL})`);
    });

    it('🔴 无 wikilink（库外书）时只剩 ↩ —— 这正是本次要治的断点', () => {
        const md = renderExcerptBlock({ quote: 'q', loc: { chapter: 2, pct: 0 }, id: 'bk001a' }, { callout: true, entryId: 'e_123' });
        expect(md.split('\n')[0]).toBe(`> [!quote] 第 2 章 [↩ 回到原文](${DL})`);
    });

    it('没给 entryId → 不出现 ↩（高亮块与旧调用方行为不变）', () => {
        expect(renderExcerptBlock({ quote: 'q', id: 'bk001a' }, { callout: true })).not.toContain('↩');
        expect(renderExcerptBlock({ quote: 'q', id: 'bk001a' }, { callout: true, refLink: 'a.txt' })).not.toContain('↩');
    });

    // ⚠️ D-3 把文案从 `↩` 换成 `↩ 回到原文` → stripBackLink 的 `[^\]]{0,16}` 必须仍容得下，
    //    且必须**先剥再匹配 wikilink**（否则带 wikilink 时尾部链接会被吃进别名）。
    it('往返：带「↩ 回到原文」深链的头行，解析后标签与 wikilink 都不被污染', () => {
        const noRef = parseExcerptBlock(renderExcerptBlock({ quote: 'q', loc: { chapter: 6, pct: 4 }, id: 'bk001a' }, { callout: true, entryId: 'e_123' }));
        expect(noRef.label).toBe('第 6 章 · 4%');
        expect(noRef.id).toBe('bk001a');
        expect(noRef.quote).toBe('q');

        const withRef = parseExcerptBlock(
            renderExcerptBlock({ quote: 'q', loc: { chapter: 6, pct: 4 }, id: 'bk001a' }, { callout: true, refLink: '书.epub', entryId: 'e_123' }),
        );
        expect(withRef.refLink).toBe('书.epub');
        expect(withRef.label).toBe('第 6 章 · 4%');
        expect(withRef.id).toBe('bk001a');
    });

    it('自动生成 id 时，深链里的 block 与块内 id 是同一个（单一真源）', () => {
        const md = renderExcerptBlock({ quote: 'q' }, { callout: true, entryId: 'e_123' });
        const id = /(?:#\^|\^)([\w-]+)/.exec(md)?.[1] ?? '';
        expect(id.startsWith('bk')).toBe(true);
        expect(md).toContain(`block=${id}`);
    });

    it('loc 优先记「章」；只有页码（无 loc）才记「页」', () => {
        // 两个都给时以 loc 为准（PDF 若将来补写入口，由调用方直接传 label）
        expect(renderExcerptBlock({ quote: 'q', page: 128, loc: { chapter: 128, pct: 40 }, id: 'bk001a' }, { callout: true, refLink: 'a.pdf' })).toContain(
            '[[a.pdf#^bk001a|第 128 章 · 40%]]',
        );
        expect(renderExcerptBlock({ quote: 'q', page: 128, id: 'bk001a' }, { callout: true, refLink: 'a.pdf' })).toContain('[[a.pdf#^bk001a|第 128 页]]');
    });

    it('手动录入（无 loc、无源文件）：给了页码写「第 N 页」，否则「摘抄」', () => {
        expect(renderExcerptBlock({ quote: 'q', page: 128, id: 'bk001a' }, { callout: true })).toContain('] 第 128 页');
        expect(renderExcerptBlock({ quote: 'q', id: 'bk001a' }, { callout: true })).toContain('] 摘抄');
    });

    it('无源文件链接时块尾补 ^id（否则块 id 无容身之处、删除失效）', () => {
        const md = renderExcerptBlock({ quote: 'q', id: 'bk001a' }, { callout: true });
        expect(md.endsWith('\n^bk001a')).toBe(true);
        expect(md).toContain('> [!quote] 摘抄');
    });

    it('缺省（旧格式渲染）仍是扁平块：不含 callout 头', () => {
        const md = renderExcerptBlock({ quote: 'q', loc: { chapter: 1, pct: 20 }, style: '高亮', color: '黄', id: 'hl001a' });
        expect(md).not.toContain('[!');
        expect(md).toContain('定位：1:20 · 样式：高亮 · 颜色：黄');
        expect(md.endsWith('\n^hl001a')).toBe(true);
    });
});

describe('pure/excerpt callout 解析与往返', () => {
    it('解析 callout 头行：配色/源文件/块 id/标签 → loc 还原', () => {
        const md = ['> [!quote|yellow] [[书.epub#^bk001a|第 6 章 · 11%]]', '> 摘录正文', '> ---', '> 想法正文'].join('\n');
        const r = parseExcerptBlock(md);
        expect(r.refLink).toBe('书.epub');
        expect(r.id).toBe('bk001a');
        expect(r.label).toBe('第 6 章 · 11%');
        expect(r.quote).toBe('摘录正文');
        expect(r.note).toBe('想法正文');
        expect(r.loc).toEqual({ chapter: 6, pct: 11 });
        expect(r.color).toBe('yellow');
    });

    it('旧分隔符 ---div--- 仍兼容解析（不丢想法）', () => {
        const r = parseExcerptBlock('> [!quote|yellow] [[a.txt#^bk001a|第 2 章]]\n> 摘录\n> ---div---\n> 想法');
        expect(r.quote).toBe('摘录');
        expect(r.note).toBe('想法');
    });

    it('旧自定义类型 [!TXT] / [!EPUB] 块仍能解析（用户笔记里可能已写入过）', () => {
        const r = parseExcerptBlock('> [!quote|yellow] [[a.txt#^bk001a|第 2 章]]\n> 旧类型块摘录');
        expect(r.quote).toBe('旧类型块摘录');
        expect(r.id).toBe('bk001a');
        expect(r.loc).toEqual({ chapter: 2, pct: 0 });
    });

    it('无分隔行时不产生 note', () => {
        const r = parseExcerptBlock('> [!quote|yellow] [[a.txt#^bk001a|第 2 章]]\n> 只有摘录');
        expect(r.quote).toBe('只有摘录');
        expect(r.note).toBeUndefined();
    });

    it('「第 N 页」块：还原 page 与 loc（页序当章序用）', () => {
        const r = parseExcerptBlock('> [!quote|yellow] [[a.pdf#^bk001a|第 128 页 · 40%]]\n> q');
        expect(r.page).toBe(128);
        expect(r.loc).toEqual({ chapter: 128, pct: 40 });
    });

    it('渲染 ↔ 解析往返一致（含想法与不含想法两种）', () => {
        for (const src of [
            { quote: '摘录', note: '想法', loc: { chapter: 6, pct: 11 } },
            { quote: '摘录', loc: { chapter: 2, pct: 0 } },
        ]) {
            const md = renderExcerptBlock({ ...src, id: 'bk001a' }, { callout: true, refLink: 'a.epub' });
            const back = parseExcerptBlock(md);
            expect(back.quote).toBe(src.quote);
            expect(back.note).toBe(src.note);
            expect(back.loc).toEqual(src.loc);
            expect(back.refLink).toBe('a.epub');
            expect(back.id).toBe('bk001a');
        }
    });

    it('新旧混排区：两种块都能解析出，且 id/loc 各自正确', () => {
        const md = [
            '## 摘抄',
            '',
            '> [!quote|yellow] [[a.txt#^bkNew1|第 1 章 · 5%]]',
            '> 新块摘录',
            '> ---',
            '> 新块想法',
            '',
            '> 旧块引用',
            '',
            '**p.128** · 心得：旧块心得 · 定位：3:20',
            '^bkOld2',
        ].join('\n');
        const list = parseExcerptBlocks(md);
        expect(list).toHaveLength(2);
        expect(list[0].id).toBe('bkNew1');
        expect(list[0].note).toBe('新块想法');
        expect(list[0].loc).toEqual({ chapter: 1, pct: 5 });
        expect(list[1].id).toBe('bkOld2');
        expect(list[1].page).toBe(128);
        expect(list[1].note).toBe('旧块心得');
        expect(list[1].loc).toEqual({ chapter: 3, pct: 20 });
        expect(countExcerpts(md)).toBe(2);
    });

    it('countExcerpts：callout 块按头行计 1（含无链接的兜底 ^id 不重复计）', () => {
        const md = [
            '## 摘抄',
            '',
            '> [!quote|yellow] [[a.txt#^bkNew1|第 1 章]]',
            '> 摘录一',
            '',
            '> [!quote|yellow] 摘抄',
            '> 摘录二',
            '',
            '^bkNew2',
        ].join('\n');
        // 首个是独立 callout 块；第二个是「无链接 callout + 兜底 ^id」= 同一块 → 合计 2
        const md2 = md.replace('\n\n^bkNew2', '\n^bkNew2');
        expect(countExcerpts(md2)).toBe(2);
        const list = parseExcerptBlocks(md2);
        expect(list.map((x) => x.id)).toEqual(['bkNew1', 'bkNew2']);
    });

    it('removeExcerptBlock：按头行锚点删整块（含 div/想法行），保留下一个块', () => {
        const md = [
            '## 摘抄',
            '',
            '> [!quote|yellow] [[a.txt#^bkNew1|第 1 章 · 5%]]',
            '> 摘录一',
            '> ---',
            '> 想法一',
            '',
            '> [!quote|yellow] [[a.txt#^bkNew2|第 2 章]]',
            '> 摘录二',
            '',
            '## 相关链接',
        ].join('\n');
        const out = removeExcerptBlock(md, 'bkNew1');
        expect(out).not.toContain('bkNew1');
        expect(out).not.toContain('想法一');
        expect(out).toContain('> [!quote|yellow] [[a.txt#^bkNew2|第 2 章]]');
        expect(out).toContain('## 相关链接');
        expect(countExcerpts(out)).toBe(1);

        const out2 = removeExcerptBlock(out, 'bkNew2');
        expect(countExcerpts(out2)).toBe(0);
        expect(out2).toContain('## 相关链接');
    });

    it('removeExcerptBlock：无链接的头行按兜底 ^id 行删（连块带锚点一起）', () => {
        const md = ['## 摘抄', '', '> [!quote|yellow] 摘抄', '> 摘录', '', '^bkNew9', '', '## 相关链接'].join('\n');
        const out = removeExcerptBlock(md, 'bkNew9');
        expect(out).not.toContain('bkNew9');
        expect(out).not.toContain('摘录');
        expect(countExcerpts(out)).toBe(0);
    });

    it('旧块删除路径不受影响（回归）', () => {
        const md = ['## 摘抄', '', '> 旧引用', '', '**p.1** · 定位：1:1', '^bkOld1', '', '> 旧引用二', '', '^bkOld2'].join('\n');
        const out = removeExcerptBlock(md, 'bkOld1');
        expect(out).not.toContain('bkOld1');
        expect(out).toContain('bkOld2');
        expect(countExcerpts(out)).toBe(1);
    });
});

describe('extractAnnotationSections（2026-09-18：writeNote 吞高亮修复的底座）', () => {
    const hlBlock = renderExcerptBlock(
        { quote: '应无所住而生其心', loc: { chapter: 1, pct: 3 }, id: 'hlAAA', style: '高亮', color: '黄' },
        { callout: true },
    );
    const exBlock = renderExcerptBlock({ quote: '凡所有相，皆是虚妄', note: '想法', id: 'bkBBB' }, { callout: true });
    const note = ['> [!bookinfo]+ **《金刚经》**', '', '## 高亮', '', hlBlock, '', '## 摘抄', '', exBlock, '', '## 相关链接', '（暂无链接）'].join('\n');

    it('按笔记里的出现顺序抽出「高亮 + 摘抄」两区（空区不返回）', () => {
        const secs = extractAnnotationSections(note);
        expect(secs.map((s) => s.section)).toEqual(['高亮', '摘抄']);
        expect(secs[0].body).toContain('应无所住而生其心');
        expect(secs[1].body).toContain('凡所有相，皆是虚妄');
    });

    it('空区不返回；两区都没有 → []（合并时原样返回模板）', () => {
        expect(extractAnnotationSections(['## 高亮', '', '## 摘抄', '', '## 相关链接'].join('\n'))).toEqual([]);
        expect(extractAnnotationSections('没有任何标注区')).toEqual([]);
    });

    it('顺序跟随旧笔记（摘抄在前时先返回摘抄）', () => {
        const swapped = ['## 摘抄', '', exBlock, '', '## 高亮', '', hlBlock].join('\n');
        expect(extractAnnotationSections(swapped).map((s) => s.section)).toEqual(['摘抄', '高亮']);
    });

    // 🔴 2026-09-19 补：`## 时间戳` / `## 截图` 也是**用户数据**，但不在笔记模板里 ——
    //    漏在这张名单外时，条目保存触发的 `writeNote` 会把两区整段抹掉（静默丢数据）。
    //    实测：用户笔记里只剩后一次插入的那条，日志里点过的更早那条（`t=430`）全库搜不到。
    it('🔴 「## 时间戳」/「## 截图」同样要被抽出（否则 writeNote 重写会把它们抹掉）', () => {
        const stamp = '[7:46](obsidian://reelludic?action=video&entry=e_1&ep=0&t=466)';
        const withStamps = [
            '## 高亮', '', hlBlock,
            '', '## 时间戳', '', stamp,
            '', '## 截图', '', '![[截屏 片名 0-03.png]]', '', stamp,
            '', '## 观看链接', '（暂无链接）',
        ].join('\n');
        const secs = extractAnnotationSections(withStamps);
        expect(secs.map((s) => s.section)).toEqual(['高亮', '时间戳', '截图']);
        expect(secs[1].body).toContain('[7:46](');
        expect(secs[2].body).toContain('![[截屏 片名 0-03.png]]');
    });
});

describe('replaceAnnotationSection 整区替换（2026-09-18 高亮只读镜像的底座）', () => {
    const empty = ['> [!bookinfo]+ **《活著》**', '', '## 个人评语', '好看', '', '## 相关链接', '（暂无链接）'].join('\n');
    const withHl = ['> [!bookinfo]+ **《活著》**', '', '## 高亮', '', '> 旧高亮', '', '^hlOLD', '', '## 摘抄', '', '> 一条摘抄', '', '## 相关链接', '（暂无链接）'].join('\n');

    it('无该区 + 非空内容 → 新建（插到链接章节之前，与 mergeExcerptSection 同规则）', () => {
        const out = replaceAnnotationSection(empty, '高亮', '> 新高亮');
        expect(out).toContain('## 高亮');
        expect(out).toContain('> 新高亮');
        expect(out.indexOf('## 高亮')).toBeLessThan(out.indexOf('## 相关链接'));
        expect(out).toContain('## 个人评语'); // 其余章节不动
    });

    it('无该区 + 空内容 → 原文一字不改', () => {
        expect(replaceAnnotationSection(empty, '高亮', '')).toBe(empty);
        expect(replaceAnnotationSection(empty, '高亮', '   \n  ')).toBe(empty);
    });

    it('有该区 → 整区换掉（旧内容消失、标题只有一份、相邻区不受影响）', () => {
        const out = replaceAnnotationSection(withHl, '高亮', '> 新高亮\n\n^hlNEW');
        expect(out).not.toContain('旧高亮');
        expect(out).not.toContain('^hlOLD');
        expect(out).toContain('^hlNEW');
        expect(out.match(/^## 高亮$/gm)).toHaveLength(1);
        expect(out).toContain('> 一条摘抄'); // 摘抄区原样
        expect(out).toContain('## 相关链接');
    });

    it('有该区 + 空内容 → 整区删除（标题也一起走），空行不堆积', () => {
        const out = replaceAnnotationSection(withHl, '高亮', '');
        expect(out).not.toContain('## 高亮');
        expect(out).not.toContain('^hlOLD');
        expect(out).toContain('## 摘抄');
        expect(out).not.toMatch(/\n{3,}/);
    });

    it('幂等：把新内容再替换一次 → 逐字符相同（调用方据此跳过写盘）', () => {
        const once = replaceAnnotationSection(withHl, '高亮', '> 新高亮');
        const twice = replaceAnnotationSection(once, '高亮', '> 新高亮');
        expect(twice).toBe(once);
    });

    it('🔴 首次插入即规范排版：新建后再替换同内容 → 逐字符相同（否则每次打开都白写一遍笔记）', () => {
        const first = replaceAnnotationSection(empty, '高亮', '> 新高亮');
        expect(replaceAnnotationSection(first, '高亮', '> 新高亮')).toBe(first);
    });

    it('区在文件末尾（后面没有二级标题）也能替换', () => {
        const tail = ['## 高亮', '', '> 旧', '', '^hlOLD'].join('\n');
        const out = replaceAnnotationSection(tail, '高亮', '> 新');
        expect(out).toBe(['## 高亮', '', '> 新', ''].join('\n'));
    });
});
