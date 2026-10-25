import { normalizeShotRect, type ShotRect } from 'pure/readerShot';

/**
 * 阅读器「区域截图」的**框选层**（2026-10-23）。
 *
 * 生命周期：`new ShotOverlay(host, onPick, onCancel)` → `.start()` → 用户拖框 → 回调 `onPick(视口矩形)` 并自毁。
 * Esc / 右键 / 拖出容器外松手 → `onCancel()`。
 *
 * 🔴 三个必须踩住的点（不踩就会出「框不到 / 框歪」）：
 *   ① 遮罩必须 `position: fixed; inset: 0`，用**视口坐标**记拖拽 —— 若用容器相对坐标，
 *      正文一滚（`scroll` 事件）框就会跟内容错位。
 *   ② 遮罩 `pointer-events: auto` + `touch-action: none`，否则拖拽会被 textLayer 吃掉变成拖选文字。
 *   ③ 截图矩形要**钳制进正文容器**（工具栏/侧栏不参与），故 `start()` 时先量一次 `host.getBoundingClientRect()`。
 */
export class ShotOverlay {
    private el: HTMLDivElement | null = null;
    private boxEl: HTMLDivElement | null = null;
    private hintEl: HTMLDivElement | null = null;
    private bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    private origin: { x: number; y: number } | null = null;
    private dragEl: HTMLDivElement | null = null;
    private done = false;

    constructor(
        private readonly host: HTMLElement,
        private readonly onPick: (rect: ShotRect) => void,
        private readonly onCancel: () => void,
    ) {}

    /** 进入框选态。`hint` 是顶部那行操作提示（可省）。 */
    start(hint = '拖拽框选要截取的区域 · Esc 取消'): void {
        if (this.el) return;
        const hostBox = this.host.getBoundingClientRect();
        this.bounds = {
            left: Math.round(hostBox.left),
            top: Math.round(hostBox.top),
            right: Math.round(hostBox.right),
            bottom: Math.round(hostBox.bottom),
        };

        const el = document.body.createDiv({ cls: 'rl-shot-overlay' });
        this.el = el;
        const hintEl = el.createDiv({ cls: 'rl-shot-hint', text: hint });
        this.hintEl = hintEl;
        const box = el.createDiv({ cls: 'rl-shot-box hidden' });
        this.boxEl = box;

        el.addEventListener('pointerdown', this.onPointerDown, true);
        el.addEventListener('pointermove', this.onPointerMove, true);
        el.addEventListener('pointerup', this.onPointerUp, true);
        el.addEventListener('pointercancel', this.cancel, true);
        el.addEventListener('contextmenu', this.onContextMenu, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        // 🔴 拖动期间禁止选中正文：遮罩已挡视觉，但 textLayer 的 user-select 仍会响应键盘扩展选区
        document.body.addClass('rl-shot-dragging');
    }

    /** 主动销毁（面板 `destroy()` 时兜底调用，⛔ 别让它活过阅读器）。 */
    destroy(): void {
        if (this.el) {
            this.el.removeEventListener('pointerdown', this.onPointerDown, true);
            this.el.removeEventListener('pointermove', this.onPointerMove, true);
            this.el.removeEventListener('pointerup', this.onPointerUp, true);
            this.el.removeEventListener('pointercancel', this.cancel, true);
            this.el.removeEventListener('contextmenu', this.onContextMenu, true);
            this.el.remove();
            this.el = null;
        }
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.body.removeClass('rl-shot-dragging');
        this.boxEl = null;
        this.hintEl = null;
        this.dragEl = null;
        this.done = true;
    }

    private onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
    };

    private onContextMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
    };

    private onPointerDown = (ev: PointerEvent): void => {
        if (this.done || !this.el) return;
        // 只认左键（右键留给「取消」）
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.el.setPointerCapture?.(ev.pointerId);
        this.origin = { x: ev.clientX, y: ev.clientY };
        const box = this.boxEl;
        if (!box) return;
        box.removeClass('hidden');
        this.paintBox(ev.clientX, ev.clientY);
    };

    private onPointerMove = (ev: PointerEvent): void => {
        if (this.done || !this.origin) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.paintBox(ev.clientX, ev.clientY);
    };

    private onPointerUp = (ev: PointerEvent): void => {
        if (this.done || !this.origin) return;
        ev.preventDefault();
        ev.stopPropagation();
        const rect = normalizeShotRect(
            { x1: this.origin.x, y1: this.origin.y, x2: ev.clientX, y2: ev.clientY },
            this.bounds,
        );
        if (!rect) {
            // 过小/全在容器外 ⇒ 当误触，静默收起（不弹提示，避免手抖就报错）
            this.cancel();
            return;
        }
        this.done = true;
        this.destroy();
        this.onPick(rect);
    };

    private cancel = (): void => {
        if (this.done) return;
        this.done = true;
        this.destroy();
        this.onCancel();
    };

    /** 把当前拖拽范围画成视觉选框（视口坐标 → fixed 定位，无需换算容器偏移）。 */
    private paintBox(x: number, y: number): void {
        const box = this.boxEl;
        const origin = this.origin;
        if (!box || !origin) return;
        const left = Math.min(origin.x, x);
        const top = Math.min(origin.y, y);
        const width = Math.abs(x - origin.x);
        const height = Math.abs(y - origin.y);
        box.style.left = `${Math.round(left)}px`;
        box.style.top = `${Math.round(top)}px`;
        box.style.width = `${Math.round(width)}px`;
        box.style.height = `${Math.round(height)}px`;
        if (this.hintEl) this.hintEl.addClass('hidden');
    }
}
