import { describe, it, expect } from 'vitest';
import { resolveEpubHref } from 'pure/epubLink';

const CH = ['OEBPS/text/chapter1.xhtml', 'OEBPS/text/chapter2.xhtml', 'OEBPS/text/第一章.xhtml'];

describe('pure/epubLink resolveEpubHref', () => {
    it('同章锚点 #x → fragment', () => {
        expect(resolveEpubHref('#note1', CH)).toEqual({ kind: 'fragment', fragment: 'note1' });
        expect(resolveEpubHref('#', CH)).toEqual({ kind: 'unknown' });
    });

    it('同文件带锚点（chapter1.xhtml#x）→ chapter 0 + fragment', () => {
        expect(resolveEpubHref('chapter1.xhtml#x', CH)).toEqual({ kind: 'chapter', index: 0, fragment: 'x' });
    });

    it('相对路径 ../Text/c2 之类写法按文件名兜底命中', () => {
        expect(resolveEpubHref('../text/chapter2.xhtml#p3', CH)).toEqual({ kind: 'chapter', index: 1, fragment: 'p3' });
    });

    it('百分号编码的中文文件名可命中', () => {
        const enc = 'OEBPS/text/%E7%AC%AC%E4%B8%80%E7%AB%A0.xhtml';
        expect(resolveEpubHref(enc, CH)).toEqual({ kind: 'chapter', index: 2, fragment: '' });
    });

    it('http / mailto → external（交给系统浏览器）', () => {
        expect(resolveEpubHref('https://example.com/a', CH)).toMatchObject({ kind: 'external' });
        expect(resolveEpubHref('mailto:a@b.c', CH)).toMatchObject({ kind: 'external' });
    });

    it('未知目标 / 空 → unknown（只拦导航、不做动作）', () => {
        expect(resolveEpubHref('not-in-book.xhtml', CH)).toEqual({ kind: 'unknown' });
        expect(resolveEpubHref('', CH)).toEqual({ kind: 'unknown' });
        expect(resolveEpubHref('   ', CH)).toEqual({ kind: 'unknown' });
    });

    it('带协议但非 http/mailto（如 file:）不当外部链接处理', () => {
        expect(resolveEpubHref('file:///tmp/a.xhtml', CH)).toEqual({ kind: 'unknown' });
    });

    it('章节表为空时不会误判为第 0 章', () => {
        expect(resolveEpubHref('chapter1.xhtml', [])).toEqual({ kind: 'unknown' });
    });
});
