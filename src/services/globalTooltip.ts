// 全局统一 hover 提示（data-tip 自绘气泡，替代 HTML title 原生黄条——项目 UI 规范，见 Project-Rule/UI-GUIDE）：
// document 级 mouseover/mouseout 委托（覆盖视图/弹窗/浮层所有 data-tip 元素，无需逐处绑定）；
// 气泡固定在**被 hover 元素的正下方**（与鼠标位置无关）；下方空间不足自动翻到元素上方；左右钳制在视口内；
// 页面滚动/任意点击即收起（防错位残留）；pointer-events:none 不拦截鼠标、无 hover 闪烁。
// 文本支持多行（white-space:pre-line），过长自动截断换行。
// 生命周期：plugin onload 调用 initGlobalTooltip()，onunload 调返回值的 destroy()。
export interface GlobalTooltip {
    destroy(): void;
}

const TIP_CLASS = 'rl-tip';
const TIP_GAP = 8; // 气泡与元素间距（px）
const VIEWPORT_MARGIN = 6; // 视口边距

/** 读取 data-tip 文案（去首尾空白；无文案不显示） */
function tipTextOf(el: HTMLElement): string {
    const raw = el.getAttribute('data-tip');
    return raw ? raw.trim() : '';
}

export function initGlobalTooltip(): GlobalTooltip {
    let tip: HTMLElement | null = null;
    let curEl: HTMLElement | null = null;
    const doc = document;

    const ensureTip = (): HTMLElement => {
        if (tip && tip.isConnected) return tip;
        tip = doc.createElement('div');
        tip.className = TIP_CLASS;
        doc.body.appendChild(tip);
        return tip;
    };

    /** 定位：元素正下方居中（gap=8）；下方放不下且上方有空间 → 翻到元素上方；左右/上下越界钳制视口内 */
    const place = (el: HTMLElement): void => {
        const t = ensureTip();
        t.style.left = '0px';
        t.style.top = '0px';
        t.style.display = 'block';
        const r = el.getBoundingClientRect();
        const m = t.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

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
            hide();
            return;
        }
        show(el);
    };

    const onOut = (ev: MouseEvent): void => {
        const el = curEl;
        if (!el) return;
        const rel = ev.relatedTarget as Node | null;
        // 仍在同一 data-tip 元素内移动（子节点间穿梭）→ 保持显示
        if (rel && el.contains(rel)) return;
        hide();
    };

    // 滚动/任意点击收起（气泡固定定位，滚动后坐标失效须隐藏防错位残留）
    const onScroll = (): void => {
        hide();
    };
    const onDown = (): void => {
        hide();
    };

    doc.addEventListener('mouseover', onOver, { passive: true });
    doc.addEventListener('mouseout', onOut, { passive: true });
    doc.addEventListener('mousedown', onDown, { passive: true });
    doc.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return {
        destroy(): void {
            doc.removeEventListener('mouseover', onOver);
            doc.removeEventListener('mouseout', onOut);
            doc.removeEventListener('mousedown', onDown);
            doc.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
            tip?.remove();
            tip = null;
            curEl = null;
        },
    };
}
