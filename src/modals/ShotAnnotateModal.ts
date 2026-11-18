/**
 * 播放器 / 阅读器截图「即时批注」弹窗（用户 `m07854` ⑰；2026-11-13 扩成 pixpin 式工具条）。
 *
 * 用户原话（`m00002`）：「批注模式下框选后可进行六向调整宽高、像 pixpin 一样列出批注
 * （几何图形、铅笔、箭头、文本打字、马赛克、标序号）」。
 *
 * 形态：**弹窗**而不是画在播放器上。理由与 ⑭ 抽卡同源 —— 本仓 `position: fixed` 会被视图的
 * transform 祖先整体偏移（`src/views/components/MediaList.svelte:2228` / `:4053` / `:5121`
 * 三处注释都写着，来自 #610）；宿主 `Modal` 挂在 body 下、自带遮罩 / Esc / 焦点管理。
 *
 * 🔴 四条实现口径：
 *   ① 两层画布：`base`（原图，只画一次）+ `over`（形状，每次重绘）。
 *      马赛克**从 `base` 采样**、画到 `over` —— 若从 `over` 采样就会越打越糊。
 *   ② 撤销 = 弹掉最后一个形状 + `replayShapes` 整帧重放（见 `pure/shotAnnotate` 口径 ②）。
 *   ③ 导出走 `toBlob` 前必须先把 `base` 合成进去，否则落盘的是「透明底 + 几笔红线」。
 *   ④ 工具分两类：**拖动类**（矩形/画圈/铅笔/箭头/马赛克 —— 按下拖出范围）与
 *      **点放类**（文本/序号 —— 点一下就落子）。铅笔要收整条路径点列，不能只留首末两点。
 */
import { App, Modal, Notice, setIcon } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import {
    ANNOTATE_TOOLS,
    ANNOTATE_TOOL_ICONS,
    ANNOTATE_TOOL_TIPS,
    annotateHint,
    canUndo,
    isDragTool,
    makeNumberShape,
    makePenShape,
    makeShape,
    makeTextShape,
    nextSeq,
    toNorm,
    undoShapes,
    type AnnotateTool,
    type AnnotationShape,
} from 'pure/shotAnnotate';
import { replayShapes } from 'pure/shotAnnotateDraw';

export interface ShotAnnotateOptions {
    /** 原始截图（PNG）。 */
    png: ArrayBuffer;
    /** 用户点「保存并插入笔记」后回调**批注后的** PNG。 */
    onSave: (annotated: ArrayBuffer) => Promise<void> | void;
}

/** 预览区最大显示尺寸（CSS px）—— 原图 4K 也不让它撑爆屏幕。 */
const PREVIEW_MAX_W = 880;
const PREVIEW_MAX_H = 620;

export class ShotAnnotateModal extends Modal {
    private shapes: AnnotationShape[] = [];
    private tool: AnnotateTool = 'rect';
    private baseEl: HTMLCanvasElement | null = null;
    private overEl: HTMLCanvasElement | null = null;
    private hintEl: HTMLElement | null = null;
    private undoBtn: HTMLButtonElement | null = null;
    private textInput: HTMLInputElement | null = null;
    private naturalW = 0;
    private naturalH = 0;
    /** 拖动类工具的临时笔迹（松手才入栈）。 */
    private draft: AnnotationShape | null = null;
    /**
     * 拖动类工具的**起点**（归一化坐标）。
     *
     * 🔴🔴 2026-11-14 用户指令（bug 修复）：原话「除了铅笔、标序号外所有批注都无法用」。
     *    根因：`pointerdown` 处用 `makeShape(this.tool, p, p)` 起手 —— 起终点同点 ⇒ 跨度 0 ⇒
     *    `makeShape` 因 `span < ANNOTATE_MIN_SIZE` 返回 **null**；`pointermove` 里又靠
     *    `this.draft && 'from' in this.draft ? this.draft.from : p` 找起点，draft 恒为 null ⇒
     *    起点回落成当前点 ⇒ **跨度永远 0，矩形/画圈/箭头/马赛克永远画不出来**。
     *    铅笔靠累计 `penPoints`、序号靠按下即落子，所以只有这两个能用 —— 与用户观察完全一致。
     *    修法：起点单独存这里，`pointermove` / `pointerup` 都用它当 from，⛔ 不再依赖 draft 反推。
     */
    private dragFrom: { x: number; y: number } | null = null;
    /** 铅笔未松手时的点列。 */
    private penPoints: { x: number; y: number }[] = [];
    private busy = false;

    constructor(
        app: App,
        private readonly opts: ShotAnnotateOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        this.modalEl.addClass('rl-anno-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-anno');
        contentEl.createDiv({ cls: 'rl-anno-kicker', text: '截图批注' });

        const stage = contentEl.createDiv({ cls: 'rl-anno-stage' });
        const base = stage.createEl('canvas', { cls: 'rl-anno-canvas rl-anno-base' });
        const over = stage.createEl('canvas', { cls: 'rl-anno-canvas rl-anno-over' });
        this.baseEl = base;
        this.overEl = over;

        this.hintEl = contentEl.createDiv({ cls: 'rl-anno-hint' });
        this.paintHint();

        // 🔴 2026-11-14 用户指令：工具条**不要文字**，纯图标横排（原话「不要标注文字，
        //    直接图标显示横排就行了」）。文字说明改由 `data-tip` 悬停给出，⛔ 别再塞回 label span。
        //    ⚠️ 也⛔ 不能再加 `aria-label`：本仓有「悬停提示单一真源」硬门禁（`tests/tooltipSingleSource.test.ts`），
        //    同一元素既挂 `data-tip` 又挂 `aria-label` 会叠出两层气泡（实测当场红过）。
        //    无障碍语义由 `data-tip` + `data-tool` 承担。
        const tools = contentEl.createDiv({ cls: 'rl-anno-tools' });
        for (const t of ANNOTATE_TOOLS) {
            const btn = tools.createEl('button', { cls: 'rl-btn rl-anno-tool' });
            btn.setAttribute('data-tool', t);
            btn.setAttribute('data-tip', ANNOTATE_TOOL_TIPS[t]);
            const icon = btn.createSpan({ cls: 'rl-anno-tool-icon' });
            setIcon(icon, ANNOTATE_TOOL_ICONS[t]);
            btn.toggleClass('is-on', t === this.tool);
            btn.addEventListener('click', () => this.pickTool(t, tools));
        }

        const ops = contentEl.createDiv({ cls: 'rl-anno-ops' });
        this.undoBtn = ops.createEl('button', { cls: 'rl-btn rl-anno-undo', text: '撤销一步' });
        this.undoBtn.setAttribute('data-tip', '删掉最近一画（可以一直退到空）');
        this.undoBtn.addEventListener('click', () => this.undo());
        const cancel = ops.createEl('button', { cls: 'rl-btn rl-anno-cancel', text: '取消' });
        cancel.addEventListener('click', () => this.close());
        const save = ops.createEl('button', { cls: 'rl-btn mod-cta rl-anno-save', text: '保存并插入笔记' });
        save.setAttribute('data-tip', '把批注后的图存进附件，并写进这条条目的截图笔记');
        save.addEventListener('click', () => void this.save());

        this.bindPointer(over);
        this.loadImage();
    }

    onClose(): void {
        this.contentEl.empty();
        this.baseEl = null;
        this.overEl = null;
        this.hintEl = null;
        this.undoBtn = null;
        this.textInput = null;
        this.shapes = [];
        this.draft = null;
        this.penPoints = [];
    }

    /** 读 PNG 进两层画布，并按预览上限等比缩放。 */
    private loadImage(): void {
        const base = this.baseEl;
        const over = this.overEl;
        if (!base || !over) return;
        const blob = new Blob([this.opts.png], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (!w || !h) {
                new Notice('这张截图读不出尺寸，标注已取消', 4000);
                this.close();
                return;
            }
            this.naturalW = w;
            this.naturalH = h;
            const scale = Math.min(1, PREVIEW_MAX_W / w, PREVIEW_MAX_H / h);
            const cssW = Math.max(1, Math.round(w * scale));
            const cssH = Math.max(1, Math.round(h * scale));
            // ⚠️ 画布**内部分辨率**用原图尺寸（导出的就是原图），CSS 尺寸才是预览大小。
            for (const c of [base, over]) {
                c.width = w;
                c.height = h;
                c.style.width = `${cssW}px`;
                c.style.height = `${cssH}px`;
            }
            const ctx = base.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, w, h);
            this.repaint();
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            new Notice('这张截图打不开（可能不是有效 PNG），标注已取消', 4000);
            this.close();
        };
        img.src = url;
    }

    private pickTool(t: AnnotateTool, host: HTMLElement): void {
        this.tool = t;
        this.cancelTextInput();
        for (const btn of Array.from(host.querySelectorAll<HTMLButtonElement>('.rl-anno-tool'))) {
            btn.toggleClass('is-on', btn.getAttribute('data-tool') === t);
        }
        this.paintHint();
    }

    private bindPointer(over: HTMLCanvasElement): void {
        let drawing = false;
        const toPoint = (ev: PointerEvent): { x: number; y: number } => {
            const box = over.getBoundingClientRect();
            // 预览被 CSS 缩放过 ⇒ 必须按「显示尺寸 → 画布内部分辨率」换算，⛔ 不能直接用 clientX
            return toNorm(
                ((ev.clientX - box.left) / (box.width || 1)) * this.naturalW,
                ((ev.clientY - box.top) / (box.height || 1)) * this.naturalH,
                this.naturalW,
                this.naturalH,
            );
        };

        over.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || this.busy) return;
            ev.preventDefault();
            over.setPointerCapture?.(ev.pointerId);
            const p = toPoint(ev);

            // 点放类：按下即落子（文本要先弹输入框，拿不到内容就不落）
            if (!isDragTool(this.tool)) {
                if (this.tool === 'number') {
                    const shape = makeNumberShape(p, nextSeq(this.shapes));
                    if (shape) this.shapes = [...this.shapes, shape];
                    this.repaint();
                    this.paintHint();
                } else if (this.tool === 'text') {
                    this.openTextInput(over, p);
                }
                return;
            }

            drawing = true;
            if (this.tool === 'pen') {
                this.penPoints = [p];
                this.draft = makePenShape(this.penPoints);
            } else {
                // 🔴 起点必须存下来（见 `dragFrom` 的注释：这里曾经传 p,p 导致跨度恒 0）
                this.dragFrom = p;
                this.draft = null;
            }
        });

        over.addEventListener('pointermove', (ev) => {
            if (!drawing) return;
            ev.preventDefault();
            const p = toPoint(ev);
            if (this.tool === 'pen') {
                this.penPoints = [...this.penPoints, p];
                this.draft = makePenShape(this.penPoints);
            } else {
                // 🔴 起点用 `dragFrom`，⛔ 不再从 draft 反推（draft 为 null 时那会退化成当前点）
                const from = this.dragFrom ?? p;
                this.draft = makeShape(this.tool, from, p);
            }
            this.repaint();
        });

        const finish = (ev: PointerEvent): void => {
            if (!drawing) return;
            drawing = false;
            // 拖动到一半的形状在松手时才算数；过小 = 误触，静默不入栈
            if (this.draft && ('points' in this.draft || 'to' in this.draft)) {
                const d = this.draft;
                const end = toPoint(ev);
                let shape: AnnotationShape | null = d;
                if (this.tool !== 'pen') {
                    // 🔴 松手时用 dragFrom 重算一次，保证「按下→拖动→松手」两端精确
                    shape = makeShape(this.tool, this.dragFrom ?? ('from' in d ? d.from : end), end);
                }
                if (shape) this.shapes = [...this.shapes, shape];
            }
            this.draft = null;
            this.dragFrom = null;
            this.penPoints = [];
            this.repaint();
            this.paintHint();
        };
        over.addEventListener('pointerup', finish);
        over.addEventListener('pointercancel', (ev) => {
            drawing = false;
            this.draft = null;
            this.dragFrom = null;
            this.penPoints = [];
            void ev;
            this.repaint();
        });
    }

    /**
     * 就地文本输入框：贴在点击位置，回车提交、Esc 取消、失焦取消。
     * 用 `position: absolute` 落在 stage 内（stage 相对定位），坐标由归一化点换算成 CSS px。
     */
    private openTextInput(over: HTMLCanvasElement, at: { x: number; y: number }): void {
        this.cancelTextInput();
        const stage = over.parentElement;
        if (!stage) return;
        const box = over.getBoundingClientRect();
        const stageBox = stage.getBoundingClientRect();
        const left = box.left - stageBox.left + (at.x / (this.naturalW || 1)) * box.width;
        const top = box.top - stageBox.top + (at.y / (this.naturalH || 1)) * box.height;
        const input = stage.createEl('input', { cls: 'rl-anno-textinput' });
        this.textInput = input;
        input.style.left = `${Math.round(left)}px`;
        input.style.top = `${Math.round(top - 22)}px`;
        input.setAttribute('placeholder', '打字后回车');
        const commit = (): void => {
            const text = input.value;
            const shape = makeTextShape(at, text);
            if (shape) this.shapes = [...this.shapes, shape];
            this.cancelTextInput();
            this.repaint();
            this.paintHint();
        };
        input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') {
                ev.preventDefault();
                commit();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                this.cancelTextInput();
            }
        });
        input.addEventListener('blur', () => this.cancelTextInput());
        input.focus();
    }

    private cancelTextInput(): void {
        const input = this.textInput;
        this.textInput = null;
        input?.remove();
    }

    private undo(): void {
        this.shapes = undoShapes(this.shapes);
        this.repaint();
        this.paintHint();
    }

    private paintHint(): void {
        if (!this.hintEl) return;
        this.hintEl.setText(annotateHint(this.tool, this.shapes.length));
        if (this.undoBtn) this.undoBtn.toggleClass('is-disabled', !canUndo(this.shapes));
    }

    /** 整帧重绘：清空 over → 按顺序重放形状（含未松手的那一笔）。 */
    private repaint(): void {
        const over = this.overEl;
        const base = this.baseEl;
        if (!over || !base) return;
        const ctx = over.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, over.width, over.height);
        const src = base.getContext('2d');
        replayShapes(ctx as never, src as never, this.shapes, over.width, over.height);
        if (this.draft) replayShapes(ctx as never, src as never, [this.draft], over.width, over.height);
    }

    /** 合成 base + over → PNG，交给调用方落盘。 */
    private async save(): Promise<void> {
        if (this.busy) return;
        const over = this.overEl;
        const base = this.baseEl;
        if (!over || !base) return;
        this.busy = true;
        try {
            const flat = document.createElement('canvas');
            flat.width = over.width;
            flat.height = over.height;
            const ctx = flat.getContext('2d');
            if (!ctx) {
                new Notice('导出失败：拿不到画布上下文', 4000);
                return;
            }
            // 🔴 必须先合成底图，否则落盘的是「透明底 + 几笔红线」
            ctx.drawImage(base, 0, 0);
            ctx.drawImage(over, 0, 0);
            const blob = await new Promise<Blob | null>((resolve) => flat.toBlob((b) => resolve(b), 'image/png'));
            if (!blob) {
                new Notice('导出失败：这张图没能编码成 PNG', 4000);
                return;
            }
            const buf = await blob.arrayBuffer();
            this.close();
            await this.opts.onSave(buf);
        } finally {
            this.busy = false;
        }
    }
}

/**
 * 是否该把某次点击当成「右键进入批注」。
 * 抽成函数是为了能被单测钉住：`contextmenu` 在 Electron 里 `button` 恒为 2，
 * 但合成事件（含测试）可能是 0 ⇒ 两个信号任一命中就算右键。
 */
export function isAnnotateRequest(ev: { button?: number; type?: string }): boolean {
    return ev.button === 2 || ev.type === 'contextmenu';
}
