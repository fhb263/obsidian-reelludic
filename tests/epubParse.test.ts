import { describe, it, expect } from 'vitest';
import { containerRootfile, resolveEpubPath, parseOpf, parseTocNav, xhtmlToText, extractChapterLabel, chapterTextLength } from 'pure/epubParse';

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
});
