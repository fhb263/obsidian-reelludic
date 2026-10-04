// @vitest-environment jsdom
/**
 * `services/novelSource` 单测（#419）—— 搜索 / 目录 / 抓章全链路（注入假源站）。
 *
 * 🔴 样本的**选择器写法照抄真实书源**（`#checkform > table > tbody > tr`、`td:nth-of-type(3)`、
 *    `#list > dl > dd > a`、`<br>+` 分段、`filterTxt` 水印），域名与站名一律中性值。
 */
import { describe, expect, it } from 'vitest';
import { CancelledError, createCancelToken } from 'pure/cancel';
import type { NovelSource } from 'pure/sourceRule';
import {
    NOVEL_CHAPTER_CONCURRENCY,
    fetchNovelChapters,
    fetchNovelToc,
    fetchNovelTocOrWhole,
    wholeBookTocItems,
    searchNovelSource,
    searchNovelSources,
    type NovelFetch,
    type NovelRequest,
    type NovelSearchHit,
} from 'services/novelSource';

const SRC: NovelSource = {
    url: 'https://example.com/',
    name: '示例源甲',
    crawl: { minInterval: 1, maxInterval: 1, maxAttempts: 2 },
    search: {
        url: 'https://example.com/modules/article/waps.php',
        method: 'post',
        data: '{searchkey: %s}',
        result: '#checkform > table > tbody > tr',
        bookName: 'td.even > a',
        author: 'td:nth-of-type(3)',
        latestChapter: 'td.odd > a',
    },
    toc: { item: '#list > dl > dd > a' },
    chapter: {
        title: '.bookname > h1',
        content: '#content',
        paragraphTag: '<br>+',
        filterTxt: '一秒记住【示例阅读】，精彩无弹窗免费阅读！',
        filterTag: 'div.ad, script',
    },
};

const SEARCH_HTML = `<html><body><form id="checkform"><table><tbody>
<tr><td class="even"><a href="/book/1001.html">示例书名甲</a></td><td>x</td><td>示例作者甲</td><td>2026-01-01</td><td class="odd"><a href="/ch/9.html">第 9 章 尾</a></td></tr>
<tr><td class="even"><a href="/book/1002.html">示例书名乙</a></td><td>x</td><td>示例作者乙</td><td>2026-01-02</td><td class="odd"><a href="/ch/3.html">第 3 章</a></td></tr>
</tbody></table></form></body></html>`;

const TOC_HTML = `<html><body>
<div class="bookname"><h1>示例书名甲</h1></div>
<div id="list"><dl>
<dd><a href="/ch/1.html">第一章 风起</a></dd>
<dd><a href="/ch/2.html">第二章 雨落</a></dd>
<dd><a href="/ch/1.html">重复项（应被去重）</a></dd>
</dl></div></body></html>`;

function chapterHtml(no: number, extraAd = ''): string {
    return `<html><body><div class="bookname"><h1>第 ${no} 章 风起</h1></div>
<div id="content">正文${no}一<br><br>正文${no}二<div class="ad">广告块</div>正文${no}三<br>一秒记住【示例阅读】，精彩无弹窗免费阅读！${extraAd}</div>
</body></html>`;
}

const PAGES: Record<string, string> = {
    '/modules/article/waps.php': SEARCH_HTML,
    '/book/1001.html': TOC_HTML,
    '/ch/1.html': chapterHtml(1),
    '/ch/2.html': chapterHtml(2),
};

/** 假源站：按 pathname 返回页面；可指定某些 URL「前 N 次失败」来验重试；`jump` = 模拟**重定向**（返回目标页内容 + 目标页最终 URL） */
function fakeSite(
    pages: Record<string, string> = PAGES,
    failFirst: Record<string, number> = {},
    jump: Record<string, string> = {},
) {
    const calls: NovelRequest[] = [];
    const left = { ...failFirst };
    const fetch: NovelFetch = async (req) => {
        calls.push(req);
        const key = (() => {
            try {
                return new URL(req.url).pathname;
            } catch {
                return req.url;
            }
        })();
        if (left[key] !== undefined && left[key] > 0) {
            left[key]--;
            throw new Error('ECONNRESET');
        }
        // 重定向：请求 key，实际落在 jump[key] 那一页（`finalUrl` 报的是**目标页**）
        const real = jump[key] ?? key;
        const text = pages[real];
        return text === undefined
            ? { status: 404, text: '<html>not found</html>' }
            : { status: 200, text, finalUrl: `https://example.com${real}` };
    };
    return { fetch, calls };
}

describe('novelSource · 搜索', () => {
    it('POST 表单体带上关键词（`%s` 占位）；解析出书名 / 作者 / 最新章节 / **绝对**书籍地址', async () => {
        const { fetch, calls } = fakeSite();
        const out = await searchNovelSource(fetch, SRC, '红楼梦');
        expect(calls.length).toBe(1);
        expect(calls[0].method).toBe('POST');
        expect(new URLSearchParams(calls[0].body ?? '').get('searchkey')).toBe('红楼梦');
        expect(out.error).toBeUndefined();
        expect(out.hits.map((h) => h.title)).toEqual(['示例书名甲', '示例书名乙']);
        expect(out.hits[0].author).toBe('示例作者甲');
        expect(out.hits[0].latestChapter).toBe('第 9 章 尾');
        expect(out.hits[0].bookUrl).toBe('https://example.com/book/1001.html');
        expect(out.hits[0].sourceName).toBe('示例源甲');
    });

    it('GET 源（`method: get`）不带表单体', async () => {
        const { fetch, calls } = fakeSite({ '/s?key=%E7%BA%A2': SEARCH_HTML });
        const src: NovelSource = { ...SRC, search: { ...SRC.search!, url: 'https://example.com/s?key=%s', method: 'get' } };
        await searchNovelSource(fetch, src, '红');
        expect(calls[0].method).toBe('GET');
        expect(calls[0].body).toBeUndefined();
        expect(calls[0].url).toBe(`https://example.com/s?key=${encodeURIComponent('红')}`);
    });

    it('`bookName` 命中的不是 `<a>`（链接在旁边的 `<a>` 上）⇒ 退回该行第一个 `<a href>`', async () => {
        const html = `<form id="checkform"><table><tbody><tr><td class="even"><span class="name">示例书名丙</span></td><td>x</td><td>示例作者丙</td><td>d</td><td class="odd"><a href="/book/1003.html">看</a></td></tr></tbody></table></form>`;
        const { fetch } = fakeSite({ '/modules/article/waps.php': html });
        const src: NovelSource = { ...SRC, search: { ...SRC.search!, bookName: 'span.name' } };
        const out = await searchNovelSource(fetch, src, 'x');
        expect(out.hits[0].bookUrl).toBe('https://example.com/book/1003.html');
    });

    it('🔴 搜索被禁用 / 没给 search ⇒ `note`（与 `error` 分开，UI 文案不同）', async () => {
        const { fetch } = fakeSite();
        expect((await searchNovelSource(fetch, { ...SRC, search: undefined }, 'x')).note).toContain('没提供搜索');
        expect((await searchNovelSource(fetch, { ...SRC, search: { ...SRC.search!, disabled: true } }, 'x')).note).toContain('没提供搜索');
    });

    it('🔴 结果是脚本规则 ⇒ **报明确原因**，⛔ 不假装 0 条', async () => {
        const { fetch } = fakeSite();
        const src: NovelSource = { ...SRC, search: { ...SRC.search!, result: '.row@js:return r' } };
        const out = await searchNovelSource(fetch, src, 'x');
        expect(out.hits).toEqual([]);
        expect(out.error).toContain('不执行脚本');
        expect(out.error).toContain('搜索结果列表');
    });

    it('选择器合法但 0 命中 ⇒ 报「没匹配到任何结果（该源可能已改版或失效）」', async () => {
        const { fetch } = fakeSite({ '/modules/article/waps.php': '<html><body><i>啥也没有</i></body></html>' });
        const out = await searchNovelSource(fetch, SRC, 'x');
        expect(out.error).toContain('没匹配到任何结果');
    });

    it('非 2xx ⇒ 报 `HTTP 404`（正文多半是错误页，交给解析只会静默 0 条）', async () => {
        const { fetch } = fakeSite({}); // 全 404
        const out = await searchNovelSource(fetch, SRC, 'x');
        expect(out.error).toBe('HTTP 404');
    });

    it('网络层抛错 ⇒ 原样回报（`ECONNRESET` 由 UI 侧折成人话）', async () => {
        const { fetch } = fakeSite(PAGES, { '/modules/article/waps.php': 99 });
        const out = await searchNovelSource(fetch, SRC, 'x');
        expect(out.error).toBe('ECONNRESET');
    });
});

describe('novelSource · G1：搜索命中唯一结果时站点**直接跳详情页**（#420 按参考实现补）', () => {
    /** 详情页（没有搜索结果表格 —— 站点直接把我们送到了这里） */
    const DETAIL = `<html><body><div class="bookname"><h1>示例书名甲</h1></div>
<div id="info"><p>示例作者甲</p><p>最后更新：2026-01-01</p></div>
<div id="list"><dl><dd><a href="/ch/1.html">第一章</a></dd></dl></div></body></html>`;

    it('🔴 0 命中但详情页规则命中 ⇒ 用**最终 URL** 当书籍地址（⛔ 不报「源失效」）', async () => {
        const { fetch, calls } = fakeSite({ '/book/1001.html': DETAIL }, {}, { '/modules/article/waps.php': '/book/1001.html' });
        const src: NovelSource = { ...SRC, book: { bookName: '.bookname > h1', author: '#info > p:nth-child(1)' } };
        const out = await searchNovelSource(fetch, src, 'x');
        expect(out.error).toBeUndefined();
        expect(out.hits.length).toBe(1);
        expect(out.hits[0].title).toBe('示例书名甲');
        expect(out.hits[0].author).toBe('示例作者甲');
        // 🔴 关键：地址是**跳转之后**那一页，不是我们发出去的那个搜索地址
        expect(out.hits[0].bookUrl).toBe('https://example.com/book/1001.html');
        expect(out.hits[0].bookUrl).not.toContain('waps.php');
        expect(calls.length).toBe(1);
    });

    it('🔴 没有 `book.bookName` 规则 / 详情页也取不到书名 ⇒ **仍报「没匹配到任何结果」**（别乱认）', async () => {
        const { fetch } = fakeSite({ '/book/1001.html': DETAIL }, {}, { '/modules/article/waps.php': '/book/1001.html' });
        expect((await searchNovelSource(fetch, SRC, 'x')).error).toContain('没匹配到任何结果');
        const broken: NovelSource = { ...SRC, book: { bookName: '.no-such-thing' } };
        expect((await searchNovelSource(fetch, broken, 'x')).error).toContain('没匹配到任何结果');
    });

    it('搜索页**有自己的结果**时不会误走详情页分支（G1 只在 0 命中时生效）', async () => {
        const { fetch } = fakeSite();
        const src: NovelSource = { ...SRC, book: { bookName: '.bookname > h1' } };
        expect((await searchNovelSource(fetch, src, 'x')).hits.length).toBe(2);
    });
});

describe('novelSource · G4：搜索分页（#420）', () => {
    const P1 = SEARCH_HTML.replace(
        '</form>',
        '</form><div id="pagelink"><a href="/search/page2.html">下一页</a></div>',
    );
    const P2 = `<form id="checkform"><table><tbody>
<tr><td class="even"><a href="/book/1003.html">示例书名丙</a></td><td>x</td><td>示例作者丙</td><td>d</td><td class="odd"><a href="/ch/1.html">第 1 章</a></td></tr>
<tr><td class="even"><a href="/book/1001.html">重复的书名甲</a></td><td>x</td><td>甲</td><td>d</td><td class="odd"><a href="/ch/1.html">第 1 章</a></td></tr>
</tbody></table></form>`;
    const withPaging: NovelSource = { ...SRC, search: { ...SRC.search!, nextPage: '#pagelink > a' } };

    it('🔴 跟 `search.nextPage` 翻页并合并（**按书籍地址去重**）', async () => {
        const { fetch, calls } = fakeSite({ '/modules/article/waps.php': P1, '/search/page2.html': P2 });
        const out = await searchNovelSource(fetch, withPaging, 'x');
        expect(calls.length).toBe(2);
        expect(out.hits.map((h) => h.title)).toEqual(['示例书名甲', '示例书名乙', '示例书名丙']); // 第 2 页那条重复的被丢掉
        expect(out.hits.map((h) => h.bookUrl)).toEqual([
            'https://example.com/book/1001.html',
            'https://example.com/book/1002.html',
            'https://example.com/book/1003.html',
        ]);
    });

    it('没写 `nextPage` ⇒ 只请求一次（不翻页）', async () => {
        const { fetch, calls } = fakeSite({ '/modules/article/waps.php': P1, '/search/page2.html': P2 });
        await searchNovelSource(fetch, SRC, 'x');
        expect(calls.length).toBe(1);
    });

    it('🔴 `nextPage` 指回第一页 ⇒ **不死循环**（按 URL 去重兜住）', async () => {
        const loop = P1.replace('/search/page2.html', '/modules/article/waps.php');
        const { fetch, calls } = fakeSite({ '/modules/article/waps.php': loop });
        const out = await searchNovelSource(fetch, withPaging, 'x');
        expect(calls.length).toBe(1);
        expect(out.hits.length).toBe(2);
    });
});

describe('novelSource · 多源搜索', () => {
    it('跳过停用源；**返回顺序与传入一致**；`onPartial` 渐进上报', async () => {
        const { fetch } = fakeSite();
        const off: NovelSource = { ...SRC, name: '停用源', disabled: true };
        const second: NovelSource = { ...SRC, name: '示例源乙' };
        const partials: number[] = [];
        const out = await searchNovelSources(fetch, [SRC, off, second], 'x', {
            onPartial: (r) => partials.push(r.length),
        });
        expect(out.length).toBe(2); // 停用源不参与
        expect(out.map((r) => r.sourceName)).toEqual(['示例源甲', '示例源乙']);
        expect(partials.length).toBeGreaterThan(0);
        expect(partials[partials.length - 1]).toBe(2);
    });

    it('单源失败**不影响**其它源', async () => {
        const bad: NovelSource = { ...SRC, name: '坏源', search: { ...SRC.search!, result: 'div >> p' } };
        const { fetch } = fakeSite();
        const out = await searchNovelSources(fetch, [bad, SRC], 'x');
        expect(out[0].error).toBeTruthy();
        expect(out[1].hits.length).toBe(2);
    });
});

describe('novelSource · 目录', () => {
    it('取章节链接（**绝对化 + 按 URL 去重**）并重新编号', async () => {
        const { fetch } = fakeSite();
        const out = await fetchNovelToc(fetch, SRC, 'https://example.com/book/1001.html');
        expect(out.error).toBeUndefined();
        expect(out.items.map((i) => i.no)).toEqual([1, 2]);
        expect(out.items.map((i) => i.title)).toEqual(['第一章 风起', '第二章 雨落']);
        expect(out.items[0].url).toBe('https://example.com/ch/1.html');
    });

    it('`toc.isDesc` ⇒ 翻回阅读顺序再编号（书源注明新章在前时）', async () => {
        const { fetch } = fakeSite();
        const out = await fetchNovelToc(fetch, { ...SRC, toc: { ...SRC.toc, isDesc: true } }, 'https://example.com/book/1001.html');
        expect(out.items.map((i) => i.title)).toEqual(['第二章 雨落', '第一章 风起']);
        expect(out.items.map((i) => i.no)).toEqual([1, 2]);
    });

    it('🔴 `nextPage` 指向自己 ⇒ **不死循环**（按 URL 去重兜住）', async () => {
        const html = `<html><body><div id="list"><dl><dd><a href="/ch/1.html">第一章</a></dd></dl></div><a id="next" href="/book/1001.html">下一页</a></body></html>`;
        const { fetch } = fakeSite({ '/book/1001.html': html });
        const src: NovelSource = { ...SRC, toc: { ...SRC.toc, nextPage: '#next' } };
        const out = await fetchNovelToc(fetch, src, 'https://example.com/book/1001.html');
        expect(out.items.length).toBe(1);
    });

    it('`toc.item` 缺 / 空 ⇒ 明确原因（⛔ 不静默回空目录）', async () => {
        const { fetch } = fakeSite();
        const out = await fetchNovelToc(fetch, { ...SRC, toc: { item: '' } }, 'https://example.com/book/1001.html');
        expect(out.error).toBe('目录条目的规则是空的');
    });

    it('`toc.item` 合法但页面改版 ⇒ 报「没匹配到任何章节」', async () => {
        const { fetch } = fakeSite({ '/book/1001.html': '<html><body><i>改版了</i></body></html>' });
        const out = await fetchNovelToc(fetch, SRC, 'https://example.com/book/1001.html');
        expect(out.error).toContain('没匹配到任何章节');
    });

    it('🔴 #424 `toc.url` 是 **URL 模板**（`%s` ← `book.url` 正则从书籍页地址取出的书籍 ID）'
        + '—— 对齐 so-novel `TocParser`；⛔ 本仓 #424 之前把它当「目录链接选择器」，真实书源里 6 条全废'
        + '（用户上手实测：「唯一能连上的那个源，点开书就报没找到链接」）', async () => {
        const { fetch, calls } = fakeSite({
            '/book/1001/': '<html><body>详情页（目录在另一个页面上）</body></html>',
            '/read/1001/index.html': TOC_HTML,
        });
        const src: NovelSource = {
            ...SRC,
            book: { url: 'https://example.com/book/(.*?)/' },
            toc: { ...SRC.toc, url: 'https://example.com/read/%s/index.html' },
        };
        const out = await fetchNovelToc(fetch, src, 'https://example.com/book/1001/');
        expect(out.error).toBeUndefined();
        expect(calls.map((c) => c.url)).toContain('https://example.com/read/1001/index.html');
        expect(out.items.map((i) => i.title)).toEqual(['第一章 风起', '第二章 雨落']);
    });

    it('🔴 #424 模板里有 `%s` 但 `book.url` 取不出 ID ⇒ **明确原因**（连规则原文一起给，好对照改源）', async () => {
        const { fetch } = fakeSite({ '/book/1001/': '<html><body>详情页</body></html>' });
        const src: NovelSource = {
            ...SRC,
            // 规则的域名与书籍页地址根本不符 ⇒ 匹配不上、拿不到捕获组
            book: { url: 'https://other.example/id/(\\d+)' },
            toc: { ...SRC.toc, url: 'https://example.com/read/%s/index.html' },
        };
        const out = await fetchNovelToc(fetch, src, 'https://example.com/book/1001/');
        expect(out.error).toContain('没能从书籍页地址里取出书籍 ID');
        // 规则原文必须带出来 —— 否则用户不知道该去改哪一项
        expect(out.error).toContain('https://other.example/id/(\\d+)');
    });

    it('🔴 #424 `toc.url` **不含** `%s` ⇒ 它本身就是目录页地址'
        + '（so-novel 的 `String.format` 对没有占位符的串原样返回 ⇒ 我们也照做）', async () => {
        const { fetch } = fakeSite({
            '/book/1001/': '<html><body>详情页</body></html>',
            '/catalog/1001.html': TOC_HTML,
        });
        const src: NovelSource = { ...SRC, toc: { ...SRC.toc, url: 'https://example.com/catalog/1001.html' } };
        const out = await fetchNovelToc(fetch, src, 'https://example.com/book/1001/');
        expect(out.error).toBeUndefined();
        expect(out.items.length).toBe(2);
    });

    // ── #457 文学源适配：目录拿不到 ⇒ 回退成「整页一章」 ──
    // 由来：网文源一定有目录，而**文学 / 公版源常见形态是「整本书一个页面」**
    // —— 既没有目录也没有章节 ⇒ 不回退，这一类源根本没法用。
    const HIT: NovelSearchHit = {
        sourceName: '示例源甲',
        sourceUrl: 'https://example.com/',
        title: '示例书名',
        author: '示例作者',
        category: '',
        latestChapter: '',
        bookUrl: 'https://example.com/book/1001.html',
    };

    it('🔴 #457 目录正常时**不回退**（不带 `wholePage`；⛔ 别把网文源也整页化）', async () => {
        const { fetch } = fakeSite();
        const out = await fetchNovelTocOrWhole(fetch, SRC, HIT);
        expect(out.error).toBeUndefined();
        expect(out.wholePage).toBeUndefined();
        expect(out.items.map((i) => i.title)).toEqual(['第一章 风起', '第二章 雨落']);
    });

    it('🔴 #457 页面改版 / 无目录 ⇒ **回退成整页一章**（标题 = 书名、地址 = 书籍页）', async () => {
        const { fetch } = fakeSite({ '/book/1001.html': '<html><body><i>改版了</i></body></html>' });
        const out = await fetchNovelTocOrWhole(fetch, SRC, HIT);
        expect(out.error).toBeUndefined();
        expect(out.items).toEqual([{ no: 1, title: '示例书名', url: 'https://example.com/book/1001.html' }]);
        expect(out.wholePage).toBe(true);
    });

    it('🔴 #457 回退**不静默**：`note` 带着原来的失败原因（UI 必须说给用户听）', async () => {
        const { fetch } = fakeSite({ '/book/1001.html': '<html><body><i>改版了</i></body></html>' });
        const out = await fetchNovelTocOrWhole(fetch, SRC, HIT);
        expect(out.note).toContain('没匹配到任何章节');
    });

    it('🔴 #457 连书籍页都没有 ⇒ **无从回退**，如实把错误抛回去（⛔ 别造一个空章）', async () => {
        const { fetch } = fakeSite();
        const out = await fetchNovelTocOrWhole(fetch, { ...SRC, toc: { item: '' } }, { ...HIT, bookUrl: '' });
        expect(out.items.length).toBe(0);
        expect(out.error).toBe('目录条目的规则是空的');
        expect(out.wholePage).toBeUndefined();
    });

    it('`wholeBookTocItems` 书名缺失 ⇒ 标题回落「（整本）」（⛔ 不写空标题）', () => {
        expect(wholeBookTocItems({ ...HIT, title: '   ' })[0].title).toBe('（整本）');
        expect(wholeBookTocItems({ ...HIT, title: '' })[0].title).toBe('（整本）');
        expect(wholeBookTocItems(HIT)[0]).toEqual({ no: 1, title: '示例书名', url: HIT.bookUrl });
    });
});

describe('novelSource · 抓章', () => {
    const items = [
        { no: 1, title: '第一章 风起', url: 'https://example.com/ch/1.html' },
        { no: 2, title: '第二章 雨落', url: 'https://example.com/ch/2.html' },
    ];

    it('正文净化：广告块被删、水印被清、`<br>` 分段保留；**章节页标题覆盖目录标题**', async () => {
        const { fetch } = fakeSite();
        const tasks = await fetchNovelChapters(fetch, SRC, items, { sleep: async () => {} });
        expect(tasks.every((t) => t.state === 'done')).toBe(true);
        expect(tasks[0].text).toContain('正文1一');
        expect(tasks[0].text).not.toContain('广告块');
        expect(tasks[0].text).not.toContain('一秒记住');
        expect(tasks[0].text).toContain('\n\n'); // 段落还在，没被压成一坨
        expect(tasks[0].title).toBe('第 1 章 风起');
    });

    it('🔴 #428 **章间不再等待**（#419 的「串行 + 每章硬等 `crawl.minInterval`」已被用户推翻 ——'
        + '书源模板那两个值实测归一成 2~3 秒，2277 章要跑一个半小时）｜顺带：**顺序成功 ⇒ 一次都不等**', async () => {
        const sleeps: number[] = [];
        const { fetch } = fakeSite();
        await fetchNovelChapters(fetch, SRC, items, {
            sleep: async (ms) => {
                sleeps.push(ms);
            },
            random: () => 0,
        });
        expect(sleeps).toEqual([]);
    });

    it('🔴 #428 重试之间**仍然退避**（那是对「刚失败的请求」的礼貌，不是节流 ⇒ 与章间等待不是一回事）', async () => {
        const sleeps: number[] = [];
        const { fetch } = fakeSite(PAGES, { '/ch/1.html': 99 });
        await fetchNovelChapters(fetch, SRC, [items[0]], {
            sleep: async (ms) => {
                sleeps.push(ms);
            },
            random: () => 0,
        });
        expect(sleeps).toEqual([1000]); // maxAttempts=2 ⇒ 1 次退避（`crawl.minInterval` 1s、random=0）
    });

    it('🔴🔴 #428 **并发池**：默认并发度 = `NOVEL_CHAPTER_CONCURRENCY`（50），'
        + '且**调用当帧**就把 50 个请求全发出去了（⛔ 不是「一个一个来」）', async () => {
        const many = Array.from({ length: 120 }, (_, i) => ({
            no: i + 1,
            title: `第 ${i + 1} 章`,
            url: `https://example.com/ch/${i + 1}.html`,
        }));
        let live = 0;
        let peak = 0;
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => {
            release = r;
        });
        const fetch: NovelFetch = async (req) => {
            live++;
            peak = Math.max(peak, live);
            await gate; // 全挂住，好数「同一时刻几个在飞」
            live--;
            const no = Number(/(\d+)\.html$/.exec(req.url)?.[1] ?? '0');
            return { status: 200, text: chapterHtml(no) };
        };
        const p = fetchNovelChapters(fetch, SRC, many, { sleep: async () => {}, random: () => 0 });
        expect(peak).toBe(NOVEL_CHAPTER_CONCURRENCY); // 同步段里 worker 已经把请求发出去了
        release();
        const tasks = await p;
        expect(tasks.length).toBe(120);
        expect(tasks.every((t) => t.state === 'done')).toBe(true);
    });

    it('🔴 #428 并发度可注入，且**成品章序 = 目录序**（worker 抢的是下标 ⇒ ⛔ 不是「谁先回来谁在前」）', async () => {
        const many = Array.from({ length: 12 }, (_, i) => ({
            no: i + 1,
            title: `第 ${i + 1} 章`,
            url: `https://example.com/ch/${i + 1}.html`,
        }));
        // 故意让**序号小的更慢**：若成品按完成先后拼，顺序必然反过来
        const fetch: NovelFetch = async (req) => {
            const no = Number(/(\d+)\.html$/.exec(req.url)?.[1] ?? '0');
            await new Promise((r) => setTimeout(r, (13 - no) * 2));
            return { status: 200, text: chapterHtml(no) };
        };
        const tasks = await fetchNovelChapters(fetch, SRC, many, { concurrency: 4, sleep: async () => {}, random: () => 0 });
        expect(tasks.map((t) => t.no)).toEqual(many.map((i) => i.no));
        expect(tasks[0].text).toContain('正文1一');
    });

    it('🔴 单章失败**在重试上限内**再试（这里第 1 章前 1 次失败、上限 2 ⇒ 最终成功）', async () => {
        const { fetch, calls } = fakeSite(PAGES, { '/ch/2.html': 1 });
        const tasks = await fetchNovelChapters(fetch, SRC, items, { sleep: async () => {}, random: () => 0 });
        expect(tasks[1].state).toBe('done');
        expect(calls.filter((c) => c.url.endsWith('/ch/2.html')).length).toBe(2);
    });

    it('重试到底仍失败 ⇒ 标 `failed` + 原因带**试了几次**；**其余章照常完成**（⛔ 不整本中断）', async () => {
        const { fetch } = fakeSite(PAGES, { '/ch/1.html': 99 });
        const tasks = await fetchNovelChapters(fetch, SRC, items, { sleep: async () => {}, random: () => 0 });
        expect(tasks[0].state).toBe('failed');
        expect(tasks[0].error).toContain('ECONNRESET');
        expect(tasks[0].error).toContain('已试 2 次');
        expect(tasks[1].state).toBe('done');
        expect(tasks[1].text).toContain('正文2一');
    });

    it('`chapter.content` 没命中 ⇒ 该章报「没命中」（⛔ 不当成空正文放过）', async () => {
        const { fetch } = fakeSite({ '/ch/1.html': '<html><body><div class="bookname"><h1>t</h1></div></body></html>' });
        const tasks = await fetchNovelChapters(fetch, SRC, [items[0]], { sleep: async () => {}, random: () => 0 });
        expect(tasks[0].state).toBe('failed');
        expect(tasks[0].error).toContain('没命中');
    });

    it('`chapter.nextPage` ⇒ 把下一页正文拼上来', async () => {
        const p1 = `<html><body><div class="bookname"><h1>第 1 章</h1></div><div id="content">甲<br></div><a id="np" href="/ch/1b.html">下一页</a></body></html>`;
        const p2 = `<html><body><div class="bookname"><h1>第 1 章</h1></div><div id="content">乙<br></div></body></html>`;
        const { fetch, calls } = fakeSite({ '/ch/1.html': p1, '/ch/1b.html': p2 });
        const src: NovelSource = { ...SRC, chapter: { ...SRC.chapter, nextPage: '#np' } };
        const tasks = await fetchNovelChapters(fetch, src, [items[0]], { sleep: async () => {}, random: () => 0 });
        expect(calls.length).toBe(2);
        expect(tasks[0].text).toContain('甲');
        expect(tasks[0].text).toContain('乙');
    });

    it('🔴🔴 #428 取消（单并发）⇒ **抛 `CancelledError`**（⛔ 不再是「剩下的章标 `failed: 已取消` 然后照常返回」）、'
        + '剩余章留在 `pending`、且**一个请求都不再发** —— 这就是「取消点了没反应、结果还能保存」的根治', async () => {
        const { fetch, calls } = fakeSite();
        const token = createCancelToken();
        let seen: { state: string; error?: string }[] = [];
        let first = true;
        await expect(
            fetchNovelChapters(fetch, SRC, items, {
                // ⚠️ **必须单并发**：默认 50 并发下两个请求**同一帧就都发出去了**（见下一条用例），
                //    那时「不再发新请求」这条断言根本不成立
                concurrency: 1,
                sleep: async () => {},
                random: () => 0,
                cancel: token,
                // 第 1 章抓完就取消（模拟用户点按钮的时刻）
                onProgress: () => {
                    if (first) {
                        first = false;
                        token.stop();
                    }
                },
                onCheckpoint: (all) => {
                    seen = all.map((t) => ({ state: t.state, error: t.error }));
                },
            }),
        ).rejects.toBeInstanceOf(CancelledError);
        expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/ch/1.html']);
        expect(seen[0].state).toBe('done');
        // ⛔ 不是 `failed` + 「已取消」：它没失败，只是这一轮没抓（下次续传接着抓）
        expect(seen[1].state).toBe('pending');
        expect(seen[1].error).toBeUndefined();
    });

    it('🔴🔴 #428 并发池下取消的**精确语义**：已经在飞的那个**不再等它**（状态留 `pending`，⛔ 不会写成 done）；'
        + '**还没被抢到的章一个请求都不发**（「取消」不是「等这 50 个都回来」）', async () => {
        const three = [
            { no: 1, title: '第一章', url: 'https://example.com/ch/1.html' },
            { no: 2, title: '第二章', url: 'https://example.com/ch/2.html' },
            { no: 3, title: '第三章', url: 'https://example.com/ch/3.html' },
        ];
        const calls: string[] = [];
        // #1 立刻回来（它触发取消）；#2 **永远不回来**（模拟「在飞且不可 abort」的那个请求）；#3 不该被请求
        const fetch: NovelFetch = async (req) => {
            calls.push(new URL(req.url).pathname);
            if (req.url.endsWith('/ch/2.html')) return new Promise<never>(() => {});
            return { status: 200, text: chapterHtml(1) };
        };
        const token = createCancelToken();
        let seen: { state: string }[] = [];
        await expect(
            fetchNovelChapters(fetch, SRC, three, {
                concurrency: 2,
                timeoutMs: 20, // 别让 `#2` 那个 15s 的定时器在测试收摊后才响
                sleep: async () => {},
                random: () => 0,
                cancel: token,
                onProgress: () => token.stop(),
                onCheckpoint: (all) => {
                    seen = all.map((t) => ({ state: t.state }));
                },
            }),
        ).rejects.toBeInstanceOf(CancelledError);
        expect(calls).toEqual(['/ch/1.html', '/ch/2.html']); // #3 从未被请求
        expect(seen[0].state).toBe('done');
        expect(seen[1].state).toBe('pending'); // 在飞的被**放弃**（不是等它回来、更不是标 failed）
    });

    it('🔴🔴 #428 **在飞的请求上取消 ⇒ 当帧抛出去**（旧形态只会在「下一章开头」问一句 ⇒'
        + '要干等一整章的超时，量级是分钟 —— 用户的原话就是「点击无反应」）', async () => {
        const fetch: NovelFetch = () => new Promise<never>(() => {}); // 永远不回来
        const token = createCancelToken();
        // ⚠️ `timeoutMs` 给小值：本测试要证明的是「取消赢过超时」，不是让 15s 的定时器在测试收摊后还挂着
        const p = fetchNovelChapters(fetch, SRC, [items[0]], { timeoutMs: 20, sleep: async () => {}, random: () => 0, cancel: token });
        token.stop();
        await expect(p).rejects.toBeInstanceOf(CancelledError);
    });

    it('🔴 #428 已取消的令牌再进来 ⇒ 一个请求都不发（⛔ 不是「先抓一章再发现取消了」）', async () => {
        const { fetch, calls } = fakeSite();
        const token = createCancelToken();
        token.stop();
        await expect(fetchNovelChapters(fetch, SRC, items, { sleep: async () => {}, random: () => 0, cancel: token }))
            .rejects.toBeInstanceOf(CancelledError);
        expect(calls.length).toBe(0);
    });

    it('`onProgress` 每章报一次（done/total/failed 三态）', async () => {
        const seen: number[][] = [];
        const { fetch } = fakeSite();
        await fetchNovelChapters(fetch, SRC, items, {
            sleep: async () => {},
            random: () => 0,
            onProgress: (d, t, f) => seen.push([d, t, f]),
        });
        expect(seen).toEqual([
            [1, 2, 0],
            [2, 2, 0],
        ]);
    });

    it('🔴 正文被脚本规则挡住（`chapter.content` 是 `@js:`）⇒ **源级直接抛一句**（⛔ 不给上千章各报一遍）', async () => {
        const { fetch } = fakeSite();
        const src: NovelSource = { ...SRC, chapter: { ...SRC.chapter, content: '#content@js:return decrypt(r)' } };
        await expect(fetchNovelChapters(fetch, src, [items[0]], { sleep: async () => {}, random: () => 0 })).rejects.toThrow(
            /不执行脚本/,
        );
        await expect(
            fetchNovelChapters(fetch, src, [items[0]], { sleep: async () => {}, random: () => 0 }),
        ).rejects.toThrow(/章节正文/);
    });
});

describe('novelSource · 抓章 · 断点续传（P1-C）', () => {
    const ITEMS = [
        { no: 1, title: '第一章 风起', url: 'https://example.com/ch/1.html' },
        { no: 2, title: '第二章 雨落', url: 'https://example.com/ch/2.html' },
        { no: 3, title: '第三章 云开', url: 'https://example.com/ch/3.html' },
    ];
    const SAVED = { no: 1, title: '第一章 风起', text: '上次抓到的正文一' };

    it('🔴 存档里已有的章**不再发请求**（续传的全部意义），未抓的照常抓', async () => {
        const { fetch, calls } = fakeSite({ ...PAGES, '/ch/3.html': chapterHtml(3) });
        const tasks = await fetchNovelChapters(fetch, SRC, ITEMS, {
            sleep: async () => {},
            random: () => 0,
            resume: [SAVED],
        });
        expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/ch/2.html', '/ch/3.html']);
        expect(tasks.every((t) => t.state === 'done')).toBe(true);
        expect(tasks[0].text).toBe('上次抓到的正文一'); // 用的是存档正文，不是重抓的
    });

    it('🔴🔴 #428 **翻面**（原「复用章不占抓取间隔」—— 章间等待已整体取消，那条判据不复存在）：'
        + '改判「复用章**不进待抓队列**」—— 并发位只给**真请求**（`concurrency: 2` 下两个待抓的章当帧一起发出去）',
        async () => {
            const site = fakeSite({ ...PAGES, '/ch/3.html': chapterHtml(3) });
            let live = 0;
            let peak = 0;
            let release: () => void = () => {};
            const gate = new Promise<void>((r) => {
                release = r;
            });
            const fetch: NovelFetch = async (req) => {
                live++;
                peak = Math.max(peak, live);
                await gate;
                live--;
                return site.fetch(req);
            };
            const p = fetchNovelChapters(fetch, SRC, ITEMS, {
                concurrency: 2,
                sleep: async () => {},
                random: () => 0,
                resume: [SAVED],
            });
            // 只剩 2 章要抓 ⇒ 两个并发位**都**归真请求（复用的第 1 章没占位，也没发请求）
            expect(peak).toBe(2);
            release();
            const tasks = await p;
            expect(tasks[0].text).toBe('上次抓到的正文一');
            expect(tasks.every((t) => t.state === 'done')).toBe(true);
        });

    it('`onResume` 报「复用了几章」，且**首帧进度就带上它**（否则进度停在 0，用户以为白续了）', async () => {
        const resumes: number[] = [];
        const seen: number[][] = [];
        const { fetch } = fakeSite();
        await fetchNovelChapters(fetch, SRC, ITEMS.slice(0, 2), {
            sleep: async () => {},
            random: () => 0,
            resume: [SAVED],
            onResume: (n) => resumes.push(n),
            onProgress: (d, t, f) => seen.push([d, t, f]),
        });
        expect(resumes).toEqual([1]);
        expect(seen[0]).toEqual([1, 2, 0]); // 一进来就是「已下 1 / 共 2」
    });

    it('`onCheckpoint` **只在新抓到的章成功后**回调一次（失败的不落档 —— 落进去下次会被当成已完成）', async () => {
        const shots: number[] = [];
        const { fetch } = fakeSite(PAGES, { '/ch/3.html': 99 });
        await fetchNovelChapters(fetch, SRC, ITEMS, {
            sleep: async () => {},
            random: () => 0,
            resume: [SAVED],
            onCheckpoint: (tasks) => shots.push(tasks.filter((t) => t.state === 'done').length),
        });
        expect(shots).toEqual([2]); // 只有第 2 章成功那次；复用章不重复回调、第 3 章失败也不回调
    });

    it('🔴 存档章**正文为空** ⇒ 不认它，该章照常重新请求（⛔ 不给用户一本缺章的书）', async () => {
        const { fetch, calls } = fakeSite();
        const tasks = await fetchNovelChapters(fetch, SRC, ITEMS.slice(0, 2), {
            sleep: async () => {},
            random: () => 0,
            resume: [{ no: 1, title: '第一章 风起', text: '   ' }],
        });
        expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/ch/1.html', '/ch/2.html']);
        expect(tasks[0].text).toContain('正文1一');
    });

    it('不传 `resume` 时行为与旧口径一致（0 次复用、0 次 onResume）', async () => {
        const resumes: number[] = [];
        const { fetch, calls } = fakeSite();
        const tasks = await fetchNovelChapters(fetch, SRC, ITEMS.slice(0, 2), {
            sleep: async () => {},
            random: () => 0,
            onResume: (n) => resumes.push(n),
        });
        expect(resumes).toEqual([]);
        expect(calls.length).toBe(2);
        expect(tasks.every((t) => t.state === 'done')).toBe(true);
    });
});
