// 目录侧栏的拖宽与字数展示辅助（#338）。纯函数（夹取 / 格式化）在此单测；
// `attachTocResizer` 是 DOM 接线（拖拽期间挂 `.rl-toc-resizing` 关掉宽度过渡，否则拖起来发黏）。

/** 目录侧栏宽度下限（再窄字数就显示不下了） */
export const TOC_WIDTH_MIN = 180;
/** 目录侧栏宽度上限（别把正文挤没了） */
export const TOC_WIDTH_MAX = 480;
/** 记忆宽度（localStorage：跨书共享一个宽度，够用且不加设置字段） */
export const TOC_WIDTH_KEY = 'rl-reader-toc-width';
/** 未记忆时的宽度 = 原 CSS 定宽 */
export const TOC_WIDTH_DEFAULT = 220;

/** 夹取；非法值回退缺省 220 */
export function clampTocWidth(w: number): number {
    if (!Number.isFinite(w)) return TOC_WIDTH_DEFAULT;
    return Math.min(TOC_WIDTH_MAX, Math.max(TOC_WIDTH_MIN, Math.round(w)));
}

/** 宽度的载体：CSS 变量（🔴 #339：⛔ **绝不写行内 `style.width`** —— 行内 width 优先级高于类选择器，
 *  会把 `.rl-reader-toc.collapsed { width: 0 }` 顶死 ⇒ **目录侧栏收不起来**。
 *  宽度走 `width: var(--rl-toc-w, 220px)`，折叠仍由类选择器说了算。） */
export const TOC_WIDTH_VAR = '--rl-toc-w';

/** 宽度取值（裸长度，配合 `setProperty(TOC_WIDTH_VAR, …)`）：已夹取，非法值回退 220px */
export function tocWidthValue(w: number): string {
    return `${clampTocWidth(w)}px`;
}

/** 字数展示：小于一万原样；一万以上「x.x万」（整数万不带 .0）；非法值空串（不显示） */
export function formatCharCount(n: number): string {
    if (!Number.isFinite(n) || n < 0) return '';
    if (n >= 10000) {
        const v = Math.round(n / 1000) / 10;
        return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '万';
    }
    return String(n);
}

/** 读取记忆宽度（localStorage 不可用 / 未存 → null，由调用方回退 CSS 定宽） */
export function loadTocWidth(): number | null {
    try {
        const raw = localStorage.getItem(TOC_WIDTH_KEY);
        if (raw === null) return null;
        return clampTocWidth(Number(raw));
    } catch {
        return null;
    }
}

/** 写入当前宽度（只动 CSS 变量；⛔ 不写 `style.width` —— 见 `TOC_WIDTH_VAR` 的说明） */
export function applyTocWidth(tocEl: HTMLElement, w: number): void {
    tocEl.style.setProperty(TOC_WIDTH_VAR, tocWidthValue(w));
}

/** 读回当前宽度（没设过 → NaN） */
export function currentTocWidth(tocEl: HTMLElement): number {
    return parseFloat(tocEl.style.getPropertyValue(TOC_WIDTH_VAR));
}

function saveTocWidth(w: number): void {
    try {
        localStorage.setItem(TOC_WIDTH_KEY, String(clampTocWidth(w)));
    } catch {
        /* 写不进就不记（下次还是定宽） */
    }
}

/**
 * 给目录侧栏装**拖宽手柄**（右缘 9px 热区）+ 应用记忆宽度。
 * 🔴 拖动期间挂 `.rl-toc-resizing` 关掉 `transition: width`（否则每帧都被过渡吃掉，拖起来发黏）。
 * ⚠️ 手柄是绝对定位的 9px 热区，不占布局；`.rl-reader-toc` 本就 `position: relative`。
 */
export function attachTocResizer(tocEl: HTMLElement): void {
    // 🔴 只写 CSS 变量，不写 `style.width`（#339：行内 width 会把 `.collapsed { width: 0 }` 顶死 ⇒ 收不起来）
    const saved = loadTocWidth();
    if (saved !== null) applyTocWidth(tocEl, saved);
    const grip = tocEl.createDiv({ cls: 'rl-reader-toc-resizer', attr: { 'aria-hidden': 'true' } });
    grip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const startW = tocEl.getBoundingClientRect().width;
        const startX = ev.clientX;
        tocEl.addClass('rl-toc-resizing');
        try {
            grip.setPointerCapture(ev.pointerId);
        } catch {
            /* 捕获失败不影响拖动 */
        }
        const onMove = (m: PointerEvent): void => {
            applyTocWidth(tocEl, startW + (m.clientX - startX));
        };
        const onUp = (): void => {
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('pointerup', onUp);
            grip.removeEventListener('pointercancel', onUp);
            tocEl.removeClass('rl-toc-resizing');
            saveTocWidth(currentTocWidth(tocEl) || startW);
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
        grip.addEventListener('pointercancel', onUp);
    });
}
