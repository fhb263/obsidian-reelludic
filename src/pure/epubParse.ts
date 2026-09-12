// EPUB 结构解析（纯逻辑，可单测）：container.xml → content.opf → spine/toc/manifest
// 输入为解包后的文件映射（path → 内容字符串），由调用方（main.ts）用 jszip 解包
// 不依赖 jszip：纯字符串/正则解析，node 与浏览器环境均可运行

export type EpubFileMap = Record<string, string>;

export interface EpubBook {
    /** 书名（metadata dc:title，缺失回退 '未命名'） */
    title: string;
    /** spine 章节 href 列表（相对 content.opf 目录解析后的绝对路径，按阅读顺序） */
    chapters: string[];
    /** 目录 TOC：{ label, href }[]（href 为绝对路径；可能含 #fragment） */
    toc: { label: string; href: string }[];
    /** manifest：href → media-type（渲染 iframe 用） */
    manifest: Record<string, string>;
}

/** 正则提取标签内文本（第一个匹配，去 XML 注释） */
export function xmlText(xml: string, tag: string): string | undefined {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : undefined;
}

/** 提取 XML 属性值（name="value" 或 name='value'） */
export function xmlAttr(tagXml: string, name: string): string | undefined {
    const m = tagXml.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return m ? m[1] : undefined;
}

/** 解析 container.xml：返回 rootfile full-path（如 OEBPS/content.opf） */
export function containerRootfile(containerXml: string): string | undefined {
    const m = containerXml.match(/<rootfile[^>]*full-path\s*=\s*["']([^"']+)["']/i);
    return m ? m[1] : undefined;
}

/** 路径规范化（EPUB 内相对路径 → 绝对）：处理 ./ ../ 前缀 */
export function resolveEpubPath(baseDir: string, rel: string): string {
    const parts = baseDir.split('/').filter(Boolean);
    for (const seg of rel.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') parts.pop();
        else parts.push(seg);
    }
    return parts.join('/');
}

/** href 反编码：EPUB 内 IRI 引用常含 %20 等转义，而 zip 文件名为字面量，需还原后匹配 */
function decodeHref(href: string): string {
    try {
        return decodeURIComponent(href);
    } catch {
        return href; // 非法转义序列：原样保留
    }
}

/** 章节文件 media-type 判定：仅 xhtml/html 视为可渲染章节（图片/CSS 等在 manifest 但不入 spine 阅读序） */
const CHAPTER_MEDIA_RE = /(xhtml|html)/i;

/** 解析 content.opf：manifest（id→href→media-type）+ spine（itemref idref 阅读序）+ dc:title */
export function parseOpf(
    opfXml: string,
    opfDir: string,
    fileMap: EpubFileMap,
): { title: string; chapters: string[]; manifest: Record<string, string> } {
    const manifest: Record<string, string> = {};
    const idToHref: Record<string, string> = {};
    // 1) manifest：<item id href media-type> → href 绝对化（opfDir + href，规范化 ./ 与 ../）
    const itemRe = /<item\b[^>]*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRe.exec(opfXml)) !== null) {
        const tag = m[0];
        const id = xmlAttr(tag, 'id');
        const href = xmlAttr(tag, 'href');
        const media = xmlAttr(tag, 'media-type');
        if (id === undefined || href === undefined || media === undefined) continue;
        const abs = resolveEpubPath(opfDir, decodeHref(href));
        idToHref[id] = abs;
        manifest[abs] = media;
    }
    // 2) spine：<itemref idref> → manifest id→href 映射 → 绝对路径列表
    //    过滤非章节媒体类型（图片等不入阅读序）与 fileMap 中缺失的文件
    const chapters: string[] = [];
    const itemrefRe = /<itemref\b[^>]*\/?>/gi;
    while ((m = itemrefRe.exec(opfXml)) !== null) {
        const idref = xmlAttr(m[0], 'idref');
        if (idref === undefined) continue;
        const href = idToHref[idref];
        const media = href !== undefined ? manifest[href] : undefined;
        if (href === undefined || media === undefined || !CHAPTER_MEDIA_RE.test(media)) continue;
        if (fileMap[href] === undefined) continue; // 文件缺失（内容可为空串，用 undefined 判定）
        chapters.push(href);
    }
    // 3) title：<dc:title>（缺失回退 '未命名'）
    const title = xmlText(opfXml, 'dc:title') ?? '未命名';
    return { title, chapters, manifest };
}

/** 解析 nav 目录（EPUB3 nav.xhtml 或 EPUB2 NCX）：提取层级链接 → 扁平列表（一级为主）
 *  nav.xhtml：<a href="…">label</a>；NCX：<navPoint><navLabel><text>…</text></navLabel><content src="…"/></navPoint>
 *  href 相对 nav 文件所在目录（navDir）解析为绝对路径；#fragment 保留；校验目标文件存在于 fileMap
 *  作用域限定：EPUB3 nav 常含 toc / landmarks / page-list 多个 <nav epub:type> 块，
 *  只取 epub:type="toc" 块内的 <a>，防 landmarks（封面/目录/正文开始）与 page-list 污染目录；
 *  无 epub:type="toc" 的 nav（老式/手写裸 nav）与 NCX 走整文档兜底 */
export function parseTocNav(navXml: string, navDir: string, fileMap: EpubFileMap): { label: string; href: string }[] {
    const out: { label: string; href: string }[] = [];
    const push = (rawHref: string, rawLabel: string): void => {
        const label = rawLabel.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!label) return;
        const frag = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#')) : '';
        const pathPart = decodeHref(rawHref.split('#')[0]);
        if (!pathPart) return; // 纯页内锚点（#…）：无独立文件，跳过
        const abs = resolveEpubPath(navDir, pathPart);
        if (fileMap[abs] === undefined) return; // 目标文件缺失
        out.push({ label, href: abs + frag });
    };
    // EPUB3 目录作用域：<nav epub:type="toc"> 块内容；无则整文档（裸 nav / NCX 兜底）
    const tocNavRe = /<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i;
    const scope = tocNavRe.exec(navXml)?.[1] ?? navXml;
    // EPUB3 nav.xhtml：匹配 <a href="...">text</a>
    const aRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = aRe.exec(scope)) !== null) push(m[1], m[2]);
    if (out.length > 0) return out;
    // EPUB2 NCX：navPoint 块内配对 navLabel.text 与 content src
    const ncxRe = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
    let nm: RegExpExecArray | null;
    while ((nm = ncxRe.exec(navXml)) !== null) {
        const block = nm[1];
        const src = /<content\b[^>]*src\s*=\s*["']([^"']+)["']/i.exec(block);
        const text = /<text\b[^>]*>([\s\S]*?)<\/text>/i.exec(block);
        if (src && text) push(src[1], text[1]);
    }
    return out;
}

/** 从章节 XHTML 中取纯文本（摘录/目录预览用，去标签去 script/style） */
export function xhtmlToText(html: string): string {
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    // 标签直接移除（不插空格）：行内标签合并成「你好世界」；块级标签间的换行缩进由 \s+ 折叠保留为单空格
    return withoutScripts
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/** 章节纯文本字数（全书进度加权口径）：HTML 壳/标签不占权重，与用户实际阅读量成正比 */
export function chapterTextLength(html: string): number {
    if (!html) return 0;
    return xhtmlToText(html).length;
}

/**
 * 章节 fallback 标题提取（nav.xhtml/ncx 都缺时使用）：按 <h1> > <title> 优先级，
 *  去 XML/HTML 注释 + 剥 inline 标签 + 折叠空白。**排除**等于书名的 title（常见扉页
 *  chapter1.html 的 `<title>` 写的就是书名「活着」之类，无信息会污染目录，让调用方回退文件名）。
 *  返回 undefined 表示未能从中提取出可识别标题，调用方应使用文件名兜底。
 */
export function extractChapterLabel(html: string, bookTitle: string): string | undefined {
    if (!html) return undefined;
    const strip = (raw: string): string =>
        raw
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, '') // 行内标签直接拼接，不插空格（与 xhtmlToText 一致，h1 拆解「第一章」正确）
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1) {
        const t = strip(h1[1]);
        if (t) return t;
    }
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (title) {
        const t = strip(title[1]);
        if (t && t !== bookTitle) return t;
    }
    return undefined;
}
