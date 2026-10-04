/**
 * `pure/epubPack` 单测（#420 P1-B）—— EPUB 3 结构合成。
 * 🔴 钉两件事：**文件顺序**（`mimetype` 第一条）与 **XML 转义**（书名/正文里带 `<&"` 是常态）。
 */
import { describe, expect, it } from 'vitest';
import {
    EPUB_MIMETYPE,
    chapterFileName,
    derivedUuid,
    epubChapterXhtml,
    epubContainerXml,
    epubFileList,
    epubNcx,
    epubNavXhtml,
    epubOpf,
    isoUtc,
    xmlEscape,
    type EpubMeta,
} from 'pure/epubPack';

const META: EpubMeta = { title: '示例书名', author: '示例作者', sourceName: '示例源甲', intro: '一段简介。' };
const CH = [
    { no: 1, title: '第 1 章 风起', text: '正文一。\n\n正文二。' },
    { no: 2, title: '第 2 章 雨落', text: '正文三。' },
];
const OPTS = { modified: '2026-09-28T00:00:00Z', uuid: 'aaaabbbb-cccc-4ddd-aeee-ffff00001111' };

describe('epubPack · 文件清单与顺序', () => {
    it('🔴 **`mimetype` 恒为第一条且 STORED**（顺序/压缩方式由这里定，打包器只照做）', () => {
        const files = epubFileList(META, CH, OPTS);
        expect(files[0]).toEqual({ path: 'mimetype', content: EPUB_MIMETYPE, stored: true });
        // ⛔ 只有它标 stored，别的都不标（别让整包变不压缩）
        expect(files.filter((f) => f.stored).map((f) => f.path)).toEqual(['mimetype']);
        // mimetype 内容一字不差（多一个换行就会被严格校验器判错）
        expect(files[0].content).toBe('application/epub+zip');
    });

    it('清单顺序：mimetype → container → opf → nav → ncx → css → 各章', () => {
        expect(epubFileList(META, CH, OPTS).map((f) => f.path)).toEqual([
            'mimetype',
            'META-INF/container.xml',
            'OEBPS/content.opf',
            'OEBPS/nav.xhtml',
            'OEBPS/toc.ncx',
            'OEBPS/style.css',
            'OEBPS/chapter-00001.xhtml',
            'OEBPS/chapter-00002.xhtml',
        ]);
    });

    it('`container.xml` 指向 `OEBPS/content.opf`', () => {
        expect(epubContainerXml()).toContain('full-path="OEBPS/content.opf"');
    });

    it('🔴 空正文的章整章不写（与 TXT 同一口径：那章已在 UI 报过失败）', () => {
        const files = epubFileList(META, [CH[0], { no: 2, title: '空的', text: '   ' }, { no: 3, title: '第 3 章', text: '正文四。' }], OPTS);
        const names = files.map((f) => f.path);
        expect(names).not.toContain('OEBPS/chapter-00002.xhtml');
        expect(names).toContain('OEBPS/chapter-00003.xhtml');
        // 目录里也不能出现那一章
        const nav = files.find((f) => f.path === 'OEBPS/nav.xhtml')!.content;
        expect(nav).not.toContain('空的');
        expect(nav).toContain('第 3 章');
    });

    it('书名缺省 ⇒ 「未命名」（别产出空 `<dc:title>`）', () => {
        const files = epubFileList({ title: '' }, CH, OPTS);
        expect(files.find((f) => f.path === 'OEBPS/content.opf')!.content).toContain('<dc:title>未命名</dc:title>');
    });

    it('`chapterFileName` 补零到 5 位（字典序 = 章序）', () => {
        expect(chapterFileName(1)).toBe('chapter-00001.xhtml');
        expect(chapterFileName(1234)).toBe('chapter-01234.xhtml');
        expect(chapterFileName(0)).toBe('chapter-00001.xhtml'); // 越界夹回 1，别产出 chapter-00000
    });

    it('`isoUtc` 去掉毫秒（`dcterms:modified` 不接受 .123）', () => {
        expect(isoUtc(new Date('2026-09-28T14:02:11.456Z'))).toBe('2026-09-28T14:02:11Z');
    });
});

describe('epubPack · XML 转义', () => {
    it('五个实体全转（文本与属性共用一份）', () => {
        expect(xmlEscape(`<a & b > "c" 'd'`)).toBe('&lt;a &amp; b &gt; &quot;c&quot; &apos;d&apos;');
    });

    it('去掉非法控制字符（书源正文里偶有 \\x0b 之类）', () => {
        expect(xmlEscape('甲\u000b乙\u001f丙')).toBe('甲乙丙');
    });

    it('& 只转一次（别把已转义的 `&amp;` 再转成 `&amp;amp;`）', () => {
        // 前提：先 & 后 < > —— 顺序错了就会二次转义
        expect(xmlEscape('&amp;')).toBe('&amp;amp;');
        expect(xmlEscape('&')).toBe('&amp;');
    });

    it('书名里的 `<&"` 不会破坏 OPF / 目录', () => {
        const meta: EpubMeta = { title: 'A<B&C"D', author: "O'Neil" };
        const opf = epubOpf(CH, meta, 'u', '2026-09-28T00:00:00Z');
        expect(opf).toContain('<dc:title>A&lt;B&amp;C&quot;D</dc:title>');
        expect(opf).toContain('<dc:creator>O&apos;Neil</dc:creator>');
        expect(opf).not.toContain('<B&C');
    });
});

describe('epubPack · 章节 / 目录 / OPF', () => {
    it('章节 XHTML：`<h1>` + 每段一个 `<p>`（正文按空行拆段）', () => {
        const x = epubChapterXhtml('第 1 章 风起', ['正文一。', '正文二。']);
        expect(x).toContain('<h1>第 1 章 风起</h1>');
        expect((x.match(/<p>/g) || []).length).toBe(2);
        expect(x).toContain('<title>第 1 章 风起</title>');
    });

    it('🔴 OPF：manifest 逐章一条 + spine 顺序与章序一致 + `dcterms:modified` 就位', () => {
        const opf = epubOpf(CH, META, 'u', '2026-09-28T00:00:00Z');
        expect(opf).toContain('<item id="c1" href="chapter-00001.xhtml" media-type="application/xhtml+xml"/>');
        expect(opf).toContain('<item id="c2" href="chapter-00002.xhtml" media-type="application/xhtml+xml"/>');
        expect(opf.indexOf('<itemref idref="c1"/>')).toBeLessThan(opf.indexOf('<itemref idref="c2"/>'));
        expect(opf).toContain('<meta property="dcterms:modified">2026-09-28T00:00:00Z</meta>');
        // 三件必备基建
        expect(opf).toContain('properties="nav"');
        expect(opf).toContain('application/x-dtbncx+xml');
        expect(opf).toContain('<dc:source>示例源甲</dc:source>');
    });

    it('🔴 目录给两套：`nav.xhtml`（EPUB3）+ `toc.ncx`（EPUB2 回落，掌阅/WPS 只认它）', () => {
        const nav = epubNavXhtml(CH);
        const ncx = epubNcx(CH, META, 'u');
        expect((nav.match(/<li><a href=/g) || []).length).toBe(2);
        expect((ncx.match(/<navPoint /g) || []).length).toBe(2);
        expect(nav).toContain('epub:type="toc"');
        expect(ncx).toContain('<content src="chapter-00001.xhtml"/>');
        expect(ncx).toContain('dtb:uid');
    });

    it('`derivedUuid`：同书同 id（可复现），异书异 id', () => {
        expect(derivedUuid(META)).toBe(derivedUuid(META));
        expect(derivedUuid(META)).not.toBe(derivedUuid({ ...META, title: '另一本' }));
        expect(derivedUuid(META)).not.toBe(derivedUuid({ ...META, author: '另一个' }));
        expect(derivedUuid(META)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('显式传 `uuid` ⇒ 用它（调用方能拿到真 uuid 时不走派生）', () => {
        const files = epubFileList(META, CH, { ...OPTS, uuid: 'real-uuid-here' });
        expect(files.find((f) => f.path === 'OEBPS/content.opf')!.content).toContain('<dc:identifier id="bookid">urn:uuid:real-uuid-here</dc:identifier>');
    });

    it('CSS 只做段首缩进与行距（⛔ 不写死字号/颜色，那是阅读器的主题）', () => {
        const css = epubFileList(META, CH, OPTS).find((f) => f.path === 'OEBPS/style.css')!.content;
        expect(css).toContain('text-indent');
        expect(css).not.toMatch(/color\s*:/);
        expect(css).not.toMatch(/font-size:\s*\d+px/);
    });
});
