// 宿主**独立窗口**的尺寸/标题算术（用户 m17697：「为什么不能改成微信读书式浏览器弹窗」）。
//
// 🔴 参照物是 `services/qrLogin.openWereadWindow()` 里的 `new BrowserWindow(...)`：
//    独立 OS 窗口，标题栏拖动、边缘缩放、最大化全由操作系统给 —— 微信读书那一档
//    插件里**一行拖拽代码都没有**。我先前把百度搜索做成 Obsidian `Modal` 加自写的
//    拖动/缩放，是拿自制装置去模仿系统窗口；用户一句「不能拖动啊居中也不行挡住了」
//    就是这个选择的必然结果。
//
// 🔴 实测硬坑（真机取证，2026-11-20）：在 Obsidian 的 `@electron/remote` 这条路径上，
//    `BrowserWindow` 的**构造参数 width/height 被忽略** ——
//      `new BW({ width: 900, height: 700 })` ⇒ 立刻 `getBounds()` = `{x:0,y:0,width:800,height:600}`；
//      随后 `setBounds({x:150,y:90,width:900,height:700})` ⇒ `{150,90,900,700}` 精确生效。
//    ⇒ ⛔ 别只依赖构造参数。那样会得到「代码里明明写了 900×700，窗口还是 800×600」，
//      而且不报错、日志里也看不出来，只能靠真机量。
//
// ⚠️ 本模块不碰 Electron（`window.require` 在 `services/hostWindow`），只做算术，便于单测。

/** 独立窗口的默认尺寸（比 Modal 版更宽 —— 真窗口能最大化，不怕一开始占地方） */
export const HOST_WINDOW_DEFAULT_WIDTH = 900;
export const HOST_WINDOW_DEFAULT_HEIGHT = 720;

/**
 * 下限沿用弹窗那套「还能用」的口径（`pure/modalDrag` 的 `MODAL_MIN_*`）。
 * ⚠️ 这里**不复用**那些常量：两边语义不同 —— Modal 的下限是「拖动时别缩没了」，
 *    独立窗口的下限是「用户拉边缘时别把工作区缩到看不见」；共用会让改一边牵连另一边。
 */
export const HOST_WINDOW_MIN_WIDTH = 420;
export const HOST_WINDOW_MIN_HEIGHT = 300;

/** 窗口离屏幕边缘至少留的像素（最大化/贴边时别顶死） */
export const HOST_WINDOW_EDGE = 24;

/** 工作区（`screen.getPrimaryDisplay().workArea`，已扣掉任务栏） */
export interface HostWorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** `setBounds()` 要的四个字段（Electron 的 `Rectangle` 是这四样的超集） */
export interface HostWindowBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 窗口标题上限（太长会被系统标题栏截断，留点余量给 `百度搜索：` 前缀） */
const HOST_WINDOW_TITLE_MAX = 60;

/**
 * 窗口标题。
 * @param query 搜索词（可能是空串 —— 用户标题和作者都没填）
 */
export function hostWindowTitle(query: string): string {
    const q = String(query ?? '')
        .replace(/[\s\u3000]+/g, ' ')
        .trim();
    if (!q) return '百度搜索';
    const head = q.length > HOST_WINDOW_TITLE_MAX ? `${q.slice(0, HOST_WINDOW_TITLE_MAX)}…` : q;
    return `百度搜索：${head}`;
}

/**
 * 算出 `setBounds()` 该用的矩形：先夹到工作区，再居中。
 *
 * 🔴 为什么一定要居中：不传 `x/y` 时 Electron 的落点**不可控**（实测落在 `{0,0}`，
 *    也就是屏幕左上角，标题栏可能被任务栏/菜单栏压住）。用户抱怨的「挡住了」有一部分
 *    就是落点不受控造成的观感。
 *
 * ⚠️ `workArea` 缺失（拿不到 `screen`）时只返回宽高，让系统自己摆 ——
 *    ⛔ 别瞎猜一个 1400×1000 的居中坐标，多屏下会算到屏幕外。
 */
export function hostWindowBounds(
    size: { width?: number; height?: number } = {},
    workArea?: HostWorkArea | null,
): HostWindowBounds {
    const wantW = finiteOr(size.width, HOST_WINDOW_DEFAULT_WIDTH);
    const wantH = finiteOr(size.height, HOST_WINDOW_DEFAULT_HEIGHT);
    if (!workArea || !isUsableArea(workArea)) {
        return {
            x: 0,
            y: 0,
            width: Math.max(HOST_WINDOW_MIN_WIDTH, Math.round(wantW)),
            height: Math.max(HOST_WINDOW_MIN_HEIGHT, Math.round(wantH)),
        };
    }
    // 可用空间 = 工作区扣掉两侧留白；再与下限取 max（屏比下限还小时宁可溢出也别缩成不可用）
    const maxW = Math.max(HOST_WINDOW_MIN_WIDTH, workArea.width - HOST_WINDOW_EDGE * 2);
    const maxH = Math.max(HOST_WINDOW_MIN_HEIGHT, workArea.height - HOST_WINDOW_EDGE * 2);
    const width = clamp(Math.round(wantW), HOST_WINDOW_MIN_WIDTH, maxW);
    const height = clamp(Math.round(wantH), HOST_WINDOW_MIN_HEIGHT, maxH);
    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height,
    };
}

/**
 * 该不该复用已有窗口。
 *
 * 判据只有「没被销毁」：最小化也算活着（要 `restore()`，⛔ 不要另开一个 ——
 * 每点一次搜索开一个新窗口，比原先挡住半屏还难受）。
 */
export function hostWindowReusable(isDestroyed: boolean | undefined): boolean {
    return isDestroyed !== true;
}

function isUsableArea(area: HostWorkArea): boolean {
    return (
        Number.isFinite(area.width) &&
        Number.isFinite(area.height) &&
        area.width > 0 &&
        area.height > 0
    );
}

function finiteOr(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}
