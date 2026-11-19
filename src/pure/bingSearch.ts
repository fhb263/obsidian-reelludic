// 必应网页搜索（**RSS 形态**）—— AI 预填「联网搜索」工具背后的那条通道（纯逻辑，可单测）。
//
// 🔴 实测取证（2026-10-03，真请求，`_probe_websearch_499d.cjs`）：
//   `GET https://cn.bing.com/search?q=<词>&format=rss` + 浏览器 UA
//   ⇒ **HTTP 200、10 条 `<item>`**，`title` / `link` / `description` 齐全，**不需要 Cookie / Key**。
//   中文查询命中质量实测：第 1 条常是百度百科整段（导演/主演/上映日期全有）、第 2 条豆瓣条目页。
//
// ⚠️ **试过但不用**（同一次探针，如实记录，⛔ 别回头再试）：
//   · DuckDuckGo（`html.duckduckgo.com` / `lite` / Instant Answer API）**本机一概 `fetch failed`**；
//   · 两个公有 SearXNG 实例同样连不上；维基百科 zh API 也不通；
//   · 必应 / 百度 / 搜狗 / 360 的 **HTML 结果页**能连上（200），但都是**重型 JS 页面**
//     （百度单页 1MB、必应 100KB，结果块靠脚本渲染）⇒ 解析脆、易随改版失效。
//   ⇒ **RSS 是唯一「结构化 + 稳定」的免费档**，也是本模块存在的理由。
//
// 🔴🔴 2026-11-19 追加实测（用户 m15532「AI预填的GLM4-flash模型搜索怎么只依据元数据源搜索的，
//   要依据网络权威搜索啊」的第二层真因）：**含空格的中文多段查询会被逐字拆词** ——
//   `七里香 周杰伦 简介` 返回 `七（汉语汉字）_百度百科`、`名侦探柯南 豆瓣` 返回 `名_百度百科`。
//   ⇒ 地址构造前先过 `compactBingQuery()` 单段化（完整证据与「试过但无效」的六种参数都记在那）;
//   于是「提示词让模型联网搜」才真的能搜到条目页。⛔ 别把这一步去掉。
//
// ⛔ 这里只做「地址构造 + 解析 + 文本化」三件事；发请求在 `services/aiPrefill`（走宿主网络栈）。
// ⚠️ 用 `decodeHtmlText`（剥标签 → 还原实体 → 折叠空白 → trim）而不是只还原实体的那个：
//    RSS 的 `description` 里**带高亮标签**（必应会给命中词包 `<b>`），只还原实体会把标签原样喂给模型。
import { decodeHtmlText } from 'pure/htmlText';

/** 实测可用的主机（`www.bing.com` 在本机会 302 过来，直接用 cn 少一跳） */
export const BING_SEARCH_HOST = 'cn.bing.com';
/**
 * 请求头里的浏览器 UA（实测：不带它拿到的是另一种页面；与图片搜索那份 `POSTER_UA` **刻意分开** ——
 * 两件事的 UA 口径各自演进，⛔ 别为了「少一个常量」把它们并成一份）。
 */
export const BING_SEARCH_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
/** 只把前 N 条喂给模型（控 token；10 条全给会挤掉字段清单） */
export const BING_RSS_LIMIT = 8;
/** 拼给模型的搜索文本总上限（防整页塞进上下文） */
export const WEB_SEARCH_TEXT_MAX = 2000;

/**
 * 中日韩字符（用来判定「这条查询是不是中文」）。
 * 🔴🔴 **名字必须避开通用短名 `CJK_RE`**：`pure/readingUnits.ts` 已有一个 `CJK_RE`，
 *    重名会让 esbuild 为消歧把**那个**也改名成 `CJK_RE2` ⇒ 撞红毫不相干的
 *    「先剥 CJK 再分词」产物断言（本条实测踩到过，`make-instr` 抓到的失败是
 *    `/\.replace\(CJK_RE, " "\)/` 变 false、断言总数 222 → 223）。
 *    与 `bingSearch.rssTag` 的 `tag`、#491 的 `section` 同族。
 */
const BING_CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 🔴🔴 把查询**单段化** —— 必应 RSS 对「含空格的中文多段查询」会**逐字拆词**，必须先把修饰词砍掉。
 *
 * 实测取证（2026-11-19，`probe-bing7.cjs` / `probe-bing8.cjs`，真请求八轮）：
 *   · `七里香 周杰伦 简介` ⇒ 第 1 条 `七（汉语汉字）_百度百科`、第 2 条 `7（自然数之一）`（**只取了首字**）；
 *   · `名侦探柯南 豆瓣` ⇒ `名_百度百科`；`三体 刘慈欣 简介` ⇒ `三（汉语汉字）_百度百科`；
 *   · `艾尔登法环 开发商` ⇒ `艾尔之光-ELSWORD-官方网站`（半相关）。
 *   · **单段就全好**：`七里香` ⇒ `七里香（2004年周杰伦演唱的流行摇滚歌曲）_百度百科`（正中目标）；
 *     `名侦探柯南` / `三体` / `艾尔登法环` 同样第一条第 1 条就命中。
 *   · 逐项否掉的其它思路（⛔ 别回头再试）：`mkt=zh-CN`、`setlang=zh-Hans&cc=CN`、
 *     `ensearch=0`、`count=10` **全部无效**（结果逐字相同）；给首词或整串**加引号**——
 *     `"七里香"` 单段可用，但 `"七里香" 周杰伦 简介`（多段）**照样退化**；
 *     **去空格拼接**也不行（`三体刘慈欣` ⇒ `三（汉语汉字）`、`名侦探柯南豆瓣` ⇒ `名_百度百科`）。
 *   · 英文短语不受影响（`The Lord of the Rings` 加不加引号都正常）⇒ 只对**含 CJK 的多段查询**单段化。
 *
 * ⚠️ 代价：修饰词（「简介」「豆瓣」「开发商」）会被丢掉，但中文百科/豆瓣条目页**本来就排在第一位**，
 *    丢掉修饰词换「不返回单字词典页」是划算的。⛔ 别为了「保留更多词」改回去。
 */
export function compactBingQuery(raw: string): string {
    const q = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!q) return '';
    if (!q.includes(' ')) return q;
    if (!BING_CJK_RE.test(q)) return q;
    // 只取首段（通常是作品名本身）；空段已由上面的 `\s+` 折叠排除
    return q.split(' ')[0] ?? q;
}

/**
 * 搜索地址；**空查询 ⇒ 空串**（调用方据此直接回一句「没给查询词」，⛔ 不白跑一次请求 ——
 * 与 `pure/posterSearch.buildBingImageUrl` 同口径）。
 * 🔴 查询先过 `compactBingQuery` 单段化（否则中文多段会被必应拆成单字，见那个函数的注释）。
 */
export function buildBingRssUrl(query: string): string {
    const q = encodeURIComponent(compactBingQuery(query));
    if (!q) return '';
    return `https://${BING_SEARCH_HOST}/search?q=${q}&format=rss`;
}

/** 剥 CDATA + 还原实体（实体表走全仓唯一真源 `pure/htmlText`，⛔ 别在这里再抄一份） */
export function decodeXmlText(raw: string): string {
    const s = String(raw ?? '');
    const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
    return decodeHtmlText(m ? m[1] : s);
}

export interface BingSearchItem {
    title: string;
    link: string;
    snippet: string;
}

/**
 * 取某个 RSS 标签的文本（`<tag>…</tag>`；取不到 ⇒ 空串）。
 * 🔴🔴 **名字必须避开通用短名**（本批实测：叫 `tag` 时 esbuild 为消歧会把 ID3 解析里那个局部变量
 *    也改名成 `tag2` ⇒ 撞红了毫不相干的 `readId3v2Lyrics` 断言。与 #491 的 `section` 同族）。
 */
function rssTag(block: string, name: string): string {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    return m ? decodeXmlText(m[1]) : '';
}

/**
 * 解析 RSS：逐条取 `title` / `link` / `description`；**标题与链接都空的条目直接丢掉**
 * （必应偶尔给一条空壳 —— 留着只会让模型把「（无标题）」当成一条结果）。
 */
export function parseBingRss(xml: string): BingSearchItem[] {
    const text = String(xml ?? '');
    if (!text) return [];
    const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    const out: BingSearchItem[] = [];
    for (const b of blocks) {
        const title = rssTag(b, 'title');
        const link = rssTag(b, 'link');
        if (!title && !link) continue;
        out.push({ title, link, snippet: rssTag(b, 'description') });
    }
    return out.slice(0, BING_RSS_LIMIT);
}

/**
 * 结果 → 喂给模型的文本块（`① 标题 — 摘要（链接）`，一行一条）。
 * ⚠️ 链接也带上：模型偶尔会在摘要里看到相互矛盾的数字，链接是它判断「哪条更权威」的唯一线索。
 */
export function bingResultsToText(items: readonly BingSearchItem[]): string {
    const lines: string[] = [];
    let used = 0;
    for (const [i, it] of items.entries()) {
        const head = `${i + 1}. ${it.title || '(无标题)'}`;
        const body = it.snippet ? ` — ${it.snippet}` : '';
        const src = it.link ? `（${it.link}）` : '';
        const line = head + body + src;
        if (used + line.length > WEB_SEARCH_TEXT_MAX) break;
        lines.push(line);
        used += line.length;
    }
    return lines.join('\n');
}
