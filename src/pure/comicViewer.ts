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

export const COMIC_VIEW_MODES: readonly ComicViewMode[] = ['single', 'scroll'];

export const COMIC_VIEW_MODE_LABELS: Readonly<Record<ComicViewMode, string>> = {
    single: '单页',
    scroll: '连续滚动',
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

/** 缩略图栏是否该渲染（默认**隐藏** —— 用户裁定；窄窗下它会挤掉正文） */
export function thumbsVisible(stored: unknown): boolean {
    return stored === true;
}

/** 阅读模式的两档在菜单里的选项（供设置菜单遍历，⛔ 别在视图里手写两份文案） */
export function comicViewModeOptions(): { value: ComicViewMode; label: string }[] {
    return COMIC_VIEW_MODES.map((v) => ({ value: v, label: COMIC_VIEW_MODE_LABELS[v] }));
}

/** 主题类型透传（漫画与另三个阅读器共用六档主题，本模块只做类型收口） */
export type ComicTheme = ReaderThemeId;

// ── 🔴 #642：重活（补缩略图 / 插图）的**调度判据** ────────────────────────────────
//
// 由来（用户 2026-10-18 报障）：「阅读 eupb 漫画时卡住了完全动不了」。
// 实测（`_probe_642_zip.cjs`）：zip 单张解压 8ms、串行 20 张 **310ms** —— 而阅读器侧
// 每次滚动都会对窗口内最多 13 页（缩略图）+ 7 页（正文）取图，**全部在主线程**。
// 更糟的是补图函数**没有重入守卫**：连续滚动会叠起多条并发补图（用户那次缩略图栏是开着的）
// ⇒ 主线程被解压彻底占满 = 界面完全不动。
//
// 两条判据下沉到这里（纯函数、可单测），视图侧只负责执行：

/**
 * 现在**该不该**开始补缩略图。
 *
 * `idleMs = 0/缺省` ⇒ 永远说「该」（兼容「不是滚动触发的补图」：挂载、切模式、展开缩略图栏）。
 * 滚动触发的那一路传 `SCROLL_IDLE_MS`：**滚动中一直说不该**（推迟），手停下 `idleMs` 之后才该。
 *
 * ⚠️ 判据是「距上次滚动是否够久」而不是「有没有在滚」—— 后者需要 debounce 结束事件，
 *    而滚动没有可靠的「结束」事件（触控板惯性会拖很久），用时间差最稳。
 */
export function shouldFillThumbs(opts: { now: number; lastScrollAt: number; idleMs?: number }): boolean {
    const idle = Math.max(0, Number(opts.idleMs) || 0);
    if (idle === 0) return true;
    const last = Number(opts.lastScrollAt) || 0;
    if (last <= 0) return true; // 从没滚过 ⇒ 页面刚打开，该补
    const now = Number(opts.now) || 0;
    return now - last >= idle;
}

/** 还要等多久才该补（`0` = 现在就该）；用于排定时器 */
export function thumbsFillDelay(opts: { now: number; lastScrollAt: number; idleMs?: number }): number {
    const idle = Math.max(0, Number(opts.idleMs) || 0);
    if (idle === 0) return 0;
    const last = Number(opts.lastScrollAt) || 0;
    if (last <= 0) return 0;
    const now = Number(opts.now) || 0;
    return Math.max(0, idle - (now - last));
}

/**
 * 重入守卫的**下一步动作**（把「并发调用该怎么处理」表达成可测的真值表）。
 *
 * · `busy=false` → `'start'`：开一轮；
 * · `busy=true`  → `'markDirty'`：**只置脏**（⛔ 别并发再开一条 —— 那正是卡死的成因）；
 * · 一轮跑完后若 `dirty` → `'again'`（把期间的请求补上，否则最后一批**永远不补**）；
 * · 否则 → `'done'`。
 */
export type FillStep = 'start' | 'markDirty' | 'again' | 'done';

export function nextFillStep(state: { busy: boolean; dirty: boolean; first: boolean }): FillStep {
    if (!state.busy) return 'start';
    if (state.first) return 'markDirty'; // 进入时就在忙 ⇒ 本次只置脏
    return state.dirty ? 'again' : 'done';
}
