// @vitest-environment jsdom
/**
 * `services/htmlQuery` 单测（#419）—— 规则执行器（**唯一**碰 DOM 的地方）。
 * 🔴 本文件用 jsdom 环境（文件头 docblock 覆盖 vitest.config 的 `node`）：
 *    这条链的语义就是浏览器 DOM 的语义，用假 DOM 测等于没测。
 */
import { describe, expect, it } from 'vitest';
import { compileRule } from 'pure/ruleExpr';
import { applyRule, applyRuleOne, elementText, extractChapterText, parseHtml, queryAll, resolveUrl } from 'services/htmlQuery';

describe('htmlQuery · 取节点与取值', () => {
    it('🔴 与浏览器/Jsoup 同语义：表格**自动补 `<tbody>`**（真实书源就依赖这一点）', () => {
        const doc = parseHtml('<form id="checkform"><table><tr><td>x</td></tr></table></form>');
        expect(doc.querySelector('table')?.innerHTML).toContain('<tbody>');
        expect(queryAll(doc, '#checkform > table > tbody > tr').els.length).toBe(1);
    });

    it('裸选择器取文本（空白归一）；`@href` 取属性并**解析成绝对地址**', () => {
        const doc = parseHtml('<dl><dd><a href="/ch/12.html?id=3">  第 12 章   风起 </a></dd></dl>');
        expect(applyRuleOne(doc, compileRule('dd > a'), 'https://example.com/book/1.html')).toBe('第 12 章 风起');
        expect(applyRuleOne(doc, compileRule('dd > a@href'), 'https://example.com/book/1.html')).toBe(
            'https://example.com/ch/12.html?id=3',
        );
    });

    it('非 URL 属性原样返回（⛔ 别拿 `data-id` 去拼域名）', () => {
        const doc = parseHtml('<a data-id="7" title=" 标题 ">x</a>');
        expect(applyRuleOne(doc, compileRule('a@data-id'), 'https://example.com/')).toBe('7');
        expect(applyRuleOne(doc, compileRule('a@title'), 'https://example.com/')).toBe('标题');
    });

    it('`@html` 取 HTML 串', () => {
        const doc = parseHtml('<div id="c">甲<b>乙</b></div>');
        expect(applyRuleOne(doc, compileRule('#c@html'), 'https://example.com/')).toBe('甲<b>乙</b>');
    });

    it('🔴 选择器写坏 ⇒ `invalid`（**与「合法但 0 命中」分开**，⛔ 不许冒充空结果）', () => {
        const doc = parseHtml('<div>x</div>');
        const bad = queryAll(doc, 'div >> p');
        expect(bad.invalid).toBeTruthy();
        expect(bad.els).toEqual([]);
        const ok = queryAll(doc, 'p');
        expect(ok.invalid).toBeUndefined();
        expect(ok.els).toEqual([]);
    });

    it('取全部命中 / 只取第一个 / `missing` 三态', () => {
        const doc = parseHtml('<i>甲</i><i>乙</i>');
        expect(applyRule(doc, compileRule('i'), 'https://example.com/').values).toEqual(['甲', '乙']);
        expect(applyRuleOne(doc, compileRule('i'), 'https://example.com/')).toBe('甲');
        expect(applyRule(doc, compileRule('em'), 'https://example.com/').missing).toBeTruthy();
        expect(applyRuleOne(doc, compileRule('em'), 'https://example.com/')).toBe('');
    });

    it('`resolveUrl`：绝对 / 相对 / 协议相对 / 空 / 锚点', () => {
        const b = 'https://example.com/a/b.html';
        expect(resolveUrl(b, 'https://other.com/x')).toBe('https://other.com/x');
        expect(resolveUrl(b, '/c.html')).toBe('https://example.com/c.html');
        expect(resolveUrl(b, 'c.html')).toBe('https://example.com/a/c.html');
        expect(resolveUrl(b, '//cdn.com/x.js')).toBe('https://cdn.com/x.js');
        expect(resolveUrl(b, '')).toBe('');
        expect(resolveUrl(b, '#top')).toBe('https://example.com/a/b.html#top');
    });

    it('`elementText` 归一空白与 NBSP', () => {
        const doc = parseHtml('<p>甲\u00a0 乙\n 丙</p>');
        expect(elementText(doc.querySelector('p')!)).toBe('甲 乙 丙');
    });
});

describe('htmlQuery · G2：`meta[…]` 的特殊处理（#420 按参考实现补）', () => {
    const HTML =
        '<html><head><meta property="og:image" content="https://cdn.example.com/c.jpg"></head>' +
        '<body><div id="row"><span>书名</span><a href="/b/1.html">去</a></div></body></html>';

    it('🔴 从**整个文档**查（meta 在 `<head>` 里，绝不可能落在某一行搜索结果内部）', () => {
        const doc = parseHtml(HTML);
        const row = doc.querySelector('#row')!;
        // 传的是**行元素**，但 meta 规则必须能从文档范围取到
        expect(applyRuleOne(row, compileRule('meta[property="og:image"]'), 'https://example.com/')).toBe(
            'https://cdn.example.com/c.jpg',
        );
        // 反证：同样的取值方式，不用 meta 特判时是取不到的（这就是 G2 之前的表现）
        expect(applyRuleOne(row, { raw: 'meta[property="og:image"]', selector: 'meta[property="og:image"]', take: 'text' }, 'https://example.com/')).toBe('');
    });

    it('`meta` 上要 `href` 而它没有 ⇒ 回落 `content`', () => {
        const doc = parseHtml(HTML);
        expect(applyRuleOne(doc, compileRule('meta[property="og:image"]@href'), 'https://example.com/')).toBe(
            'https://cdn.example.com/c.jpg',
        );
    });

    it('`content` 是相对地址时会按页面地址补全', () => {
        const doc = parseHtml('<html><head><meta property="og:image" content="/img/c.jpg"></head><body>x</body></html>');
        expect(applyRuleOne(doc, { raw: 'm', selector: 'meta[property="og:image"]', take: 'attr', attr: 'src' }, 'https://example.com/a/b.html')).toBe(
            'https://example.com/img/c.jpg',
        );
    });
});

describe('htmlQuery · 正文取文本', () => {
    const HTML = `<div id="content">正文一<br><br>正文二<div class="ad">广告块</div>正文三<script>bad()</script></div>`;
    const el = () => parseHtml(HTML).querySelector('#content')!;

    it('🔴 先删 `filterTag` 块 ⇒ 再按 `<br>` 分段 ⇒ 最后取文本（⛔ 顺序不能反）', () => {
        const t = extractChapterText(el(), { filterTag: 'div, script', paragraphTag: '<br>+', baseUrl: 'https://e.com/1' });
        expect(t).not.toContain('广告块');
        expect(t).not.toContain('bad()');
        expect(t.replace(/\s+/g, '')).toBe('正文一正文二正文三');
    });

    it('删的是**克隆体** —— 原文档不被污染（活节点上 `remove()` 会连带毁掉调用方的文档）', () => {
        const node = el();
        extractChapterText(node, { filterTag: 'div.ad', baseUrl: 'https://e.com/1' });
        expect(node.querySelector('div.ad')).toBeTruthy();
    });

    it('`paragraphTagClosed` ⇒ 按块级闭合标签分段（不看 `paragraphTag`）', () => {
        const doc = parseHtml('<div id="c"><p>甲</p><p>乙</p><p>丙</p></div>');
        const t = extractChapterText(doc.querySelector('#c')!, { paragraphTagClosed: true, baseUrl: 'https://e.com/1' });
        expect(t.split(/\n+/).map((s) => s.trim()).filter(Boolean)).toEqual(['甲', '乙', '丙']);
    });

    it('`paragraphTag` 正则写坏 ⇒ 退回按 `<br>` 分段（⛔ 不让整章变成一坨）', () => {
        const doc = parseHtml('<div id="c">甲<br>乙</div>');
        const t = extractChapterText(doc.querySelector('#c')!, { paragraphTag: '([坏', baseUrl: 'https://e.com/1' });
        expect(t.split(/\n+/).map((s) => s.trim()).filter(Boolean)).toEqual(['甲', '乙']);
    });

    it('HTML 实体由 DOM 解码（`&amp;` → `&`）', () => {
        const doc = parseHtml('<div id="c">甲&amp;乙&lt;丙</div>');
        expect(extractChapterText(doc.querySelector('#c')!, { baseUrl: 'https://e.com/1' })).toBe('甲&乙<丙');
    });
});
