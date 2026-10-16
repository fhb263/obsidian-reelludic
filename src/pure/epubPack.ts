/**
 * **EPUB 3 合成（纯逻辑）**（#420 P1-B）—— 无 `obsidian` / 无 DOM / 无网络 / **不依赖 jszip**，可单测。
 *
 * 本模块只产出**有序的文件清单**（`{ path, content, stored? }`），真正打 zip 的是
 * `services/epubWriter`（jszip 懒加载）—— 这样划分的两个理由：
 *  ⑴ 结构（`container.xml` / `content.opf` / 章节 XHTML）是**可单测的字符串逻辑**，不该和 zip 库绑死；
 *  ⑵ 本仓的 `pure/epubParse`（阅读器解包）本来就是这样分层的，两侧对称。
 *
 * ## 🔴 两条硬约束（不满足 ⇒ 阅读器直接打不开，或打开报「损坏」）
 *  ⑴ **`mimetype` 必须是压缩包的**第一条**、且**不压缩（STORED）** —— EPUB 规范的死规定；
 *  ⑵ **同时给 `nav.xhtml`（EPUB 3）和 `toc.ncx`（EPUB 2 回落）** —— 参考软件 SoNovel 的 readme 里
 *     专门提到「WPS、掌阅打不开它生成的 epub」，多半就栽在只给一套目录上。
 *
 * ⚠️ 本模块**不写 `dc:date` / 不写生成器版本**这类会随时间漂移的字段（除了必须的 `dcterms:modified`，
 *    由调用方传入），否则单测没法钉死输出。
 */

/** EPUB 的 mimetype 内容（**一字不差**，多一个换行都会让严格校验器报错） */
export const EPUB_MIMETYPE = 'application/epub+zip';

/** 压缩包里的一个条目 */
export interface EpubFile {
    path: string;
    content: string;
    /** `true` ⇒ 打 zip 时用 STORE（不压缩）。**只有 `mimetype` 需要** */
    stored?: boolean;
}

/** 合成 EPUB 需要的元信息 */
export interface EpubMeta {
    title: string;
    author?: string;
    /** BCP-47，缺省 `zh` */
    language?: string;
    intro?: string;
    /** 书源显示名，写进 `dc:source`（便于日后回查） */
    sourceName?: string;
}

/** 一章（`no` 从 1 起；`text` 为已净化的正文，段落以空行分隔） */
export interface EpubChapter {
    no: number;
    title: string;
    text: string;
}

/** `dcterms:modified` 要的格式：`YYYY-MM-DDThh:mm:ssZ`（UTC，**不带毫秒**） */
export function isoUtc(date: Date): string {
    return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** XML 文本转义（`& < > " '` 全转 —— 属性与文本都能安全复用同一份）+ 去掉非法控制字符 */
export function xmlEscape(raw: string): string {
    return String(raw ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** 章节文件名（`no` 补零到 5 位 ⇒ 字典序 = 章序，找问题时一眼看得出） */
export function chapterFileName(no: number): string {
    return `chapter-${String(Math.max(1, Math.floor(no))).padStart(5, '0')}.xhtml`;
}

/**
 * 从「书名 + 作者」派生一个**稳定**的 identifier。
 * ⚠️ 它**不保证全局唯一**（只求同书同 id、可复现 ⇒ 单测能钉输出）；
 *    调用方若拿得到真 uuid，用 `opts.uuid` 覆盖即可。
 */
export function derivedUuid(meta: EpubMeta): string {
    const seed = `${String(meta?.title ?? '')}\u0000${String(meta?.author ?? '')}`;
    let h1 = 0x811c9dc5;
    let h2 = 0x1000193;
    for (let i = 0; i < seed.length; i++) {
        const c = seed.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    }
    const a = h1.toString(16).padStart(8, '0');
    const b = h2.toString(16).padStart(8, '0');
    return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-a${a.slice(0, 3)}-${b}${a.slice(0, 4)}`;
}

/** `META-INF/container.xml`（固定内容） */
export function epubContainerXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/** 一行章节 XHTML（段落已按空行拆好） */
export function epubChapterXhtml(title: string, paragraphs: readonly string[], lang = 'zh'): string {
    const body = paragraphs
        .map((p) => `    <p>${xmlEscape(p)}</p>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xmlEscape(lang)}">
  <head>
    <meta charset="utf-8"/>
    <title>${xmlEscape(title)}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>${xmlEscape(title)}</h1>
${body}
  </body>
</html>
`;
}

/** EPUB 3 的目录（`nav.xhtml`） */
export function epubNavXhtml(chapters: readonly EpubChapter[], lang = 'zh'): string {
    const items = chapters
        .map((c) => `        <li><a href="${chapterFileName(c.no)}">${xmlEscape(c.title)}</a></li>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(lang)}">
  <head>
    <meta charset="utf-8"/>
    <title>目录</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

/**
 * EPUB 2 的目录（`toc.ncx`）。
 * 🔴 **别省**：掌阅 / WPS / 部分国产阅读器只认 NCX，只给 EPUB 3 的 `nav.xhtml` 会被当成「没有目录」。
 */
export function epubNcx(chapters: readonly EpubChapter[], meta: EpubMeta, uuid: string): string {
    const points = chapters
        .map(
            (c, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
      <content src="${chapterFileName(c.no)}"/>
    </navPoint>`,
        )
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${xmlEscape(meta.language ?? 'zh')}">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${xmlEscape(uuid)}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${xmlEscape(meta.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/** 样式：只做「段首缩进 + 行距」（阅读器自带主题，⛔ 别在这里写死字号/颜色） */
export function epubStyleCss(): string {
    return `body { line-height: 1.7; }
p { text-indent: 2em; margin: 0 0 0.6em; }
h1 { font-size: 1.2em; margin: 1em 0 0.8em; }
`;
}

/** `OEBPS/content.opf`（manifest / spine / metadata） */
export function epubOpf(chapters: readonly EpubChapter[], meta: EpubMeta, uuid: string, modified: string): string {
    const items = chapters
        .map((c) => `    <item id="c${c.no}" href="${chapterFileName(c.no)}" media-type="application/xhtml+xml"/>`)
        .join('\n');
    const refs = chapters.map((c) => `    <itemref idref="c${c.no}"/>`).join('\n');
    const creator = meta.author ? `    <dc:creator>${xmlEscape(meta.author)}</dc:creator>\n` : '';
    const source = meta.sourceName ? `    <dc:source>${xmlEscape(meta.sourceName)}</dc:source>\n` : '';
    const intro = meta.intro ? `    <dc:description>${xmlEscape(meta.intro)}</dc:description>\n` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${xmlEscape(meta.language ?? 'zh')}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${xmlEscape(uuid)}</dc:identifier>
    <dc:title>${xmlEscape(meta.title)}</dc:title>
    <dc:language>${xmlEscape(meta.language ?? 'zh')}</dc:language>
${creator}${source}${intro}    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${items}
  </manifest>
  <spine toc="ncx">
${refs}
  </spine>
</package>
`;
}

export interface EpubBuildOptions {
    /** `dcterms:modified`；缺省用当前时间（**单测请显式传**，否则输出不可复现） */
    modified?: string;
    /** identifier 的 uuid；缺省由「书名 + 作者」派生（稳定但不保证全局唯一） */
    uuid?: string;
}

/**
 * 产出**有序**文件清单 —— 顺序即 zip 内的顺序，**`mimetype` 恒为第一条且 STORED**。
 * ⚠️ 空正文的章整章不写（与 `pure/novelPack.buildNovelTxt` 同一口径：那章已在 UI 报过失败）。
 */
export function epubFileList(
    meta: EpubMeta,
    chapters: readonly EpubChapter[],
    opts: EpubBuildOptions = {},
): EpubFile[] {
    const kept = chapters.filter((c) => String(c.text ?? '').trim().length > 0);
    const uuid = String(opts.uuid ?? '').trim() || derivedUuid(meta);
    const modified = String(opts.modified ?? '').trim() || isoUtc(new Date());
    const safeMeta: EpubMeta = { ...meta, title: String(meta?.title ?? '').trim() || '未命名' };
    const lang = safeMeta.language ?? 'zh';

    const files: EpubFile[] = [
        // 🔴 必须是第一条，且必须是 STORE —— 顺序与压缩方式都由这里定，`services/epubWriter` 只是照做
        { path: 'mimetype', content: EPUB_MIMETYPE, stored: true },
        { path: 'META-INF/container.xml', content: epubContainerXml() },
        { path: 'OEBPS/content.opf', content: epubOpf(kept, safeMeta, uuid, modified) },
        { path: 'OEBPS/nav.xhtml', content: epubNavXhtml(kept, lang) },
        { path: 'OEBPS/toc.ncx', content: epubNcx(kept, safeMeta, uuid) },
        { path: 'OEBPS/style.css', content: epubStyleCss() },
    ];
    for (const c of kept) {
        files.push({
            path: `OEBPS/${chapterFileName(c.no)}`,
            content: epubChapterXhtml(c.title, chapterParagraphs(c.text), lang),
        });
    }
    return files;
}

/** 把正文拆成段落（与 `pure/novelText.chapterParagraphs` 同一口径；这里本地复刻一行，避免多一层依赖方向） */
function chapterParagraphs(text: string): string[] {
    return String(text ?? '')
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
        .filter((p) => p.length > 0);
}
