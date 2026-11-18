/**
 * 🔴 m09330：`pure/pageText` 的守护测试。
 *
 * 背景（用户 2026-11-18：「怎么AI搜索出来每个条目简介都是编的，我要的是原生原味的简介」）：
 * AI 预填的简介必须来自**权威页面原文**，而必应 RSS 只有摘要、元数据源搜索级常不带简介。
 * 这个模块负责从页面 HTML 里把那段原文抽出来 —— 它抽错了，用户拿到的就还是错的。
 */
import { describe, expect, it } from 'vitest';
import {
    PAGE_SYNOPSIS_MAX,
    PAGE_TEXT_MAX,
    decodePageEntities,
    extractPageSynopsis,
    pageReadableText,
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
