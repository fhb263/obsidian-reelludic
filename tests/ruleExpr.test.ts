/**
 * `pure/ruleExpr` 单测（#419）—— 规则串编译与请求参数模板。
 * 语法取自真实书源（`td.even > a` / `… > a@href` / `@js:` / `%s` 占位）。
 */
import { describe, expect, it } from 'vitest';
import {
    compileRule,
    fillSearchParams,
    fillSearchUrl,
    parseLooseParams,
    ruleSupported,
    ruleUnsupportedText,
} from 'pure/ruleExpr';

describe('ruleExpr · 取值后缀', () => {
    it('裸选择器 ⇒ 取文本', () => {
        expect(compileRule('td.even > a')).toEqual({ raw: 'td.even > a', selector: 'td.even > a', take: 'text' });
        expect(compileRule('  #content  ').selector).toBe('#content');
    });

    it('`@href` / `@src` ⇒ 取属性（属性名**统一转小写**）', () => {
        expect(compileRule('#info > p:nth-child(5) > a@href')).toEqual({
            raw: '#info > p:nth-child(5) > a@href',
            selector: '#info > p:nth-child(5) > a',
            take: 'attr',
            attr: 'href',
        });
        expect(compileRule('img@SRC').attr).toBe('src');
        expect(compileRule('a@data-id').attr).toBe('data-id');
    });

    it('`@text` / `@textNodes` / `@ownText` ⇒ 仍是取文本（兼容写法，与裸选择器等价）', () => {
        for (const t of ['text', 'textNodes', 'ownText', 'TEXT']) {
            expect(compileRule(`#content@${t}`)).toEqual({ raw: `#content@${t}`, selector: '#content', take: 'text' });
        }
    });

    it('`@html` / `@outerHtml` ⇒ 取 HTML 串', () => {
        for (const t of ['html', 'outerHtml']) {
            expect(compileRule(`#content@${t}`).take).toBe('html');
        }
    });

    it('🔴 用**最后一个** `@` 切分（`@` 只出现在后缀位；CSS 属性选择器写的是 `[a="v"]`）', () => {
        expect(compileRule('div[data-x="a@b"] > span@href')).toEqual({
            raw: 'div[data-x="a@b"] > span@href',
            selector: 'div[data-x="a@b"] > span',
            take: 'attr',
            attr: 'href',
        });
    });
});

describe('ruleExpr · 明确不支持的两类（⛔ 绝不静默返回空）', () => {
    it('`@js:` ⇒ unsupported=js，且把选择器前半段留着（诊断显示用）', () => {
        const c = compileRule('#htmlContent@js:var qsbs={_keyStr:"x"};return r');
        expect(c.unsupported).toBe('js');
        expect(c.selector).toBe('#htmlContent');
        expect(ruleSupported(c)).toBe(false);
        expect(ruleUnsupportedText(c, '章节正文')).toContain('不执行脚本');
    });

    it('以 `/` 开头 ⇒ unsupported=xpath', () => {
        expect(compileRule('/html/body/div').unsupported).toBe('xpath');
        expect(compileRule('//div[@class="x"]').unsupported).toBe('xpath');
        expect(ruleUnsupportedText(compileRule('/a/b'), '目录条目')).toContain('只支持 CSS');
    });

    it('🔴 G3：以 `(` 开头也当 XPath（`(//div)[1]` 这种被当 CSS 去 querySelectorAll 会直接抛错）', () => {
        expect(compileRule('(//div)[1]').unsupported).toBe('xpath');
        expect(compileRule('  (//div[@id="c"])[1]').unsupported).toBe('xpath');
        // ⛔ 别误伤正常 CSS（CSS 不以 `(` 开头）
        expect(compileRule('div:not(.ad)').unsupported).toBeUndefined();
        expect(compileRule('p:nth-child(2) > a').unsupported).toBeUndefined();
    });

    it('空串 / 只有 `@` 没选择器 ⇒ unsupported=empty', () => {
        expect(compileRule('').unsupported).toBe('empty');
        expect(compileRule('   ').unsupported).toBe('empty');
        expect(compileRule('  @href').unsupported).toBe('empty');
        expect(ruleUnsupportedText(compileRule(''), '书名')).toContain('规则是空的');
    });

    it('选择器后面光秃秃一个 `@` ⇒ 当取文本（宽松处理，别当错误）', () => {
        expect(compileRule('#content@')).toEqual({ raw: '#content@', selector: '#content', take: 'text' });
    });

    it('🔴 G2：`meta[…]` 改取 `content` 属性 —— meta 没有文本节点，按文本取**永远是空的**', () => {
        expect(compileRule('meta[property="og:image"]')).toEqual({
            raw: 'meta[property="og:image"]',
            selector: 'meta[property="og:image"]',
            take: 'attr',
            attr: 'content',
        });
        // 空白与大小写都要容
        expect(compileRule('  META [property="og:image"] ').take).toBe('attr');
        // 书源自己写了后缀 ⇒ 以书源为准（别覆盖）
        expect(compileRule('meta[property="og:image"]@href')).toEqual({
            raw: 'meta[property="og:image"]@href',
            selector: 'meta[property="og:image"]',
            take: 'attr',
            attr: 'href',
        });
        // ⛔ 别误伤：普通选择器里出现 meta 这个词不算
        expect(compileRule('div.meta-info').take).toBe('text');
    });
});

describe('ruleExpr · 请求参数模板', () => {
    it('宽松解析 `{k: v, k2: v2}`（键可以不带引号 —— SoNovel 模板里就是这样）', () => {
        expect(parseLooseParams('{searchkey: %s}')).toEqual({ searchkey: '%s' });
        expect(parseLooseParams('{searchkey: %s, searchtype: all}')).toEqual({ searchkey: '%s', searchtype: 'all' });
        expect(parseLooseParams('{"a": "1", "b": "2"}')).toEqual({ a: '1', b: '2' });
        expect(parseLooseParams('{}')).toEqual({});
        expect(parseLooseParams('')).toEqual({});
    });

    it('缺右括号 / 写坏了 ⇒ 尽力而为，⛔ 不抛（用户文件里的一个小手误不该让整次搜索崩掉）', () => {
        expect(parseLooseParams('{searchkey: %s')).toEqual({ searchkey: '%s' });
    });

    it('`%s` 灌关键词（模板里写几处就替换几处）', () => {
        expect(fillSearchParams('{searchkey: %s}', '红楼梦')).toEqual({ searchkey: '红楼梦' });
        expect(fillSearchParams('{a: %s, b: %s}', 'x')).toEqual({ a: 'x', b: 'x' });
    });

    it('URL 上的 `%s` 要**编码**（`…/search.php?key=%s` 这种源）', () => {
        expect(fillSearchUrl('https://example.com/s?key=%s', '红楼梦')).toBe(
            `https://example.com/s?key=${encodeURIComponent('红楼梦')}`,
        );
        expect(fillSearchUrl('https://example.com/list', '红楼梦')).toBe('https://example.com/list');
    });
});
