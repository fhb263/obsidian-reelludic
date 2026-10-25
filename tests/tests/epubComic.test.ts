import { describe, expect, it } from 'vitest';
import {
    extractEpubComicPages,
    extractEpubImageRefs,
    resolveEpubRef,
} from 'pure/epubComic';

describe('resolveEpubRef · 章节内引用 → 包内路径', () => {
    it('同目录相对路径按章节所在目录拼接', () => {
        expect(resolveEpubRef('OEBPS/text', 'p001.jpg')).toBe('OEBPS/text/p001.jpg');
    });

    it('`../` 回退到上级目录（EPUB 里最常见的 images 目录写法）', () => {
        expect(resolveEpubRef('OEBPS/text', '../images/p001.jpg')).toBe('OEBPS/images/p001.jpg');
    });

    it('`./` 与多余分隔符被归一', () => {
        expect(resolveEpubRef('OEBPS', './images//p001.jpg')).toBe('OEBPS/images/p001.jpg');
    });

    it('根相对路径从包根算起（⛔ 不拼 baseDir）', () => {
        expect(resolveEpubRef('OEBPS/text', '/images/p001.jpg')).toBe('images/p001.jpg');
    });

    it('去掉 fragment 与 query（`p1.jpg#x` / `p1.jpg?v=2`）', () => {
        expect(resolveEpubRef('OEBPS', 'p1.jpg#frag')).toBe('OEBPS/p1.jpg');
        expect(resolveEpubRef('OEBPS', 'p1.jpg?v=2')).toBe('OEBPS/p1.jpg');
    });

    it('百分号解码（href 写 `%20`，包内条目名是空格）', () => {
        expect(resolveEpubRef('OEBPS', 'my%20page.jpg')).toBe('OEBPS/my page.jpg');
    });

    it('反斜杠按分隔符处理（畸形 EPUB）', () => {
        expect(resolveEpubRef('OEBPS', 'sub\\p1.jpg')).toBe('OEBPS/sub/p1.jpg');
    });

    it('带协议 / 只剩锚点 / 空串 → null（外部资源不接管）', () => {
        expect(resolveEpubRef('OEBPS', 'https://x/y.jpg')).toBeNull();
        expect(resolveEpubRef('OEBPS', 'data:image/png;base64,AAA')).toBeNull();
        expect(resolveEpubRef('OEBPS', '#top')).toBeNull();
        expect(resolveEpubRef('OEBPS', '   ')).toBeNull();
    });

    it('`..` 越过包根时原地不动（⛔ 不发散到包外）', () => {
        expect(resolveEpubRef('', '../../p1.jpg')).toBe('p1.jpg');
        expect(resolveEpubRef('OEBPS', '../../p1.jpg')).toBe('p1.jpg');
    });
});

describe('extractEpubImageRefs · 章节里的图片引用', () => {
    it('取 `<img src>`，按出现顺序', () => {
        const html = '<body><img src="a.jpg"/><p>x</p><img src="b.png"></body>';
        expect(extractEpubImageRefs(html)).toEqual(['a.jpg', 'b.png']);
    });

    it('单引号属性同样识别', () => {
        expect(extractEpubImageRefs("<img src='a.jpg'>")).toEqual(['a.jpg']);
    });

    it('SVG `<image>` 的 href / xlink:href 也收（漫画 EPUB 常用 svg 包一层）', () => {
        expect(extractEpubImageRefs('<image xlink:href="p1.jpg"/>')).toEqual(['p1.jpg']);
        expect(extractEpubImageRefs('<image href="p2.jpg"></image>')).toEqual(['p2.jpg']);
    });

    it('`<source src>`（picture）也收', () => {
        expect(extractEpubImageRefs('<picture><source src="a.webp"><img src="a.jpg"></picture>'))
            .toEqual(['a.webp', 'a.jpg']);
    });

    it('无图片 / 空输入 → 空数组', () => {
        expect(extractEpubImageRefs('<p>纯文字</p>')).toEqual([]);
        expect(extractEpubImageRefs('')).toEqual([]);
    });

    it('⛔ 不吃 `<img>` 之外的 `src`（如 `<script src>`）', () => {
        expect(extractEpubImageRefs('<script src="a.js"></script>')).toEqual([]);
    });
});

describe('extractEpubComicPages · 按 spine 顺序抽页', () => {
    const fileMap: Record<string, string> = {
        'OEBPS/cover.xhtml': '<img src="images/cover.jpg"/>',
        'OEBPS/text/p1.xhtml': '<img src="../images/001.jpg"/>',
        'OEBPS/text/p2.xhtml': '<img src="../images/002.jpg"/>',
        'OEBPS/text/nav.xhtml': '<p>目录</p>',
    };

    it('顺序 = spine 序（⛔ 不是文件名序）', () => {
        const chapters = ['OEBPS/text/p2.xhtml', 'OEBPS/cover.xhtml', 'OEBPS/text/p1.xhtml'];
        expect(extractEpubComicPages(chapters, fileMap).map((p) => p.path)).toEqual([
            'OEBPS/images/002.jpg',
            'OEBPS/images/cover.jpg',
            'OEBPS/images/001.jpg',
        ]);
    });

    it('`name` = 文件名（宿主据此取 MIME）', () => {
        const pages = extractEpubComicPages(['OEBPS/text/p1.xhtml'], fileMap);
        expect(pages[0]).toEqual({ path: 'OEBPS/images/001.jpg', name: '001.jpg' });
    });

    it('一页多图按出现顺序多页；非图片引用被滤掉', () => {
        const fm = { 'a.xhtml': '<img src="1.jpg"><img src="readme.txt"><img src="2.png">' };
        expect(extractEpubComicPages(['a.xhtml'], fm).map((p) => p.name)).toEqual(['1.jpg', '2.png']);
    });

    it('同一张图被多章引用 → 去重（封面与首页共用一张时不重复出页）', () => {
        const fm = { 'a.xhtml': '<img src="cover.jpg">', 'b.xhtml': '<img src="cover.jpg">' };
        expect(extractEpubComicPages(['a.xhtml', 'b.xhtml'], fm).map((p) => p.path)).toEqual(['cover.jpg']);
    });

    it('章节文件缺失（占位/损坏）直接跳过，不影响其它章', () => {
        expect(extractEpubComicPages(['missing.xhtml', 'OEBPS/text/p1.xhtml'], fileMap).map((p) => p.name))
            .toEqual(['001.jpg']);
    });

    it('纯文字 EPUB → 空数组（调用方据此回落文字阅读器）', () => {
        expect(extractEpubComicPages(['OEBPS/text/nav.xhtml'], fileMap)).toEqual([]);
    });

    it('外部图片（http/data）不算页', () => {
        const fm = { 'a.xhtml': '<img src="https://x/y.jpg"><img src="data:image/png;base64,AA">' };
        expect(extractEpubComicPages(['a.xhtml'], fm)).toEqual([]);
    });

    it('空章节表 / 空 fileMap → 空数组（不抛）', () => {
        expect(extractEpubComicPages([], fileMap)).toEqual([]);
        expect(extractEpubComicPages(['OEBPS/text/p1.xhtml'], {})).toEqual([]);
    });
});
