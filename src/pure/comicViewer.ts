// 漫画阅读器的**纯逻辑**（#636 ⑤，用户 2026-10-15）—— 零 `obsidian` / 零 DOM / 零网络，可单测。
//
// 本批参考 `usero2/obsidian-plugins-cbz-reader` 加两件（用户点名）：
//   ⑴ **右侧垂直缩略图导航栏**（默认隐藏，顶栏一枚开关）；
//   ⑵ **连续滚动模式**（与现成的单页制并列，设置菜单里一档）。
// 外加参考仓 v1.0.4 的**右键菜单**（看原文件名 / 复制图像）。
//
// 🔴 为什么这些要下沉到纯模块：三条都是「算出来的」，且**算错了不报错、只是卡或错位**：
//   · 缩略图**惰性生成**的窗口（200 页一次性解压会卡死 —— 参考仓的「high-performance lazy loading」就是这个）；
//   · 连续模式里「当前是第几页」（靠滚动位置反推，边界很容易差一页）；
//   · 「视野外的页要卸载」（不卸载 = 大漫画吃光内存）。
import type { ReaderThemeId } from 'pure/readerTheme';

/** 阅读模式（#636 ⑵）：单页制（#537 现状）/ 连续滚动（本批新增） */
export type ComicViewMode = 'single' | 'scroll';

/**
 * 菜单里的**呈现顺序**：`'scroll'`（滚动）在前、`'single'`（翻页）在后。
 *
 * 🔴 2026-10-24 修正：此前这里写的是 `['single', 'scroll']`（翻页在前），与书籍阅读器**相反**。
 *    真正的同一套顺序在 `pure/readerTypography.ts` 的 `SCROLL_OPTIONS`：`滚动 / 翻页`。
 *    TXT / EPUB / PDF 三个阅读器都直接遍历 `SCROLL_OPTIONS`，所以「统一」= 漫画也照它排。
 * ⚠️ 这只是**数组顺序**（纯 UI），值 `'single' | 'scroll'` 与设置字段 `comicViewMode` 一字不动
 *    （⛔ 改了就是数据不兼容）—— 顺序变了不影响任何已存偏好。
 */
export const COMIC_VIEW_MODES: readonly ComicViewMode[] = ['scroll', 'single'];

/**
 * 两个阅读模式在**界面上**的名字。
 *
 * 🔴 #676（用户 2026-10-19）：「两个切页模式文案名称改成『翻页、滚动』同步书籍阅读器」——
 *    与 TXT / EPUB 阅读器的「模式：滚动 / 翻页」保持**同一套用词**（UI-GUIDE v10 续 那条口径：
 *    书籍阅读器**不用**「连续滚动 / 翻页式」这种长名）。
 * ⚠️ 只改**文案**：值 `'single' | 'scroll'` 与设置字段 `comicViewMode` 一字不动（⛔ 改了就是数据不兼容）。
 * ⚠️ 顺序见上面 `COMIC_VIEW_MODES` 的说明：**先「滚动」后「翻页」**，与 `SCROLL_OPTIONS` 一致。
 *    （本条早先误写成「先翻页后滚动」，与事实相反，已于 2026-10-24 更正。）
 */
export const COMIC_VIEW_MODE_LABELS: Readonly<Record<ComicViewMode, string>> = {
    single: '翻页',
    scroll: '滚动',
};

/** 归一阅读模式（未知 / 脏值 ⇒ 单页 —— 那是 #537 起的既有行为，⛔ 别默认为连续） */
export function normalizeComicViewMode(v: unknown): ComicViewMode {
    return v === 'scroll' ? 'scroll' : 'single';
}

/**
 * 缩略图**窗口**：只给「当前页附近」的几页画小图（惰性），其余留空占位。
 *
 * 🔴 为什么必须有它：缩略图 = 把每一页的图**解出来再缩小**。200 页的 CBZ 一次性全做 =
 *    同时持有 200 个 `Blob` + 200 张位图 ⇒ 卡死或 OOM（参考仓把这个叫 lazy loading，是它的核心卖点）。
 *    ⇒ 只做窗口内的；用户滚动缩略图栏时窗口跟着移，**做过的页不重做**（见 `pruneThumbs`）。
 *
 * @param current 当前页下标（0 基）
 * @param total   总页数
 * @param radius  窗口半径（前后各几页）
 */
export function thumbWindow(current: number, total: number, radius = 6): { start: number; end: number } {
    const n = Math.max(0, Math.floor(total));
    if (n === 0) return { start: 0, end: -1 };
    const c = Math.max(0, Math.min(n - 1, Math.floor(current)));
    // ⚠️ 窗口按**总页数截断**（⛔ 不环绕：环状窗口在列表里看着像跳页）
    return { start: Math.max(0, c - radius), end: Math.min(n - 1, c + radius) };
}

/** 该页该不该现在生成缩略图（窗口内 ⇒ 要；其余 ⇒ 只占位） */
export function inThumbWindow(index: number, current: number, total: number, radius = 6): boolean {
    const w = thumbWindow(current, total, radius);
    return index >= w.start && index <= w.end;
}

/**
 * 🔴 卸载不再需要的缩略图缓存（返回**要保留**的下标集合）。
 *
 * 与 `thumbWindow` 的区别（本函数存在的全部理由）：`thumbWindow` 答「现在该**生成**谁」，
 * 它答「现在该**留**谁」—— 后者必须**更大**（`keepRadius > radius`），否则用户来回滚两下，
 * 刚生成的缩略图立刻被丢、再滚回来又要重生成（抖动）。
 */
export function pruneThumbs(
    cached: readonly number[],
    current: number,
    total: number,
    keepRadius = 30,
): number[] {
    const w = thumbWindow(current, total, keepRadius);
    return cached.filter((i) => i >= w.start && i <= w.end);
}

/**
 * 连续滚动模式下：**哪个页号正处在视野内**（取「页顶最接近滚动位置且不高于它」的那页）。
 *
 * 🔴 判据不是「中心点命中」（那种写法在两页交界处会跳来跳去），而是
 *    「本页顶部已经滚过 ⇒ 就是它」—— 与我们读电子书时的直觉一致：翻到下一页 = 下一章的顶到了视野顶。
 * @param tops  各页相对滚动容器的**顶部偏移**（升序；由视图侧量出后传入）
 * @param scrollTop 当前滚动位置
 */
export function pageAtScroll(tops: readonly number[], scrollTop: number): number {
    if (tops.length === 0) return 0;
    const y = Number.isFinite(scrollTop) ? scrollTop : 0;
    let idx = 0;
    for (let i = 0; i < tops.length; i++) {
        // 🔴 **严格 `<=`，不加容差**：`tops[i] <= y` 才是「这一页的顶已经滚过」。
        //    ⚠️ 首版写成 `y + 1`（想吸收亚像素误差），结果 `scrollTop = 299` 时
        //    `300 <= 300` 成立 ⇒ 提前一页报成第 2 页（实测：`pageAtScroll([0,300,…], 299)` 返回 1）。
        //    宁可差一像素也不要差一页 —— 页码是**整数语义**，没有「差不多」。
        if (tops[i] <= y) idx = i;
        else break;
    }
    return idx;
}

/** 连续模式里「该卸掉哪些页」：离当前页超过 `keep` 页的（保留前后各 `keep`） */
export function pagesToUnload(current: number, total: number, keep = 3): (i: number) => boolean {
    const n = Math.max(0, Math.floor(total));
    // 🔴 空库（n === 0）：**什么都不保留**（恒 true）。
    //    ⚠️ 首版让 `c` 落到 0、于是 `|0-0| > 3` 为 false ⇒ 第 0 页被判成「要保留」——
    //    对一本**没有页**的漫画「保留第 0 页」是自相矛盾的（实测抓到）。
    if (n === 0) return () => true;
    const c = Math.max(0, Math.min(n - 1, Math.floor(current)));
    return (i: number) => Math.abs(i - c) > keep;
}

/**
 * 右键菜单里显示的那行**原文件名**（参考仓 v1.0.4：「Right-click on any image … to view the original
 * filename inside the CBZ archive」）。
 *
 * 🔴 只取**末段**（压缩包内是 `dir/sub/page-001.jpg` 这种路径；整条路径在菜单里又长又没用），
 *    且**超长要截断**（参考仓专门提了 word-wrapping，说明长文件名是常见情况）。
 * ⚠️ 截断保留**扩展名**（`.jpg` 被截掉的话，用户辨认不出这是什么文件）。
 */
export function baseNameOf(path: string, max = 42): string {
    const s = String(path ?? '');
    const base = s.split(/[\\/]/).pop() ?? s;
    if (base.length <= max) return base;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot) : '';
    // 扩展名自己就超长（罕见）⇒ 直接硬截，别再拼
    if (ext.length >= max - 4) return base.slice(0, max - 1) + '…';
    return base.slice(0, max - ext.length - 1) + '…' + ext;
}

/**
 * 缩略图栏是否该渲染。
 *
 * 🔴 #669（用户 2026-10-19 裁定）：**默认开**，且开关**只留在漫画阅读器顶栏**（已从设置页阅读器
 *   折叠组里移出）。沿革：#636 曾裁定「默认关」（怕窄窗下挤掉正文），实测下来用户根本不知道有这功能
 *   ——「默认关 + 开关藏在设置页」等于没做。
 * ⚠️ 只有显式 `false` 才关；缺省 / 脏值一律**开**（老用户 data.json 里没有这个键 ⇒ 升级后可见）。
 *    字符串 `'false'`（手改 data.json 的常见形态）**不算**关闭 —— 判定必须是布尔 `false`。
 */
export function thumbsVisible(stored: unknown): boolean {
    return stored !== false;
}

/** 阅读模式的两档在菜单里的选项（供设置菜单遍历，⛔ 别在视图里手写两份文案） */
export function comicViewModeOptions(): { value: ComicViewMode; label: string }[] {
    return COMIC_VIEW_MODES.map((v) => ({ value: v, label: COMIC_VIEW_MODE_LABELS[v] }));
}

/** 主题类型透传（漫画与另三个阅读器共用六档主题，本模块只做类型收口） */
export type ComicTheme = ReaderThemeId;

