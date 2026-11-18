// 全局统一 hover 提示（data-tip 自绘气泡，替代 HTML title 原生黄条——项目 UI 规范，见 Project-Rule/UI-GUIDE）：
// document 级 mouseover/mouseout 委托（覆盖视图/弹窗/浮层所有 data-tip 元素，无需逐处绑定）；
// **悬停延迟显示**（TIP_DELAY_MS）：停顿片刻才出提示，快速扫过一排按钮不闪气泡；
// 气泡固定在**被 hover 元素的正下方**（与鼠标位置无关）；下方空间不足自动翻到元素上方；左右钳制在视口内；
// 页面滚动/任意点击/移开即收起（延迟等待中移开同样取消，防错位残留）；pointer-events:none 不拦截鼠标、无 hover 闪烁。
// 文本支持多行（white-space:pre-line），过长自动截断换行。
// 生命周期：plugin onload 调用 initGlobalTooltip()，onunload 调返回值的 destroy()。
//
// 🔴🔴 2026-11-07 修「设置页 hover 无任何提示」（用户报障，真缺陷）：
//    本模块原先把监听**硬绑在 `document`**（`const doc = document`）—— 那只等于主窗口。
//    而这一版 Obsidian（1.14.4+）把设置页开在**独立窗口**（独立 CDP target、自己的 document），
//    鼠标事件只在该窗口的 document 上冒泡，主窗口的委托监听一辈子收不到 ⇒ 设置页里所有
//    `data-tip` 全是哑的（元数据源那些勾选项最明显，那里整页只有它靠提示解释「这是什么源」）。
//    ⇒ 现在把「绑定某一部 document」拆成独立能力 `bindTooltipDocument(doc)`：
//      · 每个 document **各自一套** bubble / 计时器 / 当前元素 —— 两个窗口的气泡互不干扰，
//        也不会出现「主窗口的气泡被设置窗口的坐标推着跑」；
//      · `initGlobalTooltip()` 只负责绑当前活动窗口；
//      · 任何在自己的独立窗口里渲染容器的地方，渲染完调一次 `bindTooltipDocument(容器.ownerDocument)`
//        即可（幂等，重复调不会重复绑定）。设置页就是这么接的，见 `Settings.display()`。
//    ⚠️ ⛔ 别退回「全局只绑一个 document」—— 那等于只有主窗口能用，且**不会有任何报错**，
//      下次只能在真机上盯着 hover 发愣才发现。
export interface GlobalTooltip {
    destroy(): void;
}

const TIP_CLASS = 'rl-tip';
const TIP_GAP = 8; // 气泡与元素间距（px）
const VIEWPORT_MARGIN = 6; // 视口边距
/** 悬停延迟（ms）：新元素停顿此时长才显示气泡（2026-09-12 用户裁定「延迟一会才出提示」） */
const TIP_DELAY_MS = 500;

/**
 * 逐元素延迟覆盖（ms，`data-tip-delay` 属性）。
 *
 * 🔴 本轮用户裁定：「元数据搜索源启用」那张表里的**每个勾选项**要「hover 2 秒」才出提示 ——
 *    理由是不想用户扫过一行勾选框时被 13 条说明连续闪一遍（那张表一行最多 3 个源 × 6 组）。
 *    ⇒ 给那些 checkbox 挂 `data-tip-delay="2000"`，其余元素仍走全局 `TIP_DELAY_MS`。
 *    ⚠️ 解析**必须给上下界**：`NaN` / 负数 / 超长（比如手抖写了 `20000`）一律回落全局值，
 *      否则一个坏属性会让某处提示再也不出现或永远不出现。
 *    ⛔ 别把全局 `TIP_DELAY_MS` 改成 2000 —— 那会让全仓所有 data-tip 一起变钝。
 */
const TIP_DELAY_MIN_MS = 0;
const TIP_DELAY_MAX_MS = 10000;

/** 取该元素的显示延迟：`data-tip-delay` 合法则用它，否则回全局值 */
function tipDelayOf(el: HTMLElement): number {
    const raw = el.getAttribute('data-tip-delay');
    if (raw === null) return TIP_DELAY_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < TIP_DELAY_MIN_MS || n > TIP_DELAY_MAX_MS) return TIP_DELAY_MS;
    return Math.round(n);
}

/** 读取 data-tip 文案（去首尾空白；无文案不显示） */
function tipTextOf(el: HTMLElement): string {
    const raw = el.getAttribute('data-tip');
    return raw ? raw.trim() : '';
}

/** 一部 document 上的一套 hover 提示（每个窗口各一份，互不共享状态） */
interface BoundDoc {
    readonly doc: Document;
    detach(): void;
}

/** 已绑定的 document（幂等键）+ 便于统一销毁的列表 */
const boundDocs = new WeakMap<Document, BoundDoc>();
const liveDocs = new Set<BoundDoc>();

/** 取该 document 的定时器宿主（独立窗口里 `window` 与主窗口不同，必须按 doc 取） */
function winOf(doc: Document): Window {
    return doc.defaultView ?? window;
}

function bindDocInstance(doc: Document): BoundDoc {
    let tip: HTMLElement | null = null;
    let curEl: HTMLElement | null = null;
    // 延迟显示状态：pendingEl = 等待中的元素；showTimer = 其定时器 id。
    // 同一元素内子节点间穿梭会反复触发 mouseover —— 靠 pendingEl 判等不重置计时。
    let showTimer: number | null = null;
    let pendingEl: HTMLElement | null = null;
    const win = winOf(doc);

    const ensureTip = (): HTMLElement => {
        if (tip && tip.isConnected) return tip;
        tip = doc.createElement('div');
        tip.className = TIP_CLASS;
        doc.body.appendChild(tip);
        return tip;
    };

    /** 取消待显示的定时器（移开 / 滚动 / 点击 / 切到别的元素时） */
    const cancelPending = (): void => {
        if (showTimer !== null) {
            win.clearTimeout(showTimer);
            showTimer = null;
        }
        pendingEl = null;
    };

    /** 定位：元素正下方居中（gap=8）；下方放不下且上方有空间 → 翻到元素上方；左右/上下越界钳制视口内 */
    const place = (el: HTMLElement): void => {
        const t = ensureTip();
        t.style.left = '0px';
        t.style.top = '0px';
        t.style.display = 'block';
        const r = el.getBoundingClientRect();
        const m = t.getBoundingClientRect();
        const vw = win.innerWidth;
        const vh = win.innerHeight;

        let top = r.bottom + TIP_GAP;
        // 下方空间不足且上方足以容纳 → 翻到元素上方
        if (top + m.height > vh - VIEWPORT_MARGIN && r.top - m.height - TIP_GAP > VIEWPORT_MARGIN) {
            top = r.top - m.height - TIP_GAP;
        }
        top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - m.height - VIEWPORT_MARGIN));
        // 水平：相对元素水平居中（较窄元素 → 居中可能越界 → 钳制；避免负左）
        let left = r.left + r.width / 2 - m.width / 2;
        left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - m.width - VIEWPORT_MARGIN));
        t.style.left = `${Math.round(left)}px`;
        t.style.top = `${Math.round(top)}px`;
    };

    const show = (el: HTMLElement): void => {
        const text = tipTextOf(el);
        if (!text) return;
        const t = ensureTip();
        if (curEl !== el) {
            t.textContent = text; // 文案始终按纯文本插入（防注入；多行经 CSS pre-line 呈现）
            curEl = el;
        }
        place(el);
    };

    const hide = (): void => {
        curEl = null;
        if (tip) tip.style.display = 'none';
    };

    const onOver = (ev: MouseEvent): void => {
        const target = ev.target as HTMLElement | null;
        const el = target && typeof target.closest === 'function' ? (target.closest('[data-tip]') as HTMLElement | null) : null;
        if (!el) {
            cancelPending();
            hide();
            return;
        }
        if (curEl === el) {
            place(el); // 已在显示：跟随元素位置（宽度变化/滚动后重定位由 place 兜底）
            return;
        }
        if (pendingEl === el) return; // 延迟等待中、同元素内穿梭（子节点间 mouseover）→ 不重置计时
        // 换了新元素：旧气泡立即收起 + 取消旧计时，为新元素起延迟
        cancelPending();
        hide();
        pendingEl = el;
        // 延迟按元素取（`data-tip-delay` 可覆盖，见 `tipDelayOf`）；默认仍是全局 500ms
        showTimer = win.setTimeout(() => {
            showTimer = null;
            pendingEl = null;
            show(el);
        }, tipDelayOf(el));
    };

    const onOut = (ev: MouseEvent): void => {
        const el = curEl ?? pendingEl;
        if (!el) return;
        const rel = ev.relatedTarget as Node | null;
        // 仍在同一 data-tip 元素内移动（子节点间穿梭）→ 保持显示/等待
        if (rel && el.contains(rel)) return;
        cancelPending();
        hide();
    };

    // 滚动/任意点击收起（气泡固定定位，滚动后坐标失效须隐藏防错位残留）
    //
    // 🔴🔴 2026-11-08 修「字幕面板的图标按钮 hover 完全不出提示」（用户报障，真缺陷）：
    //    这条滚动监听挂在 document 的**捕获阶段**（`capture: true`，见下方 addEventListener）⇒
    //    页面里**任何**元素的内部滚动都会打进来。字幕列表 `.rl-epp-cuelist` 会随播放自动翻页，
    //    而 #737 起它还是平滑滚动 —— 一次翻页连续派发上百个 scroll 事件。
    //    于是鼠标一悬停、计时刚开始，就被那次**与按钮毫无关系**的滚动取消 ⇒ 提示永远出不来。
    //    （jsdom 实测复现：兄弟容器内部 scroll ⇒ 700ms 后 `.rl-tip` 连节点都不存在。）
    //    ⇒ 两条收紧：
    //      ① 待显示阶段**不取消**：气泡落点是 `show()` 里现量 `getBoundingClientRect()` 算的，
    //         延迟这 500ms 里元素怎么动都不影响最终位置。
    //      ② 已显示阶段只在「这次滚动的容器**就是**当前元素的祖先」时才收起 —— 那种才会真的把
    //         元素挪走；别处的滚动（自动翻页的字幕列表、代码块、侧栏）跟气泡位置无关。
    //    ⛔ 别把捕获改成冒泡来省事：scroll 默认不在冒泡阶段派发，冒泡收不到真实滚动，
    //      气泡会留在原地错位。
    const onScroll = (ev: Event): void => {
        const el = curEl;
        if (!el) return; // 还在延迟等待：位置到 show() 时才量，与这次滚动无关
        const target = ev.target as Node | null;
        // target 为 document 时 `contains` 同样成立（滚动的是整页）
        if (target && typeof target.contains === 'function' && !target.contains(el)) return;
        cancelPending();
        hide();
    };
    const onDown = (): void => {
        cancelPending();
        hide();
    };

    doc.addEventListener('mouseover', onOver, { passive: true });
    doc.addEventListener('mouseout', onOut, { passive: true });
    doc.addEventListener('mousedown', onDown, { passive: true });
    doc.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return {
        doc,
        detach(): void {
            doc.removeEventListener('mouseover', onOver);
            doc.removeEventListener('mouseout', onOut);
            doc.removeEventListener('mousedown', onDown);
            doc.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
            cancelPending();
            tip?.remove();
            tip = null;
            curEl = null;
        },
    };
}

/**
 * 让某一份 document 上的 `data-tip` 生效（幂等）。
 *
 * 独立窗口（设置页等）渲染完自己那一块后调一次即可；主窗口由 `initGlobalTooltip()` 自动绑。
 * ⚠️ 传 `null` / `undefined` 直接忽略（调用点常写 `el.ownerDocument`，el 可能已被回收）。
 */
export function bindTooltipDocument(doc: Document | null | undefined): void {
    if (!doc || !doc.body) return;
    if (boundDocs.has(doc)) return;
    const inst = bindDocInstance(doc);
    boundDocs.set(doc, inst);
    liveDocs.add(inst);
}

export function initGlobalTooltip(): GlobalTooltip {
    // 主窗口：优先 `activeDocument`（多窗口下意识更准），退回全局 `document`
    bindTooltipDocument(typeof activeDocument !== 'undefined' && activeDocument ? activeDocument : document);

    return {
        destroy(): void {
            for (const inst of liveDocs) inst.detach();
            liveDocs.clear();
        },
    };
}
