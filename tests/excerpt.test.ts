import { describe, it, expect } from 'vitest';
import {
    generateBlockId,
    parseExcerptBlock,
    extractExcerptSection,
    countExcerpts,
    renderExcerptBlock,
    mergeExcerptSection,
    appendExcerptToNote,
    removeExcerptBlock,
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
