/**
 * 「从网页里挖出真实 swf 地址」的**纯逻辑**（2026-11-16）—— 无网络 / 无 DOM / 无 `obsidian`，可单测。
 *
 * ## 为什么要把这层单独立出来
 * 用户点「获取」时输入的是一条**游戏详情页**地址（4399 的 `/flash/123.htm`、7k7k 的 `/swf/123.htm`），
 * 而 Ruffle 要的是**那个 `.swf` 文件本身**。两者之间隔着一层站点私有约定：4399 把真实路径写在
 * `_strGamePath` 变量里（相对 `https://sda.4399.com/4399swf`），7k7k 写在 `gamePath:`，
 * 老式页面写 `<param name="movie">` / `<embed src>`，新式页面则给一个**中间播放页**（`.html`）要再抓一次。
 * 这些都是「字符串里找规律」，不碰网络 ⇒ 全部能在这里钉住并单测。
 *
 * ## 与 `pure/flashGame` 的分工
 * - `flashGame`：Ruffle 运行时怎么装、srcdoc 页面怎么拼、`isFlashPath` 怎么判。
 * - 本文件：怎么**找到**要下载的那个地址、文件名怎么起、网页字节怎么解码。
 *
 * ## ⛔ 三条不许踩
 *  ① **不引第三方 HTML 解析器**（`cheerio` / `node-html-parser` 之类）：网页结构是站点私有约定，
 *     解析器帮不上忙；而且插件自带依赖越少越好。正则够了 —— 这些页面本来就是手写模板。
 *  ② **不在此层发请求**：`main.ts` 负责网络与落盘，这里只吃字符串。
 *  ③ **不猜域名**：解析出来的相对地址一律 `resolveUrl()` 按**页面最终地址**拼绝对地址，
 *     ⛔ 别硬拼站点根（4399 的 swf 实际在 `sda.4399.com` 而不是 `www.4399.com`）。
 */

/** 认得的三家站点（其余站点仍走通用规则，只是没有站点私有正则） */
export type FlashSite = '4399' | '7k7k' | '17yy' | 'generic';

/** 命中方式 —— 只用于给用户一句「怎么取到的」，便于他判断要不要重试 */
export type FlashHitVia = 'page-direct' | 'param' | 'embed' | 'flashvars' | 'script' | 'subpage';

/** 解析结果：要么拿到可直接下载的绝对地址，要么给一句面向用户的原因 */
export interface FlashParseResult {
    /** 可直接下载的 swf 绝对地址（`http(s)://…`） */
    swfUrl?: string;
    /** 命中方式（写进提示） */
    via?: FlashHitVia;
    /** 命中方式为 `subpage` 时，这里是那个中间播放页的地址（调用方需要再抓一次） */
    subPageUrl?: string;
    /**
     * 没有 swf 但有**能在 iframe 里跑的在线播放页**（H5 / Unity 小游戏）。
     *
     * 🔴 真机实测（2026-11-16）：4399 的 Unity 中间页（`…/index.html`）带 Referer 校验，
     *    插件直连只会拿到「访问错误」；但把 **4399 自己的播放页**（`…/flash/<id>_2.htm`）
     *    嵌进 iframe 时 Referer 是 4399 自己，游戏就能跑（截图 `_shot/h5-embed-0.png` 实证整页可嵌）。
     *    ⇒ 这里给的是 4399 播放页，不是中间页。
     */
    embedUrl?: string;
    /** 失败原因（面向用户，可直接进 Notice / 弹窗） */
    reason?: string;
}

/** 4399 的 swf 真实根（`_strGamePath` 存的是它的相对路径） */
const E4399_SWF_ROOT = 'https://sda.4399.com/4399swf';

/**
 * 从 4399 详情页里抠出「开始游戏」真正指向的**游戏本体页**（页游 / H5 常见）。
 *
 * 🔴 2026-11-16 用户报障实证：「是内嵌iframe但为什么启动暴走英雄坛开始游戏后就跳转浏览器了」—— 
 *    4399 详情页那颗「开始游戏」不是页内跳转，而是
 *    `<a class="start-btn" href="//www.zxwyouxi.com/g/100053785">`（`target` 缺省 + 站内 JS
 *    再 `window.open`），Electron 宿主把这类新窗口直接丢给**系统浏览器**。
 *    而那个 `zxwyouxi.com/g/<id>` 页面实测无 `X-Frame-Options`、无 CSP，
 *    直接嵌进 iframe 就能玩（真机截图 `_shot/embed-zxw.png`：4399 登录墙之前的游戏画面）。
 *
 * ⇒ 内嵌时优先存**这个真实游戏页**，而不是 4399 详情页：省掉那次必然触发弹窗的点击。
 *
 * 兜底顺序（都要能过 `isFetchableUrl`）：
 *  ① `<a class="start-btn" href=…>`（暴走英雄坛实证的形态）
 *  ② `<a … class="play" … href=…>` / `.go1_game` / `.btn`（其他游戏不同壳）
 *  ③ 页面里出现的 `var G = {… "gameId":"…" }` 旁站外地址（不猜，只认已经写死在 href 里的）
 *
 * ⚠️ 只认**站外 http(s)** 地址：站内相对路径（`/flash/xxx_2.htm`）那套交给 `embedUrl` 兜底。
 */
export function parseGameEmbedPage(html: string, pageUrl: string): string {
    const src = String(html ?? '');
    if (!src.trim()) return '';

    // ① / ② 带 class 的启动锚点：先 start-btn、再 play/go1_game/btn
    const anchors = [
        /<a\b[^>]*class\s*=\s*["'][^"']*\bstart-btn\b[^"']*["'][^>]*>/i,
        /<a\b[^>]*class\s*=\s*["'][^"']*\b(?:go1_game|pag-play)\b[^"']*["'][^>]*>/i,
        /<a\b[^>]*class\s*=\s*["'][^"']*\bplay\b[^"']*["'][^>]*>/i,
    ];
    for (const re of anchors) {
        const tag = re.exec(src);
        if (!tag) continue;
        const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
        if (!href) continue;
        const abs = resolveUrl(pageUrl, href[1]);
        if (abs && isExternalPage(abs, pageUrl)) return abs;
    }

    // ③ 页内 script 里写死的站外游戏页（`mainId` 对应的页游站）
    const gu = /["']((?:https?:)?\/\/[^"'/\s]+\.(?:com|cn|net)\/g\/\d+)["']/i.exec(src);
    if (gu) {
        const abs = resolveUrl(pageUrl, gu[1]);
        if (abs && isExternalPage(abs, pageUrl)) return abs;
    }
    return '';
}

/** 站外页面：host 与来源不同，且确实是 http(s)（⛔ 不认 `javascript:` / `#` / 站内相对） */
function isExternalPage(abs: string, pageUrl: string): boolean {
    if (!/^https?:\/\//i.test(abs)) return false;
    try {
        return new URL(abs).hostname.toLowerCase() !== new URL(String(pageUrl ?? '')).hostname.toLowerCase();
    } catch {
        return false;
    }
}

/**
 * 「这页根本没有 swf」的特征。命中它就不该说「没找到 / 可能已下线」——那是让用户白试。
 * ⚠️ 2026-11-16 真实站点实测补的标记（都是实抓到的）：Unity WebGL 站用
 *    `UnityLoader.instantiate(... "Build/build.json")` + `webgl-content`，**没有** `unityplayer` 字样；
 *    只认旧标记会把「确定性不可用」误报成「可能可用」。
 */
const UNITY_OR_H5_RE =
    /unityloader|unityplayer|WebPlayer\.unity3d|build\.json|webgl-content|h5wan|h5api-core|gameIndex\.html/i;

/** 判站点：只看 host，⛔ 不看整串 URL（详情页路径里带别家名字的情况存在） */
export function siteOf(url: string): FlashSite {
    let host = '';
    try {
        host = new URL(String(url ?? '')).hostname.toLowerCase();
    } catch {
        return 'generic';
    }
    if (!host) return 'generic';
    if (/(^|\.)4399\.com$/.test(host)) return '4399';
    if (/(^|\.)7k7k\.com$/.test(host)) return '7k7k';
    if (/(^|\.)17yy\.com$/.test(host)) return '17yy';
    return 'generic';
}

/** 是否是一个能直接去抓的 http(s) 地址 */
export function isFetchableUrl(raw: string): boolean {
    const s = String(raw ?? '').trim();
    if (!/^https?:\/\//i.test(s)) return false;
    try {
        const u = new URL(s);
        return !!u.hostname;
    } catch {
        return false;
    }
}

/**
 * 把相对地址拼成绝对地址（照 `new URL(rel, base)` 的语义手写，因为这里要能脱离运行时单测）。
 *
 * 🔴 四种形态都要认，漏一种就有一批游戏取不到：
 *  `//sda.4399.com/x.swf`（协议相对，4399 页面里最常见）· `/4399swf/x.swf`（站根相对）·
 *  `../x.swf`（上跳）· `x.swf`（同目录）。已绝对的一律原样返回。
 */
export function resolveUrl(base: string, rel: string): string {
    const r = String(rel ?? '').trim();
    if (!r) return '';
    if (/^(https?:)?\/\//i.test(r)) {
        if (/^https?:\/\//i.test(r)) return r;
        // 协议相对：跟随 base 的协议（base 不是 http(s) 时兜底 https）
        const proto = /^http:\/\//i.test(String(base ?? '')) ? 'http:' : 'https:';
        return `${proto}${r}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return r; // mailto: / data: 之类，交给上层忽略
    let b: URL;
    try {
        b = new URL(String(base ?? ''));
    } catch {
        return '';
    }
    if (r.startsWith('/')) return `${b.protocol}//${b.host}${r}`;
    // 目录 = base 去掉最后一个路径段
    const dir = b.pathname.replace(/[^/]*$/, '');
    const segs = `${dir}${r}`.split('/');
    const out: string[] = [];
    for (const seg of segs) {
        if (seg === '.' || seg === '') continue;
        if (seg === '..') {
            out.pop();
            continue;
        }
        out.push(seg);
    }
    return `${b.protocol}//${b.host}/${out.join('/')}`;
}

/** HTML 实体解码（只解会影响 URL 的几个；`&amp;` 不解会把查询串的下一个参数名吞进地址） */
export function decodeHtmlEntities(raw: string): string {
    return String(raw ?? '')
        .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => {
            const n = parseInt(h, 16);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _m;
        })
        .replace(/&#(\d+);/g, (_m, d: string) => {
            const n = parseInt(d, 10);
            return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _m;
        })
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');
}

/** 取第一个捕获组（没有则 `null`）—— 让下面的规则表能一行一条 */
function first(html: string, re: RegExp): string | null {
    const m = String(html ?? '').match(re);
    return m && m[1] ? decodeHtmlEntities(m[1].trim()) : null;
}

/**
 * 4399 `_strGamePath` 存的是相对路径 ⇒ 拼上真实根；已是绝对/协议相对的原样解析。
 *
 * ⚠️ **前缀要去重**：绝大多数页面的值是 `/upload_swf/ftp35/…/x.swf`（不带根），
 *    但也有页面直接写了 `/4399swf/upload_swf/…` ⇒ 无脑拼会得到 `…/4399swf/4399swf/…` 这种 404 地址。
 *    修法是「值已经以根路径开头就不再加前缀」—— 只去掉**根的那一段**，不是硬删字符串。
 */
function e4399Path(raw: string, pageUrl: string): string {
    const v = String(raw ?? '').trim();
    if (!v) return '';
    if (/^(https?:)?\/\//i.test(v)) return resolveUrl(pageUrl, v);
    const rootPath = '/4399swf'; // E4399_SWF_ROOT 的路径部分
    const path = v.startsWith('/') ? v : `/${v}`;
    if (path === rootPath || path.startsWith(`${rootPath}/`)) {
        return `https://sda.4399.com${path}`;
    }
    return `${E4399_SWF_ROOT}${path}`;
}

/** 中间播放页的判定：站点私有变量里存的是 `.htm` / `.html` */
export function extractSubPageUrl(html: string, pageUrl: string): string | null {
    const src = String(html ?? '');
    const e4399 = first(src, /_strGamePath\s*=\s*["']([^"']*\.html?[^"']*)["']/i);
    if (e4399) return e4399Path(e4399, pageUrl);
    const bySite = first(src, /gamePath\s*:\s*["']([^"']*\.html?[^"']*)["']/i);
    if (bySite) return resolveUrl(pageUrl, bySite);
    const sda = first(src, /src\s*=\s*["'](https?:\/\/sda\.4399\.com\/[^"']*\.html?[^"']*)["']/i);
    if (sda) return resolveUrl(pageUrl, sda);
    return null;
}

/**
 * 从一页 HTML 里挖 swf 地址。命中顺序 = **可信度从高到低**（站点私有变量 > `<param>` / `<embed>` >
 * flashvars > 任意引号里的 `.swf`）。
 *
 * 🔴 唯一一条不能变的是**顺序**：站点私有变量里那个是运营配的正式地址；
 *    页面上还散落着广告位 / 推荐位的 `.swf`，谁先命中谁被下载 —— 顺序错了会下到别人的影片。
 * ⚠️ 全部命中都失败时，只有当页面上存在「中间播放页」才回 `subPageUrl`（调用方再抓一次）；
 *    否则给 `reason`（面向用户）。
 */
export function parseFlashPage(html: string, pageUrl: string): FlashParseResult {
    const src = String(html ?? '');
    if (!src.trim()) return { reason: '页面是空的，可能地址不对或需要登录' };

    const site = siteOf(pageUrl);

    // ① 站点私有变量（最可信）
    if (site === '4399') {
        const v = first(src, /_strGamePath\s*=\s*["']([^"']*\.swf[^"']*)["']/i);
        if (v) {
            const url = e4399Path(v, pageUrl);
            if (url) return { swfUrl: url, via: 'page-direct' };
        }
        const sda = first(src, /src\s*=\s*["']((?:https?:)?\/\/sda\.4399\.com\/[^"']*\.swf[^"']*)["']/i);
        if (sda) {
            const url = resolveUrl(pageUrl, sda);
            if (url) return { swfUrl: url, via: 'script' };
        }
    }
    if (site === '7k7k' || site === '17yy') {
        const v = first(src, /gamePath\s*:\s*["']([^"']*\.swf[^"']*)["']/i);
        if (v) {
            const url = resolveUrl(pageUrl, v);
            if (url) return { swfUrl: url, via: 'page-direct' };
        }
        const sub = first(src, /_src_\s*=\s*["']([^"']*\.swf[^"']*)["']/i);
        if (sub) {
            const url = resolveUrl(pageUrl, sub);
            if (url) return { swfUrl: url, via: 'script' };
        }
    }

    // ② 通用：`<param name="movie" value="x.swf">`，属性顺序两种都要认
    const paramA = first(src, /<param[^>]+name\s*=\s*["']movie["'][^>]*value\s*=\s*["']([^"']+\.swf[^"']*)["']/i);
    if (paramA) {
        const url = resolveUrl(pageUrl, paramA);
        if (url) return { swfUrl: url, via: 'param' };
    }
    const paramB = first(src, /<param[^>]+value\s*=\s*["']([^"']+\.swf[^"']*)["'][^>]*name\s*=\s*["']movie["']/i);
    if (paramB) {
        const url = resolveUrl(pageUrl, paramB);
        if (url) return { swfUrl: url, via: 'param' };
    }

    // ③ `<embed src="x.swf">`（单双引号都要认）
    const embed = first(src, /<embed[^>]+src\s*=\s*["']([^"']+\.swf[^"']*)["']/i);
    if (embed) {
        const url = resolveUrl(pageUrl, embed);
        if (url) return { swfUrl: url, via: 'embed' };
    }

    // ④ flashvars 里塞的（`swf=` / `file=` / `movie=` / `url=`）
    const fvAttr = first(src, /flashvars\s*=\s*["']([^"']+)["']/i);
    if (fvAttr) {
        const inner = first(fvAttr, /(?:^|&|\?)(?:swf|file|movie|url)\s*[=:]\s*([^&\s"']+\.swf[^&\s"']*)/i);
        if (inner) {
            const url = resolveUrl(pageUrl, inner);
            if (url) return { swfUrl: url, via: 'flashvars' };
        }
    }

    // ⑤ 兜底：任意引号里的 `.swf`（含带查询串的）
    const anySwf = first(src, /["']([^"'<>\s]+\.swf(?:\?[^"'<>\s]*)?)["']/i);
    if (anySwf) {
        const url = resolveUrl(pageUrl, anySwf);
        if (url) return { swfUrl: url, via: 'script' };
    }

    // ⑥ 没有直接地址，但给了中间播放页 ⇒ 让调用方再抓一次
    const subPageUrl = extractSubPageUrl(src, pageUrl);
    if (subPageUrl) return { via: 'subpage', subPageUrl };

    // ⑦ 是 H5 / Unity 之类的新式页面（本来就没有 swf）
    // ⚠️ 真实站点实测（2026-11-16，4399 flash/216338）：`_strGamePath` 指向的中间页是 **Unity WebGL**，
    //    页面上只有 `UnityLoader.instantiate("gameContainer", "Build/build.json")` + `webgl-content`，
    //    既没有 `unityplayer` 也没有 `h5api-core`。只认旧标记 ⇒ 误报「可能已下线」，用户会白试。
    // 🔴 但「没有 swf」≠「不能玩」：真机探针证明把 **4399 详情页本身**嵌进 iframe 能正常出整页、
    //    点「开始游戏」能进 H5 游戏（截图 `_shot/h5-embed-0.png` / `_shot/h5-play.png`）。
    //    ⇒ 这种情况给调用方一个 `embedUrl`（就是用户填的这个详情页），让它改走内嵌而不是报错。
    if (UNITY_OR_H5_RE.test(src)) {
        return { embedUrl: pageUrl, reason: '这个页面是 Unity / H5 版，没有 swf 可直接下载' };
    }
    return { reason: '页面里没找到 swf 地址（可能已下线，或地址填成了分类页）' };
}

/**
 * 把用户粘错的**页面形态**纠正成能解析的那一种（口径来自原项目 `HtmlAnalyse`）。
 *
 * 🔴 真实存在的三种错法（用户从地址栏 / 收藏夹复制时自然产生）：
 *  · `7k7k.com/flash/123.htm` → 真正的详情页在 `/swf/123.htm`（`/flash/` 是分类页外壳）
 *  · `17yy.com/f/123.html`   → 真正能解析的在 `/f/play/123.html`
 *  · 4399 的 `/flash/123_2.htm`（播放页）能解析，但存 `gameEmbed` 时应存详情页（见 `embedPageOf`）
 *
 * ⚠️ 只做**形态纠正**，⛔ 不改域名、不动查询串 —— 猜错域名比不纠正更糟。
 */
export function normalizeGamePageUrl(raw: string): string {
    const s = String(raw ?? '').trim();
    if (!isFetchableUrl(s)) return s;
    const site = siteOf(s);
    if (site === '7k7k') return s.replace(/(\/\/[^/]*7k7k\.com)\/flash\//i, '$1/swf/');
    if (site === '17yy') return s.replace(/(\/\/[^/]*17yy\.com)\/f\/(?!play\/)/i, '$1/f/play/');
    return s;
}

/**
 * 从游戏**详情页 HTML** 里抽舞台原始宽高。
 *
 * 🔴 三家站点各写各的（口径来自 `icefairy999/FlashGameDownloader` 的 `HtmlAnalyse`，
 *    2026-11-16 逐行核过）：4399 用 `_w = 800,` / `_h = 480,`，7k7k 用 `gamewidth: 800,`，
 *    17yy 用 `flash_w = 800;`。⛔ 别为了「统一」只认一种 —— 那样另两家永远拿不到尺寸。
 *
 * ⚠️ 返回值可能只给一边（另一个正则没命中）；**成对校验**在 `pure/flashGame.clampGameStage`，
 *    本函数只负责「按站点口径尽量抽」，不做合理性判断。
 */
export function parseGameStage(html: string, pageUrl: string): { width?: number; height?: number } {
    const src = String(html ?? '');
    if (!src.trim()) return {};
    const site = siteOf(pageUrl);
    const grab = (re: RegExp): number | undefined => {
        const v = first(src, re);
        if (!v) return undefined;
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    if (site === '4399') {
        return {
            width: grab(/\b_w\s*=\s*["']?(\d{2,5})\s*[,;]/i),
            height: grab(/\b_h\s*=\s*["']?(\d{2,5})\s*[,;]/i),
        };
    }
    if (site === '7k7k') {
        return {
            width: grab(/gamewidth\s*:\s*["']?(\d{2,5})/i),
            height: grab(/gameheight\s*:\s*["']?(\d{2,5})/i),
        };
    }
    if (site === '17yy') {
        return {
            width: grab(/flash_w\s*=\s*["']?(\d{2,5})/i),
            height: grab(/flash_h\s*=\s*["']?(\d{2,5})/i),
        };
    }
    // 其他站点：先试通用 `width="800" height="480"` 的 embed/object 写法
    const w = grab(/<embed[^>]+width\s*=\s*["']?(\d{2,5})/i);
    const h = grab(/<embed[^>]+height\s*=\s*["']?(\d{2,5})/i);
    return { width: w, height: h };
}

/**
 * 从 17yy 页面里抽 POST ajax 需要的两个入参。
 *
 * 🔴 17yy 的 swf 路径**不在 HTML 里**（2026-11-16 逐份读原项目 `HtmlAnalyse.Get17yySwfPathInNewPage`
 *    才发现的）：它要 POST `http://www.17yy.com/e/payapi/vip_ajax.php`
 *    （`action=getStatus`、`id=<gameid>`）拿 `data.game_path`，再拼
 *    `http://img1.17yy.com/swf/<gameCategory>/<latterpath>`。
 *    原项目作者自己注释「我找不到足够的样本做实验」⇒ 我们这条链要能失败得体面（拿不到就给 reason）。
 */
export function parse17yyAjaxParams(html: string, pageUrl: string): { gameId?: string; category?: string } {
    const src = String(html ?? '');
    // 分类：页面里 `var date = "xxx";`（原项目的写法就是这个名字，别「纠正」成 category）
    const category = first(src, /\bvar\s+date\s*=\s*["']([^"']+)["']/i)?.trim();
    // gameid：优先页面变量，其次 URL 里的数字段
    const fromPage = first(src, /\bm7_gameid\s*=\s*["']?(\d+)/i)?.trim();
    const fromUrl = first(String(pageUrl ?? ''), /\/(?:f\/play|f|swf|game)\/(\d+)/i)?.trim();
    const fallback = first(String(pageUrl ?? ''), /(\d{3,})/)?.trim();
    return { gameId: fromPage || fromUrl || fallback, category };
}

/**
 * 拼 17yy 的 swf 绝对地址（`latterpath` 来自 ajax 的 `data.game_path`）。
 * ⚠️ 根是 `img1.17yy.com/swf/`，与详情页域名不同；⛔ 别用 `resolveUrl(pageUrl, …)` 猜。
 */
export function build17yySwfUrl(category: string, latterPath: string): string {
    const cat = String(category ?? '').trim().replace(/^\/+|\/+$/g, '');
    const rest = String(latterPath ?? '').trim().replace(/^\/+/g, '');
    if (!rest) return '';
    if (/^https?:\/\//i.test(rest)) return rest;
    const tail = cat ? `${cat}/${rest}` : rest;
    return `http://img1.17yy.com/swf/${tail}`;
}

/** 从 swf 地址推一个下载文件名（去掉查询串、解码百分号、保证 `.swf` 结尾） */
export function swfFileNameOf(swfUrl: string, fallback = 'flash-game'): string {
    let path = String(swfUrl ?? '');
    const q = path.search(/[?#]/);
    if (q >= 0) path = path.slice(0, q);
    let base = path.replace(/[\\/]+$/, '').split('/').pop() ?? '';
    try {
        base = decodeURIComponent(base);
    } catch {
        /* 百分号坏了就用原样 */
    }
    base = base.trim();
    if (!base) return `${fallback}.swf`;
    if (/\.swf$/i.test(base)) return base;
    return `${base}.swf`;
}

/** 不判内容的「看着像 404」——只用于把失败原因说得更准 */
export function looksLike404(html: string): boolean {
    const s = String(html ?? '');
    if (s.length > 20000) return false;
    return /<title>\s*404\b/i.test(s) || /404 Not Found/i.test(s) || /页面不存在|找不到页面/.test(s);
}

/**
 * 网页字节 → 文本。中文站至今仍有 GBK 页面（4399 老页面就有），而 `Buffer.toString('utf8')`
 * 会把它们变成一片 `锟斤拷` ⇒ 正则全部失配，用户得到「页面里没找到 swf」这种误导性结论。
 *
 * 判据顺序：`content-type` 里声明的 charset → 页面 `<meta charset>` → UTF-8 严格解码成功就用 UTF-8 →
 * 否则 GBK。⛔ 不引 `iconv-lite`：Node 自带完整 ICU，`new TextDecoder('gbk')` 直接可用（已实测）。
 */
export function decodeHtmlBytes(bytes: Uint8Array, contentType = ''): string {
    const buf = bytes ?? new Uint8Array(0);
    const declared = (String(contentType ?? '').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? '').toLowerCase();
    const tryDecode = (enc: string): string | null => {
        try {
            return new TextDecoder(enc, { fatal: false }).decode(buf);
        } catch {
            return null;
        }
    };
    if (declared && !/^utf-?8$/.test(declared)) {
        const t = tryDecode(declared);
        if (t !== null) return t;
    }
    // 先按 utf-8 严格试：能解出来就说明本来就是 utf-8（GBK 字节在 utf-8 下几乎必然抛错）
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        /* 落到 meta / 回退 */
    }
    // meta charset（只看前 4KB，避免把正文里的字符误当声明）
    const head = new TextDecoder('latin1').decode(buf.subarray(0, 4096));
    const metaEnc = (head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? '').toLowerCase();
    if (metaEnc) {
        const t = tryDecode(metaEnc);
        if (t !== null) return t;
    }
    return tryDecode('gbk') ?? new TextDecoder('utf-8').decode(buf);
}
