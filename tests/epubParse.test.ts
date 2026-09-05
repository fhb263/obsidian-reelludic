import { describe, it, expect } from 'vitest';
import { containerRootfile, resolveEpubPath, parseOpf, parseTocNav, xhtmlToText } from 'pure/epubParse';

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
});
