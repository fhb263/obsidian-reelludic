// 目录侧栏的拖宽与字数展示辅助（#338）。纯函数（夹取 / 格式化）在此单测；
// `attachTocResizer` 是 DOM 接线（拖拽期间挂 `.rl-toc-resizing` 关掉宽度过渡，否则拖起来发黏）。

/** 目录侧栏宽度下限（再窄字数就显示不下了） */
export const TOC_WIDTH_MIN = 180;
/** 目录侧栏宽度上限（别把正文挤没了） */
export const TOC_WIDTH_MAX = 480;
/**
 * 记忆宽度的 key 前缀（localStorage）。
 * 🔴 按**阅读器**分键（2026-10-24 用户指示：「各个阅读器的侧边栏展开不要同步，都是独立的」）。
 *    旧实现只有一个全局键，四个阅读器读同一份值 ⇒ 在 TXT 里拖宽，漫画侧栏跟着变，读作「同步」。
 *    现在读完各自写各自；老键保留为**只读回退**，让升级用户不丢已调好的宽度。
 */
export const TOC_WIDTH_KEY_PREFIX = 'rl-reader-toc-width';
/** 旧版本的全局键（⚠️ 仅作一次性回退读取，⛔ 不再写入） */
export const TOC_WIDTH_KEY = TOC_WIDTH_KEY_PREFIX;

/** 侧栏宽度的作用域 = 阅读器类型（四者互不影响） */
export type TocScope = 'txt' | 'epub' | 'pdf' | 'comic';

/** 某阅读器自己的宽度键 */
export function tocWidthKey(scope: TocScope): string {
    return `${TOC_WIDTH_KEY_PREFIX}:${scope}`;
}
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

/** 溢出遮罩的两个门控类名（与 `.rl-set-tabs` 同一套：**只在该端确实还有内容时**才挂） */
export const OVERFLOW_START_CLASS = 'is-overflow-start';
export const OVERFLOW_END_CLASS = 'is-overflow-end';
/** 竖向渐隐的标记类（styles.css 里 `.rl-fade-y.is-overflow-*` 是唯一出口） */
export const FADE_Y_CLASS = 'rl-fade-y';

/**
 * 溢出判据（纯函数，供 `attachScrollFade` 与单测共用）。
 * 🔴 门控遮罩的口径：滑到端点就**必须**撤掉那一端的类 —— 常驻遮罩会在端点处把最后一行遮淡，
 *    看起来像"内容被截掉了"，比不遮更糟（`styles.css` 里 `.rl-set-tabs` 那段同一条铁律）。
 * `max > 1` 的容差吸收亚像素：内容刚好不溢出时不给任何提示。
 */
export function overflowFlags(
    scrollTop: number,
    clientHeight: number,
    scrollHeight: number,
): { start: boolean; end: boolean } {
    const max = scrollHeight - clientHeight;
    const overflow = max > 1;
    return { start: overflow && scrollTop > 1, end: overflow && scrollTop < max - 1 };
}

/**
 * 给「会滚动的侧栏容器」装**门控**溢出遮罩（`.is-overflow-start` / `.is-overflow-end`）。
 *
 * 为什么需要：侧栏滚动条被**刻意隐藏**（用户 2026-09-16 指示，见 `styles.css` 对应段），
 * 于是内容溢出时没有任何视觉线索，末行被裁一半 ⇒ 用户报「书签显示不全」。滚动本身一直是好的
 * （真机实测 26 条 26 条可达），缺的只是"下面还有"的提示。
 *
 * 三个重算时机（漏任一都会让遮罩停在过期的状态）：
 * 1. `scroll` —— 滚动中实时开合；
 * 2. `ResizeObserver` —— 拖宽侧栏 / 切窗尺寸 / pane 由 `display:none` 恢复显示；
 * 3. `MutationObserver` —— **列表重绘**（`list.empty()` + 重填）只改内容不改元素尺寸，
 *    ResizeObserver 看不见，必须靠它；否则删光书签后遮罩还挂着。
 * 全部经 rAF 合并（滚动事件每帧可能几十次，直接量 `scrollHeight` 会触发同步回流）。
 *
 * 返回 dispose（面板销毁时调用，断监听 / 断观察者 / 撤类）。
 */
/** el → 它的重算函数（供 `resyncScrollFade` 在 pane 由 hidden 转显示后手动补一枪） */
const fadeSyncs = new WeakMap<HTMLElement, () => void>();

/** 手动重算某容器的遮罩状态（pane 从 `display:none` 恢复时 ResizeObserver 未必及时，补一枪更稳） */
export function resyncScrollFade(el: HTMLElement | null | undefined): void {
    if (el) fadeSyncs.get(el)?.();
}

export function attachScrollFade(el: HTMLElement): () => void {
    let start = false;
    let end = false;
    let raf: number | null = null;
    let timer: number | null = null;
    let disposed = false;

    const sync = (): void => {
        raf = null;
        timer = null;
        if (disposed) return;
        const next = overflowFlags(el.scrollTop, el.clientHeight, el.scrollHeight);
        if (next.start !== start) {
            start = next.start;
            el.classList.toggle(OVERFLOW_START_CLASS, start);
        }
        if (next.end !== end) {
            end = next.end;
            el.classList.toggle(OVERFLOW_END_CLASS, end);
        }
    };
    // rAF 缺失（老环境 / 测试替身）时退化成 setTimeout，保住"合并到下一帧"的语义
    const schedule = (): void => {
        if (disposed || raf !== null || timer !== null) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            raf = window.requestAnimationFrame(sync);
        } else {
            timer = window.setTimeout(sync, 0);
        }
    };

    el.addEventListener('scroll', schedule, { passive: true });
    el.classList.add(FADE_Y_CLASS);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(schedule);
        ro.observe(el);
    }
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mo?.observe(el, { childList: true, subtree: true });
    fadeSyncs.set(el, sync);
    sync();

    return () => {
        disposed = true;
        fadeSyncs.delete(el);
        if (raf !== null) window.cancelAnimationFrame(raf);
        if (timer !== null) window.clearTimeout(timer);
        raf = null;
        timer = null;
        el.removeEventListener('scroll', schedule);
        ro?.disconnect();
        mo?.disconnect();
        el.classList.remove(FADE_Y_CLASS, OVERFLOW_START_CLASS, OVERFLOW_END_CLASS);
    };
}

/** 给同一侧栏的多个候选滚动容器各装一个（谁真溢出谁表现为准，不溢出的那个永远不挂类） */
export function attachScrollFades(els: ReadonlyArray<HTMLElement | null | undefined>): () => void {
    const disposers: Array<() => void> = [];
    for (const el of els) if (el) disposers.push(attachScrollFade(el));
    return () => {
        for (const d of disposers) d();
    };
}

/** 读取记忆宽度（localStorage 不可用 / 未存 → null，由调用方回退 CSS 定宽）。
 *  🔴 先读本阅读器自己的键；老版本只有全局键 ⇒ 回退读它（**只读**，读到后由 saveTocWidth 迁到新键）。 */
export function loadTocWidth(scope: TocScope): number | null {
    try {
        const own = localStorage.getItem(tocWidthKey(scope));
        if (own !== null) return clampTocWidth(Number(own));
        const legacy = localStorage.getItem(TOC_WIDTH_KEY);
        if (legacy !== null) return clampTocWidth(Number(legacy));
        return null;
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

function saveTocWidth(scope: TocScope, w: number): void {
    try {
        localStorage.setItem(tocWidthKey(scope), String(clampTocWidth(w)));
    } catch {
        /* 写不进就不记（下次还是定宽） */
    }
}

/**
 * 给目录侧栏装**拖宽手柄**（右缘 9px 热区）+ 应用记忆宽度。
 * 🔴 拖动期间挂 `.rl-toc-resizing` 关掉 `transition: width`（否则每帧都被过渡吃掉，拖起来发黏）。
 * ⚠️ 手柄是绝对定位的 9px 热区，不占布局；`.rl-reader-toc` 本就 `position: relative`。
 * @param scope 侧栏宽度作用域 = 阅读器类型（四者各自记忆、互不同步，见 `tocWidthKey`）
 */
export function attachTocResizer(tocEl: HTMLElement, scope: TocScope): void {
    // 🔴 只写 CSS 变量，不写 `style.width`（#339：行内 width 会把 `.collapsed { width: 0 }` 顶死 ⇒ 收不起来）
    const saved = loadTocWidth(scope);
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
            saveTocWidth(scope, currentTocWidth(tocEl) || startW);
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
        grip.addEventListener('pointercancel', onUp);
    });
}
