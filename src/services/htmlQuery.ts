/**
 * 书源规则的**执行器**（#419）—— 本仓**唯一**碰 HTML 解析的地方（`pure/` 侧一律不 import 本模块）。
 *
 * ## 🔴 为什么用运行时 `DOMParser` 而不是自研解析器
 * 实检用户给的真实书源（167 条选择器）：`.class` 93 / `>` 86 / `:nth-child`·`:nth-of-type` 42 /
 * `#id` 38 / `[attr=…]` 4 / `~` 2 / `:not(…)` 1 —— **全是 `querySelectorAll` 的原生能力**，
 * 而参考软件（SoNovel）用的是 Jsoup ⇒ `DOMParser` 与它**同语义**，连「表格自动补 `<tbody>`」
 * 都一致（`#checkform > table > tbody > tr` 两边都命中）。自研解析器最容易就崩在这类隐式补全上。
 * ⚠️ 代价：本模块只能在**有 DOM 的环境**里跑（Obsidian 渲染进程 / 单测的 jsdom 环境）。
 *
 * ## 职责边界
 * 本模块**不认识书源结构**（那是 `pure/sourceRule` 的活），只做三件小事：
 *  ⑴ 取节点（选择器 → 元素数组）；⑵ 取值（文本 / 属性 / HTML）；⑶ 正文取文本（按书源的分段口径）。
 * 🔴 **不静默**：选择器写坏时回 `invalid`（调用方据此给明确原因），⛔ 不假装「0 命中」。
 */
import type { CompiledRule } from 'pure/ruleExpr';

/** 取节点结果：`invalid` 非空 ⇒ 选择器本身是坏的（与「合法但 0 命中」是两回事） */
export interface QueryOutcome {
    els: Element[];
    invalid?: string;
}

/** 解析 HTML 成文档。环境没有 `DOMParser` ⇒ 抛（调用方在桌面端门控里已经挡过） */
export function parseHtml(html: string): Document {
    const DP = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
    if (!DP) throw new Error('当前环境没有 HTML 解析器（DOMParser）');
    return new DP().parseFromString(String(html ?? ''), 'text/html');
}

/**
 * 选择器取节点。
 * 🔴 选择器写坏（如 `div >> p`）时 `querySelectorAll` 会 **throw** ⇒ 这里捕获并回报原因，
 *    ⛔ 绝不回一个空数组冒充「这个源没有内容」（那种静默会让用户去翻源站结构，白折腾）。
 */
export function queryAll(root: ParentNode, selector: string): QueryOutcome {
    const sel = String(selector ?? '').trim();
    if (!sel) return { els: [], invalid: '选择器是空的' };
    try {
        return { els: Array.from(root.querySelectorAll(sel)) };
    } catch (e) {
        return { els: [], invalid: `选择器无效（${e instanceof Error ? e.message : String(e)}）` };
    }
}

/** 相对链接 → 绝对（`baseUrl` 是取到这个链接的**页面**地址） */
export function resolveUrl(baseUrl: string, href: string): string {
    const h = String(href ?? '').trim();
    if (!h || /^(https?:|mailto:|about:)/i.test(h)) return h;
    try {
        return new URL(h, baseUrl).toString();
    } catch {
        return h;
    }
}

/** 元素的显示文本：归一空白（⛔ 不折叠正文 —— 正文走 `extractChapterText`） */
export function elementText(el: Element): string {
    return String(el.textContent ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 能被「取属性」取到的、且需要**解析成绝对地址**的属性名 */
const URL_ATTRS = new Set(['href', 'src', 'data-src', 'data-original', 'poster', 'action']);

/**
 * 从元素上取取值。
 * - `text` ⇒ `elementText`
 * - `html` ⇒ `innerHTML`
 * - `attr` ⇒ 属性值（`href` / `src` 这类会**解析成绝对地址**，否则后续请求会拿一个相对路径去发）
 */
export function elementValue(el: Element, rule: CompiledRule, baseUrl: string): string {
    if (rule.take === 'html') return String(el.innerHTML ?? '');
    if (rule.take === 'attr') {
        const name = String(rule.attr ?? '');
        let raw = el.getAttribute(name) ?? '';
        // 🔴 **G2 回落**：`meta` 上要 `href` 之类而它没有 ⇒ 用 `content` 顶上
        //    （参考实现同款；真实书源把封面 URL 塞在 `content` 里，却按 `@href` 或文本去取）
        if (!raw && String(el.tagName ?? '').toLowerCase() === 'meta') raw = el.getAttribute('content') ?? '';
        return URL_ATTRS.has(name.toLowerCase()) ? resolveUrl(baseUrl, raw) : String(raw).trim();
    }
    return elementText(el);
}

/** 取值结果（`invalid` = 选择器坏；`missing` = 合法但该字段在这个页面上没命中） */
export interface RuleOutcome {
    values: string[];
    invalid?: string;
    missing?: string;
}

/**
 * 🔴 **G2**：`meta[…]` 是**文档级**选择器（`<meta property="og:image">` 在 `<head>` 里，
 * 不可能落在某一行搜索结果内部）⇒ 遇到 meta 规则时把查询范围提到**整个文档**。
 * 参考实现（`go-novel`）也是这么做的 —— 不这样处理，封面类字段在逐行取值时必然恒为空。
 */
function scopeFor(root: ParentNode, selector: string): ParentNode {
    if (!/^meta\s*\[/i.test(String(selector ?? '').trim())) return root;
    return (root as Element).ownerDocument ?? root;
}

/** 跑一条取值规则，拿**全部**命中值 */
export function applyRule(root: ParentNode, rule: CompiledRule, baseUrl: string): RuleOutcome {
    const q = queryAll(scopeFor(root, rule.selector), rule.selector);
    if (q.invalid) return { values: [], invalid: q.invalid };
    const values = q.els.map((el) => elementValue(el, rule, baseUrl)).filter((v) => v.length > 0);
    return values.length ? { values } : { values: [], missing: `「${rule.raw}」在这个页面上没命中` };
}

/** 跑一条取值规则，只拿第一个命中值（缺 ⇒ 空串） */
export function applyRuleOne(root: ParentNode, rule: CompiledRule, baseUrl: string): string {
    return applyRule(root, rule, baseUrl).values[0] ?? '';
}

/** 正文取文本的可调项（来自书源 `chapter` 段） */
export interface ChapterTextOpts {
    /** 正文用成对标签分段（`<p>…</p>`）⇒ 不看 `paragraphTag` */
    paragraphTagClosed?: boolean;
    /** 不成对分段时的分隔正则（如 `<br>+`） */
    paragraphTag?: string;
    /** 要整块删掉的选择器列表（广告块 / 导航） */
    filterTag?: string;
    /** 取到正文链接的那个页面地址（解析相对链接用；正文里一般没有链接，留作保险） */
    baseUrl: string;
}

/**
 * 从**正文元素**里取纯文本（段落以 `\n` 分隔）。
 *
 * 🔴 顺序：**先删 `filterTag` 块** ⇒ **再把分段标签换成换行** ⇒ **最后取文本**（由 DOM 解实体）。
 *    反过来（先取文本再删块）会把广告文字一起带进正文，之后没有任何办法清干净。
 * ⚠️ 改的是**克隆体**：`querySelectorAll` 拿到的是活节点，直接 `remove()` 会污染调用方的文档。
 */
export function extractChapterText(contentEl: Element, opts: ChapterTextOpts): string {
    const clone = contentEl.cloneNode(true) as Element;
    if (opts.filterTag) {
        for (const sel of String(opts.filterTag).split(',')) {
            const s = sel.trim();
            if (!s) continue;
            const q = queryAll(clone, s);
            for (const el of q.els) el.remove();
        }
    }
    let html = String((clone as HTMLElement).innerHTML ?? '');
    if (opts.paragraphTagClosed) {
        // 成对标签：块级闭合标签就是段落边界
        html = html.replace(/<\/(p|div|h[1-6]|li|blockquote|td)\s*>/gi, '\n');
    } else if (String(opts.paragraphTag ?? '').trim()) {
        try {
            html = html.replace(new RegExp(String(opts.paragraphTag), 'gi'), '\n');
        } catch {
            html = html.replace(/<br\s*\/?>/gi, '\n'); // 源里正则写坏了 ⇒ 退回按 <br> 分段
        }
    } else {
        html = html.replace(/<br\s*\/?>/gi, '\n');
    }
    // 兜底：剩下的块级边界也当换行（很多源正文里混着 <div> 包裹）
    html = html.replace(/<(br|hr)\s*\/?>/gi, '\n');
    const holder = clone.ownerDocument.createElement('div');
    holder.innerHTML = html;
    return String(holder.textContent ?? '');
}
