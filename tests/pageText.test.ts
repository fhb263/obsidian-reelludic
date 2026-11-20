/**
 * 🔴 m09330：`pure/pageText` 的守护测试。
 *
 * 背景（用户 2026-11-18：「怎么AI搜索出来每个条目简介都是编的，我要的是原生原味的简介」）：
 * AI 预填的简介必须来自**权威页面原文**，而必应 RSS 只有摘要、元数据源搜索级常不带简介。
 * 这个模块负责从页面 HTML 里把那段原文抽出来 —— 它抽错了，用户拿到的就还是错的。
 */
import { describe, expect, it } from 'vitest';
import {
    PAGE_GENRES_MAX,
    PAGE_SYNOPSIS_MAX,
    PAGE_TEXT_MAX,
    decodePageEntities,
    extractPageGenres,
    extractPageSynopsis,
    pageReadableText,
    sectionHtmlByHeading,
} from 'pure/pageText';

describe('decodePageEntities（实体还原）', () => {
    it('常见实体都还原', () => {
        expect(decodePageEntities('a &quot;b&quot; &lt;i&gt; &amp;c &mdash; d')).toBe('a "b" <i> &c — d');
        // ⚠️ `&nbsp;` 只还原成**一个空格**，不会顺手折掉相邻空格 ——
        //    折空白是 `pageReadableText` 的职责，不是实体表的。这里分开断言，免得两件事混成一条假绿。
        expect(decodePageEntities('&nbsp;')).toBe(' ');
    });

    it('🔴 `&amp;` 必须最后换 —— 否则 `&amp;quot;` 会被二次还原成引号', () => {
        expect(decodePageEntities('&amp;quot;')).toBe('&quot;');
    });

    it('空 / 非字符串 ⇒ 空串（⛔ 不吐 "undefined"）', () => {
        expect(decodePageEntities(null)).toBe('');
        expect(decodePageEntities(undefined)).toBe('');
        expect(decodePageEntities(123)).toBe('123');
    });
});

describe('pageReadableText（HTML → 可读正文）', () => {
    it('剥噪声块（script / style / nav / footer）', () => {
        const html = '<nav>导航</nav><style>.a{color:red}</style><p>正文在这里</p><footer>页脚</footer>';
        expect(pageReadableText(html)).toBe('正文在这里');
    });

    it('块级标签当空格 —— 两个 <p> 不许粘成一个词', () => {
        expect(pageReadableText('<p>第一段</p><p>第二段</p>')).toBe('第一段 第二段');
    });

    it('折空白并截到上限', () => {
        expect(pageReadableText('<p>a\n\n   b</p>')).toBe('a b');
        expect(pageReadableText('甲'.repeat(50), 10)).toHaveLength(10);
        expect(PAGE_TEXT_MAX).toBeGreaterThan(800);
    });

    it('空输入 ⇒ 空串', () => {
        expect(pageReadableText('')).toBe('');
        expect(pageReadableText(null)).toBe('');
    });
});

describe('extractPageSynopsis（简介原文提取）', () => {
    it('🔴 优先取 og:description（站点自己写的作品简介，已是纯文本）', () => {
        const html =
            '<html><head><meta property="og:description" content="保罗·厄崔迪被卷入一场星际争夺，为了家族与预言踏上沙漠星球。">' +
            '<meta name="description" content="站点通用描述，这一条不该被选中。"></head>' +
            '<body><p>正文段落</p></body></html>';
        expect(extractPageSynopsis(html)).toBe('保罗·厄崔迪被卷入一场星际争夺，为了家族与预言踏上沙漠星球。');
    });

    it('og 缺失时退到 name="description"', () => {
        const html = '<head><meta name="description" content="沙丘：弗兰克·赫伯特的长篇科幻小说，讲述沙漠星球上的家族兴衰。"></head>';
        expect(extractPageSynopsis(html)).toBe('沙丘：弗兰克·赫伯特的长篇科幻小说，讲述沙漠星球上的家族兴衰。');
    });

    it('meta 的 content 在前、property 在后也认（属性顺序两种写法）', () => {
        const html = '<meta content="两种属性顺序都认的作品简介文本，这一句够长以通过最小长度阈值。" property="og:description">';
        expect(extractPageSynopsis(html)).toBe('两种属性顺序都认的作品简介文本，这一句够长以通过最小长度阈值。');
    });

    it('meta 太短（< 20 字）⇒ 不当作简介，继续往下找', () => {
        const html =
            '<meta property="og:description" content="短">' +
            '<body><h2>剧情简介</h2><p>这一部讲的是沙漠星球上的家族复仇与预言。</p></body>';
        expect(extractPageSynopsis(html)).toContain('沙漠星球上的家族复仇');
    });

    it('没有 meta ⇒ 取「简介」小标题之后的那段', () => {
        const html =
            '<body><p>导航残渣</p><h2>内容简介</h2>' +
            '<div>本书讲述了一个关于时间、记忆与选择的漫长故事，主角在岛上度过了一生。</div></body>';
        expect(extractPageSynopsis(html)).toContain('时间、记忆与选择');
    });

    it('英文小标题也认（synopsis / plot summary）', () => {
        const html = '<body><h3>Synopsis</h3><p>A long story about the desert planet and its spice.</p></body>';
        expect(extractPageSynopsis(html)).toContain('desert planet');
    });

    it('都没有 ⇒ 退到正文里最长的那一段 <p>', () => {
        const html =
            '<body><p>短</p><p>' + '这是一段足够长的作品介绍文字，用来验证兜底路径确实能取到最长段落。'.repeat(2) + '</p></body>';
        const out = extractPageSynopsis(html);
        expect(out).toBeTruthy();
        expect(out!.length).toBeGreaterThan(40);
    });

    it('🔴 抽不到 ⇒ null（⛔ 不吐空串 —— 空串会被当成「查到了一份空简介」）', () => {
        expect(extractPageSynopsis('')).toBeNull();
        expect(extractPageSynopsis(null)).toBeNull();
        expect(extractPageSynopsis('<html><body><p>短</p></body></html>')).toBeNull();
    });

    it('结果长度受 PAGE_SYNOPSIS_MAX 约束', () => {
        const long = '甲'.repeat(2000);
        const html = `<meta property="og:description" content="${long}">`;
        expect(extractPageSynopsis(html)!.length).toBe(PAGE_SYNOPSIS_MAX);
    });

    it('🔴 返回的必须是**纯文本**，不许带标签（落进笔记的是给人读的字）', () => {
        const html = '<meta property="og:description" content="带 <b>粗体</b> 的作品简介文本，这一句够长以通过最小长度阈值。">';
        const out = extractPageSynopsis(html)!;
        expect(out).not.toContain('<b>');
        expect(out).not.toContain('</b>');
        expect(out).toContain('粗体');
    });
});

/**
 * 🔴🔴 m15796（用户 2026-11-19：「AI预填的根据搜索书名给出该书的简介，而不是什么作者的简介啊」）：
 * 豆瓣图书页的小节顺序是 `内容简介 → XXX的创作者 → 作者简介 → 目录 → 丛书信息`。
 * 旧实现只在**扁平文本**里 `exec` 一次就端走 800 字 ⇒ 作者简介整段被当成作品简介落进笔记。
 * 下面这几条钉住「按小节边界切」这件事 —— 它们红了就说明用户又该看到作者的履历了。
 */
describe('extractPageSynopsis · 按小节切（m15796 书的简介不许变成作者简介）', () => {
    /** 仿豆瓣图书页：`内容简介` 后面紧跟 `XXX的创作者` / `作者简介` / `目录` */
    const DOUBAN_LIKE =
        '<div class="related_info">' +
        '<h2><span>内容简介</span>&nbsp;&middot;&middot;&middot;&middot;&middot;</h2>' +
        '<div class="indent" id="link-report"><div><style type="text/css" media="screen">.intro p{text-indent:2em}</style>' +
        '<div class="intro"><p>文化大革命如火如荼进行的同时，军方探寻外星文明的绝秘计划「红岸工程」取得了突破性进展。</p>' +
        '<p>但在按下发射键的那一刻，历经劫难的叶文洁没有意识到，她彻底改变了人类的命运。</p></div></div></div>' +
        '<h2><span>三体的创作者</span>&nbsp;&middot;&middot;</h2><div class="indent">刘慈欣 作者</div>' +
        '<h2><span>作者简介</span>&nbsp;&middot;&middot;&middot;</h2>' +
        '<div class="indent"><p>刘慈欣，祖籍河南，长于山西，中国科普作家协会会员，山西省作家协会副主席。</p></div>' +
        '<h2><span>目录</span>&nbsp;&middot;&middot;</h2><div class="indent">第一章 科学边界</div>' +
        '</div>';

    it('🔴 简介只含「内容简介」那一节 —— ⛔ 不许吃进作者简介 / 创作者 / 目录', () => {
        const out = extractPageSynopsis(DOUBAN_LIKE)!;
        expect(out).toBeTruthy();
        expect(out).toContain('红岸工程');
        // 这三条是「吃进别的节」的直接症状
        expect(out).not.toContain('祖籍河南');
        expect(out).not.toContain('山西省作家协会');
        expect(out).not.toContain('科学边界');
        expect(out).not.toContain('创作者');
    });

    it('🔴 `&middot;` 一族必须还原并剔除 —— ⛔ 不许让简介以「&middot; &middot;」开头', () => {
        const out = extractPageSynopsis(DOUBAN_LIKE)!;
        expect(out).not.toContain('&middot;');
        expect(out).not.toContain('·');
        expect(out.startsWith('文化大革命')).toBe(true);
    });

    it('🔴 页面只有「作者简介」没有作品简介 ⇒ 不许把作者简介当回事（宁可按兜底走也不给它）', () => {
        const html =
            '<h2><span>作者简介</span></h2><div>刘慈欣，祖籍河南，长于山西，中国科普作家协会会员，山西省作协会副主席。</div>' +
            '<h2><span>目录</span></h2><div>第一章</div>';
        const out = extractPageSynopsis(html);
        // 兜底可能抽到那段作者简介（它是唯一够长的段落），但**绝不能走「简介小节」这条路**
        // ⇒ 判据落在「sectionHtmlByHeading 没有认领它」上（下面那条测试专门钉这个）
        expect(sectionHtmlByHeading(html)).toBeNull();
        if (out) expect(out).not.toContain('创作者');
    });

    it('`sectionHtmlByHeading` 认「内容简介」，不认「作者简介」', () => {
        expect(sectionHtmlByHeading(DOUBAN_LIKE)).toContain('红岸工程');
        expect(sectionHtmlByHeading('<h2>作者简介</h2><p>甲的履历</p>')).toBeNull();
        expect(sectionHtmlByHeading('<h2>目录</h2><p>x</p>')).toBeNull();
        expect(sectionHtmlByHeading('')).toBeNull();
        expect(sectionHtmlByHeading(null)).toBeNull();
    });

    it('🔴 豆瓣 meta 模板串「图书X 介绍、书评、论坛及推荐」不许当简介', () => {
        const html =
            '<meta name="description" content="图书三体 介绍、书评、论坛及推荐">' +
            '<h2><span>内容简介</span></h2><div>军方探寻外星文明的绝秘计划取得了突破性进展，人类命运就此改变。</div>';
        const out = extractPageSynopsis(html)!;
        expect(out).not.toContain('书评、论坛及推荐');
        expect(out).toContain('绝秘计划');
    });
});

/**
 * 🔴 m15796（用户 2026-11-19：「这个也要搜索能该条目的题材、标签」）：
 * 数据源搜索级常不带题材、豆瓣图书页连标签区块都没了 ⇒ 页面上的结构化题材是最后一条可靠来源。
 */
describe('extractPageGenres（页面题材抽取）', () => {
    it('JSON-LD 的 `genre` 字符串形式', () => {
        const html = '<script type="application/ld+json">{"@type":"Book","name":"三体","genre":"科幻"}</script>';
        expect(extractPageGenres(html)).toEqual(['科幻']);
    });

    it('JSON-LD 的 `genre` 数组形式（多个题材全收）', () => {
        const html = '<script type="application/ld+json">{"@type":"Movie","genre":["科幻","冒险","悬疑"]}</script>';
        expect(extractPageGenres(html)).toEqual(['科幻', '冒险', '悬疑']);
    });

    it('微数据 `property="v:genre"`（豆瓣影视/游戏）', () => {
        const html = '<span property="v:genre">剧情</span><span property="v:genre">爱情</span>';
        expect(extractPageGenres(html)).toEqual(['剧情', '爱情']);
    });

    it('`itemprop="genre"`（部分百科镜像）', () => {
        expect(extractPageGenres('<a itemprop="genre">奇幻</a>')).toEqual(['奇幻']);
    });

    it('去重 + 截到 PAGE_GENRES_MAX', () => {
        const many = Array.from({ length: 12 }, (_, i) => `类型${i}`);
        const html = `<script type="application/ld+json">${JSON.stringify({ genre: many })}</script>`;
        expect(extractPageGenres(html)).toHaveLength(PAGE_GENRES_MAX);
        const dup = '<span property="v:genre">剧情</span><span property="v:genre">剧情</span>';
        expect(extractPageGenres(dup)).toEqual(['剧情']);
    });

    it('⛔ 抽不到 ⇒ `[]`（不返回 undefined —— 调用方直接判 length）', () => {
        expect(extractPageGenres('')).toEqual([]);
        expect(extractPageGenres(null)).toEqual([]);
        expect(extractPageGenres('<p>没有题材信息</p>')).toEqual([]);
    });

    it('坏 JSON-LD 不许抛（整页作废比少抽一个题材严重得多）', () => {
        const html = '<script type="application/ld+json">{这不是 JSON</script><span property="v:genre">科幻</span>';
        expect(extractPageGenres(html)).toEqual(['科幻']);
    });
});
