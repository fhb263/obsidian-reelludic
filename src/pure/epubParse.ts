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

/** 剥 inline 标签 + 去注释 + 折叠空白（`extractChapterLabel` / `extractH1Label` 共用） */
function stripInline(raw: string): string {
    return raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, '') // 行内标签直接拼接，不插空格（与 xhtmlToText 一致，h1 拆解「第一章」正确）
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 章节 fallback 标题提取（nav.xhtml/ncx 都缺时使用）：按 <h1> > <title> 优先级，
 *  去 XML/HTML 注释 + 剥 inline 标签 + 折叠空白。**排除**等于书名的 title（常见扉页
 *  chapter1.html 的 `<title>` 写的就是书名「活着」之类，无信息会污染目录，让调用方回退文件名）。
 *  返回 undefined 表示未能从中提取出可识别标题，调用方应使用文件名兜底。
 */
export function extractChapterLabel(html: string, bookTitle: string): string | undefined {
    if (!html) return undefined;
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1) {
        const t = stripInline(h1[1]);
        if (t) return t;
    }
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (title) {
        const t = stripInline(title[1]);
        if (t && t !== bookTitle) return t;
    }
    return undefined;
}

/**
 * **只**取 `<h1>` 文本（重建目录用）。为什么重建时不用 `<title>`：
 *  Calibre 转换的 EPUB 里章节文件的 `<title>` 常写成**书名**（且可能带「（某某译本）」等后缀，
 *  躲得过 `extractChapterLabel` 的「等于书名」守卫）或文件名 —— 拿它当章名会让整本目录变成同一个词。
 *  实测 `百年孤独.epub`：20 个章节文件 `<title>` 全是「百年孤独（范晔 译本）」，而 `<h1>` 一个都没有
 *  → 重建必须落到「第 N 章」这一档，否则目录会显示 20 个一模一样的书名。
 */
export function extractH1Label(html: string): string | undefined {
    if (!html) return undefined;
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const t = h1 ? stripInline(h1[1]) : '';
    return t || undefined;
}

// ── 目录可信度与重建（用户 2026-09-19 报障「目录连章显示」） ─────────────────────────
//
// 现象：某类 EPUB（典型是 Calibre **先写 NCX、后重新切分文件** 的产物）目录里好几章同时高亮，
// 顶栏章名还与正文对不上。实测 `百年孤独.epub`：spine 里 20 个正文文件各装一章（`part0003`=第1章…），
// 而 toc.ncx 的 20 个条目**全落在前 4 个文件上**（`part0004.html` 一个文件被第 6~10 章共用），
// 锚点还大段重复（`#calibre_pb_5` 用了 3 次）—— 目录在数据上**根本区分不开**这些章。
// 阅读器按「href 去 fragment = 当前文件」比对 → 一次命中 5 项 → 连章。
//
// 处理：目录「区分不开自己的条目」时**按 spine 内容文件 1:1 重建目录** ——
// 每个内容文件恰好一个条目，于是「一项一高亮」天然成立，且目录点击、顶栏章名、「当前章」判定全都对上。

/** 重建目录时的「内容文件」最小正文长度（跳过封面 / 版权页 / 目录页这类短文件）。
 *  ⚠️ 启发式阈值：本机实证 `百年孤独.epub` 前置页最长 452 字、正文最短 10204 字。
 *  **被原目录显式收录过的文件不受本阈值约束**（短章节也是真章节）。 */
export const TOC_REBUILD_MIN_CHARS = 1000;

/** 拆目录目标：路径 + 锚点（无锚点为 ''） */
function splitTocTarget(href: string): { path: string; frag: string } {
    const i = href.indexOf('#');
    return i < 0 ? { path: href, frag: '' } : { path: href.slice(0, i), frag: href.slice(i + 1) };
}

/**
 * 目录是否「区分不开自己的条目」—— 存在**重复的（文件 + 锚点）目标**。
 * 为真说明多个目录项指向**完全相同的位置**（Calibre 重切遗留），href 已不可用于定位章节。
 *
 * 🔴 判据只认「**重复**」，绝不认「多对一」：一个文件里装多章、**各章锚点互不相同**是完全合法的
 *    EPUB 结构（阅读器本就该按锚点翻章）—— 误判会把好目录退化成文件粒度，是实打实的回归。
 */
export function isTocAmbiguous(toc: { label: string; href: string }[]): boolean {
    const seen = new Set<string>();
    for (const e of toc) {
        const { path, frag } = splitTocTarget(e.href);
        const key = `${path}\u0000${frag}`;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

/**
 * 按 spine 内容文件 1:1 重建目录（**仅在 `isTocAmbiguous` 为真时调用**；返回空数组表示无从重建，调用方保持原目录）。
 *
 * label 优先级：① 原目录里**唯一**指向该文件的条目的 label（保住真实章名）
 *              → ② 正文的 `<h1>`（**不看 `<title>`** —— 见 `extractH1Label` 的说明，Calibre 书里它常是书名）
 *              → ③ `第 N 章`（**N 为内容文件序号**，与阅读顺序一致；跳过的前置页不占编号）。
 * 内容文件 = 正文长度 ≥ `TOC_REBUILD_MIN_CHARS` **或** 被原目录收录过的 spine 项。
 */
export function rebuildTocFromSpine(
    chapters: string[],
    fileMap: EpubFileMap,
    oldToc: { label: string; href: string }[],
): { label: string; href: string }[] {
    const hits = new Map<string, number>();
    const firstLabel = new Map<string, string>();
    for (const e of oldToc) {
        const { path } = splitTocTarget(e.href);
        hits.set(path, (hits.get(path) ?? 0) + 1);
        if (!firstLabel.has(path)) firstLabel.set(path, e.label);
    }
    const kept = chapters.filter((href) => hits.has(href) || chapterTextLength(fileMap[href] ?? '') >= TOC_REBUILD_MIN_CHARS);
    return kept.map((href, i) => {
        const keptLabel = hits.get(href) === 1 ? firstLabel.get(href) : undefined;
        const label = keptLabel ?? extractH1Label(fileMap[href] ?? '') ?? `第 ${i + 1} 章`;
        return { label, href };
    });
}

/** 在原始 html 里找锚点（id="frag" / id='frag'）所在标签**闭合之后**的位置；找不到 → -1
 *  （🔴 切片必须从标签之后开始 —— 从属性处切片会把半个标签当文字计入） */
function anchorOffset(html: string, frag: string): number {
    for (const pat of ['id="' + frag + '"', "id='" + frag + "'"]) {
        const k = html.indexOf(pat);
        if (k >= 0) {
            const close = html.indexOf('>', k);
            return close >= 0 ? close + 1 : k;
        }
    }
    return -1;
}

/**
 * 每条目录的字数：
 *  · href **无锚点** → 所指文件的正文字数（默认复用 `chapterTextLength` 口径）；
 *  · href **有锚点** → 同文件内按锚点在原始 html 中的先后位置分段计数（到下一个锚点 / 文件尾）；
 *  · 文件缺失 / 锚点找不到 → undefined（**不显示、不猜** —— 宁缺勿错）。
 *  ⚠️ 无锚点条目与锚点条目混在同文件时，无锚点按位置 0 处理（取文件头一段）。
 *  `count` 可替换计数口径（#345 目录显示改传「阅读量单位」计数器）；
 *  🔴 默认值仍是 `chapterTextLength` —— 那是**进度加权**口径，⛔ 不要改它的实现。
 */
export function epubTocCharCounts(
    book: { toc: { label: string; href: string }[] },
    fileMap: Record<string, string>,
    count: (html: string) => number = chapterTextLength,
): (number | undefined)[] {
    const byFile = new Map<string, { idx: number; frag?: string }[]>();
    book.toc.forEach((t, idx) => {
        const hashAt = t.href.indexOf('#');
        const file = hashAt < 0 ? t.href : t.href.slice(0, hashAt);
        const frag = hashAt < 0 ? undefined : t.href.slice(hashAt + 1);
        const list = byFile.get(file) ?? [];
        list.push({ idx, frag });
        byFile.set(file, list);
    });
    const out: (number | undefined)[] = new Array(book.toc.length).fill(undefined);
    for (const [file, list] of byFile) {
        const html = fileMap[file];
        if (html === undefined) continue;
        const located = list
            .map((e) => ({ ...e, at: e.frag === undefined ? 0 : anchorOffset(html, e.frag) }))
            .filter((e) => e.at >= 0)
            .sort((a, b) => a.at - b.at);
        for (let i = 0; i < located.length; i++) {
            const start = located[i].at;
            const end = i + 1 < located.length ? located[i + 1].at : html.length;
            out[located[i].idx] = count(html.slice(start, end));
        }
    }
    return out;
}
