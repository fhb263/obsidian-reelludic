/**
 * EPUB 章节内**资源引用重写**（纯逻辑：无 obsidian / 无 DOM / 无 node，可单测）。
 *
 * 🔴 由来（用户 1.4.1 报障）：「EPUB 阅读卡顿，还有优化加载图片速度」。
 *   两件事其实同源 —— EPUB 正文渲染在 `iframe.srcdoc` 里，而 **srcdoc 文档没有基准 URL**：
 *   · 章节 XHTML 里的**相对路径**（`image/p001.jpg`、`../css/style.css`）被浏览器解析成
 *     `app://obsidian.md/image/p001.jpg`（应用根目录）⇒ 一律 `ERR_FILE_NOT_FOUND`（图全裂）；
 *   · 每张裂图都要走一次**失败的网络请求 + 控制台报错**，长章节（几十张插图的图册/技术书）
 *     就是几十次必然失败的往返 —— 这正是「打开章节慢 / 首次加载慢」的来源之一。
 *
 * ⇒ 口径：**把章节里的包内相对引用改写成绝对 `blob:` URL**，由宿主按需从 zip 取二进制。
 *   · 只改**包内相对 / 根相对**引用；带协议（http/https/data/blob/file…）与纯锚点（`#x`）**一律不动**
 *     （那些不该由阅读器接管，见 `pure/epubComic` 同一套判据）；
 *   · 拿不到二进制的引用（文件不在包里）**保留原样** —— 让浏览器照旧裂图，比静默删掉更好排查；
 *   · 改写只碰 `src` / `href` 属性值，**不动标签结构与正文文字**（高亮/摘抄的文本锚点全靠正文文本）。
 *
 * ⚠️ 与 `pure/epubComic` 的分工：那边是「**图册型 EPUB 整本改走漫画阅读器**」（按 spine 抽页图），
 *    这边是「**文字型 EPUB 正文里的插图就地显形**」。两条路互斥且有先后：
 *    漫画条目先试漫画链，抽不到图才回落本模块所在的文字阅读器。
 */

/** 带协议的引用（`http:` / `https:` / `data:` / `blob:` / `file:` …）——外部资源，本模块不接管 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 会被重写的标签与属性（`img/src`、`image/href|xlink:href`、`source/src`、`link/href` 样式表） */
const REF_TAG_RE = /<(img|image|source|link)\b[^>]*>/gi;
/**
 * 取标签里的资源属性值。属性名必须**完整匹配**（前一个字符不能是名字字符）——
 * 🔴 `\b(xlink:href|href|src)` 这种写法会在 `xlink:href` 上命中 `href`（`:` 是 `\b` 边界），
 *    于是把属性名后半截当值抽出来（实测抽出 `href` 三字母）。用 `(?<![-\w:])` 锁死左边界。
 */
const REF_ATTR_RE = /(?<![-\w:])(xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

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
 *
 * 🔴 与 `pure/epubComic.resolveEpubRef` **同一套算法**，但刻意各自留一份：
 *    两者服务不同的渲染链（漫画页图 / 正文插图），且都可能被单独修改（如本模块要处理
 *    `<link rel=stylesheet>` 的 href）—— 抽成共用函数会让「改一处动两条链」，
 *    与「两条链互不影响」的口径冲突。⚠️ 若哪天统一，务必两处单测一起看。
 */
export function resolveEpubResource(baseDir: string, ref: string): string | null {
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

/** 从章节 HTML 里抽需要重写的**包内路径**（去重、保持首现顺序）——宿主据此批量取二进制 */
export function collectEpubResourceRefs(html: string, baseDir: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const tags = String(html ?? '').match(REF_TAG_RE) ?? [];
    for (const tag of tags) {
        const m = tag.match(REF_ATTR_RE);
        // ⚠️ m[1] 是**属性名**，值在 m[2]（双引号）或 m[3]（单引号）—— ⛔ 别写成 m[1] ?? m[2]
        const v = m ? m[2] ?? m[3] ?? '' : '';
        const path = resolveEpubResource(baseDir, v);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        out.push(path);
    }
    return out;
}

/**
 * 把章节 HTML 里的包内相对引用替换成 `urlOf(包内路径)` 给出的 URL（通常 `blob:`）。
 *
 * `urlOf` 返回 `null` / 空串 = 这个资源取不到 ⇒ **保留原属性值**（照旧裂图，便于排查）。
 * `baseDir` = 章节文件所在目录（包内路径，`''` 表示包根）。
 */
export function rewriteEpubResourceUrls(
    html: string,
    baseDir: string,
    urlOf: (path: string) => string | null,
): string {
    return String(html ?? '').replace(REF_TAG_RE, (tag) => {
        const m = tag.match(REF_ATTR_RE);
        if (!m) return tag;
        const attr = m[1];
        const quote = tag.includes(`${attr}="`) ? '"' : "'";
        const rawValue = m[2] ?? m[3] ?? '';
        const path = resolveEpubResource(baseDir, rawValue);
        if (!path) return tag;
        const url = urlOf(path);
        if (!url) return tag; // 取不到 ⇒ 原样（⛔ 别替换成空串：那会把 <img> 变成当前页请求）
        // 保留 fragment（SVG `<use href="sprite.svg#icon">` 之类）：只换「文件」那一段
        const frag = rawValue.includes('#') ? '#' + rawValue.split('#').slice(1).join('#') : '';
        return tag.replace(m[0], `${attr}=${quote}${url}${frag}${quote}`);
    });
}

/**
 * 「这个包内路径**可能**是正文要用的资源」——宿主据此决定要不要去 zip 里取。
 * 判据 = 有扩展名且不是 XHTML/HTML（章节本体由 fileMap 直供，不该走二进制表）。
 */
export function isEpubResourcePath(path: string): boolean {
    const p = String(path ?? '').replace(/\\/g, '/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (!base || base.startsWith('.')) return false;
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return false;
    const ext = base.slice(dot + 1).toLowerCase();
    if (!ext) return false;
    // 章节本体 / XML / OPF / NCX 已在 fileMap 里，别重复取
    return !['xhtml', 'html', 'htm', 'xml', 'opf', 'ncx'].includes(ext);
}

/** 包内路径的图片扩展名 → MIME（宿主造 Blob 用；未知回落 `application/octet-stream`） */
export function epubResourceMime(path: string): string {
    const p = String(path ?? '').replace(/\\/g, '/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
    const map: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        bmp: 'image/bmp',
        svg: 'image/svg+xml',
        css: 'text/css',
        jpgx: 'image/jpeg',
        ttf: 'font/ttf',
        otf: 'font/otf',
        woff: 'font/woff',
        woff2: 'font/woff2',
    };
    return map[ext] ?? 'application/octet-stream';
}
