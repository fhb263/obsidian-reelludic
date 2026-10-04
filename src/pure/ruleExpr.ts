/**
 * **取值规则串的编译**（纯逻辑，#419）—— 无 `obsidian` / 无 DOM / 无网络，可单测。
 *
 * 书源里那些 `"td.even > a"` / `"#info > p:nth-child(5) > a@href"` 字符串在这里被拆成
 * **选择器 + 取值方式**，再交给 `services/htmlQuery`（`DOMParser` + `querySelectorAll`）执行。
 *
 * ## 语法（SoNovel 口径，实检自 `rules/main.json` 的 167 条规则）
 * - `选择器`                 ⇒ 取该元素的**文本**
 * - `选择器@href` / `@src` / `@title` … ⇒ 取该**属性**（属性名原样大小写不敏感匹配）
 * - `选择器@text` / `@textNodes` / `@ownText` ⇒ 取文本（与裸选择器等价，保留是为兼容写法）
 * - `选择器@html` / `@outerHtml` ⇒ 取 HTML 串
 * ⚠️ SoNovel 里 `@` **只**出现在后缀位置（CSS 属性选择器写的是 `[attr="v"]`，不含 `@`）
 *    ⇒ 用**最后一个** `@` 切分是安全的。
 *
 * ## 🔴 明确不支持的两类（编译成 `unsupported`，执行器给**明确原因**，⛔ 不静默返回空）
 * - `@js:` 脚本（红线：不执行第三方脚本）
 * - `/…` 开头的 XPath（本插件只实现 CSS）
 */

/** 取值方式 */
export type RuleTake = 'text' | 'html' | 'attr';

/** 编译结果 */
export interface CompiledRule {
    /** 原文（错误文案与日志回查用，原样保留） */
    raw: string;
    /** CSS 选择器（`unsupported` 非空时仍尽量给出，便于诊断） */
    selector: string;
    take: RuleTake;
    /** `take === 'attr'` 时的属性名 */
    attr?: string;
    /** 不支持的原因；非空 ⇒ 执行器必须报错，不许当空结果 */
    unsupported?: 'js' | 'xpath' | 'empty';
}

/** 这批后缀是「取文本」（与裸选择器同义，保留为兼容写法） */
const TEXT_TOKENS = new Set(['text', 'textnodes', 'owntext', 'alltext']);
/** 这批后缀是「取 HTML 串」 */
const HTML_TOKENS = new Set(['html', 'outerhtml', 'innerhtml']);

/**
 * 编译一条取值规则串。
 *
 * 🔴 **三元返回值**（`unsupported` / `take` / `attr`）在单测里逐类钉住 ——
 *    这是整条链**最容易静默失败**的一处：解错一个后缀，用户拿到的是「书名叫 `href`」这种脏数据。
 */
export function compileRule(raw: string): CompiledRule {
    const c = compileRuleBase(raw);
    // 🔴 **G2（#420 按参考实现 `go-novel/internal/core/extractor.go` 补）**：
    //    `meta[property="og:image"]` 这类选择器取**文本**永远是空的（meta 没有文本节点）
    //    ⇒ 改成取 `content` 属性。真实书源的封面写法正是 `meta[property="og:image"]@js:r='前缀'+r`，
    //    补上这一条后，**那处 `@js:` 就不再需要脚本了**（脚本只做前缀拼接）。
    if (!c.unsupported && c.take === 'text' && /^meta\s*\[/i.test(c.selector)) {
        return { ...c, take: 'attr', attr: 'content' };
    }
    return c;
}

/** 编译主体（不含 `meta[...]` 特判 —— 那一层放在 `compileRule` 末尾，便于单测分别钉） */
function compileRuleBase(raw: string): CompiledRule {
    const s = String(raw ?? '').trim();
    if (!s) return { raw: s, selector: '', take: 'text', unsupported: 'empty' };
    if (/@js\s*:/i.test(s)) {
        // 脚本规则：把 `@js:` 之前那段当选择器留着（诊断显示用），但一律不执行
        return { raw: s, selector: s.split(/@js\s*:/i)[0].trim(), take: 'text', unsupported: 'js' };
    }
    if (/^\s*[/(]/.test(s)) return { raw: s, selector: s, take: 'text', unsupported: 'xpath' };

    const at = s.lastIndexOf('@');
    if (at < 0) return { raw: s, selector: s, take: 'text' };
    const selector = s.slice(0, at).trim();
    const token = s
        .slice(at + 1)
        .trim()
        .toLowerCase();
    if (!selector) return { raw: s, selector: '', take: 'text', unsupported: 'empty' };
    if (!token) return { raw: s, selector, take: 'text' };
    if (TEXT_TOKENS.has(token)) return { raw: s, selector, take: 'text' };
    if (HTML_TOKENS.has(token)) return { raw: s, selector, take: 'html' };
    return { raw: s, selector, take: 'attr', attr: token };
}

/** 编译结果能不能用（`unsupported` 非空 ⇒ 不能用） */
export function ruleSupported(c: CompiledRule): boolean {
    return !c.unsupported;
}

/** 不支持的规则 → 给用户看的原因（`⛔ 不静默返回空`） */
export function ruleUnsupportedText(c: CompiledRule, what: string): string {
    if (c.unsupported === 'js') return `${what}用的是脚本规则（@js:），本插件不执行脚本 ⇒ 该字段用不了`;
    if (c.unsupported === 'xpath') return `${what}用的是 XPath，本插件只支持 CSS 选择器 ⇒ 该字段用不了`;
    return `${what}的规则是空的`;
}

// ────────────────────────── 请求参数模板 ──────────────────────────

/**
 * SoNovel 的 `data` / `cookies` 是**类 JSON 的松散写法**（键可无引号：`{searchkey: %s}`），
 * 不是严格 JSON ⇒ 这里用一个宽容解析器，把它读成键值对。
 * ⚠️ 解析不出就回**空表**（调用方据此发无参请求），⛔ 不抛 —— 这些串来自用户文件，不该让整次搜索崩掉。
 */
export function parseLooseParams(text: string): Record<string, string> {
    const s = String(text ?? '').trim();
    const out: Record<string, string> = {};
    const body = s.replace(/^\{/, '').replace(/\}$/, '');
    if (!body.trim()) return out;
    for (const pair of body.split(/,(?![^{]*\})/)) {
        const i = pair.indexOf(':');
        if (i < 0) continue;
        const k = pair.slice(0, i).trim().replace(/^['"]|['"]$/g, '');
        const v = pair
            .slice(i + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '');
        if (k) out[k] = v;
    }
    return out;
}

/**
 * 把搜索关键词灌进 `search.data` 模板：占位符是 **`%s`**（SoNovel 口径）。
 * ⚠️ 值里的 `%s` **一处**替换（模板里多写几处会都替换 —— 与 SoNovel 一致）。
 */
export function fillSearchParams(data: string, keyword: string): Record<string, string> {
    const kw = String(keyword ?? '').trim();
    const params = parseLooseParams(data);
    for (const k of Object.keys(params)) params[k] = params[k].replace(/%s/g, kw);
    return params;
}

/**
 * 搜索 URL 里的占位符替换：SoNovel 模板用的是完整 URL（关键词走 `data`），
 * 但也有的源把关键词写在 URL 上（`…/search.php?key=%s`）⇒ 这里兼容两种。
 */
export function fillSearchUrl(url: string, keyword: string): string {
    return String(url ?? '').replace(/%s/g, encodeURIComponent(String(keyword ?? '').trim()));
}
