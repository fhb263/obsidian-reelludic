/**
 * `pure/sourceRule` 单测（#419）。
 *
 * 🔴 样本策略：**选择器形态照抄真实书源**（`#checkform > table > tbody > tr`、
 *    `dl > dt:nth-of-type(2) ~ dd > a`、`#pagelink > a:not(.pgroup):not(.ngroup)` …），
 *    但**域名与站名一律用中性值**（`example.com` / 《示例源》）——
 *    ⛔ 不要把真实的第三方站点清单写进仓库（那是用户本地的东西，且本仓有公开镜像）。
 *    真源覆盖度另做一次性核对（导 11 条真实书源全通过），不进单测。
 */
import { describe, expect, it } from 'vitest';
import {
    PACING_MAX_SEC,
    PACING_MIN_SEC,
    SOURCE_KINDS,
    SOURCE_KIND_LABEL,
    bookIdFromUrl,
    diagnoseSource,
    groupSourcesByKind,
    mergeSources,
    moveAllSourcesToKind,
    novelFailText,
    pacingDelayMs,
    parseSourceFile,
    parseSourceJson,
    ruleHasScript,
    ruleLooksXPath,
    sourceHost,
    sourceKey,
    sourceKindOf,
    sourcePacing,
    sourceSummary,
    type NovelSource,
    type SourceKind,
} from 'pure/sourceRule';

/** 一条「形态真实、域名中性」的书源（选择器全部来自真实书源里出现过的写法） */
const SOURCE_A: NovelSource = {
    url: 'https://example.com/',
    name: '示例源甲',
    search: {
        url: 'https://example.com/modules/article/waps.php',
        method: 'post',
        data: '{searchkey: %s}',
        result: '#checkform > table > tbody > tr',
        bookName: 'td.even > a',
        author: 'td:nth-of-type(3)',
        latestChapter: 'td.odd > a',
        lastUpdateTime: 'td:nth-of-type(4)',
    },
    book: { latestChapter: '#info > p:nth-child(5) > a', latestChapterUrl: '#info > p:nth-child(5) > a@href' },
    toc: { item: '#list > dl > dd > a' },
    chapter: {
        title: '.bookname > h1',
        content: '#content',
        paragraphTagClosed: false,
        paragraphTag: '<br>+',
        filterTxt: '一秒记住【示例阅读】，精彩无弹窗免费阅读！|\\(本章完\\)',
        filterTag: 'div, p, script',
    },
};

/** 另一条：目录用 `~` 兄弟选择器 + 分页用 `:not()`（都是真实书源里的写法） */
const SOURCE_B: NovelSource = {
    url: 'https://example.org/',
    name: '示例源乙',
    search: {
        url: 'https://example.org/search.html',
        method: 'post',
        data: '{searchkey: %s, searchtype: all}',
        result: '#sitembox > dl',
        bookName: 'dd > h3 > a',
        author: 'dd:nth-child(3) > span:nth-child(1)',
        nextPage: '#pagelink > a:not(.pgroup):not(.ngroup)',
    },
    book: { intro: '#intro > p:nth-child(1)' },
    toc: { item: 'dl > dt:nth-of-type(2) ~ dd > a' },
    chapter: {
        title: '.bookname > h1',
        content: '#content',
        paragraphTagClosed: true,
        filterTag: '.bottem2, hr, script, table',
        nextPage: '#pager_next',
    },
};

describe('sourceRule · 形态判定', () => {
    it('`@js:` 命中（大小写与空格都容）', () => {
        expect(ruleHasScript('#content@js:return r')).toBe(true);
        expect(ruleHasScript('#content@JS : r')).toBe(true);
        expect(ruleHasScript('#content')).toBe(false);
        expect(ruleHasScript('')).toBe(false);
    });

    it('🔴 XPath 判据 = **以 `/` 开头**（CSS 选择器永不以 `/` 开头 ⇒ 不会误判）', () => {
        expect(ruleLooksXPath('/html/body/div')).toBe(true);
        expect(ruleLooksXPath('//div[@class="x"]')).toBe(true);
        expect(ruleLooksXPath('  /p[1]')).toBe(true);
        // 这些全是 CSS，别误判成 XPath
        expect(ruleLooksXPath('#content > p')).toBe(false);
        expect(ruleLooksXPath('dl > dd > a')).toBe(false);
        expect(ruleLooksXPath('div, p, script')).toBe(false);
    });
});

describe('sourceRule · 体检', () => {
    it('两条真实形态的书源：**零错误零警告**（选择器写法一个都不用改动）', () => {
        for (const s of [SOURCE_A, SOURCE_B]) {
            const d = diagnoseSource(s);
            expect(d.errors).toEqual([]);
            expect(d.warnings).toEqual([]);
            expect(d.flags).toEqual({ script: false, login: false, xpath: false });
        }
    });

    it('缺必需字段 ⇒ 逐条点名（目录 / 正文 / 标题是三根支柱）', () => {
        const d = diagnoseSource({ url: '', name: '', toc: {}, chapter: {} } as unknown as NovelSource);
        expect(d.errors).toContain('缺书源名称');
        expect(d.errors).toContain('缺站点地址');
        expect(d.errors).toContain('缺目录规则（toc.item）');
        expect(d.errors).toContain('缺章节标题规则（chapter.title）');
        expect(d.errors).toContain('缺章节正文规则（chapter.content）');
    });

    it('给了 search 就得给全（缺 result / bookName 的搜索必然解析不出东西）', () => {
        const d = diagnoseSource({ ...SOURCE_A, search: { url: 'https://example.com/s', method: 'get' } } as unknown as NovelSource);
        expect(d.errors).toContain('搜索缺结果选择器（search.result）');
        expect(d.errors).toContain('搜索缺书名规则（search.bookName）');
    });

    it('⛔ 没有 search 段**不算错**（有些源只支持按目录地址直下）', () => {
        const d = diagnoseSource({ ...SOURCE_A, search: undefined });
        expect(d.errors).toEqual([]);
    });

    it('🔴 `@js:` ⇒ 标 script + 警告，且**同一原因折成一行**列出受影响字段（别刷成一面墙）', () => {
        const s: NovelSource = {
            ...SOURCE_A,
            search: { ...SOURCE_A.search!, result: '.list@js:const childRegex=/x/' },
            book: { coverUrl: 'meta[property="og:image"]@js:r="x"+r' },
        };
        const d = diagnoseSource(s);
        expect(d.flags.script).toBe(true);
        expect(d.warnings.filter((w) => w.includes('脚本')).length).toBe(1);
        expect(d.warnings[0]).toContain('搜索列表');
        expect(d.warnings[0]).toContain('封面');
        expect(d.warnings[0]).toContain('不执行第三方脚本');
    });

    it('XPath 规则 ⇒ 标 xpath + 警告（含 `filterTag` 那处）', () => {
        const d = diagnoseSource({ ...SOURCE_A, toc: { item: '//dl/dd/a' } });
        expect(d.flags.xpath).toBe(true);
        expect(d.warnings.some((w) => w.includes('目录条目') && w.includes('XPath'))).toBe(true);

        const d2 = diagnoseSource({ ...SOURCE_B, chapter: { ...SOURCE_B.chapter, filterTag: '//div[@class="ad"]' } });
        expect(d2.flags.xpath).toBe(true);
        expect(d2.warnings.some((w) => w.includes('过滤标签'))).toBe(true);
    });

    it('需要 Cookie ⇒ 标 login + 警告（能导入，但要说清前提）', () => {
        const d = diagnoseSource({
            ...SOURCE_A,
            search: { ...SOURCE_A.search!, cookies: "waf_sc=''; HMACCOUNT=''" },
        });
        expect(d.flags.login).toBe(true);
        expect(d.warnings.some((w) => w.includes('Cookie'))).toBe(true);
        expect(d.errors).toEqual([]); // 有 Cookie 不算错，只是前提
    });
});

describe('sourceRule · 文件解析', () => {
    it('三种输入形态都收：数组 / 单条对象 / `{ sources: [...] }`', () => {
        expect(parseSourceFile([SOURCE_A, SOURCE_B]).sources.length).toBe(2);
        expect(parseSourceFile(SOURCE_A).sources.length).toBe(1);
        expect(parseSourceFile({ sources: [SOURCE_A] }).sources.length).toBe(1);
    });

    it('🔴 不静默丢条目：坏条目进 `rejected` 并带**第几条**与原因', () => {
        const out = parseSourceFile([SOURCE_A, 123, { name: '半条源' }]);
        expect(out.sources.length).toBe(1);
        expect(out.rejected.length).toBe(2);
        expect(out.rejected[0]).toEqual({ index: 2, name: '', reason: '这一条不是一个书源对象' });
        expect(out.rejected[1].index).toBe(3);
        expect(out.rejected[1].name).toBe('半条源');
        expect(out.rejected[1].reason).toContain('缺站点地址');
    });

    it('认不出的输入 ⇒ 空结果（⛔ 不抛，交给 UI 说「这文件里没有书源」）', () => {
        expect(parseSourceFile(null).sources).toEqual([]);
        expect(parseSourceFile('nope').sources).toEqual([]);
        expect(parseSourceFile({ a: 1 }).sources).toEqual([]);
    });

    it('JSON 本身坏了 ⇒ **抛**（调用方折成一句给用户的话）', () => {
        expect(() => parseSourceJson('{ 坏 }')).toThrow(/不是合法的 JSON/);
        expect(parseSourceJson(`[${JSON.stringify(SOURCE_A)}]`).sources.length).toBe(1);
    });
});

describe('sourceRule · 抓取节奏（D-20(a)：串行 + 间隔）', () => {
    it('缺 `crawl` ⇒ 默认 2s / 3s / 最多 3 次', () => {
        expect(sourcePacing(SOURCE_A)).toEqual({ minInterval: 2, maxInterval: 3, maxAttempts: 3 });
    });

    it('🔴 `concurrency` **一律忽略**（书源写 5 并发也不照做 —— 本插件只串行）', () => {
        const p = sourcePacing({ ...SOURCE_A, crawl: { concurrency: 5, minInterval: 1, maxInterval: 2 } });
        expect(p.minInterval).toBe(1);
        expect(p).not.toHaveProperty('concurrency');
    });

    it('间隔被夹在安全边界内（写 0 不会变成洪水，写 999 不会变成龟速）', () => {
        const tiny = sourcePacing({ ...SOURCE_A, crawl: { minInterval: 0, maxInterval: 0 } });
        expect(tiny.minInterval).toBeGreaterThanOrEqual(PACING_MIN_SEC);
        const huge = sourcePacing({ ...SOURCE_A, crawl: { minInterval: 999, maxInterval: 999 } });
        expect(huge.maxInterval).toBeLessThanOrEqual(PACING_MAX_SEC);
    });

    it('书源把 min 写得比 max 大 ⇒ 归一成正区间（模板里两个都是 0 是常态）', () => {
        const p = sourcePacing({ ...SOURCE_A, crawl: { minInterval: 8, maxInterval: 1 } });
        expect(p.minInterval).toBeLessThanOrEqual(p.maxInterval);
    });

    it('重试上限也被夹住（写 0 / 999 都不照做）', () => {
        expect(sourcePacing({ ...SOURCE_A, crawl: { maxAttempts: 0 } }).maxAttempts).toBe(3);
        expect(sourcePacing({ ...SOURCE_A, crawl: { maxAttempts: 999 } }).maxAttempts).toBe(10);
        expect(sourcePacing({ ...SOURCE_A, crawl: { maxAttempts: 2 } }).maxAttempts).toBe(2);
    });

    it('`pacingDelayMs` 在 `[min,max]` 之间线性取值，pick 越界被夹', () => {
        const p = { minInterval: 2, maxInterval: 4, maxAttempts: 1 };
        expect(pacingDelayMs(p, 0)).toBe(2000);
        expect(pacingDelayMs(p, 1)).toBe(4000);
        expect(pacingDelayMs(p, 0.5)).toBe(3000);
        expect(pacingDelayMs(p, -1)).toBe(2000);
        expect(pacingDelayMs(p, 9)).toBe(4000);
    });
});

describe('sourceRule · 导入合并', () => {
    it('站点键 = 小写 host + 去尾斜杠（同一站点的两种写法算同一条）', () => {
        expect(sourceKey({ ...SOURCE_A, url: 'https://Example.COM/' })).toBe(sourceKey({ ...SOURCE_A, url: 'https://example.com' }));
    });

    it('🔴 同站点算**更新**（反复导入同一份文件不会堆出一串同名源）', () => {
        const first = mergeSources([], [SOURCE_A, SOURCE_B]);
        expect(first).toMatchObject({ added: 2, updated: 0 });
        const second = mergeSources(first.sources, [SOURCE_A, SOURCE_B]);
        expect(second.sources.length).toBe(2);
        expect(second).toMatchObject({ added: 0, updated: 2 });
    });

    it('🔴 更新时**保留用户自己的「停用」选择**（刷新一次书源不该把手动关掉的又打开）', () => {
        const off = { ...SOURCE_A, disabled: true };
        const merged = mergeSources([off], [SOURCE_A]);
        expect(merged.sources[0].disabled).toBe(true);
        expect(merged.updated).toBe(1);
    });

    it('新站点追加（追加的排在后面，顺序稳定）', () => {
        const merged = mergeSources([SOURCE_A], [SOURCE_B]);
        expect(merged.sources.map((s) => s.name)).toEqual(['示例源甲', '示例源乙']);
        expect(merged.added).toBe(1);
    });

    it('不会改动传进来的数组（纯函数）', () => {
        const existing = [SOURCE_A];
        mergeSources(existing, [SOURCE_B]);
        expect(existing.length).toBe(1);
    });
});

describe('sourceRule · 给 UI 的摘要', () => {
    it('站点显示名只取 host 且去掉 `www.`；取不出域名时回退到原文', () => {
        expect(sourceHost('https://www.example.com/a/b')).toBe('example.com');
        expect(sourceHost('http://sub.example.org/')).toBe('sub.example.org');
        expect(sourceHost('')).toBe('');
        expect(sourceHost('示例站点')).toBe('示例站点');
    });

    it('摘要带上名称 / 站点 / 开关 / 标记 / 警告小字', () => {
        const s = sourceSummary({ ...SOURCE_A, name: '', url: 'https://www.example.com/' });
        expect(s.name).toBe('example.com'); // 没名字就用站点兜
        expect(s.host).toBe('example.com');
        expect(s.disabled).toBe(false);
        expect(s.flags).toEqual({ script: false, login: false, xpath: false });
        expect(s.warning).toBe('');

        const withScript = sourceSummary({ ...SOURCE_A, disabled: true, chapter: { ...SOURCE_A.chapter, content: '#c@js:x' } });
        expect(withScript.disabled).toBe(true);
        expect(withScript.flags.script).toBe(true);
        expect(withScript.warning).toContain('不执行第三方脚本');
    });
});

/**
 * #422：书源分「网络文学源 / 经典文学源」两类（设置页两个可折叠小节 + 下载弹窗按条目类型取源）。
 * 🔴 这里钉的是**归类的三条口径**：缺省归网文、按钮决定归属（含覆盖已存在站点）、分类与启停互不干扰。
 */
describe('sourceRule · 书源分类（#422）', () => {
    it('🔴 缺省归网文 —— 老数据根本没有 kind 键（它们全是从「网文书源」那条路进来的）', () => {
        expect(sourceKindOf(SOURCE_A)).toBe('novel');
        expect(sourceKindOf({ ...SOURCE_A, kind: undefined })).toBe('novel');
        expect(sourceKindOf(null)).toBe('novel');
        expect(sourceKindOf(undefined)).toBe('novel');
    });

    it('只有显式 book 才算经典文学（脏值必须回落到缺省，⛔ 别把「不是 novel 的都算文学」）', () => {
        expect(sourceKindOf({ ...SOURCE_A, kind: 'book' })).toBe('book');
        // 数据可能来自旧版本 / 用户手改过的 data.json ⇒ 非法值一律当网文
        expect(sourceKindOf({ ...SOURCE_A, kind: 'comic' as unknown as SourceKind })).toBe('novel');
        expect(sourceKindOf({ ...SOURCE_A, kind: '' as unknown as SourceKind })).toBe('novel');
    });

    it('groupSourcesByKind：按分类拆开，组内顺序保持原样', () => {
        const list: NovelSource[] = [
            SOURCE_A,
            { ...SOURCE_B, kind: 'book' },
            { ...SOURCE_A, url: 'https://example.net/', name: '示例源丙', kind: 'book' },
        ];
        const g = groupSourcesByKind(list);
        expect(g.novel.map((s) => s.name)).toEqual(['示例源甲']);
        expect(g.book.map((s) => s.url)).toEqual(['https://example.org/', 'https://example.net/']);
    });

    it('🔴 mergeSources 带 kind：新条目按它打标（= 用户点的那枚导入按钮）', () => {
        const merged = mergeSources([], [SOURCE_A, SOURCE_B], 'book');
        expect(merged.added).toBe(2);
        expect(merged.sources.every((s) => s.kind === 'book')).toBe(true);
    });

    it('🔴 已存在的站点**保持原分类**（导入不搬家 —— 一次误点不该把整批源搬走）', () => {
        // ⚠️ 这条口径上线当天就翻过面：原设计是「已存在的跟着改成这次的类」，结果用户在
        //    「经典文学源」里点了一次导入（只想刷新那批源），10 条老源被整批搬走 ⇒
        //    换到网文条目里一条书源都看不见，以为数据丢了（实测 data.json 里 kind 全成 book、条数没少）。
        //    ⇒ 现在只有**显式入口**（设置页源行那枚「移到另一组」）能改分类。
        const merged = mergeSources([{ ...SOURCE_A, kind: 'novel' }], [SOURCE_A], 'book');
        expect(merged.updated).toBe(1);
        expect(merged.sources[0].kind).toBe('novel');
    });

    it('🔴 老数据（没有 `kind` 键）在**首次被导入命中**时，按调用方给的那类打标', () => {
        const merged = mergeSources([SOURCE_A], [SOURCE_A], 'book');
        expect(merged.sources[0].kind).toBe('book');
    });

    it('🔴 不传 kind ⇒ **保留旧分类**（kind 与 disabled 同属「本地状态」，文件里压根没这个键）', () => {
        const merged = mergeSources([{ ...SOURCE_A, kind: 'book' }], [SOURCE_A]);
        expect(merged.sources[0].kind).toBe('book');
        // 旧数据本来就没有 kind ⇒ 更新后仍没有（读取时缺省成网文，不会被凭空写成某一类）
        const legacy = mergeSources([SOURCE_A], [{ ...SOURCE_A, name: '示例源甲（刷新）' }]);
        expect(legacy.sources[0].kind).toBeUndefined();
        expect(sourceKindOf(legacy.sources[0])).toBe('novel');
    });

    it('🔴 不传 kind 且 incoming 自带分类 ⇒ 听 incoming 的（用户手改过的 json 也认）', () => {
        const merged = mergeSources([], [{ ...SOURCE_A, kind: 'book' }]);
        expect(merged.sources[0].kind).toBe('book');
    });

    it('🔴 导入既**不搬家**、也**不重置**用户的「停用」选择（两条「本地状态」口径互不干扰）', () => {
        const merged = mergeSources([{ ...SOURCE_A, disabled: true, kind: 'novel' }], [SOURCE_A], 'book');
        expect(merged.sources[0].kind).toBe('novel'); // 分类保持原样（要改走显式入口）
        expect(merged.sources[0].disabled).toBe(true); // 启停保持原样
    });

    it('两类标题与顺序固定（设置页小节名与下载弹窗提示读同一份）', () => {
        expect(SOURCE_KINDS).toEqual(['novel', 'book']);
        expect(SOURCE_KIND_LABEL.novel).toBe('网络文学源');
        expect(SOURCE_KIND_LABEL.book).toBe('经典文学源');
    });
});

/**
 * #422 续四：**搜索失败原因折人话**。
 * 🔴 用户上手截图里那一列 `getaddrinfo ENOENT www.…` / `HTTP 404` / 「『.novelist2 > ul > li』没匹配到…」
 *    就是这条链的输入 —— 前两类必须折掉，第三类本来就是我们写给用户看的中文。
 */
describe('sourceRule · 失败原因折人话（#422 续四）', () => {
    it('🔴 网络层英文原文 ⇒ 「连不上该站点」', () => {
        expect(novelFailText('getaddrinfo ENOENT www.example.com')).toBe('连不上该站点');
        expect(novelFailText('socket hang up')).toBe('连不上该站点');
        expect(novelFailText('ETIMEDOUT')).toBe('连不上该站点');
        expect(novelFailText('请求超时')).toBe('连不上该站点');
    });

    it('纯状态码 ⇒ 「该来源返回 HTTP 404」', () => {
        expect(novelFailText('HTTP 404')).toBe('该来源返回 HTTP 404');
        expect(novelFailText('HTTP 503')).toBe('该来源返回 HTTP 503');
        // ⚠️ 必须锚「整串就是一个状态码」：`HTTP 404` 混在长句里时不该按状态码折
        expect(novelFailText('第 2 页请求失败：HTTP 404')).toBe('第 2 页请求失败：HTTP 404');
    });

    it('🔴 我们自己写的中文**原样放行**（⛔ 别套成「请求出错：…」的壳）', () => {
        expect(novelFailText('该源没有提供搜索')).toBe('该源没有提供搜索');
        expect(novelFailText('章节正文的规则是空的')).toBe('章节正文的规则是空的');
    });

    it('「没匹配到任何结果 / 章节」折短（括号里那半句保留，选择器原文不再糊到界面上）', () => {
        expect(novelFailText('「.x > li」没匹配到任何结果（该源可能已改版或失效）')).toBe('没匹配到结果（该源可能已改版或失效）');
        expect(novelFailText('「#list > dd > a」没匹配到任何章节（该源可能已改版或失效）')).toBe(
            '没匹配到任何章节（该源可能已改版或失效）',
        );
    });

    it('空串 ⇒ 空串；其余过长的截到 48 字 + 省略号（列表里一行放不下）', () => {
        expect(novelFailText('')).toBe('');
        expect(novelFailText('啊'.repeat(60))).toBe(`${'啊'.repeat(48)}…`);
        expect(novelFailText('啊'.repeat(20))).toBe('啊'.repeat(20));
    });
});

describe('sourceRule · 书籍 ID 提取（#424，对齐 so-novel TocParser）', () => {
    const S: NovelSource = {
        url: 'https://www.example.com/',
        name: '甲',
        toc: { item: 'ul > li > a' },
        chapter: { title: 'h1', content: '#content' },
    };

    it('🔴 从**书籍页地址**里按 `book.url` 正则取**第 1 个捕获组**', () => {
        const src: NovelSource = { ...S, book: { url: 'https://www.yeudusk.com/book/(.*?)/' } };
        expect(bookIdFromUrl(src, 'https://www.yeudusk.com/book/12345/')).toBe('12345');
    });

    it('正则里有多个捕获组 ⇒ 只取第 1 个（与 so-novel 的 `getGroup1` 一致）', () => {
        const src: NovelSource = { ...S, book: { url: '/book/(\\d+)/(\\w+)/' } };
        expect(bookIdFromUrl(src, 'https://x.com/book/777/abc/')).toBe('777');
    });

    it('没写 `book.url` / 匹配不上 / 没捕获组 ⇒ 空串（调用方据此给明确原因，⛔ 不能瞎猜一个 ID）', () => {
        expect(bookIdFromUrl(S, 'https://x.com/book/1/')).toBe('');
        expect(bookIdFromUrl({ ...S, book: { url: '/other/(.*?)/' } }, 'https://x.com/book/1/')).toBe('');
        expect(bookIdFromUrl({ ...S, book: { url: '/book/\\d+/' } }, 'https://x.com/book/1/')).toBe('');
    });

    it('正则非法 ⇒ 空串（书源是用户自己写的，坏正则不能把整轮搜索炸掉）', () => {
        const src: NovelSource = { ...S, book: { url: 'book/(' } };
        expect(bookIdFromUrl(src, 'https://x.com/book/1/')).toBe('');
    });

    it('`book.url` 带 `@js:` 后缀 ⇒ **截掉再当正则**（本仓不执行脚本，红线 D-24(a)）', () => {
        const src: NovelSource = { ...S, book: { url: '/book/(.*?)/@js:return $.id' } };
        expect(bookIdFromUrl(src, 'https://x.com/book/42/')).toBe('42');
    });

    it('空地址 / 空规则 ⇒ 空串（不抛）', () => {
        expect(bookIdFromUrl({ ...S, book: { url: '/book/(.*?)/' } }, '')).toBe('');
        expect(bookIdFromUrl(undefined, 'https://x.com/book/1/')).toBe('');
    });
});

/**
 * #439 整批改分类（设置页行头 / 弹窗空态那枚「移过来」共用）。
 * 🔴 这一组是「11 条源被一次误点整批搬走、只能逐条点回来」那个真事故的修补面：
 *    真正要钉的是 **「只动 kind、别的一律不动」** 与 **「只搬 from 那一类」**。
 */
describe('sourceRule · 整批改分类', () => {
    const novelA: NovelSource = { ...SOURCE_A };
    const novelB: NovelSource = { ...SOURCE_B, kind: 'novel' };
    const bookA: NovelSource = { ...SOURCE_A, url: 'https://book.example.net/', name: '示例源丙', kind: 'book' };

    it('把「网文」整批搬到「文学」：两类条数互换，且只动被搬的那些', () => {
        const out = moveAllSourcesToKind([novelA, bookA], 'novel', 'book');
        expect(out.map((s) => sourceKindOf(s))).toEqual(['book', 'book']);
        expect(out.map((s) => s.name)).toEqual(['示例源甲', '示例源丙']);
    });

    it('🔴 `disabled`（本地状态）原样保留 —— 搬组不该把用户手动停用的源打开', () => {
        const out = moveAllSourcesToKind([{ ...novelA, disabled: true }, novelB], 'novel', 'book');
        expect(out[0].disabled).toBe(true);
        expect(out[1].disabled).toBeUndefined();
    });

    it('🔴 只搬 `from` 那一类：目标类里的条目一条都不受牵连', () => {
        const out = moveAllSourcesToKind([novelA, bookA, novelB], 'book', 'novel');
        expect(sourceKindOf(out[0])).toBe('novel'); // 本来就是 novel ⇒ 不动
        expect(sourceKindOf(out[1])).toBe('novel'); // 被搬的
        expect(sourceKindOf(out[2])).toBe('novel');
        // 反向再来一次：把 novel 搬去 book，bookA 已被上一次搬成 novel ⇒ 一起被搬
        expect(moveAllSourcesToKind([novelA, bookA], 'book', 'novel').map((s) => sourceKindOf(s))).toEqual(['novel', 'novel']);
    });

    it('🔴 缺省 `kind`（老数据没有这个键）算网文 ⇒ 会被 from=novel 搬走（与 `sourceKindOf` 同口径）', () => {
        expect(novelA.kind).toBeUndefined();
        expect(sourceKindOf(moveAllSourcesToKind([novelA], 'novel', 'book')[0])).toBe('book');
        // 反之，`from:'book'` 搬不动它（缺省不是 book）
        expect(sourceKindOf(moveAllSourcesToKind([novelA], 'book', 'novel')[0])).toBe('novel');
    });

    it('`from === to` ⇒ 原样返回（不抛、不改；调用方据此判「无事发生」）', () => {
        const out = moveAllSourcesToKind([novelA, bookA], 'novel', 'novel');
        expect(out.map((s) => sourceKindOf(s))).toEqual(['novel', 'book']);
    });

    it('🔴 不改 `sourceKey`（站点是站点、分类是分类）：搬组前后逐条站点键相同', () => {
        const before = [novelA, novelB, bookA].map(sourceKey);
        const out = moveAllSourcesToKind([novelA, novelB, bookA], 'novel', 'book');
        expect(out.map(sourceKey)).toEqual(before);
    });

    it('🔴 不改入参：返回的是新对象，原数组与元素都不被改写（纯函数）', () => {
        const list = [novelA];
        const out = moveAllSourcesToKind(list, 'novel', 'book');
        expect(sourceKindOf(list[0])).toBe('novel');
        expect(out[0]).not.toBe(list[0]);
        expect(list).toHaveLength(1);
    });

    it('空清单 ⇒ 空清单（不抛）', () => {
        expect(moveAllSourcesToKind([], 'novel', 'book')).toEqual([]);
    });
});
