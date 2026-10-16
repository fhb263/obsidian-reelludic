// 阅读器顶栏（#345）：**窄屏收纳**的共用逻辑（TXT / EPUB / PDF 三处同款）。
// 纯函数（阈值判定）在此单测；`attachHeadDensity` 是 DOM 接线 —— 与 `pure/readerToc.attachTocResizer` 同惯例。
//
// 背景：顶栏原本是「左组 + 绝对居中的标题 + 右组」，标题脱离 flex 流 ⇒ 长章节名会压住右侧图标。
// #345 曾把标题改为**流式三段**修掉压图标，但留下一个副作用（#379 用户实测报「感觉不是居中显示的」）：
//   流式下中段只在自己那段里居中 ⇒ **偏移 =（左组宽 − 右组宽）/ 2**。左组仅 2 钮（≈86px），
//   右组装着 6 个快捷入口 + 设置（≈250px）⇒ 真实 Chromium 量得**标题恒定偏左 81.8px**（窄屏收纳后只偏 6px）。
// #379 起：标题**回到绝对居中**（`left:50%` + `translateX(-50%)`），宽度由本模块的
//   {@link headTitleSymmetricWidth} 算出「取较近一侧做半径」的对称可用宽 ⇒ 恒居中且绝不压两侧图标。
// 本模块另一件事：更极端的一档 —— 连标题都放不下时，把 6 个快捷入口**整体搬进**「更多」⋮ 浮层。

/** 顶栏进入「窄屏收纳」的宽度阈值（px）。
 *  🔴 #347 由 900 下调到 **720**（用户：「顶栏收起菜单变化再窄一点再显示」—— 900 时还有很宽的余地就把图标收走了）。
 *  算式（实测占用）：左组 ≈ 78 + 快捷入口 6 个 ≈ 204 + 设置 ≈ 34 + 两侧内边距 32 ≈ 348；
 *  再要求标题至少留出 ~370px 可读宽度 ⇒ 348 + 370 ≈ **718**，取整 720。
 *  ⚠️ 想再调就改这一个常数（判定逻辑与 UI-GUIDE 都引用它）。 */
export const HEAD_NARROW_W = 720;

/** 窄屏状态类名（加在 `.rl-reader-head` 上，样式见 styles.css） */
export const HEAD_NARROW_CLASS = 'rl-head-narrow';

/** 是否应把左侧快捷入口收进「更多」菜单。
 *  ⚠️ 宽度 ≤ 0（视图尚未布局）与非法值一律**不收纳** —— 否则 mount 瞬间会误判成窄屏，
 *  把快捷入口搬进浮层再搬回来，出现一帧抽动。 */
export function shouldCollapseQuick(headWidth: number): boolean {
    return Number.isFinite(headWidth) && headWidth > 0 && headWidth < HEAD_NARROW_W;
}

/**
 * 绝对居中标题（`left:50%` + `translateX(-50%)`）的**对称可用宽度**（#379）。
 *
 * 为什么需要它：标题绝对居中后，CSS 无从知道左右两组各占多宽 —— #345 就是栽在这里
 * （当年写死 `max-width:44%`，窗口窄于约 950px 时标题块压到右侧图标上）。
 * 本函数把「不压两侧」表达成一个可测的算式：**取较近的一侧做半径、两侧对称** ——
 * 半径对称 ⇒ 中心必然落在面板正中（这正是「居中」的定义），且左右都不越界。
 *
 * @param distToLeft  面板中心 → 左侧按钮组右缘（调用方已扣掉头栏 `gap`）
 * @param distToRight 面板中心 → 右侧按钮组左缘（同上）
 * @returns 可用宽度（px，≥ 0）。⚠️ 非法 / 负距离按 0：宁可标题收成 0 宽（省略号），
 *          也**不许**产出 `max-width:NaNpx` 或让标题压到按钮上。
 */
export function headTitleSymmetricWidth(distToLeft: number, distToRight: number): number {
    const l = Number.isFinite(distToLeft) ? Math.max(0, distToLeft) : 0;
    const r = Number.isFinite(distToRight) ? Math.max(0, distToRight) : 0;
    return Math.max(0, 2 * Math.min(l, r));
}

/** 只做「标题对称限宽」所需的三件（PDF 用它：PDF 顶栏没有快捷入口、不需要窄屏收纳）。 */
export interface HeadTitleOptions {
    /** 顶栏根节点（`.rl-reader-head`），同时是宽度观测对象 */
    headEl: HTMLElement;
    /** 右侧按钮组（`.rl-reader-ops`） */
    opsEl: HTMLElement;
    /** 绝对居中的标题包裹层（`.rl-reader-title-wrap`） */
    titleEl: HTMLElement;
}

export interface HeadDensityOptions extends HeadTitleOptions {
    /** 快捷入口容器：**同一批按钮实例**在两个宿主间搬运 */
    quickWrap: HTMLElement;
    /** 宽屏回归时的插入锚点（设置按钮，快捷入口插在它前面） */
    anchor: HTMLElement;
    /** 窄屏时的宿主（「更多」⋮ 浮层） */
    moreSlot: HTMLElement;
}

/**
 * 标题对称限宽（#379）：读「面板中心 → 左右两组边缘」的**实测**距离，取较近一侧做半径。
 * 🔴 必须实测而不是算「左组宽 / 右组宽」：左侧将来增减按钮、右侧快捷入口搬进搬出，实测都对。
 */
function syncTitleMaxWidth(o: HeadTitleOptions): void {
    const head = o.headEl;
    // 🔴 未布局时（视图刚建、还没挂进 DOM / 面板不可见）所有 rect 都是 0 ⇒ 算出的可用宽必为 0，
    //    直接写下去会把标题变成 **0 宽**（#376 指示器同款坑：把「还没量到」当成「量到 0」）。
    //    ⇒ 此时**清掉内联值**、退回 CSS 兜底（`max-width:100%`），等 ResizeObserver 报出真实尺寸再算。
    if (!(head.clientWidth > 0)) {
        o.titleEl.style.maxWidth = '';
        return;
    }
    const outer = head.getBoundingClientRect();
    const cs = getComputedStyle(head);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
    const innerL = outer.left + padL;
    const innerR = outer.right - padR;
    const center = (innerL + innerR) / 2;
    // 左组 = 除「标题」与「右侧 ops」之外的全部子节点（当前是目录 + 打开笔记两个按钮）。
    // ⚠️ 用「遍历而非写死索引」：以后左侧再加按钮会自动计入，⛔ 不需要改这里。
    let leftEdge = innerL;
    for (const el of Array.from(head.children)) {
        if (el === o.titleEl || el === o.opsEl) continue;
        leftEdge = Math.max(leftEdge, el.getBoundingClientRect().right);
    }
    const toLeft = center - (leftEdge + gap);
    const toRight = o.opsEl.getBoundingClientRect().left - gap - center;
    o.titleEl.style.maxWidth = `${Math.round(headTitleSymmetricWidth(toLeft, toRight))}px`;
}

/**
 * 只给顶栏装「标题对称限宽」（#379）—— PDF 用：它顶栏没有快捷入口、不需要窄屏收纳那套搬运。
 * 与 {@link attachHeadDensity} 共用同一个 {@link syncTitleMaxWidth}，⛔ 两处逻辑不要各写一遍。
 * 返回 dispose（视图销毁时调用，断开 observer）。
 */
export function attachHeadTitle(o: HeadTitleOptions): () => void {
    const apply = (): void => syncTitleMaxWidth(o);
    apply();
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => apply());
        ro.observe(o.headEl);
        return () => ro.disconnect();
    }
    const onResize = (): void => apply();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
}

/**
 * 给顶栏装两件事（**同一个 ResizeObserver 驱动**，⛔ 别各开一个）：
 * 1. **窄屏收纳**：head 宽度 < {@link HEAD_NARROW_W} → 快捷入口整体移入「更多」浮层，并显示 ⋮。
 *    搬运的是**同一个 DOM 节点**（不是重建按钮）：快捷入口的 `is-on` 激活态、`data-tip`、事件监听全部原样保留。
 * 2. **标题对称限宽**（#379）：标题是绝对居中的，宽度必须按实测边缘算（见 {@link syncTitleMaxWidth}），
 *    否则要么偏（流式三段的副作用）、要么压住两侧图标（#345 的老 bug）。
 * 返回 dispose（视图销毁时调用，断开 observer）。
 */
export function attachHeadDensity(o: HeadDensityOptions): () => void {
    let narrow: boolean | null = null;
    const apply = (): void => {
        const next = shouldCollapseQuick(o.headEl.clientWidth);
        if (next !== narrow) {
            narrow = next;
            o.headEl.classList.toggle(HEAD_NARROW_CLASS, next);
            if (next) o.moreSlot.appendChild(o.quickWrap);
            else o.opsEl.insertBefore(o.quickWrap, o.anchor);
        }
        // 🔴 限宽**每次回调都要重算**（⛔ 不能并进上面那段 `next !== narrow` 的短路里）：
        //    「快捷入口刚被搬走」与「宽度已按新布局算过」是两件事，用窄屏标记拦着会让宽度停在旧值。
        syncTitleMaxWidth(o);
    };
    apply();
    if (typeof ResizeObserver === 'function') {
        const ro = new ResizeObserver(() => apply());
        ro.observe(o.headEl);
        return () => ro.disconnect();
    }
    // 老环境无 ResizeObserver → 退化为窗口 resize（观测粒度粗，但不至于完全不降级）
    const onResize = (): void => apply();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
}
