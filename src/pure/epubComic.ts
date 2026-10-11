/**
 * EPUB 漫画页抽取（纯逻辑：无 obsidian / 无 DOM / 无 node，可单测）。
 *
 * 1.2.1 #540：用户报障「怎么解析不了 eupb 格式的漫画」——控制台原文
 *   `about:srcdoc:46 GET app://obsidian.md/image/moe-009330.jpg net::ERR_FILE_NOT_FOUND`。
 *
 * 🔴 真因（不是「没做 EPUB 漫画」，而是**EPUB 阅读器的渲染口径**决定的）：
 *   EPUB 正文渲染在 `iframe.srcdoc` 里（见 `modals/EpubReaderModal.buildFrameDoc`），
 *   srcdoc 文档**没有基准 URL** ⇒ 章节 XHTML 里的**相对路径**（`image/p001.jpg`、`css/style.css`）
 *   会被浏览器解析成 `app://obsidian.md/image/p001.jpg`（应用根目录）⇒ 一律 404。
 *   而解包侧 `main.unpackEpub` 只把**文本类**文件收进 `fileMap`（图片根本没进来），图片永远不会显示。
 *
 * ⇒ 口径：**漫画条目 + EPUB 改走漫画阅读器**（与 CBZ 同一条渲染链），页图由本模块按 **spine 顺序**抽出：
 *   · 目录顺序 = `book.chapters`（spine 序，已由解包侧排好）—— ⛔ 别按文件名排序（漫画常带封面/扉页，
 *     文件名序与阅读序常常不一致，而 spine 序才是出版社给定的阅读序）；
 *   · 每个章节里的 `<img src>` / SVG `<image href|xlink:href>` 按**出现顺序**收，一个章节多图就多页；
 *   · 去重按**解析后的包内路径**（封面页与正文首页指向同一张图时不重复出一页）。
 *
 * ⚠️ 只处理**包内相对/根相对路径**；带协议（http/https/data/blob/file…）的引用一律跳过（那些不该由阅读器取）。
 */

import { isComicImageName } from 'pure/comicFiles';

/** 带协议的引用（`http:` / `https:` / `data:` / `blob:` / `file:` …）——外部资源，本模块不接管 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 百分号解码（坏转义原样返回；包内路径与 href 写法常不一致，解码后再比对更稳） */
function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * 把章节内的引用解析成**包内路径**（相对章节所在目录；含 `..` / `.` / 根相对 `/`）。
 * 解析不出（空 / 带协议 / 只剩锚点）→ `null`。
 * ⚠️ `..` 越过包根时**原地不动**（不上抛）—— 畸形 EPUB 不应把路径算到包外。
 */
export function resolveEpubRef(baseDir: string, ref: string): string | null {
    const raw = String(ref ?? '').trim();
    if (!raw || raw.startsWith('#')) return null;
    if (HAS_SCHEME.test(raw)) return null;
    // 去掉 fragment / query（`p1.jpg#x`、`p1.jpg?v=2`）
    const clean = safeDecode(raw.split('#')[0].split('?')[0]).replace(/\\/g, '/');
    if (!clean) return null;
    const out: string[] = clean.startsWith('/')
        ? []
        : String(baseDir ?? '')
              .split('/')
              .filter((seg) => seg !== '' && seg !== '.');
    for (const seg of clean.replace(/^\/+/, '').split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') {
            out.pop();
            continue;
        }
        out.push(seg);
    }
    return out.length ? out.join('/') : null;
}

/** 从章节 HTML 里抽资源引用（`<img src>` / `<image href|xlink:href>` / `<source src>`，按出现顺序） */
export function extractEpubImageRefs(html: string): string[] {
    const out: string[] = [];
    const tags = String(html ?? '').match(/<(?:img|image|source)\b[^>]*>/gi) ?? [];
    for (const tag of tags) {
        const m = tag.match(/\b(?:xlink:href|src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const v = m ? m[1] ?? m[2] ?? '' : '';
        if (v.trim()) out.push(v.trim());
    }
    return out;
}

/** 包内的一个漫画页（`path` = 包内路径，`name` = 文件名 —— 宿主据此取 MIME） */
export interface EpubComicPage {
    path: string;
    name: string;
}

/**
 * 按 spine 顺序抽漫画页：逐章取图引用 → 解析成包内路径 → 只留图片 → 去重（首现为准）。
 * `fileMap` 缺失的章节（占位/损坏）直接跳过；结果为空 = 这本 EPUB 不是图册型（调用方回落文字阅读器）。
 */
export function extractEpubComicPages(
    chapters: readonly string[],
    fileMap: Record<string, string>,
): EpubComicPage[] {
    const out: EpubComicPage[] = [];
    const seen = new Set<string>();
    for (const chapter of chapters ?? []) {
        const html = fileMap?.[chapter];
        if (html === undefined) continue;
        const baseDir = String(chapter).split('/').slice(0, -1).join('/');
        for (const ref of extractEpubImageRefs(html)) {
            const path = resolveEpubRef(baseDir, ref);
            if (!path || !isComicImageName(path) || seen.has(path)) continue;
            seen.add(path);
            out.push({ path, name: path.slice(path.lastIndexOf('/') + 1) });
        }
    }
    return out;
}
