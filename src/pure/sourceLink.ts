// 「提示文案里的官网地址 → 可点击超链接」的分词器（纯函数，无 obsidian 依赖，可单测）。
//
// 🔴 本轮用户裁定：「元数据源凭据的各项描述里的『获取官网』从纯文本改成**可点击超链接**
//    （所有要 cookie 或 key 的都加）」。
//
// 为什么做成**分词器**而不是在文案里手写 `<a>`：
//   · 文案真源在 `pure/sourceRegistry.PROVIDERS[].hint`，它是**纯数据**（有单测按三段式钉住
//     「获取：/ 特色：/ 用途：」，且注释里明令「不要写 markdown」）⇒ ⛔ 不能在数据里塞 HTML。
//   · 渲染端必须用 `createEl` 逐个建节点（本项目铁律：⛔ 不用 `innerHTML`，那条会把文案里的
//     `**` / `<` 当标记解析，且是注入面）。
//   ⇒ 分工：本模块只负责「把一行文案切成 [文本, 链接, 文本, …]」，渲染端照单建节点。
//
// 链接判据（窄而确定，⛔ 别放宽成「随便什么带点的串」）：
//   ⑴ 裸域名：至少两段、顶级域在白名单内、可选端口与路径（`steamcommunity.com/dev/apikey`）
//      —— 白名单是为了不把 `1000 次/日`、`v1.5.0`、`api.mangadex.org` 之外的杂串误判；
//   ⑵ 显式 `http(s)://` 一律收（用户可能在文案里写完整 URL）。
// 已知**不收**的形态（有意为之）：纯 IP、`mailto:`、`obsidian://`。

/** 允许被识别为域名的顶级域（只列本仓文案真的会用到的；新增请连带补单测）。 */
const TLDS: readonly string[] = ['com', 'org', 'net', 'io', 'co', 'tv', 'gg', 'fm', 'cn', 'me', 'dev', 'app'];

/** 域名 + 可选端口 + 可选路径（路径只收 ASCII 安全字符，遇到空白 / 中文 / 全角标点即止） */
const DOMAIN_SRC =
    `(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS.join('|')})` +
    `(?::\\d{2,5})?` +
    `(?:/[A-Za-z0-9\\-._~%!$&'()*+,;=:@/?]*)?`;

/** 片段：`url` 非空表示这是一段可点链接（`text` 同时是展示文字，逐字不改） */
export interface HintPart {
    text: string;
    url: string | null;
}

/**
 * 把一句提示文案切成「文本段 + 链接段」。
 *
 * ⚠️ 返回的 `url` **一律补成绝对地址**（`https://` + 域名），渲染端直接用 `href`/`openExternal`。
 * ⚠️ 不改原文一个字：所有片段 `text` 拼接回去 === 入参（单测钉住这条，防止「链接化把文案吃了」）。
 * ⚠️ 每轮**重新构造**正则（带 `g` 的实例共用时 `lastIndex` 会串，⛔ 别提到模块作用域复用）。
 */
export function splitHintLinks(text: string): HintPart[] {
    const src = String(text ?? '');
    if (!src) return [];
    const out: HintPart[] = [];
    let last = 0;
    const re = new RegExp(DOMAIN_SRC, 'gi');
    for (;;) {
        const m = re.exec(src);
        if (!m) break;
        const hit = m[0];
        const start = m.index;
        // 边界检查：前面不能紧贴字母数字/连字符（否则 `zabc.com` 会被从中间切出一段「链接」）
        const prev = start > 0 ? src[start - 1] : '';
        if (prev && /[a-z0-9-]/i.test(prev)) {
            re.lastIndex = start + 1;
            continue;
        }
        if (start > last) out.push({ text: src.slice(last, start), url: null });
        out.push({ text: hit, url: `https://${hit}` });
        last = start + hit.length;
    }
    if (last < src.length) out.push({ text: src.slice(last), url: null });
    return out;
}
