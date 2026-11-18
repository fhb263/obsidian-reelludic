import {
    hitShotHandle,
    normalizeShotRect,
    rectFromDrag,
    resizeShotRect,
    SHOT_HANDLES,
    SHOT_MIN_SIZE,
    type ShotHandle,
    type ShotRect,
} from 'pure/readerShot';

/**
 * 阅读器「区域截图」的**框选层**（2026-10-23；2026-11-13 加「可调整」批注模式）。
 *
 * 两种模式：
 *  - **直接模式**（默认）：拖出框 → 松手立刻 `onPick(视口矩形)` 并自毁。左键点截图按钮走这条。
 *  - **调整模式**（`start(hint, { adjust: true })`）：拖出框后**不提交**，框上出现八个手柄，
 *    可继续拖手柄改宽高（六向 = 上下左右 + 四角）、可重新拖一个新框；回车/双击确认，Esc 取消。
 *    右键点截图按钮（批注）走这条 —— 批注前先把框摆准。
 *
 * 🔴🔴 2026-11-14 用户指令（bug 修复）：「阅读器的截图批注模式下根本没有显示对应的批注图标按钮，
 *    也无法点击截图」。
 *    根因：调整模式框选后**只认回车 / 双击**，界面上没有任何按钮、提示里也只有一行小字
 *    ⇒ 用户松手后点哪里都没反应，自然「点不了截图、也看不到批注图标」。
 *    修法：选框一落定就浮出「批注」「取消」两颗实体按钮（`.rl-shot-ops`），点按钮 = 同一 `commit()`；
 *    回车/双击保留为快捷方式（⛔ 不删，老用户已经习惯了）。
 *    ⛔ 别把按钮做成 `pointer-events: none` 的装饰 —— 它必须可点。
 *
 * 生命周期：`new ShotOverlay(host, onPick, onCancel)` → `.start()` → 用户拖框/调整 → 回调 `onPick(视口矩形)` 并自毁。
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
    private handleEls: HTMLDivElement[] = [];
    /** 调整模式框定后浮出的「批注 / 取消」按钮行（直接模式恒为 null）。 */
    private opsEl: HTMLDivElement | null = null;
    private bounds = { left: 0, top: 0, right: 0, bottom: 0 };
    private origin: { x: number; y: number } | null = null;
    private done = false;

    /** 可调整模式：松手后停在选框上等确认。 */
    private adjust = false;
    /** 已确定的选框（视口坐标）；直接模式恒为 null。 */
    private rect: ShotRect | null = null;
    /** 正在拖的手柄；null 表示「没在调」。 */
    private grip: ShotHandle | null = null;
    /** 拖手柄时的起点（视口坐标）。 */
    private gripFrom: { x: number; y: number; rect: ShotRect } | null = null;
    /** 调整模式里那颗主按钮的文字（默认「批注」，阅读器右键走这条）。 */
    private okText = '批注';

    constructor(
        private readonly host: HTMLElement,
        private readonly onPick: (rect: ShotRect) => void,
        private readonly onCancel: () => void,
    ) {}

    /**
     * 进入框选态。`hint` 是顶部那行操作提示（可省）。
     * `opts.adjust` 为真时进入可调整的批注模式（松手不提交，等确认）。
     * `opts.okText` 是确认按钮文字（默认「批注」）。
     */
    start(hint = '拖拽框选要截取的区域 · Esc 取消', opts: { adjust?: boolean; okText?: string } = {}): void {
        if (this.el) return;
        this.adjust = opts.adjust === true;
        this.okText = opts.okText?.trim() || '批注';
        const hostBox = this.host.getBoundingClientRect();
        this.bounds = {
            left: Math.round(hostBox.left),
            top: Math.round(hostBox.top),
            right: Math.round(hostBox.right),
            bottom: Math.round(hostBox.bottom),
        };

        const el = document.body.createDiv({ cls: 'rl-shot-overlay' });
        this.el = el;
        const hintEl = el.createDiv({
            cls: 'rl-shot-hint',
            text: this.adjust ? '拖出要截取的区域 · 拖手柄调大小 · 回车确认 · Esc 取消' : hint,
        });
        this.hintEl = hintEl;
        const box = el.createDiv({ cls: 'rl-shot-box hidden' });
        this.boxEl = box;
        // 八个手柄只在调整模式出现；直接模式看不到（也不该看到 —— 松手即走）
        if (this.adjust) {
            for (const h of SHOT_HANDLES) {
                const gripEl = box.createDiv({ cls: `rl-shot-handle rl-shot-handle-${h}` });
                gripEl.dataset.handle = h;
                gripEl.addClass('hidden');
                this.handleEls.push(gripEl);
            }
            // 🔴 2026-11-14：可见的确认入口。挂在遮罩上（fixed 定位，跟着框走），
            //    ⛔ 不能挂进 `box` —— 那个 `pointer-events: none`，按钮会点不动。
            const ops = el.createDiv({ cls: 'rl-shot-ops hidden' });
            const okBtn = ops.createEl('button', { cls: 'mod-cta', text: this.okText });
            okBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.commit();
            });
            const noBtn = ops.createEl('button', { text: '取消' });
            noBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.cancel();
            });
            this.opsEl = ops;
        }

        el.addEventListener('pointerdown', this.onPointerDown, true);
        el.addEventListener('pointermove', this.onPointerMove, true);
        el.addEventListener('pointerup', this.onPointerUp, true);
        el.addEventListener('pointercancel', this.cancel, true);
        el.addEventListener('contextmenu', this.onContextMenu, true);
        el.addEventListener('dblclick', this.onDblClick, true);
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
            this.el.removeEventListener('dblclick', this.onDblClick, true);
            this.el.remove();
            this.el = null;
        }
        document.removeEventListener('keydown', this.onKeyDown, true);
        document.body.removeClass('rl-shot-dragging');
        this.boxEl = null;
        this.hintEl = null;
        this.opsEl = null;
        this.handleEls = [];
        this.origin = null;
        this.grip = null;
        this.gripFrom = null;
        this.done = true;
    }

    private onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            this.cancel();
            return;
        }
        // 调整模式下回车 = 确认（用户框准了、不想再点一下）
        if (ev.key === 'Enter' && this.adjust && this.rect) {
            ev.preventDefault();
            ev.stopPropagation();
            this.commit();
        }
    };

    private onContextMenu = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
    };

    private onDblClick = (ev: MouseEvent): void => {
        if (!this.adjust || !this.rect) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.commit();
    };

    private onPointerDown = (ev: PointerEvent): void => {
        if (this.done || !this.el) return;
        // 只认左键（右键留给「取消」）
        if (ev.button !== 0) return;
        // 🔴 2026-11-14：点在「批注 / 取消」按钮上必须原样放行。
        //    本方法是 capture 阶段监听 + `setPointerCapture`，一拦就会把 click 吞掉
        //    ⇒ 按钮看得见却按不动（用户报的正是这个观感的另一半）。
        if (this.opsEl && ev.target instanceof Node && this.opsEl.contains(ev.target)) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.el.setPointerCapture?.(ev.pointerId);

        // 调整模式且已框好：先看是不是抓到了手柄 —— 是就调大小，不是就在框外重新框
        if (this.adjust && this.rect) {
            const hit = hitShotHandle(this.rect, ev.clientX, ev.clientY);
            if (hit && hit !== 'inside') {
                this.grip = hit;
                this.gripFrom = { x: ev.clientX, y: ev.clientY, rect: { ...this.rect } };
                this.paintRect(this.rect);
                return;
            }
        }

        this.origin = { x: ev.clientX, y: ev.clientY };
        // 重新框选：旧框让位，避免出现「两个框」
        if (this.adjust) {
            this.rect = null;
            this.hideHandles();
        }
        const box = this.boxEl;
        if (!box) return;
        box.removeClass('hidden');
        this.paintBox(ev.clientX, ev.clientY);
    };

    private onPointerMove = (ev: PointerEvent): void => {
        if (this.done) return;
        if (this.grip && this.gripFrom) {
            ev.preventDefault();
            ev.stopPropagation();
            this.rect = resizeShotRect(
                this.gripFrom.rect,
                this.grip,
                ev.clientX - this.gripFrom.x,
                ev.clientY - this.gripFrom.y,
                this.bounds,
            );
            this.paintRect(this.rect);
            return;
        }
        if (!this.origin) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.paintBox(ev.clientX, ev.clientY);
    };

    private onPointerUp = (ev: PointerEvent): void => {
        if (this.done) return;

        // 松手柄：停在选框上等确认/继续调
        if (this.grip) {
            ev.preventDefault();
            ev.stopPropagation();
            this.grip = null;
            this.gripFrom = null;
            if (this.rect) this.paintRect(this.rect);
            return;
        }

        if (!this.origin) return;
        ev.preventDefault();
        ev.stopPropagation();
        const origin = this.origin;
        this.origin = null;

        // 调整模式：松手不提交，落成可调的选框
        if (this.adjust) {
            const raw = rectFromDrag(origin.x, origin.y, ev.clientX, ev.clientY, this.bounds);
            if (raw.width < SHOT_MIN_SIZE || raw.height < SHOT_MIN_SIZE) {
                // 误触/手抖：不清屏，让人接着拖（批注模式里清屏更烦）
                this.rect = null;
                this.boxEl?.addClass('hidden');
                this.hideHandles();
                return;
            }
            this.rect = raw;
            this.paintRect(raw);
            this.showHandles();
            return;
        }

        const rect = normalizeShotRect(
            { x1: origin.x, y1: origin.y, x2: ev.clientX, y2: ev.clientY },
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

    private commit = (): void => {
        const rect = this.rect;
        if (this.done || !rect) return;
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

    /** 按已确定的矩形摆选框（调整模式用）。 */
    private paintRect(rect: ShotRect): void {
        const box = this.boxEl;
        if (!box) return;
        box.removeClass('hidden');
        box.style.left = `${rect.x}px`;
        box.style.top = `${rect.y}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        if (this.hintEl) this.hintEl.removeClass('hidden');
        // 🔴 拖手柄改尺寸时按钮要跟着走，否则框缩小了按钮还留在老位置
        if (this.adjust) this.paintOps();
    }

    private showHandles(): void {
        for (const h of this.handleEls) h.removeClass('hidden');
        this.paintOps();
    }

    private hideHandles(): void {
        for (const h of this.handleEls) h.addClass('hidden');
        this.opsEl?.addClass('hidden');
    }

    /**
     * 把「批注 / 取消」按钮行摆到选框正下方（空间不够就摆上方）。
     * 🔴 按钮必须跟着框走 —— 放在固定角落会让用户以为那是别的东西。
     */
    private paintOps(): void {
        const ops = this.opsEl;
        const rect = this.rect;
        if (!ops || !rect) return;
        ops.removeClass('hidden');
        const gap = 8;
        const below = rect.y + rect.height + gap;
        // 先用估算高度（按钮行约 32px）判断放得下放不下，再写 top
        const need = 32 + gap;
        const viewportH = window.innerHeight;
        const top = below + need <= viewportH ? below : Math.max(4, rect.y - need);
        const left = Math.min(rect.x, Math.max(4, window.innerWidth - 180));
        ops.style.top = `${Math.round(top)}px`;
        ops.style.left = `${Math.round(Math.max(4, left))}px`;
    }
}
