/**
 * 漫画文件判据（纯逻辑：无 obsidian / 无 DOM / 无 node，可单测）。
 *
 * 1.2.1 #537：内置阅读器新增漫画阅读支持。用户点定的三类来源里，本模块只负责**判据与排序**：
 *   ⑴ **散装文件夹型** —— 目录里一串图片（png/jpg/jpeg/webp/gif/avif/bmp 混装，实测样例 200 张）；
 *   ⑵ **压缩包型** —— CBZ/ZIP、CBT/TAR（本批零依赖档；CBR/RAR、CB7/7Z 需 WASM 解压依赖，**不在本批**）；
 *   ⑶ **文档型** —— PDF/EPUB 复用既有阅读器（本模块不判），Kindle（mobi/azw3）**本批不做**。
 *
 * 三条纪律（对齐本仓「纯逻辑下沉」红线）：
 *   · **扩展名真源只此一份** —— 图 / 档两张表都在这里，⛔ 别在宿主或面板里再抄一遍；
 *   · **自然序**（`1, 2, …, 10` 而不是 `1, 10, 2`）—— 图片序列靠文件名排序，字典序会把第 10 页排到第 2 页前；
 *   · **归档项过滤口径独立**（`isComicArchiveEntry`）：排除目录项 / 隐藏项 / macOS 元数据（`__MACOSX/`、`._x`），
 *     否则解包出来的「页数」与用户看到的对不上（.DS_Store、`__MACOSX/._01.jpg` 会被当成页）。
 */

/** 漫画页图片扩展名（小写，无点）。jpeg 与 jpg 并存（两种写法都常见）。 */
export const COMIC_IMAGE_EXTS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

/** 漫画压缩包扩展名（小写，无点）——本批零依赖档：CBZ/ZIP + CBT/TAR。
 *  ⚠️ CBR/RAR、CB7/7Z 需 WASM 解压依赖，用户 2026-10-05 点定**本批不做**（A1 零依赖档）⇒ ⛔ 别顺手加进来。 */
export const COMIC_ARCHIVE_EXTS: readonly string[] = ['cbz', 'zip', 'cbt', 'tar'];

/** 取路径扩展名（小写、去 `#?` 参数；无扩展名 / 以分隔符结尾 → ''）。与 `pure/mediaExtensions.videoExt` 同实现。 */
export function comicExt(path: string): string {
    if (!path) return '';
    const norm = String(path).replace(/\\/g, '/');
    const idx = norm.lastIndexOf('.');
    if (idx < 0 || idx === norm.length - 1) return '';
    return norm.slice(idx + 1).toLowerCase().split(/[?#]/)[0];
}

/** 文件名（或路径）是不是一张漫画页图片 */
export function isComicImageName(name: string): boolean {
    const base = String(name ?? '').replace(/\\/g, '/');
    const tail = base.slice(base.lastIndexOf('/') + 1);
    if (!tail || tail.startsWith('.')) return false; // 隐藏文件（含 .DS_Store）不算页
    return COMIC_IMAGE_EXTS.includes(comicExt(tail));
}

/** 路径是不是漫画压缩包（判据只看扩展名；「是不是真文件」由宿主负责） */
export function isComicArchivePath(path: string): boolean {
    return COMIC_ARCHIVE_EXTS.includes(comicExt(path));
}

/** 归档压缩包格式的中文短名（面板 / 提示用；未知格式回落大写扩展名） */
export function comicArchiveLabel(path: string): string {
    const ext = comicExt(path);
    const map: Record<string, string> = { cbz: 'CBZ', zip: 'ZIP', cbt: 'CBT', tar: 'TAR' };
    return map[ext] ?? ext.toUpperCase();
}

/**
 * 归档内条目是否算一页漫画：
 * 跳过目录项（以 `/` 结尾）、隐藏项（basename 以 `.` 开头）、macOS 资源叉（`__MACOSX/` 段、`._` 前缀），
 * 其余必须是图片扩展名。⛔ 别放宽成「只要不是目录就算」——那会把 readme.txt / ComicInfo.xml 一并当页。
 */
export function isComicArchiveEntry(name: string): boolean {
    const n = String(name ?? '').replace(/\\/g, '/');
    if (!n || n.endsWith('/')) return false;
    if (n.startsWith('__MACOSX/') || n.includes('/__MACOSX/')) return false;
    const base = n.slice(n.lastIndexOf('/') + 1);
    if (!base || base.startsWith('.')) return false;
    return COMIC_IMAGE_EXTS.includes(comicExt(base));
}

/** 比较两个数字串（忽略前导零，先比有效长度再比字典序；避免 `Number()` 大数溢出） */
function compareDigits(x: string, y: string): number {
    const xx = x.replace(/^0+/, '') || '0';
    const yy = y.replace(/^0+/, '') || '0';
    if (xx.length !== yy.length) return xx.length - yy.length;
    return xx < yy ? -1 : xx > yy ? 1 : 0;
}

/**
 * 自然序比较：把字符串切成「数字段 / 非数字段」交替，数字段按数值比、其余按字典序。
 * 例：`p2.jpg` < `p10.jpg`；`1.jpg` < `01.jpg`（长度相同时前导零少者在前，与数值序一致）。
 */
export function naturalCompare(a: string, b: string): number {
    const sa = String(a ?? '');
    const sb = String(b ?? '');
    const re = /(\d+)|(\D+)/g;
    const ax = sa.match(re) ?? [];
    const bx = sb.match(re) ?? [];
    const n = Math.min(ax.length, bx.length);
    for (let i = 0; i < n; i++) {
        const x = ax[i];
        const y = bx[i];
        const xd = /^\d/.test(x);
        const yd = /^\d/.test(y);
        if (xd && yd) {
            const d = compareDigits(x, y);
            if (d !== 0) return d;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    if (ax.length !== bx.length) return ax.length - bx.length;
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** 按**自然序**排漫画页（返回新数组，不改入参）；同名再退回整串字典序保证稳定。 */
export function sortComicPages<T extends { name: string }>(items: readonly T[]): T[] {
    return [...(items ?? [])].sort(
        (a, b) => naturalCompare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

/** 「第 N / M 页」底栏文本（面板用；页码 0 基入参 → 1 基展示）。M ≤ 0 时回落「—」。 */
export function comicPageText(index: number, total: number): string {
    if (!Number.isFinite(total) || total <= 0) return '第 — 页';
    const i = Math.max(0, Math.min(total - 1, Math.floor(index)));
    return `第 ${i + 1} / ${total} 页`;
}
