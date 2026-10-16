import { describe, expect, it } from 'vitest';
import {
    collectEpubResourceRefs,
    epubResourceMime,
    isEpubResourcePath,
    resolveEpubResource,
    rewriteEpubResourceUrls,
} from 'pure/epubResource';

describe('resolveEpubResource · 正文引用 → 包内路径', () => {
    it('同目录相对路径按章节所在目录拼接', () => {
        expect(resolveEpubResource('OEBPS/text', 'p001.jpg')).toBe('OEBPS/text/p001.jpg');
    });

    it('`../` 回退到上级目录（EPUB 里最常见的 images 目录写法）', () => {
        expect(resolveEpubResource('OEBPS/text', '../images/p001.jpg')).toBe('OEBPS/images/p001.jpg');
    });

    it('`./` 与多余分隔符被归一', () => {
        expect(resolveEpubResource('OEBPS', './images//p001.jpg')).toBe('OEBPS/images/p001.jpg');
    });

    it('根相对路径从包根算起（⛔ 不拼 baseDir）', () => {
        expect(resolveEpubResource('OEBPS/text', '/images/p001.jpg')).toBe('images/p001.jpg');
    });

    it('去掉 fragment 与 query', () => {
        expect(resolveEpubResource('OEBPS', 'p1.jpg#frag')).toBe('OEBPS/p1.jpg');
        expect(resolveEpubResource('OEBPS', 'style.css?v=2')).toBe('OEBPS/style.css');
    });

    it('百分号解码', () => {
        expect(resolveEpubResource('OEBPS', 'my%20page.jpg')).toBe('OEBPS/my page.jpg');
    });

    it('带协议 / 只剩锚点 / 空串 → null（外部资源不接管）', () => {
        expect(resolveEpubResource('OEBPS', 'https://x/y.jpg')).toBeNull();
        expect(resolveEpubResource('OEBPS', 'data:image/png;base64,AAA')).toBeNull();
        expect(resolveEpubResource('OEBPS', 'blob:abc')).toBeNull();
        expect(resolveEpubResource('OEBPS', '#frag')).toBeNull();
        expect(resolveEpubResource('OEBPS', '   ')).toBeNull();
    });

    it('`..` 越过包根时原地不动（⛔ 不上抛到包外）', () => {
        expect(resolveEpubResource('OEBPS', '../../../etc/passwd')).toBe('etc/passwd');
        expect(resolveEpubResource('', '../../x.jpg')).toBe('x.jpg');
    });
});

describe('collectEpubResourceRefs · 抽取待取资源', () => {
    it('抽 img/src、image href、xlink:href、source/src、link/href（按首现顺序、去重）', () => {
        const html = `
          <img src="a.jpg">
          <image xlink:href="../img/b.png"/>
          <source src='c.webp'>
          <link rel="stylesheet" href="style.css">
          <img src="a.jpg">
        `;
        expect(collectEpubResourceRefs(html, 'OEBPS/text')).toEqual([
            'OEBPS/text/a.jpg',
            'OEBPS/img/b.png',
            'OEBPS/text/c.webp',
            'OEBPS/text/style.css',
        ]);
    });

    it('跳过外部资源与纯锚点', () => {
        const html = '<img src="https://x/y.jpg"><img src="#z"><img src="local.jpg">';
        expect(collectEpubResourceRefs(html, 'OEBPS')).toEqual(['OEBPS/local.jpg']);
    });

    it('空 / 无引用 → 空数组', () => {
        expect(collectEpubResourceRefs('', 'OEBPS')).toEqual([]);
        expect(collectEpubResourceRefs('<p>纯文字</p>', 'OEBPS')).toEqual([]);
    });
});

describe('rewriteEpubResourceUrls · 换成 blob URL', () => {
    const urlOf = (p: string): string | null => (p.endsWith('.jpg') ? `blob:fake/${p}` : null);

    it('包内图片引用被替换，正文文字与标签结构不动', () => {
        const out = rewriteEpubResourceUrls('<p>正文</p><img src="a.jpg" alt="x">', 'OEBPS', urlOf);
        expect(out).toBe('<p>正文</p><img src="blob:fake/OEBPS/a.jpg" alt="x">');
    });

    it('单引号属性同样被替换', () => {
        const out = rewriteEpubResourceUrls("<img src='a.jpg'>", 'OEBPS', urlOf);
        expect(out).toBe('<img src=\'blob:fake/OEBPS/a.jpg\'>');
    });

    it('取不到的引用**保留原样**（⛔ 不替换成空串 —— 那会退化成当前页请求）', () => {
        const out = rewriteEpubResourceUrls('<img src="missing.png">', 'OEBPS', urlOf);
        expect(out).toBe('<img src="missing.png">');
    });

    it('外部资源 / 纯锚点**一字不动**', () => {
        const html = '<img src="https://x/y.jpg"><a href="#z">锚</a>';
        expect(rewriteEpubResourceUrls(html, 'OEBPS', urlOf)).toBe(html);
    });

    it('保留 fragment（SVG `<use href="sprite.svg#icon">` 只换文件那段）', () => {
        const out = rewriteEpubResourceUrls('<image href="sprite.svg#icon"/>', 'OEBPS', () => 'blob:S');
        expect(out).toBe('<image href="blob:S#icon"/>');
    });

    it('无引号属性不误伤（正则只认带引号的写法）', () => {
        const html = '<img src=a.jpg>';
        expect(rewriteEpubResourceUrls(html, 'OEBPS', urlOf)).toBe(html);
    });

    it('多个引用一次性全换', () => {
        const out = rewriteEpubResourceUrls('<img src="a.jpg"><img src="../i/b.jpg">', 'OEBPS/t', urlOf);
        expect(out).toContain('blob:fake/OEBPS/t/a.jpg');
        expect(out).toContain('blob:fake/OEBPS/i/b.jpg');
    });
});

describe('isEpubResourcePath · 该不该去 zip 取二进制', () => {
    it('图片 / 样式表 / 字体 → true', () => {
        expect(isEpubResourcePath('OEBPS/a.jpg')).toBe(true);
        expect(isEpubResourcePath('OEBPS/style.css')).toBe(true);
        expect(isEpubResourcePath('OEBPS/f.ttf')).toBe(true);
    });

    it('章节本体与 XML 系 → false（它们已在 fileMap 里，别重复取）', () => {
        expect(isEpubResourcePath('OEBPS/ch1.xhtml')).toBe(false);
        expect(isEpubResourcePath('OEBPS/ch1.html')).toBe(false);
        expect(isEpubResourcePath('content.opf')).toBe(false);
        expect(isEpubResourcePath('toc.ncx')).toBe(false);
    });

    it('无扩展名 / 隐藏文件 → false', () => {
        expect(isEpubResourcePath('OEBPS/noext')).toBe(false);
        expect(isEpubResourcePath('OEBPS/.hidden')).toBe(false);
        expect(isEpubResourcePath('OEBPS/trailing.')).toBe(false);
    });
});

describe('epubResourceMime · Blob 类型', () => {
    it('常见图片扩展名', () => {
        expect(epubResourceMime('a.png')).toBe('image/png');
        expect(epubResourceMime('a.JPG')).toBe('image/jpeg');
        expect(epubResourceMime('a.jpeg')).toBe('image/jpeg');
        expect(epubResourceMime('a.svg')).toBe('image/svg+xml');
        expect(epubResourceMime('a.webp')).toBe('image/webp');
    });

    it('样式表与字体', () => {
        expect(epubResourceMime('s.css')).toBe('text/css');
        expect(epubResourceMime('f.woff2')).toBe('font/woff2');
    });

    it('未知扩展名回落 octet-stream', () => {
        expect(epubResourceMime('a.xyz')).toBe('application/octet-stream');
        expect(epubResourceMime('noext')).toBe('application/octet-stream');
    });
});
