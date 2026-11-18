/**
 * `pure/flashFetch` 的单元测试（2026-11-16）。
 *
 * 这层做的是「网页字符串 → 真实 swf 地址」，三类坑全是纯字符串就能钉住的：
 *  ① **解析顺序**：站点私有变量 > `<param>`/`<embed>` > flashvars > 兜底正则。
 *     顺序错了会下到页面上广告位里的别的 `.swf`（谁先命中谁被下载）。
 *  ② **相对地址拼接**：`//host/x.swf`（协议相对）、`/x.swf`（站根）、`../x.swf`（上跳）、
 *     `x.swf`（同目录）四种都要对。4399 的 swf 真实根是 `sda.4399.com` 而不是详情页域名，
 *     ⛔ 别用「页面根 + 相对路径」硬拼。
 *  ③ **GBK 页面**：中文站老页面是 GBK，按 UTF-8 解会全成乱码 ⇒ 正则全体失配，
 *     用户看到的却是「页面里没找到 swf」这种误导性结论。
 */
import { describe, expect, it } from 'vitest';
import {
    decodeHtmlBytes,
    extractSubPageUrl,
    isFetchableUrl,
    looksLike404,
    parseFlashPage,
    parseGameEmbedPage,
    resolveUrl,
    siteOf,
    swfFileNameOf,
} from 'pure/flashFetch';

describe('siteOf（只认 host，不看整串 URL）', () => {
    it('认三家站点', () => {
        expect(siteOf('https://www.4399.com/flash/123.htm')).toBe('4399');
        expect(siteOf('https://www.7k7k.com/swf/123.htm')).toBe('7k7k');
        expect(siteOf('http://www.17yy.com/f/play/123.html')).toBe('17yy');
    });
    it('子域名也算（sda.4399.com 是 swf 的真实宿主）', () => {
        expect(siteOf('https://sda.4399.com/4399swf/upload_swf/x.swf')).toBe('4399');
    });
    it('别家 / 坏地址 / 空值 ⇒ generic', () => {
        expect(siteOf('https://example.com/a.htm')).toBe('generic');
        expect(siteOf('not a url')).toBe('generic');
        expect(siteOf('')).toBe('generic');
    });
    it('⛔ 路径里带 4399 字样但 host 不是它 ⇒ 不算 4399', () => {
        expect(siteOf('https://example.com/4399.com/flash/1.htm')).toBe('generic');
    });
});

describe('isFetchableUrl', () => {
    it('http(s) + 有 host 才算', () => {
        expect(isFetchableUrl('https://a.com/x')).toBe(true);
        expect(isFetchableUrl('http://a.com')).toBe(true);
    });
    it('别的形态一律不算（前端必须先拦住，别等发请求才报错）', () => {
        expect(isFetchableUrl('file:///C:/x.swf')).toBe(false);
        expect(isFetchableUrl('a.com/x')).toBe(false);
        expect(isFetchableUrl('https://')).toBe(false);
        expect(isFetchableUrl('')).toBe(false);
    });
});

describe('resolveUrl（四种相对形态）', () => {
    const base = 'https://www.4399.com/flash/2024/123.htm';
    it('已绝对 ⇒ 原样', () => {
        expect(resolveUrl(base, 'https://sda.4399.com/a.swf')).toBe('https://sda.4399.com/a.swf');
    });
    it('协议相对 ⇒ 跟随 base 协议', () => {
        expect(resolveUrl(base, '//sda.4399.com/a.swf')).toBe('https://sda.4399.com/a.swf');
        expect(resolveUrl('http://www.4399.com/x.htm', '//sda.4399.com/a.swf')).toBe(
            'http://sda.4399.com/a.swf',
        );
    });
    it('站根相对 ⇒ 换路径不换 host', () => {
        expect(resolveUrl(base, '/4399swf/a.swf')).toBe('https://www.4399.com/4399swf/a.swf');
    });
    it('上跳 ⇒ 吃掉一层目录', () => {
        expect(resolveUrl(base, '../a.swf')).toBe('https://www.4399.com/flash/a.swf');
        expect(resolveUrl(base, '../../a.swf')).toBe('https://www.4399.com/a.swf');
        expect(resolveUrl(base, '../../../a.swf')).toBe('https://www.4399.com/a.swf');
    });
    it('同目录 ⇒ 拼在上一级路径后', () => {
        expect(resolveUrl(base, 'a.swf')).toBe('https://www.4399.com/flash/2024/a.swf');
    });
    it('空 / 坏 base ⇒ 空串（调用方据此判失败，⛔ 别回一个半截地址去下载）', () => {
        expect(resolveUrl(base, '')).toBe('');
        expect(resolveUrl('nope', 'a.swf')).toBe('');
    });
});

describe('parseFlashPage —— 4399', () => {
    const page = 'https://www.4399.com/flash/123.htm';
    it('`_strGamePath` 是相对路径 ⇒ 拼 sda.4399.com 的真实根', () => {
        const html = `var _strGamePath = "/upload_swf/ftp35/game/abc.swf";`;
        expect(parseFlashPage(html, page)).toEqual({
            swfUrl: 'https://sda.4399.com/4399swf/upload_swf/ftp35/game/abc.swf',
            via: 'page-direct',
        });
    });
    it('`_strGamePath` 已带前导斜杠也只拼一次前缀（⛔ 别出双斜杠）', () => {
        const html = `var _strGamePath = "/x.swf";`;
        const r = parseFlashPage(html, page);
        expect(r.swfUrl).toBe('https://sda.4399.com/4399swf/x.swf');
        expect(r.swfUrl).not.toContain('4399swf//');
    });
    it('单引号写法也认（老页面两种引号混用）', () => {
        const html = `_strGamePath = '/upload_swf/a.swf'`;
        expect(parseFlashPage(html, page).swfUrl).toBe('https://sda.4399.com/4399swf/upload_swf/a.swf');
    });
    it('没有私有变量时退到 sda.4399.com 的 src', () => {
        const html = `<embed src='//sda.4399.com/4399swf/upload_swf/b.swf'>`;
        expect(parseFlashPage(html, page)).toEqual({
            swfUrl: 'https://sda.4399.com/4399swf/upload_swf/b.swf',
            via: 'script',
        });
    });
});

describe('parseFlashPage —— 7k7k / 17yy', () => {
    it('7k7k `gamePath:`', () => {
        const html = `var cfg = { gamePath: "https://imgs.7k7k.com/game/x.swf", };`;
        expect(parseFlashPage(html, 'https://www.7k7k.com/swf/9.htm')).toEqual({
            swfUrl: 'https://imgs.7k7k.com/game/x.swf',
            via: 'page-direct',
        });
    });
    it('17yy `_src_`（相对路径按播放页解析）', () => {
        const html = `_src_ = 'up/9/game.swf';`;
        expect(parseFlashPage(html, 'http://www.17yy.com/f/play/9.html').swfUrl).toBe(
            'http://www.17yy.com/f/play/up/9/game.swf',
        );
    });
});

describe('parseFlashPage —— 通用规则与命中顺序', () => {
    const page = 'https://example.com/game/1.html';
    it('<param name="movie">（属性顺序两种都认）', () => {
        expect(parseFlashPage('<param name="movie" value="a.swf">', page)).toEqual({
            swfUrl: 'https://example.com/game/a.swf',
            via: 'param',
        });
        expect(
            parseFlashPage('<param value="b.swf" name="movie">', page).via,
        ).toBe('param');
    });
    it('<embed src>', () => {
        expect(parseFlashPage('<embed type="x" src="c.swf" wmode="opaque">', page).via).toBe('embed');
    });
    it('flashvars 里塞的 swf', () => {
        const html = `<embed flashvars="ad=0&file=d.swf&x=1">`;
        expect(parseFlashPage(html, page).swfUrl).toBe('https://example.com/game/d.swf');
    });
    it('兜底：任意引号里的 .swf（含查询串）', () => {
        const html = `<script>open("e.swf?v=2")</script>`;
        expect(parseFlashPage(html, page).swfUrl).toBe('https://example.com/game/e.swf?v=2');
    });
    it('🔴 站点私有变量优先于页面上的零散 .swf（否则下到广告位）', () => {
        const html = `
            <embed src="ad/banner.swf">
            var _strGamePath = "/upload_swf/real.swf";
        `;
        expect(parseFlashPage(html, 'https://www.4399.com/flash/1.htm').swfUrl).toContain('real.swf');
    });
});

describe('parseFlashPage —— 中间播放页与失败原因', () => {
    it('中间播放页：私有变量是 .html ⇒ 回 subPageUrl（调用方再抓一次）', () => {
        const html = `var _strGamePath = "/upload_swf/new/1.html";`;
        const r = parseFlashPage(html, 'https://www.4399.com/flash/1.htm');
        expect(r.swfUrl).toBeUndefined();
        expect(r.via).toBe('subpage');
        expect(r.subPageUrl).toBe('https://sda.4399.com/4399swf/upload_swf/new/1.html');
    });
    it('🔴 前缀去重：值已带 /4399swf/ 时不许出双前缀（否则是一个 404 地址）', () => {
        const r = parseFlashPage(`var _strGamePath = "/4399swf/upload_swf/a.swf";`, 'https://www.4399.com/f/1.htm');
        expect(r.swfUrl).toBe('https://sda.4399.com/4399swf/upload_swf/a.swf');
        expect(r.swfUrl).not.toContain('4399swf/4399swf');
    });
    it('前缀去重同样作用于中间播放页', () => {
        const r = parseFlashPage(`var _strGamePath = "/4399swf/upload_swf/new/1.html";`, 'https://www.4399.com/f/1.htm');
        expect(r.subPageUrl).toBe('https://sda.4399.com/4399swf/upload_swf/new/1.html');
    });
    it('extractSubPageUrl 也认 7k7k 的 gamePath .html', () => {
        expect(
            extractSubPageUrl('gamePath: "https://a.com/p/1.html"', 'https://www.7k7k.com/swf/1.htm'),
        ).toBe('https://a.com/p/1.html');
    });
    it('H5 / Unity 页面 ⇒ 明确说没有 swf（⛔ 别报「没找到」让人白试）', () => {
        const r = parseFlashPage('<script src="h5api-core.js"></script>', 'https://www.4399.com/x.htm');
        expect(r.swfUrl).toBeUndefined();
        expect(r.reason).toContain('H5');
    });
    it('H5 / Unity 页面 ⇒ 同时回一个能内嵌的播放页（2026-11-16 真机实证可跑）', () => {
        // 🔴 「没有 swf」≠「不能玩」：4399 详情页本身无 X-Frame-Options / 无 CSP，
        //    嵌进 iframe 能出整页并进游戏（截图 _shot/h5-embed-0.png）⇒ 必须把地址带回去。
        const r = parseFlashPage('<script src="h5api-core.js"></script>', 'https://www.4399.com/flash/216338.htm');
        expect(r.embedUrl).toBe('https://www.4399.com/flash/216338.htm');
        // 原因仍要说清楚「没有 swf」，避免调用方以为下载失败
        expect(r.reason).toContain('Unity');
    });
    it('🔴 内嵌优先用「开始游戏」那一跳的真实游戏页，而不是 4399 详情页（否则点击必弹系统浏览器）', () => {
        // 2026-11-16 用户报障：「是内嵌iframe但为什么启动暴走英雄坛开始游戏后就跳转浏览器了」
        // 实抓的 4399 页面（gbk 解码后）就是这颗锚点：
        //   <a href="//www.zxwyouxi.com/g/100053785" class="start-btn" style='top: 430px;left: 65%;'>
        const page = `<div class="p_img"><a class="go1_game" target="_self" href="/flash/204765_2.htm"></a></div>
            <a href="//www.zxwyouxi.com/g/100053785" class="start-btn" style='top: 430px;left: 65%;'>`;
        expect(parseGameEmbedPage(page, 'https://www.4399.com/flash/204765.htm')).toBe(
            'https://www.zxwyouxi.com/g/100053785',
        );
    });
    it('parseGameEmbedPage：站内相对 href 不算真实游戏页（⛔ 别把 /flash/x_2.htm 当页游地址）', () => {
        const page = '<a class="go1_game" target="_self" href="/flash/216338_2.htm"></a>';
        expect(parseGameEmbedPage(page, 'https://www.4399.com/flash/216338.htm')).toBe('');
    });
    it('parseGameEmbedPage：认 play / pag-play 形态的站外启动锚点', () => {
        const page = '<a class="pag-play" href="//game.example.com/g/998877"></a>';
        expect(parseGameEmbedPage(page, 'https://www.4399.com/flash/1.htm')).toBe('https://game.example.com/g/998877');
    });
    it('parseGameEmbedPage：脚本里写死的 /g/<数字> 站外地址兜底', () => {
        const page = '<script>var cfg = {"url":"//h5wan.example.com/g/123456"};</script>';
        expect(parseGameEmbedPage(page, 'https://www.4399.com/flash/1.htm')).toBe('https://h5wan.example.com/g/123456');
    });
    it('parseGameEmbedPage：空页面 / 无站外地址 ⇒ 空串（调用方退回详情页）', () => {
        expect(parseGameEmbedPage('', 'https://www.4399.com/flash/1.htm')).toBe('');
        expect(parseGameEmbedPage('<a class="start-btn" href="javascript:;">x</a>', 'https://www.4399.com/flash/1.htm')).toBe(
            '',
        );
    });
    it('🔴 4399 真实中间页（Unity WebGL）要认成「本来就没有 swf」而不是「可能已下线」', () => {
        // 2026-11-16 从 sda.4399.com/…/index.html 实抓的页面骨架，一字未改结构
        const unity = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>UnityEscapeGame</title>
            <script src="TemplateData/UnityProgress.javascript"></script>
            <script src="Build/UnityLoader.js"></script>
            <script>var gameInstance = UnityLoader.instantiate("gameContainer", "Build/build.json", {onProgress: UnityProgress});</script>
            </head><body><div class="webgl-content" id="weglContainer"><div id="gameContainer"></div></div></body></html>`;
        const r = parseFlashPage(unity, 'https://sda.4399.com/4399swf/upload_swf/x/index.html');
        expect(r.swfUrl).toBeUndefined();
        expect(r.reason).toBeTruthy();
        // 关键：不许落到「没找到 / 已下线」那条误导性原因上
        expect(r.reason).not.toContain('已下线');
        expect(r.reason).toContain('Unity');
    });
    it('4399 详情页 `_strGamePath` 指向 index.html ⇒ 先回 subPageUrl 再抓一层', () => {
        const html = `var _strGamePath = "/upload_swf/ftp33/gamehwq/20201027/10/index.html";`;
        const r = parseFlashPage(html, 'https://www.4399.com/flash/216338.htm');
        expect(r.swfUrl).toBeUndefined();
        expect(r.via).toBe('subpage');
        expect(r.subPageUrl).toBe(
            'https://sda.4399.com/4399swf/upload_swf/ftp33/gamehwq/20201027/10/index.html',
        );
    });
    it('空页面 / 什么都没有 ⇒ 各有各的原因', () => {
        expect(parseFlashPage('   ', 'https://a.com/1').reason).toBeTruthy();
        expect(parseFlashPage('<html><body>hi</body></html>', 'https://a.com/1').reason).toContain('没找到');
    });
});

describe('swfFileNameOf', () => {
    it('去掉查询串与哈希', () => {
        expect(swfFileNameOf('https://a.com/x/game.swf?v=1#t')).toBe('game.swf');
    });
    it('百分号解码（中文名要还原）', () => {
        expect(swfFileNameOf('https://a.com/%E7%81%AB%E5%BD%B1.swf')).toBe('火影.swf');
    });
    it('没有 .swf 结尾 ⇒ 补上', () => {
        expect(swfFileNameOf('https://a.com/download?id=9')).toBe('download.swf');
    });
    it('坏百分号 / 空值 ⇒ 不崩，有兜底', () => {
        expect(swfFileNameOf('https://a.com/%ZZ.swf')).toBe('%ZZ.swf');
        expect(swfFileNameOf('')).toBe('flash-game.swf');
    });
});

describe('looksLike404', () => {
    it('三种措辞都算', () => {
        expect(looksLike404('<title>404 Not Found</title>')).toBe(true);
        expect(looksLike404('404 Not Found')).toBe(true);
        expect(looksLike404('<p>页面不存在</p>')).toBe(true);
    });
    it('大页面不判（正文里出现 404 字样太常见）', () => {
        expect(looksLike404(`404 Not Found ${'x'.repeat(30000)}`)).toBe(false);
    });
    it('正常页面不判', () => {
        expect(looksLike404('<html>正常</html>')).toBe(false);
    });
});

describe('decodeHtmlBytes', () => {
    const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
    it('UTF-8 原样', () => {
        expect(decodeHtmlBytes(utf8('<p>中文</p>'), 'text/html; charset=utf-8')).toContain('中文');
    });
    it('GBK 字节也能解出来（4399 老页面）', () => {
        // 「中文」的 GBK 编码是 d6 d0 ce c4
        const gbk = new Uint8Array([0x3c, 0x70, 0x3e, 0xd6, 0xd0, 0xce, 0xc4, 0x3c, 0x2f, 0x70, 0x3e]);
        expect(decodeHtmlBytes(gbk, 'text/html')).toContain('中文');
    });
    it('content-type 声明 gbk 时按声明解', () => {
        const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
        expect(decodeHtmlBytes(gbk, 'text/html; charset=gbk')).toBe('中文');
    });
    it('空字节不崩', () => {
        expect(decodeHtmlBytes(new Uint8Array(0))).toBe('');
    });
});

describe('纯层卫生', () => {
    it('不 import obsidian / fs / require（否则单测跑不起来，分层也破了）', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync('src/pure/flashFetch.ts', 'utf8');
        expect(src).not.toMatch(/from ['"]obsidian['"]/);
        expect(src).not.toMatch(/require\(/);
        expect(src).not.toMatch(/from ['"]node:/);
    });
});
