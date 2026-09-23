import { describe, it, expect } from 'vitest';
import { containerRootfile, resolveEpubPath, parseOpf, parseTocNav, xhtmlToText, extractChapterLabel, chapterTextLength, epubTocCharCounts, isTocAmbiguous, rebuildTocFromSpine, type EpubFileMap } from 'pure/epubParse';
import { countReadingUnits } from 'pure/readingUnits';

describe('EPUB 解析', () => {
    describe('containerRootfile', () => {
        it('标准 container.xml → OEBPS/content.opf', () => {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
            expect(containerRootfile(xml)).toBe('OEBPS/content.opf');
        });
    });

    describe('resolveEpubPath', () => {
        it('子目录拼接', () => {
            expect(resolveEpubPath('OEBPS', 'Text/ch1.xhtml')).toBe('OEBPS/Text/ch1.xhtml');
        });
        it('../ 上跳', () => {
            expect(resolveEpubPath('OEBPS', '../Images/a.jpg')).toBe('Images/a.jpg');
        });
        it('同级相对', () => {
            expect(resolveEpubPath('OEBPS/Text', 'ch2.xhtml')).toBe('OEBPS/Text/ch2.xhtml');
        });
    });

    describe('parseOpf', () => {
        it('manifest + spine 阅读序 + dc:title（过滤非 xhtml 与缺失文件）', () => {
            const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>三体</dc:title>
  </metadata>
  <manifest>
    <item id="id1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="id2" href="Images/c1.jpg" media-type="image/jpeg"/>
    <item id="id3" href="Text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="id1"/>
    <itemref idref="id2"/>
    <itemref idref="id3"/>
  </spine>
</package>`;
            const fileMap: Record<string, string> = {
                'OEBPS/Text/ch1.xhtml': '<html/>',
                // ch3 故意不在 fileMap：验证「文件缺失」章节被过滤
            };
            const r = parseOpf(opf, 'OEBPS', fileMap);
            expect(r.title).toBe('三体');
            // spine 顺序保留；id2 图片被过滤；id3 文件缺失被过滤
            expect(r.chapters).toEqual(['OEBPS/Text/ch1.xhtml']);
            // manifest 含图片项
            expect(r.manifest['OEBPS/Images/c1.jpg']).toBe('image/jpeg');
        });

        it('缺 dc:title → 回退 未命名', () => {
            const opf = `<package><manifest><item id="i" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="i"/></spine></package>`;
            const fileMap = { 'OEBPS/c.xhtml': '<html/>' };
            expect(parseOpf(opf, 'OEBPS', fileMap).title).toBe('未命名');
        });

        it('href 带 %20 转义可反编码匹配', () => {
            const opf = `<package><manifest><item id="i" href="Text/ch%201.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="i"/></spine></package>`;
            const fileMap = { 'OEBPS/Text/ch 1.xhtml': '<html/>' };
            expect(parseOpf(opf, 'OEBPS', fileMap).chapters).toEqual(['OEBPS/Text/ch 1.xhtml']);
        });
    });

    describe('parseTocNav', () => {
        it('nav.xhtml → 扁平 toc（#fragment 保留，页内锚点跳过）', () => {
            const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="Text/ch1.xhtml">第一章</a></li>
  <li><a href="Text/ch2.xhtml#sec2">第二章（锚点）</a></li>
  <li><a href="#inline">页内锚点</a></li>
</ol></nav></body></html>`;
            const fileMap = { 'OEBPS/Text/ch1.xhtml': '', 'OEBPS/Text/ch2.xhtml': '' };
            expect(parseTocNav(nav, 'OEBPS', fileMap)).toEqual([
                { label: '第一章', href: 'OEBPS/Text/ch1.xhtml' },
                { label: '第二章（锚点）', href: 'OEBPS/Text/ch2.xhtml#sec2' },
            ]);
        });

        it('nav.xhtml 含 landmarks/page-list 多 nav 块：只取 epub:type=toc 块（防目录混入封面/目录/书页链接）', () => {
            const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
<nav epub:type="toc"><ol>
  <li><a href="Text/ch1.xhtml">第一章</a></li>
  <li><a href="Text/ch2.xhtml">第二章</a></li>
</ol></nav>
<nav epub:type="landmarks"><ol>
  <li><a epub:type="cover" href="Text/cover.xhtml">封面</a></li>
  <li><a epub:type="toc" href="Text/toc.xhtml">目录</a></li>
  <li><a epub:type="bodymatter" href="Text/ch1.xhtml">正文开始</a></li>
</ol></nav>
<nav epub:type="page-list"><ol>
  <li><a href="Text/ch1.xhtml#page1">1</a></li>
  <li><a href="Text/ch1.xhtml#page2">2</a></li>
</ol></nav>
</body></html>`;
            const fileMap = { 'OEBPS/Text/ch1.xhtml': '', 'OEBPS/Text/ch2.xhtml': '' };
            expect(parseTocNav(nav, 'OEBPS', fileMap)).toEqual([
                { label: '第一章', href: 'OEBPS/Text/ch1.xhtml' },
                { label: '第二章', href: 'OEBPS/Text/ch2.xhtml' },
            ]);
        });

        it('无 epub:type 的裸 nav 块仍整文档兜底解析（老式/手写 nav）', () => {
            const nav = `<html xmlns="http://www.w3.org/1999/xhtml">
<body><nav><ol>
  <li><a href="Text/a.xhtml">甲</a></li>
  <li><a href="Text/b.xhtml">乙</a></li>
</ol></nav></body></html>`;
            const fileMap = { 'OEBPS/Text/a.xhtml': '', 'OEBPS/Text/b.xhtml': '' };
            expect(parseTocNav(nav, 'OEBPS', fileMap)).toEqual([
                { label: '甲', href: 'OEBPS/Text/a.xhtml' },
                { label: '乙', href: 'OEBPS/Text/b.xhtml' },
            ]);
        });

        it('NCX（EPUB2）→ toc', () => {
            const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>序章</text></navLabel>
      <content src="Text/prologue.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
            const fileMap = { 'OEBPS/Text/prologue.xhtml': '' };
            expect(parseTocNav(ncx, 'OEBPS', fileMap)).toEqual([{ label: '序章', href: 'OEBPS/Text/prologue.xhtml' }]);
        });

        it('无匹配 → []', () => {
            expect(parseTocNav('<html></html>', 'OEBPS', {})).toEqual([]);
        });
    });

    describe('xhtmlToText', () => {
        it('标签剥离 + 实体解码', () => {
            expect(xhtmlToText('<p>你好<b>世界</b></p>')).toBe('你好世界');
            expect(xhtmlToText('<p>a&nbsp;b &amp; c</p>')).toBe('a b & c');
        });
        it('script/style 剔除', () => {
            expect(xhtmlToText('<p>正文</p><script>alert(1)</script><style>.x{color:red}</style><p>结尾</p>')).toBe('正文结尾');
        });
    });

    describe('chapterTextLength 章节纯文本字数（进度加权口径）', () => {
        it('返回剥离标签后的可见文本长度（HTML 标签不占权重）', () => {
            // 三体样章：HTML 壳远大于正文
            const html = `<html><head><title>三体</title><style>.x{color:red}</style></head><body><h1>第一章</h1><p>科学边界</p></body></html>`;
            const text = xhtmlToText(html);
            expect(chapterTextLength(html)).toBe(text.length);
            expect(chapterTextLength(html)).toBeLessThan(html.length);
        });
        it('空/纯标签 → 0', () => {
            expect(chapterTextLength('')).toBe(0);
            expect(chapterTextLength('<html><body></body></html>')).toBe(0);
        });
    });

    describe('extractChapterLabel', () => {
        // 优先级：<h1> > <title>(≠书名) > undefined。无 h1/title 信息时返回 undefined，调用方回退文件名。
        it('有 <h1> 时返回 h1 去标签文本', () => {
            expect(extractChapterLabel('<html><body><h1>第一章</h1></body></html>', '书名')).toBe('第一章');
        });
        it('<h1> 内含 inline 标签 → 剥标签折叠空白', () => {
            expect(extractChapterLabel('<h1>第<b>一</b>章  <span>开场</span></h1>', '书名')).toBe('第一章 开场');
        });
        it('无 h1 但有 <title> ≠书名 → 返回 title', () => {
            expect(extractChapterLabel('<html><head><title>序言</title></head></html>', '书名')).toBe('序言');
        });
        it('<title> 等于书名（常为扉页）→ undefined（让调用方用文件名兜底，不污染目录）', () => {
            expect(extractChapterLabel('<html><head><title>活着</title></head></html>', '活着')).toBeUndefined();
        });
        it('两者皆有 → 优先 h1', () => {
            expect(extractChapterLabel('<html><head><title>书名</title></head><body><h1>第一章</h1></body></html>', '书名')).toBe('第一章');
        });
        it('无 h1 无 title → undefined', () => {
            expect(extractChapterLabel('<html><body><p>无标题</p></body></html>', '书名')).toBeUndefined();
        });
        it('空字符串 → undefined', () => {
            expect(extractChapterLabel('', '书名')).toBeUndefined();
        });
    });

    // ── 目录错位（Calibre「先写 NCX、后重切文件」的残留）→ 不可信则按内容文件重建 ──
    // 用户 2026-09-19 报障：百年孤独 EPUB 目录里第 6~10 章同时高亮 —— 20 个目录项全落在前 4 个文件上，
    // 且锚点大段重复（#calibre_pb_5 用了 3 次），目录在数据上根本区分不开这些章。
    describe('isTocAmbiguous：目录能否区分自己的条目', () => {
        const e = (href: string, label = href) => ({ label, href });
        it('每文件各一项（正常 1:1 目录）→ false', () => {
            expect(isTocAmbiguous([e('a.html'), e('b.html'), e('c.html')])).toBe(false);
        });
        it('🔴 一个文件含多章、但锚点各不相同（合法结构）→ false（绝不误判，误判会把好目录退化成文件粒度）', () => {
            expect(isTocAmbiguous([e('a.html#ch1'), e('a.html#ch2'), e('a.html#ch3')])).toBe(false);
        });
        it('同一文件 + 同一锚点出现两次 → true', () => {
            expect(isTocAmbiguous([e('a.html'), e('a.html#pb3'), e('a.html#pb3')])).toBe(true);
        });
        it('同一文件 + 都无锚点出现两次 → true（本条即百年孤独的形态：5 项裸指同一文件）', () => {
            expect(isTocAmbiguous([e('a.html'), e('a.html'), e('a.html')])).toBe(true);
        });
        it('不同文件用同名锚点 → false（不跨文件判重）', () => {
            expect(isTocAmbiguous([e('a.html#x'), e('b.html#x')])).toBe(false);
        });
        it('空目录 → false', () => {
            expect(isTocAmbiguous([])).toBe(false);
        });
    });

    describe('rebuildTocFromSpine：按内容文件重建目录', () => {
        const body = (n: number) => `<html><body><p>${'字'.repeat(n)}</p></body></html>`;
        // spine：封面/版权页（短）+ 3 个正文文件（长）；原目录 4 项全裸指 c1（错位形态）
        const chapters = ['cover.xhtml', 'copy.xhtml', 'text/c1.html', 'text/c2.html', 'text/c3.html'];
        const map: EpubFileMap = {
            'cover.xhtml': body(30),
            'copy.xhtml': body(200),
            'text/c1.html': body(5000),
            'text/c2.html': body(5000),
            'text/c3.html': body(5000),
        };
        const badToc = [
            { label: '第1章', href: 'text/c1.html' },
            { label: '第2章', href: 'text/c1.html' },
            { label: '第3章', href: 'text/c1.html' },
            { label: '第4章', href: 'text/c1.html' },
        ];

        it('跳过短前置页（封面 / 版权页不进目录）', () => {
            const out = rebuildTocFromSpine(chapters, map, badToc);
            expect(out.map((t) => t.href)).toEqual(['text/c1.html', 'text/c2.html', 'text/c3.html']);
        });
        it('章节编号按内容文件序号（跳过的前置页不占编号）', () => {
            const out = rebuildTocFromSpine(chapters, map, badToc);
            expect(out.map((t) => t.label)).toEqual(['第 1 章', '第 2 章', '第 3 章']);
        });
        it('原目录里唯一指向某文件的条目 → 保住它原来的章名（不乱改成 第 N 章）', () => {
            const toc = [{ label: '楔子', href: 'text/c1.html' }, { label: '第一章', href: 'text/c1.html' }, { label: '尾声', href: 'text/c3.html' }];
            const out = rebuildTocFromSpine(chapters, map, toc);
            // c1 被 2 项指向 → 不可信 → 回退 第 N 章；c3 唯一指向 → 保留
            expect(out.map((t) => t.label)).toEqual(['第 1 章', '第 2 章', '尾声']);
        });
        it('正文有 <h1> 时优先用 h1（比「第 N 章」有信息量）', () => {
            const m2: EpubFileMap = { ...map, 'text/c2.html': '<html><body><h1>风起</h1><p>' + '字'.repeat(5000) + '</p></body></html>' };
            const out = rebuildTocFromSpine(chapters, m2, badToc);
            expect(out[1].label).toBe('风起');
        });
        it('🔴 章节 <title> 写成书名（带后缀，躲得过「等于书名」守卫）→ 不得拿它当章名，回退「第 N 章」', () => {
            // 真实案例：百年孤独.epub 的 20 个章节文件 <title> 全是「百年孤独（范晔 译本）」且无 h1
            const m3: EpubFileMap = { ...map, 'text/c1.html': '<html><head><title>百年孤独（范晔 译本）</title></head><body><p>' + '字'.repeat(5000) + '</p></body></html>' };
            const out = rebuildTocFromSpine(chapters, m3, badToc);
            expect(out[0].label).toBe('第 1 章');
        });
        it('被原目录收录过的短文件要保留（短章节也是真章节，不受阈值约束）', () => {
            const toc = [{ label: '短章', href: 'copy.xhtml' }];
            const out = rebuildTocFromSpine(chapters, map, toc);
            expect(out.map((t) => t.href)).toContain('copy.xhtml');
            expect(out.find((t) => t.href === 'copy.xhtml')?.label).toBe('短章');
        });
        it('href 与 spine 顺序一致（目录点击与「当前章」比对全靠它）', () => {
            const out = rebuildTocFromSpine(chapters, map, badToc);
            const spineOrder = chapters.filter((h) => out.some((t) => t.href === h));
            expect(out.map((t) => t.href)).toEqual(spineOrder);
        });
        it('空 spine → 空数组（调用方据此不改动原目录）', () => {
            expect(rebuildTocFromSpine([], map, badToc)).toEqual([]);
        });
        it('复刻百年孤独形态：20 个内容文件 + 4 项错位目录 → 20 项 第 1~20 章', () => {
            const chs = ['text/part0002.html', ...Array.from({ length: 20 }, (_, i) => `text/part${String(i + 3).padStart(4, '0')}.html`)];
            const fm: EpubFileMap = { 'text/part0002.html': body(452) };
            for (let i = 0; i < 20; i++) fm[chs[i + 1]] = body(10500);
            const bad = [
                { label: '第1章', href: 'text/part0003.html' },
                { label: '第5章', href: 'text/part0003.html' },
                { label: '第6章', href: 'text/part0004.html' },
                { label: '第10章', href: 'text/part0004.html' },
                { label: '第11章', href: 'text/part0005.html' },
                { label: '第20章', href: 'text/part0006.html' },
            ];
            expect(isTocAmbiguous(bad)).toBe(true);
            const out = rebuildTocFromSpine(chs, fm, bad);
            expect(out).toHaveLength(20);
            expect(out[0]).toEqual({ label: '第 1 章', href: 'text/part0003.html' });
            expect(out[19]).toEqual({ label: '第 20 章', href: 'text/part0022.html' });
            // 重建后：每个文件只对应一个条目 → 目录不可能再「连章」
            expect(isTocAmbiguous(out)).toBe(false);
        });
    });
});

describe('epubTocCharCounts（#338 目录每条的字数）', () => {
    const book = {
        chapters: ['c1.xhtml', 'c2.xhtml'],
        toc: [
            { label: '第一章', href: 'c1.xhtml' },
            { label: '第二章', href: 'c2.xhtml#a' },
            { label: '第三章', href: 'c2.xhtml#b' },
            { label: '缺文件', href: 'missing.xhtml' },
            { label: '锚点不存在', href: 'c1.xhtml#nope' },
        ],
    };
    const fileMap: EpubFileMap = {
        'c1.xhtml': '<html><body><h1>第一章</h1><p>你好世界</p></body></html>',
        'c2.xhtml': '<p id="a">甲乙丙</p><p>丁</p><p id="b">戊己</p><p>庚</p>',
    };
    it('无锚点 → 所指文件的正文字数（复用 chapterTextLength 口径）', () => {
        const out = epubTocCharCounts(book, fileMap);
        expect(out[0]).toBe(chapterTextLength(fileMap['c1.xhtml']));
    });
    it('有锚点 → 同文件内按锚点先后分段计数', () => {
        const out = epubTocCharCounts(book, fileMap);
        expect(out[1]).toBe(chapterTextLength('<p>甲乙丙</p><p>丁</p>'));
        expect(out[2]).toBe(chapterTextLength('<p>戊己</p><p>庚</p>'));
    });
    it('文件缺失 / 锚点找不到 → undefined（不显示，不猜）', () => {
        const out = epubTocCharCounts(book, fileMap);
        expect(out[3]).toBeUndefined();
        expect(out[4]).toBeUndefined();
    });

    it('🔴 第三个参数可换计数口径（#345：目录显示传「阅读量单位」；默认仍是进度口径 chapterTextLength）', () => {
        const units = epubTocCharCounts(book, fileMap, (html) => countReadingUnits(xhtmlToText(html)));
        // c1：正文「第一章你好世界」= 8 字（标签不占）；默认口径（字符长度）也是 8，故另用英文样本区分
        expect(units[0]).toBe(countReadingUnits(xhtmlToText(fileMap['c1.xhtml'])));
        const enMap: EpubFileMap = { 'e.xhtml': '<p>hello world</p>' };
        const enBook = { chapters: ['e.xhtml'], toc: [{ label: 'Ch 1', href: 'e.xhtml' }] };
        // 旧口径：'hello world' 去标签后 11 个字符；新口径：2 个词
        expect(epubTocCharCounts(enBook, enMap)[0]).toBe(11);
        expect(epubTocCharCounts(enBook, enMap, (html) => countReadingUnits(xhtmlToText(html)))[0]).toBe(2);
    });
});
